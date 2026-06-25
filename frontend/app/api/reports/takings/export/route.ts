import type { NextRequest } from 'next/server'
import { createAuthClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
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

  const p = req.nextUrl.searchParams
  const from = p.get('from') ?? undefined
  const to   = p.get('to')   ?? undefined

  // Africa/Accra = UTC+0; date params are YYYY-MM-DD Accra dates → treat as UTC midnight
  let query = admin
    .from('transactions')
    .select('id, total, created_at, note, clients(name, phone), members(fullname)')
    .eq('institution_id', institutionId ?? '')
    .order('created_at', { ascending: false })

  if (from) query = query.gte('created_at', `${from}T00:00:00.000Z`)
  if (to)   query = query.lte('created_at', `${to}T23:59:59.999Z`)

  const { data: rows } = await query

  const tz = 'Africa/Accra'
  const escape = (v: string | number | null | undefined) =>
    `"${String(v ?? '').replace(/"/g, '""')}"`

  const headers = ['Date (Accra)', 'Time (Accra)', 'Client', 'Phone', 'Stylist', 'Total (GHS)', 'Note']

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const csvRows = (rows ?? []).map((r: any) => {
    const localDt = new Date(r.created_at)
    const date = localDt.toLocaleDateString('en-CA', { timeZone: tz })
    const time = localDt.toLocaleTimeString('en-GH', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
    return [
      date,
      time,
      r.clients?.name ?? '',
      r.clients?.phone ?? '',
      r.members?.fullname ?? '',
      Number(r.total).toFixed(2),
      r.note ?? '',
    ].map(escape).join(',')
  })

  const csv = [headers.map(escape).join(','), ...csvRows].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="takings-export.csv"',
    },
  })
}
