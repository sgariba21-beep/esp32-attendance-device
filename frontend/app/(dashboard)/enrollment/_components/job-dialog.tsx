'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { createEnrollmentJob, getStudentsByDevice } from '../_actions'
import type { StudentOption } from '../_actions'
import type { Device } from '@/lib/types'

type Command = 'register' | 'delete' | 'clearall' | 'register-master' | 'delete-master'
type FingerSlot = 'fin1' | 'fin2'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  devices: Device[]
  labelUnit: string
  labelMember: string
  labelMembers: string
}

const FINGER_SLOTS: { value: FingerSlot; label: string }[] = [
  { value: 'fin1', label: 'Finger 1' },
  { value: 'fin2', label: 'Finger 2' },
]

const empty = {
  command: 'register' as Command,
  device_id: '',
  student_id: '',
  finger_slot: 'fin1' as FingerSlot,
  fid: 1,
  master_name: '',
}

export function JobDialog({ open, onOpenChange, devices, labelUnit, labelMember, labelMembers }: Props) {
  const member = labelMember.toLowerCase()
  const COMMANDS: { value: Command; label: string; description: string }[] = [
    { value: 'register',        label: 'Register',      description: `Enroll a fingerprint for a ${member}.` },
    { value: 'delete',          label: 'Delete',        description: `Remove a ${member}'s fingerprint from the device.` },
    { value: 'register-master', label: 'Reg. master',   description: 'Enroll a master fingerprint. When scanned, opens the device config portal.' },
    { value: 'delete-master',   label: 'Del. master',   description: 'Remove a master fingerprint from the device by its sensor slot number.' },
    { value: 'clearall',        label: 'Clear all',     description: 'Wipe all fingerprints stored on the device.' },
  ]

  const [form, setForm] = useState(empty)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [deviceStudents, setDeviceStudents] = useState<StudentOption[]>([])
  const [loadingStudents, setLoadingStudents] = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      setDeviceStudents([])
      setForm({ ...empty, device_id: devices[0]?.id ?? '' })
    }
  }, [open, devices])

  const needsStudent = form.command === 'register' || form.command === 'delete'

  useEffect(() => {
    if (!form.device_id || !needsStudent) { setDeviceStudents([]); return }
    let cancelled = false
    setLoadingStudents(true)
    getStudentsByDevice(form.device_id).then((data) => {
      if (!cancelled) { setDeviceStudents(data); setLoadingStudents(false) }
    })
    return () => { cancelled = true }
  }, [form.device_id, needsStudent])

  function set<K extends keyof typeof empty>(field: K, value: (typeof empty)[K]) {
    setForm((f) => ({ ...f, [field]: value }))
  }
  const needsFid       = form.command === 'register' || form.command === 'register-master' || form.command === 'delete-master'
  const needsMasterName = form.command === 'register-master'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.device_id) { setError('Please select a device.'); return }
    if (needsStudent && !form.student_id) { setError(`Please select a ${member}.`); return }
    if (needsMasterName && !form.master_name.trim()) { setError('Please enter a name for the master.'); return }

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
    } else if (form.command === 'delete') {
      jobData = {
        command: 'delete',
        device_id: form.device_id,
        student_id: form.student_id,
        finger_slot: form.finger_slot,
      }
    } else if (form.command === 'register-master') {
      jobData = {
        command: 'register-master',
        device_id: form.device_id,
        fid: Number(form.fid),
        name: form.master_name.trim(),
      }
    } else {
      jobData = {
        command: 'delete-master',
        device_id: form.device_id,
        fid: Number(form.fid),
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
          {/* Command selector */}
          <div className="space-y-2">
            <Label>Command</Label>
            <div className="grid grid-cols-2 gap-2">
              {COMMANDS.filter(c => c.value !== 'clearall').map(({ value, label }) => (
                <Button
                  key={value}
                  type="button"
                  variant={form.command === value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => set('command', value)}
                >
                  {label}
                </Button>
              ))}
              <Button
                type="button"
                variant={form.command === 'clearall' ? 'default' : 'outline'}
                size="sm"
                className="col-span-2"
                onClick={() => set('command', 'clearall')}
              >
                Clear all
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {COMMANDS.find((c) => c.value === form.command)?.description}
            </p>
          </div>

          {/* Device */}
          <div className="space-y-2">
            <Label htmlFor="device_id">Device</Label>
            <NativeSelect
              id="device_id"
              value={form.device_id}
              onChange={(e) => { set('device_id', e.target.value); set('student_id', '') }}
              required
            >
              <option value="">Select a device…</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.group_name} {d.unit_name}</option>
              ))}
            </NativeSelect>
          </div>

          {/* Master name */}
          {needsMasterName && (
            <div className="space-y-2">
              <Label htmlFor="master_name">Name</Label>
              <Input
                id="master_name"
                value={form.master_name}
                onChange={(e) => set('master_name', e.target.value)}
                placeholder="e.g. Principal"
                required
              />
              <p className="text-xs text-muted-foreground">
                Stored in the device's local map for identification.
              </p>
            </div>
          )}

          {/* Member (register / delete only) */}
          {needsStudent && (
            <div className="space-y-2">
              <Label htmlFor="student_id">{labelMember}</Label>
              <NativeSelect
                id="student_id"
                value={form.student_id}
                onChange={(e) => set('student_id', e.target.value)}
                required
                disabled={loadingStudents}
              >
                <option value="">{loadingStudents ? 'Loading…' : `Select a ${member}…`}</option>
                {deviceStudents.map((s) => (
                  <option key={s.id} value={s.id}>{s.fullname} ({s.sid})</option>
                ))}
              </NativeSelect>
              {!loadingStudents && form.device_id && deviceStudents.length === 0 && (
                <p className="text-xs text-muted-foreground">No active {labelMembers.toLowerCase()} in this {labelUnit.toLowerCase()}.</p>
              )}
            </div>
          )}

          {/* Finger slot (register / delete only) */}
          {needsStudent && (
            <div className="space-y-2">
              <Label>Finger slot</Label>
              <div className="flex gap-2">
                {FINGER_SLOTS.map(({ value, label }) => (
                  <Button
                    key={value}
                    type="button"
                    variant={form.finger_slot === value ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => set('finger_slot', value)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* FID (register / register-master / delete-master) */}
          {needsFid && (
            <div className="space-y-2">
              <Label htmlFor="fid">Sensor slot (1–127)</Label>
              <Input
                id="fid"
                type="number"
                min={1}
                max={127}
                value={form.fid}
                onChange={(e) => set('fid', parseInt(e.target.value) || 1)}
              />
              <p className="text-xs text-muted-foreground">
                The slot number to store the template in on the R503 sensor.
              </p>
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
              {loading ? 'Creating…' : 'Create job'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
