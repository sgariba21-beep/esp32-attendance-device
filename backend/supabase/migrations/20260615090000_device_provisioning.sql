-- =====================================================================
-- Migration J — Device provisioning support
-- =====================================================================
-- Why this exists:
--   The /register edge function creates device records using only a MAC
--   address (unassigned state: no institution, unit, or group yet). The
--   current schema after Migrations C and D prevents this:
--     - No mac column to uniquely identify the hardware before assignment
--     - institution_id is NOT NULL (Migration D)
--     - group_name and unit_name are NOT NULL (initial schema, renamed in C)
--
--   This migration fixes all three so /register can insert { mac } alone,
--   and the admin-facing assignment flow later fills in institution_id,
--   group_name, and unit_name via the dashboard devices page (Phase 4).
--
-- Backward compat:
--   mac is nullable so existing OLAG device rows (inserted without a MAC
--   before this migration) are not broken. New devices always supply a MAC.
-- =====================================================================

-- 1. MAC address: the unique hardware identifier sent by the ESP32 on boot.
--    Nullable for existing OLAG devices that predate the provisioning flow.
alter table public.devices add column mac text unique;

-- 2. Allow unassigned devices (no institution assigned yet).
alter table public.devices alter column institution_id drop not null;

-- 3. Allow devices to exist without a unit or group (unassigned state).
--    The admin sets these when assigning the device from the dashboard.
alter table public.devices alter column group_name drop not null;
alter table public.devices alter column unit_name drop not null;
