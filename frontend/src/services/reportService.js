import { api, API_BASE_URL, buildQueryString, getAuthToken, getStoredUser } from './api.js';

export const reportService = {
  getDashboard: (options = {}) => api.get('/reports/dashboard', options),
  getSummary: (params = {}, options = {}) => api.get(`/reports/summary${buildQueryString(params)}`, options),
  getSection: (section, params = {}, options = {}) => api.get(`/reports/sections/${encodeURIComponent(section)}${buildQueryString(params)}`, options),
  getPricingAnalysis: (params = {}, options = {}) => api.get(`/reports/pricing-analysis${buildQueryString(params)}`, options),
  globalSearch: (q) => api.get(`/reports/search?q=${encodeURIComponent(q)}`),
  getLastStockUpdate: () => api.get('/reports/last-update'),
  downloadSectionXlsx: async (section, params = {}) => {
    const token = getAuthToken();
    const storedUser = getStoredUser();
    const ownerEmail = String(storedUser?.email || storedUser?.username || '').trim();
    const query = buildQueryString({ section, ...params });
    const headers = {};

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (ownerEmail) {
      headers['x-owner-email'] = ownerEmail;
    }

    const response = await fetch(`${API_BASE_URL}/reports/export-xlsx${query}`, {
      headers,
    });

    if (!response.ok) {
      let message = 'Excel raporu indirilemedi';
      try {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const errorPayload = await response.json();
          message = errorPayload?.message || message;
        } else {
          const textPayload = await response.text();
          if (textPayload) {
            message = textPayload;
          }
        }
      } catch {
        // ignore parse errors
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const fileName = match?.[1] || `${section || 'rapor'}.xlsx`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
