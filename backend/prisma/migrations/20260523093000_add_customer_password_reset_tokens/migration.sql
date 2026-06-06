CREATE TABLE "customer_password_reset_tokens" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requested_ip" TEXT,
  "user_agent" TEXT,

  CONSTRAINT "customer_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_password_reset_tokens_token_hash_key" ON "customer_password_reset_tokens"("token_hash");
CREATE INDEX "customer_password_reset_tokens_customer_id_idx" ON "customer_password_reset_tokens"("customer_id");
CREATE INDEX "customer_password_reset_tokens_expires_at_idx" ON "customer_password_reset_tokens"("expires_at");

ALTER TABLE "customer_password_reset_tokens"
  ADD CONSTRAINT "customer_password_reset_tokens_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
