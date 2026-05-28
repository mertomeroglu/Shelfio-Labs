#include "shelfio_ble_beacon.h"

#if SHELFIO_BLE_BEACON_COMPILED

#include <string>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLEAdvertising.h>

static BLEAdvertising* shelfioBleAdvertising = nullptr;
static bool shelfioBleBeaconStarted = false;
static uint32_t lastShelfioBleHealthLogAt = 0;
static const uint32_t SHELFIO_BLE_HEALTH_LOG_INTERVAL_MS = 60000;

static int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static bool parseUuidBytes(const char* uuidStr, uint8_t* output) {
  int highNibble = -1;
  uint8_t appended = 0;

  for (const char* cursor = uuidStr; *cursor && appended < 16; cursor++) {
    if (*cursor == '-') continue;
    const int nibble = hexNibble(*cursor);
    if (nibble < 0) continue;

    if (highNibble < 0) {
      highNibble = nibble;
      continue;
    }

    output[appended] = static_cast<uint8_t>((highNibble << 4) | nibble);
    highNibble = -1;
    appended++;
  }
  return (appended == 16);
}

static String buildShelfioManufacturerData(bool& uuidOk) {
  String data;
  data.reserve(23);
  data.concat("SHF"); // Represents 'S' (0x53), 'H' (0x48), 'F' (0x46)

  uint8_t uuidBytes[16] = {0};
  uuidOk = parseUuidBytes(SHELFIO_BEACON_UUID, uuidBytes);

  // Append 16 UUID bytes
  for (int i = 0; i < 16; i++) {
    const char byteVal = static_cast<char>(uuidBytes[i]);
    data.concat(&byteVal, 1);
  }

  // Append Major (2 bytes)
  const char majHigh = static_cast<char>((SHELFIO_MAJOR >> 8) & 0xFF);
  data.concat(&majHigh, 1);
  const char majLow = static_cast<char>(SHELFIO_MAJOR & 0xFF);
  data.concat(&majLow, 1);

  // Append Minor (2 bytes)
  const char minHigh = static_cast<char>((SHELFIO_MINOR >> 8) & 0xFF);
  data.concat(&minHigh, 1);
  const char minLow = static_cast<char>(SHELFIO_MINOR & 0xFF);
  data.concat(&minLow, 1);

  return data;
}

static uint16_t advertisingIntervalUnits() {
  uint16_t intervalUnits = static_cast<uint16_t>((SHELFIO_BLE_ADVERTISING_INTERVAL_MS * 16UL) / 10UL);
  if (intervalUnits < 32) {
    intervalUnits = 32;
  }
  return intervalUnits;
}

void initShelfioBleBeacon() {
  if (!ENABLE_SHELFIO_BLE_BEACON) {
    Serial.println("Shelfio BLE Beacon disabled (ENABLE_SHELFIO_BLE_BEACON is false)");
    return;
  }

  Serial.println("Shelfio BLE Beacon enabled");

  // Free heap before BLE initialization
  uint32_t heapBefore = ESP.getFreeHeap();
  Serial.print("Shelfio BLE: free heap before BLE init = ");
  Serial.println(heapBefore);

  Serial.print("Beacon UUID: ");
  Serial.println(SHELFIO_BEACON_UUID);
  Serial.print("Device ID: ");
  Serial.println(SHELFIO_DEVICE_ID);
  Serial.print("Store code: ");
  Serial.println(SHELFIO_STORE_CODE);
  Serial.print("Zone code: ");
  Serial.println(SHELFIO_ZONE_CODE);
  Serial.print("Major: ");
  Serial.println(SHELFIO_MAJOR);
  Serial.print("Minor: ");
  Serial.println(SHELFIO_MINOR);

  // Initialize BLE Device
  BLEDevice::init(SHELFIO_BLE_DEVICE_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_P7);

  BLEServer* server = BLEDevice::createServer();
  if (server == nullptr) {
    shelfioBleBeaconStarted = false;
    Serial.println("Shelfio BLE init failed: BLEDevice init fail");
    return;
  }

  bool uuidOk = true;
  String mfgData = buildShelfioManufacturerData(uuidOk);

  if (!uuidOk) {
    shelfioBleBeaconStarted = false;
    Serial.println("Shelfio BLE init failed: invalid UUID parse");
    return;
  }

  // Print exact manufacturer logs
  Serial.println("Shelfio BLE manufacturerId=0x4853");
  Serial.println("Shelfio BLE manufacturerData length=21");
  Serial.print("Shelfio BLE manufacturerData hex=");
  for (int i = 2; i < 23; i++) {
    char hexStr[3];
    sprintf(hexStr, "%02x", static_cast<uint8_t>(mfgData[i]));
    Serial.print(hexStr);
  }
  Serial.println();

  BLEAdvertisementData advertisementData;
  advertisementData.setFlags(ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT);
  advertisementData.setManufacturerData(mfgData);

  BLEAdvertisementData scanResponseData;
  scanResponseData.setName(SHELFIO_BLE_DEVICE_NAME);

  shelfioBleAdvertising = BLEDevice::getAdvertising();
  if (shelfioBleAdvertising == nullptr) {
    shelfioBleBeaconStarted = false;
    Serial.println("Shelfio BLE init failed: advertising handle is null");
    return;
  }

  shelfioBleAdvertising->setAdvertisementData(advertisementData);
  shelfioBleAdvertising->setScanResponseData(scanResponseData);
  shelfioBleAdvertising->setScanResponse(true);
  shelfioBleAdvertising->setMinPreferred(0x06);
  shelfioBleAdvertising->setMaxPreferred(0x12);
  shelfioBleAdvertising->setMinInterval(advertisingIntervalUnits());
  shelfioBleAdvertising->setMaxInterval(advertisingIntervalUnits());

  BLEDevice::startAdvertising();
  shelfioBleBeaconStarted = true;
  lastShelfioBleHealthLogAt = millis();
  
  Serial.println("Shelfio BLE advertising started");

  // Free heap after BLE initialization
  uint32_t heapAfter = ESP.getFreeHeap();
  Serial.print("Shelfio BLE: free heap after BLE init = ");
  Serial.println(heapAfter);
}

void maintainShelfioBleBeacon() {
  if (!ENABLE_SHELFIO_BLE_BEACON) return;

  if (!shelfioBleBeaconStarted || shelfioBleAdvertising == nullptr) {
    Serial.println("Shelfio BLE Beacon inactive, restarting advertising");
    initShelfioBleBeacon();
    return;
  }

  const uint32_t now = millis();
  if (now - lastShelfioBleHealthLogAt >= SHELFIO_BLE_HEALTH_LOG_INTERVAL_MS) {
    lastShelfioBleHealthLogAt = now;
    BLEDevice::startAdvertising();
    Serial.println("Shelfio BLE advertising active");
  }
}

#else

void initShelfioBleBeacon() {
  Serial.println("Shelfio BLE Beacon disabled (SHELFIO_BLE_BEACON_COMPILED is 0)");
}

void maintainShelfioBleBeacon() {
}

#endif
