import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { StaffView, type StaffMemberWithDevice } from './_components/staff-view'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import type { Device } from '@/lib/types'

export default async function StaffPage() {
  // T20: staff directory is super_admin/admin/platform_admin only.
  // teacher/staff roles are excluded — they only need their own profile, not a full
  // staff directory. Placed in the (admin) route group for structural enforcement.
  const session = await requireRole('super_admin', 'admin', 'platform_admin')
  const { role } = session
  const supabase = createAdminClient()
  const institution = await getInstitution(session.institutionId)
  const isPlatformAdmin = role === 'platform_admin'

  let membersQ = supabase
    .from('members')
    .select('id, sid, fullname, group_name, fin1, fin2, status, device_id, institution_id, created_at, device:device_id(id, group_name, unit_name), institution:institution_id(id, name)')
    .eq('member_type', 'staff')
    .order('fullname')

  let devicesQ = supabase
    .from('devices')
    .select('id, group_name, unit_name, display_name, institution_id')
    .order('group_name')
    .order('unit_name')

  if (session.institutionId) {
    membersQ = membersQ.eq('institution_id', session.institutionId)
    devicesQ = devicesQ.eq('institution_id', session.institutionId)
  }

  const institutionsP = isPlatformAdmin
    ? supabase.from('institutions').select('id, name').order('name')
    : Promise.resolve({ data: [] as { id: string; name: string }[] })

  const [membersRes, devicesRes, institutionsRes] = await Promise.all([membersQ, devicesQ, institutionsP])

  const allDevices = (devicesRes.data ?? []) as unknown as Device[]
  const allMembers = (membersRes.data ?? []) as unknown as StaffMemberWithDevice[]
  const institutions = (institutionsRes.data ?? []) as { id: string; name: string }[]

  return (
    <>
      <RealtimeRefresh />
      <StaffView
        members={allMembers}
        devices={allDevices}
        role={role}
        institutions={institutions}
        labels={{
          label_member: institution.label_staff,
          label_members: institution.label_staff_plural,
          label_unit: institution.label_unit,
          label_group: institution.label_group,
        }}
      />
    </>
  )
}
