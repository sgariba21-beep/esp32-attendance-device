/*******************************************************
 Central Router Apps Script for per-class Attendance
 - Single web endpoint accepts POST JSON or GET params
 - Payload must include classId or className (classId preferred)
 - Routes the attendance record to that class's spreadsheet (auto-creates it if missing)
 - Preserves per-class student sheet format
 - Teacher sheet exact headers: Id, Name, Subject, Scheduled Start, Scheduled End, Date, Actual Start, Actual End
 - Dedupe on scanId (per-class) using PropertiesService (scanId not written to sheet)
 - New: enrollment API endpoints for device-driven enrollment (fetch/update/list masters)
*******************************************************/

/* CONFIG - set these before deploying */
const DEFAULT_FOLDER_ID = ''; // optional folder for auto-created class spreadsheets
const BRANCHMAP_SPREADSHEET_ID = '12n4oI5sldgTVX71gbbGArbgXmp5VeTM9-cZUzPJ6hZI'; // paste your new BranchMap spreadsheet ID here
const BRANCHMAP_SHEET_NAME = 'BranchMap';
const ATTENDANCE_SHEET_NAME = 'Attendance';
const ALLOW_AUTO_CREATE = true;
const DEDUPE_TTL_MS = 24 * 3600 * 1000; // 24 hours

// Shift start and end times
const SHIFT_START_HOUR = 20;
const SHIFT_START_MIN  = 0;
const SHIFT_END_HOUR   = 23;
const SHIFT_END_MIN    = 0;

// Enrollment sheet name & columns inside each class spreadsheet
const ENROLL_SHEET_NAME = 'Enrollment'; 
// Enrollment sheet column order: FingerID | UniqueID | Name | Role | Command | Status | Note | CreatedAt
// Command values: register, delete, clearall
// Role values: student, teacher, master

// Optional script-level auth key (set to '' to disable)
const SCRIPT_AUTH_KEY = ''; // e.g. "supersecret" - if set, devices must pass &auth=supersecret

// Grace windows (minutes)
const LATE_GRACE_MINUTES = 30; 
const EARLY_GRACE_MINUTES = 30;  

// Configure admin emails here - add or remove as needed
  const adminEmails = [
    "sgariba21@gmail.com",
    // "third.admin@example.com"
  ];

/******** Entrypoints *********/
function doPost(e){ return handleRequest(e); }
function doGet(e){ return handleRequest(e); }

/******** Main handler (extended) *********/
function handleRequest(e) {
  try {
    var params = e.parameter || {};
    var api = (params.api || '').toString().trim();

    if (SCRIPT_AUTH_KEY && (params.auth || '') !== SCRIPT_AUTH_KEY) {
      if (api.indexOf('enroll_') === 0) {
        return jsonOut(403, "Auth required for enrollment API");
      }
    }

    if (api === 'enroll_fetch')   return enrollFetch(e);
    if (api === 'enroll_update')  return enrollUpdate(e);
    if (api === 'enroll_masters') return enrollMasters(e);
    if (api === 'enroll_list')    return enrollList(e);

    var payload = parsePayload(e);

    if (!payload.branchId) {
      return jsonOut(400, "Missing branchId in payload");
    }

    var spreadsheetId = getOrCreateSpreadsheetForBranch(payload.branchId, payload.branchName);
    if (!spreadsheetId) {
      return jsonOut(500, "No spreadsheet found for branch and auto-create disabled");
    }

    var res = storeEmployeeAttendance(spreadsheetId, payload);
    return jsonOut(res.code || 200, res.message || "OK");

  } catch (err) {
    return jsonOut(500, "Server error: " + err.message);
  }
}

/******** Enrollment API implementations *********/

/*
  enroll_fetch
    GET params: classId (required) OR className, auth (if SCRIPT_AUTH_KEY set)
    Returns:
      { statusCode:200, result:"ok", record: { row: ROW_NUMBER, fingerId:NUM_OR_EMPTY, uniqueId:"", name:"", role:"", position:"", command:"register" } }
    If none pending: { statusCode:200, result:"none" }
*/

/******** Ensure Enrollment sheet exists with correct headers *********/
function ensureEnrollSheet(ss) {
  var sheet = ss.getSheetByName(ENROLL_SHEET_NAME);
  if (sheet) return sheet;
  sheet = ss.insertSheet(ENROLL_SHEET_NAME);
  var headers = ['FingerID','UniqueID','Name','Role','Position','Command','Status','Note','CreatedAt'];
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
  sheet.setColumnWidth(5, 130);  // Position
  sheet.setColumnWidth(6, 100);  // Command
  sheet.setColumnWidth(7, 100);  // Status
  sheet.setColumnWidth(8, 180);  // Note
  sheet.setColumnWidth(9, 160);  // CreatedAt
  return sheet;
}

function enrollFetch(e) {
  var params = e.parameter || {};
  var branchId = (params.branchId || params.classId || params.branch || '').toString().trim();
  if (!branchId) return jsonOut(400, "Missing branchId");
  var ssId = getOrCreateSpreadsheetForBranch(branchId, branchId);
  if (!ssId) return jsonOut(500, "No spreadsheet for class");

  var ss = SpreadsheetApp.openById(ssId);
  var enrollSheet = ensureEnrollSheet(ss);

  var lastRow = enrollSheet.getLastRow();
  if (lastRow < 2) return jsonOutObject(200, { result: "none" });

  var data = enrollSheet.getRange(2,1,lastRow-1,9).getValues();
  for (var r = 0; r < data.length; r++) {
    var rowNum = r + 2;
    var row = data[r];
    var fid = (row[0] || '').toString().trim();
    var uniqueId = (row[1] || '').toString().trim();
    var name = (row[2] || '').toString().trim();
    var role = (row[3] || '').toString().trim().toLowerCase();
    var position = (row[4] || '').toString().trim();
    var cmd = (row[5] || '').toString().trim().toLowerCase();
    var status = (row[6] || '').toString().trim().toLowerCase();

    // eligible commands
    if (!cmd) continue;
    if (['register','delete','clearall'].indexOf(cmd) === -1) continue;

    // Only process rows with blank status or 'pending' or 'queued'
    if (status !== '' && status !== 'pending' && status !== 'queued') continue;

    // Mark as 'processing' immediately so re-polls don't pick it up again
    enrollSheet.getRange(rowNum, 7).setValue('processing');

    var outRecord = {
      row: rowNum,
      fingerId: fid ? parseInt(fid,10) : 0,
      uniqueId: uniqueId || '',
      name: name || '',
      role: role || 'employee',
      position: position || '',
      command: cmd
    };
    return jsonOutObject(200, { result: "ok", record: outRecord });
  }

  return jsonOutObject(200, { result: "none" });
}

/*
  enroll_update
    GET params: classId, row (required), status (required), fingerId (optional), note (optional)
    Updates Enrollment sheet row's Status column (and FingerID if provided)
*/
function enrollUpdate(e) {
  var params = e.parameter || {};
  var branchId = (params.branchId || params.classId || '').toString().trim();
  var row = parseInt(params.row,10);
  var status = (params.status || '').toString().trim();
  var fingerId = (params.fingerId || '').toString().trim();
  var note = (params.note || '').toString().trim();
  if (!branchId) return jsonOut(400, "Missing branchId");
  if (!row || row < 2) return jsonOut(400, "Missing/invalid row");

  var ssId = getOrCreateSpreadsheetForBranch(branchId, branchId);
  if (!ssId) return jsonOut(500, "No spreadsheet for branch");

  try {
    var ss = SpreadsheetApp.openById(ssId);
    var enrollSheet = ensureEnrollSheet(ss);

    // FingerID column is 1, UniqueID 2, Name 3, Role 4, Command 5, Status 6, Note 7
    if (fingerId) {
      enrollSheet.getRange(row, 1).setValue(fingerId);
    }
    if (status) {
      enrollSheet.getRange(row, 6).setValue(status);
    }
    if (note) {
      enrollSheet.getRange(row, 7).setValue(note);
    }
    return jsonOut(200, "ok");
  } catch (err) {
    return jsonOut(500, "error: " + err.message);
  }
}

/*
  enroll_masters
    GET params: classId required
    Returns list of master finger IDs for this class spreadsheet that have Status 'registered' (and a numeric FingerID)
    { statusCode:200, masters: [12,45,78] }
*/
function enrollMasters(e) {
  var params = e.parameter || {};
  var branchId = (params.branchId || params.classId || '').toString().trim();
  if (!branchId) return jsonOut(400, "Missing branchId");
  var ssId = getOrCreateSpreadsheetForBranch(branchId, branchId);
  if (!ssId) return jsonOut(500, "No spreadsheet for class");
  var ss = SpreadsheetApp.openById(ssId);
  var enrollSheet = ensureEnrollSheet(ss);
  var masters = [];

  var lastRow = enrollSheet.getLastRow();
  if (lastRow >= 2) {
    var data = enrollSheet.getRange(2,1,lastRow-1,8).getValues();
    for (var r=0; r<data.length; r++) {
      var row = data[r];
      var fid = (row[0] || '').toString().trim();
      var role = (row[3] || '').toString().trim().toLowerCase();
      var status = (row[5] || '').toString().trim().toLowerCase();
      if (role === 'master' && (status === 'registered')) {
        var nfid = parseInt(fid,10);
        if (!isNaN(nfid) && nfid > 0) masters.push(nfid);
      }
    }
  }
  return jsonOutObject(200, { masters: masters });
}

/*
  enroll_list
    GET params: classId
    Returns a small list of enrollment rows for inspection (useful for debugging).
*/
function enrollList(e) {
  var params = e.parameter || {};
  var branchId = (params.branchId || params.classId || '').toString().trim();
  if (!branchId) return jsonOut(400, "Missing branchId");
  var ssId = getOrCreateSpreadsheetForBranch(branchId, branchId);
  if (!ssId) return jsonOut(500, "No spreadsheet for class");
  var ss = SpreadsheetApp.openById(ssId);
  var enrollSheet = ensureEnrollSheet(ss);
  var out = [];

  var lastRow = enrollSheet.getLastRow();
  if (lastRow >= 2) {
    var data = enrollSheet.getRange(2,1,lastRow-1,8).getValues();
    for (var r=0; r<data.length; r++) {
      var row = data[r];
      out.push({
        row: r+2,
        fingerId: (row[0] || ''),
        uniqueId: (row[1] || ''),
        name: (row[2] || ''),
        role: (row[3] || ''),
        command: (row[4] || ''),
        status: (row[5] || ''),
        note: (row[6] || '')
      });
    }
  }
  return jsonOutObject(200, { rows: out });
}

/******** Utility JSON responder *********/
function jsonOut(code, message) {
  return ContentService.createTextOutput(JSON.stringify({ statusCode: code, result: message })).setMimeType(ContentService.MimeType.JSON);
}
function jsonOutObject(code, obj) {
  // if obj already contains statusCode, return as-is
  if (obj && obj.statusCode) return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  var out = { statusCode: code };
  for (var k in obj) out[k] = obj[k];
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/******** Payload parsing (robust) *********/
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
    raw:          payload,
    type:         (get(['type']) || 'employee').toString().toLowerCase(),
    branchId:     (get(['branchId', 'classId', 'branch_id']) || '').toString().trim(),
    branchName:   (get(['branchName', 'className', 'branch_name']) || '').toString().trim(),
    employeeId:       (get(['employeeId', 'employee_id', 'staffId', 'staff_id']) || '').toString().trim(),
    employeeName:     (get(['employeeName', 'employee_name', 'name']) || '').toString().trim(),
    employeePosition: (get(['employeePosition', 'employee_position', 'position']) || '').toString().trim(),
    scanId:           (get(['scanId', 'scan_id']) || '').toString().trim(),
    ts:           (get(['ts', 'timestamp', 'time']) || '').toString().trim(),
    device:       (get(['device', 'deviceId']) || '').toString().trim(),
  };
}

/******** Get or create spreadsheet for a class (unchanged) *********/
function getOrCreateSpreadsheetForBranch(branchId, branchName) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'branch|' + branchId;
  var cached = cache.get(cacheKey);
  if (cached) return cached;

  var mapSS = SpreadsheetApp.openById(BRANCHMAP_SPREADSHEET_ID);
  var mapSheet = mapSS.getSheetByName(BRANCHMAP_SHEET_NAME);
  if (!mapSheet) {
    mapSheet = mapSS.insertSheet(BRANCHMAP_SHEET_NAME);
    mapSheet.appendRow(['branchId','branchName','spreadsheetId','createdAt','active','notes']);
  }

  var lastRow = mapSheet.getLastRow();
  if (lastRow >= 2) {
    var rows = mapSheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (var i = 0; i < rows.length; i++) {
      var rowBranchId = (rows[i][0] || '').toString().trim();
      var rowActive   = (rows[i][4] || '').toString().toUpperCase();
      var rowSheetId  = (rows[i][2] || '').toString().trim();
      if (rowBranchId === branchId && rowActive !== 'N' && rowSheetId) {
        cache.put(cacheKey, rowSheetId, 300);
        return rowSheetId;
      }
    }
  }

  if (!ALLOW_AUTO_CREATE) return null;

  var newName = 'Attendance - ' + (branchName || branchId);
  var newSS = SpreadsheetApp.create(newName);
  try {
    var tz = mapSS.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
    newSS.setSpreadsheetTimeZone(tz);
  } catch (e) {}

  var attSheet = newSS.getSheetByName(ATTENDANCE_SHEET_NAME);
  if (!attSheet) attSheet = newSS.insertSheet(ATTENDANCE_SHEET_NAME);
  attSheet.clear();
  var headers = ['Date','Employee Name','Staff ID','Position','Time-In','Time-Out','Status'];
  attSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var hdrRange = attSheet.getRange(1, 1, 1, headers.length);
  hdrRange.setFontWeight('bold');
  hdrRange.setBackground('#4a86e8');
  hdrRange.setFontColor('#ffffff');
  attSheet.setFrozenRows(1);

  if (DEFAULT_FOLDER_ID) {
    try {
      var file = DriveApp.getFileById(newSS.getId());
      var folder = DriveApp.getFolderById(DEFAULT_FOLDER_ID);
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    } catch (err) {}
  }

  var nowIso = Utilities.formatDate(new Date(),
    mapSS.getSpreadsheetTimeZone() || Session.getScriptTimeZone(),
    "yyyy-MM-dd'T'HH:mm:ss'Z'");
  mapSheet.appendRow([branchId || '', branchName || '', newSS.getId(), nowIso, 'Y', 'auto-created']);
  cache.put(cacheKey, newSS.getId(), 300);
  return newSS.getId();
}

/******** Store Employee Attendance *********/
function storeEmployeeAttendance(spreadsheetId, payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(ATTENDANCE_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(ATTENDANCE_SHEET_NAME);
      var hdrs = ['Date','Employee Name','Staff ID','Position','Time-In','Time-Out','Status'];
      sheet.getRange(1, 1, 1, hdrs.length).setValues([hdrs]);
      sheet.getRange(1, 1, 1, hdrs.length).setFontWeight('bold')
           .setBackground('#4a86e8').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }

    var tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone();

    var employeeId       = payload.employeeId       || '';
    var employeeName     = payload.employeeName     || '';
    var employeePosition = payload.employeePosition || '';
    if (!employeeId) { lock.releaseLock(); return { code: 400, message: "Missing employeeId" }; }

    // Resolve timestamp
    var eventTs = new Date();
    if (payload.ts) {
      var parsed = new Date(payload.ts);
      if (!isNaN(parsed.getTime())) eventTs = parsed;
    }
    var dateStr   = Utilities.formatDate(eventTs, tz, 'yyyy-MM-dd');
    var timeStr   = Utilities.formatDate(eventTs, tz, 'HH:mm');
    var tsMinutes = parseHHMM(timeStr);

    // Scan-level dedupe: reject if this exact scanId was already processed today
    var scanId = payload.scanId || '';
    if (scanId) {
      var lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        // We store processed scanIds in a hidden column 8 (not visible in normal view)
        var scanIds = sheet.getRange(2, 8, lastRow - 1, 1).getValues();
        for (var s = 0; s < scanIds.length; s++) {
          if ((scanIds[s][0] || '').toString() === scanId) {
            lock.releaseLock();
            return { code: 200, message: "Duplicate scanId ignored" };
          }
        }
      }
    }

    // Find existing row for this employee on this date (for Time-Out update)
    var existingRow = -1;
    var existingRowIsAbsent = false;
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues(); // extend to col 7 to read Status
      for (var r = 0; r < data.length; r++) {
        var rowDate = (data[r][0] || '').toString().trim();
        if (Object.prototype.toString.call(data[r][0]) === '[object Date]') {
          rowDate = Utilities.formatDate(new Date(data[r][0]), tz, 'yyyy-MM-dd');
        }
        var rowId = (data[r][2] || '').toString().trim();
        if (rowDate === dateStr && rowId === employeeId) {
          existingRow = r + 2;
          // Check if this is a nightly-inserted Absent row (Time-In is blank)
          var rowTimeIn = (data[r][4] || '').toString().trim(); // col 5 = Time-In
          existingRowIsAbsent = (rowTimeIn === '');
          break;
        }
      }
    }

    var shiftStartMinutes = SHIFT_START_HOUR * 60 + SHIFT_START_MIN;
    var shiftEndMinutes   = SHIFT_END_HOUR   * 60 + SHIFT_END_MIN;

    if (existingRow === -1 || existingRowIsAbsent) {
      // First real scan of day → write as Time-In (overwrite Absent row if present)
      var status = computeStatus(tsMinutes, null, shiftStartMinutes, shiftEndMinutes);
      var newRow = existingRowIsAbsent ? existingRow : lastRow + 1;
      sheet.getRange(newRow, 1).setValue(dateStr);
      sheet.getRange(newRow, 2).setValue(employeeName);
      sheet.getRange(newRow, 3).setValue(employeeId);
      sheet.getRange(newRow, 4).setValue(employeePosition);
      sheet.getRange(newRow, 5).setValue(timeStr);
      sheet.getRange(newRow, 6).setValue('');
      sheet.getRange(newRow, 7).setValue(status);
      if (scanId) sheet.getRange(newRow, 8).setValue(scanId);
      lock.releaseLock();
      return { code: 200, message: (existingRowIsAbsent ? "Absent row corrected to Time-In: " : "Time-In recorded: ") + timeStr };

    } else {
      // Subsequent scan → update Time-Out (last-scan-wins)
      var timeInRaw = sheet.getRange(existingRow, 5).getValue();
      var timeInMinutes = parseTimeCellToMinutes(timeInRaw, tz);
      var status = computeStatus(timeInMinutes, tsMinutes, shiftStartMinutes, shiftEndMinutes);
      sheet.getRange(existingRow, 6).setValue(timeStr);
      sheet.getRange(existingRow, 7).setValue(status);
      if (scanId) sheet.getRange(existingRow, 8).setValue(scanId);
      lock.releaseLock();
      return { code: 200, message: "Time-Out updated: " + timeStr };
    }

  } catch (err) {
    try { lock.releaseLock(); } catch(e) {}
    throw err;
  }
}

/******** Nightly job for filling in blanks in sheet *********/
function runNightlyJob() {
  var tz = Session.getScriptTimeZone();

  // Yesterday's date (job runs at 23:30, so we process today)
  var today = new Date();
  var dateStr = Utilities.formatDate(today, tz, 'yyyy-MM-dd');

  var mapSS = SpreadsheetApp.openById(BRANCHMAP_SPREADSHEET_ID);
  var mapSheet = mapSS.getSheetByName(BRANCHMAP_SHEET_NAME);
  if (!mapSheet) return;

  var lastRow = mapSheet.getLastRow();
  if (lastRow < 2) return;
  var rows = mapSheet.getRange(2, 1, lastRow - 1, 5).getValues();

  for (var i = 0; i < rows.length; i++) {
    var branchId  = (rows[i][0] || '').toString().trim();
    var sheetId   = (rows[i][2] || '').toString().trim();
    var active    = (rows[i][4] || '').toString().toUpperCase();
    if (!sheetId || active === 'N') continue;

    try {
      var ss = SpreadsheetApp.openById(sheetId);
      var attSheet = ss.getSheetByName(ATTENDANCE_SHEET_NAME);
      var enrollSheet = ss.getSheetByName(ENROLL_SHEET_NAME);
      if (!attSheet || !enrollSheet) continue;

      // 1. Fill blank Time-Out fields for today → "No Check-Out"
      var attLastRow = attSheet.getLastRow();
      if (attLastRow >= 2) {
        var attData = attSheet.getRange(2, 1, attLastRow - 1, 7).getValues();
        for (var r = 0; r < attData.length; r++) {
          var rowDate = attData[r][0];
          var rowDateStr = Object.prototype.toString.call(rowDate) === '[object Date]'
            ? Utilities.formatDate(new Date(rowDate), tz, 'yyyy-MM-dd')
            : (rowDate || '').toString().trim();
          if (rowDateStr !== dateStr) continue;
          var timeOut = (attData[r][5] || '').toString().trim(); // col 6 = Time-Out
          if (timeOut === '') {
            var sheetRow = r + 2;
            attSheet.getRange(sheetRow, 6).setValue('No Check-Out');
            // Recompute status: Time-In is still valid, just no check-out
            var timeInStr = (attData[r][4] || '').toString().trim(); // col 5 = Time-In
            var timeInMin = parseHHMM(timeInStr);
            var shiftStart = SHIFT_START_HOUR * 60 + SHIFT_START_MIN;
            var shiftEnd   = SHIFT_END_HOUR   * 60 + SHIFT_END_MIN;
            var newStatus = computeStatus(timeInMin, null, shiftStart, shiftEnd);
            if (newStatus === 'On-Time') newStatus = 'No Check-Out';
            else newStatus = newStatus + ' | No Check-Out';
            attSheet.getRange(sheetRow, 7).setValue(newStatus);
          }
        }
      }

      // 2. Insert Absent rows for registered employees with no scan today
      var enrollLastRow = enrollSheet.getLastRow();
      if (enrollLastRow < 2) continue;
      var enrollData = enrollSheet.getRange(2, 1, enrollLastRow - 1, 9).getValues();

      // Build set of employeeIds that have a row today
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
        var role     = (enrollData[e][3] || '').toString().trim().toLowerCase();
        var position = (enrollData[e][4] || '').toString().trim();
        var status   = (enrollData[e][6] || '').toString().trim().toLowerCase();
        var uid      = (enrollData[e][1] || '').toString().trim();
        var name     = (enrollData[e][2] || '').toString().trim();
        if (role !== 'employee' || status !== 'registered' || !uid) continue;
        if (presentIds[uid]) continue;
        // No scan found → insert Absent row
        attSheet.appendRow([dateStr, name, uid, position, '', '', 'Absent']);
      }

    } catch (err) {
      Logger.log("runNightlyJob error for branch " + branchId + ": " + err.message);
    }
  }
}

// Computes status string from Time-In and Time-Out minutes (null = not yet scanned out)
function computeStatus(timeInMinutes, timeOutMinutes, shiftStart, shiftEnd) {
  let flags = [];
  if (timeInMinutes !== null && timeInMinutes > shiftStart + LATE_GRACE_MINUTES) {
    flags.push('Late');
  }
  if (timeOutMinutes !== null && timeOutMinutes < shiftEnd - EARLY_GRACE_MINUTES) {
    flags.push('Left-Early');
  }
  if (flags.length === 0) return 'On-Time';
  return flags.join(' | ');
}

// Parses "HH:mm" string to total minutes since midnight
function parseHHMM(str) {
  if (!str) return null;
  var parts = str.split(':');
  if (parts.length < 2) return null;
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/******** Helper: start and end of week (Monday..Sunday) *********/
function startOfWeek(d, tz) {
  var dt = new Date(d);
  var dayOfWeek = dt.getDay();
  var daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  var monday = new Date(dt);
  monday.setDate(dt.getDate() - daysSinceMonday);
  monday.setHours(0,0,0,0);
  return monday;
}
function endOfWeek(monday) {
  var sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23,59,59,999);
  return sunday;
}

/******** Helper: parse time cell to minutes since midnight *********/
function parseTimeCellToMinutes(cellValue, tz) {
  if (cellValue === null || cellValue === undefined || cellValue === '') return null;
  if (Object.prototype.toString.call(cellValue) === '[object Date]') {
    var d = cellValue; return d.getHours()*60 + d.getMinutes();
  }
  var s = cellValue.toString().trim();
  var n = parseFloat(s);
  if (!isNaN(n) && s.indexOf(':') === -1) {
    return Math.round(n * 24 * 60);
  }
  var parts = s.split(':');
  if (parts.length >= 2) {
    var hh = parseInt(parts[0],10);
    var mm = parseInt(parts[1],10) || 0;
    if (!isNaN(hh) && !isNaN(mm)) return hh*60 + mm;
  }
  var dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.getHours()*60 + dt.getMinutes();
  return null;
}

function cleanupDedupeProps() {
  var props = PropertiesService.getScriptProperties();
  var keys = props.getKeys();
  var now = new Date().getTime();
  for (var i=0;i<keys.length;i++) {
    if (keys[i].endsWith('-exp')) {
      var raw = props.getProperty(keys[i]);
      if (raw) {
        var exp = parseInt(raw, 10);
        if (!isNaN(exp) && now > exp) {
          var base = keys[i].substring(0, keys[i].length - 4);
          props.deleteProperty(base);
          props.deleteProperty(keys[i]);
        }
      } else {
        var base = keys[i].substring(0, keys[i].length - 4);
        props.deleteProperty(base);
        props.deleteProperty(keys[i]);
      }
    }
  }
}

/******** Export ALL sheets from a spreadsheet as a single XLSX blob *********/
function exportAttendanceSheetAsXlsx(spreadsheetId) {
  var url = "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/export"
    + "?format=xlsx";
  // No &gid= param means the entire workbook (all sheets) is exported
  var token = ScriptApp.getOAuthToken();
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + token },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) return null;
  return response.getBlob().setName("Attendance.xlsx");
}

/******** Monthly Summary *********/
function sendMonthlySummary() {
  var tz = Session.getScriptTimeZone();
  var today = new Date();

  // Report covers the previous calendar month
  var firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  var lastOfPrevMonth  = new Date(firstOfThisMonth.getTime() - 1);
  var firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);

  var monthStartStr = Utilities.formatDate(firstOfPrevMonth, tz, 'yyyy-MM-dd');
  var monthEndStr   = Utilities.formatDate(lastOfPrevMonth,  tz, 'yyyy-MM-dd');
  var monthLabel    = Utilities.formatDate(firstOfPrevMonth, tz, 'MMMM yyyy');

  var mapSS = SpreadsheetApp.openById(BRANCHMAP_SPREADSHEET_ID);
  var mapSheet = mapSS.getSheetByName(BRANCHMAP_SHEET_NAME);
  if (!mapSheet || mapSheet.getLastRow() < 2) {
    Logger.log("No branches found in BranchMap.");
    return;
  }

  var rows = mapSheet.getRange(2, 1, mapSheet.getLastRow() - 1, 5).getValues();
  var summaries = [];
  var attachments = [];

  for (var i = 0; i < rows.length; i++) {
    var branchId   = (rows[i][0] || '').toString().trim();
    var branchName = (rows[i][1] || '').toString().trim();
    var sheetId    = (rows[i][2] || '').toString().trim();
    var active     = (rows[i][4] || '').toString().toUpperCase();
    if (!sheetId || active === 'N') continue;

    try {
      var ss = SpreadsheetApp.openById(sheetId);
      var attSheet = ss.getSheetByName(ATTENDANCE_SHEET_NAME);
      if (!attSheet || attSheet.getLastRow() < 2) {
        summaries.push('<section><h3>' + (branchName || branchId) + '</h3><p>No attendance data this month.</p></section>');
        continue;
      }

      var lastRow = attSheet.getLastRow();
      var data = attSheet.getRange(2, 1, lastRow - 1, 7).getValues();

      // Filter to previous month only
      var monthRows = data.filter(function(row) {
        var d = row[0];
        var ds = Object.prototype.toString.call(d) === '[object Date]'
          ? Utilities.formatDate(new Date(d), tz, 'yyyy-MM-dd')
          : (d || '').toString().trim();
        return ds >= monthStartStr && ds <= monthEndStr;
      });

      if (monthRows.length === 0) {
        summaries.push('<section><h3>' + (branchName || branchId) + '</h3><p>No attendance data this month.</p></section>');
        continue;
      }

      // Aggregate per employee
      var empMap = {};
      for (var r = 0; r < monthRows.length; r++) {
        var row         = monthRows[r];
        var empName     = (row[1] || '').toString().trim();
        var empId       = (row[2] || '').toString().trim();
        var empPosition = (row[3] || '').toString().trim(); // col 4 = Position
        var status      = (row[6] || '').toString().trim(); // col 7 = Status
        var key         = empId || empName;
        if (!key) continue;
        if (!empMap[key]) empMap[key] = { name: empName, id: empId, position: empPosition, present: 0, absent: 0, late: 0, earlyDep: 0, noCheckOut: 0 };
        if (status === 'Absent') {
          empMap[key].absent++;
        } else {
          empMap[key].present++;
          if (status.indexOf('Late') !== -1)        empMap[key].late++;
          if (status.indexOf('Left-Early') !== -1)  empMap[key].earlyDep++;
          if (status.indexOf('No Check-Out') !== -1) empMap[key].noCheckOut++;
        }
      }

      // 1. Delete all entries older than the previous month to keep the sheet lean.
      //    Entries from the previous month and current month are preserved.
      //    Iterate bottom-up to avoid row index shifting after each deletion.
      try {
        if (attSheet.getLastRow() > 1) {
          var attAllData = attSheet.getRange(2, 1, attSheet.getLastRow() - 1, 1).getValues();
          var deletedCount = 0;
          for (var rd = attAllData.length - 1; rd >= 0; rd--) {
            var d = attAllData[rd][0];
            var ds = Object.prototype.toString.call(d) === '[object Date]'
              ? Utilities.formatDate(new Date(d), tz, 'yyyy-MM-dd')
              : (d || '').toString().trim();
            if (ds && ds < monthStartStr) {
              attSheet.deleteRow(rd + 2);
              deletedCount++;
            }
          }
          Logger.log("Cleared " + deletedCount + " old rows for " + (branchName || branchId) + " (before " + monthStartStr + ")");
        }
      } catch(err) {
        Logger.log("Clear old rows failed for " + branchId + ": " + err.message);
      }

      // 2. Write Monthly Summary tab (regenerated fresh each run)
      var summarySheet = ss.getSheetByName('Monthly Summary');
      if (!summarySheet) summarySheet = ss.insertSheet('Monthly Summary');
      summarySheet.clear();
      var sumHeaders = ['Employee Name','Staff ID','Position','Days Present','Days Absent','Late Arrivals','Early Departures','No Check-Out'];
      summarySheet.getRange(1, 1, 1, sumHeaders.length).setValues([sumHeaders]);
      summarySheet.getRange(1, 1, 1, sumHeaders.length).setFontWeight('bold')
                  .setBackground('#4a86e8').setFontColor('#ffffff');
      summarySheet.setFrozenRows(1);

      var empKeys = Object.keys(empMap);
      empKeys.sort(function(a, b) { return empMap[a].name.localeCompare(empMap[b].name); });
      var sumRows = empKeys.map(function(k) {
        var e = empMap[k];
        return [e.name, e.id, e.position, e.present, e.absent, e.late, e.earlyDep, e.noCheckOut];
      });
      if (sumRows.length > 0) {
        summarySheet.getRange(2, 1, sumRows.length, sumHeaders.length).setValues(sumRows);
      }

      // Build HTML section for this branch
      var absentees   = empKeys.filter(function(k) { return empMap[k].absent > 0; });
      var lateArr     = empKeys.filter(function(k) { return empMap[k].late > 0; });
      var earlyArr    = empKeys.filter(function(k) { return empMap[k].earlyDep > 0; });
      var noCheckArr  = empKeys.filter(function(k) { return empMap[k].noCheckOut > 0; });
      var sheetUrl = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit';

      var blocks = [];
      if (absentees.length > 0) {
        blocks.push('<h4>Absent employees (' + absentees.length + ')</h4><ul>' +
          absentees.map(function(k) {
            return '<li>' + empMap[k].name + ' (' + empMap[k].id + ') — ' + empMap[k].absent + ' day(s)</li>';
          }).join('') + '</ul>');
      }
      if (lateArr.length > 0) {
        blocks.push('<h4>Late arrivals (' + lateArr.length + ')</h4><ul>' +
          lateArr.map(function(k) {
            return '<li>' + empMap[k].name + ' (' + empMap[k].id + ') — ' + empMap[k].late + ' occurrence(s)</li>';
          }).join('') + '</ul>');
      }
      if (earlyArr.length > 0) {
        blocks.push('<h4>Early departures (' + earlyArr.length + ')</h4><ul>' +
          earlyArr.map(function(k) {
            return '<li>' + empMap[k].name + ' (' + empMap[k].id + ') — ' + empMap[k].earlyDep + ' occurrence(s)</li>';
          }).join('') + '</ul>');
      }
      if (noCheckArr.length > 0) {
        blocks.push('<h4>No check-out recorded (' + noCheckArr.length + ')</h4><ul>' +
          noCheckArr.map(function(k) {
            return '<li>' + empMap[k].name + ' (' + empMap[k].id + ') — ' + empMap[k].noCheckOut + ' day(s)</li>';
          }).join('') + '</ul>');
      }

      var branchHtml = '<section style="margin-bottom:18px;">'
        + '<h3>' + (branchName || branchId) + '</h3>'
        + (blocks.length > 0 ? blocks.join('<hr style="border:0;border-top:1px solid #eee;margin:8px 0">') : '<p>No issues this month.</p>')
        + '<p><a href="' + sheetUrl + '" target="_blank">View branch sheet</a></p>'
        + '</section>';
      summaries.push(branchHtml);

      // 3. Flush pending writes so the XLSX export captures the updated Monthly Summary tab
      SpreadsheetApp.flush();

      // 4. XLSX attachment
      try {
        var blob = exportAttendanceSheetAsXlsx(sheetId);
        if (blob) {
          blob.setName((branchName || branchId).replace(/[\/\\:*?"<>|]/g, '_') + ' - Attendance - ' + monthLabel + '.xlsx');
          attachments.push(blob);
        }
      } catch(err) {
        Logger.log("XLSX export failed for " + branchId + ": " + err.message);
      }

    } catch (err) {
      summaries.push('<section><p>Error processing ' + (branchName || branchId) + ': ' + err.message + '</p></section>');
    }
  }

  if (summaries.length === 0) { Logger.log("No branch data found."); return; }

  var htmlBody = '<div style="font-family:Arial,sans-serif;line-height:1.6;">'
    + '<p>Hello,</p>'
    + '<p>Here is the attendance summary for <strong>' + monthLabel + '</strong>:</p>'
    + summaries.join('<hr style="border:0;border-top:1px solid #ccc;margin:20px 0">')
    + '<p style="margin-top:30px;">Best regards,<br>Automated Attendance System</p>'
    + '</div>';

  var subject = 'Monthly Attendance Summary — ' + monthLabel;
  for (var m = 0; m < adminEmails.length; m++) {
    var email = (adminEmails[m] || '').trim();
    if (!email) continue;
    MailApp.sendEmail({ to: email, subject: subject, htmlBody: htmlBody, attachments: attachments });
  }
  Logger.log("Monthly summary sent to " + adminEmails.length + " admin(s).");
}

/******** One-time setup / migration: ensure all active branch spreadsheets have correct sheets and headers *********/
function setupAllBranchSpreadsheets() {
  var mapSS = SpreadsheetApp.openById(BRANCHMAP_SPREADSHEET_ID);
  var mapSheet = mapSS.getSheetByName(BRANCHMAP_SHEET_NAME);
  if (!mapSheet || mapSheet.getLastRow() < 2) {
    Logger.log("setupAllBranchSpreadsheets: no branches found in BranchMap.");
    return;
  }

  var rows = mapSheet.getRange(2, 1, mapSheet.getLastRow() - 1, 5).getValues();
  var report = [];

  for (var i = 0; i < rows.length; i++) {
    var branchId   = (rows[i][0] || '').toString().trim();
    var branchName = (rows[i][1] || '').toString().trim();
    var sheetId    = (rows[i][2] || '').toString().trim();
    var active     = (rows[i][4] || '').toString().toUpperCase();
    if (!sheetId || active === 'N') continue;

    var label = branchName || branchId;
    try {
      var ss = SpreadsheetApp.openById(sheetId);
      var changes = [];
      _setupAttendanceSheet(ss, changes);
      _setupEnrollmentSheet(ss, changes);
      _setupMonthlySummarySheet(ss, changes);
      report.push(label + ': ' + (changes.length ? changes.join('; ') : 'no changes needed'));
    } catch (err) {
      report.push(label + ': ERROR — ' + err.message);
    }
  }

  Logger.log("setupAllBranchSpreadsheets complete:\n" + report.join('\n'));
}

function _applySheetHeader(sheet, headers) {
  var r = sheet.getRange(1, 1, 1, headers.length);
  r.setValues([headers]);
  r.setFontWeight('bold').setBackground('#4a86e8').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}

function _setupAttendanceSheet(ss, changes) {
  var headers = ['Date','Employee Name','Staff ID','Position','Time-In','Time-Out','Status'];
  var sheet = ss.getSheetByName(ATTENDANCE_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(ATTENDANCE_SHEET_NAME);
    _applySheetHeader(sheet, headers);
    changes.push('Attendance: created');
    return;
  }

  var numCols = sheet.getLastColumn();
  var existing = numCols > 0 ? sheet.getRange(1, 1, 1, numCols).getValues()[0] : [];
  var col4 = (existing[3] || '').toString().trim();

  if (col4 === 'Position') {
    // Already migrated — re-apply formatting only
    _applySheetHeader(sheet, headers);
    changes.push('Attendance: headers verified');
    return;
  }

  if (col4 === 'Time-In') {
    // Old 6-column format: insert Position column before col 4 to preserve data alignment
    sheet.insertColumnBefore(4);
    changes.push('Attendance: Position column inserted at col 4');
  }

  _applySheetHeader(sheet, headers);
  changes.push('Attendance: headers updated');
}

function _setupEnrollmentSheet(ss, changes) {
  var headers = ['FingerID','UniqueID','Name','Role','Position','Command','Status','Note','CreatedAt'];
  var sheet = ss.getSheetByName(ENROLL_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(ENROLL_SHEET_NAME);
    _applySheetHeader(sheet, headers);
    sheet.setColumnWidth(1, 80);
    sheet.setColumnWidth(2, 110);
    sheet.setColumnWidth(3, 140);
    sheet.setColumnWidth(4, 90);
    sheet.setColumnWidth(5, 130);
    sheet.setColumnWidth(6, 100);
    sheet.setColumnWidth(7, 100);
    sheet.setColumnWidth(8, 180);
    sheet.setColumnWidth(9, 160);
    changes.push('Enrollment: created');
    return;
  }

  var numCols = sheet.getLastColumn();
  var existing = numCols > 0 ? sheet.getRange(1, 1, 1, numCols).getValues()[0] : [];
  var col5 = (existing[4] || '').toString().trim();

  if (col5 === 'Position') {
    _applySheetHeader(sheet, headers);
    changes.push('Enrollment: headers verified');
    return;
  }

  if (col5 === 'Command') {
    // Old 8-column format: insert Position column before col 5
    sheet.insertColumnBefore(5);
    changes.push('Enrollment: Position column inserted at col 5');
  }

  _applySheetHeader(sheet, headers);
  changes.push('Enrollment: headers updated');
}

function _setupMonthlySummarySheet(ss, changes) {
  var headers = ['Employee Name','Staff ID','Position','Days Present','Days Absent','Late Arrivals','Early Departures','No Check-Out'];
  var sheet = ss.getSheetByName('Monthly Summary');
  if (!sheet) return; // created on demand by sendMonthlySummary; nothing to migrate

  var numCols = sheet.getLastColumn();
  var existing = numCols > 0 ? sheet.getRange(1, 1, 1, numCols).getValues()[0] : [];
  var col3 = (existing[2] || '').toString().trim();

  if (col3 === 'Position') {
    _applySheetHeader(sheet, headers);
    changes.push('Monthly Summary: headers verified');
    return;
  }

  if (col3 === 'Days Present') {
    // Old format: insert Position column before col 3
    sheet.insertColumnBefore(3);
    changes.push('Monthly Summary: Position column inserted at col 3');
  }

  _applySheetHeader(sheet, headers);
  changes.push('Monthly Summary: headers updated');
}
