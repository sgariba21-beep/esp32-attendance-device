import type { MetadataRoute } from 'next'

/**
 * Web app manifest, served at `/manifest.webmanifest`. Makes the dashboard
 * installable to a home screen ("Add to Home Screen" / Chrome "Install").
 *
 * Fetched before login, so it carries platform branding only — never a specific
 * institution's logo/colour (an installed icon can't change per session anyway).
 *
 * Static (no request-time APIs) → statically generated. `proxy.ts` must exclude
 * `/manifest.webmanifest` from the auth redirect or an unauthenticated device
 * can't read it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Attendance System',
    short_name: 'Attendance',
    description: 'Attendance management dashboard for schools, offices, and shops.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f7f7f7',
    theme_color: '#4f46e5',
    categories: ['business', 'productivity', 'education'],
    icons: [
      { src: '/icons/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/icons/icon-192.png', type: 'image/png', sizes: '192x192', purpose: 'any' },
      { src: '/icons/icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', type: 'image/png', sizes: '192x192', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', type: 'image/png', sizes: '512x512', purpose: 'maskable' },
    ],
  }
}
