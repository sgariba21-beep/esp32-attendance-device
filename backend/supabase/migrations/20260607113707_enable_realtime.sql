-- Enable Supabase Realtime postgres_changes for all tables that the dashboard watches.
-- Without this, channels connect successfully but never receive INSERT/UPDATE/DELETE events.
ALTER PUBLICATION supabase_realtime
  ADD TABLE students, devices, academic, attendance, enrollment_jobs;
