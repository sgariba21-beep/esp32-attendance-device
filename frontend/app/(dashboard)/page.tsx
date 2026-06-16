import Link from 'next/link'
import { verifySession, getInstitution } from '@/lib/supabase/dal'
import { createAdminClient } from '@/lib/supabase/server'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { CalendarDays, UserCheck, UserX, Percent, Users, Cpu, Building2, Activity, ArrowRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

function todayIn(tz: string): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: tz || 'UTC' })
  } catch {
    return new Date().toLocaleDateString('en-CA')
  }
}

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${m} ${ampm}`
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
  const { role, assignedUnit, institutionId } = await verifySession()
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

        <RecentActivity rows={recent} showInstitution />

        <ManageLink href="/institutions" label="Manage institutions" />
      </div>
    )
  }

  // ─────────────────────────────────────────── Institution overview ──
  const today = todayIn(institution.timezone)
  const isUnitScoped = role === 'teacher' || role === 'staff'

  let scopeDeviceId: string | null = null
  if (isUnitScoped) {
    const { data: devs } = await supabase
      .from('devices')
      .select('id, group_name, unit_name')
      .eq('institution_id', institutionId)
    scopeDeviceId =
      devs?.find((d) => `${d.group_name} ${d.unit_name}` === assignedUnit)?.id ?? '__none__'
  }

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

      <RecentActivity rows={recent} unitLabel={institution.label_unit} />

      <ManageLink href="/attendance" label="View all attendance" />
    </div>
  )
}

function RecentActivity({
  rows,
  showInstitution = false,
  unitLabel = 'Unit',
}: {
  rows: RecentRow[]
  showInstitution?: boolean
  unitLabel?: string
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
                  <TableCell className="tabular-nums text-muted-foreground">{formatTime(r.time)}</TableCell>
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
