'use client'

import { useState, useEffect } from 'react'
import { ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Pagination } from '@/components/ui/pagination'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn, formatMoney, displayPhone } from '@/lib/utils'
import type { UserRole } from '@/lib/supabase/dal'
import { SaleDialog } from './sale-dialog'
import type { SaleClient, SaleCatalogEntry, SaleStaff } from './sale-dialog'

export type Sale = {
  id: string
  total: number
  note: string | null
  created_at: string
  clients: { name: string; phone: string } | null
  members: { fullname: string } | null
}

const PAGE_SIZE = 50

type Props = {
  sales: Sale[]
  clients: SaleClient[]
  allCatalog: SaleCatalogEntry[]
  staff: SaleStaff[]
  timezone: string
  role: UserRole
  currency: string
  initialClientId?: string
}

function formatSaleDateTime(isoString: string, tz: string): string {
  return new Date(isoString).toLocaleString('en-GB', {
    timeZone: tz,
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  })
}

export function SalesView({ sales, clients, allCatalog, staff, timezone, role, currency, initialClientId }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [preselectedClientId, setPreselectedClientId] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)

  // Auto-open the new-sale dialog when arriving from visit log with a client pre-selected.
  useEffect(() => {
    if (initialClientId) {
      setPreselectedClientId(initialClientId)
      setDialogOpen(true)
    }
  }, [initialClientId])

  const totalPages = Math.ceil(sales.length / PAGE_SIZE)
  const paginatedSales = sales.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function openNewSale() {
    setPreselectedClientId(undefined)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales"
        subtitle={`${sales.length} sale${sales.length !== 1 ? 's' : ''} recorded`}
      />

      <div className="flex justify-end">
        <Button onClick={openNewSale}>
          <ShoppingCart className="h-4 w-4 mr-2" />
          New sale
        </Button>
      </div>

      {sales.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          message="No sales recorded yet. Record the first one."
          action={<Button onClick={openNewSale}>New sale</Button>}
        />
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="hidden sm:table-cell">Date & time</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden md:table-cell">Stylist</TableHead>
                  <TableHead className="hidden lg:table-cell">Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedSales.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{s.clients?.name ?? '—'}</p>
                        {s.clients?.phone && (
                          <p className="text-xs text-muted-foreground">{displayPhone(s.clients.phone)}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                      {formatSaleDateTime(s.created_at, timezone)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(s.total, currency)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                      {s.members?.fullname ?? <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                    <TableCell className={cn('hidden lg:table-cell text-muted-foreground text-sm max-w-xs truncate')}>
                      {s.note ?? <span className="text-muted-foreground/50">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalCount={sales.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      <SaleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clients={clients}
        allCatalog={allCatalog}
        staff={staff}
        currency={currency}
        preselectedClientId={preselectedClientId}
      />
    </div>
  )
}
