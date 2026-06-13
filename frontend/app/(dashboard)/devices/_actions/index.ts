'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

export type DeviceFormData = {
  group_name: string
  unit_name: string
}

export async function createDevice(data: DeviceFormData) {
  await requireRole('super_admin')
  const supabase = createAdminClient()

  const { error } = await supabase.from('devices').insert({
    group_name: data.group_name.trim(),
    unit_name: data.unit_name.trim(),
  })

  if (error) {
    if (error.code === '23505') return { error: 'A device with that group and unit already exists.' }
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
    .update({ group_name: data.group_name.trim(), unit_name: data.unit_name.trim() })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'A device with that group and unit already exists.' }
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
