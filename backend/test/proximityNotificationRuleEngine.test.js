import test from 'node:test';
import assert from 'node:assert/strict';
import { __notificationRuleEngineInternals } from '../src/services/proximity/notificationRuleEngine.js';

const { resolveProximityOfferSignal } = __notificationRuleEngineInternals;

const baseProduct = (overrides = {}) => ({
  id: 'product-1',
  name: 'Test Product',
  barcode: '8690000000011',
  salePrice: 100,
  currentPrice: 100,
  regularPrice: 100,
  hasActiveCampaign: false,
  lastPriceChangeSource: null,
  priceEvents: [],
  ...overrides,
});

const baseLabel = (overrides = {}) => ({
  productId: 'product-1',
  assignedProductId: 'product-1',
  barcode: '8690000000011',
  template: 'standard',
  regularPrice: 100,
  displayPrice: 100,
  campaignPrice: null,
  hasActiveCampaign: false,
  currentLabelSource: 'assigned-product',
  staleBridgeLabelIgnored: false,
  ...overrides,
});

test('Scenario A: Standard/indirimsiz urun is ineligible', () => {
  const signal = resolveProximityOfferSignal({
    product: baseProduct(),
    label: baseLabel({ template: 'standard', regularPrice: 100, displayPrice: 100 }),
    campaigns: [],
  });

  assert.equal(signal.eligible, false);
  assert.equal(signal.offerSource, null);
  assert.equal(signal.diagnostics.rejectionReason, 'NO_VERIFIED_ACTIVE_DISCOUNT');
});

test('Scenario B: Current ESL discount template is eligible even without price difference', () => {
  const signal = resolveProximityOfferSignal({
    product: baseProduct(),
    label: baseLabel({ template: 'discount', regularPrice: 100, displayPrice: 100 }),
    campaigns: [],
  });

  assert.equal(signal.eligible, true);
  assert.equal(signal.offerSource, 'ESL_LABEL_DISCOUNT');
  assert.equal(signal.diagnostics.eligibilityReason, 'CURRENT_ESL_DISCOUNT_TEMPLATE');
  assert.equal(signal.diagnostics.verifiedBy, 'label.template');
});

test('Scenario C1: Stale ESL discount template (staleBridgeLabelIgnored) is ineligible', () => {
  const signal = resolveProximityOfferSignal({
    product: baseProduct(),
    label: baseLabel({
      template: 'discount',
      currentLabelSource: 'bridge-confirmed',
      staleBridgeLabelIgnored: true,
    }),
    campaigns: [],
  });

  assert.equal(signal.eligible, false);
  assert.equal(signal.diagnostics.rejectionReason, 'STALE_LABEL_DISCOUNT_IGNORED');
});

test('Scenario C2: Mismatched ESL product is ineligible', () => {
  const signal = resolveProximityOfferSignal({
    product: baseProduct({ id: 'product-1' }),
    label: baseLabel({
      template: 'discount',
      productId: 'product-2',
      assignedProductId: 'product-2',
    }),
    campaigns: [],
  });

  assert.equal(signal.eligible, false);
  assert.equal(signal.diagnostics.rejectionReason, 'PRODUCT_MISMATCH');
});

test('Scenario D: Barcode mismatch is ineligible', () => {
  const signal = resolveProximityOfferSignal({
    product: baseProduct({ barcode: '8690000000011' }),
    label: baseLabel({
      template: 'discount',
      barcode: '8690000000022',
    }),
    campaigns: [],
  });

  assert.equal(signal.eligible, false);
  assert.equal(signal.diagnostics.rejectionReason, 'BARCODE_MISMATCH');
});

test('Scenario E: Active campaign with valid price drop is eligible', () => {
  const signal = resolveProximityOfferSignal({
    product: baseProduct(),
    label: baseLabel(),
    campaigns: [{
      id: 'campaign-1',
      name: 'Active Campaign',
      targetProductIds: ['product-1'],
      targetBarcodes: [],
      discountRate: 20,
      isCurrentlyActive: true,
    }],
  });

  assert.equal(signal.eligible, true);
  assert.equal(signal.offerSource, 'CAMPAIGN');
  assert.equal(signal.prices.effectivePrice, 80);
});

test('Scenario F: ESL/product hasActiveCampaign fallback is eligible when DB campaign is null', () => {
  const signal = resolveProximityOfferSignal({
    product: baseProduct({ hasActiveCampaign: true }),
    label: baseLabel({ hasActiveCampaign: true, template: 'discount' }),
    campaigns: [],
  });

  assert.equal(signal.eligible, true);
  assert.equal(signal.offerSource, 'ESL_LABEL_DISCOUNT');
  assert.equal(signal.diagnostics.eligibilityReason, 'CURRENT_ESL_ACTIVE_CAMPAIGN_FLAG');
  assert.equal(signal.diagnostics.activeCampaignMatched, false);
});

test('Scenario G: Manual/admin correction price drop is ineligible', () => {
  const signal = resolveProximityOfferSignal({
    product: baseProduct({
      priceEvents: [{
        previousSalePrice: 120,
        salePrice: 100,
        source: 'manual_correction',
      }],
    }),
    label: baseLabel(),
    campaigns: [],
  });

  assert.equal(signal.eligible, false);
  assert.equal(signal.diagnostics.rejectionReason, 'NO_VERIFIED_ACTIVE_DISCOUNT');
});

test('Scenario H1: Old PRICE_DROP source (purchase) with real price drop is eligible', () => {
  const signal = resolveProximityOfferSignal({
    product: baseProduct({
      priceEvents: [{
        previousSalePrice: 120,
        salePrice: 100,
        source: 'purchase',
      }],
    }),
    label: baseLabel(),
    campaigns: [],
  });

  assert.equal(signal.eligible, true);
  assert.equal(signal.offerSource, 'PRICE_DROP');
});

test('Scenario H2: Old PRICE_DROP source (procurement) with real price drop is eligible', () => {
  const signal = resolveProximityOfferSignal({
    product: baseProduct({
      priceEvents: [{
        previousSalePrice: 120,
        salePrice: 100,
        source: 'procurement',
      }],
    }),
    label: baseLabel(),
    campaigns: [],
  });

  assert.equal(signal.eligible, true);
  assert.equal(signal.offerSource, 'PRICE_DROP');
});

test('Scenario H3: Old PRICE_DROP source (pricing_analysis) with real price drop is eligible as PRICING_RULE', () => {
  const signal = resolveProximityOfferSignal({
    product: baseProduct({
      priceEvents: [{
        previousSalePrice: 120,
        salePrice: 100,
        source: 'pricing_analysis',
      }],
    }),
    label: baseLabel(),
    campaigns: [],
  });

  assert.equal(signal.eligible, true);
  assert.equal(signal.offerSource, 'PRICING_RULE');
});
