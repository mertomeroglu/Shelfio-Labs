import { api, buildQueryString, getOrLoadSessionCache, hasSessionCache, invalidateSessionCache } from './api.js';

const DEFAULT_STOCK_LIST_LIMIT = 100;
const FULL_FETCH_STOCK_LIST_LIMIT = 250;
const getMovementCacheKey = (params = {}) => {
  const query = buildQueryString(params);
  return `stock:movements:${query || 'default'}`;
};

const invalidateStockCache = () => invalidateSessionCache((key) => key.startsWith('stock:') || key.startsWith('products:'));
const INVALID_BATCH_NAMES = new Set(['test', 'asdasd']);
const isInvalidBatchName = (value) => INVALID_BATCH_NAMES.has(String(value || '').trim().toLocaleLowerCase('tr-TR'));

const getPaginationMeta = (rows) => rows?.meta?.pagination || null;

const shouldFetchSingleStockPage = (options = {}) => (
  options.fetchAll !== true
  || options.page !== undefined
  || options.cursor !== undefined
  || options.paginationMode !== undefined
  || options.mode !== undefined
);

const normalizeBatch = (batch = {}) => ({
  ...batch,
  batchNo: batch.batchNo || batch.lotNo || '',
  skt: batch.skt || '',
  totalQuantity: Number(batch.totalQuantity ?? batch.qtyBalance ?? 0),
  warehouseQuantity: Number(batch.warehouseQuantity ?? 0),
  shelfQuantity: Number(batch.shelfQuantity ?? 0),
});

const normalizeStock = (item = {}) => {
  const hasBatchPayload = Array.isArray(item.batches) || Array.isArray(item.productBatches);
  const sourceBatches = Array.isArray(item.batches) ? item.batches : item.productBatches;
  const batches = (Array.isArray(sourceBatches) ? sourceBatches.map(normalizeBatch) : [])
    .filter((batch) => !isInvalidBatchName(batch?.batchNo));
  const fefoBatch = item.fefoBatch ?
    normalizeBatch(item.fefoBatch)
    : batches.find((batch) => String(batch.batchNo || '') === String(item.fefoDefaultBatchNo || ''))
      || batches
        .filter((batch) => Number(batch.totalQuantity || 0) > 0)
        .sort((left, right) => String(left.skt || '9999-12-31').localeCompare(String(right.skt || '9999-12-31')))[0]
      || null;

  return {
    ...item,
    categoryId: item.categoryId || item.category_id || null,
    categoryCode: item.categoryCode || item.category_code || item.category?.code || '',
    categoryName: item.categoryName || item.category?.name || '',
    etiket: item.etiket || item.labelName || '',
    sktPolicy: item.sktPolicy || null,
    storageType: item.storageType || 'Ortam',
    totalStock: Number(item.totalStock ?? item.quantity ?? item.onHand ?? 0),
    quantity: Number(item.quantity ?? item.totalStock ?? item.onHand ?? 0),
    onHand: Number(item.onHand ?? item.totalStock ?? item.quantity ?? 0),
    available: Number(item.available ?? item.totalStock ?? item.quantity ?? 0),
    reserved: Number(item.reserved ?? 0),
    ...(hasBatchPayload ? {
      batches,
      productBatches: batches,
    } : {}),
    batchCount: Number(item.batchCount ?? batches.filter((batch) => Number(batch.totalQuantity || 0) > 0).length),
    nearestExpiry: fefoBatch?.skt || null,
    fefoBatch,
    fefoDefaults: item.fefoDefaults || {
      defaultBatchNo: item.fefoDefaultBatchNo || fefoBatch?.batchNo || null,
      defaultExpiry: fefoBatch?.skt || null,
    },
    stockSummary: item.stockSummary || {
      warehouseStock: Number(item.warehouseStock ?? 0),
      shelfStock: Number(item.shelfStock ?? 0),
      totalStock: Number(item.totalStock ?? item.quantity ?? item.onHand ?? 0),
      onHand: Number(item.onHand ?? item.totalStock ?? item.quantity ?? 0),
      available: Number(item.available ?? item.totalStock ?? item.quantity ?? 0),
      reserved: Number(item.reserved ?? 0),
      batchCount: Number(item.batchCount ?? batches.filter((batch) => Number(batch.totalQuantity || 0) > 0).length),
      nearestExpiry: fefoBatch?.skt || null,
    },
    status: item.status || (item.isActive === false ? 'inactive' : 'active'),
  };
};

export const stockService = {
  getStocks: (options = {}) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    const { forceRefresh: _forceRefresh, fetchAll: _fetchAll, ...queryOptions } = options || {};
    const singlePage = shouldFetchSingleStockPage(options);
    const baseParams = {
      ...queryOptions,
      ...(singlePage ? {
        page: options?.page || 1,
        limit: options?.limit || DEFAULT_STOCK_LIST_LIMIT,
      } : {}),
      includeBatches: options.includeBatches === true,
    };
    const cacheKey = `stock:list${buildQueryString(baseParams)}`;
    return getOrLoadSessionCache(
      cacheKey,
      async () => {
        if (singlePage) {
          const rows = await api.get(`/stock${buildQueryString(baseParams)}`);
          return Array.isArray(rows) ? rows.map(normalizeStock) : [];
        }

        const allRows = [];
        let page = 1;
        let hasNextPage = true;

        while (hasNextPage) {
          const rows = await api.get(`/stock${buildQueryString({
            ...baseParams,
            page,
            limit: FULL_FETCH_STOCK_LIST_LIMIT,
            includeTotal: true,
          })}`);
          if (Array.isArray(rows)) allRows.push(...rows);
          const pagination = getPaginationMeta(rows);
          hasNextPage = Boolean(pagination?.hasNextPage);
          page += 1;
          if (!pagination || page > 500) break;
        }

        return allRows.map(normalizeStock);
      },
      { forceRefresh }
    );
  },
  hasStocksCache: (options = {}) => {
    const singlePage = shouldFetchSingleStockPage(options);
    const { forceRefresh: _forceRefresh, fetchAll: _fetchAll, ...queryOptions } = options || {};
    return hasSessionCache(`stock:list${buildQueryString({
      ...queryOptions,
      ...(singlePage ? {
        page: options?.page || 1,
        limit: options?.limit || DEFAULT_STOCK_LIST_LIMIT,
      } : {}),
      includeBatches: options.includeBatches === true,
    })}`);
  },
  getMovements: (params = {}) => {
    const { forceRefresh = false, ...queryParams } = params || {};
    const cacheKey = getMovementCacheKey(queryParams);
    return getOrLoadSessionCache(
      cacheKey,
      () => api.get(`/stock/movements${buildQueryString(queryParams)}`).then((rows) => (
        Array.isArray(rows) ? rows.filter((row) => !isInvalidBatchName(row?.batchNo)) : []
      )),
      { forceRefresh: Boolean(forceRefresh) }
    );
  },
  getMovementSummary: (params = {}) => api.get(`/stock/movements/summary${buildQueryString(params)}`),
  getExpiryTracking: (params = {}) => api.get(`/stock/expiry-tracking${buildQueryString(params)}`),
  getSktPolicyManualReview: (params = {}) => api.get(`/stock/skt-policy/manual-review${buildQueryString(params)}`),
  getExpiredBatchWarnings: async (params = {}) => {
    const { fetchAll = true, ...queryParams } = params || {};
    if (fetchAll !== true) {
      return api.get(`/stock/expired-batches${buildQueryString(queryParams)}`);
    }

    const allRows = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      const rows = await api.get(`/stock/expired-batches${buildQueryString({
        ...queryParams,
        page,
        limit: queryParams.limit || 500,
      })}`);
      if (Array.isArray(rows)) allRows.push(...rows);
      const pagination = getPaginationMeta(rows);
      hasNextPage = Boolean(pagination?.hasNextPage);
      page += 1;
      if (!pagination || page > 500) break;
    }

    return allRows;
  },
  disposeExpiredBatches: async (payload = {}) => {
    const result = await api.post('/stock/expired-batches/dispose', payload);
    invalidateStockCache();
    return result;
  },
  hasMovementsCache: (params = {}) => {
    const { forceRefresh, ...queryParams } = params || {};
    return hasSessionCache(getMovementCacheKey(queryParams));
  },
  cancelMovement: async (movementId, payload = {}) => {
    const result = await api.post(`/stock/movements/${movementId}/cancel`, payload);
    invalidateStockCache();
    return result;
  },
  stockIn: async (payload) => {
    const result = await api.post('/stock/in', payload);
    invalidateStockCache();
    return result;
  },
  stockOut: async (payload) => {
    const result = await api.post('/stock/out', payload);
    invalidateStockCache();
    return result;
  },
  adjust: async (payload) => {
    const result = await api.post('/stock/adjust', payload);
    invalidateStockCache();
    return result;
  },
  transfer: async (payload) => {
    const result = await api.post('/stock/transfer', payload);
    invalidateStockCache();
    return result;
  },
  upsertBatch: async (productId, payload) => {
    const result = await api.put(`/stock/products/${encodeURIComponent(productId)}/batches`, payload);
    invalidateStockCache();
    return result;
  },
};
