-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" TEXT,
    "assigned_desk_code" TEXT,
    "name" TEXT,
    "email" TEXT,
    "is_active" BOOLEAN,
    "last_login_at" TIMESTAMP(3),
    "register_pin" TEXT,
    "store_id" TEXT,
    "department" TEXT,
    "permissions" JSONB,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "main_section_no" INTEGER,
    "main_section_name" TEXT,
    "main_storage_type" TEXT,
    "requires_cold_chain" BOOLEAN,
    "requires_freezer" BOOLEAN,
    "is_active" BOOLEAN,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" TEXT NOT NULL,
    "number" INTEGER,
    "name" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "supplier_code" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "tedarikci_turu" TEXT,
    "website" TEXT,
    "minimum_order_qty" INTEGER,
    "minimum_order_case_qty" INTEGER,
    "covered_categories" JSONB,
    "delay_status" TEXT,
    "linked_product_count" INTEGER,
    "is_active" BOOLEAN,
    "categories" JSONB,
    "product_count" INTEGER,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "category_id" TEXT,
    "supplier_id" TEXT,
    "section_id" TEXT,
    "shelf_side" TEXT,
    "shelf_no" INTEGER,
    "shelf_level" INTEGER,
    "shelf_code" TEXT,
    "required_storage_type" TEXT,
    "unit" TEXT,
    "purchase_price" DECIMAL(14,4),
    "sale_price" DECIMAL(14,4),
    "etiket" TEXT,
    "placement_priority" TEXT,
    "average_desi" DECIMAL(12,3),
    "critical_stock" INTEGER,
    "max_shelf_stock" INTEGER,
    "max_stock" INTEGER,
    "units_per_case" INTEGER,
    "cases_per_pallet" INTEGER,
    "units_per_pallet" INTEGER,
    "minimum_order_case_qty" INTEGER,
    "is_listed" BOOLEAN,
    "register_on_order" BOOLEAN,
    "catalog_visibility" TEXT,
    "order_activated_status" TEXT,
    "is_active" BOOLEAN,
    "source_sheet" TEXT,
    "depot_assignment_type" TEXT,
    "depot_location_code" TEXT,
    "depot_zone_code" TEXT,
    "is_virtual_location" BOOLEAN,
    "capacity_mode" TEXT,
    "stocking_strategy" TEXT,
    "assignment_priority" INTEGER,
    "depot_location_label" TEXT,
    "default_warehouse_location_code" TEXT,
    "alternative_warehouse_location_codes" JSONB,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "price_updated_at" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocks" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "warehouse_quantity" INTEGER,
    "shelf_quantity" INTEGER,
    "quantity" INTEGER,
    "on_hand" INTEGER,
    "available" INTEGER,
    "reserved" INTEGER,
    "batch_count" INTEGER,
    "nearest_expiry" TEXT,
    "fefo_default_batch_no" TEXT,
    "fefo_default_expiry" TEXT,
    "payload" JSONB,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_batches" (
    "id" TEXT NOT NULL,
    "stock_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "batch_no" TEXT NOT NULL,
    "skt" TEXT,
    "warehouse_quantity" INTEGER,
    "shelf_quantity" INTEGER,
    "total_quantity" INTEGER,
    "status" TEXT,
    "payload" JSONB,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "product_id" TEXT,
    "supplier_id" TEXT,
    "product_name" TEXT,
    "sku" TEXT,
    "type" TEXT,
    "qty" INTEGER,
    "previous_quantity" INTEGER,
    "next_quantity" INTEGER,
    "previous_total_quantity" INTEGER,
    "next_total_quantity" INTEGER,
    "location" TEXT,
    "from_location" TEXT,
    "to_location" TEXT,
    "reason_code" TEXT,
    "reason_label" TEXT,
    "reference_no" TEXT,
    "transfer_request_id" TEXT,
    "user_id" TEXT,
    "user_name" TEXT,
    "batch_no" TEXT,
    "skt" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_locations" (
    "id" TEXT NOT NULL,
    "row_no" INTEGER,
    "side" TEXT,
    "shelf_no" INTEGER,
    "level_no" INTEGER,
    "location_code" TEXT,
    "storage_type" TEXT,
    "status" TEXT,
    "product_id" TEXT,
    "product_name" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "supplier_id" TEXT,
    "supplier_name" TEXT,
    "batch_no" TEXT,
    "skt" TEXT,
    "pallet_count" INTEGER,
    "pallet_capacity" INTEGER,
    "occupancy" DECIMAL(8,3),
    "warehouse_stock" INTEGER,
    "is_reserved" BOOLEAN,
    "is_blocked" BOOLEAN,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_movements" (
    "id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "supplier_id" TEXT,
    "supplier_name" TEXT,
    "location_id" TEXT,
    "location_code" TEXT,
    "batch_no" TEXT,
    "skt" TEXT,
    "movement_type" TEXT,
    "qty" INTEGER,
    "created_by" TEXT,
    "created_by_name" TEXT,
    "description" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "warehouse_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_products" (
    "id" TEXT NOT NULL,
    "product_id" TEXT,
    "supplier_id" TEXT,
    "supplier_product_code" TEXT,
    "supplier_product_name" TEXT,
    "supplier_sku" TEXT,
    "barcode" TEXT,
    "purchase_price" DECIMAL(14,4),
    "currency" TEXT,
    "minimum_order_qty" INTEGER,
    "min_order_qty" INTEGER,
    "lead_time_days" INTEGER,
    "is_default" BOOLEAN,
    "is_active" BOOLEAN,
    "source" TEXT,
    "price_unit" TEXT,
    "min_order_unit" TEXT,
    "default_order_unit" TEXT,
    "units_per_case" INTEGER,
    "cases_per_pallet" INTEGER,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_suggestions" (
    "id" TEXT NOT NULL,
    "product_id" TEXT,
    "category_id" TEXT,
    "supplier_id" TEXT,
    "current_stock" INTEGER,
    "critical_stock" INTEGER,
    "suggested_qty" INTEGER,
    "unit_price" DECIMAL(14,4),
    "total_price" DECIMAL(14,4),
    "status" TEXT,
    "reason" TEXT,
    "risk_level" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "purchase_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT,
    "supplier_id" TEXT,
    "source" TEXT,
    "status" TEXT,
    "current_status" TEXT,
    "currency" TEXT,
    "subtotal_amount" DECIMAL(14,4),
    "tax_amount" DECIMAL(14,4),
    "shipping_fee" DECIMAL(14,4),
    "discount_amount" DECIMAL(14,4),
    "grand_total" DECIMAL(14,4),
    "total_amount" DECIMAL(14,4),
    "delivery_status" TEXT,
    "goods_receipt_completed" BOOLEAN,
    "stock_entry_mode" TEXT,
    "stock_entry_completed" BOOLEAN,
    "archived" BOOLEAN,
    "created_by" TEXT,
    "warehouse_city" TEXT,
    "delivery_location" TEXT,
    "order_reason" TEXT,
    "priority" TEXT,
    "logistics_provider" TEXT,
    "tracking_no" TEXT,
    "estimated_delivery_date" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_status_history" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" TEXT,
    "at" TIMESTAMP(3),
    "by" TEXT,
    "note" TEXT,
    "payload" JSONB,

    CONSTRAINT "purchase_order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_activity_logs" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" TEXT,
    "status" TEXT,
    "at" TIMESTAMP(3),
    "by" TEXT,
    "note" TEXT,
    "payload" JSONB,

    CONSTRAINT "purchase_order_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT,
    "product_id" TEXT,
    "quantity" INTEGER,
    "unit_price" DECIMAL(14,4),
    "total_price" DECIMAL(14,4),
    "unit" TEXT,
    "tax_rate" DECIMAL(8,4),
    "tax_amount" DECIMAL(14,4),
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "reference_no" TEXT,
    "type" TEXT,
    "desk_code" TEXT,
    "cashier_id" TEXT,
    "cashier_name" TEXT,
    "items" JSONB,
    "subtotal" DECIMAL(14,4),
    "discount" DECIMAL(14,4),
    "total_amount" DECIMAL(14,4),
    "payment_method" TEXT,
    "payments" JSONB,
    "original_sale_ref" TEXT,
    "status" TEXT,
    "customer" JSONB,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "product_id" TEXT,
    "barcode" TEXT,
    "name" TEXT,
    "sku" TEXT,
    "quantity" INTEGER,
    "vat_rate" DECIMAL(8,4),
    "unit_price" DECIMAL(14,4),
    "total_price" DECIMAL(14,4),
    "payload" JSONB,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "customer_no" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "password_hash" TEXT,
    "total_orders" INTEGER,
    "total_spent" DECIMAL(14,4),
    "is_active" BOOLEAN,
    "discounts" JSONB,
    "gift_cards" JSONB,
    "city" TEXT,
    "district" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_orders" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT,
    "total_amount" DECIMAL(14,4),
    "items" JSONB,
    "status" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "customer_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "task_no" TEXT,
    "title" TEXT,
    "description" TEXT,
    "assigned_to" TEXT,
    "priority" TEXT,
    "due_date" TEXT,
    "status" TEXT,
    "comments" JSONB,
    "created_by" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "text" TEXT,
    "author_id" TEXT,
    "author_name" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" TEXT,
    "title" TEXT,
    "message" TEXT,
    "severity" TEXT,
    "is_read" BOOLEAN,
    "related_task_id" TEXT,
    "dedupe_key" TEXT,
    "action_url" TEXT,
    "action_type" TEXT,
    "audience" JSONB,
    "delivery" JSONB,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "created_by" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_requests" (
    "id" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "section_id" TEXT,
    "section_name" TEXT,
    "section_number" INTEGER,
    "source_location" TEXT,
    "target_location" TEXT,
    "quantity" INTEGER,
    "warehouse_stock_snapshot" INTEGER,
    "shelf_stock_snapshot" INTEGER,
    "status" TEXT,
    "priority" TEXT,
    "requested_by" TEXT,
    "requested_by_name" TEXT,
    "handled_by" TEXT,
    "handled_by_name" TEXT,
    "note" TEXT,
    "handled_note" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "stock_transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_audits" (
    "id" TEXT NOT NULL,
    "transfer_request_id" TEXT,
    "from_status" TEXT,
    "to_status" TEXT,
    "note" TEXT,
    "actor_id" TEXT,
    "actor_name" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "transfer_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esl_devices" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "mac_address" TEXT,
    "model" TEXT,
    "firmware_version" TEXT,
    "battery_level" INTEGER,
    "status" TEXT,
    "assigned_product_id" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "location" TEXT,
    "ip_address" TEXT,
    "is_deleted" BOOLEAN,
    "deleted_at" TIMESTAMP(3),
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "esl_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esl_history" (
    "id" TEXT NOT NULL,
    "device_id" TEXT,
    "device_name" TEXT,
    "product_id" TEXT,
    "product_name" TEXT,
    "product_sku" TEXT,
    "product_barcode" TEXT,
    "sale_price" DECIMAL(14,4),
    "template" TEXT,
    "custom_fields" JSONB,
    "status" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "esl_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "system_name" TEXT,
    "company_name" TEXT,
    "currency" TEXT,
    "timezone" TEXT,
    "payload" JSONB,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "store_id" TEXT,
    "permission" TEXT,
    "reason" TEXT,
    "requested_duration_minutes" INTEGER,
    "status" TEXT,
    "created_by" TEXT,
    "reviewed_by" TEXT,
    "assigned_to" TEXT,
    "review_note" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporary_permission_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "permission" TEXT,
    "store_id" TEXT,
    "request_id" TEXT,
    "status" TEXT,
    "approved_by" TEXT,
    "reason" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,

    CONSTRAINT "temporary_permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT,
    "user_id" TEXT,
    "permission" TEXT,
    "store_id" TEXT,
    "request_id" TEXT,
    "actor_id" TEXT,
    "actor_ip" TEXT,
    "metadata" JSONB,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "access_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_imports" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "supplier_name" TEXT,
    "file_name" TEXT,
    "uploaded_at" TIMESTAMP(3),
    "uploaded_by" TEXT,
    "status" TEXT,
    "validity_start" TIMESTAMP(3),
    "validity_end" TIMESTAMP(3),
    "summary" JSONB,
    "rows" JSONB,
    "required_approval" BOOLEAN,
    "columns_validated" BOOLEAN,
    "payload" JSONB,

    CONSTRAINT "catalog_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_catalog_versions" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "status" TEXT,
    "rows" JSONB,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "supplier_catalog_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "subject" TEXT,
    "description" TEXT,
    "user_id" TEXT,
    "user" TEXT,
    "role" TEXT,
    "page" TEXT,
    "browser" TEXT,
    "attachments" JSONB,
    "status" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sections_number_key" ON "sections"("number");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_supplier_id_idx" ON "products"("supplier_id");

-- CreateIndex
CREATE INDEX "products_section_id_idx" ON "products"("section_id");

-- CreateIndex
CREATE UNIQUE INDEX "stocks_product_id_key" ON "stocks"("product_id");

-- CreateIndex
CREATE INDEX "stocks_product_id_idx" ON "stocks"("product_id");

-- CreateIndex
CREATE INDEX "stock_batches_product_id_idx" ON "stock_batches"("product_id");

-- CreateIndex
CREATE INDEX "stock_batches_batch_no_skt_idx" ON "stock_batches"("batch_no", "skt");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_idx" ON "stock_movements"("product_id");

-- CreateIndex
CREATE INDEX "stock_movements_reference_no_idx" ON "stock_movements"("reference_no");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_locations_location_code_key" ON "warehouse_locations"("location_code");

-- CreateIndex
CREATE INDEX "supplier_products_product_id_supplier_id_idx" ON "supplier_products"("product_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_order_number_key" ON "purchase_orders"("order_number");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_orders_created_at_idx" ON "purchase_orders"("created_at");

-- CreateIndex
CREATE INDEX "purchase_order_status_history_order_id_idx" ON "purchase_order_status_history"("order_id");

-- CreateIndex
CREATE INDEX "purchase_order_status_history_status_idx" ON "purchase_order_status_history"("status");

-- CreateIndex
CREATE INDEX "purchase_order_status_history_at_idx" ON "purchase_order_status_history"("at");

-- CreateIndex
CREATE INDEX "purchase_order_activity_logs_order_id_idx" ON "purchase_order_activity_logs"("order_id");

-- CreateIndex
CREATE INDEX "purchase_order_activity_logs_type_idx" ON "purchase_order_activity_logs"("type");

-- CreateIndex
CREATE INDEX "purchase_order_activity_logs_status_idx" ON "purchase_order_activity_logs"("status");

-- CreateIndex
CREATE INDEX "purchase_order_activity_logs_at_idx" ON "purchase_order_activity_logs"("at");

-- CreateIndex
CREATE INDEX "purchase_order_items_order_id_idx" ON "purchase_order_items"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_reference_no_key" ON "sales"("reference_no");

-- CreateIndex
CREATE INDEX "sales_created_at_idx" ON "sales"("created_at");

-- CreateIndex
CREATE INDEX "sales_cashier_id_idx" ON "sales"("cashier_id");

-- CreateIndex
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "sale_items_product_id_idx" ON "sale_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_customer_no_key" ON "customers"("customer_no");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_task_no_key" ON "tasks"("task_no");

-- CreateIndex
CREATE INDEX "task_comments_task_id_idx" ON "task_comments"("task_id");

-- CreateIndex
CREATE INDEX "task_comments_author_id_idx" ON "task_comments"("author_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "esl_devices_mac_address_key" ON "esl_devices"("mac_address");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocks" ADD CONSTRAINT "stocks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_request_id_fkey" FOREIGN KEY ("transfer_request_id") REFERENCES "stock_transfer_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_movements" ADD CONSTRAINT "warehouse_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_suggestions" ADD CONSTRAINT "purchase_suggestions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_suggestions" ADD CONSTRAINT "purchase_suggestions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_suggestions" ADD CONSTRAINT "purchase_suggestions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_status_history" ADD CONSTRAINT "purchase_order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_status_history" ADD CONSTRAINT "purchase_order_status_history_by_fkey" FOREIGN KEY ("by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_activity_logs" ADD CONSTRAINT "purchase_order_activity_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_activity_logs" ADD CONSTRAINT "purchase_order_activity_logs_by_fkey" FOREIGN KEY ("by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_requests" ADD CONSTRAINT "stock_transfer_requests_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_requests" ADD CONSTRAINT "stock_transfer_requests_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_requests" ADD CONSTRAINT "stock_transfer_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_requests" ADD CONSTRAINT "stock_transfer_requests_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_audits" ADD CONSTRAINT "transfer_audits_transfer_request_id_fkey" FOREIGN KEY ("transfer_request_id") REFERENCES "stock_transfer_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_audits" ADD CONSTRAINT "transfer_audits_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esl_devices" ADD CONSTRAINT "esl_devices_assigned_product_id_fkey" FOREIGN KEY ("assigned_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esl_history" ADD CONSTRAINT "esl_history_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "esl_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esl_history" ADD CONSTRAINT "esl_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_permission_grants" ADD CONSTRAINT "temporary_permission_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_permission_grants" ADD CONSTRAINT "temporary_permission_grants_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "access_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_permission_grants" ADD CONSTRAINT "temporary_permission_grants_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporary_permission_grants" ADD CONSTRAINT "temporary_permission_grants_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_imports" ADD CONSTRAINT "catalog_imports_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
