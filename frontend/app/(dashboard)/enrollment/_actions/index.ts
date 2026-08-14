'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'

export type StudentOption = {
  id: string
  fullname: string
  sid: string
  device_id: string
}

export async function getStudentsByDevice(deviceId: string): Promise<StudentOption[]> {
  const session = await requireRole('super_admin', 'platform_admin')
  // Tenant guard (C2): do not enumerate another institution's members.
  if (!(await ownsRecord('devices', deviceId, session))) return []
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
  const session = await requireRole('super_admin', 'platform_admin')
  const supabase = createAdminClient()

  // Tenant guard (C2/C3): the device — and therefore every command sent to it,
  // including the destructive clearall/delete — must belong to your institution.
  if (!(await ownsRecord('devices', data.device_id, session))) return { error: 'Not found.' }

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
  } else if (data.command === 'delete') {
    row.student_id = data.student_id
    row.finger_slot = data.finger_slot
  } else if (data.command === 'register-master') {
    row.fid = data.fid
    row.note = data.name.trim()
  } else if (data.command === 'delete-master') {
    row.fid = data.fid
  }

  const { error } = await supabase.from('enrollment_jobs').insert(row)

  if (error) return { error: error.message }

  revalidatePath('/enrollment')
  return { error: null }
}
