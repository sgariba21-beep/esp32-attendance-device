# Device-Secret Migration Rollout Guide (T20m)

<!-- Do NOT auto-apply to cloud; run after review. -->

This guide covers the safe sequence for migrating from the shared `institutions.device_secret`
to per-device secrets (`devices.device_secret`). Follow these steps in order; out-of-order
deployment will cause devices to fail log-attendance until they complete re-provisioning.

---

## Background

**Before this migration:** every device in an institution shared the same secret stored in
`institutions.device_secret`. A compromised device exposed the secret for all devices in
that institution.

**After this migration:** each device has a unique `devices.device_secret` issued at
provisioning time (during `/assignment-poll`). The shared secret is kept as a fallback during
the transition period and removed once all devices are re-provisioned.

---

## Step 1 — Apply backend migrations (schema)

Apply the migration files in timestamp order. **Do not apply to cloud automatically.**

```
20260628120000_per_device_secret.sql          -- adds devices.device_secret, devices.revoked
20260628120100_profiles_assigned_device_fk.sql -- adds profiles.assigned_device_id + backfill
20260628120200_institution_activity_watermark.sql -- polling watermark triggers
20260628120300_realtime_cleanup.sql           -- remove REPLICA IDENTITY FULL from unused tables
```

Review each file header, then apply via the Supabase SQL editor or `supabase db push` in a
maintenance window.

**Verify:**
```sql
-- Each should return the new column
select id, device_secret, revoked from devices limit 5;
select id, assigned_device_id from profiles limit 5;
select * from institution_activity;
```

---

## Step 2 — Deploy updated edge functions

Deploy all six edge functions in one shot (they are backwards-compatible with both old
firmware and new firmware during the transition):

```
assignment-poll      -- issues per-device secret on first assignment
log-attendance       -- dual-path: device_id header path + legacy institution secret path
get-enrollment-job   -- authenticates via devices.device_secret
update-enrollment-job -- authenticates via devices.device_secret + derives institution from device
mark-absent          -- batched (BATCH_SIZE=8), no auth change
```

The `log-attendance` function supports **both** auth paths simultaneously during the rollout:
- New firmware: sends `device_id` in body + `x-device-secret: <per-device-secret>` header
- Old firmware: sends `institution_id` in body + `x-device-secret: <shared-secret>` header

Do not remove the legacy path until all devices are re-provisioned.

---

## Step 3 — OTA firmware update

Tag a new firmware release on GitHub Releases with the `fw-` prefix and the new binary.
Devices will check for updates on the next boot (after a randomised 0–120 s jitter).

New firmware changes relevant to this migration:
- `queueAndSignal()` replaces `sendOrQueuePayload()` — SPIFFS-only queue, no memory queue
- Attendance payload now includes `device_id`
- `reportEnrollUpdate` payload now includes `device_id`
- `pollAssignment()` stores the per-device secret it receives from `/assignment-poll`

Monitor serial logs for `"Assigned! institution_id="` to confirm devices received their
per-device secrets. Devices that are already assigned will **not** automatically get a
per-device secret via OTA alone — they need re-provisioning (Step 4).

---

## Step 4 — Re-provision each device (delete + re-add in dashboard)

For each device that is already assigned (i.e., `devices.device_secret IS NULL`):

1. In the dashboard, go to **Devices** → select the device → **Delete**.
   - This triggers the decommission flow: the device wipes its identity on next
     `get-enrollment-job` poll and reboots into provisioning mode.
2. Power-cycle the device if it doesn't self-reboot within ~2 minutes.
3. The device will call `/register` (new MAC-based registration) and wait for assignment.
4. In the dashboard, **Add device** with the same display name / group / unit, then assign it.
5. On next `/assignment-poll`, the device receives its unique `devices.device_secret` and
   stores it in SPIFFS. `log-attendance` will now use the per-device path.

**Batch re-provisioning:** process one institution at a time. Devices continue scanning with
the legacy path while awaiting re-provisioning.

---

## Step 5 — Remove the transitional (legacy) path

Once `devices.device_secret IS NULL` returns zero rows for all institutions:

```sql
select count(*) from devices where device_secret is null and revoked = false;
-- Must return 0 before proceeding
```

Then remove the legacy fallback in `log-attendance/index.ts` (the `TRANSITION` block) and
redeploy the function. At this point, any old-firmware device will start getting 401s —
ensure all devices have received the OTA before removing the transition path.

---

## Rollback

- If edge function deploy causes issues: re-deploy the previous function versions from git.
- If a device gets stuck in provisioning loop: check `devices` table for duplicate MACs;
  delete the orphaned row and let the device re-register.
- Schema migrations cannot be automatically rolled back — keep the `devices.device_secret`
  column even if reverting edge functions (it is nullable and harmless if unused).

---

## Revoking a compromised device

```sql
-- Immediately blocks the device from logging attendance
update devices set revoked = true where id = '<device-uuid>';
```

The device will receive a 401 on its next scan. To permanently decommission, also insert
into `device_resets` (the get-enrollment-job path returns `decommissioned: true` persistently
once a row exists there).
