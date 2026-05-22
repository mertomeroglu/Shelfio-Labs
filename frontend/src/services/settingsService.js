import { api, invalidateSessionCache } from './api.js';
import { API_BASE_URL, buildQueryString, getAuthToken, getOrLoadSessionCache } from './api.js';
import { isRequestCancellation } from './api.js';

let lastDeveloperLogFailureAt = 0;
const DEVELOPER_LOG_FAILURE_COOLDOWN_MS = 60 * 1000;
const SETTINGS_UPDATED_EVENT = 'shelfio:settings-updated';

const emitSettingsUpdated = (settings) => {
  if (typeof window === 'undefined') return settings;
  window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT, { detail: settings }));
  return settings;
};

const includesCampaignSettings = (payload = {}) => (
  Object.prototype.hasOwnProperty.call(payload?.customerRelations || {}, 'campaigns')
);

const invalidateCampaignPricingCaches = () => {
  invalidateSessionCache((key) => key.startsWith('products:') || key.startsWith('pricing-analysis:') || key.startsWith('campaign-analysis:'));
};

export const settingsService = {
  get: (options = {}) => getOrLoadSessionCache('settings:current', () => api.get('/settings'), {
    forceRefresh: options.forceRefresh === true,
  }),
  update: async (payload) => {
    const settings = await api.put('/settings', payload);
    invalidateSessionCache('settings:current');
    if (includesCampaignSettings(payload)) {
      invalidateCampaignPricingCaches();
    }
    return emitSettingsUpdated(settings);
  },
  getLogisticsTariffs: () => api.get('/settings/logistics-tariffs'),
  updateLogisticsTariffs: (payload) => api.put('/settings/logistics-tariffs', payload),
  getLogisticsQuote: (payload) => api.post('/settings/logistics-quote', payload),
  getLoginActivities: (params = 30) => {
    const query = typeof params === 'number' ? { limit: params } : (params || {});
    return api.get(`/settings/login-activities${buildQueryString(query)}`);
  },
  getAuditLogs: (params = 100) => {
    const query = typeof params === 'number' ? { limit: params } : (params || {});
    return api.get(`/settings/audit-logs${buildQueryString(query)}`);
  },
  getDeveloperLogs: (filters = {}) => api.get(`/settings/developer-logs${buildQueryString(filters)}`),
  clearLogs: (type) => api.delete(`/settings/logs/${encodeURIComponent(type)}`),
  exportAuditLogs: async (format = 'xlsx') => {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE_URL}/settings/audit-logs/export?format=${encodeURIComponent(format)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      throw new Error('Audit log dışa aktarılamadı');
    }
    if (String(format).toLowerCase() === 'json') {
      const payload = await response.json();
      return payload?.data || [];
    }

    return response.text();
  },
  exportDeveloperLogs: async (format = 'json', filters = {}) => {
    const token = getAuthToken();
    const query = buildQueryString({ ...filters, format });
    const response = await fetch(`${API_BASE_URL}/settings/developer-logs/export${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      throw new Error('Geliştirici logları dışa aktarılamadı');
    }

    if (String(format).toLowerCase() === 'json') {
      const payload = await response.json();
      return payload?.data || [];
    }

    return response.text();
  },
  createDeveloperLog: (payload = {}) => api.post('/settings/developer-logs', payload),
  sendDeveloperLog: async (payload = {}) => {
    if (isRequestCancellation(payload?.error || payload?.cause || payload)) {
      return;
    }
    const token = getAuthToken();
    const endpoint = token ? '/settings/developer-logs' : '/settings/developer-logs/public';
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const now = Date.now();
        if (now - lastDeveloperLogFailureAt > DEVELOPER_LOG_FAILURE_COOLDOWN_MS) {
          lastDeveloperLogFailureAt = now;
          console.warn('Developer log gönderimi başarısız oldu.');
        }
      }
    } catch {
      const now = Date.now();
      if (now - lastDeveloperLogFailureAt > DEVELOPER_LOG_FAILURE_COOLDOWN_MS) {
        lastDeveloperLogFailureAt = now;
        console.warn('Developer log servisine ulaşılamadı.');
      }
    }
  },
  verifyPin: (pin, type = 'pos', deskCode, registerPin) => api.post('/settings/verify-pin', { pin, type, deskCode, registerPin }),
  updateSystemDeskPin: (deskCode, newPin) => api.patch('/settings/system-desk-pin', { deskCode, newPin }),
};

export { SETTINGS_UPDATED_EVENT };
