// =====================================================================
// #6 — Loyalty eligibility engine (pure, framework-agnostic)
// =====================================================================
// Computes, for one client and one reward rule, how far the client has
// progressed toward the reward and whether they are eligible RIGHT NOW.
//
// Progress is derived ON THE FLY from raw events (visits, sale line items,
// sale totals) and the issuance log — there are NO materialised counters, so
// the answer is always consistent with the underlying history and a rule edit
// re-computes everything correctly.
//
// Window semantics (rewards.window_type):
//   • lifetime            — count everything, ever.
//   • rolling_days        — count events in the last N days (time-based).
//   • since_last_issuance — count events AFTER the client last received this
//                           reward (the punch-card: issuing resets the count).
//
// Repeatability (rewards.repeatable):
//   • false — earnable once. Once issued at all → "claimed", never eligible
//             again, regardless of window.
//   • true  — a punch-card. For lifetime windows we divide total ÷ threshold and
//             subtract what's already been issued, so a lifetime card can be
//             earned repeatedly without the window ever resetting. For the
//             time/issuance-bounded windows the window itself does the resetting.
//
// Pure: no I/O, no React, no Next — safe to import from a server action OR a
// client component. The caller supplies the already-loaded events + issuances.
// =====================================================================

export type ConditionType = 'service_count' | 'product_count' | 'visit_count' | 'total_amount_spent'
export type WindowType = 'lifetime' | 'rolling_days' | 'since_last_issuance'

export type RewardRule = {
  id: string
  condition_type: ConditionType
  condition_product_id: string | null
  condition_service_id: string | null
  condition_value: number | string
  window_type: WindowType
  rolling_days: number | null
  repeatable: boolean
}

// A single contributing event for this client.
//   visit   → value 1 (one check-in)
//   service → value = quantity, refId = service_id
//   product → value = quantity, refId = product_id
//   spend   → value = sale total
export type LoyaltyEvent = {
  kind: 'visit' | 'service' | 'product' | 'spend'
  value: number
  at: string            // ISO timestamp (the sale / visit instant)
  refId?: string | null // service_id / product_id, for scoped rules
}

export type Issuance = { reward_id: string; issued_at: string }

export type RewardProgress = {
  rewardId: string
  isAmount: boolean      // total_amount_spent → format progress/threshold as money
  progress: number       // progress within the CURRENT cycle, clamped to [0, threshold]
  threshold: number      // condition_value
  ratio: number          // progress / threshold, clamped to [0, 1] — for the bar
  eligible: boolean       // at least one reward is ready to issue now
  pending: number         // how many are ready right now (lifetime cards can stack)
  issuedCount: number     // lifetime count of times this client got this reward
  claimed: boolean        // non-repeatable reward already issued → done
  windowLabel: string
}

const DAY_MS = 86_400_000

export function describeWindowLabel(window: WindowType, rollingDays: number | null): string {
  switch (window) {
    case 'lifetime': return 'all time'
    case 'rolling_days': return `last ${rollingDays ?? '?'} days`
    case 'since_last_issuance': return 'since last issued'
  }
}

// Does this event count toward this rule (kind + optional product/service scope)?
function eventMatches(rule: RewardRule, e: LoyaltyEvent): boolean {
  switch (rule.condition_type) {
    case 'visit_count':
      return e.kind === 'visit'
    case 'total_amount_spent':
      return e.kind === 'spend'
    case 'service_count':
      return e.kind === 'service' && (!rule.condition_service_id || e.refId === rule.condition_service_id)
    case 'product_count':
      return e.kind === 'product' && (!rule.condition_product_id || e.refId === rule.condition_product_id)
  }
}

export function evaluateReward(
  rule: RewardRule,
  events: LoyaltyEvent[],
  issuances: Issuance[],
  now: Date = new Date(),
): RewardProgress {
  const threshold = Number(rule.condition_value)
  const isAmount = rule.condition_type === 'total_amount_spent'

  const relevant = events.filter((e) => eventMatches(rule, e))
  const lifetimeValue = relevant.reduce((sum, e) => sum + e.value, 0)

  const mine = issuances
    .filter((i) => i.reward_id === rule.id)
    .sort((a, b) => a.issued_at.localeCompare(b.issued_at))
  const issuedCount = mine.length
  const lastIssuedAt = issuedCount > 0 ? mine[issuedCount - 1].issued_at : null

  // Window cutoff (ms since epoch). null = no lower bound (count everything).
  let cutoff: number | null = null
  if (rule.window_type === 'rolling_days' && rule.rolling_days) {
    cutoff = now.getTime() - rule.rolling_days * DAY_MS
  } else if (rule.window_type === 'since_last_issuance') {
    cutoff = lastIssuedAt ? new Date(lastIssuedAt).getTime() : null
  }
  const windowValue = cutoff === null
    ? lifetimeValue
    : relevant.reduce((sum, e) => (new Date(e.at).getTime() > cutoff! ? sum + e.value : sum), 0)

  let eligible = false
  let pending = 0
  let claimed = false
  let progress = 0

  if (!rule.repeatable) {
    // Earnable once. Any past issuance closes it out forever.
    claimed = issuedCount > 0
    if (claimed) {
      progress = threshold
    } else {
      progress = Math.min(windowValue, threshold)
      eligible = windowValue >= threshold
      pending = eligible ? 1 : 0
    }
  } else if (rule.window_type === 'lifetime') {
    // Repeatable lifetime card: total ÷ threshold, minus what's been issued.
    const earned = threshold > 0 ? Math.floor(lifetimeValue / threshold) : 0
    pending = Math.max(0, earned - issuedCount)
    eligible = pending > 0
    progress = pending > 0
      ? threshold                              // a full card is waiting
      : lifetimeValue - earned * threshold     // leftover toward the next card
  } else {
    // rolling_days / since_last_issuance: the window itself does the resetting.
    progress = Math.min(windowValue, threshold)
    eligible = windowValue >= threshold
    pending = eligible ? 1 : 0
  }

  const ratio = threshold > 0 ? Math.min(1, Math.max(0, progress / threshold)) : 0

  return {
    rewardId: rule.id,
    isAmount,
    progress,
    threshold,
    ratio,
    eligible,
    pending,
    issuedCount,
    claimed,
    windowLabel: describeWindowLabel(rule.window_type, rule.rolling_days),
  }
}
