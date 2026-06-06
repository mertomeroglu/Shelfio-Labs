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
      { totalQuantity: { gt: 0 } },
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
