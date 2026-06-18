-- =====================================================================
-- M10 — Indexes for the hot attendance queries
-- =====================================================================
-- The dashboard attendance query filters by institution_id + date range and
-- orders by date desc; mark-absent scans by institution_id + date + status.
-- Only institution_id was indexed, forcing scans+sorts as the table grows.
-- =====================================================================

create index if not exists attendance_institution_date_idx
  on public.attendance (institution_id, date desc);

create index if not exists attendance_institution_date_status_idx
  on public.attendance (institution_id, date, status);
