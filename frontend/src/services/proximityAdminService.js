import { api, buildQueryString } from './api.js';

const PROXIMITY_ADMIN_BASE = '/proximity';

export const proximityAdminService = {
  getBeacons: (params = {}) => api.get(`${PROXIMITY_ADMIN_BASE}/beacons${buildQueryString(params)}`),
  createBeacon: (payload) => api.post(`${PROXIMITY_ADMIN_BASE}/beacons`, payload),
  updateBeacon: (id, payload) => api.patch(`${PROXIMITY_ADMIN_BASE}/beacons/${id}`, payload),
  updateBeaconStatus: (id, status) => api.patch(`${PROXIMITY_ADMIN_BASE}/beacons/${id}/status`, { status }),

  getZones: (params = {}) => api.get(`${PROXIMITY_ADMIN_BASE}/zones${buildQueryString(params)}`),
  createZone: (payload) => api.post(`${PROXIMITY_ADMIN_BASE}/zones`, payload),
  updateZone: (id, payload) => api.patch(`${PROXIMITY_ADMIN_BASE}/zones/${id}`, payload),

  getRules: (params = {}) => api.get(`${PROXIMITY_ADMIN_BASE}/rules${buildQueryString(params)}`),
  createRule: (payload) => api.post(`${PROXIMITY_ADMIN_BASE}/rules`, payload),
  updateRule: (id, payload) => api.patch(`${PROXIMITY_ADMIN_BASE}/rules/${id}`, payload),
  updateRuleStatus: (id, isActive) => api.patch(`${PROXIMITY_ADMIN_BASE}/rules/${id}/status`, { isActive }),

  getEvents: (params = {}) => api.get(`${PROXIMITY_ADMIN_BASE}/events${buildQueryString(params)}`),
  getDeliveries: (params = {}) => api.get(`${PROXIMITY_ADMIN_BASE}/deliveries${buildQueryString(params)}`),
};
