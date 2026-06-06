-- Supports tenant-scoped SKT list, summary and chart read-model queries.
CREATE INDEX IF NOT EXISTS "stock_batches_tenant_id_skt_idx"
  ON "stock_batches" ("tenant_id", "skt");

CREATE INDEX IF NOT EXISTS "stock_batches_tenant_id_skt_positive_qty_idx"
  ON "stock_batches" ("tenant_id", "skt")
  WHERE COALESCE("total_quantity", 0) > 0
     OR COALESCE("warehouse_quantity", 0) > 0
     OR COALESCE("shelf_quantity", 0) > 0;
