# School Manual
:kicker: Institution Type Guide
:subtitle: Running a school, college, or training centre on the attendance system
:audience: School administrators and staff
:version: Version 2.0  |  August 2026
:footer: ESP32 Fingerprint Attendance System

<<<TOC>>>

## 1. What a school account looks like

A school account tracks **students**, and optionally **teachers and staff**, by fingerprint. It is the only institution type with academic terms and year-end promotion.

Your sidebar has:

- **Attendance** -- all scan records, filterable and exportable
- **Members** -- your student roster (this may be renamed, see section 3)
- **Staff** -- teachers and staff, if you track them
- **Academic** -- terms, years, and holidays
- **Promotion** -- year-end movement between grades
- **Devices**, **Enrollment**, **Accounts**, **Settings**

### 1.1 How a school day is recorded

A student places a finger on a scanner. The device recognises them, records the scan, and shows their name. Every night, the system fills in an **absent** record for every active student who did not scan that day -- skipping holidays, and skipping weekends if you have that switch on.

This means your attendance register completes itself. You do not mark anybody absent by hand.

> [!NOTE] Absences appear the following day, not immediately. If a student scans late in the evening after the nightly run, the system corrects their record from absent to present.

## 2. Setting up, in the right order

1. **Settings** -- name, logo, timezone, and turn on **Skip weekends** if you do not run Saturday classes.
2. **Academic** -- create the current term and mark it Active. Add your holidays.
3. **Devices** -- assign each scanner to the grade and class it sits in.
4. **Members** -- add students, or import them from a spreadsheet.
5. **Enrollment** -- enrol each student's fingerprint.
6. **Accounts** -- create logins for your admin and class teachers.

> [!WARNING] Create your academic term **before** the first scan. Every attendance record is tied to the term that was active when it happened. Scans taken with no active term are harder to report on later.

## 3. Terminology you can change

The system's default words are Member, Group, and Unit. Most schools rename them under **Settings -> Custom labels**:

| Default | A school usually calls it |
| --- | --- |
| Member / Members | Student / Students |
| Group | Form, Grade, or Year |
| Unit | Class, Stream, or Section |
| Period | Term or Semester |
| Staff | Teacher |

Renaming changes the wording throughout the dashboard, including sidebar labels and CSV export headings. It changes nothing about the data itself, so you can adjust it at any time.

## 4. Academic terms and holidays

### 4.1 Terms

Go to **Academic** and add a period with its name, year, and start and end dates. Mark the current one **Active**.

**Keep exactly one term active at a time.** The active term is what the nightly absence run uses, and what most reports default to. At the end of a term, create the new one and mark it active -- the old one becomes inactive automatically in effect, but check it.

### 4.2 Holidays

Add every non-teaching day here: mid-term breaks, public holidays, staff training days. No absences are generated for those dates.

Tick **Recurring** for holidays that land on the same calendar date every year, such as Independence Day. Do not tick it for dates that move, such as Easter -- add those each year.

> [!TIP] Enter next term's holidays at the same time as you create the term. A missed holiday means a full roster of false absences that somebody has to explain to parents.

## 5. Students

### 5.1 Adding students one at a time

Go to **Members**, press **Add member**, and fill in the ID number, full name, group, and unit.

### 5.2 Importing a whole class

Press **Import CSV** next to Add member.

1. Download the template.
2. Fill in one row per student -- ID, full name, and unit.
3. Upload it. You get a preview showing which rows are ready and which have a problem, before anything is created.
4. Confirm.

**Imported students start Inactive.** That is deliberate: they have no fingerprint yet. Enrol each one, then set them Active. Only active students are included in the nightly absence run.

> [!NOTE] If your unit column is rejected, check that the unit names in your spreadsheet exactly match the ones on your devices, including any custom label you set.

### 5.3 Leavers

Set a student to **Inactive** rather than deleting them. Their attendance history is preserved and stops generating absences. Deleting a student removes their records permanently and cannot be undone.

## 6. Year-end promotion

**Promotion** moves every active student up one group -- Grade 9 to Grade 10, and so on. Students in the final year group are deactivated rather than promoted.

1. Go to **Promotion**.
2. Review the preview carefully. It shows exactly who moves and to where.
3. Press **Promote**.

> [!WARNING] Promotion is bulk and irreversible. **Export the full year's attendance before you run it**, and run it once, at the end of the academic year, after reports are done.

## 7. Teachers and class scoping

A teacher or staff account is read-only and sees only their own class. Assign the account to a unit when you create it under **Accounts** -- that assignment is what limits what they can see, including in CSV exports.

Give class teachers a **teacher** account so they can check their own register without being able to change the roster.

## 8. Everyday problems

| Problem | What to do |
| --- | --- |
| Whole class marked absent | A holiday was missing, or the device was offline all day. Add the holiday; check the device screen. |
| A student is absent but was in school | They did not scan, or scanned on a device outside their class. Check the device screen for "NO MATCH". |
| New student can't scan | Fingerprint not enrolled yet, or they are still Inactive. |
| Attendance not tied to a term | No term was active when the scan happened. Create and activate the term. |
| Teacher sees nothing | Their account has no unit assigned, or is assigned to the wrong one. |
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
| "PENDING" and a MAC address | Device not yet assigned to a class |
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

> [!TIP] A device that has lost WiFi keeps working. It stores scans and uploads them when the connection returns, so a router outage never costs you a day's register.
