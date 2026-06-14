import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
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
  const { institutionId } = await requireRole('super_admin', 'platform_admin')
  const institution = await getInstitution(institutionId)
  const supabase = createAdminClient()

  let jobsQ = supabase
    .from('enrollment_jobs')
    .select(`
      id, command, status, finger_slot, fid, note, created_at,
      device:device_id(id, group_name, unit_name),
      student:student_id(id, fullname, sid)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  let devicesQ = supabase
    .from('devices')
    .select('id, group_name, unit_name, display_name')
    .not('institution_id', 'is', null)
    .order('group_name')
    .order('unit_name')

  if (institutionId) {
    jobsQ = jobsQ.eq('institution_id', institutionId)
    devicesQ = devicesQ.eq('institution_id', institutionId)
  }

  const [jobsRes, devicesRes] = await Promise.all([jobsQ, devicesQ])

  // The enrollable people on a device span every member type the institution tracks.
  // Base label is the primary member term; staff are added only when tracked as a
  // distinct group alongside students (so an office that only tracks staff still
  // reads with its own member term rather than duplicating it).
  const singular = [institution.label_member]
  const plural = [institution.label_members]
  if (institution.track_students && institution.track_staff) {
    singular.push(institution.label_staff)
    plural.push(institution.label_staff_plural)
  }

  return (
    <EnrollmentView
      initialJobs={(jobsRes.data ?? []) as unknown as EnrollmentJob[]}
      devices={(devicesRes.data ?? []) as Device[]}
      labelUnit={institution.label_unit}
      labelMember={singular.join(' / ')}
      labelMembers={plural.join(' / ')}
    />
  )
}
