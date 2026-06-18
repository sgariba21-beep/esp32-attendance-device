-- =====================================================================
-- M2 — Member IDs (sid) unique PER INSTITUTION, not globally
-- =====================================================================
-- The initial schema made students.sid globally unique; that constraint
-- survived the rename to members (as students_sid_key). In a multi-tenant world
-- two institutions must be able to reuse the same member ID, and the global
-- constraint also leaks the existence of an ID in another tenant. Replace the
-- global unique with a composite (institution_id, sid).
--
-- Safe: dropping a unique and adding a stricter-scoped one cannot fail on
-- existing data (per-institution IDs are already unique within each tenant).
-- =====================================================================

do $$
declare cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.members'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) ilike '%(sid)%';
  if cname is not null then
    execute 'alter table public.members drop constraint ' || quote_ident(cname);
  end if;
end $$;

alter table public.members
  add constraint members_institution_sid_key unique (institution_id, sid);
