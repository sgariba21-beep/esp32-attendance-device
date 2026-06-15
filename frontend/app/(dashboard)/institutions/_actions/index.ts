'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import type { SettingsFormData } from '../../settings/_actions'

export async function deleteInstitution(id: string): Promise<{ error: string | null }> {
  await requireRole('platform_admin')
  const supabase = createAdminClient()

  // Collect profile IDs and device IDs BEFORE cascade deletion — both are
  // removed by the cascade and won't be available after the institution row is gone.
  const [{ data: profiles }, { data: devices }] = await Promise.all([
    supabase.from('profiles').select('id').eq('institution_id', id),
    supabase.from('devices').select('id').eq('institution_id', id),
  ])

  // Queue a decommission signal for every physical device that belongs to this
  // institution. Each device will receive { decommissioned: true } on its next
  // /get-enrollment-job poll and wipe its SPIFFS identity, exactly as individual
  // device deletion does. Must happen before the cascade removes the device rows.
  const deviceIds = (devices ?? []).map((d: { id: string }) => d.id)
  if (deviceIds.length > 0) {
    await supabase
      .from('device_resets')
      .upsert(
        deviceIds.map((device_id: string) => ({ device_id })),
        { onConflict: 'device_id' }
      )
  }

  const { error } = await supabase
    .from('institutions')
    .delete()
    .eq('id', id)

  if (error) {
    // Roll back the reset records if the institution delete failed.
    if (deviceIds.length > 0) {
      await supabase.from('device_resets').delete().in('device_id', deviceIds)
    }
    return { error: error.message }
  }

  // Delete Supabase Auth users for all profiles that belonged to this institution.
  // L7: don't swallow per-user failures silently — a failed delete leaves an
  // orphaned auth user (no profile) which, after the C1 fix, simply lands on
  // /unauthorized, but we still surface it so the admin can clean up.
  const failedDeletions: string[] = []
  for (const profile of profiles ?? []) {
    const { error: delErr } = await supabase.auth.admin.deleteUser(profile.id)
    if (delErr) {
      console.error(`deleteInstitution: failed to delete auth user ${profile.id}: ${delErr.message}`)
      failedDeletions.push(profile.id)
    }
  }

  revalidatePath('/institutions')
  if (failedDeletions.length > 0) {
    return { error: `Institution deleted, but ${failedDeletions.length} login account(s) could not be removed and may need manual cleanup.` }
  }
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
