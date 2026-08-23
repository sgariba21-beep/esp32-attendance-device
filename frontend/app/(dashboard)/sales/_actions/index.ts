'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { evaluateReward } from '@/lib/loyalty/eligibility'
import { loadClientLoyaltyBundle } from '@/lib/loyalty/loader'
import { describeReward } from '@/lib/loyalty/describe'

type SaleItem = {
  productId: string | null
  serviceId: string | null
  itemName: string
  unitPrice: number
  quantity: number
  rewardId: string | null   // set when this line is a reward redemption (free item)
}

// A redemption the client wants applied to this sale.
//   'new'     — the client just became eligible; issue the reward and redeem
//               it against this sale in the same step.
//   'pending' — the client already holds an unredeemed grant (an IOU from an
//               earlier visit, or a standalone issuance) — redeem that
//               specific row rather than writing a new one.
type SaleRedemption = { origin: 'new' | 'pending'; rewardId: string; logId: string | null }

type CreateSaleInput = {
  clientId: string
  staffId: string | null
  note: string
  items: SaleItem[]
  redemptions: SaleRedemption[]
}

// ── Reward offers for the Sales dialog ──────────────────────────────────
// What can this client redeem right now? Two sources, both surfaced
// together so the cashier sees the full picture in one place:
//   - freshly eligible (evaluateReward says so, nothing issued yet)
//   - already granted, still unredeemed (rewards_log.transaction_id IS NULL)
export type RewardOffer = {
  key: string
  origin: 'new' | 'pending'
  rewardId: string
  logId: string | null
  name: string
  rewardKind: 'free_product' | 'free_service' | 'discount' | 'custom'
  rewardProductId: string | null
  rewardServiceId: string | null
  rewardValue: number | null
  description: string | null
  summary: string
}

export async function getClientRewardOffers(clientId: string): Promise<{ error: string | null; offers: RewardOffer[] }> {
  const session = await requireRole('super_admin', 'admin', 'cashier')
  const { institutionId, role } = session

  const supabase = createAdminClient()
  const { data: client } = await supabase.from('clients').select('institution_id, active').eq('id', clientId).single()
  if (!client) return { error: 'Client not found.', offers: [] }
  if (role !== 'platform_admin' && (!institutionId || client.institution_id !== institutionId)) {
    return { error: 'Not found.', offers: [] }
  }
  // Not directly reachable today (the Sales dialog's own client picker is
  // already filtered to active clients), but this action shouldn't compute
  // offers for an archived client even if called some other way.
  if (!client.active) return { error: null, offers: [] }

  const instId = client.institution_id as string
  const institution = await getInstitution(instId)

  // Loyalty master switch: no offers when the shop has it off. Not an error
  // — the Sales dialog just shows no reward panel.
  if (institution.type === 'shop' && !institution.loyalty_enabled && role !== 'platform_admin') {
    return { error: null, offers: [] }
  }

  const { rewards, events, issuances, productNames, serviceNames } = await loadClientLoyaltyBundle(supabase, instId, clientId)
  const currency = institution.currency
  const now = new Date()

  // A reward can point at a product/service that's been archived SINCE the
  // rule was created — catalogRefsValid() only checks that the id belongs
  // to this institution at save time, never that it's still active, and
  // archiving is a soft-delete that doesn't touch the reward's FK. Without
  // this check, a free_product/free_service offer can show as "eligible"
  // while Apply is silently unable to do anything (it can only zero an
  // existing cart line or add one from the active catalog — neither is
  // possible for an item that's no longer sellable).
  const [activeProductsRes, activeServicesRes] = await Promise.all([
    supabase.from('products').select('id').eq('institution_id', instId).eq('active', true),
    supabase.from('services').select('id').eq('institution_id', instId).eq('active', true),
  ])
  const activeProductIds = new Set((activeProductsRes.data ?? []).map((p) => p.id as string))
  const activeServiceIds = new Set((activeServicesRes.data ?? []).map((s) => s.id as string))

  function isCurrentlyRedeemable(kind: RewardOffer['rewardKind'], productId: string | null, serviceId: string | null): boolean {
    if (kind === 'free_product') return !!productId && activeProductIds.has(productId)
    if (kind === 'free_service') return !!serviceId && activeServiceIds.has(serviceId)
    return true  // discount / custom carry no catalog target
  }

  const offers: RewardOffer[] = []

  for (const reward of rewards) {
    const progress = evaluateReward(reward, events, issuances, now)
    if (!progress.eligible) continue
    if (!isCurrentlyRedeemable(reward.reward_kind, reward.reward_product_id, reward.reward_service_id)) continue
    offers.push({
      key: `new:${reward.id}`,
      origin: 'new',
      rewardId: reward.id,
      logId: null,
      name: reward.name,
      rewardKind: reward.reward_kind,
      rewardProductId: reward.reward_product_id,
      rewardServiceId: reward.reward_service_id,
      rewardValue: reward.reward_value,
      description: reward.description,
      summary: describeReward(reward, productNames, serviceNames, currency),
    })
  }

  const { data: pendingRows } = await supabase
    .from('rewards_log')
    .select('id, reward_id, issued_at, rewards(name, reward_kind, reward_product_id, reward_service_id, reward_value, description, active)')
    .eq('institution_id', instId)
    .eq('client_id', clientId)
    .is('transaction_id', null)
    .order('issued_at', { ascending: true })

  for (const row of (pendingRows ?? []) as unknown as {
    id: string
    reward_id: string
    rewards: {
      name: string
      reward_kind: RewardOffer['rewardKind']
      reward_product_id: string | null
      reward_service_id: string | null
      reward_value: number | null
      description: string | null
      active: boolean
    } | null
  }[]) {
    if (!row.rewards) continue  // reward row gone entirely — shouldn't happen, NO ACTION FK; defensive only
    // Archived since it was granted, or its target is no longer sellable —
    // either way it can't actually be redeemed at the till right now. It's
    // still a real outstanding grant (Reports' Outstanding column still
    // counts it), just not something this panel can offer to apply today.
    if (!row.rewards.active) continue
    if (!isCurrentlyRedeemable(row.rewards.reward_kind, row.rewards.reward_product_id, row.rewards.reward_service_id)) continue
    offers.push({
      key: `pending:${row.id}`,
      origin: 'pending',
      rewardId: row.reward_id,
      logId: row.id,
      name: row.rewards.name,
      rewardKind: row.rewards.reward_kind,
      rewardProductId: row.rewards.reward_product_id,
      rewardServiceId: row.rewards.reward_service_id,
      rewardValue: row.rewards.reward_value,
      description: row.rewards.description,
      summary: describeReward(row.rewards, productNames, serviceNames, currency),
    })
  }

  return { error: null, offers }
}

export async function createSale(input: CreateSaleInput) {
  const session = await requireRole('super_admin', 'admin', 'cashier')
  const { institutionId, role, user } = session

  if (input.items.length === 0) return { error: 'A sale must have at least one item.', id: null }

  const supabase = createAdminClient()

  // Verify client ownership inline (like logVisit).
  const { data: client } = await supabase
    .from('clients')
    .select('institution_id, active')
    .eq('id', input.clientId)
    .single()

  if (!client) return { error: 'Client not found.', id: null }
  if (role !== 'platform_admin' && (!institutionId || client.institution_id !== institutionId)) {
    return { error: 'Client not found.', id: null }
  }
  if (!client.active) return { error: 'Cannot create a sale for an archived client.', id: null }

  const effectiveInstitutionId = role === 'platform_admin' ? client.institution_id : institutionId!

  // Verify catalog items belong to this institution and are active.
  const productIds = input.items.map(i => i.productId).filter(Boolean) as string[]
  const serviceIds = input.items.map(i => i.serviceId).filter(Boolean) as string[]

  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('id, institution_id, active')
      .in('id', productIds)

    for (const pid of productIds) {
      const p = (products ?? []).find((r) => r.id === pid)
      if (!p || p.institution_id !== effectiveInstitutionId || !p.active) {
        return { error: 'One or more products are not available.', id: null }
      }
    }
  }

  if (serviceIds.length > 0) {
    const { data: services } = await supabase
      .from('services')
      .select('id, institution_id, active')
      .in('id', serviceIds)

    for (const sid of serviceIds) {
      const s = (services ?? []).find((r) => r.id === sid)
      if (!s || s.institution_id !== effectiveInstitutionId || !s.active) {
        return { error: 'One or more services are not available.', id: null }
      }
    }
  }

  // Verify staff member belongs to this institution (if provided).
  if (input.staffId) {
    const { data: member } = await supabase
      .from('members')
      .select('institution_id')
      .eq('id', input.staffId)
      .single()

    if (!member || member.institution_id !== effectiveInstitutionId) {
      return { error: 'Staff member not found.', id: null }
    }
  }

  // ── Reward redemptions — re-validated here, not trusted from the client ──
  // A stale "eligible" badge in the browser is not sufficient grounds to
  // write a reward or charge a reward's discount. Everything the client
  // proposes is re-checked against fresh data in this same request.
  type ValidatedRedemption = {
    origin: 'new' | 'pending'
    rewardId: string
    logId: string | null
    rewardKind: 'free_product' | 'free_service' | 'discount' | 'custom'
    rewardProductId: string | null
    rewardServiceId: string | null
    rewardValue: number | null
  }
  const validated: ValidatedRedemption[] = []

  if (input.redemptions.length > 0) {
    const rewardIds = [...new Set(input.redemptions.map((r) => r.rewardId))]
    const { data: rewardRows } = await supabase
      .from('rewards')
      .select(
        'id, institution_id, active, name, condition_type, condition_product_id, condition_service_id, condition_value, window_type, rolling_days, repeatable, reward_kind, reward_product_id, reward_service_id, reward_value',
      )
      .in('id', rewardIds)

    const rewardById = new Map((rewardRows ?? []).map((r) => [r.id as string, r]))

    // Loaded once, reused for every 'new' redemption's eligibility check —
    // a sale can apply several rewards at once.
    let bundle: Awaited<ReturnType<typeof loadClientLoyaltyBundle>> | null = null

    for (const r of input.redemptions) {
      const reward = rewardById.get(r.rewardId)
      if (!reward || reward.institution_id !== effectiveInstitutionId) {
        return { error: 'One or more rewards are not available.', id: null }
      }
      if (!reward.active) {
        return { error: `"${reward.name}" is no longer active.`, id: null }
      }

      if (r.origin === 'new') {
        if (!bundle) bundle = await loadClientLoyaltyBundle(supabase, effectiveInstitutionId, input.clientId)
        const progress = evaluateReward(reward, bundle.events, bundle.issuances, new Date())
        if (!progress.eligible) {
          return { error: `This client has not earned "${reward.name}" yet.`, id: null }
        }
      } else {
        if (!r.logId) return { error: 'Missing reward record reference.', id: null }
        const { data: logRow } = await supabase
          .from('rewards_log')
          .select('id, institution_id, client_id, reward_id, transaction_id')
          .eq('id', r.logId)
          .single()
        if (
          !logRow ||
          logRow.institution_id !== effectiveInstitutionId ||
          logRow.client_id !== input.clientId ||
          logRow.reward_id !== r.rewardId ||
          logRow.transaction_id !== null
        ) {
          return { error: `"${reward.name}" has already been redeemed or is no longer available.`, id: null }
        }
      }

      validated.push({
        origin: r.origin,
        rewardId: reward.id as string,
        logId: r.logId,
        rewardKind: reward.reward_kind as ValidatedRedemption['rewardKind'],
        rewardProductId: reward.reward_product_id as string | null,
        rewardServiceId: reward.reward_service_id as string | null,
        rewardValue: reward.reward_value as number | null,
      })
    }
  }

  const validatedByRewardId = new Map(validated.map((v) => [v.rewardId, v]))

  // A line tagged as a reward redemption must reference a reward that was
  // actually validated above, and its target/price must match — otherwise a
  // tampered request could mark a full-price item "free via reward" and
  // hide real revenue from reporting.
  for (const item of input.items) {
    if (!item.rewardId) continue
    const v = validatedByRewardId.get(item.rewardId)
    if (!v || (v.rewardKind !== 'free_product' && v.rewardKind !== 'free_service')) {
      return { error: 'A reward-tagged item does not match an applied reward.', id: null }
    }
    const targetMatches =
      (v.rewardKind === 'free_product' && item.productId === v.rewardProductId) ||
      (v.rewardKind === 'free_service' && item.serviceId === v.rewardServiceId)
    if (!targetMatches || item.unitPrice !== 0) {
      return { error: 'A reward-tagged item does not match an applied reward.', id: null }
    }
  }

  // Server computes the discount total from validated reward data — never
  // from a client-supplied number.
  const discountTotal = validated
    .filter((v) => v.rewardKind === 'discount')
    .reduce((sum, v) => sum + (v.rewardValue ?? 0), 0)

  const redemptionsPayload = validated.map((v) =>
    v.origin === 'new'
      ? { kind: 'new', reward_id: v.rewardId, value_snapshot: v.rewardValue, issued_by: user.id, note: null }
      : { kind: 'existing', log_id: v.logId, note: null },
  )

  // Fetch institution timezone for the attendance date computation in the RPC.
  const { data: inst } = await supabase
    .from('institutions')
    .select('timezone')
    .eq('id', effectiveInstitutionId)
    .single()

  const tz = (inst?.timezone as string | null) ?? 'Africa/Accra'

  // Call the atomic RPC — one Postgres transaction does the sale, the stock
  // decrements, the client_attendance upsert, AND every reward redemption.
  const { data: txId, error } = await supabase.rpc('create_sale', {
    p_institution_id: effectiveInstitutionId,
    p_client_id:      input.clientId,
    p_staff_id:       input.staffId ?? null,
    p_note:           input.note.trim() || null,
    p_items: input.items.map((i) => ({
      product_id: i.productId ?? null,
      service_id: i.serviceId ?? null,
      item_name:  i.itemName,
      unit_price: i.unitPrice,
      quantity:   i.quantity,
      reward_id:  i.rewardId ?? null,
    })),
    p_tz: tz,
    p_discount_total: discountTotal,
    p_redemptions: redemptionsPayload,
  })

  if (error) return { error: error.message, id: null }

  // T23: detect products that went below zero stock after this sale.
  // The sale is already recorded (create_sale is atomic); this is non-blocking
  // — we surface warnings in the UI but do not roll back.
  const soldProductIds = input.items
    .filter((i) => i.productId)
    .map((i) => i.productId as string)

  const warnings: string[] = []

  if (soldProductIds.length > 0) {
    const { data: lowStock } = await supabase
      .from('products')
      .select('name, stock')
      .in('id', soldProductIds)
      .lt('stock', 0)

    for (const p of lowStock ?? []) {
      warnings.push(
        `"${p.name}" is now at ${p.stock} units — stock is negative. Restock when possible.`
      )
    }
  }

  revalidatePath('/sales')
  revalidatePath('/clients')
  revalidatePath('/rewards')
  return { error: null, id: txId as string, warnings }
}
