# Administrator Manual
:kicker: Role Guide
:subtitle: Day-to-day operations within your institution
:audience: Administrators
:version: Version 2.0  |  August 2026
:footer: ESP32 Fingerprint Attendance System

<<<TOC>>>

## 1. Introduction

As an admin you handle the day-to-day running of the system. This manual covers everything your role can do.

**You can:**

- View and manage the roster
- Manage periods and holidays
- View attendance and export it
- Run year-end promotion (schools)
- In a shop: manage clients, sales, catalog, loyalty, and reports
- View the list of dashboard accounts
- Change your own password

**You cannot:**

- Manage devices, or assign and delete scanners
- Run fingerprint enrollment
- Create, edit, or delete other accounts
- Change institution settings

Anything in that second list is a super admin task -- ask yours.

> [!TIP] This manual covers what your **role** can do. For guidance specific to your kind of organisation, read the matching type guide as well -- the School, Office, or Shop manual.

## 2. Logging in

Open the dashboard URL, enter your email and password, and press **Sign in**.

To change your password, go to **Accounts** and press the key icon next to your own account.

## 3. Members

### 3.1 Viewing the roster

Go to **Members** to see everyone. Search and filter to find a person. The list shows name, ID number, group, unit, and status.

### 3.2 Adding one person

**Add member -> fill in ID number, full name, group, and unit -> Save.**

New members have no fingerprint. Ask a super admin to queue an enrollment job for them.

### 3.3 Importing a spreadsheet

Press **Import CSV** next to Add member. Download the template, fill in one row per person -- ID, full name, unit -- and upload it. A preview shows which rows are ready and which have a problem, such as a missing field or a unit that is not recognised, before anything is created.

**Imported members start Inactive.** Review the list and activate each one once a super admin has enrolled their fingerprint.

### 3.4 Editing and deactivating

Press the edit icon, update the fields, and save. To retire someone, set their status to **Inactive** -- their history is kept and they stop generating absences.

### 3.5 Staff

If your organisation tracks staff separately, a **Staff** section appears and works exactly like Members.

## 4. Periods and holidays

### 4.1 Periods

Go to **Academic** (called **Periods & Holidays** in an office, and not present in a shop) to manage terms.

**Add period -> name, year, start and end dates -> mark Active if it is the current one -> Save.**

Keep exactly one period active at a time. Attendance is tied to whichever period was active when the scan happened.

### 4.2 Holidays

**Add holiday -> label, start date, end date -> Save.** No absences are generated on those days.

Tick **Recurring** if it repeats on the same dates every year, such as Independence Day. Leave it unticked for dates that move, such as Easter.

> [!TIP] Enter the whole period's holidays when you create the period. A missed holiday produces a full roster of false absences that somebody then has to explain.

## 5. Attendance

### 5.1 Viewing

Go to **Attendance** and narrow the records with the filters:

- **Date range** -- from and to
- **Period** -- a specific term
- **Member** -- search by name
- **Unit** -- one class, team, or section
- **Scan type** -- present, absent, time-in, time-out

Time-in and time-out for the same person on the same day appear on one row.

### 5.2 Exporting

Apply your filters, press **Export CSV**, and open the file in Excel or Google Sheets.

> [!NOTE] Absences are filled in automatically overnight for everyone active who did not scan, skipping holidays and -- if that setting is on -- weekends. You never mark anybody absent by hand. A scan that arrives late, from a device that was offline, corrects the record when it syncs.

## 6. Year-end promotion

Schools only. Promotion moves everyone from one grade or year group to the next.

1. Go to **Promotion**.
2. Review the preview and confirm the moves are right.
3. Press **Promote**.

> [!WARNING] This is irreversible. Export the year's attendance records before you run it.

## 7. Shop duties

In a shop, your role also covers the retail side: **Clients**, **Sales**, **Catalog**, **Loyalty**, and **Reports**. These are covered in full in the Shop Manual -- ask your super admin for a copy if you do not have one.

In short:

- **Clients** -- your customers. Phone number is required and must be unique.
- **Sales** -- record what was sold, to whom, and by which staff member.
- **Catalog** -- the products and services you sell, with prices and stock.
- **Loyalty** -- reward rules, and issuing rewards to clients who qualify.
- **Reports** -- takings, top clients, revenue by staff member, popular items, low stock.

## 8. Accounts

Go to **Accounts** to see the dashboard users for your organisation. Search by email and filter by role.

You can change **your own** password with the key icon next to your account. You cannot create, edit, or delete other accounts -- contact a super admin.

## 9. Getting help

| Problem | Who to ask |
| --- | --- |
| Someone needs a fingerprint enrolled | Super admin |
| A device is not working, or shows an odd screen | Super admin |
| A new account is needed, or a password reset for someone else | Super admin |
| A setting or label needs changing | Super admin |
| Attendance looks wrong for a whole day | Check holidays first, then ask your super admin to check the device |
