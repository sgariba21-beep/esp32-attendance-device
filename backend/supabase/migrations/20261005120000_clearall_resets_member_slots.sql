-- =====================================================================
-- enrollment_jobs — a completed "clear all" frees its members' slots
-- =====================================================================
-- Problem:
--   members.fin1 / fin2 hold the sensor slot of each enrolled finger; the
--   dashboard shows a finger as enrolled while its slot is > 0, and the
--   enrollment page's overwrite check treats the slot as taken.
--   update-enrollment-job only ever wrote them for register (set the slot)
--   and delete (zero it). A "clearall" job wipes the whole sensor AND the
--   device's fid map, but its completion report names no member, so nothing
--   was reset: every member of the device still showed as enrolled, in slots
--   that were in fact empty — and deleting such a finger then failed with
--   "not-found", because the device no longer knew it either.
--
-- Fix: reset_slots_after_clearall(job) — called by update-enrollment-job when
--   a clearall job completes — zeroes fin1 / fin2 for the device's members.
--
-- Ordering: the device queues a failed report and retries it later
--   (flushEnrollReports), so the clearall report can arrive AFTER the device
--   has already re-enrolled someone. A slot is therefore left alone when a
--   completed register job for that member + finger on this device was handed
--   to the device after the wipe was (dispatched_at, falling back to
--   created_at for rows older than 20260902120000). Jobs are dispatched one at
--   a time, oldest first, so "dispatched after the clearall" means "enrolled
--   after the wipe". A re-delivered clearall (stuck in_progress, run again)
--   has a newer dispatched_at, and anything enrolled before that second run
--   really was wiped by it.
--
-- Security: SECURITY INVOKER, empty search_path, service_role only.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

create or replace function public.reset_slots_after_clearall(p_job_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_job   public.enrollment_jobs;
  v_wiped timestamptz;
  v_reset integer := 0;
begin
  select * into v_job from public.enrollment_jobs where id = p_job_id;
  if not found or v_job.command <> 'clearall' or v_job.device_id is null then
    return 0;
  end if;
  v_wiped := coalesce(v_job.dispatched_at, v_job.created_at);

  with kept as (
    -- slots re-enrolled on this device after the wipe
    select r.member_id, r.finger_slot
      from public.enrollment_jobs r
     where r.device_id = v_job.device_id
       and r.command = 'register'
       and r.status = 'completed'
       and coalesce(r.dispatched_at, r.created_at) > v_wiped
  ),
  upd as (
    update public.members m
       set fin1 = case when m.fin1 > 0 and not exists
                         (select 1 from kept k where k.member_id = m.id and k.finger_slot = 'fin1')
                       then 0 else m.fin1 end,
           fin2 = case when m.fin2 > 0 and not exists
                         (select 1 from kept k where k.member_id = m.id and k.finger_slot = 'fin2')
                       then 0 else m.fin2 end
     where m.device_id = v_job.device_id
       and m.institution_id = v_job.institution_id
       and (   (m.fin1 > 0 and not exists (select 1 from kept k where k.member_id = m.id and k.finger_slot = 'fin1'))
            or (m.fin2 > 0 and not exists (select 1 from kept k where k.member_id = m.id and k.finger_slot = 'fin2')))
    returning 1
  )
  select count(*) into v_reset from upd;

  return v_reset;
end;
$$;

comment on function public.reset_slots_after_clearall(uuid) is
  'Zero members.fin1 / fin2 on a clearall job''s device, except slots '
  're-enrolled after the wipe. Returns the number of members updated.';

revoke execute on function public.reset_slots_after_clearall(uuid) from public, anon, authenticated;
grant  execute on function public.reset_slots_after_clearall(uuid) to service_role;
