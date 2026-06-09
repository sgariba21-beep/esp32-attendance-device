-- Reschedule mark-absent using hardcoded local dev values instead of current_setting().
-- The service role key below is the well-known Supabase CLI default (same for every local project).
-- The URL uses the internal Docker network name — postgres cannot reach localhost:54321.
select cron.schedule(
  'mark-absent-daily',
  '0 15 * * *',
  $$
  select net.http_post(
    url := 'http://supabase_kong_backend:8000/functions/v1/mark-absent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hj04zWl196z2-SBc0'
    ),
    body := '{}'::jsonb
  );
  $$
);
