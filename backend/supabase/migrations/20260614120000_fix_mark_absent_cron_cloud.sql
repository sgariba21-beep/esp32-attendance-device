-- Override 20260612120000_fix_mark_absent_cron_auth.sql for cloud Supabase.
-- supabase_kong_backend is a Docker-internal hostname that does not exist in cloud.
-- Both the project URL and cron secret are read from vault.decrypted_secrets at cron
-- fire time, so no credentials appear in migration history.
--
-- Prerequisites (run before the first scheduled execution at 15:00 UTC):
--   supabase db execute --project-ref <ref> \
--     "select vault.create_secret('https://<ref>.supabase.co', 'supabase_project_url');"
--   supabase db execute --project-ref <ref> \
--     "select vault.create_secret('<your-cron-secret>', 'cron_secret');"

select cron.unschedule('mark-absent-daily');

select cron.schedule(
  'mark-absent-daily',
  '0 21 * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'supabase_project_url'
    ) || '/functions/v1/mark-absent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
