'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { SingleSelect } from '@/components/ui/single-select'
import { formatMoney } from '@/lib/utils'
import { createReward, updateReward, type RewardInput } from '../_actions'
import type { Reward, CatalogLite } from './rewards-view'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  reward: Reward | null
  products: CatalogLite[]   // active only
  services: CatalogLite[]   // active only
  currency: string
}

type FormState = {
  name: string
  condition_type: RewardInput['condition_type']
  condition_product_id: string
  condition_service_id: string
  condition_value: string
  window_type: RewardInput['window_type']
  rolling_days: string
  repeatable: boolean
  reward_kind: RewardInput['reward_kind']
  reward_product_id: string
  reward_service_id: string
  reward_value: string
  description: string
}

const emptyForm: FormState = {
  name: '',
  condition_type: 'service_count',
  condition_product_id: '',
  condition_service_id: '',
  condition_value: '',
  window_type: 'since_last_issuance',
  rolling_days: '',
  repeatable: true,
  reward_kind: 'free_service',
  reward_product_id: '',
  reward_service_id: '',
  reward_value: '',
  description: '',
}

export function RewardDialog({ open, onOpenChange, reward, products, services, currency }: Props) {
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      setForm(reward
        ? {
            name: reward.name,
            condition_type: reward.condition_type,
            condition_product_id: reward.condition_product_id ?? '',
            condition_service_id: reward.condition_service_id ?? '',
            condition_value: String(
              reward.condition_type === 'total_amount_spent'
                ? reward.condition_value
                : Math.round(reward.condition_value),
            ),
            window_type: reward.window_type,
            rolling_days: reward.rolling_days != null ? String(reward.rolling_days) : '',
            repeatable: reward.repeatable,
            reward_kind: reward.reward_kind,
            reward_product_id: reward.reward_product_id ?? '',
            reward_service_id: reward.reward_service_id ?? '',
            reward_value: reward.reward_value != null ? String(reward.reward_value) : '',
            description: reward.description ?? '',
          }
        : emptyForm
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reward?.id])

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  const productOptions = useMemo(
    () => [{ value: '', label: 'Any product' }, ...products.map(p => ({ value: p.id, label: `${p.name} — ${formatMoney(p.price, currency)}` }))],
    [products, currency],
  )
  const serviceOptions = useMemo(
    () => [{ value: '', label: 'Any service' }, ...services.map(s => ({ value: s.id, label: `${s.name} — ${formatMoney(s.price, currency)}` }))],
    [services, currency],
  )
  // For reward payloads a specific item is required, so no "Any" entry.
  const productPick = useMemo(() => products.map(p => ({ value: p.id, label: `${p.name} — ${formatMoney(p.price, currency)}` })), [products, currency])
  const servicePick = useMemo(() => services.map(s => ({ value: s.id, label: `${s.name} — ${formatMoney(s.price, currency)}` })), [services, currency])

  const isAmountCondition = form.condition_type === 'total_amount_spent'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const condition_value = parseFloat(form.condition_value)
    if (isNaN(condition_value) || condition_value <= 0) {
      setError('Condition value must be greater than 0.'); return
    }

    const input: RewardInput = {
      name: form.name,
      condition_type: form.condition_type,
      condition_product_id: form.condition_type === 'product_count' && form.condition_product_id ? form.condition_product_id : null,
      condition_service_id: form.condition_type === 'service_count' && form.condition_service_id ? form.condition_service_id : null,
      condition_value: isAmountCondition ? condition_value : Math.round(condition_value),
      window_type: form.window_type,
      rolling_days: form.window_type === 'rolling_days' ? parseInt(form.rolling_days, 10) : null,
      repeatable: form.repeatable,
      reward_kind: form.reward_kind,
      reward_product_id: form.reward_kind === 'free_product' ? (form.reward_product_id || null) : null,
      reward_service_id: form.reward_kind === 'free_service' ? (form.reward_service_id || null) : null,
      reward_value: form.reward_kind === 'discount' ? parseFloat(form.reward_value) : null,
      description: form.description || null,
    }

    setLoading(true)
    setError(null)
    const result = reward
      ? await updateReward(reward.id, input)
      : await createReward(input)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{reward ? 'Edit reward' : 'New reward'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-1">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="reward-name">Name</Label>
            <Input
              id="reward-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Free wash every 10 retwists"
              required
            />
          </div>

          {/* CONDITION */}
          <div className="rounded-lg border border-border p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Condition — when is it earned?</p>

            <div className="space-y-2">
              <Label htmlFor="condition-type">Count</Label>
              <NativeSelect
                id="condition-type"
                value={form.condition_type}
                onChange={(e) => set('condition_type', e.target.value as FormState['condition_type'])}
              >
                <option value="service_count">Number of services</option>
                <option value="product_count">Number of products</option>
                <option value="visit_count">Number of visits</option>
                <option value="total_amount_spent">Total amount spent</option>
              </NativeSelect>
            </div>

            {form.condition_type === 'service_count' && (
              <div className="space-y-2">
                <Label>Which service?</Label>
                <SingleSelect
                  options={serviceOptions}
                  value={form.condition_service_id}
                  onChange={(v) => set('condition_service_id', v)}
                  placeholder="Any service"
                  searchPlaceholder="Search services…"
                />
              </div>
            )}

            {form.condition_type === 'product_count' && (
              <div className="space-y-2">
                <Label>Which product?</Label>
                <SingleSelect
                  options={productOptions}
                  value={form.condition_product_id}
                  onChange={(v) => set('condition_product_id', v)}
                  placeholder="Any product"
                  searchPlaceholder="Search products…"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="condition-value">
                {isAmountCondition ? `Amount (${currency})` : 'How many?'}
              </Label>
              <Input
                id="condition-value"
                type="number"
                min={isAmountCondition ? '0.01' : '1'}
                step={isAmountCondition ? '0.01' : '1'}
                value={form.condition_value}
                onChange={(e) => set('condition_value', e.target.value)}
                placeholder={isAmountCondition ? '0.00' : '10'}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="window-type">Counting window</Label>
              <NativeSelect
                id="window-type"
                value={form.window_type}
                onChange={(e) => set('window_type', e.target.value as FormState['window_type'])}
              >
                <option value="since_last_issuance">Since last reward issued (punch-card)</option>
                <option value="lifetime">All time</option>
                <option value="rolling_days">Rolling window (days)</option>
              </NativeSelect>
            </div>

            {form.window_type === 'rolling_days' && (
              <div className="space-y-2">
                <Label htmlFor="rolling-days">Window length (days)</Label>
                <Input
                  id="rolling-days"
                  type="number"
                  min="1"
                  step="1"
                  value={form.rolling_days}
                  onChange={(e) => set('rolling_days', e.target.value)}
                  placeholder="30"
                  required
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-sm pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={form.repeatable}
                onChange={(e) => set('repeatable', e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Repeatable (resets and can be earned again)
            </label>
          </div>

          {/* PAYLOAD */}
          <div className="rounded-lg border border-border p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reward — what do they get?</p>

            <div className="space-y-2">
              <Label htmlFor="reward-kind">Reward type</Label>
              <NativeSelect
                id="reward-kind"
                value={form.reward_kind}
                onChange={(e) => set('reward_kind', e.target.value as FormState['reward_kind'])}
              >
                <option value="free_service">Free service</option>
                <option value="free_product">Free product</option>
                <option value="discount">Discount ({currency})</option>
                <option value="custom">Custom</option>
              </NativeSelect>
            </div>

            {form.reward_kind === 'free_service' && (
              <div className="space-y-2">
                <Label>Free service</Label>
                <SingleSelect
                  options={servicePick}
                  value={form.reward_service_id}
                  onChange={(v) => set('reward_service_id', v)}
                  placeholder="Select service…"
                  searchPlaceholder="Search services…"
                />
              </div>
            )}

            {form.reward_kind === 'free_product' && (
              <div className="space-y-2">
                <Label>Free product</Label>
                <SingleSelect
                  options={productPick}
                  value={form.reward_product_id}
                  onChange={(v) => set('reward_product_id', v)}
                  placeholder="Select product…"
                  searchPlaceholder="Search products…"
                />
              </div>
            )}

            {form.reward_kind === 'discount' && (
              <div className="space-y-2">
                <Label htmlFor="reward-value">Discount amount ({currency})</Label>
                <Input
                  id="reward-value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.reward_value}
                  onChange={(e) => set('reward_value', e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="reward-description">
              Description
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {form.reward_kind === 'custom' ? '(describe the custom reward)' : '(optional)'}
              </span>
            </Label>
            <Input
              id="reward-description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder={form.reward_kind === 'custom' ? 'e.g. Free scalp massage' : 'Optional notes'}
            />
          </div>

          {error && (
            <Alert variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : reward ? 'Save changes' : 'Create reward'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
