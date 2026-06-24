'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SingleSelect } from '@/components/ui/single-select'
import { displayPhone } from '@/lib/utils'
import { issueReward } from '../_actions'
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

  useEffect(() => {
    if (open) {
      setClientId('')
      setNote('')
      setError(null)
    }
  }, [open, reward?.id])

  const clientOptions = useMemo(
    () => clients.map(c => ({ value: c.id, label: `${c.name} — ${displayPhone(c.phone)}` })),
    [clients],
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
            <SingleSelect
              id="issue-client"
              options={clientOptions}
              value={clientId}
              onChange={setClientId}
              placeholder="Select client…"
              searchPlaceholder="Search by name or phone…"
            />
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
            <Button type="submit" disabled={loading}>
              {loading ? 'Issuing…' : 'Issue reward'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
