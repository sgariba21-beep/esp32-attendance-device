import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createAuthClient, createAdminClient } from './server'

export type UserRole = 'super_admin' | 'admin' | 'teacher'

export const verifySession = cache(async () => {
  const supabase = await createAuthClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role, assigned_class')
    .eq('id', user!.id)
    .single()

  const role = (profile?.role ?? 'teacher') as UserRole
  const assignedClass = profile?.assigned_class as string | null ?? null

  return { user: user!, role, assignedClass }
})

export async function requireRole(...roles: UserRole[]) {
  const session = await verifySession()
  if (!roles.includes(session.role)) {
    redirect('/unauthorized')
  }
  return session
}
