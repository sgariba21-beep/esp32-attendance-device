// =====================================================================
// Human-readable reward summaries — shared across rewards-view, the
// client Loyalty dialog, and the Sales dialog's reward-offer panel.
//
// Previously lived only in rewards-view.tsx ('use client'); moved here so
// the Sales dialog's SERVER action (getClientRewardOffers) can build the
// same "Free Wash" / "GHS 20 off" text it shows in the UI, without either
// importing from a client component module or re-implementing the format
// a third time.
// =====================================================================

import { formatMoney } from '@/lib/utils'
import type { LoyaltyRewardRow } from './loader'

export function describeCondition(
  r: Pick<LoyaltyRewardRow, 'condition_type' | 'condition_product_id' | 'condition_service_id' | 'condition_value'>,
  productNames: Record<string, string>,
  serviceNames: Record<string, string>,
  currency: string,
): string {
  const n = r.condition_type === 'total_amount_spent' ? r.condition_value : Math.round(r.condition_value)
  switch (r.condition_type) {
    case 'visit_count':
      return `${n} visit${n !== 1 ? 's' : ''}`
    case 'service_count':
      return r.condition_service_id
        ? `${n} × ${serviceNames[r.condition_service_id] ?? 'service'}`
        : `${n} service${n !== 1 ? 's' : ''}`
    case 'product_count':
      return r.condition_product_id
        ? `${n} × ${productNames[r.condition_product_id] ?? 'product'}`
        : `${n} product${n !== 1 ? 's' : ''}`
    case 'total_amount_spent':
      return `Spend ${formatMoney(r.condition_value, currency)}`
  }
}

export function describeWindow(r: Pick<LoyaltyRewardRow, 'window_type' | 'rolling_days'>): string {
  switch (r.window_type) {
    case 'lifetime': return 'all time'
    case 'rolling_days': return `last ${r.rolling_days} days`
    case 'since_last_issuance': return 'since last issued'
  }
}

export function describeReward(
  r: Pick<LoyaltyRewardRow, 'reward_kind' | 'reward_product_id' | 'reward_service_id' | 'reward_value' | 'description'>,
  productNames: Record<string, string>,
  serviceNames: Record<string, string>,
  currency: string,
): string {
  switch (r.reward_kind) {
    case 'free_product':
      return `Free ${r.reward_product_id ? (productNames[r.reward_product_id] ?? 'product') : 'product'}`
    case 'free_service':
      return `Free ${r.reward_service_id ? (serviceNames[r.reward_service_id] ?? 'service') : 'service'}`
    case 'discount':
      return `${formatMoney(r.reward_value ?? 0, currency)} off`
    case 'custom':
      return r.description || 'Custom reward'
  }
}
