import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { StaffView, type StaffMemberWithDevice } from './_components/staff-view'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import type { Device } from '@/lib/types'

export default async function StaffPage() {
  const { role, assignedUnit, institutionId } = await requireRole('super_admin', 'admin', 'teacher', 'staff')
  const supabase = createAdminClient()
  const institution = await getInstitution(institutionId)

  let membersQ = supabase
    .from('members')
    .select('id, sid, fullname, group_name, fin1, fin2, status, device_id, created_at, device:device_id(id, group_name, unit_name)')
    .eq('member_type', 'staff')
    .order('fullname')

  let devicesQ = supabase
    .from('devices')
    .select('id, group_name, unit_name, display_name')
    .order('group_name')
    .order('unit_name')

  if (institutionId) {
    membersQ = membersQ.eq('institution_id', institutionId)
    devicesQ = devicesQ.eq('institution_id', institutionId)
  }

  const [membersRes, devicesRes] = await Promise.all([membersQ, devicesQ])

  const allDevices = (devicesRes.data ?? []) as Device[]
  const allMembers = (membersRes.data ?? []) as unknown as StaffMemberWithDevice[]

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
      <StaffView
        members={visibleMembers}
        devices={allDevices}
        role={role}
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
