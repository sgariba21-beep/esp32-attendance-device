-- =====================================================================
-- Club mode (Phase 3, 2/2) — keep the schedule horizon rolling
-- =====================================================================
-- Runs public.generate_scheduled_meetings() once a day, in-database, so every
-- active schedule always has ~8 weeks of meetings ahead of it. Daily is
-- ample for a 56-day horizon; the dashboard also generates a new schedule's
-- first occurrences immediately when it is created.
--
-- 00:10 UTC, clear of mark-absent-daily (21:00) and aligned with nothing
-- else. Idempotent: cron.schedule with an existing job name updates it.
--
-- Apply AFTER 20260926140000.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

select cron.schedule(
  'generate-meetings',
  '10 0 * * *',
  $$select public.generate_scheduled_meetings()$$
);
