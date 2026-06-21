-- =====================================================================
-- Phase 2 (1/8) — clients: identified buyers (NOT a member_type)
-- =====================================================================
-- Spec §A.1. Every buyer is identified (Decision 1); phone is the loyalty
-- identity key (A-1: mandatory + unique per tenant). Soft-delete via active.
--
-- Conventions (§0): uuid PK, institution_id NN -> institutions ON DELETE
-- CASCADE + index, NUMERIC(10,2) money (n/a here), active soft-delete flag,
-- timestamptz default now(), RLS + "service role full access".
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================

create table public.clients (
  id                uuid primary key default gen_random_uuid(),
  institution_id    uuid not null references public.institutions(id) on delete cascade,
  name              text not null,
  -- canonical E.164 +233XXXXXXXXX (§D); normalized server-side before insert.
  phone             text not null,
  area_of_residence text,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index clients_institution_id_idx on public.clients(institution_id);

-- Loyalty identity key: no duplicate client per tenant. Phone is mandatory
-- (A-1), so a plain (non-partial) unique is correct.
create unique index clients_institution_phone_key
  on public.clients(institution_id, phone);

-- Typeahead search by name within a tenant.
create index clients_institution_name_idx
  on public.clients(institution_id, lower(name));

alter table public.clients enable row level security;
create policy "service role full access" on public.clients
  for all using ((select auth.role()) = 'service_role');
