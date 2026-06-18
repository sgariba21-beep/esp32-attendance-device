-- =====================================================================
-- Migration B — Institutions registry + OLAG seed
-- =====================================================================
-- Purpose:
--   Introduce the institutions table that every tenant-scoped table will
--   reference via institution_id. Root of the multi-tenant model. MUST
--   exist (with its seeded OLAG row) before any institution_id is added
--   anywhere (Migration D).
--
-- Safety:
--   Only CREATEs a new table and INSERTs one row. Touches no existing
--   table, so it cannot fail on non-empty data and is fully reversible
--   (drop table) -- up until Migration D backfills against the OLAG id,
--   after which that id becomes load-bearing.
-- =====================================================================

-- gen_random_uuid() is built into Postgres 13+ (no extension) and is the
-- default for future institutions created via onboarding.
-- gen_random_bytes() comes from pgcrypto and is used once below to mint a
-- strong device_secret WITHOUT writing a real secret into git history.
create extension if not exists pgcrypto with schema extensions;

create table public.institutions (
    id            uuid primary key default gen_random_uuid(),

    -- Display + identity
    name          text not null unique,
    type          text not null default 'school'
                      check (type in ('school', 'office')),
    logo_url      text,            -- nullable; points into the Storage
                                   -- bucket created in Migration I

    -- Type-aware UI labels. Defaults are deliberately NEUTRAL so a newly
    -- onboarded institution that overrides nothing still renders sensibly.
    -- The OLAG seed below sets school-specific values explicitly.
    label_member  text not null default 'Member',
    label_group   text not null default 'Group',   -- members.group_name
    label_unit    text not null default 'Unit',    -- devices.unit_name
    label_period  text not null default 'Period',  -- periods table

    -- Behaviour flags
    skip_weekends boolean not null default true,

    -- Per-institution device secret (Decisions 2 & 3). Stored plaintext by
    -- design -- it must be readable server-side to compare against the
    -- header the device sends. Generated here so the real value never
    -- enters version control. Retrieve it with:
    --   select device_secret from public.institutions where name = 'OLAG';
    device_secret text not null
                      default encode(extensions.gen_random_bytes(32), 'hex'),

    -- Display timezone (Decision 6). All timestamps are STORED in UTC;
    -- this only governs conversion at display time in the dashboard.
    -- Use IANA names: 'Africa/Accra', 'Europe/Stockholm', etc.
    timezone      text not null default 'UTC',

    -- Bookkeeping. timestamptz (NOT timestamp) so values are stored in UTC
    -- and converted per session -- the correct type for UTC-everywhere.
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

comment on table public.institutions is
    'Root tenant table. Every tenant-scoped table references institutions(id).';

-- ---------------------------------------------------------------------
-- Seed the existing single tenant (OLAG).
--
-- The id is a FIXED literal, not gen_random_uuid(). Deliberate: Migration D
-- backfills institution_id on every existing table with THIS exact value,
-- so a hardcoded constant makes that backfill deterministic and means D
-- never has to look the id up by name. Immutable once D has run.
--
-- device_secret is omitted from the column list on purpose, so the column
-- DEFAULT mints a random one. logo_url is left null until Migration I.
-- ---------------------------------------------------------------------
insert into public.institutions
    (id, name, type, label_member, label_group, label_unit, label_period,
     skip_weekends, timezone)
values
    ('00000000-0000-4000-8000-000000000001',
     'OLAG',          -- adjust to the real display name if it differs
     'school',
     'Student',       -- label_member
     'Form',          -- label_group
     'Class',         -- label_unit
     'Term',          -- label_period
     true,            -- skip_weekends
     'Africa/Accra')  -- Ghana, UTC+0
;
