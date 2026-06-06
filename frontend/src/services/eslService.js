import { api } from './api.js';

const CACHE_TTL_MS = 15000;
const cache = new Map();
const pendingCache = new Map();

const cacheKey = (key, params = null) => `${key}:${params ? JSON.stringify(params) : ''}`;

const getCached = (key) => {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const withShortCache = async (key, loader, options = {}) => {
  if (!options?.forceRefresh) {
    const cached = getCached(key);
    if (cached !== null) return cached;
    if (pendingCache.has(key)) return pendingCache.get(key);
  }

  const pending = loader()
    .then((value) => {
      cache.set(key, { value, createdAt: Date.now() });
      return value;
    })
    .finally(() => {
      pendingCache.delete(key);
    });

  pendingCache.set(key, pending);
  return pending;
};

const clearEslCache = () => {
  cache.clear();
  pendingCache.clear();
};

export const eslService = {
  listDevices: (options) => withShortCache(cacheKey('devices'), () => api.get('/esl/devices'), options),
  getDevice: (id) => api.get(`/esl/devices/${id}`),
  createDevice: (payload) => api.post('/esl/devices', payload),
  updateDevice: (id, payload) => api.put(`/esl/devices/${id}`, payload),
  deleteDevice: (id) => api.delete(`/esl/devices/${id}`),
  sendToDevice: async (payload) => {
    const result = await api.post('/esl/send', payload);
    clearEslCache();
    return result;
  },
  listHistory: (params = {}) => {
    const query = new URLSearchParams();
    if (params?.deviceId) query.append('deviceId', params.deviceId);
    if (params?.productId) query.append('productId', params.productId);
    if (params?.page) query.append('page', params.page);
    if (params?.limit) query.append('limit', params.limit);
    const qs = query.toString();
    return withShortCache(
      cacheKey('history', Object.fromEntries(query.entries())),
      () => api.get(`/esl/history${qs ? `?${qs}` : ''}`),
      params
    );
  },
  getStats: (options) => withShortCache(cacheKey('stats'), () => api.get('/esl/stats'), options),
  getCurrentLabel: (deviceId) => api.get(`/esl/devices/${deviceId}/current-label`),
  clearLabel: async (deviceId) => {
    const result = await api.post(`/esl/devices/${deviceId}/clear-label`);
    clearEslCache();
    return result;
  },
  clearHistory: async () => {
    const result = await api.delete('/esl/history');
    clearEslCache();
    return result;
  },
};
