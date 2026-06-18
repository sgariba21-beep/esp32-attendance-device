import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createAuthClient, createAdminClient } from './server'
import type { InstitutionConfig } from '@/lib/types'
import { DEFAULT_INSTITUTION } from '@/lib/types'

export type UserRole = 'super_admin' | 'admin' | 'teacher' | 'staff' | 'platform_admin'

export const verifySession = cache(async () => {
  const supabase = await createAuthClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role, assigned_unit, institution_id')
    .eq('id', user!.id)
    .single()

  // FAIL CLOSED (C1): an authenticated user without a profile row — or with no
  // role — has NO access. Never default to a privileged role. /unauthorized
  // lives outside the (dashboard) group so it does not re-enter verifySession.
  if (!profile || !profile.role) {
    redirect('/unauthorized')
  }

  const role = profile.role as UserRole
  const assignedUnit = (profile.assigned_unit as string | null) ?? null
  const institutionId = (profile.institution_id as string | null) ?? null

  return { user: user!, role, assignedUnit, institutionId }
})

export type Session = {
  user: { id: string }
  role: UserRole
  assignedUnit: string | null
  institutionId: string | null
}

export async function requireRole(...roles: UserRole[]) {
  const session = await verifySession()
  // platform_admin is a super-role that bypasses all page-level role checks
  if (session.role !== 'platform_admin' && !roles.includes(session.role)) {
    redirect('/unauthorized')
  }
  return session
}

export const getInstitution = cache(async (institutionId: string | null): Promise<InstitutionConfig> => {
  if (!institutionId) return DEFAULT_INSTITUTION
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('institutions')
    .select('id, name, type, logo_url, label_member, label_members, label_group, label_unit, label_period, label_staff, label_staff_plural, skip_weekends, timezone, track_students, track_staff, student_scan_mode, staff_scan_mode, theme_primary, theme_preset')
    .eq('id', institutionId)
    .single()
  return (data ?? DEFAULT_INSTITUTION) as InstitutionConfig
})
