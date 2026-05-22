import { api, buildQueryString, getOrLoadSessionCache } from './api.js';
import { normalizeTurkishText } from '../utils/turkishText.js';

const getSuggestionsCacheKey = (params = {}) => `campaign-analysis:suggestions:${buildQueryString(params) || 'default'}`;
const normalizeCampaignText = (value) => normalizeTurkishText(String(value || ''))
  .replace(/\byavas\b/gi, 'yavaş')
  .replace(/\burun\b/gi, 'ürün')
  .replace(/\bicin\b/gi, 'için')
  .replace(/\bindirim kampanyasi\b/gi, 'indirim kampanyası')
  .replace(/\bsatis\b/gi, 'satış')
  .replace(/\bhizi\b/gi, 'hızı')
  .replace(/\bdusuk\b/gi, 'düşük')
  .replace(/\byuksek\b/gi, 'yüksek')
  .replace(/\bgore\b/gi, 'göre')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeCampaignTextDeep = (value) => {
  if (typeof value === 'string') return normalizeCampaignText(value);
  if (Array.isArray(value)) return value.map((item) => normalizeCampaignTextDeep(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeCampaignTextDeep(item)]));
  }
  return value;
};

export const campaignAnalysisService = {
  getSuggestions: (params = {}) => {
    const { forceRefresh = false, ...queryParams } = params || {};
    return getOrLoadSessionCache(
      getSuggestionsCacheKey(queryParams),
      () => api.get(`/campaign-analysis/suggestions${buildQueryString(queryParams)}`).then(normalizeCampaignTextDeep),
      { forceRefresh: Boolean(forceRefresh) },
    );
  },
  simulate: (payload = {}) => api.post('/campaign-analysis/simulate', payload),
};
