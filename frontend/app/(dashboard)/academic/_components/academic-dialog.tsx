'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createAcademicTerm, updateAcademicTerm } from '../_actions'
import type { AcademicTerm } from '@/lib/types'

const TERMS = ['Term 1', 'Term 2', 'Term 3'] as const

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  term: AcademicTerm | null
}

const empty = { term: 'Term 1', year: '', start_date: '', end_date: '' }

export function AcademicDialog({ open, onOpenChange, term }: Props) {
  const [form, setForm] = useState(empty)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      setForm(term
        ? {
            term: term.term,
            year: term.year,
            start_date: term.start_date ?? '',
            end_date: term.end_date ?? '',
          }
        : empty)
    }
  }, [open, term])

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      setError('End date must be after start date.')
      return
    }
    setLoading(true)
    setError(null)

    const result = term
      ? await updateAcademicTerm(term.id, form)
      : await createAcademicTerm(form)

    setLoading(false)
    if (result.error) { setError(result.error); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{term ? 'Edit term' : 'Add academic term'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="term">Term</Label>
            <select
              id="term"
              value={form.term}
              onChange={(e) => set('term', e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="year">Year</Label>
            <Input
              id="year"
              value={form.year}
              onChange={(e) => set('year', e.target.value)}
              placeholder="e.g. 2026 or 2025/2026"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start_date">Start date</Label>
              <Input
                id="start_date"
                type="date"
                value={form.start_date}
                onChange={(e) => set('start_date', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">End date</Label>
              <Input
                id="end_date"
                type="date"
                value={form.end_date}
                onChange={(e) => set('end_date', e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Optional. When set, absences are only recorded within this range.
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : term ? 'Save changes' : 'Add term'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
