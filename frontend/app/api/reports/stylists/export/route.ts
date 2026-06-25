import type { NextRequest } from 'next/server'
import { createAuthClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(_req: NextRequest) {
  const authClient = await createAuthClient()
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user) return new Response('Unauthorized', { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role, institution_id')
    .eq('id', user.id)
    .single()

  const role = profile?.role as string | undefined
  const institutionId = profile?.institution_id as string | null ?? null

  const allowedRoles = ['super_admin', 'admin', 'platform_admin']
  if (!role || !allowedRoles.includes(role)) return new Response('Forbidden', { status: 403 })

  const { data: rows } = await admin
    .from('transactions')
    .select('total, staff_id, members(fullname)')
    .eq('institution_id', institutionId ?? '')

  // Aggregate in memory: revenue per stylist
  type Row = { total: number; staff_id: string | null; members: { fullname: string } | null }
  const map = new Map<string, { name: string; total: number; count: number }>()
  for (const r of (rows ?? []) as unknown as Row[]) {
    const key = r.staff_id ?? '__none__'
    const e = map.get(key) ?? {
      name:  r.staff_id ? (r.members?.fullname ?? 'Unknown') : 'Unattributed',
      total: 0,
      count: 0,
    }
    e.total += Number(r.total)
    e.count++
    map.set(key, e)
  }

  const sorted = [...map.values()].sort((a, b) => b.total - a.total)

  const escape = (v: string | number | null | undefined) =>
    `"${String(v ?? '').replace(/"/g, '""')}"`

  const headers = ['Stylist', 'Sales', 'Total revenue (GHS)']
  const csvRows = sorted.map((r) =>
    [r.name, r.count, r.total.toFixed(2)].map(escape).join(',')
  )

  const csv = [headers.map(escape).join(','), ...csvRows].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="revenue-by-stylist.csv"',
    },
  })
}
