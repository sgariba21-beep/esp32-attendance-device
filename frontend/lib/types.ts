export type InstitutionConfig = {
  id: string
  name: string
  type: 'school' | 'office'
  logo_url: string | null
  label_member: string
  label_members: string
  label_group: string
  label_unit: string
  label_period: string
  label_staff: string
  label_staff_plural: string
  skip_weekends: boolean
  timezone: string
  track_students: boolean
  track_staff: boolean
  student_scan_mode: 'present_absent' | 'time_in_out'
  staff_scan_mode: 'present_absent' | 'time_in_out'
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
  skip_weekends: false,
  timezone: 'UTC',
  track_students: true,
  track_staff: false,
  student_scan_mode: 'present_absent',
  staff_scan_mode: 'present_absent',
}

export type AttendanceRecord = {
  id: string
  date: string
  time: string
  status: 'present' | 'absent'
  scan_type: 'present' | 'time_in' | 'time_out'
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
  mode: 'present_absent' | 'time_in_out'
  institution_id?: string | null
  institution?: { id: string; name: string } | null
}

export type UnassignedDevice = {
  id: string
  mac: string | null
  display_name: string | null
}

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
