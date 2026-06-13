import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { AttendanceView } from './_components/attendance-view'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import type { AttendanceRecord, Device, AcademicTerm } from '@/lib/types'

const PAGE_SIZE = 50

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { role, assignedClass } = await requireRole('super_admin', 'admin', 'teacher')

  const params = await searchParams
  const fromDate = typeof params.from === 'string' ? params.from : undefined
  const toDate = typeof params.to === 'string' ? params.to : undefined
  const termId = typeof params.term === 'string' ? params.term : undefined
  const studentIds = typeof params.students === 'string'
    ? params.students.split(',').filter(Boolean)
    : []
  const deviceIds = typeof params.classes === 'string'
    ? params.classes.split(',').filter(Boolean)
    : []
  const page = typeof params.page === 'string' ? Math.max(1, parseInt(params.page, 10)) : 1
  const offset = (page - 1) * PAGE_SIZE

  const supabase = createAdminClient()

  const [studentsRes, devicesRes, academicRes] = await Promise.all([
    supabase
      .from('students')
      .select('id, sid, fullname, form, device_id')
      .eq('status', 'active')
      .order('fullname'),
    supabase
      .from('devices')
      .select('id, form, class')
      .order('form')
      .order('class'),
    supabase
      .from('academic')
      .select('id, term, year, status')
      .order('year', { ascending: false })
      .order('term', { ascending: false }),
  ])

  // Teachers are locked to their assigned class; URL params are ignored for device filtering
  const allDevices = (devicesRes.data ?? []) as Device[]
  let effectiveDeviceIds = deviceIds
  if (role === 'teacher') {
    const teacherDevice = assignedClass
      ? allDevices.find((d) => `Form ${d.form} ${d.class}` === assignedClass)
      : null
    effectiveDeviceIds = teacherDevice ? [teacherDevice.id] : ['__no_match__']
  }

  let query = supabase
    .from('attendance')
    .select(`
      id, date, time, status, scan_id,
      student:sid(id, fullname, sid),
      academic:academic_id(id, term, year),
      device:device_id(id, form, class)
    `, { count: 'exact' })
    .order('date', { ascending: false })
    .order('time', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (fromDate) query = query.gte('date', fromDate)
  if (toDate) query = query.lte('date', toDate)
  if (termId) query = query.eq('academic_id', termId)
  if (studentIds.length > 0) query = query.in('sid', studentIds)
  if (effectiveDeviceIds.length > 0) query = query.in('device_id', effectiveDeviceIds)

  const { data: records, count } = await query

  // Teachers only see students from their class
  const allStudents = studentsRes.data ?? []
  const visibleStudents = role === 'teacher' && effectiveDeviceIds[0] !== '__no_match__'
    ? allStudents.filter((s) => s.device_id === effectiveDeviceIds[0])
    : allStudents

  return (
    <>
      <RealtimeRefresh />
      <AttendanceView
        records={(records ?? []) as unknown as AttendanceRecord[]}
        students={visibleStudents}
        devices={allDevices}
        academic={(academicRes.data ?? []) as AcademicTerm[]}
        filters={{ fromDate, toDate, termId, studentIds, deviceIds }}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={count ?? 0}
        role={role}
        assignedClass={assignedClass}
      />
    </>
  )
}
