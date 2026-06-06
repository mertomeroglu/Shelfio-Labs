CREATE TABLE IF NOT EXISTS "export_jobs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "license_id" TEXT,
  "external_license_id" TEXT NOT NULL,
  "external_tenant_id" TEXT,
  "requested_by_email" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "scope" TEXT NOT NULL DEFAULT 'tenant',
  "include_audit_logs" BOOLEAN NOT NULL DEFAULT false,
  "file_name" TEXT,
  "file_basename" TEXT,
  "download_token_hash" TEXT,
  "download_expires_at" TIMESTAMP(3),
  "download_count" INTEGER NOT NULL DEFAULT 0,
  "last_downloaded_at" TIMESTAMP(3),
  "request_id" TEXT,
  "callback_url" TEXT,
  "error_code" TEXT,
  "error_message" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "license_id" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "external_license_id" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "external_tenant_id" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "requested_by_email" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'tenant';
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "include_audit_logs" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "file_name" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "file_basename" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "download_token_hash" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "download_expires_at" TIMESTAMP(3);
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "download_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "last_downloaded_at" TIMESTAMP(3);
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "request_id" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "callback_url" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "error_code" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "error_message" TEXT;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "payload" JSONB;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(3);
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMP(3);
ALTER TABLE "export_jobs" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "export_jobs_download_token_hash_key" ON "export_jobs"("download_token_hash");
CREATE INDEX IF NOT EXISTS "export_jobs_tenant_id_idx" ON "export_jobs"("tenant_id");
CREATE INDEX IF NOT EXISTS "export_jobs_license_id_idx" ON "export_jobs"("license_id");
CREATE INDEX IF NOT EXISTS "export_jobs_status_idx" ON "export_jobs"("status");
CREATE INDEX IF NOT EXISTS "export_jobs_created_at_idx" ON "export_jobs"("created_at");
CREATE INDEX IF NOT EXISTS "export_jobs_download_expires_at_idx" ON "export_jobs"("download_expires_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_jobs_tenant_id_fkey'
  ) THEN
    ALTER TABLE "export_jobs"
      ADD CONSTRAINT "export_jobs_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_jobs_license_id_fkey'
  ) THEN
    ALTER TABLE "export_jobs"
      ADD CONSTRAINT "export_jobs_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
