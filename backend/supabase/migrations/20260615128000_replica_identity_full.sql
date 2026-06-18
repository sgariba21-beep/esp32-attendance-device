-- =====================================================================
-- H2/M10 support — REPLICA IDENTITY FULL on realtime-watched tables
-- =====================================================================
-- The SSE streams now apply a server-side realtime filter (institution_id=eq.<id>)
-- so a tenant only receives its own changes. For UPDATE/DELETE events the "old"
-- row otherwise contains only the primary key, so a filter on institution_id
-- would drop those events. REPLICA IDENTITY FULL includes the full old row so the
-- filter matches inserts, updates AND deletes.
--
-- Write overhead is negligible at this workload (these tables are
-- insert-heavy / rarely updated or deleted).
-- =====================================================================

alter table public.members        replica identity full;
alter table public.devices        replica identity full;
alter table public.periods        replica identity full;
alter table public.attendance     replica identity full;
alter table public.enrollment_jobs replica identity full;
alter table public.holidays       replica identity full;
