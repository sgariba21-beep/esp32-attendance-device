'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'

export type MemberFormData = {
  sid: string
  fullname: string
  device_id: string
  member_type: 'student' | 'staff'
  fin1: number
  fin2: number
}

export async function createMember(data: MemberFormData) {
  const session = await requireRole('super_admin', 'admin')
  const { institutionId } = session
  const supabase = createAdminClient()

  const device = await supabase
    .from('devices')
    .select('group_name, institution_id')
    .eq('id', data.device_id)
    .single()

  if (!device.data) return { error: 'Device not found.', id: null }

  // Tenant guard (C2): a non-platform admin may only attach members to devices
  // that belong to their own institution.
  if (session.role !== 'platform_admin' && device.data.institution_id !== institutionId) {
    return { error: 'Device not found.', id: null }
  }

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
  const session = await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  // Tenant guard (C2): only edit members in your own institution.
  if (!(await ownsRecord('members', id, session))) return { error: 'Not found.' }

  const device = await supabase
    .from('devices')
    .select('group_name, institution_id')
    .eq('id', data.device_id)
    .single()

  if (!device.data) return { error: 'Device not found.' }

  // Tenant guard (C2): the target device must also be in your institution.
  if (session.role !== 'platform_admin' && device.data.institution_id !== session.institutionId) {
    return { error: 'Device not found.' }
  }

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
  const session = await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  // Tenant guard (C2)
  if (!(await ownsRecord('members', id, session))) return { error: 'Not found.' }

  const { error } = await supabase
    .from('members')
    .update({ status })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/members')
  revalidatePath('/staff')
  return { error: null }
}
