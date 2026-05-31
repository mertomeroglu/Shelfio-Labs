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

const controlFailure = (errorCode, status = 0) => ({
  ok: false,
  reachable: false,
  errorCode,
  status,
});

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
  return JSON.parse(text);
};

const normalizeControlResponse = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return controlFailure('control_invalid_response');
  }

  return {
    ok: true,
    reachable: true,
    data: payload.data ?? payload,
    meta: payload.meta || null,
  };
};

const requestControl = async (path, options = {}) => {
  let timeout;

  try {
    if (!isLicenseControlConfigured()) {
      return controlFailure('control_not_configured');
    }

    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), config.licenseControlTimeoutMs);
    const response = await fetch(buildUrl(path, options.query), {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Shelfio-Control-Secret': config.getshelfioControlSecret,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return controlFailure('control_unauthorized', response.status);
    }

    if (!response.ok) {
      return controlFailure('control_unreachable', response.status);
    }

    const payload = await readJsonResponse(response);
    if (payload?.success === false) {
      return controlFailure('control_invalid_response', response.status);
    }

    return normalizeControlResponse(payload);
  } catch (error) {
    if (error?.name === 'AbortError') {
      return controlFailure('control_timeout');
    }

    if (error instanceof SyntaxError) {
      return controlFailure('control_invalid_response');
    }

    return controlFailure('control_unreachable');
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const cached = async (key, loader) => {
  try {
    const now = Date.now();
    const current = CONTROL_CACHE.get(key);
    if (current && current.expiresAt > now) return current.value;
    const value = await loader();
    if (value.ok) {
      CONTROL_CACHE.set(key, {
        value,
        expiresAt: now + config.licenseControlCacheTtlSeconds * 1000,
      });
    }
    return value;
  } catch {
    return controlFailure('control_unreachable');
  }
};

const callPublic = async (loader) => {
  try {
    return await loader();
  } catch {
    return controlFailure('control_unreachable');
  }
};

export const getshelfioControlClient = {
  sanitizeForLog,

  controlHealth() {
    return callPublic(() => requestControl('/health'));
  },

  getUserByEmail(email) {
    return callPublic(() => requestControl('/users/by-email', { query: { email } }));
  },

  getTenantEntitlements(tenantId) {
    return callPublic(() =>
      cached(`entitlements:${tenantId}`, () => requestControl(`/tenants/${encodeURIComponent(tenantId)}/entitlements`)));
  },

  getLicenseStatus({ email, tenantId } = {}) {
    return callPublic(() =>
      cached(`license:${email || ''}:${tenantId || ''}`, () =>
        requestControl('/licenses/status', { query: { email, tenantId } })));
  },

  exchangeSsoCode(code) {
    return callPublic(() => requestControl('/sso/exchange', {
      method: 'POST',
      body: { code },
    }));
  },

  writeControlAudit(payload = {}) {
    return callPublic(() => requestControl('/audit', {
      method: 'POST',
      body: sanitizeForLog(payload),
    }));
  },

  async safeShadowCheck(context = {}) {
    try {
      if (!isShadowMode()) {
        return { success: true, skipped: true, reason: 'not_shadow_mode', ...getLicenseControlPublicState() };
      }

      const result = await this.getLicenseStatus({
        email: context.email,
        tenantId: context.tenantId,
      });
      if (!result.ok) {
        return { success: true, skipped: false, reachable: false, errorCode: result.errorCode, ...getLicenseControlPublicState() };
      }

      await this.writeControlAudit({
        action: 'main_app_shadow_license_check',
        tenantId: context.tenantId || '',
        email: context.email || '',
        result: sanitizeForLog(result.data),
      });
      return { success: true, skipped: false, reachable: true, data: result.data, ...getLicenseControlPublicState() };
    } catch {
      return { success: true, skipped: false, reachable: false, errorCode: 'control_unreachable', ...getLicenseControlPublicState() };
    }
  },

  async safeHealth() {
    try {
      if (!isLicenseControlEnabled()) {
        return { success: true, skipped: true, reachable: null, ...getLicenseControlPublicState() };
      }

      const result = await this.controlHealth();
      return {
        success: true,
        skipped: false,
        reachable: result.ok,
        ...(result.ok ? { data: result.data } : { errorCode: result.errorCode }),
        ...getLicenseControlPublicState(),
      };
    } catch {
      return { success: true, skipped: false, reachable: false, errorCode: 'control_unreachable', ...getLicenseControlPublicState() };
    }
  },
};
