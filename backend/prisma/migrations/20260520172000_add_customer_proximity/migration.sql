CREATE TABLE IF NOT EXISTS "location_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "store_id" TEXT,
    "section_id" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_zones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "beacon_devices" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "device_code" TEXT NOT NULL,
    "uuid" TEXT,
    "major" INTEGER,
    "minor" INTEGER,
    "store_id" TEXT,
    "location_zone_id" TEXT,
    "section_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMP(3),
    "firmware_version" TEXT,
    "battery_level" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beacon_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "proximity_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_type" TEXT NOT NULL,
    "beacon_device_id" TEXT,
    "location_zone_id" TEXT,
    "device_code" TEXT,
    "uuid" TEXT,
    "major" INTEGER,
    "minor" INTEGER,
    "rssi" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3),
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proximity_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "location_zone_id" TEXT,
    "beacon_device_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "action_type" TEXT,
    "action_url" TEXT,
    "payload" JSONB,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 30,
    "max_per_visit" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_deliveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "notification_rule_id" TEXT,
    "proximity_event_id" TEXT,
    "notification_id" TEXT,
    "location_zone_id" TEXT,
    "beacon_device_id" TEXT,
    "status" TEXT NOT NULL,
    "skip_reason" TEXT,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE IF EXISTS "proximity_events" DROP CONSTRAINT IF EXISTS "proximity_events_user_id_fkey";
ALTER TABLE IF EXISTS "notification_deliveries" DROP CONSTRAINT IF EXISTS "notification_deliveries_user_id_fkey";

CREATE UNIQUE INDEX IF NOT EXISTS "location_zones_code_key" ON "location_zones"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "beacon_devices_device_code_key" ON "beacon_devices"("device_code");

CREATE INDEX IF NOT EXISTS "beacon_devices_uuid_major_minor_idx" ON "beacon_devices"("uuid", "major", "minor");
CREATE INDEX IF NOT EXISTS "beacon_devices_location_zone_id_idx" ON "beacon_devices"("location_zone_id");
CREATE INDEX IF NOT EXISTS "beacon_devices_section_id_idx" ON "beacon_devices"("section_id");
CREATE INDEX IF NOT EXISTS "beacon_devices_store_id_idx" ON "beacon_devices"("store_id");
CREATE INDEX IF NOT EXISTS "location_zones_type_idx" ON "location_zones"("type");
CREATE INDEX IF NOT EXISTS "location_zones_section_id_idx" ON "location_zones"("section_id");
CREATE INDEX IF NOT EXISTS "location_zones_store_id_idx" ON "location_zones"("store_id");
CREATE INDEX IF NOT EXISTS "proximity_events_user_id_created_at_idx" ON "proximity_events"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "proximity_events_beacon_device_id_created_at_idx" ON "proximity_events"("beacon_device_id", "created_at");
CREATE INDEX IF NOT EXISTS "proximity_events_location_zone_id_created_at_idx" ON "proximity_events"("location_zone_id", "created_at");
CREATE INDEX IF NOT EXISTS "proximity_events_device_code_idx" ON "proximity_events"("device_code");
CREATE INDEX IF NOT EXISTS "notification_rules_target_type_trigger_is_active_idx" ON "notification_rules"("target_type", "trigger", "is_active");
CREATE INDEX IF NOT EXISTS "notification_rules_location_zone_id_idx" ON "notification_rules"("location_zone_id");
CREATE INDEX IF NOT EXISTS "notification_rules_beacon_device_id_idx" ON "notification_rules"("beacon_device_id");
CREATE INDEX IF NOT EXISTS "notification_deliveries_user_id_notification_rule_id_created_at_idx" ON "notification_deliveries"("user_id", "notification_rule_id", "created_at");
CREATE INDEX IF NOT EXISTS "notification_deliveries_proximity_event_id_idx" ON "notification_deliveries"("proximity_event_id");
CREATE INDEX IF NOT EXISTS "notification_deliveries_dedupe_key_idx" ON "notification_deliveries"("dedupe_key");

ALTER TABLE "location_zones" ADD CONSTRAINT "location_zones_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "beacon_devices" ADD CONSTRAINT "beacon_devices_location_zone_id_fkey" FOREIGN KEY ("location_zone_id") REFERENCES "location_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "beacon_devices" ADD CONSTRAINT "beacon_devices_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "proximity_events" ADD CONSTRAINT "proximity_events_beacon_device_id_fkey" FOREIGN KEY ("beacon_device_id") REFERENCES "beacon_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "proximity_events" ADD CONSTRAINT "proximity_events_location_zone_id_fkey" FOREIGN KEY ("location_zone_id") REFERENCES "location_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_location_zone_id_fkey" FOREIGN KEY ("location_zone_id") REFERENCES "location_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_beacon_device_id_fkey" FOREIGN KEY ("beacon_device_id") REFERENCES "beacon_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_rule_id_fkey" FOREIGN KEY ("notification_rule_id") REFERENCES "notification_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_proximity_event_id_fkey" FOREIGN KEY ("proximity_event_id") REFERENCES "proximity_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_location_zone_id_fkey" FOREIGN KEY ("location_zone_id") REFERENCES "location_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_beacon_device_id_fkey" FOREIGN KEY ("beacon_device_id") REFERENCES "beacon_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
