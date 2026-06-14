'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

export type SettingsFormData = {
  name: string
  type: 'school' | 'office'
  logo_url: string
  label_member: string
  label_members: string
  label_group: string
  label_unit: string
  label_period: string
  skip_weekends: boolean
  timezone: string
  track_students: boolean
  track_staff: boolean
  student_scan_mode: 'present_absent' | 'time_in_out'
  staff_scan_mode: 'present_absent' | 'time_in_out'
}

export async function updateInstitutionSettings(data: SettingsFormData) {
  const { institutionId } = await requireRole('super_admin')
  if (!institutionId) return { error: 'No institution associated with this account.' }

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
      skip_weekends: data.skip_weekends,
      timezone: data.timezone.trim() || 'UTC',
      track_students: data.track_students,
      track_staff: data.track_staff,
      student_scan_mode: data.student_scan_mode,
      staff_scan_mode: data.staff_scan_mode,
    })
    .eq('id', institutionId)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/', 'layout')
  return { error: null }
}
