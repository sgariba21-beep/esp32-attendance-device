# Documentation

Everything written about the system, sorted by who reads it. The PDFs are
generated -- to change one, edit its source in [`source/`](source/) and rebuild.

```
docs/
├── for-clients/     hand these to institutions
├── for-operators/   for whoever runs the platform
└── source/          Markdown sources + the build script
```

## For clients — [`for-clients/`](for-clients/)

| Document | Who it's for | What it covers |
|---|---|---|
| [Super_Admin_Manual.pdf](for-clients/Super_Admin_Manual.pdf) | The institution's owner account | Scanners, WiFi and master fingers, enrollment, settings, accounts |
| [Admin_Manual.pdf](for-clients/Admin_Manual.pdf) | Day-to-day administrators | People, periods and holidays, attendance, promotion |
| [Staff_Manual.pdf](for-clients/Staff_Manual.pdf) | Teachers and supervisors (read-only) | Checking and exporting attendance for one unit |
| [School_Manual.pdf](for-clients/School_Manual.pdf) | Schools | Terms, classes, class teachers, year-end promotion |
| [Office_Manual.pdf](for-clients/Office_Manual.pdf) | Companies, clinics, churches, NGOs | Scan modes, punctuality, supervisors, payroll export |
| [Shop_Manual.pdf](for-clients/Shop_Manual.pdf) | Shops, salons, barbershops | Clients, sales, catalog, loyalty, reports, cashiers |
| [Biometric_Privacy_Note.pdf](for-clients/Biometric_Privacy_Note.pdf) | Administrators, data-protection officers, enrollees | What fingerprint data exists, where, and how to remove it |

**What to hand over.** Role guides say what each login can do; type guides say
what the system does for that kind of organisation. Clients need both:

| Institution type | Give them |
|---|---|
| School | School + Super Admin + Admin + Staff manuals, and the privacy note |
| Office | Office + Super Admin + Admin + Staff manuals, and the privacy note |
| Shop | Shop + Super Admin + Admin manuals, and the privacy note |

## For operators — [`for-operators/`](for-operators/)

| Document | What it covers |
|---|---|
| [Platform_Admin_Manual.pdf](for-operators/Platform_Admin_Manual.pdf) | Deployment, firmware, onboarding, secrets, OTA releases, troubleshooting, the handover checklist |
| [Technical_Documentation.pdf](for-operators/Technical_Documentation.pdf) | Architecture, hardware, firmware internals, schema, edge functions, dashboard |
| [device-secret-migration-rollout.md](for-operators/device-secret-migration-rollout.md) | Moving scanners from the shared institution secret to per-device secrets |
| [e2e-testing-checklist.md](for-operators/e2e-testing-checklist.md) | End-to-end test cases to run after migrations, deploys, and firmware releases |

## Editing the documents — [`source/`](source/)

Each PDF has a Markdown source of the same name in `source/`. Edit the source,
then rebuild and commit both:

```
cd docs/source
python build.py                 # every document
python build.py Shop_Manual     # just one
```

[`source/README.md`](source/README.md) lists the requirements, the supported
Markdown, and the house style. Screenshots are taken from the repository's
top-level [`images/`](../images/) folder.
