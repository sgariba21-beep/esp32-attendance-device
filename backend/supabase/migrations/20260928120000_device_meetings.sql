-- =====================================================================
-- Club mode (Phase 4) — ad-hoc meetings opened and closed at the device
-- =====================================================================
-- Purpose:
--   A second master finger (the "session master") opens and closes an
--   ad-hoc meeting at the device, and must work OFFLINE (CLUB-MODE-PLAN.md
--   §8 B). Decided at the start of Phase 4: SELF-DESCRIBING events.
--
--   The device gives each ad-hoc meeting its own id (device_ref) the moment
--   the finger is pressed, online or not. The open press, the close press,
--   AND every scan taken during the meeting all carry that id plus the open
--   time. Whichever of them reaches the server first creates the meeting,
--   so the order the offline queue replays in, retries, and lost replies can
--   neither lose a meeting nor create two:
--
--     meetings.device_ref          the device's id for the meeting
--     device_meeting_event(...)    create-if-missing, and apply a close
--                                  (log-attendance, for open/close events)
--     resolve_device_scan(...)     create-if-missing, then file the scan in
--                                  THAT meeting if its time falls inside it,
--                                  else fall back to resolve_meeting
--     device_meeting_state(...)    what the device's 10 s poll reports:
--                                  club?, auto-close minutes, this device's
--                                  open ad-hoc meeting, the meeting live now
--     close_due_meetings(...)      step (b) becomes a MIDNIGHT BACKSTOP only
--
-- Why the sweep no longer applies the idle rule to device meetings:
--   it closed an ad-hoc meeting at (last scan it had seen + auto-close). An
--   offline device's queued scans are invisible to the server, so a meeting
--   held during an outage was closed early and its later scans rejected on
--   upload (plan §9). The device now enforces the idle rule itself, from its
--   own complete scan history, and reports the close with its own timestamp.
--   The server keeps only the end-of-day backstop, for a device that died
--   mid-meeting; it closes at local midnight, the LATEST moment the device
--   could have closed, so a device close that arrives later always wins
--   (closes only ever move closed_at earlier: least()).
--
-- One ad-hoc meeting per device at a time: a new one implicitly closes an
--   earlier one still open (its close may still be in the device's queue) at
--   the new one's open time, and an event arriving late for an earlier
--   meeting is closed at the later one's open time.
--
-- Also: enrollment_jobs gains register-session-master / delete-session-master.
--
-- Security: SECURITY INVOKER, empty search_path, service_role only (edge
--   functions). Additive except close_due_meetings, replaced in place (only
--   step b changes; there are no device meetings until firmware 1.11.0).
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================


-- 1. meetings.device_ref --------------------------------------------------------
alter table public.meetings
  add column device_ref text
    check (device_ref is null or device_ref ~ '^[A-Za-z0-9-]{4,64}$');

comment on column public.meetings.device_ref is
  'Club mode: the id the device gave an ad-hoc meeting when the session-master '
  'finger opened it. Carried by its open / close events and by every scan taken '
  'during it, so any of them can create the meeting (offline replay, §8 B).';

-- One meeting per device per ref. NULLS DISTINCT (default): scheduled meetings
-- (no ref) are unconstrained, and a deleted device's SET NULL never collides.
alter table public.meetings
  add constraint meetings_device_ref_key unique (device_id, device_ref);


-- 2. Session-master enrollment commands --------------------------------------------
alter table public.enrollment_jobs
  drop constraint enrollment_jobs_command_check;

alter table public.enrollment_jobs
  add constraint enrollment_jobs_command_check
  check (command in ('register', 'delete', 'clearall',
                     'register-master', 'delete-master',
                     'register-session-master', 'delete-session-master'));


-- 3. device_meeting_event ----------------------------------------------------------
create or replace function public.device_meeting_event(
  p_device_id uuid,
  p_ref       text,
  p_opened_at timestamptz,
  p_closed_at timestamptz default null
) returns public.meetings
language plpgsql
set search_path = ''
as $$
declare
  v_inst  uuid;
  v_m     public.meetings;
  v_next  timestamptz;
  v_close timestamptz := p_closed_at;
begin
  if p_device_id is null or p_ref is null or p_opened_at is null then
    return null;
  end if;

  -- Only a device assigned to an active club hosts ad-hoc meetings.
  select i.id into v_inst
    from public.devices d
    join public.institutions i on i.id = d.institution_id
   where d.id = p_device_id
     and i.type = 'club'
     and i.status = 'active';
  if v_inst is null then
    return null;
  end if;

  -- One writer per device at a time: a device retry can overlap the request
  -- it retried, and the implicit-close rules below read then write.
  perform pg_advisory_xact_lock(hashtextextended('device_meeting_event:' || p_device_id::text, 0));

  if v_close is not null and v_close < p_opened_at then
    v_close := p_opened_at;
  end if;

  select * into v_m
    from public.meetings m
   where m.device_id = p_device_id
     and m.device_ref = p_ref;

  if not found then
    -- An earlier ad-hoc meeting of this device still open here: its close is
    -- still on the way. It ended no later than this one began.
    update public.meetings m
       set status = 'closed', closed_at = p_opened_at, ends_at = p_opened_at
     where m.device_id = p_device_id
       and m.origin = 'device'
       and m.status = 'open'
       and m.opened_at < p_opened_at;

    -- A LATER one already here: this event was delayed, and this meeting
    -- ended no later than that one began.
    select min(m.opened_at) into v_next
      from public.meetings m
     where m.device_id = p_device_id
       and m.origin = 'device'
       and m.opened_at > p_opened_at;
    if v_next is not null then
      v_close := least(coalesce(v_close, v_next), v_next);
    end if;

    insert into public.meetings
      (institution_id, device_id, origin, status,
       starts_at, opened_at, closed_at, ends_at, device_ref)
    values
      (v_inst, p_device_id, 'device',
       case when v_close is null then 'open' else 'closed' end,
       p_opened_at, p_opened_at, v_close, v_close, p_ref)
    returning * into v_m;
    return v_m;
  end if;

  -- Known meeting: apply a close. A close only ever moves closed_at EARLIER,
  -- so the order closes arrive in (device, dashboard, midnight backstop,
  -- implicit close) never matters. A cancelled meeting stays cancelled.
  if v_close is not null and v_m.status in ('open', 'closed') then
    update public.meetings m
       set status    = 'closed',
           closed_at = least(coalesce(m.closed_at, v_close), v_close),
           ends_at   = least(coalesce(m.closed_at, v_close), v_close)
     where m.id = v_m.id
    returning * into v_m;
  end if;

  return v_m;
end;
$$;

comment on function public.device_meeting_event(uuid, text, timestamptz, timestamptz) is
  'Club mode: create the device''s ad-hoc meeting p_ref if it does not exist, and '
  'apply a close if p_closed_at is given. Idempotent and order-independent. '
  'NULL if the device is not in an active club.';

revoke execute on function public.device_meeting_event(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.device_meeting_event(uuid, text, timestamptz, timestamptz) to service_role;


-- 4. resolve_device_scan ------------------------------------------------------------
-- A scan that carries a meeting ref belongs to THAT meeting when its time is
-- inside it — even over a scheduled meeting that overlaps, since the device
-- put the member in its ad-hoc meeting explicitly. Otherwise (no ref, or the
-- meeting was closed / cancelled in the dashboard before this scan) it is
-- resolved by timestamp like any other scan.
create or replace function public.resolve_device_scan(
  p_institution_id uuid,
  p_device_id      uuid,
  p_at             timestamptz,
  p_ref            text,
  p_opened_at      timestamptz
) returns setof public.meetings
language plpgsql
set search_path = ''
as $$
declare
  v_m public.meetings;
begin
  if p_ref is not null and p_opened_at is not null and p_device_id is not null then
    select * into v_m from public.device_meeting_event(p_device_id, p_ref, p_opened_at, null);
    if v_m.id is not null
       and v_m.institution_id = p_institution_id
       and v_m.status in ('open', 'closed')
       and v_m.device_deleted_at is null
       and p_at >= v_m.opened_at
       and p_at <= coalesce(v_m.closed_at, 'infinity'::timestamptz) then
      return next v_m;
      return;
    end if;
  end if;

  return query select * from public.resolve_meeting(p_institution_id, p_device_id, p_at);
end;
$$;

comment on function public.resolve_device_scan(uuid, uuid, timestamptz, text, timestamptz) is
  'Club mode: resolve_meeting for a scan that may carry its ad-hoc meeting ref; '
  'creates that meeting if the scan reached the server before its open event.';

revoke execute on function public.resolve_device_scan(uuid, uuid, timestamptz, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.resolve_device_scan(uuid, uuid, timestamptz, text, timestamptz) to service_role;


-- 5. device_meeting_state -------------------------------------------------------------
-- Sent to the device on every 10 s poll (get-enrollment-job). Epoch seconds so
-- the device can compare them with its RTC directly.
--   club           - false for any other tenant type (the device then refuses
--                    the session-master finger)
--   autoclose_min  - the idle rule the DEVICE applies to its ad-hoc meetings
--   open_ref       - this device's ad-hoc meeting the server has open, if any;
--                    lets the device notice a close / cancel from the dashboard
--   live           - the meeting a scan from this device would land in now
--                    (resolve_meeting), for the idle screen and to refuse
--                    opening an ad-hoc meeting over a scheduled one
create or replace function public.device_meeting_state(
  p_device_id uuid,
  p_now       timestamptz default now()
) returns jsonb
language sql stable
set search_path = ''
as $$
  select case
    when i.type <> 'club' then jsonb_build_object('club', false)
    else jsonb_build_object(
      'club',           true,
      'autoclose_min',  i.meeting_autoclose_minutes,
      'open_ref',       o.device_ref,
      'open_opened_at', extract(epoch from o.opened_at)::bigint,
      'live', (
        select jsonb_build_object(
                 'title',     coalesce(r.title, ''),
                 'origin',    r.origin,
                 'ref',       r.device_ref,
                 'starts_at', extract(epoch from r.starts_at)::bigint,
                 'ends_at',   coalesce(extract(epoch from r.ends_at)::bigint, 0))
          from public.resolve_meeting(i.id, d.id, p_now) r
      ))
  end
    from public.devices d
    join public.institutions i on i.id = d.institution_id
    left join lateral (
      select m.device_ref, m.opened_at
        from public.meetings m
       where m.device_id = d.id
         and m.origin = 'device'
         and m.status = 'open'
       order by m.opened_at desc
       limit 1
    ) o on true
   where d.id = p_device_id
$$;

comment on function public.device_meeting_state(uuid, timestamptz) is
  'Club mode: the meeting state a device polls for (see the migration header).';

revoke execute on function public.device_meeting_state(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.device_meeting_state(uuid, timestamptz) to service_role;


-- 6. close_due_meetings: step (b) becomes a midnight backstop ----------------------------
-- Replaces 20260926130300. Only step (b) changes; (a) and (c) are verbatim.
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
  'Club mode sweep (pg_cron, every 15 min): closes due scheduled meetings, '
  'closes ad-hoc device meetings still open at local midnight (backstop), then '
  'writes absences for closed, unprocessed meetings. The only writer of club '
  'absences. p_now is overridable for testing.';

revoke execute on function public.close_due_meetings(timestamptz) from public, anon, authenticated;
grant  execute on function public.close_due_meetings(timestamptz) to service_role;
