-- Reschedule mark-absent to run at 3:00 PM (UTC) every day
select cron.schedule(
  'mark-absent-daily',
  '0 15 * * *',
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
