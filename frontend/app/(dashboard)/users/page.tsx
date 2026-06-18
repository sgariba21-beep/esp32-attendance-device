import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { UsersView } from './_components/users-view'
import type { UserRole } from '@/lib/supabase/dal'

export default async function UsersPage() {
  const { user: currentUser, role: currentUserRole, institutionId } = await requireRole('super_admin', 'admin', 'platform_admin')
  const institution = await getInstitution(institutionId)
  const isPlatformAdmin = currentUserRole === 'platform_admin'
  const admin = createAdminClient()

  let profilesQ = admin.from('profiles').select('id, role, assigned_unit, institution_id')
  if (institutionId) profilesQ = profilesQ.eq('institution_id', institutionId)

  // Platform admins manage accounts across every institution, so they must
  // choose one when creating an account, and the table shows which institution
  // each account belongs to.
  const institutionsP = isPlatformAdmin
    ? admin.from('institutions').select('id, name').order('name')
    : Promise.resolve({ data: [] as { id: string; name: string }[] })

  // M12: listUsers() returns only the first page (default 50). Page through all
  // of them so accounts beyond the first page are not silently missing.
  async function listAllAuthUsers() {
    const perPage = 1000
    const all: Awaited<ReturnType<typeof admin.auth.admin.listUsers>>['data']['users'][number][] = []
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
      if (error || !data?.users?.length) break
      all.push(...data.users)
      if (data.users.length < perPage) break
    }
    return all
  }

  const [authUsers, { data: profiles }, { data: devices }, { data: institutionsData }] = await Promise.all([
    listAllAuthUsers(),
    profilesQ,
    admin.from('devices').select('id, group_name, unit_name, institution_id').order('group_name').order('unit_name'),
    institutionsP,
  ])

  const profileMap = new Map(
    (profiles ?? []).map((p) => [p.id, p])
  )

  const institutions = (institutionsData ?? []) as { id: string; name: string }[]
  const institutionNames = new Map(institutions.map((i) => [i.id, i.name]))

  const institutionUserIds = new Set(profileMap.keys())

  const users = authUsers
    .filter((u) => !institutionId || institutionUserIds.has(u.id))
    .map((u) => {
      const instId = profileMap.get(u.id)?.institution_id ?? null
      return {
        id:               u.id,
        email:            u.email ?? '',
        created_at:       u.created_at,
        role:             (profileMap.get(u.id)?.role ?? 'super_admin') as UserRole,
        assigned_unit:    profileMap.get(u.id)?.assigned_unit ?? null,
        institution_id:   instId,
        institution_name: instId ? (institutionNames.get(instId) ?? null) : null,
      }
    })
    .sort((a, b) => a.email.localeCompare(b.email))

  return (
    <UsersView
      users={users}
      currentUserId={currentUser.id}
      devices={(devices ?? []) as { id: string; group_name: string; unit_name: string; institution_id: string | null }[]}
      labelUnit={institution.label_unit}
      labelStaff={institution.label_staff}
      institutionType={institution.type}
      currentUserRole={currentUserRole}
      institutions={institutions}
    />
  )
}
