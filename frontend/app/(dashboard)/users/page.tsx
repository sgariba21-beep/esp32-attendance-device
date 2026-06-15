import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { UsersView } from './_components/users-view'
import type { UserRole } from '@/lib/supabase/dal'

export default async function UsersPage() {
  const { user: currentUser, role: currentUserRole, institutionId } = await requireRole('super_admin', 'admin', 'platform_admin')
  const institution = await getInstitution(institutionId)
  const admin = createAdminClient()

  let profilesQ = admin.from('profiles').select('id, role, assigned_unit, institution_id')
  if (institutionId) profilesQ = profilesQ.eq('institution_id', institutionId)

  const [{ data: authData }, { data: profiles }, { data: devices }] = await Promise.all([
    admin.auth.admin.listUsers(),
    profilesQ,
    admin.from('devices').select('id, group_name, unit_name').order('group_name').order('unit_name'),
  ])

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p])
  )

  const institutionUserIds = new Set(profileMap.keys())

  const users = (authData?.users ?? [])
    .filter((u) => !institutionId || institutionUserIds.has(u.id))
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
      labelUnit={institution.label_unit}
      labelStaff={institution.label_staff}
      institutionType={institution.type}
      currentUserRole={currentUserRole}
    />
  )
}
