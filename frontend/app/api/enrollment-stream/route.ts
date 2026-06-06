import { NextRequest } from 'next/server'
import { createAdminClient, createAuthClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authClient = await createAuthClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user) return new Response('Unauthorized', { status: 401 })

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const supabase = createAdminClient()

      controller.enqueue(encoder.encode(': connected\n\n'))

      const channel = supabase
        .channel('enrollment_jobs_sse')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'enrollment_jobs' },
          (payload) => {
            if (closed) return
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
