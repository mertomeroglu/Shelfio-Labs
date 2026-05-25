import { pricingAnalysisService } from './analysis/pricingAnalysisService.js';
import { listActiveCampaignDefinitions } from './campaignPricingService.js';
import { normalizeTurkishText } from '../utils/turkishText.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { purchaseOrderRepo } from '../repositories/purchaseOrderRepository.js';
import { purchaseOrderItemRepo } from '../repositories/purchaseOrderItemRepository.js';
import {
  normalizePurchaseOrderStatus,
  PURCHASE_ORDER_CANCELLED_STATUSES,
  PURCHASE_ORDER_COMPLETED_STATUSES,
  PURCHASE_ORDER_GOODS_RECEIPT_STATUSES,
  PURCHASE_ORDER_TERMINAL_STATUSES,
  PURCHASE_ORDER_WAITING_DELIVERY_STATUSES,
} from '../domain/purchaseOrderLifecycle.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const safeArray = (value) => (Array.isArray(value) ? value : []);
const uniq = (rows = []) => [...new Set(rows.map((value) => String(value || '').trim()).filter(Boolean))];
const DAY_MS = 24 * 60 * 60 * 1000;
const SALES_LOOKBACK_DAYS = 30;
const DISCOUNT_RECOMMENDATION_TYPES = new Set(['slow-moving', 'near-expiry', 'overstock', 'discount-opportunity', 'demand-down']);
const MANUAL_ONLY_CAMPAIGN_SUGGESTION_TYPES = new Set(['category', 'brand']);
const EXPIRED_PRODUCT_BLOCKING_REASONS = Object.freeze(['expired_product', 'expired_product_disposal_required']);
const SUGGESTION_PRECEDENCE = Object.freeze({
  'near-expiry': 100,
  overstock: 80,
  'slow-moving': 70,
  'discount-opportunity': 60,
  'demand-down': 55,
  'margin-watch': 20,
});
const normalizeCampaignText = (value, fallback = '') => normalizeTurkishText(String(value || fallback || ''))
  .replace(/\byavas\b/gi, 'yavaş')
  .replace(/\byavaş\b/gi, 'yavaş')
  .replace(/\burun\b/gi, 'ürün')
  .replace(/\bürün\b/gi, 'ürün')
  .replace(/\bicin\b/gi, 'için')
  .replace(/\bkisa\b/gi, 'kısa')
  .replace(/\bsureli\b/gi, 'süreli')
  .replace(/\btaslagi\b/gi, 'taslağı')
  .replace(/\bolustur\b/gi, 'oluştur')
  .replace(/\bolusturma\b/gi, 'oluşturma')
  .replace(/\bonce\b/gi, 'önce')
  .replace(/\bkapsamli\b/gi, 'kapsamlı')
  .replace(/\bstogu\b/gi, 'stoğu')
  .replace(/\bguvenli\b/gi, 'güvenli')
  .replace(/\bkontrollu\b/gi, 'kontrollü')
  .replace(/\bkorumali\b/gi, 'korumalı')
  .replace(/\bkosullarini\b/gi, 'koşullarını')
  .replace(/\bindirim kampanyasi\b/gi, 'indirim kampanyası')
  .replace(/\bsatis\b/gi, 'satış')
  .replace(/\bhizi\b/gi, 'hızı')
  .replace(/\bdusuk\b/gi, 'düşük')
  .replace(/\byuksek\b/gi, 'yüksek')
  .replace(/\bgore\b/gi, 'göre')
  .replace(/\bgercek\b/gi, 'gerçek')
  .replace(/\byakin\b/gi, 'yakın')
  .replace(/\bgun\b/gi, 'gün')
  .replace(/\bcakismasi\b/gi, 'çakışması')
  .replace(/\bonceliklendirildi\b/gi, 'önceliklendirildi')
  .replace(/\bgecen\b/gi, 'geçen')
  .replace(/\bkontrolunden\b/gi, 'kontrolünden')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeCampaignRow = (row = {}) => {
  const currentPrice = toNumber(row.currentPrice ?? row.salePrice, 0);
  const cost = toNumber(row.purchasePrice ?? row.supplierPrice, 0);
  const stockLevel = toNumber(row.totalStock ?? row.stockLevel, 0);
  const salesVelocity = toNumber(row.avgDailySales ?? row.salesVelocity, 0);
  const daysToExpiry = row.daysToExpiry == null ? null : toNumber(row.daysToExpiry, null);
  const criticalStock = toNumber(row.criticalStock ?? row.kritikStok ?? row.minStock ?? row.minimumStock ?? row.payload?.criticalStock, 0);
  const minimumStock = toNumber(row.minimumStock ?? row.minStock ?? row.payload?.minimumStock, criticalStock);
  const maxStock = toNumber(row.maxStock ?? row.maximumStock ?? row.payload?.maxStock, 0);
  const trendDirection = String(row.trendDirection || row.salesTrend || row.trend || '').trim().toLowerCase();
  return {
    id: String(row.productId || row.id || ''),
    productId: String(row.productId || row.id || ''),
    productName: normalizeCampaignText(row.productName || row.name, 'Bilinmeyen ürün'),
    sku: row.sku || '',
    categoryId: row.categoryId || '',
    category: row.categoryName || row.category || '-',
    brand: row.brand || row.brandName || row.supplierName || '-',
    supplierName: row.supplierName || '-',
    stockLevel,
    salesVelocity,
    criticalStock,
    minimumStock,
    maxStock,
    daysToExpiry,
    expiryDate: row.expiryDate || null,
    expirySource: row.expirySource || 'unknown',
    expiryBatchNo: row.expiryBatchNo || null,
    currentPrice,
    cost,
    currentMarginPercent: currentPrice > 0 ? Number((((currentPrice - cost) / currentPrice) * 100).toFixed(1)) : null,
    suggestedDiscount: toNumber(row.discountSuggestion?.discountRate ?? row.suggestedDiscount, 0),
    riskScore: toNumber(row.riskScore, 0),
    riskLevel: row.riskLevel || 'medium',
    riskFactors: safeArray(row.riskFactors),
    trendDirection,
    daysToStockout: row.daysToStockout ?? null,
    estimatedStockoutDate: row.estimatedStockoutDate || null,
    orderSuggestion: row.orderSuggestion || null,
    leadTimeDays: toNumber(row.leadTimeDays ?? row.supplierLeadTimeDays ?? row.orderSuggestion?.leadTimeDays, 0),
    replenishmentNeed: toNumber(row.replenishmentNeed ?? row.orderSuggestion?.suggestedQty, 0),
    salesDataMessage: salesVelocity > 0 ? '' : 'Tahmin için yeterli satış verisi yok.',
  };
};

const summarizeRows = (rows = []) => ({
  productIds: uniq(rows.map((row) => row.productId)),
  categoryIds: uniq(rows.map((row) => row.categoryId)),
  categoryNames: uniq(rows.map((row) => row.category)),
  brandNames: uniq(rows.map((row) => row.brand)),
  affectedProductCount: rows.length,
  avgDailySales: Number((rows.reduce((sum, row) => sum + toNumber(row.salesVelocity, 0), 0) / Math.max(1, rows.length)).toFixed(2)),
  avgStockLevel: Number((rows.reduce((sum, row) => sum + toNumber(row.stockLevel, 0), 0) / Math.max(1, rows.length)).toFixed(2)),
  avgMarginPercent: Number((rows.reduce((sum, row) => sum + toNumber(row.currentMarginPercent, 0), 0) / Math.max(1, rows.length)).toFixed(1)),
  minDaysToExpiry: rows
    .map((row) => row.daysToExpiry)
    .filter((value) => value !== null && value !== undefined)
    .reduce((min, value) => (min === null ? value : Math.min(min, value)), null),
});

const normalizeKey = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const getStockGuardrail = (row = {}) => {
  const stockLevel = toNumber(row.stockLevel, 0);
  const salesVelocity = toNumber(row.salesVelocity, 0);
  const criticalThreshold = Math.max(2, toNumber(row.criticalStock, 0), toNumber(row.minimumStock, 0));
  const nearCriticalThreshold = Math.max(criticalThreshold + 2, Math.ceil(criticalThreshold * 1.35), Math.ceil(salesVelocity * 7));
  const stockCoverageDays = salesVelocity > 0 ? Number((stockLevel / salesVelocity).toFixed(1)) : (stockLevel > 0 ? 999 : 0);
  const fastMoving = salesVelocity >= 1.5 || stockCoverageDays <= 7;
  const isCriticalStock = stockLevel <= criticalThreshold;
  const isNearCriticalFast = stockLevel <= nearCriticalThreshold && fastMoving;
  const isLowStock = isCriticalStock || isNearCriticalFast || stockCoverageDays <= 5;
  const blockingReasons = [];
  if (isCriticalStock) blockingReasons.push('critical_stock');
  if (!isCriticalStock && isNearCriticalFast) blockingReasons.push('near_critical_fast_moving');
  if (!isCriticalStock && !isNearCriticalFast && stockCoverageDays <= 5) blockingReasons.push('low_stock_coverage');
  return {
    stockLevel,
    salesVelocity,
    criticalThreshold,
    nearCriticalThreshold,
    stockCoverageDays,
    fastMoving,
    isCriticalStock,
    isLowStock,
    discountEligible: stockLevel > 0 && !isCriticalStock && !isNearCriticalFast,
    blockingReasons,
  };
};

const campaignMatchesRow = (campaign = {}, row = {}) => {
  const productId = String(row.productId || '').trim();
  const categoryId = String(row.categoryId || '').trim();
  const categoryLabelId = String(row.labelId || row.tagId || row.selectedTagId || row.categoryLabelId || '').trim();
  const categoryLabelName = normalizeKey(row.etiket || row.categoryLabelName || row.labelName || row.tag || '');
  const brand = normalizeKey(row.brand);
  const targetProducts = safeArray(campaign.targetProductIds).map(String);
  const targetCategories = safeArray(campaign.targetCategoryIds).map(String);
  const targetCategoryLabelIds = safeArray(campaign.targetCategoryLabelIds).map(String);
  const targetCategoryLabels = safeArray(campaign.targetCategoryLabels).map(normalizeKey);
  const targetBrands = safeArray(campaign.targetBrands).map(normalizeKey);
  const hasExplicitScope = targetProducts.length || targetCategories.length || targetCategoryLabelIds.length || targetBrands.length;
  const labelMatched = targetCategoryLabelIds.length
    ? (categoryLabelId && targetCategoryLabelIds.includes(categoryLabelId)) || (categoryLabelName && targetCategoryLabels.includes(categoryLabelName))
    : true;
  if (targetProducts.includes(productId)) return true;
  if (categoryId && targetCategories.includes(categoryId) && labelMatched) return true;
  if (brand && targetBrands.includes(brand)) return true;
  return !hasExplicitScope && !['product', 'category', 'brand'].includes(String(campaign.type || '').toLowerCase());
};

const findActiveCampaignConflict = (row = {}, activeCampaigns = []) => {
  const campaign = activeCampaigns.find((item) => campaignMatchesRow(item, row));
  if (!campaign) return null;
  return {
    campaignId: campaign.id,
    campaignName: campaign.name || campaign.internalName || campaign.publicName || 'Aktif kampanya',
    campaignType: campaign.type || 'general',
    discountRate: campaign.discountRate || 0,
    reason: 'active_campaign_conflict',
  };
};

const buildProcurementContext = async () => {
  const context = new Map();
  const [orders, items] = await Promise.all([
    purchaseOrderRepo.getAll().catch(() => []),
    purchaseOrderItemRepo.getAll().catch(() => []),
  ]);
  const orderById = new Map(safeArray(orders).map((order) => [String(order.id || order.orderId || ''), order]));
  const now = Date.now();
  safeArray(items).forEach((item) => {
    const productId = String(item.productId || '').trim();
    const orderId = String(item.orderId || item.purchaseOrderId || '').trim();
    if (!productId || !orderId) return;
    const order = orderById.get(orderId);
    if (!order) return;
    const status = normalizePurchaseOrderStatus(order.status || order.currentStatus, '');
    if (!status || PURCHASE_ORDER_TERMINAL_STATUSES.has(status) || PURCHASE_ORDER_CANCELLED_STATUSES.has(status) || PURCHASE_ORDER_COMPLETED_STATUSES.has(status)) return;
    const current = context.get(productId) || {
      hasOpenOrder: false,
      inboundQuantity: 0,
      waitingDelivery: false,
      goodsReceiptPending: false,
      longestLeadTimeDays: 0,
      orderIds: [],
      statuses: [],
    };
    const eta = order.estimatedDeliveryDate ? new Date(order.estimatedDeliveryDate).getTime() : null;
    const etaDays = eta && Number.isFinite(eta) ? Math.max(0, Math.ceil((eta - now) / DAY_MS)) : 0;
    const leadTimeDays = Math.max(toNumber(order.estimatedDeliveryDays ?? order.payload?.estimatedDeliveryDays, 0), etaDays);
    current.hasOpenOrder = true;
    current.inboundQuantity += Math.max(0, toNumber(item.quantity, 0));
    current.waitingDelivery = current.waitingDelivery || PURCHASE_ORDER_WAITING_DELIVERY_STATUSES.has(status);
    current.goodsReceiptPending = current.goodsReceiptPending || PURCHASE_ORDER_GOODS_RECEIPT_STATUSES.has(status);
    current.longestLeadTimeDays = Math.max(current.longestLeadTimeDays, leadTimeDays);
    current.orderIds.push(orderId);
    current.statuses.push(status);
    context.set(productId, current);
  });
  return context;
};

const getProcurementGuardrail = (row = {}, procurementContext = new Map()) => {
  const context = procurementContext.get(row.productId) || null;
  const leadTimeDays = Math.max(toNumber(row.leadTimeDays, 0), toNumber(context?.longestLeadTimeDays, 0));
  const orderSuggestion = row.orderSuggestion && typeof row.orderSuggestion === 'object' ? row.orderSuggestion : {};
  const rowHasSecuredPipeline = Boolean(
    orderSuggestion.hasOpenOrder
    || orderSuggestion.openOrderId
    || orderSuggestion.purchaseOrderId
    || toNumber(orderSuggestion.inboundQuantity, 0) > 0
  );
  const hasPipeline = Boolean(context?.hasOpenOrder || rowHasSecuredPipeline);
  const pipelineWeak = !hasPipeline || leadTimeDays >= 14 || Boolean(context?.goodsReceiptPending);
  const blockingReasons = [];
  if (!hasPipeline) blockingReasons.push('replenishment_pipeline_missing');
  if (leadTimeDays >= 14) blockingReasons.push('long_lead_time');
  if (context?.goodsReceiptPending) blockingReasons.push('goods_receipt_pending_not_secured');
  return {
    hasPipeline,
    pipelineWeak,
    inboundQuantity: toNumber(context?.inboundQuantity, 0),
    leadTimeDays,
    waitingDelivery: Boolean(context?.waitingDelivery),
    goodsReceiptPending: Boolean(context?.goodsReceiptPending),
    orderIds: uniq(context?.orderIds || []),
    statuses: uniq(context?.statuses || []),
    blockingReasons,
  };
};

const enrichRowWithGuardrails = (row = {}, { activeCampaigns = [], procurementContext = new Map() } = {}) => ({
  ...row,
  stockGuardrail: getStockGuardrail(row),
  procurementGuardrail: getProcurementGuardrail(row, procurementContext),
  activeCampaignConflict: findActiveCampaignConflict(row, activeCampaigns),
});

const getSuggestionModule = (id, type = 'product') => {
  if (id === 'near-expiry' || id === 'expired-product') return 'expiry';
  if (id === 'slow-moving' || id === 'demand-down') return 'sales';
  return 'product';
};

const resolveScope = (rows = [], type = 'product') => {
  if (MANUAL_ONLY_CAMPAIGN_SUGGESTION_TYPES.has(String(type || '').toLowerCase())) {
    type = 'product';
  }
  if (type === 'category') {
    const categoryIds = uniq(rows.map((row) => row.categoryId));
    const categoryNames = uniq(rows.map((row) => row.category));
    if (categoryIds.length === 1 || categoryNames.length === 1) {
      return { scopeType: 'category', scopeId: categoryIds[0] || categoryNames[0] || null, scopeName: categoryNames[0] || categoryIds[0] || 'Kategori' };
    }
  }
  if (type === 'brand') {
    const brandNames = uniq(rows.map((row) => row.brand));
    if (brandNames.length === 1) return { scopeType: 'brand', scopeId: brandNames[0], scopeName: brandNames[0] };
  }
  if (rows.length === 1) return { scopeType: 'product', scopeId: rows[0].productId, scopeName: rows[0].productName };
  const productIds = uniq(rows.map((row) => row.productId));
  return { scopeType: type === 'category' ? 'category' : 'product', scopeId: productIds.length ? `products:${productIds.slice(0, 8).join(',')}` : null, scopeName: `${rows.length} ürün` };
};

const buildRowSourceMetrics = (row = {}) => ({
  stockLevel: toNumber(row.stockLevel, 0),
  salesVelocity: toNumber(row.salesVelocity, 0),
  stockCoverageDays: row.stockGuardrail?.stockCoverageDays ?? null,
  criticalStock: toNumber(row.criticalStock, 0),
  minimumStock: toNumber(row.minimumStock, 0),
  currentMarginPercent: row.currentMarginPercent,
  daysToExpiry: row.daysToExpiry,
  trendDirection: row.trendDirection || null,
  riskScore: toNumber(row.riskScore, 0),
  activeCampaignId: row.activeCampaignConflict?.campaignId || null,
  activeCampaignName: row.activeCampaignConflict?.campaignName || null,
  activeCampaignConflictReason: row.activeCampaignConflict?.reason || null,
  procurementPipelineWeak: Boolean(row.procurementGuardrail?.pipelineWeak),
  procurementHasPipeline: Boolean(row.procurementGuardrail?.hasPipeline),
  inboundQuantity: toNumber(row.procurementGuardrail?.inboundQuantity, 0),
  leadTimeDays: toNumber(row.procurementGuardrail?.leadTimeDays, 0),
  goodsReceiptPending: Boolean(row.procurementGuardrail?.goodsReceiptPending),
});

const createSuppressedSuggestion = ({ id, row, blockingReasons = [], sourceMetrics = {} }) => ({
  id: `${id}-suppressed-${row.productId}`,
  recommendationType: id.replace(/-/g, '_'),
  primaryModule: getSuggestionModule(id),
  scopeType: 'product',
  scopeId: row.productId,
  scopeName: row.productName,
  productIds: [row.productId],
  categoryIds: row.categoryId ? [row.categoryId] : [],
  categoryNames: row.category && row.category !== '-' ? [row.category] : [],
  brandNames: row.brand && row.brand !== '-' ? [row.brand] : [],
  reasonCodes: id === 'expired-product'
    ? ['campaign_guardrail_suppressed', 'expired_product', 'expired_product_disposal_required']
    : ['campaign_guardrail_suppressed'],
  blockingReasons: uniq(blockingReasons),
  suggestedAction: id === 'expired-product'
    ? 'Kampanya oluşturma; SKT geçmiş ürün için imha / iade değerlendirmesi yap.'
    : 'Kampanya oluşturma; stok, aktif kampanya veya tedarik durumunu kontrol et.',
  recommendedDiscount: 0,
  recommendedDiscountRate: 0,
  riskLevel: 'blocked',
  priority: 'low',
  sourceMetrics,
  isSuppressed: true,
  suppressionReason: uniq(blockingReasons).join(',') || 'guardrail',
  conflictReason: uniq(blockingReasons).join(',') || 'guardrail',
  source: 'backend_analysis_engine',
});

const getRowBlockingReasons = (row = {}, suggestionId) => {
  const reasons = [];
  if (row.daysToExpiry != null && toNumber(row.daysToExpiry, 0) < 0) {
    reasons.push(...EXPIRED_PRODUCT_BLOCKING_REASONS);
  }
  if (row.activeCampaignConflict) reasons.push('active_campaign_conflict');
  if (DISCOUNT_RECOMMENDATION_TYPES.has(suggestionId)) {
    if (!row.stockGuardrail?.discountEligible) reasons.push(...safeArray(row.stockGuardrail?.blockingReasons));
    if (row.stockGuardrail?.isLowStock && row.procurementGuardrail?.pipelineWeak) reasons.push('weak_replenishment_for_low_stock');
    if (row.procurementGuardrail?.goodsReceiptPending && row.stockGuardrail?.isLowStock) reasons.push('goods_receipt_pending_not_secured');
    if (row.stockGuardrail?.isLowStock && !row.procurementGuardrail?.hasPipeline) reasons.push('low_stock_without_secured_purchase_order');
  }
  return uniq(reasons);
};

const filterRowsForSuggestion = ({ id, rows = [], assignedProductIds = new Set(), suppressed = [] }) => safeArray(rows)
  .filter((row) => {
    const blockingReasons = getRowBlockingReasons(row, id);
    const alreadyAssigned = assignedProductIds.has(row.productId);
    if (blockingReasons.length || alreadyAssigned) {
      suppressed.push(createSuppressedSuggestion({
        id,
        row,
        blockingReasons: alreadyAssigned ? ['lower_precedence_overlap'] : blockingReasons,
        sourceMetrics: buildRowSourceMetrics(row),
      }));
      return false;
    }
    return true;
  });

const buildEnhancedSuggestion = ({
  id,
  title,
  reason,
  rows,
  recommendedDiscount,
  type = 'product',
  priority = 'medium',
  reasonCodes = [],
  suggestedAction = '',
}) => {
  const summary = summarizeRows(rows);
  const primaryModule = getSuggestionModule(id, type);
  const scope = resolveScope(rows, type);
  const sourceMetrics = {
    ...summary,
    minStockCoverageDays: rows.reduce((min, row) => {
      const value = row.stockGuardrail?.stockCoverageDays;
      return value == null ? min : Math.min(min, value);
    }, Number.POSITIVE_INFINITY),
    activeCampaignConflictCount: rows.filter((row) => row.activeCampaignConflict).length,
    weakReplenishmentCount: rows.filter((row) => row.procurementGuardrail?.pipelineWeak).length,
    criticalStockCount: rows.filter((row) => row.stockGuardrail?.isCriticalStock).length,
    lowStockCount: rows.filter((row) => row.stockGuardrail?.isLowStock).length,
    reasonCodeCount: reasonCodes.length,
    rowMetrics: rows.slice(0, 12).map(buildRowSourceMetrics),
  };
  if (!Number.isFinite(sourceMetrics.minStockCoverageDays)) sourceMetrics.minStockCoverageDays = null;

  return {
    id,
    recommendationType: id.replace(/-/g, '_'),
    title: normalizeCampaignText(title),
    reason: normalizeCampaignText(reason),
    type,
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    scopeName: scope.scopeName,
    scopeLabel: scope.scopeName,
    primaryModule,
    module: primaryModule,
    priority,
    riskLevel: priority,
    suggestedAction: normalizeCampaignText(suggestedAction || 'Kampanya taslağı oluşturulmadan önce stok, marj ve tedarik guardrail sonucunu kontrol et.'),
    recommendedDiscount: clamp(Math.round(recommendedDiscount), 0, 80),
    recommendedDiscountRate: clamp(Math.round(recommendedDiscount), 0, 80),
    reasonCodes: uniq(reasonCodes),
    blockingReasons: [],
    isSuppressed: false,
    suppressionReason: '',
    ...summary,
    rows,
    sourceMetrics,
    guardrailSummary: {
      stockPassed: rows.every((row) => row.stockGuardrail?.discountEligible || id === 'margin-watch'),
      activeCampaignPassed: rows.every((row) => !row.activeCampaignConflict),
      procurementPassed: rows.every((row) => !(row.stockGuardrail?.isLowStock && row.procurementGuardrail?.pipelineWeak)),
    },
    source: 'backend_analysis_engine',
    signalBullets: [
      `Ortalama gunluk satis: ${summary.avgDailySales}.`,
      `Ortalama stok: ${summary.avgStockLevel}.`,
      summary.minDaysToExpiry == null ? 'SKT sinyali bulunmayan urunler ayrica isaretlendi.' : `En yakin SKT: ${summary.minDaysToExpiry} gun.`,
      `Guardrail: aktif kampanya, kritik stok ve tedarik cakismasi olmayan ${rows.length} urun.`,
    ],
    impactSummary: 'Satis hizi, stok, SKT, marj, aktif kampanya ve tedarik guardrail sinyalleri birlikte degerlendirildi.',
    riskSummary: id === 'margin-watch'
      ? 'Bu sinyal indirim onerisi degil; marj korunarak izleme veya fiyat duzeltme aksiyonu gerektirir.'
      : 'Indirim uygulanmadan once aktif kampanya, stok yeterliligi ve tedarik pipeline kontrolu gecildi.',
  };
};

// Single suggestion engine entry point: all API suggestions must pass through guardrails here.
const buildEnhancedSuggestionsFromRows = (rows = [], context = {}) => {
  const suppressed = [];
  const assignedProductIds = new Set();
  const sourceRows = safeArray(rows)
    .map(normalizeCampaignRow)
    .filter((row) => row.productId)
    .map((row) => enrichRowWithGuardrails(row, context));
  const eligibleSourceRows = sourceRows.filter((row) => {
    if (row.daysToExpiry == null || row.daysToExpiry >= 0) return true;
    suppressed.push(createSuppressedSuggestion({
      id: 'expired-product',
      row,
      blockingReasons: EXPIRED_PRODUCT_BLOCKING_REASONS,
      sourceMetrics: buildRowSourceMetrics(row),
    }));
    return false;
  });

  const slowRowsRaw = eligibleSourceRows
    .filter((row) => row.salesVelocity <= 1.2 && row.stockLevel > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 12);
  const expiryRowsRaw = eligibleSourceRows
    .filter((row) => row.daysToExpiry != null && row.daysToExpiry >= 0 && row.daysToExpiry <= 14 && row.stockLevel > 0)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry || b.riskScore - a.riskScore)
    .slice(0, 12);
  const overstockRowsRaw = eligibleSourceRows
    .filter((row) => row.stockLevel >= Math.max(20, row.salesVelocity * 21))
    .sort((a, b) => b.stockLevel - a.stockLevel)
    .slice(0, 12);
  const lowMarginRowsRaw = eligibleSourceRows
    .filter((row) => row.currentMarginPercent != null && row.currentMarginPercent < 12 && row.stockLevel > 0)
    .sort((a, b) => a.currentMarginPercent - b.currentMarginPercent)
    .slice(0, 8);
  const discountOpportunityRowsRaw = eligibleSourceRows
    .filter((row) => (
      row.suggestedDiscount >= 8
      && row.currentMarginPercent != null
      && row.currentMarginPercent >= 18
      && row.stockLevel >= Math.max(8, row.salesVelocity * 10)
    ))
    .sort((a, b) => b.suggestedDiscount - a.suggestedDiscount || b.currentMarginPercent - a.currentMarginPercent)
    .slice(0, 10);
  const demandDownRowsRaw = eligibleSourceRows
    .filter((row) => (
      row.stockLevel > 0
      && (
        row.trendDirection === 'down'
        || safeArray(row.riskFactors).some((factor) => String(factor || '').toLowerCase().includes('demand'))
      )
      && row.salesVelocity <= 2
    ))
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 10);
  const candidateSpecs = [
    {
      id: 'near-expiry',
      rows: expiryRowsRaw,
      build: (expiryRows) => buildEnhancedSuggestion({
        id: 'near-expiry',
        title: `${expiryRows.length} urunde SKT odakli kontrollu kampanya`,
        reason: 'Gercek batch SKT bilgisine gore SKT baskisi olan, aktif kampanya ve kritik stok cakismasi olmayan urunler onceliklendirildi.',
        rows: expiryRows,
        recommendedDiscount: expiryRows.some((row) => row.stockGuardrail?.isLowStock) ? 12 : (expiryRows.some((row) => row.daysToExpiry <= 3) ? 25 : 18),
        priority: expiryRows.some((row) => row.daysToExpiry <= 3) ? 'critical' : 'high',
        reasonCodes: ['near_expiry', 'expiry_pressure', 'stock_guardrail_passed'],
        suggestedAction: expiryRows.some((row) => row.stockGuardrail?.isLowStock)
          ? 'Kisa sureli, kontrollu SKT aksiyonu planla; agresif indirim uygulama.'
          : 'SKT baskısı olan ürünler için kısa süreli kampanya taslağı oluştur.',
      }),
    },
    {
      id: 'overstock',
      rows: overstockRowsRaw,
      build: (overstockRows) => {
        return buildEnhancedSuggestion({
          id: 'overstock',
          title: `${overstockRows.length} urun icin stok eritme kampanyasi`,
          reason: 'Stok seviyesi mevcut satis hizina gore yuksek ve tedarik/stok guardrail kontrolunden gecti.',
          rows: overstockRows,
          recommendedDiscount: 14,
          type: 'product',
          priority: 'medium',
          reasonCodes: ['overstock', 'product_scope', 'stock_guardrail_passed'],
          suggestedAction: 'Ürün bazlı stok eritme aksiyonu taslağı oluştur.',
        });
      },
    },
    {
      id: 'slow-moving',
      rows: slowRowsRaw,
      build: (slowRows) => buildEnhancedSuggestion({
        id: 'slow-moving',
        title: `${slowRows.length} yavas satan urun icin indirim kampanyasi`,
        reason: 'Satis hizi dusuk, stok bekleme riski yuksek ve stok/tedarik/campaign guardrail kontrolunden gecen urunler secildi.',
        rows: slowRows,
        recommendedDiscount: 16,
        priority: slowRows.some((row) => row.riskLevel === 'critical' || row.riskLevel === 'high') ? 'high' : 'medium',
        reasonCodes: ['slow_moving', 'demand_down', 'stock_guardrail_passed'],
        suggestedAction: 'Yavaş satan ve stoğu güvenli ürünler için kontrollü indirim kampanyası taslağı oluştur.',
      }),
    },
    {
      id: 'discount-opportunity',
      rows: discountOpportunityRowsRaw,
      build: (discountRows) => buildEnhancedSuggestion({
        id: 'discount-opportunity',
        title: `${discountRows.length} üründe güvenli indirim fırsatı`,
        reason: 'Analiz önerisi, marj ve stok güvenliği birlikte kontrol edilerek kampanya fırsatına dönüştürüldü.',
        rows: discountRows,
        recommendedDiscount: Math.min(18, Math.max(8, Math.round(discountRows.reduce((sum, row) => sum + row.suggestedDiscount, 0) / Math.max(1, discountRows.length)))),
        priority: 'medium',
        reasonCodes: ['discount_opportunity', 'margin_guardrail_passed', 'stock_guardrail_passed'],
        suggestedAction: 'Marjı koruyan, kısa süreli ürün bazlı indirim taslağı oluştur.',
      }),
    },
    {
      id: 'demand-down',
      rows: demandDownRowsRaw,
      build: (demandRows) => buildEnhancedSuggestion({
        id: 'demand-down',
        title: `${demandRows.length} üründe talep düşüşü aksiyonu`,
        reason: 'Satış trendi düşen ve stok/tedarik/campaign guardrail kontrolünden geçen ürünler seçildi.',
        rows: demandRows,
        recommendedDiscount: 10,
        priority: 'medium',
        reasonCodes: ['demand_down', 'sales_trend_down', 'stock_guardrail_passed'],
        suggestedAction: 'Talep düşüşü görülen ürünler için düşük yoğunluklu, kontrollü kampanya taslağı oluştur.',
      }),
    },
    {
      id: 'margin-watch',
      rows: lowMarginRowsRaw,
      build: (lowMarginRows) => buildEnhancedSuggestion({
        id: 'margin-watch',
        title: `${lowMarginRows.length} düşük marjlı üründe korumalı izleme`,
        reason: 'Marj seviyesi indirim icin riskli; dogrudan indirim yerine fiyat/maliyet izleme sinyali uretildi.',
        rows: lowMarginRows,
        recommendedDiscount: 0,
        priority: 'medium',
        reasonCodes: ['margin_watch', 'discount_not_recommended', 'margin_protection'],
        suggestedAction: 'İndirim oluşturma; fiyat, maliyet ve tedarik koşullarını kontrol et.',
      }),
    },
  ].sort((left, right) => (SUGGESTION_PRECEDENCE[right.id] || 0) - (SUGGESTION_PRECEDENCE[left.id] || 0));

  const suggestions = [];
  candidateSpecs.forEach((spec) => {
    const eligibleRows = filterRowsForSuggestion({
      id: spec.id,
      rows: spec.rows,
      assignedProductIds,
      suppressed,
    });
    if (!eligibleRows.length) return;
    eligibleRows.forEach((row) => assignedProductIds.add(row.productId));
    suggestions.push(spec.build(eligibleRows));
  });

  return { suggestions, suppressedSuggestions: suppressed };
};

export const __campaignAnalysisInternals = {
  buildEnhancedSuggestionsFromRows,
  getStockGuardrail,
  getProcurementGuardrail,
};

export const calculateCampaignImpact = ({
  rows = [],
  discountRate = 0,
  durationDays = 7,
  scopeLabel = 'Kampanya',
  currency = 'TRY',
  scopeProductCount = null,
  eligibleProductCount = null,
  affectedProductCount = null,
} = {}) => {
  const scopedRows = safeArray(rows).map(normalizeCampaignRow).filter((row) => row.productId);
  const resolvedScopeProductCount = Math.max(
    toNumber(scopeProductCount, 0),
    toNumber(eligibleProductCount, 0),
    toNumber(affectedProductCount, 0),
    scopedRows.length,
  );
  if (!scopedRows.length) {
    return {
      isEmpty: true,
      scopeLabel,
      currency,
      productCount: resolvedScopeProductCount,
      eligibleProductCount: resolvedScopeProductCount,
      affectedProductCount: resolvedScopeProductCount,
      analysisCandidateCount: 0,
      previewProductCount: 0,
      recommendation: 'Simülasyon için backend analiz verisi bulunamadı.',
      riskLevel: 'Bilgi yok',
      salesIncreasePct: 0,
      revenueChange: 0,
      marginImpact: 0,
      stockDepletionDays: 0,
      stockTurnEffect: 0,
      riskReductionScore: 0,
      modelName: 'analiz_oneri_motoru',
    };
  }

  const safeDiscount = clamp(toNumber(discountRate, 0), 0, 80);
  const safeDuration = Math.max(1, toNumber(durationDays, 7));
  let baseRevenue = 0;
  let campaignRevenue = 0;
  let baseProfit = 0;
  let campaignProfit = 0;
  let baseUnits = 0;
  let campaignUnits = 0;
  let totalStock = 0;
  let totalDailySales = 0;
  let riskScore = 0;

  scopedRows.forEach((row) => {
    const price = Math.max(0, toNumber(row.currentPrice, 0));
    const cost = Math.max(0, toNumber(row.cost, 0));
    const stock = Math.max(0, toNumber(row.stockLevel, 0));
    const dailySales = Math.max(0, toNumber(row.salesVelocity, 0));
    const expiryPressure = row.daysToExpiry == null ? 0 : clamp((14 - row.daysToExpiry) / 14, 0, 1);
    const slowBoost = dailySales <= 0.4 ? 1.35 : dailySales <= 1.2 ? 1.15 : 1;
    const estimatedBoost = clamp((safeDiscount / 100) * (0.85 + (safeDiscount / 100) * 0.9) * slowBoost * (1 + expiryPressure * 0.55), 0, 1.2);
    const projectedDailySales = dailySales * (1 + estimatedBoost);
    const projectedUnits = Math.min(stock, projectedDailySales * safeDuration);
    const baselineUnits = Math.min(stock, dailySales * safeDuration);
    const campaignPrice = price * (1 - safeDiscount / 100);

    baseUnits += baselineUnits;
    campaignUnits += projectedUnits;
    baseRevenue += baselineUnits * price;
    campaignRevenue += projectedUnits * campaignPrice;
    baseProfit += baselineUnits * Math.max(price - cost, 0);
    campaignProfit += projectedUnits * (campaignPrice - cost);
    totalStock += stock;
    totalDailySales += dailySales;
    if (campaignPrice <= cost) riskScore += 24;
    if (stock <= Math.max(3, dailySales * 5)) riskScore += 8;
    if (expiryPressure > 0.5) riskScore += 8;
  });

  const salesIncreasePct = baseUnits > 0 ? Number((((campaignUnits - baseUnits) / baseUnits) * 100).toFixed(1)) : 0;
  const revenueChange = Number((campaignRevenue - baseRevenue).toFixed(2));
  const marginImpact = baseProfit > 0 ? Number((((campaignProfit - baseProfit) / baseProfit) * 100).toFixed(1)) : 0;
  const stockDepletionDays = totalDailySales > 0 ? Number((totalStock / Math.max(totalDailySales, campaignUnits / safeDuration)).toFixed(1)) : 0;
  const stockTurnEffect = totalStock > 0 ? Number((clamp((campaignUnits - baseUnits) / totalStock, 0, 1) * 100).toFixed(1)) : 0;
  const riskReductionScore = Number(clamp(stockTurnEffect + Math.max(0, salesIncreasePct * 0.25), 0, 100).toFixed(1));
  const avgRisk = riskScore / Math.max(1, scopedRows.length);
  const riskLevel = avgRisk >= 24 ? 'Kritik' : avgRisk >= 14 ? 'Yüksek' : avgRisk >= 7 ? 'Orta' : 'Düşük';

  return {
    isEmpty: false,
    scopeLabel,
    currency,
    productCount: resolvedScopeProductCount,
    eligibleProductCount: resolvedScopeProductCount,
    affectedProductCount: resolvedScopeProductCount,
    analysisCandidateCount: scopedRows.length,
    previewProductCount: scopedRows.length,
    salesIncreasePct,
    revenueChange,
    marginImpact,
    stockDepletionDays,
    stockTurnEffect,
    riskReductionScore,
    riskLevel,
    modelName: 'analiz_oneri_motoru',
    recommendation: riskLevel === 'Kritik'
      ? 'İndirim marj veya stok riskini artırıyor; kapsam daraltılmalı.'
      : 'Analiz motoru indirim etkisini stok, satış hızı, SKT ve marj sinyallerine göre hesaplandı.',
    metricsSummary: resolvedScopeProductCount > scopedRows.length
      ? `${resolvedScopeProductCount} ürün kapsamı - ${scopedRows.length} analiz adayı`
      : `${scopedRows.length} ürün - backend analiz verisi`,
  };
};

const parseDateOnly = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = new Date(text.length <= 10 ? `${text}T00:00:00.000Z` : text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const resolveSimulationDurationDays = ({ durationDays, startsAt, endsAt, isIndefinite } = {}) => {
  const explicit = toNumber(durationDays, 0);
  if (explicit > 0) return Math.max(1, Math.round(explicit));
  if (isIndefinite) return 7;
  const start = parseDateOnly(startsAt);
  const end = parseDateOnly(endsAt);
  if (start && end && end >= start) {
    return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
  }
  return 7;
};

const toSimulationDateWindow = () => {
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);
  const start = new Date(end.getTime() - (SALES_LOOKBACK_DAYS - 1) * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
};

const normalizeBrandKey = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const buildSimulationProductWhere = (payload = {}) => {
  const type = String(payload.type || payload.campaignType || 'general').trim().toLowerCase();
  const where = {
    isActive: { not: false },
    isListed: { not: false },
  };
  const productIds = uniq([...safeArray(payload.productIds), ...safeArray(payload.targetProductIds)]);
  const categoryIds = uniq([...safeArray(payload.categoryIds), ...safeArray(payload.targetCategoryIds)]);
  const categoryLabelIds = uniq([...safeArray(payload.categoryLabelIds), ...safeArray(payload.targetCategoryLabelIds)]);
  const categoryLabels = uniq([...safeArray(payload.categoryLabels), ...safeArray(payload.targetCategoryLabels)]);
  const brands = uniq([...safeArray(payload.brands), ...safeArray(payload.targetBrands), payload.targetBrand]);

  if (type === 'product' && productIds.length) {
    where.id = { in: productIds };
  } else if (type === 'category' && categoryIds.length) {
    where.categoryId = { in: categoryIds };
    if (categoryLabels.length) {
      where.OR = [
        ...categoryLabels.map((label) => ({ etiket: { equals: label, mode: 'insensitive' } })),
      ];
    }
  } else if (type === 'brand' && brands.length) {
    where.OR = brands.map((brand) => ({ brand: { equals: brand, mode: 'insensitive' } }));
  }

  return { where, type, productIds, categoryIds, categoryLabelIds, brands };
};

const buildSalesMetricsByProduct = (sales = []) => {
  const metrics = new Map();
  sales.forEach((sale) => {
    const sign = sale.type === 'return' ? -1 : 1;
    safeArray(sale.saleItems).forEach((item) => {
      const productId = String(item.productId || '').trim();
      if (!productId || productId === '__bag__') return;
      const quantity = toNumber(item.quantity, 0) * sign;
      if (!Number.isFinite(quantity) || quantity === 0) return;
      const totalPrice = toNumber(item.totalPrice, toNumber(item.unitPrice, 0) * Math.abs(quantity)) * sign;
      const current = metrics.get(productId) || { quantity: 0, revenue: 0, transactionCount: 0 };
      current.quantity += quantity;
      current.revenue += totalPrice;
      current.transactionCount += 1;
      metrics.set(productId, current);
    });
  });
  return metrics;
};

const emptySimulationResult = ({
  scopeLabel = 'Kampanya',
  currency = 'TRY',
  productCount = 0,
  reason = 'insufficient_sales_history',
  explanation = 'Bu kampanya kapsamı için yeterli satış geçmişi bulunmadığından tahmin üretilemedi.',
} = {}) => ({
  isEmpty: false,
  scopeLabel,
  currency,
  productCount,
  eligibleProductCount: productCount,
  affectedProductCount: productCount,
  analysisCandidateCount: 0,
  previewProductCount: 0,
  estimatedSalesIncrease: null,
  estimatedRevenueChange: null,
  estimatedMarginImpact: null,
  estimatedStockDepletionDays: null,
  stockTurnoverImpact: null,
  riskReductionImpact: null,
  salesIncreasePct: null,
  revenueChange: null,
  marginImpact: null,
  stockDepletionDays: null,
  stockTurnEffect: null,
  riskReductionScore: null,
  dataQuality: {
    status: 'insufficient_data',
    reason,
    salesLookbackDays: SALES_LOOKBACK_DAYS,
    productsWithSales: 0,
    totalProducts: productCount,
  },
  hasEnoughSalesData: false,
  riskLevel: 'Bilgi yok',
  explanation,
  recommendation: explanation,
  metricsSummary: '',
  modelName: 'real_sales_campaign_simulation',
});

const calculateRealSalesCampaignSimulation = ({ products = [], salesMetricsByProduct, payload = {}, durationDays }) => {
  const safeDiscount = clamp(toNumber(payload.discountRate, 0), 0, 80);
  const currency = payload.currency || 'TRY';
  const scopeLabel = payload.scopeLabel || 'Kampanya';
  const rows = products.map((product) => {
    const stock = product.stock || {};
    const totalStock = Math.max(0, toNumber(stock.warehouseQuantity, 0) + toNumber(stock.shelfQuantity, 0));
    const currentPrice = Math.max(0, toNumber(product.salePrice, 0));
    const cost = Math.max(0, toNumber(product.purchasePrice, 0));
    const metrics = salesMetricsByProduct.get(product.id) || null;
    const soldQuantity = Math.max(0, toNumber(metrics?.quantity, 0));
    const avgDailySales = soldQuantity / SALES_LOOKBACK_DAYS;
    const expiryDate = stock.nearestExpiry || stock.fefoDefaultExpiry || safeArray(stock.batches)[0]?.skt || null;
    const daysToExpiry = expiryDate ? Math.ceil((new Date(expiryDate).getTime() - Date.now()) / DAY_MS) : null;

    return {
      productId: product.id,
      currentPrice,
      cost,
      totalStock,
      avgDailySales,
      soldQuantity,
      hasSalesData: avgDailySales > 0,
      daysToExpiry: Number.isFinite(daysToExpiry) ? daysToExpiry : null,
    };
  });

  const salesRows = rows.filter((row) => row.hasSalesData);
  if (!salesRows.length) {
    return emptySimulationResult({ scopeLabel, currency, productCount: products.length });
  }

  let baseUnits = 0;
  let campaignUnits = 0;
  let baseRevenue = 0;
  let campaignRevenue = 0;
  let baseProfit = 0;
  let campaignProfit = 0;
  let totalStock = 0;
  let totalCampaignDailySales = 0;
  let expiryPressureSum = 0;
  let marginRiskRows = 0;

  salesRows.forEach((row) => {
    const expiryPressure = row.daysToExpiry == null ? 0 : clamp((14 - row.daysToExpiry) / 14, 0, 1);
    const velocityFactor = row.avgDailySales <= 0.4 ? 1.35 : row.avgDailySales <= 1.2 ? 1.15 : 1;
    const estimatedBoost = clamp((safeDiscount / 100) * (0.85 + (safeDiscount / 100) * 0.9) * velocityFactor * (1 + expiryPressure * 0.55), 0, 1.2);
    const baselineUnits = Math.min(row.totalStock, row.avgDailySales * durationDays);
    const projectedDailySales = row.avgDailySales * (1 + estimatedBoost);
    const projectedUnits = Math.min(row.totalStock, projectedDailySales * durationDays);
    const campaignPrice = row.currentPrice * (1 - safeDiscount / 100);

    baseUnits += baselineUnits;
    campaignUnits += projectedUnits;
    baseRevenue += baselineUnits * row.currentPrice;
    campaignRevenue += projectedUnits * campaignPrice;
    baseProfit += baselineUnits * Math.max(row.currentPrice - row.cost, 0);
    campaignProfit += projectedUnits * (campaignPrice - row.cost);
    totalStock += row.totalStock;
    totalCampaignDailySales += projectedDailySales;
    expiryPressureSum += expiryPressure;
    if (campaignPrice <= row.cost) marginRiskRows += 1;
  });

  const estimatedSalesIncrease = baseUnits > 0 ? Number((((campaignUnits - baseUnits) / baseUnits) * 100).toFixed(1)) : null;
  const estimatedRevenueChange = Number((campaignRevenue - baseRevenue).toFixed(2));
  const estimatedMarginImpact = baseProfit > 0 ? Number((((campaignProfit - baseProfit) / baseProfit) * 100).toFixed(1)) : null;
  const estimatedStockDepletionDays = totalCampaignDailySales > 0 ? Number((totalStock / totalCampaignDailySales).toFixed(1)) : null;
  const stockTurnoverImpact = totalStock > 0 ? Number((clamp((campaignUnits - baseUnits) / totalStock, 0, 1) * 100).toFixed(1)) : null;
  const avgExpiryPressure = expiryPressureSum / Math.max(1, salesRows.length);
  const riskReductionImpact = Number(clamp((stockTurnoverImpact || 0) + (avgExpiryPressure * 35) - ((marginRiskRows / salesRows.length) * 20), 0, 100).toFixed(1));
  const marginRiskShare = marginRiskRows / salesRows.length;
  const riskLevel = marginRiskShare >= 0.35 ? 'Yüksek' : marginRiskShare >= 0.15 ? 'Orta' : 'Düşük';
  const explanation = 'Simülasyon gerçek satış geçmişi, stok ve kampanya kapsamına göre hesaplanır.';

  return {
    isEmpty: false,
    scopeLabel,
    currency,
    productCount: products.length,
    eligibleProductCount: products.length,
    affectedProductCount: products.length,
    analysisCandidateCount: salesRows.length,
    previewProductCount: salesRows.length,
    estimatedSalesIncrease,
    estimatedRevenueChange,
    estimatedMarginImpact,
    estimatedStockDepletionDays,
    stockTurnoverImpact,
    riskReductionImpact,
    salesIncreasePct: estimatedSalesIncrease,
    revenueChange: estimatedRevenueChange,
    marginImpact: estimatedMarginImpact,
    stockDepletionDays: estimatedStockDepletionDays,
    stockTurnEffect: stockTurnoverImpact,
    riskReductionScore: riskReductionImpact,
    dataQuality: {
      status: salesRows.length === products.length ? 'complete' : 'partial',
      reason: salesRows.length === products.length ? 'ok' : 'partial_sales_history',
      salesLookbackDays: SALES_LOOKBACK_DAYS,
      productsWithSales: salesRows.length,
      totalProducts: products.length,
      totalBaselineUnits: Number(baseUnits.toFixed(2)),
      totalCampaignUnits: Number(campaignUnits.toFixed(2)),
    },
    hasEnoughSalesData: true,
    riskLevel,
    explanation,
    recommendation: explanation,
    metricsSummary: `${salesRows.length}/${products.length} ürün satış geçmişiyle hesaplandı • ${SALES_LOOKBACK_DAYS} günlük satış penceresi`,
    modelName: 'real_sales_campaign_simulation',
  };
};

export const campaignAnalysisService = {
  async getSuggestions(query = {}) {
    const analysis = await pricingAnalysisService.getAnalysis({ ...query, limit: undefined });
    const settings = await settingsRepo.getSettings().catch(() => null);
    const [activeCampaigns, procurementContext] = await Promise.all([
      listActiveCampaignDefinitions({ settings }).catch(() => []),
      buildProcurementContext(),
    ]);
    const isFullPayload = query.full === true || query.full === 'true';
    const defaultLimit = isFullPayload ? 500 : 80;
    const minimumLimit = isFullPayload ? 50 : 10;
    const maximumLimit = isFullPayload ? 1000 : 200;
    const responseLimit = Math.min(maximumLimit, Math.max(minimumLimit, toNumber(query.limit, defaultLimit)));
    const normalizedRows = safeArray(analysis.rows).map(normalizeCampaignRow);
    const eligibleProductCount = toNumber(analysis?.summary?.totalAnalyzedProducts, normalizedRows.length);
    const rows = normalizedRows
      .map((row) => enrichRowWithGuardrails(row, { activeCampaigns, procurementContext }))
      .sort((left, right) => toNumber(right.riskScore, 0) - toNumber(left.riskScore, 0))
      .slice(0, responseLimit);
    const suggestionSourceRows = isFullPayload ? analysis.rows : rows;
    const suggestionResult = buildEnhancedSuggestionsFromRows(suggestionSourceRows, { activeCampaigns, procurementContext });
    return {
      generatedAt: new Date().toISOString(),
      source: 'backend_analysis_engine',
      eligibleProductCount,
      analysisCandidateCount: rows.length,
      analysisLimit: responseLimit,
      activeCampaignGuardrailCount: activeCampaigns.length,
      suppressedSuggestionCount: suggestionResult.suppressedSuggestions.length,
      rows,
      suggestions: suggestionResult.suggestions,
      suppressedSuggestions: suggestionResult.suppressedSuggestions,
    };
  },

  async simulate(payload = {}) {
    const prisma = await getPrisma();
    const { where, type, productIds, categoryIds, brands } = buildSimulationProductWhere(payload);
    const durationDays = resolveSimulationDurationDays(payload);
    const currency = payload.currency || 'TRY';
    const scopeLabel = payload.scopeLabel || (
      type === 'product' ? 'Ürün Bazlı Kampanya'
        : type === 'category' ? 'Kategori Bazlı Kampanya'
          : type === 'brand' ? 'Marka Bazlı Kampanya'
            : 'Genel Mağaza İndirimi'
    );

    if (type === 'product' && !productIds.length) {
      return emptySimulationResult({
        scopeLabel,
        currency,
        reason: 'empty_product_scope',
        explanation: 'Simülasyon için en az bir ürün seçin.',
      });
    }
    if (type === 'category' && !categoryIds.length) {
      return emptySimulationResult({
        scopeLabel,
        currency,
        reason: 'empty_category_scope',
        explanation: 'Simülasyon için en az bir kategori seçin.',
      });
    }
    if (type === 'brand' && !brands.length) {
      return emptySimulationResult({
        scopeLabel,
        currency,
        reason: 'empty_brand_scope',
        explanation: 'Simülasyon için en az bir marka seçin.',
      });
    }

    const products = await prisma.product.findMany({
      where,
      take: 5000,
      select: {
        id: true,
        name: true,
        brand: true,
        categoryId: true,
        purchasePrice: true,
        salePrice: true,
        stock: {
          select: {
            warehouseQuantity: true,
            shelfQuantity: true,
            nearestExpiry: true,
            fefoDefaultExpiry: true,
            batches: {
              where: { totalQuantity: { gt: 0 } },
              orderBy: [{ skt: 'asc' }, { batchNo: 'asc' }],
              take: 1,
              select: { skt: true },
            },
          },
        },
      },
    });

    const scopedProducts = type === 'brand' && brands.length
      ? products.filter((product) => brands.some((brand) => normalizeBrandKey(product.brand) === normalizeBrandKey(brand)))
      : products;

    if (!scopedProducts.length) {
      return emptySimulationResult({
        scopeLabel,
        currency,
        reason: 'empty_scope',
        explanation: 'Bu kampanya kapsamında simülasyon yapılacak ürün bulunamadı.',
      });
    }

    const productIdsForSales = scopedProducts.map((product) => product.id);
    const { start, end } = toSimulationDateWindow();
    const sales = await prisma.sale.findMany({
      where: {
        type: { in: ['sale', 'return'] },
        createdAt: { gte: start, lte: end },
        saleItems: { some: { productId: { in: productIdsForSales } } },
      },
      select: {
        id: true,
        type: true,
        createdAt: true,
        saleItems: {
          where: { productId: { in: productIdsForSales } },
          select: {
            productId: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
          },
        },
      },
    });

    return calculateRealSalesCampaignSimulation({
      products: scopedProducts,
      salesMetricsByProduct: buildSalesMetricsByProduct(sales),
      payload: { ...payload, currency, scopeLabel },
      durationDays,
    });
  },
};

