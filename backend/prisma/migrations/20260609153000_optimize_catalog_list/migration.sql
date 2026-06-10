CREATE INDEX IF NOT EXISTS "catalog_imports_tenant_id_uploaded_at_idx"
  ON "catalog_imports" ("tenant_id", "uploaded_at");

CREATE INDEX IF NOT EXISTS "catalog_imports_tenant_id_supplier_id_status_idx"
  ON "catalog_imports" ("tenant_id", "supplier_id", "status");

CREATE INDEX IF NOT EXISTS "supplier_catalog_versions_tenant_id_created_at_idx"
  ON "supplier_catalog_versions" ("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "supplier_catalog_versions_tenant_id_supplier_id_status_idx"
  ON "supplier_catalog_versions" ("tenant_id", "supplier_id", "status");

CREATE INDEX IF NOT EXISTS "supplier_products_tenant_supplier_active_idx"
  ON "supplier_products" ("tenant_id", "supplier_id", "is_active");

CREATE INDEX IF NOT EXISTS "supplier_products_tenant_supplier_code_idx"
  ON "supplier_products" ("tenant_id", "supplier_id", "supplier_product_code");

CREATE INDEX IF NOT EXISTS "supplier_products_tenant_supplier_barcode_idx"
  ON "supplier_products" ("tenant_id", "supplier_id", "barcode");
