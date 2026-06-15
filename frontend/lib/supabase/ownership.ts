import 'server-only'
import { createAdminClient } from './server'
import type { UserRole } from './dal'

type OwnershipSession = {
  role: UserRole
  institutionId: string | null
}

/**
 * Tenant-isolation guard (fixes C2/C3/H4/H5/H6/M6).
 *
 * The dashboard talks to the database through the service role, which BYPASSES
 * Row Level Security. That means application code is the ONLY thing enforcing
 * tenant boundaries, so every action that mutates a record identified by `id`
 * must confirm the record belongs to the caller's institution before touching it.
 *
 * `platform_admin` is cross-tenant by design and always passes.
 * Any non-platform caller with a null institution_id fails closed.
 *
 * Works for every tenant-scoped table that has an `institution_id` column
 * (members, devices, periods, attendance, enrollment_jobs, holidays, profiles).
 */
export async function ownsRecord(
  table: string,
  id: string,
  session: OwnershipSession,
): Promise<boolean> {
  if (session.role === 'platform_admin') return true
  if (!session.institutionId || !id) return false

  const supabase = createAdminClient()
  const { data } = await supabase
    .from(table)
    .select('institution_id')
    .eq('id', id)
    .single()

  return !!data && data.institution_id === session.institutionId
}
