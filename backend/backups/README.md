# Database backups

Authoritative point-in-time backups of the **cloud** Supabase database. These
must be taken with project credentials, so they are produced by a human/CI with
access — not by the code-review tooling.

> The old `backend/full_backup.sql` is a **stale Phase-1 dump** and is clearly
> labelled as such at the top of the file. Do not use it to restore.

## When (L6)

Take **two** backups around the security-fix rollout:

1. **`pre-fixes`** — *before* applying the new `20260615120000_*` … `20260615127000_*`
   migrations (i.e. capture the current live state first).
2. **`post-fixes`** — *after* all migrations are applied and verified.

Name files `schema_pre-fixes_YYYY-MM-DD.sql` and `schema_post-fixes_YYYY-MM-DD.sql`
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
