-- =====================================================================
-- Phase 2 (6/8) — transaction_items: line items (price + name snapshot)
-- =====================================================================
-- Spec §A.6. item_name + unit_price are SNAPSHOTTED at sale time and are NEVER
-- rewritten by catalog edits -- editing a product/service never re-prices
-- history. line_total is a STORED generated column (same idiom as
-- devices.display_name in 20260615060000).
--
-- Carries its own institution_id (denormalised from the parent) because
-- ownsRecord() does a flat `select institution_id where id = $id` with NO join
-- (§0 / ownership.ts) -- a child line item must still be ownership-checkable.
--
-- On-delete (§0):
--   institution_id -> CASCADE   (tenant teardown)
--   transaction_id -> CASCADE   (a line item has no meaning without its sale)
--   product_id     -> NO ACTION )  catalog is soft-deleted, never hard-deleted;
--   service_id     -> NO ACTION )  SET NULL here would null the only target and
--                                  violate the one-target CHECK below.
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

create table public.transaction_items (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  transaction_id  uuid not null references public.transactions(id) on delete cascade,
  product_id      uuid references public.products(id),
  service_id      uuid references public.services(id),
  item_name       text not null,
  unit_price      numeric(10,2) not null check (unit_price >= 0),
  quantity        integer not null default 1 check (quantity > 0),
  line_total      numeric(10,2)
                    generated always as (unit_price * quantity) stored,
  created_at      timestamptz not null default now(),
  -- Exactly one of product/service per line (hard invariant from assessment).
  constraint transaction_items_one_target_chk
    check (num_nonnulls(product_id, service_id) = 1)
);

create index transaction_items_transaction_id_idx
  on public.transaction_items(transaction_id);
create index transaction_items_institution_id_idx
  on public.transaction_items(institution_id);

-- Reporting (top products / services).
create index transaction_items_product_id_idx
  on public.transaction_items(product_id);
create index transaction_items_service_id_idx
  on public.transaction_items(service_id);

alter table public.transaction_items enable row level security;
create policy "service role full access" on public.transaction_items
  for all using ((select auth.role()) = 'service_role');
