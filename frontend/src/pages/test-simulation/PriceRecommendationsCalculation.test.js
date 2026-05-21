import {
  PRICE_PRESETS,
  buildReasonSummary,
  calculateDiscountPercent,
  calculateMarginPercent,
  classifyActionType,
  classifyExpirationRisk,
  estimateImpact,
  mapEmptyStateReason,
  rowMatchesPricePreset,
  toggleAllIds,
  toggleSelectedIds,
} from '../pricing-analysis/utils/pricingRecommendationsUtils.js';

describe('PriceRecommendations calculations', () => {
  test('discount and margin calculations stay stable', () => {
    expect(calculateDiscountPercent(100, 80)).toBe(20);
    expect(calculateMarginPercent(100, 62)).toBe(38);
    expect(calculateMarginPercent(0, 10)).toBeNull();
  });

  test('expiration risk and action type classification', () => {
    expect(classifyExpirationRisk(2)).toBe('critical');
    expect(classifyExpirationRisk(8)).toBe('soon');
    expect(classifyExpirationRisk(20)).toBe('safe');

    expect(classifyActionType({ discountPercent: 0, expirationRisk: 'safe', salesVelocity: 4, stock: 5 })).toBe('keep');
    expect(classifyActionType({ discountPercent: 12, expirationRisk: 'safe', salesVelocity: 2, stock: 10 })).toBe('discount');
    expect(classifyActionType({ discountPercent: 8, expirationRisk: 'critical', salesVelocity: 1, stock: 40 })).toBe('urgent');
  });

  test('impact estimation returns signed revenue and profit impact', () => {
    const impact = estimateImpact({
      currentPrice: 120,
      cost: 80,
      stock: 55,
      salesVelocity: 1.2,
      discountPercent: 25,
    });

    expect(impact.expectedSales).toBeGreaterThan(1.2);
    expect(impact.estimatedSalesIncreasePct).toBeGreaterThan(0);
    expect(Number.isFinite(impact.revenueImpact)).toBe(true);
    expect(Number.isFinite(impact.profitImpact)).toBe(true);
  });

  test('preset matcher and empty state reason mapping', () => {
    const row = { daysToExpiry: 4, salesVelocity: 0.5, stockLevel: 60, currentMarginPercent: 35 };

    expect(rowMatchesPricePreset(row, PRICE_PRESETS.nearExpiry)).toBe(true);
    expect(rowMatchesPricePreset(row, PRICE_PRESETS.slowSelling)).toBe(true);
    expect(rowMatchesPricePreset(row, PRICE_PRESETS.overstocked)).toBe(true);
    expect(rowMatchesPricePreset(row, PRICE_PRESETS.highMargin)).toBe(true);

    const reason = mapEmptyStateReason({ rows: [], filters: { sktStatus: 'critical' } });
    expect(reason.title).toContain('SKT');
  });

  test('reason summary and row selection helpers', () => {
    const summary = buildReasonSummary({
      daysToExpiry: 6,
      stock: 54,
      salesVelocity: 0.6,
      stockTurnoverRate: 0.2,
      suggestedDiscount: 22,
    });
    expect(summary).toContain('indirim');

    const selectedOne = toggleSelectedIds([], 'p1', true);
    expect(selectedOne).toEqual(['p1']);

    const selectedMany = toggleAllIds(selectedOne, [{ id: 'p1' }, { id: 'p2' }], true);
    expect(selectedMany).toEqual(expect.arrayContaining(['p1', 'p2']));
  });
});
