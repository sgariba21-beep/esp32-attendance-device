-- =====================================================================
-- enrollment_jobs — dispatch tracking + stuck-job self-healing
-- =====================================================================
-- Problem:
--   get-enrollment-job flips a job pending -> in_progress when it hands it to
--   a device, but nothing ever moves it out of in_progress again. The device
--   reports completion fire-and-forget with no retry, so any lost
--   update-enrollment-job POST (flaky TLS, a reboot between storeModel() and
--   the POST) strands the row at in_progress forever — even though the member
--   can already scan, because log-attendance resolves scans by members.sid,
--   never by fin1/fin2.
--
-- Fix (this migration + get-enrollment-job / update-enrollment-job):
--   * dispatched_at / attempts — so get-enrollment-job can RE-DELIVER a job
--     that has sat in_progress past a timeout (device rebooted, ack lost) and
--     give up after a bounded number of tries.
--   * last_error — surfaced on the dashboard's stuck/failed rows.
--   * enrollment_jobs_status_guard — completed / failed are terminal. A late
--     in_progress write from a raced get-enrollment-job (its CAS also guards
--     this, belt-and-suspenders) can never pull a finished job backwards.
--
-- Safety:
--   Additive columns with neutral defaults; existing rows read as
--   attempts = 0, dispatched_at / last_error NULL. The trigger only blocks a
--   status transition OUT of a terminal state — every current code path
--   either creates a pending row or moves pending/in_progress forward, so
--   nothing changes behaviour on apply. Fully reversible.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

alter table public.enrollment_jobs
  add column dispatched_at timestamptz,
  add column attempts      smallint not null default 0,
  add column last_error    text;

comment on column public.enrollment_jobs.dispatched_at is
  'When get-enrollment-job last handed this job to the device. Used to detect '
  'a job stuck in_progress (lost completion ack) and re-deliver it.';
comment on column public.enrollment_jobs.attempts is
  'How many times get-enrollment-job has dispatched this job. Capped — past '
  'the cap the job is auto-failed with last_error rather than retried forever.';
comment on column public.enrollment_jobs.last_error is
  'Most recent failure note (device "failed" report, or "exceeded max dispatch '
  'attempts"). Shown on the enrollment page for failed / stuck jobs.';

-- completed / failed are terminal. Ignore any attempt to change the status of
-- a job that has already finished (a duplicate device report, or a delayed
-- in_progress write racing a completion) — keep the terminal status, let other
-- columns (note / fid / last_error) still update so a late report isn't lost.
create or replace function public.enrollment_jobs_status_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('completed', 'failed')
     and new.status is distinct from old.status then
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger enrollment_jobs_status_guard
  before update on public.enrollment_jobs
  for each row
  execute function public.enrollment_jobs_status_guard();
