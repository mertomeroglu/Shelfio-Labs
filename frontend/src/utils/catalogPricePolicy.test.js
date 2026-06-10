import { describe, expect, it } from 'vitest';
import {
  evaluateCatalogPriceChange,
  hasBlockingCatalogRows,
} from './catalogPricePolicy.js';

describe('catalog price policy', () => {
  it('labels 236.13 to 255.02 as a normal increase around eight percent', () => {
    const result = evaluateCatalogPriceChange({ oldPrice: 236.13, newPrice: 255.02 });

    expect(result.status).toBe('increase');
    expect(result.changePct).toBeGreaterThan(7.9);
    expect(result.changePct).toBeLessThan(8.1);
    expect(result.canAutoApprove).toBe(true);
  });

  it('keeps the same price unchanged', () => {
    expect(evaluateCatalogPriceChange({ oldPrice: 255.02, newPrice: 255.02 }).status)
      .toBe('unchanged');
  });

  it('blocks scale anomalies and extreme decreases', () => {
    expect(evaluateCatalogPriceChange({ oldPrice: 236.13, newPrice: 25502 }))
      .toMatchObject({
        status: 'invalid',
        priceAnomalyReason: 'price_scale_suspected',
        canAutoApprove: false,
      });
    expect(evaluateCatalogPriceChange({ oldPrice: 255.02, newPrice: 100 }))
      .toMatchObject({
        status: 'invalid',
        priceAnomalyReason: 'price_scale_suspected',
        canAutoApprove: false,
      });
  });

  it('disables catalog activation for invalid or suspicious rows', () => {
    expect(hasBlockingCatalogRows([
      { status: 'Hatalı', priceAnomalyReason: 'price_scale_suspected' },
    ])).toBe(true);
    expect(hasBlockingCatalogRows([
      { status: 'Manuel İnceleme', requiresManualReview: true },
    ])).toBe(true);
    expect(hasBlockingCatalogRows([
      { diffStatus: 'price_review_required' },
    ])).toBe(true);
    expect(hasBlockingCatalogRows([
      { diffStatus: 'ambiguous_match' },
    ])).toBe(true);
    expect(hasBlockingCatalogRows([
      { status: 'Zam Geldi', errors: [] },
    ])).toBe(false);
  });
});
