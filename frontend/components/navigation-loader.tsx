'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export function NavigationLoader() {
  const pathname = usePathname()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const anchor = (e.target as Element).closest('a')
      if (!anchor) return
      try {
        const dest = new URL(anchor.href, location.href)
        if (dest.origin !== location.origin) return
        if (anchor.target === '_blank') return
        // Same path — no navigation will happen
        if (dest.pathname === location.pathname && dest.search === location.search) return
        setLoading(true)
      } catch {
        // ignore malformed hrefs
      }
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [])

  // Navigation complete when pathname changes
  useEffect(() => {
    setLoading(false)
  }, [pathname])

  if (!loading) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 right-0 z-[200] h-0.5 overflow-hidden bg-primary/20"
    >
      <div
        className="h-full w-2/5 rounded-full bg-primary"
        style={{ animation: 'nav-loader 1.1s ease-in-out infinite' }}
      />
    </div>
  )
}
