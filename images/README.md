# Dashboard screenshots — demo institutions

Dark-mode captures of the live dashboard (`esp32-attendance-device-y9cs.vercel.app`),
one set per institution type. Taken 2026-09-08 against three throwaway demo
tenants seeded in the production Supabase project alongside the real ones (the
real institutions are untouched and never appear in these shots — every capture
was taken while signed in as the demo tenant's own `super_admin`, which the app
hard-scopes to that tenant). All 18 `shop--*` shots plus the two settings shots
were re-taken after the `7bd44ab` "drop salon vocabulary" cleanup reached the
live deployment, so nothing here reads "stylist". The 12 `club--*` shots were
added on 2026-10-21 the same way, against a fourth demo tenant.

Filenames: `<type>--<nn>-<page>.jpg`. JPEG because that is what the capture path
produces; ~1250–1570 px wide.

## The demo institutions

| Type | Name | Timezone | Currency | Brand | Admin login |
|---|---|---|---|---|---|
| `school` | Riverdale High School | Africa/Accra | GHS | Indigo `#6366f1` | `riverdale.admin@example.com` |
| `office` | Northwind Logistics | Europe/London | GBP | Emerald `#10b981` | `northwind.admin@example.com` |
| `shop`  | Curbside Cycle Co.    | Africa/Accra | GHS | Rose `#f43f5e`   | `curbside.admin@example.com` |
| `club`  | Lakeside Chess Club   | Africa/Accra | —   | Violet `#7C3AED` | `lakeside.admin@example.com` |

Each was created through the platform-admin **Create institution** flow, then
seeded via SQL: ~8–26 members, 3 devices, an active + a past period, 1–2
holidays, 5 enrolment jobs, and ~12–18 days of attendance history plus a partial
current day. Riverdale and Northwind track late arrivals / early departures;
Curbside adds the full retail module — 15 clients, 8 products, 6 services, 26
sales, 3 loyalty rules with 5 issuances.

Lakeside is meeting-based rather than day-based: 24 members and 3 organisers
across 3 venue devices (Seniors — Club Room, Juniors — Library Annex, Open —
Tournament Hall), 4 recurring schedules (weekly club night, weekly juniors
training, a first-Sunday rapid tournament, a fortnightly blitz evening), 16
closed meetings since 2026-09-09 with present / late / absent rows, one
cancelled session, one ad-hoc meeting opened at the device, a club night live at
capture time, a one-off AGM, and 6 enrolment jobs including a session-master
registration. It records absences and flags arrivals more than 10 minutes after
a meeting's start.

## Inventory

### school/ — Riverdale High School (11)
| File | Page |
|---|---|
| `school--01-overview.jpg` | Overview |
| `school--02-attendance.jpg` | Attendance (records) |
| `school--03-students.jpg` | Students |
| `school--04-teachers.jpg` | Teachers |
| `school--05-devices.jpg` | Devices |
| `school--06-enrollment.jpg` | Enrollment |
| `school--07-academic-terms.jpg` | Academic → Terms |
| `school--08-academic-holidays.jpg` | Academic → Holidays |
| `school--09-promotion.jpg` | Promotion (empty state — see notes) |
| `school--10-accounts.jpg` | Accounts |
| `school--11-settings.jpg` | Settings (identity + branding) |

### office/ — Northwind Logistics (9)
| File | Page |
|---|---|
| `office--01-overview.jpg` | Overview |
| `office--02-attendance.jpg` | Attendance (records) |
| `office--03-staff.jpg` | Staff |
| `office--04-devices.jpg` | Devices |
| `office--05-enrollment.jpg` | Enrollment |
| `office--06-periods.jpg` | Periods & Holidays → Quarters |
| `office--07-holidays.jpg` | Periods & Holidays → Holidays |
| `office--08-accounts.jpg` | Accounts |
| `office--09-settings.jpg` | Settings (identity + branding) |

### shop/ — Curbside Cycle Co. (18)
| File | Page |
|---|---|
| `shop--01-overview.jpg` | Overview |
| `shop--02-attendance.jpg` | Attendance (records) |
| `shop--03-staff.jpg` | Staff |
| `shop--04-clients.jpg` | Clients |
| `shop--05-sales.jpg` | Sales |
| `shop--06-catalog-products.jpg` | Catalog → Products |
| `shop--07-catalog-services.jpg` | Catalog → Services |
| `shop--08-loyalty-rules.jpg` | Loyalty → Rules |
| `shop--09-loyalty-history.jpg` | Loyalty → History |
| `shop--10-reports-takings.jpg` | Reports → Takings |
| `shop--11-reports-by-staff.jpg` | Reports → By staff |
| `shop--12-reports-items.jpg` | Reports → Items |
| `shop--13-reports-low-stock.jpg` | Reports → Low stock |
| `shop--14-devices.jpg` | Devices |
| `shop--15-enrollment.jpg` | Enrollment |
| `shop--16-closed-days.jpg` | Closed Days |
| `shop--17-accounts.jpg` | Accounts |
| `shop--18-settings.jpg` | Settings (identity + branding; "Shop type tracks staff") |

### club/ — Lakeside Chess Club (12)
| File | Page |
|---|---|
| `club--01-overview.jpg` | Overview (live meeting, last meeting, average attendance) |
| `club--02-attendance.jpg` | Attendance (records) |
| `club--03-meetings.jpg` | Meetings → Live now + Upcoming |
| `club--04-meetings-recurring-past.jpg` | Meetings → Recurring + Past 60 days |
| `club--05-meeting-attendance.jpg` | Attendance filtered to one meeting (present / late / absent) |
| `club--06-members.jpg` | Members |
| `club--07-organisers.jpg` | Organisers |
| `club--08-devices.jpg` | Devices |
| `club--09-enrollment.jpg` | Enrollment (incl. a session-master job) |
| `club--10-accounts.jpg` | Accounts |
| `club--11-settings.jpg` | Settings (identity + branding) |
| `club--12-settings-meetings.jpg` | Settings → Meetings (absences, early / late window, auto-close) |

## Notes

- **Promotion (school):** shows the "no devices set up" empty state. The
  promotion calculator derives the form ladder from *device* `group_name`s
  (expecting `Form 1`, `Form 2`, …); the demo's devices are named by physical
  location (`Main Gate`, `Block A`, …), so no ladder is inferred. Real content
  would need devices organised per year-group.
- **Accounts** pages show a single account each — the tenant's first
  `super_admin`. Additional accounts can only be added through the in-app
  "Add account" flow.
- `member_name_display` and a couple of `discount`-driven zero-total sales were
  left at defaults / tidied; nothing else was hand-corrected.
- **Meetings (club):** at capture time the live `/meetings` page lost dark mode
  on load — a hydration mismatch from the locale-dependent date format in
  `formatZonedDate` makes React re-render the root, dropping the `dark` class.
  Dark mode was re-applied with the sidebar theme toggle before `club--03` and
  `club--04` were taken; the page content is unchanged.
