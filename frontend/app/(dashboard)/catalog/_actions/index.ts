'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'

// ─── Products ────────────────────────────────────────────────────────────────

export async function createProduct(data: { name: string; price: number; stock: number }) {
  const session = await requireRole('super_admin', 'admin')
  const { institutionId } = session
  if (!institutionId) return { error: 'No institution context.', id: null }

  const supabase = createAdminClient()
  const { data: row, error } = await supabase
    .from('products')
    .insert({ name: data.name.trim(), price: data.price, stock: data.stock, institution_id: institutionId })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'An active product with that name already exists.', id: null }
    return { error: error.message, id: null }
  }

  revalidatePath('/catalog')
  return { error: null, id: row.id as string }
}

export async function updateProduct(id: string, data: { name: string; price: number; stock: number }) {
  const session = await requireRole('super_admin', 'admin')
  if (!(await ownsRecord('products', id, session))) return { error: 'Not found.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('products')
    .update({ name: data.name.trim(), price: data.price, stock: data.stock, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'An active product with that name already exists.' }
    return { error: error.message }
  }

  revalidatePath('/catalog')
  return { error: null }
}

export async function setProductActive(id: string, active: boolean) {
  const session = await requireRole('super_admin', 'admin')
  if (!(await ownsRecord('products', id, session))) return { error: 'Not found.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('products')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'Another active product with that name already exists. Rename before restoring.' }
    return { error: error.message }
  }

  revalidatePath('/catalog')
  return { error: null }
}

// ─── Services ────────────────────────────────────────────────────────────────

export async function createService(data: { name: string; price: number }) {
  const session = await requireRole('super_admin', 'admin')
  const { institutionId } = session
  if (!institutionId) return { error: 'No institution context.', id: null }

  const supabase = createAdminClient()
  const { data: row, error } = await supabase
    .from('services')
    .insert({ name: data.name.trim(), price: data.price, institution_id: institutionId })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'An active service with that name already exists.', id: null }
    return { error: error.message, id: null }
  }

  revalidatePath('/catalog')
  return { error: null, id: row.id as string }
}

export async function updateService(id: string, data: { name: string; price: number }) {
  const session = await requireRole('super_admin', 'admin')
  if (!(await ownsRecord('services', id, session))) return { error: 'Not found.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('services')
    .update({ name: data.name.trim(), price: data.price, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'An active service with that name already exists.' }
    return { error: error.message }
  }

  revalidatePath('/catalog')
  return { error: null }
}

export async function setServiceActive(id: string, active: boolean) {
  const session = await requireRole('super_admin', 'admin')
  if (!(await ownsRecord('services', id, session))) return { error: 'Not found.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('services')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'Another active service with that name already exists. Rename before restoring.' }
    return { error: error.message }
  }

  revalidatePath('/catalog')
  return { error: null }
}
