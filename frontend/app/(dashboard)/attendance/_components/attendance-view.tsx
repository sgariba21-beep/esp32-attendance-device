'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useCallback, useMemo, useTransition } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CalendarDays, Lock, Download } from 'lucide-react'
import type { UserRole } from '@/lib/supabase/dal'
import { EmptyState } from '@/components/ui/empty-state'
import { NativeSelect } from '@/components/ui/native-select'
import { PageHeader } from '@/components/ui/page-header'
import { Pagination } from '@/components/ui/pagination'
import { Toolbar, ToolbarField, ToolbarSeparator } from '@/components/ui/toolbar'
import { MultiSelect } from './multi-select'
import { pluralize } from '@/lib/utils'
import type { AttendanceRecord, Device, AcademicTerm } from '@/lib/types'

type MemberOption = { id: string; sid: string; fullname: string; group_name: string; device_id: string }

type MemberStat = {
  id: string
  fullname: string
  sid: string
  member_type: string
  present: number
  absent: number
  lastSeen: string | null
}

type Labels = {
  label_member: string
  label_members: string
  label_staff: string
  label_staff_plural: string
  label_unit: string
  label_period: string
}

type Filters = {
  fromDate?: string
  toDate?: string
  termId?: string
  studentIds: string[]
  staffIds: string[]
  deviceIds: string[]
  typeFilter?: string
  institutionFilter?: string
  statusFilter?: string
}

type Props = {
  records: AttendanceRecord[]
  students: MemberOption[]
  staffMembers: MemberOption[]
  devices: Device[]
  academic: AcademicTerm[]
  filters: Filters
  page: number
  pageSize: number
  totalCount: number
  role: UserRole
  assignedUnit: string | null
  labels: Labels
  institutions: { id: string; name: string; track_students: boolean; track_staff: boolean }[]
  track_students: boolean
  track_staff: boolean
  institutionType: 'school' | 'office' | 'shop'
  memberStats: MemberStat[]
  teacherNoDevice?: boolean
}

function formatClass(device: { group_name: string; unit_name: string }) {
  return `${device.group_name} ${device.unit_name}`
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatShortDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${m} ${ampm}`
}

function memberRateColor(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground'
  if (rate >= 80) return 'text-success-foreground'
  if (rate >= 60) return 'text-warning-foreground'
  return 'text-destructive'
}

type PairedRow = {
  id: string
  date: string
  institution: AttendanceRecord['institution']
  student: AttendanceRecord['student']
  device: AttendanceRecord['device']
  academic: AttendanceRecord['academic']
  timeIn: string | null
  timeOut: string | null
  isAbsent: boolean
}

// Collapses time_in / time_out siblings into one row per (member, date, device, period).
// Records arrive date desc, time desc so time_out always precedes time_in for the same session.
// Absent records are kept as individual rows (no times to pair).
function pairRecords(records: AttendanceRecord[]): PairedRow[] {
  const map = new Map<string, PairedRow>()
  const order: string[] = []

  for (const r of records) {
    if (r.status === 'absent') {
      const k = `absent-${r.id}`
      map.set(k, {
        id: r.id, date: r.date, institution: r.institution,
        student: r.student, device: r.device, academic: r.academic,
        timeIn: null, timeOut: null, isAbsent: true,
      })
      order.push(k)
      continue
    }

    const k = `${r.student?.id ?? r.id}||${r.date}||${r.device?.id ?? ''}||${r.academic?.id ?? ''}`
    if (!map.has(k)) {
      map.set(k, {
        id: r.id, date: r.date, institution: r.institution,
        student: r.student, device: r.device, academic: r.academic,
        timeIn: null, timeOut: null, isAbsent: false,
      })
      order.push(k)
    }
    const row = map.get(k)!
    if (r.scan_type === 'time_in') row.timeIn = r.time
    else if (r.scan_type === 'time_out') row.timeOut = r.time
    else row.timeIn = r.time  // present_absent record in a mixed dataset
  }

  return order.map((k) => map.get(k)!)
}

type SummaryRow = {
  key: string
  classLabel: string
  term: string
  year: string
  present: number
  absent: number
  total: number
}

function buildSummary(records: AttendanceRecord[]): SummaryRow[] {
  const map = new Map<string, SummaryRow>()

  for (const r of records) {
    const term = r.academic?.term ?? '—'
    const year = r.academic?.year ?? '—'
    const classLabel = r.device ? formatClass(r.device) : '—'
    const key = `${classLabel}||${term}||${year}`

    if (!map.has(key)) {
      map.set(key, { key, classLabel, term, year, present: 0, absent: 0, total: 0 })
    }
    const row = map.get(key)!
    row.total++
    if (r.status === 'present') row.present++
    else row.absent++
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.year !== b.year) return b.year.localeCompare(a.year)
    if (a.term !== b.term) return a.term.localeCompare(b.term)
    return a.classLabel.localeCompare(b.classLabel)
  })
}

export function AttendanceView({
  records, students, staffMembers, devices, academic, filters, page, pageSize,
  totalCount, role, assignedUnit, labels, institutions,
  track_students, track_staff, institutionType, memberStats, teacherNoDevice,
}: Props) {
  const isTeacher = role === 'teacher' || role === 'staff'

  if (isTeacher && teacherNoDevice) {
    return (
      <div className="space-y-6">
        <PageHeader title="Attendance" />
        <EmptyState
          icon={<Lock className="h-8 w-8 text-muted-foreground" />}
          title="No unit assigned"
          description="Your account isn't assigned to a unit yet — contact your administrator."
        />
      </div>
    )
  }
  const isPlatformAdmin = role === 'platform_admin'
  const isOffice = institutionType === 'office'
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  const [fromDate, setFromDate] = useState(filters.fromDate ?? '')
  const [toDate, setToDate] = useState(filters.toDate ?? '')
  const [termId, setTermId] = useState(filters.termId ?? '')
  const [studentIds, setStudentIds] = useState<string[]>(filters.studentIds)
  const [staffIds, setStaffIds] = useState<string[]>(filters.staffIds)
  const [deviceIds, setDeviceIds] = useState<string[]>(filters.deviceIds)
  const [typeFilter, setTypeFilter] = useState(filters.typeFilter ?? '')
  const [institutionFilter, setInstitutionFilter] = useState(filters.institutionFilter ?? '')
  const [statusFilter, setStatusFilter] = useState(filters.statusFilter ?? '')

  // For platform_admin: when an institution is selected, use its tracking flags to
  // control which type options appear. When none selected, show both.
  const selectedInstConfig = isPlatformAdmin && institutionFilter
    ? institutions.find((i) => i.id === institutionFilter) ?? null
    : null
  const showStudentType = isPlatformAdmin
    ? (selectedInstConfig ? selectedInstConfig.track_students : true)
    : (!isOffice && track_students)
  const showStaffType = isPlatformAdmin
    ? (selectedInstConfig ? selectedInstConfig.track_staff : true)
    : track_staff
  // Platform admin sees cross-institution data — always call students "Students".
  // Non-platform_admin uses their institution's custom label (e.g. "Employees").
  const studentFilterLabel = isPlatformAdmin ? 'Students' : labels.label_members

  const memberTabLabel = track_students && track_staff
    ? `${labels.label_members} / ${labels.label_staff_plural}`
    : track_staff
      ? labels.label_staff_plural
      : labels.label_members

  const buildParams = useCallback(
    (overrides: Partial<{
      from: string; to: string; term: string
      students: string[]; staff: string[]; classes: string[]
      type: string; institution: string; status: string; page: number
    }>) => {
      const current = {
        from: fromDate, to: toDate, term: termId,
        students: studentIds, staff: staffIds, classes: deviceIds,
        type: typeFilter, institution: institutionFilter, status: statusFilter, page: 1,
        ...overrides,
      }
      const p = new URLSearchParams()
      if (current.from) p.set('from', current.from)
      if (current.to) p.set('to', current.to)
      if (current.term) p.set('term', current.term)
      if (current.students.length) p.set('students', current.students.join(','))
      if (current.staff.length) p.set('staff', current.staff.join(','))
      if (current.classes.length) p.set('classes', current.classes.join(','))
      if (current.type) p.set('type', current.type)
      if (current.institution) p.set('institution', current.institution)
      if (current.status) p.set('status', current.status)
      if (current.page > 1) p.set('page', current.page.toString())
      return p.toString()
    },
    [fromDate, toDate, termId, studentIds, staffIds, deviceIds, typeFilter, institutionFilter, statusFilter]
  )

  const applyFilters = useCallback(
    (overrides: Parameters<typeof buildParams>[0]) => {
      startTransition(() => {
        router.push(`${pathname}?${buildParams(overrides)}`)
      })
    },
    [buildParams, pathname, router]
  )

  const goToPage = useCallback(
    (p: number) => {
      startTransition(() => {
        router.push(`${pathname}?${buildParams({ page: p })}`)
      })
    },
    [buildParams, pathname, router]
  )

  function clearFilters() {
    setFromDate(''); setToDate(''); setTermId('')
    setStudentIds([]); setStaffIds([]); setDeviceIds([])
    setTypeFilter(''); setInstitutionFilter(''); setStatusFilter('')
    startTransition(() => { router.push(pathname) })
  }

  function buildExportUrl() {
    const qs = buildParams({ page: 1 })
    return `/api/attendance/export${qs ? `?${qs}` : ''}`
  }

  const hasFilters = !!(fromDate || toDate || termId || studentIds.length || staffIds.length || deviceIds.length || typeFilter || institutionFilter || statusFilter)
  const summary = buildSummary(records)
  const totalPages = Math.ceil(totalCount / pageSize)
  const showInstitutionColumn = isPlatformAdmin

  const hasTimeInOut = records.some((r) => r.scan_type === 'time_in' || r.scan_type === 'time_out')
  const pairedRows = hasTimeInOut ? pairRecords(records) : []

  const studentOptions = useMemo(() => {
    const base = deviceIds.length > 0
      ? students.filter((s) => deviceIds.includes(s.device_id))
      : students
    return base.map((s) => ({ value: s.id, label: `${s.fullname} (${s.sid})` }))
  }, [students, deviceIds])

  const staffOptions = useMemo(() => {
    const base = deviceIds.length > 0
      ? staffMembers.filter((s) => deviceIds.includes(s.device_id))
      : staffMembers
    return base.map((s) => ({ value: s.id, label: `${s.fullname} (${s.sid})` }))
  }, [staffMembers, deviceIds])

  const classOptions = devices.map((d) => ({ value: d.id, label: formatClass(d) }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        actions={
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
            <a href={buildExportUrl()} download="attendance-export.csv">
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-1.5" />
                Export CSV
              </Button>
            </a>
          </div>
        }
      />

      {/* Filter bar */}
      <Toolbar>
        {/* Institution filter — platform_admin only */}
        {isPlatformAdmin && institutions.length > 0 && (
          <ToolbarField label="Institution" htmlFor="institution-filter">
            <NativeSelect
              id="institution-filter"
              value={institutionFilter}
              onChange={(e) => {
                setInstitutionFilter(e.target.value)
                setStudentIds([]); setStaffIds([]); setDeviceIds([]); setTypeFilter('')
                applyFilters({ institution: e.target.value, students: [], staff: [], classes: [], type: '' })
              }}
              className="w-56"
            >
              <option value="">All institutions</option>
              {institutions.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.name}</option>
              ))}
            </NativeSelect>
          </ToolbarField>
        )}

        <ToolbarField label="From" htmlFor="from-date">
          <Input
            id="from-date"
            type="date"
            className="w-40"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); applyFilters({ from: e.target.value }) }}
          />
        </ToolbarField>
        <ToolbarField label="To" htmlFor="to-date">
          <Input
            id="to-date"
            type="date"
            className="w-40"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); applyFilters({ to: e.target.value }) }}
          />
        </ToolbarField>

        <ToolbarField label={labels.label_period} htmlFor="term-filter">
          <NativeSelect
            id="term-filter"
            value={termId}
            onChange={(e) => { setTermId(e.target.value); applyFilters({ term: e.target.value }) }}
          >
            <option value="">All {pluralize(labels.label_period.toLowerCase())}</option>
            {academic.map((a) => (
              <option key={a.id} value={a.id}>{a.term} {a.year}</option>
            ))}
          </NativeSelect>
        </ToolbarField>

        <ToolbarField label="Member type" htmlFor="type-filter">
          <NativeSelect
            id="type-filter"
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); applyFilters({ type: e.target.value }) }}
          >
            <option value="">All types</option>
            {showStudentType && <option value="student">Student</option>}
            {showStaffType && <option value="staff">{labels.label_staff}</option>}
          </NativeSelect>
        </ToolbarField>

        <ToolbarField label="Status" htmlFor="status-filter">
          <NativeSelect
            id="status-filter"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); applyFilters({ status: e.target.value }) }}
          >
            <option value="">All</option>
            <option value="present">Present</option>
            <option value="absent">Absent</option>
          </NativeSelect>
        </ToolbarField>

        <ToolbarSeparator />

        {isTeacher && assignedUnit && (
          <div className="flex h-8 items-center gap-1.5 self-end rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
            <Lock className="h-3 w-3 shrink-0" />
            {assignedUnit}
          </div>
        )}

        {/* Student member filter */}
        {showStudentType && (
          <ToolbarField label={studentFilterLabel}>
            <MultiSelect
              options={studentOptions}
              selected={studentIds}
              onChange={(val) => {
                setStudentIds(val)
                applyFilters({ students: val })
              }}
              placeholder={`All ${studentFilterLabel.toLowerCase()}`}
            />
          </ToolbarField>
        )}

        {/* Staff member filter */}
        {showStaffType && (
          <ToolbarField label={labels.label_staff_plural}>
            <MultiSelect
              options={staffOptions}
              selected={staffIds}
              onChange={(val) => {
                setStaffIds(val)
                applyFilters({ staff: val })
              }}
              placeholder={`All ${labels.label_staff_plural.toLowerCase()}`}
            />
          </ToolbarField>
        )}

        {/* Unit filter */}
        {!isTeacher && (
          <ToolbarField label={pluralize(labels.label_unit)}>
            <MultiSelect
              options={classOptions}
              selected={deviceIds}
              onChange={(val) => {
                setDeviceIds(val)
                // When unit filter changes, drop member selections that no longer match
                const validIds = val.length > 0
                  ? new Set([
                      ...students.filter((s) => val.includes(s.device_id)).map((s) => s.id),
                      ...staffMembers.filter((s) => val.includes(s.device_id)).map((s) => s.id),
                    ])
                  : null
                const nextStudentIds = validIds ? studentIds.filter((id) => validIds.has(id)) : studentIds
                const nextStaffIds = validIds ? staffIds.filter((id) => validIds.has(id)) : staffIds
                if (nextStudentIds.length !== studentIds.length) setStudentIds(nextStudentIds)
                if (nextStaffIds.length !== staffIds.length) setStaffIds(nextStaffIds)
                applyFilters({ classes: val, students: nextStudentIds, staff: nextStaffIds })
              }}
              placeholder={`All ${pluralize(labels.label_unit.toLowerCase())}`}
            />
          </ToolbarField>
        )}
      </Toolbar>

      <div className={`transition-opacity duration-150 ${isPending ? 'opacity-50 pointer-events-none' : ''}`}>
        <Tabs defaultValue="records">
          <TabsList>
            <TabsTrigger value="records">Records ({totalCount.toLocaleString()})</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="by-member">By {memberTabLabel} ({memberStats.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="records" className="mt-4 space-y-3">
            {records.length === 0 ? (
              <EmptyState icon={CalendarDays} message="No attendance records match your filters." />
            ) : hasTimeInOut ? (
              <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      {showInstitutionColumn && <TableHead>Institution</TableHead>}
                      <TableHead>{labels.label_member}</TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>{labels.label_unit}</TableHead>
                      <TableHead>{labels.label_period}</TableHead>
                      <TableHead>Time In</TableHead>
                      <TableHead>Time Out</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pairedRows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                        {showInstitutionColumn && (
                          <TableCell className="text-muted-foreground text-xs">{r.institution?.name ?? '—'}</TableCell>
                        )}
                        <TableCell>{r.student?.fullname ?? '—'}</TableCell>
                        <TableCell className="font-mono tabular-nums text-muted-foreground text-xs">
                          {r.student?.sid ?? '—'}
                        </TableCell>
                        <TableCell>{r.device ? formatClass(r.device) : '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                          {r.academic ? `${r.academic.term} ${r.academic.year}` : '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {r.timeIn ? formatTime(r.timeIn) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {r.timeOut ? formatTime(r.timeOut) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {r.isAbsent
                            ? <Badge variant="destructive">Absent</Badge>
                            : <Badge variant="success">Present</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      {showInstitutionColumn && <TableHead>Institution</TableHead>}
                      <TableHead>{labels.label_member}</TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>{labels.label_unit}</TableHead>
                      <TableHead>{labels.label_period}</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                        {showInstitutionColumn && (
                          <TableCell className="text-muted-foreground text-xs">{r.institution?.name ?? '—'}</TableCell>
                        )}
                        <TableCell>{r.student?.fullname ?? '—'}</TableCell>
                        <TableCell className="font-mono tabular-nums text-muted-foreground text-xs">
                          {r.student?.sid ?? '—'}
                        </TableCell>
                        <TableCell>{r.device ? formatClass(r.device) : '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                          {r.academic ? `${r.academic.term} ${r.academic.year}` : '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatTime(r.time)}</TableCell>
                        <TableCell>
                          {r.status === 'absent'
                            ? <Badge variant="destructive">Absent</Badge>
                            : <Badge variant="success">Present</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {totalCount > pageSize && (
              <Pagination
                page={page}
                totalPages={totalPages}
                totalCount={totalCount}
                pageSize={pageSize}
                onPageChange={goToPage}
              />
            )}
          </TabsContent>

          <TabsContent value="summary" className="mt-4">
            {summary.length === 0 ? (
              <EmptyState icon={CalendarDays} message="No data to summarise. Add attendance records first." />
            ) : (
              <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{labels.label_unit}</TableHead>
                      <TableHead>{labels.label_period}</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead className="text-right">Attendance %</TableHead>
                      <TableHead className="text-right">Present</TableHead>
                      <TableHead className="text-right">Absent</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>{row.classLabel}</TableCell>
                        <TableCell>{row.term}</TableCell>
                        <TableCell>{row.year}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {row.total > 0 ? `${Math.round((row.present / row.total) * 100)}%` : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-success-foreground font-medium">
                          {row.present}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-destructive font-medium">
                          {row.absent}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="by-member" className="mt-4">
            {memberStats.length === 0 ? (
              <EmptyState icon={CalendarDays} message="No attendance records match your filters." />
            ) : (
              <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{labels.label_member}</TableHead>
                      <TableHead className="text-right">Present</TableHead>
                      <TableHead className="text-right">Absent</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Rate %</TableHead>
                      <TableHead>Last Seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {memberStats.map((m) => {
                      const total = m.present + m.absent
                      const rate = total > 0 ? Math.round((m.present / total) * 100) : null
                      return (
                        <TableRow key={m.id}>
                          <TableCell>
                            <div>{m.fullname}</div>
                            <div className="font-mono text-xs text-muted-foreground tabular-nums">{m.sid}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-success-foreground font-medium">
                            {m.present}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-destructive font-medium">
                            {m.absent}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {total}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums font-bold ${memberRateColor(rate)}`}>
                            {rate !== null ? `${rate}%` : '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {m.lastSeen
                              ? formatShortDate(m.lastSeen)
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
