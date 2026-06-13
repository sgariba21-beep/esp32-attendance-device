'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

/**
 * Applies promotion to every active student:
 *   - Form N → Form N+1 (same class letter, matched device)
 *   - Last form → status = inactive
 *   - No matching next-form device → skipped (shown as warning in preview)
 *
 * Finger slots are reset to 0 because the student is moving to a new physical sensor.
 */
export async function applyPromotion() {
  await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  // Fresh data — never trust client-passed lists for destructive operations
  const [studentsRes, devicesRes] = await Promise.all([
    supabase
      .from('members')
      .select('id, group_name, device_id, device:device_id(group_name, unit_name)')
      .eq('status', 'active'),
    supabase
      .from('devices')
      .select('id, group_name, unit_name'),
  ])

  if (studentsRes.error || devicesRes.error) {
    return { error: 'Failed to load data.', promoted: 0, deactivated: 0 }
  }

  const devices = devicesRes.data ?? []

  // Sorted group sequence (natural numeric order: Form 1, Form 2, Form 3 …)
  const sortedForms = [...new Set(devices.map((d) => d.group_name))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )

  // Fast lookup: "Form 2|A" → device id
  const deviceByKey = new Map<string, string>()
  for (const d of devices) {
    deviceByKey.set(`${d.group_name}|${d.unit_name}`, d.id)
  }

  const toPromote: { id: string; nextForm: string; nextDeviceId: string }[] = []
  const toDeactivate: string[] = []

  for (const s of studentsRes.data ?? []) {
    const device = s.device as unknown as { group_name: string; unit_name: string } | null
    if (!device) continue

    const idx = sortedForms.indexOf(s.group_name)
    if (idx === -1) continue // unrecognised group — skip

    if (idx === sortedForms.length - 1) {
      // Final group → deactivate
      toDeactivate.push(s.id)
    } else {
      const nextForm = sortedForms[idx + 1]
      const nextDeviceId = deviceByKey.get(`${nextForm}|${device.unit_name}`)
      if (nextDeviceId) {
        toPromote.push({ id: s.id, nextForm, nextDeviceId })
      }
      // No matching device → skip (admin saw this warning in preview)
    }
  }

  // Batch updates (individual rows — fine for school-scale data)
  const errors: string[] = []

  for (const p of toPromote) {
    const { error } = await supabase
      .from('members')
      .update({ group_name: p.nextForm, device_id: p.nextDeviceId, fin1: 0, fin2: 0 })
      .eq('id', p.id)
    if (error) errors.push(error.message)
  }

  if (toDeactivate.length > 0) {
    const { error } = await supabase
      .from('members')
      .update({ status: 'inactive' })
      .in('id', toDeactivate)
    if (error) errors.push(error.message)
  }

  revalidatePath('/students')
  revalidatePath('/promotion')

  if (errors.length > 0) {
    return { error: `Completed with errors: ${errors[0]}`, promoted: toPromote.length, deactivated: toDeactivate.length }
  }

  return { error: null, promoted: toPromote.length, deactivated: toDeactivate.length }
}
