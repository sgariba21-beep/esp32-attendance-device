'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useCallback, useMemo, useTransition } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { MultiSelect } from './multi-select'
import type { AttendanceRecord, Device, AcademicTerm } from '@/lib/types'

type MemberOption = { id: string; sid: string; fullname: string; group_name: string; device_id: string }

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
  institutionType: 'school' | 'office'
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

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${m} ${ampm}`
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
  track_students, track_staff, institutionType,
}: Props) {
  const isTeacher = role === 'teacher' || role === 'staff'
  const isPlatformAdmin = role === 'platform_admin'
  const isOffice = institutionType === 'office'

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

  const buildParams = useCallback(
    (overrides: Partial<{
      from: string; to: string; term: string
      students: string[]; staff: string[]; classes: string[]
      type: string; institution: string; page: number
    }>) => {
      const current = {
        from: fromDate, to: toDate, term: termId,
        students: studentIds, staff: staffIds, classes: deviceIds,
        type: typeFilter, institution: institutionFilter, page: 1,
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
      if (current.page > 1) p.set('page', current.page.toString())
      return p.toString()
    },
    [fromDate, toDate, termId, studentIds, staffIds, deviceIds, typeFilter, institutionFilter]
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
    setTypeFilter(''); setInstitutionFilter('')
    startTransition(() => { router.push(pathname) })
  }

  function buildExportUrl() {
    const qs = buildParams({ page: 1 })
    return `/api/attendance/export${qs ? `?${qs}` : ''}`
  }

  const hasFilters = !!(fromDate || toDate || termId || studentIds.length || staffIds.length || deviceIds.length || typeFilter || institutionFilter)
  const summary = buildSummary(records)
  const totalPages = Math.ceil(totalCount / pageSize)
  const showInstitutionColumn = isPlatformAdmin

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

      {/* Institution filter — platform_admin only */}
      {isPlatformAdmin && institutions.length > 0 && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="institution-filter" className="text-xs">Institution</Label>
          <NativeSelect
            id="institution-filter"
            value={institutionFilter}
            onChange={(e) => {
              setInstitutionFilter(e.target.value)
              setStudentIds([]); setStaffIds([]); setDeviceIds([])
              applyFilters({ institution: e.target.value, students: [], staff: [], classes: [] })
            }}
            className="w-64"
          >
            <option value="">All institutions</option>
            {institutions.map((inst) => (
              <option key={inst.id} value={inst.id}>{inst.name}</option>
            ))}
          </NativeSelect>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Date range */}
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="from-date" className="text-xs">From</Label>
            <Input
              id="from-date"
              type="date"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); applyFilters({ from: e.target.value }) }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="to-date" className="text-xs">To</Label>
            <Input
              id="to-date"
              type="date"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); applyFilters({ to: e.target.value }) }}
            />
          </div>
        </div>

        {/* Period filter */}
        <div className="flex flex-col gap-1">
          <Label htmlFor="term-filter" className="text-xs">{labels.label_period}</Label>
          <NativeSelect
            id="term-filter"
            value={termId}
            onChange={(e) => { setTermId(e.target.value); applyFilters({ term: e.target.value }) }}
          >
            <option value="">All {labels.label_period.toLowerCase()}s</option>
            {academic.map((a) => (
              <option key={a.id} value={a.id}>{a.term} {a.year}</option>
            ))}
          </NativeSelect>
        </div>

        {/* Member type filter */}
        <div className="flex flex-col gap-1">
          <Label htmlFor="type-filter" className="text-xs">Member type</Label>
          <NativeSelect
            id="type-filter"
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); applyFilters({ type: e.target.value }) }}
          >
            <option value="">All types</option>
            {showStudentType && <option value="student">Student</option>}
            {showStaffType && <option value="staff">{labels.label_staff}</option>}
          </NativeSelect>
        </div>

        <div className="w-px self-stretch bg-border mx-1" />

        {/* Member-level filters */}
        <div className="flex items-end gap-2">
          {isTeacher && assignedUnit && (
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground self-end h-8">
              <Lock className="h-3 w-3 shrink-0" />
              {assignedUnit}
            </div>
          )}

          {/* Student member filter */}
          {showStudentType && (
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{labels.label_members}</Label>
              <MultiSelect
                options={studentOptions}
                selected={studentIds}
                onChange={(val) => {
                  setStudentIds(val)
                  applyFilters({ students: val })
                }}
                placeholder={`All ${labels.label_members.toLowerCase()}`}
              />
            </div>
          )}

          {/* Staff member filter */}
          {showStaffType && (
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{labels.label_staff_plural}</Label>
              <MultiSelect
                options={staffOptions}
                selected={staffIds}
                onChange={(val) => {
                  setStaffIds(val)
                  applyFilters({ staff: val })
                }}
                placeholder={`All ${labels.label_staff_plural.toLowerCase()}`}
              />
            </div>
          )}

          {/* Unit filter */}
          {!isTeacher && (
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{labels.label_unit}s</Label>
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
                placeholder={`All ${labels.label_unit.toLowerCase()}s`}
              />
            </div>
          )}
        </div>
      </div>

      <div className={`transition-opacity duration-150 ${isPending ? 'opacity-50 pointer-events-none' : ''}`}>
        <Tabs defaultValue="records">
          <TabsList>
            <TabsTrigger value="records">Records ({totalCount.toLocaleString()})</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
          </TabsList>

          <TabsContent value="records" className="mt-4 space-y-3">
            {records.length === 0 ? (
              <EmptyState icon={CalendarDays} message="No attendance records match your filters." />
            ) : (
              <div className="rounded-xl border overflow-x-auto">
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
                          {r.status === 'absent' ? (
                            <Badge variant="destructive">Absent</Badge>
                          ) : r.scan_type === 'time_in' ? (
                            <Badge variant="secondary">Time In</Badge>
                          ) : r.scan_type === 'time_out' ? (
                            <Badge variant="secondary">Time Out</Badge>
                          ) : (
                            <Badge variant="success">Present</Badge>
                          )}
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
              <div className="rounded-xl border overflow-x-auto">
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
        </Tabs>
      </div>
    </div>
  )
}
