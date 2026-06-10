import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareNormalizedCatalogPrices,
  evaluateCatalogPriceChange,
  normalizeCatalogPrice,
  parseCatalogNumber,
} from '../src/domain/catalogPricePolicy.js';
import { __catalogImportInternals } from '../src/services/catalogImportService.js';

const parseCases = [
  ['236.13', 236.13],
  ['236,13', 236.13],
  ['23.613,00', 23613],
  ['23,613.00', 23613],
  ['23613', 23613],
  ['₺236,13', 236.13],
  ['₺23.613,00', 23613],
  ['23 613,00', 23613],
  [255.02, 255.02],
  ['255.02', 255.02],
  ['255,02', 255.02],
  ['25502', 25502],
];

test('catalog number parser preserves locale-aware decimal and thousands separators', () => {
  for (const [input, expected] of parseCases) {
    assert.equal(parseCatalogNumber(input).value, expected, String(input));
  }
});

test('native numbers bypass string separator normalization', () => {
  assert.deepEqual(parseCatalogNumber(255.02), {
    value: 255.02,
    confidence: 'high',
    reason: 'native_number',
    rawValue: 255.02,
  });
});

test('ambiguous single separators are explicitly low confidence', () => {
  assert.deepEqual(parseCatalogNumber('23.613'), {
    value: 23613,
    confidence: 'low',
    reason: 'single_separator_three_digit_group',
    rawValue: '23.613',
  });
});

test('236.13 to 255.02 is a normal increase around eight percent', () => {
  const result = evaluateCatalogPriceChange({ oldPrice: 236.13, newPrice: 255.02 });
  assert.equal(result.status, 'increase');
  assert.equal(result.priceAnomalyReason, null);
  assert.equal(result.canAutoApprove, true);
  assert.ok(result.changePct > 7.9 && result.changePct < 8.1);
});

test('same price is unchanged', () => {
  const result = evaluateCatalogPriceChange({ oldPrice: 255.02, newPrice: 255.02 });
  assert.equal(result.status, 'unchanged');
  assert.equal(result.changePct, 0);
});

test('scale-like increases over 300 percent are invalid', () => {
  const result = evaluateCatalogPriceChange({ oldPrice: 236.13, newPrice: 25502 });
  assert.equal(result.status, 'invalid');
  assert.equal(result.priceAnomalyReason, 'price_scale_suspected');
  assert.equal(result.canAutoApprove, false);
});

test('price drops below minus 50 percent are invalid', () => {
  const result = evaluateCatalogPriceChange({ oldPrice: 255.02, newPrice: 100 });
  assert.equal(result.status, 'invalid');
  assert.equal(result.priceAnomalyReason, 'price_scale_suspected');
  assert.equal(result.canAutoApprove, false);
});

test('changes between 60 and 300 percent require manual review', () => {
  const result = evaluateCatalogPriceChange({ oldPrice: 100, newPrice: 200 });
  assert.equal(result.status, 'increase');
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.canAutoApprove, false);
});

test('unit and case prices normalize to the same comparison basis', () => {
  const oldPrice = normalizeCatalogPrice({
    purchasePrice: 10,
    purchasePriceBasis: 'unit',
    unitsPerCase: 24,
    unit: 'Paket',
  });
  const sameCasePrice = normalizeCatalogPrice({
    purchasePrice: 240,
    purchasePriceBasis: 'case',
    unitsPerCase: 24,
    unit: 'Adet',
  });
  const increasedCasePrice = normalizeCatalogPrice({
    purchasePrice: 264,
    purchasePriceBasis: 'case',
    unitsPerCase: 24,
    unit: 'Adet',
  });

  assert.equal(sameCasePrice.normalizedUnitPurchasePrice, 10);
  assert.equal(compareNormalizedCatalogPrices({
    oldPrice: { ...oldPrice, currency: 'TRY' },
    newPrice: { ...sameCasePrice, currency: 'TRY' },
  }).diffStatus, 'unchanged');
  const increase = compareNormalizedCatalogPrices({
    oldPrice: { ...oldPrice, currency: 'TRY' },
    newPrice: { ...increasedCasePrice, currency: 'TRY' },
  });
  assert.equal(increase.diffStatus, 'price_increased');
  assert.ok(increase.changePct > 9.9 && increase.changePct < 10.1);
});

test('case price without units and unknown basis require price review', () => {
  assert.equal(normalizeCatalogPrice({
    purchasePrice: 240,
    purchasePriceBasis: 'case',
    unitsPerCase: null,
    unit: 'Adet',
  }).priceReviewRequired, true);
  assert.equal(normalizeCatalogPrice({
    purchasePrice: 10,
    purchasePriceBasis: 'unknown',
    unitsPerCase: 24,
    unit: 'Adet',
  }).priceNormalizationReason, 'purchase_price_basis_unknown');
});

test('unit price is not divided by units per case', () => {
  const result = normalizeCatalogPrice({
    purchasePrice: 10,
    purchasePriceBasis: 'unit',
    unitsPerCase: 24,
    unit: 'Adet',
  });
  assert.equal(result.normalizedUnitPurchasePrice, 10);
  assert.equal(result.normalizedCasePurchasePrice, 240);
});

test('currency and VAT differences do not produce automatic price decisions', () => {
  const normalized = normalizeCatalogPrice({
    purchasePrice: 10,
    purchasePriceBasis: 'unit',
    unit: 'Adet',
  });
  assert.equal(compareNormalizedCatalogPrices({
    oldPrice: { ...normalized, currency: 'TRY' },
    newPrice: { ...normalized, currency: 'USD' },
  }).diffStatus, 'currency_review_required');
  assert.equal(compareNormalizedCatalogPrices({
    oldPrice: { ...normalized, currency: 'TRY', vatIncluded: true },
    newPrice: { ...normalized, currency: 'TRY', vatIncluded: false },
  }).diffStatus, 'vat_review_required');
  assert.equal(compareNormalizedCatalogPrices({
    oldPrice: { ...normalized, currency: 'TRY', taxRate: 10 },
    newPrice: { ...normalized, currency: 'TRY', taxRate: 20 },
  }).diffStatus, 'vat_review_required');
});

test('exact identifiers score high while conflicting barcode blocks name matching', () => {
  const baseRow = {
    productName: 'Test Urun',
    purchasePrice: 11,
    purchasePriceBasis: 'unit',
    unit: 'Adet',
    categoryName: 'Gida',
    brand: 'Marka',
    currency: 'TRY',
  };
  const products = [{
    id: 'p1',
    name: 'Test Urun',
    barcode: '8691234567890',
    sku: 'SKU-1',
    brand: 'Marka',
    categoryName: 'Gida',
    unit: 'Paket',
  }];
  const supplierProducts = [{
    id: 'sp1',
    supplierId: 's1',
    productId: 'p1',
    supplierProductCode: 'SUP-1',
    purchasePrice: 10,
    priceUnit: 'adet',
    currency: 'TRY',
  }];

  const barcodeRow = __catalogImportInternals.normalizeImportRow({
    ...baseRow,
    barcode: '8691234567890',
  }, 0);
  const barcodePreview = __catalogImportInternals.buildPreviewRows({
    rows: [barcodeRow],
    products,
    supplierProducts,
    supplierId: 's1',
  })[0];
  assert.equal(barcodePreview.matchConfidence, 100);
  assert.equal(barcodePreview.matchedBy, 'barcode');
  assert.equal(barcodePreview.matchStatus, 'matched_existing_product');

  const conflictingBarcodeRow = __catalogImportInternals.normalizeImportRow({
    ...baseRow,
    barcode: '8699999999999',
  }, 0);
  const conflictPreview = __catalogImportInternals.buildPreviewRows({
    rows: [conflictingBarcodeRow],
    products,
    supplierProducts,
    supplierId: 's1',
  })[0];
  assert.notEqual(conflictPreview.matchStatus, 'matched_existing_product');
});

test('supplier code is high confidence, fuzzy names are manual, and unknown products are candidates', () => {
  const products = [{
    id: 'p1',
    name: 'Organik Domates Salcasi',
    barcode: '8691234567890',
    sku: 'SKU-1',
    brand: 'Marka',
    categoryName: 'Gida',
    unit: 'Paket',
  }];
  const supplierProducts = [{
    id: 'sp1',
    supplierId: 's1',
    productId: 'p1',
    supplierProductCode: 'SUP-1',
    purchasePrice: 10,
    priceUnit: 'paket',
    packSize: 1,
    currency: 'TRY',
  }];
  const normalize = (row, index) => __catalogImportInternals.normalizeImportRow({
    purchasePrice: 11,
    purchasePriceBasis: 'unit',
    unit: 'Adet',
    categoryName: 'Gida',
    brand: 'Marka',
    currency: 'TRY',
    ...row,
  }, index);

  const previews = __catalogImportInternals.buildPreviewRows({
    rows: [
      normalize({ productName: 'Kod Eslesmesi', supplierProductCode: 'SUP-1' }, 0),
      normalize({ productName: 'Organik Domates Salca' }, 1),
      normalize({ productName: 'Tamamen Yeni Urun' }, 2),
    ],
    products,
    supplierProducts,
    supplierId: 's1',
  });

  assert.equal(previews[0].matchConfidence, 95);
  assert.equal(previews[0].matchedBy, 'supplierProductCode');
  assert.equal(previews[1].matchStatus, 'ambiguous_match');
  assert.equal(previews[1].matchedBy, 'productName');
  assert.equal(previews[2].matchStatus, 'new_product_candidate');
});
