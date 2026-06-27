-- =====================================================================
-- Additive batch (3/4) — institutions.status: soft-deactivation lifecycle
-- =====================================================================
-- Reversible middle ground between 'active' and the existing hard CASCADE
-- delete (/institutions triple-confirm). Data is retained for re-activation,
-- billing, and audit.
--   active       — normal operation.
--   suspended    — temporary (e.g. non-payment); easily reversed.
--   deactivated  — long-term offboard; retained for export, not expected back.
-- suspended and deactivated behave identically at the gate; the distinction is
-- operational intent.
--
-- Enforcement is APPLICATION-side, not RLS: the dashboard reads via the
-- service role (RLS-bypassing), so the real chokepoint is verifySession()
-- (redirects non-platform users of a non-active tenant to /suspended).
-- Deactivation does NOT enqueue device_resets — devices resume on reactivation,
-- unlike deletion which wipes SPIFFS. (Device-traffic cutoff in the edge
-- functions is a separate, still-pending piece of this feature.)
--
-- Default 'active', so every existing tenant validates for free.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

alter table public.institutions
  add column status text not null default 'active'
    check (status in ('active', 'suspended', 'deactivated'));

create index institutions_status_idx on public.institutions(status);
