'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { applyPromotion } from '../_actions'
import type { PromotionGroup } from '../page'

type Props = {
  groups: PromotionGroup[]
  totalActive: number
}

export function PromotionView({ groups, totalActive }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ promoted: number; deactivated: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const totalMatched = groups.reduce((n, g) => n + g.matched.length, 0)
  const totalUnmatched = groups.reduce((n, g) => n + g.unmatched.length, 0)
  const willPromote = groups.filter(g => g.toForm !== null).reduce((n, g) => n + g.matched.length, 0)
  const willDeactivate = groups.filter(g => g.toForm === null).reduce((n, g) => n + g.matched.length, 0)

  async function handleApply() {
    setLoading(true)
    setError(null)
    const res = await applyPromotion()
    setLoading(false)
    setConfirmOpen(false)
    if (res.error) { setError(res.error); return }
    setResult({ promoted: res.promoted, deactivated: res.deactivated })
  }

  // ── success state ─────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Promotion</h1>
        <div className="rounded-md border border-green-200 bg-green-50 p-6 text-center space-y-1">
          <p className="text-lg font-medium text-green-800">Promotion applied successfully</p>
          <p className="text-sm text-green-700">
            {result.promoted} student{result.promoted !== 1 ? 's' : ''} promoted
            {result.deactivated > 0 && `, ${result.deactivated} deactivated`}.
          </p>
          <p className="text-sm text-muted-foreground pt-2">
            Fingerprint slots have been cleared — re-enroll students on their new class device.
          </p>
        </div>
      </div>
    )
  }

  // ── empty state ───────────────────────────────────────────────────────────
  if (totalActive === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Promotion</h1>
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No active students to promote.</p>
        </div>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Promotion</h1>
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            No devices are set up, so promotion cannot be calculated.
          </p>
        </div>
      </div>
    )
  }

  // ── preview ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Promotion</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Review what will happen, then apply when ready.
          </p>
        </div>
        <Button
          onClick={() => setConfirmOpen(true)}
          disabled={totalMatched === 0}
        >
          Apply promotion
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.fromForm} className="rounded-md border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{g.fromForm}</span>
              <span className="text-muted-foreground text-sm">→</span>
              {g.toForm
                ? <span className="text-sm font-medium">{g.toForm}</span>
                : <Badge variant="secondary">Inactive</Badge>
              }
            </div>
            <div className="text-2xl font-semibold">{g.matched.length}</div>
            <p className="text-xs text-muted-foreground">
              {g.toForm ? 'students will be promoted' : 'students will be deactivated'}
            </p>
            {g.unmatched.length > 0 && (
              <p className="text-xs text-amber-600">
                + {g.unmatched.length} unmatched (see below)
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Warnings */}
      {totalUnmatched > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-3">
          <p className="text-sm font-medium text-amber-800">
            ⚠ {totalUnmatched} student{totalUnmatched !== 1 ? 's' : ''} cannot be promoted
          </p>
          <p className="text-xs text-amber-700">
            No device exists for their next form + class combination. Add the missing devices first,
            or they will be skipped when you apply.
          </p>
          <div className="space-y-1">
            {groups.flatMap((g) =>
              g.unmatched.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs text-amber-800">
                  <span className="font-medium">{s.fullname}</span>
                  <span className="text-amber-600">({s.sid})</span>
                  <span className="text-amber-600">
                    — no {g.toForm} {s.fromClass} device
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Detailed breakdown — collapsible per group */}
      <div className="space-y-4">
        {groups.map((g) => (
          <details key={g.fromForm} className="rounded-md border">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium select-none hover:bg-muted/50">
              <span>
                {g.fromForm} → {g.toForm ?? 'Inactive'}
                <span className="ml-2 font-normal text-muted-foreground">
                  ({g.matched.length + g.unmatched.length} students)
                </span>
              </span>
              <span className="text-muted-foreground text-xs">Click to expand</span>
            </summary>
            <div className="border-t px-4 py-3 space-y-1">
              {g.matched.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-sm py-0.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  <span>{s.fullname}</span>
                  <span className="text-muted-foreground">{s.sid}</span>
                  <span className="text-muted-foreground">· {s.fromClass}</span>
                </div>
              ))}
              {g.unmatched.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-sm py-0.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                  <span>{s.fullname}</span>
                  <span className="text-muted-foreground">{s.sid}</span>
                  <span className="text-amber-600">· no {g.toForm} {s.fromClass} device</span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Apply promotion?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p>This will:</p>
            <ul className="space-y-1 list-none pl-2">
              {willPromote > 0 && (
                <li>
                  <span className="font-medium">{willPromote}</span> student{willPromote !== 1 ? 's' : ''} moved to the next form
                </li>
              )}
              {willDeactivate > 0 && (
                <li>
                  <span className="font-medium">{willDeactivate}</span> student{willDeactivate !== 1 ? 's' : ''} deactivated (final form)
                </li>
              )}
              {totalUnmatched > 0 && (
                <li className="text-amber-700">
                  <span className="font-medium">{totalUnmatched}</span> student{totalUnmatched !== 1 ? 's' : ''} skipped (no matching device)
                </li>
              )}
            </ul>
            <p className="text-muted-foreground">
              Fingerprint slots will be cleared for promoted students — they&apos;ll need to re-enroll on the new class device.
            </p>
            <p className="text-muted-foreground font-medium">This cannot be undone.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={loading}>
              {loading ? 'Applying…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
