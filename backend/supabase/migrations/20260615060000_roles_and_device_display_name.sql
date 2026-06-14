-- =====================================================================
-- Migration G — Roles expansion + device display_name
-- =====================================================================
-- Purpose:
--   (1) Widen profiles.role to add 'staff' and 'platform_admin'.
--   (2) Add devices.display_name: a STORED generated column from
--       group_name + unit_name, null-safe for flat office deployments.
--
-- Two independent changes on two tables; order does not matter.
-- Prereq: Migration C (devices.group_name and devices.unit_name exist).
-- =====================================================================


-- 1. profiles.role: widen the allowed set ------------------------------
--    CHECK constraints are immutable -> drop and recreate. This is a
--    WIDENING (new set superset of the old), so validating against existing
--    OLAG rows is guaranteed to pass. drop-then-add is atomic within this
--    transaction; the momentary gap is invisible to other sessions.
alter table public.profiles drop constraint profiles_role_check;

alter table public.profiles
    add constraint profiles_role_check
        check (role in
            ('super_admin', 'admin', 'teacher', 'staff', 'platform_admin'));


-- 2. devices.display_name: STORED generated column ---------------------
--    STORED = computed once and physically stored, recomputed only when a
--    source column changes (the form Postgres supports broadly). Expression
--    may reference only same-table columns + immutable functions; both hold.
--
--    NOTE: adding a STORED generated column to a non-empty table REWRITES
--    the table (computes the value for every existing device) under a brief
--    ACCESS EXCLUSIVE lock -- trivial at fleet scale.
--
--    NULL CAVEAT: safe only if unit_name is NOT NULL. If unit_name were null
--    the THEN branch's `||` would yield NULL (x || NULL = NULL), silently
--    producing a null display_name. Use concat_ws() instead if unit_name
--    can be null.
alter table public.devices
    add column display_name text
        generated always as (
            case when group_name is not null
                 then group_name || ' — ' || unit_name
                 else unit_name
            end
        ) stored;
