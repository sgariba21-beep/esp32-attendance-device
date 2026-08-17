-- =====================================================================
-- Follow-up to 20260817120000_institution_activity_rls.sql
-- =====================================================================
-- Making touch_institution_activity() SECURITY DEFINER (to keep the
-- watermark trigger working regardless of RLS on institution_activity)
-- makes Postgres auto-grant EXECUTE to PUBLIC, which the Supabase linter
-- flags as anon/authenticated being able to call it directly via
-- /rest/v1/rpc/touch_institution_activity. It's a `returns trigger`
-- function -- Postgres refuses to run it outside trigger context either
-- way -- but it shouldn't carry a public EXECUTE grant regardless.
--
-- Trigger firing is unaffected: AFTER triggers invoke their function
-- directly, not through the firing session's EXECUTE privilege.
-- =====================================================================

revoke execute on function public.touch_institution_activity() from public, anon, authenticated;
