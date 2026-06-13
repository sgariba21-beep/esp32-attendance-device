'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createDevice, updateDevice } from '../_actions'
import type { Device } from '@/lib/types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  device: Device | null
}

const empty = { form: '', class: '' }

export function DeviceDialog({ open, onOpenChange, device }: Props) {
  const [form, setForm] = useState(empty)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      setForm(device ? { form: device.form, class: device.class } : empty)
    }
  }, [open, device])

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const result = device
      ? await updateDevice(device.id, form)
      : await createDevice(form)

    setLoading(false)
    if (result.error) { setError(result.error); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{device ? 'Edit device' : 'Add device'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="form">Form (year level)</Label>
            <Input
              id="form"
              value={form.form}
              onChange={(e) => set('form', e.target.value)}
              placeholder="e.g. 1, 2, 3"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="class">Class name</Label>
            <Input
              id="class"
              value={form.class}
              onChange={(e) => set('class', e.target.value)}
              placeholder="e.g. Science 1"
              required
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Displays as: <span className="font-medium text-foreground">
              {form.form || '?'} {form.class || '?'}
            </span>
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : device ? 'Save changes' : 'Add device'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
