-- Search and filter indexes for PostgreSQL-backed list/search endpoints.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "idx_products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_products_sku_trgm" ON "products" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_products_barcode_trgm" ON "products" USING GIN ("barcode" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_products_listed_name_id" ON "products" ("is_listed", "name", "id");

CREATE INDEX IF NOT EXISTS "idx_purchase_orders_status_created_at" ON "purchase_orders" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_source_created_at" ON "purchase_orders" ("source", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_supplier_created_at" ON "purchase_orders" ("supplier_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_suppliers_name_trgm" ON "suppliers" USING GIN ("name" gin_trgm_ops);
