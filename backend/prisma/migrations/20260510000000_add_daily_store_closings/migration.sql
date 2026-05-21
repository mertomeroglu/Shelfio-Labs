CREATE TABLE IF NOT EXISTS "daily_store_closings" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "sales_count" INTEGER NOT NULL DEFAULT 0,
    "return_count" INTEGER NOT NULL DEFAULT 0,
    "transaction_count" INTEGER NOT NULL DEFAULT 0,
    "gross_sales_amount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "return_amount" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "net_revenue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_store_closings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "daily_store_closings_store_id_business_date_key"
    ON "daily_store_closings"("store_id", "business_date");

CREATE INDEX IF NOT EXISTS "daily_store_closings_business_date_idx"
    ON "daily_store_closings"("business_date");
