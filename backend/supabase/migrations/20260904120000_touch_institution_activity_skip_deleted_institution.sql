-- =====================================================================
-- Fix: deleting an institution fails with
--   insert or update on table "institution_activity" violates foreign key
--   constraint "institution_activity_institution_id_fkey"
-- =====================================================================
-- DELETE FROM institutions removes the institutions row first, then fires
-- the ON DELETE CASCADE actions on every institution_id FK (members,
-- devices, periods, attendance, ...). The cascade deletes on the four
-- tables that carry trg_activity_* (20260628120200_institution_activity_
-- watermark.sql) fire touch_institution_activity() AFTER DELETE FOR EACH
-- ROW, which upserts an institution_activity row for the institution being
-- deleted. That parent row is already gone, so the immediate (non-
-- deferrable) FK institution_activity_institution_id_fkey rejects the
-- write and the whole DELETE rolls back.
--
-- institution_activity is itself ON DELETE CASCADE off institutions, so
-- the watermark row for a deleted institution is meant to disappear
-- anyway -- the trigger just has to stop resurrecting it. Guard the upsert
-- with an existence check: during the institution's own cascade delete the
-- row is already absent in this transaction's snapshot, so the write is
-- skipped. Every ordinary insert/update/delete on attendance/members/
-- devices/periods still sees its institution present, so the watermark
-- behaviour is unchanged.
--
-- SECURITY DEFINER + empty search_path carried over unchanged from
-- 20260817120000_institution_activity_rls.sql.
-- =====================================================================

create or replace function public.touch_institution_activity()
returns trigger language plpgsql
security definer set search_path = '' as $$
declare
  iid uuid;
begin
  -- NEW is null on DELETE, OLD is null on INSERT
  iid := coalesce(
    case when TG_OP <> 'DELETE' then new.institution_id else null end,
    case when TG_OP <> 'INSERT' then old.institution_id else null end
  );
  if iid is null then
    return coalesce(new, old);
  end if;
  -- Parent institution already gone (e.g. mid-cascade during a
  -- DELETE FROM institutions) -- its watermark row is cascade-deleted too,
  -- so there is nothing to touch and the FK would reject the upsert.
  if not exists (select 1 from public.institutions where id = iid) then
    return coalesce(new, old);
  end if;
  insert into public.institution_activity(institution_id, last_change_at)
  values (iid, now())
  on conflict (institution_id)
  do update set last_change_at = excluded.last_change_at;
  return coalesce(new, old);
end;
$$;
