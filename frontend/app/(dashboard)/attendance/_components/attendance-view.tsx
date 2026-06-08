'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MultiSelect } from './multi-select'
import type { AttendanceRecord, Device, AcademicTerm } from '@/lib/types'

type StudentOption = { id: string; sid: string; fullname: string; form: string; device_id: string }

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
}

function formatClass(device: { form: string; class: string }) {
  return `${device.form} ${device.class}`
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

export function AttendanceView({ records, students, devices, academic, filters }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  const [fromDate, setFromDate] = useState(filters.fromDate ?? '')
  const [toDate, setToDate] = useState(filters.toDate ?? '')
  const [termId, setTermId] = useState(filters.termId ?? '')
  const [studentIds, setStudentIds] = useState<string[]>(filters.studentIds)
  const [deviceIds, setDeviceIds] = useState<string[]>(filters.deviceIds)

  const applyFilters = useCallback(
    (overrides: Partial<{ from: string; to: string; term: string; students: string[]; classes: string[] }>) => {
      const current = {
        from: fromDate,
        to: toDate,
        term: termId,
        students: studentIds,
        classes: deviceIds,
        ...overrides,
      }
      const params = new URLSearchParams()
      if (current.from) params.set('from', current.from)
      if (current.to) params.set('to', current.to)
      if (current.term) params.set('term', current.term)
      if (current.students.length) params.set('students', current.students.join(','))
      if (current.classes.length) params.set('classes', current.classes.join(','))
      router.push(`${pathname}?${params.toString()}`)
    },
    [fromDate, toDate, termId, studentIds, deviceIds, pathname, router]
  )

  function clearFilters() {
    setFromDate('')
    setToDate('')
    setTermId('')
    setStudentIds([])
    setDeviceIds([])
    router.push(pathname)
  }

  const hasFilters = fromDate || toDate || termId || studentIds.length > 0 || deviceIds.length > 0
  const summary = buildSummary(records)

  const studentOptions = students.map((s) => ({
    value: s.id,
    label: `${s.fullname} (${s.sid})`,
  }))

  const classOptions = devices.map((d) => ({
    value: d.id,
    label: formatClass(d),
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Attendance</h1>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">From</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value)
              applyFilters({ from: e.target.value })
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">To</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value)
              applyFilters({ to: e.target.value })
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Term</label>
          <select
            value={termId}
            onChange={(e) => {
              setTermId(e.target.value)
              applyFilters({ term: e.target.value })
            }}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">All terms</option>
            {academic.map((a) => (
              <option key={a.id} value={a.id}>
                {a.term} {a.year}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Students</label>
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

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Classes</label>
          <MultiSelect
            options={classOptions}
            selected={deviceIds}
            onChange={(val) => {
              setDeviceIds(val)
              applyFilters({ classes: val })
            }}
            placeholder="All classes"
          />
        </div>
      </div>

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">Records ({records.length})</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="mt-4">
          {records.length === 0 ? (
            <EmptyState message="No attendance records match your filters." />
          ) : (
            <div className="rounded-md border overflow-x-auto">
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
                      <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                      <TableCell>{r.student?.fullname ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{r.student?.sid ?? '—'}</TableCell>
                      <TableCell>
                        {r.device ? formatClass(r.device) : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {r.academic ? `${r.academic.term} ${r.academic.year}` : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatTime(r.time)}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === 'present' ? 'default' : 'destructive'}>
                          {r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {records.length === 200 && (
            <p className="text-xs text-muted-foreground mt-2">
              Showing first 200 records. Use filters to narrow results.
            </p>
          )}
        </TabsContent>

        <TabsContent value="summary" className="mt-4">
          {summary.length === 0 ? (
            <EmptyState message="No data to summarise. Add attendance records first." />
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead>
                    <TableHead>Term</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead className="text-right">Present</TableHead>
                    <TableHead className="text-right">Absent</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Attendance %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>{row.classLabel}</TableCell>
                      <TableCell>{row.term}</TableCell>
                      <TableCell>{row.year}</TableCell>
                      <TableCell className="text-right text-green-600 font-medium">{row.present}</TableCell>
                      <TableCell className="text-right text-destructive font-medium">{row.absent}</TableCell>
                      <TableCell className="text-right">{row.total}</TableCell>
                      <TableCell className="text-right font-medium">
                        {row.total > 0 ? `${Math.round((row.present / row.total) * 100)}%` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-16 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
