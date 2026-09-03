# Frontend — Next.js Dashboard

This is the web dashboard for the ESP32 Fingerprint Attendance System. See the [root README](../README.md) for full system documentation.

## Stack

- **Next.js** (App Router) — this version has breaking API changes vs. standard Next.js. Read `AGENTS.md` before editing any Next.js code.
- **shadcn/ui + TailwindCSS** for UI components and styling.
- **Supabase** (server-side only via service role — no browser exposure of keys).

## Development

```bash
npm install
npm run dev
```

The dev server expects a local Supabase instance at `http://127.0.0.1:54321` (or the values in `.env.local`). Copy `.env.local` from a team member or set:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## RBAC check

After making any changes to page files under `app/(dashboard)`:

```bash
node scripts/check-rbac.mjs
```

Exits 1 with a list if any page is missing a `requireRole(` call.

## Middleware

Middleware lives in `proxy.ts`, **not** `middleware.ts`. The matcher must exclude `/api` routes and the PWA assets (`manifest.webmanifest`, `sw.js`, `icons/`) so they stay reachable while logged out.

## Key directories

| Path | Purpose |
|---|---|
| `app/(dashboard)/` | All authenticated dashboard pages |
| `app/(auth)/login/` | Login page |
| `app/api/` | API routes (signin, signout, changes watermark, attendance + shop-report CSV exports, enrollment SSE) |
| `app/manifest.ts` | Web app manifest (`/manifest.webmanifest`) for PWA install |
| `lib/supabase/dal.ts` | `verifySession`, `requireRole`, `resolveInstitutionScope`, `resolveDeviceScope`, `getInstitution` |
| `lib/supabase/server.ts` | `createAuthClient`, `createAdminClient` |
| `components/` | Shared UI components including sidebar, mobile nav, and `pwa/` (SW registration + install prompt) |
| `scripts/check-rbac.mjs` | CI guard for RBAC coverage |
