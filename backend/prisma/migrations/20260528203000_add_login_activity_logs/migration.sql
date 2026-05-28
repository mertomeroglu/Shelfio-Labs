CREATE TABLE "login_activity_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "user_type" TEXT,
    "name" TEXT,
    "email" TEXT,
    "username" TEXT,
    "role" TEXT,
    "department" TEXT,
    "event_type" TEXT,
    "source" TEXT,
    "status" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "request_id" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "login_activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_activity_logs_created_at_idx" ON "login_activity_logs"("created_at");
CREATE INDEX "login_activity_logs_user_id_idx" ON "login_activity_logs"("user_id");
CREATE INDEX "login_activity_logs_user_type_idx" ON "login_activity_logs"("user_type");
CREATE INDEX "login_activity_logs_event_type_idx" ON "login_activity_logs"("event_type");
CREATE INDEX "login_activity_logs_source_idx" ON "login_activity_logs"("source");
CREATE INDEX "login_activity_logs_status_idx" ON "login_activity_logs"("status");
CREATE INDEX "login_activity_logs_ip_idx" ON "login_activity_logs"("ip");
