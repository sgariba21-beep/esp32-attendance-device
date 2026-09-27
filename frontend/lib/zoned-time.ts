// Wall-clock <-> instant conversion in an institution's IANA timezone.
//
// Meeting times are entered and shown in the INSTITUTION's timezone, never the
// viewer's browser timezone — an organiser travelling, or a platform admin
// abroad, must still schedule "10:00" as 10:00 at the club. Intl does the zone
// maths, so DST is handled without a date library.

/** Milliseconds the zone is ahead of UTC at `instant` (e.g. +3h for Africa/Nairobi). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - instant
}

const DAY = 86_400_000

/**
 * The instant at which it is `date` `time` on the wall clock in `timeZone`.
 * `date` is 'YYYY-MM-DD', `time` is 'HH:MM' or 'HH:MM:SS'. Returns an ISO
 * string, or null for malformed input or an unknown zone.
 *
 * Matches Postgres's `timestamp AT TIME ZONE`, which is what the schedule
 * generator uses — so a one-off meeting and a generated one at the same wall
 * time are the same instant, DST edge cases included. Postgres reads an
 * ambiguous wall time (fall-back: 01:30 happens twice) AND a non-existent one
 * (spring-forward: 02:30 is skipped) in STANDARD time — the smaller of the
 * two offsets around the change.
 */
export function zonedToUtcIso(date: string, time: string, timeZone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time)
  if (!d || !t) return null
  const wall = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +(t[3] ?? 0))
  if (Number.isNaN(wall)) return null
  try {
    // The offsets in force a day either side cover any single DST change.
    const before = zoneOffsetMs(wall - DAY, timeZone)
    const after = zoneOffsetMs(wall + DAY, timeZone)
    // A candidate is real if the zone's offset at that instant is the one assumed.
    const valid = [...new Set([wall - before, wall - after])]
      .filter((instant) => zoneOffsetMs(instant, timeZone) === wall - instant)
    const instant = valid.length === 1 ? valid[0] : wall - Math.min(before, after)
    return new Date(instant).toISOString()
  } catch {
    return null
  }
}

/** 'YYYY-MM-DD' and 'HH:MM' on the wall clock in `timeZone` at `iso`. */
export function utcToZonedParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

/** "Sat 3 Oct 2026" in `timeZone`. */
export function formatZonedDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

/** "10:00" / "10:00 AM" in `timeZone`, honouring institutions.time_format. */
export function formatZonedTime(iso: string, timeZone: string, format: '12h' | '24h' = '24h'): string {
  return new Date(iso).toLocaleTimeString(format === '12h' ? 'en-US' : 'en-GB', {
    timeZone, hour: format === '12h' ? 'numeric' : '2-digit', minute: '2-digit', hour12: format === '12h',
  })
}

/** Today's 'YYYY-MM-DD' in `timeZone`. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return utcToZonedParts(now.toISOString(), timeZone).date
}
