import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { DevicesView } from './_components/devices-view'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import type { Device } from '@/lib/types'

export default async function DevicesPage() {
  await requireRole('super_admin')
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('devices')
    .select('id, group_name, unit_name')
    .order('group_name')
    .order('unit_name')

  return (
    <>
      <RealtimeRefresh />
      <DevicesView devices={(data ?? []) as Device[]} />
    </>
  )
}
