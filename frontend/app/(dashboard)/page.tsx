import Link from 'next/link'
import { verifySession, getInstitution, resolveDeviceScope } from '@/lib/supabase/dal'
import { createAdminClient } from '@/lib/supabase/server'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { CalendarDays, CalendarClock, Radio, UserCheck, UserX, Percent, Users, Cpu, Building2, Activity, ArrowRight, TrendingUp, Scissors, Package, ShoppingBag } from 'lucide-react'
import { formatMoney, formatClockTime } from '@/lib/utils'
import { formatZonedDate, formatZonedTime } from '@/lib/zoned-time'
import { isLive, isUpcoming, meetingTitle } from '@/lib/meetings'
import type { InstitutionConfig, Meeting } from '@/lib/types'
import { LOW_STOCK_THRESHOLD } from './reports/page'

export const dynamic = 'force-dynamic'

// ── Club overview data ──────────────────────────────────────────────────────
// Clubs are judged per meeting. Loaded outside the component so the single
// clock read (live / next / last) happens once, on the server.
const CLUB_LOOKBACK_DAYS = 90
const CLUB_RATED_MEETINGS = 10

type ClubMeeting = Meeting & { absences_written_at: string | null; present: number; absent: number }

async function loadClubOverview(institution: InstitutionConfig, institutionId: string, scopeDeviceId: string | null) {
  const supabase = createAdminClient()
  const now = Date.now()
  const since = new Date(now - CLUB_LOOKBACK_DAYS * 86_400_000).toISOString()

  let meetingsQ = supabase
    .from('meetings')
    .select('id, title, origin, status, starts_at, ends_at, opened_at, closed_at, device_id, schedule_id, device_deleted_at, absences_written_at')
    .eq('institution_id', institutionId)
    .neq('status', 'cancelled')
    .gte('starts_at', since)
    .order('starts_at')
  let membersQ = supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('institution_id', institutionId)
    .eq('status', 'active')
  let recentQ = supabase
    .from('attendance')
    .select('id, time, status, student:member_id(fullname, sid), device:device_id(group_name, unit_name), institution:institution_id(name)')
    .eq('institution_id', institutionId)
    .order('date', { ascending: false })
    .order('time', { ascending: false })
    .limit(8)
  // Device-scoped sessions: their device's meetings (plus all-device ones).
  if (scopeDeviceId) {
    meetingsQ = meetingsQ.or(`device_id.eq.${scopeDeviceId},device_id.is.null`)
    membersQ = membersQ.eq('device_id', scopeDeviceId)
    recentQ = recentQ.eq('device_id', scopeDeviceId)
  }

  const [meetingsRes, membersRes, recentRes, countsRes] = await Promise.all([
    meetingsQ,
    membersQ,
    recentQ,
    supabase.rpc('meeting_attendance_counts', { p_institution_id: institutionId, p_since: since }),
  ])

  const counts = new Map<string, { present: number; absent: number }>()
  for (const c of (countsRes.data ?? []) as { meeting_id: string; present: number; absent: number }[]) {
    counts.set(c.meeting_id, c)
  }
  const meetings: ClubMeeting[] = ((meetingsRes.data ?? []) as ClubMeeting[]).map((m) => ({
    ...m,
    present: counts.get(m.id)?.present ?? 0,
    absent: counts.get(m.id)?.absent ?? 0,
  }))

  const live = meetings.find((m) => isLive(m, institution, now)) ?? null
  const next = meetings.find((m) => isUpcoming(m, institution, now)) ?? null

  // A rate needs the absent side: only for meetings the close sweep has
  // written absences for, and only while the club tracks absences.
  const rateOf = (m: ClubMeeting) =>
    institution.track_absences && m.absences_written_at && m.present + m.absent > 0
      ? m.present / (m.present + m.absent)
      : null

  const finished = meetings
    .filter((m) => Date.parse(m.starts_at) <= now && m !== live)
    .reverse()
  const lastMeeting = finished[0] ?? null
  const rated = finished.filter((m) => rateOf(m) !== null).slice(0, CLUB_RATED_MEETINGS)
  const ratedPresent = rated.reduce((n, m) => n + m.present, 0)
  const ratedTotal = rated.reduce((n, m) => n + m.present + m.absent, 0)

  return {
    live,
    next,
    last: lastMeeting ? { ...lastMeeting, rate: rateOf(lastMeeting) } : null,
    // Pooled across meetings (not a mean of rates), so a small meeting
    // doesn't count as much as a full one.
    averageRate: ratedTotal > 0 ? ratedPresent / ratedTotal : null,
    ratedCount: rated.length,
    members: membersRes.count ?? 0,
    recent: (recentRes.data ?? []) as unknown as RecentRow[],
  }
}

function todayIn(tz: string): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: tz || 'UTC' })
  } catch {
    return new Date().toLocaleDateString('en-CA')
  }
}


type RecentRow = {
  id: string
  time: string
  status: 'present' | 'absent'
  student: { fullname: string; sid: string } | null
  device: { group_name: string; unit_name: string } | null
  institution: { name: string } | null
}

export default async function OverviewPage() {
  const session = await verifySession()
  const { role, assignedUnit, institutionId } = session
  const institution = await getInstitution(institutionId)
  const supabase = createAdminClient()
  const isPlatform = role === 'platform_admin'

  // ─────────────────────────────────────────── Platform admin overview ──
  if (isPlatform) {
    const today = todayIn('UTC')
    const [instCount, memberCount, deviceCount, scansToday, recentRes] = await Promise.all([
      supabase.from('institutions').select('id', { count: 'exact', head: true }),
      supabase.from('members').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('devices').select('id', { count: 'exact', head: true }),
      supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('date', today),
      supabase
        .from('attendance')
        .select('id, time, status, student:member_id(fullname, sid), device:device_id(group_name, unit_name), institution:institution_id(name)')
        .order('date', { ascending: false })
        .order('time', { ascending: false })
        .limit(8),
    ])
    const recent = (recentRes.data ?? []) as unknown as RecentRow[]

    return (
      <div className="space-y-8">
        <div>
          <p className="text-sm text-muted-foreground">Platform overview</p>
          <h1 className="text-[22px] font-semibold tracking-tight leading-tight">All institutions</h1>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Institutions" value={instCount.count ?? 0} icon={Building2} />
          <StatCard label="Active members" value={(memberCount.count ?? 0).toLocaleString()} icon={Users} />
          <StatCard label="Devices" value={deviceCount.count ?? 0} icon={Cpu} />
          <StatCard label="Scans today" value={(scansToday.count ?? 0).toLocaleString()} icon={Activity} tone="primary" />
        </div>

        <RecentActivity rows={recent} showInstitution timeFormat={institution.time_format} />

        <ManageLink href="/institutions" label="Manage institutions" />
      </div>
    )
  }

  // ─────────────────────────────────────────── Shop overview ──
  if (institution.type === 'shop') {
    const tz = institution.timezone ?? 'Africa/Accra'
    const today = todayIn(tz)
    const nextDay = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86400000)
      .toISOString().slice(0, 10)

    const [todayTxRes, recentSalesRes, visitsTodayRes, lowStockRes] = await Promise.all([
      supabase
        .from('transactions')
        .select('total, transaction_items(item_name, service_id, quantity)')
        .eq('institution_id', institutionId)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .lt('created_at', `${nextDay}T00:00:00.000Z`),
      supabase
        .from('transactions')
        .select('id, total, created_at, clients(name), members(fullname)')
        .eq('institution_id', institutionId)
        .order('created_at', { ascending: false })
        .limit(8),
      supabase
        .from('client_attendance')
        .select('id', { count: 'exact', head: true })
        .eq('institution_id', institutionId)
        .eq('date', today),
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('institution_id', institutionId)
        .eq('active', true)
        .lte('stock', LOW_STOCK_THRESHOLD),
    ])

    type TodayTx = { total: number; transaction_items: { item_name: string; service_id: string | null; quantity: number }[] }
    type RecentSale = { id: string; total: number; created_at: string; clients: { name: string } | null; members: { fullname: string } | null }

    const todayTxRows = (todayTxRes.data ?? []) as unknown as TodayTx[]
    const recentSaleRows = (recentSalesRes.data ?? []) as unknown as RecentSale[]

    const takingsToday = todayTxRows.reduce((sum, tx) => sum + Number(tx.total), 0)
    const visitsToday = visitsTodayRes.count ?? 0
    const lowStockCount = lowStockRes.count ?? 0

    // Top service today: most-sold service line item by quantity
    const svcQty = new Map<string, number>()
    for (const tx of todayTxRows) {
      for (const item of tx.transaction_items) {
        if (item.service_id) {
          svcQty.set(item.item_name, (svcQty.get(item.item_name) ?? 0) + item.quantity)
        }
      }
    }
    const topService = [...svcQty.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

    return (
      <div className="space-y-8">
        <div>
          <p className="text-sm text-muted-foreground">{institution.name}</p>
          <h1 className="text-[22px] font-semibold tracking-tight leading-tight">Overview</h1>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Takings today" value={formatMoney(takingsToday, institution.currency)} icon={TrendingUp} tone="success" />
          <StatCard label="Visits today" value={visitsToday} icon={Users} tone="primary" />
          <StatCard label="Top service today" value={topService} icon={Scissors} />
          <StatCard
            label="Low-stock products"
            value={lowStockCount}
            icon={Package}
            tone={lowStockCount > 0 ? 'destructive' : 'default'}
          />
        </div>

        <ShopRecentSales rows={recentSaleRows} timezone={tz} currency={institution.currency} labelStaff={institution.label_staff} />

        <ManageLink href="/reports" label="View reports" />
      </div>
    )
  }

  // Device scoping — teacher/staff always, admin when bound to a device.
  const scope = await resolveDeviceScope(session)
  const isUnitScoped = scope.mode !== 'all'
  const scopeDeviceId: string | null =
    scope.mode === 'device' ? scope.deviceId : scope.mode === 'none' ? '__none__' : null

  // ─────────────────────────────────────────── Club overview ──
  // Clubs take attendance per meeting, so the day-based cards below would be
  // meaningless: show the live / next meeting and per-meeting rates instead.
  if (institution.type === 'club' && institutionId) {
    const club = await loadClubOverview(institution, institutionId, scopeDeviceId)
    const tz = institution.timezone
    const when = (iso: string) => `${formatZonedDate(iso, tz)}, ${formatZonedTime(iso, tz, institution.time_format)}`
    const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`)

    return (
      <div className="space-y-8">
        <div>
          <p className="text-sm text-muted-foreground">
            {isUnitScoped && assignedUnit ? assignedUnit : institution.name}
          </p>
          <h1 className="text-[22px] font-semibold tracking-tight leading-tight">Overview</h1>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {club.live ? (
            <StatCard
              label="Live now"
              value={`${club.live.present} present`}
              hint={meetingTitle(club.live)}
              icon={Radio}
              tone="success"
            />
          ) : club.next ? (
            <StatCard label="Next meeting" value={when(club.next.starts_at)} hint={meetingTitle(club.next)} icon={CalendarClock} tone="primary" />
          ) : (
            <StatCard label="Next meeting" value="None scheduled" hint="Schedule one on the Meetings page" icon={CalendarClock} tone="muted" />
          )}
          <StatCard
            label="Last meeting"
            value={club.last ? (club.last.rate !== null ? pct(club.last.rate) : `${club.last.present} present`) : '—'}
            hint={club.last ? `${meetingTitle(club.last)} · ${formatZonedDate(club.last.starts_at, tz)}` : 'No meetings yet'}
            icon={UserCheck}
          />
          <StatCard
            label="Average attendance"
            value={institution.track_absences ? pct(club.averageRate) : 'Absences off'}
            hint={institution.track_absences
              ? (club.ratedCount > 0 ? `Last ${club.ratedCount} ${club.ratedCount === 1 ? 'meeting' : 'meetings'}` : 'No closed meetings yet')
              : 'Turn on in Settings to see rates'}
            icon={Percent}
            tone={institution.track_absences ? 'primary' : 'muted'}
          />
          <StatCard label={`Active ${institution.label_members.toLowerCase()}`} value={club.members.toLocaleString()} icon={Users} />
        </div>

        <RecentActivity rows={club.recent} unitLabel={institution.label_unit} timeFormat={institution.time_format} />

        <ManageLink href="/meetings" label="Manage meetings" />
      </div>
    )
  }

  // ─────────────────────────────────────────── Institution overview ──
  const today = todayIn(institution.timezone)

  let membersQ = supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('institution_id', institutionId)
    .eq('status', 'active')
  if (isUnitScoped) membersQ = membersQ.eq('device_id', scopeDeviceId)

  const devicesQ = supabase
    .from('devices')
    .select('id', { count: 'exact', head: true })
    .eq('institution_id', institutionId)

  let todayQ = supabase
    .from('attendance')
    .select('member_id, status')
    .eq('institution_id', institutionId)
    .eq('date', today)
  if (isUnitScoped) todayQ = todayQ.eq('device_id', scopeDeviceId)

  let recentQ = supabase
    .from('attendance')
    .select('id, time, status, student:member_id(fullname, sid), device:device_id(group_name, unit_name), institution:institution_id(name)')
    .eq('institution_id', institutionId)
    .order('date', { ascending: false })
    .order('time', { ascending: false })
    .limit(8)
  if (isUnitScoped) recentQ = recentQ.eq('device_id', scopeDeviceId)

  const [membersRes, devicesRes, todayRes, recentRes] = await Promise.all([
    membersQ,
    devicesQ,
    todayQ,
    recentQ,
  ])

  const todayRows = (todayRes.data ?? []) as { member_id: string; status: string }[]
  const presentMembers = new Set(todayRows.filter((r) => r.status === 'present').map((r) => r.member_id))
  const absentMembers = new Set(todayRows.filter((r) => r.status === 'absent').map((r) => r.member_id))
  const present = presentMembers.size
  const absent = absentMembers.size
  const tracked = present + absent
  const rate = tracked > 0 ? `${Math.round((present / tracked) * 100)}%` : '—'
  const recent = (recentRes.data ?? []) as unknown as RecentRow[]

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">
          {isUnitScoped && assignedUnit ? assignedUnit : institution.name}
        </p>
        <h1 className="text-[22px] font-semibold tracking-tight leading-tight">Overview</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Present today" value={present} icon={UserCheck} tone="success" />
        <StatCard label="Absent today" value={absent} icon={UserX} tone={absent > 0 ? 'destructive' : 'default'} />
        <StatCard label="Attendance rate" value={rate} icon={Percent} tone="primary" />
        {isUnitScoped ? (
          <StatCard label={`Active ${institution.label_members.toLowerCase()}`} value={(membersRes.count ?? 0).toLocaleString()} icon={Users} />
        ) : (
          <StatCard label="Devices" value={devicesRes.count ?? 0} icon={Cpu} />
        )}
      </div>

      <RecentActivity rows={recent} unitLabel={institution.label_unit} timeFormat={institution.time_format} />

      <ManageLink href="/attendance" label="View all attendance" />
    </div>
  )
}

function RecentActivity({
  rows,
  showInstitution = false,
  unitLabel = 'Unit',
  timeFormat = '24h',
}: {
  rows: RecentRow[]
  showInstitution?: boolean
  unitLabel?: string
  timeFormat?: '12h' | '24h'
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Recent activity</h2>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={CalendarDays} message="No attendance recorded yet." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                {showInstitution && <TableHead>Institution</TableHead>}
                <TableHead>{unitLabel}</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.student?.fullname ?? '—'}</TableCell>
                  {showInstitution && (
                    <TableCell className="text-muted-foreground text-xs">{r.institution?.name ?? '—'}</TableCell>
                  )}
                  <TableCell className="text-muted-foreground">
                    {r.device ? `${r.device.group_name} ${r.device.unit_name}` : '—'}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{formatClockTime(r.time, timeFormat)}</TableCell>
                  <TableCell className="text-right">
                    {r.status === 'present'
                      ? <Badge variant="success">Present</Badge>
                      : <Badge variant="destructive">Absent</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

type ShopSaleRow = {
  id: string
  total: number
  created_at: string
  clients: { name: string } | null
  members: { fullname: string } | null
}

function ShopRecentSales({ rows, timezone, currency, labelStaff }: { rows: ShopSaleRow[]; timezone: string; currency: string; labelStaff: string }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Recent sales</h2>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={ShoppingBag} message="No sales recorded yet." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border shadow-xs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>{labelStaff}</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const dt = new Date(r.created_at)
                const time = dt.toLocaleTimeString('en-GH', { timeZone: timezone, hour: '2-digit', minute: '2-digit' })
                const date = dt.toLocaleDateString('en-GH', { timeZone: timezone, month: 'short', day: 'numeric' })
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.clients?.name ?? '—'}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{date}, {time}</TableCell>
                    <TableCell className="text-muted-foreground">{r.members?.fullname ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatMoney(r.total, currency)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function ManageLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-4"
    >
      {label}
      <ArrowRight className="h-4 w-4" />
    </Link>
  )
}
