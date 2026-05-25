import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExpiredBatchGroupDedupeKey,
  buildExpiredBatchGroupNotificationRecord,
} from '../src/services/expiredBatchNotificationService.js';

const NOW = new Date('2026-05-25T21:00:00.000Z');

const candidates = [
  {
    productId: 'p-1',
    sku: 'SKU-1',
    barcode: '111',
    productName: 'Yoğurt',
    batchNo: 'B-1',
    expiryDate: '2026-05-24',
    quantity: 8,
    shelfQuantity: 3,
    warehouseQuantity: 5,
    locationCode: 'A1',
    sourceKey: 'skt-expired:p-1:B-1:2026-05-24',
  },
  {
    productId: 'p-2',
    sku: 'SKU-2',
    barcode: '222',
    productName: 'Süt',
    batchNo: 'B-2',
    expiryDate: '2026-05-23',
    quantity: 4,
    shelfQuantity: 0,
    warehouseQuantity: 4,
    locationCode: 'B2',
    sourceKey: 'skt-expired:p-2:B-2:2026-05-23',
  },
];

test('builds one grouped expired batch notification with traceable item details', () => {
  const record = buildExpiredBatchGroupNotificationRecord(candidates, {
    userId: 'user-1',
    now: NOW,
    todayKey: '2026-05-26',
  });

  assert.equal(record.userId, 'user-1');
  assert.equal(record.type, 'skt_expired');
  assert.equal(record.dedupeKey, buildExpiredBatchGroupDedupeKey('2026-05-26'));
  assert.equal(record.title, '2 üründe SKT geçti');
  assert.equal(record.payload.isNotificationGroup, true);
  assert.equal(record.payload.entityType, 'notification_group');
  assert.equal(record.payload.groupReason, 'expired_batch_disposal_required');
  assert.equal(record.payload.itemCount, 2);
  assert.equal(record.payload.affectedProductCount, 2);
  assert.deepEqual(record.payload.sourceKeys, [
    'skt-expired:p-1:B-1:2026-05-24',
    'skt-expired:p-2:B-2:2026-05-23',
  ]);
  assert.equal(record.payload.items[0].productName, 'Yoğurt');
  assert.equal(record.payload.items[0].reason, 'expired_batch_disposal_required');
});

test('uses one dedupe key per daily expired batch job', () => {
  assert.equal(buildExpiredBatchGroupDedupeKey('2026-05-26'), 'skt-expired-group:2026-05-26');
});
