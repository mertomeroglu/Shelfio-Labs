ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "store_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'settings_store_id_fkey'
      AND conrelid = 'settings'::regclass
  ) THEN
    ALTER TABLE "settings"
      ADD CONSTRAINT "settings_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "settings_store_id_idx" ON "settings"("store_id");
CREATE UNIQUE INDEX IF NOT EXISTS "settings_tenant_id_store_id_key"
  ON "settings"("tenant_id", "store_id");

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'products'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) IN ('UNIQUE (sku)', 'UNIQUE (barcode)')
  LOOP
    EXECUTE format('ALTER TABLE "products" DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (username)'
  LOOP
    EXECUTE format('ALTER TABLE "users" DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

DROP INDEX IF EXISTS "products_sku_key";
DROP INDEX IF EXISTS "products_barcode_key";
DROP INDEX IF EXISTS "users_username_key";

CREATE UNIQUE INDEX IF NOT EXISTS "products_tenant_id_sku_key"
  ON "products"("tenant_id", "sku");
CREATE UNIQUE INDEX IF NOT EXISTS "products_tenant_id_barcode_key"
  ON "products"("tenant_id", "barcode");
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_id_username_key"
  ON "users"("tenant_id", "username");
