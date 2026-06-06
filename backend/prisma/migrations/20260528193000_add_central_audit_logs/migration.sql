CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" TEXT,
    "actor_name" TEXT,
    "actor_role" TEXT,
    "actor_email" TEXT,
    "action" TEXT,
    "module" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "entity_label" TEXT,
    "method" TEXT,
    "endpoint" TEXT,
    "status_code" INTEGER,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "correlation_id" TEXT,
    "summary" TEXT,
    "metadata" JSONB,
    "severity" TEXT DEFAULT 'info',
    "source" TEXT DEFAULT 'user_action',
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");
CREATE INDEX "audit_logs_module_idx" ON "audit_logs"("module");
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX "audit_logs_source_idx" ON "audit_logs"("source");
CREATE INDEX "audit_logs_status_code_idx" ON "audit_logs"("status_code");
