import { NextRequest } from 'next/server'
import { createAdminClient, createAuthClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WATCHED_TABLES = ['students', 'devices', 'academic', 'attendance'] as const

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

      function emit(table: string) {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ table })}\n\n`))
        } catch {}
      }

      let channel = supabase.channel('dashboard_realtime_sse')

      for (const table of WATCHED_TABLES) {
        channel = channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          () => emit(table)
        )
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
