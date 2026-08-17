-- =====================================================================
-- Lock down institution_activity with RLS
-- =====================================================================
-- institution_activity (T3p, 20260628120200_institution_activity_watermark.sql)
-- was created with RLS left disabled. Combined with the default anon/
-- authenticated table grants every table in this schema gets, that left
-- every institution's last_change_at fully readable AND writable
-- (INSERT/UPDATE/DELETE) by anyone holding just the anon key. Flagged by
-- the Supabase security linter (rls_disabled_in_public).
--
-- Reads: mirrors institutions_member_select (20260615070000_rls_policies.sql)
-- -- super_admin/admin read their own institution's watermark row. The
-- dashboard currently reads this exclusively via the service role
-- (frontend/app/api/changes/route.ts, createAdminClient) and bypasses RLS
-- entirely; this policy is the same dormant enforcement layer the other
-- tables in 20260615070000_rls_policies.sql already carry, for the moment
-- a direct authenticated client read is introduced. No anon policy --
-- anon gets no access at all.
--
-- Writes: no INSERT/UPDATE/DELETE policy for authenticated/anon. This
-- table is written exclusively by the touch_institution_activity()
-- trigger and by the service role (which bypasses RLS globally). The
-- trigger function is switched to SECURITY DEFINER (same idiom as
-- auth_institution_id() etc.) so it keeps working even if a future
-- authenticated-role write to attendance/members/devices/periods
-- activates the currently-dormant path noted in
-- 20260615070000_rls_policies.sql -- without this, RLS would block the
-- trigger's own upsert on institution_activity and roll back the whole
-- statement.
-- =====================================================================

alter table public.institution_activity enable row level security;

create policy "institution_activity_member_select" on public.institution_activity
  for select to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  );

create or replace function public.touch_institution_activity()
returns trigger language plpgsql
security definer set search_path = '' as $$
declare
  iid uuid;
begin
  -- NEW is null on DELETE, OLD is null on INSERT
  iid := coalesce(
    case when TG_OP <> 'DELETE' then new.institution_id else null end,
    case when TG_OP <> 'INSERT' then old.institution_id else null end
  );
  if iid is null then
    return coalesce(new, old);
  end if;
  insert into public.institution_activity(institution_id, last_change_at)
  values (iid, now())
  on conflict (institution_id)
  do update set last_change_at = excluded.last_change_at;
  return coalesce(new, old);
end;
$$;
