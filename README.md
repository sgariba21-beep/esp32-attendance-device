# 🏫 ESP32 Fingerprint Attendance System

> Automated biometric attendance tracking for classrooms — built with an ESP32, R503 fingerprint sensor, Google Sheets backend, and weekly email summaries.

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

This system replaces manual paper-based attendance in classrooms with a fingerprint scanner mounted at the classroom door. Students and teachers scan their fingers when entering; the device records attendance in real time to a per-class Google Spreadsheet via a central Google Apps Script endpoint.

The system supports:
- **Students** — scans mark them "Present" for that date
- **Teachers** — scans clock in/out, matched against a timetable for late/absence detection
- **Masters** — a special admin fingerprint that triggers local enrollment mode

Enrollment is managed remotely via a Google Sheet "Enrollment" tab — no physical access to the device is needed to add or remove fingerprints.

---

## Features

- **Biometric identification** — R503 capacitive fingerprint sensor, up to 127 stored templates
- **Dual-core FreeRTOS architecture** — fingerprint scanning on Core 1, networking on Core 0, no blocking
- **Offline-first queue** — missed records stored to SPIFFS and flushed automatically on reconnection
- **RTC backup (DS3231)** — accurate timestamps survive WiFi outages and power cycles
- **NTP sync** — RTC auto-synced from internet time on every WiFi reconnect
- **Remote enrollment** — add/delete/clear fingerprints via Google Sheet without touching the device
- **Teacher timetable matching** — clock-ins/outs are matched to a timetable; out-of-window scans ignored
- **Scan cooldown** — configurable per-finger cooldown (default 60 min) prevents duplicate records
- **LED feedback** — R503 RGB LED signals state: blue (ready/online), purple (offline), green (success), red (failure), yellow (enrolling)
- **Weekly email summaries** — automated HTML email with absences, missed lessons, late starts, early endings, and XLSX attachments
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
│  SPIFFS ──── offline queue          │
│           └─ fid_map.csv            │
└──────────────┬──────────────────────┘
               │ HTTPS POST/GET
               ▼
┌─────────────────────────────────────┐
│   Google Apps Script (Web App)      │
│                                     │
│  doPost / doGet ── handleRequest    │
│  ├── attendance handler             │
│  │   ├── storeAttendance (students) │
│  │   └── storeTeacherAttendance     │
│  └── enrollment API                 │
│      ├── enroll_fetch               │
│      └── enroll_update              │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│         Google Sheets               │
│                                     │
│  ClassMap (central spreadsheet)     │
│  ├── Attendance — per class SS      │
│  │   ├── Attendance tab             │
│  │   ├── TeacherAttendance tab      │
│  │   ├── Timetable tab              │
│  │   └── Enrollment tab             │
│  └── Unmapped (error log)           │
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
| Enclosure | Custom FreeCAD design | See `Enclosure/` folder |
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
  - `SPIFFS` — local filesystem for offline queue and fid map

### Backend
- **Google Apps Script** — single web app endpoint routing attendance to per-class spreadsheets
- **Google Sheets** — per-class data storage (students, teachers, timetable, enrollment)
- **Google Drive** — auto-created class spreadsheets optionally organized into a folder

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/esp32-attendance-system.git
cd esp32-attendance-system
```

### 2. Deploy the Apps Script

1. Go to [script.google.com](https://script.google.com) and create a new project
2. Paste the contents of `backend/Class_Attendance_Apps_Script.js`
3. Set the `CLASSMAP_SPREADSHEET_ID` constant to your central Google Spreadsheet ID
4. Deploy as a **Web App**: Execute as "Me", access "Anyone"
5. Copy the deployment URL — this is your `SCRIPT_URL`

### 3. Flash the Firmware

1. Install [Arduino IDE](https://www.arduino.cc/en/software) with the ESP32 board package
2. Install required libraries via Library Manager:
   - `Adafruit Fingerprint Sensor Library`
   - `RTClib` by Adafruit
3. Open `firmware/ClassAttendance_Current_RTC.ino`
4. Fill in the [Configuration](#configuration) section
5. Select your ESP32 board and port, then upload

### 4. Set Up the ClassMap Spreadsheet

Create a Google Spreadsheet and add a sheet named `ClassMap` with these columns:

| classId | className | spreadsheetId | createdAt | active | notes |
|---------|-----------|--------------|-----------|--------|-------|

The system auto-creates class spreadsheets on first scan if `ALLOW_AUTO_CREATE = true`.

---

## Configuration

Edit the top of `ClassAttendance_Current_RTC.ino` before flashing:

```cpp
// WiFi
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// Apps Script endpoint (from step 2 of Getting Started)
const char* SCRIPT_URL = "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec";

// Optional auth key (must match SCRIPT_AUTH_KEY in Apps Script if set)
const char* SCRIPT_AUTH = "";

// Class identity — this device logs to this class
const char* CLASS_ID   = "2-SCI-2";     // must match classId in ClassMap sheet
const char* CLASS_NAME = "2 Science 2"; // human-readable

// Fingerprint ID ranges
const int STUDENT_FID_START = 1;
const int STUDENT_FID_END   = 40;
const int TEACHER_FID_START = 41;
const int TEACHER_FID_END   = 60;
const int MASTER_FID        = 99;  // triggers enrollment mode when scanned

// Cooldown between accepted scans (ms) — default 60 minutes
#define SCAN_COOLDOWN_MS 60000UL
```

---

## Enrollment Guide

Fingerprints are enrolled **remotely** via the Enrollment tab in each class's Google Spreadsheet. No physical access to the device is needed.

### Enrollment Sheet Columns

| FingerID | UniqueID | Name | Role | Command | Status | Note | CreatedAt |
|----------|----------|------|------|---------|--------|------|-----------|

### Steps to Enroll a Student

1. Open the class spreadsheet → **Enrollment** tab
2. Add a new row:
   - **FingerID:** leave blank (or specify a slot 1–40)
   - **UniqueID:** student ID (e.g. `STU001`)
   - **Name:** full name
   - **Role:** `student`
   - **Command:** `register`
   - **Status:** leave blank
3. The device polls every 10 seconds and picks up the job automatically
4. The device's LED turns **yellow** — place the finger twice when prompted
5. Status updates to `registered` in the sheet when done

### Role Values

| Role | FID Range | Description |
|------|-----------|-------------|
| `student` | 1–40 | Marks attendance |
| `teacher` | 41–60 | Clocks in/out, matched to timetable |
| `master` | 99 | Triggers local enrollment mode on the device |

### Commands

| Command | Description |
|---------|-------------|
| `register` | Enroll a new fingerprint |
| `delete` | Remove a fingerprint by FingerID or UniqueID |
| `clearall` | Wipe all templates from the sensor (use with caution) |

---

## Google Sheets Structure

### ClassMap Spreadsheet (central)
Tracks all class spreadsheet IDs. The Apps Script opens this to route incoming attendance.

### Per-Class Spreadsheet (auto-created)
Each class gets its own spreadsheet with four tabs:

**Attendance** — student records
```
StudentID | Name | Total | Attendance % | 2024-01-15 | 2024-01-16 | ...
STU001    | Ama  | 3     | 75%          | Present    |            | ...
```

**TeacherAttendance** — teacher clock-in/out records
```
Id    | Name | Subject | Scheduled Start | Scheduled End | Date       | Actual Start | Actual End
T001  | Mr K | Math    | 08:00           | 09:30         | 2024-01-15 | 08:05        | 09:28
```

**Timetable** — weekly schedule (used for teacher matching)
```
Day/Date | TeacherID | TeacherName | Subject | Start | End
Monday   | T001      | Mr K        | Math    | 08:00 | 09:30
```

**Enrollment** — remote enrollment queue (see [Enrollment Guide](#enrollment-guide))

---

## API Reference

The Apps Script web app accepts both POST (JSON body) and GET (URL parameters).

### Student Attendance
```json
POST /exec
{
  "type": "student",
  "classId": "2-SCI-2",
  "studentId": "STU001",
  "studentName": "Ama Owusu",
  "timestamp": "2024-01-15 08:05:00",
  "scanId": "scan-123456-STU001"
}
```

### Teacher Clock-In/Out
```json
POST /exec
{
  "type": "teacher",
  "classId": "2-SCI-2",
  "teacherId": "T001",
  "timestamp": "2024-01-15 08:05:00",
  "scanId": "scan-123456-T001"
}
```

### Enrollment Endpoints (GET)
```
GET /exec?api=enroll_fetch&classId=2-SCI-2
GET /exec?api=enroll_update&classId=2-SCI-2&row=3&status=registered&fingerId=5
GET /exec?api=enroll_list&classId=2-SCI-2
GET /exec?api=enroll_masters&classId=2-SCI-2
```

---

## File Structure

```
esp32-attendance-system/
├── firmware/
│   └── ClassAttendance_Current_RTC.ino   # ESP32 firmware
├── backend/
│   └── Class_Attendance_Apps_Script.js   # Google Apps Script
├── hardware/
│   ├── Attendance_System_v2.kicad_pro    # KiCad schematic project
│   └── Enclosure/
│       └── Fingerprint_Device_Enclosure.FCStd  # FreeCAD enclosure model
├── docs/
│   └── Technical_Documentation.docx     # Full technical documentation
└── README.md
```

---

## Known Limitations & Future Work

**Current Limitations:**
- WiFi credentials are hardcoded — a captive portal setup would be more deployable
- Each device is tied to one `CLASS_ID` — multi-class support would need runtime config
- No display (OLED/LCD) for visual feedback beyond the LED
- JSON parsing in firmware is done with naive string search (no JSON library) — brittle on unusual responses

**Planned Improvements (v2):**
- [ ] OLED display showing last scan name and time
- [ ] Web-based config portal (WiFiManager) for first-time setup
- [ ] OTA firmware update support
- [ ] Multi-class device mode via NFC tag switching
- [ ] Enclosure revision with better cable management
- [ ] Admin mobile app for real-time dashboard

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

*Built by [Your Name] — Kumasi, Ghana 🇬🇭*
