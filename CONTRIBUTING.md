# Contributing

## Repo structure

```
esp32-attendance-device/
├── firmware/    ESP32 sketch (Arduino), TLS certs, secrets template
├── backend/     Supabase config, migrations, edge functions (Deno)
└── frontend/    Next.js dashboard (App Router)
```

`frontend/AGENTS.md` documents a Next.js version with breaking API changes. Read it before writing any frontend code. Middleware lives in `frontend/proxy.ts`, not `middleware.ts`.

## Frontend setup

```
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with the Supabase project values:

| Variable | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project secret key (server-only) |

For a local Supabase instance, run `supabase status` from `backend/` to get the keys. Apply the schema from `backend/supabase/migrations/`. The dashboard reads and writes through the service role, so the service-role key is required for any page to load.

Create the first account directly in Supabase Auth, then insert a `profiles` row (see the README "Creating the first super_admin" section).

## Firmware setup

1. Install the Arduino IDE and the ESP32 board package (Boards Manager → "esp32" by Espressif).
2. Install the libraries: Adafruit Fingerprint Sensor Library and RTClib. The rest ship with the ESP32 core.
3. Copy `firmware/ClassAttendance_Current_RTC/secrets.example.h` to `secrets.h` in the same folder and set `BOOTSTRAP_SECRET`. Generate it with `openssl rand -hex 32` and set the same value on the Supabase project. `secrets.h` is gitignored.
4. `certs.h` holds the TLS root CA bundle and is committed. Update it if the server certificate chain changes (see the README "Firmware TLS Certs" note).
5. Select board "ESP32 Dev Module", set the port, and flash.

Increment `FIRMWARE_VERSION` on every flash. Cut an OTA release by tagging the build `firmware-v<major>.<minor>.<patch>` and attaching the compiled `.bin`.

## Contributions welcome

- Firmware reliability: queue handling, reconnect logic, sensor error paths.
- Edge function hardening and input validation.
- Dashboard features listed in the README roadmap.
- Documentation fixes.

## Issues and PRs

Open an issue before starting a larger change so the approach can be agreed first. Branch from `main`, keep each PR scoped to one change, and describe what you tested. Do not commit `secrets.h` or any `.env` file.
