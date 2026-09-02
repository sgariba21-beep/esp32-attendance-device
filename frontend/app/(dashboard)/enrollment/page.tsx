import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution, resolveInstitutionScope, resolveDeviceScope } from '@/lib/supabase/dal'
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
  last_error: string | null
  attempts: number
  created_at: string
  dispatched_at: string | null
  device: { id: string; group_name: string; unit_name: string } | null
  student: { id: string; fullname: string; sid: string } | null
  institution: { name: string } | null
}

export default async function EnrollmentPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const session = await requireRole('super_admin', 'admin', 'platform_admin')
  const { role, institutionId } = session
  const institution = await getInstitution(institutionId)
  const isPlatformAdmin = role === 'platform_admin'
  const supabase = createAdminClient()

  // A device-bound admin may run register / delete jobs for their own device
  // only. An admin with no device assignment has no enrolment access.
  const deviceScope = await resolveDeviceScope(session)
  const adminDeviceId = role === 'admin' && deviceScope.mode === 'device' ? deviceScope.deviceId : null
  if (role === 'admin' && !adminDeviceId) redirect('/unauthorized')

  const params = await searchParams
  const institutionFilter = typeof params.institution === 'string' ? params.institution : undefined

  // T6: platform_admin may scope the page to one institution via ?institution=;
  // every other role is always pinned to its own institution.
  const effectiveInstitutionId = resolveInstitutionScope(session, institutionFilter)

  let jobsQ = supabase
    .from('enrollment_jobs')
    .select(`
      id, command, status, finger_slot, fid, note, last_error, attempts, created_at, dispatched_at,
      device:device_id(id, group_name, unit_name),
      student:student_id(id, fullname, sid),
      institution:institution_id(name)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  // Cross-tenant device list (platform_admin, no institution selected) shows devices
  // from many institutions side by side, so join institution name to disambiguate
  // group/unit labels that collide across tenants.
  let devicesQ = supabase
    .from('devices')
    .select('id, group_name, unit_name, display_name, institution:institution_id(id, name)')
    .not('institution_id', 'is', null)
    .order('group_name')
    .order('unit_name')

  if (effectiveInstitutionId) {
    jobsQ = jobsQ.eq('institution_id', effectiveInstitutionId)
    devicesQ = devicesQ.eq('institution_id', effectiveInstitutionId)
  }

  // Device-bound admin: everything on this page is pinned to their one device.
  if (adminDeviceId) {
    jobsQ = jobsQ.eq('device_id', adminDeviceId)
    devicesQ = devicesQ.eq('id', adminDeviceId)
  }

  // Institution picker options for platform_admin.
  const allInstitutions = isPlatformAdmin
    ? (await supabase.from('institutions').select('id, name').order('name')).data ?? []
    : []

  const [jobsRes, devicesRes] = await Promise.all([jobsQ, devicesQ])

  // Build label from whichever member types the institution actually tracks.
  let labelMemberSingular: string
  let labelMemberPlural: string
  if (institution.track_students && institution.track_staff) {
    labelMemberSingular = `${institution.label_member} / ${institution.label_staff}`
    labelMemberPlural = `${institution.label_members} / ${institution.label_staff_plural}`
  } else if (institution.track_staff) {
    labelMemberSingular = institution.label_staff
    labelMemberPlural = institution.label_staff_plural
  } else {
    labelMemberSingular = institution.label_member
    labelMemberPlural = institution.label_members
  }

  return (
    <EnrollmentView
      initialJobs={(jobsRes.data ?? []) as unknown as EnrollmentJob[]}
      devices={(devicesRes.data ?? []) as unknown as Device[]}
      labelUnit={institution.label_unit}
      labelMember={labelMemberSingular}
      labelMembers={labelMemberPlural}
      showInstitution={isPlatformAdmin}
      institutions={allInstitutions}
      institutionFilter={institutionFilter ?? ''}
      restrictedToDevice={!!adminDeviceId}
    />
  )
}
