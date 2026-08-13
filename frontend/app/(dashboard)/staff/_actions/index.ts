'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/dal'
import { ownsRecord } from '@/lib/supabase/ownership'
import { MAX_BULK_IMPORT_ROWS, type BulkMemberRow, type BulkImportResponse } from '@/lib/types'

export type StaffFormData = {
  sid: string
  fullname: string
  device_id: string
  fin1: number
  fin2: number
}

export async function createStaffMember(data: StaffFormData) {
  const session = await requireRole('super_admin', 'admin')
  const { institutionId } = session
  const supabase = createAdminClient()

  const device = await supabase
    .from('devices')
    .select('group_name, institution_id')
    .eq('id', data.device_id)
    .single()

  if (!device.data) return { error: 'Device not found.', id: null }

  // Tenant guard (C2)
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
  const session = await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  // Tenant guard (C2)
  if (!(await ownsRecord('members', id, session))) return { error: 'Not found.' }

  const device = await supabase
    .from('devices')
    .select('group_name, institution_id')
    .eq('id', data.device_id)
    .single()

  if (!device.data) return { error: 'Device not found.' }

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

export async function bulkCreateStaffMembers(rows: BulkMemberRow[]): Promise<BulkImportResponse> {
  const session = await requireRole('super_admin', 'admin')
  const { institutionId } = session
  const supabase = createAdminClient()

  if (rows.length === 0) return { error: 'No rows to import.', results: [] }
  if (rows.length > MAX_BULK_IMPORT_ROWS) {
    return { error: `Import is limited to ${MAX_BULK_IMPORT_ROWS} rows at a time.`, results: [] }
  }

  const deviceIds = [...new Set(rows.map((r) => r.device_id))]
  const { data: deviceRows } = await supabase
    .from('devices')
    .select('id, group_name, institution_id')
    .in('id', deviceIds)
  const deviceMap = new Map((deviceRows ?? []).map((d) => [d.id, d]))

  // Imported staff land inactive by design — same tenant guard as createStaffMember.
  const results = []
  for (const row of rows) {
    const device = deviceMap.get(row.device_id)
    if (!device || (session.role !== 'platform_admin' && device.institution_id !== institutionId)) {
      results.push({ sid: row.sid, fullname: row.fullname, error: 'Unit not found.' })
      continue
    }

    const { error } = await supabase.from('members').insert({
      sid: row.sid.trim(),
      fullname: row.fullname.trim(),
      device_id: row.device_id,
      group_name: device.group_name,
      institution_id: institutionId ?? device.institution_id,
      member_type: 'staff',
      fin1: 0,
      fin2: 0,
      status: 'inactive',
    })

    results.push({
      sid: row.sid,
      fullname: row.fullname,
      error: error ? (error.code === '23505' ? 'A member with that ID already exists.' : error.message) : null,
    })
  }

  revalidatePath('/staff')
  revalidatePath('/members')
  return { error: null, results }
}

export async function setStaffMemberStatus(id: string, status: 'active' | 'inactive') {
  const session = await requireRole('super_admin', 'admin')
  const supabase = createAdminClient()

  // Tenant guard (C2)
  if (!(await ownsRecord('members', id, session))) return { error: 'Not found.' }

  const { error } = await supabase
    .from('members')
    .update({ status })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/staff')
  return { error: null }
}
