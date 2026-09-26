-- =====================================================================
-- Club mode (Phase 2, 2/3) — drop the day-keyed attendance dedup key
-- =====================================================================
-- Purpose:
--   attendance_member_date_scan_type_unique (member_id, date, scan_type)
--   allows one row per member per DAY. A club member at two meetings on one
--   day needs two. Phase 1 (20260926120200) added the keys that replace it;
--   this removes it.
--
--   After the drop, daily-mode rows are still deduplicated exactly as before
--   by attendance_member_date_scan_type_meeting_key
--   (UNIQUE NULLS NOT DISTINCT (member_id, date, scan_type, meeting_id)):
--   their meeting_id is always NULL, and those NULLs compare equal.
--
-- !!! ORDERING — apply ONLY AFTER mark-absent is redeployed !!!
--   The currently-deployed mark-absent may still upsert with
--     onConflict: "member_id,date,scan_type"
--   which needs a unique key on exactly those columns. Drop it first and every
--   tenant's nightly absence run fails with 42P10 — silently, inside a 200.
--   The redeployed mark-absent targets (member_id, date, scan_type,
--   meeting_id), which works both before and after this drop.
--
--   Checking the deployed version: the redeployed function's source contains
--   onConflict: "member_id,date,scan_type,meeting_id".
--
-- Safety: the guard below refuses to run unless the replacement key exists,
--   so this can never leave daily attendance without dedup protection.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.attendance'::regclass
       and conname  = 'attendance_member_date_scan_type_meeting_key'
  ) then
    raise exception
      'attendance_member_date_scan_type_meeting_key is missing — apply 20260926120200 first; '
      'dropping the old key now would leave daily attendance without dedup';
  end if;
end;
$$;

alter table public.attendance
  drop constraint attendance_member_date_scan_type_unique;
