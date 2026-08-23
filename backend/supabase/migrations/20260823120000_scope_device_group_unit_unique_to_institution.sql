-- =====================================================================
-- Fix: devices_class_form_unique isn't institution-scoped
-- =====================================================================
-- Purpose:
--   devices_class_form_unique was created back when devices only had
--   (class, form) and the product was single-tenant (Migration
--   20260602205920_remove_dname_from_devices.sql). Migration C
--   (20260614122000_structural_renames.sql) renamed those columns to
--   unit_name/group_name, and Migration D
--   (20260614124000_institution_scoping.sql) added devices.institution_id
--   -- but neither migration touched this constraint's definition. The
--   result: UNIQUE (unit_name, group_name) with no institution_id, so two
--   devices in two different institutions can't share the same group+unit
--   combo even though they're completely unrelated tenants.
--
-- Fix: drop the old constraint and recreate it scoped by institution_id.
--   NULLs in group_name/unit_name (unconfigured devices, see Migration
--   20260615090000_device_provisioning.sql) remain unconstrained -- Postgres
--   treats each NULL as distinct, so multiple not-yet-configured devices
--   per institution still coexist fine, same as before.
-- =====================================================================

alter table public.devices
  drop constraint devices_class_form_unique;

alter table public.devices
  add constraint devices_institution_group_unit_unique
    unique (institution_id, group_name, unit_name);
