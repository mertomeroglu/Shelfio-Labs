import { api, getOrLoadSessionCache, hasSessionCache, invalidateSessionCache } from './api.js';

import { formatDepotLocationLabel, formatStorageTypeLabel } from './formatters.js';
import { normalizeBarcodeInput } from '../utils/barcode.js';

const PRODUCT_CACHE_PREFIX = 'products:v3';
const productDetailCacheKey = (id) => `${PRODUCT_CACHE_PREFIX}:detail:${String(id || '').trim()}`;
const getProductListCacheKey = (options = {}) => `${PRODUCT_CACHE_PREFIX}:list:${buildProductListPath(options)}`;
export const invalidateProductCache = () => invalidateSessionCache((key) => key.startsWith('products:'));
const INVALID_BATCH_NAMES = new Set(['test', 'asdasd']);
const DEFAULT_PRODUCT_LIST_LIMIT = 100;
const FULL_FETCH_PRODUCT_LIST_LIMIT = 250;
const isInvalidBatchName = (value) => INVALID_BATCH_NAMES.has(String(value || '').trim().toLocaleLowerCase('tr-TR'));
const VIRTUAL_DEPOT_LABELS = {
  'OVR-AMBIENT': 'Ortam Ortak Alan',
  'OVR-COLD': 'Soğuk Ortak Alan',
  'OVR-FROZEN': 'Donuk Ortak Alan',
  'DIRECT-SUPPLY': 'Doğrudan Tedarik',
  'NO-BACKROOM': 'Arka Depo Yok',
};

const normalizeDepotAssignmentType = (value) => {
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (['fixed_pallet', 'fixed-pallet', 'physical', 'bounded_physical'].includes(raw)) return 'fixed_pallet';
  if (['shared_overflow', 'shared-overflow', 'virtual_overflow'].includes(raw)) return 'shared_overflow';
  if (['direct_supply', 'direct-supply', 'direct'].includes(raw)) return 'direct_supply';
  if (['no_backroom_stock', 'no-backroom-stock', 'no_backroom'].includes(raw)) return 'no_backroom_stock';
  return raw || '';
};

const normalizeCapacityMode = (value) => {
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (!raw) return '';
  if (['bounded', 'fixed', 'limited'].includes(raw)) return 'bounded';
  if (['unbounded_virtual', 'unbounded-virtual', 'unbounded', 'virtual'].includes(raw)) return 'unbounded_virtual';
  if (['not_applicable', 'not-applicable', 'direct_supply'].includes(raw)) return 'not_applicable';
  if (['no_capacity', 'no-capacity', 'no_backroom_stock'].includes(raw)) return 'no_capacity';
  if (['needs_review', 'needs-review'].includes(raw)) return 'needs_review';
  return raw;
};

const deriveCapacityMode = ({ assignment = '', mode = '', capacity = 0 } = {}) => {
  const normalizedAssignment = normalizeDepotAssignmentType(assignment);
  let normalizedMode = normalizeCapacityMode(mode);
  if (normalizedAssignment === 'fixed_pallet') normalizedMode = 'bounded';
  else if (normalizedAssignment === 'shared_overflow') normalizedMode = 'unbounded_virtual';
  else if (normalizedAssignment === 'direct_supply') normalizedMode = 'not_applicable';
  else if (normalizedAssignment === 'no_backroom_stock') normalizedMode = 'no_capacity';
  const numericCapacity = Math.max(0, Number(capacity || 0));
  if (!normalizedMode || (normalizedMode === 'bounded' && numericCapacity <= 0)) return 'needs_review';
  return normalizedMode;
};

const getPaginationMeta = (rows) => rows?.meta?.pagination || null;
const withResponseMeta = (items, rows) => {
  const normalized = Array.isArray(items) ? items : [];
  if (rows?.meta && normalized && typeof normalized === 'object') {
    try {
      Object.defineProperty(normalized, 'meta', {
        value: rows.meta,
        enumerable: false,
        configurable: true,
      });
    } catch {
      normalized.meta = rows.meta;
    }
  }
  return normalized;
};

const normalizeBrandName = (value) => {
  const brand = String(value || '').trim();
  if (!brand) return '';
  if (brand.toLocaleLowerCase('tr-TR') === 'kırtasiyeler' || brand === 'KırtasiyeLER') {
    return 'Kırtasiye';
  }
  return brand;
};

const shouldFetchSingleProductPage = (options = {}) => (
  options.fetchAll !== true
  || options.page !== undefined
  || options.cursor !== undefined
  || options.paginationMode !== undefined
  || options.mode !== undefined
);

const buildProductListPath = (params = {}) => {
  const query = new URLSearchParams();
  const includeUnlisted = Boolean(params.includeUnlisted);
  const universe = params.universe || (includeUnlisted ? '' : 'listed_active');
  if (universe) query.set('universe', universe);
  if (includeUnlisted) query.set('includeUnlisted', '1');
  if (params.search) query.set('search', params.search);
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', params.page);
  if (params.limit) query.set('limit', params.limit);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.paginationMode || params.mode) query.set('paginationMode', params.paginationMode || params.mode);
  if (params.includeTotal !== undefined) query.set('includeTotal', params.includeTotal);
  if (params.sort) query.set('sort', params.sort);
  if (params.includeDrafts !== undefined) query.set('includeDrafts', params.includeDrafts);
  if (params.catalogVisibility) query.set('catalogVisibility', params.catalogVisibility);
  if (params.sourceReadModel) query.set('sourceReadModel', params.sourceReadModel);
  if (params.completionStatus) query.set('completionStatus', params.completionStatus);
  if (params.categoryId) query.set('categoryId', params.categoryId);
  if (params.supplierId) query.set('supplierId', params.supplierId);
  if (params.supplierSearch) query.set('supplierSearch', params.supplierSearch);
  if (params.sectionId) query.set('sectionId', params.sectionId);
  if (params.listed !== undefined) query.set('listed', params.listed);
  if (params.status) query.set('status', params.status);
  if (params.tag) query.set('tag', params.tag);
  if (params.etiket) query.set('etiket', params.etiket);
  if (params.campaignOnly) query.set('campaignOnly', 'true');
  if (params.includeCampaignDetails) query.set('includeCampaignDetails', 'true');
  if (params.includeGeneralCampaigns) query.set('includeGeneralCampaigns', 'true');
  if (params.includeListDetails) query.set('includeListDetails', 'true');
  if (params.view) query.set('view', params.view);
  const qs = query.toString();
  return qs ? `/products?${qs}` : '/products';
};

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getProductDisplayPrice(item) {
  const product = item || {};
  const candidates = [
    product.currentPrice,
    product.salePrice,
    product.price,
    product.listPrice,
    product.unitPrice,
    product.productListView?.currentPrice,
    product.productListView?.salePrice,
    product.productListView?.price,
    product.productDetailView?.currentPrice,
    product.productDetailView?.salePrice,
    product.productDetailView?.price,
  ]
    .map(toFiniteNumber)
    .filter((value) => value !== null);

  const positive = candidates.find((value) => value > 0);
  if (positive !== undefined) return positive;
  return candidates.find((value) => value === 0) ?? 0;
}

export function getProductDisplayUnit(item) {
  const product = item || {};
  const candidates = [
    product.unit,
    product.priceUnit,
    product.orderUnit,
    product.defaultOrderUnit,
    product.minOrderUnit,
  ];
  const first = candidates.find((value) => String(value || '').trim().length > 0);
  return first ? String(first).trim() : 'Adet';
}

export function getDepotDisplayLabel(value) {
  const key = String(value || '').trim();
  if (!key) return '-';
  return VIRTUAL_DEPOT_LABELS[key] || formatDepotLocationLabel(key);
}

export const normalizeProductRecord = (item = {}) => {
  const name = item.name || item.productName || '';
  const warehouseStock = Number(item.warehouseStock ?? 0);
  const shelfStock = Number(item.shelfStock ?? 0);
  const totalStock = Number(item.totalStock ?? item.onHand ?? (warehouseStock + shelfStock));
  const criticalStock = Number(item.criticalStock ?? 0);
  const nearestExpiry = item.nearestExpiry || item.fefoBatch?.skt || null;
  const productBatches = (Array.isArray(item.batches) ? item.batches : [])
    .filter((batch) => !isInvalidBatchName(batch?.batchNo || batch?.lotNo));
  const depotLocationCode = item.depotLocationCode || item.defaultWarehouseLocationCode || item.warehouseLocation || '';
  const isVirtualLocation = item.isVirtualLocation === true;
  const normalizedAssignment = normalizeDepotAssignmentType(item.depotAssignmentType || (isVirtualLocation ? 'shared_overflow' : 'fixed_pallet'));
  const warehouseMaxStock = Number(item.warehouseMaxStock ?? 0);
  const normalizedCapacityMode = deriveCapacityMode({
    assignment: normalizedAssignment,
    mode: item.capacityMode || (isVirtualLocation ? 'unbounded_virtual' : 'bounded'),
    capacity: warehouseMaxStock,
  });

  const displayPrice = getProductDisplayPrice(item);
  const currentPrice = toFiniteNumber(item.currentPrice) ?? displayPrice;
  const originalPrice = toFiniteNumber(item.originalPrice) ?? toFiniteNumber(item.salePrice) ?? toFiniteNumber(item.price) ?? currentPrice;
  const rawDiscountedPrice = toFiniteNumber(item.discountedPrice);
  const rawCampaignPrice = toFiniteNumber(item.campaignPrice)
    ?? toFiniteNumber(item.productListView?.campaignPrice)
    ?? toFiniteNumber(item.productDetailView?.campaignPrice)
    ?? rawDiscountedPrice;
  const activeCampaign = item.activeCampaign || item.productListView?.activeCampaign || item.productDetailView?.activeCampaign || null;
  const backendHasActiveDiscount = item.hasActiveDiscount === true
    || item.productListView?.hasActiveDiscount === true
    || item.productDetailView?.hasActiveDiscount === true;
  const resolvedDiscountedPrice = rawCampaignPrice !== null
    && rawCampaignPrice > 0
    && (rawCampaignPrice < originalPrice || backendHasActiveDiscount)
    ? rawCampaignPrice
    : null;
  const hasActiveDiscount = Boolean(resolvedDiscountedPrice !== null && (
    backendHasActiveDiscount || resolvedDiscountedPrice < originalPrice
  ));
  const brand = normalizeBrandName(item.brand);
  const lastPriceChangeDate = item.lastPriceChangeDate || item.lastPriceChangeAt || item.productDetailView?.lastPriceChangeDate || null;
  const lastPriceChangeAt = item.lastPriceChangeAt || item.productDetailView?.lastPriceChangeAt || lastPriceChangeDate;
  const lastPriceChangeSource = item.lastPriceChangeSource || item.productDetailView?.lastPriceChangeSource || '';
  const storageType = item.storageType || item.requiredStorageType || 'Ortam';
  const storageTypeLabel = item.storageTypeLabel || formatStorageTypeLabel(storageType);
  const averageDesi = toNullableNumber(item.averageDesi);
  const unitsPerCase = toNullableNumber(item.unitsPerCase);
  const casesPerPallet = toNullableNumber(item.casesPerPallet);
  const unitsPerPallet = toNullableNumber(item.unitsPerPallet);
  const shelfCodeResolved = String(item.shelfCodeResolved || item.shelfCode || '').trim();

  return {
    ...item,
    brand,
    name,
    productName: item.productName || name,
    productListView: item.productListView || {
      productId: item.productId || item.id,
      sku: item.sku || '',
      barcode: item.barcode || '',
      productName: item.productName || name,
      brand,
      categoryName: item.categoryName || '',
      storageType,
      storageTypeLabel,
      currentPrice,
      salePrice: originalPrice,
      price: originalPrice,
      campaignPrice: resolvedDiscountedPrice,
      shelfCodeResolved,
      averageDesi,
      unitsPerCase,
      casesPerPallet,
      unitsPerPallet,
      supplierCount: Number(item.supplierCount || 0),
      onHand: Number(item.onHand ?? totalStock),
      available: Number(item.available ?? totalStock),
      nearestExpiry,
      status: item.status || (item.isActive === false ? 'inactive' : 'active'),
    },
    productDetailView: item.productDetailView || {
      productId: item.productId || item.id,
      sku: item.sku || '',
      barcode: item.barcode || '',
      productName: item.productName || name,
      brand,
      categoryName: item.categoryName || '',
      storageType,
      storageTypeLabel,
      currentPrice,
      salePrice: originalPrice,
      price: originalPrice,
      campaignPrice: resolvedDiscountedPrice,
      status: item.status || (item.isActive === false ? 'inactive' : 'active'),
      lastPriceChangeDate,
      lastPriceChangeAt,
      lastPriceChangeSource,
    },
    supplierId: item.supplierId || item.primarySupplier?.id || '',
    supplierName: item.supplierName || item.primarySupplier?.name || '-',
    warehouseStock,
    shelfStock,
    totalStock,
    currentStock: Number(item.currentStock ?? totalStock),
    currentPrice,
    salePrice: originalPrice,
    price: toFiniteNumber(item.price) ?? originalPrice,
    originalPrice,
    discountedPrice: resolvedDiscountedPrice,
    campaignPrice: resolvedDiscountedPrice,
    hasActiveDiscount,
    hasActiveCampaign: Boolean(item.hasActiveCampaign === true || hasActiveDiscount || activeCampaign),
    effectivePrice: toFiniteNumber(item.effectivePrice) ?? currentPrice,
    discountAmount: toFiniteNumber(item.discountAmount) ?? (hasActiveDiscount ? Number((originalPrice - resolvedDiscountedPrice).toFixed(2)) : 0),
    effectiveDiscountRate: toFiniteNumber(item.effectiveDiscountRate) ?? (hasActiveDiscount && originalPrice > 0 ? Number((((originalPrice - resolvedDiscountedPrice) / originalPrice) * 100).toFixed(2)) : 0),
    activeCampaign,
    activeCampaigns: Array.isArray(item.activeCampaigns) ? item.activeCampaigns : [],
    activeCampaignId: item.activeCampaignId || activeCampaign?.id || null,
    activeCampaignName: item.activeCampaignName || activeCampaign?.name || '',
    appliedCampaign: item.appliedCampaign || activeCampaign || null,
    appliedCampaignReason: item.appliedCampaignReason || '',
    candidateCampaigns: Array.isArray(item.candidateCampaigns) ? item.candidateCampaigns : [],
    campaignInfo: item.campaignInfo || activeCampaign?.name || '',
    campaignBadge: item.campaignBadge || activeCampaign?.name || '',
    campaignIds: Array.isArray(item.campaignIds) ? item.campaignIds : [],
    campaignCount: Number(item.campaignCount || (Array.isArray(item.activeCampaigns) ? item.activeCampaigns.length : 0)),
    campaignConflictCount: Number(item.campaignConflictCount || 0),
    campaignConflictPolicy: item.campaignConflictPolicy || item.campaignResolutionStrategy || null,
    campaignDiscountAmount: toFiniteNumber(item.campaignDiscountAmount) ?? toFiniteNumber(item.discountAmount) ?? 0,
    campaignDiscountPercent: toFiniteNumber(item.campaignDiscountPercent) ?? toFiniteNumber(item.effectiveDiscountRate) ?? 0,
    campaignValidUntil: item.campaignValidUntil || activeCampaign?.endsAt || null,
    campaignStartsAt: item.campaignStartsAt || activeCampaign?.startsAt || null,
    campaignEndsAt: item.campaignEndsAt || activeCampaign?.endsAt || null,
    campaignResolutionStrategy: item.campaignResolutionStrategy || null,
    lastPriceChangeDate,
    lastPriceChangeAt,
    lastPriceChangeSource,
    storageType,
    storageTypeLabel,
    priceHistory: Array.isArray(item.priceHistory) ? item.priceHistory : [],
    onHand: Number(item.onHand ?? totalStock),
    available: Number(item.available ?? totalStock),
    nearestExpiry,
    stockWarning: item.stockWarning
      || (totalStock <= criticalStock ? 'Kritik' : totalStock <= criticalStock * 1.5 ? 'Düşük' : 'Normal'),
    status: item.status || (item.isActive === false ? 'inactive' : 'active'),
    defaultShelfLocationCode: item.defaultShelfLocationCode || item.shelfCode || '',
    shelfCode: item.shelfCode || item.defaultShelfLocationCode || '',
    shelfCodeResolved,
    averageDesi,
    unitsPerCase,
    casesPerPallet,
    unitsPerPallet,
    depotAssignmentType: normalizedAssignment,
    depotLocationCode,
    depotZoneCode: item.depotZoneCode || '',
    depotLocationLabel: item.depotLocationLabel || getDepotDisplayLabel(depotLocationCode),
    depotLocationDisplay: item.depotLocationDisplay || item.depotLocationLabel || getDepotDisplayLabel(depotLocationCode),
    isVirtualLocation,
    capacityMode: normalizedCapacityMode,
    needsReview: normalizedCapacityMode === 'needs_review' || item.needsReview === true,
    stockingStrategy: item.stockingStrategy || item.depotAssignmentType || '',
    warehouseLocation: depotLocationCode,
    defaultWarehouseLocationCode: depotLocationCode,
    maxShelfStock: Number(item.maxShelfStock ?? item.shelfMaxStock ?? 0),
    warehouseMaxStock,
    primarySuppliers: item.primarySuppliers || (item.primarySupplier ? [item.primarySupplier] : []),
    procurementView: Array.isArray(item.procurementView) ? item.procurementView : (Array.isArray(item.procurementOptions) ? item.procurementOptions : []),
    productBatches,
    stockSummary: item.stockSummary || {
      warehouseStock,
      shelfStock,
      totalStock,
      onHand: Number(item.onHand ?? totalStock),
      available: Number(item.available ?? totalStock),
      reserved: Number(item.reserved ?? 0),
      nearestExpiry,
      batchCount: Number(item.batchCount ?? 0),
    },
    depotLocations: Array.isArray(item.depotLocations) ? item.depotLocations : [],
    shelfLocations: Array.isArray(item.shelfLocations) ? item.shelfLocations : [],
  };
};

const normalizeLocationProductRecord = (item = {}) => ({
  ...item,
  id: item.id || item.productId,
  productId: item.productId || item.id,
  name: item.name || item.productName || '',
  productName: item.productName || item.name || '',
  sku: item.sku || '',
  barcode: item.barcode || '',
  categoryName: item.categoryName || '',
  sectionId: item.sectionId || '',
  sectionName: item.sectionName || '',
  sectionNumber: item.sectionNumber || null,
  shelfSide: item.shelfSide || '',
  shelfNo: item.shelfNo || '',
  shelfLevel: item.shelfLevel || '',
  requiredStorageType: item.requiredStorageType || item.storageType || 'Ortam',
  storageType: item.storageType || item.requiredStorageType || 'Ortam',
  warehouseStock: Number(item.warehouseStock || 0),
  shelfStock: Number(item.shelfStock || 0),
  totalStock: Number(item.totalStock ?? item.currentStock ?? 0),
  currentStock: Number(item.currentStock ?? item.totalStock ?? 0),
  onHand: Number(item.onHand ?? item.totalStock ?? 0),
  available: Number(item.available ?? item.totalStock ?? 0),
  criticalStock: Number(item.criticalStock || 0),
  maxStock: Number(item.maxStock || 0),
  maxShelfStock: Number(item.maxShelfStock ?? item.shelfCapacity ?? 0),
  shelfCapacity: Number(item.shelfCapacity ?? item.maxShelfStock ?? 0),
  warehouseMaxStock: Number(item.warehouseMaxStock ?? item.maxStock ?? 0),
  averageDesi: toNullableNumber(item.averageDesi),
  unitsPerCase: toNullableNumber(item.unitsPerCase),
  casesPerPallet: toNullableNumber(item.casesPerPallet),
  unitsPerPallet: toNullableNumber(item.unitsPerPallet),
  depotAssignmentType: normalizeDepotAssignmentType(item.depotAssignmentType || ''),
  depotLocationCode: item.depotLocationCode || item.defaultWarehouseLocationCode || '',
  defaultWarehouseLocationCode: item.defaultWarehouseLocationCode || item.depotLocationCode || '',
  depotZoneCode: item.depotZoneCode || '',
  isVirtualLocation: item.isVirtualLocation === true,
  capacityMode: normalizeCapacityMode(item.capacityMode || ''),
  stockingStrategy: item.stockingStrategy || '',
  stockWarning: item.stockWarning || '',
  status: item.status || (item.isActive === false ? 'inactive' : 'active'),
  isActive: item.isActive !== false,
  isListed: item.isListed !== false,
  createdAt: item.createdAt || null,
  updatedAt: item.updatedAt || null,
});

export const productService = {
  list: (options = {}) => {
    const includeUnlisted = Boolean(options?.includeUnlisted);
    const forceRefresh = Boolean(options?.forceRefresh);
    const singlePage = shouldFetchSingleProductPage(options);
    const listOptions = {
      ...options,
      ...(singlePage ? {
        page: options?.page || 1,
        limit: options?.limit || DEFAULT_PRODUCT_LIST_LIMIT,
      } : {}),
      universe: includeUnlisted ? options?.universe : (options?.universe || 'listed_active'),
      includeUnlisted,
    };
    const cacheKey = getProductListCacheKey(listOptions);
    return getOrLoadSessionCache(
      cacheKey,
      async () => {
        if (singlePage) {
          const rows = await api.get(buildProductListPath(listOptions));
          return withResponseMeta(Array.isArray(rows) ? rows.map(normalizeProductRecord) : [], rows);
        }

        const allRows = [];
        let page = 1;
        let hasNextPage = true;

        while (hasNextPage) {
          const rows = await api.get(buildProductListPath({
            ...listOptions,
            includeUnlisted,
            page,
            limit: FULL_FETCH_PRODUCT_LIST_LIMIT,
            includeTotal: true,
          }));
          if (Array.isArray(rows)) allRows.push(...rows);
          const pagination = getPaginationMeta(rows);
          hasNextPage = Boolean(pagination?.hasNextPage);
          page += 1;
          if (!pagination || page > 500) break;
        }

        return allRows.map(normalizeProductRecord);
      },
      { forceRefresh }
    );
  },
  listForLocationManagement: (options = {}) => {
    const includeUnlisted = Boolean(options?.includeUnlisted);
    const forceRefresh = Boolean(options?.forceRefresh);
    const listOptions = {
      ...options,
      fetchAll: undefined,
      includeListDetails: false,
      includeTotal: false,
      view: 'location_management',
      universe: includeUnlisted ? options?.universe : (options?.universe || 'listed_active'),
      includeUnlisted,
    };
    const cacheKey = getProductListCacheKey(listOptions);
    return getOrLoadSessionCache(
      cacheKey,
      async () => {
        const rows = await api.get(buildProductListPath(listOptions));
        return Array.isArray(rows) ? rows.map(normalizeLocationProductRecord) : [];
      },
      { forceRefresh }
    );
  },
  hasListCache: (options = {}) => {
    const singlePage = shouldFetchSingleProductPage(options);
    return hasSessionCache(getProductListCacheKey({
      ...options,
      ...(singlePage ? {
        page: options?.page || 1,
        limit: options?.limit || DEFAULT_PRODUCT_LIST_LIMIT,
      } : {}),
      universe: options?.includeUnlisted ? options?.universe : (options?.universe || 'listed_active'),
      includeUnlisted: Boolean(options?.includeUnlisted),
    }));
  },
  getById: (id, options = {}) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    return getOrLoadSessionCache(productDetailCacheKey(id), () => api.get(`/products/${id}`).then(normalizeProductRecord), { forceRefresh });
  },
  create: async (payload) => {
    const result = await api.post('/products', payload);
    invalidateProductCache();
    return result;
  },
  update: async (id, payload) => {
    const result = await api.put(`/products/${id}`, payload);
    invalidateProductCache();
    return result;
  },
  remove: async (id) => {
    const result = await api.delete(`/products/${id}`);
    invalidateProductCache();
    return result;
  },
  findByBarcode: (barcode, options = {}) => {
    const normalized = normalizeBarcodeInput(barcode);
    if (!normalized) {
      const error = new Error('Lütfen barkod girin.');
      error.status = 400;
      throw error;
    }
    const query = new URLSearchParams();
    if (options?.includeUnlisted) query.set('includeUnlisted', '1');
    if (options?.universe) query.set('universe', options.universe);
    const qs = query.toString();
    return api.get(`/products/barcode/${encodeURIComponent(normalized)}${qs ? `?${qs}` : ''}`).then(normalizeProductRecord);
  },
};
