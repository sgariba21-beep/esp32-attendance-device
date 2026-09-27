'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { utcToZonedParts, todayInZone } from '@/lib/zoned-time'
import { createMeeting, updateMeeting } from '../_actions'
import type { Meeting } from '@/lib/types'
import type { DeviceOption } from './meetings-view'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present when editing. The parent remounts this dialog (key) per open. */
  meeting?: Meeting
  devices: DeviceOption[]
  pinnedDeviceId: string | null
  timezone: string
  labelUnit: string
}

export function MeetingDialog({ open, onOpenChange, meeting, devices, pinnedDeviceId, timezone, labelUnit }: Props) {
  const editing = !!meeting
  // Once a meeting has started (or closed / been cancelled), scans may hang off
  // its times and device, so only the title can change — the server enforces
  // the same rule. Read once on mount (the parent remounts per open), which
  // also keeps the clock read out of render.
  const [titleOnly] = useState(() => !!meeting && (
    Date.parse(meeting.starts_at) <= Date.now() || meeting.status === 'closed' || meeting.status === 'cancelled'
  ))

  const start = meeting ? utcToZonedParts(meeting.starts_at, timezone) : null
  const end = meeting?.ends_at ? utcToZonedParts(meeting.ends_at, timezone) : null
  const [title, setTitle] = useState(meeting?.title ?? '')
  const [date, setDate] = useState(() => start?.date ?? todayInZone(timezone))
  const [startTime, setStartTime] = useState(start?.time ?? '')
  const [endTime, setEndTime] = useState(end?.time ?? '')
  const [deviceId, setDeviceId] = useState(
    meeting ? (meeting.device_id ?? '') : (pinnedDeviceId ?? (devices.length === 1 ? devices[0].id : '')),
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const overnight = !!startTime && !!endTime && endTime <= startTime

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!titleOnly && (!date || !startTime || !endTime)) {
      setError('Enter a date, start time and end time.')
      return
    }
    setLoading(true)
    setError(null)
    const input = { title, date, start: startTime, end: endTime, device_id: deviceId || null }
    const result = editing ? await updateMeeting(meeting.id, input) : await createMeeting(input)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit meeting' : 'New meeting'}</DialogTitle>
          <DialogDescription>
            {titleOnly
              ? 'This meeting has already started, so only its name can change.'
              : `Times are in the club's timezone (${timezone}).`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="meeting-title">Name <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="meeting-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekly circle"
            />
          </div>

          {!titleOnly && (
            <>
              <div className="space-y-2">
                <Label htmlFor="meeting-date">Date</Label>
                <Input id="meeting-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="meeting-start">Starts</Label>
                  <Input id="meeting-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="meeting-end">Ends</Label>
                  <Input id="meeting-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
                </div>
              </div>
              {overnight && (
                <p className="text-xs text-muted-foreground">Ends the next day.</p>
              )}
              <div className="space-y-2">
                <Label htmlFor="meeting-device">{labelUnit}</Label>
                <NativeSelect
                  id="meeting-device"
                  value={deviceId}
                  disabled={!!pinnedDeviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                >
                  {!pinnedDeviceId && <option value="">All devices</option>}
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">
                  Members can only scan in on a device their fingerprint is enrolled on.
                </p>
              </div>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : editing ? 'Save' : 'Create meeting'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
