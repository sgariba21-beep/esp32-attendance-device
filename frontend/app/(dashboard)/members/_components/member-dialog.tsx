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
import { SingleSelect } from '@/components/ui/single-select'
import { createMember, updateMember } from '../_actions'
import { indefiniteArticle } from '@/lib/utils'
import { FingerEnrollRow, FingerEditRow, freeSlots } from '@/components/finger-rows'
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
  institutions: { id: string; name: string }[]
  isPlatformAdmin: boolean
}

type EnrollStep = {
  memberId: string
  deviceId: string
  fullname: string
  deviceName: string
}

const emptyForm = { sid: '', fullname: '', device_id: '', member_type: 'student' as 'student' | 'staff', institution_id: '' }

export function MemberDialog({ open, onOpenChange, member, devices, usedFids, labels, institutions, isPlatformAdmin }: Props) {
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
          ? { sid: member.sid, fullname: member.fullname, device_id: member.device_id ?? '', member_type: member.member_type, institution_id: member.institution_id ?? '' }
          // Platform admins must pick an institution first, so don't preselect a unit for them.
          : { sid: '', fullname: '', device_id: isPlatformAdmin ? '' : (devices[0]?.id ?? ''), member_type: 'student', institution_id: '' }
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member?.id])

  // Platform admins choose any institution; the unit list narrows to that institution.
  // Everyone else only ever sees their own institution's units.
  const unitDevices = isPlatformAdmin && !member
    ? devices.filter((d) => d.institution_id === form.institution_id)
    : devices

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isPlatformAdmin && !member && !form.institution_id) { setError('Please select an institution.'); return }
    if (!form.device_id) { setError(`Please select ${indefiniteArticle(labels.label_unit)} ${labels.label_unit.toLowerCase()}.`); return }

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
    const [fid1, fid2] = freeSlots(usedFids[enrollStep.deviceId], 2)
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
              <FingerEnrollRow label="Finger 1" slot="fin1" memberId={enrollStep.memberId} deviceId={enrollStep.deviceId} defaultFid={fid1} />
              <FingerEnrollRow label="Finger 2" slot="fin2" memberId={enrollStep.memberId} deviceId={enrollStep.deviceId} defaultFid={fid2} />
            </div>
            <p className="text-xs text-muted-foreground">You can also enroll later from the {labels.label_member.toLowerCase()} row.</p>
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

          {isPlatformAdmin && !member && (
            <div className="space-y-2">
              <Label htmlFor="institution_id">Institution</Label>
              <SingleSelect
                id="institution_id"
                options={institutions.map((i) => ({ value: i.id, label: i.name }))}
                value={form.institution_id}
                onChange={(v) => setForm((f) => ({ ...f, institution_id: v, device_id: '' }))}
                placeholder="Select institution…"
                searchPlaceholder="Search institutions…"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="device_id">{labels.label_unit}</Label>
            <NativeSelect
              id="device_id"
              value={form.device_id}
              onChange={(e) => set('device_id', e.target.value)}
              required
              disabled={isPlatformAdmin && !member && !form.institution_id}
            >
              <option value="">Select {indefiniteArticle(labels.label_unit)} {labels.label_unit.toLowerCase()}…</option>
              {unitDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.group_name} {d.unit_name}
                </option>
              ))}
            </NativeSelect>
          </div>

          {member && member.device_id && (() => {
            const deviceId = member.device_id
            const [fid1, fid2] = freeSlots(usedFids[deviceId], 2)
            return (
              <div className="space-y-2">
                <Label>Fingerprints</Label>
                <div className="space-y-2 rounded-lg border p-3">
                  <FingerEditRow label="Finger 1" slot="fin1" fid={member.fin1 ?? 0} memberId={member.id} deviceId={deviceId} defaultFid={fid1} />
                  <FingerEditRow label="Finger 2" slot="fin2" fid={member.fin2 ?? 0} memberId={member.id} deviceId={deviceId} defaultFid={member.fin1 ? fid1 : fid2} />
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
