# Shelfio ESL + BLE Beacon Unified Firmware

Bu klasör tek ESP32 firmware akışıdır. ESP32'ye artık ayrı BLE beacon firmware'i yüklenmez; `esl_label_firmware.ino` ana firmware olarak kalır ve aynı firmware içinde hem mevcut ESL/e-paper işlevleri hem de Shelfio BLE beacon yayını birlikte çalışır.

## Kapsam

Bu firmware şunları yapar:

- WiFi ile backend'e bağlanır.
- Mevcut ESL `current-label` verisini alır.
- E-paper etiketi günceller.
- Battery/status bilgisini gönderir.
- `schedule-status` kontrolünü sürdürür.
- BLE beacon advertising yayını yapar.

BLE beacon yalnızca müşteri proximity bildirimi için sinyal yayınlar. ESP32 telefon algılamaz, backend'e proximity event göndermez, kampanya/personel/görev/stok/ESL bildirim kararı vermez.

## Dosya Yapısı

- `esl_label_firmware.ino`: Ana ESL/e-paper firmware, tek `setup()` ve tek `loop()`.
- `shelfio_ble_beacon.h`: BLE beacon config externleri ve fonksiyon deklarasyonları.
- `shelfio_ble_beacon.cpp`: BLE advertising modülü.

Bağımsız `backend/ESP32_BLE_beacon_firmware/shelfio_ble_beacon.ino` sketch'i kaldırıldı. Tek upload hedefi bu klasördeki birleşik firmware'dir.

## BLE Config

BLE ayarları `esl_label_firmware.ino` içindeki `Shelfio BLE Beacon Ayarlari` bölümündedir:

```cpp
const bool ENABLE_SHELFIO_BLE_BEACON = true;
const char* SHELFIO_BEACON_UUID = "fda50693-a4e2-4fb1-afcf-c6eb07647825";
const char* SHELFIO_DEVICE_ID = "esp_sut_01";
const char* SHELFIO_STORE_CODE = "store_001";
const char* SHELFIO_ZONE_CODE = "zone_sut_reyonu";
const uint16_t SHELFIO_MAJOR = 1;
const uint16_t SHELFIO_MINOR = 101;
const char* SHELFIO_BLE_DEVICE_NAME = "Shelfio-ESP-SUT-01";
const uint32_t SHELFIO_BLE_ADVERTISING_INTERVAL_MS = 1000;
```

Admin paneldeki `BeaconDevice` kaydı bu değerlerle birebir eşleşmelidir:

| Firmware | Admin BeaconDevice |
| --- | --- |
| `SHELFIO_DEVICE_ID` | `deviceCode/deviceId` |
| `SHELFIO_BEACON_UUID` | `uuid` |
| `SHELFIO_MAJOR` | `major` |
| `SHELFIO_MINOR` | `minor` |

Bir değer farklı olursa backend beacon'ı eşleştiremez ve müşteri bildirimi üretmez.

## BLE Payload

Advertisement boyutu sınırlı olduğu için uzun `storeCode` ve `zoneCode` değerleri BLE payload içine sıkıştırılmaz.

Manufacturer data:

- byte `0..2`: ASCII `SHF`
- byte `3..18`: UUID raw 16 byte
- byte `19..20`: major, big-endian `uint16`
- byte `21..22`: minor, big-endian `uint16`

Scan response:

- `SHELFIO_BLE_DEVICE_NAME`

Android customer scanner şu alanları okuyabilir:

- RSSI
- Device name
- `SHF` signature
- UUID
- major
- minor

## Upload

Arduino IDE:

1. ESP32 board paketini kurun.
2. Arduino IDE'de `File > Open` ile `backend/ESL_firmware/esl_label_firmware/esl_label_firmware.ino` dosyasını açın.
3. IDE penceresinin başlığı `esl_label_firmware` olmalıdır. `sketch_may28a` veya `.arduinoIDE-unsaved...` görürseniz dosya geçici sketch olarak açılmıştır; pencereyi kapatıp repo içindeki `.ino` dosyasını tekrar açın.
4. `shelfio_ble_beacon.h` ve `shelfio_ble_beacon.cpp` aynı klasörde kalmalıdır.
5. Kart/port seçin.
6. `Tools > Partition Scheme` menüsünden `Huge APP (3MB No OTA/1MB SPIFFS)` seçin. Bu birleşik firmware default `1310720` byte app alanına sığmaz.
7. Upload edin.
8. Serial Monitor baud rate: `115200`.

Resetten hemen sonra, `CIHAZ BASLATILIYOR` basligindan once tek satirlik bozuk karakter gorulebilir. Bu ESP boot ROM ciktisidir ve firmware baslamadan once geldigi icin tamamen kapatilamaz. Basliktan sonraki yazi da bozuk gorunuyorsa Serial Monitor baud rate `115200` degildir veya yanlis port aciktir.

`shelfio_ble_beacon.h: No such file or directory` hatası genelde `.ino` dosyasının klasörüyle birlikte değil, Arduino IDE'nin geçici sketch klasöründen derlendiğini gösterir. Firmware bu durumda ESL-only fallback ile derlenebilir, ancak BLE proximity beacon için `shelfio_ble_beacon.h/.cpp` dosyalarının sketch klasöründe bulunması gerekir.

ESP32 Arduino IDE'de `text section exceeds available space` veya `Sketch too big` hatası görürseniz partition hâlâ default demektir. Kod yaklaşık 1.95 MB olabilir; default partition 1.31 MB, Huge APP partition yaklaşık 3 MB app alanı verir.

Acil ESL-only test için BLE derlemesini kapatmak gerekirse `shelfio_ble_beacon.h` içinde şu satırı geçici olarak `0` yapabilirsiniz:

```cpp
#define SHELFIO_BLE_BEACON_COMPILED 1
```

Bu fallback sadece boyut/ESL debug içindir; müşteri proximity için değer `1` kalmalıdır.

PlatformIO:

1. Framework olarak `arduino` kullanın.
2. Ana dosya olarak `esl_label_firmware.ino` veya eşdeğer `src/main.cpp` kullanın.
3. `shelfio_ble_beacon.cpp` build içine dahil edilmelidir.
4. Ekstra BLE dependency gerekmez; ESP32 Arduino core içindeki `BLEDevice` kullanılır.

## Beklenen Serial Log

Boot sırasında:

- `WiFi baglandi`
- `Backend health OK`
- `Shelfio BLE Beacon enabled`
- `Beacon UUID: ...`
- `Device ID: ...`
- `Major: ...`
- `Minor: ...`
- `BLE advertising started`

Loop içinde BLE logu spam yapmaz; yaklaşık 60 saniyede bir `Shelfio BLE advertising active` yazar.

## Test

1. Firmware compile olur.
2. ESP32'ye tek firmware olarak upload edilir.
3. ESP açıldığında WiFi bağlantısı çalışır.
4. ESL `current-label` endpoint akışı çalışır.
5. Battery/status gönderimi çalışır.
6. Schedule kontrolü çalışır.
7. E-paper label render çalışır.
8. BLE advertising başlar.
9. Android customer scanner beacon'ı görür.
10. RSSI okunabilir.
11. UUID/major/minor veya device name parse edilir.
12. Admin panel `BeaconDevice` kaydıyla eşleşme yapılabilir.
13. Personnel tarafı için firmware özel hiçbir şey yapmaz; ayrım Android/Web/Backend katmanındadır.
14. ESP reset sonrası hem ESL hem BLE tekrar başlar.

## Bellek Notu

ESP32 WiFi ve BLE aynı anda çalışabilir; klasik `BLEDevice` kullanıldığı için RAM kullanımı izlenmelidir. RAM sorunu görülürse ileride NimBLE daha hafif alternatif olarak değerlendirilebilir. Faz-1'de BLE scan yoktur, yalnızca advertising yapılır.
