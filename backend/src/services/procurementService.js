import { v4 as uuidv4 } from 'uuid';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { movementRepo } from '../repositories/movementRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { purchaseOrderItemRepo } from '../repositories/purchaseOrderItemRepository.js';
import { purchaseOrderRepo } from '../repositories/purchaseOrderRepository.js';
import { purchaseSuggestionRepo } from '../repositories/purchaseSuggestionRepository.js';
import { salesRepo } from '../repositories/salesRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { stockRepo } from '../repositories/stockRepository.js';
import { supplierProductRepo } from '../repositories/supplierProductRepository.js';
import { supplierRepo } from '../repositories/supplierRepository.js';
import { taskRepo } from '../repositories/taskRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { includesSearchText, normalizeSearchText } from '../utils/validators.js';
import { notificationService } from './notificationService.js';
import { logisticsTariffService } from './logisticsTariffService.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';
import { decodeCursor, encodeCursor, parseBooleanQuery, parseLimit, parsePagePagination, resolvePaginationMode, resolveWhitelistedSort } from '../utils/pagination.js';
import { assertValidSupplierProductOrderUnit, normalizeProcurementUnit, resolveSupplierProductOrderableUnits } from '../utils/procurementUnits.js';

const ORDER_STATUSES = [
  'submitted_for_approval',
  'approved',
  'supplier_notified',
  'preparing',
  'ready_to_ship',
  'in_transit',
  'goods_receipt_pending',
  'goods_receipt_completed',
  'stock_entry_pending',
  'completed',
  'archived',
  // Legacy statuses kept for backwards compatibility.
  'sourcing',
  'delivery_planned',
  'partially_delivered',
  'closed',
  'return_in_progress',
  'delivered',
  'cancelled',
];

const ORDER_STATUS_LABELS = {
  submitted_for_approval: 'Onaya Gönderildi',
  approved: 'Onaylandı',
  supplier_notified: 'Tedarikçiye İletildi',
  preparing: 'Hazırlanıyor',
  ready_to_ship: 'Sevke Hazır',
  in_transit: 'Yola Çıktı',
  delivered: 'Depoya Ulaştı',
  goods_receipt_pending: 'Mal Kabul Bekliyor',
  goods_receipt_completed: 'Mal Kabul Yapıldı',
  stock_entry_pending: 'Stok Girişi Bekleniyor',
  completed: 'Tamamlandı',
  archived: 'Arşivlendi',
  cancelled: 'İptal Edildi',
  // Legacy mappings
  sourcing: 'Hazırlanıyor',
  delivery_planned: 'Sevke Hazır',
  partially_delivered: 'Depoya Ulaştı',
  closed: 'Depoya Ulaştı',
  return_in_progress: 'İptal Edildi',
};

const AUTO_MANAGED_SEQUENCE = ['approved', 'supplier_notified', 'preparing', 'ready_to_ship', 'in_transit', 'delivered'];
const AUTO_MANAGED_STATUSES = new Set(AUTO_MANAGED_SEQUENCE);
const MANUAL_ALLOWED_STATUSES = new Set(['submitted_for_approval', 'approved', 'cancelled']);
const TERMINAL_STATUSES = new Set(['cancelled', 'archived']);
const PRE_APPROVAL_MANUAL_STATUSES = new Set(['submitted_for_approval']);
const GOODS_RECEIPT_ALREADY_FINALIZED_STATUSES = new Set(['goods_receipt_completed', 'stock_entry_pending', 'completed', 'archived']);
const orderUpdateLocks = new Map();

const AUTO_TIMELINE_RANGES_MS = {
  approved_to_supplier_notified: [5 * 60 * 1000, 20 * 60 * 1000],
  supplier_notified_to_preparing: [1 * 60 * 60 * 1000, 4 * 60 * 60 * 1000],
  preparing_to_ready_to_ship: [3 * 60 * 60 * 1000, 10 * 60 * 60 * 1000],
  ready_to_ship_to_in_transit: [30 * 60 * 1000, 3 * 60 * 60 * 1000],
  in_transit_to_delivered: [12 * 60 * 60 * 1000, 48 * 60 * 60 * 1000],
};

const AUTO_CANCEL_PROBABILITY = 0.05;
const AUTO_TIMELINE_VERSION = 1;
const SYSTEM_AUTO_USER_ID = 'system-auto';
const MANUAL_STOCK_ENTRY_MODE = 'manual';
const AUTO_STOCK_ENTRY_MODE = 'auto';

const SUGGESTION_STATUS_LABELS = {
  pending: 'Bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_GENERATION_MODES = new Set(['critical', 'fast', 'all', 'campaign', 'category']);
const VALID_ROUNDING_STRATEGIES = new Set(['auto', 'none', 'case', 'pallet']);

const normalizeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
};

const toDateKey = (value) => {
  const parsed = normalizeDate(value);
  if (!parsed) return null;
  return parsed.toISOString().slice(0, 10);
};

const addDays = (baseDate, days) => {
  const target = new Date(baseDate);
  target.setDate(target.getDate() + Math.max(0, Math.floor(Number(days) || 0)));
  return target;
};

const isWithinDateRange = (date, start, end) => {
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
};

const roundUpByStep = (value, step) => {
  const safeStep = Math.max(1, Math.floor(Number(step) || 1));
  return Math.ceil(Math.max(0, Number(value) || 0) / safeStep) * safeStep;
};

const normalizeString = (value) => String(value || '').trim();

const normalizeUnitName = (value) => normalizeProcurementUnit(value || 'adet') || 'adet';

const getBaseUnitsForUnit = (unit, { unitsPerPack = 1, unitsPerBox = 1, unitsPerCase = 1, unitsPerPallet = 1 } = {}) => {
  const normalized = normalizeUnitName(unit);
  switch (normalized) {
    case 'paket':
      return Math.max(1, Number(unitsPerPack || 1));
    case 'kutu':
      return Math.max(1, Number(unitsPerBox || unitsPerCase || 1));
    case 'koli':
    case 'kasa':
    case 'çuval':
    case 'cuval':
      return Math.max(1, Number(unitsPerCase || 1));
    case 'palet':
      return Math.max(1, Number(unitsPerPallet || 1));
    case 'kg':
    case 'kilogram':
    case 'adet':
    default:
      return 1;
  }
};

const resolveMinimumOrderBaseQty = ({ supplierProduct = {}, unitInfo = {} }) => {
  const minimumOrderQty = Math.max(1, Number(supplierProduct.minimumOrderQty || supplierProduct.minOrderQty || 1));
  const minOrderUnit = normalizeUnitName(supplierProduct.minOrderUnit || supplierProduct.defaultOrderUnit || supplierProduct.priceUnit || 'adet');
  const unitsPerMinOrderUnit = getBaseUnitsForUnit(minOrderUnit, unitInfo);
  return {
    minimumOrderQty,
    minimumOrderUnit: minOrderUnit,
    minimumOrderBaseQty: Math.max(1, Math.ceil(minimumOrderQty * unitsPerMinOrderUnit)),
  };
};

const resolvePricePerBaseUnit = ({ supplierProduct = {}, unitInfo = {} }) => {
  const purchasePrice = Number(supplierProduct.purchasePrice || 0);
  const priceUnit = normalizeUnitName(supplierProduct.priceUnit || 'adet');
  const unitsPerPriceUnit = getBaseUnitsForUnit(priceUnit, unitInfo);
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) return 0;
  return Number((purchasePrice / Math.max(1, unitsPerPriceUnit)).toFixed(4));
};

const resolveStorageType = (product = {}) => {
  const raw = normalizeString(product.requiredStorageType || product.storageType || '').toLocaleLowerCase('tr-TR');
  if (raw.includes('freezer') || raw.includes('frozen') || raw.includes('dondur') || raw.includes('donuk')) return 'frozen';
  if (raw.includes('cold') || raw.includes('soğuk') || raw.includes('soguk')) return 'cold';
  return 'ambient';
};

const normalizeGenerationOptions = (options = {}) => {
  const modeRaw = normalizeString(options.mode || 'critical').toLowerCase();
  const mode = VALID_GENERATION_MODES.has(modeRaw) ? modeRaw : 'critical';

  const roundingRaw = normalizeString(options.roundingStrategy || 'auto').toLowerCase();
  const roundingStrategy = VALID_ROUNDING_STRATEGIES.has(roundingRaw) ? roundingRaw : 'auto';

  const safetyDays = Math.max(1, Math.floor(Number(options.safetyDays || 3)));
  const coverageDays = Math.max(3, Math.floor(Number(options.coverageDays || 0)));

  return {
    mode,
    categoryId: normalizeString(options.categoryId),
    campaignType: normalizeString(options.campaignType).toLowerCase(),
    roundingStrategy,
    safetyDays,
    coverageDays,
  };
};

const getDemandSignals = ({ sold7, sold14, sold30, avg7, avg14, avg30 }) => {
  const weighted = Number((avg7 * 0.5 + avg14 * 0.3 + avg30 * 0.2).toFixed(3));
  const trendRatio = avg14 > 0 ? Number(((avg7 - avg14) / avg14).toFixed(3)) : avg7 > 0 ? 1 : 0;

  let trendDirection = 'flat';
  if (trendRatio >= 0.12) trendDirection = 'up';
  else if (trendRatio <= -0.12) trendDirection = 'down';

  let salesSpeed = 'normal';
  if (avg7 >= Math.max(1.2, avg30 * 1.18)) salesSpeed = 'fast';
  else if (avg7 <= Math.max(0.25, avg30 * 0.72)) salesSpeed = 'slow';

  return {
    sold7,
    sold14,
    sold30,
    avg7,
    avg14,
    avg30,
    weighted,
    trendRatio,
    trendDirection,
    salesSpeed,
  };
};

const buildSalesSignalsMap = (sales = [], baseDate = new Date()) => {
  const start30 = addDays(baseDate, -29);
  start30.setHours(0, 0, 0, 0);
  const end = new Date(baseDate);
  end.setHours(23, 59, 59, 999);

  const start14 = addDays(baseDate, -13);
  start14.setHours(0, 0, 0, 0);

  const start7 = addDays(baseDate, -6);
  start7.setHours(0, 0, 0, 0);

  const totals = new Map();

  for (const sale of sales) {
    const createdAt = normalizeDate(sale.createdAt);
    if (!isWithinDateRange(createdAt, start30, end)) continue;

    const sign = String(sale.type || '').toLowerCase() === 'return' ? -1 : 1;
    const items = Array.isArray(sale.items) ? sale.items : [];
    for (const item of items) {
      const productId = normalizeString(item?.productId);
      if (!productId || productId === '__bag__') continue;
      const qty = Number(item?.quantity || 0) * sign;
      if (!Number.isFinite(qty) || qty === 0) continue;

      const row = totals.get(productId) || { sold7: 0, sold14: 0, sold30: 0 };
      row.sold30 += qty;
      if (createdAt >= start14) row.sold14 += qty;
      if (createdAt >= start7) row.sold7 += qty;
      totals.set(productId, row);
    }
  }

  const result = new Map();
  for (const [productId, totalsRow] of totals.entries()) {
    const sold7 = Math.max(0, Number(totalsRow.sold7.toFixed(2)));
    const sold14 = Math.max(0, Number(totalsRow.sold14.toFixed(2)));
    const sold30 = Math.max(0, Number(totalsRow.sold30.toFixed(2)));
    const avg7 = Number((sold7 / 7).toFixed(3));
    const avg14 = Number((sold14 / 14).toFixed(3));
    const avg30 = Number((sold30 / 30).toFixed(3));

    result.set(productId, getDemandSignals({ sold7, sold14, sold30, avg7, avg14, avg30 }));
  }

  return result;
};

const normalizeCampaignItem = (campaign = {}) => {
  const now = new Date();
  const startsAt = normalizeDate(campaign.startsAt || campaign.startAt);
  const endsAt = normalizeDate(campaign.endsAt || campaign.endAt);
  const isIndefinite = Boolean(campaign.isIndefinite);
  const isDateValid = isIndefinite
    ? !startsAt || startsAt <= now
    : isWithinDateRange(now, startsAt || null, endsAt || null);

  return {
    id: normalizeString(campaign.id),
    name: normalizeString(campaign.name),
    discountRate: Number(campaign.discountRate || 0),
    isActive: campaign.isActive !== false,
    isIndefinite,
    startsAt: startsAt ? startsAt.toISOString() : '',
    endsAt: endsAt ? endsAt.toISOString() : '',
    type: normalizeString(campaign.type || campaign.campaignType || 'general').toLowerCase(),
    priority: Math.max(0, Number(campaign.priority || 0) || 0),
    status: normalizeString(campaign.status || (campaign.isActive === false ? 'paused' : 'active')).toLowerCase(),
    targetCategoryIds: Array.isArray(campaign.targetCategoryIds)
      ? campaign.targetCategoryIds.map((id) => normalizeString(id)).filter(Boolean)
      : [],
    targetProductIds: Array.isArray(campaign.targetProductIds)
      ? campaign.targetProductIds.map((id) => normalizeString(id)).filter(Boolean)
      : [],
    trigger: campaign.trigger && typeof campaign.trigger === 'object' ? campaign.trigger : {},
    actions: campaign.actions && typeof campaign.actions === 'object' ? campaign.actions : {},
    isDateValid,
  };
};

const resolveActiveCampaigns = (settings = {}) => {
  const campaigns = Array.isArray(settings?.customerRelations?.campaigns)
    ? settings.customerRelations.campaigns
    : [];

  return campaigns
    .map((item) => normalizeCampaignItem(item))
    .filter((item) => item.id && item.name && item.discountRate > 0 && item.isActive && item.status !== 'archived' && item.isDateValid)
    .sort((a, b) => b.priority - a.priority || b.discountRate - a.discountRate);
};

const matchCampaignForProduct = ({ campaign, product, signals, overStockRatio }) => {
  if (!campaign) return false;
  const type = campaign.type;

  if (type === 'category') {
    return campaign.targetCategoryIds.includes(product.categoryId);
  }

  if (type === 'product') {
    return campaign.targetProductIds.includes(product.id);
  }

  if (type === 'dynamic') {
    const trigger = campaign.trigger || {};
    const triggerSalesSpeed = normalizeString(trigger.salesSpeed).toLowerCase();
    const minOverStockRatio = Number(trigger.minOverStockRatio || 1);
    const trendDirection = normalizeString(trigger.trendDirection).toLowerCase();

    const bySpeed = triggerSalesSpeed ? signals.salesSpeed === triggerSalesSpeed : true;
    const byTrend = trendDirection ? signals.trendDirection === trendDirection : true;
    const byOverStock = Number.isFinite(minOverStockRatio) ? overStockRatio >= minOverStockRatio : true;

    return bySpeed && byTrend && byOverStock;
  }

  return true;
};

const resolveCampaignContext = ({ product, signals, overStockRatio, campaigns, options }) => {
  const matched = campaigns.filter((campaign) => {
    if (options.campaignType && campaign.type !== options.campaignType) {
      return false;
    }
    return matchCampaignForProduct({ campaign, product, signals, overStockRatio });
  });

  if (!matched.length) {
    return {
      campaign: null,
      demandMultiplier: 1,
      discountSignal: 0,
    };
  }

  const selected = matched[0];
  const demandMultiplier = Number((1 + Math.min(0.45, Number(selected.discountRate || 0) / 140)).toFixed(3));
  const discountSignal = Number(selected.discountRate || 0);

  return {
    campaign: selected,
    demandMultiplier,
    discountSignal,
  };
};

const resolveRounding = ({ quantity, minimumOrderQty, unitsPerCase, unitsPerPallet, roundingStrategy }) => {
  const baseQty = Math.max(Number(quantity || 0), Number(minimumOrderQty || 1));

  if (roundingStrategy === 'none') {
    return {
      suggestedQty: Math.ceil(baseQty),
      roundedFromQty: Math.ceil(baseQty),
      roundingUnit: 'adet',
      applied: false,
    };
  }

  if (roundingStrategy === 'pallet') {
    const step = Math.max(1, Number(unitsPerPallet || 1));
    return {
      suggestedQty: roundUpByStep(baseQty, step),
      roundedFromQty: Math.ceil(baseQty),
      roundingUnit: 'palet',
      applied: true,
    };
  }

  if (roundingStrategy === 'case') {
    const step = Math.max(1, Number(unitsPerCase || 1));
    return {
      suggestedQty: roundUpByStep(baseQty, step),
      roundedFromQty: Math.ceil(baseQty),
      roundingUnit: 'koli',
      applied: true,
    };
  }

  const pallet = Math.max(1, Number(unitsPerPallet || 1));
  const step = baseQty >= pallet * 0.7
    ? pallet
    : Math.max(1, Number(unitsPerCase || 1));

  return {
    suggestedQty: roundUpByStep(baseQty, step),
    roundedFromQty: Math.ceil(baseQty),
    roundingUnit: step === pallet ? 'palet' : 'koli',
    applied: step > 1,
  };
};

const getRiskLevel = ({ currentStock, criticalStock, daysToStockout, leadTimeDays }) => {
  if (currentStock <= criticalStock) return 'critical';
  if (daysToStockout !== null && daysToStockout <= Math.max(1, leadTimeDays + 1)) return 'critical';
  if (daysToStockout !== null && daysToStockout <= leadTimeDays + 3) return 'high';
  if (daysToStockout !== null && daysToStockout <= leadTimeDays + 7) return 'medium';
  return 'low';
};

const getSuggestionReasonModel = ({ currentStock, criticalStock, signals, daysToStockout, leadTimeDays, campaign, roundingUnit, moqApplied }) => {
  const reasonTags = [];
  const reasonDetails = [];

  if (currentStock <= criticalStock) {
    reasonTags.push('low_stock');
    reasonDetails.push('Mevcut stok kritik eşik altında.');
  }

  if (daysToStockout !== null && daysToStockout <= leadTimeDays + 4) {
    reasonTags.push('stockout_risk');
    reasonDetails.push(`Tahmini tükenme süresi ${daysToStockout} gün.`);
  }

  if (signals.salesSpeed === 'fast') {
    reasonTags.push('fast_sales');
    reasonDetails.push('Son 7 gün satış hızı yüksek.');
  }

  if (signals.trendDirection === 'up') {
    reasonTags.push('trend_up');
    reasonDetails.push('Talep trendi yükselişte.');
  }

  if (campaign) {
    reasonTags.push('campaign_boost');
    reasonDetails.push(`Aktif kampanya etkisi: ${campaign.name}`);
  }

  if (moqApplied) {
    reasonTags.push('moq_applied');
    reasonDetails.push('Minimum sipariş miktarı uygulandı.');
  }

  if (roundingUnit === 'koli') {
    reasonTags.push('case_rounded');
    reasonDetails.push('Miktar koli bazında yuvarlandı.');
  }

  if (roundingUnit === 'palet') {
    reasonTags.push('pallet_rounded');
    reasonDetails.push('Miktar palet bazında yuvarlandı.');
  }

  return {
    reasonTags,
    reasonDetails,
    reasonText: reasonDetails.join(' '),
  };
};

const shouldCreateSuggestionByMode = ({ options, product, campaignContext, signals, riskLevel, needQty, currentStock, criticalStock }) => {
  if (options.mode === 'all') {
    return needQty > 0;
  }

  if (options.mode === 'campaign') {
    return Boolean(campaignContext.campaign) && needQty > 0;
  }

  if (options.mode === 'category') {
    return Boolean(options.categoryId) && product.categoryId === options.categoryId && needQty > 0;
  }

  if (options.mode === 'fast') {
    return signals.salesSpeed === 'fast' && needQty > 0;
  }

  return currentStock <= criticalStock || riskLevel === 'critical' || riskLevel === 'high';
};

const getAdmins = async () => {
  const users = await userRepo.getAll();
  return (users || []).filter((item) => item.role === 'admin' && item.isActive !== false);
};

const getAutomationSettings = (settings = {}) => {
  const automation = settings?.customerRelations?.automationCenter;
  if (!automation || typeof automation !== 'object') {
    return {
      enabled: false,
      autoCreateTasks: false,
      notifyOnCritical: false,
      taskAssigneeUserId: '',
    };
  }

  return {
    enabled: automation.enabled === true,
    autoCreateTasks: automation.autoCreateTasks === true,
    notifyOnCritical: automation.notifyOnCritical !== false,
    taskAssigneeUserId: normalizeString(automation.taskAssigneeUserId),
  };
};

const createAutomationTaskIfNeeded = async ({ suggestion, product, actorUserId, automation, adminUsers }) => {
  if (!automation.enabled || !automation.autoCreateTasks) return null;
  if (!['critical', 'high'].includes(suggestion.riskLevel)) return null;

  const allTasks = await taskRepo.getAll();
  const dedupeKey = `procurement:${suggestion.productId}`;
  const existing = allTasks.find((task) => (
    task?.dedupeKey === dedupeKey
    && ['pending', 'in-progress'].includes(String(task.status || ''))
  ));
  if (existing) return existing;

  const assignee = automation.taskAssigneeUserId || adminUsers[0]?.id || '';
  const now = new Date().toISOString();
  const created = {
    id: uuidv4(),
    title: `Sipariş Planı: ${product.name}`,
    description: `${product.name} için otomatik üretilen talep önerisi incelensin. Risk: ${suggestion.riskLevel}.`,
    assignedTo: assignee,
    priority: suggestion.riskLevel === 'critical' ? 'high' : 'medium',
    dueDate: addDays(new Date(), 1).toISOString().slice(0, 10),
    status: 'pending',
    comments: [],
    createdBy: actorUserId || 'system',
    createdAt: now,
    updatedAt: now,
    source: 'procurement_automation',
    dedupeKey,
    relatedProductId: suggestion.productId,
  };

  await taskRepo.create(created);
  return created;
};

const createCriticalNotificationsIfNeeded = async ({ suggestion, product, automation, adminUsers }) => {
  if (!automation.enabled || !automation.notifyOnCritical) return;
  if (!['critical', 'high'].includes(suggestion.riskLevel)) return;

  const todayKey = toDateKey(new Date())?.replace(/-/g, '') || 'today';
  const dedupeKey = `proc-critical:${suggestion.productId}:${todayKey}`;

  await Promise.all(
    adminUsers.map((admin) => notificationService.notifyUser({
      userId: admin.id,
      type: 'critical_stock',
      title: 'Kritik Talep Önerisi',
      message: `${product.name} için ${suggestion.suggestedQty} adet sipariş önerisi oluştu.`,
      severity: suggestion.riskLevel === 'critical' ? 'high' : 'medium',
      dedupeKey,
      actionUrl: '/siparis-onerileri',
      actionType: 'order',
    }))
  );
};

const normalizeOrderNumber = (value, fallbackSeed = '') => {
  const raw = String(value || '').trim();
  const digitMatch = raw.match(/\d+/g);
  if (digitMatch?.length) {
    const normalized = digitMatch.join('').slice(-5).padStart(5, '0');
    return `siparis-${normalized}`;
  }

  const seed = String(fallbackSeed || raw || Date.now());
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  const normalized = String(Math.abs(hash) % 100000).padStart(5, '0');
  return `siparis-${normalized}`;
};

const extractOrderSequence = (value) => {
  const normalizedMatch = String(value || '').trim().match(/^siparis-(\d{1,})$/i);
  if (normalizedMatch) return Number(normalizedMatch[1]);
  const digitMatch = String(value || '').match(/\d+/g);
  if (!digitMatch?.length) return 0;
  return Number(digitMatch.join('').slice(-5)) || 0;
};

const buildOrderNumber = async (existingRows = null) => {
  const rows = Array.isArray(existingRows) ? existingRows : await purchaseOrderRepo.getAll();
  const maxSequence = rows.reduce((max, row) => Math.max(max, extractOrderSequence(row?.orderNumber || row?.id)), 0);
  return `siparis-${String(maxSequence + 1).padStart(5, '0')}`;
};
const sortByNewest = (rows) => [...rows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
const DEFAULT_SUGGESTIONS_LIMIT = 20;
const MAX_SUGGESTIONS_LIMIT = 200;

const toNumberValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
};

const fromDateValue = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

const getTotalStock = (stock) => (stock?.warehouseQuantity || 0) + (stock?.shelfQuantity || 0);

const getLeadDays = (supplierProduct) => {
  const lead = Number(supplierProduct?.leadTimeDays);
  return Number.isFinite(lead) && lead > 0 ? lead : 3;
};

const STORE_CITY = 'İzmir';

const getCityLeadRange = (city) => {
  switch (city) {
    case 'İzmir':
      return [1, 2];
    case 'İstanbul':
      return [2, 4];
    case 'Ankara':
      return [2, 3];
    case 'Antalya':
      return [1, 3];
    case 'Kocaeli':
      return [2, 4];
    default:
      return [2, 5];
  }
};

const getLogisticsLeadInfo = (supplier) => {
  const warehouses = Array.isArray(supplier?.warehouses) && supplier.warehouses.length
    ? supplier.warehouses
    : ['İstanbul'];

  let bestCity = warehouses[0];
  let [bestMin, bestMax] = getCityLeadRange(bestCity, STORE_CITY);

  for (const city of warehouses) {
    const [min] = getCityLeadRange(city, STORE_CITY);
    if (min < bestMin) {
      bestCity = city;
      [bestMin, bestMax] = getCityLeadRange(city, STORE_CITY);
    }
  }

  const baseDays = bestMin + Math.floor(Math.random() * Math.max(1, (bestMax - bestMin + 1)));
  const jitter = Math.floor(Math.random() * 2) - 1; // -1, 0 veya +1 gün oynama
  const total = Math.max(1, Math.min(7, baseDays + jitter));

  return {
    warehouseCity: bestCity,
    estimatedDeliveryDays: total,
  };
};

const getEstimatedDeliveryDate = (leadTimeDays) => {
  const target = new Date();
  target.setDate(target.getDate() + Math.max(1, Number(leadTimeDays) || 3));
  return target.toISOString();
};

const ensurePositiveNumber = (value, field) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(400, `${field} pozitif sayı olmalıdır`);
  }
  return parsed;
};

const ensurePositiveInteger = (value, fallback = 1) => {
  if (value === undefined || value === null || value === '') {
    return Math.max(1, Math.floor(Number(fallback) || 1));
  }

  return Math.max(1, Math.floor(ensurePositiveNumber(value, 'value')));
};

const resolveMinimumOrderQty = (payload, fallback = 1) => {
  const candidate = payload?.minimumOrderQty
    ?? payload?.minimumOrderCaseQty
    ?? payload?.moqCases
    ?? payload?.moq
    ?? fallback;

  return Math.max(1, Math.floor(ensurePositiveNumber(candidate, 'minimumOrderQty')));
};

const ensureSingleDefaultForProduct = async (productId, primaryId) => {
  if (!productId || !primaryId) return;

  const all = await supplierProductRepo.getAll();
  const now = new Date().toISOString();

  const siblings = all.filter((row) => row.productId === productId);

  for (const row of siblings) {
    const shouldBeDefault = row.id === primaryId;
    const currentDefault = row.isDefault === true;

    if (shouldBeDefault !== currentDefault) {
      await supplierProductRepo.updateById(row.id, {
        ...row,
        isDefault: shouldBeDefault,
        updatedAt: now,
      });
    }
  }
};

const ensureComputedDefaultForProduct = async (productId) => {
  if (!productId) return;
  const all = await supplierProductRepo.getAll();
  const candidates = all
    .filter((row) => row.productId === productId && row.isActive !== false)
    .sort((a, b) => Number(a.purchasePrice || 0) - Number(b.purchasePrice || 0));

  if (!candidates.length) return;
  await ensureSingleDefaultForProduct(productId, candidates[0].id);
};

const CATEGORY_KEYWORDS_BY_ID = {
  'cat-003': ['süt', 'kahvalt'],
  'cat-004': ['gıda', 'bakliyat', 'temel'],
  'cat-005': ['içecek', 'meşrubat', 'su'],
  'cat-006': ['atıştırmalık', 'snack', 'cips'],
  'cat-009': ['donuk', 'dondurulmuş', 'hazır yemek'],
  'cat-010': ['deterjan', 'temizlik', 'hijyen'],
  'cat-011': ['kişisel bakım', 'kozmetik', 'sağlık'],
  'cat-012': ['kaşıt', 'havlu', 'mendil'],
  'cat-013': ['bebek'],
};

const isSupplierCategoryCompatible = (product, supplier) => {
  if (!product?.categoryId || !supplier) return true;

  // 1) Eşer tedarikçinin resmi uzmanlık kategorileri varsa doşrudan bunları kullan
  if (Array.isArray(supplier.expertiseCategories) && supplier.expertiseCategories.length > 0) {
    return supplier.expertiseCategories.includes(product.categoryId);
  }

  // 2) Geriye dönük uyumluluk: eski "kategoriler" metin alanı üzerinden anahtar kelime eşleşmesi
  if (!supplier.kategoriler) return true;
  const keywords = CATEGORY_KEYWORDS_BY_ID[product.categoryId];
  if (!keywords || !keywords.length) return true;

  const categoriesText = String(supplier.kategoriler).toLowerCase();
  return keywords.some((keyword) => categoriesText.includes(keyword));
};

const validateSupplierCategoryCompatibility = (product, supplier) => {
  if (!isSupplierCategoryCompatible(product, supplier)) {
    throw new AppError(400, 'Seçilen tedarikçi bu ürün kategorisi için uygun değil.');
  }
};

const validateOrderStatus = (status) => {
  if (!ORDER_STATUSES.includes(status)) {
    throw new AppError(400, 'Geçersiz sipariş durumu');
  }
};

const withOrderUpdateLock = async (orderId, callback) => {
  const key = String(orderId || '').trim();
  if (!key) {
    return callback();
  }

  const previous = orderUpdateLocks.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  orderUpdateLocks.set(key, queued);

  try {
    await previous;
    return await callback();
  } finally {
    release();
    if (orderUpdateLocks.get(key) === queued) {
      orderUpdateLocks.delete(key);
    }
  }
};

const parseSafeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const addMs = (date, milliseconds) => new Date(date.getTime() + Math.max(0, Math.floor(Number(milliseconds) || 0)));

const hashFNV1a32 = (value) => {
  const text = String(value || '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const deterministicRatio = (seed) => hashFNV1a32(seed) / 0xffffffff;

const deterministicBetween = (seed, min, max) => {
  const safeMin = Math.floor(Number(min) || 0);
  const safeMax = Math.floor(Number(max) || 0);
  if (safeMax <= safeMin) return safeMin;
  const ratio = deterministicRatio(seed);
  return safeMin + Math.floor(ratio * (safeMax - safeMin + 1));
};

const getAutoStatusRank = (status) => {
  const index = AUTO_MANAGED_SEQUENCE.indexOf(status);
  return index === -1 ? -1 : index;
};

const resolveApprovedAtFromOrder = (order = {}) => {
  const direct = parseSafeDate(order.approvedAt);
  if (direct) return direct;

  const historyRows = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  for (let index = historyRows.length - 1; index >= 0; index -= 1) {
    const row = historyRows[index];
    if (String(row?.status || '').trim() !== 'approved') continue;
    const parsed = parseSafeDate(row.at);
    if (parsed) return parsed;
  }

  if (String(order.status || '').trim() === 'approved') {
    return parseSafeDate(order.updatedAt) || parseSafeDate(order.createdAt) || null;
  }

  return null;
};

const resolveRequestedDeliveryDateFromOrder = (order = {}) => {
  const direct = parseSafeDate(order.requestedDeliveryDate);
  if (direct) return direct;
  const payloadDate = parseSafeDate(order?.payload?.requestedDeliveryDate);
  if (payloadDate) return payloadDate;
  return null;
};

const resolveOrderLeadTimeDays = (order = {}) => {
  const numeric = Number(order.estimatedDeliveryDays || order?.payload?.estimatedDeliveryDays || 0);
  return Number.isFinite(numeric) && numeric > 0 ? Math.ceil(numeric) : 0;
};

const resolveTimelineAnchorAt = ({ order = {}, approvedAt }) => {
  const deliveryMode = String(order.deliveryDateMode || order?.payload?.deliveryDateMode || '').trim().toLowerCase();
  const requestedDeliveryDate = resolveRequestedDeliveryDateFromOrder(order);
  if (!requestedDeliveryDate || deliveryMode !== 'custom') return approvedAt;

  const leadTimeDays = resolveOrderLeadTimeDays(order);
  const requestedStart = new Date(
    requestedDeliveryDate.getFullYear(),
    requestedDeliveryDate.getMonth(),
    requestedDeliveryDate.getDate(),
    0, 0, 0, 0,
  );
  if (leadTimeDays > 0) {
    requestedStart.setDate(requestedStart.getDate() - leadTimeDays);
  }

  return requestedStart.getTime() > approvedAt.getTime() ? requestedStart : approvedAt;
};

const resolveOrderEstimatedDeliveryDate = ({ leadTimeDays = 0, deliveryDateMode = 'estimated', deliveryDate = null }) => {
  if (deliveryDateMode === 'custom') {
    const requested = parseSafeDate(deliveryDate);
    if (requested) return requested.toISOString();
  }
  return getEstimatedDeliveryDate(leadTimeDays);
};

const hasAutoTimeline = (order = {}) => Boolean(
  order.supplierNotifiedAtPlanned
  && order.preparingAtPlanned
  && order.readyToShipAtPlanned
  && order.shippedAtPlanned
  && order.deliveredAtPlanned
);

const hasApprovedInHistory = (order = {}) => {
  const historyRows = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  return historyRows.some((row) => String(row?.status || '').trim() === 'approved');
};

const buildDeterministicTimeline = ({ orderId, approvedAt, timelineAnchorAt = approvedAt }) => {
  const baseSeed = String(orderId || 'order');

  const d1 = deterministicBetween(`${baseSeed}:d1`, ...AUTO_TIMELINE_RANGES_MS.approved_to_supplier_notified);
  const d2 = deterministicBetween(`${baseSeed}:d2`, ...AUTO_TIMELINE_RANGES_MS.supplier_notified_to_preparing);
  const d3 = deterministicBetween(`${baseSeed}:d3`, ...AUTO_TIMELINE_RANGES_MS.preparing_to_ready_to_ship);
  const d4 = deterministicBetween(`${baseSeed}:d4`, ...AUTO_TIMELINE_RANGES_MS.ready_to_ship_to_in_transit);
  const d5 = deterministicBetween(`${baseSeed}:d5`, ...AUTO_TIMELINE_RANGES_MS.in_transit_to_delivered);

  const supplierNotifiedAtPlanned = addMs(timelineAnchorAt, d1);
  const preparingAtPlanned = addMs(supplierNotifiedAtPlanned, d2);
  const readyToShipAtPlanned = addMs(preparingAtPlanned, d3);
  const shippedAtPlanned = addMs(readyToShipAtPlanned, d4);
  const deliveredAtPlanned = addMs(shippedAtPlanned, d5);

  const cancelRoll = deterministicRatio(`${baseSeed}:cancel-roll`);
  const autoCancelledInPreparing = cancelRoll < AUTO_CANCEL_PROBABILITY;

  let autoCancelAtPlanned = null;
  if (autoCancelledInPreparing) {
    const minDelayMs = 15 * 60 * 1000;
    const maxDelayMs = 2 * 60 * 60 * 1000;
    const preparingWindowMs = Math.max(minDelayMs + 5 * 60 * 1000, readyToShipAtPlanned.getTime() - preparingAtPlanned.getTime());
    const safeMax = Math.max(minDelayMs, Math.min(maxDelayMs, preparingWindowMs - 5 * 60 * 1000));
    const cancelDelay = deterministicBetween(`${baseSeed}:cancel-delay`, minDelayMs, safeMax);
    autoCancelAtPlanned = addMs(preparingAtPlanned, cancelDelay);
  }

  return {
    supplierNotifiedAtPlanned: supplierNotifiedAtPlanned.toISOString(),
    preparingAtPlanned: preparingAtPlanned.toISOString(),
    readyToShipAtPlanned: readyToShipAtPlanned.toISOString(),
    shippedAtPlanned: shippedAtPlanned.toISOString(),
    deliveredAtPlanned: deliveredAtPlanned.toISOString(),
    autoCancelledInPreparing,
    autoCancelAtPlanned: autoCancelAtPlanned ? autoCancelAtPlanned.toISOString() : null,
    autoTimelineVersion: AUTO_TIMELINE_VERSION,
    autoTimelineSeed: baseSeed,
    autoCancelProbability: AUTO_CANCEL_PROBABILITY,
  };
};

const ensureOrderAutoTimeline = (order = {}) => {
  const currentStatus = String(order.status || '').trim();
  if (PRE_APPROVAL_MANUAL_STATUSES.has(currentStatus) && !hasApprovedInHistory(order) && currentStatus !== 'approved') {
    return { order, changed: false };
  }

  if (hasAutoTimeline(order)) {
    return { order, changed: false };
  }

  const approvedAt = resolveApprovedAtFromOrder(order);
  if (!approvedAt) {
    return { order, changed: false };
  }

  const timelineAnchorAt = resolveTimelineAnchorAt({ order, approvedAt });
  const timeline = buildDeterministicTimeline({ orderId: order.id, approvedAt, timelineAnchorAt });
  const approvedAtIso = approvedAt.toISOString();

  return {
    changed: true,
    order: {
      ...order,
      approvedAt: order.approvedAt || approvedAtIso,
      ...timeline,
    },
  };
};

export const getOrderCurrentStatus = (order, now = new Date()) => {
  const current = String(order?.status || '').trim();
  if (!current) return 'submitted_for_approval';
  if (TERMINAL_STATUSES.has(current) || PRE_APPROVAL_MANUAL_STATUSES.has(current)) {
    return current;
  }

  const hydrated = ensureOrderAutoTimeline(order).order;
  if (!hasAutoTimeline(hydrated)) {
    return current;
  }

  const nowMs = now.getTime();
  const supplierNotifiedMs = parseSafeDate(hydrated.supplierNotifiedAtPlanned)?.getTime() || Number.POSITIVE_INFINITY;
  const preparingMs = parseSafeDate(hydrated.preparingAtPlanned)?.getTime() || Number.POSITIVE_INFINITY;
  const readyToShipMs = parseSafeDate(hydrated.readyToShipAtPlanned)?.getTime() || Number.POSITIVE_INFINITY;
  const shippedMs = parseSafeDate(hydrated.shippedAtPlanned)?.getTime() || Number.POSITIVE_INFINITY;
  const deliveredMs = parseSafeDate(hydrated.deliveredAtPlanned)?.getTime() || Number.POSITIVE_INFINITY;
  const autoCancelMs = hydrated.autoCancelledInPreparing
    ? (parseSafeDate(hydrated.autoCancelAtPlanned)?.getTime() || Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;

  let computed = 'approved';
  if (nowMs >= supplierNotifiedMs) computed = 'supplier_notified';
  if (nowMs >= preparingMs) computed = 'preparing';
  if (nowMs >= readyToShipMs) computed = 'ready_to_ship';
  if (nowMs >= shippedMs) computed = 'in_transit';
  if (nowMs >= deliveredMs) computed = 'delivered';

  if (hydrated.autoCancelledInPreparing && nowMs >= autoCancelMs && nowMs < readyToShipMs) {
    computed = 'cancelled';
  }

  const currentRank = getAutoStatusRank(current);
  const computedRank = getAutoStatusRank(computed);

  if (computed === 'cancelled') {
    return currentRank >= getAutoStatusRank('ready_to_ship') ? current : 'cancelled';
  }

  if (currentRank > computedRank) {
    return current;
  }

  return computed;
};

const getStatusTimestampByTarget = (order = {}, status, fallbackNowIso) => {
  const timestamps = {
    approved: order.approvedAt,
    supplier_notified: order.supplierNotifiedAtPlanned,
    preparing: order.preparingAtPlanned,
    ready_to_ship: order.readyToShipAtPlanned,
    in_transit: order.shippedAtPlanned,
    delivered: order.deliveredAtPlanned,
    cancelled: order.autoCancelledInPreparing ? order.autoCancelAtPlanned : null,
  };

  const resolved = parseSafeDate(timestamps[status]);
  return resolved ? resolved.toISOString() : fallbackNowIso;
};

const enrichSupplierProduct = (item, productMap, supplierMap) => {
  const product = productMap.get(item.productId);
  const supplier = supplierMap.get(item.supplierId);

  const orderUnit = item.defaultOrderUnit || item.minOrderUnit || item.priceUnit || product?.orderUnit || 'adet';
  const unitsPerPack = Number(item.unitsPerPack || product?.unitsPerPack || 1);
  const unitsPerBox = Number(item.unitsPerBox || product?.unitsPerBox || product?.unitsPerCase || 1);
  const unitsPerCase = Number(product?.unitsPerCase || 1);
  const casesPerPallet = Number(product?.casesPerPallet || 1);
  const unitsPerPallet = Number(product?.unitsPerPallet || unitsPerCase * casesPerPallet);

  const priceUnit = normalizeUnitName(item.priceUnit || 'adet');
  const minOrderUnit = normalizeUnitName(item.minOrderUnit || priceUnit || 'adet');

  const orderableUnits = resolveSupplierProductOrderableUnits(item, product);

  const defaultOrderUnit = normalizeUnitName(item.defaultOrderUnit
    || product?.defaultOrderUnit
    || priceUnit
    || orderUnit
    || 'adet');

  return {
    ...item,
    supplierProductId: item.id,
    productName: product?.name || '-',
    productSku: product?.sku || '-',
    sku: product?.sku || '-',
    supplierName: supplier?.name || '-',
    supplierCode: supplier?.code || supplier?.supplierCode || item.supplierId,
    minimumOrderCaseQty: Number(item.minimumOrderQty || 1),
    minOrderQtyCases: Number(item.minimumOrderQty || 1),
    moqCases: Number(item.minimumOrderQty || 1),
    isPrimary: item.isDefault === true,
    referencePurchasePrice: Number(item.purchasePrice || 0),
    moqUnitPrice: Number(item.purchasePrice || 0),
    bulk10PlusUnitPrice: item.tierPrice10Case ?? null,
    storageType: product?.requiredStorageType || product?.storageType || 'Ortam',
    // Ürün tarafındaki ambalaj bilgilerini de taşıyarak frontend'de koli/palet
    // bazlı hesaplamaları ve lojistik birimleri mümkün kılıyoruz.
    orderUnit,
    unitsPerPack,
    unitsPerBox,
    unitsPerCase,
    casesPerPallet,
    unitsPerPallet,
    priceUnit,
    minOrderUnit,
    orderableUnits,
    defaultOrderUnit,
    tierPrice3Case: item.tierPrice3Case ?? null,
    tierPrice10Case: item.tierPrice10Case ?? null,
    tierPrice20Case: item.tierPrice20Case ?? null,
    defaultCargoTypeCode: item.defaultCargoTypeCode || '',
    supplierLogisticsNote: item.supplierLogisticsNote || '',
  };
};

const enrichSuggestion = (suggestion, { productMap, supplierMap, stockMap }) => {
  const product = productMap.get(suggestion.productId);
  const supplier = supplierMap.get(suggestion.supplierId);
  const stock = stockMap.get(suggestion.productId);

  const reasonTags = Array.isArray(suggestion.reasonTags) ? suggestion.reasonTags : [];
  const reasonDetails = Array.isArray(suggestion.reasonDetails) ? suggestion.reasonDetails : [];

  return {
    ...suggestion,
    productName: product?.name || '-',
    sku: product?.sku || '-',
    categoryId: suggestion.categoryId || product?.categoryId || '',
    supplierName: supplier?.name || '-',
    currentStock: suggestion.currentStock ?? getTotalStock(stock),
    criticalStock: suggestion.criticalStock ?? (product?.criticalStock || 0),
    riskLevel: suggestion.riskLevel || 'low',
    trendDirection: suggestion.trendDirection || 'flat',
    salesSpeed: suggestion.salesSpeed || 'normal',
    sold7: Number(suggestion.sold7 || 0),
    sold14: Number(suggestion.sold14 || 0),
    sold30: Number(suggestion.sold30 || 0),
    avgDaily7: Number(suggestion.avgDaily7 || 0),
    avgDaily14: Number(suggestion.avgDaily14 || 0),
    avgDaily30: Number(suggestion.avgDaily30 || 0),
    daysToStockout: suggestion.daysToStockout ?? null,
    leadTimeDays: Number(suggestion.leadTimeDays || 3),
    reorderPoint: Number(suggestion.reorderPoint || 0),
    targetStock: Number(suggestion.targetStock || 0),
    reasonTags,
    reasonDetails,
    reasonText: suggestion.reasonText || reasonDetails.join(' '),
    campaignId: suggestion.campaignId || null,
    campaignName: suggestion.campaignName || null,
    campaignType: suggestion.campaignType || null,
    generationMode: suggestion.generationMode || 'critical',
    roundingUnit: suggestion.roundingUnit || 'adet',
    roundedFromQty: Number(suggestion.roundedFromQty || suggestion.suggestedQty || 0),
    minimumOrderQty: Number(suggestion.minimumOrderQty || 1),
    minimumOrderUnit: suggestion.minimumOrderUnit || 'adet',
    minimumOrderBaseQty: Number(suggestion.minimumOrderBaseQty || suggestion.minimumOrderQty || 1),
    priceUnit: suggestion.priceUnit || 'adet',
    orderUnit: suggestion.orderUnit || suggestion.roundingUnit || 'adet',
    unitsPerCase: Number(suggestion.unitsPerCase || product?.unitsPerCase || 1),
    unitsPerPallet: Number(suggestion.unitsPerPallet || product?.unitsPerPallet || 1),
    statusLabel: SUGGESTION_STATUS_LABELS[suggestion.status] || suggestion.status,
  };
};

const enrichOrder = (order, { supplierMap, itemsByOrderId, userMap }) => {
  const supplier = supplierMap.get(order.supplierId);
  const createdByUser = order.createdBy && userMap ? userMap.get(order.createdBy) : null;
  const orderItems = itemsByOrderId.get(order.id) || [];

  return {
    ...order,
    supplierName: supplier?.name || '-',
    itemCount: orderItems.length,
    totalItemQty: orderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    statusLabel: ORDER_STATUS_LABELS[order.status] || order.status,
    deliveryStatus: ORDER_STATUS_LABELS[order.status] || order.status,
    createdByName: createdByUser?.name || null,
  };
};

const buildMaps = async () => {
  const [products, suppliers, stocks, users] = await Promise.all([
    productRepo.getAll(),
    supplierRepo.getAll(),
    stockRepo.getAll(),
    userRepo.getAll(),
  ]);

  return {
    products,
    suppliers,
    stocks,
    users,
    productMap: new Map(products.map((p) => [p.id, p])),
    supplierMap: new Map(suppliers.map((s) => [s.id, s])),
    stockMap: new Map(stocks.map((s) => [s.productId, s])),
    userMap: new Map(users.map((u) => [u.id, u])),
  };
};

// Daha hafif okuma gerektiren listeleme senaryoları için optimize edilmiş
// yardımcı fonksiyonlar: gereksiz repository'leri okumaz.
const buildProductSupplierMaps = async () => {
  const [products, suppliers] = await Promise.all([
    productRepo.getAll(),
    supplierRepo.getAll(),
  ]);

  return {
    products,
    suppliers,
    productMap: new Map(products.map((p) => [p.id, p])),
    supplierMap: new Map(suppliers.map((s) => [s.id, s])),
  };
};

const buildProductSupplierStockMaps = async () => {
  const [products, suppliers, stocks] = await Promise.all([
    productRepo.getAll(),
    supplierRepo.getAll(),
    stockRepo.getAll(),
  ]);

  return {
    products,
    suppliers,
    stocks,
    productMap: new Map(products.map((p) => [p.id, p])),
    supplierMap: new Map(suppliers.map((s) => [s.id, s])),
    stockMap: new Map(stocks.map((s) => [s.productId, s])),
  };
};

const createStockInMovement = async ({ product, qty, userName, userId, referenceNo }) => {
  const stock = await stockRepo.findByProductId(product.id);
  const prevWarehouse = stock?.warehouseQuantity || 0;
  const prevShelf = stock?.shelfQuantity || 0;
  const nextWarehouse = prevWarehouse + qty;
  await stockRepo.upsert(product.id, { warehouseQuantity: nextWarehouse, shelfQuantity: prevShelf });

  await movementRepo.create({
    id: uuidv4(),
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    type: 'IN',
    qty,
    previousQuantity: prevWarehouse,
    nextQuantity: nextWarehouse,
    previousTotalQuantity: prevWarehouse + prevShelf,
    nextTotalQuantity: nextWarehouse + prevShelf,
    location: 'depo',
    reasonCode: 'product_purchase',
    reasonLabel: 'Ürün Satın Alımı',
    note: `Satın alma teslimatı - ${referenceNo}`,
    referenceNo,
    userId,
    userName,
    createdAt: new Date().toISOString(),
  });
};

const getOrderItemsWithProducts = async (orderId) => {
  const [items, products] = await Promise.all([
    purchaseOrderItemRepo.getAll(),
    productRepo.getAll(),
  ]);

  const productMap = new Map(products.map((p) => [p.id, p]));
  const orderItems = items
    .filter((item) => item.orderId === orderId)
    .map((item) => ({
      ...item,
      productName: productMap.get(item.productId)?.name || '-',
      sku: productMap.get(item.productId)?.sku || '-',
    }));

  return { orderItems, productMap };
};

const mapOrderStatusRow = (row) => ({
  ...(row?.payload && typeof row.payload === 'object' ? row.payload : {}),
  id: row?.id,
  status: row?.status || '',
  at: fromDateValue(row?.at),
  by: row?.by || undefined,
  note: row?.note || undefined,
});

const mapOrderActivityRow = (row) => ({
  ...(row?.payload && typeof row.payload === 'object' ? row.payload : {}),
  id: row?.id,
  type: row?.type || '',
  status: row?.status || undefined,
  at: fromDateValue(row?.at),
  by: row?.by || undefined,
  note: row?.note || undefined,
});

const mapPurchaseOrderRow = (row) => {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const statusHistory = Array.isArray(row.statusHistory) ? row.statusHistory.map(mapOrderStatusRow) : (payload.statusHistory || []);
  const activityLog = Array.isArray(row.activityLogs) ? row.activityLogs.map(mapOrderActivityRow) : (payload.activityLog || []);
  const order = prepareOrderForRead({
    ...payload,
    id: row.id,
    orderNumber: row.orderNumber,
    supplierId: row.supplierId,
    source: row.source,
    status: row.status,
    currentStatus: row.currentStatus,
    current_status: row.currentStatus,
    currency: row.currency,
    subtotalAmount: toNumberValue(row.subtotalAmount),
    taxAmount: toNumberValue(row.taxAmount),
    shippingFee: toNumberValue(row.shippingFee),
    discountAmount: toNumberValue(row.discountAmount),
    grandTotal: toNumberValue(row.grandTotal),
    totalAmount: toNumberValue(row.totalAmount),
    deliveryStatus: row.deliveryStatus,
    goodsReceiptCompleted: row.goodsReceiptCompleted,
    goods_receipt_completed: row.goodsReceiptCompleted,
    stockEntryMode: row.stockEntryMode,
    stockEntryCompleted: row.stockEntryCompleted,
    stock_entry_completed: row.stockEntryCompleted,
    archived: row.archived,
    createdBy: row.createdBy,
    warehouseCity: row.warehouseCity,
    deliveryLocation: row.deliveryLocation,
    orderReason: row.orderReason,
    priority: row.priority,
    logisticsProvider: row.logisticsProvider,
    trackingNo: row.trackingNo,
    estimatedDeliveryDate: row.estimatedDeliveryDate,
    createdAt: fromDateValue(row.createdAt),
    updatedAt: fromDateValue(row.updatedAt),
    approvedAt: fromDateValue(row.approvedAt),
    deliveredAt: fromDateValue(row.deliveredAt),
    completedAt: fromDateValue(row.completedAt),
    archivedAt: fromDateValue(row.archivedAt),
    statusHistory,
    activityLog,
  });
  const items = Array.isArray(row.items) ? row.items : [];

  return {
    ...order,
    supplierName: row.supplier?.name || '-',
    itemCount: row._count?.items ?? items.length,
    totalItemQty: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    statusLabel: ORDER_STATUS_LABELS[order.status] || order.status,
    deliveryStatus: ORDER_STATUS_LABELS[order.status] || order.status,
    createdByName: row.creator?.name || null,
  };
};

const buildOrderWhere = (query = {}) => {
  const where = {};
  if (query.status) where.status = String(query.status);
  if (query.supplierId) where.supplierId = String(query.supplierId);
  if (query.source) where.source = String(query.source);
  const search = String(query.search || '').trim();
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { supplier: { is: { name: { contains: search, mode: 'insensitive' } } } },
    ];
  }
  return where;
};

const listOrdersFromPostgres = async (query = {}) => {
  const prisma = await getPrisma();
  const mode = resolvePaginationMode(query.paginationMode || query.mode);
  const sort = resolveWhitelistedSort(query.sort, ['createdAt_desc'], 'createdAt_desc', { context: 'GET /api/procurement/orders' });
  const includeTotal = parseBooleanQuery(query.includeTotal, true);
  if (mode === 'cursor' && sort !== 'createdAt_desc') {
    throw new AppError(400, 'cursor pagination only supports createdAt_desc sort for orders');
  }
  const limit = mode === 'cursor'
    ? parseLimit(query.limit, { defaultLimit: 50, maxLimit: 250 })
    : parsePagePagination(query, { defaultLimit: 50, maxLimit: 250 }).limit;
  const offsetPagination = mode === 'offset'
    ? parsePagePagination(query, { defaultLimit: 50, maxLimit: 250 })
    : null;
  const cursor = decodeCursor(query.cursor, { expectedSort: sort });
  const where = buildOrderWhere(query);
  const cursorWhere = mode === 'cursor' && cursor
    ? {
      OR: [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: String(cursor.id || '') } },
      ],
    }
    : {};
  const effectiveWhere = mode === 'cursor' && cursor
    ? { AND: [where, cursorWhere] }
    : where;
  const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }];
  const take = mode === 'cursor' ? limit + 1 : limit;
  const skip = offsetPagination?.skip || 0;
  const [total, rowsRaw] = await withPostgresQueryLogging('GET /api/procurement/orders', () => Promise.all([
    includeTotal ? prisma.purchaseOrder.count({ where }) : Promise.resolve(null),
    prisma.purchaseOrder.findMany({
      where: effectiveWhere,
      orderBy,
      skip: mode === 'offset' ? skip : 0,
      take,
      select: {
        id: true,
        orderNumber: true,
        supplierId: true,
        source: true,
        status: true,
        currentStatus: true,
        currency: true,
        subtotalAmount: true,
        taxAmount: true,
        shippingFee: true,
        discountAmount: true,
        grandTotal: true,
        totalAmount: true,
        deliveryStatus: true,
        goodsReceiptCompleted: true,
        stockEntryMode: true,
        stockEntryCompleted: true,
        archived: true,
        createdBy: true,
        warehouseCity: true,
        deliveryLocation: true,
        orderReason: true,
        priority: true,
        logisticsProvider: true,
        trackingNo: true,
        estimatedDeliveryDate: true,
        createdAt: true,
        updatedAt: true,
        approvedAt: true,
        deliveredAt: true,
        completedAt: true,
        archivedAt: true,
        payload: true,
        supplier: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
        items: { select: { quantity: true } },
        _count: { select: { items: true } },
        statusHistory: { orderBy: { at: 'asc' }, take: 25, select: { id: true, status: true, at: true, by: true, note: true, payload: true } },
        activityLogs: { orderBy: { at: 'asc' }, take: 25, select: { id: true, type: true, status: true, at: true, by: true, note: true, payload: true } },
      },
    }),
  ]));
  const hasNextPage = mode === 'cursor' ? rowsRaw.length > limit : (skip + rowsRaw.length) < total;
  const rows = mode === 'cursor' ? rowsRaw.slice(0, limit) : rowsRaw;
  const last = rows[rows.length - 1];
  const nextCursor = mode === 'cursor' && hasNextPage && last
    ? encodeCursor({ createdAt: fromDateValue(last.createdAt), id: last.id }, { sort })
    : null;

  return {
    items: rows.map(mapPurchaseOrderRow),
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
      status: query.status || null,
      supplierId: query.supplierId || null,
      source: query.source || null,
      search: String(query.search || '').trim() || null,
    },
    sort: {
      fields: ['createdAt', 'id'],
      direction: 'desc',
      key: sort,
    },
  };
};

const listOrderItemsFromPostgres = async (orderId) => {
  const prisma = await getPrisma();
  const existingOrder = await withPostgresQueryLogging('GET /api/procurement/orders/:id/items:order', () => prisma.purchaseOrder.findUnique({
    where: { id: orderId },
    select: { id: true },
  }));
  if (!existingOrder) throw createNotFoundError('Satın alma siparişi bulunamadı');

  const rows = await withPostgresQueryLogging('GET /api/procurement/orders/:id/items', () => prisma.purchaseOrderItem.findMany({
    where: { orderId },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      orderId: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      totalPrice: true,
      unit: true,
      taxRate: true,
      taxAmount: true,
      createdAt: true,
      updatedAt: true,
      payload: true,
      product: { select: { id: true, name: true, sku: true } },
    },
  }));

  return rows.map((row) => ({
    ...(row.payload && typeof row.payload === 'object' ? row.payload : {}),
    id: row.id,
    orderId: row.orderId,
    productId: row.productId,
    quantity: row.quantity,
    unitPrice: toNumberValue(row.unitPrice),
    totalPrice: toNumberValue(row.totalPrice),
    unit: row.unit,
    taxRate: toNumberValue(row.taxRate),
    taxAmount: toNumberValue(row.taxAmount),
    createdAt: fromDateValue(row.createdAt),
    updatedAt: fromDateValue(row.updatedAt),
    productName: row.product?.name || '-',
    sku: row.product?.sku || '-',
  }));
};

const createOrderFromSupplierProductPostgres = async (payload, userId) => {
  const supplierProductId = String(payload.supplierProductId || '').trim();
  if (!supplierProductId) throw new AppError(400, 'supplierProductId zorunludur');

  const prisma = await getPrisma();
  const row = await prisma.supplierProduct.findUnique({
    where: { id: supplierProductId },
    select: {
      id: true,
      productId: true,
      supplierId: true,
      purchasePrice: true,
      currency: true,
      minimumOrderQty: true,
      minOrderQty: true,
      priceUnit: true,
      minOrderUnit: true,
      defaultOrderUnit: true,
      unitsPerCase: true,
      casesPerPallet: true,
      leadTimeDays: true,
      isActive: true,
      payload: true,
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          unit: true,
          unitsPerCase: true,
          casesPerPallet: true,
          unitsPerPallet: true,
          requiredStorageType: true,
          isListed: true,
          isActive: true,
        },
      },
      supplier: { select: { id: true, name: true, code: true, supplierCode: true, isActive: true, payload: true } },
    },
  });
  if (!row) throw createNotFoundError('Belirtilen tedarikçi-ürün eşleşmesi sistemde kayıtlı değil');
  if (row.isActive === false || row.supplier?.isActive === false) throw new AppError(400, 'Pasif tedarikçi veya eşleşme için sipariş oluşturulamaz');
  if (!row.product || row.product.isActive === false) throw new AppError(400, 'Pasif veya eksik ürün için sipariş oluşturulamaz');

  const supplierProduct = mapSupplierProductRow(row);
  const product = {
    ...row.product,
    unitsPerCase: Number(row.product.unitsPerCase || 1),
    casesPerPallet: Number(row.product.casesPerPallet || 1),
    unitsPerPallet: Number(row.product.unitsPerPallet || 0),
    requiredStorageType: row.product.requiredStorageType || 'Ortam',
  };
  const requestedQty = ensurePositiveNumber(payload.quantity, 'quantity');
  const requestedUnit = normalizeUnitName(payload.orderUnit || payload.unit || supplierProduct.defaultOrderUnit || supplierProduct.priceUnit || 'adet');
  const unitValidation = assertValidSupplierProductOrderUnit({ supplierProduct, product, unit: requestedUnit });
  if (!unitValidation.isValid) {
    throw new AppError(400, `Seçilen sipariş birimi bu ürün için geçerli değil. Geçerli birimler: ${unitValidation.allowed.join(', ')}`);
  }

  const unitsPerCase = Math.max(1, Number(supplierProduct.unitsPerCase || product.unitsPerCase || 1));
  const casesPerPallet = Math.max(1, Number(supplierProduct.casesPerPallet || product.casesPerPallet || 1));
  const unitsPerPallet = Math.max(1, Number(product.unitsPerPallet || unitsPerCase * casesPerPallet));
  const toBaseUnits = (qty, unit) => {
    const normalized = normalizeUnitName(unit);
    if (normalized === 'koli' || normalized === 'kasa' || normalized === 'çuval') return qty * unitsPerCase;
    if (normalized === 'palet') return qty * unitsPerPallet;
    return qty;
  };
  const priceUnit = normalizeUnitName(supplierProduct.priceUnit || 'adet');
  const minOrderUnit = normalizeUnitName(supplierProduct.minOrderUnit || priceUnit);
  const minimumOrderQty = Math.max(1, Number(supplierProduct.minimumOrderQty || supplierProduct.minOrderQty || 1));
  const requestedInBase = toBaseUnits(requestedQty, requestedUnit);
  const minInBase = toBaseUnits(minimumOrderQty, minOrderUnit);
  if (requestedInBase < minInBase) {
    throw new AppError(400, `Bu tedarikçi için minimum sipariş miktarı ${minimumOrderQty} ${minOrderUnit} karşılığıdır`);
  }
  const rawPurchasePrice = ensurePositiveNumber(supplierProduct.purchasePrice, 'purchasePrice');
  const pricePerBaseUnit = rawPurchasePrice / Math.max(1, toBaseUnits(1, priceUnit));
  const totalPrice = Number((pricePerBaseUnit * requestedInBase).toFixed(2));
  const settings = await settingsRepo.getSettings();
  const selectedCargoTypeCode = String(payload.procurementContext?.cargoTypeCode || payload.cargoTypeCode || payload.shippingCarrier || supplierProduct.defaultCargoTypeCode || '').trim().toLowerCase();
  const caseQty = requestedUnit === 'koli' ? Math.ceil(requestedQty) : Math.ceil(requestedInBase / unitsPerCase);
  const storageType = resolveStorageType(product);
  const logisticsQuote = selectedCargoTypeCode
    ? logisticsTariffService.calculateQuote({
      rows: logisticsTariffService.normalizeTariffs(settings.logisticsTariffs || []),
      cargoTypeCode: selectedCargoTypeCode,
      caseQty,
      storageType,
      distanceType: selectedCargoTypeCode === 'store_transfer' ? 'internal_transfer' : 'intercity',
      isInternalTransfer: selectedCargoTypeCode === 'store_transfer',
    })
    : null;

  const now = new Date().toISOString();
  const vatRate = Number(payload.vatRate || 0) || 0;
  const shippingFee = logisticsQuote ? Number(logisticsQuote.totalPriceTl || 0) : Math.max(0, Number(payload.shippingFee || 0) || 0);
  const taxAmount = Number(((totalPrice * vatRate) / 100).toFixed(2));
  const grandTotal = Number((totalPrice + taxAmount + shippingFee).toFixed(2));
  const status = 'submitted_for_approval';
  const orderId = uuidv4();
  const existingOrderNumbers = await prisma.purchaseOrder.findMany({ select: { id: true, orderNumber: true } });
  const orderNumber = await buildOrderNumber(existingOrderNumbers);
  const procurementContext = {
    ...(payload.procurementContext || {}),
    orderingSnapshot: {
      orderedQuantity: requestedQty,
      orderedUnit: requestedUnit,
      baseQuantity: requestedInBase,
      baseUnit: 'adet',
      unitPrice: Number(pricePerBaseUnit.toFixed(4)),
      lineTotal: totalPrice,
    },
    logisticsSnapshot: logisticsQuote ? {
      cargoTypeCode: logisticsQuote.cargoTypeCode,
      cargoTypeName: logisticsQuote.cargoTypeName,
      caseQty: logisticsQuote.caseQty,
      totalPriceTl: logisticsQuote.totalPriceTl,
      calculationMethod: logisticsQuote.calculationMethod,
      appliedBand: logisticsQuote.appliedBand,
    } : null,
  };

  await prisma.$transaction([
    prisma.purchaseOrder.create({
      data: {
        id: orderId,
        orderNumber,
        supplierId: row.supplierId,
        source: 'manual_supplier_product',
        status,
        currentStatus: status,
        currency: row.currency || 'TRY',
        subtotalAmount: totalPrice,
        taxAmount,
        shippingFee,
        grandTotal,
        totalAmount: grandTotal,
        deliveryStatus: ORDER_STATUS_LABELS[status],
        goodsReceiptCompleted: false,
        stockEntryCompleted: false,
        archived: false,
        createdBy: userId,
        warehouseCity: 'İzmir',
        deliveryLocation: payload.deliveryLocation || 'store',
        orderReason: procurementContext.orderReason || payload.orderReason || 'regular_replenishment',
        priority: payload.priority || 'normal',
        estimatedDeliveryDate: getEstimatedDeliveryDate(Number(supplierProduct.leadTimeDays || 3)),
        payload: {
          procurementContext,
          note: payload.note || '',
          deliveryDateMode: payload.deliveryDateMode || 'estimated',
          requestedDeliveryDate: payload.deliveryDate || null,
          statusHistory: [{ status, at: now, by: userId }],
          activityLog: [{ type: 'created', status, at: now, by: userId, note: payload.note || '' }],
        },
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    }),
    prisma.purchaseOrderItem.create({
      data: {
        id: uuidv4(),
        orderId,
        productId: row.productId,
        quantity: Math.round(requestedInBase),
        unitPrice: Number(pricePerBaseUnit.toFixed(4)),
        totalPrice,
        unit: requestedUnit,
        taxRate: vatRate,
        taxAmount,
        payload: {
          supplierProductId,
          orderedQuantity: requestedQty,
          orderedUnit: requestedUnit,
          baseQuantity: requestedInBase,
          lineTotal: totalPrice,
        },
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    }),
    prisma.purchaseOrderStatusHistory.create({ data: { orderId, status, at: new Date(now), by: userId } }),
    prisma.purchaseOrderActivityLog.create({ data: { orderId, type: 'created', status, at: new Date(now), by: userId, note: payload.note || '' } }),
  ]);

  const created = await prisma.purchaseOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, orderNumber: true, supplierId: true, source: true, status: true, currentStatus: true, currency: true,
      subtotalAmount: true, taxAmount: true, shippingFee: true, discountAmount: true, grandTotal: true, totalAmount: true,
      deliveryStatus: true, goodsReceiptCompleted: true, stockEntryMode: true, stockEntryCompleted: true, archived: true,
      createdBy: true, warehouseCity: true, deliveryLocation: true, orderReason: true, priority: true, logisticsProvider: true,
      trackingNo: true, estimatedDeliveryDate: true, payload: true, createdAt: true, updatedAt: true, approvedAt: true,
      deliveredAt: true, completedAt: true, archivedAt: true, supplier: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true } }, items: { select: { quantity: true } }, _count: { select: { items: true } },
      statusHistory: { select: { id: true, status: true, at: true, by: true, note: true, payload: true } },
      activityLogs: { select: { id: true, type: true, status: true, at: true, by: true, note: true, payload: true } },
    },
  });
  return mapPurchaseOrderRow(created);
};

const buildSupplierProductWhere = (query = {}) => {
  const where = {};
  if (query.productId) where.productId = String(query.productId);
  if (query.supplierId) where.supplierId = String(query.supplierId);
  if (query.isActive !== undefined && query.isActive !== '') {
    where.isActive = ['1', 'true', 'yes'].includes(String(query.isActive).toLowerCase());
  }

  const search = String(query.search || query.q || '').trim();
  if (search) {
    where.OR = [
      { supplierProductName: { contains: search, mode: 'insensitive' } },
      { supplierProductCode: { contains: search, mode: 'insensitive' } },
      { supplierSku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
      { product: { is: { name: { contains: search, mode: 'insensitive' } } } },
      { product: { is: { sku: { contains: search, mode: 'insensitive' } } } },
      { product: { is: { barcode: { contains: search, mode: 'insensitive' } } } },
      { supplier: { is: { name: { contains: search, mode: 'insensitive' } } } },
    ];
  }

  return where;
};

const mapSupplierProductRow = (row) => ({
  ...((row.payload && typeof row.payload === 'object') ? row.payload : {}),
  id: row.id,
  productId: row.productId,
  supplierId: row.supplierId,
  supplierProductCode: row.supplierProductCode,
  supplierProductName: row.supplierProductName || row.product?.name || '-',
  supplierSku: row.supplierSku,
  barcode: row.barcode || row.product?.barcode || '',
  purchasePrice: toNumberValue(row.purchasePrice),
  currency: row.currency || 'TRY',
  minimumOrderQty: row.minimumOrderQty ?? row.minOrderQty ?? 1,
  minOrderQty: row.minOrderQty ?? row.minimumOrderQty ?? 1,
  leadTimeDays: row.leadTimeDays ?? 0,
  isDefault: row.isDefault === true,
  isPrimary: row.isDefault === true,
  isActive: row.isActive !== false,
  source: row.source,
  priceUnit: normalizeUnitName(row.priceUnit || 'adet'),
  minOrderUnit: normalizeUnitName(row.minOrderUnit || row.priceUnit || 'adet'),
  defaultOrderUnit: normalizeUnitName(row.defaultOrderUnit || row.minOrderUnit || row.priceUnit || 'adet'),
  orderableUnits: resolveSupplierProductOrderableUnits(row, row.product || {}),
  unitsPerCase: row.unitsPerCase,
  casesPerPallet: row.casesPerPallet,
  createdAt: fromDateValue(row.createdAt),
  updatedAt: fromDateValue(row.updatedAt),
  productName: row.product?.name || row.supplierProductName || '-',
  productSku: row.product?.sku || '-',
  sku: row.product?.sku || row.supplierSku || '-',
  productBarcode: row.product?.barcode || '',
  categoryId: row.product?.categoryId || null,
  storageType: row.product?.requiredStorageType || 'Ortam',
  supplierName: row.supplier?.name || '-',
  supplierCode: row.supplier?.supplierCode || row.supplier?.code || row.supplierId,
});

const listSupplierProductsFromPostgres = async (query = {}) => {
  const prisma = await getPrisma();
  const page = parsePagePagination(query, { defaultLimit: 50, maxLimit: 250 });
  const sort = resolveWhitelistedSort(query.sort, ['createdAt_desc', 'productName_asc', 'supplierName_asc'], 'createdAt_desc', { context: 'GET /api/procurement/supplier-products' });
  const where = buildSupplierProductWhere(query);
  const orderBy = sort === 'productName_asc'
    ? [{ product: { name: 'asc' } }, { id: 'asc' }]
    : sort === 'supplierName_asc'
      ? [{ supplier: { name: 'asc' } }, { id: 'asc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];

  const [total, rows] = await withPostgresQueryLogging('GET /api/procurement/supplier-products', () => Promise.all([
    prisma.supplierProduct.count({ where }),
    prisma.supplierProduct.findMany({
      where,
      orderBy,
      skip: page.skip,
      take: page.limit,
      select: {
        id: true,
        productId: true,
        supplierId: true,
        supplierProductCode: true,
        supplierProductName: true,
        supplierSku: true,
        barcode: true,
        purchasePrice: true,
        currency: true,
        minimumOrderQty: true,
        minOrderQty: true,
        leadTimeDays: true,
        isDefault: true,
        isActive: true,
        source: true,
        payload: true,
        priceUnit: true,
        minOrderUnit: true,
        defaultOrderUnit: true,
        unitsPerCase: true,
        casesPerPallet: true,
        createdAt: true,
        updatedAt: true,
        product: { select: { id: true, name: true, sku: true, barcode: true, categoryId: true, requiredStorageType: true } },
        supplier: { select: { id: true, name: true, supplierCode: true, code: true } },
      },
    }),
  ]));

  return {
    items: rows.map(mapSupplierProductRow),
    pagination: {
      mode: 'offset',
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / page.limit)),
      hasNextPage: page.skip + rows.length < total,
    },
    filters: {
      productId: query.productId || null,
      supplierId: query.supplierId || null,
      isActive: query.isActive ?? null,
      search: String(query.search || query.q || '').trim() || null,
    },
    sort: { key: sort },
  };
};

const resolveActorName = async (actorUserId) => {
  if (!actorUserId || actorUserId === SYSTEM_AUTO_USER_ID) {
    return 'Sistem';
  }

  const actor = await userRepo.findById(actorUserId);
  return actor?.name || 'Sistem';
};

const normalizeAuditKeyPart = (value) => String(value || '').trim().toLowerCase();

const normalizeIsoTimestamp = (value) => {
  const parsed = parseSafeDate(value);
  return parsed ? parsed.toISOString() : '';
};

const TECHNICAL_ACTIVITY_KEYWORDS = ['sync', 'repair'];

const normalizeActivityType = (value) => {
  const normalized = normalizeAuditKeyPart(value || 'status_change');
  if (!normalized) return 'status_change';
  if (normalized === 'status_auto_progress') return 'status_change';
  return normalized;
};

const isTechnicalActivityEntry = (entry = {}) => {
  const type = normalizeAuditKeyPart(entry.type);
  return TECHNICAL_ACTIVITY_KEYWORDS.some((keyword) => type.includes(keyword));
};

const buildActivityDedupKey = (entry = {}) => [
  normalizeActivityType(entry.type),
  normalizeAuditKeyPart(normalizeLegacyOrderStatus(entry.status)),
].join('|');

const buildStatusHistoryDedupKey = (entry = {}) => [
  normalizeAuditKeyPart(normalizeLegacyOrderStatus(entry.status)),
].join('|');

const dedupeRowsByKey = (rows = [], keyBuilder) => {
  const deduped = [];
  const seen = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const key = keyBuilder(row);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
};

const ensureOrderStatusMirrorFields = (order = {}, status) => ({
  ...order,
  status,
  currentStatus: status,
  current_status: status,
});

const appendOrderActivityIfMissing = (order = {}, entry = {}) => {
  const activityLog = dedupeRowsByKey(
    (Array.isArray(order.activityLog) ? order.activityLog : [])
      .filter((row) => !isTechnicalActivityEntry(row))
      .map((row) => ({
        ...row,
        type: normalizeActivityType(row?.type),
        status: normalizeLegacyOrderStatus(row?.status),
      })),
    buildActivityDedupKey,
  );
  if (isTechnicalActivityEntry(entry)) {
    return {
      ...order,
      activityLog,
    };
  }

  const normalizedEntry = {
    ...entry,
    type: normalizeActivityType(entry?.type),
    status: normalizeLegacyOrderStatus(entry?.status),
  };
  const dedupKey = buildActivityDedupKey(normalizedEntry);
  const exists = activityLog.some((row) => buildActivityDedupKey(row) === dedupKey);
  if (!exists) {
    activityLog.push(normalizedEntry);
  }

  return {
    ...order,
    activityLog: dedupeRowsByKey(activityLog, buildActivityDedupKey),
  };
};

const appendStatusHistoryIfMissing = (order = {}, entry = {}) => {
  const statusHistory = dedupeRowsByKey(
    (Array.isArray(order.statusHistory) ? order.statusHistory : []).map((row) => ({
      ...row,
      status: normalizeLegacyOrderStatus(row?.status),
    })),
    buildStatusHistoryDedupKey,
  );
  const normalizedEntry = {
    ...entry,
    status: normalizeLegacyOrderStatus(entry?.status),
  };
  const dedupKey = buildStatusHistoryDedupKey(normalizedEntry);
  const exists = statusHistory.some((row) => buildStatusHistoryDedupKey(row) === dedupKey);
  if (!exists) {
    statusHistory.push(normalizedEntry);
  }

  return {
    ...order,
    statusHistory: dedupeRowsByKey(statusHistory, buildStatusHistoryDedupKey),
  };
};

const syncOrderFlowFlags = (order = {}, nextStatus, transitionIso) => {
  const base = {
    ...order,
    deliveryStatus: ORDER_STATUS_LABELS[nextStatus] || nextStatus,
    archived: nextStatus === 'archived',
    archivedAt: nextStatus === 'archived' ? (order.archivedAt || transitionIso) : null,
  };

  if (nextStatus === 'goods_receipt_completed') {
    return {
      ...base,
      goodsReceiptCompleted: true,
      goods_receipt_completed: true,
      goodsReceiptCompletedAt: order.goodsReceiptCompletedAt || transitionIso,
      completedAt: null,
    };
  }

  if (nextStatus === 'stock_entry_pending') {
    return {
      ...base,
      goodsReceiptCompleted: true,
      goods_receipt_completed: true,
      goodsReceiptCompletedAt: order.goodsReceiptCompletedAt || transitionIso,
      stockEntryMode: MANUAL_STOCK_ENTRY_MODE,
      stockEntryMethod: MANUAL_STOCK_ENTRY_MODE,
      stockEntryCompleted: false,
      stock_entry_completed: false,
      stockEntryCompletedAt: null,
      completedAt: null,
      stockEntryPendingAt: order.stockEntryPendingAt || transitionIso,
    };
  }

  if (nextStatus === 'completed') {
    return {
      ...base,
      goodsReceiptCompleted: true,
      goods_receipt_completed: true,
      stockEntryCompleted: true,
      stock_entry_completed: true,
      stockEntryCompletedAt: order.stockEntryCompletedAt || transitionIso,
      completedAt: order.completedAt || transitionIso,
    };
  }

  return base;
};

const normalizeStockEntryMode = (value) => (String(value || '').trim().toLowerCase() === MANUAL_STOCK_ENTRY_MODE ? MANUAL_STOCK_ENTRY_MODE : AUTO_STOCK_ENTRY_MODE);

const normalizeLegacyOrderStatus = (value) => {
  const status = String(value || '').trim();
  if (!status) return 'submitted_for_approval';
  if (status === 'draft') return 'submitted_for_approval';
  return status;
};

const isManualStockEntryPendingOrder = (order = {}) => {
  const status = String(order.status || '').trim();
  const mode = normalizeStockEntryMode(order.stockEntryMode || order.stockEntryMethod);
  const stockEntryCompleted = order.stockEntryCompleted === true || order.stock_entry_completed === true || Boolean(order.stockEntryCompletedAt);
  const goodsReceiptCompleted = order.goodsReceiptCompleted === true || order.goods_receipt_completed === true || Boolean(order.goodsReceiptCompletedAt);

  if (order.archived === true || status === 'archived') return false;
  if (status === 'stock_entry_pending') return true;
  return goodsReceiptCompleted && mode === MANUAL_STOCK_ENTRY_MODE && !stockEntryCompleted;
};

const applyManualStockEntryPendingState = (order = {}, transitionIso) => ({
  ...order,
  goodsReceiptCompleted: true,
  goods_receipt_completed: true,
  goodsReceiptCompletedAt: order.goodsReceiptCompletedAt || transitionIso,
  stockEntryMode: MANUAL_STOCK_ENTRY_MODE,
  stockEntryMethod: MANUAL_STOCK_ENTRY_MODE,
  stockEntryCompleted: false,
  stock_entry_completed: false,
  stockEntryCompletedAt: null,
  completedAt: null,
  archived: false,
  archivedAt: null,
});

const applyAutoStockEntryCompletedState = (order = {}, transitionIso) => ({
  ...order,
  goodsReceiptCompleted: true,
  goods_receipt_completed: true,
  goodsReceiptCompletedAt: order.goodsReceiptCompletedAt || transitionIso,
  stockEntryMode: AUTO_STOCK_ENTRY_MODE,
  stockEntryMethod: AUTO_STOCK_ENTRY_MODE,
  stockEntryCompleted: true,
  stock_entry_completed: true,
  stockEntryCompletedAt: order.stockEntryCompletedAt || transitionIso,
  stockBookedAt: order.stockBookedAt || transitionIso,
});

const prepareOrderForRead = (order = {}) => {
  const status = normalizeLegacyOrderStatus(order.status);
  const withMirrors = ensureOrderStatusMirrorFields({
    ...order,
    status,
    orderNumber: normalizeOrderNumber(order.orderNumber, order.id),
  }, status);
  return {
    ...withMirrors,
    statusHistory: dedupeRowsByKey((withMirrors.statusHistory || []).map((entry) => ({
      ...entry,
      status: normalizeLegacyOrderStatus(entry?.status),
    })), buildStatusHistoryDedupKey),
    activityLog: dedupeRowsByKey((withMirrors.activityLog || [])
      .filter((entry) => !isTechnicalActivityEntry(entry))
      .map((entry) => ({
        ...entry,
        type: normalizeActivityType(entry?.type),
        status: normalizeLegacyOrderStatus(entry?.status),
      })), buildActivityDedupKey),
  };
};

const transitionOrderStatus = async (params) => applyOrderStatusTransition(params);

const completeGoodsReceiptFlow = async ({ order, actorUserId, note, timestampIso, stockEntryMode }) => {
  const mode = normalizeStockEntryMode(stockEntryMode);
  let updated = await transitionOrderStatus({
    order,
    nextStatus: 'goods_receipt_completed',
    actorUserId,
    note: note || (mode === AUTO_STOCK_ENTRY_MODE
      ? 'Mal kabul tamamlandı. Stok girişi otomatik uygulanacak.'
      : 'Mal kabul tamamlandı. Stok girişi manuel tamamlanacak.'),
    timestampIso,
    eventType: 'status_change',
  });

  if (mode === MANUAL_STOCK_ENTRY_MODE) {
    updated = await transitionOrderStatus({
      order: applyManualStockEntryPendingState(updated, timestampIso),
      nextStatus: 'stock_entry_pending',
      actorUserId,
      note: 'Manuel stok girişi bekleniyor.',
      timestampIso,
      eventType: 'status_change',
    });
  }

  return { order: updated, stockEntryMode: mode };
};

const finalizeManualStockEntryFlow = async ({ order, actorUserId, note, timestampIso, archive = true }) => {
  let updated = {
    ...order,
    stockEntryMode: MANUAL_STOCK_ENTRY_MODE,
    stockEntryMethod: MANUAL_STOCK_ENTRY_MODE,
    stockEntryCompleted: true,
    stock_entry_completed: true,
    stockEntryCompletedAt: order.stockEntryCompletedAt || timestampIso,
  };

  updated = await transitionOrderStatus({
    order: updated,
    nextStatus: 'completed',
    actorUserId,
    note: note || 'Manuel stok girişi tamamlandı.',
    timestampIso,
    eventType: 'status_change',
  });

  if (archive) {
    updated = await transitionOrderStatus({
      order: updated,
      nextStatus: 'archived',
      actorUserId,
      note: 'Sipariş tamamlandı ve arşive taşındı.',
      timestampIso,
      eventType: 'status_change',
    });
  }

  return updated;
};

const applyOrderStatusTransition = async ({
  order,
  nextStatus,
  actorUserId,
  note = '',
  timestampIso,
  eventType = 'status_change',
}) => {
  const currentStatus = String(order?.status || '').trim();
  if (!order || !nextStatus || currentStatus === nextStatus) {
    return order;
  }

  validateOrderStatus(nextStatus);

  const transitionAt = parseSafeDate(timestampIso) || new Date();
  const transitionIso = transitionAt.toISOString();
  const normalizedNote = String(note || '').trim();

  let updated = ensureOrderStatusMirrorFields(order, nextStatus);

  const statusHistoryEntry = {
    status: nextStatus,
    at: transitionIso,
    by: actorUserId,
    source: actorUserId || SYSTEM_AUTO_USER_ID,
    note: normalizedNote || undefined,
  };
  updated = appendStatusHistoryIfMissing(updated, statusHistoryEntry);

  const activityEntry = {
    type: eventType,
    status: nextStatus,
    at: transitionIso,
    by: actorUserId,
    source: actorUserId || SYSTEM_AUTO_USER_ID,
    note: normalizedNote || undefined,
  };
  updated = appendOrderActivityIfMissing(updated, activityEntry);

  updated = {
    ...updated,
    updatedAt: transitionIso,
  };

  updated = syncOrderFlowFlags(updated, nextStatus, transitionIso);

  if (nextStatus === 'approved' && !updated.approvedAt) {
    updated.approvedAt = transitionIso;
    if (actorUserId && actorUserId !== SYSTEM_AUTO_USER_ID) {
      updated.approvedBy = actorUserId;
    }
  }

  if (nextStatus === 'delivered') {
    updated.deliveredAt = updated.deliveredAt || transitionIso;
    updated.goodsReceiptPendingAt = updated.goodsReceiptPendingAt || transitionIso;
  }

  if (nextStatus === 'goods_receipt_pending') {
    updated.goodsReceiptPendingAt = updated.goodsReceiptPendingAt || transitionIso;
  }

  if (nextStatus === 'goods_receipt_completed') {
    updated.goodsReceiptCompletedAt = updated.goodsReceiptCompletedAt || transitionIso;
  }

  if (nextStatus === 'stock_entry_pending') {
    updated.stockEntryPendingAt = updated.stockEntryPendingAt || transitionIso;
    updated.stockEntryMode = MANUAL_STOCK_ENTRY_MODE;
    updated.stockEntryMethod = MANUAL_STOCK_ENTRY_MODE;
  }

  if (nextStatus === 'completed') {
    updated.completedAt = updated.completedAt || transitionIso;
  }

  if (nextStatus === 'archived') {
    updated.archivedAt = updated.archivedAt || transitionIso;
  }

  return updated;
};

const applyOrderAutoProgression = async (order, { persist = true } = {}) => {
  const initialStatus = String(order?.status || '').trim();
  if (!order || TERMINAL_STATUSES.has(initialStatus) || PRE_APPROVAL_MANUAL_STATUSES.has(initialStatus)) {
    return order;
  }
  if (!AUTO_MANAGED_STATUSES.has(initialStatus)) {
    return order;
  }

  let workingOrder = order;
  let changed = false;

  const timelineResult = ensureOrderAutoTimeline(workingOrder);
  if (timelineResult.changed) {
    workingOrder = {
      ...timelineResult.order,
      updatedAt: new Date().toISOString(),
    };
    changed = true;
  }

  const targetStatus = getOrderCurrentStatus(workingOrder, new Date());
  const currentStatus = String(workingOrder.status || '').trim();

  if (targetStatus !== currentStatus) {
    if (targetStatus === 'cancelled') {
      const cancelAt = getStatusTimestampByTarget(workingOrder, 'cancelled', new Date().toISOString());
      workingOrder = await applyOrderStatusTransition({
        order: workingOrder,
        nextStatus: 'cancelled',
        actorUserId: SYSTEM_AUTO_USER_ID,
        note: 'Simulasyon: hazirlama asamasinda otomatik iptal edildi.',
        timestampIso: cancelAt,
        eventType: 'status_auto_progress',
      });
      changed = true;
    } else {
      const currentRank = getAutoStatusRank(currentStatus);
      const targetRank = getAutoStatusRank(targetStatus);

      if (targetRank > currentRank) {
        const forwardStatuses = AUTO_MANAGED_SEQUENCE.slice(Math.max(0, currentRank + 1), targetRank + 1);
        for (const status of forwardStatuses) {
          const at = getStatusTimestampByTarget(workingOrder, status, new Date().toISOString());
          workingOrder = await applyOrderStatusTransition({
            order: workingOrder,
            nextStatus: status,
            actorUserId: SYSTEM_AUTO_USER_ID,
            note: 'Onay sonrasi otomatik durum ilerletme.',
            timestampIso: at,
            eventType: 'status_auto_progress',
          });
          changed = true;
        }

        if (targetStatus === 'delivered' && String(workingOrder.status || '') === 'delivered') {
          const at = new Date().toISOString();
          workingOrder = await applyOrderStatusTransition({
            order: workingOrder,
            nextStatus: 'goods_receipt_pending',
            actorUserId: SYSTEM_AUTO_USER_ID,
            note: 'Sipariş depoya ulaştı. Mal kabul onayı bekleniyor.',
            timestampIso: at,
            eventType: 'status_auto_progress',
          });
          changed = true;
        }
      }
    }
  }

  if (changed && persist) {
    await purchaseOrderRepo.updateById(workingOrder.id, workingOrder);
  }

  return workingOrder;
};

export const procurementService = {
  async listLogisticsTariffs(query = {}) {
    const settings = await settingsRepo.getSettings();
    const rows = logisticsTariffService.normalizeTariffs(settings.logisticsTariffs || []);
    const filteredRows = logisticsTariffService.filterTariffsForSelection(rows, {
      storageType: query.storageType,
      distanceType: query.distanceType,
      isInternalTransfer: query.isInternalTransfer === true || String(query.isInternalTransfer || '').toLowerCase() === 'true',
    });

    return {
      rows: filteredRows,
      cargoTypes: logisticsTariffService.buildCargoTypeSummary(filteredRows),
      stats: {
        activeCargoTypeCount: logisticsTariffService.buildCargoTypeSummary(rows).filter((item) => item.isActive).length,
        coldChainTypeCount: logisticsTariffService.buildCargoTypeSummary(rows).filter((item) => item.isColdChain).length,
        frozenChainTypeCount: logisticsTariffService.buildCargoTypeSummary(rows).filter((item) => item.isFrozenChain).length,
      },
    };
  },

  async getLogisticsQuote(payload = {}) {
    const settings = await settingsRepo.getSettings();
    const rows = logisticsTariffService.normalizeTariffs(settings.logisticsTariffs || []);
    const quote = logisticsTariffService.calculateQuote({
      rows,
      cargoTypeCode: payload.cargoTypeCode,
      caseQty: payload.caseQty,
      lineItems: payload.lineItems,
      manualOverrideTl: payload.manualOverrideTl,
      storageType: payload.storageType,
      storageTypes: payload.storageTypes,
      distanceType: payload.distanceType,
      isInternalTransfer: payload.isInternalTransfer === true,
    });

    return quote;
  },

  async listSupplierProducts(query = {}) {
    if (config.dataStore === 'postgres') {
      return listSupplierProductsFromPostgres(query);
    }

    const [{ productMap, supplierMap }, supplierProducts] = await Promise.all([
      buildProductSupplierMaps(),
      supplierProductRepo.getAll(),
    ]);
    const pagination = parsePagePagination(query, { defaultLimit: 50, maxLimit: 250 });
    const normalizedSearch = normalizeSearchText(query.search || query.q);

    const filtered = supplierProducts.filter((item) => {
      const product = productMap.get(item.productId);
      const supplier = supplierMap.get(item.supplierId);
      const matchesProduct = !query.productId || item.productId === query.productId;
      const matchesSupplier = !query.supplierId || item.supplierId === query.supplierId;
      const matchesActive =
        query.isActive === undefined || query.isActive === ''
          ? true
          : String(item.isActive) === String(query.isActive);
      const matchesSearch = !normalizedSearch || [
        item.supplierProductName,
        item.supplierProductCode,
        item.supplierSku,
        item.barcode,
        product?.name,
        product?.sku,
        product?.barcode,
        supplier?.name,
      ].filter(Boolean).some((value) => includesSearchText(value, normalizedSearch));

      return matchesProduct && matchesSupplier && matchesActive && matchesSearch;
    });

    const sorted = sortByNewest(filtered);
    const pageRows = sorted.slice(pagination.skip, pagination.skip + pagination.limit);
    const total = sorted.length;

    return {
      items: pageRows.map((item) => enrichSupplierProduct(item, productMap, supplierMap)),
      pagination: {
        mode: 'offset',
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
        hasNextPage: pagination.skip + pageRows.length < total,
        hasPreviousPage: pagination.page > 1,
      },
      filters: {
        productId: query.productId || null,
        supplierId: query.supplierId || null,
        isActive: query.isActive ?? null,
        search: String(query.search || query.q || '').trim() || null,
      },
      sort: { key: 'createdAt_desc' },
    };
  },

  async createSupplierProduct(payload) {
    const productId = String(payload.productId || '').trim();
    const supplierId = String(payload.supplierId || '').trim();

    if (!productId || !supplierId) {
      throw new AppError(400, 'productId ve supplierId zorunludur');
    }

    const [product, supplier, all] = await Promise.all([
      productRepo.findById(productId),
      supplierRepo.findById(supplierId),
      supplierProductRepo.getAll(),
    ]);

    if (!product) throw createNotFoundError('Ürün bulunamadı');
    if (!supplier) throw createNotFoundError('Tedarikçi bulunamadı');

    validateSupplierCategoryCompatibility(product, supplier);

    const duplicate = all.find((row) => row.productId === productId && row.supplierId === supplierId);
    if (duplicate) {
      throw new AppError(409, 'Bu ürün-tedarikçi eşleşmesi zaten mevcut');
    }

    const now = new Date().toISOString();
    const currency = String(payload.currency || 'TRY').toUpperCase();
    const priceUnit = (payload.priceUnit || 'adet').toString().toLowerCase();
    const minOrderUnit = (payload.minOrderUnit || priceUnit).toString().toLowerCase();
    const defaultOrderUnit = (payload.defaultOrderUnit || payload.orderUnit || priceUnit).toString().toLowerCase();
    const supplierProductCode = String(payload.supplierProductCode || '').trim();
    const supplierProductName = String(payload.supplierProductName || '').trim();
    const supplierSku = String(payload.supplierSku || payload.supplierProductSku || '').trim();
    const barcode = String(payload.barcode || '').trim();
    const note = String(payload.note || '').trim();
    const isDefault = payload.isPrimary !== undefined
      ? Boolean(payload.isPrimary)
      : payload.isDefault !== undefined
        ? Boolean(payload.isDefault)
        : false;

    const item = {
      id: uuidv4(),
      productId,
      supplierId,
      purchasePrice: ensurePositiveNumber(payload.purchasePrice, 'purchasePrice'),
      currency,
      minimumOrderQty: resolveMinimumOrderQty(payload, 1),
      leadTimeDays: Math.max(1, Math.floor(ensurePositiveNumber(payload.leadTimeDays || 3, 'leadTimeDays'))),
      priceUnit,
      minOrderUnit,
      defaultOrderUnit,
      supplierProductCode,
      supplierProductName,
      supplierSku,
      barcode,
      note,
      unitsPerPack: ensurePositiveInteger(payload.unitsPerPack, 1),
      unitsPerBox: ensurePositiveInteger(payload.unitsPerBox, 1),
      unitsPerCase: ensurePositiveInteger(payload.unitsPerCase, 1),
      casesPerPallet: ensurePositiveInteger(payload.casesPerPallet, 1),
      unitsPerPallet: ensurePositiveInteger(payload.unitsPerPallet, 1),
      tierPrice3Case: payload.tierPrice3Case !== undefined ? ensurePositiveNumber(payload.tierPrice3Case, 'tierPrice3Case') : null,
      tierPrice10Case: payload.tierPrice10Case !== undefined ? ensurePositiveNumber(payload.tierPrice10Case, 'tierPrice10Case') : null,
      tierPrice20Case: payload.tierPrice20Case !== undefined ? ensurePositiveNumber(payload.tierPrice20Case, 'tierPrice20Case') : null,
      defaultCargoTypeCode: String(payload.defaultCargoTypeCode || '').trim().toLowerCase(),
      supplierLogisticsNote: String(payload.supplierLogisticsNote || '').trim(),
      isDefault,
      isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
      lastPriceUpdate: now,
      createdAt: now,
      updatedAt: now,
    };

    await supplierProductRepo.create(item);
    const { productMap, supplierMap } = await buildMaps();

    if (item.isDefault === true) {
      await ensureSingleDefaultForProduct(productId, item.id);
    } else {
      await ensureComputedDefaultForProduct(productId);
    }

    return enrichSupplierProduct(item, productMap, supplierMap);
  },

  async updateSupplierProduct(id, payload) {
    const existing = await supplierProductRepo.findById(id);
    if (!existing) throw createNotFoundError('Tedarikçi ürünü bulunamadı');

    const productId = payload.productId !== undefined ? String(payload.productId).trim() : existing.productId;
    const supplierId = payload.supplierId !== undefined ? String(payload.supplierId).trim() : existing.supplierId;

    const [product, supplier] = await Promise.all([
      productRepo.findById(productId),
      supplierRepo.findById(supplierId),
    ]);
    if (!product) throw createNotFoundError('Ürün bulunamadı');
    if (!supplier) throw createNotFoundError('Tedarikçi bulunamadı');

    validateSupplierCategoryCompatibility(product, supplier);

    if (productId !== existing.productId || supplierId !== existing.supplierId) {
      const all = await supplierProductRepo.getAll();
      const duplicate = all.find((row) => row.id !== id && row.productId === productId && row.supplierId === supplierId);
      if (duplicate) {
        throw new AppError(409, 'Bu ürün-tedarikçi eşleşmesi zaten mevcut');
      }
    }

    const purchasePrice = payload.purchasePrice !== undefined
      ? ensurePositiveNumber(payload.purchasePrice, 'purchasePrice')
      : existing.purchasePrice;

    const minimumOrderQty = (
      payload.minimumOrderQty !== undefined
      || payload.minimumOrderCaseQty !== undefined
      || payload.moqCases !== undefined
      || payload.moq !== undefined
    )
      ? resolveMinimumOrderQty(payload, existing.minimumOrderQty || 1)
      : existing.minimumOrderQty;

    const currency = payload.currency !== undefined
      ? String(payload.currency || 'TRY').toUpperCase()
      : String(existing.currency || 'TRY').toUpperCase();

    const priceUnit = payload.priceUnit !== undefined
      ? String(payload.priceUnit).toLowerCase()
      : (existing.priceUnit || 'adet');

    const minOrderUnit = payload.minOrderUnit !== undefined
      ? String(payload.minOrderUnit).toLowerCase()
      : (existing.minOrderUnit || priceUnit || 'adet');

    const defaultOrderUnit = payload.defaultOrderUnit !== undefined
      ? String(payload.defaultOrderUnit).toLowerCase()
      : (payload.orderUnit !== undefined
        ? String(payload.orderUnit).toLowerCase()
        : (existing.defaultOrderUnit || existing.orderUnit || priceUnit || 'adet'));

    const leadTimeDays = payload.leadTimeDays !== undefined
      ? Math.max(1, Math.floor(ensurePositiveNumber(payload.leadTimeDays, 'leadTimeDays')))
      : existing.leadTimeDays;

    const isDefault = payload.isPrimary !== undefined
      ? Boolean(payload.isPrimary)
      : payload.isDefault !== undefined
        ? Boolean(payload.isDefault)
        : existing.isDefault === true;

    const now = new Date().toISOString();
    const updated = {
      ...existing,
      productId,
      supplierId,
      purchasePrice,
      currency,
      minimumOrderQty,
      priceUnit,
      minOrderUnit,
      defaultOrderUnit,
      supplierProductCode: payload.supplierProductCode !== undefined
        ? String(payload.supplierProductCode || '').trim()
        : String(existing.supplierProductCode || '').trim(),
      supplierProductName: payload.supplierProductName !== undefined
        ? String(payload.supplierProductName || '').trim()
        : String(existing.supplierProductName || '').trim(),
      supplierSku: payload.supplierSku !== undefined
        ? String(payload.supplierSku || '').trim()
        : (payload.supplierProductSku !== undefined
          ? String(payload.supplierProductSku || '').trim()
          : String(existing.supplierSku || existing.supplierProductSku || '').trim()),
      barcode: payload.barcode !== undefined
        ? String(payload.barcode || '').trim()
        : String(existing.barcode || '').trim(),
      note: payload.note !== undefined
        ? String(payload.note || '').trim()
        : String(existing.note || '').trim(),
      unitsPerPack: payload.unitsPerPack !== undefined
        ? ensurePositiveInteger(payload.unitsPerPack, existing.unitsPerPack || 1)
        : ensurePositiveInteger(existing.unitsPerPack, 1),
      unitsPerBox: payload.unitsPerBox !== undefined
        ? ensurePositiveInteger(payload.unitsPerBox, existing.unitsPerBox || 1)
        : ensurePositiveInteger(existing.unitsPerBox, 1),
      unitsPerCase: payload.unitsPerCase !== undefined
        ? ensurePositiveInteger(payload.unitsPerCase, existing.unitsPerCase || 1)
        : ensurePositiveInteger(existing.unitsPerCase, 1),
      casesPerPallet: payload.casesPerPallet !== undefined
        ? ensurePositiveInteger(payload.casesPerPallet, existing.casesPerPallet || 1)
        : ensurePositiveInteger(existing.casesPerPallet, 1),
      unitsPerPallet: payload.unitsPerPallet !== undefined
        ? ensurePositiveInteger(payload.unitsPerPallet, existing.unitsPerPallet || 1)
        : ensurePositiveInteger(existing.unitsPerPallet, 1),
      tierPrice3Case: payload.tierPrice3Case !== undefined
        ? ensurePositiveNumber(payload.tierPrice3Case, 'tierPrice3Case')
        : (existing.tierPrice3Case ?? null),
      tierPrice10Case: payload.tierPrice10Case !== undefined
        ? ensurePositiveNumber(payload.tierPrice10Case, 'tierPrice10Case')
        : (existing.tierPrice10Case ?? null),
      tierPrice20Case: payload.tierPrice20Case !== undefined
        ? ensurePositiveNumber(payload.tierPrice20Case, 'tierPrice20Case')
        : (existing.tierPrice20Case ?? null),
      defaultCargoTypeCode: payload.defaultCargoTypeCode !== undefined
        ? String(payload.defaultCargoTypeCode || '').trim().toLowerCase()
        : String(existing.defaultCargoTypeCode || '').trim().toLowerCase(),
      supplierLogisticsNote: payload.supplierLogisticsNote !== undefined
        ? String(payload.supplierLogisticsNote || '').trim()
        : String(existing.supplierLogisticsNote || '').trim(),
      leadTimeDays,
      isDefault,
      isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : existing.isActive,
      lastPriceUpdate: payload.purchasePrice !== undefined ? now : existing.lastPriceUpdate,
      updatedAt: now,
    };

    await supplierProductRepo.updateById(id, updated);
    const { productMap, supplierMap } = await buildMaps();

    if (isDefault) {
      await ensureSingleDefaultForProduct(productId, id);
    } else {
      await ensureComputedDefaultForProduct(productId);
    }

    return enrichSupplierProduct(updated, productMap, supplierMap);
  },

  async removeSupplierProduct(id) {
    const removed = await supplierProductRepo.deleteById(id);
    if (!removed) throw createNotFoundError('Tedarikçi ürünü bulunamadı');
    return removed;
  },

  async generateSuggestions(options = {}, actorUser = {}) {
    const normalizedOptions = normalizeGenerationOptions(options);

    const [
      { products, suppliers, stockMap },
      supplierProducts,
      suggestions,
      sales,
      settings,
      adminUsers,
    ] = await Promise.all([
      buildProductSupplierStockMaps(),
      supplierProductRepo.getAll(),
      purchaseSuggestionRepo.getAll(),
      salesRepo.getAll(),
      settingsRepo.getSettings(),
      getAdmins(),
    ]);

    const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
    const activeSupplierProducts = supplierProducts.filter((row) => row.isActive !== false && supplierMap.get(row.supplierId)?.isActive !== false);
    const now = new Date();
    const nowIso = now.toISOString();
    const salesSignalsMap = buildSalesSignalsMap(sales, now);
    const activeCampaigns = resolveActiveCampaigns(settings);
    const automation = getAutomationSettings(settings);

    const generated = [];

    for (const product of products) {
      if (product.isActive === false) continue;

      if (normalizedOptions.mode === 'category' && normalizedOptions.categoryId && product.categoryId !== normalizedOptions.categoryId) {
        continue;
      }

      const stock = stockMap.get(product.id);
      const currentStock = getTotalStock(stock);
      const criticalStock = Number(product.criticalStock || 0);

      const productOptions = activeSupplierProducts
        .filter((row) => row.productId === product.id)
        .sort((a, b) => {
          if (Boolean(b.isDefault) !== Boolean(a.isDefault)) {
            return Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault));
          }
          return Number(a.purchasePrice || 0) - Number(b.purchasePrice || 0);
        });

      if (!productOptions.length) continue;

      const selected = productOptions[0];
      const leadTimeDays = getLeadDays(selected);

      const signals = salesSignalsMap.get(product.id) || getDemandSignals({
        sold7: 0,
        sold14: 0,
        sold30: 0,
        avg7: 0,
        avg14: 0,
        avg30: 0,
      });

      const maxStock = Number(product.maxStock || 0);
      const overStockRatio = maxStock > 0 ? currentStock / maxStock : 0;
      const campaignContext = resolveCampaignContext({
        product,
        signals,
        overStockRatio,
        campaigns: activeCampaigns,
        options: normalizedOptions,
      });

      const trendMultiplier = signals.trendDirection === 'up'
        ? 1 + Math.min(0.35, Math.max(0, signals.trendRatio) * 0.45)
        : signals.trendDirection === 'down'
          ? 0.88
          : 1;

      const demandDaily = Math.max(0, Number((signals.weighted * trendMultiplier * campaignContext.demandMultiplier).toFixed(3)));

      const baselineCoverageDays = normalizedOptions.coverageDays > 0
        ? normalizedOptions.coverageDays
        : normalizedOptions.mode === 'campaign'
          ? leadTimeDays + normalizedOptions.safetyDays + 6
          : normalizedOptions.mode === 'fast'
            ? leadTimeDays + normalizedOptions.safetyDays + 4
            : leadTimeDays + normalizedOptions.safetyDays + 2;

      const coverageDays = Math.max(5, baselineCoverageDays);
      const reorderPoint = Math.max(
        criticalStock,
        Math.ceil((demandDaily * leadTimeDays) + (criticalStock * 0.4))
      );
      const targetStock = Math.max(
        criticalStock + 1,
        Math.ceil(demandDaily * coverageDays)
      );

      const needQty = Math.max(0, targetStock - currentStock);
      const daysToStockout = demandDaily > 0 ? Number((currentStock / demandDaily).toFixed(1)) : null;
      const riskLevel = getRiskLevel({ currentStock, criticalStock, daysToStockout, leadTimeDays });

      if (!shouldCreateSuggestionByMode({
        options: normalizedOptions,
        product,
        campaignContext,
        signals,
        riskLevel,
        needQty,
        currentStock,
        criticalStock,
      })) {
        continue;
      }

      const unitsPerPack = Math.max(1, Number(product.unitsPerPack || selected.unitsPerPack || 1));
      const unitsPerBox = Math.max(1, Number(product.unitsPerBox || selected.unitsPerBox || product.unitsPerCase || selected.unitsPerCase || 1));
      const unitsPerCase = Math.max(1, Number(product.unitsPerCase || selected.unitsPerCase || 1));
      const unitsPerPallet = Math.max(
        1,
        Number(product.unitsPerPallet || selected.unitsPerPallet || (unitsPerCase * Math.max(1, Number(product.casesPerPallet || selected.casesPerPallet || 1))))
      );
      const unitInfo = { unitsPerPack, unitsPerBox, unitsPerCase, unitsPerPallet };
      const minimumOrder = resolveMinimumOrderBaseQty({ supplierProduct: selected, unitInfo });

      const rounding = resolveRounding({
        quantity: needQty,
        minimumOrderQty: minimumOrder.minimumOrderBaseQty,
        unitsPerCase,
        unitsPerPallet,
        roundingStrategy: normalizedOptions.roundingStrategy,
      });

      const suggestedQty = Math.max(1, rounding.suggestedQty);
      const unitPrice = resolvePricePerBaseUnit({ supplierProduct: selected, unitInfo });
      const totalPrice = Number((suggestedQty * unitPrice).toFixed(2));
      const reasonModel = getSuggestionReasonModel({
        currentStock,
        criticalStock,
        signals,
        daysToStockout,
        leadTimeDays,
        campaign: campaignContext.campaign,
        roundingUnit: rounding.roundingUnit,
        moqApplied: suggestedQty === minimumOrder.minimumOrderBaseQty,
      });

      const payload = {
        productId: product.id,
        categoryId: product.categoryId || '',
        supplierId: selected.supplierId,
        currentStock,
        criticalStock,
        reorderPoint,
        targetStock,
        suggestedQty,
        roundedFromQty: rounding.roundedFromQty,
        roundingUnit: rounding.roundingUnit,
        unitPrice,
        totalPrice,
        status: 'pending',
        reason: reasonModel.reasonText || 'Talep analizi sonucu sipariş önerisi',
        reasonText: reasonModel.reasonText,
        reasonTags: reasonModel.reasonTags,
        reasonDetails: reasonModel.reasonDetails,
        riskLevel,
        daysToStockout,
        leadTimeDays,
        sold7: signals.sold7,
        sold14: signals.sold14,
        sold30: signals.sold30,
        avgDaily7: Number(signals.avg7.toFixed(3)),
        avgDaily14: Number(signals.avg14.toFixed(3)),
        avgDaily30: Number(signals.avg30.toFixed(3)),
        trendDirection: signals.trendDirection,
        trendRatio: signals.trendRatio,
        salesSpeed: signals.salesSpeed,
        generationMode: normalizedOptions.mode,
        campaignId: campaignContext.campaign?.id || null,
        campaignName: campaignContext.campaign?.name || null,
        campaignType: campaignContext.campaign?.type || null,
        campaignDiscountRate: campaignContext.discountSignal,
        minimumOrderQty: minimumOrder.minimumOrderQty,
        minimumOrderUnit: minimumOrder.minimumOrderUnit,
        minimumOrderBaseQty: minimumOrder.minimumOrderBaseQty,
        priceUnit: normalizeUnitName(selected.priceUnit || 'adet'),
        orderUnit: normalizeUnitName(selected.defaultOrderUnit || selected.minOrderUnit || selected.priceUnit || product.unit || 'adet'),
        unitsPerCase,
        unitsPerPallet,
        demandCoverageDays: coverageDays,
      };

      const existingPending = suggestions.find((row) => row.productId === product.id && row.status === 'pending');
      if (existingPending) {
        const updated = {
          ...existingPending,
          ...payload,
          updatedAt: nowIso,
        };
        await purchaseSuggestionRepo.updateById(existingPending.id, updated);
        generated.push(updated);
      } else {
        const created = {
          id: uuidv4(),
          ...payload,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        await purchaseSuggestionRepo.create(created);
        generated.push(created);
      }

      const latestSuggestion = generated[generated.length - 1];
      await createAutomationTaskIfNeeded({
        suggestion: latestSuggestion,
        product,
        actorUserId: actorUser?.id,
        automation,
        adminUsers,
      });
      await createCriticalNotificationsIfNeeded({
        suggestion: latestSuggestion,
        product,
        automation,
        adminUsers,
      });
    }

    const maps = await buildProductSupplierStockMaps();
    return generated.map((row) => enrichSuggestion(row, maps));
  },

  async listSuggestions(query = {}) {
    const [suggestions, maps] = await Promise.all([
      purchaseSuggestionRepo.getAll(),
      buildProductSupplierStockMaps(),
    ]);
    const pagination = parsePagePagination(query, {
      defaultLimit: DEFAULT_SUGGESTIONS_LIMIT,
      maxLimit: MAX_SUGGESTIONS_LIMIT,
    });

    const normalizedSearch = normalizeSearchText(query.search);
    const status = normalizeString(query.status);
    const productId = normalizeString(query.productId);
    const supplierId = normalizeString(query.supplierId);
    const mode = normalizeString(query.mode || query.generationMode).toLowerCase();
    const riskLevel = normalizeString(query.riskLevel).toLowerCase();
    const campaignType = normalizeString(query.campaignType).toLowerCase();

    const filtered = suggestions.filter((row) => {
      const product = maps.productMap.get(row.productId);
      const supplier = maps.supplierMap.get(row.supplierId);
      const rowGenerationMode = row.generationMode || 'critical';
      const rowRiskLevel = row.riskLevel || 'low';
      const rowCampaignType = row.campaignType || null;
      const reasonTags = Array.isArray(row.reasonTags) ? row.reasonTags : [];
      const reasonDetails = Array.isArray(row.reasonDetails) ? row.reasonDetails : [];
      const reasonText = row.reasonText || reasonDetails.join(' ') || row.reason;
      const matchesStatus = !status || row.status === status;
      const matchesProduct = !productId || row.productId === productId;
      const matchesSupplier = !supplierId || row.supplierId === supplierId;
      const matchesMode = !mode || rowGenerationMode === mode;
      const matchesRisk = !riskLevel || String(rowRiskLevel || '').toLowerCase() === riskLevel;
      const matchesCampaignType = !campaignType || String(rowCampaignType || '').toLowerCase() === campaignType;
      const matchesSearch = !normalizedSearch || [
        product?.name,
        product?.sku,
        supplier?.name,
        reasonText,
        row.campaignName,
        ...reasonTags,
      ]
        .filter(Boolean)
        .some((value) => includesSearchText(value, normalizedSearch));

      return matchesStatus && matchesProduct && matchesSupplier && matchesMode && matchesRisk && matchesCampaignType && matchesSearch;
    });

    const sorted = sortByNewest(filtered);
    const pageRows = sorted.slice(pagination.skip, pagination.skip + pagination.limit);
    const items = pageRows.map((row) => enrichSuggestion(row, maps));
    const total = sorted.length;

    return {
      items,
      pagination: {
        mode: 'offset',
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
        hasNextPage: pagination.skip + pagination.limit < total,
        hasPreviousPage: pagination.page > 1,
      },
      filters: {
        search: query.search || '',
        status,
        productId,
        supplierId,
        mode,
        riskLevel,
        campaignType,
      },
      sort: { field: 'createdAt', direction: 'desc' },
    };
  },

  async updateSuggestion(id, payload, userId) {
    const existing = await purchaseSuggestionRepo.findById(id);
    if (!existing) throw createNotFoundError('Sipariş önerisi bulunamadı');
    if (existing.status !== 'pending') {
      throw new AppError(400, 'Sadece bekleyen öneriler düzenlenebilir');
    }

    const nextSupplierId = payload.supplierId !== undefined ? String(payload.supplierId).trim() : existing.supplierId;
    const supplier = await supplierRepo.findById(nextSupplierId);
    if (!supplier) throw createNotFoundError('Tedarikçi bulunamadı');

    const suggestedQty = payload.suggestedQty !== undefined
      ? Math.max(1, Math.floor(ensurePositiveNumber(payload.suggestedQty, 'suggestedQty')))
      : existing.suggestedQty;

    const unitPrice = payload.unitPrice !== undefined
      ? ensurePositiveNumber(payload.unitPrice, 'unitPrice')
      : existing.unitPrice;

    const now = new Date().toISOString();
    const updated = {
      ...existing,
      supplierId: nextSupplierId,
      suggestedQty,
      unitPrice,
      totalPrice: Number((suggestedQty * unitPrice).toFixed(2)),
      updatedAt: now,
      updatedBy: userId,
    };

    await purchaseSuggestionRepo.updateById(id, updated);
    const maps = await buildMaps();
    return enrichSuggestion(updated, maps);
  },

  async approveSuggestion(id, payload, userId) {
    const existing = await purchaseSuggestionRepo.findById(id);
    if (!existing) throw createNotFoundError('Sipariş önerisi bulunamadı');
    if (existing.status !== 'pending') {
      throw new AppError(400, 'Bu öneri için onay işlemi yapılamaz');
    }

    const edited = await this.updateSuggestion(id, payload || {}, userId);

    const leadProducts = await supplierProductRepo.getAll();
    const mapping = leadProducts.find((row) => row.productId === edited.productId && row.supplierId === edited.supplierId && row.isActive !== false);
    const supplier = (await supplierRepo.findById(edited.supplierId)) || null;

    const logistics = getLogisticsLeadInfo(supplier);
    const leadTimeDays = logistics.estimatedDeliveryDays || getLeadDays(mapping);

    const now = new Date().toISOString();
    const order = {
      id: uuidv4(),
      supplierId: edited.supplierId,
      orderNumber: await buildOrderNumber(),
      totalAmount: edited.totalPrice,
      status: 'submitted_for_approval',
      currentStatus: 'submitted_for_approval',
      current_status: 'submitted_for_approval',
      statusHistory: [{ status: 'submitted_for_approval', at: now, by: userId }],
      warehouseCity: logistics.warehouseCity,
      estimatedDeliveryDays: leadTimeDays,
      estimatedDeliveryDate: getEstimatedDeliveryDate(leadTimeDays),
      deliveryStatus: ORDER_STATUS_LABELS['submitted_for_approval'],
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: userId,
      stockBookedAt: null,
      goodsReceiptCompleted: false,
      goods_receipt_completed: false,
      stockEntryCompleted: false,
      stock_entry_completed: false,
      stockEntryMode: null,
      archived: false,
      archivedAt: null,
      priority: edited.priority || 'normal',
      activityLog: [
        {
          type: 'created',
          status: 'submitted_for_approval',
          at: now,
          by: userId,
          note: 'Öneriden oluşturuldu',
        },
      ],
    };

    const item = {
      id: uuidv4(),
      orderId: order.id,
      productId: edited.productId,
      quantity: edited.suggestedQty,
      unitPrice: edited.unitPrice,
      totalPrice: edited.totalPrice,
      createdAt: now,
      updatedAt: now,
    };

    await Promise.all([
      purchaseOrderRepo.create(order),
      purchaseOrderItemRepo.create(item),
      purchaseSuggestionRepo.updateById(id, {
        ...existing,
        supplierId: edited.supplierId,
        suggestedQty: edited.suggestedQty,
        unitPrice: edited.unitPrice,
        totalPrice: edited.totalPrice,
        status: 'approved',
        approvedBy: userId,
        approvedAt: now,
        linkedOrderId: order.id,
        updatedAt: now,
      }),
    ]);

    const [maps, items] = await Promise.all([buildMaps(), purchaseOrderItemRepo.getAll()]);
    const itemsByOrderId = new Map();
    for (const row of items) {
      if (!itemsByOrderId.has(row.orderId)) itemsByOrderId.set(row.orderId, []);
      itemsByOrderId.get(row.orderId).push(row);
    }

    return enrichOrder(order, { supplierMap: maps.supplierMap, itemsByOrderId, userMap: maps.userMap });
  },

  async rejectSuggestion(id, userId) {
    const existing = await purchaseSuggestionRepo.findById(id);
    if (!existing) throw createNotFoundError('Sipariş önerisi bulunamadı');
    if (existing.status !== 'pending') {
      throw new AppError(400, 'Sadece bekleyen öneriler reddedilebilir');
    }

    const now = new Date().toISOString();
    const updated = {
      ...existing,
      status: 'rejected',
      rejectedBy: userId,
      rejectedAt: now,
      updatedAt: now,
    };
    await purchaseSuggestionRepo.updateById(id, updated);
    return updated;
  },

  async createOrderFromSupplierProduct(payload, userId) {
    if (config.dataStore === 'postgres') {
      return createOrderFromSupplierProductPostgres(payload, userId);
    }

    const supplierProductId = String(payload.supplierProductId || '').trim();
    if (!supplierProductId) {
      throw new AppError(400, 'supplierProductId zorunludur');
    }

    const requestedQty = ensurePositiveNumber(payload.quantity, 'quantity');
    const requestedUnitRaw = normalizeUnitName(payload.orderUnit || payload.unit || '');

    const [supplierProduct, maps, user] = await Promise.all([
      supplierProductRepo.findById(supplierProductId),
      buildMaps(),
      userRepo.findById(userId),
    ]);

    if (!supplierProduct) {
      throw createNotFoundError('Belirtilen tedarikçi-ürün eşleşmesi sistemde kayıtlı deşil');
    }

    const product = maps.productMap.get(supplierProduct.productId);
    const supplier = maps.supplierMap.get(supplierProduct.supplierId);

    if (!product) throw createNotFoundError('Ürün bulunamadı');
    if (!supplier) throw createNotFoundError('Tedarikçi bulunamadı');

    if (supplierProduct.isActive === false || supplier.isActive === false) {
      throw new AppError(400, 'Pasif tedarikçi veya eşleşme için sipariş oluşturulamaz');
    }

    validateSupplierCategoryCompatibility(product, supplier);

    // Ambalaj bilgileri: ürün bazlı koli/palet yapısı
    const unitsPerPack = Math.max(1, Number(supplierProduct.unitsPerPack || product.unitsPerPack || 1));
    const unitsPerBox = Math.max(1, Number(supplierProduct.unitsPerBox || product.unitsPerBox || product.unitsPerCase || 1));
    const unitsPerCase = Math.max(1, Number(supplierProduct.unitsPerCase || product.unitsPerCase || 1));
    const casesPerPallet = Math.max(1, Number(supplierProduct.casesPerPallet || product.casesPerPallet || 1));
    const unitsPerPallet = Math.max(1, Number(supplierProduct.unitsPerPallet || product.unitsPerPallet || unitsPerCase * casesPerPallet));

    const priceUnit = normalizeUnitName(supplierProduct.priceUnit || 'adet');
    const minOrderUnit = normalizeUnitName(supplierProduct.minOrderUnit || priceUnit);

    const requestedUnit = requestedUnitRaw || priceUnit;
    const unitValidation = assertValidSupplierProductOrderUnit({ supplierProduct, product, unit: requestedUnit });
    if (!unitValidation.isValid) {
      throw new AppError(400, `Seçilen sipariş birimi bu ürün için geçerli değil. Geçerli birimler: ${unitValidation.allowed.join(', ')}`);
    }

    const toBaseUnits = (qty, unit) => {
      switch (unit) {
        case 'paket':
          return qty * unitsPerPack;
        case 'kutu':
          return qty * unitsPerBox;
        case 'koli':
          return qty * unitsPerCase;
        case 'palet':
          return qty * unitsPerPallet;
        case 'kasa':
        case 'çuval':
          return qty * unitsPerCase;
        case 'adet':
        default:
          return qty;
      }
    };

    const minimumOrderQty = Math.max(1, Number(supplierProduct.minimumOrderQty || 1));

    // Ambalaj alanı eksikse ve adet dışı bir birim kullanılıyorsa siparişe izin verme.
    const requiresCaseUnits = ['paket', 'kutu', 'koli', 'kasa', 'çuval'];
    const requiresCase = requiresCaseUnits.includes(priceUnit)
      || requiresCaseUnits.includes(minOrderUnit)
      || requiresCaseUnits.includes(requestedUnit);
    const requiresPallet = priceUnit === 'palet'
      || minOrderUnit === 'palet'
      || requestedUnit === 'palet';

    if (requiresCase && unitsPerCase <= 1) {
      throw new AppError(400, 'Bu ürün için koli/kasa bilgisi tanımlı deşil. Lütfen ürün ambalaj ayarlarını kontrol edin.');
    }
    if (requiresPallet && unitsPerPallet <= 1) {
      throw new AppError(400, 'Bu ürün için palet bilgisi tanımlı deşil. Lütfen ürün ambalaj ayarlarını kontrol edin.');
    }

    const minInBase = toBaseUnits(minimumOrderQty, minOrderUnit);
    const requestedInBase = toBaseUnits(requestedQty, requestedUnit);

    if (requestedInBase < minInBase) {
      throw new AppError(400, `Bu tedarikçi için minimum sipariş miktarı ${minimumOrderQty} ${minOrderUnit} karşılışıdır`);
    }

    // Fiyat hesaplama: tedarikçi fiyat birimi baz alınır, gerekirse adet fiyatına çevrilir.
    const rawPurchasePrice = ensurePositiveNumber(supplierProduct.purchasePrice, 'purchasePrice');

    const pricePerBaseUnit = (() => {
      switch (priceUnit) {
        case 'paket':
          return rawPurchasePrice / unitsPerPack;
        case 'kutu':
          return rawPurchasePrice / unitsPerBox;
        case 'koli':
          return rawPurchasePrice / unitsPerCase;
        case 'palet':
          return rawPurchasePrice / unitsPerPallet;
        case 'kasa':
        case 'çuval':
          return rawPurchasePrice / unitsPerCase;
        case 'adet':
        default:
          return rawPurchasePrice;
      }
    })();

    const totalPrice = Number((pricePerBaseUnit * requestedInBase).toFixed(2));

    const logistics = getLogisticsLeadInfo(supplier);
    const leadTimeDays = logistics.estimatedDeliveryDays || getLeadDays(supplierProduct);
    const now = new Date().toISOString();

  const deliveryLocation = payload.deliveryLocation || 'store';
  const deliveryDateMode = payload.deliveryDateMode || 'tomorrow';
  const deliveryDate = payload.deliveryDate || null;
  const deliveryType = payload.deliveryType || 'standard';
  const logisticsType = payload.procurementContext?.logisticsType || payload.logisticsType || 'supplier_delivery';
  const orderType = payload.orderType || 'normal';
  const orderReference = payload.orderReference || '';
  const approvalRequested = Boolean(payload.approvalRequested);
  const submitMode = 'approval';
  const estimatedDeliveryDate = resolveOrderEstimatedDeliveryDate({
    leadTimeDays,
    deliveryDateMode,
    deliveryDate,
  });

  const procurementContext = {
    orderReason: payload.procurementContext?.orderReason || payload.orderReason || 'regular_replenishment',
    demandSource: payload.procurementContext?.demandSource || payload.demandSource || 'warehouse',
    demandLevel: payload.procurementContext?.demandLevel || payload.demandLevel || 'medium',
    logisticsType,
    cargoTypeCode: payload.procurementContext?.cargoTypeCode || payload.cargoTypeCode || payload.shippingCarrier || null,
    cargoTypeName: payload.procurementContext?.cargoTypeName || null,
    supplierDispatchDate: payload.procurementContext?.supplierDispatchDate || payload.supplierDispatchDate || null,
    deliveryTimeSlot: payload.procurementContext?.deliveryTimeSlot || payload.deliveryTimeSlot || null,
    supplierStockStatus: payload.procurementContext?.supplierStockStatus || null,
    stockSnapshot: payload.procurementContext?.stockSnapshot || null,
    pricingSnapshot: payload.procurementContext?.pricingSnapshot || null,
    logisticsSnapshot: payload.procurementContext?.logisticsSnapshot || null,
    orderingSnapshot: {
      orderedQuantity: requestedQty,
      orderedUnit: requestedUnit,
      baseQuantity: requestedInBase,
      baseUnit: ['paket', 'kutu', 'koli', 'palet', 'kasa', 'çuval'].includes(priceUnit) ? 'adet' : priceUnit,
      unitPrice: Number(pricePerBaseUnit.toFixed(4)),
      lineTotal: totalPrice,
    },
  };

    const settings = await settingsRepo.getSettings();
    const tariffs = logisticsTariffService.normalizeTariffs(settings.logisticsTariffs || []);
    const storageType = resolveStorageType(product);
    const selectedCargoTypeCode = String(
      payload.procurementContext?.cargoTypeCode
      || payload.cargoTypeCode
      || payload.shippingCarrier
      || supplierProduct.defaultCargoTypeCode
      || ''
    ).trim().toLowerCase();

    const manualOverrideTl = payload.procurementContext?.manualOverrideTl ?? payload.manualOverrideTl;
    const caseQtyCandidate = Number(payload.procurementContext?.caseQty ?? payload.caseQty);
    const caseQtyFromPayload = Number.isFinite(caseQtyCandidate) && caseQtyCandidate > 0
      ? caseQtyCandidate
      : null;
    const hasCasePackInfo = unitsPerCase > 0;
    const inferredCaseQty = requestedUnit === 'koli'
      ? Math.ceil(requestedQty)
      : (hasCasePackInfo ? Math.ceil(requestedInBase / unitsPerCase) : null);
    const resolvedCaseQty = caseQtyFromPayload || inferredCaseQty;

    if (!resolvedCaseQty && manualOverrideTl == null) {
      throw new AppError(
        400,
        'Kargo fiyatı hesaplanamadı: koli karşılığı bulunamadı. Ürün case pack bilgisini güncelleyin veya manuel lojistik tutarı girin.',
      );
    }

    const logisticsQuote = selectedCargoTypeCode
      ? logisticsTariffService.calculateQuote({
        rows: tariffs,
        cargoTypeCode: selectedCargoTypeCode,
        caseQty: resolvedCaseQty,
        manualOverrideTl,
        storageType,
        distanceType: selectedCargoTypeCode === 'store_transfer' ? 'internal_transfer' : 'intercity',
        isInternalTransfer: selectedCargoTypeCode === 'store_transfer',
      })
      : null;

    const vatRate = Number(payload.vatRate || 0) || 0;
  const shippingFee = logisticsQuote
    ? Math.max(0, Number(logisticsQuote.totalPriceTl || 0))
    : Math.max(0, Number(payload.shippingFee || 0) || 0);
  const subtotalAmount = totalPrice;
  const taxAmount = Number(((subtotalAmount * vatRate) / 100).toFixed(2));
  const grandTotal = Number((subtotalAmount + taxAmount + shippingFee).toFixed(2));

      const initialStatus = 'submitted_for_approval';

      const order = {
      id: uuidv4(),
      supplierId: supplierProduct.supplierId,
      orderNumber: await buildOrderNumber(),
      totalAmount: grandTotal || totalPrice,
      status: initialStatus,
      currentStatus: initialStatus,
      current_status: initialStatus,
      statusHistory: [{ status: initialStatus, at: now, by: userId }],
      warehouseCity: logistics.warehouseCity,
      estimatedDeliveryDays: leadTimeDays,
      estimatedDeliveryDate,
      deliveryStatus: ORDER_STATUS_LABELS[initialStatus],
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      approvedAt: null,
      approvedBy: null,
      stockBookedAt: null,
      goodsReceiptCompleted: false,
      goods_receipt_completed: false,
      stockEntryCompleted: false,
      stock_entry_completed: false,
      stockEntryMode: null,
      archived: false,
      archivedAt: null,
      note: payload.note || '',
      deliveryLocation,
      deliveryDateMode,
      requestedDeliveryDate: deliveryDate,
      deliveryType,
      logisticsType,
      orderType,
      orderReference,
      approvalRequested,
      approvalRequestedAt: approvalRequested ? now : null,
      approvalRequestedBy: approvalRequested ? userId : null,
      submitMode,
      subtotalAmount,
      taxRate: vatRate,
      taxAmount,
      shippingFee,
      grandTotal,
      cargoTypeCode: selectedCargoTypeCode || null,
      cargoTypeName: logisticsQuote?.cargoTypeName || null,
      priority: payload.priority || 'normal',
      source: 'manual_supplier_product',
      procurementContext,
      operationalNote: payload.operationalNote || '',
      supplierNote: payload.supplierNote || '',
      procurementNote: payload.procurementNote || '',
      activityLog: [
        {
          type: 'created',
          status: initialStatus,
          at: now,
          by: userId,
          note: payload.note || payload.procurementNote || '',
        },
      ],
    };

    if (logisticsQuote) {
      order.procurementContext = {
        ...procurementContext,
        logisticsSnapshot: {
          ...(procurementContext.logisticsSnapshot || {}),
          cargoTypeCode: logisticsQuote.cargoTypeCode,
          cargoTypeName: logisticsQuote.cargoTypeName,
          deliveryTarget: logisticsQuote.deliveryTarget,
          pricingUnit: logisticsQuote.pricingUnit,
          caseQty: logisticsQuote.caseQty,
          basePriceTl: logisticsQuote.basePriceTl,
          incrementalPricePerCase: logisticsQuote.incrementalPricePerCase,
          incrementalTotalTl: logisticsQuote.incrementalTotalTl,
          totalPriceTl: logisticsQuote.totalPriceTl,
          calculatedBy: logisticsQuote.calculatedBy,
          calculationMethod: logisticsQuote.calculationMethod,
          mixedStoragePolicy: logisticsQuote.mixedStoragePolicy,
          mixedStorageMessage: logisticsQuote.mixedStorageMessage,
          issues: logisticsQuote.issues,
          appliedBand: logisticsQuote.appliedBand,
        },
      };
    }

    const item = {
      id: uuidv4(),
      orderId: order.id,
      productId: supplierProduct.productId,
      quantity: requestedInBase,
      unit: requestedUnit,
      unitPrice: Number(pricePerBaseUnit.toFixed(4)),
      totalPrice,
      payload: {
        orderedQuantity: requestedQty,
        orderedUnit: requestedUnit,
        baseQuantity: requestedInBase,
        baseUnit: priceUnit,
        unitPrice: Number(pricePerBaseUnit.toFixed(4)),
        lineTotal: totalPrice,
      },
      createdAt: now,
      updatedAt: now,
    };

    await Promise.all([
      purchaseOrderRepo.create(order),
      purchaseOrderItemRepo.create(item),
    ]);

    const allItems = await purchaseOrderItemRepo.getAll();
    const itemsByOrderId = new Map();
    for (const row of allItems) {
      if (!itemsByOrderId.has(row.orderId)) itemsByOrderId.set(row.orderId, []);
      itemsByOrderId.get(row.orderId).push(row);
    }

    return enrichOrder(order, { supplierMap: maps.supplierMap, itemsByOrderId });
  },

  async listOrders(query = {}) {
    if (config.dataStore === 'postgres') {
      return listOrdersFromPostgres(query);
    }

    const [ordersRaw, items, maps] = await Promise.all([
      purchaseOrderRepo.getAll(),
      purchaseOrderItemRepo.getAll(),
      buildMaps(),
    ]);

    const orders = ordersRaw.map((order) => prepareOrderForRead(order));

    const filtered = orders.filter((order) => {
      const matchesStatus = !query.status || order.status === query.status;
      const matchesSupplier = !query.supplierId || order.supplierId === query.supplierId;
      const matchesSource = !query.source || order.source === query.source;
      const matchesSearch =
        !query.search ||
        [order.orderNumber, maps.supplierMap.get(order.supplierId)?.name]
          .filter(Boolean)
          .some((v) => includesSearchText(v, query.search));
      return matchesStatus && matchesSupplier && matchesSource && matchesSearch;
    });

    const itemsByOrderId = new Map();
    for (const row of items) {
      if (!itemsByOrderId.has(row.orderId)) itemsByOrderId.set(row.orderId, []);
      itemsByOrderId.get(row.orderId).push(row);
    }

    return sortByNewest(filtered).map((order) => enrichOrder(order, { supplierMap: maps.supplierMap, itemsByOrderId, userMap: maps.userMap }));
  },

  async listOrderItems(orderId) {
    if (config.dataStore === 'postgres') {
      return listOrderItemsFromPostgres(orderId);
    }

    const existingOrder = await purchaseOrderRepo.findById(orderId);
    if (!existingOrder) throw createNotFoundError('Satın alma siparişi bulunamadı');

    const { orderItems } = await getOrderItemsWithProducts(orderId);
    return orderItems;
  },

  async updateOrderStatus(orderId, payload, userId) {
    return withOrderUpdateLock(orderId, async () => {
      const order = await purchaseOrderRepo.findById(orderId);
      if (!order) throw createNotFoundError('Satın alma siparişi bulunamadı');

      const normalizedOrder = prepareOrderForRead(order);
      const currentStatus = String(normalizedOrder.status || '').trim();
      const nextStatus = String(payload.status || '').trim();
      validateOrderStatus(nextStatus);

      if (nextStatus === 'goods_receipt_completed') {
        const goodsReceiptDone = normalizedOrder.goodsReceiptCompleted === true
          || normalizedOrder.goods_receipt_completed === true
          || Boolean(normalizedOrder.goodsReceiptCompletedAt);
        if (goodsReceiptDone || GOODS_RECEIPT_ALREADY_FINALIZED_STATUSES.has(currentStatus)) {
          throw new AppError(409, 'Bu sipariş için mal kabul işlemi zaten tamamlanmış.');
        }
        if (!['delivered', 'goods_receipt_pending'].includes(currentStatus)) {
          throw new AppError(400, 'Mal kabul yalnızca depoya ulaşan siparişler için yapılabilir.');
        }
      }

      const isAutoRequest = payload?.__auto === true;
      if (!isAutoRequest && AUTO_MANAGED_STATUSES.has(nextStatus) && !MANUAL_ALLOWED_STATUSES.has(nextStatus)) {
        throw new AppError(400, 'Bu aşama sistem akışına bağlı olarak ilerlemektedir. Bir sonraki uygun işlem adımından devam edebilirsiniz.');
      }

      const note = payload.note ? String(payload.note).trim() : '';

      const nowIso = new Date().toISOString();
      let updated = normalizedOrder;

      if (nextStatus === 'goods_receipt_completed') {
        const goodsReceiptResult = await completeGoodsReceiptFlow({
          order: updated,
          actorUserId: userId,
          note,
          timestampIso: nowIso,
          stockEntryMode: payload?.stockEntryMode,
        });

        updated = goodsReceiptResult.order;

        if (goodsReceiptResult.stockEntryMode === AUTO_STOCK_ENTRY_MODE) {
          if (!updated.stockBookedAt) {
            const [{ orderItems, productMap }, actorName] = await Promise.all([
              getOrderItemsWithProducts(updated.id),
              resolveActorName(userId),
            ]);

            for (const item of orderItems) {
              const product = productMap.get(item.productId);
              if (!product) continue;
              await createStockInMovement({
                product,
                qty: Number(item.quantity || 0),
                userName: actorName,
                userId,
                referenceNo: updated.orderNumber,
              });
            }
          }

          updated = applyAutoStockEntryCompletedState(updated, nowIso);

          updated = await transitionOrderStatus({
            order: updated,
            nextStatus: 'completed',
            actorUserId: userId,
            note: 'Stok girişi otomatik tamamlandı.',
            timestampIso: nowIso,
            eventType: 'status_change',
          });

          updated = await transitionOrderStatus({
            order: updated,
            nextStatus: 'archived',
            actorUserId: userId,
            note: 'Sipariş tamamlandı ve arşive taşındı.',
            timestampIso: nowIso,
            eventType: 'status_change',
          });
        }
      } else if (nextStatus === 'completed') {
        updated = await finalizeManualStockEntryFlow({
          order: updated,
          actorUserId: userId,
          note,
          timestampIso: nowIso,
          archive: payload?.archive !== false,
        });
      } else {
        updated = await transitionOrderStatus({
          order: normalizedOrder,
          nextStatus,
          actorUserId: userId,
          note,
          timestampIso: nowIso,
          eventType: 'status_change',
        });
      }

      if (nextStatus === 'approved') {
        const timelineResult = ensureOrderAutoTimeline(updated);
        if (timelineResult.changed) {
          updated = {
            ...timelineResult.order,
            updatedAt: nowIso,
          };
        }

        updated = await applyOrderAutoProgression(updated, { persist: false });
      }

      await purchaseOrderRepo.updateById(orderId, updated);

      const [maps, allItems] = await Promise.all([buildMaps(), purchaseOrderItemRepo.getAll()]);
      const itemsByOrderId = new Map();
      for (const row of allItems) {
        if (!itemsByOrderId.has(row.orderId)) itemsByOrderId.set(row.orderId, []);
        itemsByOrderId.get(row.orderId).push(row);
      }

      return enrichOrder(updated, { supplierMap: maps.supplierMap, itemsByOrderId });
    });
  },
};

export const __procurementInternals = {
  appendOrderActivityIfMissing,
  appendStatusHistoryIfMissing,
  buildActivityDedupKey,
  buildStatusHistoryDedupKey,
  dedupeRowsByKey,
  prepareOrderForRead,
  isManualStockEntryPendingOrder,
  applyManualStockEntryPendingState,
  applyAutoStockEntryCompletedState,
  completeGoodsReceiptFlow,
  finalizeManualStockEntryFlow,
};

