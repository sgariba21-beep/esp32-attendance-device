# Club Mode — Session-Based Attendance

**Status:** Phases 1 and 2 **live in cloud** (2026-09-26) and verified end to end.
Phase 3 migrations **live in cloud** (2026-09-27); dashboard committed on `club-mode`
but not deployed (Vercel prod tracks `oled-integration`). Phase 4 not started.
**Target:** A 4th institution type, `club`, whose unit of attendance is a *meeting*
rather than a *day*.

<!-- Do NOT auto-apply any migration in this document to cloud. Review first. -->

---

## 1. The problem

The system today assumes every tenant takes attendance **every tracked weekday**.
That assumption is load-bearing in four places:

| Where | What it assumes |
|---|---|
| `attendance` unique constraint `(member_id, date, scan_type)` — [20260614140000](backend/supabase/migrations/20260614140000_add_scan_type_and_device_mode.sql) | One attendance event per member per day. Two meetings on the same day collide; the second is swallowed as a duplicate scan. |
| `institutions.tracked_weekdays` | Attendance happens on a fixed weekly pattern. Cannot express "2nd Saturday monthly", let alone "this one Thursday". |
| `log-attendance` weekday gate — [index.ts:164](backend/supabase/functions/log-attendance/index.ts:164) | A scan on an untracked day is **silently discarded**. An impromptu meeting's scans vanish. |
| `mark-absent` daily `pg_cron` | Every active member is marked absent on every tracked day. A club meeting weekly would accrue six false absences a week. |

A club, society, committee, co-op or training cohort meets weekly, monthly, or on
no schedule at all; may run for years or dissolve in a term; and wants to know
*who came to the meetings that actually happened*.

The fix is to make a **meeting** a first-class row that attendance hangs off.

---

## 2. Decisions already taken

Recorded so they are not relitigated at implementation time.

| Decision | Choice | Consequence |
|---|---|---|
| How a meeting starts | **Scheduled in the dashboard**, plus **opened at the device** by a master finger for impromptu ones | No first-scan auto-open. Phase 4 firmware is required only for the ad-hoc path. |
| How a meeting ends | Scheduled meetings carry their own end time; ad-hoc ones close on a second master press; hard end-of-day backstop | Needs a sweep job more frequent than the current daily cron. |
| Ad-hoc master press while offline | **Must work offline** (decided at Phase 1 start). Mechanism deferred to Phase 4 | Phase 1 deliberately adds no constraint that would preclude it — see §8 B. |
| Do absences exist | **Per-tenant setting** (`institutions.track_absences`) | Some clubs enforce attendance, some do not. One flag, not two code paths. |
| Scoping | **New institution type `club`** | Mirrors how `shop` was added. A school cannot host a club inside its own tenant — accepted. |
| Scan with no meeting open | **Reject**, device shows "No meeting open" | Device must know meeting state locally. See §6 and Open Decision A. |
| Periods / seasons | **Clubs have no periods** | Lifecycle handled by the existing `institutions.status` (`active` / `suspended` / `deactivated`). |
| Hardware | Device only, same as now | No manual / phone check-in path. Not in scope. |

---

## 3. Why this is safe for existing tenants

Every attendance row that exists today has `meeting_id IS NULL`. The day-keyed
unique constraint is replaced by two keys that use **NULL semantics** to tell the
modes apart:

```sql
-- daily-mode (school / office / shop): meeting_id is always NULL, and
-- NULLS NOT DISTINCT makes those NULLs equal -> exactly the old key.
-- club: one row per meeting per day.
unique nulls not distinct (member_id, date, scan_type, meeting_id)

-- club: one row per member per meeting per scan type. Default NULLS DISTINCT,
-- so daily rows (NULL meeting_id) never collide -> constrains club rows only.
unique (meeting_id, member_id, scan_type)
```

No backfill, no data migration, no behaviour change for any live tenant. This is
the property the whole plan turns on — if it stops holding, stop and re-plan.

> **Correction to the first draft of this plan.** It proposed *partial* indexes
> (`… where meeting_id is null`). That would have broken production:
> [mark-absent](backend/supabase/functions/mark-absent/index.ts) upserts with
> `onConflict: "member_id,date,scan_type"`, which PostgREST sends as
> `ON CONFLICT (member_id, date, scan_type) DO NOTHING`. Postgres only accepts a
> partial index as the conflict arbiter if the `ON CONFLICT` clause repeats its
> `WHERE` predicate, and PostgREST cannot send one — so every tenant's nightly
> absence run would have errored (error `42P10`), silently, because mark-absent
> reports per-institution failures as strings inside a `200`. Both keys above are
> non-partial, so PostgREST can target them by column list. `NULLS NOT DISTINCT`
> needs Postgres 15+; cloud runs 17. Verified locally — see §7 Phase 1.
>
> The old `(member_id, date, scan_type)` key is **kept** in Phase 1 for the same
> reason, and dropped in Phase 2 only after mark-absent is redeployed with the new
> conflict target.

Two further pieces of existing machinery this plan leans on:

- **The device already polls every 10 s.** `get-enrollment-job` is polled on
  `ENROLL_POLL_MS = 10000` ([firmware:68](firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino:68))
  and its response already carries `device_config_*` fields behind a `config_rev`
  staleness check ([get-enrollment-job:118](backend/supabase/functions/get-enrollment-job/index.ts:118)).
  Meeting state rides on a channel that already exists.
- **Fingerprint roles are free-form strings.** `fidMapRole` is a per-fid `String`
  in the SPIFFS fid map ([firmware:222](firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino:222)),
  persisted as `fid,uniqueId,role,name` CSV. A second master finger is a new role
  value plus one new branch at [firmware:2779](firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino:2779) —
  not a redesign.

---

## 4. Data model

### 4.1 New table: `meetings`

```sql
meetings (
  id                   uuid primary key default gen_random_uuid(),
  institution_id       uuid not null references institutions(id) on delete cascade,
  device_id            uuid references devices(id) on delete set null,
  title                text,
  starts_at            timestamptz not null,  -- scheduled start, or open time for ad-hoc
  ends_at              timestamptz,           -- scheduled end; null on an open ad-hoc meeting
  opened_at            timestamptz,           -- actual
  closed_at            timestamptz,           -- actual
  origin               text not null check (origin in ('scheduled','device')),
  status               text not null check (status in ('scheduled','open','closed','cancelled')),
  absences_written_at  timestamptz,           -- idempotency guard for the close sweep
  created_at           timestamptz not null default now()
)
```

**Why `timestamptz` and not the `date` + `time` pair used by `attendance`?**
Because meeting assignment must be resolved by *instant containment* (§5), and the
existing local-wall-clock columns cannot express a range unambiguously across DST
or a timezone edit. `attendance.date` / `attendance.time` are **left exactly as they
are**, so every existing report, filter and CSV export keeps working untouched.

`device_id` uses `ON DELETE SET NULL`, matching the deliberate pattern on
`attendance` and `members` — deleting a device must never destroy history.

As built, the table also carries integrity CHECKs: `ends_at >= starts_at` (`>=` so
an ad-hoc meeting opened and closed in the same second is still closable); a
scheduled meeting must have `ends_at`; `status = 'open'` requires `opened_at`;
`status = 'closed'` requires `closed_at`; titles are NULL or 1–120 non-blank
characters. It deliberately does **not** check that `origin = 'device'` implies a
`device_id` — that would make `DELETE FROM devices` fail, because `SET NULL` would
violate it.

Also deliberately left out until Phase 4, because they depend on how the offline
master press is replayed (§8 B): "at most one open meeting per device", and an
idempotency key for replayed device events. Both are additive when they land.

### 4.2 New table: `meeting_schedules` (Phase 3)

Recurrence rules, materialised into `meetings` rows ahead of time. Attendance
carries a real FK, so meetings cannot be computed on the fly.

```sql
meeting_schedules (
  id                uuid primary key default gen_random_uuid(),
  institution_id    uuid not null references institutions(id) on delete cascade,
  device_id         uuid references devices(id) on delete set null,
  title             text,
  freq              text not null check (freq in ('weekly','monthly_nth_weekday')),
  interval_n        smallint not null default 1,  -- every N weeks
  weekday           smallint check (weekday between 1 and 7),  -- ISO, 1 = Mon
  nth               smallint,                     -- monthly: 1..5, or -1 = last
  start_time        time not null,
  duration_minutes  integer not null default 120,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
)
```

Deliberately **not** full RRULE. Weekly, every-N-weeks, and monthly-nth-weekday
cover the real cases; a general recurrence engine is a trap at this scale.

### 4.3 Altered: `attendance`

```sql
alter table attendance
  add column meeting_id uuid references meetings(id);   -- default NO ACTION
```

**Changed from the first draft, which used `ON DELETE CASCADE`.** Cascade would let
one mistaken delete silently erase a meeting's attendance. The FK now mirrors
`attendance.member_id` (NO ACTION): a meeting that has attendance **cannot be
deleted** until its rows are removed deliberately. The dashboard offers
`status = 'cancelled'` instead, and a "delete" of a meeting with scans must be an
explicit two-step (Phase 3).

NO ACTION rather than RESTRICT matters: NO ACTION is checked at the *end* of the
statement, so `DELETE FROM institutions` — which cascades to both `meetings` and
`attendance` — still succeeds. RESTRICT would fire mid-cascade and block it.

### 4.4 Altered: `institutions`

```sql
-- widen the type CHECK (the same move 20260620120000 made for 'shop')
check (type in ('school', 'office', 'shop', 'club'))

alter table institutions
  add column track_absences            boolean not null default true,
  add column meeting_preroll_minutes   integer not null default 30,
  add column meeting_postroll_minutes  integer not null default 30,
  add column meeting_autoclose_minutes integer not null default 240;
```

`track_absences` defaults `true`; `/onboarding` sets it `false` when creating a
`club`. As built it is **club-only**: the close sweep reads it, `mark-absent` does
not, so school / office / shop keep getting daily absences regardless. Extending it
to daily-mode tenants would be a separate, deliberate decision.

The minute columns carry sanity bounds: pre/post-roll `0–240`, auto-close `15–1440`.

Pre-roll and post-roll widen a scheduled meeting's acceptance window so early
arrivals and stragglers still count. Auto-close is the backstop for an ad-hoc
meeting nobody closed.

### 4.5 Watermark triggers

`meetings` must fire the existing `touch_institution_activity()` function
([20260628120200](backend/supabase/migrations/20260628120200_institution_activity_watermark.sql)),
or the dashboard's 12 s poll will not refresh when a meeting opens or closes:

```sql
create trigger trg_activity_meetings
after insert or update or delete on public.meetings
for each row execute function public.touch_institution_activity();
```

The function's deleted-institution guard
([20260904120000](backend/supabase/migrations/20260904120000_touch_institution_activity_skip_deleted_institution.sql))
already covers the `ON DELETE CASCADE` from institutions.

---

## 5. Meeting resolution — the core algorithm

For a scan from device `D` at instant `T` (parsed from the device timestamp by the
existing `parseInstant`, [log-attendance:17](backend/supabase/functions/log-attendance/index.ts:17)):

```
1. Candidate meetings := meetings where institution_id = D.institution_id
                           and (device_id = D.id or device_id is null)
                           and status in ('scheduled','open','closed')

2. Match the first whose window contains T:
     scheduled → starts_at - preroll  <=  T  <=  ends_at + postroll
     device    → opened_at            <=  T  <=  coalesce(closed_at, now())

3. No match → 200 with code "no_meeting_open" and no scan_type
   (NOT a 4xx — see "Response contract" in §7 Phase 2)

4. Insert attendance with meeting_id set, and date/time computed in the
   institution timezone exactly as today.
```

**This is the step that makes the offline queue correct.** Scans live in SPIFFS and
flush on reconnect — sometimes days later. Resolving against "whatever meeting is
open right now" would file a Saturday scan into Monday's meeting. Resolving by
timestamp containment files it correctly, and requires that **a scan be allowed to
land in an already-closed meeting**.

That in turn interacts with absences: if the close sweep already wrote an absent
placeholder, a late-arriving scan must overwrite it. The existing code already does
exactly this — the "overwrote absent placeholder" branch at
[log-attendance:293](backend/supabase/functions/log-attendance/index.ts:293) — so it is
a re-key from `date` to `meeting_id`, not new logic.

Overlapping meetings are prevented at write time: reject creating a meeting whose
window (including pre/post-roll) overlaps another for the same device. Simpler than
disambiguating at scan time.

---

## 6. How the device knows a meeting is open

The device renders scan verdicts **locally**, from the fid map — it does not wait for
a server response before showing a result, and it writes to SPIFFS before any network
attempt. So "reject with *No meeting open*" cannot be a server-side decision alone;
the device has to know.

Solution: extend the existing `get-enrollment-job` poll response with meeting state.
Bump `DEVICE_CONFIG_VERSION` from `1` to `2`
([get-enrollment-job:17](backend/supabase/functions/get-enrollment-job/index.ts:17)):

```jsonc
{
  "job": null,
  "device_config_ver": 2,
  "device_config_rev": 41,
  "device_config_meeting_open": true,
  "device_config_meeting_id": "…uuid…",
  "device_config_meeting_title": "Weekly Circle",  // truncated for the 128×64 OLED
  "device_config_meeting_ends_at": 1789234567      // epoch seconds, RTC-comparable
}
```

Worst-case latency between an organiser opening a meeting and the device accepting
scans is one poll interval — 10 s. Acceptable, but the OLED should show a
transitional state rather than a hard refusal during that window.

**Offline behaviour is the exception.** An offline device cannot know. It must accept
and queue the scan; the server resolves it by timestamp on flush, so scans for a
*scheduled* meeting land correctly and only genuinely orphaned scans are dropped.
This is deliberately inconsistent with the online path — see Open Decision A.

---

## 7. Phases

Each phase is independently reviewable. **Phase 3 is the value cut point:** a club
running scheduled meetings is fully functional with *no firmware change at all*. Only
impromptu meetings need Phase 4. Given devices are in the field and OTA is one-way,
this ordering is the point of the plan, not an accident of it.

### Phase 1 — Schema (invisible; zero behaviour change)

**Built, and applied to cloud** 2026-09-26 ~20:00 UTC via `apply_migration`, recorded
in the cloud history as `20260926200055`, `20260926200119`, `20260926200202`. Three
files in `backend/supabase/migrations/`, applied in order:

| File | Contents |
|---|---|
| `20260926120000_club_type_and_meeting_settings.sql` | Widen `institutions_type_check` to include `'club'`; add `track_absences`, `meeting_preroll_minutes`, `meeting_postroll_minutes`, `meeting_autoclose_minutes` |
| `20260926120100_meetings.sql` | `meetings` table + CHECKs + indexes, **and** its RLS policy, explicit grants, and watermark trigger |
| `20260926120200_attendance_meeting_id.sql` | `attendance.meeting_id` (NO ACTION FK); **adds** the two new unique keys; **keeps** the old one |

Deviations from the first draft of this plan, and why:

- **3 files, not 5.** RLS and the watermark trigger live in the same file as the
  table. This project auto-grants new tables to `anon` / `authenticated`, so applying
  the table without RLS — even briefly, between two files — would expose it through
  the Data API.
- **Explicit `GRANT`s to `service_role`.** Supabase stops auto-granting new public
  tables on 2026-10-30; applying after that without them would leave the edge
  functions with "permission denied for table meetings".
- **No constraint *swap* in Phase 1** — additive only (see §3). Nothing is dropped,
  so there is no window without dedup protection, and nothing to do `CONCURRENTLY`.
  (`CREATE INDEX CONCURRENTLY` also cannot run inside a transaction, which is how
  `apply_migration` and the SQL editor run a file.) Lock time is milliseconds at
  current volume (~1k attendance rows).

**Apply** each file as one unit, in order, via the SQL editor or `apply_migration`.

**Verify:**

```sql
-- old key kept, both new keys present (expect 3 rows)
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.attendance'::regclass
   and conname in ('attendance_member_date_scan_type_unique',
                   'attendance_member_date_scan_type_meeting_key',
                   'attendance_meeting_member_scan_type_key');

-- every existing row is daily-mode (expect 0)
select count(*) from attendance where meeting_id is not null;

-- meetings is locked down (expect true / true)
select relrowsecurity from pg_class where oid = 'public.meetings'::regclass;
select has_table_privilege('service_role', 'public.meetings', 'insert');
```

**Tested** (2026-09-26) on PGlite — real Postgres (18.3) compiled to WASM — against
a replica of the live cloud schema generated from its catalog: exact columns,
defaults, constraints, indexes, trigger functions, and triggers for `institutions`,
`devices`, `members`, `periods`, `attendance`, `institution_activity`. Baseline data
was seeded on the *current* schema, then each file applied in its own transaction,
as in cloud. 43 checks, all passing, including: today's mark-absent statement still
dedups; the Phase 2 conflict target works both before and after the old key is
dropped; dropping the old key first reproduces `42P10`; the partial-index design
reproduces `42P10`; every meeting CHECK; meeting, device, and whole-institution
delete paths; the watermark trigger. A mutation run (CASCADE FK, plain UNIQUE
instead of `NULLS NOT DISTINCT`) fails 5 of the checks, so the suite does detect
regressions.

*Not* tested: a from-scratch `supabase db reset` of the full migration chain (local
Docker Desktop was crashing on start), and the PostgREST layer itself — the tests
issue the SQL PostgREST generates for `upsert(…, { onConflict, ignoreDuplicates })`,
not the HTTP call. Cloud runs Postgres 17; nothing used here differs between 17 and 18.

**Verified in cloud after apply:**
- All verify queries above pass: 3 keys, 0 rows with `meeting_id`, RLS on, grants in place.
- `EXPLAIN` (no `ANALYZE`, so nothing written) of mark-absent's exact statement
  resolves its conflict arbiter to `attendance_member_date_scan_type_unique`, so the
  nightly run is unaffected. The Phase 2 target
  `(member_id, date, scan_type, meeting_id)` already resolves to
  `attendance_member_date_scan_type_meeting_key`.
- Security advisors identical before and after. Performance advisors add only
  "unused index" notices for the three empty-table `meetings` indexes. There is no
  unindexed-FK notice for `attendance.meeting_id`: the club key covers it.
- `meetings` has no legacy `"service role full access"` policy, unlike older tables,
  and needs none: cloud `service_role` has `BYPASSRLS`.

### Phase 2 — Backend

**Built, tested, and deployed to cloud** (2026-09-26) — see the runbook below.
Purely server-side. Decisions taken at the start of Phase 2:

- **`toggle-meeting` and the poll's meeting fields moved to Phase 4.** Both exist
  only for firmware, and their contracts (device timestamps, replay idempotency,
  whether an offline device needs the upcoming schedule cached) are exactly what
  the offline master-press design decides (§8 B).
- **Meeting logic lives in Postgres**, not a new edge function: set-based,
  transactional, and testable against the replica. pg_cron calls the sweep
  directly — no pg_net hop, no cron secret.
- **Expected attendees** of a meeting are the members enrolled on its device
  (fingerprints live on the sensor — nobody else can physically scan in); for an
  unbound meeting, all active tracked members.
- **Club punctuality** is measured against the meeting's own `starts_at` /
  `ends_at` with the institution's grace minutes, at whole-minute granularity like
  the daily path. Ad-hoc meetings are never judged (no scheduled start).
- **Scheduled meetings never flip to `open`**: "live" means inside the window.
  Only device meetings use `open`.

| File | What it does |
|---|---|
| `20260926130000_meeting_functions.sql` | `resolve_meeting(institution, device, instant)` (§5 algorithm, overlap precedence: bound > unbound, core window > roll, latest start); `close_due_meetings(now)` sweep; device-delete guard trigger + `meetings.device_deleted_at` |
| `20260926130100_drop_old_attendance_dedup_key.sql` | Drops `attendance_member_date_scan_type_unique`. Guarded: refuses to run if the replacement key is missing |
| `20260926130200_close_meetings_cron.sql` | `cron.schedule('close-meetings', '*/15 * * * *', …)` |
| `20260926130300_close_due_meetings_whole_seconds.sql` | Replaces `close_due_meetings` with one change: absent rows' `time` truncated to whole seconds (found by the live test) |
| `functions/mark-absent/index.ts` | Skips `type = 'club'`; `onConflict: "member_id,date,scan_type,meeting_id"` with `meeting_id: null` explicit |
| `functions/log-attendance/club.ts` *(new)* | The whole club scan path. `index.ts` branches to it right after the timestamp conversion, before the weekday / holiday / period gates; the daily path is otherwise untouched |

**The sweep** (`close_due_meetings`): closes scheduled meetings once
`ends_at + post-roll` passes; closes ad-hoc meetings at the *earlier* of their idle
deadline (last scan + auto-close) and local midnight — `closed_at` is that moment,
not the sweep time, so offline scans taken before it still resolve in; then writes
absences for every closed, unprocessed meeting. It is the **only** writer of club
absences, so meetings closed by any path (sweep, dashboard, device) get them.
`absences_written_at` means "absence pass done" and is set even when nothing was
written, so turning `track_absences` on later never floods past meetings. Tenants
with a timezone Postgres doesn't recognise are skipped, not allowed to fail the run.

**The device-delete guard.** `meetings.device_id` is `SET NULL`, and NULL means
"unbound", which the resolver lets any device match. Unguarded, deleting a device
would turn every meeting it hosted — including historic ones — into a trap for
other devices' late-flushed scans. A deleted device can never authenticate again,
so the guard (a `BEFORE DELETE` trigger, because the `SET NULL` action runs before
any `AFTER` trigger could find the rows) stamps `device_deleted_at` on all its
meetings, which the resolver then never matches; cancels its future ones; closes
any under way; and marks their absence pass done unwritten (the same delete
SET-NULLs `members.device_id`, so who was expected is unknowable). It skips itself
mid-cascade from `DELETE FROM institutions`, like the watermark trigger does.

**Response contract with the device** (firmware ≥ 1.10.0, unchanged —
[firmware:653](firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino:653),
[firmware:2108](firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino:2108)):
`200` + `scan_type` → PRESENT / TIME IN / TIME OUT; `200` without `scan_type` →
NOT LOGGED; `4xx` → ERROR **and counted as lost data** in the OLED banner; `5xx` →
kept queued and retried. So "no meeting open" is `200` + `code: "no_meeting_open"`
(the first draft's 409 would have shown ERROR and inflated "N lost"), and a failed
meeting lookup is `500` so the scan is retried, not dropped. With today's firmware a
club therefore already gets a sensible device experience: scans inside a meeting
show PRESENT, scans outside show NOT LOGGED.

**Also fixed in passing:** `log-attendance`'s institution `select` was built by
string concatenation, which supabase-js types as `GenericStringError` — 16
pre-existing type errors. It is now one literal (identical at runtime), and all
three function files pass `deno check` with zero errors.

**Tested** (local — Docker Desktop is down, so PGlite + Deno):

- SQL on PGlite against the cloud replica, club tenant in Africa/Nairobi (UTC+3) to
  exercise real offset math: Phase 1 regression 43/43, Phase 2 69/69, twice. Covers
  window edges (pre/post-roll ±1 min), overlap precedence, early close, legacy
  no-device path, tenant isolation, every sweep branch (idle deadline, local
  midnight, absences on/off with no retro-flood, time_in_out, suspended tenant,
  invalid timezone), the device guard, and institution delete through the guard.
  A mutation run removing the resolver's deleted-device filter, the timezone guard,
  and the cascade guard fails 12 checks. The drop-key guard refuses to run without
  Phase 1 and leaves the old key intact.
- `club.ts`: 14 Deno unit tests with a recording fake client — every response the
  firmware can see, the legacy auth path, time-in/out sequencing per meeting,
  placeholder overwrite, duplicates, and error → 500.

**Deploy runbook — in this order; each step is safe on its own:**

| # | Step | Verify |
|---|---|---|
| 1 | Apply `20260926130000_meeting_functions.sql` | ✅ **done** 2026-09-26: grants, trigger, column in place; sweep on empty table returns zeros |
| 2 | Deploy `mark-absent` (`--no-verify-jwt`) | ✅ **v15.** Throwaway *daily* tenant tracking all 7 days; triggered via `pg_net` exactly as the cron does: `marked 1 absent`, no `insert error`; real tenants `day not tracked — skipped`; club test tenant skipped. Re-triggered: still one row (conflict path) |
| 3 | Apply `20260926130100_drop_old_attendance_dedup_key.sql` — **only after step 2** | ✅ Old key gone; re-triggered mark-absent: no error, still one row — daily dedup now rests on the `NULLS NOT DISTINCT` key alone |
| 4 | Apply `20260926130200_close_meetings_cron.sql` | ✅ `close-meetings` job active, runs as `postgres` |
| 5 | Deploy `log-attendance` (`--no-verify-jwt`; ships `index.ts` + `club.ts` + `deno.json`) | ✅ **v15.** Real HTTPS scans with a test device secret: daily scan overwrote its absent placeholder; duplicate and same-`scan_id` retry → `Duplicate scan ignored`; club scan inside a meeting → logged with `meeting_id`; between meetings → `no_meeting_open` (200); wrong secret → 401; unknown member → 404. The **first real cron run** (23:15 UTC) closed the past test meeting and wrote absences for both members; then a scan timestamped *inside* that closed meeting (a late offline flush) → `overwrote absent placeholder` in the right meeting |
| 5a | Apply `20260926130300_close_due_meetings_whole_seconds.sql` | ✅ Fix for a bug the live run exposed: sweep absences carried the meeting start's microseconds (`21:09:49.949243`) where every other row is `HH:MM:SS`. Now truncated; re-verified live (`23:16:48.148` start → `23:16:48`) and in PGlite (a check that fails without the fix) |
| 6 | Delete both test tenants | ✅ Cascaded cleanly through meetings, the device guard and the watermark trigger; nothing left; real data unchanged (3 tenants, 973 attendance rows) |
| 7 | Advisors before/after | ✅ Security lints identical to the pre-Phase-1 baseline; none mention the new functions |

Two gotchas for whoever deploys edge functions here:

- The Supabase MCP deploy tool **defaults to `verify_jwt: true`**. Devices send no
  JWT, so that default would lock every device out. Always pass `false` /
  `--no-verify-jwt`.
- Via the MCP deploy tool, `import_map_path` must be passed explicitly as
  `deno.json`; otherwise it reuses the previous version's absolute
  `file:///tmp/…` path and the deploy is rejected. The CLI reads it from
  `config.toml` and is unaffected.

### Phase 3 — Dashboard (the value cut point)

**Built and tested locally** (2026-09-27). **Migrations applied to cloud** 2026-09-27
~19:45 UTC via `apply_migration` (140000 then 140100). UI not yet deployed (Vercel prod
tracks `oled-integration`, not `club-mode`). Decisions at the
start of Phase 3: schedules are **end-and-recreate** (not editable), and the club
overview is **meeting-centred**.

**Database** — `20260926140000_meeting_schedules.sql` (+ `…140100` cron):

| Piece | What it does |
|---|---|
| `meeting_schedules` | Recurrence rule: weekly / every N weeks (1–12) / monthly Nth weekday (1st–4th, last); local start time + length; `starts_on` / optional `ends_on`; optional device. RLS, grants, watermark trigger in the same file |
| `meetings.schedule_id` | Which rule generated an occurrence; `UNIQUE (schedule_id, starts_at)` (one-offs unconstrained, NULLS DISTINCT) |
| `generate_scheduled_meetings(schedule?, now?, horizon=56)` | Materialises occurrences in the club's LOCAL time (`(day + time) AT TIME ZONE tz` — 10:00 stays 10:00 across DST). Never before today, never past `ends_on`, never an occurrence that has **already ended** (a schedule made at 09:00 for 08:00–09:00 today would otherwise be closed at once with everyone absent). `generated_through` means a deleted occurrence ("skip") is never re-created. Skips non-active tenants and unknown timezones |
| `end_meeting_schedule(schedule)` | Deactivates; deletes not-yet-started occurrences, cancels any that already hold a (pre-roll) scan; history untouched |
| `meeting_attendance_counts(institution, since)` | Present / absent per meeting, arrival rows only (time-in/out member counted once). Aggregated in Postgres because the Data API caps responses at 1000 rows — client-side counting would silently undercount |
| Device-delete guard (replaced) | Now also **deactivates** the device's schedules. `meeting_schedules.device_id` is SET NULL, not CASCADE: CASCADE was tried and failed in PGlite — the meetings.device_id SET NULL firing alongside it re-checks `schedule_id` against the just-deleted schedule |
| `generate-meetings` cron | Daily 00:10 UTC; the dashboard also generates a new schedule's first 8 weeks immediately |

**Dashboard:**

| Area | As built |
|---|---|
| `/meetings` *(new)* | Live-now cards (present / expected, Close now, Cancel, View scans), Upcoming (Edit, Cancel, Delete — "Skip" for a recurring occurrence), Recurring (End), Past 60 days (present / absent, status incl. "Closing…" while awaiting the sweep, Rename, Delete only if no attendance, link to its attendance). Refreshes every minute so meetings move section on their own |
| Meeting rules (server actions) | Can't create/move a meeting that has already ended; overlap check on core times per device (pre/post-roll overlaps are allowed — back-to-back meetings); only the title can change once a meeting has started; delete refused if attendance exists (offers Cancel); close only once started; close never writes absences (the sweep is the only writer). Device-pinned admins only see / act on their device's meetings. Local times ↔ UTC via `lib/zoned-time.ts`, which matches Postgres `AT TIME ZONE` exactly, DST gap and fold included |
| `/attendance` + CSV | Meeting filter + column for clubs; time-in/out pairing keyed by meeting (two meetings in one day no longer merge); Summary tab per meeting, with a rate only once the meeting's absence pass has run. Also fixed the file's 17 pre-existing rules-of-hooks errors (early return above the hooks) |
| Overview `/` | Clubs: Live now / Next meeting, Last meeting rate, pooled average over the last 10 rated meetings, active members, recent activity |
| `/settings` | Club type; Meetings section (record absences, early arrival, late check-in, auto-close — clamped to the DB bounds); weekday picker and fixed expected times hidden for clubs (lateness is measured from each meeting's own start / end) |
| `/onboarding` | Club / Society type; presets Member / Members / Group / Venue / Organiser(s); absences off by default |
| Nav, guards | Meetings for clubs (sidebar, mobile More sheet, header); Academic hidden and `/academic` redirects clubs to `/meetings`; `/promotion` refuses clubs |
| Devices | Delete confirmation says how many upcoming meetings will be cancelled and schedules stopped |

**Tested:** PGlite SQL — Phase 1 43/43, Phase 2 69/69 (before and after the Phase 3
schema), Phase 3 38/38 twice (weekly, fortnightly, first Monday, last Friday, New York
across the 1 Nov DST change, horizon rollover, skip-not-recreated, end schedule, counts,
device and institution delete). Deno unit tests for `zoned-time` + `meetings` 8/8
(incl. DST gap / fold matched against Postgres). `tsc` clean; `next build` passes (all
28 routes); ESLint 43 → 26 errors with nothing new. PostgREST query shapes validated
against the live API with the public key (and failing controls). *Not* tested: the
pages in a browser — they need a signed-in club account (see checklist, §11).

**Verified in cloud after apply:** RLS on with its one policy; all four functions
executable by `service_role` only (not `anon` / `authenticated`); device guard now
deactivates schedules; `generate-meetings` job active at `10 0 * * *` next to
`close-meetings` and `mark-absent-daily`. A smoke test in a rolled-back transaction
(throwaway New York club, 28 Oct): weekly Saturday 10:00 → 8 meetings, 31 Oct 14:00Z
then 7 Nov 15:00Z (DST change handled); last-Monday 19:00 → 1 inside the horizon
(30 Nov = 1 Dec 00:00Z); re-run created 0; a deleted occurrence was not re-created;
ending the weekly schedule removed 7; deleting the device cancelled the rest and
deactivated both schedules. Afterwards: no test rows, 3 tenants, 973 attendance rows
(unchanged); advisors unchanged.

### Phase 4 — Firmware

Bump `FIRMWARE_VERSION` from `1.10.0`
([firmware:42](firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino:42)).

| Item | Detail |
|---|---|
| `toggle-meeting` *(moved from Phase 2)* | Edge function: `POST` with `{ device_id }` + `x-device-secret`, opens or closes the device's ad-hoc meeting. Must accept a **device timestamp** and a **replay id** (offline, §8 B). |
| Poll meeting fields *(moved from Phase 2)* | `get-enrollment-job`: bump `DEVICE_CONFIG_VERSION` → 2 and add meeting state (§6), sent every poll. May need the upcoming schedule too, so an offline device can decide locally (§8 A/B). |
| `session_master` role | New value in `fidMapRole`. No format change — the fid map CSV already carries a free-form role column. |
| Enrollment commands | `register-session-master` / `delete-session-master`, mirroring the existing `register-master` handling at [firmware:2698](firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino:2698). Widen the `enrollment_jobs.command` CHECK in a Phase 4 migration. |
| Scan-loop branch | At [firmware:2779](firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino:2779), before the existing `role == "master"` branch: `session_master` calls `toggle-meeting`. **The existing double-press → captive-portal gesture is untouched**, because this is a different finger. |
| Meeting state cache | Parse the new `device_config_meeting_*` fields; persist alongside the existing `device_config.json` so state survives a reboot mid-meeting. |
| OLED cards | "No meeting open" (refusal), "Meeting opened HH:MM", "Meeting closed · N present". Post to the existing Core-0-safe mailbox; never touch `display` directly from a task. |
| Offline path | When WiFi is down, skip the local meeting check and queue the scan (§6). The session-master press **must also work offline** — mechanism to be designed at the start of this phase (§8 B). |

**Release:** tag `firmware-v1.11.0`. OTA compares against the compiled-in version and
only flashes a strictly newer one.

---

## 8. Open decisions

**A — Online/offline inconsistency in scan refusal.**
Online, the device refuses a scan when no meeting is open. Offline, it accepts and
queues. This is the least-lossy option and preserves the durability-first design, but
it means the same action gives two different results depending on WiFi. The
alternative — refuse when offline too — loses every scan of a meeting held during an
outage. *Recommendation:* accept the inconsistency, and make the OLED say
"Queued — offline" so it is visible rather than silent.

**B — How the ad-hoc master press works offline.** *Decided: it must work offline.*
The mechanism is still open and gets designed at the start of Phase 4. What that
design has to answer:

- **Queueing.** Open/close presses become durable SPIFFS events, like scans, and are
  replayed on reconnect with their RTC timestamps — so `toggle-meeting` must accept
  a device timestamp, not stamp `now()`.
- **Idempotency.** A replayed press whose ack was lost must not open a second
  meeting. Likely a device-generated event id (as `scan_id` does for scans), stored
  on `meetings`.
- **Ordering.** Scans taken during an offline meeting are queued *after* its open
  event and must land inside it. Either replay controls before scans, or rely on
  timestamp resolution (§5) and allow a scan to arrive before its meeting exists
  (a short server-side retry, or leave it queued on the device until the meeting
  exists).
- **Local state.** Offline, the device must track "meeting open" itself so it
  accepts scans, which also resolves most of Open Decision A.
- **Reconciliation.** The server may auto-close or end-of-day-close a meeting that
  the device, offline, still thinks is open; or a scheduled meeting may overlap an
  offline ad-hoc one.

Phase 1 was built to leave all of this open: it adds no "one open meeting per
device" constraint and no idempotency column. Both are additive when this is
decided.

---

## 9. Risks and gotchas

- **The old-key drop (Phase 2 step 2)** is the step that can break production:
  applied before mark-absent is redeployed, every tenant's nightly absence run fails
  with `42P10`, reported only inside a `200` response. Follow the Phase 2 order.
- **Deleting a meeting with attendance is refused by the database** (NO ACTION FK).
  Intended — the UI must offer Cancel rather than surface a raw FK error.
- **A deleted host device would turn its meetings into unbound ones** — *resolved in
  Phase 2* by the device-delete guard and `meetings.device_deleted_at` (§7 Phase 2).
  The residual cost: a device deleted mid-meeting leaves that meeting without
  absences.
- **Offline ad-hoc meetings vs the server's auto-close.** The sweep closes an ad-hoc
  meeting at its idle deadline using only the scans the *server* has seen. If a
  device opens a meeting online and then loses WiFi for longer than
  `meeting_autoclose_minutes`, scans it keeps taking offline land after the
  meeting's `closed_at` and are rejected when they flush. Part of the Phase 4
  offline design (§8 B).
- **DST and timezone edits.** Meeting windows are `timestamptz`; a tenant changing
  `institutions.timezone` shifts the local rendering of already-scheduled meetings.
  Decide whether existing rows re-anchor or hold their instant — probably hold, and
  warn in `/settings`.
- **Meetings with `device_id IS NULL`** (institution-wide) match any device in the
  tenant. Fine for single-device clubs; revisit if a club ever runs two devices at one
  meeting.
- **10 s poll latency** means an organiser who opens a meeting in the dashboard and
  immediately scans may be refused once. Show a transitional OLED state.
- **`DEVICE_CONFIG_VERSION` 1 → 2**: old firmware must tolerate unknown fields, and new
  firmware must tolerate a `ver: 1` server during a partial rollout. Check the existing
  parse path before assuming it degrades gracefully.

---

## 10. Explicitly out of scope

- Manual / phone check-in with no device.
- Clubs nested inside a school tenant (a school wanting a club needs a second tenant).
- Seasons or periods for clubs.
- Full RRULE recurrence.
- Any change to school / office / shop behaviour.

---

## 11. Per-phase test checklist

**Phase 1** — after applying to cloud: run the §7 Phase 1 verify queries; the next
nightly `mark-absent` run returns `marked N absent` / `all tracked members present`
for every tenant, with no `insert error`; a school scan still logs, and a duplicate
scan is still rejected.

**Phase 2** — scan inside a scheduled window lands with `meeting_id`; scan outside
returns `no_meeting_open`; **a scan whose timestamp is 3 days old lands in the correct
closed meeting, not the current one**; a late scan overwrites its absent placeholder;
two meetings on one day both accept the same member; `mark-absent` skips club tenants.

**Phase 3** — automated checks are in §7 Phase 3. Browser click-test, as a platform
admin and then as the new club's super admin (needs the Phase 3 migrations applied, and
a dashboard pointed at cloud — local `.env.local` targets a local Supabase stack):

1. Onboarding: create a Club / Society — labels come out Member / Group / Venue /
   Organiser; Settings shows the Meetings section, no weekday picker, absences off.
2. Nav: Meetings present; Academic absent; `/academic` redirects to `/meetings`;
   `/promotion` → unauthorized.
3. Create a one-off meeting starting in ~5 minutes → it appears under Upcoming, then
   (within a minute of its pre-roll opening) under Live now.
4. Try to create one that overlaps it on the same device → "Overlaps …" error; one
   that already ended → refused.
5. Create a weekly recurring meeting → "N meetings scheduled"; they list under
   Upcoming with the recurring icon; Skip one; End the schedule → future ones gone.
6. Scan in on a real device during the live meeting → present count rises (≤ 12 s);
   Close now → "Closing…" in Past, then Closed with absences within 15 min (if on).
7. Attendance page: Meeting filter narrows to that meeting; Meeting column shows its
   name; Summary shows one row per meeting; CSV has a Meeting column.
8. Overview: Live now / Next meeting / Last meeting / Average cards.
9. Devices: the delete dialog for the club's device mentions the upcoming meetings.
10. A school tenant: nothing changed — no Meetings, Academic present, attendance and
    overview exactly as before.

`check-rbac.mjs` still exits 1 on `app/(dashboard)/page.tsx` — pre-existing (the
overview deliberately uses `verifySession()` so every role can see it); `/meetings`
passes.

**Phase 4** — session master opens and closes a meeting; the *config* master finger
still opens the captive portal on double press; a scan with no meeting shows the
refusal card; power-cycling mid-meeting preserves meeting state; scans queued while
offline flush into the right meeting.

Add the passing cases to [docs/for-operators/e2e-testing-checklist.md](docs/for-operators/e2e-testing-checklist.md)
as each phase lands.
