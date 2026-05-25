import { v4 as uuidv4 } from 'uuid';
import { movementRepo } from '../repositories/movementRepository.js';
import { categoryRepo } from '../repositories/categoryRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { stockRepo } from '../repositories/stockRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { warehouseLocationRepo } from '../repositories/warehouseLocationRepository.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import {
  includesSearchText,
  sanitizeMovementInput,
  validateStockMovementPayload,
  validateStockTransferPayload,
} from '../utils/validators.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';
import { decodeCursor, encodeCursor, parseBooleanQuery, parseLimit, parsePagePagination, resolvePaginationMode, resolveWhitelistedSort } from '../utils/pagination.js';
import { formatMovementRouteLabel, formatStockLocationLabel, formatStorageTypeLabel } from '../utils/displayLabels.js';
import { deriveShelfStockAlert, isActiveRetailProduct } from '../utils/retailStockPolicy.js';
import { createPublicBatchNo, isLegacyGeneratedBatchNo } from '../utils/batchNumber.js';
import { enrichBatchExpiryState, summarizeBatchAvailability } from '../utils/batchExpiry.js';
import { resolveSktPolicy, SKT_POLICIES } from '../utils/sktPolicy.js';
import { clearPricingAnalysisCache } from './analysis/pricingAnalysisService.js';
import { validateStockBatchSummaryIntegrity } from './dataIntegrityService.js';

const sortByNewest = (items) => [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

const buildReferenceNo = () => `REF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

const fromDateValue = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

const REASON_LABELS = {
  product_purchase: 'Ürün Satın Alımı',
  customer_return: 'Müşteri İadesi',
  manual_adjustment: 'Manuel Düzeltme',
  transfer_in: 'Transfer Girişi',
  transfer_out: 'Transfer Çıkışı',
  transfer_to_shelf: 'Depodan Reyona Transfer',
  transfer_to_warehouse: 'Reyondan Depoya Transfer',
  count_surplus: 'Manuel Düzeltme',
  count_deficit: 'Manuel Düzeltme',
  pos_sale: 'Satış (POS İşlemi)',
  supplier_return: 'Tedarikçiye İade',
  write_off: 'İmha',
};

const normalizeDisplayText = (value) => {
  if (typeof value !== 'string') return value;
  return value
    .replace(/Sat\?\? \(POS \?\?lemi\)/g, 'Satış (POS İşlemi)')
    .replace(/Sat\?n alma \/ mal kabul/g, 'Satın alma / mal kabul')
    .replace(/M\?\?teri \?adesi/g, 'Müşteri İadesi')
    .normalize('NFC');
};

const LOCATION_LABELS = {
  depo: 'Depo',
  reyon: 'Reyon',
  pos: 'Müşteri / POS',
};

const normalizeLocation = (value, fallback = 'depo') => (value === 'reyon' ? 'reyon' : value === 'depo' ? 'depo' : fallback);

const getStockByLocation = (stock, location) => (location === 'reyon' ? stock.shelfQuantity || 0 : stock.warehouseQuantity || 0);

const updateStockByLocation = (stock, location, quantity) => {
  if (location === 'reyon') {
    return {
      warehouseQuantity: stock.warehouseQuantity || 0,
      shelfQuantity: quantity,
    };
  }

  return {
    warehouseQuantity: quantity,
    shelfQuantity: stock.shelfQuantity || 0,
  };
};

const inferReasonCode = (movement) => {
  if (movement.reasonCode) return movement.reasonCode;
  if (movement.type === 'TRANSFER') {
    if (movement.fromLocation === 'depo' && movement.toLocation === 'reyon') return 'transfer_to_shelf';
    if (movement.fromLocation === 'reyon' && movement.toLocation === 'depo') return 'transfer_to_warehouse';
  }
  const note = String(movement.note || '').toLowerCase();
  if (note.includes('pos satış')) return 'pos_sale';
  if (note.includes('pos iade')) return 'customer_return';
  if (note.includes('zayi') || note.includes('imha')) return 'write_off';
  if (note.includes('transfer')) return movement.type === 'IN' ? 'transfer_in' : 'transfer_out';
  if (note.includes('sayım')) return movement.type === 'IN' ? 'count_surplus' : 'count_deficit';
  if (movement.type === 'ADJUSTMENT') return 'manual_adjustment';
  if (movement.type === 'IN') return 'product_purchase';
  return 'manual_adjustment';
};

const enrichReason = (movement) => {
  const reasonCode = inferReasonCode(movement);
  const reasonLabel = normalizeDisplayText(movement.reasonLabel) || REASON_LABELS[reasonCode] || 'Bilinmiyor';
  const fromLocationLabel = normalizeDisplayText(movement.fromLocationLabel)
    || formatStockLocationLabel(movement.fromLocation, '');
  const toLocationLabel = normalizeDisplayText(movement.toLocationLabel)
    || formatStockLocationLabel(movement.toLocation, '');
  const locationLabel = normalizeDisplayText(movement.locationLabel)
    || formatStockLocationLabel(movement.location || movement.toLocation || movement.fromLocation, '');
  return {
    ...movement,
    reasonCode,
    reasonLabel,
    reason: reasonLabel,
    fromLocationLabel,
    toLocationLabel,
    locationLabel,
    routeLabel: formatMovementRouteLabel({
      ...movement,
      reasonCode,
      fromLocationLabel,
      toLocationLabel,
      locationLabel,
    }),
    location: movement.location || (movement.toLocation ? movement.toLocation : movement.fromLocation) || 'depo',
  };
};

const triggerTransferAutomationAfterShelfChange = async ({ productId, source }) => {
  try {
    const { sectionService } = await import('./sectionService.js');
    await sectionService.runTransferAutomationScan({
      source,
      productId,
    });
  } catch (error) {
    console.error('[transfer-automation:stock-hook] scan failed', {
      productId,
      source,
      message: error.message || String(error),
    });
  }
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

const resolveMaxShelfStock = (product, totalStock = 0) => {
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

const parseBatchNoFromMovementNote = (note) => {
  const raw = String(note || '');
  const match = raw.match(/Parti\s*No\s*:\s*([^|]+)/i);
  return match ? String(match[1]).trim() : '';
};

const resolveRequiredStorageType = (category) => {
  if (category?.requiresFreezer) return 'freezer';
  if (category?.requiresColdChain) return 'cold_chain';
  return 'Ortam';
};

const mapStockProductRow = (product, options = {}) => {
  const includeBatches = options.includeBatches === true;
  const stock = product.stock || {};
  const reserved = Number(stock.reserved || 0);
  const batches = Array.isArray(stock.batches)
    ? stock.batches.map((batch) => enrichBatchExpiryState({
      id: batch.id,
      batchNo: batch.batchNo,
      skt: batch.skt || '',
      warehouseQuantity: Number(batch.warehouseQuantity || 0),
      shelfQuantity: Number(batch.shelfQuantity || 0),
      totalQuantity: Number(batch.totalQuantity || 0),
      status: batch.status || '',
    }))
    : [];
  const batchAvailability = summarizeBatchAvailability(batches, { reserved });
  const warehouseStock = batches.length
    ? batches.reduce((sum, batch) => sum + Number(batch.warehouseQuantity || 0), 0)
    : Number(stock.warehouseQuantity || 0);
  const shelfStock = batches.length
    ? batches.reduce((sum, batch) => sum + Number(batch.shelfQuantity || 0), 0)
    : Number(stock.shelfQuantity || 0);
  const quantity = warehouseStock + shelfStock;
  const sellableStock = batches.length ? batchAvailability.sellableQuantity : quantity;
  const available = batches.length ? batchAvailability.available : Number(stock.available ?? quantity);
  const activeBatchCount = batches.filter((item) => Number(item?.totalQuantity || 0) > 0 && item.isExpired !== true).length;
  const expiredBatchCount = batches.filter((item) => Number(item?.totalQuantity || 0) > 0 && item.isExpired === true).length;
  const fefoBatch = batches.find((item) => item.isExpired !== true && String(item.batchNo || '') === String(stock.fefoDefaultBatchNo || ''))
    || [...batches]
      .filter((item) => item.isExpired !== true && Number(item?.totalQuantity || 0) > 0 && item?.skt)
      .sort((left, right) => String(left.skt || '').localeCompare(String(right.skt || '')))[0]
    || null;
  const maxShelfStock = resolveMaxShelfStock(product, quantity);
  if (batches.length > 0) {
    validateStockBatchSummaryIntegrity({
      productId: product.id,
      warehouseQuantity: stock.warehouseQuantity || 0,
      shelfQuantity: stock.shelfQuantity || 0,
      batches,
    }, { product });
  }

  return {
    productId: product.id,
    sku: product.sku,
    barcode: product.barcode || '',
    productName: product.name,
    name: product.name,
    categoryId: product.categoryId || null,
    categoryCode: product.category?.code || '',
    categoryName: product.category?.name || '',
    etiket: product.etiket || '',
    unit: product.unit,
    isActive: product.isActive,
    status: product.isActive ? 'active' : 'inactive',
    storageType: product.requiredStorageType || 'Ortam',
    storageTypeLabel: formatStorageTypeLabel(product.requiredStorageType || 'Ortam'),
    warehouseStock,
    shelfStock,
    totalStock: quantity,
    quantity,
    onHand: Number(stock.onHand ?? quantity),
    physicalStock: quantity,
    sellableStock,
    expiredStock: batchAvailability.expiredQuantity,
    available,
    reserved,
    criticalStock: product.criticalStock,
    maxShelfStock,
    nearestExpiry: fefoBatch?.skt || null,
    batchCount: batches.length ? activeBatchCount : Number(stock.batchCount || 0),
    expiredBatchCount,
    fefoBatch: fefoBatch
      ? {
        batchNo: fefoBatch.batchNo || null,
        skt: fefoBatch.skt || null,
        totalQuantity: Number(fefoBatch.totalQuantity || 0),
        warehouseQuantity: Number(fefoBatch.warehouseQuantity || 0),
        shelfQuantity: Number(fefoBatch.shelfQuantity || 0),
      }
      : null,
    ...(includeBatches ? {
      batches,
      productBatches: batches,
    } : {}),
    fefoDefaults: {
      defaultBatchNo: fefoBatch?.batchNo || null,
      defaultExpiry: fefoBatch?.skt || null,
    },
    stockSummary: {
      warehouseStock,
      shelfStock,
      totalStock: quantity,
      onHand: Number(stock.onHand ?? quantity),
      physicalStock: quantity,
      sellableStock,
      expiredStock: batchAvailability.expiredQuantity,
      available,
      reserved,
      batchCount: batches.length ? activeBatchCount : Number(stock.batchCount || 0),
      expiredBatchCount,
      nearestExpiry: fefoBatch?.skt || null,
    },
    isCritical: deriveShelfStockAlert({ product, shelfQuantity: shelfStock, totalQuantity: quantity }) === 'critical',
    updatedAt: fromDateValue(stock.updatedAt) || fromDateValue(product.updatedAt),
    sktPolicy: resolveSktPolicy({ product, category: product.category || null }),
  };
};

const getStocksFromPostgres = async (query = {}) => {
  const prisma = await getPrisma();
  const mode = resolvePaginationMode(query.paginationMode || query.mode);
  const sort = resolveWhitelistedSort(query.sort, ['name_asc'], 'name_asc', { context: 'GET /api/stock' });
  const includeTotal = parseBooleanQuery(query.includeTotal, true);
  if (mode === 'cursor' && sort !== 'name_asc') {
    throw new AppError(400, 'cursor pagination only supports name_asc sort for stock');
  }
  const limit = mode === 'cursor'
    ? parseLimit(query.limit, { defaultLimit: 100, maxLimit: 250 })
    : parsePagePagination(query, { defaultLimit: 100, maxLimit: 250 }).limit;
  const offsetPagination = mode === 'offset'
    ? parsePagePagination(query, { defaultLimit: 100, maxLimit: 250 })
    : null;
  const cursor = decodeCursor(query.cursor, { expectedSort: sort });
  const search = String(query.search || query.q || '').trim();
  const includeBatches = parseBooleanQuery(query.includeBatches, false);
  const where = {};
  if (query.categoryId) where.categoryId = String(query.categoryId);
  if (query.listed !== undefined && query.listed !== '') {
    where.isListed = parseBooleanQuery(query.listed, true);
  } else if (query.includeUnlisted !== 'true') {
    where.isListed = { not: false };
  }
  if (query.status === 'inactive') where.isActive = false;
  else where.isActive = { not: false };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
    ];
  }
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
  const take = mode === 'cursor' ? limit + 1 : limit;
  const skip = offsetPagination?.skip || 0;

  const [total, rowsRaw] = await withPostgresQueryLogging('GET /api/stock', () => Promise.all([
    includeTotal ? prisma.product.count({ where }) : Promise.resolve(null),
    prisma.product.findMany({
      where: effectiveWhere,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: mode === 'offset' ? skip : 0,
      take,
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        categoryId: true,
        etiket: true,
        unit: true,
        isActive: true,
        isListed: true,
        requiredStorageType: true,
        criticalStock: true,
        maxShelfStock: true,
        maxStock: true,
        unitsPerCase: true,
        averageDesi: true,
        updatedAt: true,
        category: { select: { id: true, name: true, code: true } },
        stock: {
          select: {
            warehouseQuantity: true,
            shelfQuantity: true,
            onHand: true,
            available: true,
            reserved: true,
            nearestExpiry: true,
            fefoDefaultBatchNo: true,
            fefoDefaultExpiry: true,
            batchCount: true,
            updatedAt: true,
            batches: includeBatches ? {
              select: {
                id: true,
                batchNo: true,
                skt: true,
                warehouseQuantity: true,
                shelfQuantity: true,
                totalQuantity: true,
                status: true,
              },
            } : false,
          },
        },
      },
    }),
  ]));
  const hasNextPage = mode === 'cursor' ? rowsRaw.length > limit : (skip + rowsRaw.length) < (total ?? Number.POSITIVE_INFINITY);
  const rows = mode === 'cursor' ? rowsRaw.slice(0, limit) : rowsRaw;
  const last = rows[rows.length - 1];
  const nextCursor = mode === 'cursor' && hasNextPage && last
    ? encodeCursor({ name: last.name, id: last.id }, { sort })
    : null;

  return {
    items: rows.map((row) => mapStockProductRow(row, { includeBatches })),
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
      search: search || null,
      includeBatches,
      categoryId: query.categoryId || null,
      listed: query.listed ?? null,
      status: query.status || null,
    },
    sort: {
      fields: ['name', 'id'],
      direction: 'asc',
      key: sort,
    },
  };
};

const toSafeInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

const normalizeBatchNo = (value) => String(value || '').trim();

const normalizeDateOnly = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const DEFAULT_MOVEMENT_WINDOW_DAYS = 90;

const normalizeMovementQuery = (query = {}) => {
  const endDate = normalizeDateOnly(query.endDate) || new Date().toISOString().slice(0, 10);
  const startDate = normalizeDateOnly(query.startDate)
    || new Date(new Date(`${endDate}T00:00:00`).getTime() - (DEFAULT_MOVEMENT_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    ...query,
    startDate,
    endDate,
    type: query.type ? String(query.type).toUpperCase() : '',
    search: String(query.search || query.q || '').trim(),
  };
};

const filterMovements = (movements = [], query = {}) => {
  const normalized = normalizeMovementQuery(query);
  return movements.filter((movement) => {
    const matchesProduct = !normalized.productId || movement.productId === normalized.productId;
    const matchesType = !normalized.type || movement.type === normalized.type;
    const locationFilter = String(normalized.location || '').trim().toLowerCase();
    const matchesLocation =
      !locationFilter ||
      movement.location === locationFilter ||
      movement.fromLocation === locationFilter ||
      movement.toLocation === locationFilter;
    const matchesReference = !normalized.referenceNo || includesSearchText(movement.referenceNo, normalized.referenceNo);
    const matchesUser = !normalized.userId || movement.userId === normalized.userId;
    const matchesSearch =
      !normalized.search ||
      [movement.productName, movement.sku, movement.note, movement.referenceNo, movement.userName, movement.reasonLabel, movement.reasonCode, movement.location, movement.fromLocation, movement.toLocation]
        .filter(Boolean)
        .some((value) => includesSearchText(value, normalized.search));
    const createdAt = new Date(movement.createdAt);
    const matchesStartDate = !normalized.startDate || createdAt >= new Date(`${normalized.startDate}T00:00:00`);
    const matchesEndDate = !normalized.endDate || createdAt <= new Date(`${normalized.endDate}T23:59:59`);

    return matchesProduct && matchesType && matchesLocation && matchesReference && matchesUser && matchesSearch && matchesStartDate && matchesEndDate;
  });
};

const mapMovementFromPostgres = (row = {}) => ({
  id: row.id,
  productId: row.productId || null,
  supplierId: row.supplierId || null,
  productName: row.productName || '',
  sku: row.sku || '',
  type: row.type || '',
  qty: Number(row.qty || 0),
  previousQuantity: Number(row.previousQuantity || 0),
  nextQuantity: Number(row.nextQuantity || 0),
  previousTotalQuantity: Number(row.previousTotalQuantity || 0),
  nextTotalQuantity: Number(row.nextTotalQuantity || 0),
  location: row.location || '',
  fromLocation: row.fromLocation || '',
  toLocation: row.toLocation || '',
  reasonCode: row.reasonCode || '',
  reasonLabel: row.reasonLabel || '',
  referenceNo: row.referenceNo || '',
  transferRequestId: row.transferRequestId || null,
  userId: row.userId || null,
  userName: row.userName || '',
  batchNo: row.batchNo || '',
  skt: row.skt || '',
  createdAt: fromDateValue(row.createdAt),
  updatedAt: fromDateValue(row.updatedAt),
});

const buildMovementWhere = (query = {}) => {
  const normalized = normalizeMovementQuery(query);
  const where = {};

  if (normalized.productId) where.productId = String(normalized.productId);
  if (normalized.type) where.type = normalized.type;
  if (normalized.referenceNo) where.referenceNo = { contains: String(normalized.referenceNo), mode: 'insensitive' };
  if (normalized.userId) where.userId = String(normalized.userId);
  if (normalized.startDate || normalized.endDate) {
    where.createdAt = {};
    if (normalized.startDate) where.createdAt.gte = new Date(`${normalized.startDate}T00:00:00`);
    if (normalized.endDate) where.createdAt.lte = new Date(`${normalized.endDate}T23:59:59.999`);
  }
  if (normalized.location) {
    const location = String(normalized.location).trim().toLowerCase();
    where.OR = [
      { location },
      { fromLocation: location },
      { toLocation: location },
    ];
  }
  if (normalized.search) {
    const search = normalized.search;
    const searchOr = [
      { productName: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { referenceNo: { contains: search, mode: 'insensitive' } },
      { userName: { contains: search, mode: 'insensitive' } },
      { reasonLabel: { contains: search, mode: 'insensitive' } },
      { reasonCode: { contains: search, mode: 'insensitive' } },
      { location: { contains: search, mode: 'insensitive' } },
      { fromLocation: { contains: search, mode: 'insensitive' } },
      { toLocation: { contains: search, mode: 'insensitive' } },
    ];
    where.AND = [...(where.AND || []), { OR: searchOr }];
  }

  return { where, normalized };
};

const mapExpiredBatchWarningRow = (row = {}, today = new Date()) => {
  const product = row.stock?.product || {};
  const skt = normalizeDateOnly(row.skt);
  const todayDate = normalizeDateOnly(today);
  const daysExpired = skt
    ? Math.max(0, Math.floor((Date.parse(`${todayDate}T00:00:00.000Z`) - Date.parse(`${skt}T00:00:00.000Z`)) / (24 * 60 * 60 * 1000)))
    : 0;
  const warehouseQuantity = toSafeInteger(row.warehouseQuantity);
  const shelfQuantity = toSafeInteger(row.shelfQuantity);
  const totalQuantity = warehouseQuantity + shelfQuantity;

  return {
    id: row.id,
    productId: row.productId,
    productName: product.name || '',
    sku: product.sku || '',
    barcode: product.barcode || '',
    batchNo: normalizeBatchNo(row.batchNo),
    skt,
    warehouseQuantity,
    shelfQuantity,
    totalQuantity,
    riskStatus: daysExpired > 30 ? 'Acil imha' : 'SKT geçmiş',
    daysExpired,
  };
};

const listExpiredBatchWarningsFromPostgres = async (query = {}) => {
  const prisma = await getPrisma();
  const today = normalizeDateOnly(query.today || new Date());
  const pagination = parsePagePagination(query, { defaultLimit: 200, maxLimit: 1000 });
  const where = {
    skt: { lt: today },
    OR: [
      { totalQuantity: { gt: 0 } },
      { warehouseQuantity: { gt: 0 } },
      { shelfQuantity: { gt: 0 } },
    ],
    stock: {
      product: {
        isActive: { not: false },
        isListed: { not: false },
      },
    },
  };

  const [total, rows] = await withPostgresQueryLogging('GET /api/stock/expired-batches', () => Promise.all([
    prisma.stockBatch.count({ where }),
    prisma.stockBatch.findMany({
      where,
      orderBy: [{ skt: 'asc' }, { batchNo: 'asc' }, { id: 'asc' }],
      skip: pagination.skip,
      take: pagination.limit,
      include: {
        stock: {
          select: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                barcode: true,
              },
            },
          },
        },
      },
    }),
  ]));

  const items = rows.map((row) => mapExpiredBatchWarningRow(row, today));
  return {
    items,
    pagination: {
      mode: 'offset',
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
      hasNextPage: pagination.skip + items.length < total,
      nextCursor: null,
      cursorVersion: null,
    },
    filters: { today },
  };
};

const listMovementsFromPostgres = async (query = {}) => {
  const prisma = await getPrisma();
  const { where, normalized } = buildMovementWhere(query);
  const pagination = parsePagePagination(normalized, { defaultLimit: 50, maxLimit: 500 });
  const [total, rows] = await withPostgresQueryLogging('GET /api/stock/movements', () => Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: pagination.skip,
      take: pagination.limit,
      select: {
        id: true,
        productId: true,
        supplierId: true,
        productName: true,
        sku: true,
        type: true,
        qty: true,
        previousQuantity: true,
        nextQuantity: true,
        previousTotalQuantity: true,
        nextTotalQuantity: true,
        location: true,
        fromLocation: true,
        toLocation: true,
        reasonCode: true,
        reasonLabel: true,
        referenceNo: true,
        transferRequestId: true,
        userId: true,
        userName: true,
        batchNo: true,
        skt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]));
  const items = rows.map(mapMovementFromPostgres).map(enrichReason);

  return {
    items,
    pagination: {
      mode: 'offset',
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
      hasNextPage: pagination.skip + items.length < total,
      nextCursor: null,
      cursorVersion: null,
    },
    filters: {
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      type: normalized.type || null,
      productId: normalized.productId || null,
      search: normalized.search || null,
    },
    sort: { key: 'createdAt_desc', direction: 'desc' },
  };
};

const movementSummaryFromPostgres = async (query = {}) => {
  const prisma = await getPrisma();
  const { where, normalized } = buildMovementWhere(query);
  const grouped = await prisma.stockMovement.groupBy({
    by: ['type'],
    where,
    _count: { _all: true },
  });
  const byType = grouped.reduce((acc, row) => {
    const type = row.type || 'UNKNOWN';
    acc[type] = Number(row._count?._all || 0);
    return acc;
  }, {});
  return {
    totalCount: Object.values(byType).reduce((sum, value) => sum + Number(value || 0), 0),
    byType,
    filters: {
      startDate: normalized.startDate,
      endDate: normalized.endDate,
      type: normalized.type || null,
      productId: normalized.productId || null,
      search: normalized.search || null,
    },
  };
};

const resolveBatchLocationField = (location) => (location === 'reyon' ? 'shelfQuantity' : 'warehouseQuantity');

const cloneBatches = (batches) => {
  if (!Array.isArray(batches)) return [];

  return batches.map((batch) => {
    const warehouseQuantity = toSafeInteger(batch?.warehouseQuantity);
    const shelfQuantity = toSafeInteger(batch?.shelfQuantity);
    const totalQuantity = warehouseQuantity + shelfQuantity;

    return {
      ...batch,
      id: String(batch?.id || uuidv4()),
      batchNo: normalizeBatchNo(batch?.batchNo),
      skt: normalizeDateOnly(batch?.skt),
      warehouseQuantity,
      shelfQuantity,
      totalQuantity,
      status: totalQuantity > 0 ? 'Aktif' : 'Tukendi',
    };
  });
};

const buildStockPayloadFromBatches = (batches) => {
  const safeBatches = cloneBatches(batches);
  const warehouseQuantity = safeBatches.reduce((sum, item) => sum + toSafeInteger(item.warehouseQuantity), 0);
  const shelfQuantity = safeBatches.reduce((sum, item) => sum + toSafeInteger(item.shelfQuantity), 0);
  const fefoBatch = [...safeBatches]
    .filter((item) => toSafeInteger(item.totalQuantity) > 0 && normalizeDateOnly(item.skt))
    .sort((left, right) => normalizeDateOnly(left.skt).localeCompare(normalizeDateOnly(right.skt)) || normalizeBatchNo(left.batchNo).localeCompare(normalizeBatchNo(right.batchNo), 'tr'))[0] || null;

  return {
    warehouseQuantity,
    shelfQuantity,
    quantity: warehouseQuantity + shelfQuantity,
    batches: safeBatches,
    batchCount: safeBatches.filter((item) => toSafeInteger(item.totalQuantity) > 0).length,
    nearestExpiry: fefoBatch?.skt || null,
    fefoDefaultBatchNo: fefoBatch?.batchNo || null,
    fefoDefaultExpiry: fefoBatch?.skt || null,
  };
};

const resolveGeneratedBatchNo = ({ product, type = 'IN' } = {}) => {
  return createPublicBatchNo({
    brand: product?.brand,
    productName: product?.name,
    seed: `${product?.id || product?.sku || 'batch'}|${type}|${uuidv4()}`,
    sequence: '01',
  });
};

const resolveInboundBatchNo = (input, type = 'IN', product = null) => {
  const explicit = normalizeBatchNo(input?.batchNo);
  if (explicit && !isLegacyGeneratedBatchNo(explicit)) {
    return explicit;
  }

  return resolveGeneratedBatchNo({ product, type });
};

const upsertBatchQuantity = ({ batches, batchNo, skt, location, qty }) => {
  const safeQty = toSafeInteger(qty);
  if (safeQty <= 0) {
    return cloneBatches(batches);
  }

  const safeBatches = cloneBatches(batches);
  const locationField = resolveBatchLocationField(location);
  const safeBatchNo = normalizeBatchNo(batchNo);
  const safeSkt = normalizeDateOnly(skt);

  const matchIndex = safeBatches.findIndex((item) => {
    if (normalizeBatchNo(item.batchNo) !== safeBatchNo) return false;
    if (!safeSkt) return true;
    return normalizeDateOnly(item.skt) === safeSkt;
  });

  if (matchIndex >= 0) {
    const target = { ...safeBatches[matchIndex] };
    target[locationField] = toSafeInteger(target[locationField]) + safeQty;
    target.totalQuantity = toSafeInteger(target.warehouseQuantity) + toSafeInteger(target.shelfQuantity);
    target.status = target.totalQuantity > 0 ? 'Aktif' : 'Tukendi';
    if (safeSkt && !normalizeDateOnly(target.skt)) {
      target.skt = safeSkt;
    }
    safeBatches[matchIndex] = target;
    return safeBatches;
  }

  const warehouseQuantity = locationField === 'warehouseQuantity' ? safeQty : 0;
  const shelfQuantity = locationField === 'shelfQuantity' ? safeQty : 0;

  return [
    ...safeBatches,
    {
      id: `batch-${uuidv4()}`,
      batchNo: safeBatchNo,
      skt: safeSkt,
      warehouseQuantity,
      shelfQuantity,
      totalQuantity: warehouseQuantity + shelfQuantity,
      status: warehouseQuantity + shelfQuantity > 0 ? 'Aktif' : 'Tukendi',
    },
  ];
};

const enforceSktPolicy = ({ product, category, skt, context = 'stock' } = {}) => {
  const policy = resolveSktPolicy({ product, category });
  const normalizedSkt = normalizeDateOnly(skt);
  if (policy.policy === SKT_POLICIES.REQUIRED && !normalizedSkt) {
    throw new AppError(400, 'Bu ürün grubu için SKT zorunludur');
  }
  if (skt && !normalizedSkt) {
    throw new AppError(400, 'SKT YYYY-MM-DD formatinda olmalidir');
  }
  return {
    ...policy,
    skt: policy.policy === SKT_POLICIES.NOT_APPLICABLE && context === 'receipt' ? '' : normalizedSkt,
  };
};

const upsertBatchRecord = ({ batches, sourceBatchNo = '', batchNo, skt, warehouseQuantity = 0, shelfQuantity = 0, status = '', requireSkt = true } = {}) => {
  const safeBatches = cloneBatches(batches);
  const nextBatchNo = normalizeBatchNo(batchNo);
  const nextSkt = normalizeDateOnly(skt);
  if (!nextBatchNo) {
    throw new AppError(400, 'Parti No zorunludur');
  }
  if (requireSkt && !nextSkt) {
    throw new AppError(400, 'SKT YYYY-MM-DD formatinda olmalidir');
  }

  const explicitSource = normalizeBatchNo(sourceBatchNo);
  const source = explicitSource || nextBatchNo;
  const existingByBatchNo = safeBatches.find((item) => normalizeBatchNo(item.batchNo) === nextBatchNo);
  if (!explicitSource && existingByBatchNo && nextSkt && normalizeDateOnly(existingByBatchNo.skt) !== nextSkt) {
    throw new AppError(409, 'Aynı Parti No farklı SKT ile kaydedilemez');
  }
  const conflict = safeBatches.find((item) =>
    normalizeBatchNo(item.batchNo) === nextBatchNo
    && normalizeBatchNo(item.batchNo) !== source
    && nextSkt
    && normalizeDateOnly(item.skt) !== nextSkt
  );
  if (conflict) {
    throw new AppError(409, 'Aynı Parti No farklı SKT ile kaydedilemez');
  }

  const index = safeBatches.findIndex((item) => normalizeBatchNo(item.batchNo) === source);
  const warehouse = toSafeInteger(warehouseQuantity);
  const shelf = toSafeInteger(shelfQuantity);
  const total = warehouse + shelf;
  const next = {
    ...(index >= 0 ? safeBatches[index] : {}),
    id: index >= 0 ? safeBatches[index].id : `batch-${uuidv4()}`,
    batchNo: nextBatchNo,
    skt: nextSkt,
    warehouseQuantity: warehouse,
    shelfQuantity: shelf,
    totalQuantity: total,
    status: status || (total > 0 ? 'Aktif' : 'Tukendi'),
  };

  if (index >= 0) {
    safeBatches[index] = next;
    return safeBatches;
  }

  return [...safeBatches, next];
};

const consumeBatchQuantity = ({ batches, location, qty, preferredBatchNo = '' }) => {
  const safeQty = toSafeInteger(qty);
  const safeBatches = cloneBatches(batches);
  const locationField = resolveBatchLocationField(location);
  const preferred = normalizeBatchNo(preferredBatchNo);

  const candidates = safeBatches
    .map((batch, index) => ({
      index,
      batch,
      available: toSafeInteger(batch?.[locationField]),
      skt: normalizeDateOnly(batch?.skt),
      batchNo: normalizeBatchNo(batch?.batchNo),
    }))
    .filter((item) => item.available > 0)
    .sort((left, right) => {
      const leftPreferred = preferred && left.batchNo === preferred;
      const rightPreferred = preferred && right.batchNo === preferred;
      if (leftPreferred && !rightPreferred) return -1;
      if (!leftPreferred && rightPreferred) return 1;

      const leftDate = left.skt ? Date.parse(left.skt) : Number.POSITIVE_INFINITY;
      const rightDate = right.skt ? Date.parse(right.skt) : Number.POSITIVE_INFINITY;
      if (leftDate !== rightDate) return leftDate - rightDate;
      return left.batchNo.localeCompare(right.batchNo, 'tr');
    });

  let remaining = safeQty;
  const allocations = [];

  for (const candidate of candidates) {
    if (remaining <= 0) break;

    const take = Math.min(candidate.available, remaining);
    if (take <= 0) continue;

    const target = { ...safeBatches[candidate.index] };
    target[locationField] = toSafeInteger(target[locationField]) - take;
    target.totalQuantity = toSafeInteger(target.warehouseQuantity) + toSafeInteger(target.shelfQuantity);
    target.status = target.totalQuantity > 0 ? 'Aktif' : 'Tukendi';
    safeBatches[candidate.index] = target;

    allocations.push({
      batchNo: normalizeBatchNo(target.batchNo),
      skt: normalizeDateOnly(target.skt),
      qty: take,
    });

    remaining -= take;
  }

  return {
    batches: safeBatches,
    allocations,
    remaining,
  };
};

const shouldTrackBatchesForMovement = ({ existingStock, input, type }) => {
  const hasExistingBatches = Array.isArray(existingStock?.batches) && existingStock.batches.length > 0;
  const hasInboundBatchDetails = Boolean(normalizeBatchNo(input?.batchNo) || normalizeDateOnly(input?.skt));
  const isReceipt = String(input?.entryType || '').toLowerCase() === 'receipt';
  return hasExistingBatches || hasInboundBatchDetails || isReceipt || type === 'TRANSFER';
};

const createWriteOffMovement = async ({
  product,
  stock,
  batch,
  location,
  qty,
  note,
  userId,
  userName,
}) => {
  const previousQuantity = getStockByLocation(stock, location);
  const nextQuantity = Math.max(0, previousQuantity - qty);
  const previousTotalQuantity = toSafeInteger(stock.warehouseQuantity) + toSafeInteger(stock.shelfQuantity);
  const nextTotalQuantity = Math.max(0, previousTotalQuantity - qty);

  const movement = {
    id: uuidv4(),
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    type: 'OUT',
    qty,
    previousQuantity,
    nextQuantity,
    previousTotalQuantity,
    nextTotalQuantity,
    location,
    locationLabel: LOCATION_LABELS[location] || location,
    note,
    reasonCode: 'write_off',
    reasonLabel: 'SKT geçmiş ürün imhası',
    batchNo: normalizeBatchNo(batch.batchNo),
    skt: normalizeDateOnly(batch.skt),
    batchAllocations: [{
      batchNo: normalizeBatchNo(batch.batchNo),
      skt: normalizeDateOnly(batch.skt),
      qty,
    }],
    outputType: 'fire',
    referenceNo: buildReferenceNo(),
    userId,
    userName: userName || 'Sistem',
    createdAt: new Date().toISOString(),
  };

  await movementRepo.create(movement);
  return enrichReason(movement);
};

export const stockService = {
  async upsertBatch(productId, payload = {}) {
    const product = await productRepo.findById(productId);
    if (!product) {
      throw createNotFoundError('Ürün bulunamadı');
    }
    const category = product.categoryId ? await categoryRepo.findById(product.categoryId) : null;
    const sktPolicy = enforceSktPolicy({
      product,
      category,
      skt: payload.skt,
      context: 'batch',
    });

    const existingStock = (await stockRepo.findByProductId(productId)) || {
      productId,
      warehouseQuantity: 0,
      shelfQuantity: 0,
      quantity: 0,
      batches: [],
      reserved: 0,
    };
    const nextBatches = upsertBatchRecord({
      batches: existingStock.batches || [],
      sourceBatchNo: payload.sourceBatchNo,
      batchNo: payload.batchNo,
      skt: payload.skt,
      warehouseQuantity: payload.warehouseQuantity,
      shelfQuantity: payload.shelfQuantity,
      status: payload.status,
      requireSkt: sktPolicy.policy === SKT_POLICIES.REQUIRED,
    });

    const persistedStock = await stockRepo.upsertDetailed(productId, {
      ...existingStock,
      ...buildStockPayloadFromBatches(nextBatches),
    });
    clearPricingAnalysisCache();

    const batchNo = normalizeBatchNo(payload.batchNo);
    const batch = cloneBatches(persistedStock?.batches || []).find((item) => normalizeBatchNo(item.batchNo) === batchNo) || null;
    return {
      productId,
      batch,
      batches: cloneBatches(persistedStock?.batches || []),
      stock: persistedStock,
      sktPolicy,
    };
  },

  async getStocks(query = {}) {
    if (config.dataStore === 'postgres') {
      return getStocksFromPostgres(query);
    }

    const [products, stocks] = await Promise.all([productRepo.getAll(), stockRepo.getAll()]);

    const includeUnlisted = query.includeUnlisted === 'true' || query.listed === 'false';
    const includeBatches = parseBooleanQuery(query.includeBatches, false);
    const search = String(query.search || query.q || '').trim().toLocaleLowerCase('tr-TR');
    const pagination = parsePagePagination(query, { defaultLimit: 100, maxLimit: 250 });
    const rows = products
      .filter((product) => includeUnlisted ? true : isActiveRetailProduct(product))
      .filter((product) => {
        if (query.categoryId && String(product.categoryId || '') !== String(query.categoryId)) return false;
        if (query.status === 'inactive') return product.isActive === false;
        if (search) {
          return [product.name, product.sku, product.barcode]
            .some((value) => String(value || '').toLocaleLowerCase('tr-TR').includes(search));
        }
        return true;
      })
      .map((product) => {
        const stock = stocks.find((item) => item.productId === product.id);
        const warehouseStock = stock?.warehouseQuantity || 0;
        const shelfStock = stock?.shelfQuantity || 0;
        const quantity = warehouseStock + shelfStock;
        const maxShelfStock = resolveMaxShelfStock(product, quantity);
        const batches = Array.isArray(stock?.batches) ? stock.batches : [];
        const fefoBatch = batches.find((item) => String(item.batchNo || '') === String(stock?.fefoDefaultBatchNo || ''))
          || [...batches]
            .filter((item) => Number(item?.totalQuantity || 0) > 0 && item?.skt)
            .sort((left, right) => String(left.skt || '').localeCompare(String(right.skt || '')))[0]
          || null;

        return {
          productId: product.id,
          sku: product.sku,
          barcode: product.barcode || '',
          productName: product.name,
          unit: product.unit,
          isActive: product.isActive,
          status: product.isActive ? 'active' : 'inactive',
          storageType: product.requiredStorageType || 'Ortam',
          storageTypeLabel: formatStorageTypeLabel(product.requiredStorageType || 'Ortam'),
          warehouseStock,
          shelfStock,
          totalStock: quantity,
          quantity,
          onHand: Number(stock?.onHand ?? quantity),
          available: Number(stock?.available ?? quantity),
          reserved: Number(stock?.reserved || 0),
          criticalStock: product.criticalStock,
          maxShelfStock,
          nearestExpiry: fefoBatch?.skt || null,
          batchCount: Number(stock?.batchCount || batches.filter((item) => Number(item?.totalQuantity || 0) > 0).length),
          fefoBatch: fefoBatch
            ? {
              batchNo: fefoBatch.batchNo || null,
              skt: fefoBatch.skt || null,
              totalQuantity: Number(fefoBatch.totalQuantity || 0),
              warehouseQuantity: Number(fefoBatch.warehouseQuantity || 0),
              shelfQuantity: Number(fefoBatch.shelfQuantity || 0),
            }
            : null,
          fefoDefaults: {
            defaultBatchNo: fefoBatch?.batchNo || null,
            defaultExpiry: fefoBatch?.skt || null,
          },
          stockSummary: {
            warehouseStock,
            shelfStock,
            totalStock: quantity,
            onHand: Number(stock?.onHand ?? quantity),
            available: Number(stock?.available ?? quantity),
            reserved: Number(stock?.reserved || 0),
            batchCount: Number(stock?.batchCount || batches.filter((item) => Number(item?.totalQuantity || 0) > 0).length),
            nearestExpiry: fefoBatch?.skt || null,
          },
          isCritical: deriveShelfStockAlert({ product, shelfQuantity: shelfStock, totalQuantity: quantity }) === 'critical',
          updatedAt: stock?.updatedAt || product.updatedAt,
          ...(includeBatches ? {
            batches,
            productBatches: batches,
          } : {}),
        };
      })
      .sort((left, right) => Number(right.isCritical) - Number(left.isCritical) || left.productName.localeCompare(right.productName, 'tr'));
    const items = rows.slice(pagination.skip, pagination.skip + pagination.limit);

    return {
      items,
      pagination: {
        mode: 'offset',
        page: pagination.page,
        limit: pagination.limit,
        total: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / pagination.limit)),
        hasNextPage: pagination.skip + items.length < rows.length,
        nextCursor: null,
        cursorVersion: null,
      },
      filters: {
        search: search || null,
        includeBatches,
        categoryId: query.categoryId || null,
        listed: query.listed ?? null,
        status: query.status || null,
      },
      sort: {
        fields: ['name', 'id'],
        direction: 'asc',
        key: 'name_asc',
      },
    };
  },

  async listExpiredBatchWarnings(query = {}) {
    if (config.dataStore === 'postgres') {
      return listExpiredBatchWarningsFromPostgres(query);
    }

    const [products, stocks] = await Promise.all([productRepo.getAll(), stockRepo.getAll()]);
    const productMap = new Map(products.map((product) => [product.id, product]));
    const today = normalizeDateOnly(query.today || new Date());
    const pagination = parsePagePagination(query, { defaultLimit: 200, maxLimit: 1000 });
    const rows = stocks.flatMap((stock) => {
      const product = productMap.get(stock.productId);
      if (!isActiveRetailProduct(product)) return [];
      return cloneBatches(stock.batches || [])
        .filter((batch) => {
          const totalQuantity = toSafeInteger(batch.totalQuantity);
          const locationQuantity = toSafeInteger(batch.warehouseQuantity) + toSafeInteger(batch.shelfQuantity);
          return (totalQuantity > 0 || locationQuantity > 0) && normalizeDateOnly(batch.skt) && normalizeDateOnly(batch.skt) < today;
        })
        .map((batch) => ({
          id: batch.id,
          productId: stock.productId,
          productName: product?.name || '',
          sku: product?.sku || '',
          barcode: product?.barcode || '',
          batchNo: normalizeBatchNo(batch.batchNo),
          skt: normalizeDateOnly(batch.skt),
          warehouseQuantity: toSafeInteger(batch.warehouseQuantity),
          shelfQuantity: toSafeInteger(batch.shelfQuantity),
          totalQuantity: toSafeInteger(batch.totalQuantity),
          riskStatus: 'SKT geçmiş',
          daysExpired: Math.max(0, Math.floor((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${normalizeDateOnly(batch.skt)}T00:00:00.000Z`)) / (24 * 60 * 60 * 1000))),
        }));
    }).sort((left, right) => left.skt.localeCompare(right.skt) || left.productName.localeCompare(right.productName, 'tr'));
    const items = rows.slice(pagination.skip, pagination.skip + pagination.limit);

    return {
      items,
      pagination: {
        mode: 'offset',
        page: pagination.page,
        limit: pagination.limit,
        total: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / pagination.limit)),
        hasNextPage: pagination.skip + items.length < rows.length,
        nextCursor: null,
        cursorVersion: null,
      },
      filters: { today },
    };
  },

  async disposeExpiredBatches(payload = {}, userId) {
    const items = Array.isArray(payload.items) ? payload.items : [];
    const batchIds = Array.from(new Set(items.map((item) => String(item.batchId || item.id || '').trim()).filter(Boolean)));
    if (!batchIds.length) {
      throw new AppError(400, 'İmha için en az bir SKT geçmiş parti seçilmelidir');
    }

    const user = await userRepo.findById(userId);
    const today = normalizeDateOnly(new Date());
    const noteSuffix = String(payload.note || '').trim();
    const baseNote = 'SKT geçmiş ürün imhası';
    const movements = [];
    let disposedBatchCount = 0;

    for (const batchId of batchIds) {
      const allStocks = await stockRepo.getAll();
      const stock = allStocks.find((item) => cloneBatches(item.batches || []).some((batch) => String(batch.id) === batchId));
      if (!stock) {
        console.warn('[Veri bütünlüğü] İmha edilecek parti stok kaynağında bulunamadı', { batchId });
        continue;
      }
      const product = await productRepo.findById(stock.productId);
      if (!isActiveRetailProduct(product)) {
        console.warn('[Veri bütünlüğü] Listed olmayan veya pasif ürün için SKT imhası atlandı', { productId: stock.productId, batchId });
        continue;
      }

      const batches = cloneBatches(stock.batches || []);
      const index = batches.findIndex((batch) => String(batch.id) === batchId);
      const batch = batches[index];
      if (!batch) continue;
      if (!normalizeDateOnly(batch.skt) || normalizeDateOnly(batch.skt) >= today) {
        throw new AppError(400, 'Sadece SKT tarihi geçmiş partiler imha edilebilir');
      }

      const warehouseQty = toSafeInteger(batch.warehouseQuantity);
      const shelfQty = toSafeInteger(batch.shelfQuantity);
      const totalQty = warehouseQty + shelfQty;
      if (totalQty <= 0) continue;

      const movementNote = [
        baseNote,
        `Parti No: ${normalizeBatchNo(batch.batchNo)}`,
        `SKT: ${normalizeDateOnly(batch.skt)}`,
        noteSuffix,
      ].filter(Boolean).join(' | ');

      if (warehouseQty > 0) {
        movements.push(await createWriteOffMovement({
          product,
          stock,
          batch,
          location: 'depo',
          qty: warehouseQty,
          note: movementNote,
          userId,
          userName: user?.name,
        }));
      }
      if (shelfQty > 0) {
        movements.push(await createWriteOffMovement({
          product,
          stock: { ...stock, warehouseQuantity: Math.max(0, toSafeInteger(stock.warehouseQuantity) - warehouseQty) },
          batch,
          location: 'reyon',
          qty: shelfQty,
          note: movementNote,
          userId,
          userName: user?.name,
        }));
      }

      batches[index] = {
        ...batch,
        warehouseQuantity: 0,
        shelfQuantity: 0,
        totalQuantity: 0,
        status: 'Imha edildi',
      };
      await stockRepo.upsertDetailed(stock.productId, {
        ...stock,
        ...buildStockPayloadFromBatches(batches),
      });
      disposedBatchCount += 1;
    }

    clearPricingAnalysisCache();
    return {
      disposedBatchCount,
      movementCount: movements.length,
      movements,
    };
  },

  async listMovements(query = {}) {
    if (config.dataStore === 'postgres') {
      return listMovementsFromPostgres(query);
    }

    const movements = await movementRepo.getAll();
    const normalized = normalizeMovementQuery(query);
    const sorted = sortByNewest(filterMovements(movements, normalized)).map(enrichReason);
    const pagination = parsePagePagination(normalized, { defaultLimit: 50, maxLimit: 500 });
    const items = sorted.slice(pagination.skip, pagination.skip + pagination.limit);

    return {
      items,
      pagination: {
        mode: 'offset',
        page: pagination.page,
        limit: pagination.limit,
        total: sorted.length,
        totalPages: Math.max(1, Math.ceil(sorted.length / pagination.limit)),
        hasNextPage: pagination.skip + items.length < sorted.length,
        nextCursor: null,
        cursorVersion: null,
      },
      filters: {
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        type: normalized.type || null,
        productId: normalized.productId || null,
        search: normalized.search || null,
      },
      sort: { key: 'createdAt_desc', direction: 'desc' },
    };
  },

  async getMovementSummary(query = {}) {
    if (config.dataStore === 'postgres') {
      return movementSummaryFromPostgres(query);
    }

    const movements = filterMovements(await movementRepo.getAll(), query);
    const byType = movements.reduce((acc, movement) => {
      const type = movement.type || 'UNKNOWN';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    const normalized = normalizeMovementQuery(query);
    return {
      totalCount: movements.length,
      byType,
      filters: {
        startDate: normalized.startDate,
        endDate: normalized.endDate,
        type: normalized.type || null,
        productId: normalized.productId || null,
        search: normalized.search || null,
      },
    };
  },

  async listSktPolicyManualReview(query = {}) {
    const [products, categories] = await Promise.all([
      productRepo.getAll(),
      categoryRepo.getAll(),
    ]);
    const categoryById = new Map(categories.map((item) => [String(item.id), item]));
    const limit = Math.min(Math.max(Number(query.limit || 200) || 200, 1), 1000);
    const rows = products
      .map((product) => {
        const category = categoryById.get(String(product.categoryId || '')) || null;
        const policy = resolveSktPolicy({ product, category });
        return {
          productId: product.id,
          sku: product.sku,
          barcode: product.barcode || '',
          productName: product.name,
          categoryId: product.categoryId || null,
          categoryName: category?.name || '',
          categoryCode: category?.code || '',
          etiket: product.etiket || '',
          sktPolicy: policy.policy,
          reason: policy.reason,
          manualReviewReason: policy.manualReviewReason || '',
        };
      })
      .filter((item) => item.sktPolicy === SKT_POLICIES.MANUAL_REVIEW)
      .sort((left, right) =>
        String(left.categoryName || '').localeCompare(String(right.categoryName || ''), 'tr')
        || String(left.etiket || '').localeCompare(String(right.etiket || ''), 'tr')
        || String(left.productName || '').localeCompare(String(right.productName || ''), 'tr')
      );

    return {
      totalCount: rows.length,
      items: rows.slice(0, limit),
      meta: {
        limit,
        policy: SKT_POLICIES.MANUAL_REVIEW,
      },
    };
  },

  async createMovement(type, payload, userId) {
    validateStockMovementPayload(payload, { type });
    const input = sanitizeMovementInput(payload);

    const product = await productRepo.findById(input.productId);
    if (!product) {
      throw createNotFoundError('Ürün bulunamadı');
    }

    if (product.isActive === false) {
      throw new AppError(400, 'Pasif ürünler için stok hareketi oluşturulamaz');
    }

    if (product.isListed === false) {
      throw new AppError(400, 'Listed olmayan ürünler için aktif stok hareketi oluşturulamaz');
    }

    const productCategory = product.categoryId ? await categoryRepo.findById(product.categoryId) : null;

    if (type === 'IN' && input.entryType === 'receipt') {
      const sktPolicy = enforceSktPolicy({
        product,
        category: productCategory,
        skt: input.skt,
        context: 'receipt',
      });
      input.skt = sktPolicy.skt;

      const today = new Date().toISOString().slice(0, 10);
      if (input.skt && input.skt < today) {
        throw new AppError(400, 'SKT bugünden geride olamaz');
      }

      const allMovements = await movementRepo.getAll();
      const normalizedIncomingBatch = String(input.batchNo || '').trim().toLowerCase();
      if (normalizedIncomingBatch) {
        const hasDuplicateBatch = allMovements.some((item) => {
          if (String(item.productId || '') !== String(input.productId || '')) return false;
          const existingBatch = String(item.batchNo || parseBatchNoFromMovementNote(item.note) || '').trim().toLowerCase();
          return existingBatch && existingBatch === normalizedIncomingBatch;
        });

        if (hasDuplicateBatch) {
          throw new AppError(400, 'Aynı ürün için aynı parti numarası tekrar açılamaz');
        }
      }

      if (input.warehouseLocation) {
        const allLocations = await warehouseLocationRepo.getAll();
        const location = allLocations.find((item) => String(item.locationCode || '').toUpperCase() === String(input.warehouseLocation || '').toUpperCase());
        if (!location) {
          throw new AppError(400, 'Depo lokasyonu bulunamadı');
        }

        const requiredStorageType = resolveRequiredStorageType(productCategory);
        const locationStorageType = String(location.storageType || 'Ortam');
        if (requiredStorageType !== locationStorageType) {
          throw new AppError(400, 'Seçilen depo lokasyonu ürünün saklama tipine uygun deşil');
        }
      }
    }

    if (type === 'OUT' && input.sourceLocationType === 'depo' && input.sourceLocationCode) {
      const allLocations = await warehouseLocationRepo.getAll();
      const location = allLocations.find((item) => String(item.locationCode || '').toUpperCase() === String(input.sourceLocationCode || '').toUpperCase());
      if (!location) {
        throw new AppError(400, 'Kaynak depo lokasyonu bulunamadı');
      }

      const requiredStorageType = resolveRequiredStorageType(productCategory);
      const locationStorageType = String(location.storageType || 'Ortam');
      if (requiredStorageType !== locationStorageType) {
        throw new AppError(400, 'Yanlış saklama tipli lokasyondan çıkış yapılamaz');
      }
    }

    const user = await userRepo.findById(userId);
    const existingStock = (await stockRepo.findByProductId(input.productId)) || { warehouseQuantity: 0, shelfQuantity: 0, quantity: 0 };
    const location = normalizeLocation(input.location, type === 'OUT' ? normalizeLocation(input.sourceLocationType || input.location || 'depo') : 'depo');
    const previousQuantity = getStockByLocation(existingStock, location);
    const previousTotalQuantity = (existingStock.warehouseQuantity || 0) + (existingStock.shelfQuantity || 0);
    const previousBatches = cloneBatches(existingStock.batches || []);
    const useBatchTracking = shouldTrackBatchesForMovement({ existingStock, input, type });

    let nextQuantity = previousQuantity;
    let qty = input.qty || 0;
    let nextBatches = cloneBatches(previousBatches);
    let batchAllocations = [];

    if (type === 'IN') {
      nextQuantity = previousQuantity + input.qty;

      if (useBatchTracking) {
        const inboundBatchNo = resolveInboundBatchNo(input, type, product);
        nextBatches = upsertBatchQuantity({
          batches: nextBatches,
          batchNo: inboundBatchNo,
          skt: input.skt,
          location,
          qty: input.qty,
        });

        batchAllocations = [{
          batchNo: inboundBatchNo,
          skt: normalizeDateOnly(input.skt),
          qty: toSafeInteger(input.qty),
        }];
      }
    }

    if (type === 'OUT') {
      if (input.qty > previousQuantity) {
        throw new AppError(400, 'Stok çıkışı mevcut stoktan fazla olamaz');
      }

      nextQuantity = previousQuantity - input.qty;

      if (useBatchTracking && nextBatches.length > 0) {
        const consumed = consumeBatchQuantity({
          batches: nextBatches,
          location,
          qty: input.qty,
          preferredBatchNo: input.batchNo,
        });

        if (consumed.remaining > 0) {
          throw new AppError(400, 'Parti stokları çıkış miktarını karşılamıyor');
        }

        nextBatches = consumed.batches;
        batchAllocations = consumed.allocations;
      }
    }

    if (type === 'ADJUSTMENT') {
      const targetQuantity = input.targetQuantity ?? input.qty;
      if (targetQuantity === previousQuantity) {
        throw new AppError(400, 'Düzeltme için yeni stok miktarı farklı olmalıdır');
      }

      nextQuantity = targetQuantity;
      qty = Math.abs(targetQuantity - previousQuantity);

      if (useBatchTracking) {
        const delta = targetQuantity - previousQuantity;
        if (delta > 0) {
          const adjustmentBatchNo = resolveInboundBatchNo(input, type, product);
          nextBatches = upsertBatchQuantity({
            batches: nextBatches,
            batchNo: adjustmentBatchNo,
            skt: input.skt,
            location,
            qty: delta,
          });

          batchAllocations = [{
            batchNo: adjustmentBatchNo,
            skt: normalizeDateOnly(input.skt),
            qty: toSafeInteger(delta),
          }];
        } else if (delta < 0 && nextBatches.length > 0) {
          const consumed = consumeBatchQuantity({
            batches: nextBatches,
            location,
            qty: Math.abs(delta),
            preferredBatchNo: input.batchNo,
          });

          if (consumed.remaining > 0) {
            throw new AppError(400, 'Parti stokları düzeltme miktarını karşılamıyor');
          }

          nextBatches = consumed.batches;
          batchAllocations = consumed.allocations;
        }
      }
    }

    const nextStockSplit = updateStockByLocation(existingStock, location, nextQuantity);
    const stockPayload = useBatchTracking
      ? {
        ...buildStockPayloadFromBatches(nextBatches),
        ...nextStockSplit,
      }
      : nextStockSplit;

    const persistedStock = useBatchTracking
      ? await stockRepo.upsertDetailed(input.productId, stockPayload)
      : await stockRepo.upsert(input.productId, stockPayload);

    const nextTotalQuantity = (persistedStock?.warehouseQuantity || 0) + (persistedStock?.shelfQuantity || 0);
    const nextQuantityByLocation = getStockByLocation(persistedStock || nextStockSplit, location);
    const movementBatchNo = normalizeBatchNo(input.batchNo) || normalizeBatchNo(batchAllocations?.[0]?.batchNo);
    const movementBatchSkt = normalizeDateOnly(input.skt) || normalizeDateOnly(batchAllocations?.[0]?.skt);

    const movement = {
      id: uuidv4(),
      productId: product.id,
      supplierId: input.supplierId || undefined,
      productName: product.name,
      sku: product.sku,
      type,
      qty,
      previousQuantity,
      nextQuantity: nextQuantityByLocation,
      previousTotalQuantity,
      nextTotalQuantity,
      location,
      locationLabel: LOCATION_LABELS[location] || location,
      note: input.note,
      reasonCode: input.reasonCode || (type === 'IN' ? 'product_purchase' : type === 'OUT' ? 'manual_adjustment' : 'manual_adjustment'),
      reasonLabel: input.reasonLabel || undefined,
      entryType: input.entryType || undefined,
      batchNo: movementBatchNo || undefined,
      skt: movementBatchSkt || undefined,
      batchAllocations: batchAllocations.length > 0 ? batchAllocations : undefined,
      previousBatches: previousBatches,
      nextBatches: cloneBatches(persistedStock?.batches || nextBatches),
      purchasePrice: input.purchasePrice ?? undefined,
      receiptDate: input.receiptDate || undefined,
      warehouseLocation: input.warehouseLocation || undefined,
      acceptedCaseCount: input.acceptedCaseCount ?? undefined,
      irsaliyeNo: input.irsaliyeNo || undefined,
      acceptanceType: input.acceptanceType || undefined,
      productionDate: input.productionDate || undefined,
      acceptanceNote: input.acceptanceNote || undefined,
      outputType: input.outputType || undefined,
      sourceLocationType: input.sourceLocationType || undefined,
      sourceLocationCode: input.sourceLocationCode || undefined,
      userNote: input.userNote || undefined,
      approvalRequired: input.approvalRequired === true,
      referenceNo: input.referenceNo || buildReferenceNo(),
      userId,
      userName: user?.name || 'Sistem',
      createdAt: new Date().toISOString(),
    };

    await movementRepo.create(movement);

    if (location === 'reyon') {
      await triggerTransferAutomationAfterShelfChange({
        productId: product.id,
        source: `stock_movement:${type.toLowerCase()}`,
      });
    }

    return {
      movement: enrichReason(movement),
      stock: {
        productId: product.id,
        warehouseQuantity: persistedStock?.warehouseQuantity || 0,
        shelfQuantity: persistedStock?.shelfQuantity || 0,
        quantity: nextTotalQuantity,
      },
    };
  },

  async transferStock(payload, userId, options = {}) {
    validateStockTransferPayload(payload);
    const input = sanitizeMovementInput(payload);

    const product = options.product || await productRepo.findById(input.productId);
    if (!product) {
      throw createNotFoundError('Ürün bulunamadı');
    }

    if (product.isActive === false) {
      throw new AppError(400, 'Pasif ürünler için transfer oluşturulamaz');
    }

    const user = options.user || await userRepo.findById(userId);
    const fromLocation = normalizeLocation(input.fromLocation);
    const toLocation = normalizeLocation(input.toLocation);
    const qty = input.qty || 0;

    if (fromLocation === toLocation) {
      throw new AppError(400, 'Kaynak ve hedef konum aynı olamaz');
    }

    const existingStock = (await stockRepo.findByProductId(input.productId)) || { warehouseQuantity: 0, shelfQuantity: 0, quantity: 0 };
    const previousBatches = cloneBatches(existingStock.batches || []);
    const fromCurrent = getStockByLocation(existingStock, fromLocation);
    if (qty > fromCurrent) {
      throw new AppError(400, 'Transfer miktarı kaynak stoktan fazla olamaz');
    }

    const nextFrom = fromCurrent - qty;
    const toCurrent = getStockByLocation(existingStock, toLocation);
    const nextTo = toCurrent + qty;

    const nextStockSplit = updateStockByLocation(
      updateStockByLocation(existingStock, fromLocation, nextFrom),
      toLocation,
      nextTo
    );

    let persistedStock;
    let batchMovements = [];
    if (previousBatches.length > 0) {
      const consumed = consumeBatchQuantity({
        batches: previousBatches,
        location: fromLocation,
        qty,
        preferredBatchNo: input.batchNo,
      });

      if (consumed.remaining > 0) {
        throw new AppError(400, 'Parti stokları transfer miktarını karşılamıyor');
      }

      let nextBatches = cloneBatches(consumed.batches);
      for (const allocation of consumed.allocations) {
        nextBatches = upsertBatchQuantity({
          batches: nextBatches,
          batchNo: allocation.batchNo,
          skt: allocation.skt,
          location: toLocation,
          qty: allocation.qty,
        });
      }

      batchMovements = consumed.allocations;
      persistedStock = await stockRepo.upsertDetailed(input.productId, {
        ...buildStockPayloadFromBatches(nextBatches),
        ...nextStockSplit,
      });
    } else {
      persistedStock = await stockRepo.upsert(input.productId, nextStockSplit);
    }

    const reasonCode = input.reasonCode || (fromLocation === 'depo' && toLocation === 'reyon' ? 'transfer_to_shelf' : 'transfer_to_warehouse');

    const movement = {
      id: uuidv4(),
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      type: 'TRANSFER',
      qty,
      previousQuantity: fromCurrent,
      nextQuantity: getStockByLocation(persistedStock || nextStockSplit, fromLocation),
      previousTotalQuantity: (existingStock.warehouseQuantity || 0) + (existingStock.shelfQuantity || 0),
      nextTotalQuantity: (persistedStock?.warehouseQuantity || 0) + (persistedStock?.shelfQuantity || 0),
      fromLocation,
      toLocation,
      location: toLocation,
      fromLocationLabel: LOCATION_LABELS[fromLocation] || fromLocation,
      toLocationLabel: LOCATION_LABELS[toLocation] || toLocation,
      note: input.note,
      batchMovements: batchMovements.length > 0 ? batchMovements : undefined,
      previousBatches: previousBatches,
      nextBatches: cloneBatches(persistedStock?.batches || []),
      transferRequestId: input.transferRequestId || undefined,
      transferRequestStatus: input.transferRequestStatus || undefined,
      reasonCode,
      reasonLabel: input.reasonLabel || undefined,
      referenceNo: input.referenceNo || buildReferenceNo(),
      userId,
      userName: user?.name || 'Sistem',
      createdAt: new Date().toISOString(),
    };

    await movementRepo.create(movement);

    if (!options.skipAutomationScan && (fromLocation === 'reyon' || toLocation === 'reyon')) {
      await triggerTransferAutomationAfterShelfChange({
        productId: product.id,
        source: 'stock_transfer',
      });
    }

    return {
      movement: enrichReason(movement),
      stock: {
        productId: product.id,
        warehouseQuantity: persistedStock?.warehouseQuantity || 0,
        shelfQuantity: persistedStock?.shelfQuantity || 0,
        quantity: (persistedStock?.warehouseQuantity || 0) + (persistedStock?.shelfQuantity || 0),
      },
    };
  },

  async cancelMovement(movementId, userId, payload = {}) {
    const movement = await movementRepo.findById(movementId);
    if (!movement) {
      throw createNotFoundError('İptal edilecek hareket bulunamadı');
    }

    if (movement.cancelledAt) {
      throw new AppError(400, 'Bu hareket zaten iptal edilmiş');
    }

    if (movement.cancellationOfMovementId) {
      throw new AppError(400, 'İptal hareketi tekrar iptal edilemez');
    }

    const allMovements = await movementRepo.getAll();
    const activeProductMovements = allMovements
      .filter((item) => String(item.productId || '') === String(movement.productId || '') && !item.cancelledAt)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const latest = activeProductMovements[0];
    if (!latest || String(latest.id || '') !== String(movement.id || '')) {
      throw new AppError(400, 'Bu işlemden sonra daha yeni hareketler var. Önce en güncel hareketi iptal edin.');
    }

    const product = await productRepo.findById(movement.productId);
    if (!product) {
      throw createNotFoundError('Ürün bulunamadı');
    }

    const user = await userRepo.findById(userId);
    const existingStock = (await stockRepo.findByProductId(movement.productId)) || { warehouseQuantity: 0, shelfQuantity: 0 };
    const qty = Number(movement.qty || 0);
    const currentBatches = cloneBatches(existingStock.batches || []);

    const normalizedType = String(movement.type || '').toUpperCase();

    const now = new Date().toISOString();
    const reason = String(payload.reason || '').trim() || 'Kullanıcı tarafından iptal edildi';
    const previousTotalQuantity = Number(existingStock.warehouseQuantity || 0) + Number(existingStock.shelfQuantity || 0);

    let persistedStock;
    if (Array.isArray(movement.previousBatches)) {
      persistedStock = await stockRepo.upsertDetailed(movement.productId, buildStockPayloadFromBatches(movement.previousBatches));
    } else {
      let nextWarehouse = Number(existingStock.warehouseQuantity || 0);
      let nextShelf = Number(existingStock.shelfQuantity || 0);

      const changeByLocation = (location, delta) => {
        if (location === 'reyon') {
          const next = nextShelf + delta;
          if (next < 0) throw new AppError(400, 'İptal işlemi için reyon stoku yetersiz');
          nextShelf = next;
          return;
        }

        const next = nextWarehouse + delta;
        if (next < 0) throw new AppError(400, 'İptal işlemi için depo stoku yetersiz');
        nextWarehouse = next;
      };

      if (normalizedType === 'IN') {
        changeByLocation(movement.location === 'reyon' ? 'reyon' : 'depo', -qty);
      } else if (normalizedType === 'OUT') {
        changeByLocation(movement.location === 'reyon' ? 'reyon' : 'depo', qty);
      } else if (normalizedType === 'ADJUSTMENT') {
        if ((movement.location || 'depo') === 'reyon') {
          nextShelf = Math.max(0, Number(movement.previousQuantity || 0));
        } else {
          nextWarehouse = Math.max(0, Number(movement.previousQuantity || 0));
        }
      } else if (normalizedType === 'TRANSFER') {
        const reverseFrom = movement.toLocation || movement.location || 'depo';
        const reverseTo = movement.fromLocation || 'depo';
        changeByLocation(reverseFrom === 'reyon' ? 'reyon' : 'depo', -qty);
        changeByLocation(reverseTo === 'reyon' ? 'reyon' : 'depo', qty);
      } else {
        throw new AppError(400, 'Bu hareket tipi için iptal desteklenmiyor');
      }

      persistedStock = await stockRepo.upsert(movement.productId, {
        warehouseQuantity: nextWarehouse,
        shelfQuantity: nextShelf,
      });
    }

    const nextTotalQuantity = Number(persistedStock?.warehouseQuantity || 0) + Number(persistedStock?.shelfQuantity || 0);
    const currentLocation = movement.location === 'reyon' ? 'reyon' : 'depo';

    const cancellationMovement = {
      id: uuidv4(),
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      type: normalizedType === 'IN' ? 'OUT' : normalizedType === 'OUT' ? 'IN' : normalizedType,
      qty,
      previousQuantity: normalizedType === 'ADJUSTMENT'
        ? Number(movement.nextQuantity || movement.previousQuantity || 0)
        : Number(movement.nextQuantity || 0),
      nextQuantity: normalizedType === 'ADJUSTMENT'
        ? Number(movement.previousQuantity || 0)
        : Number(
            (currentLocation === 'reyon'
              ? persistedStock?.shelfQuantity
              : persistedStock?.warehouseQuantity) || 0
          ),
      previousTotalQuantity,
      nextTotalQuantity,
      location: movement.location || 'depo',
      fromLocation: normalizedType === 'TRANSFER' ? (movement.toLocation || movement.location || 'depo') : undefined,
      toLocation: normalizedType === 'TRANSFER' ? (movement.fromLocation || 'depo') : undefined,
      locationLabel: LOCATION_LABELS[movement.location || 'depo'] || movement.location || 'depo',
      note: `İPTAL: ${reason}`,
      reasonCode: 'movement_cancel',
      reasonLabel: 'İşlem İptali',
      previousBatches: currentBatches,
      nextBatches: cloneBatches(persistedStock?.batches || []),
      cancellationOfMovementId: movement.id,
      referenceNo: buildReferenceNo(),
      userId,
      userName: user?.name || 'Sistem',
      createdAt: now,
    };

    await movementRepo.create(cancellationMovement);

    const cancelled = await movementRepo.updateById(movement.id, {
      ...movement,
      cancelledAt: now,
      cancelledBy: userId,
      cancelledByName: user?.name || 'Sistem',
      cancelReason: reason,
      cancellationMovementId: cancellationMovement.id,
      updatedAt: now,
    });

    return {
      cancelledMovement: enrichReason(cancelled || movement),
      cancellationMovement: enrichReason(cancellationMovement),
      stock: {
        productId: product.id,
        warehouseQuantity: persistedStock?.warehouseQuantity || 0,
        shelfQuantity: persistedStock?.shelfQuantity || 0,
        quantity: nextTotalQuantity,
      },
    };
  },
};

