'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import type { UserRole } from '@/lib/supabase/dal'

const ROLE_RANK: Record<string, number> = {
  platform_admin: 4,
  super_admin: 3,
  admin: 2,
  teacher: 1,
  staff: 1,
}

export async function createUser(data: {
  email: string
  password: string
  role: UserRole
  assigned_unit: string | null
  institution_id?: string | null
}) {
  const session = await requireRole('super_admin')

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
  })

  if (profileError) {
    await admin.auth.admin.deleteUser(authData.user.id)
    return { error: profileError.message }
  }

  revalidatePath('/users')
  return { error: null }
}

async function superAdminCount() {
  const admin = createAdminClient()
  const { count } = await admin
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'super_admin')
  return count ?? 0
}

export async function updateUserRole(id: string, role: UserRole, assigned_unit: string | null) {
  const session = await requireRole('super_admin')

  // Only a platform admin may grant the platform-admin role.
  if (role === 'platform_admin' && session.role !== 'platform_admin') {
    return { error: 'You are not allowed to assign the platform admin role.' }
  }

  const admin = createAdminClient()

  if (role !== 'super_admin') {
    const { data: current } = await admin.from('profiles').select('role').eq('id', id).single()
    if (current?.role === 'super_admin' && (await superAdminCount()) <= 1) {
      return { error: 'Cannot demote the last super admin account.' }
    }
  }

  const { error } = await admin
    .from('profiles')
    .update({ role, assigned_unit: assigned_unit || null })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/users')
  return { error: null }
}

export async function deleteUser(id: string) {
  const { user } = await requireRole('super_admin')

  if (id === user.id) return { error: 'You cannot delete your own account.' }

  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('role').eq('id', id).single()
  if (profile?.role === 'super_admin' && (await superAdminCount()) <= 1) {
    return { error: 'Cannot delete the last super admin account.' }
  }

  const { error } = await admin.auth.admin.deleteUser(id)

  if (error) return { error: error.message }

  revalidatePath('/users')
  return { error: null }
}

export async function changeUserPassword(id: string, password: string) {
  const { user: currentUser, role: currentRole } = await requireRole('super_admin', 'admin', 'platform_admin')

  if (password.length < 8) return { error: 'Password must be at least 8 characters.' }

  const admin = createAdminClient()
  const isSelf = id === currentUser.id

  if (!isSelf) {
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
