import { createAdminClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/supabase/dal'
import { EnrollmentView } from './_components/enrollment-view'
import type { Device } from '@/lib/types'

export type EnrollmentJob = {
  id: string
  command: 'register' | 'delete' | 'clearall'
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  finger_slot: 'fin1' | 'fin2' | null
  fid: number | null
  note: string | null
  created_at: string
  device: { id: string; form: string; class: string } | null
  student: { id: string; fullname: string; sid: string } | null
}

export type StudentOption = {
  id: string
  fullname: string
  sid: string
  device_id: string
}

export default async function EnrollmentPage() {
  await verifySession()
  const supabase = createAdminClient()

  const [jobsRes, devicesRes, studentsRes] = await Promise.all([
    supabase
      .from('enrollment_jobs')
      .select(`
        id, command, status, finger_slot, fid, note, created_at,
        device:device_id(id, form, class),
        student:student_id(id, fullname, sid)
      `)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('devices')
      .select('id, form, class')
      .order('form')
      .order('class'),
    supabase
      .from('students')
      .select('id, fullname, sid, device_id')
      .eq('status', 'active')
      .order('fullname'),
  ])

  return (
    <EnrollmentView
      initialJobs={(jobsRes.data ?? []) as unknown as EnrollmentJob[]}
      devices={(devicesRes.data ?? []) as Device[]}
      students={(studentsRes.data ?? []) as StudentOption[]}
    />
  )
}
