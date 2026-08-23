# Staff Manual
:kicker: Role Guide
:subtitle: Viewing attendance and roster records for your unit
:audience: Teachers, supervisors, and staff
:version: Version 2.0  |  August 2026
:footer: ESP32 Fingerprint Attendance System

<<<TOC>>>

## 1. Introduction

This manual is for teachers, supervisors, and staff who use the dashboard. Your account gives you **read-only** access to attendance and roster records for your assigned unit -- your class, section, team, or department.

**You can:**

- View attendance for your unit
- View the roster for your unit
- Export attendance to a CSV file
- Change your own password

**You cannot** see other units, add or edit people, manage devices, or change any settings.

## 2. Logging in

Open the dashboard URL, enter your email and password, and press **Sign in**.

If you cannot log in, contact your administrator. Accounts are created by an admin or super admin -- there is no self-registration.

## 3. Viewing attendance

Press **Attendance** in the sidebar, or in the bottom bar on a phone.

You will see the records for your unit. The table shows:

- Date of the scan
- Name and ID number
- Scan type -- Present, Absent, Time-In, or Time-Out
- Time of the scan
- Period or term

Time-in and time-out for the same person on the same day appear on one row.

### 3.1 Filtering

| Filter | How to use it |
| --- | --- |
| **Date range** | Pick a start and end date to show only that stretch. |
| **Period** | Pick a term to show only records from it. |
| **Member** | Type a name to narrow to one person. |
| **Scan type** | Show only Present, Absent, Time-In, or Time-Out. |

## 4. Viewing the roster

Press **Members** to see everyone in your unit, with their name, ID number, group, and unit. You can search by name.

You cannot edit anybody's details. If a record is wrong, tell your admin.

## 5. Exporting

1. Go to **Attendance**.
2. Apply any filters you want -- a date range, a period.
3. Press **Export CSV**.
4. The file downloads and opens in Excel or Google Sheets.

The export covers your unit only. For data from another unit, ask an admin or super admin.

> [!NOTE] Absences are generated automatically overnight for anyone active who did not scan, skipping holidays and weekends where that is configured. Nobody marks absences by hand. If a device was offline, its scans upload later and correct the record.

## 6. Changing your password

**Accounts -> find your own account -> press the key icon -> enter the new password -> Save.**

If you have forgotten your password and cannot log in, contact your administrator.

## 7. Getting help

If something looks wrong, or attendance records are incorrect, contact your institution's admin or super admin.

For a scanner that is not behaving, tell your admin what the screen and light are showing -- that is usually enough for them to identify it immediately.

| Screen shows | What it means |
| --- | --- |
| Clock and device name | Normal, waiting for a scan |
| A name, then Present / Time In / Time Out | Scan recognised and recorded |
| A name and "Offline" | Recognised, but no internet. Saved, and uploads itself later. |
| "COOLDOWN" and a name | Same person scanned again within a minute. Normal. |
| "NO MATCH" | Finger not recognised. Ask them to try again. |
| A "queued" count under the clock | That many scans are waiting for the internet to return |
| "OTA UPDATE" / "Do not unplug" | Installing an update. Leave it powered on. |

| Light | Meaning |
| --- | --- |
| Solid blue | Ready, online |
| Solid purple | Ready, but no WiFi |
| Green flash | Scan accepted |
| Red flash | Not recognised |
| Breathing yellow | Waiting to be assigned by an admin |
| Breathing red | Installing an update -- do not unplug |

> [!TIP] A scanner that has lost WiFi still works. It stores scans and uploads them when the connection returns, so an outage never costs you a day's register.
