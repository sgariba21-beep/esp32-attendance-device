import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'

const MASTER_REGISTER = ['register-master', 'register-session-master']
const MASTER_DELETE = ['delete-master', 'delete-session-master']

/**
 * Sensor slots currently taken on each device, for suggesting a free slot
 * when enrolling a finger. A slot is taken by:
 *   - any member's finger on the device — students AND staff, active or not
 *     (an inactive member's template stays on the sensor until deleted);
 *   - a master / session-master finger: the replayed history of completed
 *     master jobs, where a completed clear-all empties every slot;
 *   - an enrollment still in flight (pending / in_progress register jobs).
 * A suggestion only — createEnrollmentJob still checks the chosen slot and
 * asks before overwriting.
 */
export async function loadOccupiedSlots(deviceIds: string[]): Promise<Record<string, number[]>> {
  const occupied: Record<string, Set<number>> = {}
  if (deviceIds.length === 0) return {}
  const add = (deviceId: string | null, fid: number | null) => {
    if (!deviceId || !fid || fid < 1) return
    ;(occupied[deviceId] ??= new Set()).add(fid)
  }

  const supabase = createAdminClient()
  const [membersRes, masterRes, inFlightRes] = await Promise.all([
    supabase
      .from('members')
      .select('device_id, fin1, fin2')
      .in('device_id', deviceIds)
      .or('fin1.gt.0,fin2.gt.0'),
    supabase
      .from('enrollment_jobs')
      .select('device_id, command, fid')
      .in('device_id', deviceIds)
      .in('command', [...MASTER_REGISTER, ...MASTER_DELETE, 'clearall'])
      .eq('status', 'completed')
      .order('created_at', { ascending: true }),
    supabase
      .from('enrollment_jobs')
      .select('device_id, fid')
      .in('device_id', deviceIds)
      .in('command', ['register', ...MASTER_REGISTER])
      .in('status', ['pending', 'in_progress']),
  ])

  for (const m of membersRes.data ?? []) {
    add(m.device_id, m.fin1)
    add(m.device_id, m.fin2)
  }

  const masters: Record<string, Set<number>> = {}
  for (const j of masterRes.data ?? []) {
    if (!j.device_id) continue
    const set = (masters[j.device_id] ??= new Set())
    if (j.command === 'clearall') set.clear()
    else if (MASTER_REGISTER.includes(j.command) && j.fid) set.add(j.fid)
    else if (MASTER_DELETE.includes(j.command) && j.fid) set.delete(j.fid)
  }
  for (const [deviceId, set] of Object.entries(masters)) for (const fid of set) add(deviceId, fid)

  for (const j of inFlightRes.data ?? []) add(j.device_id, j.fid)

  return Object.fromEntries(Object.entries(occupied).map(([id, s]) => [id, [...s].sort((a, b) => a - b)]))
}
