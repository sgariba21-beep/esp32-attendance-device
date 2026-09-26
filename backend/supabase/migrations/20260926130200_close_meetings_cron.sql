-- =====================================================================
-- Club mode (Phase 2, 3/3) — schedule the meeting close sweep
-- =====================================================================
-- Runs public.close_due_meetings() every 15 minutes, directly in the database
-- (no edge function, no pg_net hop, no cron secret — unlike mark-absent,
-- whose logic lives in TypeScript). Each run is one transaction; its jsonb
-- summary lands in cron.job_run_details.return_message.
--
-- Cadence: 15 min bounds how late a meeting's absences appear. It does not
-- affect which scans a meeting accepts — resolve_meeting works from the
-- meeting's own window and closed_at, so a slow sweep never admits or
-- rejects a scan it should not.
--
-- Idempotent: cron.schedule with an existing job name updates that job.
--
-- Apply AFTER 20260926130000 (the function) and 20260926130100 (old key
-- dropped).
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

select cron.schedule(
  'close-meetings',
  '*/15 * * * *',
  $$select public.close_due_meetings()$$
);
