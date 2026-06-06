CREATE UNIQUE INDEX IF NOT EXISTS "temporary_price_actions_one_active_per_product_idx"
  ON "temporary_price_actions"("product_id")
  WHERE "status" = 'active';
