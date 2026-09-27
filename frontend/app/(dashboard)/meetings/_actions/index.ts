'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution, resolveDeviceScope } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'
import { zonedToUtcIso, formatZonedDate, formatZonedTime } from '@/lib/zoned-time'
import { meetingTitle } from '@/lib/meetings'
import type { Meeting } from '@/lib/types'

type Result = { error: string | null }

const DAY_MS = 86_400_000

// ── Guard shared by every action ──────────────────────────────────────────────
// Club tenants only; super_admin / admin (platform_admin passes requireRole but
// has no institution to act in). An admin pinned to one device may only touch
// that device's meetings and schedules, and may not create device-less ones.
async function clubContext() {
  const session = await requireRole('super_admin', 'admin')
  if (!session.institutionId) {
    return { error: 'Meetings are managed from a club account.' } as const
  }
  const institution = await getInstitution(session.institutionId)
  if (institution.type !== 'club') {
    return { error: 'Meetings are only available for clubs.' } as const
  }
  const scope = await resolveDeviceScope(session)
  const pinnedDeviceId = scope.mode === 'device' ? scope.deviceId : null
  return { session, institution, pinnedDeviceId, error: null } as const
}

type Ctx = Exclude<Awaited<ReturnType<typeof clubContext>>, { error: string }>

/** A device the caller may put a meeting on: their institution's, and their pinned one if pinned. */
async function checkDevice(ctx: Ctx, deviceId: string | null): Promise<string | null> {
  if (ctx.pinnedDeviceId) {
    return deviceId === ctx.pinnedDeviceId ? null : 'You can only schedule meetings on your assigned device.'
  }
  if (deviceId && !(await ownsRecord('devices', deviceId, ctx.session))) return 'Device not found.'
  return null
}

/** Load a meeting the caller may act on (tenant + device scope), or an error. */
async function loadMeeting(ctx: Ctx, id: string): Promise<{ meeting: Meeting } | { error: string }> {
  if (!(await ownsRecord('meetings', id, ctx.session))) return { error: 'Meeting not found.' }
  const { data } = await createAdminClient()
    .from('meetings')
    .select('id, title, origin, status, starts_at, ends_at, opened_at, closed_at, device_id, schedule_id, device_deleted_at')
    .eq('id', id)
    .single()
  if (!data) return { error: 'Meeting not found.' }
  const meeting = data as Meeting
  if (ctx.pinnedDeviceId && meeting.device_id !== ctx.pinnedDeviceId) return { error: 'Meeting not found.' }
  return { meeting }
}

function cleanTitle(title: string): string | null {
  const t = title.trim().replace(/\s+/g, ' ')
  return t ? t.slice(0, 120) : null
}

function refresh() {
  revalidatePath('/meetings')
  revalidatePath('/')
}

// ── Overlap check ────────────────────────────────────────────────────────────
// Core times only (starts_at … ends_at), not pre/post-roll: those overlap for
// back-to-back meetings by design, and resolve_meeting settles them. Clashes
// are on the same device, or where either meeting is open to all devices.
async function findOverlap(
  ctx: Ctx, startsAt: string, endsAt: string, deviceId: string | null, excludeId?: string,
): Promise<string | null> {
  let q = createAdminClient()
    .from('meetings')
    .select('id, title, origin, starts_at, device_id')
    .eq('institution_id', ctx.session.institutionId!)
    .neq('status', 'cancelled')
    .is('device_deleted_at', null)
    .lt('starts_at', endsAt)
    .or(`ends_at.gt.${startsAt},ends_at.is.null`)
  if (excludeId) q = q.neq('id', excludeId)
  const { data } = await q
  const clash = (data ?? []).find(
    (m) => deviceId === null || m.device_id === null || m.device_id === deviceId,
  )
  if (!clash) return null
  const tz = ctx.institution.timezone
  const when = `${formatZonedDate(clash.starts_at, tz)} ${formatZonedTime(clash.starts_at, tz, ctx.institution.time_format)}`
  return `Overlaps "${meetingTitle(clash)}" (${when}).`
}

/**
 * Local date + start/end ('HH:MM') → UTC instants. An end at or before the
 * start means the meeting runs past midnight into the next day.
 */
function toInstants(tz: string, date: string, start: string, end: string) {
  const startsAt = zonedToUtcIso(date, start, tz)
  const sameDayEnd = zonedToUtcIso(date, end, tz)
  if (!startsAt || !sameDayEnd) return null
  let endsMs = Date.parse(sameDayEnd)
  if (endsMs <= Date.parse(startsAt)) endsMs += DAY_MS
  return { startsAt, endsAt: new Date(endsMs).toISOString() }
}

// ── Meetings ─────────────────────────────────────────────────────────────────

export type MeetingInput = {
  title: string
  /** 'YYYY-MM-DD', local to the club. */
  date: string
  /** 'HH:MM', local to the club. */
  start: string
  end: string
  device_id: string | null
}

export async function createMeeting(input: MeetingInput): Promise<Result> {
  const ctx = await clubContext()
  if (ctx.error !== null) return { error: ctx.error }

  const deviceError = await checkDevice(ctx, input.device_id)
  if (deviceError) return { error: deviceError }

  const when = toInstants(ctx.institution.timezone, input.date, input.start, input.end)
  if (!when) return { error: 'Enter a valid date, start time and end time.' }
  if (Date.parse(when.endsAt) <= Date.now()) {
    // The sweep would close it at once and mark every member absent.
    return { error: 'That meeting has already ended. Pick a time that is still to come.' }
  }

  const overlap = await findOverlap(ctx, when.startsAt, when.endsAt, input.device_id)
  if (overlap) return { error: overlap }

  const { error } = await createAdminClient().from('meetings').insert({
    institution_id: ctx.session.institutionId,
    device_id: input.device_id,
    title: cleanTitle(input.title),
    origin: 'scheduled',
    status: 'scheduled',
    starts_at: when.startsAt,
    ends_at: when.endsAt,
  })
  if (error) return { error: error.message }

  refresh()
  return { error: null }
}

export async function updateMeeting(id: string, input: MeetingInput): Promise<Result> {
  const ctx = await clubContext()
  if (ctx.error !== null) return { error: ctx.error }
  const loaded = await loadMeeting(ctx, id)
  if ('error' in loaded) return { error: loaded.error }
  const { meeting } = loaded

  const supabase = createAdminClient()
  const started = Date.parse(meeting.starts_at) <= Date.now()

  // Once a meeting has started (or is closed / cancelled), scans may already
  // hang off its times and device: only the title can change.
  if (started || meeting.status === 'closed' || meeting.status === 'cancelled') {
    const { error } = await supabase.from('meetings').update({ title: cleanTitle(input.title) }).eq('id', id)
    if (error) return { error: error.message }
    refresh()
    return { error: null }
  }

  const deviceError = await checkDevice(ctx, input.device_id)
  if (deviceError) return { error: deviceError }
  const when = toInstants(ctx.institution.timezone, input.date, input.start, input.end)
  if (!when) return { error: 'Enter a valid date, start time and end time.' }
  if (Date.parse(when.endsAt) <= Date.now()) {
    return { error: 'That time has already passed. Pick a time that is still to come.' }
  }
  const overlap = await findOverlap(ctx, when.startsAt, when.endsAt, input.device_id, id)
  if (overlap) return { error: overlap }

  const { error } = await supabase
    .from('meetings')
    .update({ title: cleanTitle(input.title), starts_at: when.startsAt, ends_at: when.endsAt, device_id: input.device_id })
    .eq('id', id)
  if (error) {
    if (error.code === '23505') return { error: 'Another meeting from the same schedule already starts at that time.' }
    return { error: error.message }
  }

  refresh()
  return { error: null }
}

/**
 * End a meeting now. Scheduled meetings must have started (use Cancel for
 * future ones). The close sweep writes absences within ~15 minutes — never
 * here, so there is one writer of absences.
 */
export async function closeMeetingNow(id: string): Promise<Result> {
  const ctx = await clubContext()
  if (ctx.error !== null) return { error: ctx.error }
  const loaded = await loadMeeting(ctx, id)
  if ('error' in loaded) return { error: loaded.error }
  const { meeting } = loaded

  if (meeting.status !== 'scheduled' && meeting.status !== 'open') {
    return { error: 'This meeting is already closed or cancelled.' }
  }
  if (Date.parse(meeting.starts_at) > Date.now()) {
    return { error: 'This meeting hasn’t started yet — cancel it instead.' }
  }

  const now = new Date().toISOString()
  const { error } = await createAdminClient()
    .from('meetings')
    .update(meeting.origin === 'device'
      ? { status: 'closed', closed_at: now, ends_at: now }
      : { status: 'closed', closed_at: now })
    .eq('id', id)
    .in('status', ['scheduled', 'open'])
  if (error) return { error: error.message }

  refresh()
  return { error: null }
}

/** Cancel: never accepts scans again and never gets absences. Any scans already in it stay. */
export async function cancelMeeting(id: string): Promise<Result> {
  const ctx = await clubContext()
  if (ctx.error !== null) return { error: ctx.error }
  const loaded = await loadMeeting(ctx, id)
  if ('error' in loaded) return { error: loaded.error }
  if (loaded.meeting.status !== 'scheduled' && loaded.meeting.status !== 'open') {
    return { error: 'Only a meeting that hasn’t closed can be cancelled.' }
  }

  const { error } = await createAdminClient()
    .from('meetings')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .in('status', ['scheduled', 'open'])
  if (error) return { error: error.message }

  refresh()
  return { error: null }
}

/**
 * Delete a meeting with no attendance. For a future occurrence of a schedule
 * this is "skip this one": the generator never re-creates it. The attendance
 * FK (NO ACTION) refuses the delete if anything is recorded against it.
 */
export async function deleteMeeting(id: string): Promise<Result> {
  const ctx = await clubContext()
  if (ctx.error !== null) return { error: ctx.error }
  const loaded = await loadMeeting(ctx, id)
  if ('error' in loaded) return { error: loaded.error }

  const { error } = await createAdminClient().from('meetings').delete().eq('id', id)
  if (error) {
    if (error.code === '23503') return { error: 'Attendance is recorded against this meeting, so it can’t be deleted. Cancel it instead.' }
    return { error: error.message }
  }

  refresh()
  return { error: null }
}

// ── Recurring schedules ──────────────────────────────────────────────────────

export type ScheduleInput = {
  title: string
  freq: 'weekly' | 'monthly_nth_weekday'
  /** Weekly: every N weeks (1–12). Ignored for monthly. */
  interval_n: number
  /** ISO weekday, 1 = Mon … 7 = Sun. */
  weekday: number
  /** Monthly: 1–4, or -1 for last. Ignored for weekly. */
  nth: number | null
  /** 'HH:MM', local to the club. */
  start_time: string
  duration_minutes: number
  starts_on: string
  ends_on: string | null
  device_id: string | null
}

export async function createSchedule(input: ScheduleInput): Promise<Result & { created?: number }> {
  const ctx = await clubContext()
  if (ctx.error !== null) return { error: ctx.error }

  const deviceError = await checkDevice(ctx, input.device_id)
  if (deviceError) return { error: deviceError }

  const monthly = input.freq === 'monthly_nth_weekday'
  if (!Number.isInteger(input.weekday) || input.weekday < 1 || input.weekday > 7) return { error: 'Pick a day of the week.' }
  if (monthly && ![1, 2, 3, 4, -1].includes(input.nth ?? 0)) return { error: 'Pick which week of the month.' }
  if (!monthly && (!Number.isInteger(input.interval_n) || input.interval_n < 1 || input.interval_n > 12)) {
    return { error: 'Repeat every 1 to 12 weeks.' }
  }
  if (!/^\d{2}:\d{2}$/.test(input.start_time)) return { error: 'Enter a start time.' }
  if (!Number.isInteger(input.duration_minutes) || input.duration_minutes < 5 || input.duration_minutes > 1440) {
    return { error: 'Length must be between 5 minutes and 24 hours.' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.starts_on)) return { error: 'Enter a start date.' }
  if (input.ends_on && input.ends_on < input.starts_on) return { error: 'The end date must be on or after the start date.' }

  const supabase = createAdminClient()
  const { data: schedule, error } = await supabase
    .from('meeting_schedules')
    .insert({
      institution_id: ctx.session.institutionId,
      device_id: input.device_id,
      title: cleanTitle(input.title),
      freq: input.freq,
      interval_n: monthly ? 1 : input.interval_n,
      weekday: input.weekday,
      nth: monthly ? input.nth : null,
      start_time: input.start_time,
      duration_minutes: input.duration_minutes,
      starts_on: input.starts_on,
      ends_on: input.ends_on || null,
    })
    .select('id')
    .single()
  if (error || !schedule) return { error: error?.message ?? 'Could not create the schedule.' }

  // Materialise its first ~8 weeks now; the daily cron keeps it rolling.
  const { data: created, error: genError } = await supabase.rpc('generate_scheduled_meetings', {
    p_schedule_id: schedule.id,
  })
  refresh()
  if (genError) {
    return { error: `Schedule saved, but its meetings could not be generated yet (${genError.message}). They will appear after the nightly run.` }
  }
  return { error: null, created: (created as number | null) ?? 0 }
}

/** Stop a schedule: its not-yet-started meetings are removed; past ones stay. */
export async function endSchedule(id: string): Promise<Result & { removed?: number }> {
  const ctx = await clubContext()
  if (ctx.error !== null) return { error: ctx.error }
  if (!(await ownsRecord('meeting_schedules', id, ctx.session))) return { error: 'Schedule not found.' }

  const supabase = createAdminClient()
  if (ctx.pinnedDeviceId) {
    const { data } = await supabase.from('meeting_schedules').select('device_id').eq('id', id).single()
    if (data?.device_id !== ctx.pinnedDeviceId) return { error: 'Schedule not found.' }
  }

  const { data: removed, error } = await supabase.rpc('end_meeting_schedule', { p_schedule_id: id })
  if (error) return { error: error.message }

  refresh()
  return { error: null, removed: (removed as number | null) ?? 0 }
}
