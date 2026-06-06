'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/supabase/dal'

export type AcademicFormData = {
  term: string
  year: string
}

export async function createAcademicTerm(data: AcademicFormData) {
  await verifySession()
  const supabase = createAdminClient()

  const { error } = await supabase.from('academic').insert({
    term: data.term,
    year: data.year.trim(),
    status: 'inactive',
  })

  if (error) {
    if (error.code === '23505') return { error: 'That term and year combination already exists.' }
    return { error: error.message }
  }

  revalidatePath('/academic')
  return { error: null }
}

export async function updateAcademicTerm(id: string, data: AcademicFormData) {
  await verifySession()
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('academic')
    .update({ term: data.term, year: data.year.trim() })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'That term and year combination already exists.' }
    return { error: error.message }
  }

  revalidatePath('/academic')
  return { error: null }
}

export async function setActiveTerm(id: string) {
  await verifySession()
  const supabase = createAdminClient()

  // Deactivate all terms first, then activate the selected one
  const { error: deactivateError } = await supabase
    .from('academic')
    .update({ status: 'inactive' })
    .neq('id', id)

  if (deactivateError) return { error: deactivateError.message }

  const { error: activateError } = await supabase
    .from('academic')
    .update({ status: 'active' })
    .eq('id', id)

  if (activateError) return { error: activateError.message }

  revalidatePath('/academic')
  return { error: null }
}

export async function deleteAcademicTerm(id: string) {
  await verifySession()
  const supabase = createAdminClient()

  const { error } = await supabase.from('academic').delete().eq('id', id)

  if (error) {
    if (error.code === '23503') return { error: 'Cannot delete: attendance records are linked to this term.' }
    return { error: error.message }
  }

  revalidatePath('/academic')
  return { error: null }
}
