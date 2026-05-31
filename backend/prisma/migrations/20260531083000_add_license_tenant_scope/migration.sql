CREATE TABLE IF NOT EXISTS "tenants" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'active',
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "stores" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "plans" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "enabled_modules" JSONB,
  "store_limit" INTEGER,
  "user_limit" INTEGER,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "licenses" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "plan_id" TEXT REFERENCES "plans"("id") ON DELETE SET NULL,
  "plan_code" TEXT,
  "license_key_hash" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "enabled_modules" JSONB,
  "store_limit" INTEGER,
  "user_limit" INTEGER,
  "expires_at" TIMESTAMP(3),
  "activated_at" TIMESTAMP(3),
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "license_sessions" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "license_id" TEXT NOT NULL REFERENCES "licenses"("id") ON DELETE CASCADE,
  "store_id" TEXT REFERENCES "stores"("id") ON DELETE SET NULL,
  "token_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "stores_tenant_id_idx" ON "stores"("tenant_id");
CREATE INDEX IF NOT EXISTS "licenses_tenant_id_idx" ON "licenses"("tenant_id");
CREATE INDEX IF NOT EXISTS "licenses_status_idx" ON "licenses"("status");
CREATE INDEX IF NOT EXISTS "license_sessions_tenant_id_idx" ON "license_sessions"("tenant_id");
CREATE INDEX IF NOT EXISTS "license_sessions_license_id_idx" ON "license_sessions"("license_id");
CREATE INDEX IF NOT EXISTS "license_sessions_token_hash_idx" ON "license_sessions"("token_hash");
CREATE INDEX IF NOT EXISTS "license_sessions_expires_at_idx" ON "license_sessions"("expires_at");

INSERT INTO "tenants" ("id", "name", "slug", "status", "payload")
VALUES ('tenant_main_shelfio', 'Mevcut Shelfio Sistemi', 'main-shelfio', 'active', '{"system":"main"}'::jsonb)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "slug" = EXCLUDED."slug",
  "status" = EXCLUDED."status",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "stores" ("id", "tenant_id", "name", "code", "status", "payload")
VALUES ('store-main', 'tenant_main_shelfio', 'Ana Mağaza', 'MAIN', 'active', '{"system":"main"}'::jsonb)
ON CONFLICT ("id") DO UPDATE SET
  "tenant_id" = EXCLUDED."tenant_id",
  "name" = EXCLUDED."name",
  "code" = EXCLUDED."code",
  "status" = EXCLUDED."status",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "plans" ("id", "code", "name", "enabled_modules", "store_limit", "user_limit", "payload")
VALUES (
  'plan_enterprise_main',
  'enterprise',
  'Kurumsal',
  '["products","stock","stock_batches","stock_movements","sales","customers","settings","notifications","campaigns","suppliers","purchase_orders","esl","tasks","reports","warehouse","proximity","pos","procurement","users","permissions","support"]'::jsonb,
  50,
  500,
  '{"system":"main"}'::jsonb
)
ON CONFLICT ("id") DO UPDATE SET
  "code" = EXCLUDED."code",
  "name" = EXCLUDED."name",
  "enabled_modules" = EXCLUDED."enabled_modules",
  "store_limit" = EXCLUDED."store_limit",
  "user_limit" = EXCLUDED."user_limit",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "licenses" (
  "id",
  "tenant_id",
  "plan_id",
  "plan_code",
  "license_key_hash",
  "status",
  "enabled_modules",
  "store_limit",
  "user_limit",
  "activated_at",
  "payload"
)
VALUES (
  'license_main_shelfio_2026',
  'tenant_main_shelfio',
  'plan_enterprise_main',
  'enterprise',
  'f8d3d76711199d1a87a0ad2ebc5343f6ed8339e54ceea16cc5d54e616534b8ef',
  'active',
  '["products","stock","stock_batches","stock_movements","sales","customers","settings","notifications","campaigns","suppliers","purchase_orders","esl","tasks","reports","warehouse","proximity","pos","procurement","users","permissions","support"]'::jsonb,
  50,
  500,
  CURRENT_TIMESTAMP,
  '{"label":"SHELFIO-MAIN-2026","system":"main"}'::jsonb
)
ON CONFLICT ("id") DO UPDATE SET
  "tenant_id" = EXCLUDED."tenant_id",
  "plan_id" = EXCLUDED."plan_id",
  "plan_code" = EXCLUDED."plan_code",
  "status" = EXCLUDED."status",
  "enabled_modules" = EXCLUDED."enabled_modules",
  "store_limit" = EXCLUDED."store_limit",
  "user_limit" = EXCLUDED."user_limit",
  "updated_at" = CURRENT_TIMESTAMP;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users',
    'categories',
    'sections',
    'suppliers',
    'products',
    'temporary_price_actions',
    'product_price_events',
    'stocks',
    'stock_batches',
    'stock_movements',
    'warehouse_locations',
    'warehouse_movements',
    'supplier_products',
    'purchase_suggestions',
    'purchase_orders',
    'purchase_order_status_history',
    'purchase_order_activity_logs',
    'purchase_order_items',
    'sales',
    'sale_items',
    'daily_store_closings',
    'customers',
    'customer_password_reset_tokens',
    'customer_orders',
    'tasks',
    'task_comments',
    'notifications',
    'stock_transfer_requests',
    'stock_transfer_request_audits',
    'esl_devices',
    'esl_history',
    'beacon_devices',
    'location_zones',
    'proximity_events',
    'notification_rules',
    'notification_deliveries',
    'settings',
    'access_requests',
    'temporary_permission_grants',
    'access_audit_logs',
    'audit_logs',
    'login_activity_logs',
    'catalog_imports',
    'supplier_catalog_versions',
    'support_tickets'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT %L', table_name, 'tenant_main_shelfio');
      EXECUTE format('UPDATE %I SET tenant_id = %L WHERE tenant_id IS NULL OR tenant_id = ''''', table_name, 'tenant_main_shelfio');
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)', table_name || '_tenant_id_idx', table_name);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    UPDATE "users" SET "store_id" = 'store-main' WHERE "store_id" IS NULL OR "store_id" = '';
  END IF;
  IF to_regclass('public.daily_store_closings') IS NOT NULL THEN
    UPDATE "daily_store_closings" SET "store_id" = 'store-main' WHERE "store_id" IS NULL OR "store_id" = '';
  END IF;
  IF to_regclass('public.access_requests') IS NOT NULL THEN
    UPDATE "access_requests" SET "store_id" = 'store-main' WHERE "store_id" IS NULL OR "store_id" = '';
  END IF;
  IF to_regclass('public.temporary_permission_grants') IS NOT NULL THEN
    UPDATE "temporary_permission_grants" SET "store_id" = 'store-main' WHERE "store_id" IS NULL OR "store_id" = '';
  END IF;
END $$;
