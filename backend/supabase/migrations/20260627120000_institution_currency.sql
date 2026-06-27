-- =====================================================================
-- Additive batch (1/4) — institutions.currency: per-tenant denomination
-- =====================================================================
-- Multi-currency = ONE currency per institution (NOT per-transaction, NO live
-- FX). All of a tenant's money is denominated in this currency; it only governs
-- DISPLAY/formatting (the frontend formatMoney helper) — no money column or
-- stored value changes. ISO-4217 alphabetic code (GHS, NGN, USD, …).
--
-- WIDENING with a DEFAULT, so every existing tenant (OLAG, GENERAL LOCKS)
-- backfills to 'GHS' automatically and validates for free. Reversible
-- (drop column) until the frontend reads it.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

alter table public.institutions
  add column currency text not null default 'GHS'
    check (char_length(currency) = 3);

comment on column public.institutions.currency is
  'ISO-4217 display currency for this tenant. Formatting only; no FX.';
