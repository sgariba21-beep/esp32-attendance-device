-- =====================================================================
-- Club mode (Phase 3, 1/2) — recurring meeting schedules
-- =====================================================================
-- Purpose:
--   A schedule is a recurrence rule ("every Saturday 10:00 for 2 hours",
--   "1st Monday of the month") that is MATERIALISED into ordinary rows in
--   public.meetings ~8 weeks ahead. Attendance carries a real FK to meetings,
--   so occurrences cannot be computed on the fly (CLUB-MODE-PLAN.md §4.2).
--
--     meeting_schedules          the rule
--     meetings.schedule_id       which rule generated an occurrence
--     generate_scheduled_meetings(schedule?, now?, horizon_days?)
--                                materialise occurrences (pg_cron daily, and
--                                the dashboard right after creating a schedule)
--     end_meeting_schedule(schedule, now?)
--                                stop a rule: deactivate it, delete its future
--                                occurrences (cancel any that already hold a
--                                scan), leave past and in-progress ones alone
--
-- Deliberately NOT full RRULE: weekly / every-N-weeks / monthly-nth-weekday
-- (incl. "last") cover real club schedules. Schedules are not editable —
-- end one and create another — so no generated meeting is ever silently
-- rewritten under attendance that already hangs off it.
--
-- Semantics:
--   - Times are LOCAL to the institution: (day + start_time) AT TIME ZONE tz,
--     so a "10:00 Saturday" meeting stays 10:00 across DST changes.
--   - Every-N-weeks is phased from the first matching weekday on/after
--     starts_on. Monthly schedules are always every month (interval_n = 1).
--   - Nothing is generated before "today" in the institution's timezone, nor
--     past ends_on, nor beyond today + horizon (default 56 days), nor any
--     occurrence that has already ended (an in-progress one IS generated).
--   - generated_through records the last local date processed, so a run never
--     re-creates an occurrence someone DELETED (the dashboard's "skip this
--     one"). ON CONFLICT (schedule_id, starts_at) makes overlapping runs safe.
--   - Not generated for non-active tenants, nor for a tenant whose timezone
--     Postgres does not recognise (skipped, never an error).
--   - Overlaps with other meetings are NOT checked here; resolve_meeting
--     resolves them deterministically, and the dashboard checks one-offs.
--
-- Deleting a device: device_id is ON DELETE SET NULL, and the Phase 2 device
--   guard (replaced below) now also DEACTIVATES the device's schedules before
--   the delete. A bare SET NULL would turn a schedule into an UNBOUND one that
--   keeps generating meetings any device could scan into — the trap the guard
--   already closes for meetings. ON DELETE CASCADE was tried and rejected: it
--   deletes the schedule mid-statement, and the meetings.device_id SET NULL
--   that fires alongside it then re-checks meetings.schedule_id against the
--   already-deleted schedule and fails (reproduced in the PGlite tests).
--
-- Security: RLS + policy + explicit grants in this file (see 20260926120100).
--   Functions are SECURITY INVOKER, empty search_path, service_role only.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================


-- 1. Table ------------------------------------------------------------------
create table public.meeting_schedules (
  id                uuid primary key default gen_random_uuid(),
  institution_id    uuid not null references public.institutions(id) on delete cascade,
  device_id         uuid references public.devices(id) on delete set null,
  title             text
                      check (title is null or char_length(btrim(title)) between 1 and 120),
  freq              text not null
                      check (freq in ('weekly', 'monthly_nth_weekday')),
  interval_n        smallint not null default 1
                      check (interval_n between 1 and 12),
  weekday           smallint not null
                      check (weekday between 1 and 7),          -- ISO: 1 = Mon … 7 = Sun
  nth               smallint
                      check (nth in (1, 2, 3, 4, -1)),           -- monthly only; -1 = last
  start_time        time not null,                              -- local to the institution
  duration_minutes  integer not null
                      check (duration_minutes between 5 and 1440),
  starts_on         date not null,
  ends_on           date,
  active            boolean not null default true,
  generated_through date,
  created_at        timestamptz not null default now(),

  constraint meeting_schedules_monthly_has_nth
    check (freq <> 'monthly_nth_weekday' or nth is not null),
  constraint meeting_schedules_weekly_no_nth
    check (freq <> 'weekly' or nth is null),
  constraint meeting_schedules_monthly_every_month
    check (freq <> 'monthly_nth_weekday' or interval_n = 1),
  constraint meeting_schedules_ends_after_start
    check (ends_on is null or ends_on >= starts_on)
);

comment on table public.meeting_schedules is
  'Club mode: a recurrence rule materialised into meetings ~8 weeks ahead by '
  'generate_scheduled_meetings(). Not editable: end it and create another.';

create index meeting_schedules_institution_idx on public.meeting_schedules (institution_id);
create index meeting_schedules_device_id_idx   on public.meeting_schedules (device_id);


-- 2. meetings.schedule_id -----------------------------------------------------
alter table public.meetings
  add column schedule_id uuid references public.meeting_schedules(id) on delete set null;

comment on column public.meetings.schedule_id is
  'The schedule that generated this occurrence; NULL for one-off and ad-hoc '
  'meetings, or once the schedule is deleted.';

-- One occurrence per schedule per start. NULLS DISTINCT (default), so one-off
-- meetings are unconstrained. Leading with schedule_id also serves the FK.
alter table public.meetings
  add constraint meetings_schedule_starts_at_key unique (schedule_id, starts_at);


-- 3. RLS (dormant defence-in-depth), grants, watermark --------------------------
alter table public.meeting_schedules enable row level security;

create policy "meeting_schedules_admin_all" on public.meeting_schedules
  for all to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  )
  with check (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  );

grant select, insert, update, delete on public.meeting_schedules to service_role;
grant select, insert, update, delete on public.meeting_schedules to authenticated;

create trigger trg_activity_meeting_schedules
after insert or update or delete on public.meeting_schedules
for each row execute function public.touch_institution_activity();


-- 4. generate_scheduled_meetings -----------------------------------------------
create or replace function public.generate_scheduled_meetings(
  p_schedule_id  uuid        default null,
  p_now          timestamptz default now(),
  p_horizon_days integer     default 56
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_created integer := 0;
begin
  with sched as (
    select s.*, i.timezone,
           (p_now at time zone i.timezone)::date as today_local
      from public.meeting_schedules s
      join public.institutions i on i.id = s.institution_id
     where s.active
       and (p_schedule_id is null or s.id = p_schedule_id)
       and i.status = 'active'
       and exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = i.timezone)
  ),
  occurrences as (
    select s.id as schedule_id, s.institution_id, s.device_id, s.title, s.timezone,
           s.start_time, s.duration_minutes, d::date as day
      from sched s
     cross join lateral generate_series(
             greatest(s.starts_on,
                      coalesce(s.generated_through + 1, s.starts_on),
                      s.today_local),
             least(coalesce(s.ends_on, 'infinity'::date),
                   s.today_local + p_horizon_days),
             interval '1 day') as d
     where extract(isodow from d)::int = s.weekday
       and case s.freq
             when 'weekly' then
               -- weeks since the first matching weekday on/after starts_on
               ((d::date - (s.starts_on + ((s.weekday - extract(isodow from s.starts_on)::int + 7) % 7))) / 7)
                 % s.interval_n = 0
             else
               case when s.nth = -1
                    then extract(month from d + interval '7 days') <> extract(month from d)
                    else (extract(day from d)::int - 1) / 7 + 1 = s.nth
               end
           end
  ),
  ins as (
    insert into public.meetings
      (institution_id, device_id, title, origin, status, starts_at, ends_at, schedule_id)
    select o.institution_id, o.device_id, o.title, 'scheduled', 'scheduled',
           (o.day + o.start_time) at time zone o.timezone,
           ((o.day + o.start_time) at time zone o.timezone) + make_interval(mins => o.duration_minutes),
           o.schedule_id
      from occurrences o
     -- Never create an occurrence that has already ENDED (e.g. a schedule
     -- made at 09:00 for 08:00–09:00 today): the sweep would close it at once
     -- and mark every member absent from a meeting that "happened" unrecorded.
     -- One still in progress is created, so scans from now on land in it.
     where ((o.day + o.start_time) at time zone o.timezone)
             + make_interval(mins => o.duration_minutes) > p_now
    on conflict (schedule_id, starts_at) do nothing
    returning 1
  ),
  advanced as (
    update public.meeting_schedules s
       set generated_through = greatest(
             coalesce(s.generated_through, sc.today_local - 1),
             least(coalesce(s.ends_on, 'infinity'::date), sc.today_local + p_horizon_days))
      from sched sc
     where sc.id = s.id
    returning 1
  )
  select count(*) into v_created from ins;

  return v_created;
end;
$$;

comment on function public.generate_scheduled_meetings(uuid, timestamptz, integer) is
  'Club mode: materialise active schedules into meetings up to p_horizon_days '
  'ahead (all schedules, or one). Idempotent; never re-creates a deleted '
  'occurrence. Returns the number of meetings created.';

revoke execute on function public.generate_scheduled_meetings(uuid, timestamptz, integer) from public, anon, authenticated;
grant  execute on function public.generate_scheduled_meetings(uuid, timestamptz, integer) to service_role;


-- 5. end_meeting_schedule ---------------------------------------------------------
create or replace function public.end_meeting_schedule(
  p_schedule_id uuid,
  p_now         timestamptz default now()
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_deleted   integer := 0;
  v_cancelled integer := 0;
begin
  update public.meeting_schedules set active = false where id = p_schedule_id;

  -- Future occurrences that have not started. One that already holds a scan
  -- (a pre-roll arrival) cannot be deleted under the attendance FK: cancel it.
  -- Started / closed occurrences are history and stay as they are.
  with deleted as (
    delete from public.meetings m
     where m.schedule_id = p_schedule_id
       and m.status = 'scheduled'
       and m.starts_at > p_now
       and not exists (select 1 from public.attendance a where a.meeting_id = m.id)
    returning 1
  )
  select count(*) into v_deleted from deleted;

  with cancelled as (
    update public.meetings m
       set status = 'cancelled'
     where m.schedule_id = p_schedule_id
       and m.status = 'scheduled'
       and m.starts_at > p_now
    returning 1
  )
  select count(*) into v_cancelled from cancelled;

  return v_deleted + v_cancelled;
end;
$$;

comment on function public.end_meeting_schedule(uuid, timestamptz) is
  'Club mode: stop a schedule. Deactivates it and removes its not-yet-started '
  'occurrences (deleted, or cancelled if a scan already landed). Returns how '
  'many occurrences were removed.';

revoke execute on function public.end_meeting_schedule(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.end_meeting_schedule(uuid, timestamptz) to service_role;


-- 6. Device-delete guard: also deactivate the device's schedules -------------------
-- Replaces the 20260926130000 version. Only addition: the meeting_schedules
-- UPDATE. Everything else — the mid-cascade skip, and the single meetings
-- UPDATE whose CASEs read pre-update values — is unchanged.
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

  -- Its schedules stop generating. device_id is then SET NULL by the FK, but
  -- an inactive schedule never generates, so it can never act unbound.
  update public.meeting_schedules
     set active = false
   where device_id = old.id;

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


-- 7. meeting_attendance_counts --------------------------------------------------
-- Present / absent per meeting, for the dashboard. Aggregated here because the
-- Data API caps a response at max_rows (1000): counting raw rows client-side
-- would silently undercount once a club has more attendance than that.
-- Counts ARRIVAL rows only (present / time_in), so a time-in/out member is one
-- person, not two; absent placeholders use the same scan types.
create or replace function public.meeting_attendance_counts(
  p_institution_id uuid,
  p_since          timestamptz
) returns table (meeting_id uuid, present integer, absent integer)
language sql stable
set search_path = ''
as $$
  select a.meeting_id,
         (count(*) filter (where a.status = 'present'))::integer,
         (count(*) filter (where a.status = 'absent'))::integer
    from public.attendance a
    join public.meetings m on m.id = a.meeting_id
   where m.institution_id = p_institution_id
     and m.starts_at >= p_since
     and a.scan_type in ('present', 'time_in')
   group by a.meeting_id
$$;

comment on function public.meeting_attendance_counts(uuid, timestamptz) is
  'Club mode: present / absent (arrival rows) per meeting starting on or after '
  'p_since. Aggregated server-side so the dashboard never hits the row cap.';

revoke execute on function public.meeting_attendance_counts(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.meeting_attendance_counts(uuid, timestamptz) to service_role;
