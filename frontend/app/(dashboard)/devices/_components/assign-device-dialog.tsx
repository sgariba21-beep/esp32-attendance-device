'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { assignDevice } from '../_actions'
import type { UnassignedDevice } from '@/lib/types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  device: UnassignedDevice | null
  /** List of all institutions for the platform_admin to pick from. */
  institutions: { id: string; name: string }[]
}

const empty = { institution_id: '', group_name: '', unit_name: '', display_name: '' }

export function AssignDeviceDialog({ open, onOpenChange, device, institutions }: Props) {
  const [form, setForm] = useState(empty)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      setForm({
        ...empty,
        institution_id: institutions[0]?.id ?? '',
        display_name: device?.display_name ?? '',
      })
    }
  }, [open, device, institutions])

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!device) return
    if (!form.institution_id) { setError('Select an institution.'); return }

    setLoading(true)
    setError(null)

    const result = await assignDevice({
      device_id: device.id,
      institution_id: form.institution_id,
      group_name: form.group_name,
      unit_name: form.unit_name,
      display_name: form.display_name,
    })

    setLoading(false)
    if (result.error) { setError(result.error); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign device</DialogTitle>
        </DialogHeader>

        {device && (
          <p className="text-sm text-muted-foreground -mt-2">
            MAC: <span className="font-mono text-xs text-foreground">{device.mac ?? 'unknown'}</span>
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {institutions.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="institution_id">Institution</Label>
              <select
                id="institution_id"
                value={form.institution_id}
                onChange={(e) => set('institution_id', e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                required
              >
                <option value="">Select institution…</option>
                {institutions.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="group_name">Group name</Label>
            <Input
              id="group_name"
              value={form.group_name}
              onChange={(e) => set('group_name', e.target.value)}
              placeholder="e.g. Form 1, Year 2"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit_name">Unit name</Label>
            <Input
              id="unit_name"
              value={form.unit_name}
              onChange={(e) => set('unit_name', e.target.value)}
              placeholder="e.g. Blue, Finance"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="display_name">Display name</Label>
            <Input
              id="display_name"
              value={form.display_name}
              onChange={(e) => set('display_name', e.target.value)}
              placeholder="e.g. Form 1 Blue"
              required
            />
            <p className="text-xs text-muted-foreground">Shown on the device's captive portal.</p>
          </div>

          {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Assigning…' : 'Assign device'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
