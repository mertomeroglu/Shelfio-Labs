import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decidePurchaseSuggestion,
  hasRequiredOrderData,
} from '../src/domain/purchaseSuggestionPolicy.js';

test('purchase suggestion policy classifies the required active statuses', () => {
  const common = {
    productActive: true,
    supplierMappingExists: true,
    activeSupplierMappingExists: true,
    orderDataComplete: true,
    demandDataAvailable: true,
    inboundCoversNeed: false,
    reorderPoint: 10,
  };

  assert.deepEqual(
    decidePurchaseSuggestion({ ...common, currentStock: 0, sold30: 40, salesSpeed: 'fast' }),
    {
      status: 'pending',
      reasonTag: 'stockout_high_demand',
      reasonText: 'Stok bitti ve satış hızı yüksek',
    }
  );
  assert.equal(
    decidePurchaseSuggestion({ ...common, currentStock: 0, sold30: 2, salesSpeed: 'slow' }).status,
    'manual_evaluation'
  );
  assert.equal(
    decidePurchaseSuggestion({ ...common, currentStock: 4, sold30: 20, salesSpeed: 'normal' }).reasonTag,
    'below_reorder_point'
  );
  assert.equal(
    decidePurchaseSuggestion({ ...common, inboundCoversNeed: true }).reasonTag,
    'inbound_covered'
  );
});

test('purchase suggestion policy exposes skipped data reasons', () => {
  assert.equal(decidePurchaseSuggestion({ productActive: false }).reasonTag, 'product_inactive');
  assert.equal(
    decidePurchaseSuggestion({ productActive: true }).reasonTag,
    'missing_supplier_mapping'
  );
  assert.equal(
    decidePurchaseSuggestion({
      productActive: true,
      supplierMappingExists: true,
      activeSupplierMappingExists: false,
    }).reasonTag,
    'inactive_supplier'
  );
  assert.equal(
    decidePurchaseSuggestion({
      productActive: true,
      supplierMappingExists: true,
      activeSupplierMappingExists: true,
      minimumStockAvailable: false,
    }).reasonTag,
    'missing_min_stock'
  );
  assert.equal(
    decidePurchaseSuggestion({
      productActive: true,
      supplierMappingExists: true,
      activeSupplierMappingExists: true,
      minimumStockAvailable: true,
      leadTimeAvailable: false,
    }).reasonTag,
    'missing_lead_time'
  );
  assert.equal(
    decidePurchaseSuggestion({
      productActive: true,
      supplierMappingExists: true,
      activeSupplierMappingExists: true,
      minimumStockAvailable: true,
      leadTimeAvailable: true,
      orderDataComplete: true,
      demandDataAvailable: false,
    }).reasonTag,
    'missing_demand_data'
  );
});

test('packaged MOQ requires a valid case size', () => {
  assert.equal(hasRequiredOrderData({
    minimumOrderQty: 4,
    minimumOrderUnit: 'koli',
    unitsPerCase: 12,
  }), true);
  assert.equal(hasRequiredOrderData({
    minimumOrderQty: 4,
    minimumOrderUnit: 'koli',
    unitsPerCase: null,
  }), false);
  assert.equal(hasRequiredOrderData({
    minimumOrderQty: 4,
    minimumOrderUnit: 'adet',
    unitsPerCase: null,
  }), true);
});
