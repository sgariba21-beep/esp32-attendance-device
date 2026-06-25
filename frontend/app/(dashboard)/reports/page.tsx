import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { ReportsView } from './_components/reports-view'
import type {
  DailyTakings,
  WeeklyTakings,
  ClientRevenue,
  StylistRevenue,
  PopularItem,
  VisitFreq,
  LowStockItem,
  RewardIssued,
} from './_components/reports-view'

export const dynamic = 'force-dynamic'

export const LOW_STOCK_THRESHOLD = 5

function getWeekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dow = date.getUTCDay()
  const offset = dow === 0 ? -6 : 1 - dow
  return new Date(date.getTime() + offset * 86400000).toISOString().slice(0, 10)
}

type TxRow = {
  id: string
  total: number
  created_at: string
  client_id: string
  staff_id: string | null
  clients: { name: string } | null
  members: { fullname: string } | null
}
type ItemRow = { item_name: string; product_id: string | null; service_id: string | null; quantity: number; line_total: number }
type VisitRow = { client_id: string; date: string; clients: { name: string } | null }
type ProductRow = { id: string; name: string; stock: number; price: number }
type RewardLogRow = { reward_id: string; issued_at: string; rewards: { name: string } | null }

export default async function ReportsPage() {
  const session = await requireRole('super_admin', 'admin')
  const { institutionId, role } = session
  const institution = await getInstitution(institutionId)

  if (institution.type !== 'shop' && role !== 'platform_admin') {
    redirect('/unauthorized')
  }

  const supabase = createAdminClient()
  const tz = institution.timezone ?? 'Africa/Accra'

  const [txRes, itemsRes, visitsRes, productsRes, rewardsLogRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, total, created_at, client_id, staff_id, clients(name), members(fullname)')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false }),
    supabase
      .from('transaction_items')
      .select('item_name, product_id, service_id, quantity, line_total')
      .eq('institution_id', institutionId),
    supabase
      .from('client_attendance')
      .select('client_id, date, clients(name)')
      .eq('institution_id', institutionId)
      .order('date', { ascending: false }),
    supabase
      .from('products')
      .select('id, name, stock, price')
      .eq('institution_id', institutionId)
      .eq('active', true)
      .lte('stock', LOW_STOCK_THRESHOLD)
      .order('stock', { ascending: true }),
    supabase
      .from('rewards_log')
      .select('reward_id, issued_at, rewards(name)')
      .eq('institution_id', institutionId)
      .order('issued_at', { ascending: false })
      .limit(500),
  ])

  const transactions = (txRes.data ?? []) as unknown as TxRow[]
  const items = (itemsRes.data ?? []) as unknown as ItemRow[]
  const visits = (visitsRes.data ?? []) as unknown as VisitRow[]
  const products = (productsRes.data ?? []) as unknown as ProductRow[]
  const rewardsLog = (rewardsLogRes.data ?? []) as unknown as RewardLogRow[]

  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })

  // Daily takings — last 30 days
  const cutoff30 = new Date(new Date(`${today}T00:00:00Z`).getTime() - 29 * 86400000)
    .toISOString().slice(0, 10)
  const dailyMap = new Map<string, { total: number; count: number }>()
  for (const tx of transactions) {
    const date = new Date(tx.created_at).toLocaleDateString('en-CA', { timeZone: tz })
    if (date >= cutoff30) {
      const e = dailyMap.get(date) ?? { total: 0, count: 0 }
      e.total += Number(tx.total)
      e.count++
      dailyMap.set(date, e)
    }
  }
  const dailyTakings: DailyTakings[] = [...dailyMap.entries()]
    .map(([date, { total, count }]) => ({ date, total, count }))
    .sort((a, b) => b.date.localeCompare(a.date))

  // Weekly takings — last 8 weeks (56 days)
  const cutoff8w = new Date(new Date(`${today}T00:00:00Z`).getTime() - 55 * 86400000)
    .toISOString().slice(0, 10)
  const weeklyMap = new Map<string, { total: number; count: number }>()
  for (const tx of transactions) {
    const date = new Date(tx.created_at).toLocaleDateString('en-CA', { timeZone: tz })
    if (date >= cutoff8w) {
      const weekStart = getWeekStart(date)
      const e = weeklyMap.get(weekStart) ?? { total: 0, count: 0 }
      e.total += Number(tx.total)
      e.count++
      weeklyMap.set(weekStart, e)
    }
  }
  const weeklyTakings: WeeklyTakings[] = [...weeklyMap.entries()]
    .map(([weekStart, { total, count }]) => ({ weekStart, total, count }))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))

  // Revenue per client — all-time
  const clientRevMap = new Map<string, { name: string; total: number; count: number }>()
  for (const tx of transactions) {
    const e = clientRevMap.get(tx.client_id) ?? { name: tx.clients?.name ?? '—', total: 0, count: 0 }
    e.total += Number(tx.total)
    e.count++
    clientRevMap.set(tx.client_id, e)
  }
  const clientRevenue: ClientRevenue[] = [...clientRevMap.entries()]
    .map(([clientId, { name, total, count }]) => ({ clientId, name, total, count }))
    .sort((a, b) => b.total - a.total)

  // Revenue per stylist — all-time
  const stylistRevMap = new Map<string, { name: string; total: number; count: number }>()
  for (const tx of transactions) {
    const key = tx.staff_id ?? '__none__'
    const existing = stylistRevMap.get(key)
    if (existing) {
      existing.total += Number(tx.total)
      existing.count++
    } else {
      stylistRevMap.set(key, {
        name: tx.staff_id ? (tx.members?.fullname ?? 'Unknown') : 'Unattributed',
        total: Number(tx.total),
        count: 1,
      })
    }
  }
  const stylistRevenue: StylistRevenue[] = [...stylistRevMap.entries()]
    .map(([key, { name, total, count }]) => ({
      stylistId: key === '__none__' ? null : key,
      name,
      total,
      count,
    }))
    .sort((a, b) => b.total - a.total)

  // Popular items — all-time, keyed by catalog id (falls back to item_name for snapshots without id)
  const itemStatsMap = new Map<string, { name: string; type: 'service' | 'product'; qty: number; revenue: number }>()
  for (const item of items) {
    const key = item.service_id ?? item.product_id ?? item.item_name
    const type: 'service' | 'product' = item.service_id ? 'service' : 'product'
    const e = itemStatsMap.get(key) ?? { name: item.item_name, type, qty: 0, revenue: 0 }
    e.qty += item.quantity
    e.revenue += Number(item.line_total)
    itemStatsMap.set(key, e)
  }
  const popularItems: PopularItem[] = [...itemStatsMap.values()]
    .sort((a, b) => b.revenue - a.revenue)

  // Visit frequency — all-time
  const visitFreqMap = new Map<string, { name: string; count: number; lastVisit: string }>()
  for (const v of visits) {
    const existing = visitFreqMap.get(v.client_id)
    if (existing) {
      existing.count++
      if (v.date > existing.lastVisit) existing.lastVisit = v.date
    } else {
      visitFreqMap.set(v.client_id, { name: v.clients?.name ?? '—', count: 1, lastVisit: v.date })
    }
  }
  const visitFreq: VisitFreq[] = [...visitFreqMap.values()]
    .sort((a, b) => b.count - a.count)

  // Low-stock — already filtered in the DB query (stock <= LOW_STOCK_THRESHOLD)
  const lowStock: LowStockItem[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    stock: p.stock,
    price: Number(p.price),
  }))

  // Rewards issued — all-time (capped at 500 rows; sufficient for single-shop scale)
  const rewardStatsMap = new Map<string, { name: string; count: number; lastIssued: string }>()
  for (const log of rewardsLog) {
    const existing = rewardStatsMap.get(log.reward_id)
    if (existing) {
      existing.count++
      if (log.issued_at > existing.lastIssued) existing.lastIssued = log.issued_at
    } else {
      rewardStatsMap.set(log.reward_id, {
        name: log.rewards?.name ?? '—',
        count: 1,
        lastIssued: log.issued_at,
      })
    }
  }
  const rewardsIssued: RewardIssued[] = [...rewardStatsMap.values()]
    .sort((a, b) => b.count - a.count)

  return (
    <ReportsView
      dailyTakings={dailyTakings}
      weeklyTakings={weeklyTakings}
      clientRevenue={clientRevenue}
      stylistRevenue={stylistRevenue}
      popularItems={popularItems}
      visitFreq={visitFreq}
      lowStock={lowStock}
      rewardsIssued={rewardsIssued}
      role={role}
    />
  )
}
