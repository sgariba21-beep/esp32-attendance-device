-- =====================================================================
-- Recurring holidays
-- =====================================================================
-- Adds a `recurring` flag so calendar holidays like Christmas (25 Dec every
-- year) are entered once and matched every year. Recurrence is date-based:
-- only the month and day of start_date/end_date are significant; the year
-- component is ignored by the mark-absent matcher. Non-recurring holidays
-- keep their existing full-date behaviour.
-- =====================================================================

alter table public.holidays
    add column recurring boolean not null default false;
