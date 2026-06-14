-- Re-add all institution_id foreign keys with ON DELETE CASCADE so that
-- deleting an institution row automatically removes every tenant-scoped row
-- that belongs to it (members, devices, attendance, etc.).
--
-- Constraint names come from Migration D (institution_scoping).

alter table public.members
  drop constraint members_institution_id_fkey,
  add constraint members_institution_id_fkey
    foreign key (institution_id) references public.institutions(id) on delete cascade;

alter table public.devices
  drop constraint devices_institution_id_fkey,
  add constraint devices_institution_id_fkey
    foreign key (institution_id) references public.institutions(id) on delete cascade;

alter table public.periods
  drop constraint periods_institution_id_fkey,
  add constraint periods_institution_id_fkey
    foreign key (institution_id) references public.institutions(id) on delete cascade;

alter table public.attendance
  drop constraint attendance_institution_id_fkey,
  add constraint attendance_institution_id_fkey
    foreign key (institution_id) references public.institutions(id) on delete cascade;

alter table public.enrollment_jobs
  drop constraint enrollment_jobs_institution_id_fkey,
  add constraint enrollment_jobs_institution_id_fkey
    foreign key (institution_id) references public.institutions(id) on delete cascade;

alter table public.holidays
  drop constraint holidays_institution_id_fkey,
  add constraint holidays_institution_id_fkey
    foreign key (institution_id) references public.institutions(id) on delete cascade;

alter table public.profiles
  drop constraint profiles_institution_id_fkey,
  add constraint profiles_institution_id_fkey
    foreign key (institution_id) references public.institutions(id) on delete cascade;
