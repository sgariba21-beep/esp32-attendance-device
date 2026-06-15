'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'

export type DeviceFormData = {
  group_name: string
  unit_name: string
}

export async function updateDevice(id: string, data: DeviceFormData) {
  const session = await requireRole('super_admin', 'platform_admin')
  const supabase = createAdminClient()

  // Tenant guard (C2): only edit devices in your own institution.
  if (!(await ownsRecord('devices', id, session))) return { error: 'Not found.' }

  const { error } = await supabase
    .from('devices')
    .update({
      group_name: data.group_name.trim(),
      unit_name: data.unit_name.trim(),
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
  const session = await requireRole('super_admin', 'platform_admin')
  const supabase = createAdminClient()

  // Tenant guard (C3): only delete devices in your own institution. This is the
  // destructive path (deactivates members + queues a SPIFFS factory wipe), so the
  // ownership check is critical.
  if (!(await ownsRecord('devices', id, session))) return { error: 'Not found.' }

  // Deactivate any members still assigned to this device BEFORE deleting it.
  // The device's FK is ON DELETE SET NULL, so after the delete their device_id
  // becomes NULL; deactivating first means they don't linger as active members
  // with no unit (which would otherwise be marked absent daily). They can be
  // reactivated once reassigned to a new unit.
  await supabase
    .from('members')
    .update({ status: 'inactive' })
    .eq('device_id', id)

  // Queue a decommission signal keyed by device_id (no FK — must outlive the row).
  // The next time the physical device polls /get-enrollment-job it will receive
  // { decommissioned: true } and clear its SPIFFS identity, returning to factory state.
  await supabase.from('device_resets').upsert({ device_id: id }, { onConflict: 'device_id' })

  // ON DELETE SET NULL on attendance/enrollment_jobs/members preserves those
  // records with a null device reference instead of blocking the delete.
  const { error } = await supabase.from('devices').delete().eq('id', id)

  if (error) {
    // Roll back the reset record if the delete failed so we don't have a dangling entry.
    await supabase.from('device_resets').delete().eq('device_id', id)
    return { error: error.message }
  }

  revalidatePath('/devices')
  return { error: null }
}

export type AssignDeviceFormData = {
  device_id: string
  institution_id: string
}

export async function assignDevice(data: AssignDeviceFormData) {
  // Only platform_admin can bind a device to an institution.
  // Group/unit configuration is done separately by the institution admin.
  const { role } = await requireRole('platform_admin')
  if (role !== 'platform_admin') return { error: 'Only platform admins can assign devices.' }

  const supabase = createAdminClient()

  const { data: inst, error: instErr } = await supabase
    .from('institutions')
    .select('id')
    .eq('id', data.institution_id)
    .single()

  if (instErr || !inst) return { error: 'Institution not found.' }

  const { error } = await supabase
    .from('devices')
    .update({ institution_id: data.institution_id })
    .eq('id', data.device_id)
    .is('institution_id', null) // safety: only assign unassigned devices

  if (error) return { error: error.message }

  revalidatePath('/devices')
  return { error: null }
}
