import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { settingsService } from '../src/services/settingsService.js';
import { getModuleLabelTr } from '../../frontend/src/constants/moduleLabels.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDir, '..', '..');
const readProjectFile = (path) => readFileSync(resolve(projectRoot, path), 'utf8');

test('tenant-scoped unique indexes and store-scoped settings are declared', () => {
  const schema = readProjectFile('backend/prisma/schema.prisma');
  const migration = readProjectFile(
    'backend/prisma/migrations/20260601090000_store_scoped_settings_and_tenant_uniques/migration.sql'
  );

  assert.match(schema, /@@unique\(\[tenantId, username\]\)/);
  assert.match(schema, /@@unique\(\[tenantId, sku\]\)/);
  assert.match(schema, /@@unique\(\[tenantId, barcode\]\)/);
  assert.match(schema, /storeId\s+String\?\s+@map\("store_id"\)/);
  assert.match(schema, /@@unique\(\[tenantId, storeId\]\)/);

  assert.match(migration, /"settings_tenant_id_store_id_key"/);
  assert.match(migration, /"products_tenant_id_sku_key"/);
  assert.match(migration, /"products_tenant_id_barcode_key"/);
  assert.match(migration, /"users_tenant_id_username_key"/);
});

test('transfer audit tenant scope has an idempotent forward migration', () => {
  const schema = readProjectFile('backend/prisma/schema.prisma');
  const migration = readProjectFile(
    'backend/prisma/migrations/20260602100000_fix_transfer_audits_tenant_id/migration.sql'
  );
  const provider = readProjectFile('backend/src/providers/postgresProvider.js');

  assert.match(schema, /model TransferAudit\s*\{[\s\S]*tenantId\s+String[\s\S]*@map\("tenant_id"\)[\s\S]*@@map\("transfer_audits"\)/);
  assert.match(migration, /ALTER TABLE "transfer_audits"[\s\S]*ADD COLUMN IF NOT EXISTS "tenant_id" TEXT NOT NULL DEFAULT 'tenant_main_shelfio'/);
  assert.match(migration, /UPDATE "transfer_audits"[\s\S]*WHERE "tenant_id" IS NULL/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "transfer_audits_tenant_id_idx"[\s\S]*ON "transfer_audits" \("tenant_id"\)/);
  assert.match(provider, /'TransferAudit'/);
});

test('settings repository has no global default-row fallback', () => {
  const repository = readProjectFile('backend/src/repositories/postgresRepository.js');

  assert.doesNotMatch(repository, /setting\.findUnique\(\{\s*where:\s*\{\s*id:\s*'default'/);
  assert.match(repository, /where:\s*\{\s*tenantId,\s*storeId\s*\}/);
  assert.match(repository, /where:\s*\{\s*tenantId,\s*storeId:\s*null\s*\}/);
});

test('developer logs have no public route and require platform authority', async () => {
  const routes = readProjectFile('backend/src/routes/settingsRoutes.js');

  assert.doesNotMatch(routes, /developer-logs\/public/);
  await assert.rejects(
    settingsService.getDeveloperLogs({ role: 'admin', isSuperUser: false }),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    settingsService.clearLogs('developer', { role: 'admin', isSuperUser: false }),
    (error) => error.statusCode === 403
  );
});

test('known module keys have Turkish labels', () => {
  assert.equal(getModuleLabelTr('products'), 'Ürünler');
  assert.equal(getModuleLabelTr('users'), 'Personel Yönetimi');
  assert.equal(getModuleLabelTr('purchase_orders'), 'Sipariş Takibi / Sipariş Oluştur');
  assert.equal(getModuleLabelTr('campaign'), 'Kampanya Yönetimi');
});
