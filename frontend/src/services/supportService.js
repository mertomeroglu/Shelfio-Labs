import { api, API_BASE_URL, getAuthToken } from './api.js';

export const supportService = {
  reportSystemError: async (payload = {}) => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json; charset=utf-8' };
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${API_BASE_URL}/support/system-error`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    return response.ok ? response.json() : null;
  },
  createTicket: (payload) => api.post('/support/tickets', payload),
};
