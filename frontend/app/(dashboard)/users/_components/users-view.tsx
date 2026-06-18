'use client'

import { useState, useMemo } from 'react'
import { ShieldCheck, Pencil, Trash2, KeyRound } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
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
  institution_id: string | null
  institution_name: string | null
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

type DeviceOption = { id: string; group_name: string; unit_name: string; institution_id?: string | null }

type Props = {
  users: UserRow[]
  currentUserId: string
  devices: DeviceOption[]
  labelUnit: string
  labelStaff: string
  institutionType: 'school' | 'office'
  currentUserRole: UserRole
  institutions: { id: string; name: string }[]
}

export function UsersView({ users, currentUserId, devices, labelUnit, labelStaff, institutionType, currentUserRole, institutions }: Props) {
  const isPlatformAdmin = currentUserRole === 'platform_admin'
  const [dialogOpen, setDialogOpen]       = useState(false)
  const [editing, setEditing]             = useState<UserRow | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<UserRow | null>(null)
  const [deleting, setDeleting]           = useState(false)
  const [deleteError, setDeleteError]     = useState<string | null>(null)

  const [pwDialogOpen, setPwDialogOpen] = useState(false)
  const [pwTarget, setPwTarget]         = useState<UserRow | null>(null)

  const [query, setQuery]         = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((u) => {
      if (q && !u.email.toLowerCase().includes(q)) return false
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      return true
    })
  }, [users, query, roleFilter])

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
        subtitle={
          filtered.length === users.length
            ? `${users.length} account${users.length !== 1 ? 's' : ''}`
            : `${filtered.length} of ${users.length} account${users.length !== 1 ? 's' : ''}`
        }
        actions={currentUserRole !== 'admin' ? <Button onClick={openAdd}>Add account</Button> : undefined}
      />

      <div className="flex gap-2">
        <Input
          placeholder="Search by email..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v ?? 'all')}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="platform_admin">Platform Admin</SelectItem>
            <SelectItem value="super_admin">Super Admin</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="teacher">{labelStaff}</SelectItem>
            <SelectItem value="staff">Staff</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          message="No accounts yet."
          action={<Button onClick={openAdd}>Add account</Button>}
        />
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border border-border shadow-xs overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  {isPlatformAdmin && <TableHead>Institution</TableHead>}
                  <TableHead>{labelUnit}</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isPlatformAdmin ? 5 : 4} className="text-center text-muted-foreground py-8">
                      No accounts match your filters.
                    </TableCell>
                  </TableRow>
                ) : filtered.map((u) => (
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
                    {isPlatformAdmin && (
                      <TableCell className="text-muted-foreground text-sm">
                        {u.institution_name ?? (u.role === 'platform_admin' ? 'Platform' : '—')}
                      </TableCell>
                    )}
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
        institutions={institutions}
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
