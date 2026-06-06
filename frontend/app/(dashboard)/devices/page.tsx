import { createAdminClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/supabase/dal'
import { DevicesView } from './_components/devices-view'
import type { Device } from '@/lib/types'

export default async function DevicesPage() {
  await verifySession()
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('devices')
    .select('id, form, class')
    .order('form')
    .order('class')

  return <DevicesView devices={(data ?? []) as Device[]} />
}
