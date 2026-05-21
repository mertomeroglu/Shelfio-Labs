import {
  buildCampaignSuggestions,
  mapPricingRowsForCampaigns,
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

    expect(suggestions.length).toBeGreaterThanOrEqual(5);
    expect(suggestions.some((item) => item.id === 'near-expiry')).toBe(true);
    expect(suggestions.some((item) => item.id === 'overstock')).toBe(true);
    expect(suggestions.some((item) => item.id === 'brand-focus')).toBe(true);
    expect(suggestions.some((item) => item.id === 'gift-card-trigger')).toBe(true);
    expect(suggestions.some((item) => item.recommendedDiscount > 0)).toBe(true);
  });
});
