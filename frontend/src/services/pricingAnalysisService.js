import { api, buildQueryString, getOrLoadSessionCache, invalidateSessionCache } from './api.js';

const getPricingAnalysisCacheKey = (params = {}) => `pricing-analysis:${buildQueryString(params) || 'default'}`;

export const pricingAnalysisService = {
  getAnalysis: (params = {}, options = {}) => {
    const { forceRefresh = false, ...queryParams } = params || {};
    if (options?.signal) {
      return api.get(`/reports/pricing-analysis${buildQueryString(queryParams)}`, options);
    }
    return getOrLoadSessionCache(
      getPricingAnalysisCacheKey(queryParams),
      () => api.get(`/reports/pricing-analysis${buildQueryString(queryParams)}`),
      { forceRefresh: Boolean(forceRefresh) },
    );
  },
  getSummary: (params = {}, options = {}) => (
    api.get(`/reports/pricing-analysis/summary${buildQueryString(params)}`, options)
  ),
  getRows: (params = {}, options = {}) => (
    api.get(`/reports/pricing-analysis/rows${buildQueryString(params)}`, options)
  ),
  getDetail: (productId, params = {}, options = {}) => (
    api.get(`/reports/pricing-analysis/rows/${encodeURIComponent(productId)}${buildQueryString(params)}`, options)
  ),
  calculateSellPrice: (payload = {}) => (
    api.post('/reports/pricing-analysis/sell-price/calculate', payload)
  ),
  getRecentPriceActions: (params = {}) => (
    api.get(`/reports/pricing-analysis/price-actions/recent${buildQueryString(params)}`)
  ),
  applyBulkPriceUpdate: async (payload = {}) => {
    const result = await api.post('/reports/pricing-analysis/price-actions/bulk-update', payload);
    invalidateSessionCache((key) => key.startsWith('pricing-analysis:') || key.startsWith('products:'));
    return result;
  },
  applyTemporaryPriceAction: async (payload = {}) => {
    const result = await api.post('/reports/pricing-analysis/price-actions/temporary', payload);
    invalidateSessionCache((key) => key.startsWith('pricing-analysis:') || key.startsWith('products:'));
    return result;
  },
  skipPricingDecision: async (payload = {}) => {
    const result = await api.post('/reports/pricing-analysis/price-actions/skip', payload);
    invalidateSessionCache((key) => key.startsWith('pricing-analysis:'));
    return result;
  },
  rollbackPriceAction: async (actionId) => {
    const result = await api.post(`/reports/pricing-analysis/price-actions/${encodeURIComponent(actionId)}/rollback`, {});
    invalidateSessionCache((key) => key.startsWith('pricing-analysis:') || key.startsWith('products:'));
    return result;
  },
  approveSellPrice: async (payload = {}) => {
    const result = await api.post('/reports/pricing-analysis/sell-price/approve', payload);
    invalidateSessionCache((key) => key.startsWith('pricing-analysis:') || key.startsWith('products:'));
    return result;
  },
  invalidateCache: () => invalidateSessionCache((key) => key.startsWith('pricing-analysis:')),
};
