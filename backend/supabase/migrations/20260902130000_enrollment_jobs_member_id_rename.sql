-- =====================================================================
-- enrollment_jobs.student_id -> member_id
-- =====================================================================
-- Migration C (structural_renames) renamed students -> members but left
-- enrollment_jobs.student_id behind — it is a uuid FK to members.id, just
-- misnamed, exactly like attendance.sid was before attendance_renames.
--
-- Metadata-only: Postgres references the FK and any backing index by OID /
-- attribute number, so the rename carries them along. No rows are rewritten.
-- enrollment_jobs is in the realtime publication with replica identity full;
-- a column rename doesn't disturb that (the dashboard's SSE handler doesn't
-- read this column anyway).
--
-- Coordinated with: get-enrollment-job / update-enrollment-job (accept both
-- keys on the wire during the transition) and firmware 1.10.0 (sends /
-- reads member_id, falls back to student_id).
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review,
-- together with the edge-function deploy.
-- =====================================================================

alter table public.enrollment_jobs rename column student_id to member_id;

-- Keep the FK constraint name honest too (guarded — it should exist under this
-- name, but a wrong name must not abort the column rename above).
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'enrollment_jobs_student_id_fkey'
  ) then
    alter table public.enrollment_jobs
      rename constraint enrollment_jobs_student_id_fkey to enrollment_jobs_member_id_fkey;
  end if;
end $$;

comment on column public.enrollment_jobs.member_id is
  'FK to members.id — the member this register / delete job enrols. NULL for '
  'clearall / register-master / delete-master.';
