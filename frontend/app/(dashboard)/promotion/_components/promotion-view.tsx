'use client'

import { useState } from 'react'
import { ArrowRight, ChevronDown, Users } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { applyPromotion } from '../_actions'
import type { PromotionGroup } from '../page'

const GROUP_PREVIEW = 50
const UNMATCHED_PREVIEW = 15

type Props = {
  groups: PromotionGroup[]
  totalActive: number
}

export function PromotionView({ groups, totalActive }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ promoted: number; deactivated: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [fullGroups, setFullGroups] = useState<Set<string>>(new Set())
  const [showAllUnmatched, setShowAllUnmatched] = useState(false)

  function toggleGroup(form: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      next.has(form) ? next.delete(form) : next.add(form)
      return next
    })
  }

  function expandFull(form: string) {
    setFullGroups((prev) => new Set(prev).add(form))
  }

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

  const confirmDescription = (
    <div className="space-y-3 text-sm">
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
          <li className="text-warning-foreground">
            <span className="font-medium">{totalUnmatched}</span> student{totalUnmatched !== 1 ? 's' : ''} skipped (no matching device)
          </li>
        )}
      </ul>
      <p className="text-muted-foreground">
        Fingerprint slots will be cleared for promoted students — they&apos;ll need to re-enroll on the new class device.
      </p>
      <p className="font-medium text-muted-foreground">This cannot be undone.</p>
    </div>
  )

  // ── success state ─────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="space-y-4">
        <PageHeader title="Promotion" />
        <Alert variant="success">
          <AlertTitle>Promotion applied successfully</AlertTitle>
          <AlertDescription>
            {result.promoted} student{result.promoted !== 1 ? 's' : ''} promoted
            {result.deactivated > 0 && `, ${result.deactivated} deactivated`}.
            Fingerprint slots have been cleared — re-enroll students on their new class device.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // ── empty state ───────────────────────────────────────────────────────────
  if (totalActive === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="Promotion" />
        <EmptyState icon={Users} message="No active students to promote." />
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="Promotion" />
        <EmptyState icon={Users} message="No devices are set up, so promotion cannot be calculated." />
      </div>
    )
  }

  // ── preview ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Promotion"
        subtitle="Review what will happen, then apply when ready."
        actions={
          <div className="flex flex-col items-end gap-0.5">
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={totalMatched === 0}
            >
              Apply promotion
            </Button>
            <p className="text-xs text-muted-foreground">Irreversible — affects all students</p>
          </div>
        }
      />

      {error && (
        <Alert variant="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.fromForm} className="rounded-xl border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{g.fromForm}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              {g.toForm
                ? <span className="text-sm font-medium">{g.toForm}</span>
                : <Badge variant="secondary">Inactive</Badge>
              }
            </div>
            <div className="tabular-nums text-2xl font-semibold">{g.matched.length}</div>
            <p className="text-xs text-muted-foreground">
              {g.toForm ? 'students will be promoted' : 'students will be deactivated'}
            </p>
            {g.unmatched.length > 0 && (
              <p className="text-xs text-warning-foreground">
                + {g.unmatched.length} unmatched (see below)
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Warnings */}
      {totalUnmatched > 0 && (() => {
        const allUnmatched = groups.flatMap((g) =>
          g.unmatched.map((s) => ({ ...s, toForm: g.toForm }))
        )
        const visible = showAllUnmatched ? allUnmatched : allUnmatched.slice(0, UNMATCHED_PREVIEW)
        const hidden = allUnmatched.length - visible.length
        return (
          <Alert variant="warning">
            <AlertTitle>
              {totalUnmatched} student{totalUnmatched !== 1 ? 's' : ''} cannot be promoted
            </AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                No device exists for their next form + class combination. Add the missing devices first,
                or they will be skipped when you apply.
              </p>
              <div className="space-y-1">
                {visible.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-xs">
                    <span className="font-medium">{s.fullname}</span>
                    <span className="opacity-75">({s.sid})</span>
                    <span className="opacity-75">— no {s.toForm} {s.fromClass} device</span>
                  </div>
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllUnmatched(true)}
                    className="text-xs underline hover:opacity-80 mt-1"
                  >
                    + {hidden} more
                  </button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )
      })()}

      {/* Detailed breakdown — collapsible per group */}
      <div className="space-y-2">
        {groups.map((g) => {
          const isOpen = expandedGroups.has(g.fromForm)
          const isFull = fullGroups.has(g.fromForm)
          const all = [...g.matched, ...g.unmatched]
          const visible = isFull ? all : all.slice(0, GROUP_PREVIEW)
          const hidden = all.length - visible.length

          return (
            <div key={g.fromForm} className="rounded-xl border bg-muted/30 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleGroup(g.fromForm)}
                className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium select-none hover:bg-muted/50"
              >
                <span>
                  {g.fromForm} → {g.toForm ?? 'Inactive'}
                  <span className="ml-2 tabular-nums font-normal text-muted-foreground">
                    ({all.length} students)
                  </span>
                </span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>

              {isOpen && (
                <div className="border-t bg-background rounded-b-xl px-4 py-3 space-y-1">
                  {visible.map((s) => {
                    const isUnmatched = g.unmatched.includes(s)
                    return (
                      <div key={s.id} className="flex items-center gap-2 text-sm py-0.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${isUnmatched ? 'bg-warning' : 'bg-success'}`} />
                        <span>{s.fullname}</span>
                        <span className="text-muted-foreground">{s.sid}</span>
                        {isUnmatched
                          ? <span className="text-warning-foreground">· no {g.toForm} {s.fromClass} device</span>
                          : <span className="text-muted-foreground">· {s.fromClass}</span>
                        }
                      </div>
                    )
                  })}
                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => expandFull(g.fromForm)}
                      className="text-xs text-muted-foreground underline hover:text-foreground mt-1"
                    >
                      Show {hidden} more
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Apply promotion?"
        description={confirmDescription}
        confirmLabel="Confirm"
        loading={loading}
        onConfirm={handleApply}
      />
    </div>
  )
}
