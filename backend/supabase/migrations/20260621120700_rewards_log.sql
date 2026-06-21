-- =====================================================================
-- Phase 2 (8/8) — rewards_log: issuance records (issuance-only, RICH model)
-- =====================================================================
-- Spec §A.8 + R-3. Records that a reward was ISSUED (Decision 4: no redemption
-- / transaction linkage). DELIBERATELY NOT unique on (client_id, reward_id) --
-- Decision 3: rewards are repeatable, so a client earns the same reward many
-- times; each issuance is its own row and moves the `since_last_issuance`
-- window forward.
--
-- R-3 columns: trigger_source (manual|auto) + value_snapshot (the rule's value
-- captured at issuance, so later rule edits don't rewrite history).
-- A-11: issued_by -> profiles(id) SET NULL; NULL = system/cron auto-issue
-- (profiles.id IS the auth.users id, satisfying the plan's "-> auth user").
--
-- On-delete (§0): institution_id CASCADE; client_id / reward_id NO ACTION
-- (force soft-delete); issued_by SET NULL (preserve the issuance record).
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

create table public.rewards_log (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  client_id       uuid not null references public.clients(id),
  reward_id       uuid not null references public.rewards(id),
  trigger_source  text not null default 'manual'
                    check (trigger_source in ('manual', 'auto')),
  -- Snapshot of the rule's value at issuance time (rule edits don't rewrite
  -- history). Nullable for rules whose payload has no numeric value.
  value_snapshot  numeric(10,2) check (value_snapshot is null or value_snapshot >= 0),
  issued_by       uuid references public.profiles(id) on delete set null,
  note            text,
  issued_at       timestamptz not null default now()
);

-- Hot path: find the LAST issuance for a (client, reward) to bound the
-- since_last_issuance window.
create index rewards_log_client_reward_issued_idx
  on public.rewards_log(institution_id, client_id, reward_id, issued_at desc);

-- The cron scan: issuances for a reward over time.
create index rewards_log_institution_reward_idx
  on public.rewards_log(institution_id, reward_id, issued_at);

alter table public.rewards_log enable row level security;
create policy "service role full access" on public.rewards_log
  for all using ((select auth.role()) = 'service_role');
