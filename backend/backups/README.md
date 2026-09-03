# Database backups

Authoritative point-in-time backups of the **cloud** Supabase database. These
must be taken with project credentials, so they are produced by a human/CI with
access — not by the code-review tooling.

The files already in this folder (`schema_pre-fixes.sql`, `backup_28-06-2026.sql`)
are historical snapshots from the June 2026 security-fix rollout, kept for
reference. They are **not** current — do not restore from them.

## When

Take **two** backups around any migration rollout:

1. **`pre`** — *before* applying the migration set (capture the current live state first).
2. **`post`** — *after* all migrations are applied and the e2e checklist passes.

Name files `schema_pre_YYYY-MM-DD.sql` and `schema_post_YYYY-MM-DD.sql`
(add `data_…` variants if you also dump data).

## How

### Option A — Supabase CLI (project linked)

```bash
# one-time: supabase login && supabase link --project-ref lxpemewonievaazboyez

# schema only (roles + schema)
supabase db dump --linked -f backend/backups/schema_pre-fixes_$(date +%F).sql

# full data dump (optional, large)
supabase db dump --linked --data-only -f backend/backups/data_pre-fixes_$(date +%F).sql
```

### Option B — pg_dump (direct connection string)

```bash
# Get the connection string from: Supabase Dashboard → Project Settings → Database
pg_dump "postgresql://postgres:<password>@db.lxpemewonievaazboyez.supabase.co:5432/postgres" \
  --schema=public --no-owner \
  -f backend/backups/schema_pre-fixes_$(date +%F).sql
```

Repeat with `post-fixes` in the filename once the migrations are applied and the
test checklist passes.

> Do **not** commit dumps that contain secrets (e.g. `institutions.device_secret`)
> to a public repo. Keep data dumps out of version control or encrypt them.
