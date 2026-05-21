#include "shelfio_ble_beacon.h"

#if SHELFIO_BLE_BEACON_COMPILED

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

static void appendByte(String& target, uint8_t value) {
  const char byteValue = static_cast<char>(value);
  target.concat(&byteValue, 1);
}

static void appendUint16(String& target, uint16_t value) {
  appendByte(target, static_cast<uint8_t>((value >> 8) & 0xFF));
  appendByte(target, static_cast<uint8_t>(value & 0xFF));
}

static void appendUuidBytes(String& target, const char* uuid) {
  int highNibble = -1;
  uint8_t appended = 0;

  for (const char* cursor = uuid; *cursor && appended < 16; cursor++) {
    if (*cursor == '-') continue;
    const int nibble = hexNibble(*cursor);
    if (nibble < 0) continue;

    if (highNibble < 0) {
      highNibble = nibble;
      continue;
    }

    appendByte(target, static_cast<uint8_t>((highNibble << 4) | nibble));
    highNibble = -1;
    appended++;
  }
}

static String buildShelfioManufacturerData() {
  String data;

  // Android parser guide:
  // bytes 0-2  : ASCII "SHF" Shelfio signature
  // bytes 3-18 : beacon UUID, 16 raw bytes, same value as SHELFIO_BEACON_UUID
  // bytes 19-20: major, big-endian uint16
  // bytes 21-22: minor, big-endian uint16
  // Device ID is exposed through SHELFIO_BLE_DEVICE_NAME or Android-side mapping.
  data.reserve(23);
  data.concat("SHF");
  appendUuidBytes(data, SHELFIO_BEACON_UUID);
  appendUint16(data, SHELFIO_MAJOR);
  appendUint16(data, SHELFIO_MINOR);

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
  if (!ENABLE_SHELFIO_BLE_BEACON) return;

  Serial.println("Shelfio BLE Beacon enabled");
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

  BLEDevice::init(SHELFIO_BLE_DEVICE_NAME);
  BLEDevice::setPower(ESP_PWR_LVL_P7);

  BLEServer* server = BLEDevice::createServer();
  (void)server;

  BLEAdvertisementData advertisementData;
  advertisementData.setFlags(ESP_BLE_ADV_FLAG_GEN_DISC | ESP_BLE_ADV_FLAG_BREDR_NOT_SPT);
  advertisementData.setManufacturerData(buildShelfioManufacturerData());

  BLEAdvertisementData scanResponseData;
  scanResponseData.setName(SHELFIO_BLE_DEVICE_NAME);

  shelfioBleAdvertising = BLEDevice::getAdvertising();
  if (shelfioBleAdvertising == nullptr) {
    shelfioBleBeaconStarted = false;
    Serial.println("Shelfio BLE Beacon failed to start: advertising handle is null");
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
  Serial.println("BLE advertising started");
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
  Serial.println("Shelfio BLE Beacon compile-time disabled");
}

void maintainShelfioBleBeacon() {
}

#endif
