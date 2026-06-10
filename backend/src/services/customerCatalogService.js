import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { categoryRepo } from '../repositories/categoryRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { stockRepo } from '../repositories/stockRepository.js';
import { AppError } from '../utils/appError.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';
import { normalizeUnit } from '../utils/unitSystem.js';
import { cleanSectionDisplayName } from '../utils/displayLabels.js';
import { enrichBatchExpiryState, summarizeBatchAvailability } from '../utils/batchExpiry.js';
import {
  applyCampaignPricingToProduct,
  buildCampaignSummariesFromProducts,
  listActiveCampaignDefinitions,
  resolveCustomerCampaignTitle,
} from './campaignPricingService.js';
import { productService } from './productService.js';
import { getActiveTenantId } from '../tenant/tenantContext.js';
import { getBarcodeCandidates, normalizeBarcodeInput } from '../utils/barcode.js';
import { storeLayoutService } from './storeLayoutService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STOCKOUT_LOOKBACK_DAYS = 30;
const MAX_STOCKOUT_DAYS = 180;
const REPLENISHMENT_FALLBACK_DAYS = 30;
const CUSTOMER_CAMPAIGN_PRODUCT_SCAN_LIMIT = 180;
const CUSTOMER_CAMPAIGN_PRODUCT_RETURN_LIMIT = 60;

export const matchesCustomerCatalogBarcode = (product = {}, value = '') => {
  if (product?.isListed === false || product?.isActive === false) return false;

  const candidates = new Set(getBarcodeCandidates(value).map(normalizeBarcodeInput).filter(Boolean));
  if (candidates.size === 0) return false;

  const supplierProducts = Array.isArray(product?.supplierProducts) ? product.supplierProducts : [];
  const exactValues = [
    product?.barcode,
    product?.sku,
    product?.supplierBarcode,
    product?.supplierSku,
    product?.supplierProductCode,
    ...supplierProducts
      .filter((supplierProduct) => supplierProduct?.isActive !== false)
      .flatMap((supplierProduct) => [
        supplierProduct?.barcode,
        supplierProduct?.supplierSku,
        supplierProduct?.supplierProductCode,
      ]),
  ].map(normalizeBarcodeInput).filter(Boolean);

  return exactValues.some((candidate) => candidates.has(candidate));
};

const normalizeListResult = (result) => {
  if (Array.isArray(result)) {
    return {
      items: result,
      pagination: { hasNextPage: false },
    };
  }

  return {
    items: Array.isArray(result?.items) ? result.items : [],
    pagination: result?.pagination || { hasNextPage: false },
  };
};

const collectStorefrontDeskCodes = (settings = {}) => {
  const codes = new Set();
  const pushCode = (value) => {
    const code = String(value || '').trim().toUpperCase();
    if (code) codes.add(code);
  };

  (Array.isArray(settings?.cashRegisters) ? settings.cashRegisters : []).forEach((row) => pushCode(row?.code || row?.deskCode || row?.name || row?.label));
  (Array.isArray(settings?.desks) ? settings.desks : []).forEach((row) => pushCode(row?.code || row?.deskCode || row?.name || row?.label));
  (Array.isArray(settings?.pos?.registers) ? settings.pos.registers : []).forEach((row) => pushCode(row?.code || row?.deskCode || row?.name || row?.label));
  Object.keys(settings?.deskActivationState && typeof settings.deskActivationState === 'object' ? settings.deskActivationState : {}).forEach(pushCode);
  Object.keys(settings?.deskPins && typeof settings.deskPins === 'object' ? settings.deskPins : {}).forEach(pushCode);

  return Array.from(codes);
};

const buildMaskedDeskPins = (settings = {}) => (
  collectStorefrontDeskCodes(settings).reduce((accumulator, code) => {
    accumulator[code] = true;
    return accumulator;
  }, {})
);

const buildStorefrontSettings = (settings = {}) => ({
  storeName: settings?.storeName || settings?.businessName || settings?.companyName || 'Shelfio',
  businessName: settings?.businessName || settings?.companyName || settings?.storeName || 'Shelfio',
  companyName: settings?.companyName || settings?.businessName || settings?.storeName || 'Shelfio',
  openingTime: settings?.openingTime || '10:00',
  closingTime: settings?.closingTime || '22:00',
  timezone: settings?.timezone || 'Europe/Istanbul',
  holidayMode: settings?.holidayMode === true,
  closedDays: Array.isArray(settings?.closedDays) ? settings.closedDays : [],
  weeklySchedule: Array.isArray(settings?.weeklySchedule) ? settings.weeklySchedule : [],
  specialDays: Array.isArray(settings?.specialDays) ? settings.specialDays : [],
  cashRegisters: Array.isArray(settings?.cashRegisters) ? settings.cashRegisters : [],
  desks: Array.isArray(settings?.desks) ? settings.desks : [],
  deskCodes: collectStorefrontDeskCodes(settings),
  deskPins: buildMaskedDeskPins(settings),
  deskActivationState: settings?.deskActivationState && typeof settings.deskActivationState === 'object' ? settings.deskActivationState : {},
  pos: settings?.pos && typeof settings.pos === 'object' ? settings.pos : {},
  customerRelations: {
    giftCards: Array.isArray(settings?.customerRelations?.giftCards) ? settings.customerRelations.giftCards : [],
  },
});

const normalizeTagList = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const dedupeTags = (tags = []) => {
  const seen = new Set();
  const result = [];
  tags.forEach((tag) => {
    const label = String(tag || '').trim();
    const key = label.toLocaleLowerCase('tr-TR');
    if (!label || seen.has(key)) return;
    seen.add(key);
    result.push(label);
  });
  return result;
};

const getProductTags = (product = {}) => dedupeTags([
  ...normalizeTagList(product.etiket),
  ...normalizeTagList(product.tag),
  ...normalizeTagList(product.tags),
  ...normalizeTagList(product.label),
  ...normalizeTagList(product.labels),
  ...normalizeTagList(product.keywords),
  ...normalizeTagList(product.subTags),
  ...normalizeTagList(product.subcategories),
  ...normalizeTagList(product.subCategories),
]);

const resolveProductDisplayCategory = (product = {}) => String(
  product.categoryName
  || product.categoryLabelName
  || product.displayCategory
  || product.category?.name
  || product.category
  || product.etiket
  || product.labelName
  || ''
).trim();

const buildCatalogCategories = ({ categories = [], products = [], includeEmpty = false } = {}) => {
  const countByCategoryId = new Map();
  const tagsByCategoryId = new Map();
  products.forEach((product) => {
    const key = String(product.categoryId || '').trim();
    if (!key) return;
    countByCategoryId.set(key, (countByCategoryId.get(key) || 0) + 1);
    tagsByCategoryId.set(key, dedupeTags([...(tagsByCategoryId.get(key) || []), ...getProductTags(product)]));
  });

  const activeRows = categories.filter((category) => category?.isActive !== false);
  const seen = new Set();
  const mapped = activeRows
    .map((category) => {
      const id = String(category.id || '').trim();
      if (!id) return null;
      seen.add(id);
      return {
        id,
        name: category.name,
        productCount: Number(countByCategoryId.get(id) || 0),
        isActive: category.isActive !== false,
        etiketler: dedupeTags([
          ...normalizeTagList(category.etiketler),
          ...normalizeTagList(category.tags),
          ...normalizeTagList(category.labels),
          ...(tagsByCategoryId.get(id) || []),
        ]),
      };
    })
    .filter((category) => category && (includeEmpty || category.productCount > 0));

  products.forEach((product) => {
    const id = String(product.categoryId || '').trim();
    if (!id || seen.has(id)) return;
    mapped.push({
      id,
      name: product.categoryName || 'Kategori',
      productCount: Number(countByCategoryId.get(id) || 0),
      isActive: true,
      etiketler: tagsByCategoryId.get(id) || [],
    });
    seen.add(id);
  });

  return mapped.sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'tr'));
};

const filterCustomerVisibleProducts = (products = []) => products.filter((product) => product?.isListed !== false && product?.isActive !== false);

const toCustomerCampaign = (campaign = {}) => {
  if (!campaign || typeof campaign !== 'object') return campaign;
  const customerTitle = resolveCustomerCampaignTitle(campaign);
  const internalName = String(campaign.internalName || campaign.name || '').trim();
  return {
    ...campaign,
    internalName,
    publicName: customerTitle,
    customerTitle,
    displayName: customerTitle,
    name: customerTitle,
  };
};

const toCustomerProduct = (product = {}) => {
  const activeCampaigns = Array.isArray(product.activeCampaigns)
    ? product.activeCampaigns.map((campaign) => toCustomerCampaign(campaign))
    : [];
  const activeCampaign = product.activeCampaign
    ? toCustomerCampaign(product.activeCampaign)
    : activeCampaigns[0] || null;
  const campaignLabel = activeCampaign?.name || activeCampaigns[0]?.name || product.campaignInfo || product.campaignBadge || '';

  return {
    ...product,
    activeCampaign,
    activeCampaigns,
    campaignInfo: campaignLabel,
    campaignBadge: campaignLabel,
    productListView: product.productListView ? {
      ...product.productListView,
      activeCampaign,
      activeCampaigns,
      campaignInfo: campaignLabel,
      campaignBadge: campaignLabel,
    } : product.productListView,
    productDetailView: product.productDetailView ? {
      ...product.productDetailView,
      activeCampaign,
      activeCampaigns,
      campaignInfo: campaignLabel,
      campaignBadge: campaignLabel,
    } : product.productDetailView,
  };
};

const toCustomerListProduct = (product = {}) => {
  const activeCampaigns = Array.isArray(product.activeCampaigns)
    ? product.activeCampaigns.map((campaign) => toCustomerCampaign(campaign))
    : [];
  const activeCampaign = product.activeCampaign
    ? toCustomerCampaign(product.activeCampaign)
    : activeCampaigns[0] || null;
  const campaignLabel = activeCampaign?.name || activeCampaigns[0]?.name || product.campaignInfo || product.campaignBadge || '';
  const currentPrice = Number(product.effectivePrice ?? product.currentPrice ?? product.discountedPrice ?? product.salePrice ?? product.price ?? 0) || 0;
  const salePrice = Number(product.salePrice ?? product.price ?? currentPrice) || currentPrice;
  const stockSummary = product.stockSummary && typeof product.stockSummary === 'object' ? product.stockSummary : {};

  return {
    id: product.id || product.productId,
    productId: product.productId || product.id,
    sku: product.sku || '',
    barcode: product.barcode || '',
    name: product.name || product.productName || '',
    productName: product.productName || product.name || '',
    brand: product.brand || product.brandName || '',
    brandName: product.brandName || product.brand || '',
    categoryId: product.categoryId || '',
    categoryName: resolveProductDisplayCategory(product),
    categoryLabelName: resolveProductDisplayCategory(product),
    displayCategory: resolveProductDisplayCategory(product),
    unit: product.unit || 'adet',
    salePrice,
    regularPrice: Number(product.regularPrice ?? salePrice) || salePrice,
    effectivePrice: Number(product.effectivePrice ?? currentPrice) || currentPrice || salePrice,
    price: currentPrice || salePrice,
    currentPrice: currentPrice || salePrice,
    originalPrice: Number(product.originalPrice ?? salePrice) || salePrice,
    discountedPrice: Number(product.discountedPrice ?? product.campaignPrice ?? currentPrice) || currentPrice,
    campaignPrice: product.campaignPrice ?? product.discountedPrice ?? null,
    hasActiveDiscount: product.hasActiveDiscount === true,
    hasActiveCampaign: product.hasActiveCampaign === true || product.hasActiveDiscount === true,
    discountAmount: Number(product.discountAmount || 0),
    effectiveDiscountRate: Number(product.effectiveDiscountRate || 0),
    activeCampaign,
    activeCampaignId: product.activeCampaignId || activeCampaign?.id || null,
    activeCampaignName: product.activeCampaignName || activeCampaign?.name || '',
    appliedCampaign: product.appliedCampaign ? toCustomerCampaign(product.appliedCampaign) : activeCampaign,
    appliedCampaignReason: product.appliedCampaignReason || '',
    activeCampaigns,
    candidateCampaigns: activeCampaigns,
    campaignConflictCount: Number(product.campaignConflictCount || 0),
    campaignConflictPolicy: product.campaignConflictPolicy || product.campaignResolutionStrategy || null,
    campaignDiscountAmount: Number(product.campaignDiscountAmount || product.discountAmount || 0),
    campaignDiscountPercent: Number(product.campaignDiscountPercent || product.effectiveDiscountRate || 0),
    campaignValidUntil: product.campaignValidUntil || activeCampaign?.endsAt || null,
    campaignInfo: campaignLabel,
    campaignBadge: campaignLabel,
    etiket: product.etiket || product.tag || '',
    tags: product.tags || product.labels || [],
    shelfCode: product.shelfCode || product.defaultShelfLocationCode || cleanSectionDisplayName(product.sectionName, ''),
    defaultShelfLocationCode: product.defaultShelfLocationCode || product.shelfCode || '',
    sectionName: cleanSectionDisplayName(product.sectionName, ''),
    available: Number(product.available ?? stockSummary.available ?? product.currentStock ?? product.totalStock ?? product.onHand ?? 0) || 0,
    currentStock: Number(product.currentStock ?? product.totalStock ?? product.onHand ?? stockSummary.available ?? 0) || 0,
    totalStock: Number(product.totalStock ?? product.onHand ?? product.currentStock ?? stockSummary.available ?? 0) || 0,
    onHand: Number(product.onHand ?? product.totalStock ?? product.currentStock ?? stockSummary.available ?? 0) || 0,
    isListed: product.isListed !== false,
    isActive: product.isActive !== false,
  };
};

const getPaginationMeta = (result) => result?.pagination || result?.meta?.pagination || null;

const listAllCatalogProducts = async ({ includeGeneralCampaigns = true } = {}) => {
  const allProducts = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const result = await productService.list({
      includeUnlisted: false,
      includeGeneralCampaigns,
      page,
      limit: 500,
      includeTotal: true,
    });
    const normalized = normalizeListResult(result);
    allProducts.push(...normalized.items);
    hasNextPage = Boolean(normalized.pagination?.hasNextPage) && normalized.items.length > 0;
    page += 1;
    if (Array.isArray(result) || page > 200) break;
  }

  return filterCustomerVisibleProducts(allProducts).map((product) => toCustomerListProduct(product));
};

const parseCatalogLimit = (value, fallback = 48, max = 120) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
};

const parseCatalogPage = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
};

const toNumber = (value) => {
  if (value == null) return 0;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const startOfToday = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

const stableHash = (value = '') => {
  const text = String(value || 'shelfio-product').trim() || 'shelfio-product';
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const buildDisplayOnlyReplenishmentDate = (product = {}, now = new Date()) => {
  const seed = product.id || product.productId || product.sku || product.barcode || product.productName || product.name;
  const offsetDays = stableHash(seed) % (REPLENISHMENT_FALLBACK_DAYS + 1);
  return new Date(startOfToday(now).getTime() - offsetDays * DAY_MS).toISOString();
};

const resolveAvailableStock = (product = {}) => {
  const stockSummary = product.stockSummary && typeof product.stockSummary === 'object' ? product.stockSummary : {};
  return Number(
    product.availableStock
    ?? product.available
    ?? stockSummary.available
    ?? product.currentStock
    ?? product.totalStock
    ?? product.onHand
    ?? stockSummary.onHand
    ?? 0
  ) || 0;
};

const resolveCanonicalUnit = (product = {}) => normalizeUnit(
  product.unit || product.productDetailView?.unit || 'adet',
  product.etiket || product.categoryName || product.category
);

const extractSaleItemUnit = (item = {}, fallbackEtiket = '') => {
  const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
  const rawUnit = payload.unit || payload.orderUnit || payload.baseUnit || payload.salesUnit || payload.uom || null;
  if (!rawUnit) return null;
  return normalizeUnit(rawUnit, fallbackEtiket);
};

const buildCustomerStockForecastFallback = (product = {}, now = new Date()) => ({
  productId: String(product.id || product.productId || ''),
  sku: product.sku || '',
  availableStock: resolveAvailableStock(product),
  unit: resolveCanonicalUnit(product),
  avgDailySales30d: null,
  salesWindowDays: STOCKOUT_LOOKBACK_DAYS,
  estimatedDaysUntilStockout: null,
  estimatedStockoutDate: null,
  confidence: 'low',
  reason: 'Tahmin için yeterli satış verisi yok',
  lastReplenishedAt: buildDisplayOnlyReplenishmentDate(product, now),
  isLastReplenishedDisplayOnly: true,
});

const buildCustomerStockForecast = async (product = {}) => {
  const productId = String(product.id || product.productId || '').trim();
  if (!productId) throw new AppError(400, 'Ürün kimliği bulunamadı');

  const availableStock = resolveAvailableStock(product);
  const unit = resolveCanonicalUnit(product);
  const now = new Date();
  const today = startOfToday(now);
  const fallback = buildCustomerStockForecastFallback(product, now);

  if (config.dataStore !== 'postgres') {
    return fallback;
  }

  const prisma = await getPrisma();
  const from = new Date(now.getTime() - (STOCKOUT_LOOKBACK_DAYS - 1) * DAY_MS);
  from.setHours(0, 0, 0, 0);
  const sku = String(product.sku || '').trim();
  const lineWhere = [{ productId }];
  if (sku) lineWhere.push({ sku });

  const [saleItems, lastReplenishmentMovement] = await withPostgresQueryLogging('GET /api/customer-auth/catalog/:id/stock-forecast', () => Promise.all([
    prisma.saleItem.findMany({
      where: {
        OR: lineWhere,
        quantity: { not: 0 },
        sale: {
          createdAt: { gte: from },
          OR: [
            { status: null },
            { status: { notIn: ['cancelled', 'void'] } },
          ],
        },
      },
      select: {
        quantity: true,
        sku: true,
        payload: true,
        sale: {
          select: {
            type: true,
            status: true,
          },
        },
      },
    }),
    prisma.stockMovement.findFirst({
      where: {
        productId,
        qty: { gt: 0 },
        OR: [
          { type: 'IN' },
          { reasonCode: { in: ['product_purchase', 'transfer_to_shelf', 'transfer_in', 'stock_in', 'shelf_replenishment'] } },
        ],
        NOT: {
          reasonCode: { in: ['pos_sale', 'customer_return', 'movement_cancel', 'write_off'] },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]));

  const baseResponse = {
    ...fallback,
    lastReplenishedAt: lastReplenishmentMovement?.createdAt
      ? new Date(lastReplenishmentMovement.createdAt).toISOString()
      : fallback.lastReplenishedAt,
    isLastReplenishedDisplayOnly: !lastReplenishmentMovement?.createdAt,
  };

  const seenUnits = new Set();
  let netSales30d = 0;

  saleItems.forEach((item) => {
    const saleType = String(item?.sale?.type || '').trim().toLocaleLowerCase('tr-TR');
    const quantity = Math.abs(toNumber(item?.quantity));
    if (!quantity) return;
    const saleUnit = extractSaleItemUnit(item, product.etiket || product.categoryName || product.category);
    if (saleUnit) seenUnits.add(saleUnit);
    const sign = ['return', 'refund'].includes(saleType) ? -1 : 1;
    netSales30d += sign * quantity;
  });

  const mismatchedUnits = [...seenUnits].filter((value) => value && value !== unit);
  if (mismatchedUnits.length > 0) {
    return {
      ...baseResponse,
      reason: 'Birim uyumsuzluğu nedeniyle hesaplanamadı',
    };
  }

  if (availableStock <= 0) {
    return {
      ...baseResponse,
      estimatedDaysUntilStockout: 0,
      estimatedStockoutDate: today.toISOString(),
      confidence: 'high',
      reason: 'Stokta yok',
    };
  }

  if (netSales30d <= 0) {
    return baseResponse;
  }

  const avgDailySales30d = Number((netSales30d / STOCKOUT_LOOKBACK_DAYS).toFixed(2));
  if (!(avgDailySales30d > 0)) {
    return baseResponse;
  }

  const estimatedDaysUntilStockout = Math.ceil(availableStock / avgDailySales30d);
  const confidence = saleItems.length >= 3 ? 'high' : 'medium';

  if (estimatedDaysUntilStockout > MAX_STOCKOUT_DAYS) {
    return {
      ...baseResponse,
      avgDailySales30d,
      estimatedDaysUntilStockout,
      confidence: 'medium',
      reason: 'Stok uzun süre yeterli görünüyor',
    };
  }

  return {
    ...baseResponse,
    avgDailySales30d,
    estimatedDaysUntilStockout,
    estimatedStockoutDate: new Date(today.getTime() + (estimatedDaysUntilStockout * DAY_MS)).toISOString(),
    confidence,
    reason: null,
  };
};

const buildPostgresCatalogWhere = (query = {}) => {
  const conditions = [
    { isListed: { not: false } },
    { isActive: { not: false } },
  ];
  if (query.categoryId) conditions.push({ categoryId: String(query.categoryId) });
  const search = String(query.search || query.q || '').trim();
  if (search) {
    conditions.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { etiket: { contains: search, mode: 'insensitive' } },
        { category: { is: { name: { contains: search, mode: 'insensitive' } } } },
        {
          supplierProducts: {
            some: {
              OR: [
                { supplierProductName: { contains: search, mode: 'insensitive' } },
                { supplierProductCode: { contains: search, mode: 'insensitive' } },
                { supplierSku: { contains: search, mode: 'insensitive' } },
                { barcode: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
      ],
    });
  }
  return { AND: conditions };
};

const mapPostgresCatalogProduct = (product = {}, activeCampaigns = []) => {
  const stock = product.stock || {};
  const salePrice = toNumber(product.salePrice);
  const reserved = Number(stock.reserved || 0);
  const batches = Array.isArray(stock.batches)
    ? stock.batches.map((batch) => enrichBatchExpiryState({
      ...(batch.payload && typeof batch.payload === 'object' ? batch.payload : {}),
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
  const physicalStock = batches.length
    ? batches.reduce((sum, batch) => sum + Number(batch.totalQuantity || 0), 0)
    : Number(stock.onHand ?? stock.shelfQuantity ?? stock.warehouseQuantity ?? 0) || 0;
  const available = batches.length
    ? batchAvailability.available
    : Number(stock.available ?? stock.onHand ?? stock.shelfQuantity ?? stock.warehouseQuantity ?? 0) || 0;
  const mapped = {
    id: product.id,
    productId: product.id,
    sku: product.sku,
    barcode: product.barcode || '',
    name: product.name,
    productName: product.name,
    brand: product.brand || '',
    brandName: product.brand || '',
    categoryId: product.categoryId || '',
    categoryName: resolveProductDisplayCategory(product),
    categoryLabelName: resolveProductDisplayCategory(product),
    displayCategory: resolveProductDisplayCategory(product),
    sectionName: cleanSectionDisplayName(product.section?.name, ''),
    shelfCode: product.shelfCode || cleanSectionDisplayName(product.section?.name, ''),
    defaultShelfLocationCode: product.shelfCode || '',
    unit: product.unit || 'adet',
    salePrice,
    price: salePrice,
    currentPrice: salePrice,
    originalPrice: salePrice,
    etiket: product.etiket || '',
    available,
    currentStock: available,
    totalStock: physicalStock,
    onHand: physicalStock,
    sellableStock: batches.length ? batchAvailability.sellableQuantity : available,
    expiredStock: batchAvailability.expiredQuantity,
    stockSummary: {
      physicalStock,
      sellableStock: batches.length ? batchAvailability.sellableQuantity : available,
      expiredStock: batchAvailability.expiredQuantity,
      available,
      reserved,
    },
    isListed: product.isListed !== false,
    isActive: product.isActive !== false,
  };
  return toCustomerListProduct(applyCampaignPricingToProduct(mapped, activeCampaigns, {
    includeGeneralCampaigns: true,
    channel: 'customer_mobile',
    audience: 'customer',
  }));
};

const listCatalogProductPageFromPostgres = async (query = {}) => {
  const prisma = await getPrisma();
  const page = parseCatalogPage(query.page);
  const limit = parseCatalogLimit(query.limit);
  const skip = (page - 1) * limit;
  const where = buildPostgresCatalogWhere(query);
  const activeCampaigns = await listActiveCampaignDefinitions();
  const [total, rows] = await withPostgresQueryLogging('GET /api/customer-auth/catalog products', () => Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take: limit,
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        brand: true,
        categoryId: true,
        sectionId: true,
        shelfCode: true,
        unit: true,
        salePrice: true,
        etiket: true,
        isListed: true,
        isActive: true,
        category: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
        stock: {
          select: {
            warehouseQuantity: true,
            shelfQuantity: true,
            onHand: true,
            available: true,
            reserved: true,
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
      },
    }),
  ]));

  return {
    products: rows.map((product) => mapPostgresCatalogProduct(product, activeCampaigns)),
    pagination: {
      mode: 'offset',
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(Number(total || 0) / limit)),
      hasNextPage: skip + rows.length < Number(total || 0),
    },
  };
};

const listCatalogCampaignProductsFromPostgres = async () => {
  const prisma = await getPrisma();
  const activeCampaigns = await listActiveCampaignDefinitions();
  if (!activeCampaigns.length) return [];
  const rows = await withPostgresQueryLogging('GET /api/customer-auth/catalog campaigns', () => prisma.product.findMany({
    where: buildPostgresCatalogWhere({}),
    orderBy: { name: 'asc' },
    take: CUSTOMER_CAMPAIGN_PRODUCT_SCAN_LIMIT,
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      brand: true,
      categoryId: true,
      sectionId: true,
      shelfCode: true,
      unit: true,
      salePrice: true,
      etiket: true,
      isListed: true,
      isActive: true,
      category: { select: { id: true, name: true } },
      section: { select: { id: true, name: true } },
      stock: {
        select: {
          warehouseQuantity: true,
          shelfQuantity: true,
          onHand: true,
          available: true,
          reserved: true,
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
    },
  }));
  return rows
    .map((product) => mapPostgresCatalogProduct(product, activeCampaigns))
    .filter((product) => product.hasActiveDiscount === true)
    .slice(0, CUSTOMER_CAMPAIGN_PRODUCT_RETURN_LIMIT);
};

const CATALOG_SEARCH_CHAR_MAP = {
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

const normalizeSearch = (value) => String(value || '')
  .replace(/[ÇçĞğIıİÖöŞşÜü]/g, (char) => CATALOG_SEARCH_CHAR_MAP[char] || char)
  .trim()
  .toLocaleLowerCase('tr-TR');

const listRepositoryCatalogBase = async () => {
  const [products, categories, stocks, settings] = await Promise.all([
    productRepo.getAll(),
    categoryRepo.getAll(),
    stockRepo.getAll(),
    settingsRepo.getSettings(),
  ]);
  const categoryById = new Map(categories.map((category) => [String(category.id || ''), category]));
  const stockByProductId = new Map(stocks.map((stock) => [String(stock.productId || stock.id || ''), stock]));
  const activeCampaigns = await listActiveCampaignDefinitions({ settings });
  const rows = filterCustomerVisibleProducts(products)
    .map((product) => ({
      ...product,
      name: product.name || product.productName,
      salePrice: product.salePrice ?? product.price ?? product.currentPrice,
      category: categoryById.get(String(product.categoryId || '')) || null,
      stock: stockByProductId.get(String(product.id || product.productId || '')) || null,
    }));

  return { rows, activeCampaigns, categories, settings };
};

const filterRepositoryCatalogRows = (rows = [], query = {}) => {
  const categoryId = String(query.categoryId || '').trim();
  const search = normalizeSearch(query.search || query.q);
  return rows
    .filter((product) => !categoryId || String(product.categoryId || '') === categoryId)
    .filter((product) => {
      if (!search) return true;
      return [
        product.name,
        product.productName,
        product.sku,
        product.barcode,
        product.brand,
        product.etiket,
        product.supplierName,
        product.supplierProductName,
        product.category?.name,
      ].some((value) => normalizeSearch(value).includes(search));
    })
    .sort((left, right) => String(left.name || left.productName || '').localeCompare(String(right.name || right.productName || ''), 'tr'));
};

const listCatalogProductPageFromRepositories = async (query = {}) => {
  const page = parseCatalogPage(query.page);
  const limit = parseCatalogLimit(query.limit);
  const { rows, activeCampaigns } = await listRepositoryCatalogBase();
  const filtered = filterRepositoryCatalogRows(rows, query);
  const offset = (page - 1) * limit;
  const pageRows = filtered.slice(offset, offset + limit);
  return {
    products: pageRows.map((product) => mapPostgresCatalogProduct(product, activeCampaigns)),
    pagination: {
      mode: 'offset',
      page,
      limit,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
      hasNextPage: offset + pageRows.length < filtered.length,
    },
  };
};

const listCatalogCampaignProductsFromRepositories = async () => {
  const { rows, activeCampaigns } = await listRepositoryCatalogBase();
  if (!activeCampaigns.length) return [];
  const campaignProducts = [];
  for (const product of rows
    .sort((left, right) => String(left.name || left.productName || '').localeCompare(String(right.name || right.productName || ''), 'tr'))
  ) {
    const mapped = mapPostgresCatalogProduct(product, activeCampaigns);
    if (mapped.hasActiveDiscount === true) campaignProducts.push(mapped);
    if (campaignProducts.length >= CUSTOMER_CAMPAIGN_PRODUCT_RETURN_LIMIT) break;
  }
  return campaignProducts;
};

const listCatalogFromRepositories = async (query = {}, mode = 'home') => {
  const page = parseCatalogPage(query.page);
  const limit = parseCatalogLimit(query.limit);
  const { rows, activeCampaigns, categories, settings } = await listRepositoryCatalogBase();
  const filtered = filterRepositoryCatalogRows(rows, query);
  const offset = (page - 1) * limit;
  const pageRows = filtered.slice(offset, offset + limit);
  const products = pageRows.map((product) => mapPostgresCatalogProduct(product, activeCampaigns));
  const campaignProducts = [];
  if (activeCampaigns.length) {
    for (const product of rows
      .sort((left, right) => String(left.name || left.productName || '').localeCompare(String(right.name || right.productName || ''), 'tr'))
    ) {
      const mapped = mapPostgresCatalogProduct(product, activeCampaigns);
      if (mapped.hasActiveDiscount === true) campaignProducts.push(mapped);
      if (campaignProducts.length >= CUSTOMER_CAMPAIGN_PRODUCT_RETURN_LIMIT) break;
    }
  }
  const campaigns = buildCampaignSummariesFromProducts(campaignProducts);

  return {
    mode: mode === 'products' ? 'products' : 'home',
    products,
    categories: buildCatalogCategories({ categories, products, includeEmpty: true }),
    campaigns,
    storefront: buildStorefrontSettings(settings),
    pagination: {
      mode: 'offset',
      page,
      limit,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit)),
      hasNextPage: offset + pageRows.length < filtered.length,
    },
    generatedAt: new Date().toISOString(),
  };
};

const listCatalogProductPage = async (query = {}) => {
  if (config.dataStore === 'postgres') {
    return listCatalogProductPageFromPostgres(query);
  }

  return listCatalogProductPageFromRepositories(query);
};

const listCatalogCampaignProducts = async () => {
  if (config.dataStore === 'postgres') {
    return listCatalogCampaignProductsFromPostgres();
  }

  return listCatalogCampaignProductsFromRepositories();
};

const listCatalogCategories = async () => {
  if (config.dataStore === 'postgres') {
    const prisma = await getPrisma();
    const tenantId = getActiveTenantId();

    const categories = await prisma.category.findMany({
      where: {
        tenantId,
        isActive: { not: false },
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        payload: true,
      },
    });

    const productCounts = await prisma.product.groupBy({
      by: ['categoryId'],
      where: {
        tenantId,
        isActive: { not: false },
        isListed: { not: false },
        stock: {
          available: { gt: 0 },
        },
      },
      _count: {
        id: true,
      },
    });

    const countMap = new Map();
    productCounts.forEach((item) => {
      if (item.categoryId) {
        countMap.set(item.categoryId, item._count.id);
      }
    });

    const seenIds = new Set();
    const mapped = categories.map((category) => {
      seenIds.add(category.id);
      const payload = category.payload && typeof category.payload === 'object' ? category.payload : {};
      const categoryEtiketler = dedupeTags([
        ...normalizeTagList(payload.etiketler || category.etiketler),
        ...normalizeTagList(payload.tags || category.tags),
        ...normalizeTagList(payload.labels || category.labels),
      ]);
      return {
        id: category.id,
        name: category.name,
        productCount: countMap.get(category.id) || 0,
        isActive: category.isActive !== false,
        etiketler: categoryEtiketler,
      };
    });

    for (const [catId, count] of countMap.entries()) {
      if (!seenIds.has(catId)) {
        mapped.push({
          id: catId,
          name: 'Kategori',
          productCount: count,
          isActive: true,
          etiketler: [],
        });
      }
    }

    return mapped.sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'tr'));
  }

  const [products, categories] = await Promise.all([
    listAllCatalogProducts({ includeGeneralCampaigns: false }),
    categoryRepo.getAll(),
  ]);

  return buildCatalogCategories({ categories, products, includeEmpty: true });
};

const CATALOG_AUX_CACHE_TTL_MS = 15_000;
const catalogAuxCache = new Map();

const getCatalogCached = async (key, loader) => {
  const now = Date.now();
  const cached = catalogAuxCache.get(key);
  if (cached && now - cached.createdAt < CATALOG_AUX_CACHE_TTL_MS) {
    return cached.value;
  }

  const value = await loader();
  catalogAuxCache.set(key, { createdAt: now, value });
  return value;
};

export const customerCatalogService = {
  async listCatalog(query = {}) {
    const mode = String(query.mode || query.view || 'home').trim().toLowerCase();

    if (mode === 'categories') {
      const [categories, settings] = await Promise.all([
        getCatalogCached('customer-categories', listCatalogCategories),
        getCatalogCached('settings', () => settingsRepo.getSettings()),
      ]);

      return {
        mode: 'categories',
        products: [],
        categories,
        campaigns: [],
        storefront: buildStorefrontSettings(settings),
        generatedAt: new Date().toISOString(),
      };
    }

    if (mode === 'all' || mode === 'full') {
      const [products, categories, settings] = await Promise.all([
        listAllCatalogProducts({ includeGeneralCampaigns: true }),
        categoryRepo.getAll(),
        settingsRepo.getSettings(),
      ]);

      const campaigns = buildCampaignSummariesFromProducts(products);

      return {
        mode: 'full',
        products,
        categories: buildCatalogCategories({ categories, products }),
        campaigns,
        storefront: buildStorefrontSettings(settings),
        generatedAt: new Date().toISOString(),
      };
    }

    if (config.dataStore !== 'postgres') {
      return listCatalogFromRepositories(query, mode);
    }

    const [{ products, pagination }, campaignProducts, categories, settings] = await Promise.all([
      listCatalogProductPage(query),
      getCatalogCached('campaign-products', listCatalogCampaignProducts),
      getCatalogCached('categories', () => categoryRepo.getAll()),
      getCatalogCached('settings', () => settingsRepo.getSettings()),
    ]);

    const campaigns = buildCampaignSummariesFromProducts(campaignProducts);

    return {
      mode: mode === 'products' ? 'products' : 'home',
      products,
      categories: buildCatalogCategories({ categories, products, includeEmpty: true }),
      campaigns,
      storefront: buildStorefrontSettings(settings),
      pagination,
      generatedAt: new Date().toISOString(),
    };
  },

  async getProductById(id) {
    const product = await productService.getById(id, { includeGeneralCampaigns: true });
    if (!product || product.isListed === false || product.isActive === false) {
      throw new AppError(404, 'Ürün bulunamadı');
    }
    const customerProduct = toCustomerProduct(product);
    const customerStockForecast = buildCustomerStockForecastFallback(customerProduct);
    return {
      ...customerProduct,
      customerStockForecast,
      productDetailView: customerProduct.productDetailView ? {
        ...customerProduct.productDetailView,
        customerStockForecast,
      } : customerProduct.productDetailView,
    };
  },

  async getProductByBarcode(value) {
    const normalized = normalizeBarcodeInput(value);
    if (!normalized) {
      throw new AppError(400, 'Geçerli bir barkod girin');
    }
    const exactCandidates = getBarcodeCandidates(value);

    let productId = '';
    if (config.dataStore === 'postgres') {
      const prisma = await getPrisma();
      const tenantId = getActiveTenantId();
      const product = await withPostgresQueryLogging('GET /api/customer-auth/catalog/barcode/:barcode', () => (
        prisma.product.findFirst({
          where: {
            tenantId,
            isListed: { not: false },
            isActive: { not: false },
            OR: [
              { barcode: { in: exactCandidates } },
              { sku: { in: exactCandidates } },
              {
                supplierProducts: {
                  some: {
                    isActive: { not: false },
                    OR: [
                      { barcode: { in: exactCandidates } },
                      { supplierSku: { in: exactCandidates } },
                      { supplierProductCode: { in: exactCandidates } },
                    ],
                  },
                },
              },
            ],
          },
          select: { id: true },
        })
      ));
      productId = product?.id || '';
    } else {
      const products = await productRepo.getAll();
      const product = products.find((row) => matchesCustomerCatalogBarcode(row, value));
      productId = product?.id || '';
    }

    if (!productId) {
      throw new AppError(404, 'Ürün bulunamadı');
    }
    return this.getProductById(productId);
  },

  async getProductStockForecast(id) {
    const product = await productService.getById(id, { includeGeneralCampaigns: false });
    if (!product || product.isListed === false || product.isActive === false) {
      throw new AppError(404, 'Ürün bulunamadı');
    }
    return buildCustomerStockForecast(toCustomerProduct(product));
  },

  async getCartRoutePlan(items) {
    const prisma = await getPrisma();
    const tenantId = getActiveTenantId();

    const productIds = items.map((it) => it.productId);
    const quantityMap = new Map(items.map((it) => [it.productId, it.quantity]));

    // Query active/listed products
    const dbProducts = await prisma.product.findMany({
      where: {
        tenantId,
        id: { in: productIds },
        isListed: { not: false },
        isActive: { not: false },
      },
      include: {
        section: {
          select: {
            id: true,
            name: true,
            number: true,
          },
        },
      },
    });

    const activeProductIds = new Set(dbProducts.map((p) => p.id));

    // Non-existent or inactive products go to missingLocation immediately
    const missingItems = [];
    for (const item of items) {
      if (!activeProductIds.has(item.productId)) {
        missingItems.push({
          productId: item.productId,
          productName: "Geçersiz Ürün",
          quantity: item.quantity,
          unit: "adet",
          imageUrl: "",
          sectionName: "Lokasyon bilgisi eksik",
          sectionNumber: null,
          readableLocation: "Lokasyon bilgisi eksik",
          locationCode: "",
          routeOrder: null,
          groupLabel: "Lokasyon bilgisi eksik",
          locationType: "unknown",
        });
      }
    }

    // Load layout
    const activeLayout = await storeLayoutService.getActiveLayout();
    const layoutItems = activeLayout?.items || [];
    const layoutSource = activeLayout?.source || 'fallback';

    // Helper: compute item center
    const getItemCenter = (item) => ({
      x: item.x + item.width / 2,
      y: item.y + item.height / 2,
    });

    // Helper: manhattan distance between two center points
    const manhattanDist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    // Helper: resolve nearby landmark for a given target point (returns label + center coords)
    const resolveNearbyLandmark = (targetX, targetY) => {
      // Landmarks considered: entrance, cashier, section, section_common_area
      const LANDMARK_TYPES = new Set(['entrance', 'cashier', 'section', 'section_common_area']);
      const LANDMARK_SEARCH_RADIUS = 400; // canvas units
      let closest = null;
      let closestDist = Infinity;
      for (const item of layoutItems) {
        if (!LANDMARK_TYPES.has(item.objectType)) continue;
        const center = getItemCenter(item);
        const dist = manhattanDist({ x: targetX, y: targetY }, center);
        if (dist < closestDist) {
          closestDist = dist;
          closest = { item, dist, center };
        }
      }
      if (!closest || closest.dist > LANDMARK_SEARCH_RADIUS) return null;
      const { item, center } = closest;
      const label = item.label || item.properties?.label || '';
      let type = item.objectType;
      let resolvedLabel = label;
      if (type === 'entrance') resolvedLabel = label || 'Mağaza Girişi';
      else if (type === 'cashier') resolvedLabel = label || 'Kasa';
      else if (type === 'section' || type === 'section_common_area') resolvedLabel = label || item.metadata?.sectionName || 'Reyon';
      return { type, label: resolvedLabel, centerX: center.x, centerY: center.y };
    };

    // Helper: generate Turkish instruction text from layout coordinate + landmark
    // Returns { short, details } — short is max ~1 landmark, details is verbose
    const buildInstructionText = (targetX, targetY, layoutItem, product, sectionName, sectionNumber) => {
      const coreParts = [];

      // 1. Section / reyon identifier
      if (sectionNumber != null) {
        coreParts.push(`Reyon ${sectionNumber}`);
      } else if (sectionName) {
        coreParts.push(sectionName);
      }

      // 2. Shelf side + no (combined for brevity)
      const shelfSide = String(product.shelfSide || '').trim().toUpperCase();
      const shelfSideLabel = shelfSide === 'L' ? 'Sol' : shelfSide === 'R' ? 'Sağ' : '';
      if (shelfSideLabel && product.shelfNo != null) {
        coreParts.push(`${shelfSideLabel} Raf ${product.shelfNo}`);
      } else if (shelfSideLabel) {
        coreParts.push(`${shelfSideLabel} Raf`);
      } else if (product.shelfNo != null) {
        coreParts.push(`Raf ${product.shelfNo}`);
      }

      // 3. Shelf level
      if (product.shelfLevel != null) {
        coreParts.push(`${product.shelfLevel}. kat`);
      }

      // 4. Spatial relation to nearest landmark (at most 1)
      let landmarkText = '';
      const landmark = resolveNearbyLandmark(targetX, targetY);
      if (landmark) {
        const itemCenter = getItemCenter(layoutItem);
        const dx = itemCenter.x - landmark.centerX;
        const dy = itemCenter.y - landmark.centerY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDx > absDy) {
          landmarkText = dx > 0 ? `${landmark.label} sağında` : `${landmark.label} solunda`;
        } else if (absDy > 0) {
          landmarkText = `${landmark.label} yakınında`;
        }
      }

      // Build details (verbose, all parts)
      const detailParts = [...coreParts];
      if (landmarkText) detailParts.push(landmarkText);
      const details = detailParts.length > 0 ? detailParts.join(' · ') : null;

      // Build short text: core parts + at most 1 landmark, capped at 4 segments
      const shortParts = [...coreParts];
      if (landmarkText && shortParts.length < 3) {
        shortParts.push(landmarkText);
      }
      const short = shortParts.length > 0 ? shortParts.join(' · ') : null;

      return { short, details };
    };

    const resolveNearbyLandmarkV2 = (targetX, targetY, targetItemId = '') => {
      const landmarkTypes = new Set([
        'section',
        'section_common_area',
        'cashier',
        'entrance',
        'exit',
        'warehouse_door',
        'service_area',
        'warehouse_common_area',
      ]);
      let closest = null;
      let closestDist = Infinity;
      for (const item of layoutItems) {
        if (targetItemId && String(item.id || '') === String(targetItemId)) continue;
        if (!landmarkTypes.has(item.objectType)) continue;
        const center = getItemCenter(item);
        const distance = manhattanDist({ x: targetX, y: targetY }, center);
        if (distance < closestDist) {
          closestDist = distance;
          closest = { item, center, distance };
        }
      }
      if (!closest) return null;

      const { item, center, distance } = closest;
      const metadata = { ...(item.properties?.metadata || {}), ...(item.metadata || {}) };
      const rawLabel = item.label || item.properties?.label || metadata.sectionName || '';
      const type = item.objectType;
      let label = rawLabel;
      if (type === 'entrance') label = rawLabel || 'Mağaza Girişi';
      else if (type === 'exit') label = rawLabel || 'Mağaza Çıkışı';
      else if (type === 'cashier') label = rawLabel || 'Kasa';
      else if (type === 'warehouse_door') label = rawLabel || 'Depo Kapısı';
      else if (type === 'warehouse_common_area') label = rawLabel || 'Ortak Depo Alanı';
      else if (type === 'service_area') label = rawLabel || 'Servis Alanı';
      else if (type === 'section' || type === 'section_common_area') label = rawLabel || 'Reyon';

      const dx = Number(targetX || 0) - center.x;
      const dy = Number(targetY || 0) - center.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      let direction = 'yakınında';
      if (distance <= 80) direction = 'yanında';
      else if (distance <= 180) direction = 'yakınında';
      else if (absDx > absDy) direction = dx > 0 ? 'sağında' : 'solunda';
      else direction = dy > 0 ? 'altında' : 'üstünde';

      return {
        label,
        direction,
        distance: Math.round(distance),
        type,
      };
    };

    const buildCoordinateAwareLocationText = (targetX, targetY, layoutItem, readableLocation) => {
      const landmark = resolveNearbyLandmarkV2(targetX, targetY, layoutItem?.id || '');
      if (!landmark?.label) {
        const fallbackText = readableLocation || 'Raf konumu bulundu';
        return {
          shortText: fallbackText,
          instructionText: fallbackText,
          nearbyLandmark: null,
        };
      }

      const shortText = `${landmark.label} ${landmark.direction}`;
      return {
        shortText,
        instructionText: readableLocation ? `${readableLocation} · ${shortText}` : shortText,
        nearbyLandmark: landmark,
      };
    };

    const getLayoutMetadata = (layoutItem = {}) => ({
      ...(layoutItem.properties?.metadata || {}),
      ...(layoutItem.metadata || {}),
    });

    const resolveLayoutSectionId = (layoutItem = {}) => {
      const metadata = getLayoutMetadata(layoutItem);
      return layoutItem.linkedSectionId
        || layoutItem.sectionId
        || metadata.sectionId
        || metadata.linkedSectionId
        || layoutItem.properties?.linkedSectionId
        || layoutItem.properties?.sectionId
        || null;
    };

    // Helper functions for matching
    const matchShelf = (layoutItem, product) => {
      // Match both 'shelf' and 'shelf_stack' objectTypes
      if (layoutItem.objectType !== 'shelf' && layoutItem.objectType !== 'shelf_stack') return false;

      // Match by shelfCode if available
      if (product.shelfCode && (layoutItem.locationCodeSnapshot === product.shelfCode || layoutItem.label === product.shelfCode)) {
        return true;
      }

      const metadata = getLayoutMetadata(layoutItem);
      // Match section first
      const sectionMatch = String(resolveLayoutSectionId(layoutItem) || '') === String(product.sectionId || '');
      if (!sectionMatch || !product.sectionId) return false;

      // Match shelfSide, shelfNo, shelfLevel
      const itemSide = String(layoutItem.properties?.shelfSide || metadata.shelfSide || metadata.side || '').trim().toUpperCase();
      const prodSide = String(product.shelfSide || '').trim().toUpperCase();
      if (itemSide !== prodSide || !prodSide) return false;

      const itemNo = Number(layoutItem.properties?.shelfNo ?? metadata.shelfNo ?? -1);
      const prodNo = Number(product.shelfNo ?? -2);
      if (itemNo !== prodNo) return false;

      if (layoutItem.objectType === 'shelf') {
        const itemLevel = Number(layoutItem.properties?.shelfLevel ?? metadata.shelfLevel ?? -1);
        const prodLevel = Number(product.shelfLevel ?? -2);
        if (itemLevel !== prodLevel) return false;
      }

      return true;
    };

    const matchSection = (layoutItem, product) => {
      if (layoutItem.objectType !== 'section') return false;
      return String(resolveLayoutSectionId(layoutItem) || '') === String(product.sectionId || '');
    };

    // Map each active product to coordinates/layout items or identify as missing
    const locatedProducts = []; // items with coordinates
    const fallbackProducts = []; // items without coordinates but with DB location info
    const missingProducts = []; // items with no location info

    for (const product of dbProducts) {
      const quantity = quantityMap.get(product.id) || 1;
      const unit = product.unit || 'adet';
      const imageUrl = product.payload?.imageUrl || product.payload?.productImageUrl || product.payload?.thumbnailUrl || product.payload?.gorselUrl || "";
      const sectionName = cleanSectionDisplayName(product.section?.name, '');
      const sectionNumber = product.section?.number ?? null;
      const locationCode = product.shelfCode || "";

      // Determine locationType and readableLocation first
      let locationType = "unknown";
      if (product.sectionId) {
        locationType = "section";
        if (product.shelfSide || product.shelfNo !== null || product.shelfLevel !== null) {
          locationType = "shelf";
        }
      } else if (product.depotLocationCode) {
        locationType = "warehouse";
      } else if (product.isVirtualLocation === true || product.depotAssignmentType === 'virtual_overflow') {
        locationType = "warehouse_common";
      }

      // Turkish readable location
      let readableLocation = "Lokasyon bilgisi eksik";
      if (locationType === "shelf") {
        const parts = [];
        if (sectionNumber != null) {
          parts.push(`Reyon ${sectionNumber}`);
        } else if (sectionName) {
          parts.push(sectionName);
        }
        
        let sideText = '';
        if (product.shelfSide) {
          const side = String(product.shelfSide).trim().toUpperCase();
          sideText = side === 'L' ? 'Sol' : side === 'R' ? 'Sağ' : side;
        }
        
        if (sideText && product.shelfNo != null) {
          parts.push(`${sideText} Raf ${product.shelfNo}`);
        } else {
          if (sideText) parts.push(`${sideText} Raf`);
          if (product.shelfNo != null) parts.push(`Raf ${product.shelfNo}`);
        }
        
        if (product.shelfLevel != null) {
          parts.push(`Kat ${product.shelfLevel}`);
          parts.push(`Göz ${product.shelfLevel}`);
        }
        readableLocation = parts.join(' · ');
      } else if (locationType === "section") {
        readableLocation = sectionNumber != null ? `Reyon ${sectionNumber} · Ortak Alan` : `${sectionName || "Reyon"} · Ortak Alan`;
      } else if (locationType === "warehouse") {
        readableLocation = `Depo · ${product.depotLocationCode}`;
      } else if (locationType === "warehouse_common") {
        readableLocation = "Ortak Depo Alanı";
      }

      const groupLabel = sectionNumber != null ? `Reyon ${sectionNumber}` : (sectionName || "Diğer");

      // Try finding coordinate match
      let coordinateItem = null;

      // 1. Try Shelf coordinate match
      if (locationType === "shelf") {
        coordinateItem = layoutItems.find((item) => matchShelf(item, product));
      }

      // 2. Try Section fallback coordinate match
      if (!coordinateItem && product.sectionId) {
        coordinateItem = layoutItems.find((item) => matchSection(item, product));
        if (coordinateItem) {
          locationType = "section";
        }
      }

      const productItem = {
        productId: product.id,
        productName: product.name,
        quantity,
        unit,
        imageUrl,
        sectionName,
        sectionNumber,
        readableLocation,
        locationCode,
        groupLabel,
        locationType,
      };

      if (coordinateItem && locationType !== "warehouse" && locationType !== "warehouse_common") {
        // Compute center coordinates
        const x = coordinateItem.x + coordinateItem.width / 2;
        const y = coordinateItem.y + coordinateItem.height / 2;

        // Build enriched instruction text from current published layout position + nearby landmarks.
        const instructionResult = buildCoordinateAwareLocationText(x, y, coordinateItem, readableLocation);

        // Confidence: 'high' for direct shelf/shelf_stack match, 'medium' for section fallback
        const matchedDirectly = locationType === 'shelf' && (coordinateItem.objectType === 'shelf' || coordinateItem.objectType === 'shelf_stack');
        const routeConfidence = matchedDirectly ? 'high' : 'medium';

        locatedProducts.push({
          ...productItem,
          x,
          y,
          layoutItemId: coordinateItem.id || null,
          nearbyLandmark: instructionResult.nearbyLandmark,
          shortText: instructionResult.shortText,
          instructionText: instructionResult.instructionText,
          routeConfidence,
          layoutItem: coordinateItem,
        });
      } else if (locationType !== "unknown") {
        if (locationType === "warehouse" || locationType === "warehouse_common") {
          productItem.groupLabel = "Depo";
        }
        fallbackProducts.push({
          ...productItem,
          x: null,
          y: null,
          layoutItemId: null,
          nearbyLandmark: null,
          shortText: productItem.readableLocation,
          instructionText: productItem.readableLocation,
          routeConfidence: 'low',
        });
      } else {
        productItem.groupLabel = "Reyon bilgisi yok";
        missingProducts.push(productItem);
      }
    }

    let route = [];
    let finalSource = layoutSource;
    let routeMode = 'coordinates';

    // Build a product lookup map for O(1) access during sorting
    const dbProductById = new Map(dbProducts.map((p) => [p.id, p]));

    // Deterministic sort comparator for products at the same coordinate
    const compareProductsInGroup = (a, b) => {
      const pa = dbProductById.get(a.productId) || {};
      const pb = dbProductById.get(b.productId) || {};
      const secA = a.sectionNumber ?? Infinity;
      const secB = b.sectionNumber ?? Infinity;
      if (secA !== secB) return secA - secB;
      const sideA = String(pa.shelfSide || '').toUpperCase();
      const sideB = String(pb.shelfSide || '').toUpperCase();
      if (sideA !== sideB) {
        if (sideA === 'L') return -1;
        if (sideB === 'L') return 1;
        return sideA.localeCompare(sideB, 'tr');
      }
      const noA = pa.shelfNo ?? 0;
      const noB = pb.shelfNo ?? 0;
      if (noA !== noB) return noA - noB;
      const lvA = pa.shelfLevel ?? 0;
      const lvB = pb.shelfLevel ?? 0;
      if (lvA !== lvB) return lvA - lvB;
      return (a.productName || '').localeCompare(b.productName || '', 'tr');
    };

    // Route calculation
    if (locatedProducts.length > 0) {
      // Find entrance start point
      const entrance = layoutItems.find((item) => item.objectType === 'entrance');
      let currentX, currentY;
      if (entrance) {
        currentX = entrance.x + entrance.width / 2;
        currentY = entrance.y + entrance.height / 2;
      } else {
        // Fallback: topmost-leftmost layout item center
        let minSum = Infinity;
        let fallbackItem = null;
        for (const li of layoutItems) {
          const cx = li.x + li.width / 2;
          const cy = li.y + li.height / 2;
          if (cx + cy < minSum) {
            minSum = cx + cy;
            fallbackItem = li;
          }
        }
        currentX = fallbackItem ? (fallbackItem.x + fallbackItem.width / 2) : 0;
        currentY = fallbackItem ? (fallbackItem.y + fallbackItem.height / 2) : 0;
      }

      // Group products by coordinates (exact same coordinates = same stop)
      const coordinateGroups = [];
      for (const item of locatedProducts) {
        const key = `${item.x},${item.y}`;
        let group = coordinateGroups.find((g) => g.key === key);
        if (!group) {
          group = {
            key,
            x: item.x,
            y: item.y,
            products: [],
          };
          coordinateGroups.push(group);
        }
        group.products.push(item);
      }

      // Greedy nearest-neighbor routing of coordinate groups
      // Deterministic tiebreaker: sectionNumber → shelfSide → shelfNo → productName
      const unvisitedGroups = [...coordinateGroups];
      const sortedGroups = [];
      const groupDistances = []; // distance from previous stop

      while (unvisitedGroups.length > 0) {
        let bestIndex = 0;
        let minDistance = Infinity;

        for (let i = 0; i < unvisitedGroups.length; i++) {
          const group = unvisitedGroups[i];
          const dist = Math.abs(currentX - group.x) + Math.abs(currentY - group.y);
          if (dist < minDistance) {
            minDistance = dist;
            bestIndex = i;
          } else if (dist === minDistance) {
            // Deterministic tiebreaker: compare first product in each group
            const curBest = unvisitedGroups[bestIndex];
            const a = curBest.products[0] || {};
            const b = group.products[0] || {};
            if (compareProductsInGroup(b, a) < 0) {
              bestIndex = i;
            }
          }
        }

        const nextGroup = unvisitedGroups.splice(bestIndex, 1)[0];
        groupDistances.push(minDistance);
        sortedGroups.push(nextGroup);
        currentX = nextGroup.x;
        currentY = nextGroup.y;
      }

      // Flatten groups and sort products inside each group stably
      let orderIndex = 1;
      for (let gi = 0; gi < sortedGroups.length; gi++) {
        const group = sortedGroups[gi];
        const distFromPrev = groupDistances[gi] || 0;
        const sortedProductsInGroup = group.products.sort(compareProductsInGroup);

        for (const item of sortedProductsInGroup) {
          const cleanItem = {
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unit: item.unit,
            imageUrl: item.imageUrl,
            sectionName: item.sectionName,
            sectionNumber: item.sectionNumber,
            readableLocation: item.readableLocation,
            locationCode: item.locationCode,
            routeOrder: orderIndex,
            groupLabel: item.groupLabel,
            locationType: item.locationType,
            location: {
              type: item.locationType,
              x: item.x ?? null,
              y: item.y ?? null,
              layoutItemId: item.layoutItemId ?? null,
              readableLocation: item.readableLocation,
              shortText: item.shortText ?? item.instructionText ?? item.readableLocation,
              nearbyLandmark: item.nearbyLandmark ?? null,
              instructionText: item.instructionText ?? null,
              details: item.instructionText ?? item.readableLocation,
              pickOrder: orderIndex,
              routeDistanceFromPrevious: Math.round(distFromPrev),
              routeConfidence: item.routeConfidence || 'high',
            },
          };
          route.push(cleanItem);
          orderIndex++;
        }
      }

      // Append fallbackProducts at the end of the route
      if (fallbackProducts.length > 0) {
        const sortedFallback = fallbackProducts.sort(compareProductsInGroup);
        for (const item of sortedFallback) {
          const cleanItem = {
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unit: item.unit,
            imageUrl: item.imageUrl,
            sectionName: item.sectionName,
            sectionNumber: item.sectionNumber,
            readableLocation: item.readableLocation,
            locationCode: item.locationCode,
            routeOrder: orderIndex,
            groupLabel: item.groupLabel,
            locationType: item.locationType,
            location: {
              type: item.locationType,
              x: null,
              y: null,
              layoutItemId: null,
              readableLocation: item.readableLocation,
              shortText: item.shortText ?? item.instructionText ?? item.readableLocation,
              nearbyLandmark: null,
              instructionText: item.instructionText ?? null,
              details: null,
              pickOrder: orderIndex,
              routeDistanceFromPrevious: null,
              routeConfidence: 'low',
            },
          };
          route.push(cleanItem);
          orderIndex++;
        }
      }
    } else if (fallbackProducts.length > 0) {
      // Fallback: no coordinate data available, sort by static fields
      const sortedFallback = fallbackProducts.sort(compareProductsInGroup);

      let orderIndex = 1;
      for (const item of sortedFallback) {
        const cleanItem = {
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unit: item.unit,
          imageUrl: item.imageUrl,
          sectionName: item.sectionName,
          sectionNumber: item.sectionNumber,
          readableLocation: item.readableLocation,
          locationCode: item.locationCode,
          routeOrder: orderIndex,
          groupLabel: item.groupLabel,
          locationType: item.locationType,
          location: {
            type: item.locationType,
            x: null,
            y: null,
            layoutItemId: null,
            readableLocation: item.readableLocation,
            shortText: item.shortText ?? item.instructionText ?? item.readableLocation,
            nearbyLandmark: null,
            instructionText: item.instructionText ?? null,
            details: null,
            pickOrder: orderIndex,
            routeDistanceFromPrevious: null,
            routeConfidence: 'low',
          },
        };
        route.push(cleanItem);
        orderIndex++;
      }

      finalSource = 'fallback';
      routeMode = 'fallback_code';
    }

    const missingLocation = [...missingProducts, ...missingItems];

    return {
      success: true,
      source: finalSource,
      route,
      missingLocation,
      summary: {
        totalItems: route.length + missingLocation.length,
        locatedItems: route.length,
        missingLocationCount: missingLocation.length,
        routeMode,
      },
    };
  },
};
