# ESP32 Fingerprint Attendance System

Multi-tenant biometric attendance tracking system. ESP32 devices with R503 fingerprint sensors record attendance; a Next.js dashboard backed by Supabase provides real-time reporting, device provisioning, and management. Each institution (school, office, etc.) is isolated — one cloud Supabase project serves all tenants.

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

## Database Schema

All dashboard data access uses `createAdminClient()` (service role — bypasses RLS). RLS policies exist as defence-in-depth and will become load-bearing if authenticated client access is introduced.

```sql
-- Institution registry (one row per tenant)
institutions    (id, name, type, logo_url, label_member, label_members, label_group,
                 label_unit, label_period, label_staff, label_staff_plural,
                 track_students, track_staff, student_scan_mode, staff_scan_mode,
                 skip_weekends, device_secret, timezone)

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

- `frontend/lib/supabase/dal.ts` exports `verifySession()` and `requireRole(...roles)`.
- `verifySession()` is `cache()`-wrapped — one DB hit per render cycle regardless of how many pages call it.
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
| `/attendance` | All roles | Attendance records with date, period, member, unit filters. `teacher`/`staff` see only their unit. Time-in/time-out scan pairs shown on a single row. |
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
| `/users` | super_admin, admin, platform_admin | Dashboard account management. `admin` can view the list and change their own password only. `super_admin`/`platform_admin` can create, edit, and delete accounts. At least one super_admin must always exist per institution. |
| `/unauthorized` | — | Shown when a user navigates to a page their role cannot access. |

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
- `pg_cron` calls `POST /mark-absent` daily with `x-cron-secret` (set in Supabase Vault).

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
    │   │   └── enrollment-stream/             ← SSE stream for enrollment job updates
    │   └── unauthorized/
    ├── lib/
    │   └── supabase/
    │       ├── dal.ts                         ← verifySession, requireRole, UserRole
    │       └── server.ts                      ← createAuthClient, createAdminClient
    └── components/
        ├── sidebar.tsx
        ├── mobile-bottom-nav.tsx
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
