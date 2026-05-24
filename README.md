# Shelfio Labs

Shelfio Labs; market ve perakende operasyonları için geliştirilen yönetim, personel ve müşteri deneyimini tek platformda birleştiren tam yığın bir sistemdir. Ürün, stok, fiyat, kampanya, elektronik etiket, yakınlık bildirimi, görev, bildirim ve yetki akışları PostgreSQL/Prisma tabanlı backend ve React/Vite frontend üzerinden çalışır.

## A) Proje Özeti

Shelfio şu yüzeylerden oluşur:

- **Admin/Yönetim paneli:** Ürün, stok, kampanya, ESL/elektronik etiket, proximity, bildirim, görev, rapor ve yetki yönetimi.
- **Personel portalı:** Görev, etiket, sayım, lokasyon, sipariş ve saha operasyonları.
- **Müşteri mobil portalı:** Ürün arama, kampanya, sepet, favori, bildirim merkezi ve proximity bildirim deneyimi.
- **ESL / Elektronik Etiket sistemi:** Ürün fiyatı, kampanya ve etiket bilgisinin fiziksel elektronik etikete gönderilmesi.
- **Proximity / BLE beacon sistemi:** Mağaza içinde müşterinin yaklaştığı reyon/alanı algılayıp ilgili müşteri bildirimini üretir.
- **Bildirim sistemi:** Yönetim/personel bildirimleri, müşteri mobil bildirimleri, proximity kaynaklı ürün/kampanya bildirimleri ve bildirim merkezi.

## B) Proje Mimarisi

- **Backend:** `backend/` altında Node.js + Express API, controller/service/repository katmanları, permission middleware'leri ve proximity rule engine bulunur.
- **Frontend:** `frontend/` altında React 18 + Vite uygulaması, yönetim paneli, müşteri portalı ve personel portalı bulunur.
- **Android:** Ayrı mobil klasörde Capacitor Android uygulaması iki flavor ile çalışır: `customer` ve `personnel`. Customer flavor proximity/BLE akışını kullanır; personnel flavor için proximity kapalıdır.
- **ESP/ESL firmware ve bridge:** `backend/ESL_firmware/` birleşik ESL + BLE beacon firmware dokümanını içerir. `backend/scripts/bridge/` yerel ESL heartbeat bilgisini production API'ye güvenli şekilde taşımak için bridge agent içerir.
- **PostgreSQL/Prisma:** Runtime veri kaynağı yalnız PostgreSQL'dir. JSON data store desteklenmez.
- **PM2/VPS deploy:** Production backend PM2 ile çalışır. VPS güncellemesi GitHub'dan çekilen kod ve `deploy.sh` ile yapılır.
- **GitHub workflow:** Local değişiklikler `push.ps1` ile GitHub'a gönderilir, VPS tarafında `deploy.sh` ile alınır.

## C) Ana Modüller

- **Ürün yönetimi:** Ürün kartları, kategori, barkod, fiyat, lokasyon ve etiket bilgileri.
- **Stok yönetimi:** Mal kabul, stok çıkışı, düzeltme, sayım, imha, reyon besleme ve hareket geçmişi.
- **Kampanya/fiyat yönetimi:** Kampanya oluşturma, fiyat analizi, SKT ve satış bazlı öneriler.
- **ESL / Etiket Yönetimi:** Elektronik etiket cihazları, ürün etiketi gönderimi, geçmiş ve cihaz durumu.
- **Proximity Yönetimi:** Beacon cihazları, Yakınlık Alanları, bildirim kuralları, Event Log ve Delivery Log.
- **Müşteri mobil portalı:** Ürün keşfi, kampanyalar, sepet, favoriler, bildirim merkezi ve proximity bildirimleri.
- **Personel portalı:** Görevler, etiket uygulama, sipariş, lokasyon, sayım ve operasyon bildirimleri.
- **Bildirim merkezi:** Sistem, görev, müşteri, kampanya ve proximity bildirim kayıtları.
- **Görev sistemi:** Görev planlama, atama, durum takibi ve personel mobil görev akışı.
- **Yetki/permission sistemi:** Rol, permission, access request ve temporary grant akışları.

## D) ESL / Etiket Yönetimi

**Etiket cihazı nedir?**  
Elektronik Etiket (ESL), raf üzerinde ürün adı, fiyat, kampanya ve stok/etiket bilgisini gösteren fiziksel cihazdır.

**Ürün etikete nasıl gönderilir?**

1. Yönetim panelinde `Etiket Yönetimi` sayfası açılır.
2. Ürün seçilir.
3. ESL cihazı seçilir.
4. Şablon ve önizleme kontrol edilir.
5. `Etikete Gönder` aksiyonu ile backend `/api/esl/send` üzerinden etiket ataması yapılır.

**ESL current-label mantığı:**  
Firmware veya cihaz entegrasyonu `GET /api/esl/devices/:id/current-label` ile cihazın güncel etiket içeriğini alır. Bu endpoint cihazın etikette hangi ürünü göstermesi gerektiğini belirleyen ana okuma noktasıdır.

**Heartbeat / assignment-state:**  
Cihaz heartbeat uçları cihazın online/offline durumunu izlemek için kullanılır. Assignment state, cihazın beklenen etiket atamasını ve bridge senkron durumunu takip eder.

**Dikkat edilmesi gerekenler:**

- Yanlış ürün veya yanlış cihaz seçimi raftaki gerçek etiketi etkiler.
- Cihaz online değilse gönderim beklenen sonucu vermeyebilir.
- Bridge token ve production API bilgileri `.env.bridge` içinde tutulur, README'ye gerçek değer yazılmaz.
- ESL gönderim geçmişi ve heartbeat durumu hata ayıklamada ilk kontrol noktalarıdır.

## E) Proximity / BLE Sistemi

**Beacon nedir?**  
Beacon, mağaza içinde BLE sinyali yayınlayan küçük cihazdır. Müşteri uygulaması bu sinyali görerek müşterinin hangi alana yaklaştığını backend'e bildirir.

**Yakınlık Alanı nedir?**  
Yakınlık Alanı, mağaza içinde anlamlı bir bölgeyi temsil eder: reyon önü, giriş alanı, kampanya alanı veya kasa yakını gibi.

**Beacon-Zone-ESL bağlantısı:**  
Beacon cihazı bir Yakınlık Alanı, reyon ve isteğe bağlı ESL cihazı ile eşleştirilir. ESL eşleşmesi varsa sistem etiketteki ürünü okuyup ürün bazlı bildirim üretebilir.

**Müşteri reyon yakınına gelince ne olur?**

1. Customer Android app BLE beacon sinyalini algılar.
2. Proximity payload backend `/api/proximity/events` endpointine gönderilir.
3. Backend beacon cihazını `deviceCode` veya `uuid+major+minor` ile eşleştirir.
4. Yakınlık Alanı ve beacon aktifse notification rule engine çalışır.
5. ESL eşleşmesi varsa current-label üzerinden ürün bilgisi okunur.
6. Üründe aktif indirim varsa `PROXIMITY_PRODUCT_DISCOUNT` bildirimi üretilebilir.
7. Event Log ve Delivery Log kayıtları oluşur.

**12 saat ürün bazlı dedupe:**  
Aynı müşteriye aynı ürün için varsayılan olarak 12 saat içinde tekrar ürün indirim bildirimi gönderilmez. Bu süre `PROXIMITY_PRODUCT_DEDUPE_SECONDS` ile ayarlanabilir.

**Test/demo cooldown:**  
Kural payload içinde `cooldownSeconds`, `testCooldownSeconds` veya `productDedupeSeconds` gibi teknik değerler demo/testte bekleme süresini kısaltmak için kullanılabilir. Production için dikkatli kullanılmalıdır.

**Event Log / Delivery Log nasıl okunur?**

- Event Log, beacon algılama olayını ve eşleşen cihaz/alan bilgisini gösterir.
- Delivery Log, bildirimin gösterilip gösterilmediğini, skip nedenini, dedupe key bilgisini ve varsa ürün teşhis bilgisini gösterir.
- `UNKNOWN_BEACON`, beacon eşleşmediğini; `NO_LINKED_ESL_DEVICE`, beacon üzerinde ESL bağlantısı olmadığını; `NO_LABEL_PRODUCT`, etikette ürün bulunamadığını; `PRODUCT_DISCOUNT_ALREADY_NOTIFIED_12H`, ürün bazlı dedupe nedeniyle bildirimin atlandığını anlatır.

## F) Müşteri Mobil Bildirimleri

- **Uygulama içi bildirimler:** Müşteri uygulama açıkken gösterilen toast/modal/banner benzeri bildirimlerdir.
- **Genel bildirimler / telefon bildirimleri:** Native Android tarafında telefon bildirimi olarak görünebilir.
- **Bildirim ayarları:** Müşteri mobilde bildirim tercihleri yönetilebilir. Uygulama içi ve genel bildirim izinleri farklı davranabilir.
- **Ürüne Git aksiyonu:** `PROXIMITY_PRODUCT_DISCOUNT` bildirimi ürün detayına `/musteri/urun/:id` rotasıyla götürür.
- **Müşteri bildirim merkezi:** Müşteri daha önce gelen bildirimleri uygulama içinden görebilir.
- **Background/foreground davranışı:** Foreground'da web/native bridge üzerinden hızlı yanıt alınır. Background'da Android servis davranışı, OS kısıtları ve geçerli auth path önemlidir.

## G) Android Uygulama

Android proje yolu:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Mobile-Apps\shelfio-customer\android"
```

Flavor yapısı:

- `customer`: müşteri uygulaması, proximity/BLE açıktır.
- `personnel`: personel uygulaması, proximity/BLE kapalıdır.

Kurulum komutları:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Mobile-Apps\shelfio-customer\android"
.\gradlew.bat :app:installCustomerDebug
.\gradlew.bat :app:installPersonnelDebug
```

Java/JDK notu:

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:Path="$env:JAVA_HOME\bin;$env:Path"
```

Logcat tag'leri:

- `ShelfioBLE`
- `ShelfioProximity`
- `ShelfioProximityBridge`
- `ShelfioNotification`
- `ShelfioService`

## H) Deploy / Git Akışı

Local çalışma klasörü:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Labs-git"
```

Local -> GitHub:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Labs-git"
.\push.ps1 "Update Shelfio"
```

GitHub -> VPS:

```bash
cd /var/www/shelfio/Shelfio-Labs
./deploy.sh
```

Backend restart:

```bash
pm2 restart shelfio-backend
```

Log kontrol:

```bash
pm2 logs shelfio-backend --lines 100 --timestamp
```

## I) Local Geliştirme

PostgreSQL başlatma:

```powershell
docker compose up -d postgres
```

Backend başlatma:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Labs-git"
$env:DATA_STORE="postgres"
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
npm --prefix backend run dev
```

Frontend başlatma:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Labs-git"
npm --prefix frontend run dev
```

ESL bridge başlatma:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Labs-git"
npm --prefix backend run esl:bridge
```

Notlar:

- Docker PostgreSQL yerel backend için açık olmalıdır.
- `.env`, `.env.bridge`, production token, SMTP şifresi ve secret değerleri Git'e gönderilmez.
- `node_modules` Git'e gönderilmez.
- Runtime veri kaynağı PostgreSQL/Prisma'dır; `DATA_STORE=json` desteklenmez.

## J) Güvenlik Notları

- GitHub token, SMTP şifresi, VPS şifresi, JWT secret ve ESL device token README'ye yazılmaz.
- `.env` dosyaları Git'e eklenmez.
- Dokümanda secret gerekiyorsa yalnız placeholder kullanılır: `<JWT_SECRET>`, `<SMTP_PASS>`, `<ESL_DEVICE_TOKEN>`.
- Production secret bilgileri dokümana konulmaz.

## K) Test / Debug

- Backend health: `http://localhost:4000/api/health`
- Backend logları: terminal çıktısı veya PM2 logları.
- Developer logs: Sistem Ayarları içindeki izleme/log alanları.
- Proximity Event Log: Proximity Yönetimi > Event Log.
- Proximity Delivery Log: Proximity Yönetimi > Delivery Log.
- ESL heartbeat: Etiket Yönetimi cihaz durumu ve bridge heartbeat uçları.
- Android Logcat tag'leri: `ShelfioBLE`, `ShelfioProximity`, `ShelfioProximityBridge`, `ShelfioNotification`, `ShelfioService`.

Frontend build:

```powershell
npm --prefix frontend run build
```

Backend test:

```powershell
npm --prefix backend test
```

## L) Bilinen Sınırlar

- Android uygulama force-stop edilirse background service tekrar çalışmayabilir.
- Aynı ürün için 12 saatlik dedupe bildirimin tekrarını engeller.
- Background'da gerçek ürün bildirimi için native/backend auth path doğru çalışmalıdır.
- Personel uygulamasında BLE/proximity kapalıdır.
- Proximity rule create/update backend tarafında şu an müşteri hedefli ve desteklenen trigger değerleriyle sınırlıdır.

## Güncel Backend Route Grupları

`backend/src/routes/routes.js` altında `/api` prefix'iyle çalışan ana gruplar:

- `/auth`
- `/categories`
- `/suppliers`
- `/products`
- `/stock`
- `/reports`
- `/users`
- `/settings`
- `/tasks`
- `/sections`
- `/esl`
- `/pos`
- `/procurement`
- `/notifications`
- `/access-requests`
- `/temporary-grants`
- `/permissions`
- `/support`
- `/warehouse`
- `/customers`
- `/customer-auth`
- `/campaign-analysis`
- `/proximity`

## Son Güncelleme

- Tarih: 2026-05-23
- Kapsam: ESL/etiket, Proximity/BLE beacon, müşteri mobil bildirimleri, Android flavor yapısı, deploy akışı, debug notları ve güvenlik uyarılarıyla güncellendi.
