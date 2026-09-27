// Club-mode meeting rules shared by the dashboard (CLUB-MODE-PLAN.md).
//
// The acceptance window here MIRRORS public.resolve_meeting() — the database
// is the authority on which meeting a scan lands in; this copy only decides
// what the dashboard calls "live" and "upcoming". Keep the two in step.

import type { Meeting, MeetingSchedule } from '@/lib/types'

type WindowConfig = { meeting_preroll_minutes: number; meeting_postroll_minutes: number }

const MIN = 60_000

/**
 * [start, end] instants (ms) during which the meeting accepts scans, or null
 * for a cancelled meeting. Scheduled: starts_at − pre-roll … ends_at +
 * post-roll, cut short at closed_at. Device (ad-hoc): opened_at … closed_at,
 * open-ended while it is still open.
 */
export function acceptanceWindow(m: Meeting, cfg: WindowConfig): [number, number] | null {
  if (m.status === 'cancelled' || m.device_deleted_at) return null
  const closed = m.closed_at ? Date.parse(m.closed_at) : Infinity
  if (m.origin === 'scheduled') {
    const start = Date.parse(m.starts_at) - cfg.meeting_preroll_minutes * MIN
    const end = m.ends_at ? Date.parse(m.ends_at) + cfg.meeting_postroll_minutes * MIN : Infinity
    return [start, Math.min(end, closed)]
  }
  return [Date.parse(m.opened_at ?? m.starts_at), closed]
}

/** The meeting is accepting scans at `now`. */
export function isLive(m: Meeting, cfg: WindowConfig, now: number = Date.now()): boolean {
  const w = acceptanceWindow(m, cfg)
  return !!w && w[0] <= now && now <= w[1]
}

/** Not yet accepting scans, and not cancelled. */
export function isUpcoming(m: Meeting, cfg: WindowConfig, now: number = Date.now()): boolean {
  const w = acceptanceWindow(m, cfg)
  return !!w && now < w[0]
}

/** Display name; ad-hoc meetings are untitled until someone names them. */
export function meetingTitle(m: Pick<Meeting, 'title' | 'origin'>): string {
  if (m.title) return m.title
  return m.origin === 'device' ? 'Ad-hoc meeting' : 'Untitled meeting'
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const NTH_NAMES: Record<number, string> = { 1: 'First', 2: 'Second', 3: 'Third', 4: 'Fourth', [-1]: 'Last' }

/** ISO weekday (1 = Mon) → "Monday". */
export function weekdayName(isoWeekday: number): string {
  return WEEKDAY_NAMES[isoWeekday - 1] ?? '?'
}

/** "Every Saturday", "Every 2 weeks on Saturday", "Last Friday of each month". */
export function describeRecurrence(s: Pick<MeetingSchedule, 'freq' | 'interval_n' | 'weekday' | 'nth'>): string {
  const day = weekdayName(s.weekday)
  if (s.freq === 'monthly_nth_weekday') {
    return `${NTH_NAMES[s.nth ?? 1] ?? '?'} ${day} of each month`
  }
  return s.interval_n > 1 ? `Every ${s.interval_n} weeks on ${day}` : `Every ${day}`
}

/** "2 h", "1 h 30 min", "45 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h} h ${m} min`
  if (h) return `${h} h`
  return `${m} min`
}
