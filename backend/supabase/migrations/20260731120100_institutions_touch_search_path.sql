-- =====================================================================
-- Follow-up to 20260731120000_device_config_rev.sql
-- =====================================================================
-- Pins search_path on institutions_touch() per the Supabase security
-- linter (function_search_path_mutable) flagged right after that migration
-- landed. No behavioural change -- the function only touches NEW/OLD.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

create or replace function public.institutions_touch()
returns trigger language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  new.config_rev = old.config_rev + 1;
  return new;
end;
$$;
