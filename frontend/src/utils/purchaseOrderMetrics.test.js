import { describe, expect, it } from 'vitest';
import {
  buildOrderDatePreset,
  calculateLifecycleStageMetric,
  isOrderWithinDateBounds,
} from './purchaseOrderMetrics.js';

describe('purchase order date filters', () => {
  it('includes the full end date for today and last seven days', () => {
    const now = new Date('2026-06-08T15:30:00+03:00');
    const today = buildOrderDatePreset('today', now);
    const last7 = buildOrderDatePreset('last7', now);

    expect(isOrderWithinDateBounds('2026-06-08T23:59:59+03:00', today)).toBe(true);
    expect(isOrderWithinDateBounds('2026-06-02T00:00:00+03:00', last7)).toBe(true);
    expect(isOrderWithinDateBounds('2026-06-01T23:59:59+03:00', last7)).toBe(false);
  });

  it('uses an exact rolling window for the last 24 hours', () => {
    const now = new Date('2026-06-08T15:30:00+03:00');
    const filters = buildOrderDatePreset('last24', now);

    expect(isOrderWithinDateBounds('2026-06-07T15:30:00+03:00', filters)).toBe(true);
    expect(isOrderWithinDateBounds('2026-06-07T15:29:59+03:00', filters)).toBe(false);
  });
});

describe('purchase order lifecycle metrics', () => {
  it('counts a submitted order as an active approval stage', () => {
    const submittedAt = new Date('2026-06-08T09:00:00Z').getTime();
    const now = new Date('2026-06-08T12:00:00Z').getTime();
    const metric = calculateLifecycleStageMetric({
      orders: [{ status: 'submitted_for_approval', currentStatus: 'submitted_for_approval' }],
      startStatus: 'submitted_for_approval',
      endStatus: 'approved',
      now,
      getStatusTimestamp: (_order, status) => (
        status === 'submitted_for_approval' ? submittedAt : Number.NaN
      ),
    });

    expect(metric.activeCount).toBe(1);
    expect(metric.sampleCount).toBe(1);
    expect(metric.averageHours).toBe(3);
  });

  it('ignores a stale approved timestamp while current status is still submitted', () => {
    const submittedAt = new Date('2026-06-08T09:00:00Z').getTime();
    const staleApprovedAt = new Date('2026-06-08T10:00:00Z').getTime();
    const now = new Date('2026-06-08T12:00:00Z').getTime();
    const metric = calculateLifecycleStageMetric({
      orders: [{ status: 'submitted_for_approval', currentStatus: 'submitted_for_approval' }],
      startStatus: 'submitted_for_approval',
      endStatus: 'approved',
      now,
      getStatusTimestamp: (_order, status) => (
        status === 'submitted_for_approval' ? submittedAt : staleApprovedAt
      ),
    });

    expect(metric.activeCount).toBe(1);
    expect(metric.completedCount).toBe(0);
    expect(metric.averageHours).toBe(3);
  });
});
