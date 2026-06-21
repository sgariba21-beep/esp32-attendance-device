import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { SalesView } from './_components/sales-view'
import type { Sale } from './_components/sales-view'
import type { SaleClient, SaleCatalogEntry, SaleStaff } from './_components/sale-dialog'

export default async function SalesPage() {
  const session = await requireRole('super_admin', 'admin', 'cashier')
  const { institutionId, role } = session
  const institution = await getInstitution(institutionId)

  if (institution.type !== 'shop' && role !== 'platform_admin') {
    redirect('/unauthorized')
  }

  const supabase = createAdminClient()

  let salesQ = supabase
    .from('transactions')
    .select('id, total, note, created_at, clients(name, phone), members(fullname)')
    .order('created_at', { ascending: false })
    .limit(200)

  let clientsQ = supabase
    .from('clients')
    .select('id, name, phone')
    .eq('active', true)
    .order('name')

  let productsQ = supabase
    .from('products')
    .select('id, name, price')
    .eq('active', true)
    .order('name')

  let servicesQ = supabase
    .from('services')
    .select('id, name, price')
    .eq('active', true)
    .order('name')

  let staffQ = supabase
    .from('members')
    .select('id, fullname')
    .eq('member_type', 'staff')
    .eq('status', 'active')
    .order('fullname')

  if (institutionId) {
    salesQ    = salesQ.eq('institution_id', institutionId)
    clientsQ  = clientsQ.eq('institution_id', institutionId)
    productsQ = productsQ.eq('institution_id', institutionId)
    servicesQ = servicesQ.eq('institution_id', institutionId)
    staffQ    = staffQ.eq('institution_id', institutionId)
  }

  const [salesRes, clientsRes, productsRes, servicesRes, staffRes] = await Promise.all([
    salesQ, clientsQ, productsQ, servicesQ, staffQ,
  ])

  const allCatalog: SaleCatalogEntry[] = [
    ...(servicesRes.data ?? []).map((s) => ({ id: s.id as string, kind: 'service' as const, name: s.name as string, price: Number(s.price) })),
    ...(productsRes.data ?? []).map((p) => ({ id: p.id as string, kind: 'product' as const, name: p.name as string, price: Number(p.price) })),
  ]

  return (
    <SalesView
      sales={(salesRes.data ?? []) as unknown as Sale[]}
      clients={(clientsRes.data ?? []) as unknown as SaleClient[]}
      allCatalog={allCatalog}
      staff={(staffRes.data ?? []) as unknown as SaleStaff[]}
      timezone={institution.timezone}
      role={role}
    />
  )
}
