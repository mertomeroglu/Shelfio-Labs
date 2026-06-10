import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerOrderFromMobileOrder, subtractCompletedCartItems } from '../src/services/mobileOrderService.js';

test('completed mobile order subtracts only purchased quantities from the active cart', () => {
  const remaining = subtractCompletedCartItems(
    [
      { productId: 'p1', quantity: 3, productName: 'Bir' },
      { productId: 'p2', quantity: 2, productName: 'Iki' },
    ],
    [
      { productId: 'p1', quantity: 1 },
      { productId: 'p2', quantity: 2 },
    ]
  );

  assert.deepEqual(remaining, [
    { productId: 'p1', quantity: 2, productName: 'Bir' },
  ]);
});

test('completed mobile order leaves unrelated and later-added cart items intact', () => {
  const remaining = subtractCompletedCartItems(
    [
      { productId: 'p1', quantity: 2 },
      { productId: 'p3', quantity: 4 },
    ],
    [{ productId: 'p1', quantity: 1 }]
  );

  assert.deepEqual(remaining, [
    { productId: 'p1', quantity: 1 },
    { productId: 'p3', quantity: 4 },
  ]);
});

test('customer handoff history snapshot keeps identity, pricing, discount and customer references', () => {
  const source = {
    id: 'mobile-1',
    code: 'MBL-123456',
    customerId: 'customer-1',
    customer: { name: 'Ayşe Yılmaz', phone: '555', email: 'ayse@example.com' },
    status: 'customer_confirmed_handoff',
    subtotalSnapshot: 20,
    totalSnapshot: 16,
    expiresAt: new Date('2026-06-09T12:00:00.000Z'),
    createdAt: new Date('2026-06-09T10:00:00.000Z'),
    payload: {
      displayOrderNo: 'MOB-20260609-0001',
      itemPricing: {
        p1: {
          regularPrice: 10,
          discountedPrice: 8,
          hasActiveCampaign: true,
          campaignInfo: 'Yaz indirimi',
        },
      },
    },
    items: [{
      productId: 'p1',
      productNameSnapshot: 'Ürün',
      sku: 'SKU-1',
      barcode: '8690001',
      quantity: 2,
      unitPriceSnapshot: 8,
      totalPriceSnapshot: 16,
    }],
  };

  const order = buildCustomerOrderFromMobileOrder(source, {
    customerOrderId: 'mobile-order-mobile-1',
    now: '2026-06-09T10:01:00.000Z',
  });

  assert.equal(order.id, 'mobile-order-mobile-1');
  assert.equal(order.orderNo, 'MOB-20260609-0001');
  assert.equal(order.items[0].totalPrice, 16);
  assert.equal(order.items[0].discountAmount, 4);
  assert.equal(order.items[0].campaignName, 'Yaz indirimi');
  assert.equal(order.payload.customer.id, 'customer-1');
  assert.equal(order.payload.mobileOrderId, 'mobile-1');
});
