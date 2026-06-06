'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
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
} from 'lucide-react'

const navItems = [
  { href: '/attendance',  label: 'Attendance',   icon: CalendarDays  },
  { href: '/students',    label: 'Students',     icon: Users         },
  { href: '/devices',     label: 'Devices',      icon: Cpu           },
  { href: '/academic',    label: 'Academic',     icon: BookOpen      },
  { href: '/enrollment',  label: 'Enrollment',   icon: ClipboardList },
  { href: '/promotion',   label: 'Promotion',    icon: ArrowUpCircle },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-56 flex flex-col border-r bg-background shrink-0">
      <div className="px-5 py-5 border-b">
        <span className="font-semibold text-sm tracking-wide">OLAG Attendance</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="px-3 py-4 border-t">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
