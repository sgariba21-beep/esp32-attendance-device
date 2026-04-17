# ESP32 Fingerprint Attendance System

> Automated biometric attendance tracking for workplace sites — built with an ESP32, R503 fingerprint sensor, DS3231 RTC, Google Sheets backend, and monthly email summaries.

![ESP32](https://img.shields.io/badge/ESP32-Dual--Core-blue?logo=espressif)
![Platform](https://img.shields.io/badge/Platform-Arduino%2FIDF-orange)
![Backend](https://img.shields.io/badge/Backend-Google%20Apps%20Script-green?logo=google)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [System Architecture](#system-architecture)
- [Hardware](#hardware)
- [Software Stack](#software-stack)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Enrollment Guide](#enrollment-guide)
- [Google Sheets Structure](#google-sheets-structure)
- [API Reference](#api-reference)
- [File Structure](#file-structure)
- [Known Limitations & Future Work](#known-limitations--future-work)

---

## Overview

This system replaces manual paper-based attendance at workplace sites with a fingerprint scanner. Employees scan their fingers on arrival and departure; the device records Time-In and Time-Out in real time to a per-branch Google Spreadsheet via a central Google Apps Script endpoint.

The system supports two fingerprint roles:
- **Employees** — scans record Time-In on the first daily scan, then update Time-Out on each subsequent scan
- **Masters** — a special admin fingerprint that triggers the WiFi captive portal for credential reconfiguration; never records attendance

Enrollment is managed remotely via a Google Sheet "Enrollment" tab — no physical access to the device is needed after initial setup.

---

## Features

- **Biometric identification** — R503 capacitive fingerprint sensor, up to 127 stored templates
- **Dual-core FreeRTOS architecture** — fingerprint scanning on Core 1, networking on Core 0, fully non-blocking
- **Offline-first queue** — missed records stored to SPIFFS and flushed automatically on reconnection; queue is capped by age (7 days), entry count (1 000 entries on SPIFFS), and byte size (256 KB) to prevent flash exhaustion
- **RTC backup (DS3231)** — accurate timestamps survive WiFi outages and power cycles
- **NTP sync** — RTC auto-synced from internet time on every WiFi reconnect
- **Remote enrollment** — add, delete, or clear fingerprints via the Google Sheet Enrollment tab without touching the device
- **Shift-aware status** — Time-In/Time-Out compared to configured shift start/end; records marked On-Time, Late, Left-Early, or No Check-Out automatically
- **Scan cooldown** — configurable per-finger cooldown (default 60 min) prevents duplicate records
- **LED feedback** — R503 RGB LED signals state: blue (ready/online), purple (offline), green (success), red (failure), yellow (enrolling or master scan)
- **Captive portal** — on first boot or master finger scan, device broadcasts a setup AP for WiFi credential entry; credentials stored securely in SPIFFS
- **Pay-period email summaries** — automated HTML report with per-employee attendance stats and an XLSX export sent to configured admin addresses on the 16th of each month, covering the period from the 16th of the previous month through the 15th of the current month
- **Nightly job** — marks No Check-Out and inserts Absent rows for registered employees who did not scan that day
- **Automatic sheet trimming** — attendance entries older than the start of the current pay period are deleted from the live sheet each cycle; the monthly XLSX export serves as the permanent backup
- **Deduplication** — scanId-based deduplication at the Apps Script layer prevents double entries

---

## System Architecture

```
┌─────────────────────────────────────┐
│             ESP32 Device            │
│                                     │
│  Core 1 ──── FingerprintTask        │
│  Core 0 ──── NetworkTask            │
│           └─ EnrollmentTask         │
│                                     │
│  R503 ◄──► UART2 (pins 16/17)      │
│  DS3231 ◄──► I2C (pins 21/22)      │
│  SPIFFS ──── /queue.txt             │
│           └─ /fid_map.csv           │
│           └─ /wifi_creds.json       │
└──────────────┬──────────────────────┘
               │ HTTPS POST/GET
               ▼
┌─────────────────────────────────────┐
│   Google Apps Script (Web App)      │
│                                     │
│  doPost / doGet ── handleRequest    │
│  ├── storeEmployeeAttendance        │
│  └── enrollment API                 │
│      ├── enroll_fetch               │
│      ├── enroll_update              │
│      ├── enroll_list                │
│      └── enroll_masters             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│         Google Sheets               │
│                                     │
│  BranchMap (central spreadsheet)   │
│  └── Per-branch spreadsheet        │
│      ├── Attendance tab             │
│      ├── Enrollment tab             │
│      └── Monthly Summary tab        │
└─────────────────────────────────────┘
```

---

## Hardware

### Bill of Materials

| Component | Specification | Notes |
|-----------|--------------|-------|
| Microcontroller | ESP32 (dual-core, 240 MHz) | Any ESP32 devkit works |
| Fingerprint Sensor | R503 Capacitive | UART, 57600 baud |
| RTC Module | DS3231 | I2C, CR2032 backup battery |
| Enclosure | Custom FreeCAD design | See `hardware/CAD files/` |
| Power Supply | 5V USB or regulated supply | |

### Wiring

| Signal | ESP32 Pin |
|--------|-----------|
| R503 TX → ESP32 RX | GPIO 16 |
| R503 RX → ESP32 TX | GPIO 17 |
| DS3231 SDA | GPIO 21 |
| DS3231 SCL | GPIO 22 |
| R503 Power | 3.3V |
| DS3231 Power | 3.3V |
| GND | GND |

> **Note:** The R503 finger detect and wakeup wires are not used in this firmware. Power and UART are sufficient.

---

## Software Stack

### Firmware (ESP32)
- **Framework:** Arduino (ESP32 Arduino Core)
- **RTOS:** FreeRTOS (3 pinned tasks)
- **Libraries:**
  - `Adafruit_Fingerprint` — R503 sensor driver
  - `RTClib` — DS3231 RTC driver
  - `WiFi`, `HTTPClient`, `WiFiClientSecure` — networking
  - `WebServer`, `DNSServer` — captive portal
  - `SPIFFS` — local filesystem for offline queue, fid map, and WiFi credentials

### Backend
- **Google Apps Script** — single web app endpoint routing attendance to per-branch spreadsheets
- **Google Sheets** — per-branch data storage (attendance, enrollment, monthly archive)
- **Google Drive** — auto-created branch spreadsheets optionally organized into a folder

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/esp32-attendance-device.git
cd esp32-attendance-device
```

### 2. Set Up the BranchMap Spreadsheet

1. Create a new blank Google Spreadsheet in the Google account that will run the Apps Script
2. Copy the Spreadsheet ID from the URL (the string between `/d/` and `/edit`)
3. This is your `BRANCHMAP_SPREADSHEET_ID` — paste it into the Apps Script config
4. The script auto-creates the `BranchMap` sheet on first use; each branch gets its own spreadsheet auto-created on first scan

### 3. Deploy the Apps Script

1. Open the Google Sheet → **Extensions → Apps Script**
2. Paste the contents of `backend/Class_Attendance_Apps_Script.js`
3. Set the constants at the top of the script:
   - `BRANCHMAP_SPREADSHEET_ID` — the ID from step 2
   - `adminEmails` — addresses to receive monthly reports
   - `SHIFT_START_HOUR` / `SHIFT_END_HOUR` — site shift times
   - `LATE_GRACE_MINUTES` / `EARLY_GRACE_MINUTES` — tolerance before marking Late/Left-Early
   - `SCRIPT_AUTH_KEY` — set a secret string here and match it in the firmware (recommended)
4. Click **Deploy → New deployment**, type: Web app, Execute as: Me, Access: Anyone
5. Authorise the script when prompted
6. Copy the deployment URL ending in `/exec` — this is your `SCRIPT_URL`
7. Set up two time-driven triggers (**Triggers** sidebar):
   - `runNightlyJob` — Day timer, 12am–1am
   - `sendMonthlySummary` — Month timer, 16th of month, 1am–2am

> **Important:** Every time you edit the script, create a **New deployment** — re-deploying an existing version will not update the live app. Update `SCRIPT_URL` in the firmware and re-flash after each new deployment.

### 4. Flash the Firmware

1. Install [Arduino IDE](https://www.arduino.cc/en/software) with the ESP32 board package
2. Install required libraries via Library Manager:
   - `Adafruit Fingerprint Sensor Library`
   - `RTClib` by Adafruit
3. Open `firmware/ClassAttendance_Current_RTC/ClassAttendance_Current_RTC.ino`
4. Fill in the [Configuration](#configuration) section at the top of the file
5. Select your ESP32 board and port, then upload

### 5. First-Boot WiFi Setup

On first boot (or after a SPIFFS format), the device has no stored credentials and broadcasts a setup AP:

- **SSID:** `Attendance-Setup`  
- **Password:** `setup1234`

Connect from any phone or laptop, navigate to `http://192.168.4.1`, enter the site WiFi name and password, and click **Save & Connect**. The device restarts and connects automatically. The master finger (see [Enrollment Guide](#enrollment-guide)) can trigger this portal again at any time.

---

## Configuration

Edit the `/* CONFIG */` block at the top of `ClassAttendance_Current_RTC.ino` before flashing:

```cpp
// Apps Script endpoint — get this from your web app deployment
const char* SCRIPT_URL = "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec";

// Must match SCRIPT_AUTH_KEY in the Apps Script (leave "" if auth is disabled)
const char* SCRIPT_AUTH = "";

// Branch identity — BRANCH_ID must match the branchId column in your BranchMap sheet
const char* BRANCH_ID   = "BRANCH-001";
const char* BRANCH_NAME = "Site Name";

// Fingerprint sensor UART pins (match your wiring)
#define R503_RX_PIN 16
#define R503_TX_PIN 17

// Minimum time between accepted scans per finger (default: 60 minutes)
#define SCAN_COOLDOWN_MS 60000UL
```

WiFi credentials are **not** hardcoded — they are entered via the captive portal on first boot and stored in SPIFFS.

---

## Enrollment Guide

Fingerprints are enrolled **remotely** via the Enrollment tab in each branch's Google Spreadsheet. No physical access to the device is needed after initial setup.

### Enrollment Sheet Columns

| FingerID | UniqueID | Name | Role | Position | Command | Status | Note | CreatedAt |
|----------|----------|------|------|----------|---------|--------|------|-----------|

> The Enrollment tab is created automatically by the Apps Script on the device's first enrollment poll — you do not need to create it manually.

### Steps to Enroll an Employee

1. Open the branch spreadsheet → **Enrollment** tab
2. Add a new row:
   - **FingerID:** leave blank (device assigns the next available slot 1–127)
   - **UniqueID:** employee ID (e.g. `EMP001`) — must be unique per person
   - **Name:** full name
   - **Role:** `employee`
   - **Position:** job title (e.g. `Manager`, `Engineer`, `Technician`)
   - **Command:** `register`
   - **Status:** leave blank
3. The device polls every 10 seconds and picks up the job automatically
4. The LED turns **yellow** — place the employee's finger on the sensor within 20 seconds
5. Lift when the LED goes off, then place the same finger again when yellow returns
6. LED flashes **green** on success; Status updates to `registered` and FingerID is filled in

### Role Values

| Role | Description |
|------|-------------|
| `employee` | Records Time-In on first daily scan, Time-Out on subsequent scans |
| `master` | Triggers the WiFi captive portal on scan — does not record attendance |

### Commands

| Command | Description |
|---------|-------------|
| `register` | Enroll a new fingerprint |
| `delete` | Remove a fingerprint by FingerID or UniqueID |
| `clearall` | Wipe all templates from the sensor — use with caution |

---

## Google Sheets Structure

### BranchMap Spreadsheet (central)
One central spreadsheet tracks all branch spreadsheet IDs. The Apps Script uses this to route incoming attendance records to the correct branch.

| branchId | branchName | spreadsheetId | createdAt | active | notes |
|----------|------------|---------------|-----------|--------|-------|

Set `active` to `N` to stop routing records for a branch without deleting the row.

### Per-Branch Spreadsheet (auto-created on first scan)

**Attendance tab** — one row per employee per day

| Date | Employee Name | Staff ID | Position | Time-In | Time-Out | Status |
|------|--------------|----------|----------|---------|---------|--------|
| 2025-04-17 | John Mensah | EMP001 | Engineer | 20:05 | 22:58 | On-Time |
| 2025-04-17 | Ama Owusu | EMP002 | Technician | 20:45 | No Check-Out | Late \| No Check-Out |

- First scan of the day → fills Time-In and Position, sets Status
- Subsequent scans → updates Time-Out and recomputes Status
- Nightly job → fills blank Time-Out with "No Check-Out", inserts Absent rows for no-shows
- Pay-period job (16th of month) → deletes entries older than the current pay period start; remaining data is clean and current

**Enrollment tab** — remote enrollment command queue (auto-created by Apps Script)

**Monthly Summary tab** — regenerated on each pay-period report run; one row per employee with aggregated attendance stats

---

## API Reference

The Apps Script web app accepts both POST (JSON body) and GET (URL parameters).

### Employee Attendance

```json
POST /exec
{
  "type": "employee",
  "branchId": "BRANCH-001",
  "branchName": "Site Name",
  "employeeId": "EMP001",
  "employeeName": "John Mensah",
  "employeePosition": "Engineer",
  "timestamp": "2025-04-17 20:05:00",
  "scanId": "scan-123456789-EMP001"
}
```

The firmware also falls back to a GET request if POST returns 400/404:

```
GET /exec?branchId=BRANCH-001&branchName=Site+Name&employeeId=EMP001&date=2025-04-17&ts=20:05:00
```

### Enrollment Endpoints

All enrollment endpoints use GET. If `SCRIPT_AUTH_KEY` is set, append `&auth=YOUR_KEY`.

```
GET /exec?api=enroll_fetch&branchId=BRANCH-001
GET /exec?api=enroll_update&branchId=BRANCH-001&row=3&status=registered&fingerId=5
GET /exec?api=enroll_list&branchId=BRANCH-001
GET /exec?api=enroll_masters&branchId=BRANCH-001
```

---

## File Structure

```
esp32-attendance-device/
├── firmware/
│   └── ClassAttendance_Current_RTC/
│       └── ClassAttendance_Current_RTC.ino   # ESP32 firmware (single file)
├── backend/
│   └── Class_Attendance_Apps_Script.js        # Google Apps Script backend
├── hardware/
│   ├── CAD files/                             # FreeCAD enclosure model
│   └── PCBs/                                  # PCB design files
├── docs/
│   ├── Attendance_System_Admin_Manual_v2.pdf
│   ├── ESP32_Attendance_Technical_Documentation.docx
│   └── Pre_Handover_Setup_Guide.md            # Technician setup checklist
└── README.md
```

---

## Known Limitations & Future Work

**Current Limitations:**
- TLS certificate validation is disabled (`setInsecure()`) on all HTTPS requests — vulnerable to MITM on untrusted networks; Google CA pinning not yet implemented
- JSON parsing in firmware uses naive `indexOf` string search — brittle if server responses contain field names as substrings of values
- `BRANCH_ID` and `BRANCH_NAME` are hardcoded at compile time — changing them requires re-flashing
- Each device is bound to one branch — multi-branch support would require runtime configuration
- No display (OLED/LCD) for on-screen feedback beyond the LED
- AP password for the captive portal (`setup1234`) is a universal default

**Planned Improvements:**
- [ ] TLS certificate pinning for Google's root CA
- [ ] OLED display showing last scan name and timestamp
- [ ] OTA firmware update support
- [ ] Store `BRANCH_ID` / `BRANCH_NAME` in SPIFFS, configurable via captive portal
- [ ] Replace `indexOf` JSON parsing with ArduinoJSON library
- [ ] Per-device unique AP password derived from MAC address
- [ ] Enclosure revision with better cable management

---

*Built by Samuel Gariba — Ghana*
