'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/theme-toggle'
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
  Package,
  ShoppingCart,
  Gift,
  BarChart3,
  Building2 as BuildingList,
} from 'lucide-react'

type NavGroup = 'records' | 'retail' | 'manage' | 'platform'
type NavItem = { href: string; label: string; icon: React.ElementType; roles: UserRole[]; group: NavGroup }

const GROUP_LABELS: Record<NavGroup, string> = {
  records: 'Records',
  retail: 'Shop',
  manage: 'Manage',
  platform: 'Platform',
}

const ROLE_LABELS: Record<UserRole, string> = {
  platform_admin: 'Platform admin',
  super_admin: 'Super admin',
  admin: 'Admin',
  teacher: 'Teacher',
  staff: 'Staff',
  cashier: 'Cashier',
}

function buildNavItems(institution: InstitutionConfig, role: UserRole): NavItem[] {
  const items: NavItem[] = [
    { href: '/attendance', label: 'Attendance', icon: CalendarDays, group: 'records', roles: ['super_admin', 'admin', 'teacher', 'staff', 'platform_admin', 'cashier'] },
  ]

  if (institution.track_students) {
    items.push({ href: '/members', label: institution.label_members, icon: Users, group: 'records', roles: ['super_admin', 'admin', 'teacher', 'staff', 'platform_admin'] })
  }

  if (institution.track_staff || role === 'platform_admin') {
    items.push({ href: '/staff', label: institution.label_staff_plural, icon: UserCog, group: 'records', roles: ['super_admin', 'admin', 'teacher', 'staff', 'platform_admin', 'cashier'] })
  }

  // Retail nav — shop-type tenants only.
  if (institution.type === 'shop') {
    items.push(
      { href: '/clients', label: 'Clients',  icon: Users,         group: 'retail', roles: ['super_admin', 'admin', 'cashier', 'platform_admin'] },
      { href: '/sales',   label: 'Sales',    icon: ShoppingCart,  group: 'retail', roles: ['super_admin', 'admin', 'cashier', 'platform_admin'] },
      { href: '/catalog', label: 'Catalog',  icon: Package,       group: 'retail', roles: ['super_admin', 'admin', 'cashier', 'platform_admin'] },
      { href: '/rewards', label: 'Loyalty',  icon: Gift,          group: 'retail', roles: ['super_admin', 'admin', 'platform_admin'] },
      { href: '/reports', label: 'Reports',  icon: BarChart3,     group: 'retail', roles: ['super_admin', 'admin', 'platform_admin'] },
    )
  }

  items.push(
    { href: '/devices',    label: 'Devices',    icon: Cpu,           group: 'manage', roles: ['super_admin', 'platform_admin'] },
    { href: '/enrollment', label: 'Enrollment', icon: ClipboardList, group: 'manage', roles: ['super_admin', 'platform_admin'] },
    // Periods & holidays: schools get 'Academic', offices get 'Periods & Holidays',
    // shops get 'Closed Days' (holidays only; feeds mark-absent for stylists — A-9).
    {
      href: '/academic',
      label: institution.type === 'office' ? 'Periods & Holidays' : institution.type === 'shop' ? 'Closed Days' : 'Academic',
      icon: BookOpen,
      group: 'manage',
      roles: ['super_admin', 'admin', 'platform_admin'],
    },
  )

  // Promotion is a school-only concept (advancing year groups).
  if (institution.type === 'school') {
    items.push(
      { href: '/promotion', label: 'Promotion', icon: ArrowUpCircle, group: 'manage', roles: ['super_admin', 'admin', 'platform_admin'] },
    )
  }

  items.push(
    { href: '/users',        label: 'Accounts',           icon: ShieldCheck,  group: 'manage',   roles: ['super_admin', 'admin', 'platform_admin'] },
    { href: '/settings',     label: 'Settings',           icon: Settings2,    group: 'manage',   roles: ['super_admin', 'platform_admin'] },
    { href: '/institutions', label: 'Institutions',       icon: BuildingList, group: 'platform', roles: ['platform_admin'] },
    { href: '/onboarding',   label: 'Create institution', icon: Plus,         group: 'platform', roles: ['platform_admin'] },
  )

  return items
}

const GROUP_ORDER: NavGroup[] = ['records', 'retail', 'manage', 'platform']

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
    <aside className="hidden md:flex w-64 flex-col bg-sidebar border-r border-sidebar-border shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 h-16 shrink-0">
        <div className="h-9 w-9 shrink-0 rounded-lg overflow-hidden bg-muted ring-1 ring-sidebar-border flex items-center justify-center">
          {institution.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={institution.logo_url} alt={institution.name} className="h-full w-full object-cover" />
          ) : (
            <Building2 className="h-[18px] w-[18px] text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight truncate">{institution.name}</p>
          <p className="text-[11px] text-sidebar-foreground/70 leading-tight">Attendance System</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-5">
        <Link
          href="/"
          className={cn(
            'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
            pathname === '/'
              ? 'bg-primary/10 text-primary'
              : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          )}
        >
          <LayoutDashboard className={cn('h-[18px] w-[18px] shrink-0', pathname === '/' ? 'text-primary' : 'text-sidebar-foreground/70')} />
          Overview
        </Link>

        {GROUP_ORDER.map((group) => {
          const groupItems = visible.filter((item) => item.group === group)
          if (groupItems.length === 0) return null
          return (
            <div key={group} className="space-y-0.5">
              <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
                {GROUP_LABELS[group]}
              </p>
              {groupItems.map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    )}
                  >
                    <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-primary' : 'text-sidebar-foreground/70')} />
                    {label}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* Account / footer */}
      <div className="px-3 py-3 border-t border-sidebar-border">
        <div className="flex items-center gap-2.5 px-1.5 py-1.5">
          <div className="h-8 w-8 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
            {ROLE_LABELS[role].charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground leading-tight truncate">{ROLE_LABELS[role]}</p>
            <p className="text-[11px] text-sidebar-foreground/60 leading-tight truncate">
              {role === 'platform_admin' ? 'All institutions' : institution.name}
            </p>
          </div>
          <ThemeToggle />
        </div>
        <button
          onClick={handleSignOut}
          className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="h-[18px] w-[18px] shrink-0 text-sidebar-foreground/70" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
