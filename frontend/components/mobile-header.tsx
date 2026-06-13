'use client'

import { usePathname } from 'next/navigation'

const PAGE_TITLES: [string, string][] = [
  ['/attendance', 'Attendance'],
  ['/students',   'Students'],
  ['/devices',    'Devices'],
  ['/academic',   'Academic'],
  ['/enrollment', 'Enrollment'],
  ['/promotion',  'Promotion'],
]

export function MobileHeader() {
  const pathname = usePathname()
  const title = PAGE_TITLES.find(([path]) => pathname.startsWith(path))?.[1] ?? 'Dashboard'

  return (
    <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-sidebar border-b border-sidebar-border shrink-0">
      <div className="h-8 w-8 shrink-0 rounded-full overflow-hidden ring-1 ring-sidebar-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/olag-logo.jpg" alt="OLAG SHS" className="h-full w-full object-cover" />
      </div>
      <span className="text-sm font-semibold text-sidebar-foreground">{title}</span>
    </header>
  )
}
