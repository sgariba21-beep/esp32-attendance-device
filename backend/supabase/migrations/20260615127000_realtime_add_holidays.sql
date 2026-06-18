-- =====================================================================
-- M10 (realtime) — Add holidays to the realtime publication
-- =====================================================================
-- holidays was never added to supabase_realtime, so the Academic page did not
-- live-update when a holiday was added/removed. Add it. Idempotent.
-- =====================================================================

do $$
begin
  alter publication supabase_realtime add table public.holidays;
exception
  when duplicate_object then null;
  when others then null;  -- already a member / publication shape differences
end $$;
