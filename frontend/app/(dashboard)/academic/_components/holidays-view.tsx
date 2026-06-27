'use client'

import { useState, Fragment } from 'react'
import { Loader2, CalendarOff, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { HolidayDialog } from './holiday-dialog'
import { deleteHoliday } from '../_actions'
import type { Holiday } from '@/lib/types'

type Props = { holidays: Holiday[]; labelOverride?: string }

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Recurring holidays match on day + month only, so we drop the (meaningless) year.
function formatDayMonth(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

function formatRange(h: Holiday) {
  if (h.recurring) {
    if (h.start_date.slice(5) === h.end_date.slice(5)) return formatDayMonth(h.start_date)
    return `${formatDayMonth(h.start_date)} – ${formatDayMonth(h.end_date)}`
  }
  if (h.start_date === h.end_date) return formatDate(h.start_date)
  return `${formatDate(h.start_date)} – ${formatDate(h.end_date)}`
}

export function HolidaysView({ holidays, labelOverride }: Props) {
  const label = labelOverride ?? 'Holiday'
  const labelPlural = labelOverride ? labelOverride : 'Holidays'
  const [dialogOpen, setDialogOpen] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<Holiday | null>(null)

  async function handleDelete(id: string) {
    setLoadingId(id)
    setRowError(null)
    const result = await deleteHoliday(id)
    setLoadingId(null)
    if (result.error) setRowError({ id, message: result.error })
  }

  const today = new Date().toISOString().slice(0, 10)
  const sorted = [...holidays].sort((a, b) => a.start_date.localeCompare(b.start_date))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {labelOverride
            ? `${labelPlural} are skipped when recording absences.`
            : 'Days marked as holidays are skipped when recording absences.'}
        </p>
        <Button onClick={() => setDialogOpen(true)}>Add {label.toLowerCase()}</Button>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          message={`No ${labelPlural.toLowerCase()} added yet.`}
          action={<Button onClick={() => setDialogOpen(true)}>Add {label.toLowerCase()}</Button>}
        />
      ) : (
        <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date range</TableHead>
                <TableHead>Label</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((h) => {
                // Recurring holidays repeat yearly, so they're never "past".
                const isPast = !h.recurring && h.end_date < today
                return (
                  <Fragment key={h.id}>
                    <TableRow>
                      <TableCell className={`whitespace-nowrap font-medium${isPast ? ' text-muted-foreground' : ''}`}>
                        {formatRange(h)}
                      </TableCell>
                      <TableCell className={isPast ? 'text-muted-foreground' : undefined}>
                        <span className="inline-flex items-center gap-2">
                          {h.label}
                          {h.recurring && (
                            <Badge variant="secondary" className="gap-1">
                              <RefreshCw className="h-3 w-3" />
                              Yearly
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={loadingId === h.id}
                          onClick={() => setConfirmTarget(h)}
                          className="text-destructive hover:text-destructive"
                        >
                          {loadingId === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Delete'}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {rowError?.id === h.id && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-2">
                          <Alert variant="error">
                            <AlertDescription>{rowError.message}</AlertDescription>
                          </Alert>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(v) => { if (!v) setConfirmTarget(null) }}
        title={`Delete ${label.toLowerCase()}?`}
        description={confirmTarget ? `This will permanently remove "${confirmTarget.label}" (${formatRange(confirmTarget)}) from the list.` : ''}
        confirmLabel="Delete holiday"
        loading={loadingId === confirmTarget?.id}
        onConfirm={async () => {
          if (!confirmTarget) return
          await handleDelete(confirmTarget.id)
          setConfirmTarget(null)
        }}
      />

      <HolidayDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
