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
-- ALTER PUBLICATION ... DROP TABLE has no IF EXISTS variant in any Postgres version.
-- Guard with pg_publication_tables so this migration is safe to re-run and works
-- in dev environments where the table was never added to the publication.
do $$
declare
  tbl text;
begin
  foreach tbl in array array['members', 'devices', 'periods', 'attendance', 'holidays']
  loop
    if exists (
      select 1 from pg_publication_tables
       where pubname     = 'supabase_realtime'
         and schemaname  = 'public'
         and tablename   = tbl
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', tbl);
    end if;
  end loop;
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
