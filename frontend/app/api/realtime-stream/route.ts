import { NextRequest } from 'next/server'
import { createAdminClient, createAuthClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WATCHED_TABLES = ['members', 'devices', 'periods', 'attendance'] as const

export async function GET(request: NextRequest) {
  const authClient = await createAuthClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  // H2/M10: scope the change feed to the caller's institution so one tenant's
  // writes don't wake (and force a full refetch on) every other tenant's
  // dashboard. platform_admin watches everything (cross-tenant by design).
  const admin0 = createAdminClient()
  const { data: profile } = await admin0
    .from('profiles')
    .select('role, institution_id')
    .eq('id', user.id)
    .single()

  if (!profile?.role) return new Response('Forbidden', { status: 403 })
  const isPlatform = profile.role === 'platform_admin'
  const institutionId = (profile.institution_id as string | null) ?? null
  if (!isPlatform && !institutionId) return new Response('Forbidden', { status: 403 })

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const supabase = createAdminClient()

      controller.enqueue(encoder.encode(': connected\n\n'))

      function emit(table: string) {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ table })}\n\n`))
        } catch {}
      }

      let channel = supabase.channel(`dashboard_realtime_sse_${user.id}_${Date.now()}`)

      for (const table of WATCHED_TABLES) {
        const changeOpts: { event: '*'; schema: string; table: string; filter?: string } = {
          event: '*',
          schema: 'public',
          table,
        }
        if (!isPlatform && institutionId) changeOpts.filter = `institution_id=eq.${institutionId}`
        channel = channel.on('postgres_changes', changeOpts, () => emit(table))
      }

      channel.subscribe()

      const heartbeat = setInterval(() => {
        if (closed) { clearInterval(heartbeat); return }
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 20000)

      request.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(heartbeat)
        supabase.removeChannel(channel)
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
