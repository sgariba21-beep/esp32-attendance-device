-- =====================================================================
-- Club mode (Phase 2, 1/3) — meeting resolution, close sweep, device guard
-- =====================================================================
-- Purpose:
--   The server-side meeting logic lives in Postgres (CLUB-MODE-PLAN.md §7
--   Phase 2) so it is set-based, transactional, and testable against a
--   replica of the live schema:
--
--     1. resolve_meeting(institution, device, instant)
--          Which meeting a scan at `instant` from `device` belongs to, or no
--          row. Called by log-attendance over RPC for club tenants. Resolves
--          by TIMESTAMP, not "what is open now", so an offline scan flushed
--          days later still lands in the meeting it was taken in.
--
--     2. close_due_meetings(now)
--          The sweep. pg_cron runs it every 15 min (next migration):
--            a. closes scheduled meetings whose window (ends_at + post-roll)
--               has passed;
--            b. closes ad-hoc device meetings at the EARLIER of their idle
--               deadline (last scan + auto-close) and local midnight after
--               they opened — closed_at is that moment, not the sweep time;
--            c. writes absent rows for every closed meeting not yet processed,
--               for club tenants that track absences.
--          It is the ONLY writer of club absences: meetings closed by any
--          path (sweep, dashboard, device) are picked up by (c).
--
--     3. Device-delete guard (BEFORE DELETE ON devices) + meetings.device_deleted_at
--          meetings.device_id is ON DELETE SET NULL, and NULL means "not bound
--          to a device", which resolve_meeting lets ANY device match. Without
--          a guard, deleting a device would turn every meeting it hosted —
--          upcoming, under way, and historic — into one that captures other
--          devices' scans (a late-flushed scan from device B, timestamped
--          inside device A's old meeting, would land there). A deleted device
--          can never authenticate again, so its meetings should match NO scan:
--          the guard stamps device_deleted_at on all of them, and
--          resolve_meeting excludes stamped meetings. It also cancels the
--          device's future scheduled meetings and closes any under way, and
--          marks their absence pass done WITHOUT writing absences — the same
--          delete SET-NULLs members.device_id, so who was expected can no
--          longer be determined. It must be BEFORE DELETE: the SET NULL action
--          runs before any AFTER trigger here could find the meetings.
--
-- Semantics decided in Phase 2:
--   - Scheduled meetings never flip to 'open'. "Live" means the instant is
--     inside the window; status goes scheduled -> closed (or cancelled). Only
--     device meetings use 'open'. No minute-precise cron needed at start time.
--   - A scheduled meeting's window is [starts_at - pre-roll,
--     ends_at + post-roll], cut short at closed_at if it was closed early.
--   - A device meeting's window is [opened_at, closed_at]; no pre/post-roll.
--   - Overlaps (not prevented by the schema) resolve deterministically:
--     bound-to-this-device beats unbound, then a match inside the core
--     window beats a pre/post-roll match, then the latest start.
--   - Who is expected at a meeting: active members of the tracked member
--     types enrolled on the meeting's device (fingerprints live on the
--     sensor, so nobody else can physically scan in); for an unbound meeting,
--     all active tracked members.
--   - absences_written_at means "absence pass done". It is set even when no
--     rows were written (tracking off, tenant inactive), so turning
--     track_absences on later does NOT retroactively flood past meetings.
--   - A tenant whose timezone Postgres does not recognise is skipped by the
--     timezone-dependent steps (b, c) rather than failing the whole sweep.
--
-- Security: SECURITY INVOKER, empty search_path, every reference qualified.
--   EXECUTE revoked from public / anon / authenticated and granted to
--   service_role only (log-attendance). pg_cron runs as the owner.
--
-- Safety: additive only — one nullable column, three functions, one trigger.
--   Nothing calls the functions until log-attendance is redeployed and the
--   cron job is scheduled. The trigger is live on apply, but only touches
--   meetings, and there are none until a club exists.
--   Safe to apply before or after the old dedup key is dropped: the sweep's
--   insert uses a target-less ON CONFLICT DO NOTHING.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================


-- 0. meetings.device_deleted_at ----------------------------------------------
alter table public.meetings
  add column device_deleted_at timestamptz;

comment on column public.meetings.device_deleted_at is
  'Set by the device-delete guard when this meeting''s host device was deleted. '
  'device_id is then NULL but the meeting is NOT institution-wide: '
  'resolve_meeting never matches it.';


-- 1. resolve_meeting --------------------------------------------------------
create or replace function public.resolve_meeting(
  p_institution_id uuid,
  p_device_id      uuid,
  p_at             timestamptz
) returns setof public.meetings
language sql stable
set search_path = ''
as $$
  select m.*
    from public.meetings m
    join public.institutions i on i.id = m.institution_id
   where m.institution_id = p_institution_id
     and m.status in ('scheduled', 'open', 'closed')
     and m.device_deleted_at is null
     and (m.device_id = p_device_id or m.device_id is null)
     and case m.origin
           when 'scheduled' then
                 p_at >= m.starts_at - make_interval(mins => i.meeting_preroll_minutes)
             and p_at <= least(m.ends_at + make_interval(mins => i.meeting_postroll_minutes),
                               coalesce(m.closed_at, 'infinity'::timestamptz))
           else
                 p_at >= coalesce(m.opened_at, m.starts_at)
             and p_at <= coalesce(m.closed_at, 'infinity'::timestamptz)
         end
   order by (m.device_id is not null) desc,
            (p_at >= m.starts_at
             and p_at <= coalesce(m.ends_at, m.closed_at, 'infinity'::timestamptz)) desc,
            m.starts_at desc,
            m.id
   limit 1;
$$;

comment on function public.resolve_meeting(uuid, uuid, timestamptz) is
  'Club mode: the meeting a scan at p_at from p_device_id resolves into, or no '
  'row. By timestamp, so late-flushed offline scans land correctly. See '
  'CLUB-MODE-PLAN.md §5.';

revoke execute on function public.resolve_meeting(uuid, uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.resolve_meeting(uuid, uuid, timestamptz) to service_role;


-- 2. close_due_meetings -------------------------------------------------------
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
           (e.starts_at at time zone e.timezone)::time,
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


-- 3. Device-delete guard ------------------------------------------------------
create or replace function public.meetings_release_deleted_device()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Mid-cascade from DELETE FROM institutions: the parent row is already gone,
  -- the meetings are about to be cascade-deleted too, and updating them would
  -- fail meetings_institution_id_fkey. Same guard as
  -- 20260904120000_touch_institution_activity_skip_deleted_institution.sql.
  -- (Also covers unassigned devices: NULL institution_id, no meetings.)
  if not exists (select 1 from public.institutions where id = old.institution_id) then
    return old;
  end if;

  -- One UPDATE; every CASE reads the row's pre-update values.
  --   not started yet            -> cancelled
  --   under way / awaiting sweep -> closed now (device meetings also get ends_at)
  --   already closed / cancelled -> status kept
  -- All: stamped device_deleted_at, and absence pass marked done unwritten.
  update public.meetings
     set device_deleted_at   = now(),
         status              = case
                                 when status = 'scheduled' and starts_at > now() then 'cancelled'
                                 when status in ('scheduled', 'open')            then 'closed'
                                 else status
                               end,
         closed_at           = case
                                 when status = 'scheduled' and starts_at > now() then closed_at
                                 when status in ('scheduled', 'open')            then now()
                                 else closed_at
                               end,
         ends_at             = case
                                 when origin = 'device' and status = 'open' then greatest(now(), starts_at)
                                 else ends_at
                               end,
         absences_written_at = coalesce(absences_written_at, now())
   where device_id = old.id;

  return old;
end;
$$;

revoke execute on function public.meetings_release_deleted_device() from public, anon, authenticated;

create trigger trg_meetings_release_deleted_device
before delete on public.devices
for each row execute function public.meetings_release_deleted_device();
