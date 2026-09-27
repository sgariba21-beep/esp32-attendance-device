'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import type { InstitutionType } from '@/lib/types'

export type OnboardingFormData = {
  institution_name: string
  institution_type: InstitutionType
  timezone: string
  track_students: boolean
  track_staff: boolean
  student_scan_mode: 'present_absent' | 'time_in_out'
  staff_scan_mode: 'present_absent' | 'time_in_out'
  admin_email: string
  admin_password: string
  admin_name: string
}

type LabelColumns = {
  label_member: string
  label_members: string
  label_group: string
  label_unit: string
  label_period: string
  label_staff: string
  label_staff_plural: string
}

// Starting vocabulary per type; all editable in Settings after creation.
// T18: shops get neutral retail wording (no trade-specific vocabulary).
// Clubs have no periods (label_period is unused) and call their devices'
// locations venues.
const PRESET_LABELS: Record<InstitutionType, LabelColumns> = {
  school: { label_member: 'Student',  label_members: 'Students',  label_group: 'Form',       label_unit: 'Class',    label_period: 'Term',    label_staff: 'Teacher',   label_staff_plural: 'Teachers' },
  office: { label_member: 'Employee', label_members: 'Employees', label_group: 'Department', label_unit: 'Branch',   label_period: 'Quarter', label_staff: 'Staff',     label_staff_plural: 'Staff' },
  shop:   { label_member: 'Staff',    label_members: 'Staff',     label_group: 'Team',       label_unit: 'Location', label_period: 'Period',  label_staff: 'Staff',     label_staff_plural: 'Staff' },
  club:   { label_member: 'Member',   label_members: 'Members',   label_group: 'Group',      label_unit: 'Venue',    label_period: 'Period',  label_staff: 'Organiser', label_staff_plural: 'Organisers' },
}

export async function createInstitutionWithAdmin(data: OnboardingFormData) {
  await requireRole('platform_admin')

  if (data.admin_password.length < 8) {
    return { error: 'Password must be at least 8 characters.', institutionId: null }
  }

  const supabase = createAdminClient()

  const { data: institution, error: instError } = await supabase
    .from('institutions')
    .insert({
      name: data.institution_name.trim(),
      type: data.institution_type,
      ...PRESET_LABELS[data.institution_type],
      // tracked_weekdays / time_format / punctuality all take their column
      // defaults (Mon–Fri, 24h, tracking off) — tuned later in Settings.
      // T17: use the timezone chosen in the form rather than hardcoding UTC.
      timezone: data.timezone || 'Africa/Accra',
      track_students:    data.track_students,
      track_staff:       data.track_staff,
      student_scan_mode: data.student_scan_mode,
      staff_scan_mode:   data.staff_scan_mode,
      // Clubs start without absences: most don't hold members to attendance.
      // The column defaults to true (what every daily-mode tenant gets).
      ...(data.institution_type === 'club' ? { track_absences: false } : {}),
    })
    .select('id')
    .single()

  if (instError) {
    if (instError.code === '23505') return { error: 'An institution with that name already exists.', institutionId: null }
    return { error: instError.message, institutionId: null }
  }

  const institutionId = institution.id

  const { data: newUser, error: authError } = await supabase.auth.admin.createUser({
    email: data.admin_email.trim().toLowerCase(),
    password: data.admin_password,
    email_confirm: true,
    user_metadata: { full_name: data.admin_name.trim() },
  })

  if (authError) {
    await supabase.from('institutions').delete().eq('id', institutionId)
    return { error: authError.message, institutionId: null }
  }

  const { error: profileError } = await supabase.from('profiles').insert({
    id: newUser.user.id,
    role: 'super_admin',
    institution_id: institutionId,
  })

  if (profileError) {
    await supabase.auth.admin.deleteUser(newUser.user.id)
    await supabase.from('institutions').delete().eq('id', institutionId)
    return { error: profileError.message, institutionId: null }
  }

  revalidatePath('/onboarding')
  return { error: null, institutionId }
}
