'use client'

import { useState, useMemo } from 'react'
import { Gift, Loader2 } from 'lucide-react'
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn, displayPhone } from '@/lib/utils'
import type { UserRole } from '@/lib/supabase/dal'
import { describeCondition, describeWindow, describeReward } from '@/lib/loyalty/describe'
import { RewardDialog } from './reward-dialog'
import { IssueDialog } from './issue-dialog'
import { setRewardActive } from '../_actions'

import type { LoyaltyRewardRow as Reward } from '@/lib/loyalty/loader'
export type { Reward }
export { describeCondition, describeWindow, describeReward }

export type CatalogLite = { id: string; name: string; price: number }
export type ClientLite = { id: string; name: string; phone: string }

export type LogEntry = {
  id: string
  issued_at: string
  trigger_source: 'manual' | 'auto'
  value_snapshot: number | null
  note: string | null
  clients: { name: string; phone: string } | null
  rewards: { name: string } | null
  issued_by_email: string | null
}

type Props = {
  rewards: Reward[]
  products: CatalogLite[]        // active only — for selectors
  services: CatalogLite[]        // active only — for selectors
  clients: ClientLite[]          // active only
  log: LogEntry[]
  productNames: Record<string, string>   // all (incl. archived) — for describe
  serviceNames: Record<string, string>
  timezone: string
  role: UserRole
  currency: string
}

type StatusFilter = 'active' | 'archived' | 'all'

const LOG_PAGE_SIZE = 50

export function RewardsView({ rewards, products, services, clients, log, productNames, serviceNames, timezone, role, currency }: Props) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('active')
  const [logPage, setLogPage] = useState(1)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Reward | null>(null)

  const [issueTarget, setIssueTarget] = useState<Reward | null>(null)

  const [archiveTarget, setArchiveTarget] = useState<Reward | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return rewards.filter((r) => {
      if (status === 'active' && !r.active) return false
      if (status === 'archived' && r.active) return false
      if (q && !r.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [rewards, search, status])

  const activeCount = rewards.filter((r) => r.active).length

  function openAdd() { setEditing(null); setDialogOpen(true) }
  function openEdit(r: Reward) { setEditing(r); setDialogOpen(true) }

  async function handleRestore(r: Reward) {
    setTogglingId(r.id)
    await setRewardActive(r.id, true)
    setTogglingId(null)
  }

  async function handleArchiveConfirm() {
    if (!archiveTarget) return
    setArchiving(true)
    await setRewardActive(archiveTarget.id, false)
    setArchiving(false)
    setArchiveTarget(null)
  }

  function fmtDateTime(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: timezone,
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Loyalty" subtitle="Reward rules and issuance" />

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules ({activeCount})</TabsTrigger>
          <TabsTrigger value="history">History ({log.length})</TabsTrigger>
        </TabsList>

        {/* ── Rules ──────────────────────────────────────────────────── */}
        <TabsContent value="rules">
          <div className="space-y-4 pt-4">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap gap-3 items-center">
                <Input
                  placeholder="Search rewards…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-52"
                />
                <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="all">All</option>
                </NativeSelect>
                {(search || status !== 'active') && (
                  <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatus('active') }}>Clear</Button>
                )}
              </div>
              <Button onClick={openAdd}>New reward</Button>
            </div>

            {filtered.length === 0 ? (
              rewards.length === 0 ? (
                <EmptyState
                  icon={Gift}
                  message="No reward rules yet. Create your first loyalty reward."
                  action={<Button onClick={openAdd}>New reward</Button>}
                />
              ) : (
                <EmptyState icon={Gift} message="No rewards match your filters." />
              )
            ) : (
              <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden sm:table-cell">Condition</TableHead>
                      <TableHead className="hidden md:table-cell">Reward</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className={cn('font-medium', !r.active && 'opacity-60')}>
                          {r.name}
                          <span className="block text-xs text-muted-foreground font-normal sm:hidden">
                            {describeCondition(r, productNames, serviceNames, currency)} ({describeWindow(r)}) → {describeReward(r, productNames, serviceNames, currency)}
                          </span>
                        </TableCell>
                        <TableCell className={cn('hidden sm:table-cell text-sm text-muted-foreground', !r.active && 'opacity-60')}>
                          {describeCondition(r, productNames, serviceNames, currency)}
                          <span className="block text-xs">{describeWindow(r)}{r.repeatable ? ' · repeatable' : ''}</span>
                        </TableCell>
                        <TableCell className={cn('hidden md:table-cell text-sm text-muted-foreground', !r.active && 'opacity-60')}>
                          {describeReward(r, productNames, serviceNames, currency)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.active ? 'success' : 'secondary'}>{r.active ? 'Active' : 'Archived'}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {r.active && (
                              <Button variant="outline" size="sm" onClick={() => setIssueTarget(r)}>Issue</Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button>
                            {r.active ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setArchiveTarget(r)}
                              >
                                Archive
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" disabled={togglingId === r.id} onClick={() => handleRestore(r)}>
                                {togglingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Restore'}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── History ────────────────────────────────────────────────── */}
        <TabsContent value="history">
          <div className="pt-4 space-y-3">
            {log.length === 0 ? (
              <EmptyState icon={Gift} message="No rewards have been issued yet." />
            ) : (
              <>
                <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date & time</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Reward</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="hidden md:table-cell">Issued by</TableHead>
                        <TableHead className="hidden lg:table-cell">Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {log.slice((logPage - 1) * LOG_PAGE_SIZE, logPage * LOG_PAGE_SIZE).map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="text-sm text-muted-foreground">{fmtDateTime(e.issued_at)}</TableCell>
                          <TableCell>
                            <p className="font-medium">{e.clients?.name ?? '—'}</p>
                            {e.clients?.phone && (
                              <p className="text-xs text-muted-foreground">{displayPhone(e.clients.phone)}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{e.rewards?.name ?? '—'}</TableCell>
                          <TableCell>
                            <Badge variant={e.trigger_source === 'auto' ? 'secondary' : 'outline'}>
                              {e.trigger_source === 'auto' ? 'Auto' : 'Manual'}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                            {e.issued_by_email ?? <span className="text-muted-foreground/50">System</span>}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-xs truncate">
                            {e.note ?? <span className="text-muted-foreground/50">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {Math.ceil(log.length / LOG_PAGE_SIZE) > 1 && (
                  <Pagination
                    page={logPage}
                    totalPages={Math.ceil(log.length / LOG_PAGE_SIZE)}
                    totalCount={log.length}
                    pageSize={LOG_PAGE_SIZE}
                    onPageChange={setLogPage}
                  />
                )}
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <RewardDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        reward={editing}
        products={products}
        services={services}
        currency={currency}
      />

      <IssueDialog
        open={issueTarget !== null}
        onOpenChange={(v) => { if (!v) setIssueTarget(null) }}
        reward={issueTarget}
        clients={clients}
        rewardSummary={issueTarget
          ? `${describeCondition(issueTarget, productNames, serviceNames, currency)} (${describeWindow(issueTarget)}) → ${describeReward(issueTarget, productNames, serviceNames, currency)}`
          : ''}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(v) => { if (!v) setArchiveTarget(null) }}
        title="Archive reward?"
        description={
          archiveTarget
            ? `"${archiveTarget.name}" will stop being offered. Past issuances in History are not affected.`
            : ''
        }
        confirmLabel="Archive"
        loading={archiving}
        onConfirm={handleArchiveConfirm}
      />
    </div>
  )
}
