'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

export type StudentOption = {
  id: string
  fullname: string
  sid: string
  device_id: string
}

export async function getStudentsByDevice(deviceId: string): Promise<StudentOption[]> {
  await requireRole('super_admin')
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
  | { command: 'register'; device_id: string; student_id: string; finger_slot: 'fin1' | 'fin2'; fid: number }
  | { command: 'delete'; device_id: string; student_id: string; finger_slot: 'fin1' | 'fin2' }
  | { command: 'register-master'; device_id: string; fid: number; name: string }
  | { command: 'delete-master'; device_id: string; fid: number }

export async function createEnrollmentJob(data: JobFormData) {
  await requireRole('super_admin')
  const supabase = createAdminClient()

  const row: Record<string, unknown> = {
    device_id: data.device_id,
    command: data.command,
    status: 'pending',
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
    // Store the master name in note so the firmware can write it into the local fid_map
    row.note = data.name.trim()
  } else if (data.command === 'delete-master') {
    row.fid = data.fid
  }

  const { error } = await supabase.from('enrollment_jobs').insert(row)

  if (error) return { error: error.message }

  revalidatePath('/enrollment')
  return { error: null }
}
