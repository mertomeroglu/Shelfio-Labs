# Shelfio Labs

Shelfio Labs, perakende operasyonları için geliştirilen tam yığın uygulamadır. Frontend React/Vite ile, backend Node.js/Express ile çalışır. Runtime veri kaynağı yalnız PostgreSQL/Prisma'dır.

## Güncel Mimari

- Frontend: React 18 + Vite
- Backend: Node.js + Express
- Veri katmanı: PostgreSQL + Prisma
- Veritabanı servisi: `docker-compose.yml` içindeki PostgreSQL 16
- JSON data store: desteklenmez
- Dataset/runtime JSON import hattı: kaldırıldı

`DATA_STORE=json` artık geçerli değildir. Bu değer verilirse backend bilinçli olarak şu hatayla durur:

```text
JSON data store is no longer supported. Use PostgreSQL.
```

## Proje Yapısı

- `backend/`: API, controller/service/repository katmanı, Prisma, bakım scriptleri
- `frontend/`: React uygulaması, router, sayfalar, servis katmanı
- `docker-compose.yml`: yerel PostgreSQL servisi
- `README-CALISTIRMA.md`: kısa çalıştırma rehberi

Repo kökünde `package.json` yoktur. Komutları `npm --prefix backend ...` / `npm --prefix frontend ...` ile veya ilgili klasöre girerek çalıştırın.

## Ana Özellikler

- Operasyon paneli: ürün, kategori, tedarikçi, stok, sipariş, lokasyon, raporlar
- POS akışı: kasa hub, kasa giriş ekranı ve satış akışı
- Yetki yönetimi: kullanıcı, permission, access request, temporary grant
- Müşteri portalı: `/musteri/*`
- Personel mobil alanı: `/personel/*`
- ESL, bildirim, görev, destek ve kampanya/fiyat analiz modülleri

## Backend API

`backend/src/routes/routes.js` üzerinden `/api` altında ana route grupları:

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

Korumalı endpointler auth token olmadan `401 Unauthorized` döndürür. Health endpoint token gerektirmez:

```text
http://localhost:4000/api/health
```

## Frontend Rotaları

Ana rota grupları `frontend/src/router/router.jsx` içindedir:

- `/login`
- `/` operasyon paneli
- `/kasa`
- `/musteri/*`
- `/personel/*`

## Gereksinimler

- Node.js LTS, önerilen 20+
- npm
- Docker Desktop veya Docker Engine
- PostgreSQL için `docker compose`

## Kurulum

Bağımlılıkları kur:

```powershell
npm --prefix backend install
npm --prefix frontend install
```

PostgreSQL servisini başlat:

```powershell
docker compose up -d postgres
```

Prisma Client üret:

```powershell
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
npm --prefix backend run prisma:generate
```

Schema doğrula:

```powershell
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
cd backend
npx prisma validate
cd ..
```

## Geliştirme Ortamı

Backend:

```powershell
$env:DATA_STORE="postgres"
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
npm --prefix backend run dev
```

Frontend:

```powershell
npm --prefix frontend run dev
```

Adresler:

- Backend: `http://localhost:4000`
- Backend health: `http://localhost:4000/api/health`
- Frontend: `http://localhost:5173`

## Ortam Değişkenleri

Backend için sık kullanılanlar:

- `PORT`: varsayılan `4000`
- `DATA_STORE`: boş veya `postgres`; `json` desteklenmez
- `DATABASE_URL`: PostgreSQL bağlantısı
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `CUSTOMER_REFRESH_SECRET`
- `CUSTOMER_REFRESH_EXPIRES_IN`
- `RUN_STARTUP_MAINTENANCE`: varsayılan kapalı
- SMTP değişkenleri: destek maili için `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, `SUPPORT_TO_EMAIL`

Frontend için:

- `VITE_API_BASE_URL`: varsayılan kullanım `http://localhost:4000/api`

Yerel Docker PostgreSQL varsayılan bağlantısı:

```text
postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public
```

## Scriptler

Backend:

| Script | Amaç | Not |
|---|---|---|
| `npm --prefix backend run dev` | Backend geliştirme sunucusu | Nodemon ile çalışır |
| `npm --prefix backend run start` | Backend normal başlangıç | Prod benzeri |
| `npm --prefix backend test` | Backend testleri | `node --test` |
| `npm --prefix backend run prisma:generate` | Prisma Client üretir | DB verisi değiştirmez |
| `npm --prefix backend run prisma:migrate` | Prisma migration | DB değiştirir, dikkatli kullan |
| `npm --prefix backend run labels:sync` | Kategori label senkronu | PostgreSQL/settings yazar |
| `npm --prefix backend run repair:retail-case-stock:postgres` | PostgreSQL stok policy repair | DB yazar |
| `npm --prefix backend run repair:batch-nos:postgres` | PostgreSQL batch no repair | DB yazar |
| `npm --prefix backend run seed:orders:lifecycle` | Sipariş lifecycle test seed | Test verisi yazar |

Frontend:

| Script | Amaç |
|---|---|
| `npm --prefix frontend run dev` | Vite dev server |
| `npm --prefix frontend run build` | Production build |
| `npm --prefix frontend run preview` | Build preview |
| `npm --prefix frontend run test` | Vitest testleri |
| `npm --prefix frontend run test:watch` | Watch test |

## PostgreSQL-Only Notu

Runtime API hiçbir JSON data dosyasından veri okumaz. Aşağıdaki eski akışlar aktif değildir:

- JSON file based backend
- `DATA_STORE=json`
- `DATA_DIR`
- `backend/src/data`
- `backend/dataset`
- dataset import/rebuild
- JSON migration/import/export/repair scriptleri

`products.json`, `stocks.json`, `settings.json` gibi eski dosya adları kodda yalnız repository mapping anahtarı olarak kalabilir; dosya sistemi veri kaynağı değildir.

## Doğrulama

Backend schema:

```powershell
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
cd backend
npx prisma validate
cd ..
```

Frontend build:

```powershell
npm --prefix frontend run build
```

Health kontrol:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/health
```

Auth gerektiren endpointlerde token yoksa `401 Unauthorized` normaldir.

## Sık Sorunlar

- `Cannot resolve environment variable: DATABASE_URL`: backend komutundan önce `DATABASE_URL` verin.
- `ECONNREFUSED localhost:5433`: Docker PostgreSQL servisi açık değil veya port farklı.
- `ENOENT package.json`: komut repo kökünde yalın `npm` ile çalıştırılmış olabilir; `--prefix backend` veya `--prefix frontend` kullanın.
- Port dolu: `PORT` veya Vite portunu değiştirin ya da ilgili süreci kapatın.

## Son Güncelleme

- Tarih: 2026-05-20
- Kapsam: PostgreSQL-only mimari, aktif scriptler, Docker/PostgreSQL çalıştırma akışı ve JSON/dataset kaldırma notlarıyla güncellendi.
