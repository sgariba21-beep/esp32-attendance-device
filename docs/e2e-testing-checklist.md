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
  with the `x-cron-secret: <CRON_SECRET>` header (Kong strips `Authorization` before it reaches
  the function — a Bearer token returns 401). Verify serial/log output shows batches of 8
  processed concurrently, not sequentially one-by-one.

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

- [ ] **Low-stock warning (T23):** sell a product that has `stock = 1`. After the
  sale, the dialog should stay open and show a warning about negative/zero stock. Clicking
  "Close" dismisses it. The sale record IS created despite the warning. (This warning was
  silently dead until the rewards-redemption pass — the query selected a nonexistent
  `stock_quantity` column instead of `stock`; confirm it now actually fires.)

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

## 10. Rewards redemption (applies migrations `20260823150417_rewards_redemption_link`, `20260823150444_create_sale_fn_v2`, `20260823150629_create_sale_revoke_public`, `20260823152205_create_sale_fn_atomic_redeem_guard`, `20260823152412_rewards_log_enforce_non_repeatable`)

- [ ] **Free service, existing line:** build a rule a client has already earned (e.g. visit
  count). Open Sales, pick that client, add the target service to the cart at its normal
  price, then press **Apply** on the offer. The line's price should zero out and lock —
  quantity and price fields become uneditable, catalog select becomes uneditable.

- [ ] **Free service, no existing line:** same as above but do NOT add the service first.
  Apply should add a new locked line at qty 1 / price 0.

- [ ] **Undo:** after Apply (either path above), press **Undo**. A line that existed before
  should return to its original editable price; a line Apply added should disappear entirely.

- [ ] **Discount:** apply a discount-kind reward. Verify the footer shows "Subtotal X − reward Y"
  above the final total, and the final total is subtotal minus the reward value (never below
  zero if the reward exceeds the subtotal).

- [ ] **Custom reward:** apply a custom-kind reward. Verify its description text is appended to
  the sale Note field.

- [ ] **Record the sale.** After submit, confirm in Supabase:
  - `transactions.discount_total` matches the discount applied (0 if none).
  - `transaction_items` for the free line has `reward_id` set to the reward's id and
    `unit_price = 0`.
  - `rewards_log` has a new row (or an existing row updated) with `transaction_id` set to the
    new transaction's id.

- [ ] **Reward disappears after redemption:** reopen Sales for the same client. The
  just-redeemed reward should no longer appear as an offer (unless the client re-earned it).

- [ ] **Pending / IOU redemption:** issue a reward standalone from the Clients page (not via a
  sale) so `rewards_log.transaction_id` is null. Open Sales for that client — the offer should
  appear labelled "already earned." Apply and record a sale. Confirm the SAME `rewards_log` row
  got `transaction_id` set (no duplicate row was created).

- [ ] **Double-redeem guard:** attempt to redeem the same pending IOU from two sales in quick
  succession (two browser tabs, or two rapid submits). Only one should succeed; the second
  should fail with a clear error, not silently double-write.

- [ ] **Losing a redemption race doesn't still charge the discount (bug fix):** this is the
  scenario the guard above exists to prevent — confirm specifically that the FAILED sale in that
  test was not recorded at all (no `transactions` row, no stock decrement), not just that the
  reward wasn't double-attached. Before the fix, the losing side's sale still completed at the
  discounted price even though its reward redemption silently failed to attach.

- [ ] **Non-repeatable reward can't be double-granted (bug fix):** for a non-repeatable reward,
  fire two `issueReward` calls for the same client in quick succession (two tabs on the Clients
  Loyalty dialog). Only one should succeed; the second should get a clear "already issued"
  error, not a second `rewards_log` row.

- [ ] **Sales panel hides an offer whose catalog target is archived (bug fix):** build a
  free_product/free_service reward, have a client earn it (fresh eligibility, or issue it
  standalone so it's pending), then archive the target product/service in Catalog. Reopen Sales
  for that client — the offer should NOT appear, in neither the freshly-eligible nor the
  "already earned" list. Un-archive the item and confirm it reappears.

- [ ] **Sales panel hides a pending IOU whose rule was archived (bug fix):** issue a reward
  standalone (pending, unredeemed), then archive the reward rule itself in Loyalty. Reopen Sales
  for that client — the IOU should not appear. It should still count toward Reports' Outstanding
  figure even while hidden from the till.

- [ ] **Cashier can issue and apply:** log in as a `cashier` role user. Confirm they can press
  "Issue reward" from the Clients page Loyalty dialog, and Apply a reward in Sales — both
  without an admin.

- [ ] **Ineligible client blocked:** attempt to issue a reward (via the Rules-tab Issue dialog)
  to a client who has NOT earned it. That client should not appear in the picker at all.

- [ ] **Rolling-window repeatable rule doesn't over-issue (bug fix):** build a repeatable
  `rolling_days` rule (e.g. "spend 500 in any 30 days"). Have a client hit the threshold once,
  issue it, then confirm they read as NOT eligible again the same day, even though the
  qualifying spend is still inside the 30-day window. They should only become eligible again
  after NEW spend past the issuance date.

- [ ] **Reports — redeemed vs outstanding:** after a mix of redeemed and standalone (unredeemed)
  issuances, open Reports → Rewards. Confirm the Redeemed and Outstanding columns match reality,
  and the outstanding-count badge above the table is correct.

---

## 11. Tracked weekdays, time format & punctuality (migration `20260830120000`)

- [ ] **Tracked weekdays:** in Settings, deselect Wed from "Days tracked" and save. Scan on a
  Wednesday → verify no attendance row is written and `mark-absent` creates no rows for that
  Wednesday. Re-select Wed and confirm normal behaviour returns.

- [ ] **Weekend tracking:** select Sat + Sun in "Days tracked". Verify scans and absences are
  generated on the weekend (the old skip_weekends special-case is gone).

- [ ] **Time display:** set Settings → Time display to 12-hour. Verify attendance times and the
  recent-scans feed render as `1:30 PM`; confirm the CSV export still contains 24-hour `HH:MM:SS`.

- [ ] **Late arrival:** enable "Flag late arrivals", set an expected start time and a grace
  window. A scan after `start + grace` gets `attendance.punctuality = 'late'` and a **Late**
  badge; a scan before it reads `on_time` with no badge. A `mark-absent` placeholder leaves
  `punctuality` NULL.

- [ ] **Early departure:** enable "Flag early departures" for a member type on Time In / Time Out
  mode. A `time_out` scan before `end - grace` gets `punctuality = 'early_leave'` and an
  **Early** badge. Confirm it is inert for a Present / Absent member type.

## 12. Enrollment job reliability (migrations `20260902120000`, `20260902130000`)

- [ ] **member_id rename:** create a register job. Confirm `enrollment_jobs.member_id` is set
  (not `student_id`) and the device (firmware ≥ 1.10.0) enrolls the correct member.

- [ ] **Occupied-slot refusal:** target a sensor slot that physically holds a template but reads
  as free server-side. With `allow_overwrite = false` the device refuses and reports `failed`
  with a `last_error`. Re-dispatch with the overwrite confirmation checked → it enrols.

- [ ] **Stuck-job self-heal:** dispatch a job, then kill the device before it POSTs
  `update-enrollment-job`. Verify `get-enrollment-job` re-delivers the job after the timeout,
  `attempts` increments, and after the cap the job is auto-failed with `last_error`.

- [ ] **Status guard:** once a job is `completed` / `failed`, a late `update-enrollment-job`
  write (or a raced `in_progress` write) does not move it back — the terminal status sticks,
  but `note` / `fid` / `last_error` still update.

- [ ] **Dashboard retry / cancel:** on a failed or stuck row on `/enrollment`, use **Retry** and
  **Cancel** and confirm each does what it says.

## 13. Installable PWA (`app/manifest.ts`, `public/sw.js`, `proxy.ts`)

- [ ] **Manifest reachable unauthenticated:** logged out, GET `/manifest.webmanifest` and
  `/sw.js` → both return 200 (not a 307 to `/login`).

- [ ] **Install prompt:** in Chrome/Edge, load the dashboard and confirm the in-app "Install
  app" affordance appears and installs to the home screen / desktop.

- [ ] **No stale caching:** after installing, deploy a change and reopen the installed app →
  the new version loads (the service worker never caches; `/sw.js` is served `no-cache`).

---

*Last updated: 2026-09-03. Run this checklist on each significant release.*
