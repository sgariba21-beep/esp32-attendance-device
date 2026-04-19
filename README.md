# 🏫 ESP32 Staff Attendance System

> Automated biometric attendance tracking for school staff — built with an ESP32, R503 fingerprint sensor, Google Sheets backend, and monthly email summaries.

![ESP32](https://img.shields.io/badge/ESP32-Dual--Core-blue?logo=espressif)
![Platform](https://img.shields.io/badge/Platform-Arduino%2FIDF-orange)
![Backend](https://img.shields.io/badge/Backend-Google%20Apps%20Script-green?logo=google)

---

## 📋 Table of Contents

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

This system replaces manual paper-based attendance with a fingerprint scanner mounted at the school entrance. Staff scan their fingers when arriving and leaving; the device records attendance in real time to a single Google Spreadsheet via a Google Apps Script endpoint.

The system supports:
- **Staff** — scans record Time-In on first scan and update Time-Out on each subsequent scan of the day
- **Masters** — a special admin fingerprint that launches the WiFi captive portal for network reconfiguration

Enrollment is managed remotely via a Google Sheet "Enrollment" tab — no physical access to the device is needed to add or remove fingerprints.

---

## Features

- **Biometric identification** — R503 capacitive fingerprint sensor, up to 127 stored templates
- **Dual-core FreeRTOS architecture** — fingerprint scanning on Core 1, networking on Core 0, no blocking
- **Offline-first queue** — missed records stored to SPIFFS and flushed automatically on reconnection
- **RTC backup (DS3231)** — accurate timestamps survive WiFi outages and power cycles
- **NTP sync** — RTC auto-synced from internet time on every WiFi reconnect
- **Remote enrollment** — add/delete/clear fingerprints via Google Sheet without touching the device
- **Scan cooldown** — configurable per-finger cooldown (default 60 s) prevents duplicate records within the window
- **LED feedback** — R503 RGB LED signals state: blue (ready/online), purple (offline), green (success), red (failure), yellow (enrolling)
- **Monthly email summaries** — automated HTML email covering the previous calendar month, with absences, late arrivals, early departures, and missing check-outs; includes an XLSX attachment
- **Deduplication** — scanId-based deduplication at the Apps Script layer prevents double entries
- **Captive portal** — WiFi credentials entered via a browser-based setup page on first boot; re-launched by the master fingerprint when credentials need to change

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
│  SPIFFS ──── offline queue          │
│           └─ fid_map.csv            │
└──────────────┬──────────────────────┘
               │ HTTPS POST/GET
               ▼
┌─────────────────────────────────────┐
│   Google Apps Script (Web App)      │
│                                     │
│  doPost / doGet ── handleRequest    │
│  ├── storeStaffAttendance           │
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
│  School Spreadsheet                 │
│  ├── Attendance tab                 │
│  ├── Enrollment tab                 │
│  ├── Monthly Summary tab (auto)     │
│  └── Archive - <Month> tabs (auto)  │
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
| Enclosure | Custom FreeCAD design | See `hardware/Enclosure/` folder |
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
  - `SPIFFS` — local filesystem for offline queue and fid map

### Backend
- **Google Apps Script** — single web app endpoint handling all attendance and enrollment requests
- **Google Sheets** — single school spreadsheet (Attendance + Enrollment tabs)

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/sgariba21-beep/esp32-attendance-device.git
cd esp32-attendance-device
```

### 2. Set Up the School Spreadsheet

Create a Google Spreadsheet in the Google account that will own the Apps Script. Copy its Spreadsheet ID from the URL bar (the long string between `/d/` and `/edit`).

> The Attendance and Enrollment tabs are created automatically by the Apps Script — you do not need to add them manually.

### 3. Deploy the Apps Script

1. In the spreadsheet, click **Extensions → Apps Script**
2. Delete any existing code and paste the contents of `backend/Staff_Attendance_Apps_Script.js`
3. Set `SCHOOL_SPREADSHEET_ID` to the spreadsheet ID from step 2
4. Set `SCHOOL_NAME` to your school name
5. Set `SHIFT_START_HOUR`/`SHIFT_START_MIN` and `SHIFT_END_HOUR`/`SHIFT_END_MIN` to match your school day
6. Add admin email addresses to the `adminEmails` array
7. Deploy as a **Web App**: Execute as "Me", access "Anyone"
8. Copy the deployment URL — this is your `SCRIPT_URL`

### 4. Set Up Time-Driven Triggers

In the Apps Script editor, click the clock icon (Triggers) and add two triggers:

| Function | Type | Schedule |
|---|---|---|
| `runNightlyJob` | Day timer | 10pm–11pm (after school day ends) |
| `sendMonthlySummary` | Month timer | 1st of month, 1am–2am |

### 5. Flash the Firmware

1. Install [Arduino IDE](https://www.arduino.cc/en/software) with the ESP32 board package
2. Install required libraries via Library Manager:
   - `Adafruit Fingerprint Sensor Library`
   - `RTClib` by Adafruit
3. Open `firmware/StaffAttendance_School.ino`
4. Fill in `SCRIPT_URL` and `SCHOOL_ID` / `SCHOOL_NAME` in the [Configuration](#configuration) section
5. Format SPIFFS (Tools → ESP32 Sketch Data Upload with an empty `data/` folder) to start clean
6. Select your ESP32 board and port, then upload

### 6. First Boot

On first boot with no saved WiFi credentials, the device launches its captive portal automatically:
1. The sensor LED pulses purple
2. Connect your phone/laptop to the `Attendance-Setup` WiFi network (password: `setup1234`)
3. Open a browser to `http://192.168.4.1` and enter your school WiFi credentials
4. Click **Save & Connect** — the device restarts and the LED turns steady blue

---

## Configuration

Edit the top of `StaffAttendance_School.ino` before flashing:

```cpp
// Apps Script endpoint (from step 3 of Getting Started)
const char* SCRIPT_URL = "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec";

// Optional auth key (must match SCRIPT_AUTH_KEY in Apps Script if set)
const char* SCRIPT_AUTH = "";

// School identity — sent with every attendance payload
const char* SCHOOL_ID   = "DDA";             // short unique identifier
const char* SCHOOL_NAME = "D and D Academy"; // human-readable name used in logs

// Fingerprint sensor UART pins — adjust to match your wiring
#define R503_RX_PIN 16
#define R503_TX_PIN 17

// Cooldown between accepted scans per finger (ms) — default 60 seconds
#define SCAN_COOLDOWN_MS 60000UL
```

> **Note:** WiFi credentials are NOT hardcoded in the firmware. They are entered via the captive portal on first boot and stored in SPIFFS.

In the Apps Script, configure the matching constants:

```javascript
const SCHOOL_SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
const SCHOOL_NAME           = 'D and D Academy';
const SHIFT_START_HOUR = 7;   const SHIFT_START_MIN = 30;  // 07:30
const SHIFT_END_HOUR   = 15;  const SHIFT_END_MIN   = 30;  // 15:30
const LATE_GRACE_MINUTES  = 10;
const EARLY_GRACE_MINUTES = 10;
```

---

## Enrollment Guide

Fingerprints are enrolled **remotely** via the Enrollment tab in the school spreadsheet. No physical access to the device is needed.

### Enrollment Sheet Columns

| FingerID | UniqueID | Name | Role | Command | Status | Note | CreatedAt |
|----------|----------|------|------|---------|--------|------|-----------|

### Steps to Enroll a Staff Member

1. Open the school spreadsheet → **Enrollment** tab
2. Add a new row:
   - **FingerID:** leave blank (auto-assigned)
   - **UniqueID:** staff ID (e.g. `EMP-001`)
   - **Name:** full name
   - **Role:** `staff`
   - **Command:** `register`
   - **Status:** leave blank
3. The device polls every 10 seconds and picks up the job automatically
4. The device's LED turns **yellow** — place the finger twice when prompted
5. Status updates to `registered` in the sheet when done

### Role Values

| Role | Description |
|------|-------------|
| `staff` | Records Time-In / Time-Out attendance |
| `master` | Launches the WiFi captive portal; never records attendance |

### Commands

| Command | Description |
|---------|-------------|
| `register` | Enroll a new fingerprint |
| `delete` | Remove a fingerprint by FingerID or UniqueID |
| `clearall` | Wipe all templates from the sensor (use with caution) |

---

## Google Sheets Structure

### School Spreadsheet

**Attendance** — staff records
```
Date       | Staff Name | Staff ID | Time-In | Time-Out | Status
2024-01-15 | Ama Owusu  | EMP-001  | 07:28   | 15:45    | On-Time
```

> Column 7 (hidden) stores the `scanId` used for server-side deduplication. Do not delete or edit it.

**Enrollment** — remote enrollment queue (see [Enrollment Guide](#enrollment-guide))

**Monthly Summary** *(auto-created)* — per-staff aggregated counts for the reported month

**Archive - Month Year** *(auto-created)* — archived copy of Attendance rows after the monthly report runs

---

## API Reference

The Apps Script web app accepts both POST (JSON body) and GET (URL parameters).

### Staff Attendance Scan
```json
POST /exec
{
  "staffId": "EMP-001",
  "staffName": "Ama Owusu",
  "timestamp": "2024-01-15 07:28:00",
  "scanId": "scan-123456-EMP-001"
}
```

### Enrollment Endpoints (GET)
```
GET /exec?api=enroll_fetch
GET /exec?api=enroll_update&row=3&status=registered&fingerId=5
GET /exec?api=enroll_list
GET /exec?api=enroll_masters
```

All enrollment endpoints accept an optional `&auth=<key>` parameter if `SCRIPT_AUTH_KEY` is configured.

---

## File Structure

```
esp32-attendance-device/
├── firmware/
│   └── StaffAttendance_School.ino        # ESP32 firmware
├── backend/
│   └── Staff_Attendance_Apps_Script.js   # Google Apps Script
├── hardware/
│   ├── Attendance_System_v2.kicad_pro    # KiCad schematic project
│   └── Enclosure/
│       └── Fingerprint_Device_Enclosure.FCStd  # FreeCAD enclosure model
├── docs/
│   ├── Attendance_Admin_Manual_v2_1.pdf  # Administrator operations manual
│   └── Pre_Handover_Setup_Guide_v1_2.pdf # Technician setup reference
└── README.md
```

---

## Known Limitations & Future Work

**Current Limitations:**
- No display (OLED/LCD) for visual feedback beyond the LED
- JSON parsing in firmware uses naive string search (no JSON library) — brittle on unusual responses
- SCHOOL_ID / SCHOOL_NAME are compile-time constants — changing them requires a reflash

**Planned Improvements (v2):**
- [ ] OLED display showing last scan name and time
- [ ] OTA firmware update support
- [ ] Multi-school device mode via runtime configuration
- [ ] Enclosure revision with better cable management
- [ ] Admin mobile app for real-time dashboard

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

*Built by Samuel Kwaku Gyamfi Gariba — Kumasi, Ghana 🇬🇭*
