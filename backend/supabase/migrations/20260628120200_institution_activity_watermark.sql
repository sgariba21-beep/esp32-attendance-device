-- =====================================================================
-- T3p — Per-institution change watermark (polling replacement for Realtime SSE)
-- =====================================================================
-- Creates institution_activity(institution_id PK, last_change_at) and lightweight
-- AFTER triggers on the four tables the dashboard watches for live updates.
-- The /api/changes endpoint reads last_change_at; the client polls every 10-15s
-- and calls router.refresh() only when the watermark advances. This replaces the
-- Supabase Realtime SSE stream (app/api/realtime-stream/route.ts, see T3f/T16).
--
-- Trigger design: AFTER … FOR EACH ROW so the trigger fires post-commit.
-- Uses UPSERT on institution_activity — one row per institution, cheaply updated.
-- institution_id may be NULL for unassigned devices; those rows are skipped.
--
-- Do NOT auto-apply to cloud; run after review.
-- =====================================================================

create table if not exists public.institution_activity (
  institution_id uuid primary key references public.institutions(id) on delete cascade,
  last_change_at timestamptz not null default now()
);

-- ── Shared trigger function ──────────────────────────────────────────────────
create or replace function public.touch_institution_activity()
returns trigger language plpgsql as $$
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
  insert into public.institution_activity(institution_id, last_change_at)
  values (iid, now())
  on conflict (institution_id)
  do update set last_change_at = excluded.last_change_at;
  return coalesce(new, old);
end;
$$;

-- ── Triggers ─────────────────────────────────────────────────────────────────
-- attendance: high-frequency driver — every scan lands here
create trigger trg_activity_attendance
after insert or update or delete on public.attendance
for each row execute function public.touch_institution_activity();

-- members: admin creates/updates/deactivates members
create trigger trg_activity_members
after insert or update or delete on public.members
for each row execute function public.touch_institution_activity();

-- devices: admin assigns or renames devices
create trigger trg_activity_devices
after insert or update or delete on public.devices
for each row execute function public.touch_institution_activity();

-- periods: admin opens/closes academic terms
create trigger trg_activity_periods
after insert or update or delete on public.periods
for each row execute function public.touch_institution_activity();
