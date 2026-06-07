'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'

const INACTIVITY_MS = 10 * 60 * 1000 // 10 minutes
const SESSION_KEY = 'app_session_active'
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const

export function SessionManager() {
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // ── Guard: sign out if this is a fresh browser session (no sessionStorage flag) ──
    if (!sessionStorage.getItem(SESSION_KEY)) {
      const supabase = createClient()
      supabase.auth.signOut().then(() => router.replace('/login'))
      return
    }

    // ── Inactivity timer ──────────────────────────────────────────────────────────
    async function signOutDueToInactivity() {
      sessionStorage.removeItem(SESSION_KEY)
      const supabase = createClient()
      await supabase.auth.signOut()
      router.replace('/login')
    }

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(signOutDueToInactivity, INACTIVITY_MS)
    }

    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, resetTimer, { passive: true })
    )
    resetTimer()

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer))
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [router])

  return null
}
