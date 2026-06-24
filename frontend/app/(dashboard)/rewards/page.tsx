import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { RewardsView } from './_components/rewards-view'
import type { Reward, CatalogLite, ClientLite, LogEntry } from './_components/rewards-view'

export default async function RewardsPage() {
  const session = await requireRole('super_admin', 'admin')
  const { institutionId, role } = session
  const institution = await getInstitution(institutionId)

  if (institution.type !== 'shop' && role !== 'platform_admin') {
    redirect('/unauthorized')
  }

  const supabase = createAdminClient()

  let rewardsQ = supabase
    .from('rewards')
    .select('id, institution_id, name, condition_type, condition_product_id, condition_service_id, condition_value, window_type, rolling_days, repeatable, reward_kind, reward_product_id, reward_service_id, reward_value, active, description, created_at')
    .order('name')

  // Fetch ALL catalog rows (incl. archived) so describe() can resolve names of
  // items a reward references even after they're archived.
  let productsQ = supabase.from('products').select('id, name, price, active').order('name')
  let servicesQ = supabase.from('services').select('id, name, price, active').order('name')

  let clientsQ = supabase
    .from('clients')
    .select('id, name, phone')
    .eq('active', true)
    .order('name')

  let logQ = supabase
    .from('rewards_log')
    .select('id, issued_at, trigger_source, value_snapshot, note, issued_by, clients(name, phone), rewards(name)')
    .order('issued_at', { ascending: false })
    .limit(200)

  if (institutionId) {
    rewardsQ  = rewardsQ.eq('institution_id', institutionId)
    productsQ = productsQ.eq('institution_id', institutionId)
    servicesQ = servicesQ.eq('institution_id', institutionId)
    clientsQ  = clientsQ.eq('institution_id', institutionId)
    logQ      = logQ.eq('institution_id', institutionId)
  }

  const [rewardsRes, productsRes, servicesRes, clientsRes, logRes] = await Promise.all([
    rewardsQ, productsQ, servicesQ, clientsQ, logQ,
  ])

  const allProducts = (productsRes.data ?? []) as { id: string; name: string; price: number; active: boolean }[]
  const allServices = (servicesRes.data ?? []) as { id: string; name: string; price: number; active: boolean }[]

  const productNames: Record<string, string> = Object.fromEntries(allProducts.map((p) => [p.id, p.name]))
  const serviceNames: Record<string, string> = Object.fromEntries(allServices.map((s) => [s.id, s.name]))

  const activeProducts: CatalogLite[] = allProducts.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, price: Number(p.price) }))
  const activeServices: CatalogLite[] = allServices.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, price: Number(s.price) }))

  // Resolve issued_by → email (email lives in auth.users, not profiles).
  const rawLog = (logRes.data ?? []) as unknown as (Omit<LogEntry, 'issued_by_email'> & { issued_by: string | null })[]
  const emailMap = new Map<string, string>()
  const issuerIds = new Set(rawLog.map((e) => e.issued_by).filter(Boolean) as string[])
  if (issuerIds.size > 0) {
    const { data: authData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    for (const u of authData?.users ?? []) {
      if (u.email) emailMap.set(u.id, u.email)
    }
  }

  const log: LogEntry[] = rawLog.map((e) => ({
    id: e.id,
    issued_at: e.issued_at,
    trigger_source: e.trigger_source,
    value_snapshot: e.value_snapshot,
    note: e.note,
    clients: e.clients,
    rewards: e.rewards,
    issued_by_email: e.issued_by ? (emailMap.get(e.issued_by) ?? null) : null,
  }))

  return (
    <RewardsView
      rewards={(rewardsRes.data ?? []) as unknown as Reward[]}
      products={activeProducts}
      services={activeServices}
      clients={(clientsRes.data ?? []) as unknown as ClientLite[]}
      log={log}
      productNames={productNames}
      serviceNames={serviceNames}
      timezone={institution.timezone}
      role={role}
    />
  )
}
