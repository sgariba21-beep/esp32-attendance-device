'use client'

import { useSyncExternalStore } from 'react'

/**
 * Shared capture of the Chrome/Edge `beforeinstallprompt` event.
 *
 * The event fires once, early in page load. A component that mounts later (e.g.
 * the mobile "More" sheet, which only renders when opened) would miss it. So the
 * listeners live at module scope and attach on first import — `RegisterSw`, which
 * is always mounted in the root layout, calls `ensureInstallListeners()` to
 * guarantee that happens from first paint. Every `InstallPrompt` instance then
 * just subscribes to the cached result.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type InstallState = 'available' | 'installed' | 'none'

let deferredEvent: BeforeInstallPromptEvent | null = null
let installed = false
let attached = false
const subscribers = new Set<() => void>()

function notify() {
  for (const cb of subscribers) cb()
}

export function ensureInstallListeners() {
  if (attached || typeof window === 'undefined') return
  attached = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredEvent = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferredEvent = null
    notify()
  })
}

function subscribe(cb: () => void) {
  ensureInstallListeners()
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

function getSnapshot(): InstallState {
  if (installed) return 'installed'
  return deferredEvent ? 'available' : 'none'
}

/** Fire the native install prompt. Returns the user's choice, or 'unavailable'. */
export async function promptInstall(): Promise<
  'accepted' | 'dismissed' | 'unavailable'
> {
  if (!deferredEvent) return 'unavailable'
  const event = deferredEvent
  await event.prompt()
  const { outcome } = await event.userChoice
  // A prompt can only be used once.
  deferredEvent = null
  notify()
  return outcome
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'none')
}
