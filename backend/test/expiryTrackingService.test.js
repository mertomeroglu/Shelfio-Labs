import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildActiveExpiryBatchWhere } from '../src/services/expiryTrackingService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

test('expiry candidate query filters positive listed stock batches in SQL', () => {
  assert.deepEqual(buildActiveExpiryBatchWhere({
    today: '2026-06-02',
    expiredOnly: true,
    includeToday: true,
  }), {
    OR: [
      { warehouseQuantity: { gt: 0 } },
      { shelfQuantity: { gt: 0 } },
    ],
    skt: { lte: '2026-06-02' },
    stock: {
      product: {
        isActive: { not: false },
        isListed: { not: false },
      },
    },
  });
});

test('SKT page uses the dedicated read-model without full stock or product fetches', () => {
  const page = fs.readFileSync(path.join(root, 'frontend/src/pages/stock-expiry-tracking/StockExpiryTracking.jsx'), 'utf8');
  assert.match(page, /stockService\.getExpiryTracking\(/);
  assert.doesNotMatch(page, /stockService\.getStocks\(/);
  assert.doesNotMatch(page, /productService\.list\(/);
  assert.doesNotMatch(page, /fetchAll\s*:/);
  assert.doesNotMatch(page, /buildExpiryRows/);
});

test('expiry tracking migration adds tenant SKT and positive-quantity indexes', () => {
  const migration = fs.readFileSync(
    path.join(root, 'backend/prisma/migrations/20260602090000_add_stock_batch_expiry_tracking_indexes/migration.sql'),
    'utf8'
  );
  assert.match(migration, /stock_batches_tenant_id_skt_idx/);
  assert.match(migration, /stock_batches_tenant_id_skt_positive_qty_idx/);
  assert.match(migration, /WHERE COALESCE\("total_quantity", 0\) > 0/);
});

test('expiry UI and service do not report zero-quantity disposal as success', () => {
  const page = fs.readFileSync(path.join(root, 'frontend/src/pages/stock-expiry-tracking/StockExpiryTracking.jsx'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'backend/src/services/stockService.js'), 'utf8');
  const readModel = fs.readFileSync(path.join(root, 'backend/src/services/expiryTrackingService.js'), 'utf8');

  assert.match(page, /disposedCount <= 0/);
  assert.doesNotMatch(page, /disposedBatchCount \|\| targetRows\.length/);
  assert.match(service, /skippedBatchCount: skipped\.length/);
  assert.match(service, /prisma\.\$transaction/);
  assert.match(readModel, /warehouse_quantity, 0\) \+ COALESCE\(b\.shelf_quantity/);
});

test('disposal page uses customer-facing SKT group terminology', () => {
  const page = fs.readFileSync(path.join(root, 'frontend/src/pages/stock-expiry-tracking/StockExpiryTracking.jsx'), 'utf8');
  const visibleText = page.replace(/\b(batchNo|batch_no|batchId|disposedBatchCount|skippedBatchCount|disposeExpiredBatches)\b/g, '');
  assert.doesNotMatch(visibleText, /\b(batch|lot-level|parti)\b/i);
});

test('expiry read-model exposes only required SKT policy rows', () => {
  const readModel = fs.readFileSync(path.join(root, 'backend/src/services/expiryTrackingService.js'), 'utf8');

  assert.match(readModel, /const requiredOnly = \(row = \{\}\) => row\.sktPolicy === SKT_POLICIES\.REQUIRED/);
  assert.match(readModel, /expiredRequiredRows = expiredRawRows\.map\(mapRow\)\.filter\(requiredOnly\)/);
  assert.match(readModel, /trackingRequiredRows = trackingRawRows\.map\(mapRow\)\.filter\(requiredOnly\)/);
  assert.match(readModel, /sktPolicy\.policy === SKT_POLICIES\.REQUIRED\s+&& Number\(row\.totalQuantity \|\| 0\) > 0/);
});

test('expired disposal and notifications are limited to required SKT policy', () => {
  const service = fs.readFileSync(path.join(root, 'backend/src/services/stockService.js'), 'utf8');
  const notifications = fs.readFileSync(path.join(root, 'backend/src/services/expiredBatchNotificationService.js'), 'utf8');

  assert.match(service, /row\.sktPolicy === SKT_POLICIES\.REQUIRED/);
  assert.match(service, /sktPolicy\.policy !== SKT_POLICIES\.REQUIRED/);
  assert.match(notifications, /resolveSktPolicy/);
  assert.match(notifications, /sktPolicy\.policy !== SKT_POLICIES\.REQUIRED/);
  assert.match(notifications, /skt_policy_not_required/);
});

test('expiry frontend keeps a protective required-policy filter', () => {
  const page = fs.readFileSync(path.join(root, 'frontend/src/pages/stock-expiry-tracking/StockExpiryTracking.jsx'), 'utf8');

  assert.match(page, /const isRequiredSktRow = \(row\) => row\?\.sktPolicy === 'required'/);
  assert.match(page, /setExpiredRows\(\(Array\.isArray\(result\?\.expiredRows\)[\s\S]*?\.filter\(isRequiredSktRow\)\)/);
  assert.match(page, /setTrackingRows\(\(Array\.isArray\(result\?\.trackingRows\)[\s\S]*?\.filter\(isRequiredSktRow\)\)/);
  assert.doesNotMatch(page, /sktPolicy !== 'not_applicable'/);
});
