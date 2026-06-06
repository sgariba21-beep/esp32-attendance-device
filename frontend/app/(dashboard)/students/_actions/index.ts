'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/supabase/dal'

export type StudentFormData = {
  sid: string
  fullname: string
  device_id: string
  fin1: number
  fin2: number
}

export async function createStudent(data: StudentFormData) {
  await verifySession()
  const supabase = createAdminClient()

  const device = await supabase
    .from('devices')
    .select('form')
    .eq('id', data.device_id)
    .single()

  if (!device.data) return { error: 'Device not found.' }

  const { error } = await supabase.from('students').insert({
    sid: data.sid.trim(),
    fullname: data.fullname.trim(),
    device_id: data.device_id,
    form: device.data.form,
    fin1: data.fin1,
    fin2: data.fin2,
    status: 'active',
  })

  if (error) {
    if (error.code === '23505') return { error: 'A student with that school ID already exists.' }
    return { error: error.message }
  }

  revalidatePath('/students')
  return { error: null }
}

export async function updateStudent(id: string, data: StudentFormData) {
  await verifySession()
  const supabase = createAdminClient()

  const device = await supabase
    .from('devices')
    .select('form')
    .eq('id', data.device_id)
    .single()

  if (!device.data) return { error: 'Device not found.' }

  const { error } = await supabase
    .from('students')
    .update({
      sid: data.sid.trim(),
      fullname: data.fullname.trim(),
      device_id: data.device_id,
      form: device.data.form,
      fin1: data.fin1,
      fin2: data.fin2,
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'A student with that school ID already exists.' }
    return { error: error.message }
  }

  revalidatePath('/students')
  return { error: null }
}

export async function setStudentStatus(id: string, status: 'active' | 'inactive') {
  await verifySession()
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('students')
    .update({ status })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/students')
  return { error: null }
}
