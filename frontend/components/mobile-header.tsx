'use client'

import { usePathname } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import type { InstitutionConfig } from '@/lib/types'

function getPageTitle(pathname: string, institution: InstitutionConfig): string {
  if (pathname === '/')                     return 'Overview'
  if (pathname.startsWith('/staff'))        return institution.label_staff_plural
  if (pathname.startsWith('/members'))      return institution.label_members
  if (pathname.startsWith('/attendance'))   return 'Attendance'
  if (pathname.startsWith('/devices'))      return 'Devices'
  if (pathname.startsWith('/academic'))     return institution.type === 'office' ? 'Periods & Holidays' : 'Academic'
  if (pathname.startsWith('/enrollment'))   return 'Enrollment'
  if (pathname.startsWith('/promotion'))    return 'Promotion'
  if (pathname.startsWith('/institutions')) return 'Institutions'
  if (pathname.startsWith('/settings'))     return 'Settings'
  if (pathname.startsWith('/onboarding'))   return 'Create institution'
  if (pathname.startsWith('/users'))        return 'Accounts'
  return 'Dashboard'
}

type Props = { institution: InstitutionConfig }

export function MobileHeader({ institution }: Props) {
  const pathname = usePathname()
  const title = getPageTitle(pathname, institution)

  return (
    <header className="md:hidden flex items-center gap-3 px-4 h-14 bg-background border-b border-border shrink-0">
      <div className="h-8 w-8 shrink-0 rounded-lg overflow-hidden ring-1 ring-border bg-muted flex items-center justify-center">
        {institution.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={institution.logo_url} alt={institution.name} className="h-full w-full object-cover" />
        ) : (
          <Building2 className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <span className="text-sm font-semibold text-foreground flex-1 truncate">{title}</span>
      <ThemeToggle className="text-foreground/70 hover:bg-muted hover:text-foreground" />
    </header>
  )
}
