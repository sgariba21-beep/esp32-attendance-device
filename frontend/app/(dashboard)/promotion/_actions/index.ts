'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

export async function applyPromotion() {
  const { institutionId } = await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  let studentsQ = supabase
    .from('members')
    .select('id, group_name, device_id, device:device_id(group_name, unit_name)')
    .eq('status', 'active')
    .neq('member_type', 'staff')

  let devicesQ = supabase
    .from('devices')
    .select('id, group_name, unit_name')

  if (institutionId) {
    studentsQ = studentsQ.eq('institution_id', institutionId)
    devicesQ = devicesQ.eq('institution_id', institutionId)
  }

  const [studentsRes, devicesRes] = await Promise.all([studentsQ, devicesQ])

  if (studentsRes.error || devicesRes.error) {
    return { error: 'Failed to load data.', promoted: 0, deactivated: 0 }
  }

  const devices = devicesRes.data ?? []

  const sortedForms = [...new Set(devices.map((d) => d.group_name))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )

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
    if (idx === -1) continue

    if (idx === sortedForms.length - 1) {
      toDeactivate.push(s.id)
    } else {
      const nextForm = sortedForms[idx + 1]
      const nextDeviceId = deviceByKey.get(`${nextForm}|${device.unit_name}`)
      if (nextDeviceId) {
        toPromote.push({ id: s.id, nextForm, nextDeviceId })
      }
    }
  }

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

  revalidatePath('/members')
  revalidatePath('/promotion')

  if (errors.length > 0) {
    return { error: `Completed with errors: ${errors[0]}`, promoted: toPromote.length, deactivated: toDeactivate.length }
  }

  return { error: null, promoted: toPromote.length, deactivated: toDeactivate.length }
}
