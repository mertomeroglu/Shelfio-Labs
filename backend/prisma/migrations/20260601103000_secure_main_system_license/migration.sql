UPDATE "plans"
SET
  "name" = 'Kurumsal / Platform',
  "enabled_modules" = '["dashboard","products","categories","users","settings","pos","stock","permissions","suppliers","notifications","warehouse","stock_batches","stock_movements","tasks","reports","procurement","purchase_orders","campaigns","proximity","esl","customers","customer_mobile","personnel_mobile","support","sales"]'::jsonb,
  "store_limit" = NULL,
  "user_limit" = NULL,
  "payload" = '{"system":"main"}'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'plan_enterprise_main';

UPDATE "licenses"
SET
  "tenant_id" = 'tenant_main_shelfio',
  "plan_id" = 'plan_enterprise_main',
  "plan_code" = 'enterprise',
  "status" = 'active',
  "enabled_modules" = '["dashboard","products","categories","users","settings","pos","stock","permissions","suppliers","notifications","warehouse","stock_batches","stock_movements","tasks","reports","procurement","purchase_orders","campaigns","proximity","esl","customers","customer_mobile","personnel_mobile","support","sales"]'::jsonb,
  "store_limit" = NULL,
  "user_limit" = NULL,
  "expires_at" = NULL,
  "payload" = '{
    "system":"main",
    "maskedKey":"SHELFIO-****-2026",
    "licenseType":"main",
    "licenseSummary":{
      "source":"shelfio_main",
      "planName":"Kurumsal / Platform",
      "planSlug":"enterprise",
      "licenseType":"main",
      "status":"active",
      "isDemo":false,
      "enabledModules":["dashboard","products","categories","users","settings","pos","stock","permissions","suppliers","notifications","warehouse","stock_batches","stock_movements","tasks","reports","procurement","purchase_orders","campaigns","proximity","esl","customers","customer_mobile","personnel_mobile","support","sales"],
      "maskedKey":"SHELFIO-****-2026"
    }
  }'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'license_main_shelfio_2026'
   OR "license_key_hash" = 'f8d3d76711199d1a87a0ad2ebc5343f6ed8339e54ceea16cc5d54e616534b8ef';
