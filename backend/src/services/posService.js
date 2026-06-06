import { v4 as uuidv4 } from 'uuid';
import { salesRepo } from '../repositories/salesRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { stockRepo } from '../repositories/stockRepository.js';
import { movementRepo } from '../repositories/movementRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { categoryRepo } from '../repositories/categoryRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { includesSearchText, normalizeSearchText } from '../utils/validators.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';
import { resolveStoreScheduleStatus } from '../utils/storeSchedule.js';
import { formatReturnReasonLabel } from '../utils/displayLabels.js';
import { getBarcodeCandidates } from '../utils/barcode.js';
import { applyCampaignPricingToProduct, listActiveCampaignDefinitions } from './campaignPricingService.js';
import { settingsService } from './settingsService.js';
import { dailyClosingService, MANUAL_SNAPSHOT } from './dailyClosingService.js';
import { mobileOrderService } from './mobileOrderService.js';

const buildReferenceNo = (type) => {
  const normalized = String(type || '').toLowerCase();
  const prefix = normalized === 'return' ? 'IAD' : 'SAT';
  return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;
};

const isToday = (isoStr) => {
  if (!isoStr) return false;
  return isoStr.slice(0, 10) === new Date().toISOString().slice(0, 10);
};

const DEFAULT_POS_SALES_LIMIT = 50;
const MAX_POS_SALES_LIMIT = 200;

const normalizePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveSalesPagination = (filters = {}) => {
  const full = filters.full === true || String(filters.full || '').toLowerCase() === 'true' || String(filters.limit || '').toLowerCase() === 'all';
  const page = normalizePositiveInt(filters.page, 1);
  const rawLimit = normalizePositiveInt(filters.limit, DEFAULT_POS_SALES_LIMIT);
  const limit = full ? null : Math.min(MAX_POS_SALES_LIMIT, rawLimit);
  return {
    full,
    page,
    limit,
    skip: full ? undefined : (page - 1) * limit,
  };
};

const toSalesListResponse = ({ items, total, page, limit, full }) => ({
  items,
  data: items,
  total,
  page,
  limit: full ? total : limit,
});

const VALID_PAYMENT_METHODS = ['cash', 'card', 'qr', 'eft', 'giftcard'];
const BAG_PRODUCT_ID = '__bag__';

const PAYMENT_LABELS = { cash: 'Nakit', card: 'Kart', qr: 'QR Ödeme', eft: 'Havale/EFT', giftcard: 'Hediye Kartı' };
const VALID_DESK_CODES = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'];
const AUTO_SALE_SOURCE = 'otomatik_satis_paneli';
const AUTO_SALE_PAYMENT_WEIGHTS = [
  { method: 'card', weight: 50 },
  { method: 'cash', weight: 35 },
  { method: 'qr', weight: 10 },
  { method: 'eft', weight: 3 },
  { method: 'giftcard', weight: 2 },
];
const AUTO_SALE_LOG_SOURCE = 'otomatik_satis_paneli';

const normalizeGiftCardCode = (value) => String(value || '').trim().toUpperCase();

const resolveGiftCardUsageState = (card = {}) => {
  const usageLimitSource = Number(card?.usageLimit ?? card?.maxUsage ?? 1);
  const usageLimit = Number.isFinite(usageLimitSource) && usageLimitSource >= 1 ? Math.floor(usageLimitSource) : 1;
  const usedCountSource = Number(card?.usedCount ?? 0);
  const usedCount = Number.isFinite(usedCountSource) && usedCountSource >= 0 ? Math.floor(usedCountSource) : 0;
  const remainingUsageSource = Number(card?.remainingUsage);
  const remainingUsage = Number.isFinite(remainingUsageSource)
    ? Math.max(0, Math.min(usageLimit, Math.floor(remainingUsageSource)))
    : Math.max(0, usageLimit - usedCount);

  return {
    usageLimit,
    maxUsage: usageLimit,
    usedCount: Math.min(usedCount, usageLimit),
    remainingUsage,
  };
};

const toSafeAmount = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const roundMoney = (value) => Math.round(toSafeAmount(value) * 100) / 100;

const clampRatio = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
};

const clampPositiveInt = (value, fallback, { min = 1, max = 20 } = {}) => {
  const numeric = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

const pickWeightedPaymentMethod = () => {
  const totalWeight = AUTO_SALE_PAYMENT_WEIGHTS.reduce((sum, row) => sum + row.weight, 0);
  let cursor = Math.random() * totalWeight;
  for (const row of AUTO_SALE_PAYMENT_WEIGHTS) {
    cursor -= row.weight;
    if (cursor <= 0) return row.method;
  }
  return 'card';
};

const recordAutoSaleDeveloperLog = async ({ level = 'info', message, payload = {}, response = null, error = null, userContext = null } = {}) => {
  try {
    await settingsService.recordDeveloperLog({
      level,
      source: AUTO_SALE_LOG_SOURCE,
      message,
      action: 'POST /api/pos/sales/automatic',
      endpoint: '/api/pos/sales/automatic',
      requestUrl: '/api/pos/sales/automatic',
      requestPayload: payload,
      payload,
      response,
      stack: error?.stack || '',
      statusCode: error instanceof AppError ? error.statusCode : level === 'error' ? 500 : 200,
      errorType: error ? 'automatic_sale_error' : 'automatic_sale_event',
      description: message,
    }, userContext, {
      source: AUTO_SALE_LOG_SOURCE,
      endpoint: '/api/pos/sales/automatic',
      requestUrl: '/api/pos/sales/automatic',
      action: 'POST /api/pos/sales/automatic',
      statusCode: error instanceof AppError ? error.statusCode : level === 'error' ? 500 : 200,
    });
  } catch (logError) {
    console.warn('[POS automatic sale log skipped]', logError?.message || logError);
  }
};

const resolveVatRate = (value, fallback = 20) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
};

const normalizeRecordPayments = (record = {}) => {
  const targetAmount = Math.max(roundMoney(record?.totalAmount), 0);
  if (targetAmount <= 0) {
    return [];
  }

  const fallbackMethod = VALID_PAYMENT_METHODS.includes(record?.paymentMethod) ? record.paymentMethod : null;
  const parsedPayments = Array.isArray(record?.payments)
    ? record.payments
      .map((payment) => ({
        method: VALID_PAYMENT_METHODS.includes(payment?.method) ? payment.method : null,
        amount: roundMoney(payment?.amount),
      }))
      .filter((payment) => payment.method && payment.amount > 0)
    : [];

  if (!parsedPayments.length) {
    if (!fallbackMethod) return [];
    return [{ method: fallbackMethod, amount: targetAmount }];
  }

  const rawTotal = parsedPayments.reduce((sum, payment) => sum + payment.amount, 0);
  if (rawTotal <= 0) {
    if (!fallbackMethod) return [];
    return [{ method: fallbackMethod, amount: targetAmount }];
  }

  if (Math.abs(rawTotal - targetAmount) <= 0.01) {
    return parsedPayments;
  }

  const scale = targetAmount / rawTotal;
  let allocated = 0;
  const scaled = parsedPayments.map((payment, index) => {
    if (index === parsedPayments.length - 1) {
      const amount = roundMoney(targetAmount - allocated);
      return { method: payment.method, amount: amount > 0 ? amount : 0 };
    }
    const amount = roundMoney(payment.amount * scale);
    allocated += amount;
    return { method: payment.method, amount: amount > 0 ? amount : 0 };
  });

  return scaled.filter((payment) => payment.amount > 0);
};

const aggregatePaymentsByMethod = (records = []) => {
  const totals = VALID_PAYMENT_METHODS.reduce((acc, method) => {
    acc[method] = 0;
    return acc;
  }, {});

  for (const record of records) {
    const payments = normalizeRecordPayments(record);
    for (const payment of payments) {
      totals[payment.method] += payment.amount;
    }
  }

  for (const method of VALID_PAYMENT_METHODS) {
    totals[method] = roundMoney(totals[method]);
  }

  return totals;
};

const normalizeDeskCode = (value) => String(value || '').trim().toUpperCase();

const buildDeskActivationState = (rawState = {}) => {
  const normalized = {};
  for (const code of VALID_DESK_CODES) {
    normalized[code] = rawState?.[code] === true;
  }
  return normalized;
};

const toNumberValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
};

const normalizeDisplayText = (value) => {
  if (typeof value !== 'string') return value;
  return value
    .replace(/M\?\?teri beyan\? ile iade/g, 'Müşteri beyanı ile iade')
    .normalize('NFC');
};

const normalizeSaleRecordForRead = (sale = {}) => ({
  ...sale,
  returnReasonDetail: normalizeDisplayText(sale.returnReasonDetail),
  returnReasonLabel: formatReturnReasonLabel(sale.returnReason, ''),
});

const mapPosProductRow = (product, activeCampaigns = []) => {
  const salePrice = toNumberValue(product.salePrice) || 0;
  const priced = applyCampaignPricingToProduct({
    id: product.id,
    productId: product.id,
    name: product.name,
    productName: product.name,
    sku: product.sku,
    barcode: product.barcode,
    categoryId: product.categoryId || '',
    brand: product.brand || '',
    salePrice,
    price: salePrice,
  }, activeCampaigns, { includeGeneralCampaigns: true, channel: 'pos', audience: 'customer' });

  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    categoryId: product.categoryId || '',
    brand: product.brand || '',
    salePrice: priced.salePrice || salePrice,
    price: priced.price || salePrice,
    currentPrice: priced.currentPrice || salePrice,
    regularPrice: priced.regularPrice || priced.salePrice || salePrice,
    effectivePrice: priced.effectivePrice || priced.currentPrice || salePrice,
    discountedPrice: priced.discountedPrice || null,
    campaignPrice: priced.campaignPrice || null,
    hasActiveDiscount: priced.hasActiveDiscount === true,
    hasActiveCampaign: priced.hasActiveCampaign === true || priced.hasActiveDiscount === true,
    activeCampaign: priced.activeCampaign || null,
    activeCampaignId: priced.activeCampaignId || null,
    activeCampaignName: priced.activeCampaignName || '',
    appliedCampaign: priced.appliedCampaign || priced.activeCampaign || null,
    appliedCampaignReason: priced.appliedCampaignReason || '',
    activeCampaigns: Array.isArray(priced.activeCampaigns) ? priced.activeCampaigns : [],
    candidateCampaigns: Array.isArray(priced.candidateCampaigns) ? priced.candidateCampaigns : [],
    campaignConflictCount: Number(priced.campaignConflictCount || 0),
    campaignConflictPolicy: priced.campaignConflictPolicy || priced.campaignResolutionStrategy || null,
    campaignDiscountAmount: Number(priced.campaignDiscountAmount || priced.discountAmount || 0),
    campaignDiscountPercent: Number(priced.campaignDiscountPercent || priced.effectiveDiscountRate || 0),
    campaignValidUntil: priced.campaignValidUntil || null,
    campaignInfo: priced.campaignInfo || '',
    effectiveDiscountRate: Number(priced.effectiveDiscountRate || 0),
    discountAmount: Number(priced.discountAmount || 0),
    unit: product.unit || 'adet',
    vatRate: resolveVatRate(product.vatRate, 20),
    currentStock: product.stock?.shelfQuantity || 0,
  };
};

const searchProductsFromPostgres = async (query, { limit = 10 } = {}) => {
  if (!query || String(query).trim().length < 2) {
    return [];
  }

  const prisma = await getPrisma();
  const activeCampaigns = await listActiveCampaignDefinitions();
  const q = String(query).trim();
  const parsedLimit = limit === undefined || limit === '' ? 10 : Number(limit);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    throw new AppError(400, 'limit pozitif bir sayı olmalıdır');
  }
  const safeLimit = Math.min(50, Math.floor(parsedLimit));
  const normalizedQ = normalizeSearchText(q);
  const rows = await withPostgresQueryLogging('GET /api/pos/products/search', () => prisma.product.findMany({
    where: {
      isActive: { not: false },
      isListed: { not: false },
      OR: [
        { normalizedSearch: { contains: normalizedQ } },
        { barcode: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: safeLimit,
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      salePrice: true,
      categoryId: true,
      brand: true,
      unit: true,
      stock: { select: { shelfQuantity: true } },
    },
  }));

  return rows.map((row) => mapPosProductRow(row, activeCampaigns));
};

const findProductByBarcodeFromPostgres = async (barcode) => {
  if (!barcode || !String(barcode).trim()) {
    throw new AppError(400, 'Barkod zorunludur');
  }

  const prisma = await getPrisma();
  const activeCampaigns = await listActiveCampaignDefinitions();
  const barcodeCandidates = getBarcodeCandidates(barcode);
  const product = await withPostgresQueryLogging('GET /api/pos/products/by-barcode/:barcode', () => prisma.product.findFirst({
    where: {
      OR: barcodeCandidates.map((candidate) => ({ barcode: candidate })),
    },
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      salePrice: true,
      categoryId: true,
      brand: true,
      unit: true,
      isActive: true,
      isListed: true,
      stock: { select: { shelfQuantity: true } },
    },
  }));

  if (!product) {
    throw createNotFoundError('Barkod ile eşleşen ürün bulunamadı');
  }

  if (!product.isActive) {
    throw new AppError(400, 'Ürün pasif durumda, satış yapılamaz');
  }

  if (product.isListed === false) {
    throw new AppError(400, 'Ürün katalog modunda, satışa açık değil');
  }

  return mapPosProductRow(product, activeCampaigns);
};

const listAutomaticSaleProductPool = async () => {
  if (config.dataStore === 'postgres') {
    const prisma = await getPrisma();
    const activeCampaigns = await listActiveCampaignDefinitions();
    const rows = await withPostgresQueryLogging('AUTO POS product pool', () => prisma.product.findMany({
      where: {
        isActive: { not: false },
        isListed: { not: false },
        stock: { is: {
          shelfQuantity: { gt: 0 },
        } },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        salePrice: true,
        categoryId: true,
        brand: true,
        unit: true,
        stock: { select: { shelfQuantity: true } },
      },
    }));

    return rows.reduce((pool, product) => {
      const shelfQuantity = Number(product.stock?.shelfQuantity || 0);
      const pricedProduct = mapPosProductRow(product, activeCampaigns);
      const unitPrice = Number(pricedProduct.effectivePrice || pricedProduct.currentPrice || pricedProduct.salePrice || product.salePrice || 0);
      if (product?.id && shelfQuantity > 0 && Number.isFinite(unitPrice) && unitPrice > 0) {
        pool.push({
          productId: product.id,
          shelfQuantity,
          unitPrice: roundMoney(unitPrice),
        });
      }
      return pool;
    }, []);
  }

  const products = await productRepo.getAll();
  const activeCampaigns = await listActiveCampaignDefinitions();
  const pool = [];

  for (const product of products) {
    if (!product?.id || product.isActive === false || product.isListed === false) continue;
    const stock = await stockRepo.findByProductId(product.id);
    const shelfQuantity = Number(stock?.shelfQuantity || 0);
    if (!Number.isFinite(shelfQuantity) || shelfQuantity <= 0) continue;

    const pricedProduct = mapPosProductRow({ ...product, stock }, activeCampaigns);
    const unitPrice = Number(pricedProduct.effectivePrice || pricedProduct.currentPrice || pricedProduct.salePrice || product.salePrice || 0);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;

    pool.push({
      productId: product.id,
      shelfQuantity,
      unitPrice,
    });
  }

  return pool;
};

const shuffleRows = (rows = []) => [...rows].sort(() => Math.random() - 0.5);

const randomIntBetween = (min, max) => {
  const safeMin = Math.ceil(Number(min));
  const safeMax = Math.floor(Number(max));
  if (!Number.isFinite(safeMin) || !Number.isFinite(safeMax) || safeMax <= safeMin) return safeMin;
  return safeMin + Math.floor(Math.random() * (safeMax - safeMin + 1));
};

const sumAutomaticSaleItems = (items, priceMap) => roundMoney((items || []).reduce((sum, item) => (
  sum + (Number(priceMap.get(item.productId) || 0) * Number(item.quantity || 0))
), 0));

const buildAutomaticSaleItems = async ({ minAmount, maxAmount, minProductCount = 1, maxProductCount = 3 } = {}) => {
  const pool = await listAutomaticSaleProductPool();
  if (!pool.length) {
    throw new AppError(422, 'Otomatik satış için uygun stoklu ürün bulunamadı.', { details: { poolCount: 0 } });
  }

  const safeMinAmount = roundMoney(minAmount);
  const safeMaxAmount = roundMoney(maxAmount);
  if (!Number.isFinite(safeMinAmount) || !Number.isFinite(safeMaxAmount) || safeMinAmount <= 0 || safeMaxAmount < safeMinAmount) {
    throw new AppError(400, 'Minimum tutar, maksimum tutardan büyük olamaz.', {
      errorCode: 'INVALID_AMOUNT_RANGE',
      fieldErrors: {
        minAmount: 'Minimum tutar, maksimum tutardan büyük olamaz.',
        maxAmount: 'Maksimum tutar minimum tutardan küçük olamaz.',
      },
      details: { minAmount, maxAmount },
    });
  }

  const priceMap = new Map(pool.map((item) => [item.productId, item.unitPrice]));
  const affordablePool = pool.filter((item) => item.unitPrice <= safeMaxAmount);
  if (!affordablePool.length) {
    throw new AppError(422, 'Belirlenen tutar aralığına uygun sepet oluşturulamadı.', { details: { poolCount: pool.length, affordablePoolCount: 0, minAmount: safeMinAmount, maxAmount: safeMaxAmount } });
  }

  const safeMinProductCount = clampPositiveInt(minProductCount, 1, { min: 1, max: 20 });
  const safeMaxProductCount = Math.max(safeMinProductCount, clampPositiveInt(maxProductCount, 3, { min: 1, max: 20 }));
  const maxDistinct = Math.min(safeMaxProductCount, affordablePool.length);
  const minDistinct = Math.min(safeMinProductCount, maxDistinct);

  for (let attempt = 0; attempt < 160; attempt += 1) {
    const targetDistinct = randomIntBetween(minDistinct, maxDistinct);
    const shuffled = shuffleRows(affordablePool);
    const itemsByProductId = new Map();

    for (const candidate of shuffled) {
      if (itemsByProductId.size >= targetDistinct) break;
      const runningTotal = sumAutomaticSaleItems(Array.from(itemsByProductId.values()), priceMap);
      if (runningTotal + candidate.unitPrice > safeMaxAmount) continue;
      itemsByProductId.set(candidate.productId, { productId: candidate.productId, quantity: 1 });
    }

    if (itemsByProductId.size < minDistinct) continue;

    let guard = 0;
    while (sumAutomaticSaleItems(Array.from(itemsByProductId.values()), priceMap) < safeMinAmount && guard < 80) {
      guard += 1;
      const currentItems = shuffleRows(Array.from(itemsByProductId.values()));
      let updated = false;

      for (const current of currentItems) {
        const candidate = affordablePool.find((row) => row.productId === current.productId);
        if (!candidate) continue;
        const currentTotal = sumAutomaticSaleItems(Array.from(itemsByProductId.values()), priceMap);
        const nextQty = Number(current.quantity || 0) + 1;
        if (nextQty > Math.min(candidate.shelfQuantity, 8)) continue;
        if (currentTotal + candidate.unitPrice > safeMaxAmount) continue;
        itemsByProductId.set(candidate.productId, { productId: candidate.productId, quantity: nextQty });
        updated = true;
        break;
      }

      if (!updated) break;
    }

    const items = Array.from(itemsByProductId.values());
    const total = sumAutomaticSaleItems(items, priceMap);
    if (items.length >= minDistinct && items.length <= maxDistinct && total >= safeMinAmount && total <= safeMaxAmount) {
      return {
        items,
        diagnostics: {
          poolCount: pool.length,
          affordablePoolCount: affordablePool.length,
          selectedItems: items,
          total,
          minAmount: safeMinAmount,
          maxAmount: safeMaxAmount,
          minProductCount: safeMinProductCount,
          maxProductCount: safeMaxProductCount,
        },
      };
    }
  }

  throw new AppError(422, 'Belirlenen tutar aralığına uygun sepet oluşturulamadı.', { details: { poolCount: pool.length, affordablePoolCount: affordablePool.length, minAmount: safeMinAmount, maxAmount: safeMaxAmount, minProductCount: safeMinProductCount, maxProductCount: safeMaxProductCount } });
};

const assertDeskCode = (deskCode) => {
  if (!VALID_DESK_CODES.includes(deskCode)) {
    throw new AppError(400, 'Geçerli kasa seçilmedi.');
  }
};

const getDeskActivationState = async () => {
  const settings = await settingsRepo.getSettings();
  return buildDeskActivationState(settings?.deskActivationState || {});
};

const assertManagementDeskRegisterPin = async (userContext, deskCode) => {
  if (deskCode !== 'B8') {
    return;
  }

  const user = await userRepo.findById(userContext?.id);
  const registerPin = String(user?.registerPin || '').trim();
  if (registerPin !== '0007') {
    throw new AppError(403, 'Yönetim Kasası erişimi için sicil numarası 0007 olmalıdır');
  }
};

const ensureDeskActiveForCashier = async (deskCode, userContext) => {
  if (userContext?.role !== 'cashier') {
    return;
  }

  if (!deskCode) {
    throw new AppError(400, 'Kasa kodu zorunludur');
  }

  const status = await getDeskActivationState();
  if (!status[deskCode]) {
    throw new AppError(403, 'Bu kasa yönetici tarafından aktif hale getirilmemiş. Lütfen yöneticiye başvurun.');
  }
};

const ensureStoreOpenForPosSale = async () => {
  const settings = await settingsRepo.getSettings();
  const status = resolveStoreScheduleStatus(settings, new Date());
  if (!status.isStoreOpen) {
    throw new AppError(403, `Mağaza şu anda kapalı. POS satışı sadece çalışma saatlerinde yapılabilir (${status.dayKey}: ${status.opensAt} - ${status.closesAt}, ${status.timeZone}).`);
  }
  return { settings, status };
};

const ensureAssignedDeskForCashier = (deskCode, userContext) => {
  if (userContext?.role !== 'cashier') {
    return;
  }

  const assignedDeskCode = normalizeDeskCode(userContext?.assignedDeskCode);
  if (!assignedDeskCode) {
    throw new AppError(403, 'Bu kasiyer için atanmış kasa bulunmuyor');
  }

  if (deskCode !== assignedDeskCode) {
    throw new AppError(403, `Bu kullanıcı sadece ${assignedDeskCode} kasasında işlem yapabilir`);
  }
};

export const posService = {
  async lookupMobileOrder(payload, userContext) {
    return mobileOrderService.lookupForPos(payload, userContext);
  },

  async pullMobileOrder(orderId, userContext) {
    return mobileOrderService.pullToPos(orderId, userContext);
  },

  async completeMobileOrder(orderId, payload, userContext) {
    return mobileOrderService.completeFromPos(orderId, payload, userContext);
  },

  async getDeskActivationStatus() {
    return getDeskActivationState();
  },

  async getAutomaticSaleAvailability() {
    const pool = await listAutomaticSaleProductPool();
    return {
      eligibleProductCount: pool.length,
      poolCount: pool.length,
      hasEligibleProducts: pool.length > 0,
    };
  },

  async setDeskActivation(payload, userContext) {
    if (userContext?.role !== 'admin') {
      throw new AppError(403, 'Bu işlem için yetkiniz yok');
    }

    const deskCode = normalizeDeskCode(payload?.deskCode);
    const isActive = payload?.isActive === true;

    assertDeskCode(deskCode);
    await assertManagementDeskRegisterPin(userContext, deskCode);

    const settings = await settingsRepo.getSettings();
    const current = buildDeskActivationState(settings?.deskActivationState || {});
    current[deskCode] = isActive;

    await settingsRepo.updateSettings({
      ...settings,
      deskActivationState: current,
      updatedAt: new Date().toISOString(),
    });

    return {
      deskCode,
      isActive,
      deskActivationState: current,
    };
  },

  async getDashboard() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayFromRepo = await salesRepo.findMany?.({ date: todayStr }, { includeItems: false });
    const today = todayFromRepo || (await salesRepo.getAll()).filter((s) => isToday(s.createdAt));

    const sales = today.filter((s) => s.type === 'sale');
    const returns = today.filter((s) => s.type === 'return');

    const totalSales = roundMoney(sales.reduce((sum, s) => sum + toSafeAmount(s?.totalAmount), 0));
    const totalReturns = roundMoney(returns.reduce((sum, s) => sum + toSafeAmount(s?.totalAmount), 0));
    const salesPaymentBreakdown = aggregatePaymentsByMethod(sales);
    const returnsPaymentBreakdown = aggregatePaymentsByMethod(returns);
    const paymentBreakdown = {};
    for (const method of VALID_PAYMENT_METHODS) {
      paymentBreakdown[method] = roundMoney(toSafeAmount(salesPaymentBreakdown[method]) - toSafeAmount(returnsPaymentBreakdown[method]));
    }
    const paymentTotal = roundMoney(Object.values(salesPaymentBreakdown).reduce((sum, value) => sum + toSafeAmount(value), 0));
    const reconciledTotalSales = paymentTotal > 0 ? paymentTotal : totalSales;

    return {
      todaySalesTotal: reconciledTotalSales,
      todayReturnsTotal: totalReturns,
      dailyRevenue: roundMoney(reconciledTotalSales - totalReturns),
      cashSales: roundMoney(paymentBreakdown.cash),
      cardSales: roundMoney(paymentBreakdown.card),
      paymentBreakdown,
      salesCount: sales.length,
      returnsCount: returns.length,
      recentSales: [...sales].sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''))).slice(0, 10),
      recentReturns: [...returns].sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''))).slice(0, 10),
    };
  },

  async getCategories() {
    if (config.dataStore === 'postgres') {
      const prisma = await getPrisma();
      const [categories, productCounts] = await withPostgresQueryLogging('GET /api/pos/categories', () => Promise.all([
        prisma.category.findMany({
          where: { isActive: { not: false } },
          select: { id: true, name: true, code: true },
        }),
        prisma.product.groupBy({
          by: ['categoryId'],
          where: {
            categoryId: { not: null },
            isActive: { not: false },
            isListed: { not: false },
          },
          _count: { _all: true },
        }),
      ]));
      const countByCategoryId = new Map(
        productCounts.map((row) => [String(row.categoryId || ''), Number(row._count?._all || 0)])
      );
      return categories
        .map((category) => ({
          id: category.id,
          name: category.name,
          code: category.code,
          productCount: countByCategoryId.get(String(category.id)) || 0,
        }))
        .filter((category) => category.productCount > 0)
        .sort((left, right) => right.productCount - left.productCount || String(left.name || '').localeCompare(String(right.name || ''), 'tr'));
    }

    const categories = await categoryRepo.getAll();
    const products = await productRepo.getAll();
    return categories
      .filter((c) => c.isActive !== false)
      .map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        productCount: products.filter((p) => p.categoryId === c.id && p.isActive !== false && p.isListed !== false).length,
      }))
      .filter((c) => c.productCount > 0)
      .sort((a, b) => b.productCount - a.productCount);
  },

  async getProductsByCategory(categoryId) {
    const products = await productRepo.getAll();
    const activeCampaigns = await listActiveCampaignDefinitions();
    const matches = products.filter((p) => p.categoryId === categoryId && p.isActive !== false && p.isListed !== false);
    const results = [];
    for (const p of matches) {
      const stock = await stockRepo.findByProductId(p.id);
      results.push(mapPosProductRow({ ...p, stock }, activeCampaigns));
    }
    return results.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  },
  async searchProducts(query) {
    if (config.dataStore === 'postgres') {
      return searchProductsFromPostgres(query);
    }

    if (!query || String(query).trim().length < 2) {
      return [];
    }

    const q = normalizeSearchText(query);
    const products = await productRepo.getAll();
    const activeCampaigns = await listActiveCampaignDefinitions();
    const matches = products
      .filter((p) => p.isActive !== false && p.isListed !== false && (
        includesSearchText(p.name, q)
        || includesSearchText(p.barcode, q)
        || includesSearchText(p.sku, q)
      ))
      .slice(0, 10);

    const results = [];
    for (const product of matches) {
      const stock = await stockRepo.findByProductId(product.id);
      results.push(mapPosProductRow({ ...product, stock }, activeCampaigns));
    }

    return results;
  },

  async findProductByBarcode(barcode) {
    if (config.dataStore === 'postgres') {
      return findProductByBarcodeFromPostgres(barcode);
    }

    if (!barcode || !String(barcode).trim()) {
      throw new AppError(400, 'Barkod zorunludur');
    }

    const product = await productRepo.findByBarcode(String(barcode).trim());
    if (!product) {
      throw createNotFoundError('Barkod ile eşleşen ürün bulunamadı');
    }

    if (!product.isActive) {
      throw new AppError(400, 'Ürün pasif durumda, satış yapılamaz');
    }

    if (product.isListed === false) {
      throw new AppError(400, 'Ürün katalog modunda, satışa açık değil');
    }

    const stock = await stockRepo.findByProductId(product.id);

    const activeCampaigns = await listActiveCampaignDefinitions();
    return mapPosProductRow({ ...product, stock }, activeCampaigns);
  },

  async completeSale(payload, userContext) {
    if (!payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new AppError(400, 'Satış için en az bir ürün gereklidir');
    }

    // Validate payments Ç" support both legacy single method and new split payments
    let payments = [];
    if (payload.payments && Array.isArray(payload.payments) && payload.payments.length > 0) {
      for (const p of payload.payments) {
        if (!VALID_PAYMENT_METHODS.includes(p.method)) {
          throw new AppError(400, `Geçersiz ödeme yöntemi: ${p.method}`);
        }
        if (!p.amount || p.amount <= 0) {
          throw new AppError(400, 'Ödeme tutarı 0\'dan büyük olmalıdır');
        }
        payments.push({ method: p.method, amount: Number(p.amount) });
      }
    } else if (payload.paymentMethod) {
      if (!VALID_PAYMENT_METHODS.includes(payload.paymentMethod)) {
        throw new AppError(400, 'Geçersiz ödeme yöntemi');
      }
      payments = [{ method: payload.paymentMethod, amount: 0 }]; // amount filled after total calc
    } else {
      throw new AppError(400, 'Ödeme yöntemi belirtilmelidir');
    }

    const requestedUserId = userContext?.id || null;
    const user = requestedUserId ? await userRepo.findById(requestedUserId) : null;
    const userId = user?.id || null;
    const deskCode = String(payload.deskCode || userContext?.assignedDeskCode || '').trim().toUpperCase();

    ensureAssignedDeskForCashier(deskCode, userContext);
    await assertManagementDeskRegisterPin(userContext, deskCode || userContext?.assignedDeskCode || null);
    await ensureDeskActiveForCashier(deskCode || userContext?.assignedDeskCode || null, userContext);
    await ensureStoreOpenForPosSale();

    const now = new Date().toISOString();
    const saleId = uuidv4();
    const referenceNo = buildReferenceNo('sale');

    let totalAmount = 0;
    const saleItems = [];
    const activeCampaigns = await listActiveCampaignDefinitions();

    for (const item of payload.items) {
      if (!item.productId || !item.quantity || item.quantity <= 0) {
        throw new AppError(400, 'Geçersiz ürün veya miktar');
      }

      if (item.productId === BAG_PRODUCT_ID) {
        const unitPrice = 1;
        const lineTotal = unitPrice * item.quantity;
        totalAmount += lineTotal;

        saleItems.push({
          productId: BAG_PRODUCT_ID,
          barcode: 'BAG-001',
          name: 'Poşet',
          sku: 'BAG',
          quantity: item.quantity,
          unitPrice,
          totalPrice: lineTotal,
        });
        continue;
      }

      const product = await productRepo.findById(item.productId);
      if (!product) {
        throw new AppError(404, 'Ürün bulunamadı.');
      }

      const stock = await stockRepo.findByProductId(item.productId);
      const currentQty = stock?.shelfQuantity || 0;

      if (item.quantity > currentQty) {
        throw new AppError(400, `Yetersiz stok: ${product.name} (Mevcut: ${currentQty}, İstenen: ${item.quantity})`);
      }

      const pricedProduct = mapPosProductRow({ ...product, stock }, activeCampaigns);
      const unitPrice = Number(pricedProduct.effectivePrice || pricedProduct.currentPrice || pricedProduct.salePrice || product.salePrice || 0);
      const vatRate = resolveVatRate(product.vatRate, 20);
      const lineTotal = unitPrice * item.quantity;
      totalAmount += lineTotal;

      saleItems.push({
        productId: product.id,
        barcode: product.barcode || '',
        name: product.name,
        sku: product.sku,
        quantity: item.quantity,
        vatRate,
        unitPrice,
        totalPrice: lineTotal,
        salePrice: pricedProduct.salePrice,
        regularPrice: pricedProduct.regularPrice || pricedProduct.salePrice,
        effectivePrice: unitPrice,
        campaignPrice: pricedProduct.campaignPrice,
        discountedPrice: pricedProduct.discountedPrice,
        hasActiveDiscount: pricedProduct.hasActiveDiscount,
        hasActiveCampaign: pricedProduct.hasActiveCampaign,
        campaignId: pricedProduct.activeCampaign?.id || null,
        campaignName: pricedProduct.activeCampaign?.name || null,
        campaignDiscountRate: pricedProduct.activeCampaign?.effectiveDiscountRate || pricedProduct.effectiveDiscountRate || 0,
        appliedCampaignReason: pricedProduct.appliedCampaignReason || '',
        campaignConflictCount: pricedProduct.campaignConflictCount || 0,
        campaignConflictPolicy: pricedProduct.campaignConflictPolicy || null,
      });
    }

    const discount = Number(payload.discount) || 0;
    const grandTotal = Math.max(totalAmount - discount, 0);
    const giftCardCode = normalizeGiftCardCode(payload.giftCardCode);
    let appliedGiftCard = null;

    if (giftCardCode) {
      const settings = await settingsRepo.getSettings();
      const giftCards = Array.isArray(settings?.customerRelations?.giftCards) ? settings.customerRelations.giftCards : [];
      appliedGiftCard = giftCards.find((card) => normalizeGiftCardCode(card?.code) === giftCardCode) || null;
      if (!appliedGiftCard || appliedGiftCard.isActive === false) {
        throw new AppError(400, 'Hediye kartı bulunamadı veya pasif durumda');
      }

      const usageState = resolveGiftCardUsageState(appliedGiftCard);
      if (usageState.remainingUsage <= 0) {
        throw new AppError(400, 'Bu hediye kartının kullanım hakkı kalmadı');
      }
    }

    // Fill single-method payment amount if not split
    if (payments.length === 1 && payments[0].amount === 0) {
      payments[0].amount = grandTotal;
    }

    // Validate split payment total
    const paymentsTotal = payments.reduce((s, p) => s + p.amount, 0);
    const cashPayment = payments.find((p) => p.method === 'cash');
    const receivedAmount = payload.receivedAmount ? Number(payload.receivedAmount) : (cashPayment ? cashPayment.amount : paymentsTotal);

    if (paymentsTotal < grandTotal - 0.01) {
      throw new AppError(400, `Ödeme toplamı (${paymentsTotal.toFixed(2)}) satış tutarından (${grandTotal.toFixed(2)}) az olamaz`);
    }

    const changeAmount = cashPayment ? Math.max(receivedAmount - (cashPayment.amount || 0), 0) + Math.max(paymentsTotal - grandTotal, 0) : Math.max(paymentsTotal - grandTotal, 0);

    // Primary payment method = highest amount or first
    const primaryMethod = [...payments].sort((a, b) => b.amount - a.amount)[0].method;

    // Stokları düş ve hareket kayıtları oluştur
    for (const item of saleItems) {
      if (item.productId === BAG_PRODUCT_ID) {
        continue;
      }

      const stock = await stockRepo.findByProductId(item.productId);
      const previousQuantity = stock?.shelfQuantity || 0;
      const previousWarehouse = stock?.warehouseQuantity || 0;
      const nextQuantity = previousQuantity - item.quantity;

      await stockRepo.upsert(item.productId, {
        warehouseQuantity: previousWarehouse,
        shelfQuantity: nextQuantity,
      });

      await movementRepo.create({
        id: uuidv4(),
        productId: item.productId,
        productName: item.name,
        sku: item.sku,
        type: 'OUT',
        reasonCode: 'pos_sale',
        reasonLabel: 'Satış (POS İşlemi)',
        qty: item.quantity,
        previousQuantity,
        nextQuantity,
        previousTotalQuantity: previousWarehouse + previousQuantity,
        nextTotalQuantity: previousWarehouse + nextQuantity,
        fromLocation: 'reyon',
        toLocation: 'pos',
        location: 'reyon',
        note: `POS Satış - ${referenceNo}`,
        referenceNo,
        userId,
        userName: user?.name || userContext?.name || 'Kasiyer',
        createdAt: now,
      });
    }

    const sale = {
      id: saleId,
      referenceNo,
      type: 'sale',
      deskCode: deskCode || userContext?.assignedDeskCode || null,
      cashierId: userId,
      cashierName: user?.name || userContext?.name || 'Kasiyer',
      items: saleItems,
      subtotal: totalAmount,
      discount,
      totalAmount: grandTotal,
      paymentMethod: primaryMethod,
      payments,
      receivedAmount,
      changeAmount,
      customer: payload.customer || null,
      giftCardCode: giftCardCode || null,
      source: payload.source || null,
      automationSource: payload.automationSource || null,
      payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : null,
      status: 'completed',
      createdAt: now,
      mobileOrderId: payload.mobileOrderId || null,
    };

    await salesRepo.create(sale);

    if (payload.mobileOrderId) {
      try {
        await mobileOrderService.completeFromPos(payload.mobileOrderId, sale, userContext);
      } catch (err) {
        console.error('[POS] Failed to complete mobile order:', err.message);
      }
    }

    if (appliedGiftCard) {
      const settings = await settingsRepo.getSettings();
      const nextGiftCards = (Array.isArray(settings?.customerRelations?.giftCards) ? settings.customerRelations.giftCards : []).map((card) => {
        if (normalizeGiftCardCode(card?.code) !== giftCardCode) return card;
        const usageState = resolveGiftCardUsageState(card);
        const nextUsedCount = Math.min(usageState.usageLimit, usageState.usedCount + 1);
        const nextRemainingUsage = Math.max(0, usageState.usageLimit - nextUsedCount);
        return {
          ...card,
          usageLimit: usageState.usageLimit,
          maxUsage: usageState.usageLimit,
          usedCount: nextUsedCount,
          remainingUsage: nextRemainingUsage,
          status: nextRemainingUsage <= 0 ? 'used' : card?.status || 'active',
          updatedAt: now,
        };
      });

      await settingsRepo.updateSettings({
        ...settings,
        customerRelations: {
          ...(settings?.customerRelations || {}),
          giftCards: nextGiftCards,
        },
      });
    }

    return sale;
  },

  async createAutomaticSale(payload, userContext) {
    const deskCode = normalizeDeskCode(payload?.deskCode);
    const legacyAmount = roundMoney(payload?.amount);
    const minAmount = roundMoney(payload?.minAmount ?? legacyAmount);
    const maxAmount = roundMoney(payload?.maxAmount ?? legacyAmount);
    const requestedMinProductCount = Number(payload?.minProductCount);
    const requestedMaxProductCount = Number(payload?.maxProductCount);
    const attemptPayload = {
      source: AUTO_SALE_SOURCE,
      deskCode,
      minAmount,
      maxAmount,
      returnRate: payload?.returnRate,
      forceReturn: payload?.forceReturn === true,
      minProductCount: payload?.minProductCount,
      maxProductCount: payload?.maxProductCount,
    };

    await recordAutoSaleDeveloperLog({
      level: 'info',
      message: 'Otomatik satış denemesi başladı.',
      payload: attemptPayload,
      userContext,
    });

    try {
      assertDeskCode(deskCode);

      if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount) || minAmount <= 0 || maxAmount <= 0 || minAmount > maxAmount) {
        throw new AppError(400, 'Minimum tutar, maksimum tutardan büyük olamaz.', {
          errorCode: 'INVALID_AMOUNT_RANGE',
          fieldErrors: {
            minAmount: 'Minimum tutar, maksimum tutardan büyük olamaz.',
            maxAmount: 'Maksimum tutar minimum tutardan küçük olamaz.',
          },
          details: { minAmount, maxAmount },
        });
      }

      if (
        !Number.isFinite(requestedMinProductCount)
        || !Number.isFinite(requestedMaxProductCount)
        || requestedMinProductCount < 1
        || requestedMaxProductCount < 1
        || requestedMinProductCount > requestedMaxProductCount
      ) {
        throw new AppError(400, 'Minimum ürün çeşidi maksimumdan büyük olamaz.', {
          errorCode: 'INVALID_PRODUCT_COUNT_RANGE',
          fieldErrors: {
            minProductCount: 'Minimum ürün çeşidi maksimumdan büyük olamaz.',
            maxProductCount: 'Maksimum ürün çeşidi minimumdan küçük olamaz.',
          },
          details: { minProductCount: payload?.minProductCount, maxProductCount: payload?.maxProductCount },
        });
      }

      const minProductCount = clampPositiveInt(payload?.minProductCount, 1, { min: 1, max: 20 });
      const maxProductCount = clampPositiveInt(payload?.maxProductCount, 3, { min: 1, max: 20 });
      const { items, diagnostics } = await buildAutomaticSaleItems({ minAmount, maxAmount, minProductCount, maxProductCount });
      const paymentMethod = pickWeightedPaymentMethod();
      const now = new Date().toISOString();
      const userId = userContext?.id || null;
      const user = userId ? await userRepo.findById(userId) : null;
      const saleUserContext = user ? userContext : { ...(userContext || {}), id: null };
      const sale = await this.completeSale({
        deskCode,
        items,
        paymentMethod,
        customer: null,
        source: AUTO_SALE_SOURCE,
        automationSource: AUTO_SALE_SOURCE,
        payload: {
          source: AUTO_SALE_SOURCE,
          automationSource: AUTO_SALE_SOURCE,
          createdBy: user?.name || userContext?.name || 'system',
          createdByUserId: user?.id || null,
          generatedByPanel: true,
          generatedWithRealProducts: true,
          targetAmount: legacyAmount > 0 ? legacyAmount : null,
          minAmount,
          maxAmount,
          minProductCount,
          maxProductCount,
          poolCount: diagnostics.poolCount,
        },
      }, saleUserContext);

      const markedSale = {
        ...sale,
        source: AUTO_SALE_SOURCE,
        automationSource: AUTO_SALE_SOURCE,
        cashierName: sale.cashierName || 'Otomatik Satış Paneli',
        updatedAt: now,
      };

      await recordAutoSaleDeveloperLog({
        level: 'info',
        message: 'Otomatik satış başarıyla oluşturuldu.',
        payload: {
          ...attemptPayload,
          poolCount: diagnostics.poolCount,
          selectedItems: diagnostics.selectedItems,
          totalAmount: markedSale.totalAmount,
          paymentMethod,
          referenceNo: markedSale.referenceNo,
        },
        response: { success: true, referenceNo: markedSale.referenceNo, totalAmount: markedSale.totalAmount },
        userContext,
      });

      const returnRate = clampRatio(payload?.returnRate, 0.03);
      const hasRealItems = (markedSale.items || []).some((item) => item?.productId && item.productId !== BAG_PRODUCT_ID);
      let automaticReturnCreated = false;
      let automaticReturnReferenceNo = null;
      const shouldCreateReturn = payload?.forceReturn === true || (returnRate > 0 && Math.random() < returnRate);
      if (returnRate > 0 && hasRealItems && shouldCreateReturn) {
        try {
          const returnItems = (markedSale.items || [])
            .filter((item) => item?.productId && item.productId !== BAG_PRODUCT_ID)
            .slice(0, 1)
            .map((item) => ({
              productId: item.productId,
              quantity: 1,
              unitPrice: item.unitPrice,
              vatRate: item.vatRate,
            }));

          if (returnItems.length) {
            const returnRecord = await this.processReturn({
              deskCode,
              originalSaleRef: markedSale.referenceNo,
              refundMethod: markedSale.paymentMethod || paymentMethod,
              returnReason: 'automatic_random_return',
              returnReasonDetail: 'Otomatik satış paneli rastgele iade simülasyonu',
              source: AUTO_SALE_SOURCE,
              automationSource: AUTO_SALE_SOURCE,
              payload: {
                source: AUTO_SALE_SOURCE,
                automationSource: AUTO_SALE_SOURCE,
                generatedByPanel: true,
                originalAutomaticSaleRef: markedSale.referenceNo,
              },
              items: returnItems,
            }, saleUserContext);
            automaticReturnCreated = true;
            automaticReturnReferenceNo = returnRecord?.referenceNo || null;
            markedSale.automaticReturnRecord = returnRecord || null;
          }
        } catch (error) {
          await recordAutoSaleDeveloperLog({
            level: 'warning',
            message: `Otomatik iade oluşturulamadı: ${error?.message || 'Bilinmeyen hata'}`,
            payload: { ...attemptPayload, referenceNo: markedSale.referenceNo },
            error,
            userContext,
          });
          console.warn('[POS] Otomatik iade oluşturulamadı:', error?.message || error);
        }
      }

      return {
        ...markedSale,
        automaticReturnCreated,
        automaticReturnReferenceNo,
        automaticReturnRecord: markedSale.automaticReturnRecord || null,
      };
    } catch (error) {
      await recordAutoSaleDeveloperLog({
        level: error instanceof AppError ? 'warning' : 'error',
        message: error?.message || 'Otomatik satış oluşturulamadı.',
        payload: attemptPayload,
        error,
        userContext,
      });
      throw error instanceof AppError ? error : new AppError(500, error?.message || 'Otomatik satış oluşturulamadı.', { stack: error?.stack });
    }
  },

  async processReturn(payload, userContext) {
    if (!payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
      throw new AppError(400, 'İade için en az bir ürün gereklidir');
    }

    const refundMethod = payload.refundMethod && VALID_PAYMENT_METHODS.includes(payload.refundMethod)
      ? payload.refundMethod : 'cash';

    // If originalSaleRef provided, validate it
    let originalSale = null;
    let originalQuantitiesByProduct = new Map();
    let returnedQuantitiesByProduct = new Map();
    let totalOriginalQty = 0;
    let totalReturnQty = 0;
    let isFullReturn = false;
    let returnCoverage = 'manual';
    if (payload.originalSaleRef) {
      const allSales = await salesRepo.getAll();
      originalSale = allSales.find((s) => s.referenceNo === payload.originalSaleRef && s.type === 'sale');
      if (!originalSale) {
        throw new AppError(404, `Orijinal satış bulunamadı: ${payload.originalSaleRef}`);
      }

      const originalItems = Array.isArray(originalSale.items) ? originalSale.items : [];
      originalItems.forEach((item) => {
        const key = String(item?.productId || '');
        if (!key) return;
        const quantity = Math.max(0, Number(item?.quantity || 0));
        originalQuantitiesByProduct.set(key, (originalQuantitiesByProduct.get(key) || 0) + quantity);
      });

      const previousReturns = allSales.filter((row) => row.type === 'return' && row.originalSaleRef === payload.originalSaleRef);
      previousReturns.forEach((row) => {
        const returnedItems = Array.isArray(row.items) ? row.items : [];
        returnedItems.forEach((item) => {
          const key = String(item?.productId || '');
          if (!key) return;
          const quantity = Math.max(0, Number(item?.quantity || 0));
          returnedQuantitiesByProduct.set(key, (returnedQuantitiesByProduct.get(key) || 0) + quantity);
        });
      });

      for (const [productId, requestedQtyRaw] of originalQuantitiesByProduct.entries()) {
        const requestedQty = Math.max(0, Number(requestedQtyRaw || 0));
        totalOriginalQty += requestedQty;
        totalReturnQty += Math.max(0, Number(returnedQuantitiesByProduct.get(productId) || 0));
      }

      if (totalOriginalQty > 0 && totalReturnQty >= totalOriginalQty) {
        throw new AppError(400, 'Bu fişin iadesi daha önce tamamen yapılmış.');
      }
    }

    const requestedUserId = userContext?.id || null;
    const user = requestedUserId ? await userRepo.findById(requestedUserId) : null;
    const userId = user?.id || null;
    const deskCode = String(payload.deskCode || userContext?.assignedDeskCode || '').trim().toUpperCase();

    ensureAssignedDeskForCashier(deskCode, userContext);
    await assertManagementDeskRegisterPin(userContext, deskCode || userContext?.assignedDeskCode || null);
    await ensureDeskActiveForCashier(deskCode || userContext?.assignedDeskCode || null, userContext);

    const now = new Date().toISOString();
    const returnId = uuidv4();
    const referenceNo = buildReferenceNo('return');

    let totalAmount = 0;
    const returnItems = [];

    for (const item of payload.items) {
      if (!item.productId || !item.quantity || item.quantity <= 0) {
        throw new AppError(400, 'Geçersiz ürün veya miktar');
      }

      const product = await productRepo.findById(item.productId);
      if (!product) {
        throw new AppError(404, 'Ürün bulunamadı.');
      }

      if (originalSale) {
        const productIdKey = String(product.id);
        const originalQty = Math.max(0, Number(originalQuantitiesByProduct.get(productIdKey) || 0));
        if (originalQty <= 0) {
          throw new AppError(400, `${product.name} ürünü orijinal fişte bulunmuyor.`);
        }

        const alreadyReturnedQty = Math.max(0, Number(returnedQuantitiesByProduct.get(productIdKey) || 0));
        const requestedQty = Math.max(0, Number(item.quantity || 0));
        const remainingQty = Math.max(0, originalQty - alreadyReturnedQty);

        if (requestedQty > remainingQty) {
          throw new AppError(400, `${product.name} için iade adedi kalan miktarı aşıyor (kalan: ${remainingQty}).`);
        }

        returnedQuantitiesByProduct.set(productIdKey, alreadyReturnedQty + requestedQty);
      }

      const unitPrice = item.unitPrice || product.salePrice || 0;
      const vatRate = resolveVatRate(item.vatRate ?? product.vatRate, 20);
      const lineTotal = unitPrice * item.quantity;
      totalAmount += lineTotal;

      returnItems.push({
        productId: product.id,
        barcode: product.barcode || '',
        name: product.name,
        sku: product.sku,
        quantity: item.quantity,
        vatRate,
        unitPrice,
        totalPrice: lineTotal,
      });
    }

    if (originalSale) {
      let nextReturnedQty = 0;
      for (const productId of originalQuantitiesByProduct.keys()) {
        nextReturnedQty += Math.max(0, Number(returnedQuantitiesByProduct.get(productId) || 0));
      }

      isFullReturn = totalOriginalQty > 0 && nextReturnedQty >= totalOriginalQty;
      returnCoverage = isFullReturn ? 'full' : 'partial';
    }

    // Stokları artır ve hareket kayıtları oluştur
    for (const item of returnItems) {
      const stock = await stockRepo.findByProductId(item.productId);
      const previousQuantity = stock?.shelfQuantity || 0;
      const previousWarehouse = stock?.warehouseQuantity || 0;
      const nextQuantity = previousQuantity + item.quantity;

      await stockRepo.upsert(item.productId, {
        warehouseQuantity: previousWarehouse,
        shelfQuantity: nextQuantity,
      });

      await movementRepo.create({
        id: uuidv4(),
        productId: item.productId,
        productName: item.name,
        sku: item.sku,
        type: 'IN',
        reasonCode: 'customer_return',
        reasonLabel: 'Müşteri İadesi',
        qty: item.quantity,
        previousQuantity,
        nextQuantity,
        previousTotalQuantity: previousWarehouse + previousQuantity,
        nextTotalQuantity: previousWarehouse + nextQuantity,
        fromLocation: 'pos',
        toLocation: 'reyon',
        location: 'reyon',
        note: `POS İade - ${referenceNo}`,
        referenceNo,
        userId,
        userName: user?.name || userContext?.name || 'Kasiyer',
        createdAt: now,
      });
    }

    const returnRecord = {
      id: returnId,
      referenceNo,
      type: 'return',
      deskCode: deskCode || userContext?.assignedDeskCode || null,
      cashierId: userId,
      cashierName: user?.name || userContext?.name || 'Kasiyer',
      items: returnItems,
      subtotal: totalAmount,
      discount: 0,
      totalAmount,
      paymentMethod: refundMethod,
      payments: [{ method: refundMethod, amount: totalAmount }],
      originalSaleRef: payload.originalSaleRef || null,
      returnReason: payload.returnReason || null,
      returnReasonLabel: formatReturnReasonLabel(payload.returnReason, null),
      returnReasonDetail: payload.returnReasonDetail || null,
      returnCoverage,
      isFullReturn,
      customer: payload.customer || null,
      source: payload.source || null,
      automationSource: payload.automationSource || null,
      payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : null,
      receivedAmount: 0,
      changeAmount: 0,
      status: 'completed',
      createdAt: now,
    };

    await salesRepo.create(returnRecord);

    if (originalSale?.id) {
      const returnedQuantity = Array.from(returnedQuantitiesByProduct.values()).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
      const originalQuantity = Array.from(originalQuantitiesByProduct.values()).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
      const coverage = originalQuantity > 0 && returnedQuantity >= originalQuantity ? 'full' : 'partial';

      await salesRepo.updateById(originalSale.id, (current) => ({
        ...current,
        returnStatus: coverage,
        returnedQuantity,
        totalQuantity: originalQuantity,
        updatedAt: now,
      }));
    }

    return returnRecord;
  },

  async getAutomaticPanelTransactions(limit = 5) {
    const safeLimit = Math.max(1, Math.min(20, Number.parseInt(String(limit || 5), 10) || 5));
    const all = await salesRepo.getAll();
    return all
      .filter((sale) => {
        const payload = sale?.payload && typeof sale.payload === 'object' ? sale.payload : {};
        return sale?.source === AUTO_SALE_SOURCE
          || sale?.automationSource === AUTO_SALE_SOURCE
          || payload.source === AUTO_SALE_SOURCE
          || payload.automationSource === AUTO_SALE_SOURCE
          || payload.generatedByPanel === true;
      })
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
      .slice(0, safeLimit)
      .map(normalizeSaleRecordForRead);
  },

  async getTodaySales() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const rows = await salesRepo.findMany?.({ date: todayStr });

    return (rows || await salesRepo.getAll())
      .filter((s) => s.createdAt && s.createdAt.slice(0, 10) === todayStr)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async getSaleById(id) {
    const sale = await salesRepo.findById(id);
    if (!sale) {
      throw createNotFoundError('Satış kaydı bulunamadı');
    }
    return sale;
  },

  async getSaleByReference(ref) {
    if (!ref) throw new AppError(400, 'Referans numarası gerekli');
    const sale = await salesRepo.findByReference?.(ref) || (await salesRepo.getAll()).find((s) => s.referenceNo === ref);
    if (!sale) throw createNotFoundError('Referans numarası ile satış bulunamadı');
    return sale;
  },

  async getAllSales(filters = {}) {
    const pagination = resolveSalesPagination(filters);
    const repoFilters = {
      type: filters.type,
      date: filters.date,
      startDate: filters.startDate,
      endDate: filters.endDate,
      paymentMethod: filters.paymentMethod,
      originalSaleRef: filters.originalSaleRef,
    };

    const [repoItems, repoTotal] = await Promise.all([
      salesRepo.findMany?.(repoFilters, {
        skip: pagination.skip,
        take: pagination.limit ?? undefined,
      }),
      salesRepo.count?.(repoFilters),
    ]);

    if (repoItems && repoTotal !== null && repoTotal !== undefined) {
      const items = repoItems.map(normalizeSaleRecordForRead);
      return toSalesListResponse({
        items,
        total: repoTotal,
        page: pagination.page,
        limit: pagination.limit,
        full: pagination.full,
      });
    }

    let all = await salesRepo.getAll();

    if (filters.type) all = all.filter((s) => s.type === filters.type);
    if (filters.date) all = all.filter((s) => s.createdAt?.slice(0, 10) === filters.date);
    if (filters.startDate) all = all.filter((s) => s.createdAt >= filters.startDate);
    if (filters.endDate) {
      const endDate = String(filters.endDate).includes('T') ? String(filters.endDate) : `${filters.endDate}T23:59:59`;
      all = all.filter((s) => s.createdAt <= endDate);
    }
    if (filters.originalSaleRef) all = all.filter((s) => s.originalSaleRef === filters.originalSaleRef);
    if (filters.paymentMethod) {
      all = all.filter((s) => {
        if (s.payments) return s.payments.some((p) => p.method === filters.paymentMethod);
        return s.paymentMethod === filters.paymentMethod;
      });
    }

    const sorted = all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(normalizeSaleRecordForRead);
    const items = pagination.full ? sorted : sorted.slice(pagination.skip, pagination.skip + pagination.limit);
    return toSalesListResponse({
      items,
      total: sorted.length,
      page: pagination.page,
      limit: pagination.limit,
      full: pagination.full,
    });
  },

  async getDailyReport(date) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const all = await salesRepo.getAll();
    const dayRecords = all.filter((s) => s.createdAt?.slice(0, 10) === targetDate);

    const sales = dayRecords.filter((s) => s.type === 'sale');
    const returns = dayRecords.filter((s) => s.type === 'return');
    const salesPaymentTotals = aggregatePaymentsByMethod(sales);
    const returnsPaymentTotals = aggregatePaymentsByMethod(returns);

    const totalSalesRaw = roundMoney(sales.reduce((sum, s) => sum + toSafeAmount(s?.totalAmount), 0));
    const totalReturnsRaw = roundMoney(returns.reduce((sum, s) => sum + toSafeAmount(s?.totalAmount), 0));
    const totalSalesFromPayments = roundMoney(Object.values(salesPaymentTotals).reduce((sum, value) => sum + toSafeAmount(value), 0));
    const totalReturnsFromPayments = roundMoney(Object.values(returnsPaymentTotals).reduce((sum, value) => sum + toSafeAmount(value), 0));

    const totalSales = totalSalesFromPayments > 0 ? totalSalesFromPayments : totalSalesRaw;
    const totalReturns = totalReturnsFromPayments > 0 ? totalReturnsFromPayments : totalReturnsRaw;

    const paymentBreakdown = {};
    for (const method of VALID_PAYMENT_METHODS) {
      const salesAmt = roundMoney(salesPaymentTotals[method]);
      const returnsAmt = roundMoney(returnsPaymentTotals[method]);
      paymentBreakdown[method] = {
        sales: salesAmt,
        returns: returnsAmt,
        net: roundMoney(salesAmt - returnsAmt),
        label: PAYMENT_LABELS[method],
      };
    }

    const totalItems = sales.reduce((sum, s) => sum + (s.items || []).reduce((a, i) => a + toSafeAmount(i?.quantity), 0), 0);
    const avgSale = sales.length > 0 ? roundMoney(totalSales / sales.length) : 0;

    return {
      date: targetDate,
      salesCount: sales.length,
      returnsCount: returns.length,
      totalSales,
      totalReturns,
      netRevenue: roundMoney(totalSales - totalReturns),
      totalItems,
      avgSale,
      paymentBreakdown,
      sales,
      returns,
    };
  },

  async listDayEndClosings(filters = {}) {
    const days = Number(filters.days || 31);
    return dailyClosingService.listRecentClosings(days, {
      includeToday: String(filters.includeToday ?? 'true').toLowerCase() !== 'false',
      closingType: filters.closingType || null,
    });
  },

  async closeDayEnd(payload = {}, userContext = {}) {
    if (userContext?.role !== 'admin') {
      throw new AppError(403, 'Bu işlem için yetkiniz yok');
    }

    const closingType = String(payload.closingType || MANUAL_SNAPSHOT).trim().toLowerCase();
    if (closingType !== MANUAL_SNAPSHOT) {
      throw new AppError(400, 'POS ekranından yalnızca manuel gün sonu kapanışı alınabilir');
    }

    return dailyClosingService.closeCurrentManualSnapshot({ source: 'pos-manual-snapshot' });
  },
};
