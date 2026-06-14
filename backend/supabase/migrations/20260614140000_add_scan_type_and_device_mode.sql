-- Task 12: device mode + attendance scan_type + updated unique constraint
--
-- devices.mode controls whether a device records present/absent or time-in/time-out.
-- attendance.scan_type records which of the three scan types this row represents.
-- The old unique(member_id, date) constraint is widened to include scan_type so that
-- a member can have both a time_in and time_out record on the same day.

-- 1. Device operating mode
alter table public.devices
  add column mode text not null
    default 'present_absent'
    check (mode in ('present_absent', 'time_in_out'));

-- 2. Scan type on attendance rows
alter table public.attendance
  add column scan_type text not null
    default 'present'
    check (scan_type in ('present', 'time_in', 'time_out'));

-- 3. Widen the dedup key to include scan_type
alter table public.attendance
  drop constraint attendance_member_id_date_key;

alter table public.attendance
  add constraint attendance_member_date_scan_type_unique
  unique (member_id, date, scan_type);
