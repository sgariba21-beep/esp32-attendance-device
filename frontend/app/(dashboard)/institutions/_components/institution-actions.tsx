'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DeleteInstitutionDialog } from './delete-institution-dialog'
import { setInstitutionStatus } from '../_actions'

type InstitutionInfo = {
  id: string
  name: string
  status: 'active' | 'suspended' | 'deactivated'
  memberCount: number
  deviceCount: number
}

export function InstitutionActions({ institution }: { institution: InstitutionInfo }) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const isActive = institution.status === 'active'

  function toggleStatus() {
    startTransition(async () => {
      await setInstitutionStatus(institution.id, isActive ? 'suspended' : 'active')
    })
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleStatus}
        disabled={pending}
        className={isActive ? 'text-warning-foreground hover:text-warning-foreground' : ''}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isActive ? 'Suspend' : 'Activate'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        render={<Link href={`/institutions/${institution.id}`} />}
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setDeleteOpen(true)}
      >
        Delete
      </Button>
      <DeleteInstitutionDialog
        institution={institution}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  )
}
