'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { todayInZone } from '@/lib/zoned-time'
import { describeRecurrence, formatDuration, weekdayName } from '@/lib/meetings'
import { createSchedule } from '../_actions'
import type { DeviceOption } from './meetings-view'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  devices: DeviceOption[]
  pinnedDeviceId: string | null
  timezone: string
  labelUnit: string
  /** Called with how many meetings were generated. */
  onCreated: (created: number) => void
}

// 'w1'…'w4' = every N weeks; 'm' = monthly on the Nth weekday.
type Repeat = 'w1' | 'w2' | 'w3' | 'w4' | 'm'

const LENGTHS = [30, 45, 60, 90, 120, 150, 180, 240]

export function ScheduleDialog({ open, onOpenChange, devices, pinnedDeviceId, timezone, labelUnit, onCreated }: Props) {
  const [title, setTitle] = useState('')
  const [repeat, setRepeat] = useState<Repeat>('w1')
  const [weekday, setWeekday] = useState(6)
  const [nth, setNth] = useState(1)
  const [startTime, setStartTime] = useState('')
  const [duration, setDuration] = useState(120)
  const [startsOn, setStartsOn] = useState(() => todayInZone(timezone))
  const [endsOn, setEndsOn] = useState('')
  const [deviceId, setDeviceId] = useState(pinnedDeviceId ?? (devices.length === 1 ? devices[0].id : ''))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const monthly = repeat === 'm'
  const intervalN = monthly ? 1 : Number(repeat.slice(1))
  const summary = describeRecurrence({
    freq: monthly ? 'monthly_nth_weekday' : 'weekly',
    interval_n: intervalN,
    weekday,
    nth: monthly ? nth : null,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!startTime) { setError('Enter a start time.'); return }
    setLoading(true)
    setError(null)
    const result = await createSchedule({
      title,
      freq: monthly ? 'monthly_nth_weekday' : 'weekly',
      interval_n: intervalN,
      weekday,
      nth: monthly ? nth : null,
      start_time: startTime,
      duration_minutes: duration,
      starts_on: startsOn,
      ends_on: endsOn || null,
      device_id: deviceId || null,
    })
    setLoading(false)
    if (result.error) { setError(result.error); return }
    onCreated(result.created ?? 0)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New recurring meeting</DialogTitle>
          <DialogDescription>
            Meetings are created about 8 weeks ahead and kept topped up. Times are in {timezone}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="schedule-title">Name <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="schedule-title"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Saturday practice"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="schedule-repeat">Repeats</Label>
              <NativeSelect id="schedule-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
                <option value="w1">Every week</option>
                <option value="w2">Every 2 weeks</option>
                <option value="w3">Every 3 weeks</option>
                <option value="w4">Every 4 weeks</option>
                <option value="m">Monthly</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-weekday">On</Label>
              <NativeSelect id="schedule-weekday" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>{weekdayName(d)}</option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {monthly && (
            <div className="space-y-2">
              <Label htmlFor="schedule-nth">Which {weekdayName(weekday)}</Label>
              <NativeSelect id="schedule-nth" value={nth} onChange={(e) => setNth(Number(e.target.value))}>
                <option value={1}>First</option>
                <option value={2}>Second</option>
                <option value={3}>Third</option>
                <option value={4}>Fourth</option>
                <option value={-1}>Last</option>
              </NativeSelect>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="schedule-start">Starts at</Label>
              <Input id="schedule-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-length">Length</Label>
              <NativeSelect id="schedule-length" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {LENGTHS.map((m) => (
                  <option key={m} value={m}>{formatDuration(m)}</option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="schedule-from">From</Label>
              <Input id="schedule-from" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-until">Until <span className="text-muted-foreground">(optional)</span></Label>
              <Input id="schedule-until" type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-device">{labelUnit}</Label>
            <NativeSelect
              id="schedule-device"
              value={deviceId}
              disabled={!!pinnedDeviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            >
              {!pinnedDeviceId && <option value="">All devices</option>}
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </NativeSelect>
          </div>

          <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            {summary}{startTime ? ` at ${startTime}` : ''}, {formatDuration(duration)}
            {endsOn ? `, until ${endsOn}` : ''}.
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create schedule'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
