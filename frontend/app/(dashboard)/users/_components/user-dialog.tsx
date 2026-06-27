'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { SingleSelect } from '@/components/ui/single-select'
import { createUser, updateUserRole } from '../_actions'
import { indefiniteArticle } from '@/lib/utils'
import type { UserRole } from '@/lib/supabase/dal'
import type { UserRow } from './users-view'

type DeviceOption = { id: string; group_name: string; unit_name: string; institution_id?: string | null }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: UserRow | null
  devices: DeviceOption[]
  labelUnit: string
  labelStaff: string
  institutionType: 'school' | 'office' | 'shop'
  currentUserRole: UserRole
  institutions: { id: string; name: string }[]
  members: { id: string; fullname: string }[]
}

const ROLE_DISPLAY: Record<UserRole, string> = {
  super_admin:    'Super Admin',
  admin:          'Admin',
  teacher:        'Teacher',
  staff:          'Staff',
  platform_admin: 'Platform Admin',
  cashier:        'Cashier',
}

export function UserDialog({ open, onOpenChange, user, devices, labelUnit, labelStaff, institutionType, currentUserRole, institutions, members }: Props) {
  const isPlatformAdmin = currentUserRole === 'platform_admin'
  // The unit-scoped viewer role is called "Teacher" in schools and "Staff" in
  // offices/shops — same access, institution-appropriate wording.
  const unitScopedRole: UserRole = institutionType === 'school' ? 'teacher' : 'staff'

  const roles: { value: UserRole; label: string }[] = [
    { value: 'super_admin', label: 'Super Admin' },
    { value: 'admin',       label: 'Admin' },
    { value: unitScopedRole, label: labelStaff },
  ]
  // Cashier is a shop-only role, below admin in the hierarchy.
  if (institutionType === 'shop') {
    roles.push({ value: 'cashier', label: 'Cashier' })
  }
  // Only a platform admin may grant the platform-admin role.
  if (currentUserRole === 'platform_admin') {
    roles.push({ value: 'platform_admin', label: 'Platform Admin' })
  }

  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [role, setRole]               = useState<UserRole>(unitScopedRole)
  const [assignedUnit, setAssignedUnit] = useState('')
  const [institutionId, setInstitutionId] = useState('')
  const [memberId, setMemberId]       = useState('')
  const [error, setError]             = useState<string | null>(null)
  const [loading, setLoading]         = useState(false)

  // Platform admins must scope a new tenant account to an institution; a new
  // platform_admin account is institution-less.
  const needsInstitution = isPlatformAdmin && !user && role !== 'platform_admin'

  // When editing an account whose role isn't in the offered list (e.g. a legacy
  // 'teacher' inside an office), keep it selectable so it isn't silently changed.
  if (user && !roles.some((r) => r.value === user.role)) {
    roles.push({ value: user.role, label: ROLE_DISPLAY[user.role] })
  }

  const isUnitScoped = role === 'teacher' || role === 'staff'
  // #7: a cashier account may optionally be linked to a staff member (the same
  // person who clocks in). Only meaningful in a shop with staff on record.
  const showMemberLink = institutionType === 'shop' && role === 'cashier' && members.length > 0

  useEffect(() => {
    if (open) {
      setError(null)
      setEmail('')
      setPassword('')
      setRole(user?.role ?? unitScopedRole)
      setAssignedUnit(user?.assigned_unit ?? '')
      setInstitutionId('')
      setMemberId(user?.member_id ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (needsInstitution && !institutionId) { setError('Please select an institution for this account.'); return }
    setLoading(true)
    setError(null)

    const linkedMember = role === 'cashier' ? (memberId || null) : null
    const result = user
      ? await updateUserRole(user.id, role, assignedUnit || null, linkedMember)
      : await createUser({ email, password, role, assigned_unit: assignedUnit || null, institution_id: institutionId || null, member_id: linkedMember })

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
                  placeholder="name@example.com"
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
              {roles.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </NativeSelect>
          </div>

          {needsInstitution && (
            <div className="space-y-2">
              <Label htmlFor="institution_id">Institution</Label>
              <SingleSelect
                id="institution_id"
                options={institutions.map((i) => ({ value: i.id, label: i.name }))}
                value={institutionId}
                onChange={(v) => { setInstitutionId(v); setAssignedUnit('') }}
                placeholder="Select institution…"
                searchPlaceholder="Search institutions…"
              />
            </div>
          )}

          {isUnitScoped && (
            <div className="space-y-2">
              <Label>Assigned {labelUnit.toLowerCase()}</Label>
              <SingleSelect
                options={(needsInstitution ? devices.filter((d) => d.institution_id === institutionId) : devices)
                  .slice()
                  .sort((a, b) => a.group_name.localeCompare(b.group_name, undefined, { numeric: true }) || a.unit_name.localeCompare(b.unit_name))
                  .map((d) => ({ value: `${d.group_name} ${d.unit_name}`, label: `${d.group_name} ${d.unit_name}` }))}
                value={assignedUnit}
                onChange={setAssignedUnit}
                placeholder={`Select ${indefiniteArticle(labelUnit)} ${labelUnit.toLowerCase()}…`}
              />
              <p className="text-xs text-muted-foreground">
                This account only sees attendance records for the assigned {labelUnit.toLowerCase()}.
              </p>
            </div>
          )}

          {showMemberLink && (
            <div className="space-y-2">
              <Label htmlFor="member_id">
                Linked {labelStaff.toLowerCase()}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">(optional)</span>
              </Label>
              <SingleSelect
                id="member_id"
                options={members.map((m) => ({ value: m.id, label: m.fullname }))}
                value={memberId}
                onChange={setMemberId}
                placeholder={`Select ${labelStaff.toLowerCase()}…`}
                searchPlaceholder="Search by name…"
              />
              <p className="text-xs text-muted-foreground">
                Links this login to a {labelStaff.toLowerCase()} record — the same person who clocks in.
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
