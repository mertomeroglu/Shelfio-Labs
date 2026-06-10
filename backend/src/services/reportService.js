import { categoryRepo } from '../repositories/categoryRepository.js';
import { accessAuditLogRepo } from '../repositories/accessAuditLogRepository.js';
import { accessRequestRepo } from '../repositories/accessRequestRepository.js';
import { catalogImportRepo } from '../repositories/catalogImportRepository.js';
import { movementRepo } from '../repositories/movementRepository.js';
import { notificationRepo } from '../repositories/notificationRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { purchaseOrderItemRepo } from '../repositories/purchaseOrderItemRepository.js';
import { purchaseOrderRepo } from '../repositories/purchaseOrderRepository.js';
import { purchaseSuggestionRepo } from '../repositories/purchaseSuggestionRepository.js';
import { salesRepo } from '../repositories/salesRepository.js';
import { sectionRepo } from '../repositories/sectionRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { stockRepo } from '../repositories/stockRepository.js';
import { supplierProductRepo } from '../repositories/supplierProductRepository.js';
import { supplierRepo } from '../repositories/supplierRepository.js';
import { taskRepo } from '../repositories/taskRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { eslDeviceRepo } from '../repositories/eslRepository.js';
import { includesSearchText, normalizeSearchText } from '../utils/validators.js';
import { pricingAnalysisService } from './analysis/pricingAnalysisService.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';
import { resolveStoreScheduleStatus } from '../utils/storeSchedule.js';
import { AppError } from '../utils/appError.js';
import { getTenantContext, getActiveTenantId, MAIN_STORE_ID } from '../tenant/tenantContext.js';
import {
  formatDepotLocationLabel,
  formatMovementRouteLabel,
  formatStockLocationLabel,
  formatReturnReasonLabel,
  formatStorageTypeLabel,
} from '../utils/displayLabels.js';
import { deriveShelfStockAlert } from '../utils/retailStockPolicy.js';
import {
  PURCHASE_ORDER_WAITING_DELIVERY_STATUSES,
  PURCHASE_ORDER_CANCELLED_STATUSES,
  PURCHASE_ORDER_GOODS_RECEIPT_STATUSES,
  normalizePurchaseOrderStatus,
} from '../domain/purchaseOrderLifecycle.js';

const sortByNewest = (items) => [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const formatOrderReference = (value, fallbackSeed = '') => {
  const raw = String(value || '').trim();
  const digitMatch = raw.match(/\d+/g);
  if (digitMatch?.length) {
    return `siparis-${digitMatch.join('').slice(-5).padStart(5, '0')}`;
  }
  const seed = String(fallbackSeed || raw || '0');
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return `siparis-${String(Math.abs(hash) % 100000).padStart(5, '0')}`;
};

const toNumberValue = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const fromDateValue = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

const TASK_STATUS_ALIASES = {
  pending: 'open',
  bekliyor: 'open',
  beklemede: 'open',
  waiting: 'open',
  wait: 'open',
  open: 'open',
  acik: 'open',
  active: 'open',
  assigned: 'open',
  todo: 'open',
  new: 'open',
  in_progress: 'open',
  inprogress: 'open',
  devam_ediyor: 'open',
  devam: 'open',
  ongoing: 'open',
  processing: 'open',
  overdue: 'open',
  gecikmis: 'open',
  late: 'open',
  completed: 'closed',
  complete: 'closed',
  done: 'closed',
  resolved: 'closed',
  closed: 'closed',
  kapandi: 'closed',
  kapatildi: 'closed',
  tamamlandi: 'closed',
  finished: 'closed',
  cancelled: 'closed',
  canceled: 'closed',
  rejected: 'closed',
  iptal: 'closed',
  iptal_edildi: 'closed',
  archived: 'closed',
  arsiv: 'closed',
  arsivlendi: 'closed',
};
const CLOSED_TASK_STATUSES = new Set(Object.entries(TASK_STATUS_ALIASES).filter(([, value]) => value === 'closed').map(([key]) => key));
const OPEN_TASK_STATUSES = new Set(Object.entries(TASK_STATUS_ALIASES).filter(([, value]) => value === 'open').map(([key]) => key));
const COMPLETED_PURCHASE_ORDER_STATUSES = new Set(['completed']);
const ARCHIVED_PURCHASE_ORDER_STATUSES = new Set(['archived']);
const CLOSED_PURCHASE_ORDER_STATUSES = new Set([...COMPLETED_PURCHASE_ORDER_STATUSES, ...ARCHIVED_PURCHASE_ORDER_STATUSES]);
const WAITING_DELIVERY_PURCHASE_ORDER_STATUSES = PURCHASE_ORDER_WAITING_DELIVERY_STATUSES;
const CANCELLED_PURCHASE_ORDER_STATUSES = PURCHASE_ORDER_CANCELLED_STATUSES;

const normalizeStatusKey = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');
const normalizePurchaseStatusKey = (value) => normalizePurchaseOrderStatus(value, '');

const normalizeTaskStatusKey = (value) => {
  const text = String(value || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return TASK_STATUS_ALIASES[text] || text;
};

const isTaskCompletedStatus = (value) => normalizeTaskStatusKey(value) === 'closed';

const isTaskOpenStatus = (value) => {
  const normalized = normalizeTaskStatusKey(value);
  if (!normalized) return false;
  if (isTaskCompletedStatus(normalized)) return false;
  return normalized === 'open' || OPEN_TASK_STATUSES.has(normalized);
};

const isPurchaseOrderOpenStatus = (value) => {
  const normalized = normalizePurchaseOrderStatus(value, '');
  return normalized ? !CLOSED_PURCHASE_ORDER_STATUSES.has(normalized) && !CANCELLED_PURCHASE_ORDER_STATUSES.has(normalized) : true;
};

const isPurchaseOrderWaitingDeliveryStatus = (value) => {
  const normalized = normalizePurchaseOrderStatus(value, '');
  return WAITING_DELIVERY_PURCHASE_ORDER_STATUSES.has(normalized);
};

const getPurchaseOrderCancelledAt = (order = {}) => {
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const cancellationEntry = [...history]
    .reverse()
    .find((entry) => CANCELLED_PURCHASE_ORDER_STATUSES.has(normalizePurchaseStatusKey(entry?.status)));
  return cancellationEntry?.at || order.cancelledAt || order.canceledAt || order.updatedAt || order.completedAt || order.createdAt || null;
};

const isPurchaseOrderCancelledStatus = (value) => CANCELLED_PURCHASE_ORDER_STATUSES.has(normalizePurchaseStatusKey(value));

const isPurchaseOrderArchivedForDashboard = (order = {}, now = new Date()) => {
  const status = normalizePurchaseStatusKey(order?.status || order?.currentStatus);
  if (status === 'archived' || order?.archived === true || order?.archivedAt) return true;
  if (!isPurchaseOrderCancelledStatus(status)) return false;
  const cancelledAt = new Date(getPurchaseOrderCancelledAt(order) || 0);
  if (!Number.isFinite(cancelledAt.getTime())) return false;
  return now.getTime() - cancelledAt.getTime() >= MS_PER_DAY;
};

const SMART_ALERT_SEVERITY_WEIGHT = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const PROCUREMENT_PIPELINE_STATUSES_FOR_REPLENISHMENT = new Set([
  'supplier_notified',
  'preparing',
  'ready_to_ship',
  'in_transit',
  'delivered',
  'goods_receipt_pending',
  'goods_receipt_completed',
  'stock_entry_pending',
]);

const PRE_DELIVERY_PURCHASE_ORDER_STATUSES_FOR_ALERTS = new Set([
  'submitted_for_approval',
  'approval_pending',
  'approved',
  'supplier_notified',
  'preparing',
  'ready_to_ship',
  'in_transit',
]);

const normalizeAlertDate = (value) => {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  const parsed = new Date(`${text}T23:59:59.999`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const isPurchaseOrderInactiveForDeliveryMetrics = (order = {}) => {
  const status = normalizePurchaseOrderStatus(order.status || order.currentStatus, '');
  return !status
    || PURCHASE_ORDER_GOODS_RECEIPT_STATUSES.has(status)
    || CLOSED_PURCHASE_ORDER_STATUSES.has(status)
    || CANCELLED_PURCHASE_ORDER_STATUSES.has(status)
    || order.archived === true
    || Boolean(order.archivedAt)
    || Boolean(order.deletedAt)
    || Boolean(order.softDeletedAt)
    || Boolean(order.isDeleted)
    || order.goodsReceiptCompleted === true
    || order.stockEntryCompleted === true
    || Boolean(order.completedAt);
};

const isPurchaseOrderOpenDeliveryOverdue = (order = {}, now = new Date()) => {
  const status = normalizePurchaseOrderStatus(order.status || order.currentStatus, '');
  if (!PRE_DELIVERY_PURCHASE_ORDER_STATUSES_FOR_ALERTS.has(status)) return false;
  if (isPurchaseOrderInactiveForDeliveryMetrics(order)) return false;
  return daysLateFrom(order.estimatedDeliveryDate || order.expectedDeliveryDate, now) > 0;
};

const getCurrentStatusEnteredAt = (order = {}) => {
  const status = normalizePurchaseOrderStatus(order.status || order.currentStatus, '');
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const matching = history
    .filter((entry) => normalizePurchaseOrderStatus(entry?.status, '') === status && entry?.at)
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  return matching[0]?.at || order.updatedAt || order.createdAt || null;
};

const hoursSince = (value, now = new Date()) => {
  const time = toTimestamp(value);
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((now.getTime() - time) / (60 * 60 * 1000)));
};

const daysLateFrom = (dateValue, now = new Date()) => {
  const expected = normalizeAlertDate(dateValue);
  if (!expected) return 0;
  return Math.max(0, Math.ceil((now.getTime() - expected.getTime()) / MS_PER_DAY));
};

const resolveAlertOrderRef = (order = {}) => ({
  id: order.id,
  orderNumber: formatOrderReference(order.orderNumber, order.id),
  supplierName: order.supplier?.name || '-',
  status: normalizePurchaseOrderStatus(order.status || order.currentStatus, ''),
});

const readNestedValue = (source, path = []) => path.reduce((cursor, key) => {
  if (!cursor || typeof cursor !== 'object') return undefined;
  return cursor[key];
}, source);

const hasFallbackPlacementSignal = (order = {}) => {
  const payload = order?.payload && typeof order.payload === 'object' ? order.payload : {};
  const fallbackCandidates = [
    readNestedValue(payload, ['stockEntry', 'fallbackLines']),
    readNestedValue(payload, ['stockEntry', 'fallback_lines']),
    payload.fallbackLines,
    payload.fallback_lines,
    payload.overflowLines,
    payload.overflow_lines,
    payload.noFitLines,
    payload.no_fit_lines,
  ];
  const hasFallbackLines = fallbackCandidates.some((value) => Array.isArray(value) && value.length > 0);
  if (hasFallbackLines) return true;

  const text = JSON.stringify(payload).toLocaleLowerCase('tr-TR');
  return /fallback|overflow|uygun boş depo lokasyonu bulunamadı|lokasyon bulunamadı|no[_-]?fit|placement_failed|warehouse_receipt_failed/.test(text);
};

const buildSmartAlert = ({ id, type, title, message, severity, count, entityIds = [], references = [], actionLabel, actionRoute, ownerRole, metadata = {}, nowIso }) => ({
  id,
  type,
  title,
  message,
  severity,
  count,
  entityIds,
  references,
  actionLabel,
  actionRoute,
  ownerRole,
  metadata,
  createdAt: nowIso,
  updatedAt: nowIso,
});

const buildDashboardSmartAlerts = ({ purchaseOrders = [], criticalItems = [], now = new Date() } = {}) => {
  const nowIso = now.toISOString();
  const alerts = [];
  const orders = Array.isArray(purchaseOrders) ? purchaseOrders : [];
  const criticalRows = Array.isArray(criticalItems) ? criticalItems : [];

  const goodsReceiptPending = orders.filter((order) => normalizePurchaseOrderStatus(order.status || order.currentStatus, '') === 'goods_receipt_pending');
  if (goodsReceiptPending.length > 0) {
    const count = goodsReceiptPending.length;
    alerts.push(buildSmartAlert({
      id: 'smart-alert:goods-receipt-pending',
      type: 'goods_receipt_pending_orders',
      title: 'Mal kabul bekleyen siparişler',
      message: `Mal kabul işlemi bekleyen ${count} sipariş var.`,
      severity: count >= 8 ? 'critical' : count >= 4 ? 'high' : 'medium',
      count,
      entityIds: goodsReceiptPending.map((order) => order.id).filter(Boolean),
      references: goodsReceiptPending.slice(0, 5).map(resolveAlertOrderRef),
      actionLabel: 'Sipariş Takibi',
      actionRoute: '/siparis-takibi?status=goods_receipt_pending',
      ownerRole: 'receiving',
      metadata: { trigger: 'status=goods_receipt_pending' },
      nowIso,
    }));
  }

  const stockEntryPending = orders
    .filter((order) => normalizePurchaseOrderStatus(order.status || order.currentStatus, '') === 'stock_entry_pending')
    .map((order) => ({ order, ageHours: hoursSince(getCurrentStatusEnteredAt(order), now) }))
    .filter((row) => row.ageHours >= 24);
  if (stockEntryPending.length > 0) {
    const count = stockEntryPending.length;
    const maxAgeHours = Math.max(...stockEntryPending.map((row) => row.ageHours));
    alerts.push(buildSmartAlert({
      id: 'smart-alert:stock-entry-pending-aging',
      type: 'stock_entry_pending_aging',
      title: 'Bekleyen stok girişleri',
      message: `${count} siparişte stok girişi bekleniyor. En eski kayıt ${maxAgeHours} saattir açık.`,
      severity: maxAgeHours >= 72 ? 'critical' : maxAgeHours >= 48 ? 'high' : 'medium',
      count,
      entityIds: stockEntryPending.map((row) => row.order.id).filter(Boolean),
      references: stockEntryPending.slice(0, 5).map((row) => ({ ...resolveAlertOrderRef(row.order), ageHours: row.ageHours })),
      actionLabel: 'Stok İşlemleri',
      actionRoute: '/stok-islemleri?status=stock_entry_pending',
      ownerRole: 'stock',
      metadata: { trigger: 'status=stock_entry_pending AND ageHours>=24', maxAgeHours },
      nowIso,
    }));
  }

  const delayedOrders = orders
    .filter((order) => isPurchaseOrderOpenDeliveryOverdue(order, now))
    .map((order) => ({ order, lateDays: daysLateFrom(order.estimatedDeliveryDate || order.expectedDeliveryDate, now) }));
  if (delayedOrders.length > 0) {
    const count = delayedOrders.length;
    const maxLateDays = Math.max(...delayedOrders.map((row) => row.lateDays));
    alerts.push(buildSmartAlert({
      id: 'smart-alert:delivery-delay',
      type: 'delivery_delay',
      title: 'Teslim gecikmesi',
      message: `${count} açık sipariş planlanan teslim tarihini geçti.`,
      severity: maxLateDays >= 4 ? 'critical' : maxLateDays >= 2 ? 'high' : 'medium',
      count,
      entityIds: delayedOrders.map((row) => row.order.id).filter(Boolean),
      references: delayedOrders.slice(0, 5).map((row) => ({ ...resolveAlertOrderRef(row.order), lateDays: row.lateDays, estimatedDeliveryDate: row.order.estimatedDeliveryDate || row.order.expectedDeliveryDate })),
      actionLabel: 'Sipariş Takibi',
      actionRoute: '/siparis-takibi?filter=delayed',
      ownerRole: 'procurement',
      metadata: { trigger: 'open pre-delivery order AND estimatedDeliveryDate<today', maxLateDays, derivedMetric: true },
      nowIso,
    }));
  }

  const pipelineProductIds = new Set();
  orders.forEach((order) => {
    const status = normalizePurchaseOrderStatus(order.status || order.currentStatus, '');
    if (!PROCUREMENT_PIPELINE_STATUSES_FOR_REPLENISHMENT.has(status)) return;
    (Array.isArray(order.items) ? order.items : []).forEach((item) => {
      if (item?.productId) pipelineProductIds.add(String(item.productId));
    });
  });
  const criticalWithoutPipeline = criticalRows.filter((item) => item?.productId && !pipelineProductIds.has(String(item.productId)));
  if (criticalWithoutPipeline.length > 0) {
    const count = criticalWithoutPipeline.length;
    alerts.push(buildSmartAlert({
      id: 'smart-alert:critical-stock-no-pipeline',
      type: 'critical_stock_without_pipeline',
      title: 'Kritik stokta, yolda sipariş yok',
      message: `${count} kritik ürün için aktif tedarik akışı görünmüyor.`,
      severity: count >= 20 ? 'critical' : count >= 8 ? 'high' : 'medium',
      count,
      entityIds: criticalWithoutPipeline.map((item) => item.productId).filter(Boolean),
      references: criticalWithoutPipeline.slice(0, 5).map((item) => ({
        productId: item.productId,
        sku: item.sku,
        productName: item.productName,
        currentStock: item.currentStock ?? item.quantity,
        criticalStock: item.criticalStock,
      })),
      actionLabel: 'Sipariş Önerileri',
      actionRoute: '/siparis-onerileri?preset=critical-no-pipeline',
      ownerRole: 'procurement',
      metadata: { trigger: 'criticalStock=true AND no active procurement pipeline' },
      nowIso,
    }));
  }

  const fallbackOrders = orders.filter(hasFallbackPlacementSignal);
  if (fallbackOrders.length > 0) {
    const count = fallbackOrders.length;
    alerts.push(buildSmartAlert({
      id: 'smart-alert:receiving-location-fallback',
      type: 'receiving_location_fallback',
      title: 'Lokasyona sığmayan mal kabul',
      message: `${count} siparişte uygun lokasyon bulunamadı; fallback yerleşim kullanıldı.`,
      severity: count >= 6 ? 'critical' : count >= 3 ? 'high' : 'medium',
      count,
      entityIds: fallbackOrders.map((order) => order.id).filter(Boolean),
      references: fallbackOrders.slice(0, 5).map(resolveAlertOrderRef),
      actionLabel: 'Lokasyon Yönetimi',
      actionRoute: '/lokasyon-yonetimi?filter=receiving-fallback',
      ownerRole: 'warehouse',
      metadata: { trigger: 'payload.stockEntry.fallbackLines OR overflow/no-fit placement signal' },
      nowIso,
    }));
  }

  return alerts
    .sort((left, right) => (
      (SMART_ALERT_SEVERITY_WEIGHT[right.severity] || 0) - (SMART_ALERT_SEVERITY_WEIGHT[left.severity] || 0)
      || Number(right.count || 0) - Number(left.count || 0)
      || String(left.title || '').localeCompare(String(right.title || ''), 'tr')
    ));
};

const toPositiveInt = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const resolveConfiguredCriticalStock = (settings = {}, product = {}) => {
  const payload = product?.payload && typeof product.payload === 'object' ? product.payload : {};
  const configured = toPositiveInt(
    settings?.criticalStockThreshold
      ?? settings?.defaultCriticalStock
      ?? settings?.defaultCritical
      ?? settings?.stockPolicy?.criticalStockThreshold,
    0
  );
  if (configured > 0) return configured;
  const explicit = toPositiveInt(product?.criticalStock, 0);
  if (explicit > 0) return explicit;
  return toPositiveInt(product?.minStock ?? payload.minStock ?? payload.minimumStock ?? product?.minimumStock, 0);
};

const classifyStockRisk = ({ quantity = 0, criticalStock = 0, maxStock = 0 } = {}) => {
  const safeQuantity = Math.max(0, Number(quantity || 0));
  const safeCritical = Math.max(0, Number(criticalStock || 0));
  const safeMax = Math.max(0, Number(maxStock || 0));
  if (safeQuantity <= 0) return 'out';
  if (safeCritical > 0 && safeQuantity <= safeCritical) return 'critical';
  if (safeCritical > 0 && safeQuantity <= Math.max(safeCritical + 5, Math.ceil(safeCritical * 1.5))) return 'low';
  if (safeMax > 0 && safeQuantity >= safeMax) return 'overstock';
  return 'normal';
};

const parseDetailsFlag = (value) => ['1', 'true', 'yes', 'full'].includes(String(value || '').trim().toLowerCase());

const toDateBoundary = (value, boundary = 'start') => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = boundary === 'end' ? `${raw}T23:59:59.999` : `${raw}T00:00:00.000`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseDateRange = (query = {}) => ({
  startAt: toDateBoundary(query.startDate, 'start'),
  endAt: toDateBoundary(query.endDate, 'end'),
});

const DEFAULT_REPORT_PAGE_SIZE = 50;
const MAX_REPORT_PAGE_SIZE = 200;

const SECTION_ALIASES = {
  stock_aging: 'aging',
  stockAging: 'aging',
  expiry_risk: 'expiry',
  expiryRisk: 'expiry',
  supplierPerformance: 'supplier_performance',
  supplier_performance_report: 'supplier_performance',
  orderApprovalLead: 'order_approval_lead',
  goodsReceiptPerformance: 'goods_receipt_performance',
  priceCatalogDiff: 'price_catalog_diff',
  accessAudit: 'access_audit',
  notificationEngagement: 'notification_engagement',
  movementReport: 'movement',
  returnReport: 'returns',
  salesReturnReport: 'sales_returns',
  sales_returns_report: 'sales_returns',
};

const normalizeReportSection = (section) => {
  const raw = String(section || '').trim();
  return SECTION_ALIASES[raw] || raw.toLowerCase();
};

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseReportPagination = (query = {}) => {
  const page = parsePositiveInteger(query.page, 1);
  const rawPageSize = parsePositiveInteger(query.pageSize || query.limit, DEFAULT_REPORT_PAGE_SIZE);
  const pageSize = Math.min(MAX_REPORT_PAGE_SIZE, rawPageSize);
  return { page, pageSize };
};

const paginateReportRows = (rows = [], query = {}) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const { page, pageSize } = parseReportPagination(query);
  const total = safeRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    rows: safeRows.slice(start, start + pageSize),
    meta: {
      page: safePage,
      pageSize,
      total,
      totalPages,
    },
  };
};

const buildInventoryWhere = (query = {}) => {
  const where = {};
  const search = String(query.search || query.q || '').trim();
  if (query.categoryId) where.categoryId = String(query.categoryId);
  if (query.supplierId) where.supplierId = String(query.supplierId);
  if (query.status === 'active') where.isActive = { not: false };
  if (query.status === 'inactive') where.isActive = false;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
};

const mapFastInventoryRow = (product = {}) => {
  const stock = product.stock || {};
  const warehouseStock = Number(stock.warehouseQuantity || 0);
  const shelfStock = Number(stock.shelfQuantity || 0);
  const quantity = warehouseStock + shelfStock;
  const purchasePrice = toNumberValue(product.purchasePrice);
  const salePrice = toNumberValue(product.salePrice);
  const activeBatches = (Array.isArray(stock.batches) ? stock.batches : [])
    .map((batch) => ({
      id: batch.id,
      batchNo: String(batch.batchNo || '').trim(),
      skt: normalizeDateOnly(batch.skt),
      warehouseQuantity: Number(batch.warehouseQuantity || 0),
      shelfQuantity: Number(batch.shelfQuantity || 0),
      totalQuantity: Number(batch.totalQuantity ?? ((batch.warehouseQuantity || 0) + (batch.shelfQuantity || 0))),
      status: batch.status || '',
    }))
    .filter((batch) => batch.batchNo && batch.totalQuantity > 0)
    .sort((left, right) => String(left.skt || '9999-12-31').localeCompare(String(right.skt || '9999-12-31')) || left.batchNo.localeCompare(right.batchNo, 'tr'));
  const nearestExpiry = activeBatches.find((batch) => batch.skt)?.skt || null;

  return {
    productId: product.id,
    id: product.id,
    urunAdi: product.name,
    productName: product.name,
    sku: product.sku,
    barkod: product.barcode || '',
    barcode: product.barcode || '',
    kategoriId: product.categoryId || null,
    categoryId: product.categoryId || null,
    kategoriAdi: product.category?.name || '-',
    categoryName: product.category?.name || '-',
    kategoriKodu: product.category?.code || '',
    categoryCode: product.category?.code || '',
    tedarikciId: product.supplierId || null,
    supplierId: product.supplierId || null,
    tedarikciAdi: product.supplier?.name || '-',
    supplierName: product.supplier?.name || '-',
    alisFiyati: purchasePrice,
    satisFiyati: salePrice,
    fiyat: salePrice,
    purchasePrice,
    salePrice,
    unit: product.unit || 'Adet',
    birim: product.unit || 'Adet',
    requiredStorageType: product.requiredStorageType || 'Ortam',
    storageType: product.requiredStorageType || 'Ortam',
    storageTypeLabel: formatStorageTypeLabel(product.requiredStorageType || 'Ortam'),
    kritikStok: Number(product.criticalStock || 0),
    criticalStock: Number(product.criticalStock || 0),
    maxStok: Number(product.maxStock || 0),
    maxStock: Number(product.maxStock || 0),
    toplamStok: quantity,
    totalStock: quantity,
    quantity,
    depoStok: warehouseStock,
    warehouseStock,
    reyonStok: shelfStock,
    shelfStock,
    skt: nearestExpiry,
    expiryDate: nearestExpiry,
    batches: activeBatches,
    productBatches: activeBatches,
    sectionId: product.sectionId || null,
    reyonAdi: product.section?.name || '',
    sectionName: product.section?.name || '',
    reyonNo: product.section?.number || null,
    sectionNumber: product.section?.number || null,
    shelfSide: product.shelfSide || null,
    shelfNo: product.shelfNo || null,
    shelfLevel: product.shelfLevel || null,
    shelfCode: product.shelfCode || null,
    aktif: product.isActive !== false,
    isActive: product.isActive !== false,
    linkedSupplierCount: Number(product._count?.supplierProducts || 0),
    eslLinkedCount: Number(product._count?.eslDevices || 0),
    supplierMappingNames: '',
    linkedEslCodes: '',
    createdAt: fromDateValue(product.createdAt),
    updatedAt: fromDateValue(product.updatedAt),
    priceUpdatedAt: fromDateValue(product.priceUpdatedAt),
    stockValue: quantity * purchasePrice,
    potentialRevenue: quantity * salePrice,
    isCritical: quantity <= Number(product.criticalStock || 0),
  };
};

const stripLegacyInventoryFields = (row = {}) => {
  const {
    urunAdi,
    barkod,
    kategoriId,
    kategoriAdi,
    kategoriKodu,
    tedarikciId,
    tedarikciAdi,
    alisFiyati,
    satisFiyati,
    fiyat,
    birim,
    kritikStok,
    maxStok,
    toplamStok,
    depoStok,
    reyonStok,
    skt,
    reyonAdi,
    reyonNo,
    aktif,
    ...current
  } = row;
  return current;
};

const getFastInventorySection = async (query = {}) => {
  const prisma = await getPrisma();
  const where = buildInventoryWhere(query);
  const { page, pageSize } = parseReportPagination(query);
  const skip = (page - 1) * pageSize;
  const [total, rows] = await withPostgresQueryLogging('GET /api/reports/sections/inventory', () => Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip,
      take: pageSize,
      select: {
        id: true,
        sku: true,
        barcode: true,
        name: true,
        categoryId: true,
        supplierId: true,
        sectionId: true,
        shelfSide: true,
        shelfNo: true,
        shelfLevel: true,
        shelfCode: true,
        unit: true,
        requiredStorageType: true,
        purchasePrice: true,
        salePrice: true,
        criticalStock: true,
        maxStock: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        priceUpdatedAt: true,
        category: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true } },
        section: { select: { id: true, name: true, number: true } },
        stock: {
          select: {
            warehouseQuantity: true,
            shelfQuantity: true,
            batches: {
              where: { totalQuantity: { gt: 0 } },
              orderBy: [{ skt: 'asc' }, { batchNo: 'asc' }],
              select: { id: true, batchNo: true, skt: true, warehouseQuantity: true, shelfQuantity: true, totalQuantity: true, status: true },
            },
          },
        },
        _count: { select: { supplierProducts: true, eslDevices: true } },
      },
    }),
  ]));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  return {
    section: 'inventory',
    generatedAt: new Date().toISOString(),
    rows: rows.map(mapFastInventoryRow).map(stripLegacyInventoryFields),
    meta: {
      page: safePage,
      pageSize,
      total,
      totalPages,
    },
  };
};

const getPostgresInventoryRowsForReports = async (query = {}) => {
  const prisma = await getPrisma();
  const where = buildInventoryWhere(query);
  const rows = await withPostgresQueryLogging('reports live inventory rows', () => prisma.product.findMany({
    where,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      categoryId: true,
      supplierId: true,
      sectionId: true,
      shelfSide: true,
      shelfNo: true,
      shelfLevel: true,
      shelfCode: true,
      unit: true,
      requiredStorageType: true,
      purchasePrice: true,
      salePrice: true,
      criticalStock: true,
      maxStock: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      priceUpdatedAt: true,
      category: { select: { id: true, name: true, code: true } },
      supplier: { select: { id: true, name: true } },
      section: { select: { id: true, name: true, number: true } },
      stock: {
        select: {
          warehouseQuantity: true,
          shelfQuantity: true,
          batches: {
            where: { totalQuantity: { gt: 0 } },
            orderBy: [{ skt: 'asc' }, { batchNo: 'asc' }],
            select: { id: true, batchNo: true, skt: true, warehouseQuantity: true, shelfQuantity: true, totalQuantity: true, status: true },
          },
        },
      },
      _count: { select: { supplierProducts: true, eslDevices: true } },
    },
  }));
  return rows.map(mapFastInventoryRow).map(stripLegacyInventoryFields);
};

const getPostgresCategoryRowsForReports = async (inventory = []) => {
  const prisma = await getPrisma();
  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  return buildCategoryReportRows(categories, inventory);
};

const getPostgresSupplierRowsForReports = async (inventory = []) => {
  const prisma = await getPrisma();
  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true } });
  return buildSupplierReportRows(suppliers, inventory);
};

const hasDateRange = ({ startAt, endAt } = {}) => Boolean(startAt || endAt);

const isWithinDateRange = (value, range = {}) => {
  if (!hasDateRange(range)) return true;
  if (!value) return false;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  if (range.startAt && date < range.startAt) return false;
  if (range.endAt && date > range.endAt) return false;
  return true;
};

const filterRowsByDateRange = (rows = [], range = {}, getDateValue = (item) => item?.createdAt) =>
  (Array.isArray(rows) ? rows : []).filter((item) => isWithinDateRange(getDateValue(item), range));

const normalizeDateOnly = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  const prefix = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : '';
};

const deriveStockAlert = ({ product = {}, quantity = 0, shelfQuantity = 0 } = {}) =>
  deriveShelfStockAlert({ product, shelfQuantity, totalQuantity: quantity });

const REASON_LABELS = {
  product_purchase: 'Ürün Satın Alımı',
  customer_return: 'Müşteri İadesi',
  manual_adjustment: 'Manuel Düzeltme',
  transfer_in: 'Transfer Girişi',
  transfer_out: 'Transfer Çıkışı',
  count_surplus: 'Manuel Düzeltme',
  count_deficit: 'Manuel Düzeltme',
  pos_sale: 'Satış (POS İşlemi)',
  supplier_return: 'Tedarikçiye İade',
  write_off: 'İmha',
};

const MOVEMENT_TYPE_LABELS = {
  IN: 'Giriş',
  OUT: 'Çıkış',
  ADJUSTMENT: 'Düzeltme',
  TRANSFER: 'Transfer',
};

const RISK_LEVEL_LABELS = {
  critical: 'Kritik',
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük',
  normal: 'Düşük',
};

const normalizeDisplayText = (value) => {
  if (typeof value !== 'string') return value;
  return value
    .replace(/Sat\?\? \(POS \?\?lemi\)/g, 'Satış (POS İşlemi)')
    .replace(/Sat\?n alma \/ mal kabul/g, 'Satın alma / mal kabul')
    .replace(/M\?\?teri \?adesi/g, 'Müşteri İadesi')
    .replace(/M\?\?teri beyan\? ile iade/g, 'Müşteri beyanı ile iade')
    .normalize('NFC');
};

const inferReasonCode = (movement) => {
  if (movement.reasonCode) return movement.reasonCode;
  const note = String(movement.note || '').toLowerCase();
  if (note.includes('pos satış')) return 'pos_sale';
  if (note.includes('pos iade')) return 'customer_return';
  if (note.includes('zayi') || note.includes('imha')) return 'write_off';
  if (note.includes('transfer')) return movement.type === 'IN' ? 'transfer_in' : 'transfer_out';
  if (note.includes('sayım')) return 'manual_adjustment';
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
  };
};

const stripLegacyMovementFields = (row = {}) => {
  const { skt, ...current } = row;
  return {
    ...current,
    ...(current.expiryDate || !skt ? {} : { expiryDate: skt }),
  };
};

const applyMovementFilters = (movements, query) =>
  movements.filter((movement) => {
    const createdAt = new Date(movement.createdAt);
    const matchesSearch =
      !query.search ||
      [movement.productName, movement.sku, movement.note, movement.referenceNo, movement.userName, movement.reasonLabel, movement.reasonCode]
        .filter(Boolean)
        .some((value) => includesSearchText(value, query.search));
    const matchesType = !query.type || movement.type === String(query.type).toUpperCase();
    const matchesProduct = !query.productId || movement.productId === query.productId;
    const matchesFrom = !query.startDate || createdAt >= new Date(`${query.startDate}T00:00:00`);
    const matchesTo = !query.endDate || createdAt <= new Date(`${query.endDate}T23:59:59`);

    return matchesSearch && matchesType && matchesProduct && matchesFrom && matchesTo;
  });

const resolveInventoryExpiry = ({ product = {}, stock = {} } = {}) => {
  const activeBatchExpiry = (Array.isArray(stock?.batches) ? stock.batches : [])
    .filter((batch) => Number(batch?.totalQuantity ?? ((batch?.warehouseQuantity || 0) + (batch?.shelfQuantity || 0))) > 0)
    .map((batch) => normalizeDateOnly(batch?.skt))
    .filter(Boolean)
    .sort()[0];

  return activeBatchExpiry || '';
};

const NON_REAL_PRICE_EVENT_SOURCES = new Set(['legacy_price_updated_at', 'legacy', 'import', 'bulk_import', 'seed', 'migration', 'updated_at']);

const isRealPriceEventSource = (source) => {
  const normalized = String(source || '').trim().toLowerCase();
  if (!normalized) return true;
  return !NON_REAL_PRICE_EVENT_SOURCES.has(normalized);
};

const loadInventoryDerivedDetails = async () => {
  if (config.dataStore !== 'postgres') {
    return { fdtByProductId: new Map(), batchesByProductId: new Map() };
  }

  const prisma = await getPrisma();
  const [priceEvents, batches] = await Promise.all([
    prisma.productPriceEvent.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { productId: true, source: true, createdAt: true },
    }),
    prisma.stockBatch.findMany({
      where: { totalQuantity: { gt: 0 } },
      orderBy: [{ skt: 'asc' }, { batchNo: 'asc' }],
      select: { id: true, productId: true, batchNo: true, skt: true, warehouseQuantity: true, shelfQuantity: true, totalQuantity: true, status: true },
    }),
  ]);

  const fdtByProductId = new Map();
  priceEvents.forEach((event) => {
    if (!event?.productId || fdtByProductId.has(event.productId) || !isRealPriceEventSource(event.source)) return;
    fdtByProductId.set(event.productId, fromDateValue(event.createdAt));
  });

  const batchesByProductId = new Map();
  batches.forEach((batch) => {
    if (!batch?.productId || !String(batch.batchNo || '').trim()) return;
    const current = batchesByProductId.get(batch.productId) || [];
    current.push({
      id: batch.id,
      batchNo: batch.batchNo,
      skt: batch.skt || '',
      warehouseQuantity: Number(batch.warehouseQuantity || 0),
      shelfQuantity: Number(batch.shelfQuantity || 0),
      totalQuantity: Number(batch.totalQuantity || 0),
      status: batch.status || '',
    });
    batchesByProductId.set(batch.productId, current);
  });

  return { fdtByProductId, batchesByProductId };
};

const buildInventory = async () => {
  const [products, categories, suppliers, stocks, sections, supplierMappings, eslDevices, derivedDetails] = await Promise.all([
    productRepo.getAll(),
    categoryRepo.getAll(),
    supplierRepo.getAll(),
    stockRepo.getAll(),
    sectionRepo.getAll(),
    supplierProductRepo.getAll(),
    eslDeviceRepo.getAll(),
    loadInventoryDerivedDetails(),
  ]);

  const stockByProductId = new Map((stocks || []).map((item) => [item.productId, item]));
  const categoryById = new Map((categories || []).map((item) => [item.id, item]));
  const supplierById = new Map((suppliers || []).map((item) => [item.id, item]));
  const sectionById = new Map((sections || []).map((item) => [item.id, item]));
  const supplierMappingsByProductId = new Map();
  (supplierMappings || []).forEach((mapping) => {
    if (!mapping?.productId) return;
    const current = supplierMappingsByProductId.get(mapping.productId) || [];
    current.push(mapping);
    supplierMappingsByProductId.set(mapping.productId, current);
  });
  const eslDevicesByProductId = new Map();
  (eslDevices || []).forEach((device) => {
    if (!device?.assignedProductId) return;
    const current = eslDevicesByProductId.get(device.assignedProductId) || [];
    current.push(device);
    eslDevicesByProductId.set(device.assignedProductId, current);
  });

  return products.map((product) => {
    const stock = stockByProductId.get(product.id);
    const category = categoryById.get(product.categoryId);
    const supplier = supplierById.get(product.supplierId);
    const section = sectionById.get(product.sectionId);
    const productMappings = supplierMappingsByProductId.get(product.id) || [];
    const linkedEslDevices = eslDevicesByProductId.get(product.id) || [];
    const mappedSupplierIds = new Set(productMappings.map((mapping) => mapping.supplierId).filter(Boolean));
    if (product.supplierId) {
      mappedSupplierIds.add(product.supplierId);
    }

    const warehouseStock = stock?.warehouseQuantity || 0;
    const shelfStock = stock?.shelfQuantity || 0;
    const quantity = warehouseStock + shelfStock;
    const stockAlert = deriveStockAlert({ product, quantity, shelfQuantity: shelfStock });
    const resolvedExpiry = resolveInventoryExpiry({ product, stock });
    const activeBatches = derivedDetails.batchesByProductId.get(product.id)
      || (Array.isArray(stock?.batches) ? stock.batches : []).filter((batch) => Number(batch?.totalQuantity || 0) > 0);
    const batchNos = activeBatches.map((batch) => String(batch?.batchNo || '').trim()).filter(Boolean);
    const lastPriceChangeAt = derivedDetails.fdtByProductId.get(product.id) || product.lastPriceChangeAt || product.lastPriceChangeDate || null;
    const storageType = product.requiredStorageType || category?.mainStorageType || 'Ortam';
    const depotLocationCode = product.defaultWarehouseLocationCode || product.depotLocationCode || product?.payload?.depotLocationCode || '';

    return {
      productId: product.id,
      sku: product.sku,
      barkod: product.barcode,
      barcode: product.barcode || '',
      productName: product.name,
      urunAdi: product.name,
      name: product.name,
      categoryId: product.categoryId,
      kategoriId: product.categoryId,
      categoryName: category?.name || '-',
      kategoriAdi: category?.name || '-',
      kategoriKodu: category?.code || '',
      categoryCode: category?.code || '',
      supplierId: product.supplierId,
      tedarikciId: product.supplierId,
      supplierName: supplier?.name || '-',
      tedarikciAdi: supplier?.name || '-',
      warehouseStock,
      depoStok: warehouseStock,
      shelfStock,
      reyonStok: shelfStock,
      totalStock: quantity,
      toplamStok: quantity,
      quantity,
      currentStock: quantity,
      unit: product.unit,
      birim: product.unit,
      criticalStock: product.criticalStock,
      kritikStok: product.criticalStock,
      maxStok: product.maxStock || 0,
      maxStock: product.maxStock || 0,
      purchasePrice: product.purchasePrice || 0,
      alisFiyati: product.purchasePrice || 0,
      salePrice: product.salePrice || 0,
      satisFiyati: product.salePrice || 0,
      fiyat: product.salePrice || 0,
      isActive: product.isActive,
      aktif: Boolean(product.isActive),
      etiket: product.etiket || '',
      stockAlert,
      stockStatus: String(product.stockStatus || product?.payload?.stockStatus || '').trim() || (stockAlert === 'critical' ? 'Kritik' : stockAlert === 'low' ? 'Düşük' : stockAlert === 'overstock' ? 'Yüksek' : 'Normal'),
      replenishmentNeed: Number(product.replenishmentNeed ?? product?.payload?.replenishmentNeed ?? 0),
      isCritical: stockAlert === 'critical',
      stockValue: quantity * (product.purchasePrice || 0),
      potentialRevenue: quantity * (product.salePrice || 0),
      requiredStorageType: storageType,
      storageType,
      storageTypeLabel: formatStorageTypeLabel(storageType),
      depotLocationCode,
      depotLocationLabel: formatDepotLocationLabel(depotLocationCode, ''),
      batchCount: activeBatches.length,
      batches: activeBatches,
      productBatches: activeBatches,
      batchNo1: batchNos[0] || null,
      batchNo2: batchNos[1] || null,
      batchNo3: batchNos[2] || null,
      batchSummary: batchNos.slice(0, 3).join(', '),
      skt: resolvedExpiry || null,
      expiryDate: resolvedExpiry || null,
      sectionId: product.sectionId || null,
      reyonAdi: section?.name || '-',
      sectionName: section?.name || '-',
      reyonNo: section?.number || null,
      sectionNumber: section?.number || null,
      shelfSide: product.shelfSide || '',
      shelfNo: product.shelfNo || null,
      shelfLevel: product.shelfLevel || null,
      shelfCode: product.shelfCode || '',
      linkedSupplierCount: mappedSupplierIds.size,
      eslLinkedCount: linkedEslDevices.length,
      supplierMappings: productMappings,
      linkedEslDevices,
      priceUpdatedAt: product.priceUpdatedAt || null,
      lastPriceChangeAt,
      lastPriceChangeDate: lastPriceChangeAt ? String(lastPriceChangeAt).slice(0, 10) : null,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  });
};

const buildStockAgingReport = (inventory) => {
  const now = new Date();
  return inventory.map((item) => {
    const lastMovementOrUpdate = item.updatedAt || item.createdAt;
    const daysInStock = Math.max(0, Math.floor((now.getTime() - new Date(lastMovementOrUpdate).getTime()) / MS_PER_DAY));
    const agingBucket = daysInStock <= 30 ? '0-30' : daysInStock <= 60 ? '31-60' : daysInStock <= 90 ? '61-90' : '90+';
    return {
      productId: item.productId,
      sku: item.sku,
      productName: item.productName,
      categoryName: item.categoryName,
      totalStock: item.quantity,
      stockValue: item.stockValue,
      daysInStock,
      agingBucket,
      updatedAt: lastMovementOrUpdate,
    };
  }).sort((a, b) => b.daysInStock - a.daysInStock);
};

const buildExpiryRiskReport = (inventory) => {
  const now = new Date();
  return inventory
    .map((item) => {
      const expiryRaw = item.expiryDate || item.skt;
      if (!expiryRaw) {
        return null;
      }
      const expiryDate = new Date(`${String(expiryRaw).slice(0, 10)}T00:00:00`);
      if (Number.isNaN(expiryDate.getTime())) {
        return null;
      }
      const daysToExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / MS_PER_DAY);
      let riskLevel = 'normal';
      if (daysToExpiry <= 7) riskLevel = 'critical';
      else if (daysToExpiry <= 15) riskLevel = 'high';
      else if (daysToExpiry <= 30) riskLevel = 'medium';

      return {
        productId: item.productId,
        sku: item.sku,
        productName: item.productName,
        categoryName: item.categoryName,
        totalStock: item.quantity,
        expiryDate: String(expiryRaw).slice(0, 10),
        daysToExpiry,
        riskLevel,
        potentialWriteOffValue: Number((item.quantity * item.purchasePrice).toFixed(2)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry);
};

const buildMarginReport = (inventory) => {
  const categoryMarginTotals = {};
  inventory.forEach((item) => {
    if (!categoryMarginTotals[item.categoryId]) {
      categoryMarginTotals[item.categoryId] = { total: 0, count: 0 };
    }
    const pct = item.salePrice > 0 ? ((item.salePrice - item.purchasePrice) / item.salePrice) * 100 : 0;
    categoryMarginTotals[item.categoryId].total += pct;
    categoryMarginTotals[item.categoryId].count += 1;
  });

  return inventory.map((item) => {
    const unitMargin = Number((item.salePrice - item.purchasePrice).toFixed(2));
    const marginPct = item.salePrice > 0 ? Number((((item.salePrice - item.purchasePrice) / item.salePrice) * 100).toFixed(2)) : 0;
    const categoryAvg = categoryMarginTotals[item.categoryId];
    const categoryAvgMarginPct = categoryAvg && categoryAvg.count > 0 ? Number((categoryAvg.total / categoryAvg.count).toFixed(2)) : 0;
    const erosionPct = Number((categoryAvgMarginPct - marginPct).toFixed(2));

    let erosionRisk = 'normal';
    if (erosionPct >= 15 || marginPct <= 10) erosionRisk = 'high';
    else if (erosionPct >= 7 || marginPct <= 20) erosionRisk = 'medium';

    return {
      productId: item.productId,
      sku: item.sku,
      productName: item.productName,
      categoryName: item.categoryName,
      supplierName: item.supplierName,
      purchasePrice: item.purchasePrice,
      salePrice: item.salePrice,
      unitMargin,
      marginPct,
      categoryAvgMarginPct,
      erosionPct,
      erosionRisk,
      stockMarginPotential: Number((unitMargin * item.quantity).toFixed(2)),
    };
  }).sort((a, b) => b.erosionPct - a.erosionPct);
};

const buildSupplierPerformanceReport = async (inventory, purchaseOrdersOverride = null, suppliersOverride = null) => {
  const [suppliers, purchaseOrdersRaw] = await Promise.all([
    suppliersOverride ? Promise.resolve(suppliersOverride) : supplierRepo.getAll(),
    purchaseOrdersOverride ? Promise.resolve(purchaseOrdersOverride) : purchaseOrderRepo.getAll(),
  ]);
  const purchaseOrders = Array.isArray(purchaseOrdersRaw) ? purchaseOrdersRaw : [];

  return suppliers.map((supplier) => {
    const items = inventory.filter((item) => item.supplierId === supplier.id);
    const activeItemCount = items.filter((item) => item.isActive).length;
    const criticalItemCount = items.filter((item) => item.isCritical).length;
    const totalStock = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalStockValue = items.reduce((sum, item) => sum + item.stockValue, 0);
    const avgMarginPct = items.length > 0
      ? Number((items.reduce((sum, item) => {
        const pct = item.salePrice > 0 ? ((item.salePrice - item.purchasePrice) / item.salePrice) * 100 : 0;
        return sum + pct;
      }, 0) / items.length).toFixed(2))
      : 0;

    const supplierOrders = (purchaseOrders || []).filter((order) => order.supplierId === supplier.id);
    const delayedOrderCount = supplierOrders.filter((order) => {
      return isPurchaseOrderOpenDeliveryOverdue(order);
    }).length;

    const criticalRatio = items.length > 0 ? Number(((criticalItemCount / items.length) * 100).toFixed(2)) : 0;
    const onTimeScore = supplierOrders.length > 0
      ? Number((((supplierOrders.length - delayedOrderCount) / supplierOrders.length) * 100).toFixed(2))
      : 100;
    const score = Number((onTimeScore * 0.45 + (100 - criticalRatio) * 0.35 + Math.min(100, avgMarginPct * 2) * 0.2).toFixed(2));

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      productCount: items.length,
      activeProductCount: activeItemCount,
      criticalProductCount: criticalItemCount,
      totalStock,
      totalStockValue: Number(totalStockValue.toFixed(2)),
      avgMarginPct,
      delayedOrderCount,
      orderCount: supplierOrders.length,
      onTimeScore,
      supplierScore: score,
      riskLevel: score < 55 ? 'high' : score < 75 ? 'medium' : 'low',
    };
  }).sort((a, b) => b.supplierScore - a.supplierScore);
};

const getTodayBounds = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const getRelativeDayBounds = (daysAgo = 0) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.max(0, Number(daysAgo || 0)));
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const buildKpiComparison = ({ current = 0, previous = 0 } = {}) => {
  const safeCurrent = toNumberValue(current);
  const safePrevious = toNumberValue(previous);
  const delta = Number((safeCurrent - safePrevious).toFixed(2));

  if (safeCurrent === 0 && safePrevious === 0) {
    return {
      current: safeCurrent,
      previous: safePrevious,
      delta,
      changePercent: null,
      trend: 'neutral',
      status: 'no_data',
    };
  }

  if (safePrevious <= 0) {
    return {
      current: safeCurrent,
      previous: safePrevious,
      delta,
      changePercent: null,
      trend: 'neutral',
      status: 'insufficient_data',
    };
  }

  const changePercent = Number((((safeCurrent - safePrevious) / safePrevious) * 100).toFixed(1));
  return {
    current: safeCurrent,
    previous: safePrevious,
    delta,
    changePercent,
    trend: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'neutral',
    status: changePercent === 0 ? 'no_change' : 'ok',
  };
};

const getLastDaysStart = (days) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.max(0, Number(days || 0) - 1));
  return start;
};

const buildFastInventoryRows = async (prisma, { take = 200, criticalOnly = false, settings = {} } = {}) => {
  const rows = await prisma.product.findMany({
    where: { isActive: { not: false }, ...(criticalOnly ? { stock: { is: { quantity: { lte: 999999999 } } } } : {}) },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    ...(take ? { take } : {}),
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      categoryId: true,
      supplierId: true,
      criticalStock: true,
      maxStock: true,
      purchasePrice: true,
      salePrice: true,
      unit: true,
      isActive: true,
      createdAt: true,
      payload: true,
      category: { select: { name: true, code: true } },
      supplier: { select: { name: true } },
      stock: {
        select: {
          warehouseQuantity: true,
          shelfQuantity: true,
          quantity: true,
          batches: {
            where: { totalQuantity: { gt: 0 } },
            orderBy: [{ skt: 'asc' }, { batchNo: 'asc' }],
            select: { batchNo: true, skt: true, totalQuantity: true },
          },
        },
      },
    },
  });

  return rows
    .map((product) => {
      const warehouseStock = Number(product.stock?.warehouseQuantity || 0);
      const shelfStock = Number(product.stock?.shelfQuantity || 0);
      const quantity = Number(product.stock?.quantity ?? (warehouseStock + shelfStock));
      const criticalStock = resolveConfiguredCriticalStock(settings, product);
      const stockAlert = classifyStockRisk({ quantity, criticalStock, maxStock: product.maxStock || 0 });
      const purchasePrice = toNumberValue(product.purchasePrice);
      const salePrice = toNumberValue(product.salePrice);
      const nearestExpiry = (Array.isArray(product.stock?.batches) ? product.stock.batches : [])
        .filter((batch) => String(batch?.batchNo || '').trim() && Number(batch?.totalQuantity || 0) > 0 && normalizeDateOnly(batch?.skt))
        .sort((left, right) => normalizeDateOnly(left.skt).localeCompare(normalizeDateOnly(right.skt)) || String(left.batchNo || '').localeCompare(String(right.batchNo || ''), 'tr'))[0]?.skt || null;
      return {
        productId: product.id,
        sku: product.sku,
        barkod: product.barcode,
        barcode: product.barcode || '',
        productName: product.name,
        urunAdi: product.name,
        name: product.name,
        categoryId: product.categoryId,
        kategoriId: product.categoryId,
        categoryName: product.category?.name || '-',
        kategoriAdi: product.category?.name || '-',
        kategoriKodu: product.category?.code || '',
        categoryCode: product.category?.code || '',
        supplierId: product.supplierId,
        tedarikciId: product.supplierId,
        supplierName: product.supplier?.name || '-',
        tedarikciAdi: product.supplier?.name || '-',
        warehouseStock,
        depoStok: warehouseStock,
        shelfStock,
        reyonStok: shelfStock,
        totalStock: quantity,
        toplamStok: quantity,
        quantity,
        currentStock: quantity,
        unit: product.unit,
        criticalStock,
        maxStock: product.maxStock || 0,
        stockAlert,
        stockStatus: String(product.stockStatus || product?.payload?.stockStatus || '').trim() || (stockAlert === 'out' ? 'Stok Yok' : stockAlert === 'critical' ? 'Kritik' : stockAlert === 'low' ? 'Düşük' : stockAlert === 'overstock' ? 'Yüksek' : 'Normal'),
        replenishmentNeed: Number(product.replenishmentNeed ?? product?.payload?.replenishmentNeed ?? 0),
        isOutOfStock: stockAlert === 'out',
        isLowStock: stockAlert === 'low',
        isCritical: stockAlert === 'critical',
        stockValue: quantity * purchasePrice,
        potentialRevenue: quantity * salePrice,
        purchasePrice,
        salePrice,
        isActive: product.isActive !== false,
        nearestExpiry,
        createdAt: fromDateValue(product.createdAt),
      };
    })
    .filter((item) => !criticalOnly || item.isCritical);
};

const buildFastDailyMovements = async (prisma) => {
  const rows = await prisma.stockMovement.findMany({
    where: { createdAt: { gte: getLastDaysStart(7) } },
    select: { type: true, qty: true, createdAt: true },
  });

  const byDay = new Map();
  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    byDay.set(key, { date: key.slice(5), in: 0, out: 0 });
  }

  rows.forEach((row) => {
    const key = fromDateValue(row.createdAt)?.slice(0, 10);
    const entry = byDay.get(key);
    if (!entry) return;
    const qty = Number(row.qty || 0);
    if (row.type === 'IN') entry.in += qty;
    if (row.type === 'OUT') entry.out += qty;
  });

  return [...byDay.values()];
};

const isSystemActorId = (value) => {
  const actor = String(value || '').trim().toLocaleLowerCase('tr-TR');
  return !actor || ['system', 'auto', 'automation', 'scheduler', 'daily-closing-job', 'proximity-rule-engine', 'unknown'].includes(actor);
};

const countUniqueOperationKeys = (rows = [], keyBuilder) => {
  const keys = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = keyBuilder(row);
    if (key) keys.add(key);
  });
  return keys.size;
};

const isSyntheticTaskRecord = (task = {}) => {
  const id = String(task.id || '');
  const payload = task.payload && typeof task.payload === 'object' ? task.payload : {};
  return id.startsWith('task-realistic-')
    || id.startsWith('task-demo-')
    || id.startsWith('task-seed-')
    || Boolean(payload.generatedScenario || payload.demo || payload.mock || payload.seed);
};

const buildLast24hActivityCount = async (prisma, since) => {
  const [
    stockMovements,
    warehouseMovements,
    purchaseOrders,
    sales,
    customerOrders,
    returns,
    eslHistory,
    priceEvents,
    tasks,
    purchaseOrderActivities,
    accessAuditLogs,
  ] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { createdAt: { gte: since }, userId: { not: null } },
      select: { id: true, referenceNo: true, type: true, reasonCode: true, transferRequestId: true, userId: true, createdAt: true },
    }),
    prisma.warehouseMovement.findMany({
      where: { createdAt: { gte: since }, createdBy: { not: null } },
      select: { id: true, movementType: true, createdBy: true, productId: true, locationId: true, createdAt: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { createdAt: { gte: since }, createdBy: { not: null } },
      select: { id: true, createdBy: true, createdAt: true },
    }),
    prisma.sale.findMany({
      where: { type: 'sale', createdAt: { gte: since }, cashierId: { not: null } },
      select: { id: true, referenceNo: true, cashierId: true, createdAt: true },
    }),
    prisma.customerOrder.findMany({
      where: { createdAt: { gte: since }, customerId: { not: null } },
      select: { id: true, customerId: true, createdAt: true },
    }),
    prisma.sale.findMany({
      where: { type: 'return', createdAt: { gte: since }, cashierId: { not: null } },
      select: { id: true, referenceNo: true, originalSaleRef: true, cashierId: true, createdAt: true },
    }),
    prisma.eslHistory.findMany({
      where: { createdAt: { gte: since } },
      select: { id: true, deviceId: true, productId: true, payload: true, customFields: true, createdAt: true },
    }),
    prisma.productPriceEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { id: true, productId: true, source: true, payload: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: {
        OR: [
          { createdAt: { gte: since } },
          { updatedAt: { gte: since } },
        ],
      },
      select: { id: true, status: true, createdBy: true, assignedTo: true, payload: true, createdAt: true, updatedAt: true },
    }),
    prisma.purchaseOrderActivityLog.findMany({
      where: { at: { gte: since }, by: { not: null } },
      select: { id: true, orderId: true, type: true, status: true, by: true, at: true },
    }),
    prisma.accessAuditLog.findMany({
      where: { createdAt: { gte: since }, actorId: { not: null } },
      select: { id: true, action: true, userId: true, permission: true, requestId: true, actorId: true, createdAt: true },
    }),
  ]);

  const stockMovementCount = countUniqueOperationKeys(
    stockMovements.filter((row) => !isSystemActorId(row.userId)),
    (row) => `stock:${row.userId}:${row.referenceNo || row.transferRequestId || row.id}`,
  );
  const warehouseMovementCount = countUniqueOperationKeys(
    warehouseMovements.filter((row) => !isSystemActorId(row.createdBy)),
    (row) => `warehouse:${row.createdBy}:${row.id}`,
  );
  const purchaseOrderCount = countUniqueOperationKeys(
    purchaseOrders.filter((row) => !isSystemActorId(row.createdBy)),
    (row) => `purchase-order:create:${row.createdBy}:${row.id}`,
  );
  const saleCount = countUniqueOperationKeys(
    sales.filter((row) => !isSystemActorId(row.cashierId)),
    (row) => `sale:${row.cashierId}:${row.referenceNo || row.id}`,
  );
  const customerOrderCount = countUniqueOperationKeys(
    customerOrders.filter((row) => !isSystemActorId(row.customerId)),
    (row) => `customer-order:${row.customerId}:${row.id}`,
  );
  const returnCount = countUniqueOperationKeys(
    returns.filter((row) => !isSystemActorId(row.cashierId)),
    (row) => `return:${row.cashierId}:${row.referenceNo || row.originalSaleRef || row.id}`,
  );
  const eslHistoryCount = countUniqueOperationKeys(
    eslHistory.filter((row) => !isSystemActorId(row.payload?.actorId || row.payload?.userId || row.customFields?.actorId || row.customFields?.userId)),
    (row) => `esl:${row.payload?.actorId || row.payload?.userId || row.customFields?.actorId || row.customFields?.userId}:${row.id}`,
  );
  const priceEventCount = countUniqueOperationKeys(
    priceEvents.filter((row) => !isSystemActorId(row.payload?.approvedBy || row.payload?.actorId || row.payload?.userId)),
    (row) => `price:${row.payload?.approvedBy || row.payload?.actorId || row.payload?.userId}:${row.id || row.productId}`,
  );
  const taskCreateCount = countUniqueOperationKeys(
    tasks.filter((row) => !isSyntheticTaskRecord(row) && row.createdAt && new Date(row.createdAt).getTime() >= since.getTime() && !isSystemActorId(row.createdBy)),
    (row) => `task:create:${row.createdBy}:${row.id}`,
  );
  const taskCompleteCount = countUniqueOperationKeys(
    tasks.filter((row) => !isSyntheticTaskRecord(row) && row.updatedAt && new Date(row.updatedAt).getTime() >= since.getTime() && isTaskCompletedStatus(row.status) && !isSystemActorId(row.assignedTo || row.createdBy)),
    (row) => `task:complete:${row.assignedTo || row.createdBy}:${row.id}`,
  );
  const purchaseOrderActivityCount = countUniqueOperationKeys(
    purchaseOrderActivities.filter((row) => !isSystemActorId(row.by) && normalizeStatusKey(row.type) !== 'created'),
    (row) => `purchase-order:${row.by}:${row.orderId}:${row.type || 'activity'}:${row.status || ''}:${fromDateValue(row.at) || row.id}`,
  );
  const accessAuditCount = countUniqueOperationKeys(
    accessAuditLogs.filter((row) => !isSystemActorId(row.actorId)),
    (row) => `access:${row.actorId}:${row.requestId || row.id}:${row.action || ''}`,
  );
  const taskCount = taskCreateCount + taskCompleteCount;
  return {
    total: stockMovementCount
      + warehouseMovementCount
      + purchaseOrderCount
      + saleCount
      + customerOrderCount
      + returnCount
      + eslHistoryCount
      + priceEventCount
      + taskCount
      + purchaseOrderActivityCount
      + accessAuditCount,
    breakdown: {
      stockMovements: stockMovementCount,
      warehouseMovements: warehouseMovementCount,
      purchaseOrders: purchaseOrderCount,
      sales: saleCount,
      customerOrders: customerOrderCount,
      returns: returnCount,
      eslHistory: eslHistoryCount,
      priceEvents: priceEventCount,
      tasks: taskCount,
      purchaseOrderActivities: purchaseOrderActivityCount,
      accessAuditLogs: accessAuditCount,
    },
  };
};

const buildCustomerOverview = async (prisma, since30Days, todayStart) => {
  const [
    totalCustomers,
    activeCustomers,
    recentOrderCustomers,
    todayOrderCustomers,
    customerOrdersAmount,
    saleCustomerRefs,
    giftCardCustomers,
    newCustomers,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.customer.count({ where: { isActive: { not: false } } }),
    prisma.customerOrder.findMany({
      where: { createdAt: { gte: since30Days }, customerId: { not: null } },
      select: { customerId: true },
      distinct: ['customerId'],
    }),
    prisma.customerOrder.findMany({
      where: { createdAt: { gte: todayStart }, customerId: { not: null } },
      select: { customerId: true },
      distinct: ['customerId'],
    }),
    prisma.customerOrder.aggregate({ where: { createdAt: { gte: since30Days } }, _sum: { totalAmount: true }, _count: { id: true } }),
    prisma.sale.findMany({
      where: { type: 'sale', createdAt: { gte: since30Days } },
      select: { customer: true, totalAmount: true, createdAt: true },
    }),
    prisma.customer.findMany({ select: { id: true, giftCards: true } }),
    prisma.customer.count({ where: { createdAt: { gte: since30Days } } }),
  ]);

  const saleCustomerIds = new Set();
  const todaySaleCustomerIds = new Set();
  let saleAmount = 0;
  let saleCount = 0;
  saleCustomerRefs.forEach((sale) => {
    const customer = sale?.customer && typeof sale.customer === 'object' ? sale.customer : {};
    const id = String(customer.id || customer.customerId || customer.customerNo || customer.email || customer.phone || '').trim();
    if (id) {
      saleCustomerIds.add(id);
      const createdAt = new Date(sale.createdAt);
      if (!Number.isNaN(createdAt.getTime()) && createdAt >= todayStart) {
        todaySaleCustomerIds.add(id);
      }
    }
    saleAmount += toNumberValue(sale.totalAmount);
    saleCount += 1;
  });

  const giftCardCustomerCount = giftCardCustomers.filter((customer) => {
    const giftCards = customer?.giftCards;
    if (Array.isArray(giftCards)) return giftCards.length > 0;
    if (giftCards && typeof giftCards === 'object') return Object.keys(giftCards).length > 0;
    return false;
  }).length;

  const orderCount = Number(customerOrdersAmount._count.id || 0);
  const orderAmount = toNumberValue(customerOrdersAmount._sum.totalAmount);
  const totalTransactionCount = orderCount + saleCount;
  const totalTransactionAmount = orderAmount + saleAmount;
  return {
    totalCustomers,
    activeCustomers,
    recentOrderCustomers: Math.max(recentOrderCustomers.length, saleCustomerIds.size),
    todayShoppers: Math.max(todayOrderCustomers.length, todaySaleCustomerIds.size),
    averageBasketAmount: totalTransactionCount > 0 ? Number((totalTransactionAmount / totalTransactionCount).toFixed(2)) : 0,
    loyaltyCustomers: giftCardCustomerCount,
    newCustomers,
    availableMetrics: {
      totalCustomers: true,
      activeCustomers: true,
      recentOrderCustomers: true,
      todayShoppers: true,
      averageBasketAmount: totalTransactionCount > 0,
      loyaltyCustomers: true,
      newCustomers: true,
    },
  };
};

const cleanText = (value) => String(value || '').trim();

const buildUserLookup = (users = []) => new Map((users || []).map((user) => [
  String(user.id),
  {
    id: user.id,
    name: cleanText(user.name || user.username || user.email || user.id),
    role: cleanText(user.role),
  },
]));

const SYSTEM_ACTOR_IDS = new Set(['system', 'system-auto']);

const resolveActivityActor = ({ userById, actorId, actorName, fallbackId, fallbackName, system = false }) => {
  const normalizedActorId = cleanText(actorId || fallbackId);
  const normalizedActorName = cleanText(actorName || fallbackName);
  if (normalizedActorId && userById.has(normalizedActorId)) {
    const user = userById.get(normalizedActorId);
    if (SYSTEM_ACTOR_IDS.has(normalizedActorId) || user.role === 'system') {
      return {
        actorId: normalizedActorId,
        actorName: 'Sistem',
        actorRole: user.role || 'system',
        isSystemEvent: true,
        resolutionSource: 'user.system',
      };
    }
    return {
      actorId: normalizedActorId,
      actorName: user.name,
      actorRole: user.role,
      isSystemEvent: false,
      resolutionSource: 'user.id',
    };
  }
  if (normalizedActorName && !['Sistem', 'Bilinmiyor', 'Kullanıcı'].includes(normalizedActorName)) {
    return {
      actorId: normalizedActorId || null,
      actorName: normalizedActorName,
      actorRole: '',
      isSystemEvent: false,
      resolutionSource: 'event.name',
    };
  }
  if (system || SYSTEM_ACTOR_IDS.has(normalizedActorId)) {
    return {
      actorId: normalizedActorId || 'system',
      actorName: 'Sistem',
      actorRole: 'system',
      isSystemEvent: true,
      resolutionSource: 'system.event',
    };
  }
  return {
    actorId: normalizedActorId || null,
    actorName: 'Aktör çözülemedi',
    actorRole: '',
    isSystemEvent: false,
    resolutionSource: 'unresolved',
  };
};

const normalizeActivity = ({
  userById,
  id,
  eventType,
  module,
  actionSummary,
  referenceId,
  referenceCode,
  targetName,
  targetObject = null,
  createdAt,
  actorId,
  actorName,
  fallbackActorId,
  fallbackActorName,
  system = false,
  quantity = null,
  direction = '',
  metadata = {},
}) => {
  const actor = resolveActivityActor({
    userById,
    actorId,
    actorName,
    fallbackId: fallbackActorId,
    fallbackName: fallbackActorName,
    system,
  });
  const normalizedQuantity = quantity === null || quantity === undefined ? null : Number(quantity || 0);
  return {
    id,
    eventType,
    actorId: actor.actorId,
    actorName: actor.actorName,
    actorRole: actor.actorRole,
    isSystemEvent: actor.isSystemEvent,
    actorResolutionSource: actor.resolutionSource,
    module,
    referenceId: referenceId || referenceCode || id,
    referenceCode: referenceCode || referenceId || '',
    actionSummary,
    createdAt: fromDateValue(createdAt),
    targetName: targetName || '',
    targetObject,
    quantity: normalizedQuantity,
    direction,
    metadata,
    userName: actor.actorName,
    reasonLabel: actionSummary,
    productName: targetName || referenceCode || module,
    type: direction || eventType,
    qty: normalizedQuantity,
  };
};

const PURCHASE_STATUS_ACTIONS = {
  created: 'satın alma siparişi oluşturdu',
  submitted_for_approval: 'siparişi onaya gönderdi',
  awaiting_approval: 'siparişi onaya gönderdi',
  pending_approval: 'siparişi onaya gönderdi',
  approved: 'siparişi onayladı',
  supplier_notified: 'siparişi tedarikçiye iletti',
  in_transit: 'siparişi sevkiyata aldı',
  delivered: 'sipariş teslim alındı',
  goods_receipt_pending: 'mal kabul beklemeye aldı',
  goods_receipt_completed: 'mal kabulü tamamladı',
  stock_entry_pending: 'stok girişini beklemeye aldı',
  completed: 'siparişi tamamladı',
  archived: 'siparişi arşivledi',
  cancelled: 'siparişi iptal etti',
  rejected: 'siparişi reddetti',
};

const STOCK_REASON_ACTIONS = {
  pos_sale: 'POS satışı tamamladı',
  pos_return: 'POS iadesi tamamladı',
  purchase_receipt: 'mal kabul stok girişi yaptı',
  purchase_stock_entry: 'satın alma stok girişi yaptı',
  transfer_request: 'reyon transfer hareketi yaptı',
  transfer: 'stok transferi yaptı',
  adjustment: 'stok düzeltmesi yaptı',
  damage: 'stok imha kaydı oluşturdu',
  expired: 'SKT kaynaklı stok çıkışı yaptı',
  return: 'stok iadesi kaydetti',
};

const taskActionForStatus = (status) => {
  const normalized = cleanText(status).toLowerCase();
  if (['done', 'completed'].includes(normalized)) return 'görevi tamamladı';
  if (['in-progress', 'in_progress'].includes(normalized)) return 'görevi işleme aldı';
  if (['cancelled', 'canceled'].includes(normalized)) return 'görevi iptal etti';
  return 'görev oluşturdu';
};

const accessActionLabel = (action) => ({
  request_created: 'erişim talebi oluşturdu',
  request_approved: 'erişim talebini onayladı',
  request_rejected: 'erişim talebini reddetti',
  grant_created: 'geçici yetki verdi',
  grant_revoked: 'geçici yetkiyi kaldırdı',
  grant_expired: 'geçici yetkiyi sonlandırdı',
  task_updated: 'görevi güncelledi',
  task_completed: 'görevi tamamladı',
}[cleanText(action)] || 'erişim denetim kaydı oluşturdu');

const notificationActionLabel = (type) => ({
  assigned: 'görev bildirimi gönderdi',
  task: 'operasyon bildirimi gönderdi',
  access_granted: 'erişim onay bildirimi oluşturdu',
  access_expired: 'erişim sonlanma bildirimi oluşturdu',
}[cleanText(type)] || 'bildirim oluşturdu');

const isSystemNotification = (row) => !cleanText(row.createdBy) && ['access_expired', 'system', 'stock_alert'].includes(cleanText(row.type));

const buildFastActivityFeed = async (prisma, recentStockMovements = []) => {
  try {
    const [
      users,
      sales,
      stockMovements,
      purchaseActivityLogs,
      transferAudits,
      tasks,
      notifications,
      accessAuditLogs,
      accessRequests,
      eslHistory,
      priceEvents,
      catalogImports,
    ] = await withPostgresQueryLogging('GET /api/reports/dashboard activity-feed', () => Promise.all([
      prisma.user.findMany({ select: { id: true, name: true, username: true, email: true, role: true } }),
      prisma.sale.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select: { id: true, referenceNo: true, type: true, deskCode: true, cashierId: true, cashierName: true, totalAmount: true, createdAt: true },
      }),
      recentStockMovements.length ? Promise.resolve(recentStockMovements) : prisma.stockMovement.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 30,
        select: {
          id: true, productId: true, productName: true, sku: true, type: true, qty: true,
          reasonCode: true, reasonLabel: true, referenceNo: true, transferRequestId: true,
          userId: true, userName: true, createdAt: true,
        },
      }),
      prisma.purchaseOrderActivityLog.findMany({
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take: 24,
        select: {
          id: true, type: true, status: true, at: true, by: true, note: true,
          order: { select: { id: true, orderNumber: true, createdBy: true, supplier: { select: { name: true } } } },
        },
      }),
      prisma.transferAudit.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 24,
        select: {
          id: true, transferRequestId: true, fromStatus: true, toStatus: true, note: true,
          actorId: true, actorName: true, createdAt: true,
          transferRequest: { select: { productName: true, requestedBy: true, requestedByName: true, handledBy: true, handledByName: true, quantity: true } },
        },
      }),
      prisma.task.findMany({
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 24,
        select: { id: true, taskNo: true, title: true, status: true, createdBy: true, assignedTo: true, updatedAt: true, createdAt: true },
      }),
      prisma.notification.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 24,
        select: { id: true, userId: true, type: true, title: true, message: true, severity: true, createdBy: true, createdAt: true },
      }),
      prisma.accessAuditLog.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 24,
        select: { id: true, action: true, userId: true, permission: true, requestId: true, actorId: true, createdAt: true },
      }),
      prisma.accessRequest.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select: { id: true, userId: true, permission: true, status: true, createdBy: true, reviewedBy: true, assignedTo: true, createdAt: true, reviewedAt: true },
      }),
      prisma.eslHistory.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select: { id: true, deviceId: true, deviceName: true, productId: true, productName: true, status: true, createdAt: true },
      }),
      prisma.productPriceEvent.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select: { id: true, productId: true, source: true, createdAt: true, product: { select: { name: true, sku: true } } },
      }),
      prisma.catalogImport.findMany({
        orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select: { id: true, supplierId: true, supplierName: true, fileName: true, uploadedAt: true, uploadedBy: true, status: true },
      }),
    ]));

    const userById = buildUserLookup(users);
    const rows = [];

    sales.forEach((sale) => rows.push(normalizeActivity({
      userById,
      id: `sale:${sale.id}`,
      eventType: sale.type === 'return' ? 'pos_return' : 'pos_sale',
      module: 'POS',
      actionSummary: sale.type === 'return' ? 'POS iadesi tamamladı' : 'POS satışı tamamladı',
      referenceId: sale.id,
      referenceCode: sale.referenceNo,
      targetName: sale.deskCode ? `Kasa ${sale.deskCode}` : 'POS işlemi',
      createdAt: sale.createdAt,
      actorId: sale.cashierId,
      actorName: sale.cashierName,
      metadata: { totalAmount: toNumberValue(sale.totalAmount), saleType: sale.type },
    })));

    stockMovements.forEach((movement) => {
      const reasonKey = cleanText(movement.reasonCode);
      if (reasonKey.startsWith('pos_')) return;
      rows.push(normalizeActivity({
        userById,
        id: `stock:${movement.id}`,
        eventType: reasonKey || cleanText(movement.type) || 'stock_movement',
        module: reasonKey.startsWith('pos_') ? 'POS' : 'Stok',
        actionSummary: STOCK_REASON_ACTIONS[reasonKey] || (movement.type === 'IN' ? 'stok girişi yaptı' : movement.type === 'OUT' ? 'stok çıkışı yaptı' : 'stok hareketi yaptı'),
        referenceId: movement.referenceNo || movement.transferRequestId || movement.id,
        referenceCode: movement.referenceNo || movement.transferRequestId || movement.id,
        targetName: movement.productName,
        targetObject: { productId: movement.productId, sku: movement.sku },
        createdAt: movement.createdAt,
        actorId: movement.userId,
        actorName: movement.userName,
        quantity: movement.qty,
        direction: movement.type,
        metadata: { reasonCode: movement.reasonCode, reasonLabel: movement.reasonLabel },
      }));
    });

    purchaseActivityLogs.forEach((log) => {
      const status = normalizePurchaseOrderStatus(log.status || log.type, cleanText(log.status || log.type));
      rows.push(normalizeActivity({
        userById,
        id: `purchase:${log.id}`,
        eventType: `purchase_${status || 'activity'}`,
        module: ['delivered', 'goods_receipt_pending', 'goods_receipt_completed', 'stock_entry_pending'].includes(status) ? 'Mal Kabul' : 'Satın Alma',
        actionSummary: PURCHASE_STATUS_ACTIONS[status] || PURCHASE_STATUS_ACTIONS[cleanText(log.type)] || 'satın alma hareketi işledi',
        referenceId: log.order?.id || log.id,
        referenceCode: formatOrderReference(log.order?.orderNumber, log.order?.id || log.id),
        targetName: log.order?.supplier?.name || 'Satın alma siparişi',
        createdAt: log.at,
        actorId: log.by,
        fallbackActorId: log.order?.createdBy,
        metadata: { status: log.status, type: log.type, note: log.note },
      }));
    });

    transferAudits.forEach((audit) => rows.push(normalizeActivity({
      userById,
      id: `transfer:${audit.id}`,
      eventType: 'transfer_audit',
      module: 'Reyon Transfer',
      actionSummary: cleanText(audit.toStatus).toLocaleLowerCase('tr-TR').includes('tamam')
        ? 'reyon transferini tamamladı'
        : 'reyon besleme talebini güncelledi',
      referenceId: audit.transferRequestId || audit.id,
      referenceCode: audit.transferRequestId || audit.id,
      targetName: audit.transferRequest?.productName || audit.note || 'Transfer talebi',
      createdAt: audit.createdAt,
      actorId: audit.actorId || audit.transferRequest?.handledBy || audit.transferRequest?.requestedBy,
      actorName: audit.actorName || audit.transferRequest?.handledByName || audit.transferRequest?.requestedByName,
      quantity: audit.transferRequest?.quantity,
      metadata: { fromStatus: audit.fromStatus, toStatus: audit.toStatus, note: audit.note },
    })));

    tasks.forEach((task) => {
      const isCompletion = ['done', 'completed'].includes(cleanText(task.status).toLowerCase());
      rows.push(normalizeActivity({
        userById,
        id: `task:${task.id}`,
        eventType: `task_${cleanText(task.status) || 'created'}`,
        module: 'Görev',
        actionSummary: taskActionForStatus(task.status),
        referenceId: task.id,
        referenceCode: task.taskNo || task.id,
        targetName: task.title,
        createdAt: isCompletion ? task.updatedAt || task.createdAt : task.createdAt,
        actorId: isCompletion ? task.assignedTo || task.createdBy : task.createdBy,
        fallbackActorId: task.createdBy,
        metadata: { status: task.status, assignedTo: task.assignedTo },
      }));
    });

    notifications.forEach((notification) => rows.push(normalizeActivity({
      userById,
      id: `notification:${notification.id}`,
      eventType: `notification_${cleanText(notification.type) || 'created'}`,
      module: 'Bildirim',
      actionSummary: notificationActionLabel(notification.type),
      referenceId: notification.id,
      referenceCode: notification.id,
      targetName: notification.title || notification.message,
      createdAt: notification.createdAt,
      actorId: notification.createdBy,
      system: isSystemNotification(notification),
      metadata: { type: notification.type, severity: notification.severity, targetUserId: notification.userId },
    })));

    accessAuditLogs.forEach((log) => rows.push(normalizeActivity({
      userById,
      id: `access-audit:${log.id}`,
      eventType: `access_${cleanText(log.action) || 'audit'}`,
      module: 'Erişim',
      actionSummary: accessActionLabel(log.action),
      referenceId: log.requestId || log.metadata?.taskId || log.id,
      referenceCode: log.requestId || log.metadata?.taskNo || log.id,
      targetName: log.permission || log.metadata?.taskNo || 'Erişim kaydı',
      createdAt: log.createdAt,
      actorId: log.actorId,
      fallbackActorId: log.userId,
      system: SYSTEM_ACTOR_IDS.has(cleanText(log.actorId)),
      metadata: log.metadata || {},
    })));

    accessRequests.forEach((request) => rows.push(normalizeActivity({
      userById,
      id: `access-request:${request.id}`,
      eventType: `access_request_${cleanText(request.status) || 'created'}`,
      module: 'Erişim',
      actionSummary: cleanText(request.status) === 'approved' ? 'erişim talebini onayladı' : 'erişim talebi oluşturdu',
      referenceId: request.id,
      referenceCode: request.id,
      targetName: request.permission || 'Erişim talebi',
      createdAt: request.reviewedAt || request.createdAt,
      actorId: cleanText(request.status) === 'approved' ? request.reviewedBy || request.createdBy : request.createdBy || request.userId,
      fallbackActorId: request.userId,
      metadata: { status: request.status, assignedTo: request.assignedTo },
    })));

    eslHistory.forEach((history) => {
      const actorId = cleanText(history.payload?.actorId || history.payload?.userId || history.customFields?.actorId || history.customFields?.userId);
      const actorName = cleanText(history.payload?.actorName || history.payload?.userName || history.customFields?.actorName || history.customFields?.userName);
      rows.push(normalizeActivity({
        userById,
        id: `esl:${history.id}`,
        eventType: 'esl_send',
        module: 'ESL',
        actionSummary: 'ESL etiket gönderimi yaptı',
        referenceId: history.deviceId || history.id,
        referenceCode: history.deviceName || history.deviceId || history.id,
        targetName: history.productName || history.template || 'ESL etiketi',
        createdAt: history.createdAt,
        actorId,
        actorName,
        metadata: { status: history.status, template: history.template, productId: history.productId },
      }));
    });

    priceEvents.forEach((event) => {
      const actorId = cleanText(event.payload?.actorId || event.payload?.userId || event.payload?.approvedBy);
      const actorName = cleanText(event.payload?.actorName || event.payload?.userName);
      const synthetic = event.source === 'synthetic_backfill' || Boolean(event.payload?.isSyntheticHistory);
      rows.push(normalizeActivity({
        userById,
        id: `price:${event.id}`,
        eventType: 'price_update',
        module: 'Fiyat',
        actionSummary: 'fiyat güncellemesi kaydetti',
        referenceId: event.productId,
        referenceCode: event.product?.sku || event.productId,
        targetName: event.product?.name || event.productId,
        createdAt: event.createdAt,
        actorId,
        actorName,
        system: synthetic,
        metadata: { source: event.source, changeDirection: event.payload?.changeDirection, synthetic },
      }));
    });

    catalogImports.forEach((row) => rows.push(normalizeActivity({
      userById,
      id: `catalog-import:${row.id}`,
      eventType: 'catalog_import',
      module: 'Katalog',
      actionSummary: 'tedarikçi katalog yüklemesi yaptı',
      referenceId: row.id,
      referenceCode: row.fileName || row.id,
      targetName: row.supplierName || row.fileName || 'Katalog içe aktarma',
      createdAt: row.uploadedAt,
      actorId: row.uploadedBy,
      metadata: { supplierId: row.supplierId, status: row.status },
    })));

    return rows
      .filter((row) => row.createdAt)
      .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
      .slice(0, 30);
  } catch (error) {
    console.error('[dashboard] activity feed could not be normalized', error);
    return recentStockMovements.map((row) => normalizeActivity({
      userById: new Map(),
      id: `stock:${row.id}`,
      eventType: row.reasonCode || row.type || 'stock_movement',
      module: row.reasonCode?.startsWith('pos_') ? 'POS' : 'Stok',
      actionSummary: STOCK_REASON_ACTIONS[row.reasonCode] || row.reasonLabel || 'stok hareketi yaptı',
      referenceId: row.referenceNo || row.transferRequestId || row.id,
      referenceCode: row.referenceNo || row.transferRequestId || row.id,
      targetName: row.productName,
      createdAt: row.createdAt,
      actorId: row.userId,
      actorName: row.userName,
      quantity: row.qty,
      direction: row.type,
    }));
  }
};

const DASHBOARD_CACHE_TTL_MS = 15_000;
const dashboardSummaryCaches = new Map();

export const clearDashboardCache = (tenantId, storeId) => {
  if (tenantId) {
    if (storeId) {
      dashboardSummaryCaches.delete(`${tenantId}_${storeId}`);
    } else {
      for (const key of dashboardSummaryCaches.keys()) {
        if (key.startsWith(`${tenantId}_`)) {
          dashboardSummaryCaches.delete(key);
        }
      }
    }
  } else {
    dashboardSummaryCaches.clear();
  }
};

const buildFastDashboardReport = async (tenantId) => {
  const prisma = await getPrisma();
  const settings = await settingsRepo.getSettings();
  const defaultCriticalStock = toPositiveInt(
    settings?.criticalStockThreshold
      ?? settings?.defaultCriticalStock
      ?? settings?.defaultCritical
      ?? settings?.stockPolicy?.criticalStockThreshold,
    0
  );
  const { start, end } = getTodayBounds();
  const { start: previousStart, end: previousEnd } = getRelativeDayBounds(1);
  const since24h = new Date(Date.now() - MS_PER_DAY);
  const since30Days = new Date(Date.now() - (30 * MS_PER_DAY));
  const [
    inventoryTotals,
    stockRiskTotals,
    productCount,
    categoryCount,
    supplierCount,
    usersTotal,
    activeUsers,
    todaySales,
    previousDaySales,
    todaySoldItems,
    pendingPurchaseSuggestions,
    activePurchaseOrders,
    inTransitPurchaseOrders,
    recentMovementsRaw,
    categoryDistribution,
    orderApprovalLeadReport,
    pendingAccessRequests,
    criticalNotifications,
    unreadNotifications,
    totalNotifications,
    readNotifications,
    completedPurchaseOrders,
    approvalPendingOrders,
    waitingDeliveryOrders,
    delayedPurchaseOrders,
    supplierOperationRows,
    taskRowsForMetrics,
    last24hActivity,
    customerOverview,
    inventory,
    criticalItems,
    dailyMovements,
    purchaseOrdersForSmartAlerts,
  ] = await withPostgresQueryLogging('GET /api/reports/dashboard', () => Promise.all([
    prisma.$queryRaw`
      SELECT
        COALESCE(SUM(COALESCE(s.warehouse_quantity, 0)), 0)::int AS "warehouseStock",
        COALESCE(SUM(COALESCE(s.shelf_quantity, 0)), 0)::int AS "shelfStock",
        COALESCE(SUM(COALESCE(s.quantity, COALESCE(s.warehouse_quantity, 0) + COALESCE(s.shelf_quantity, 0))), 0)::int AS "totalStock",
        COALESCE(SUM(COALESCE(s.quantity, COALESCE(s.warehouse_quantity, 0) + COALESCE(s.shelf_quantity, 0)) * COALESCE(p.purchase_price, 0)), 0)::numeric AS "stockValue"
      FROM products p
      LEFT JOIN stocks s ON s.product_id = p.id AND s.tenant_id = p.tenant_id
      WHERE COALESCE(p.is_active, true) = true
        AND p.tenant_id = ${tenantId}
    `,
    prisma.$queryRaw`
      WITH stock_rows AS (
        SELECT
          COALESCE(s.quantity, COALESCE(s.warehouse_quantity, 0) + COALESCE(s.shelf_quantity, 0), 0) AS quantity,
          COALESCE(
            NULLIF(${defaultCriticalStock}::int, 0),
            NULLIF(p.critical_stock, 0),
            CASE
              WHEN (p.payload->>'minStock') ~ '^[0-9]+$' THEN NULLIF((p.payload->>'minStock')::int, 0)
              WHEN (p.payload->>'minimumStock') ~ '^[0-9]+$' THEN NULLIF((p.payload->>'minimumStock')::int, 0)
              ELSE NULL
            END,
            0
          ) AS critical_stock,
          COALESCE(p.max_stock, 0) AS max_stock
        FROM products p
        LEFT JOIN stocks s ON s.product_id = p.id AND s.tenant_id = p.tenant_id
        WHERE COALESCE(p.is_active, true) = true
          AND p.tenant_id = ${tenantId}
      )
      SELECT
        COALESCE(SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END), 0)::int AS "outOfStockCount",
        COALESCE(SUM(CASE WHEN quantity > 0 AND critical_stock > 0 AND quantity <= critical_stock THEN 1 ELSE 0 END), 0)::int AS "criticalCount",
        COALESCE(SUM(CASE WHEN quantity > critical_stock AND critical_stock > 0 AND quantity <= GREATEST(critical_stock + 5, CEIL(critical_stock * 1.5)) THEN 1 ELSE 0 END), 0)::int AS "lowStockCount",
        COALESCE(SUM(CASE WHEN max_stock > 0 AND quantity >= max_stock THEN 1 ELSE 0 END), 0)::int AS "overstockCount"
      FROM stock_rows
    `,
    prisma.product.count({ where: { isActive: { not: false } } }),
    prisma.category.count(),
    prisma.supplier.count(),
    prisma.user.count(),
    prisma.user.count({ where: { isActive: { not: false } } }),
    prisma.sale.aggregate({ where: { type: 'sale', createdAt: { gte: start, lt: end } }, _sum: { totalAmount: true }, _count: { id: true } }),
    prisma.sale.aggregate({ where: { type: 'sale', createdAt: { gte: previousStart, lt: previousEnd } }, _sum: { totalAmount: true }, _count: { id: true } }),
    prisma.saleItem.aggregate({ where: { sale: { type: 'sale', createdAt: { gte: start, lt: end } } }, _sum: { quantity: true } }),
    prisma.purchaseSuggestion.count({ where: { status: 'pending' } }),
    prisma.purchaseOrder.count({
      where: {
        tenantId,
        status: { notIn: [...CLOSED_PURCHASE_ORDER_STATUSES, ...CANCELLED_PURCHASE_ORDER_STATUSES] },
        archived: { not: true },
        archivedAt: null,
      },
    }),
    prisma.purchaseOrder.count({
      where: {
        tenantId,
        status: 'in_transit',
        archived: { not: true },
        archivedAt: null,
      },
    }),
    prisma.stockMovement.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 30,
      select: {
        id: true,
        productId: true,
        productName: true,
        sku: true,
        type: true,
        qty: true,
        reasonCode: true,
        reasonLabel: true,
        referenceNo: true,
        transferRequestId: true,
        userId: true,
        userName: true,
        createdAt: true,
      },
    }),
    prisma.$queryRaw`
      SELECT c.id, c.name,
             COUNT(p.id)::int AS "productCount",
             COALESCE(SUM(COALESCE(s.quantity, COALESCE(s.warehouse_quantity, 0) + COALESCE(s.shelf_quantity, 0))), 0)::int AS "stockQuantity"
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id AND COALESCE(p.is_active, true) = true AND p.tenant_id = c.tenant_id
      LEFT JOIN stocks s ON s.product_id = p.id AND s.tenant_id = p.tenant_id
      WHERE c.tenant_id = ${tenantId}
      GROUP BY c.id, c.name
      ORDER BY "stockQuantity" DESC, c.name ASC
      LIMIT 20
    `,
    prisma.purchaseOrder.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        archived: true,
        archivedAt: true,
        statusHistory: { orderBy: { at: 'asc' }, select: { status: true, at: true } },
        supplier: { select: { name: true } },
      },
    }),
    prisma.accessRequest.count({ where: { status: 'pending' } }),
    prisma.notification.count({ where: { severity: { in: ['critical', 'high'] }, isRead: { not: true } } }),
    prisma.notification.count({ where: { isRead: { not: true } } }),
    prisma.notification.count(),
    prisma.notification.count({ where: { isRead: true } }),
    prisma.purchaseOrder.count({
      where: {
        tenantId,
        OR: [
          { status: { in: [...COMPLETED_PURCHASE_ORDER_STATUSES] } },
          { status: { in: [...ARCHIVED_PURCHASE_ORDER_STATUSES] } },
          { archived: true },
          { archivedAt: { not: null } },
          {
            status: { in: [...CANCELLED_PURCHASE_ORDER_STATUSES] },
            updatedAt: { lt: new Date(Date.now() - MS_PER_DAY) },
          },
        ],
      },
    }),
    prisma.purchaseOrder.count({ where: { tenantId, status: { in: ['submitted_for_approval', 'approval_pending'] }, archived: { not: true }, archivedAt: null } }),
    prisma.purchaseOrder.count({ where: { tenantId, status: { in: [...WAITING_DELIVERY_PURCHASE_ORDER_STATUSES] }, archived: { not: true }, archivedAt: null } }),
    prisma.purchaseOrder.count({
      where: {
        tenantId,
        status: { in: [...WAITING_DELIVERY_PURCHASE_ORDER_STATUSES] },
        estimatedDeliveryDate: { lt: new Date().toISOString().slice(0, 10) },
        archived: { not: true },
        archivedAt: null,
        completedAt: null,
        goodsReceiptCompleted: { not: true },
        stockEntryCompleted: { not: true },
      },
    }),
    prisma.supplier.findMany({
      where: { tenantId, isActive: { not: false } },
      select: {
        id: true,
        name: true,
        purchaseOrders: {
          where: { tenantId },
          select: {
            id: true,
            status: true,
            currentStatus: true,
            estimatedDeliveryDate: true,
            createdAt: true,
            updatedAt: true,
            archived: true,
            archivedAt: true,
            goodsReceiptCompleted: true,
            stockEntryCompleted: true,
            completedAt: true,
            deliveredAt: true,
          },
        },
      },
    }),
    prisma.task.findMany({ select: { id: true, status: true, priority: true, dueDate: true, payload: true } }),
    buildLast24hActivityCount(prisma, since24h),
    buildCustomerOverview(prisma, since30Days, start),
    buildFastInventoryRows(prisma, { take: 24, settings }),
    buildFastInventoryRows(prisma, { take: 16, criticalOnly: true, settings }),
    buildFastDailyMovements(prisma),
    prisma.purchaseOrder.findMany({
      where: { tenantId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: 120,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        currentStatus: true,
        estimatedDeliveryDate: true,
        stockEntryMode: true,
        stockEntryCompleted: true,
        goodsReceiptCompleted: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
        deliveredAt: true,
        completedAt: true,
        archived: true,
        archivedAt: true,
        supplier: { select: { name: true } },
        items: { select: { productId: true, quantity: true } },
        statusHistory: { orderBy: { at: 'asc' }, select: { status: true, at: true } },
      },
    }),
  ]));

  const totals = inventoryTotals?.[0] || {};
  const stockRisks = stockRiskTotals?.[0] || {};
  const stockMovementRows = recentMovementsRaw.map((row) => enrichReason({
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    sku: row.sku,
    type: row.type,
    qty: Number(row.qty || 0),
    reasonCode: row.reasonCode,
    reasonLabel: row.reasonLabel,
    referenceNo: row.referenceNo,
    transferRequestId: row.transferRequestId,
    userId: row.userId,
    userName: row.userName,
    createdAt: fromDateValue(row.createdAt),
  }));
  const recentMovements = await buildFastActivityFeed(prisma, recentMovementsRaw);
  const movementByType = ['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER'].map((type) => ({
    type,
    count: stockMovementRows.filter((row) => row.type === type).length,
    totalQty: stockMovementRows.filter((row) => row.type === type).reduce((sum, row) => sum + Number(row.qty || 0), 0),
  }));
  const supplierPerformanceReport = supplierOperationRows.map((supplier) => {
    const orders = Array.isArray(supplier.purchaseOrders) ? supplier.purchaseOrders : [];
    const openOrderCount = orders.filter((order) => isPurchaseOrderOpenStatus(order.status)).length;
    const waitingDeliveryCount = orders.filter((order) => isPurchaseOrderWaitingDeliveryStatus(order.status)).length;
    const delayedOrderCount = orders.filter((order) => {
      return isPurchaseOrderOpenDeliveryOverdue(order);
    }).length;
    const completedOrders = orders.filter((order) => !isPurchaseOrderOpenStatus(order.status));
    const deliveryDurations = completedOrders
      .map((order) => {
        const startAt = toTimestamp(order.createdAt);
        const doneAt = toTimestamp(order.deliveredAt || order.completedAt);
        if (!Number.isFinite(startAt) || !Number.isFinite(doneAt) || doneAt < startAt) return null;
        return (doneAt - startAt) / MS_PER_DAY;
      })
      .filter((value) => Number.isFinite(value));
    const avgLeadTimeDays = deliveryDurations.length
      ? Number((deliveryDurations.reduce((sum, value) => sum + value, 0) / deliveryDurations.length).toFixed(1))
      : 0;
    const onTimeScore = orders.length > 0 ? Number((((orders.length - delayedOrderCount) / orders.length) * 100).toFixed(2)) : 0;
    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      orderCount: orders.length,
      activeOrderCount: openOrderCount,
      openOrderCount,
      delayedOrderCount,
      waitingDeliveryCount,
      deliveryTimeDays: avgLeadTimeDays,
      avgLeadTimeDays,
      onTimeScore,
      supplierScore: onTimeScore,
      riskLevel: delayedOrderCount > 0 ? 'high' : openOrderCount > 0 ? 'medium' : 'low',
    };
  }).filter((row) => row.orderCount > 0 || row.activeOrderCount > 0 || row.delayedOrderCount > 0 || row.waitingDeliveryCount > 0);
  const realTaskRows = (Array.isArray(taskRowsForMetrics) ? taskRowsForMetrics : []).filter((task) => !isSyntheticTaskRecord(task));
  const taskStatusCounts = realTaskRows.reduce((acc, row) => {
    const status = normalizeTaskStatusKey(row.status) || 'unknown';
    acc[status] = Number(acc[status] || 0) + 1;
    return acc;
  }, {});
  const normalizedOpenTasks = realTaskRows.reduce((sum, row) => (
    isTaskOpenStatus(row.status) ? sum + 1 : sum
  ), 0);
  const normalizedCompletedTasks = realTaskRows.reduce((sum, row) => (
    isTaskCompletedStatus(row.status) ? sum + 1 : sum
  ), 0);
  const openTaskRows = realTaskRows.filter((task) => isTaskOpenStatus(task.status));
  const taskPriorityCounts = openTaskRows.reduce((acc, row) => {
    const priority = normalizeStatusKey(row.priority) || 'normal';
    acc[priority] = Number(acc[priority] || 0) + 1;
    return acc;
  }, {});
  const normalizedCriticalTasks = openTaskRows.filter((task) => ['high', 'critical'].includes(normalizeStatusKey(task.priority))).length;
  const nowMs = Date.now();
  const normalizedOverdueTasks = openTaskRows.filter((task) => {
    if (!task.dueDate) return false;
    const dueMs = new Date(task.dueDate).getTime();
    return Number.isFinite(dueMs) && dueMs < nowMs;
  }).length;

  const storeStatus = resolveStoreScheduleStatus(settings || {}, new Date());
  const todaySalesCount = Number(todaySales._count.id || 0);
  const todaySalesRevenue = toNumberValue(todaySales._sum.totalAmount);
  const previousDaySalesCount = Number(previousDaySales._count.id || 0);
  const previousDaySalesRevenue = toNumberValue(previousDaySales._sum.totalAmount);
  const totalNotificationCount = Number(totalNotifications || 0);
  const readNotificationCount = Number(readNotifications || 0);
  const notificationReadRate = totalNotificationCount > 0
    ? Number(((readNotificationCount / totalNotificationCount) * 100).toFixed(2))
    : 0;
  const expiryRiskCount = (Array.isArray(inventory) ? inventory : []).filter((item) => {
    const days = Number(item?.daysToExpiry);
    return Number.isFinite(days) && days >= 0 && days <= 7;
  }).length;
  const pendingCriticalCount = Number(criticalNotifications || 0)
    + Number(normalizedCriticalTasks || 0)
    + Number(criticalItems?.length || 0)
    + Number(expiryRiskCount || 0);
  const userActionCount = Number(pendingAccessRequests || 0)
    + Number(normalizedOpenTasks || 0)
    + Number(approvalPendingOrders || 0)
    + Number(criticalItems?.length || 0);
  const criticalStockCount = Number(stockRisks.criticalCount || 0);
  const lowStockCount = Number(stockRisks.lowStockCount || 0);
  const outOfStockCount = Number(stockRisks.outOfStockCount || 0);
  const overstockCount = Number(stockRisks.overstockCount || 0);
  const smartAlerts = buildDashboardSmartAlerts({
    purchaseOrders: (Array.isArray(purchaseOrdersForSmartAlerts) ? purchaseOrdersForSmartAlerts : [])
      .filter((order) => !isPurchaseOrderArchivedForDashboard(order)),
    criticalItems,
    now: new Date(),
  });

  return {
    generatedAt: new Date().toISOString(),
    currency: settings?.currency || 'TRY',
    settingsSnapshot: {
      systemName: settings?.systemName,
      businessName: settings?.businessName,
      currency: settings?.currency,
      dashboardMessage: settings?.dashboardMessage,
      timezone: storeStatus.timeZone,
      openingTime: storeStatus.opensAt,
      closingTime: storeStatus.closesAt,
      dayKey: storeStatus.dayKey,
      weeklySchedule: Array.isArray(settings?.weeklySchedule) ? settings.weeklySchedule : [],
      specialDays: Array.isArray(settings?.specialDays) ? settings.specialDays : [],
      isStoreOpen: storeStatus.isStoreOpen,
    },
    overview: {
      totalProducts: productCount,
      totalCategories: categoryCount,
      totalSuppliers: supplierCount,
      totalUsers: usersTotal,
      activeUsers,
      totalWarehouseStockQuantity: Number(totals.warehouseStock || 0),
      totalShelfStockQuantity: Number(totals.shelfStock || 0),
      totalStockQuantity: Number(totals.totalStock || 0),
      totalStockValue: toNumberValue(totals.stockValue),
      outOfStockCount,
      lowStockCount,
      criticalCount: criticalStockCount,
      overstockCount,
      todaySalesRevenue,
      todaySalesCount,
      todaySoldItemCount: Number(todaySoldItems._sum.quantity || 0),
      previousDaySalesRevenue,
      previousDaySalesCount,
      salesComparisons: {
        todaySalesCount: buildKpiComparison({ current: todaySalesCount, previous: previousDaySalesCount }),
        todaySalesRevenue: buildKpiComparison({ current: todaySalesRevenue, previous: previousDaySalesRevenue }),
      },
      pendingPurchaseSuggestions,
      activePurchaseOrders,
      inTransitPurchaseOrders,
      waitingDeliveryPurchaseOrders: Number(waitingDeliveryOrders || 0),
      delayedPurchaseOrders: Number(delayedPurchaseOrders || 0),
      todaySummary: {
        movementCount: Number(last24hActivity?.total || 0),
        last24hOperationCount: Number(last24hActivity?.total || 0),
        activityBreakdown: last24hActivity?.breakdown || {},
        stockIn: dailyMovements[dailyMovements.length - 1]?.in || 0,
        stockOut: dailyMovements[dailyMovements.length - 1]?.out || 0,
        criticalCount: criticalStockCount,
      },
      openTaskCount: Number(normalizedOpenTasks || 0),
    },
    inventory: inventory.map(stripLegacyInventoryFields),
    criticalItems: criticalItems.map(stripLegacyInventoryFields),
    smartAlerts,
    latestProducts: inventory.slice(0, 5).map(stripLegacyInventoryFields),
    activityFeed: recentMovements,
    categoryDistribution: (categoryDistribution || []).map((row) => ({
      id: row.id,
      name: row.name,
      productCount: Number(row.productCount || 0),
      stockQuantity: Number(row.stockQuantity || 0),
      quantity: Number(row.stockQuantity || 0),
    })),
    movementByType,
    dailyMovements,
    operationalDistribution: {
      notificationReadRate,
      pendingCriticalCount,
      userActionCount,
      totalNotifications: totalNotificationCount,
      readNotifications: readNotificationCount,
      unreadNotifications: Number(unreadNotifications || 0),
      pendingAccessRequests: Number(pendingAccessRequests || 0),
      openTasks: Number(normalizedOpenTasks || 0),
      criticalTasks: Number(normalizedCriticalTasks || 0),
      completedTasks: Number(normalizedCompletedTasks || 0),
      overdueTasks: Number(normalizedOverdueTasks || 0),
      approvalPendingOrders: Number(approvalPendingOrders || 0),
      criticalStockCount,
      expiryRiskCount: Number(expiryRiskCount || 0),
      taskStatusCounts,
      taskPriorityCounts,
    },
    customerOverview,
    topDecreasing: [],
    supplierPerformanceReport: supplierPerformanceReport.slice(0, 40),
    orderApprovalLeadReport: orderApprovalLeadReport
      .filter((row) => !isPurchaseOrderArchivedForDashboard(row))
      .map((row) => ({
      orderId: row.id,
      orderNumber: formatOrderReference(row.orderNumber, row.id),
      supplierName: row.supplier?.name || '-',
      currentStatus: row.status,
      createdAt: fromDateValue(row.createdAt),
      updatedAt: fromDateValue(row.updatedAt),
      completedAt: fromDateValue(row.completedAt),
      cancelledAt: isPurchaseOrderCancelledStatus(row.status) ? fromDateValue(getPurchaseOrderCancelledAt(row)) : null,
    })),
    goodsReceiptPerformanceReport: [{
      productId: 'summary',
      productName: 'Mal Kabul Özeti',
      gecikenGirisSayisi: Number(delayedPurchaseOrders || 0),
      bekleyenGirisSayisi: Number(waitingDeliveryOrders || 0),
      tamamlananGirisSayisi: Number(completedPurchaseOrders || 0),
    }],
    priceCatalogDiffReport: [],
    accessAuditReport: [
      { kategori: 'Genel', metrik: 'Bekleyen Talepler', deger: pendingAccessRequests },
      { kategori: 'Kullanıcı Bazlı İşlem Yoğunluğu', metrik: 'Son 24 Saat İşlem', deger: Number(last24hActivity?.total || 0) },
    ],
    notificationEngagementReport: [
      { kategori: 'Bildirim', metrik: 'Kritik Uyarı Sayısı', deger: criticalNotifications },
      { kategori: 'Bildirim', metrik: 'Okunma Oranı (%)', deger: notificationReadRate },
      { kategori: 'Görev', metrik: 'Açık Görevler', deger: normalizedOpenTasks },
      { kategori: 'Görev', metrik: 'Tamamlanan Görevler', deger: normalizedCompletedTasks },
      { kategori: 'Görev', metrik: 'Geciken Görevler', deger: normalizedOverdueTasks },
    ],
  };
};

const toTimestamp = (value) => {
  if (!value) return null;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
};

const minutesBetween = (fromValue, toValue) => {
  const from = toTimestamp(fromValue);
  const to = toTimestamp(toValue);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.round((to - from) / 60000);
};

const toHours = (minutes) => {
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return Number((minutes / 60).toFixed(2));
};

const formatDuration = (minutes) => {
  if (!Number.isFinite(minutes) || minutes < 0) return '-';
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${hours} sa ${remain} dk` : `${hours} sa`;
};

const findStatusAt = (order, statuses = []) => {
  const statusSet = new Set((Array.isArray(statuses) ? statuses : [statuses]).map((item) => String(item || '').trim()).filter(Boolean));
  if (!statusSet.size) return null;
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  const matched = history
    .filter((entry) => statusSet.has(String(entry?.status || '').trim()) && entry?.at)
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
  return matched[0]?.at || null;
};

const buildOrderApprovalLeadReport = (orders = [], supplierNameById = new Map()) => {
  const rows = (orders || []).map((order) => {
    const submittedForApprovalAt = findStatusAt(order, ['submitted_for_approval']) || order.createdAt;
    const approvedAt = findStatusAt(order, ['approved']) || order.approvedAt || null;
    const supplierNotifiedAt = findStatusAt(order, ['supplier_notified']) || order.supplierNotifiedAt || order.supplierNotifiedAtPlanned || null;
    const deliveredAt = findStatusAt(order, ['delivered', 'goods_receipt_pending', 'goods_receipt_completed']) || order.deliveredAt || order.deliveredAtPlanned || null;

    const approvalQueueMinutes = minutesBetween(order.createdAt, submittedForApprovalAt) ?? 0;
    const approvalMinutes = minutesBetween(submittedForApprovalAt, approvedAt);
    const supplierDispatchMinutes = minutesBetween(approvedAt, supplierNotifiedAt);
    const warehouseArrivalMinutes = minutesBetween(supplierNotifiedAt, deliveredAt);

    return {
      orderId: order.id,
      orderNumber: formatOrderReference(order.orderNumber, order.id),
      supplierName: supplierNameById.get(order.supplierId) || order.supplierName || order.supplierId || '-',
      onayaDusmeSuresiDakika: approvalQueueMinutes,
      onayaDusmeSuresi: formatDuration(approvalQueueMinutes),
      onaylanmaSuresiDakika: approvalMinutes,
      onaylanmaSuresi: formatDuration(approvalMinutes),
      tedarikciyeIletimSuresiDakika: supplierDispatchMinutes,
      tedarikciyeIletimSuresi: formatDuration(supplierDispatchMinutes),
      depoyaUlasmaSuresiDakika: warehouseArrivalMinutes,
      depoyaUlasmaSuresi: formatDuration(warehouseArrivalMinutes),
      createdAt: order.createdAt,
      currentStatus: normalizePurchaseOrderStatus(order.status || order.currentStatus, '-'),
    };
  });

  return rows.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
};

const buildGoodsReceiptPerformanceReport = (orders = [], orderItems = [], productNameById = new Map()) => {
  const now = Date.now();
  const itemsByOrderId = new Map();
  (orderItems || []).forEach((item) => {
    if (!item?.orderId) return;
    if (!itemsByOrderId.has(item.orderId)) itemsByOrderId.set(item.orderId, []);
    itemsByOrderId.get(item.orderId).push(item);
  });

  const productStats = new Map();
  let pendingEntryCount = 0;
  let delayedEntryCount = 0;
  const completionMinutesList = [];

  (orders || []).forEach((order) => {
    const normalizedStatus = normalizePurchaseOrderStatus(order?.status || order?.currentStatus, '');
    const isCancelled = CANCELLED_PURCHASE_ORDER_STATUSES.has(normalizedStatus);
    const isEntryCompleted = Boolean(order?.stockEntryCompleted || order?.stock_entry_completed || order?.stockBookedAt || order?.completedAt);
    const isPendingEntry = !isCancelled && !isEntryCompleted;
    const estimatedAtTs = toTimestamp(order?.estimatedDeliveryDate);
    const isDelayed = isPendingEntry && Number.isFinite(estimatedAtTs) && estimatedAtTs < now;

    if (isPendingEntry) pendingEntryCount += 1;
    if (isDelayed) delayedEntryCount += 1;

    const receiptStartAt = findStatusAt(order, ['goods_receipt_pending', 'goods_receipt_completed', 'delivered']) || order?.deliveredAt || order?.createdAt;
    const entryCompletedAt = findStatusAt(order, ['completed']) || order?.stockBookedAt || order?.completedAt || null;
    const completionMinutes = minutesBetween(receiptStartAt, entryCompletedAt);
    if (Number.isFinite(completionMinutes)) completionMinutesList.push(completionMinutes);

    const linkedItems = itemsByOrderId.get(order.id) || [];
    linkedItems.forEach((item) => {
      const productId = item?.productId || '-';
      const current = productStats.get(productId) || {
        productId,
        productName: productNameById.get(productId) || item?.productName || productId,
        bekleyenGirisSayisi: 0,
        urunBazliGirisYogunlugu: 0,
        gecikenGirisSayisi: 0,
        tamamlananKayitSayisi: 0,
        toplamTamamlamaDakikasi: 0,
      };

      const qty = Number(item?.quantity || 0);
      current.urunBazliGirisYogunlugu += qty > 0 ? qty : 0;
      if (isPendingEntry) current.bekleyenGirisSayisi += 1;
      if (isDelayed) current.gecikenGirisSayisi += 1;
      if (Number.isFinite(completionMinutes)) {
        current.tamamlananKayitSayisi += 1;
        current.toplamTamamlamaDakikasi += completionMinutes;
      }

      productStats.set(productId, current);
    });
  });

  const avgCompletionMinutes = completionMinutesList.length
    ? Math.round(completionMinutesList.reduce((sum, value) => sum + value, 0) / completionMinutesList.length)
    : 0;

  const rows = Array.from(productStats.values())
    .map((item) => ({
      productId: item.productId,
      productName: item.productName || '-',
      bekleyenGirisSayisi: item.bekleyenGirisSayisi,
      ortalamaGirisTamamlamaSaati: item.tamamlananKayitSayisi > 0
        ? Number((item.toplamTamamlamaDakikasi / item.tamamlananKayitSayisi / 60).toFixed(2))
        : null,
      urunBazliGirisYogunlugu: item.urunBazliGirisYogunlugu,
      gecikenGirisSayisi: item.gecikenGirisSayisi,
      genelBekleyenGirisSayisi: pendingEntryCount,
      genelOrtalamaGirisTamamlamaSaati: toHours(avgCompletionMinutes) || 0,
      genelGecikenGirisSayisi: delayedEntryCount,
    }))
    .sort((left, right) =>
      (right.bekleyenGirisSayisi - left.bekleyenGirisSayisi)
      || (right.urunBazliGirisYogunlugu - left.urunBazliGirisYogunlugu)
      || String(left.productName || '').localeCompare(String(right.productName || ''), 'tr')
    )
    .slice(0, 250);

  return rows;
};

const normalizeImportPrice = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  if (numeric > 1000) return Number((numeric / 10).toFixed(4));
  return numeric;
};

const buildPriceCatalogDiffReport = (catalogImports = [], supplierProducts = [], supplierNameById = new Map()) => {
  const statsBySupplier = new Map();
  const ensureStat = (supplierId) => {
    const key = String(supplierId || 'unknown');
    if (!statsBySupplier.has(key)) {
      statsBySupplier.set(key, {
        supplierId: key,
        supplierName: supplierNameById.get(key) || key || 'Bilinmeyen Tedarikçi',
        zamGelenUrunSayisi: 0,
        indirimeGirenUrunSayisi: 0,
        yeniUrunSayisi: 0,
        kaldirilanUrunSayisi: 0,
        karsilastirilanKayitSayisi: 0,
        toplamDegisimYuzdesi: 0,
      });
    }
    return statsBySupplier.get(key);
  };

  (catalogImports || []).forEach((catalogImport) => {
    const supplierId = catalogImport?.supplierId || 'unknown';
    const stat = ensureStat(supplierId);
    const rows = Array.isArray(catalogImport?.rows) ? catalogImport.rows : [];
    rows.forEach((row) => {
      const actionType = String(row?.actionType || '').toUpperCase();
      const classification = String(row?.classification || '').toLowerCase();
      const oldPrice = normalizeImportPrice(row?.original?.purchasePrice);
      const newPrice = normalizeImportPrice(row?.purchasePrice);

      if (Number.isFinite(oldPrice) && Number.isFinite(newPrice) && oldPrice > 0) {
        stat.karsilastirilanKayitSayisi += 1;
        const pct = ((newPrice - oldPrice) / oldPrice) * 100;
        stat.toplamDegisimYuzdesi += pct;
        if (pct > 0.01) stat.zamGelenUrunSayisi += 1;
        else if (pct < -0.01) stat.indirimeGirenUrunSayisi += 1;
      }

      if (actionType.includes('CREATE') || classification.includes('yeni')) {
        stat.yeniUrunSayisi += 1;
      }

      const removedByAction = actionType.includes('DELETE') || actionType.includes('REMOVE') || actionType.includes('DEACTIVATE');
      const removedByClassification = classification.includes('kaldır') || classification.includes('kaldir') || classification.includes('eksik') || classification.includes('missing');
      if (removedByAction || removedByClassification || Boolean(row?.isExcluded)) {
        stat.kaldirilanUrunSayisi += 1;
      }
    });
  });

  (supplierProducts || []).forEach((row) => {
    const stat = ensureStat(row?.supplierId || 'unknown');
    stat.supplierName = supplierNameById.get(stat.supplierId) || stat.supplierName;
  });

  const rows = Array.from(statsBySupplier.values())
    .map((item) => ({
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      zamGelenUrunSayisi: item.zamGelenUrunSayisi,
      indirimeGirenUrunSayisi: item.indirimeGirenUrunSayisi,
      yeniUrunSayisi: item.yeniUrunSayisi,
      kaldirilanUrunSayisi: item.kaldirilanUrunSayisi,
      karsilastirilanKayitSayisi: item.karsilastirilanKayitSayisi,
      tedarikciBazliFiyatDegisimOrani: item.karsilastirilanKayitSayisi > 0
        ? Number((item.toplamDegisimYuzdesi / item.karsilastirilanKayitSayisi).toFixed(2))
        : 0,
    }))
    .filter((item) =>
      item.karsilastirilanKayitSayisi > 0
      || item.yeniUrunSayisi > 0
      || item.kaldirilanUrunSayisi > 0
      || item.zamGelenUrunSayisi > 0
      || item.indirimeGirenUrunSayisi > 0
    )
    .sort((left, right) =>
      (right.karsilastirilanKayitSayisi - left.karsilastirilanKayitSayisi)
      || (right.yeniUrunSayisi - left.yeniUrunSayisi)
      || String(left.supplierName || '').localeCompare(String(right.supplierName || ''), 'tr')
    );

  return rows;
};

const buildPriceCatalogDiffReportFromPriceEvents = async ({ query = {}, supplierProducts = [], supplierNameById = new Map() } = {}) => {
  const tenantId = getActiveTenantId();
  const prisma = await getPrisma();
  const dateRange = parseDateRange(query);
  const aggregatedRows = await prisma.$queryRaw`
    SELECT
      COALESCE(p.supplier_id, 'unknown') AS "supplierId",
      COALESCE(s.name, 'Bilinmeyen Tedarikçi') AS "supplierName",
      COUNT(*) FILTER (
        WHERE e.previous_sale_price IS NOT NULL
          AND e.sale_price IS NOT NULL
          AND e.sale_price > e.previous_sale_price
      )::int AS "zamGelenUrunSayisi",
      COUNT(*) FILTER (
        WHERE e.previous_sale_price IS NOT NULL
          AND e.sale_price IS NOT NULL
          AND e.sale_price < e.previous_sale_price
      )::int AS "indirimeGirenUrunSayisi",
      COUNT(*) FILTER (
        WHERE e.previous_sale_price IS NOT NULL
          AND e.sale_price IS NOT NULL
          AND e.sale_price <> e.previous_sale_price
      )::int AS "karsilastirilanKayitSayisi",
      AVG(
        CASE
          WHEN e.previous_sale_price IS NOT NULL
            AND e.previous_sale_price > 0
            AND e.sale_price IS NOT NULL
          THEN ((e.sale_price - e.previous_sale_price) / e.previous_sale_price) * 100
          ELSE NULL
        END
      )::numeric AS "tedarikciBazliFiyatDegisimOrani"
    FROM product_price_events e
    LEFT JOIN products p ON p.id = e.product_id AND p.tenant_id = e.tenant_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.tenant_id = p.tenant_id
    WHERE e.tenant_id = ${tenantId}
      AND (${dateRange.startAt}::timestamp IS NULL OR e.created_at >= ${dateRange.startAt})
      AND (${dateRange.endAt}::timestamp IS NULL OR e.created_at <= ${dateRange.endAt})
    GROUP BY COALESCE(p.supplier_id, 'unknown'), COALESCE(s.name, 'Bilinmeyen Tedarikçi')
  `;

  const rowsBySupplier = new Map(
    (aggregatedRows || []).map((row) => {
      const supplierId = String(row.supplierId || 'unknown');
      return [supplierId, {
        supplierId,
        supplierName: row.supplierName || supplierNameById.get(supplierId) || 'Bilinmeyen Tedarikçi',
        zamGelenUrunSayisi: Number(row.zamGelenUrunSayisi || 0),
        indirimeGirenUrunSayisi: Number(row.indirimeGirenUrunSayisi || 0),
        yeniUrunSayisi: 0,
        kaldirilanUrunSayisi: 0,
        karsilastirilanKayitSayisi: Number(row.karsilastirilanKayitSayisi || 0),
        tedarikciBazliFiyatDegisimOrani: Number(toNumberValue(row.tedarikciBazliFiyatDegisimOrani).toFixed(2)),
      }];
    })
  );

  (Array.isArray(supplierProducts) ? supplierProducts : []).forEach((item) => {
    const supplierId = String(item?.supplierId || 'unknown');
    if (!rowsBySupplier.has(supplierId)) {
      rowsBySupplier.set(supplierId, {
        supplierId,
        supplierName: supplierNameById.get(supplierId) || supplierId || 'Bilinmeyen Tedarikçi',
        zamGelenUrunSayisi: 0,
        indirimeGirenUrunSayisi: 0,
        yeniUrunSayisi: 0,
        kaldirilanUrunSayisi: 0,
        karsilastirilanKayitSayisi: 0,
        tedarikciBazliFiyatDegisimOrani: 0,
      });
    }

    const row = rowsBySupplier.get(supplierId);
    if (hasDateRange(dateRange)) {
      if (isWithinDateRange(item?.createdAt, dateRange)) {
        row.yeniUrunSayisi += 1;
      }
      if (item?.isActive === false && isWithinDateRange(item?.updatedAt || item?.createdAt, dateRange)) {
        row.kaldirilanUrunSayisi += 1;
      }
      return;
    }

    if (item?.isActive === false) {
      row.kaldirilanUrunSayisi += 1;
    }
  });

  return Array.from(rowsBySupplier.values())
    .filter((item) =>
      item.karsilastirilanKayitSayisi > 0
      || item.zamGelenUrunSayisi > 0
      || item.indirimeGirenUrunSayisi > 0
      || item.yeniUrunSayisi > 0
      || item.kaldirilanUrunSayisi > 0
    )
    .sort((left, right) =>
      (right.karsilastirilanKayitSayisi - left.karsilastirilanKayitSayisi)
      || (right.zamGelenUrunSayisi - left.zamGelenUrunSayisi)
      || String(left.supplierName || '').localeCompare(String(right.supplierName || ''), 'tr')
    );
};

const buildAccessAuditReport = (accessRequests = [], accessAuditLogs = [], settings = {}, users = [], dateRange = {}) => {
  const rows = [];
  const userNameById = new Map((users || []).map((user) => [user.id, user.name || user.username || user.id]));

  const developerLogs = (Array.isArray(settings?.developerLogs) ? settings.developerLogs : [])
    .filter((log) => isWithinDateRange(log?.createdAt || log?.timestamp || log?.at, dateRange));
  const settingsChangeCounter = new Map();
  developerLogs.forEach((log) => {
    const endpoint = String(log?.endpoint || log?.action || '').toLowerCase();
    const method = String(log?.action || '').toUpperCase();
    const isSettingsFlow = endpoint.includes('/settings');
    const isMutating = method.includes('PUT') || method.includes('PATCH') || method.includes('POST') || method.includes('DELETE');
    if (!isSettingsFlow || !isMutating) return;
    const key = String(log?.endpoint || log?.action || 'Ayar güncellemesi');
    settingsChangeCounter.set(key, (settingsChangeCounter.get(key) || 0) + 1);
  });

  Array.from(settingsChangeCounter.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .forEach(([name, count]) => {
      rows.push({ kategori: 'En Sık Değişen Ayarlar', metrik: name, deger: count, detay: 'Ayar değişiklik işlemi' });
    });

  const permissionCounter = new Map();
  (accessRequests || []).forEach((request) => {
    const permission = String(request?.permission || 'Bilinmeyen Alan');
    permissionCounter.set(permission, (permissionCounter.get(permission) || 0) + 1);
  });
  Array.from(permissionCounter.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .forEach(([permission, count]) => {
      rows.push({ kategori: 'En Çok Talep Açılan Alanlar', metrik: permission, deger: count, detay: 'Açılan erişim talebi' });
    });

  const approvedCount = (accessRequests || []).filter((request) => request?.status === 'approved').length;
  const rejectedCount = (accessRequests || []).filter((request) => request?.status === 'rejected').length;
  const pendingCount = (accessRequests || []).filter((request) => request?.status === 'pending').length;
  rows.push({ kategori: 'Talep Sonuçları', metrik: 'Onaylanan Talepler', deger: approvedCount, detay: 'Toplam onaylanan erişim talebi' });
  rows.push({ kategori: 'Talep Sonuçları', metrik: 'Reddedilen Talepler', deger: rejectedCount, detay: 'Toplam reddedilen erişim talebi' });
  rows.push({ kategori: 'Talep Sonuçları', metrik: 'Bekleyen Talepler', deger: pendingCount, detay: 'Halen bekleyen erişim talebi' });

  const userOpsCounter = new Map();
  (accessAuditLogs || []).forEach((log) => {
    const actorId = String(log?.actorId || log?.userId || '').trim();
    if (!actorId) return;
    const actorName = userNameById.get(actorId) || actorId;
    userOpsCounter.set(actorName, (userOpsCounter.get(actorName) || 0) + 1);
  });
  developerLogs.forEach((log) => {
    const actorName = String(log?.userName || log?.userId || '').trim();
    if (!actorName) return;
    userOpsCounter.set(actorName, (userOpsCounter.get(actorName) || 0) + 1);
  });

  Array.from(userOpsCounter.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .forEach(([actorName, count]) => {
      rows.push({ kategori: 'Kullanıcı Bazlı İşlem Yoğunluğu', metrik: actorName, deger: count, detay: 'Toplam denetim kaydı' });
    });

  return rows;
};

const buildNotificationEngagementReport = (notifications = [], tasks = [], accessRequests = [], users = [], settings = {}) => {
  const rows = [];
  const typeCounter = new Map();
  const roleDepartmentAssignments = settings?.roleDepartmentAssignments && typeof settings.roleDepartmentAssignments === 'object'
    ? settings.roleDepartmentAssignments
    : {};
  const userById = new Map((users || []).map((item) => [item.id, item]));

  (notifications || []).forEach((notification) => {
    const type = String(notification?.type || 'system');
    typeCounter.set(type, (typeCounter.get(type) || 0) + 1);
  });

  const mostSent = Array.from(typeCounter.entries()).sort((left, right) => right[1] - left[1])[0] || ['-', 0];
  const totalNotifications = notifications.length;
  const readCount = notifications.filter((item) => item?.isRead).length;
  const readRate = totalNotifications > 0 ? Number(((readCount / totalNotifications) * 100).toFixed(2)) : 0;
  const archivedCount = notifications.filter((item) => {
    const normalizedType = String(item?.type || '').toLowerCase();
    const normalizedAction = String(item?.actionType || '').toLowerCase();
    const normalizedText = `${item?.title || ''} ${item?.message || ''}`.toLowerCase();
    return item?.isRead && (normalizedType.includes('archive') || normalizedAction.includes('archive') || normalizedText.includes('arşiv') || normalizedText.includes('arsiv'));
  }).length;
  const criticalAlertCount = notifications.filter((item) => {
    const severity = String(item?.severity || item?.priority || '').toLowerCase();
    const normalizedType = String(item?.type || '').toLowerCase();
    return severity === 'high' || normalizedType.includes('critical') || normalizedType.includes('overdue') || normalizedType.includes('sla');
  }).length;
  const pendingTaskCount = (tasks || []).filter((task) => !['done', 'completed', 'cancelled'].includes(String(task?.status || '').toLowerCase())).length;
  const pendingAccessCount = (accessRequests || []).filter((request) => request?.status === 'pending').length;

  rows.push({ kategori: 'Bildirim Özet', metrik: 'En Çok Gönderilen Bildirim Türü', deger: mostSent[1], detay: mostSent[0] || '-' });
  rows.push({ kategori: 'Bildirim Özet', metrik: 'Okunma Oranı (%)', deger: readRate, detay: `${readCount}/${totalNotifications}` });
  rows.push({ kategori: 'Bildirim Özet', metrik: 'Arşive Düşen Bildirimler', deger: archivedCount, detay: 'Okunmuş ve arşiv etiketli' });
  rows.push({ kategori: 'Bildirim Özet', metrik: 'Kritik Uyarı Sayısı', deger: criticalAlertCount, detay: `Bekleyen görev: ${pendingTaskCount} | Bekleyen talep: ${pendingAccessCount}` });

  const departmentCounter = new Map();
  (notifications || []).forEach((notification) => {
    const user = userById.get(notification?.userId);
    const roleKey = String(user?.role || '').trim();
    const departments = Array.isArray(roleDepartmentAssignments[roleKey]) && roleDepartmentAssignments[roleKey].length
      ? roleDepartmentAssignments[roleKey]
      : ['Atanmamış'];
    departments.forEach((department) => {
      departmentCounter.set(department, (departmentCounter.get(department) || 0) + 1);
    });
  });

  Array.from(departmentCounter.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .forEach(([department, count]) => {
      rows.push({ kategori: 'Departman Bazlı Bildirim Yoğunluğu', metrik: department, deger: count, detay: 'Toplam bildirim adedi' });
    });

  return rows;
};

const filterInventoryForReport = (inventory = [], query = {}) =>
  (Array.isArray(inventory) ? inventory : []).filter((item) => {
    const matchesSearch =
      !query.search ||
      [item.productName, item.sku, item.categoryName, item.supplierName]
        .filter(Boolean)
        .some((value) => includesSearchText(value, query.search));
    const matchesCategory = !query.categoryId || item.categoryId === query.categoryId;
    const matchesSupplier = !query.supplierId || item.supplierId === query.supplierId;
    const matchesStatus = !query.status || String(item.isActive) === String(query.status);
    const matchesCritical = query.criticalOnly === 'true' ? item.isCritical : true;

    return matchesSearch && matchesCategory && matchesSupplier && matchesStatus && matchesCritical;
  });

const buildReturnReportRows = (sales = [], query = {}) =>
  sortByNewest(
    (Array.isArray(sales) ? sales : []).filter((sale) => {
      if (sale?.type !== 'return') return false;
      const createdAt = new Date(sale.createdAt);
      const saleSearchPool = [
        sale.referenceNo,
        sale.originalSaleRef,
        sale.cashierName,
        sale.returnReason,
        normalizeDisplayText(sale.returnReasonDetail),
        sale.customer?.name,
        sale.customer?.address,
        ...(Array.isArray(sale.items) ? sale.items.map((item) => `${item?.name || ''} ${item?.barcode || ''} ${item?.sku || ''}`) : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !query.search || includesSearchText(saleSearchPool, query.search);
      const matchesFrom = !query.startDate || createdAt >= new Date(`${query.startDate}T00:00:00`);
      const matchesTo = !query.endDate || createdAt <= new Date(`${query.endDate}T23:59:59`);
      return matchesSearch && matchesFrom && matchesTo;
    })
  ).map((sale) => {
    const items = Array.isArray(sale.items) ? sale.items : [];
    const itemCount = items.reduce((sum, item) => sum + Number(item?.quantity || 0), 0);
    return {
      id: sale.id,
      referenceNo: sale.referenceNo,
      originalSaleRef: sale.originalSaleRef || '-',
      customerName: sale.customer?.name || '-',
      customerAddress: sale.customer?.address || '-',
      returnReason: sale.returnReason || '-',
      returnReasonLabel: formatReturnReasonLabel(sale.returnReason, '-'),
      returnReasonDetail: normalizeDisplayText(sale.returnReasonDetail) || '-',
      cashierName: sale.cashierName || '-',
      itemCount,
      totalAmount: Number(sale.totalAmount || 0),
      productsSummary: items.slice(0, 4).map((item) => item?.name).filter(Boolean).join(', '),
      createdAt: sale.createdAt,
    };
  });

const isSaleReturnRecord = (sale = {}) => String(sale.type || '').trim().toLowerCase() === 'return';

const isSaleCancelledRecord = (sale = {}) => {
  const status = String(sale.status || '').trim().toLowerCase();
  return ['cancelled', 'canceled', 'void', 'refunded'].includes(status);
};

const getSaleCustomerLabel = (sale = {}) => {
  const customer = sale.customer && typeof sale.customer === 'object' ? sale.customer : {};
  return normalizeDisplayText(customer.name || customer.fullName || customer.title || customer.phone || customer.id) || '-';
};

const getSaleItemProductKey = (item = {}) =>
  String(item.productId || item.product_id || item.barcode || item.sku || item.name || '').trim();

const getSaleItemQuantity = (item = {}) => Math.abs(toNumberValue(item.quantity || item.qty || item.count || 0));

const getSaleItemAmount = (item = {}) => {
  const directTotal = toNumberValue(item.totalPrice ?? item.totalAmount ?? item.lineTotal ?? item.amount);
  if (directTotal) return Math.abs(directTotal);
  return Math.abs(toNumberValue(item.unitPrice ?? item.price ?? 0) * getSaleItemQuantity(item));
};

const buildSalesReturnReportRows = async (query = {}) => {
  const dateRange = parseDateRange(query);
  const productId = String(query.productId || '').trim();
  const sales = config.dataStore === 'postgres'
    ? await salesRepo.findMany({
      ...(query.startDate ? { startDate: query.startDate } : {}),
      ...(query.endDate ? { endDate: query.endDate } : {}),
    }) || []
    : await salesRepo.getAll();
  const groups = new Map();

  (Array.isArray(sales) ? sales : []).forEach((sale) => {
    if (!sale || isSaleCancelledRecord(sale)) return;
    const createdAt = new Date(sale.createdAt);
    if (Number.isNaN(createdAt.getTime())) return;
    if (dateRange.startAt && createdAt < dateRange.startAt) return;
    if (dateRange.endAt && createdAt > dateRange.endAt) return;

    const isReturn = isSaleReturnRecord(sale);
    const items = Array.isArray(sale.items) ? sale.items : [];
    const dateKey = createdAt.toISOString().slice(0, 10);
    const referenceNo = normalizeDisplayText(sale.referenceNo || sale.originalSaleRef || sale.id) || '-';
    const customerLabel = getSaleCustomerLabel(sale);

    items.forEach((item) => {
      const itemProductId = String(item.productId || item.product_id || '').trim();
      if (productId && itemProductId !== productId) return;

      const productKey = getSaleItemProductKey(item);
      if (!productKey) return;
      const groupKey = `${productKey}__${dateKey}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          id: groupKey,
          productId: itemProductId || '',
          productName: normalizeDisplayText(item.name || item.productName) || '-',
          sku: normalizeDisplayText(item.sku) || '-',
          barcode: normalizeDisplayText(item.barcode) || '-',
          date: dateKey,
          soldQty: 0,
          salesAmount: 0,
          returnQty: 0,
          returnAmount: 0,
          saleRefs: new Set(),
          returnRefs: new Set(),
          customerRefs: new Set(),
          transactionCount: 0,
        });
      }

      const row = groups.get(groupKey);
      const qty = getSaleItemQuantity(item);
      const amount = getSaleItemAmount(item);
      if (isReturn) {
        row.returnQty += qty;
        row.returnAmount += amount;
        row.returnRefs.add(referenceNo);
      } else {
        row.soldQty += qty;
        row.salesAmount += amount;
        row.saleRefs.add(referenceNo);
      }
      row.customerRefs.add(customerLabel);
      row.transactionCount += 1;
    });
  });

  return Array.from(groups.values())
    .map((row) => ({
      ...row,
      soldQty: Number(row.soldQty.toFixed(2)),
      salesAmount: Number(row.salesAmount.toFixed(2)),
      returnQty: Number(row.returnQty.toFixed(2)),
      returnAmount: Number(row.returnAmount.toFixed(2)),
      netQty: Number((row.soldQty - row.returnQty).toFixed(2)),
      netAmount: Number((row.salesAmount - row.returnAmount).toFixed(2)),
      saleRefs: Array.from(row.saleRefs).filter(Boolean).join(', ') || '-',
      returnRefs: Array.from(row.returnRefs).filter(Boolean).join(', ') || '-',
      customerRefs: Array.from(row.customerRefs).filter((value) => value && value !== '-').join(', ') || '-',
    }))
    .sort((left, right) => new Date(right.date) - new Date(left.date) || String(left.productName).localeCompare(String(right.productName), 'tr'));
};

const buildCategoryReportRows = (categories = [], inventory = []) =>
  (Array.isArray(categories) ? categories : []).map((category) => {
    const items = inventory.filter((item) => item.categoryId === category.id);
    return {
      id: category.id,
      name: category.name,
      productCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      totalValue: items.reduce((sum, item) => sum + item.stockValue, 0),
    };
  });

const buildSupplierReportRows = (suppliers = [], inventory = []) =>
  (Array.isArray(suppliers) ? suppliers : []).map((supplier) => {
    const items = inventory.filter((item) => item.supplierId === supplier.id);
    return {
      id: supplier.id,
      name: supplier.name,
      productCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      totalValue: items.reduce((sum, item) => sum + item.stockValue, 0),
    };
  });

const getFilteredInventoryForReport = async (query = {}) => filterInventoryForReport(await buildInventory(), query);

const buildReportSectionRows = async (section, query = {}) => {
  const normalizedSection = normalizeReportSection(section);
  const dateRange = parseDateRange(query);

  if (normalizedSection === 'movement') {
    const movements = await movementRepo.getAll();
    return sortByNewest(applyMovementFilters(movements, query)).map(enrichReason).map(stripLegacyMovementFields);
  }

  if (normalizedSection === 'returns') {
    const sales = config.dataStore === 'postgres'
      ? await salesRepo.findMany({
        type: 'return',
        ...(query.startDate ? { startDate: query.startDate } : {}),
        ...(query.endDate ? { endDate: query.endDate } : {}),
      }) || []
      : await salesRepo.getAll();
    return buildReturnReportRows(sales, query);
  }

  if (normalizedSection === 'sales_returns') {
    return buildSalesReturnReportRows(query);
  }

  if (normalizedSection === 'category') {
    if (config.dataStore === 'postgres') {
      const inventory = await getPostgresInventoryRowsForReports(query);
      return getPostgresCategoryRowsForReports(inventory);
    }
    const [inventory, categories] = await Promise.all([
      getFilteredInventoryForReport(query),
      categoryRepo.getAll(),
    ]);
    return buildCategoryReportRows(categories, inventory);
  }

  if (normalizedSection === 'supplier') {
    if (config.dataStore === 'postgres') {
      const inventory = await getPostgresInventoryRowsForReports(query);
      return getPostgresSupplierRowsForReports(inventory);
    }
    const [inventory, suppliers] = await Promise.all([
      getFilteredInventoryForReport(query),
      supplierRepo.getAll(),
    ]);
    return buildSupplierReportRows(suppliers, inventory);
  }

  if (normalizedSection === 'inventory' || normalizedSection === 'critical' || normalizedSection === 'aging' || normalizedSection === 'expiry' || normalizedSection === 'margin') {
    const inventory = config.dataStore === 'postgres'
      ? await getPostgresInventoryRowsForReports(query)
      : (await getFilteredInventoryForReport(query)).map(stripLegacyInventoryFields);
    if (normalizedSection === 'critical') return inventory.filter((item) => item.isCritical);
    if (normalizedSection === 'aging') return buildStockAgingReport(inventory);
    if (normalizedSection === 'expiry') return buildExpiryRiskReport(inventory);
    if (normalizedSection === 'margin') return buildMarginReport(inventory);
    return inventory;
  }

  if (normalizedSection === 'supplier_performance') {
    if (config.dataStore === 'postgres') {
      const prisma = await getPrisma();
      const [inventory, suppliers] = await Promise.all([
        getPostgresInventoryRowsForReports(query),
        prisma.supplier.findMany({ select: { id: true, name: true } }),
      ]);
      return buildSupplierPerformanceReport(inventory, [], suppliers);
    }
    const [inventory, purchaseOrders] = await Promise.all([
      getFilteredInventoryForReport(query),
      purchaseOrderRepo.getAll(),
    ]);
    return buildSupplierPerformanceReport(inventory, filterRowsByDateRange(purchaseOrders || [], dateRange));
  }

  if (normalizedSection === 'order_approval_lead') {
    const [purchaseOrders, suppliers] = await Promise.all([
      purchaseOrderRepo.getAll(),
      supplierRepo.getAll(),
    ]);
    const supplierNameById = new Map((suppliers || []).map((item) => [item.id, item.name || item.id]));
    return buildOrderApprovalLeadReport(filterRowsByDateRange(purchaseOrders || [], dateRange), supplierNameById);
  }

  if (normalizedSection === 'goods_receipt_performance') {
    const [purchaseOrders, purchaseOrderItems, inventory] = await Promise.all([
      purchaseOrderRepo.getAll(),
      purchaseOrderItemRepo.getAll(),
      getFilteredInventoryForReport(query),
    ]);
    const productNameById = new Map((inventory || []).map((item) => [item.productId, item.productName]));
    return buildGoodsReceiptPerformanceReport(
      filterRowsByDateRange(purchaseOrders || [], dateRange),
      purchaseOrderItems || [],
      productNameById
    );
  }

  if (normalizedSection === 'price_catalog_diff') {
    const [catalogImports, supplierProducts, suppliers] = await Promise.all([
      catalogImportRepo.getAll(),
      supplierProductRepo.getAll(),
      supplierRepo.getAll(),
    ]);
    const supplierNameById = new Map((suppliers || []).map((item) => [item.id, item.name || item.id]));
    const filteredCatalogImports = filterRowsByDateRange(
      catalogImports || [],
      dateRange,
      (item) => item?.uploadedAt || item?.validityStart || item?.createdAt
    );
    const catalogImportPriceDiffReport = buildPriceCatalogDiffReport(filteredCatalogImports, supplierProducts || [], supplierNameById);
    if (catalogImportPriceDiffReport.length > 0) {
      return catalogImportPriceDiffReport;
    }

    if (config.dataStore === 'postgres') {
      return buildPriceCatalogDiffReportFromPriceEvents({ query, supplierProducts, supplierNameById });
    }

    return [];
  }

  if (normalizedSection === 'access_audit') {
    const [accessRequests, accessAuditLogs, settings, users] = await Promise.all([
      accessRequestRepo.getAll(),
      accessAuditLogRepo.getAll(),
      settingsRepo.getSettings(),
      userRepo.getAll(),
    ]);
    return buildAccessAuditReport(
      filterRowsByDateRange(accessRequests || [], dateRange),
      filterRowsByDateRange(accessAuditLogs || [], dateRange),
      settings || {},
      users || [],
      dateRange
    );
  }

  if (normalizedSection === 'notification_engagement') {
    const [notifications, tasks, accessRequests, users, settings] = await Promise.all([
      notificationRepo.getAll(),
      taskRepo.getAll(),
      accessRequestRepo.getAll(),
      userRepo.getAll(),
      settingsRepo.getSettings(),
    ]);
    return buildNotificationEngagementReport(
      filterRowsByDateRange(notifications || [], dateRange),
      filterRowsByDateRange(tasks || [], dateRange),
      filterRowsByDateRange(accessRequests || [], dateRange),
      users || [],
      settings || {}
    );
  }

  return null;
};

const buildDailyMovements = (movements) => {
  const now = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days.map((date) => {
    const dayMovements = movements.filter((m) => m.createdAt?.slice(0, 10) === date);
    return {
      date,
      in: dayMovements.filter((m) => m.type === 'IN').reduce((s, m) => s + m.qty, 0),
      out: dayMovements.filter((m) => m.type === 'OUT').reduce((s, m) => s + m.qty, 0),
    };
  });
};

const buildTopDecreasing = (movements, inventory) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentOut = movements.filter((m) => m.type === 'OUT' && new Date(m.createdAt) >= sevenDaysAgo);
  const productMap = {};
  for (const m of recentOut) {
    productMap[m.productId] = (productMap[m.productId] || 0) + m.qty;
  }
  return Object.entries(productMap)
    .map(([productId, totalOut]) => {
      const inv = inventory.find((i) => i.productId === productId);
      return { productId, productName: inv?.productName || '-', sku: inv?.sku || '-', totalOut, currentStock: inv?.quantity || 0 };
    })
    .sort((a, b) => b.totalOut - a.totalOut)
    .slice(0, 5);
};

const buildTodaySummary = (movements, inventory) => {
  const today = new Date().toISOString().slice(0, 10);
  const todayMovements = movements.filter((m) => m.createdAt?.slice(0, 10) === today);
  return {
    stockIn: todayMovements.filter((m) => m.type === 'IN').reduce((s, m) => s + m.qty, 0),
    stockOut: todayMovements.filter((m) => m.type === 'OUT').reduce((s, m) => s + m.qty, 0),
    criticalCount: inventory.filter((i) => i.isCritical).length,
    movementCount: todayMovements.length,
  };
};

export const reportService = {
  async getPricingAnalysis(query = {}) {
    const [summary, rows] = await Promise.all([
      pricingAnalysisService.getSummary(query),
      pricingAnalysisService.getRows({ ...query, forceRefresh: undefined }),
    ]);
    return {
      ...summary,
      rows: rows.items,
      items: rows.items,
      pagination: rows.pagination,
      rowFilters: rows.filters,
      sort: rows.sort,
      sections: {
        lazy: true,
        fastSellingProducts: [],
        slowAndExpiryRiskProducts: [],
        dynamicDiscountSuggestions: [],
        stockRunoutAnalysis: [],
        automaticOrderSuggestions: [],
        riskScorePanel: [],
      },
    };
  },

  async getPricingAnalysisSummary(query = {}) {
    return pricingAnalysisService.getSummary(query);
  },

  async getPricingAnalysisRows(query = {}) {
    return pricingAnalysisService.getRows(query);
  },

  async getPricingAnalysisDetail(productId, query = {}) {
    return pricingAnalysisService.getDetail(productId, query);
  },

  async calculateSellPriceRecommendation(payload = {}) {
    return pricingAnalysisService.calculateSellPrice(payload);
  },

  async approveSellPriceRecommendation(payload = {}, userId = null) {
    return pricingAnalysisService.approveSellPrice(payload, userId);
  },

  async listRecentPriceActions(query = {}) {
    return pricingAnalysisService.listRecentPriceActions({ limit: Number(query.limit || 3) });
  },

  async applyBulkPriceUpdate(payload = {}, user = {}) {
    return pricingAnalysisService.applyBulkPriceUpdate(payload, user);
  },

  async applyTemporaryPriceAction(payload = {}, user = {}) {
    return pricingAnalysisService.applyTemporaryPriceAction(payload, user);
  },

  async skipPricingDecision(payload = {}, user = {}) {
    return pricingAnalysisService.skipPricingDecision(payload, user);
  },

  async rollbackPriceAction(actionId, user = {}) {
    return pricingAnalysisService.rollbackPriceAction(actionId, user);
  },

  async getDashboardSummary() {
    const tenantContext = getTenantContext();
    const tenantId = tenantContext.tenantId;
    const storeId = tenantContext.storeId || MAIN_STORE_ID;
    if (!tenantId) {
      throw new AppError(403, 'Tenant context bulunamadı.');
    }

    if (config.dataStore === 'postgres') {
      const now = Date.now();
      const cacheKey = `${tenantId}_${storeId}`;
      const cached = dashboardSummaryCaches.get(cacheKey);
      if (cached && now - cached.createdAt < DASHBOARD_CACHE_TTL_MS) {
        return {
          ...cached.data,
          cache: { hit: true, ttlMs: DASHBOARD_CACHE_TTL_MS },
        };
      }

      const data = await buildFastDashboardReport(tenantId);
      dashboardSummaryCaches.set(cacheKey, { createdAt: now, data });
      return {
        ...data,
        cache: { hit: false, ttlMs: DASHBOARD_CACHE_TTL_MS },
      };
    }

    const [inventory, categories, suppliers, users, movements, settings, sales, purchaseSuggestions, purchaseOrders] = await Promise.all([
      buildInventory(),
      categoryRepo.getAll(),
      supplierRepo.getAll(),
      userRepo.getAll(),
      movementRepo.getAll(),
      settingsRepo.getSettings(),
      salesRepo.getAll(),
      purchaseSuggestionRepo.getAll(),
      purchaseOrderRepo.getAll(),
    ]);
    const safeSettings = settings || {};

    const today = new Date().toISOString().slice(0, 10);
    const previousDayDate = new Date();
    previousDayDate.setDate(previousDayDate.getDate() - 1);
    const previousDay = previousDayDate.toISOString().slice(0, 10);
    const todaySales = sales.filter((sale) => sale?.type === 'sale' && sale?.createdAt?.slice(0, 10) === today);
    const previousDaySales = sales.filter((sale) => sale?.type === 'sale' && sale?.createdAt?.slice(0, 10) === previousDay);
    const todaySalesRevenue = todaySales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0);
    const todaySalesCount = todaySales.length;
    const todaySoldItemCount = todaySales.reduce((sum, sale) => {
      const items = Array.isArray(sale.items) ? sale.items : [];
      return sum + items.reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0);
    }, 0);
    const previousDaySalesRevenue = previousDaySales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0);
    const previousDaySalesCount = previousDaySales.length;

    const pendingPurchaseSuggestions = purchaseSuggestions.filter((item) => item.status === 'pending').length;
    const activePurchaseOrders = purchaseOrders.filter((item) => isPurchaseOrderOpenStatus(item.status)).length;
    const inTransitPurchaseOrders = purchaseOrders.filter((item) => normalizePurchaseOrderStatus(item.status, '') === 'in_transit').length;

    const criticalItems = inventory.filter((item) => item.isCritical).sort((left, right) => left.quantity - right.quantity);
    const categoryDistribution = categories.map((category) => {
      const items = inventory.filter((item) => item.categoryId === category.id);
      return {
        id: category.id,
        name: category.name,
        isActive: category.isActive,
        productCount: items.length,
        stockQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
        quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      };
    });

    const movementByType = ['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER'].map((type) => {
      const rows = movements.filter((item) => item.type === type);
      return {
        type,
        count: rows.length,
        totalQty: rows.reduce((sum, item) => sum + item.qty, 0),
      };
    });

    const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const nowDate = new Date();
    const currentDay = DAY_NAMES[nowDate.getDay()];
    const closedDays = Array.isArray(safeSettings.closedDays) ? safeSettings.closedDays : [];
    const openingTime = safeSettings.openingTime || '10:00';
    const closingTime = safeSettings.closingTime || '22:00';
    const weeklySchedule = Array.isArray(safeSettings.weeklySchedule) ? safeSettings.weeklySchedule : [];
    const specialDays = Array.isArray(safeSettings.specialDays) ? safeSettings.specialDays : [];
    const holidayMode = Boolean(safeSettings.holidayMode);

    const toLocalIsoDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const activeSpecialDay = specialDays.find((item) => item?.date === toLocalIsoDate(nowDate));
    const activeWeekdaySchedule = weeklySchedule.find((item) => item?.dayKey === currentDay);

    const effectiveIsClosed = holidayMode
      || Boolean(activeSpecialDay?.isClosed)
      || (!activeSpecialDay && (Boolean(activeWeekdaySchedule?.isClosed) || closedDays.includes(currentDay)));

    const effectiveOpeningTime = activeSpecialDay?.opensAt || activeWeekdaySchedule?.opensAt || openingTime;
    const effectiveClosingTime = activeSpecialDay?.closesAt || activeWeekdaySchedule?.closesAt || closingTime;

    const toMinutes = (value) => {
      if (typeof value !== 'string') return null;
      const match = value.match(/^(\d{2}):(\d{2})$/);
      if (!match) return null;
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
      return (hours * 60) + minutes;
    };

    const nowMinutes = (nowDate.getHours() * 60) + nowDate.getMinutes();
    const openMinutes = toMinutes(effectiveOpeningTime);
    const closeMinutes = toMinutes(effectiveClosingTime);

    let isStoreOpen = false;
    if (!effectiveIsClosed && openMinutes !== null && closeMinutes !== null && openMinutes !== closeMinutes) {
      if (openMinutes < closeMinutes) {
        isStoreOpen = nowMinutes >= openMinutes && nowMinutes < closeMinutes;
      } else {
        // Overnight shift support, e.g. 10:00-02:30.
        isStoreOpen = nowMinutes >= openMinutes || nowMinutes < closeMinutes;
      }
    }

    return {
      settingsSnapshot: {
        systemName: safeSettings.systemName,
        businessName: safeSettings.businessName,
        currency: safeSettings.currency,
        dashboardMessage: safeSettings.dashboardMessage,
        storeName: safeSettings.storeName,
        timezone: safeSettings.timezone || 'Europe/Istanbul',
        openingTime: effectiveOpeningTime,
        closingTime: effectiveClosingTime,
        closedDays,
        holidayMode,
        weeklySchedule,
        specialDays,
        isStoreOpen,
      },
      overview: {
        totalProducts: inventory.length,
        totalCategories: categories.length,
        totalSuppliers: suppliers.length,
        totalUsers: users.length,
        activeUsers: users.filter((user) => user.isActive).length,
        totalWarehouseStockQuantity: inventory.reduce((sum, item) => sum + (item.warehouseStock || 0), 0),
        totalShelfStockQuantity: inventory.reduce((sum, item) => sum + (item.shelfStock || 0), 0),
        totalStockQuantity: inventory.reduce((sum, item) => sum + item.quantity, 0),
        totalStockValue: inventory.reduce((sum, item) => sum + item.stockValue, 0),
        lowStockCount: inventory.filter((item) => item.stockAlert === 'critical' || item.stockAlert === 'low').length,
        criticalCount: criticalItems.length,
        todaySalesRevenue,
        todaySalesCount,
        todaySoldItemCount,
        previousDaySalesRevenue,
        previousDaySalesCount,
        salesComparisons: {
          todaySalesCount: buildKpiComparison({ current: todaySalesCount, previous: previousDaySalesCount }),
          todaySalesRevenue: buildKpiComparison({ current: todaySalesRevenue, previous: previousDaySalesRevenue }),
        },
        pendingPurchaseSuggestions,
        activePurchaseOrders,
        inTransitPurchaseOrders,
      },
      criticalItems,
      latestProducts: [...inventory].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).slice(0, 5),
      recentMovements: sortByNewest(movements).map(enrichReason).slice(0, 8),
      categoryDistribution,
      movementByType,
      dailyMovements: buildDailyMovements(movements),
      topDecreasing: buildTopDecreasing(movements, inventory),
      todaySummary: buildTodaySummary(movements, inventory),
    };
  },

  async getSummaryReport(query = {}) {
    const tenantId = getTenantContext().tenantId;
    if (!tenantId) {
      throw new AppError(403, 'Tenant context bulunamadı.');
    }

    if (config.dataStore === 'postgres' && !parseDetailsFlag(query.includeDetails)) {
      return buildFastDashboardReport(tenantId);
    }

    const [
      inventory,
      categories,
      suppliers,
      movements,
      settings,
      sales,
      purchaseOrders,
      purchaseOrderItems,
      accessRequests,
      accessAuditLogs,
      notifications,
      tasks,
      users,
      catalogImports,
      supplierProducts,
    ] = await Promise.all([
      buildInventory(),
      categoryRepo.getAll(),
      supplierRepo.getAll(),
      movementRepo.getAll(),
      settingsRepo.getSettings(),
      salesRepo.getAll(),
      purchaseOrderRepo.getAll(),
      purchaseOrderItemRepo.getAll(),
      accessRequestRepo.getAll(),
      accessAuditLogRepo.getAll(),
      notificationRepo.getAll(),
      taskRepo.getAll(),
      userRepo.getAll(),
      catalogImportRepo.getAll(),
      supplierProductRepo.getAll(),
    ]);
    const safeSettings = settings || {};
    const dateRange = parseDateRange(query);

    const filteredInventory = inventory.filter((item) => {
      const matchesSearch =
        !query.search ||
        [item.productName, item.sku, item.categoryName, item.supplierName]
          .filter(Boolean)
          .some((value) => includesSearchText(value, query.search));
      const matchesCategory = !query.categoryId || item.categoryId === query.categoryId;
      const matchesSupplier = !query.supplierId || item.supplierId === query.supplierId;
      const matchesStatus = !query.status || String(item.isActive) === String(query.status);
      const matchesCritical = query.criticalOnly === 'true' ? item.isCritical : true;

      return matchesSearch && matchesCategory && matchesSupplier && matchesStatus && matchesCritical;
    });

    const filteredMovements = sortByNewest(applyMovementFilters(movements, query)).map(enrichReason).map(stripLegacyMovementFields);

    const filteredReturns = sortByNewest(
      (Array.isArray(sales) ? sales : []).filter((sale) => {
        if (sale?.type !== 'return') return false;
        const createdAt = new Date(sale.createdAt);
        const saleSearchPool = [
          sale.referenceNo,
          sale.originalSaleRef,
          sale.cashierName,
          sale.returnReason,
          normalizeDisplayText(sale.returnReasonDetail),
          sale.customer?.name,
          sale.customer?.address,
          ...(Array.isArray(sale.items) ? sale.items.map((item) => `${item?.name || ''} ${item?.barcode || ''} ${item?.sku || ''}`) : []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        const matchesSearch = !query.search || includesSearchText(saleSearchPool, query.search);
        const matchesFrom = !query.startDate || createdAt >= new Date(`${query.startDate}T00:00:00`);
        const matchesTo = !query.endDate || createdAt <= new Date(`${query.endDate}T23:59:59`);
        return matchesSearch && matchesFrom && matchesTo;
      })
    ).map((sale) => {
      const items = Array.isArray(sale.items) ? sale.items : [];
      const itemCount = items.reduce((sum, item) => sum + Number(item?.quantity || 0), 0);
      return {
        id: sale.id,
        referenceNo: sale.referenceNo,
        originalSaleRef: sale.originalSaleRef || '-',
        customerName: sale.customer?.name || '-',
        customerAddress: sale.customer?.address || '-',
        returnReason: sale.returnReason || '-',
        returnReasonLabel: formatReturnReasonLabel(sale.returnReason, '-'),
        returnReasonDetail: normalizeDisplayText(sale.returnReasonDetail) || '-',
        cashierName: sale.cashierName || '-',
        itemCount,
        totalAmount: Number(sale.totalAmount || 0),
        productsSummary: items.slice(0, 4).map((item) => item?.name).filter(Boolean).join(', '),
        createdAt: sale.createdAt,
      };
    });

    const categoryReport = categories.map((category) => {
      const items = filteredInventory.filter((item) => item.categoryId === category.id);
      const uniqueEtikets = Array.from(new Set(
        items.map((item) => String(item.etiket || '').trim())
             .filter(Boolean)
             .flatMap((val) => val.split(',').map(v => v.trim()))
             .filter(Boolean)
      )).join(', ');
      return {
        id: category.id,
        name: category.name || 'Genel',
        productCount: items.length,
        totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
        totalValue: items.reduce((sum, item) => sum + item.stockValue, 0),
        subCategories: uniqueEtikets || 'Etiket yok',
      };
    });

    const supplierReport = suppliers.map((supplier) => {
      const items = filteredInventory.filter((item) => item.supplierId === supplier.id);
      return {
        id: supplier.id,
        name: supplier.name,
        productCount: items.length,
        totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
        totalValue: items.reduce((sum, item) => sum + item.stockValue, 0),
      };
    });
    const filteredPurchaseOrders = filterRowsByDateRange(purchaseOrders || [], dateRange);
    const filteredAccessRequests = filterRowsByDateRange(accessRequests || [], dateRange);
    const filteredAccessAuditLogs = filterRowsByDateRange(accessAuditLogs || [], dateRange);
    const filteredNotifications = filterRowsByDateRange(notifications || [], dateRange);
    const filteredTasks = filterRowsByDateRange(tasks || [], dateRange);
    const filteredCatalogImports = filterRowsByDateRange(
      catalogImports || [],
      dateRange,
      (item) => item?.uploadedAt || item?.validityStart || item?.createdAt
    );

    const stockAgingReport = buildStockAgingReport(filteredInventory);
    const expiryRiskReport = buildExpiryRiskReport(filteredInventory);
    const marginReport = buildMarginReport(filteredInventory);
    const supplierPerformanceReport = await buildSupplierPerformanceReport(filteredInventory, filteredPurchaseOrders);
    const supplierNameById = new Map((suppliers || []).map((item) => [item.id, item.name || item.id]));
    const productNameById = new Map((filteredInventory || []).map((item) => [item.productId, item.productName]));

    const orderApprovalLeadReport = buildOrderApprovalLeadReport(filteredPurchaseOrders, supplierNameById);
    const goodsReceiptPerformanceReport = buildGoodsReceiptPerformanceReport(
      filteredPurchaseOrders,
      purchaseOrderItems || [],
      productNameById
    );
    const catalogImportPriceDiffReport = buildPriceCatalogDiffReport(filteredCatalogImports, supplierProducts || [], supplierNameById);
    const priceCatalogDiffReport = catalogImportPriceDiffReport.length > 0
      ? catalogImportPriceDiffReport
      : config.dataStore === 'postgres'
        ? await buildPriceCatalogDiffReportFromPriceEvents({ query, supplierProducts, supplierNameById })
        : [];
    const accessAuditReport = buildAccessAuditReport(filteredAccessRequests, filteredAccessAuditLogs, safeSettings, users || [], dateRange);
    const notificationEngagementReport = buildNotificationEngagementReport(
      filteredNotifications,
      filteredTasks,
      filteredAccessRequests,
      users || [],
      safeSettings
    );

    return {
      generatedAt: new Date().toISOString(),
      currency: safeSettings.currency,
      overview: {
        totalStockQuantity: filteredInventory.reduce((sum, item) => sum + item.quantity, 0),
        totalStockValue: filteredInventory.reduce((sum, item) => sum + item.stockValue, 0),
        totalPotentialRevenue: filteredInventory.reduce((sum, item) => sum + item.potentialRevenue, 0),
        movementCount: filteredMovements.length,
      },
      inventory: filteredInventory.map(stripLegacyInventoryFields),
      criticalItems: filteredInventory.filter((item) => item.isCritical).map(stripLegacyInventoryFields),
      movementReport: filteredMovements,
      returnReport: filteredReturns,
      categoryReport,
      supplierReport,
      stockAgingReport,
      expiryRiskReport,
      marginReport,
      supplierPerformanceReport,
      orderApprovalLeadReport,
      goodsReceiptPerformanceReport,
      priceCatalogDiffReport,
      accessAuditReport,
      notificationEngagementReport,
    };
  },

  async getReportSection(section, query = {}) {
    const tenantId = getTenantContext().tenantId;
    if (!tenantId) {
      throw new AppError(403, 'Tenant context bulunamadı.');
    }

    const normalizedSection = normalizeReportSection(section);
    if (config.dataStore === 'postgres' && normalizedSection === 'inventory') {
      return getFastInventorySection(query);
    }
    const rows = await buildReportSectionRows(normalizedSection, query);
    if (!rows) {
      return null;
    }

    return {
      section: normalizedSection,
      generatedAt: new Date().toISOString(),
      ...paginateReportRows(rows, query),
    };
  },

  async globalSearch(query) {
    const term = normalizeSearchText(query);
    if (!term || term.length < 2) return { products: [], categories: [], suppliers: [] };

    const [products, categories, suppliers, stocks] = await Promise.all([
      productRepo.getAll(),
      categoryRepo.getAll(),
      supplierRepo.getAll(),
      stockRepo.getAll(),
    ]);

    const matchedProducts = products
      .filter((p) => [p.name, p.sku, p.description].filter(Boolean).some((v) => includesSearchText(v, term)))
      .slice(0, 8)
      .map((p) => {
        const stock = stocks.find((s) => s.productId === p.id);
        const cat = categories.find((c) => c.id === p.categoryId);
        return { id: p.id, name: p.name, sku: p.sku, categoryName: cat?.name || '-', currentStock: stock?.quantity || 0, type: 'product' };
      });

    const matchedCategories = categories
      .filter((c) => includesSearchText(c.name, term))
      .slice(0, 5)
      .map((c) => ({ id: c.id, name: c.name, type: 'category' }));

    const matchedSuppliers = suppliers
      .filter((s) => [s.name, s.contactPerson, s.email].filter(Boolean).some((v) => includesSearchText(v, term)))
      .slice(0, 5)
      .map((s) => ({ id: s.id, name: s.name, type: 'supplier' }));

    return { products: matchedProducts, categories: matchedCategories, suppliers: matchedSuppliers };
  },

  async getLastStockUpdate() {
    if (config.dataStore === 'postgres') {
      const prisma = await getPrisma();
      const latest = await withPostgresQueryLogging('GET /api/reports/last-update', () => prisma.stockMovement.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      }));
      return fromDateValue(latest?.createdAt) || null;
    }

    const movements = await movementRepo.getAll();
    if (movements.length === 0) return null;
    const sorted = [...movements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sorted[0].createdAt;
  },

  async getSectionExportData(section, query = {}) {
    const tenantId = getTenantContext().tenantId;
    if (!tenantId) {
      throw new AppError(403, 'Tenant context bulunamadı.');
    }

    const normalizedSection = String(section || '').trim().toLowerCase();
    const targetSection = normalizeReportSection(normalizedSection);
    const sectionRows = await buildReportSectionRows(targetSection, query);

    if (!sectionRows) {
      return null;
    }

    const report = {
      inventory: [],
      criticalItems: [],
      categoryReport: [],
      supplierReport: [],
      movementReport: [],
      returnReport: [],
      stockAgingReport: [],
      expiryRiskReport: [],
      marginReport: [],
      supplierPerformanceReport: [],
      orderApprovalLeadReport: [],
      goodsReceiptPerformanceReport: [],
      priceCatalogDiffReport: [],
      accessAuditReport: [],
      notificationEngagementReport: [],
      salesReturnReport: [],
    };
    const sectionReportKey = {
      inventory: 'inventory',
      critical: 'criticalItems',
      category: 'categoryReport',
      supplier: 'supplierReport',
      movement: 'movementReport',
      returns: 'returnReport',
      sales_returns: 'salesReturnReport',
      aging: 'stockAgingReport',
      expiry: 'expiryRiskReport',
      margin: 'marginReport',
      supplier_performance: 'supplierPerformanceReport',
      order_approval_lead: 'orderApprovalLeadReport',
      goods_receipt_performance: 'goodsReceiptPerformanceReport',
      price_catalog_diff: 'priceCatalogDiffReport',
      access_audit: 'accessAuditReport',
      notification_engagement: 'notificationEngagementReport',
    };
    if (sectionReportKey[targetSection]) {
      report[sectionReportKey[targetSection]] = sectionRows;
    }

    const buildSection = ({ fileName, sheetName, columns, rows }) => ({
      fileName,
      sheetName,
      columns,
      rows,
    });

    const asColumns = (entries) => entries.map(([key, header]) => ({ key, header }));
    const directSections = {
      inventory: buildSection({
        fileName: 'urun-raporu.xlsx',
        sheetName: 'Ürün Raporu',
        columns: asColumns([
          ['productId', 'ID'], ['productName', 'Ürün Adı'], ['sku', 'SKU'], ['barcode', 'Barkod'],
          ['categoryId', 'Kategori ID'], ['categoryName', 'Kategori Adı'], ['categoryCode', 'Kategori Kodu'],
          ['supplierId', 'Tedarikçi ID'], ['supplierName', 'Tedarikçi Adı'],
          ['purchasePrice', 'Alış Fiyatı'], ['salePrice', 'Satış Fiyatı'], ['unit', 'Birim'],
          ['criticalStock', 'Kritik Stok'], ['maxStock', 'Maks Stok'], ['totalStock', 'Toplam Stok'],
          ['warehouseStock', 'Depo Stok'], ['shelfStock', 'Reyon Stok'], ['expiryDate', 'Son Kullanma'],
          ['sectionId', 'Reyon ID'], ['sectionName', 'Reyon Adı'], ['sectionNumber', 'Reyon No'],
          ['shelfSide', 'Raf Tarafı'], ['shelfNo', 'Raf No'], ['shelfLevel', 'Raf Seviye'], ['shelfCode', 'Raf Kodu'],
          ['isActive', 'Durum'], ['linkedSupplierCount', 'Bağlı Tedarikçi Sayısı'], ['eslLinkedCount', 'Bağlı ESL Sayısı'],
          ['stockValue', 'Stok Değeri'], ['createdAt', 'Oluşturulma Tarihi'], ['updatedAt', 'Güncellenme Tarihi'],
          ['lastPriceChangeAt', 'FDT'], ['batchSummary', 'Parti No'], ['storageTypeLabel', 'Saklama Tipi'],
        ]),
        rows: sectionRows.map((item) => ({
          ...item,
          isActive: item.isActive !== false ? 'Aktif' : 'Pasif',
        })),
      }),
      critical: buildSection({
        fileName: 'kritik-stok-raporu.xlsx',
        sheetName: 'Kritik Stok',
        columns: asColumns([
          ['sku', 'SKU'], ['productName', 'Ürün Adı'], ['categoryName', 'Kategori'], ['supplierName', 'Tedarikçi'],
          ['totalStock', 'Toplam Stok'], ['criticalStock', 'Kritik Eşik'], ['stockValue', 'Stok Değeri'], ['isActive', 'Durum'],
        ]),
        rows: sectionRows.map((item) => ({ ...item, isActive: item.isActive !== false ? 'Aktif' : 'Pasif' })),
      }),
      category: buildSection({
        fileName: 'kategori-raporu.xlsx',
        sheetName: 'Kategori Raporu',
        columns: asColumns([['name', 'Kategori'], ['productCount', 'Ürün Çeşidi'], ['totalQuantity', 'Toplam Stok'], ['totalValue', 'Stok Değeri']]),
        rows: sectionRows,
      }),
      supplier: buildSection({
        fileName: 'tedarikci-raporu.xlsx',
        sheetName: 'Tedarikçi Raporu',
        columns: asColumns([['name', 'Tedarikçi'], ['productCount', 'Ürün Çeşidi'], ['totalQuantity', 'Toplam Stok'], ['totalValue', 'Stok Değeri']]),
        rows: sectionRows,
      }),
      movement: buildSection({
        fileName: 'stok-hareket-raporu.xlsx',
        sheetName: 'Stok Hareket',
        columns: asColumns([
          ['referenceNo', 'Referans'], ['productName', 'Ürün Adı'], ['type', 'Tip'], ['reasonLabel', 'Sebep'],
          ['routeLabel', 'Konum'], ['qty', 'Miktar'], ['previousQuantity', 'Önceki'], ['nextQuantity', 'Sonraki'],
          ['userName', 'Kullanıcı'], ['createdAt', 'Tarih'],
        ]),
        rows: sectionRows,
      }),
      returns: buildSection({
        fileName: 'iade-raporu.xlsx',
        sheetName: 'İade Raporu',
        columns: asColumns([
          ['referenceNo', 'Referans'], ['originalSaleRef', 'Orijinal Fiş'], ['customerName', 'Müşteri Ad Soyad'],
          ['customerAddress', 'Adres'], ['returnReasonLabel', 'İade Nedeni'], ['returnReasonDetail', 'Neden Detay'],
          ['productsSummary', 'İade Edilen Ürün'], ['itemCount', 'Toplam Ürün Adedi'], ['totalAmount', 'Tutar'],
          ['cashierName', 'Kasiyer'], ['createdAt', 'Tarih'],
        ]),
        rows: sectionRows,
      }),
      sales_returns: buildSection({
        fileName: 'satis-ve-iade-raporu.xlsx',
        sheetName: 'Satış ve İade',
        columns: asColumns([
          ['date', 'Tarih'], ['productName', 'Ürün Adı'], ['sku', 'SKU'], ['barcode', 'Barkod'],
          ['soldQty', 'Toplam Satış Adedi'], ['salesAmount', 'Toplam Satış Tutarı'],
          ['returnQty', 'Toplam İade Adedi'], ['returnAmount', 'Toplam İade Tutarı'],
          ['netQty', 'Net Satış Adedi'], ['netAmount', 'Net Satış Tutarı'],
          ['saleRefs', 'Satış Referansları'], ['returnRefs', 'İade Referansları'],
          ['customerRefs', 'Müşteri/Sipariş Referansı'], ['transactionCount', 'İşlem Sayısı'],
        ]),
        rows: sectionRows,
      }),
      aging: buildSection({
        fileName: 'stok-yaslandirma-raporu.xlsx',
        sheetName: 'Stok Yaşlandırma',
        columns: asColumns([
          ['sku', 'SKU'], ['productName', 'Ürün Adı'], ['categoryName', 'Kategori'], ['totalStock', 'Stok Miktarı'],
          ['stockValue', 'Stok Değeri'], ['daysInStock', 'Stokta Bekleme Gün'], ['agingBucket', 'Yaşlandırma'], ['updatedAt', 'Son Hareket/Güncelleme'],
        ]),
        rows: sectionRows,
      }),
      expiry: buildSection({
        fileName: 'skt-risk-raporu.xlsx',
        sheetName: 'SKT Risk',
        columns: asColumns([
          ['sku', 'SKU'], ['productName', 'Ürün Adı'], ['categoryName', 'Kategori'], ['totalStock', 'Toplam Stok'],
          ['expiryDate', 'Son Kullanma'], ['daysToExpiry', 'SKT Kalan Gün'], ['riskLevel', 'Risk'], ['potentialWriteOffValue', 'Potansiyel Zayi Tutarı'],
        ]),
        rows: sectionRows.map((item) => ({ ...item, riskLevel: RISK_LEVEL_LABELS[item.riskLevel] || item.riskLevel })),
      }),
      margin: buildSection({
        fileName: 'kar-marj-erozyon-raporu.xlsx',
        sheetName: 'Marj Erozyon',
        columns: asColumns([
          ['sku', 'SKU'], ['productName', 'Ürün Adı'], ['categoryName', 'Kategori'], ['supplierName', 'Tedarikçi'],
          ['purchasePrice', 'Alış Fiyatı'], ['salePrice', 'Satış Fiyatı'], ['unitMargin', 'Birim Marj'], ['marginPct', 'Marj %'],
          ['categoryAvgMarginPct', 'Kategori Ort. Marj %'], ['erosionPct', 'Erozyon %'], ['erosionRisk', 'Erozyon Riski'], ['stockMarginPotential', 'Stok Marj Potansiyeli'],
        ]),
        rows: sectionRows.map((item) => ({ ...item, erosionRisk: RISK_LEVEL_LABELS[item.erosionRisk] || item.erosionRisk })),
      }),
      supplier_performance: buildSection({
        fileName: 'tedarikci-performans-skor-karti.xlsx',
        sheetName: 'Tedarikçi Performans',
        columns: asColumns([
          ['supplierName', 'Tedarikçi'], ['productCount', 'Ürün Çeşidi'], ['activeProductCount', 'Aktif Ürün'], ['criticalProductCount', 'Kritik Ürün'],
          ['totalStock', 'Toplam Stok'], ['totalStockValue', 'Toplam Stok Değeri'], ['avgMarginPct', 'Ortalama Marj %'],
          ['orderCount', 'Sipariş Sayısı'], ['delayedOrderCount', 'Geciken Sipariş'], ['onTimeScore', 'Zamanında Teslim Skoru'],
          ['supplierScore', 'Tedarikçi Skoru'], ['riskLevel', 'Risk'],
        ]),
        rows: sectionRows.map((item) => ({ ...item, riskLevel: RISK_LEVEL_LABELS[item.riskLevel] || item.riskLevel })),
      }),
      order_approval_lead: buildSection({
        fileName: 'siparis-onay-sureleri-raporu.xlsx',
        sheetName: 'Sipariş Onay Süreleri',
        columns: asColumns([
          ['orderNumber', 'Sipariş No'], ['supplierName', 'Tedarikçi'], ['onayaDusmeSuresi', 'Onaya Düşme Süresi'],
          ['onaylanmaSuresi', 'Onaylanma Süresi'], ['tedarikciyeIletimSuresi', 'Tedarikçiye İletim Süresi'],
          ['depoyaUlasmaSuresi', 'Depoya Ulaşma Süresi'], ['currentStatus', 'Durum'], ['createdAt', 'Oluşturma Tarihi'],
        ]),
        rows: sectionRows,
      }),
      goods_receipt_performance: buildSection({
        fileName: 'mal-kabul-ve-giris-performans-raporu.xlsx',
        sheetName: 'Mal Kabul Giriş',
        columns: asColumns([
          ['productName', 'Ürün'], ['bekleyenGirisSayisi', 'Bekleyen Giriş Sayısı'], ['ortalamaGirisTamamlamaSaati', 'Ort. Tamamlama (Saat)'],
          ['urunBazliGirisYogunlugu', 'Ürün Bazlı Giriş Yoğunluğu'], ['gecikenGirisSayisi', 'Geciken Giriş'],
          ['genelBekleyenGirisSayisi', 'Genel Bekleyen Giriş'], ['genelOrtalamaGirisTamamlamaSaati', 'Genel Ort. Tamamlama (Saat)'],
          ['genelGecikenGirisSayisi', 'Genel Geciken Giriş'],
        ]),
        rows: sectionRows,
      }),
      price_catalog_diff: buildSection({
        fileName: 'fiyat-degisim-ve-katalog-fark-raporu.xlsx',
        sheetName: 'Fiyat Katalog Fark',
        columns: asColumns([
          ['supplierName', 'Tedarikçi'], ['zamGelenUrunSayisi', 'Zam Gelen Ürün Sayısı'], ['indirimeGirenUrunSayisi', 'İndirime Giren Ürün Sayısı'],
          ['yeniUrunSayisi', 'Yeni Ürün Sayısı'], ['kaldirilanUrunSayisi', 'Kaldırılan Ürün Sayısı'],
          ['tedarikciBazliFiyatDegisimOrani', 'Fiyat Değişim Oranı (%)'], ['karsilastirilanKayitSayisi', 'Karşılaştırılan Kayıt'],
        ]),
        rows: sectionRows,
      }),
      access_audit: buildSection({
        fileName: 'erisim-ve-islem-denetim-raporu.xlsx',
        sheetName: 'Erişim Denetim',
        columns: asColumns([['kategori', 'Kategori'], ['metrik', 'Metrik'], ['deger', 'Değer'], ['detay', 'Detay']]),
        rows: sectionRows,
      }),
      notification_engagement: buildSection({
        fileName: 'bildirim-etkilesim-ve-operasyon-uyari-raporu.xlsx',
        sheetName: 'Bildirim Etkileşim',
        columns: asColumns([['kategori', 'Kategori'], ['metrik', 'Metrik'], ['deger', 'Değer'], ['detay', 'Detay']]),
        rows: sectionRows,
      }),
    };

    if (directSections[targetSection]) {
      return directSections[targetSection];
    }

    const sections = {
      inventory: buildSection({
        fileName: 'urun-raporu.xlsx',
        sheetName: 'Ürün Raporu',
        columns: [
          { key: 'id', header: 'ID' },
          { key: 'urunAdi', header: 'Ürün Adı' },
          { key: 'sku', header: 'SKU' },
          { key: 'barkod', header: 'Barkod' },
          { key: 'kategoriId', header: 'Kategori ID' },
          { key: 'kategoriAdi', header: 'Kategori Adı' },
          { key: 'kategoriKodu', header: 'Kategori Kodu' },
          { key: 'tedarikciId', header: 'Tedarikçi ID' },
          { key: 'tedarikciAdi', header: 'Tedarikçi Adı' },
          { key: 'alisFiyati', header: 'Alış Fiyatı' },
          { key: 'satisFiyati', header: 'Satış Fiyatı' },
          { key: 'fiyat', header: 'Fiyat' },
          { key: 'birim', header: 'Birim' },
          { key: 'kritikStok', header: 'Kritik Stok' },
          { key: 'maxStok', header: 'Maks Stok' },
          { key: 'toplamStok', header: 'Toplam Stok' },
          { key: 'depoStok', header: 'Depo Stok' },
          { key: 'reyonStok', header: 'Reyon Stok' },
          { key: 'skt', header: 'SKT' },
          { key: 'expiryDate', header: 'Son Kullanma' },
          { key: 'sectionId', header: 'Reyon ID' },
          { key: 'reyonAdi', header: 'Reyon Adı' },
          { key: 'reyonNo', header: 'Reyon No' },
          { key: 'shelfSide', header: 'Raf Tarafı' },
          { key: 'shelfNo', header: 'Raf No' },
          { key: 'shelfLevel', header: 'Raf Seviye' },
          { key: 'shelfCode', header: 'Raf Kodu' },
          { key: 'aktif', header: 'Aktif' },
          { key: 'linkedSupplierCount', header: 'Bağlı Tedarikçi Sayısı' },
          { key: 'eslLinkedCount', header: 'Bağlı ESL Sayısı' },
          { key: 'supplierMappingNames', header: 'Bağlı Tedarikçiler' },
          { key: 'linkedEslCodes', header: 'Bağlı ESL Kodları' },
          { key: 'createdAt', header: 'Oluşturulma Tarihi' },
          { key: 'updatedAt', header: 'Güncellenme Tarihi' },
          { key: 'priceUpdatedAt', header: 'Fiyat Güncellenme Tarihi' },
        ],
        rows: report.inventory.map((item) => ({
          id: item.productId,
          urunAdi: item.urunAdi,
          sku: item.sku,
          barkod: item.barkod,
          kategoriId: item.kategoriId,
          kategoriAdi: item.kategoriAdi,
          kategoriKodu: item.kategoriKodu,
          tedarikciId: item.tedarikciId,
          tedarikciAdi: item.tedarikciAdi,
          alisFiyati: item.alisFiyati,
          satisFiyati: item.satisFiyati,
          fiyat: item.fiyat,
          birim: item.birim,
          kritikStok: item.kritikStok,
          maxStok: item.maxStok,
          toplamStok: item.toplamStok,
          depoStok: item.depoStok,
          reyonStok: item.reyonStok,
          skt: item.skt,
          expiryDate: item.expiryDate,
          sectionId: item.sectionId,
          reyonAdi: item.reyonAdi,
          reyonNo: item.reyonNo,
          shelfSide: item.shelfSide,
          shelfNo: item.shelfNo,
          shelfLevel: item.shelfLevel,
          shelfCode: item.shelfCode,
          aktif: item.aktif,
          linkedSupplierCount: item.linkedSupplierCount,
          eslLinkedCount: item.eslLinkedCount,
          supplierMappingNames: Array.isArray(item.supplierMappings) ? item.supplierMappings.map((map) => map?.supplierName || map?.supplierId).filter(Boolean).join(', ') : '',
          linkedEslCodes: Array.isArray(item.linkedEslDevices) ? item.linkedEslDevices.map((device) => device?.code || device?.id).filter(Boolean).join(', ') : '',
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          priceUpdatedAt: item.priceUpdatedAt,
        })),
      }),
      critical: buildSection({
        fileName: 'kritik-stok-raporu.xlsx',
        sheetName: 'Kritik Stok',
        columns: [
          { key: 'sku', header: 'SKU' },
          { key: 'urunAdi', header: 'Ürün Adı' },
          { key: 'kategori', header: 'Kategori' },
          { key: 'tedarikci', header: 'Tedarikçi' },
          { key: 'toplamStok', header: 'Toplam Stok' },
          { key: 'kritikEsik', header: 'Kritik Eşik' },
          { key: 'stokDegeri', header: 'Stok Değeri' },
          { key: 'durum', header: 'Durum' },
        ],
        rows: report.criticalItems.map((item) => ({
          sku: item.sku,
          urunAdi: item.productName,
          kategori: item.categoryName,
          tedarikci: item.supplierName,
          toplamStok: item.quantity,
          kritikEsik: item.criticalStock,
          stokDegeri: item.stockValue,
          durum: item.isActive ? 'Aktif' : 'Pasif',
        })),
      }),
      category: buildSection({
        fileName: 'kategori-raporu.xlsx',
        sheetName: 'Kategori Raporu',
        columns: [
          { key: 'kategori', header: 'Kategori' },
          { key: 'altKategori', header: 'Alt Kategoriler / Etiketler' },
          { key: 'urunCesidi', header: 'Ürün Çeşidi' },
          { key: 'toplamStok', header: 'Toplam Stok' },
          { key: 'stokDegeri', header: 'Stok Değeri' },
        ],
        rows: report.categoryReport.map((item) => ({
          kategori: item.name,
          altKategori: item.subCategories,
          urunCesidi: item.productCount,
          toplamStok: item.totalQuantity,
          stokDegeri: item.totalValue,
        })),
      }),
      supplier: buildSection({
        fileName: 'tedarikci-raporu.xlsx',
        sheetName: 'Tedarikçi Raporu',
        columns: [
          { key: 'tedarikci', header: 'Tedarikçi' },
          { key: 'urunCesidi', header: 'Ürün Çeşidi' },
          { key: 'toplamStok', header: 'Toplam Stok' },
          { key: 'stokDegeri', header: 'Stok Değeri' },
        ],
        rows: report.supplierReport.map((item) => ({
          tedarikci: item.name,
          urunCesidi: item.productCount,
          toplamStok: item.totalQuantity,
          stokDegeri: item.totalValue,
        })),
      }),
      movement: buildSection({
        fileName: 'stok-hareket-raporu.xlsx',
        sheetName: 'Stok Hareket',
        columns: [
          { key: 'referans', header: 'Referans' },
          { key: 'urunAdi', header: 'Ürün Adı' },
          { key: 'tip', header: 'Tip' },
          { key: 'sebep', header: 'Sebep' },
          { key: 'konum', header: 'Konum' },
          { key: 'miktar', header: 'Miktar' },
          { key: 'onceki', header: 'Önceki' },
          { key: 'sonraki', header: 'Sonraki' },
          { key: 'kullanici', header: 'Kullanıcı' },
          { key: 'tarih', header: 'Tarih' },
        ],
        rows: report.movementReport.map((item) => ({
          referans: item.referenceNo,
          urunAdi: item.productName,
          tip: MOVEMENT_TYPE_LABELS[item.type] || item.type,
          sebep: item.reasonLabel || item.reason,
          konum: item.routeLabel || item.locationLabel || '-',
          miktar: item.qty,
          onceki: item.previousQuantity,
          sonraki: item.nextQuantity,
          kullanici: item.userName,
          tarih: item.createdAt,
        })),
      }),
      returns: buildSection({
        fileName: 'iade-raporu.xlsx',
        sheetName: 'İade Raporu',
        columns: [
          { key: 'referans', header: 'Referans' },
          { key: 'orijinalFis', header: 'Orijinal Fiş' },
          { key: 'musteriAdSoyad', header: 'Müşteri Ad Soyad' },
          { key: 'adres', header: 'Adres' },
          { key: 'iadeNedeni', header: 'İade Nedeni' },
          { key: 'nedenDetay', header: 'Neden Detay' },
          { key: 'iadeEdilenUrun', header: 'İade Edilen Ürün' },
          { key: 'toplamUrunAdedi', header: 'Toplam Ürün Adedi' },
          { key: 'tutar', header: 'Tutar' },
          { key: 'kasiyer', header: 'Kasiyer' },
          { key: 'tarih', header: 'Tarih' },
        ],
        rows: report.returnReport.map((item) => ({
          referans: item.referenceNo,
          orijinalFis: item.originalSaleRef,
          musteriAdSoyad: item.customerName,
          adres: item.customerAddress,
          iadeNedeni: item.returnReasonLabel || formatReturnReasonLabel(item.returnReason, '-'),
          nedenDetay: item.returnReasonDetail,
          iadeEdilenUrun: item.productsSummary,
          toplamUrunAdedi: item.itemCount,
          tutar: item.totalAmount,
          kasiyer: item.cashierName,
          tarih: item.createdAt,
        })),
      }),
      aging: buildSection({
        fileName: 'stok-yaslandirma-raporu.xlsx',
        sheetName: 'Stok Yaşlandırma',
        columns: [
          { key: 'sku', header: 'SKU' },
          { key: 'urunAdi', header: 'Ürün Adı' },
          { key: 'kategori', header: 'Kategori' },
          { key: 'stokMiktari', header: 'Stok Miktarı' },
          { key: 'stokDegeri', header: 'Stok Değeri' },
          { key: 'stoktaBeklemeGun', header: 'Stokta Bekleme Gün' },
          { key: 'yaslandirma', header: 'Yaşlandırma' },
          { key: 'sonHareket', header: 'Son Hareket/Güncelleme' },
        ],
        rows: report.stockAgingReport.map((item) => ({
          sku: item.sku,
          urunAdi: item.productName,
          kategori: item.categoryName,
          stokMiktari: item.totalStock,
          stokDegeri: item.stockValue,
          stoktaBeklemeGun: item.daysInStock,
          yaslandirma: item.agingBucket,
          sonHareket: item.updatedAt,
        })),
      }),
      expiry: buildSection({
        fileName: 'skt-risk-raporu.xlsx',
        sheetName: 'SKT Risk',
        columns: [
          { key: 'sku', header: 'SKU' },
          { key: 'urunAdi', header: 'Ürün Adı' },
          { key: 'kategori', header: 'Kategori' },
          { key: 'toplamStok', header: 'Toplam Stok' },
          { key: 'sonKullanma', header: 'Son Kullanma' },
          { key: 'sktKalanGun', header: 'SKT Kalan Gün' },
          { key: 'risk', header: 'Risk' },
          { key: 'potansiyelZayiTutari', header: 'Potansiyel Zayi Tutarı' },
        ],
        rows: report.expiryRiskReport.map((item) => ({
          sku: item.sku,
          urunAdi: item.productName,
          kategori: item.categoryName,
          toplamStok: item.totalStock,
          sonKullanma: item.expiryDate,
          sktKalanGun: item.daysToExpiry,
          risk: RISK_LEVEL_LABELS[item.riskLevel] || item.riskLevel,
          potansiyelZayiTutari: item.potentialWriteOffValue,
        })),
      }),
      margin: buildSection({
        fileName: 'kar-marj-erozyon-raporu.xlsx',
        sheetName: 'Marj Erozyon',
        columns: [
          { key: 'sku', header: 'SKU' },
          { key: 'urunAdi', header: 'Ürün Adı' },
          { key: 'kategori', header: 'Kategori' },
          { key: 'tedarikci', header: 'Tedarikçi' },
          { key: 'alisFiyati', header: 'Alış Fiyatı' },
          { key: 'satisFiyati', header: 'Satış Fiyatı' },
          { key: 'birimMarj', header: 'Birim Marj' },
          { key: 'marjYuzde', header: 'Marj %' },
          { key: 'kategoriOrtMarjYuzde', header: 'Kategori Ort. Marj %' },
          { key: 'erozyonYuzde', header: 'Erozyon %' },
          { key: 'erozyonRiski', header: 'Erozyon Riski' },
          { key: 'stokMarjPotansiyeli', header: 'Stok Marj Potansiyeli' },
        ],
        rows: report.marginReport.map((item) => ({
          sku: item.sku,
          urunAdi: item.productName,
          kategori: item.categoryName,
          tedarikci: item.supplierName,
          alisFiyati: item.purchasePrice,
          satisFiyati: item.salePrice,
          birimMarj: item.unitMargin,
          marjYuzde: item.marginPct,
          kategoriOrtMarjYuzde: item.categoryAvgMarginPct,
          erozyonYuzde: item.erosionPct,
          erozyonRiski: RISK_LEVEL_LABELS[item.erosionRisk] || item.erosionRisk,
          stokMarjPotansiyeli: item.stockMarginPotential,
        })),
      }),
      supplier_performance: buildSection({
        fileName: 'tedarikci-performans-skor-karti.xlsx',
        sheetName: 'Tedarikçi Performans',
        columns: [
          { key: 'tedarikci', header: 'Tedarikçi' },
          { key: 'urunCesidi', header: 'Ürün Çeşidi' },
          { key: 'aktifUrun', header: 'Aktif Ürün' },
          { key: 'kritikUrun', header: 'Kritik Ürün' },
          { key: 'toplamStok', header: 'Toplam Stok' },
          { key: 'toplamStokDegeri', header: 'Toplam Stok Değeri' },
          { key: 'ortalamaMarjYuzde', header: 'Ortalama Marj %' },
          { key: 'siparisSayisi', header: 'Sipariş Sayısı' },
          { key: 'gecikenSiparis', header: 'Geciken Sipariş' },
          { key: 'zamanindaTeslimSkoru', header: 'Zamanında Teslim Skoru' },
          { key: 'tedarikciSkoru', header: 'Tedarikçi Skoru' },
          { key: 'risk', header: 'Risk' },
        ],
        rows: report.supplierPerformanceReport.map((item) => ({
          tedarikci: item.supplierName,
          urunCesidi: item.productCount,
          aktifUrun: item.activeProductCount,
          kritikUrun: item.criticalProductCount,
          toplamStok: item.totalStock,
          toplamStokDegeri: item.totalStockValue,
          ortalamaMarjYuzde: item.avgMarginPct,
          siparisSayisi: item.orderCount,
          gecikenSiparis: item.delayedOrderCount,
          zamanindaTeslimSkoru: item.onTimeScore,
          tedarikciSkoru: item.supplierScore,
          risk: RISK_LEVEL_LABELS[item.riskLevel] || item.riskLevel,
        })),
      }),
      order_approval_lead: buildSection({
        fileName: 'siparis-onay-sureleri-raporu.xlsx',
        sheetName: 'Sipariş Onay Süreleri',
        columns: [
          { key: 'siparisNo', header: 'Sipariş No' },
          { key: 'tedarikci', header: 'Tedarikçi' },
          { key: 'onayaDusme', header: 'Onaya Düşme Süresi' },
          { key: 'onaylanma', header: 'Onaylanma Süresi' },
          { key: 'tedarikciIletim', header: 'Tedarikçiye İletim Süresi' },
          { key: 'depoyaUlasma', header: 'Depoya Ulaşma Süresi' },
          { key: 'durum', header: 'Durum' },
          { key: 'olusturmaTarihi', header: 'Oluşturma Tarihi' },
        ],
        rows: report.orderApprovalLeadReport.map((item) => ({
          siparisNo: item.orderNumber,
          tedarikci: item.supplierName,
          onayaDusme: item.onayaDusmeSuresi,
          onaylanma: item.onaylanmaSuresi,
          tedarikciIletim: item.tedarikciyeIletimSuresi,
          depoyaUlasma: item.depoyaUlasmaSuresi,
          durum: item.currentStatus,
          olusturmaTarihi: item.createdAt,
        })),
      }),
      goods_receipt_performance: buildSection({
        fileName: 'mal-kabul-ve-giris-performans-raporu.xlsx',
        sheetName: 'Mal Kabul Giriş',
        columns: [
          { key: 'urun', header: 'Ürün' },
          { key: 'bekleyen', header: 'Bekleyen Giriş Sayısı' },
          { key: 'ortalamaSaat', header: 'Ort. Tamamlama (Saat)' },
          { key: 'yogunluk', header: 'Ürün Bazlı Giriş Yoğunluğu' },
          { key: 'geciken', header: 'Geciken Giriş' },
          { key: 'genelBekleyen', header: 'Genel Bekleyen Giriş' },
          { key: 'genelOrtalama', header: 'Genel Ort. Tamamlama (Saat)' },
          { key: 'genelGeciken', header: 'Genel Geciken Giriş' },
        ],
        rows: report.goodsReceiptPerformanceReport.map((item) => ({
          urun: item.productName,
          bekleyen: item.bekleyenGirisSayisi,
          ortalamaSaat: item.ortalamaGirisTamamlamaSaati,
          yogunluk: item.urunBazliGirisYogunlugu,
          geciken: item.gecikenGirisSayisi,
          genelBekleyen: item.genelBekleyenGirisSayisi,
          genelOrtalama: item.genelOrtalamaGirisTamamlamaSaati,
          genelGeciken: item.genelGecikenGirisSayisi,
        })),
      }),
      price_catalog_diff: buildSection({
        fileName: 'fiyat-degisim-ve-katalog-fark-raporu.xlsx',
        sheetName: 'Fiyat Katalog Fark',
        columns: [
          { key: 'tedarikci', header: 'Tedarikçi' },
          { key: 'zam', header: 'Zam Gelen Ürün Sayısı' },
          { key: 'indirim', header: 'İndirime Giren Ürün Sayısı' },
          { key: 'yeni', header: 'Yeni Ürün Sayısı' },
          { key: 'kaldirilan', header: 'Kaldırılan Ürün Sayısı' },
          { key: 'degisimOrani', header: 'Fiyat Degisim Orani (%)' },
          { key: 'karsilastirma', header: 'Karşılaştırılan Kayıt' },
        ],
        rows: report.priceCatalogDiffReport.map((item) => ({
          tedarikci: item.supplierName,
          zam: item.zamGelenUrunSayisi,
          indirim: item.indirimeGirenUrunSayisi,
          yeni: item.yeniUrunSayisi,
          kaldirilan: item.kaldirilanUrunSayisi,
          degisimOrani: item.tedarikciBazliFiyatDegisimOrani,
          karsilastirma: item.karsilastirilanKayitSayisi,
        })),
      }),
      access_audit: buildSection({
        fileName: 'erisim-ve-islem-denetim-raporu.xlsx',
        sheetName: 'Erişim Denetim',
        columns: [
          { key: 'kategori', header: 'Kategori' },
          { key: 'metrik', header: 'Metrik' },
          { key: 'deger', header: 'Değer' },
          { key: 'detay', header: 'Detay' },
        ],
        rows: report.accessAuditReport.map((item) => ({
          kategori: item.kategori,
          metrik: item.metrik,
          deger: item.deger,
          detay: item.detay,
        })),
      }),
      notification_engagement: buildSection({
        fileName: 'bildirim-etkilesim-ve-operasyon-uyari-raporu.xlsx',
        sheetName: 'Bildirim Etkileşim',
        columns: [
          { key: 'kategori', header: 'Kategori' },
          { key: 'metrik', header: 'Metrik' },
          { key: 'deger', header: 'Değer' },
          { key: 'detay', header: 'Detay' },
        ],
        rows: report.notificationEngagementReport.map((item) => ({
          kategori: item.kategori,
          metrik: item.metrik,
          deger: item.deger,
          detay: item.detay,
        })),
      }),
    };

    const target = sections[targetSection];
    if (!target) {
      return null;
    }

    return target;
  },
};

export const __reportServiceInternals = {
  buildDashboardSmartAlerts,
  isPurchaseOrderOpenDeliveryOverdue,
};
