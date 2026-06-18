import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { DevicesView } from './_components/devices-view'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import type { Device, UnassignedDevice, InstitutionConfig } from '@/lib/types'

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
      />
    </>
  )
}
