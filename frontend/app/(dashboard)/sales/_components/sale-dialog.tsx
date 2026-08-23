'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SingleSelect } from '@/components/ui/single-select'
import { Loader2, Trash2 } from 'lucide-react'
import { formatMoney, displayPhone } from '@/lib/utils'
import { createSale, getClientRewardOffers } from '../_actions'
import type { RewardOffer } from '../_actions'

export type SaleClient = { id: string; name: string; phone: string }
export type SaleCatalogEntry = { id: string; kind: 'product' | 'service'; name: string; price: number }
export type SaleStaff = { id: string; fullname: string }

type LineItem = {
  localId: string
  entry: SaleCatalogEntry | null
  unitPrice: string
  quantity: string
  rewardId: string | null   // set when this line is a reward redemption (free item)
}

// Tracks what Apply did, so Undo (or switching clients) can precisely
// reverse it — restore the exact price a line had, or remove a line that
// didn't exist before.
type AppliedReward = {
  offer: RewardOffer
  lineLocalId?: string
  addedNewLine?: boolean
  previousUnitPrice?: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  clients: SaleClient[]
  allCatalog: SaleCatalogEntry[]
  staff: SaleStaff[]
  currency: string
  preselectedClientId?: string
  labelStaff: string
}

const nextId = (() => { let n = 0; return () => String(++n) })()
const emptyItem = (): LineItem => ({ localId: nextId(), entry: null, unitPrice: '', quantity: '1', rewardId: null })

export function SaleDialog({ open, onOpenChange, clients, allCatalog, staff, currency, preselectedClientId, labelStaff }: Props) {
  const [clientId, setClientId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [note, setNote] = useState('')
  const [items, setItems] = useState<LineItem[]>([emptyItem()])
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const [offers, setOffers] = useState<RewardOffer[]>([])
  const [offersLoading, setOffersLoading] = useState(false)
  const [applied, setApplied] = useState<AppliedReward[]>([])

  useEffect(() => {
    if (open) {
      setClientId(preselectedClientId ?? '')
      setStaffId('')
      setNote('')
      setItems([emptyItem()])
      setError(null)
      setWarnings([])
      setOffers([])
      setApplied([])
    }
  }, [open, preselectedClientId])

  // Refetch this client's reward offers whenever the selected client changes
  // (including on open, if preselected). Reverting stale applied rewards
  // from a PREVIOUS client happens in handleClientChange below — a discrete
  // reaction to the user's own action, not something to infer from a
  // dependency-array effect.
  useEffect(() => {
    if (!open || !clientId) { setOffers([]); return }
    let active = true
    setOffersLoading(true)
    getClientRewardOffers(clientId).then((res) => {
      if (!active) return
      setOffersLoading(false)
      setOffers(res.error ? [] : res.offers)
    })
    return () => { active = false }
  }, [open, clientId])

  // Pre-build option lists once per render (props are stable between opens).
  const clientOptions = useMemo(
    () => clients.map(c => ({ value: c.id, label: `${c.name} — ${displayPhone(c.phone)}` })),
    [clients],
  )
  const staffOptions = useMemo(
    () => staff.map(s => ({ value: s.id, label: s.fullname })),
    [staff],
  )
  // Services listed first — GENERAL LOCKS is primarily a service shop.
  const catalogOptions = useMemo(() => [
    ...allCatalog.filter(c => c.kind === 'service').map(c => ({ value: c.id, label: `${c.name} — ${formatMoney(c.price, currency)}` })),
    ...allCatalog.filter(c => c.kind === 'product').map(c => ({ value: c.id, label: `${c.name} — ${formatMoney(c.price, currency)}` })),
  ], [allCatalog, currency])

  // Undo one applied reward — restores the line it touched to exactly the
  // state Apply found it in, or removes the line Apply added.
  function revertApplied(a: AppliedReward, currentItems: LineItem[]): LineItem[] {
    if (!a.lineLocalId) return currentItems
    if (a.addedNewLine) return currentItems.filter((x) => x.localId !== a.lineLocalId)
    return currentItems.map((x) =>
      x.localId === a.lineLocalId ? { ...x, unitPrice: a.previousUnitPrice ?? '', rewardId: null } : x
    )
  }

  function handleClientChange(newClientId: string) {
    // Rewards are per-client — a free line staged for the previous client
    // makes no sense once a different person is selected. Revert them all.
    if (applied.length > 0) {
      setItems((prev) => applied.reduce((acc, a) => revertApplied(a, acc), prev))
      setApplied([])
    }
    setClientId(newClientId)
  }

  function handleCatalogChange(localId: string, catalogId: string) {
    const entry = allCatalog.find(c => c.id === catalogId) ?? null
    setItems(prev => prev.map(it =>
      it.localId !== localId ? it : {
        ...it,
        entry,
        unitPrice: entry ? String(entry.price) : '',
      }
    ))
  }

  function updateItem(localId: string, field: 'unitPrice' | 'quantity', value: string) {
    setItems(prev => prev.map(it =>
      it.localId !== localId ? it : { ...it, [field]: value }
    ))
  }

  function removeItem(localId: string) {
    const removed = items.find((it) => it.localId === localId)
    // Removing a reward-tagged line also un-applies the reward it belonged
    // to, so the offer panel and the cart never drift out of sync.
    if (removed?.rewardId) {
      setApplied((prev) => prev.filter((a) => a.lineLocalId !== localId))
    }
    setItems(prev => prev.filter(it => it.localId !== localId))
  }

  function addItem() {
    setItems(prev => [...prev, emptyItem()])
  }

  function applyOffer(offer: RewardOffer) {
    if (applied.some((a) => a.offer.key === offer.key)) return

    if (offer.rewardKind === 'discount') {
      setApplied((prev) => [...prev, { offer }])
      return
    }
    if (offer.rewardKind === 'custom') {
      setApplied((prev) => [...prev, { offer }])
      if (offer.description) {
        setNote((prev) => (prev.trim() ? `${prev} · ${offer.description}` : offer.description!))
      }
      return
    }

    // free_product / free_service — apply to a matching existing line if
    // there is one, otherwise add one. Either way the line locks to qty 1 /
    // price 0 so it can't drift away from what the reward actually grants.
    const targetId = offer.rewardKind === 'free_product' ? offer.rewardProductId : offer.rewardServiceId
    if (!targetId) return

    const existing = items.find((it) => it.entry?.id === targetId && !it.rewardId)
    if (existing) {
      setApplied((prev) => [...prev, {
        offer, lineLocalId: existing.localId, addedNewLine: false, previousUnitPrice: existing.unitPrice,
      }])
      setItems((prev) => prev.map((x) =>
        x.localId === existing.localId ? { ...x, unitPrice: '0', quantity: '1', rewardId: offer.rewardId } : x
      ))
    } else {
      const entry = allCatalog.find((c) => c.id === targetId)
      if (!entry) return  // reward targets an item this shop no longer sells
      const newItem: LineItem = { localId: nextId(), entry, unitPrice: '0', quantity: '1', rewardId: offer.rewardId }
      setApplied((prev) => [...prev, { offer, lineLocalId: newItem.localId, addedNewLine: true }])
      setItems((prev) => {
        const withoutBlankFirst = prev.length === 1 && !prev[0].entry ? [] : prev
        return [...withoutBlankFirst, newItem]
      })
    }
  }

  function undoOffer(offer: RewardOffer) {
    const a = applied.find((x) => x.offer.key === offer.key)
    if (!a) return
    setApplied((prev) => prev.filter((x) => x.offer.key !== offer.key))
    setItems((prev) => revertApplied(a, prev))
  }

  const itemsSubtotal = items.reduce((acc, it) => {
    const p = parseFloat(it.unitPrice)
    const q = parseInt(it.quantity, 10)
    return acc + (isNaN(p) || isNaN(q) ? 0 : p * q)
  }, 0)
  const discountFromApplied = applied
    .filter((a) => a.offer.rewardKind === 'discount')
    .reduce((sum, a) => sum + (a.offer.rewardValue ?? 0), 0)
  const total = Math.max(0, itemsSubtotal - discountFromApplied)

  function lineTotal(it: LineItem): string {
    const p = parseFloat(it.unitPrice)
    const q = parseInt(it.quantity, 10)
    if (isNaN(p) || isNaN(q) || p < 0 || q < 1) return '—'
    return formatMoney(p * q, currency)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!clientId) { setError('Please select a client.'); return }
    if (items.length === 0) { setError('Add at least one item.'); return }

    for (const it of items) {
      if (!it.entry) { setError('Each line item must have a catalog item selected.'); return }
      const p = parseFloat(it.unitPrice)
      const q = parseInt(it.quantity, 10)
      if (isNaN(p) || p < 0) { setError(`Invalid price for "${it.entry.name}".`); return }
      if (isNaN(q) || q < 1) { setError(`Invalid quantity for "${it.entry.name}".`); return }
    }

    setLoading(true)
    setError(null)

    const result = await createSale({
      clientId,
      staffId: staffId || null,
      note,
      items: items.map(it => ({
        productId: it.entry!.kind === 'product' ? it.entry!.id : null,
        serviceId: it.entry!.kind === 'service' ? it.entry!.id : null,
        itemName: it.entry!.name,
        unitPrice: parseFloat(it.unitPrice),
        quantity: parseInt(it.quantity, 10),
        rewardId: it.rewardId,
      })),
      redemptions: applied.map((a) => ({
        origin: a.offer.origin,
        rewardId: a.offer.rewardId,
        logId: a.offer.logId,
      })),
    })

    setLoading(false)
    if (result.error) { setError(result.error); return }

    // T23: surface low-stock warnings as a non-blocking alert before closing.
    if (result.warnings && result.warnings.length > 0) {
      setWarnings(result.warnings)
      return  // keep dialog open so user sees the warning; they can close manually
    }

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New sale</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-1">
          {/* Client */}
          <div className="space-y-2">
            <Label htmlFor="sale-client">Client *</Label>
            <SingleSelect
              id="sale-client"
              options={clientOptions}
              value={clientId}
              onChange={handleClientChange}
              placeholder="Select client…"
              searchPlaceholder="Search by name or phone…"
            />
          </div>

          {/* Rewards — what has this client earned, and is it ready to use? */}
          {clientId && (offersLoading || offers.length > 0) && (
            <div className="space-y-2">
              <Label>Rewards</Label>
              {offersLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking rewards…
                </div>
              ) : (
                <div className="space-y-1.5">
                  {offers.map((offer) => {
                    const isApplied = applied.some((a) => a.offer.key === offer.key)
                    return (
                      <div
                        key={offer.key}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{offer.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {offer.summary}
                            {offer.origin === 'pending' ? ' · already earned' : ''}
                          </p>
                        </div>
                        {isApplied ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="success">Applied</Badge>
                            <Button type="button" variant="ghost" size="sm" onClick={() => undoOffer(offer)}>
                              Undo
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => applyOffer(offer)}
                          >
                            Apply
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Staff */}
          {staff.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="sale-staff">
                {labelStaff}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span>
              </Label>
              <SingleSelect
                id="sale-staff"
                options={staffOptions}
                value={staffId}
                onChange={setStaffId}
                placeholder="None"
                searchPlaceholder={`Search ${labelStaff.toLowerCase()}…`}
              />
            </div>
          )}

          {/* Line items */}
          <div className="space-y-2">
            <Label>Items *</Label>

            {allCatalog.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No active products or services. Add some in Catalog first.
              </p>
            ) : (
              <div className="space-y-3">
                {items.map((it, idx) => (
                  <div key={it.localId} className="grid grid-cols-[1fr_68px_80px_auto] gap-2 items-start">
                    {/* Catalog item */}
                    <div className="space-y-1">
                      {idx === 0 && <p className="text-[11px] text-muted-foreground font-medium">Item</p>}
                      <SingleSelect
                        options={catalogOptions}
                        value={it.entry?.id ?? ''}
                        onChange={(id) => handleCatalogChange(it.localId, id)}
                        placeholder="Select…"
                        searchPlaceholder="Search services & products…"
                        disabled={!!it.rewardId}
                      />
                    </div>

                    {/* Quantity */}
                    <div className="space-y-1">
                      {idx === 0 && <p className="text-[11px] text-muted-foreground font-medium">Qty</p>}
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={it.quantity}
                        onChange={(e) => updateItem(it.localId, 'quantity', e.target.value)}
                        required
                        disabled={!!it.rewardId}
                      />
                    </div>

                    {/* Unit price */}
                    <div className="space-y-1">
                      {idx === 0 && <p className="text-[11px] text-muted-foreground font-medium">Price ({currency})</p>}
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.unitPrice}
                        onChange={(e) => updateItem(it.localId, 'unitPrice', e.target.value)}
                        required
                        disabled={!!it.rewardId}
                        title={it.rewardId ? 'Locked — this line is a reward redemption' : 'Edit to apply a discount'}
                      />
                    </div>

                    {/* Remove */}
                    <div className="space-y-1">
                      {idx === 0 && <p className="text-[11px] invisible">×</p>}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem(it.localId)}
                        disabled={items.length === 1}
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {it.rewardId && (
                      <div className="col-span-4 -mt-1.5">
                        <Badge variant="outline" className="text-[10px]">Free — reward redemption</Badge>
                      </div>
                    )}
                  </div>
                ))}

                <div className="flex items-center justify-between pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={addItem}>
                    + Add item
                  </Button>
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground mr-2">Line totals:</span>
                    <span className="text-xs text-muted-foreground">
                      {items.map(lineTotal).join(' + ')}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Note */}
          <div className="space-y-2">
            <Label htmlFor="sale-note">
              Note
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="sale-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Client paid in cash"
            />
          </div>

          {error && (
            <Alert variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* T23: non-blocking low-stock warnings — sale was recorded, but stock went negative */}
          {warnings.length > 0 && (
            <Alert variant="warning">
              <AlertDescription>
                <p className="font-medium mb-1">Sale recorded — low stock alert:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <div className="text-sm">
              {discountFromApplied > 0 && (
                <div className="text-xs text-muted-foreground tabular-nums">
                  Subtotal {formatMoney(itemsSubtotal, currency)} − reward {formatMoney(Math.min(discountFromApplied, itemsSubtotal), currency)}
                </div>
              )}
              <div className="font-semibold tabular-nums">
                Total: {formatMoney(total, currency)}
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading || allCatalog.length === 0}>
                {loading ? 'Recording…' : 'Record sale'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
