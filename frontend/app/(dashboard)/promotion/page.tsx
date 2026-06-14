import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { redirect } from 'next/navigation'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import { PromotionView } from './_components/promotion-view'

export type PromotionStudent = {
  id: string
  sid: string
  fullname: string
  fromForm: string
  fromClass: string
  toForm: string | null
  targetDeviceId: string | null
}

export type PromotionGroup = {
  fromForm: string
  toForm: string | null
  matched: PromotionStudent[]
  unmatched: PromotionStudent[]
}

export default async function PromotionPage() {
  const { institutionId } = await requireRole('super_admin', 'admin')
  const institution = await getInstitution(institutionId)

  // Promotion doesn't apply to office-type institutions
  if (institution.type === 'office') {
    redirect('/unauthorized')
  }

  const supabase = createAdminClient()

  let membersQ = supabase
    .from('members')
    .select('id, sid, fullname, group_name, device_id, device:device_id(group_name, unit_name)')
    .eq('status', 'active')
    .neq('member_type', 'staff')
    .order('fullname')

  let devicesQ = supabase
    .from('devices')
    .select('id, group_name, unit_name')
    .order('group_name')
    .order('unit_name')

  if (institutionId) {
    membersQ = membersQ.eq('institution_id', institutionId)
    devicesQ = devicesQ.eq('institution_id', institutionId)
  }

  const [studentsRes, devicesRes] = await Promise.all([membersQ, devicesQ])

  const students = studentsRes.data ?? []
  const devices = devicesRes.data ?? []

  const sortedForms = [...new Set(devices.map((d) => d.group_name))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )

  const deviceByKey = new Map<string, string>()
  for (const d of devices) {
    deviceByKey.set(`${d.group_name}|${d.unit_name}`, d.id)
  }

  const groupMap = new Map<string, PromotionGroup>()

  for (const s of students) {
    const device = s.device as unknown as { group_name: string; unit_name: string } | null
    if (!device) continue

    const idx = sortedForms.indexOf(s.group_name)
    if (idx === -1) continue

    const toForm = idx === sortedForms.length - 1 ? null : sortedForms[idx + 1]
    const targetDeviceId = toForm
      ? (deviceByKey.get(`${toForm}|${device.unit_name}`) ?? null)
      : null

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
    if (toForm === null || targetDeviceId !== null) {
      group.matched.push(ps)
    } else {
      group.unmatched.push(ps)
    }
  }

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
