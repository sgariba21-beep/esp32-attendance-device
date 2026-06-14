import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { EnrollmentView } from './_components/enrollment-view'
import type { Device } from '@/lib/types'

export type { StudentOption } from './_actions'

export type EnrollmentJob = {
  id: string
  command: 'register' | 'delete' | 'clearall' | 'register-master' | 'delete-master'
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  finger_slot: 'fin1' | 'fin2' | null
  fid: number | null
  note: string | null
  created_at: string
  device: { id: string; group_name: string; unit_name: string } | null
  student: { id: string; fullname: string; sid: string } | null
}

export default async function EnrollmentPage() {
  await requireRole('super_admin')
  const supabase = createAdminClient()

  const [jobsRes, devicesRes] = await Promise.all([
    supabase
      .from('enrollment_jobs')
      .select(`
        id, command, status, finger_slot, fid, note, created_at,
        device:device_id(id, group_name, unit_name),
        student:student_id(id, fullname, sid)
      `)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('devices')
      .select('id, group_name, unit_name')
      .order('group_name')
      .order('unit_name'),
  ])

  return (
    <EnrollmentView
      initialJobs={(jobsRes.data ?? []) as unknown as EnrollmentJob[]}
      devices={(devicesRes.data ?? []) as Device[]}
    />
  )
}
