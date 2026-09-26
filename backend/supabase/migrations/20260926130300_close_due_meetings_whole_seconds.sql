-- =====================================================================
-- Club mode (Phase 2 fix) — close_due_meetings writes whole-second times
-- =====================================================================
-- Found by the live test after deploy: the sweep's absent rows took
-- attendance."time" straight from the meeting's starts_at, so a start with
-- sub-second precision (anything built from now(), or any client that sends
-- milliseconds) produced times like 21:09:49.949243. Every other attendance
-- row is whole seconds (log-attendance formats HH:MM:SS), and the fraction
-- leaks into the dashboard and CSV exports.
--
-- Only change from 20260926130000: the absent row's time is
--   date_trunc('second', e.starts_at at time zone e.timezone)::time
-- (truncated, not rounded, so it never moves past the meeting start).
-- The function is otherwise identical and is replaced in place.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

create or replace function public.close_due_meetings(p_now timestamptz default now())
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_scheduled integer := 0;
  v_device    integer := 0;
  v_absent    integer := 0;
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

  -- b. Ad-hoc device meetings: close at the earlier of the idle deadline and
  --    local midnight after opening, once that moment has passed. Scan times
  --    come from attendance's local date + time, read back in the tenant's
  --    timezone.
  with activity as (
    select m.id,
           least(
             greatest(coalesce(m.opened_at, m.starts_at),
                      coalesce(max((a.date + a."time") at time zone i.timezone),
                               '-infinity'::timestamptz))
               + make_interval(mins => i.meeting_autoclose_minutes),
             (date_trunc('day', coalesce(m.opened_at, m.starts_at) at time zone i.timezone)
               + interval '1 day') at time zone i.timezone
           ) as close_at
      from public.meetings m
      join public.institutions i on i.id = m.institution_id
      left join public.attendance a on a.meeting_id = m.id and a.status = 'present'
     where m.origin = 'device'
       and m.status = 'open'
       and exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = i.timezone)
     group by m.id, m.opened_at, m.starts_at, i.timezone, i.meeting_autoclose_minutes
  ),
  due as (
    update public.meetings m
       set status = 'closed', closed_at = act.close_at, ends_at = act.close_at
      from activity act
     where act.id = m.id
       and act.close_at <= p_now
    returning 1
  )
  select count(*) into v_device from due;

  -- c. Absence pass for every closed meeting not yet processed (including the
  --    ones closed above: this statement sees their new status). The
  --    arrival scan type follows the member type's scan mode, as mark-absent
  --    does. Target-less ON CONFLICT DO NOTHING tolerates a re-run and any
  --    unique key, old or new.
  with pending as (
    select m.id, m.institution_id, m.device_id, m.starts_at,
           i.timezone, i.type, i.status as inst_status, i.track_absences,
           i.track_students, i.track_staff, i.student_scan_mode, i.staff_scan_mode
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
     where p.type = 'club'
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
       set absences_written_at = p_now
      from pending p
     where p.id = m.id
    returning 1
  )
  select count(*) into v_absent from ins;

  return jsonb_build_object(
    'closed_scheduled', v_scheduled,
    'closed_device',    v_device,
    'absences_written', v_absent
  );
end;
$$;

comment on function public.close_due_meetings(timestamptz) is
  'Club mode sweep (pg_cron, every 15 min): closes due scheduled and ad-hoc '
  'meetings, then writes absences for closed, unprocessed meetings. The only '
  'writer of club absences. p_now is overridable for testing.';

revoke execute on function public.close_due_meetings(timestamptz) from public, anon, authenticated;
grant  execute on function public.close_due_meetings(timestamptz) to service_role;
