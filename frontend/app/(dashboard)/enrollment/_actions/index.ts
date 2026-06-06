'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/supabase/dal'

export type JobFormData =
  | { command: 'clearall'; device_id: string }
  | { command: 'register'; device_id: string; student_id: string; finger_slot: 'fin1' | 'fin2'; fid: number }
  | { command: 'delete'; device_id: string; student_id: string; finger_slot: 'fin1' | 'fin2' }

export async function createEnrollmentJob(data: JobFormData) {
  await verifySession()
  const supabase = createAdminClient()

  const row: Record<string, unknown> = {
    device_id: data.device_id,
    command: data.command,
    status: 'pending',
  }

  if (data.command !== 'clearall') {
    row.student_id = data.student_id
    row.finger_slot = data.finger_slot
  }

  if (data.command === 'register') {
    row.fid = data.fid
  }

  const { error } = await supabase.from('enrollment_jobs').insert(row)

  if (error) return { error: error.message }

  revalidatePath('/enrollment')
  return { error: null }
}
