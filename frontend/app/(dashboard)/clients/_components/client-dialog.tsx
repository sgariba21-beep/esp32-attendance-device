'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { displayPhone } from '@/lib/utils'
import { createClient, updateClient } from '../_actions'

export type ClientItem = {
  id: string
  name: string
  phone: string
  area_of_residence: string | null
} | null

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ClientItem
}

const emptyForm = { name: '', phone: '', area: '' }

export function ClientDialog({ open, onOpenChange, item }: Props) {
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      setForm(item
        ? { name: item.name, phone: displayPhone(item.phone), area: item.area_of_residence ?? '' }
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
    if (!form.phone.trim()) { setError('Phone number is required.'); return }

    setLoading(true)
    setError(null)

    const result = item
      ? await updateClient(item.id, { name, phone: form.phone, area_of_residence: form.area })
      : await createClient({ name, phone: form.phone, area_of_residence: form.area })

    setLoading(false)
    if (result.error) { setError(result.error); return }

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit client' : 'Add client'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="client-name">Name</Label>
            <Input
              id="client-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Abena Mensah"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-phone">Phone number</Label>
            <Input
              id="client-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="0XXXXXXXXX"
              required
            />
            <p className="text-xs text-muted-foreground">Ghana number: 0XXXXXXXXX or +233XXXXXXXXX</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-area">
              Area of residence
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="client-area"
              value={form.area}
              onChange={(e) => set('area', e.target.value)}
              placeholder="e.g. East Legon"
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
              {loading ? 'Saving…' : item ? 'Save changes' : 'Add client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
