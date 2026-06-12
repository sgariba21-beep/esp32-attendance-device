-- Fix mark-absent cron auth: replace Authorization header with x-cron-secret.
-- Kong strips the Authorization header before it reaches edge functions even when
-- verify_jwt = false, so the old Bearer token check always returned 401.
select cron.unschedule('mark-absent-daily');

select cron.schedule(
  'mark-absent-daily',
  '0 15 * * *',
  $$
  select net.http_post(
    url := 'http://supabase_kong_backend:8000/functions/v1/mark-absent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'olag-cron-secret-2026'
    ),
    body := '{}'::jsonb
  );
  $$
);
