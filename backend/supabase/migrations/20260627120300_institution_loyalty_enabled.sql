-- =====================================================================
-- Additive batch (4/4) — institutions.loyalty_enabled: rewards module switch
-- =====================================================================
-- Master switch for the whole Loyalty module, parallel to sell_products /
-- sell_services. Per-RULE enable/disable already exists (rewards.active); this
-- is the institution-level toggle that hides the Loyalty nav + /rewards page.
--
-- Because reward progress is COMPUTED on the fly (no materialized counters),
-- disabling just stops issuance — there is no in-progress row to invalidate.
-- Re-enabling resumes from real history (events during the off period still
-- count); this is the accepted punch-card semantic.
--
-- Default TRUE, so existing tenants are unchanged.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

alter table public.institutions
  add column loyalty_enabled boolean not null default true;
