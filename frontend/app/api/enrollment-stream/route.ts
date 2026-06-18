import { NextRequest } from 'next/server'
import { createAdminClient, createAuthClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authClient = await createAuthClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user) return new Response('Unauthorized', { status: 401 })

  // H2: resolve the caller's institution so we never stream another tenant's
  // enrollment rows. platform_admin is cross-tenant by design and sees all.
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

      // Server-side row filter: a non-platform listener only receives changes
      // for their own institution. Defence-in-depth check below as well.
      const changeOpts: { event: '*'; schema: string; table: string; filter?: string } = {
        event: '*',
        schema: 'public',
        table: 'enrollment_jobs',
      }
      if (!isPlatform && institutionId) changeOpts.filter = `institution_id=eq.${institutionId}`

      const channel = supabase
        .channel(`enrollment_jobs_sse_${user.id}_${Date.now()}`)
        .on(
          'postgres_changes',
          changeOpts,
          (payload) => {
            if (closed) return
            // Defence in depth: never forward a row outside the caller's tenant.
            if (!isPlatform) {
              const rec = (payload.new ?? payload.old) as { institution_id?: string } | null
              if (!rec || rec.institution_id !== institutionId) return
            }
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
            } catch {}
          }
        )
        .subscribe()

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
