import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { AttendanceView } from './_components/attendance-view'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import type { AttendanceRecord, Device, AcademicTerm } from '@/lib/types'

const PAGE_SIZE = 50

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { role, assignedUnit, institutionId } = await requireRole('super_admin', 'admin', 'teacher', 'staff', 'platform_admin')
  const institution = await getInstitution(institutionId)

  const params = await searchParams
  const fromDate = typeof params.from === 'string' ? params.from : undefined
  const toDate = typeof params.to === 'string' ? params.to : undefined
  const termId = typeof params.term === 'string' ? params.term : undefined
  const studentIds = typeof params.students === 'string'
    ? params.students.split(',').filter(Boolean)
    : []
  const staffFilterIds = typeof params.staff === 'string'
    ? params.staff.split(',').filter(Boolean)
    : []
  const deviceIds = typeof params.classes === 'string'
    ? params.classes.split(',').filter(Boolean)
    : []
  const typeFilter = typeof params.type === 'string' ? params.type : undefined
  const institutionFilter = typeof params.institution === 'string' ? params.institution : undefined
  const page = typeof params.page === 'string' ? Math.max(1, parseInt(params.page, 10)) : 1
  const offset = (page - 1) * PAGE_SIZE

  const supabase = createAdminClient()

  // Effective institution scope for this request
  const effectiveInstitutionId = institutionId ?? institutionFilter ?? null

  // Fetch all members with member_type so we can split into students vs staff for
  // the filter dropdowns in the view.
  let membersQ = supabase
    .from('members')
    .select('id, sid, fullname, group_name, device_id, member_type')
    .eq('status', 'active')
    .order('fullname')

  let devicesQ = supabase
    .from('devices')
    .select('id, group_name, unit_name, display_name')
    .order('group_name')
    .order('unit_name')

  let periodsQ = supabase
    .from('periods')
    .select('id, term, year, status')
    .order('year', { ascending: false })
    .order('term', { ascending: false })

  if (effectiveInstitutionId) {
    membersQ = membersQ.eq('institution_id', effectiveInstitutionId)
    devicesQ = devicesQ.eq('institution_id', effectiveInstitutionId)
    periodsQ = periodsQ.eq('institution_id', effectiveInstitutionId)
  }

  // Fetch all institutions for platform_admin filter dropdown
  const allInstitutions = role === 'platform_admin'
    ? (await supabase.from('institutions').select('id, name, track_students, track_staff').order('name')).data ?? []
    : []

  const [membersRes, devicesRes, periodsRes] = await Promise.all([membersQ, devicesQ, periodsQ])

  const allDevices = (devicesRes.data ?? []) as Device[]
  let effectiveDeviceIds = deviceIds
  const isTeacherRole = role === 'teacher' || role === 'staff'
  let teacherDeviceId: string | null = null
  if (isTeacherRole) {
    const teacherDevice = assignedUnit
      ? allDevices.find((d) => `${d.group_name} ${d.unit_name}` === assignedUnit)
      : null
    teacherDeviceId = teacherDevice?.id ?? null
    effectiveDeviceIds = teacherDeviceId ? [teacherDeviceId] : ['__no_match__']
  }

  // Split fetched members into students (non-staff) and staff for the view's filter dropdowns
  type MemberRow = { id: string; sid: string; fullname: string; group_name: string; device_id: string; member_type: string }
  const allMembersList = (membersRes.data ?? []) as MemberRow[]
  const allStudents = allMembersList.filter((m) => m.member_type !== 'staff')
  const allStaffMembers = allMembersList.filter((m) => m.member_type === 'staff')

  // Apply teacher restriction (teacher sees only their unit's members)
  const noTeacherMatch = isTeacherRole && !teacherDeviceId
  const visibleStudents = isTeacherRole && !noTeacherMatch
    ? allStudents.filter((s) => s.device_id === teacherDeviceId)
    : noTeacherMatch ? [] : allStudents
  const visibleStaff = isTeacherRole && !noTeacherMatch
    ? allStaffMembers.filter((s) => s.device_id === teacherDeviceId)
    : noTeacherMatch ? [] : allStaffMembers

  // If type filter active, resolve member IDs of that type first
  let typeMemberIds: string[] | null = null
  if (typeFilter) {
    let typeQ = supabase.from('members').select('id').eq('member_type', typeFilter)
    if (effectiveInstitutionId) typeQ = typeQ.eq('institution_id', effectiveInstitutionId)
    const { data: typeMembers } = await typeQ
    typeMemberIds = typeMembers?.map((m: { id: string }) => m.id) ?? []
  }

  let query = supabase
    .from('attendance')
    .select(`
      id, date, time, status, scan_type, scan_id,
      student:member_id(id, fullname, sid),
      academic:period_id(id, term, year),
      device:device_id(id, group_name, unit_name),
      institution:institution_id(name)
    `, { count: 'exact' })
    .order('date', { ascending: false })
    .order('time', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (effectiveInstitutionId) query = query.eq('institution_id', effectiveInstitutionId)
  if (fromDate) query = query.gte('date', fromDate)
  if (toDate) query = query.lte('date', toDate)
  if (termId) query = query.eq('period_id', termId)

  // Combine student and staff member ID filters — both can be set independently
  const combinedMemberIds = [...studentIds, ...staffFilterIds]
  if (combinedMemberIds.length > 0) query = query.in('member_id', combinedMemberIds)

  if (effectiveDeviceIds.length > 0) query = query.in('device_id', effectiveDeviceIds)
  if (typeMemberIds !== null) query = query.in('member_id', typeMemberIds)

  const { data: records, count } = await query

  return (
    <>
      <RealtimeRefresh />
      <AttendanceView
        records={(records ?? []) as unknown as AttendanceRecord[]}
        students={visibleStudents}
        staffMembers={visibleStaff}
        devices={allDevices}
        academic={(periodsRes.data ?? []) as AcademicTerm[]}
        filters={{ fromDate, toDate, termId, studentIds, staffIds: staffFilterIds, deviceIds, typeFilter, institutionFilter }}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={count ?? 0}
        role={role}
        assignedUnit={assignedUnit}
        institutions={allInstitutions}
        track_students={institution.track_students}
        track_staff={institution.track_staff}
        institutionType={institution.type}
        labels={{
          label_member: institution.label_member,
          label_members: institution.label_members,
          label_staff: institution.label_staff,
          label_staff_plural: institution.label_staff_plural,
          label_unit: institution.label_unit,
          label_period: institution.label_period,
        }}
      />
    </>
  )
}
