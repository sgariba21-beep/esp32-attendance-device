import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { ClientsView } from './_components/clients-view'
import type { ClientWithStats } from './_components/clients-view'

export default async function ClientsPage() {
  const session = await requireRole('super_admin', 'admin', 'cashier')
  const { institutionId, role } = session
  const institution = await getInstitution(institutionId)

  if (institution.type !== 'shop' && role !== 'platform_admin') {
    redirect('/unauthorized')
  }

  const supabase = createAdminClient()

  let clientsQ = supabase
    .from('clients')
    .select('id, institution_id, name, phone, area_of_residence, active, created_at')
    .order('name')

  let attendanceQ = supabase
    .from('client_attendance')
    .select('client_id, date')
    .order('date', { ascending: false })

  if (institutionId) {
    clientsQ = clientsQ.eq('institution_id', institutionId)
    attendanceQ = attendanceQ.eq('institution_id', institutionId)
  }

  const [clientsRes, attendanceRes] = await Promise.all([clientsQ, attendanceQ])

  // Build per-client visit stats from the attendance rows.
  type VisitStats = { count: number; lastVisit: string | null; dates: string[] }
  const statsMap = new Map<string, VisitStats>()

  for (const row of attendanceRes.data ?? []) {
    const clientId = row.client_id as string
    const date = row.date as string
    const existing = statsMap.get(clientId)
    if (existing) {
      existing.count++
      existing.dates.push(date)
      if (!existing.lastVisit || date > existing.lastVisit) existing.lastVisit = date
    } else {
      statsMap.set(clientId, { count: 1, lastVisit: date, dates: [date] })
    }
  }

  const clients: ClientWithStats[] = (clientsRes.data ?? []).map((c) => {
    const stats = statsMap.get(c.id as string) ?? { count: 0, lastVisit: null, dates: [] }
    return {
      ...(c as {
        id: string
        institution_id: string
        name: string
        phone: string
        area_of_residence: string | null
        active: boolean
        created_at: string
      }),
      visitCount: stats.count,
      lastVisit: stats.lastVisit,
      visitDates: stats.dates,
    }
  })

  return (
    <ClientsView clients={clients} role={role} />
  )
}
