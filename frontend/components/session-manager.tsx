'use client'

import { useEffect, useRef } from 'react'

const INACTIVITY_MS = 10 * 60 * 1000 // 10 minutes
const SESSION_KEY = 'app_session_active'
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const

// Server-side sign-out then a hard navigation so the proxy re-evaluates with the
// cleared auth cookies. Browser-side signOut can't reach a local Supabase
// (127.0.0.1) from another device, so auth always goes through the API route.
async function signOutAndRedirect() {
  try {
    await fetch('/api/signout', { method: 'POST' })
  } finally {
    window.location.href = '/login'
  }
}

export function SessionManager() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // ── If arriving from login, the URL carries ?session_init=1 ──────────────────
    // sessionStorage is not guaranteed to survive a full-page navigation on all
    // mobile browsers, so the login page passes this param and we set the flag here.
    const params = new URLSearchParams(window.location.search)
    if (params.get('session_init') === '1') {
      sessionStorage.setItem(SESSION_KEY, '1')
      const clean = window.location.pathname + window.location.hash
      window.history.replaceState(null, '', clean)
    }

    // ── Guard: sign out if this is a fresh browser session (no sessionStorage flag) ──
    if (!sessionStorage.getItem(SESSION_KEY)) {
      signOutAndRedirect()
      return
    }

    // ── Inactivity timer ──────────────────────────────────────────────────────────
    function signOutDueToInactivity() {
      sessionStorage.removeItem(SESSION_KEY)
      signOutAndRedirect()
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
  }, [])

  return null
}
