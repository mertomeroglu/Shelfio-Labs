import { api, getOrLoadSessionCache, hasSessionCache, invalidateSessionCache } from './api.js';

const CATEGORY_LIST_CACHE_KEY = 'categories:list';
const invalidateCategoryCache = () => invalidateSessionCache((key) => key.startsWith('categories:') || key.startsWith('products:'));
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

export const categoryService = {
  list: (options = {}) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    return getOrLoadSessionCache(CATEGORY_LIST_CACHE_KEY, async () => withArrayResponseMeta(await api.get('/categories')), { forceRefresh });
  },
  hasListCache: () => hasSessionCache(CATEGORY_LIST_CACHE_KEY),
  create: async (payload) => {
    const result = await api.post('/categories', payload);
    invalidateCategoryCache();
    return result;
  },
  update: async (id, payload) => {
    const result = await api.put(`/categories/${id}`, payload);
    invalidateCategoryCache();
    return result;
  },
  remove: async (id) => {
    const result = await api.delete(`/categories/${id}`);
    invalidateCategoryCache();
    return result;
  },
  listLabels: (options = {}) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    return getOrLoadSessionCache('categories:labels:list', async () => withArrayResponseMeta(await api.get('/categories/labels')), { forceRefresh });
  },
  syncLabels: async () => {
    const result = await api.post('/categories/labels/sync', {});
    invalidateCategoryCache();
    invalidateSessionCache((key) => key.startsWith('categories:labels:'));
    return result;
  },
};
