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

  const { data: inst } = await admin
    .from('institutions')
    .select('currency')
    .eq('id', institutionId ?? '')
    .single()
  const currency = inst?.currency ?? 'GHS'

  const { data: rows } = await admin
    .from('transactions')
    .select('total, client_id, clients(name, phone)')
    .eq('institution_id', institutionId ?? '')

  // Aggregate in memory: revenue per client
  type Row = { total: number; client_id: string; clients: { name: string; phone: string } | null }
  const map = new Map<string, { name: string; phone: string; total: number; count: number }>()
  for (const r of (rows ?? []) as unknown as Row[]) {
    const e = map.get(r.client_id) ?? {
      name:  r.clients?.name  ?? '—',
      phone: r.clients?.phone ?? '',
      total: 0,
      count: 0,
    }
    e.total += Number(r.total)
    e.count++
    map.set(r.client_id, e)
  }

  const sorted = [...map.values()].sort((a, b) => b.total - a.total)

  const escape = (v: string | number | null | undefined) =>
    `"${String(v ?? '').replace(/"/g, '""')}"`

  const headers = ['Client', 'Phone', 'Transactions', `Total revenue (${currency})`]
  const csvRows = sorted.map((r) =>
    [r.name, r.phone, r.count, r.total.toFixed(2)].map(escape).join(',')
  )

  const csv = [headers.map(escape).join(','), ...csvRows].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="revenue-by-client.csv"',
    },
  })
}
