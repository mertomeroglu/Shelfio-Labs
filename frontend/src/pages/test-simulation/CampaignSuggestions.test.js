import {
  buildCampaignSuggestionPresentation,
  buildCampaignSuggestions,
  isCampaignSuggestionDiscountActionable,
  mapPricingRowsForCampaigns,
  resolveCampaignSuggestionDraftTarget,
} from '../_shared/settings-campaign-shell/campaignManagementUtils.js';

describe('CampaignSuggestions', () => {
  test('generates suggestion cards for slow, overstock and near-expiry pools', () => {
    const pricingRows = mapPricingRowsForCampaigns({
      sections: {
        expirationRisk: [
          { productId: 'p1', productName: 'Milk', category: 'Süt', brand: 'Mis', daysToExpiry: 4, currentStock: 60, avgDailySales: 0.5, currentPrice: 100, cost: 65, discountSuggestion: { discountRate: 20 } },
        ],
        dynamicPricing: [
          { productId: 'p2', productName: 'Cheese', category: 'Süt', brand: 'Mis', daysToExpiry: 25, currentStock: 55, avgDailySales: 1, currentPrice: 120, cost: 70, discountSuggestion: { discountRate: 15 } },
          { productId: 'p3', productName: 'Yogurt', category: 'Süt', brand: 'Mis', daysToExpiry: 14, currentStock: 48, avgDailySales: 0.8, currentPrice: 90, cost: 58, discountSuggestion: { discountRate: 12 } },
        ],
        fastMoving: [],
        slowMoving: [],
        competitorMismatch: [],
      },
    });

    const suggestions = buildCampaignSuggestions({
      pricingRows,
      purchaseSuggestions: [{ id: 's1', productId: 'p1', currentStock: 40, avgDailySales: 0.9 }],
      campaigns: [],
      giftCards: [{ id: 'g1', code: 'GC100', name: 'Sadakat', isActive: true }],
    });

    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    expect(suggestions.some((item) => item.id === 'near-expiry')).toBe(true);
    expect(suggestions.some((item) => item.id === 'overstock')).toBe(true);
    expect(suggestions.some((item) => item.id === 'category-focus')).toBe(false);
    expect(suggestions.some((item) => item.id === 'brand-focus')).toBe(false);
    expect(suggestions.some((item) => item.id === 'gift-card-trigger')).toBe(true);
    expect(suggestions.some((item) => item.recommendedDiscount > 0)).toBe(true);
  });

  test('maps backend suggestion families into one primary module without duplicate cards or manual modules', () => {
    const presentation = buildCampaignSuggestionPresentation([
      { id: 'near-expiry', title: '3 üründe SKT odaklı hızlı kampanya', type: 'product', productIds: ['p1'], affectedProductCount: 1, recommendedDiscount: 25, priority: 'critical' },
      { id: 'slow-moving', title: '5 yavaş satan ürün için indirim kampanyası', type: 'product', productIds: ['p2'], affectedProductCount: 1, recommendedDiscount: 16, priority: 'high' },
      { id: 'overstock', title: 'Kategori stok eritme kampanyası', type: 'category', categoryNames: ['Süt'], productIds: ['p3'], affectedProductCount: 1, recommendedDiscount: 14, priority: 'medium' },
      { id: 'overstock', title: 'Ürün stok eritme kampanyası', type: 'product', categoryNames: ['Süt'], brandNames: ['Mis'], productIds: ['p6'], affectedProductCount: 1, recommendedDiscount: 14, priority: 'medium' },
      { id: 'brand-focus', title: 'Marka kampanyası', type: 'brand', brandNames: ['Mis'], productIds: ['p5'], affectedProductCount: 1, recommendedDiscount: 12, priority: 'medium' },
      { id: 'margin-watch', title: 'Düşük marjlı üründe kontrollü aksiyon', type: 'product', productIds: ['p4'], affectedProductCount: 1, recommendedDiscount: 6, priority: 'medium' },
      { id: 'near-expiry', title: '3 üründe SKT odaklı hızlı kampanya', type: 'product', productIds: ['p1'], affectedProductCount: 1, recommendedDiscount: 25, priority: 'critical' },
    ]);

    expect(presentation.byModule.expiry).toHaveLength(1);
    expect(presentation.byModule.sales).toHaveLength(1);
    expect(presentation.byModule.category).toHaveLength(0);
    expect(presentation.byModule.brand).toHaveLength(0);
    expect(presentation.counts.category).toBe(0);
    expect(presentation.counts.brand).toBe(0);
    expect(presentation.byModule.product).toHaveLength(2);
    expect(presentation.all).toHaveLength(4);
    expect(presentation.dashboardHighlights.some((item) => item.id === 'dashboard-high-priority-bundle')).toBe(true);
  });

  test('keeps non-discount and demand-down suggestions in safe draft paths', () => {
    const marginWatch = {
      id: 'margin-watch',
      recommendationType: 'margin_watch',
      type: 'product',
      productIds: ['p1'],
      affectedProductCount: 1,
      recommendedDiscount: 0,
      reasonCodes: ['margin_watch', 'discount_not_recommended'],
    };
    const demandDown = {
      id: 'demand-down',
      recommendationType: 'demand_down',
      type: 'product',
      productIds: ['p2'],
      affectedProductCount: 1,
      recommendedDiscount: 10,
    };

    expect(isCampaignSuggestionDiscountActionable(marginWatch)).toBe(false);
    expect(isCampaignSuggestionDiscountActionable(demandDown)).toBe(true);
    expect(resolveCampaignSuggestionDraftTarget(demandDown, 'all')).toMatchObject({
      targetView: 'product',
      sourceModule: 'sales',
      primaryModule: 'sales',
    });
  });
});
