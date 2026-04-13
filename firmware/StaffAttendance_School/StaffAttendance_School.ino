/*
  ESP32 Staff Attendance Device — R503 fingerprint edition (dual-core, FreeRTOS)
  Single-school deployment: all scans go to one Apps Script endpoint.

  Features
  ────────
  • Fingerprint scan → Time-In / Time-Out recorded in Google Sheets via Apps Script
  • Enrollment polling: Apps Script pushes register/delete/clearall jobs; device executes them
  • Master fingerprint: single scan launches the WiFi captive portal (AP mode)
  • WiFi credentials stored in SPIFFS — no hardcoded passwords
  • Offline queue: scans cached in SPIFFS when WiFi is unavailable, flushed on reconnect
  • RTC (DS3231) keeps accurate time; synced from NTP whenever WiFi is available
  • Per-finger scan cooldown prevents duplicate Time-In/Out records within the cooldown window

  IMPORTANT: Edit SCHOOL_ID, SCRIPT_URL, and SCRIPT_AUTH before flashing.
*/

/* ═══════════════════ CONFIG — EDIT BEFORE FLASHING ═══════════════════ */

// Apps Script web app URL (deploy as "Anyone" access)
const char* SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzPcU3_GV_YYVB5PWxsgtYRCfl9wgzN1F7tz2WJqynfUjmBEZ87ozmWJ5vgIu0_gSD9VQ/exec";

// Must match SCRIPT_AUTH_KEY in Apps Script; leave empty if auth is disabled
const char* SCRIPT_AUTH = "";

// School identity — sent with every attendance scan payload
const char* SCHOOL_ID   = "DDA";       // short unique identifier, e.g. "KUMASI-ACADEMY"
const char* SCHOOL_NAME = "D and D Academy";   // human-readable name used in logs

/* Fingerprint sensor UART pins — adjust to match your wiring */
#define R503_RX_PIN 16   // ESP32 RX ← sensor TX
#define R503_TX_PIN 17   // ESP32 TX → sensor RX
#define R503_BAUD   57600

// Number of unrecognised scans within the fallback window that triggers the captive portal
#define PORTAL_FALLBACK_TAPS      10
#define PORTAL_FALLBACK_WINDOW_MS 30000UL

/* ═══════════════════ END CONFIG ═══════════════════ */

/* LED control constants (R503) */
#define FINGERPRINT_LED_OFF       0x00
#define FINGERPRINT_LED_ON        0x01
#define FINGERPRINT_LED_FLASHING  0x02
#define FINGERPRINT_LED_BREATHING 0x03

#define FINGERPRINT_LED_RED       0x01
#define FINGERPRINT_LED_BLUE      0x02
#define FINGERPRINT_LED_PURPLE    0x03
#define FINGERPRINT_LED_GREEN     0x04
#define FINGERPRINT_LED_WHITE     0x06
#define FINGERPRINT_LED_YELLOW    0x05

/* Timing and storage constants */
#define MAX_FID              127
#define SCAN_COOLDOWN_MS     60000UL   // minimum gap between accepted scans per finger (ms)
#define ENROLL_POLL_MS       10000UL   // normal enrollment poll interval (ms)
#define ENROLL_POLL_FAST_MS  2000UL    // faster poll interval right after a job is found
#define QUEUE_FILE           "/queue.txt"
#define FID_MAP_FILE         "/fid_map.csv"  // format per line: fid,staffId,role,name
#define WIFI_CREDS_FILE      "/wifi_creds.json"
#define AP_SSID              "Attendance-Setup"
#define AP_PASS              "setup1234"
#define DNS_PORT             53
#define QUEUE_MAX_ENTRIES    200                      // oldest entries dropped when queue is full
#define QUEUE_MAX_AGE_MS     (7UL * 24 * 3600 * 1000) // entries older than 7 days are discarded

/* Libraries */
#include <WiFi.h>
#include "esp_wifi.h"
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPIFFS.h>
#include <time.h>
#include <vector>
#include <deque>
#include <string>
#include <Adafruit_Fingerprint.h>
#include <Wire.h>
#include <RTClib.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "esp_task_wdt.h"

/* FreeRTOS */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

/* Hardware */
RTC_DS3231 rtc;
HardwareSerial r503Serial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&r503Serial);

/* FreeRTOS synchronisation primitives */
SemaphoreHandle_t memQueueMutex = NULL;
SemaphoreHandle_t memQueueSem   = NULL;
SemaphoreHandle_t spiffsMutex   = NULL;
SemaphoreHandle_t enrollMutex   = NULL;
SemaphoreHandle_t enrollSem     = NULL;

/* WiFi credentials (loaded from SPIFFS at boot) */
String wifiSSID = "";
String wifiPASS = "";

/* Task handles */
TaskHandle_t hFingerprint = NULL;
TaskHandle_t hNetwork     = NULL;
TaskHandle_t hEnrollment  = NULL;

/* In-memory queue — attendance payloads waiting to be POSTed */
std::deque<String> memQueue;

/* Per-finger identity mapping (index = fingerID, 1-based) */
std::vector<String> fidMap;      // staffId
std::vector<String> fidMapRole;  // "staff" or "master"
std::vector<String> fidMapName;  // display name

/* Pending enrollment job from the Apps Script Enrollment sheet */
struct EnrollJob {
  int    row;           // sheet row number (used to report result back)
  int    requestedFid;  // finger slot requested (0 = auto-assign)
  String staffId;       // UniqueID from the Enrollment sheet
  String name;
  String role;          // "staff" or "master"
  String command;       // "register", "delete", or "clearall"
};
volatile bool enrollmentJobPending = false;
EnrollJob     currentEnrollJob;

static unsigned long lastScanMillis[MAX_FID + 1];
static bool          fidEverScanned[MAX_FID + 1];

/* Captive portal fallback counters */
static int           portalFallbackCount       = 0;
static unsigned long portalFallbackWindowStart = 0;

/* ── Forward declarations ── */
void    showReadyState();
void    setSensorLED(uint8_t mode, uint8_t speed, uint8_t color);
int     fingerSearch();
String  makeScanId(const String &id);
void    sendOrQueuePayload(const String &payloadJson);
bool    initFS();
bool    loadFidMapFromFS();
bool    saveFidMapToFS();
int     findFidByStaffId(const String &staffId);
void    clearAllFidMap();
int     enrollID_toFid(int requestedFid);
void    enrollment_doRegister(int requestedFid, const String &staffId, const String &name, const String &role, int rowToReport);
void    enrollment_doDeleteByFid(int fid, int rowToReport);
void    enrollment_doDeleteByStaffId(const String &staffId, int rowToReport);
void    reportEnrollUpdate(int row, const String &status, int fingerId, const String &note);
bool    initRTC();
void    syncRTCFromNTP();
String  getRTCTimestamp();

/* HTTP helper constants */
#define POST_MAX_RETRIES  3
#define POST_BASE_DELAY_MS 500
#define POST_TIMEOUT_MS   30000

bool   postJSONToUrl(const String &jsonPayload, const char* targetUrl, int &outHttpCode, String &outBody);
String urlEncode(const String &str);
bool   sendGETFallback(const String &staffId, const String &date, const String &ts, int &outHttpCode, String &outBody);

/* ══════════════════════════ Implementation ══════════════════════════ */

/* ── LED helpers ── */
void setSensorLED(uint8_t mode, uint8_t speed, uint8_t color) {
  finger.LEDcontrol(mode, speed, color);
}

void setSensorLED(int mode) {
  switch (mode) {
    case 1: setSensorLED(FINGERPRINT_LED_ON,        0,  FINGERPRINT_LED_GREEN);  break;
    case 2: setSensorLED(FINGERPRINT_LED_BREATHING, 25, FINGERPRINT_LED_GREEN);  break;
    case 3: setSensorLED(FINGERPRINT_LED_BREATHING, 25, FINGERPRINT_LED_RED);    break;
    default: setSensorLED(FINGERPRINT_LED_OFF, 0, 0); break;
  }
}

// Blue = WiFi connected and ready; Purple = offline / no WiFi
void showReadyState() {
  if (WiFi.status() == WL_CONNECTED) {
    setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_BLUE);
  } else {
    setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_PURPLE);
  }
}

/* ── WiFi credentials (SPIFFS) ── */
bool loadWiFiCreds() {
  if (!SPIFFS.exists(WIFI_CREDS_FILE)) return false;
  File f = SPIFFS.open(WIFI_CREDS_FILE, FILE_READ);
  if (!f) return false;
  String ssid = "", pass = "";
  while (f.available()) {
    String ln = f.readStringUntil('\n');
    ln.trim();
    if      (ln.startsWith("ssid=")) ssid = ln.substring(5);
    else if (ln.startsWith("pass=")) pass = ln.substring(5);
  }
  f.close();
  if (ssid.length() == 0) return false;
  wifiSSID = ssid;
  wifiPASS = pass;
  return true;
}

void saveWiFiCreds(const String &ssid, const String &pass) {
  File f = SPIFFS.open(WIFI_CREDS_FILE, FILE_WRITE);
  if (!f) { Serial.println("Failed to write WiFi creds"); return; }
  f.println("ssid=" + ssid);
  f.println("pass=" + pass);
  f.close();
  Serial.println("WiFi credentials saved.");
}

/* ── Captive portal (AP mode) ─────────────────────────────────────────
   Launched either by a master fingerprint scan or by PORTAL_FALLBACK_TAPS
   consecutive unrecognised scans. Blocks until credentials are saved,
   then restarts the ESP32.
   ──────────────────────────────────────────────────────────────────── */
WebServer portalServer(80);
DNSServer dnsServer;

const char PORTAL_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Attendance Device Setup</title>
<style>
  body{font-family:sans-serif;max-width:420px;margin:50px auto;padding:20px;background:#f5f5f5;}
  .card{background:white;border-radius:10px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.1);}
  h2{color:#1565C0;margin-top:0;}
  input{width:100%;padding:10px;margin:8px 0 16px 0;border:1px solid #ccc;
        border-radius:6px;font-size:15px;box-sizing:border-box;}
  button{width:100%;padding:13px;background:#1565C0;color:white;
         border:none;border-radius:6px;font-size:16px;cursor:pointer;}
  button:hover{background:#0D47A1;}
  #msg{margin-top:14px;font-size:14px;color:#333;}
  .lbl{font-size:13px;font-weight:bold;color:#555;}
</style></head>
<body><div class="card">
<h2>&#128246; WiFi Setup</h2>
<p style="color:#555;font-size:14px;">Enter the school WiFi details for this attendance device.</p>
<div class="lbl">WiFi Name (SSID)</div>
<input type="text" id="ssid" placeholder="e.g. School-WiFi" autocomplete="off"/>
<div class="lbl">Password</div>
<input type="password" id="pass" placeholder="WiFi password"/>
<button onclick="save()">Save &amp; Connect</button>
<div id="msg"></div>
</div>
<script>
function save(){
  var s=document.getElementById('ssid').value.trim();
  var p=document.getElementById('pass').value;
  if(!s){document.getElementById('msg').innerText='Please enter a WiFi name.';return;}
  document.getElementById('msg').innerText='Saving...';
  fetch('/save?ssid='+encodeURIComponent(s)+'&pass='+encodeURIComponent(p))
    .then(function(r){return r.text();})
    .then(function(t){document.getElementById('msg').innerText=t;});
}
</script></body></html>
)rawliteral";

void startCaptivePortal() {
  esp_task_wdt_delete(NULL); // long-running portal; remove this task from watchdog

  // Pause other tasks so they don't interfere with AP mode
  if (hNetwork    != NULL) vTaskSuspend(hNetwork);
  if (hEnrollment != NULL) vTaskSuspend(hEnrollment);

  Serial.println("Starting captive portal (AP mode)...");
  WiFi.disconnect(true);
  delay(200);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.print("Portal AP IP: "); Serial.println(WiFi.softAPIP());

  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());

  portalServer.on("/", []() {
    portalServer.send(200, "text/html", PORTAL_HTML);
  });
  portalServer.on("/save", []() {
    String ssid = portalServer.arg("ssid");
    String pass = portalServer.arg("pass");
    if (ssid.length() == 0) {
      portalServer.send(400, "text/plain", "SSID cannot be empty.");
      return;
    }
    saveWiFiCreds(ssid, pass);
    portalServer.send(200, "text/plain", "Saved! Device will restart now...");
    delay(1500);
    ESP.restart();
  });
  portalServer.onNotFound([]() {
    portalServer.sendHeader("Location", "http://192.168.4.1/", true);
    portalServer.send(302, "text/plain", "");
  });
  portalServer.begin();
  Serial.println("Portal running. Connect to: " AP_SSID);

  // Purple LED pulses while the portal is active
  while (true) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    finger.LEDcontrol(FINGERPRINT_LED_ON,  0, FINGERPRINT_LED_PURPLE);
    delay(500);
    finger.LEDcontrol(FINGERPRINT_LED_OFF, 0, 0);
    delay(500);
  }
}

/* ── Fingerprint sensor initialisation ── */
void setupFingerprint() {
  Serial.println("Initialising fingerprint sensor...");
  r503Serial.begin(R503_BAUD, SERIAL_8N1, R503_RX_PIN, R503_TX_PIN);
  finger.begin(R503_BAUD);
  delay(100);
  if (finger.verifyPassword()) {
    Serial.println("Fingerprint sensor found.");
  } else {
    Serial.println("Fingerprint sensor not found — check wiring.");
  }
  finger.getParameters();
  Serial.print("Template count: "); Serial.println(finger.templateCount);
  Serial.print("Sensor capacity: "); Serial.println(finger.capacity);
}

/* ── Unique scan ID: millis + staffId, used for server-side dedupe ── */
String makeScanId(const String &id) {
  return String("scan-") + String(millis()) + "-" + id;
}

/* ── RTC initialisation and NTP sync ── */
bool initRTC() {
  if (!rtc.begin()) {
    Serial.println("RTC not found — check I2C wiring.");
    return false;
  }
  if (rtc.lostPower()) {
    Serial.println("RTC lost power; will sync from NTP when WiFi is available.");
  }
  Serial.println("RTC initialised.");
  return true;
}

void syncRTCFromNTP() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 10000)) {
    Serial.println("Failed to get NTP time.");
    return;
  }
  rtc.adjust(DateTime(
    timeinfo.tm_year + 1900,
    timeinfo.tm_mon  + 1,
    timeinfo.tm_mday,
    timeinfo.tm_hour,
    timeinfo.tm_min,
    timeinfo.tm_sec
  ));
  Serial.println("RTC synced from NTP.");
}

// Returns current RTC time as "YYYY-MM-DD HH:MM:SS"
String getRTCTimestamp() {
  DateTime now = rtc.now();
  char buf[25];
  sprintf(buf, "%04d-%02d-%02d %02d:%02d:%02d",
          now.year(), now.month(), now.day(),
          now.hour(), now.minute(), now.second());
  return String(buf);
}

/* ══════════════════════ SPIFFS — Finger ID map ══════════════════════
   File format (fid_map.csv): one line per enrolled finger
     fid,staffId,role,name
   ═════════════════════════════════════════════════════════════════════ */

bool initFS() {
  if (!SPIFFS.begin(true)) {
    Serial.println("SPIFFS mount failed.");
    return false;
  }
  return true;
}

bool loadFidMapFromFS() {
  fidMap.assign(MAX_FID + 1, "");
  fidMapRole.assign(MAX_FID + 1, "");
  fidMapName.assign(MAX_FID + 1, "");

  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  if (!SPIFFS.exists(FID_MAP_FILE)) {
    xSemaphoreGive(spiffsMutex);
    Serial.println("No fid_map file found; starting with empty map.");
    return true;
  }
  File f = SPIFFS.open(FID_MAP_FILE, FILE_READ);
  if (!f) {
    xSemaphoreGive(spiffsMutex);
    Serial.println("Failed to open fid_map for reading.");
    return false;
  }
  while (f.available()) {
    String ln = f.readStringUntil('\n');
    ln.trim();
    if (ln.length() == 0) continue;
    // Expected: fid,staffId,role,name
    int p1 = ln.indexOf(',');              if (p1 < 0) continue;
    int p2 = ln.indexOf(',', p1 + 1);     if (p2 < 0) continue;
    int p3 = ln.indexOf(',', p2 + 1);
    String sFid    = ln.substring(0, p1);
    String sStaff  = ln.substring(p1 + 1, p2);
    String sRole   = (p3 > 0) ? ln.substring(p2 + 1, p3) : ln.substring(p2 + 1);
    String sName   = (p3 > 0) ? ln.substring(p3 + 1) : "";
    int fid = sFid.toInt();
    if (fid >= 1 && fid <= MAX_FID) {
      fidMap[fid]      = sStaff;
      fidMapRole[fid]  = sRole;
      fidMapName[fid]  = sName;
    }
  }
  f.close();
  xSemaphoreGive(spiffsMutex);
  Serial.println("Fid map loaded from SPIFFS.");
  return true;
}

bool saveFidMapToFS() {
  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  File f = SPIFFS.open(FID_MAP_FILE, FILE_WRITE);
  if (!f) {
    xSemaphoreGive(spiffsMutex);
    Serial.println("Failed to open fid_map for writing.");
    return false;
  }
  for (int fid = 1; fid <= MAX_FID; ++fid) {
    if (fidMap[fid].length()) {
      f.println(String(fid) + "," + fidMap[fid] + "," + fidMapRole[fid] + "," + fidMapName[fid]);
    }
  }
  f.close();
  xSemaphoreGive(spiffsMutex);
  Serial.println("Fid map saved to SPIFFS.");
  return true;
}

int findFidByStaffId(const String &staffId) {
  for (int fid = 1; fid <= MAX_FID; ++fid) {
    if (fidMap[fid].length() && fidMap[fid] == staffId) return fid;
  }
  return -1;
}

void clearAllFidMap() {
  for (int f = 1; f <= MAX_FID; ++f) {
    fidMap[f] = ""; fidMapRole[f] = ""; fidMapName[f] = "";
  }
  saveFidMapToFS();
}

/* ══════════════════════ HTTP helpers ══════════════════════ */

bool postJSONToUrl(const String &jsonPayload, const char* targetUrl, int &outHttpCode, String &outBody) {
  if (WiFi.status() != WL_CONNECTED) { outHttpCode = -1; outBody = "WiFi not connected"; return false; }

  for (int attempt = 1; attempt <= POST_MAX_RETRIES; ++attempt) {
    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(20000);
    if (!http.begin(client, targetUrl)) {
      outHttpCode = -2; outBody = "HTTP begin failed";
      break;
    }
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(jsonPayload);
    outHttpCode = code;
    if (code > 0) {
      outBody = http.getString();
      Serial.printf("POST -> %d  %s\n", code, outBody.c_str());
      http.end();
      if ((code >= 200 && code < 300) || code == 400) return true;
      if ((code >= 500 && code < 600) || code == 429) {
        Serial.printf("Transient server error %d; will retry.\n", code);
      } else {
        Serial.printf("Permanent HTTP failure %d.\n", code);
        return false;
      }
    } else {
      outBody = http.errorToString(code);
      Serial.printf("HTTP client error: %s\n", outBody.c_str());
      http.end();
    }
    if (attempt < POST_MAX_RETRIES) {
      vTaskDelay((POST_BASE_DELAY_MS * (1UL << (attempt - 1))) / portTICK_PERIOD_MS);
    }
  }
  Serial.println("Max POST attempts reached.");
  return false;
}

String urlEncode(const String &str) {
  String encoded = "";
  for (size_t i = 0; i < str.length(); i++) {
    char c = str[i];
    if (('a' <= c && c <= 'z') || ('A' <= c && c <= 'Z') ||
        ('0' <= c && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
      encoded += c;
    } else if (c == ' ') {
      encoded += '+';
    } else {
      char buf[4];
      sprintf(buf, "%%%02X", (unsigned char)c);
      encoded += buf;
    }
  }
  return encoded;
}

// GET fallback used when a POST returns 400/404 (e.g. redirect handling edge cases)
bool sendGETFallback(const String &staffId, const String &date, const String &ts,
                     int &outHttpCode, String &outBody) {
  if (WiFi.status() != WL_CONNECTED) { outHttpCode = -1; outBody = "WiFi not connected"; return false; }

  String url = String(SCRIPT_URL) + "?";
  if (staffId.length()) url += "staffId=" + urlEncode(staffId) + "&";
  if (date.length())    url += "date="    + urlEncode(date)    + "&";
  if (ts.length())      url += "ts="      + urlEncode(ts);

  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(20000);
  if (!http.begin(client, url)) { outHttpCode = -2; outBody = "GET begin failed"; return false; }
  int code = http.GET();
  outHttpCode = code;
  if (code > 0) {
    outBody = http.getString();
    Serial.printf("GET -> %d  %s\n", code, outBody.c_str());
    http.end();
    return (code >= 200 && code < 300);
  }
  outBody = http.errorToString(code);
  Serial.printf("GET client error: %s\n", outBody.c_str());
  http.end();
  return false;
}

/* ── Report enrollment result back to the Apps Script Enrollment sheet ── */
void reportEnrollUpdate(int row, const String &status, int fingerId, const String &note) {
  if (row <= 1) return;
  String url = String(SCRIPT_URL) + "?api=enroll_update";
  url += "&row="    + String(row);
  url += "&status=" + urlEncode(status);
  if (fingerId > 0)     url += "&fingerId=" + String(fingerId);
  if (note.length())    url += "&note="     + urlEncode(note);
  if (strlen(SCRIPT_AUTH) > 0) url += "&auth=" + String(SCRIPT_AUTH);

  Serial.printf("Reporting enroll_update row=%d status=%s fid=%d\n", row, status.c_str(), fingerId);
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(20000);
  if (http.begin(client, url)) {
    int code = http.GET();
    String body = (code > 0) ? http.getString() : http.errorToString(code);
    Serial.printf("enroll_update -> %d  %s\n", code, body.c_str());
    http.end();
  }
}

/* ══════════════════════ Enrollment execution ══════════════════════
   enrollID_toFid: captures two fingerprint images, creates a model,
   and stores it at the requested slot. Returns the stored fid or -1.
   ═════════════════════════════════════════════════════════════════= */

int enrollID_toFid(int requestedFid) {
  if (requestedFid < 1 || requestedFid > MAX_FID) {
    Serial.println("Requested fid out of range.");
    return -1;
  }
  Serial.printf("Enrollment: slot=%d — place finger (first press, 20 s timeout)\n", requestedFid);
  setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_YELLOW);

  int p;
  unsigned long timeout = 20000;

  // First press
  unsigned long start = millis();
  while (millis() - start < timeout) {
    p = finger.getImage();
    if (p == FINGERPRINT_OK) break;
    if (p == FINGERPRINT_NOFINGER) { delay(120); continue; }
    Serial.printf("getImage error (1): %d\n", p); return -1;
  }
  if (millis() - start >= timeout) { Serial.println("Timeout on first press."); return -1; }
  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) { Serial.printf("image2Tz(1) failed: %d\n", p); return -1; }

  Serial.println("Remove finger.");
  setSensorLED(FINGERPRINT_LED_OFF, 0, 0);
  delay(1200);

  // Second press
  Serial.println("Place same finger again (second press, 20 s timeout)");
  setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_YELLOW);
  start = millis();
  while (millis() - start < timeout) {
    p = finger.getImage();
    if (p == FINGERPRINT_OK) break;
    if (p == FINGERPRINT_NOFINGER) { delay(120); continue; }
    Serial.printf("getImage error (2): %d\n", p); return -1;
  }
  if (millis() - start >= timeout) { Serial.println("Timeout on second press."); return -1; }
  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) { Serial.printf("image2Tz(2) failed: %d\n", p); return -1; }

  Serial.println("Creating model...");
  p = finger.createModel();
  if (p != FINGERPRINT_OK) { Serial.printf("createModel failed: %d\n", p); return -1; }

  Serial.printf("Storing model to slot %d\n", requestedFid);
  p = finger.storeModel(requestedFid);
  if (p == FINGERPRINT_OK) {
    Serial.println("Stored successfully.");
    return requestedFid;
  }
  Serial.printf("storeModel failed: %d\n", p);
  return -1;
}

void enrollment_doRegister(int requestedFid, const String &staffId, const String &name,
                            const String &role, int rowToReport) {
  int fidToUse = requestedFid;
  if (fidToUse < 1 || fidToUse > MAX_FID) {
    // Auto-assign: find the first free slot
    for (int f = 1; f <= MAX_FID; ++f) {
      if (fidMap[f].length() == 0) { fidToUse = f; break; }
    }
    if (fidToUse < 1 || fidToUse > MAX_FID) {
      Serial.println("No free finger slot available.");
      reportEnrollUpdate(rowToReport, "error", -1, "no-free-fid");
      return;
    }
  } else if (fidMap[fidToUse].length()) {
    Serial.printf("Warning: slot %d already occupied by %s; will overwrite.\n",
                  fidToUse, fidMap[fidToUse].c_str());
  }

  setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_PURPLE);
  int resFid = enrollID_toFid(fidToUse);
  if (resFid > 0) {
    fidMap[resFid]     = staffId.length() ? staffId : String("AUTO_") + String(resFid);
    String r           = role; r.toLowerCase();
    fidMapRole[resFid] = (r == "master") ? "master" : "staff";
    fidMapName[resFid] = name;
    saveFidMapToFS();
    Serial.printf("Enrolled: slot=%d  id=%s  role=%s  name=%s\n",
                  resFid, fidMap[resFid].c_str(), fidMapRole[resFid].c_str(), fidMapName[resFid].c_str());
    setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_GREEN);
    vTaskDelay(800 / portTICK_PERIOD_MS);
    showReadyState();
    reportEnrollUpdate(rowToReport, "registered", resFid, "");
  } else {
    setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
    vTaskDelay(800 / portTICK_PERIOD_MS);
    showReadyState();
    reportEnrollUpdate(rowToReport, "error", -1, "enroll-failed");
  }
}

void enrollment_doDeleteByFid(int fid, int rowToReport) {
  if (fid < 1 || fid > MAX_FID) {
    reportEnrollUpdate(rowToReport, "error", -1, "invalid-fid");
    return;
  }
  int p = finger.deleteModel(fid);
  if (p == FINGERPRINT_OK) {
    fidMap[fid] = ""; fidMapRole[fid] = ""; fidMapName[fid] = "";
    saveFidMapToFS();
    reportEnrollUpdate(rowToReport, "deleted", fid, "");
  } else {
    Serial.printf("deleteModel failed: %d\n", p);
    reportEnrollUpdate(rowToReport, "error", fid, String(p));
  }
}

void enrollment_doDeleteByStaffId(const String &staffId, int rowToReport) {
  int fid = findFidByStaffId(staffId);
  if (fid <= 0) {
    reportEnrollUpdate(rowToReport, "error", -1, "not-found");
    return;
  }
  enrollment_doDeleteByFid(fid, rowToReport);
}

/* ── Fingerprint search wrapper ────────────────────────────────────────
   Returns:
     > 0  matched fingerID
     -1   no finger present (sensor idle)
     -4   finger detected but no match found
     -2   sensor or image error
   ──────────────────────────────────────────────────────────────────── */
int fingerSearch() {
  uint8_t p = finger.getImage();
  if (p == FINGERPRINT_NOFINGER) return -1;
  if (p != FINGERPRINT_OK) { Serial.printf("getImage error: %d\n", p); return -2; }

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) { Serial.printf("image2Tz error: %d\n", p); return -2; }

  p = finger.fingerSearch();
  if (p == FINGERPRINT_OK) {
    Serial.printf("Match: ID=%d  confidence=%d\n", finger.fingerID, finger.confidence);
    return (int)finger.fingerID;
  }
  if (p == FINGERPRINT_NOTFOUND) { Serial.println("No match."); return -4; }
  Serial.printf("fingerSearch error: %d\n", p);
  return -2;
}

/* ── Offline queue management ── */

// Drops entries older than QUEUE_MAX_AGE_MS, then caps at QUEUE_MAX_ENTRIES
void trimQueue() {
  DateTime nowRTC   = rtc.now();
  long     nowEpoch = nowRTC.unixtime();

  std::deque<String> kept;
  for (auto &entry : memQueue) {
    int tsIdx = entry.indexOf("\"timestamp\":\"");
    if (tsIdx < 0) { kept.push_back(entry); continue; }
    int tsStart = tsIdx + 13;
    int tsEnd   = entry.indexOf("\"", tsStart);
    if (tsEnd < 0) { kept.push_back(entry); continue; }
    String tsStr = entry.substring(tsStart, tsEnd);
    int yr = tsStr.substring(0,  4).toInt();
    int mo = tsStr.substring(5,  7).toInt();
    int dy = tsStr.substring(8,  10).toInt();
    int hr = tsStr.substring(11, 13).toInt();
    int mn = tsStr.substring(14, 16).toInt();
    int sc = tsStr.substring(17, 19).toInt();
    if (yr < 2020) { kept.push_back(entry); continue; } // malformed; keep
    DateTime entryTime(yr, mo, dy, hr, mn, sc);
    long ageSec = nowEpoch - (long)entryTime.unixtime();
    if (ageSec < 0 || (unsigned long)(ageSec * 1000UL) <= QUEUE_MAX_AGE_MS) {
      kept.push_back(entry);
    } else {
      Serial.printf("Queue: dropping stale entry (age=%lds)\n", ageSec);
    }
  }
  memQueue = kept;

  while (memQueue.size() > QUEUE_MAX_ENTRIES) {
    Serial.printf("Queue full (%d); dropping oldest entry.\n", (int)memQueue.size());
    memQueue.pop_front();
  }
}

// Push a payload to the in-memory queue (or SPIFFS if WiFi is down or mutex busy)
void sendOrQueuePayload(const String &payloadJson) {
  if (WiFi.status() != WL_CONNECTED) {
    xSemaphoreTake(spiffsMutex, portMAX_DELAY);
    File f = SPIFFS.open(QUEUE_FILE, FILE_APPEND);
    if (f) { f.println(payloadJson); f.close(); }
    else { Serial.println("Queue append to SPIFFS failed."); }
    xSemaphoreGive(spiffsMutex);
    return;
  }

  if (xSemaphoreTake(memQueueMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    trimQueue();
    memQueue.push_back(payloadJson);
    xSemaphoreGive(memQueueMutex);
    xSemaphoreGive(memQueueSem);
  } else {
    // Fallback to SPIFFS if the mutex is busy
    xSemaphoreTake(spiffsMutex, portMAX_DELAY);
    File f = SPIFFS.open(QUEUE_FILE, FILE_APPEND);
    if (f) { f.println(payloadJson); f.close(); }
    xSemaphoreGive(spiffsMutex);
  }
}

// Attempt to send all SPIFFS-queued payloads; keep any that still fail
void flushQueue() {
  if (WiFi.status() != WL_CONNECTED) return;

  std::vector<String> pending;
  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  File f = SPIFFS.open(QUEUE_FILE, FILE_READ);
  if (!f) { xSemaphoreGive(spiffsMutex); return; }
  while (f.available()) {
    String ln = f.readStringUntil('\n'); ln.trim();
    if (ln.length()) pending.push_back(ln);
  }
  f.close();
  xSemaphoreGive(spiffsMutex);

  if (pending.empty()) return;
  Serial.printf("Flushing %u queued record(s).\n", (unsigned)pending.size());

  std::vector<String> keep;
  for (auto &entry : pending) {
    int httpCode = 0; String body;
    if (postJSONToUrl(entry, SCRIPT_URL, httpCode, body)) { continue; }

    if (httpCode == 400 || httpCode == 404) {
      // Extract staffId and ts for GET fallback
      String sid = "", date = "", ts = "";
      auto extractStr = [&](const String &key) -> String {
        int p = entry.indexOf("\"" + key + "\"");
        if (p < 0) return "";
        int c = entry.indexOf(':', p);
        int q1 = entry.indexOf('"', c);
        if (q1 < 0) return "";
        int q2 = entry.indexOf('"', q1 + 1);
        return q2 >= 0 ? entry.substring(q1 + 1, q2) : "";
      };
      sid  = extractStr("staffId");
      date = extractStr("date");
      ts   = extractStr("ts");
      int gCode = 0; String gBody;
      if (sendGETFallback(sid, date, ts, gCode, gBody)) { continue; }
      Serial.printf("GET fallback failed (%d); keeping record.\n", gCode);
    } else {
      Serial.printf("Send failed (%d); keeping record.\n", httpCode);
    }
    keep.push_back(entry);
    vTaskDelay(200 / portTICK_PERIOD_MS);
  }

  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  if (keep.empty()) {
    SPIFFS.remove(QUEUE_FILE);
    Serial.println("Queue cleared.");
  } else {
    File wf = SPIFFS.open(QUEUE_FILE, FILE_WRITE);
    for (auto &ln : keep) wf.println(ln);
    wf.close();
    Serial.printf("Queue retained %u record(s).\n", (unsigned)keep.size());
  }
  xSemaphoreGive(spiffsMutex);
}

/* ══════════════════════ NetworkTask (Core 0) ══════════════════════
   Sends payloads from the in-memory queue via HTTP POST.
   Falls back to GET for 400/404 responses.
   Re-queues to SPIFFS on transient failure.
   Runs a periodic flushQueue() to drain any SPIFFS-stored entries.
   Handles WiFi reconnection and periodic NTP sync.
   ═════════════════════════════════════════════════════════════════= */
void NetworkTask(void *pvParameters) {
  const TickType_t flushIntervalTicks = pdMS_TO_TICKS(60000);
  esp_task_wdt_delete(NULL); // long HTTP calls; exempt from watchdog

  for (;;) {
    // Drain one payload from the in-memory queue
    String payload    = "";
    bool   hadPayload = false;
    if (xSemaphoreTake(memQueueMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
      if (!memQueue.empty()) { payload = memQueue.front(); memQueue.pop_front(); hadPayload = true; }
      xSemaphoreGive(memQueueMutex);
    }

    if (hadPayload) {
      int httpCode = 0; String body;
      if (!postJSONToUrl(payload, SCRIPT_URL, httpCode, body)) {
        if (httpCode == 400 || httpCode == 404) {
          // GET fallback
          auto extractStr = [&](const String &key) -> String {
            int p = payload.indexOf("\"" + key + "\"");
            if (p < 0) return "";
            int c = payload.indexOf(':', p);
            int q1 = payload.indexOf('"', c);
            if (q1 < 0) return "";
            int q2 = payload.indexOf('"', q1 + 1);
            return q2 >= 0 ? payload.substring(q1 + 1, q2) : "";
          };
          String sid = extractStr("staffId"), date = extractStr("date"), ts = extractStr("ts");
          int gCode = 0; String gBody;
          if (!sendGETFallback(sid, date, ts, gCode, gBody)) {
            xSemaphoreTake(spiffsMutex, portMAX_DELAY);
            File f = SPIFFS.open(QUEUE_FILE, FILE_APPEND);
            if (f) { f.println(payload); f.close(); }
            xSemaphoreGive(spiffsMutex);
          }
        } else {
          xSemaphoreTake(spiffsMutex, portMAX_DELAY);
          File f = SPIFFS.open(QUEUE_FILE, FILE_APPEND);
          if (f) { f.println(payload); f.close(); }
          xSemaphoreGive(spiffsMutex);
        }
      }
      continue;
    }

    if (xSemaphoreTake(memQueueSem, flushIntervalTicks) == pdTRUE) {
      continue; // new payload arrived; loop back immediately
    }

    // Periodic maintenance: NTP sync + SPIFFS queue flush
    static bool rtcSynced = false;
    if (WiFi.status() == WL_CONNECTED) {
      if (!rtcSynced) {
        configTime(0, 0, "pool.ntp.org", "time.nist.gov");
        vTaskDelay(pdMS_TO_TICKS(2000));
        syncRTCFromNTP();
        rtcSynced = true;
      }
      flushQueue();
    } else {
      rtcSynced = false;
      Serial.println("NetworkTask: WiFi lost — attempting reconnect.");
      WiFi.disconnect(true);
      vTaskDelay(pdMS_TO_TICKS(1000));
      WiFi.begin(wifiSSID.c_str(), wifiPASS.c_str());
    }
  }
  vTaskDelete(NULL);
}

/* ══════════════════════ EnrollmentTask (Core 0) ══════════════════════
   Polls the Apps Script endpoint for pending enrollment jobs.
   Notifies FingerprintTask via enrollSem when a job is ready.
   Uses a fast poll interval immediately after a job is dispatched.
   ═════════════════════════════════════════════════════════════════════ */
void EnrollmentTask(void *pvParameters) {
  esp_task_wdt_delete(NULL);
  for (;;) {
    if (WiFi.status() == WL_CONNECTED) {
      String url = String(SCRIPT_URL) + "?api=enroll_fetch";
      if (strlen(SCRIPT_AUTH) > 0) url += "&auth=" + String(SCRIPT_AUTH);

      WiFiClientSecure client; client.setInsecure();
      HTTPClient http;
      http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
      http.setTimeout(20000);
      int    code = -1;
      String body = "";
      if (http.begin(client, url)) {
        code = http.GET();
        if (code > 0) body = http.getString();
        http.end();
      }
      Serial.printf("EnrollmentTask: HTTP %d  %s\n", code, body.c_str());

      if (code >= 200 && code < 300 && body.length()) {
        if (body.indexOf("\"result\":\"ok\"") >= 0 && body.indexOf("\"record\"") >= 0) {
          // Parse the record object from the JSON response
          int posRec = body.indexOf("\"record\"");

          auto extractInt = [&](const String &key) -> int {
            int p = body.indexOf("\"" + key + "\"", posRec);
            if (p < 0) return 0;
            int c = body.indexOf(':', p);
            int e = body.indexOf(',', c);
            if (e < 0) e = body.indexOf('}', c);
            String s = body.substring(c + 1, e); s.trim();
            return s.toInt();
          };
          auto extractStr = [&](const String &key) -> String {
            int p = body.indexOf("\"" + key + "\"", posRec);
            if (p < 0) return "";
            int c = body.indexOf(':', p);
            int q1 = body.indexOf('"', c + 1);
            if (q1 < 0) return "";
            int q2 = body.indexOf('"', q1 + 1);
            return q2 >= 0 ? body.substring(q1 + 1, q2) : "";
          };

          int parsedRow = extractInt("row");
          int parsedFid = extractInt("fingerId");
          if (parsedRow >= 2) {
            xSemaphoreTake(enrollMutex, portMAX_DELAY);
            currentEnrollJob.row          = parsedRow;
            currentEnrollJob.requestedFid = parsedFid;
            currentEnrollJob.staffId      = extractStr("uniqueId");
            currentEnrollJob.name         = extractStr("name");
            currentEnrollJob.role         = extractStr("role");
            currentEnrollJob.command      = extractStr("command");
            enrollmentJobPending          = true;
            xSemaphoreGive(enrollMutex);
            Serial.printf("EnrollmentTask: job queued row=%d cmd=%s fid=%d id=%s\n",
                          parsedRow, currentEnrollJob.command.c_str(),
                          parsedFid, currentEnrollJob.staffId.c_str());
            xSemaphoreGive(enrollSem);
            vTaskDelay(pdMS_TO_TICKS(ENROLL_POLL_FAST_MS));
            continue;
          }
        }
      } else if (code < 0) {
        Serial.printf("EnrollmentTask: HTTP poll failed (%d).\n", code);
      }
    } else {
      Serial.println("EnrollmentTask: WiFi not connected; skipping poll.");
    }

    vTaskDelay(pdMS_TO_TICKS(enrollmentJobPending ? ENROLL_POLL_FAST_MS : ENROLL_POLL_MS));
  }
  vTaskDelete(NULL);
}

/* ══════════════════════ FingerprintTask (Core 1) ══════════════════════
   Main attendance loop:
     1. Checks for a pending enrollment job from EnrollmentTask and executes it.
     2. Scans for a fingerprint.
     3. On match: enforces cooldown, then builds and queues an attendance payload.
        • "master" role → launches captive portal instead of recording attendance.
     4. On no-match: counts taps; triggers captive portal after PORTAL_FALLBACK_TAPS.
   ═════════════════════════════════════════════════════════════════════ */
void FingerprintTask(void *pvParameters) {
  const unsigned long feedbackDuration = 600; // ms to hold green/red LED after a scan

  for (;;) {
    showReadyState();

    // ── Execute any pending enrollment job ──
    if (xSemaphoreTake(enrollSem, 0) == pdTRUE) {
      if (enrollmentJobPending) {
        xSemaphoreTake(enrollMutex, portMAX_DELAY);
        EnrollJob job        = currentEnrollJob;
        enrollmentJobPending = false;
        xSemaphoreGive(enrollMutex);

        Serial.printf("Processing enroll job: row=%d cmd=%s role=%s\n",
                      job.row, job.command.c_str(), job.role.c_str());
        if (job.command == "register") {
          enrollment_doRegister(job.requestedFid, job.staffId, job.name, job.role, job.row);
        } else if (job.command == "delete") {
          if (job.requestedFid > 0) enrollment_doDeleteByFid(job.requestedFid, job.row);
          else if (job.staffId.length()) enrollment_doDeleteByStaffId(job.staffId, job.row);
          else reportEnrollUpdate(job.row, "error", -1, "no-id-specified");
        } else if (job.command == "clearall") {
          int rc = finger.emptyDatabase();
          if (rc == FINGERPRINT_OK) {
            clearAllFidMap();
            reportEnrollUpdate(job.row, "cleared", 0, "");
          } else {
            Serial.printf("emptyDatabase failed: %d\n", rc);
            reportEnrollUpdate(job.row, "error", 0, String(rc));
          }
        } else {
          reportEnrollUpdate(job.row, "error", -1, "unknown-cmd");
        }
      }
    }

    // ── Normal attendance scan ──
    int fid = fingerSearch();

    if (fid > 0) {
      Serial.printf("Matched finger ID: %d\n", fid);

      // Per-finger cooldown: ignore scans within SCAN_COOLDOWN_MS of the previous scan
      unsigned long nowMs = millis();
      if (fidEverScanned[fid] && (nowMs - lastScanMillis[fid] < SCAN_COOLDOWN_MS)) {
        unsigned long remaining = (SCAN_COOLDOWN_MS - (nowMs - lastScanMillis[fid])) / 1000;
        Serial.printf("Cooldown: fid=%d  %lus remaining — ignoring.\n", fid, remaining);
        vTaskDelay(600 / portTICK_PERIOD_MS);
        showReadyState();
        vTaskDelay(10 / portTICK_PERIOD_MS);
        continue;
      }
      lastScanMillis[fid]  = nowMs;
      fidEverScanned[fid]  = true;

      String mapped = fidMap[fid];
      String role   = fidMapRole[fid];
      role.toLowerCase();

      if (role == "master") {
        // Master scan → launch WiFi captive portal
        Serial.println("Master finger scanned: launching captive portal.");
        for (int i = 0; i < 5; i++) {
          setSensorLED(FINGERPRINT_LED_ON,  0, FINGERPRINT_LED_YELLOW); vTaskDelay(120 / portTICK_PERIOD_MS);
          setSensorLED(FINGERPRINT_LED_OFF, 0, 0);                       vTaskDelay(120 / portTICK_PERIOD_MS);
        }
        startCaptivePortal(); // blocks until credentials saved, then ESP.restart()

      } else if (mapped.length()) {
        // Registered staff member → record attendance
        String staffId   = mapped;
        String staffName = fidMapName[fid];
        setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_GREEN);

        String scanId  = makeScanId(staffId);
        String ts      = getRTCTimestamp();
        String payload = "{\"staffId\":\""   + staffId   + "\","
                          "\"staffName\":\"" + staffName + "\","
                          "\"timestamp\":\"" + ts        + "\","
                          "\"scanId\":\""    + scanId    + "\"}";

        vTaskDelay(feedbackDuration / portTICK_PERIOD_MS);
        showReadyState();
        sendOrQueuePayload(payload);
        vTaskDelay(200 / portTICK_PERIOD_MS);

      } else {
        // Finger slot is in the sensor but has no mapping — likely a leftover template
        Serial.printf("Matched slot %d but no mapping found; ignoring scan.\n", fid);
        setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
        vTaskDelay(feedbackDuration / portTICK_PERIOD_MS);
        showReadyState();
        vTaskDelay(100 / portTICK_PERIOD_MS);
      }

    } else if (fid == -1) {
      vTaskDelay(20 / portTICK_PERIOD_MS); // no finger; yield briefly

    } else if (fid == -4) {
      // Finger detected but not in the database
      Serial.println("No match — unrecognised finger.");
      setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
      vTaskDelay(feedbackDuration / portTICK_PERIOD_MS);
      showReadyState();
      vTaskDelay(100 / portTICK_PERIOD_MS);

      // Track consecutive no-match taps to trigger the portal fallback
      unsigned long nowMs = millis();
      if (portalFallbackCount == 0 || (nowMs - portalFallbackWindowStart) > PORTAL_FALLBACK_WINDOW_MS) {
        portalFallbackCount       = 1;
        portalFallbackWindowStart = nowMs;
      } else {
        portalFallbackCount++;
      }
      Serial.printf("Portal fallback: %d/%d\n", portalFallbackCount, PORTAL_FALLBACK_TAPS);
      if (portalFallbackCount >= PORTAL_FALLBACK_TAPS) {
        portalFallbackCount = 0;
        Serial.println("Portal fallback triggered by repeated unrecognised scans.");
        for (int i = 0; i < 3; i++) {
          setSensorLED(FINGERPRINT_LED_ON,  0, FINGERPRINT_LED_YELLOW); vTaskDelay(150 / portTICK_PERIOD_MS);
          setSensorLED(FINGERPRINT_LED_OFF, 0, 0);                       vTaskDelay(150 / portTICK_PERIOD_MS);
        }
        startCaptivePortal();
      }

    } else {
      // Sensor or image error
      setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
      vTaskDelay(200 / portTICK_PERIOD_MS);
      showReadyState();
    }

    vTaskDelay(10 / portTICK_PERIOD_MS);
  }
  vTaskDelete(NULL);
}

/* ══════════════════════ Setup ══════════════════════ */
void setup() {
  Serial.begin(115200);
  delay(200);

  // Create FreeRTOS synchronisation primitives
  memQueueMutex = xSemaphoreCreateMutex();
  memQueueSem   = xSemaphoreCreateBinary();
  spiffsMutex   = xSemaphoreCreateMutex();
  enrollMutex   = xSemaphoreCreateMutex();
  enrollSem     = xSemaphoreCreateBinary();
  if (!memQueueMutex || !memQueueSem || !spiffsMutex || !enrollMutex || !enrollSem) {
    Serial.println("Failed to create RTOS primitives — halting.");
    while (1) delay(1000);
  }

  if (!initFS()) Serial.println("SPIFFS init failed.");

  loadFidMapFromFS();
  memset(lastScanMillis, 0, sizeof(lastScanMillis));
  memset(fidEverScanned, 0, sizeof(fidEverScanned));

  // Load WiFi credentials from SPIFFS; launch portal on first boot if none found
  if (!loadWiFiCreds()) {
    Serial.println("No WiFi credentials found — launching captive portal.");
    setupFingerprint();
    startCaptivePortal(); // blocks; restarts after save
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  wifi_config_t conf;
  esp_wifi_get_config(WIFI_IF_STA, &conf);
  conf.sta.bssid_set = 0;
  esp_wifi_set_config(WIFI_IF_STA, &conf);
  WiFi.begin(wifiSSID.c_str(), wifiPASS.c_str());

  Serial.print("Connecting to WiFi");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 30) { delay(500); Serial.print("."); tries++; }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected. IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nWiFi unavailable — starting in offline mode. Scan master finger to reconfigure.");
  }
  Serial.printf("Free heap at boot: %u bytes\n", esp_get_free_heap_size());

  // RTC init and optional NTP sync
  Wire.begin(21, 22);
  initRTC();
  configTime(0, 0, "pool.ntp.org");
  if (WiFi.status() == WL_CONNECTED) syncRTCFromNTP();

  setupFingerprint();

  // Pin tasks to cores
  BaseType_t ok1 = xTaskCreatePinnedToCore(FingerprintTask,  "FingerprintTask",  8192,  NULL, 1, &hFingerprint, 1);
  BaseType_t ok2 = xTaskCreatePinnedToCore(NetworkTask,      "NetworkTask",      16384, NULL, 1, &hNetwork,     0);
  BaseType_t ok3 = xTaskCreatePinnedToCore(EnrollmentTask,   "EnrollmentTask",   12288, NULL, 1, &hEnrollment,  0);
  if (ok1 != pdPASS || ok2 != pdPASS || ok3 != pdPASS) {
    Serial.println("Failed to create tasks — halting.");
    while (1) delay(1000);
  }

  Serial.println("All tasks started.");
}

void loop() {
  delay(1000); // all work is done in FreeRTOS tasks; loop stays idle
}

/* ═══════════════════════ END OF SKETCH ═══════════════════════════ */
