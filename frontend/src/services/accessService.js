import { api, buildQueryString } from './api.js';

export const accessService = {
  createRequest: (payload) => api.post('/access-requests', payload),
  listRequests: (params = {}) => api.get(`/access-requests${buildQueryString(params)}`),
  bulkAction: (payload) => api.post('/access-requests/bulk', payload),
  approveRequest: (id, payload) => api.post(`/access-requests/${id}/approve`, payload),
  rejectRequest: (id, payload) => api.post(`/access-requests/${id}/reject`, payload),
  extendRequest: (id, payload) => api.post(`/access-requests/${id}/extend`, payload),
  revokeGrant: (id) => api.post(`/temporary-grants/${id}/revoke`),
  getEffectivePermissions: () => api.get('/permissions/me/effective'),
};

