import { api, getOrLoadSessionCache, hasSessionCache, invalidateSessionCache } from './api.js';

const SUPPLIER_LIST_CACHE_KEY = 'suppliers:list';
const invalidateSupplierCache = () => invalidateSessionCache((key) => key.startsWith('suppliers:') || key.startsWith('products:') || key.startsWith('procurement:'));

const normalizeSupplier = (item = {}) => ({
  ...item,
  supplierId: item.supplierId || item.id,
  supplierName: item.supplierName || item.name || '-',
  code: item.code || item.supplierCode || item.id,
  supplierCode: item.supplierCode || item.code || item.id,
  type: item.type || item.tedarikciTuru || '',
  tedarikciTuru: item.tedarikciTuru || item.type || '',
  status: item.status || (item.isActive === false ? 'inactive' : 'active'),
  coveredCategories: Array.isArray(item.coveredCategories) ?
    item.coveredCategories
    : Array.isArray(item.categories) ?
      item.categories
      : [],
  gecikmeDurumu: item.gecikmeDurumu || item.delayStatus || '',
  delayStatus: item.delayStatus || item.gecikmeDurumu || '',
});

export const supplierService = {
  list: (options = {}) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    return getOrLoadSessionCache(
      SUPPLIER_LIST_CACHE_KEY,
      () => api.get('/suppliers').then((rows) => (Array.isArray(rows) ? rows.map(normalizeSupplier) : [])),
      { forceRefresh }
    );
  },
  hasListCache: () => hasSessionCache(SUPPLIER_LIST_CACHE_KEY),
  create: async (payload) => {
    const result = await api.post('/suppliers', payload);
    invalidateSupplierCache();
    return result;
  },
  update: async (id, payload) => {
    const result = await api.put(`/suppliers/${id}`, payload);
    invalidateSupplierCache();
    return result;
  },
  remove: async (id) => {
    const result = await api.delete(`/suppliers/${id}`);
    invalidateSupplierCache();
    return result;
  },
};
