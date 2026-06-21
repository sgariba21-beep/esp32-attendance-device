'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

export type OnboardingFormData = {
  institution_name: string
  institution_type: 'school' | 'office' | 'shop'
  track_students: boolean
  track_staff: boolean
  student_scan_mode: 'present_absent' | 'time_in_out'
  staff_scan_mode: 'present_absent' | 'time_in_out'
  admin_email: string
  admin_password: string
  admin_name: string
}

export async function createInstitutionWithAdmin(data: OnboardingFormData) {
  await requireRole('platform_admin')

  // L2: match the platform-wide minimum password length.
  if (data.admin_password.length < 8) {
    return { error: 'Password must be at least 8 characters.', institutionId: null }
  }

  const supabase = createAdminClient()

  const { data: institution, error: instError } = await supabase
    .from('institutions')
    .insert({
      name: data.institution_name.trim(),
      type: data.institution_type,
      label_member:       data.institution_type === 'office' ? 'Employee'  : data.institution_type === 'shop' ? 'Stylist'  : 'Student',
      label_members:      data.institution_type === 'office' ? 'Employees' : data.institution_type === 'shop' ? 'Stylists' : 'Students',
      label_group:        data.institution_type === 'office' ? 'Department': data.institution_type === 'shop' ? 'Team'     : 'Form',
      label_unit:         data.institution_type === 'office' ? 'Branch'    : data.institution_type === 'shop' ? 'Station'  : 'Class',
      label_period:       data.institution_type === 'office' ? 'Quarter'   : data.institution_type === 'shop' ? 'Period'   : 'Term',
      label_staff:        data.institution_type === 'office' ? 'Staff'     : data.institution_type === 'shop' ? 'Stylist'  : 'Teacher',
      label_staff_plural: data.institution_type === 'office' ? 'Staff'     : data.institution_type === 'shop' ? 'Stylists' : 'Teachers',
      skip_weekends: true,
      timezone: 'UTC',
      track_students:    data.track_students,
      track_staff:       data.track_staff,
      student_scan_mode: data.student_scan_mode,
      staff_scan_mode:   data.staff_scan_mode,
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
