CREATE TABLE IF NOT EXISTS "temporary_price_actions" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "old_price" DECIMAL(14,4),
  "applied_price" DECIMAL(14,4) NOT NULL,
  "action_type" TEXT,
  "recommendation_type" TEXT,
  "risk_level" TEXT,
  "start_at" TIMESTAMP(3) NOT NULL,
  "end_at" TIMESTAMP(3) NOT NULL,
  "duration_days" INTEGER NOT NULL,
  "applied_by" TEXT,
  "applied_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "source_recommendation_key" TEXT,
  "price_event_id" TEXT,
  "revert_at" TIMESTAMP(3),
  "reverted_at" TIMESTAMP(3),
  "notes" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "temporary_price_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "temporary_price_actions_status_end_at_idx" ON "temporary_price_actions"("status", "end_at");
CREATE INDEX IF NOT EXISTS "temporary_price_actions_product_id_status_idx" ON "temporary_price_actions"("product_id", "status");
CREATE INDEX IF NOT EXISTS "temporary_price_actions_source_recommendation_key_idx" ON "temporary_price_actions"("source_recommendation_key");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'temporary_price_actions_product_id_fkey'
  ) THEN
    ALTER TABLE "temporary_price_actions"
      ADD CONSTRAINT "temporary_price_actions_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
