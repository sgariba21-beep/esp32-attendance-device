-- =====================================================================
-- Club mode — a meeting no one scanned in for was not held
-- =====================================================================
-- Purpose:
--   The close sweep marked every expected member absent for EVERY closed
--   meeting, including ones nobody scanned in for: a scheduled meeting that
--   didn't take place (holiday, called off, device left at home) or an ad-hoc
--   meeting opened at the device by mistake. Every member then carried an
--   absence for a meeting that never happened, dragging their rate down.
--
--   Rule: a closed meeting without a single present scan was not held. The
--   sweep flags it (meetings.not_held) and writes no absences for it. It
--   still counts as processed (absences_written_at is set), so step (c) does
--   not pick it up again on every run.
--
-- Late scans (offline devices):
--   A device that was offline during the meeting uploads its queued scans
--   later, possibly days after the sweep flagged the meeting. New step (c0)
--   re-arms a not-held meeting that has since gained a present scan
--   (not_held = false, absences_written_at = null), and step (c) of the same
--   run then writes its absences. In the sweep rather than in a trigger on
--   attendance: a trigger firing while a sweep is deciding cannot see that
--   sweep's verdict yet, and the sweep's snapshot cannot see the new scan,
--   so the meeting would stay "not held" for good; the next sweep always
--   sees both. No slower either: only the sweep writes club absences.
--
-- Unchanged: cancelling a meeting is still how an admin says "this didn't
--   happen" for a meeting someone DID scan in for (cancelled meetings are
--   never processed). Steps (a) and (b) are verbatim from 20260928120000.
--
-- Cost: (c0) reads closed, not-held meetings (a few per club) and probes
--   attendance_meeting_member_scan_type_key, which leads with meeting_id.
--
-- Rollout: apply BEFORE deploying the dashboard that selects
--   meetings.not_held (PostgREST rejects a select of an unknown column, and
--   the Meetings page and club overview would load nothing).
--   20261116120100 (optional) applies the rule to meetings already processed.
--
-- Security: unchanged — SECURITY INVOKER, empty search_path, service_role only.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================


-- 1. meetings.not_held ------------------------------------------------------------
-- Constant default: a metadata-only change, no table rewrite.
alter table public.meetings
  add column not_held boolean not null default false;

comment on column public.meetings.not_held is
  'Club mode: set by the close sweep when a closed meeting had no present scan '
  'at all. It was not held, so no absences were written for it. Cleared, and '
  'absences written, by the next sweep if a late (offline) scan for it arrives.';


-- 2. close_due_meetings: skip absences for meetings no one scanned in for -----------
-- Replaces 20260928120000. Steps (a) and (b) are verbatim; (c0) is new; (c)
-- gains the held check and sets not_held.
create or replace function public.close_due_meetings(p_now timestamptz default now())
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_scheduled integer := 0;
  v_device    integer := 0;
  v_rearmed   integer := 0;
  v_absent    integer := 0;
  v_not_held  integer := 0;
begin
  -- a. Scheduled meetings whose acceptance window has ended.
  with due as (
    update public.meetings m
       set status = 'closed', closed_at = p_now
      from public.institutions i
     where i.id = m.institution_id
       and m.origin = 'scheduled'
       and m.status in ('scheduled', 'open')
       and m.ends_at + make_interval(mins => i.meeting_postroll_minutes) <= p_now
    returning 1
  )
  select count(*) into v_scheduled from due;

  -- b. Ad-hoc device meetings: BACKSTOP only, at local midnight after opening,
  --    once that has passed. The device closes its own meetings (second
  --    press, or its idle rule) and reports when; the server cannot apply the
  --    idle rule, because an offline device's queued scans are invisible to
  --    it. Midnight is the latest the device could have closed, so a device
  --    close arriving later still wins (it only moves closed_at earlier).
  --    MATERIALIZED: as a plain subquery the planner flattens it into the
  --    UPDATE, and may then evaluate the AT TIME ZONE before the timezone
  --    filter — one tenant with an unknown zone would fail the whole sweep.
  with backstop as materialized (
    select m2.id,
           (date_trunc('day', coalesce(m2.opened_at, m2.starts_at) at time zone i.timezone)
              + interval '1 day') at time zone i.timezone as close_at
      from public.meetings m2
      join public.institutions i on i.id = m2.institution_id
     where m2.origin = 'device'
       and m2.status = 'open'
       and exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = i.timezone)
  ),
  due as (
    update public.meetings m
       set status = 'closed', closed_at = b.close_at, ends_at = b.close_at
      from backstop b
     where b.id = m.id
       and b.close_at <= p_now
    returning 1
  )
  select count(*) into v_device from due;

  -- c0. A meeting flagged not held that has since gained a present scan (an
  --     offline device's queue, uploaded late) was held after all: hand it
  --     back to step (c), which writes its absences in this same run.
  with rearmed as (
    update public.meetings m
       set not_held = false, absences_written_at = null
     where m.not_held
       and m.status = 'closed'
       and exists (select 1 from public.attendance a
                    where a.meeting_id = m.id
                      and a.status = 'present')
    returning 1
  )
  select count(*) into v_rearmed from rearmed;

  -- c. Absence pass for every closed meeting not yet processed (including the
  --    ones closed or re-armed above: each statement here sees the earlier
  --    ones' writes). A meeting no one scanned in for (held = false) was not
  --    held: it is flagged and gets no absences. The arrival scan type
  --    follows the member type's scan mode, as mark-absent does.
  --    Target-less ON CONFLICT DO NOTHING tolerates a re-run and any unique
  --    key, old or new.
  with pending as (
    select m.id, m.institution_id, m.device_id, m.starts_at,
           i.timezone, i.type, i.status as inst_status, i.track_absences,
           i.track_students, i.track_staff, i.student_scan_mode, i.staff_scan_mode,
           exists (select 1 from public.attendance a
                    where a.meeting_id = m.id
                      and a.status = 'present') as held
      from public.meetings m
      join public.institutions i on i.id = m.institution_id
     where m.status = 'closed'
       and m.absences_written_at is null
       and exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = i.timezone)
  ),
  expected as (
    select p.id as meeting_id, p.institution_id, p.starts_at, p.timezone,
           coalesce(p.device_id, mem.device_id) as device_id,
           mem.id as member_id,
           case when (mem.member_type = 'staff'   and p.staff_scan_mode   = 'time_in_out')
                  or (mem.member_type = 'student' and p.student_scan_mode = 'time_in_out')
                then 'time_in' else 'present' end as scan_type
      from pending p
      join public.members mem on mem.institution_id = p.institution_id
     where p.held
       and p.type = 'club'
       and p.track_absences
       and p.inst_status = 'active'
       and mem.status = 'active'
       and ((mem.member_type = 'student' and p.track_students)
         or (mem.member_type = 'staff'   and p.track_staff))
       and (p.device_id is null or mem.device_id = p.device_id)
  ),
  ins as (
    insert into public.attendance
      (member_id, institution_id, device_id, meeting_id, period_id,
       date, "time", status, scan_type, scan_id)
    select e.member_id, e.institution_id, e.device_id, e.meeting_id, null,
           (e.starts_at at time zone e.timezone)::date,
           date_trunc('second', e.starts_at at time zone e.timezone)::time,
           'absent', e.scan_type, null
      from expected e
     where not exists (
             select 1 from public.attendance a
              where a.meeting_id = e.meeting_id
                and a.member_id  = e.member_id
                and a.scan_type  = e.scan_type
                and a.status     = 'present')
    on conflict do nothing
    returning 1
  ),
  done as (
    update public.meetings m
       set absences_written_at = p_now,
           not_held            = not p.held
      from pending p
     where p.id = m.id
    returning m.not_held
  )
  select (select count(*) from ins),
         (select count(*) from done where done.not_held)
    into v_absent, v_not_held;

  return jsonb_build_object(
    'closed_scheduled', v_scheduled,
    'closed_device',    v_device,
    'rearmed',          v_rearmed,
    'absences_written', v_absent,
    'not_held',         v_not_held
  );
end;
$$;

comment on function public.close_due_meetings(timestamptz) is
  'Club mode sweep (pg_cron, every 15 min): closes due scheduled meetings, '
  'closes ad-hoc device meetings still open at local midnight (backstop), then '
  'writes absences for closed, unprocessed meetings — except a meeting no one '
  'scanned in for, which is flagged not held instead (and re-armed if a late '
  'scan arrives). The only writer of club absences. p_now is overridable for '
  'testing.';

revoke execute on function public.close_due_meetings(timestamptz) from public, anon, authenticated;
grant  execute on function public.close_due_meetings(timestamptz) to service_role;
