-- =====================================================================
-- Device deletion: preserve linked records (Decision: deactivate members)
-- =====================================================================
-- Goal: a faulty/retired device can be deleted even when attendance,
-- enrollment jobs, or members reference it. The records are preserved and
-- the device reference is nulled out (ON DELETE SET NULL) instead of the
-- previous ON DELETE RESTRICT which blocked the delete entirely.
--
-- Members additionally get deactivated by the deleteDevice action *before*
-- the row is removed (status -> inactive), then the FK nulls their
-- device_id here. A member with a NULL device_id is "unassigned" and must
-- be reassigned to a unit before it can scan again.
--
-- Note on constraint names: members was renamed from `students`, and
-- Postgres keeps the original constraint name through a table rename, so the
-- members FK is still called students_device_id_fkey. We drop both candidate
-- names IF EXISTS to be safe across fresh vs. migrated databases.
-- =====================================================================

-- ---------- attendance (device_id already nullable) ------------------
alter table public.attendance
    drop constraint if exists attendance_device_id_fkey;
alter table public.attendance
    add constraint attendance_device_id_fkey
        foreign key (device_id) references public.devices(id) on delete set null;

-- ---------- enrollment_jobs (make device_id nullable) ----------------
alter table public.enrollment_jobs
    drop constraint if exists enrollment_jobs_device_id_fkey;
alter table public.enrollment_jobs
    alter column device_id drop not null;
alter table public.enrollment_jobs
    add constraint enrollment_jobs_device_id_fkey
        foreign key (device_id) references public.devices(id) on delete set null;

-- ---------- members (make device_id nullable) ------------------------
alter table public.members
    drop constraint if exists students_device_id_fkey;
alter table public.members
    drop constraint if exists members_device_id_fkey;
alter table public.members
    alter column device_id drop not null;
alter table public.members
    add constraint members_device_id_fkey
        foreign key (device_id) references public.devices(id) on delete set null;
