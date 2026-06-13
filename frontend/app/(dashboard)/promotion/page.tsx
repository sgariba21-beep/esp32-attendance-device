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
      .from('students')
      .select('id, sid, fullname, form, device_id, device:device_id(form, class)')
      .eq('status', 'active')
      .order('fullname'),
    supabase
      .from('devices')
      .select('id, form, class')
      .order('form')
      .order('class'),
  ])

  const students = studentsRes.data ?? []
  const devices = devicesRes.data ?? []

  // Sorted form sequence (natural numeric: Form 1 → Form 2 → Form 3)
  const sortedForms = [...new Set(devices.map((d) => d.form))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )

  // Fast lookup: "Form 2|A" → device id
  const deviceByKey = new Map<string, string>()
  for (const d of devices) {
    deviceByKey.set(`${d.form}|${d['class']}`, d.id)
  }

  // Group students by current form
  const groupMap = new Map<string, PromotionGroup>()

  for (const s of students) {
    const device = s.device as unknown as { form: string; class: string } | null
    if (!device) continue

    const idx = sortedForms.indexOf(s.form)
    if (idx === -1) continue // unknown form — skip

    const toForm = idx === sortedForms.length - 1 ? null : sortedForms[idx + 1]
    const targetDeviceId = toForm
      ? (deviceByKey.get(`${toForm}|${device['class']}`) ?? null)
      : null  // deactivating — no device needed

    const ps: PromotionStudent = {
      id: s.id,
      sid: s.sid,
      fullname: s.fullname,
      fromForm: s.form,
      fromClass: device['class'],
      toForm,
      targetDeviceId,
    }

    if (!groupMap.has(s.form)) {
      groupMap.set(s.form, { fromForm: s.form, toForm, matched: [], unmatched: [] })
    }

    const group = groupMap.get(s.form)!
    // Deactivations (toForm === null) always go in matched — no device needed
    if (toForm === null || targetDeviceId !== null) {
      group.matched.push(ps)
    } else {
      group.unmatched.push(ps)
    }
  }

  // Return groups in sorted form order
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
