-- =====================================================================
-- Club mode (Phase 1, 2/3) — meetings table
-- =====================================================================
-- Purpose:
--   A meeting is the unit of attendance for club-type institutions: a
--   bounded window of time that scans are resolved into BY TIMESTAMP
--   (CLUB-MODE-PLAN.md §5). Two origins:
--
--     'scheduled' — created ahead of time in the dashboard; carries its own
--                   starts_at / ends_at.
--     'device'    — opened ad hoc with a session-master finger at the device
--                   (Phase 4); ends_at is filled in when it closes.
--
--   Why timestamptz when attendance stores a local date + time pair: scans
--   are resolved by instant containment, and offline scans can flush days
--   after the fact. Local wall-clock columns cannot express a range
--   unambiguously across DST or a timezone edit. attendance.date /
--   attendance.time are left exactly as they are.
--
-- Deliberately NOT here (each is additive when it lands):
--   - An overlap exclusion constraint. The acceptance window includes the
--     tenant's pre/post-roll, which is config and can change, so overlap is
--     enforced where meetings are written (Phase 2 / 3).
--   - "At most one open meeting per device", and an idempotency key for
--     replayed device events. Both depend on how the session-master press
--     works OFFLINE, which is a Phase 4 decision still to be made.
--   - A CHECK that origin = 'device' implies device_id IS NOT NULL. It looks
--     right but would make DELETE FROM devices fail: device_id is
--     ON DELETE SET NULL, and SET NULL would violate the CHECK.
--
-- Security:
--   RLS is enabled in the SAME migration that creates the table. This
--   project auto-grants new public tables to anon / authenticated, so a table
--   applied without RLS — even briefly, between two files — would be readable
--   and writable through the Data API. The policy mirrors holidays / periods
--   (20260615070000_rls_policies.sql): dormant for the service-role dashboard,
--   the enforcement layer if authenticated access is ever introduced.
--
--   Explicit GRANTs: the Supabase cloud default stops auto-granting new
--   public tables on 2026-10-30. Without these, applying this after that date
--   would leave the edge functions and dashboard (service_role) with
--   "permission denied for table meetings". Redundant, and harmless, today.
--
-- Watermark: meetings fires touch_institution_activity() like attendance /
--   members / devices / periods, so the dashboard's 12 s poll refreshes when a
--   meeting opens or closes. The function's deleted-institution guard
--   (20260904120000) already covers the ON DELETE CASCADE from institutions.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================


create table public.meetings (
  id                   uuid primary key default gen_random_uuid(),
  institution_id       uuid not null references public.institutions(id) on delete cascade,
  -- Host device. NULL = not bound to a specific device. ON DELETE SET NULL,
  -- matching attendance / members: deleting a device never destroys history.
  device_id            uuid references public.devices(id) on delete set null,
  -- NULL = untitled (an ad-hoc meeting opened at the device has no name until
  -- someone gives it one). Bounded because the OLED truncates it anyway.
  title                text
                         check (title is null or char_length(btrim(title)) between 1 and 120),
  origin               text not null
                         check (origin in ('scheduled', 'device')),
  status               text not null
                         check (status in ('scheduled', 'open', 'closed', 'cancelled')),
  starts_at            timestamptz not null,
  ends_at              timestamptz,
  opened_at            timestamptz,
  closed_at            timestamptz,
  -- Set by the close sweep once absent rows are written; makes the sweep
  -- idempotent if it runs twice over the same meeting.
  absences_written_at  timestamptz,
  created_at           timestamptz not null default now(),

  -- >= rather than >: an ad-hoc meeting opened and closed within the same
  -- second must still be closable.
  constraint meetings_ends_not_before_start
    check (ends_at is null or ends_at >= starts_at),
  -- "Scheduled meetings carry their own end time" (plan §2).
  constraint meetings_scheduled_has_end
    check (origin <> 'scheduled' or ends_at is not null),
  constraint meetings_open_has_opened_at
    check (status <> 'open' or opened_at is not null),
  constraint meetings_closed_has_closed_at
    check (status <> 'closed' or closed_at is not null)
);

comment on table public.meetings is
  'Club mode: a bounded attendance window. Scans resolve into a meeting by '
  'timestamp containment. See CLUB-MODE-PLAN.md.';


-- Indexes ---------------------------------------------------------------
-- Listing, and resolving a scan timestamp to its meeting.
create index meetings_institution_starts_at_idx
  on public.meetings (institution_id, starts_at);

-- FK index: DELETE FROM devices (ON DELETE SET NULL) must find a device's
-- meetings without a sequential scan.
create index meetings_device_id_idx
  on public.meetings (device_id);

-- The device poll asks "is a meeting open here?" every 10 s per device.
create index meetings_open_idx
  on public.meetings (institution_id)
  where status = 'open';


-- RLS (dormant defence-in-depth) -----------------------------------------
alter table public.meetings enable row level security;

create policy "meetings_admin_all" on public.meetings
  for all to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  )
  with check (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  );

grant select, insert, update, delete on public.meetings to service_role;
grant select, insert, update, delete on public.meetings to authenticated;


-- Watermark trigger ---------------------------------------------------------
create trigger trg_activity_meetings
after insert or update or delete on public.meetings
for each row execute function public.touch_institution_activity();
