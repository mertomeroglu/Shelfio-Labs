import { api, buildQueryString, getOrLoadSessionCache, invalidateSessionCache } from './api.js';

export const userService = {
  list: (options = {}) => getOrLoadSessionCache('users:list', () => api.get('/users'), {
    forceRefresh: options.forceRefresh === true,
  }),
  listActivities: (id, params = {}) => api.get(`/users/${id}/activities${buildQueryString(params)}`),
  search: (query) => api.get(`/users${buildQueryString({ search: query })}`),
  create: async (payload) => {
    const result = await api.post('/users', payload);
    invalidateSessionCache('users:list');
    return result;
  },
  update: async (id, payload) => {
    const result = await api.put(`/users/${id}`, payload);
    invalidateSessionCache('users:list');
    return result;
  },
  remove: async (id) => {
    const result = await api.delete(`/users/${id}`);
    invalidateSessionCache('users:list');
    return result;
  },
};
