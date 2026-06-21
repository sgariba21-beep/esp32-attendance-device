-- =====================================================================
-- Phase 1 — GENERAL LOCKS retail module: shop type + cashier role
-- =====================================================================
-- A. Widen institutions.type CHECK to include 'shop' (3rd type).
--    Defensive conname lookup before drop, matching the pattern in
--    20260615121000_scope_member_sid_unique.sql.
-- B. Widen profiles.role CHECK to include 'cashier'.
--    Drop+re-add pattern from 20260615060000_roles_and_device_display_name.sql.
--    Both are WIDENINGS (new set ⊇ old), so existing rows validate for free.
-- C. Update dormant RLS defence-in-depth to include 'cashier' where
--    appropriate. The dashboard reads via service role (RLS bypassed);
--    these policies are the enforcement layer if authenticated access
--    is ever introduced.
--
-- NOTE: Do NOT apply to cloud. Run this migration manually after review.
-- =====================================================================


-- A. institutions.type: add 'shop' ----------------------------------------
-- The constraint was created as an inline unnamed CHECK in 20260614121000,
-- so Postgres auto-named it institutions_type_check. We cannot use
-- pg_get_constraintdef() to match on "type in ..." because Postgres
-- normalises that internally to "= ANY (ARRAY[...])", so the text match
-- would never fire. The name is stable, so DROP IF EXISTS is both safe
-- and correct.
alter table public.institutions
  drop constraint if exists institutions_type_check;

alter table public.institutions
  add constraint institutions_type_check
  check (type in ('school', 'office', 'shop'));


-- B. profiles.role: add 'cashier' ------------------------------------------
alter table public.profiles drop constraint profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'admin', 'teacher', 'staff', 'platform_admin', 'cashier'));


-- C. RLS defence-in-depth: add 'cashier' to institution read policy ---------
-- Cashier needs to read their institution row (name, logo, labels, timezone).
-- Drop + recreate because ALTER POLICY ... USING is not available in all
-- Supabase-supported Postgres versions.
drop policy if exists "institutions_member_select" on public.institutions;

create policy "institutions_member_select" on public.institutions
  for select to authenticated
  using (
    id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin', 'admin', 'cashier')
  );
