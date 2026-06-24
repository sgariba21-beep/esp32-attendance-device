'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'

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

export async function issueReward(rewardId: string, clientId: string, note: string) {
  const session = await requireRole('super_admin', 'admin')
  const { institutionId, role, user } = session

  const supabase = createAdminClient()

  // Fetch the reward (need institution_id + reward_value for the snapshot + active).
  const { data: reward } = await supabase
    .from('rewards')
    .select('institution_id, reward_value, active')
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
  return { error: null }
}
