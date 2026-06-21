-- =====================================================================
-- Phase 2 (2/8) — products: retail catalog (soft-delete)
-- =====================================================================
-- Spec §A.2 + R-1 (owner: add stock). Price edits affect FUTURE sales only;
-- past sales keep their snapshot in transaction_items (A.6). Catalog rows are
-- soft-deleted (active), never hard-deleted, so sold items stay joinable.
--
-- R-1: stock is a single inventory counter (the movements ledger is deferred).
-- Phase 5 decrements it on each sale; policy is "allow negative, warn", so
-- NO check (stock >= 0) -- it may legitimately go negative.
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  name            text not null,
  price           numeric(10,2) not null check (price >= 0),
  stock           integer not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index products_institution_id_idx on public.products(institution_id);

-- No two ACTIVE products share a name within a tenant (A-7). Partial unique so
-- archived rows don't block re-using a name.
create unique index products_institution_name_key
  on public.products(institution_id, lower(name)) where active;

alter table public.products enable row level security;
create policy "service role full access" on public.products
  for all using ((select auth.role()) = 'service_role');
