import { api, invalidateSessionCache } from './api.js';
import { API_BASE_URL, buildQueryString, getAuthToken, getOrLoadSessionCache } from './api.js';
import { isRequestCancellation } from './api.js';

let lastDeveloperLogFailureAt = 0;
const DEVELOPER_LOG_FAILURE_COOLDOWN_MS = 60 * 1000;
const DEVELOPER_LOG_DUPLICATE_WINDOW_MS = 30 * 1000;
const SETTINGS_UPDATED_EVENT = 'shelfio:settings-updated';
const NOTIFICATION_SOUND_ENABLED_KEY = 'shelfio.toast.sound.enabled';
const NOTIFICATION_SOUND_VOLUME_KEY = 'shelfio.toast.sound.volume';
const NOTIFICATION_SOUND_FILE_KEY = 'shelfio.toast.sound.file';
const developerLogRecentSignatures = new Map();
const SENSITIVE_KEY_PATTERN = /(password|pass|token|secret|authorization|cookie|pin|card|cvv)/i;

const syncNotificationSoundSettings = (settings = {}) => {
  if (typeof window === 'undefined' || !settings || typeof settings !== 'object') return settings;
  try {
    if (Object.prototype.hasOwnProperty.call(settings, 'notificationSoundEnabled')) {
      window.localStorage.setItem(NOTIFICATION_SOUND_ENABLED_KEY, settings.notificationSoundEnabled === false ? 'false' : 'true');
    }
    if (Object.prototype.hasOwnProperty.call(settings, 'notificationSoundVolume')) {
      const volume = Math.max(0, Math.min(100, Math.round(Number(settings.notificationSoundVolume) || 0)));
      window.localStorage.setItem(NOTIFICATION_SOUND_VOLUME_KEY, String(volume));
    }
    if (settings.notificationSound) {
      window.localStorage.setItem(NOTIFICATION_SOUND_FILE_KEY, String(settings.notificationSound));
    }
  } catch {
    // Local storage erisim hatasi uygulama akisini kesmemeli.
  }
  return settings;
};

const emitSettingsUpdated = (settings) => {
  syncNotificationSoundSettings(settings);
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

const maskSensitive = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[max-depth]';
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}...(truncated)` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => maskSensitive(item, depth + 1));

  const next = {};
  Object.entries(value).forEach(([key, raw]) => {
    next[key] = SENSITIVE_KEY_PATTERN.test(key) ? '***' : maskSensitive(raw, depth + 1);
  });
  return next;
};

const getStoredUserForLog = () => {
  try {
    return JSON.parse(localStorage.getItem('stock_tracking_user') || 'null');
  } catch {
    return null;
  }
};

const shouldDropDuplicateDeveloperLog = (payload = {}) => {
  const signature = [
    payload.level,
    payload.source,
    payload.message,
    payload.endpoint,
    payload.stack,
  ].map((value) => String(value || '').trim()).join('|');
  const now = Date.now();
  const previous = developerLogRecentSignatures.get(signature);
  developerLogRecentSignatures.set(signature, now);

  for (const [key, at] of developerLogRecentSignatures.entries()) {
    if (now - at > DEVELOPER_LOG_DUPLICATE_WINDOW_MS) {
      developerLogRecentSignatures.delete(key);
    }
  }

  return previous && now - previous < DEVELOPER_LOG_DUPLICATE_WINDOW_MS;
};

const normalizeDeveloperLogPayload = (payload = {}) => {
  const storedUser = getStoredUserForLog();
  const endpoint = payload.endpoint || (typeof window !== 'undefined' ? window.location.pathname : '');
  const requestUrl = payload.requestUrl || (typeof window !== 'undefined' ? window.location.href : endpoint);

  return maskSensitive({
    timestamp: new Date().toISOString(),
    level: payload.level || 'error',
    source: payload.source || 'frontend',
    message: payload.message || payload.error?.message || 'Bilinmeyen hata',
    action: payload.action || 'frontend_error',
    endpoint,
    requestUrl,
    requestPayload: payload.requestPayload,
    response: payload.response,
    payload: payload.payload,
    stack: payload.stack || payload.error?.stack || '',
    statusCode: payload.statusCode,
    errorType: payload.errorType || 'runtime_error',
    browserInfo: payload.browserInfo || (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    userId: payload.userId || storedUser?.id,
    userName: payload.userName || storedUser?.name || storedUser?.username,
    userRole: payload.userRole || storedUser?.role,
    requestId: payload.requestId,
    correlationId: payload.correlationId || payload.requestId,
    description: payload.description || payload.action || '',
  });
};

export const settingsService = {
  get: async (options = {}) => syncNotificationSoundSettings(await getOrLoadSessionCache('settings:current', () => api.get('/settings'), {
    forceRefresh: options.forceRefresh === true,
  })),
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
    const normalizedPayload = normalizeDeveloperLogPayload(payload);
    if (shouldDropDuplicateDeveloperLog(normalizedPayload)) {
      return;
    }
    const token = getAuthToken();
    if (!token) return;
    const endpoint = '/settings/developer-logs';
    try {
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(normalizedPayload),
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
