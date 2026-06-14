'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'

export type MemberFormData = {
  sid: string
  fullname: string
  device_id: string
  member_type: 'student' | 'staff'
  fin1: number
  fin2: number
}

export async function createMember(data: MemberFormData) {
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
      member_type: data.member_type,
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

  revalidatePath('/members')
  revalidatePath('/staff')
  return { error: null, id: newMember.id as string }
}

export async function updateMember(id: string, data: MemberFormData) {
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
      member_type: data.member_type,
    })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { error: 'A member with that ID already exists.' }
    return { error: error.message }
  }

  revalidatePath('/members')
  revalidatePath('/staff')
  return { error: null }
}

export async function setMemberStatus(id: string, status: 'active' | 'inactive') {
  await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('members')
    .update({ status })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/members')
  revalidatePath('/staff')
  return { error: null }
}
