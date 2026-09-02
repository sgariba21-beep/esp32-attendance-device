'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, resolveDeviceScope } from '@/lib/supabase/dal'
import type { Session } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'

// A device-bound admin may only act on their own device, and only via
// register / delete. Non-admins (and unrestricted roles) pass straight through.
async function adminDeviceGuard(
  session: Session,
  deviceId: string,
  command?: string,
): Promise<{ error: string } | { ok: true }> {
  if (session.role !== 'admin') return { ok: true }
  const scope = await resolveDeviceScope(session)
  if (scope.mode !== 'device') return { error: 'Your account is not assigned to a device.' }
  if (deviceId !== scope.deviceId) return { error: 'You can only manage your assigned device.' }
  if (command && command !== 'register' && command !== 'delete') {
    return { error: 'This command is not available for your account.' }
  }
  return { ok: true }
}

export type StudentOption = {
  id: string
  fullname: string
  sid: string
  device_id: string
}

export async function getStudentsByDevice(deviceId: string): Promise<StudentOption[]> {
  const session = await requireRole('super_admin', 'admin', 'platform_admin')
  // Tenant guard (C2): do not enumerate another institution's members.
  if (!(await ownsRecord('devices', deviceId, session))) return []
  const guard = await adminDeviceGuard(session, deviceId)
  if ('error' in guard) return []
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('members')
    .select('id, fullname, sid, device_id')
    .eq('status', 'active')
    .eq('device_id', deviceId)
    .order('fullname')
  return (data ?? []) as StudentOption[]
}

export type JobFormData =
  | { command: 'clearall'; device_id: string }
  | { command: 'register'; device_id: string; student_id: string; finger_slot: 'fin1' | 'fin2'; fid: number; confirmOverwrite?: boolean }
  | { command: 'delete'; device_id: string; student_id: string; finger_slot: 'fin1' | 'fin2' }
  | { command: 'register-master'; device_id: string; fid: number; name: string; confirmOverwrite?: boolean }
  | { command: 'delete-master'; device_id: string; fid: number }

export type CreateJobResult = { error: string | null; needsConfirm?: boolean; conflict?: string }

// M8: a device's sensor slot can be occupied by either a member's fingerprint
// (tracked in members.fin1/fin2) or a master fingerprint (tracked only as
// enrollment_jobs history — there's no separate "current occupant" table, so
// occupancy is the most recent completed register-master/delete-master job
// for that device+fid).
async function getMemberOccupant(
  supabase: ReturnType<typeof createAdminClient>,
  deviceId: string,
  fid: number,
  excludeStudentId?: string,
) {
  const { data: clashes } = await supabase
    .from('members')
    .select('id, fullname')
    .eq('device_id', deviceId)
    .or(`fin1.eq.${fid},fin2.eq.${fid}`)
  return (clashes ?? []).find((m) => m.id !== excludeStudentId) ?? null
}

async function getMasterOccupant(
  supabase: ReturnType<typeof createAdminClient>,
  deviceId: string,
  fid: number,
) {
  const { data } = await supabase
    .from('enrollment_jobs')
    .select('command, note')
    .eq('device_id', deviceId)
    .eq('fid', fid)
    .in('command', ['register-master', 'delete-master'])
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.command === 'register-master' ? (data.note || 'an unnamed master') : null
}

export async function createEnrollmentJob(data: JobFormData): Promise<CreateJobResult> {
  const session = await requireRole('super_admin', 'admin', 'platform_admin')
  const supabase = createAdminClient()

  // Tenant guard (C2/C3): the device — and therefore every command sent to it,
  // including the destructive clearall/delete — must belong to your institution.
  if (!(await ownsRecord('devices', data.device_id, session))) return { error: 'Not found.' }

  // A device-bound admin is limited to register / delete on their own device.
  const guard = await adminDeviceGuard(session, data.device_id, data.command)
  if ('error' in guard) return { error: guard.error }

  // Derive institution_id from the device so the job is correctly scoped
  const { data: device } = await supabase
    .from('devices')
    .select('institution_id')
    .eq('id', data.device_id)
    .single()

  // M8: warn before overwriting another member's fingerprint slot on this device.
  // The operator may proceed, but only after an explicit (second) confirmation.
  // T4f: validate that the student belongs to the device's institution and is
  // assigned to this specific device, before inserting any enrollment job.
  if ((data.command === 'register' || data.command === 'delete') && data.student_id) {
    const { data: studentCheck } = await supabase
      .from('members')
      .select('id, institution_id, device_id, status')
      .eq('id', data.student_id)
      .single()

    if (!studentCheck) return { error: 'Member not found.' }
    if (studentCheck.status !== 'active') return { error: 'Member is not active.' }
    if (studentCheck.institution_id !== device?.institution_id) {
      return { error: 'Member does not belong to this device\'s institution.' }
    }
    if (studentCheck.device_id !== data.device_id) {
      return { error: 'Member is not assigned to this device.' }
    }
  }

  if (data.command === 'register' && !data.confirmOverwrite) {
    const memberConflict = await getMemberOccupant(supabase, data.device_id, data.fid, data.student_id)
    if (memberConflict) {
      return {
        error: null,
        needsConfirm: true,
        conflict: `${memberConflict.fullname} already uses sensor slot ${data.fid} on this device. Enrolling here will overwrite their fingerprint (${data.finger_slot}).`,
      }
    }

    const masterOccupant = await getMasterOccupant(supabase, data.device_id, data.fid)
    if (masterOccupant) {
      return {
        error: null,
        needsConfirm: true,
        conflict: `Sensor slot ${data.fid} on this device is a master fingerprint (${masterOccupant}). Enrolling here will overwrite it and disable WiFi setup recovery for whoever relies on that finger.`,
      }
    }
  }

  if (data.command === 'register-master' && !data.confirmOverwrite) {
    const memberConflict = await getMemberOccupant(supabase, data.device_id, data.fid)
    if (memberConflict) {
      return {
        error: null,
        needsConfirm: true,
        conflict: `${memberConflict.fullname} already uses sensor slot ${data.fid} on this device. Enrolling a master fingerprint here will overwrite their fingerprint.`,
      }
    }

    const masterOccupant = await getMasterOccupant(supabase, data.device_id, data.fid)
    if (masterOccupant) {
      return {
        error: null,
        needsConfirm: true,
        conflict: `Sensor slot ${data.fid} is already a master fingerprint (${masterOccupant}). Enrolling here will overwrite it.`,
      }
    }
  }

  const row: Record<string, unknown> = {
    device_id: data.device_id,
    command: data.command,
    status: 'pending',
    institution_id: device?.institution_id ?? null,
  }

  if (data.command === 'register') {
    row.student_id = data.student_id
    row.finger_slot = data.finger_slot
    row.fid = data.fid
    // Reaches this point only if the slot looked free OR the operator
    // confirmed the overwrite. Forward that decision to the device, which
    // does its own sensor-truth check before storing.
    row.allow_overwrite = data.confirmOverwrite === true
  } else if (data.command === 'delete') {
    row.student_id = data.student_id
    row.finger_slot = data.finger_slot
  } else if (data.command === 'register-master') {
    row.fid = data.fid
    row.note = data.name.trim()
    row.allow_overwrite = data.confirmOverwrite === true
  } else if (data.command === 'delete-master') {
    row.fid = data.fid
  }

  const { error } = await supabase.from('enrollment_jobs').insert(row)

  if (error) return { error: error.message }

  revalidatePath('/enrollment')
  return { error: null }
}

// Copyable columns for a re-queued job. `attempts` / `dispatched_at` /
// `last_error` deliberately reset (fresh row), `status` back to 'pending'.
const REQUEUE_COLUMNS = 'command, device_id, institution_id, student_id, finger_slot, fid, note' as const

/**
 * Re-queue a failed or stuck job as a NEW pending row. The status guard added
 * in 20260902120000 makes completed/failed terminal, so a retry can't just
 * flip the old row — it inserts a fresh one. A stuck `in_progress` job is also
 * marked failed here so there's never two live jobs for the same enrolment.
 *
 * `withOverwrite` forwards allow_overwrite=true — the escape hatch for a slot
 * that reads free in the DB but the device rejected as occupied.
 */
export async function retryEnrollmentJob(
  jobId: string,
  opts: { withOverwrite?: boolean } = {},
): Promise<{ error: string | null }> {
  const session = await requireRole('super_admin', 'admin', 'platform_admin')
  if (!(await ownsRecord('enrollment_jobs', jobId, session))) return { error: 'Not found.' }
  const supabase = createAdminClient()

  const { data: job } = await supabase
    .from('enrollment_jobs')
    .select(`${REQUEUE_COLUMNS}, status, allow_overwrite`)
    .eq('id', jobId)
    .single()

  if (!job) return { error: 'Not found.' }
  const guard = await adminDeviceGuard(session, job.device_id as string, job.command as string)
  if ('error' in guard) return { error: guard.error }
  if (job.status !== 'failed' && job.status !== 'in_progress') {
    return { error: 'Only failed or stuck jobs can be re-queued.' }
  }

  const row: Record<string, unknown> = {
    command: job.command,
    device_id: job.device_id,
    institution_id: job.institution_id,
    student_id: job.student_id,
    finger_slot: job.finger_slot,
    fid: job.fid,
    note: job.note,
    status: 'pending',
    allow_overwrite:
      (job.command === 'register' || job.command === 'register-master') &&
      (opts.withOverwrite === true || job.allow_overwrite === true),
  }

  const { error: insertError } = await supabase.from('enrollment_jobs').insert(row)
  if (insertError) return { error: insertError.message }

  // Retire a stuck in_progress original so it isn't also re-delivered.
  if (job.status === 'in_progress') {
    await supabase
      .from('enrollment_jobs')
      .update({ status: 'failed', last_error: 'superseded by manual re-queue' })
      .eq('id', jobId)
  }

  revalidatePath('/enrollment')
  return { error: null }
}

/** Mark a pending or stuck job failed so it stops being dispatched. */
export async function cancelEnrollmentJob(jobId: string): Promise<{ error: string | null }> {
  const session = await requireRole('super_admin', 'admin', 'platform_admin')
  if (!(await ownsRecord('enrollment_jobs', jobId, session))) return { error: 'Not found.' }
  const supabase = createAdminClient()

  const { data: job } = await supabase
    .from('enrollment_jobs')
    .select('status, device_id, command')
    .eq('id', jobId)
    .single()

  if (!job) return { error: 'Not found.' }
  const guard = await adminDeviceGuard(session, job.device_id as string, job.command as string)
  if ('error' in guard) return { error: guard.error }
  if (job.status !== 'pending' && job.status !== 'in_progress') {
    return { error: 'Only pending or in-progress jobs can be cancelled.' }
  }

  const { error } = await supabase
    .from('enrollment_jobs')
    .update({ status: 'failed', last_error: 'cancelled by operator' })
    .eq('id', jobId)

  if (error) return { error: error.message }
  revalidatePath('/enrollment')
  return { error: null }
}
