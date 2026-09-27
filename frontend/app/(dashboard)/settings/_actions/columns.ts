// Plain module (no 'use server'): shared shapes + column builders for the
// institution Settings form. A "use server" file may only export async
// functions, so the non-async helpers live here and are imported by both
// save paths (settings/_actions and institutions/_actions).

import type { InstitutionType } from '@/lib/types'

export type SettingsFormData = {
  name: string
  type: InstitutionType
  logo_url: string
  label_member: string
  label_members: string
  label_group: string
  label_unit: string
  label_period: string
  label_staff: string
  label_staff_plural: string
  /** ISO weekday numbers (1=Mon … 7=Sun) the institution tracks attendance on. */
  tracked_weekdays: number[]
  timezone: string
  time_format: '12h' | '24h'
  track_lateness: boolean
  /** 'HH:MM' from the <input type="time">, or '' when not set. */
  expected_start_time: string
  late_grace_minutes: number
  track_early_leaving: boolean
  expected_end_time: string
  early_leave_grace_minutes: number
  member_name_display: 'full' | 'first' | 'initial_last' | 'sid' | 'none'
  currency: string
  track_students: boolean
  track_staff: boolean
  student_scan_mode: 'present_absent' | 'time_in_out'
  staff_scan_mode: 'present_absent' | 'time_in_out'
  sell_products: boolean
  sell_services: boolean
  loyalty_enabled: boolean
  theme_primary: string
  theme_preset: string
  track_absences: boolean
  meeting_preroll_minutes: number
  meeting_postroll_minutes: number
  meeting_autoclose_minutes: number
}

/**
 * Normalised institutions columns for the time-display / tracked-days /
 * punctuality settings. Shared by the super-admin (updateInstitutionSettings)
 * and platform-admin (updateInstitutionSettingsById) save paths so the two
 * stay in lockstep. Rules:
 *   - tracked_weekdays: de-duped, sorted, clamped to 1..7; empty → Mon–Fri.
 *   - expected_*_time: null unless the matching tracking flag is on AND a
 *     time was entered (an empty string is stored as NULL, not '').
 *   - grace minutes: coerced to a non-negative integer.
 */
export function attendanceConfigColumns(data: SettingsFormData) {
  const days = Array.from(new Set(data.tracked_weekdays))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b)
  const grace = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

  return {
    tracked_weekdays: days.length ? days : [1, 2, 3, 4, 5],
    time_format: data.time_format === '12h' ? '12h' : '24h',
    track_lateness: data.track_lateness,
    expected_start_time: data.track_lateness && data.expected_start_time ? data.expected_start_time : null,
    late_grace_minutes: grace(data.late_grace_minutes),
    track_early_leaving: data.track_early_leaving,
    expected_end_time: data.track_early_leaving && data.expected_end_time ? data.expected_end_time : null,
    early_leave_grace_minutes: grace(data.early_leave_grace_minutes),
  }
}

/**
 * Club-mode meeting settings, clamped to the institutions CHECK bounds
 * (20260926120000) so an out-of-range entry is corrected, never rejected by
 * the database with a raw constraint error. Written for every type — the
 * values are simply unused outside clubs.
 */
export function clubConfigColumns(data: SettingsFormData) {
  const clamp = (n: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : fallback

  return {
    track_absences: data.track_absences,
    meeting_preroll_minutes: clamp(data.meeting_preroll_minutes, 0, 240, 30),
    meeting_postroll_minutes: clamp(data.meeting_postroll_minutes, 0, 240, 30),
    meeting_autoclose_minutes: clamp(data.meeting_autoclose_minutes, 15, 1440, 240),
  }
}
