import test from 'node:test';
import assert from 'node:assert/strict';
import { __campaignAnalysisInternals } from '../src/services/campaignAnalysisService.js';

const { buildEnhancedSuggestionsFromRows } = __campaignAnalysisInternals;

const baseRow = (overrides = {}) => ({
  productId: overrides.productId || 'p-base',
  productName: overrides.productName || 'Test Product',
  categoryId: overrides.categoryId || 'cat-a',
  categoryName: overrides.categoryName || 'Category A',
  brand: overrides.brand || 'Brand A',
  totalStock: overrides.totalStock ?? 80,
  avgDailySales: overrides.avgDailySales ?? 1,
  criticalStock: overrides.criticalStock ?? 6,
  minimumStock: overrides.minimumStock ?? 8,
  maxStock: overrides.maxStock ?? 120,
  daysToExpiry: overrides.daysToExpiry ?? null,
  currentPrice: overrides.currentPrice ?? 100,
  purchasePrice: overrides.purchasePrice ?? 60,
  suggestedDiscount: overrides.suggestedDiscount ?? 0,
  riskScore: overrides.riskScore ?? 60,
  riskLevel: overrides.riskLevel || 'medium',
  riskFactors: overrides.riskFactors || [],
  trendDirection: overrides.trendDirection || '',
  leadTimeDays: overrides.leadTimeDays ?? 4,
  orderSuggestion: overrides.orderSuggestion || null,
});

test('campaign suggestions suppress low-stock discount candidates with replenishment reason', () => {
  const result = buildEnhancedSuggestionsFromRows([
    baseRow({
      productId: 'low-1',
      productName: 'Low Stock SKT',
      totalStock: 5,
      avgDailySales: 2,
      criticalStock: 5,
      minimumStock: 6,
      daysToExpiry: 3,
      riskScore: 95,
    }),
    baseRow({
      productId: 'safe-1',
      productName: 'Safe SKT',
      totalStock: 60,
      avgDailySales: 1,
      criticalStock: 5,
      daysToExpiry: 3,
      riskScore: 90,
    }),
  ]);

  assert.equal(result.suggestions.some((item) => item.productIds.includes('low-1')), false);
  const suppressed = result.suppressedSuggestions.find((item) => item.productIds.includes('low-1'));
  assert.ok(suppressed);
  assert.equal(suppressed.isSuppressed, true);
  assert.ok(suppressed.blockingReasons.includes('critical_stock'));
  assert.ok(suppressed.blockingReasons.includes('low_stock_without_secured_purchase_order'));
});

test('campaign suggestions suppress products already covered by active campaigns', () => {
  const result = buildEnhancedSuggestionsFromRows([
    baseRow({ productId: 'campaign-1', totalStock: 70, avgDailySales: 0.4, daysToExpiry: 6, riskScore: 92 }),
  ], {
    activeCampaigns: [{
      id: 'camp-1',
      name: 'Active Product Campaign',
      type: 'product',
      targetProductIds: ['campaign-1'],
      targetCategoryIds: [],
      targetBrands: [],
      discountRate: 15,
    }],
  });

  assert.equal(result.suggestions.length, 0);
  assert.equal(result.suppressedSuggestions.length > 0, true);
  assert.ok(result.suppressedSuggestions.every((item) => item.blockingReasons.includes('active_campaign_conflict')));
  assert.equal(result.suppressedSuggestions[0].sourceMetrics.activeCampaignId, 'camp-1');
});

test('campaign suggestions use precedence so one product gets one primary suggestion', () => {
  const result = buildEnhancedSuggestionsFromRows([
    baseRow({ productId: 'overlap-1', totalStock: 90, avgDailySales: 0.5, daysToExpiry: 5, riskScore: 88, trendDirection: 'down' }),
    baseRow({ productId: 'overlap-2', totalStock: 95, avgDailySales: 0.4, daysToExpiry: 5, riskScore: 87, trendDirection: 'down' }),
  ]);

  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].id, 'near-expiry');
  assert.deepEqual(new Set(result.suggestions.flatMap((item) => item.productIds)).size, 2);
  assert.ok(result.suppressedSuggestions.some((item) => item.blockingReasons.includes('lower_precedence_overlap')));
});

test('campaign suggestions return explicit scope payload and keep margin-watch non-discount', () => {
  const result = buildEnhancedSuggestionsFromRows([
    baseRow({ productId: 'margin-1', productName: 'Margin One', totalStock: 24, avgDailySales: 3, currentPrice: 100, purchasePrice: 94, riskScore: 40 }),
    baseRow({ productId: 'disc-1', productName: 'Discount One', totalStock: 80, avgDailySales: 4, currentPrice: 100, purchasePrice: 65, suggestedDiscount: 12, riskScore: 50 }),
  ]);

  const margin = result.suggestions.find((item) => item.id === 'margin-watch');
  const discount = result.suggestions.find((item) => item.id === 'discount-opportunity');
  assert.ok(margin);
  assert.equal(margin.recommendedDiscountRate, 0);
  assert.equal(margin.reasonCodes.includes('discount_not_recommended'), true);
  assert.ok(discount);
  assert.equal(Boolean(discount.primaryModule), true);
  assert.equal(Boolean(discount.scopeType), true);
  assert.equal(Boolean(discount.scopeId), true);
  assert.equal(Boolean(discount.scopeName), true);
  assert.deepEqual(discount.blockingReasons, []);
  assert.equal(discount.isSuppressed, false);
});
