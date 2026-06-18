-- Fix mark-absent cron auth: replace Authorization header with x-cron-secret.
-- Kong strips the Authorization header before it reaches edge functions even when
-- verify_jwt = false, so the old Bearer token check always returned 401.
--
-- H8 (secret hygiene): the cron secret is NO LONGER hardcoded here. This local-dev
-- schedule reads it from a Postgres custom setting so no secret enters git history.
-- The cloud schedule is defined by 20260614120000_fix_mark_absent_cron_cloud.sql,
-- which reads both URL and secret from vault.decrypted_secrets.
--
-- Before running locally, set the secret for the session/db, e.g.:
--   alter database postgres set app.cron_secret = '<your-local-cron-secret>';
-- The matching value must be set as the CRON_SECRET env on the mark-absent function.
select cron.unschedule('mark-absent-daily');

select cron.schedule(
  'mark-absent-daily',
  '0 15 * * *',
  $$
  select net.http_post(
    url := 'http://supabase_kong_backend:8000/functions/v1/mark-absent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
