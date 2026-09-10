# Club Mode — Session-Based Attendance

**Status:** Planned, not started. No code written.
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
| Do absences exist | **Per-tenant setting** (`institutions.track_absences`) | Some clubs enforce attendance, some do not. One flag, not two code paths. |
| Scoping | **New institution type `club`** | Mirrors how `shop` was added. A school cannot host a club inside its own tenant — accepted. |
| Scan with no meeting open | **Reject**, device shows "No meeting open" | Device must know meeting state locally. See §6 and Open Decision A. |
| Periods / seasons | **Clubs have no periods** | Lifecycle handled by the existing `institutions.status` (`active` / `suspended` / `deactivated`). |
| Hardware | Device only, same as now | No manual / phone check-in path. Not in scope. |

---

## 3. Why this is safe for existing tenants

Every attendance row that exists today would have `meeting_id IS NULL`. So the
day-keyed unique constraint becomes a **partial** index scoped to
`meeting_id IS NULL`, and a second partial index covers session mode:

```sql
-- daily-mode tenants (school / office / shop): behaviour identical to today
unique (member_id, date, scan_type) where meeting_id is null
-- session-mode (club): two meetings in one day no longer collide
unique (member_id, meeting_id, scan_type) where meeting_id is not null
```

No backfill, no data migration, no behaviour change for any live tenant. This is
the property the whole plan turns on — if it stops holding, stop and re-plan.

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
  add column meeting_id uuid references meetings(id) on delete cascade;
```

`ON DELETE CASCADE` here is intentional and differs from the `device_id` rule:
deleting a meeting that never happened *should* remove its attendance rows. The
dashboard must therefore warn before deleting a meeting with scans, and prefer
`status = 'cancelled'` over deletion.

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

`track_absences` defaults `true` so every existing tenant keeps today's behaviour;
`/onboarding` sets it `false` when creating a `club`.

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

3. No match → 409 with code "no_meeting_open"

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

Migration filenames are suggestions; **re-date them at implementation time** to stay
after the latest applied migration (currently `20260904120000`).

| File | Contents |
|---|---|
| `…_club_type_and_meeting_settings.sql` | Widen `institutions_type_check` to include `'club'`; add `track_absences`, `meeting_preroll_minutes`, `meeting_postroll_minutes`, `meeting_autoclose_minutes` |
| `…_meetings_table.sql` | `meetings` table; indexes on `(institution_id, starts_at)` and a partial index on `status = 'open'` |
| `…_attendance_meeting_id.sql` | `attendance.meeting_id`; **swap the unique constraint for the two partial indexes** |
| `…_meetings_activity_trigger.sql` | `trg_activity_meetings` on `touch_institution_activity()` |
| `…_meetings_rls.sql` | Dormant defence-in-depth policies, matching the existing pattern |

**The constraint swap is the one risky step.** Build the replacement indexes
`CONCURRENTLY` first, verify, then drop the old constraint inside a transaction.
Dropping first leaves a window with no dedup protection on a live table.

**Verify:**

```sql
-- both partial indexes present, old constraint gone
select indexname, indexdef from pg_indexes
 where tablename = 'attendance' and indexdef ilike '%scan_type%';

-- every existing row is daily-mode
select count(*) from attendance where meeting_id is not null;  -- expect 0
```

### Phase 2 — Backend

| Item | Detail |
|---|---|
| `log-attendance` | Add meeting resolution (§5) for `club` tenants. Skip the `tracked_weekdays` gate entirely for clubs — it would be a second filter that silently drops impromptu meetings. Return `no_meeting_open` as a distinct code. Non-club tenants take the existing path unchanged. |
| `toggle-meeting` *(new)* | `POST` with `{ device_id }` + `x-device-secret`. Opens an ad-hoc meeting, or closes the open one. Returns the new state plus a present-count for the OLED. Mirrors the auth block in `log-attendance`. |
| `get-enrollment-job` | Bump `DEVICE_CONFIG_VERSION` → 2; add the four `device_config_meeting_*` fields (§6). Send them every poll, **not** gated on `config_rev` — meeting state changes far more often than institution config. |
| `close-meetings` *(new)* | On `pg_cron` every ~15 min. Closes scheduled meetings past `ends_at + postroll`; closes ad-hoc meetings idle beyond `meeting_autoclose_minutes`; end-of-day backstop; writes absences where `track_absences` is on, guarded by `absences_written_at`. |
| `mark-absent` | Add an early skip for `type = 'club'` — club absences come from `close-meetings`, never the daily cron. |

Absence rows written on close reuse the existing shape: `status = 'absent'`,
`scan_id = null`, plus `meeting_id`. That keeps the placeholder-overwrite path in
`log-attendance` working for late flushes.

### Phase 3 — Dashboard (the value cut point)

| Item | Detail |
|---|---|
| `/meetings` *(new route)* | List upcoming / past. Create one-off and recurring. Show the currently-open meeting live with a present count. Close, cancel, edit. Warn loudly before deleting a meeting that has scans (`ON DELETE CASCADE`). |
| Recurrence generator | Materialise `meeting_schedules` into `meetings` rows ~8 weeks ahead; extend on each `close-meetings` cron run. |
| `/attendance` | Meeting filter; show meeting title alongside date for club tenants. |
| Overview `/` | For clubs, attendance rate = *meetings attended / meetings held*, not days. |
| `/settings` | Absence toggle, pre/post-roll, auto-close, label overrides. |
| `/onboarding` | `club` preset labels (Member / Members / Group / Meeting); `track_absences` default `false`. |
| Nav | Add Meetings; hide `/promotion` (school-only) and `/academic` (clubs have no periods) for `club`. Both [sidebar.tsx:71](frontend/components/sidebar.tsx:71) and [mobile-bottom-nav.tsx:67](frontend/components/mobile-bottom-nav.tsx:67) branch on `institution.type` — update both, plus the title map in [mobile-header.tsx:15](frontend/components/mobile-header.tsx:15). |
| RBAC | Every new page under `(dashboard)` needs a `requireRole(` call. Run `node scripts/check-rbac.mjs` from `frontend/` — it exits 1 and lists any ungated page. |
| Tenancy | Every mutating action calls `ownsRecord('meetings', id, session)`. `ownsRecord` is already generic over any table with an `institution_id` column ([ownership.ts](frontend/lib/supabase/ownership.ts)) — no change to the helper itself, only new call sites. |

### Phase 4 — Firmware

Bump `FIRMWARE_VERSION` from `1.10.0`
([firmware:42](firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino:42)).

| Item | Detail |
|---|---|
| `session_master` role | New value in `fidMapRole`. No format change — the fid map CSV already carries a free-form role column. |
| Enrollment commands | `register-session-master` / `delete-session-master`, mirroring the existing `register-master` handling at [firmware:2698](firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino:2698). Widen the `enrollment_jobs.command` CHECK in a Phase 4 migration. |
| Scan-loop branch | At [firmware:2779](firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino:2779), before the existing `role == "master"` branch: `session_master` calls `toggle-meeting`. **The existing double-press → captive-portal gesture is untouched**, because this is a different finger. |
| Meeting state cache | Parse the new `device_config_meeting_*` fields; persist alongside the existing `device_config.json` so state survives a reboot mid-meeting. |
| OLED cards | "No meeting open" (refusal), "Meeting opened HH:MM", "Meeting closed · N present". Post to the existing Core-0-safe mailbox; never touch `display` directly from a task. |
| Offline path | When WiFi is down, skip the local meeting check and queue the scan (§6). |

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

**B — Should the ad-hoc master press work offline?**
Opening a meeting is a control action, not a data point, so the simple answer is
refuse and show "Offline". But a club meeting somewhere with poor WiFi is exactly the
target scenario. Queueing an open/close pair for later replay is doable but adds real
complexity — reconciling a queued open against a meeting the server may have already
auto-closed. *Recommendation:* refuse in Phase 4; revisit only if a real deployment
hits it.

---

## 9. Risks and gotchas

- **The constraint swap (Phase 1)** is the only step that can damage existing data.
  Build `CONCURRENTLY`, verify, then drop. Never the reverse.
- **`ON DELETE CASCADE` on `attendance.meeting_id`** means deleting a meeting deletes
  its attendance. Intended, but the UI must make it hard to do by accident. Prefer
  `cancelled`.
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

**Phase 1** — existing tenants unaffected: a school logs a scan, a duplicate scan is
still rejected, `mark-absent` still writes rows. `select count(*) from attendance where
meeting_id is not null` returns 0.

**Phase 2** — scan inside a scheduled window lands with `meeting_id`; scan outside
returns `no_meeting_open`; **a scan whose timestamp is 3 days old lands in the correct
closed meeting, not the current one**; a late scan overwrites its absent placeholder;
two meetings on one day both accept the same member; `mark-absent` skips club tenants.

**Phase 3** — `node scripts/check-rbac.mjs` exits 0; a `cashier` / `teacher` cannot
reach `/meetings`; a super_admin of tenant A cannot mutate tenant B's meeting;
recurrence generates the right dates across a month boundary; the dashboard refreshes
within ~12 s of a meeting opening.

**Phase 4** — session master opens and closes a meeting; the *config* master finger
still opens the captive portal on double press; a scan with no meeting shows the
refusal card; power-cycling mid-meeting preserves meeting state; scans queued while
offline flush into the right meeting.

Add the passing cases to [docs/e2e-testing-checklist.md](docs/e2e-testing-checklist.md)
as each phase lands.
