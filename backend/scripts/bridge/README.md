# Shelfio ESL Local Bridge

Local bridge mağaza ağında çalışır. Local backend'deki gerçek ESL heartbeat durumunu okur ve sadece local heartbeat tazeyse production API'ye token'lı heartbeat gönderir.

## Env

`backend/.env.bridge` oluşturun:

```env
LOCAL_ESL_BASE_URL=http://localhost:4000/api
PRODUCTION_API_BASE_URL=https://example.com/api
ESL_DEVICE_ID=esl-dev-3
ESL_DEVICE_TOKEN=change-this-long-random-token
LOCAL_ESL_IP=192.168.1.103
HEARTBEAT_INTERVAL_SECONDS=30
LOCAL_HEARTBEAT_FRESH_SECONDS=100
ESL_BRIDGE_REQUEST_TIMEOUT_MS=10000
```

Production backend ve local backend aynı `ESL_DEVICE_TOKEN` değerini bilmeli. Token loglanmaz.
ESP firmware setup sırasında aynı token kaydedilmelidir; aksi halde `render-confirm` 401 alır ve panel cihaz güncellemesini beklemeye devam eder.

Label sync akışında bridge, production assignment'ı local API'ye yazdıktan sonra local `current-label` endpointini tekrar okur. `productId`, `assignmentHash` veya barkod beklenen değerle eşleşmezse `localStateSynced:false` ve `reason:"current_label_mismatch"` loglanır; aynı assignment hash tamamlandı sayılmaz ve sonraki turda tekrar denenir.

## Run

```bash
npm --prefix backend run esl:bridge
```

Windows/PM2 örneği:

```bash
pm2 start backend/scripts/bridge/eslBridgeAgent.js --name shelfio-esl-bridge
pm2 save
```

Systemd servisinde `WorkingDirectory` repo kökü veya `backend` dizini olabilir; `Environment=ESL_BRIDGE_ENV=/path/to/backend/.env.bridge` verilebilir.

## Health Flow

1. Bridge `GET /api/esl/devices/:id/heartbeat-state` ile local backend'deki son gerçek heartbeat'i okur.
2. Local status `online` ve heartbeat yaşı `LOCAL_HEARTBEAT_FRESH_SECONDS` değerinden küçükse production'a gider.
3. Bridge `POST /api/esl/devices/:id/heartbeat` ile production DB'de `payload.lastHeartbeatAt` değerini server zamanı ile günceller.
4. Bridge durursa veya local heartbeat bayatlarsa production mevcut 2 dakikalık online/offline kuralıyla offline'a düşer.
