import { createAdminClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/supabase/dal'
import { StudentsView } from './_components/students-view'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import type { Device } from '@/lib/types'

export default async function StudentsPage() {
  await verifySession()
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

  return (
    <>
      <RealtimeRefresh />
      <StudentsView
        students={(studentsRes.data ?? []) as unknown as StudentWithDevice[]}
        devices={(devicesRes.data ?? []) as Device[]}
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
