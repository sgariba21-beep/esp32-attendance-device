'use client'

import { useState, useMemo, useRef } from 'react'
import { Users, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { PageHeader } from '@/components/ui/page-header'
import { Pagination } from '@/components/ui/pagination'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn, displayPhone } from '@/lib/utils'
import type { UserRole } from '@/lib/supabase/dal'
import { ClientDialog } from './client-dialog'
import type { ClientItem } from './client-dialog'
import { VisitHistoryDialog } from './visit-history-dialog'
import { setClientActive, logVisit } from '../_actions'

export type ClientWithStats = {
  id: string
  institution_id: string
  name: string
  phone: string
  area_of_residence: string | null
  active: boolean
  created_at: string
  visitCount: number
  lastVisit: string | null
  visitDates: string[]
}

type StatusFilter = 'active' | 'archived' | 'all'

type Props = {
  clients: ClientWithStats[]
  role: UserRole
}

const PAGE_SIZE = 50

function formatDateShort(d: string): string {
  const [year, month, day] = d.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function ClientsView({ clients, role }: Props) {
  const canWrite = role !== 'cashier'

  // List filters
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)

  // Client dialog (create / edit)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ClientItem>(null)

  // Visit history dialog
  const [historyClient, setHistoryClient] = useState<{ name: string; dates: string[] } | null>(null)

  // Archive confirm
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null)
  const [archiving, setArchiving] = useState(false)

  // Per-row log-visit state
  const [loggingId, setLoggingId] = useState<string | null>(null)
  const [visitNote, setVisitNote] = useState<{ clientId: string; msg: string } | null>(null)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filteredClients = useMemo(() => {
    const q = search.toLowerCase().trim()
    return clients.filter((c) => {
      if (status === 'active' && !c.active) return false
      if (status === 'archived' && c.active) return false
      if (q) {
        const nameMatch = c.name.toLowerCase().includes(q)
        const phoneMatch = displayPhone(c.phone).includes(q) || c.phone.includes(q)
        const areaMatch = (c.area_of_residence ?? '').toLowerCase().includes(q)
        if (!nameMatch && !phoneMatch && !areaMatch) return false
      }
      return true
    })
  }, [clients, search, status])

  const totalPages = Math.ceil(filteredClients.length / PAGE_SIZE)
  const activeCount = clients.filter((c) => c.active).length

  function openAdd() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(c: ClientWithStats) {
    setEditing({ id: c.id, name: c.name, phone: c.phone, area_of_residence: c.area_of_residence })
    setDialogOpen(true)
  }

  function showNote(clientId: string, msg: string) {
    if (noteTimer.current) clearTimeout(noteTimer.current)
    setVisitNote({ clientId, msg })
    noteTimer.current = setTimeout(() => setVisitNote(null), 3000)
  }

  async function handleLogVisit(clientId: string) {
    setLoggingId(clientId)
    const result = await logVisit(clientId)
    setLoggingId(null)
    if (result.error) { showNote(clientId, result.error); return }
    showNote(clientId, result.alreadyLogged ? 'Already logged today' : 'Visit logged!')
  }

  async function handleArchiveConfirm() {
    if (!archiveTarget) return
    setArchiving(true)
    await setClientActive(archiveTarget.id, false)
    setArchiving(false)
    setArchiveTarget(null)
  }

  async function handleRestore(id: string) {
    await setClientActive(id, true)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Clients"
        subtitle={`${activeCount} active client${activeCount !== 1 ? 's' : ''}`}
      />

      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Search by name, phone, area…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="w-60"
          />
          <NativeSelect
            value={status}
            onChange={(e) => { setStatus(e.target.value as StatusFilter); setPage(1) }}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </NativeSelect>
          {(search || status !== 'active') && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatus('active'); setPage(1) }}>
              Clear
            </Button>
          )}
        </div>
        <Button onClick={openAdd}>Add client</Button>
      </div>

      {filteredClients.length === 0 ? (
        clients.length === 0 ? (
          <EmptyState
            icon={Users}
            message="No clients yet. Add one to get started."
            action={<Button onClick={openAdd}>Add client</Button>}
          />
        ) : (
          <EmptyState icon={Users} message="No clients match your filters." />
        )
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="hidden sm:table-cell">Area</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="hidden md:table-cell">Last visit</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients
                  .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
                  .map((c) => {
                    const isLogging = loggingId === c.id
                    const note = visitNote?.clientId === c.id ? visitNote.msg : null

                    return (
                      <TableRow key={c.id}>
                        <TableCell className={cn('font-medium', !c.active && 'opacity-60')}>
                          <div className="flex items-center gap-2">
                            {c.name}
                            {!c.active && (
                              <Badge variant="secondary" className="text-[10px] py-0">Archived</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className={cn('tabular-nums', !c.active && 'opacity-60')}>
                          {displayPhone(c.phone)}
                        </TableCell>
                        <TableCell className={cn('hidden sm:table-cell text-muted-foreground', !c.active && 'opacity-60')}>
                          {c.area_of_residence ?? '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <button
                            onClick={() => setHistoryClient({ name: c.name, dates: c.visitDates })}
                            className="tabular-nums text-sm underline-offset-2 hover:underline text-foreground"
                            title="View visit history"
                          >
                            {c.visitCount}
                          </button>
                        </TableCell>
                        <TableCell className={cn('hidden md:table-cell text-muted-foreground', !c.active && 'opacity-60')}>
                          {c.lastVisit ? formatDateShort(c.lastVisit) : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="flex items-center justify-end gap-2">
                              {c.active && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isLogging}
                                  onClick={() => handleLogVisit(c.id)}
                                >
                                  {isLogging
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : 'Log visit'}
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                                Edit
                              </Button>
                              {canWrite && (
                                c.active ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => setArchiveTarget({ id: c.id, name: c.name })}
                                  >
                                    Archive
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRestore(c.id)}
                                  >
                                    Restore
                                  </Button>
                                )
                              )}
                            </div>
                            {note && (
                              <span className={cn(
                                'text-[11px]',
                                note.includes('Already') || note.includes('Cannot') || (!note.includes('logged!') && note !== 'Visit logged!')
                                  ? 'text-muted-foreground'
                                  : 'text-green-600 dark:text-green-400',
                              )}>
                                {note}
                              </span>
                            )}
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
              totalCount={filteredClients.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      <ClientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editing}
      />

      <VisitHistoryDialog
        open={historyClient !== null}
        onOpenChange={(v) => { if (!v) setHistoryClient(null) }}
        clientName={historyClient?.name ?? ''}
        dates={historyClient?.dates ?? []}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(v) => { if (!v) setArchiveTarget(null) }}
        title="Archive client?"
        description={
          archiveTarget
            ? `"${archiveTarget.name}" will be hidden from the active list. Their visit and sales history is preserved.`
            : ''
        }
        confirmLabel="Archive"
        loading={archiving}
        onConfirm={handleArchiveConfirm}
      />
    </div>
  )
}
