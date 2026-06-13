'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/lib/supabase/dal'
import {
  CalendarDays,
  Users,
  Cpu,
  BookOpen,
  ClipboardList,
  ArrowUpCircle,
  LogOut,
} from 'lucide-react'

const navItems = [
  { href: '/attendance',  label: 'Attendance',  icon: CalendarDays,  roles: ['super_admin', 'admin', 'teacher'] },
  { href: '/students',    label: 'Students',    icon: Users,         roles: ['super_admin', 'admin', 'teacher'] },
  { href: '/devices',     label: 'Devices',     icon: Cpu,           roles: ['super_admin']                    },
  { href: '/academic',    label: 'Academic',    icon: BookOpen,      roles: ['super_admin', 'admin']            },
  { href: '/enrollment',  label: 'Enrollment',  icon: ClipboardList, roles: ['super_admin']                    },
  { href: '/promotion',   label: 'Promotion',   icon: ArrowUpCircle, roles: ['super_admin', 'admin']            },
] satisfies { href: string; label: string; icon: React.ElementType; roles: UserRole[] }[]

export function Sidebar({ role }: { role: UserRole }) {
  const pathname = usePathname()
  const visible = navItems.filter((item) => item.roles.includes(role))

  async function handleSignOut() {
    sessionStorage.removeItem('app_session_active')
    await fetch('/api/signout', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <aside className="hidden md:flex w-60 flex-col bg-sidebar shrink-0">
      {/* Logo / brand */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="h-10 w-10 shrink-0 rounded-full overflow-hidden ring-2 ring-sidebar-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/olag-logo.jpg" alt="OLAG SHS" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-sidebar-foreground leading-tight">OLAG SHS</p>
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
