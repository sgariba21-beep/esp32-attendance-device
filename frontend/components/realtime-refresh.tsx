'use client'

/**
 * T3f — Polling-based dashboard refresh (replaces the SSE stream).
 *
 * Polls /api/changes every POLL_INTERVAL_MS. On the first response, stores the
 * watermark. On subsequent polls, calls router.refresh() only when last_change_at
 * has advanced — avoiding unnecessary refetches when nothing changed.
 *
 * Rationale vs SSE: Supabase Realtime requires REPLICA IDENTITY FULL on watched
 * tables (high WAL amplification). Polling a single watermark row per institution
 * is far cheaper. The poll interval (12 s) is well within user-perception tolerance
 * for dashboard updates.
 *
 * The enrollment page manages its own live-status stream (enrollment-stream)
 * separately — don't add this component there.
 */
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const POLL_INTERVAL_MS = 12_000

export function RealtimeRefresh() {
  const router = useRouter()
  const lastSeenRef = useRef<string | null>(null)

  useEffect(() => {
    let active = true

    async function poll() {
      if (!active) return
      try {
        const res = await fetch('/api/changes', { cache: 'no-store' })
        if (!res.ok) return
        const { last_change_at } = await res.json() as { last_change_at: string | null }
        if (!last_change_at) return

        if (lastSeenRef.current === null) {
          // First poll: store watermark, do not refresh (page data is already fresh).
          lastSeenRef.current = last_change_at
        } else if (last_change_at > lastSeenRef.current) {
          lastSeenRef.current = last_change_at
          router.refresh()
        }
      } catch {
        // Network blip — next tick will retry
      }
    }

    poll()
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [router])

  return null
}
