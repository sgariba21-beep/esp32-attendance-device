'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/lib/supabase/dal'
import type { InstitutionConfig } from '@/lib/types'
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  UserCog,
  Cpu,
  BookOpen,
  ClipboardList,
  ArrowUpCircle,
  ShieldCheck,
  Settings2,
  Plus,
  LogOut,
  MoreHorizontal,
  X,
  Building2 as BuildingList,
} from 'lucide-react'

type NavItem = { href: string; label: string; icon: React.ElementType; roles: UserRole[] }

const ALL_ROLES: UserRole[] = ['super_admin', 'admin', 'teacher', 'staff', 'platform_admin']

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

// Mobile keeps the bottom bar to four tabs: Overview, Attendance, the primary
// roster, and a "More" sheet holding everything else.
function buildPrimaryNav(institution: InstitutionConfig, role: UserRole): NavItem[] {
  const items: NavItem[] = [
    { href: '/', label: 'Overview', icon: LayoutDashboard, roles: ALL_ROLES },
    { href: '/attendance', label: 'Attendance', icon: CalendarDays, roles: ALL_ROLES },
  ]
  if (institution.track_students) {
    items.push({ href: '/members', label: institution.label_members, icon: Users, roles: ALL_ROLES })
  } else if (institution.track_staff || role === 'platform_admin') {
    items.push({ href: '/staff', label: institution.label_staff_plural, icon: UserCog, roles: ALL_ROLES })
  }
  return items
}

function buildMoreNav(institution: InstitutionConfig, role: UserRole): NavItem[] {
  const items: NavItem[] = []
  // The roster not already shown in the primary bar.
  if (institution.track_students && (institution.track_staff || role === 'platform_admin')) {
    items.push({ href: '/staff', label: institution.label_staff_plural, icon: UserCog, roles: ALL_ROLES })
  }
  items.push(
    { href: '/devices', label: 'Devices', icon: Cpu, roles: ['super_admin', 'platform_admin'] },
    { href: '/academic', label: institution.type === 'office' ? 'Periods & Holidays' : 'Academic', icon: BookOpen, roles: ['super_admin', 'admin', 'platform_admin'] },
    { href: '/enrollment', label: 'Enrollment', icon: ClipboardList, roles: ['super_admin', 'platform_admin'] },
  )
  if (institution.type !== 'office') {
    items.push({ href: '/promotion', label: 'Promotion', icon: ArrowUpCircle, roles: ['super_admin', 'admin', 'platform_admin'] })
  }
  items.push(
    { href: '/users',        label: 'Accounts',           icon: ShieldCheck,  roles: ['super_admin', 'admin', 'platform_admin'] },
    { href: '/settings',     label: 'Settings',           icon: Settings2,    roles: ['super_admin', 'platform_admin'] },
    { href: '/institutions', label: 'Institutions',       icon: BuildingList, roles: ['platform_admin'] },
    { href: '/onboarding',   label: 'Create institution', icon: Plus,         roles: ['platform_admin'] },
  )
  return items
}

export function MobileBottomNav({ role, institution }: { role: UserRole; institution: InstitutionConfig }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const primaryNav = buildPrimaryNav(institution, role)
  const moreNav = buildMoreNav(institution, role)

  const visiblePrimary = primaryNav.filter((item) => (item.roles as UserRole[]).includes(role))
  const visibleMore = moreNav.filter((item) => (item.roles as UserRole[]).includes(role))
  const isMoreActive = visibleMore.some((item) => isActive(pathname, item.href))

  async function handleSignOut() {
    setOpen(false)
    sessionStorage.removeItem('app_session_active')
    await fetch('/api/signout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/20 animate-in fade-in-0 duration-150"
        />
      )}

      {/* "More" panel */}
      {open && visibleMore.length > 0 && (
        <div className="md:hidden fixed bottom-16 left-0 right-0 z-50 bg-popover border-t border-border rounded-t-2xl px-3 py-3 space-y-0.5 shadow-lg animate-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between px-2.5 pb-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              More
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {visibleMore.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-md px-2.5 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-accent'
                )}
              >
                <Icon className={cn('h-[18px] w-[18px]', active ? 'text-primary' : 'text-muted-foreground')} />
                {label}
              </Link>
            )
          })}

          <div className="pt-1 border-t border-border mt-1">
            <button
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <LogOut className="h-[18px] w-[18px]" />
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav className="md:hidden flex items-stretch bg-background border-t border-border shrink-0 z-30 h-16">
        {visiblePrimary.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-[22px] w-[22px]" />
              <span>{label}</span>
            </Link>
          )
        })}

        {visibleMore.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="More navigation"
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors',
              isMoreActive || open ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <MoreHorizontal className="h-[22px] w-[22px]" />
            <span>More</span>
          </button>
        )}
      </nav>
    </>
  )
}
