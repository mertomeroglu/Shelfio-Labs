ALTER TABLE "stock_transfer_requests"
  ADD COLUMN IF NOT EXISTS "origin" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT,
  ADD COLUMN IF NOT EXISTS "stock_transferred_at" TIMESTAMP(3);

ALTER TABLE "transfer_audits"
  ADD COLUMN IF NOT EXISTS "event" TEXT,
  ADD COLUMN IF NOT EXISTS "origin" TEXT;

CREATE INDEX IF NOT EXISTS "stock_transfer_requests_origin_status_idx"
  ON "stock_transfer_requests"("origin", "status");

CREATE INDEX IF NOT EXISTS "stock_transfer_requests_product_section_status_idx"
  ON "stock_transfer_requests"("product_id", "section_id", "status");
