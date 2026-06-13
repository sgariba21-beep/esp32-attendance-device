'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

// ── Holidays ─────────────────────────────────────────────────────────────────

export async function createHoliday(data: { date: string; label: string }) {
  await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const { error } = await supabase.from('holidays').insert({
    date: data.date,
    label: data.label.trim(),
  })

  if (error) {
    if (error.code === '23505') return { error: 'A holiday is already set for that date.' }
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
  await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const { error } = await supabase.from('periods').insert({
    term: data.term,
    year: data.year.trim(),
    status: 'inactive',
    start_date: data.start_date || null,
    end_date: data.end_date || null,
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
  await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  // Deactivate all terms first, then activate the selected one
  const { error: deactivateError } = await supabase
    .from('periods')
    .update({ status: 'inactive' })
    .neq('id', id)

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
