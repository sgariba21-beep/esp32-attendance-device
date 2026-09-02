'use client'

import { useEffect } from 'react'
import { ensureInstallListeners } from '@/components/pwa/use-install-prompt'

/**
 * Registers the minimal service worker (`/sw.js`) once, on the client, after
 * load, and makes sure the shared `beforeinstallprompt` listeners are attached
 * from first paint. Renders nothing.
 *
 * The worker's only job is to satisfy Chrome/Edge installability so the in-app
 * "Install app" button (see install-prompt.tsx) can appear — it does no caching.
 */
export function RegisterSw() {
  useEffect(() => {
    // Attach the install-prompt capture as early as possible — this component is
    // always mounted, unlike the individual InstallPrompt instances.
    ensureInstallListeners()

    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    // Only meaningful on a secure origin (https / localhost).
    if (!window.isSecureContext) return

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch((err) => {
          console.warn('Service worker registration failed:', err)
        })
    }

    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register, { once: true })
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}
