'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { cn } from '@/lib/utils'
import {
  CalendarDays,
  Users,
  Cpu,
  BookOpen,
  ClipboardList,
  ArrowUpCircle,
  LogOut,
  MoreHorizontal,
  X,
} from 'lucide-react'

const primaryNav = [
  { href: '/attendance', label: 'Attendance', icon: CalendarDays },
  { href: '/students',   label: 'Students',   icon: Users        },
  { href: '/devices',    label: 'Devices',    icon: Cpu          },
  { href: '/academic',   label: 'Academic',   icon: BookOpen     },
]

const moreNav = [
  { href: '/enrollment', label: 'Enrollment', icon: ClipboardList },
  { href: '/promotion',  label: 'Promotion',  icon: ArrowUpCircle },
]

export function MobileBottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const isMoreActive = moreNav.some((item) => pathname.startsWith(item.href))

  async function handleSignOut() {
    setOpen(false)
    sessionStorage.removeItem('app_session_active')
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {/* Backdrop — always rendered, fades in/out */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={cn(
          'md:hidden fixed inset-0 z-40 bg-black/10 supports-backdrop-filter:backdrop-blur-xs transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      />

      {/* "More" panel — always rendered, slides up/down */}
      <div
        aria-hidden={!open}
        className={cn(
          'md:hidden fixed bottom-14 left-0 right-0 z-50 bg-sidebar border-t border-sidebar-border rounded-t-xl px-3 py-3 space-y-0.5',
          'transition-transform duration-200 ease-out',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            More
          </span>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="text-sidebar-foreground/50 hover:text-sidebar-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {moreNav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            tabIndex={open ? undefined : -1}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}

        <div className="pt-1 border-t border-sidebar-border mt-1">
          <button
            onClick={handleSignOut}
            tabIndex={open ? undefined : -1}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>

      {/* Bottom nav bar */}
      <nav className="md:hidden flex items-stretch bg-sidebar border-t border-sidebar-border shrink-0 z-30 h-14">
        {primaryNav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                active
                  ? 'text-sidebar-foreground'
                  : 'text-sidebar-foreground/45 hover:text-sidebar-foreground/75'
              )}
            >
              <Icon className={cn('h-5 w-5', active ? 'text-sidebar-primary' : '')} />
              <span>{label}</span>
            </Link>
          )
        })}

        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="More navigation"
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
            isMoreActive || open
              ? 'text-sidebar-foreground'
              : 'text-sidebar-foreground/45 hover:text-sidebar-foreground/75'
          )}
        >
          <MoreHorizontal className={cn('h-5 w-5', (isMoreActive || open) ? 'text-sidebar-primary' : '')} />
          <span>More</span>
        </button>
      </nav>
    </>
  )
}
