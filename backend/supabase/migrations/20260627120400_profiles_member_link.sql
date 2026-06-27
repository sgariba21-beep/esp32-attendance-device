-- =====================================================================
-- Phase 8 — cashier ↔ member link (#7): optional employee identity for a login
-- =====================================================================
-- A login (profiles row = RBAC / auth) and an attendance subject (members row =
-- fingerprint / scan) are ORTHOGONAL axes. This nullable FK records that a given
-- login ALSO corresponds to an employee/member — e.g. a cashier who is also a
-- stylist that clocks in. NULL = the login has no employee record (the common
-- case for an office admin or a pure cashier).
--
-- Invariants:
--   • ON DELETE SET NULL — if the member record is ever hard-deleted the login
--     survives, just unlinked (members are normally soft-deleted via status, so
--     this is a safety net rather than the usual path).
--   • Partial UNIQUE — at most one login per member; a member maps to one login.
--     Partial (WHERE member_id is not null) so the many unlinked logins don't
--     collide on NULL.
--   • Same-institution pairing is enforced in the server action (a single-column
--     FK can't express a cross-column tenant check), mirroring catalogRefsValid().
--
-- Additive + nullable with no default ⇒ every existing profile validates with
-- member_id = NULL; no data backfill.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

alter table public.profiles
  add column member_id uuid references public.members(id) on delete set null;

create unique index profiles_member_id_unique
  on public.profiles(member_id) where member_id is not null;
