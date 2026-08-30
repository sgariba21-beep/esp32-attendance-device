'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { brandColumns } from '@/lib/theme'
import { attendanceConfigColumns, type SettingsFormData } from './columns'

export type { SettingsFormData } from './columns'

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
      label_staff: data.label_staff.trim() || 'Staff',
      label_staff_plural: data.label_staff_plural.trim() || 'Staff',
      timezone: data.timezone.trim() || 'UTC',
      member_name_display: data.member_name_display,
      currency: data.currency.trim().toUpperCase() || 'GHS',
      track_students: data.track_students,
      track_staff: data.track_staff,
      student_scan_mode: data.student_scan_mode,
      staff_scan_mode: data.staff_scan_mode,
      sell_products: data.sell_products,
      sell_services: data.sell_services,
      loyalty_enabled: data.loyalty_enabled,
      ...attendanceConfigColumns(data),
      ...brandColumns(data),
    })
    .eq('id', institutionId)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/', 'layout')
  return { error: null }
}
