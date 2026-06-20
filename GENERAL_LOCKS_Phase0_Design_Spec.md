# GENERAL LOCKS — Phase 0 Design Lock / Spec

**Tenant:** GENERAL LOCKS (dreadlock shop) — embedded retail + loyalty module on the
existing multi-tenant ESP32 attendance platform.
**Scope of this document:** specification only. **No migrations, no TypeScript, no edge
functions are written in Phase 0.** This locks the schema, RBAC, nav IA and locale so
Phase 1 can implement against a frozen target.
**Date:** 2026-06-20 · **Author:** design lock for owner sign-off.

> Grounded in the current code as it actually behaves:
> [`dal.ts`](frontend/lib/supabase/dal.ts), [`ownership.ts`](frontend/lib/supabase/ownership.ts),
> [`types.ts`](frontend/lib/types.ts), [`sidebar.tsx`](frontend/components/sidebar.tsx),
> [`mobile-bottom-nav.tsx`](frontend/components/mobile-bottom-nav.tsx), and the existing
> migrations under `backend/supabase/migrations/`.

---

## 0. Conventions inherited from the existing codebase (the rules every new table obeys)

These are observed facts from the current migrations and DAL, not new inventions. Every
retail table below conforms to them.

| Convention | Source of truth | Applied as |
|---|---|---|
| PK | every table | `id uuid primary key default gen_random_uuid()` |
| Tenant scope | `20260614124000_institution_scoping.sql` | `institution_id uuid not null references public.institutions(id)` + index `<table>_institution_id_idx` |
| Tenant-delete fan-out | `20260614180000_cascade_institution_deletion.sql` | `institution_id` FK is **ON DELETE CASCADE** |
| RLS (defence-in-depth) | `20260613120000_add_profiles.sql`, `20260607122000_holidays_rls.sql` | `enable row level security;` + policy `"service role full access" for all using ((select auth.role()) = 'service_role')` |
| Money | memory `general-locks-retail` | `NUMERIC(10,2)` (max 99,999,999.99 — ample for a single shop) |
| Bookkeeping timestamps | `institutions` table | `timestamptz not null default now()` — **stored UTC, displayed in the institution timezone** |
| Business-day date | `attendance.date` / `log-attendance` | a plain `date` column **computed server-side in `Africa/Accra`**, never `now()::date` in UTC |
| Soft-delete | memory invariant | `active boolean not null default true`; the app archives, it does not hard-delete catalog/identity rows |
| `type`/`role` are **text + CHECK, not pg enums** | `institutions` (`check (type in …)`), `profiles` (`check (role in …)`) | extend by **drop + re-add constraint** inside one transaction (same as `20260615060000_roles_and_device_display_name.sql`) |
| Ownership contract | [`ownership.ts:24`](frontend/lib/supabase/ownership.ts) | `ownsRecord(table, id, session)` selects `institution_id where id = $id`. **Every table MUST expose both `id` and `institution_id` with no join.** |
| Service-role data access | [`dal.ts`](frontend/lib/supabase/dal.ts), README | dashboard reads/writes via `createAdminClient()` (RLS-bypassing); RLS is dormant defence-in-depth |

> **`ownsRecord` consequence that drives one design choice:** `transaction_items` is reachable
> via its parent `transaction`, but [`ownsRecord`](frontend/lib/supabase/ownership.ts:33) does a
> **flat** `select institution_id from <table> where id = $id` — no joins. So `transaction_items`
> **must carry its own `institution_id`** (denormalised from its parent) or it can never be
> ownership-checked. Same for every other table. This is why all 8 tables below have
> `institution_id`, even the child line-item table.

### On-delete strategy for intra-tenant FKs (the NO ACTION vs RESTRICT subtlety)

We have two competing requirements:

1. Deleting a whole institution must **cascade cleanly** (the codebase explicitly added
   `ON DELETE CASCADE` on every `institution_id` for exactly this).
2. Hard-deleting a *single* client/product/service that has sales history must be **blocked**
   (history must stay joinable; we soft-delete instead).

`ON DELETE RESTRICT` satisfies (2) but **breaks (1)**: RESTRICT is checked immediately, so when
an institution teardown cascades, deleting a `client` row can fire before the referencing
`transactions` rows are gone, and the statement aborts.

`ON DELETE NO ACTION` (the Postgres **default**) satisfies **both**: it is checked at
*end-of-statement*. During institution teardown, the referencing `transactions` are themselves
deleted via their own `institution_id` CASCADE in the same statement, so by end-of-statement
nothing dangles and the check passes. But a standalone hard-delete of one client *with* sales
still fails (the sales aren't being deleted) — which is the protection we want, and the reason
the app archives instead.

**Therefore:** intra-tenant references (`client_id`, `product_id`, `service_id`, `reward_id`)
use **ON DELETE NO ACTION**. `institution_id` stays CASCADE. `transaction_id` (line item →
its sale) is CASCADE (a line item has no meaning without its sale). Stylist attribution
(`staff_id → members`) is **SET NULL**, mirroring the existing "deletion preserves records"
idiom on `members.device_id` and `attendance.device_id`.

---

## A. Column-level schema — all 8 tables

Notation: `PK` primary key · `FK→T` foreign key to T · `NN` not null · `Ø` nullable.
All tables additionally get `enable row level security` + the single
`"service role full access"` policy (shown once, identical for all 8).

```sql
-- The one RLS policy attached to every retail table (verbatim shape, per table):
alter table public.<table> enable row level security;
create policy "service role full access" on public.<table>
  for all using ((select auth.role()) = 'service_role');
```

---

### A.1 `clients` — identified buyers (NOT a member_type)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `institution_id` | uuid | NN | — | FK→institutions **CASCADE** |
| `name` | text | NN | — | display name |
| `phone` | text | NN | — | canonical E.164 `+233XXXXXXXXX` (§D) — loyalty identity key (A-1 confirmed: mandatory) |
| `area_of_residence` | text | Ø | — | from assessment (`clients(name, phone, area_of_residence)`) |
| `active` | boolean | NN | `true` | soft-delete / archive flag |
| `created_at` | timestamptz | NN | `now()` | UTC, displayed Accra |
| `updated_at` | timestamptz | NN | `now()` | UTC; bump on edit |

**Constraints / indexes**
- `clients_institution_id_idx` on `(institution_id)`.
- **Unique** `clients_institution_phone_key` on `(institution_id, phone)` — phone is the loyalty
  identity key; no duplicate client records per tenant. (A-1 confirmed: phone mandatory, so a plain
  unique — not partial — is correct.)
- `clients_institution_name_idx` on `(institution_id, lower(name))` for typeahead search.
- RLS: service role full access.

---

### A.2 `products` — retail catalog (soft-delete)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `institution_id` | uuid | NN | — | FK→institutions **CASCADE** |
| `name` | text | NN | — | catalog name |
| `price` | NUMERIC(10,2) | NN | — | `check (price >= 0)` |
| `active` | boolean | NN | `true` | soft-delete; sold products are **never hard-deleted** |
| `created_at` | timestamptz | NN | `now()` | |
| `updated_at` | timestamptz | NN | `now()` | |

**Constraints / indexes**
- `products_institution_id_idx` on `(institution_id)`.
- Partial unique `products_institution_name_key` on `(institution_id, lower(name)) where active`
  — no two *active* products share a name. *(assumption A-7.)*
- RLS: service role full access.

> Price edits change `products.price` for **future** sales only. Past sales keep their snapshot
> in `transaction_items.unit_price` (A.6). Editing a product never re-prices history.

---

### A.3 `services` — service catalog (soft-delete)

Identical shape to `products` (a service is a sellable line item just like a product). Kept as
a **separate table** so the line-item "exactly one of product/service" CHECK is meaningful and
so reporting can split goods vs services.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `institution_id` | uuid | NN | — | FK→institutions **CASCADE** |
| `name` | text | NN | — | e.g. "Retwist", "Wash & style" |
| `price` | NUMERIC(10,2) | NN | — | `check (price >= 0)` |
| `active` | boolean | NN | `true` | soft-delete |
| `created_at` | timestamptz | NN | `now()` | |
| `updated_at` | timestamptz | NN | `now()` | |

**Constraints / indexes**: `services_institution_id_idx`; partial unique
`services_institution_name_key on (institution_id, lower(name)) where active`; RLS service role.

*(Optional, deferred: `duration_minutes` — out of Phase-0 scope; flag A-12 if scheduling matters.)*

---

### A.4 `client_attendance` — one visit per client per day

Mirrors `attendance` semantically: a `date` (business day, Accra) plus the capture instant.

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `institution_id` | uuid | NN | — | FK→institutions **CASCADE** |
| `client_id` | uuid | NN | — | FK→clients **NO ACTION** |
| `date` | date | NN | — | **business day in `Africa/Accra`**, set server-side (not UTC) |
| `created_at` | timestamptz | NN | `now()` | exact check-in instant, UTC |

**Constraints / indexes**
- **`client_attendance_institution_client_date_key UNIQUE (institution_id, client_id, date)`**
  — Decision 2. Makes "log visit" **idempotent**: a second scan the same day is `ON CONFLICT DO NOTHING`.
  Also serves the loyalty visit-count queries.
- `client_attendance_institution_date_idx` on `(institution_id, date)` for daily reporting
  (parallels `attendance_institution_date_idx`).
- RLS: service role full access.

*(assumption A-6: `client_id` on-delete — NO ACTION here for the uniform "force soft-delete"
invariant; CASCADE is a defensible alternative for a purely-subordinate visit log. Flagged.)*

---

### A.5 `transactions` — a sale (every buyer identified)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `institution_id` | uuid | NN | — | FK→institutions **CASCADE** |
| `client_id` | uuid | **NN** | — | FK→clients **NO ACTION** — Decision 1, no anonymous sales |
| `staff_id` | uuid | Ø‡ | — | FK→members **SET NULL** — stylist attribution (preserve sale if stylist removed) |
| `total` | NUMERIC(10,2) | NN | — | `check (total >= 0)` — snapshot sum of line items |
| `note` | text | Ø | — | optional |
| `created_at` | timestamptz | NN | `now()` | sale instant, UTC, displayed Accra |

**Constraints / indexes**
- `transactions_institution_id_idx` on `(institution_id)`.
- `transactions_institution_created_idx` on `(institution_id, created_at desc)` — sales history.
- `transactions_institution_client_idx` on `(institution_id, client_id)` — per-client spend / loyalty.
- `transactions_staff_idx` on `(staff_id)` — stylist performance reports.
- RLS: service role full access.

> `total` is stored (denormalised) so a sale carries its own immutable total even as catalog
> prices change. It must equal `sum(transaction_items.line_total)`. *(assumption A-3: enforce
> with a deferred trigger, or trust the server action that writes both rows in one transaction?
> Recommend: write atomically in the server action; skip the trigger at single-shop scale.)*
> ‡assumption A-2: is a stylist mandatory on every sale, or optional for product-only purchases?
> Spec defaults to optional (nullable + SET NULL).

---

### A.6 `transaction_items` — line items, **price + name snapshot at sale time**

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `institution_id` | uuid | NN | — | FK→institutions **CASCADE** — *carried so `ownsRecord` works without a join* |
| `transaction_id` | uuid | NN | — | FK→transactions **CASCADE** (line item dies with its sale) |
| `product_id` | uuid | Ø | — | FK→products **NO ACTION** |
| `service_id` | uuid | Ø | — | FK→services **NO ACTION** |
| `item_name` | text | NN | — | **snapshot** of catalog name at sale time |
| `unit_price` | NUMERIC(10,2) | NN | — | **snapshot** of catalog price at sale time; `check (unit_price >= 0)` |
| `quantity` | integer | NN | `1` | `check (quantity > 0)` |
| `line_total` | NUMERIC(10,2) | NN | *generated* | `generated always as (unit_price * quantity) stored` (same STORED-generated idiom as `devices.display_name`) |
| `created_at` | timestamptz | NN | `now()` | |

**Constraints / indexes**
- **Exactly one of product/service:**
  `check (num_nonnulls(product_id, service_id) = 1)`
  (named `transaction_items_one_target_chk`). This is the hard invariant from the assessment.
- `transaction_items_transaction_id_idx` on `(transaction_id)`.
- `transaction_items_institution_id_idx` on `(institution_id)`.
- Optional reporting indexes `(product_id)`, `(service_id)`.
- RLS: service role full access.

> **Snapshot contract:** `item_name` and `unit_price` are copied from the catalog at insert and
> are **never** rewritten by catalog edits. The `product_id`/`service_id` FKs are retained only
> for joinable reporting; they are NO ACTION (catalog rows are soft-deleted, never hard-deleted),
> which is precisely how we sidestep the SET-NULL-vs-CHECK conflict (a SET NULL would null the
> only non-null target and violate `num_nonnulls(...) = 1`).

---

### A.7 `rewards` — loyalty rule definitions (repeatable punch-cards)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `institution_id` | uuid | NN | — | FK→institutions **CASCADE** |
| `name` | text | NN | — | e.g. "Free wash every 10 visits" |
| `metric` | text | NN | — | `check (metric in ('visits','spend'))` — count visits or cedis spent |
| `threshold` | NUMERIC(10,2) | NN | — | `check (threshold > 0)` — N visits (whole) or N cedis |
| `repeatable` | boolean | NN | `true` | Decision 3 |
| `window_type` | text | NN | — | `check (window_type in ('lifetime','rolling_days','since_last_issuance'))` |
| `window_days` | integer | Ø | — | required iff `window_type='rolling_days'` |
| `auto_issue` | boolean | NN | `false` | Decision 4: `true` ⇒ a pg_cron job auto-issues (analog to `mark-absent`) |
| `active` | boolean | NN | `true` | enable / archive |
| `description` | text | Ø | — | optional |
| `created_at` | timestamptz | NN | `now()` | |
| `updated_at` | timestamptz | NN | `now()` | |

**Constraints / indexes**
- `rewards_window_days_chk`:
  `check ((window_type = 'rolling_days') = (window_days is not null))`.
- `rewards_institution_id_idx` on `(institution_id)`; `rewards_institution_active_idx` on `(institution_id, active)`.
- RLS: service role full access.

> **Naming flag (A-4):** the memory note wrote the third window token as `since_last_redemption`,
> but Decision 4 makes rewards **issuance-only (no redemption)**. This spec renames it to
> **`since_last_issuance`** so the token matches the semantics. Confirm before Phase 1 freezes the CHECK.

---

### A.8 `rewards_log` — issuance records (issuance-only; **not** unique per (client,reward))

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | NN | `gen_random_uuid()` | PK |
| `institution_id` | uuid | NN | — | FK→institutions **CASCADE** |
| `client_id` | uuid | NN | — | FK→clients **NO ACTION** |
| `reward_id` | uuid | NN | — | FK→rewards **NO ACTION** |
| `source` | text | NN | `'manual'` | `check (source in ('manual','auto'))` — human-issued vs pg_cron |
| `issued_by` | uuid | Ø | — | FK→profiles **SET NULL** — null ⇒ system/cron auto-issue |
| `note` | text | Ø | — | optional |
| `issued_at` | timestamptz | NN | `now()` | issuance instant, UTC, displayed Accra |

**Constraints / indexes**
- **No unique on `(client_id, reward_id)`** — Decision 3 (repeatable). Deliberately absent.
- `rewards_log_client_reward_issued_idx` on `(institution_id, client_id, reward_id, issued_at desc)`
  — the hot path: "find the **last** issuance for this client+reward" to bound the
  `since_last_issuance` window.
- `rewards_log_institution_reward_idx` on `(institution_id, reward_id, issued_at)` — the cron scan.
- RLS: service role full access.

> **Eligibility model (drives the indexes above; pure-query, no materialised counters —
> per the "do NOT add client_stats" invariant):**
> - `window_type='since_last_issuance'` → count `client_attendance` (metric=visits) or
>   `sum(transactions.total)` (metric=spend) for the client **since `max(issued_at)`** of that
>   (client, reward); eligible when the count/sum `>= threshold`; on issue, insert a new
>   `rewards_log` row, which moves the window forward (punch-card resets).
> - `window_type='rolling_days'` → same count/sum but over the trailing `window_days`.
> - `window_type='lifetime'` → count/sum all-time; eligible at each multiple of `threshold`
>   not yet covered by an existing `rewards_log` issuance (issuances ⇒ idempotency).

---

### A.9 Constraint changes to **existing** tables (text+CHECK, drop+re-add)

```sql
-- institutions.type: add 'shop' (3rd type). Constraint is auto-named institutions_type_check
-- (unnamed inline CHECK in 20260614121000_institutions_registry.sql). Verify the conname via
-- pg_constraint defensively, as 20260615121000 does, if unsure.
alter table public.institutions drop constraint institutions_type_check;
alter table public.institutions
  add constraint institutions_type_check
  check (type in ('school', 'office', 'shop'));

-- profiles.role: add 'cashier' (same widening pattern as 20260615060000).
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin','admin','teacher','staff','platform_admin','cashier'));
```

Both are **widenings** (new set ⊇ old), so they validate against existing rows for free.

---

## B. Role-access matrix

Roles: `super_admin`, `admin`, `cashier` (new), `platform_admin`. (`teacher`/`staff` exist
platform-wide but are attendance-domain read-only roles; a shop tenant would not provision them
for retail. `platform_admin` is cross-tenant and bypasses every page gate —
[`dal.ts:49`](frontend/lib/supabase/dal.ts:49).)

Actions: **R** read · **C** create · **E** edit · **A** archive (soft-delete) · **I** issue.

| Surface (page / server action) | super_admin | admin | cashier | platform_admin |
|---|---|---|---|---|
| **Clients** — list/view | R | R | R | R |
| Clients — create | C | C | **C** | C |
| Clients — edit contact | E | E | **E** (contact fields only)† | E |
| Clients — archive | A | A | — | A |
| **Catalog (Products & Services)** — view | R | R | R (to build a sale) | R |
| Catalog — create / edit / archive | C E A | C E A | **—** | C E A |
| **Point of Sale** — record sale (`transactions` + `transaction_items`) | C | C | **C** | C |
| Sales history — view | R | R | R‡ | R |
| **Visits** (`client_attendance`) — log visit | C | C | **C** | C |
| Visits — view | R | R | R | R |
| **Rewards config** (`rewards`) — view | R | R | R (read-only loyalty status) | R |
| Rewards config — create / edit / archive | C E A | C E A | **—** | C E A |
| **Rewards issuance** (`rewards_log`) — manual issue | I | I | **—** | I |
| Rewards issuance — view log | R | R | R | R |
| **Staff attendance side** (Overview, Attendance, Staff roster, Devices, Enrollment) | per existing RBAC | per existing RBAC | — | per existing RBAC |
| **Users / Settings / Institutions / Onboarding** | per existing RBAC | per existing RBAC | **—** | platform_admin |

Decision-5 boundaries for **cashier**, restated as gates: **CAN** create clients (and edit their
contact fields to fix typos), log visits, record sales (and read what it needs to do those —
catalog, client list, loyalty status). **CANNOT** archive clients, edit/archive catalog,
configure rewards, issue rewards, manage users/settings/devices/enrollment.

Resolved (2026-06-20):
- **†A-8a (confirmed):** cashier **may edit** a client's contact fields (phone / area) to fix
  typos, but **may not** archive clients.
- **‡A-8b (confirmed):** cashier sees **all** sales (single-location, small team). No
  `transactions.created_by` column is added — restricting to own sales would have required one.

> **Enforcement note (matches the codebase):** because the dashboard uses the service role
> (RLS bypassed), these gates are enforced in app code via `requireRole(...)`
> ([`dal.ts:46`](frontend/lib/supabase/dal.ts:46)) at the page/layout level **and** every
> mutating server action must call `ownsRecord(table, id, session)`
> ([`ownership.ts`](frontend/lib/supabase/ownership.ts)) before touching a row. The
> `"service role full access"` RLS policy is dormant defence-in-depth, not the gate.

---

## C. Shop-type navigation IA

### What a `type='shop'` tenant sees vs hides

Key fact from the assessment/memory: **GENERAL LOCKS still uses the fingerprint attendance side
for its stylists** (stylists are `members` with `member_type='staff'`; they clock in/out on the
existing devices/enrollment/attendance, unchanged). So a shop tenant is configured
`track_students=false`, `track_staff=true`, and shows **both** the staff-attendance nav and the
new retail nav.

| Nav item | school | office | **shop** | Why |
|---|---|---|---|---|
| Overview (`/`) | ✓ | ✓ | ✓ | universal |
| Attendance (`/attendance`) | ✓ | ✓ | ✓ | stylist clock-in/out |
| Members (`/members`) | ✓ | ✓ (if track_students) | **✗** | shop has no students (`track_students=false`) |
| Staff (`/staff`) | if track_staff | if track_staff | **✓** | the stylists roster |
| Devices (`/devices`) | ✓ | ✓ | ✓ | clock-in hardware |
| Enrollment (`/enrollment`) | ✓ | ✓ | ✓ | fingerprint enroll for stylists |
| Academic (`/academic`) | "Academic" | "Periods & Holidays" | **"Closed Days"** (holidays only, terms hidden) | shop has no terms; closed days feed `mark-absent` so stylists aren't marked absent on shut days (A-9 confirmed) |
| Promotion (`/promotion`) | ✓ | ✗ | **✗** | already `type !== 'office'`-gated; shop also excluded |
| **Clients** (`/clients`) | ✗ | ✗ | **✓** | retail (new) |
| **Catalog** (`/catalog`) | ✗ | ✗ | **✓** | products + services (new) |
| **Point of Sale** (`/pos` or `/sales`) | ✗ | ✗ | **✓** | record sales (new) |
| **Loyalty** (`/rewards`) | ✗ | ✗ | **✓** | rewards config + issuance (new) |
| Accounts / Settings | per role | per role | per role | unchanged |
| Institutions / Onboarding | platform_admin | platform_admin | platform_admin | unchanged |

The new retail items are gated by `institution.type === 'shop'`, exactly the way Promotion is
gated today by `institution.type !== 'office'` in
[`sidebar.tsx:64`](frontend/components/sidebar.tsx:64).

### Files that change (named only — no edits in Phase 0)

1. [`frontend/components/sidebar.tsx`](frontend/components/sidebar.tsx) — `buildNavItems()`:
   add a `type === 'shop'` block pushing Clients / Catalog / POS / Loyalty (new nav `group`,
   e.g. `'retail'`, added to `GROUP_LABELS` + `GROUP_ORDER`); add `cashier` to `ROLE_LABELS`.
2. [`frontend/components/mobile-bottom-nav.tsx`](frontend/components/mobile-bottom-nav.tsx) —
   `buildPrimaryNav()` (e.g. POS as a primary tab for shops) and `buildMoreNav()` (Clients,
   Catalog, Loyalty in the More sheet); add `cashier` to `ALL_ROLES`.
3. [`frontend/lib/types.ts`](frontend/lib/types.ts) — `InstitutionConfig.type` union
   `'school' | 'office'` → `'school' | 'office' | 'shop'`. `DEFAULT_INSTITUTION` unchanged.
4. [`frontend/lib/supabase/dal.ts`](frontend/lib/supabase/dal.ts) — `UserRole` union adds
   `'cashier'`.
5. New retail route folders under `frontend/app/(dashboard)/` and their server actions
   (Phase 2+, not Phase 0).

### Are `type` / `role` pg enums or text+CHECK?

**text + CHECK, both.** Confirmed:
- `institutions.type` — `text not null default 'school' check (type in ('school','office'))`
  ([`20260614121000_institutions_registry.sql:28`](backend/supabase/migrations/20260614121000_institutions_registry.sql)).
- `profiles.role` — `text not null check (role in (...))`, last widened in
  [`20260615060000_roles_and_device_display_name.sql:19`](backend/supabase/migrations/20260615060000_roles_and_device_display_name.sql).

Exact constraint changes: see **§A.9** (drop + re-add, both are widenings).

---

## D. Locale

### Currency — GHS (Ghana Cedi)
- **Store** as `NUMERIC(10,2)` (no floats; the money convention above).
- **Format** at display only: `Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' })`
  → `GH₵1,234.56` (symbol `GH₵` / `₵`, ISO `GHS`, 2 dp, thousands separators). Centralise in a
  `formatGHS()` helper next to `theme.ts`-style utilities so every retail surface is consistent.
- No multi-currency: a shop tenant is single-currency.

### Timezone — `Africa/Accra` (UTC+0, no DST)
- Already the convention: `institutions.timezone` is set to `Africa/Accra` for Ghana tenants
  and all `timestamptz` columns are **stored UTC, displayed in that timezone** (README §Database).
- **Business-day `date` columns** (`client_attendance.date`) must be computed **in Accra**
  server-side — the same rule `log-attendance`/`mark-absent` follow for `attendance.date` — so the
  `UNIQUE(institution_id, client_id, date)` "one visit per day" boundary lands on the local day,
  not the UTC day. (At UTC+0 these coincide today, but the code must derive the date from the
  institution timezone, not `now()::date`, to stay correct and consistent.)

### Phone normalization (Ghana)
Canonical stored form: **E.164 `+233XXXXXXXXX`** (country code 233 + 9 significant digits).
Normalization rule applied before insert/compare:
1. Strip everything except digits and a leading `+`.
2. `0XXXXXXXXX` (10 digits, local) → replace leading `0` with `+233`.
3. `233XXXXXXXXX` → prepend `+`.
4. `+233XXXXXXXXX` → keep.
5. Validate: exactly 9 digits after `+233`; reject otherwise.
This canonical form backs the partial-unique `(institution_id, phone)` client identity key.
*(A-1 / A-13: confirm storing E.164 vs local `0`-prefixed display form — recommend store E.164,
render local.)*

---

## Resolved decisions — confirmed 2026-06-20 (owner: "all recommended")

All 13 open items are closed; the DDL is free to freeze in Phase 1. Three of these changed the
draft (A-1, A-8a, A-9 — marked ⮕); the other ten ratified the spec default.

| # | Decision (locked) | Status |
|---|---|---|
| A-1 ⮕ | `clients.phone` **mandatory**; `UNIQUE(institution_id, phone)` (plain, not partial) — the loyalty identity key. | ✔ confirmed |
| A-2 | `transactions.staff_id` **optional** (nullable, FK→members SET NULL). | ✔ confirmed |
| A-3 | `transactions.total` stored, kept correct by the **server action** (sale+items written atomically); **no DB trigger**. | ✔ confirmed |
| A-4 | Window token is **`since_last_issuance`** (renamed from `since_last_redemption`; issuance-only). | ✔ confirmed |
| A-5 | `rewards.metric ∈ {visits, spend}` + single `threshold NUMERIC(10,2)`. | ✔ confirmed |
| A-6 | `client_attendance.client_id` = **NO ACTION**. | ✔ confirmed |
| A-7 | Catalog name unique among **active** rows only (partial unique). | ✔ confirmed |
| A-8a ⮕ | Cashier **may edit** client contact fields (phone/area); **may not** archive clients. | ✔ confirmed |
| A-8b | Cashier sees **all** sales. No `transactions.created_by` column added. | ✔ confirmed |
| A-9 ⮕ | Shop hides terms, **keeps holidays**; `/academic` relabelled **"Closed Days"**. | ✔ confirmed |
| A-10 | Shop **runs fingerprint staff attendance at launch** — devices/enrollment/attendance/staff stay enabled alongside retail. | ✔ confirmed |
| A-11 | `rewards_log.issued_by` → `profiles(id)` SET NULL; null = cron/system. | ✔ confirmed |
| A-12 | No `services.duration_minutes` / scheduling — out of scope. | ✔ confirmed |
| A-13 | Store phone E.164 (`+233…`); render local (`0…`). | ✔ confirmed |

---

## Ready for Phase 1? — checklist

- [ ] **Six settled decisions** re-affirmed against §A (client_id NN; one-visit-per-day unique;
      repeatable rewards w/ no (client,reward) unique; issuance-only log; `cashier` role;
      `type='shop'`). ✔ already settled — listed for traceability.
- [ ] **8-table schema (§A)** signed off column-by-column, including:
  - [ ] `transaction_items` snapshot (`item_name`, `unit_price`) + `num_nonnulls(...) = 1` CHECK.
  - [ ] `client_attendance` `UNIQUE(institution_id, client_id, date)` with Accra-derived `date`.
  - [ ] `rewards_log` **not** unique on (client, reward); `since_last_issuance` window.
  - [ ] every table carries `institution_id` + the `"service role full access"` RLS policy.
  - [ ] on-delete strategy (institution_id CASCADE; intra-tenant NO ACTION; staff_id SET NULL;
        transaction_id CASCADE) accepted.
- [ ] **§A.9 constraint changes** (`institutions.type += 'shop'`, `profiles.role += 'cashier'`)
      approved as drop+re-add widenings; confirm `institutions_type_check` conname.
- [ ] **Role matrix (§B)** approved (cashier may edit client contact, sees all sales — A-8a/A-8b locked).
- [ ] **Nav IA (§C)** approved; the four file touch-points (sidebar, mobile nav, types.ts,
      dal.ts) acknowledged as the Phase-2 surface.
- [ ] **Locale (§D)** approved: GHS formatting helper, Accra business-day rule, E.164 phone.
- [x] **All decisions A-1…A-13 confirmed** — 2026-06-20, "all recommended".

On sign-off, Phase 1 implements §A as a single transactional migration set (following the staged
add-column / index / RLS pattern of the existing migrations), with **no** data backfill required
(GENERAL LOCKS is a brand-new institution row).
