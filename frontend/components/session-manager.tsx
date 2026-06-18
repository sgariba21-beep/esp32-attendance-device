'use client'

import { useEffect, useRef } from 'react'

const INACTIVITY_MS = 10 * 60 * 1000 // 10 minutes
const SESSION_KEY = 'app_session_active'   // sessionStorage — per tab
const PING_KEY = 'app_session_ping'        // localStorage — cross-tab request
const PONG_KEY = 'app_session_pong'        // localStorage — cross-tab response
const ADOPT_WAIT_MS = 500
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
    const params = new URLSearchParams(window.location.search)
    if (params.get('session_init') === '1') {
      sessionStorage.setItem(SESSION_KEY, '1')
      const clean = window.location.pathname + window.location.hash
      window.history.replaceState(null, '', clean)
    }

    let decided = false

    function startInactivityTimer() {
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
    }

    let stopInactivity: (() => void) | null = null
    function proceed() {
      if (decided) return
      decided = true
      stopInactivity = startInactivityTimer()
    }

    // ── M14: tolerate multiple tabs ────────────────────────────────────────────
    // sessionStorage is per-tab, so a freshly opened tab has no SESSION_KEY even
    // though the user is logged in elsewhere. Before signing out, ask the other
    // open tabs (via a localStorage ping/pong) whether a session is active and
    // adopt it. Only a genuinely fresh browser session (no tab answers) signs out.
    let adoptTimer: ReturnType<typeof setTimeout> | null = null

    function onStorage(e: StorageEvent) {
      if (e.key === PING_KEY) {
        // Another tab is asking. If WE have a live session, vouch for it.
        if (sessionStorage.getItem(SESSION_KEY)) {
          localStorage.setItem(PONG_KEY, String(Date.now()))
        }
      } else if (e.key === PONG_KEY && e.newValue) {
        // Some tab vouched — adopt the session in this tab.
        sessionStorage.setItem(SESSION_KEY, '1')
        if (adoptTimer) clearTimeout(adoptTimer)
        proceed()
      }
    }

    if (sessionStorage.getItem(SESSION_KEY)) {
      proceed()
    } else {
      window.addEventListener('storage', onStorage)
      localStorage.setItem(PING_KEY, String(Date.now()))
      adoptTimer = setTimeout(() => {
        if (!decided && !sessionStorage.getItem(SESSION_KEY)) {
          // No other tab answered → truly fresh session.
          signOutAndRedirect()
        }
      }, ADOPT_WAIT_MS)
    }

    return () => {
      window.removeEventListener('storage', onStorage)
      if (adoptTimer) clearTimeout(adoptTimer)
      if (stopInactivity) stopInactivity()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return null
}
