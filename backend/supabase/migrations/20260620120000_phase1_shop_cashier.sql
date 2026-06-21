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
-- Look up the actual constraint name defensively; the CHECK was created
-- inline (unnamed) in 20260614121000, so Postgres auto-named it
-- institutions_type_check, but we verify rather than assume.
do $$
declare cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.institutions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%type in%';
  if cname is not null then
    execute 'alter table public.institutions drop constraint ' || quote_ident(cname);
  end if;
end $$;

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
