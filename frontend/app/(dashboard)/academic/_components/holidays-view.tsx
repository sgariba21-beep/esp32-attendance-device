'use client'

import { useState, Fragment } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { HolidayDialog } from './holiday-dialog'
import { deleteHoliday } from '../_actions'

export type Holiday = {
  id: string
  date: string
  label: string
}

type Props = { holidays: Holiday[] }

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function HolidaysView({ holidays }: Props) {
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

  const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Days marked as holidays are skipped when recording absences.
        </p>
        <Button onClick={() => setDialogOpen(true)}>Add holiday</Button>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No holidays added yet.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Label</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((h) => (
                <Fragment key={h.id}>
                  <TableRow>
                    <TableCell className="whitespace-nowrap font-medium">{formatDate(h.date)}</TableCell>
                    <TableCell>{h.label}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={loadingId === h.id}
                        onClick={() => setConfirmTarget(h)}
                        className="text-destructive hover:text-destructive"
                      >
                        {loadingId === h.id ? '…' : 'Delete'}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {rowError?.id === h.id && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-2 text-sm text-destructive bg-destructive/5">
                        {rowError.message}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(v) => { if (!v) setConfirmTarget(null) }}
        title="Delete holiday?"
        description={confirmTarget ? `This will permanently remove "${confirmTarget.label}" (${formatDate(confirmTarget.date)}) from the holiday list.` : ''}
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
