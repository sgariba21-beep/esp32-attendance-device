-- =====================================================================
-- T19 — Teacher scoping FK: profiles.assigned_device_id
-- =====================================================================
-- Adds a nullable FK from a profile row to the specific device that teacher
-- or staff account is scoped to. This replaces the fragile string-match on
-- assigned_unit = (devices.group_name || ' ' || devices.unit_name).
--
-- Backfill: match within the same institution using the existing
-- assigned_unit string (best-effort; NULLs are fine — the read paths
-- (T8) fall back gracefully with a clear empty-state).
--
-- assigned_unit is kept in place for now as a human-readable fallback and
-- for the user-management UI. The read paths (attendance page, staff page,
-- export route) prefer assigned_device_id when non-null.
--
-- Do NOT auto-apply to cloud; run after review.
-- =====================================================================

alter table public.profiles
  add column assigned_device_id uuid references public.devices(id) on delete set null;

-- Backfill from the existing assigned_unit string within the same institution.
update public.profiles p
set assigned_device_id = d.id
from public.devices d
where p.institution_id is not null
  and d.institution_id is not null
  and p.institution_id = d.institution_id
  and p.assigned_unit is not null
  and d.group_name is not null
  and d.unit_name is not null
  and p.assigned_unit = (d.group_name || ' ' || d.unit_name);
