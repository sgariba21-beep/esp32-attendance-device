-- =====================================================================
-- Phase 2 (3/8) — services: service catalog (soft-delete)
-- =====================================================================
-- Spec §A.3. Same shape as products (a service is a sellable line item) but a
-- SEPARATE table so transaction_items' "exactly one of product/service" CHECK
-- is meaningful and reporting can split goods vs services. No stock on services
-- (intangible). No duration_minutes / scheduling (A-12: out of scope).
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

create table public.services (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  name            text not null,
  price           numeric(10,2) not null check (price >= 0),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index services_institution_id_idx on public.services(institution_id);

-- No two ACTIVE services share a name within a tenant (A-7).
create unique index services_institution_name_key
  on public.services(institution_id, lower(name)) where active;

alter table public.services enable row level security;
create policy "service role full access" on public.services
  for all using ((select auth.role()) = 'service_role');
