ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "last_price_change_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_price_change_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_price_change_source" TEXT;

CREATE TABLE IF NOT EXISTS "product_price_events" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "previous_sale_price" DECIMAL(14,4),
  "sale_price" DECIMAL(14,4),
  "source" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3),

  CONSTRAINT "product_price_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_price_events_product_id_created_at_idx"
  ON "product_price_events"("product_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'product_price_events_product_id_fkey'
      AND table_name = 'product_price_events'
  ) THEN
    ALTER TABLE "product_price_events"
      ADD CONSTRAINT "product_price_events_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "product_price_events" ("id", "product_id", "sale_price", "source", "payload", "created_at")
SELECT
  'legacy-price-updated-at-' || "id",
  "id",
  "sale_price",
  'legacy_price_updated_at',
  jsonb_build_object('sourceField', 'priceUpdatedAt'),
  "price_updated_at"
FROM "products"
WHERE "price_updated_at" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "product_price_events" e
    WHERE e."product_id" = "products"."id"
  );

UPDATE "products" p
SET
  "last_price_change_date" = latest."created_at",
  "last_price_change_at" = latest."created_at",
  "last_price_change_source" = latest."source"
FROM (
  SELECT DISTINCT ON ("product_id")
    "product_id",
    "created_at",
    "source"
  FROM "product_price_events"
  WHERE "created_at" IS NOT NULL
  ORDER BY "product_id", "created_at" DESC
) latest
WHERE p."id" = latest."product_id";
