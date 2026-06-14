-- =====================================================================
-- Migration D — Institution scoping (staged)   *** TOUCHES LIVE DATA ***
-- =====================================================================
-- Purpose:
--   Add institution_id to every tenant-scoped table and tie all existing
--   OLAG rows to the seeded OLAG institution. After this the data model is
--   multi-tenant even though only one tenant exists.
--
-- Three-step pattern (Correction #2), per table:
--   1. ADD the column NULLABLE     -- existing rows get NULL, no failure
--   2. BACKFILL with the OLAG id   -- no NULLs remain
--   3. SET NOT NULL + ADD FK       -- now safe; nothing violates it
--   (profiles is the exception: nullable, see its block.)
--
-- Why not `add column ... not null default '<olag-id>'`?
--   It works, but the default LINGERS: a future insert that forgets
--   institution_id would silently get the OLAG id -- the exact cross-tenant
--   leak we are preventing. The staged pattern leaves NO default, so a
--   missing institution_id fails loudly.
--
-- Atomicity: all seven tables in one file = one transaction. Any failure
--   rolls the whole migration back. Take the DB dump first (Decision 10).
--
-- Prereqs: Migration B (institutions + seeded OLAG row) and Migration C
--   (renamed members/periods) must already be applied.
--
-- OLAG institution id (fixed constant from Migration B):
--   00000000-0000-4000-8000-000000000001
-- =====================================================================


-- 1. members ----------------------------------------------------------
alter table public.members add column institution_id uuid;

update public.members
   set institution_id = '00000000-0000-4000-8000-000000000001'
 where institution_id is null;

alter table public.members
    alter column institution_id set not null,
    add constraint members_institution_id_fkey
        foreign key (institution_id) references public.institutions(id);

-- FK columns are not auto-indexed; RLS (Migration H) filters by this column
-- on every query, so index it now.
create index members_institution_id_idx on public.members(institution_id);


-- 2. devices ----------------------------------------------------------
alter table public.devices add column institution_id uuid;

update public.devices
   set institution_id = '00000000-0000-4000-8000-000000000001'
 where institution_id is null;

alter table public.devices
    alter column institution_id set not null,
    add constraint devices_institution_id_fkey
        foreign key (institution_id) references public.institutions(id);

create index devices_institution_id_idx on public.devices(institution_id);


-- 3. periods  (academic_status_check left intact -- not touched here) --
alter table public.periods add column institution_id uuid;

update public.periods
   set institution_id = '00000000-0000-4000-8000-000000000001'
 where institution_id is null;

alter table public.periods
    alter column institution_id set not null,
    add constraint periods_institution_id_fkey
        foreign key (institution_id) references public.institutions(id);

create index periods_institution_id_idx on public.periods(institution_id);


-- 4. attendance -------------------------------------------------------
alter table public.attendance add column institution_id uuid;

update public.attendance
   set institution_id = '00000000-0000-4000-8000-000000000001'
 where institution_id is null;

alter table public.attendance
    alter column institution_id set not null,
    add constraint attendance_institution_id_fkey
        foreign key (institution_id) references public.institutions(id);

create index attendance_institution_id_idx on public.attendance(institution_id);


-- 5. enrollment_jobs  (may be empty -- backfill updates 0 rows, fine) --
alter table public.enrollment_jobs add column institution_id uuid;

update public.enrollment_jobs
   set institution_id = '00000000-0000-4000-8000-000000000001'
 where institution_id is null;

alter table public.enrollment_jobs
    alter column institution_id set not null,
    add constraint enrollment_jobs_institution_id_fkey
        foreign key (institution_id) references public.institutions(id);

create index enrollment_jobs_institution_id_idx
    on public.enrollment_jobs(institution_id);


-- 6. holidays ---------------------------------------------------------
alter table public.holidays add column institution_id uuid;

update public.holidays
   set institution_id = '00000000-0000-4000-8000-000000000001'
 where institution_id is null;

alter table public.holidays
    alter column institution_id set not null,
    add constraint holidays_institution_id_fkey
        foreign key (institution_id) references public.institutions(id);

create index holidays_institution_id_idx on public.holidays(institution_id);


-- 7. profiles   *** EXCEPTION: nullable, NOT set to NOT NULL ***
--    A platform_admin (Decision 5) belongs to no single institution, so its
--    profile must allow a NULL institution_id. The FK still applies -- a FK
--    column permits NULL by default and skips the check for NULL rows.
--    Existing OLAG profiles are backfilled so they remain scoped.
-- ---------------------------------------------------------------------
alter table public.profiles add column institution_id uuid;

update public.profiles
   set institution_id = '00000000-0000-4000-8000-000000000001'
 where institution_id is null;

alter table public.profiles
    add constraint profiles_institution_id_fkey
        foreign key (institution_id) references public.institutions(id);

create index profiles_institution_id_idx on public.profiles(institution_id);
