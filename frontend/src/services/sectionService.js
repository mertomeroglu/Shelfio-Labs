import { api, getOrLoadSessionCache, hasSessionCache, invalidateSessionCache } from './api.js';

const SECTION_LIST_CACHE_KEY = 'sections:list';
const invalidateSectionCache = () => invalidateSessionCache((key) => key.startsWith('sections:') || key.startsWith('products:'));
const withArrayResponseMeta = (rows) => {
  const normalized = Array.isArray(rows) ? rows : [];
  if (rows?.meta && normalized && typeof normalized === 'object') {
    try {
      Object.defineProperty(normalized, 'meta', {
        value: rows.meta,
        enumerable: false,
        configurable: true,
      });
    } catch {
      normalized.meta = rows.meta;
    }
  }
  return normalized;
};

export const sectionService = {
  list: (options = {}) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    return getOrLoadSessionCache(SECTION_LIST_CACHE_KEY, async () => withArrayResponseMeta(await api.get('/sections')), { forceRefresh });
  },
  hasListCache: () => hasSessionCache(SECTION_LIST_CACHE_KEY),
  getById: (id) => api.get(`/sections/${id}`),
  getProducts: (id) => api.get(`/sections/${id}/products`),
  listTransferRequests: (params = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.append(key, value);
      }
    });
    const query = searchParams.toString();
    return api.get(`/sections/transfer-requests${query ? `?${query}` : ''}`);
  },
  createTransferRequest: (sectionId, payload) => api.post(`/sections/${sectionId}/transfer-requests`, payload),
  updateTransferRequestStatus: (requestId, payload) => api.patch(`/sections/transfer-requests/${requestId}/status`, payload),
  create: async (payload) => {
    const result = await api.post('/sections', payload);
    invalidateSectionCache();
    return result;
  },
  update: async (id, payload) => {
    const result = await api.put(`/sections/${id}`, payload);
    invalidateSectionCache();
    return result;
  },
  remove: async (id) => {
    const result = await api.delete(`/sections/${id}`);
    invalidateSectionCache();
    return result;
  },
};
