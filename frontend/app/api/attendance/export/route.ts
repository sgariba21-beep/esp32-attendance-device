import type { NextRequest } from 'next/server'
import { createAuthClient, createAdminClient } from '@/lib/supabase/server'
import { resolveInstitutionScope } from '@/lib/supabase/dal'
import type { Session } from '@/lib/supabase/dal'

export async function GET(req: NextRequest) {
  const authClient = await createAuthClient()
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role, institution_id, assigned_unit, assigned_device_id')
    .eq('id', user.id)
    .single()

  const role = profile?.role as string | undefined
  const institutionId = profile?.institution_id as string | null ?? null
  const assignedUnit = profile?.assigned_unit as string | null ?? null
  const assignedDeviceId = profile?.assigned_device_id as string | null ?? null

  const allowedRoles = ['super_admin', 'admin', 'teacher', 'staff', 'platform_admin']
  if (!role || !allowedRoles.includes(role)) return new Response('Forbidden', { status: 403 })

  const p = req.nextUrl.searchParams
  const fromDate = p.get('from') ?? undefined
  const toDate = p.get('to') ?? undefined
  const termId = p.get('term') ?? undefined
  const studentIds = p.get('students')?.split(',').filter(Boolean) ?? []
  const staffIds = p.get('staff')?.split(',').filter(Boolean) ?? []
  const deviceIds = p.get('classes')?.split(',').filter(Boolean) ?? []
  const typeFilter = p.get('type') ?? undefined
  const statusFilter = p.get('status') ?? undefined
  const institutionParam = p.get('institution') ?? null

  // T6: resolveInstitutionScope closes the fail-open for non-platform roles.
  const session: Session = {
    user: { id: user.id },
    role: role as Session['role'],
    assignedUnit,
    assignedDeviceId,
    institutionId,
  }
  const effectiveInstitutionId = resolveInstitutionScope(session, institutionParam)

  // T8: teacher/staff use assigned_device_id FK, fall back to string-match for
  // profiles not yet backfilled by T19.
  let effectiveDeviceIds = deviceIds
  let teacherNoMatch = false
  if (role === 'teacher' || role === 'staff') {
    if (assignedDeviceId) {
      effectiveDeviceIds = [assignedDeviceId]
    } else if (assignedUnit) {
      let devQ = admin.from('devices').select('id, group_name, unit_name')
      if (effectiveInstitutionId) devQ = devQ.eq('institution_id', effectiveInstitutionId)
      const { data: devs } = await devQ
      const match = (devs ?? []).find((d: { id: string; group_name: string; unit_name: string }) =>
        `${d.group_name} ${d.unit_name}` === assignedUnit
      )
      if (match) effectiveDeviceIds = [match.id]
      else teacherNoMatch = true
    } else {
      teacherNoMatch = true
    }
  }

  let typeMemberIds: string[] | null = null
  if (typeFilter) {
    let q = admin.from('members').select('id').eq('member_type', typeFilter)
    if (effectiveInstitutionId) q = q.eq('institution_id', effectiveInstitutionId)
    const { data } = await q
    typeMemberIds = data?.map((m: { id: string }) => m.id) ?? []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = admin
    .from('attendance')
    .select(`
      id, date, time, status, scan_type,
      student:member_id(fullname, sid),
      academic:period_id(term, year),
      device:device_id(group_name, unit_name),
      institution:institution_id(name)
    `)
    .order('date', { ascending: false })
    .order('time', { ascending: false })

  if (effectiveInstitutionId) query = query.eq('institution_id', effectiveInstitutionId)
  if (fromDate) query = query.gte('date', fromDate)
  if (toDate) query = query.lte('date', toDate)
  if (termId) query = query.eq('period_id', termId)
  const allMemberIds = [...studentIds, ...staffIds]
  if (allMemberIds.length) query = query.in('member_id', allMemberIds)
  if (effectiveDeviceIds.length) query = query.in('device_id', effectiveDeviceIds)
  if (typeMemberIds !== null) query = query.in('member_id', typeMemberIds)
  if (statusFilter) query = query.eq('status', statusFilter)

  const { data: records } = teacherNoMatch ? { data: [] } : await query

  const isPlatformAdmin = role === 'platform_admin'
  const headers = ['Date', 'Name', 'ID', 'Unit', 'Period', 'Time', 'Status', 'Scan Type']
  if (isPlatformAdmin) headers.push('Institution')

  const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (records ?? []).map((r: any) => {
    const unit = r.device ? `${r.device.group_name} ${r.device.unit_name}` : ''
    const period = r.academic ? `${r.academic.term} ${r.academic.year}` : ''
    const row = [
      r.date,
      r.student?.fullname ?? '',
      r.student?.sid ?? '',
      unit,
      period,
      r.time ?? '',
      r.status ?? '',
      r.scan_type ?? 'present',
    ]
    if (isPlatformAdmin) row.push(r.institution?.name ?? '')
    return row.map(escape).join(',')
  })

  const csv = [headers.map(escape).join(','), ...rows].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="attendance-export.csv"',
    },
  })
}
