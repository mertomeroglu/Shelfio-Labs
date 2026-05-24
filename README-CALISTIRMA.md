# README-CALISTIRMA

Bu dosya Shelfio Labs'i yerelde çalıştırmak, mobil/ESL/proximity akışlarını test etmek ve kodu VPS'e güvenli taşımak için kısa rehberdir. Gerçek şifre, token veya production secret bilgisi bu dosyaya yazılmamalıdır.

## 1. Proje Kökü

Local çalışma klasörü:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Labs-git"
```

Repo kökünde `package.json` yoktur. Komutları `npm --prefix backend ...` veya `npm --prefix frontend ...` şeklinde çalıştırın.

## 2. Gereksinimler

- Node.js LTS, önerilen 20+
- npm
- Docker Desktop veya Docker Engine
- PostgreSQL için `docker compose`
- Android build için Android Studio JBR/JDK
- VPS tarafında PM2 ve deploy scripti

## 3. PostgreSQL'i Başlat

```powershell
docker compose up -d postgres
```

Yerel varsayılan bağlantı:

```text
postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public
```

Shelfio runtime yalnız PostgreSQL/Prisma kullanır. `DATA_STORE=json` desteklenmez.

## 4. Bağımlılıkları Hazırla

```powershell
npm --prefix backend install
npm --prefix frontend install
```

Bu komutlar ilk kurulum içindir. Normal dokümantasyon güncellemelerinde veya küçük değişikliklerde tekrar çalıştırmak gerekmez.

## 5. Prisma Hazırlığı

```powershell
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
npm --prefix backend run prisma:generate
```

Schema doğrulama:

```powershell
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
cd backend
npx prisma validate
cd ..
```

Migration veya seed komutlarını gelişigüzel çalıştırmayın; veritabanını değiştirebilir.

## 6. Backend'i Başlat

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Labs-git"
$env:DATA_STORE="postgres"
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
npm --prefix backend run dev
```

Health kontrol:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/health
```

Auth gerektiren endpointlerin token olmadan `401 Unauthorized` dönmesi normaldir.

## 7. Frontend'i Başlat

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Labs-git"
npm --prefix frontend run dev
```

Adres:

```text
http://localhost:5173
```

Frontend build:

```powershell
npm --prefix frontend run build
```

## 8. ESL / Elektronik Etiket Akışı

Etiket Yönetimi ekranında ürün ve ESL cihazı seçilir, önizleme kontrol edilir ve etiket cihaza gönderilir. Cihaz tarafında güncel etiket içeriği şu uçtan okunur:

```text
GET /api/esl/devices/:id/current-label
```

Bridge ve cihaz durumunda bakılacak başlıklar:

- Cihaz online/heartbeat durumu
- Assignment state
- Etiket gönderim geçmişi
- Seçilen ürün ve seçilen cihazın doğru olması

ESL bridge çalıştırma:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Labs-git"
npm --prefix backend run esl:bridge
```

Bridge ayarları `backend/.env.bridge` içinde tutulur. Gerçek `ESL_DEVICE_TOKEN`, production URL veya secret değerlerini dokümana yazmayın.

## 9. Proximity / BLE Beacon Akışı

Proximity Yönetimi ekranında üç ana kayıt tutulur:

- **Yakınlık Alanı:** Reyon önü, giriş, kasa yakını gibi mağaza içi alan.
- **Beacon:** BLE sinyali yayınlayan cihaz.
- **Bildirim Kuralı:** Müşteri alana girince veya alanda kalınca gösterilecek bildirim davranışı.

Temel test akışı:

1. `Proximity Yönetimi > Yakınlık Alanları` bölümünde alan oluşturun.
2. `Beacon Cihazları` bölümünde beacon ekleyin.
3. Beacon'ı reyon, Yakınlık Alanı ve gerekirse ESL cihazı ile eşleştirin.
4. `Bildirim Kuralları` bölümünde müşteri bildirimi oluşturun.
5. Customer Android uygulamayla beacon yakınına gidin.
6. `Event Log` içinde beacon event kaydını kontrol edin.
7. `Delivery Log` içinde bildirimin `SHOWN` veya `SKIPPED` sonucunu kontrol edin.

Sık görülen skip nedenleri:

- `UNKNOWN_BEACON`: Beacon sistemde eşleşmedi.
- `NO_LINKED_ESL_DEVICE`: Beacon üzerinde ESL cihaz bağlantısı yok.
- `NO_LABEL_PRODUCT`: ESL current-label içinde ürün yok.
- `PRODUCT_DISCOUNT_ALREADY_NOTIFIED_12H`: Aynı ürün için 12 saatlik dedupe devrede.

Demo/test için kural payload içinde `cooldownSeconds`, `testCooldownSeconds` veya `productDedupeSeconds` kullanılabilir. Production davranışını değiştirmeden önce dikkatli olun.

## 10. Müşteri Mobil Bildirimleri

Müşteri uygulamasında:

- Uygulama içi bildirimler web deneyimi içinde görünür.
- Genel/telefon bildirimleri Android native katmanda görünebilir.
- Bildirim ayarları müşterinin bildirim tercihlerini etkiler.
- Proximity ürün indirimi bildirimi `Ürüne Git` aksiyonu ile ürün detayına yönlendirir.
- Müşteri bildirim merkezi geçmiş bildirimleri gösterir.

Background/foreground davranışı Android OS kısıtlarına, uygulamanın force-stop edilmemiş olmasına ve geçerli müşteri oturumuna bağlıdır.

## 11. Android Uygulama

Android proje yolu:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Mobile-Apps\shelfio-customer\android"
```

JDK notu:

```powershell
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:Path="$env:JAVA_HOME\bin;$env:Path"
```

Customer uygulaması kurulumu:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Mobile-Apps\shelfio-customer\android"
.\gradlew.bat :app:installCustomerDebug
```

Personnel uygulaması kurulumu:

```powershell
cd "C:\Users\merto\Desktop\Shelfio-Mobile-Apps\shelfio-customer\android"
.\gradlew.bat :app:installPersonnelDebug
```

Flavor notları:

- `customer`: proximity/BLE açıktır.
- `personnel`: proximity/BLE kapalıdır.

Logcat tag'leri:

```text
ShelfioBLE
ShelfioProximity
ShelfioProximityBridge
ShelfioNotification
ShelfioService
```

## 12. Deploy / Git Akışı

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

## 13. Test / Debug Kontrolleri

Backend health:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/health
```

Frontend build:

```powershell
npm --prefix frontend run build
```

Backend test:

```powershell
npm --prefix backend test
```

Proximity için:

- Proximity Yönetimi > Event Log
- Proximity Yönetimi > Delivery Log
- Android Logcat tag'leri
- Beacon deviceCode / UUID / major / minor bilgileri
- Beacon-Zone-ESL eşleşmesi

ESL için:

- Etiket Yönetimi cihaz durumu
- ESL gönderim geçmişi
- Heartbeat ve assignment-state
- Bridge logları

## 14. Dikkat Gerektiren Komutlar

Aşağıdaki komutlar DB'ye yazabilir, migration uygulayabilir veya test verisi oluşturabilir. Amacınız net değilse çalıştırmayın:

```powershell
npm --prefix backend run prisma:migrate
npm --prefix backend run prisma:migrate:deploy
npm --prefix backend run labels:sync
npm --prefix backend run repair:retail-case-stock:postgres
npm --prefix backend run repair:batch-nos:postgres
npm --prefix backend run seed:orders:lifecycle
npm --prefix backend run seed:customer-proximity
npm --prefix backend run ensure:owner-permissions
```

## 15. Güvenlik Notları

- `.env`, `.env.bridge`, token, SMTP şifresi, VPS şifresi ve JWT secret Git'e gönderilmez.
- README içinde gerçek secret yazılmaz; placeholder kullanılır.
- `node_modules`, build çıktıları ve local IDE/cache dosyaları Git'e gönderilmez.

## 16. Bilinen Sınırlar

- Android force-stop sonrası background servis otomatik çalışmayabilir.
- Aynı ürün için 12 saat dedupe bildirimin tekrarını engeller.
- Background'da gerçek ürün bildirimi için native/backend auth path gereklidir.
- Personel uygulamasında BLE/proximity kapalıdır.
- Proximity ürün bildirimi için beacon, Yakınlık Alanı, ESL ve etikette ürün bağlantısı doğru olmalıdır.

## Son Güncelleme

- Tarih: 2026-05-23
- Kapsam: Local geliştirme, ESL bridge, Proximity/BLE test akışı, Android flavor kurulumu, deploy, debug ve güvenlik notları güncellendi.
