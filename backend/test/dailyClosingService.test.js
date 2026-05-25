import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __dailyClosingInternals,
} from '../src/services/dailyClosingService.js';

const {
  buildDailyClosingMetrics,
  buildDailyClosingPaymentBreakdown,
  addDaysToLocalDate,
  normalizeClosingType,
  OFFICIAL_DAILY_CLOSE,
  MANUAL_SNAPSHOT,
} = __dailyClosingInternals;

test('daily closing metrics creates a zero-activity closing shape', () => {
  const metrics = buildDailyClosingMetrics([]);

  assert.equal(metrics.salesCount, 0);
  assert.equal(metrics.returnCount, 0);
  assert.equal(metrics.transactionCount, 0);
  assert.equal(metrics.grossSalesAmount, 0);
  assert.equal(metrics.returnAmount, 0);
  assert.equal(metrics.netRevenue, 0);
  assert.equal(metrics.itemCount, 0);
});

test('daily closing metrics separates sales, returns, and cancelled rows', () => {
  const metrics = buildDailyClosingMetrics([
    { type: 'sale', status: 'completed', totalAmount: 120, items: [{ quantity: 2 }] },
    { type: 'return', status: 'completed', totalAmount: 20, items: [{ quantity: 1 }] },
    { type: 'sale', status: 'cancelled', totalAmount: 999, items: [{ quantity: 99 }] },
  ]);

  assert.equal(metrics.salesCount, 1);
  assert.equal(metrics.returnCount, 1);
  assert.equal(metrics.transactionCount, 2);
  assert.equal(metrics.grossSalesAmount, 120);
  assert.equal(metrics.returnAmount, 20);
  assert.equal(metrics.netRevenue, 100);
  assert.equal(metrics.itemCount, 3);
});

test('daily closing payment breakdown nets returns by method', () => {
  const breakdown = buildDailyClosingPaymentBreakdown([
    { type: 'sale', status: 'completed', payments: [{ method: 'cash', amount: 40 }, { method: 'card', amount: 60 }] },
    { type: 'return', status: 'completed', payments: [{ method: 'card', amount: 10 }] },
  ]);

  assert.equal(breakdown.cash, 40);
  assert.equal(breakdown.card, 50);
});

test('closing type normalization keeps official and manual records separate', () => {
  assert.equal(normalizeClosingType(OFFICIAL_DAILY_CLOSE), OFFICIAL_DAILY_CLOSE);
  assert.equal(normalizeClosingType(MANUAL_SNAPSHOT), MANUAL_SNAPSHOT);
  assert.equal(normalizeClosingType('manual_closing'), MANUAL_SNAPSHOT);
});

test('local business date helper advances dates without UTC string slicing logic', () => {
  assert.equal(addDaysToLocalDate('2026-05-25', 1), '2026-05-26');
  assert.equal(addDaysToLocalDate('2026-03-01', -1), '2026-02-28');
});
