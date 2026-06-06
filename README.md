# Shelfio

Elektronik raf etiketi entegrasyonuna sahip stok takip, fiyat yönetimi ve retail operasyon platformu.

---

## Projenin Amacı

**Shelfio**, modern perakende mağazacılık ve depo operasyonlarının dijitalleşmesini hedefleyen, uçtan uca tasarlanmış tam yığın (full-stack) bir retail yönetim platformudur. Proje, **Bilgisayar Programcılığı Sistem Analizi ve Tasarımı** dersi kapsamında bitirme projesi olarak geliştirilmiştir. 

Projenin temel amacı; reyon ve depo stok ayrımını netleştirmek, tedarik zinciri ve satın alma süreçlerini otomatikleştirmek, kampanya analiz algoritmalarıyla kârlılığı artırmak ve fiziksel IoT donanımları (Elektronik Raf Etiketi - ESL, BLE Beacon) ile dijital sistemleri anlık olarak senkronize ederek retail operasyonlarındaki operasyonel kayıpları en aza indirmektir.

---

## Ana Modüller

*   **Ürün Yönetimi:** Ürün kartları oluşturma, kategori hiyerarşisi, dinamik barkod tanımlamaları, fiyatlandırma kuralları ve depo/raf lokasyon eşleşmeleri.
*   **Stok Takip:** Mal kabul, stok çıkışı, stok hareketleri geçmişi ve envanter transfer süreçlerinin izlenmesi.
*   **Depo / Reyon Stok Ayrımı:** Ürünlerin fiziki olarak depoda duran miktarı ile reyonda (rafta) sergilenen miktarlarının ayrı ayrı izlenmesi ve reyon besleme süreçlerinin yönetimi.
*   **POS / Kasa:** Kasa satış ve iade işlemlerinin gerçekleştirildiği, anlık stok düşümü yapan simüle POS terminali.
*   **Tedarikçi Yönetimi:** Tedarikçi iletişim bilgileri, ürün/tedarikçi fiyat anlaşmaları, teslimat performans analizleri ve tedarikçi kataloglarının sisteme aktarımı.
*   **Satın Alma ve Sipariş Takibi:** Tedarikçilere otomatik veya manuel satın alma siparişi (PO) oluşturma, sipariş onay döngüsü, kargo/lojistik takip entegrasyonu ve mal kabul (goods receipt) süreçlerinin adım adım izlenmesi.
*   **Otomatik Sipariş Önerileri:** Ürünlerin tüketim hızları ve emniyet stok limitlerine göre tedarik edilmek istenen miktarlarını kural tabanlı algoritmalarla hesaplayıp sipariş taslağı oluşturan sistem.
*   **Kampanya Yönetimi:** Sepet indirimleri, hediye çeki tanımlamaları ve reyon bazlı dönemsel indirim kampanyalarının planlanması.
*   **Kampanya Öneri Algoritmaları:** Satış geçmişi ve ürün ilişkilerine dayanarak hangi ürün grubunda nasıl bir indirim yapılması gerektiğini öneren karar destek motoru.
*   **Fiyat & Talep Analizi:** Fiyat değişimlerinin satış hacmine etkisini analiz eden ve ideal fiyat seviyelerini öneren analitik araçlar.
*   **SKT Takibi:** Son Tüketim Tarihi (SKT) yaklaşan ürünleri parti (batch) bazlı takip ederek, bu ürünleri erken elden çıkarmak için otomatik indirim ve personel görevlendirme sistemlerini tetikleme.
*   **Stok İmha ve Sayım:** Son kullanma tarihi geçmiş veya hasarlı ürünlerin stoktan imha süreçleriyle düşülmesi; periyodik envanter sayım operasyonlarının yönetimi.
*   **ESL (Elektronik Raf Etiketi) Yönetimi:** Fiziksel e-paper etiket cihazlarının sisteme eklenmesi, ürünlerle eşleştirilmesi, dinamik şablon (standart, kampanya, fırsat) tasarımı ve kablosuz veri gönderimi.
*   **Müşteri Mobil Uygulaması (Capacitor/Android):** Ürün arama, kişiselleştirilmiş kampanya görüntüleme, dijital sepet yönetimi ve reyon yakınına gelindiğinde BLE beacon üzerinden tetiklenen anlık fırsat bildirimleri.
*   **Personel Mobil Uygulaması (Capacitor/Android):** Mal kabul, etiket eşleştirme, reyon sayımı, stok lokasyon kontrolü, sipariş toplama ve yöneticiler tarafından atanan operasyonel görevlerin takibi.
*   **Bildirimler:** Sistem içi kritik uyarılar, personel görev atamaları, müşteri mobil bildirimleri ve reyon yakınlığı bazlı proximity bildirim merkezi.
*   **Audit Log / Aktivite Kayıtları:** Sistemde kimin, ne zaman, hangi yetkiyle hangi kritik veriyi güncellediğini izleyen detaylı geriye dönük denetim logları.
*   **Lisans Kontrollü Giriş Hazırlığı:** Çoklu mağaza ve organizasyon (tenant/store) izolasyonunun altyapısı ve lisans doğrulama mekanizması.

---

## Teknolojiler

### Backend
*   **Node.js & Express:** RESTful API katmanı.
*   **Prisma ORM:** PostgreSQL veritabanı erişimi, şema yönetimi ve migration işlemleri.
*   **PostgreSQL:** Sistem veritabanı (pg_trgm eklentisiyle hızlı trigram metin araması desteği).
*   **Dotenv:** Çevre değişkenleri yönetimi.

### Frontend
*   **React 18 & Vite:** Hızlı ve modern yönetim paneli arayüzü.
*   **Vanilla CSS:** Esnek ve premium arayüz tasarımı.

### Mobil & Donanım
*   **Capacitor (Android JS Bridge):** Web tabanlı müşteri ve personel portallarını native Android özellikleriyle (Bluetooth BLE, Kamera/Kameradan Barkod Okuma) birleştiren hibrit mobil altyapı.
*   **ESP32 C3 / ESP32 WROOM (C++ Arduino):** E-paper ekranları süren ve BLE Beacon sinyali yayınlayan Elektronik Raf Etiketi firmware yazılımı.

---

## Kurulum ve Başlatma

### Gereksinimler
*   Node.js (LTS sürümü önerilir, v20+)
*   npm
*   Docker Desktop (PostgreSQL veritabanını kolayca ayağa kaldırmak için)

### 1. Veritabanının Hazırlanması (Docker)
Docker compose kullanarak PostgreSQL veritabanını başlatın:
```bash
docker compose up -d postgres
```
Bu komut, yerel geliştirme için `5433` portunda bir PostgreSQL konteyneri başlatır.

### 2. Bağımlılıkların Yüklenmesi
Projenin backend ve frontend bağımlılıklarını yükleyin:
```bash
# Backend bağımlılıkları
npm --prefix backend install

# Frontend bağımlılıkları
npm --prefix frontend install
```

### 3. Veritabanı Şemasının Uygulanması
Prisma istemcisini oluşturun ve veritabanı şemasını migrate edin:
```bash
# Ortam değişkeniyle Prisma istemcisini üretme
# Windows (PowerShell):
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
npm --prefix backend run prisma:generate

# Şema doğrulaması için:
cd backend
npx prisma validate
cd ..
```

---

## Ortam Değişkenleri (.env)

Projenin düzgün çalışması için `backend` ve `frontend` klasörlerinde `.env` dosyaları oluşturulmalıdır.

### Backend (`backend/.env`)
Aşağıdaki değişkenleri içeren bir dosya oluşturun (Örnek şema için [backend/.env.example](file:///c:/Users/merto/Desktop/Shelfio-Labs-git/backend/.env.example) dosyasına göz atabilirsiniz):
```env
PORT=4000
DATABASE_URL=postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public
JWT_SECRET=replace_with_secure_secret
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info@yourdomain.com
SMTP_PASS=replace_with_password
ESL_DEVICE_TOKEN=replace_with_secure_device_token
```

### Frontend (`frontend/.env.local`)
Frontend uygulaması için API URL adresini belirtin:
```env
VITE_API_BASE_URL=http://localhost:4000/api
```

---

## Geliştirme Komutları

### Backend Servisini Başlatma
```bash
# Geliştirme modu (Nodemon ile anlık yenileme)
# Windows (PowerShell):
$env:DATA_STORE="postgres"
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
npm --prefix backend run dev
```

### Frontend Uygulamasını Başlatma
```bash
npm --prefix frontend run dev
```
Uygulamaya tarayıcınızdan `http://localhost:5173` adresi üzerinden erişebilirsiniz.

### ESL Bridge (Etiket Köprüsü) Başlatma
Fiziksel etiketlerin heartbeat sinyallerini ve veri eşitlemelerini yöneten köprü scriptini çalıştırmak için:
```bash
npm --prefix backend run esl:bridge
```

---

## Test ve Build İşlemleri

### Testlerin Çalıştırılması
Backend birim testlerini çalıştırmak için:
```bash
npm --prefix backend test
```

### Frontend Production Build
Frontend uygulamasını derlemek ve canlıya hazır hale getirmek için:
```bash
npm --prefix frontend run build
```

---

## Proje Klasör Yapısı

```text
Shelfio-Labs-git/
├── backend/
│   ├── src/
│   │   ├── config/          # Sistem konfigürasyonları ve roller
│   │   ├── controllers/     # API istek yönlendiricileri
│   │   ├── domain/          # İş mantığı ve durum makine tanımları
│   │   ├── middlewares/     # Yetkilendirme, loglama ve güvenlik katmanları
│   │   ├── providers/       # Veritabanı ve SMTP sağlayıcıları
│   │   ├── repositories/    # Veri erişim katmanı (Prisma / JSON)
│   │   ├── routes/          # API rotaları
│   │   └── services/        # İş mantığı ve algoritmaların koşturulduğu servisler
│   ├── prisma/              # Veritabanı şeması ve migration dosyaları
│   ├── ESL_firmware/        # ESP32 için C++ donanım kodları (IoT)
│   ├── scripts/             # Veritabanı seed ve bakım scriptleri
│   └── test/                # Sunucu tarafı birim testleri
├── frontend/
│   ├── src/
│   │   ├── components/      # Ortak UI bileşenleri
│   │   ├── pages/           # Sayfa bileşenleri (POS, ESL, Stok, Raporlama vb.)
│   │   ├── router/          # İstemci tarafı sayfa yönlendirmeleri
│   │   ├── services/        # API iletişim servisleri
│   │   └── styles/          # Premium arayüz CSS tasarımları
│   └── public/              # Statik varlıklar ve logolar
└── docker-compose.yml       # Yerel PostgreSQL ayağa kaldırma dosyası
```

---

## Donanım ve ESL Firmware Notları

*   **Fiziksel Cihaz Entegrasyonu:** `backend/ESL_firmware` klasörü altındaki donanım kodları, e-paper ekranlara sahip mikrodenetleyiciler (ESP32) için geliştirilmiştir.
*   **Etiket Önizleme Alanı:** Web panelindeki "Etiket Önizleme" arayüzü, firmware içerisindeki piksel tabanlı yerleşim planını (layout) simüle edecek şekilde tasarlanmıştır. Bu sayede fiziksel etikete gönderilmeden önce çıktının nasıl görüneceği tarayıcıda izlenebilir.
*   **Cihaz Heartbeat & Güncelleme:** Firmware, backend üzerindeki `GET /api/esl/devices/:id/current-label` endpoint'ini periyodik olarak sorgulayarak (heartbeat) kendine atanan güncel görsel şablon verisini çeker ve ekranı kablosuz olarak günceller.
*   **Güvenlik:** Cihazların backend ile güvenli haberleşmesi için kullanılan `ESL_DEVICE_TOKEN` ve ağ bağlantı bilgileri (WiFi SSID, Şifre) donanım içine statik/hardcoded olarak yazılmamalı; cihaz ilk açıldığında seri port arayüzü üzerinden interaktif olarak kaydedilmelidir.

---

## Lisans Kontrol Sistemi Açıklaması

Shelfio, ticari deployment senaryoları düşünülerek tasarlanmış bir lisans doğrulama mekanizmasına sahiptir:
1.  **Backend Doğrulama:** Lisans doğrulama ve geçerlilik kontrolleri tamamen sunucu (backend) tarafında yürütülür.
2.  **İzolasyon:** Sistem, her bir mağazanın veya müşterinin verisini izole etmek amacıyla tenant/store şeması izolasyonu hedeflenerek tasarlanmıştır.
3.  **Kullanıcı Deneyimi:** Frontend üzerinde yer alan lisans uyarısı/ekranı sadece kullanıcıyı bilgilendirme amacı taşır. Lisans güvenliği doğrudan API isteklerinin backend'de doğrulanmasıyla sağlanır.
4.  **Güvenlik:** Lisans anahtarları ve yetkilendirme secret bilgileri veritabanında veya dosyalarda düz metin (plain text) olarak saklanmamalıdır.

---

## Güvenlik Notu & Uyarı

> [!CAUTION]
> Bu repo eğitim ve bitirme projesi kapsamında geliştirilmiştir. Canlı (Production) ortama yapılacak dağıtımlarda; ortam değişkenleri, veritabanı erişim şifreleri, JWT secret anahtarları, SMTP kimlik bilgileri, lisans doğrulama tokenları ve IoT cihaz haberleşme kanalları standart güvenlik protokollerine (HTTPS, SSL, şifrelenmiş env değişkenleri vb.) uygun olarak yeniden yapılandırılmalı ve güvenli hale getirilmelidir.

---
**Shelfio Geliştirici Ekibi - Bitirme Projesi Sistem Analizi ve Tasarımı**
