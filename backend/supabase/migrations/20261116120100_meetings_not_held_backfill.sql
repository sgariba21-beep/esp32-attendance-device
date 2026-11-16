-- =====================================================================
-- Club mode — apply the not-held rule to meetings already processed
-- =====================================================================
-- Purpose:
--   20261116120000 stops the close sweep writing absences for a meeting no
--   one scanned in for. Meetings the sweep processed BEFORE that still carry
--   those absences. This applies the same rule to them: flag the meeting
--   not held and delete its absent placeholders.
--
--   Exactly the meetings the new sweep would have flagged: closed, already
--   processed, and without a single present scan. A meeting with even one
--   present scan is untouched. Cancelled meetings are never processed, so
--   they have no absences to remove.
--
--   At the time of writing (2026-11-16) this matched 12 scheduled meetings
--   of one club (2026-10-19 … 2026-11-15) holding 735 absent rows.
--
-- Reversible in effect: if a late scan for one of these meetings ever
--   arrives, the sweep re-arms it and writes its absences again (step c0).
--
-- OPTIONAL and destructive (deletes rows). Apply after 20261116120000, and
-- only if those past absences should go.
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

with unheld as (
  select m.id
    from public.meetings m
   where m.status = 'closed'
     and m.absences_written_at is not null
     and not m.not_held
     and not exists (select 1 from public.attendance a
                      where a.meeting_id = m.id
                        and a.status = 'present')
),
flagged as (
  update public.meetings m
     set not_held = true
    from unheld u
   where u.id = m.id
  returning m.id
)
delete from public.attendance a
 using unheld u
 where a.meeting_id = u.id
   and a.status = 'absent';
