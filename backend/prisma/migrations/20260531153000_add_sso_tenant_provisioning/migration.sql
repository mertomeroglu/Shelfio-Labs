ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "external_tenant_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_external_tenant_id_key"
  ON "tenants"("external_tenant_id");

ALTER TABLE "licenses"
  ADD COLUMN IF NOT EXISTS "external_license_id" TEXT,
  ADD COLUMN IF NOT EXISTS "external_tenant_id" TEXT,
  ADD COLUMN IF NOT EXISTS "license_owner_email" TEXT,
  ADD COLUMN IF NOT EXISTS "external_plan" TEXT,
  ADD COLUMN IF NOT EXISTS "external_status" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "licenses_external_license_id_key"
  ON "licenses"("external_license_id");

CREATE TABLE IF NOT EXISTS "sso_setup_tokens" (
  "id" TEXT PRIMARY KEY,
  "token_hash" TEXT NOT NULL,
  "exchange_code_hash" TEXT NOT NULL,
  "local_license_id" TEXT REFERENCES "licenses"("id") ON DELETE SET NULL,
  "external_license_id" TEXT NOT NULL,
  "external_tenant_id" TEXT,
  "license_owner_email" TEXT NOT NULL,
  "license_plan" TEXT,
  "license_status" TEXT NOT NULL,
  "payload" JSONB,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "sso_setup_tokens_token_hash_key"
  ON "sso_setup_tokens"("token_hash");

CREATE UNIQUE INDEX IF NOT EXISTS "sso_setup_tokens_exchange_code_hash_key"
  ON "sso_setup_tokens"("exchange_code_hash");

CREATE INDEX IF NOT EXISTS "sso_setup_tokens_external_license_id_idx"
  ON "sso_setup_tokens"("external_license_id");

CREATE INDEX IF NOT EXISTS "sso_setup_tokens_expires_at_idx"
  ON "sso_setup_tokens"("expires_at");
