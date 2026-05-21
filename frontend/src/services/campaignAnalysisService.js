import { api, buildQueryString, getOrLoadSessionCache } from './api.js';

const getSuggestionsCacheKey = (params = {}) => `campaign-analysis:suggestions:${buildQueryString(params) || 'default'}`;

export const campaignAnalysisService = {
  getSuggestions: (params = {}) => {
    const { forceRefresh = false, ...queryParams } = params || {};
    return getOrLoadSessionCache(
      getSuggestionsCacheKey(queryParams),
      () => api.get(`/campaign-analysis/suggestions${buildQueryString(queryParams)}`),
      { forceRefresh: Boolean(forceRefresh) },
    );
  },
  simulate: (payload = {}) => api.post('/campaign-analysis/simulate', payload),
};
