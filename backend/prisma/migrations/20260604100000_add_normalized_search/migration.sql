-- AlterTable categories
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "normalized_search" TEXT;

-- AlterTable suppliers
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "normalized_search" TEXT;

-- AlterTable products
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "normalized_search" TEXT;

-- AlterTable supplier_products
ALTER TABLE "supplier_products" ADD COLUMN IF NOT EXISTS "normalized_search" TEXT;

-- Backfill Categories
UPDATE "categories"
SET "normalized_search" = trim(both ' ' from regexp_replace(lower(translate(COALESCE("name", ''), 'ÇçĞğIıİÖöŞşÜü', 'ccggiiioossuu')), '[^a-z0-9]+', ' ', 'g'))
WHERE "normalized_search" IS NULL;

-- Backfill Suppliers
UPDATE "suppliers"
SET "normalized_search" = trim(both ' ' from regexp_replace(lower(translate(COALESCE("name", ''), 'ÇçĞğIıİÖöŞşÜü', 'ccggiiioossuu')), '[^a-z0-9]+', ' ', 'g'))
WHERE "normalized_search" IS NULL;

-- Backfill Products
UPDATE "products"
SET "normalized_search" = trim(both ' ' from regexp_replace(lower(translate(
  COALESCE("name", '') || ' ' || COALESCE("sku", '') || ' ' || COALESCE("barcode", '') || ' ' || COALESCE("brand", '') || ' ' || COALESCE("etiket", ''),
  'ÇçĞğIıİÖöŞşÜü', 'ccggiiioossuu'
)), '[^a-z0-9]+', ' ', 'g'))
WHERE "normalized_search" IS NULL;

-- Backfill Supplier Products
UPDATE "supplier_products"
SET "normalized_search" = trim(both ' ' from regexp_replace(lower(translate(
  COALESCE("supplier_product_name", '') || ' ' || COALESCE("supplier_sku", '') || ' ' || COALESCE("barcode", ''),
  'ÇçĞğIıİÖöŞşÜü', 'ccggiiioossuu'
)), '[^a-z0-9]+', ' ', 'g'))
WHERE "normalized_search" IS NULL;
