'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SingleSelect } from '@/components/ui/single-select'
import { assignDevice } from '../_actions'
import type { UnassignedDevice } from '@/lib/types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  device: UnassignedDevice | null
  institutions: { id: string; name: string }[]
}

export function AssignDeviceDialog({ open, onOpenChange, device, institutions }: Props) {
  const [institutionId, setInstitutionId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      setInstitutionId(institutions[0]?.id ?? '')
    }
  }, [open, institutions])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!device) return
    if (!institutionId) { setError('Select an institution.'); return }

    setLoading(true)
    setError(null)

    const result = await assignDevice({ device_id: device.id, institution_id: institutionId })

    setLoading(false)
    if (result.error) { setError(result.error); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign device to institution</DialogTitle>
        </DialogHeader>

        {device && (
          <div className="-mt-2 space-y-0.5">
            <p className="text-sm text-muted-foreground">
              MAC: <span className="font-mono text-xs text-foreground">{device.mac ?? 'unknown'}</span>
            </p>
            {device.display_name && (
              <p className="text-xs text-muted-foreground">{device.display_name}</p>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          The institution admin will configure the group and unit after assignment.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="institution_id">Institution</Label>
            <SingleSelect
              id="institution_id"
              options={institutions.map((i) => ({ value: i.id, label: i.name }))}
              value={institutionId}
              onChange={setInstitutionId}
              placeholder="Select institution…"
              searchPlaceholder="Search institutions…"
            />
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
