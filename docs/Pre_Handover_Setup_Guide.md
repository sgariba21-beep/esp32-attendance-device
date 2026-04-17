# ESP32 Fingerprint Attendance System
## Pre-Handover Setup Guide

**Document Type:** Technician Reference  
**System:** ESP32 Fingerprint Attendance — Ejura Water System  
**Audience:** System Administrator / Developer  
**Version:** 1.1  

---

## Table of Contents

1. [Google Sheets Setup](#1-google-sheets-setup)
2. [Apps Script Deployment](#2-apps-script-deployment)
3. [Firmware Configuration and Flash](#3-firmware-configuration-and-flash)
4. [First-Boot Verification](#4-first-boot-verification)
5. [Enrolling the Master Finger](#5-enrolling-the-master-finger)
6. [Enrolling Employee Fingerprints](#6-enrolling-employee-fingerprints)
7. [End-to-End Functional Test](#7-end-to-end-functional-test)
8. [Handover Checklist](#8-handover-checklist)

---

## 1. Google Sheets Setup

### 1.1 Create the BranchMap Spreadsheet

The system uses a two-level spreadsheet structure. The **BranchMap** is a single central spreadsheet that the Apps Script uses to route attendance to the correct branch. Each branch then gets its own auto-created spreadsheet.

1. Go to **sheets.google.com** and click **Blank spreadsheet** inside the Google account that will own the Apps Script.
2. Rename it clearly — e.g. *Ejura Water System — Attendance Map*.
3. Copy the Spreadsheet ID from the URL bar (the long string between `/d/` and `/edit`). You will paste this into the Apps Script config as `BRANCHMAP_SPREADSHEET_ID`.

> The BranchMap sheet itself and each branch's attendance spreadsheet are created automatically by the Apps Script — you do not need to create any tabs or columns manually.

### 1.2 Branch Spreadsheet and Enrollment Tab

The branch spreadsheet for Ejura Water System is auto-created on the device's first scan. The **Enrollment** tab inside it is created automatically the first time the device polls for enrollment jobs (within 10 seconds of boot, if WiFi is connected).

No manual tab creation is required.

> **WARNING:** If you see enrollment commands silently failing, check that the Apps Script is deployed and reachable. The Enrollment tab cannot be created if the script returns an error.

---

## 2. Apps Script Deployment

### 2.1 Open the Script Editor

1. In the BranchMap Google Sheet, click **Extensions → Apps Script**.
2. Delete any existing code in the editor window.
3. Paste the full contents of `backend/Class_Attendance_Apps_Script.js`.

### 2.2 Set the Configuration Constants

Locate the `/* CONFIG */` section at the top of the script and fill in the following values:

| Constant | Value for this deployment |
|----------|--------------------------|
| `BRANCHMAP_SPREADSHEET_ID` | The spreadsheet ID copied in step 1.1 |
| `SHIFT_START_HOUR` / `SHIFT_START_MIN` | `20` / `0` (shift starts 8:00 PM) |
| `SHIFT_END_HOUR` / `SHIFT_END_MIN` | `23` / `0` (shift ends 11:00 PM) |
| `LATE_GRACE_MINUTES` | `30` (30 minutes tolerance before marking Late) |
| `EARLY_GRACE_MINUTES` | `30` (30 minutes tolerance before marking Left-Early) |
| `adminEmails` | Array of email addresses to receive the monthly report |
| `SCRIPT_AUTH_KEY` | A secret string — e.g. `"ejura-auth-2025"`. Set the same value in the firmware. Leave `''` to disable. |

### 2.3 Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Set **Execute as: Me**.
4. Set **Who has access: Anyone**.
5. Click **Deploy**. Authorise the script when prompted — grant all requested permissions.
6. Copy the **Web app URL** that appears (ends in `/exec`). This is the `SCRIPT_URL` for the firmware.

> **NOTE:** Every time you edit the script and want the changes to go live, you must create a **New deployment** — updating an existing deployment does NOT update the live app. After each new deployment, update `SCRIPT_URL` in the firmware and re-flash the device.

### 2.4 Set Up Time-Driven Triggers

Two functions must run automatically on a schedule.

1. Click the **clock icon (Triggers)** in the left sidebar of the Apps Script editor.
2. Click **+ Add Trigger** (bottom right).
3. Configure the **nightly job** trigger:
   - Function: `runNightlyJob`
   - Event source: Time-driven
   - Type: Day timer
   - Time: **12am–1am**

   > **Note for this deployment:** The shift ends at 11:00 PM. Running the nightly job at 11pm–midnight risks marking employees as absent or "No Check-Out" before the shift has ended. Set this trigger to **12am–1am** to ensure the full shift window is captured.

4. Click **Save**. Add a second trigger:
   - Function: `sendMonthlySummary`
   - Event source: Time-driven
   - Type: Month timer
   - Day: **16**
   - Time: **1am–2am**

   > **Note:** The summary covers the pay period from the 16th of the previous month to the 15th of the current month. Running on the 16th at 1am–2am ensures the nightly job has already closed out the 15th before the summary fires.

---

## 3. Firmware Configuration and Flash

### 3.1 Required Libraries (Arduino IDE)

| Library | Install via |
|---------|------------|
| Adafruit Fingerprint Sensor Library | Arduino Library Manager |
| RTClib (Adafruit) | Arduino Library Manager |
| ESP32 board support package | Board Manager — esp32 by Espressif |

### 3.2 Edit the Firmware Config Block

Open `firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino` in the Arduino IDE and update the `/* CONFIG */` section at the top:

| Constant | Value for this deployment |
|----------|--------------------------|
| `SCRIPT_URL` | The Web App URL from step 2.3 |
| `SCRIPT_AUTH` | Same value as `SCRIPT_AUTH_KEY` in the script. Leave `""` if disabled. |
| `BRANCH_ID` | `"EJURA-SYS"` |
| `BRANCH_NAME` | `"Ejura Water System"` |
| `R503_RX_PIN` / `R503_TX_PIN` | `16` / `17` (default — match your wiring) |

WiFi credentials are **not** set in the firmware. They are entered via the captive portal on first boot and stored in SPIFFS.

### 3.3 Format SPIFFS and Upload Filesystem

1. In the Arduino IDE, go to **Tools → ESP32 Sketch Data Upload** (install the plugin if missing).
2. If there is no `data/` folder in the sketch directory, create one — it can be empty. This ensures a clean SPIFFS partition.
3. Upload the filesystem image. This wipes any previous WiFi credentials or fid_map from the device.

> **WARNING:** Always format SPIFFS before flashing a device destined for a new deployment. Old credentials or fingerprint mappings from a previous use will cause unexpected behaviour.

### 3.4 Flash the Firmware

1. Select the correct board: **Tools → Board → ESP32 Dev Module** (or your specific variant).
2. Select the correct port under **Tools → Port**.
3. Click **Upload**. Wait for "Done uploading".
4. Open **Serial Monitor** at **115200 baud**. The boot sequence should end with:  
   `No WiFi credentials found — launching captive portal.`

---

## 4. First-Boot Verification

Work through this section with the device connected to a laptop via USB and Serial Monitor open at 115200 baud.

1. Power on the device. LED should pulse **purple**. Serial Monitor shows:  
   `No WiFi credentials found — launching captive portal.`

2. On your phone, connect to WiFi network **Attendance-Setup** (password: `setup1234`).

3. Navigate to `http://192.168.4.1`. The WiFi setup form should appear.

4. Enter the site WiFi SSID and password. Click **Save & Connect**.

5. Device restarts. LED should turn **solid blue**. Serial Monitor shows the IP address, `RTC synced from NTP`, `Found fingerprint sensor`, and `Tasks created; main loop will idle`.

6. If the LED stays **purple** after restart, the WiFi password was wrong or the network is out of range. Trigger the portal again: perform **10 no-match taps** (scan any finger not enrolled) within 30 seconds. The portal re-launches after the 10th tap.

> **TIP:** Take a photo of the Serial Monitor output during this step as a record that the device was working correctly at setup time.

---

## 5. Enrolling the Master Finger

The master finger is used by the site administrator to trigger the WiFi captive portal when credentials need to change. It never records attendance.

Add a row to the Enrollment sheet with the following values:

| Column | Value |
|--------|-------|
| FingerID | Leave blank |
| UniqueID | `MASTER-01` |
| Name | Admin Master (or the administrator's name) |
| Role | `master` |
| Position | Leave blank |
| Command | `register` |
| Status | Leave blank |
| Note | Leave blank |

1. Add the row to the Enrollment sheet. The device polls every 10 seconds.
2. Within 10 seconds, the LED turns **solid yellow**. Place the administrator's finger on the sensor within 20 seconds.
3. Lift when the LED goes off. Place the **same finger again** when the LED returns to yellow.
4. LED flashes **green** on success. The Status column updates to `registered` and FingerID is filled in.
5. **Verify:** scan the master finger. The LED should flash yellow 5 times and the captive portal should launch. Unplug and replug to exit without reconfiguring WiFi.

> **CRITICAL:** Do not assign `Role = "employee"` to the master finger. It would record attendance instead of launching the portal.

---

## 6. Enrolling Employee Fingerprints

Enrol all current employees before handover. The site administrator can add more later using the same process.

Add a row to the Enrollment sheet for each employee:

| Column | Value |
|--------|-------|
| FingerID | Leave blank |
| UniqueID | Employee ID number, e.g. `EMP-001`. Must be unique per person. |
| Name | Employee's full name |
| Role | `employee` |
| Position | Employee's job title, e.g. `Operator`, `Technician`, `Manager` |
| Command | `register` |
| Status | Leave blank |

1. Add the row. The device picks it up within 10 seconds; LED turns **yellow**.
2. The employee places their finger on the sensor and holds it still.
3. Lift when the LED goes off. Place the same finger again when yellow returns.
4. LED flashes **green**. Status updates to `registered`; FingerID is filled in.
5. Ask the employee to do a **test scan immediately**. A row should appear in the Attendance sheet within 30 seconds.
6. Repeat for each employee.

> **NOTE:** The device can store up to 127 fingerprint templates (slots 1–127). Slot assignment is automatic. A scan cooldown of 60 minutes is enforced per finger — a second scan within that window is silently ignored.

---

## 7. End-to-End Functional Test

Run all of these checks with the device fully set up and connected to the site WiFi.

| # | Test | Pass Condition |
|---|------|---------------|
| 1 | Attendance scan | Scan an enrolled finger. A row appears in the Attendance sheet (Time-In filled) within 30 seconds. |
| 2 | Duplicate block | Scan the same finger again within 60 seconds. No new row is added; no change to the existing row. |
| 3 | Time-Out update | Wait 60+ seconds and scan again. The existing row's Time-Out column is updated. |
| 4 | Late status | Scan an enrolled finger with a timestamp more than 30 minutes past 8:00 PM. Status reads `Late`. |
| 5 | Unrecognised finger | Scan an unenrolled finger. LED flashes red for ~0.6s; no sheet entry is created. |
| 6 | Master finger | Scan the master finger. LED flashes yellow 5 times; captive portal launches. Unplug to exit. |
| 7 | Portal fallback | Perform 10 no-match scans (unenrolled finger) within 30 seconds. Portal launches after the 10th. |
| 8 | Delete enrollment | Add a `delete` row in Enrollment for an employee (using their UniqueID). After 10s, Status → `deleted`. That finger no longer registers a scan. |
| 9 | Offline queue | Disable WiFi (or move device out of range), scan an enrolled finger, then restore WiFi. The queued scan appears in the sheet within 60 seconds of reconnection. |
| 10 | Nightly job (manual) | Run `runNightlyJob()` directly from the Apps Script editor (click Run). Employees with a Time-In but no Time-Out get `No Check-Out`; employees with no scan get an `Absent` row. |

---

## 8. Handover Checklist

Go through every item below before handover. Do not hand over a device with any unchecked items.

### Apps Script
- [ ] `BRANCHMAP_SPREADSHEET_ID` is correctly set to the BranchMap spreadsheet
- [ ] `SHIFT_START_HOUR`/`MIN` = 20/0 and `SHIFT_END_HOUR`/`MIN` = 23/0
- [ ] `LATE_GRACE_MINUTES` and `EARLY_GRACE_MINUTES` = 30
- [ ] Admin email addresses are added to `adminEmails` array
- [ ] Script is deployed as Web App (Anyone, Execute as Me)
- [ ] `SCRIPT_URL` has been confirmed live with a test GET request in a browser
- [ ] `runNightlyJob` trigger is set for **12am–1am** daily
- [ ] `sendMonthlySummary` trigger is set for the **16th of each month, 1am–2am**

### Firmware
- [ ] `SCRIPT_URL` in firmware matches the deployed Apps Script URL
- [ ] `BRANCH_ID` = `"EJURA-SYS"` and `BRANCH_NAME` = `"Ejura Water System"`
- [ ] `SCRIPT_AUTH` matches `SCRIPT_AUTH_KEY` in the Apps Script (or both are empty)
- [ ] SPIFFS was formatted clean before flashing
- [ ] Device boots without errors (confirmed via Serial Monitor)

### Device
- [ ] Connected to site WiFi — LED is **steady blue**
- [ ] RTC time is correct — visible as `RTC synced from NTP` in Serial Monitor on boot
- [ ] Master finger is enrolled and verified (portal launches on scan)
- [ ] All current employees have been enrolled
- [ ] Each enrolled employee has done a test scan (row appeared in Attendance sheet)
- [ ] Attendance sheet is visible, correctly formatted, and accessible to the administrator
- [ ] Monthly summary email sending has been tested (or `sendMonthlySummary` run manually and output checked)

### Handover
- [ ] Site administrator has the branch spreadsheet URL bookmarked or shared with them
- [ ] Administrator has been shown how to enrol a new employee
- [ ] Administrator has been shown how to remove an employee (delete command in Enrollment sheet)
- [ ] Administrator has been shown how to use the master finger to reconfigure WiFi
- [ ] Administrator has been given (or will receive) the Administrator Manual
- [ ] Your personal admin email address has been removed from `adminEmails`, or the site's address has been added

> **TIP:** Take a photo of the Serial Monitor output during the final boot as a record that the device was working correctly at handover.

---

*Ejura Water System — Attendance Device v1.1 | Confidential — Internal Use Only*
