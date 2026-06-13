import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { StudentsView } from './_components/students-view'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import type { Device } from '@/lib/types'

export default async function StudentsPage() {
  const { role, assignedClass } = await requireRole('super_admin', 'admin', 'teacher')
  const supabase = createAdminClient()

  const [studentsRes, devicesRes] = await Promise.all([
    supabase
      .from('students')
      .select('id, sid, fullname, form, fin1, fin2, status, device_id, created_at, device:device_id(id, form, class)')
      .order('fullname'),
    supabase
      .from('devices')
      .select('id, form, class')
      .order('form')
      .order('class'),
  ])

  const allDevices = (devicesRes.data ?? []) as Device[]
  const allStudents = (studentsRes.data ?? []) as unknown as StudentWithDevice[]

  // Teachers only see students from their assigned class
  const visibleStudents = role === 'teacher'
    ? (() => {
        const teacherDevice = assignedClass
          ? allDevices.find((d) => `Form ${d.form} ${d.class}` === assignedClass)
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
  form: string
  fin1: number
  fin2: number
  status: 'active' | 'inactive'
  created_at: string
  device_id: string
  device: { id: string; form: string; class: string } | null
}
