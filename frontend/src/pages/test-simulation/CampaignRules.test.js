import {
  evaluateDynamicRule,
  evaluateAutomationTriggerConditions,
  previewDynamicRuleImpact,
} from '../_shared/settings-campaign-shell/campaignManagementUtils.js';

describe('CampaignRules', () => {
  test('evaluates dynamic IF conditions correctly', () => {
    const rule = { salesBelow: 1.2, stockAbove: 40, expiryBelow: 12 };
    const matched = evaluateDynamicRule(rule, { salesVelocity: 0.8, stockLevel: 55, daysToExpiry: 7 });
    const notMatched = evaluateDynamicRule(rule, { salesVelocity: 2.2, stockLevel: 55, daysToExpiry: 7 });

    expect(matched).toBe(true);
    expect(notMatched).toBe(false);
  });

  test('computes rule impact preview and automation trigger checks', () => {
    const preview = previewDynamicRuleImpact({
      rule: { salesBelow: 1, stockAbove: 30, expiryBelow: 10 },
      pricingRows: [
        { productId: 'p1', salesVelocity: 0.4, stockLevel: 70, daysToExpiry: 4 },
        { productId: 'p2', salesVelocity: 3, stockLevel: 10, daysToExpiry: 40 },
      ],
    });

    expect(preview.affectedCount).toBe(1);

    const trigger = evaluateAutomationTriggerConditions({
      trigger: {
        lowSalesVelocityThreshold: 1,
        highStockThreshold: 40,
        expirationThreshold: 8,
        minMarginForDrop: 20,
      },
      metrics: {
        salesVelocity: 0.5,
        stockLevel: 60,
        daysToExpiry: 6,
        marginPercent: 28,
      },
    });

    expect(trigger.triggered).toBe(true);
    expect(trigger.lowSalesVelocity).toBe(true);
    expect(trigger.highStock).toBe(true);
  });
});

