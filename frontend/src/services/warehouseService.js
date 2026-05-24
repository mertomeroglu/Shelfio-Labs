import { api, buildQueryString, getOrLoadSessionCache, hasSessionCache, invalidateSessionCache } from './api.js';

const WAREHOUSE_CACHE_PREFIX = 'warehouse:v1';
const getLocationListCacheKey = (params = {}) => `${WAREHOUSE_CACHE_PREFIX}:locations:${buildQueryString(params) || 'default'}`;
export const invalidateWarehouseCache = () => invalidateSessionCache((key) => key.startsWith(WAREHOUSE_CACHE_PREFIX));

const normalizeLocationRow = (row = {}) => ({
  ...row,
  locationType: row.locationType || 'depo',
  occupancyStatus: row.occupancyStatus || row.status || '',
  assignedSkuCount: Number(row.assignedSkuCount ?? (Array.isArray(row.assignedSkus) ? row.assignedSkus.length : (row.sku ? 1 : 0))),
  assignedSkus: Array.isArray(row.assignedSkus) ? row.assignedSkus : (row.sku ? [row.sku] : []),
  capacity: Number(row.capacity ?? row.palletCapacity ?? 1),
  palletCapacity: Number(row.palletCapacity ?? row.capacity ?? 1),
});

export const warehouseService = {
  listLocations: (params = {}) => {
    const { forceRefresh = false, ...queryParams } = params || {};
    return getOrLoadSessionCache(
      getLocationListCacheKey(queryParams),
      () => api.get(`/warehouse/locations${buildQueryString(queryParams)}`).then((result) => ({
        ...result,
        rows: Array.isArray(result?.rows) ? result.rows.map(normalizeLocationRow) : [],
        depotAssignments: Array.isArray(result?.depotAssignments) ? result.depotAssignments : [],
        depotZones: Array.isArray(result?.depotZones) ? result.depotZones : [],
        shelfPlan: Array.isArray(result?.shelfPlan) ? result.shelfPlan : [],
        shelfZones: Array.isArray(result?.shelfZones) ? result.shelfZones : [],
      })),
      { forceRefresh: Boolean(forceRefresh) }
    );
  },
  hasLocationsCache: (params = {}) => hasSessionCache(getLocationListCacheKey(params)),
  getSummary: () => api.get('/warehouse/summary'),
  listMovements: (params = {}) => api.get(`/warehouse/movements${buildQueryString(params)}`),
  createMovement: async (payload) => {
    const result = await api.post('/warehouse/movements', payload);
    invalidateWarehouseCache();
    return result;
  },
  updateLocation: async (id, payload) => {
    const result = await api.patch(`/warehouse/locations/${id}`, payload);
    invalidateWarehouseCache();
    return result;
  },
};
