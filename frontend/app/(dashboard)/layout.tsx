import { verifySession } from '@/lib/supabase/dal'
import { Sidebar } from '@/components/sidebar'
import { MobileHeader } from '@/components/mobile-header'
import { MobileBottomNav } from '@/components/mobile-bottom-nav'
import { SessionManager } from '@/components/session-manager'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await verifySession()

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <SessionManager />
        <MobileHeader />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-16 md:pb-6">
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </div>
  )
}
