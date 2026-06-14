import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import { PromotionView } from './_components/promotion-view'

export type PromotionStudent = {
  id: string
  sid: string
  fullname: string
  fromForm: string
  fromClass: string
  toForm: string | null   // null = will be deactivated
  targetDeviceId: string | null  // null = no matching device (unmatched)
}

export type PromotionGroup = {
  fromForm: string
  toForm: string | null
  matched: PromotionStudent[]
  unmatched: PromotionStudent[]
}

export default async function PromotionPage() {
  await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const [studentsRes, devicesRes] = await Promise.all([
    supabase
      .from('members')
      .select('id, sid, fullname, group_name, device_id, device:device_id(group_name, unit_name)')
      .eq('status', 'active')
      .order('fullname'),
    supabase
      .from('devices')
      .select('id, group_name, unit_name')
      .order('group_name')
      .order('unit_name'),
  ])

  const students = studentsRes.data ?? []
  const devices = devicesRes.data ?? []

  // Sorted group sequence (natural numeric: Form 1 → Form 2 → Form 3)
  const sortedForms = [...new Set(devices.map((d) => d.group_name))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )

  // Fast lookup: "Form 2|A" → device id
  const deviceByKey = new Map<string, string>()
  for (const d of devices) {
    deviceByKey.set(`${d.group_name}|${d.unit_name}`, d.id)
  }

  // Group students by current group_name
  const groupMap = new Map<string, PromotionGroup>()

  for (const s of students) {
    const device = s.device as unknown as { group_name: string; unit_name: string } | null
    if (!device) continue

    const idx = sortedForms.indexOf(s.group_name)
    if (idx === -1) continue // unknown group — skip

    const toForm = idx === sortedForms.length - 1 ? null : sortedForms[idx + 1]
    const targetDeviceId = toForm
      ? (deviceByKey.get(`${toForm}|${device.unit_name}`) ?? null)
      : null  // deactivating — no device needed

    const ps: PromotionStudent = {
      id: s.id,
      sid: s.sid,
      fullname: s.fullname,
      fromForm: s.group_name,
      fromClass: device.unit_name,
      toForm,
      targetDeviceId,
    }

    if (!groupMap.has(s.group_name)) {
      groupMap.set(s.group_name, { fromForm: s.group_name, toForm, matched: [], unmatched: [] })
    }

    const group = groupMap.get(s.group_name)!
    // Deactivations (toForm === null) always go in matched — no device needed
    if (toForm === null || targetDeviceId !== null) {
      group.matched.push(ps)
    } else {
      group.unmatched.push(ps)
    }
  }

  // Return groups in sorted group order
  const groups: PromotionGroup[] = sortedForms
    .map((f) => groupMap.get(f))
    .filter((g): g is PromotionGroup => g !== undefined)

  return (
    <>
      <RealtimeRefresh />
      <PromotionView groups={groups} totalActive={students.length} />
    </>
  )
}
