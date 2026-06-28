# ESP32 Fingerprint Attendance System

Ghanaian schools and institutions still take attendance on paper. A teacher calls a register, marks each name by hand, then copies the totals into another book or a spreadsheet. Roll-call takes class time and the handwritten tallies are easy to miscount and slow to total across a term. This system replaces the register with a fingerprint scan.

An ESP32 device with an R503 fingerprint sensor records each scan, and a Next.js dashboard backed by Supabase handles reporting and the day-to-day management of devices and members. One cloud Supabase project serves every institution, with each tenant's data isolated from the rest. The hardware and software are complete; the first institutional deployment is pending.

---

## Why This Exists

- Ghanaian schools and small institutions track attendance on paper or not at all; the affordable end of the market has no biometric option tied to a reporting dashboard.
- ZKTeco and similar incumbents ship standalone terminals with no multi-tenant cloud dashboard and no remote device management.
- The system is built around term and academic-year structure, with institution type configurable as school, office, or shop.
- Each device is built from off-the-shelf parts at about GHS 1,000.
- The firmware and dashboard are AGPL-3.0 on GitHub; institutions can self-host or use the managed hosted service.

---

## Real-World Deployment

- Status: hardware and software complete; first institutional deployment pending
- Site: [institution name], [town/region]
- Enrolled members: [N]
- Running since: [start date]

![Device installed at [institution name]](docs/images/deployment.jpg)

---

## Architecture

```
┌─────────────────────────────┐
│       ESP32 Devices         │
│  R503 fingerprint sensor    │
│  One device per unit        │
└────────────┬────────────────┘
             │ HTTPS (x-device-secret / x-bootstrap-secret)
             ▼
┌─────────────────────────────┐
│  Supabase Edge Functions    │
│  (cloud)                    │
│  log-attendance             │
│  mark-absent (pg_cron)      │
│  get-enrollment-job         │
│  update-enrollment-job      │
│  register                   │
│  assignment-poll            │
└────────────┬────────────────┘
             │ service role
             ▼
┌─────────────────────────────┐
│   Supabase PostgreSQL       │
│   (cloud)                   │
│   Multi-tenant schema       │
│   RLS policies (defence-in- │
│   depth; dormant for svc    │
│   role access)              │
└─────────────────────────────┘
             ▲
             │ server-side only (service role)
┌────────────┴────────────────┐
│     Next.js Dashboard       │
│     Deployed on Vercel      │
│  All Supabase calls are     │
│  server-side (no browser    │
│  exposure of keys)          │
└─────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Firmware | Arduino (ESP32), FreeRTOS, R503 fingerprint library |
| Database | Supabase (cloud PostgreSQL + Auth + Storage + pg_cron) |
| Edge functions | Deno (Supabase Edge Functions) |
| Dashboard | Next.js App Router, shadcn/ui, TailwindCSS |
| Hosting | Vercel (dashboard) |

> **Note on Next.js:** This project uses a version with breaking API changes from standard Next.js. Middleware lives in `frontend/proxy.ts`, not `middleware.ts`. Read `frontend/AGENTS.md` before writing any Next.js code.

---

## Hardware

### Components

| Component | Spec |
|---|---|
| Microcontroller | ESP32 (dual-core, 240 MHz) |
| Fingerprint Sensor | R503 Capacitive |
| RTC Module | DS3231 |

### Wiring

| Signal | ESP32 Pin |
|---|---|
| R503 TX → ESP32 RX | GPIO 16 |
| R503 RX → ESP32 TX | GPIO 17 |
| DS3231 SDA | GPIO 21 |
| DS3231 SCL | GPIO 22 |

---

## Firmware Architecture

Single sketch: `firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino`. Three FreeRTOS tasks pinned across the two cores.

### Tasks

| Task | Core | Responsibility |
|---|---|---|
| `FingerprintTask` | 1 | Scan loop, match against the local fid map, LED feedback, enrollment execution, captive-portal launch on master-finger scan. Writes each scan to SPIFFS then signals `NetworkTask` via binary semaphore. |
| `NetworkTask` | 0 | Provisioning, waiting on scan semaphore from `FingerprintTask`, rotate-then-process SPIFFS queue flush to `log-attendance`, NTP→RTC sync, WiFi reconnect. |
| `EnrollmentTask` | 0 | Polls `get-enrollment-job`, hands jobs to `FingerprintTask`, acts on the decommission signal (wipes identity and reboots into provisioning). |

Inter-task communication:

- `memQueueSem` is a binary semaphore used only as a signal: `FingerprintTask` gives it after writing a scan to SPIFFS; `NetworkTask` waits on it (or a 15 s periodic timeout) before calling `flushQueue()`. There is no in-memory scan queue.
- Enrollment jobs pass from `EnrollmentTask` to `FingerprintTask` through `currentEnrollJob`, guarded by `enrollMutex` and signalled by `enrollSem`.
- `spiffsMutex` serialises every SPIFFS access across all three tasks.

### Offline queue

- **Durability-first:** each scan is written to `/queue.txt` in SPIFFS synchronously inside `FingerprintTask` before any network attempt. The scan is never held only in RAM.
- **Rotate-then-process:** when `NetworkTask` flushes, it atomically renames `/queue.txt` → `/queue_inflight.txt` under the lock, then releases the lock. `FingerprintTask` can keep appending to a fresh `/queue.txt` while the network send runs without holding `spiffsMutex`.
- **Crash recovery:** if power is cut mid-flush, `/queue_inflight.txt` is orphaned. On the next boot, `recoverInflightQueue()` runs before tasks start and merges it back into `/queue.txt`.
- On flush, 5xx/429/network errors keep a record for retry; 4xx drops it.
- Caps: 1000 entries, 256 KB, 7-day age. Oldest records are trimmed first.

### Scan IDs

Each scan gets a `scan_id` of `scan-YYYYMMDDhhmmss-<member-sid>`, with the timestamp read from the DS3231 RTC. The RTC clock survives reboots and power loss and is synced from NTP on boot and after each reconnect.

### OTA

- On boot, with WiFi up and assignment not pending, the device waits a random jitter of 0–120 s (seeded from hardware entropy) before checking for updates. This prevents a fleet-wide power blip from hitting GitHub's 60 req/hr unauthenticated rate limit simultaneously.
- The device GETs `releases/latest` from the GitHub API. Release tags must be `firmware-v<major>.<minor>.<patch>`. The tag version is compared against the compiled-in `FIRMWARE_VERSION`; only a strictly newer version flashes.
- The release's `.bin` asset is streamed through the `Update` library. The sensor LED holds red while writing, and the device reboots into the new image on success.

---

## Database Schema

All dashboard data access uses `createAdminClient()` (service role — bypasses RLS). RLS policies exist as defence-in-depth and will become load-bearing if authenticated client access is introduced.

```sql
-- Institution registry (one row per tenant)
-- theme_primary: hex brand colour injected as CSS custom properties server-side (no FOUC)
-- theme_preset: curated palette key (e.g. 'indigo', 'rose') or 'custom'; null → platform default
-- device_secret: shared bootstrap secret — TRANSITIONAL. Will be removed once all
--   devices have been re-provisioned with per-device secrets (devices.device_secret).
institutions    (id, name, type, logo_url, label_member, label_members, label_group,
                 label_unit, label_period, label_staff, label_staff_plural,
                 track_students, track_staff, student_scan_mode, staff_scan_mode,
                 skip_weekends, device_secret, timezone, theme_primary, theme_preset,
                 loyalty_enabled)

-- Members (students, staff, customers, etc.) — scoped to institution
-- member_type: 'student' | 'staff'  (default 'student')
-- sid is UNIQUE PER INSTITUTION (institution_id, sid), not globally
-- device_id FK is ON DELETE SET NULL (device deletion preserves member records)
members         (id, sid, fullname, group_name, unit_name, fin1, fin2, status, member_type,
                 device_id→devices SET NULL, institution_id, created_at)

-- One ESP32 per unit — scoped to institution
-- device_secret: per-device secret issued at provisioning time by /assignment-poll
-- revoked: true blocks the device from logging attendance (instant lockout)
-- provisioning_token: issued by /register, required by /assignment-poll (H7)
devices         (id, group_name, unit_name, display_name, mac, provisioning_token,
                 device_secret, revoked, institution_id)

-- Academic periods — scoped to institution (nullable for office/shop-type institutions)
periods         (id, term, year, status, start_date, end_date, institution_id)

-- Attendance records — scoped to institution
-- scan_type: 'present' | 'absent' | 'time_in' | 'time_out'
-- date/time are stored in the INSTITUTION's timezone (log-attendance + mark-absent agree)
-- scan_id is UNIQUE PER INSTITUTION (institution_id, scan_id); dedup also on (member_id, date, scan_type)
-- device_id FK is ON DELETE SET NULL
attendance      (id, member_id→members, period_id→periods, device_id→devices SET NULL,
                 date, time, status, scan_type, scan_id, institution_id)

-- Remote fingerprint enrollment queue
-- device_id FK is ON DELETE SET NULL
enrollment_jobs (id, device_id→devices SET NULL, student_id→members, finger_slot,
                 command, status, fid, note, institution_id, created_at)

-- Holidays (date ranges) — scoped to institution
-- recurring: true = matched by month/day every year (year-wrap ranges supported)
holidays        (id, label, start_date, end_date, recurring, institution_id)

-- Dashboard user roles — scoped to institution (platform_admin has null institution_id)
-- assigned_device_id: FK used by teacher/staff role to scope attendance to their unit.
--   Preferred over the legacy assigned_unit string; backfilled by migration.
profiles        (id→auth.users, role, assigned_unit, assigned_device_id→devices SET NULL,
                 institution_id)

-- Deferred SPIFFS-wipe queue — no FK, survives device row deletion
device_resets   (device_id UUID, created_at)

-- Polling watermark — one row per institution, updated by triggers on attendance,
-- members, devices, and periods. The dashboard polls /api/changes every 12 s and
-- calls router.refresh() only when last_change_at has advanced. Replaces the
-- previous SSE-based realtime stream (eliminated REPLICA IDENTITY FULL WAL amplification).
institution_activity  (institution_id PK→institutions, last_change_at timestamptz)
```

### Migrations

All migrations are in `backend/supabase/migrations/`. They must be reviewed and applied manually — do not auto-apply to cloud.

---

## Auth & RBAC

Authentication uses Supabase Auth (server-side only — all Supabase calls go through Next.js server components and API routes, never from the browser).

### Account Types

| Role | Scope | Access |
|---|---|---|
| `platform_admin` | Cross-institution (no institution_id) | All pages, bypasses all role gates, operates via service role. Responsible for creating institutions and bootstrapping first super_admin per institution. |
| `super_admin` | Institution-scoped | All pages — devices, enrollment, promotion, academic, members, attendance, user management. Can manage users within their institution but cannot create platform_admins. |
| `admin` | Institution-scoped | Members, academic, promotion, attendance — no devices or enrollment. |
| `teacher` | Institution-scoped, unit-scoped | Read-only attendance and members, filtered to their `assigned_device_id` (FK, with `assigned_unit` string-match fallback for unbackfilled profiles). |
| `staff` | Institution-scoped, unit-scoped | Same as teacher — read-only attendance and members, filtered to their unit. The `/staff` roster page is not visible in the nav for this role. |
| `cashier` | Institution-scoped (shop type) | Sales, Clients, and Catalog pages only. Intended for retail staff at shop-type institutions. Cannot access attendance, members, devices, or admin pages. |

### How it works

- `frontend/lib/supabase/dal.ts` exports `verifySession()`, `requireRole(...roles)`, `getInstitution(institutionId)`, and `resolveInstitutionScope(session, institutionParam?)`.
- `verifySession()` and `getInstitution()` are both `cache()`-wrapped — one DB hit per render cycle regardless of how many components call them.
- `requireRole()` calls `verifySession()` and redirects to `/unauthorized` if the role doesn't match. `platform_admin` bypasses all role checks.
- `resolveInstitutionScope()` enforces tenant scoping: platform_admin may pass an explicit institution param; all other roles are always locked to their own `institution_id` regardless of query params.
- **Fail-closed:** an authenticated user with no `profiles` row (or no role) is redirected to `/unauthorized` — it does **not** default to any role. Public sign-up is disabled in Supabase Auth; accounts are created only via `/users` and `/onboarding`.
- **Tenant ownership:** because the dashboard uses the service role (RLS bypassed), every mutating server action verifies the target record belongs to the caller's institution via `lib/supabase/ownership.ts` (`ownsRecord`). `platform_admin` is cross-tenant by design.
- The dashboard layout calls `verifySession()` and passes `role` to the sidebar and mobile nav, which filter nav items by role.
- `teacher` and `staff` have an `assigned_device_id` (FK, preferred) or `assigned_unit` (legacy string) in their profile. Attendance and member data is filtered server-side to that unit before rendering — including the CSV export (`/api/attendance/export`).
- Run `node scripts/check-rbac.mjs` (from `frontend/`) to verify every page under `(dashboard)` has a `requireRole(` call. Exits 1 with a list if any are ungated.

### Creating the first super_admin (per institution)

After creating an institution in Supabase, insert a profile row for the Supabase Auth user:

```sql
insert into profiles (id, role, institution_id)
values ('<auth-user-uuid>', 'super_admin', '<institution-uuid>');
```

Additional accounts are managed through the `/users` page in the dashboard.

---

## Dashboard Pages

### Attendance & roster (all institution types)

| Route | Access | Description |
|---|---|---|
| `/` | All roles | Overview — today's present/absent counts, attendance rate, and a recent-activity feed (last 8 scans). `teacher`/`staff` see only their unit. `platform_admin` sees a cross-tenant summary: institution count, active members, devices online, and total scans today. |
| `/attendance` | All roles | Attendance records with date, period, member, unit, status, and type filters. Per-member stats panel. Results paginated at 50 rows. `teacher`/`staff` see only their unit; a teacher with no device assigned sees an empty-state prompt to contact their administrator. Time-in/time-out pairs shown on a single row. CSV export available. |
| `/members` | All roles except cashier | Member roster (non-staff). `teacher`/`staff` see only their unit, no edit controls. |
| `/staff` | super_admin, admin, platform_admin | Staff member roster. Visible only when `track_staff = true`. |
| `/devices` | super_admin, platform_admin | ESP32 device registry and provisioning — assign unregistered devices to units, revoke devices. Search + institution filter for platform_admin. Devices only enter via physical provisioning (no manual create). |
| `/academic` | super_admin, admin, platform_admin | Academic periods and holidays. Labeled "Periods & Holidays" for office institutions. Supports recurring (yearly) holidays matched by month/day. |
| `/enrollment` | super_admin, platform_admin | Fingerprint enrollment job queue — register, delete, clearall commands sent to devices. Validates member institution + device assignment before dispatching. Institution column for platform_admin. |
| `/promotion` | super_admin, admin, platform_admin | Bulk year-end promotion — moves members to the next group, resets finger slots, deactivates final-year members. School-type institutions only. |
| `/settings` | super_admin, platform_admin | Institution config — name, logo, type, label overrides, scan modes, skip_weekends, timezone. |
| `/institutions` | platform_admin | All institutions with member/device counts. Edit or delete any institution (deletion fans out SPIFFS wipe to all assigned devices). |
| `/institutions/[id]` | platform_admin | Edit a specific institution's settings. |
| `/onboarding` | platform_admin | Create a new institution and its first super_admin account. Includes timezone selector (Africa/Accra default) and neutral label presets for shop-type institutions. |
| `/users` | super_admin, admin, platform_admin | Dashboard account management. `admin` can view the list and change their own password only. `super_admin`/`platform_admin` can create, edit, and delete accounts. |
| `/unauthorized` | — | Shown when a user navigates to a page their role cannot access. |
| `/suspended` | — | Shown when a user's institution is suspended/deactivated. Lives outside `(dashboard)` to avoid re-entering `verifySession`. Sign-out is the only available action. |

### Retail / loyalty (shop-type institutions only)

| Route | Access | Description |
|---|---|---|
| `/sales` | super_admin, admin, cashier | Record sales transactions. Line-item entry with catalog lookup, optional stylist assignment, per-sale note. Low-stock warning surfaced as a non-blocking alert after a successful sale. |
| `/clients` | super_admin, admin, cashier | Client roster with visit history and loyalty point balance. Search by name or phone. |
| `/catalog` | super_admin, admin, cashier | Products and services catalog. Stock quantity tracked for products; low-stock threshold warnings on the Reports page. |
| `/rewards` | super_admin, admin | Loyalty reward redemption and tier management. Gated additionally by `loyalty_enabled` on the institution. |
| `/reports` | super_admin, admin | Sales analytics — daily/weekly takings, revenue by client and stylist, popular items, visit frequency, low-stock products, loyalty rewards issued. CSV export for takings, client revenue, and stylist revenue. |

### Screenshots

![Overview dashboard showing today's attendance summary](docs/images/dashboard-overview.png)
![Attendance view with filters and per-member stats panel](docs/images/dashboard-attendance.png)
![Devices page showing provisioning workflow](docs/images/dashboard-devices.png)
![Enrollment queue with fingerprint job management](docs/images/dashboard-enrollment.png)

Screenshots pending production UI.

---

## Device Authentication & Provisioning

### Provisioning (new devices)

1. Device boots with no `device_identity.json` in SPIFFS.
2. Calls `POST /register` with its MAC address (`x-bootstrap-secret` header).
3. Receives a `device_id`, a `provisioning_token`, and `status: "pending"`. The device persists both to `provisioning.json` so a reboot keeps the token.
4. Shows yellow breathing LED and polls `POST /assignment-poll` every 5 s, sending `{ device_id, provisioning_token }`.
5. An admin assigns the device from the dashboard `/devices` page.
6. Poll returns `status: "assigned"` with `institution_id`, `device_secret` (per-device), `display_name` — **only if the provisioning_token matches** (otherwise 401).
7. Device writes `device_identity.json` to SPIFFS, deletes `provisioning.json`, and begins normal operation.

> **TLS:** the firmware validates server certificates (`certs.h` → `ROOT_CA_BUNDLE`, includes intermediates for WE1/Sectigo DV E36 — mbedTLS cannot do AIA fetching).
> The bootstrap secret lives in `secrets.h` (gitignored). Copy `secrets.example.h` → `secrets.h` and set the same value as the `BOOTSTRAP_SECRET` secret in Supabase Edge Functions.

### Normal operation

- Every scan: `POST /log-attendance` with `{ device_id, ... }` body and `x-device-secret: <per-device secret>` header. A transitional dual-path also accepts the legacy shared `institutions.device_secret` for devices not yet re-provisioned.
- Enrollment polling: `POST /get-enrollment-job` with `{ device_id }`, authenticated via per-device secret.
- Enrollment result: `POST /update-enrollment-job` with `{ id, device_id, institution_id, status, ... }`, authenticated via per-device secret. `institution_id` is derived server-side from the device row — the body value is ignored.
- Decommission signal: if `get-enrollment-job` returns `decommissioned: true`, the device wipes its identity and reboots. The `device_resets` row persists until the device re-registers (not consumed on read — durable against race conditions).
- `pg_cron` calls `POST /mark-absent` daily with `x-cron-secret`. Processes institutions in batches of 8 concurrently. **Requires the `pg_net` extension** — enable it in the Supabase dashboard under Database → Extensions.

### Revoking a device

Set `devices.revoked = true` in the database. The device's next `log-attendance` call receives 401 immediately. For permanent decommission, also insert into `device_resets`.

### OTA

Firmware checks `https://api.github.com/repos/sgariba21-beep/esp32-attendance-device/releases/latest` on boot after a random jitter delay. Releases must be tagged `firmware-v<version>` (e.g. `firmware-v1.1.6`). The `.bin` asset is downloaded and flashed via the ESP32 `Update` library.

---

## Key Files

```
esp32-attendance-device/
├── README.md
├── docs/
│   ├── device-secret-migration-rollout.md  ← step-by-step guide for per-device secret rollout
│   ├── biometric-privacy-note.md           ← what biometric data is stored where and how
│   └── e2e-testing-checklist.md            ← test cases for each major feature area
├── firmware/
│   └── ClassAttendance_Current_RTC/
│       ├── ClassAttendance_Current_RTC.ino ← ESP32 firmware (single sketch)
│       ├── certs.h                         ← ROOT_CA_BUNDLE (includes intermediates)
│       ├── secrets.example.h               ← template for secrets.h (gitignored)
│       └── secrets.h                       ← BOOTSTRAP_SECRET — gitignored, create from example
├── backend/
│   └── supabase/
│       ├── config.toml                     ← edge function config (verify_jwt = false for all)
│       ├── migrations/                     ← applied to cloud manually; do NOT auto-apply
│       └── functions/
│           ├── log-attendance/             ← dual-path auth: per-device + transitional shared secret
│           ├── mark-absent/                ← BATCH_SIZE=8 concurrent; recurring holiday support
│           ├── get-enrollment-job/         ← per-device auth; decommission signal is persistent
│           ├── update-enrollment-job/      ← per-device auth; institution derived from device row
│           ├── register/
│           └── assignment-poll/            ← issues per-device secret on first assignment
└── frontend/
    ├── proxy.ts                            ← Next.js middleware (NOT middleware.ts)
    ├── AGENTS.md                           ← read before writing any Next.js code
    ├── scripts/
    │   └── check-rbac.mjs                 ← CI guard: exits 1 if any dashboard page lacks requireRole
    ├── app/
    │   ├── (auth)/login/                  ← password is NOT trimmed before submission
    │   ├── (dashboard)/
    │   │   ├── layout.tsx                 ← verifySession, generateMetadata (dynamic tab title)
    │   │   ├── (admin)/layout.tsx         ← route-group gate for admin-only pages
    │   │   ├── attendance/
    │   │   ├── members/
    │   │   ├── staff/
    │   │   ├── devices/
    │   │   ├── academic/
    │   │   ├── enrollment/
    │   │   ├── promotion/
    │   │   ├── settings/
    │   │   ├── institutions/[id]/
    │   │   ├── onboarding/
    │   │   ├── users/
    │   │   ├── sales/                     ← shop only; low-stock warning after sale
    │   │   ├── clients/                   ← shop only; visit history + loyalty balance
    │   │   ├── catalog/                   ← shop only; products + services
    │   │   ├── rewards/                   ← shop only; loyalty_enabled gate
    │   │   └── reports/                   ← shop only; takings, revenue, low-stock analytics
    │   ├── api/
    │   │   ├── signin/
    │   │   ├── signout/
    │   │   ├── enrollment-stream/         ← SSE stream for enrollment job updates (kept)
    │   │   ├── realtime-stream/           ← 410 tombstone — use /api/changes instead
    │   │   ├── changes/                   ← watermark poll endpoint (replaces SSE stream)
    │   │   └── attendance/export/         ← CSV export with full filter parity
    │   ├── suspended/                     ← institution suspended; sign-out only
    │   └── unauthorized/
    ├── lib/
    │   ├── types.ts                       ← shared TS types
    │   ├── theme.ts                       ← per-institution brand theming
    │   └── supabase/
    │       ├── dal.ts                     ← verifySession, requireRole, getInstitution,
    │       │                                 resolveInstitutionScope, UserRole
    │       └── server.ts                  ← createAuthClient, createAdminClient
    └── components/
        ├── sidebar.tsx
        ├── mobile-header.tsx
        ├── mobile-bottom-nav.tsx
        ├── theme-toggle.tsx
        ├── realtime-refresh.tsx           ← polls /api/changes every 12 s; router.refresh() on watermark advance
        ├── session-manager.tsx            ← inactivity timeout + sessionStorage guard
        └── ui/
            └── single-select.tsx
```

---

## Phase Status

| Phase | Description | Status |
|---|---|---|
| 1 | Cloud deployment (single-tenant) | ✅ Complete |
| 2 | Multi-tenant schema + edge functions | ✅ Complete |
| 3 | Firmware provisioning flow | ✅ Complete |
| 4 | Frontend — de-brand, institution config, devices page, settings | ✅ Complete |
| 5 | Captive portal — WiFi-only | ✅ Complete |
| 6 | Retail / loyalty module — shop-type tenants, cashier role, sales/clients/catalog/rewards/reports | ✅ Complete |
| 7 | Security hardening — per-device secrets, SPIFFS-only durable queue, tenant isolation fixes, polling watermark | ✅ Complete |

---

## Roadmap

- [ ] Admin mobile app (iOS/Android)
- [ ] GES-formatted report exports
- [ ] SMS attendance notifications
- [ ] Analytics dashboard with term-over-term trends
- [ ] Offline-first mobile enrollment app
- [ ] Multi-device per unit support

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repo layout and local setup steps for the frontend and firmware.

---

## License

AGPL-3.0. See [LICENSE](LICENSE).

Network use of a modified version requires releasing source under the same license. Contact sgariba21@gmail.com for commercial licensing or self-hosting arrangements.
