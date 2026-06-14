'use client'

import { usePathname } from 'next/navigation'
import { Building2 } from 'lucide-react'

const PAGE_TITLES: [string, string][] = [
  ['/attendance', 'Attendance'],
  ['/members',    'Members'],
  ['/devices',    'Devices'],
  ['/academic',   'Academic'],
  ['/enrollment', 'Enrollment'],
  ['/promotion',  'Promotion'],
  ['/settings',   'Settings'],
  ['/onboarding', 'Create institution'],
]

type Props = {
  logoUrl: string | null
  name: string
}

export function MobileHeader({ logoUrl, name }: Props) {
  const pathname = usePathname()
  const title = PAGE_TITLES.find(([path]) => pathname.startsWith(path))?.[1] ?? 'Dashboard'

  return (
    <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-sidebar border-b border-sidebar-border shrink-0">
      <div className="h-8 w-8 shrink-0 rounded-full overflow-hidden ring-1 ring-sidebar-border bg-muted flex items-center justify-center">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <Building2 className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <span className="text-sm font-semibold text-sidebar-foreground">{title}</span>
    </header>
  )
}
