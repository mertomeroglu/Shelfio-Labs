import { v4 as uuidv4 } from 'uuid';
import prismaClientPackage from '@prisma/client';
import { categoryRepo } from '../repositories/categoryRepository.js';
import { movementRepo } from '../repositories/movementRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { sectionRepo } from '../repositories/sectionRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { stockRepo } from '../repositories/stockRepository.js';
import { supplierProductRepo } from '../repositories/supplierProductRepository.js';
import { supplierRepo } from '../repositories/supplierRepository.js';
import { warehouseLocationRepo } from '../repositories/warehouseLocationRepository.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { getVirtualDepotLocation, resolveDepotAssignment } from '../utils/depotAssignment.js';
import { sanitizeProductInput, validateProductPayload } from '../utils/validators.js';
import { categoryLabelService } from './categoryLabelService.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';
import { decodeCursor, encodeCursor, parseBooleanQuery, parseLimit, parsePagePagination, resolvePaginationMode, resolveWhitelistedSort } from '../utils/pagination.js';
import { CAPACITY_MODES, DEPOT_ASSIGNMENT_TYPES } from '../utils/depotAssignment.js';
import { formatDepotLocationLabel, formatStorageTypeLabel } from '../utils/displayLabels.js';
import { applyCampaignPricingToProduct, listActiveCampaignDefinitions } from './campaignPricingService.js';
import { buildProductUniverseWhere, matchesProductUniverse, normalizeProductUniverse } from '../utils/productUniverse.js';
import { deriveShelfStockAlert, stockAlertToSignals } from '../utils/retailStockPolicy.js';
import { getBarcodeCandidates, getProductBarcodeCandidates, getSupplierProductBarcodeCandidates } from '../utils/barcode.js';
import { enrichBatchExpiryState, summarizeBatchAvailability } from '../utils/batchExpiry.js';

const { Prisma } = prismaClientPackage;

const normalizeDraftText = (value) => String(value || '').trim().toLowerCase();
const PRODUCT_SEARCH_CHAR_MAP = {
  Ç: 'c',
  ç: 'c',
  Ğ: 'g',
  ğ: 'g',
  I: 'i',
  ı: 'i',
  İ: 'i',
  Ö: 'o',
  ö: 'o',
  Ş: 's',
  ş: 's',
  Ü: 'u',
  ü: 'u',
};

const normalizeProductSearchText = (value) => String(value || '')
  .replace(/[ÇçĞğIıİÖöŞşÜü]/g, (char) => PRODUCT_SEARCH_CHAR_MAP[char] || char)
  .toLocaleLowerCase('tr-TR')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const includesProductSearchText = (value, query) => {
  const needle = normalizeProductSearchText(query);
  if (!needle) return true;
  return normalizeProductSearchText(value).includes(needle);
};

const hasCatalogDraftMetadata = (product = {}, payload = {}) => {
  const values = [
    product.catalogImportId,
    product.catalogImportRowId,
    product.supplierCatalogRowId,
    product.supplierCatalogVersionId,
    product.supplierProductCode,
    payload.catalogImportId,
    payload.catalogImportRowId,
    payload.supplierCatalogRowId,
    payload.supplierCatalogVersionId,
    payload.supplierProductCode,
    payload.supplierId,
  ];

  return values.some(Boolean)
    || normalizeDraftText(product.sourceReadModel) === 'catalog_import'
    || normalizeDraftText(product.draftSource) === 'catalog_import'
    || normalizeDraftText(payload.sourceReadModel) === 'catalog_import'
    || normalizeDraftText(payload.draftSource) === 'catalog_import';
};

const isRejectableCatalogDraftProduct = (product = {}) => {
  const payload = product.payload && typeof product.payload === 'object' ? product.payload : {};
  if (product.isListed === true || product.isActive === true) return false;

  const catalogVisibility = normalizeDraftText(product.catalogVisibility || payload.catalogVisibility);
  const status = normalizeDraftText(product.status || product.defaultStatus || payload.status || payload.defaultStatus);
  const completionStatus = normalizeDraftText(product.completionStatus || payload.completionStatus);
  const hasCatalogSource = hasCatalogDraftMetadata(product, payload);

  return normalizeDraftText(product.sourceReadModel) === 'catalog_import'
    || normalizeDraftText(product.draftSource) === 'catalog_import'
    || normalizeDraftText(payload.sourceReadModel) === 'catalog_import'
    || normalizeDraftText(payload.draftSource) === 'catalog_import'
    || catalogVisibility === 'staged'
    || payload.catalogVisibility === 'staged'
    || (status === 'draft' && hasCatalogSource)
    || (completionStatus === 'incomplete' && hasCatalogSource);
};

const toDateOnly = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const clampIsoToNow = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  return parsed.getTime() > now.getTime() ? now.toISOString() : parsed.toISOString();
};

const resolveBatchStatus = (expiryDate) => {
  const dateOnly = toDateOnly(expiryDate);
  if (!dateOnly) return 'unknown';
  const expiry = new Date(`${dateOnly}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return 'unknown';
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diffDays = Math.floor((expiry.getTime() - todayStart) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return 'expired';
  if (diffDays <= 7) return 'critical';
  if (diffDays <= 30) return 'near_expiry';
  return 'active';
};

const normalizeProductBatches = (rows = [], now = new Date().toISOString()) => {
  if (!Array.isArray(rows)) return [];
  const byBatchNo = new Map();

  rows.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    const batchNo = String(row.batchNo || row.partiNo || row.lotNo || '').trim();
    const expiryDate = toDateOnly(row.skt || row.expiryDate || row.expirationDate);
    if (!batchNo || !expiryDate) return;

    const key = batchNo.toLocaleLowerCase('tr-TR');
    const warehouseQuantity = Number(row.warehouseQuantity || 0);
    const shelfQuantity = Number(row.shelfQuantity || 0);
    const totalQuantity = Number(row.totalQuantity ?? row.quantity ?? row.qtyBalance ?? (warehouseQuantity + shelfQuantity) ?? 0);
    const normalized = {
      ...row,
      batchNo,
      partiNo: batchNo,
      type: 'product_batch_expiry',
      skt: expiryDate,
      expiryDate,
      totalQuantity,
      quantity: totalQuantity,
      warehouseQuantity,
      shelfQuantity,
      status: row.status || resolveBatchStatus(expiryDate),
      createdAt: clampIsoToNow(row.createdAt) || now,
      updatedAt: clampIsoToNow(row.updatedAt) || now,
    };
    const previous = byBatchNo.get(key);
    if (!previous) {
      byBatchNo.set(key, normalized);
      return;
    }

    const previousTime = new Date(previous.skt || '9999-12-31').getTime();
    const currentTime = new Date(normalized.skt || '9999-12-31').getTime();
    const chosenSkt = currentTime < previousTime ? normalized.skt : previous.skt;
    byBatchNo.set(key, {
      ...previous,
      skt: chosenSkt,
      expiryDate: chosenSkt,
      totalQuantity: Number(previous.totalQuantity || 0) + Number(normalized.totalQuantity || 0),
      quantity: Number(previous.quantity || 0) + Number(normalized.quantity || 0),
      warehouseQuantity: Number(previous.warehouseQuantity || 0) + Number(normalized.warehouseQuantity || 0),
      shelfQuantity: Number(previous.shelfQuantity || 0) + Number(normalized.shelfQuantity || 0),
      status: resolveBatchStatus(chosenSkt),
      updatedAt: clampIsoToNow(normalized.updatedAt) || clampIsoToNow(previous.updatedAt) || now,
    });
  });

  return Array.from(byBatchNo.values());
};

const resolveCaseMultiplierFromDesi = (desi) => {
  const value = Number(desi || 0);
  if (!Number.isFinite(value) || value <= 0) return 3.5;
  if (value >= 12) return 1.5;
  if (value >= 8) return 1.75;
  if (value >= 5) return 2.0;
  if (value >= 3) return 2.5;
  if (value >= 2) return 3.0;
  if (value >= 1) return 3.5;
  return 4.0;
};

const resolveUnitsPerCase = (product = {}) => {
  const fromField = Number(product?.unitsPerCase || 0);
  if (Number.isFinite(fromField) && fromField > 0) return Math.max(1, Math.round(fromField));
  return 24;
};

const resolveRealisticShelfCapacity = (product = {}, totalStock = 0) => {
  const unitsPerCase = resolveUnitsPerCase(product);
  const multiplier = resolveCaseMultiplierFromDesi(product?.averageDesi);
  const baselineByCase = Math.ceil(unitsPerCase * multiplier);
  const minimumByCase = Math.ceil(unitsPerCase * 1.5);
  const minimumByCritical = Math.max(0, Number(product?.criticalStock || 0)) > 0
    ? Math.ceil(Number(product.criticalStock) * 2.5)
    : 0;
  const minimumRealistic = Math.max(minimumByCase, minimumByCritical, 1);
  const explicit = Number(product?.maxShelfStock || 0);

  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.max(Math.floor(explicit), minimumRealistic);
  }

  const maxStock = Number(product?.maxStock || 0);
  if (Number.isFinite(maxStock) && maxStock > 0) {
    return Math.max(minimumRealistic, Math.min(Math.floor(maxStock), baselineByCase));
  }

  if (Number(totalStock || 0) > 0) {
    return Math.max(minimumRealistic, Math.floor(Number(totalStock)));
  }

  return Math.max(minimumRealistic, baselineByCase);
};

const resolveMaxShelfStock = (product, totalStock = 0) => resolveRealisticShelfCapacity(product, totalStock);

const resolveProductEtiket = ({ name = '', categoryName = '', fallback = '' } = {}) => {
  const direct = String(fallback || '').trim();
  if (direct) return direct;

  const text = `${name} ${categoryName}`.toLocaleLowerCase('tr-TR');
  if (/dis|diş|agiz|ağız|firca|fırça|gargara|colgate|sensodyne/.test(text)) return 'Ağız Bakım';
  if (/sampuan|şampuan|deodorant|sabun|parfum|parfüm|kozmetik|bakim|bakım/.test(text)) return 'Kişisel Bakım';
  if (/deterjan|temizlik|camasir|çamaşır|bulasik|bulaşık|yumusatici|yumuşatıcı/.test(text)) return 'Ev Temizliği';
  if (/bebek|bez|mama|islak mendil|ıslak mendil/.test(text)) return 'Bebek Bakım';
  if (/evcil|hayvan|kedi|kopek|köpek/.test(text)) return 'Evcil Hayvan';
  if (/meyve|sebze/.test(text)) return 'Taze Ürün';
  if (/sut|süt|peynir|yogurt|yoşurt|kahvalti|kahvaltı/.test(text)) return 'Kahvaltılık';
  if (/icecek|içecek|su |meyve suyu|gazoz|kola|soda/.test(text)) return 'İçecek';
  if (/atistirmalik|atıştırmalık|cips|biskuvi|bisküvi|cikolata|çikolata/.test(text)) return 'Atıştırmalık';
  if (/firin|fırın|pastane|ekmek/.test(text)) return 'Fırın Ürünleri';
  if (/hazir|hazır|donuk|pizza|mantı|yemek/.test(text)) return 'Hazır Gıda';
  if (/kitap|kirtasiye|kırtasiye|oyuncak/.test(text)) return 'Eğitim & Hobi';
  if (/elektronik|pil|kulaklik|kulaklık|sarj|şarj/.test(text)) return 'Elektronik';
  if (/ev|yasam|yaşam|mutfak|saklama/.test(text)) return 'Ev & Yaşam';

  return String(categoryName || '').trim() || 'Genel';
};

const normalizeBrandName = (value) => {
  const brand = String(value || '').trim();
  if (!brand) return '';
  if (brand.toLocaleLowerCase('tr-TR') === 'kırtasiyeler' || brand === 'KırtasiyeLER') {
    return 'Kırtasiye';
  }
  return brand;
};

const resolveRequiredStorageType = (category, preferred = '') => {
  const normalizedPreferred = String(preferred || '').trim();
  if (normalizedPreferred === 'freezer' || normalizedPreferred === 'cold_chain' || normalizedPreferred === 'Ortam') {
    return normalizedPreferred;
  }
  if (category?.requiresFreezer) return 'freezer';
  if (category?.requiresColdChain) return 'cold_chain';
  return 'Ortam';
};

const resolveCanonicalLabel = async ({ input, categoryName = '' } = {}) => {
  const candidateRef = input?.tagId || input?.selectedTagId || input?.etiket || '';
  const candidateName = input?.etiket || '';
  const resolved = await categoryLabelService.resolveLabel({ ref: candidateRef, name: candidateName, slug: candidateName });
  if (!resolved) {
    throw new AppError(400, 'Geçerli bir ürün etiketi seçin.');
  }
  return resolved;
};

const resolveProductDepotAssignment = ({ product, physicalLocations = [], requiredStorageType = 'Ortam', warehouseStock = 0, shelfStock = 0 } = {}) => {
  if (product?.isListed === false) {
    return {
      depotAssignmentType: 'no_physical_assignment',
      depotLocationCode: null,
      depotZoneCode: null,
      isVirtualLocation: true,
      capacityMode: 'no_capacity',
      storageType: requiredStorageType,
      stockingStrategy: 'no_active_stock',
      assignmentPriority: 100,
      depotLocationLabel: 'Fiziksel atama yok',
    };
  }

  const physicalLocation = physicalLocations[0] || null;
  if (physicalLocation) {
    return resolveDepotAssignment({
      physicalLocationCode: physicalLocation.locationCode,
      storageType: physicalLocation.storageType || requiredStorageType,
      isListed: product?.isListed !== false,
      warehouseQuantity: warehouseStock,
      shelfQuantity: shelfStock,
    });
  }

  if (product?.depotLocationCode) {
    return {
      depotAssignmentType: product.depotAssignmentType,
      depotLocationCode: product.depotLocationCode,
      depotZoneCode: product.depotZoneCode,
      isVirtualLocation: product.isVirtualLocation === true,
      capacityMode: product.capacityMode,
      storageType: product.requiredStorageType || requiredStorageType,
      stockingStrategy: product.stockingStrategy,
      assignmentPriority: product.assignmentPriority,
      depotLocationLabel: product.depotLocationLabel || product.depotLocationCode,
    };
  }

  return resolveDepotAssignment({
    storageType: requiredStorageType,
    isListed: product?.isListed !== false,
    warehouseQuantity: warehouseStock,
    shelfQuantity: shelfStock,
  });
};

const resolveRequestedDepotAssignment = ({ input = {}, storageType = 'Ortam', isListed = true, warehouseQuantity = 0, shelfQuantity = 0 } = {}) => {
  const requestedCode = String(input.physicalLocationCode || input.depotLocationCode || input.defaultWarehouseLocationCode || '').trim();
  const virtualLocation = getVirtualDepotLocation(requestedCode);
  if (virtualLocation) {
    return {
      ...virtualLocation,
      isVirtualLocation: true,
      capacityMode: virtualLocation.depotAssignmentType === DEPOT_ASSIGNMENT_TYPES.DIRECT_SUPPLY
        ? CAPACITY_MODES.NOT_APPLICABLE
        : virtualLocation.depotAssignmentType === DEPOT_ASSIGNMENT_TYPES.NO_BACKROOM_STOCK
          ? CAPACITY_MODES.NO_CAPACITY
          : CAPACITY_MODES.UNBOUNDED_VIRTUAL,
      storageType,
      depotLocationLabel: virtualLocation.displayLabel,
    };
  }

  return resolveDepotAssignment({
    physicalLocationCode: requestedCode,
    storageType,
    isListed,
    warehouseQuantity,
    shelfQuantity,
  });
};

const normalizeDepotAssignmentType = (value) => {
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (['fixed_pallet', 'fixed-pallet', 'physical', 'bounded_physical'].includes(raw)) return DEPOT_ASSIGNMENT_TYPES.FIXED_PALLET;
  if (['shared_overflow', 'shared-overflow', 'virtual_overflow'].includes(raw)) return DEPOT_ASSIGNMENT_TYPES.SHARED_OVERFLOW;
  if (['direct_supply', 'direct-supply', 'direct'].includes(raw)) return DEPOT_ASSIGNMENT_TYPES.DIRECT_SUPPLY;
  if (['no_backroom_stock', 'no-backroom-stock', 'no_backroom'].includes(raw)) return DEPOT_ASSIGNMENT_TYPES.NO_BACKROOM_STOCK;
  return raw || '';
};

const normalizeCapacityMode = (value) => {
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (!raw) return '';
  if (['bounded', 'fixed', 'limited'].includes(raw)) return CAPACITY_MODES.BOUNDED;
  if (['unbounded_virtual', 'unbounded-virtual', 'unbounded', 'virtual'].includes(raw)) return CAPACITY_MODES.UNBOUNDED_VIRTUAL;
  if (['not_applicable', 'not-applicable', 'direct_supply'].includes(raw)) return CAPACITY_MODES.NOT_APPLICABLE;
  if (['no_capacity', 'no-capacity', 'no_backroom_stock'].includes(raw)) return CAPACITY_MODES.NO_CAPACITY;
  if (['needs_review', 'needs-review'].includes(raw)) return CAPACITY_MODES.NEEDS_REVIEW;
  return raw;
};

const deriveCapacityProfile = ({ assignmentType = '', capacityMode = '', depotCapacity = 0 } = {}) => {
  const assignment = normalizeDepotAssignmentType(assignmentType);
  let mode = normalizeCapacityMode(capacityMode);

  if (assignment === DEPOT_ASSIGNMENT_TYPES.FIXED_PALLET) mode = CAPACITY_MODES.BOUNDED;
  else if (assignment === DEPOT_ASSIGNMENT_TYPES.SHARED_OVERFLOW) mode = CAPACITY_MODES.UNBOUNDED_VIRTUAL;
  else if (assignment === DEPOT_ASSIGNMENT_TYPES.DIRECT_SUPPLY) mode = CAPACITY_MODES.NOT_APPLICABLE;
  else if (assignment === DEPOT_ASSIGNMENT_TYPES.NO_BACKROOM_STOCK) mode = CAPACITY_MODES.NO_CAPACITY;

  const numericDepotCapacity = Math.max(0, Number(depotCapacity || 0));
  const needsReview = !mode
    || mode === CAPACITY_MODES.NEEDS_REVIEW
    || (mode === CAPACITY_MODES.BOUNDED && numericDepotCapacity <= 0);

  return {
    assignmentType: assignment || DEPOT_ASSIGNMENT_TYPES.SHARED_OVERFLOW,
    capacityMode: needsReview ? CAPACITY_MODES.NEEDS_REVIEW : mode,
    needsReview,
  };
};

const deriveShelfCapacity = ({ shelfCapacity = 0, criticalStock = 0, unitsPerCase = 24, averageDesi = 0 } = {}) => {
  const explicit = Math.max(0, Number(shelfCapacity || 0));
  const synthetic = resolveRealisticShelfCapacity({
    maxShelfStock: explicit,
    criticalStock,
    unitsPerCase,
    averageDesi,
  });
  return Math.max(1, Math.floor(synthetic));
};

const deriveDepotCapacity = ({ depotCapacity = 0, shelfCapacity = 0 } = {}) => {
  const explicit = Math.max(0, Number(depotCapacity || 0));
  if (explicit > 0) return explicit;
  const shelf = Math.max(0, Number(shelfCapacity || 0));
  if (shelf > 0) return Math.max(shelf, Math.ceil(shelf * 1.5));
  return 0;
};

const deriveStockSignals = ({ product = {}, qty = 0, shelfQty = 0 } = {}) =>
  stockAlertToSignals(deriveShelfStockAlert({ product, shelfQuantity: shelfQty, totalQuantity: qty }));

const resolveLocationBatchReference = ({ location = {}, stockBatches = [], warehouseStock = 0 } = {}) => {
  const locationBatchNo = String(location.batchNo || '').trim();
  const locationSkt = String(location.skt || '').trim();
  if (!locationBatchNo) return { batchNo: null, skt: null, batchSource: 'none', batchDisplay: null };

  const activeWarehouseBatches = (Array.isArray(stockBatches) ? stockBatches : [])
    .filter((batch) => Number(batch?.warehouseQuantity || 0) > 0 && String(batch?.batchNo || '').trim());
  const match = activeWarehouseBatches.find((batch) =>
    String(batch.batchNo || '').trim() === locationBatchNo
    && (!locationSkt || String(batch.skt || '').slice(0, 10) === locationSkt.slice(0, 10))
  );

  if (!match) {
    return { batchNo: null, skt: null, batchSource: 'stock_batches', batchDisplay: 'Parti bilgisi stok partileriyle eşleşmiyor' };
  }

  const locationQty = Number(location.warehouseStock || warehouseStock || 0);
  const batchQty = Number(match.warehouseQuantity || 0);
  if (activeWarehouseBatches.length > 1 && locationQty > 0 && batchQty > 0 && locationQty !== batchQty) {
    return { batchNo: null, skt: null, batchSource: 'stock_batches', batchDisplay: 'Çoklu parti' };
  }

  return {
    batchNo: match.batchNo || null,
    skt: match.skt || null,
    batchSource: 'stock_batches',
    batchDisplay: match.batchNo || null,
  };
};

const buildDepotLocationViews = ({ assignment, physicalLocations = [], warehouseStock = 0, stockBatches = [] } = {}) => {
  if (assignment?.isVirtualLocation) {
    return [{
      locationId: assignment.depotLocationCode,
      locationCode: assignment.depotLocationCode,
      depotLocationCode: assignment.depotLocationCode,
      depotZoneCode: assignment.depotZoneCode,
      displayLabel: assignment.depotLocationLabel || assignment.depotLocationCode,
      storageType: assignment.storageType,
      status: 'Virtual',
      isVirtualLocation: true,
      capacityMode: assignment.capacityMode,
      depotAssignmentType: assignment.depotAssignmentType,
      stockingStrategy: assignment.stockingStrategy,
      palletCount: 0,
      warehouseStock: Number(warehouseStock || 0),
      batchNo: null,
      skt: null,
    }];
  }

  return physicalLocations.map((location) => {
    const batchRef = resolveLocationBatchReference({ location, stockBatches, warehouseStock });
    return {
      locationId: location.id,
      locationCode: location.locationCode,
      depotLocationCode: location.locationCode,
      depotZoneCode: location.depotZoneCode || String(location.locationCode || '').replace(/-\d{2}$/, ''),
      displayLabel: location.locationCode,
      storageType: location.storageType,
      status: location.status,
      isVirtualLocation: false,
      capacityMode: 'bounded',
      depotAssignmentType: 'fixed_pallet',
      stockingStrategy: 'fixed_pallet',
      palletCount: Number(location.palletCount || 0),
      warehouseStock: Number(location.warehouseStock || 0),
      batchNo: batchRef.batchNo,
      skt: batchRef.skt,
      batchSource: batchRef.batchSource,
      batchDisplay: batchRef.batchDisplay,
    };
  });
};

const toNumberValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
};

const ALLOWED_SALE_PRICE_CENTS = [0, 25, 50, 75, 90, 95, 99];

const normalizeSalePriceToAllowedCents = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  const base = Math.floor(numeric);
  const cents = Math.round((numeric - base) * 100);
  if (ALLOWED_SALE_PRICE_CENTS.includes(cents)) {
    return Number(numeric.toFixed(2));
  }
  let best = ALLOWED_SALE_PRICE_CENTS[0];
  let bestDistance = Math.abs(cents - best);
  for (const candidate of ALLOWED_SALE_PRICE_CENTS) {
    const distance = Math.abs(cents - candidate);
    if (distance < bestDistance || (distance === bestDistance && candidate > best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return Number((base + (best / 100)).toFixed(2));
};

const hasInvalidSalePriceCents = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return false;
  const cents = Math.round((numeric - Math.floor(numeric)) * 100);
  return !ALLOWED_SALE_PRICE_CENTS.includes(cents);
};

const fromDateValue = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

const toIsoDateValue = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const dateOnlyFromIso = (value) => {
  const iso = toIsoDateValue(value);
  return iso ? iso.slice(0, 10) : null;
};

const normalizePriceEvent = (event = {}) => {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const at = toIsoDateValue(
    event.at
    || event.date
    || event.eventDate
    || payload.at
    || payload.date
    || payload.eventDate
    || event.createdAt
    || event.updatedAt
    || event.lastPriceUpdate
  );
  if (!at) return null;
  const price = event.salePrice ?? event.price ?? event.currentPrice ?? event.newPrice ?? payload.salePrice ?? payload.price ?? payload.currentPrice ?? payload.newPrice;
  const previousPrice = event.previousSalePrice ?? event.previousPrice ?? payload.previousSalePrice ?? payload.previousPrice ?? null;
  const productId = event.productId ?? payload.productId ?? null;
  const sku = event.sku ?? payload.sku ?? null;
  const numericPrice = price !== undefined && price !== null ? Number(price) : null;
  const numericPreviousPrice = previousPrice !== undefined && previousPrice !== null ? Number(previousPrice) : null;
  const changePercent = event.changePercent ?? payload.changePercent;
  const direction = event.changeDirection ?? payload.changeDirection;
  return {
    ...event,
    priceEventId: event.priceEventId || event.id || payload.priceEventId || payload.id || null,
    productId,
    sku,
    eventDate: at,
    at,
    createdAt: at,
    salePrice: numericPrice,
    price: numericPrice,
    newPrice: numericPrice,
    previousSalePrice: Number.isFinite(numericPreviousPrice) ? numericPreviousPrice : null,
    previousPrice: Number.isFinite(numericPreviousPrice) ? numericPreviousPrice : null,
    changeDirection: direction || null,
    changePercent: changePercent !== undefined && changePercent !== null ? Number(changePercent) : null,
    currency: event.currency || payload.currency || 'TRY',
    source: event.source || payload.source || 'price_history',
    isSyntheticHistory: Boolean(event.isSyntheticHistory ?? payload.isSyntheticHistory ?? false),
  };
};

const NON_REAL_PRICE_EVENT_SOURCES = new Set([
  'legacy_price_updated_at',
  'legacy',
  'import',
  'bulk_import',
  'bulk_update',
  'seed',
  'migration',
  'updated_at',
]);

const isRealPriceEventSource = (source) => {
  const normalized = String(source || '').trim().toLowerCase();
  if (!normalized) return true;
  return !NON_REAL_PRICE_EVENT_SOURCES.has(normalized);
};

const getProductPriceEvents = (product = {}) => {
  const payload = omitLegacyBatchPayload(product?.payload && typeof product.payload === 'object' ? product.payload : {});
  const relationRows = Array.isArray(product.priceEvents) ? product.priceEvents : [];
  const rows = relationRows.length > 0
    ? relationRows
    : [
      ...(Array.isArray(product.priceHistory) ? product.priceHistory : []),
      ...(Array.isArray(payload.priceEvents) ? payload.priceEvents : []),
      ...(Array.isArray(payload.priceHistory) ? payload.priceHistory : []),
    ];

  const seen = new Set();
  return rows
    .map(normalizePriceEvent)
    .filter(Boolean)
    .filter((event) => {
      const key = `${event.priceEventId || event.id || ''}:${event.productId || ''}:${event.sku || ''}:${event.at}:${event.salePrice ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
};

const pricesEqual = (left, right) => {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.round(a * 100) === Math.round(b * 100);
};

const resolveLastPriceChange = (product = {}, currentSalePrice = product.salePrice) => {
  const events = getProductPriceEvents(product);
  if (!events.length) {
    return {
      lastPriceChangeDate: null,
      lastPriceChangeAt: null,
      lastPriceChangeSource: null,
      priceHistory: [],
    };
  }

  const realChanges = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const currentPrice = event.salePrice ?? event.price;
    if (!Number.isFinite(Number(currentPrice))) continue;
    if (!isRealPriceEventSource(event.source)) continue;

    const explicitPrevious = event.previousSalePrice;
    const previousFromHistory = index > 0 ? (events[index - 1].salePrice ?? events[index - 1].price) : null;
    const previousPrice = explicitPrevious ?? previousFromHistory;
    if (!Number.isFinite(Number(previousPrice))) continue;
    if (!pricesEqual(previousPrice, currentPrice)) {
      realChanges.push(event);
    }
  }

  const latestRealChange = realChanges.length ? realChanges[realChanges.length - 1] : null;
  const selected = latestRealChange;

  if (!selected) {
    return {
      lastPriceChangeDate: null,
      lastPriceChangeAt: null,
      lastPriceChangeSource: null,
      priceHistory: events.map((event, index) => {
        const price = event.salePrice ?? event.price;
        const previousPrice = event.previousSalePrice ?? (index > 0 ? (events[index - 1].salePrice ?? events[index - 1].price) : null);
        return {
          priceEventId: event.priceEventId || event.id || null,
          productId: event.productId || product.id || null,
          sku: event.sku || product.sku || null,
          eventDate: event.eventDate || event.at,
          at: event.at,
          date: event.at,
          previousPrice: Number.isFinite(Number(previousPrice)) ? Number(previousPrice) : null,
          previousSalePrice: Number.isFinite(Number(previousPrice)) ? Number(previousPrice) : null,
          newPrice: price,
          price,
          salePrice: price,
          changeDirection: event.changeDirection || 'stable',
          changePercent: Number.isFinite(Number(event.changePercent)) ? Number(event.changePercent) : 0,
          currency: event.currency || 'TRY',
          source: event.source || null,
          isSyntheticHistory: event.isSyntheticHistory === true,
          createdAt: event.createdAt || event.at,
        };
      }),
    };
  }

  return {
    lastPriceChangeDate: dateOnlyFromIso(selected.at),
    lastPriceChangeAt: selected.at,
    lastPriceChangeSource: selected.source || null,
    priceHistory: events.map((event, index) => {
      const price = event.salePrice ?? event.price;
      const previousPrice = event.previousSalePrice ?? (index > 0 ? (events[index - 1].salePrice ?? events[index - 1].price) : null);
      const computedPercent = Number.isFinite(Number(previousPrice)) && Number(previousPrice) > 0
        ? Number((((Number(price) - Number(previousPrice)) / Number(previousPrice)) * 100).toFixed(2))
        : 0;
      return {
        priceEventId: event.priceEventId || event.id || null,
        productId: event.productId || product.id || null,
        sku: event.sku || product.sku || null,
        eventDate: event.eventDate || event.at,
        at: event.at,
        date: event.at,
        previousPrice: Number.isFinite(Number(previousPrice)) ? Number(previousPrice) : null,
        previousSalePrice: Number.isFinite(Number(previousPrice)) ? Number(previousPrice) : null,
        newPrice: price,
        price,
        salePrice: price,
        changeDirection: event.changeDirection || (Number.isFinite(Number(previousPrice))
          ? (Number(price) > Number(previousPrice) ? 'increase' : Number(price) < Number(previousPrice) ? 'decrease' : 'stable')
          : 'initial'),
        changePercent: Number.isFinite(Number(event.changePercent)) ? Number(event.changePercent) : computedPercent,
        currency: event.currency || 'TRY',
        source: event.source || null,
        isSyntheticHistory: event.isSyntheticHistory === true,
        createdAt: event.createdAt || event.at,
      };
    }),
  };
};

const normalizeStockBatchRows = (batches = []) =>
  (Array.isArray(batches) ? batches : [])
    .map((batch) => enrichBatchExpiryState({
      ...(batch?.payload && typeof batch.payload === 'object' ? batch.payload : {}),
      id: batch?.id || null,
      batchNo: String(batch?.batchNo || '').trim(),
      skt: batch?.skt || '',
      warehouseQuantity: Number(batch?.warehouseQuantity || 0),
      shelfQuantity: Number(batch?.shelfQuantity || 0),
      totalQuantity: Number(batch?.totalQuantity ?? ((batch?.warehouseQuantity || 0) + (batch?.shelfQuantity || 0))),
      status: batch?.status || '',
    }))
    .filter((batch) => batch.batchNo);

const omitLegacyBatchPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object') return {};
  const {
    productBatches,
    batches,
    batchNo,
    partiNo,
    lotNo,
    skt,
    expiryDate,
    expirationDate,
    nearestExpiry,
    fefoDefaultBatchNo,
    fefoDefaultExpiry,
    ...rest
  } = payload;
  return rest;
};

const resolveFefoBatch = (batches = [], defaultBatchNo = '') =>
  batches.find((item) => item.isExpired !== true && String(item.batchNo || '') === String(defaultBatchNo || ''))
  || [...batches]
    .filter((item) => item.isExpired !== true && Number(item?.totalQuantity || 0) > 0)
    .sort((left, right) => String(left?.skt || '').localeCompare(String(right?.skt || ''), 'tr'))[0]
  || null;

const resolveLastPriceChangeSummary = (event = null) => {
  const normalized = normalizePriceEvent(event || {});
  if (!normalized) {
    return {
      lastPriceChangeDate: null,
      lastPriceChangeAt: null,
      lastPriceChangeSource: null,
    };
  }

  return {
    lastPriceChangeDate: dateOnlyFromIso(normalized.at),
    lastPriceChangeAt: normalized.at,
    lastPriceChangeSource: normalized.source || null,
  };
};

const buildBatchPreviewSummary = (rows = []) => {
  const previewRows = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      batchNo: String(row?.batchNo || '').trim(),
      skt: row?.skt || '',
      totalQuantity: Number(row?.totalQuantity || 0),
    }))
    .filter((row) => row.batchNo);
  const batchNoPreview = previewRows.map((row) => row.batchNo);

  return {
    batchCount: Number(rows?.[0]?.batchCount || previewRows.length || 0),
    batchNoPreview,
    nearestExpiry: previewRows.find((row) => row.skt)?.skt || null,
    shortBatchSummary: previewRows
      .map((row) => `${row.batchNo}: ${row.totalQuantity}`)
      .join(' | '),
    batchPreview: previewRows,
  };
};

const loadProductListDerivedSummaries = async (prisma, productIds = []) => {
  const ids = Array.from(new Set((Array.isArray(productIds) ? productIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)));
  const empty = { priceByProductId: new Map(), batchByProductId: new Map() };
  if (!ids.length) return empty;

  const nonRealSources = Array.from(NON_REAL_PRICE_EVENT_SOURCES);
  const [priceRows, batchRows] = await Promise.all([
    prisma.$queryRaw`
      WITH ranked_events AS (
        SELECT
          product_id AS "productId",
          id,
          previous_sale_price AS "previousSalePrice",
          sale_price AS "salePrice",
          source,
          created_at AS "createdAt",
          ROW_NUMBER() OVER (
            PARTITION BY product_id
            ORDER BY created_at DESC NULLS LAST, id DESC
          ) AS rn
        FROM product_price_events
        WHERE product_id IN (${Prisma.join(ids)})
          AND COALESCE(LOWER(source), '') NOT IN (${Prisma.join(nonRealSources)})
          AND previous_sale_price IS NOT NULL
          AND sale_price IS NOT NULL
          AND ROUND(previous_sale_price::numeric * 100) <> ROUND(sale_price::numeric * 100)
      )
      SELECT
        "productId",
        id,
        "previousSalePrice",
        "salePrice",
        source,
        "createdAt"
      FROM ranked_events
      WHERE rn = 1
    `,
    prisma.$queryRaw`
      WITH active_batches AS (
        SELECT
          product_id AS "productId",
          batch_no AS "batchNo",
          skt,
          total_quantity AS "totalQuantity",
          COUNT(*) OVER (PARTITION BY product_id) AS "batchCount",
          ROW_NUMBER() OVER (
            PARTITION BY product_id
            ORDER BY skt ASC NULLS LAST, batch_no ASC
          ) AS rn
        FROM stock_batches
        WHERE product_id IN (${Prisma.join(ids)})
          AND NULLIF(TRIM(batch_no), '') IS NOT NULL
          AND COALESCE(total_quantity, 0) > 0
      )
      SELECT
        "productId",
        "batchNo",
        skt,
        "totalQuantity",
        "batchCount"
      FROM active_batches
      WHERE rn <= 3
      ORDER BY "productId", rn
    `,
  ]);

  const priceByProductId = new Map();
  (Array.isArray(priceRows) ? priceRows : []).forEach((row) => {
    priceByProductId.set(String(row.productId), resolveLastPriceChangeSummary({
      id: row.id,
      productId: row.productId,
      previousSalePrice: row.previousSalePrice,
      salePrice: row.salePrice,
      source: row.source,
      createdAt: row.createdAt,
    }));
  });

  const batchRowsByProductId = new Map();
  (Array.isArray(batchRows) ? batchRows : []).forEach((row) => {
    const key = String(row.productId);
    if (!batchRowsByProductId.has(key)) batchRowsByProductId.set(key, []);
    batchRowsByProductId.get(key).push(row);
  });
  const batchByProductId = new Map();
  batchRowsByProductId.forEach((rows, productId) => {
    batchByProductId.set(productId, buildBatchPreviewSummary(rows));
  });

  return { priceByProductId, batchByProductId };
};

const buildPriceEvent = ({ productId, previousSalePrice, salePrice, source = 'product_update', at = new Date().toISOString() }) => {
  const id = uuidv4();
  return {
    id,
    priceEventId: id,
    productId,
    previousSalePrice: previousSalePrice === undefined || previousSalePrice === null ? null : Number(previousSalePrice),
    previousPrice: previousSalePrice === undefined || previousSalePrice === null ? null : Number(previousSalePrice),
    salePrice: salePrice === undefined || salePrice === null ? null : Number(salePrice),
    price: salePrice === undefined || salePrice === null ? null : Number(salePrice),
    newPrice: salePrice === undefined || salePrice === null ? null : Number(salePrice),
    source,
    at,
    eventDate: at,
    currency: 'TRY',
    changeDirection: Number(salePrice) > Number(previousSalePrice) ? 'increase' : Number(salePrice) < Number(previousSalePrice) ? 'decrease' : 'stable',
    changePercent: Number(previousSalePrice) > 0 ? Number((((Number(salePrice) - Number(previousSalePrice)) / Number(previousSalePrice)) * 100).toFixed(2)) : 0,
    isSyntheticHistory: false,
    createdAt: at,
  };
};

const PRODUCT_SORTS = {
  name_asc: [{ name: 'asc' }, { id: 'asc' }],
  name_desc: [{ name: 'desc' }, { id: 'asc' }],
  sku_asc: [{ sku: 'asc' }, { id: 'asc' }],
  sku_desc: [{ sku: 'desc' }, { id: 'asc' }],
  barcode_asc: [{ barcode: 'asc' }, { id: 'asc' }],
  barcode_desc: [{ barcode: 'desc' }, { id: 'asc' }],
  brand_asc: [{ brand: 'asc' }, { id: 'asc' }],
  brand_desc: [{ brand: 'desc' }, { id: 'asc' }],
  purchase_price_asc: [{ purchasePrice: 'asc' }, { id: 'asc' }],
  purchase_price_desc: [{ purchasePrice: 'desc' }, { id: 'asc' }],
  sale_price_asc: [{ salePrice: 'asc' }, { id: 'asc' }],
  sale_price_desc: [{ salePrice: 'desc' }, { id: 'asc' }],
  campaign_price_asc: [{ name: 'asc' }, { id: 'asc' }],
  campaign_price_desc: [{ name: 'asc' }, { id: 'asc' }],
  last_price_change_at_asc: [{ lastPriceChangeAt: 'asc' }, { id: 'asc' }],
  last_price_change_at_desc: [{ lastPriceChangeAt: 'desc' }, { id: 'asc' }],
  updated_at_asc: [{ updatedAt: 'asc' }, { id: 'asc' }],
  updated_at_desc: [{ updatedAt: 'desc' }, { id: 'asc' }],
};

const SCOPED_CAMPAIGN_SORTS = new Set(['campaign_price_asc', 'campaign_price_desc']);
const DISPLAY_CAMPAIGN_TYPES = new Set(['product', 'category', 'brand', 'dynamic', 'general']);

const getDisplayCampaignSortPrice = (row) => {
  if (!row?.hasActiveDiscount || !row?.activeCampaign) return null;
  const scope = String(row.activeCampaign.scope || '').trim().toLocaleLowerCase('tr-TR');
  if (!DISPLAY_CAMPAIGN_TYPES.has(scope)) return null;
  const price = Number(row.campaignPrice ?? row.discountedPrice);
  return Number.isFinite(price) && price > 0 ? price : null;
};

const compareCampaignPriceRows = (left, right, direction = 'asc') => {
  const leftPrice = getDisplayCampaignSortPrice(left);
  const rightPrice = getDisplayCampaignSortPrice(right);
  const leftHasPrice = leftPrice !== null;
  const rightHasPrice = rightPrice !== null;

  if (leftHasPrice && rightHasPrice && leftPrice !== rightPrice) {
    return direction === 'desc' ? rightPrice - leftPrice : leftPrice - rightPrice;
  }

  if (leftHasPrice !== rightHasPrice) {
    return leftHasPrice ? -1 : 1;
  }

  return String(left?.name || '')
    .localeCompare(String(right?.name || ''), 'tr')
    || String(left?.id || '').localeCompare(String(right?.id || ''), 'tr');
};

const normalizeStatusFilter = (value) => {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'true') return 'active';
  if (status === 'false') return 'inactive';
  return status;
};

const parseDraftFilter = (value) => ['1', 'true', 'yes', 'draft', 'drafts'].includes(String(value || '').trim().toLowerCase());

const parseCampaignOnlyFilter = (value) => ['1', 'true', 'yes', 'campaign', 'campaigns', 'discounted'].includes(String(value || '').trim().toLowerCase());

const toNullableNumberValue = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeShelfPart = (value) => String(value ?? '').trim();

const resolveProductShelfCode = ({ product = {}, payload = {}, section = null } = {}) => {
  const directCode = normalizeShelfPart(product.shelfCode || payload.shelfCode || product.defaultShelfLocationCode || payload.defaultShelfLocationCode);
  if (directCode) return directCode;

  const sectionNumber = normalizeShelfPart(section?.number || product.sectionNumber || payload.sectionNumber || product.reyonNo || payload.reyonNo);
  const side = normalizeShelfPart(product.shelfSide || payload.shelfSide);
  const no = normalizeShelfPart(product.shelfNo ?? payload.shelfNo);
  const level = normalizeShelfPart(product.shelfLevel ?? payload.shelfLevel);
  if (sectionNumber && side && no && level) return `${sectionNumber}${side}${no}-${level}`;
  return '';
};

const hasBroadActiveCampaign = (activeCampaigns = []) => (Array.isArray(activeCampaigns) ? activeCampaigns : [])
  .some((campaign) => {
    const hasExplicitScope = (Array.isArray(campaign?.targetProductIds) && campaign.targetProductIds.length > 0)
      || (Array.isArray(campaign?.targetCategoryIds) && campaign.targetCategoryIds.length > 0)
      || (Array.isArray(campaign?.targetBrands) && campaign.targetBrands.length > 0);
    const type = String(campaign?.type || '').trim().toLocaleLowerCase('tr-TR');
    return campaign?.isCurrentlyActive !== false
      && (type === 'general' || (!hasExplicitScope && type !== 'product' && type !== 'brand' && type !== 'category'));
  });

const buildScopedCampaignWhere = (activeCampaigns = []) => {
  const productIds = new Set();
  const categoryIds = new Set();
  const brands = new Set();

  activeCampaigns.forEach((campaign) => {
    (Array.isArray(campaign?.targetProductIds) ? campaign.targetProductIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
      .forEach((id) => productIds.add(id));
    (Array.isArray(campaign?.targetCategoryIds) ? campaign.targetCategoryIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
      .forEach((id) => categoryIds.add(id));
    (Array.isArray(campaign?.targetBrands) ? campaign.targetBrands : [])
      .map((brand) => String(brand || '').trim())
      .filter(Boolean)
      .forEach((brand) => brands.add(brand));
  });

  const scopeConditions = [];
  if (productIds.size) scopeConditions.push({ id: { in: Array.from(productIds) } });
  if (categoryIds.size) scopeConditions.push({ categoryId: { in: Array.from(categoryIds) } });
  if (brands.size) {
    scopeConditions.push(...Array.from(brands).map((brand) => ({
      brand: { equals: brand, mode: 'insensitive' },
    })));
  }

  if (!scopeConditions.length) return null;
  return { OR: scopeConditions };
};

const buildProductWhere = ({
  universe = null,
  includeUnlisted = false,
  search = '',
  categoryId = '',
  supplierId = '',
  supplierSearch = '',
  sectionId = '',
  listed,
  status = '',
  includeDrafts = false,
  catalogVisibility = '',
  sourceReadModel = '',
  completionStatus = '',
  tag = '',
  etiket = '',
  campaignOnly = '',
  activeCampaigns = [],
} = {}) => {
  const conditions = [];
  const normalizedStatus = normalizeStatusFilter(status);
  const wantsDrafts = parseDraftFilter(includeDrafts) || ['draft', 'pending_approval', 'incomplete'].includes(normalizedStatus);
  if (wantsDrafts) {
    conditions.push({
      isListed: false,
      isActive: false,
      catalogVisibility: String(catalogVisibility || 'staged'),
    });
  } else {
    const universeWhere = buildProductUniverseWhere(universe, { includeUnlisted });
    if (Object.keys(universeWhere).length > 0) {
      conditions.push(universeWhere);
    }
  }
  if (parseCampaignOnlyFilter(campaignOnly)) {
    const scopedCampaignWhere = buildScopedCampaignWhere(activeCampaigns);
    if (!hasBroadActiveCampaign(activeCampaigns)) {
      conditions.push(scopedCampaignWhere || { id: { in: [] } });
    }
  }
  if (listed !== undefined && listed !== '') {
    conditions.push({ isListed: parseBooleanQuery(listed, true) });
  }
  if (categoryId) conditions.push({ categoryId: String(categoryId) });
  if (supplierId) conditions.push({ supplierId: String(supplierId) });
  if (sectionId) conditions.push({ sectionId: String(sectionId) });
  if (!wantsDrafts && normalizedStatus === 'active') conditions.push({ isActive: { not: false } });
  if (!wantsDrafts && normalizedStatus === 'inactive') conditions.push({ isActive: false });
  if (!wantsDrafts && catalogVisibility) conditions.push({ catalogVisibility: String(catalogVisibility) });
  void sourceReadModel;
  void completionStatus;
  const label = String(tag || etiket || '').trim();
  if (label) conditions.push({ etiket: { contains: label, mode: 'insensitive' } });

  const q = String(search || '').trim();
  if (q) {
    conditions.push({
      OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { sku: { contains: q, mode: 'insensitive' } },
      { barcode: { contains: q, mode: 'insensitive' } },
      { brand: { contains: q, mode: 'insensitive' } },
      { etiket: { contains: q, mode: 'insensitive' } },
      { category: { is: { name: { contains: q, mode: 'insensitive' } } } },
      { supplier: { is: { name: { contains: q, mode: 'insensitive' } } } },
      {
        supplierProducts: {
          some: {
            OR: [
              { supplierProductName: { contains: q, mode: 'insensitive' } },
              { supplierProductCode: { contains: q, mode: 'insensitive' } },
              { supplierSku: { contains: q, mode: 'insensitive' } },
              { barcode: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      },
      ],
    });
  }

  const supplierName = String(supplierSearch || '').trim();
  if (supplierName) {
    conditions.push({ supplier: { is: { name: { contains: supplierName, mode: 'insensitive' } } } });
  }

  if (!conditions.length) return {};
  if (conditions.length === 1) return conditions[0];
  return { AND: conditions };
};

const mapProductListRow = (product, activeCampaigns = [], campaignOptions = {}) => {
  const payload = omitLegacyBatchPayload(product?.payload && typeof product.payload === 'object' ? product.payload : {});
  const isCatalogDraft = product.isListed === false
    && product.isActive === false
    && String(product.catalogVisibility || payload.catalogVisibility || '').trim() === 'staged';
  const completionStatus = payload.completionStatus || product.completionStatus || (isCatalogDraft ? 'incomplete' : 'complete');
  const missingFields = Array.isArray(payload.missingFields)
    ? payload.missingFields
    : (Array.isArray(product.missingFields) ? product.missingFields : []);
  const labelId = String(payload.labelId || product.tagId || product.selectedTagId || '').trim() || null;
  const labelCode = String(payload.labelCode || '').trim() || null;
  const labelDisplayCode = String(payload.labelDisplayCode || '').trim() || null;
  const labelSlug = String(payload.labelSlug || '').trim() || null;
  const category = product.category || null;
  const supplier = product.supplier || null;
  const section = product.section || null;
  const stock = product.stock || null;
  const isLightListRow = product.__listSummary === true;
  const supplierRows = Array.isArray(product.supplierProducts) ? product.supplierProducts.filter((item) => item.isActive !== false) : [];
  const warehouseLocations = Array.isArray(product.warehouseLocations) ? product.warehouseLocations : [];
  const physicalProductLocations = warehouseLocations
    .filter((loc) => Number(loc.palletCount || 0) > 0)
    .sort((a, b) => String(a.locationCode || '').localeCompare(String(b.locationCode || ''), 'tr'));
  const requiredStorageType = resolveRequiredStorageType(category, product.requiredStorageType);
  const batches = isLightListRow ? [] : normalizeStockBatchRows(stock?.batches || []);
  const warehouseStock = batches.length
    ? batches.reduce((sum, batch) => sum + Number(batch.warehouseQuantity || 0), 0)
    : Number(stock?.warehouseQuantity || 0);
  const shelfStock = batches.length
    ? batches.reduce((sum, batch) => sum + Number(batch.shelfQuantity || 0), 0)
    : Number(stock?.shelfQuantity || 0);
  const qty = warehouseStock + shelfStock;
  const reservedStock = Number(stock?.reserved || 0);
  const batchAvailability = summarizeBatchAvailability(batches, { reserved: reservedStock });
  const activeBatches = batches.filter((batch) => Number(batch.totalQuantity || 0) > 0 && batch.isExpired !== true);
  const fefoBatch = isLightListRow ? null : resolveFefoBatch(batches, stock?.fefoDefaultBatchNo);
  const batchSummary = product.listBatchSummary || buildBatchPreviewSummary(activeBatches);
  const resolvedNearestExpiry = isLightListRow ? (batchSummary.nearestExpiry || null) : (fefoBatch?.skt || null);
  const depotAssignment = resolveProductDepotAssignment({
    product,
    physicalLocations: physicalProductLocations,
    requiredStorageType,
    warehouseStock,
    shelfStock,
  });
  const resolvedShelfCapacity = deriveShelfCapacity({
    shelfCapacity: Number(product?.maxShelfStock ?? 0),
    criticalStock: Number(product?.criticalStock ?? 0),
    unitsPerCase: Number(product?.unitsPerCase ?? 24),
    averageDesi: Number(product?.averageDesi ?? 0),
  });
  const resolvedDepotCapacity = deriveDepotCapacity({
    depotCapacity: Number(product?.maxStock ?? 0),
    shelfCapacity: resolvedShelfCapacity,
  });
  const capacityProfile = deriveCapacityProfile({
    assignmentType: depotAssignment.depotAssignmentType,
    capacityMode: depotAssignment.capacityMode,
    depotCapacity: resolvedDepotCapacity,
  });
  const maxShelfStock = resolveMaxShelfStock(product, qty);
  const purchasePrice = toNumberValue(product.purchasePrice) || 0;
  const salePrice = normalizeSalePriceToAllowedCents(toNumberValue(product.salePrice) || 0);
  const averageDesi = toNullableNumberValue(product.averageDesi ?? payload.averageDesi);
  const unitsPerCase = toNullableNumberValue(product.unitsPerCase ?? payload.unitsPerCase);
  const casesPerPallet = toNullableNumberValue(product.casesPerPallet ?? payload.casesPerPallet);
  const unitsPerPallet = toNullableNumberValue(product.unitsPerPallet ?? payload.unitsPerPallet);
  const shelfCodeResolved = resolveProductShelfCode({ product, payload, section });
  const priceChange = isLightListRow
    ? (product.listPriceChangeSummary || resolveLastPriceChangeSummary(null))
    : resolveLastPriceChange(product, salePrice);
  const stockSignals = deriveStockSignals({ product, qty, shelfQty: shelfStock });
  const defaultRow = supplierRows.find((item) => item.isDefault === true)
    || [...supplierRows].sort((a, b) => Number(toNumberValue(a.purchasePrice) || 0) - Number(toNumberValue(b.purchasePrice) || 0))[0]
    || null;

  return applyCampaignPricingToProduct({
    ...payload,
    id: product.id,
    productId: product.id,
    sku: product.sku,
    barcode: product.barcode || '',
    name: product.name,
    productName: product.name,
    brand: normalizeBrandName(product.brand),
    categoryId: product.categoryId,
    supplierId: product.supplierId,
    sectionId: product.sectionId,
    shelfSide: product.shelfSide ?? payload.shelfSide ?? '',
    shelfNo: product.shelfNo ?? payload.shelfNo ?? '',
    shelfLevel: product.shelfLevel ?? payload.shelfLevel ?? '',
    shelfCode: product.shelfCode || payload.shelfCode || '',
    shelfCodeResolved,
    averageDesi,
    unitsPerCase,
    casesPerPallet,
    unitsPerPallet,
    salePrice,
    purchasePrice,
    unit: product.unit || 'adet',
    criticalStock: product.criticalStock,
    maxStock: product.maxStock,
    maxShelfStock,
    shelfCapacity: resolvedShelfCapacity,
    warehouseMaxStock: resolvedDepotCapacity,
    depotCapacity: resolvedDepotCapacity,
    isActive: product.isActive,
    isListed: product.isListed !== false,
    registerOnOrder: product.registerOnOrder === true,
    catalogVisibility: product.catalogVisibility || (product.isListed === false ? 'catalog_only' : 'listed'),
    status: isCatalogDraft ? 'draft' : (product.isActive ? 'active' : 'inactive'),
    sourceReadModel: payload.sourceReadModel || product.sourceReadModel || '',
    draftSource: payload.draftSource || product.draftSource || '',
    completionStatus,
    missingFields,
    isCatalogDraft,
    createdAt: fromDateValue(product.createdAt),
    updatedAt: fromDateValue(product.updatedAt),
    priceUpdatedAt: fromDateValue(product.priceUpdatedAt),
    lastPriceChangeDate: priceChange.lastPriceChangeDate,
    lastPriceChangeAt: priceChange.lastPriceChangeAt,
    lastPriceChangeSource: priceChange.lastPriceChangeSource,
    ...(isLightListRow ? {} : { priceHistory: priceChange.priceHistory }),
    etiket: resolveProductEtiket({ name: product.name, categoryName: category?.name || '', fallback: product.etiket }),
    labelId,
    labelCode,
    labelDisplayCode,
    labelSlug,
    categoryName: category?.name || payload.categoryName || product.categoryName || null,
    supplierName: supplier?.name || null,
    sectionName: section?.name || null,
    sectionNumber: section?.number || null,
    supplierCount: supplierRows.length,
    defaultSupplierId: defaultRow?.supplierId || null,
    defaultSupplierSuggestion: defaultRow
      ? {
        supplierId: defaultRow.supplierId,
        supplierProductId: defaultRow.id,
        purchasePrice: toNumberValue(defaultRow.purchasePrice),
      }
      : null,
    requiredStorageType,
    storageType: requiredStorageType,
    storageTypeLabel: formatStorageTypeLabel(requiredStorageType),
    warehouseLocationCount: physicalProductLocations.length,
    depotAssignmentType: capacityProfile.assignmentType,
    depotLocationCode: depotAssignment.depotLocationCode,
    depotZoneCode: depotAssignment.depotZoneCode,
    isVirtualLocation: depotAssignment.isVirtualLocation,
    capacityMode: capacityProfile.capacityMode,
    needsReview: capacityProfile.needsReview,
    stockingStrategy: depotAssignment.stockingStrategy,
    assignmentPriority: depotAssignment.assignmentPriority,
    depotLocationLabel: depotAssignment.depotLocationLabel || formatDepotLocationLabel(depotAssignment.depotLocationCode),
    depotLocationDisplay: depotAssignment.depotLocationLabel || formatDepotLocationLabel(depotAssignment.depotLocationCode),
    warehouseLocation: depotAssignment.depotLocationCode,
    defaultWarehouseLocationCode: depotAssignment.depotLocationCode || null,
    alternativeWarehouseLocationCodes: depotAssignment.isVirtualLocation ? [] : physicalProductLocations.slice(1).map((item) => item.locationCode),
    batchCount: batchSummary.batchCount,
    batchNoPreview: batchSummary.batchNoPreview,
    shortBatchSummary: batchSummary.shortBatchSummary,
    batchPreview: batchSummary.batchPreview,
    ...(isLightListRow ? {} : { batches, productBatches: batches }),
    fefoBatch: fefoBatch
      ? {
        batchNo: fefoBatch.batchNo || null,
        skt: fefoBatch.skt || null,
        totalQuantity: Number(fefoBatch.totalQuantity || 0),
        warehouseQuantity: Number(fefoBatch.warehouseQuantity || 0),
        shelfQuantity: Number(fefoBatch.shelfQuantity || 0),
      }
      : null,
    batchSummary: batchSummary.shortBatchSummary,
    warehouseStock,
    shelfStock,
    totalStock: qty,
    currentStock: qty,
    onHand: Number(stock?.onHand ?? qty),
    physicalStock: qty,
    sellableStock: batches.length ? batchAvailability.sellableQuantity : qty,
    expiredStock: batchAvailability.expiredQuantity,
    available: batches.length ? batchAvailability.available : Number(stock?.available ?? qty),
    reserved: reservedStock,
    nearestExpiry: resolvedNearestExpiry,
    stockSummary: {
      warehouseStock,
      shelfStock,
      totalStock: qty,
      onHand: Number(stock?.onHand ?? qty),
      available: Number(stock?.available ?? qty),
      reserved: Number(stock?.reserved || 0),
      batchCount: batchSummary.batchCount,
      nearestExpiry: resolvedNearestExpiry,
    },
    isCritical: stockSignals.isCritical,
    stockWarning: stockSignals.stockWarning,
    stockAlert: stockSignals.stockAlert,
    stockValue: qty * purchasePrice,
    potentialRevenue: qty * salePrice,
    marginRate: purchasePrice && salePrice ? Number((((salePrice - purchasePrice) / purchasePrice) * 100).toFixed(2)) : 0,
    productListView: {
      productId: product.id,
      sku: product.sku,
      barcode: product.barcode,
      productName: product.name,
      brand: normalizeBrandName(product.brand),
      categoryName: category?.name || payload.categoryName || product.categoryName || null,
      shelfCode: product.shelfCode || payload.shelfCode || '',
      shelfCodeResolved,
      averageDesi,
      unitsPerCase,
      casesPerPallet,
      unitsPerPallet,
      storageType: requiredStorageType,
      currentPrice: salePrice,
      salePrice,
      price: salePrice,
      supplierCount: supplierRows.length,
      onHand: Number(stock?.onHand ?? qty),
      available: Number(stock?.available ?? qty),
      nearestExpiry: resolvedNearestExpiry,
      status: isCatalogDraft ? 'draft' : (product.isActive ? 'active' : 'inactive'),
    },
  }, activeCampaigns, { includeGeneralCampaigns: true, ...campaignOptions });
};

const compactProductListRow = (row = {}, options = {}) => {
  const includeCampaignDetails = options.includeCampaignDetails === true;
  const includeListDetails = options.includeListDetails === true;
  const activeCampaign = row.activeCampaign ? {
    id: row.activeCampaign.id || null,
    name: row.activeCampaign.name || '',
    type: row.activeCampaign.type || '',
    campaignPrice: row.activeCampaign.campaignPrice ?? row.campaignPrice ?? null,
    price: row.activeCampaign.price ?? row.campaignPrice ?? null,
    startsAt: row.activeCampaign.startsAt || null,
    endsAt: row.activeCampaign.endsAt || null,
  } : null;

  return {
    id: row.id,
    productId: row.productId || row.id,
    sku: row.sku || '',
    barcode: row.barcode || '',
    name: row.name || row.productName || '',
    productName: row.productName || row.name || '',
    brand: row.brand || '',
    categoryId: row.categoryId || null,
    categoryName: row.categoryName || null,
    etiket: row.etiket || '',
    labelId: row.labelId || null,
    tag: row.tag || row.etiket || '',
    tagId: row.tagId || row.labelId || null,
    selectedTagId: row.selectedTagId || row.labelId || null,
    supplierId: row.supplierId || null,
    supplierName: row.supplierName || null,
    sectionId: row.sectionId || null,
    sectionName: row.sectionName || null,
    sectionNumber: row.sectionNumber || null,
    shelfCodeResolved: row.shelfCodeResolved || row.shelfCode || '',
    salePrice: row.salePrice ?? 0,
    purchasePrice: row.purchasePrice ?? 0,
    effectivePrice: row.effectivePrice ?? row.currentPrice ?? row.salePrice ?? 0,
    discountedPrice: row.discountedPrice ?? null,
    campaignPrice: row.campaignPrice ?? null,
    hasActiveDiscount: row.hasActiveDiscount === true,
    activeCampaign,
    ...(includeCampaignDetails ? {
      activeCampaigns: Array.isArray(row.activeCampaigns) ? row.activeCampaigns : [],
      candidateCampaigns: Array.isArray(row.candidateCampaigns) ? row.candidateCampaigns : [],
      campaignIds: Array.isArray(row.campaignIds) ? row.campaignIds : [],
    } : {}),
    campaignConflictCount: Number(row.campaignConflictCount || 0),
    unit: row.unit || 'adet',
    shelfSide: row.shelfSide || '',
    shelfNo: row.shelfNo || '',
    shelfLevel: row.shelfLevel || '',
    shelfCode: row.shelfCode || '',
    placementPriority: row.placementPriority || '',
    averageDesi: toNullableNumberValue(row.averageDesi),
    unitsPerCase: toNullableNumberValue(row.unitsPerCase),
    casesPerPallet: toNullableNumberValue(row.casesPerPallet),
    unitsPerPallet: toNullableNumberValue(row.unitsPerPallet),
    requiredStorageType: row.requiredStorageType || row.storageType || 'Ortam',
    storageType: row.storageType || row.requiredStorageType || 'Ortam',
    criticalStock: row.criticalStock ?? 0,
    maxStock: row.maxStock ?? 0,
    maxShelfStock: row.maxShelfStock ?? 0,
    shelfCapacity: row.shelfCapacity ?? row.maxShelfStock ?? 0,
    warehouseMaxStock: row.warehouseMaxStock ?? row.maxStock ?? 0,
    depotCapacity: row.depotCapacity ?? row.warehouseMaxStock ?? row.maxStock ?? 0,
    warehouseStock: Number(row.warehouseStock || 0),
    shelfStock: Number(row.shelfStock || 0),
    totalStock: Number(row.totalStock || 0),
    currentStock: Number(row.currentStock || row.totalStock || 0),
    onHand: Number(row.onHand ?? row.totalStock ?? 0),
    available: Number(row.available ?? row.totalStock ?? 0),
    reserved: Number(row.reserved || 0),
    nearestExpiry: row.nearestExpiry || null,
    batchCount: Number(row.batchCount || 0),
    batchNoPreview: Array.isArray(row.batchNoPreview) ? row.batchNoPreview.slice(0, 3) : [],
    batchPreview: Array.isArray(row.batchPreview) ? row.batchPreview.slice(0, 3) : [],
    shortBatchSummary: row.shortBatchSummary || '',
    batchSummary: row.batchSummary || row.shortBatchSummary || '',
    isCritical: row.isCritical === true,
    stockWarning: row.stockWarning || '',
    isActive: row.isActive !== false,
    isListed: row.isListed !== false,
    registerOnOrder: row.registerOnOrder === true,
    catalogVisibility: row.catalogVisibility || 'listed',
    status: row.status || (row.isActive === false ? 'inactive' : 'active'),
    sourceReadModel: row.sourceReadModel || '',
    draftSource: row.draftSource || '',
    completionStatus: row.completionStatus || 'complete',
    missingFields: Array.isArray(row.missingFields) ? row.missingFields : [],
    isCatalogDraft: row.isCatalogDraft === true,
    depotAssignmentType: row.depotAssignmentType || '',
    depotLocationCode: row.depotLocationCode || row.defaultWarehouseLocationCode || null,
    depotZoneCode: row.depotZoneCode || '',
    isVirtualLocation: row.isVirtualLocation === true,
    capacityMode: row.capacityMode || '',
    needsReview: row.needsReview === true,
    stockingStrategy: row.stockingStrategy || '',
    assignmentPriority: row.assignmentPriority || '',
    depotLocationLabel: row.depotLocationLabel || '',
    depotLocationDisplay: row.depotLocationDisplay || '',
    defaultWarehouseLocationCode: row.defaultWarehouseLocationCode || row.depotLocationCode || null,
    ...(includeListDetails ? {
      labelCode: row.labelCode || null,
      labelDisplayCode: row.labelDisplayCode || null,
      labelSlug: row.labelSlug || null,
      supplierCount: Number(row.supplierCount || 0),
      defaultSupplierId: row.defaultSupplierId || null,
      defaultSupplierSuggestion: row.defaultSupplierSuggestion || null,
      warehouseLocation: row.warehouseLocation || row.depotLocationCode || null,
      stockSummary: row.stockSummary || null,
      stockAlert: row.stockAlert || '',
      hasActiveCampaign: row.hasActiveCampaign === true,
      activeCampaignId: row.activeCampaignId || null,
      activeCampaignName: row.activeCampaignName || '',
      campaignCount: Number(row.campaignCount || 0),
      campaignInfo: row.campaignInfo || '',
      campaignBadge: row.campaignBadge || '',
      campaignStartsAt: row.campaignStartsAt || null,
      campaignEndsAt: row.campaignEndsAt || null,
      campaignValidUntil: row.campaignValidUntil || null,
      currentPrice: row.currentPrice ?? row.salePrice ?? 0,
      price: row.price ?? row.salePrice ?? 0,
      originalPrice: row.originalPrice ?? row.salePrice ?? 0,
      storageTypeLabel: row.storageTypeLabel || '',
      alternativeWarehouseLocationCodes: Array.isArray(row.alternativeWarehouseLocationCodes) ? row.alternativeWarehouseLocationCodes : [],
      depotLocations: Array.isArray(row.depotLocations) ? row.depotLocations : [],
      shelfLocations: Array.isArray(row.shelfLocations) ? row.shelfLocations : [],
      productListView: row.productListView || null,
    } : {}),
    priceUpdatedAt: row.priceUpdatedAt || null,
    lastPriceChangeDate: row.lastPriceChangeDate || null,
    lastPriceChangeAt: row.lastPriceChangeAt || null,
    lastPriceChangeSource: row.lastPriceChangeSource || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
};

const buildProductListSummary = async (prisma, { filteredTotal = null, currentPageCount = 0 } = {}) => {
  const [totalProducts, activeListedProducts, listedProducts, unlistedProducts, catalogOnlyProducts] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { isListed: { not: false }, isActive: { not: false } } }),
    prisma.product.count({ where: { isListed: { not: false } } }),
    prisma.product.count({ where: { isListed: false } }),
    prisma.product.count({
      where: {
        OR: [
          { catalogVisibility: 'catalog_only' },
          {
            AND: [
              { isListed: false },
              { registerOnOrder: true },
            ],
          },
        ],
      },
    }),
  ]);

  return {
    totalProducts,
    activeListedProducts,
    listedProducts,
    unlistedProducts,
    catalogOnlyProducts,
    filteredTotal: filteredTotal === null ? null : Number(filteredTotal || 0),
    currentPageCount: Number(currentPageCount || 0),
  };
};

const listProductsFromPostgres = async (options = {}) => {
  const prisma = await getPrisma();
  const mode = resolvePaginationMode(options.paginationMode);
  const sort = resolveWhitelistedSort(options.sort, Object.keys(PRODUCT_SORTS), 'name_asc', { context: 'GET /api/products' });
  const usesCampaignPriceSort = SCOPED_CAMPAIGN_SORTS.has(sort);
  const universe = normalizeProductUniverse(options.universe);
  const includeTotal = parseBooleanQuery(options.includeTotal, true);
  if (mode === 'cursor' && sort !== 'name_asc') {
    throw new AppError(400, 'cursor pagination only supports name_asc sort for products');
  }
  const limit = mode === 'cursor'
    ? parseLimit(options.limit, { defaultLimit: 100, maxLimit: 250 })
    : parsePagePagination(options, { defaultLimit: 100, maxLimit: 250 }).limit;
  const offsetPagination = mode === 'offset'
    ? parsePagePagination(options, { defaultLimit: 100, maxLimit: 250 })
    : null;
  const cursor = decodeCursor(options.cursor, { expectedSort: sort });
  const activeCampaigns = await listActiveCampaignDefinitions();
  const where = buildProductWhere({ ...options, universe, activeCampaigns });
  const orderBy = PRODUCT_SORTS[sort] || PRODUCT_SORTS.name_asc;
  const cursorWhere = mode === 'cursor' && cursor
    ? {
      OR: [
        { name: { gt: String(cursor.name || '') } },
        { name: String(cursor.name || ''), id: { gt: String(cursor.id || '') } },
      ],
    }
    : {};
  const effectiveWhere = mode === 'cursor' && cursor
    ? { AND: [where, cursorWhere] }
    : where;
  const take = usesCampaignPriceSort ? undefined : (mode === 'cursor' ? limit + 1 : limit);
  const skip = usesCampaignPriceSort ? 0 : (offsetPagination?.skip || 0);
  const [total, rowsRaw] = await withPostgresQueryLogging('GET /api/products', () => Promise.all([
    includeTotal ? prisma.product.count({ where }) : Promise.resolve(null),
    prisma.product.findMany({
      where: effectiveWhere,
      orderBy,
      skip: mode === 'offset' ? skip : 0,
      take,
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        brand: true,
        categoryId: true,
        supplierId: true,
        sectionId: true,
        requiredStorageType: true,
        unit: true,
        shelfSide: true,
        shelfNo: true,
        shelfLevel: true,
        shelfCode: true,
        placementPriority: true,
        averageDesi: true,
        unitsPerCase: true,
        casesPerPallet: true,
        unitsPerPallet: true,
        depotAssignmentType: true,
        depotLocationCode: true,
        depotZoneCode: true,
        isVirtualLocation: true,
        capacityMode: true,
        stockingStrategy: true,
        assignmentPriority: true,
        depotLocationLabel: true,
        defaultWarehouseLocationCode: true,
        purchasePrice: true,
        salePrice: true,
        etiket: true,
        criticalStock: true,
        maxStock: true,
        maxShelfStock: true,
        isListed: true,
        registerOnOrder: true,
        catalogVisibility: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        priceUpdatedAt: true,
        category: { select: { id: true, name: true, requiresColdChain: true, requiresFreezer: true } },
        supplier: { select: { id: true, name: true } },
        section: { select: { id: true, name: true, number: true } },
        stock: {
          select: {
            warehouseQuantity: true,
            shelfQuantity: true,
            onHand: true,
            available: true,
            reserved: true,
            nearestExpiry: true,
            batchCount: true,
            fefoDefaultBatchNo: true,
            fefoDefaultExpiry: true,
          },
        },
        supplierProducts: {
          where: { isActive: { not: false } },
          select: { id: true, supplierId: true, purchasePrice: true, isDefault: true, isActive: true },
        },
        warehouseLocations: {
          where: { palletCount: { gt: 0 } },
          select: { id: true, locationCode: true, storageType: true, status: true, palletCount: true, warehouseStock: true, batchNo: true, skt: true },
        },
      },
    }),
  ]));
  const invalidRows = rowsRaw.filter((row) => hasInvalidSalePriceCents(row?.salePrice));
  if (invalidRows.length && config.runStartupMaintenance) {
    await Promise.all(invalidRows.map((row) => prisma.product.update({
      where: { id: row.id },
      data: { salePrice: normalizeSalePriceToAllowedCents(toNumberValue(row.salePrice) || 0) },
    })));
  }
  if (invalidRows.length) {
    invalidRows.forEach((row) => {
      row.salePrice = normalizeSalePriceToAllowedCents(toNumberValue(row.salePrice) || 0);
    });
  }
  const rowsWithCampaignSort = usesCampaignPriceSort
    ? (() => {
      const rowById = new Map(rowsRaw.map((row) => [String(row.id), row]));
      return rowsRaw
        .map((row) => mapProductListRow({ ...row, __listSummary: true }, activeCampaigns, {
          includeGeneralCampaigns: options.includeGeneralCampaigns !== false,
        }))
        .sort((left, right) => compareCampaignPriceRows(left, right, sort.endsWith('_desc') ? 'desc' : 'asc'))
        .map((row) => rowById.get(String(row.id)))
        .filter(Boolean);
    })()
    : rowsRaw;
  const hasNextPage = mode === 'cursor'
    ? rowsWithCampaignSort.length > limit
    : ((offsetPagination?.skip || 0) + (usesCampaignPriceSort ? Math.min(limit, Math.max(0, Number(total || rowsWithCampaignSort.length) - (offsetPagination?.skip || 0))) : rowsWithCampaignSort.length)) < Number(total || 0);
  const rows = mode === 'cursor'
    ? rowsWithCampaignSort.slice(0, limit)
    : (usesCampaignPriceSort ? rowsWithCampaignSort.slice(offsetPagination?.skip || 0, (offsetPagination?.skip || 0) + limit) : rowsWithCampaignSort);
  const last = rows[rows.length - 1];
  const nextCursor = mode === 'cursor' && hasNextPage && last
    ? encodeCursor({ name: last.name, id: last.id }, { sort })
    : null;
  const { priceByProductId, batchByProductId } = await loadProductListDerivedSummaries(
    prisma,
    rows.map((row) => row.id)
  );
  const rowsWithSummaries = rows.map((row) => ({
    ...row,
    __listSummary: true,
    listPriceChangeSummary: priceByProductId.get(String(row.id)) || resolveLastPriceChangeSummary(null),
    listBatchSummary: batchByProductId.get(String(row.id)) || buildBatchPreviewSummary([]),
  }));
  const summary = await buildProductListSummary(prisma, {
    filteredTotal: total,
    currentPageCount: rows.length,
  });

  return {
    items: rowsWithSummaries
      .map((row) => mapProductListRow(row, activeCampaigns, {
        includeGeneralCampaigns: options.includeGeneralCampaigns !== false,
      }))
      .map((row) => compactProductListRow(row, {
        includeCampaignDetails: options.includeCampaignDetails === true,
        includeListDetails: options.includeListDetails === true,
      })),
    pagination: {
      mode,
      page: offsetPagination?.page || null,
      limit,
      total,
      totalPages: mode === 'offset' && total !== null ? Math.max(1, Math.ceil(total / limit)) : null,
      nextCursor,
      hasNextPage,
      cursorVersion: mode === 'cursor' ? 1 : null,
    },
    filters: {
      universe,
      includeUnlisted: options.includeUnlisted === true,
      search: String(options.search || '').trim() || null,
      categoryId: options.categoryId || null,
      supplierId: options.supplierId || null,
      supplierSearch: String(options.supplierSearch || '').trim() || null,
      sectionId: options.sectionId || null,
      listed: options.listed ?? null,
      status: options.status || null,
      tag: options.tag || options.etiket || null,
      campaignOnly: parseCampaignOnlyFilter(options.campaignOnly),
    },
    sort: {
      fields: ['name', 'id'],
      direction: 'asc',
      key: sort,
    },
    summary,
  };
};

const findPostgresProductIdByBarcode = async (barcode) => {
  const prisma = await getPrisma();
  const barcodeCandidates = getBarcodeCandidates(barcode);
  if (!barcodeCandidates.length) {
    throw new AppError(400, 'Barkod zorunludur');
  }

  const directProduct = await prisma.product.findFirst({
    where: { barcode: { in: barcodeCandidates } },
    select: { id: true },
  });
  if (directProduct?.id) return directProduct.id;

  const supplierProduct = await prisma.supplierProduct.findFirst({
    where: {
      productId: { not: null },
      barcode: { in: barcodeCandidates },
      isActive: { not: false },
    },
    select: { productId: true },
  });
  if (supplierProduct?.productId) return supplierProduct.productId;

  const candidateSet = new Set(barcodeCandidates);
  const rows = await prisma.product.findMany({
    select: {
      id: true,
      barcode: true,
      payload: true,
      supplierProducts: {
        where: { isActive: { not: false } },
        select: {
          barcode: true,
          payload: true,
        },
      },
    },
  });

  const payloadMatch = rows.find((product) => {
    const productCandidates = getProductBarcodeCandidates(product);
    if (productCandidates.some((candidate) => candidateSet.has(candidate))) {
      return true;
    }
    return (product.supplierProducts || []).some((row) =>
      getSupplierProductBarcodeCandidates(row).some((candidate) => candidateSet.has(candidate))
    );
  });

  return payloadMatch?.id || null;
};

const enrichProduct = async (product, activeCampaigns = null, campaignOptions = {}) => {
  const [category, supplier, stock, section, supplierProducts, warehouseLocations, suppliers] = await Promise.all([
    categoryRepo.findById(product.categoryId),
    product.supplierId ? supplierRepo.findById(product.supplierId) : Promise.resolve(null),
    stockRepo.findByProductId(product.id),
    product.sectionId ? sectionRepo.findById(product.sectionId) : Promise.resolve(null),
    supplierProductRepo.getAll(),
    warehouseLocationRepo.getAll(),
    supplierRepo.getAll(),
  ]);

  const productSupplierRows = supplierProducts.filter((item) => item.productId === product.id && item.isActive !== false);
  const defaultRow = productSupplierRows.find((item) => item.isDefault === true)
    || [...productSupplierRows].sort((a, b) => Number(a.purchasePrice || 0) - Number(b.purchasePrice || 0))[0]
    || null;

  const physicalProductLocations = warehouseLocations
    .filter((loc) => String(loc.productId || '') === String(product.id) && Number(loc.palletCount || 0) > 0)
    .sort((a, b) => String(a.locationCode || '').localeCompare(String(b.locationCode || ''), 'tr'));
  const requiredStorageType = resolveRequiredStorageType(category, product.requiredStorageType);
  const compatibleLocationCount = warehouseLocations.filter((loc) => String(loc.storageType || 'Ortam') === requiredStorageType && loc.isVirtualLocation !== true).length;

  const batches = normalizeStockBatchRows(stock?.batches || []);
  const warehouseStock = batches.length
    ? batches.reduce((sum, batch) => sum + Number(batch.warehouseQuantity || 0), 0)
    : stock?.warehouseQuantity || 0;
  const shelfStock = batches.length
    ? batches.reduce((sum, batch) => sum + Number(batch.shelfQuantity || 0), 0)
    : stock?.shelfQuantity || 0;
  const salePrice = normalizeSalePriceToAllowedCents(toNumberValue(product.salePrice) || 0);
  const priceChange = resolveLastPriceChange(product, salePrice);
  const depotAssignment = resolveProductDepotAssignment({
    product,
    physicalLocations: physicalProductLocations,
    requiredStorageType,
    warehouseStock,
    shelfStock,
  });
  const depotLocations = buildDepotLocationViews({
    assignment: depotAssignment,
    physicalLocations: physicalProductLocations,
    warehouseStock,
    stockBatches: batches,
  });
  const defaultWarehouseLocationCode = depotAssignment.depotLocationCode || null;
  const alternativeWarehouseLocationCodes = depotAssignment.isVirtualLocation
    ? []
    : physicalProductLocations.slice(1).map((item) => item.locationCode);
  const qty = warehouseStock + shelfStock;
  const maxShelfStock = resolveMaxShelfStock(product, qty);
  const stockSignals = deriveStockSignals({ product, qty, shelfQty: shelfStock });
  const supplierMap = new Map(suppliers.map((item) => [item.id, item]));
  const payload = omitLegacyBatchPayload(product?.payload && typeof product.payload === 'object' ? product.payload : {});
  const isCatalogDraft = product.isListed === false
    && product.isActive === false
    && String(product.catalogVisibility || payload.catalogVisibility || '').trim() === 'staged';
  const completionStatus = payload.completionStatus || product.completionStatus || (isCatalogDraft ? 'incomplete' : 'complete');
  const missingFields = Array.isArray(payload.missingFields)
    ? payload.missingFields
    : (Array.isArray(product.missingFields) ? product.missingFields : []);
  const labelId = String(payload.labelId || product.tagId || product.selectedTagId || '').trim() || null;
  const labelCode = String(payload.labelCode || '').trim() || null;
  const labelDisplayCode = String(payload.labelDisplayCode || '').trim() || null;
  const labelSlug = String(payload.labelSlug || '').trim() || null;
  const reserved = Number(stock?.reserved || 0);
  const batchAvailability = summarizeBatchAvailability(batches, { reserved });
  const onHand = Number(stock?.onHand ?? qty);
  const available = batches.length ? batchAvailability.available : Number(stock?.available ?? qty);
  let nearestExpiry = null;
  const batchCount = batches.length
    ? batches.filter((item) => Number(item?.totalQuantity || 0) > 0 && item.isExpired !== true).length
    : Number(stock?.batchCount || 0);
  const supplierList = productSupplierRows
    .map((row) => ({
      supplierProductId: row.id,
      supplierId: row.supplierId,
      supplierName: supplierMap.get(row.supplierId)?.name || '-',
      purchasePrice: Number(row.purchasePrice || 0),
      minimumOrderQty: Number(row.minimumOrderQty || 1),
      minimumOrderCaseQty: Number(row.minimumOrderQty || 1),
      moqCases: Number(row.minimumOrderQty || 1),
      leadTimeDays: Number(row.leadTimeDays || 0) || null,
      isPrimary: row.isDefault === true,
    }))
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.supplierName.localeCompare(right.supplierName, 'tr'));
  const primarySupplier = supplierList.find((item) => item.isPrimary) || supplierList[0] || null;
  const fefoBatch = batches.length > 0
    ? batches.find((item) => item.isExpired !== true && String(item.batchNo || '') === String(stock?.fefoDefaultBatchNo || ''))
      || batches
        .filter((item) => item.isExpired !== true && Number(item?.totalQuantity || 0) > 0)
        .sort((left, right) => String(left?.skt || '').localeCompare(String(right?.skt || '')))[0]
      || null
    : null;
  nearestExpiry = fefoBatch?.skt || null;
  const shelfLocations = section
    ? [{
      sectionId: section.id,
      sectionName: section.name,
      sectionNumber: section.number,
      shelfSide: product.shelfSide || null,
      shelfNo: product.shelfNo || null,
      shelfLevel: product.shelfLevel || null,
      shelfCode: product.shelfCode || null,
    }]
    : [];

  const resolvedActiveCampaigns = Array.isArray(activeCampaigns) ? activeCampaigns : await listActiveCampaignDefinitions();

  return applyCampaignPricingToProduct({
    ...product,
    productId: product.id,
    productName: product.name,
    salePrice,
    lastPriceChangeDate: priceChange.lastPriceChangeDate,
    lastPriceChangeAt: priceChange.lastPriceChangeAt,
    lastPriceChangeSource: priceChange.lastPriceChangeSource,
    priceHistory: priceChange.priceHistory,
    productDetailView: {
      productId: product.id,
      sku: product.sku,
      barcode: product.barcode,
      productName: product.name,
      brand: normalizeBrandName(product.brand),
      categoryName: category?.name || payload.categoryName || product.categoryName || null,
      storageType: requiredStorageType,
      storageTypeLabel: formatStorageTypeLabel(requiredStorageType),
      currentPrice: salePrice,
      salePrice,
      price: salePrice,
      status: isCatalogDraft ? 'draft' : (product.isActive ? 'active' : 'inactive'),
      lastPriceChangeDate: priceChange.lastPriceChangeDate,
      lastPriceChangeAt: priceChange.lastPriceChangeAt,
    },
    status: isCatalogDraft ? 'draft' : (product.isActive ? 'active' : 'inactive'),
    sourceReadModel: payload.sourceReadModel || product.sourceReadModel || '',
    draftSource: payload.draftSource || product.draftSource || '',
    completionStatus,
    missingFields,
    isCatalogDraft,
    etiket: resolveProductEtiket({ name: product.name, categoryName: category?.name || '', fallback: product.etiket }),
    labelId,
    labelCode,
    labelDisplayCode,
    labelSlug,
    categoryName: category?.name || payload.categoryName || product.categoryName || null,
    supplierName: supplier?.name || null,
    supplierCount: productSupplierRows.length,
    defaultSupplierId: defaultRow?.supplierId || null,
    defaultSupplierSuggestion: defaultRow
      ? {
        supplierId: defaultRow.supplierId,
        supplierProductId: defaultRow.id,
        purchasePrice: defaultRow.purchasePrice,
      }
      : null,
    procurementOptions: productSupplierRows.map((row) => ({
      supplierProductId: row.id,
      supplierId: row.supplierId,
      supplierName: supplierMap.get(row.supplierId)?.name || '-',
      purchasePrice: row.purchasePrice,
      minimumOrderQty: row.minimumOrderQty,
      minimumOrderCaseQty: row.minimumOrderQty,
      minOrderQtyCases: row.minimumOrderQty,
      moqCases: row.minimumOrderQty,
      leadTimeDays: Number(row.leadTimeDays || 0) || null,
      isPrimary: row.isDefault === true,
    })),
    procurementView: productSupplierRows.map((row) => ({
      supplierProductId: row.id,
      supplierId: row.supplierId,
      supplierName: supplierMap.get(row.supplierId)?.name || '-',
      supplierCode: supplierMap.get(row.supplierId)?.code || supplierMap.get(row.supplierId)?.supplierCode || row.supplierId,
      sku: product.sku,
      isPrimary: row.isDefault === true,
      minOrderQtyCases: Number(row.minimumOrderQty || 1),
      leadTimeDays: Number(row.leadTimeDays || 0) || null,
      referencePurchasePrice: Number(row.purchasePrice || 0),
      moqUnitPrice: Number(row.purchasePrice || 0),
      bulk10PlusUnitPrice: row.tierPrice10Case ?? null,
      storageType: requiredStorageType,
    })),
    supplierList,
    primarySupplier,
    primarySuppliers: primarySupplier ? [primarySupplier] : [],
    requiredStorageType,
    storageType: requiredStorageType,
    storageTypeLabel: formatStorageTypeLabel(requiredStorageType),
    warehouseMaxStock: compatibleLocationCount,
    warehouseLocationCount: physicalProductLocations.length,
    depotAssignmentType: depotAssignment.depotAssignmentType,
    depotLocationCode: depotAssignment.depotLocationCode,
    depotZoneCode: depotAssignment.depotZoneCode,
    isVirtualLocation: depotAssignment.isVirtualLocation,
    capacityMode: depotAssignment.capacityMode,
    stockingStrategy: depotAssignment.stockingStrategy,
    assignmentPriority: depotAssignment.assignmentPriority,
    depotLocationLabel: depotAssignment.depotLocationLabel || formatDepotLocationLabel(depotAssignment.depotLocationCode),
    depotLocationDisplay: depotAssignment.depotLocationLabel || formatDepotLocationLabel(depotAssignment.depotLocationCode),
    warehouseLocation: depotAssignment.depotLocationCode,
    defaultWarehouseLocationCode,
    alternativeWarehouseLocationCodes,
    depotLocations,
    sectionName: section?.name || null,
    sectionNumber: section?.number || null,
    shelfLocations,
    warehouseStock,
    shelfStock,
    maxShelfStock,
    onHand,
    available,
    reserved,
    physicalStock: qty,
    sellableStock: batches.length ? batchAvailability.sellableQuantity : qty,
    expiredStock: batchAvailability.expiredQuantity,
    nearestExpiry,
    batchCount,
    batches,
    productBatches: batches,
    fefoBatch: fefoBatch
      ? {
        batchNo: fefoBatch.batchNo || null,
        skt: fefoBatch.skt || null,
        totalQuantity: Number(fefoBatch.totalQuantity || 0),
        warehouseQuantity: Number(fefoBatch.warehouseQuantity || 0),
        shelfQuantity: Number(fefoBatch.shelfQuantity || 0),
      }
      : null,
    totalStock: qty,
    currentStock: qty,
    stockSummary: {
      warehouseStock,
      shelfStock,
      totalStock: qty,
      onHand,
      available,
      reserved,
      physicalStock: qty,
      sellableStock: batches.length ? batchAvailability.sellableQuantity : qty,
      expiredStock: batchAvailability.expiredQuantity,
      nearestExpiry,
      batchCount,
    },
    isCritical: stockSignals.isCritical,
    stockWarning: stockSignals.stockWarning,
    stockAlert: stockSignals.stockAlert,
    stockValue: qty * (product.purchasePrice || 0),
    potentialRevenue: qty * (product.salePrice || 0),
    marginRate:
      product.purchasePrice && product.salePrice
        ? Number((((product.salePrice - product.purchasePrice) / product.purchasePrice) * 100).toFixed(2))
        : 0,
  }, resolvedActiveCampaigns, { includeGeneralCampaigns: true, ...campaignOptions });
};

const ensureRelations = async ({ categoryId, supplierId }) => {
  const category = await categoryRepo.findById(categoryId);
  if (!category) {
    throw new AppError(400, 'Geçersiz kategori');
  }

  if (!category.isActive) {
    throw new AppError(400, 'Pasif kategoriye ürün eklenemez');
  }

  if (supplierId) {
    const supplier = await supplierRepo.findById(supplierId);
    if (!supplier) {
      throw new AppError(400, 'Geçersiz tedarikçi');
    }

    if (!supplier.isActive) {
      throw new AppError(400, 'Pasif tedarikçi seçilemez');
    }
  }

  return { category };
};

const buildShelfCode = async (input) => {
  if (!input.sectionId || !input.shelfSide || !input.shelfNo || !input.shelfLevel) return '';
  const section = await sectionRepo.findById(input.sectionId);
  if (!section) return '';
  return `${section.number}${input.shelfSide}${input.shelfNo}-${input.shelfLevel}`;
};

const resolveProductLogistics = (input, fallback = {}) => {
  const fallbackUnitsPerCase = Math.max(1, Number(fallback.unitsPerCase || 24));
  const fallbackCasesPerPallet = Math.max(1, Number(fallback.casesPerPallet || 60));

  const unitsPerCase = Math.max(1, Number(input.unitsPerCase || fallbackUnitsPerCase));
  const casesPerPallet = Math.max(1, Number(input.casesPerPallet || fallbackCasesPerPallet));
  const unitsPerPallet = Math.max(1, unitsPerCase * casesPerPallet);

  return {
    unitsPerCase,
    casesPerPallet,
    unitsPerPallet,
  };
};

export const productService = {
  async list(options = {}) {
    if (config.dataStore === 'postgres') {
      return listProductsFromPostgres(options);
    }

    const mode = resolvePaginationMode(options.paginationMode);
    const sort = resolveWhitelistedSort(options.sort, Object.keys(PRODUCT_SORTS), 'name_asc', { context: 'GET /api/products' });
    const universe = normalizeProductUniverse(options.universe);
    const includeUnlisted = options.includeUnlisted === true;
    const includeTotal = parseBooleanQuery(options.includeTotal, true);
    if (mode === 'cursor' && sort !== 'name_asc') {
      throw new AppError(400, 'cursor pagination only supports name_asc sort for products');
    }
    const limit = mode === 'cursor'
      ? parseLimit(options.limit, { defaultLimit: 100, maxLimit: 250 })
      : parsePagePagination(options, { defaultLimit: 100, maxLimit: 250 }).limit;
    const offsetPagination = mode === 'offset'
      ? parsePagePagination(options, { defaultLimit: 100, maxLimit: 250 })
      : null;
    const cursor = decodeCursor(options.cursor, { expectedSort: sort });
    const [products, categories, suppliers, stocks, sections, supplierProducts, warehouseLocations, activeCampaigns] = await Promise.all([
      productRepo.getAll(),
      categoryRepo.getAll(),
      supplierRepo.getAll(),
      stockRepo.getAll(),
      sectionRepo.getAll(),
      supplierProductRepo.getAll(),
      warehouseLocationRepo.getAll(),
      listActiveCampaignDefinitions(),
    ]);

    const catMap = new Map(categories.map((c) => [c.id, c]));
    const supMap = new Map(suppliers.map((s) => [s.id, s]));
    const stockMap = new Map(stocks.map((s) => [s.productId, s]));
    const secMap = new Map(sections.map((s) => [s.id, s]));
    const activeSupplierProducts = supplierProducts.filter((item) => item.isActive !== false);

    const filteredItems = products
      .filter((product) => matchesProductUniverse(product, universe, { includeUnlisted }))
      .filter((product) => {
        if (options.listed === undefined || options.listed === '') return true;
        return (product.isListed !== false) === parseBooleanQuery(options.listed, true);
      })
      .filter((product) => {
        const normalizedStatus = normalizeStatusFilter(options.status);
        if (!normalizedStatus) return true;
        if (normalizedStatus === 'active') return product.isActive !== false;
        if (normalizedStatus === 'inactive') return product.isActive === false;
        return true;
      })
      .filter((product) => !options.categoryId || String(product.categoryId || '') === String(options.categoryId))
      .filter((product) => !options.supplierId || String(product.supplierId || '') === String(options.supplierId))
      .filter((product) => !options.sectionId || String(product.sectionId || '') === String(options.sectionId))
      .filter((product) => {
        const label = String(options.tag || options.etiket || '').trim();
        if (!label) return true;
        return includesProductSearchText(product.etiket, label);
      })
      .filter((product) => {
        const q = String(options.search || '').trim();
        if (!q) return true;
        const categoryName = catMap.get(product.categoryId)?.name || '';
        const supplierName = supMap.get(product.supplierId)?.name || '';
        const productSupplierNames = activeSupplierProducts
          .filter((item) => String(item.productId || '') === String(product.id || ''))
          .flatMap((item) => [item.supplierProductName, item.supplierProductCode, item.supplierSku, item.barcode]);
        return [
          product.name,
          product.sku,
          product.barcode,
          product.brand,
          product.etiket,
          categoryName,
          supplierName,
          ...productSupplierNames,
        ].some((value) => includesProductSearchText(value, q));
      })
      .filter((product) => {
        const supplierNameQuery = String(options.supplierSearch || '').trim();
        if (!supplierNameQuery) return true;
        const supplierName = supMap.get(product.supplierId)?.name || '';
        return includesProductSearchText(supplierName, supplierNameQuery);
      })
      .filter((product) => {
        if (!parseCampaignOnlyFilter(options.campaignOnly)) return true;
        return applyCampaignPricingToProduct(product, activeCampaigns, { includeGeneralCampaigns: options.includeGeneralCampaigns !== false }).hasActiveDiscount === true;
      })
      .map((product) => {
      const category = catMap.get(product.categoryId) || null;
      const supplier = product.supplierId ? supMap.get(product.supplierId) || null : null;
      const stock = stockMap.get(product.id) || null;
      const section = product.sectionId ? secMap.get(product.sectionId) || null : null;
      const physicalProductLocations = warehouseLocations
        .filter((loc) => String(loc.productId || '') === String(product.id) && Number(loc.palletCount || 0) > 0)
        .sort((a, b) => String(a.locationCode || '').localeCompare(String(b.locationCode || ''), 'tr'));
      const requiredStorageType = resolveRequiredStorageType(category, product.requiredStorageType);
      const compatibleLocationCount = warehouseLocations.filter((loc) => String(loc.storageType || 'Ortam') === requiredStorageType && loc.isVirtualLocation !== true).length;
      const productSupplierRows = activeSupplierProducts.filter((item) => item.productId === product.id);
      const defaultRow = productSupplierRows.find((item) => item.isDefault === true)
        || [...productSupplierRows].sort((a, b) => Number(a.purchasePrice || 0) - Number(b.purchasePrice || 0))[0]
        || null;
      const warehouseStock = stock?.warehouseQuantity || 0;
      const shelfStock = stock?.shelfQuantity || 0;
      const batches = Array.isArray(stock?.batches) ? stock.batches : [];
      const depotAssignment = resolveProductDepotAssignment({
        product,
        physicalLocations: physicalProductLocations,
        requiredStorageType,
        warehouseStock,
        shelfStock,
      });
      const resolvedShelfCapacity = deriveShelfCapacity({
        shelfCapacity: Number(product.maxShelfStock ?? product.shelfMaxStock ?? 0),
        criticalStock: Number(product.criticalStock ?? 0),
        unitsPerCase: Number(product.unitsPerCase ?? 24),
        averageDesi: Number(product.averageDesi ?? 0),
      });
      const resolvedDepotCapacity = deriveDepotCapacity({
        depotCapacity: Number(product.maxStock ?? product.warehouseMaxStock ?? product.maxWarehouseStock ?? 0),
        shelfCapacity: resolvedShelfCapacity,
      });
      const capacityProfile = deriveCapacityProfile({
        assignmentType: depotAssignment.depotAssignmentType,
        capacityMode: depotAssignment.capacityMode,
        depotCapacity: resolvedDepotCapacity,
      });
      const qty = warehouseStock + shelfStock;
      const maxShelfStock = resolveMaxShelfStock(product, qty);
      const salePrice = normalizeSalePriceToAllowedCents(toNumberValue(product.salePrice) || 0);
      const priceChange = resolveLastPriceChange(product, salePrice);

      const stockSignals = deriveStockSignals({ product, qty, shelfQty: shelfStock });
      const onHand = Number(stock?.onHand ?? qty);
      const available = Number(stock?.available ?? qty);
      const nearestExpiry = [...batches]
        .filter((item) => Number(item?.totalQuantity || 0) > 0 && item?.skt)
        .sort((left, right) => String(left?.skt || '').localeCompare(String(right?.skt || ''), 'tr'))[0]?.skt || null;
      const supplierCount = productSupplierRows.length;
      const payload = omitLegacyBatchPayload(product?.payload && typeof product.payload === 'object' ? product.payload : {});
      const labelId = String(payload.labelId || product.tagId || product.selectedTagId || '').trim() || null;
      const labelCode = String(payload.labelCode || '').trim() || null;
      const labelDisplayCode = String(payload.labelDisplayCode || '').trim() || null;
      const labelSlug = String(payload.labelSlug || '').trim() || null;

      return applyCampaignPricingToProduct({
        ...product,
        productId: product.id,
        productName: product.name,
        productListView: {
          productId: product.id,
          sku: product.sku,
          barcode: product.barcode,
          productName: product.name,
          brand: normalizeBrandName(product.brand),
          categoryName: category?.name || null,
          storageType: requiredStorageType,
          currentPrice: salePrice,
          salePrice,
          price: salePrice,
          supplierCount,
          onHand,
          available,
          nearestExpiry,
          status: product.isActive ? 'active' : 'inactive',
        },
        status: product.isActive ? 'active' : 'inactive',
        etiket: resolveProductEtiket({ name: product.name, categoryName: category?.name || '', fallback: product.etiket }),
        labelId,
        labelCode,
        labelDisplayCode,
        labelSlug,
        isListed: product.isListed !== false,
        registerOnOrder: product.registerOnOrder === true,
        catalogVisibility: product.catalogVisibility || (product.isListed === false ? 'catalog_only' : 'listed'),
        categoryName: category?.name || null,
        supplierName: supplier?.name || null,
        supplierCount,
        defaultSupplierId: defaultRow?.supplierId || null,
        defaultSupplierSuggestion: defaultRow
          ? {
            supplierId: defaultRow.supplierId,
            supplierProductId: defaultRow.id,
            purchasePrice: defaultRow.purchasePrice,
          }
          : null,
        requiredStorageType,
        storageType: requiredStorageType,
        warehouseMaxStock: resolvedDepotCapacity,
        depotCapacity: resolvedDepotCapacity,
        shelfCapacity: resolvedShelfCapacity,
        warehouseLocationCount: physicalProductLocations.length,
        depotAssignmentType: capacityProfile.assignmentType,
        depotLocationCode: depotAssignment.depotLocationCode,
        depotZoneCode: depotAssignment.depotZoneCode,
        isVirtualLocation: depotAssignment.isVirtualLocation,
        capacityMode: capacityProfile.capacityMode,
        needsReview: capacityProfile.needsReview,
        stockingStrategy: depotAssignment.stockingStrategy,
        assignmentPriority: depotAssignment.assignmentPriority,
        depotLocationLabel: depotAssignment.depotLocationLabel,
        warehouseLocation: depotAssignment.depotLocationCode,
        defaultWarehouseLocationCode: depotAssignment.depotLocationCode || null,
        alternativeWarehouseLocationCodes: depotAssignment.isVirtualLocation ? [] : physicalProductLocations.slice(1).map((item) => item.locationCode),
        depotLocations: buildDepotLocationViews({
          assignment: depotAssignment,
          physicalLocations: physicalProductLocations,
          warehouseStock,
          stockBatches: batches,
        }),
        sectionName: section?.name || null,
        sectionNumber: section?.number || null,
        warehouseStock,
        shelfStock,
        maxShelfStock,
        onHand,
        available,
        nearestExpiry,
        stockSummary: {
          warehouseStock,
          shelfStock,
          totalStock: qty,
          onHand,
          available,
          reserved: Number(stock?.reserved || 0),
          nearestExpiry,
          batchCount: Number(stock?.batchCount || (Array.isArray(stock?.batches) ? stock.batches.filter((item) => Number(item?.totalQuantity || 0) > 0).length : 0)),
        },
        totalStock: qty,
        currentStock: qty,
        isCritical: stockSignals.isCritical,
        stockWarning: stockSignals.stockWarning,
        stockAlert: stockSignals.stockAlert,
        stockValue: qty * (product.purchasePrice || 0),
        potentialRevenue: qty * salePrice,
        marginRate:
          product.purchasePrice && salePrice
            ? Number((((salePrice - product.purchasePrice) / product.purchasePrice) * 100).toFixed(2))
            : 0,
        salePrice,
        lastPriceChangeDate: priceChange.lastPriceChangeDate,
        lastPriceChangeAt: priceChange.lastPriceChangeAt,
        lastPriceChangeSource: priceChange.lastPriceChangeSource,
        priceHistory: priceChange.priceHistory,
      }, activeCampaigns, { includeGeneralCampaigns: options.includeGeneralCampaigns !== false });
    });
    const sortedItems = SCOPED_CAMPAIGN_SORTS.has(sort)
      ? filteredItems.sort((left, right) => compareCampaignPriceRows(left, right, sort.endsWith('_desc') ? 'desc' : 'asc'))
      : filteredItems.sort((left, right) => {
        const order = PRODUCT_SORTS[sort] || PRODUCT_SORTS.name_asc;
        const first = order[0] || { name: 'asc' };
        const field = Object.keys(first)[0] || 'name';
        const direction = first[field] === 'desc' ? -1 : 1;
        const leftValue = left[field] ?? left.name ?? '';
        const rightValue = right[field] ?? right.name ?? '';
        if (typeof leftValue === 'number' || typeof rightValue === 'number') {
          return (Number(leftValue || 0) - Number(rightValue || 0)) * direction;
        }
        return String(leftValue || '').localeCompare(String(rightValue || ''), 'tr') * direction;
      });
    const cursorIndex = mode === 'cursor' && cursor
      ? sortedItems.findIndex((item) => String(item.name || '') === String(cursor.name || '') && String(item.id || '') === String(cursor.id || ''))
      : -1;
    const cursorStart = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageStart = mode === 'cursor' ? cursorStart : (offsetPagination?.skip || 0);
    const pageRows = sortedItems.slice(pageStart, pageStart + limit + (mode === 'cursor' ? 1 : 0));
    const hasNextPage = mode === 'cursor'
      ? pageRows.length > limit
      : pageStart + Math.min(limit, pageRows.length) < sortedItems.length;
    const rows = mode === 'cursor' ? pageRows.slice(0, limit) : pageRows.slice(0, limit);
    const last = rows[rows.length - 1];
    const nextCursor = mode === 'cursor' && hasNextPage && last
      ? encodeCursor({ name: last.name, id: last.id }, { sort })
      : null;

    return {
      items: rows.map((row) => compactProductListRow(row, {
        includeCampaignDetails: options.includeCampaignDetails === true,
        includeListDetails: options.includeListDetails === true,
      })),
      pagination: {
        mode,
        page: offsetPagination?.page || null,
        limit,
        total: includeTotal ? sortedItems.length : null,
        totalPages: mode === 'offset' && includeTotal ? Math.max(1, Math.ceil(sortedItems.length / limit)) : null,
        nextCursor,
        hasNextPage,
        cursorVersion: mode === 'cursor' ? 1 : null,
      },
      filters: {
        universe,
        includeUnlisted,
        search: String(options.search || '').trim() || null,
        categoryId: options.categoryId || null,
        supplierId: options.supplierId || null,
        supplierSearch: String(options.supplierSearch || '').trim() || null,
        sectionId: options.sectionId || null,
        listed: options.listed ?? null,
        status: options.status || null,
        tag: options.tag || options.etiket || null,
        campaignOnly: parseCampaignOnlyFilter(options.campaignOnly),
      },
      sort: {
        fields: ['name', 'id'],
        direction: 'asc',
        key: sort,
      },
    };
  },

  async getById(id, options = {}) {
    const activeCampaigns = await listActiveCampaignDefinitions();
    if (config.dataStore === 'postgres') {
      const prisma = await getPrisma();
      const product = await prisma.product.findUnique({
        where: { id },
        select: {
          id: true,
          sku: true,
          barcode: true,
          name: true,
          brand: true,
          categoryId: true,
          supplierId: true,
          sectionId: true,
          shelfSide: true,
          shelfNo: true,
          shelfLevel: true,
          shelfCode: true,
          requiredStorageType: true,
          unit: true,
          purchasePrice: true,
          salePrice: true,
          etiket: true,
          averageDesi: true,
          unitsPerCase: true,
          casesPerPallet: true,
          unitsPerPallet: true,
          criticalStock: true,
          maxStock: true,
          maxShelfStock: true,
          isListed: true,
          registerOnOrder: true,
          catalogVisibility: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          priceUpdatedAt: true,
          lastPriceChangeDate: true,
          lastPriceChangeAt: true,
          lastPriceChangeSource: true,
          payload: true,
          category: { select: { id: true, name: true, requiresColdChain: true, requiresFreezer: true } },
          supplier: { select: { id: true, name: true } },
          section: { select: { id: true, name: true, number: true } },
          stock: {
            select: {
              warehouseQuantity: true,
              shelfQuantity: true,
              onHand: true,
              available: true,
              reserved: true,
              nearestExpiry: true,
              batchCount: true,
              fefoDefaultBatchNo: true,
              fefoDefaultExpiry: true,
              batches: {
                select: {
                  id: true,
                  batchNo: true,
                  skt: true,
                  warehouseQuantity: true,
                  shelfQuantity: true,
                  totalQuantity: true,
                  status: true,
                  payload: true,
                },
              },
            },
          },
          supplierProducts: {
            where: { isActive: { not: false } },
            select: { id: true, supplierId: true, purchasePrice: true, isDefault: true, isActive: true },
          },
          warehouseLocations: {
            where: { palletCount: { gt: 0 } },
            select: { id: true, locationCode: true, storageType: true, status: true, palletCount: true, warehouseStock: true, batchNo: true, skt: true },
          },
          priceEvents: {
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: { id: true, productId: true, previousSalePrice: true, salePrice: true, source: true, payload: true, createdAt: true },
          },
        },
      });
      if (!product) {
        throw createNotFoundError('Ürün bulunamadı');
      }
      if (hasInvalidSalePriceCents(product.salePrice)) {
        const normalizedSalePrice = normalizeSalePriceToAllowedCents(toNumberValue(product.salePrice) || 0);
        await prisma.product.update({
          where: { id },
          data: { salePrice: normalizedSalePrice },
        });
      }
      const mapped = mapProductListRow(product, activeCampaigns, {
        includeGeneralCampaigns: options.includeGeneralCampaigns !== false,
      });
      return {
        ...mapped,
        productDetailView: {
          productId: mapped.productId,
          sku: mapped.sku,
          barcode: mapped.barcode,
          productName: mapped.name,
          brand: mapped.brand || '',
          categoryName: mapped.categoryName || null,
          storageType: mapped.storageType || 'Ortam',
          storageTypeLabel: mapped.storageTypeLabel || formatStorageTypeLabel(mapped.storageType || 'Ortam'),
          currentPrice: mapped.currentPrice,
          salePrice: mapped.salePrice,
          price: mapped.originalPrice || mapped.salePrice,
          status: mapped.status,
          lastPriceChangeDate: mapped.lastPriceChangeDate,
          lastPriceChangeAt: mapped.lastPriceChangeAt,
          lastPriceChangeSource: mapped.lastPriceChangeSource,
        },
      };
    }

    const product = await productRepo.findById(id);
    if (!product) {
      throw createNotFoundError('Ürün bulunamadı');
    }

    return enrichProduct(product);
  },

  async create(payload) {
    validateProductPayload(payload);
    const input = sanitizeProductInput(payload);
    const relations = await ensureRelations(input);

    const existing = await productRepo.findBySku(input.sku);
    if (existing) {
      throw new AppError(409, 'SKU zaten mevcut');
    }

    const existingBarcode = await productRepo.findByBarcode(input.barcode);
    if (existingBarcode) {
      throw new AppError(409, 'Barkod zaten mevcut');
    }

    const settings = await settingsRepo.getSettings();
    const shelfCode = await buildShelfCode(input);
    const now = new Date().toISOString();
    const canonicalLabel = await resolveCanonicalLabel({ input, categoryName: relations.category?.name || '' });
    const logistics = resolveProductLogistics(input);
    const resolvedShelfCapacity = deriveShelfCapacity({
      shelfCapacity: Number(input.maxShelfStock || 0),
      criticalStock: Number(input.criticalStock ?? settings.defaultCritical ?? 0),
      unitsPerCase: Number(input.unitsPerCase ?? 24),
      averageDesi: Number(input.averageDesi ?? 0),
    });
    const resolvedDepotCapacity = deriveDepotCapacity({
      depotCapacity: Number(input.maxStock || 0),
      shelfCapacity: resolvedShelfCapacity,
    });
    const requiredStorageType = resolveRequiredStorageType(relations.category, input.requiredStorageType);
    const depotAssignment = resolveRequestedDepotAssignment({
      input,
      storageType: requiredStorageType,
      isListed: input.isListed !== false,
      warehouseQuantity: 0,
      shelfQuantity: 0,
    });
    const capacityProfile = deriveCapacityProfile({
      assignmentType: depotAssignment.depotAssignmentType,
      capacityMode: depotAssignment.capacityMode,
      depotCapacity: Number(input.maxStock || 0),
    });
    const product = {
      id: uuidv4(),
      sku: input.sku,
      barcode: input.barcode,
      name: input.name,
      brand: normalizeBrandName(input.brand),
      categoryId: input.categoryId,
      supplierId: input.supplierId,
      sectionId: input.sectionId,
      shelfSide: input.shelfSide,
      shelfNo: input.shelfNo,
      shelfLevel: input.shelfLevel,
      requiredStorageType,
      shelfCode,
      unit: input.unit,
      purchasePrice: input.purchasePrice,
      salePrice: input.salePrice,
      etiket: canonicalLabel.labelName,
      tagId: canonicalLabel.labelId,
      selectedTagId: canonicalLabel.labelId,
      placementPriority: input.placementPriority,
      averageDesi: input.averageDesi,
      criticalStock: input.criticalStock ?? settings.defaultCritical,
      maxShelfStock: resolvedShelfCapacity,
      maxStock: resolvedDepotCapacity,
      unitsPerCase: logistics.unitsPerCase,
      casesPerPallet: logistics.casesPerPallet,
      unitsPerPallet: logistics.unitsPerPallet,
      minimumOrderCaseQty: input.minimumOrderCaseQty ?? 1,
      depotAssignmentType: capacityProfile.assignmentType,
      depotLocationCode: depotAssignment.depotLocationCode,
      depotZoneCode: depotAssignment.depotZoneCode,
      isVirtualLocation: depotAssignment.isVirtualLocation,
      capacityMode: capacityProfile.capacityMode,
      needsReview: capacityProfile.needsReview,
      stockingStrategy: depotAssignment.stockingStrategy,
      assignmentPriority: depotAssignment.assignmentPriority,
      depotLocationLabel: depotAssignment.depotLocationLabel,
      defaultWarehouseLocationCode: depotAssignment.depotLocationCode,
      alternativeWarehouseLocationCodes: [],
      payload: {
        labelId: canonicalLabel.labelId,
        labelCode: canonicalLabel.labelCode,
        labelDisplayCode: canonicalLabel.labelDisplayCode,
        labelSlug: canonicalLabel.labelSlug,
        legacyLabelCodes: canonicalLabel.legacyCodes || [],
      },
      catalogVisibility: input.catalogVisibility || 'listed',
      registerOnOrder: input.registerOnOrder === true,
      isListed: input.isListed !== false,
      orderActivatedStatus: input.isListed === false ? 'pending' : 'active',
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
      priceUpdatedAt: now,
    };

    await productRepo.create(product);
    await stockRepo.upsert(product.id, { warehouseQuantity: 0, shelfQuantity: 0 });
    return enrichProduct(product);
  },

  async update(id, payload) {
    validateProductPayload(payload, { partial: true });

    const existing = await productRepo.findById(id);
    if (!existing) {
      throw createNotFoundError('Ürün bulunamadı');
    }

    if (payload?.rejectDraft === true) {
      const existingPayload = existing.payload && typeof existing.payload === 'object' ? existing.payload : {};
      if (existing.isListed === true || existing.isActive === true) {
        throw new AppError(400, 'Aktif veya satışta olan ürünler taslak reddetme akışından reddedilemez.');
      }
      if (!isRejectableCatalogDraftProduct(existing)) {
        throw new AppError(400, 'Bu kayıt katalog taslağı olarak doğrulanamadığı için reddedilemedi.');
      }
      const now = new Date().toISOString();
      const rejected = {
        ...existing,
        status: 'rejected',
        defaultStatus: 'rejected',
        isListed: false,
        isActive: false,
        registerOnOrder: false,
        catalogVisibility: 'rejected',
        orderActivatedStatus: 'rejected',
        payload: {
          ...existingPayload,
          catalogVisibility: 'rejected',
          completionStatus: 'rejected',
          rejectedAt: now,
          rejectedReason: payload.rejectedReason || payload.decisionNote || existingPayload.rejectedReason || '',
          rejectedFrom: 'products_draft_filter',
        },
        updatedAt: now,
      };
      await productRepo.updateById(id, rejected);
      return enrichProduct(rejected);
    }

    const input = sanitizeProductInput({ ...existing, ...payload });
    const relations = await ensureRelations(input);

    const sameSkuProduct = await productRepo.findBySku(input.sku);
    if (sameSkuProduct && sameSkuProduct.id !== id) {
      throw new AppError(409, 'SKU zaten mevcut');
    }

    const sameBarcodeProduct = await productRepo.findByBarcode(input.barcode);
    if (sameBarcodeProduct && sameBarcodeProduct.id !== id) {
      throw new AppError(409, 'Barkod zaten mevcut');
    }

    const shelfCode = await buildShelfCode(input);
    const canonicalLabel = await resolveCanonicalLabel({ input, categoryName: relations.category?.name || '' });
    const logistics = resolveProductLogistics(input, existing);
    const updatedRequiredStorageType = resolveRequiredStorageType(relations.category, input.requiredStorageType || existing.requiredStorageType);
    const updatedDepotAssignment = resolveRequestedDepotAssignment({
      input,
      storageType: updatedRequiredStorageType,
      isListed: input.isListed ?? existing.isListed ?? true,
      warehouseQuantity: 0,
      shelfQuantity: 0,
    });
    const updatedCapacityProfile = deriveCapacityProfile({
      assignmentType: updatedDepotAssignment.depotAssignmentType,
      capacityMode: updatedDepotAssignment.capacityMode,
      depotCapacity: Number(input.maxStock ?? existing.maxStock ?? 0),
    });

    const salePriceChanged = input.salePrice !== undefined && !pricesEqual(input.salePrice, existing.salePrice);
    const priceEvent = salePriceChanged
      ? buildPriceEvent({
        productId: id,
        previousSalePrice: existing.salePrice,
        salePrice: input.salePrice,
        source: 'product_update',
      })
      : null;
    let priceUpdatedAt = existing.priceUpdatedAt;
    if (priceEvent) {
      priceUpdatedAt = priceEvent.at;
    }
    const existingPayload = existing.payload && typeof existing.payload === 'object' ? existing.payload : {};
    const existingPriceHistory = Array.isArray(existing.priceHistory)
      ? existing.priceHistory
      : (Array.isArray(existingPayload.priceHistory) ? existingPayload.priceHistory : []);
    const hasDepotLocationPayload = Array.isArray(payload.depotLocations);
    const preservedDepotLocations = hasDepotLocationPayload
      ? payload.depotLocations
      : (Array.isArray(existing.depotLocations) ? existing.depotLocations : existingPayload.depotLocations);
    const updated = {
      ...existing,
      sku: input.sku,
      barcode: input.barcode,
      name: input.name,
      brand: normalizeBrandName(input.brand || existing.brand || ''),
      categoryId: input.categoryId,
      supplierId: input.supplierId,
      sectionId: input.sectionId,
      shelfSide: input.shelfSide,
      shelfNo: input.shelfNo,
      shelfLevel: input.shelfLevel,
      requiredStorageType: updatedRequiredStorageType,
      shelfCode,
      unit: input.unit,
      purchasePrice: input.purchasePrice,
      salePrice: input.salePrice,
      etiket: canonicalLabel.labelName,
      tagId: canonicalLabel.labelId,
      selectedTagId: canonicalLabel.labelId,
      payload: {
        ...existingPayload,
        labelId: canonicalLabel.labelId,
        labelCode: canonicalLabel.labelCode,
        labelDisplayCode: canonicalLabel.labelDisplayCode,
        labelSlug: canonicalLabel.labelSlug,
        legacyLabelCodes: canonicalLabel.legacyCodes || [],
        ...((input.isListed === true && input.isActive === true) ? {
          completionStatus: 'complete',
          missingFields: [],
          catalogVisibility: input.catalogVisibility || 'published',
        } : {}),
        ...(Array.isArray(preservedDepotLocations) ? { depotLocations: preservedDepotLocations } : {}),
        ...(priceEvent ? { priceHistory: [...existingPriceHistory, priceEvent] } : {}),
      },
      depotAssignmentType: updatedCapacityProfile.assignmentType,
      depotLocationCode: updatedDepotAssignment.depotLocationCode,
      depotZoneCode: updatedDepotAssignment.depotZoneCode,
      isVirtualLocation: updatedDepotAssignment.isVirtualLocation,
      capacityMode: updatedCapacityProfile.capacityMode,
      needsReview: updatedCapacityProfile.needsReview,
      stockingStrategy: updatedDepotAssignment.stockingStrategy,
      assignmentPriority: updatedDepotAssignment.assignmentPriority,
      depotLocationLabel: updatedDepotAssignment.depotLocationLabel,
      defaultWarehouseLocationCode: updatedDepotAssignment.depotLocationCode,
      placementPriority: input.placementPriority || existing.placementPriority || '',
      averageDesi: input.averageDesi ?? existing.averageDesi,
      criticalStock: input.criticalStock ?? existing.criticalStock,
      maxShelfStock: deriveShelfCapacity({
        shelfCapacity: Number(input.maxShelfStock ?? existing.maxShelfStock ?? 0),
        criticalStock: Number(input.criticalStock ?? existing.criticalStock ?? 0),
        unitsPerCase: Number(logistics.unitsPerCase ?? existing.unitsPerCase ?? 24),
        averageDesi: Number(input.averageDesi ?? existing.averageDesi ?? 0),
      }),
      maxStock: deriveDepotCapacity({
        depotCapacity: Number(input.maxStock ?? existing.maxStock ?? 0),
        shelfCapacity: deriveShelfCapacity({
          shelfCapacity: Number(input.maxShelfStock ?? existing.maxShelfStock ?? 0),
          criticalStock: Number(input.criticalStock ?? existing.criticalStock ?? 0),
          unitsPerCase: Number(logistics.unitsPerCase ?? existing.unitsPerCase ?? 24),
          averageDesi: Number(input.averageDesi ?? existing.averageDesi ?? 0),
        }),
      }),
      unitsPerCase: logistics.unitsPerCase,
      casesPerPallet: logistics.casesPerPallet,
      unitsPerPallet: logistics.unitsPerPallet,
      minimumOrderCaseQty: input.minimumOrderCaseQty ?? existing.minimumOrderCaseQty ?? 1,
      catalogVisibility: input.catalogVisibility || existing.catalogVisibility || (input.isListed === false ? 'catalog_only' : 'listed'),
      registerOnOrder: input.registerOnOrder ?? existing.registerOnOrder ?? false,
      isListed: input.isListed ?? existing.isListed ?? true,
      orderActivatedStatus: input.orderActivatedStatus || existing.orderActivatedStatus || ((input.isListed ?? existing.isListed ?? true) ? 'active' : 'pending'),
      isActive: input.isActive,
      updatedAt: new Date().toISOString(),
      priceUpdatedAt,
      lastPriceChangeDate: priceEvent ? dateOnlyFromIso(priceEvent.at) : (existing.lastPriceChangeDate || null),
      lastPriceChangeAt: priceEvent ? priceEvent.at : (existing.lastPriceChangeAt || null),
      lastPriceChangeSource: priceEvent ? priceEvent.source : (existing.lastPriceChangeSource || null),
      ...(Array.isArray(preservedDepotLocations) ? { depotLocations: preservedDepotLocations } : {}),
      ...(priceEvent ? { priceHistory: [...existingPriceHistory, priceEvent] } : {}),
    };

    await productRepo.updateById(id, updated);
    if (priceEvent && config.dataStore === 'postgres') {
      const prisma = await getPrisma();
      await prisma.productPriceEvent.create({
        data: {
          id: priceEvent.id,
          productId: id,
          previousSalePrice: priceEvent.previousSalePrice,
          salePrice: priceEvent.salePrice,
          source: priceEvent.source,
          payload: {
            priceEventId: priceEvent.id,
            productId: id,
            eventDate: priceEvent.eventDate,
            previousPrice: priceEvent.previousPrice,
            newPrice: priceEvent.newPrice,
            changeDirection: priceEvent.changeDirection,
            changePercent: priceEvent.changePercent,
            currency: priceEvent.currency,
            source: priceEvent.source,
            isSyntheticHistory: false,
          },
          createdAt: priceEvent.at,
        },
      });
    }
    return enrichProduct(updated);
  },

  async remove(id) {
    const existing = await productRepo.findById(id);
    if (!existing) {
      throw createNotFoundError('Ürün bulunamadı');
    }

    const movements = await movementRepo.getAll();
    if (movements.some((movement) => movement.productId === id)) {
      throw new AppError(400, 'Hareket kaydı bulunan ürün silinemez');
    }

    await productRepo.deleteById(id);
    await stockRepo.deleteByProductId(id);
    return existing;
  },

  async findByBarcode(barcode, options = {}) {
    if (config.dataStore === 'postgres') {
      const productId = await withPostgresQueryLogging(
        'GET /api/products/barcode/:barcode lookup',
        () => findPostgresProductIdByBarcode(barcode)
      );
      if (!productId) {
        throw createNotFoundError('Barkod ile eşleşen ürün bulunamadı');
      }
      const product = await productService.getById(productId, options);
      if (!matchesProductUniverse(product, options.universe || 'listed_active', { includeUnlisted: options.includeUnlisted === true })) {
        throw createNotFoundError('Barkod ile eşleşen aktif ürün bulunamadı');
      }
      return product;
    }

    let product = await productRepo.findByBarcode(barcode);
    if (!product) {
      const candidates = new Set(getBarcodeCandidates(barcode));
      const supplierProducts = await supplierProductRepo.getAll();
      const supplierProduct = supplierProducts.find((row) =>
        row?.productId
        && row.isActive !== false
        && getSupplierProductBarcodeCandidates(row).some((candidate) => candidates.has(candidate))
      );
      product = supplierProduct?.productId ? await productRepo.findById(supplierProduct.productId) : null;
    }

    if (!product) {
      throw createNotFoundError('Barkod ile eşleşen ürün bulunamadı');
    }
    if (!matchesProductUniverse(product, options.universe || 'listed_active', { includeUnlisted: options.includeUnlisted === true })) {
      throw createNotFoundError('Barkod ile eşleşen aktif ürün bulunamadı');
    }
    const activeCampaigns = await listActiveCampaignDefinitions();
    return enrichProduct(product, activeCampaigns, {
      includeGeneralCampaigns: options.includeGeneralCampaigns !== false,
    });
  },
};
