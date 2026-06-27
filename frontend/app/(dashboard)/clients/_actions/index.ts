'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'
import { normalizePhone } from '@/lib/utils'
import { evaluateReward } from '@/lib/loyalty/eligibility'
import type { LoyaltyEvent, Issuance, RewardProgress } from '@/lib/loyalty/eligibility'

export async function createClient(data: { name: string; phone: string; area_of_residence: string }) {
  const session = await requireRole('super_admin', 'admin', 'cashier')
  const { institutionId } = session
  if (!institutionId) return { error: 'No institution context.', id: null }

  const phone = normalizePhone(data.phone)
  if (!phone) return { error: 'Invalid phone number. Use 0XXXXXXXXX or +233XXXXXXXXX format.', id: null }

  const supabase = createAdminClient()
  const { data: row, error } = await supabase
    .from('clients')
    .insert({
      institution_id: institutionId,
      name: data.name.trim(),
      phone,
      area_of_residence: data.area_of_residence.trim() || null,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'A client with that phone number already exists.', id: null }
    return { error: error.message, id: null }
  }

  revalidatePath('/clients')
  return { error: null, id: row.id as string }
}

export async function updateClient(id: string, data: { name: string; phone: string; area_of_residence: string }) {
  const session = await requireRole('super_admin', 'admin', 'cashier')
  if (!(await ownsRecord('clients', id, session))) return { error: 'Not found.' }

  const phone = normalizePhone(data.phone)
  if (!phone) return { error: 'Invalid phone number. Use 0XXXXXXXXX or +233XXXXXXXXX format.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('clients')
    .update({
      name: data.name.trim(),
      phone,
      area_of_residence: data.area_of_residence.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'Another client with that phone number already exists.' }
    return { error: error.message }
  }

  revalidatePath('/clients')
  return { error: null }
}

// Cashier cannot archive or restore clients.
export async function setClientActive(id: string, active: boolean) {
  const session = await requireRole('super_admin', 'admin')
  if (!(await ownsRecord('clients', id, session))) return { error: 'Not found.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('clients')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/clients')
  return { error: null }
}

export async function logVisit(clientId: string) {
  const session = await requireRole('super_admin', 'admin', 'cashier')
  const { institutionId, role } = session

  const supabase = createAdminClient()
  const { data: client } = await supabase
    .from('clients')
    .select('institution_id, active')
    .eq('id', clientId)
    .single()

  if (!client) return { error: 'Client not found.', alreadyLogged: false }
  if (role !== 'platform_admin' && (!institutionId || client.institution_id !== institutionId)) {
    return { error: 'Not found.', alreadyLogged: false }
  }
  if (!client.active) return { error: 'Cannot log a visit for an archived client.', alreadyLogged: false }

  const { data: inst } = await supabase
    .from('institutions')
    .select('timezone')
    .eq('id', client.institution_id)
    .single()

  const tz = (inst?.timezone as string | null) ?? 'Africa/Accra'
  const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: tz })

  const { data, error } = await supabase
    .from('client_attendance')
    .upsert(
      { institution_id: client.institution_id, client_id: clientId, date: todayDate },
      { onConflict: 'institution_id,client_id,date', ignoreDuplicates: true },
    )
    .select('id')

  if (error) return { error: error.message, alreadyLogged: false }

  revalidatePath('/clients')
  return { error: null, alreadyLogged: (data?.length ?? 0) === 0 }
}

// #6 — per-client loyalty progress. Mirrors the reward row shape the rewards
// page uses so the client dialog can reuse describeCondition/describeReward.
export type LoyaltyRewardRow = {
  id: string
  institution_id: string
  name: string
  condition_type: 'service_count' | 'product_count' | 'visit_count' | 'total_amount_spent'
  condition_product_id: string | null
  condition_service_id: string | null
  condition_value: number
  window_type: 'lifetime' | 'rolling_days' | 'since_last_issuance'
  rolling_days: number | null
  repeatable: boolean
  reward_kind: 'free_product' | 'free_service' | 'discount' | 'custom'
  reward_product_id: string | null
  reward_service_id: string | null
  reward_value: number | null
  active: boolean
  description: string | null
  created_at: string
}

export type ClientLoyalty = {
  error: string | null
  currency: string
  productNames: Record<string, string>
  serviceNames: Record<string, string>
  items: { reward: LoyaltyRewardRow; progress: RewardProgress }[]
}

const REWARD_COLS =
  'id, institution_id, name, condition_type, condition_product_id, condition_service_id, condition_value, window_type, rolling_days, repeatable, reward_kind, reward_product_id, reward_service_id, reward_value, active, description, created_at'

export async function getClientLoyalty(clientId: string): Promise<ClientLoyalty> {
  const session = await requireRole('super_admin', 'admin', 'cashier')
  const { institutionId, role } = session
  const empty: ClientLoyalty = { error: null, currency: 'GHS', productNames: {}, serviceNames: {}, items: [] }

  const supabase = createAdminClient()
  const { data: client } = await supabase
    .from('clients')
    .select('institution_id')
    .eq('id', clientId)
    .single()

  if (!client) return { ...empty, error: 'Client not found.' }
  if (role !== 'platform_admin' && (!institutionId || client.institution_id !== institutionId)) {
    return { ...empty, error: 'Not found.' }
  }

  const instId = client.institution_id as string
  const institution = await getInstitution(instId)
  const currency = institution.currency

  // Loyalty master switch (#5): no progress surface when loyalty is off.
  if (institution.type === 'shop' && !institution.loyalty_enabled && role !== 'platform_admin') {
    return { ...empty, currency, error: 'Loyalty is disabled.' }
  }

  const [rewardsRes, attRes, txRes, itemRes, logRes, prodRes, svcRes] = await Promise.all([
    supabase.from('rewards').select(REWARD_COLS).eq('institution_id', instId).eq('active', true).order('name'),
    supabase.from('client_attendance').select('created_at').eq('institution_id', instId).eq('client_id', clientId),
    supabase.from('transactions').select('total, created_at').eq('institution_id', instId).eq('client_id', clientId),
    supabase
      .from('transaction_items')
      .select('product_id, service_id, quantity, transactions!inner(created_at, client_id)')
      .eq('institution_id', instId)
      .eq('transactions.client_id', clientId),
    supabase.from('rewards_log').select('reward_id, issued_at').eq('institution_id', instId).eq('client_id', clientId),
    supabase.from('products').select('id, name').eq('institution_id', instId),
    supabase.from('services').select('id, name').eq('institution_id', instId),
  ])

  const rewards = (rewardsRes.data ?? []) as unknown as LoyaltyRewardRow[]
  if (rewards.length === 0) return { ...empty, currency }

  const events: LoyaltyEvent[] = []
  for (const a of attRes.data ?? []) {
    events.push({ kind: 'visit', value: 1, at: a.created_at as string })
  }
  for (const t of txRes.data ?? []) {
    events.push({ kind: 'spend', value: Number(t.total), at: t.created_at as string })
  }
  for (const it of (itemRes.data ?? []) as unknown as {
    product_id: string | null
    service_id: string | null
    quantity: number
    transactions: { created_at: string } | { created_at: string }[] | null
  }[]) {
    const parent = Array.isArray(it.transactions) ? it.transactions[0] : it.transactions
    const at = parent?.created_at
    if (!at) continue
    if (it.service_id) events.push({ kind: 'service', value: Number(it.quantity), at, refId: it.service_id })
    else if (it.product_id) events.push({ kind: 'product', value: Number(it.quantity), at, refId: it.product_id })
  }

  const issuances = (logRes.data ?? []) as unknown as Issuance[]

  const productNames: Record<string, string> = Object.fromEntries(
    (prodRes.data ?? []).map((p) => [p.id as string, p.name as string]),
  )
  const serviceNames: Record<string, string> = Object.fromEntries(
    (svcRes.data ?? []).map((s) => [s.id as string, s.name as string]),
  )

  const now = new Date()
  const items = rewards.map((reward) => ({
    reward,
    progress: evaluateReward(reward, events, issuances, now),
  }))

  return { error: null, currency, productNames, serviceNames, items }
}
