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
const CLASSMAP_SPREADSHEET_ID = '1dl4KR5vNwE4lqMtiY8mBQ7v-ShLQwuEAHX1glWpPFXY';
const DEFAULT_FOLDER_ID = ''; // optional folder for auto-created class spreadsheets

const CLASSMAP_SHEET_NAME = 'ClassMap';
const TARGET_SHEET_NAME = 'Attendance';
const TEACHER_SHEET_NAME = 'TeacherAttendance';
const TIMETABLE_SHEET_NAME = 'Timetable';
const ALLOW_AUTO_CREATE = true;
const DEDUPE_TTL_MS = 24 * 3600 * 1000; // 24 hours

// Enrollment sheet name & columns inside each class spreadsheet
const ENROLL_SHEET_NAME = 'Enrollment'; 
// Enrollment sheet column order: FingerID | UniqueID | Name | Role | Command | Status | Note | CreatedAt
// Command values: register, delete, clearall
// Role values: student, teacher, master

// Optional script-level auth key (set to '' to disable)
const SCRIPT_AUTH_KEY = ''; // e.g. "supersecret" - if set, devices must pass &auth=supersecret

// Grace windows (minutes)
const LATE_GRACE_MINUTES = 5;   // used for reporting: teacher can be up to this many minutes late without being flagged
const EARLY_GRACE_MINUTES = 5;  // used for reporting: teacher can end this many minutes early without being flagged

// Timetable matching windows (minutes)
const TEACHER_EARLY_WINDOW_MINUTES = 15; // allow matching up to 15 minutes before scheduled start (for clock-ins)
const TEACHER_LATE_WINDOW_MINUTES  = 10; // allow matching up to 10 minutes after scheduled end (for clock-outs)

// Configure admin emails here - add or remove as needed
  const adminEmails = [
    "adjeijehnissi@gmail.com",
    "sgariba21@gmail.com",
    // "third.admin@example.com"
  ];

/******** Entrypoints *********/
function doPost(e){ return handleRequest(e); }
function doGet(e){ return handleRequest(e); }

/******** Main handler (extended) *********/
function handleRequest(e) {
  try {
    cleanupDedupeProps();
    // Basic auth check for enrollment endpoints (if configured)
    var params = e.parameter || {};
    var api = (params.api || '').toString().trim();

    if (SCRIPT_AUTH_KEY && (params.auth || '') !== SCRIPT_AUTH_KEY) {
      // Only block if an API requires auth (we make enroll_* endpoints respect auth if key set)
      // For normal attendance endpoints we let them be accessible (as before) unless you configure stricter auth.
      // If a request is explicitly to enrollment endpoints and auth fails, return 403.
      if (api.indexOf('enroll_') === 0) {
        return jsonOut(403, "Auth required for enrollment API");
      }
    }

    // Enrollment-specific API endpoints (non-destructive; conservative)
    if (api === 'enroll_fetch') {
      return enrollFetch(e);
    }
    if (api === 'enroll_update') {
      return enrollUpdate(e);
    }
    if (api === 'enroll_masters') {
      return enrollMasters(e);
    }
    if (api === 'enroll_list') {
      return enrollList(e);
    }

    // Otherwise fall through to original attendance handling:
    var payload = parsePayload(e);

    if (!payload.classId && !payload.className) {
      return jsonOut(400, "Missing classId or className in payload");
    }

    var isTeacher = detectTeacherPayload(payload);

    var classId = payload.classId || sanitizeClassId(payload.className);
    var className = payload.className || payload.classId || classId;

    var spreadsheetId = getOrCreateSpreadsheetForClass(classId, className);
    if (!spreadsheetId) {
      storeUnmapped(payload, "no-mapping");
      return jsonOut(500, "No spreadsheet found for class and auto-create disabled");
    }

    if (isTeacher) {
      var r = storeTeacherAttendanceInSpreadsheet(spreadsheetId, payload, classId);
      return jsonOut(r.code || 200, r.message || "OK");
    } else {
      if (detectTeacherPayload(payload)) {
        var rr = storeTeacherAttendanceInSpreadsheet(spreadsheetId, payload, classId);
        return jsonOut(rr.code || 200, rr.message || "Routed to teacher handler defensively");
      }
      var res = storeAttendanceInSpreadsheet(spreadsheetId, payload, classId);
      return jsonOut(res.code || 200, res.message || "OK");
    }
  } catch (err) {
    try { storeUnmapped({error: err.message, raw: JSON.stringify(e)}, "handler-error"); } catch(ex){}
    return jsonOut(500, "Server error: " + err.message);
  }
}

/******** Enrollment API implementations *********/

/*
  enroll_fetch
    GET params: classId (required) OR className, auth (if SCRIPT_AUTH_KEY set)
    Returns:
      { statusCode:200, result:"ok", record: { row: ROW_NUMBER, fingerId:NUM_OR_EMPTY, uniqueId:"", name:"", role:"", command:"register" } }
    If none pending: { statusCode:200, result:"none" }
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
  var params = e.parameter || {};
  var classId = (params.classId || params.class || '').toString().trim();
  var className = (params.className || params.class || '').toString().trim();
  if (!classId && !className) return jsonOut(400, "Missing classId/className");

  var ssId = getOrCreateSpreadsheetForClass(classId || sanitizeClassId(className), className || classId);
  if (!ssId) return jsonOut(500, "No spreadsheet for class");

  var ss = SpreadsheetApp.openById(ssId);
  var enrollSheet = ensureEnrollSheet(ss);

  var lastRow = enrollSheet.getLastRow();
  if (lastRow < 2) return jsonOutObject(200, { result: "none" });

  var data = enrollSheet.getRange(2,1,lastRow-1,8).getValues();
  for (var r = 0; r < data.length; r++) {
    var rowNum = r + 2;
    var row = data[r];
    var fid = (row[0] || '').toString().trim();
    var uniqueId = (row[1] || '').toString().trim();
    var name = (row[2] || '').toString().trim();
    var role = (row[3] || '').toString().trim().toLowerCase();
    var cmd = (row[4] || '').toString().trim().toLowerCase();
    var status = (row[5] || '').toString().trim().toLowerCase();

    // eligible commands
    if (!cmd) continue;
    if (['register','delete','clearall'].indexOf(cmd) === -1) continue;

    // Only process rows with blank status or 'pending' or 'queued'
    if (status !== '' && status !== 'pending' && status !== 'queued') continue;
    
    // Mark as 'processing' immediately so re-polls don't pick it up again
    enrollSheet.getRange(rowNum, 6).setValue('processing');

    var outRecord = {
      row: rowNum,
      fingerId: fid ? parseInt(fid,10) : 0,
      uniqueId: uniqueId || '',
      name: name || '',
      role: role || 'student',
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
  var classId = (params.classId || '').toString().trim();
  var row = parseInt(params.row,10);
  var status = (params.status || '').toString().trim();
  var fingerId = (params.fingerId || '').toString().trim();
  var note = (params.note || '').toString().trim();
  if (!classId) return jsonOut(400, "Missing classId");
  if (!row || row < 2) return jsonOut(400, "Missing/invalid row");

  var ssId = getOrCreateSpreadsheetForClass(classId, classId);
  if (!ssId) return jsonOut(500, "No spreadsheet for class");

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
  var classId = (params.classId || '').toString().trim();
  if (!classId) return jsonOut(400, "Missing classId");
  var ssId = getOrCreateSpreadsheetForClass(classId, classId);
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
  var classId = (params.classId || '').toString().trim();
  if (!classId) return jsonOut(400, "Missing classId");
  var ssId = getOrCreateSpreadsheetForClass(classId, classId);
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

/******** The rest of your original router script follows unchanged (with small defensive additions)
 * I copy-paste the existing functions from your script below except I ensure helper jsonOut is present
 * and I didn't change the original attendance logic.
 *
 * Note: the functions below are verbatim from your original script with no semantic changes.
 */

/******** Detect teacher payload (defensive) *********/
function detectTeacherPayload(payload) {
  if (!payload) return false;
  var type = (payload.type || '').toString().toLowerCase();
  if (type === 'teacher') return true;

  var teacherId = (payload.teacherId || payload.teacher_id || payload.teacherid || payload.teacher || '').toString().trim();
  if (teacherId) return true;

  var action = (payload.action || payload.act || payload.event || '').toString().toLowerCase();
  if (action.indexOf('clock') !== -1 || action.indexOf('time') !== -1) return true;
  return false;
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
    for (var i=0;i<keys.length;i++){
      if (payload[keys[i]] !== undefined && payload[keys[i]] !== null) return payload[keys[i]];
    }
    return '';
  };

  var out = {
    raw: payload,
    type: (get(['type','role']) || 'student').toString().toLowerCase(),
    classId: (get(['classId','class','class_id','className','classNameRaw']) || '').toString().trim(),
    className: (get(['className','classname','class']) || '').toString().trim(),
    studentId: (get(['studentId','student_id','studentid','id']) || '').toString().trim(),
    student: (get(['student','name','studentName']) || '').toString().trim(),
    scanId: (get(['scanId','idempotencyId','scan_id','scanid']) || '').toString().trim(),
    date: (get(['date']) || '').toString().trim(),
    ts: (get(['ts','timestamp','time']) || '').toString().trim(),
    device: (get(['device','deviceId']) || '').toString().trim(),
    teacherId: (get(['teacherId','teacher_id','teacherid','teacher']) || '').toString().trim(),
    teacherName: (get(['teacherName','teacher_name','name','teacher']) || '').toString().trim(),
    action: (get(['action','act','event']) || '').toString().trim().toLowerCase()
  };
  return out;
}

/******** Get or create spreadsheet for a class (unchanged) *********/
function getOrCreateSpreadsheetForClass(classId, className) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'class|' + classId;
  var cached = cache.get(cacheKey);
  if (cached) return cached;

  var mapSS = SpreadsheetApp.openById(CLASSMAP_SPREADSHEET_ID);
  var mapSheet = mapSS.getSheetByName(CLASSMAP_SHEET_NAME);
  if (!mapSheet) {
    mapSheet = mapSS.insertSheet(CLASSMAP_SHEET_NAME);
    mapSheet.appendRow(['classId','className','spreadsheetId','createdAt','active','notes']);
  }

  var mapData = mapSheet.getDataRange().getValues();
  var foundId = null;
  for (var r = 1; r < mapData.length; r++) {
    var row = mapData[r];
    var cid = (row[0] || '').toString().trim();
    var cname = (row[1] || '').toString().trim();
    var ssid = (row[2] || '').toString().trim();
    var active = (row[4] || 'Y').toString().trim().toUpperCase();
    if (!ssid) continue;
    if (cid && cid === classId) { foundId = ssid; break; }
    if (!foundId && className && cname && cname === className) { foundId = ssid; }
  }

  if (foundId) {
    cache.put(cacheKey, foundId, 300);
    return foundId;
  }

  if (!ALLOW_AUTO_CREATE) return null;

  var newName = 'Attendance - ' + (className || classId);
  var newSS = SpreadsheetApp.create(newName);
  try {
    var tz = mapSS.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
    newSS.setSpreadsheetTimeZone(tz);
  } catch (e) {}

  var att = newSS.getSheetByName(TARGET_SHEET_NAME);
  if (!att) att = newSS.insertSheet(TARGET_SHEET_NAME);
  att.clear();
  att.getRange(1,1,1,4).setValues([['StudentID','Name','Total','Attendance %']]);

  if (DEFAULT_FOLDER_ID) {
    try {
      var file = DriveApp.getFileById(newSS.getId());
      var folder = DriveApp.getFolderById(DEFAULT_FOLDER_ID);
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    } catch (err) {}
  }

  var nowIso = Utilities.formatDate(new Date(), mapSS.getSpreadsheetTimeZone() || Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss'Z'");
  mapSheet.appendRow([classId || '', className || '', newSS.getId(), nowIso, 'Y', 'auto-created by router']);
  cache.put(cacheKey, newSS.getId(), 300);
  return newSS.getId();
}

/******** Store student attendance (unchanged except defensive check) *********/
function storeAttendanceInSpreadsheet(spreadsheetId, payload, classId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (detectTeacherPayload(payload)) {
      lock.releaseLock();
      return storeTeacherAttendanceInSpreadsheet(spreadsheetId, payload, classId);
    }

    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(TARGET_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(TARGET_SHEET_NAME);
      sheet.getRange(1,1,1,3).setValues([['StudentID','Name','Total']]);
    }
    var tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone();

    var scanId = payload.scanId || ('srv-' + (new Date()).getTime() + '-' + Math.floor(Math.random()*10000));
    var props = PropertiesService.getScriptProperties();
    var dedupeKey = 'proc|' + spreadsheetId + '|' + scanId;
    if (props.getProperty(dedupeKey)) {
      lock.releaseLock();
      return { code: 200, message: "Duplicate scanId ignored" };
    }
    if (props.getKeys().length > 400) cleanupDedupeProps();
    props.setProperty(dedupeKey, '1');
    props.setProperty(dedupeKey + '-exp', '' + (new Date().getTime() + DEDUPE_TTL_MS));

    var lastRow = sheet.getLastRow();
    var ids = [], names = [];
    if (lastRow >= 2) {
      var rows = sheet.getRange(2,1, lastRow-1, 3).getValues();
      for (var i=0;i<rows.length;i++){
        ids.push(String(rows[i][0] || '').trim());
        names.push(String(rows[i][1] || '').trim());
      }
    }

    var studentId = (payload.studentId || payload.student || '').toString().trim();
    var studentName = (payload.student || payload.name || '').toString().trim();
    var rowIndex = -1;
    if (studentId) {
      for (var r=0;r<ids.length;r++) if (ids[r] === studentId) { rowIndex = r + 2; break; }
    }
    if (rowIndex === -1 && studentName) {
      for (var r=0;r<names.length;r++) if (names[r] === studentName) { rowIndex = r + 2; break; }
    }

    if (rowIndex === -1) {
      rowIndex = sheet.getLastRow() + 1;
      sheet.getRange(rowIndex, 1).setValue(studentId || '');
      sheet.getRange(rowIndex, 2).setValue(studentName || '');
      sheet.getRange(rowIndex, 3).setValue(0);
    } else {
      var existingId = (sheet.getRange(rowIndex,1).getValue() || '').toString().trim();
      if (!existingId && studentId) sheet.getRange(rowIndex,1).setValue(studentId);
      var existingName = (sheet.getRange(rowIndex,2).getValue() || '').toString().trim();
      if (!existingName && studentName) sheet.getRange(rowIndex,2).setValue(studentName);
    }

    var dateIso = (payload.date || '').toString().trim();
    if (!dateIso && payload.ts) {
      var d = new Date(payload.ts);
      if (!isNaN(d.getTime())) dateIso = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    }
    if (!dateIso) dateIso = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    ensureAttendancePercentHeader(sheet);
    var lastCol = sheet.getLastColumn();
    var dateCol = -1;
    if (lastCol >= DATE_COL_START) {
      var headers = sheet.getRange(1,1,1,lastCol).getValues()[0];
      for (var c = DATE_COL_START; c <= lastCol; c++) {
        var hv = headers[c-1];
        var norm = '';
        if (Object.prototype.toString.call(hv) === '[object Date]') norm = Utilities.formatDate(new Date(hv), tz, 'yyyy-MM-dd');
        else norm = String(hv || '').trim();
        if (norm === dateIso) { dateCol = c; break; }
      }
    }
    if (dateCol === -1) {
      dateCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, dateCol).setValue(dateIso);
    }

    var existing = sheet.getRange(rowIndex, dateCol).getDisplayValue();
    if (existing === 'Present' || existing === 'P' || existing === '✅') {
      updateTotalForRow(sheet, rowIndex);
      lock.releaseLock();
      return { code: 200, message: "Already marked for today" };
    }

    sheet.getRange(rowIndex, dateCol).setValue('Present');
    updateTotalForRow(sheet, rowIndex);

    lock.releaseLock();
    return { code: 200, message: "Marked Present" };
  } catch (err) {
    try { lock.releaseLock(); } catch(e){}
    throw err;
  }
}

/******** Store teacher attendance (unchanged) *********/
function storeTeacherAttendanceInSpreadsheet(spreadsheetId, payload, classId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName(TEACHER_SHEET_NAME);

    // Ensure headers exist and are capitalized
    var headers = ['Id','Name','Subject','Scheduled Start','Scheduled End','Date','Actual Start','Actual End'];
    if (!sheet) {
      sheet = ss.insertSheet(TEACHER_SHEET_NAME);
      sheet.getRange(1,1,1,headers.length).setValues([headers]);
    } else {
      var currentHdr = sheet.getRange(1,1,1,sheet.getLastColumn()||headers.length).getValues()[0].map(function(h){ return (h||'').toString().trim(); });
      var needFix = currentHdr.length < headers.length;
      if (!needFix) {
        for (var hi = 0; hi < headers.length; hi++) {
          if (currentHdr[hi] !== headers[hi]) { needFix = true; break; }
        }
      }
      if (needFix) {
        var dataBelow = sheet.getLastRow()>=2 ? sheet.getRange(2,1,sheet.getLastRow()-1, Math.max(sheet.getLastColumn(), headers.length)).getValues() : [];
        sheet.clear();
        sheet.getRange(1,1,1,headers.length).setValues([headers]);
        if (dataBelow.length) sheet.getRange(2,1,dataBelow.length, dataBelow[0].length).setValues(dataBelow);
      } else {
        sheet.getRange(1,1,1,headers.length).setValues([headers]);
      }
    }

    var tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone();

    var teacherId = (payload.teacherId || '').toString().trim();
    var teacherNamePayload = (payload.teacherName || payload.name || payload.teacher || '').toString().trim();
    var scanId = payload.scanId || ('srv-' + (new Date()).getTime() + '-' + Math.floor(Math.random()*10000));
    if (!teacherId && !teacherNamePayload) { lock.releaseLock(); return { code: 400, message: "Missing teacherId or teacherName" }; }

    // Dedupe
    var props = PropertiesService.getScriptProperties();
    var dedupeKey = 'proc|' + spreadsheetId + '|' + scanId;
    if (props.getProperty(dedupeKey)) {
      lock.releaseLock();
      return { code: 200, message: "Duplicate scanId ignored" };
    }
    if (props.getKeys().length > 400) cleanupDedupeProps();
    props.setProperty(dedupeKey, '1');
    props.setProperty(dedupeKey + '-exp', '' + (new Date().getTime() + DEDUPE_TTL_MS));

    // Determine event timestamp & formatted date/time
    var tsRaw = (payload.ts || '').toString().trim();
    var eventTs = new Date();
    if (tsRaw) {
      var dt = new Date(tsRaw);
      if (!isNaN(dt.getTime())) eventTs = dt;
    }
    var dateStr = Utilities.formatDate(eventTs, tz, "yyyy-MM-dd");
    var actualTimeStr = Utilities.formatDate(eventTs, tz, "HH:mm");
    var tsMinutes = eventTs.getHours()*60 + eventTs.getMinutes();

    // Timetable must exist and we will only act if we find a matching period for this teacher on that date
    var ttSheet = findSheetByName(ss, TIMETABLE_SHEET_NAME);
    if (!ttSheet) {
      lock.releaseLock();
      return { code: 200, message: "No timetable present; ignored" };
    }

    // Get periods for the week (we'll filter to the date)
    var monday = startOfWeek(new Date(), tz);
    var sunday = endOfWeek(monday);
    var periods = getTimetablePeriodsForWeek(ttSheet, monday, sunday, tz);

    // Find candidate timetable rows on the same date and for this teacher (by id or name)
    var candidates = [];
    for (var i=0;i<periods.length;i++) {
      var p = periods[i];
      if (!p) continue;
      var pDateStr = Utilities.formatDate(p.date, tz, "yyyy-MM-dd");
      if (pDateStr !== dateStr) continue;
      var pTeacherId   = (p.teacherId   || '').toString().trim().toLowerCase();
      var pTeacherName = (p.teacherName || '').toString().trim().toLowerCase();
      var payloadId    = teacherId.toString().trim().toLowerCase();

      // Primary: timetable TeacherID column matches enrolled UniqueID (correct setup)
      if (payloadId && pTeacherId && pTeacherId === payloadId) {
        candidates.push(p);
      // Secondary: timetable TeacherName column matches enrolled UniqueID
      // (handles admins who fill TeacherID column with names instead of IDs)
      } else if (payloadId && pTeacherName && pTeacherName === payloadId) {
        candidates.push(p);
      // Tertiary: payload carries a name (future-proofing) and it matches timetable name
      } else if (teacherNamePayload && pTeacherName && pTeacherName === teacherNamePayload.toString().trim().toLowerCase()) {
        candidates.push(p);
      }
    }

    if (candidates.length === 0) {
      // Log to Unmapped so this is visible rather than a silent discard
      storeUnmapped({
        classId: classId,
        type: 'teacher-no-timetable-match',
        teacherId: teacherId,
        date: dateStr,
        note: 'No timetable row matched this teacherId on this date. ' +
              'Check that the Timetable TeacherID column uses the same value as the enrolled UniqueID.'
      }, 'teacher-no-timetable-match');
      lock.releaseLock();
      return { code: 200, message: "No scheduled lesson for teacher today; ignored" };
    }

    // Infer or read explicit action
    var action = (payload.action || '').toString().toLowerCase();
    var explicitClockIn = action.indexOf('in') !== -1 || action.indexOf('start') !== -1;
    var explicitClockOut = action.indexOf('out') !== -1 || action.indexOf('end') !== -1 || action.indexOf('stop') !== -1;

    // Locate existing row for this teacher & date (if any)
    var lastRow = sheet.getLastRow();
    var targetRow = -1;
    if (lastRow >= 2) {
      var data = sheet.getRange(2,1,lastRow-1,8).getValues();
      for (var ri=0; ri<data.length; ri++) {
        var r = data[ri];
        var rId = (r[0]||'').toString().trim().toLowerCase();
        var rawDateCell = r[5];
        var rDateNorm = '';
        if (Object.prototype.toString.call(rawDateCell) === '[object Date]') rDateNorm = Utilities.formatDate(rawDateCell,tz,'yyyy-MM-dd');
        else rDateNorm = (rawDateCell||'').toString().trim();
        if (rDateNorm === dateStr && rId && teacherId && rId === teacherId.toString().trim().toLowerCase()) {
          targetRow = ri + 2;
          break;
        }
        var rName = (r[1]||'').toString().trim().toLowerCase();
        if (rDateNorm === dateStr && !rId && teacherNamePayload && rName === teacherNamePayload.toString().trim().toLowerCase()) {
          targetRow = ri + 2;
          break;
        }
      }
    }

    // Decide if this is a clock-in or clock-out
    var isClockIn = false;
    var isClockOut = false;
    if (explicitClockIn) isClockIn = true;
    else if (explicitClockOut) isClockOut = true;
    else {
      if (targetRow === -1) isClockIn = true;
      else {
        var rowVals = sheet.getRange(targetRow,1,1,8).getValues()[0];
        var aStart = (rowVals[6] || '').toString().trim();
        var aEnd   = (rowVals[7] || '').toString().trim();
        if (!aStart) isClockIn = true;
        else if (aStart && !aEnd) isClockOut = true;
        else {
          lock.releaseLock();
          return { code: 200, message: "Already clocked in/out for today; ignored" };
        }
      }
    }

    // From the candidate list, pick a period that allows this action (respecting windows).
    // If multiple, pick nearest scheduled boundary (start for clock-in, end for clock-out).
    var chosen = null;
    var bestDist = Number.MAX_SAFE_INTEGER;

    for (var j=0;j<candidates.length;j++) {
      var cand = candidates[j];
      var schedStart = (typeof cand.startMinutes === 'number') ? cand.startMinutes : null;
      var schedEnd   = (typeof cand.endMinutes === 'number') ? cand.endMinutes : null;

      if (isClockIn) {
        if (schedStart !== null && schedEnd !== null) {
          var earliestIn = schedStart - TEACHER_EARLY_WINDOW_MINUTES;
          var latestIn = schedEnd;
          if (tsMinutes < earliestIn || tsMinutes > latestIn) continue;
          var dist = Math.abs(tsMinutes - schedStart);
          if (dist < bestDist) { chosen = cand; bestDist = dist; }
        } else {
          var dist2 = 100000 + j;
          if (dist2 < bestDist) { chosen = cand; bestDist = dist2; }
        }
      } else if (isClockOut) {
        if (schedStart !== null && schedEnd !== null) {
          var earliestOut = schedStart - TEACHER_EARLY_WINDOW_MINUTES;
          var latestOut = schedEnd + TEACHER_LATE_WINDOW_MINUTES;
          if (tsMinutes < earliestOut || tsMinutes > latestOut) continue;
          var distE = Math.abs(tsMinutes - schedEnd);
          if (distE < bestDist) { chosen = cand; bestDist = distE; }
        } else {
          var dist3 = 100000 + j;
          if (dist3 < bestDist) { chosen = cand; bestDist = dist3; }
        }
      } else {
        continue;
      }
    }

    if (!chosen) {
      lock.releaseLock();
      return { code: 200, message: "No matching scheduled period in allowed windows; ignored" };
    }

    var schedStartChosen = (typeof chosen.startMinutes === 'number') ? chosen.startMinutes : null;
    var schedEndChosen   = (typeof chosen.endMinutes === 'number') ? chosen.endMinutes : null;

    if (isClockIn && schedEndChosen !== null && tsMinutes > schedEndChosen) {
      lock.releaseLock();
      return { code: 200, message: "Clock-in after scheduled end; ignored" };
    }

    if (isClockIn && schedStartChosen !== null) {
      var earliestIn2 = schedStartChosen - TEACHER_EARLY_WINDOW_MINUTES;
      if (tsMinutes < earliestIn2) {
        lock.releaseLock();
        return { code: 200, message: "Clock-in too early; ignored" };
      }
    }

    if (isClockOut && schedEndChosen !== null) {
      var latestOut2 = schedEndChosen + TEACHER_LATE_WINDOW_MINUTES;
      if (tsMinutes > latestOut2) {
        lock.releaseLock();
        return { code: 200, message: "Clock-out too late; ignored" };
      }
    }

    var writeName = chosen.teacherName || teacherNamePayload || '';
    var writeSubject = chosen.subject || '';
    var writeScheduledStart = (schedStartChosen !== null) ? minutesToHHMM(schedStartChosen) : (chosen.startText || '');
    var writeScheduledEnd   = (schedEndChosen !== null) ? minutesToHHMM(schedEndChosen)   : (chosen.endText || '');

    lastRow = sheet.getLastRow();
    targetRow = -1;
    if (lastRow >= 2) {
      var data2 = sheet.getRange(2,1,lastRow-1,8).getValues();
      for (var ri2=0; ri2<data2.length; ri2++) {
        var r2 = data2[ri2];
        var rId2 = (r2[0]||'').toString().trim().toLowerCase();
        var rawDateCell2 = r2[5];
        var rDateNorm2 = '';
        if (Object.prototype.toString.call(rawDateCell2) === '[object Date]') rDateNorm2 = Utilities.formatDate(rawDateCell2,tz,'yyyy-MM-dd');
        else rDateNorm2 = (rawDateCell2||'').toString().trim();
        if (rDateNorm2 === dateStr && rId2 && teacherId && rId2 === teacherId.toString().trim().toLowerCase()) {
          targetRow = ri2 + 2;
          break;
        }
        var rName2 = (r2[1]||'').toString().trim().toLowerCase();
        if (rDateNorm2 === dateStr && !rId2 && teacherNamePayload && rName2 === teacherNamePayload.toString().trim().toLowerCase()) {
          targetRow = ri2 + 2;
          break;
        }
      }
    }

    if (targetRow === -1) {
      if (isClockIn) {
        sheet.appendRow([teacherId || '', writeName, writeSubject, writeScheduledStart, writeScheduledEnd, dateStr, actualTimeStr, '']);
        lock.releaseLock();
        return { code: 200, message: "Teacher Actual Start recorded (new row)" };
      } else if (isClockOut) {
        sheet.appendRow([teacherId || '', writeName, writeSubject, writeScheduledStart, writeScheduledEnd, dateStr, '', actualTimeStr]);
        lock.releaseLock();
        return { code: 200, message: "Teacher Actual End recorded (new row without start)" };
      }
    } else {
      var rowVals = sheet.getRange(targetRow,1,1,8).getValues()[0];
      var aStart = (rowVals[6] || '').toString().trim();
      var aEnd   = (rowVals[7] || '').toString().trim();

      if ((!rowVals[1] || rowVals[1].toString().trim() === '') && writeName) sheet.getRange(targetRow,2).setValue(writeName);
      if ((!rowVals[2] || rowVals[2].toString().trim() === '') && writeSubject) sheet.getRange(targetRow,3).setValue(writeSubject);
      if ((!rowVals[3] || rowVals[3].toString().trim() === '') && writeScheduledStart) sheet.getRange(targetRow,4).setValue(writeScheduledStart);
      if ((!rowVals[4] || rowVals[4].toString().trim() === '') && writeScheduledEnd) sheet.getRange(targetRow,5).setValue(writeScheduledEnd);
      if ((!rowVals[5] || rowVals[5].toString().trim() === '') && dateStr) sheet.getRange(targetRow,6).setValue(dateStr);

      if (isClockIn && !aStart) {
        sheet.getRange(targetRow,7).setValue(actualTimeStr);
        lock.releaseLock();
        return { code: 200, message: "Teacher Actual Start filled" };
      } else if (isClockOut && !aEnd) {
        sheet.getRange(targetRow,8).setValue(actualTimeStr);
        lock.releaseLock();
        return { code: 200, message: "Teacher Actual End filled" };
      } else {
        lock.releaseLock();
        return { code: 200, message: "Already clocked in/out for today; ignored" };
      }
    }

    lock.releaseLock();
    return { code: 200, message: "No action taken" };

  } catch (err) {
    try { lock.releaseLock(); } catch (e) {}
    throw err;
  }
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

/******** Helper: find sheet by name (case-insensitive) *********/
function findSheetByName(ss, name) {
  if (!name) return null;
  name = name.toString().trim().toLowerCase();
  var sheets = ss.getSheets();
  for (var i=0;i<sheets.length;i++) {
    if ((sheets[i].getName()||'').toString().trim().toLowerCase() === name) return sheets[i];
  }
  return null;
}

/******** Timetable: get periods for the week (unchanged logic) *********/
function getTimetablePeriodsForWeek(ttSheet, monday, sunday, tz) {
  try {
    const values = ttSheet.getDataRange().getValues();
    if (!values || values.length < 2) return [];

    const headers = values[0].map(h => (h||'').toString().trim().toLowerCase());
    const idx = function(possibleNames) {
      for (let i=0;i<possibleNames.length;i++){
        const pn = possibleNames[i].toString().trim().toLowerCase();
        for (let c=0;c<headers.length;c++) if (headers[c] === pn) return c;
      }
      return -1;
    };

    const dayCol = idx(['day','weekday']);
    const dateCol = idx(['date']);
    const startCol = idx(['start','starttime','from','scheduled start']);
    const endCol = idx(['end','endtime','to','scheduled end']);
    const subjectCol = idx(['subject','topic']);
    const teacherCol = idx(['teacherid','teacher_id','teacher','teacher name','teachername']);
    const teacherNameCol = idx(['teachername','teacher_name','name','teacher']);

    const mondayOnly = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
    const sundayOnly = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate());

    const out = [];

    for (let r=1; r<values.length; r++) {
      const row = values[r];

      let rowDate = null;

      if (dateCol >= 0) {
        const cell = row[dateCol];
        if (Object.prototype.toString.call(cell) === '[object Date]') {
          const candidate = new Date(cell.getFullYear(), cell.getMonth(), cell.getDate());
          if (candidate.getTime() >= mondayOnly.getTime() && candidate.getTime() <= sundayOnly.getTime()) {
            rowDate = candidate;
          } else {
            continue;
          }
        } else {
          const s = (cell||'').toString().trim();
          if (s) {
            const dt = new Date(s);
            if (!isNaN(dt.getTime())) {
              const candidate = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
              if (candidate.getTime() >= mondayOnly.getTime() && candidate.getTime() <= sundayOnly.getTime()) {
                rowDate = candidate;
              } else {
                continue;
              }
            }
          }
        }
      }

      if (!rowDate && dayCol >= 0) {
        const dv = (row[dayCol]||'').toString().trim();
        if (dv) {
          const dvNorm = dv.toString().trim().toLowerCase();
          const dvNum = parseInt(dvNorm, 10);
          let targetDate = null;
          if (!isNaN(dvNum)) {
            const dayOffset = dvNum - 1; // 0..6 (1=Mon)
            if (dayOffset >=0 && dayOffset <=6) {
              targetDate = new Date(mondayOnly);
              targetDate.setDate(mondayOnly.getDate() + dayOffset);
              rowDate = targetDate;
            }
          } else {
            for (let d=0; d<7; d++) {
              const candidate = new Date(mondayOnly);
              candidate.setDate(mondayOnly.getDate() + d);
              const candNameLong = Utilities.formatDate(candidate, tz, 'EEEE').toString().toLowerCase();
              const candShort = Utilities.formatDate(candidate, tz, 'EEE').toString().toLowerCase();
              if (dvNorm === candNameLong || dvNorm === candShort || dvNorm.substr(0,3) === candShort.substr(0,3)) {
                rowDate = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());
                break;
              }
            }
          }
        }
      }

      if (!rowDate) continue; // can't find a date in this week for this timetable row

      const teacherId = (teacherCol >= 0 ? row[teacherCol] : '') || '';
      const teacherName = (teacherNameCol >= 0 ? row[teacherNameCol] : '') || '';
      const subject = (subjectCol >= 0 ? row[subjectCol] : '') || '';

      const startText = (startCol >= 0 ? row[startCol] : '') || '';
      const endText = (endCol >= 0 ? row[endCol] : '') || '';
      const startMinutes = parseTimeCellToMinutes(startText, tz);
      const endMinutes = parseTimeCellToMinutes(endText, tz);

      out.push({
        teacherId: (teacherId||'').toString().trim(),
        teacherName: (teacherName||'').toString().trim(),
        subject: (subject||'').toString().trim(),
        date: new Date(rowDate.getFullYear(), rowDate.getMonth(), rowDate.getDate()),
        startMinutes: startMinutes,
        endMinutes: endMinutes,
        startText: (startText||'').toString().trim(),
        endText: (endText||'').toString().trim()
      });
    }

    return out;
  } catch (e) {
    return [];
  }
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

/******** minutes -> HH:mm helper *********/
function minutesToHHMM(minutes) {
  if (minutes === null || minutes === undefined) return '';
  var hh = Math.floor(minutes / 60);
  var mm = minutes % 60;
  if (hh < 0) hh = 0;
  if (hh > 23) hh = hh % 24;
  var hhStr = (hh < 10 ? '0' + hh : '' + hh);
  var mmStr = (mm < 10 ? '0' + mm : '' + mm);
  return hhStr + ':' + mmStr;
}

/******** Helper: formatTimeOnly(value, tz)
 * - Accepts Date objects, strings like "HH:mm", numeric Excel time, or a minutes integer.
 * - Returns "HH:mm" string or empty string.
 */
function formatTimeOnly(value, tz) {
  if (value === null || value === undefined || value === '') return '';
  // If it's a Date object:
  if (Object.prototype.toString.call(value) === '[object Date]') {
    try { return Utilities.formatDate(value, tz || Session.getScriptTimeZone(), 'HH:mm'); } catch(e){ return ''; }
  }
  // If it's numeric minutes
  if (typeof value === 'number') return minutesToHHMM(value);
  var s = value.toString().trim();
  // If looks like an Excel/serial number
  var n = parseFloat(s);
  if (!isNaN(n) && s.indexOf(':') === -1) {
    // treat as day-fraction
    var mins = Math.round(n * 24 * 60);
    return minutesToHHMM(mins);
  }
  // If contains colon, assume HH:mm or HH:mm:ss
  if (s.indexOf(':') !== -1) {
    var parts = s.split(':');
    var hh = parseInt(parts[0],10) || 0;
    var mm = parseInt(parts[1],10) || 0;
    hh = (hh < 10 ? '0'+hh : ''+hh);
    mm = (mm < 10 ? '0'+mm : ''+mm);
    return hh + ':' + mm;
  }
  // Try to parse as Date string
  var dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    try { return Utilities.formatDate(dt, tz || Session.getScriptTimeZone(), 'HH:mm'); } catch(e){ return s; }
  }
  return s;
}

/******** updateTotalForRow — writes Total (col 3) and Attendance % (col 4) *********/
// Column layout: StudentID(1) | Name(2) | Total(3) | Attendance %(4) | date1(5) | date2(6) ...
var DATE_COL_START = 5; // date columns start at column 5

function ensureAttendancePercentHeader(sheet) {
  // If col 4 header is not 'Attendance %', insert the column
  var lastCol = sheet.getLastColumn();
  if (lastCol < 4) return; // nothing to fix yet
  var h4 = (sheet.getRange(1, 4).getValue() || '').toString().trim();
  if (h4 === 'Attendance %') return; // already correct
  // Insert a column at position 4 and label it
  sheet.insertColumnAfter(3);
  sheet.getRange(1, 4).setValue('Attendance %');
  // DATE_COL_START is now 5, which is correct — existing date columns shifted right automatically
}

function updateTotalForRow(sheet, rowIndex) {
  // Ensure the Attendance % column exists
  ensureAttendancePercentHeader(sheet);

  var lastCol = sheet.getLastColumn();
  if (lastCol < DATE_COL_START) {
    // No date columns yet
    sheet.getRange(rowIndex, 3).setValue(0);
    sheet.getRange(rowIndex, 4).setValue('0%');
    return;
  }
  var numDateCols = lastCol - DATE_COL_START + 1;
  var vals = sheet.getRange(rowIndex, DATE_COL_START, 1, numDateCols).getValues()[0];
  var cnt = 0;
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (v === 'Present' || v === 'P' || v === '✅') cnt++;
  }
  // Count how many date header cells are non-empty (fair denominator)
  var headerVals = sheet.getRange(1, DATE_COL_START, 1, numDateCols).getValues()[0];
  var totalDays = 0;
  for (var j = 0; j < headerVals.length; j++) {
    if (headerVals[j] !== '' && headerVals[j] !== null && headerVals[j] !== undefined) totalDays++;
  }
  sheet.getRange(rowIndex, 3).setValue(cnt);
  var pct = totalDays > 0 ? Math.round(cnt / totalDays * 100) + '%' : '0%';
  sheet.getRange(rowIndex, 4).setValue(pct);
}

/******** storeUnmapped & maintenance (unchanged) *********/
function storeUnmapped(payload, reason) {
  try {
    var mapSS = SpreadsheetApp.openById(CLASSMAP_SPREADSHEET_ID);
    var logSheet = mapSS.getSheetByName('Unmapped');
    if (!logSheet) {
      logSheet = mapSS.insertSheet('Unmapped');
      logSheet.appendRow(['ReceivedAt','Reason','ClassId','ClassName','Type','ScanId','StudentId','Student','Raw']);
    }
    var tz = mapSS.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
    var nowIso = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss'Z'");
    var row = [
      nowIso,
      reason || '',
      payload.classId || '',
      payload.className || '',
      payload.type || '',
      payload.scanId || '',
      payload.studentId || '',
      payload.student || '',
      JSON.stringify(payload.raw || payload)
    ];
    logSheet.appendRow(row);
  } catch (e) {
    var p = PropertiesService.getScriptProperties();
    p.setProperty('unmapped.' + new Date().getTime(), reason + ' : ' + JSON.stringify(payload));
  }
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
  // Also purge unmapped log entries older than 7 days
  var sevenDaysAgo = now - (7 * 24 * 3600 * 1000);
  for (var j = 0; j < keys.length; j++) {
    if (keys[j].startsWith('unmapped.')) {
      var ts = parseInt(keys[j].substring(9), 10);
      if (!isNaN(ts) && ts < sevenDaysAgo) {
        props.deleteProperty(keys[j]);
      }
    }
  }
}

/******** Helper: getTeacherActualTimes(teacherSheet, teacherId, teacherName, dateStr, tz)
 * Returns { actualStart: 'HH:mm' or '', actualEnd: 'HH:mm' or '', actualStartMinutes: n|null, actualEndMinutes: n|null }
 * This function carefully formats any Date cells into HH:mm so weekly summaries never show full Date objects.
 */
function getTeacherActualTimes(teacherSheet, teacherId, teacherName, dateStr, tz) {
  if (!teacherSheet) return null;
  try {
    const lastRow = teacherSheet.getLastRow();
    if (lastRow < 2) return null;
    const data = teacherSheet.getRange(2,1,lastRow-1,8).getValues();
    const searchId = (teacherId || '').toString().trim().toLowerCase();
    const searchName = (teacherName || '').toString().trim().toLowerCase();

    for (let i=0;i<data.length;i++) {
      const r = data[i];
      const rId = (r[0]||'').toString().trim().toLowerCase();
      const rName = (r[1]||'').toString().trim().toLowerCase();

      if (searchId && rId !== searchId) continue;
      if (!searchId && searchName && rName !== searchName) continue;

      // normalize date cell
      const rawDateCell = r[5];
      let rDateNorm = '';
      if (Object.prototype.toString.call(rawDateCell) === '[object Date]') {
        rDateNorm = Utilities.formatDate(rawDateCell, tz, 'yyyy-MM-dd');
      } else {
        rDateNorm = (rawDateCell || '').toString().trim();
      }
      if (rDateNorm !== dateStr) continue;

      // Actual start/end cells may be Date objects in sheet or strings
      const rawActualStartCell = r[6];
      const rawActualEndCell   = r[7];

      var actualStart = '';
      var actualEnd = '';
      var asMin = null;
      var aeMin = null;

      if (Object.prototype.toString.call(rawActualStartCell) === '[object Date]') {
        actualStart = Utilities.formatDate(rawActualStartCell, tz, 'HH:mm');
        asMin = rawActualStartCell.getHours()*60 + rawActualStartCell.getMinutes();
      } else {
        actualStart = (rawActualStartCell || '').toString().trim();
        asMin = actualStart ? parseTimeCellToMinutes(actualStart, tz) : null;
      }

      if (Object.prototype.toString.call(rawActualEndCell) === '[object Date]') {
        actualEnd = Utilities.formatDate(rawActualEndCell, tz, 'HH:mm');
        aeMin = rawActualEndCell.getHours()*60 + rawActualEndCell.getMinutes();
      } else {
        actualEnd = (rawActualEndCell || '').toString().trim();
        aeMin = actualEnd ? parseTimeCellToMinutes(actualEnd, tz) : null;
      }

      return { actualStart: actualStart||'', actualEnd: actualEnd||'', actualStartMinutes: asMin, actualEndMinutes: aeMin };
    }
    return null;
  } catch (e) {
    return null;
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

/******** Initialize all class sheets from ClassMap *********/
/*
  Run this manually from the Apps Script editor (Run > initializeAllClassSheets) 
  before deployment or after adding new classes to ClassMap.
  
  For each active class in ClassMap, creates the following sheets if missing:
    - Attendance       : StudentID | Name | Total | Attendance %
    - TeacherAttendance: Id | Name | Subject | Scheduled Start | Scheduled End | Date | Actual Start | Actual End
    - Enrollment       : FingerID | UniqueID | Name | Role | Command | Status | Note | CreatedAt
    - Timetable        : Day | Date | Start | End | Subject | TeacherID | TeacherName
  
  Safe to re-run: never overwrites existing data, only creates missing sheets/headers.
*/
function initializeAllClassSheets() {
  var mapSS = SpreadsheetApp.openById(CLASSMAP_SPREADSHEET_ID);
  var mapSheet = mapSS.getSheetByName(CLASSMAP_SHEET_NAME);
  if (!mapSheet) {
    Logger.log('ClassMap sheet not found. Nothing to initialize.');
    return;
  }

  var tz = mapSS.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  var rows = mapSheet.getDataRange().getValues();
  var results = [];

  for (var i = 1; i < rows.length; i++) {
    var classId   = (rows[i][0] || '').toString().trim();
    var className = (rows[i][1] || '').toString().trim();
    var sheetId   = (rows[i][2] || '').toString().trim();
    var active    = (rows[i][4] || 'Y').toString().trim().toUpperCase();

    if (!sheetId) { results.push('Row ' + (i+1) + ': skipped (no spreadsheetId)'); continue; }
    if (active === 'N') { results.push(classId + ': skipped (inactive)'); continue; }

    try {
      var ss = SpreadsheetApp.openById(sheetId);
      ss.setSpreadsheetTimeZone(tz);
      var log = [];

      // ── Attendance sheet ──────────────────────────────────────────
      var attSheet = ss.getSheetByName(TARGET_SHEET_NAME);
      if (!attSheet) {
        attSheet = ss.insertSheet(TARGET_SHEET_NAME);
        attSheet.getRange(1, 1, 1, 4).setValues([['StudentID', 'Name', 'Total', 'Attendance %']]);
        var attHdr = attSheet.getRange(1, 1, 1, 4);
        attHdr.setFontWeight('bold');
        attHdr.setBackground('#4a86e8');
        attHdr.setFontColor('#ffffff');
        attSheet.setFrozenRows(1);
        attSheet.setColumnWidth(1, 110);
        attSheet.setColumnWidth(2, 160);
        attSheet.setColumnWidth(3, 60);
        attSheet.setColumnWidth(4, 110);
        log.push('Attendance created');
      } else {
        ensureAttendancePercentHeader(attSheet);
        log.push('Attendance exists');
      }

      // ── TeacherAttendance sheet ───────────────────────────────────
      var taHeaders = ['Id', 'Name', 'Subject', 'Scheduled Start', 'Scheduled End', 'Date', 'Actual Start', 'Actual End'];
      var taSheet = ss.getSheetByName(TEACHER_SHEET_NAME);
      if (!taSheet) {
        taSheet = ss.insertSheet(TEACHER_SHEET_NAME);
        taSheet.getRange(1, 1, 1, taHeaders.length).setValues([taHeaders]);
        var taHdr = taSheet.getRange(1, 1, 1, taHeaders.length);
        taHdr.setFontWeight('bold');
        taHdr.setBackground('#0f9d58');
        taHdr.setFontColor('#ffffff');
        taSheet.setFrozenRows(1);
        taSheet.setColumnWidth(1, 100); // Id
        taSheet.setColumnWidth(2, 150); // Name
        taSheet.setColumnWidth(3, 130); // Subject
        taSheet.setColumnWidth(4, 120); // Scheduled Start
        taSheet.setColumnWidth(5, 120); // Scheduled End
        taSheet.setColumnWidth(6, 100); // Date
        taSheet.setColumnWidth(7, 100); // Actual Start
        taSheet.setColumnWidth(8, 100); // Actual End
        log.push('TeacherAttendance created');
      } else {
        log.push('TeacherAttendance exists');
      }

      // ── Enrollment sheet ─────────────────────────────────────────
      var enrollSheet = ss.getSheetByName(ENROLL_SHEET_NAME);
      if (!enrollSheet) {
        ensureEnrollSheet(ss); // reuse existing function which handles headers + formatting
        log.push('Enrollment created');
      } else {
        log.push('Enrollment exists');
      }

      // ── Timetable sheet ──────────────────────────────────────────
      // Column names must match the idx() lookups in getTimetablePeriodsForWeek:
      //   Day -> dayCol, Date -> dateCol, Start -> startCol, End -> endCol,
      //   Subject -> subjectCol, TeacherID -> teacherCol, TeacherName -> teacherNameCol
      var ttHeaders = ['Day', 'Date', 'Start', 'End', 'Subject', 'TeacherID', 'TeacherName'];
      var ttSheet = findSheetByName(ss, TIMETABLE_SHEET_NAME);
      if (!ttSheet) {
        ttSheet = ss.insertSheet(TIMETABLE_SHEET_NAME);
        ttSheet.getRange(1, 1, 1, ttHeaders.length).setValues([ttHeaders]);
        var ttHdr = ttSheet.getRange(1, 1, 1, ttHeaders.length);
        ttHdr.setFontWeight('bold');
        ttHdr.setBackground('#e69138');
        ttHdr.setFontColor('#ffffff');
        ttSheet.setFrozenRows(1);
        ttSheet.setColumnWidth(1, 90);  // Day
        ttSheet.setColumnWidth(2, 100); // Date
        ttSheet.setColumnWidth(3, 80);  // Start
        ttSheet.setColumnWidth(4, 80);  // End
        ttSheet.setColumnWidth(5, 130); // Subject
        ttSheet.setColumnWidth(6, 110); // TeacherID  <-- must match enrolled UniqueID
        ttSheet.setColumnWidth(7, 150); // TeacherName

        // Add a note on the TeacherID header cell warning admins about the constraint
        ttSheet.getRange(1, 6).setNote(
          'IMPORTANT: TeacherID must exactly match the UniqueID ' +
          'used when enrolling the teacher\'s fingerprint (e.g. TCH001). ' +
          'Do NOT use the teacher\'s name here.'
        );
        log.push('Timetable created');
      } else {
        log.push('Timetable exists');
      }

      results.push(classId + ' (' + className + '): ' + log.join(', '));

    } catch (err) {
      results.push(classId + ': ERROR — ' + err.message);
    }
  }

  Logger.log('initializeAllClassSheets complete:\n' + results.join('\n'));
  Logger.log('Run View > Logs in the Apps Script editor to see results.');
}

/******** Weekly summary (updated: includes missed teacher lessons + late/early detection) *********/
function sendWeeklyAttendanceSummaries() {
  const classMapSS = SpreadsheetApp.openById(CLASSMAP_SPREADSHEET_ID);
  const mapSheet = classMapSS.getSheetByName(CLASSMAP_SHEET_NAME);
  const rows = mapSheet.getDataRange().getValues();
  const tz = classMapSS.getSpreadsheetTimeZone() || Session.getScriptTimeZone();

  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  monday.setDate(today.getDate() - daysSinceMonday);
  // normalize monday to midnight local
  monday.setHours(0,0,0,0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23,59,59,999);

  const weekStartStr = Utilities.formatDate(monday, tz, "MMM d, yyyy");
  const weekEndStr = Utilities.formatDate(sunday, tz, "MMM d, yyyy");

  let summaries = [];

  for (let i = 1; i < rows.length; i++) {
    const [classId, className, sheetId, createdAt, active] = rows[i];
    if (!sheetId || (active && active.toString().toUpperCase() === "N")) continue;

    try {
      const ss = SpreadsheetApp.openById(sheetId);

      /* ---------- Student summary (unchanged) ---------- */
      const sheet = ss.getSheetByName(TARGET_SHEET_NAME);
      let studentSummaryHTML = '';
      if (sheet) {
        const data = sheet.getDataRange().getValues();
        if (data && data.length >= 2) {
          const headers = data[0];
          const students = data.slice(1);

          const weekDates = [];
          for (let c = DATE_COL_START - 1; c < headers.length; c++) {
            let headerDate = headers[c];
            if (!(headerDate instanceof Date)) headerDate = new Date(headerDate);
            if (!isNaN(headerDate)) {
              const dateOnly = new Date(headerDate.getFullYear(), headerDate.getMonth(), headerDate.getDate());
              const mondayOnly = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate());
              const sundayOnly = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate());
              if (dateOnly.getTime() >= mondayOnly.getTime() && dateOnly.getTime() <= sundayOnly.getTime()) {
                weekDates.push({ col: c, date: dateOnly });
              }
            }
          }

          if (weekDates.length > 0) {
            let absences = [];
            let allPresent = true;

            for (const rowData of students) {
              const name = rowData[1] || "(Unnamed)";
              let missedDays = [];

              for (const { col, date } of weekDates) {
                const val = (rowData[col] || "").toString().trim().toLowerCase();
                if (!(val === "present" || val === "p" || val === "✅" || val === "yes")) {
                  const weekday = Utilities.formatDate(date, tz, "EEEE");
                  missedDays.push(weekday);
                  allPresent = false;
                }
              }

              if (missedDays.length > 0) {
                absences.push(`<li>${name} was absent on ${missedDays.join(", ")}.</li>`);
              }
            }

            const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
            if (allPresent) {
              studentSummaryHTML = `
                <h3>📘 ${className}</h3>
                <ul><li>All students were present every day this week.</li></ul>
                <p><a href="${sheetUrl}" target="_blank">🔗 View Sheet</a></p>
              `;
            } else {
              studentSummaryHTML = `
                <h3>📘 ${className}</h3>
                <ul>
                  ${absences.join("\n")}
                  <li>All other students were present.</li>
                </ul>
                <p><a href="${sheetUrl}" target="_blank">🔗 View Sheet</a></p>
              `;
            }
          } // else: no date columns in that week => skip student summary
        } // else: no student rows => skip
      } // else: no student sheet => skip

      /* ---------- Teacher missed/late/early detection ---------- */
      let teacherIssuesHTML = '';
      const ttSheet = findSheetByName(ss, TIMETABLE_SHEET_NAME);
      const teacherSheet = ss.getSheetByName(TEACHER_SHEET_NAME);

      if (ttSheet) {
        const periods = getTimetablePeriodsForWeek(ttSheet, monday, sunday, tz);

        const missed = [];
        const lateStarts = [];
        const earlyEnds = [];

        for (let p of periods) {
          if (!p) continue;
          // require at least teacher id or name
          const teacherIdToCheck = (p.teacherId || '').toString().trim();
          const teacherNameToCheck = (p.teacherName || '').toString().trim();
          const dateStr = Utilities.formatDate(p.date, tz, "yyyy-MM-dd");

          // fetch actuals from teacher sheet (if present)
          const actual = getTeacherActualTimes(teacherSheet, teacherIdToCheck, teacherNameToCheck, dateStr, tz);

          const schedStart = (typeof p.startMinutes === 'number') ? p.startMinutes : null;
          const schedEnd   = (typeof p.endMinutes === 'number') ? p.endMinutes : null;

          if (!actual || !actual.actualStart) {
            // no clock-in -> missed lesson
            missed.push({
              teacherId: p.teacherId || '',
              teacherName: p.teacherName || '',
              subject: p.subject || '',
              date: p.date,
              dateStr: dateStr,
              start: (schedStart !== null) ? minutesToHHMM(schedStart) : (p.startText||''),
              end: (schedEnd !== null) ? minutesToHHMM(schedEnd) : (p.endText||'')
            });
            continue;
          }

          // actual start exists -> check lateness if we have scheduled start
          if (schedStart !== null && actual.actualStartMinutes !== null) {
            var diffStart = actual.actualStartMinutes - schedStart; // positive => late
            if (diffStart > LATE_GRACE_MINUTES) {
              lateStarts.push({
                teacherId: p.teacherId || '',
                teacherName: p.teacherName || '',
                subject: p.subject || '',
                date: p.date,
                dateStr: dateStr,
                scheduled: minutesToHHMM(schedStart),
                actual: formatTimeOnly(actual.actualStart, tz)
              });
            }
          }

          // check early end if actualEnd present and scheduled end present
          if (schedEnd !== null && actual.actualEndMinutes !== null) {
            var diffEnd = schedEnd - actual.actualEndMinutes; // positive => ended early
            if (diffEnd > EARLY_GRACE_MINUTES) {
              earlyEnds.push({
                teacherId: p.teacherId || '',
                teacherName: p.teacherName || '',
                subject: p.subject || '',
                date: p.date,
                dateStr: dateStr,
                scheduled: minutesToHHMM(schedEnd),
                actual: formatTimeOnly(actual.actualEnd, tz)
              });
            }
          }
        }

        // Build HTML for issues
        const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
        const blocks = [];

        if (missed.length > 0) {
          let lines = missed.map(m => {
            const namePart = m.teacherName ? `${m.teacherName} (${m.teacherId || '-'})` : (m.teacherId || '(unknown)');
            const subj = m.subject ? ` | ${m.subject}` : '';
            const timeRange = (m.start || m.end) ? ` | ${m.start || ''}${(m.start && m.end) ? '–' : ''}${m.end || ''}` : '';
            const when = Utilities.formatDate(m.date, tz, "EEE, MMM d");
            return `<li>${namePart}${subj} — ${when}${timeRange}</li>`;
          });
          blocks.push(`
            <h4>❌ Missed Lessons (${missed.length})</h4>
            <ul>
              ${lines.join("\n")}
            </ul>
          `);
        }

        if (lateStarts.length > 0) {
          let lines = lateStarts.map(m => {
            const namePart = m.teacherName ? `${m.teacherName} (${m.teacherId || '-'})` : (m.teacherId || '(unknown)');
            const subj = m.subject ? ` | ${m.subject}` : '';
            const when = Utilities.formatDate(m.date, tz, "EEE, MMM d");
            return `<li>${namePart}${subj} — ${when} | Scheduled ${m.scheduled} | Started ${m.actual}</li>`;
          });
          blocks.push(`
            <h4>🚨 Late Starts (${lateStarts.length})</h4>
            <ul>
              ${lines.join("\n")}
            </ul>
          `);
        }

        if (earlyEnds.length > 0) {
          let lines = earlyEnds.map(m => {
            const namePart = m.teacherName ? `${m.teacherName} (${m.teacherId || '-'})` : (m.teacherId || '(unknown)');
            const subj = m.subject ? ` | ${m.subject}` : '';
            const when = Utilities.formatDate(m.date, tz, "EEE, MMM d");
            return `<li>${namePart}${subj} — ${when} | Scheduled ${m.scheduled} | Ended ${m.actual}</li>`;
          });
          blocks.push(`
            <h4>⚠️ Early Endings (${earlyEnds.length})</h4>
            <ul>
              ${lines.join("\n")}
            </ul>
          `);
        }

        if (blocks.length > 0) {
          teacherIssuesHTML = `
            <h3>📗 ${className} — Teacher attendance issues</h3>
            ${blocks.join("\n<hr style='border:0; border-top:1px solid #eee; margin:8px 0;'>")}
            <p><a href="${sheetUrl}" target="_blank">🔗 View Class Sheets</a></p>
          `;
        }

      } // end timetable exists

      // Merge student + teacher parts for this class into a single block
      const classBlock = (studentSummaryHTML || teacherIssuesHTML) ? `
        <section style="margin-bottom:18px;">
          ${studentSummaryHTML}
          ${teacherIssuesHTML}
        </section>
      ` : `<section style="margin-bottom:18px;"><h3>📘 ${className}</h3><p>No attendance data this week.</p></section>`;

      summaries.push(classBlock);

    } catch (err) {
      summaries.push(`<p>❌ Error in ${className || classId}: ${err.message}</p>`);
    }
  }

  if (summaries.length === 0) {
    Logger.log("No valid attendance data found this week.");
    return;
  }

  const htmlBody = `
    <div style="font-family:Arial, sans-serif; line-height:1.6;">
      <p>Hello,</p>
      <p>Here's the attendance summary for the week of <strong>${weekStartStr} – ${weekEndStr}</strong>:</p>
      ${summaries.join("<hr style='border:0; border-top:1px solid #ccc; margin:20px 0;'>")}
      <p style="margin-top:30px;">Best regards,<br>Automated Attendance System</p>
    </div>
  `;

  // Send email to all admin addresses
  const emailSubject = `📅 Weekly Attendance Summary (${weekStartStr} – ${weekEndStr})`;
  
  // Collect XLSX attachments for each active class
  var attachments = [];
  for (let i = 1; i < rows.length; i++) {
    const [classId, className, sheetId, , active] = rows[i];
    if (!sheetId || (active && active.toString().toUpperCase() === "N")) continue;
    try {
      var blob = exportAttendanceSheetAsXlsx(sheetId);
      if (blob) {
        blob.setName((className || classId).replace(/[\/\\:*?"<>|]/g, '_') + " - Attendance.xlsx");
        attachments.push(blob);
      }
    } catch(e) {
      Logger.log("Could not export XLSX for " + (className || classId) + ": " + e.message);
    }
  }

  for (const email of adminEmails) {
    if (email && email.trim()) {
      MailApp.sendEmail({
        to: email.trim(),
        subject: emailSubject,
        htmlBody: htmlBody,
        attachments: attachments
      });
    }
  }

  Logger.log(`Weekly summary email sent successfully to ${adminEmails.length} admin(s).`);
}
