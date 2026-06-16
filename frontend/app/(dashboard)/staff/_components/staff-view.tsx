'use client'

import { useState, useMemo } from 'react'
import { Fingerprint, Loader2, UserCog } from 'lucide-react'
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
import { cn, pluralize } from '@/lib/utils'
import type { UserRole } from '@/lib/supabase/dal'
import { StaffDialog } from './staff-dialog'
import { setStaffMemberStatus } from '../_actions'
import type { Device } from '@/lib/types'

export type StaffMemberWithDevice = {
  id: string
  sid: string
  fullname: string
  group_name: string
  fin1: number
  fin2: number
  status: 'active' | 'inactive'
  created_at: string
  device_id: string | null
  institution_id: string | null
  device: { id: string; group_name: string; unit_name: string } | null
  institution: { id: string; name: string } | null
}

type Labels = {
  label_member: string
  label_members: string
  label_unit: string
  label_group: string
}

type Props = {
  members: StaffMemberWithDevice[]
  devices: Device[]
  role: UserRole
  institutions: { id: string; name: string }[]
  labels: Labels
}

type StatusFilter = 'all' | 'active' | 'inactive'

export function StaffView({ members, devices, role, institutions, labels }: Props) {
  const isTeacher = role === 'teacher' || role === 'staff'
  const isPlatformAdmin = role === 'platform_admin'
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<StaffMemberWithDevice | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<StaffMemberWithDevice | null>(null)

  const [search, setSearch] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [institutionFilter, setInstitutionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)

  const PAGE_SIZE = 50

  const usedFids = useMemo(() => {
    const map: Record<string, number[]> = {}
    for (const m of members) {
      if (!m.device_id) continue
      if (!map[m.device_id]) map[m.device_id] = []
      if (m.fin1) map[m.device_id].push(m.fin1)
      if (m.fin2) map[m.device_id].push(m.fin2)
    }
    return map
  }, [members])

  const unitOptions = institutionFilter
    ? devices.filter((d) => d.institution_id === institutionFilter)
    : devices

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return members.filter((m) => {
      if (q && !m.fullname.toLowerCase().includes(q) && !m.sid.toLowerCase().includes(q)) return false
      if (institutionFilter && m.institution_id !== institutionFilter) return false
      if (unitFilter && m.device_id !== unitFilter) return false
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      return true
    })
  }, [members, search, unitFilter, institutionFilter, statusFilter])

  const hasFilters = search || unitFilter || institutionFilter || statusFilter !== 'all'
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function openAdd() { setEditing(null); setDialogOpen(true) }
  function openEdit(member: StaffMemberWithDevice) { setEditing(member); setDialogOpen(true) }

  async function handleToggleStatus(member: StaffMemberWithDevice) {
    setTogglingId(member.id)
    await setStaffMemberStatus(member.id, member.status === 'active' ? 'inactive' : 'active')
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

        {isPlatformAdmin && (
          <NativeSelect value={institutionFilter} onChange={(e) => { setInstitutionFilter(e.target.value); setUnitFilter(''); setPage(1) }}>
            <option value="">All institutions</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </NativeSelect>
        )}

        <NativeSelect value={unitFilter} onChange={(e) => { setUnitFilter(e.target.value); setPage(1) }}>
          <option value="">All {pluralize(labels.label_unit.toLowerCase())}</option>
          {unitOptions.map((d) => (
            <option key={d.id} value={d.id}>{d.group_name} {d.unit_name}</option>
          ))}
        </NativeSelect>

        <NativeSelect value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1) }}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </NativeSelect>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setUnitFilter(''); setInstitutionFilter(''); setStatusFilter('all'); setPage(1) }}>
            Clear
          </Button>
        )}
      </div>

      {members.length === 0 ? (
        <EmptyState
          icon={UserCog}
          message={isTeacher ? `No ${labels.label_members.toLowerCase()} in your ${labels.label_unit.toLowerCase()}.` : `No ${labels.label_members.toLowerCase()} yet. Add one to get started.`}
          action={!isTeacher ? <Button onClick={openAdd}>Add {labels.label_member.toLowerCase()}</Button> : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon={UserCog} message={`No ${labels.label_members.toLowerCase()} match your filters.`} />
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>ID</TableHead>
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
                      <TableCell className={cn('font-medium', inactive && 'opacity-60')}>{m.fullname}</TableCell>
                      <TableCell className={cn('font-mono tabular-nums text-muted-foreground text-xs', inactive && 'opacity-60')}>{m.sid}</TableCell>
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
                            <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>Edit</Button>
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

      <StaffDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        member={editing}
        devices={devices}
        usedFids={usedFids}
        labels={labels}
        institutions={institutions}
        isPlatformAdmin={isPlatformAdmin}
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
