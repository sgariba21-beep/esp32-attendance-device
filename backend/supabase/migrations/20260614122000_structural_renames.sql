-- =====================================================================
-- Migration C — Structural renames (still single-tenant)
-- =====================================================================
-- Purpose:
--   Rename school-specific tables/columns to generic, multi-tenant names.
--   No institution scoping yet -- that's Migration D. All metadata-only
--   renames plus one constraint drop; no rows are rewritten.
--
-- Why this is FK/index-safe:
--   Postgres references objects by OID, not name. FKs and indexes pointing
--   at students/academic follow automatically to members/periods. Do NOT
--   re-create the attendance or enrollment_jobs FKs.
--
-- Naming gotcha used in step 5:
--   Renaming a table does NOT rename objects named after it. After the
--   rename, academic's term check is STILL called academic_term_check.
--   That's the name we drop by.
-- =====================================================================

-- 1. students -> members. Rename the table FIRST; the column renames below
--    must refer to it by its new name.
alter table public.students rename to members;

-- 2. members.form -> group_name.
alter table public.members rename column form to group_name;

-- 3. devices: form -> group_name, class -> unit_name. These two were
--    concatenated to identify a device; get-enrollment-job stops doing
--    that in Phase 2 and identifies by device_id instead.
alter table public.devices rename column form  to group_name;
alter table public.devices rename column class to unit_name;

-- 4. academic -> periods.
alter table public.academic rename to periods;

-- 5. Drop the term check constraint. Table is now 'periods' but the
--    constraint kept its original name (see gotcha above). VERIFY the name
--    first with the pg_constraint query. Do NOT use IF EXISTS here: a wrong
--    name should fail loudly and roll back the whole migration, not
--    silently skip and leave the constraint enforcing the old term values.
alter table public.periods drop constraint academic_term_check;

-- 6. profiles.assigned_class -> assigned_unit.
alter table public.profiles rename column assigned_class to assigned_unit;
