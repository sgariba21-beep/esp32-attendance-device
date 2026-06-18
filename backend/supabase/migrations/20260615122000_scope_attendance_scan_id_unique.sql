-- =====================================================================
-- M3 — Attendance scan_id unique PER INSTITUTION, not globally
-- =====================================================================
-- scan_id was globally unique (attendance_scan_id_key). Device-generated scan
-- IDs can collide across institutions; a collision made log-attendance silently
-- drop a legitimate scan as a "duplicate". Scope uniqueness to the tenant.
--
-- NULL scan_ids (absent records) remain allowed in any quantity — Postgres
-- treats NULLs as distinct in a unique constraint.
-- =====================================================================

do $$
declare cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.attendance'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) ilike '%(scan_id)%';
  if cname is not null then
    execute 'alter table public.attendance drop constraint ' || quote_ident(cname);
  end if;
end $$;

alter table public.attendance
  add constraint attendance_institution_scan_id_key unique (institution_id, scan_id);
