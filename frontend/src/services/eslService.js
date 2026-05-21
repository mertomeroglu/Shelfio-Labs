import { api } from './api.js';

export const eslService = {
  listDevices: () => api.get('/esl/devices'),
  getDevice: (id) => api.get(`/esl/devices/${id}`),
  createDevice: (payload) => api.post('/esl/devices', payload),
  updateDevice: (id, payload) => api.put(`/esl/devices/${id}`, payload),
  deleteDevice: (id) => api.delete(`/esl/devices/${id}`),
  sendToDevice: (payload) => api.post('/esl/send', payload),
  listHistory: (params) => {
    const query = new URLSearchParams();
    if (params?.deviceId) query.append('deviceId', params.deviceId);
    if (params?.productId) query.append('productId', params.productId);
    const qs = query.toString();
    return api.get(`/esl/history${qs ? `?${qs}` : ''}`);
  },
  getStats: () => api.get('/esl/stats'),
  getCurrentLabel: (deviceId) => api.get(`/esl/devices/${deviceId}/current-label`),
  clearLabel: (deviceId) => api.post(`/esl/devices/${deviceId}/clear-label`),
  clearHistory: () => api.delete('/esl/history'),
};

