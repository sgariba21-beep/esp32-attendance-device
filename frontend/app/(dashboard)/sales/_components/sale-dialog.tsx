'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Trash2 } from 'lucide-react'
import { formatGHS, displayPhone } from '@/lib/utils'
import { NativeSelect } from '@/components/ui/native-select'
import { createSale } from '../_actions'

export type SaleClient = { id: string; name: string; phone: string }
export type SaleCatalogEntry = { id: string; kind: 'product' | 'service'; name: string; price: number }
export type SaleStaff = { id: string; fullname: string }

type LineItem = {
  localId: string
  entry: SaleCatalogEntry | null
  unitPrice: string
  quantity: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  clients: SaleClient[]
  allCatalog: SaleCatalogEntry[]
  staff: SaleStaff[]
  /** Pre-select this client when opening (e.g. from Clients page). */
  preselectedClientId?: string
}

const nextId = (() => { let n = 0; return () => String(++n) })()
const emptyItem = (): LineItem => ({ localId: nextId(), entry: null, unitPrice: '', quantity: '1' })

export function SaleDialog({ open, onOpenChange, clients, allCatalog, staff, preselectedClientId }: Props) {
  const [clientId, setClientId] = useState('')
  const [staffId, setStaffId] = useState('')
  const [note, setNote] = useState('')
  const [items, setItems] = useState<LineItem[]>([emptyItem()])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const initializedRef = useRef(false)

  useEffect(() => {
    if (open) {
      setClientId(preselectedClientId ?? '')
      setStaffId('')
      setNote('')
      setItems([emptyItem()])
      setError(null)
      initializedRef.current = true
    }
  }, [open, preselectedClientId])

  const services = allCatalog.filter(c => c.kind === 'service')
  const products = allCatalog.filter(c => c.kind === 'product')

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
    setItems(prev => prev.filter(it => it.localId !== localId))
  }

  function addItem() {
    setItems(prev => [...prev, emptyItem()])
  }

  // Computed total — NaN-safe.
  const total = items.reduce((acc, it) => {
    const p = parseFloat(it.unitPrice)
    const q = parseInt(it.quantity, 10)
    return acc + (isNaN(p) || isNaN(q) ? 0 : p * q)
  }, 0)

  function lineTotal(it: LineItem): string {
    const p = parseFloat(it.unitPrice)
    const q = parseInt(it.quantity, 10)
    if (isNaN(p) || isNaN(q) || p < 0 || q < 1) return '—'
    return formatGHS(p * q)
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
      })),
    })

    setLoading(false)
    if (result.error) { setError(result.error); return }
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
            <NativeSelect
              id="sale-client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              required
            >
              <option value="">Select client…</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name} — {displayPhone(c.phone)}</option>
              ))}
            </NativeSelect>
          </div>

          {/* Stylist */}
          {staff.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="sale-staff">
                Stylist
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span>
              </Label>
              <NativeSelect
                id="sale-staff"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              >
                <option value="">None</option>
                {staff.map(s => (
                  <option key={s.id} value={s.id}>{s.fullname}</option>
                ))}
              </NativeSelect>
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
                      {idx === 0 && (
                        <p className="text-[11px] text-muted-foreground font-medium">Item</p>
                      )}
                      <NativeSelect
                        value={it.entry?.id ?? ''}
                        onChange={(e) => handleCatalogChange(it.localId, e.target.value)}
                        required
                      >
                        <option value="">Select…</option>
                        {services.length > 0 && (
                          <optgroup label="Services">
                            {services.map(s => (
                              <option key={s.id} value={s.id}>{s.name} ({formatGHS(s.price)})</option>
                            ))}
                          </optgroup>
                        )}
                        {products.length > 0 && (
                          <optgroup label="Products">
                            {products.map(p => (
                              <option key={p.id} value={p.id}>{p.name} ({formatGHS(p.price)})</option>
                            ))}
                          </optgroup>
                        )}
                      </NativeSelect>
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
                      />
                    </div>

                    {/* Unit price */}
                    <div className="space-y-1">
                      {idx === 0 && <p className="text-[11px] text-muted-foreground font-medium">Price (GHS)</p>}
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={it.unitPrice}
                        onChange={(e) => updateItem(it.localId, 'unitPrice', e.target.value)}
                        required
                        title="Edit to apply a discount"
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

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <div className="text-sm font-semibold tabular-nums">
              Total: {formatGHS(total)}
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
