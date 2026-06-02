-- Enable pg_cron extension
create extension if not exists pg_cron;

-- Schedule mark-absent function to run at 11PM every day
select cron.schedule(
  'mark-absent-daily',
  '0 23 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/mark-absent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);