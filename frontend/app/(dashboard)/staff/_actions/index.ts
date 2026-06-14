'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

export type StaffFormData = {
  sid: string
  fullname: string
  device_id: string
  fin1: number
  fin2: number
}

export async function createStaffMember(data: StaffFormData) {
  const { institutionId } = await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const device = await supabase
    .from('devices')
    .select('group_name, institution_id')
    .eq('id', data.device_id)
    .single()

  if (!device.data) return { error: 'Device not found.', id: null }

  const { data: newMember, error } = await supabase
    .from('members')
    .insert({
      sid: data.sid.trim(),
      fullname: data.fullname.trim(),
      device_id: data.device_id,
      group_name: device.data.group_name,
      institution_id: institutionId ?? device.data.institution_id,
      member_type: 'staff',
      fin1: 0,
      fin2: 0,
      status: 'active',
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'A member with that ID already exists.', id: null }
    return { error: error.message, id: null }
  }

  revalidatePath('/staff')
  revalidatePath('/members')
  return { error: null, id: newMember.id as string }
}

export async function updateStaffMember(id: string, data: StaffFormData) {
  await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const device = await supabase
    .from('devices')
    .select('group_name')
    .eq('id', data.device_id)
    .single()

  if (!device.data) return { error: 'Device not found.' }

  const { error } = await supabase
    .from('members')
    .update({
      sid: data.sid.trim(),
      fullname: data.fullname.trim(),
      device_id: data.device_id,
      group_name: device.data.group_name,
      member_type: 'staff',
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'A member with that ID already exists.' }
    return { error: error.message }
  }

  revalidatePath('/staff')
  revalidatePath('/members')
  return { error: null }
}

export async function setStaffMemberStatus(id: string, status: 'active' | 'inactive') {
  await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('members')
    .update({ status })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/staff')
  return { error: null }
}
