-- =====================================================================
-- Club mode (Phase 1, 1/3) — 'club' institution type + meeting settings
-- =====================================================================
-- Purpose:
--   Adds a 4th institution type, 'club', whose unit of attendance is a
--   MEETING rather than a DAY (see CLUB-MODE-PLAN.md), plus the per-tenant
--   settings the meeting machinery reads:
--
--     1. track_absences            — whether absent rows are generated for
--                                    members who miss a meeting. Consulted
--                                    by the club meeting-close sweep
--                                    (Phase 2). mark-absent, which serves
--                                    school / office / shop, does NOT read it.
--
--     2. meeting_preroll_minutes   — how long before a scheduled meeting's
--                                    starts_at a scan still counts for it.
--
--     3. meeting_postroll_minutes  — how long after its ends_at a scan
--                                    still counts.
--
--     4. meeting_autoclose_minutes — idle minutes (no scans) after which the
--                                    sweep closes an open ad-hoc meeting that
--                                    nobody closed at the device.
--
-- Safety:
--   The type CHECK is a WIDENING (new set ⊇ old), so every existing row
--   validates for free. Nothing can create a 'club' row yet — onboarding and
--   settings still offer only school / office / shop until Phase 3.
--
--   All columns are additive with defaults. track_absences defaults TRUE,
--   the value that matches what every existing tenant already gets;
--   /onboarding will set it FALSE when creating a club (Phase 3).
--
--   ADD COLUMN does not fire row triggers, so institutions_touch does not
--   bump config_rev on apply. Later edits to these columns WILL bump it —
--   an inert over-bump (see the Phase 1 config_rev migration).
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================


-- 1. institutions.type: add 'club' -----------------------------------
-- Same drop/re-add as 20260620120000_phase1_shop_cashier.sql: the CHECK was
-- created inline in 20260614121000, so Postgres auto-named it
-- institutions_type_check, and that name is stable.
alter table public.institutions
  drop constraint if exists institutions_type_check;

alter table public.institutions
  add constraint institutions_type_check
  check (type in ('school', 'office', 'shop', 'club'));


-- 2. Absence tracking -------------------------------------------------
alter table public.institutions
  add column track_absences boolean not null default true;

comment on column public.institutions.track_absences is
  'Club tenants: when true, the meeting-close sweep writes an absent row for '
  'every active member who did not scan into the meeting. Not read by '
  'mark-absent (school / office / shop always get daily absences).';


-- 3. Meeting windows ----------------------------------------------------
-- Pre/post-roll widen a SCHEDULED meeting's acceptance window so early
-- arrivals and stragglers still count. Upper bounds are sanity limits, not
-- product limits: a 4-hour pre-roll already overlaps most real schedules.
alter table public.institutions
  add column meeting_preroll_minutes   integer not null default 30
    check (meeting_preroll_minutes between 0 and 240),
  add column meeting_postroll_minutes  integer not null default 30
    check (meeting_postroll_minutes between 0 and 240),
  add column meeting_autoclose_minutes integer not null default 240
    check (meeting_autoclose_minutes between 15 and 1440);

comment on column public.institutions.meeting_preroll_minutes is
  'Club tenants: minutes before a scheduled meeting''s starts_at during which '
  'a scan still resolves into that meeting.';
comment on column public.institutions.meeting_postroll_minutes is
  'Club tenants: minutes after a scheduled meeting''s ends_at during which a '
  'scan still resolves into that meeting.';
comment on column public.institutions.meeting_autoclose_minutes is
  'Club tenants: idle minutes (no scans) after which an open ad-hoc meeting '
  'is closed by the sweep. Backstop for a meeting nobody closed at the device.';
