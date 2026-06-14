import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createAuthClient, createAdminClient } from './server'

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
    .select('role, assigned_unit')
    .eq('id', user!.id)
    .single()

  const role = (profile?.role ?? 'super_admin') as UserRole
  const assignedUnit = profile?.assigned_unit as string | null ?? null

  return { user: user!, role, assignedUnit }
})

export async function requireRole(...roles: UserRole[]) {
  const session = await verifySession()
  // platform_admin is a super-role that bypasses all page-level role checks
  if (session.role !== 'platform_admin' && !roles.includes(session.role)) {
    redirect('/unauthorized')
  }
  return session
}
