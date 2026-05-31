import { config } from '../config/config.js';
import {
  getLicenseControlPublicState,
  isLicenseControlEnabled,
  isLicenseControlConfigured,
  isShadowMode,
} from './licenseControlConfig.js';

const CONTROL_CACHE = new Map();
const SENSITIVE_KEYS = /(password|pass|token|secret|authorization|cookie|code|licensekey|rawlicense|refresh)/i;

const sanitizeForLog = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 5) return '[max-depth]';
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeForLog(item, depth + 1));

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SENSITIVE_KEYS.test(key) ? '***' : sanitizeForLog(entry, depth + 1),
  ]));
};

const buildUrl = (path, query = {}) => {
  const base = String(config.getshelfioControlApiUrl || '').replace(/\/+$/, '');
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
};

const readJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const normalizeControlResponse = (payload) => {
  const data = payload?.data ?? payload;
  return {
    ok: payload?.success !== false,
    data,
    meta: payload?.meta || null,
  };
};

const requestControl = async (path, options = {}) => {
  if (!isLicenseControlConfigured()) {
    const error = new Error('GETSHELFIO_CONTROL_API_URL veya GETSHELFIO_CONTROL_SECRET eksik.');
    error.code = 'control_not_configured';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.licenseControlTimeoutMs);
  const url = buildUrl(path, options.query);

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Shelfio-Control-Secret': config.getshelfioControlSecret,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload?.success === false) {
      const error = new Error(payload?.message || `getshelfio Control API ${response.status}`);
      error.status = response.status;
      error.payload = sanitizeForLog(payload);
      throw error;
    }
    return normalizeControlResponse(payload);
  } finally {
    clearTimeout(timeout);
  }
};

const cached = async (key, loader) => {
  const now = Date.now();
  const current = CONTROL_CACHE.get(key);
  if (current && current.expiresAt > now) return current.value;
  const value = await loader();
  CONTROL_CACHE.set(key, {
    value,
    expiresAt: now + config.licenseControlCacheTtlSeconds * 1000,
  });
  return value;
};

const safeCall = async (action, loader) => {
  try {
    return { success: true, ...(await loader()) };
  } catch (error) {
    return {
      success: false,
      error: {
        message: error?.name === 'AbortError' ? 'getshelfio Control API timeout' : (error?.message || 'Control API hatası'),
        code: error?.code || '',
        status: error?.status || 0,
        action,
      },
    };
  }
};

export const getshelfioControlClient = {
  sanitizeForLog,

  controlHealth() {
    return requestControl('/health');
  },

  getUserByEmail(email) {
    return requestControl('/users/by-email', { query: { email } });
  },

  getTenantEntitlements(tenantId) {
    return cached(`entitlements:${tenantId}`, () => requestControl(`/tenants/${encodeURIComponent(tenantId)}/entitlements`));
  },

  getLicenseStatus({ email, tenantId } = {}) {
    return cached(`license:${email || ''}:${tenantId || ''}`, () =>
      requestControl('/licenses/status', { query: { email, tenantId } }));
  },

  exchangeSsoCode(code) {
    return requestControl('/sso/exchange', {
      method: 'POST',
      body: { code },
    });
  },

  async writeControlAudit(payload = {}) {
    try {
      return await requestControl('/audit', {
        method: 'POST',
        body: sanitizeForLog(payload),
      });
    } catch {
      return { ok: false, data: null };
    }
  },

  async safeShadowCheck(context = {}) {
    if (!isShadowMode()) {
      return { success: true, skipped: true, reason: 'not_shadow_mode', ...getLicenseControlPublicState() };
    }

    return safeCall('safeShadowCheck', async () => {
      const result = await this.getLicenseStatus({
        email: context.email,
        tenantId: context.tenantId,
      });
      await this.writeControlAudit({
        action: 'main_app_shadow_license_check',
        tenantId: context.tenantId || '',
        email: context.email || '',
        result: sanitizeForLog(result.data),
      });
      return { skipped: false, data: result.data, ...getLicenseControlPublicState() };
    });
  },

  async safeHealth() {
    if (!isLicenseControlEnabled()) {
      return { success: true, skipped: true, reachable: null, ...getLicenseControlPublicState() };
    }
    return safeCall('controlHealth', async () => {
      const result = await this.controlHealth();
      return { skipped: false, reachable: true, data: result.data, ...getLicenseControlPublicState() };
    });
  },
};
