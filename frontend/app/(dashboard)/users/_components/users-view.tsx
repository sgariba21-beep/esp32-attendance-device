'use client'

import { useState } from 'react'
import { ShieldCheck, Pencil, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { UserDialog } from './user-dialog'
import { deleteUser } from '../_actions'
import type { UserRole } from '@/lib/supabase/dal'

export type UserRow = {
  id: string
  email: string
  created_at: string
  role: UserRole
  assigned_class: string | null
}

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin:       'Admin',
  teacher:     'Teacher',
}

const ROLE_BADGE: Record<UserRole, 'default' | 'secondary' | 'outline'> = {
  super_admin: 'default',
  admin:       'secondary',
  teacher:     'outline',
}

type Props = {
  users: UserRow[]
  currentUserId: string
}

export function UsersView({ users, currentUserId }: Props) {
  const [dialogOpen, setDialogOpen]     = useState(false)
  const [editing, setEditing]           = useState<UserRow | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<UserRow | null>(null)
  const [deleting, setDeleting]         = useState(false)
  const [deleteError, setDeleteError]   = useState<string | null>(null)

  function openAdd() { setEditing(null); setDialogOpen(true) }
  function openEdit(u: UserRow) { setEditing(u); setDialogOpen(true) }

  async function handleDelete() {
    if (!confirmTarget) return
    setDeleting(true)
    setDeleteError(null)
    const result = await deleteUser(confirmTarget.id)
    setDeleting(false)
    if (result.error) {
      setDeleteError(result.error)
      setConfirmTarget(null)
      return
    }
    setConfirmTarget(null)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Accounts"
        subtitle={`${users.length} account${users.length !== 1 ? 's' : ''}`}
        actions={<Button onClick={openAdd}>Add account</Button>}
      />

      {users.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          message="No accounts yet."
          action={<Button onClick={openAdd}>Add account</Button>}
        />
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.email}
                      {u.id === currentUserId && (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ROLE_BADGE[u.role]}>
                        {ROLE_LABELS[u.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {u.assigned_class || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(u)}
                          title="Edit role"
                          className="text-muted-foreground hover:text-foreground transition-colors p-1.5"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmTarget(u)}
                          title="Delete account"
                          disabled={u.id === currentUserId}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1.5 disabled:opacity-30 disabled:pointer-events-none"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {deleteError && (
            <Alert variant="error">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <UserDialog open={dialogOpen} onOpenChange={setDialogOpen} user={editing} />

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(v) => { if (!v) setConfirmTarget(null) }}
        title="Delete account?"
        description={confirmTarget
          ? `This will permanently delete ${confirmTarget.email}. They will immediately lose access.`
          : ''}
        confirmLabel="Delete account"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  )
}
