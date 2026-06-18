-- Add staff label columns so institutions can customise the name shown
-- for staff members (e.g. "Teacher"/"Teachers", "Employee"/"Employees").
alter table public.institutions
  add column label_staff        text not null default 'Staff',
  add column label_staff_plural text not null default 'Staff';

-- Backfill the existing OLAG school institution.
update public.institutions
  set label_staff = 'Teacher', label_staff_plural = 'Teachers'
  where id = '00000000-0000-4000-8000-000000000001';
