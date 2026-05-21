#pragma once

#include <Arduino.h>

#ifndef SHELFIO_BLE_BEACON_COMPILED
// Keep enabled for the unified ESL + customer proximity firmware.
// Set to 0 only for temporary ESL-only compile/debug builds.
#define SHELFIO_BLE_BEACON_COMPILED 1
#endif

extern const bool ENABLE_SHELFIO_BLE_BEACON;
extern const char* SHELFIO_BEACON_UUID;
extern const char* SHELFIO_DEVICE_ID;
extern const char* SHELFIO_STORE_CODE;
extern const char* SHELFIO_ZONE_CODE;
extern const uint16_t SHELFIO_MAJOR;
extern const uint16_t SHELFIO_MINOR;
extern const char* SHELFIO_BLE_DEVICE_NAME;
extern const uint32_t SHELFIO_BLE_ADVERTISING_INTERVAL_MS;

void initShelfioBleBeacon();
void maintainShelfioBleBeacon();
