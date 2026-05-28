#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <Preferences.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>

#if __has_include("shelfio_ble_beacon.h")
#include "shelfio_ble_beacon.h"
#else
#define SHELFIO_BLE_BEACON_COMPILED 0
void initShelfioBleBeacon() {
  Serial.println("Shelfio BLE Beacon disabled (shelfio_ble_beacon.h not found)");
}
void maintainShelfioBleBeacon() {}
#endif

// =========================
// Etiket Verisi (struct en başta olmalı)
// =========================
struct LabelData {
  String productId;
  String product;
  String fdt;
  String origin;
  String barcode;
  String major;
  String minor;
  String oldMajor;
  String oldMinor;
  String lastPriceUpdate;
  String templateType;
  String assignmentHash;
  String labelVersion;
  bool clearMode;
};

static void drawStandardLayout(const LabelData& data);
static void drawCampaignLayout(const LabelData& data);
static void drawDiscountLayout(const LabelData& data);
static void drawLayout(const LabelData& data);

// Türkçe karakterleri ASCII'ye çevir
String normalizeTrToAscii(const String& text) {
  String out = text;
  out.replace("ü", "u"); out.replace("Ü", "U");
  out.replace("ş", "s"); out.replace("Ş", "S");
  out.replace("ğ", "g"); out.replace("Ğ", "G");
  out.replace("ı", "i"); out.replace("İ", "I");
  out.replace("ö", "o"); out.replace("Ö", "O");
  out.replace("ç", "c"); out.replace("Ç", "C");
  return out;
}

String formatFdtLabel(String value) {
  value.trim();
  if (value.length() == 0) return "";

  String upper = value;
  upper.toUpperCase();

  if (upper.startsWith("F.D.T.:")) {
    String datePart = value.substring(7);
    datePart.trim();
    return "FDT:" + datePart;
  }
  if (upper.startsWith("F.D.T:")) {
    String datePart = value.substring(6);
    datePart.trim();
    return "FDT:" + datePart;
  }
  if (upper.startsWith("FDT:")) {
    String datePart = value.substring(4);
    datePart.trim();
    return "FDT:" + datePart;
  }

  return "FDT:" + value;
}

static bool isZeroPriceString(String value)
{
  value.trim();
  value.replace(",", ".");
  return value.length() == 0 || value.toFloat() == 0.0f;
}

// =========================
// WiFi Ayarlari
// =========================
String wifiSsid = "";
String wifiPass = "";
String backendIp = "";
String eslDeviceToken = "";
int backendPort = 4000;
String deviceId = "esl-dev-3";

const char* LEGACY_DEFAULT_WIFI_SSID = "FiberHGW_ZTD7GC";
const char* LEGACY_DEFAULT_WIFI_PASS = "K4ssxz4hEzFE";
const char* LEGACY_DEFAULT_BACKEND_IP = "192.168.1.101";

String labelUrl;
String batteryUrl;
String scheduleUrl;
String renderConfirmUrl;

// =========================
// Shelfio BLE Beacon Ayarlari
// =========================
const bool ENABLE_SHELFIO_BLE_BEACON = true;
const char* SHELFIO_BEACON_UUID = "fda50693-a4e2-4fb1-afcf-c6eb07647825";
const char* SHELFIO_DEVICE_ID = "esp_sut_01";
const char* SHELFIO_STORE_CODE = "store_001";
const char* SHELFIO_ZONE_CODE = "zone_sut_reyonu";
const uint16_t SHELFIO_MAJOR = 1;
const uint16_t SHELFIO_MINOR = 101;
const char* SHELFIO_BLE_DEVICE_NAME = "Shelfio-ESP-SUT-01";
const uint32_t SHELFIO_BLE_ADVERTISING_INTERVAL_MS = 1000;

// =========================
// Batarya Pini
// =========================
#define BATTERY_PIN 35

// =========================
// E-Paper Pinleri
// =========================
#define EPD_BUSY  4
#define EPD_RST   16
#define EPD_DC    17
#define EPD_CS    5
#define EPD_SCK   18
#define EPD_MOSI  23

GxEPD2_BW<GxEPD2_290_T94, GxEPD2_290_T94::HEIGHT> display(
  GxEPD2_290_T94(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
);



LabelData currentLabel;
bool labelReady = false;
String lastRenderedAssignmentHash = "";

// Guncelleme araligi (ms) - 60 saniye
const unsigned long POLL_INTERVAL = 60000;
unsigned long lastPoll = 0;

// Batarya gonderim araligi (ms) - 5 dakika
const unsigned long BATTERY_INTERVAL = 300000;
unsigned long lastBattery = 0;
const unsigned long SCHEDULE_CHECK_INTERVAL = 60000;
unsigned long lastScheduleCheck = 0;
bool isStoreOpen = true;
bool batteryConnected = true;
String powerSource = "battery";

// =========================
// Seri giris yardimcilari
// =========================
const uint32_t SERIAL_BAUD = 115200;
const unsigned long SERIAL_BOOT_SETTLE_MS = 1600;
const unsigned long SERIAL_INPUT_QUIET_MS = 500;

static void drainSerialInput(unsigned long quietMs = 150)
{
  unsigned long lastByteAt = millis();

  while (millis() - lastByteAt < quietMs) {
    while (Serial.available() > 0) {
      Serial.read();
      lastByteAt = millis();
    }
    delay(5);
  }
}

static void printCleanBootBanner()
{
  // ESP32 ROM boot mesajlari sketch baslamadan once yazilir; tamamen kapatilamaz.
  // Bu temiz baslik, Serial Monitor 115200 baud iken kullanicinin firmware cikisini net ayirir.
  Serial.flush();
  Serial.println();
  Serial.println();
  Serial.println("=========================================");
  Serial.println("          CIHAZ BASLATILIYOR             ");
  Serial.println("=========================================");
  Serial.println("Serial Monitor baud: 115200");
  Serial.println("Bu basliktan once gorulen bozuk karakterler ESP boot ROM ciktisidir.");
  Serial.println();
  Serial.flush();
}

static String readLineFromSerial(unsigned long timeoutMs = 60000)
{
  String input = "";
  unsigned long start = millis();

  while (millis() - start < timeoutMs) {
    while (Serial.available() > 0) {
      char c = (char)Serial.read();
      if (c == '\r') continue;
      if (c == '\n') {
        input.trim();
        Serial.println(); // Print newline so next prompt doesn't stick to the same line
        return input;
      }
      
      // Filter out garbage characters (like bootloader leftover bytes)
      if (c >= 32 && c <= 126) {
        input += c;
        Serial.print(c); // Echo back to serial monitor so user sees what they typed
      }
    }
    delay(10);
  }

  input.trim();
  Serial.println(); // Print newline on timeout as well
  return input;
}

static void buildApiUrls()
{
  labelUrl = "http://" + backendIp + ":" + String(backendPort) + "/api/esl/devices/" + deviceId + "/current-label";
  batteryUrl = "http://" + backendIp + ":" + String(backendPort) + "/api/esl/devices/" + deviceId + "/battery";
  scheduleUrl = "http://" + backendIp + ":" + String(backendPort) + "/api/esl/devices/" + deviceId + "/schedule-status";
  renderConfirmUrl = "http://" + backendIp + ":" + String(backendPort) + "/api/esl/devices/" + deviceId + "/render-confirm";
}

static String promptSavedConfigValue(const String& label, const String& savedValue)
{
  String selected = savedValue;

  while (selected.length() == 0) {
    Serial.print(label);
    Serial.println(" girin (kayit yok - zorunlu)");
    Serial.print("> ");
    selected = readLineFromSerial();
    if (selected.length() == 0) {
      Serial.println("Bu alan bos birakilamaz.");
    }
  }

  if (savedValue.length() > 0) {
    Serial.print(label);
    Serial.print(" girin (son kayitli: ");
    Serial.print(savedValue);
    Serial.println(")");
    Serial.print("> ");
    String input = readLineFromSerial();
    if (input.length() > 0) {
      selected = input;
    }
  }

  return selected;
}

static String promptOptionalConfigValue(const String& label, const String& savedValue)
{
  String selected = savedValue;
  Serial.print(label);
  if (savedValue.length() > 0) {
    Serial.print(" girin (son kayitli deger kullanmak icin bos birak)");
  } else {
    Serial.print(" girin (opsiyonel)");
  }
  Serial.println();
  Serial.print("> ");
  String input = readLineFromSerial();
  if (input.length() > 0) {
    selected = input;
  }
  return selected;
}

static void askNetworkConfigFromSerial()
{
  Preferences preferences;
  preferences.begin("esl-config", false);
  
  // Yukle (varsa)
  String savedBackendIp = preferences.getString("ip", "");
  String savedWifiSsid = preferences.getString("ssid", "");
  String savedWifiPass = preferences.getString("pass", "");
  String savedDeviceToken = preferences.getString("token", "");
  bool configInitialized = preferences.getBool("initialized", false);

  // Eski firmware'deki hardcoded varsayilanlar ilk geciste "son kayitli" sayilmasin.
  if (!configInitialized) {
    if (savedBackendIp == String(LEGACY_DEFAULT_BACKEND_IP)) savedBackendIp = "";
    if (savedWifiSsid == String(LEGACY_DEFAULT_WIFI_SSID)) savedWifiSsid = "";
    if (savedWifiPass == String(LEGACY_DEFAULT_WIFI_PASS)) savedWifiPass = "";
  }

  Serial.println();
  Serial.println("=== Ag Ayari ===");
  Serial.println("Backend IP, WiFi SSID, WiFi sifre ve ESL device token sorulur.");
  Serial.println("Bos birakirsan son kaydedilen deger kullanilir.");
  Serial.println("Kayit yoksa deger girmen zorunludur; eski varsayilanlar kullanilmaz.");
  Serial.println("Token yoksa render-confirm calismaz ve panel cihaz guncellemesini bekler.");
  Serial.println();

  backendIp = promptSavedConfigValue("Backend IP", savedBackendIp);
  wifiSsid = promptSavedConfigValue("WiFi SSID", savedWifiSsid);
  wifiPass = promptSavedConfigValue("WiFi sifre", savedWifiPass);
  eslDeviceToken = promptSavedConfigValue("ESL device token", savedDeviceToken);

  preferences.putString("ip", backendIp);
  preferences.putString("ssid", wifiSsid);
  preferences.putString("pass", wifiPass);
  preferences.putString("token", eslDeviceToken);
  preferences.putBool("initialized", true);

  preferences.end();
  buildApiUrls();

  Serial.println("Secilen ayarlar:");
  Serial.print("- Backend IP: "); Serial.println(backendIp);
  Serial.print("- Backend Port: "); Serial.println(backendPort);
  Serial.print("- WiFi SSID: "); Serial.println(wifiSsid);
  Serial.print("- Device ID: "); Serial.println(deviceId);
  Serial.print("- Token: "); Serial.println(eslDeviceToken.length() > 0 ? "ayarlı" : "yok");
  Serial.print("- Label URL: "); Serial.println(labelUrl);
  Serial.print("- Battery URL: "); Serial.println(batteryUrl);
  Serial.print("- Schedule URL: "); Serial.println(scheduleUrl);
  Serial.print("- Render Confirm URL: "); Serial.println(renderConfirmUrl);
}

static bool checkBackendHealth()
{
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String healthUrl = "http://" + backendIp + ":" + String(backendPort) + "/api/health";
  http.begin(healthUrl);
  http.setTimeout(5000);
  int code = http.GET();

  if (code != 200) {
    Serial.print("Backend health hatasi: ");
    if (code <= 0) {
      Serial.println(http.errorToString(code));
    } else {
      Serial.println(code);
    }
    http.end();
    return false;
  }

  Serial.println("Backend health OK.");
  http.end();
  return true;
}

// =========================
// Yardimci Fonksiyonlar
// =========================
static void measure(const String& s, const GFXfont* f,
                    int16_t& ox, int16_t& oy, uint16_t& w, uint16_t& h)
{
  display.setFont(f);
  display.getTextBounds(s, 0, 50, &ox, &oy, &w, &h);
}

static void drawDiscountIcon(int16_t x, int16_t y)
{
  // Daha temiz "düşen trend" oku
  const int16_t p0x = x + 1,  p0y = y + 4;
  const int16_t p1x = x + 6,  p1y = y + 8;
  const int16_t p2x = x + 10, p2y = y + 6;
  const int16_t p3x = x + 16, p3y = y + 12;
  const int16_t tipX = x + 21, tipY = y + 12;

  // Gövdeyi 2px kalınlıkta çiz
  for (int16_t dy = 0; dy <= 1; dy++) {
    display.drawLine(p0x, p0y + dy, p1x, p1y + dy, GxEPD_WHITE);
    display.drawLine(p1x, p1y + dy, p2x, p2y + dy, GxEPD_WHITE);
    display.drawLine(p2x, p2y + dy, p3x, p3y + dy, GxEPD_WHITE);
    display.drawLine(p3x, p3y + dy, tipX, tipY + dy, GxEPD_WHITE);
  }

  // Ok başı (daha kompakt)
  display.drawLine(tipX, tipY, tipX - 4, tipY - 4, GxEPD_WHITE);
  display.drawLine(tipX, tipY, tipX - 4, tipY + 4, GxEPD_WHITE);
  display.drawLine(tipX - 1, tipY, tipX - 5, tipY - 4, GxEPD_WHITE);
  display.drawLine(tipX - 1, tipY, tipX - 5, tipY + 4, GxEPD_WHITE);
}

static void drawFlashIcon(int16_t x, int16_t y)
{
  // A simple star/sparkle icon for FIRSAT
  const int16_t cx = x + 8, cy = y + 8;
  display.drawLine(cx, cy - 6, cx, cy + 6, GxEPD_WHITE);
  display.drawLine(cx - 1, cy - 6, cx - 1, cy + 6, GxEPD_WHITE); // kalin
  
  display.drawLine(cx - 6, cy, cx + 6, cy, GxEPD_WHITE);
  display.drawLine(cx - 6, cy - 1, cx + 6, cy - 1, GxEPD_WHITE);

  display.drawLine(cx - 4, cy - 4, cx + 4, cy + 4, GxEPD_WHITE);
  display.drawLine(cx - 4, cy - 5, cx + 4, cy + 3, GxEPD_WHITE);
  
  display.drawLine(cx - 4, cy + 4, cx + 4, cy - 4, GxEPD_WHITE);
  display.drawLine(cx - 5, cy + 4, cx + 3, cy - 4, GxEPD_WHITE);
}

static void wrapText(const String& s, const GFXfont* f, int16_t maxW,
                     String lines[], int& lc, int maxL)
{
  lc = 0;
  String cur = "";
  int i = 0;

  while (i < (int)s.length() && lc < maxL) {
    while (i < (int)s.length() && s[i] == ' ') i++;
    if (i >= (int)s.length()) break;

    int ws = i;
    while (i < (int)s.length() && s[i] != ' ') i++;
    String word = s.substring(ws, i);

    String cand = cur.length() ? cur + " " + word : word;

    int16_t ox, oy;
    uint16_t tw, th;
    measure(cand, f, ox, oy, tw, th);

    if ((int16_t)tw <= maxW) {
      cur = cand;
    } else {
      if (cur.length()) {
        lines[lc++] = cur;
        cur = word;
      } else {
        lines[lc++] = word;
        cur = "";
      }
    }
  }

  if (cur.length() && lc < maxL) lines[lc++] = cur;
}

static void drawBarcode(int16_t x, int16_t y, int16_t w, int16_t barH,
                        const String& code)
{
  const char* lCode[10] = {
    "0001101","0011001","0010011","0111101","0100011",
    "0110001","0101111","0111011","0110111","0001011"
  };
  const char* rCode[10] = {
    "1110010","1100110","1101100","1000010","1011100",
    "1001110","1010000","1000100","1001000","1110100"
  };
  const char* gCode[10] = {
    "0100111","0110011","0011011","0100001","0011101",
    "0111001","0000101","0010001","0001001","0010111"
  };
  const char* parity[10] = {
    "LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG",
    "LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"
  };

  char digits[14] = "8699999999999";
  int digitCount = 0;
  for (int i = 0; i < 13 && i < (int)code.length(); i++) {
    if (code[i] >= '0' && code[i] <= '9') {
      digits[digitCount++] = code[i];
    }
  }
  for (int i = digitCount; i < 13; i++) {
    digits[i] = '0';
  }
  digits[13] = '\0';

  String mods = "";
  int firstDigit = digits[0] - '0';
  if (firstDigit < 0 || firstDigit > 9) firstDigit = 0;

  mods += "101";
  for (int i = 1; i <= 6; i++) {
    int d = digits[i] - '0';
    if (d < 0 || d > 9) d = 0;
    mods += parity[firstDigit][i - 1] == 'G' ? gCode[d] : lCode[d];
  }
  mods += "01010";
  for (int i = 7; i <= 12; i++) {
    int d = digits[i] - '0';
    if (d < 0 || d > 9) d = 0;
    mods += rCode[d];
  }
  mods += "101";

  int total = mods.length();
  const int16_t quietModules = 10;
  int16_t moduleW = w / (total + quietModules * 2);
  if (moduleW < 1) moduleW = 1;
  int16_t barcodeW = (total + quietModules * 2) * moduleW;
  int16_t startX = x + max((int16_t)0, (int16_t)((w - barcodeW) / 2)) + quietModules * moduleW;

  for (int i = 0; i < total; i++) {
    if (mods[i] == '1') {
      int16_t bx = startX + i * moduleW;
      display.fillRect(bx, y, moduleW, barH, GxEPD_BLACK);
    }
  }

  display.setFont(nullptr);
  display.setTextSize(1);
  display.setTextColor(GxEPD_BLACK);

  // Barkod numarası kutudan taşmasın diye font genişliğini ve kutu genişliğini dikkate al
  String printableCode = String(digits);
  int16_t tw = printableCode.length() * 6;
  int16_t tx = x + (w - tw) / 2;
  int16_t numY = y + barH + 3 - 2; // 2px yukarı taşı
  // Eğer numara kutudan taşacaksa fontu küçült
  if (tw > w) {
    display.setTextSize(1);
    tw = printableCode.length() * 5;
    tx = x + (w - tw) / 2;
  }
  display.setCursor(tx, numY);
  display.print(printableCode);
}

static void drawPriceBox(int16_t x, int16_t y, int16_t w, int16_t h,
                         const String& major, const String& minor)
{
  display.fillRect(x, y, w, h, GxEPD_BLACK);
  display.setTextColor(GxEPD_WHITE);

  // "KDV Dahil" — kutunun ust kismi (bold efekti)
  {
    display.setFont(nullptr);
    display.setTextSize(1);
    String kdv = "KDV Dahil";
    int16_t kdvTW = kdv.length() * 6;
    int16_t kdvX = x + (w - kdvTW) / 2;
    display.setCursor(kdvX, y + 5);
    display.print(kdv);
    display.setCursor(kdvX + 1, y + 5);
    display.print(kdv);
  }

  // Fiyat alani (KDV Dahil altinda)
  int16_t priceTop = y + 18;
  int16_t priceAreaH = h - 18;

  int16_t mx, my;
  uint16_t mw, mh;
  measure(major, &FreeSansBold24pt7b, mx, my, mw, mh);

  String minS = "," + minor;
  int16_t sx, sy;
  uint16_t sw, sh;
  measure(minS, &FreeSansBold9pt7b, sx, sy, sw, sh);

  int16_t tx2, ty2;
  uint16_t tw2, th2;
  measure("TL", &FreeSansBold9pt7b, tx2, ty2, tw2, th2);

  // Sag taraftaki en genis eleman (kurus veya TL)
  int16_t sideW = (int16_t)sw > (int16_t)tw2 ? (int16_t)sw : (int16_t)tw2;
  int16_t totalW = (int16_t)mw + 2 + sideW;
  int16_t startX = x + (w - totalW) / 2;
  if (startX < x + 3) startX = x + 3;

  int16_t baseline = priceTop + (priceAreaH + (int16_t)mh) / 2;
  if (baseline > y + h - 5) baseline = y + h - 5;

  // Ana fiyat rakami
  display.setFont(&FreeSansBold24pt7b);
  display.setCursor(startX, baseline);
  display.print(major);

  // Sag taraf: TL ust, kurus alt
  int16_t rightX = startX + (int16_t)mw + 3;
  int16_t topOfDigit = baseline - (int16_t)mh;

  // "TL" — ust sag (rakamin ust hizasinda)
  display.setFont(&FreeSansBold9pt7b);
  display.setCursor(rightX, topOfDigit + (int16_t)th2 + 2);
  display.print("TL");

  // Kurus — TL'nin altinda
  display.setFont(&FreeSansBold9pt7b);
  display.setCursor(rightX, topOfDigit + (int16_t)th2 + (int16_t)sh + 5);
  display.print(minS);

  display.setTextColor(GxEPD_BLACK);
}

static void drawStandardLayout(const LabelData& data)
{
  display.setRotation(1);
  const int16_t W = display.width();
  const int16_t H = display.height();


  String product  = normalizeTrToAscii(data.product);
  String fdt      = data.fdt;
  String origin   = "Mensei: " + normalizeTrToAscii(data.origin);
  String barcodeN = data.barcode;
  String major    = data.major;
  String minor    = data.minor;

  display.fillScreen(GxEPD_WHITE);
  display.setTextColor(GxEPD_BLACK);

  // --- Kalin dis cerceve (2px, tam ekran sınırında) ---
  const int16_t fX = 0, fY = 0, fW = W, fH = H;
  display.drawRect(fX, fY, fW, fH, GxEPD_BLACK);
  display.drawRect(fX + 1, fY + 1, fW - 2, fH - 2, GxEPD_BLACK);

  const int16_t IP = 8;

  int16_t ox, oy;
  uint16_t uw, uh;
  measure("A", &FreeSansBold12pt7b, ox, oy, uw, uh);
  int16_t h12 = (int16_t)uh;

  // --- Urun adi (sol ust, maks 2 satir, tasmada font kucult) ---
  int16_t titleBottomY;
  {
    int16_t maxW = fW - IP * 2;
    String lines[2];
    int lc = 0;
    const GFXfont* titleFont = &FreeSansBold12pt7b;
    int16_t titleH = h12;

    // Once normal font dene
    wrapText(product, titleFont, maxW, lines, lc, 2);

    // Eger 2 satira sigmadiysa (wrap sonrasi metin kesildi), kucultulen fontu dene
    if (lc == 2) {
      // 2 satir doldu — kalan metin var mi kontrol et
      int16_t testOx, testOy;
      uint16_t testW, testH;
      measure(product, titleFont, testOx, testOy, testW, testH);
      // Eger toplam genislik 2 satir * maxW'dan fazlaysa kucult
      if ((int16_t)testW > maxW * 2) {
        titleFont = &FreeSansBold9pt7b;
        int16_t ox9, oy9;
        uint16_t uw9, uh9;
        measure("A", titleFont, ox9, oy9, uw9, uh9);
        titleH = (int16_t)uh9;
        lc = 0;
        wrapText(product, titleFont, maxW, lines, lc, 2);
      }
    }

    display.setFont(titleFont);
    for (int i = 0; i < lc; i++) {
      display.setCursor(fX + IP, fY + IP + titleH + i * (titleH + 3));
      display.print(lines[i]);
    }
    titleBottomY = fY + IP + titleH + (lc - 1) * (titleH + 3) + 4;
  }

  // --- Fiyat kutusu boyutlari (sag alt, genis) ---
  const int16_t priceH = 56;
  const int16_t priceW = 130;
  const int16_t priceX = fX + fW - priceW - 4;
  const int16_t priceY = fY + fH - priceH - 4;



  // --- Barkod (sol alt) ---
  int16_t barH = 34; // Telefon kamerasi icin daha uzun ve okunakli barkod
  int16_t bcX = fX + IP;
  int16_t bcMaxW = priceX - fX - IP - 12;
  int16_t bcW = bcMaxW;
  int16_t bcY = fY + fH - 4 - barH - 6 - 2; // 2px yukarı taşı

  // --- Menşei + FDT (barkodun tam üstünde, aralarında boşluklu) ---
  {
    // Alt bilgi bloğu için başlangıç Y noktası: barkodun üstünden yukarıya doğru
    int16_t blockBottomY = bcY - 6; // Barkod ile F.D.T arasında 6px boşluk
    int16_t fdtH = 10; // F.D.T satırı yüksekliği (font 1 için yaklaşık)
    int16_t originH = 10; // Menşei satırı yüksekliği (font 1 için yaklaşık)
    int16_t gap = 4; // Menşei ile F.D.T arası boşluk

    int16_t fdtY = blockBottomY - fdtH; // F.D.T satırı
    int16_t originY = fdtY - gap - originH; // Menşei satırı

    display.setFont(nullptr);
    display.setTextSize(1);
    display.setTextColor(GxEPD_BLACK);

    // Menşei
    display.setCursor(fX + IP, originY);
    display.print(origin);

    // F.D.T
    display.setCursor(fX + IP, fdtY);
    if (fdt.length() == 0) {
      display.print("FDT:../../....");
    } else {
      display.print(fdt);
    }
  }

  // --- Barkod çizimi ---
  drawBarcode(bcX, bcY, bcW, barH, barcodeN);

  // --- Fiyat kutusu (KDV Dahil icerde) ---
  drawPriceBox(priceX, priceY, priceW, priceH, major, minor);
}

static void drawCampaignLayout(const LabelData& data)
{
  display.setRotation(1);
  const int16_t W = display.width();
  const int16_t H = display.height();

  String product = normalizeTrToAscii(data.product.length() ? data.product : "Urun Secilmedi");
  String major = data.major;
  String minor = data.minor;

  if (major.length() == 0) major = "0";
  if (minor.length() == 0) minor = "00";
  if (minor.length() == 1) minor = "0" + minor;
  if (minor.length() > 2) minor = minor.substring(0, 2);

  display.fillScreen(GxEPD_WHITE);
  display.setTextColor(GxEPD_BLACK);

  // Dis cerceve
  display.drawRect(0, 0, W, H, GxEPD_BLACK);
  display.drawRect(1, 1, W - 2, H - 2, GxEPD_BLACK);

  // Ust siyah firsat bandi
  const int16_t headerH = 30;
  display.fillRect(3, 3, W - 6, headerH, GxEPD_BLACK);
  display.setTextColor(GxEPD_WHITE);
  display.setFont(&FreeSansBold12pt7b);
  {
    const String header = "FIRSAT";
    int16_t ox, oy;
    uint16_t tw, th;
    measure(header, &FreeSansBold12pt7b, ox, oy, tw, th);
    int16_t tx = (W - (int16_t)tw) / 2;
    int16_t ty = 3 + (headerH + (int16_t)th) / 2;
    int16_t iconY = 3 + (headerH - 16) / 2;
    drawFlashIcon(tx - 28, iconY);
    display.setCursor(tx, ty);
    display.print(header);
    drawFlashIcon(tx + (int16_t)tw + 8, iconY);
  }

  // Urun basligi alani (2 satirlik sabit alan)
  display.setTextColor(GxEPD_BLACK);
  {
    const int16_t textX = 10;
    const int16_t textY = 3 + headerH + 16;
    const int16_t maxW = W - 20;
    const int16_t lineH = 14;
    String lines[2];
    int lc = 0;
    wrapText(product, &FreeSansBold9pt7b, maxW, lines, lc, 2);
    display.setFont(&FreeSansBold9pt7b);
    for (int i = 0; i < 2; i++) {
      if (i >= lc) continue;
      display.setCursor(textX, textY + i * lineH);
      display.print(lines[i]);
    }
  }

  // Alt fiyat kutusu
  const int16_t boxX = 2;
  const int16_t boxW = W - 4;
  const int16_t boxH = 58;
  const int16_t boxY = H - boxH - 2;
  display.fillRect(boxX, boxY, boxW, boxH, GxEPD_BLACK);

  // Fiyat: ana kisim + kurus + TL
  display.setTextColor(GxEPD_WHITE);

  int16_t mx, my;
  uint16_t mw, mh;
  measure(major, &FreeSansBold24pt7b, mx, my, mw, mh);

  String minorText = "," + minor;
  int16_t sx, sy;
  uint16_t sw, sh;
  measure(minorText, &FreeSansBold18pt7b, sx, sy, sw, sh);

  int16_t tx2, ty2;
  uint16_t tw2, th2;
  measure("TL", &FreeSansBold12pt7b, tx2, ty2, tw2, th2);

  int16_t totalW = (int16_t)mw + 4 + (int16_t)sw + 4 + (int16_t)tw2;
  int16_t startX = boxX + (boxW - totalW) / 2;

  int16_t baseY = boxY + (boxH + (int16_t)mh) / 2 - 1;
  display.setFont(&FreeSansBold24pt7b);
  display.setCursor(startX, baseY);
  display.print(major);

  int16_t rightX = startX + (int16_t)mw + 4;
  int16_t sideBaseY = baseY;

  display.setFont(&FreeSansBold18pt7b);
  display.setCursor(rightX, sideBaseY);
  display.print(minorText);

  display.setFont(&FreeSansBold12pt7b);
  display.setCursor(rightX + (int16_t)sw + 4, sideBaseY);
  display.print("TL");

  // KDV Dahil metni (sol alt, daha kucuk)
  display.setFont(nullptr);
  display.setTextSize(1);
  display.setCursor(boxX + 5, boxY + boxH - 10);
  display.print("KDV Dahil");

  if (data.fdt.length() > 0) {
    String fdtText = formatFdtLabel(data.fdt);
    int16_t fx, fy;
    uint16_t fw, fh;
    measure(fdtText, nullptr, fx, fy, fw, fh);
    display.setCursor(boxX + boxW - (int16_t)fw - 5, boxY + 2);
    display.print(fdtText);
  }
}

static void drawSmallPrice(const String& major, const String& minor, int16_t x, int16_t baseline)
{
  String m = major.length() ? major : "0";
  String s = minor.length() ? minor : "00";
  if (s.length() == 1) s = "0" + s;
  if (s.length() > 2) s = s.substring(0, 2);

  display.setFont(&FreeSansBold12pt7b);
  display.setCursor(x, baseline);
  display.print(m);

  int16_t ox, oy;
  uint16_t mw, mh;
  measure(m, &FreeSansBold12pt7b, ox, oy, mw, mh);

  display.setFont(&FreeSansBold9pt7b);
  display.setCursor(x + (int16_t)mw + 2, baseline);
  display.print("," + s);

  int16_t sx, sy;
  uint16_t sw, sh;
  measure("," + s, &FreeSansBold9pt7b, sx, sy, sw, sh);

  display.setFont(nullptr);
  display.setTextSize(1);
  display.setCursor(x + (int16_t)mw + (int16_t)sw + 6, baseline - 2);
  display.print("TL");
}

static int16_t measureSmallPriceWidth(const String& major, const String& minor)
{
  String m = major.length() ? major : "0";
  String s = minor.length() ? minor : "00";
  if (s.length() == 1) s = "0" + s;
  if (s.length() > 2) s = s.substring(0, 2);

  int16_t ox, oy;
  uint16_t mw, mh;
  measure(m, &FreeSansBold12pt7b, ox, oy, mw, mh);

  int16_t sx, sy;
  uint16_t sw, sh;
  measure("," + s, &FreeSansBold9pt7b, sx, sy, sw, sh);

  return (int16_t)mw + (int16_t)sw + 18;
}

static void drawSmallPriceCentered(const String& major, const String& minor, int16_t x, int16_t w, int16_t baseline)
{
  int16_t priceW = measureSmallPriceWidth(major, minor);
  int16_t startX = x + max((int16_t)0, (int16_t)((w - priceW) / 2));
  drawSmallPrice(major, minor, startX, baseline);
}

static void drawDiscountLayout(const LabelData& data)
{
  display.setRotation(1);
  const int16_t W = display.width();
  const int16_t H = display.height();

  String product = normalizeTrToAscii(data.product.length() ? data.product : "Urun Secilmedi");
  String major = data.major.length() ? data.major : "0";
  String minor = data.minor.length() ? data.minor : "00";
  String oldMajor = data.oldMajor.length() ? data.oldMajor : major;
  String oldMinor = data.oldMinor.length() ? data.oldMinor : minor;

  if (minor.length() == 1) minor = "0" + minor;
  if (minor.length() > 2) minor = minor.substring(0, 2);
  if (oldMinor.length() == 1) oldMinor = "0" + oldMinor;
  if (oldMinor.length() > 2) oldMinor = oldMinor.substring(0, 2);

  display.fillScreen(GxEPD_WHITE);
  display.setTextColor(GxEPD_BLACK);
  display.drawRect(0, 0, W, H, GxEPD_BLACK);
  display.drawRect(1, 1, W - 2, H - 2, GxEPD_BLACK);

  const int16_t headerH = 30;
  display.fillRect(3, 3, W - 6, headerH, GxEPD_BLACK);
  display.setTextColor(GxEPD_WHITE);
  display.setFont(&FreeSansBold12pt7b);
  {
    const String header = "indirim";
    int16_t ox, oy;
    uint16_t tw, th;
    measure(header, &FreeSansBold12pt7b, ox, oy, tw, th);
    int16_t tx = (W - (int16_t)tw) / 2;
    int16_t ty = 3 + (headerH + (int16_t)th) / 2;
    int16_t iconY = 3 + (headerH - 16) / 2;
    drawDiscountIcon(tx - 28, iconY);
    display.setCursor(tx, ty);
    display.print(header);
    drawDiscountIcon(tx + (int16_t)tw + 8, iconY);
  }

  display.setTextColor(GxEPD_BLACK);
  {
    const int16_t textX = 10;
    const int16_t textY = 3 + headerH + 17;
    String lines[2];
    int lc = 0;
    wrapText(product, &FreeSansBold9pt7b, W - 20, lines, lc, 2);
    display.setFont(&FreeSansBold9pt7b);
    for (int i = 0; i < 2; i++) {
      if (i >= lc) continue;
      display.setCursor(textX, textY + i * 14);
      display.print(lines[i]);
    }
  }

  const int16_t boxX = 2;
  const int16_t boxW = W - 4;
  const int16_t boxH = 60;
  const int16_t boxY = H - boxH - 2;
  display.fillRect(boxX, boxY, boxW, boxH, GxEPD_BLACK);
  display.setTextColor(GxEPD_WHITE);

  display.setFont(nullptr);
  display.setTextSize(1);
  drawSmallPriceCentered(oldMajor, oldMinor, boxX + 8, 82, boxY + 37);
  display.drawLine(boxX + 8, boxY + 32, boxX + 86, boxY + 24, GxEPD_WHITE);
  display.drawLine(boxX + 8, boxY + 33, boxX + 86, boxY + 25, GxEPD_WHITE);

  const int16_t newPriceX = boxX + 110;
  const int16_t newPriceW = boxW - 116;
  int16_t mx, my;
  uint16_t mw, mh;
  measure(major, &FreeSansBold24pt7b, mx, my, mw, mh);

  String minorText = "," + minor;
  int16_t sx, sy;
  uint16_t sw, sh;
  measure(minorText, &FreeSansBold12pt7b, sx, sy, sw, sh);

  int16_t tx2, ty2;
  uint16_t tw2, th2;
  measure("TL", &FreeSansBold9pt7b, tx2, ty2, tw2, th2);

  int16_t totalW = (int16_t)mw + 4 + (int16_t)sw + 4 + (int16_t)tw2;
  int16_t startX = newPriceX + max((int16_t)0, (int16_t)((newPriceW - totalW) / 2));
  int16_t baseY = boxY + 47;

  display.setFont(&FreeSansBold24pt7b);
  display.setCursor(startX, baseY);
  display.print(major);

  int16_t rightX = startX + (int16_t)mw + 4;
  display.setFont(&FreeSansBold12pt7b);
  display.setCursor(rightX, baseY);
  display.print(minorText);

  display.setFont(&FreeSansBold9pt7b);
  display.setCursor(rightX + (int16_t)sw + 4, baseY);
  display.print("TL");

  display.setFont(nullptr);
  display.setTextSize(1);
  display.setCursor(boxX + 8, boxY + boxH - 7);
  display.print("KDV Dahil");

  if (data.fdt.length() > 0) {
    String fdtText = formatFdtLabel(data.fdt);
    int16_t fx, fy;
    uint16_t fw, fh;
    measure(fdtText, nullptr, fx, fy, fw, fh);
    display.setCursor(boxX + boxW - (int16_t)fw - 5, boxY + 2);
    display.print(fdtText);
  }
}

static void drawClearedLayout()
{
  display.setRotation(1);
  display.fillScreen(GxEPD_WHITE);
}

static void drawLayout(const LabelData& data)
{
  if (data.clearMode) {
    drawClearedLayout();
    return;
  }

  if (data.templateType == "campaign") {
    drawCampaignLayout(data);
    return;
  }

  if (data.templateType == "discount") {
    drawDiscountLayout(data);
    return;
  }

  drawStandardLayout(data);
}

// =========================
// WiFi Baglantisi
// =========================
void connectWiFi()
{
  Serial.println("WiFi'ye baglaniliyor...");
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi baglandi");
  Serial.print("IP adresi: ");
  Serial.println(WiFi.localIP());
}

// =========================
// HTTP GET — basari durumunda true doner
// =========================
bool fetchLabel()
{
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi bagli degil, yeniden baglaniliyor...");
    connectWiFi();
  }

  HTTPClient http;
  http.begin(labelUrl);
  http.setTimeout(10000);

  int httpCode = http.GET();

  Serial.print("HTTP Status Code: ");
  Serial.println(httpCode);

  if (httpCode != 200) {
    Serial.print("HTTP hatasi: ");
    if (httpCode <= 0) {
      Serial.println(http.errorToString(httpCode));
    } else {
      Serial.println(httpCode);
    }
    http.end();
    return false;
  }

  String response = http.getString();
  Serial.println("Sunucudan gelen cevap:");
  Serial.println(response);
  http.end();

  StaticJsonDocument<1536> doc;
  DeserializationError error = deserializeJson(doc, response);

  if (error) {
    Serial.print("JSON parse hatasi: ");
    Serial.println(error.c_str());
    return false;
  }

  currentLabel.productId = doc["assignedProductId"] | "";
  if (currentLabel.productId.length() == 0) currentLabel.productId = doc["productId"] | "";
  currentLabel.product = doc["productName"] | "Bilinmeyen Urun";
  currentLabel.barcode = doc["barcode"]     | "0000000000000";
  currentLabel.origin  = doc["origin"]      | "Turkiye";
  currentLabel.templateType = doc["template"]   | "standard";
  currentLabel.assignmentHash = doc["assignmentHash"] | "";
  currentLabel.labelVersion = doc["labelVersion"] | "";
  if (currentLabel.assignmentHash.length() == 0) currentLabel.assignmentHash = currentLabel.labelVersion;
  if (currentLabel.labelVersion.length() == 0) currentLabel.labelVersion = currentLabel.assignmentHash;


  // FDT: önce gerçek fiyat değişim tarihi alanları, sonra legacy expiryDate
  String fdtRaw = "";
  if (!doc["lastPriceChangeDate"].isNull()) {
    fdtRaw = String((const char*)doc["lastPriceChangeDate"]);
  } else if (!doc["lastPriceChangeAt"].isNull()) {
    fdtRaw = String((const char*)doc["lastPriceChangeAt"]);
  } else if (!doc["fdt"].isNull()) {
    fdtRaw = String((const char*)doc["fdt"]);
  } else if (!doc["expiryDate"].isNull()) {
    fdtRaw = String((const char*)doc["expiryDate"]);
  }

  if (fdtRaw == "Invalid Date") fdtRaw = "";
  if (fdtRaw.length() >= 10 && fdtRaw[4] == '-' && fdtRaw[7] == '-') {
    // YYYY-MM-DD veya YYYY-MM-DDTHH:mm:ss...
    currentLabel.fdt = formatFdtLabel(fdtRaw.substring(8, 10) + "." + fdtRaw.substring(5, 7) + "." + fdtRaw.substring(0, 4));
  } else if (fdtRaw.length() > 0) {
    currentLabel.fdt = formatFdtLabel(fdtRaw);
  } else {
    currentLabel.fdt = "";
  }

  // price "49.90" -> major="49", minor="90"
  String price = doc["price"] | "0.00";
  int dot = price.indexOf('.');
  if (dot >= 0) {
    currentLabel.major = price.substring(0, dot);
    currentLabel.minor = price.substring(dot + 1);
  } else {
    currentLabel.major = price;
    currentLabel.minor = "00";
  }

  bool backendClearMode = doc["clearLabel"] | false;
  if (!backendClearMode) backendClearMode = doc["cleared"] | false;
  if (!backendClearMode) backendClearMode = doc["isCleared"] | false;

  String normalizedProductName = normalizeTrToAscii(currentLabel.product);
  normalizedProductName.trim();
  normalizedProductName.toUpperCase();
  String normalizedBarcode = currentLabel.barcode;
  normalizedBarcode.trim();
  currentLabel.clearMode = backendClearMode ||
                           ((normalizedProductName == "URUN SECILMEDI" ||
                             normalizedProductName == "ETIKET TEMIZLENDI" ||
                             normalizedProductName == "BOS ETIKET") &&
                            normalizedBarcode == "0000000000000" &&
                            isZeroPriceString(price));

  // previousPrice "59.90" -> oldMajor="59", oldMinor="90"
  String previousPrice = doc["previousPrice"] | "";
  if (previousPrice.length() == 0) previousPrice = doc["oldPrice"] | "";
  if (previousPrice.length() == 0) {
    currentLabel.oldMajor = currentLabel.major;
    currentLabel.oldMinor = currentLabel.minor;
  } else {
    int oldDot = previousPrice.indexOf('.');
    if (oldDot >= 0) {
      currentLabel.oldMajor = previousPrice.substring(0, oldDot);
      currentLabel.oldMinor = previousPrice.substring(oldDot + 1);
    } else {
      currentLabel.oldMajor = previousPrice;
      currentLabel.oldMinor = "00";
    }
  }
  

  // lastPriceUpdate -> "Fiyat Güncellenme: GG.AA.YYYY"
  String lpu = doc["lastPriceUpdate"] | "";
  if (lpu == "Invalid Date") lpu = "";
  if (lpu.length() == 10) {
    currentLabel.lastPriceUpdate = "Fiyat Güncellenme: " + lpu.substring(8, 10) + "." + lpu.substring(5, 7) + "." + lpu.substring(0, 4);
  } else if (lpu.length() > 0) {
    currentLabel.lastPriceUpdate = "Fiyat Güncellenme: " + lpu;
  } else {
    currentLabel.lastPriceUpdate = "";
  }

  Serial.println("--- Parse Edilen Veriler ---");
  Serial.print("ProductId: ");           Serial.println(currentLabel.productId);
  Serial.print("AssignmentHash: ");      Serial.println(currentLabel.assignmentHash);
  Serial.print("LabelVersion: ");        Serial.println(currentLabel.labelVersion);
  Serial.print("Urun: ");               Serial.println(currentLabel.product);
  Serial.print("Barkod: ");              Serial.println(currentLabel.barcode);
  Serial.print("Fiyat: ");               Serial.println(price);
  Serial.print("Eski Fiyat: ");          Serial.println(previousPrice);
  Serial.print("Mensei: ");              Serial.println(currentLabel.origin);
  Serial.print("F.D.T. (raw): ");        Serial.println(fdtRaw);
  Serial.print("Temiz mod: ");           Serial.println(currentLabel.clearMode ? "EVET" : "HAYIR");
  Serial.println("----------------------------");

  return true;
}

bool fetchStoreScheduleStatus()
{
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi bagli degil, schedule kontrolu yapilamadi.");
    return true;
  }

  HTTPClient http;
  http.begin(scheduleUrl);
  http.setTimeout(10000);

  int httpCode = http.GET();
  if (httpCode != 200) {
    Serial.print("Schedule status hatasi: ");
    if (httpCode <= 0) {
      Serial.println(http.errorToString(httpCode));
    } else {
      Serial.println(httpCode);
    }
    http.end();
    return true;
  }

  String response = http.getString();
  http.end();

  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, response);
  if (error) {
    Serial.print("Schedule JSON parse hatasi: ");
    Serial.println(error.c_str());
    return true;
  }

  bool open = doc["isStoreOpen"] | true;
  String openingTime = doc["openingTime"] | "";
  String closingTime = doc["closingTime"] | "";

  Serial.print("Magaza durumu: ");
  Serial.println(open ? "ACIK" : "KAPALI");
  if (openingTime.length() > 0 && closingTime.length() > 0) {
    Serial.print("Calisma saati: ");
    Serial.print(openingTime);
    Serial.print(" - ");
    Serial.println(closingTime);
  }

  return open;
}

// =========================
// Ekrani guncelle
// =========================
bool sendRenderConfirm(const String& status, const String& errorMessage)
{
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Render confirm gonderilemedi: WiFi bagli degil.");
    return false;
  }
  if (eslDeviceToken.length() == 0) {
    Serial.println("Render confirm gonderilemedi: ESL device token yok.");
    return false;
  }

  StaticJsonDocument<512> doc;
  doc["assignmentHash"] = currentLabel.assignmentHash;
  doc["labelVersion"] = currentLabel.labelVersion;
  doc["productId"] = currentLabel.productId;
  doc["barcode"] = currentLabel.barcode;
  doc["renderStatus"] = status;
  doc["renderedAt"] = "";
  if (errorMessage.length() > 0) {
    doc["error"] = errorMessage;
  } else {
    doc["error"] = nullptr;
  }

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(renderConfirmUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-esl-device-token", eslDeviceToken);
  http.setTimeout(10000);

  int httpCode = http.POST(body);
  Serial.print("Render confirm POST status: ");
  Serial.println(httpCode);
  if (httpCode != 200) {
    Serial.print("Render confirm hatasi: ");
    if (httpCode <= 0) {
      Serial.println(http.errorToString(httpCode));
    } else {
      Serial.println(http.getString());
    }
    http.end();
    return false;
  }

  Serial.println("Render confirm basariyla gonderildi.");
  http.end();
  return true;
}

bool updateDisplay()
{
  Serial.println("Ekran guncelleme basladi.");
  Serial.print("Current assignmentHash: ");
  Serial.println(currentLabel.assignmentHash);
  Serial.print("Previous rendered assignmentHash: ");
  Serial.println(lastRenderedAssignmentHash);
  Serial.print("Product: ");
  Serial.println(currentLabel.product);
  Serial.print("Barcode: ");
  Serial.println(currentLabel.barcode);

  display.setFullWindow();
  display.firstPage();
  do {
    drawLayout(currentLabel);
  } while (display.nextPage());
  // E-paper paneli güncellemeden sonra düşük tüketime al (görüntü korunur)
  display.powerOff();
  lastRenderedAssignmentHash = currentLabel.assignmentHash;
  Serial.println("Ekran guncelleme tamamlandi.");
  sendRenderConfirm("SUCCESS", "");
  return true;
}

// =========================
// Batarya Okuma (GPIO35 ADC)
// =========================
int readBatteryPercent()
{
  // 64 ornek ortalaması — gurultu azaltmak icin
  long sum = 0;
  for (int i = 0; i < 64; i++) {
    sum += analogRead(BATTERY_PIN);
  }
  float raw = sum / 64.0;

  // ESP32 ADC 12-bit: 0–4095 -> 0–3.3V
  // Voltaj bolucuyle olcum yapiliyorsa (R1=100K, R2=100K):
  //   gercekVoltaj = adcVoltaj * 2
  // Dogrudan LiPo olcumunde (max 4.2V icin bolucuye gerek var)
  float voltage = (raw / 4095.0) * 3.3 * 2.0;

  // Basit kaynak tespiti:
  // ADC neredeyse sifirsa batarya hatti bagli degil kabul edilir (genelde Micro USB besleme).
  if (voltage < 0.2f) {
    batteryConnected = false;
    powerSource = "micro_usb";
    Serial.println("Batarya bagli degil (Micro USB).");
    return 0;
  }

  batteryConnected = true;
  powerSource = "battery";

  // LiPo: 3.3V = %0, 4.2V = %100
  int percent = (int)((voltage - 3.3) / (4.2 - 3.3) * 100.0);
  if (percent < 0)   percent = 0;
  if (percent > 100) percent = 100;

  Serial.print("Batarya: ");
  Serial.print(voltage, 2);
  Serial.print("V -> %");
  Serial.println(percent);
  Serial.println("Guc kaynagi: Batarya");



  return percent;
}

// =========================
// Batarya Backend'e Gonder
// =========================
void sendBattery()
{
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi bagli degil, batarya gonderilemedi.");
    return;
  }

  int battery = readBatteryPercent();

  HTTPClient http;
  http.begin(batteryUrl);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  String body = "{\"battery\":" + String(battery) + "}";
  int httpCode = http.POST(body);

  Serial.print("Batarya POST status: ");
  Serial.println(httpCode);

  if (httpCode == 200) {
    Serial.println("Batarya basariyla gonderildi.");
  } else {
    Serial.print("Batarya gonderim hatasi: ");
    Serial.println(httpCode);
  }

  http.end();
}

// =========================
// Setup
// =========================
void setup()
{
  Serial.setRxBufferSize(256);
  Serial.begin(SERIAL_BAUD);
  Serial.setDebugOutput(false);
  delay(SERIAL_BOOT_SETTLE_MS);
  drainSerialInput(SERIAL_INPUT_QUIET_MS);
  printCleanBootBanner();

  // 1) BLE beacon baslat
  initShelfioBleBeacon();

  askNetworkConfigFromSerial();

  // 2) WiFi baglan
  connectWiFi();
  checkBackendHealth();

  // 3) E-paper baslat
  SPI.begin(EPD_SCK, -1, EPD_MOSI, EPD_CS);
  display.init(0);

  // 4) Ilk batarya gonderimi
  isStoreOpen = fetchStoreScheduleStatus();
  if (isStoreOpen) {
    sendBattery();
  } else {
    Serial.println("Magaza kapali, batarya gonderimi bekletiliyor.");
  }

  // 5) API'den etiket verisini al ve ciz
  currentLabel.templateType = "standard";
  currentLabel.oldMajor = "0";
  currentLabel.oldMinor = "00";
  currentLabel.clearMode = false;
  labelReady = isStoreOpen ? fetchLabel() : false;
  if (labelReady) {
    updateDisplay();
    Serial.println("Etiket basariyla cizildi.");
  } else {
    if (!isStoreOpen) {
      Serial.println("Magaza kapali, etiket cekimi bekletiliyor.");
    } else {
      Serial.println("Ilk veri alinamadi, yeniden denenecek...");
    }
  }

  lastPoll = millis();
  lastBattery = millis();
  lastScheduleCheck = millis();
}

// =========================
// Loop — periyodik guncelleme
// =========================
void loop()
{
  unsigned long now = millis();

  if (ENABLE_SHELFIO_BLE_BEACON) {
    maintainShelfioBleBeacon();
  }

  if (now - lastScheduleCheck >= SCHEDULE_CHECK_INTERVAL) {
    lastScheduleCheck = now;
    isStoreOpen = fetchStoreScheduleStatus();
  }

  if (!isStoreOpen) {
    return;
  }

  // Batarya periyodik gonderimi (5 dk)
  if (now - lastBattery >= BATTERY_INTERVAL) {
    lastBattery = now;
    sendBattery();
  }

  // Etiket periyodik kontrolu (60 sn)
  if (now - lastPoll >= POLL_INTERVAL) {
    lastPoll = now;
    Serial.println("Periyodik kontrol...");

    // Onceki veriyi sakla
    LabelData prev = currentLabel;

    if (fetchLabel()) {
      bool hashChanged = currentLabel.assignmentHash.length() > 0
                         && currentLabel.assignmentHash != lastRenderedAssignmentHash;
      bool visibleChanged = prev.product != currentLabel.product ||
                            prev.barcode != currentLabel.barcode ||
                            prev.major   != currentLabel.major   ||
                            prev.minor   != currentLabel.minor   ||
                            prev.oldMajor != currentLabel.oldMajor ||
                            prev.oldMinor != currentLabel.oldMinor ||
                            prev.origin  != currentLabel.origin  ||
                            prev.fdt     != currentLabel.fdt     ||
                            prev.clearMode != currentLabel.clearMode ||
                            prev.templateType != currentLabel.templateType;

      Serial.print("Onceki assignmentHash: ");
      Serial.println(lastRenderedAssignmentHash);
      Serial.print("Yeni assignmentHash: ");
      Serial.println(currentLabel.assignmentHash);

      // Hash degistiyse gorunur alanlar ayni olsa bile assignment render edilir.
      if (hashChanged || visibleChanged) {
        Serial.println("Etiket degisti, ekran guncelleniyor...");
        if (hashChanged) {
          Serial.println("Guncelleme nedeni: assignmentHash degisti.");
        }
        updateDisplay();
      } else {
        Serial.println("Etiket ayni, ekran guncellenmiyor.");
      }

      if (!labelReady) {
        labelReady = true;
        updateDisplay();
      }
    }
  }
}
