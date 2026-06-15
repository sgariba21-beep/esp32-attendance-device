'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

// ── Holidays ─────────────────────────────────────────────────────────────────

export async function createHoliday(data: { start_date: string; end_date: string; label: string; recurring?: boolean }) {
  const { institutionId } = await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const { error } = await supabase.from('holidays').insert({
    start_date: data.start_date,
    end_date: data.end_date,
    label: data.label.trim(),
    recurring: data.recurring ?? false,
    institution_id: institutionId,
  })

  if (error) {
    if (error.code === '23505') return { error: 'A holiday already exists for that date range.' }
    return { error: error.message }
  }

  revalidatePath('/academic')
  return { error: null }
}

export async function deleteHoliday(id: string) {
  await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const { error } = await supabase.from('holidays').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/academic')
  return { error: null }
}

export type AcademicFormData = {
  term: string
  year: string
  start_date: string
  end_date: string
}

export async function createAcademicTerm(data: AcademicFormData) {
  const { institutionId } = await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const { error } = await supabase.from('periods').insert({
    term: data.term,
    year: data.year.trim(),
    status: 'inactive',
    start_date: data.start_date || null,
    end_date: data.end_date || null,
    institution_id: institutionId,
  })

  if (error) {
    if (error.code === '23505') return { error: 'That term and year combination already exists.' }
    return { error: error.message }
  }

  revalidatePath('/academic')
  return { error: null }
}

export async function updateAcademicTerm(id: string, data: AcademicFormData) {
  await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('periods')
    .update({
      term: data.term,
      year: data.year.trim(),
      start_date: data.start_date || null,
      end_date: data.end_date || null,
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'That term and year combination already exists.' }
    return { error: error.message }
  }

  revalidatePath('/academic')
  return { error: null }
}

export async function setActiveTerm(id: string) {
  const { institutionId } = await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  let deactivateQ = supabase.from('periods').update({ status: 'inactive' }).neq('id', id)
  if (institutionId) deactivateQ = deactivateQ.eq('institution_id', institutionId)
  const { error: deactivateError } = await deactivateQ

  if (deactivateError) return { error: deactivateError.message }

  const { error: activateError } = await supabase
    .from('periods')
    .update({ status: 'active' })
    .eq('id', id)

  if (activateError) return { error: activateError.message }

  revalidatePath('/academic')
  return { error: null }
}

export async function deleteAcademicTerm(id: string) {
  await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const { error } = await supabase.from('periods').delete().eq('id', id)

  if (error) {
    if (error.code === '23503') return { error: 'Cannot delete: attendance records are linked to this term.' }
    return { error: error.message }
  }

  revalidatePath('/academic')
  return { error: null }
}
