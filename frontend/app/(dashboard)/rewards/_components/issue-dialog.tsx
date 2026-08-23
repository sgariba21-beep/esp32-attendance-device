'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { SingleSelect } from '@/components/ui/single-select'
import { displayPhone } from '@/lib/utils'
import { issueReward, getEligibleClientsForReward } from '../_actions'
import type { Reward, ClientLite } from './rewards-view'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  reward: Reward | null
  clients: ClientLite[]
  rewardSummary: string
}

export function IssueDialog({ open, onOpenChange, reward, clients, rewardSummary }: Props) {
  const [clientId, setClientId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [eligibleIds, setEligibleIds] = useState<Set<string> | null>(null)
  const [checking, setChecking] = useState(false)

  const loadEligible = useCallback(async (rewardId: string) => {
    setChecking(true)
    const res = await getEligibleClientsForReward(rewardId)
    setChecking(false)
    if (res.error) { setError(res.error); setEligibleIds(new Set()); return }
    setEligibleIds(new Set(res.eligibleClientIds))
  }, [])

  useEffect(() => {
    if (open) {
      setClientId('')
      setNote('')
      setError(null)
      setEligibleIds(null)
      if (reward) loadEligible(reward.id)
    }
  }, [open, reward, loadEligible])

  // Only clients who've actually earned this reward are selectable — a
  // client who hasn't earned it can no longer be picked by mistake.
  const clientOptions = useMemo(
    () => clients
      .filter(c => eligibleIds?.has(c.id))
      .map(c => ({ value: c.id, label: `${c.name} — ${displayPhone(c.phone)}` })),
    [clients, eligibleIds],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!reward) return
    if (!clientId) { setError('Please select a client.'); return }

    setLoading(true)
    setError(null)
    const result = await issueReward(reward.id, clientId, note)
    setLoading(false)
    if (result.error) { setError(result.error); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue reward</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-sm font-medium">{reward?.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{rewardSummary}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="issue-client">Client *</Label>
            {checking ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking who has earned this…
              </div>
            ) : clientOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No clients have earned this reward yet.
              </p>
            ) : (
              <SingleSelect
                id="issue-client"
                options={clientOptions}
                value={clientId}
                onChange={setClientId}
                placeholder="Select client…"
                searchPlaceholder="Search by name or phone…"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="issue-note">
              Note
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="issue-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Redeemed on next visit"
            />
          </div>

          {error && (
            <Alert variant="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || checking || clientOptions.length === 0}>
              {loading ? 'Issuing…' : 'Issue reward'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
