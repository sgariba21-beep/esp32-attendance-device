'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createEnrollmentJob } from '../../enrollment/_actions'
import type { StudentWithDevice } from '../page'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  student: StudentWithDevice | null
  slot: 'fin1' | 'fin2' | null
  /** Next available sensor slot for the device. */
  defaultFid: number
}

export function EnrollFingerDialog({ open, onOpenChange, student, slot, defaultFid }: Props) {
  const [fid, setFid] = useState(String(defaultFid))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setFid(String(defaultFid))
      setError(null)
    }
  }, [open, defaultFid])

  if (!student || !slot) return null

  const fingerLabel = slot === 'fin1' ? 'Finger 1' : 'Finger 2'
  const deviceName = student.device
    ? `${student.device.form} ${student.device.class}`
    : 'Unknown class'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fidNum = parseInt(fid, 10)
    if (!fidNum || fidNum < 1 || fidNum > 127) {
      setError('Sensor slot must be between 1 and 127.')
      return
    }

    setLoading(true)
    setError(null)

    const result = await createEnrollmentJob({
      command: 'register',
      device_id: student!.device_id,
      student_id: student!.id,
      finger_slot: slot!,
      fid: fidNum,
    })

    setLoading(false)
    if (result?.error) { setError(result.error); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Enroll {fingerLabel}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="rounded-md bg-muted px-3 py-2 text-sm space-y-0.5">
            <p><span className="text-muted-foreground">Student: </span>{student.fullname}</p>
            <p><span className="text-muted-foreground">Class: </span>{deviceName}</p>
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Queuing…' : 'Queue enrollment job'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
