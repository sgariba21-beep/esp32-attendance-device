-- Add per-institution attendance tracking config.
-- Institutions choose which member types to track and what scan mode each uses.
-- Defaults are intentionally neutral (track students only, present/absent mode).
-- Every institution can override these freely via the Settings page.

alter table public.institutions
  add column track_students    boolean not null default true,
  add column track_staff       boolean not null default false,
  add column student_scan_mode text    not null default 'present_absent'
    check (student_scan_mode in ('present_absent', 'time_in_out')),
  add column staff_scan_mode   text    not null default 'present_absent'
    check (staff_scan_mode in ('present_absent', 'time_in_out'));
