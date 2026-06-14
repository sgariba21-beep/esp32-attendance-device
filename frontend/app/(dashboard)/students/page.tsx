import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { StudentsView } from './_components/students-view'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import type { Device } from '@/lib/types'

export default async function StudentsPage() {
  const { role, assignedUnit } = await requireRole('super_admin', 'admin', 'teacher')
  const supabase = createAdminClient()

  const [studentsRes, devicesRes] = await Promise.all([
    supabase
      .from('members')
      .select('id, sid, fullname, group_name, fin1, fin2, status, device_id, created_at, device:device_id(id, group_name, unit_name)')
      .order('fullname'),
    supabase
      .from('devices')
      .select('id, group_name, unit_name')
      .order('group_name')
      .order('unit_name'),
  ])

  const allDevices = (devicesRes.data ?? []) as Device[]
  const allStudents = (studentsRes.data ?? []) as unknown as StudentWithDevice[]

  // Teachers only see students from their assigned class
  const visibleStudents = role === 'teacher'
    ? (() => {
        const teacherDevice = assignedUnit
          ? allDevices.find((d) => `${d.group_name} ${d.unit_name}` === assignedUnit)
          : null
        return teacherDevice
          ? allStudents.filter((s) => s.device_id === teacherDevice.id)
          : []
      })()
    : allStudents

  return (
    <>
      <RealtimeRefresh />
      <StudentsView
        students={visibleStudents}
        devices={allDevices}
        role={role}
      />
    </>
  )
}

export type StudentWithDevice = {
  id: string
  sid: string
  fullname: string
  group_name: string
  fin1: number
  fin2: number
  status: 'active' | 'inactive'
  created_at: string
  device_id: string
  device: { id: string; group_name: string; unit_name: string } | null
}
