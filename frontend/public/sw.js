/*
 * Minimal service worker — installability only, NO offline caching.
 *
 * Chrome/Edge only fire `beforeinstallprompt` (the in-app "Install app" button)
 * when a service worker with a fetch handler is registered. This is that, and
 * nothing more: it never caches, so the auth-gated dashboard can't serve a stale
 * page or stale data. The fetch handler is a pure passthrough.
 *
 * Served from /sw.js with `Cache-Control: no-cache` (see next.config.ts) so a
 * new version is picked up on the next visit.
 */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {
  // Intentionally empty: let the network handle every request.
})
