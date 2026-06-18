'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { deleteInstitution } from '../_actions'

type InstitutionInfo = {
  id: string
  name: string
  memberCount: number
  deviceCount: number
}

type Props = {
  institution: InstitutionInfo
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeleteInstitutionDialog({ institution, open, onOpenChange }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [confirmText, setConfirmText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    setStep(1)
    setConfirmText('')
    setError(null)
    onOpenChange(false)
  }

  async function handleDelete() {
    if (confirmText !== institution.name) return
    setLoading(true)
    setError(null)
    const result = await deleteInstitution(institution.id)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    handleClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 1 && `Delete ${institution.name}?`}
            {step === 2 && 'This is permanent — review what will be deleted'}
            {step === 3 && 'Type the institution name to confirm'}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              You are about to permanently delete{' '}
              <span className="font-semibold text-foreground">{institution.name}</span>{' '}
              and all of its data. This action cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button variant="destructive" onClick={() => setStep(2)}>Continue</Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Deleting <span className="font-semibold text-foreground">{institution.name}</span> will permanently remove:
            </p>
            <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
              <li>{institution.memberCount} member{institution.memberCount !== 1 ? 's' : ''} and all fingerprint data</li>
              <li>{institution.deviceCount} device{institution.deviceCount !== 1 ? 's' : ''}</li>
              <li>All attendance records</li>
              <li>All academic periods and holidays</li>
              <li>All enrollment jobs</li>
              <li>All user accounts for this institution</li>
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button variant="destructive" onClick={() => setStep(3)}>I understand, continue</Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-semibold text-foreground">{institution.name}</span> to permanently delete it.
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={institution.name}
              autoFocus
            />
            {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={confirmText !== institution.name || loading}
                onClick={handleDelete}
              >
                {loading ? 'Deleting…' : 'Permanently delete'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
