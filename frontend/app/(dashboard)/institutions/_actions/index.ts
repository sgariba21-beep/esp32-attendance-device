'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import type { SettingsFormData } from '../../settings/_actions'

export async function deleteInstitution(id: string): Promise<{ error: string | null }> {
  await requireRole('platform_admin')
  const supabase = createAdminClient()

  // Collect profile IDs before cascade deletion — auth.users won't be cascade-deleted
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id')
    .eq('institution_id', id)

  const { error } = await supabase
    .from('institutions')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }

  // Delete Supabase Auth users for all profiles that belonged to this institution
  for (const profile of profiles ?? []) {
    await supabase.auth.admin.deleteUser(profile.id)
  }

  revalidatePath('/institutions')
  return { error: null }
}

export async function updateInstitutionSettingsById(
  id: string,
  data: SettingsFormData
): Promise<{ error: string | null }> {
  await requireRole('platform_admin')
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('institutions')
    .update({
      name: data.name.trim(),
      type: data.type,
      logo_url: data.logo_url.trim() || null,
      label_member: data.label_member.trim() || 'Member',
      label_members: data.label_members.trim() || 'Members',
      label_group: data.label_group.trim() || 'Group',
      label_unit: data.label_unit.trim() || 'Unit',
      label_period: data.label_period.trim() || 'Period',
      label_staff: data.label_staff.trim() || 'Staff',
      label_staff_plural: data.label_staff_plural.trim() || 'Staff',
      skip_weekends: data.skip_weekends,
      timezone: data.timezone.trim() || 'UTC',
      track_students: data.track_students,
      track_staff: data.track_staff,
      student_scan_mode: data.student_scan_mode,
      staff_scan_mode: data.staff_scan_mode,
    })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/institutions')
  revalidatePath(`/institutions/${id}`)
  revalidatePath('/', 'layout')
  return { error: null }
}
