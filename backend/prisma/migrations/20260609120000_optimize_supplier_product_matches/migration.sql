-- Indexes for the /eslesmeler supplier-product matching page.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "idx_supplier_products_created_at_id" ON "supplier_products" ("created_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "idx_supplier_products_supplier_id" ON "supplier_products" ("supplier_id");
CREATE INDEX IF NOT EXISTS "idx_supplier_products_product_active" ON "supplier_products" ("product_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_supplier_products_supplier_active" ON "supplier_products" ("supplier_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_supplier_products_normalized_search_trgm" ON "supplier_products" USING GIN ("normalized_search" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_supplier_products_code_trgm" ON "supplier_products" USING GIN ("supplier_product_code" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_supplier_products_sku_trgm" ON "supplier_products" USING GIN ("supplier_sku" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_supplier_products_barcode_trgm" ON "supplier_products" USING GIN ("barcode" gin_trgm_ops);
