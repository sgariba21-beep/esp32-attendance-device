'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

export type OnboardingFormData = {
  // Institution
  institution_name: string
  institution_type: 'school' | 'office'
  // First super_admin account
  admin_email: string
  admin_password: string
  admin_name: string
}

export async function createInstitutionWithAdmin(data: OnboardingFormData) {
  await requireRole('platform_admin')
  const supabase = createAdminClient()

  // 1. Create institution row
  const { data: institution, error: instError } = await supabase
    .from('institutions')
    .insert({
      name: data.institution_name.trim(),
      type: data.institution_type,
      label_member: data.institution_type === 'office' ? 'Employee' : 'Student',
      label_members: data.institution_type === 'office' ? 'Employees' : 'Students',
      label_group: data.institution_type === 'office' ? 'Department' : 'Form',
      label_unit: data.institution_type === 'office' ? 'Team' : 'Class',
      label_period: data.institution_type === 'office' ? 'Quarter' : 'Term',
      skip_weekends: true,
      timezone: 'UTC',
    })
    .select('id')
    .single()

  if (instError) {
    if (instError.code === '23505') return { error: 'An institution with that name already exists.' }
    return { error: instError.message }
  }

  const institutionId = institution.id

  // 2. Create auth user for super_admin
  const { data: newUser, error: authError } = await supabase.auth.admin.createUser({
    email: data.admin_email.trim().toLowerCase(),
    password: data.admin_password,
    email_confirm: true,
    user_metadata: { full_name: data.admin_name.trim() },
  })

  if (authError) {
    // Roll back institution if user creation fails
    await supabase.from('institutions').delete().eq('id', institutionId)
    return { error: authError.message }
  }

  // 3. Create profile linking user to institution
  const { error: profileError } = await supabase.from('profiles').insert({
    id: newUser.user.id,
    role: 'super_admin',
    institution_id: institutionId,
  })

  if (profileError) {
    // Roll back both
    await supabase.auth.admin.deleteUser(newUser.user.id)
    await supabase.from('institutions').delete().eq('id', institutionId)
    return { error: profileError.message }
  }

  revalidatePath('/onboarding')
  return { error: null, institutionId }
}
