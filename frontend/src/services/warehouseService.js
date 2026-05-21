import { api, buildQueryString } from './api.js';

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
  listLocations: (params = {}) => api.get(`/warehouse/locations${buildQueryString(params)}`).then((result) => ({
    ...result,
    rows: Array.isArray(result?.rows) ? result.rows.map(normalizeLocationRow) : [],
    depotAssignments: Array.isArray(result?.depotAssignments) ? result.depotAssignments : [],
    depotZones: Array.isArray(result?.depotZones) ? result.depotZones : [],
    shelfPlan: Array.isArray(result?.shelfPlan) ? result.shelfPlan : [],
    shelfZones: Array.isArray(result?.shelfZones) ? result.shelfZones : [],
  })),
  getSummary: () => api.get('/warehouse/summary'),
  listMovements: (params = {}) => api.get(`/warehouse/movements${buildQueryString(params)}`),
  createMovement: (payload) => api.post('/warehouse/movements', payload),
  updateLocation: (id, payload) => api.patch(`/warehouse/locations/${id}`, payload),
};

