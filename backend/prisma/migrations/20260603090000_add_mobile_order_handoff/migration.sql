CREATE TABLE IF NOT EXISTS mobile_orders (
  id text PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'tenant_main_shelfio',
  store_id text NULL,
  customer_id text NULL,
  code text NOT NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending_cashier',
  subtotal_snapshot numeric(14, 4) NULL,
  total_snapshot numeric(14, 4) NULL,
  item_count integer NOT NULL DEFAULT 0,
  expires_at timestamp(3) NOT NULL,
  pulled_at timestamp(3) NULL,
  completed_at timestamp(3) NULL,
  cancelled_at timestamp(3) NULL,
  payload jsonb NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mobile_order_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id text NOT NULL DEFAULT 'tenant_main_shelfio',
  mobile_order_id text NOT NULL,
  product_id text NULL,
  sku text NULL,
  barcode text NULL,
  product_name_snapshot text NULL,
  quantity integer NOT NULL,
  unit_price_snapshot numeric(14, 4) NULL,
  total_price_snapshot numeric(14, 4) NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mobile_orders_customer_id_fkey'
  ) THEN
    ALTER TABLE mobile_orders
      ADD CONSTRAINT mobile_orders_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mobile_order_items_mobile_order_id_fkey'
  ) THEN
    ALTER TABLE mobile_order_items
      ADD CONSTRAINT mobile_order_items_mobile_order_id_fkey
      FOREIGN KEY (mobile_order_id) REFERENCES mobile_orders(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mobile_order_items_product_id_fkey'
  ) THEN
    ALTER TABLE mobile_order_items
      ADD CONSTRAINT mobile_order_items_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS mobile_orders_tenant_id_code_key
ON mobile_orders (tenant_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS mobile_orders_token_hash_key
ON mobile_orders (token_hash);

CREATE INDEX IF NOT EXISTS mobile_orders_tenant_id_store_id_status_idx
ON mobile_orders (tenant_id, store_id, status);

CREATE INDEX IF NOT EXISTS mobile_orders_customer_id_idx
ON mobile_orders (customer_id);

CREATE INDEX IF NOT EXISTS mobile_orders_expires_at_idx
ON mobile_orders (expires_at);

CREATE INDEX IF NOT EXISTS mobile_order_items_mobile_order_id_idx
ON mobile_order_items (mobile_order_id);

CREATE INDEX IF NOT EXISTS mobile_order_items_product_id_idx
ON mobile_order_items (product_id);
