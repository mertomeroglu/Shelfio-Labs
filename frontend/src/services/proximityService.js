import { customerPortalRequest, refreshCustomerSession } from './customerPortalAuthService.js';

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
    return { valid: false, reason: 'MISSING_BEACON_IDENTITY' };
  }

  return {
    valid: true,
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
  sendEvent(payload) {
    return customerPortalRequest('/proximity/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  async sendEventWithAuthRetry(payload) {
    const response = await this.sendEvent(payload);
    if (response?.shouldNotify === false && response?.reason === 'NOT_AUTHENTICATED') {
      await refreshCustomerSession();
      return this.sendEvent(payload);
    }
    return response;
  },
};
