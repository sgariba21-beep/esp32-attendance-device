-- =====================================================================
-- Club mode (Phase 1, 3/3) — attendance.meeting_id + meeting-aware dedup
-- =====================================================================
-- Purpose:
--   Links an attendance row to the meeting it was resolved into. NULL on
--   every daily-mode row (school / office / shop) — which is every row that
--   exists today.
--
--   The existing dedup key, attendance_member_date_scan_type_unique
--   (member_id, date, scan_type), allows ONE row per member per day per scan
--   type. A club that meets twice in a day needs two. This adds the two keys
--   that will replace it:
--
--     attendance_member_date_scan_type_meeting_key
--       UNIQUE NULLS NOT DISTINCT (member_id, date, scan_type, meeting_id)
--       Daily rows always have meeting_id NULL, and NULLS NOT DISTINCT makes
--       those NULLs compare equal — so for daily rows this is EXACTLY the old
--       key. For club rows it permits one row per meeting per day.
--
--     attendance_meeting_member_scan_type_key
--       UNIQUE (meeting_id, member_id, scan_type)   -- default NULLS DISTINCT
--       One row per member per meeting per scan type. Daily rows (NULL
--       meeting_id) never collide with each other, so this constrains club
--       rows only. Leading with meeting_id also makes it the index the
--       meeting_id FK check needs.
--
-- Why NULL semantics rather than partial indexes (WHERE meeting_id IS NULL):
--   mark-absent upserts through PostgREST with
--     onConflict: "member_id,date,scan_type", ignoreDuplicates: true
--   which becomes  ON CONFLICT (member_id, date, scan_type) DO NOTHING.
--   Postgres only accepts a PARTIAL unique index as the conflict arbiter when
--   the ON CONFLICT clause repeats the index's WHERE predicate, and PostgREST
--   has no way to send one. Both keys here are non-partial, so PostgREST can
--   target them by column list alone. NULLS NOT DISTINCT needs Postgres 15+
--   (cloud runs 17).
--
-- Why the OLD key is KEPT for now:
--   mark-absent's onConflict names exactly (member_id, date, scan_type), and
--   arbiter inference needs a unique index on exactly those columns. Dropping
--   it here would make every tenant's nightly absence run fail — and silently,
--   because mark-absent reports per-institution errors as strings inside a 200
--   response. It is dropped in Phase 2, AFTER mark-absent is redeployed with
--   onConflict "member_id,date,scan_type,meeting_id". Until then it is
--   redundant for daily rows and, with no club rows yet, restricts nothing new.
--
-- Why meeting_id is NOT ON DELETE CASCADE:
--   deleting a meeting would silently delete its attendance. This mirrors
--   attendance.member_id instead (default NO ACTION): a meeting with
--   attendance cannot be deleted until its rows are removed deliberately, and
--   the dashboard offers status = 'cancelled' instead (Phase 3). NO ACTION,
--   not RESTRICT, because it is checked at END of statement — so
--   DELETE FROM institutions, which cascades to both meetings and attendance,
--   still succeeds.
--
-- Safety:
--   meeting_id is nullable with no default: a metadata-only ADD COLUMN. Every
--   existing row is NULL, so both new keys validate trivially — the first is
--   equivalent to the key already enforced, and the second never compares
--   NULLs. Builds two indexes under lock in one transaction: milliseconds at
--   current volumes. If attendance has grown very large by the time this is
--   applied, build them CONCURRENTLY first (outside a transaction) and attach
--   with ADD CONSTRAINT ... USING INDEX.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================


alter table public.attendance
  add column meeting_id uuid references public.meetings(id);

comment on column public.attendance.meeting_id is
  'Club mode: the meeting this scan / absence was resolved into. NULL for '
  'daily-mode tenants (school / office / shop). Not ON DELETE CASCADE: a '
  'meeting with attendance must be cancelled, not deleted.';

alter table public.attendance
  add constraint attendance_member_date_scan_type_meeting_key
  unique nulls not distinct (member_id, date, scan_type, meeting_id);

alter table public.attendance
  add constraint attendance_meeting_member_scan_type_key
  unique (meeting_id, member_id, scan_type);
