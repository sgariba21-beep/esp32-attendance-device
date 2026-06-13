-- Allow 'register-master' as a valid enrollment job command
ALTER TABLE enrollment_jobs
  DROP CONSTRAINT enrollment_jobs_command_check;

ALTER TABLE enrollment_jobs
  ADD CONSTRAINT enrollment_jobs_command_check
  CHECK (command IN ('register', 'delete', 'clearall', 'register-master'));
