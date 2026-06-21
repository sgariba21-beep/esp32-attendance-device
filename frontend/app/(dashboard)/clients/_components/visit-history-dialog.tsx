'use client'

import { CalendarDays } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientName: string
  dates: string[]
}

function formatDate(d: string): string {
  const [year, month, day] = d.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

export function VisitHistoryDialog({ open, onOpenChange, clientName, dates }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Visit history — {clientName}</DialogTitle>
        </DialogHeader>

        <div className="py-1">
          <p className="text-sm text-muted-foreground mb-3">
            {dates.length === 0
              ? 'No visits recorded yet.'
              : `${dates.length} visit${dates.length !== 1 ? 's' : ''} total`}
          </p>

          {dates.length > 0 && (
            <ul className="space-y-1 max-h-80 overflow-y-auto pr-1">
              {dates.map((d) => (
                <li key={d} className="flex items-center gap-2 text-sm py-1.5 border-b border-border last:border-0">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>{formatDate(d)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
