-- =====================================================================
-- M5 — Finalize member_type (the previous migration was comments-only)
-- =====================================================================
-- 20260614190000_remove_member_type_member.sql contained ONLY comments, so a
-- fresh rebuild kept the old default ('member') and the old 3-value check. This
-- migration makes the repo reproduce the intended live schema:
--   * any leftover 'member' rows become 'student'
--   * the check is narrowed to ('student','staff')
--   * the default becomes 'student'
-- =====================================================================

update public.members set member_type = 'student' where member_type = 'member';

do $$
declare cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.members'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%member_type%';
  if cname is not null then
    execute 'alter table public.members drop constraint ' || quote_ident(cname);
  end if;
end $$;

alter table public.members
  add constraint members_member_type_check check (member_type in ('student', 'staff')),
  alter column member_type set default 'student';
