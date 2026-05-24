import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  CalendarDays,
  Truck,
  Info,
  ClipboardList,
  Clock3,
  BarChart3,
  LineChart,
  PackageCheck,
} from 'lucide-react';
import { ResponsiveContainer, BarChart as RBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, LineChart as RLineChart, Line } from 'recharts';
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
  buildEmptyStateBreakdown,
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
  rowMatchesPreset,
  shouldAutoGenerateOnLoad,
  toggleAllSelectedRows,
  toggleSelectedRow,
} from './utils/purchaseSuggestionsUtils.js';

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
  archived: 'neutral',
  stale: 'warning',
};

const statusLabel = {
  pending: 'Bekleyen',
  approved: 'Siparişe dönüştü',
  rejected: 'Reddedildi',
  archived: 'Arşivlendi',
  stale: 'Yeniden hesap gerekli',
};

const ACTIVE_SUGGESTION_STATUSES = new Set(['pending']);
const ARCHIVED_SUGGESTION_STATUSES = new Set(['approved', 'rejected', 'archived', 'stale']);
const PACKAGED_ORDER_UNITS = new Set(['koli', 'kasa', 'paket', 'çuval']);

const trendLabel = { up: 'Yükseliş', flat: 'Dengeli', down: 'Düşüş' };

const PRESET_DEFINITIONS = [
  { key: PRESET_FILTERS.critical3, label: 'Kritik (3 gün içinde)', compactLabel: 'Kritik 3g' },
  { key: PRESET_FILTERS.risk7, label: 'Riskli (7 gün içinde)', compactLabel: 'Riskli 7g' },
  { key: PRESET_FILTERS.fastSelling, label: 'Hızlı satan ürünler', compactLabel: 'Hızlı satan' },
  { key: PRESET_FILTERS.slowOrOverstock, label: 'Yavaş satan / fazla stok', compactLabel: 'Yavaş / fazla stok' },
];

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

const normalizeSuggestionStatus = (value = '') => {
  const normalized = String(value || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[\s-]+/g, '_');
  if (['senttoorder', 'sent_to_order', 'ordered'].includes(normalized)) return 'approved';
  return normalized || 'pending';
};

const isArchivedSuggestionStatus = (value) => ARCHIVED_SUGGESTION_STATUSES.has(normalizeSuggestionStatus(value));
const isActiveSuggestionStatus = (value) => ACTIVE_SUGGESTION_STATUSES.has(normalizeSuggestionStatus(value));

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
  const warehouseStock = Number(item?.warehouseStock);
  const shelfStock = Number(item?.shelfStock);
  const hasWarehouseStock = Number.isFinite(warehouseStock);
  const hasShelfStock = Number.isFinite(shelfStock);
  if (hasWarehouseStock || hasShelfStock) {
    return Math.max(0, (hasWarehouseStock ? warehouseStock : 0) + (hasShelfStock ? shelfStock : 0));
  }
  const directTotal = Number(item?.totalStock);
  if (Number.isFinite(directTotal) && directTotal >= 0) return directTotal;
  return null;
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
    return String(
      combinedName
      || value.fullName
      || value.displayName
      || value.name
      || value.username
      || value.email
      || value.id
      || ''
    ).trim();
  }
  return String(value || '').trim();
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
    || resolveActorName(item.actionBy)
    || resolveActorName(item.reviewedBy)
    || resolveActorName(item.approvedBy)
    || resolveActorName(item.rejectedBy)
    || resolveActorName(item.updatedBy)
    || '-'
  );
};

const resolveArchiveActor = (item = {}) => (
  resolveActorFields(item)
);

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
  const productId = String(item.productId || '').trim();
  const suggestionId = String(item.id || '').trim();
  const supplierId = String(item.supplierId || '').trim();
  const orderUnit = resolveOrderUnit(item);
  const packageSize = resolvePackageSize(item, orderUnit);
  const baseRecommendedQty = Number(item.suggestedQty || 0);
  const recommendedQuantity = orderUnit === 'palet' || PACKAGED_ORDER_UNITS.has(orderUnit)
    ? Math.ceil(baseRecommendedQty / packageSize)
    : Math.max(0, baseRecommendedQty);

  if (!suggestionId || !productId || !supplierId) {
    return {
      valid: false,
      reason: `${item.productName || item.sku || 'öneri'} için ürün veya tedarikçi bilgisi eksik`,
    };
  }

  if (!Number.isFinite(recommendedQuantity) || recommendedQuantity <= 0) {
    return {
      valid: false,
      reason: `${item.productName || item.sku || 'öneri'} için geçerli öneri miktarı yok`,
    };
  }

  return {
    valid: true,
    item: {
      suggestionId,
      productId,
      productName: item.productName || '-',
      sku: item.sku || '-',
      supplierId,
      supplierName: item.supplierName || 'Tedarikçi atanmadı',
      recommendedQuantity,
      recommendedBaseQuantity: Math.max(0, baseRecommendedQty),
      orderUnit,
      baseUnit: 'adet',
      packageSize,
      unitsPerPack: Number(item.unitsPerPack || item.packageSize || 1),
      unitsPerCase: Number(item.unitsPerCase || item.packageSize || 1),
      unitsPerPallet: Number(item.unitsPerPallet || item.packageSize || 1),
      purchaseUnitPrice: Number(item.purchasePrice || item.unitPrice || 0),
      currentStock: Number(item.currentStock || item.stockLevel || 0),
      shelfStock: Number(item.shelfStock || 0),
      warehouseStock: Number(item.warehouseStock || 0),
      riskLevel: String(item.riskLevel || '').trim().toLocaleLowerCase('tr-TR'),
      reason: item.reason || item.actionableReason || item.explanation?.summary || '-',
      recommendationReason: item.reason || item.actionableReason || item.explanation?.summary || '-',
      status: normalizeSuggestionStatus(item.status),
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
      ? `${formatNumber(baseSuggestedQty)} adet`
      : `${formatNumber(baseSuggestedQty)} adet taban miktar`,
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
};

const formatReasonTags = (tags = []) => {
  if (!Array.isArray(tags) || !tags.length) return '-';
  return tags.map((tag) => reasonTagLabel[tag] || tag).join(', ');
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

const computeConfidenceScore = (row = {}) => {
  if (row.isStale || row.dataFreshness?.isStale) return 28;
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
  legacy_payload_drift: 'Eski payload çelişkisi',
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

const getPriorityScore = (item = {}) => {
  const riskScore = { critical: 0, high: 1, medium: 2, low: 3 }[item.riskLevel] ?? 4;
  const stockout = Number.isFinite(item.daysToStockout) ? Number(item.daysToStockout) : 999;
  const leadPressure = Number.isFinite(item.daysToStockout)
    ? Number(item.daysToStockout) - Number(item.leadTimeDays || 0)
    : 999;

  return (riskScore * 10000) + (leadPressure * 100) + stockout;
};

function PaginationControls({ page, pageSize, total, onPageChange, label }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total ? ((safePage - 1) * pageSize) + 1 : 0;
  const end = total ? Math.min(safePage * pageSize, total) : 0;

  if (!total) return null;

  return (
    <div className="ps-pagination" aria-label={label}>
      <span className="ps-pagination-summary">Sayfa {safePage} / {totalPages} - {start}-{end} / {formatNumber(total)} kayıt</span>
      <div className="ps-pagination-actions">
        <button className="ghost-button ps-btn ps-pagination-btn is-prev" type="button" onClick={() => onPageChange(safePage - 1)} disabled={safePage === 1}>Önceki</button>
        <button className="primary-button ps-btn ps-pagination-btn is-next" type="button" onClick={() => onPageChange(safePage + 1)} disabled={safePage === totalPages}>Sonraki</button>
      </div>
    </div>
  );
}

function MinimalPaginationControls({ page, pageSize, total, onPageChange, label }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total ? ((safePage - 1) * pageSize) + 1 : 0;
  const end = total ? Math.min(safePage * pageSize, total) : 0;

  if (!total) return null;

  return (
    <div className="ps-pagination ps-pagination--minimal" aria-label={label}>
      <span className="ps-pagination-summary">{formatNumber(total)} kayıttan {start}-{end} arası</span>
      <button className="ghost-button ps-btn ps-pagination-btn is-prev" type="button" onClick={() => onPageChange(safePage - 1)} disabled={safePage === 1}>Önceki</button>
      <span className="ps-pagination-page">Sayfa {safePage} / {totalPages}</span>
      <button className="primary-button ps-btn ps-pagination-btn is-next" type="button" onClick={() => onPageChange(safePage + 1)} disabled={safePage === totalPages}>Sonraki</button>
    </div>
  );
}

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
        <strong>Bitti</strong>
        <span>Depo ve reyon stoku tükendi</span>
      </div>
    );
  }
  const days = Number(item.daysToStockout);
  const hasEstimate = Number.isFinite(days);
  const helperText = hasEstimate
    ? (days <= 0 ? 'Tampon stok aşıldı' : `${formatNumber(Math.max(0, days))} gün kapsama`)
    : (item.explanation?.projection?.status === 'insufficient-data' ? 'Düşük hareket / veri yetersiz' : 'Tahmin edilemiyor');

  return (
    <div className="ps-stockout-cell">
      <strong>{item.estimatedStockoutDate || 'Tahmin edilemiyor'}</strong>
      <span>{helperText}</span>
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
  explanationOpenId,
  setExplanationOpenId,
  handleConvertToOrder,
  handleOpenComposeScreen,
  setRejectTarget,
  processingId,
  isAdmin,
}) {
  const allSelected = rows.length > 0 && rows.every((item) => selectedIds.includes(item.id));

  const toggleRow = (rowId, checked) => {
    setSelectedIds((current) => toggleSelectedRow(current, rowId, checked));
  };

  const toggleAll = (checked) => {
    setSelectedIds((current) => toggleAllSelectedRows(current, rows, checked));
  };

  return (
    <div className="table-wrapper analysis-table-wrapper">
      <table className="data-table purchase-suggestions-table">
        <thead>
          <tr>
            <th className="analysis-cell-nowrap">
              <label className="purchase-suggestions-checkbox" aria-label="Tümünü seç">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
                <span>Seç</span>
              </label>
            </th>
            <th>SKU</th>
            <th>Ürün</th>
            <th>Son 7 Gün Satış</th>
            <th>Ort. Günlük Satış</th>
            <th>Tahmini Stok Bitiş</th>
            <th>Temin Süresi (gün)</th>
            <th>Güven Skoru</th>
            <th>Toplam Stok</th>
            <th>Önerilen Miktar</th>
            <th>Tedarikçi</th>
            <th>Risk</th>
            <th>Durum</th>
            <th className="analysis-cell-nowrap">İşlemler</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const isOpen = explanationOpenId === item.id;
            const totalStockValue = getTotalStockValue(item);
            return (
              <Fragment key={item.id}>
                <tr className={isOpen ? 'purchase-suggestions-row is-open' : 'purchase-suggestions-row'}>
                  <td>
                    <label className="purchase-suggestions-checkbox" aria-label={`${item.productName} için seç`}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={(event) => toggleRow(item.id, event.target.checked)}
                      />
                      <span className="sr-only">Seçili</span>
                    </label>
                  </td>
                  <td>{item.sku || '-'}</td>
                  <td>{item.productName || '-'}</td>
                  <td>{formatNumber(item.sold7 || 0)}</td>
                  <td>{formatNumber(item.avgDailySales || 0)}</td>
                  <td><StockoutDisplay item={item} /></td>
                  <td>{formatNumber(item.leadTimeDays || 0)}</td>
                  <td>
                    <div className="ps-supplier-cell">
                      <strong>{item.confidenceText}</strong>
                      {item.isStale ? (
                        <StatusBadge tone="warning">{item.freshnessText || 'Yeniden hesap gerekli'}</StatusBadge>
                      ) : (
                        <span>Güncel veri</span>
                      )}
                    </div>
                  </td>
                  <td className="ps-total-stock-cell">
                    {totalStockValue === null ? <span className="muted-text">Veri yok</span> : formatNumber(totalStockValue)}
                  </td>
                  <td className="ps-qty-cell">
                    <strong>{formatSuggestedQuantityCell(item).primary}</strong>
                    <div className="muted-text">{formatSuggestedQuantityCell(item).secondary}</div>
                  </td>
                  <td>
                    <div className="ps-supplier-cell">
                      <strong>{item.supplierName || '-'}</strong>
                      <span>{item.supplierMissing ? 'Varsayılan tedarikçi eksik' : (item.supplierId || '-')}</span>
                    </div>
                  </td>
                  <td>
                    <StatusBadge tone={riskTone[item.riskLevel] || 'neutral'}>
                      {riskLabel[item.riskLevel] || '-'}
                    </StatusBadge>
                  </td>
                  <td>
                    <StatusBadge tone={statusTone[item.status] || 'neutral'}>
                      {statusLabel[item.status] || item.status || '-'}
                    </StatusBadge>
                  </td>
                  <td className="analysis-cell-nowrap">
                    <div className="table-actions purchase-suggestions-row-actions">
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setExplanationOpenId(isOpen ? '' : item.id)}
                      >
                        Neden
                      </button>
                      {isAdmin ? (
                        <>
                          <button
                            className="text-button success"
                            type="button"
                            onClick={() => handleConvertToOrder(item)}
                            disabled={processingId === item.id || normalizeSuggestionStatus(item.status) !== 'pending'}
                          >
                            Siparişe Dönüştür
                          </button>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => handleOpenComposeScreen(item)}
                            disabled={processingId === item.id || normalizeSuggestionStatus(item.status) !== 'pending'}
                          >
                            Taslakta Düzenle
                          </button>
                          <button
                            className="text-button danger"
                            type="button"
                            onClick={() => setRejectTarget(item)}
                            disabled={processingId === item.id || normalizeSuggestionStatus(item.status) !== 'pending'}
                          >
                            Reddet
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="purchase-suggestions-explain-row">
                    <td colSpan={14}>
                      <div className="purchase-suggestions-explain-box">
                        <div className="ps-reason-card-head">
                          <strong>{item.explanation.title || 'Neden bu öneri?'}</strong>
                          <span>
                            Trend: {trendLabel[item.explanation.trend] || '-'}
                            {' '}| Güven: {item.confidenceText}
                            {item.isStale ? ` | Veri durumu: ${item.freshnessText || 'Yeniden hesap gerekli'}` : ''}
                            {' '}| Tahmini stok bitiş: {item.explanation.estimatedStockoutDate || '-'}
                          </span>
                        </div>
                        <p>{item.explanation.summary || 'Stok, talep ve temin sinyalleri birlikte değerlendirildi.'}</p>
                        {item.explanation.riskDrivers.length ? (
                          <ul>
                            {item.explanation.riskDrivers.map((risk) => <li key={risk}>{risk}</li>)}
                          </ul>
                        ) : (
                          <p>Belirgin risk sinyali bulunmadı; öneri standart sipariş politikasıyla üretildi.</p>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PurchaseSuggestions() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [supplierProducts, setSupplierProducts] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [generationOptions, setGenerationOptions] = useState(initialGenerationOptions);
  const [activePreset, setActivePreset] = useState('');
  const [groupBySupplier, setGroupBySupplier] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [processingId, setProcessingId] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [editForm, setEditForm] = useState(initialEditForm);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [bulkEditForm, setBulkEditForm] = useState(initialBulkEditForm);
  const [explanationOpenId, setExplanationOpenId] = useState('');
  const [listPage, setListPage] = useState(1);
  const [archivePage, setArchivePage] = useState(1);

  const hasAutoGeneratedRef = useRef(false);
  const generationInFlightRef = useRef(false);

  const isAdmin = user?.role === 'admin';
  const permissionList = Array.isArray(user?.permissions) ? user.permissions : [];
  const canManageSuggestions = isAdmin
    || permissionList.includes('procurement.create')
    || permissionList.includes('procurement.update')
    || permissionList.includes('procurement.approve')
    || permissionList.includes('PROCUREMENT_CREATE')
    || permissionList.includes('PROCUREMENT_UPDATE')
    || permissionList.includes('PROCUREMENT_APPROVE');

  const loadData = async (query = filters, options = {}) => {
    const { includeContext = false } = options;
    try {
      setIsLoading(true);
      const [data, supplierList] = await Promise.allSettled([
        procurementService.listSuggestions({ page: 1, limit: 50 }),
        supplierService.list(),
      ]);

      const suggestionRows = data.status === 'fulfilled' && Array.isArray(data.value) ? data.value : [];
      setRows(suggestionRows);
      setSuppliers(supplierList.status === 'fulfilled' && Array.isArray(supplierList.value) ? supplierList.value : []);
      if (includeContext || suggestionRows.length === 0) {
        const [productList, supplierProductRows] = await Promise.allSettled([
          productService.list({ universe: 'listed_active', includeUnlisted: false, fetchAll: false, page: 1, limit: 500, includeTotal: false }),
          procurementService.listSupplierProducts({ fetchAll: false, page: 1, limit: 500, includeTotal: false }),
        ]);
        setProducts(productList.status === 'fulfilled' && Array.isArray(productList.value) ? productList.value : []);
        setSupplierProducts(supplierProductRows.status === 'fulfilled' && Array.isArray(supplierProductRows.value) ? supplierProductRows.value : []);
      }
      return suggestionRows;
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Önerileri', message: error.message || 'Öneriler yüklenemedi.' });
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const regenerateSuggestions = async (reason = 'manual') => {
    if (generationInFlightRef.current) return;

    try {
      generationInFlightRef.current = true;
      setProcessingId(reason === 'auto' ? 'generate' : reason);
      await procurementService.generateSuggestions(generationOptions);
      await loadData(filters);
      if (reason !== 'auto') {
        setToast({ type: 'success', title: 'Sipariş Önerileri', message: 'Talep analizi tamamlandı, öneriler güncellendi.' });
      }
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Önerileri', message: error.message || 'Öneri üretimi başarısız.' });
    } finally {
      generationInFlightRef.current = false;
      setProcessingId('');
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      const initialRows = await loadData(filters);
      if (
        initialRows.length === 0
        && shouldAutoGenerateOnLoad({ hasTriggered: hasAutoGeneratedRef.current, isGenerating: generationInFlightRef.current })
      ) {
        hasAutoGeneratedRef.current = true;
        await regenerateSuggestions('auto');
      }
    };

    bootstrap();
  }, []);

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
      const chosenSupplierId = item.supplierId || fallbackSupplier?.supplierId || product.supplierId || '';
      const chosenSupplier = supplierMap.get(String(chosenSupplierId)) || null;

      const rowContext = { ...product, ...fallbackSupplier, ...item };
      const avgDailySales = getAverageDailySales(rowContext);
      const leadTimeDays = getLeadTimeDays(rowContext);
      const daysToStockout = estimateDaysToStockout({ ...rowContext, avgDailySales, leadTimeDays });
      const riskLevel = String(item.riskLevel || classifyStockoutRisk(daysToStockout)).toLowerCase('tr-TR');
      const suggestedQty = Number(item.suggestedQty || buildSuggestionQuantity({ ...rowContext, avgDailySales, leadTimeDays }));
      const dataFreshness = item.dataFreshness || { isStale: Boolean(item.isStale), reasons: item.staleReasons || [] };
      const isStale = Boolean(item.isStale || dataFreshness.isStale);
      const confidenceScore = computeConfidenceScore({ ...rowContext, avgDailySales, leadTimeDays, daysToStockout, suggestedQty, dataFreshness, isStale });
      const explanation = buildRecommendationExplanation({ ...rowContext, avgDailySales, leadTimeDays, suggestedQty, confidenceScore, dataFreshness, isStale });
      const salesTrend = Array.isArray(item.salesTrendLast14Days) ?
        item.salesTrendLast14Days
        : [];
      const effectiveStatus = normalizeSuggestionStatus(item.status);
      const supplierName = item.supplierName && item.supplierName !== '-'
        ? item.supplierName
        : (chosenSupplier?.name || fallbackSupplier?.supplierName || 'Varsayılan tedarikçi yok');

      return {
        ...item,
        supplierId: chosenSupplierId || item.supplierId,
        supplierName,
        supplierMissing: !chosenSupplierId,
        purchasePrice: Number(item.unitPrice || fallbackSupplier?.purchasePrice || product.purchasePrice || 0),
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
        actionableReason: buildBetterReason({ ...item, sold7: Number(item.sold7 || 0), leadTimeDays, currentStock: Number(item.currentStock || 0), criticalStock: Number(item.criticalStock || 0) }),
        actionAt: getArchiveActionAt(item),
        actionBy: resolveArchiveActor(item),
      };
    });
  }, [productMap, rows, supplierMap, supplierOptionsByProduct]);

  const filteredRows = useMemo(() => {
    const query = String(filters.search || '').trim().toLocaleLowerCase('tr-TR');

    return enrichedRows.filter((row) => {
      const rowRisk = String(row.riskLevel || '').toLowerCase('tr-TR');
      const rowStatus = normalizeSuggestionStatus(row.status);
      const searchText = [row.productName, row.sku, row.supplierName]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('tr-TR');

      if (query && !searchText.includes(query)) return false;
      if (filters.status && rowStatus !== normalizeSuggestionStatus(filters.status)) return false;
      if (filters.riskLevel && rowRisk !== String(filters.riskLevel).toLowerCase('tr-TR')) return false;
      if (activePreset && !rowMatchesPreset(row, activePreset)) return false;

      return true;
    });
  }, [activePreset, enrichedRows, filters.riskLevel, filters.search, filters.status]);

  const activeRows = useMemo(
    () => enrichedRows.filter((item) => isActiveSuggestionStatus(item.status)),
    [enrichedRows]
  );

  const archiveRows = useMemo(
    () => enrichedRows.filter((item) => isArchivedSuggestionStatus(item.status)),
    [enrichedRows]
  );

  const activeFilteredRows = useMemo(
    () => filteredRows.filter((item) => isActiveSuggestionStatus(item.status)),
    [filteredRows]
  );

  const archiveFilteredRows = useMemo(
    () => filteredRows.filter((item) => isArchivedSuggestionStatus(item.status)),
    [filteredRows]
  );

  const summary = useMemo(() => ({
    total: activeFilteredRows.length,
    pending: activeFilteredRows.filter((item) => normalizeSuggestionStatus(item.status) === 'pending').length,
    approved: archiveFilteredRows.filter((item) => normalizeSuggestionStatus(item.status) === 'approved').length,
    criticalRisk: activeFilteredRows.filter((item) => ['critical', 'high'].includes(String(item.riskLevel || '').toLowerCase())).length,
    calendarSensitive: activeFilteredRows.filter((item) => containsCalendarSignal(item.reasonTags)).length,
    urgentByLeadTime: activeFilteredRows.filter((item) => Number(item.daysToStockout || 999) <= Number(item.leadTimeDays || 0) + 2).length,
  }), [activeFilteredRows, archiveFilteredRows]);

  const priorityRows = useMemo(() => (
    [...activeFilteredRows]
      .filter((item) => ['critical', 'high'].includes(String(item.riskLevel || '').toLowerCase('tr-TR')) || Number.isFinite(item.daysToStockout))
      .sort((a, b) => getPriorityScore(a) - getPriorityScore(b))
  ), [activeFilteredRows]);

  const pagedRecommendationRows = useMemo(() => (
    activeFilteredRows.slice((listPage - 1) * TABLE_PAGE_SIZE, listPage * TABLE_PAGE_SIZE)
  ), [activeFilteredRows, listPage]);

  const pagedGroupedRows = useMemo(() => groupRecommendationsBySupplier(pagedRecommendationRows), [pagedRecommendationRows]);
  const pagedArchiveRows = useMemo(() => (
    archiveFilteredRows.slice((archivePage - 1) * TABLE_PAGE_SIZE, archivePage * TABLE_PAGE_SIZE)
  ), [archiveFilteredRows, archivePage]);

  const purchaseRiskChartData = useMemo(() => {
    const map = { critical: 0, high: 0, medium: 0, low: 0 };
    activeFilteredRows.forEach((item) => {
      const key = String(item.riskLevel || '').toLowerCase('tr-TR');
      if (key in map) map[key] += 1;
    });
    return [
      { name: 'Kritik', count: map.critical },
      { name: 'Yüksek', count: map.high },
      { name: 'Orta', count: map.medium },
      { name: 'Düşük', count: map.low },
    ];
  }, [activeFilteredRows]);

  const purchaseStatusChartData = useMemo(() => ([
    { name: 'Bekleyen', count: summary.pending },
    { name: 'Siparişe Dönüştü', count: summary.approved },
    { name: 'Reddedilen', count: archiveFilteredRows.filter((item) => normalizeSuggestionStatus(item.status) === 'rejected').length },
    { name: 'Yeniden Hesap', count: archiveFilteredRows.filter((item) => normalizeSuggestionStatus(item.status) === 'stale').length },
  ]), [archiveFilteredRows, summary]);

  const leadTimeComparisonData = useMemo(() => (
    priorityRows.slice(0, 8).map((item, index) => ({
      name: item.sku || `Ü${index + 1}`,
      stokBitis: Number.isFinite(item.daysToStockout) ? Math.max(0, Number(item.daysToStockout)) : 0,
      temin: Math.max(0, Number(item.leadTimeDays || 0)),
    }))
  ), [priorityRows]);

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

  const emptyBreakdown = useMemo(() => buildEmptyStateBreakdown({
    rows: filteredRows,
    products,
    supplierProducts,
  }), [filteredRows, products, supplierProducts]);

  useEffect(() => {
    setListPage(1);
    setArchivePage(1);
  }, [activePreset, filters.riskLevel, filters.search, filters.status, groupBySupplier]);

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

  const handleOpenComposeScreen = (item) => {
    const { validItems, invalidReasons, href, state } = buildNavigationPayload([item], 'single');
    if (!validItems.length) {
      setToast({ type: 'error', title: 'Taslakta Düzenle', message: invalidReasons[0] || 'Ürün sipariş ekranına taşınamadı.' });
      return;
    }

    if (invalidReasons.length) {
      setToast({ type: 'warning', title: 'Taslakta Düzenle', message: invalidReasons[0] });
    }

    navigate(href, { state });
  };

  const openLinkedOrder = (order) => {
    const orderId = String(order?.id || order?.linkedOrderId || '').trim();
    const orderNumber = String(order?.orderNumber || order?.linkedOrderNumber || '').trim();
    navigate('/siparis-takibi', {
      state: {
        from: '/siparis-onerileri',
        openOrderId: orderId,
        openOrderNumber: orderNumber,
      },
    });
  };

  const handleConvertToOrder = async (item) => {
    if (!item?.id) return;
    try {
      setProcessingId(item.id);
      const order = await procurementService.approveSuggestion(item.id, {});
      setToast({
        type: 'success',
        title: 'Siparişe Dönüştür',
        message: `${order?.orderNumber || 'Satın alma siparişi'} oluşturuldu ve öneri backend'de güncellendi.`,
      });
      setSelectedIds((current) => current.filter((id) => id !== item.id));
      await loadData(filters);
      if (order?.id) openLinkedOrder(order);
    } catch (error) {
      setToast({ type: 'error', title: 'Siparişe Dönüştür', message: error.message || 'Öneri siparişe dönüştürülemedi.' });
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
      setToast({ type: 'success', title: 'Sipariş Önerileri', message: 'Öneri güncellendi.' });
      setIsEditModalOpen(false);
      setEditingItem(null);
      await loadData(filters);
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Önerileri', message: error.message || 'Güncelleme başarısız.' });
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
      await loadData(filters);
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Önerileri', message: error.message || 'Reddetme işlemi başarısız.' });
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
        const { validItems, invalidReasons, href, state } = buildNavigationPayload(selectedRows, 'bulk');
        if (!validItems.length) {
          setToast({ type: 'error', title: 'Oluşturma Ekranına Taşı', message: invalidReasons[0] || 'Geçerli sipariş önerisi bulunamadı.' });
          return;
        }

        if (invalidReasons.length) {
          setToast({
            type: 'warning',
            title: 'Oluşturma Ekranına Taşı',
            message: `${formatNumber(validItems.length)} öneri aktarıldı, ${formatNumber(invalidReasons.length)} kayıt atlandı.`,
          });
        }

        navigate(href, { state });
      }

      if (actionType === 'convert') {
        const results = [];
        for (const item of selectedRows) {
          try {
            const order = await procurementService.approveSuggestion(item.id, {});
            results.push({ ok: true, item, order });
          } catch (error) {
            results.push({ ok: false, item, error });
          }
        }

        const successCount = results.filter((result) => result.ok).length;
        const failed = results.filter((result) => !result.ok);
        setSelectedIds([]);
        await loadData(filters);

        if (failed.length) {
          setToast({
            type: successCount ? 'warning' : 'error',
            title: 'Toplu Siparişe Dönüştür',
            message: `${formatNumber(successCount)} öneri siparişe dönüştü, ${formatNumber(failed.length)} öneri başarısız.`,
          });
          return;
        }

        setToast({
          type: 'success',
          title: 'Toplu Siparişe Dönüştür',
          message: `${formatNumber(successCount)} öneri için satın alma siparişi oluşturuldu.`,
        });
      }

    } catch (error) {
      setToast({ type: 'error', title: 'Toplu İşlem', message: error.message || 'Toplu işlem başarısız.' });
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
        const nextQty = bulkEditForm.mode === 'set' ?
          rawValue
          : Math.max(1, Math.ceil(baseQty * rawValue));
        return procurementService.updateSuggestion(item.id, { suggestedQty: nextQty });
      }));

      setToast({ type: 'success', title: 'Toplu Düzenleme', message: 'Seçilen öneriler güncellendi.' });
      setIsBulkEditModalOpen(false);
      setBulkEditForm(initialBulkEditForm);
      await loadData(filters);
    } catch (error) {
      setToast({ type: 'error', title: 'Toplu Düzenleme', message: error.message || 'Toplu düzenleme başarısız.' });
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

  const isGeneratingSuggestions = ['manual', 'generate'].includes(processingId);
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

        <section className="ps-kpi-grid" aria-label="KPI özet">
          <div className="ps-kpi ps-kpi-blue">
            <span className="ps-kpi-icon"><ClipboardList size={18} /></span>
            <div><div className="ps-kpi-title">Toplam Öneri</div><div className="ps-kpi-value">{formatNumber(summary.total)}</div></div>
          </div>
          <div className="ps-kpi ps-kpi-amber">
            <span className="ps-kpi-icon"><Clock3 size={18} /></span>
            <div><div className="ps-kpi-title">Bekleyen</div><div className="ps-kpi-value">{formatNumber(summary.pending)}</div></div>
          </div>
          <div className="ps-kpi ps-kpi-green">
            <span className="ps-kpi-icon"><CheckCircle2 size={18} /></span>
            <div><div className="ps-kpi-title">Siparişe Dönüşen</div><div className="ps-kpi-value">{formatNumber(summary.approved)}</div></div>
          </div>
          <div className="ps-kpi ps-kpi-red">
            <span className="ps-kpi-icon"><AlertTriangle size={18} /></span>
            <div><div className="ps-kpi-title">Yüksek/Kritik Risk</div><div className="ps-kpi-value">{formatNumber(summary.criticalRisk)}</div></div>
          </div>
          <div className="ps-kpi ps-kpi-purple">
            <span className="ps-kpi-icon"><CalendarDays size={18} /></span>
            <div><div className="ps-kpi-title">Dönemsel Yoğunluk</div><div className="ps-kpi-value">{formatNumber(summary.calendarSensitive)}</div></div>
          </div>
          <div className="ps-kpi ps-kpi-cyan">
            <span className="ps-kpi-icon"><Truck size={18} /></span>
            <div><div className="ps-kpi-title">Temin Kaynaklı Acil</div><div className="ps-kpi-value">{formatNumber(summary.urgentByLeadTime)}</div></div>
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
              <h3><LineChart size={16} /> Stok Bitiş vs Temin</h3>
            </div>
            <div className="ps-card-body">
              {leadTimeComparisonData.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <RLineChart data={leadTimeComparisonData} margin={{ top: 12, right: 12, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <RTooltip formatter={(value, name) => [`${formatNumber(value)} gün`, name]} contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
                    <Line type="monotone" dataKey="stokBitis" name="Stok Bitiş (gün)" stroke="#ef4444" strokeWidth={2.4} dot={{ r: 2.5 }} />
                    <Line type="monotone" dataKey="temin" name="Temin Süresi (gün)" stroke="#2563eb" strokeWidth={2.4} dot={{ r: 2.5 }} />
                  </RLineChart>
                </ResponsiveContainer>
              ) : (
                <div className="ps-empty-state" role="status">
                  <Info size={18} />
                  <strong>Henüz veri oluşmadı</strong>
                  <span>Stok bitiş ve temin kıyaslaması için öneri akışı bekleniyor.</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="ps-card ps-filter-card" aria-label="Filtre paneli">
          <div className="ps-card-head">
            <div className="ps-head-main">
              <div className="mod-card-icon mod-icon-cyan"><Info size={16} /></div>
              <div><h3>Filtre Paneli</h3><p>Durum, risk ve görünüm filtreleriyle listeyi daraltın.</p></div>
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
                  <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                    <option value="">Tüm Durumlar</option>
                    <option value="pending">Bekleyen</option>
                    <option value="approved">Siparişe Dönüştü</option>
                    <option value="rejected">Reddedildi</option>
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
                  <button className="primary-button ps-btn" type="button" onClick={() => loadData(filters)} disabled={isLoading}>Filtrele</button>
                  <button
                    className="ghost-button ps-btn"
                    type="button"
                    onClick={() => { setFilters(initialFilters); setActivePreset(''); loadData(initialFilters); }}
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
                  <p>Ürün bazında önerilen miktarı ve risk sinyallerini görün.</p>
                </div>
              </div>
              <MinimalPaginationControls
                page={listPage}
                pageSize={TABLE_PAGE_SIZE}
                total={activeFilteredRows.length}
                onPageChange={setListPage}
                label="Sipariş öneri listesi üst sayfalama"
              />
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
                <button type="button" className="primary-button ps-btn" onClick={() => runBulkAction('convert')} disabled={processingId.startsWith('bulk-')}>Toplu Siparişe Dönüştür</button>
                <button type="button" className="ghost-button ps-btn" onClick={() => runBulkAction('compose')} disabled={processingId.startsWith('bulk-')}>Oluşturma Ekranına Taşı</button>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="table-panel loading-state"><span className="loader"></span><p>Veriler yükleniyor...</p></div>
          ) : activeFilteredRows.length === 0 && activeRows.length > 0 ? (
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
          ) : activeFilteredRows.length === 0 && archiveRows.length > 0 ? (
            <div className="ps-empty-card">
              <div className="ps-empty-head">
                <Info size={18} />
                <div>
                  <h4>Aktif sipariş önerisi kalmadı</h4>
                  <p>Siparişe dönüşen, reddedilen veya yeniden hesap gerektiren öneriler aşağıdaki arşiv tablosunda tutuluyor.</p>
                </div>
              </div>
            </div>
          ) : activeRows.length === 0 ? (
            <div className="ps-empty-card" data-testid="order-recommendations-empty-state">
              <div className="ps-empty-head">
                <Info size={18} />
                <div>
                  <h4>Şu anda net sipariş ihtiyacı görünmüyor</h4>
                  <p>Kritik stok altında ürün yok veya mevcut/yoldaki siparişler ihtiyacı karşılıyor olabilir. Öneri üretimi, net ihtiyaç oluştuğunda pending kayıt yaratır.</p>
                </div>
              </div>
              <div className="ps-empty-metrics">
                <div>
                  <strong>{formatNumber(emptyBreakdown.missingMinStock)}</strong>
                  <span>Min. stok tanımı eksik ürün</span>
                  <small>Bu ürünler için minimum stok seviyesi belirlenmemiş.</small>
                </div>
                <div>
                  <strong>{formatNumber(emptyBreakdown.missingLeadTime)}</strong>
                  <span>Temin tanımı eksik ürün</span>
                  <small>Bu ürünlerde tedarik süresi belirsiz olduğu için plan zorlaşıyor.</small>
                </div>
                <div>
                  <strong>{formatNumber(emptyBreakdown.noRecentSales)}</strong>
                  <span>Son {emptyBreakdown.lookbackDays} günde satışı olmayan ürün</span>
                  <small>Satış sinyali zayıf olduğu için sistem öneri üretimini erteliyor.</small>
                </div>
                <div>
                  <strong>{formatNumber(emptyBreakdown.sufficientStock)}</strong>
                  <span>Stoku yeterli ürün</span>
                  <small>Bu ürünlerde current stock hedef stok ve kritik eşik üstünde.</small>
                </div>
              </div>
              <div className="ps-empty-actions">
                <button className="primary-button ps-btn" type="button" onClick={() => regenerateSuggestions('manual')} disabled={isGeneratingSuggestions}>
                  Yeniden Hesapla
                </button>
                <button className="ghost-button ps-btn" type="button" onClick={() => navigate('/urunler')}>Eksik Verileri Tamamla</button>
                <button className="ghost-button ps-btn" type="button" onClick={() => navigate('/siparis-olustur')}>Tedarikçi Ayarlarına Git</button>
              </div>
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
                    explanationOpenId={explanationOpenId}
                    setExplanationOpenId={setExplanationOpenId}
                    handleConvertToOrder={handleConvertToOrder}
                    handleOpenComposeScreen={handleOpenComposeScreen}
                    setRejectTarget={setRejectTarget}
                    processingId={processingId}
                    isAdmin={isAdmin}
                  />
                </section>
              ))}
            </div>
          ) : (
            <RecommendationTable
              rows={pagedRecommendationRows}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              explanationOpenId={explanationOpenId}
              setExplanationOpenId={setExplanationOpenId}
              handleConvertToOrder={handleConvertToOrder}
              handleOpenComposeScreen={handleOpenComposeScreen}
              setRejectTarget={setRejectTarget}
              processingId={processingId}
              isAdmin={isAdmin}
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
              total={archiveFilteredRows.length}
              onPageChange={setArchivePage}
              label="Öneri arşivi sayfalama"
            />
          </div>

          <div className="ps-card-body">
            {archiveFilteredRows.length ? (
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
                      </tr>
                    </thead>
                    <tbody>
                      {pagedArchiveRows.map((item) => (
                        <tr key={`archive-${item.id}`}>
                          <td>
                            <div className="ps-supplier-cell">
                              <strong>{item.productName || '-'}</strong>
                              <span>{item.sku || '-'}</span>
                            </div>
                          </td>
                          <td className="ps-archive-cell-supplier" title={item.supplierName || 'Tedarikçi atanmadı'}>
                            <span>{item.supplierName || 'Tedarikçi atanmadı'}</span>
                          </td>
                          <td className="ps-archive-cell-qty">{formatSuggestedQuantityCell(item).primary}</td>
                          <td>
                            <StatusBadge tone={statusTone[normalizeSuggestionStatus(item.status)] || 'neutral'}>
                              {statusLabel[normalizeSuggestionStatus(item.status)] || item.status || '-'}
                            </StatusBadge>
                            {item.linkedOrderId ? (
                              <button
                                className="text-button"
                                type="button"
                                onClick={() => openLinkedOrder({ id: item.linkedOrderId })}
                              >
                                Siparişi Aç
                              </button>
                            ) : null}
                          </td>
                          <td className="ps-archive-cell-date">{formatActionDateTime(item.actionAt)}</td>
                          <td className="ps-archive-cell-actor" title={resolveArchiveActor(item)}>
                            <span>{resolveArchiveActor(item)}</span>
                          </td>
                          <td className="ps-archive-cell-reason" title={item.reason || item.actionableReason || item.explanation?.summary || '-'}>
                            <span>{item.reason || item.actionableReason || item.explanation?.summary || '-'}</span>
                          </td>
                        </tr>
                      ))}
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
            <label className="field-group"><span>Tedarikçi</span><select value={editForm.supplierId} onChange={(event) => setEditForm((current) => ({ ...current, supplierId: event.target.value }))}><option value="">Tedarikçi seçin</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="field-group"><span>Önerilen Miktar</span><input type="number" min="1" value={editForm.suggestedQty} onChange={(event) => setEditForm((current) => ({ ...current, suggestedQty: event.target.value }))} /></label>
            <label className="field-group"><span>Birim Fiyat</span><input type="number" min="0" step="0.01" value={editForm.unitPrice} onChange={(event) => setEditForm((current) => ({ ...current, unitPrice: normalizeMoneyInput(event.target.value) }))} /></label>
          </div>
          {editingItem ? (
            <div className="muted-text purchase-edit-meta">
              Risk: {riskLabel[editingItem.riskLevel] || '-'} | Trend: {trendLabel[editingItem.trendDirection] || '-'} | Temin Süresi: {formatNumber(editingItem.leadTimeDays || 0)} gün
            </div>
          ) : null}
          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={() => setIsEditModalOpen(false)}>İptal</button>
            <button className="primary-button" type="submit" disabled={!editingItem || processingId === editingItem?.id}>{processingId === editingItem?.id ? 'Kaydediliyor...' : 'Kaydet'}</button>
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

      <ConfirmModal
        isOpen={Boolean(rejectTarget)}
        title="Öneriyi Reddet"
        description={rejectTarget ? `${rejectTarget.productName} için sipariş önerisi reddedilsin mi?` : ''}
        onCancel={() => setRejectTarget(null)}
        onConfirm={handleReject}
        confirmText="Reddet"
      />
    </div>
  );
}
