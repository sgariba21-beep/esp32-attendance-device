-- =====================================================================
-- Phase 2 (5/8) — transactions: a sale (every buyer identified)
-- =====================================================================
-- Spec §A.5 + R-2 (owner: add client_attendance_id). Decision 1: client_id
-- NOT NULL, no anonymous sales. total is stored (denormalised) so a sale keeps
-- its own immutable total as catalog prices change; it must equal
-- sum(transaction_items.line_total), maintained ATOMICALLY by the server action
-- (A-3: no DB trigger).
--
-- On-delete (§0):
--   institution_id        -> CASCADE   (tenant teardown)
--   client_id             -> NO ACTION (Decision 1; force soft-delete)
--   client_attendance_id  -> SET NULL  (R-2; preserve the sale if the visit row
--                                       is ever removed)
--   staff_id (-> members) -> SET NULL  (A-2: stylist optional; preserve sale if
--                                       the stylist is removed)
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

create table public.transactions (
  id                   uuid primary key default gen_random_uuid(),
  institution_id       uuid not null references public.institutions(id) on delete cascade,
  client_id            uuid not null references public.clients(id),
  client_attendance_id uuid references public.client_attendance(id) on delete set null,
  staff_id             uuid references public.members(id) on delete set null,
  total                numeric(10,2) not null check (total >= 0),
  note                 text,
  created_at           timestamptz not null default now()
);

create index transactions_institution_id_idx
  on public.transactions(institution_id);

-- Sales history (newest first).
create index transactions_institution_created_idx
  on public.transactions(institution_id, created_at desc);

-- Per-client spend / loyalty.
create index transactions_institution_client_idx
  on public.transactions(institution_id, client_id);

-- Stylist performance reports.
create index transactions_staff_idx on public.transactions(staff_id);

alter table public.transactions enable row level security;
create policy "service role full access" on public.transactions
  for all using ((select auth.role()) = 'service_role');
