'use client'

import { useState, Fragment } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { AcademicDialog } from './academic-dialog'
import { setActiveTerm, deleteAcademicTerm } from '../_actions'
import type { AcademicTerm } from '@/lib/types'

type Props = { terms: AcademicTerm[] }

export function AcademicView({ terms }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AcademicTerm | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

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
        <p className="text-sm text-muted-foreground">
          {activeTerm
            ? <>Active term: <span className="font-medium text-foreground">{activeTerm.term} {activeTerm.year}</span></>
            : 'No active term set'}
        </p>
        <Button onClick={openAdd}>Add term</Button>
      </div>

      {terms.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No academic terms yet. Add one to get started.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Term</TableHead>
                <TableHead>Year</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terms.map((t) => (
                <Fragment key={t.id}>
                  <TableRow>
                    <TableCell className="font-medium">{t.term}</TableCell>
                    <TableCell>{t.year}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {t.start_date && t.end_date
                        ? `${t.start_date} → ${t.end_date}`
                        : <span className="italic">Not set</span>}
                    </TableCell>
                    <TableCell>
                      {t.status === 'active' ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {t.status !== 'active' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={loadingId === t.id}
                            onClick={() => handleSetActive(t)}
                          >
                            {loadingId === t.id ? '…' : 'Set active'}
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
                          onClick={() => handleDelete(t)}
                          className="text-destructive hover:text-destructive"
                        >
                          {loadingId === t.id ? '…' : 'Delete'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {rowError?.id === t.id && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-2 text-sm text-destructive bg-destructive/5">
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

      <AcademicDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        term={editing}
      />
    </div>
  )
}
