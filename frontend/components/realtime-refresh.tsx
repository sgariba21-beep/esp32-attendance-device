'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Drop this anywhere in a server-component page to get automatic live updates.
 * It opens one SSE connection, listens for table-change events, and calls
 * router.refresh() so Next.js re-fetches the page's server data.
 *
 * The enrollment page manages its own SSE stream separately — don't add this there.
 */
export function RealtimeRefresh() {
  const router = useRouter()

  useEffect(() => {
    const es = new EventSource('/api/realtime-stream')

    es.onmessage = () => {
      router.refresh()
    }

    es.onerror = () => {
      // Browser will auto-reconnect; nothing to do
    }

    return () => es.close()
  }, [router])

  return null
}
