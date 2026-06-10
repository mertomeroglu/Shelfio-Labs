import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  CalendarDays,
  Truck,
  Info,
  MoreHorizontal,
  ClipboardList,
  Clock3,
  BarChart3,
  PackageCheck,
} from 'lucide-react';
import { ResponsiveContainer, BarChart as RBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip } from 'recharts';
import './PurchaseSuggestions.css';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import FilterBar from '../../components/FilterBar.jsx';
import FormModal from '../../components/FormModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Toast from '../../components/Toast.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { formatNumber } from '../../services/formatters.js';
import { procurementService } from '../../services/procurementService.js';
import { productService } from '../../services/productService.js';
import { supplierService } from '../../services/supplierService.js';
import {
  PRESET_FILTERS,
  applyPresetToFilters,
  buildRecommendationExplanation,
  buildSuggestionQuantity,
  classifyStockoutRisk,
  estimateDaysToStockout,
  estimateStockoutDate,
  formatConfidenceScore,
  getAverageDailySales,
  getLeadTimeDays,
  groupRecommendationsBySupplier,
  resolveTrendDirection,
  toggleAllSelectedRows,
  toggleSelectedRow,
} from './utils/purchaseSuggestionsUtils.js';
import { usePurchaseSuggestionActions } from './hooks/usePurchaseSuggestionActions.js';
import {
  MinimalPaginationControls,
  PaginationControls,
} from './components/PurchaseSuggestionPagination.jsx';

const normalizeMoneyInput = (value) => String(value ?? '').replace(',', '.');

const parseMoneyInput = (value, fallback = 0) => {
  const normalized = normalizeMoneyInput(value).trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const initialFilters = {
  search: '',
  status: '',
  riskLevel: '',
  supplierId: '',
  preset: '',
};

const initialGenerationOptions = {
  mode: 'critical',
  roundingStrategy: 'auto',
  safetyDays: 3,
  coverageDays: 0,
  categoryId: '',
  campaignType: '',
};

const initialEditForm = {
  supplierId: '',
  suggestedQty: '',
  unitPrice: '',
};

const initialBulkEditForm = {
  mode: 'multiply',
  value: '1',
};

const TABLE_PAGE_SIZE = 7;
const PURCHASE_SUGGESTION_HANDOFF_STORAGE_KEY = 'shelfio.purchaseSuggestions.handoffs.v1';
const SERVER_PAGE_SIZE = TABLE_PAGE_SIZE;

const toUserFacingOperationError = (error, fallback = 'İşlem tamamlanamadı. Lütfen tekrar deneyin.') => {
  const raw = String(error.message || '').trim();
  if (!raw) return fallback;
  const technicalPattern = /\b(api|backend|payload|stack|json|http|sql|prisma|fetch|network|undefined|null|exception|trace|debug|server)\b/i;
  if (technicalPattern.test(raw)) return fallback;
  return raw;
};

const riskTone = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

const riskLabel = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
};

const statusTone = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  converted: 'success',
  cancelled: 'danger',
  expired: 'neutral',
  archived: 'neutral',
  stale: 'warning',
  manual_evaluation: 'neutral',
  skipped: 'secondary',
};

const statusLabel = {
  pending: 'Otomatik Öneri',
  approved: 'Siparişe dönüştü',
  rejected: 'Reddedildi',
  converted: 'Siparişe dönüştü',
  cancelled: 'İptal edildi',
  expired: 'Süresi doldu',
  archived: 'Arşivlendi',
  stale: 'Yeniden hesap gerekli',
  manual_evaluation: 'Manuel Değerlendirme',
  skipped: 'Öneriye Alınmadı',
};

const SECTION_TAB_STATUS = {
  pending: 'pending',
  manual_evaluation: 'manual_evaluation',
  skipped: 'skipped',
};

const ACTIVE_SUGGESTION_STATUSES = new Set(['pending', 'manual_evaluation', 'skipped']);
const ARCHIVED_SUGGESTION_STATUSES = new Set(['approved', 'rejected', 'converted', 'cancelled', 'expired', 'archived', 'stale']);
const PACKAGED_ORDER_UNITS = new Set(['koli', 'kasa', 'paket', 'çuval']);

const trendLabel = { up: 'Yükseliş', flat: 'Dengeli', down: 'Düşüş' };

const PRESET_DEFINITIONS = [
  { key: PRESET_FILTERS.criticalNeed, label: 'Kritik net ihtiyaç', compactLabel: 'Kritik ihtiyaç', ariaLabel: 'Kritik (3 gün içinde)' },
  { key: PRESET_FILTERS.noInbound, label: 'Yolda sipariş yok', compactLabel: 'Yolda yok' },
  { key: PRESET_FILTERS.missingData, label: 'Eksik veri bulunanlar', compactLabel: 'Eksik veri' },
  { key: PRESET_FILTERS.longLeadTime, label: 'Tedarik süresi uzun', compactLabel: 'Uzun temin' },
  { key: PRESET_FILTERS.highRisk, label: 'Yüksek veya kritik risk', compactLabel: 'Yüksek risk' },
  { key: PRESET_FILTERS.fastStockout, label: 'Hızlı tükenen ürünler', compactLabel: 'Hızlı tükenen' },
];

const buildSuggestionQueryParams = (filters = {}, options = {}) => {
  const { page = 1, statusGroup = '' } = options;
  const params = {
    page,
    limit: SERVER_PAGE_SIZE,
  };
  if (statusGroup) params.statusGroup = statusGroup;
  ['search', 'status', 'riskLevel', 'supplierId', 'preset', 'stockoutEligible'].forEach((key) => {
    const value = filters?.[key];
    const text = String(value ?? '').trim();
    if (text) params[key] = text;
  });
  return params;
};

const getFilteredSummary = (metaSummary) => (
  metaSummary && typeof metaSummary === 'object' && metaSummary.filtered && typeof metaSummary.filtered === 'object'
    ? metaSummary.filtered
    : null
);

const getRowInboundStatus = (row = {}) => {
  const totals = row.inboundStatusTotals && typeof row.inboundStatusTotals === 'object' ? row.inboundStatusTotals : {};
  if (Number(totals.goods_receipt_pending || 0) > 0) return 'goods_receipt_pending';
  if (Number(totals.stock_entry_pending || 0) > 0) return 'stock_entry_pending';
  if (Number(row.inboundEffectiveQty || row.inboundConfirmedQty || row.inboundNearTermQty || 0) > 0) return 'has_inbound';
  return 'no_inbound';
};

const getRowLeadTimeBand = (row = {}) => {
  const lead = Number(row.leadTimeDays);
  if (!Number.isFinite(lead) || lead <= 0) return 'missing';
  if (lead <= 2) return '0_2';
  if (lead <= 5) return '3_5';
  return '6_plus';
};

const getRowNetNeedBand = (row = {}) => {
  const need = Number(row.netNeedQty ?? row.suggestedQty ?? 0);
  if (!Number.isFinite(need) || need <= 0) return 'none';
  if (need <= 10) return 'low';
  if (need <= 50) return 'medium';
  if (need <= 100) return 'high';
  return 'critical';
};

const getRowMoqEffect = (row = {}) => {
  const suggested = Number(row.suggestedQty || 0);
  const roundedFrom = Number(row.roundedFromQty ?? row.netNeedQty ?? suggested);
  const minimumBase = Number(row.minimumOrderBaseQty || row.minimumOrderQty || 0);
  return minimumBase > 0 && suggested >= minimumBase && roundedFrom > 0 && roundedFrom <= minimumBase ? 'applied' : 'not_applied';
};

const getRowMissingData = (row = {}) => {
  if (Number(row.criticalStock || 0) <= 0) return 'min_stock';
  if (Number(row.leadTimeDays || 0) <= 0) return 'lead_time';
  if (!row.supplierId || row.supplierMissing) return 'supplier_mapping';
  return 'complete';
};

const rowMatchesPresetFilter = (row = {}, preset = '') => {
  const key = String(preset || '').trim();
  const risk = String(row.riskLevel || '').toLowerCase('tr-TR');
  const days = Number(row.daysToStockout);
  const lead = Number(row.leadTimeDays || 0);
  if (!key) return true;
  if (key === PRESET_FILTERS.criticalNeed) return risk === 'critical' || getRowNetNeedBand(row) === 'critical';
  if (key === PRESET_FILTERS.noInbound) return getRowInboundStatus(row) === 'no_inbound';
  if (key === PRESET_FILTERS.missingData) return getRowMissingData(row) !== 'complete';
  if (key === PRESET_FILTERS.longLeadTime) return lead >= 6;
  if (key === PRESET_FILTERS.highRisk) return ['critical', 'high'].includes(risk);
  if (key === PRESET_FILTERS.fastStockout) return Number.isFinite(days) && days <= Math.max(3, lead + 1);
  if (key === PRESET_FILTERS.critical3) return Number.isFinite(days) && days <= 3;
  if (key === PRESET_FILTERS.risk7) return Number.isFinite(days) && days <= 7;
  if (key === PRESET_FILTERS.fastSelling) return getAverageDailySales(row) >= 8;
  if (key === PRESET_FILTERS.slowOrOverstock) return getAverageDailySales(row) <= 1 && Number(row.currentStock || 0) >= 10;
  return true;
};

const rowMatchesUiFilters = (row = {}, filters = {}) => {
  const query = String(filters.search || '').trim().toLocaleLowerCase('tr-TR');
  const searchText = [row.productName, row.sku, row.barcode, row.supplierName]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('tr-TR');
  if (query && !searchText.includes(query)) return false;
  if (filters.status && normalizeSuggestionStatus(row.status) !== normalizeSuggestionStatus(filters.status)) return false;
  if (filters.riskLevel && String(row.riskLevel || '').toLowerCase('tr-TR') !== String(filters.riskLevel).toLowerCase('tr-TR')) return false;
  if (filters.supplierId && String(row.supplierId || '') !== String(filters.supplierId)) return false;
  if (filters.preset && !rowMatchesPresetFilter(row, filters.preset)) return false;
  return true;
};

const chartTooltipStyle = {
  borderRadius: 10,
  border: '1px solid #e5e7eb',
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.12)',
};

const chartTooltipLabelStyle = {
  color: '#0f172a',
  fontWeight: 700,
};

const chartTooltipFormatter = (label) => (value) => [formatNumber(value), label];

const reasonDistributionColors = ['#2563eb', '#0f766e', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#475569', '#16a34a'];

const normalizeSuggestionStatus = (value = '') => {
  const normalized = String(value || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[\s-]+/g, '_');
  if (['senttoorder', 'sent_to_order', 'ordered'].includes(normalized)) return 'converted';
  return normalized || 'pending';
};

const isArchivedSuggestionStatus = (value) => ARCHIVED_SUGGESTION_STATUSES.has(normalizeSuggestionStatus(value));
const isActiveSuggestionStatus = (value) => ACTIVE_SUGGESTION_STATUSES.has(normalizeSuggestionStatus(value));
const shouldLoadActiveSuggestions = (filters = {}) => !filters.status || isActiveSuggestionStatus(filters.status);
const shouldLoadArchiveSuggestions = (filters = {}) => !filters.status || isArchivedSuggestionStatus(filters.status);

const getResponsePagination = (value, fallbackPage = 1) => (
  value?.meta?.pagination || {
    page: fallbackPage,
    limit: TABLE_PAGE_SIZE,
    total: Array.isArray(value) ? value.length : 0,
    totalPages: 1,
  }
);

const displayValue = (value, fallback = 'Bilgi yok') => {
  const text = String(value ?? '').trim();
  return text && text !== '-' ? text : fallback;
};

const isInternalActorId = (value = '') => {
  const text = String(value || '').trim();
  if (!text) return false;
  return /^(u[-_])\d+[a-z]*$/i.test(text)
    || /^u[-_][a-z0-9_-]*\d/i.test(text)
    || /^u-\d/i.test(text)
    || /^system[-_]user$/i.test(text)
    || /^admin[-_]\d+$/i.test(text);
};

const isAutomationActor = (item = {}) => {
  const actorSignal = [
    item.actorType,
    item.actionActorType,
    item.createdByType,
    item.updatedByType,
    item.source,
    item.sourceType,
    item.sourceModule,
    item.actionSource,
    item.createdBy,
    item.updatedBy,
  ].join(' ').toLocaleLowerCase('tr-TR');
  return /\b(automation|otomasyon|scheduler|schedule|cron|job|worker|batch)\b/.test(actorSignal);
};

const isSystemActor = (item = {}) => {
  const actorSignal = [
    item.actorType,
    item.actionActorType,
    item.createdByType,
    item.updatedByType,
    item.source,
    item.sourceType,
    item.sourceModule,
    item.actionSource,
    item.createdBy,
    item.updatedBy,
  ].join(' ').toLocaleLowerCase('tr-TR');
  return /\b(system|sistem|auto|rule|engine|recommendation)\b/.test(actorSignal);
};

const formatActionDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getTotalStockValue = (item) => {
  const warehouseStock = Number(item.warehouseStock);
  const shelfStock = Number(item.shelfStock);
  const hasWarehouseStock = Number.isFinite(warehouseStock);
  const hasShelfStock = Number.isFinite(shelfStock);
  if (hasWarehouseStock || hasShelfStock) {
    return Math.max(0, (hasWarehouseStock ? warehouseStock : 0) + (hasShelfStock ? shelfStock : 0));
  }
  const directTotal = Number(item.totalStock);
  if (Number.isFinite(directTotal) && directTotal >= 0) return directTotal;
  return null;
};

const isItemSelectableStockout = (item) => {
  const totalStock = getTotalStockValue(item);
  const isStockOut = totalStock === 0;
  const hasReasonTag = (tag) => Array.isArray(item.reasonTags) ? item.reasonTags.includes(tag) : (item.reasonCode === tag);

  if (!isStockOut) return false;
  if (hasReasonTag('product_inactive') || item.isActive === false) return false;
  if (hasReasonTag('inbound_covered')) return false;
  if (hasReasonTag('missing_supplier_mapping') || item.supplierMissing) return false;
  if (hasReasonTag('inactive_supplier')) return false;

  return true;
};

const isSkippedSelectable = (item) => {
  const isSkipped = normalizeSuggestionStatus(item.status) === 'skipped';
  return isSkipped && isItemSelectableStockout(item);
};

const getSkippedDisabledReason = (item) => {
  const totalStock = getTotalStockValue(item);
  const isStockOut = totalStock === 0;
  const hasReasonTag = (tag) => Array.isArray(item.reasonTags) && item.reasonTags.includes(tag);

  if (!isStockOut) return 'Stok tükenmemiş';
  if (hasReasonTag('product_inactive') || item.isActive === false) return 'Ürün aktif değil';
  if (hasReasonTag('inbound_covered')) return 'Yoldaki sipariş ihtiyacı karşılıyor';
  if (hasReasonTag('missing_supplier_mapping') || item.supplierMissing) return 'Tedarikçi eşleştirmesi yok';
  if (hasReasonTag('inactive_supplier')) return 'Tedarikçi pasif';

  return 'Sipariş için uygun değil';
};

const readSuggestionHandoffStore = () => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(PURCHASE_SUGGESTION_HANDOFF_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const persistSuggestionHandoffStore = (handoffStore) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PURCHASE_SUGGESTION_HANDOFF_STORAGE_KEY, JSON.stringify(handoffStore));
  } catch {
    // no-op
  }
};

const createSuggestionHandoffId = () => (
  `psh-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

const writeSuggestionHandoff = ({ mode, items, invalidReasons }) => {
  const handoffStore = readSuggestionHandoffStore();
  const handoffId = createSuggestionHandoffId();
  handoffStore[handoffId] = {
    source: 'oneriler',
    intent: mode,
    createdAt: new Date().toISOString(),
    items,
    invalidReasons: Array.isArray(invalidReasons) ? invalidReasons : [],
  };
  persistSuggestionHandoffStore(handoffStore);
  return handoffId;
};

const resolveActorName = (value) => {
  if (value && typeof value === 'object') {
    const combinedName = [value.firstName, value.lastName].filter(Boolean).join(' ').trim();
    const text = String(
      combinedName
      || value.fullName
      || value.displayName
      || value.name
      || value.email
      || ''
    ).trim();
    return isInternalActorId(text) || /^(system|sistem|automation|otomasyon|scheduler|cron|job)$/i.test(text) ? '' : text;
  }
  const text = String(value || '').trim();
  return isInternalActorId(text) || /^(system|sistem|automation|otomasyon|scheduler|cron|job)$/i.test(text) ? '' : text;
};

const resolveActorFields = (item = {}) => {
  const combinedName = [item.actionByFirstName, item.actionByLastName].filter(Boolean).join(' ').trim()
    || [item.reviewedByFirstName, item.reviewedByLastName].filter(Boolean).join(' ').trim()
    || [item.approvedByFirstName, item.approvedByLastName].filter(Boolean).join(' ').trim()
    || [item.rejectedByFirstName, item.rejectedByLastName].filter(Boolean).join(' ').trim()
    || [item.updatedByFirstName, item.updatedByLastName].filter(Boolean).join(' ').trim();

  return (
    combinedName
    || resolveActorName(item.actionByDisplayName)
    || resolveActorName(item.actionByFullName)
    || resolveActorName(item.actionByName)
    || resolveActorName(item.reviewedByName)
    || resolveActorName(item.approvedByName)
    || resolveActorName(item.rejectedByName)
    || resolveActorName(item.updatedByName)
    || resolveActorName(item.createdByName)
    || resolveActorName(item.userDisplayName)
    || resolveActorName(item.userFullName)
    || resolveActorName(item.userName)
    || resolveActorName(item.actionBy)
    || resolveActorName(item.reviewedBy)
    || resolveActorName(item.approvedBy)
    || resolveActorName(item.rejectedBy)
    || resolveActorName(item.updatedBy)
    || resolveActorName(item.createdBy)
  );
};

const resolveArchiveActor = (item = {}) => {
  if (isAutomationActor(item)) return 'Otomasyon';
  const actorName = resolveActorFields(item);
  if (actorName) return actorName;
  if (isSystemActor(item)) return 'Sistem';
  return 'Sistem';
};

const getArchiveActionAt = (item = {}) => (
  item.actionAt
  || item.reviewedAt
  || item.approvedAt
  || item.rejectedAt
  || item.updatedAt
  || item.createdAt
  || ''
);


const resolvePackageSize = (item = {}, orderUnit = 'adet') => {
  if (orderUnit === 'palet') {
    return Math.max(1, Number(item.unitsPerPallet || item.unitsPerCase || item.packageSize || 1));
  }
  if (PACKAGED_ORDER_UNITS.has(orderUnit)) {
    return Math.max(1, Number(item.unitsPerCase || item.unitsPerPack || item.packageSize || 1));
  }
  return Math.max(1, Number(item.unitsPerPack || item.unitsPerCase || item.packageSize || 1));
};

const resolveOrderUnit = (item = {}) => {
  const rawUnit = String(
    item.orderUnit
    || item.defaultOrderUnit
    || item.minOrderUnit
    || item.roundingUnit
    || 'adet'
  ).trim().toLocaleLowerCase('tr-TR');
  return rawUnit || 'adet';
};

const buildNavigationItem = (item = {}) => {
  const productId = String(item.productId || item.product?.id || item.product?.productId || item.payload?.productId || '').trim();
  const suggestionId = String(item.suggestionId || item.id || item.payload?.suggestionId || '').trim();
  const supplierId = String(item.supplierId || item.supplier?.id || item.payload?.supplierId || '').trim();
  const supplierProductId = String(
    item.supplierProductId
    || item.supplierProduct?.id
    || item.supplierProductMappingId
    || item.payload?.supplierProductId
    || ''
  ).trim();
  const orderUnit = resolveOrderUnit(item);
  const packageSize = resolvePackageSize(item, orderUnit);
  const baseRecommendedQty = Number(item.suggestedQty || item.recommendedQuantity || item.recommendedQty || 0);
  let recommendedQuantity = orderUnit === 'palet' || PACKAGED_ORDER_UNITS.has(orderUnit)
    ? Math.ceil(baseRecommendedQty / packageSize)
    : Math.max(0, baseRecommendedQty);

  const statusVal = normalizeSuggestionStatus(item.status);

  if (!suggestionId || !productId || !supplierId) {
    return {
      valid: false,
      reason: `${item.productName || item.sku || 'öneri'} için ürün veya tedarikçi bilgisi eksik`,
    };
  }

  if (!Number.isFinite(recommendedQuantity) || recommendedQuantity <= 0) {
    if (statusVal === 'manual_evaluation') {
      recommendedQuantity = 1;
    } else if (statusVal === 'skipped') {
      const minQty = Number(item.minimumOrderQty || item.minimumOrderBaseQty || 1);
      const unitsPerCase = Number(item.unitsPerCase || 1);
      const fallbackVal = Math.max(1, minQty, unitsPerCase);
      recommendedQuantity = orderUnit === 'palet' || PACKAGED_ORDER_UNITS.has(orderUnit)
        ? Math.ceil(fallbackVal / packageSize)
        : fallbackVal;
    } else {
      return {
        valid: false,
        reason: `${item.productName || item.sku || 'öneri'} için geçerli öneri miktarı yok`,
      };
    }
  }

  return {
    valid: true,
    item: {
      suggestionId,
      supplierProductId,
      productId,
      productName: item.productName || '-',
      sku: item.sku || '-',
      supplierId,
      supplierName: item.supplierName || 'Tedarikçi atanmadı',
      recommendedQuantity,
      recommendedBaseQuantity: Math.max(0, baseRecommendedQty),
      suggestedQty: recommendedQuantity,
      unit: item.unit || 'adet',
      orderUnit,
      baseUnit: 'adet',
      packageSize,
      unitsPerPack: Number(item.unitsPerPack || item.packageSize || 1),
      unitsPerCase: Number(item.unitsPerCase || item.packageSize || 1),
      unitsPerPallet: Number(item.unitsPerPallet || item.packageSize || 1),
      purchaseUnitPrice: Number(item.purchasePrice || item.unitPrice || 0),
      purchasePrice: Number(item.purchasePrice || item.unitPrice || 0),
      supplierProductCode: item.supplierProductCode || item.supplierSku || item.sku || '',
      barcode: item.barcode || '',
      minimumOrderQty: Number(item.minimumOrderQty || item.minimumOrderBaseQty || 1),
      minimumOrderUnit: item.minimumOrderUnit || item.minOrderUnit || orderUnit,
      priceUnit: item.priceUnit || 'adet',
      leadTimeDays: Number(item.leadTimeDays || 3),
      currentStock: Number(item.currentStock || item.stockLevel || 0),
      shelfStock: Number(item.shelfStock || 0),
      warehouseStock: Number(item.warehouseStock || 0),
      totalStock: Number(item.totalStock ?? getTotalStockValue(item) ?? 0),
      riskLevel: String(item.riskLevel || '').trim().toLocaleLowerCase('tr-TR'),
      reason: item.reason || item.actionableReason || item.explanation?.summary || '-',
      recommendationReason: item.reason || item.actionableReason || item.explanation?.summary || '-',
      status: statusVal,
      sourceStatus: statusVal,
      reasonTags: Array.isArray(item.reasonTags) ? item.reasonTags : (item.reasonCode ? [item.reasonCode] : []),
      source: 'purchase_suggestions',
      createdAt: item.createdAt || '',
      updatedAt: item.updatedAt || '',
    },
  };
};

const formatSuggestedQuantityCell = (item = {}) => {
  const orderUnit = resolveOrderUnit(item);
  const packageSize = resolvePackageSize(item, orderUnit);
  const baseSuggestedQty = Number(item.suggestedQty || 0);
  const displayQty = orderUnit === 'palet' || PACKAGED_ORDER_UNITS.has(orderUnit)
    ? Math.ceil(baseSuggestedQty / packageSize)
    : baseSuggestedQty;
  const unitLabel = orderUnit === 'adet' ? 'adet' : orderUnit;
  return {
    primary: `${formatNumber(displayQty)} ${unitLabel}`,
    secondary: orderUnit === 'adet'
      ? ''
      : `Baz miktar: ${formatNumber(baseSuggestedQty)} adet`,
  };
};

const reasonTagLabel = {
  low_stock: 'Kritik stok eşiği',
  stockout_risk: 'Stok bitiş riski',
  fast_sales: 'Hızlı satış',
  trend_up: 'Talep artışı',
  campaign_boost: 'Kampanya etkisi',
  moq_applied: 'Minimum sipariş',
  case_rounded: 'Koli yuvarlama',
  pallet_rounded: 'Palet yuvarlama',
  product_inactive: 'Ürün pasif',
  missing_supplier_mapping: 'Tedarikçi eşleşmesi eksik',
  inactive_supplier: 'Tedarikçi pasif',
  missing_min_stock: 'Minimum stok eksik',
  missing_lead_time: 'Temin süresi eksik',
  missing_demand_data: 'Son 30 günlük satış verisi yok',
  missing_moq_or_case_data: 'MOQ veya paket/koli bilgisi eksik',
  inbound_covered: 'Açık sipariş ihtiyacı karşılıyor',
  stock_sufficient: 'Stok yeterli / net ihtiyaç yok',
  mode_or_risk_guard: 'Seçilen mod için risk seviyesi yetersiz',
  slow_sales: 'Düşük satış hızı, manuel değerlendirme',
};

const formatReasonTags = (tags = []) => {
  if (!Array.isArray(tags) || !tags.length) return '';
  return tags.map((tag) => reasonTagLabel[tag] || tag).join(', ');
};

const cleanReasonText = (value = '') => (
  String(value || '')
    .replace(/\binbound\s+yok\b/gi, 'Yolda sipariş yok')
    .replace(/\binbound\b/gi, 'yolda sipariş')
    .replace(/\bno\s+inbound\b/gi, 'Yolda sipariş yok')
    .replace(/\bstockout\b/gi, 'stok bitiş riski')
    .replace(/\blead\s*time\b/gi, 'temin süresi')
    .replace(/\bmissing\s+supplier\b/gi, 'Tedarikçi bilgisi eksik')
    .replace(/\bmissing\s+product\b/gi, 'Ürün bilgisi eksik')
    .replace(/\bnull\b|\bundefined\b/gi, 'bilgi eksik')
    .replace(/\s+/g, ' ')
    .trim()
);

const splitReasonText = (value = '', limit = 3) => {
  const text = cleanReasonText(value);
  if (!text) return [];
  return text
    .split(/(<=[.!])\s+|;\s+|\s+-\s+/)
    .map((part) => cleanReasonText(part))
    .filter(Boolean)
    .slice(0, limit);
};

const buildReasonSummary = (item = {}) => {
  const title = cleanReasonText(item.explanation.title) || 'Öneri Özeti';
  const summaryCandidates = [
    item.explanation.summary,
    item.actionableReason,
    item.reason,
    formatReasonTags(item.reasonTags),
  ];
  const summaryItems = summaryCandidates.flatMap((candidate) => splitReasonText(candidate, 2)).filter(Boolean);
  const riskDrivers = Array.isArray(item.explanation.riskDrivers)
     ? item.explanation.riskDrivers.map(cleanReasonText).filter(Boolean).slice(0, 3)
    : [];
  const points = [...new Set([...riskDrivers, ...summaryItems])].slice(0, 4);
  return {
    title,
    points: points.length ? points : ['Talep, stok ve tedarik bilgileri birlikte değerlendirilerek öneri oluşturuldu.'],
  };
};

const buildReasonSections = (item = {}) => {
  const sold7 = Number(item.sold7 || 0);
  const trend = trendLabel[item.explanation.trend] || trendLabel[item.trendDirection] || 'Yatay';
  const stock = getTotalStockValue(item);
  const criticalStock = Number(item.criticalStock || 0);
  const leadTimeDays = Number(item.leadTimeDays || 0);
  const daysToStockout = Number(item.daysToStockout);
  const hasStockoutEstimate = Number.isFinite(daysToStockout);
  const stockRiskText = stock !== null && stock <= 0
     ? 'Ürün stokta tükendi. Raf bulunurluğu için sipariş önceliği yükseltilmelidir.'
    : stock !== null && criticalStock > 0 && stock <= criticalStock
       ? 'Mevcut stok seviyesi kritik eşiğin altında. Kısa vadede stok baskısı bekleniyor.'
      : hasStockoutEstimate
         ? `${formatNumber(Math.max(0, daysToStockout))} gün içinde stok baskısı oluşabilir.`
        : 'Stok riski mevcut satış hızına göre izlenmelidir.';
  const leadText = leadTimeDays > 0
     ? `${formatNumber(leadTimeDays)} günlük temin süresi nedeniyle sipariş zamanlaması raf bulunurluğunu etkileyebilir.`
    : 'Temin süresi bilgisi bulunmadığı için tedarik planı dikkatle izlenmelidir.';

  return [
    {
      title: 'Talep Görünümü',
      text: `Son 7 günde ${formatNumber(sold7)} adet satış gerçekleşti. Talep eğilimi ${String(trend).toLocaleLowerCase('tr-TR')}.`,
    },
    {
      title: 'Stok Riski',
      text: stockRiskText,
    },
    {
      title: 'Tedarik Etkisi',
      text: leadText,
    },
    {
      title: 'Sistem Gerekçesi',
      text: `Sistem talep, stok ve temin verisini birlikte değerlendirdi. Öneri güven skoru: ${item.confidenceText || 'İnceleme gerekli'}.`,
    },
  ];
};

const deterministicSeed = (value = '') => {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

const buildBetterReason = (row = {}) => {
  const reasons = [];
  if (Number(row.sold7 || 0) >= 14) reasons.push('Son 7 günde hızlı satış');
  if (Number(row.currentStock || 0) <= Number(row.criticalStock || 0)) reasons.push('Mevcut stok kritik eşiğin altında');
  if (Number(row.leadTimeDays || 0) >= 7) reasons.push('Temin süresi uzun');
  if (!row.supplierId || !row.supplierName || row.supplierName === '-') reasons.push('Varsayılan tedarikçi yok');
  if (Number(row.warehouseStock || 0) + Number(row.shelfStock || 0) <= Math.max(5, Number(row.criticalStock || 0))) reasons.push('Reyon/depo stoku düşük');
  if (!reasons.length) reasons.push(formatReasonTags(row.reasonTags) || 'Talep ve stok dengesi sipariş gerektiriyor');
  return reasons.join(', ');
};

const reasonDistributionCategories = [
  {
    key: 'out_of_stock',
    name: 'Stok tükendi',
    matches: (row, text) => {
      const stock = getTotalStockValue(row);
      return (stock !== null && stock <= 0) || text.includes('stokta tükendi') || text.includes('güvenli stok tamponu tüken');
    },
  },
  {
    key: 'critical_stock',
    name: 'Kritik stok baskısı',
    matches: (row, text, tags) => {
      const stock = getTotalStockValue(row);
      const criticalStock = Number(row.criticalStock || row.minStock || row.safetyStock || 0);
      return tags.includes('low_stock')
        || text.includes('kritik stok')
        || text.includes('kritik eşi')
        || (stock !== null && criticalStock > 0 && stock <= criticalStock);
    },
  },
  {
    key: 'fast_sales',
    name: 'Hızlı satış baskısı',
    matches: (row, text, tags) => (
      tags.includes('fast_sales')
      || tags.includes('trend_up')
      || text.includes('hızlı satış')
      || text.includes('talep art')
      || Number(row.sold7 || row.recentSales7 || 0) >= 14
      || Number(row.avgDailySales || row.avgDaily7 || 0) >= 4
    ),
  },
  {
    key: 'long_lead_time',
    name: 'Uzun temin süresi',
    matches: (row, text) => text.includes('temin süresi uzun') || text.includes('temin süresi plan') || Number(row.leadTimeDays || 0) >= 7,
  },
  {
    key: 'no_inbound',
    name: 'Yolda sipariş yok',
    matches: (row, text) => getRowInboundStatus(row) === 'no_inbound' || text.includes('yolda sipariş yok') || text.includes('aktif tedarik akışı yok'),
  },
  {
    key: 'missing_data',
    name: 'Eksik veri / tanım eksik',
    matches: (row, text) => (
      getRowMissingData(row) !== 'complete'
      || text.includes('bilgi eksik')
      || text.includes('veri yetersiz')
      || text.includes('tedarikçi bilgisi eksik')
      || text.includes('ürün bilgisi eksik')
    ),
  },
  {
    key: 'moq',
    name: 'MOQ etkisi',
    matches: (row, text, tags) => (
      getRowMoqEffect(row) === 'applied'
      || tags.includes('moq_applied')
      || tags.includes('case_rounded')
      || tags.includes('pallet_rounded')
      || text.includes('minimum sipariş')
      || text.includes('koli yuvarlama')
      || text.includes('palet yuvarlama')
    ),
  },
  {
    key: 'high_net_need',
    name: 'Net ihtiyaç yüksek',
    matches: (row, text) => (
      ['high', 'critical'].includes(getRowNetNeedBand(row))
      || Number(row.netNeedQty ?? row.suggestedQty ?? 0) >= 50
      || text.includes('net ihtiyaç')
      || text.includes('sipariş gerektiriyor')
    ),
  },
];

const getReasonDistributionSignals = (row = {}) => {
  const tags = Array.isArray(row.reasonTags) ? row.reasonTags.map((tag) => String(tag || '').toLowerCase('tr-TR')) : [];
  const text = cleanReasonText([
    row.actionableReason,
    row.reason,
    row.recommendationReason,
    row.explanation.summary,
    formatReasonTags(row.reasonTags),
  ].filter(Boolean).join(' ')).toLocaleLowerCase('tr-TR');
  const categories = reasonDistributionCategories.filter((item) => item.matches(row, text, tags));
  return categories.length ? categories : [{ key: 'balanced_need', name: 'Talep-stok dengesi' }];
};

const computeConfidenceScore = (row = {}) => {
  if (row.isStale || row.dataFreshness.isStale) return 28;
  const salesReliability = Math.min(30, Math.round((Number(row.sold14 || 0) / 2) + (Number(row.avgDailySales || row.avgDaily7 || 0) * 2)));
  const stockRisk = Number.isFinite(row.daysToStockout) ? Math.max(0, 25 - Math.min(25, Math.round(row.daysToStockout * 2))) : 6;
  const supplierSignal = row.supplierId ? 20 : 6;
  const leadTimeSignal = Number(row.leadTimeDays || 0) > 0 ? Math.max(8, 15 - Math.min(8, Math.round(Number(row.leadTimeDays || 0) / 3))) : 4;
  const qtySignal = Number(row.suggestedQty || 0) > 0 ? Math.max(8, 16 - Math.min(8, Math.abs(Math.round(Number(row.suggestedQty || 0) - Number(row.roundedFromQty || row.suggestedQty || 0))))) : 3;
  const seedBoost = deterministicSeed(`${row.id || row.productId || row.sku}`) % 7;
  return Math.max(18, Math.min(97, salesReliability + stockRisk + supplierSignal + leadTimeSignal + qtySignal + seedBoost));
};

const staleReasonLabel = {
  stock_changed: 'Canlı stok değişti',
  critical_stock_changed: 'Kritik eşik değişti',
  calculation_expired: 'Hesap eski',
  calculation_time_missing: 'Hesap zamanı yok',
  legacy_payload_drift: 'Veri yenilenmeli',
  product_missing: 'Ürün bulunamadı',
  supplier_missing: 'Tedarikçi bulunamadı',
  product_inactive: 'Ürün pasif',
  supplier_inactive: 'Tedarikçi pasif',
};

const buildFreshnessText = (item = {}) => {
  const freshness = item.dataFreshness || {};
  if (!freshness.isStale) return 'Güncel';
  const firstReason = Array.isArray(freshness.reasons) ? freshness.reasons[0] : '';
  return staleReasonLabel[firstReason] || 'Yeniden hesap gerekli';
};

const getTurkishReason = (item = {}) => {
  const tags = Array.isArray(item.reasonTags) ? item.reasonTags : [];
  const reasonCode = item.reasonCode || item.reason || (tags.length ? tags[0] : '');

  const code = String(reasonCode || '').trim().toLowerCase();

  if (code.includes('product_inactive')) return 'Ürün pasif olduğu için öneriye alınmadı';
  if (code.includes('missing_supplier_mapping') || code.includes('supplier_mapping') || item.supplierMissing) return 'Tedarikçi eşleşmesi olmadığı için otomatik öneri oluşturulmadı';
  if (code.includes('inactive_supplier') || code.includes('supplier_inactive')) return 'Tedarikçi pasif olduğu için öneri oluşturulmadı';
  if (code.includes('missing_min_stock')) return 'Minimum veya kritik stok seviyesi eksik olduğu için otomatik öneri oluşturulmadı';
  if (code.includes('missing_lead_time')) return 'Tedarik süresi eksik olduğu için otomatik öneri oluşturulmadı';
  if (code.includes('inbound_covered') || code.includes('inbound_considered')) return 'Yoldaki sipariş mevcut ihtiyacı karşılıyor';
  if (code.includes('slow_sales')) return 'Satış hızı düşük, manuel değerlendirme önerilir';
  if (code.includes('missing_demand_data') || code.includes('no_recent_sales_sufficient_stock')) return 'Yeterli satış verisi olmadığı için otomatik öneri oluşturulmadı';
  if (code.includes('no_reorder_need') || code.includes('need_qty_zero') || code.includes('sufficientstock') || code.includes('stock_sufficient')) return 'Mevcut stok seviyesi sipariş gerektirmiyor';
  if (code.includes('missing_moq_or_case_data')) return 'MOQ veya koli bilgisi eksik olduğu için otomatik öneri oluşturulamadı';
  if (code.includes('mode_or_risk_guard')) return 'Ürün, seçilen üretim modunun risk koşullarını karşılamıyor';

  if (item.reason && item.reason !== '-') return item.reason;
  if (item.actionableReason && item.actionableReason !== '-') return item.actionableReason;
  return 'Bu ürün için otomatik öneri oluşturulmadı';
};

const formatPriorityStockout = (item = {}) => {
  if (Number.isFinite(item.daysToStockout)) {
    const days = Math.max(0, Number(item.daysToStockout));
    const suffix = days <= 0 ? 'Bugün' : `${formatNumber(days)} gün içinde`;
    return item.estimatedStockoutDate && item.estimatedStockoutDate !== '-'
       ? `${suffix} (${item.estimatedStockoutDate})`
      : suffix;
  }

  if (Number(item.currentStock || 0) <= Number(item.criticalStock || 0)) {
    return 'Kritik stokta';
  }

  return '-';
};

function StockoutDisplay({ item }) {
  if (item.isStale) {
    return (
      <div className="ps-stockout-cell">
        <strong>Yeniden hesap gerekli</strong>
        <span>{item.freshnessText || 'Veri güncelliği doğrulanmalı'}</span>
      </div>
    );
  }

  const totalStock = getTotalStockValue(item);
  if (totalStock !== null && totalStock <= 0) {
    return (
      <div className="ps-stockout-cell ps-stockout-cell--empty">
        <strong>Tükendi</strong>
      </div>
    );
  }
  const days = Number(item.daysToStockout);
  const hasEstimate = Number.isFinite(days);
  const primaryText = hasEstimate
     ? (days <= 0 ? 'Tükendi' : `${formatNumber(Math.max(0, days))} gün`)
    : 'Tahmin edilemiyor';

  return (
    <div className="ps-stockout-cell">
      <strong>{primaryText}</strong>
    </div>
  );
}

const containsCalendarSignal = (tags) => {
  if (!Array.isArray(tags) || !tags.length) return false;
  const value = tags.join(' ').toLocaleLowerCase('tr-TR');
  return value.includes('hafta sonu')
    || value.includes('tatil')
    || value.includes('özel gün')
    || value.includes('yoğunluk')
    || value.includes('kampanya');
};

function RecommendationTable({
  rows,
  selectedIds,
  setSelectedIds,
  onOpenDetail,
  handleConvertToOrder,
  handleOpenComposeScreen,
  handleOpenManualComposeScreen,
  setRejectTarget,
  processingId,
  isAdmin,
  sectionType = 'pending',
}) {
  const navigate = useNavigate();
  const isPending = sectionType === 'pending';
  const isManual = sectionType === 'manual_evaluation';
  const isSkipped = sectionType === 'skipped';

  const selectableRows = rows.filter((item) => {
    if (isPending) return true;
    if (isSkipped) return isSkippedSelectable(item);
    if (sectionType === 'stockout') return isItemSelectableStockout(item);
    return false;
  });
  const allSelected = selectableRows.length > 0 && selectableRows.every((item) => selectedIds.includes(item.id));
  const [openMenuId, setOpenMenuId] = useState('');
  const [menuPosition, setMenuPosition] = useState(null);
  const openMenuItem = rows.find((item) => item.id === openMenuId) || null;

  useEffect(() => {
    if (!openMenuId) return undefined;
    const closeOnOutside = (event) => {
      if (event.target.closest?.('.ps-row-menu, .ps-row-menu-popover')) return;
      setOpenMenuId('');
      setMenuPosition(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setOpenMenuId('');
        setMenuPosition(null);
      }
    };
    const closeOnScroll = () => {
      setOpenMenuId('');
      setMenuPosition(null);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnScroll);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnScroll);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [openMenuId]);

  const toggleRow = (rowId, checked) => {
    setSelectedIds((current) => toggleSelectedRow(current, rowId, checked));
  };

  const closeRowMenu = () => {
    setOpenMenuId('');
    setMenuPosition(null);
  };

  const openRowMenu = (event, item) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setOpenMenuId((current) => {
      if (current === item.id) {
        setMenuPosition(null);
        return '';
      }
      const menuWidth = 236;
      const menuHeight = 150;
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
      const left = Math.max(12, Math.min(rect.left, viewportWidth - menuWidth - 12));
      const overflowsBottom = rect.bottom + 8 + menuHeight > viewportHeight;
      const hasSpaceAbove = rect.top - menuHeight - 8 > 0;
      const top = overflowsBottom && hasSpaceAbove ? rect.top - menuHeight - 8 : rect.bottom + 8;
      setMenuPosition({
        top,
        left,
      });
      return item.id;
    });
  };

  const toggleAll = (checked) => {
    if (checked) {
      const idsToSelect = selectableRows.map((item) => item.id);
      setSelectedIds((current) => Array.from(new Set([...current, ...idsToSelect])));
    } else {
      const idsToRemove = new Set(selectableRows.map((item) => item.id));
      setSelectedIds((current) => current.filter((id) => !idsToRemove.has(id)));
    }
  };

  return (
    <div className={`table-wrapper analysis-table-wrapper ${isSkipped ? 'ps-table-skipped' : ''}`}>
      <table className="data-table purchase-suggestions-table ps-main-table">
        <thead>
          <tr>
            {(isPending || isSkipped || sectionType === 'stockout') && (
              <th className="analysis-cell-nowrap ps-col-select">
                <label className="purchase-suggestions-checkbox" aria-label="Tümünü seç">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(event) => toggleAll(event.target.checked)}
                    disabled={selectableRows.length === 0}
                  />
                </label>
              </th>
            )}
            <th className="ps-col-product">Ürün</th>
            {!isPending ? (
              <th className="ps-col-reason">Gerekçe</th>
            ) : (
              <>
                <th>Son 7 Gün Satış</th>
                <th>Ort. Günlük Satış</th>
                <th>Tahmini Stok Bitiş</th>
                <th>Temin Süresi</th>
                <th>Güven Skoru</th>
              </>
            )}
            <th className="ps-col-stock">Toplam Stok</th>
            {!isSkipped && <th>Önerilen Miktar</th>}
            <th className="ps-col-supplier">Tedarikçi</th>
            {isPending && <th>Risk</th>}
            <th className="ps-col-status">Durum</th>
            <th className="analysis-cell-nowrap ps-col-actions">İşlemler</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const totalStockValue = getTotalStockValue(item);
            const quantity = formatSuggestedQuantityCell(item);
            const supplierCode = item.supplierProductCode || item.supplierSku || item.supplierCode || '';
            return (
              <Fragment key={item.id}>
                <tr className="purchase-suggestions-row">
                  {(isPending || isSkipped || sectionType === 'stockout') && (
                    <td className="ps-col-select">
                      <label className="purchase-suggestions-checkbox" aria-label={`${item.productName} için seç`}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(item.id)}
                          onChange={(event) => toggleRow(item.id, event.target.checked)}
                          disabled={(isSkipped && !isSkippedSelectable(item)) || (sectionType === 'stockout' && !isItemSelectableStockout(item))}
                          title={
                            isSkipped && !isSkippedSelectable(item)
                              ? getSkippedDisabledReason(item)
                              : sectionType === 'stockout' && !isItemSelectableStockout(item)
                              ? getSkippedDisabledReason(item)
                              : ''
                          }
                        />
                        <span className="sr-only">Seçili</span>
                      </label>
                    </td>
                  )}
                  <td className="ps-product-cell ps-col-product">
                    <div className="ps-product-stack">
                      <strong className="ps-product-name" title={displayValue(item.productName, 'Ürün adı yok')}>
                        {displayValue(item.productName, 'Ürün adı yok')}
                      </strong>
                      <span className="ps-product-sku" title={`SKU: ${displayValue(item.sku, '-')}`}>
                        SKU: {displayValue(item.sku, '-')}
                      </span>
                    </div>
                  </td>
                  {!isPending ? (
                    <td className="ps-reason-cell ps-col-reason" style={{ maxWidth: '300px', whiteSpace: 'normal', color: '#4b5563' }}>
                      {item.actionableReason || 'Bu ürün için gerekçe belirtilmedi.'}
                    </td>
                  ) : (
                    <>
                      <td className="analysis-cell-nowrap ps-number-cell">
                        {formatNumber(item.sold7 || 0)}
                      </td>
                      <td className="analysis-cell-nowrap ps-number-cell">
                        {formatNumber(item.avgDailySales || 0)}
                      </td>
                      <td className="analysis-cell-nowrap">
                        <StockoutDisplay item={item} />
                      </td>
                      <td className="analysis-cell-nowrap ps-number-cell">
                        {formatNumber(item.leadTimeDays || 0)} gün
                      </td>
                      <td className="analysis-cell-nowrap">
                        {item.confidenceText || 'İnceleme gerekli'}
                      </td>
                    </>
                  )}
                  <td className="analysis-cell-nowrap ps-number-cell ps-col-stock">
                    {totalStockValue === null ? 'Veri yok' : formatNumber(totalStockValue)}
                  </td>
                  {!isSkipped && (
                    <td className="analysis-cell-nowrap">
                      <span className="ps-quantity-cell" title={quantity.secondary || quantity.primary}>
                        {quantity.primary}
                      </span>
                    </td>
                  )}
                  <td className="ps-col-supplier">
                    <div className="ps-supplier-cell">
                      <strong title={displayValue(item.supplierName, 'Tedarikçi bilgisi yok')}>
                        {displayValue(item.supplierName, 'Tedarikçi bilgisi yok')}
                      </strong>
                      {supplierCode ? <span title={supplierCode}>{supplierCode}</span> : null}
                      {item.supplierMissing ? <span>Varsayılan tedarikçi eksik</span> : null}
                    </div>
                  </td>
                  {isPending && (
                    <td className="analysis-cell-nowrap">
                      <StatusBadge tone={riskTone[item.riskLevel] || 'neutral'}>
                        {riskLabel[item.riskLevel] || 'Bilgi yok'}
                      </StatusBadge>
                    </td>
                  )}
                  <td className="analysis-cell-nowrap ps-col-status">
                    <StatusBadge tone={statusTone[item.status] || 'neutral'}>
                      {statusLabel[item.status] || item.status || 'Bilgi yok'}
                    </StatusBadge>
                  </td>
                  <td className="ps-actions-cell ps-col-actions">
                    <div className="table-actions purchase-suggestions-row-actions">
                      {isAdmin ? (
                        <>
                          {isPending && (
                            <button
                              className="ps-action-chip ps-action-chip-primary"
                              type="button"
                              aria-label="Siparişe Dönüştür"
                              onClick={() => handleConvertToOrder(item)}
                              disabled={processingId === item.id || normalizeSuggestionStatus(item.status) !== 'pending'}
                            >
                              Siparişe Dönüştür
                            </button>
                          )}

                          {isManual && (
                            !item.supplierMissing ? (
                              <button
                                className="ps-action-chip ps-action-chip-primary"
                                type="button"
                                style={{ backgroundColor: '#2563eb', color: '#ffffff' }}
                                onClick={() => handleOpenManualComposeScreen(item)}
                                disabled={processingId === item.id}
                              >
                                Manuel Sipariş Hazırla
                              </button>
                            ) : (
                              <button
                                className="ps-action-chip ps-action-chip-warning"
                                type="button"
                                onClick={() => navigate('/eslesmeler')}
                              >
                                Tedarikçi Eşleştir
                              </button>
                            )
                          )}

                          {isSkipped && (
                            isSkippedSelectable(item) ? (
                              <button
                                className="ps-action-chip ps-action-chip-primary"
                                type="button"
                                style={{ backgroundColor: '#2563eb', color: '#ffffff' }}
                                onClick={() => handleOpenManualComposeScreen(item)}
                                disabled={processingId === item.id}
                              >
                                Manuel Sipariş Hazırla
                              </button>
                            ) : item.reasonTags?.includes('missing_supplier_mapping') || item.supplierMissing ? (
                              <button
                                className="ps-action-chip ps-action-chip-warning"
                                type="button"
                                onClick={() => navigate('/eslesmeler')}
                              >
                                Tedarikçi Eşleştir
                              </button>
                            ) : item.reasonTags?.includes('inactive_supplier') ? (
                              <button
                                className="ps-action-chip ps-action-chip-warning"
                                type="button"
                                onClick={() => navigate('/tedarikciler')}
                              >
                                Tedarikçiyi Kontrol Et
                              </button>
                            ) : item.reasonTags?.includes('inbound_covered') ? (
                              <button
                                className="ps-action-chip ps-action-chip-neutral"
                                type="button"
                                onClick={() => navigate('/siparis-takibi')}
                              >
                                Yoldaki Siparişi Gör
                              </button>
                            ) : item.reasonTags?.includes('product_inactive') ? (
                              <button
                                className="ps-action-chip ps-action-chip-neutral"
                                type="button"
                                onClick={() => navigate(`/urunler?search=${item.sku}`)}
                              >
                                Ürün Detayını Gör
                              </button>
                            ) : item.reasonTags?.some((tag) => ['missing_min_stock', 'missing_lead_time', 'missing_moq_or_case_data'].includes(tag)) ? (
                              <button
                                className="ps-action-chip ps-action-chip-warning"
                                type="button"
                                onClick={() => navigate(`/urunler?search=${item.sku}`)}
                              >
                                Eksik Tanımı Tamamla
                              </button>
                            ) : null
                          )}

                          {sectionType === 'stockout' && (
                            isItemSelectableStockout(item) ? (
                              <button
                                className="ps-action-chip ps-action-chip-primary"
                                type="button"
                                style={{ backgroundColor: '#2563eb', color: '#ffffff' }}
                                onClick={() => handleOpenManualComposeScreen(item)}
                                disabled={processingId === item.id}
                              >
                                Manuel Sipariş Hazırla
                              </button>
                            ) : item.reasonTags?.includes('missing_supplier_mapping') || item.supplierMissing ? (
                              <button
                                className="ps-action-chip ps-action-chip-warning"
                                type="button"
                                onClick={() => navigate('/eslesmeler')}
                              >
                                Tedarikçi Eşleştir
                              </button>
                            ) : item.reasonTags?.includes('inactive_supplier') ? (
                              <button
                                className="ps-action-chip ps-action-chip-warning"
                                type="button"
                                onClick={() => navigate('/tedarikciler')}
                              >
                                Tedarikçiyi Kontrol Et
                              </button>
                            ) : item.reasonTags?.includes('inbound_covered') ? (
                              <button
                                className="ps-action-chip ps-action-chip-neutral"
                                type="button"
                                onClick={() => navigate('/siparis-takibi')}
                              >
                                Yoldaki Siparişi Gör
                              </button>
                            ) : item.reasonTags?.includes('product_inactive') ? (
                              <button
                                className="ps-action-chip ps-action-chip-neutral"
                                type="button"
                                onClick={() => navigate(`/urunler?search=${item.sku}`)}
                              >
                                Ürün Detayını Gör
                              </button>
                            ) : item.reasonTags?.some((tag) => ['missing_min_stock', 'missing_lead_time', 'missing_moq_or_case_data'].includes(tag)) ? (
                              <button
                                className="ps-action-chip ps-action-chip-warning"
                                type="button"
                                onClick={() => navigate(`/urunler?search=${item.sku}`)}
                              >
                                Eksik Tanımı Tamamla
                              </button>
                            ) : null
                          )}

                          <div className="ps-row-menu">
                            <button
                              className="ps-row-menu-trigger"
                              type="button"
                              aria-label={`${item.productName || item.sku || 'Öneri'} için diğer işlemler`}
                              aria-haspopup="menu"
                              aria-expanded={openMenuId === item.id}
                              aria-controls={`ps-row-menu-${item.id}`}
                              onClick={(event) => openRowMenu(event, item)}
                            >
                              <MoreHorizontal size={16} aria-hidden="true" />
                              <span>Seçenekler</span>
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {openMenuItem && menuPosition && typeof document !== 'undefined' ? createPortal(
        <div
          className="ps-row-menu-popover ps-row-menu-portal"
          id={`ps-row-menu-${openMenuItem.id}`}
          role="menu"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          <button
            className="ps-menu-action"
            type="button"
            role="menuitem"
            onClick={() => {
              closeRowMenu();
              onOpenDetail(openMenuItem);
            }}
          >
            Detay
          </button>
          {sectionType === 'pending' && (
            <>
              <button
                className="ps-menu-action"
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowMenu();
                  handleOpenComposeScreen(openMenuItem);
                }}
                disabled={processingId === openMenuItem.id || normalizeSuggestionStatus(openMenuItem.status) !== 'pending'}
              >
                Öneriyi Taslakta Düzenle
              </button>
              <button
                className="ps-menu-action ps-menu-action-danger"
                type="button"
                role="menuitem"
                onClick={() => {
                  closeRowMenu();
                  setRejectTarget(openMenuItem);
                }}
                disabled={processingId === openMenuItem.id || normalizeSuggestionStatus(openMenuItem.status) !== 'pending'}
              >
                Reddet
              </button>
            </>
          )}
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function RecommendationDetailModal({
  item,
  isAdmin,
  processingId,
  onClose,
  onReject,
  onConvert,
}) {
  if (!item) return null;

  const summary = buildReasonSummary(item);
  const sections = buildReasonSections(item);
  const quantity = formatSuggestedQuantityCell(item);
  const baseQuantity = String(quantity.secondary || '').replace(/^Baz miktar:\s*/i, '').trim();
  const totalStock = getTotalStockValue(item);
  const canAct = isAdmin && normalizeSuggestionStatus(item.status) === 'pending';
  const categoryLabel = displayValue(item.categoryName || item.category || item.categoryLabel, 'Kategori bilgisi yok');
  const detailStats = [
    { label: 'Son 7 gün satış', value: formatNumber(item.sold7 || 0) },
    { label: 'Günlük ortalama', value: formatNumber(item.avgDailySales || 0) },
    { label: 'Toplam stok', value: totalStock === null ? 'Veri bekleniyor' : formatNumber(totalStock) },
    { label: 'Temin süresi', value: `${formatNumber(item.leadTimeDays || 0)} gün` },
    { label: 'Önerilen miktar', value: quantity.primary },
    { label: 'Baz miktar', value: baseQuantity || 'Kayıt yok' },
    { label: 'Güven düzeyi', value: item.confidenceText || 'İnceleme gerekli' },
  ];
  const reasonPoints = [
    ...summary.points,
    ...splitReasonText(item.actionableReason || item.reason || '', 3),
    formatReasonTags(item.reasonTags),
  ].map(cleanReasonText).filter(Boolean);
  const uniqueReasons = [...new Set(reasonPoints)].slice(0, 6);
  const sectionIconMap = {
    'Talep Görünümü': <BarChart3 size={15} />,
    'Stok Riski': <AlertTriangle size={15} />,
    'Tedarik Etkisi': <Truck size={15} />,
    'Sistem Gerekçesi': <CheckCircle2 size={15} />,
  };

  return (
    <FormModal
      isOpen={Boolean(item)}
      title="Öneri Detayı"
      description="Talep, stok ve tedarik etkisini birlikte değerlendirin."
      headerIcon={<Info size={18} />}
      onClose={onClose}
      modalClassName="order-suggestion-detail-modal ps-detail-modal"
      confirmOnDirtyClose={false}
    >
      <div className="ps-detail-body">
        <section className="ps-detail-product">
          <div className="ps-detail-product-main">
            <div className="ps-detail-product-icon" aria-hidden="true"><PackageCheck size={18} /></div>
            <div className="ps-detail-product-copy">
              <span>Ürün adı</span>
              <strong>{displayValue(item.productName, 'Ürün adı yok')}</strong>
            </div>
          </div>
          <div className="ps-detail-product-grid">
            <div className="ps-detail-info-field">
              <span>SKU</span>
              <strong>{displayValue(item.sku, '-')}</strong>
            </div>
            <div className="ps-detail-info-field">
              <span>Kategori</span>
              <strong>{categoryLabel}</strong>
            </div>
            <div className="ps-detail-info-field">
              <span>Tedarikçi</span>
              <strong>{displayValue(item.supplierName, 'Tedarikçi bilgisi yok')}</strong>
            </div>
            <div className="ps-detail-info-field">
              <span>Tedarikçi durumu</span>
              <strong>{item.supplierMissing ? 'Eşleşme gerekli' : 'Aktif'}</strong>
            </div>
          </div>
          <div className="ps-detail-product-badges">
            <span className={`ps-detail-supplier-badge ${item.supplierMissing ? 'is-warning' : 'is-success'}`}>
              {item.supplierMissing ? 'Tedarikçi eşleşmesi gerekli' : 'Aktif tedarikçi bilgisi var'}
            </span>
            <StatusBadge tone={riskTone[item.riskLevel] || 'neutral'}>
              {riskLabel[item.riskLevel] || 'Risk bilgisi yok'}
            </StatusBadge>
          </div>
        </section>

        <section className="ps-detail-summary">
          <div className="ps-detail-card-head">
            <span className="ps-detail-card-icon" aria-hidden="true"><ClipboardList size={15} /></span>
            <strong>{summary.title}</strong>
          </div>
          <p>{uniqueReasons[0] || 'Talep, stok ve tedarik bilgileri birlikte değerlendirilerek öneri oluşturuldu.'}</p>
        </section>

        <section className="ps-detail-stats" aria-label="Öneri metrikleri">
          {detailStats.map((stat) => (
            <div className="ps-detail-stat" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              {stat.helper ? <small>{stat.helper}</small> : null}
            </div>
          ))}
        </section>

        <section className="ps-detail-sections">
          {sections.map((section) => (
            <div className="ps-detail-section" key={section.title}>
              <div className="ps-detail-card-head">
                <span className="ps-detail-card-icon" aria-hidden="true">{sectionIconMap[section.title] || <Info size={15} />}</span>
                <strong>{section.title}</strong>
              </div>
              <p>{cleanReasonText(section.text)}</p>
            </div>
          ))}
        </section>

        <section className="ps-detail-reasons">
          <div className="ps-detail-card-head">
            <span className="ps-detail-card-icon" aria-hidden="true"><Sparkles size={15} /></span>
            <strong>Öneri nedenleri</strong>
          </div>
          <div>
            {uniqueReasons.length ? uniqueReasons.map((reason) => (
              <span key={reason}>{reason}</span>
            )) : <span>Operasyonel stok ihtiyacı</span>}
          </div>
        </section>
      </div>

      <div className="modal-form-actions ps-detail-footer">
        <button type="button" className="ghost-button ps-btn" onClick={onClose}>Kapat</button>
        {canAct ? (
          <>
            <button
              type="button"
              className="ghost-button ps-btn ps-btn-danger"
              onClick={() => onReject(item)}
              disabled={processingId === item.id}
            >
              Pas geç
            </button>
            <button
              type="button"
              className="primary-button ps-btn"
              onClick={() => onConvert(item)}
              disabled={processingId === item.id}
            >
              Siparişe Dönüştür
            </button>
          </>
        ) : null}
      </div>
    </FormModal>
  );
}

const normalizeCreatedOrderResult = (order = {}) => {
  const id = String(order.id || order.linkedOrderId || '').trim();
  const orderNumber = String(order.orderNumber || order.linkedOrderNumber || '').trim();
  const status = String(order.currentStatus || order.current_status || order.status || '').trim();
  if (!id || !orderNumber || !status) {
    throw new Error('Sipariş oluşturma yanıtında kimlik, sipariş numarası veya durum bilgisi eksik.');
  }
  const isAwaitingApproval = status === 'submitted_for_approval';
  return {
    id,
    orderNumber,
    status,
    title: isAwaitingApproval ? 'Sipariş onaya gönderildi' : 'Sipariş oluşturuldu',
    detail: isAwaitingApproval
      ? `${orderNumber} Onay Bekleyen Siparişler alanında görüntülenebilir.`
      : `${orderNumber} Sipariş Takibi sayfasında görüntülenebilir.`,
    actionLabel: isAwaitingApproval ? 'Onay Bekleyenlere Git' : 'Detaya Git',
  };
};

export default function PurchaseSuggestions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoaded, setSuppliersLoaded] = useState(false);
  const [products, setProducts] = useState([]);
  const [supplierProducts, setSupplierProducts] = useState([]);
  const [generatorSummary, setGeneratorSummary] = useState(null);
  const [filteredSummary, setFilteredSummary] = useState(null);
  const [archiveFilteredSummary, setArchiveFilteredSummary] = useState(null);
  const [listPagination, setListPagination] = useState({ page: 1, limit: TABLE_PAGE_SIZE, total: 0, totalPages: 1 });
  const [archivePagination, setArchivePagination] = useState({ page: 1, limit: TABLE_PAGE_SIZE, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState(initialFilters);
  const [generationOptions, setGenerationOptions] = useState(initialGenerationOptions);
  const [activePreset, setActivePreset] = useState('');
  const [groupBySupplier, setGroupBySupplier] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [createdOrderNotice, setCreatedOrderNotice] = useState(null);
  const {
    processingId,
    setProcessingId,
    isGeneratingSuggestions,
    isBulkProcessing,
  } = usePurchaseSuggestionActions();
  const [editingItem, setEditingItem] = useState(null);
  const [editForm, setEditForm] = useState(initialEditForm);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [bulkEditForm, setBulkEditForm] = useState(initialBulkEditForm);
  const [detailTarget, setDetailTarget] = useState(null);
  const [draftCreateTarget, setDraftCreateTarget] = useState(null);
  const [listPage, setListPage] = useState(1);
  const [archivePage, setArchivePage] = useState(1);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [activeSectionTab, setActiveSectionTab] = useState('pending'); // 'pending', 'manual_evaluation', 'skipped'

  const generationInFlightRef = useRef(false);
  const hasBootstrappedRef = useRef(false);

  const isAdmin = user.role === 'admin';
  const permissionList = Array.isArray(user.permissions) ? user.permissions : [];
  const canManageSuggestions = isAdmin
    || permissionList.includes('procurement.create')
    || permissionList.includes('procurement.update')
    || permissionList.includes('procurement.approve')
    || permissionList.includes('PROCUREMENT_CREATE')
    || permissionList.includes('PROCUREMENT_UPDATE')
    || permissionList.includes('PROCUREMENT_APPROVE');

  const loadData = async (query = filters, options = {}) => {
    const {
      includeContext = false,
      listPage: requestedListPage = listPage,
      archivePage: requestedArchivePage = archivePage,
      loadArchive: requestedLoadArchive = false,
    } = options;
    try {
      setIsLoading(true);
      const loadActive = shouldLoadActiveSuggestions(query);
      const loadArchive = (requestedLoadArchive || Boolean(query.status && isArchivedSuggestionStatus(query.status))) && shouldLoadArchiveSuggestions(query);
      const activeQuery = loadActive
         ? (activeSectionTab === 'stockout'
           ? buildSuggestionQueryParams({ ...query, status: '', stockoutEligible: 'true' }, { page: requestedListPage })
           : buildSuggestionQueryParams({ ...query, status: SECTION_TAB_STATUS[activeSectionTab] || SECTION_TAB_STATUS.pending }, { page: requestedListPage }))
        : null;
      const archiveQuery = loadArchive
         ? buildSuggestionQueryParams(query, { page: requestedArchivePage, statusGroup: query.status ? '' : 'archive' })
        : null;
      const summaryRequest = typeof procurementService.getSuggestionSummary === 'function'
         ? procurementService.getSuggestionSummary({
          search: query.search,
          status: query.status,
          riskLevel: query.riskLevel,
          supplierId: query.supplierId,
          preset: query.preset,
        })
        : Promise.resolve(null);
      const [activeData, archiveData, summaryData] = await Promise.allSettled([
        loadActive ? procurementService.listSuggestions(activeQuery) : Promise.resolve([]),
        loadArchive ? procurementService.listSuggestions(archiveQuery) : Promise.resolve([]),
        summaryRequest,
      ]);

      const activeRows = activeData.status === 'fulfilled' && Array.isArray(activeData.value) ? activeData.value : [];
      const archiveRows = archiveData.status === 'fulfilled' && Array.isArray(archiveData.value) ? archiveData.value : [];
      const guardedActiveRows = activeRows.filter((item) => isActiveSuggestionStatus(item.status));
      const guardedArchiveRows = archiveRows.filter((item) => isArchivedSuggestionStatus(item.status));
      const activeMetaSummary = activeData.status === 'fulfilled' ? (activeData.value?.meta?.summary || null) : null;
      const archiveMetaSummary = archiveData.status === 'fulfilled' ? (archiveData.value?.meta?.summary || null) : null;
      const summaryValue = summaryData.status === 'fulfilled' && summaryData.value ? summaryData.value : null;
      const suggestionRows = [...guardedActiveRows, ...guardedArchiveRows];
      setRows((currentRows) => {
        const retainedArchiveRows = loadArchive ? [] : currentRows.filter((item) => isArchivedSuggestionStatus(item.status));
        return [...guardedActiveRows, ...(loadArchive ? guardedArchiveRows : retainedArchiveRows)];
      });
      setGeneratorSummary(summaryValue || activeMetaSummary || archiveMetaSummary);
      setFilteredSummary(summaryValue?.active || getFilteredSummary(activeMetaSummary));
      setArchiveFilteredSummary(summaryValue?.archive || getFilteredSummary(archiveMetaSummary));
      setListPagination(loadActive ? getResponsePagination(activeData.value, requestedListPage) : { page: requestedListPage, limit: TABLE_PAGE_SIZE, total: 0, totalPages: 1 });
      if (loadArchive) {
        setArchivePagination(getResponsePagination(archiveData.value, requestedArchivePage));
        setArchiveLoaded(true);
      } else if (summaryValue?.archive) {
        setArchivePagination((current) => ({
          ...current,
          page: requestedArchivePage,
          total: Number(summaryValue.archive.totalCount ?? summaryValue.archive.archiveCount ?? current.total ?? 0),
          totalPages: Math.max(1, Math.ceil(Number(summaryValue.archive.totalCount ?? summaryValue.archive.archiveCount ?? current.total ?? 0) / TABLE_PAGE_SIZE)),
        }));
      }
      if (includeContext) {
        const [productList, supplierProductRows] = await Promise.allSettled([
          productService.list({ universe: 'listed_active', includeUnlisted: false, fetchAll: false, page: 1, limit: 500, includeTotal: false }),
          procurementService.listSupplierProducts({ fetchAll: false, page: 1, limit: 500, includeTotal: false }),
        ]);
        setProducts(productList.status === 'fulfilled' && Array.isArray(productList.value) ? productList.value : []);
        setSupplierProducts(supplierProductRows.status === 'fulfilled' && Array.isArray(supplierProductRows.value) ? supplierProductRows.value : []);
      }
      return suggestionRows;
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Önerileri', message: toUserFacingOperationError(error, 'Öneriler şu anda yüklenemedi.') });
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const loadSuppliers = async ({ force = false } = {}) => {
    if (suppliersLoaded && !force) return suppliers;
    try {
      const rows = await supplierService.list();
      const safeRows = Array.isArray(rows) ? rows : [];
      setSuppliers(safeRows);
      setSuppliersLoaded(true);
      return safeRows;
    } catch {
      setSuppliersLoaded(false);
      return suppliers;
    }
  };

  const regenerateSuggestions = async (reason = 'manual') => {
    if (generationInFlightRef.current) return;

    try {
      generationInFlightRef.current = true;
      setProcessingId(reason === 'auto' ? 'generate' : reason);
      const generationResult = await procurementService.generateSuggestions(generationOptions);
      const generationSummary = generationResult?.summary || generationResult?.data?.summary || null;
      if (generationSummary) setGeneratorSummary(generationSummary);
      await loadData(filters, { listPage: 1, archivePage, loadArchive: isArchiveOpen });
      if (reason !== 'auto') {
        const dominantReason = generationSummary?.reasonBreakdown?.[0];
        const resultText = generationSummary
          ? `${formatNumber(generationSummary.pendingCount || 0)} bekleyen, ${formatNumber(generationSummary.manualEvaluationCount || 0)} manuel, ${formatNumber(generationSummary.skippedCount || 0)} öneriye alınmayan kayıt.`
          : 'Öneri kayıtları yenilendi.';
        const reasonText = dominantReason
          ? ` Baskın neden: ${dominantReason.text || reasonTagLabel[dominantReason.code] || dominantReason.code} (${formatNumber(dominantReason.count)} ürün).`
          : '';
        setToast({ type: 'success', title: 'Talep analizi tamamlandı', message: `${resultText}${reasonText}` });
      }
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Önerileri', message: toUserFacingOperationError(error, 'Öneriler şu anda oluşturulamadı.') });
    } finally {
      generationInFlightRef.current = false;
      setProcessingId('');
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      await loadData(filters, { listPage: 1, archivePage: 1, loadArchive: false });
      hasBootstrappedRef.current = true;
    };

    bootstrap();
  }, []);

  useEffect(() => {
    if (!hasBootstrappedRef.current) return undefined;
    if (filters.status && isArchivedSuggestionStatus(filters.status) && !isArchiveOpen) {
      setIsArchiveOpen(true);
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      void loadData(filters, { listPage, archivePage, loadArchive: isArchiveOpen });
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [filters, listPage, archivePage, isArchiveOpen, activeSectionTab]);

  const supplierOptionsByProduct = useMemo(() => {
    const map = new Map();
    supplierProducts.forEach((row) => {
      const key = String(row.productId || '');
      if (!key) return;
      const current = map.get(key) || [];
      current.push(row);
      map.set(key, current);
    });
    return map;
  }, [supplierProducts]);

  const productMap = useMemo(() => {
    const map = new Map();
    products.forEach((product) => {
      const key = String(product.id || product.productId || '');
      if (key) map.set(key, product);
    });
    return map;
  }, [products]);

  const supplierMap = useMemo(() => {
    const map = new Map();
    suppliers.forEach((supplier) => {
      const key = String(supplier.id || '');
      if (key) map.set(key, supplier);
    });
    return map;
  }, [suppliers]);

  const enrichedRows = useMemo(() => {
    return rows.map((item) => {
      const productId = String(item.productId || '');
      const product = productMap.get(productId) || {};
      const options = [...(supplierOptionsByProduct.get(productId) || [])].sort((a, b) => {
        if (Boolean(b.isDefault) !== Boolean(a.isDefault)) return Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault));
        return Number(a.purchasePrice || Infinity) - Number(b.purchasePrice || Infinity);
      });
      const fallbackSupplier = options[0] || null;
      const chosenSupplierId = item.supplierId || (fallbackSupplier ? fallbackSupplier.supplierId : '') || product.supplierId || '';
      const chosenSupplier = supplierMap.get(String(chosenSupplierId)) || null;

      const rowContext = { ...product, ...fallbackSupplier, ...item };
      const avgDailySales = getAverageDailySales(rowContext);
      const leadTimeDays = getLeadTimeDays(rowContext);
      const daysToStockout = estimateDaysToStockout({ ...rowContext, avgDailySales, leadTimeDays });
      const riskLevel = String(item.riskLevel || classifyStockoutRisk(daysToStockout)).toLowerCase('tr-TR');
      const suggestedQty = Number(item.suggestedQty || buildSuggestionQuantity({ ...rowContext, avgDailySales, leadTimeDays }));
      const dataFreshness = item.dataFreshness || { isStale: Boolean(item.isStale), reasons: item.staleReasons || [] };
      const isStale = Boolean(item.isStale || dataFreshness.isStale);
      const backendConfidenceScore = Number(item.confidenceScore);
      const confidenceScore = Number.isFinite(backendConfidenceScore)
        ? Math.max(0, Math.min(100, Math.round(backendConfidenceScore)))
        : computeConfidenceScore({ ...rowContext, avgDailySales, leadTimeDays, daysToStockout, suggestedQty, dataFreshness, isStale });
      const explanation = buildRecommendationExplanation({ ...rowContext, avgDailySales, leadTimeDays, suggestedQty, confidenceScore, dataFreshness, isStale });
      const salesTrend = Array.isArray(item.salesTrendLast14Days) 
        ? item.salesTrendLast14Days
        : [];
      const effectiveStatus = normalizeSuggestionStatus(item.status);
      const supplierName = item.supplierName && item.supplierName !== '-'
         ? item.supplierName
        : ((chosenSupplier ? chosenSupplier.name : '') || (fallbackSupplier ? fallbackSupplier.supplierName : '') || 'Varsayılan tedarikçi yok');

      return {
        ...item,
        supplierId: chosenSupplierId || item.supplierId,
        supplierName,
        supplierMissing: !chosenSupplierId,
        purchasePrice: Number(item.unitPrice || (fallbackSupplier ? fallbackSupplier.purchasePrice : 0) || product.purchasePrice || 0),
        barcode: item.barcode || product.barcode || '-',
        shelfStock: Number(item.shelfStock ?? product.shelfStock ?? 0),
        warehouseStock: Number(item.warehouseStock ?? product.warehouseStock ?? 0),
        stockLevel: Number(item.currentStock ?? product.currentStock ?? 0),
        sold7: Number(item.sold7 || 0),
        avgDailySales,
        leadTimeDays,
        daysToStockout,
        riskLevel,
        suggestedQty,
        dataFreshness,
        isStale,
        freshnessText: buildFreshnessText({ ...item, dataFreshness, isStale }),
        status: effectiveStatus,
        confidenceScore,
        confidenceText: isStale ? 'İnceleme gerekli' : `${confidenceScore}%`,
        estimatedStockoutDate: estimateStockoutDate({ ...rowContext, avgDailySales, leadTimeDays }),
        trendDirection: resolveTrendDirection(item),
        explanation,
        salesTrend,
        actionableReason: ['manual_evaluation', 'skipped'].includes(effectiveStatus)
          ? getTurkishReason({ ...item, supplierMissing: !chosenSupplierId })
          : buildBetterReason({ ...item, sold7: Number(item.sold7 || 0), leadTimeDays, currentStock: Number(item.currentStock || 0), criticalStock: Number(item.criticalStock || 0), supplierMissing: !chosenSupplierId }),
        actionAt: getArchiveActionAt(item),
        actionBy: resolveArchiveActor(item),
      };
    });
  }, [productMap, rows, supplierMap, supplierOptionsByProduct]);

  const filteredRows = useMemo(() => {
    return enrichedRows;
  }, [enrichedRows]);

  const activeRows = useMemo(
    () => enrichedRows.filter((item) => isActiveSuggestionStatus(item.status)),
    [enrichedRows]
  );

  const archiveRows = useMemo(
    () => enrichedRows.filter((item) => isArchivedSuggestionStatus(item.status)),
    [enrichedRows]
  );

  const allActiveFilteredRows = useMemo(
    () => filteredRows.filter((item) => isActiveSuggestionStatus(item.status)),
    [filteredRows]
  );

  const activeFilteredRows = useMemo(
    () => filteredRows.filter((item) => {
      const status = normalizeSuggestionStatus(item.status);
      return isActiveSuggestionStatus(status) && status === (SECTION_TAB_STATUS[activeSectionTab] || SECTION_TAB_STATUS.pending);
    }),
    [filteredRows, activeSectionTab]
  );

  const archiveFilteredRows = useMemo(
    () => filteredRows.filter((item) => isArchivedSuggestionStatus(item.status)),
    [filteredRows]
  );

  const summary = useMemo(() => ({
    total: Number(filteredSummary?.activeCount ?? allActiveFilteredRows.length),
    pending: Number(filteredSummary?.pendingCount ?? allActiveFilteredRows.filter((item) => normalizeSuggestionStatus(item.status) === 'pending').length),
    manualEvaluation: Number(filteredSummary?.manualEvaluationCount ?? allActiveFilteredRows.filter((item) => normalizeSuggestionStatus(item.status) === 'manual_evaluation').length),
    skipped: Number(filteredSummary?.skippedCount ?? allActiveFilteredRows.filter((item) => normalizeSuggestionStatus(item.status) === 'skipped').length),
    approved: Number(
      archiveFilteredSummary?.convertedCount
      ?? archiveFilteredRows.filter((item) => normalizeSuggestionStatus(item.status) === 'converted').length
    ),
    criticalRisk: Number(filteredSummary?.highRiskCount ?? allActiveFilteredRows.filter((item) => ['critical', 'high'].includes(String(item.riskLevel || '').toLowerCase())).length),
    calendarSensitive: allActiveFilteredRows.filter((item) => containsCalendarSignal(item.reasonTags)).length,
    urgentByLeadTime: allActiveFilteredRows.filter((item) => Number(item.daysToStockout || 999) <= Number(item.leadTimeDays || 0) + 2).length,
    stockoutCount: Number(filteredSummary?.stockoutCount ?? generatorSummary?.stockoutCount ?? 0),
    archive: Number(generatorSummary?.archiveCount ?? archiveFilteredSummary?.archiveCount ?? archivePagination.total ?? 0),
    evaluated: Number(generatorSummary?.totalEvaluated || 0),
    salesDataAvailable: Math.max(0, Number(generatorSummary?.totalEvaluated || 0) - Number(generatorSummary?.noRecentSalesCount || 0)),
  }), [allActiveFilteredRows, archiveFilteredRows, archiveFilteredSummary, archivePagination.total, filteredSummary, generatorSummary]);

  const pagedRecommendationRows = activeFilteredRows;

  const pagedGroupedRows = useMemo(() => groupRecommendationsBySupplier(pagedRecommendationRows), [pagedRecommendationRows]);
  const pagedArchiveRows = archiveFilteredRows;
  const activeTotal = Number(listPagination.total || 0);
  const archiveTotal = Number(archivePagination.total || 0);

  const purchaseRiskChartData = useMemo(() => {
    const map = { critical: 0, high: 0, medium: 0, low: 0 };
    allActiveFilteredRows.forEach((item) => {
      const key = String(item.riskLevel || '').toLowerCase('tr-TR');
      if (key in map) map[key] += 1;
    });
    return [
      { name: 'Kritik', count: map.critical },
      { name: 'Yüksek', count: map.high },
      { name: 'Orta', count: map.medium },
      { name: 'Düşük', count: map.low },
    ];
  }, [allActiveFilteredRows]);

  const purchaseStatusChartData = useMemo(() => ([
    { name: 'Bekleyen', count: summary.pending },
    { name: 'Siparişe Dönüştü', count: summary.approved },
    { name: 'Reddedilen', count: archiveFilteredRows.filter((item) => normalizeSuggestionStatus(item.status) === 'rejected').length },
    { name: 'Yeniden Hesap', count: archiveFilteredRows.filter((item) => normalizeSuggestionStatus(item.status) === 'stale').length },
  ]), [archiveFilteredRows, summary]);

  const reasonDistributionData = useMemo(() => {
    const generationReasons = Array.isArray(generatorSummary?.reasonBreakdown)
      ? generatorSummary.reasonBreakdown.filter((item) => Number(item.count || 0) > 0)
      : [];
    if (generationReasons.length) {
      const total = generationReasons.reduce((sum, item) => sum + Number(item.count || 0), 0);
      return generationReasons.slice(0, 8).map((item, index) => ({
        name: item.text || reasonTagLabel[item.code] || item.code,
        count: Number(item.count || 0),
        percent: total ? Math.round((Number(item.count || 0) / total) * 100) : 0,
        color: reasonDistributionColors[index % reasonDistributionColors.length],
      }));
    }
    const counts = new Map();
    activeFilteredRows.forEach((item) => {
      getReasonDistributionSignals(item).forEach((category) => {
        counts.set(category.name, (counts.get(category.name) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .map(([name, count], index) => ({
        name,
        count,
        percent: activeFilteredRows.length ? Math.round((count / activeFilteredRows.length) * 100) : 0,
        color: reasonDistributionColors[index % reasonDistributionColors.length],
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr-TR'))
      .slice(0, 8)
      .map((item, index) => ({ ...item, color: reasonDistributionColors[index % reasonDistributionColors.length] }));
  }, [activeFilteredRows, generatorSummary]);

  const reasonDistributionMaxCount = Math.max(1, ...reasonDistributionData.map((item) => item.count));

  const selectedRows = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return activeFilteredRows.filter((item) => selectedSet.has(item.id));
  }, [activeFilteredRows, selectedIds]);

  const selectedSupplierCount = useMemo(() => {
    return new Set(selectedRows.map((item) => String(item.supplierId || item.supplierName || 'unknown'))).size;
  }, [selectedRows]);

  const criticalAlert = useMemo(() => {
    const stockoutToday = activeFilteredRows.filter((item) => Number.isFinite(item.daysToStockout) && item.daysToStockout <= 0).length;
    const urgentCount = activeFilteredRows.filter((item) => Number.isFinite(item.daysToStockout) && item.daysToStockout <= 3).length;
    if (!stockoutToday && !urgentCount) return null;
    return { stockoutToday, urgentCount };
  }, [activeFilteredRows]);

  const emptyBreakdown = useMemo(() => ({
    missingMinStock: Number(generatorSummary?.missingMinStockCount || 0),
    missingLeadTime: Number(generatorSummary?.missingLeadTimeCount || 0),
    noRecentSales: Number(generatorSummary?.noRecentSalesCount || 0),
    sufficientStock: Number(generatorSummary?.sufficientStockCount || 0),
    missingSupplier: Number(generatorSummary?.missingSupplierMappingCount || 0),
    missingMoq: Number(generatorSummary?.missingMoqOrCaseDataCount || 0),
    inboundCovered: Number(generatorSummary?.suppressedByInboundCount || 0),
    modeGuard: Number(generatorSummary?.skippedByModeOrRiskCount || 0),
    lookbackDays: Number(generatorSummary?.lookbackDays || 30),
  }), [generatorSummary]);

  const dominantDiagnosticReasons = useMemo(
    () => (Array.isArray(generatorSummary?.reasonBreakdown) ? generatorSummary.reasonBreakdown.slice(0, 4) : []),
    [generatorSummary]
  );

  useEffect(() => {
    setListPage(1);
    setArchivePage(1);
  }, [activePreset, filters, groupBySupplier, activeSectionTab]);

  useEffect(() => {
    const activeIdSet = new Set(activeRows.map((item) => item.id));
    setSelectedIds((current) => current.filter((id) => activeIdSet.has(id)));
  }, [activeRows]);

  const buildNavigationPayload = (inputRows, mode) => {
    const validItems = [];
    const invalidReasons = [];
    const seenKeys = new Set();

    inputRows.forEach((row) => {
      const normalized = buildNavigationItem(row);
      if (!normalized.valid) {
        invalidReasons.push(normalized.reason);
        return;
      }

      const dedupeKey = `${normalized.item.productId}:${normalized.item.supplierId}:${normalized.item.orderUnit}`;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);
      validItems.push(normalized.item);
    });

    if (!validItems.length) {
      return { validItems: [], invalidReasons };
    }

    const handoffId = writeSuggestionHandoff({
      mode,
      items: validItems,
      invalidReasons,
    });
    const params = new URLSearchParams({
      source: 'oneriler',
      intent: mode,
      count: String(validItems.length),
      handoffId,
    });

    return {
      validItems,
      invalidReasons,
      href: `/siparis-olustur?${params.toString()}`,
      state: {
        from: '/siparis-onerileri',
        purchaseSuggestionHandoffId: handoffId,
        purchaseSuggestion: mode === 'single' ? validItems[0] : null,
        purchaseSuggestions: validItems,
        purchaseSuggestionFlow: {
          mode,
          autoOpenRequested: true,
          createdAt: new Date().toISOString(),
          items: validItems,
          invalidReasons,
        },
      },
    };
  };

  const findDraftTarget = async (item = {}) => {
    const productId = String(item.productId || '').trim();
    const supplierId = String(item.supplierId || '').trim();
    if (!productId || !supplierId) return null;

    const cachedRows = supplierOptionsByProduct.get(productId) || [];
    const cachedMatch = cachedRows.find((row) => (
      String(row.productId || '').trim() === productId
      && String(row.supplierId || '').trim() === supplierId
      && row.isActive !== false
    ));
    if (cachedMatch) return cachedMatch;

    try {
      const rows = await procurementService.listSupplierProducts({
        productId,
        supplierId,
        page: 1,
        limit: 50,
        forceRefresh: true,
      });
      return Array.isArray(rows) ? rows.find((row) => (
        String(row.productId || '').trim() === productId
        && String(row.supplierId || '').trim() === supplierId
        && row.isActive !== false
      )) || null : null;
    } catch {
      return null;
    }
  };

  const buildSupplierProductDraftPayload = (item = {}) => {
    const purchasePrice = Number(item.purchaseUnitPrice || item.purchasePrice || item.unitPrice || 0);
    if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
      return {
        valid: false,
        reason: `${item.productName || item.sku || 'Öneri'} için tedarikçi fiyatı eksik. Taslak açmadan önce birim fiyatı tamamlayın.`,
      };
    }

    const orderUnit = String(item.orderUnit || item.minimumOrderUnit || 'adet').trim().toLocaleLowerCase('tr-TR') || 'adet';
    const minimumOrderQty = Math.max(1, Number(item.minimumOrderQty || item.recommendedQuantity || 1) || 1);

    return {
      valid: true,
      payload: {
        productId: item.productId,
        supplierId: item.supplierId,
        purchasePrice,
        currency: 'TRY',
        priceUnit: item.priceUnit || 'adet',
        minOrderUnit: item.minimumOrderUnit || orderUnit,
        defaultOrderUnit: orderUnit,
        orderUnit,
        minimumOrderQty,
        supplierProductName: item.productName || '',
        supplierProductCode: item.supplierProductCode || item.sku || '',
        supplierSku: item.sku || '',
        barcode: item.barcode || '',
        leadTimeDays: Math.max(1, Number(item.leadTimeDays || 3) || 3),
        unitsPerPack: Math.max(1, Number(item.unitsPerPack || 1) || 1),
        unitsPerBox: Math.max(1, Number(item.unitsPerCase || item.unitsPerPack || 1) || 1),
        unitsPerCase: Math.max(1, Number(item.unitsPerCase || item.unitsPerPack || 1) || 1),
        unitsPerPallet: Math.max(1, Number(item.unitsPerPallet || item.unitsPerCase || item.unitsPerPack || 1) || 1),
        note: 'Sipariş önerisinden taslak için oluşturuldu.',
        isActive: true,
      },
    };
  };

  const ensureDraftTarget = async (item = {}, options = {}) => {
    const { allowCreate = false } = options;
    const productId = String(item.productId || '').trim();
    const supplierId = String(item.supplierId || '').trim();
    if (!productId || !supplierId) {
      return { ok: false, reason: `${item.productName || item.sku || 'Öneri'} için ürün veya tedarikçi bilgisi eksik.` };
    }

    const existingTarget = await findDraftTarget(item);
    if (existingTarget) {
      const supplierProductId = String(existingTarget.id || existingTarget.supplierProductId || existingTarget.supplierProductMappingId || item.supplierProductId || '').trim();
      return {
        ok: true,
        item: {
          ...item,
          supplierProductId,
        },
      };
    }

    if (!allowCreate) {
      return {
        ok: false,
        requiresSupplierProductCreate: true,
        item,
        reason: `${item.productName || item.sku || 'Öneri'} için tedarikçi eşleşmesi oluşturulacak.`,
      };
    }

    const draftPayload = buildSupplierProductDraftPayload(item);
    if (!draftPayload.valid) return { ok: false, reason: draftPayload.reason };

    try {
      const createdTarget = await procurementService.createSupplierProduct(draftPayload.payload);
      const supplierProductId = String(createdTarget.id || createdTarget.supplierProductId || createdTarget.supplierProductMappingId || item.supplierProductId || '').trim();
      return {
        ok: true,
        item: {
          ...item,
          supplierProductId,
        },
      };
    } catch (error) {
      const message = String(error?.message || '');
      if (/zaten mevcut|already exists|409/i.test(message)) {
        const retryTarget = await findDraftTarget(item);
        if (retryTarget) {
          const supplierProductId = String(retryTarget.id || retryTarget.supplierProductId || retryTarget.supplierProductMappingId || item.supplierProductId || '').trim();
          return {
            ok: true,
            item: {
              ...item,
              supplierProductId,
            },
          };
        }
      }
      return {
        ok: false,
        reason: toUserFacingOperationError(error, `${item.productName || item.sku || 'Öneri'} için taslak hazırlığı tamamlanamadı.`),
      };
    }
  };

  const buildDraftNavigationPayload = async (inputRows, mode, options = {}) => {
    const { allowCreate = false } = options;
    const validItems = [];
    const invalidReasons = [];
    const createRequests = [];
    const seenKeys = new Set();
    let suitabilityExcluded = false;

    // Filter out unsuitable items first
    const suitableRows = [];
    inputRows.forEach((row) => {
      const hasReasonTag = (tag) => Array.isArray(row.reasonTags) && row.reasonTags.includes(tag);
      const isPassive = row.isActive === false || hasReasonTag('product_inactive');
      const isInboundCovered = hasReasonTag('inbound_covered');
      const supplierId = String(row.supplierId || row.supplier?.id || row.payload?.supplierId || '').trim();

      if (isPassive || isInboundCovered || !supplierId) {
        suitabilityExcluded = true;
        return;
      }
      suitableRows.push(row);
    });

    suitableRows.forEach((row) => {
      const normalized = buildNavigationItem(row);
      if (!normalized.valid) {
        invalidReasons.push(normalized.reason);
        return;
      }

      const dedupeKey = `${normalized.item.productId}:${normalized.item.supplierId}:${normalized.item.orderUnit}`;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);
      validItems.push(normalized.item);
    });

    if (!validItems.length) {
      return { validItems: [], invalidReasons, createRequests, suitabilityExcluded };
    }

    const availability = await Promise.all(validItems.map((item) => ensureDraftTarget(item, { allowCreate })));
    const availableItems = [];
    availability.forEach((result) => {
      if (result.ok) {
        availableItems.push(result.item);
      } else if (result.requiresSupplierProductCreate) {
        createRequests.push(result);
      } else {
        invalidReasons.push(result.reason);
      }
    });

    if (!availableItems.length) {
      return { validItems: [], invalidReasons, createRequests, suitabilityExcluded };
    }

    const handoffId = writeSuggestionHandoff({
      mode,
      items: availableItems,
      invalidReasons,
    });
    const params = new URLSearchParams({
      source: 'oneriler',
      intent: mode,
      count: String(availableItems.length),
      handoffId,
    });

    return {
      validItems: availableItems,
      invalidReasons,
      createRequests,
      suitabilityExcluded,
      href: `/siparis-olustur?${params.toString()}`,
      state: {
        from: '/siparis-onerileri',
        purchaseSuggestionHandoffId: handoffId,
        purchaseSuggestion: mode === 'single' ? availableItems[0] : null,
        purchaseSuggestions: availableItems,
        purchaseSuggestionFlow: {
          mode,
          autoOpenRequested: true,
          createdAt: new Date().toISOString(),
          items: availableItems,
          invalidReasons,
        },
      },
    };
  };

  const handleOpenComposeScreen = async (item) => {
    try {
      setProcessingId(item.id || 'compose');
      const { validItems, invalidReasons, createRequests, href, state, suitabilityExcluded } = await buildDraftNavigationPayload([item], 'single');
      if (createRequests.length) {
        setDraftCreateTarget({ mode: 'single', rows: [item], message: createRequests[0].reason });
        return;
      }
      if (!validItems.length) {
        setToast({ type: 'error', title: 'Taslakta Düzenle', message: invalidReasons[0] || 'Öneriye bağlı taslak bulunamadı.' });
        if (suitabilityExcluded) {
          setToast({ type: 'warning', title: 'Uygun Olmayan Ürün', message: 'Bazı ürünler tedarikçi/uygunluk eksikliği nedeniyle siparişe aktarılamadı.' });
        }
        return;
      }

      if (suitabilityExcluded) {
        setToast({ type: 'warning', title: 'Uygun Olmayan Ürün', message: 'Bazı ürünler tedarikçi/uygunluk eksikliği nedeniyle siparişe aktarılamadı.' });
      } else if (invalidReasons.length) {
        setToast({ type: 'warning', title: 'Taslakta Düzenle', message: invalidReasons[0] });
      }

      navigate(href, { state });
    } finally {
      setProcessingId('');
    }
  };

  const handleOpenManualComposeScreen = async (item) => {
    try {
      setProcessingId(item.id || 'compose');
      const { validItems, invalidReasons, createRequests, href, state, suitabilityExcluded } = await buildDraftNavigationPayload([item], 'manual');
      if (createRequests?.length) {
        setDraftCreateTarget({ mode: 'manual', rows: [item], message: createRequests[0].reason });
        return;
      }
      if (!validItems.length) {
        setToast({ type: 'error', title: 'Manuel Sipariş Hazırla', message: invalidReasons[0] || 'Öneriye bağlı uygun ürün bulunamadı.' });
        if (suitabilityExcluded) {
          setToast({ type: 'warning', title: 'Uygun Olmayan Ürün', message: 'Bazı ürünler tedarikçi/uygunluk eksikliği nedeniyle siparişe aktarılamadı.' });
        }
        return;
      }

      if (suitabilityExcluded) {
        setToast({ type: 'warning', title: 'Uygun Olmayan Ürün', message: 'Bazı ürünler tedarikçi/uygunluk eksikliği nedeniyle siparişe aktarılamadı.' });
      } else if (invalidReasons.length) {
        setToast({ type: 'warning', title: 'Manuel Sipariş Hazırla', message: invalidReasons[0] });
      }

      navigate(href, { state });
    } finally {
      setProcessingId('');
    }
  };

  const handleConfirmDraftCreate = async () => {
    if (!draftCreateTarget.rows.length) return;
    const isManual = draftCreateTarget.mode === 'manual';
    const actionTitle = isManual ? 'Manuel Sipariş Hazırla' : 'Taslakta Düzenle';
    try {
      setProcessingId('draft-create');
      const { validItems, invalidReasons, href, state, suitabilityExcluded } = await buildDraftNavigationPayload(
        draftCreateTarget.rows,
        draftCreateTarget.mode || 'single',
        { allowCreate: true }
      );
      if (!validItems.length) {
        setToast({ type: 'error', title: actionTitle, message: invalidReasons[0] || 'Taslak için tedarikçi eşleşmesi oluşturulamadı.' });
        if (suitabilityExcluded) {
          setToast({ type: 'warning', title: 'Uygun Olmayan Ürünler', message: 'Bazı ürünler tedarikçi/uygunluk eksikliği nedeniyle siparişe aktarılamadı.' });
        }
        return;
      }
      if (suitabilityExcluded) {
        setToast({ type: 'warning', title: 'Uygun Olmayan Ürünler', message: 'Bazı ürünler tedarikçi/uygunluk eksikliği nedeniyle siparişe aktarılamadı.' });
      } else if (invalidReasons.length) {
        setToast({
          type: 'warning',
          title: actionTitle,
          message: `${formatNumber(validItems.length)} öneri aktarıldı, ${formatNumber(invalidReasons.length)} kayıt atlandı.`,
        });
      }
      setDraftCreateTarget(null);
      navigate(href, { state });
    } catch (error) {
      setToast({ type: 'error', title: actionTitle, message: toUserFacingOperationError(error, 'Taslak için tedarikçi eşleşmesi oluşturulamadı.') });
    } finally {
      setProcessingId('');
    }
  };

  const openLinkedOrder = (order) => {
    const orderId = String(order.id || order.linkedOrderId || '').trim();
    const orderNumber = String(order.orderNumber || order.linkedOrderNumber || '').trim();
    navigate('/siparis-takibi', {
      state: {
        from: '/siparis-onerileri',
        openOrderId: orderId,
        openOrderNumber: orderNumber,
        openOrderStatus: order.status || '',
      },
    });
  };

  const handleConvertToOrder = async (item) => {
    if (!item.id) return;
    try {
      setProcessingId(item.id);
      const order = await procurementService.approveSuggestion(item.id, {});
      const createdOrder = normalizeCreatedOrderResult(order);
      setCreatedOrderNotice(createdOrder);
      setToast({
        type: 'success',
        title: createdOrder.title,
        message: createdOrder.detail,
      });
      setSelectedIds((current) => current.filter((id) => id !== item.id));
      await loadData(filters, { listPage, archivePage, loadArchive: isArchiveOpen });
    } catch (error) {
      setToast({
        type: 'error',
        title: 'Siparişe Dönüştür',
        message: `${item.productName || item.sku || 'Öneri'}: ${toUserFacingOperationError(error, 'Öneri siparişe dönüştürülemedi.')}`,
      });
    } finally {
      setProcessingId('');
    }
  };

  const handleEditSave = async (event) => {
    event.preventDefault();
    if (!editingItem) return;

    try {
      setProcessingId(editingItem.id);
      await procurementService.updateSuggestion(editingItem.id, {
        supplierId: editForm.supplierId,
        suggestedQty: Number(editForm.suggestedQty),
        unitPrice: parseMoneyInput(editForm.unitPrice),
      });
      setToast({ type: 'success', title: 'Sipariş Önerileri', message: 'Öneri bilgileri kaydedildi.' });
      setIsEditModalOpen(false);
      setEditingItem(null);
      await loadData(filters, { listPage, archivePage, loadArchive: isArchiveOpen });
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Önerileri', message: toUserFacingOperationError(error, 'Öneri güncellenemedi.') });
    } finally {
      setProcessingId('');
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    try {
      setProcessingId(rejectTarget.id);
      await procurementService.rejectSuggestion(rejectTarget.id);
      setToast({ type: 'success', title: 'Sipariş Önerileri', message: 'Öneri reddedildi.' });
      setSelectedIds((current) => current.filter((id) => id !== rejectTarget.id));
      setRejectTarget(null);
      await loadData(filters, { listPage, archivePage, loadArchive: isArchiveOpen });
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Önerileri', message: toUserFacingOperationError(error, 'Öneri reddedilemedi.') });
      setRejectTarget(null);
    } finally {
      setProcessingId('');
    }
  };

  const runBulkAction = async (actionType) => {
    if (!selectedRows.length) return;
    try {
      setProcessingId(`bulk-${actionType}`);

      if (actionType === 'compose') {
        const { validItems, invalidReasons, createRequests, href, state, suitabilityExcluded } = await buildDraftNavigationPayload(selectedRows, 'bulk');
        if (createRequests.length) {
          setDraftCreateTarget({
            mode: 'bulk',
            rows: selectedRows,
            message: `${formatNumber(createRequests.length)} öneri için tedarikçi eşleşmesi oluşturulacak.`,
          });
          return;
        }
        if (!validItems.length) {
          setToast({ type: 'error', title: 'Taslakta Düzenle', message: invalidReasons[0] || 'Taslağa aktarılabilecek öneri bulunamadı.' });
          if (suitabilityExcluded) {
            setToast({ type: 'warning', title: 'Uygun Olmayan Ürünler', message: 'Bazı ürünler tedarikçi/uygunluk eksikliği nedeniyle siparişe aktarılamadı.' });
          }
          return;
        }

        if (suitabilityExcluded) {
          setToast({ type: 'warning', title: 'Uygun Olmayan Ürünler', message: 'Bazı ürünler tedarikçi/uygunluk eksikliği nedeniyle siparişe aktarılamadı.' });
        } else if (invalidReasons.length) {
          setToast({
            type: 'warning',
            title: 'Taslakta Düzenle',
            message: `${formatNumber(validItems.length)} öneri aktarıldı, ${formatNumber(invalidReasons.length)} kayıt atlandı.`,
          });
        }

        navigate(href, { state });
      }

      if (actionType === 'manual') {
        const { validItems, invalidReasons, createRequests, href, state, suitabilityExcluded } = await buildDraftNavigationPayload(selectedRows, 'manual');
        if (createRequests?.length) {
          setDraftCreateTarget({
            mode: 'manual',
            rows: selectedRows,
            message: `${formatNumber(createRequests.length)} öneri için tedarikçi eşleşmesi oluşturulacak.`,
          });
          return;
        }
        if (!validItems.length) {
          setToast({ type: 'error', title: 'Manuel Sipariş Hazırla', message: invalidReasons[0] || 'Seçili ürünlerden sipariş hazırlanamadı.' });
          if (suitabilityExcluded) {
            setToast({ type: 'warning', title: 'Uygun Olmayan Ürünler', message: 'Bazı ürünler tedarikçi/uygunluk eksikliği nedeniyle siparişe aktarılamadı.' });
          }
          return;
        }
        if (suitabilityExcluded) {
          setToast({ type: 'warning', title: 'Uygun Olmayan Ürünler', message: 'Bazı ürünler tedarikçi/uygunluk eksikliği nedeniyle siparişe aktarılamadı.' });
        } else if (invalidReasons.length) {
          setToast({
            type: 'warning',
            title: 'Manuel Sipariş Hazırla',
            message: `${formatNumber(validItems.length)} ürün aktarıldı, ${formatNumber(invalidReasons.length)} kayıt atlandı.`,
          });
        }
        navigate(href, { state });
      }

      if (actionType === 'convert') {
        const results = [];
        for (const item of selectedRows) {
          try {
            const order = normalizeCreatedOrderResult(await procurementService.approveSuggestion(item.id, {}));
            results.push({ ok: true, item, order });
          } catch (error) {
            results.push({ ok: false, item, error });
          }
        }

        const successCount = results.filter((result) => result.ok).length;
        const failed = results.filter((result) => !result.ok);
        const firstOrder = results.find((result) => result.ok)?.order || null;
        if (firstOrder) {
          setCreatedOrderNotice(firstOrder);
        }
        setSelectedIds([]);
        await loadData(filters, { listPage, archivePage, loadArchive: isArchiveOpen });

        if (failed.length) {
          const failureDetails = failed.slice(0, 3).map((result) => (
            `${result.item.productName || result.item.sku || 'Öneri'}: ${toUserFacingOperationError(result.error, 'Dönüştürülemedi')}`
          )).join(' | ');
          const moreText = failed.length > 3 ? ` | +${formatNumber(failed.length - 3)} kayıt daha` : '';
          setToast({
            type: successCount ? 'warning' : 'error',
            title: 'Toplu Siparişe Dönüştür',
            message: `${formatNumber(successCount)} öneri siparişe dönüştü, ${formatNumber(failed.length)} öneri tamamlanamadı. ${failureDetails}${moreText}`,
          });
          return;
        }

        setToast({
          type: 'success',
          title: 'Siparişler Onaya Gönderildi',
          message: `${formatNumber(successCount)} öneri siparişe dönüştürüldü ve onay bekleyen siparişlere eklendi.`,
        });
      }

    } catch (error) {
      setToast({ type: 'error', title: 'Toplu İşlem', message: toUserFacingOperationError(error, 'Toplu işlem tamamlanamadı.') });
    } finally {
      setProcessingId('');
    }
  };

  const handleBulkEditSave = async (event) => {
    event.preventDefault();
    if (!selectedRows.length) return;

    const rawValue = Number(bulkEditForm.value);
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      setToast({ type: 'error', title: 'Toplu Düzenleme', message: 'Geçerli bir değer girin.' });
      return;
    }

    try {
      setProcessingId('bulk-edit');
      await Promise.all(selectedRows.map((item) => {
        const baseQty = Number(item.suggestedQty || 0);
        const nextQty = bulkEditForm.mode === 'set' 
          ? rawValue
          : Math.max(1, Math.ceil(baseQty * rawValue));
        return procurementService.updateSuggestion(item.id, { suggestedQty: nextQty });
      }));

      setToast({ type: 'success', title: 'Toplu Düzenleme', message: 'Seçilen öneriler kaydedildi.' });
      setIsBulkEditModalOpen(false);
      setBulkEditForm(initialBulkEditForm);
      await loadData(filters, { listPage, archivePage, loadArchive: isArchiveOpen });
    } catch (error) {
      setToast({ type: 'error', title: 'Toplu Düzenleme', message: toUserFacingOperationError(error, 'Seçilen öneriler güncellenemedi.') });
    } finally {
      setProcessingId('');
    }
  };

  const togglePreset = (presetKey) => {
    setActivePreset((current) => {
      const next = current === presetKey ? '' : presetKey;
      setFilters((old) => applyPresetToFilters(old, next));
      return next;
    });
  };

  const hasActiveFilters = Boolean(
    filters.search ||
    filters.supplierId ||
    filters.riskLevel ||
    filters.preset ||
    (filters.status && filters.status !== activeSectionTab)
  );

  const listMetricCards = [
    { key: 'total', label: 'Toplam', value: summary.total, icon: ClipboardList, tone: 'blue', caption: 'Filtreye uyan öneri' },
    { key: 'pending', label: 'Bekleyen', value: summary.pending, icon: Clock3, tone: 'amber', caption: 'Karar bekleyen satır' },
    { key: 'critical', label: 'Yüksek/Kritik', value: summary.criticalRisk, icon: AlertTriangle, tone: 'red', caption: 'Öncelikli müdahale' },
    { key: 'selected', label: 'Seçili', value: selectedRows.length, icon: PackageCheck, tone: 'cyan', caption: 'Toplu işleme hazır' },
  ];

  return (
    <div className="page-stack purchase-suggestions-page-v2">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <div className="purchase-suggestions-shell">
        <PageHeader
          className="dashboard-hero ps-header"
          icon={<ClipboardList size={22} />}
          title="Sipariş Önerileri"
          description="Stok ve talep verilerine göre sipariş önerilerini yönetin."
          actions={canManageSuggestions ? (
            <div className="ps-header-actions">
              <button
                className="primary-button ps-btn"
                type="button"
                onClick={() => regenerateSuggestions('manual')}
                disabled={isGeneratingSuggestions}
              >
                <Sparkles size={16} /> {processingId === 'manual' || processingId === 'generate' ? 'Üretiliyor...' : 'Sipariş Önerisi Üret'}
              </button>
            </div>
          ) : null}
        />

        {criticalAlert ? (
          <div className="ps-alert" role="alert" aria-live="polite">
            <AlertTriangle size={18} />
            <span>
              {criticalAlert.stockoutToday > 0 ? <><strong>{formatNumber(criticalAlert.stockoutToday)}</strong> ürün bugün stok dışı kalabilir.</> : null}
              {criticalAlert.stockoutToday > 0 && criticalAlert.urgentCount > 0 ? ' ' : ''}
              {criticalAlert.urgentCount > 0 ? <><strong>{formatNumber(criticalAlert.urgentCount)}</strong> ürün için acil sipariş gerekiyor.</> : null}
            </span>
          </div>
        ) : null}

        {createdOrderNotice ? (
          <div className="ps-order-created-notice" role="status" aria-live="polite">
            <CheckCircle2 size={18} />
            <div>
              <strong>{createdOrderNotice.title}</strong>
              <span>{createdOrderNotice.detail}</span>
            </div>
            <button type="button" className="ghost-button ps-btn" onClick={() => openLinkedOrder(createdOrderNotice)}>
              {createdOrderNotice.actionLabel}
            </button>
            <button type="button" className="ghost-button ps-notice-close" aria-label="Bilgilendirmeyi kapat" onClick={() => setCreatedOrderNotice(null)}>
              ×
            </button>
          </div>
        ) : null}

        <section className="ps-kpi-grid" aria-label="KPI özet">
          <div className="ps-kpi ps-kpi-blue">
            <span className="ps-kpi-icon"><ClipboardList size={18} /></span>
            <div><div className="ps-kpi-title">Bekleyen Öneri</div><div className="ps-kpi-value">{formatNumber(summary.pending)}</div></div>
          </div>
          <div className="ps-kpi ps-kpi-amber">
            <span className="ps-kpi-icon"><Clock3 size={18} /></span>
            <div><div className="ps-kpi-title">Manuel Değerlendirme</div><div className="ps-kpi-value">{formatNumber(summary.manualEvaluation)}</div></div>
          </div>
          <div className="ps-kpi ps-kpi-green">
            <span className="ps-kpi-icon"><Info size={18} /></span>
            <div><div className="ps-kpi-title">Öneriye Alınmayan</div><div className="ps-kpi-value">{formatNumber(summary.skipped)}</div></div>
          </div>
          <div className="ps-kpi ps-kpi-red">
            <span className="ps-kpi-icon"><AlertTriangle size={18} /></span>
            <div><div className="ps-kpi-title">Yüksek/Kritik Risk</div><div className="ps-kpi-value">{formatNumber(summary.criticalRisk)}</div></div>
          </div>
          <div className="ps-kpi ps-kpi-purple">
            <span className="ps-kpi-icon"><ClipboardList size={18} /></span>
            <div><div className="ps-kpi-title">Arşiv</div><div className="ps-kpi-value">{formatNumber(summary.archive)}</div></div>
          </div>
          <div className="ps-kpi ps-kpi-cyan">
            <span className="ps-kpi-icon"><CalendarDays size={18} /></span>
            <div><div className="ps-kpi-title">30 Günlük Satış Verisi</div><div className="ps-kpi-value">{formatNumber(summary.salesDataAvailable)}</div></div>
          </div>
        </section>

        <section className="ps-diagnostic-strip" aria-label="Öneri motoru tanı özeti">
          <div className="ps-diagnostic-copy">
            <span className="ps-diagnostic-icon"><Info size={18} /></span>
            <div>
              <strong>Öneri motoru {formatNumber(summary.evaluated)} ürünü son {formatNumber(emptyBreakdown.lookbackDays)} günlük satış, stok, tedarikçi ve açık sipariş verileriyle değerlendirdi.</strong>
              <span>
                Bekleyen öneri oluşmadığında aşağıdaki nedenler bunun bir hesaplama hatası mı, yoksa iş koşullarının sonucu mu olduğunu açıklar.
              </span>
            </div>
          </div>
          <div className="ps-diagnostic-reasons">
            {dominantDiagnosticReasons.length ? dominantDiagnosticReasons.map((item) => (
              <div key={item.code}>
                <strong>{formatNumber(item.count)}</strong>
                <span>{item.text || reasonTagLabel[item.code] || item.code}</span>
              </div>
            )) : (
              <div>
                <strong>0</strong>
                <span>Henüz tanı özeti oluşmadı</span>
              </div>
            )}
          </div>
        </section>

        <section className="ps-chart-grid" aria-label="Grafikler">
          <div className="ps-card ps-chart-card">
            <div className="ps-card-head">
              <h3><BarChart3 size={16} /> Risk Dağılımı</h3>
            </div>
            <div className="ps-card-body">
              {purchaseRiskChartData.some((item) => item.count > 0) ? (
                <ResponsiveContainer width="100%" height={220}>
                  <RBarChart data={purchaseRiskChartData} margin={{ top: 12, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <RTooltip formatter={chartTooltipFormatter('Risk Adedi')} contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
                    <Bar dataKey="count" name="Risk Adedi" fill="#2563eb" radius={[8, 8, 0, 0]} />
                  </RBarChart>
                </ResponsiveContainer>
              ) : (
                <div className="ps-empty-state" role="status">
                  <Info size={18} />
                  <strong>Henüz veri oluşmadı</strong>
                  <span>Risk sinyalleri geldikçe bu grafikte dağılım görünür.</span>
                </div>
              )}
            </div>
          </div>

          <div className="ps-card ps-chart-card">
            <div className="ps-card-head">
              <h3><BarChart3 size={16} /> Durum Dağılımı</h3>
            </div>
            <div className="ps-card-body">
              {purchaseStatusChartData.some((item) => item.count > 0) ? (
                <ResponsiveContainer width="100%" height={220}>
                  <RBarChart data={purchaseStatusChartData} margin={{ top: 12, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <RTooltip formatter={chartTooltipFormatter('Öneri Sayısı')} contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
                    <Bar dataKey="count" name="Öneri Sayısı" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
                  </RBarChart>
                </ResponsiveContainer>
              ) : (
                <div className="ps-empty-state" role="status">
                  <Info size={18} />
                  <strong>Henüz veri oluşmadı</strong>
                  <span>Onay ve bekleme dağılımı oluştuğunda burada gösterilir.</span>
                </div>
              )}
            </div>
          </div>

          <div className="ps-card ps-chart-card">
            <div className="ps-card-head">
              <h3><BarChart3 size={16} /> Sipariş Önerisi Nedenleri</h3>
              <p>Önerilerin hangi operasyonel nedenlerle oluştuğunu gösterir.</p>
            </div>
            <div className="ps-card-body">
              {reasonDistributionData.length ? (
                <div className="ps-reason-distribution-chart" role="img" aria-label="Sipariş önerisi neden dağılımı">
                  {reasonDistributionData.map((item) => (
                    <div
                      className="ps-reason-distribution-row"
                      key={item.name}
                      title={`${item.name} - ${formatNumber(item.count)} öneri (%${formatNumber(item.percent)})`}
                    >
                      <div className="ps-reason-distribution-label">
                        <span>{item.name}</span>
                        <strong>{formatNumber(item.count)} öneri · %{formatNumber(item.percent)}</strong>
                      </div>
                      <div className="ps-reason-distribution-track" aria-hidden="true">
                        <span
                          className="ps-reason-distribution-fill"
                          style={{
                            '--ps-reason-width': `${Math.max(8, (item.count / reasonDistributionMaxCount) * 100)}%`,
                            '--ps-reason-color': item.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ps-empty-state" role="status">
                  <Info size={18} />
                  <strong>Henüz tanı verisi oluşmadı</strong>
                  <span>Öneri motoru çalıştırıldığında uygunluk ve engel nedenleri burada özetlenir.</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="ps-card ps-filter-card" aria-label="Filtre paneli">
          <div className="ps-card-head">
            <div className="ps-head-main">
              <div className="mod-card-icon mod-icon-cyan"><Info size={16} /></div>
              <div><h3>Filtre Paneli</h3><p>Filtreler listeye ve sayaçlara birlikte uygulanır; sonuçlar aynı öneri setinden hesaplanır.</p></div>
            </div>
          </div>

          <FilterBar className="ps-filter-toolbar ps-filter-toolbar-single-row" actions={null}>
            <div className="ps-filter-row">
              <div className="ps-filter-group ps-filter-group--primary">
                <label className="field-group ps-search-field">
                  <span>Arama</span>
                  <input
                    value={filters.search}
                    onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                    placeholder="Ürün, SKU veya tedarikçi ara"
                  />
	                </label>

                <div className="ps-filter-control-row">
                <label className="field-group ps-filter-field ps-filter-field--status">
                  <span>Durum</span>
                  <select
                    value={filters.status}
                    onChange={(event) => {
                      const val = event.target.value;
                      setFilters((current) => ({ ...current, status: val }));
                      if (val === 'pending' || val === 'manual_evaluation' || val === 'skipped') {
                        setActiveSectionTab(val);
                      }
                      setSelectedIds([]);
                    }}
                  >
                    <option value="">Tüm Durumlar</option>
                    <option value="pending">Otomatik Öneri (Bekleyen)</option>
                    <option value="manual_evaluation">Manuel Değerlendirme</option>
                    <option value="skipped">Öneriye Alınmadı</option>
                    <option value="approved">Siparişe Dönüştü</option>
                    <option value="rejected">Reddedildi</option>
                    <option value="archived">Arşivlendi</option>
                    <option value="stale">Yeniden Hesap Gerekli</option>
                  </select>
                </label>
                <label className="field-group ps-filter-field ps-filter-field--risk">
                  <span>Risk</span>
                  <select value={filters.riskLevel} onChange={(event) => setFilters((current) => ({ ...current, riskLevel: event.target.value }))}>
                    <option value="">Tüm Riskler</option>
                    <option value="critical">Kritik</option>
                    <option value="high">Yüksek</option>
                    <option value="medium">Orta</option>
                    <option value="low">Düşük</option>
                  </select>
                </label>
                <label className="field-group ps-filter-field">
                  <span>Tedarikçi</span>
                  <select value={filters.supplierId} onFocus={() => { void loadSuppliers(); }} onChange={(event) => setFilters((current) => ({ ...current, supplierId: event.target.value }))}>
                    <option value="">Tüm tedarikçiler</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                    ))}
                  </select>
                </label>
                <div className="field-group ps-view-toggle">
                  <span>Görünüm</span>
                  <div className="ps-segmented-control" role="group" aria-label="Görünüm seçimi">
                    <button
                      type="button"
                      className={`ghost-button ps-btn ps-segment ${!groupBySupplier ? 'is-active' : ''}`}
                      onClick={() => setGroupBySupplier(false)}
                    >
                      Liste
                    </button>
                    <button
                      type="button"
                      className={`ghost-button ps-btn ps-segment ${groupBySupplier ? 'is-active' : ''}`}
                      aria-label="Görünüm"
                      onClick={() => setGroupBySupplier(true)}
                    >
                      Tedarikçi
                    </button>
                  </div>
                </div>
                </div>
              </div>

	              <div className="ps-filter-group ps-filter-group--presets">
                <div className="ps-quick-chips" role="group" aria-label="Hızlı filtreler">
                  {PRESET_DEFINITIONS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      title={preset.label}
                      aria-label={preset.ariaLabel || preset.label}
                      className={`ghost-button ps-quick-chip ${activePreset === preset.key ? 'is-active' : ''}`}
                      onClick={() => togglePreset(preset.key)}
                    >
                      {preset.compactLabel || preset.label}
                    </button>
                  ))}
                </div>
	              </div>
	              <div className="ps-filter-group ps-filter-group--actions">
	                <div className="ps-filter-buttons">
                  <button className="primary-button ps-btn" type="button" onClick={() => loadData(filters, { listPage, archivePage, loadArchive: isArchiveOpen })} disabled={isLoading}>Filtrele</button>
                  <button
                    className="ghost-button ps-btn"
                    type="button"
                    onClick={() => { setFilters(initialFilters); setActivePreset(''); }}
                  >
                    Temizle
                  </button>
                </div>
              </div>
            </div>
          </FilterBar>
        </section>

        <section className="ps-two-col">
          <section className="ps-card ps-list-card" data-testid="order-recommendation-list-card" aria-label="Sipariş öneri listesi">
            <div className="ps-card-head">
              <div className="ps-head-main">
                <div className="mod-card-icon mod-icon-indigo"><PackageCheck size={16} /></div>
                <div>
                  <h3>Sipariş Öneri Listesi</h3>
                  <p>
                    {activeSectionTab === 'skipped'
                      ? 'Bu ürünler otomatik sipariş önerisine alınmadı. Stok tükenmiş ve tedarikçi bilgisi uygun olan ürünleri seçerek manuel sipariş hazırlayabilirsiniz.'
                      : activeSectionTab === 'stockout'
                      ? 'Stoğu 0 olan ve siparişe uygun ürünleri buradan seçip sipariş hazırlayabilirsiniz.'
                      : 'Ürün bazında önerilen miktarı ve risk sinyallerini görün.'}
                  </p>
                </div>
              </div>
              <MinimalPaginationControls
                page={listPage}
                pageSize={TABLE_PAGE_SIZE}
                total={activeTotal}
                onPageChange={setListPage}
                label="Sipariş öneri listesi üst sayfalama"
              />
            </div>

            <div className="ps-section-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeSectionTab === 'pending'}
                className={`ps-section-tab-btn ${activeSectionTab === 'pending' ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveSectionTab('pending');
                  setListPage(1);
                  setFilters((old) => ({ ...old, status: '' }));
                  setSelectedIds([]);
                }}
              >
                <span>Otomatik Öneriler</span>
                <span className="ps-tab-badge is-pending">{summary.pending}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeSectionTab === 'manual_evaluation'}
                className={`ps-section-tab-btn ${activeSectionTab === 'manual_evaluation' ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveSectionTab('manual_evaluation');
                  setListPage(1);
                  setFilters((old) => ({ ...old, status: '' }));
                  setSelectedIds([]);
                }}
              >
                <span>Manuel Değerlendirme</span>
                <span className="ps-tab-badge is-manual">{summary.manualEvaluation}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeSectionTab === 'skipped'}
                className={`ps-section-tab-btn ${activeSectionTab === 'skipped' ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveSectionTab('skipped');
                  setListPage(1);
                  setFilters((old) => ({ ...old, status: '' }));
                  setSelectedIds([]);
                }}
              >
                <span>Öneriye Alınmayanlar</span>
                <span className="ps-tab-badge is-skipped">{summary.skipped}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeSectionTab === 'stockout'}
                className={`ps-section-tab-btn ${activeSectionTab === 'stockout' ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveSectionTab('stockout');
                  setListPage(1);
                  setFilters((old) => ({ ...old, status: '' }));
                  setSelectedIds([]);
                }}
              >
                <span>Stoğu Tükenmiş Ürünler</span>
                <span className="ps-tab-badge is-stockout">{summary.stockoutCount}</span>
              </button>
            </div>

            <div className="ps-metric-grid" aria-label="Liste metrikleri">
              {listMetricCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div key={card.key} className={`ps-metric ps-metric-${card.tone}`}>
                    <span className="ps-metric-icon"><Icon size={16} /></span>
                    <div className="ps-metric-body">
                      <div className="ps-metric-label">{card.label}</div>
                      <div className="ps-metric-value">{formatNumber(card.value)}</div>
                      <div className="ps-metric-caption">{card.caption}</div>
                    </div>
                  </div>
                );
              })}
            </div>

          {!isLoading && selectedRows.length ? (
            <div className="ps-bulk-bar" aria-live="polite">
              <div>
                <strong>{formatNumber(selectedRows.length)} öneri seçildi</strong>
                <span>{formatNumber(selectedSupplierCount)} tedarikçiye dağılmış durumda.</span>
              </div>
              <div className="ps-bulk-actions">
                {activeSectionTab === 'skipped' || activeSectionTab === 'stockout' ? (
                  <button
                    type="button"
                    className="primary-button ps-btn"
                    onClick={() => runBulkAction('manual')}
                    disabled={isBulkProcessing}
                  >
                    Seçili Ürünlerden Sipariş Hazırla
                  </button>
                ) : (
                  <>
                    <button type="button" className="primary-button ps-btn" onClick={() => runBulkAction('compose')} disabled={isBulkProcessing}>Toplu Siparişe Gönder</button>
                    <button type="button" className="ghost-button ps-btn" onClick={() => runBulkAction('convert')} disabled={isBulkProcessing}>Toplu Siparişe Dönüştür</button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="table-panel loading-state"><span className="loader"></span><p>Veriler yükleniyor...</p></div>
          ) : activeFilteredRows.length === 0 && hasActiveFilters ? (
            <div className="ps-empty-card" data-testid="order-recommendations-filter-empty-state">
              <div className="ps-empty-head">
                <Info size={18} />
                <div>
                  <h4>Aktif listede filtreye uyan öneri bulunamadı</h4>
                  <p>Arama ve durum filtreleri aktif öneri listesini daraltıyor.</p>
                </div>
              </div>
              <div className="ps-empty-actions">
                <button
                  className="ghost-button ps-btn"
                  type="button"
                  onClick={() => { setFilters(initialFilters); setActivePreset(''); }}
                >
                  Filtreleri Temizle
                </button>
              </div>
            </div>
          ) : activeFilteredRows.length === 0 ? (
            <div className="ps-empty-card" data-testid="order-recommendations-empty-state">
              <div className="ps-empty-head">
                <Info size={18} />
                <div>
                  {activeSectionTab === 'pending' ? (
                    <>
                      <h4>Otomatik sipariş önerisi bulunmuyor</h4>
                      <p>
                        {dominantDiagnosticReasons[0]
                          ? `Motor çalıştı; en baskın engel ${dominantDiagnosticReasons[0].text || reasonTagLabel[dominantDiagnosticReasons[0].code] || dominantDiagnosticReasons[0].code} (${formatNumber(dominantDiagnosticReasons[0].count)} ürün).`
                          : 'Motor çalıştı ancak mevcut stok ve tedarik koşulları otomatik sipariş ihtiyacı üretmedi.'}
                        {' '}Manuel değerlendirme ve öneriye alınmayan kayıtlar diğer sekmelerde görülebilir.
                      </p>
                    </>
                  ) : activeSectionTab === 'manual_evaluation' ? (
                    <>
                      <h4>Manuel değerlendirme bekleyen ürün bulunmuyor</h4>
                      <p>Manuel değerlendirme bekleyen ürün bulunmuyor.</p>
                    </>
                  ) : activeSectionTab === 'stockout' ? (
                    <>
                      <h4>Stoğu tükenmiş uygun ürün bulunmuyor</h4>
                      <p>Siparişe uygun ve stoğu tükenmiş durumda olan herhangi bir ürün bulunmuyor.</p>
                    </>
                  ) : (
                    <>
                      <h4>Öneriye alınmayan ürün bulunmuyor</h4>
                      <p>Öneriye alınmayan ürün bulunmuyor.</p>
                    </>
                  )}
                </div>
              </div>
              {activeSectionTab === 'pending' && (
                <>
                  <div className="ps-empty-metrics">
                    <div>
                      <strong>{formatNumber(emptyBreakdown.missingMinStock)}</strong>
                      <span>Min. stok tanımı eksik ürün</span>
                      <small>Genel üretim özeti; aktif filtrelerden bağımsızdır.</small>
                    </div>
                    <div>
                      <strong>{formatNumber(emptyBreakdown.missingLeadTime)}</strong>
                      <span>Temin tanımı eksik ürün</span>
                      <small>Genel üretim özeti; aktif filtrelerden bağımsızdır.</small>
                    </div>
                    <div>
                      <strong>{formatNumber(emptyBreakdown.noRecentSales)}</strong>
                      <span>Son {emptyBreakdown.lookbackDays} günde satışı olmayan ürün</span>
                      <small>Genel üretim özeti; aktif filtrelerden bağımsızdır.</small>
                    </div>
                    <div>
                      <strong>{formatNumber(emptyBreakdown.sufficientStock)}</strong>
                      <span>Stoku yeterli / net ihtiyacı olmayan ürün</span>
                      <small>Mevcut ve yoldaki stok hedef seviyeyi karşılıyor.</small>
                    </div>
                    <div>
                      <strong>{formatNumber(emptyBreakdown.missingSupplier)}</strong>
                      <span>Tedarikçi eşleşmesi eksik ürün</span>
                      <small>Aktif supplier-product eşleşmesi olmadan otomatik öneri kurulmaz.</small>
                    </div>
                    <div>
                      <strong>{formatNumber(emptyBreakdown.missingMoq)}</strong>
                      <span>MOQ veya paket/koli bilgisi eksik ürün</span>
                      <small>Sipariş miktarı güvenle yuvarlanamadığı için öneri bastırılır.</small>
                    </div>
                    <div>
                      <strong>{formatNumber(emptyBreakdown.inboundCovered)}</strong>
                      <span>Açık siparişi ihtiyacı karşılayan ürün</span>
                      <small>Yoldaki miktar hedef stoğu karşıladığı için yeni sipariş önerilmez.</small>
                    </div>
                    <div>
                      <strong>{formatNumber(emptyBreakdown.modeGuard)}</strong>
                      <span>Risk/mod koşulunu karşılamayan ürün</span>
                      <small>Net ihtiyaç olsa bile seçilen üretim modunun öncelik eşiği sağlanmadı.</small>
                    </div>
                    <div>
                      <strong>{formatNumber(summary.salesDataAvailable)}</strong>
                      <span>Son {emptyBreakdown.lookbackDays} günde satış verisi bulunan ürün</span>
                      <small>Genel üretim özeti; aktif filtrelerden bağımsızdır.</small>
                    </div>
                  </div>
                  <div className="ps-empty-actions">
                    <button className="primary-button ps-btn" type="button" onClick={() => regenerateSuggestions('manual')} disabled={isGeneratingSuggestions}>
                      Yeniden Hesapla
                    </button>
                    <button className="ghost-button ps-btn" type="button" onClick={() => navigate('/urunler')}>Eksik Verileri Tamamla</button>
                    <button className="ghost-button ps-btn" type="button" onClick={() => navigate('/siparis-olustur')}>Tedarikçi Ayarlarına Git</button>
                  </div>
                </>
              )}
            </div>
          ) : groupBySupplier ? (
            <div className="purchase-suggestions-group-list" data-testid="supplier-grouping-ui">
              {pagedGroupedRows.map((group) => (
                <section className="purchase-suggestions-group" key={group.supplierId}>
                  <header>
                    <h4>{group.supplierName}</h4>
                    <span>{formatNumber(group.rows.length)} öneri</span>
                  </header>
                  <RecommendationTable
                    rows={group.rows}
                    selectedIds={selectedIds}
                    setSelectedIds={setSelectedIds}
                    onOpenDetail={setDetailTarget}
                    handleConvertToOrder={handleConvertToOrder}
                    handleOpenComposeScreen={handleOpenComposeScreen}
                    handleOpenManualComposeScreen={handleOpenManualComposeScreen}
                    setRejectTarget={setRejectTarget}
                    processingId={processingId}
                    isAdmin={isAdmin}
                    sectionType={activeSectionTab}
                  />
                </section>
              ))}
            </div>
          ) : (
            <RecommendationTable
              rows={pagedRecommendationRows}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              onOpenDetail={setDetailTarget}
              handleConvertToOrder={handleConvertToOrder}
              handleOpenComposeScreen={handleOpenComposeScreen}
              handleOpenManualComposeScreen={handleOpenManualComposeScreen}
              setRejectTarget={setRejectTarget}
              processingId={processingId}
              isAdmin={isAdmin}
              sectionType={activeSectionTab}
            />
          )}
          </section>
        </section>

        <section className="ps-card ps-archive-card" aria-label="Öneri arşivi">
          <div className="ps-card-head">
            <div className="ps-head-main">
              <div className="mod-card-icon mod-icon-emerald"><ClipboardList size={16} /></div>
              <div>
                <h3>Öneri Arşivi</h3>
                <p>Siparişe dönüşen ve reddedilen öneriler burada tutulur.</p>
              </div>
            </div>
            <MinimalPaginationControls
              page={archivePage}
              pageSize={TABLE_PAGE_SIZE}
              total={archiveTotal}
              onPageChange={setArchivePage}
              label="Öneri arşivi sayfalama"
            />
          </div>

          <div className="ps-card-body">
            {!isArchiveOpen ? (
              <div className="ps-empty-card ps-archive-empty">
                <div className="ps-empty-head">
                  <Info size={18} />
                  <div>
                    <h4>Arşiv ilk açılışta yüklenmedi.</h4>
                    <p>Arşiv kayıtları yalnız bu bölüm açıldığında sayfalı olarak alınır.</p>
                  </div>
                </div>
                <button type="button" className="primary-button ps-btn" onClick={() => { setIsArchiveOpen(true); if (!archiveLoaded) void loadData(filters, { listPage, archivePage, loadArchive: true }); }}>
                  Arşivi Göster
                </button>
              </div>
            ) : archiveFilteredRows.length ? (
              <>
                <div className="table-wrapper analysis-table-wrapper">
                  <table className="data-table purchase-suggestions-table ps-archive-table">
                    <thead>
                      <tr>
                        <th>Ürün</th>
                        <th>Tedarikçi</th>
                        <th>Önerilen Miktar</th>
                        <th>Durum</th>
                        <th>İşlem Tarihi</th>
                        <th>İşlem Yapan</th>
                        <th>Öneri Nedeni</th>
                        <th>Aksiyon</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedArchiveRows.map((item) => {
                        const archiveReason = cleanReasonText(item.reason || item.actionableReason || item.explanation.summary || '-');
                        return (
                          <tr key={`archive-${item.id}`}>
                            <td>
                              <div className="ps-supplier-cell ps-archive-product-cell">
                                <strong>{item.productName || '-'}</strong>
                                <span>SKU: {item.sku || '-'}</span>
                              </div>
                            </td>
                            <td className="ps-archive-cell-supplier" title={item.supplierName || 'Tedarikçi atanmadı'}>
                              <span>{item.supplierName || 'Tedarikçi atanmadı'}</span>
                            </td>
                            <td className="ps-archive-cell-qty">{formatSuggestedQuantityCell(item).primary}</td>
                            <td className="ps-archive-cell-status">
                              <StatusBadge tone={statusTone[normalizeSuggestionStatus(item.status)] || 'neutral'}>
                                {statusLabel[normalizeSuggestionStatus(item.status)] || item.status || '-'}
                              </StatusBadge>
                            </td>
                            <td className="ps-archive-cell-date">{formatActionDateTime(item.actionAt)}</td>
                            <td className="ps-archive-cell-actor" title={resolveArchiveActor(item)}>
                              <span>{resolveArchiveActor(item)}</span>
                            </td>
                            <td className="ps-archive-cell-reason" title={archiveReason}>
                              <span>{archiveReason}</span>
                            </td>
                            <td className="ps-archive-cell-action">
                              {item.linkedOrderId ? (
                                <button
                                  className="text-button"
                                  type="button"
                                  onClick={() => openLinkedOrder({ id: item.linkedOrderId })}
                                >
                                  Siparişi Aç
                                </button>
                              ) : (
                                <span className="muted-text">Aksiyon yok</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="ps-empty-card ps-archive-empty">
                <div className="ps-empty-head">
                  <Info size={18} />
                  <div>
                    <h4>Henüz arşivlenmiş öneri bulunmuyor.</h4>
                    <p>Uygulanan ve reddedilen öneriler tamamlandıkça burada listelenecek.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <FormModal isOpen={isEditModalOpen} title="Öneri Düzenle" onClose={() => setIsEditModalOpen(false)}>
        <form className="modal-form" onSubmit={handleEditSave}>
          <div className="form-grid two-columns">
            <label className="field-group"><span>Tedarikçi</span><select value={editForm.supplierId} onFocus={() => { void loadSuppliers(); }} onChange={(event) => setEditForm((current) => ({ ...current, supplierId: event.target.value }))}><option value="">Tedarikçi seçin</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="field-group"><span>Önerilen Miktar</span><input type="number" min="1" value={editForm.suggestedQty} onChange={(event) => setEditForm((current) => ({ ...current, suggestedQty: event.target.value }))} /></label>
            <label className="field-group"><span>Birim Fiyat</span><input type="number" min="0" step="0.01" value={editForm.unitPrice} onChange={(event) => setEditForm((current) => ({ ...current, unitPrice: normalizeMoneyInput(event.target.value) }))} /></label>
          </div>
          {editingItem ? (
            <div className="muted-text purchase-edit-meta">
              Risk düzeyi: {riskLabel[editingItem.riskLevel] || 'Bilgi yok'}. Talep eğilimi: {trendLabel[editingItem.trendDirection] || 'Bilgi yok'}. Temin süresi: {formatNumber(editingItem.leadTimeDays || 0)} gün.
            </div>
          ) : null}
          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={() => setIsEditModalOpen(false)}>İptal</button>
            <button className="primary-button" type="submit" disabled={!editingItem || processingId === editingItem.id}>{processingId === editingItem?.id ? 'Kaydediliyor...' : 'Kaydet'}</button>
          </div>
        </form>
      </FormModal>

      <FormModal isOpen={isBulkEditModalOpen} title="Toplu Miktar Düzenleme" onClose={() => setIsBulkEditModalOpen(false)}>
        <form className="modal-form" onSubmit={handleBulkEditSave}>
          <div className="form-grid two-columns">
            <label className="field-group">
              <span>Düzenleme Türü</span>
              <select value={bulkEditForm.mode} onChange={(event) => setBulkEditForm((current) => ({ ...current, mode: event.target.value }))}>
                <option value="multiply">Çarpan uygula</option>
                <option value="set">Sabit değere ayarla</option>
              </select>
            </label>
            <label className="field-group">
              <span>{bulkEditForm.mode === 'set' ? 'Yeni miktar' : 'Çarpan'}</span>
              <input type="number" min="0.1" step="0.1" value={bulkEditForm.value} onChange={(event) => setBulkEditForm((current) => ({ ...current, value: event.target.value }))} />
            </label>
          </div>
          <div className="muted-text purchase-edit-meta">Seçili öneri: {formatNumber(selectedRows.length)}</div>
          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={() => setIsBulkEditModalOpen(false)}>İptal</button>
            <button className="primary-button" type="submit" disabled={processingId === 'bulk-edit'}>{processingId === 'bulk-edit' ? 'Uygulanıyor...' : 'Uygula'}</button>
          </div>
        </form>
      </FormModal>

      <RecommendationDetailModal
        item={detailTarget}
        isAdmin={isAdmin}
        processingId={processingId}
        onClose={() => setDetailTarget(null)}
        onReject={(item) => {
          setDetailTarget(null);
          setRejectTarget(item);
        }}
        onConvert={(item) => {
          setDetailTarget(null);
          handleConvertToOrder(item);
        }}
      />

      <ConfirmModal
        isOpen={Boolean(rejectTarget)}
        title="Öneriyi Reddet"
        description={rejectTarget ? `${rejectTarget.productName} için sipariş önerisi reddedilsin mi` : ''}
        onCancel={() => setRejectTarget(null)}
        onConfirm={handleReject}
        confirmText="Reddet"
      />

      <ConfirmModal
        isOpen={Boolean(draftCreateTarget)}
        title="Tedarikçi Eşleşmesi Oluştur"
        description={draftCreateTarget?.message || 'Bu öneri için tedarikçi eşleşmesi oluşturulacak ve ardından taslak açılacak.'}
        onCancel={() => setDraftCreateTarget(null)}
        onConfirm={handleConfirmDraftCreate}
        confirmText="Oluştur ve Aç"
      />
    </div>
  );
}
