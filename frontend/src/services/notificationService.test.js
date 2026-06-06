import { describe, expect, it } from 'vitest';
import {
  buildCampaignCreatedNotificationPayload,
  DEFAULT_NOTIFICATION_SETTINGS,
  getNotificationTypeMeta,
  isNotificationEnabled,
  normalizeNotification,
  resolveNotificationSourceLabel,
} from './notificationService.js';

describe('notificationService campaign notification normalization', () => {
  it('renders pricing demand campaign notifications with Turkish copy', () => {
    const item = normalizeNotification({
      id: 'n1',
      type: 'price_recommendations',
      title: { label: 'Price Recommendations kaynaklı kampanya' },
      message: { campaignName: 'Atıştırmalık Yaz İndirimi' },
      severity: 'medium',
      payload: {
        event: 'campaign_created',
        entityType: 'campaign',
        campaignId: 'campaign-1',
        campaignName: 'Atıştırmalık Yaz İndirimi',
        source: 'price_recommendations',
      },
    });

    expect(item.title).toBe('Kampanya oluşturuldu');
    expect(item.description).toBe('"Atıştırmalık Yaz İndirimi" kampanyası Fiyat & Talep Analizi üzerinden oluşturuldu.');
    expect(item.actionType).toBe('campaign');
    expect(item.actionUrl).toBe('/kampanya-yonetimi');
    expect(item.sourceLabel).toBe('Fiyat & Talep Analizi');
    expect(`${item.title} ${item.description}`).not.toContain('[object Object]');
    expect(`${item.title} ${item.description}`).not.toContain('Price Recommendations');
  });

  it('uses controlled fallback when campaign name is missing', () => {
    const payload = buildCampaignCreatedNotificationPayload({
      campaign: { id: 'campaign-2' },
      source: 'pricing_demand_analysis',
    });

    expect(payload.title).toBe('Kampanya oluşturuldu');
    expect(payload.message).toBe('Yeni kampanya Fiyat & Talep Analizi üzerinden oluşturuldu.');
    expect(payload.actionUrl).toBe('/kampanya-yonetimi');
    expect(payload.payload.campaignName).toBe('Yeni kampanya');
  });

  it('maps technical source aliases to the user-facing label', () => {
    expect(resolveNotificationSourceLabel('Price Recommendations')).toBe('Fiyat & Talep Analizi');
    expect(resolveNotificationSourceLabel('price_demand_analysis')).toBe('Fiyat & Talep Analizi');
  });

  it('exposes stock-out notifications as a separate desktop setting', () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS.stock_out).toBe(true);
    expect(getNotificationTypeMeta('out_of_stock')?.type).toBe('stock_out');
    expect(getNotificationTypeMeta('stockout')?.label).toBe('Stok Bitti');
    expect(isNotificationEnabled('stock_out', { ...DEFAULT_NOTIFICATION_SETTINGS, stock_out: false })).toBe(false);
    expect(isNotificationEnabled('out_of_stock', { ...DEFAULT_NOTIFICATION_SETTINGS, stock_out: false })).toBe(false);
  });
});
