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
import { CalendarDays, Lock } from 'lucide-react'
import type { UserRole } from '@/lib/supabase/dal'
import { EmptyState } from '@/components/ui/empty-state'
import { NativeSelect } from '@/components/ui/native-select'
import { PageHeader } from '@/components/ui/page-header'
import { Pagination } from '@/components/ui/pagination'
import { MultiSelect } from './multi-select'
import type { AttendanceRecord, Device, AcademicTerm } from '@/lib/types'

type StudentOption = { id: string; sid: string; fullname: string; group_name: string; device_id: string }

type Filters = {
  fromDate?: string
  toDate?: string
  termId?: string
  studentIds: string[]
  deviceIds: string[]
}

type Props = {
  records: AttendanceRecord[]
  students: StudentOption[]
  devices: Device[]
  academic: AcademicTerm[]
  filters: Filters
  page: number
  pageSize: number
  totalCount: number
  role: UserRole
  assignedUnit: string | null
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

export function AttendanceView({ records, students, devices, academic, filters, page, pageSize, totalCount, role, assignedUnit }: Props) {
  const isTeacher = role === 'teacher' || role === 'staff'
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  const [fromDate, setFromDate] = useState(filters.fromDate ?? '')
  const [toDate, setToDate] = useState(filters.toDate ?? '')
  const [termId, setTermId] = useState(filters.termId ?? '')
  const [studentIds, setStudentIds] = useState<string[]>(filters.studentIds)
  const [deviceIds, setDeviceIds] = useState<string[]>(filters.deviceIds)

  const buildParams = useCallback(
    (overrides: Partial<{ from: string; to: string; term: string; students: string[]; classes: string[]; page: number }>) => {
      const current = {
        from: fromDate,
        to: toDate,
        term: termId,
        students: studentIds,
        classes: deviceIds,
        page: 1,
        ...overrides,
      }
      const params = new URLSearchParams()
      if (current.from) params.set('from', current.from)
      if (current.to) params.set('to', current.to)
      if (current.term) params.set('term', current.term)
      if (current.students.length) params.set('students', current.students.join(','))
      if (current.classes.length) params.set('classes', current.classes.join(','))
      if (current.page > 1) params.set('page', current.page.toString())
      return params.toString()
    },
    [fromDate, toDate, termId, studentIds, deviceIds]
  )

  const applyFilters = useCallback(
    (overrides: Partial<{ from: string; to: string; term: string; students: string[]; classes: string[] }>) => {
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
    setFromDate('')
    setToDate('')
    setTermId('')
    setStudentIds([])
    setDeviceIds([])
    startTransition(() => {
      router.push(pathname)
    })
  }

  const hasFilters = fromDate || toDate || termId || studentIds.length > 0 || deviceIds.length > 0
  const summary = buildSummary(records)
  const totalPages = Math.ceil(totalCount / pageSize)

  const studentOptions = useMemo(() => {
    const base = deviceIds.length > 0
      ? students.filter((s) => deviceIds.includes(s.device_id))
      : students
    return base.map((s) => ({
      value: s.id,
      label: `${s.fullname} (${s.sid})`,
    }))
  }, [students, deviceIds])

  const classOptions = devices.map((d) => ({
    value: d.id,
    label: formatClass(d),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        actions={
          hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="from-date" className="text-xs">From</Label>
            <Input
              id="from-date"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value)
                applyFilters({ from: e.target.value })
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="to-date" className="text-xs">To</Label>
            <Input
              id="to-date"
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value)
                applyFilters({ to: e.target.value })
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="term-filter" className="text-xs">Term</Label>
          <NativeSelect
            id="term-filter"
            value={termId}
            onChange={(e) => {
              setTermId(e.target.value)
              applyFilters({ term: e.target.value })
            }}
          >
            <option value="">All terms</option>
            {academic.map((a) => (
              <option key={a.id} value={a.id}>
                {a.term} {a.year}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="w-px self-stretch bg-border mx-1" />

        <div className="flex items-end gap-2">
          {isTeacher && assignedUnit && (
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground self-end h-8">
              <Lock className="h-3 w-3 shrink-0" />
              {assignedUnit}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label className="text-xs">Students</Label>
            <MultiSelect
              options={studentOptions}
              selected={studentIds}
              onChange={(val) => {
                setStudentIds(val)
                applyFilters({ students: val })
              }}
              placeholder="All students"
            />
          </div>

          {!isTeacher && (
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Classes</Label>
              <MultiSelect
                options={classOptions}
                selected={deviceIds}
                onChange={(val) => {
                  setDeviceIds(val)
                  const validIds = val.length > 0
                    ? new Set(students.filter((s) => val.includes(s.device_id)).map((s) => s.id))
                    : null
                  const nextStudentIds = validIds
                    ? studentIds.filter((id) => validIds.has(id))
                    : studentIds
                  if (nextStudentIds.length !== studentIds.length) setStudentIds(nextStudentIds)
                  applyFilters({ classes: val, students: nextStudentIds })
                }}
                placeholder="All classes"
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
            <EmptyState
              icon={CalendarDays}
              message="No attendance records match your filters."
            />
          ) : (
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Term</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(r.date)}</TableCell>
                      <TableCell>{r.student?.fullname ?? '—'}</TableCell>
                      <TableCell className="font-mono tabular-nums text-muted-foreground text-xs">
                        {r.student?.sid ?? '—'}
                      </TableCell>
                      <TableCell>
                        {r.device ? formatClass(r.device) : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                        {r.academic ? `${r.academic.term} ${r.academic.year}` : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatTime(r.time)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === 'present' ? 'success' : 'destructive'}>
                          {r.status === 'present' ? 'Present' : 'Absent'}
                        </Badge>
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
            <EmptyState
              icon={CalendarDays}
              message="No data to summarise. Add attendance records first."
            />
          ) : (
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead>
                    <TableHead>Term</TableHead>
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
