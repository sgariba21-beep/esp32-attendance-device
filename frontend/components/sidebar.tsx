'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/lib/supabase/dal'
import type { InstitutionConfig } from '@/lib/types'
import {
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
  Building2 as BuildingList,
} from 'lucide-react'

type NavItem = { href: string; label: string; icon: React.ElementType; roles: UserRole[] }

function buildNavItems(institution: InstitutionConfig, role: UserRole): NavItem[] {
  const items: NavItem[] = [
    { href: '/attendance', label: 'Attendance', icon: CalendarDays, roles: ['super_admin', 'admin', 'teacher', 'staff', 'platform_admin'] },
  ]

  if (institution.track_students) {
    items.push({ href: '/members', label: institution.label_members, icon: Users, roles: ['super_admin', 'admin', 'teacher', 'staff', 'platform_admin'] })
  }

  if (institution.track_staff || role === 'platform_admin') {
    items.push({ href: '/staff', label: institution.label_staff_plural, icon: UserCog, roles: ['super_admin', 'admin', 'teacher', 'staff', 'platform_admin'] })
  }

  items.push(
    { href: '/devices',     label: 'Devices',     icon: Cpu,           roles: ['super_admin', 'platform_admin']         },
    { href: '/academic',    label: 'Academic',    icon: BookOpen,      roles: ['super_admin', 'admin', 'platform_admin'] },
    { href: '/enrollment',  label: 'Enrollment',  icon: ClipboardList, roles: ['super_admin', 'platform_admin']          },
  )

  if (institution.type !== 'office') {
    items.push({ href: '/promotion', label: 'Promotion', icon: ArrowUpCircle, roles: ['super_admin', 'admin', 'platform_admin'] })
  }

  items.push(
    { href: '/users',        label: 'Accounts',           icon: ShieldCheck, roles: ['super_admin', 'platform_admin'] },
    { href: '/settings',     label: 'Settings',           icon: Settings2,   roles: ['super_admin', 'platform_admin'] },
    { href: '/institutions', label: 'Institutions',       icon: BuildingList, roles: ['platform_admin'] },
    { href: '/onboarding',   label: 'Create institution', icon: Plus,         roles: ['platform_admin'] },
  )

  return items
}

export function Sidebar({ role, institution }: { role: UserRole; institution: InstitutionConfig }) {
  const pathname = usePathname()
  const navItems = buildNavItems(institution, role)
  const visible = navItems.filter((item) => (item.roles as UserRole[]).includes(role))

  async function handleSignOut() {
    sessionStorage.removeItem('app_session_active')
    await fetch('/api/signout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <aside className="hidden md:flex w-60 flex-col bg-sidebar shrink-0">
      {/* Logo / brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="h-10 w-10 shrink-0 rounded-full overflow-hidden ring-2 ring-sidebar-border bg-muted flex items-center justify-center">
          {institution.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={institution.logo_url} alt={institution.name} className="h-full w-full object-cover" />
          ) : (
            <Building2 className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-sidebar-foreground leading-tight truncate">{institution.name}</p>
          <p className="text-xs text-sidebar-foreground/55 leading-tight">Attendance System</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {visible.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md border-l-2 pr-3 pl-[10px] py-2.5 text-sm font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-sidebar-primary text-sidebar-primary-foreground border-sidebar-primary-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground border-transparent'
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {/* Sign out */}
      <div className="px-3 py-4 border-t border-sidebar-border">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
