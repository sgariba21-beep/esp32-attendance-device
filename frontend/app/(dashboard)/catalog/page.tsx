import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole, getInstitution } from '@/lib/supabase/dal'
import { CatalogView } from './_components/catalog-view'
import type { Product, Service } from './_components/catalog-view'

export default async function CatalogPage() {
  const session = await requireRole('super_admin', 'admin', 'cashier')
  const { institutionId, role } = session
  const institution = await getInstitution(institutionId)

  // Catalog is a shop-only page; guard direct URL access for non-shop tenants.
  // platform_admin bypasses via requireRole's super-role check and can view all.
  if (institution.type !== 'shop' && role !== 'platform_admin') {
    redirect('/unauthorized')
  }

  const supabase = createAdminClient()

  let productsQ = supabase
    .from('products')
    .select('id, institution_id, name, price, stock, active, created_at')
    .order('name')

  let servicesQ = supabase
    .from('services')
    .select('id, institution_id, name, price, active, created_at')
    .order('name')

  if (institutionId) {
    productsQ = productsQ.eq('institution_id', institutionId)
    servicesQ = servicesQ.eq('institution_id', institutionId)
  }

  const [productsRes, servicesRes] = await Promise.all([productsQ, servicesQ])

  return (
    <CatalogView
      products={(productsRes.data ?? []) as unknown as Product[]}
      services={(servicesRes.data ?? []) as unknown as Service[]}
      role={role}
      currency={institution.currency}
      sellProducts={institution.sell_products}
      sellServices={institution.sell_services}
    />
  )
}
