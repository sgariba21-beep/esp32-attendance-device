'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'
import type { UserRole } from '@/lib/supabase/dal'

const ROLE_RANK: Record<string, number> = {
  platform_admin: 4,
  super_admin: 3,
  admin: 2,
  teacher: 1,
  staff: 1,
  cashier: 1,
}

const MIN_PASSWORD_LENGTH = 8

// #7: the cashier ↔ member link must stay intra-tenant — a single-column FK
// can't express the cross-column check, so the server action enforces it
// (mirrors rewards' catalogRefsValid).
async function memberInInstitution(
  admin: ReturnType<typeof createAdminClient>,
  memberId: string,
  institutionId: string | null,
): Promise<boolean> {
  if (!institutionId) return false
  const { data } = await admin.from('members').select('institution_id').eq('id', memberId).single()
  return !!data && data.institution_id === institutionId
}

export async function createUser(data: {
  email: string
  password: string
  role: UserRole
  assigned_unit: string | null
  institution_id?: string | null
  member_id?: string | null
}) {
  const session = await requireRole('super_admin')

  // L2: enforce the same minimum the rest of the app uses.
  if (data.password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  }

  // Only a platform admin may grant the platform-admin role.
  if (data.role === 'platform_admin' && session.role !== 'platform_admin') {
    return { error: 'You are not allowed to assign the platform admin role.' }
  }

  // Decide which institution the new account is scoped to.
  //  • super_admin: always their own institution (cannot reach across tenants).
  //  • platform_admin: must pick an institution for any tenant-scoped account;
  //    a new platform_admin account is intentionally institution-less (null).
  let targetInstitutionId = session.institutionId
  if (session.role === 'platform_admin') {
    if (data.role === 'platform_admin') {
      targetInstitutionId = null
    } else {
      if (!data.institution_id) return { error: 'Please select an institution for this account.' }
      targetInstitutionId = data.institution_id
    }
  }

  const admin = createAdminClient()

  // The employee link only applies to cashier accounts; ignore it otherwise.
  let memberLink: string | null = null
  if (data.role === 'cashier' && data.member_id) {
    if (!(await memberInInstitution(admin, data.member_id, targetInstitutionId))) {
      return { error: 'The selected employee is not in this institution.' }
    }
    memberLink = data.member_id
  }

  const { data: authData, error } = await admin.auth.admin.createUser({
    email: data.email.trim(),
    password: data.password,
    email_confirm: true,
  })

  if (error) return { error: error.message }

  const { error: profileError } = await admin.from('profiles').insert({
    id: authData.user.id,
    role: data.role,
    assigned_unit: data.assigned_unit || null,
    institution_id: targetInstitutionId,
    member_id: memberLink,
  })

  if (profileError) {
    await admin.auth.admin.deleteUser(authData.user.id)
    if (profileError.code === '23505') {
      return { error: 'That employee is already linked to another account.' }
    }
    return { error: profileError.message }
  }

  revalidatePath('/users')
  return { error: null }
}

// H4: count super_admins WITHIN a single institution. The "at least one
// super_admin must always exist" invariant is per-institution, not global —
// otherwise an institution could be left with zero administrators.
async function superAdminCount(institutionId: string | null) {
  const admin = createAdminClient()
  let q = admin
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'super_admin')
  if (institutionId) q = q.eq('institution_id', institutionId)
  const { count } = await q
  return count ?? 0
}

export async function updateUserRole(
  id: string,
  role: UserRole,
  assigned_unit: string | null,
  member_id: string | null = null,
) {
  const session = await requireRole('super_admin')

  // Only a platform admin may grant the platform-admin role.
  if (role === 'platform_admin' && session.role !== 'platform_admin') {
    return { error: 'You are not allowed to assign the platform admin role.' }
  }

  // Tenant guard (C2): only manage accounts in your own institution.
  if (!(await ownsRecord('profiles', id, session))) return { error: 'Not found.' }

  const admin = createAdminClient()

  const { data: current } = await admin
    .from('profiles')
    .select('role, institution_id')
    .eq('id', id)
    .single()
  if (!current) return { error: 'Not found.' }

  // H4: don't strand an institution with no super_admin.
  if (current.role === 'super_admin' && role !== 'super_admin') {
    if ((await superAdminCount(current.institution_id)) <= 1) {
      return { error: 'Cannot demote the last super admin in this institution.' }
    }
  }

  // #7: keep the employee link only for cashiers, and only intra-tenant.
  let memberLink: string | null = null
  if (role === 'cashier' && member_id) {
    if (!(await memberInInstitution(admin, member_id, current.institution_id as string | null))) {
      return { error: 'The selected employee is not in this institution.' }
    }
    memberLink = member_id
  }

  const { error } = await admin
    .from('profiles')
    .update({ role, assigned_unit: assigned_unit || null, member_id: memberLink })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') {
      return { error: 'That employee is already linked to another account.' }
    }
    return { error: error.message }
  }

  revalidatePath('/users')
  return { error: null }
}

export async function deleteUser(id: string) {
  const session = await requireRole('super_admin')
  const { user } = session

  if (id === user.id) return { error: 'You cannot delete your own account.' }

  // Tenant guard (C2)
  if (!(await ownsRecord('profiles', id, session))) return { error: 'Not found.' }

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('role, institution_id')
    .eq('id', id)
    .single()

  // H4: per-institution last-super-admin guard.
  if (profile?.role === 'super_admin' && (await superAdminCount(profile.institution_id)) <= 1) {
    return { error: 'Cannot delete the last super admin in this institution.' }
  }

  const { error } = await admin.auth.admin.deleteUser(id)

  if (error) return { error: error.message }

  revalidatePath('/users')
  return { error: null }
}

export async function changeUserPassword(id: string, password: string) {
  const session = await requireRole('super_admin', 'admin', 'platform_admin')
  const { user: currentUser, role: currentRole } = session

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  }

  const admin = createAdminClient()
  const isSelf = id === currentUser.id

  if (!isSelf) {
    // H5: an admin may change ONLY their own password.
    if (currentRole === 'admin') {
      return { error: 'Admins can only change their own password.' }
    }

    // Tenant guard (C2): super_admin may only act within their own institution.
    if (!(await ownsRecord('profiles', id, session))) {
      return { error: 'Not found.' }
    }

    const { data: target } = await admin.from('profiles').select('role').eq('id', id).single()
    const targetRank = ROLE_RANK[target?.role ?? ''] ?? 0
    const currentRank = ROLE_RANK[currentRole] ?? 0
    if (currentRank <= targetRank) {
      return { error: 'You do not have permission to change this account\'s password.' }
    }
  }

  const { error } = await admin.auth.admin.updateUserById(id, { password })
  if (error) return { error: error.message }

  return { error: null }
}
