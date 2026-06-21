'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createProduct, updateProduct, createService, updateService } from '../_actions'

type Item = { id: string; name: string; price: number; stock?: number } | null

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: 'product' | 'service'
  item: Item
}

const emptyForm = { name: '', price: '', stock: '0' }

export function CatalogDialog({ open, onOpenChange, kind, item }: Props) {
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      setForm(item
        ? { name: item.name, price: String(item.price), stock: String(item.stock ?? 0) }
        : emptyForm
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id])

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) { setError('Name is required.'); return }

    const price = parseFloat(form.price)
    if (isNaN(price) || price < 0) { setError('Price must be 0 or more.'); return }

    setLoading(true)
    setError(null)

    if (kind === 'product') {
      const stock = parseInt(form.stock, 10)
      if (isNaN(stock)) { setError('Stock must be a whole number.'); setLoading(false); return }
      const result = item
        ? await updateProduct(item.id, { name, price, stock })
        : await createProduct({ name, price, stock })
      setLoading(false)
      if (result.error) { setError(result.error); return }
    } else {
      const result = item
        ? await updateService(item.id, { name, price })
        : await createService({ name, price })
      setLoading(false)
      if (result.error) { setError(result.error); return }
    }

    onOpenChange(false)
  }

  const label = kind === 'product' ? 'product' : 'service'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? `Edit ${label}` : `Add ${label}`}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={kind === 'product' ? 'e.g. Shea Butter' : 'e.g. Retwist'}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">Price (GHS)</Label>
            <Input
              id="price"
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
              placeholder="0.00"
              required
            />
          </div>

          {kind === 'product' && (
            <div className="space-y-2">
              <Label htmlFor="stock">
                Stock
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">(can be negative)</span>
              </Label>
              <Input
                id="stock"
                type="number"
                step="1"
                value={form.stock}
                onChange={(e) => set('stock', e.target.value)}
                placeholder="0"
                required
              />
            </div>
          )}

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
              {loading ? 'Saving…' : item ? 'Save changes' : `Add ${label}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
