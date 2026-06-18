-- =====================================================================
-- Migration — Per-institution brand theming
-- =====================================================================
-- Purpose:
--   Let each institution define a brand colour that re-skins the dashboard
--   accent (buttons, active nav, focus rings, key figures). The dashboard
--   shell reads theme_primary and injects it as CSS variables server-side.
--
-- Safety:
--   Adds two nullable columns with no default behaviour change. NULL means
--   "use the platform default accent", so existing tenants render unchanged
--   until a colour is chosen. Fully reversible (drop columns).
-- =====================================================================

alter table public.institutions
    add column if not exists theme_primary text,   -- brand colour, '#rrggbb'
    add column if not exists theme_preset  text;   -- curated preset key or 'custom'

comment on column public.institutions.theme_primary is
    'Brand accent colour as a #rrggbb hex string. NULL → platform default. '
    'Applied as the dashboard --primary CSS variable.';
comment on column public.institutions.theme_preset is
    'Key of the curated palette preset (e.g. ''indigo'', ''emerald''), or '
    '''custom'' for a hand-entered hex. NULL → default.';

-- Light validation: reject obviously malformed values while allowing NULL.
-- Accepts #rgb and #rrggbb, case-insensitive.
alter table public.institutions
    add constraint institutions_theme_primary_hex
    check (
        theme_primary is null
        or theme_primary ~* '^#([0-9a-f]{3}|[0-9a-f]{6})$'
    );

-- Seed the original tenant (OLAG) with the school's brand so the redesign
-- ships with a real colour rather than the platform default.
update public.institutions
   set theme_primary = '#1d4ed8', theme_preset = 'blue'
 where id = '00000000-0000-4000-8000-000000000001'
   and theme_primary is null;
