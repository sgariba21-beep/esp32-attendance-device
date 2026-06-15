-- =====================================================================
-- L3 — Prevent duplicate holidays
-- =====================================================================
-- After the date-range migration the holidays table had no uniqueness, so the
-- createHoliday 23505 ("already exists for that date range") handler was dead
-- code and exact-duplicate holidays could be created. Add a uniqueness guard.
--
-- NOTE: if any institution already has exact-duplicate (start,end,recurring)
-- rows, this will fail loudly — remove the duplicates, then re-run.
-- =====================================================================

alter table public.holidays
  add constraint holidays_institution_range_key
    unique (institution_id, start_date, end_date, recurring);
