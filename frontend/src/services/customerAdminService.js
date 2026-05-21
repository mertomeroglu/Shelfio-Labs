import { api, buildQueryString, getOrLoadSessionCache, invalidateSessionCache } from './api.js';

const getCustomersCacheKey = (options = {}) => `customers:list:${buildQueryString(options) || 'default'}`;
const invalidateCustomerCaches = () => invalidateSessionCache((key) => key.startsWith('customers:'));

export const customerAdminService = {
  list: (options = {}) => {
    const { forceRefresh = false, ...query } = options || {};
    return getOrLoadSessionCache(
      getCustomersCacheKey(query),
      () => api.get(`/customers${buildQueryString(query)}`),
      { forceRefresh: Boolean(forceRefresh) },
    );
  },
  listAvailableGiftCards: () => api.get('/customers/gift-cards/available'),
  detail: (id) => api.get(`/customers/${id}`),
  create: async (payload) => {
    const result = await api.post('/customers', payload);
    invalidateCustomerCaches();
    return result;
  },
  setStatus: async (id, isActive) => {
    const result = await api.patch(`/customers/${id}/status`, { isActive });
    invalidateCustomerCaches();
    return result;
  },
  assignGiftCard: async (id, payload) => {
    const result = await api.post(`/customers/${id}/gift-cards`, payload);
    invalidateCustomerCaches();
    return result;
  },
  assignGiftCardBulk: async (payload) => {
    const result = await api.post('/customers/gift-cards/bulk-assign', payload);
    invalidateCustomerCaches();
    return result;
  },
  assignDiscount: async (id, payload) => {
    const result = await api.post(`/customers/${id}/discounts`, payload);
    invalidateCustomerCaches();
    return result;
  },
  sendNotification: (payload) => api.post('/customers/notifications/send', payload),
};
