# README-CALISTIRMA

Bu dosya Shelfio Labs'i yerelde hızlı ve doğru şekilde ayağa kaldırmak içindir.

## 1. Proje Köküne Gel

```powershell
cd C:\Users\merto\Desktop\Shelfio-Labs
```

## 2. PostgreSQL'i Başlat

Docker açıksa PostgreSQL servisini başlat:

```powershell
docker compose up -d postgres
```

Servis varsayılan olarak şu bağlantıyı kullanır:

```text
postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public
```

## 3. Bağımlılıkları Kur

```powershell
npm --prefix backend install
npm --prefix frontend install
```

## 4. Prisma'yı Hazırla

```powershell
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
npm --prefix backend run prisma:generate
```

İsteğe bağlı schema doğrulama:

```powershell
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
cd backend
npx prisma validate
cd ..
```

## 5. Backend'i Başlat

```powershell
$env:DATA_STORE="postgres"
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
npm --prefix backend run dev
```

Beklenen çıktı:

```text
Server running on port 4000
```

Kontrol adresi:

```text
http://localhost:4000/api/health
```

## 6. Frontend'i Başlat

Yeni terminalde:

```powershell
cd C:\Users\merto\Desktop\Shelfio-Labs
npm --prefix frontend run dev
```

Frontend adresi:

```text
http://localhost:5173
```

## 7. Hızlı Smoke Kontrol

Backend health:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/health
```

Frontend:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:5173
```

Not: `/api/products`, `/api/stock`, `/api/settings` gibi endpointler auth token olmadan `401 Unauthorized` döndürebilir. Bu backend'in kapalı olduğu anlamına gelmez.

## 8. Kullanışlı Komutlar

Backend:

```powershell
npm --prefix backend run dev
npm --prefix backend run start
npm --prefix backend test
npm --prefix backend run prisma:generate
```

Frontend:

```powershell
npm --prefix frontend run dev
npm --prefix frontend run build
npm --prefix frontend run preview
npm --prefix frontend run test
```

## 9. Dikkat Gerektiren Komutlar

Bu komutlar DB'ye yazabilir veya migration uygulayabilir. Gelişigüzel çalıştırma:

```powershell
npm --prefix backend run prisma:migrate
npm --prefix backend run labels:sync
npm --prefix backend run repair:retail-case-stock:postgres
npm --prefix backend run repair:batch-nos:postgres
npm --prefix backend run seed:orders:lifecycle
```

## 10. Veri Katmanı

Backend runtime yalnız PostgreSQL/Prisma kullanır.

Artık kullanılmayan eski akışlar:

- JSON backend
- `DATA_STORE=json`
- `DATA_DIR`
- `backend/src/data`
- `backend/dataset`
- dataset import/rebuild
- JSON migration/import/export/repair scriptleri

`DATA_STORE=json` verilirse backend hata vererek durur:

```text
JSON data store is no longer supported. Use PostgreSQL.
```

## 11. Ortam Değişkenleri

Sık kullanılanlar:

- `PORT`: default `4000`
- `DATA_STORE`: boş veya `postgres`; `json` desteklenmez
- `DATABASE_URL`: PostgreSQL bağlantısı
- `JWT_SECRET`
- `VITE_API_BASE_URL`: default `http://localhost:4000/api`

PowerShell örneği:

```powershell
$env:PORT="4001"
$env:DATA_STORE="postgres"
$env:DATABASE_URL="postgresql://shelfio:shelfio_local_password@localhost:5433/shelfio_local?schema=public"
npm --prefix backend run dev
```

## 12. Sık Sorunlar

- `ENOENT package.json`: komutu yanlış klasörde çalıştırıyorsun. Kökten `--prefix` kullan.
- `Cannot resolve environment variable: DATABASE_URL`: backend/Prisma komutundan önce `DATABASE_URL` ver.
- `ECONNREFUSED localhost:5433`: Docker PostgreSQL servisi açık değil veya port değişmiş.
- Port dolu: farklı port ver (`$env:PORT="4001"`) veya portu kullanan süreci kapat.
- API bağlantı sorunu: backend health endpointini ve frontend `VITE_API_BASE_URL` değerini kontrol et.

## Son Güncelleme

- Tarih: 2026-05-20
- Kapsam: PostgreSQL-only çalışma akışı, Docker PostgreSQL, Prisma generate/validate, aktif scriptler ve eski JSON/dataset akışlarının kaldırıldığı bilgiyle güncellendi.
