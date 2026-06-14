-- =====================================================================
-- Migration F — Holidays as date ranges
-- =====================================================================
-- Purpose:
--   Replace the single holidays.date column with a start_date/end_date
--   range (Decision 3), so a holiday can span multiple days as one row.
--
-- Why no staged pattern here:
--   The add-nullable -> backfill -> set-not-null dance in Migration D was a
--   response to EXISTING ROWS. holidays is empty (verified), so NOT NULL
--   columns can be added directly with no default and no backfill -- there
--   are no rows to violate the constraint. The pattern is not a ritual; it
--   is a workaround for pre-existing data, and there is none.
--
-- Types: start_date/end_date are `date` (a calendar concept), NOT
--   timestamptz. Decision 6's UTC rule is about instants; a holiday is a
--   whole-day date, so `date` is correct and timezone-independent.
--
-- Precondition: holidays MUST be empty when this runs (see flags). If it
--   isn't, the NOT NULL adds error out and roll back -- fail-safe, not silent.
-- =====================================================================

-- Add the range columns and drop the single-day column in one pass.
-- "date" is quoted because it is a keyword; quoting avoids any ambiguity.
-- Dropping the column also drops any index/constraint that was on it,
-- which is what we want.
alter table public.holidays
    add column start_date date not null,
    add column end_date   date not null,
    drop column "date";

-- Enforce well-formed ranges. Kept as a separate statement so it doesn't
-- depend on subcommand ordering within the ALTER above -- the columns
-- definitely exist by the time this runs.
alter table public.holidays
    add constraint holidays_date_range_check
        check (end_date >= start_date);
