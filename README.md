# ESP32 Fingerprint Attendance System

Biometric classroom attendance tracking system. ESP32 devices with R503 fingerprint sensors record student attendance; a Next.js dashboard backed by Supabase provides real-time reporting and management.

---

## Architecture

```
┌─────────────────────────────┐
│       ESP32 Devices         │
│  R503 fingerprint sensor    │
│  One device per classroom   │
└────────────┬────────────────┘
             │ HTTPS (x-device-secret)
             │ Cloudflare Tunnel
             ▼
┌─────────────────────────────┐
│     Next.js Dashboard       │
│     (Node.js server)        │
│  /api/* — device endpoints  │
└────────────┬────────────────┘
             │ localhost
             ▼
┌─────────────────────────────┐
│   Supabase (local instance) │
│   PostgreSQL + Auth         │
│   pg_cron (mark-absent)     │
│   127.0.0.1:54321           │
└─────────────────────────────┘
```

**Why Cloudflare Tunnel?** The school WiFi enforces client isolation — devices on the network cannot reach each other directly. The ESP32s connect outbound through a Cloudflare Tunnel to the Next.js server, which is the only machine that can reach the local Supabase instance.

**Why server-side only auth?** Supabase runs on `127.0.0.1` and is not reachable from a browser on another device. All Supabase calls go through Next.js server components and API routes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Firmware | Arduino (ESP32), FreeRTOS, R503 fingerprint library |
| Database | Supabase (local), PostgreSQL, pg_cron |
| Backend | Next.js App Router API routes |
| Frontend | Next.js App Router, shadcn/ui, TailwindCSS |
| Auth | Supabase Auth (server-side only) |
| Tunnel | Cloudflare Tunnel |

> **Note on Next.js version:** This project uses a version with breaking API changes from standard Next.js. The `middleware.ts` convention is not used — middleware logic lives in `frontend/proxy.ts` and its matcher explicitly excludes `/api` routes so device handlers are not redirected. Read `frontend/AGENTS.md` before writing any Next.js code.

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

All tables use RLS with service-role-only policies. All data access from Next.js uses `createAdminClient()` (service role key).

```sql
-- Academic terms
academic        (id, term, year, status, start_date, end_date)

-- Students
students        (id, sid, fullname, form, class, fin1, fin2, status, device_id, created_at)

-- One ESP32 per classroom
devices         (id, form, class)

-- Attendance records (present/absent), written by ESP32 or pg_cron
attendance      (id, sid→students, academic_id→academic, device_id→devices, date, time, status, scan_id)

-- Remote fingerprint enrollment queue
enrollment_jobs (id, device_id→devices, student_id→students, finger_slot, command, status, fid, note, created_at)

-- School holidays (excluded from mark-absent cron)
holidays        (id, date, label)

-- Dashboard user roles (one row per auth.users entry)
profiles        (id→auth.users, role, assigned_class)
```

### Migrations

All migrations are in `backend/supabase/migrations/`. Apply with `supabase migration up` or `supabase db reset`.

---

## Auth & RBAC

Authentication uses Supabase Auth. Role-based access is enforced via the `profiles` table.

### Account Types

| Role | Access |
|---|---|
| `super_admin` | Everything — devices, enrollment, promotion, academic, students, attendance, user management |
| `admin` | Students, academic, promotion, attendance — no devices or enrollment |
| `teacher` | Read-only attendance and students, scoped to their `assigned_class` only |

### How it works

- `frontend/lib/supabase/dal.ts` exports `verifySession()` and `requireRole(...roles)`.
- `verifySession()` is `cache()`-wrapped — multiple calls per render cycle hit the DB once.
- `requireRole()` calls `verifySession()` and redirects to `/unauthorized` if the role doesn't match.
- Every page and every server action calls `requireRole()` at the top.
- The dashboard layout calls `verifySession()` and passes `role` to the sidebar and mobile nav, which filter their nav items accordingly.
- Teachers have an `assigned_class` (e.g. `"Form 3 Science 1"`) stored in `profiles`. Attendance and student data is filtered server-side to that class before rendering.

### Creating the first super_admin

After running migrations, insert a profile row for the existing Supabase Auth user:

```sql
insert into profiles (id, role)
values ('<auth-user-uuid>', 'super_admin');
```

Additional accounts are created through the `/users` page in the dashboard.

---

## Dashboard Pages

| Route | Access | Description |
|---|---|---|
| `/attendance` | All | Attendance records with date, term, student, class filters. Teachers see only their class and can filter by student. |
| `/students` | All (teacher: read-only) | Student roster. Teachers see only their class with no edit controls. |
| `/devices` | super_admin | ESP32 device registry — form and class per device. |
| `/academic` | super_admin, admin | Academic terms (with dates) and school holidays. |
| `/enrollment` | super_admin | Fingerprint enrollment job queue — register, delete, clearall commands sent to devices. |
| `/promotion` | super_admin, admin | Bulk year-end promotion — moves students to the next form, resets finger slots, deactivates final-year students. |
| `/users` | super_admin | Dashboard account management — create/edit/delete accounts, assign roles. At least one super_admin must always exist. |
| `/unauthorized` | — | Shown when a user navigates to a page their role can't access. |

---

## Device Authentication

ESP32 devices authenticate using an `x-device-secret` header on all API calls. The pg_cron mark-absent job uses a Bearer token. Both secrets are environment variables on the Next.js server.

---

## Session Behaviour

- Sessions use Supabase Auth cookies managed entirely server-side.
- `frontend/components/session-manager.tsx` enforces a 10-minute inactivity timeout client-side.
- A `sessionStorage` flag (`app_session_active`) guards against cross-tab session reuse — navigating to the dashboard in a new tab signs the user out.
- Login rate-limiting: 3 failed attempts trigger a 5-minute client-side lockout (stored in `localStorage`).

---

## Key Files

```
esp32-attendance-device/
├── README.md                                    ← you are here
├── firmware/
│   └── ClassAttendance_Current_RTC.ino          ← ESP32 firmware
├── backend/
│   └── supabase/
│       └── migrations/                          ← all DB migrations (apply in order)
└── frontend/
    ├── proxy.ts                                 ← Next.js middleware (NOT middleware.ts)
    ├── AGENTS.md                                ← read before writing any Next.js code
    ├── app/
    │   ├── (auth)/login/                        ← login page
    │   ├── (dashboard)/                         ← all protected pages
    │   │   ├── layout.tsx                       ← verifySession, passes role to nav
    │   │   ├── attendance/
    │   │   ├── students/
    │   │   ├── devices/
    │   │   ├── academic/
    │   │   ├── enrollment/
    │   │   ├── promotion/
    │   │   └── users/
    │   ├── api/
    │   │   ├── signin/                          ← sets Supabase auth cookies
    │   │   └── signout/                         ← clears Supabase auth cookies
    │   └── unauthorized/                        ← access denied page
    ├── lib/
    │   └── supabase/
    │       ├── dal.ts                           ← verifySession, requireRole, UserRole
    │       └── server.ts                        ← createAuthClient, createAdminClient
    └── components/
        ├── sidebar.tsx                          ← desktop nav, role-filtered
        ├── mobile-bottom-nav.tsx                ← mobile nav, role-filtered
        └── session-manager.tsx                  ← inactivity timeout + sessionStorage guard
```

---

## Getting Started

### 1. Start Supabase

```bash
supabase start
supabase migration up
```

Insert a super_admin profile row (see [Creating the first super_admin](#creating-the-first-super_admin)).

### 2. Run the dashboard

```bash
cd frontend
npm install
npm run dev
```

The dashboard is available at `http://localhost:3000`.

### 3. Flash a device

Open `firmware/ClassAttendance_Current_RTC.ino` in Arduino IDE, fill in WiFi credentials and the Cloudflare Tunnel URL, select the ESP32 board, and upload.
