# Office Manual
:kicker: Institution Type Guide
:subtitle: Running a company, clinic, church, or organisation on the attendance system
:audience: Office administrators and HR staff
:version: Version 2.0  |  August 2026
:footer: ESP32 Fingerprint Attendance System

<<<TOC>>>

## 1. What an office account looks like

An office account tracks the people who work for you by fingerprint. It is the general-purpose type -- use it for a company, clinic, NGO, church, factory, or any organisation that needs a reliable record of who was present.

Your sidebar has:

- **Attendance** -- all scan records, filterable and exportable
- **Members** and / or **Staff** -- your people
- **Periods & Holidays** -- reporting periods and non-working days
- **Devices**, **Enrollment**, **Accounts**, **Settings**

An office account has no academic terms and no year-end promotion -- those are school-only. Everything else works the same way.

### 1.1 Two ways to record a day

Set this under **Settings -> Scan mode**. It is the single most important choice you make at setup.

| Mode | How it works | Use it when |
| --- | --- | --- |
| **Present / absent** | One scan marks the person present for the day. | You only need to know who showed up. |
| **Time in / time out** | First scan is arrival, second is departure. Both appear on one row. | You need hours, lateness, or early departures. |

You can set this separately for members and for staff.

> [!TIP] Start with **Present / absent** unless you have a concrete reason to track hours. It is far less disruptive at the door, and you can switch later.

## 2. Setting up, in the right order

1. **Settings** -- name, logo, timezone, scan mode, and **Days tracked** (untick Sat and Sun if you are a Monday-to-Friday operation).
2. **Periods & Holidays** -- create your current reporting period and add your public holidays.
3. **Devices** -- assign each scanner to the department and location it sits in.
4. **Members / Staff** -- add your people, or import them from a spreadsheet.
5. **Enrollment** -- enrol each person's fingerprint.
6. **Accounts** -- create logins for HR, department heads, and supervisors.

> [!WARNING] Decide your scan mode before you enrol anyone. Switching from present/absent to time in/out partway through a period leaves you with two different shapes of record in the same report.

## 3. Terminology you can change

The defaults are Member, Group, and Unit. Most offices rename them under **Settings -> Custom labels**:

| Default | An office usually calls it |
| --- | --- |
| Member / Members | Employee / Employees, or Staff |
| Group | Department or Division |
| Unit | Team, Branch, or Site |
| Period | Quarter, Month, or Year |

Renaming is cosmetic -- it changes wording throughout the dashboard and in CSV export headings, and nothing about the data. Adjust it whenever you like.

### 3.1 Members, staff, or both

Two rosters are available and you control which appear:

- Most offices use **one** roster for everybody. Turn on **Track staff** only.
- Use both when you have two genuinely different populations -- for example a clinic tracking employees on one roster and volunteers on the other, with different scan modes.

If you only track staff, the Members section disappears and attendance columns label themselves accordingly.

## 4. Periods and holidays

### 4.1 Periods

Go to **Periods & Holidays** and create a period with its name, year, and start and end dates. Mark the current one **Active**.

A period is simply a reporting bucket -- a quarter, a month, or a full year, whatever matches how you report. Keep exactly one active at a time. Attendance is tied to whichever period was active when the scan happened.

### 4.2 Holidays

Add every non-working day: public holidays, company shutdowns, stocktaking days. Nobody is marked absent on those dates.

Tick **Recurring** for holidays on the same calendar date each year. Leave it unticked for dates that move.

The **Days tracked** selector in Settings handles Saturday and Sunday for you -- untick the days you are closed rather than adding them as holidays one by one.

## 5. Your people

### 5.1 Adding one person

Go to **Staff** (or **Members**), press **Add**, and fill in the ID number, full name, group, and unit.

### 5.2 Importing a spreadsheet

Press **Import CSV**.

1. Download the template.
2. Fill in one row per person -- ID, full name, and unit.
3. Upload it and review the preview. It flags any row with a missing field or an unrecognised unit before anything is created.
4. Confirm.

**Imported people start Inactive** because they have no fingerprint yet. Enrol each one, then set them Active. Only active people are included in the nightly absence run.

### 5.3 Leavers

Set someone **Inactive** rather than deleting them. Their history is preserved and they stop generating absences from that day. Deleting removes their records permanently and cannot be undone.

> [!NOTE] Deactivate a leaver on their last day. If you forget, they accumulate absences that distort your reports until you notice.

## 6. Scoped accounts for supervisors

A **teacher / staff** account is read-only and limited to one unit. In an office this is your department head or shift supervisor: they can see and export their own team's attendance and nothing else.

Assign the account to a unit when you create it under **Accounts**. That assignment is what scopes their view, including their CSV exports.

## 7. Getting data out

Go to **Attendance**, apply your filters -- date range, period, unit, person, scan type -- and press **Export CSV**. The file opens in Excel or Google Sheets.

This is how attendance feeds payroll. Filter to the pay period and the department, export, and hand it over.

In time in / time out mode, both times for a person on a given day appear on the same row, which is what makes hours easy to compute in the spreadsheet.

## 8. Everyday problems

| Problem | What to do |
| --- | --- |
| Everyone marked absent on a working day | A holiday was set by mistake, or the device was offline all day. Check both. |
| Everyone marked absent on a weekend | Sat / Sun are still ticked under **Days tracked** in Settings. Untick them. |
| Someone absent but they were at work | They did not scan, or scanned at a device outside their unit. |
| Time out recorded but no time in | Their first scan of the day did not register. Check the device screen for "NO MATCH". |
| A leaver still shows absences | They were never set Inactive. |
| Supervisor sees nothing | Their account has no unit assigned, or the wrong one. |
| Import rejects rows | Missing field, or a unit name that does not match your devices. |

## 9. Device quick reference

| Screen shows | Meaning |
| --- | --- |
| Clock and device name | Normal, waiting for a scan |
| A name, then Present / Time In / Time Out | Scan recognised and recorded |
| A name and "Offline" | Recognised, but no internet -- saved and will upload itself |
| "COOLDOWN" and a name | Same person scanned again within a minute. Normal. |
| "NO MATCH" | Finger not recognised. Try again. |
| A "queued" count under the clock | That many scans are waiting for the internet to return |
| "PENDING" and a MAC address | Device not yet assigned |
| "OTA UPDATE" / "Do not unplug" | Installing an update. Leave it powered on. |

| Light | Meaning |
| --- | --- |
| Solid blue | Ready, online |
| Solid purple | Ready, but no WiFi |
| Green flash | Scan accepted |
| Red flash | Not recognised |
| Solid yellow | Waiting for a finger during enrollment |
| Breathing yellow | Waiting to be assigned |
| Breathing red | Installing an update -- do not unplug |

> [!TIP] A device that has lost WiFi keeps working. It stores scans locally and uploads them when the connection returns, so an internet outage never costs you a day's records.
