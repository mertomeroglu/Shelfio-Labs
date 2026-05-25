ALTER TABLE "daily_store_closings"
  ADD COLUMN IF NOT EXISTS "closing_type" TEXT NOT NULL DEFAULT 'official_daily_close',
  ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMP(3) NOT NULL DEFAULT now();

DROP INDEX IF EXISTS "daily_store_closings_store_id_business_date_key";

CREATE UNIQUE INDEX IF NOT EXISTS "daily_store_closings_official_daily_close_key"
  ON "daily_store_closings"("store_id", "business_date")
  WHERE "closing_type" = 'official_daily_close';

CREATE INDEX IF NOT EXISTS "daily_store_closings_store_date_type_idx"
  ON "daily_store_closings"("store_id", "business_date", "closing_type");
