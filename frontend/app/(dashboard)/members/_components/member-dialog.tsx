'use client'

import { useState, useEffect } from 'react'
import { Check, Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { createMember, updateMember } from '../_actions'
import { createEnrollmentJob } from '../../enrollment/_actions'
import type { MemberWithDevice } from '../page'
import type { Device } from '@/lib/types'

type Labels = {
  label_member: string
  label_members: string
  label_unit: string
  label_group: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: MemberWithDevice | null
  devices: Device[]
  usedFids: Record<string, number[]>
  labels: Labels
}

type EnrollStep = {
  memberId: string
  deviceId: string
  fullname: string
  deviceName: string
}

function nextAvailableFid(deviceId: string, usedFids: Record<string, number[]>): number {
  const used = new Set(usedFids[deviceId] ?? [])
  for (let i = 1; i <= 127; i++) {
    if (!used.has(i)) return i
  }
  return 1
}

type FingerRowProps = {
  label: string
  slot: 'fin1' | 'fin2'
  memberId: string
  deviceId: string
  defaultFid: number
}

function FingerEnrollRow({ label, slot, memberId, deviceId, defaultFid }: FingerRowProps) {
  const [open, setOpen] = useState(false)
  const [fid, setFid] = useState(String(defaultFid))
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEnroll() {
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
      student_id: memberId,
      finger_slot: slot,
      fid: fidNum,
    })
    setLoading(false)
    if (result?.error) { setError(result.error); return }
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
            onChange={(e) => setFid(e.target.value)}
            className="h-8 w-24"
            placeholder="Slot"
          />
          <Button size="sm" onClick={handleEnroll} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Queue job'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      )}
      {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
  )
}

type FingerEditRowProps = {
  label: string
  slot: 'fin1' | 'fin2'
  fid: number
  memberId: string
  deviceId: string
  defaultFid: number
}

function FingerEditRow({ label, slot, fid, memberId, deviceId, defaultFid }: FingerEditRowProps) {
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    const result = await createEnrollmentJob({
      command: 'delete',
      device_id: deviceId,
      student_id: memberId,
      finger_slot: slot,
    })
    setDeleting(false)
    if (result?.error) { setDeleteError(result.error); return }
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

  return (
    <FingerEnrollRow
      label={label}
      slot={slot}
      memberId={memberId}
      deviceId={deviceId}
      defaultFid={defaultFid}
    />
  )
}

const emptyForm = { sid: '', fullname: '', device_id: '', member_type: 'member' as 'student' | 'staff' | 'member' }

export function MemberDialog({ open, onOpenChange, member, devices, usedFids, labels }: Props) {
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [enrollStep, setEnrollStep] = useState<EnrollStep | null>(null)

  useEffect(() => {
    if (open) {
      setError(null)
      setEnrollStep(null)
      setForm(
        member
          ? { sid: member.sid, fullname: member.fullname, device_id: member.device_id, member_type: member.member_type }
          : { ...emptyForm, device_id: devices[0]?.id ?? '' }
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member?.id])

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.device_id) { setError(`Please select a ${labels.label_unit.toLowerCase()}.`); return }

    setLoading(true)
    setError(null)

    if (member) {
      const result = await updateMember(member.id, {
        sid: form.sid,
        fullname: form.fullname,
        device_id: form.device_id,
        member_type: form.member_type,
        fin1: member.fin1,
        fin2: member.fin2,
      })
      setLoading(false)
      if (result.error) { setError(result.error); return }
      onOpenChange(false)
    } else {
      const result = await createMember({ sid: form.sid, fullname: form.fullname, device_id: form.device_id, member_type: form.member_type, fin1: 0, fin2: 0 })
      setLoading(false)
      if (result.error) { setError(result.error); return }

      const device = devices.find((d) => d.id === form.device_id)
      setEnrollStep({
        memberId: result.id!,
        deviceId: form.device_id,
        fullname: form.fullname,
        deviceName: device ? `${device.group_name} ${device.unit_name}` : '',
      })
    }
  }

  if (enrollStep) {
    const baseFid = nextAvailableFid(enrollStep.deviceId, usedFids)
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{labels.label_member} added</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{enrollStep.fullname}</span> has been added to{' '}
              <span className="font-medium text-foreground">{enrollStep.deviceName}</span>.
            </p>
            <p className="text-sm font-medium">Enroll fingerprints now?</p>
            <div className="space-y-3">
              <FingerEnrollRow label="Finger 1" slot="fin1" memberId={enrollStep.memberId} deviceId={enrollStep.deviceId} defaultFid={baseFid} />
              <FingerEnrollRow label="Finger 2" slot="fin2" memberId={enrollStep.memberId} deviceId={enrollStep.deviceId} defaultFid={baseFid + 1 <= 127 ? baseFid + 1 : baseFid} />
            </div>
            <p className="text-xs text-muted-foreground">You can also enroll later from the member row.</p>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{member ? `Edit ${labels.label_member.toLowerCase()}` : `Add ${labels.label_member.toLowerCase()}`}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="fullname">Full name</Label>
            <Input
              id="fullname"
              value={form.fullname}
              onChange={(e) => set('fullname', e.target.value)}
              placeholder="e.g. Jane Doe"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sid">ID</Label>
            <Input
              id="sid"
              value={form.sid}
              onChange={(e) => set('sid', e.target.value)}
              placeholder="e.g. L186"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="member_type">Type</Label>
            <NativeSelect
              id="member_type"
              value={form.member_type}
              onChange={(e) => set('member_type', e.target.value)}
            >
              <option value="student">Student</option>
              <option value="staff">Staff</option>
              <option value="member">Member</option>
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label htmlFor="device_id">{labels.label_unit}</Label>
            <NativeSelect
              id="device_id"
              value={form.device_id}
              onChange={(e) => set('device_id', e.target.value)}
              required
            >
              <option value="">Select a {labels.label_unit.toLowerCase()}…</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.group_name} {d.unit_name}
                </option>
              ))}
            </NativeSelect>
          </div>

          {member && (() => {
            const baseFid = nextAvailableFid(member.device_id, usedFids)
            return (
              <div className="space-y-2">
                <Label>Fingerprints</Label>
                <div className="space-y-2 rounded-lg border p-3">
                  <FingerEditRow label="Finger 1" slot="fin1" fid={member.fin1 ?? 0} memberId={member.id} deviceId={member.device_id} defaultFid={baseFid} />
                  <FingerEditRow label="Finger 2" slot="fin2" fid={member.fin2 ?? 0} memberId={member.id} deviceId={member.device_id} defaultFid={baseFid + 1 <= 127 ? baseFid + 1 : baseFid} />
                </div>
              </div>
            )
          })()}

          {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : member ? 'Save changes' : `Add ${labels.label_member.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
