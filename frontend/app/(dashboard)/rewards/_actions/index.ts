'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'
import { evaluateReward } from '@/lib/loyalty/eligibility'
import type { LoyaltyEvent, Issuance } from '@/lib/loyalty/eligibility'
import { loadClientLoyaltyBundle } from '@/lib/loyalty/loader'

type ConditionType = 'service_count' | 'product_count' | 'visit_count' | 'total_amount_spent'
type WindowType = 'lifetime' | 'rolling_days' | 'since_last_issuance'
type RewardKind = 'free_product' | 'free_service' | 'discount' | 'custom'

export type RewardInput = {
  name: string
  condition_type: ConditionType
  condition_product_id: string | null
  condition_service_id: string | null
  condition_value: number
  window_type: WindowType
  rolling_days: number | null
  repeatable: boolean
  reward_kind: RewardKind
  reward_product_id: string | null
  reward_service_id: string | null
  reward_value: number | null
  description: string | null
}

type CleanReward = NonNullable<ReturnType<typeof sanitize>['clean']>

// Force the payload to satisfy the DB CHECK constraints regardless of stale
// fields left over from a user switching dropdowns mid-edit.
function sanitize(input: RewardInput) {
  const name = input.name.trim()
  if (!name) return { error: 'Name is required.', clean: null }

  if (!(input.condition_value > 0)) return { error: 'Condition value must be greater than 0.', clean: null }

  // Scope ids only valid for the matching count condition.
  const condition_product_id = input.condition_type === 'product_count' ? input.condition_product_id : null
  const condition_service_id = input.condition_type === 'service_count' ? input.condition_service_id : null

  // rolling_days present iff rolling window.
  let rolling_days: number | null = null
  if (input.window_type === 'rolling_days') {
    if (!input.rolling_days || input.rolling_days < 1) {
      return { error: 'Rolling window needs a day count of 1 or more.', clean: null }
    }
    rolling_days = Math.floor(input.rolling_days)
  }

  // Payload column required per reward_kind; null the others.
  let reward_product_id: string | null = null
  let reward_service_id: string | null = null
  let reward_value: number | null = null
  switch (input.reward_kind) {
    case 'free_product':
      if (!input.reward_product_id) return { error: 'Pick the free product.', clean: null }
      reward_product_id = input.reward_product_id
      break
    case 'free_service':
      if (!input.reward_service_id) return { error: 'Pick the free service.', clean: null }
      reward_service_id = input.reward_service_id
      break
    case 'discount':
      if (input.reward_value == null || input.reward_value < 0) return { error: 'Enter a discount amount of 0 or more.', clean: null }
      reward_value = input.reward_value
      break
    case 'custom':
      break
  }

  return {
    error: null,
    clean: {
      name,
      condition_type: input.condition_type,
      condition_product_id,
      condition_service_id,
      condition_value: input.condition_value,
      window_type: input.window_type,
      rolling_days,
      repeatable: input.repeatable,
      reward_kind: input.reward_kind,
      reward_product_id,
      reward_service_id,
      reward_value,
      description: input.description?.trim() || null,
    },
  }
}

// Every referenced catalog id must belong to this institution (the FKs are
// NO ACTION and cross-tenant ids would otherwise slip through).
async function catalogRefsValid(
  supabase: ReturnType<typeof createAdminClient>,
  institutionId: string,
  clean: CleanReward,
): Promise<boolean> {
  const productIds = [clean.condition_product_id, clean.reward_product_id].filter(Boolean) as string[]
  const serviceIds = [clean.condition_service_id, clean.reward_service_id].filter(Boolean) as string[]

  if (productIds.length > 0) {
    const { data } = await supabase.from('products').select('id').eq('institution_id', institutionId).in('id', productIds)
    if ((data?.length ?? 0) !== new Set(productIds).size) return false
  }
  if (serviceIds.length > 0) {
    const { data } = await supabase.from('services').select('id').eq('institution_id', institutionId).in('id', serviceIds)
    if ((data?.length ?? 0) !== new Set(serviceIds).size) return false
  }
  return true
}

export async function createReward(input: RewardInput) {
  const session = await requireRole('super_admin', 'admin')
  const { institutionId } = session
  if (!institutionId) return { error: 'No institution context.', id: null }

  const { error: vErr, clean } = sanitize(input)
  if (vErr || !clean) return { error: vErr, id: null }

  const supabase = createAdminClient()
  if (!(await catalogRefsValid(supabase, institutionId, clean))) {
    return { error: 'A referenced product or service is not available.', id: null }
  }

  const { data: row, error } = await supabase
    .from('rewards')
    .insert({ ...clean, institution_id: institutionId })
    .select('id')
    .single()

  if (error) return { error: error.message, id: null }

  revalidatePath('/rewards')
  return { error: null, id: row.id as string }
}

export async function updateReward(id: string, input: RewardInput) {
  const session = await requireRole('super_admin', 'admin')
  if (!(await ownsRecord('rewards', id, session))) return { error: 'Not found.' }

  const { error: vErr, clean } = sanitize(input)
  if (vErr || !clean) return { error: vErr }

  const supabase = createAdminClient()
  // Ownership is already confirmed; institutionId is the caller's for non-platform,
  // but platform_admin may edit cross-tenant — re-derive from the row.
  const { data: existing } = await supabase.from('rewards').select('institution_id').eq('id', id).single()
  const institutionId = existing?.institution_id as string | undefined
  if (!institutionId) return { error: 'Not found.' }

  if (!(await catalogRefsValid(supabase, institutionId, clean))) {
    return { error: 'A referenced product or service is not available.' }
  }

  const { error } = await supabase
    .from('rewards')
    .update({ ...clean, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/rewards')
  return { error: null }
}

export async function setRewardActive(id: string, active: boolean) {
  const session = await requireRole('super_admin', 'admin')
  if (!(await ownsRecord('rewards', id, session))) return { error: 'Not found.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('rewards')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/rewards')
  return { error: null }
}

// Grants a reward the client has genuinely earned — this is a STANDALONE
// grant (transaction_id left null), for the "you've earned this, come
// redeem it next time" case. The common "they qualified and they're buying
// right now" case goes through createSale's redemption path instead, which
// issues and redeems in one atomic step.
//
// Cashiers can call this (same trust level as recording a sale — real money
// already flows through their hands unsupervised). What makes this safe is
// that eligibility is re-checked against fresh data right here, immediately
// before the insert — nobody, cashier or admin, can grant a reward nobody
// has actually earned. That's the fix for the earlier gap where this action
// wrote a rewards_log row on request with no eligibility check at all.
export async function issueReward(rewardId: string, clientId: string, note: string) {
  const session = await requireRole('super_admin', 'admin', 'cashier')
  const { institutionId, role, user } = session

  const supabase = createAdminClient()

  // Fetch the full reward row — eligibility needs the condition/window
  // fields, not just reward_value.
  const { data: reward } = await supabase
    .from('rewards')
    .select(
      'id, institution_id, name, condition_type, condition_product_id, condition_service_id, condition_value, window_type, rolling_days, repeatable, reward_kind, reward_product_id, reward_service_id, reward_value, active',
    )
    .eq('id', rewardId)
    .single()

  if (!reward) return { error: 'Reward not found.' }
  if (role !== 'platform_admin' && (!institutionId || reward.institution_id !== institutionId)) {
    return { error: 'Reward not found.' }
  }
  if (!reward.active) return { error: 'Cannot issue an archived reward.' }

  const effectiveInstitutionId = reward.institution_id as string

  // Client must belong to the same institution.
  const { data: client } = await supabase
    .from('clients')
    .select('institution_id, active')
    .eq('id', clientId)
    .single()

  if (!client || client.institution_id !== effectiveInstitutionId) return { error: 'Client not found.' }
  if (!client.active) return { error: 'Cannot issue a reward to an archived client.' }

  // Re-run eligibility against fresh data. A stale client-side "eligible"
  // badge is not sufficient grounds to write a reward — this is the
  // authoritative check.
  const bundle = await loadClientLoyaltyBundle(supabase, effectiveInstitutionId, clientId)
  const progress = evaluateReward(reward, bundle.events, bundle.issuances, new Date())
  if (!progress.eligible) {
    return { error: 'This client has not earned this reward yet.' }
  }

  const { error } = await supabase.from('rewards_log').insert({
    institution_id: effectiveInstitutionId,
    client_id: clientId,
    reward_id: rewardId,
    trigger_source: 'manual',
    value_snapshot: reward.reward_value ?? null,
    issued_by: user.id,
    note: note.trim() || null,
  })

  if (error) return { error: error.message }

  revalidatePath('/rewards')
  revalidatePath('/clients')
  revalidatePath('/sales')
  return { error: null }
}

// Which currently-active clients have actually earned this ONE reward right
// now? Backs the Rules-tab Issue dialog so it can't be pointed at someone
// who hasn't qualified — the previous version showed every client with no
// eligibility signal at all, which is how a reward could be handed to the
// wrong person by simple mis-click.
//
// Single institution-wide pass rather than one query per client: fetch just
// the ONE event stream this rule's condition_type cares about (mirrors
// loadClientLoyaltyBundle's per-client version), group by client_id, then
// evaluate in memory. Fine at single-location scale per the standing
// eligibility-queries invariant — this never runs more than once per dialog
// open, on a set of rows bounded by one shop's history.
export async function getEligibleClientsForReward(rewardId: string): Promise<{ error: string | null; eligibleClientIds: string[] }> {
  const session = await requireRole('super_admin', 'admin')
  const { institutionId, role } = session

  const supabase = createAdminClient()

  const { data: reward } = await supabase
    .from('rewards')
    .select(
      'id, institution_id, condition_type, condition_product_id, condition_service_id, condition_value, window_type, rolling_days, repeatable, active',
    )
    .eq('id', rewardId)
    .single()

  if (!reward) return { error: 'Reward not found.', eligibleClientIds: [] }
  if (role !== 'platform_admin' && (!institutionId || reward.institution_id !== institutionId)) {
    return { error: 'Reward not found.', eligibleClientIds: [] }
  }

  const instId = reward.institution_id as string
  const eventsByClient = new Map<string, LoyaltyEvent[]>()
  const push = (clientId: string, event: LoyaltyEvent) => {
    const list = eventsByClient.get(clientId)
    if (list) list.push(event)
    else eventsByClient.set(clientId, [event])
  }

  if (reward.condition_type === 'visit_count') {
    const { data } = await supabase.from('client_attendance').select('client_id, date').eq('institution_id', instId)
    for (const a of data ?? []) push(a.client_id as string, { kind: 'visit', value: 1, at: `${a.date as string}T12:00:00.000Z` })
  } else if (reward.condition_type === 'total_amount_spent') {
    const { data } = await supabase.from('transactions').select('client_id, total, created_at').eq('institution_id', instId)
    for (const t of data ?? []) push(t.client_id as string, { kind: 'spend', value: Number(t.total), at: t.created_at as string })
  } else {
    // service_count / product_count — same reward-compounding exclusion as
    // loadClientLoyaltyBundle: a line redeemed AS a reward doesn't count
    // toward earning the next one. Fetched unscoped and filtered in memory
    // (rather than branching the query builder itself) — this is a bounded,
    // single-shop dataset, and a static query chain keeps Supabase's
    // generic filter-builder type simple instead of trying to unify two
    // different conditionally-built chains.
    const isService = reward.condition_type === 'service_count'
    const scopeId = isService ? reward.condition_service_id : reward.condition_product_id

    const { data } = await supabase
      .from('transaction_items')
      .select('product_id, service_id, quantity, reward_id, transactions!inner(institution_id, created_at, client_id)')
      .eq('institution_id', instId)
      .is('reward_id', null)

    for (const it of (data ?? []) as unknown as {
      product_id: string | null
      service_id: string | null
      quantity: number
      transactions: { client_id: string; created_at: string } | { client_id: string; created_at: string }[] | null
    }[]) {
      const refId = isService ? it.service_id : it.product_id
      if (!refId) continue                       // the other kind of line — not relevant to this rule
      if (scopeId && refId !== scopeId) continue  // scoped rule, different catalog item
      const parent = Array.isArray(it.transactions) ? it.transactions[0] : it.transactions
      if (!parent) continue
      push(parent.client_id, { kind: isService ? 'service' : 'product', value: Number(it.quantity), at: parent.created_at, refId })
    }
  }

  const issuancesByClient = new Map<string, Issuance[]>()
  const { data: logRows } = await supabase
    .from('rewards_log')
    .select('client_id, reward_id, issued_at')
    .eq('institution_id', instId)
    .eq('reward_id', rewardId)
  for (const l of logRows ?? []) {
    const list = issuancesByClient.get(l.client_id as string)
    const entry = { reward_id: l.reward_id as string, issued_at: l.issued_at as string }
    if (list) list.push(entry)
    else issuancesByClient.set(l.client_id as string, [entry])
  }

  const now = new Date()
  const eligibleClientIds: string[] = []
  for (const [clientId, events] of eventsByClient) {
    const progress = evaluateReward(reward, events, issuancesByClient.get(clientId) ?? [], now)
    if (progress.eligible) eligibleClientIds.push(clientId)
  }

  return { error: null, eligibleClientIds }
}
