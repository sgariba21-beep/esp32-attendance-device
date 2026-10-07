-- =====================================================================
-- Club mode — back-to-back meetings: a scheduled meeting takes over from an
-- ad-hoc one that was opened before it started
-- =====================================================================
-- Problem (several meetings on one day):
--   resolve_device_scan files a scan that carries an ad-hoc meeting's ref in
--   THAT meeting whenever its time is inside it — and an ad-hoc meeting stays
--   open until the session master closes it, its idle rule fires, or midnight.
--   So if an organiser forgets to close a morning ad-hoc meeting, every scan
--   at the afternoon's scheduled meeting on the same device still lands in the
--   morning one, and the close sweep then marks those members ABSENT from the
--   meeting they actually attended. device_meeting_state also kept reporting
--   the ad-hoc meeting as live, so the device never knew.
--
-- Rule: a scheduled meeting whose core window ([starts_at, end], end cut
--   short at closed_at) contains the scan AND that started AFTER the ad-hoc
--   meeting was opened takes precedence: the ad-hoc meeting is over from the
--   moment the scheduled one begins. An ad-hoc meeting opened DURING a
--   scheduled one (offline, the organiser's explicit choice) still keeps its
--   own scans, as before (20260928120000).
--
--     scheduled_meeting_at(...)   the scheduled meeting in its core window at
--                                 an instant, started after a given moment
--     resolve_device_scan(...)    applies the rule (replaced)
--     device_meeting_state(...)   `live` follows the same rule (replaced), so
--                                 the device sees the scheduled meeting begin
--                                 and closes its ad-hoc one (firmware 1.11.1)
--
-- Security: SECURITY INVOKER, empty search_path, service_role only.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================


-- 1. scheduled_meeting_at --------------------------------------------------------
create or replace function public.scheduled_meeting_at(
  p_institution_id uuid,
  p_device_id      uuid,
  p_at             timestamptz,
  p_started_after  timestamptz
) returns setof public.meetings
language sql stable
set search_path = ''
as $$
  select m.*
    from public.meetings m
   where m.institution_id = p_institution_id
     and m.origin = 'scheduled'
     and m.status in ('scheduled', 'closed')
     and m.device_deleted_at is null
     and (m.device_id = p_device_id or m.device_id is null)
     and m.starts_at > p_started_after
     and p_at >= m.starts_at
     and p_at <= least(m.ends_at, coalesce(m.closed_at, 'infinity'::timestamptz))
   order by (m.device_id is not null) desc, m.starts_at desc, m.id
   limit 1;
$$;

comment on function public.scheduled_meeting_at(uuid, uuid, timestamptz, timestamptz) is
  'Club mode: the scheduled meeting whose core window contains p_at and that '
  'started after p_started_after (an ad-hoc meeting''s open time), if any.';

revoke execute on function public.scheduled_meeting_at(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.scheduled_meeting_at(uuid, uuid, timestamptz, timestamptz) to service_role;


-- 2. resolve_device_scan: the scheduled meeting takes over ------------------------
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
  v_s public.meetings;
begin
  if p_ref is not null and p_opened_at is not null and p_device_id is not null then
    select * into v_m from public.device_meeting_event(p_device_id, p_ref, p_opened_at, null);
    if v_m.id is not null
       and v_m.institution_id = p_institution_id
       and v_m.status in ('open', 'closed')
       and v_m.device_deleted_at is null
       and p_at >= v_m.opened_at
       and p_at <= coalesce(v_m.closed_at, 'infinity'::timestamptz) then
      -- A scheduled meeting that began after this ad-hoc one was opened has
      -- taken over (the organiser left the ad-hoc meeting open).
      select * into v_s from public.scheduled_meeting_at(p_institution_id, p_device_id, p_at, v_m.opened_at);
      if v_s.id is not null then
        return next v_s;
      else
        return next v_m;
      end if;
      return;
    end if;
  end if;

  return query select * from public.resolve_meeting(p_institution_id, p_device_id, p_at);
end;
$$;

comment on function public.resolve_device_scan(uuid, uuid, timestamptz, text, timestamptz) is
  'Club mode: resolve_meeting for a scan that may carry its ad-hoc meeting ref; '
  'creates that meeting if the scan reached the server before its open event. '
  'A scheduled meeting that started after the ad-hoc one opened takes precedence.';

revoke execute on function public.resolve_device_scan(uuid, uuid, timestamptz, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.resolve_device_scan(uuid, uuid, timestamptz, text, timestamptz) to service_role;


-- 3. device_meeting_state: `live` follows the same rule ------------------------------
-- Unchanged from 20260928120000 except `live`: with an ad-hoc meeting open, a
-- scheduled meeting that has since started is what's live (resolve_meeting
-- alone would keep returning a device-bound ad-hoc meeting over an unbound
-- scheduled one). live.starts_at lets the device close its ad-hoc meeting at
-- that start.
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
          from (
            select 0 as pri, s.* from public.scheduled_meeting_at(i.id, d.id, p_now, o.opened_at) s
             where o.device_ref is not null
            union all
            select 1 as pri, x.* from public.resolve_meeting(i.id, d.id, p_now) x
          ) r
         order by r.pri
         limit 1
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
  'Club mode: the meeting state a device polls for (see 20260928120000; live '
  'per 20261006120000).';

revoke execute on function public.device_meeting_state(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.device_meeting_state(uuid, timestamptz) to service_role;
