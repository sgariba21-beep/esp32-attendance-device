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
// Per-institution device_config cache (Phase 2 OLED), so scan-card rendering (and
// later the idle clock) survives a reboot without WiFi. Written atomically: to the
// .tmp path first, then renamed over the live file -- same idiom flushQueue uses
// for the identical partial-write risk. See loadDeviceConfig()/saveDeviceConfig().
#define DEVICE_CONFIG_FILE     "/device_config.json"
#define DEVICE_CONFIG_TMP_FILE "/device_config.tmp"

/* ========= OTA CONFIG ========= */
#define FIRMWARE_VERSION  "1.10.0"        // increment on each flash (1.10.0: server-reachability watchdog + durable enrollment reports; enrollment job payload uses member_id)
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

/* SSD1306 OLED (Phase 3). Same I2C bus as the DS3231 RTC (0x68) -- no address
 * clash at 0x3C. Display owner is Core 1 (FingerprintTask) only; see
 * renderDisplayIfDirty(). */
#define SCREEN_WIDTH  128
#define SCREEN_HEIGHT 64
#define OLED_ADDR     0x3C
#define DISPLAY_SLEEP_MS (120UL * 1000UL)

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
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "esp_task_wdt.h"
#include <Update.h>
#include <ArduinoJson.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

RTC_DS3231 rtc;
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

HardwareSerial r503Serial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&r503Serial);

/* Synchronisation primitives */
// memQueueMutex removed (T2/T12): SPIFFS is now the sole queue; spiffsMutex guards it.
SemaphoreHandle_t memQueueSem   = NULL;  // binary signal: FingerprintTask → NetworkTask
SemaphoreHandle_t spiffsMutex   = NULL;
SemaphoreHandle_t enrollMutex   = NULL;
SemaphoreHandle_t enrollSem     = NULL;
SemaphoreHandle_t displayMutex  = NULL;  // guards displayName + the tier table below (Phase 3 OLED)

String wifiSSID = "";
String wifiPASS = "";

/* Runtime device identity — populated from SPIFFS or provisioning poll */
String deviceId      = "";
String institutionId = "";
String deviceSecret  = "";
String displayName   = "";
String provisioningToken = "";            // H7: required by /assignment-poll before secret release
volatile bool pendingAssignment = false;  // true until dashboard assigns this device

/* Per-institution device_config cache (Phase 2 OLED) — loaded from SPIFFS before any
 * task starts. Governs attendance-scan card rendering only; member names are already
 * in fid_map.csv regardless. See loadDeviceConfig()/saveDeviceConfig(). */
String deviceConfigNameDisplay = "first";  // compile-time default until a valid cache file overrides it
long   deviceConfigRevOnDisk   = 0;        // rev actually persisted to flash, not any pending value; 0 = never persisted (always "stale" to the server)
int    deviceConfigTzOffset    = 0;        // minutes east of UTC; refreshed on every poll response

/* ---- Display state mailbox (Phase 3 OLED) ----
 * NetworkTask/EnrollmentTask (Core 0) post/clear tier state here through
 * postDisplayState()/clearDisplayState() -- they never touch `display`
 * directly. FingerprintTask (Core 1) is the sole reader+drawer, via
 * renderDisplayIfDirty(). Guarded by displayMutex; tier 0 = highest priority.
 * Idle (TIER_IDLE) is always active as the base state so resolution never
 * lands on "nothing". */
enum DisplayTier {
  TIER_TAKEOVER    = 0,  // fatal init, captive portal, OTA, sensor missing -- exclusive, never sleeps
  TIER_INTERACTION = 1,  // enrollment prompts/outcomes, scan outcomes, master confirm -- timeboxed
  TIER_BLOCKED     = 2,  // awaiting assignment, provisioning error, decommissioned -- never sleeps
  TIER_DEGRADED    = 3,  // offline+queue depth, clock unsynced, dropped-record count -- banner over idle
  TIER_IDLE        = 4,  // clock, display name, link state -- always active as the fallback
  TIER_COUNT       = 5
};

// Phase 6: which Tier 2 (Blocked) state is currently posted, if any. Defined
// here (not next to setBlockedReason() itself, further down) so it's visible
// to that function's forward declaration in the block below.
enum BlockedReason { BLOCKED_NONE, BLOCKED_PENDING, BLOCKED_REJECTED, BLOCKED_REVOKED };
bool          displayAvailable      = false;  // false if SSD1306 init failed -- no hard dependency on the panel
volatile bool tierActive[TIER_COUNT]     = { false, false, false, false, true };
unsigned long tierExpiresAtMs[TIER_COUNT] = { 0, 0, 0, 0, 0 };  // 0 = no expiry
// Card content (Phase 4 OLED): headline is size-2 text, line2/line3 are size-1.
// Only TIER_INTERACTION has a poster so far (scan cards); tiers 0/2/3 remain
// content-less infrastructure until Phase 5/6.
String        tierHeadline[TIER_COUNT];
String        tierLine2[TIER_COUNT];
String        tierLine3[TIER_COUNT];
volatile bool displayDirty          = true;   // forces the first render once FingerprintTask starts
volatile bool displayAsleep         = false;
volatile bool displayWakeRequested  = false;  // set by any core; only Core 1 issues the actual I2C wake command
unsigned long displayLastActivityMs = 0;
unsigned long lastIdleRenderMs      = 0;

// Verdict channel (Phase 4): NetworkTask (Core 0, flushQueue) deposits the
// server's verdict for a scan_id here; FingerprintTask (Core 1) picks it up
// only if it matches the scan_id it's currently watching (pendingScanId,
// Core-1-exclusive, declared near FingerprintTask). Single slot -- flushing a
// backlog of dozens of records after a reconnect just overwrites this
// repeatedly, and the consumer ignores every one that doesn't match what it's
// actively waiting on. That's the entire batch-flush suppression mechanism;
// no special-case "am I in a batch" detection needed.
volatile bool verdictPending = false;
String        verdictScanId  = "";
String        verdictText    = "";

// Queue depth + dropped-record count (Phase 6 OLED) -- in-RAM only, never
// recomputed by counting SPIFFS lines on repaint. Written from Core 0
// (queueAndSignal is Core 1 via FingerprintTask, but flushQueue/
// trimSPIFFSQueue_locked run on NetworkTask, Core 0; trimSPIFFSQueue_locked
// can ALSO run on Core 1 when called from queueAndSignal's near-cap path) and
// read from Core 1 for the offline banner -- mutex-protected like everything
// else that crosses cores here. droppedRecordCount counts actual data loss
// only (stale-aged-out, permanently-failed, or cap-evicted entries), never
// successful sends.
long queueDepth         = 0;
long droppedRecordCount = 0;

// Device MAC (Phase 6): the dashboard's key for identifying an unassigned
// device, so the awaiting-assignment/rejected screens can show it. Populated
// once in setup() after WiFi.mode(WIFI_STA), Core-1-exclusive (single-
// threaded at that point) -- read-only from everywhere else afterward, so no
// mutex needed for reads either.
String deviceMac = "";

TaskHandle_t hFingerprint = NULL;
TaskHandle_t hNetwork     = NULL;
TaskHandle_t hEnrollment  = NULL;

std::vector<String> fidMap;
std::vector<String> fidMapRole;
std::vector<String> fidMapName;

struct EnrollJob {
  String id;
  String memberId;
  String uniqueId;
  String name;
  String fingerSlot;
  String command;
  int    requestedFid;
  bool   allowOverwrite;   // operator approved clobbering an occupied sensor slot
};
volatile bool enrollmentJobPending = false;
EnrollJob currentEnrollJob;

volatile bool otaInProgress = false;

static unsigned long lastScanMillis[MAX_FID + 1];
static bool fidEverScanned[MAX_FID + 1];

/* Pending-scan verdict watch (Phase 4 OLED) -- Core-1-exclusive (FingerprintTask
 * is the only reader/writer), no mutex needed. Set when a scan is posted online;
 * checkScanVerdict() consumes the cross-core verdictPending mailbox (which IS
 * mutex-protected -- see the globals near the tier table) only when it matches
 * pendingScanId. */
String        pendingScanId         = "";
String        pendingScanName       = "";
unsigned long pendingScanStartMs    = 0;
unsigned long pendingScanDeadlineMs = 0;  // pendingScanStartMs + 4000 (the correlation window)

/* Master-finger confirmation state machine (Phase 5 OLED, Q5) -- also
 * Core-1-exclusive. Armed on a first master-role press; a second press of
 * the SAME fid within the window confirms and launches the portal, a
 * DIFFERENT fid cancels and falls through to normal processing for that new
 * fid, and no-match/sensor-error events are ignored entirely (never reach
 * this state since they're not fid>0 matches). Timeout is checked
 * unconditionally every loop iteration, not nested inside a scan match --
 * otherwise an armed-but-idle window would only ever resolve whenever the
 * next scan attempt happened to land, not at the actual 8s deadline. */
bool          masterConfirmArmed       = false;
int           masterConfirmFid         = -1;
unsigned long masterConfirmDeadlineMs  = 0;

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
int enrollID_toFid(const EnrollJob &job, int requestedFid);
void enrollment_doRegister(const EnrollJob &job, const String &role);
void enrollment_doDeleteByFid(const EnrollJob &job, int fid);
void enrollment_doDeleteByUnique(const EnrollJob &job);
void reportEnrollUpdate(const String &jobId, const String &status, int fingerId,
                        const String &note, const String &fingerSlot, const String &memberId);
bool initRTC();
void syncRTCFromNTP();
String getRTCTimestamp();
bool parsePayloadAgeSec(const String &payload, long nowEpoch, long &outAgeSec);
void trimSPIFFSQueue_locked();
bool appendToSPIFFSQueue_locked(const String &line);
void flushQueue();
static void recoverInflightQueue();
static void seedQueueDepthFromDisk();

// Durable enrollment status reports (Core 0 flush; Core 1 append on POST failure).
void flushEnrollReports();
static void appendEnrollReport_locked(const String &line);
// Server-reachability watchdog. postJSONToUrl()/postJSONBootstrap() feed
// markPostResult(); NetworkTask reads it to escalate (re-associate, reboot)
// and the idle screen reads it for the "No server" indicator.
void markPostResult(bool ok);
bool getServerReachableSafe();
void getNetHealthSafe(bool &reachable, int &fails, unsigned long &lastOkMs);

#define POST_MAX_RETRIES   3
#define POST_BASE_DELAY_MS 500
#define POST_TIMEOUT_MS    30000

// Server-reachability watchdog. The link can stay associated while every HTTPS
// call is refused (heap fragmentation, mbedTLS arena exhaustion, a filtering
// middlebox). Before this the device just showed "Online" and went silent
// until a power cycle.
#define NET_UNREACHABLE_FAILS   5                       // consecutive failed POSTs (link still up) => "no server"
#define NET_REASSOC_INTERVAL_MS 60000UL                 // while unreachable, force a WiFi re-associate this often
#define NET_REBOOT_AFTER_MS     (5UL * 60UL * 1000UL)   // unreachable this long on a live link => ESP.restart()
#define NET_MIN_LARGEST_BLOCK   30000UL                 // largest free heap block below this can't fit a TLS arena => reboot
#define ENROLL_REPORT_QUEUE_FILE "/enroll_reports.txt"
#define ENROLL_REPORT_MAX_BYTES  (16UL * 1024UL)

bool postJSONToUrl(const String &jsonPayload, const char* targetUrl, int &outHttpCode, String &outBody);
bool postJSONBootstrap(const String &jsonPayload, const char* targetUrl, int &outHttpCode, String &outBody);
// displayName is read from Core 1 (display) but written from Core 0
// (registerDevice/pollAssignment/EnrollmentTask) once tasks are running --
// every access after task creation goes through these two (Phase 3 OLED).
void setDisplayName(const String &name);
String getDisplayNameSafe();
// Same story for deviceConfigNameDisplay/TzOffset -- written from Core 0
// (saveDeviceConfig), read from Core 1 as of Phase 3 (tz offset) / Phase 4
// (name policy).
String getDeviceConfigNameDisplaySafe();
int getDeviceConfigTzOffsetSafe();
bool loadDeviceIdentity();
void saveDeviceIdentity();
bool registerDevice();
bool pollAssignment();
bool loadProvisioning();
void saveProvisioning();
void clearProvisioning();
bool loadDeviceConfig();
void saveDeviceConfig(long ver, long rev, int tzOffset, const String &nameDisplay);

// Display mailbox (Phase 3/4 OLED) -- Core-0-safe, never touch `display` directly.
void postDisplayState(DisplayTier tier, unsigned long timeboxMs,
                      const String &headline, const String &line2, const String &line3);
void clearDisplayState(DisplayTier tier);
void postScanVerdict(const String &entryPayload, bool ok, const String &body);
// Queue-depth/dropped-record bookkeeping and Tier 2 state (Phase 6 OLED) --
// also Core-0-safe.
void queueDepthAdjust(long delta);
void droppedCountAdjust(long delta);
void getQueueStatsSafe(long &depth, long &dropped);
void setBlockedReason(BlockedReason reason);
// Core-1-only (called from FingerprintTask).
void renderDisplayIfDirty();
void renderIdleScreen();
void renderCard(DisplayTier tier);
void showBootSplash();
void checkScanVerdict();
void checkMasterConfirmTimeout();
String resolveScanCardName(const String &name, const String &sid);
// UTF-8-to-CP437-safe text for the display font. Not Core-restricted itself
// (pure string transform, no I2C) -- Phase 4+ scan/enrollment cards should
// route member/enrollee names through this too.
String sanitizeForDisplay(const String &s);
String transliterateCodepoint(uint32_t cp);

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

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) {
    Serial.printf("Device identity parse failed: %s\n", err.c_str());
    return false;
  }

  // The `| ""` default covers both a missing key and an explicit JSON null.
  deviceId      = doc["device_id"]      | "";
  institutionId = doc["institution_id"] | "";
  deviceSecret  = doc["device_secret"]  | "";
  displayName   = doc["display_name"]   | "";

  return deviceId.length() > 0 && institutionId.length() > 0;
}

// M9 (superseded in 1.3.0): hand-rolled jsonEscape() is gone — ArduinoJson
// escapes on serialize, so a display_name / member sid containing " or \ is
// handled by the library for every payload we write to SPIFFS or POST.

// Mutex-protected accessors for displayName (Phase 3): NetworkTask/EnrollmentTask
// (Core 0) write it, FingerprintTask (Core 1) reads it every render for the boot
// splash and idle screen. Arduino String isn't safe for a concurrent
// read-while-write, which was harmless before Phase 3 (nothing on Core 1 ever
// read it) and is now live. setDisplayName() also marks the display dirty so a
// rename shows up on the next render.
void setDisplayName(const String &name) {
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  displayName = name;
  displayDirty = true;
  xSemaphoreGive(displayMutex);
}

String getDisplayNameSafe() {
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  String v = displayName;
  xSemaphoreGive(displayMutex);
  return v;
}

// Same reasoning as getDisplayNameSafe(): deviceConfigNameDisplay/TzOffset are
// written from Core 0 (saveDeviceConfig, EnrollmentTask) and read from Core 1
// (resolveScanCardName, renderIdleScreen). deviceConfigRevOnDisk has no
// equivalent getter -- it's Core-0-exclusive, never read from Core 1.
String getDeviceConfigNameDisplaySafe() {
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  String v = deviceConfigNameDisplay;
  xSemaphoreGive(displayMutex);
  return v;
}

int getDeviceConfigTzOffsetSafe() {
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  int v = deviceConfigTzOffset;
  xSemaphoreGive(displayMutex);
  return v;
}

void saveDeviceIdentity() {
  File f = SPIFFS.open(DEVICE_IDENTITY_FILE, FILE_WRITE);
  if (!f) { Serial.println("Failed to write device identity"); return; }
  String nameSnapshot = getDisplayNameSafe();
  JsonDocument doc;
  doc["device_id"]      = deviceId;
  doc["institution_id"] = institutionId;
  doc["device_secret"]  = deviceSecret;
  doc["display_name"]   = nameSnapshot;
  serializeJson(doc, f);
  f.close();
  Serial.println("Device identity saved: " + deviceId + " / " + nameSnapshot);
}

// H7: persist device_id + provisioning_token while the device is pending so a
// reboot before assignment doesn't lose the token (the token is required by
// /assignment-poll to retrieve the institution device_secret).
void saveProvisioning() {
  File f = SPIFFS.open(PROVISIONING_FILE, FILE_WRITE);
  if (!f) { Serial.println("Failed to write provisioning file"); return; }
  JsonDocument doc;
  doc["device_id"]          = deviceId;
  doc["provisioning_token"] = provisioningToken;
  serializeJson(doc, f);
  f.close();
}

bool loadProvisioning() {
  if (!SPIFFS.exists(PROVISIONING_FILE)) return false;
  File f = SPIFFS.open(PROVISIONING_FILE, FILE_READ);
  if (!f) return false;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) {
    Serial.printf("Provisioning parse failed: %s\n", err.c_str());
    return false;
  }

  deviceId          = doc["device_id"]          | "";
  provisioningToken = doc["provisioning_token"] | "";
  return deviceId.length() > 0 && provisioningToken.length() > 0;
}

void clearProvisioning() {
  if (SPIFFS.exists(PROVISIONING_FILE)) SPIFFS.remove(PROVISIONING_FILE);
}

/* ================== Device Config Cache (SPIFFS) ================== */
// Phase 2 OLED: per-institution config (currently just member_name_display),
// cached offline so scan-card rendering survives a reboot without WiFi and so
// a card rendered before the very first poll response never shows a full name
// under a stricter policy. On-disk keys are the short `_ver`/`_rev`/... form,
// distinct from the `device_config_`-prefixed wire keys in the poll response.
bool loadDeviceConfig() {
  if (!SPIFFS.exists(DEVICE_CONFIG_FILE)) {
    // Never polled yet (or wiped on decommission). Compile-time default stands;
    // rev/tz_offset stay at 0 so the first poll always reports as stale.
    Serial.println("No device_config file; using compile-time default (first).");
    return true;
  }

  File f = SPIFFS.open(DEVICE_CONFIG_FILE, FILE_READ);
  if (!f) {
    Serial.println("device_config: exists but failed to open -- falling back to none");
    deviceConfigNameDisplay = "none";
    return false;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();

  long ver = doc["_ver"] | 0;
  long rev = doc["_rev"] | 0;
  // A file existing means a policy WAS configured; if we can't tell which
  // (truncated write, flash corruption), do not fall open to the compile-time
  // default -- fall to the most restrictive option instead.
  if (err || ver < 1 || rev < 1) {
    Serial.printf("device_config: corrupt/invalid (err=%s ver=%ld rev=%ld) -- falling back to none\n",
                  err ? err.c_str() : "-", ver, rev);
    deviceConfigNameDisplay = "none";
    deviceConfigRevOnDisk = 0;  // untrusted -- always request fresh state from the server
    return false;
  }

  deviceConfigRevOnDisk   = rev;
  deviceConfigTzOffset    = doc["_tz_offset"] | 0;
  deviceConfigNameDisplay = doc["_name_display"] | "first";
  Serial.printf("device_config loaded: rev=%ld tz_offset=%d name_display=%s\n",
                deviceConfigRevOnDisk, deviceConfigTzOffset, deviceConfigNameDisplay.c_str());
  return true;
}

// Atomic write: full new state to the .tmp path, then rename over the live
// file -- same idiom flushQueue uses for the identical partial-write risk.
// Caller is responsible for revision-gating (only call when rev or tz_offset
// actually changed) -- the device polls every 10s, so an unconditional write
// here would be ~8,600 flash writes a day.
void saveDeviceConfig(long ver, long rev, int tzOffset, const String &nameDisplay) {
  File f = SPIFFS.open(DEVICE_CONFIG_TMP_FILE, FILE_WRITE);
  if (!f) { Serial.println("device_config: failed to open tmp file for write"); return; }
  JsonDocument doc;
  doc["_ver"]          = ver;
  doc["_rev"]          = rev;
  doc["_tz_offset"]    = tzOffset;
  doc["_name_display"] = nameDisplay;
  serializeJson(doc, f);
  f.close();

  if (SPIFFS.exists(DEVICE_CONFIG_FILE)) SPIFFS.remove(DEVICE_CONFIG_FILE);
  if (!SPIFFS.rename(DEVICE_CONFIG_TMP_FILE, DEVICE_CONFIG_FILE)) {
    // rev/tz_offset/name_display globals are NOT updated -- deviceConfigRevOnDisk
    // still reflects the last value actually on disk, so the next poll reports
    // the same (stale) rev and the server resends, retrying the write.
    Serial.println("device_config: rename failed -- will retry on next poll");
    return;
  }

  deviceConfigRevOnDisk = rev;  // Core-0-exclusive bookkeeping, never read from Core 1 -- no mutex needed
  // tzOffset/nameDisplay ARE read from Core 1 (renderIdleScreen since Phase 3,
  // resolveScanCardName as of Phase 4) -- through displayMutex on both ends.
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  deviceConfigTzOffset    = tzOffset;
  deviceConfigNameDisplay = nameDisplay;
  xSemaphoreGive(displayMutex);
  Serial.printf("device_config saved: rev=%ld tz_offset=%d name_display=%s\n",
                rev, tzOffset, nameDisplay.c_str());
}

/* ================== Display (SSD1306, Phase 3/4) ================== */
// Mailbox API -- Core 0 (NetworkTask/EnrollmentTask) callable. Only touches the
// shared tier table under displayMutex; never draws. Tier 1 (scan cards) is
// wired up as of Phase 4; tiers 0/2/3 remain content-less infrastructure
// until Phase 5/6. Idle (tier 4) needs no caller: it's always active as the
// base state.
void postDisplayState(DisplayTier tier, unsigned long timeboxMs,
                      const String &headline, const String &line2, const String &line3) {
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  tierActive[tier] = true;
  tierExpiresAtMs[tier] = timeboxMs ? (millis() + timeboxMs) : 0;
  tierHeadline[tier] = headline;
  tierLine2[tier] = line2;
  tierLine3[tier] = line3;
  displayDirty = true;
  if (tier <= TIER_BLOCKED) {
    // Tier 0/1/2 wake the panel. The actual I2C command only ever runs on
    // Core 1 (renderDisplayIfDirty) -- this just requests it.
    displayWakeRequested = true;
    displayLastActivityMs = millis();
  }
  xSemaphoreGive(displayMutex);
}

void clearDisplayState(DisplayTier tier) {
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  tierActive[tier] = false;
  tierExpiresAtMs[tier] = 0;
  displayDirty = true;
  xSemaphoreGive(displayMutex);
}

// Core 0 (NetworkTask, from flushQueue) -- deposits a verdict for a scan_id.
// Does NOT check whether it matches anything FingerprintTask is watching;
// that's the consumer's job (checkScanVerdict, Core 1). Overwrites whatever
// was here before, by design -- see the verdictPending comment at the globals.
void postScanVerdict(const String &entryPayload, bool ok, const String &body) {
  JsonDocument reqDoc;
  if (deserializeJson(reqDoc, entryPayload)) return;  // shouldn't happen -- we built this payload ourselves
  String scanId = reqDoc["scan_id"] | "";
  if (scanId.length() == 0) return;

  String verdict;
  if (ok) {
    JsonDocument respDoc;
    DeserializationError err = deserializeJson(respDoc, body);
    String scanType = "";
    if (!err) scanType = respDoc["scan_type"] | "";
    if (scanType == "present") verdict = "PRESENT";
    else if (scanType == "time_in") verdict = "TIME IN";
    else if (scanType == "time_out") verdict = "TIME OUT";
    // Any other 200 (weekend/holiday/duplicate/not-tracked/period/already-logged)
    // -- full reason is Serial/dashboard-only, this is a compact summary.
    else verdict = "NOT LOGGED";
  } else {
    verdict = "ERROR";
  }

  xSemaphoreTake(displayMutex, portMAX_DELAY);
  verdictScanId = scanId;
  verdictText = verdict;
  verdictPending = true;
  xSemaphoreGive(displayMutex);
}

// Queue-depth/dropped-record bookkeeping (Phase 6). Callers pass the delta
// they already computed -- these never re-derive anything from SPIFFS.
void queueDepthAdjust(long delta) {
  if (delta == 0) return;
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  queueDepth += delta;
  if (queueDepth < 0) queueDepth = 0;  // defensive floor; should never go negative
  xSemaphoreGive(displayMutex);
}

void droppedCountAdjust(long delta) {
  if (delta == 0) return;
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  droppedRecordCount += delta;
  xSemaphoreGive(displayMutex);
}

void getQueueStatsSafe(long &depth, long &dropped) {
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  depth = queueDepth;
  dropped = droppedRecordCount;
  xSemaphoreGive(displayMutex);
}

/* ---- Server-reachability watchdog ----
 * Written from Core 0 (NetworkTask / EnrollmentTask, via postJSONToUrl), read
 * from Core 1 (idle screen). displayMutex-guarded like the queue counters. A
 * dropped link is a different, already-handled state, so failures only count
 * while WiFi.status()==WL_CONNECTED. */
volatile bool          serverReachable      = true;
volatile int           consecutivePostFails = 0;
volatile unsigned long lastPostOkMs         = 0;

void markPostResult(bool ok) {
  if (WiFi.status() != WL_CONNECTED) return;
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  if (ok) {
    consecutivePostFails = 0;
    lastPostOkMs = millis();
    serverReachable = true;
  } else {
    if (consecutivePostFails < 100000) consecutivePostFails++;
    if (consecutivePostFails >= NET_UNREACHABLE_FAILS) serverReachable = false;
  }
  xSemaphoreGive(displayMutex);
}

bool getServerReachableSafe() {
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  bool r = serverReachable;
  xSemaphoreGive(displayMutex);
  return r;
}

void getNetHealthSafe(bool &reachable, int &fails, unsigned long &lastOkMs) {
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  reachable = serverReachable;
  fails     = consecutivePostFails;
  lastOkMs  = lastPostOkMs;
  xSemaphoreGive(displayMutex);
}

/* ---- Durable enrollment status reports ----
 * reportEnrollUpdate() (Core 1) used to POST fire-and-forget; a single lost
 * update-enrollment-job left the job stuck in_progress forever. Now a failed
 * POST is appended here and NetworkTask (Core 0) retries it in flushEnrollReports().
 * Bounded; on overflow the OLDEST line is dropped (the server also re-delivers
 * a job stuck in_progress, so a truly lost report still self-heals). Callers
 * hold spiffsMutex. */
static void appendEnrollReport_locked(const String &line) {
  size_t sz = 0;
  if (SPIFFS.exists(ENROLL_REPORT_QUEUE_FILE)) {
    File fr = SPIFFS.open(ENROLL_REPORT_QUEUE_FILE, FILE_READ);
    if (fr) { sz = fr.size(); fr.close(); }
  }
  if (sz + line.length() + 1 > ENROLL_REPORT_MAX_BYTES) {
    std::vector<String> keep;
    File fr = SPIFFS.open(ENROLL_REPORT_QUEUE_FILE, FILE_READ);
    if (fr) {
      while (fr.available()) { String l = fr.readStringUntil('\n'); l.trim(); if (l.length()) keep.push_back(l); }
      fr.close();
    }
    size_t total = line.length() + 1;
    for (auto &k : keep) total += k.length() + 1;
    while (!keep.empty() && total > ENROLL_REPORT_MAX_BYTES) {
      total -= keep.front().length() + 1;
      keep.erase(keep.begin());
    }
    File fw = SPIFFS.open(ENROLL_REPORT_QUEUE_FILE, FILE_WRITE);
    if (fw) { for (auto &k : keep) fw.println(k); fw.close(); }
  }
  File f = SPIFFS.open(ENROLL_REPORT_QUEUE_FILE, FILE_APPEND);
  if (f) { f.println(line); f.close(); }
}

void flushEnrollReports() {
  if (WiFi.status() != WL_CONNECTED) return;

  xSemaphoreTake(spiffsMutex, portMAX_DELAY);
  if (!SPIFFS.exists(ENROLL_REPORT_QUEUE_FILE)) { xSemaphoreGive(spiffsMutex); return; }
  std::vector<String> lines;
  File f = SPIFFS.open(ENROLL_REPORT_QUEUE_FILE, FILE_READ);
  if (f) {
    while (f.available()) { String l = f.readStringUntil('\n'); l.trim(); if (l.length()) lines.push_back(l); }
    f.close();
  }
  SPIFFS.remove(ENROLL_REPORT_QUEUE_FILE);
  xSemaphoreGive(spiffsMutex);

  if (lines.empty()) return;
  Serial.printf("flushEnrollReports: retrying %u queued report(s)\n", (unsigned)lines.size());

  std::vector<String> keep;
  for (auto &line : lines) {
    int code = 0; String body;
    bool ok = postJSONToUrl(line, ENROLL_UPD_URL, code, body);
    Serial.printf("flushEnrollReports: -> code=%d\n", code);
    // Keep only genuine transients. A 2xx, or a 4xx (job gone / bad request),
    // is final -- stop retrying it.
    if (!ok && (code <= 0 || code >= 500 || code == 429)) keep.push_back(line);
    vTaskDelay(pdMS_TO_TICKS(150));
  }

  if (!keep.empty()) {
    xSemaphoreTake(spiffsMutex, portMAX_DELAY);
    for (auto &l : keep) appendEnrollReport_locked(l);
    xSemaphoreGive(spiffsMutex);
  }
}

// Tier 2 blocked-state tracking (Phase 6). Core-0-exclusive by construction:
// registerDevice()/pollAssignment() only run while pendingAssignment is true,
// EnrollmentTask's poll only runs once it's false, so PENDING/REJECTED and
// REVOKED are never live at the same time. registerDevice() can also run
// from setup() (single-threaded, before tasks exist), which is equally safe.
// Not mutex-protected: NetworkTask and EnrollmentTask are different Core-0
// tasks that could in principle race on this plain enum, but the worst case
// is a redundant repost (an extra harmless redraw), never corruption -- the
// same reasoning as leaving simple scalars like deviceConfigTzOffset
// unprotected would have been, except there we went with a mutex anyway for
// consistency since a String was already being protected right next to it.
// Here there's no adjacent String write to piggyback on, so the plain
// version is the right call. (BlockedReason itself is defined up near
// DisplayTier, not here, so the forward declaration below can see it.)
BlockedReason currentBlockedReason = BLOCKED_NONE;

void setBlockedReason(BlockedReason reason) {
  if (reason == currentBlockedReason) return;  // dedupe -- avoid reposting (and redrawing) every poll
  currentBlockedReason = reason;
  switch (reason) {
    case BLOCKED_NONE:
      clearDisplayState(TIER_BLOCKED);
      break;
    case BLOCKED_PENDING:
      postDisplayState(TIER_BLOCKED, 0, "PENDING", deviceMac, "See dashboard");
      break;
    case BLOCKED_REJECTED:
      // Must look different from ordinary PENDING, or a rejected provisioning
      // token is undebuggable in the field (looks identical to "just hasn't
      // been assigned yet" forever).
      postDisplayState(TIER_BLOCKED, 0, "REJECTED", deviceMac, "See admin");
      break;
    case BLOCKED_REVOKED:
      postDisplayState(TIER_BLOCKED, 0, "REVOKED", deviceMac, "See admin");
      break;
  }
}

// Core-1-only from here down (called from FingerprintTask).

// A handful of common multi-byte codepoints transliterated to ASCII, plus the
// Latin-1 Supplement accented-letter block (names may contain these). Falls
// back to '?' for anything with no reasonable ASCII equivalent -- better than
// silently dropping it or (worse) rendering the wrong CP437 glyph.
String transliterateCodepoint(uint32_t cp) {
  switch (cp) {
    case 0x2013: case 0x2014: return "-";   // en/em dash
    case 0x2018: case 0x2019: return "'";   // curly single quotes
    case 0x201C: case 0x201D: return "\"";  // curly double quotes
    case 0x2026: return "...";              // ellipsis
    case 0x2022: return "*";                // bullet
    case 0x00C6: return "AE";
    case 0x00E6: return "ae";
    case 0x00DF: return "ss";
  }
  if (cp >= 0x00C0 && cp <= 0x00C5) return "A";
  if (cp == 0x00C7) return "C";
  if (cp >= 0x00C8 && cp <= 0x00CB) return "E";
  if (cp >= 0x00CC && cp <= 0x00CF) return "I";
  if (cp == 0x00D0) return "D";
  if (cp == 0x00D1) return "N";
  if ((cp >= 0x00D2 && cp <= 0x00D6) || cp == 0x00D8) return "O";
  if (cp >= 0x00D9 && cp <= 0x00DC) return "U";
  if (cp == 0x00DD) return "Y";
  if (cp >= 0x00E0 && cp <= 0x00E5) return "a";
  if (cp == 0x00E7) return "c";
  if (cp >= 0x00E8 && cp <= 0x00EB) return "e";
  if (cp >= 0x00EC && cp <= 0x00EF) return "i";
  if (cp == 0x00F0) return "d";
  if (cp == 0x00F1) return "n";
  if ((cp >= 0x00F2 && cp <= 0x00F6) || cp == 0x00F8) return "o";
  if (cp >= 0x00F9 && cp <= 0x00FC) return "u";
  if (cp == 0x00FD || cp == 0x00FF) return "y";
  return "?";
}

// Adafruit_GFX's default font only covers CP437-style single-byte glyphs, not
// UTF-8 -- printing a raw multi-byte UTF-8 sequence renders one wrong glyph
// per byte (an em dash's 0xE2 0x80 0x94 renders as three garbage characters,
// one of them pi). Admin-entered text (institution/device names, and later
// member names on scan/enrollment cards) can contain smart quotes/dashes from
// phones and word processors, or accented letters in names. Applied at the
// render boundary only -- the raw UTF-8 stays in device_identity.json and
// Serial logs; only what actually reaches display.print() is sanitized.
String sanitizeForDisplay(const String &s) {
  String out;
  out.reserve(s.length());
  size_t i = 0;
  while (i < s.length()) {
    uint8_t c = (uint8_t)s[i];
    if (c < 0x80) {
      out += (char)c;
      i++;
    } else if ((c & 0xE0) == 0xC0 && i + 1 < s.length()) {
      uint32_t cp = ((uint32_t)(c & 0x1F) << 6) | ((uint8_t)s[i + 1] & 0x3F);
      out += transliterateCodepoint(cp);
      i += 2;
    } else if ((c & 0xF0) == 0xE0 && i + 2 < s.length()) {
      uint32_t cp = ((uint32_t)(c & 0x0F) << 12) | (((uint8_t)s[i + 1] & 0x3F) << 6) | ((uint8_t)s[i + 2] & 0x3F);
      out += transliterateCodepoint(cp);
      i += 3;
    } else if ((c & 0xF8) == 0xF0 && i + 3 < s.length()) {
      i += 4;  // outside the BMP (e.g. emoji) -- nothing sensible to show, drop it
    } else {
      i++;  // stray continuation byte or malformed input -- skip
    }
  }
  return out;
}

// Phase 4: applies the Phase 2 member_name_display policy (institutions.
// member_name_display, cached as deviceConfigNameDisplay) to a scan card.
// "none" is a deliberate privacy choice -- never falls back to sid, unlike
// every other policy. Any other policy falls back to sid when no name is on
// record at all (fid_map.csv rows written by older firmware are 3-field and
// load with an empty name -- there's nothing else to show). Unrecognized
// policy values fail restrictive (show nothing), matching loadDeviceConfig()'s
// corrupt-cache philosophy -- never fall open to more than configured.
String resolveScanCardName(const String &name, const String &sid) {
  String policy = getDeviceConfigNameDisplaySafe();
  if (policy == "none") return "";
  if (name.length() == 0) return sid;

  if (policy == "full") return name;
  if (policy == "sid") return sid;
  if (policy == "first") {
    int sp = name.indexOf(' ');
    return sp < 0 ? name : name.substring(0, sp);
  }
  if (policy == "initial_last") {
    int sp = name.indexOf(' ');
    if (sp < 0) return name;  // single token -- nothing to abbreviate
    String last = name.substring(name.lastIndexOf(' ') + 1);
    return String(name[0]) + ". " + last;
  }
  return "";  // unrecognized value -- fail restrictive
}

void showBootSplash() {
  if (!displayAvailable) return;
  String nameSnapshot = sanitizeForDisplay(getDisplayNameSafe());
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.print("v" FIRMWARE_VERSION);
  display.setTextSize(1);
  display.setCursor(0, 24);
  display.print(nameSnapshot.length() ? nameSnapshot : String("Starting..."));
  display.display();
}

// Tier 4 idle content: clock, unit display name, WiFi link state. Local time
// is UTC (the RTC's own timebase, since NTP sync uses configTime(0,0,...))
// plus deviceConfigTzOffset minutes, computed on raw unixtime -- NOT via
// RTClib's TimeSpan, whose minutes field is int8_t and would silently
// truncate/overflow for a +14:00 zone (840 minutes).
void renderIdleScreen() {
  DateTime utcNow = rtc.now();
  uint32_t localEpoch = utcNow.unixtime() + (int32_t)getDeviceConfigTzOffsetSafe() * 60;
  DateTime local(localEpoch);

  char clockBuf[6];
  sprintf(clockBuf, "%02d:%02d", local.hour(), local.minute());

  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.print(clockBuf);

  String nameSnapshot = sanitizeForDisplay(getDisplayNameSafe());
  display.setTextSize(1);
  display.setCursor(0, 24);
  display.print(nameSnapshot.length() ? nameSnapshot : String("Unassigned"));

  display.setCursor(0, 36);
  // "No server" = link associated but every HTTPS call is being refused. Was
  // the invisible failure mode: the screen said "Online" and the device had
  // silently stopped talking to the server.
  display.print(WiFi.status() != WL_CONNECTED ? "Offline"
                : getServerReachableSafe()   ? "Online"
                :                              "No server");

  // Tier 3 (Phase 6): offline+queue-depth banner, a 4th line layered over
  // idle rather than a separate screen -- "persistent banner over idle" per
  // the priority tiers table, not a takeover. Dropped-record count only
  // shows here, never on an otherwise-clean idle screen -- the real audience
  // for silent data loss is the administrator via the dashboard, this is
  // just a hint something's wrong right now.
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  bool degraded = tierActive[TIER_DEGRADED];
  xSemaphoreGive(displayMutex);
  if (degraded) {
    long depth = 0, dropped = 0;
    getQueueStatsSafe(depth, dropped);
    String banner = String(depth) + " queued";
    if (dropped > 0) banner += " (" + String(dropped) + " lost)";
    display.setCursor(0, 48);
    display.print(banner);
  }
}

// Generic card renderer for any tier whose content lives in tierHeadline[]/
// tierLine2[]/tierLine3[] -- Tier 1 (Phase 4: scan outcomes; Phase 5:
// enrollment/master-confirm) and Tier 0 (Phase 5: the portal screen) both
// use it, since postDisplayState() already stores content generically per
// tier regardless of which tier posts it. Headline is meant for short,
// controlled status text (verdict/state/mode -- always fits the 10-char
// size-2 budget since it's firmware-authored); line2/3 are for less
// predictable content (member names, SSID) that need the more generous
// 21-char size-1 budget instead.
void renderCard(DisplayTier tier) {
  xSemaphoreTake(displayMutex, portMAX_DELAY);
  String headline = tierHeadline[tier];
  String l2 = tierLine2[tier];
  String l3 = tierLine3[tier];
  xSemaphoreGive(displayMutex);

  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.print(sanitizeForDisplay(headline));

  display.setTextSize(1);
  if (l2.length()) {
    display.setCursor(0, 24);
    display.print(sanitizeForDisplay(l2));
  }
  if (l3.length()) {
    display.setCursor(0, 36);
    display.print(sanitizeForDisplay(l3));
  }
}

// Picks up a verdict for the scan FingerprintTask is currently watching, if
// any. Called every loop iteration; both early-outs below are cheap (no
// mutex) so this costs nothing once nothing's pending.
void checkScanVerdict() {
  if (pendingScanId.length() == 0) return;

  if (millis() > pendingScanDeadlineMs) {
    pendingScanId = "";  // correlation window elapsed -- give up watching
    return;
  }

  xSemaphoreTake(displayMutex, portMAX_DELAY);
  bool haveVerdict = verdictPending && verdictScanId == pendingScanId;
  String v = verdictText;
  if (haveVerdict) verdictPending = false;  // consume it
  xSemaphoreGive(displayMutex);

  if (!haveVerdict) return;

  // Plan: Phase 1 shows ~1.5s; extend to ~2.5s total (from the original scan)
  // if the verdict lands inside that. A late verdict (up to the 4s
  // correlation window) still gets a full second of visibility rather than
  // being silently dropped -- capped, not left to balloon past ~5s total.
  unsigned long elapsed = millis() - pendingScanStartMs;
  unsigned long remainingMs = (elapsed < 2500) ? (2500 - elapsed) : 1000;
  postDisplayState(TIER_INTERACTION, remainingMs, pendingScanName, v, "");
  pendingScanId = "";
}

// Master-confirm timeout (Phase 5, Q5) -- called every loop iteration,
// unconditionally, so an armed window resolves at the actual 8s deadline
// rather than only whenever the next scan attempt happens to land. Deadline
// set marginally earlier than the "CONFIRM?" card's own tier timebox (both
// set within the same few lines at arm time), so this reliably wins the
// race and overrides with "CANCELLED" before the generic tier-expiry logic
// in renderDisplayIfDirty() would otherwise just silently fall back to idle.
void checkMasterConfirmTimeout() {
  if (!masterConfirmArmed) return;
  if (millis() <= masterConfirmDeadlineMs) return;
  Serial.printf("Master confirm timed out (fid=%d, no second press within 8s).\n", masterConfirmFid);
  masterConfirmArmed = false;
  pendingScanId = "";
  postDisplayState(TIER_INTERACTION, 1500, "CANCELLED", "", "");
}

// Dirty-flag render: called every FingerprintTask loop iteration (~100 Hz)
// but only actually flushes the ~1 KB I2C frame when something changed --
// never repaint from showReadyState()-frequency code, which would wreck both
// the scan loop and the RTC reads sharing this bus (see design notes).
void renderDisplayIfDirty() {
  if (!displayAvailable) return;

  unsigned long now = millis();
  bool tierChanged = false;

  xSemaphoreTake(displayMutex, portMAX_DELAY);
  for (int t = 0; t < TIER_COUNT; t++) {
    if (tierActive[t] && tierExpiresAtMs[t] && now > tierExpiresAtMs[t]) {
      // Higher tier's timebox ended -- fall back to the highest-priority
      // active lower tier (idle, tier 4, is always active as the floor).
      tierActive[t] = false;
      tierExpiresAtMs[t] = 0;
      tierChanged = true;
    }
  }
  int activeTier = TIER_IDLE;
  for (int t = 0; t < TIER_COUNT; t++) {
    if (tierActive[t]) { activeTier = t; break; }
  }
  bool wakeRequested = displayWakeRequested;
  displayWakeRequested = false;
  xSemaphoreGive(displayMutex);

  if (tierChanged) displayDirty = true;

  bool neverSleeps = (activeTier == TIER_TAKEOVER || activeTier == TIER_BLOCKED);

  if (displayAsleep) {
    if (!wakeRequested && !neverSleeps) return;  // stay asleep, nothing to draw
    display.ssd1306_command(SSD1306_DISPLAYON);
    displayAsleep = false;
    displayDirty = true;
    Serial.println("Display: waking");
  } else if (!neverSleeps && (now - displayLastActivityMs > DISPLAY_SLEEP_MS)) {
    display.ssd1306_command(SSD1306_DISPLAYOFF);
    displayAsleep = true;
    Serial.println("Display: sleeping (120s idle)");
    return;
  }

  // TIER_DEGRADED renders via renderIdleScreen() too (Phase 6: it's a banner
  // over idle, not a separate screen), so its clock needs the same 1s tick.
  bool idleTick = (activeTier == TIER_IDLE || activeTier == TIER_DEGRADED) &&
                 (now - lastIdleRenderMs >= 1000);
  if (!displayDirty && !idleTick) return;

  display.clearDisplay();
  switch (activeTier) {
    case TIER_TAKEOVER:
    case TIER_INTERACTION:
    case TIER_BLOCKED:
      // activeTier is plain int (see its declaration above) -- C++ doesn't
      // implicitly convert int to an enum parameter, hence the cast. Safe by
      // construction: it's always assigned from a loop index < TIER_COUNT.
      renderCard((DisplayTier)activeTier);
      break;
    case TIER_DEGRADED:
    case TIER_IDLE:
    default:
      // TIER_DEGRADED is idle + an extra banner line, drawn inside
      // renderIdleScreen() itself (it checks tierActive[TIER_DEGRADED]).
      renderIdleScreen();
      break;
  }
  display.display();

  displayDirty = false;
  if (activeTier == TIER_IDLE || activeTier == TIER_DEGRADED) lastIdleRenderMs = now;
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

  // Tier 0 takeover (Q4): SSID and IP only, never the password. No expiry --
  // this persists until the device restarts (either via /save or manually).
  // Safe to call display.* directly here even though this can also run from
  // setup() before any tasks exist: both paths are Core 1 (the Arduino main
  // loopTask is pinned there by default, same as FingerprintTask), and
  // Wire/display/displayMutex are all initialized at the very top of setup(),
  // before this function can ever be reached either way. Other tasks are
  // suspended above, so there's no concurrent poster to arbitrate against;
  // a single render is enough since nothing about this screen changes.
  postDisplayState(TIER_TAKEOVER, 0, "SETUP", AP_SSID, WiFi.softAPIP().toString());
  renderDisplayIfDirty();

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
      if (code >= 200 && code < 300) { markPostResult(true); return true; }
      if (code >= 500 || code == 429) {
        Serial.printf("Server transient %d; will retry\n", code);
      } else {
        Serial.printf("Permanent HTTP failure %d\n", code);
        // A 4xx means the server answered — it IS reachable, this payload is
        // just rejected. Don't let it feed the unreachable watchdog.
        markPostResult(true);
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
  markPostResult(false);
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
  // deviceMac is populated once in setup() right after WiFi.mode(WIFI_STA) --
  // reused here instead of recomputing it locally (Phase 6: also needed for
  // the awaiting-assignment/rejected screens).
  JsonDocument reqDoc;
  reqDoc["mac"] = deviceMac;
  String payload;
  serializeJson(reqDoc, payload);

  int code = 0; String body = "";
  Serial.println("Registering device with MAC: " + deviceMac);

  if (!postJSONBootstrap(payload, REGISTER_URL, code, body)) {
    Serial.printf("register HTTP failed (code=%d)\n", code);
    return false;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.printf("register: JSON parse failed: %s\n", err.c_str());
    return false;
  }

  deviceId = doc["device_id"] | "";
  if (deviceId.length() == 0) {
    Serial.println("register: no device_id in response");
    return false;
  }

  String status = doc["status"] | "";
  Serial.printf("Registered: device_id=%s status=%s\n", deviceId.c_str(), status.c_str());

  if (status == "assigned") {
    String newInstitutionId = doc["institution_id"] | "";
    String newDeviceSecret  = doc["device_secret"]  | "";
    String newDisplayName   = doc["display_name"]   | "";

    // /register deliberately withholds institution_id/device_secret when this
    // MAC is already assigned (see register/index.ts) -- releasing a live
    // device's secret to anyone holding just the shared bootstrap secret would
    // let them impersonate a device they've never physically touched. That
    // means "assigned" here can arrive incomplete (a re-registering device
    // whose SPIFFS was wiped). Trusting it anyway would save an identity file
    // with an empty institution_id/device_secret -- and since deviceId above
    // is already set, this device would never call registerDevice() again,
    // bricking silently. Treat an incomplete "assigned" as not-yet-assigned:
    // NetworkTask will fall through to pollAssignment() instead (deviceId is
    // known), which fails loudly with 401 until an admin deletes/re-adds the
    // device in the dashboard.
    if (newInstitutionId.length() == 0 || newDeviceSecret.length() == 0) {
      Serial.println("register: assigned but institution_id/device_secret withheld -- "
                      "needs admin action (delete + re-add device in dashboard)");
      pendingAssignment = true;
      // Not REJECTED yet -- that's specifically for a rejected provisioning
      // token, which is what pollAssignment() will discover moments from now
      // (no valid token exists on this path). PENDING is an accurate baseline
      // in the meantime.
      setBlockedReason(BLOCKED_PENDING);
      return true;
    }

    institutionId = newInstitutionId;
    deviceSecret  = newDeviceSecret;
    setDisplayName(newDisplayName);
    saveDeviceIdentity();
    clearProvisioning();
    // T9: ensure all identity writes are visible to NetworkTask on Core 0 before
    // clearing the flag. Without a compiler barrier the assignments above could
    // be reordered past the store to pendingAssignment by the compiler.
    __asm__ volatile("" ::: "memory");
    pendingAssignment = false;
    setBlockedReason(BLOCKED_NONE);
  } else {
    // H7: capture and persist the provisioning token so /assignment-poll can
    // later prove this device's identity to retrieve the device_secret.
    provisioningToken = doc["provisioning_token"] | "";
    saveProvisioning();
    pendingAssignment = true;
    setBlockedReason(BLOCKED_PENDING);
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
  JsonDocument reqDoc;
  reqDoc["device_id"]          = deviceId;
  reqDoc["provisioning_token"] = provisioningToken;
  String payload;
  serializeJson(reqDoc, payload);

  int code = 0; String body = "";

  if (!postJSONBootstrap(payload, ASSIGNMENT_POLL_URL, code, body)) {
    // Distinct from ordinary "awaiting assignment" -- a rejected token means
    // the device row was deleted/re-created (H7) or the token otherwise no
    // longer matches, and no amount of waiting will fix it. Without this the
    // state is undebuggable in the field: it looks identical to "just hasn't
    // been assigned yet" forever.
    if (code == 401) setBlockedReason(BLOCKED_REJECTED);
    return false;
  }

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.printf("pollAssignment: JSON parse failed: %s\n", err.c_str());
    return false;
  }

  String status = doc["status"] | "";
  if (status != "assigned") {
    setBlockedReason(BLOCKED_PENDING);
    return false;
  }

  institutionId = doc["institution_id"] | "";
  deviceSecret  = doc["device_secret"]  | "";
  setDisplayName(doc["display_name"] | "");

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
  setBlockedReason(BLOCKED_NONE);
  Serial.printf("Assigned! institution_id=%s display_name=%s\n",
                institutionId.c_str(), displayName.c_str());
  return true;
}

/* ================== Enrollment support ================== */
void reportEnrollUpdate(const String &jobId, const String &status, int fingerId,
                        const String &note, const String &fingerSlot, const String &memberId) {
  if (jobId.length() == 0) return;

  // T1e: include device_id so update-enrollment-job can authenticate via per-device secret.
  // Optional fields stay omitted (not null) when unset — update-enrollment-job
  // branches on their presence, so this must not become an unconditional write.
  JsonDocument doc;
  doc["id"]             = jobId;
  doc["device_id"]      = deviceId;
  doc["institution_id"] = institutionId;
  doc["status"]         = status;
  if (fingerId > 0)        doc["fid"]         = fingerId;
  if (note.length())       doc["note"]        = note;
  if (fingerSlot.length()) doc["finger_slot"] = fingerSlot;
  if (memberId.length())  doc["member_id"]   = memberId;
  String payload;
  serializeJson(doc, payload);

  Serial.printf("reportEnrollUpdate: jobId=%s status=%s fid=%d\n",
                jobId.c_str(), status.c_str(), fingerId);
  int httpCode = 0; String body;
  bool ok = postJSONToUrl(payload, ENROLL_UPD_URL, httpCode, body);
  Serial.printf("update-enrollment-job -> code=%d body=%s\n", httpCode, body.c_str());
  // Durability: a lost report used to strand the job at in_progress forever.
  // Persist it and let NetworkTask retry (flushEnrollReports). A 4xx is final
  // (job gone / rejected) so it isn't worth re-queuing.
  if (!ok && (httpCode <= 0 || httpCode >= 500 || httpCode == 429)) {
    Serial.println("reportEnrollUpdate: POST failed — queuing for retry");
    xSemaphoreTake(spiffsMutex, portMAX_DELAY);
    appendEnrollReport_locked(payload);
    xSemaphoreGive(spiffsMutex);
  }
}

/* ================== Enrollment execution ================== */

// E-series cards (Phase 5): process steps for enrolling a single finger.
// Takes the job for name/slot -- job.name and job.fingerSlot are known to
// the caller and only needed here for display, so passed through rather
// than threading them as separate parameters. The final ENROLLED outcome
// card is posted by the caller (enrollment_doRegister), not here -- this
// function only reports process/failure states along the way.
int enrollID_toFid(const EnrollJob &job, int requestedFid) {
  if (requestedFid < 1 || requestedFid > MAX_FID) {
    Serial.println("Requested fid invalid");
    return -1;
  }

  String name = job.name;
  String slotLabel = (job.fingerSlot == "fin2") ? "Finger 2" : "Finger 1";
  // Any card posted here supersedes an older scan's verdict watch, same as
  // every other Tier 1 posting site (see the cooldown branch in
  // FingerprintTask for the fuller reasoning).
  pendingScanId = "";

  Serial.printf("Enrollment: starting for fid=%d\n", requestedFid);
  unsigned long timeout = 20000;

  Serial.println("Place finger: (first press) -- 20s timeout");
  setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_YELLOW);
  postDisplayState(TIER_INTERACTION, timeout, "PRESS 1/2", name, slotLabel);
  renderDisplayIfDirty();
  unsigned long start = millis();
  int p;
  while (millis() - start < timeout) {
    p = finger.getImage();
    if (p == FINGERPRINT_OK) break;
    if (p == FINGERPRINT_NOFINGER) { delay(120); continue; }
    Serial.printf("getImage error (1): %d\n", p);
    postDisplayState(TIER_INTERACTION, 1500, "BAD SCAN", name, "");
    renderDisplayIfDirty();
    return -1;
  }
  if (millis() - start >= timeout) {
    Serial.println("Timeout (first press)");
    postDisplayState(TIER_INTERACTION, 1500, "TIMED OUT", name, "");
    renderDisplayIfDirty();
    return -1;
  }

  Serial.println("Image captured (1). Converting...");
  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) {
    Serial.printf("image2Tz (1) failed: %d\n", p);
    postDisplayState(TIER_INTERACTION, 1500, "BAD SCAN", name, "");
    renderDisplayIfDirty();
    return -1;
  }

  Serial.println("Remove finger.");
  setSensorLED(FINGERPRINT_LED_OFF, 0, 0);
  postDisplayState(TIER_INTERACTION, 1500, "REMOVE", name, "");
  renderDisplayIfDirty();
  delay(1200);

  Serial.println("Place same finger again: (second press) -- 20s timeout");
  setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_YELLOW);
  postDisplayState(TIER_INTERACTION, timeout, "PRESS 2/2", name, slotLabel);
  renderDisplayIfDirty();
  start = millis();
  while (millis() - start < timeout) {
    p = finger.getImage();
    if (p == FINGERPRINT_OK) break;
    if (p == FINGERPRINT_NOFINGER) { delay(120); continue; }
    Serial.printf("getImage error (2): %d\n", p);
    postDisplayState(TIER_INTERACTION, 1500, "BAD SCAN", name, "");
    renderDisplayIfDirty();
    return -1;
  }
  if (millis() - start >= timeout) {
    Serial.println("Timeout (second press)");
    postDisplayState(TIER_INTERACTION, 1500, "TIMED OUT", name, "");
    renderDisplayIfDirty();
    return -1;
  }

  Serial.println("Image captured (2). Converting...");
  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) {
    Serial.printf("image2Tz (2) failed: %d\n", p);
    postDisplayState(TIER_INTERACTION, 1500, "BAD SCAN", name, "");
    renderDisplayIfDirty();
    return -1;
  }

  Serial.println("Creating model...");
  p = finger.createModel();
  if (p != FINGERPRINT_OK) {
    // Almost always FINGERPRINT_ENROLLMISMATCH -- the two presses didn't
    // resolve to the same finger.
    Serial.printf("createModel failed: %d\n", p);
    postDisplayState(TIER_INTERACTION, 1500, "MISMATCH", name, "");
    renderDisplayIfDirty();
    return -1;
  }

  Serial.printf("Storing model to ID %d\n", requestedFid);
  p = finger.storeModel(requestedFid);
  if (p == FINGERPRINT_OK) { Serial.println("Stored successfully!"); return requestedFid; }
  Serial.printf("Failed to store model, code: %d\n", p);
  postDisplayState(TIER_INTERACTION, 1500, "STORE FAIL", name, "");
  renderDisplayIfDirty();
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
      pendingScanId = "";
      postDisplayState(TIER_INTERACTION, 1500, "FULL", "No free slot", "");
      renderDisplayIfDirty();
      reportEnrollUpdate(job.id, "failed", -1, "no-free-fid", job.fingerSlot, job.memberId);
      return;
    }
  } else {
    if (fidMap[fidToUse].length())
      Serial.printf("Warning: fid %d already occupied by %s; will overwrite.\n",
                    fidToUse, fidMap[fidToUse].c_str());
  }

  // Sensor-truth overwrite guard. The dashboard's occupancy check works off
  // members.fin1/fin2 + master-job history and can miss a slot that is
  // occupied on the physical sensor but not reflected there (orphaned model
  // from a failed delete, an out-of-band enrollment). Probe the sensor
  // itself: loadModel() returning OK means a real template lives in that
  // page. Only FingerprintTask touches the sensor and it runs this whole
  // job without yielding to any other sensor user, so there is no
  // check-then-store race. Refuse unless the operator explicitly approved
  // the overwrite (job.allowOverwrite, from enrollment_jobs.allow_overwrite).
  if (!job.allowOverwrite) {
    int lp = finger.loadModel(fidToUse);
    if (lp == FINGERPRINT_OK) {
      Serial.printf("Enrollment refused: sensor slot %d already holds a template "
                    "and overwrite was not approved.\n", fidToUse);
      pendingScanId = "";
      postDisplayState(TIER_INTERACTION, 2500, "OCCUPIED", job.name, "Slot not overwritten");
      renderDisplayIfDirty();
      reportEnrollUpdate(job.id, "failed", fidToUse, "slot-occupied", job.fingerSlot, job.memberId);
      return;
    }
  }

  setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_PURPLE);
  int resFid = enrollID_toFid(job, fidToUse);
  if (resFid > 0) {
    fidMap[resFid]     = job.uniqueId.length() ? job.uniqueId : String("AUTO_") + String(resFid);
    fidMapRole[resFid] = role;
    fidMapName[resFid] = job.name;
    saveFidMapToFS();
    Serial.printf("Saved fid %d -> %s name=%s\n", resFid, fidMap[resFid].c_str(), fidMapName[resFid].c_str());
    setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_GREEN);
    postDisplayState(TIER_INTERACTION, 1500, "ENROLLED", job.name,
                     (job.fingerSlot == "fin2") ? "Finger 2" : "Finger 1");
    renderDisplayIfDirty();
    vTaskDelay(800 / portTICK_PERIOD_MS);
    showReadyState();
    reportEnrollUpdate(job.id, "completed", resFid, "", job.fingerSlot, job.memberId);
  } else {
    setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
    // enrollID_toFid() already posted a specific card for the failure cause
    // (timed out / bad scan / mismatch / store fail) -- don't overwrite it
    // with a generic one here.
    vTaskDelay(800 / portTICK_PERIOD_MS);
    showReadyState();
    reportEnrollUpdate(job.id, "failed", -1, "enroll-failed", job.fingerSlot, job.memberId);
  }
}

void enrollment_doDeleteByFid(const EnrollJob &job, int fid) {
  pendingScanId = "";
  if (fid < 1 || fid > MAX_FID) {
    postDisplayState(TIER_INTERACTION, 1500, "DEL FAILED", job.name, "");
    renderDisplayIfDirty();
    reportEnrollUpdate(job.id, "failed", -1, "invalid-fid", job.fingerSlot, job.memberId);
    return;
  }
  int p = finger.deleteModel(fid);
  if (p == FINGERPRINT_OK) {
    fidMap[fid] = ""; fidMapRole[fid] = ""; fidMapName[fid] = "";
    saveFidMapToFS();
    postDisplayState(TIER_INTERACTION, 1500, "REMOVED", job.name, "");
    renderDisplayIfDirty();
    reportEnrollUpdate(job.id, "completed", fid, "", job.fingerSlot, job.memberId);
  } else {
    Serial.printf("deleteModel failed: %d\n", p);
    postDisplayState(TIER_INTERACTION, 1500, "DEL FAILED", job.name, "");
    renderDisplayIfDirty();
    reportEnrollUpdate(job.id, "failed", fid, String(p), job.fingerSlot, job.memberId);
  }
}

void enrollment_doDeleteByUnique(const EnrollJob &job) {
  int fid = findFidByUnique(job.uniqueId);
  if (fid <= 0) {
    pendingScanId = "";
    postDisplayState(TIER_INTERACTION, 1500, "DEL FAILED", job.name, "Not found");
    renderDisplayIfDirty();
    reportEnrollUpdate(job.id, "failed", -1, "not-found", job.fingerSlot, job.memberId);
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
  if (totalDropped) {
    Serial.printf("SPIFFS queue trimmed: dropped %u (age=%u count=%u bytes=%u), kept %u\n",
                  (unsigned)totalDropped, (unsigned)droppedAge,
                  (unsigned)droppedCount, (unsigned)droppedBytes, (unsigned)kept.size());
    // Every trim-dropped entry is actual data loss (nothing here was ever
    // sent) -- reconcile both counters using numbers already computed above,
    // never by re-counting SPIFFS lines.
    queueDepthAdjust(-(long)totalDropped);
    droppedCountAdjust((long)totalDropped);
  }
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
  bool persisted = appendToSPIFFSQueue_locked(payloadJson);
  if (persisted) {
    Serial.println("[queue] Persisted to SPIFFS: " + payloadJson);
  }
  xSemaphoreGive(spiffsMutex);
  // Outside the spiffsMutex critical section -- this is a separate,
  // lightweight displayMutex-protected counter, not SPIFFS state.
  if (persisted) queueDepthAdjust(1);
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

  if (droppedStale) {
    Serial.printf("flushQueue: dropped %u stale entries\n", (unsigned)droppedStale);
    // Reconciled immediately, not at the end with the network-loop counts --
    // pending.empty() below can return before reaching that point, and a
    // stale-only batch (nothing left to even attempt sending) must not skip
    // this accounting.
    queueDepthAdjust(-(long)droppedStale);
    droppedCountAdjust((long)droppedStale);
  }

  if (pending.empty()) {
    SPIFFS.remove(QUEUE_INFLIGHT_FILE);
    return;
  }

  Serial.printf("Flushing %u queued records\n", (unsigned)pending.size());
  std::vector<String> keep;
  size_t sentOkCount = 0;
  size_t permanentDropCount = 0;
  for (auto &entry : pending) {
    int httpCode = 0; String body;
    bool ok = postJSONToUrl(entry, SUPABASE_URL, httpCode, body);
    if (ok) {
      Serial.printf("flushQueue: sent OK\n");
      postScanVerdict(entry, true, body);
      sentOkCount++;
      continue;
    }
    if (httpCode >= 500 || httpCode == 429 || httpCode < 0) {
      // Transient -- re-queued for a later retry, so this is NOT a final
      // verdict yet. No postScanVerdict() call: better to let the pending
      // card time out silently than show a premature ERROR that a retry
      // might still turn into a success. Stays in `keep`, so it's not part
      // of this flush's queue-depth reconciliation either -- still pending.
      Serial.printf("flushQueue: transient (code=%d). Keeping record.\n", httpCode);
      keep.push_back(entry);
    } else {
      Serial.printf("flushQueue: permanent failure (code=%d). Dropping record.\n", httpCode);
      postScanVerdict(entry, false, body);
      permanentDropCount++;
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

  // Reconcile using the counts this flush already computed -- never by
  // re-counting SPIFFS lines. Everything in `keep` stays pending (no depth
  // change); sent-OK, permanently-failed, and cap-evicted entries are all
  // gone from the queue, but only the latter two are actual data loss.
  long removedThisFlush = (long)sentOkCount + (long)permanentDropCount +
                          (long)capDroppedCount + (long)capDroppedBytes;
  long lostThisFlush = (long)permanentDropCount + (long)capDroppedCount + (long)capDroppedBytes;
  if (removedThisFlush) queueDepthAdjust(-removedThisFlush);
  if (lostThisFlush) droppedCountAdjust(lostThisFlush);

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

// Boot-only (Phase 6): seed the in-RAM queue-depth counter from whatever's
// already on disk -- a prior session's unflushed backlog, or nothing on a
// fresh device. Must run after recoverInflightQueue() so an orphaned
// in-flight file is already merged back in and gets counted. Single-threaded
// here (before tasks start), so a direct assignment, not the mutex-protected
// queueDepthAdjust() -- nothing else could be racing yet. This is the ONLY
// place queue depth is ever derived by counting SPIFFS lines; everywhere
// else it's the maintained in-RAM counter, never recomputed on repaint.
static void seedQueueDepthFromDisk() {
  if (!SPIFFS.exists(QUEUE_FILE)) { queueDepth = 0; return; }
  File f = SPIFFS.open(QUEUE_FILE, FILE_READ);
  if (!f) { queueDepth = 0; return; }
  long count = 0;
  while (f.available()) {
    String ln = f.readStringUntil('\n');
    ln.trim();
    if (ln.length()) count++;
  }
  f.close();
  queueDepth = count;
  Serial.printf("Queue depth seeded from disk: %ld\n", queueDepth);
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

    // The GitHub release payload is large (tens of KB) and we need exactly two
    // things from it. A deserialization filter keeps the document tiny instead
    // of materialising every field of every asset.
    JsonDocument filter;
    filter["tag_name"] = true;
    filter["assets"][0]["browser_download_url"] = true;

    JsonDocument doc;
    DeserializationError err =
        deserializeJson(doc, body, DeserializationOption::Filter(filter));
    if (err) { Serial.printf("OTA: JSON parse failed: %s\n", err.c_str()); return; }

    String latestTag = doc["tag_name"] | "";
    if (latestTag.length() == 0) { Serial.println("OTA: No tag_name in response"); return; }

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

    // First .bin asset wins, matching the previous scan order.
    for (JsonObject asset : doc["assets"].as<JsonArray>()) {
      String candidate = asset["browser_download_url"] | "";
      if (candidate.endsWith(".bin")) { binUrl = candidate; break; }
    }
  }

  if (binUrl.length() == 0) { Serial.println("OTA: No .bin asset found in release"); return; }
  Serial.printf("OTA: Downloading from %s\n", binUrl.c_str());
  Serial.printf("OTA: Free heap before download: %u bytes\n", esp_get_free_heap_size());

  otaInProgress = true;
  // checkAndApplyOTA() runs from setup() after tasks are created (this is
  // the boot-jitter-delayed call at the end of setup()), so it's a separate
  // task from FingerprintTask even though both happen to be pinned to Core 1
  // -- they time-slice, not run single-threaded. postDisplayState() is
  // Core-0-safe (never touches `display`), so it's the correct way to get
  // content on screen here too; FingerprintTask's own render loop (still
  // running throughout OTA -- only its sensor-scanning half is skipped while
  // otaInProgress) picks it up and actually draws it.
  postDisplayState(TIER_TAKEOVER, 0, "OTA UPDATE", "Starting...", "Do not unplug");
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
      otaInProgress = false; clearDisplayState(TIER_TAKEOVER); return;
    }
    int binCode = binHttp.GET();
    if (binCode != HTTP_CODE_OK) {
      Serial.printf("OTA: Binary download returned %d\n", binCode);
      binHttp.end(); otaInProgress = false; clearDisplayState(TIER_TAKEOVER); return;
    }
    int contentLen = binHttp.getSize();
    Serial.printf("OTA: Binary size = %d bytes\n", contentLen);
    if (!Update.begin(contentLen > 0 ? contentLen : UPDATE_SIZE_UNKNOWN)) {
      Serial.printf("OTA: Update.begin failed: %s\n", Update.errorString());
      binHttp.end(); otaInProgress = false; clearDisplayState(TIER_TAKEOVER); return;
    }
    // Deliberately NOT rewriting the download/flash loop itself to compute
    // this manually -- checkAndApplyOTA() is already the highest-risk
    // function in the codebase (a fault here isn't remotely recoverable), so
    // this is the most surgical option: Update's own progress hook, added
    // alongside the untouched writeStream() call, not a replacement for it.
    Update.onProgress([](size_t written, size_t total) {
      static unsigned long lastUiUpdateMs = 0;
      unsigned long now = millis();
      if (now - lastUiUpdateMs < 500 && written < total) return;  // throttled, but always show the final tick
      lastUiUpdateMs = now;
      char progress[8];
      if (total > 0) snprintf(progress, sizeof(progress), "%d%%", (int)(100UL * written / total));
      else snprintf(progress, sizeof(progress), "%uKB", (unsigned)(written / 1024));
      postDisplayState(TIER_TAKEOVER, 0, "OTA UPDATE", progress, "Do not unplug");
    });
    WiFiClient *stream = binHttp.getStreamPtr();
    size_t written = Update.writeStream(*stream);
    Serial.printf("OTA: Written %u / %d bytes\n", written, contentLen);
    binHttp.end();
    if (Update.end()) {
      if (Update.isFinished()) {
        Serial.println("OTA: Update complete! Rebooting...");
        postDisplayState(TIER_TAKEOVER, 0, "OTA UPDATE", "100%", "Rebooting...");
        setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_GREEN);
        delay(1500);
        ESP.restart();
      } else {
        Serial.println("OTA: Update did not finish correctly.");
        clearDisplayState(TIER_TAKEOVER);
      }
    } else {
      Serial.printf("OTA: Update.end error: %s\n", Update.errorString());
      clearDisplayState(TIER_TAKEOVER);
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
    flushEnrollReports();
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

    // Tier 3 degraded banner (Phase 6): shown whenever the device can't reach
    // the server -- WiFi link down OR link up but every HTTPS call refused.
    // renderIdleScreen() re-reads the live queue counters each 1s idle tick.
    static bool degradedBannerShown       = false;
    static unsigned long lastReassocMs     = 0;
    static unsigned long unreachableSinceMs = 0;

    const bool linkUp = (WiFi.status() == WL_CONNECTED);
    bool reachable = true; int netFails = 0; unsigned long lastOkMs = 0;
    if (linkUp) getNetHealthSafe(reachable, netFails, lastOkMs);
    const bool degraded = !linkUp || !reachable;

    if (degraded && !degradedBannerShown) {
      postDisplayState(TIER_DEGRADED, 0, "", "", "");
      degradedBannerShown = true;
    } else if (!degraded && degradedBannerShown) {
      clearDisplayState(TIER_DEGRADED);
      degradedBannerShown = false;
    }

    if (linkUp && reachable) {
      unreachableSinceMs = 0;
      if (!rtcSynced) {
        configTime(0, 0, "pool.ntp.org", "time.nist.gov");
        vTaskDelay(pdMS_TO_TICKS(2000));
        syncRTCFromNTP();
        rtcSynced = true;
      }
      flushQueue();
      flushEnrollReports();
    } else if (linkUp && !reachable) {
      // Link associated but the server won't answer -- heap/TLS/socket wedge,
      // or a filtering middlebox. Escalate.
      rtcSynced = false;
      const unsigned long now = millis();
      if (unreachableSinceMs == 0) unreachableSinceMs = now;

      // Keep trying: the very next POST that succeeds clears the flag via
      // markPostResult().
      flushQueue();
      flushEnrollReports();

      // Step 1: force a fresh association periodically -- often clears a
      // half-wedged supplicant / stale DHCP lease without a full reboot.
      if (now - lastReassocMs > NET_REASSOC_INTERVAL_MS) {
        lastReassocMs = now;
        Serial.printf("NetworkTask: server unreachable (%d fails) -- forcing WiFi re-associate\n", netFails);
        WiFi.disconnect(true);
        vTaskDelay(pdMS_TO_TICKS(1000));
        WiFi.begin(wifiSSID.c_str(), wifiPASS.c_str());
      }

      // Step 2: still nothing after NET_REBOOT_AFTER_MS of a live link with no
      // successful POST -- the network stack is wedged; only a reboot clears
      // it. Never mid-OTA, mid-enrollment, or under a takeover screen.
      const bool safeToReboot = !otaInProgress && !enrollmentJobPending
                                && !tierActive[TIER_INTERACTION] && !tierActive[TIER_TAKEOVER];
      const bool tooLong =
        (lastOkMs != 0 && now - lastOkMs > NET_REBOOT_AFTER_MS) ||
        (now - unreachableSinceMs > NET_REBOOT_AFTER_MS);
      if (tooLong && safeToReboot) {
        Serial.println("NetworkTask: server unreachable too long -- rebooting to clear the network stack");
        vTaskDelay(pdMS_TO_TICKS(200));
        ESP.restart();
      }
    } else {
      // WiFi link itself is down -- original reconnect path.
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

    // Runtime heap watch: a heap so fragmented the largest free block can't
    // hold an mbedTLS arena is an unrecoverable HTTPS wedge -- reboot out of it.
    {
      static unsigned long lastHeapLogMs = 0;
      const unsigned long now = millis();
      if (now - lastHeapLogMs > 60000UL) {
        lastHeapLogMs = now;
        const size_t largest = ESP.getMaxAllocHeap();
        Serial.printf("Heap: free=%u largest=%u\n",
                      (unsigned)esp_get_free_heap_size(), (unsigned)largest);
        const bool safeToReboot = !otaInProgress && !enrollmentJobPending
                                  && !tierActive[TIER_INTERACTION] && !tierActive[TIER_TAKEOVER];
        if (largest < NET_MIN_LARGEST_BLOCK && safeToReboot) {
          Serial.println("NetworkTask: heap too fragmented for TLS -- rebooting");
          vTaskDelay(pdMS_TO_TICKS(200));
          ESP.restart();
        }
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
      JsonDocument reqDoc;
      reqDoc["device_id"] = deviceId;
      // Rev actually on disk, not any pending value -- see saveDeviceConfig().
      reqDoc["device_config_rev"] = deviceConfigRevOnDisk;
      String payload;
      serializeJson(reqDoc, payload);

      int code = 0; String body = "";
      postJSONToUrl(payload, ENROLL_GET_URL, code, body);
      Serial.printf("EnrollmentTask: HTTP %d body=%s\n", code, body.c_str());

      if (code == 403) {
        // Revoked (devices.revoked): the device keeps its identity -- unlike
        // decommission, this isn't a wipe -- but is blocked from doing
        // anything until an admin un-revokes it. Persistent, Tier 2, never
        // sleeps. Cleared below the moment a normal response comes back.
        Serial.println("EnrollmentTask: device revoked");
        setBlockedReason(BLOCKED_REVOKED);
      } else if (code >= 200 && code < 300 && body.length()) {
        // A normal response means we're not revoked (if we ever were).
        setBlockedReason(BLOCKED_NONE);
        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, body);
        if (err) {
          Serial.printf("EnrollmentTask: JSON parse failed: %s\n", err.c_str());
        } else {
          // Decommission signal: the platform deleted this device. Wipe identity and reboot
          // so the device returns to the provisioning flow on next power-on.
          if (doc["decommissioned"] | false) {
            Serial.println("EnrollmentTask: device decommissioned — wiping identity and rebooting");
            SPIFFS.remove(DEVICE_IDENTITY_FILE);
            clearProvisioning();
            // A device re-provisioned into a different institution must not
            // inherit the previous tenant's name-display policy.
            if (SPIFFS.exists(DEVICE_CONFIG_FILE)) SPIFFS.remove(DEVICE_CONFIG_FILE);
            if (SPIFFS.exists(DEVICE_CONFIG_TMP_FILE)) SPIFFS.remove(DEVICE_CONFIG_TMP_FILE);
            // Brief, visible confirmation before the wipe -- Core-0-safe post
            // (never touches `display` itself); FingerprintTask's own render
            // loop (Core 1, still running -- not suspended here) picks it up
            // and draws it during this delay.
            postDisplayState(TIER_TAKEOVER, 0, "RESET", "Re-provisioning", "");
            vTaskDelay(pdMS_TO_TICKS(1500));
            ESP.restart();
          }

          // device_config_* fields are present on every response (job null or
          // not). Only persist when something actually changed vs. disk --
          // revision-gated, not poll-gated (see saveDeviceConfig()).
          long serverConfigRev = doc["device_config_rev"] | 0;
          int  serverTzOffset  = doc["device_config_tz_offset"] | 0;
          if (serverConfigRev > 0 &&
              (serverConfigRev != deviceConfigRevOnDisk || serverTzOffset != deviceConfigTzOffset)) {
            long serverConfigVer = doc["device_config_ver"] | 1;
            // Only sent when the server considers config_rev stale. A tz_offset-only
            // change (DST, rev unchanged) is the normal case where it's absent here --
            // keep the cached value rather than overwrite it with a guess. Also covers
            // the defensive case of a rev change landing without it.
            String nameDisplay = doc["device_config_name_display"] | deviceConfigNameDisplay;
            saveDeviceConfig(serverConfigVer, serverConfigRev, serverTzOffset, nameDisplay);
          }

          // display_name can be renamed in the dashboard after initial
          // assignment; register/assignment-poll only ever set it once, so
          // refresh it here on every poll instead. No concurrent Core-0 writer
          // to race against: registerDevice()/pollAssignment() only run while
          // pendingAssignment is true, and this task only reaches here once
          // it's false (see the outer if-condition above).
          String serverDisplayName = doc["display_name"] | "";
          if (serverDisplayName.length() > 0 && serverDisplayName != getDisplayNameSafe()) {
            setDisplayName(serverDisplayName);
            saveDeviceIdentity();
          }

          // Job fields are read from the nested "job" object rather than
          // searched for across the whole body, so a top-level key can no
          // longer shadow a job field of the same name.
          JsonObject jobObj = doc["job"];
          if (!jobObj.isNull()) {
            EnrollJob job;
            job.id            = jobObj["id"]              | "";
            job.command       = jobObj["command"]         | "";
            job.fingerSlot    = jobObj["finger_slot"]     | "";
            // 1.10.0: server sends member_id; keep student_id as a fallback so a
            // device flashed before the edge functions are updated still works.
            job.memberId     = jobObj["member_id"] | jobObj["student_id"] | "";
            job.uniqueId      = jobObj["sid"]             | "";
            job.name          = jobObj["fullname"]        | "";
            job.requestedFid  = jobObj["fid"]             | 0;
            job.allowOverwrite = jobObj["allow_overwrite"] | false;

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
    // Pick up a verdict for the live scan (if any) before rendering, so it
    // shows up in this same iteration rather than a lag later.
    checkScanVerdict();
    // Unconditional -- must resolve an armed master-confirm window at its
    // actual 8s deadline even if no new scan ever arrives.
    checkMasterConfirmTimeout();
    // Display owner is this task (Core 1) only -- runs every iteration but is
    // a cheap no-op unless something's actually dirty (see renderDisplayIfDirty).
    renderDisplayIfDirty();

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
          else reportEnrollUpdate(job.id, "failed", -1, "no-id-specified", job.fingerSlot, job.memberId);
        } else if (job.command == "clearall") {
          Serial.println("Performing clearAll on sensor and local map");
          pendingScanId = "";
          int rc = finger.emptyDatabase();
          if (rc == FINGERPRINT_OK) {
            clearAllFidMap();
            // Q5: no device confirmation for clearall (already admin-
            // authenticated in the dashboard), but still a prominent 5s
            // notification -- longer than the standard 1.5s given the scale
            // of what just happened.
            postDisplayState(TIER_INTERACTION, 5000, "ERASED", "All prints", "");
            renderDisplayIfDirty();
            reportEnrollUpdate(job.id, "completed", 0, "", "", "");
          } else {
            Serial.printf("emptyDatabase returned %d\n", rc);
            postDisplayState(TIER_INTERACTION, 5000, "ERASE FAIL", "", "");
            renderDisplayIfDirty();
            reportEnrollUpdate(job.id, "failed", 0, String(rc), "", "");
          }
        } else {
          reportEnrollUpdate(job.id, "failed", -1, "unknown-cmd", "", "");
        }
      }
    }

    // Normal scan
    int fid = fingerSearch();
    if (fid != -1) {
      // Any real getImage() event (match, no-match, or error after a capture)
      // wakes the display -- -1 is specifically FINGERPRINT_NOFINGER, the
      // idle-poll case with no finger present, so this only runs on actual
      // finger interaction, not the idle polling loop. Takes effect on the
      // next renderDisplayIfDirty() call (top of this loop), a <30ms lag.
      xSemaphoreTake(displayMutex, portMAX_DELAY);
      displayWakeRequested = true;
      displayLastActivityMs = millis();
      xSemaphoreGive(displayMutex);
    }
    if (fid > 0) {
      Serial.print("Fingerprint matched ID: "); Serial.println(fid);

      String role = fidMapRole[fid];
      role.toLowerCase();

      // Master-finger confirmation (Phase 5, Q5) -- evaluated BEFORE the
      // cooldown gate below. lastScanMillis is stamped on first press and
      // the 60s attendance cooldown is far longer than this 8s confirm
      // window, so a same-fid second press would otherwise be caught and
      // swallowed by that gate before ever reaching a role check, and the
      // portal could never open. Master presses never touch the cooldown
      // bookkeeping at all -- they aren't attendance events.
      if (masterConfirmArmed) {
        if (fid == masterConfirmFid) {
          // Same master fid again within the window -- confirmed.
          masterConfirmArmed = false;
          Serial.println("Master confirmed: launching WiFi captive portal.");
          pendingScanId = "";
          postDisplayState(TIER_INTERACTION, 1000, "CONFIRMED", "Starting setup", "");
          renderDisplayIfDirty();
          for (int i = 0; i < 5; i++) {
            setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_YELLOW);
            vTaskDelay(120 / portTICK_PERIOD_MS);
            setSensorLED(FINGERPRINT_LED_OFF, 0, 0);
            vTaskDelay(120 / portTICK_PERIOD_MS);
          }
          startCaptivePortal();
          continue;
        } else {
          // A different fid -- cancel, and fall through so THIS fid still
          // gets processed normally below (cooldown gate + dispatch).
          Serial.println("Master confirm cancelled: different finger scanned.");
          masterConfirmArmed = false;
        }
      }

      if (role == "master") {
        // First press (or a fresh press right after the cancel above) --
        // arm instead of acting immediately.
        masterConfirmArmed = true;
        masterConfirmFid = fid;
        masterConfirmDeadlineMs = millis() + 8000;
        Serial.println("Master scanned: awaiting confirmation (scan again within 8s).");
        pendingScanId = "";
        postDisplayState(TIER_INTERACTION, 8000, "CONFIRM?", "Scan again", "");
        renderDisplayIfDirty();
        setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_YELLOW);
        vTaskDelay(200 / portTICK_PERIOD_MS);
        showReadyState();
        continue;
      }

      unsigned long nowMs = millis();
      if (fidEverScanned[fid] && (nowMs - lastScanMillis[fid] < SCAN_COOLDOWN_MS)) {
        unsigned long remaining = (SCAN_COOLDOWN_MS - (nowMs - lastScanMillis[fid])) / 1000;
        Serial.printf("Cooldown: fid=%d, %lus remaining. Ignoring scan.\n", fid, remaining);
        String cooldownName = resolveScanCardName(fidMapName[fid], fidMap[fid]);
        // Invalidate any earlier scan's verdict watch -- this card supersedes
        // it, and a late verdict for that older scan must not overwrite this
        // one (single pending slot: only the most recent interaction watches
        // for a verdict). Same reasoning at every postDisplayState() call
        // below that doesn't itself set pendingScanId.
        pendingScanId = "";
        postDisplayState(TIER_INTERACTION, 1500, "COOLDOWN", cooldownName, String(remaining) + "s left");
        // postDisplayState() only sets shared state -- the actual I2C draw
        // happens on the next renderDisplayIfDirty() call. Without this, that
        // wouldn't happen until the top of the *next* loop iteration, ~600ms+
        // after the LED (or lack of one, here) already reflects this outcome.
        // postDisplayState() itself stays draw-free (Core 0 also calls it, and
        // must never touch `display`); the render-now call belongs at each
        // Core-1 call site instead, right after posting.
        renderDisplayIfDirty();
        vTaskDelay(600 / portTICK_PERIOD_MS);
        showReadyState();
        vTaskDelay(10 / portTICK_PERIOD_MS);
        appendScanLog(getRTCTimestamp() + " | fid=" + String(fid) + " | COOLDOWN | id=" + fidMap[fid]);
        continue;
      }
      lastScanMillis[fid] = nowMs;
      fidEverScanned[fid] = true;

      // role is already known from above, and is guaranteed not "master"
      // here -- that case always continue()s (confirmed/armed/cancelled-
      // and-rearmed) before reaching this point.
      String mapped = fidMap[fid];

      if (mapped.length()) {
        // All non-master members (student, teacher, staff) use the same attendance payload.
        setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_GREEN);
        String scanId = makeScanId(mapped);
        String ts = getRTCTimestamp();
        String cardName = resolveScanCardName(fidMapName[fid], mapped);

        // Two-phase card (Q2): local "scanned" card now, patched with the real
        // verdict when flushQueue's response comes back (checkScanVerdict, top
        // of this loop) -- IF it lands within the 4s correlation window. Known
        // offline right now means no verdict is ever coming this cycle, so
        // don't bother watching for one; say so instead of promising a
        // confirmation that can't arrive.
        if (WiFi.status() == WL_CONNECTED) {
          pendingScanId = scanId;
          pendingScanName = cardName;
          pendingScanStartMs = millis();
          pendingScanDeadlineMs = pendingScanStartMs + 4000;
          postDisplayState(TIER_INTERACTION, 1500, "SCANNED", cardName, "");
        } else {
          pendingScanId = "";
          postDisplayState(TIER_INTERACTION, 1500, "SAVED", cardName, "Offline");
        }
        renderDisplayIfDirty();  // draw now, in sync with the LED -- see the cooldown branch above

        // T1e: include device_id so log-attendance can authenticate via per-device secret.
        // Serialised compactly (no spaces), which parsePayloadAgeSec relies on
        // when it scans queued lines for "timestamp":".
        JsonDocument doc;
        doc["device_id"]      = deviceId;
        doc["institution_id"] = institutionId;
        doc["sid"]            = mapped;
        doc["scan_id"]        = scanId;
        doc["timestamp"]      = ts;
        String payload;
        serializeJson(doc, payload);
        vTaskDelay(feedbackDuration / portTICK_PERIOD_MS);
        showReadyState();
        queueAndSignal(payload);
        appendScanLog(getRTCTimestamp() + " | fid=" + String(fid) + " | SENT | id=" + mapped +
                      " | name=" + fidMapName[fid]);
        vTaskDelay(200 / portTICK_PERIOD_MS);
      } else {
        Serial.printf("Matched fingerID %d but no mapping configured. Ignoring.\n", fid);
        setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
        pendingScanId = "";
        postDisplayState(TIER_INTERACTION, 1500, "NOT MAPPED", "See admin", "");
        renderDisplayIfDirty();  // draw now, in sync with the LED -- see the cooldown branch above
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
      pendingScanId = "";
      postDisplayState(TIER_INTERACTION, 1500, "NO MATCH", "", "");
      renderDisplayIfDirty();  // draw now, in sync with the LED -- see the cooldown branch above
      vTaskDelay(feedbackDuration / portTICK_PERIOD_MS);
      showReadyState();
      appendScanLog(getRTCTimestamp() + " | fid=" + String(fid) + " | NO_MATCH");
      vTaskDelay(100 / portTICK_PERIOD_MS);
    } else {
      setSensorLED(FINGERPRINT_LED_ON, 0, FINGERPRINT_LED_RED);
      pendingScanId = "";
      postDisplayState(TIER_INTERACTION, 1500, "SCAN ERROR", "", "");
      renderDisplayIfDirty();  // draw now, in sync with the LED -- see the cooldown branch above
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

  // Phase 3: moved to the very top, before anything else. The screen is most
  // valuable during the up-to-15s WiFi connect below (and the captive portal,
  // which can block far longer) -- windows where the sensor LED isn't yet
  // under our control and the device would otherwise look dead. RTC (also on
  // this bus) still initializes later, unchanged; Wire.begin() just needs to
  // run once before any I2C peripheral use. No hard dependency on the panel:
  // if init fails, displayAvailable stays false and every display.* call
  // downstream is a no-op guarded on it.
  Wire.begin(21, 22);
  // periphBegin=false: Wire is already begun above with our pins (21/22).
  // The default (true) would have begin() call Wire.begin() again internally
  // with the board's default pins -- harmless here since those also happen
  // to be 21/22 on plain ESP32, but not something to rely on.
  displayAvailable = display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR, true, false);
  if (!displayAvailable) {
    Serial.println("SSD1306 not found -- continuing without display.");
  }

  // T2/T12: memQueueMutex removed; spiffsMutex guards the SPIFFS-only queue.
  memQueueSem  = xSemaphoreCreateBinary();
  spiffsMutex  = xSemaphoreCreateMutex();
  enrollMutex  = xSemaphoreCreateMutex();
  enrollSem    = xSemaphoreCreateBinary();
  displayMutex = xSemaphoreCreateMutex();
  if (!memQueueSem || !spiffsMutex || !enrollMutex || !enrollSem || !displayMutex) {
    Serial.println("Failed to create RTOS primitives");
    // Draw directly, bypassing the mutex/mailbox entirely -- displayMutex
    // itself may be one of the things that just failed to create, and no
    // task exists yet that could safely pick up a mailbox post anyway.
    // Single-threaded here (setup(), before any task runs), so a direct
    // draw is safe -- unlike every other display write in this codebase.
    if (displayAvailable) {
      display.clearDisplay();
      display.setTextColor(SSD1306_WHITE);
      display.setTextSize(2);
      display.setCursor(0, 0);
      display.print("INIT FAIL");
      display.setTextSize(1);
      display.setCursor(0, 24);
      display.print("RTOS error");
      display.display();
    }
    while (1) delay(1000);
  }

  if (!initFS()) Serial.println("SPIFFS failed");
  recoverInflightQueue();  // T2/T12: merge any crash-orphaned inflight file
  seedQueueDepthFromDisk();  // must run after recovery merges any orphaned file in

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

  // Before task creation: once FingerprintTask starts, a scan can land
  // immediately, and a card rendered before the policy loads could show a
  // full name under a stricter (e.g. "none") configured policy.
  loadDeviceConfig();

  // display_name is already resolved above if this device was previously
  // provisioned; a fresh device just shows the version until assigned.
  showBootSplash();
  displayLastActivityMs = millis();

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

  // Phase 6: the STA MAC is a fixed hardware value, readable as soon as the
  // interface is up -- populate once here (single-threaded, before tasks
  // exist) rather than each place that used to compute it locally (see
  // registerDevice()). It's the key the dashboard uses to identify an
  // unassigned device, shown on the awaiting-assignment/rejected screens.
  {
    uint8_t mac[6];
    esp_wifi_get_mac(WIFI_IF_STA, mac);
    char macStr[18];
    sprintf(macStr, "%02X:%02X:%02X:%02X:%02X:%02X",
            mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    deviceMac = macStr;
  }

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

  initRTC();  // Wire already initialized at the top of setup()
  configTime(0, 0, "pool.ntp.org");
  if (WiFi.status() == WL_CONNECTED) syncRTCFromNTP();

  setupFingerprint();

  // Stack bumped 8192 -> 10240 (Phase 3): FingerprintTask now also owns display
  // rendering (Adafruit_GFX text calls, tier resolution) on top of its existing work.
  BaseType_t ok1 = xTaskCreatePinnedToCore(FingerprintTask, "FingerprintTask", 10240, NULL, 1, &hFingerprint, 1);
  BaseType_t ok2 = xTaskCreatePinnedToCore(NetworkTask,     "NetworkTask",     16384, NULL, 1, &hNetwork,     0);
  BaseType_t ok3 = xTaskCreatePinnedToCore(EnrollmentTask,  "EnrollmentTask",  12288, NULL, 1, &hEnrollment,  0);
  if (ok1 != pdPASS || ok2 != pdPASS || ok3 != pdPASS) {
    Serial.println("Failed to create tasks");
    // displayMutex is guaranteed to exist here (we passed the RTOS-primitives
    // check above), so the normal mailbox is safe to use -- unlike that
    // earlier fatal path. If FingerprintTask (ok1) succeeded before a later
    // task failed, it's already running and will pick this up on its own; if
    // it didn't, this silently goes unrendered (no crash either way) --
    // Serial still reports the failure for field debugging via USB.
    postDisplayState(TIER_TAKEOVER, 0, "INIT FAIL", "Task error", "");
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
