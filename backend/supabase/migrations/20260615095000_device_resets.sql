-- =====================================================================
-- Migration K — device_resets: deferred identity wipe for deleted devices
-- =====================================================================
-- When a device row is deleted from the dashboard, the physical ESP32 may
-- be offline and won't know it was removed. This table acts as a durable
-- "clear your identity" queue keyed by device_id (a UUID the device stores
-- in SPIFFS). There is intentionally no FK constraint: the record must
-- outlive the device row it refers to.
--
-- Flow:
--   1. Dashboard deletes a device → inserts device_id here before deletion.
--   2. Device (online or later) calls /get-enrollment-job → function checks
--      this table first → if found, returns { decommissioned: true } and
--      removes the row → firmware clears /device_identity.json and reboots.
--   3. Device re-registers with its MAC as a brand-new unassigned device.
-- =====================================================================

create table public.device_resets (
  device_id  uuid        primary key,
  created_at timestamptz default now() not null
);
