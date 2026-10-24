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
import { createSchedule, updateSchedule } from '../_actions'
import type { MeetingSchedule } from '@/lib/types'
import type { DeviceOption } from './meetings-view'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present when editing. The parent remounts this dialog (key) per open. */
  schedule?: MeetingSchedule
  devices: DeviceOption[]
  pinnedDeviceId: string | null
  timezone: string
  labelUnit: string
  /** Called with a line saying what was saved. */
  onSaved: (message: string) => void
}

// 'w1'…'w12' = every N weeks; 'm' = monthly on the Nth weekday.
type Repeat = `w${number}` | 'm'

const INTERVALS = [1, 2, 3, 4]
const LENGTHS = [30, 45, 60, 90, 120, 150, 180, 240]

const meetings = (n: number) => `${n} ${n === 1 ? 'meeting' : 'meetings'}`

export function ScheduleDialog({ open, onOpenChange, schedule, devices, pinnedDeviceId, timezone, labelUnit, onSaved }: Props) {
  const editing = !!schedule
  const initialRepeat: Repeat = schedule
    ? (schedule.freq === 'monthly_nth_weekday' ? 'm' : `w${schedule.interval_n}`)
    : 'w1'
  // Read once on mount (the parent remounts per open): keeps the clock read out of render.
  const [today] = useState(() => todayInZone(timezone))
  const [title, setTitle] = useState(schedule?.title ?? '')
  const [repeat, setRepeat] = useState<Repeat>(initialRepeat)
  const [weekday, setWeekday] = useState(schedule?.weekday ?? 6)
  const [nth, setNth] = useState(schedule?.nth ?? 1)
  const [startTime, setStartTime] = useState(schedule?.start_time.slice(0, 5) ?? '')
  const [duration, setDuration] = useState(schedule?.duration_minutes ?? 120)
  const [startsOn, setStartsOn] = useState(schedule?.starts_on ?? today)
  const [endsOn, setEndsOn] = useState(schedule?.ends_on ?? '')
  const [deviceId, setDeviceId] = useState(
    schedule ? (schedule.device_id ?? '') : (pinnedDeviceId ?? (devices.length === 1 ? devices[0].id : '')),
  )
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
  // A schedule saved with a value the pickers don't list still shows it.
  const intervals = schedule && !INTERVALS.includes(schedule.interval_n) && schedule.freq === 'weekly'
    ? [...INTERVALS, schedule.interval_n].sort((a, b) => a - b)
    : INTERVALS
  const lengths = schedule && !LENGTHS.includes(schedule.duration_minutes)
    ? [...LENGTHS, schedule.duration_minutes].sort((a, b) => a - b)
    : LENGTHS
  // Mirrors updateSchedule: a change of days re-creates the upcoming meetings.
  const datesChanged = !!schedule && (
    repeat !== initialRepeat || weekday !== schedule.weekday
    || (monthly && nth !== schedule.nth) || startsOn !== schedule.starts_on
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!startTime) { setError('Enter a start time.'); return }
    setLoading(true)
    setError(null)
    const input = {
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
    } as const
    if (schedule) {
      const result = await updateSchedule(schedule.id, input)
      setLoading(false)
      if (result.error) { setError(result.error); return }
      const n = result.updated ?? 0
      onSaved(result.recreated
        ? `Recurring meeting updated — ${meetings(n)} scheduled for the next 8 weeks.`
        : n ? `Recurring meeting updated — ${meetings(n)} changed to match.` : 'Recurring meeting updated.')
    } else {
      const result = await createSchedule(input)
      setLoading(false)
      if (result.error) { setError(result.error); return }
      onSaved(`Recurring meeting created — ${meetings(result.created ?? 0)} scheduled for the next 8 weeks.`)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit recurring meeting' : 'New recurring meeting'}</DialogTitle>
          <DialogDescription>
            {editing
              ? `Changes apply to upcoming meetings that haven't started; past and live ones stay as they are. Times are in ${timezone}.`
              : `Meetings are created about 8 weeks ahead and kept topped up. Times are in ${timezone}.`}
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
                {intervals.map((n) => (
                  <option key={n} value={`w${n}`}>{n === 1 ? 'Every week' : `Every ${n} weeks`}</option>
                ))}
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
                {lengths.map((m) => (
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
              <Input
                id="schedule-until"
                type="date"
                value={endsOn}
                min={editing && today > startsOn ? today : startsOn}
                onChange={(e) => setEndsOn(e.target.value)}
              />
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

          {datesChanged && (
            <p className="text-sm text-muted-foreground">
              Changing the days re-creates the upcoming meetings from the new pattern, so any you skipped or
              edited one at a time are reset.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {editing ? (loading ? 'Saving…' : 'Save changes') : (loading ? 'Creating…' : 'Create schedule')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
