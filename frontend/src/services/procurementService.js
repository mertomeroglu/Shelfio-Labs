import { api, buildQueryString, getOrLoadSessionCache, hasSessionCache, invalidateSessionCache } from './api.js';

const getSupplierProductsCacheKey = (params = {}) => {
  const query = buildQueryString(params);
  return `procurement:supplier-products:${query || 'default'}`;
};

const invalidateProcurementCache = () => invalidateSessionCache((key) => key.startsWith('procurement:') || key.startsWith('products:'));

const DEFAULT_SUPPLIER_PRODUCTS_LIMIT = 50;
const FULL_FETCH_SUPPLIER_PRODUCTS_LIMIT = 250;

const getPaginationMeta = (rows) => rows?.meta?.pagination || null;

const shouldFetchSingleSupplierProductsPage = (params = {}) => (
  params.fetchAll !== true
  || params.page !== undefined
  || params.cursor !== undefined
  || params.paginationMode !== undefined
  || params.mode !== undefined
);

const normalizeSupplierProductRows = (rows) => {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeSupplierProduct);
  if (rows?.meta) {
    try {
      Object.defineProperty(normalizedRows, 'meta', {
        value: rows.meta,
        enumerable: false,
        configurable: true,
      });
    } catch {
      normalizedRows.meta = rows.meta;
    }
  }
  return normalizedRows;
};

const fetchSupplierProductsRows = async (queryParams = {}, requestOptions = {}) => {
  if (shouldFetchSingleSupplierProductsPage(queryParams)) {
    const { fetchAll, ...singleParams } = queryParams;
    const rows = await api.get(`/procurement/supplier-products${buildQueryString({
      page: 1,
      limit: DEFAULT_SUPPLIER_PRODUCTS_LIMIT,
      ...singleParams,
    })}`, requestOptions);
    return Array.isArray(rows) ? rows : [];
  }

  const { fetchAll, ...baseParams } = queryParams;
  const allRows = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const rows = await api.get(`/procurement/supplier-products${buildQueryString({
      ...baseParams,
      page,
      limit: FULL_FETCH_SUPPLIER_PRODUCTS_LIMIT,
    })}`, requestOptions);
    if (Array.isArray(rows)) allRows.push(...rows);
    const pagination = getPaginationMeta(rows);
    hasNextPage = Boolean(pagination?.hasNextPage);
    page += 1;
    if (!pagination || page > 500) break;
  }

  return allRows;
};

const normalizeSupplierProduct = (item = {}) => ({
  ...item,
  productSku: item.productSku || item.sku || '-',
  sku: item.sku || item.productSku || '-',
  supplierCode: item.supplierCode || item.code || item.supplierId,
  isPrimary: Boolean(item.isPrimary ?? item.isDefault),
  minOrderQtyCases: Number(item.minOrderQtyCases ?? item.minimumOrderCaseQty ?? item.moqCases ?? item.minimumOrderQty ?? 1),
  referencePurchasePrice: Number(item.referencePurchasePrice ?? item.purchasePrice ?? 0),
  moqUnitPrice: Number(item.moqUnitPrice ?? item.purchasePrice ?? 0),
  bulk10PlusUnitPrice: item.bulk10PlusUnitPrice ?? item.tierPrice10Case ?? null,
  storageType: item.storageType || item.storageCondition || 'Ortam',
});

export const procurementService = {
  listSupplierProducts: (params = {}, requestOptions = {}) => {
    const { forceRefresh = false, ...queryParams } = params || {};
    const cacheKey = getSupplierProductsCacheKey(queryParams);
    const hasAbortSignal = Boolean(requestOptions?.signal);
    if (hasAbortSignal) {
      return fetchSupplierProductsRows(queryParams, requestOptions).then(normalizeSupplierProductRows);
    }
    return getOrLoadSessionCache(
      cacheKey,
      () => fetchSupplierProductsRows(queryParams).then(normalizeSupplierProductRows),
      { forceRefresh: Boolean(forceRefresh) }
    );
  },
  hasSupplierProductsCache: (params = {}) => {
    const { forceRefresh, ...queryParams } = params || {};
    return hasSessionCache(getSupplierProductsCacheKey(queryParams));
  },
  createSupplierProduct: async (payload) => {
    const result = await api.post('/procurement/supplier-products', payload);
    invalidateProcurementCache();
    return result;
  },
  updateSupplierProduct: async (id, payload) => {
    const result = await api.put(`/procurement/supplier-products/${id}`, payload);
    invalidateProcurementCache();
    return result;
  },
  removeSupplierProduct: async (id) => {
    const result = await api.delete(`/procurement/supplier-products/${id}`);
    invalidateProcurementCache();
    return result;
  },

  generateSuggestions: async (payload = {}) => {
    const result = await api.post('/procurement/suggestions/generate', payload, { cache: 'no-store' });
    invalidateProcurementCache();
    return result;
  },
  listSuggestions: (params = {}) => api.get(`/procurement/suggestions${buildQueryString(params)}`, { cache: 'no-store' }),
  getSuggestionSummary: (params = {}) => api.get(`/procurement/suggestions/summary${buildQueryString(params)}`, { cache: 'no-store' }),
  updateSuggestion: (id, payload) => api.patch(`/procurement/suggestions/${id}`, payload),
  approveSuggestion: (id, payload = {}) => api.post(`/procurement/suggestions/${id}/approve`, payload),
  rejectSuggestion: (id) => api.post(`/procurement/suggestions/${id}/reject`, {}),

  listOrders: (params = {}) => api.get(`/procurement/orders${buildQueryString(params)}`),
  createOrder: (payload) => api.post('/procurement/orders', payload),
  getOrderItems: (id) => api.get(`/procurement/orders/${id}/items`),
  updateOrderStatus: (id, payload) => api.patch(`/procurement/orders/${id}/status`, payload),
  listLogisticsTariffs: (params = {}) => api.get(`/procurement/logistics-tariffs${buildQueryString(params)}`),
  getLogisticsQuote: (payload = {}) => api.post('/procurement/logistics-quote', payload),

  listCatalogImports: (params = {}) => api.get(`/procurement/catalog-imports${buildQueryString(params)}`),
  listCatalogApprovalQueue: (params = {}) => api.get(`/procurement/catalog-approval-queue${buildQueryString(params)}`),
  matchCatalogApprovalQueueRow: (rowId, payload = {}) => api.post(`/procurement/catalog-approval-queue/${encodeURIComponent(rowId)}/match`, payload),
  createCatalogApprovalQueueDraft: (rowId, payload = {}) => api.post(`/procurement/catalog-approval-queue/${encodeURIComponent(rowId)}/create-draft`, payload),
  rejectCatalogApprovalQueueRow: (rowId, payload = {}) => api.post(`/procurement/catalog-approval-queue/${encodeURIComponent(rowId)}/reject`, payload),
  undoCatalogApprovalQueueDecision: (rowId, payload = {}) => api.post(`/procurement/catalog-approval-queue/${encodeURIComponent(rowId)}/undo`, payload),
  previewCatalogImport: (payload) => api.post('/procurement/catalog-imports/preview', payload),
  updateCatalogImportRow: (importId, rowId, payload) => api.patch(`/procurement/catalog-imports/${importId}/rows/${rowId}`, payload),
  commitCatalogImport: (importId, payload = {}) => api.post(`/procurement/catalog-imports/${importId}/commit`, payload),
  listCatalogVersions: (params = {}) => api.get(`/procurement/catalog-versions${buildQueryString(params)}`),
  getCatalogVersionRows: (versionId) => api.get(`/procurement/catalog-versions/${versionId}/rows`),
  activateCatalogVersion: (versionId) => api.post(`/procurement/catalog-versions/${versionId}/activate`, {}),
};
