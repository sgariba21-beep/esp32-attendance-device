-- =====================================================================
-- Migration E — Attendance: renames, nullable period, dedup key
-- =====================================================================
-- Purpose:
--   Align attendance with the renamed model and Decisions 2 & 3.
--
-- Key fact (verified): attendance.sid is ALREADY a uuid FK to members.id --
--   the member UUID, just misnamed. Consequences:
--     * No FK re-pointing needed (the FK followed members by OID in C).
--     * unique(sid, date) becomes unique(member_id, date) AUTOMATICALLY the
--       instant the column is renamed -- Postgres references constraint/index
--       columns by attribute number, not name. So we rename, we do NOT
--       drop-and-recreate (which would rebuild the index for no behavioural
--       gain). See the note below if you prefer the explicit drop/recreate.
--
-- Prereq: Migration C (members + periods exist; attendance FKs follow them).
-- =====================================================================

-- 1. Rename the misnamed FK column to what it actually is. The FK to
--    members.id and any backing index follow automatically (by attnum);
--    only the name changes.
alter table public.attendance rename column sid to member_id;

-- 2. Rename academic_id -> period_id. The FK to periods.id follows.
alter table public.attendance rename column academic_id to period_id;

-- 3. Make period_id nullable (Decision 3). Office-type institutions have no
--    period concept and insert attendance with period_id = NULL; the FK
--    permits NULL and skips the check for those rows. Metadata-only: dropping
--    NOT NULL clears a flag, it does not scan the table. Harmless no-op if the
--    column was already nullable.
alter table public.attendance alter column period_id drop not null;

-- 4. (OPTIONAL) Keep the dedup constraint's NAME honest. After step 1 it
--    already enforces (member_id, date); only its name still says sid. This
--    rename is metadata-only and changes no behaviour. Substitute the real
--    name from the verification query. If the dedup is a bare unique INDEX
--    rather than a constraint, use the ALTER INDEX form shown below instead,
--    or simply skip step 4 and leave a comment -- the enforcement is correct
--    either way.
alter table public.attendance
    rename constraint attendance_sid_date_unique
        to attendance_member_id_date_key;
