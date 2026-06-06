import { describe, expect, it } from 'vitest';
import {
  resolveCanonicalAvailableStock,
  resolveCustomerProductStockPresentation,
} from './customerProductStockStatus.js';

describe('customerProductStockStatus', () => {
  it('uses available stock ahead of total stock to avoid conflicting detail labels', () => {
    const product = {
      sku: 'SKU-0-CONFLICT',
      totalStock: 12,
      stockSummary: { available: 0 },
    };

    expect(resolveCanonicalAvailableStock(product)).toBe(0);

    const presentation = resolveCustomerProductStockPresentation({ product });
    expect(presentation.estimatedStockoutLabel).toBe('Stokta yok');
    expect(presentation.stockStatusLabel).toBe('Stokta yok');
  });

  it('shows available in store when stock exists but sales forecast is not available', () => {
    const product = {
      sku: 'SKU-NO-SALES',
      available: 6,
      customerStockForecast: {
        availableStock: 6,
        reason: 'Tahmin için yeterli satış verisi yok',
      },
    };

    const presentation = resolveCustomerProductStockPresentation({ product });
    expect(presentation.stockStatusLabel).toBe('Mağazada mevcut');
    expect(presentation.estimatedStockoutLabel).toBe('Tahmin için yeterli satış verisi yok');
  });

  it('shows the forecast date when stock exists and forecast data is present', () => {
    const product = {
      sku: 'SKU-WITH-FORECAST',
      available: 4,
    };
    const presentation = resolveCustomerProductStockPresentation({
      product,
      stockForecast: {
        availableStock: 4,
        estimatedStockoutDate: '2026-05-20T00:00:00.000Z',
      },
    });

    expect(presentation.stockStatusLabel).toBe('Mağazada mevcut');
    expect(presentation.estimatedStockoutLabel).toBe('20 Mayıs 2026');
  });

  it('keeps kilogram products available when stock is a positive decimal', () => {
    const product = {
      sku: 'SKU-KG-001',
      unit: 'kg',
      available: 1.25,
    };

    const presentation = resolveCustomerProductStockPresentation({ product });
    expect(presentation.canonicalAvailableStock).toBe(1.25);
    expect(presentation.stockStatusLabel).toBe('Mağazada mevcut');
  });

  it('keeps adet products unavailable when stock is zero', () => {
    const product = {
      sku: 'SKU-ADET-001',
      unit: 'adet',
      available: 0,
    };

    const presentation = resolveCustomerProductStockPresentation({ product });
    expect(presentation.canonicalAvailableStock).toBe(0);
    expect(presentation.stockStatusLabel).toBe('Stokta yok');
    expect(presentation.estimatedStockoutLabel).toBe('Stokta yok');
  });
});
