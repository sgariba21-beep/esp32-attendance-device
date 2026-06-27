-- =====================================================================
-- Additive batch (2/4) — institutions.sell_products / sell_services
-- =====================================================================
-- Module-level offerings toggle (NOT a per-item flag — products.active /
-- services.active already enable/disable individual catalog rows). These gate
-- whether a tenant deals in goods and/or services at all: a service-only salon
-- hides the Products tab + product line items; a retail kiosk hides Services.
--
-- DISPLAY/INPUT-time only — NEVER retroactive. transaction_items snapshots
-- item_name + unit_price, so a tenant that later disables a category keeps all
-- its historical sales joinable and correctly priced in reports.
--
-- Default TRUE for both, so existing tenants are unchanged. Schools never see
-- the retail nav (type-gated), so the columns are harmless there.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

alter table public.institutions
  add column sell_products boolean not null default true,
  add column sell_services boolean not null default true;
