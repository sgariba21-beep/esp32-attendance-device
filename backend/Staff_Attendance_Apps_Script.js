/*******************************************************
 Staff Attendance Apps Script — Single School
 - Single web endpoint accepts POST JSON or GET params
 - Routes all scans to one fixed school spreadsheet (SCHOOL_SPREADSHEET_ID)
 - Attendance sheet headers: Date | Staff Name | Staff ID | Time-In | Time-Out | Status
 - Dedupe on scanId using a hidden column 7 (scanId not visible in normal view)
 - Enrollment API endpoints for device-driven fingerprint enrollment (fetch/update/list masters)
 - Nightly job fills "No Check-Out" and inserts "Absent" rows for registered staff
 - Monthly summary email sent to adminEmails with XLSX attachment and archive
*******************************************************/

/* ── CONFIG — set these before deploying ── */
const SCHOOL_SPREADSHEET_ID = '13wL2knZ6efzYM_kZ2lMBXbBwB2JM7sZj_8aR00YkzT0'; // ID of the single school attendance spreadsheet
const SCHOOL_NAME           = 'D and D Academy';                                   // Used in email subjects and logging
const ATTENDANCE_SHEET_NAME = 'Attendance';
const DEDUPE_TTL_MS         = 24 * 3600 * 1000; // 24 hours (informational; dedupe uses column 7)

// School day start and end times — used to compute Late / Left-Early status
const SHIFT_START_HOUR = 7;
const SHIFT_START_MIN  = 30;
const SHIFT_END_HOUR   = 15;
const SHIFT_END_MIN    = 30;

// Enrollment sheet inside the school spreadsheet
const ENROLL_SHEET_NAME = 'Enrollment';
// Enrollment sheet column order: FingerID | UniqueID | Name | Role | Command | Status | Note | CreatedAt
// Command values : register, delete, clearall
// Role values    : staff, master

// Optional script-level auth key (set to '' to disable)
const SCRIPT_AUTH_KEY = ''; // e.g. "supersecret" — if set, devices must pass &auth=supersecret

// Grace windows (minutes) — how much slack before a scan is flagged
const LATE_GRACE_MINUTES  = 10;
const EARLY_GRACE_MINUTES = 10;

// Admin email addresses that receive the monthly summary report
const adminEmails = [
  "sgariba21@gmail.com",
  // "vice.principal@school.edu"
];

/******** Entrypoints *********/
function doPost(e) { return handleRequest(e); }
function doGet(e)  { return handleRequest(e); }

/******** Main request handler *********/
function handleRequest(e) {
  try {
    var params = e.parameter || {};
    var api = (params.api || '').toString().trim();

    // Auth gate for enrollment API (if SCRIPT_AUTH_KEY is configured)
    if (SCRIPT_AUTH_KEY && (params.auth || '') !== SCRIPT_AUTH_KEY) {
      if (api.indexOf('enroll_') === 0) {
        return jsonOut(403, "Auth required for enrollment API");
      }
    }

    // Enrollment API routes
    if (api === 'enroll_fetch')   return enrollFetch(e);
    if (api === 'enroll_update')  return enrollUpdate(e);
    if (api === 'enroll_masters') return enrollMasters(e);
    if (api === 'enroll_list')    return enrollList(e);

    // Attendance scan — route directly to the school spreadsheet
    var payload = parsePayload(e);
    var res = storeStaffAttendance(SCHOOL_SPREADSHEET_ID, payload);
    return jsonOut(res.code || 200, res.message || "OK");

  } catch (err) {
    return jsonOut(500, "Server error: " + err.message);
  }
}

/******** Enrollment API *********/

/*
  enroll_fetch
    GET params: auth (if SCRIPT_AUTH_KEY set)
    Returns the next pending enrollment job from the Enrollment sheet:
      { statusCode:200, result:"ok", record: { row, fingerId, uniqueId, name, role, command } }
    If nothing is pending: { statusCode:200, result:"none" }
*/

/******** Ensure Enrollment sheet exists with correct headers *********/
function ensureEnrollSheet(ss) {
  var sheet = ss.getSheetByName(ENROLL_SHEET_NAME);
  if (sheet) return sheet;
  sheet = ss.insertSheet(ENROLL_SHEET_NAME);
  var headers = ['FingerID','UniqueID','Name','Role','Command','Status','Note','CreatedAt'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var hdrRange = sheet.getRange(1, 1, 1, headers.length);
  hdrRange.setFontWeight('bold');
  hdrRange.setBackground('#4a86e8');
  hdrRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 80);   // FingerID
  sheet.setColumnWidth(2, 110);  // UniqueID
  sheet.setColumnWidth(3, 140);  // Name
  sheet.setColumnWidth(4, 90);   // Role
  sheet.setColumnWidth(5, 100);  // Command
  sheet.setColumnWidth(6, 100);  // Status
  sheet.setColumnWidth(7, 180);  // Note
  sheet.setColumnWidth(8, 160);  // CreatedAt
  return sheet;
}

function enrollFetch(e) {
  var ss = SpreadsheetApp.openById(SCHOOL_SPREADSHEET_ID);
  var enrollSheet = ensureEnrollSheet(ss);

  var lastRow = enrollSheet.getLastRow();
  if (lastRow < 2) return jsonOutObject(200, { result: "none" });

  var data = enrollSheet.getRange(2, 1, lastRow - 1, 8).getValues();
  for (var r = 0; r < data.length; r++) {
    var rowNum  = r + 2;
    var row     = data[r];
    var fid     = (row[0] || '').toString().trim();
    var uniqueId = (row[1] || '').toString().trim();
    var name    = (row[2] || '').toString().trim();
    var role    = (row[3] || '').toString().trim().toLowerCase();
    var cmd     = (row[4] || '').toString().trim().toLowerCase();
    var status  = (row[5] || '').toString().trim().toLowerCase();

    // Skip rows with no command or an unrecognised command
    if (!cmd) continue;
    if (['register','delete','clearall'].indexOf(cmd) === -1) continue;

    // Only pick up rows that haven't been started yet
    if (status !== '' && status !== 'pending' && status !== 'queued') continue;

    // Mark as 'processing' immediately so a re-poll doesn't pick the same row twice
    enrollSheet.getRange(rowNum, 6).setValue('processing');

    var outRecord = {
      row:      rowNum,
      fingerId: fid ? parseInt(fid, 10) : 0,
      uniqueId: uniqueId || '',
      name:     name     || '',
      role:     role     || 'staff',
      command:  cmd
    };
    return jsonOutObject(200, { result: "ok", record: outRecord });
  }

  return jsonOutObject(200, { result: "none" });
}

/*
  enroll_update
    GET params: row (required), status (required), fingerId (optional), note (optional)
    Updates the Status column (and FingerID if provided) for the given Enrollment sheet row.
*/
function enrollUpdate(e) {
  var params   = e.parameter || {};
  var row      = parseInt(params.row, 10);
  var status   = (params.status   || '').toString().trim();
  var fingerId = (params.fingerId || '').toString().trim();
  var note     = (params.note     || '').toString().trim();
  if (!row || row < 2) return jsonOut(400, "Missing/invalid row");

  try {
    var ss          = SpreadsheetApp.openById(SCHOOL_SPREADSHEET_ID);
    var enrollSheet = ensureEnrollSheet(ss);

    // Column map: FingerID=1, UniqueID=2, Name=3, Role=4, Command=5, Status=6, Note=7
    if (fingerId) enrollSheet.getRange(row, 1).setValue(fingerId);
    if (status)   enrollSheet.getRange(row, 6).setValue(status);
    if (note)     enrollSheet.getRange(row, 7).setValue(note);
    return jsonOut(200, "ok");
  } catch (err) {
    return jsonOut(500, "error: " + err.message);
  }
}

/*
  enroll_masters
    Returns all master finger IDs that have Status 'registered' (with a numeric FingerID).
    { statusCode:200, masters: [12,45,78] }
*/
function enrollMasters(e) {
  var ss          = SpreadsheetApp.openById(SCHOOL_SPREADSHEET_ID);
  var enrollSheet = ensureEnrollSheet(ss);
  var masters     = [];

  var lastRow = enrollSheet.getLastRow();
  if (lastRow >= 2) {
    var data = enrollSheet.getRange(2, 1, lastRow - 1, 8).getValues();
    for (var r = 0; r < data.length; r++) {
      var row    = data[r];
      var fid    = (row[0] || '').toString().trim();
      var role   = (row[3] || '').toString().trim().toLowerCase();
      var status = (row[5] || '').toString().trim().toLowerCase();
      if (role === 'master' && status === 'registered') {
        var nfid = parseInt(fid, 10);
        if (!isNaN(nfid) && nfid > 0) masters.push(nfid);
      }
    }
  }
  return jsonOutObject(200, { masters: masters });
}

/*
  enroll_list
    Returns all Enrollment sheet rows — useful for debugging enrollment state.
*/
function enrollList(e) {
  var ss          = SpreadsheetApp.openById(SCHOOL_SPREADSHEET_ID);
  var enrollSheet = ensureEnrollSheet(ss);
  var out         = [];

  var lastRow = enrollSheet.getLastRow();
  if (lastRow >= 2) {
    var data = enrollSheet.getRange(2, 1, lastRow - 1, 8).getValues();
    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      out.push({
        row:      r + 2,
        fingerId: (row[0] || ''),
        uniqueId: (row[1] || ''),
        name:     (row[2] || ''),
        role:     (row[3] || ''),
        command:  (row[4] || ''),
        status:   (row[5] || ''),
        note:     (row[6] || '')
      });
    }
  }
  return jsonOutObject(200, { rows: out });
}

/******** Utility JSON responders *********/
function jsonOut(code, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ statusCode: code, result: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
function jsonOutObject(code, obj) {
  // If obj already carries a statusCode, return it as-is
  if (obj && obj.statusCode) {
    return ContentService
      .createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var out = { statusCode: code };
  for (var k in obj) out[k] = obj[k];
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/******** Payload parser — accepts both POST JSON body and GET query params *********/
function parsePayload(e) {
  var payload = {};
  if (e && e.postData && e.postData.contents) {
    try { payload = JSON.parse(e.postData.contents); }
    catch (err) { payload = e.parameter || {}; }
  } else {
    payload = e.parameter || {};
  }

  var get = function(keys) {
    for (var i = 0; i < keys.length; i++) {
      if (payload[keys[i]] !== undefined && payload[keys[i]] !== null) return payload[keys[i]];
    }
    return '';
  };

  return {
    raw:       payload,
    staffId:   (get(['staffId',   'staff_id',   'employeeId', 'employee_id']) || '').toString().trim(),
    staffName: (get(['staffName', 'staff_name', 'employeeName', 'name'])      || '').toString().trim(),
    scanId:    (get(['scanId',    'scan_id'])                                  || '').toString().trim(),
    ts:        (get(['ts',        'timestamp',  'time'])                       || '').toString().trim(),
    device:    (get(['device',    'deviceId'])                                 || '').toString().trim(),
  };
}

/******** Store Staff Attendance *********/
function storeStaffAttendance(spreadsheetId, payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss    = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(ATTENDANCE_SHEET_NAME);
    if (!sheet) {
      // Auto-create the Attendance sheet if it doesn't exist yet
      sheet = ss.insertSheet(ATTENDANCE_SHEET_NAME);
      var hdrs = ['Date','Staff Name','Staff ID','Time-In','Time-Out','Status'];
      sheet.getRange(1, 1, 1, hdrs.length).setValues([hdrs]);
      sheet.getRange(1, 1, 1, hdrs.length)
           .setFontWeight('bold').setBackground('#4a86e8').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }

    var tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone();

    var staffId   = payload.staffId   || '';
    var staffName = payload.staffName || '';
    if (!staffId) { lock.releaseLock(); return { code: 400, message: "Missing staffId" }; }

    // Resolve timestamp (falls back to server time if payload.ts is missing or invalid)
    var eventTs = new Date();
    if (payload.ts) {
      var parsed = new Date(payload.ts);
      if (!isNaN(parsed.getTime())) eventTs = parsed;
    }
    var dateStr   = Utilities.formatDate(eventTs, tz, 'yyyy-MM-dd');
    var timeStr   = Utilities.formatDate(eventTs, tz, 'HH:mm');
    var tsMinutes = parseHHMM(timeStr);

    // Scan-level dedupe: reject if this exact scanId was already recorded today
    // scanId is stored in the hidden column 7 (not visible in the normal sheet view)
    var scanId = payload.scanId || '';
    if (scanId) {
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        var scanIds = sheet.getRange(2, 7, lastRow - 1, 1).getValues();
        for (var s = 0; s < scanIds.length; s++) {
          if ((scanIds[s][0] || '').toString() === scanId) {
            lock.releaseLock();
            return { code: 200, message: "Duplicate scanId ignored" };
          }
        }
      }
    }

    // Look for an existing row for this staff member on this date (needed for Time-Out update)
    var existingRow        = -1;
    var existingRowIsAbsent = false;
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
      for (var r = 0; r < data.length; r++) {
        var rowDate = (data[r][0] || '').toString().trim();
        if (Object.prototype.toString.call(data[r][0]) === '[object Date]') {
          rowDate = Utilities.formatDate(new Date(data[r][0]), tz, 'yyyy-MM-dd');
        }
        var rowId = (data[r][2] || '').toString().trim();
        if (rowDate === dateStr && rowId === staffId) {
          existingRow = r + 2;
          // A nightly-inserted Absent row has a blank Time-In; treat this as the first real scan
          existingRowIsAbsent = ((data[r][3] || '').toString().trim() === '');
          break;
        }
      }
    }

    var shiftStartMinutes = SHIFT_START_HOUR * 60 + SHIFT_START_MIN;
    var shiftEndMinutes   = SHIFT_END_HOUR   * 60 + SHIFT_END_MIN;

    if (existingRow === -1 || existingRowIsAbsent) {
      // First real scan of the day → record as Time-In (overwrites an Absent row if present)
      var status = computeStatus(tsMinutes, null, shiftStartMinutes, shiftEndMinutes);
      var newRow = existingRowIsAbsent ? existingRow : lastRow + 1;
      sheet.getRange(newRow, 1).setValue(dateStr);
      sheet.getRange(newRow, 2).setValue(staffName);
      sheet.getRange(newRow, 3).setValue(staffId);
      sheet.getRange(newRow, 4).setValue(timeStr);
      sheet.getRange(newRow, 5).setValue('');
      sheet.getRange(newRow, 6).setValue(status);
      if (scanId) sheet.getRange(newRow, 7).setValue(scanId);
      lock.releaseLock();
      return { code: 200, message: (existingRowIsAbsent ? "Absent row corrected to Time-In: " : "Time-In recorded: ") + timeStr };

    } else {
      // Subsequent scan on the same day → update Time-Out (last-scan-wins)
      var timeInRaw     = sheet.getRange(existingRow, 4).getValue();
      var timeInMinutes = parseTimeCellToMinutes(timeInRaw, tz);
      var status        = computeStatus(timeInMinutes, tsMinutes, shiftStartMinutes, shiftEndMinutes);
      sheet.getRange(existingRow, 5).setValue(timeStr);
      sheet.getRange(existingRow, 6).setValue(status);
      if (scanId) sheet.getRange(existingRow, 7).setValue(scanId);
      lock.releaseLock();
      return { code: 200, message: "Time-Out updated: " + timeStr };
    }

  } catch (err) {
    try { lock.releaseLock(); } catch(e) {}
    throw err;
  }
}

/******** Nightly job — run via a time-driven trigger at ~23:30 each school day *********/
function runNightlyJob() {
  var tz      = Session.getScriptTimeZone();
  var today   = new Date();
  var dateStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  try {
    var ss          = SpreadsheetApp.openById(SCHOOL_SPREADSHEET_ID);
    var attSheet    = ss.getSheetByName(ATTENDANCE_SHEET_NAME);
    var enrollSheet = ss.getSheetByName(ENROLL_SHEET_NAME);
    if (!attSheet || !enrollSheet) {
      Logger.log("runNightlyJob: Attendance or Enrollment sheet not found.");
      return;
    }

    // 1. Fill blank Time-Out fields for today → "No Check-Out"
    var attLastRow = attSheet.getLastRow();
    if (attLastRow >= 2) {
      var attData = attSheet.getRange(2, 1, attLastRow - 1, 6).getValues();
      for (var r = 0; r < attData.length; r++) {
        var rowDate = attData[r][0];
        var rowDateStr = Object.prototype.toString.call(rowDate) === '[object Date]'
          ? Utilities.formatDate(new Date(rowDate), tz, 'yyyy-MM-dd')
          : (rowDate || '').toString().trim();
        if (rowDateStr !== dateStr) continue;
        var timeOut = (attData[r][4] || '').toString().trim();
        if (timeOut === '') {
          var sheetRow    = r + 2;
          var timeInStr   = (attData[r][3] || '').toString().trim();
          var timeInMin   = parseHHMM(timeInStr);
          var shiftStart  = SHIFT_START_HOUR * 60 + SHIFT_START_MIN;
          var shiftEnd    = SHIFT_END_HOUR   * 60 + SHIFT_END_MIN;
          var newStatus   = computeStatus(timeInMin, null, shiftStart, shiftEnd);
          // Append "No Check-Out" to whatever punctuality status was computed
          newStatus = (newStatus === 'On-Time') ? 'No Check-Out' : newStatus + ' | No Check-Out';
          attSheet.getRange(sheetRow, 5).setValue('No Check-Out');
          attSheet.getRange(sheetRow, 6).setValue(newStatus);
        }
      }
    }

    // 2. Insert Absent rows for registered staff who have no scan entry today
    var enrollLastRow = enrollSheet.getLastRow();
    if (enrollLastRow < 2) return;
    var enrollData = enrollSheet.getRange(2, 1, enrollLastRow - 1, 6).getValues();

    // Build a set of staffIds that already have a row for today
    var presentIds = {};
    if (attLastRow >= 2) {
      var attData2 = attSheet.getRange(2, 1, attLastRow - 1, 3).getValues();
      for (var a = 0; a < attData2.length; a++) {
        var aDate = attData2[a][0];
        var aDateStr = Object.prototype.toString.call(aDate) === '[object Date]'
          ? Utilities.formatDate(new Date(aDate), tz, 'yyyy-MM-dd')
          : (aDate || '').toString().trim();
        if (aDateStr === dateStr) {
          presentIds[(attData2[a][2] || '').toString().trim()] = true;
        }
      }
    }

    for (var e = 0; e < enrollData.length; e++) {
      var role   = (enrollData[e][3] || '').toString().trim().toLowerCase();
      var status = (enrollData[e][5] || '').toString().trim().toLowerCase();
      var uid    = (enrollData[e][1] || '').toString().trim();
      var name   = (enrollData[e][2] || '').toString().trim();
      // Only insert Absent rows for registered staff members (not masters)
      if (role !== 'staff' || status !== 'registered' || !uid) continue;
      if (presentIds[uid]) continue;
      attSheet.appendRow([dateStr, name, uid, '', '', 'Absent']);
    }

  } catch (err) {
    Logger.log("runNightlyJob error: " + err.message);
  }
}

/******** Compute punctuality status from Time-In and Time-Out minutes *********/
// timeOutMinutes = null means the staff member hasn't checked out yet
function computeStatus(timeInMinutes, timeOutMinutes, shiftStart, shiftEnd) {
  var flags = [];
  if (timeInMinutes !== null && timeInMinutes > shiftStart + LATE_GRACE_MINUTES) {
    flags.push('Late');
  }
  if (timeOutMinutes !== null && timeOutMinutes < shiftEnd - EARLY_GRACE_MINUTES) {
    flags.push('Left-Early');
  }
  return flags.length === 0 ? 'On-Time' : flags.join(' | ');
}

/******** Parse "HH:mm" string → total minutes since midnight *********/
function parseHHMM(str) {
  if (!str) return null;
  var parts = str.split(':');
  if (parts.length < 2) return null;
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/******** Helper: parse a Sheets time cell value → minutes since midnight *********/
// Handles Date objects, decimal fractions (Sheets internal format), and "HH:mm" strings
function parseTimeCellToMinutes(cellValue, tz) {
  if (cellValue === null || cellValue === undefined || cellValue === '') return null;
  if (Object.prototype.toString.call(cellValue) === '[object Date]') {
    return cellValue.getHours() * 60 + cellValue.getMinutes();
  }
  var s = cellValue.toString().trim();
  var n = parseFloat(s);
  if (!isNaN(n) && s.indexOf(':') === -1) {
    return Math.round(n * 24 * 60); // Sheets stores times as fractions of a day
  }
  var parts = s.split(':');
  if (parts.length >= 2) {
    var hh = parseInt(parts[0], 10);
    var mm = parseInt(parts[1], 10) || 0;
    if (!isNaN(hh) && !isNaN(mm)) return hh * 60 + mm;
  }
  var dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.getHours() * 60 + dt.getMinutes();
  return null;
}

/******** Helper: start and end of week (Monday–Sunday) *********/
function startOfWeek(d) {
  var dt = new Date(d);
  var dayOfWeek = dt.getDay();
  var daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  dt.setDate(dt.getDate() - daysSinceMonday);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
function endOfWeek(monday) {
  var sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

/******** Clean up expired scan-dedupe entries from Script Properties *********/
function cleanupDedupeProps() {
  var props = PropertiesService.getScriptProperties();
  var keys  = props.getKeys();
  var now   = new Date().getTime();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].endsWith('-exp')) {
      var raw = props.getProperty(keys[i]);
      var base = keys[i].substring(0, keys[i].length - 4);
      if (raw) {
        var exp = parseInt(raw, 10);
        if (!isNaN(exp) && now > exp) {
          props.deleteProperty(base);
          props.deleteProperty(keys[i]);
        }
      } else {
        props.deleteProperty(base);
        props.deleteProperty(keys[i]);
      }
    }
  }
}

/******** Export the entire school spreadsheet as a single XLSX blob *********/
function exportAttendanceSheetAsXlsx(spreadsheetId) {
  // Omitting &gid= exports all sheets (Attendance + archive tabs) in one workbook
  var url = "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/export?format=xlsx";
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) return null;
  return response.getBlob().setName("Attendance.xlsx");
}

/******** Monthly Summary — triggered on the 1st of each month *********/
// Aggregates the previous month's data, emails a report to adminEmails,
// attaches an XLSX of the full workbook, and archives + clears the Attendance sheet.
function sendMonthlySummary() {
  var tz    = Session.getScriptTimeZone();
  var today = new Date();

  // Determine the previous calendar month's date range
  var firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  var lastOfPrevMonth  = new Date(firstOfThisMonth.getTime() - 1);
  var firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);

  var monthStartStr = Utilities.formatDate(firstOfPrevMonth, tz, 'yyyy-MM-dd');
  var monthEndStr   = Utilities.formatDate(lastOfPrevMonth,  tz, 'yyyy-MM-dd');
  var monthLabel    = Utilities.formatDate(firstOfPrevMonth, tz, 'MMMM yyyy');

  try {
    var ss       = SpreadsheetApp.openById(SCHOOL_SPREADSHEET_ID);
    var attSheet = ss.getSheetByName(ATTENDANCE_SHEET_NAME);
    var sheetUrl = 'https://docs.google.com/spreadsheets/d/' + SCHOOL_SPREADSHEET_ID + '/edit';

    if (!attSheet || attSheet.getLastRow() < 2) {
      Logger.log("sendMonthlySummary: No attendance data found.");
      return;
    }

    var lastRow = attSheet.getLastRow();
    var data    = attSheet.getRange(2, 1, lastRow - 1, 6).getValues();

    // Filter rows to the previous month only
    var monthRows = data.filter(function(row) {
      var d  = row[0];
      var ds = Object.prototype.toString.call(d) === '[object Date]'
        ? Utilities.formatDate(new Date(d), tz, 'yyyy-MM-dd')
        : (d || '').toString().trim();
      return ds >= monthStartStr && ds <= monthEndStr;
    });

    if (monthRows.length === 0) {
      Logger.log("sendMonthlySummary: No rows for " + monthLabel);
      return;
    }

    // Aggregate per staff member
    var staffMap = {};
    for (var r = 0; r < monthRows.length; r++) {
      var row       = monthRows[r];
      var staffName = (row[1] || '').toString().trim();
      var staffId   = (row[2] || '').toString().trim();
      var status    = (row[5] || '').toString().trim();
      var key       = staffId || staffName;
      if (!key) continue;
      if (!staffMap[key]) {
        staffMap[key] = { name: staffName, id: staffId, present: 0, absent: 0, late: 0, earlyDep: 0, noCheckOut: 0 };
      }
      if (status === 'Absent') {
        staffMap[key].absent++;
      } else {
        staffMap[key].present++;
        if (status.indexOf('Late')         !== -1) staffMap[key].late++;
        if (status.indexOf('Left-Early')   !== -1) staffMap[key].earlyDep++;
        if (status.indexOf('No Check-Out') !== -1) staffMap[key].noCheckOut++;
      }
    }

    // Write (or regenerate) the Monthly Summary tab
    var summarySheet = ss.getSheetByName('Monthly Summary');
    if (!summarySheet) summarySheet = ss.insertSheet('Monthly Summary');
    summarySheet.clear();
    var sumHeaders = ['Staff Name','Staff ID','Days Present','Days Absent','Late Arrivals','Early Departures','No Check-Out'];
    summarySheet.getRange(1, 1, 1, sumHeaders.length).setValues([sumHeaders]);
    summarySheet.getRange(1, 1, 1, sumHeaders.length)
                .setFontWeight('bold').setBackground('#4a86e8').setFontColor('#ffffff');
    summarySheet.setFrozenRows(1);

    var staffKeys = Object.keys(staffMap);
    staffKeys.sort(function(a, b) { return staffMap[a].name.localeCompare(staffMap[b].name); });
    var sumRows = staffKeys.map(function(k) {
      var m = staffMap[k];
      return [m.name, m.id, m.present, m.absent, m.late, m.earlyDep, m.noCheckOut];
    });
    if (sumRows.length > 0) {
      summarySheet.getRange(2, 1, sumRows.length, sumHeaders.length).setValues(sumRows);
    }

    // Build the HTML email body
    var absentees  = staffKeys.filter(function(k) { return staffMap[k].absent     > 0; });
    var lateArr    = staffKeys.filter(function(k) { return staffMap[k].late       > 0; });
    var earlyArr   = staffKeys.filter(function(k) { return staffMap[k].earlyDep   > 0; });
    var noCheckArr = staffKeys.filter(function(k) { return staffMap[k].noCheckOut > 0; });

    var blocks = [];
    if (absentees.length > 0) {
      blocks.push('<h4>Absent staff (' + absentees.length + ')</h4><ul>' +
        absentees.map(function(k) {
          return '<li>' + staffMap[k].name + ' (' + staffMap[k].id + ') — ' + staffMap[k].absent + ' day(s)</li>';
        }).join('') + '</ul>');
    }
    if (lateArr.length > 0) {
      blocks.push('<h4>Late arrivals (' + lateArr.length + ')</h4><ul>' +
        lateArr.map(function(k) {
          return '<li>' + staffMap[k].name + ' (' + staffMap[k].id + ') — ' + staffMap[k].late + ' occurrence(s)</li>';
        }).join('') + '</ul>');
    }
    if (earlyArr.length > 0) {
      blocks.push('<h4>Early departures (' + earlyArr.length + ')</h4><ul>' +
        earlyArr.map(function(k) {
          return '<li>' + staffMap[k].name + ' (' + staffMap[k].id + ') — ' + staffMap[k].earlyDep + ' occurrence(s)</li>';
        }).join('') + '</ul>');
    }
    if (noCheckArr.length > 0) {
      blocks.push('<h4>No check-out recorded (' + noCheckArr.length + ')</h4><ul>' +
        noCheckArr.map(function(k) {
          return '<li>' + staffMap[k].name + ' (' + staffMap[k].id + ') — ' + staffMap[k].noCheckOut + ' day(s)</li>';
        }).join('') + '</ul>');
    }

    var schoolHtml = '<section style="margin-bottom:18px;">'
      + '<h3>' + SCHOOL_NAME + ' — ' + monthLabel + '</h3>'
      + (blocks.length > 0
          ? blocks.join('<hr style="border:0;border-top:1px solid #eee;margin:8px 0">')
          : '<p>No attendance issues this month.</p>')
      + '<p><a href="' + sheetUrl + '" target="_blank">View attendance sheet</a></p>'
      + '</section>';

    // Export XLSX before archiving so the attachment contains the full raw data
    var attachments = [];
    try {
      var blob = exportAttendanceSheetAsXlsx(SCHOOL_SPREADSHEET_ID);
      if (blob) {
        blob.setName(SCHOOL_NAME.replace(/[\/\\:*?"<>|]/g, '_') + ' - Attendance - ' + monthLabel + '.xlsx');
        attachments.push(blob);
      }
    } catch(err) {
      Logger.log("XLSX export failed: " + err.message);
    }

    // Archive previous month's rows into a dedicated tab, then delete them from Attendance
    try {
      var archiveTabName = 'Archive - ' + monthLabel;
      var archiveSheet   = ss.getSheetByName(archiveTabName);
      if (!archiveSheet) archiveSheet = ss.insertSheet(archiveTabName);
      archiveSheet.clear();

      // Copy header row to archive tab
      var hdrs = attSheet.getRange(1, 1, 1, 6).getValues();
      archiveSheet.getRange(1, 1, 1, 6).setValues(hdrs);
      archiveSheet.getRange(1, 1, 1, 6)
                  .setFontWeight('bold').setBackground('#4a86e8').setFontColor('#ffffff');
      archiveSheet.setFrozenRows(1);

      var archiveRows = data.filter(function(row) {
        var d  = row[0];
        var ds = Object.prototype.toString.call(d) === '[object Date]'
          ? Utilities.formatDate(new Date(d), tz, 'yyyy-MM-dd')
          : (d || '').toString().trim();
        return ds >= monthStartStr && ds <= monthEndStr;
      });
      if (archiveRows.length > 0) {
        archiveSheet.getRange(2, 1, archiveRows.length, 6).setValues(archiveRows);
      }

      // Delete only the archived rows from Attendance, working bottom-up to preserve row indices
      // Any rows belonging to the current month (e.g. from a late-running trigger) are kept intact
      var attAllData = attSheet.getRange(2, 1, attSheet.getLastRow() - 1, 1).getValues();
      for (var rd = attAllData.length - 1; rd >= 0; rd--) {
        var d  = attAllData[rd][0];
        var ds = Object.prototype.toString.call(d) === '[object Date]'
          ? Utilities.formatDate(new Date(d), tz, 'yyyy-MM-dd')
          : (d || '').toString().trim();
        if (ds >= monthStartStr && ds <= monthEndStr) {
          attSheet.deleteRow(rd + 2); // +2 because data starts at row 2
        }
      }

      Logger.log("Archived " + archiveRows.length + " rows for " + monthLabel);
    } catch(err) {
      Logger.log("Archive/clear failed: " + err.message);
    }

    // Send the email report
    var htmlBody = '<div style="font-family:Arial,sans-serif;line-height:1.6;">'
      + '<p>Hello,</p>'
      + '<p>Here is the staff attendance summary for <strong>' + SCHOOL_NAME + '</strong> — <strong>' + monthLabel + '</strong>:</p>'
      + schoolHtml
      + '<p style="margin-top:30px;">Best regards,<br>Automated Staff Attendance System</p>'
      + '</div>';

    var subject = SCHOOL_NAME + ' — Monthly Staff Attendance Summary — ' + monthLabel;
    for (var m = 0; m < adminEmails.length; m++) {
      var email = (adminEmails[m] || '').trim();
      if (!email) continue;
      MailApp.sendEmail({ to: email, subject: subject, htmlBody: htmlBody, attachments: attachments });
    }
    Logger.log("Monthly summary sent to " + adminEmails.length + " admin(s).");

  } catch (err) {
    Logger.log("sendMonthlySummary error: " + err.message);
  }
}
