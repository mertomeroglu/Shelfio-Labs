import { categoryRepo } from '../../repositories/categoryRepository.js';
import { productRepo } from '../../repositories/productRepository.js';
import { salesRepo } from '../../repositories/salesRepository.js';
import { stockRepo } from '../../repositories/stockRepository.js';
import { supplierProductRepo } from '../../repositories/supplierProductRepository.js';
import { supplierRepo } from '../../repositories/supplierRepository.js';
import { config } from '../../config/config.js';
import { getPrisma } from '../../providers/postgresProvider.js';
import { withPostgresQueryLogging } from '../../utils/performanceLogger.js';
import { demandForecastService } from './demandForecastService.js';
import { recommendationEngine } from './recommendationEngine.js';
import { riskScoringService } from './riskScoringService.js';
import { AppError, createNotFoundError } from '../../utils/appError.js';
import { parsePagePagination, resolveWhitelistedSort } from '../../utils/pagination.js';
import { settingsRepo } from '../../repositories/settingsRepository.js';
import { logisticsTariffService } from '../logisticsTariffService.js';
import { applyCampaignPricingToProduct, listActiveCampaignDefinitions } from '../campaignPricingService.js';
import { v4 as uuidv4 } from 'uuid';
import {
  buildProductUniverseWhere,
  matchesProductUniverse,
  normalizeProductUniverse,
  PRODUCT_UNIVERSES,
} from '../../utils/productUniverse.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SALES_LOOKBACK_DAYS = 30;
const ANALYSIS_CACHE_TTL_MS = 30_000;
const analysisCache = new Map();
const NON_REAL_PRICE_EVENT_SOURCES = new Set([
  'legacy_price_updated_at',
  'legacy',
  'import',
  'bulk_import',
  'seed',
  'migration',
  'updated_at',
  'catalog_import',
  'initial_import',
]);

const isRealPriceEventSource = (source) => !NON_REAL_PRICE_EVENT_SOURCES.has(String(source || '').toLowerCase());

const pricesEqual = (left, right) => {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.round(a * 100) === Math.round(b * 100);
};

const getAnalysisCacheKey = (query = {}) => JSON.stringify(Object.entries(query || {})
  .filter(([key]) => key !== 'forceRefresh')
  .sort(([left], [right]) => left.localeCompare(right)));

const getCachedAnalysis = (key) => {
  const entry = analysisCache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    analysisCache.delete(key);
    return null;
  }
  return entry.promise;
};

const setCachedAnalysis = (key, promise) => {
  analysisCache.set(key, {
    promise,
    expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS,
  });
  promise.catch(() => analysisCache.delete(key));
  return promise;
};

export const clearPricingAnalysisCache = () => analysisCache.clear();

const resolveStockBatchesFefo = (stock = {}) => {
  const batches = Array.isArray(stock?.batches) ? stock.batches : [];
  return batches
    .map((batch) => ({
      batchNo: String(batch?.batchNo || '').trim(),
      skt: String(batch?.skt || '').slice(0, 10),
      totalQuantity: Number(batch?.totalQuantity ?? (Number(batch?.warehouseQuantity || 0) + Number(batch?.shelfQuantity || 0)) ?? 0),
    }))
    .filter((batch) => batch.batchNo && batch.skt && batch.totalQuantity > 0 && Number.isFinite(new Date(batch.skt).getTime()))
    .sort((left, right) => left.skt.localeCompare(right.skt) || left.batchNo.localeCompare(right.batchNo, 'tr'))[0] || null;
};

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

const buildPricingWhere = (query = {}) => {
  const productUniverse = resolveAnalysisUniverse(query);
  const where = buildProductUniverseWhere(productUniverse);
  if (query.categoryId) {
    where.categoryId = String(query.categoryId);
  }
  if (query.supplierId) {
    where.supplierId = String(query.supplierId);
  }
  const search = String(query.search || query.q || '').trim();
  if (search) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
        ],
      },
    ];
  }
  return { where, productUniverse };
};

const getFastSummaryFromPostgres = async (query = {}) => {
  const prisma = await getPrisma();
  const { where, productUniverse } = buildPricingWhere(query);
  const [products, categories, suppliers] = await withPostgresQueryLogging('GET /api/reports/pricing-analysis/summary', () => Promise.all([
    prisma.product.findMany({
      where,
      select: {
        id: true,
        criticalStock: true,
        purchasePrice: true,
        salePrice: true,
        stock: {
          select: {
            warehouseQuantity: true,
            shelfQuantity: true,
            batches: {
              where: { totalQuantity: { gt: 0 } },
              orderBy: [{ skt: 'asc' }, { batchNo: 'asc' }],
              select: { batchNo: true, skt: true, warehouseQuantity: true, shelfQuantity: true, totalQuantity: true },
            },
          },
        },
      },
    }),
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.supplier.findMany({ select: { id: true, name: true } }),
  ]));
  const now = new Date();
  const totalAnalyzedProducts = products.length;
  let criticalStockProducts = 0;
  let lowStockProducts = 0;
  let sktRiskProducts = 0;
  let nearRunoutProducts = 0;
  let discountSuggestedProducts = 0;
  let overStockProducts = 0;

  products.forEach((product) => {
    const stock = product.stock || {};
    const totalStock = Number(stock.warehouseQuantity || 0) + Number(stock.shelfQuantity || 0);
    const criticalStock = Number(product.criticalStock || 0);
    if (totalStock <= criticalStock) criticalStockProducts += 1;
    if (totalStock <= criticalStock + 5) lowStockProducts += 1;
    if (totalStock > Math.max(criticalStock * 3, 20)) overStockProducts += 1;
    const expiryText = resolveStockBatchesFefo(stock)?.skt || '';
    const expiry = expiryText ? new Date(expiryText) : null;
    if (expiry && Number.isFinite(expiry.getTime())) {
      const days = Math.ceil((expiry.getTime() - now.getTime()) / DAY_MS);
      if (days <= 7) sktRiskProducts += 1;
      if (days <= 10) nearRunoutProducts += 1;
    }
    const purchasePrice = Number(product.purchasePrice || 0);
    const salePrice = Number(product.salePrice || 0);
    if (purchasePrice > 0 && salePrice > 0 && ((salePrice - purchasePrice) / purchasePrice) < 0.12) {
      discountSuggestedProducts += 1;
    }
  });

  const highRiskProducts = criticalStockProducts + sktRiskProducts;
  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    filters: {
      universe: productUniverse,
      analysisDate: toDateOnly(normalizeDate(query.endDate || new Date())),
      startDate: query.startDate || null,
      endDate: query.endDate || null,
    },
    filtersMeta: {
      categories: categories.map((item) => ({ id: item.id, name: item.name })),
      suppliers: suppliers.map((item) => ({ id: item.id, name: item.name })),
    },
    summary: {
      totalAnalyzedProducts,
      discountSuggestedProducts,
      sktRiskProducts,
      nearRunoutProducts,
      orderSuggestedProducts: criticalStockProducts,
      highRiskProducts,
    },
    systemControls: {
      expiringProducts: sktRiskProducts,
      lowStockProducts,
      criticalStockProducts,
      slowSalesProducts: 0,
      overStockProducts,
      fastRunoutProducts: criticalStockProducts,
    },
    actions: [
      { key: 'discount', title: 'İndirim Aksiyonu', value: discountSuggestedProducts, detail: 'Marj ve stok sinyallerine göre özet.' },
      { key: 'order', title: 'Sipariş Aksiyonu', value: criticalStockProducts, detail: 'Kritik stokta olan ürünler.' },
      { key: 'risk', title: 'Kritik Risk', value: highRiskProducts, detail: 'Kritik stok veya SKT riski.' },
    ],
  };
};

const getFastRowsFromPostgres = async (query = {}) => {
  const prisma = await getPrisma();
  const { where } = buildPricingWhere(query);
  const pagination = parsePagePagination(query, { defaultLimit: 20, maxLimit: 200 });
  const [total, products] = await withPostgresQueryLogging('GET /api/reports/pricing-analysis/rows', () => Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: pagination.skip,
      take: pagination.limit,
      select: {
        id: true,
        sku: true,
        name: true,
        categoryId: true,
        supplierId: true,
        purchasePrice: true,
        salePrice: true,
        criticalStock: true,
        updatedAt: true,
        category: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        stock: {
          select: {
            warehouseQuantity: true,
            shelfQuantity: true,
            batches: {
              where: { totalQuantity: { gt: 0 } },
              orderBy: [{ skt: 'asc' }, { batchNo: 'asc' }],
              select: { batchNo: true, skt: true, warehouseQuantity: true, shelfQuantity: true, totalQuantity: true },
            },
          },
        },
        supplierProducts: {
          where: { isActive: { not: false } },
          take: 5,
          select: { id: true, supplierId: true, purchasePrice: true, leadTimeDays: true, isDefault: true },
        },
      },
    }),
  ]));
  const now = new Date();
  const rows = products.map((product) => {
    const stock = product.stock || {};
    const warehouseStock = Number(stock.warehouseQuantity || 0);
    const shelfStock = Number(stock.shelfQuantity || 0);
    const totalStock = warehouseStock + shelfStock;
    const criticalStock = Number(product.criticalStock || 0);
    const expiryText = resolveStockBatchesFefo(stock)?.skt || '';
    const expiryDate = expiryText ? new Date(expiryText) : null;
    const daysToExpiry = expiryDate && Number.isFinite(expiryDate.getTime())
      ? Math.ceil((expiryDate.getTime() - now.getTime()) / DAY_MS)
      : null;
    const sktStatus = getSktStatus(daysToExpiry);
    const bestSupplierOption = getBestSupplierOption(product.supplierProducts || []);
    const risk = riskScoringService.scoreProduct({
      daysToExpiry,
      totalStock,
      criticalStock,
      avgDaily7: 0,
      salesSpeed: 'normal',
      isCriticalStock: totalStock <= criticalStock,
      overStockRatio: 0,
      daysToStockout: null,
    });
    return compactPricingListRow({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      categoryId: product.categoryId,
      categoryName: product.category?.name || '-',
      supplierId: bestSupplierOption?.supplierId || product.supplierId,
      supplierName: product.supplier?.name || '-',
      currentPrice: Number(product.salePrice || 0),
      salePrice: Number(product.salePrice || 0),
      originalPrice: Number(product.salePrice || 0),
      purchasePrice: Number(product.purchasePrice || 0),
      supplierPrice: Number(bestSupplierOption?.purchasePrice || product.purchasePrice || 0),
      criticalStock,
      warehouseStock,
      shelfStock,
      totalStock,
      sold7: 0,
      sold30: 0,
      avgDailySales: 0,
      salesTrend: 'Dengeli',
      trendDirection: 'flat',
      trendRatio: 0,
      salesSpeed: 'normal',
      salesSpeedLabel: 'Normal',
      expiryDate: expiryDate && Number.isFinite(expiryDate.getTime()) ? expiryDate.toISOString() : null,
      expirySource: expiryDate ? 'actual' : 'unknown',
      daysToExpiry,
      sktStatus,
      daysToStockout: null,
      estimatedStockoutDate: null,
      leadTimeDays: Math.max(1, Number(bestSupplierOption?.leadTimeDays || 3)),
      discountSuggestion: { hasSuggestion: false, discountRate: 0 },
      orderSuggestion: { hasSuggestion: totalStock <= criticalStock },
      actionSuggestion: totalStock <= criticalStock ? 'Sipariş önerilir' : 'İzlemede',
      riskScore: risk.score,
      riskLevel: risk.level,
      riskLabel: riskLabel[risk.level],
      riskFactors: risk.factors,
    });
  });
  const filtered = rows
    .filter((row) => !query.riskLevel || row.riskLevel === query.riskLevel)
    .filter((row) => !query.sktStatus || row.sktStatus === query.sktStatus)
    .filter((row) => !query.salesSpeed || row.salesSpeed === query.salesSpeed);
  const { key, rows: sortedRows } = sortRows(filtered, query.sort || 'risk_desc');

  return {
    items: sortedRows,
    pagination: {
      mode: 'offset',
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
      hasNextPage: pagination.skip + products.length < total,
      nextCursor: null,
      cursorVersion: null,
    },
    filters: {
      categoryId: query.categoryId || null,
      supplierId: query.supplierId || null,
      riskLevel: query.riskLevel || query.risk || null,
      sktStatus: query.sktStatus || null,
      salesSpeed: query.salesSpeed || null,
      discountOnly: query.discountOnly || null,
      orderOnly: query.orderOnly || null,
      search: String(query.search || '').trim() || null,
    },
    sort: {
      key,
      direction: key.endsWith('_asc') ? 'asc' : 'desc',
    },
  };
};

const normalizeDate = (value, fallback = new Date()) => {
  const parsed = value ? new Date(value) : fallback;
  if (!Number.isFinite(parsed.getTime())) return fallback;
  return parsed;
};

const toDateOnly = (value) => new Date(value).toISOString().slice(0, 10);

const toNumberValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
};

const fromDateValue = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

const diffDays = (futureDate, baseDate) => {
  if (!futureDate) return null;
  const diff = Math.ceil((futureDate.getTime() - baseDate.getTime()) / DAY_MS);
  return Number.isFinite(diff) ? diff : null;
};

const estimateShelfLifeDays = (productName = '', categoryName = '') => {
  const name = `${productName} ${categoryName}`.toLowerCase();
  if (/sut|yogurt|ayran|krema|peynir|tavuk|et|balik/.test(name)) return 7;
  if (/ekmek|simit|pogaca/.test(name)) return 3;
  if (/meyve|sebze|salata/.test(name)) return 5;
  if (/icecek|su|cola|gazoz|meyve suyu/.test(name)) return 45;
  if (/cikolata|biskuvi|makarna|bakliyat|konserve/.test(name)) return 180;
  return 30;
};

const resolveExpiryDate = (product, categoryName) => {
  const direct = product.expiryDate || product.expiry_date || product.expirationDate || product.sktDate || product.skt || product.bestBeforeDate || null;
  if (direct) {
    const parsed = new Date(direct);
    if (Number.isFinite(parsed.getTime())) {
      return { expiryDate: parsed, source: 'actual' };
    }
  }

  const base = normalizeDate(product.updatedAt || product.createdAt);
  const shelfLife = estimateShelfLifeDays(product.name, categoryName);
  return { expiryDate: new Date(base.getTime() + shelfLife * DAY_MS), source: 'estimated' };
};

const resolveExpiryFromStock = (stock = {}, product = {}, categoryName = '') => {
  const fefoBatch = resolveStockBatchesFefo(stock);
  if (fefoBatch?.skt) {
    const parsed = new Date(fefoBatch.skt);
    if (Number.isFinite(parsed.getTime())) {
      return { expiryDate: parsed, source: 'actual_batch', batchNo: fefoBatch.batchNo };
    }
  }

  const stockExpiry = stock?.fefoDefaultExpiry || stock?.nearestExpiry || null;
  if (stockExpiry) {
    const parsed = new Date(stockExpiry);
    if (Number.isFinite(parsed.getTime())) {
      return { expiryDate: parsed, source: 'actual_stock_summary', batchNo: stock?.fefoDefaultBatchNo || null };
    }
  }

  return { ...resolveExpiryDate(product, categoryName), batchNo: null };
};

const getSktStatus = (daysToExpiry) => {
  if (daysToExpiry === null) return 'unknown';
  if (daysToExpiry <= 3) return 'critical';
  if (daysToExpiry <= 7) return 'soon';
  return 'safe';
};

const getLeadTimeDays = (mappings, productId) => {
  const options = mappings.filter((item) => item.productId === productId && item.isActive !== false);
  if (!options.length) return 3;
  const cheapest = [...options].sort((a, b) => Number(a.purchasePrice || 0) - Number(b.purchasePrice || 0))[0];
  return Math.max(1, Number(cheapest.leadTimeDays || 3));
};

const groupSupplierProductsByProduct = (mappings = []) => {
  const grouped = new Map();
  for (const item of mappings) {
    if (!item?.productId || item.isActive === false) continue;
    const rows = grouped.get(item.productId) || [];
    rows.push(item);
    grouped.set(item.productId, rows);
  }
  return grouped;
};

const getBestSupplierOption = (options = []) => {
  if (!options.length) return null;
  return [...options].sort((left, right) => {
    if (Boolean(right.isDefault) !== Boolean(left.isDefault)) {
      return Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault));
    }
    return Number(left.purchasePrice || 0) - Number(right.purchasePrice || 0);
  })[0];
};

const normalizePriceEvent = (event = {}, product = {}) => {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const at = event.eventDate
    || event.date
    || event.at
    || payload.eventDate
    || payload.date
    || payload.at
    || event.createdAt
    || event.updatedAt
    || null;
  const price = Number(event.salePrice ?? event.newPrice ?? event.price ?? event.currentPrice ?? payload.salePrice ?? payload.newPrice ?? payload.price ?? payload.currentPrice ?? 0);
  const previousPrice = event.previousSalePrice ?? event.previousPrice ?? payload.previousSalePrice ?? payload.previousPrice ?? null;
  return {
    priceEventId: event.priceEventId || event.id || payload.priceEventId || payload.id || null,
    productId: event.productId || payload.productId || product.id || null,
    sku: event.sku || payload.sku || product.sku || null,
    at,
    date: at ? String(at).slice(0, 10) : null,
    price: Number.isFinite(price) ? price : null,
    salePrice: Number.isFinite(price) ? price : null,
    newPrice: Number.isFinite(price) ? price : null,
    previousPrice: previousPrice === null || previousPrice === undefined ? null : Number(previousPrice),
    previousSalePrice: previousPrice === null || previousPrice === undefined ? null : Number(previousPrice),
    changeDirection: event.changeDirection || payload.changeDirection || null,
    changePercent: Number(event.changePercent ?? payload.changePercent ?? 0),
    currency: event.currency || payload.currency || 'TRY',
    source: event.source || payload.source || '',
    createdAt: event.createdAt || at,
  };
};

const getProductPriceEventRows = (product = {}) => {
  const payload = product?.payload && typeof product.payload === 'object' ? product.payload : {};
  const relationRows = Array.isArray(product.priceEvents) ? product.priceEvents : [];
  if (relationRows.length > 0) return relationRows;
  return [
    ...(Array.isArray(payload.priceEvents) ? payload.priceEvents : []),
    ...(Array.isArray(product.priceHistory) ? product.priceHistory : []),
    ...(Array.isArray(payload.priceHistory) ? payload.priceHistory : []),
  ];
};

const normalizePriceHistory = (product = {}) => {
  const rows = getProductPriceEventRows(product);
  const seen = new Set();
  return rows
    .map((event) => normalizePriceEvent(event, product))
    .filter((event) => isRealPriceEventSource(event.source))
    .filter((event) => event.date && Number.isFinite(event.price))
    .filter((event) => Number.isFinite(Number(event.previousPrice)) && !pricesEqual(event.previousPrice, event.price))
    .filter((event) => {
      const key = `${event.priceEventId || ''}:${event.productId || ''}:${event.at}:${event.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
};

const buildPriceHistoryMetrics = (product = {}) => {
  const history = normalizePriceHistory(product);
  const latest = history[history.length - 1] || null;
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const latestPrice = Number(latest?.price ?? product.salePrice ?? 0);
  const previousPrice = Number(previous?.price ?? latest?.previousPrice ?? product.purchasePrice ?? 0);
  const changePercent = Number.isFinite(previousPrice) && previousPrice > 0 && Number.isFinite(latestPrice)
    ? Number((((latestPrice - previousPrice) / previousPrice) * 100).toFixed(2))
    : 0;

  return {
    priceHistory: history.slice(-12),
    priceHistoryCount: Number(product.priceEventsCount || 0) || history.length,
    lastPrice: Number.isFinite(latestPrice) ? latestPrice : Number(product.salePrice || 0),
    previousPrice: Number.isFinite(previousPrice) ? previousPrice : null,
    priceChangePercent: changePercent,
    lastPriceChangeAt: latest?.at || null,
    lastPriceChangeDate: latest?.date || null,
    priceTrend: latest?.changeDirection || (changePercent > 0 ? 'increase' : changePercent < 0 ? 'decrease' : 'stable'),
    priceHistorySource: latest?.source || product.lastPriceChangeSource || '',
  };
};

const mapPostgresPriceEvent = (event = {}) => ({
  ...(event.payload && typeof event.payload === 'object' ? event.payload : {}),
  id: event.id,
  priceEventId: event.id,
  productId: event.productId,
  previousSalePrice: toNumberValue(event.previousSalePrice),
  previousPrice: toNumberValue(event.previousSalePrice),
  salePrice: toNumberValue(event.salePrice),
  price: toNumberValue(event.salePrice),
  newPrice: toNumberValue(event.salePrice),
  source: event.source || '',
  createdAt: fromDateValue(event.createdAt),
  at: fromDateValue(event.createdAt),
  eventDate: fromDateValue(event.createdAt),
});

const mapPostgresProduct = (product = {}) => ({
  ...omitLegacyBatchPayload(product.payload),
  ...product,
  purchasePrice: toNumberValue(product.purchasePrice) || 0,
  salePrice: toNumberValue(product.salePrice) || 0,
  averageDesi: toNumberValue(product.averageDesi) || 0,
  createdAt: fromDateValue(product.createdAt),
  updatedAt: fromDateValue(product.updatedAt),
  priceUpdatedAt: fromDateValue(product.priceUpdatedAt),
  lastPriceChangeDate: fromDateValue(product.lastPriceChangeDate),
  lastPriceChangeAt: fromDateValue(product.lastPriceChangeAt),
  lastPriceChangeSource: product.lastPriceChangeSource || null,
  priceEventsCount: Number(product._count?.priceEvents || product.priceEventsCount || 0),
  priceEvents: Array.isArray(product.priceEvents) ? product.priceEvents.map(mapPostgresPriceEvent) : [],
});

const mapPostgresStock = (stock = {}, productId) => {
  if (!stock) return null;
  const fefoBatch = resolveStockBatchesFefo(stock);
  return {
    productId: stock.productId || productId,
    warehouseQuantity: Number(stock.warehouseQuantity || 0),
    shelfQuantity: Number(stock.shelfQuantity || 0),
    onHand: Number(stock.onHand || 0),
    available: Number(stock.available || 0),
    reserved: Number(stock.reserved || 0),
    nearestExpiry: fefoBatch?.skt || null,
    fefoDefaultBatchNo: fefoBatch?.batchNo || null,
    fefoDefaultExpiry: fefoBatch?.skt || null,
    batchCount: Number(stock.batchCount || 0),
    batches: normalizePricingBatches(stock),
  };
};

const mapPostgresSupplierProduct = (row = {}) => ({
  ...(row.payload && typeof row.payload === 'object' ? row.payload : {}),
  ...row,
  purchasePrice: toNumberValue(row.purchasePrice) || 0,
  createdAt: fromDateValue(row.createdAt),
  updatedAt: fromDateValue(row.updatedAt),
});

const mapPostgresSale = (sale = {}) => ({
  id: sale.id,
  referenceNo: sale.referenceNo,
  type: sale.type,
  createdAt: fromDateValue(sale.createdAt),
  items: Array.isArray(sale.saleItems) && sale.saleItems.length
    ? sale.saleItems.map((item) => ({
      ...(item.payload && typeof item.payload === 'object' ? item.payload : {}),
      id: item.id,
      saleId: item.saleId,
      productId: item.productId,
      barcode: item.barcode,
      name: item.name,
      productName: item.name,
      sku: item.sku,
      quantity: Number(item.quantity || 0),
      unitPrice: toNumberValue(item.unitPrice) || 0,
      totalPrice: toNumberValue(item.totalPrice) || 0,
      vatRate: toNumberValue(item.vatRate) || 0,
    }))
    : (Array.isArray(sale.items) ? sale.items : []),
});

const mapPostgresPriceEventRows = (rows = []) => {
  const byProduct = new Map();
  const counts = new Map();

  for (const row of rows) {
    const productId = row.productId || row.product_id;
    if (!productId) continue;

    const event = {
      id: row.id,
      productId,
      previousSalePrice: row.previousSalePrice ?? row.previous_sale_price ?? null,
      salePrice: row.salePrice ?? row.sale_price ?? null,
      source: row.source || '',
      payload: row.payload || null,
      createdAt: row.createdAt ?? row.created_at ?? null,
    };
    const productRows = byProduct.get(productId) || [];
    productRows.push(event);
    byProduct.set(productId, productRows);
    counts.set(productId, Number(row.priceEventsCount ?? row.price_events_count ?? 0));
  }

  return { byProduct, counts };
};

const compactDiscountSuggestion = (suggestion = {}) => ({
  hasSuggestion: Boolean(suggestion.hasSuggestion),
  discountRate: Number(suggestion.discountRate || 0),
  newPrice: Number(suggestion.newPrice || 0),
});

const buildSaleWhere = (query = {}) => {
  const where = { type: { in: ['sale', 'return'] } };
  const startDate = query.startDate ? normalizeDate(query.startDate, null) : null;
  const endDate = query.endDate ? normalizeDate(query.endDate, null) : normalizeDate(new Date(), null);
  const effectiveStartDate = startDate || (endDate ? new Date(endDate.getTime() - (SALES_LOOKBACK_DAYS - 1) * DAY_MS) : null);

  if (effectiveStartDate || endDate) where.createdAt = {};
  if (effectiveStartDate) {
    effectiveStartDate.setHours(0, 0, 0, 0);
    where.createdAt.gte = effectiveStartDate;
  }
  if (endDate) {
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    where.createdAt.lte = endOfDay;
  }
  return where;
};

const resolveAnalysisUniverse = (query = {}) => (
  normalizeProductUniverse(query.universe, PRODUCT_UNIVERSES.LISTED_ACTIVE)
  || PRODUCT_UNIVERSES.LISTED_ACTIVE
);

const getAnalysisInputs = async (query = {}) => {
  const productUniverse = resolveAnalysisUniverse(query);

  if (config.dataStore !== 'postgres') {
    const [products, categories, suppliers, stocks, sales, supplierProducts] = await Promise.all([
      productRepo.getAll(),
      categoryRepo.getAll(),
      supplierRepo.getAll(),
      stockRepo.getAll(),
      salesRepo.getAll(),
      supplierProductRepo.getAll(),
    ]);
    return {
      products: products.filter((product) => matchesProductUniverse(product, productUniverse)),
      categories,
      suppliers,
      stocks,
      sales,
      supplierProducts,
      productUniverse,
    };
  }

  const prisma = await getPrisma();
  const [productsRaw, categories, suppliers, salesRaw, priceEventsRaw] = await withPostgresQueryLogging('GET /api/reports/pricing-analysis', () => Promise.all([
    prisma.product.findMany({
      where: buildProductUniverseWhere(productUniverse),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        brand: true,
        categoryId: true,
        supplierId: true,
        purchasePrice: true,
        salePrice: true,
        criticalStock: true,
        maxStock: true,
        maxShelfStock: true,
        isActive: true,
        isListed: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
        priceUpdatedAt: true,
        lastPriceChangeDate: true,
        lastPriceChangeAt: true,
        lastPriceChangeSource: true,
        priceEvents: {
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: {
            id: true,
            productId: true,
            previousSalePrice: true,
            salePrice: true,
            source: true,
            payload: true,
            createdAt: true,
          },
        },
        _count: { select: { priceEvents: true } },
        stock: {
          select: {
            productId: true,
            warehouseQuantity: true,
            shelfQuantity: true,
            onHand: true,
            available: true,
            reserved: true,
            nearestExpiry: true,
            fefoDefaultBatchNo: true,
            fefoDefaultExpiry: true,
            batchCount: true,
            batches: {
              where: { totalQuantity: { gt: 0 } },
              orderBy: [{ skt: 'asc' }, { batchNo: 'asc' }],
              select: {
                batchNo: true,
                skt: true,
                warehouseQuantity: true,
                shelfQuantity: true,
                totalQuantity: true,
              },
            },
          },
        },
        supplierProducts: {
          where: { isActive: { not: false } },
          select: {
            id: true,
            productId: true,
            supplierId: true,
            purchasePrice: true,
            priceUnit: true,
            minOrderUnit: true,
            defaultOrderUnit: true,
            minimumOrderQty: true,
            minOrderQty: true,
            unitsPerCase: true,
            casesPerPallet: true,
            leadTimeDays: true,
            isDefault: true,
            isActive: true,
            payload: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.supplier.findMany({ select: { id: true, name: true } }),
    prisma.sale.findMany({
      where: buildSaleWhere(query),
      select: {
        id: true,
        referenceNo: true,
        type: true,
        createdAt: true,
        saleItems: {
          select: {
            id: true,
            saleId: true,
            productId: true,
            barcode: true,
            name: true,
            sku: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            vatRate: true,
            payload: true,
          },
        },
      },
    }),
    prisma.$queryRaw`
      WITH ranked_events AS (
        SELECT
          id,
          product_id AS "productId",
          previous_sale_price AS "previousSalePrice",
          sale_price AS "salePrice",
          source,
          payload,
          created_at AS "createdAt",
          COUNT(*) OVER (PARTITION BY product_id) AS "priceEventsCount",
          ROW_NUMBER() OVER (
            PARTITION BY product_id
            ORDER BY created_at DESC NULLS LAST, id DESC
          ) AS rn
        FROM product_price_events
      )
      SELECT
        id,
        "productId",
        "previousSalePrice",
        "salePrice",
        source,
        payload,
        "createdAt",
        "priceEventsCount"
      FROM ranked_events
      WHERE rn <= 2
      ORDER BY "productId", "createdAt" ASC NULLS LAST, id ASC
    `,
  ]));

  const { byProduct: priceEventsByProduct, counts: priceEventCounts } = mapPostgresPriceEventRows(priceEventsRaw);
  const products = productsRaw.map((product) => mapPostgresProduct({
    ...product,
    priceEvents: priceEventsByProduct.get(product.id) || [],
    priceEventsCount: priceEventCounts.get(product.id) || 0,
  }));
  const stocks = productsRaw.map((product) => mapPostgresStock(product.stock, product.id)).filter(Boolean);
  const supplierProducts = productsRaw.flatMap((product) => (
    Array.isArray(product.supplierProducts) ? product.supplierProducts.map(mapPostgresSupplierProduct) : []
  ));
  const sales = salesRaw.map(mapPostgresSale);
  return { products, categories, suppliers, stocks, sales, supplierProducts, productUniverse };
};

const buildLast14DailySalesMap = (sales = [], analysisDate) => {
  const end = new Date(`${analysisDate}T23:59:59.999Z`);
  const start = new Date(end.getTime() - 13 * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);
  const dayKeys = [];

  for (let index = 0; index < 14; index += 1) {
    const day = new Date(start.getTime() + index * DAY_MS);
    dayKeys.push(toDateOnly(day));
  }

  const productDailyTotals = new Map();
  for (const record of sales) {
    const createdAt = normalizeDate(record.createdAt, null);
    if (!createdAt || createdAt < start || createdAt > end) continue;
    const sign = record.type === 'return' ? -1 : 1;
    const dayKey = toDateOnly(createdAt);
    for (const item of Array.isArray(record.items) ? record.items : []) {
      const productId = item?.productId;
      if (!productId || productId === '__bag__') continue;
      const qty = Number(item.quantity || 0) * sign;
      if (!Number.isFinite(qty) || qty === 0) continue;

      const totals = productDailyTotals.get(productId) || new Map(dayKeys.map((key) => [key, 0]));
      totals.set(dayKey, Math.max(0, (totals.get(dayKey) || 0) + qty));
      productDailyTotals.set(productId, totals);
    }
  }

  const result = new Map();
  for (const [productId, totals] of productDailyTotals.entries()) {
    result.set(productId, dayKeys.map((dayKey) => Number((totals.get(dayKey) || 0).toFixed(2))));
  }

  return result;
};

const matchesSearch = (row, searchTerm) => {
  if (!searchTerm) return true;
  const hay = [row.productName, row.sku, row.categoryName, row.supplierName, row.actionSuggestion]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(searchTerm.toLowerCase());
};

const SORTERS = {
  risk_desc: (a, b) => Number(b.riskScore || 0) - Number(a.riskScore || 0),
  risk_asc: (a, b) => Number(a.riskScore || 0) - Number(b.riskScore || 0),
  product_asc: (a, b) => String(a.productName || '').localeCompare(String(b.productName || ''), 'tr') || String(a.productId || '').localeCompare(String(b.productId || '')),
  product_desc: (a, b) => String(b.productName || '').localeCompare(String(a.productName || ''), 'tr') || String(b.productId || '').localeCompare(String(a.productId || '')),
  stock_asc: (a, b) => Number(a.totalStock || 0) - Number(b.totalStock || 0),
  stock_desc: (a, b) => Number(b.totalStock || 0) - Number(a.totalStock || 0),
  price_asc: (a, b) => Number(a.currentPrice || 0) - Number(b.currentPrice || 0),
  price_desc: (a, b) => Number(b.currentPrice || 0) - Number(a.currentPrice || 0),
  expiry_asc: (a, b) => Number(a.daysToExpiry ?? 999999) - Number(b.daysToExpiry ?? 999999),
};

const sortRows = (rows, sortKey = 'risk_desc') => {
  const key = resolveWhitelistedSort(sortKey, Object.keys(SORTERS), 'risk_desc', { context: 'GET /api/reports/pricing-analysis/rows' });
  return { key, rows: [...rows].sort(SORTERS[key]) };
};

const paginateRows = (rows, query = {}) => {
  const pagination = parsePagePagination(query, { defaultLimit: 20, maxLimit: 200 });
  const pageRows = rows.slice(pagination.skip, pagination.skip + pagination.limit);
  const total = rows.length;
  return {
    pageRows,
    pagination: {
      mode: 'offset',
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
      hasNextPage: pagination.skip + pageRows.length < total,
      nextCursor: null,
      cursorVersion: null,
    },
  };
};

const compactAnalysisRow = (row = {}) => ({
  productId: row.productId,
  id: row.productId,
  sku: row.sku,
  productName: row.productName,
  categoryId: row.categoryId,
  categoryName: row.categoryName,
  supplierId: row.supplierId,
  supplierName: row.supplierName,
  currentPrice: row.currentPrice,
  salePrice: row.salePrice,
  originalPrice: row.originalPrice,
  discountedPrice: row.discountedPrice,
  hasActiveDiscount: row.hasActiveDiscount,
  activeCampaign: row.activeCampaign,
  activeCampaigns: row.activeCampaigns,
  campaignInfo: row.campaignInfo,
  campaignBadge: row.campaignBadge,
  campaignIds: row.campaignIds,
  campaignCount: row.campaignCount,
  purchasePrice: row.purchasePrice,
  supplierPrice: row.supplierPrice,
  supplierPriceUnit: row.supplierPriceUnit,
  supplierLastPriceUpdate: row.supplierLastPriceUpdate,
  priceHistoryCount: row.priceHistoryCount,
  lastPrice: row.lastPrice,
  previousPrice: row.previousPrice,
  priceChangePercent: row.priceChangePercent,
  lastPriceChangeAt: row.lastPriceChangeAt,
  lastPriceChangeDate: row.lastPriceChangeDate,
  priceTrend: row.priceTrend,
  priceHistorySource: row.priceHistorySource,
  criticalStock: row.criticalStock,
  warehouseStock: row.warehouseStock,
  shelfStock: row.shelfStock,
  totalStock: row.totalStock,
  sold7: row.sold7,
  sold30: row.sold30,
  avgDailySales: row.avgDailySales,
  salesTrendLast14Days: row.salesTrendLast14Days,
  salesTrend: row.salesTrend,
  trendDirection: row.trendDirection,
  trendRatio: row.trendRatio,
  salesSpeed: row.salesSpeed,
  salesSpeedLabel: row.salesSpeedLabel,
  expiryDate: row.expiryDate,
  expirySource: row.expirySource,
  expiryBatchNo: row.expiryBatchNo,
  daysToExpiry: row.daysToExpiry,
  sktStatus: row.sktStatus,
  daysToStockout: row.daysToStockout,
  estimatedStockoutDate: row.estimatedStockoutDate,
  leadTimeDays: row.leadTimeDays,
  discountSuggestion: compactDiscountSuggestion(row.discountSuggestion),
  orderSuggestion: row.orderSuggestion,
  actionSuggestion: row.actionSuggestion,
  riskScore: row.riskScore,
  riskLevel: row.riskLevel,
  riskLabel: row.riskLabel,
});

const compactPricingListRow = (row = {}) => {
  const compact = compactAnalysisRow(row);
  const cost = Number(compact.purchasePrice ?? compact.supplierPrice ?? 0);
  const currentPrice = Number(compact.currentPrice ?? compact.salePrice ?? 0);
  const margin = currentPrice > 0 ? Number((((currentPrice - cost) / currentPrice) * 100).toFixed(2)) : 0;

  return {
    productId: compact.productId,
    id: compact.productId,
    sku: compact.sku,
    name: compact.productName,
    productName: compact.productName,
    categoryId: compact.categoryId,
    categoryName: compact.categoryName,
    tag: compact.categoryName,
    supplierId: compact.supplierId,
    supplierName: compact.supplierName,
    currentPrice,
    salePrice: compact.salePrice,
    cost,
    purchasePrice: compact.purchasePrice,
    margin,
    currentMarginPercent: margin,
    criticalStock: compact.criticalStock,
    warehouseStock: compact.warehouseStock,
    shelfStock: compact.shelfStock,
    totalStock: compact.totalStock,
    salesSpeed: compact.salesSpeed,
    salesSpeedLabel: compact.salesSpeedLabel,
    daysToExpiry: compact.daysToExpiry,
    sktStatus: compact.sktStatus,
    daysToStockout: compact.daysToStockout,
    discountSuggestion: compact.discountSuggestion,
    orderSuggestion: compact.orderSuggestion,
    recommendationSummary: compact.actionSuggestion,
    actionSuggestion: compact.actionSuggestion,
    riskScore: compact.riskScore,
    riskLevel: compact.riskLevel,
    riskLabel: compact.riskLabel,
  };
};

const isExplicitFullAnalysisRequest = (query = {}) => (
  query.full === true
  || query.full === 'true'
  || query.export === true
  || query.export === 'true'
);

const buildPaginatedAnalysisFromPostgres = async (query = {}) => {
  const [summaryPayload, rowsPayload] = await Promise.all([
    getFastSummaryFromPostgres(query),
    getFastRowsFromPostgres(query),
  ]);
  const rows = Array.isArray(rowsPayload.items) ? rowsPayload.items : [];
  const pagination = rowsPayload.pagination || {};

  return {
    ...summaryPayload,
    items: rows,
    rows,
    total: pagination.total ?? rows.length,
    page: pagination.page ?? 1,
    limit: pagination.limit ?? rows.length,
    sections: {
      fastSellingProducts: rows.filter((row) => row.salesSpeed === 'fast').slice(0, 20),
      slowAndExpiryRiskProducts: rows
        .filter((row) => row.salesSpeed === 'slow' || ['critical', 'soon'].includes(row.sktStatus))
        .slice(0, 40),
      dynamicDiscountSuggestions: rows.filter((row) => row.discountSuggestion?.hasSuggestion).slice(0, 40),
      stockRunoutAnalysis: rows.filter((row) => row.daysToStockout !== null && row.daysToStockout !== undefined).slice(0, 40),
      automaticOrderSuggestions: rows.filter((row) => row.orderSuggestion?.hasSuggestion).slice(0, 40),
      salesPattern: [],
      riskScorePanel: rows.slice(0, 50),
    },
    pagination,
    meta: {
      pagination,
      filters: rowsPayload.filters,
      sort: rowsPayload.sort,
      listMode: 'paginated',
    },
    rowMeta: {
      pagination,
      filters: rowsPayload.filters,
      sort: rowsPayload.sort,
    },
  };
};

const trendLabel = {
  up: 'Yukseliyor',
  down: 'Dusuyor',
  flat: 'Dengeli',
};

const riskLabel = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
};

const normalizeStorageForPricing = (product = {}, category = {}) => {
  const raw = String(product.requiredStorageType || product.storageType || category?.mainStorageType || '').toLocaleLowerCase('tr-TR');
  if (category?.requiresFreezer || raw.includes('freezer') || raw.includes('frozen') || raw.includes('donuk') || raw.includes('dondur')) return 'frozen';
  if (category?.requiresColdChain || raw.includes('cold') || raw.includes('soğuk') || raw.includes('soguk')) return 'cold';
  return 'ambient';
};

const getUnitMultiplierForPricing = (unit = 'adet', product = {}, supplierProduct = {}) => {
  const normalized = String(unit || 'adet').toLocaleLowerCase('tr-TR');
  const unitsPerCase = Math.max(1, Number(supplierProduct.unitsPerCase || product.unitsPerCase || 1));
  const casesPerPallet = Math.max(1, Number(supplierProduct.casesPerPallet || product.casesPerPallet || 1));
  const unitsPerPallet = Math.max(1, Number(product.unitsPerPallet || unitsPerCase * casesPerPallet));
  if (normalized.includes('koli') || normalized.includes('kasa') || normalized.includes('çuval') || normalized.includes('cuval')) return unitsPerCase;
  if (normalized.includes('palet')) return unitsPerPallet;
  return 1;
};

const resolvePurchaseCostPerBaseUnit = (product = {}, supplierProduct = null) => {
  const source = supplierProduct || product;
  const purchasePrice = Number(source?.purchasePrice || product.purchasePrice || 0);
  const multiplier = getUnitMultiplierForPricing(source?.priceUnit || 'adet', product, supplierProduct || {});
  return multiplier > 0 ? Number((purchasePrice / multiplier).toFixed(4)) : purchasePrice;
};

const CONTROLLED_PRICING_POLICY = {
  targetMarginPct: 22,
  commissionRatePct: 0,
  defaultVatRatePct: 20,
  operationalCostRatesPct: { ambient: 1.6, cold: 2.4, frozen: 3.1 },
  handlingCostPerCase: { ambient: 12, cold: 16, frozen: 20 },
  spoilageRiskRatesPct: { ambient: 0.4, cold: 1.2, frozen: 1.8 },
  expiryRiskMultipliers: [
    { maxDays: 7, multiplier: 3 },
    { maxDays: 14, multiplier: 2.25 },
    { maxDays: 30, multiplier: 1.5 },
    { maxDays: 60, multiplier: 1.15 },
  ],
  allowedPriceCents: [0, 25, 50, 75, 90, 95, 99],
};

const clampPct = (value, fallback = CONTROLLED_PRICING_POLICY.targetMarginPct) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(70, numeric));
};

const resolvePolicyNumber = (settings = {}, path = [], fallback) => {
  let cursor = settings.priceRecommendationPolicy && typeof settings.priceRecommendationPolicy === 'object'
    ? settings.priceRecommendationPolicy
    : {};
  for (const segment of path) {
    cursor = cursor?.[segment];
  }
  const numeric = Number(cursor);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const resolveVatRate = (product = {}, category = {}, settings = {}) => {
  const direct = Number(product.vatRate ?? product.taxRate ?? category?.vatRate ?? category?.taxRate);
  if (Number.isFinite(direct) && direct >= 0) {
    return { value: direct, source: 'product_or_category_tax_rate' };
  }
  const policyVat = resolvePolicyNumber(settings, ['defaultVatRatePct'], CONTROLLED_PRICING_POLICY.defaultVatRatePct);
  return { value: policyVat, source: settings.priceRecommendationPolicy?.defaultVatRatePct !== undefined ? 'settings_price_recommendation_policy' : 'controlled_default_policy' };
};

const resolvePricingPolicy = ({ product = {}, category = {}, storageType = 'ambient', targetMarginPct, settings = {} }) => {
  const policy = settings.priceRecommendationPolicy && typeof settings.priceRecommendationPolicy === 'object'
    ? settings.priceRecommendationPolicy
    : {};
  const storageRates = policy.operationalCostRatesPct || {};
  const handlingCosts = policy.handlingCostPerCase || {};
  const riskRates = policy.spoilageRiskRatesPct || {};
  const vatRate = resolveVatRate(product, category, settings);
  return {
    targetMarginPct: clampPct(targetMarginPct, resolvePolicyNumber(settings, ['targetMarginPct'], CONTROLLED_PRICING_POLICY.targetMarginPct)),
    vatRatePct: vatRate.value,
    vatRateSource: vatRate.source,
    commissionRatePct: resolvePolicyNumber(settings, ['commissionRatePct'], CONTROLLED_PRICING_POLICY.commissionRatePct),
    operationalCostRatePct: Number(storageRates[storageType] ?? CONTROLLED_PRICING_POLICY.operationalCostRatesPct[storageType] ?? CONTROLLED_PRICING_POLICY.operationalCostRatesPct.ambient),
    handlingCostPerCase: Number(handlingCosts[storageType] ?? CONTROLLED_PRICING_POLICY.handlingCostPerCase[storageType] ?? CONTROLLED_PRICING_POLICY.handlingCostPerCase.ambient),
    spoilageRiskRatePct: Number(riskRates[storageType] ?? CONTROLLED_PRICING_POLICY.spoilageRiskRatesPct[storageType] ?? CONTROLLED_PRICING_POLICY.spoilageRiskRatesPct.ambient),
    policySource: policy && Object.keys(policy).length ? 'settings.priceRecommendationPolicy' : 'controlled_default_policy',
  };
};

const roundShelfPrice = (value, allowedCents = CONTROLLED_PRICING_POLICY.allowedPriceCents) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const base = Math.floor(numeric);
  const cents = Math.ceil((numeric - base) * 100);
  const safeAllowed = Array.isArray(allowedCents) && allowedCents.length ? allowedCents : CONTROLLED_PRICING_POLICY.allowedPriceCents;
  const nextCent = safeAllowed.find((candidate) => candidate >= cents);
  if (nextCent !== undefined) return Number((base + (nextCent / 100)).toFixed(2));
  return Number((base + 1 + (safeAllowed[0] / 100)).toFixed(2));
};

const normalizePricingBatches = (stock = {}) => {
  const rows = Array.isArray(stock?.batches) ? stock.batches : [];
  return rows
    .map((batch) => ({
      batchNo: String(batch?.batchNo || '').trim(),
      skt: String(batch?.skt || '').trim(),
      totalQuantity: Number(batch?.totalQuantity ?? (Number(batch?.warehouseQuantity || 0) + Number(batch?.shelfQuantity || 0)) ?? 0),
    }))
    .filter((batch) => batch.totalQuantity > 0);
};

const resolveExpiryRisk = ({ stock = {}, storageType = 'ambient', baseRiskRatePct = 0 }) => {
  const batches = normalizePricingBatches(stock);
  const nearest = batches
    .filter((batch) => batch.skt && Number.isFinite(new Date(batch.skt).getTime()))
    .sort((left, right) => String(left.skt).localeCompare(String(right.skt)))[0] || null;
  const nearestExpiry = nearest?.skt || null;
  const daysToExpiry = nearestExpiry ? diffDays(new Date(nearestExpiry), new Date()) : null;
  const multiplierRow = Number.isFinite(daysToExpiry)
    ? CONTROLLED_PRICING_POLICY.expiryRiskMultipliers.find((row) => daysToExpiry <= row.maxDays)
    : null;
  const storageFloor = storageType === 'frozen' ? 1.15 : storageType === 'cold' ? 1.1 : 1;
  const multiplier = Math.max(storageFloor, Number(multiplierRow?.multiplier || 1));
  const resolvedRatePct = Number((Number(baseRiskRatePct || 0) * multiplier).toFixed(4));
  return {
    nearestExpiry,
    fefoBatchNo: nearest?.batchNo || null,
    daysToExpiry,
    batchCount: batches.length || Number(stock?.batchCount || 0),
    source: batches.length ? 'stock_batches_fefo' : 'storage_type_policy',
    baseRiskRatePct,
    expiryMultiplier: multiplier,
    resolvedRiskRatePct: resolvedRatePct,
  };
};

const buildCostComponent = ({ key, label, amount, source, details = '' }) => ({
  key,
  label,
  amount: Number(Number(amount || 0).toFixed(4)),
  source,
  details,
});

const getPricingProductContext = async (productId) => {
  const id = String(productId || '').trim();
  if (!id) throw new AppError(400, 'productId zorunludur');

  if (config.dataStore === 'postgres') {
    const prisma = await getPrisma();
    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        categoryId: true,
        purchasePrice: true,
        salePrice: true,
        unitsPerCase: true,
        casesPerPallet: true,
        unitsPerPallet: true,
        requiredStorageType: true,
        isListed: true,
        isActive: true,
        payload: true,
        supplier: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, mainStorageType: true, requiresColdChain: true, requiresFreezer: true } },
        stock: {
          select: {
            warehouseQuantity: true,
            shelfQuantity: true,
            batchCount: true,
            batches: {
              select: {
                batchNo: true,
                skt: true,
                warehouseQuantity: true,
                shelfQuantity: true,
                totalQuantity: true,
              },
            },
          },
        },
        priceEvents: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, productId: true, previousSalePrice: true, salePrice: true, source: true, payload: true, createdAt: true },
        },
        supplierProducts: {
          where: { isActive: { not: false } },
          select: {
            id: true,
            productId: true,
            supplierId: true,
            purchasePrice: true,
            priceUnit: true,
            minOrderUnit: true,
            defaultOrderUnit: true,
            minimumOrderQty: true,
            minOrderQty: true,
            unitsPerCase: true,
            casesPerPallet: true,
            leadTimeDays: true,
            isDefault: true,
            supplier: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!product) throw createNotFoundError('Ürün bulunamadı');
    return {
      product: mapPostgresProduct(product),
      category: product.category || null,
      stock: product.stock ? {
        productId: product.id,
        warehouseQuantity: Number(product.stock.warehouseQuantity || 0),
        shelfQuantity: Number(product.stock.shelfQuantity || 0),
        nearestExpiry: resolveStockBatchesFefo(product.stock)?.skt || null,
        fefoDefaultBatchNo: resolveStockBatchesFefo(product.stock)?.batchNo || null,
        fefoDefaultExpiry: resolveStockBatchesFefo(product.stock)?.skt || null,
        batchCount: Number(product.stock.batchCount || 0),
        batches: Array.isArray(product.stock.batches) ? product.stock.batches.map((batch) => ({
          batchNo: batch.batchNo || '',
          skt: batch.skt || '',
          warehouseQuantity: Number(batch.warehouseQuantity || 0),
          shelfQuantity: Number(batch.shelfQuantity || 0),
          totalQuantity: Number(batch.totalQuantity || 0),
        })) : [],
      } : null,
      supplierProducts: product.supplierProducts.map(mapPostgresSupplierProduct),
      suppliers: [
        product.supplier,
        ...product.supplierProducts.map((item) => item.supplier),
      ].filter(Boolean),
    };
  }

  const [product, categories, supplierProducts, suppliers, stock] = await Promise.all([
    productRepo.findById(id),
    categoryRepo.getAll(),
    supplierProductRepo.getAll(),
    supplierRepo.getAll(),
    stockRepo.findByProductId(id),
  ]);
  if (!product) throw createNotFoundError('Ürün bulunamadı');
  return {
    product,
    category: categories.find((item) => item.id === product.categoryId) || null,
    stock,
    supplierProducts: supplierProducts.filter((item) => item.productId === id && item.isActive !== false),
    suppliers,
  };
};

const buildSellPriceCalculation = async ({ productId, targetMarginPct, supplierProductId } = {}) => {
  const { product, category, stock, supplierProducts, suppliers } = await getPricingProductContext(productId);
  if (product.isListed === false || product.isActive === false) {
    throw new AppError(400, 'Ne Kadara Satmalıyım hesabı yalnızca listed aktif ürünler için yapılabilir');
  }

  const selectedSupplierProductId = String(supplierProductId || '').trim();
  const selectedSupplierOption = selectedSupplierProductId
    ? supplierProducts.find((item) => String(item.id) === selectedSupplierProductId)
    : null;
  if (selectedSupplierProductId && !selectedSupplierOption) {
    throw new AppError(404, 'Seçili tedarikçi-ürün eşleşmesi bulunamadı');
  }
  const supplierOption = selectedSupplierOption || getBestSupplierOption(supplierProducts);
  const supplier = suppliers.find((item) => item.id === (supplierOption?.supplierId || product.supplierId)) || null;
  const unitsPerCase = Math.max(1, Number(supplierOption?.unitsPerCase || product.unitsPerCase || 1));
  const procurementCaseQty = Math.max(1, Number(
    supplierOption?.minimumOrderQty
    || supplierOption?.minOrderQty
    || product.minimumOrderCaseQty
    || 1
  ));
  const purchaseCost = resolvePurchaseCostPerBaseUnit(product, supplierOption);
  if (!Number.isFinite(purchaseCost) || purchaseCost <= 0) {
    throw new AppError(400, 'Bu ürün için geçerli alış fiyatı bulunamadı');
  }

  const storageType = normalizeStorageForPricing(product, category);
  const cargoTypeCode = storageType === 'frozen' ? 'frozen_chain' : storageType === 'cold' ? 'cold_chain' : 'standard_intercity';
  const settings = await settingsRepo.getSettings();
  const normalizedTariffs = logisticsTariffService.normalizeTariffs(settings.logisticsTariffs || []);
  let logisticsQuote = null;
  let logisticsSource = 'settings.logisticsTariffs';
  try {
    logisticsQuote = logisticsTariffService.calculateQuote({
      rows: normalizedTariffs,
      cargoTypeCode,
      caseQty: procurementCaseQty,
      storageType,
      distanceType: 'intercity',
    });
  } catch (error) {
    const compatible = logisticsTariffService.filterTariffsForSelection(normalizedTariffs, { storageType, distanceType: 'intercity' })[0];
    if (!compatible) throw error;
    logisticsQuote = logisticsTariffService.calculateQuote({
      rows: normalizedTariffs,
      cargoTypeCode: compatible.cargoTypeCode,
      caseQty: procurementCaseQty,
      storageType,
      distanceType: compatible.distanceType,
      isInternalTransfer: compatible.isInternalTransfer === true,
    });
    logisticsSource = 'settings.logisticsTariffs.compatible_fallback';
  }
  const logisticsUnits = Math.max(1, procurementCaseQty * unitsPerCase);
  const logisticsCostPerUnit = Number((Number(logisticsQuote.totalPriceTl || 0) / logisticsUnits).toFixed(4));
  const policy = resolvePricingPolicy({ product, category, storageType, targetMarginPct, settings });
  const operationalRateCost = purchaseCost * (policy.operationalCostRatePct / 100);
  const handlingCost = Number((policy.handlingCostPerCase / unitsPerCase).toFixed(4));
  const operationalCost = Number((operationalRateCost + handlingCost).toFixed(4));
  const expiryRisk = resolveExpiryRisk({ stock, storageType, baseRiskRatePct: policy.spoilageRiskRatePct });
  const spoilageRiskCost = Number((purchaseCost * (expiryRisk.resolvedRiskRatePct / 100)).toFixed(4));
  const totalEffectiveUnitCost = Number((purchaseCost + logisticsCostPerUnit + operationalCost + spoilageRiskCost).toFixed(4));
  const vatRate = policy.vatRatePct / 100;
  const commissionRate = policy.commissionRatePct / 100;
  const targetMarginRate = policy.targetMarginPct / 100;
  const denominator = (1 / (1 + vatRate)) - commissionRate - targetMarginRate;
  if (denominator <= 0.05) throw new AppError(400, 'Hedef marj ve maliyet varsayımları uygulanabilir fiyat üretmiyor');
  const recommendedNetSalePrice = totalEffectiveUnitCost / (1 - targetMarginRate);
  const rawSuggestedPrice = totalEffectiveUnitCost / denominator;
  const allowedPriceCents = Array.isArray(settings.priceRecommendationPolicy?.allowedPriceCents)
    ? settings.priceRecommendationPolicy.allowedPriceCents.map(Number).filter((item) => Number.isFinite(item) && item >= 0 && item <= 99).sort((a, b) => a - b)
    : CONTROLLED_PRICING_POLICY.allowedPriceCents;
  const suggestedSalePrice = roundShelfPrice(rawSuggestedPrice, allowedPriceCents);
  const netRevenue = Number((suggestedSalePrice / (1 + vatRate)).toFixed(4));
  const commissionCost = Number((suggestedSalePrice * commissionRate).toFixed(4));
  const expectedProfit = Number((netRevenue - commissionCost - totalEffectiveUnitCost).toFixed(4));
  const expectedMarginPct = suggestedSalePrice > 0 ? Number(((expectedProfit / suggestedSalePrice) * 100).toFixed(2)) : 0;
  const currentSalePrice = Number(product.salePrice || 0);
  const currentNetRevenue = Number((currentSalePrice / (1 + vatRate)).toFixed(4));
  const currentCommissionCost = Number((currentSalePrice * commissionRate).toFixed(4));
  const currentProfit = Number((currentNetRevenue - currentCommissionCost - totalEffectiveUnitCost).toFixed(4));
  const currentMarginPct = currentSalePrice > 0 ? Number(((currentProfit / currentSalePrice) * 100).toFixed(2)) : 0;
  const activeCampaigns = await listActiveCampaignDefinitions({ settings });
  const campaignProjectedProduct = applyCampaignPricingToProduct(product, activeCampaigns, { includeGeneralCampaigns: true });
  const campaignInfo = campaignProjectedProduct.activeCampaign ? {
    isActive: true,
    name: campaignProjectedProduct.activeCampaign.name,
    type: campaignProjectedProduct.activeCampaign.type,
    scope: campaignProjectedProduct.activeCampaign.scope,
    campaignPrice: Number(campaignProjectedProduct.campaignPrice || campaignProjectedProduct.discountedPrice || 0),
    discountAmount: Number(campaignProjectedProduct.activeCampaign.discountAmount || 0),
    effectiveDiscountRate: Number(campaignProjectedProduct.activeCampaign.effectiveDiscountRate || 0),
    startsAt: campaignProjectedProduct.activeCampaign.startsAt || null,
    endsAt: campaignProjectedProduct.activeCampaign.endsAt || null,
  } : { isActive: false };
  const priceHistoryMetrics = buildPriceHistoryMetrics(product);
  const difference = Number((suggestedSalePrice - currentSalePrice).toFixed(2));
  const componentRows = [
    buildCostComponent({
      key: 'purchase',
      label: 'Alış fiyatı',
      amount: purchaseCost,
      source: supplierOption ? 'supplier_product_mapping' : 'product_master_fallback',
      details: supplierOption ? `${supplier?.name || 'Tedarikçi'} / ${supplierOption.priceUnit || 'adet'}` : 'Aktif tedarikçi eşleşmesi olmadığı için ürün master alış fiyatı kullanıldı.',
    }),
    buildCostComponent({
      key: 'logistics',
      label: 'Lojistik maliyeti',
      amount: logisticsCostPerUnit,
      source: logisticsSource,
      details: `${logisticsQuote.cargoTypeName} / ${procurementCaseQty} koli / ${logisticsUnits} birim`,
    }),
    buildCostComponent({
      key: 'operational',
      label: 'Operasyonel maliyet',
      amount: operationalCost,
      source: policy.policySource,
      details: `%${policy.operationalCostRatePct} operasyon + ${policy.handlingCostPerCase} TL/koli elleçleme`,
    }),
    buildCostComponent({
      key: 'spoilage',
      label: 'Fire / SKT risk etkisi',
      amount: spoilageRiskCost,
      source: expiryRisk.source,
      details: `%${expiryRisk.resolvedRiskRatePct} risk${expiryRisk.nearestExpiry ? `, en yakın SKT ${expiryRisk.nearestExpiry}` : ''}`,
    }),
  ];

  return {
    product: {
      id: product.id,
      productId: product.id,
      sku: product.sku,
      barcode: product.barcode || '',
      name: product.name,
      productName: product.name,
      categoryName: category?.name || '-',
      storageType,
      unit: product.unit || 'adet',
      casePack: unitsPerCase,
    },
    supplier: supplierOption ? {
      supplierProductId: supplierOption.id,
      supplierId: supplierOption.supplierId,
      supplierName: supplier?.name || '-',
      purchasePrice: Number(supplierOption.purchasePrice || product.purchasePrice || 0),
      priceUnit: supplierOption.priceUnit || 'adet',
      defaultOrderUnit: supplierOption.defaultOrderUnit || supplierOption.minOrderUnit || supplierOption.priceUnit || 'adet',
      minimumOrderQty: Number(supplierOption.minimumOrderQty || supplierOption.minOrderQty || 1),
      leadTimeDays: Number(supplierOption.leadTimeDays || 3),
      purchaseCostSource: 'supplier_product_mapping',
    } : null,
    costs: {
      purchaseCostPerUnit: purchaseCost,
      purchasePrice: purchaseCost,
      logisticsCostPerUnit,
      logisticsCaseCost: Number(logisticsQuote.totalPriceTl || 0),
      procurementCaseQty,
      unitsPerCase,
      operationalCostPerUnit: operationalCost,
      handlingCostPerUnit: handlingCost,
      spoilageRiskCostPerUnit: spoilageRiskCost,
      otherPerUnitCosts: 0,
      totalEstimatedCost: totalEffectiveUnitCost,
      totalEffectiveUnitCost,
      vatRatePct: policy.vatRatePct,
      vatRateSource: policy.vatRateSource,
      commissionRatePct: policy.commissionRatePct,
      componentRows,
    },
    current: {
      salePrice: currentSalePrice,
      expectedProfit: currentProfit,
      expectedMarginPct: currentMarginPct,
      lastPriceChangeAt: priceHistoryMetrics.lastPriceChangeAt || null,
      lastPriceChangeDate: priceHistoryMetrics.lastPriceChangeDate || null,
    },
    recommendation: {
      targetMarginPct: policy.targetMarginPct,
      rawSuggestedSalePrice: Number(rawSuggestedPrice.toFixed(4)),
      recommendedNetSalePrice: Number(recommendedNetSalePrice.toFixed(4)),
      suggestedSalePrice,
      recommendedSalePrice: suggestedSalePrice,
      expectedProfit,
      expectedMarginPct,
      difference,
      differenceDirection: difference > 0 ? 'increase' : difference < 0 ? 'decrease' : 'same',
      roundingRule: `allowed_cents:${allowedPriceCents.join(',')}; mode:round_up`,
      salePriceStandard: 'gross_vat_included_display_price',
    },
    logistics: {
      cargoTypeCode: logisticsQuote.cargoTypeCode,
      cargoTypeName: logisticsQuote.cargoTypeName,
      caseQty: logisticsQuote.caseQty,
      calculationMethod: logisticsQuote.calculationMethod,
      appliedBand: logisticsQuote.appliedBand,
    },
    risk: expiryRisk,
    campaign: campaignInfo,
    priceHistory: {
      lastPriceChangeAt: priceHistoryMetrics.lastPriceChangeAt || null,
      lastPriceChangeDate: priceHistoryMetrics.lastPriceChangeDate || null,
      source: priceHistoryMetrics.priceHistorySource || null,
    },
    calculationSummary: [
      `Alış maliyeti: ${purchaseCost.toFixed(2)} TL / baz birim`,
      `Kargo: ${logisticsQuote.totalPriceTl} TL / ${logisticsUnits} adet = ${logisticsCostPerUnit.toFixed(2)} TL`,
      `Operasyon + fire riski: ${(operationalCost + spoilageRiskCost).toFixed(2)} TL`,
      `Efektif birim maliyet: ${totalEffectiveUnitCost.toFixed(2)} TL`,
      `Hedef marj: %${policy.targetMarginPct}, önerilen satış: ${suggestedSalePrice.toFixed(2)} TL`,
    ],
    generatedAt: new Date().toISOString(),
  };
};

const approveSellPriceRecommendation = async ({ productId, salePrice, targetMarginPct, actorUserId }) => {
  const calculation = await buildSellPriceCalculation({ productId, targetMarginPct });
  const approvedSalePrice = Number(salePrice || calculation.recommendation.suggestedSalePrice);
  if (!Number.isFinite(approvedSalePrice) || approvedSalePrice <= 0) throw new AppError(400, 'Geçerli satış fiyatı zorunludur');
  const now = new Date().toISOString();
  const eventId = uuidv4();
  const previousSalePrice = Number(calculation.current.salePrice || 0);
  const eventPayload = {
    priceEventId: eventId,
    productId: calculation.product.id,
    eventDate: now,
    previousPrice: previousSalePrice,
    newPrice: approvedSalePrice,
    source: 'sell_price_recommendation',
    targetMarginPct: calculation.recommendation.targetMarginPct,
    calculation,
    approvedBy: actorUserId || null,
  };

  if (config.dataStore === 'postgres') {
    const prisma = await getPrisma();
    await prisma.$transaction([
      prisma.product.update({
        where: { id: calculation.product.id },
        data: {
          salePrice: approvedSalePrice,
          priceUpdatedAt: new Date(now),
          lastPriceChangeDate: new Date(now),
          lastPriceChangeAt: new Date(now),
          lastPriceChangeSource: 'sell_price_recommendation',
        },
      }),
      prisma.productPriceEvent.create({
        data: {
          id: eventId,
          productId: calculation.product.id,
          previousSalePrice,
          salePrice: approvedSalePrice,
          source: 'sell_price_recommendation',
          payload: eventPayload,
          createdAt: new Date(now),
        },
      }),
    ]);
  } else {
    const product = await productRepo.findById(calculation.product.id);
    const payload = product?.payload && typeof product.payload === 'object' ? product.payload : {};
    const priceHistory = Array.isArray(payload.priceHistory) ? payload.priceHistory : [];
    await productRepo.updateById(calculation.product.id, {
      ...product,
      salePrice: approvedSalePrice,
      priceUpdatedAt: now,
      lastPriceChangeDate: now.slice(0, 10),
      lastPriceChangeAt: now,
      lastPriceChangeSource: 'sell_price_recommendation',
      payload: {
        ...payload,
        priceHistory: [...priceHistory, {
          id: eventId,
          ...eventPayload,
          salePrice: approvedSalePrice,
          price: approvedSalePrice,
          createdAt: now,
        }],
      },
    });
  }

  return {
    productId: calculation.product.id,
    previousSalePrice,
    salePrice: approvedSalePrice,
    priceEventId: eventId,
    source: 'sell_price_recommendation',
    calculation,
    updatedAt: now,
  };
};

export const pricingAnalysisService = {
  async calculateSellPrice(payload = {}) {
    return buildSellPriceCalculation(payload);
  },

  async approveSellPrice(payload = {}, actorUserId = null) {
    return approveSellPriceRecommendation({ ...payload, actorUserId });
  },

  async getAnalysis(query = {}) {
    const cacheKey = getAnalysisCacheKey(query);
    if (config.dataStore === 'postgres' && query.forceRefresh !== true && query.forceRefresh !== 'true') {
      const cached = getCachedAnalysis(cacheKey);
      if (cached) return cached;
    }

    const analysisPromise = (async () => {
    if (
      config.dataStore === 'postgres'
      && query.forceRefresh !== true
      && query.forceRefresh !== 'true'
      && !isExplicitFullAnalysisRequest(query)
    ) {
      return buildPaginatedAnalysisFromPostgres(query);
    }

    const {
      products,
      categories,
      suppliers,
      stocks,
      sales,
      supplierProducts,
      productUniverse,
    } = await getAnalysisInputs(query);

    const categoryMap = new Map(categories.map((item) => [item.id, item]));
    const supplierMap = new Map(suppliers.map((item) => [item.id, item]));
    const stockMap = new Map(stocks.map((item) => [item.productId, item]));
    const supplierProductsByProduct = groupSupplierProductsByProduct(supplierProducts);
    const activeCampaigns = await listActiveCampaignDefinitions();

    const analysisDate = toDateOnly(normalizeDate(query.endDate || new Date()));
    const startDate = query.startDate ? normalizeDate(query.startDate, null) : null;
    const endDate = query.endDate ? normalizeDate(query.endDate, null) : null;

    const scopedSales = sales.filter((item) => {
      const created = normalizeDate(item.createdAt, null);
      if (!created) return false;
      if (startDate && created < startDate) return false;
      if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        if (created > endOfDay) return false;
      }
      return item.type === 'sale' || item.type === 'return';
    });

    const salesMetricsMap = demandForecastService.buildProductSalesMetrics({
      sales: scopedSales,
      analysisDate,
    });
    const salesTrendLast14DaysMap = buildLast14DailySalesMap(scopedSales, analysisDate);

    const now = new Date(`${analysisDate}T12:00:00.000Z`);

    const rows = products
      .filter((item) => matchesProductUniverse(item, productUniverse))
      .map((product) => {
        const projectedProduct = applyCampaignPricingToProduct(product, activeCampaigns, { includeGeneralCampaigns: true });
        const baseSalePrice = Number(projectedProduct.originalPrice ?? projectedProduct.salePrice ?? product.salePrice ?? 0);
        const currentPrice = Number(projectedProduct.currentPrice ?? baseSalePrice);
        const analysisProduct = {
          ...projectedProduct,
          salePrice: currentPrice,
          originalSalePrice: baseSalePrice,
        };
        const stock = stockMap.get(product.id);
        const category = categoryMap.get(product.categoryId);
        const productSupplierOptions = supplierProductsByProduct.get(product.id) || [];
        const bestSupplierOption = getBestSupplierOption(productSupplierOptions);
        const supplier = supplierMap.get(bestSupplierOption?.supplierId || product.supplierId);

        const warehouseStock = Number(stock?.warehouseQuantity || 0);
        const shelfStock = Number(stock?.shelfQuantity || 0);
        const totalStock = warehouseStock + shelfStock;

        const metrics = salesMetricsMap.get(product.id) || {
          sold7: 0,
          sold30: 0,
          soldPrev7: 0,
          avgDaily7: 0,
          avgDaily30: 0,
          prevAvgDaily7: 0,
          trendDirection: 'flat',
          trendRatio: 0,
          salesSpeed: 'normal',
        };

        const { expiryDate, source, batchNo } = resolveExpiryFromStock(stock, product, category?.name || '');
        const daysToExpiry = diffDays(expiryDate, now);
        const sktStatus = getSktStatus(daysToExpiry);

        const criticalStock = Number(product.criticalStock || 0);
        const isCriticalStock = totalStock <= criticalStock;
        const maxStock = Number(product.maxStock || 0);
        const overStockRatio = maxStock > 0 ? totalStock / maxStock : 0;
        const daysToStockout = metrics.avgDaily7 > 0 ? Number((totalStock / metrics.avgDaily7).toFixed(1)) : null;
        const stockoutDate = daysToStockout !== null ? new Date(now.getTime() + daysToStockout * DAY_MS).toISOString() : null;
        const leadTimeDays = bestSupplierOption
          ? Math.max(1, Number(bestSupplierOption.leadTimeDays || 3))
          : getLeadTimeDays(supplierProducts, product.id);
        const priceHistoryMetrics = buildPriceHistoryMetrics(product);
        const salesTrendLast14Days = salesTrendLast14DaysMap.get(product.id) || [];

        const recommendation = recommendationEngine.buildRecommendations({
          product: analysisProduct,
          metrics,
          daysToExpiry,
          overStockRatio,
          daysToStockout,
          totalStock,
          criticalStock,
          leadTimeDays,
        });

        const risk = riskScoringService.scoreProduct({
          daysToExpiry,
          totalStock,
          criticalStock,
          avgDaily7: metrics.avgDaily7,
          salesSpeed: metrics.salesSpeed,
          isCriticalStock,
          overStockRatio,
          daysToStockout,
        });

        return {
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          categoryId: product.categoryId,
          categoryName: category?.name || '-',
          supplierId: bestSupplierOption?.supplierId || product.supplierId,
          supplierName: supplier?.name || '-',
          currentPrice,
          salePrice: baseSalePrice,
          originalPrice: baseSalePrice,
          discountedPrice: projectedProduct.discountedPrice ?? null,
          hasActiveDiscount: projectedProduct.hasActiveDiscount === true,
          activeCampaign: projectedProduct.activeCampaign || null,
          activeCampaigns: Array.isArray(projectedProduct.activeCampaigns) ? projectedProduct.activeCampaigns : [],
          campaignInfo: projectedProduct.campaignInfo || '',
          campaignBadge: projectedProduct.campaignBadge || '',
          campaignIds: Array.isArray(projectedProduct.campaignIds) ? projectedProduct.campaignIds : [],
          campaignCount: Number(projectedProduct.campaignCount || 0),
          purchasePrice: Number(product.purchasePrice || 0),
          supplierPrice: Number(bestSupplierOption?.purchasePrice || product.purchasePrice || 0),
          supplierPriceUnit: bestSupplierOption?.priceUnit || 'adet',
          supplierLastPriceUpdate: bestSupplierOption?.lastPriceUpdate || bestSupplierOption?.updatedAt || null,
          priceHistory: priceHistoryMetrics.priceHistory,
          priceHistoryCount: priceHistoryMetrics.priceHistoryCount,
          lastPrice: priceHistoryMetrics.lastPrice,
          previousPrice: priceHistoryMetrics.previousPrice,
          priceChangePercent: priceHistoryMetrics.priceChangePercent,
          lastPriceChangeAt: priceHistoryMetrics.lastPriceChangeAt,
          lastPriceChangeDate: priceHistoryMetrics.lastPriceChangeDate,
          priceTrend: priceHistoryMetrics.priceTrend,
          priceHistorySource: priceHistoryMetrics.priceHistorySource,
          criticalStock,
          warehouseStock,
          shelfStock,
          totalStock,
          sold7: metrics.sold7,
          sold30: metrics.sold30,
          avgDailySales: metrics.avgDaily7,
          salesTrendLast14Days,
          salesTrend: trendLabel[metrics.trendDirection] || 'Dengeli',
          trendDirection: metrics.trendDirection,
          trendRatio: metrics.trendRatio,
          salesSpeed: metrics.salesSpeed,
          salesSpeedLabel: metrics.salesSpeed === 'fast' ? 'Hızlı' : metrics.salesSpeed === 'slow' ? 'Yavaş' : 'Normal',
          expiryDate: expiryDate?.toISOString() || null,
          expirySource: source,
          expiryBatchNo: batchNo,
          daysToExpiry,
          sktStatus,
          daysToStockout,
          estimatedStockoutDate: stockoutDate,
          leadTimeDays,
          discountSuggestion: recommendation.discount,
          orderSuggestion: recommendation.order,
          actionSuggestion: recommendation.actionSuggestion,
          riskScore: risk.score,
          riskLevel: risk.level,
          riskLabel: riskLabel[risk.level],
          riskFactors: risk.factors,
        };
      });

    const filtered = rows.filter((row) => {
      const matchesCategory = !query.categoryId || row.categoryId === query.categoryId;
      const matchesSupplier = !query.supplierId || row.supplierId === query.supplierId;
      const matchesRisk = !query.riskLevel || row.riskLevel === query.riskLevel;
      const matchesSkt = !query.sktStatus || row.sktStatus === query.sktStatus;
      const matchesSpeed = !query.salesSpeed || row.salesSpeed === query.salesSpeed;
      const matchesDiscountOnly = query.discountOnly === 'true' ? row.discountSuggestion.hasSuggestion : true;
      const matchesOrderOnly = query.orderOnly === 'true' ? row.orderSuggestion.hasSuggestion : true;
      const matchesText = matchesSearch(row, String(query.search || '').trim());
      return (
        matchesCategory &&
        matchesSupplier &&
        matchesRisk &&
        matchesSkt &&
        matchesSpeed &&
        matchesDiscountOnly &&
        matchesOrderOnly &&
        matchesText
      );
    });

    const fastSellingProducts = filtered
      .filter((row) => row.salesSpeed === 'fast')
      .sort((a, b) => b.sold7 - a.sold7)
      .slice(0, 20);

    const slowAndExpiryRiskProducts = filtered
      .filter((row) => row.salesSpeed === 'slow' || ['critical', 'soon'].includes(row.sktStatus))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 40);

    const dynamicDiscountSuggestions = filtered
      .filter((row) => row.discountSuggestion.hasSuggestion)
      .sort((a, b) => b.discountSuggestion.discountRate - a.discountSuggestion.discountRate)
      .slice(0, 40);

    const stockRunoutAnalysis = filtered
      .filter((row) => row.daysToStockout !== null)
      .sort((a, b) => a.daysToStockout - b.daysToStockout)
      .slice(0, 40);

    const automaticOrderSuggestions = filtered
      .filter((row) => row.orderSuggestion.hasSuggestion)
      .sort((a, b) => (a.daysToStockout || 9999) - (b.daysToStockout || 9999))
      .slice(0, 40);

    const riskScorePanel = filtered
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 50);

    const salesPattern = demandForecastService.buildWeeklyPattern({ sales: scopedSales, analysisDate });

    const systemControls = {
      expiringProducts: filtered.filter((row) => ['critical', 'soon'].includes(row.sktStatus)).length,
      lowStockProducts: filtered.filter((row) => row.totalStock <= row.criticalStock + 5).length,
      criticalStockProducts: filtered.filter((row) => row.totalStock <= row.criticalStock).length,
      slowSalesProducts: filtered.filter((row) => row.salesSpeed === 'slow').length,
      overStockProducts: filtered.filter((row) => row.totalStock > Math.max(row.criticalStock * 3, 20)).length,
      fastRunoutProducts: filtered.filter((row) => row.daysToStockout !== null && row.daysToStockout <= 7).length,
    };

    const actions = [
      {
        key: 'discount',
        title: 'İndirim Aksiyonu',
        value: dynamicDiscountSuggestions.length,
        detail: 'SKT ve satış hızı sinyallerine göre dinamik fiyat önerileri.',
      },
      {
        key: 'order',
        title: 'Sipariş Aksiyonu',
        value: automaticOrderSuggestions.length,
        detail: 'Tükenme riski olan ürünler için sipariş zamanlaması.',
      },
      {
        key: 'risk',
        title: 'Kritik Risk',
        value: filtered.filter((row) => row.riskLevel === 'critical').length,
        detail: 'Kritik risk grubundaki ürünler için hızlı müdahale gerekli.',
      },
    ];

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        universe: productUniverse,
        analysisDate,
        startDate: query.startDate || null,
        endDate: query.endDate || null,
      },
      summary: {
        totalAnalyzedProducts: filtered.length,
        discountSuggestedProducts: dynamicDiscountSuggestions.length,
        sktRiskProducts: filtered.filter((row) => ['critical', 'soon'].includes(row.sktStatus)).length,
        nearRunoutProducts: filtered.filter((row) => row.daysToStockout !== null && row.daysToStockout <= 10).length,
        orderSuggestedProducts: automaticOrderSuggestions.length,
        highRiskProducts: filtered.filter((row) => ['high', 'critical'].includes(row.riskLevel)).length,
      },
      filtersMeta: {
        categories: categories.map((item) => ({ id: item.id, name: item.name })),
        suppliers: suppliers.map((item) => ({ id: item.id, name: item.name })),
      },
      systemControls,
      actions,
      rows: filtered.map(compactAnalysisRow),
      sections: {
        fastSellingProducts: fastSellingProducts.map(compactAnalysisRow),
        slowAndExpiryRiskProducts: slowAndExpiryRiskProducts.map(compactAnalysisRow),
        dynamicDiscountSuggestions: dynamicDiscountSuggestions.map(compactAnalysisRow),
        stockRunoutAnalysis: stockRunoutAnalysis.map(compactAnalysisRow),
        automaticOrderSuggestions: automaticOrderSuggestions.map(compactAnalysisRow),
        salesPattern,
        riskScorePanel: riskScorePanel.map(compactAnalysisRow),
      },
    };
    })();

    if (config.dataStore === 'postgres' && query.forceRefresh !== true && query.forceRefresh !== 'true') {
      return setCachedAnalysis(cacheKey, analysisPromise);
    }

    return analysisPromise;
  },

  async getSummary(query = {}) {
    if (config.dataStore === 'postgres' && query.forceRefresh !== true && query.forceRefresh !== 'true') {
      return getFastSummaryFromPostgres(query);
    }

    const analysis = await this.getAnalysis(query);
    return {
      generatedAt: analysis.generatedAt,
      filters: analysis.filters,
      filtersMeta: analysis.filtersMeta,
      summary: analysis.summary,
      systemControls: analysis.systemControls,
      actions: analysis.actions,
    };
  },

  async getRows(query = {}) {
    if (config.dataStore === 'postgres' && query.forceRefresh !== true && query.forceRefresh !== 'true') {
      return getFastRowsFromPostgres(query);
    }

    const analysis = await this.getAnalysis(query);
    const { key, rows } = sortRows(analysis.rows || [], query.sort || 'risk_desc');
    const { pageRows, pagination } = paginateRows(rows, query);
    return {
      items: pageRows,
      pagination,
      filters: {
        categoryId: query.categoryId || null,
        supplierId: query.supplierId || null,
        riskLevel: query.riskLevel || query.risk || null,
        sktStatus: query.sktStatus || null,
        salesSpeed: query.salesSpeed || null,
        discountOnly: query.discountOnly || null,
        orderOnly: query.orderOnly || null,
        search: String(query.search || '').trim() || null,
      },
      sort: {
        key,
        direction: key.endsWith('_asc') ? 'asc' : 'desc',
      },
    };
  },

  async getDetail(productId, query = {}) {
    const targetId = String(productId || '').trim();
    if (!targetId) throw new AppError(400, 'productId is required');

    const analysis = await this.getAnalysis({ ...query, productId: undefined, page: undefined, limit: undefined });
    const row = (analysis.rows || []).find((item) => String(item.productId || item.id || '') === targetId);
    if (!row) throw createNotFoundError('Fiyat analizi satırı bulunamadı');

    const product = await productRepo.findById(targetId);
    const priceHistoryMetrics = buildPriceHistoryMetrics(product || {});
    return {
      ...row,
      priceHistory: priceHistoryMetrics.priceHistory,
      priceHistoryCount: priceHistoryMetrics.priceHistoryCount,
      riskFactors: Array.isArray(row.riskFactors) ? row.riskFactors : [],
    };
  },
};

