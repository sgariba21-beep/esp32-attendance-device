import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution, resolveDeviceScope } from '@/lib/supabase/dal'
import { PageHeader } from '@/components/ui/page-header'
import { RealtimeRefresh } from '@/components/realtime-refresh'
import { isLive, isUpcoming } from '@/lib/meetings'
import { MeetingsView, type MeetingRow } from './_components/meetings-view'
import type { InstitutionConfig, Meeting, MeetingSchedule } from '@/lib/types'

// "Past" reaches back this far; older meetings are on the Attendance page.
const HISTORY_DAYS = 60

type DeviceRow = { id: string; group_name: string; unit_name: string; display_name: string | null }

/**
 * Everything the page shows, split into live / upcoming / past against one
 * clock read here on the server — so the rendered HTML and the client can
 * never disagree about which side of a meeting boundary "now" is.
 */
async function loadMeetings(institutionId: string, institution: InstitutionConfig, pinnedDeviceId: string | null) {
  const supabase = createAdminClient()
  const now = Date.now()
  const since = new Date(now - HISTORY_DAYS * 86_400_000).toISOString()

  let devicesQ = supabase
    .from('devices')
    .select('id, group_name, unit_name, display_name')
    .eq('institution_id', institutionId)
    .order('group_name')
    .order('unit_name')
  let meetingsQ = supabase
    .from('meetings')
    .select('id, title, origin, status, starts_at, ends_at, opened_at, closed_at, device_id, schedule_id, device_deleted_at')
    .eq('institution_id', institutionId)
    .gte('starts_at', since)
    .order('starts_at')
  let schedulesQ = supabase
    .from('meeting_schedules')
    .select('id, title, freq, interval_n, weekday, nth, start_time, duration_minutes, starts_on, ends_on, active, device_id')
    .eq('institution_id', institutionId)
    .eq('active', true)
    .order('created_at')
  if (pinnedDeviceId) {
    devicesQ = devicesQ.eq('id', pinnedDeviceId)
    meetingsQ = meetingsQ.or(`device_id.eq.${pinnedDeviceId},device_id.is.null`)
    schedulesQ = schedulesQ.or(`device_id.eq.${pinnedDeviceId},device_id.is.null`)
  }

  const [devicesRes, meetingsRes, schedulesRes, countsRes] = await Promise.all([
    devicesQ,
    meetingsQ,
    schedulesQ,
    // Aggregated in Postgres: never subject to the Data API row cap.
    supabase.rpc('meeting_attendance_counts', { p_institution_id: institutionId, p_since: since }),
  ])
  const devices = (devicesRes.data ?? []) as DeviceRow[]

  // Expected attendees: active tracked members on a device, or all of them
  // for a meeting open to every device. Exact counts (head: true).
  const trackedTypes = [
    ...(institution.track_students ? ['student'] : []),
    ...(institution.track_staff ? ['staff'] : []),
  ]
  const memberCount = (deviceId: string | null) => {
    let q = supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId)
      .eq('status', 'active')
      .in('member_type', trackedTypes)
    if (deviceId) q = q.eq('device_id', deviceId)
    return q
  }
  const expectedRes = await Promise.all([memberCount(null), ...devices.map((d) => memberCount(d.id))])
  const expected: Record<string, number> = { all: expectedRes[0].count ?? 0 }
  devices.forEach((d, i) => { expected[d.id] = expectedRes[i + 1].count ?? 0 })

  const counts = new Map<string, { present: number; absent: number }>()
  for (const c of (countsRes.data ?? []) as { meeting_id: string; present: number; absent: number }[]) {
    counts.set(c.meeting_id, { present: c.present, absent: c.absent })
  }

  const rows: MeetingRow[] = ((meetingsRes.data ?? []) as Meeting[]).map((m) => ({
    ...m,
    present: counts.get(m.id)?.present ?? 0,
    absent: counts.get(m.id)?.absent ?? 0,
    expected: expected[m.device_id ?? 'all'] ?? 0,
    started: Date.parse(m.starts_at) <= now,
  }))
  const live = rows.filter((m) => isLive(m, institution, now))
  const upcoming = rows.filter((m) => m.status !== 'cancelled' && isUpcoming(m, institution, now))
  const past = rows
    .filter((m) => !live.includes(m) && !upcoming.includes(m) && m.started)
    .reverse()

  return { live, upcoming, past, devices, schedules: (schedulesRes.data ?? []) as MeetingSchedule[] }
}

export default async function MeetingsPage() {
  const session = await requireRole('super_admin', 'admin')
  const institution = await getInstitution(session.institutionId)

  // platform_admin has no club of its own to schedule for.
  if (!session.institutionId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Meetings" subtitle="Platform administrator" />
        <p className="text-sm text-muted-foreground">
          Meetings are managed per club. Sign in with the club&apos;s own account to schedule them.
        </p>
      </div>
    )
  }
  if (institution.type !== 'club') redirect('/')

  const scope = await resolveDeviceScope(session)
  const pinnedDeviceId = scope.mode === 'device' ? scope.deviceId : null
  const data = await loadMeetings(session.institutionId, institution, pinnedDeviceId)

  return (
    <>
      <RealtimeRefresh />
      <MeetingsView
        {...data}
        pinnedDeviceId={pinnedDeviceId}
        historyDays={HISTORY_DAYS}
        config={{
          timezone: institution.timezone,
          time_format: institution.time_format,
          track_absences: institution.track_absences,
          label_member: institution.label_member,
          label_members: institution.label_members,
          label_unit: institution.label_unit,
        }}
      />
    </>
  )
}
