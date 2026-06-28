/**
 * T3f — Lightweight change-watermark endpoint.
 *
 * Returns the institution's last_change_at from institution_activity (populated
 * by the T3p triggers on attendance, members, devices, periods). The client polls
 * every 10–15 s and calls router.refresh() only when the watermark advances.
 *
 * platform_admin gets the global max across all institutions (cross-tenant by design).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAuthClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const authClient = await createAuthClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role, institution_id')
    .eq('id', user.id)
    .single()

  if (!profile?.role) return new NextResponse('Forbidden', { status: 403 })

  const isPlatform = profile.role === 'platform_admin'
  const institutionId = (profile.institution_id as string | null) ?? null

  if (!isPlatform && !institutionId) return new NextResponse('Forbidden', { status: 403 })

  let lastChangeAt: string | null = null

  if (isPlatform) {
    // platform_admin: global max across all institutions
    const { data } = await admin
      .from('institution_activity')
      .select('last_change_at')
      .order('last_change_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    lastChangeAt = data?.last_change_at ?? null
  } else {
    const { data } = await admin
      .from('institution_activity')
      .select('last_change_at')
      .eq('institution_id', institutionId!)
      .maybeSingle()
    lastChangeAt = data?.last_change_at ?? null
  }

  return NextResponse.json({ last_change_at: lastChangeAt })
}
