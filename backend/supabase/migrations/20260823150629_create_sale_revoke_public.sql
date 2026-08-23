-- =====================================================================
-- create_sale() — close the PUBLIC-grant gap
-- =====================================================================
-- `REVOKE EXECUTE ... FROM anon, authenticated` (the pattern the original
-- create_sale_fn migration used, and that 20260823130100 just repeated on
-- the new signature) does NOT remove access if PUBLIC still has EXECUTE —
-- Postgres grants EXECUTE to PUBLIC by default on every `CREATE FUNCTION`,
-- and both `anon` and `authenticated` inherit through PUBLIC regardless of
-- what is revoked from them directly. Confirmed live on this project via
-- `has_function_privilege('anon', 'create_sale(...)', 'execute')` = true.
--
-- This function is SECURITY DEFINER and writes real sales, decrements real
-- stock, and issues/redeems real loyalty rewards for whatever
-- institution_id is passed in — with none of the requireRole()/ownership
-- checks that live in the Next.js server action layer, not in this
-- function. Left this way, it is directly callable over PostgREST at
-- /rest/v1/rpc/create_sale by anyone holding the public anon key (which
-- ships in the frontend bundle) — an anonymous request can write a sale
-- for ANY institution.
--
-- Note: this same PUBLIC-grant gap exists on other SECURITY DEFINER
-- functions in this schema (auth_role, auth_institution_id,
-- auth_member_unit, auth_assigned_unit) — NOT touched here. Those are RLS
-- helper functions likely intended to run in an authenticated request
-- context for policy evaluation; revoking PUBLIC from them needs its own
-- review, not a blind sweep alongside this fix.
-- =====================================================================

revoke execute on function public.create_sale(uuid,uuid,uuid,text,jsonb,text,numeric,jsonb)
  from public;
