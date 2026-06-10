import { describe, expect, it } from 'vitest';
import { isLikelyBarcodeOrSku, normalizeBarcodeInput } from './barcode.js';

describe('customer barcode helpers', () => {
  it('normalizes scanner prefixes and separators', () => {
    expect(normalizeBarcodeInput('barcode: 869-123 456')).toBe('869123456');
  });

  it('recognizes barcode and SKU-like values without treating product names as codes', () => {
    expect(isLikelyBarcodeOrSku('869123456')).toBe(true);
    expect(isLikelyBarcodeOrSku('SKU-42')).toBe(true);
    expect(isLikelyBarcodeOrSku('Türk Kahvesi')).toBe(false);
    expect(isLikelyBarcodeOrSku('kahve')).toBe(false);
  });
});
