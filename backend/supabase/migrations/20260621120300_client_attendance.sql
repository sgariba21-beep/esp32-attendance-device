-- =====================================================================
-- Phase 2 (4/8) — client_attendance: one visit per client per day
-- =====================================================================
-- Spec §A.4. Mirrors attendance semantically: a business-day `date` plus the
-- capture instant. Decision 2: UNIQUE(institution_id, client_id, date) makes
-- "log visit" idempotent (a second scan the same day is ON CONFLICT DO NOTHING)
-- and backs the loyalty visit-count queries.
--
-- `date` is a PLAIN date computed SERVER-SIDE in Africa/Accra (§D) -- never
-- now()::date in UTC -- so the one-visit-per-day boundary lands on the local
-- day. The server action sets it; this migration does not default it.
--
-- client_id is ON DELETE NO ACTION (A-6 / §0): the uniform "force soft-delete"
-- invariant. Institution teardown still works (transactions/visits are removed
-- by their own institution_id CASCADE in the same statement; NO ACTION is
-- checked at end-of-statement).
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

create table public.client_attendance (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  client_id       uuid not null references public.clients(id),
  date            date not null,
  created_at      timestamptz not null default now()
);

-- Decision 2: one visit per client per day; also the ON CONFLICT target.
create unique index client_attendance_institution_client_date_key
  on public.client_attendance(institution_id, client_id, date);

-- Daily reporting (parallels attendance_institution_date_idx).
create index client_attendance_institution_date_idx
  on public.client_attendance(institution_id, date);

alter table public.client_attendance enable row level security;
create policy "service role full access" on public.client_attendance
  for all using ((select auth.role()) = 'service_role');
