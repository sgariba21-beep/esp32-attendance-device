-- =====================================================================
-- Institution config — time display, tracked weekdays, punctuality
-- =====================================================================
-- Purpose:
--   Three new institution-configurable behaviours, all Settings-page driven:
--
--     1. time_format          — 12h vs 24h clock in the dashboard. Display
--                               only; every timestamp is still STORED in UTC
--                               and times are still recorded as 24h "HH:MM:SS"
--                               on attendance rows. Nothing on the device
--                               reads this (the OLED clock is unchanged).
--
--     2. tracked_weekdays     — replaces the single skip_weekends boolean with
--                               an explicit set of ISO weekday numbers
--                               (1 = Monday … 7 = Sunday). A scan on a day not
--                               in the set is ignored by log-attendance, and
--                               mark-absent generates no absent rows for it.
--                               Weekends are just ordinary selectable days.
--
--     3. late / early-leave   — optional per-institution thresholds. When
--        thresholds             enabled, log-attendance stamps each real scan
--                               with attendance.punctuality
--                               ('on_time' | 'late' | 'early_leave'),
--                               computed from the local wall-clock time of the
--                               scan vs. the configured expected start / end
--                               time plus a grace window. Absent placeholders
--                               (mark-absent) leave punctuality NULL.
--
-- Safety:
--   institutions columns are additive with neutral defaults ('24h', Mon–Fri
--   once backfilled, all tracking flags off). skip_weekends is backfilled
--   into tracked_weekdays BEFORE it is dropped, so no institution changes
--   behaviour on apply. attendance.punctuality is nullable with no default —
--   existing rows read as "not evaluated", which is correct.
--
--   The institutions_touch trigger bumps config_rev on these updates. No
--   device-facing config field changes here, so an extra config_rev bump is
--   inert (the over-bump philosophy is already documented in the Phase 1
--   config_rev migration).
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

-- 1. Dashboard clock format -------------------------------------------
alter table public.institutions
  add column time_format text not null default '24h'
    check (time_format in ('12h', '24h'));

comment on column public.institutions.time_format is
  'Dashboard clock rendering: ''24h'' (13:30) or ''12h'' (1:30 PM). '
  'Display only — stored times remain UTC / 24h.';

-- 2. Tracked weekdays (replaces skip_weekends) -----------------------
-- ISO-8601 weekday numbers: 1 = Monday … 7 = Sunday. Stored as a set so the
-- Settings page can offer a plain 7-checkbox selector with no weekend special
-- case. Constraint: every element in 1..7, and the set is non-empty (an
-- institution that tracks no days at all is a misconfiguration, not a state
-- the edge functions should have to reason about).
alter table public.institutions
  add column tracked_weekdays smallint[] not null default '{1,2,3,4,5}'
    check (
      tracked_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      and coalesce(array_length(tracked_weekdays, 1), 0) >= 1
    );

comment on column public.institutions.tracked_weekdays is
  'ISO weekday numbers (1=Mon … 7=Sun) on which attendance is tracked. '
  'Scans on other days are ignored; mark-absent skips them.';

-- Backfill from the boolean it replaces, THEN drop it.
update public.institutions
   set tracked_weekdays = case
         when skip_weekends then '{1,2,3,4,5}'::smallint[]
         else '{1,2,3,4,5,6,7}'::smallint[]
       end;

alter table public.institutions
  drop column skip_weekends;

-- 3. Late-arrival / early-departure thresholds -----------------------
-- expected_start_time / expected_end_time are `time` (a wall-clock concept in
-- the institution's own timezone), NOT timestamptz — they are compared
-- against the local "HH:MM:SS" already computed for the attendance row.
alter table public.institutions
  add column track_lateness            boolean not null default false,
  add column expected_start_time       time,
  add column late_grace_minutes        integer not null default 0
    check (late_grace_minutes >= 0),
  add column track_early_leaving        boolean not null default false,
  add column expected_end_time         time,
  add column early_leave_grace_minutes integer not null default 0
    check (early_leave_grace_minutes >= 0);

comment on column public.institutions.track_lateness is
  'When true, log-attendance stamps present/time_in scans as ''late'' once '
  'the local time passes expected_start_time + late_grace_minutes.';
comment on column public.institutions.track_early_leaving is
  'When true, log-attendance stamps time_out scans as ''early_leave'' when '
  'the local time is before expected_end_time - early_leave_grace_minutes. '
  'Only meaningful for member types on time_in_out scan mode.';

-- 4. Per-scan punctuality outcome -----------------------------------
-- NULL = not evaluated (tracking off for the relevant direction, or an
-- absent placeholder). Non-NULL only on real scans (status = 'present').
alter table public.attendance
  add column punctuality text
    check (punctuality in ('on_time', 'late', 'early_leave'));

comment on column public.attendance.punctuality is
  'Punctuality verdict for a real scan, fixed at scan time from the '
  'institution''s thresholds. NULL when lateness/early-leaving tracking is '
  'off or the row is a mark-absent placeholder.';
