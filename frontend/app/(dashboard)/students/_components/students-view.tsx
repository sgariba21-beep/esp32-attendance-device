'use client'

import { useState, useMemo } from 'react'
import { Fingerprint, Loader2, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { NativeSelect } from '@/components/ui/native-select'
import { PageHeader } from '@/components/ui/page-header'
import { Pagination } from '@/components/ui/pagination'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { StudentDialog } from './student-dialog'
import { setStudentStatus } from '../_actions'
import type { StudentWithDevice } from '../page'
import type { Device } from '@/lib/types'

type Props = {
  students: StudentWithDevice[]
  devices: Device[]
}

type StatusFilter = 'all' | 'active' | 'inactive'

export function StudentsView({ students, devices }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<StudentWithDevice | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<StudentWithDevice | null>(null)

  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)

  const PAGE_SIZE = 50

  // ── computed ──────────────────────────────────────────────────────────────

  const usedFids = useMemo(() => {
    const map: Record<string, number[]> = {}
    for (const s of students) {
      if (!map[s.device_id]) map[s.device_id] = []
      if (s.fin1) map[s.device_id].push(s.fin1)
      if (s.fin2) map[s.device_id].push(s.fin2)
    }
    return map
  }, [students])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return students.filter((s) => {
      if (q && !s.fullname.toLowerCase().includes(q) && !s.sid.toLowerCase().includes(q)) return false
      if (classFilter && s.device_id !== classFilter) return false
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      return true
    })
  }, [students, search, classFilter, statusFilter])

  const hasFilters = search || classFilter || statusFilter !== 'all'
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── handlers ─────────────────────────────────────────────────────────────

  function openAdd() { setEditing(null); setDialogOpen(true) }
  function openEdit(student: StudentWithDevice) { setEditing(student); setDialogOpen(true) }

  async function handleToggleStatus(student: StudentWithDevice) {
    setTogglingId(student.id)
    await setStudentStatus(student.id, student.status === 'active' ? 'inactive' : 'active')
    setTogglingId(null)
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <PageHeader
        title="Students"
        subtitle={`${filtered.length} of ${students.length} student${students.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={openAdd}>Add student</Button>}
      />

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <Input
          placeholder="Search by name or ID…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="w-56"
        />

        <NativeSelect
          value={classFilter}
          onChange={(e) => { setClassFilter(e.target.value); setPage(1) }}
        >
          <option value="">All classes</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.form} {d.class}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1) }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </NativeSelect>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(''); setClassFilter(''); setStatusFilter('all'); setPage(1) }}
          >
            Clear
          </Button>
        )}
      </div>

      {students.length === 0 ? (
        <EmptyState
          icon={Users}
          message="No students yet. Add one to get started."
          action={<Button onClick={openAdd}>Add student</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          message="No students match your filters."
        />
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>School ID</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Fingerprints</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((s) => {
                  const inactive = s.status === 'inactive'
                  return (
                    <TableRow key={s.id}>
                      <TableCell className={cn('font-medium', inactive && 'opacity-60')}>
                        {s.fullname}
                      </TableCell>
                      <TableCell className={cn('font-mono tabular-nums text-muted-foreground text-xs', inactive && 'opacity-60')}>
                        {s.sid}
                      </TableCell>
                      <TableCell className={cn(inactive && 'opacity-60')}>
                        {s.device ? `${s.device.form} ${s.device.class}` : '—'}
                      </TableCell>
                      <TableCell className={cn(inactive && 'opacity-60')}>
                        <span className="flex items-center gap-1.5" title={`Finger 1: ${s.fin1 ? `slot ${s.fin1}` : 'not enrolled'} · Finger 2: ${s.fin2 ? `slot ${s.fin2}` : 'not enrolled'}`}>
                          <Fingerprint className={cn('size-3.5', s.fin1 ? 'text-success-foreground' : 'text-muted-foreground/40')} />
                          <Fingerprint className={cn('size-3.5', s.fin2 ? 'text-success-foreground' : 'text-muted-foreground/40')} />
                        </span>
                      </TableCell>
                      <TableCell className={cn(inactive && 'opacity-60')}>
                        <Badge variant={s.status === 'active' ? 'success' : 'secondary'}>
                          {s.status === 'active' ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-3">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={togglingId === s.id}
                            onClick={() => s.status === 'active' ? setConfirmTarget(s) : handleToggleStatus(s)}
                            className={s.status === 'active' ? 'text-destructive hover:text-destructive ml-1' : ''}
                          >
                            {togglingId === s.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : s.status === 'active'
                                ? 'Deactivate'
                                : 'Activate'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalCount={filtered.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      <StudentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        student={editing}
        devices={devices}
        usedFids={usedFids}
      />

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(v) => { if (!v) setConfirmTarget(null) }}
        title="Deactivate student?"
        description={confirmTarget ? `${confirmTarget.fullname} will be marked inactive and won't be able to scan in. You can reactivate them at any time.` : ''}
        confirmLabel="Deactivate"
        loading={togglingId === confirmTarget?.id}
        onConfirm={async () => {
          if (!confirmTarget) return
          await handleToggleStatus(confirmTarget)
          setConfirmTarget(null)
        }}
      />

    </div>
  )
}
