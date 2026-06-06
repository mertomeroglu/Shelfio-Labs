import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNotificationRecordPayload } from '../src/services/notificationService.js';

test('normalizes pricing demand campaign notifications', () => {
  const normalized = normalizeNotificationRecordPayload({
    userId: 'u1',
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

  assert.equal(normalized.type, 'campaign');
  assert.equal(normalized.title, 'Kampanya oluşturuldu');
  assert.equal(normalized.message, '"Atıştırmalık Yaz İndirimi" kampanyası Fiyat & Talep Analizi üzerinden oluşturuldu.');
  assert.equal(normalized.actionType, 'campaign');
  assert.equal(normalized.actionUrl, '/kampanya-yonetimi');
  assert.equal(normalized.payload.sourceLabel, 'Fiyat & Talep Analizi');
  assert.equal(`${normalized.title} ${normalized.message}`.includes('[object Object]'), false);
  assert.equal(`${normalized.title} ${normalized.message}`.includes('Price Recommendations'), false);
});

test('normalizes missing campaign name with controlled fallback', () => {
  const normalized = normalizeNotificationRecordPayload({
    userId: 'u1',
    type: 'campaign',
    title: 'Kampanya',
    message: '',
    payload: {
      event: 'campaign_created',
      entityType: 'campaign',
      source: 'pricing_demand_analysis',
    },
  });

  assert.equal(normalized.title, 'Kampanya oluşturuldu');
  assert.equal(normalized.message, 'Yeni kampanya Fiyat & Talep Analizi üzerinden oluşturuldu.');
  assert.equal(normalized.payload.campaignName, 'Yeni kampanya');
});
