import {
  PRESET_FILTERS,
  applyPresetToFilters,
  buildEmptyStateBreakdown,
  buildRecommendationExplanation,
  classifyStockoutRisk,
  estimateStockoutDate,
  formatConfidenceScore,
  formatFormulaSummary,
  formatLastUpdated,
  getConfidenceScore,
  groupRecommendationsBySupplier,
  rowMatchesPreset,
  shouldAutoGenerateOnLoad,
  toggleAllSelectedRows,
  toggleSelectedRow,
} from '../purchase-suggestions/utils/purchaseSuggestionsUtils.js';

describe('OrderRecommendations calculations', () => {
  test('maps stockout risk classification correctly', () => {
    expect(classifyStockoutRisk(0)).toBe('critical');
    expect(classifyStockoutRisk(2)).toBe('critical');
    expect(classifyStockoutRisk(6)).toBe('high');
    expect(classifyStockoutRisk(10)).toBe('medium');
    expect(classifyStockoutRisk(20)).toBe('low');
  });

  test('formats recommendation explanation payload', () => {
    const explanation = buildRecommendationExplanation({
      sold7: 35,
      avgDailySales: 8,
      currentStock: 12,
      leadTimeDays: 8,
      minStock: 5,
      trendDirection: 'up',
    }, new Date('2026-04-17T00:00:00.000Z'));

    expect(explanation.formula.suggested).toBeGreaterThan(0);
    expect(explanation.estimatedStockoutDate).toBeTruthy();
    expect(explanation.riskDrivers.length).toBeGreaterThan(0);
    expect(explanation.summary).toBeTruthy();
  });

  test('stockout date uses per-product fallback instead of repeating same date', () => {
    expect(estimateStockoutDate({
      sold7: 0,
      avgDailySales: 0,
      currentStock: 100,
    }, new Date('2026-04-17T00:00:00.000Z'))).toBe('Düşük hareket / veri yetersiz');

    expect(estimateStockoutDate({
      sold7: 28,
      avgDailySales: 4,
      currentStock: 40,
      leadTimeDays: 6,
      minStock: 4,
    }, new Date('2026-04-17T00:00:00.000Z'))).not.toBe('Düşük hareket / veri yetersiz');
  });

  test('confidence score rendering and fallback behavior', () => {
    expect(formatConfidenceScore({ confidenceScore: 88 })).toBe('88%');
    expect(getConfidenceScore({ avgDailySales: 0, leadTimeDays: 0 })).toBeGreaterThanOrEqual(10);
    expect(formatConfidenceScore({ avgDailySales: 0, leadTimeDays: 0 })).toMatch(/%$/);
  });

  test('calculation formula visibility values', () => {
    const formula = formatFormulaSummary({
      avgDailySales: 5,
      leadTimeDays: 4,
      safetyStock: 10,
      currentStock: 7,
    });

    expect(formula.text).toContain('=');
    expect(formula.suggested).toBe(23);
  });

  test('empty-state reason mapping with edge cases', () => {
    const result = buildEmptyStateBreakdown({
      rows: [],
      products: [
        { id: '1', minStock: 0, criticalStock: 0, avgDailySales: 0, currentStock: 45 },
        { id: '2', minStock: 5, criticalStock: 5, avgDailySales: 4, currentStock: -3 },
        { id: '3', minStock: 2, criticalStock: 2, avgDailySales: 0, currentStock: 2 },
      ],
      supplierProducts: [
        { productId: '2', leadTimeDays: 12 },
      ],
      lookbackDays: 30,
    });

    expect(result.missingMinStock).toBe(1);
    expect(result.missingLeadTime).toBe(2);
    expect(result.noRecentSales).toBeGreaterThanOrEqual(2);
  });

  test('preset filters and matching logic', () => {
    const next = applyPresetToFilters({ riskLevel: '' }, PRESET_FILTERS.critical3);
    expect(next.riskLevel).toBe('critical');

    const row = { daysToStockout: 2, avgDailySales: 12, currentStock: 5 };
    expect(rowMatchesPreset(row, PRESET_FILTERS.critical3)).toBe(true);
    expect(rowMatchesPreset(row, PRESET_FILTERS.slowOrOverstock)).toBe(false);
  });

  test('supplier grouping handles duplicate names', () => {
    const grouped = groupRecommendationsBySupplier([
      { id: 'a', supplierId: 's1', supplierName: 'Ada Tedarik' },
      { id: 'b', supplierId: 's2', supplierName: 'Ada Tedarik' },
      { id: 'c', supplierId: 's1', supplierName: 'Ada Tedarik' },
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped.find((item) => item.supplierId === 's1')?.rows).toHaveLength(2);
  });

  test('bulk selection state logic', () => {
    const selected1 = toggleSelectedRow([], 'row-1', true);
    expect(selected1).toContain('row-1');

    const selected2 = toggleAllSelectedRows(selected1, [{ id: 'row-1' }, { id: 'row-2' }], true);
    expect(selected2).toEqual(expect.arrayContaining(['row-1', 'row-2']));

    const selected3 = toggleAllSelectedRows(selected2, [{ id: 'row-1' }, { id: 'row-2' }], false);
    expect(selected3).toHaveLength(0);
  });

  test('last updated formatter', () => {
    expect(formatLastUpdated('2026-04-17T09:20:00.000Z')).not.toBe('-');
    expect(formatLastUpdated('')).toBe('-');
  });

  test('auto-generation trigger guard', () => {
    expect(shouldAutoGenerateOnLoad({ hasTriggered: false, isGenerating: false })).toBe(true);
    expect(shouldAutoGenerateOnLoad({ hasTriggered: true, isGenerating: false })).toBe(false);
    expect(shouldAutoGenerateOnLoad({ hasTriggered: false, isGenerating: true })).toBe(false);
  });
});
