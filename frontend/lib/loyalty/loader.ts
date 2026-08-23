// =====================================================================
// Shared loyalty data loader — one client's rewards + events + issuances
// =====================================================================
// Extracted from getClientLoyalty so the same event-building logic backs
// every surface that needs it: the client Loyalty dialog, the Sales
// dialog's reward-offer panel, and issueReward's server-side eligibility
// check. One implementation means a fix (rounding, the visit-date bug,
// the reward-line exclusion below) lands everywhere at once instead of
// drifting across three copies.
//
// Callers own auth/session/institution checks — this module only fetches
// and shapes data for one already-verified (institutionId, clientId) pair.
// =====================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LoyaltyEvent, Issuance } from './eligibility'

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

export const REWARD_COLS =
  'id, institution_id, name, condition_type, condition_product_id, condition_service_id, condition_value, window_type, rolling_days, repeatable, reward_kind, reward_product_id, reward_service_id, reward_value, active, description, created_at'

export type LoyaltyBundle = {
  rewards: LoyaltyRewardRow[]
  events: LoyaltyEvent[]
  issuances: Issuance[]
  productNames: Record<string, string>
  serviceNames: Record<string, string>
}

/** All active reward rules + one client's full event history + their issuance log. */
export async function loadClientLoyaltyBundle(
  supabase: SupabaseClient,
  instId: string,
  clientId: string,
): Promise<LoyaltyBundle> {
  const [rewardsRes, attRes, txRes, itemRes, logRes, prodRes, svcRes] = await Promise.all([
    supabase.from('rewards').select(REWARD_COLS).eq('institution_id', instId).eq('active', true).order('name'),
    // `date` is the Accra business day client_attendance exists to capture;
    // created_at is the raw insert instant and can land on the wrong side of
    // a rolling-window boundary near midnight.
    supabase.from('client_attendance').select('date').eq('institution_id', instId).eq('client_id', clientId),
    supabase.from('transactions').select('total, created_at').eq('institution_id', instId).eq('client_id', clientId),
    supabase
      .from('transaction_items')
      .select('product_id, service_id, quantity, reward_id, transactions!inner(created_at, client_id)')
      .eq('institution_id', instId)
      .eq('transactions.client_id', clientId),
    supabase.from('rewards_log').select('reward_id, issued_at').eq('institution_id', instId).eq('client_id', clientId),
    supabase.from('products').select('id, name').eq('institution_id', instId),
    supabase.from('services').select('id, name').eq('institution_id', instId),
  ])

  const rewards = (rewardsRes.data ?? []) as unknown as LoyaltyRewardRow[]

  const events: LoyaltyEvent[] = []
  for (const a of attRes.data ?? []) {
    // Anchor at noon so a plain YYYY-MM-DD parses to the same calendar day
    // everywhere, regardless of the reader's local timezone.
    events.push({ kind: 'visit', value: 1, at: `${a.date as string}T12:00:00.000Z` })
  }
  for (const t of txRes.data ?? []) {
    events.push({ kind: 'spend', value: Number(t.total), at: t.created_at as string })
  }
  for (const it of (itemRes.data ?? []) as unknown as {
    product_id: string | null
    service_id: string | null
    quantity: number
    reward_id: string | null
    transactions: { created_at: string } | { created_at: string }[] | null
  }[]) {
    // A line redeemed AS a reward shouldn't count toward earning the NEXT
    // one — a free item was given, not bought, and letting it count would
    // let rewards compound into more rewards.
    if (it.reward_id) continue
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

  return { rewards, events, issuances, productNames, serviceNames }
}
