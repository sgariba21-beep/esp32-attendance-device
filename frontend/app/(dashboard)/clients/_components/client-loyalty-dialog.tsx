'use client'

import { useState, useEffect, useCallback } from 'react'
import { Gift, Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { cn, formatMoney } from '@/lib/utils'
import { describeCondition, describeReward, type Reward } from '../../rewards/_components/rewards-view'
import { issueReward } from '../../rewards/_actions'
import { getClientLoyalty } from '../_actions'
import type { ClientLoyalty } from '../_actions'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: { id: string; name: string } | null
  canIssue: boolean
}

function fmt(value: number, isAmount: boolean, currency: string): string {
  return isAmount ? formatMoney(value, currency) : String(Math.round(value))
}

export function ClientLoyaltyDialog({ open, onOpenChange, client, canIssue }: Props) {
  const [data, setData] = useState<ClientLoyalty | null>(null)
  const [loading, setLoading] = useState(false)
  const [issuingId, setIssuingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (clientId: string) => {
    setLoading(true)
    setError(null)
    const res = await getClientLoyalty(clientId)
    setData(res)
    setLoading(false)
    if (res.error) setError(res.error)
  }, [])

  useEffect(() => {
    if (open && client) {
      load(client.id)
    } else if (!open) {
      setData(null)
      setError(null)
    }
  }, [open, client, load])

  async function handleIssue(rewardId: string) {
    if (!client) return
    setIssuingId(rewardId)
    const res = await issueReward(rewardId, client.id, '')
    setIssuingId(null)
    if (res.error) { setError(res.error); return }
    // Re-evaluate: a since_last_issuance window resets, a lifetime card advances.
    await load(client.id)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Loyalty — {client?.name}</DialogTitle>
        </DialogHeader>

        <div className="py-1">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <p className="py-6 text-center text-sm text-destructive">{error}</p>
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={Gift} message="No active reward rules to track." />
          ) : (
            <ul className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {data.items.map(({ reward, progress }) => {
                const conditionText = describeCondition(reward as Reward, data.productNames, data.serviceNames, data.currency)
                const rewardText = describeReward(reward as Reward, data.productNames, data.serviceNames, data.currency)
                return (
                  <li key={reward.id} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{reward.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {conditionText} ({progress.windowLabel}) → {rewardText}
                        </p>
                      </div>
                      {progress.claimed ? (
                        <Badge variant="secondary">Claimed</Badge>
                      ) : progress.eligible ? (
                        <Badge variant="success">Eligible{progress.pending > 1 ? ` ×${progress.pending}` : ''}</Badge>
                      ) : null}
                    </div>

                    {!progress.claimed && (
                      <>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-full rounded-full', progress.eligible ? 'bg-green-500' : 'bg-primary')}
                            style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {fmt(progress.progress, progress.isAmount, data.currency)} / {fmt(progress.threshold, progress.isAmount, data.currency)}
                          </span>
                          {progress.eligible && canIssue && (
                            <Button size="sm" disabled={issuingId === reward.id} onClick={() => handleIssue(reward.id)}>
                              {issuingId === reward.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Issue reward'}
                            </Button>
                          )}
                          {progress.eligible && !canIssue && (
                            <span className="text-xs text-muted-foreground">Ask an admin to issue</span>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
