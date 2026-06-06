import { api, buildQueryString } from './api.js';

export const taskService = {
  list: (params = {}) => api.get(`/tasks${buildQueryString(params)}`),
  summary: (params = {}) => api.get(`/tasks/summary${buildQueryString(params)}`),
  getById: (id) => api.get(`/tasks/${id}`),
  create: (payload) => api.post('/tasks', payload),
  update: (id, payload) => api.put(`/tasks/${id}`, payload),
  addComment: (id, payload) => api.post(`/tasks/${id}/comments`, payload),
  toggleStatus: (id) => api.patch(`/tasks/${id}/toggle`),
  remove: (id) => api.delete(`/tasks/${id}`),
};
