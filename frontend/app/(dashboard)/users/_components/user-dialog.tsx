'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { SingleSelect } from './single-select'
import { createUser, updateUserRole } from '../_actions'
import type { UserRole } from '@/lib/supabase/dal'
import type { UserRow } from './users-view'

type DeviceOption = { id: string; group_name: string; unit_name: string }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: UserRow | null
  devices: DeviceOption[]
}

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'super_admin',   label: 'Super Admin'   },
  { value: 'admin',         label: 'Admin'         },
  { value: 'teacher',       label: 'Teacher'       },
  { value: 'staff',         label: 'Staff'         },
  { value: 'platform_admin', label: 'Platform Admin' },
]

export function UserDialog({ open, onOpenChange, user, devices }: Props) {
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [role, setRole]               = useState<UserRole>('teacher')
  const [assignedUnit, setAssignedUnit] = useState('')
  const [error, setError]             = useState<string | null>(null)
  const [loading, setLoading]         = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      setEmail('')
      setPassword('')
      setRole(user?.role ?? 'teacher')
      setAssignedUnit(user?.assigned_unit ?? '')
    }
  }, [open, user])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const result = user
      ? await updateUserRole(user.id, role, assignedUnit || null)
      : await createUser({ email, password, role, assigned_unit: assignedUnit || null })

    setLoading(false)
    if (result.error) { setError(result.error); return }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{user ? 'Edit account' : 'Add account'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {!user && (
            <>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@school.edu"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </div>
            </>
          )}

          {user && (
            <p className="text-sm text-muted-foreground">
              {user.email}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <NativeSelect
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </NativeSelect>
          </div>

          {role === 'teacher' && (
            <div className="space-y-2">
              <Label>Assigned class</Label>
              <SingleSelect
                options={devices
                  .slice()
                  .sort((a, b) => a.group_name.localeCompare(b.group_name, undefined, { numeric: true }) || a.unit_name.localeCompare(b.unit_name))
                  .map((d) => ({ value: `${d.group_name} ${d.unit_name}`, label: `${d.group_name} ${d.unit_name}` }))}
                value={assignedUnit}
                onChange={setAssignedUnit}
                placeholder="Select a class…"
              />
              <p className="text-xs text-muted-foreground">
                Teachers only see attendance records for this class.
              </p>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : user ? 'Save changes' : 'Add account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
