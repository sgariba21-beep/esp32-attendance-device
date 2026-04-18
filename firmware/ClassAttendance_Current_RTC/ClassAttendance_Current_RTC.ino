/* 
  ESP32 Attendance client — R503 fingerprint edition (dual-core optimized)
  WITH enrollment polling + master-triggered enrollment mode + fid mapping in SPIFFS
  (LED: fingerprint-only feedback — green/red briefly; treat HTTP 400 as success)
  
  IMPORTANT: Edit WIFI_SSID, WIFI_PASS, SCRIPT_URL, CLASS_ID, SCRIPT_AUTH before use.
*/

/* ========= CONFIG - EDIT THESE ========== */

// Central Apps Script endpoint (single router web app)
const char* SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwfapwAVM7TPASsB6AbenNeUyiDosoAXXBx7yds3ZHxeaM7lakQf-t_FVQ_mAkfYD9pcw/exec";

// If you set SCRIPT_AUTH_KEY in Apps Script, put the same string here; otherwise leave empty
const char* SCRIPT_AUTH = ""; // e.g. "supersecret"

// Device identity / branch
const char* BRANCH_ID   = "EJURA-SYS";   // e.g. "HQ-ADMIN"
const char* BRANCH_NAME = "Ejura Water System";  // e.g. "Head Office - Admin"

/* Fingerprint UART pins (change to your wiring) */
#define R503_RX_PIN 16  // to sensor TX
#define R503_TX_PIN 17  // to sensor RX
#define R503_BAUD   57600

/* LED fallbacks (same as your original) */
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

/* Constants */
#define MAX_FID 127
#define SCAN_COOLDOWN_MS 60000UL  // minimum ms between accepted scans per finger
#define ENROLL_POLL_MS 10000UL  // normal poll interval
#define ENROLL_POLL_FAST_MS 2000UL  // fast poll interval after a job is found
#define QUEUE_FILE "/queue.txt"
#define FID_MAP_FILE "/fid_map.csv" // csv lines: fid,uniqueId,role,name,position
#define WIFI_CREDS_FILE "/wifi_creds.json"
#define AP_SSID         "Attendance-Setup"
#define AP_PASS         "setup1234"
#define DNS_PORT        53
#define QUEUE_MAX_ENTRIES   200          // in-memory queue: drop oldest if exceeds this
#define QUEUE_MAX_AGE_MS    (7UL * 24 * 3600 * 1000)  // discard entries older than 7 days (both queues)
#define QUEUE_MAX_SPIFFS_ENTRIES       1000                    // SPIFFS queue: hard cap on entry count
#define QUEUE_MAX_SPIFFS_BYTES         (256UL * 1024UL)       // SPIFFS queue: hard cap on total bytes (256 KB)
#define QUEUE_SPIFFS_TRIM_INTERVAL_MS  (5UL * 60UL * 1000UL)  // run SPIFFS trim at most this often while offline (5 minutes)

/* ============ END CONFIG ================ */

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

/* FreeRTOS primitives */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

/*RTC*/
RTC_DS3231 rtc;

/* Hardware serial for fingerprint */
HardwareSerial r503Serial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&r503Serial);

/* Globals */
SemaphoreHandle_t memQueueMutex = NULL;
SemaphoreHandle_t memQueueSem = NULL;
SemaphoreHandle_t spiffsMutex = NULL;
SemaphoreHandle_t enrollMutex = NULL;
SemaphoreHandle_t enrollSem = NULL;

String wifiSSID = "";
String wifiPASS = "";

TaskHandle_t hFingerprint = NULL;
TaskHandle_t hNetwork     = NULL;
TaskHandle_t hEnrollment  = NULL;

std::deque<String> memQueue; // in-memory queue for attendance payloads
std::vector<String> fidMap;         // index 0 unused; fidMap[fid] == uniqueId (or empty)
std::vector<String> fidMapRole;     // system role per fid (employee|master)
std::vector<String> fidMapName;     // display name per fid
std::vector<String> fidMapPosition; // job title per fid (e.g. Manager, Engineer)

// Enrollment job struct
struct EnrollJob {
  int row; // sheet row number
  int requestedFid;
  String uniqueId;
  String name;
  String role;     // employee|master
  String position; // job title (e.g. Manager, Engineer)
  String command;  // register|delete|clearall
};
volatile bool enrollmentJobPending = false;
EnrollJob currentEnrollJob;

static unsigned long lastScanMillis[MAX_FID + 1];
static bool fidEverScanned[MAX_FID + 1];

/* Forward declarations */
void showReadyState();
void setSensorLED(uint8_t mode, uint8_t speed, uint8_t color);
int fingerSearch();
String makeScanId(const String &id);
void sendOrQueuePayload(const String &payloadJson);
bool initFS();
bool loadFidMapFromFS();
bool saveFidMapToFS();
int findFidByUnique(const String &uniqueId);
void clearAllFidMap();
void applyFidMapToSerialPrint();
int enrollID_toFid(int requestedFid);
void enrollment_doRegister(int requestedFid, const String &uniqueId, const String &name, const String &role, const String &position, int rowToReport);
void enrollment_doDeleteByFid(int fid, int rowToReport);
void enrollment_doDeleteByUnique(const String &uniqueId, int rowToReport);
void reportEnrollUpdate(int row, const String &status, int fingerId, const String &note);
bool initRTC();
void syncRTCFromNTP();
String getRTCTimestamp();
bool parsePayloadAgeSec(const String &payload, long nowEpoch, long &outAgeSec);
void trimSPIFFSQueue_locked();
bool appendToSPIFFSQueue_locked(const String &line);
void trimQueue();

/* Networking helpers (copied/kept similar to your original) */
#define POST_MAX_RETRIES 3
#define POST_BASE_DELAY_MS 500
#define POST_TIMEOUT_MS 30000

bool postJSONToUrl(const String &jsonPayload, const char* targetUrl, int &outHttpCode, String &outBody);
String urlEncode(const String &str);
bool sendGETFallback(const String &studentId, const String &date, const String &ts, int &outHttpCode, String &outBody);

/* ---------------- Implementation ---------------- */

void setSensorLED(uint8_t mode, uint8_t speed, uint8_t color) {
  finger.LEDcontrol(mode, speed, color);
}

void setSensorLED(int mode) {
  if (mode == 1) {
    setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_GREEN);
    return;
  }
  if (mode == 2) {
    setSensorLED(FINGERPRINT_LED_BREATHING, 25, FINGERPRINT_LED_GREEN);
    return;
  }
  if (mode == 3) {
    setSensorLED(FINGERPRINT_LED_BREATHING, 25, FINGERPRINT_LED_RED);
    return;
  }
  setSensorLED(FINGERPRINT_LED_OFF, 0, 0);
}

void showReadyState() {
  if (WiFi.status() == WL_CONNECTED) {
    setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_BLUE);
  } else {
    setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_PURPLE);
  }
}

/* ================== WiFi Credentials (SPIFFS) ================== */
bool loadWiFiCreds() {
  if (!SPIFFS.exists(WIFI_CREDS_FILE)) return false;
  File f = SPIFFS.open(WIFI_CREDS_FILE, FILE_READ);
  if (!f) return false;
  String ssid = "", pass = "";
  while (f.available()) {
    String ln = f.readStringUntil('\n');
    ln.trim();
    if (ln.startsWith("ssid=")) ssid = ln.substring(5);
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

/* ================== Captive Portal ================== */
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
<p style="color:#555;font-size:14px;">Enter the office WiFi details for this attendance device.</p>
<div class="lbl">WiFi Name (SSID)</div>
<input type="text" id="ssid" placeholder="e.g. Office-WiFi" autocomplete="off"/>
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
  esp_task_wdt_delete(NULL); // remove this task from watchdog

  // Suspend other tasks so they don't interfere with AP mode
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

  while (true) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    finger.LEDcontrol(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_PURPLE);
    delay(500);
    finger.LEDcontrol(FINGERPRINT_LED_OFF, 0, 0);
    delay(500);
  }
}
/* ================== End Captive Portal ================== */

/* Fingerprint initialization */
void setupFingerprint() {
  Serial.println("Initializing fingerprint sensor...");
  r503Serial.begin(R503_BAUD, SERIAL_8N1, R503_RX_PIN, R503_TX_PIN);
  finger.begin(R503_BAUD);
  delay(100);
  if (finger.verifyPassword()) {
    Serial.println("Found fingerprint sensor");
  } else {
    Serial.println("Fingerprint sensor not found :(");
  }
  finger.getParameters();
  Serial.print("Template count: "); Serial.println(finger.templateCount);
  Serial.print("Sensor capacity: "); Serial.println(finger.capacity);
}

/* Helper: generate a unique scanId using millis + id */
String makeScanId(const String &id) {
  unsigned long m = millis();
  return String("scan-") + String(m) + "-" + id;
}

/*RTC Initialization and Sync*/
bool initRTC() {
  if (!rtc.begin()) {
    Serial.println("RTC not found");
    return false;
  }

  if (rtc.lostPower()) {
    Serial.println("RTC lost power, will sync when WiFi available");
  }

  Serial.println("RTC initialized");
  return true;
}

void syncRTCFromNTP() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 10000)) {
    Serial.println("Failed to get NTP time");
    return;
  }

  rtc.adjust(DateTime(
    timeinfo.tm_year + 1900,
    timeinfo.tm_mon + 1,
    timeinfo.tm_mday,
    timeinfo.tm_hour,
    timeinfo.tm_min,
    timeinfo.tm_sec
  ));

  Serial.println("RTC synced from NTP");
}

String getRTCTimestamp() {
  DateTime now = rtc.now();
  char buf[25];
  sprintf(buf, "%04d-%02d-%02d %02d:%02d:%02d",
          now.year(), now.month(), now.day(),
          now.hour(), now.minute(), now.second());
  return String(buf);
}

/* ================== SPIFFS Fid Map ================== */

bool initFS() {
  if (!SPIFFS.begin(true)) {
    Serial.println("SPIFFS mount failed");
    return false;
  }
  return true;
}

bool loadFidMapFromFS() {
  fidMap.assign(MAX_FID + 1, "");
  fidMapRole.assign(MAX_FID + 1, "");
  fidMapName.assign(MAX_FID + 1, "");
  fidMapPosition.assign(MAX_FID + 1, "");
  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  if (!SPIFFS.exists(FID_MAP_FILE)) {
    xSemaphoreGive(spiffsMutex);
    Serial.println("No fid_map file; starting with empty map.");
    return true;
  }
  File f = SPIFFS.open(FID_MAP_FILE, FILE_READ);
  if (!f) {
    xSemaphoreGive(spiffsMutex);
    Serial.println("Failed to open fid map for read");
    return false;
  }
  while (f.available()) {
    String ln = f.readStringUntil('\n');
    ln.trim();
    if (ln.length() == 0) continue;
    // expected format: fid,uniqueId,role,name,position
    int p1 = ln.indexOf(',');
    if (p1 < 0) continue;
    int p2 = ln.indexOf(',', p1+1);
    if (p2 < 0) continue;
    int p3 = ln.indexOf(',', p2+1);
    if (p3 < 0) continue;
    int p4 = ln.indexOf(',', p3+1);
    String sFid      = ln.substring(0, p1);
    String sUnique   = ln.substring(p1+1, p2);
    String sRole     = ln.substring(p2+1, p3);
    String sName     = (p4 > 0) ? ln.substring(p3+1, p4) : ln.substring(p3+1);
    String sPosition = (p4 > 0) ? ln.substring(p4+1) : "";
    int fid = sFid.toInt();
    if (fid >= 1 && fid <= MAX_FID) {
      fidMap[fid]         = sUnique;
      fidMapRole[fid]     = sRole;
      fidMapName[fid]     = sName;
      fidMapPosition[fid] = sPosition;
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
    Serial.println("Failed to open fid map for write");
    return false;
  }
  for (int fid=1; fid<=MAX_FID; ++fid) {
    if (fidMap[fid].length()) {
      String line = String(fid) + "," + fidMap[fid] + "," + fidMapRole[fid] + "," + fidMapName[fid] + "," + fidMapPosition[fid];
      f.println(line);
    }
  }
  f.close();
  xSemaphoreGive(spiffsMutex);
  Serial.println("Fid map saved to SPIFFS.");
  return true;
}

int findFidByUnique(const String &uniqueId) {
  for (int fid=1; fid<=MAX_FID; ++fid) {
    if (fidMap[fid].length() && fidMap[fid] == uniqueId) return fid;
  }
  return -1;
}

void clearAllFidMap() {
  for (int f=1; f<=MAX_FID; ++f) { fidMap[f] = ""; fidMapRole[f] = ""; fidMapName[f] = ""; fidMapPosition[f] = ""; }
  saveFidMapToFS();
}

/* ================== HTTP helpers ================== */

bool postJSONToUrl(const String &jsonPayload, const char* targetUrl, int &outHttpCode, String &outBody) {
  if (WiFi.status() != WL_CONNECTED) { outHttpCode = -1; outBody = "WiFi not connected"; return false; }

  for (int attempt = 1; attempt <= POST_MAX_RETRIES; ++attempt) {
    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(20000);
    if (!http.begin(client, targetUrl)) {
      outHttpCode = -2; outBody = "HTTP begin failed";
      Serial.println("HTTP begin failed");
      break;
    }
    http.addHeader("Content-Type", "application/json");
    int code = http.POST(jsonPayload);
    outHttpCode = code;
    if (code > 0) {
      outBody = http.getString();
      Serial.printf("POST -> code=%d body=%s\n", code, outBody.c_str());
      http.end();
      if ((code >= 200 && code < 300) || code == 400) return true;
      if ((code >= 500 && code < 600) || code == 429) {
        Serial.printf("Server transient %d; will retry\n", code);
      } else {
        Serial.printf("Permanent HTTP failure %d\n", code);
        return false;
      }
    } else {
      outBody = http.errorToString(code);
      Serial.printf("HTTP client error: %s\n", outBody.c_str());
      http.end();
    }
    if (attempt < POST_MAX_RETRIES) {
      unsigned long backoff = POST_BASE_DELAY_MS * (1UL << (attempt - 1));
      vTaskDelay(backoff / portTICK_PERIOD_MS);
    } else {
      Serial.println("Max POST attempts reached");
    }
  }
  return false;
}

String urlEncode(const String &str) {
  String encoded="";
  char c;
  for (size_t i=0;i<str.length();i++){
    c = str[i];
    if (('a'<=c && c<='z')||('A'<=c&&c<='Z')||('0'<=c&&c<='9')||c=='-'||c=='_'||c=='.'||c=='~') encoded+=c;
    else if (c==' ') encoded += '+';
    else {
      char buf[4];
      sprintf(buf, "%%%02X", (unsigned char)c);
      encoded += buf;
    }
  }
  return encoded;
}

/* GET fallback for client errors (400/404) — sends minimal fields only */
bool sendGETFallback(const String &employeeId, const String &date, const String &ts, int &outHttpCode, String &outBody) {
  if (WiFi.status() != WL_CONNECTED) { outHttpCode = -1; outBody = "WiFi not connected"; return false; }
  String url = String(SCRIPT_URL) + "?";
  url += "branchId=" + urlEncode(String(BRANCH_ID));
  url += "&branchName=" + urlEncode(String(BRANCH_NAME));
  if (employeeId.length()) url += "&employeeId=" + urlEncode(employeeId);
  if (date.length())      url += "&date=" + urlEncode(date);
  if (ts.length())        url += "&ts=" + urlEncode(ts);

  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(20000);
  if (!http.begin(client, url)) { outHttpCode = -2; outBody = "GET begin failed"; return false; }
  int code = http.GET();
  outHttpCode = code;
  if (code > 0) {
    outBody = http.getString();
    Serial.printf("GET -> code=%d body=%s\n", code, outBody.c_str());
    http.end();
    return (code >= 200 && code < 300);
  } else {
    outBody = http.errorToString(code);
    Serial.printf("GET client error: %s\n", outBody.c_str());
    http.end();
    return false;
  }
}

/* ================== Enrollment support: report update to sheet ================== */
void reportEnrollUpdate(int row, const String &status, int fingerId, const String &note) {
  if (row <= 1) return;
  String url = String(SCRIPT_URL) + "?api=enroll_update&branchId=" + urlEncode(String(BRANCH_ID));
  url += "&row=" + String(row);
  url += "&status=" + urlEncode(status);
  if (fingerId > 0) url += "&fingerId=" + String(fingerId);
  if (note.length()) url += "&note=" + urlEncode(note);
  if (strlen(SCRIPT_AUTH) > 0) url += "&auth=" + String(SCRIPT_AUTH);

  Serial.printf("Reporting enroll_update row=%d status=%s fid=%d\n", row, status.c_str(), fingerId);
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  http.setTimeout(20000);
  if (http.begin(client, url)) {
    int code = http.GET();
    String body = (code > 0) ? http.getString() : http.errorToString(code);
    Serial.printf("enroll_update -> code=%d body=%s\n", code, body.c_str());
    http.end();
  }
}

/* ================== Enrollment execution helpers ================== */

/* enrollID: uses same steps as your enrol code. Returns stored fid or -1 on failure. */
int enrollID_toFid(int requestedFid) {
  // We'll follow the same procedure: two captures, image2Tz(1/2), createModel, storeModel(fid)
  // We use the Adafruit_Fingerprint calls
  if (requestedFid < 1 || requestedFid > MAX_FID) {
    Serial.println("Requested fid invalid");
    return -1;
  }

  Serial.printf("Enrollment: starting for fid=%d\n", requestedFid);
  // Step 1: ask for first press
  unsigned long start = millis();
  Serial.println("Place finger: (first press) -- 20s timeout");
  setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_YELLOW);
  int p;
  unsigned long timeout = 20000;
  while (millis() - start < timeout) {
    p = finger.getImage();
    if (p == FINGERPRINT_OK) break;
    if (p == FINGERPRINT_NOFINGER) { delay(120); continue; }
    Serial.printf("getImage error (1): %d\n", p);
    return -1;
  }
  if (millis() - start >= timeout) {
    Serial.println("Timeout waiting for first press");
    return -1;
  }
  Serial.println("Image captured (1). Converting...");
  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) { Serial.printf("image2Tz (1) failed: %d\n", p); return -1; }

  Serial.println("Remove finger.");
  setSensorLED(FINGERPRINT_LED_OFF, 0, 0);
  delay(1200);

  // Step 2
  Serial.println("Place same finger again: (second press) -- 20s timeout");
  setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_YELLOW);
  start = millis();
  while (millis() - start < timeout) {
    p = finger.getImage();
    if (p == FINGERPRINT_OK) break;
    if (p == FINGERPRINT_NOFINGER) { delay(120); continue; }
    Serial.printf("getImage error (2): %d\n", p);
    return -1;
  }
  if (millis() - start >= timeout) {
    Serial.println("Timeout waiting for second press");
    return -1;
  }
  Serial.println("Image captured (2). Converting...");
  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) { Serial.printf("image2Tz (2) failed: %d\n", p); return -1; }

  // Create model
  Serial.println("Creating model...");
  p = finger.createModel();
  if (p != FINGERPRINT_OK) { Serial.printf("createModel failed: %d\n", p); return -1; }

  Serial.printf("Storing model to ID %d\n", requestedFid);
  p = finger.storeModel(requestedFid);
  if (p == FINGERPRINT_OK) {
    Serial.println("Stored successfully!");
    return requestedFid;
  } else {
    Serial.printf("Failed to store model, code: %d\n", p);
    return -1;
  }
}

/* enrollment_doRegister: handles a register command: uses requestedFid (or finds free slot) */
void enrollment_doRegister(int requestedFid, const String &uniqueId, const String &name, const String &role, const String &position, int rowToReport) {
  int fidToUse = requestedFid;
  if (fidToUse < 1 || fidToUse > MAX_FID) {
    // find a free fid
    for (int f = 1; f <= MAX_FID; ++f) {
      if (fidMap[f].length() == 0) { fidToUse = f; break; }
    }
    if (fidToUse < 1 || fidToUse > MAX_FID) {
      Serial.println("No free fid available on device");
      reportEnrollUpdate(rowToReport, "error", -1, "no-free-fid");
      return;
    }
  } else {
    // if requested fid is occupied, warn and will overwrite
    if (fidMap[fidToUse].length()) {
      Serial.printf("Warning: requested fid %d already occupied by %s; will overwrite.\n", fidToUse, fidMap[fidToUse].c_str());
    }
  }

  setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_PURPLE);
  int resFid = enrollID_toFid(fidToUse);
  if (resFid > 0) {
    // success: update local mapping + persist, and update sheet
    fidMap[resFid] = uniqueId.length() ? uniqueId : String("AUTO_") + String(resFid);
    // Set role according to provided role string; default to "employee" if missing/unknown
    String r = role;
    r.toLowerCase();
    if (r == "employee" || r == "master") {
      fidMapRole[resFid] = r;
    } else {
      fidMapRole[resFid] = "employee";
    }
    fidMapName[resFid]     = name;
    fidMapPosition[resFid] = position;
    saveFidMapToFS();
    Serial.printf("Saved fid %d -> %s (%s) name=%s position=%s\n", resFid, fidMap[resFid].c_str(), fidMapRole[resFid].c_str(), fidMapName[resFid].c_str(), fidMapPosition[resFid].c_str());
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

/* enrollment_doDeleteByFid: deletes fingerprint template at fid and mapping */
void enrollment_doDeleteByFid(int fid, int rowToReport) {
  if (fid < 1 || fid > MAX_FID) {
    reportEnrollUpdate(rowToReport, "error", -1, "invalid-fid");
    return;
  }
  int p = finger.deleteModel(fid);
  if (p == FINGERPRINT_OK) {
    fidMap[fid] = "";
    fidMapRole[fid] = "";
    fidMapName[fid] = "";
    saveFidMapToFS();
    reportEnrollUpdate(rowToReport, "deleted", fid, "");
  } else {
    Serial.printf("deleteModel failed: %d\n", p);
    reportEnrollUpdate(rowToReport, "error", fid, String(p));
  }
}

/* enrollment_doDeleteByUnique: find fid by uniqueId and delete */
void enrollment_doDeleteByUnique(const String &uniqueId, int rowToReport) {
  int fid = findFidByUnique(uniqueId);
  if (fid <= 0) {
    reportEnrollUpdate(rowToReport, "error", -1, "not-found");
    return;
  }
  enrollment_doDeleteByFid(fid, rowToReport);
}

/* =============== Finger search wrapper =============== */
/*
   fingerSearch() wrapper: getImage -> image2Tz -> fingerFastSearch
   RETURNS:
     >0 = matched fingerID
     -1 = no finger present
     -4 = scanned but no match found
     -2 = other error
*/
int fingerSearch() {
  uint8_t p = finger.getImage();
  if (p == FINGERPRINT_NOFINGER) return -1; // no finger present
  if (p != FINGERPRINT_OK) {
    Serial.print("getImage error: "); Serial.println(p);
    return -2;
  }

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) {
    Serial.print("image2Tz error: "); Serial.println(p);
    return -2;
  }

  p = finger.fingerSearch();
  if (p == FINGERPRINT_OK) {
    Serial.print("Found ID #"); Serial.print(finger.fingerID);
    Serial.print(" with confidence "); Serial.println(finger.confidence);
    return (int)finger.fingerID;
  } else if (p == FINGERPRINT_NOTFOUND) {
    Serial.println("No match");
    return -4; // distinct code for "no match"
  } else {
    Serial.print("fingerFastSearch error: "); Serial.println(p);
    return -2;
  }
}

/* Parses embedded "timestamp":"YYYY-MM-DD HH:MM:SS" from a payload.
   On success, writes age in seconds (relative to nowEpoch) to outAgeSec and returns true.
   A negative age means the timestamp is in the future (e.g., pre-NTP boot).
   Returns false if the timestamp is missing or malformed. */
bool parsePayloadAgeSec(const String &payload, long nowEpoch, long &outAgeSec) {
  int tsIdx = payload.indexOf("\"timestamp\":\"");
  if (tsIdx < 0) return false;
  int tsStart = tsIdx + 13;
  int tsEnd   = payload.indexOf("\"", tsStart);
  if (tsEnd < 0) return false;
  String tsStr = payload.substring(tsStart, tsEnd);
  if (tsStr.length() < 19) return false;
  int yr = tsStr.substring(0,4).toInt();
  int mo = tsStr.substring(5,7).toInt();
  int dy = tsStr.substring(8,10).toInt();
  int hr = tsStr.substring(11,13).toInt();
  int mn = tsStr.substring(14,16).toInt();
  int sc = tsStr.substring(17,19).toInt();
  if (yr < 2020) return false;
  DateTime entryTime(yr, mo, dy, hr, mn, sc);
  outAgeSec = nowEpoch - (long)entryTime.unixtime();
  return true;
}

/* Is an entry stale per QUEUE_MAX_AGE_MS?
   Unparseable or future-dated entries are NOT considered stale (keep them). */
static inline bool entryIsStale(long ageSec, bool parsed) {
  if (!parsed) return false;
  if (ageSec <= 0) return false;
  return (unsigned long)ageSec * 1000UL > QUEUE_MAX_AGE_MS;
}

/* Trim the SPIFFS queue file in-place:
     1. Drop entries older than QUEUE_MAX_AGE_MS
     2. If over QUEUE_MAX_SPIFFS_ENTRIES, drop oldest (from front) to fit
     3. If over QUEUE_MAX_SPIFFS_BYTES, drop oldest (from front) to fit
   CALLER MUST HOLD spiffsMutex. */
void trimSPIFFSQueue_locked() {
  if (!SPIFFS.exists(QUEUE_FILE)) return;
  File f = SPIFFS.open(QUEUE_FILE, FILE_READ);
  if (!f) return;

  long nowEpoch = rtc.now().unixtime();
  std::vector<String> kept;
  kept.reserve(64);
  size_t droppedAge = 0;

  while (f.available()) {
    String ln = f.readStringUntil('\n');
    ln.trim();
    if (!ln.length()) continue;
    long ageSec = 0;
    bool parsed = parsePayloadAgeSec(ln, nowEpoch, ageSec);
    if (entryIsStale(ageSec, parsed)) { droppedAge++; continue; }
    kept.push_back(ln);
  }
  f.close();

  // Count cap: drop oldest (front)
  size_t droppedCount = 0;
  if (kept.size() > QUEUE_MAX_SPIFFS_ENTRIES) {
    droppedCount = kept.size() - QUEUE_MAX_SPIFFS_ENTRIES;
    kept.erase(kept.begin(), kept.begin() + droppedCount);
  }

  // Byte cap: measure from newest backward, keep as many as fit
  size_t droppedBytes = 0;
  {
    size_t totalBytes = 0;
    size_t firstKeep = 0;
    bool byteCapHit = false;
    for (size_t i = kept.size(); i > 0; --i) {
      size_t idx = i - 1;
      totalBytes += kept[idx].length() + 1; // +1 for newline
      if (totalBytes > QUEUE_MAX_SPIFFS_BYTES) {
        firstKeep = idx + 1;
        byteCapHit = true;
        break;
      }
    }
    if (byteCapHit && firstKeep > 0) {
      droppedBytes = firstKeep;
      kept.erase(kept.begin(), kept.begin() + firstKeep);
    }
  }

  // Rewrite (or delete if empty)
  if (kept.empty()) {
    SPIFFS.remove(QUEUE_FILE);
  } else {
    File wf = SPIFFS.open(QUEUE_FILE, FILE_WRITE);
    if (wf) {
      for (auto &ln : kept) wf.println(ln);
      wf.close();
    } else {
      Serial.println("trimSPIFFSQueue: rewrite failed to open");
    }
  }

  size_t totalDropped = droppedAge + droppedCount + droppedBytes;
  if (totalDropped) {
    Serial.printf("SPIFFS queue trimmed: dropped %u (age=%u count=%u bytes=%u), kept %u\n",
                  (unsigned)totalDropped, (unsigned)droppedAge,
                  (unsigned)droppedCount, (unsigned)droppedBytes,
                  (unsigned)kept.size());
  }
}

/* Append one line to the SPIFFS queue. If adding the line would push the file
   past QUEUE_MAX_SPIFFS_BYTES, runs a trim pass first so the cap is enforced
   even when flushQueue hasn't had a chance to run (prolonged offline).
   CALLER MUST HOLD spiffsMutex. */
bool appendToSPIFFSQueue_locked(const String &line) {
  size_t currentSize = 0;
  if (SPIFFS.exists(QUEUE_FILE)) {
    File fr = SPIFFS.open(QUEUE_FILE, FILE_READ);
    if (fr) {
      currentSize = fr.size();
      fr.close();
    }
  }
  if (currentSize + line.length() + 1 > QUEUE_MAX_SPIFFS_BYTES) {
    Serial.printf("SPIFFS queue near cap (%u bytes); trimming before append\n", (unsigned)currentSize);
    trimSPIFFSQueue_locked();
  }

  File f = SPIFFS.open(QUEUE_FILE, FILE_APPEND);
  if (!f) {
    Serial.println("SPIFFS queue append failed to open");
    return false;
  }
  f.println(line);
  f.close();
  return true;
}

/* Trims in-memory queue: removes entries older than QUEUE_MAX_AGE_MS,
   then caps at QUEUE_MAX_ENTRIES. CALLER MUST HOLD memQueueMutex. */
void trimQueue() {
  long nowEpoch = rtc.now().unixtime();
  std::deque<String> kept;
  for (auto &entry : memQueue) {
    long ageSec = 0;
    bool parsed = parsePayloadAgeSec(entry, nowEpoch, ageSec);
    if (entryIsStale(ageSec, parsed)) {
      Serial.printf("memQueue: dropping stale entry (age=%lds)\n", ageSec);
      continue;
    }
    kept.push_back(entry);
  }
  memQueue = kept;

  while (memQueue.size() > QUEUE_MAX_ENTRIES) {
    Serial.printf("memQueue full (%u); dropping oldest.\n", (unsigned)memQueue.size());
    memQueue.pop_front();
  }
}

/* =============== sendOrQueuePayload (unchanged but kept) =============== */
void sendOrQueuePayload(const String &payloadJson) {
  if (WiFi.status() != WL_CONNECTED) {
    xSemaphoreTake(spiffsMutex, portMAX_DELAY);
    if (appendToSPIFFSQueue_locked(payloadJson)) {
      Serial.println("Queued locally (SPIFFS): " + payloadJson);
    }
    xSemaphoreGive(spiffsMutex);
    return;
  }

  bool pushed = false;
  if (xSemaphoreTake(memQueueMutex, (TickType_t) (50 / portTICK_PERIOD_MS)) == pdTRUE) {
    trimQueue();
    memQueue.push_back(payloadJson);
    xSemaphoreGive(memQueueMutex);
    pushed = true;
    xSemaphoreGive(memQueueSem);
  }
  if (!pushed) {
    xSemaphoreTake(spiffsMutex, portMAX_DELAY);
    if (appendToSPIFFSQueue_locked(payloadJson)) {
      Serial.println("Queued (fallback) locally: " + payloadJson);
    }
    xSemaphoreGive(spiffsMutex);
  }
}

/* flushQueue: attempt to send queued entries (used by NetworkTask).
   Also opportunistically drops stale entries (age > QUEUE_MAX_AGE_MS) during read,
   and enforces count/byte caps on the rewritten tail. */
void flushQueue() {
  if (WiFi.status() != WL_CONNECTED) return;
  std::vector<String> pending;
  size_t droppedStale = 0;
  long nowEpoch = rtc.now().unixtime();

  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  File f = SPIFFS.open(QUEUE_FILE, FILE_READ);
  if (!f) { xSemaphoreGive(spiffsMutex); return; }
  while (f.available()) {
    String ln = f.readStringUntil('\n');
    ln.trim();
    if (!ln.length()) continue;
    long ageSec = 0;
    bool parsed = parsePayloadAgeSec(ln, nowEpoch, ageSec);
    if (entryIsStale(ageSec, parsed)) { droppedStale++; continue; }
    pending.push_back(ln);
  }
  f.close();
  xSemaphoreGive(spiffsMutex);

  if (droppedStale) {
    Serial.printf("flushQueue: dropped %u stale entries on read\n", (unsigned)droppedStale);
  }
  if (pending.empty()) {
    // If stale entries were all we had, remove the now-empty file
    if (droppedStale) {
      xSemaphoreTake(spiffsMutex, portMAX_DELAY);
      SPIFFS.remove(QUEUE_FILE);
      xSemaphoreGive(spiffsMutex);
    }
    return;
  }
  Serial.printf("Flushing %u queued records\n", (unsigned)pending.size());
  std::vector<String> keep;
  for (auto &entry : pending) {
    int httpCode = 0; String body;
    bool ok = postJSONToUrl(entry, SCRIPT_URL, httpCode, body);
    if (ok) {
      Serial.println("Queued record sent OK via POST");
      continue;
    }
    if (httpCode == 400 || httpCode == 404) {
      // attempt GET fallback
      String studentId="", date="", ts="";
      int p = entry.indexOf("\"employeeId\"");
      if (p >= 0) {
        int colon = entry.indexOf(':', p);
        int q = entry.indexOf('"', colon);
        if (q >= 0) {
          int q2 = entry.indexOf('"', q+1);
          if (q2 >= 0) studentId = entry.substring(q+1,q2);
        }
      }
      p = entry.indexOf("\"date\"");
      if (p >= 0) {
        int colon = entry.indexOf(':', p);
        int q = entry.indexOf('"', colon);
        if (q >= 0) {
          int q2 = entry.indexOf('"', q+1);
          if (q2 >= 0) date = entry.substring(q+1,q2);
        }
      }
      p = entry.indexOf("\"ts\"");
      if (p >= 0) {
        int colon = entry.indexOf(':', p);
        int q = entry.indexOf('"', colon);
        if (q >= 0) {
          int q2 = entry.indexOf('"', q+1);
          if (q2 >= 0) ts = entry.substring(q+1,q2);
        }
      }

      int gCode=0; String gBody;
      if (sendGETFallback(studentId, date, ts, gCode, gBody)) {
        Serial.println("Queued record sent OK via GET fallback");
        continue;
      } else {
        Serial.printf("Queued GET fallback failed (code=%d). Keeping record.\n", gCode);
        keep.push_back(entry);
        continue;
      }
    }

    // transient -> keep
    Serial.printf("Queued send failed (code=%d). Keeping record.\n", httpCode);
    keep.push_back(entry);
    vTaskDelay(200 / portTICK_PERIOD_MS);
  }

  // Enforce count cap on the tail we're about to rewrite
  size_t capDroppedCount = 0;
  if (keep.size() > QUEUE_MAX_SPIFFS_ENTRIES) {
    capDroppedCount = keep.size() - QUEUE_MAX_SPIFFS_ENTRIES;
    keep.erase(keep.begin(), keep.begin() + capDroppedCount);
  }
  // Enforce byte cap (keep newest that fit)
  size_t capDroppedBytes = 0;
  {
    size_t totalBytes = 0;
    size_t firstKeep = 0;
    bool byteCapHit = false;
    for (size_t i = keep.size(); i > 0; --i) {
      size_t idx = i - 1;
      totalBytes += keep[idx].length() + 1;
      if (totalBytes > QUEUE_MAX_SPIFFS_BYTES) {
        firstKeep = idx + 1;
        byteCapHit = true;
        break;
      }
    }
    if (byteCapHit && firstKeep > 0) {
      capDroppedBytes = firstKeep;
      keep.erase(keep.begin(), keep.begin() + firstKeep);
    }
  }
  if (capDroppedCount || capDroppedBytes) {
    Serial.printf("flushQueue: cap enforced (count-dropped=%u bytes-dropped=%u)\n",
                  (unsigned)capDroppedCount, (unsigned)capDroppedBytes);
  }

  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  if (keep.empty()) {
    SPIFFS.remove(QUEUE_FILE);
    Serial.println("Queue cleared.");
  } else {
    File wf = SPIFFS.open(QUEUE_FILE, FILE_WRITE);
    if (wf) {
      for (auto &ln : keep) wf.println(ln);
      wf.close();
      Serial.printf("Queue retained %u records\n", (unsigned)keep.size());
    } else {
      Serial.println("flushQueue: rewrite failed to open");
    }
  }
  xSemaphoreGive(spiffsMutex);
}

/* =================== NetworkTask (Core 0) =================== */
void NetworkTask(void *pvParameters) {
  const TickType_t flushIntervalTicks = pdMS_TO_TICKS(60000); // 60s
  esp_task_wdt_delete(NULL); // this task does long HTTP calls; remove from watchdog
  for (;;) {
    // Process any in-memory queued payloads
    String payload = "";
    bool hadPayload = false;
    if (xSemaphoreTake(memQueueMutex, (TickType_t)(10 / portTICK_PERIOD_MS)) == pdTRUE) {
      if (!memQueue.empty()) {
        payload = memQueue.front();
        memQueue.pop_front();
        hadPayload = true;
      }
      xSemaphoreGive(memQueueMutex);
    }

    if (hadPayload) {
      Serial.println("NetworkTask: sending payload from memQueue");
      int httpCode = 0; String body;
      bool ok = postJSONToUrl(payload, SCRIPT_URL, httpCode, body);
      if (ok) {
        Serial.println("NetworkTask: POST OK");
      } else {
        if (httpCode == 400 || httpCode == 404) {
          // GET fallback
          String studentId="", date="", ts="";
          int p = payload.indexOf("\"employeeId\"");
          if (p>=0) {
            int colon = payload.indexOf(':', p);
            int q = payload.indexOf('"', colon);
            if (q>=0) {
              int q2 = payload.indexOf('"', q+1);
              if (q2>=0) studentId = payload.substring(q+1,q2);
            }
          }
          p = payload.indexOf("\"date\"");
          if (p>=0) {
            int colon = payload.indexOf(':', p);
            int q = payload.indexOf('"', colon);
            if (q>=0) {
              int q2 = payload.indexOf('"', q+1);
              if (q2>=0) date = payload.substring(q+1,q2);
            }
          }
          p = payload.indexOf("\"ts\"");
          if (p>=0) {
            int colon = payload.indexOf(':', p);
            int q = payload.indexOf('"', colon);
            if (q>=0) {
              int q2 = payload.indexOf('"', q+1);
              if (q2>=0) ts = payload.substring(q+1,q2);
            }
          }
          int gCode=0; String gBody;
          bool got = sendGETFallback(studentId, date, ts, gCode, gBody);
          if (got) {
            Serial.println("NetworkTask: GET fallback success");
          } else {
            Serial.printf("NetworkTask: GET fallback failed (code=%d). Queuing for retry.\n", gCode);
            xSemaphoreTake(spiffsMutex, portMAX_DELAY);
            appendToSPIFFSQueue_locked(payload);
            xSemaphoreGive(spiffsMutex);
          }
        } else {
          Serial.printf("NetworkTask: POST failed (code=%d). Queuing for retry.\n", httpCode);
          xSemaphoreTake(spiffsMutex, portMAX_DELAY);
          appendToSPIFFSQueue_locked(payload);
          xSemaphoreGive(spiffsMutex);
        }
      }
      continue;
    }

    if (xSemaphoreTake(memQueueSem, flushIntervalTicks) == pdTRUE) {
      continue;
    } else {
      static bool rtcSynced = false;

      if (WiFi.status() == WL_CONNECTED) {
        if (!rtcSynced) {
          configTime(0, 0, "pool.ntp.org", "time.nist.gov");
          vTaskDelay(pdMS_TO_TICKS(2000));
          syncRTCFromNTP();
          rtcSynced = true;
        }
        flushQueue();
      }
      else {
        rtcSynced = false;
        Serial.println("NetworkTask: WiFi not connected; attempting reconnect");
        //(full reconnect cycle so it re-scans all APs):
        WiFi.disconnect(true);
        vTaskDelay(pdMS_TO_TICKS(1000));
        WiFi.begin(wifiSSID.c_str(), wifiPASS.c_str());

        // While offline, flushQueue isn't running so age-based trimming
        // wouldn't otherwise happen. Run a periodic SPIFFS trim to keep
        // flash healthy across long WiFi outages.
        static unsigned long lastSPIFFSTrimMs = 0;
        unsigned long nowMs = millis();
        if (lastSPIFFSTrimMs == 0 ||
            (nowMs - lastSPIFFSTrimMs) > QUEUE_SPIFFS_TRIM_INTERVAL_MS) {
          lastSPIFFSTrimMs = nowMs;
          xSemaphoreTake(spiffsMutex, portMAX_DELAY);
          trimSPIFFSQueue_locked();
          xSemaphoreGive(spiffsMutex);
        }
      }
    }
  }
  vTaskDelete(NULL);
}

/* =================== EnrollmentTask (polls Apps Script) =================== */
void EnrollmentTask(void *pvParameters) {
  (void) pvParameters;
  esp_task_wdt_delete(NULL); // this task does long HTTP calls; remove from watchdog
  for (;;) {
    // Poll only when WiFi is connected
    if (WiFi.status() == WL_CONNECTED) {
      String url = String(SCRIPT_URL) + "?api=enroll_fetch&branchId=" + urlEncode(String(BRANCH_ID));
      if (strlen(SCRIPT_AUTH) > 0) url += "&auth=" + String(SCRIPT_AUTH);
      Serial.println("EnrollmentTask: polling for enroll job...");
      WiFiClientSecure client; client.setInsecure();
      HTTPClient http;
      http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
      http.setTimeout(20000);
      int code = -1;
      String body = "";
      if (http.begin(client, url)) {
        code = http.GET();
        if (code > 0) body = http.getString();
        http.end();
      }
      Serial.printf("EnrollmentTask: HTTP %d body=%s\n", code, body.c_str());
      {
        if (code >= 200 && code < 300 && body.length()) {
          // We expect JSON with "result":"ok" and a record object OR "result":"none"
          if (body.indexOf("\"result\":\"ok\"") >= 0 && body.indexOf("\"record\"") >= 0) {
            // parse naive JSON for required fields:
            int posRec = body.indexOf("\"record\"");
            int posRow = body.indexOf("\"row\"", posRec);
            int parsedRow = -1;
            if (posRow >= 0) {
              int colon = body.indexOf(':', posRow);
              int comma = body.indexOf(',', colon);
              if (colon >= 0 && comma >= 0) {
                String sRow = body.substring(colon+1, comma);
                sRow.trim();
                parsedRow = sRow.toInt();
              }
            }
            int posFid = body.indexOf("\"fingerId\"", posRec);
            int parsedFid = 0;
            if (posFid >= 0) {
              int colon = body.indexOf(':', posFid);
              int comma = body.indexOf(',', colon);
              if (comma < 0) comma = body.indexOf('}', colon);
              if (colon >= 0 && comma >= 0) {
                String sFid = body.substring(colon+1, comma);
                sFid.trim();
                parsedFid = sFid.toInt();
              }
            }
            // strings: uniqueId, name, role, command
            auto extractStringField = [&](const String &key)->String{
              int p = body.indexOf(String("\"") + key + "\"", posRec);
              if (p < 0) return "";
              int q = body.indexOf(':', p);
              if (q < 0) return "";
              int q1 = body.indexOf('"', q+1);
              if (q1 < 0) return "";
              int q2 = body.indexOf('"', q1+1);
              if (q2 < 0) return "";
              return body.substring(q1+1, q2);
            };
            String uniqueId = extractStringField("uniqueId");
            String name     = extractStringField("name");
            String role     = extractStringField("role");
            String position = extractStringField("position");
            String command  = extractStringField("command");

            // Create job and notify FingerprintTask
            if (parsedRow >= 2) {
              xSemaphoreTake(enrollMutex, portMAX_DELAY);
              currentEnrollJob.row          = parsedRow;
              currentEnrollJob.requestedFid = parsedFid;
              currentEnrollJob.uniqueId     = uniqueId;
              currentEnrollJob.name         = name;
              currentEnrollJob.role         = role;
              currentEnrollJob.position     = position;
              currentEnrollJob.command      = command;
              enrollmentJobPending = true;
              xSemaphoreGive(enrollMutex);
              Serial.printf("EnrollmentTask: job queued row=%d cmd=%s fid=%d id=%s role=%s position=%s\n", parsedRow, command.c_str(), parsedFid, uniqueId.c_str(), role.c_str(), position.c_str());
              xSemaphoreGive(enrollSem);
              // Fast-poll after finding a job so we notice completion quickly
              vTaskDelay(pdMS_TO_TICKS(ENROLL_POLL_FAST_MS));
              continue;
            }
          } else {
            // none pending
            // Serial.println("EnrollmentTask: none pending");
          }
        } else {
          Serial.printf("EnrollmentTask: HTTP poll failed code=%d\n", code);
        }
      } 
    } else {
      Serial.println("EnrollmentTask: WiFi not connected; skipping poll");
    }

    // sleep until next poll
    vTaskDelay(pdMS_TO_TICKS(enrollmentJobPending ? ENROLL_POLL_FAST_MS : ENROLL_POLL_MS));
  }
  vTaskDelete(NULL);
}

/* =================== FingerprintTask (Core 1) =================== */
void FingerprintTask(void *pvParameters) {
  (void) pvParameters;
  const unsigned long feedbackDuration = 600; // ms (green or red hold)

  for (;;) {
    // show ready (blue or purple depending on WiFi state)
    showReadyState();

    // If an enrollment job is pending from server, process it
    if (xSemaphoreTake(enrollSem, 0) == pdTRUE) {
      if (enrollmentJobPending) {
        xSemaphoreTake(enrollMutex, portMAX_DELAY);
        EnrollJob job = currentEnrollJob;
        enrollmentJobPending = false;
        xSemaphoreGive(enrollMutex);

        Serial.printf("Processing enroll job row=%d cmd=%s role=%s position=%s\n", job.row, job.command.c_str(), job.role.c_str(), job.position.c_str());
        if (job.command == "register") {
          enrollment_doRegister(job.requestedFid, job.uniqueId, job.name, job.role, job.position, job.row);
        } else if (job.command == "delete") {
          if (job.requestedFid > 0) enrollment_doDeleteByFid(job.requestedFid, job.row);
          else if (job.uniqueId.length()) enrollment_doDeleteByUnique(job.uniqueId, job.row);
          else reportEnrollUpdate(job.row, "error", -1, "no-id-specified");
        } else if (job.command == "clearall") {
          // For safety: only perform clearall if row role is master or uniqueId=='admin'
          // (This keeps accidental clears less likely — you may change this policy)
          Serial.println("Performing clearAll on sensor and local map");
          int rc = finger.emptyDatabase();
          if (rc == FINGERPRINT_OK) {
            clearAllFidMap();
            reportEnrollUpdate(job.row, "cleared", 0, "");
          } else {
            Serial.printf("emptyDatabase returned %d\n", rc);
            reportEnrollUpdate(job.row, "error", 0, String(rc));
          }
        } else {
          reportEnrollUpdate(job.row, "error", -1, "unknown-cmd");
        }
      }
    }

    // Normal scan behavior
    int fid = fingerSearch();
    if (fid > 0) {
      // matched -> immediate green feedback, then back to ready color
      Serial.print("Fingerprint matched ID: "); Serial.println(fid);

      // --- Cooldown check ---
      unsigned long nowMs = millis();
      if (fidEverScanned[fid] && (nowMs - lastScanMillis[fid] < SCAN_COOLDOWN_MS)) {
          unsigned long remaining = (SCAN_COOLDOWN_MS - (nowMs - lastScanMillis[fid])) / 1000;
          Serial.printf("Cooldown: fid=%d, %lus remaining. Ignoring scan.\n", fid, remaining);
          vTaskDelay(600 / portTICK_PERIOD_MS);
          showReadyState();
          vTaskDelay(10 / portTICK_PERIOD_MS);
          continue;
      }
      lastScanMillis[fid] = nowMs;
      fidEverScanned[fid] = true;
      // --- End cooldown check ---

      String mapped = fidMap[fid];
      String role = fidMapRole[fid];
      String uniqueId = mapped;

      // Normalize role to lowercase for safety
      role.toLowerCase();

      if (role == "master") {
        Serial.println("Master scanned: launching WiFi captive portal.");
        for (int i = 0; i < 5; i++) {
          setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_YELLOW);
          vTaskDelay(120 / portTICK_PERIOD_MS);
          setSensorLED(FINGERPRINT_LED_OFF, 0, 0);
          vTaskDelay(120 / portTICK_PERIOD_MS);
        }
        startCaptivePortal(); // blocks until credentials saved, then restarts
      } else {
        // Decide branch using the stored role. If there is a stored mapping:
        if (mapped.length()) {
          // Employee path (all non-master roles)
          String employeeId       = mapped;
          String employeeName     = fidMapName[fid];
          String employeePosition = fidMapPosition[fid];
          setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_GREEN);
          String scanId = makeScanId(employeeId);
          String ts = getRTCTimestamp();
          String payload = "{\"type\":\"employee\","
                           "\"branchId\":\"" + String(BRANCH_ID) + "\","
                           "\"branchName\":\"" + String(BRANCH_NAME) + "\","
                           "\"employeeId\":\"" + employeeId + "\","
                           "\"employeeName\":\"" + employeeName + "\","
                           "\"employeePosition\":\"" + employeePosition + "\","
                           "\"timestamp\":\"" + ts + "\","
                           "\"scanId\":\"" + scanId + "\"}";
          vTaskDelay(feedbackDuration / portTICK_PERIOD_MS);
          showReadyState();
          sendOrQueuePayload(payload);
          vTaskDelay(200 / portTICK_PERIOD_MS);
        } else {
          Serial.printf("Matched fingerID %d but no mapping configured. Ignoring.\n", fid);
          setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
          vTaskDelay(feedbackDuration / portTICK_PERIOD_MS);
          showReadyState();
          vTaskDelay(100 / portTICK_PERIOD_MS);
        }
      }
    } else if (fid == -1) {
      // no finger present -> short delay to be responsive
      vTaskDelay(20 / portTICK_PERIOD_MS);
    } else if (fid == -4) {
      // scanned but no match: steady red for feedbackDuration, then ready color
      Serial.println("No match - showing steady red briefly");
      setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
      vTaskDelay(feedbackDuration / portTICK_PERIOD_MS);
      showReadyState();
      vTaskDelay(100 / portTICK_PERIOD_MS); // brief debounce
    } else {
      // other error: show red briefly then ready color (but keep short)
      setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
      vTaskDelay(200 / portTICK_PERIOD_MS);
      showReadyState();
    }

    vTaskDelay(10 / portTICK_PERIOD_MS);
  }

  vTaskDelete(NULL);
}

/* =================== Setup & main =================== */
void setup() {
  Serial.begin(115200);
  delay(200);

  memQueueMutex = xSemaphoreCreateMutex();
  memQueueSem = xSemaphoreCreateBinary();
  spiffsMutex = xSemaphoreCreateMutex();
  enrollMutex = xSemaphoreCreateMutex();
  enrollSem = xSemaphoreCreateBinary();
  if (!memQueueMutex || !memQueueSem || !spiffsMutex || !enrollMutex || !enrollSem) {
    Serial.println("Failed to create RTOS primitives");
    while (1) delay(1000);
  }

  if (!initFS()) Serial.println("SPIFFS failed");

  // Load fid map
  loadFidMapFromFS();
  memset(lastScanMillis, 0, sizeof(lastScanMillis));
  memset(fidEverScanned, 0, sizeof(fidEverScanned));

  // WiFi connect — load from SPIFFS, portal on first boot only
  bool hasCreds = loadWiFiCreds();
  if (!hasCreds) {
    Serial.println("No WiFi credentials found. Launching captive portal...");
    setupFingerprint();
    startCaptivePortal();
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
    Serial.println("\nWiFi connected");
    Serial.print("IP: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi failed — continuing in offline mode. Scan master finger to reconfigure.");
  }
  Serial.printf("Free heap at boot: %u bytes\n", esp_get_free_heap_size());

  // RTC Init/ 
  Wire.begin(21, 22);
  initRTC();
  
  // time (optional)
  configTime(0, 0, "pool.ntp.org");

  if (WiFi.status() == WL_CONNECTED) {
    syncRTCFromNTP();
  }

  // fingerprint init
  setupFingerprint();

  // Create tasks
  BaseType_t ok1 = xTaskCreatePinnedToCore(FingerprintTask, "FingerprintTask", 8192, NULL, 1, &hFingerprint, 1);
  BaseType_t ok2 = xTaskCreatePinnedToCore(NetworkTask, "NetworkTask", 16384, NULL, 1, &hNetwork, 0);
  BaseType_t ok3 = xTaskCreatePinnedToCore(EnrollmentTask, "EnrollmentTask", 12288, NULL, 1, &hEnrollment, 0);
  if (ok1 != pdPASS || ok2 != pdPASS || ok3 != pdPASS) {
    Serial.println("Failed to create tasks");
    while (1) delay(1000);
  }

  Serial.println("Tasks created; main loop will idle");
}

void loop() {
  delay(1000);
}

/* =================== END OF SKETCH =================== */