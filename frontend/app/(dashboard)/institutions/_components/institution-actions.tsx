'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DeleteInstitutionDialog } from './delete-institution-dialog'

type InstitutionInfo = {
  id: string
  name: string
  memberCount: number
  deviceCount: number
}

export function InstitutionActions({ institution }: { institution: InstitutionInfo }) {
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className="flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/institutions/${institution.id}`}>Edit</Link>
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
