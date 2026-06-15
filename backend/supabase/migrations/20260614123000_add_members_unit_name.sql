-- =====================================================================
-- Migration C-addendum — Add members.unit_name
-- =====================================================================
-- Why this exists:
--   Migration C renamed members.form -> group_name and added unit_name to
--   devices, but did not add unit_name to members. Migration H's RLS
--   policies and auth_member_unit() helper both reference members.unit_name;
--   without this column Migration H fails on "column does not exist".
--
-- Timestamp 20260615025000 places this between C (020000) and D (030000)
-- so it runs before the RLS migration H (070000).
--
-- Nullable by design: existing OLAG members have their class stored in the
-- members.class column (unchanged from the initial schema). Phase 4 will
-- populate unit_name from that column or via the UI. The RLS teacher/staff
-- scoping using unit_name will match no members until unit_name is populated,
-- which is safe (fail-closed) and expected before Phase 4.
-- =====================================================================

alter table public.members add column unit_name text;
