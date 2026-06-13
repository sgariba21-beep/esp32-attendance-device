'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

export type DeviceFormData = {
  form: string
  class: string
}

export async function createDevice(data: DeviceFormData) {
  await requireRole('super_admin')
  const supabase = createAdminClient()

  const { error } = await supabase.from('devices').insert({
    form: data.form.trim(),
    class: data.class.trim(),
  })

  if (error) {
    if (error.code === '23505') return { error: 'A device with that form and class already exists.' }
    return { error: error.message }
  }

  revalidatePath('/devices')
  return { error: null }
}

export async function updateDevice(id: string, data: DeviceFormData) {
  await requireRole('super_admin')
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('devices')
    .update({ form: data.form.trim(), class: data.class.trim() })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'A device with that form and class already exists.' }
    return { error: error.message }
  }

  revalidatePath('/devices')
  return { error: null }
}

export async function deleteDevice(id: string) {
  await requireRole('super_admin')
  const supabase = createAdminClient()

  const { error } = await supabase.from('devices').delete().eq('id', id)

  if (error) {
    if (error.code === '23503') return { error: 'Cannot delete: students or attendance records are linked to this device.' }
    return { error: error.message }
  }

  revalidatePath('/devices')
  return { error: null }
}
