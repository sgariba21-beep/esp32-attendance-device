'use client'

import { useState, Fragment } from 'react'
import { Loader2, BookOpen } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { AcademicDialog } from './academic-dialog'
import { setActiveTerm, deleteAcademicTerm } from '../_actions'
import type { AcademicTerm } from '@/lib/types'

type Props = { terms: AcademicTerm[]; labelPeriod: string }

function formatDateRange(start: string, end: string) {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const sameYear = s.getFullYear() === e.getFullYear()
  const startStr = s.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  const endStr = e.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return `${startStr} – ${endStr}`
}

export function AcademicView({ terms, labelPeriod }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AcademicTerm | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<AcademicTerm | null>(null)

  function openAdd() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(term: AcademicTerm) {
    setEditing(term)
    setDialogOpen(true)
  }

  async function handleSetActive(term: AcademicTerm) {
    setLoadingId(term.id)
    setRowError(null)
    const result = await setActiveTerm(term.id)
    setLoadingId(null)
    if (result.error) setRowError({ id: term.id, message: result.error })
  }

  async function handleDelete(term: AcademicTerm) {
    setLoadingId(term.id)
    setRowError(null)
    const result = await deleteAcademicTerm(term.id)
    setLoadingId(null)
    if (result.error) setRowError({ id: term.id, message: result.error })
  }

  const activeTerm = terms.find((t) => t.status === 'active')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {activeTerm ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-sm">
            Active {labelPeriod.toLowerCase()}: <span className="font-medium">{activeTerm.term} {activeTerm.year}</span>
          </span>
        ) : (
          <p className="text-sm text-muted-foreground">No active {labelPeriod.toLowerCase()} set</p>
        )}
        <Button onClick={openAdd}>Add {labelPeriod.toLowerCase()}</Button>
      </div>

      {terms.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          message={`No ${labelPeriod.toLowerCase()}s yet. Add one to get started.`}
          action={<Button onClick={openAdd}>Add {labelPeriod.toLowerCase()}</Button>}
        />
      ) : (
        <div className="rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Term</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terms.map((t) => (
                <Fragment key={t.id}>
                  <TableRow>
                    <TableCell className="font-medium whitespace-nowrap">
                      {t.term} <span className="text-muted-foreground font-normal">· {t.year}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {t.start_date && t.end_date
                        ? formatDateRange(t.start_date, t.end_date)
                        : <span className="italic">Not set</span>}
                    </TableCell>
                    <TableCell>
                      {t.status === 'active' ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        {t.status !== 'active' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={loadingId === t.id}
                            onClick={() => handleSetActive(t)}
                          >
                            {loadingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Set active'}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(t)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={loadingId === t.id}
                          onClick={() => setConfirmTarget(t)}
                          className="text-destructive hover:text-destructive ml-1"
                        >
                          {loadingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Delete'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {rowError?.id === t.id && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-2">
                        <Alert variant="error">
                          <AlertDescription>{rowError.message}</AlertDescription>
                        </Alert>
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
        title="Delete term?"
        description={confirmTarget ? `This will permanently delete ${confirmTarget.term} ${confirmTarget.year}. All attendance records for this term will be unlinked.` : ''}
        confirmLabel="Delete term"
        loading={loadingId === confirmTarget?.id}
        onConfirm={async () => {
          if (!confirmTarget) return
          await handleDelete(confirmTarget)
          setConfirmTarget(null)
        }}
      />

      <AcademicDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        term={editing}
      />
    </div>
  )
}
