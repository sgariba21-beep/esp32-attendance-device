/*
  ESP32 Attendance client — R503 fingerprint edition (dual-core optimized)
  WITH enrollment polling + master-triggered enrollment mode + fid mapping in SPIFFS
  (LED: fingerprint-only feedback — green/red briefly)

  Device identity (device_id, institution_id, device_secret, display_name) is
  provisioned at runtime via /register → /assignment-poll, then stored in SPIFFS.
  No compile-time class/institution coupling.
*/

/* ========= CONFIG ========== */

// Cloud Supabase edge function endpoints (same URL for every institution)
const char* SUPABASE_URL        = "https://lxpemewonievaazboyez.supabase.co/functions/v1/log-attendance";
const char* ENROLL_GET_URL      = "https://lxpemewonievaazboyez.supabase.co/functions/v1/get-enrollment-job";
const char* ENROLL_UPD_URL      = "https://lxpemewonievaazboyez.supabase.co/functions/v1/update-enrollment-job";
const char* REGISTER_URL        = "https://lxpemewonievaazboyez.supabase.co/functions/v1/register";
const char* ASSIGNMENT_POLL_URL = "https://lxpemewonievaazboyez.supabase.co/functions/v1/assignment-poll";

// Bootstrap secret (x-bootstrap-secret, used only on /register + /assignment-poll)
// and the TLS root CA bundle now live in separate per-deployment headers kept OUT
// of source control / filled before flashing:
//   secrets.h → #define BOOTSTRAP_SECRET "..."      (rotated; matches Supabase env)
//   certs.h   → const char* ROOT_CA_BUNDLE = "..."  (TLS certificate validation, C4)
// See secrets.example.h and certs.h for setup instructions.
#include "secrets.h"
#include "certs.h"

// SPIFFS file written by NetworkTask after dashboard assignment
#define DEVICE_IDENTITY_FILE "/device_identity.json"
// SPIFFS file holding device_id + provisioning_token while awaiting assignment (H7),
// so a reboot during the pending window does not lose the token.
#define PROVISIONING_FILE "/provisioning.json"

/* ========= OTA CONFIG ========= */
#define FIRMWARE_VERSION  "1.2.0"         // increment on each flash (1.2.0: TLS validation, provisioning token, JSON escaping)
#define OTA_REPO_API      "https://api.github.com/repos/sgariba21-beep/esp32-attendance-device/releases/latest"
#define OTA_TAG_PREFIX    "firmware-v"    // was "OLAG-v" before Phase 3
/* ============================== */

/* Fingerprint UART pins */
#define R503_RX_PIN 16
#define R503_TX_PIN 17
#define R503_BAUD   57600

/* LED control constants */
#define FINGERPRINT_LED_OFF       0x00
#define FINGERPRINT_LED_ON        0x01
#define FINGERPRINT_LED_FLASHING  0x02
#define FINGERPRINT_LED_BREATHING 0x03

#define FINGERPRINT_LED_RED    0x01
#define FINGERPRINT_LED_BLUE   0x02
#define FINGERPRINT_LED_PURPLE 0x03
#define FINGERPRINT_LED_GREEN  0x04
#define FINGERPRINT_LED_WHITE  0x06
#define FINGERPRINT_LED_YELLOW 0x05

/* Constants */
#define MAX_FID 127
#define SCAN_COOLDOWN_MS 60000UL
#define ENROLL_POLL_MS 10000UL
#define ENROLL_POLL_FAST_MS 2000UL
#define QUEUE_FILE         "/queue.txt"
#define QUEUE_INFLIGHT_FILE "/queue_inflight.txt"  // T2/T12: rotate-then-process
#define FID_MAP_FILE "/fid_map.csv"   // fid,uniqueId,role,name
#define WIFI_CREDS_FILE "/wifi_creds.json"
#define AP_SSID  "Attendance-Setup"
#define AP_PASS  "setup1234"
#define DNS_PORT 53
#define QUEUE_MAX_ENTRIES   200
#define QUEUE_MAX_AGE_MS    (7UL * 24 * 3600 * 1000)
#define QUEUE_MAX_SPIFFS_ENTRIES      1000
#define QUEUE_MAX_SPIFFS_BYTES        (256UL * 1024UL)
#define QUEUE_SPIFFS_TRIM_INTERVAL_MS (5UL * 60UL * 1000UL)

#define SCAN_LOG_FILE "/scan_log.txt"
#define SCAN_LOG_MAX_BYTES (200UL * 1024UL)

/* ============ END CONFIG ================ */

#include <WiFi.h>
#include "esp_wifi.h"
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPIFFS.h>
#include <time.h>
#include <vector>
#include <string>
#include <Adafruit_Fingerprint.h>
#include <Wire.h>
#include <RTClib.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "esp_task_wdt.h"
#include <Update.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

RTC_DS3231 rtc;

HardwareSerial r503Serial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&r503Serial);

/* Synchronisation primitives */
// memQueueMutex removed (T2/T12): SPIFFS is now the sole queue; spiffsMutex guards it.
SemaphoreHandle_t memQueueSem   = NULL;  // binary signal: FingerprintTask → NetworkTask
SemaphoreHandle_t spiffsMutex   = NULL;
SemaphoreHandle_t enrollMutex   = NULL;
SemaphoreHandle_t enrollSem     = NULL;

String wifiSSID = "";
String wifiPASS = "";

/* Runtime device identity — populated from SPIFFS or provisioning poll */
String deviceId      = "";
String institutionId = "";
String deviceSecret  = "";
String displayName   = "";
String provisioningToken = "";            // H7: required by /assignment-poll before secret release
volatile bool pendingAssignment = false;  // true until dashboard assigns this device

TaskHandle_t hFingerprint = NULL;
TaskHandle_t hNetwork     = NULL;
TaskHandle_t hEnrollment  = NULL;

std::vector<String> fidMap;
std::vector<String> fidMapRole;
std::vector<String> fidMapName;

struct EnrollJob {
  String id;
  String studentId;
  String uniqueId;
  String name;
  String fingerSlot;
  String command;
  int    requestedFid;
};
volatile bool enrollmentJobPending = false;
EnrollJob currentEnrollJob;

volatile bool otaInProgress = false;

static unsigned long lastScanMillis[MAX_FID + 1];
static bool fidEverScanned[MAX_FID + 1];

/* Forward declarations */
void showReadyState();
void setSensorLED(uint8_t mode, uint8_t speed, uint8_t color);
int fingerSearch();
String makeScanId(const String &id);
void queueAndSignal(const String &payloadJson);
bool initFS();
bool loadFidMapFromFS();
bool saveFidMapToFS();
int findFidByUnique(const String &uniqueId);
void clearAllFidMap();
int enrollID_toFid(int requestedFid);
void enrollment_doRegister(const EnrollJob &job, const String &role);
void enrollment_doDeleteByFid(const EnrollJob &job, int fid);
void enrollment_doDeleteByUnique(const EnrollJob &job);
void reportEnrollUpdate(const String &jobId, const String &status, int fingerId,
                        const String &note, const String &fingerSlot, const String &studentId);
bool initRTC();
void syncRTCFromNTP();
String getRTCTimestamp();
bool parsePayloadAgeSec(const String &payload, long nowEpoch, long &outAgeSec);
void trimSPIFFSQueue_locked();
bool appendToSPIFFSQueue_locked(const String &line);
void flushQueue();
static void recoverInflightQueue();

#define POST_MAX_RETRIES   3
#define POST_BASE_DELAY_MS 500
#define POST_TIMEOUT_MS    30000

bool postJSONToUrl(const String &jsonPayload, const char* targetUrl, int &outHttpCode, String &outBody);
bool postJSONBootstrap(const String &jsonPayload, const char* targetUrl, int &outHttpCode, String &outBody);
bool loadDeviceIdentity();
void saveDeviceIdentity();
bool registerDevice();
bool pollAssignment();
String jsonEscape(const String &s);
bool loadProvisioning();
void saveProvisioning();
void clearProvisioning();

/* ---------------- LED helpers ---------------- */

void setSensorLED(uint8_t mode, uint8_t speed, uint8_t color) {
  finger.LEDcontrol(mode, speed, color);
}

void setSensorLED(int mode) {
  if (mode == 1) { setSensorLED(FINGERPRINT_LED_ON,        0,  FINGERPRINT_LED_GREEN); return; }
  if (mode == 2) { setSensorLED(FINGERPRINT_LED_BREATHING, 25, FINGERPRINT_LED_GREEN); return; }
  if (mode == 3) { setSensorLED(FINGERPRINT_LED_BREATHING, 25, FINGERPRINT_LED_RED);   return; }
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

/* ================== Device Identity (SPIFFS) ================== */
bool loadDeviceIdentity() {
  if (!SPIFFS.exists(DEVICE_IDENTITY_FILE)) return false;
  File f = SPIFFS.open(DEVICE_IDENTITY_FILE, FILE_READ);
  if (!f) return false;
  String json = f.readString();
  f.close();

  auto extractStr = [&](const String &key) -> String {
    String search = "\"" + key + "\":\"";
    int p = json.indexOf(search);
    if (p < 0) return "";
    int start = p + search.length();
    int end = json.indexOf('"', start);
    if (end < 0) return "";
    return json.substring(start, end);
  };

  deviceId      = extractStr("device_id");
  institutionId = extractStr("institution_id");
  deviceSecret  = extractStr("device_secret");
  displayName   = extractStr("display_name");

  return deviceId.length() > 0 && institutionId.length() > 0;
}

// M9: escape a string for safe inclusion inside a JSON string literal. Without
// this, a display_name / member sid containing a " or \ corrupts the JSON we
// write to SPIFFS or POST to the server.
String jsonEscape(const String &s) {
  String out;
  out.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); ++i) {
    char c = s[i];
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n";  break;
      case '\r': out += "\\r";  break;
      case '\t': out += "\\t";  break;
      default:
        if ((unsigned char)c < 0x20) {
          char buf[7];
          sprintf(buf, "\\u%04x", c);
          out += buf;
        } else {
          out += c;
        }
    }
  }
  return out;
}

void saveDeviceIdentity() {
  File f = SPIFFS.open(DEVICE_IDENTITY_FILE, FILE_WRITE);
  if (!f) { Serial.println("Failed to write device identity"); return; }
  f.print("{\"device_id\":\"" + jsonEscape(deviceId) +
          "\",\"institution_id\":\"" + jsonEscape(institutionId) +
          "\",\"device_secret\":\"" + jsonEscape(deviceSecret) +
          "\",\"display_name\":\"" + jsonEscape(displayName) + "\"}");
  f.close();
  Serial.println("Device identity saved: " + deviceId + " / " + displayName);
}

// H7: persist device_id + provisioning_token while the device is pending so a
// reboot before assignment doesn't lose the token (the token is required by
// /assignment-poll to retrieve the institution device_secret).
void saveProvisioning() {
  File f = SPIFFS.open(PROVISIONING_FILE, FILE_WRITE);
  if (!f) { Serial.println("Failed to write provisioning file"); return; }
  f.print("{\"device_id\":\"" + jsonEscape(deviceId) +
          "\",\"provisioning_token\":\"" + jsonEscape(provisioningToken) + "\"}");
  f.close();
}

bool loadProvisioning() {
  if (!SPIFFS.exists(PROVISIONING_FILE)) return false;
  File f = SPIFFS.open(PROVISIONING_FILE, FILE_READ);
  if (!f) return false;
  String json = f.readString();
  f.close();

  auto extractStr = [&](const String &key) -> String {
    String search = "\"" + key + "\":\"";
    int p = json.indexOf(search);
    if (p < 0) return "";
    int start = p + search.length();
    int end = json.indexOf('"', start);
    if (end < 0) return "";
    return json.substring(start, end);
  };

  deviceId          = extractStr("device_id");
  provisioningToken = extractStr("provisioning_token");
  return deviceId.length() > 0 && provisioningToken.length() > 0;
}

void clearProvisioning() {
  if (SPIFFS.exists(PROVISIONING_FILE)) SPIFFS.remove(PROVISIONING_FILE);
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
<p style="color:#555;font-size:14px;">Enter the WiFi details for this attendance device. Device identity (unit, institution) is assigned from the dashboard — not here.</p>
<div class="lbl">WiFi Name (SSID)</div>
<input type="text" id="ssid" placeholder="WiFi network name" autocomplete="off"/>
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
  esp_task_wdt_delete(NULL);

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

String makeScanId(const String &id) {
  DateTime now = rtc.now();
  char buf[32];
  sprintf(buf, "scan-%04d%02d%02d%02d%02d%02d-",
          now.year(), now.month(), now.day(),
          now.hour(), now.minute(), now.second());
  return String(buf) + id;
}

bool initRTC() {
  if (!rtc.begin()) { Serial.println("RTC not found"); return false; }
  if (rtc.lostPower()) Serial.println("RTC lost power, will sync when WiFi available");
  Serial.println("RTC initialized");
  return true;
}

void syncRTCFromNTP() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo, 10000)) { Serial.println("Failed to get NTP time"); return; }
  rtc.adjust(DateTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                      timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec));
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

void appendScanLog(const String &entry) {
  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  if (SPIFFS.exists(SCAN_LOG_FILE)) {
    File check = SPIFFS.open(SCAN_LOG_FILE, FILE_READ);
    if (check && check.size() > SCAN_LOG_MAX_BYTES) {
      check.close();
      SPIFFS.remove(SCAN_LOG_FILE);
      Serial.println("Scan log trimmed (size limit reached)");
    } else if (check) {
      check.close();
    }
  }
  File f = SPIFFS.open(SCAN_LOG_FILE, FILE_APPEND);
  if (f) { f.println(entry); f.close(); }
  xSemaphoreGive(spiffsMutex);
}

/* ================== SPIFFS Fid Map ================== */

bool initFS() {
  if (!SPIFFS.begin(true)) { Serial.println("SPIFFS mount failed"); return false; }
  return true;
}

bool loadFidMapFromFS() {
  fidMap.assign(MAX_FID + 1, "");
  fidMapRole.assign(MAX_FID + 1, "");
  fidMapName.assign(MAX_FID + 1, "");
  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  if (!SPIFFS.exists(FID_MAP_FILE)) {
    xSemaphoreGive(spiffsMutex);
    Serial.println("No fid_map file; starting with empty map.");
    return true;
  }
  File f = SPIFFS.open(FID_MAP_FILE, FILE_READ);
  if (!f) { xSemaphoreGive(spiffsMutex); Serial.println("Failed to open fid map for read"); return false; }
  while (f.available()) {
    String ln = f.readStringUntil('\n');
    ln.trim();
    if (ln.length() == 0) continue;
    int p1 = ln.indexOf(',');
    if (p1 < 0) continue;
    int p2 = ln.indexOf(',', p1+1);
    if (p2 < 0) continue;
    int p3 = ln.indexOf(',', p2+1);
    String sFid   = ln.substring(0, p1);
    String sUniq  = ln.substring(p1+1, p2);
    String sRole  = (p3>0) ? ln.substring(p2+1, p3) : ln.substring(p2+1);
    String sName  = (p3>0) ? ln.substring(p3+1) : "";
    int fid = sFid.toInt();
    if (fid >= 1 && fid <= MAX_FID) {
      fidMap[fid]     = sUniq;
      fidMapRole[fid] = sRole;
      fidMapName[fid] = sName;
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
  if (!f) { xSemaphoreGive(spiffsMutex); Serial.println("Failed to open fid map for write"); return false; }
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

int findFidByUnique(const String &uniqueId) {
  for (int fid = 1; fid <= MAX_FID; ++fid) {
    if (fidMap[fid].length() && fidMap[fid] == uniqueId) return fid;
  }
  return -1;
}

void clearAllFidMap() {
  for (int f = 1; f <= MAX_FID; ++f) { fidMap[f] = ""; fidMapRole[f] = ""; fidMapName[f] = ""; }
  saveFidMapToFS();
}

/* ================== HTTP helpers ================== */

// All device-facing function calls (attendance, enrollment).
// Uses the runtime deviceSecret global as x-device-secret.
bool postJSONToUrl(const String &jsonPayload, const char* targetUrl, int &outHttpCode, String &outBody) {
  if (WiFi.status() != WL_CONNECTED) { outHttpCode = -1; outBody = "WiFi not connected"; return false; }

  for (int attempt = 1; attempt <= POST_MAX_RETRIES; ++attempt) {
    WiFiClientSecure client;
    client.setCACert(ROOT_CA_BUNDLE);  // C4: validate the server certificate
    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(20000);
    if (!http.begin(client, targetUrl)) {
      outHttpCode = -2; outBody = "HTTP begin failed";
      Serial.println("HTTP begin failed");
      break;
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-secret", deviceSecret);
    int code = http.POST(jsonPayload);
    outHttpCode = code;
    if (code > 0) {
      outBody = http.getString();
      Serial.printf("POST -> code=%d body=%s\n", code, outBody.c_str());
      http.end();
      if (code >= 200 && code < 300) return true;
      if (code >= 500 || code == 429) {
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
      vTaskDelay(pdMS_TO_TICKS(POST_BASE_DELAY_MS * (1UL << (attempt - 1))));
    } else {
      Serial.println("Max POST attempts reached");
    }
  }
  return false;
}

// Provisioning calls (/register, /assignment-poll) — uses BOOTSTRAP_SECRET.
bool postJSONBootstrap(const String &jsonPayload, const char* targetUrl, int &outHttpCode, String &outBody) {
  if (WiFi.status() != WL_CONNECTED) { outHttpCode = -1; outBody = "WiFi not connected"; return false; }

  for (int attempt = 1; attempt <= POST_MAX_RETRIES; ++attempt) {
    WiFiClientSecure client;
    client.setCACert(ROOT_CA_BUNDLE);  // C4: validate the server certificate
    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(20000);
    if (!http.begin(client, targetUrl)) {
      outHttpCode = -2; outBody = "HTTP begin failed";
      break;
    }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-bootstrap-secret", BOOTSTRAP_SECRET);
    int code = http.POST(jsonPayload);
    outHttpCode = code;
    if (code > 0) {
      outBody = http.getString();
      Serial.printf("Bootstrap POST -> code=%d body=%s\n", code, outBody.c_str());
      http.end();
      if (code >= 200 && code < 300) return true;
      if (code >= 500 || code == 429) {
        Serial.printf("Server transient %d; will retry\n", code);
      } else {
        Serial.printf("Permanent HTTP failure %d\n", code);
        return false;
      }
    } else {
      outBody = http.errorToString(code);
      Serial.printf("Bootstrap HTTP client error: %s\n", outBody.c_str());
      http.end();
    }
    if (attempt < POST_MAX_RETRIES) {
      vTaskDelay(pdMS_TO_TICKS(POST_BASE_DELAY_MS * (1UL << (attempt - 1))));
    }
  }
  return false;
}

/* ================== Provisioning ================== */

// Calls /register with device MAC. Sets deviceId.
// If the server returns status="assigned" immediately, also sets institution fields
// and writes device_identity.json. Sets pendingAssignment=true if status="pending".
// Returns true if the HTTP call succeeded.
bool registerDevice() {
  uint8_t mac[6];
  esp_wifi_get_mac(WIFI_IF_STA, mac);
  char macStr[18];
  sprintf(macStr, "%02X:%02X:%02X:%02X:%02X:%02X",
          mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

  String payload = "{\"mac\":\"" + String(macStr) + "\"}";
  int code = 0; String body = "";
  Serial.println("Registering device with MAC: " + String(macStr));

  if (!postJSONBootstrap(payload, REGISTER_URL, code, body)) {
    Serial.printf("register HTTP failed (code=%d)\n", code);
    return false;
  }

  auto extractStr = [&](const String &key) -> String {
    String search = "\"" + key + "\":\"";
    int p = body.indexOf(search);
    if (p < 0) return "";
    int start = p + search.length();
    int end = body.indexOf('"', start);
    if (end < 0) return "";
    return body.substring(start, end);
  };

  deviceId = extractStr("device_id");
  if (deviceId.length() == 0) {
    Serial.println("register: no device_id in response");
    return false;
  }

  String status = extractStr("status");
  Serial.printf("Registered: device_id=%s status=%s\n", deviceId.c_str(), status.c_str());

  if (status == "assigned") {
    institutionId = extractStr("institution_id");
    deviceSecret  = extractStr("device_secret");
    displayName   = extractStr("display_name");
    saveDeviceIdentity();
    clearProvisioning();
    // T9: ensure all identity writes are visible to NetworkTask on Core 0 before
    // clearing the flag. Without a compiler barrier the assignments above could
    // be reordered past the store to pendingAssignment by the compiler.
    __asm__ volatile("" ::: "memory");
    pendingAssignment = false;
  } else {
    // H7: capture and persist the provisioning token so /assignment-poll can
    // later prove this device's identity to retrieve the device_secret.
    provisioningToken = extractStr("provisioning_token");
    saveProvisioning();
    pendingAssignment = true;
  }
  return true;
}

// Polls /assignment-poll with deviceId. On assignment, sets institution globals,
// writes device_identity.json, and clears pendingAssignment.
// Returns true if now assigned.
bool pollAssignment() {
  if (WiFi.status() != WL_CONNECTED || deviceId.length() == 0) return false;

  // H7: send the provisioning token so the server releases the device_secret
  // only to the device that registered.
  String payload = "{\"device_id\":\"" + jsonEscape(deviceId) +
                   "\",\"provisioning_token\":\"" + jsonEscape(provisioningToken) + "\"}";
  int code = 0; String body = "";

  if (!postJSONBootstrap(payload, ASSIGNMENT_POLL_URL, code, body)) return false;

  auto extractStr = [&](const String &key) -> String {
    String search = "\"" + key + "\":\"";
    int p = body.indexOf(search);
    if (p < 0) return "";
    int start = p + search.length();
    int end = body.indexOf('"', start);
    if (end < 0) return "";
    return body.substring(start, end);
  };

  String status = extractStr("status");
  if (status != "assigned") return false;

  institutionId = extractStr("institution_id");
  deviceSecret  = extractStr("device_secret");
  displayName   = extractStr("display_name");

  if (institutionId.length() == 0 || deviceSecret.length() == 0) {
    Serial.println("pollAssignment: assigned but missing institution fields");
    return false;
  }

  saveDeviceIdentity();
  clearProvisioning();
  // T9: compiler barrier — all identity stores must be globally visible before
  // NetworkTask observes pendingAssignment == false on the other core.
  __asm__ volatile("" ::: "memory");
  pendingAssignment = false;
  Serial.printf("Assigned! institution_id=%s display_name=%s\n",
                institutionId.c_str(), displayName.c_str());
  return true;
}

/* ================== Enrollment support ================== */
void reportEnrollUpdate(const String &jobId, const String &status, int fingerId,
                        const String &note, const String &fingerSlot, const String &studentId) {
  if (jobId.length() == 0) return;

  // M9: escape every interpolated value (note especially can contain free text).
  // T1e: include device_id so update-enrollment-job can authenticate via per-device secret.
  String payload = "{\"id\":\"" + jsonEscape(jobId) + "\",\"device_id\":\"" + jsonEscape(deviceId) +
                   "\",\"institution_id\":\"" + jsonEscape(institutionId) +
                   "\",\"status\":\"" + jsonEscape(status) + "\"";
  if (fingerId > 0)        payload += ",\"fid\":"            + String(fingerId);
  if (note.length())       payload += ",\"note\":\""         + jsonEscape(note)       + "\"";
  if (fingerSlot.length()) payload += ",\"finger_slot\":\"" + jsonEscape(fingerSlot) + "\"";
  if (studentId.length())  payload += ",\"student_id\":\""  + jsonEscape(studentId)  + "\"";
  payload += "}";

  Serial.printf("reportEnrollUpdate: jobId=%s status=%s fid=%d\n",
                jobId.c_str(), status.c_str(), fingerId);
  int httpCode = 0; String body;
  postJSONToUrl(payload, ENROLL_UPD_URL, httpCode, body);
  Serial.printf("update-enrollment-job -> code=%d body=%s\n", httpCode, body.c_str());
}

/* ================== Enrollment execution ================== */

int enrollID_toFid(int requestedFid) {
  if (requestedFid < 1 || requestedFid > MAX_FID) {
    Serial.println("Requested fid invalid");
    return -1;
  }

  Serial.printf("Enrollment: starting for fid=%d\n", requestedFid);
  unsigned long timeout = 20000;

  Serial.println("Place finger: (first press) -- 20s timeout");
  setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_YELLOW);
  unsigned long start = millis();
  int p;
  while (millis() - start < timeout) {
    p = finger.getImage();
    if (p == FINGERPRINT_OK) break;
    if (p == FINGERPRINT_NOFINGER) { delay(120); continue; }
    Serial.printf("getImage error (1): %d\n", p);
    return -1;
  }
  if (millis() - start >= timeout) { Serial.println("Timeout (first press)"); return -1; }

  Serial.println("Image captured (1). Converting...");
  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) { Serial.printf("image2Tz (1) failed: %d\n", p); return -1; }

  Serial.println("Remove finger.");
  setSensorLED(FINGERPRINT_LED_OFF, 0, 0);
  delay(1200);

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
  if (millis() - start >= timeout) { Serial.println("Timeout (second press)"); return -1; }

  Serial.println("Image captured (2). Converting...");
  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) { Serial.printf("image2Tz (2) failed: %d\n", p); return -1; }

  Serial.println("Creating model...");
  p = finger.createModel();
  if (p != FINGERPRINT_OK) { Serial.printf("createModel failed: %d\n", p); return -1; }

  Serial.printf("Storing model to ID %d\n", requestedFid);
  p = finger.storeModel(requestedFid);
  if (p == FINGERPRINT_OK) { Serial.println("Stored successfully!"); return requestedFid; }
  Serial.printf("Failed to store model, code: %d\n", p);
  return -1;
}

void enrollment_doRegister(const EnrollJob &job, const String &role) {
  int fidToUse = job.requestedFid;
  if (fidToUse < 1 || fidToUse > MAX_FID) {
    for (int f = 1; f <= MAX_FID; ++f) {
      if (fidMap[f].length() == 0) { fidToUse = f; break; }
    }
    if (fidToUse < 1 || fidToUse > MAX_FID) {
      Serial.println("No free fid available on device");
      reportEnrollUpdate(job.id, "failed", -1, "no-free-fid", job.fingerSlot, job.studentId);
      return;
    }
  } else {
    if (fidMap[fidToUse].length())
      Serial.printf("Warning: fid %d already occupied by %s; will overwrite.\n",
                    fidToUse, fidMap[fidToUse].c_str());
  }

  setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_PURPLE);
  int resFid = enrollID_toFid(fidToUse);
  if (resFid > 0) {
    fidMap[resFid]     = job.uniqueId.length() ? job.uniqueId : String("AUTO_") + String(resFid);
    fidMapRole[resFid] = role;
    fidMapName[resFid] = job.name;
    saveFidMapToFS();
    Serial.printf("Saved fid %d -> %s name=%s\n", resFid, fidMap[resFid].c_str(), fidMapName[resFid].c_str());
    setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_GREEN);
    vTaskDelay(800 / portTICK_PERIOD_MS);
    showReadyState();
    reportEnrollUpdate(job.id, "completed", resFid, "", job.fingerSlot, job.studentId);
  } else {
    setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
    vTaskDelay(800 / portTICK_PERIOD_MS);
    showReadyState();
    reportEnrollUpdate(job.id, "failed", -1, "enroll-failed", job.fingerSlot, job.studentId);
  }
}

void enrollment_doDeleteByFid(const EnrollJob &job, int fid) {
  if (fid < 1 || fid > MAX_FID) {
    reportEnrollUpdate(job.id, "failed", -1, "invalid-fid", job.fingerSlot, job.studentId);
    return;
  }
  int p = finger.deleteModel(fid);
  if (p == FINGERPRINT_OK) {
    fidMap[fid] = ""; fidMapRole[fid] = ""; fidMapName[fid] = "";
    saveFidMapToFS();
    reportEnrollUpdate(job.id, "completed", fid, "", job.fingerSlot, job.studentId);
  } else {
    Serial.printf("deleteModel failed: %d\n", p);
    reportEnrollUpdate(job.id, "failed", fid, String(p), job.fingerSlot, job.studentId);
  }
}

void enrollment_doDeleteByUnique(const EnrollJob &job) {
  int fid = findFidByUnique(job.uniqueId);
  if (fid <= 0) {
    reportEnrollUpdate(job.id, "failed", -1, "not-found", job.fingerSlot, job.studentId);
    return;
  }
  enrollment_doDeleteByFid(job, fid);
}

/* =============== Finger search =============== */
int fingerSearch() {
  uint8_t p = finger.getImage();
  if (p == FINGERPRINT_NOFINGER) return -1;
  if (p != FINGERPRINT_OK) { Serial.print("getImage error: "); Serial.println(p); return -2; }

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) { Serial.print("image2Tz error: "); Serial.println(p); return -2; }

  p = finger.fingerSearch();
  if (p == FINGERPRINT_OK) {
    Serial.print("Found ID #"); Serial.print(finger.fingerID);
    Serial.print(" confidence "); Serial.println(finger.confidence);
    return (int)finger.fingerID;
  } else if (p == FINGERPRINT_NOTFOUND) {
    Serial.println("No match"); return -4;
  } else {
    Serial.print("fingerFastSearch error: "); Serial.println(p); return -2;
  }
}

/* =============== Queue age helpers =============== */
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

static inline bool entryIsStale(long ageSec, bool parsed) {
  if (!parsed) return false;
  if (ageSec <= 0) return false;
  return (unsigned long)ageSec * 1000UL > QUEUE_MAX_AGE_MS;
}

/* =============== SPIFFS queue management =============== */
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

  size_t droppedCount = 0;
  if (kept.size() > QUEUE_MAX_SPIFFS_ENTRIES) {
    droppedCount = kept.size() - QUEUE_MAX_SPIFFS_ENTRIES;
    kept.erase(kept.begin(), kept.begin() + droppedCount);
  }

  size_t droppedBytes = 0;
  {
    size_t totalBytes = 0, firstKeep = 0;
    bool byteCapHit = false;
    for (size_t i = kept.size(); i > 0; --i) {
      size_t idx = i - 1;
      totalBytes += kept[idx].length() + 1;
      if (totalBytes > QUEUE_MAX_SPIFFS_BYTES) { firstKeep = idx + 1; byteCapHit = true; break; }
    }
    if (byteCapHit && firstKeep > 0) {
      droppedBytes = firstKeep;
      kept.erase(kept.begin(), kept.begin() + firstKeep);
    }
  }

  if (kept.empty()) {
    SPIFFS.remove(QUEUE_FILE);
  } else {
    File wf = SPIFFS.open(QUEUE_FILE, FILE_WRITE);
    if (wf) { for (auto &ln : kept) wf.println(ln); wf.close(); }
    else Serial.println("trimSPIFFSQueue: rewrite failed to open");
  }

  size_t totalDropped = droppedAge + droppedCount + droppedBytes;
  if (totalDropped)
    Serial.printf("SPIFFS queue trimmed: dropped %u (age=%u count=%u bytes=%u), kept %u\n",
                  (unsigned)totalDropped, (unsigned)droppedAge,
                  (unsigned)droppedCount, (unsigned)droppedBytes, (unsigned)kept.size());
}

bool appendToSPIFFSQueue_locked(const String &line) {
  size_t currentSize = 0;
  if (SPIFFS.exists(QUEUE_FILE)) {
    File fr = SPIFFS.open(QUEUE_FILE, FILE_READ);
    if (fr) { currentSize = fr.size(); fr.close(); }
  }
  if (currentSize + line.length() + 1 > QUEUE_MAX_SPIFFS_BYTES) {
    Serial.printf("SPIFFS queue near cap (%u bytes); trimming before append\n", (unsigned)currentSize);
    trimSPIFFSQueue_locked();
  }
  File f = SPIFFS.open(QUEUE_FILE, FILE_APPEND);
  if (!f) { Serial.println("SPIFFS queue append failed to open"); return false; }
  f.println(line);
  f.close();
  return true;
}

// T2/T12: SPIFFS is the single source of truth — no memQueue.
// Append payload to SPIFFS for durability, then signal NetworkTask for
// immediate low-latency delivery. FingerprintTask calls this on Core 1.
void queueAndSignal(const String &payloadJson) {
  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  if (appendToSPIFFSQueue_locked(payloadJson)) {
    Serial.println("[queue] Persisted to SPIFFS: " + payloadJson);
  }
  xSemaphoreGive(spiffsMutex);
  // Non-blocking give: if NetworkTask is mid-flush the signal is latched and
  // will be consumed at the start of the next loop iteration.
  xSemaphoreGive(memQueueSem);
}

// T2/T12: rotate-then-process flush. Under the lock we rename QUEUE_FILE to
// QUEUE_INFLIGHT_FILE, releasing the lock immediately so FingerprintTask can
// keep appending to a fresh QUEUE_FILE while we do the network I/O without
// holding spiffsMutex. Failures are re-appended to QUEUE_FILE at the end.
// Crash-safe: recoverInflightQueue() in setup() merges any orphaned inflight
// file back into QUEUE_FILE on next boot.
void flushQueue() {
  if (WiFi.status() != WL_CONNECTED) return;

  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  if (!SPIFFS.exists(QUEUE_FILE)) {
    xSemaphoreGive(spiffsMutex);
    return;
  }
  bool renamed = SPIFFS.rename(QUEUE_FILE, QUEUE_INFLIGHT_FILE);
  xSemaphoreGive(spiffsMutex);

  if (!renamed) {
    Serial.println("flushQueue: rotate rename failed");
    return;
  }

  // Read + filter the inflight snapshot — no lock needed here; only this
  // function creates or deletes QUEUE_INFLIGHT_FILE.
  std::vector<String> pending;
  size_t droppedStale = 0;
  long nowEpoch = rtc.now().unixtime();

  File f = SPIFFS.open(QUEUE_INFLIGHT_FILE, FILE_READ);
  if (f) {
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
  }

  if (droppedStale) Serial.printf("flushQueue: dropped %u stale entries\n", (unsigned)droppedStale);

  if (pending.empty()) {
    SPIFFS.remove(QUEUE_INFLIGHT_FILE);
    return;
  }

  Serial.printf("Flushing %u queued records\n", (unsigned)pending.size());
  std::vector<String> keep;
  for (auto &entry : pending) {
    int httpCode = 0; String body;
    bool ok = postJSONToUrl(entry, SUPABASE_URL, httpCode, body);
    if (ok) { Serial.printf("flushQueue: sent OK\n"); continue; }
    if (httpCode >= 500 || httpCode == 429 || httpCode < 0) {
      Serial.printf("flushQueue: transient (code=%d). Keeping record.\n", httpCode);
      keep.push_back(entry);
    } else {
      Serial.printf("flushQueue: permanent failure (code=%d). Dropping record.\n", httpCode);
    }
    vTaskDelay(200 / portTICK_PERIOD_MS);
  }

  // Enforce count cap on what we're about to re-append.
  size_t capDroppedCount = 0;
  if (keep.size() > QUEUE_MAX_SPIFFS_ENTRIES) {
    capDroppedCount = keep.size() - QUEUE_MAX_SPIFFS_ENTRIES;
    keep.erase(keep.begin(), keep.begin() + capDroppedCount);
  }
  // Enforce byte cap (keep newest that fit).
  size_t capDroppedBytes = 0;
  {
    size_t totalBytes = 0, firstKeep = 0;
    bool byteCapHit = false;
    for (size_t i = keep.size(); i > 0; --i) {
      size_t idx = i - 1;
      totalBytes += keep[idx].length() + 1;
      if (totalBytes > QUEUE_MAX_SPIFFS_BYTES) { firstKeep = idx + 1; byteCapHit = true; break; }
    }
    if (byteCapHit && firstKeep > 0) { capDroppedBytes = firstKeep; keep.erase(keep.begin(), keep.begin() + firstKeep); }
  }
  if (capDroppedCount || capDroppedBytes)
    Serial.printf("flushQueue: cap enforced (count-dropped=%u bytes-dropped=%u)\n",
                  (unsigned)capDroppedCount, (unsigned)capDroppedBytes);

  // Re-append transient failures to the live QUEUE_FILE. New scans that arrived
  // during the network send are already in QUEUE_FILE — we append, not overwrite.
  if (!keep.empty()) {
    xSemaphoreTake(spiffsMutex, portMAX_DELAY);
    for (auto &ln : keep) appendToSPIFFSQueue_locked(ln);
    xSemaphoreGive(spiffsMutex);
    Serial.printf("flushQueue: re-queued %u transient failures\n", (unsigned)keep.size());
  } else {
    Serial.println("Queue cleared.");
  }

  // Inflight file is now fully processed; delete it. If we crash here the
  // orphaned file is harmless (recoverInflightQueue handles it on next boot).
  SPIFFS.remove(QUEUE_INFLIGHT_FILE);
}

// T2/T12: boot crash-recovery. If a power-cut or crash happened while
// flushQueue() held QUEUE_INFLIGHT_FILE, merge it back into QUEUE_FILE so
// those records are retried rather than lost. Must run before tasks start.
static void recoverInflightQueue() {
  if (!SPIFFS.exists(QUEUE_INFLIGHT_FILE)) return;
  Serial.println("Boot recovery: merging inflight queue into live queue");
  File inf = SPIFFS.open(QUEUE_INFLIGHT_FILE, FILE_READ);
  if (!inf) { SPIFFS.remove(QUEUE_INFLIGHT_FILE); return; }
  File live = SPIFFS.open(QUEUE_FILE, FILE_APPEND);
  if (!live) { inf.close(); SPIFFS.remove(QUEUE_INFLIGHT_FILE); return; }
  while (inf.available()) {
    String ln = inf.readStringUntil('\n');
    ln.trim();
    if (ln.length()) live.println(ln);
  }
  live.close();
  inf.close();
  SPIFFS.remove(QUEUE_INFLIGHT_FILE);
  Serial.println("Boot recovery: inflight queue merged.");
}

/* =================== OTA Update =================== */
// L8: parse "MAJOR.MINOR.PATCH" and return true only if `latest` is strictly
// newer than `current`, so a mistagged "latest" can't silently DOWNGRADE the
// fleet. If either string can't be parsed, fall back to "differs" (string
// inequality) so a legitimate update is never blocked by a parsing quirk.
bool otaIsNewer(const String &latest, const String &current) {
  int lM = 0, lm = 0, lp = 0, cM = 0, cm = 0, cp = 0;
  int ln = sscanf(latest.c_str(), "%d.%d.%d", &lM, &lm, &lp);
  int cn = sscanf(current.c_str(), "%d.%d.%d", &cM, &cm, &cp);
  if (ln < 1 || cn < 1) return latest != current;
  if (lM != cM) return lM > cM;
  if (lm != cm) return lm > cm;
  return lp > cp;
}

void checkAndApplyOTA() {
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.println("OTA: Checking for update...");
  String binUrl = "";

  {
    WiFiClientSecure apiClient;
    apiClient.setCACert(ROOT_CA_BUNDLE);  // C4: validate the GitHub API certificate
    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(15000);
    http.setUserAgent("ESP32-Attendance/1.0");
    if (!http.begin(apiClient, OTA_REPO_API)) { Serial.println("OTA: Failed to begin API request"); return; }
    int code = http.GET();
    if (code != 200) { Serial.printf("OTA: API returned %d\n", code); http.end(); return; }
    String body = http.getString();
    http.end();

    int tagIdx = body.indexOf("\"tag_name\"");
    if (tagIdx < 0) { Serial.println("OTA: No tag_name in response"); return; }
    int q1 = body.indexOf('"', body.indexOf(':', tagIdx) + 1);
    int q2 = body.indexOf('"', q1 + 1);
    if (q1 < 0 || q2 < 0) { Serial.println("OTA: Could not parse tag_name"); return; }
    String latestTag = body.substring(q1 + 1, q2);

    if (!latestTag.startsWith(OTA_TAG_PREFIX)) {
      Serial.printf("OTA: Release tag '%s' is not for this firmware variant. Skipping.\n",
                    latestTag.c_str());
      return;
    }

    String latestVersion = latestTag.substring(strlen(OTA_TAG_PREFIX));
    Serial.printf("OTA: Current=%s  Latest=%s\n", FIRMWARE_VERSION, latestVersion.c_str());
    // L8: only flash a strictly newer version (no downgrades / no re-flash of equal).
    if (!otaIsNewer(latestVersion, FIRMWARE_VERSION)) {
      Serial.println("OTA: No newer firmware available.");
      return;
    }

    int searchFrom = 0;
    while (true) {
      int keyIdx = body.indexOf("\"browser_download_url\"", searchFrom);
      if (keyIdx < 0) break;
      int u1 = body.indexOf('"', body.indexOf(':', keyIdx) + 1);
      int u2 = body.indexOf('"', u1 + 1);
      if (u1 < 0 || u2 < 0) break;
      String candidate = body.substring(u1 + 1, u2);
      if (candidate.endsWith(".bin")) { binUrl = candidate; break; }
      searchFrom = u2 + 1;
    }
  }

  if (binUrl.length() == 0) { Serial.println("OTA: No .bin asset found in release"); return; }
  Serial.printf("OTA: Downloading from %s\n", binUrl.c_str());
  Serial.printf("OTA: Free heap before download: %u bytes\n", esp_get_free_heap_size());

  otaInProgress = true;
  delay(600);

  {
    WiFiClientSecure redirectClient;
    redirectClient.setCACert(ROOT_CA_BUNDLE);  // C4: validate the redirect host certificate
    HTTPClient redirectHttp;
    redirectHttp.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    redirectHttp.setTimeout(15000);
    redirectHttp.setUserAgent("ESP32-Attendance/1.0");
    if (redirectHttp.begin(redirectClient, binUrl)) {
      int rCode = redirectHttp.GET();
      if (rCode == 301 || rCode == 302) {
        String location = redirectHttp.getLocation();
        if (location.length()) { Serial.printf("OTA: Redirect -> %s\n", location.c_str()); binUrl = location; }
      }
      redirectHttp.end();
    }
  }

  {
    WiFiClientSecure binClient;
    binClient.setCACert(ROOT_CA_BUNDLE);  // C4: validate the firmware-asset host certificate
    HTTPClient binHttp;
    binHttp.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    binHttp.setTimeout(60000);
    binHttp.setUserAgent("ESP32-Attendance/1.0");
    if (!binHttp.begin(binClient, binUrl)) {
      Serial.printf("OTA: Failed to begin binary download. Free heap: %u\n", esp_get_free_heap_size());
      otaInProgress = false; return;
    }
    int binCode = binHttp.GET();
    if (binCode != HTTP_CODE_OK) {
      Serial.printf("OTA: Binary download returned %d\n", binCode);
      binHttp.end(); otaInProgress = false; return;
    }
    int contentLen = binHttp.getSize();
    Serial.printf("OTA: Binary size = %d bytes\n", contentLen);
    if (!Update.begin(contentLen > 0 ? contentLen : UPDATE_SIZE_UNKNOWN)) {
      Serial.printf("OTA: Update.begin failed: %s\n", Update.errorString());
      binHttp.end(); otaInProgress = false; return;
    }
    WiFiClient *stream = binHttp.getStreamPtr();
    size_t written = Update.writeStream(*stream);
    Serial.printf("OTA: Written %u / %d bytes\n", written, contentLen);
    binHttp.end();
    if (Update.end()) {
      if (Update.isFinished()) {
        Serial.println("OTA: Update complete! Rebooting...");
        setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_GREEN);
        delay(1500);
        ESP.restart();
      } else {
        Serial.println("OTA: Update did not finish correctly.");
      }
    } else {
      Serial.printf("OTA: Update.end error: %s\n", Update.errorString());
    }
  }
  otaInProgress = false;
}
/* =================== End OTA =================== */

/* =================== NetworkTask (Core 0) =================== */
// T2/T12: memQueue removed. NetworkTask waits on a binary semaphore given by
// FingerprintTask via queueAndSignal(), OR on a periodic flush-interval timeout.
// Either way it calls flushQueue() which owns the rotate-then-process logic.
void NetworkTask(void *pvParameters) {
  const TickType_t flushIntervalTicks = pdMS_TO_TICKS(15000);
  esp_task_wdt_delete(NULL);
  static bool rtcSynced = false;

  if (WiFi.status() == WL_CONNECTED && !pendingAssignment) {
    Serial.println("NetworkTask: boot flush — sending any queued records.");
    flushQueue();
  }

  for (;;) {
    // Provisioning state: register if needed, then poll for assignment
    if (pendingAssignment) {
      vTaskDelay(pdMS_TO_TICKS(5000));
      if (WiFi.status() != WL_CONNECTED) {
        WiFi.disconnect(true);
        vTaskDelay(pdMS_TO_TICKS(1000));
        WiFi.begin(wifiSSID.c_str(), wifiPASS.c_str());
        continue;
      }
      if (deviceId.length() == 0) {
        registerDevice();
      } else {
        if (pollAssignment()) {
          Serial.println("NetworkTask: device assigned — flushing queue.");
          rtcSynced = false;
          flushQueue();
        }
      }
      continue;
    }

    // Normal operation: wait for a scan signal or the periodic flush interval.
    // pdTRUE = FingerprintTask signalled a new scan; pdFALSE = interval timeout.
    xSemaphoreTake(memQueueSem, flushIntervalTicks);
    // Consume any extra signals that stacked while we were in flushQueue().
    while (xSemaphoreTake(memQueueSem, 0) == pdTRUE) {}

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
      Serial.println("NetworkTask: WiFi not connected; attempting reconnect");
      WiFi.disconnect(true);
      vTaskDelay(pdMS_TO_TICKS(1000));
      WiFi.begin(wifiSSID.c_str(), wifiPASS.c_str());

      static unsigned long lastSPIFFSTrimMs = 0;
      unsigned long nowMs = millis();
      if (lastSPIFFSTrimMs == 0 || (nowMs - lastSPIFFSTrimMs) > QUEUE_SPIFFS_TRIM_INTERVAL_MS) {
        lastSPIFFSTrimMs = nowMs;
        xSemaphoreTake(spiffsMutex, portMAX_DELAY);
        trimSPIFFSQueue_locked();
        xSemaphoreGive(spiffsMutex);
      }
    }
  }
  vTaskDelete(NULL);
}

/* =================== EnrollmentTask (Core 0) =================== */
void EnrollmentTask(void *pvParameters) {
  (void) pvParameters;
  esp_task_wdt_delete(NULL);
  for (;;) {
    if (WiFi.status() == WL_CONNECTED && deviceId.length() > 0 && !pendingAssignment) {
      Serial.println("EnrollmentTask: polling for enrollment job...");
      String payload = "{\"device_id\":\"" + jsonEscape(deviceId) + "\"}";
      int code = 0; String body = "";
      postJSONToUrl(payload, ENROLL_GET_URL, code, body);
      Serial.printf("EnrollmentTask: HTTP %d body=%s\n", code, body.c_str());

      // Decommission signal: the platform deleted this device. Wipe identity and reboot
      // so the device returns to the provisioning flow on next power-on.
      if (code >= 200 && code < 300 && body.indexOf("\"decommissioned\":true") >= 0) {
        Serial.println("EnrollmentTask: device decommissioned — wiping identity and rebooting");
        SPIFFS.remove(DEVICE_IDENTITY_FILE);
        clearProvisioning();
        ESP.restart();
      }

      if (code >= 200 && code < 300 && body.length() && body.indexOf("\"job\":null") < 0) {
        auto extractStr = [&](const String &key) -> String {
          int p = body.indexOf("\"" + key + "\"");
          if (p < 0) return "";
          int colon = body.indexOf(':', p);
          if (colon < 0) return "";
          int valStart = colon + 1;
          while (valStart < (int)body.length() && body[valStart] == ' ') valStart++;
          if (body.substring(valStart, valStart + 4) == "null") return "";
          int q1 = body.indexOf('"', colon);
          if (q1 < 0) return "";
          int q2 = body.indexOf('"', q1 + 1);
          if (q2 < 0) return "";
          return body.substring(q1 + 1, q2);
        };
        auto extractInt = [&](const String &key) -> int {
          int p = body.indexOf("\"" + key + "\"");
          if (p < 0) return 0;
          int colon = body.indexOf(':', p);
          if (colon < 0) return 0;
          int numStart = colon + 1;
          while (numStart < (int)body.length() && body[numStart] == ' ') numStart++;
          if (body.substring(numStart, numStart + 4) == "null") return 0;
          int numEnd = numStart;
          while (numEnd < (int)body.length() && (isdigit(body[numEnd]) || body[numEnd] == '-')) numEnd++;
          return body.substring(numStart, numEnd).toInt();
        };

        EnrollJob job;
        job.id           = extractStr("id");
        job.command      = extractStr("command");
        job.fingerSlot   = extractStr("finger_slot");
        job.studentId    = extractStr("student_id");
        job.uniqueId     = extractStr("sid");
        job.name         = extractStr("fullname");
        job.requestedFid = extractInt("fid");

        if (job.id.length() > 0 && job.command.length() > 0) {
          xSemaphoreTake(enrollMutex, portMAX_DELAY);
          currentEnrollJob = job;
          enrollmentJobPending = true;
          xSemaphoreGive(enrollMutex);
          Serial.printf("EnrollmentTask: job queued id=%s cmd=%s fid=%d slot=%s uid=%s\n",
                        job.id.c_str(), job.command.c_str(), job.requestedFid,
                        job.fingerSlot.c_str(), job.uniqueId.c_str());
          xSemaphoreGive(enrollSem);
          vTaskDelay(pdMS_TO_TICKS(ENROLL_POLL_FAST_MS));
          continue;
        }
      }
    } else {
      Serial.println("EnrollmentTask: skipping poll (not connected, no device_id, or pending assignment)");
    }

    vTaskDelay(pdMS_TO_TICKS(enrollmentJobPending ? ENROLL_POLL_FAST_MS : ENROLL_POLL_MS));
  }
  vTaskDelete(NULL);
}

/* =================== FingerprintTask (Core 1) =================== */
void FingerprintTask(void *pvParameters) {
  (void) pvParameters;
  const unsigned long feedbackDuration = 600;

  for (;;) {
    // OTA in progress: hold red breathing
    if (otaInProgress) {
      setSensorLED(FINGERPRINT_LED_BREATHING, 15, FINGERPRINT_LED_RED);
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }

    // Waiting for dashboard assignment: yellow breathing, no attendance posting
    if (pendingAssignment) {
      setSensorLED(FINGERPRINT_LED_BREATHING, 25, FINGERPRINT_LED_YELLOW);
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }

    showReadyState();

    // Process enrollment job from server
    if (xSemaphoreTake(enrollSem, 0) == pdTRUE) {
      if (enrollmentJobPending) {
        xSemaphoreTake(enrollMutex, portMAX_DELAY);
        EnrollJob job = currentEnrollJob;
        enrollmentJobPending = false;
        xSemaphoreGive(enrollMutex);

        Serial.printf("Processing enroll job id=%s cmd=%s slot=%s\n",
                      job.id.c_str(), job.command.c_str(), job.fingerSlot.c_str());
        if (job.command == "register") {
          enrollment_doRegister(job, "student");
        } else if (job.command == "register-master") {
          enrollment_doRegister(job, "master");
        } else if (job.command == "delete" || job.command == "delete-master") {
          if (job.requestedFid > 0) enrollment_doDeleteByFid(job, job.requestedFid);
          else if (job.uniqueId.length()) enrollment_doDeleteByUnique(job);
          else reportEnrollUpdate(job.id, "failed", -1, "no-id-specified", job.fingerSlot, job.studentId);
        } else if (job.command == "clearall") {
          Serial.println("Performing clearAll on sensor and local map");
          int rc = finger.emptyDatabase();
          if (rc == FINGERPRINT_OK) {
            clearAllFidMap();
            reportEnrollUpdate(job.id, "completed", 0, "", "", "");
          } else {
            Serial.printf("emptyDatabase returned %d\n", rc);
            reportEnrollUpdate(job.id, "failed", 0, String(rc), "", "");
          }
        } else {
          reportEnrollUpdate(job.id, "failed", -1, "unknown-cmd", "", "");
        }
      }
    }

    // Normal scan
    int fid = fingerSearch();
    if (fid > 0) {
      Serial.print("Fingerprint matched ID: "); Serial.println(fid);

      unsigned long nowMs = millis();
      if (fidEverScanned[fid] && (nowMs - lastScanMillis[fid] < SCAN_COOLDOWN_MS)) {
        unsigned long remaining = (SCAN_COOLDOWN_MS - (nowMs - lastScanMillis[fid])) / 1000;
        Serial.printf("Cooldown: fid=%d, %lus remaining. Ignoring scan.\n", fid, remaining);
        vTaskDelay(600 / portTICK_PERIOD_MS);
        showReadyState();
        vTaskDelay(10 / portTICK_PERIOD_MS);
        appendScanLog(getRTCTimestamp() + " | fid=" + String(fid) + " | COOLDOWN | id=" + fidMap[fid]);
        continue;
      }
      lastScanMillis[fid] = nowMs;
      fidEverScanned[fid] = true;

      String mapped = fidMap[fid];
      String role   = fidMapRole[fid];
      role.toLowerCase();

      if (role == "master") {
        Serial.println("Master scanned: launching WiFi captive portal.");
        for (int i = 0; i < 5; i++) {
          setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_YELLOW);
          vTaskDelay(120 / portTICK_PERIOD_MS);
          setSensorLED(FINGERPRINT_LED_OFF, 0, 0);
          vTaskDelay(120 / portTICK_PERIOD_MS);
        }
        startCaptivePortal();
      } else if (mapped.length()) {
        // All non-master members (student, teacher, staff) use the same attendance payload.
        setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_GREEN);
        String scanId = makeScanId(mapped);
        String ts = getRTCTimestamp();
        // M9: escape interpolated values (member sid is admin-entered text).
        // T1e: include device_id so log-attendance can authenticate via per-device secret.
        String payload = "{\"device_id\":\"" + jsonEscape(deviceId) +
                         "\",\"institution_id\":\"" + jsonEscape(institutionId) +
                         "\",\"sid\":\"" + jsonEscape(mapped) +
                         "\",\"scan_id\":\"" + jsonEscape(scanId) +
                         "\",\"timestamp\":\"" + jsonEscape(ts) + "\"}";
        vTaskDelay(feedbackDuration / portTICK_PERIOD_MS);
        showReadyState();
        queueAndSignal(payload);
        appendScanLog(getRTCTimestamp() + " | fid=" + String(fid) + " | SENT | id=" + mapped +
                      " | name=" + fidMapName[fid]);
        vTaskDelay(200 / portTICK_PERIOD_MS);
      } else {
        Serial.printf("Matched fingerID %d but no mapping configured. Ignoring.\n", fid);
        setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
        vTaskDelay(feedbackDuration / portTICK_PERIOD_MS);
        showReadyState();
        appendScanLog(getRTCTimestamp() + " | fid=" + String(fid) + " | NO_MAPPING");
        vTaskDelay(100 / portTICK_PERIOD_MS);
      }
    } else if (fid == -1) {
      vTaskDelay(20 / portTICK_PERIOD_MS);
    } else if (fid == -4) {
      Serial.println("No match - showing steady red briefly");
      setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
      vTaskDelay(feedbackDuration / portTICK_PERIOD_MS);
      showReadyState();
      appendScanLog(getRTCTimestamp() + " | fid=" + String(fid) + " | NO_MATCH");
      vTaskDelay(100 / portTICK_PERIOD_MS);
    } else {
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

  // T2/T12: memQueueMutex removed; spiffsMutex guards the SPIFFS-only queue.
  memQueueSem = xSemaphoreCreateBinary();
  spiffsMutex = xSemaphoreCreateMutex();
  enrollMutex = xSemaphoreCreateMutex();
  enrollSem   = xSemaphoreCreateBinary();
  if (!memQueueSem || !spiffsMutex || !enrollMutex || !enrollSem) {
    Serial.println("Failed to create RTOS primitives");
    while (1) delay(1000);
  }

  if (!initFS()) Serial.println("SPIFFS failed");
  recoverInflightQueue();  // T2/T12: merge any crash-orphaned inflight file

  // Load device identity (device_id, institution_id, device_secret, display_name)
  if (!loadDeviceIdentity()) {
    Serial.println("No device identity found — will provision via /register + /assignment-poll.");
    // H7: if we registered before but haven't been assigned yet, restore the
    // saved device_id + provisioning_token so we resume polling (with the token)
    // instead of re-registering as a brand-new device.
    if (loadProvisioning()) {
      Serial.printf("Restored pending provisioning: device_id=%s\n", deviceId.c_str());
      pendingAssignment = true;
    }
  } else {
    Serial.printf("Device identity loaded: device_id=%s institution=%s display=%s\n",
                  deviceId.c_str(), institutionId.c_str(), displayName.c_str());
  }

  loadFidMapFromFS();
  memset(lastScanMillis, 0, sizeof(lastScanMillis));
  memset(fidEverScanned, 0, sizeof(fidEverScanned));

  // WiFi credentials — portal on first boot
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
    Serial.println("\nWiFi failed — continuing offline. Scan master finger to reconfigure.");
  }
  Serial.printf("Free heap at boot: %u bytes\n", esp_get_free_heap_size());

  // If no device identity, register with cloud now (requires WiFi)
  if (deviceId.length() == 0) {
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("No device identity — registering...");
      if (!registerDevice()) {
        Serial.println("Registration failed. NetworkTask will retry.");
        pendingAssignment = true;
      }
    } else {
      Serial.println("No WiFi — cannot register yet. NetworkTask will retry when connected.");
      pendingAssignment = true;
    }
  }

  Wire.begin(21, 22);
  initRTC();
  configTime(0, 0, "pool.ntp.org");
  if (WiFi.status() == WL_CONNECTED) syncRTCFromNTP();

  setupFingerprint();

  BaseType_t ok1 = xTaskCreatePinnedToCore(FingerprintTask, "FingerprintTask", 8192,  NULL, 1, &hFingerprint, 1);
  BaseType_t ok2 = xTaskCreatePinnedToCore(NetworkTask,     "NetworkTask",     16384, NULL, 1, &hNetwork,     0);
  BaseType_t ok3 = xTaskCreatePinnedToCore(EnrollmentTask,  "EnrollmentTask",  12288, NULL, 1, &hEnrollment,  0);
  if (ok1 != pdPASS || ok2 != pdPASS || ok3 != pdPASS) {
    Serial.println("Failed to create tasks");
    while (1) delay(1000);
  }
  Serial.println("Tasks created; main loop will idle");

  if (WiFi.status() == WL_CONNECTED && !pendingAssignment) {
    // T14: randomise the boot OTA check so a fleet-wide power blip doesn't
    // simultaneously hit GitHub's 60 req/hr unauthenticated rate limit.
    // esp_random() is seeded from hardware entropy; uniform across [0, 120 s).
    uint32_t jitterMs = esp_random() % 120000UL;
    Serial.printf("OTA: boot jitter %ums\n", jitterMs);
    delay(jitterMs);
    checkAndApplyOTA();
  }
}

void loop() {
  delay(1000);
}

/* =================== END OF SKETCH =================== */
