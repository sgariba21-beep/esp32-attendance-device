-- Enable RLS on institutions.
-- The original enable_rls migration (20260602060505) ran before institutions
-- existed (Migration B). Migration H added policies for institutions but
-- could not enable RLS there because it only adds policies, per its header.
-- The policies from H (institutions_member_select, institutions_super_admin_update)
-- are already in place, so enabling RLS here does not lock anyone out.
-- Edge functions and the dashboard both use the service role, which bypasses RLS.
alter table public.institutions enable row level security;
