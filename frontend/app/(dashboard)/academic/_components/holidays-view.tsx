'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
                <>
                  <TableRow key={h.id}>
                    <TableCell className="whitespace-nowrap font-medium">{formatDate(h.date)}</TableCell>
                    <TableCell>{h.label}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={loadingId === h.id}
                        onClick={() => handleDelete(h.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        {loadingId === h.id ? '…' : 'Delete'}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {rowError?.id === h.id && (
                    <TableRow key={`${h.id}-error`}>
                      <TableCell colSpan={3} className="py-2 text-sm text-destructive bg-destructive/5">
                        {rowError.message}
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <HolidayDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
