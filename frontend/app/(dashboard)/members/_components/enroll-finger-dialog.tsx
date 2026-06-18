'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { createEnrollmentJob } from '../../enrollment/_actions'
import type { MemberWithDevice } from '../page'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: MemberWithDevice | null
  slot: 'fin1' | 'fin2' | null
  defaultFid: number
}

export function EnrollFingerDialog({ open, onOpenChange, member, slot, defaultFid }: Props) {
  const [fid, setFid] = useState(String(defaultFid))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // M8: overwrite warning state.
  const [overwriteMsg, setOverwriteMsg] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (open) {
      setFid(String(defaultFid))
      setError(null)
      setOverwriteMsg(null)
    }
  }, [open, defaultFid])

  // An unassigned member (device deleted) has no unit to enroll against.
  if (!member || !slot || !member.device_id) return null

  const fingerLabel = slot === 'fin1' ? 'Finger 1' : 'Finger 2'
  const deviceName = member.device
    ? `${member.device.group_name} ${member.device.unit_name}`
    : 'Unknown unit'

  async function submit(confirmOverwrite: boolean) {
    const fidNum = parseInt(fid, 10)
    if (!fidNum || fidNum < 1 || fidNum > 127) {
      setError('Sensor slot must be between 1 and 127.')
      return
    }

    if (confirmOverwrite) setConfirming(true); else setLoading(true)
    setError(null)

    const result = await createEnrollmentJob({
      command: 'register',
      device_id: member!.device_id!,
      student_id: member!.id,
      finger_slot: slot!,
      fid: fidNum,
      confirmOverwrite,
    })

    setLoading(false)
    setConfirming(false)
    // M8: another member already uses this slot — require a second confirmation.
    if (result?.needsConfirm) {
      setOverwriteMsg(result.conflict ?? 'This will overwrite an existing fingerprint on this device.')
      return
    }
    if (result?.error) { setError(result.error); return }
    setOverwriteMsg(null)
    onOpenChange(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await submit(false)
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Enroll {fingerLabel}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="rounded-md bg-muted px-3 py-2 text-sm space-y-0.5">
            <p><span className="text-muted-foreground">Member: </span>{member.fullname}</p>
            <p><span className="text-muted-foreground">Unit: </span>{deviceName}</p>
            <p><span className="text-muted-foreground">Finger: </span>{fingerLabel}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fid">Sensor slot (1–127)</Label>
            <Input
              id="fid"
              type="number"
              min={1}
              max={127}
              value={fid}
              onChange={(e) => setFid(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Suggested next free slot for this device. Change if needed.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Queuing…' : 'Queue enrollment job'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      open={!!overwriteMsg}
      onOpenChange={(o) => { if (!o) setOverwriteMsg(null) }}
      title="Overwrite existing fingerprint?"
      description={`${overwriteMsg ?? ''} This permanently replaces the existing template in that slot and cannot be undone. Confirm again to proceed.`}
      confirmLabel="Overwrite anyway"
      loading={confirming}
      onConfirm={() => submit(true)}
    />
    </>
  )
}
