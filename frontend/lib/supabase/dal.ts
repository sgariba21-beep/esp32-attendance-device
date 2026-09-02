import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createAuthClient, createAdminClient } from './server'
import type { InstitutionConfig } from '@/lib/types'
import { DEFAULT_INSTITUTION } from '@/lib/types'

export type UserRole = 'super_admin' | 'admin' | 'teacher' | 'staff' | 'platform_admin' | 'cashier'

export const verifySession = cache(async () => {
  const supabase = await createAuthClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role, assigned_unit, assigned_device_id, institution_id')
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
  const assignedDeviceId = (profile.assigned_device_id as string | null) ?? null
  const institutionId = (profile.institution_id as string | null) ?? null

  // Deactivation gate (the chokepoint): a non-platform user whose institution is
  // not 'active' is bounced to /suspended. getInstitution is cache()-wrapped, so
  // this shares the one institution lookup the layout/pages already do — no extra
  // round-trip. platform_admin is exempt (must reach the dashboard to reactivate).
  // /suspended lives OUTSIDE the (dashboard) group so it never re-enters here.
  if (role !== 'platform_admin' && institutionId) {
    const institution = await getInstitution(institutionId)
    if (institution.status !== 'active') {
      redirect('/suspended')
    }
  }

  return { user: user!, role, assignedUnit, assignedDeviceId, institutionId }
})

export type Session = {
  user: { id: string }
  role: UserRole
  assignedUnit: string | null
  assignedDeviceId: string | null
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

export type DeviceScope =
  | { mode: 'all' }                        // sees the whole institution
  | { mode: 'device'; deviceId: string }   // pinned to one device
  | { mode: 'none' }                        // must be pinned but isn't → sees nothing

/**
 * The single device a session is scoped to, if any.
 *
 * - teacher / staff: ALWAYS device-scoped. An unresolved assignment means
 *   "see nothing" (mode: 'none'), never "see everything".
 * - admin: device binding is OPTIONAL. Bound → scoped to that device (records
 *   and enrolment); unbound → whole institution, unchanged.
 * - everyone else (super_admin, platform_admin, cashier): mode 'all'.
 *
 * Prefers profiles.assigned_device_id (the FK); falls back to matching the
 * legacy assigned_unit string against the institution's devices for profiles
 * that predate the FK backfill.
 */
export const resolveDeviceScope = cache(async (session: Session): Promise<DeviceScope> => {
  const mustPin = session.role === 'teacher' || session.role === 'staff'
  const canPin = mustPin || session.role === 'admin'
  if (!canPin) return { mode: 'all' }

  if (session.assignedDeviceId) return { mode: 'device', deviceId: session.assignedDeviceId }

  if (session.assignedUnit && session.institutionId) {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('devices')
      .select('id, group_name, unit_name')
      .eq('institution_id', session.institutionId)
    const match = (data ?? []).find(
      (d) => `${d.group_name} ${d.unit_name}` === session.assignedUnit,
    )
    if (match) return { mode: 'device', deviceId: match.id }
  }

  return mustPin ? { mode: 'none' } : { mode: 'all' }
})

/**
 * T6 — Tenant scope resolver (closes the fail-open anti-pattern).
 *
 * Non-platform roles are ALWAYS scoped to their own institution — the
 * ?institution= query param is silently ignored for them. If a non-platform
 * user somehow has no institutionId (should never happen after T5 RBAC gates),
 * we hard-fail with a 403 redirect rather than defaulting to cross-tenant null.
 *
 * platform_admin may optionally scope to a specific institution via the param.
 */
export function resolveInstitutionScope(
  session: Session,
  institutionParam?: string | null,
): string | null {
  if (session.role === 'platform_admin') {
    // platform_admin: use the param if provided, otherwise cross-tenant (null = all)
    return institutionParam ?? null
  }
  // Non-platform: institution must be set — fail closed if it isn't
  if (!session.institutionId) {
    redirect('/unauthorized')
    return null // unreachable — redirect() throws
  }
  // Ignore any institution param for non-platform roles (fix T6 fail-open)
  return session.institutionId
}

export const getInstitution = cache(async (institutionId: string | null): Promise<InstitutionConfig> => {
  if (!institutionId) return DEFAULT_INSTITUTION
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('institutions')
    .select('id, name, type, logo_url, label_member, label_members, label_group, label_unit, label_period, label_staff, label_staff_plural, tracked_weekdays, timezone, time_format, track_lateness, expected_start_time, late_grace_minutes, track_early_leaving, expected_end_time, early_leave_grace_minutes, member_name_display, currency, track_students, track_staff, student_scan_mode, staff_scan_mode, sell_products, sell_services, loyalty_enabled, status, theme_primary, theme_preset')
    .eq('id', institutionId)
    .single()
  return (data ?? DEFAULT_INSTITUTION) as InstitutionConfig
})
