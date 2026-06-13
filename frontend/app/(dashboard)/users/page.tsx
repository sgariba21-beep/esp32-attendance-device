import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { UsersView } from './_components/users-view'
import type { UserRole } from '@/lib/supabase/dal'

export default async function UsersPage() {
  const { user: currentUser } = await requireRole('super_admin')
  const admin = createAdminClient()

  const [{ data: authData }, { data: profiles }, { data: devices }] = await Promise.all([
    admin.auth.admin.listUsers(),
    admin.from('profiles').select('id, role, assigned_class'),
    admin.from('devices').select('id, form, class').order('form').order('class'),
  ])

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p])
  )

  const users = (authData?.users ?? [])
    .map((u) => ({
      id:             u.id,
      email:          u.email ?? '',
      created_at:     u.created_at,
      role:           (profileMap.get(u.id)?.role ?? 'teacher') as UserRole,
      assigned_class: profileMap.get(u.id)?.assigned_class ?? null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email))

  return (
    <UsersView
      users={users}
      currentUserId={currentUser.id}
      devices={(devices ?? []) as { id: string; form: string; class: string }[]}
    />
  )
}
