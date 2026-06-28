'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

type SaleItem = {
  productId: string | null
  serviceId: string | null
  itemName: string
  unitPrice: number
  quantity: number
}

type CreateSaleInput = {
  clientId: string
  staffId: string | null
  note: string
  items: SaleItem[]
}

export async function createSale(input: CreateSaleInput) {
  const session = await requireRole('super_admin', 'admin', 'cashier')
  const { institutionId, role } = session

  if (input.items.length === 0) return { error: 'A sale must have at least one item.', id: null }

  const supabase = createAdminClient()

  // Verify client ownership inline (like logVisit).
  const { data: client } = await supabase
    .from('clients')
    .select('institution_id, active')
    .eq('id', input.clientId)
    .single()

  if (!client) return { error: 'Client not found.', id: null }
  if (role !== 'platform_admin' && (!institutionId || client.institution_id !== institutionId)) {
    return { error: 'Client not found.', id: null }
  }
  if (!client.active) return { error: 'Cannot create a sale for an archived client.', id: null }

  const effectiveInstitutionId = role === 'platform_admin' ? client.institution_id : institutionId!

  // Verify catalog items belong to this institution and are active.
  const productIds = input.items.map(i => i.productId).filter(Boolean) as string[]
  const serviceIds = input.items.map(i => i.serviceId).filter(Boolean) as string[]

  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('id, institution_id, active')
      .in('id', productIds)

    for (const pid of productIds) {
      const p = (products ?? []).find((r) => r.id === pid)
      if (!p || p.institution_id !== effectiveInstitutionId || !p.active) {
        return { error: 'One or more products are not available.', id: null }
      }
    }
  }

  if (serviceIds.length > 0) {
    const { data: services } = await supabase
      .from('services')
      .select('id, institution_id, active')
      .in('id', serviceIds)

    for (const sid of serviceIds) {
      const s = (services ?? []).find((r) => r.id === sid)
      if (!s || s.institution_id !== effectiveInstitutionId || !s.active) {
        return { error: 'One or more services are not available.', id: null }
      }
    }
  }

  // Verify staff member belongs to this institution (if provided).
  if (input.staffId) {
    const { data: member } = await supabase
      .from('members')
      .select('institution_id')
      .eq('id', input.staffId)
      .single()

    if (!member || member.institution_id !== effectiveInstitutionId) {
      return { error: 'Staff member not found.', id: null }
    }
  }

  // Fetch institution timezone for the attendance date computation in the RPC.
  const { data: inst } = await supabase
    .from('institutions')
    .select('timezone')
    .eq('id', effectiveInstitutionId)
    .single()

  const tz = (inst?.timezone as string | null) ?? 'Africa/Accra'

  // Call the atomic RPC — does all four writes in one Postgres transaction.
  const { data: txId, error } = await supabase.rpc('create_sale', {
    p_institution_id: effectiveInstitutionId,
    p_client_id:      input.clientId,
    p_staff_id:       input.staffId ?? null,
    p_note:           input.note.trim() || null,
    p_items: input.items.map((i) => ({
      product_id: i.productId ?? null,
      service_id: i.serviceId ?? null,
      item_name:  i.itemName,
      unit_price: i.unitPrice,
      quantity:   i.quantity,
    })),
    p_tz: tz,
  })

  if (error) return { error: error.message, id: null }

  // T23: detect products that went below zero stock after this sale.
  // The sale is already recorded (create_sale is atomic); this is non-blocking
  // — we surface warnings in the UI but do not roll back.
  const soldProductIds = input.items
    .filter((i) => i.productId)
    .map((i) => i.productId as string)

  const warnings: string[] = []

  if (soldProductIds.length > 0) {
    const { data: lowStock } = await supabase
      .from('products')
      .select('name, stock_quantity')
      .in('id', soldProductIds)
      .lt('stock_quantity', 0)

    for (const p of lowStock ?? []) {
      warnings.push(
        `"${p.name}" is now at ${p.stock_quantity} units — stock is negative. Restock when possible.`
      )
    }
  }

  revalidatePath('/sales')
  revalidatePath('/clients')
  return { error: null, id: txId as string, warnings }
}
