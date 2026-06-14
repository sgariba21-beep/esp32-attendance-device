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
import type { UserRole } from '@/lib/supabase/dal'
import { MemberDialog } from './member-dialog'
import { setMemberStatus } from '../_actions'
import type { MemberWithDevice } from '../page'
import type { Device } from '@/lib/types'

type Labels = {
  label_member: string
  label_members: string
  label_unit: string
  label_group: string
}

type Props = {
  members: MemberWithDevice[]
  devices: Device[]
  role: UserRole
  labels: Labels
  institutionType: 'school' | 'office'
}

type StatusFilter = 'all' | 'active' | 'inactive'
type TypeFilter = 'all' | 'student' | 'staff'

export function MembersView({ members, devices, role, labels, institutionType }: Props) {
  const isOffice = institutionType === 'office'
  const isTeacher = role === 'teacher' || role === 'staff'
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MemberWithDevice | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<MemberWithDevice | null>(null)

  const [search, setSearch] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [page, setPage] = useState(1)

  const PAGE_SIZE = 50

  const usedFids = useMemo(() => {
    const map: Record<string, number[]> = {}
    for (const m of members) {
      if (!map[m.device_id]) map[m.device_id] = []
      if (m.fin1) map[m.device_id].push(m.fin1)
      if (m.fin2) map[m.device_id].push(m.fin2)
    }
    return map
  }, [members])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return members.filter((m) => {
      if (q && !m.fullname.toLowerCase().includes(q) && !m.sid.toLowerCase().includes(q)) return false
      if (unitFilter && m.device_id !== unitFilter) return false
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      if (typeFilter !== 'all' && m.member_type !== typeFilter) return false
      return true
    })
  }, [members, search, unitFilter, statusFilter, typeFilter])

  const hasFilters = search || unitFilter || statusFilter !== 'all' || typeFilter !== 'all'
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function openAdd() { setEditing(null); setDialogOpen(true) }
  function openEdit(member: MemberWithDevice) { setEditing(member); setDialogOpen(true) }

  async function handleToggleStatus(member: MemberWithDevice) {
    setTogglingId(member.id)
    await setMemberStatus(member.id, member.status === 'active' ? 'inactive' : 'active')
    setTogglingId(null)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={labels.label_members}
        subtitle={`${filtered.length} of ${members.length} ${members.length !== 1 ? labels.label_members.toLowerCase() : labels.label_member.toLowerCase()}`}
        actions={!isTeacher ? <Button onClick={openAdd}>Add {labels.label_member.toLowerCase()}</Button> : undefined}
      />

      <div className="flex flex-wrap gap-3 items-center">
        <Input
          placeholder="Search by name or ID…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="w-56"
        />

        <NativeSelect
          value={unitFilter}
          onChange={(e) => { setUnitFilter(e.target.value); setPage(1) }}
        >
          <option value="">All {labels.label_unit.toLowerCase()}s</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.group_name} {d.unit_name}
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

        <NativeSelect
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value as TypeFilter); setPage(1) }}
        >
          <option value="all">All types</option>
          {!isOffice && <option value="student">Student</option>}
          <option value="staff">Staff</option>
        </NativeSelect>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(''); setUnitFilter(''); setStatusFilter('all'); setTypeFilter('all'); setPage(1) }}
          >
            Clear
          </Button>
        )}
      </div>

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          message={isTeacher ? `No ${labels.label_members.toLowerCase()} in your ${labels.label_unit.toLowerCase()}.` : `No ${labels.label_members.toLowerCase()} yet. Add one to get started.`}
          action={!isTeacher ? <Button onClick={openAdd}>Add {labels.label_member.toLowerCase()}</Button> : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} message={`No ${labels.label_members.toLowerCase()} match your filters.`} />
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>{labels.label_unit}</TableHead>
                  <TableHead>Fingerprints</TableHead>
                  <TableHead>Status</TableHead>
                  {!isTeacher && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((m) => {
                  const inactive = m.status === 'inactive'
                  return (
                    <TableRow key={m.id}>
                      <TableCell className={cn('font-medium', inactive && 'opacity-60')}>
                        {m.fullname}
                      </TableCell>
                      <TableCell className={cn('font-mono tabular-nums text-muted-foreground text-xs', inactive && 'opacity-60')}>
                        {m.sid}
                      </TableCell>
                      <TableCell className={cn('capitalize text-muted-foreground text-xs', inactive && 'opacity-60')}>
                        {m.member_type}
                      </TableCell>
                      <TableCell className={cn(inactive && 'opacity-60')}>
                        {m.device ? `${m.device.group_name} ${m.device.unit_name}` : '—'}
                      </TableCell>
                      <TableCell className={cn(inactive && 'opacity-60')}>
                        <span className="flex items-center gap-1.5" title={`Finger 1: ${m.fin1 ? `slot ${m.fin1}` : 'not enrolled'} · Finger 2: ${m.fin2 ? `slot ${m.fin2}` : 'not enrolled'}`}>
                          <Fingerprint className={cn('size-3.5', m.fin1 ? 'text-success-foreground' : 'text-muted-foreground/40')} />
                          <Fingerprint className={cn('size-3.5', m.fin2 ? 'text-success-foreground' : 'text-muted-foreground/40')} />
                        </span>
                      </TableCell>
                      <TableCell className={cn(inactive && 'opacity-60')}>
                        <Badge variant={m.status === 'active' ? 'success' : 'secondary'}>
                          {m.status === 'active' ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      {!isTeacher && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-3">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={togglingId === m.id}
                              onClick={() => m.status === 'active' ? setConfirmTarget(m) : handleToggleStatus(m)}
                              className={m.status === 'active' ? 'text-destructive hover:text-destructive ml-1' : ''}
                            >
                              {togglingId === m.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : m.status === 'active' ? 'Deactivate' : 'Activate'}
                            </Button>
                          </div>
                        </TableCell>
                      )}
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

      <MemberDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        member={editing}
        devices={devices}
        usedFids={usedFids}
        labels={labels}
        institutionType={institutionType}
      />

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(v) => { if (!v) setConfirmTarget(null) }}
        title={`Deactivate ${labels.label_member.toLowerCase()}?`}
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
