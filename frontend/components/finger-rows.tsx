'use client'

// Enroll / delete one finger of a member, from the member and staff dialogs.
// Shared so both get the same slot-conflict handling: createEnrollmentJob
// queues NOTHING when the chosen sensor slot is taken — it answers
// needsConfirm + who holds the slot — and these rows must show that and offer
// the overwrite, never report a job as queued that wasn't.

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createEnrollmentJob } from '@/app/(dashboard)/enrollment/_actions'

type FingerSlot = 'fin1' | 'fin2'

/**
 * The first `count` free sensor slots (1–127), lowest first. `used` is the
 * device's occupied slots from loadOccupiedSlots(). On a full sensor the last
 * suggestion repeats; the server then flags the clash.
 */
export function freeSlots(used: number[] | undefined, count: number): number[] {
  const taken = new Set(used ?? [])
  const out: number[] = []
  for (let i = 1; i <= 127 && out.length < count; i++) if (!taken.has(i)) out.push(i)
  while (out.length < count) out.push(out[out.length - 1] ?? 1)
  return out
}

type FingerEnrollRowProps = {
  label: string
  slot: FingerSlot
  memberId: string
  deviceId: string
  defaultFid: number
}

export function FingerEnrollRow({ label, slot, memberId, deviceId, defaultFid }: FingerEnrollRowProps) {
  const [open, setOpen] = useState(false)
  const [fid, setFid] = useState(String(defaultFid))
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The chosen slot is taken (the server says by whom); nothing was queued.
  const [conflict, setConflict] = useState<string | null>(null)

  async function queue(confirmOverwrite: boolean) {
    const fidNum = parseInt(fid, 10)
    if (!fidNum || fidNum < 1 || fidNum > 127) {
      setError('Enter a slot number between 1 and 127.')
      return
    }
    setLoading(true)
    setError(null)
    const result = await createEnrollmentJob({
      command: 'register',
      device_id: deviceId,
      member_id: memberId,
      finger_slot: slot,
      fid: fidNum,
      ...(confirmOverwrite ? { confirmOverwrite: true } : {}),
    })
    setLoading(false)
    if (result.needsConfirm) {
      setConflict(result.conflict ?? `Sensor slot ${fidNum} is already in use on this device.`)
      return
    }
    setConflict(null)
    if (result.error) { setError(result.error); return }
    setDone(true)
  }

  if (done) {
    return (
      <Alert variant="success">
        <Check className="mt-0.5 size-4 shrink-0" />
        <AlertDescription>
          {label} — job queued (sensor slot {fid}). Tell the member to scan when prompted.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-2">
      {!open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          + Enroll {label}
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm w-20 shrink-0">{label}:</span>
          <Input
            type="number"
            min={1}
            max={127}
            value={fid}
            // A different slot needs its own check: drop the old warning.
            onChange={(e) => { setFid(e.target.value); setConflict(null) }}
            className="h-8 w-24"
            placeholder="Slot"
          />
          <Button size="sm" onClick={() => queue(false)} disabled={loading || !!conflict}>
            {loading && !conflict ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Queue job'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setConflict(null) }}>Cancel</Button>
        </div>
      )}
      {conflict && (
        <Alert variant="warning">
          <AlertDescription>{conflict}</AlertDescription>
          <AlertDescription>
            Overwriting permanently replaces the fingerprint stored in that slot.
          </AlertDescription>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="destructive" onClick={() => queue(true)} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Overwrite slot ${fid}`}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConflict(null)} disabled={loading}>
              Pick another slot
            </Button>
          </div>
        </Alert>
      )}
      {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
  )
}

type FingerEditRowProps = FingerEnrollRowProps & { fid: number }

export function FingerEditRow({ label, slot, fid, memberId, deviceId, defaultFid }: FingerEditRowProps) {
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    const result = await createEnrollmentJob({
      command: 'delete',
      device_id: deviceId,
      member_id: memberId,
      finger_slot: slot,
    })
    setDeleting(false)
    if (result.error) { setDeleteError(result.error); return }
    setDeleted(true)
  }

  if (fid && !deleted) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm w-20 shrink-0 text-muted-foreground">{label}</span>
          <span className="tabular-nums text-sm">Slot {fid}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            className="h-7 px-2 text-xs text-destructive hover:text-destructive ml-auto"
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Delete'}
          </Button>
        </div>
        {deleteError && <Alert variant="error"><AlertDescription>{deleteError}</AlertDescription></Alert>}
      </div>
    )
  }

  return <FingerEnrollRow label={label} slot={slot} memberId={memberId} deviceId={deviceId} defaultFid={defaultFid} />
}
