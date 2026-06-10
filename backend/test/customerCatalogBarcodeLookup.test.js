import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesCustomerCatalogBarcode } from '../src/services/customerCatalogService.js';

test('customer catalog barcode lookup uses normalized exact matches', () => {
  const product = {
    isListed: true,
    isActive: true,
    barcode: '869-123 456',
    sku: 'SKU-42',
  };

  assert.equal(matchesCustomerCatalogBarcode(product, '869123456'), true);
  assert.equal(matchesCustomerCatalogBarcode(product, 'SKU42'), true);
  assert.equal(matchesCustomerCatalogBarcode(product, '869123'), false);
});

test('customer catalog barcode lookup includes active supplier product codes', () => {
  const product = {
    isListed: true,
    isActive: true,
    supplierProducts: [
      { isActive: false, barcode: 'INACTIVE-1' },
      { isActive: true, supplierSku: 'SUP-900' },
    ],
  };

  assert.equal(matchesCustomerCatalogBarcode(product, 'SUP900'), true);
  assert.equal(matchesCustomerCatalogBarcode(product, 'INACTIVE1'), false);
});

test('customer catalog barcode lookup excludes hidden or inactive products', () => {
  assert.equal(matchesCustomerCatalogBarcode({ isListed: false, barcode: '123' }, '123'), false);
  assert.equal(matchesCustomerCatalogBarcode({ isActive: false, barcode: '123' }, '123'), false);
});
