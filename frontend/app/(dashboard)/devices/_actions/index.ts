'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

export type DeviceFormData = {
  group_name: string
  unit_name: string
  display_name?: string
  mode?: 'present_absent' | 'time_in_out'
}

export async function createDevice(data: DeviceFormData) {
  const { institutionId } = await requireRole('super_admin', 'platform_admin')
  const supabase = createAdminClient()

  const { error } = await supabase.from('devices').insert({
    group_name: data.group_name.trim(),
    unit_name: data.unit_name.trim(),
    display_name: data.display_name?.trim() ?? null,
    mode: data.mode ?? 'present_absent',
    institution_id: institutionId,
  })

  if (error) {
    if (error.code === '23505') return { error: 'A device with that group and unit already exists.' }
    return { error: error.message }
  }

  revalidatePath('/devices')
  return { error: null }
}

export async function updateDevice(id: string, data: DeviceFormData) {
  await requireRole('super_admin', 'platform_admin')
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('devices')
    .update({
      group_name: data.group_name.trim(),
      unit_name: data.unit_name.trim(),
      display_name: data.display_name?.trim() ?? null,
      mode: data.mode ?? 'present_absent',
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'A device with that group and unit already exists.' }
    return { error: error.message }
  }

  revalidatePath('/devices')
  return { error: null }
}

export async function deleteDevice(id: string) {
  await requireRole('super_admin', 'platform_admin')
  const supabase = createAdminClient()

  const { error } = await supabase.from('devices').delete().eq('id', id)

  if (error) {
    if (error.code === '23503') return { error: 'Cannot delete: members or attendance records are linked to this device.' }
    return { error: error.message }
  }

  revalidatePath('/devices')
  return { error: null }
}

export type AssignDeviceFormData = {
  device_id: string
  group_name: string
  unit_name: string
  display_name: string
  institution_id: string
}

export async function assignDevice(data: AssignDeviceFormData) {
  // Only platform_admin can assign devices
  const { role } = await requireRole('platform_admin')
  if (role !== 'platform_admin') return { error: 'Only platform admins can assign devices.' }

  const supabase = createAdminClient()

  // Fetch the institution's device_secret to confirm it exists
  const { data: inst, error: instErr } = await supabase
    .from('institutions')
    .select('device_secret')
    .eq('id', data.institution_id)
    .single()

  if (instErr || !inst) return { error: 'Institution not found.' }

  const { error } = await supabase
    .from('devices')
    .update({
      institution_id: data.institution_id,
      group_name: data.group_name.trim(),
      unit_name: data.unit_name.trim(),
      display_name: data.display_name.trim(),
    })
    .eq('id', data.device_id)
    .is('institution_id', null) // safety: only assign unassigned devices

  if (error) return { error: error.message }

  revalidatePath('/devices')
  return { error: null }
}
