import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { UsersView } from './_components/users-view'
import type { UserRole } from '@/lib/supabase/dal'

export default async function UsersPage() {
  const { user: currentUser } = await requireRole('super_admin')
  const admin = createAdminClient()

  const [{ data: authData }, { data: profiles }, { data: devices }] = await Promise.all([
    admin.auth.admin.listUsers(),
    admin.from('profiles').select('id, role, assigned_unit'),
    admin.from('devices').select('id, group_name, unit_name').order('group_name').order('unit_name'),
  ])

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p])
  )

  const users = (authData?.users ?? [])
    .map((u) => ({
      id:            u.id,
      email:         u.email ?? '',
      created_at:    u.created_at,
      role:          (profileMap.get(u.id)?.role ?? 'super_admin') as UserRole,
      assigned_unit: profileMap.get(u.id)?.assigned_unit ?? null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email))

  return (
    <UsersView
      users={users}
      currentUserId={currentUser.id}
      devices={(devices ?? []) as { id: string; group_name: string; unit_name: string }[]}
    />
  )
}
