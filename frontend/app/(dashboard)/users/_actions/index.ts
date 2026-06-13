'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import type { UserRole } from '@/lib/supabase/dal'

export async function createUser(data: {
  email: string
  password: string
  role: UserRole
  assigned_class: string | null
}) {
  await requireRole('super_admin')
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
    assigned_class: data.assigned_class || null,
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

export async function updateUserRole(id: string, role: UserRole, assigned_class: string | null) {
  await requireRole('super_admin')
  const admin = createAdminClient()

  if (role !== 'super_admin') {
    const { data: current } = await admin.from('profiles').select('role').eq('id', id).single()
    if (current?.role === 'super_admin' && (await superAdminCount()) <= 1) {
      return { error: 'Cannot demote the last super admin account.' }
    }
  }

  const { error } = await admin
    .from('profiles')
    .update({ role, assigned_class: assigned_class || null })
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
