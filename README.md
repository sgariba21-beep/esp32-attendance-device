# ESP32 Fingerprint Attendance System

Ghanaian schools and institutions still take attendance on paper. A teacher calls a register, marks each name by hand, then copies the totals into another book or a spreadsheet. Roll-call takes class time and the handwritten tallies are easy to miscount and slow to total across a term. This system replaces the register with a fingerprint scan.

An ESP32 device with an R503 fingerprint sensor records each scan, and a Next.js dashboard backed by Supabase handles reporting and the day-to-day management of devices and members. One cloud Supabase project serves every institution, with each tenant's data isolated from the rest. The hardware and software are complete; the first institutional deployment is pending.

---

## Why This Exists

- Ghanaian schools and small institutions track attendance on paper or not at all; the affordable end of the market has no biometric option tied to a reporting dashboard.
- ZKTeco and similar incumbents ship standalone terminals with no multi-tenant cloud dashboard and no remote device management.
- The system is built around term and academic-year structure, with institution type configurable as school or office.
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
│  (cloud, lxpemewonievaazboyez) │
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
| `FingerprintTask` | 1 | Scan loop, match against the local fid map, LED feedback, enrollment execution, captive-portal launch on master-finger scan. |
| `NetworkTask` | 0 | Provisioning, draining the in-memory send queue to `log-attendance`, SPIFFS queue flush, NTP→RTC sync, WiFi reconnect. |
| `EnrollmentTask` | 0 | Polls `get-enrollment-job`, hands jobs to `FingerprintTask`, acts on the decommission signal (wipes identity and reboots into provisioning). |

Inter-task communication:

- `memQueue` (`std::deque`) holds outbound attendance payloads. `FingerprintTask` pushes, `NetworkTask` pops. Guarded by `memQueueMutex`; `memQueueSem` wakes `NetworkTask` when a payload arrives.
- Enrollment jobs pass from `EnrollmentTask` to `FingerprintTask` through `currentEnrollJob`, guarded by `enrollMutex` and signalled by `enrollSem`.
- `spiffsMutex` serialises every SPIFFS access across all three tasks.

### Offline queue

- Each scan is written to `/queue.txt` in SPIFFS before any network attempt, one JSON payload per line.
- With WiFi up, the payload is also pushed to `memQueue` for immediate send. The SPIFFS copy is cleared once a POST returns 2xx.
- With WiFi down, the payload stays in `/queue.txt`. `NetworkTask` flushes the file on reconnect and on boot.
- On flush, 5xx/429/network errors keep a record for retry; a 4xx drops it.
- Caps: 1000 entries, 256 KB, 7-day age. Oldest records are trimmed first.

### Scan IDs

Each scan gets a `scan_id` of `scan-YYYYMMDDhhmmss-<member-sid>`, with the timestamp read from the DS3231 RTC. Earlier firmware derived the ID from `millis()`, which resets to zero on every reboot, so scans after a power cycle collided with earlier IDs and the server's `(institution_id, scan_id)` dedup discarded them. The RTC clock survives reboots and power loss, so the IDs stay unique. It is synced from NTP on boot and after each reconnect.

### OTA

- On boot, with WiFi up and assignment not pending, the device GETs `releases/latest` from the GitHub API.
- Release tags must be `firmware-v<major>.<minor>.<patch>`. The tag version is compared against the compiled-in `FIRMWARE_VERSION`; only a strictly newer version flashes, so a mistagged release cannot downgrade the fleet.
- The release's `.bin` asset is streamed through the `Update` library. The sensor LED holds red while writing, and the device reboots into the new image on success.

---

## Database Schema

All dashboard data access uses `createAdminClient()` (service role — bypasses RLS). RLS policies exist as defence-in-depth and will become load-bearing if authenticated client access is introduced.

```sql
-- Institution registry (one row per tenant)
-- theme_primary: hex brand colour injected as CSS custom properties server-side (no FOUC)
-- theme_preset: curated palette key (e.g. 'indigo', 'rose') or 'custom'; null → platform default
institutions    (id, name, type, logo_url, label_member, label_members, label_group,
                 label_unit, label_period, label_staff, label_staff_plural,
                 track_students, track_staff, student_scan_mode, staff_scan_mode,
                 skip_weekends, device_secret, timezone, theme_primary, theme_preset)

-- Members (students, staff, etc.) — scoped to institution
-- member_type: 'student' | 'staff'  (default 'student')
-- sid is UNIQUE PER INSTITUTION (institution_id, sid), not globally
-- device_id FK is ON DELETE SET NULL (device deletion preserves member records)
members         (id, sid, fullname, group_name, unit_name, fin1, fin2, status, member_type,
                 device_id→devices SET NULL, institution_id, created_at)

-- One ESP32 per unit — scoped to institution
-- scan behaviour is governed by the institution's student_scan_mode/staff_scan_mode
-- provisioning_token: issued by /register, required by /assignment-poll (H7)
devices         (id, group_name, unit_name, display_name, mac, provisioning_token, institution_id)

-- Academic periods — scoped to institution (nullable for office-type institutions)
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
profiles        (id→auth.users, role, assigned_unit, institution_id)

-- Deferred SPIFFS-wipe queue — no FK, survives device row deletion
device_resets   (device_id UUID, created_at)
```

### Migrations

All migrations are in `backend/supabase/migrations/`. They are applied to the cloud instance — do not re-run locally unless testing from scratch.

---

## Auth & RBAC

Authentication uses Supabase Auth (server-side only — all Supabase calls go through Next.js server components and API routes, never from the browser).

### Account Types

| Role | Scope | Access |
|---|---|---|
| `platform_admin` | Cross-institution (no institution_id) | All pages, bypasses all role gates, operates via service role. Responsible for creating institutions and bootstrapping first super_admin per institution. |
| `super_admin` | Institution-scoped | All pages — devices, enrollment, promotion, academic, members, attendance, user management. Can manage users within their institution but cannot create platform_admins. |
| `admin` | Institution-scoped | Members, academic, promotion, attendance — no devices or enrollment. |
| `teacher` | Institution-scoped, unit-scoped | Read-only attendance and members, filtered to their `assigned_unit` only. |
| `staff` | Institution-scoped, unit-scoped | Same as teacher — read-only attendance and members, filtered to their `assigned_unit`. Intended for non-teaching staff in office-type institutions. |

### How it works

- `frontend/lib/supabase/dal.ts` exports `verifySession()`, `requireRole(...roles)`, and `getInstitution(institutionId)`.
- `verifySession()` and `getInstitution()` are both `cache()`-wrapped — one DB hit per render cycle regardless of how many components call them.
- `requireRole()` calls `verifySession()` and redirects to `/unauthorized` if the role doesn't match. `platform_admin` bypasses all role checks.
- **Fail-closed:** an authenticated user with no `profiles` row (or no role) is redirected to `/unauthorized` — it does **not** default to any role. Public sign-up is disabled in Supabase Auth; accounts are created only via `/users` and `/onboarding`.
- **Tenant ownership:** because the dashboard uses the service role (RLS bypassed), every mutating server action verifies the target record belongs to the caller's institution via `lib/supabase/ownership.ts` (`ownsRecord`). `platform_admin` is cross-tenant by design.
- The dashboard layout calls `verifySession()` and passes `role` to the sidebar and mobile nav, which filter nav items by role.
- `teacher` and `staff` have an `assigned_unit` in their profile. Attendance and member data is filtered server-side to that unit before rendering — including the CSV export (`/api/attendance/export`) and the realtime/enrollment SSE streams, which are scoped to the caller's institution.

### Creating the first super_admin (per institution)

After creating an institution in Supabase, insert a profile row for the Supabase Auth user:

```sql
insert into profiles (id, role, institution_id)
values ('<auth-user-uuid>', 'super_admin', '<institution-uuid>');
```

Additional accounts are managed through the `/users` page in the dashboard.

---

## Dashboard Pages

| Route | Access | Description |
|---|---|---|
| `/` | All roles | Overview — today's present/absent counts, attendance rate, and a recent-activity feed (last 8 scans). `teacher`/`staff` see only their unit. `platform_admin` sees a cross-tenant summary: institution count, active members, devices online, and total scans today. |
| `/attendance` | All roles | Attendance records with date, period, member (multi-select), staff (multi-select), unit, status, and member-type filters. Per-member stats panel (present count, absent count, last seen date). Results paginated at 50 rows. `teacher`/`staff` see only their unit. Time-in/time-out scan pairs shown on a single row. CSV export available. |
| `/members` | All roles | Member roster (non-staff). `teacher`/`staff` see only their unit, no edit controls. platform_admin can filter by institution. |
| `/staff` | All roles | Staff member roster. Visible only when `track_staff = true`. Same access rules as `/members`. |
| `/devices` | super_admin, platform_admin | ESP32 device registry and provisioning — assign unregistered devices to units, set display names. Search + institution filter for platform_admin. Devices only enter via physical provisioning (no manual create). |
| `/academic` | super_admin, admin, platform_admin | Academic periods and holidays. Labeled "Periods & Holidays" for office institutions. Supports recurring (yearly) holidays matched by month/day. |
| `/enrollment` | super_admin, platform_admin | Fingerprint enrollment job queue — register, delete, clearall commands sent to devices. Institution column for platform_admin. |
| `/promotion` | super_admin, admin, platform_admin | Bulk year-end promotion — moves members to the next group, resets finger slots, deactivates final-year members. School-type institutions only. |
| `/settings` | super_admin, platform_admin | Institution config — name, logo, type, label overrides, scan modes, skip_weekends, timezone. |
| `/institutions` | platform_admin | All institutions with member/device counts. Edit or delete any institution (deletion fans out SPIFFS wipe to all assigned devices). |
| `/institutions/[id]` | platform_admin | Edit a specific institution's settings. |
| `/onboarding` | platform_admin | Create a new institution and its first super_admin account. |
| `/users` | super_admin, admin, platform_admin | Dashboard account management. `admin` can view the list and change their own password only. `super_admin`/`platform_admin` can create, edit, and delete accounts. At least one super_admin must always exist per institution. Email search and role filter available. |
| `/unauthorized` | — | Shown when a user navigates to a page their role cannot access. |

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
3. Receives a `device_id`, a `provisioning_token`, and `status: "pending"`. The
   device persists both to `provisioning.json` so a reboot keeps the token (H7).
4. Shows yellow breathing LED and polls `POST /assignment-poll` every 5 s, sending
   `{ device_id, provisioning_token }`.
5. An admin assigns the device from the dashboard `/devices` page.
6. Poll returns `status: "assigned"` with `institution_id`, `device_secret`,
   `display_name` — **only if the provisioning_token matches** (otherwise 401).
7. Device writes `device_identity.json` to SPIFFS, deletes `provisioning.json`,
   and begins normal operation.

> **TLS:** the firmware validates server certificates (`certs.h` → `ROOT_CA_BUNDLE`).
> The bootstrap secret lives in `secrets.h` (gitignored), not in source.

### Normal operation

- Every scan: `POST /log-attendance` with `x-device-secret: <per-institution secret>`.
- Enrollment polling: `POST /get-enrollment-job` with `{ device_id }`.
- Enrollment result: `POST /update-enrollment-job` with `{ id, institution_id, status, ... }`.
- `pg_cron` calls `POST /mark-absent` daily with `x-cron-secret` (set in Supabase Vault). **Requires the `pg_net` extension** — enable it in the Supabase dashboard under Database → Extensions before creating the cron job.

### OTA

Firmware checks `https://api.github.com/repos/sgariba21-beep/esp32-attendance-device/releases/latest` on boot. Releases must be tagged `firmware-v<version>` (e.g. `firmware-v1.1.6`). The `.bin` asset is downloaded and flashed via the ESP32 `Update` library.

---

## Key Files

```
esp32-attendance-device/
├── README.md
├── firmware/
│   └── ClassAttendance_Current_RTC/
│       └── ClassAttendance_Current_RTC.ino   ← ESP32 firmware
├── backend/
│   └── supabase/
│       ├── config.toml                        ← edge function config (verify_jwt = false for all)
│       ├── migrations/                        ← all migrations applied to cloud
│       └── functions/
│           ├── log-attendance/
│           ├── mark-absent/                   ← recurring holiday support; iterates all institutions
│           ├── get-enrollment-job/
│           ├── update-enrollment-job/
│           ├── register/
│           └── assignment-poll/
└── frontend/
    ├── proxy.ts                               ← Next.js middleware (NOT middleware.ts)
    ├── AGENTS.md                              ← read before writing any Next.js code
    ├── app/
    │   ├── (auth)/login/
    │   ├── (dashboard)/
    │   │   ├── layout.tsx                     ← verifySession, generateMetadata (dynamic tab title)
    │   │   ├── attendance/
    │   │   ├── members/
    │   │   ├── staff/
    │   │   ├── devices/
    │   │   ├── academic/
    │   │   ├── enrollment/
    │   │   ├── promotion/
    │   │   ├── settings/
    │   │   ├── institutions/
    │   │   │   └── [id]/
    │   │   ├── onboarding/
    │   │   └── users/
    │   ├── api/
    │   │   ├── signin/
    │   │   ├── signout/
    │   │   ├── enrollment-stream/             ← SSE stream for enrollment job updates
    │   │   ├── realtime-stream/               ← SSE stream watching members, devices, periods, attendance
    │   │   │                                     institution-scoped; platform_admin watches all tenants
    │   │   └── attendance/export/             ← CSV export with full filter parity to the attendance page
    │   └── unauthorized/
    ├── lib/
    │   ├── types.ts                           ← shared TS types (InstitutionConfig, AttendanceRecord, Member, Device, AcademicTerm, Holiday)
    │   ├── theme.ts                           ← per-institution brand theming (brandStyle, THEME_PRESETS, brandColumns)
    │   └── supabase/
    │       ├── dal.ts                         ← verifySession, requireRole, getInstitution, UserRole
    │       └── server.ts                      ← createAuthClient, createAdminClient
    └── components/
        ├── sidebar.tsx
        ├── mobile-header.tsx
        ├── mobile-bottom-nav.tsx
        ├── theme-toggle.tsx                   ← dark/light mode toggle
        ├── realtime-refresh.tsx               ← subscribes to /api/realtime-stream; calls router.refresh() on any DB change
        ├── session-manager.tsx                ← inactivity timeout + sessionStorage guard
        └── ui/
            └── single-select.tsx              ← searchable dropdown (used across devices, users, enrollment, members)
```

---

## Phase Status

| Phase | Description | Status |
|---|---|---|
| 1 | Cloud deployment (single-tenant) | ✅ Complete |
| 2 | Multi-tenant schema + edge functions | ✅ Complete |
| 3 | Firmware provisioning flow | ✅ Complete |
| 4 | Frontend — de-brand, institution config, devices page, settings | ✅ Complete |
| 5 | Captive portal — WiFi-only, remove class fields | ✅ Complete (done in Phase 3) |

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
