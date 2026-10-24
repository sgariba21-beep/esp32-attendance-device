'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution, resolveDeviceScope } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'
import { zonedToUtcIso, utcToZonedParts, todayInZone, formatZonedDate, formatZonedTime } from '@/lib/zoned-time'
import { meetingTitle } from '@/lib/meetings'
import type { Meeting, MeetingSchedule } from '@/lib/types'

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
    .select('id, title, origin, starts_at, ends_at, closed_at, device_id')
    .eq('institution_id', ctx.session.institutionId!)
    .neq('status', 'cancelled')
    .is('device_deleted_at', null)
    .lt('starts_at', endsAt)
    .or(`ends_at.gt.${startsAt},ends_at.is.null`)
  if (excludeId) q = q.neq('id', excludeId)
  const { data } = await q
  const start = Date.parse(startsAt)
  const clash = (data ?? []).find((m) => {
    if (!(deviceId === null || m.device_id === null || m.device_id === deviceId)) return false
    // An ad-hoc meeting still open has no end yet. A scheduled meeting that
    // starts after it was opened takes over from it at that start (see
    // 20261006120000), so only a meeting starting at or before its open
    // time clashes — an open ad-hoc meeting must not block every later
    // meeting, today's or any future day's.
    if (m.ends_at === null) return start <= Date.parse(m.starts_at)
    // A meeting closed early ("Close now") ends at closed_at, freeing the
    // rest of its slot for the next meeting that day.
    const end = m.closed_at ? Math.min(Date.parse(m.ends_at), Date.parse(m.closed_at)) : Date.parse(m.ends_at)
    return end > start
  })
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

/** The rule's columns as stored, or the first problem with the input. */
function scheduleFields(input: ScheduleInput) {
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
  return {
    error: null,
    fields: {
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
    },
  } as const
}

export async function createSchedule(input: ScheduleInput): Promise<Result & { created?: number }> {
  const ctx = await clubContext()
  if (ctx.error !== null) return { error: ctx.error }

  const deviceError = await checkDevice(ctx, input.device_id)
  if (deviceError) return { error: deviceError }

  const rule = scheduleFields(input)
  if (rule.error !== null) return { error: rule.error }

  const supabase = createAdminClient()
  const { data: schedule, error } = await supabase
    .from('meeting_schedules')
    .insert({ institution_id: ctx.session.institutionId, ...rule.fields })
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

/**
 * Edit a schedule. Only meetings that haven't started change: started ones are
 * history, and an upcoming one already holding a (pre-roll) scan is left too.
 *
 * Name, device, time, length and end date are applied to the upcoming meetings
 * in place, so skipped ones stay skipped, and a meeting whose name, device or
 * time was edited on its own keeps that edit. Changing the days it repeats on
 * moves every occurrence instead: the upcoming ones are deleted and generated
 * afresh from the new rule.
 *
 * Several writes, not one transaction. The only other writer is the nightly
 * generator (00:10), which works from generated_through.
 */
export async function updateSchedule(
  id: string, input: ScheduleInput,
): Promise<Result & { updated?: number; recreated?: boolean }> {
  const ctx = await clubContext()
  if (ctx.error !== null) return { error: ctx.error }
  if (!(await ownsRecord('meeting_schedules', id, ctx.session))) return { error: 'Schedule not found.' }

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('meeting_schedules')
    .select('id, title, freq, interval_n, weekday, nth, start_time, duration_minutes, starts_on, ends_on, active, device_id, generated_through')
    .eq('id', id)
    .single()
  const old = data as (MeetingSchedule & { generated_through: string | null }) | null
  if (!old) return { error: 'Schedule not found.' }
  if (ctx.pinnedDeviceId && old.device_id !== ctx.pinnedDeviceId) return { error: 'Schedule not found.' }
  if (!old.active) return { error: 'This schedule has ended.' }

  const deviceError = await checkDevice(ctx, input.device_id)
  if (deviceError) return { error: deviceError }
  const rule = scheduleFields(input)
  if (rule.error !== null) return { error: rule.error }
  const next = rule.fields

  const tz = ctx.institution.timezone
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const today = todayInZone(tz)
  if (next.ends_on && next.ends_on < today) {
    return { error: 'That end date has already passed. To stop this schedule, use End instead.' }
  }

  // Its meetings that haven't started, and which of them already hold a scan.
  const { data: upcomingData } = await supabase
    .from('meetings')
    .select('id, title, status, starts_at, ends_at, device_id')
    .eq('schedule_id', id)
    .gt('starts_at', nowIso)
  const upcoming = (upcomingData ?? []) as Pick<Meeting, 'id' | 'title' | 'status' | 'starts_at' | 'ends_at' | 'device_id'>[]
  const { data: scanned } = upcoming.length
    ? await supabase.from('attendance').select('meeting_id').in('meeting_id', upcoming.map((m) => m.id))
    : { data: [] }
  const held = new Set((scanned ?? []).map((a: { meeting_id: string }) => a.meeting_id))
  const free = upcoming.filter((m) => !held.has(m.id))
  const localDate = (iso: string) => utcToZonedParts(iso, tz).date
  const deleteMeetings = async (ids: string[]) => {
    if (!ids.length) return null
    const { error } = await supabase.from('meetings').delete().in('id', ids)
    if (error?.code === '23503') return 'A scan just arrived for one of the upcoming meetings. Try again.'
    return error?.message ?? null
  }

  const datesChanged = next.freq !== old.freq || next.interval_n !== old.interval_n
    || next.weekday !== old.weekday || next.nth !== old.nth || next.starts_on !== old.starts_on

  if (datesChanged) {
    // Generate again from today, or from the day after the latest meeting that
    // stays (started, or holding a scan) so no day gets a second one.
    const { data: lastStarted } = await supabase
      .from('meetings')
      .select('starts_at')
      .eq('schedule_id', id)
      .lte('starts_at', nowIso)
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)
    const generatedThrough = [
      yesterday,
      ...upcoming.filter((m) => held.has(m.id)).map((m) => localDate(m.starts_at)),
      ...(lastStarted ? [localDate(lastStarted.starts_at)] : []),
    ].sort().at(-1)

    const { error } = await supabase
      .from('meeting_schedules')
      .update({ ...next, generated_through: generatedThrough })
      .eq('id', id)
    if (error) return { error: error.message }
    const deleteError = await deleteMeetings(free.map((m) => m.id))
    if (deleteError) { refresh(); return { error: deleteError } }

    const { data: created, error: genError } = await supabase.rpc('generate_scheduled_meetings', { p_schedule_id: id })
    refresh()
    if (genError) {
      return { error: `Schedule saved, but its meetings could not be generated yet (${genError.message}). They will appear after the nightly run.` }
    }
    return { error: null, updated: (created as number | null) ?? 0, recreated: true }
  }

  // Same days: change the upcoming meetings in place.
  const timeChanged = next.start_time !== old.start_time.slice(0, 5) || next.duration_minutes !== old.duration_minutes
  const toDelete: string[] = []
  const patches: { id: string; patch: Record<string, string | null> }[] = []
  for (const m of free) {
    const day = localDate(m.starts_at)
    if (next.ends_on && day > next.ends_on) { toDelete.push(m.id); continue }
    if (m.status !== 'scheduled') continue

    const patch: Record<string, string | null> = {}
    if (next.title !== old.title && m.title === old.title) patch.title = next.title
    if (next.device_id !== old.device_id && m.device_id === old.device_id) patch.device_id = next.device_id
    const onRule = Date.parse(m.starts_at) === Date.parse(zonedToUtcIso(day, old.start_time, tz) ?? '')
      && !!m.ends_at && Date.parse(m.ends_at) - Date.parse(m.starts_at) === old.duration_minutes * 60_000
    const startsAt = timeChanged && onRule ? zonedToUtcIso(day, next.start_time, tz) : null
    if (startsAt) {
      const endsMs = Date.parse(startsAt) + next.duration_minutes * 60_000
      // Moved to a time already over: the sweep would close it at once and
      // mark everyone absent. The generator never creates one either.
      if (endsMs <= now) { toDelete.push(m.id); continue }
      patch.starts_at = startsAt
      patch.ends_at = new Date(endsMs).toISOString()
    }
    if (Object.keys(patch).length) patches.push({ id: m.id, patch })
  }

  // A shortened end date must also pull generated_through back, or extending
  // it again later would leave a gap the generator thinks it already filled.
  const generatedThrough = next.ends_on && old.generated_through && old.generated_through > next.ends_on
    ? next.ends_on
    : old.generated_through
  const { error } = await supabase
    .from('meeting_schedules')
    .update({ ...next, generated_through: generatedThrough })
    .eq('id', id)
  if (error) return { error: error.message }

  const results = await Promise.all(
    patches.map(({ id: meetingId, patch }) => supabase.from('meetings').update(patch).eq('id', meetingId)),
  )
  // 23505: another meeting of this schedule already sits at that time; leave this one.
  const failed = results.find((r) => r.error && r.error.code !== '23505')
  const deleteError = await deleteMeetings(toDelete)

  // A later (or removed) end date: top up to the usual horizon.
  const { data: created } = await supabase.rpc('generate_scheduled_meetings', { p_schedule_id: id })
  refresh()
  if (failed?.error) return { error: failed.error.message }
  if (deleteError) return { error: deleteError }
  const updated = results.filter((r) => !r.error).length + toDelete.length + ((created as number | null) ?? 0)
  return { error: null, updated, recreated: false }
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
