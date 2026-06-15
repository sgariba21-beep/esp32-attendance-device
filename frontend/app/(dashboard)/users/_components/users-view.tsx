'use client'

import { useState } from 'react'
import { ShieldCheck, Pencil, Trash2, KeyRound } from 'lucide-react'
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
import { PasswordDialog } from './password-dialog'
import { deleteUser } from '../_actions'
import type { UserRole } from '@/lib/supabase/dal'

const ROLE_RANK: Record<UserRole, number> = {
  platform_admin: 4,
  super_admin: 3,
  admin: 2,
  teacher: 1,
  staff: 1,
}

function canChangePassword(actorRole: UserRole, actorId: string, targetRole: UserRole, targetId: string): boolean {
  if (actorId === targetId) return ['platform_admin', 'super_admin', 'admin'].includes(actorRole)
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole]
}

function canManageUser(actorRole: UserRole, actorId: string, targetRole: UserRole, targetId: string): boolean {
  if (actorId === targetId) return false
  if (actorRole === 'admin') return false
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole]
}

export type UserRow = {
  id: string
  email: string
  created_at: string
  role: UserRole
  assigned_unit: string | null
}

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:   'Super Admin',
  admin:         'Admin',
  teacher:       'Teacher',
  staff:         'Staff',
  platform_admin: 'Platform Admin',
}

const ROLE_BADGE: Record<UserRole, 'default' | 'secondary' | 'outline'> = {
  super_admin:   'default',
  admin:         'secondary',
  teacher:       'outline',
  staff:         'outline',
  platform_admin: 'secondary',
}

type DeviceOption = { id: string; group_name: string; unit_name: string }

type Props = {
  users: UserRow[]
  currentUserId: string
  devices: DeviceOption[]
  labelUnit: string
  labelStaff: string
  institutionType: 'school' | 'office'
  currentUserRole: UserRole
}

export function UsersView({ users, currentUserId, devices, labelUnit, labelStaff, institutionType, currentUserRole }: Props) {
  const [dialogOpen, setDialogOpen]       = useState(false)
  const [editing, setEditing]             = useState<UserRow | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<UserRow | null>(null)
  const [deleting, setDeleting]           = useState(false)
  const [deleteError, setDeleteError]     = useState<string | null>(null)

  const [pwDialogOpen, setPwDialogOpen] = useState(false)
  const [pwTarget, setPwTarget]         = useState<UserRow | null>(null)

  function openAdd() { setEditing(null); setDialogOpen(true) }
  function openEdit(u: UserRow) { setEditing(u); setDialogOpen(true) }
  function openChangePassword(u: UserRow) { setPwTarget(u); setPwDialogOpen(true) }

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
        actions={currentUserRole !== 'admin' ? <Button onClick={openAdd}>Add account</Button> : undefined}
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
                  <TableHead>{labelUnit}</TableHead>
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
                        {u.role === 'teacher' || u.role === 'staff' ? labelStaff : ROLE_LABELS[u.role]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {u.assigned_unit || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canChangePassword(currentUserRole, currentUserId, u.role, u.id) && (
                          <button
                            onClick={() => openChangePassword(u)}
                            title={u.id === currentUserId ? 'Change your password' : 'Change password'}
                            className="text-muted-foreground hover:text-foreground transition-colors p-1.5"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canManageUser(currentUserRole, currentUserId, u.role, u.id) && (
                          <button
                            onClick={() => openEdit(u)}
                            title="Edit role"
                            className="text-muted-foreground hover:text-foreground transition-colors p-1.5"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canManageUser(currentUserRole, currentUserId, u.role, u.id) && (
                          <button
                            onClick={() => setConfirmTarget(u)}
                            title="Delete account"
                            className="text-muted-foreground hover:text-destructive transition-colors p-1.5"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
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

      <UserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        user={editing}
        devices={devices}
        labelUnit={labelUnit}
        labelStaff={labelStaff}
        institutionType={institutionType}
        currentUserRole={currentUserRole}
      />

      <PasswordDialog
        open={pwDialogOpen}
        onOpenChange={setPwDialogOpen}
        userId={pwTarget?.id ?? null}
        userEmail={pwTarget?.email ?? ''}
        isSelf={pwTarget?.id === currentUserId}
      />

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
