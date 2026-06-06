ALTER TABLE "transfer_audits"
  ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'tenant_main_shelfio';

UPDATE "transfer_audits"
SET "tenant_id" = 'tenant_main_shelfio'
WHERE "tenant_id" IS NULL;

CREATE INDEX IF NOT EXISTS "transfer_audits_tenant_id_idx"
  ON "transfer_audits" ("tenant_id");
