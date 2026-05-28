import { customerPortalRequest, refreshCustomerSession, customerPortalAuthService } from './customerPortalAuthService.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const EVENT_TYPE_ALIASES = new Map([
  ['ZONE_STAY', 'DWELL'],
  ['STAY', 'DWELL'],
  ['DWELL', 'DWELL'],
  ['ZONE_STAY_CHECK', 'DWELL'],
]);
const ALLOWED_EVENT_TYPES = new Set(['ZONE_ENTER', 'ZONE_EXIT', 'DWELL']);
const FRONTEND_SOURCE = 'WEBVIEW_BRIDGE';

const normalizeText = (value) => String(value || '').trim();

const parseOptionalInteger = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
};

export function normalizeNativeBeaconEvent(detail = {}) {
  if (!detail || typeof detail !== 'object') {
    return { valid: false, reason: 'INVALID_DETAIL' };
  }

  const deviceId = normalizeText(detail.deviceId || detail.deviceCode);
  const uuid = normalizeText(detail.uuid);
  const major = parseOptionalInteger(detail.major);
  const minor = parseOptionalInteger(detail.minor);
  const rssi = Number(detail.rssi);
  const rawEventType = normalizeText(detail.eventType || detail.checkType).toUpperCase();
  const eventType = EVENT_TYPE_ALIASES.get(rawEventType) || rawEventType;
  const detectedAt = normalizeText(detail.detectedAt) || new Date().toISOString();

  if (!Number.isFinite(rssi)) {
    return { valid: false, reason: 'INVALID_RSSI' };
  }

  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    return { valid: false, reason: 'INVALID_EVENT_TYPE' };
  }

  if (!deviceId && (!uuid || major === null || minor === null)) {
    return { valid: false, reason: 'INVALID_DEVICE_IDENTITY' };
  }

  return {
    valid: true,
    raw: {
      eventType: normalizeText(detail.eventType).toUpperCase(),
      checkType: normalizeText(detail.checkType).toUpperCase(),
    },
    payload: {
      ...(deviceId ? { deviceId } : {}),
      ...(uuid ? { uuid } : {}),
      ...(major !== null ? { major } : {}),
      ...(minor !== null ? { minor } : {}),
      rssi: Math.trunc(rssi),
      eventType,
      source: FRONTEND_SOURCE,
      detectedAt,
    },
  };
}

export function getBeaconCooldownKey(payload = {}) {
  return [
    payload.deviceId || '',
    payload.uuid || '',
    payload.major ?? '',
    payload.minor ?? '',
    payload.eventType || '',
  ].join(':');
}

export const proximityService = {
  /** POST with customer auth token (via customerPortalRequest). */
  sendEvent(payload) {
    return customerPortalRequest('/proximity/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * POST without auth token — used when customer is not logged in.
   * The backend will still create a ProximityEvent record for diagnostics.
   */
  async sendEventRaw(payload) {
    const res = await fetch(`${API_BASE_URL}/proximity/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return data?.data ?? data;
  },

  /**
   * Smart POST: tries auth first, falls back to raw if auth fails.
   * Always ensures the event reaches the backend.
   */
  async sendEventWithAuthRetry(payload, { onRetryAfterRefresh, onRefreshFailed, onUnauthenticated } = {}) {
    // If not logged in at all, send raw (no auth header)
    if (!customerPortalAuthService.isLoggedIn()) {
      if (typeof onUnauthenticated === 'function') onUnauthenticated();
      return this.sendEventRaw(payload);
    }

    try {
      const response = await this.sendEvent(payload);
      if (response?.shouldNotify === false && response?.reason === 'NOT_AUTHENTICATED') {
        try {
          await refreshCustomerSession();
          if (typeof onRetryAfterRefresh === 'function') onRetryAfterRefresh(response);
          return this.sendEvent(payload);
        } catch (error) {
          if (typeof onRefreshFailed === 'function') onRefreshFailed(error, response);
          // Even if refresh fails, the first response already has eventRecorded:true
          return response;
        }
      }
      return response;
    } catch (error) {
      // Auth completely broken — fallback to raw POST so event is still recorded
      if (typeof onUnauthenticated === 'function') onUnauthenticated();
      return this.sendEventRaw(payload);
    }
  },
};
