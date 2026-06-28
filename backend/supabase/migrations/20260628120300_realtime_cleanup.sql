-- =====================================================================
-- T16 — Realtime publication cleanup
-- =====================================================================
-- Analysis of remaining Realtime consumers:
--
--   KEPT:   enrollment_jobs — the enrollment live-status stream
--           (app/api/enrollment-stream/route.ts) still uses Supabase Realtime
--           postgres_changes on enrollment_jobs to push job status updates to
--           the Enrollment page in real time. Removing it would break that UX.
--
--   REMOVED: members, devices, periods, attendance, holidays
--           These were consumed solely by app/api/realtime-stream/route.ts,
--           which is being replaced by lightweight watermark polling (T3f/T3p).
--           The polling endpoint reads institution_activity.last_change_at;
--           the triggers in T3p keep it current without WAL amplification.
--
-- REPLICA IDENTITY FULL is reverted to default for the removed tables.
-- It remains on enrollment_jobs (needed for filtered UPDATE/DELETE events)
-- and is left on holidays (low-write-volume; kept for future use).
--
-- Do NOT auto-apply to cloud; run after review.
-- =====================================================================

-- Remove the high-WAL-cost tables from the realtime publication.
-- alter publication ... drop table is idempotent if the table isn't a member,
-- but Postgres <16 doesn't have IF EXISTS here — wrap in DO to be safe.
do $$
begin
  alter publication supabase_realtime
    drop table if exists
      public.members,
      public.devices,
      public.periods,
      public.attendance,
      public.holidays;
exception
  when undefined_object then null;  -- publication doesn't exist in dev
  when others then null;            -- table already not a member
end $$;

-- Revert REPLICA IDENTITY FULL → default for tables leaving the publication.
-- Default identity only includes the PK in OLD row for UPDATE/DELETE, which
-- is sufficient now that we're no longer filtering server-side on institution_id.
alter table public.members    replica identity default;
alter table public.devices    replica identity default;
alter table public.periods    replica identity default;
alter table public.attendance replica identity default;
alter table public.holidays   replica identity default;

-- enrollment_jobs: keep REPLICA IDENTITY FULL (enrollment-stream filter depends on it)
-- enrollment_jobs: stays in supabase_realtime publication (no change)
