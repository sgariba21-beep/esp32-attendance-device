-- =====================================================================
-- Migration H — RLS policies  (RLS is already ENABLED; this adds policies
--                              and helper functions ONLY)
-- =====================================================================
-- Model:
--   super_admin -> all rows, all tables, institution-scoped
--   admin       -> full on members/periods/attendance/holidays/
--                  enrollment_jobs, institution-scoped; NO devices
--   teacher,staff -> READ-ONLY on members + attendance, their unit only
--   platform_admin -> NOT handled here; bypasses RLS via the service role
--
-- NULL behaviour is fail-CLOSED: if a caller has no profile (or a NULL
-- institution_id, e.g. a platform_admin going through authenticated by
-- mistake), the helpers return NULL, every `= NULL` is false, and they see
-- nothing. That is the safe direction.
--
-- These policies govern the `authenticated` role. They are currently dormant
-- for the dashboard, which reads via the service role (RLS-bypassing); they
-- are the enforcement layer the moment any authenticated (non-service)
-- access is introduced. Defence in depth either way.
-- =====================================================================


-- ---------- Helper functions -----------------------------------------
-- SECURITY DEFINER + empty search_path: see the explanation above.
-- STABLE so the planner evaluates them at most once per statement.

create or replace function public.auth_institution_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select institution_id from public.profiles where id = auth.uid()
$$;

create or replace function public.auth_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.auth_assigned_unit()
returns text language sql stable security definer set search_path = '' as $$
  select assigned_unit from public.profiles where id = auth.uid()
$$;

-- Resolves a member's unit for attendance teacher/staff scoping. Definer so
-- the attendance policy is self-contained and does not depend on members'
-- own RLS. *** Reads members.unit_name -- swap the column here if the unit
-- lives elsewhere (see the blocker above). ***
create or replace function public.auth_member_unit(p_member_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select unit_name from public.members where id = p_member_id
$$;


-- ---------- members --------------------------------------------------
-- super_admin + admin: full access in their institution.
create policy "members_admin_all" on public.members
  for all to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  )
  with check (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  );

-- teacher + staff: read-only, only their assigned unit.
-- *** unit_name is the assumed members unit column -- swap if needed. ***
create policy "members_teacher_staff_select" on public.members
  for select to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('teacher','staff')
    and unit_name = (select public.auth_assigned_unit())
  );


-- ---------- devices --------------------------------------------------
-- super_admin ONLY. admin is deliberately excluded; teacher/staff too.
create policy "devices_super_admin_all" on public.devices
  for all to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) = 'super_admin'
  )
  with check (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) = 'super_admin'
  );


-- ---------- periods --------------------------------------------------
create policy "periods_admin_all" on public.periods
  for all to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  )
  with check (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  );


-- ---------- attendance -----------------------------------------------
create policy "attendance_admin_all" on public.attendance
  for all to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  )
  with check (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  );

-- teacher + staff: read-only, only attendance for members in their unit.
-- auth_member_unit is evaluated per row (it depends on member_id), unlike
-- the per-statement helpers above -- fine at school volumes.
create policy "attendance_teacher_staff_select" on public.attendance
  for select to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('teacher','staff')
    and public.auth_member_unit(member_id) = (select public.auth_assigned_unit())
  );


-- ---------- enrollment_jobs ------------------------------------------
create policy "enrollment_jobs_admin_all" on public.enrollment_jobs
  for all to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  )
  with check (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  );


-- ---------- holidays -------------------------------------------------
create policy "holidays_admin_all" on public.holidays
  for all to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  )
  with check (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  );


-- ---------- profiles -------------------------------------------------
-- Self-read for everyone. Recursion-free by construction: it compares id to
-- auth.uid() directly and never reads profiles inside the policy.
create policy "profiles_self_select" on public.profiles
  for select to authenticated
  using ( id = auth.uid() );

-- super_admin manages users in their institution. (The helpers are DEFINER,
-- so calling them here does not recurse on profiles.)
create policy "profiles_super_admin_all" on public.profiles
  for all to authenticated
  using (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) = 'super_admin'
  )
  with check (
    institution_id = (select public.auth_institution_id())
    and (select public.auth_role()) = 'super_admin'
    and role <> 'platform_admin'
  );


-- ---------- institutions ---------------------------------------------
-- Any authenticated user reads THEIR OWN institution (UI name/logo/labels).
create policy "institutions_member_select" on public.institutions
  for select to authenticated
  using (
    id = (select public.auth_institution_id())
    and (select public.auth_role()) in ('super_admin','admin')
  );

-- super_admin updates their own institution (settings page). INSERT/DELETE
-- of institutions is platform_admin via service role -- no policy here.
create policy "institutions_super_admin_update" on public.institutions
  for update to authenticated
  using (
    id = (select public.auth_institution_id())
    and (select public.auth_role()) = 'super_admin'
  )
  with check (
    id = (select public.auth_institution_id())
    and (select public.auth_role()) = 'super_admin'
  );
