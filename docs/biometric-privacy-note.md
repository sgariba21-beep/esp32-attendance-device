# Biometric Data Privacy Note (T24)

This note describes how the system handles biometric data, what is stored where, and
the security controls that protect it. Intended audience: institution administrators,
data protection officers, and members (students/staff) who have enrolled.

---

## What is captured during enrollment

The R503 fingerprint sensor captures a live finger image **only** during enrollment.
That image is processed entirely **on-chip** by the sensor's built-in DSP to produce a
mathematical feature template. The raw image is never stored, transmitted, or logged —
it is discarded by the sensor immediately after template extraction.

The template (a compact numeric representation of ridge patterns) is stored in the
sensor's own flash memory, indexed by a slot number (FID, 1–127).

---

## What the system stores

| Location | What is stored | What is NOT stored |
|---|---|---|
| R503 sensor flash | Feature template (sensor-internal format) | Raw finger image |
| Device SPIFFS | FID→member mapping (`fid_map.json`): slot number, member ID, name, role | Template data |
| Supabase `members` table | `fin1`, `fin2` — integer slot numbers (e.g. `3`, `7`) | Template data, images |
| Supabase `attendance` table | Member ID, timestamp, device ID, scan ID | Any biometric data |

**The cloud database stores only integers that reference sensor slots.** There is no
biometric feature data, image, or hash in the cloud at any time.

---

## Consent and enrollment flow

1. A super_admin or admin initiates enrollment for a specific member via the dashboard.
2. The enrollment job is dispatched to the device assigned to that member's group/unit.
3. The member places their finger on the sensor **twice** (two captures for template quality).
4. The device reports success/failure back to the dashboard (no biometric data in this report).

Members should be informed before enrollment that:
- Their fingerprint pattern is processed locally by the sensor and stored only on the device.
- The cloud system stores only a slot number that maps their identity to the sensor slot.
- Deletion of their enrollment (via dashboard → delete member or delete enrollment) removes
  the `fin1`/`fin2` slot references from the cloud and sends a delete command to the sensor
  to erase the template from the device's flash.

---

## Security controls

**Per-device secrets:** each device holds a unique `device_secret` issued at provisioning
time. Attendance records are only accepted from requests authenticated with this secret.
A compromised device can be revoked by setting `devices.revoked = true` in the database —
all subsequent scans from that device are rejected with HTTP 401.

**Server-side revocation:** the `device_resets` table provides a persistent decommission
signal. Once a row exists for a device, `get-enrollment-job` returns `decommissioned: true`
on every poll until the device re-registers with a new identity. This prevents a revoked
device from continuing to submit scans even if it has cached credentials.

**Template non-exportability:** the R503 stores templates in a proprietary internal format.
The firmware does not expose any API to read or export templates. The only operations
supported are: enroll (write to slot), search (match against all slots), delete (erase slot).

**No cloud storage of biometric data:** as described above, the Supabase database never
receives template or image data. The `fin1`/`fin2` columns are plain integers. Even with
full database access, an attacker cannot reconstruct fingerprint data.

---

## Data subject rights

| Right | How to exercise |
|---|---|
| Access | Admin can view which slot numbers are assigned to a member; no biometric data is accessible |
| Deletion | Admin deletes the member's enrollment in the dashboard; the device erases the sensor slot |
| Objection | Member can decline enrollment; the system supports manual ID entry as an alternative |

For questions or deletion requests, contact the institution administrator or the platform
operator at sgariba21@gmail.com.

---

## Retention

- Sensor templates are retained until the member is unenrolled or the device is reset.
- Attendance records in Supabase are retained according to the institution's configured
  retention policy (no automated purge is enforced by the platform at this time).
- SPIFFS scan logs (`scan_log.txt`) on the device are rotated when the file exceeds the
  configured size limit.
