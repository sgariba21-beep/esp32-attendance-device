'use client'

import { useState } from 'react'
import { BarChart3, Download, Package, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { cn, formatGHS } from '@/lib/utils'
import type { UserRole } from '@/lib/supabase/dal'

export type DailyTakings  = { date: string; total: number; count: number }
export type WeeklyTakings = { weekStart: string; total: number; count: number }
export type ClientRevenue = { clientId: string; name: string; total: number; count: number }
export type StylistRevenue = { stylistId: string | null; name: string; total: number; count: number }
export type PopularItem   = { name: string; type: 'service' | 'product'; qty: number; revenue: number }
export type VisitFreq     = { name: string; count: number; lastVisit: string }
export type LowStockItem  = { id: string; name: string; stock: number; price: number }
export type RewardIssued  = { name: string; count: number; lastIssued: string }

type Props = {
  dailyTakings: DailyTakings[]
  weeklyTakings: WeeklyTakings[]
  clientRevenue: ClientRevenue[]
  stylistRevenue: StylistRevenue[]
  popularItems: PopularItem[]
  visitFreq: VisitFreq[]
  lowStock: LowStockItem[]
  rewardsIssued: RewardIssued[]
  role: UserRole
}

// Display a plain date string (YYYY-MM-DD) without UTC-shift: construct as UTC midnight.
function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GH', {
    timeZone: 'UTC',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function fmtWeek(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, d))
  const end   = new Date(start.getTime() + 6 * 86400000)
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'UTC', month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString('en-GH', opts)} – ${end.toLocaleDateString('en-GH', opts)}`
}

function fmtShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GH', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function ExportLink({ href, label }: { href: string; label?: string }) {
  return (
    <a href={href} download>
      <Button variant="outline" size="sm" className="gap-1.5">
        <Download className="h-3.5 w-3.5" />
        {label ?? 'Export CSV'}
      </Button>
    </a>
  )
}

export function ReportsView({
  dailyTakings,
  weeklyTakings,
  clientRevenue,
  stylistRevenue,
  popularItems,
  visitFreq,
  lowStock,
  rewardsIssued,
}: Props) {
  const [takingsView, setTakingsView] = useState<'daily' | 'weekly'>('daily')

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle="Revenue, visit, and inventory analytics" />

      <Tabs defaultValue="takings">
        <TabsList>
          <TabsTrigger value="takings">Takings</TabsTrigger>
          <TabsTrigger value="clients">By client ({clientRevenue.length})</TabsTrigger>
          <TabsTrigger value="stylists">By stylist ({stylistRevenue.length})</TabsTrigger>
          <TabsTrigger value="items">Items ({popularItems.length})</TabsTrigger>
          <TabsTrigger value="visits">Visits</TabsTrigger>
          <TabsTrigger value="low-stock">
            Low stock {lowStock.length > 0 ? `(${lowStock.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="rewards">Rewards</TabsTrigger>
        </TabsList>

        {/* ── Takings ─────────────────────────────────────────────────── */}
        <TabsContent value="takings">
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1.5">
                <Button
                  variant={takingsView === 'daily' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTakingsView('daily')}
                >
                  Daily
                </Button>
                <Button
                  variant={takingsView === 'weekly' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTakingsView('weekly')}
                >
                  Weekly
                </Button>
              </div>
              <ExportLink href="/api/reports/takings/export" />
            </div>

            {takingsView === 'daily' && (
              <>
                <p className="text-xs text-muted-foreground">Last 30 days</p>
                {dailyTakings.length === 0 ? (
                  <EmptyState icon={TrendingUp} message="No sales in the last 30 days." />
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border shadow-xs">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Sales</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyTakings.map((r) => (
                          <TableRow key={r.date}>
                            <TableCell>{fmtDate(r.date)}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{r.count}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{formatGHS(r.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}

            {takingsView === 'weekly' && (
              <>
                <p className="text-xs text-muted-foreground">Last 8 weeks</p>
                {weeklyTakings.length === 0 ? (
                  <EmptyState icon={TrendingUp} message="No sales in the last 8 weeks." />
                ) : (
                  <div className="overflow-hidden rounded-xl border border-border shadow-xs">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Week</TableHead>
                          <TableHead className="text-right">Sales</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {weeklyTakings.map((r) => (
                          <TableRow key={r.weekStart}>
                            <TableCell>{fmtWeek(r.weekStart)}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{r.count}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{formatGHS(r.total)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        {/* ── By client ───────────────────────────────────────────────── */}
        <TabsContent value="clients">
          <div className="mt-4 space-y-4">
            <div className="flex justify-end">
              <ExportLink href="/api/reports/clients/export" />
            </div>
            {clientRevenue.length === 0 ? (
              <EmptyState icon={TrendingUp} message="No sales recorded yet." />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Transactions</TableHead>
                      <TableHead className="text-right">Total revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientRevenue.map((r, i) => (
                      <TableRow key={r.clientId}>
                        <TableCell className="tabular-nums text-muted-foreground text-xs w-8">{i + 1}</TableCell>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{r.count}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{formatGHS(r.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── By stylist ──────────────────────────────────────────────── */}
        <TabsContent value="stylists">
          <div className="mt-4 space-y-4">
            <div className="flex justify-end">
              <ExportLink href="/api/reports/stylists/export" />
            </div>
            {stylistRevenue.length === 0 ? (
              <EmptyState icon={TrendingUp} message="No sales recorded yet." />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Stylist</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Total revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stylistRevenue.map((r, i) => (
                      <TableRow key={r.stylistId ?? '__none__'}>
                        <TableCell className="tabular-nums text-muted-foreground text-xs w-8">{i + 1}</TableCell>
                        <TableCell className="font-medium">
                          {r.stylistId
                            ? r.name
                            : <span className="italic text-muted-foreground">{r.name}</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{r.count}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{formatGHS(r.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Popular items ───────────────────────────────────────────── */}
        <TabsContent value="items">
          <div className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">Sorted by revenue, all time</p>
            {popularItems.length === 0 ? (
              <EmptyState icon={BarChart3} message="No items sold yet." />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty sold</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {popularItems.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="tabular-nums text-muted-foreground text-xs w-8">{i + 1}</TableCell>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>
                          <Badge variant={r.type === 'service' ? 'default' : 'secondary'}>
                            {r.type === 'service' ? 'Service' : 'Product'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{r.qty}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{formatGHS(r.revenue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Visit frequency ─────────────────────────────────────────── */}
        <TabsContent value="visits">
          <div className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">All-time visit count per client</p>
            {visitFreq.length === 0 ? (
              <EmptyState icon={BarChart3} message="No visits recorded yet." />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Visits</TableHead>
                      <TableHead className="text-right">Last visit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visitFreq.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="tabular-nums text-muted-foreground text-xs w-8">{i + 1}</TableCell>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{r.count}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{fmtShortDate(r.lastVisit)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Low stock ────────────────────────────────────────────────── */}
        <TabsContent value="low-stock">
          <div className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">Active products with stock ≤ 5</p>
            {lowStock.length === 0 ? (
              <EmptyState icon={Package} message="All products are well-stocked." />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowStock.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums font-semibold',
                            r.stock <= 0 ? 'text-destructive' : 'text-warning-foreground',
                          )}
                        >
                          {r.stock}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatGHS(r.price)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Rewards issued ───────────────────────────────────────────── */}
        <TabsContent value="rewards">
          <div className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">Total issuances per reward rule, all time</p>
            {rewardsIssued.length === 0 ? (
              <EmptyState icon={BarChart3} message="No rewards issued yet." />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reward</TableHead>
                      <TableHead className="text-right">Times issued</TableHead>
                      <TableHead className="text-right">Last issued</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rewardsIssued.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{r.count}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {fmtShortDate(r.lastIssued.slice(0, 10))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
