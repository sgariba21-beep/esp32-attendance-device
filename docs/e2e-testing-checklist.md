# E2E Testing Checklist

Tests to run after applying all migrations, deploying edge functions, and flashing new firmware.
Mark each ✅ as it passes. Tests are grouped by area and ordered by dependency.

---

## 1. Device auth & revocation (T1e, T11)

- [ ] **New provisioning:** factory-reset a device (clear SPIFFS), power on → serial logs show
  `"No device identity found"` → registers → polls → receives `device_secret` (not the shared
  institution secret). Confirm `devices.device_secret IS NOT NULL` in Supabase.

- [ ] **Per-device scan auth:** scan a finger → check Supabase `attendance` table. Record should
  have `device_id` set to the device's UUID (not null).

- [ ] **Revoke device:** set `devices.revoked = true` for the device. Scan a finger. Edge function
  should return 401 and the scan must NOT appear in `attendance`.

- [ ] **Decommission durability (T11):** insert a row in `device_resets` for the device.
  Wait for `get-enrollment-job` poll. Verify the device wipes identity and reboots. Power-cycle
  and observe the device re-registers. Confirm `device_resets` row still exists (not deleted on
  read) — a second poll before re-registration should still return `decommissioned: true`.

- [ ] **Legacy fallback path:** a device running old firmware (no `device_id` in payload) with
  the institution's shared secret should still log attendance successfully during the transition
  period.

---

## 2. SPIFFS queue durability & race (T2, T12)

- [ ] **Offline queue:** disconnect WiFi (or block with a bad SSID), scan 3 fingers. Reconnect.
  Verify all 3 scans appear in `attendance` within the next flush interval (≤15 s).

- [ ] **Crash recovery:** scan a finger → immediately cut power while the green LED is on.
  Restore power. Verify `queue_inflight.txt` is not present in SPIFFS (merged on boot) and the
  scan eventually reaches `attendance`.

- [ ] **Concurrent append:** scan two fingers in quick succession (< 500 ms apart). Verify both
  arrive in `attendance` with correct `scan_id` (no duplicate, no lost record).

- [ ] **FingerprintTask writes before network:** confirm in serial log that `"[queue] Persisted
  to SPIFFS"` appears **before** `"flushQueue: sent OK"` for every scan.

- [ ] **QUEUE_MAX_SPIFFS_ENTRIES cap:** queue more than `QUEUE_MAX_SPIFFS_ENTRIES` records
  offline. On reconnect, verify the oldest are dropped and the cap is logged as
  `"flushQueue: cap enforced"`.

---

## 3. Tenant isolation & RBAC (T4, T5, T6, T20)

- [ ] **Cross-tenant scan rejection:** POST a log-attendance request with a valid `device_id`
  from institution A but a member `sid` from institution B. Verify the edge function returns
  a non-200 (member not found in scope).

- [ ] **update-enrollment-job scoping (T4):** submit an enrollment update for a member in
  institution B using a device from institution A's `device_secret`. The edge function should
  reject (403 or 404 — device not found with that secret).

- [ ] **Staff page visibility (T20):** log in as a `teacher` role user. Navigate to `/staff`.
  Should redirect to `/unauthorized` or return 403 — teachers must not see the staff list.

- [ ] **Admin route gate (T5):** log in as a `teacher`. Attempt to navigate to `/devices`,
  `/users`, `/institutions`, `/enrollment`, `/onboarding`. Each should redirect to
  `/unauthorized`.

- [ ] **check-rbac.mjs passes:** run `node scripts/check-rbac.mjs` from the `frontend/`
  directory. Should exit 0 with no ungated pages reported.

- [ ] **resolveInstitutionScope (T6):** as a non-platform user with no `institution_id`, any
  page calling `resolveInstitutionScope` should redirect to `/unauthorized` rather than
  querying with a null institution filter.

---

## 4. Polling watermark (T3f, T3p, T16)

- [ ] **Watermark trigger:** make a change (add attendance record, update a member). Verify
  `institution_activity.last_change_at` is updated for that institution.

- [ ] **No spurious refresh:** open the dashboard. Wait 30 s with no changes. Verify no
  unnecessary `router.refresh()` calls (check browser network tab — no `/api/changes`
  follow-up refetch cascade).

- [ ] **Refresh on change:** make a change in a second tab. Within 12 s the first tab should
  refresh and display the updated data.

- [ ] **410 tombstone:** GET `/api/realtime-stream`. Should return HTTP 410 with body
  `"Gone — use /api/changes"`.

- [ ] **Realtime cleanup (T16):** confirm `members`, `devices`, `periods`, `attendance`,
  `holidays` are no longer in the `supabase_realtime` publication. `enrollment_jobs` should
  still be present (enrollment-stream uses it).

---

## 5. mark-absent cron (T15)

- [ ] **Batch concurrency:** with ≥9 institutions in the database, trigger `mark-absent` manually
  via the Bearer token. Verify serial/log output shows batches of 8 processed concurrently,
  not sequentially one-by-one.

- [ ] **Absent records created:** after a period ends with no attendance, verify absent records
  appear in `attendance` for enrolled members.

- [ ] **Idempotency:** run `mark-absent` twice for the same period. Absent records should not
  be duplicated (the function should skip already-marked members).

---

## 6. Onboarding & UX (T17, T18, T21, T22, T23)

- [ ] **Timezone (T17):** create a new institution via onboarding with timezone set to
  `Africa/Lagos`. Verify `institutions.timezone = 'Africa/Lagos'` in Supabase.

- [ ] **Shop labels (T18):** create a `shop` type institution. Verify the `label_member` is
  `'Customer'` (or the configured neutral label) and NOT `'Student'`.

- [ ] **Forgot password (T21):** on the login page, verify "Forgot your password?" text with a
  `mailto:sgariba21@gmail.com` link is visible and opens the mail client when clicked.

- [ ] **Password whitespace (T22):** create a password that starts with a space (e.g.
  `" MyPassword"`). Verify login succeeds — the password is NOT trimmed before submission.

- [ ] **Low-stock warning (T23):** sell a product that has `stock_quantity = 1`. After the
  sale, the dialog should stay open and show a warning about negative/zero stock. Clicking
  "Close" dismisses it. The sale record IS created despite the warning.

---

## 7. Firmware (T9, T14)

- [ ] **Identity race (T9):** on a newly-provisioned device, scan a finger immediately after
  the green "assigned" LED blink. The attendance record should correctly carry the new
  `institution_id`, not an empty string. (Tests the compiler barrier before
  `pendingAssignment = false`.)

- [ ] **OTA jitter (T14):** power-cycle 3 devices simultaneously. Check serial logs — each
  should print `"OTA: boot jitter Xms"` with a different value. Verify no device gets HTTP
  429 from GitHub.

- [ ] **OTA no-downgrade:** set `OTA_REPO_API` to point to a release with an older version
  tag. Verify the device prints `"OTA: No newer firmware available."` and does NOT flash.

---

## 8. Teacher scoping (T8)

- [ ] **FK path:** for a teacher with `assigned_device_id` set (backfilled by migration
  `20260628120100`), the attendance page should show only records from that device's group.

- [ ] **String-match fallback:** for a teacher with `assigned_device_id = null` but a valid
  `assigned_unit` string, the attendance page should still filter correctly via the
  group/unit name match.

- [ ] **No device assigned:** for a teacher with neither FK nor string match, the attendance
  page should show an empty state message: "Your account isn't assigned to a unit yet —
  contact your administrator."

---

## 9. Enrollment (T4f)

- [ ] **Wrong institution:** attempt to enroll a member whose `institution_id` doesn't match
  the device's institution. The enrollment action should return an error before writing to
  the sensor.

- [ ] **Inactive member:** attempt to enroll a member with `status != 'active'`. Should be
  rejected with a clear error message.

- [ ] **Device mismatch:** attempt to enroll a member assigned to device A using device B's
  enrollment job. Should be rejected.

---

*Last updated: 2026-06-28. Run this checklist on each significant release.*
