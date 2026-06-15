import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { MembersView } from './_components/members-view'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import type { Device } from '@/lib/types'

export default async function MembersPage() {
  const { role, assignedUnit, institutionId } = await requireRole('super_admin', 'admin', 'teacher', 'staff', 'platform_admin')
  const supabase = createAdminClient()
  const institution = await getInstitution(institutionId)
  const isPlatformAdmin = role === 'platform_admin'

  let membersQ = supabase
    .from('members')
    .select('id, sid, fullname, group_name, fin1, fin2, status, member_type, device_id, institution_id, created_at, device:device_id(id, group_name, unit_name), institution:institution_id(id, name)')
    .order('fullname')

  // /members is the students page; staff are managed on the dedicated /staff page.
  membersQ = membersQ.neq('member_type', 'staff')

  let devicesQ = supabase
    .from('devices')
    .select('id, group_name, unit_name, display_name, institution_id')
    .order('group_name')
    .order('unit_name')

  if (institutionId) {
    membersQ = membersQ.eq('institution_id', institutionId)
    devicesQ = devicesQ.eq('institution_id', institutionId)
  }

  // Platform admins work across tenants, so they pick an institution when adding
  // a member and can filter the roster by institution.
  const institutionsP = isPlatformAdmin
    ? supabase.from('institutions').select('id, name').order('name')
    : Promise.resolve({ data: [] as { id: string; name: string }[] })

  const [membersRes, devicesRes, institutionsRes] = await Promise.all([membersQ, devicesQ, institutionsP])

  const allDevices = (devicesRes.data ?? []) as unknown as Device[]
  const allMembers = (membersRes.data ?? []) as unknown as MemberWithDevice[]
  const institutions = (institutionsRes.data ?? []) as { id: string; name: string }[]

  const visibleMembers = role === 'teacher' || role === 'staff'
    ? (() => {
        const teacherDevice = assignedUnit
          ? allDevices.find((d) => `${d.group_name} ${d.unit_name}` === assignedUnit)
          : null
        return teacherDevice
          ? allMembers.filter((m) => m.device_id === teacherDevice.id)
          : []
      })()
    : allMembers

  return (
    <>
      <RealtimeRefresh />
      <MembersView
        members={visibleMembers}
        devices={allDevices}
        role={role}
        institutions={institutions}
        labels={{
          label_member: institution.label_member,
          label_members: institution.label_members,
          label_unit: institution.label_unit,
          label_group: institution.label_group,
        }}
      />
    </>
  )
}

export type MemberWithDevice = {
  id: string
  sid: string
  fullname: string
  group_name: string
  fin1: number
  fin2: number
  status: 'active' | 'inactive'
  member_type: 'student' | 'staff'
  created_at: string
  device_id: string | null
  institution_id: string | null
  device: { id: string; group_name: string; unit_name: string } | null
  institution: { id: string; name: string } | null
}
