import type { Metadata } from 'next'
import { verifySession, getInstitution } from '@/lib/supabase/dal'
import { Sidebar } from '@/components/sidebar'
import { MobileHeader } from '@/components/mobile-header'
import { MobileBottomNav } from '@/components/mobile-bottom-nav'
import { SessionManager } from '@/components/session-manager'

// Browser tab title reflects context: the institution's name for institution
// accounts, or a neutral system name for cross-tenant platform admins.
// verifySession + getInstitution are cache()-wrapped, so this shares the same
// DB lookup as the layout render below.
export async function generateMetadata(): Promise<Metadata> {
  const { institutionId } = await verifySession()
  if (!institutionId) return { title: 'Attendance System' }
  const institution = await getInstitution(institutionId)
  return { title: `${institution.name} — Attendance` }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { role, institutionId } = await verifySession()
  const institution = await getInstitution(institutionId)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={role} institution={institution} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <SessionManager />
        <MobileHeader institution={institution} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-16 md:pb-6">
          {children}
        </main>
        <MobileBottomNav role={role} institution={institution} />
      </div>
    </div>
  )
}
