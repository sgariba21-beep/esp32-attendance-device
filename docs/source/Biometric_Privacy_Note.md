# Biometric Privacy Note
:kicker: Policy note
:subtitle: How fingerprints are captured, stored, and protected -- and how to have them removed
:audience: Institution administrators, data-protection officers, and anyone asked to enrol
:version: Version 2.0 | September 2026
:accent: #0f766e
:series: privacy
:output: clients

<<<TOC>>>

## 1. In short

>> The system identifies people by fingerprint without ever keeping a picture of one, and without putting fingerprint data in the cloud.

::: can What the system keeps
- A mathematical template of the finger, inside the scanner's sensor chip
- A slot number (1--127) in the cloud, saying which sensor slot belongs to which person
- Attendance records: who scanned, where, and when
:::
::: cannot What it never keeps
- A fingerprint image -- anywhere, at any time
- Any fingerprint data in the cloud database
- A way to read a template back out of the sensor
:::

You can decline to enrol, and you can ask for your fingerprint to be deleted at any time (section 5).

## 2. What happens when you enrol

1. An administrator starts an enrollment for you on the dashboard. It's sent to the scanner for your class, team, or department.
2. You place the same finger on the sensor twice. Two captures make the template reliable.
3. The sensor's own chip turns the image into a template -- a compact numeric description of the ridge pattern -- and discards the image at once. The image is never stored, sent, or logged.
4. The template is saved in the sensor's memory under a slot number.
5. The scanner tells the dashboard whether it worked. That report contains no fingerprint data.

When you scan later, the sensor compares your finger with the templates it holds and answers with a slot number. Only that number travels further.

## 3. What is stored, and where

<!-- cols: 26 40 34 -->
| Where | What is stored | What is not |
| --- | --- | --- |
| The scanner's sensor chip | Fingerprint templates, in the sensor's own internal format | Images |
| The scanner's memory | A list linking each slot number to a person: their ID, role, and name | Templates or images |
| The cloud database -- people | Two slot numbers per person, e.g. *3* and *7* | Templates, images, or anything derived from them |
| The cloud database -- attendance | Who, when, which scanner, and the scan's reference | Any biometric data |

**The cloud holds only small whole numbers that point to sensor slots.** Even someone with full access to the database could not rebuild a fingerprint from them.

## 4. How it is protected

- **Templates can't be exported.** The sensor stores them in a proprietary format, and the scanner's software can only enrol, search, and delete -- never read a template out.
- **Each scanner has its own secret key.** The server accepts records only from scanners that present it, so one compromised scanner exposes nothing about the others.
- **Lost or stolen scanners can be blocked** by the platform operator instantly, and told to wipe themselves the next time they connect.
- **All traffic is encrypted.** Scanners check the server's identity before sending anything.
- **Each institution's data is kept apart.** Staff of one institution can't see another's people or records, and a scan can only ever be matched within its own institution.
- **Names on screen are adjustable.** Your institution can show a full name, a first name, initials, an ID, or nothing on the scanner's screen after a scan -- useful where a queue can read it.

## 5. Your choices and rights

<!-- cols: 22 78 -->
| Right | How it works |
| --- | --- |
| **Be informed** | You should be told, before enrolling, what this note describes: the template stays on the sensor, and only a slot number goes to the cloud. |
| **Access** | An administrator can show you which slot numbers are linked to you. There is no fingerprint data to show beyond that. |
| **Deletion** | An administrator opens your record and presses **Delete** beside each fingerprint. The scanner erases that template from the sensor and the slot number is removed from the database. |
| **Objection** | You may decline to enrol. The system has no check-in without a fingerprint, so your institution will record your attendance another way -- a paper register, for example. |

> [!NOTE] Being marked **Inactive** -- as leavers are -- stops your attendance being recorded but does not erase your fingerprints. Ask for deletion as well if you want them removed.

## 6. How long things are kept

<!-- cols: 30 70 -->
| Data | Kept until |
| --- | --- |
| **Fingerprint templates** | Deleted as above, overwritten by a new enrollment in the same slot, or erased when an administrator runs **Clear all** on that scanner. |
| **Attendance records** | Your institution decides. The platform doesn't delete them automatically. |
| **Scans waiting to upload** | Normally minutes. A scanner that stays offline keeps them for up to 7 days (or 1,000 scans), then drops the oldest. |
| **The scanner's local log** | Rotated automatically once it reaches its size limit. |

> [!WARNING] When a school promotes its students, their links to last year's scanners are cleared, but the templates themselves stay on those scanners until the slots are reused. Institutions should run **Clear all** on each scanner after promotion, and before any scanner is retired, moved, or passed to another organisation.

## 7. Questions and requests

For questions, or to ask for your fingerprint to be deleted, speak to your institution's administrator first. You can also contact the platform operator at sgariba21@gmail.com.
