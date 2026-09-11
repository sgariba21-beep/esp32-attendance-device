# Staff Manual
:kicker: Role guide
:subtitle: Checking attendance and the roster for your class, team, or department
:audience: Teachers, supervisors, and staff with a read-only dashboard account
:version: Version 3.0 | September 2026
:accent: #0369a1
:series: staff
:output: clients

<<<TOC>>>

## 1. At a glance

>> Your account lets you **see** attendance and the roster for one unit -- your class, team, section, or department. It cannot change anything, so you can explore freely without breaking anything.

::: can
- See attendance for your unit, day by day
- See totals per person and per period
- Export attendance to a spreadsheet
- See the roster for your unit
:::
::: cannot
- See other units
- Add, edit, or remove people
- Enrol fingerprints or manage scanners
- Change settings, accounts, or passwords
:::

Your admin and super admin set up your account and can do everything in the right-hand list. Section 8 says who to ask for what.

### 1.1 Words used in this guide

Each institution can rename the dashboard's main words, so your screens may say *Students* or *Class* where this guide says *Member* or *Unit*. The meaning is the same.

<!-- cols: 20 50 30 -->
| Word | Meaning | A school might say |
| --- | --- | --- |
| **Member** | A person whose attendance is recorded | Student |
| **Unit** | One place people scan -- each unit has its own scanner | Class |
| **Group** | A set of units | Form, Grade, or Year |
| **Period** | A stretch of time you report on | Term |
| **Scan** | Placing a finger on the scanner | -- |

## 2. Signing in and finding your way

1. Open the dashboard address your admin gave you.
2. Enter your email and password.
3. Press **Sign in**.

There is no sign-up page and no "forgot password" link. If you can't sign in, ask your super admin to reset your password.

### 2.1 What you'll see

The menu shows only the pages your account can open:

- **Overview** -- today at a glance: how many are present and absent, the attendance rate, and the latest scans
- **Attendance** -- every record for your unit, with filters, totals, and export
- **Members** -- the roster for your unit (your institution may call this page *Students*, *Employees*, or similar)

Pages update themselves within a few seconds when new scans arrive, so there's no need to reload.

### 2.2 On a phone

On a phone the menu becomes a bar along the bottom of the screen: **Overview**, **Attendance**, your roster, and **More**.

To keep the dashboard on your home screen like an app, press **Install app** at the bottom of the menu. On an iPhone, open the dashboard in Safari, tap the Share icon, then choose **Add to Home Screen**.

> [!NOTE] For security, the dashboard signs you out after **10 minutes** without activity, and whenever you close the browser. Just sign in again.

The moon icon next to your name switches between light and dark mode.

## 3. Checking attendance

Press **Attendance**. A small padlock chip in the filter bar shows the unit your account is locked to.

![The Attendance page. Screenshots in this guide use demo data in dark mode -- your names, colours, and menu will differ.](../../images/school--02-attendance.jpg)

The page has three tabs:

<!-- cols: 22 78 -->
| Tab | What it shows |
| --- | --- |
| **Records** | One row per person per day: date, name, ID, unit, period, time, and status. Where your institution records arrival and departure, both times share one row. |
| **Summary** | Present and absent totals, and the attendance percentage, for each unit and period. |
| **By member** | One row per person: days present, days absent, attendance rate, and when they were last seen. |

### 3.1 Narrowing the list

The filters above the tabs apply to all three:

<!-- cols: 26 74 -->
| Filter | Use it to |
| --- | --- |
| **From** and **To** | Show one stretch of dates. |
| **Period** | Show one term or reporting period. |
| **Member type** | Show members or staff only, where your institution tracks both. |
| **Status** | Show only Present or only Absent records. |
| **Members** | Pick one or more people by name. |

### 3.2 Reading a record

<!-- cols: 26 74 -->
| You see | It means |
| --- | --- |
| **Present** | They scanned that day. |
| **Absent** | They didn't scan on a day that counts. Added automatically each evening. |
| **Time In** and **Time Out** | Their first and second scans of the day, where your institution records arrival and departure. |
| **Late** badge | They arrived after the expected start time plus the grace period. |
| **Early** badge | They left before the expected end time minus the grace period. |

> [!NOTE] Nobody marks absences by hand. Each evening the system adds an **Absent** record for every active person who didn't scan, skipping holidays and days your institution doesn't track. If a scanner was offline, its saved scans upload later and correct those records.

## 4. Looking at the roster

Press **Members** to see everyone assigned to your unit, with their name, ID, and whether they are **Active** or **Inactive**. Search by name or ID, and use the status filter to include inactive people.

You can't edit the roster. If a name or ID is wrong, or someone is missing, tell your admin.

## 5. Exporting to a spreadsheet

1. Go to **Attendance**.
2. Set the filters you want -- for example **From** and **To** for this month.
3. Press **Export CSV**.
4. Open the downloaded file in Excel or Google Sheets.

The file follows your filters and only ever contains your unit.

## 6. The scanner

Each unit has a fingerprint scanner with a small screen and a coloured light around the sensor. You don't manage it, but knowing what it shows helps you answer "did my scan work?" on the spot.

::: screens
08:14 | Form 2 Science | Online | **Ready.** The clock, the device's name, and its connection.
SCANNED | Ama Mensah | **Checking** with the server -- about a second.
PRESENT | Ama Mensah | **Recorded.** May also say "TIME IN" or "TIME OUT".
SAVED | Ama Mensah | Offline | **Saved offline.** It uploads by itself when the internet returns.
NOT LOGGED | Ama Mensah | **Not counted**, e.g. a holiday, an untracked day, or already recorded today.
COOLDOWN | Ama Mensah | **Scanned twice** within a minute. Nothing to do.
NO MATCH | **Not recognised.** Try again with the finger flat and still.
NOT MAPPED | See admin | **Known finger, no person** linked on this device. Tell your admin.
OTA UPDATE | Do not unplug | **Updating.** Leave it powered on; it restarts by itself.
:::

| Light | Meaning |
| --- | --- |
| Solid blue | Ready and online |
| Solid purple | Ready, but no WiFi -- scans are saved and upload later |
| Green flash | Scan accepted |
| Red flash | Not recognised |
| Breathing yellow | Waiting to be set up by an administrator |
| Breathing red | Installing an update -- do not unplug |

> [!TIP] A scanner that has lost its internet connection keeps working. It stores every scan and uploads them when the connection returns, so an outage never costs anyone a day's attendance.

## 7. When something looks wrong

<!-- cols: 38 62 -->
| Problem | What to do |
| --- | --- |
| Someone is marked absent but was there | Ask what the screen said when they scanned. "NO MATCH" means the scan didn't count. Tell your admin -- you can't edit records. |
| Everyone is absent on one day | The day may be missing from the holiday list, or the scanner was off all day. Tell your admin. |
| A person is missing from the roster | They haven't been added yet, or they're assigned to another unit. |
| You see no records at all | Your account may not be linked to a unit. Ask your super admin to check it. |
| You were signed out | Normal after 10 minutes without activity. Sign in again. |

## 8. Getting help

<!-- cols: 45 55 -->
| You need | Ask |
| --- | --- |
| A new password | Your super admin |
| A name, ID, or roster change | Your admin |
| A scanner looked at | Your admin -- say what the screen and light show |
| Access to a different unit | Your super admin |
