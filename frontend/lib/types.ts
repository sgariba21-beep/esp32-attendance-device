export type AttendanceRecord = {
  id: string
  date: string
  time: string
  status: 'present' | 'absent'
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
    form: string
    class: string
  } | null
}

export type Student = {
  id: string
  sid: string
  fullname: string
  form: string
  fin1: number
  fin2: number
  status: 'active' | 'inactive'
  created_at: string
  device_id: string
}

export type Device = {
  id: string
  form: string
  class: string
}

export type AcademicTerm = {
  id: string
  term: string
  year: string
  status: 'active' | 'inactive'
  start_date: string | null
  end_date: string | null
}
