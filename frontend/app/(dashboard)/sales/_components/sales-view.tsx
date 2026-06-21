'use client'

import { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { cn, formatGHS, displayPhone } from '@/lib/utils'
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

type Props = {
  sales: Sale[]
  clients: SaleClient[]
  allCatalog: SaleCatalogEntry[]
  staff: SaleStaff[]
  timezone: string
  role: UserRole
}

function formatSaleDateTime(isoString: string, tz: string): string {
  return new Date(isoString).toLocaleString('en-GB', {
    timeZone: tz,
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  })
}

export function SalesView({ sales, clients, allCatalog, staff, timezone, role }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales"
        subtitle={`${sales.length} sale${sales.length !== 1 ? 's' : ''} recorded`}
      />

      <div className="flex justify-end">
        <Button onClick={() => setDialogOpen(true)}>
          <ShoppingCart className="h-4 w-4 mr-2" />
          New sale
        </Button>
      </div>

      {sales.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          message="No sales recorded yet. Record the first one."
          action={<Button onClick={() => setDialogOpen(true)}>New sale</Button>}
        />
      ) : (
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
              {sales.map((s) => (
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
                    {formatGHS(s.total)}
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
      )}

      <SaleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clients={clients}
        allCatalog={allCatalog}
        staff={staff}
      />
    </div>
  )
}
