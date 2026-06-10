import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarDays,
  buildPurchaseSalesSignalsMap,
  getPurchaseSalesWindow,
} from '../src/domain/purchaseSuggestionDemand.js';

test('calendar day helper preserves negative offsets', () => {
  const base = new Date('2026-06-10T12:00:00.000Z');
  assert.equal(addCalendarDays(base, -29).toISOString(), '2026-05-12T12:00:00.000Z');
  assert.equal(addCalendarDays(base, 2).toISOString(), '2026-06-12T12:00:00.000Z');
});

test('purchase sales window covers 30 calendar days through the current instant', () => {
  const base = new Date('2026-06-10T12:00:00.000Z');
  const window = getPurchaseSalesWindow(base);
  assert.equal(window.start30.getFullYear(), 2026);
  assert.equal(window.start30.getMonth(), 4);
  assert.equal(window.start30.getDate(), 12);
  assert.equal(window.start30.getHours(), 0);
  assert.equal(window.end.toISOString(), base.toISOString());
});

test('sales signals include historical lookback rows and exclude future rows', () => {
  const base = new Date('2026-06-10T12:00:00.000Z');
  const window = getPurchaseSalesWindow(base);
  const sales = [
    {
      createdAt: window.start30.toISOString(),
      type: 'sale',
      items: [{ productId: 'p1', quantity: 3 }],
    },
    {
      createdAt: '2026-06-04T08:00:00.000Z',
      type: 'sale',
      items: [{ productId: 'p1', quantity: 7 }],
    },
    {
      createdAt: '2026-06-10T13:00:00.000Z',
      type: 'sale',
      items: [{ productId: 'p1', quantity: 100 }],
    },
    {
      createdAt: new Date(window.start30.getTime() - 1).toISOString(),
      type: 'sale',
      items: [{ productId: 'p1', quantity: 100 }],
    },
  ];

  const signals = buildPurchaseSalesSignalsMap(sales, base).get('p1');
  assert.equal(signals.sold30, 10);
  assert.equal(signals.sold7, 7);
});
