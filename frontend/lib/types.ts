/**
 * 'club' takes attendance per MEETING rather than per day (CLUB-MODE-PLAN.md):
 * scans resolve into a meeting by timestamp, absences are written when each
 * meeting closes, and weekdays / holidays / periods do not apply.
 */
export type InstitutionType = 'school' | 'office' | 'shop' | 'club'

export type InstitutionConfig = {
  id: string
  name: string
  type: InstitutionType
  logo_url: string | null
  label_member: string
  label_members: string
  label_group: string
  label_unit: string
  label_period: string
  label_staff: string
  label_staff_plural: string
  /** ISO weekday numbers (1=Mon … 7=Sun) on which attendance is tracked. Replaces the old skip_weekends boolean. */
  tracked_weekdays: number[]
  timezone: string
  /** Dashboard clock rendering. Display only — stored times stay UTC / 24h. */
  time_format: '12h' | '24h'
  /** When true, arrival scans past expected_start_time + late_grace_minutes are marked late. */
  track_lateness: boolean
  /** Expected arrival time, 'HH:MM' in the institution's timezone. Null when lateness tracking is off. */
  expected_start_time: string | null
  /** Grace window (minutes) added to expected_start_time before a scan counts as late. */
  late_grace_minutes: number
  /** When true, time_out scans before expected_end_time − early_leave_grace_minutes are marked as early departures. */
  track_early_leaving: boolean
  /** Expected departure time, 'HH:MM' in the institution's timezone. Null when early-leaving tracking is off. */
  expected_end_time: string | null
  /** Grace window (minutes) subtracted from expected_end_time before a scan counts as an early departure. */
  early_leave_grace_minutes: number
  /** Member name shown on the device screen during an attendance scan (enrollment cards always show the full name). */
  member_name_display: 'full' | 'first' | 'initial_last' | 'sid' | 'none'
  /** ISO-4217 display currency (GHS, NGN, USD…). Formatting only; no FX. */
  currency: string
  track_students: boolean
  track_staff: boolean
  student_scan_mode: 'present_absent' | 'time_in_out'
  staff_scan_mode: 'present_absent' | 'time_in_out'
  /** Shop module switches — does this tenant deal in goods / services. */
  sell_products: boolean
  sell_services: boolean
  /** Shop loyalty master switch — hides the Loyalty module when false. */
  loyalty_enabled: boolean
  /** Lifecycle. Non-active tenants are gated at verifySession → /suspended. */
  status: 'active' | 'suspended' | 'deactivated'
  /** Per-institution brand colour (hex). Null → platform default accent. */
  theme_primary: string | null
  /** Curated preset key, or 'custom'. Null → default. */
  theme_preset: string | null
  /** Club only: write an absent row for each expected member who missed a meeting, when it closes. */
  track_absences: boolean
  /** Club only: minutes before a scheduled meeting's start during which a scan still counts for it. */
  meeting_preroll_minutes: number
  /** Club only: minutes after a scheduled meeting's end during which a scan still counts for it. */
  meeting_postroll_minutes: number
  /** Club only: idle minutes after which an ad-hoc (device-opened) meeting is closed automatically. */
  meeting_autoclose_minutes: number
}

export const DEFAULT_INSTITUTION: InstitutionConfig = {
  id: '',
  name: 'Platform Admin',
  type: 'school',
  logo_url: null,
  label_member: 'Member',
  label_members: 'Members',
  label_group: 'Group',
  label_unit: 'Unit',
  label_period: 'Period',
  label_staff: 'Staff',
  label_staff_plural: 'Staff',
  tracked_weekdays: [1, 2, 3, 4, 5],
  timezone: 'UTC',
  time_format: '24h',
  track_lateness: false,
  expected_start_time: null,
  late_grace_minutes: 0,
  track_early_leaving: false,
  expected_end_time: null,
  early_leave_grace_minutes: 0,
  member_name_display: 'first',
  currency: 'GHS',
  track_students: true,
  track_staff: false,
  student_scan_mode: 'present_absent',
  staff_scan_mode: 'present_absent',
  sell_products: true,
  sell_services: true,
  loyalty_enabled: true,
  status: 'active',
  theme_primary: null,
  theme_preset: null,
  track_absences: true,
  meeting_preroll_minutes: 30,
  meeting_postroll_minutes: 30,
  meeting_autoclose_minutes: 240,
}

export type AttendanceRecord = {
  id: string
  date: string
  time: string
  status: 'present' | 'absent'
  scan_type: 'present' | 'time_in' | 'time_out'
  /** Punctuality verdict fixed at scan time. Null when tracking is off or the row is an absent placeholder. */
  punctuality: 'on_time' | 'late' | 'early_leave' | null
  scan_id: string | null
  student: {
    id: string
    fullname: string
    sid: string
  } | null
  academic: {
    id: string
    term: string
    year: string
  } | null
  device: {
    id: string
    group_name: string
    unit_name: string
  } | null
  institution: { name: string } | null
  /**
   * Club tenants: the meeting this row was resolved into. Null for daily-mode
   * rows. absences_written_at is set once the close sweep has run for it.
   */
  meeting: { id: string; title: string | null; starts_at: string; absences_written_at: string | null } | null
}

export type Member = {
  id: string
  sid: string
  fullname: string
  group_name: string
  fin1: number
  fin2: number
  status: 'active' | 'inactive'
  member_type: 'student' | 'staff' | 'member'
  created_at: string
  device_id: string
}

/** @deprecated Use Member */
export type Student = Member

export type Device = {
  id: string
  mac?: string | null
  group_name: string
  unit_name: string
  display_name: string | null
  institution_id?: string | null
  institution?: { id: string; name: string } | null
}

export type UnassignedDevice = {
  id: string
  mac: string | null
  display_name: string | null
}

/** A single validated row queued for bulk member/staff CSV import. */
export type BulkMemberRow = { sid: string; fullname: string; device_id: string }

/** Per-row outcome reported back after a bulk import server action runs. */
export type BulkImportRowResult = { sid: string; fullname: string; error: string | null }

export type BulkImportResponse = { error: string | null; results: BulkImportRowResult[] }

/** Server-side cap on rows per bulk import call, kept in sync with client-side messaging. */
export const MAX_BULK_IMPORT_ROWS = 500

export type AcademicTerm = {
  id: string
  term: string
  year: string
  status: 'active' | 'inactive'
  start_date: string | null
  end_date: string | null
}

export type Holiday = {
  id: string
  label: string
  start_date: string
  end_date: string
  recurring: boolean
}

/** Club mode: one meeting — a bounded attendance window. */
export type Meeting = {
  id: string
  title: string | null
  origin: 'scheduled' | 'device'
  status: 'scheduled' | 'open' | 'closed' | 'cancelled'
  starts_at: string
  ends_at: string | null
  opened_at: string | null
  closed_at: string | null
  device_id: string | null
  schedule_id: string | null
  device_deleted_at: string | null
}

/** Club mode: a recurrence rule materialised into meetings ~8 weeks ahead. */
export type MeetingSchedule = {
  id: string
  title: string | null
  freq: 'weekly' | 'monthly_nth_weekday'
  interval_n: number
  /** ISO weekday: 1 = Mon … 7 = Sun. */
  weekday: number
  /** Monthly only: 1–4, or -1 for "last". */
  nth: number | null
  /** Local to the institution, 'HH:MM:SS'. */
  start_time: string
  duration_minutes: number
  starts_on: string
  ends_on: string | null
  active: boolean
  device_id: string | null
}
