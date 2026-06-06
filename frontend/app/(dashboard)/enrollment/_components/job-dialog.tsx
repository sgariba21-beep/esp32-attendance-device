'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createEnrollmentJob } from '../_actions'
import type { StudentOption } from '../page'
import type { Device } from '@/lib/types'

type Command = 'register' | 'delete' | 'clearall'
type FingerSlot = 'fin1' | 'fin2'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  devices: Device[]
  students: StudentOption[]
}

const empty = { command: 'register' as Command, device_id: '', student_id: '', finger_slot: 'fin1' as FingerSlot, fid: 1 }

export function JobDialog({ open, onOpenChange, devices, students }: Props) {
  const [form, setForm] = useState(empty)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      setForm({ ...empty, device_id: devices[0]?.id ?? '' })
    }
  }, [open, devices])

  function set<K extends keyof typeof empty>(field: K, value: (typeof empty)[K]) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  const deviceStudents = students.filter((s) => s.device_id === form.device_id)
  const needsStudent = form.command === 'register' || form.command === 'delete'
  const needsFid = form.command === 'register'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.device_id) { setError('Please select a device.'); return }
    if (needsStudent && !form.student_id) { setError('Please select a student.'); return }

    setLoading(true)
    setError(null)

    let jobData: Parameters<typeof createEnrollmentJob>[0]

    if (form.command === 'clearall') {
      jobData = { command: 'clearall', device_id: form.device_id }
    } else if (form.command === 'register') {
      jobData = {
        command: 'register',
        device_id: form.device_id,
        student_id: form.student_id,
        finger_slot: form.finger_slot,
        fid: Number(form.fid),
      }
    } else {
      jobData = {
        command: 'delete',
        device_id: form.device_id,
        student_id: form.student_id,
        finger_slot: form.finger_slot,
      }
    }

    const result = await createEnrollmentJob(jobData)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New enrollment job</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Command</Label>
            <div className="flex gap-2">
              {(['register', 'delete', 'clearall'] as Command[]).map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => set('command', cmd)}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors capitalize ${
                    form.command === cmd
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-input bg-background hover:bg-muted'
                  }`}
                >
                  {cmd}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {form.command === 'register' && 'Enroll a fingerprint for a student.'}
              {form.command === 'delete'   && 'Remove a student\'s fingerprint from the device.'}
              {form.command === 'clearall' && 'Wipe all fingerprints stored on the device.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="device_id">Device</Label>
            <select
              id="device_id"
              value={form.device_id}
              onChange={(e) => { set('device_id', e.target.value); set('student_id', '') }}
              required
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Select a device…</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.form} {d.class}</option>
              ))}
            </select>
          </div>

          {needsStudent && (
            <div className="space-y-2">
              <Label htmlFor="student_id">Student</Label>
              <select
                id="student_id"
                value={form.student_id}
                onChange={(e) => set('student_id', e.target.value)}
                required
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Select a student…</option>
                {deviceStudents.map((s) => (
                  <option key={s.id} value={s.id}>{s.fullname} ({s.sid})</option>
                ))}
              </select>
              {form.device_id && deviceStudents.length === 0 && (
                <p className="text-xs text-muted-foreground">No active students in this class.</p>
              )}
            </div>
          )}

          {needsStudent && (
            <div className="space-y-2">
              <Label>Finger slot</Label>
              <div className="flex gap-2">
                {(['fin1', 'fin2'] as FingerSlot[]).map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => set('finger_slot', slot)}
                    className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                      form.finger_slot === slot
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-input bg-background hover:bg-muted'
                    }`}
                  >
                    {slot}
                  </button>
                ))}
              </div>
            </div>
          )}

          {needsFid && (
            <div className="space-y-2">
              <Label htmlFor="fid">Fingerprint ID (fid)</Label>
              <Input
                id="fid"
                type="number"
                min={1}
                value={form.fid}
                onChange={(e) => set('fid', parseInt(e.target.value) || 1)}
              />
              <p className="text-xs text-muted-foreground">
                The slot number to store the template in on the R503 sensor.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create job'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
