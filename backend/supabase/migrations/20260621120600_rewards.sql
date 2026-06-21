-- =====================================================================
-- Phase 2 (7/8) — rewards: loyalty rule definitions (RICH model, R-3)
-- =====================================================================
-- R-3 (owner: rich model per the implementation plan). A rule is:
--   CONDITION: count `condition_type` events, optionally SCOPED to one
--              product/service, until `condition_value` is reached, measured
--              over a `window_type` window.
--   PAYLOAD:   what the client gets -- `reward_kind` + the matching reward
--              product / service / value.
-- This expresses scoped rules the simple {visits,spend} model could not, e.g.
-- "every 10 retwists (service_count, condition_service_id=Retwist, value=10)
--  -> 1 free wash (free_service, reward_service_id=Wash)".
--
-- Standing decisions kept regardless of R-3:
--   - Decision 3: repeatable punch-cards (default true).
--   - Decision 4: auto=true => a pg_cron job auto-ISSUES (analog to mark-absent);
--     never auto-applied to a sale.
--   - A-4: window token is `since_last_issuance` (NOT since_last_redemption --
--     the docx is stale; issuance-only model).
--
-- Catalog FKs (condition_/reward_ product & service) are ON DELETE NO ACTION
-- (§0 intra-tenant): catalog is soft-deleted, so referenced rows persist.
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

create table public.rewards (
  id                  uuid primary key default gen_random_uuid(),
  institution_id      uuid not null references public.institutions(id) on delete cascade,
  name                text not null,

  -- CONDITION ---------------------------------------------------------------
  condition_type      text not null
                        check (condition_type in
                          ('service_count', 'product_count',
                           'visit_count', 'total_amount_spent')),
  -- Optional scoping: count only this product / service. NULL = count all.
  condition_product_id uuid references public.products(id),
  condition_service_id uuid references public.services(id),
  -- Threshold: N counts (whole) or N cedis, depending on condition_type.
  condition_value     numeric(10,2) not null check (condition_value > 0),

  -- WINDOW ------------------------------------------------------------------
  window_type         text not null
                        check (window_type in
                          ('lifetime', 'rolling_days', 'since_last_issuance')),
  rolling_days        integer,

  repeatable          boolean not null default true,

  -- PAYLOAD (what the client gets) -----------------------------------------
  reward_kind         text not null
                        check (reward_kind in
                          ('free_product', 'free_service', 'discount', 'custom')),
  reward_product_id   uuid references public.products(id),
  reward_service_id   uuid references public.services(id),
  reward_value        numeric(10,2) check (reward_value is null or reward_value >= 0),

  auto                boolean not null default false,
  active              boolean not null default true,
  description         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- rolling_days present iff the window is rolling.
  constraint rewards_rolling_days_chk
    check ((window_type = 'rolling_days') = (rolling_days is not null)),

  -- A product/service scope only makes sense for the matching count condition.
  constraint rewards_condition_product_scope_chk
    check (condition_product_id is null or condition_type = 'product_count'),
  constraint rewards_condition_service_scope_chk
    check (condition_service_id is null or condition_type = 'service_count'),

  -- The payload column matching reward_kind must be present.
  constraint rewards_reward_payload_chk
    check (
      (reward_kind = 'free_product' and reward_product_id is not null) or
      (reward_kind = 'free_service' and reward_service_id is not null) or
      (reward_kind = 'discount'     and reward_value     is not null) or
      (reward_kind = 'custom')
    )
);

create index rewards_institution_id_idx on public.rewards(institution_id);
create index rewards_institution_active_idx
  on public.rewards(institution_id, active);

alter table public.rewards enable row level security;
create policy "service role full access" on public.rewards
  for all using ((select auth.role()) = 'service_role');
