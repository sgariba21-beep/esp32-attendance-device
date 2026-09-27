import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { DevicesView, type MeetingImpact } from './_components/devices-view'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import type { Device, UnassignedDevice, InstitutionConfig } from '@/lib/types'

/**
 * Club mode: what deleting each device would take with it. The delete guard
 * (a trigger) cancels its not-yet-started meetings and stops its schedules;
 * the confirm dialog says so up front. Non-club devices simply have none.
 */
async function loadMeetingImpact(deviceIds: string[]): Promise<MeetingImpact> {
  const impact: MeetingImpact = {}
  if (deviceIds.length === 0) return impact
  const supabase = createAdminClient()
  const [meetingsRes, schedulesRes] = await Promise.all([
    supabase
      .from('meetings')
      .select('device_id')
      .in('device_id', deviceIds)
      .eq('status', 'scheduled')
      .gt('starts_at', new Date().toISOString()),
    supabase
      .from('meeting_schedules')
      .select('device_id')
      .in('device_id', deviceIds)
      .eq('active', true),
  ])
  const bump = (id: string, key: 'meetings' | 'schedules') => {
    impact[id] ??= { meetings: 0, schedules: 0 }
    impact[id][key]++
  }
  for (const m of meetingsRes.data ?? []) bump(m.device_id as string, 'meetings')
  for (const s of schedulesRes.data ?? []) bump(s.device_id as string, 'schedules')
  return impact
}

export default async function DevicesPage() {
  const { role, institutionId } = await requireRole('super_admin', 'platform_admin')
  const institution = await getInstitution(institutionId)
  const supabase = createAdminClient()

  let devicesQ = supabase
    .from('devices')
    .select('id, mac, group_name, unit_name, display_name, institution:institution_id(id, name)')
    .not('institution_id', 'is', null)
    .order('group_name')
    .order('unit_name')

  if (institutionId) {
    devicesQ = devicesQ.eq('institution_id', institutionId)
  }

  const { data: assignedData } = await devicesQ
  // Normalize nulls so the Device type contract is satisfied downstream
  const allAssigned = ((assignedData ?? []) as unknown as Device[]).map((d) => ({
    ...d,
    group_name: d.group_name ?? '',
    unit_name: d.unit_name ?? '',
  }))
  // Devices with an empty group_name haven't been configured yet by the institution admin.
  const assignedDevices = allAssigned.filter((d) => d.group_name.trim() !== '')
  const pendingSetupDevices = allAssigned.filter((d) => d.group_name.trim() === '')

  let unassignedDevices: UnassignedDevice[] = []
  let allInstitutions: Pick<InstitutionConfig, 'id' | 'name'>[] = []

  if (role === 'platform_admin') {
    const [unassignedRes, institutionsRes] = await Promise.all([
      supabase
        .from('devices')
        .select('id, mac, display_name')
        .is('institution_id', null)
        .order('id'),
      supabase
        .from('institutions')
        .select('id, name')
        .order('name'),
    ])
    unassignedDevices = (unassignedRes.data ?? []) as UnassignedDevice[]
    allInstitutions = (institutionsRes.data ?? []) as Pick<InstitutionConfig, 'id' | 'name'>[]
  }

  const meetingImpact = await loadMeetingImpact(assignedDevices.map((d) => d.id))

  return (
    <>
      <RealtimeRefresh />
      <DevicesView
        devices={assignedDevices}
        pendingSetupDevices={pendingSetupDevices}
        unassignedDevices={unassignedDevices}
        role={role}
        institution={institution}
        allInstitutions={allInstitutions}
        meetingImpact={meetingImpact}
      />
    </>
  )
}
