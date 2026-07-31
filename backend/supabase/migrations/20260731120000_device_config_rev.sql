-- =====================================================================
-- OLED Phase 1 — institutions.config_rev + member_name_display
-- =====================================================================
-- Backs the ESP32 OLED display's device_config cache (see OLED integration
-- plan, Phase 1/2). The device polls get-enrollment-job every 10s and needs
-- a cheap way to know "has my institution's device-facing config changed
-- since I last saw it" without diffing fields itself.
--
-- config_rev is bumped by a BEFORE UPDATE trigger on ANY column change, not
-- a maintained list of "config" columns. Institution rows change rarely, so
-- over-bumping (e.g. a logo_url edit also bumping config_rev) costs nothing,
-- and an unscoped trigger needs no maintenance as device-facing config grows.
-- The same trigger also maintains updated_at, which has had a default now()
-- since Migration B but nothing to keep it current on update -- every
-- institution row is currently frozen at creation time.
--
-- member_name_display governs attendance-scan card rendering only
-- (enrollment cards always show the full name -- different consent
-- context, admin present). Default 'first' matches current de-facto
-- behaviour (fid_map.csv already stores full names; this only changes
-- what's shown on the OLED).
--
-- NOTE: Do NOT apply to cloud blind. Run this migration manually after review.
-- =====================================================================

alter table public.institutions
  add column config_rev bigint not null default 1;

alter table public.institutions
  add column member_name_display text not null default 'first'
    check (member_name_display in ('full', 'first', 'initial_last', 'sid', 'none'));

create or replace function public.institutions_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.config_rev = old.config_rev + 1;
  return new;
end;
$$;

create trigger trg_institutions_touch
before update on public.institutions
for each row execute function public.institutions_touch();
