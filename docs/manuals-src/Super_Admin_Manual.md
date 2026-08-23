# Super Administrator Manual
:kicker: Role Guide
:subtitle: Full access within your institution
:audience: Super administrators
:version: Version 2.0  |  August 2026
:footer: ESP32 Fingerprint Attendance System

<<<TOC>>>

## 1. Introduction

As super admin you have full access to your institution's data and settings. You are responsible for:

- Assigning and managing the fingerprint devices
- Managing your roster of members and staff
- Running fingerprint enrollment
- Configuring periods and holidays
- Viewing and exporting attendance
- Managing the dashboard accounts for your organisation
- Configuring settings and branding

> [!TIP] This manual covers what your **role** can do. For guidance specific to your kind of organisation, read the matching type guide as well -- the School, Office, or Shop manual.

## 2. Logging in

Open the dashboard URL, enter your email and password, and press **Sign in**.

There is no self-service password reset. Passwords are changed from the **Accounts** page. If you are locked out entirely, contact your platform administrator.

## 3. What you see

| Section | What it does |
| --- | --- |
| **Attendance** | Every attendance record. Filter by date, period, member, or unit. |
| **Members** | Your main roster. |
| **Staff** | Staff roster, if you track staff separately. |
| **Devices** | Assign, rename, and manage the fingerprint scanners. |
| **Enrollment** | Queue fingerprint enrollment jobs. |
| **Academic** / **Periods & Holidays** / **Closed Days** | Terms and non-working days. The name depends on your type. |
| **Promotion** | Year-end bulk promotion. Schools only. |
| **Clients**, **Sales**, **Catalog**, **Loyalty**, **Reports** | The retail module. Shops only. |
| **Settings** | Name, logo, branding, labels, currency, scan modes, timezone. |
| **Accounts** | Dashboard logins for your organisation. |

## 4. Devices

### 4.1 Assigning a new device

A new device registers itself when first powered on and then waits to be assigned.

1. Go to **Devices**. The device appears as Unassigned or Pending.
2. Press **Assign**.
3. Choose the group and unit it belongs to.
4. Give it a display name, e.g. *"Room 204 Scanner"*.
5. Press **Save**.

It picks up its configuration within seconds. Its light changes from breathing yellow to solid blue.

### 4.2 Renaming a device

**Devices -> edit -> update the display name -> Save.** The new name appears on the device screen.

### 4.3 Deleting a device

Deleting removes it and queues a wipe -- it clears its identity on next boot and re-registers as new. Attendance records are preserved.

Only delete a device you intend to remove permanently or re-provision from scratch.

### 4.4 First-time WiFi setup

A brand-new device has no WiFi saved and opens its own setup network so it can be configured on site.

1. Power on the device.
2. On a phone or laptop, join the WiFi network **Attendance-Setup**, password **setup1234**.
3. Open `http://192.168.4.1` if a setup page does not appear by itself.
4. Enter your WiFi name and password.
5. Press **Save & Connect**. The device saves and restarts.
6. Reconnect your phone to your normal WiFi.

This setup network only appears on its own the very first time a factory-fresh device boots. After that it can only be reopened deliberately with a master fingerprint. Do not share the setup password outside your admin team.

### 4.5 Enrolling a master fingerprint -- do this on day one

A master fingerprint is an admin finger that reopens the WiFi setup screen later -- when you move the device, or your WiFi password changes. It never records attendance.

1. Go to **Enrollment** and create a new job.
2. Choose **Reg. master** as the command instead of a normal member enrollment.
3. Select the device and queue it.
4. At the device, place the finger twice when prompted.

Keep track of whose finger it is. You will need that same finger later.

> [!WARNING] Enrol a master fingerprint on **every** device while it still has a working connection. If you skip this and your WiFi later changes, there is no way to reconnect the device on site -- it has to go back to your platform administrator for a physical reflash.

### 4.6 Changing the WiFi later

1. At the device, scan the master finger once. The screen shows **CONFIRM?**
2. Scan the same finger again within about 8 seconds. A different finger, or waiting too long, cancels safely.
3. The device reopens **Attendance-Setup**. Follow steps 2--6 in section 4.4.

### 4.7 The device screen

| What you see | What it means |
| --- | --- |
| Clock, device name, Online/Offline | Normal idle screen |
| A name appears briefly after a scan | Recognised -- resolves to Present / Time In / Time Out once the server confirms |
| A name and "Offline" | Recognised but no internet. Queued, and will sync when reconnected. |
| "COOLDOWN" and a name | Same person scanned again within 60 seconds. Normal. |
| "NO MATCH" or "NOT MAPPED" | Fingerprint not recognised. Try again; tell your admin if it persists. |
| A "queued" count under the clock | Offline, with that many scans stored locally awaiting upload |
| "PENDING" and a MAC address | Not yet assigned -- see section 4.1 |
| "REJECTED" or "REVOKED" | Contact your platform administrator |
| "SETUP" / Attendance-Setup / 192.168.4.1 | WiFi setup screen is open |
| "PRESS 1/2" or "PRESS 2/2" | Enrollment in progress |
| "ENROLLED" | Enrollment succeeded |
| "OTA UPDATE" / "Do not unplug" | Installing a firmware update. Leave it powered until it restarts itself, usually 1--3 minutes. |

### 4.8 The device lights

| Light | Meaning |
| --- | --- |
| Solid blue | Idle, connected. Normal. |
| Solid purple | Idle, no WiFi. |
| Blinking purple | WiFi setup screen is open. |
| Green flash | Scan accepted, or an admin task succeeded. |
| Red flash | Not recognised, or a task failed. |
| Solid yellow | Waiting for a finger during enrollment. |
| Breathing yellow | Waiting to be assigned to a unit. |
| Breathing red | Installing a firmware update -- do not unplug. |
| Five quick yellow flashes | Master fingerprint confirmed; setup screen opening. |

## 5. Members

### 5.1 Adding a member

**Members** (or **Staff**) **-> Add -> fill in ID number, full name, group, and unit -> Save.**

New members have no fingerprint yet. Enrol them from **Enrollment**.

### 5.2 Importing a spreadsheet

Press **Import CSV**. Download the template, fill in one row per person -- ID, full name, unit -- and upload. You get a preview flagging any row with a missing field or an unrecognised unit before anything is created.

**Imported members start Inactive.** Review the list and activate each one once their fingerprint is enrolled.

### 5.3 Editing and deactivating

Edit the member and change their status to **Inactive** to retire them. They drop off the default list, stop generating absences, and keep their full history.

### 5.4 Deleting

Deleting permanently removes a member and all their attendance records. This cannot be undone. Deactivate instead unless you truly want the history gone.

## 6. Fingerprint enrollment

Enrollment is remote: you queue a job from the dashboard and the device handles the physical capture.

1. Go to **Enrollment** and create a new job.
2. Select the member and which finger.
3. Select the device they will scan at.
4. Queue it.
5. At the device, the member places their finger twice when prompted.
6. The job moves from Pending to Done, or Error if it failed.

The member must be physically at the device while the job is active.

To replace a stored finger, enrol the same slot again -- the old template is overwritten.

## 7. Periods and holidays

Create a period with its name, year, and start and end dates, and mark the current one **Active**. Keep exactly one active at a time. Attendance is tied to whichever period was active when the scan happened.

Under holidays, add every non-working day. No absences are generated on those dates. Tick **Recurring** for holidays on the same calendar date each year.

If **Skip weekends** is on in Settings, Saturdays and Sundays are skipped automatically -- do not add them individually.

## 8. Attendance

Go to **Attendance** and filter by date range, period, member, unit, or scan type. Time-in and time-out for the same person on the same day appear on one row.

To export: apply your filters, press **Export CSV**, and open the file in Excel or Google Sheets.

## 9. Year-end promotion

Schools only. Promotion moves every active member up one group. Members in the final group are deactivated rather than promoted.

Review the preview, then press **Promote**.

> [!WARNING] Promotion is bulk and irreversible. Export the year's attendance before running it.

## 10. Settings

| Setting | What it controls |
| --- | --- |
| **Name and logo** | Shown in the sidebar and on exports. |
| **Brand colour** | Pick a preset or a custom colour. Themes the whole dashboard. |
| **Custom labels** | Rename Member, Group, Unit, Period, and Staff to your own vocabulary. Applies throughout, including CSV headings. |
| **Track students / track staff** | Which rosters exist, and the scan mode for each. |
| **Scan mode** | *Present / absent* -- one scan per day. *Time in / out* -- first scan in, second out. |
| **Name shown on device** | How much of a person's name appears on the device screen after a scan: full name, first name, initial and surname, ID number, or nothing. |
| **Currency** | Denomination for shop money figures. Display only. |
| **Sell products / services / loyalty** | Which retail modules are active. Shops only. |
| **Skip weekends** | Do not generate absences on Saturday and Sunday. |
| **Timezone** | Decides when a day starts and ends for records and absence marking. |

> [!TIP] "Name shown on device" is a privacy control. In a shared or public area, *first name only* or *initial and surname* keeps the queue behind the scanner from reading everyone's full identity.

## 11. Accounts

### 11.1 Creating an account

**Accounts -> Add account.** Enter the email, choose a role, assign a unit if the role needs one, and set an initial password.

You can create **admin**, **teacher**, **staff**, and -- in a shop -- **cashier**. You cannot create another super admin; ask your platform administrator.

### 11.2 What each role can do

| Role | Access |
| --- | --- |
| **admin** | Members, periods, promotion, attendance. Views accounts; changes own password. |
| **teacher / staff** | Read-only attendance and roster, limited to their assigned unit. |
| **cashier** | Shops only: clients, sales, and catalog. No reports, staff, or settings. |

A teacher or staff account **must** be assigned to a unit -- that assignment is what scopes everything they see, including their exports.

### 11.3 Managing accounts

Search by email, filter by role. The key icon changes a password -- your own or anybody else's. The trash icon deletes an account and revokes access immediately.

At least one super admin must always remain; the system will not let you delete the last one.

## 12. Getting help

For anything involving a device that will not connect, a rejected or revoked device, firmware, or a lost super admin password, contact your platform administrator. Everything else in this manual you can do yourself.
