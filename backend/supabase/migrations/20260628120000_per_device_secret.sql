-- =====================================================================
-- T1 — Per-device secret + revocation flag
-- =====================================================================
-- Each device now has its own secret instead of sharing an institution-wide
-- secret. assignment-poll mints and returns the per-device secret when the
-- device is first assigned. log-attendance, get-enrollment-job, and
-- update-enrollment-job now validate against this column instead of
-- institutions.device_secret.
--
-- The transitional log-attendance path (for not-yet-migrated devices) still
-- validates against institutions.device_secret until all devices re-provision.
-- That path is removed in a later migration after full rollout (see T20m docs).
--
-- devices.revoked: server-side revocation flag. A decommissioned/deleted
-- device is set revoked=true so log-attendance rejects it immediately,
-- independent of the cooperative SPIFFS wipe.
--
-- institutions.device_secret is intentionally kept (transitional — see T20m).
-- Drop it only after all devices have re-provisioned with per-device secrets.
--
-- Do NOT auto-apply to cloud; run after review.
-- =====================================================================

alter table public.devices
  add column device_secret text unique,
  add column revoked boolean not null default false;

-- Revoke signal: when a device row is deleted, the application should set
-- revoked=true first (via the devices delete action) rather than a hard delete.
-- This migration only adds the columns; the dashboard action enforces the flow.
