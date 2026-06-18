-- =====================================================================
-- M1 — Remove the dead devices.mode column
-- =====================================================================
-- devices.mode was settable from the dashboard but read by NOTHING: actual
-- present/absent vs time-in/out behaviour is governed by the institution-level
-- student_scan_mode / staff_scan_mode columns (see log-attendance / mark-absent),
-- and the firmware never sends or reads a device mode. Removing it eliminates a
-- misleading control. Idempotent.
-- =====================================================================

alter table public.devices drop column if exists mode;
