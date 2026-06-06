import assert from 'node:assert/strict';
import test from 'node:test';

import { __reportServiceInternals } from '../src/services/reportService.js';

const { buildDashboardSmartAlerts, isPurchaseOrderOpenDeliveryOverdue } = __reportServiceInternals;

const NOW = new Date('2026-06-04T12:00:00.000Z');

const baseOrder = (overrides = {}) => ({
  id: overrides.id || 'order-open-late',
  orderNumber: overrides.orderNumber || 'PO-1',
  status: 'in_transit',
  estimatedDeliveryDate: '2026-06-03',
  supplier: { name: 'Test Supplier' },
  ...overrides,
});

test('dashboard delivery delay alert counts only open pre-delivery overdue orders', () => {
  const orders = [
    baseOrder({ id: 'open-late' }),
    baseOrder({ id: 'due-today', estimatedDeliveryDate: '2026-06-04' }),
    baseOrder({ id: 'no-date', estimatedDeliveryDate: null }),
    baseOrder({ id: 'completed', status: 'completed', completedAt: '2026-06-05T09:00:00.000Z' }),
    baseOrder({ id: 'cancelled', status: 'cancelled' }),
    baseOrder({ id: 'archived', status: 'archived', archived: true }),
    baseOrder({ id: 'goods-receipt', status: 'goods_receipt_pending' }),
    baseOrder({ id: 'stock-entry', status: 'stock_entry_pending', stockEntryCompleted: false }),
    baseOrder({ id: 'receipt-completed-flag', status: 'in_transit', goodsReceiptCompleted: true }),
  ];

  assert.equal(isPurchaseOrderOpenDeliveryOverdue(orders[0], NOW), true);
  assert.equal(isPurchaseOrderOpenDeliveryOverdue(orders[1], NOW), false);
  assert.equal(isPurchaseOrderOpenDeliveryOverdue(orders[2], NOW), false);
  assert.equal(isPurchaseOrderOpenDeliveryOverdue(orders[3], NOW), false);
  assert.equal(isPurchaseOrderOpenDeliveryOverdue(orders[4], NOW), false);
  assert.equal(isPurchaseOrderOpenDeliveryOverdue(orders[5], NOW), false);
  assert.equal(isPurchaseOrderOpenDeliveryOverdue(orders[6], NOW), false);
  assert.equal(isPurchaseOrderOpenDeliveryOverdue(orders[7], NOW), false);
  assert.equal(isPurchaseOrderOpenDeliveryOverdue(orders[8], NOW), false);

  const alerts = buildDashboardSmartAlerts({ purchaseOrders: orders, criticalItems: [], now: NOW });
  const deliveryDelay = alerts.find((alert) => alert.type === 'delivery_delay');

  assert.equal(deliveryDelay?.count, 1);
  assert.equal(deliveryDelay?.message, '1 açık sipariş planlanan teslim tarihini geçti.');
  assert.deepEqual(deliveryDelay?.entityIds, ['open-late']);
});
