import { useEffect, useMemo, useRef, useState } from 'react';
import { Receipt, PackageCheck, Filter, Truck, Clock, CheckCircle2, FileText, FileSpreadsheet, Archive, AlertTriangle, CalendarDays, ClipboardList, CircleDollarSign, History, Route, Info } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import DataTable from '../../components/DataTable.jsx';
import FilterBar from '../../components/FilterBar.jsx';
import FormModal from '../../components/FormModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Toast from '../../components/Toast.jsx';
import { useDialog } from '../../components/ConfirmModal.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { formatCurrency, formatDate, formatDateOnly, formatNumber, formatTurkishDisplayText, includesNormalized, normalizeSearchText } from '../../services/formatters.js';
import { procurementService } from '../../services/procurementService.js';
import { supplierService } from '../../services/supplierService.js';
import { userService } from '../../services/userService.js';
import {
  getPurchaseOrderManualActionTransitions,
  getPurchaseOrderStatusHelp,
  getPurchaseOrderStatusLabel,
  getPurchaseOrderStatusTone,
  getVisiblePurchaseOrderStatusLabel,
  LEGACY_PURCHASE_ORDER_STATUS_MAP,
  mapPurchaseOrderStatusToVisibleStatus,
  normalizePurchaseOrderStatus,
  PURCHASE_ORDER_MANUAL_ACTION_TRANSITIONS,
  PURCHASE_ORDER_STATUSES,
  VISIBLE_PURCHASE_ORDER_STATUS_SEQUENCE,
} from '../../utils/purchaseOrderLifecycle.js';
import {
  buildOrderDatePreset,
  calculateLifecycleStageMetric,
  isOrderWithinDateBounds,
} from '../../utils/purchaseOrderMetrics.js';

const normalizeMoneyInput = (value) => String(value ?? '').replace(',', '.');

const parseMoneyInput = (value, fallback = 0) => {
  const normalized = normalizeMoneyInput(value).trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ORDER_STATUSES = VISIBLE_PURCHASE_ORDER_STATUS_SEQUENCE.map((value) => ({
  value,
  valueGroup: value === 'cancelled' ? 'cancel' : ['goods_receipt_pending', 'goods_receipt_completed', 'stock_entry_pending', 'completed'].includes(value) ? 'delivery' : ['preparing', 'ready_to_ship', 'in_transit'].includes(value) ? 'shipping' : 'approval',
  label: getPurchaseOrderStatusLabel(value),
}));

const ORDER_STATUS_SEQUENCE = VISIBLE_PURCHASE_ORDER_STATUS_SEQUENCE;
const STATUS_TRANSITIONS = PURCHASE_ORDER_MANUAL_ACTION_TRANSITIONS;
const STATUS_HELP = PURCHASE_ORDER_STATUSES.reduce((acc, status) => {
  acc[status] = getPurchaseOrderStatusHelp(status);
  return acc;
}, {});

const getStatusMeta = (value) => {
  const normalized = normalizePurchaseOrderStatus(value);
  return {
    value: normalized,
    valueGroup: normalized === 'cancelled' ? 'cancel' : ['goods_receipt_pending', 'goods_receipt_completed', 'stock_entry_pending', 'completed'].includes(normalized) ? 'delivery' : ['preparing', 'ready_to_ship', 'in_transit'].includes(normalized) ? 'shipping' : 'approval',
    label: getPurchaseOrderStatusLabel(normalized),
    tone: getPurchaseOrderStatusTone(normalized),
    next: getPurchaseOrderManualActionTransitions(normalized),
    help: getPurchaseOrderStatusHelp(normalized),
  };
};

const initialFilters = {
  search: '',
  supplierId: '',
  status: '',
  orderDateFrom: '',
  orderDateTo: '',
  orderDateFromTime: '',
  orderDateToTime: '',
  amountMin: '',
  amountMax: '',
  createdBy: '',
};

const ARCHIVE_STATUSES = new Set(['archived']);
const CANCELLED_STATUSES = new Set(['cancelled']);
const ORDER_CANCEL_ARCHIVE_DELAY_MS = 24 * 60 * 60 * 1000;
const APPROVAL_PENDING_STATUSES = new Set(['submitted_for_approval']);
const DELIVERY_REACHED_STATUSES = new Set(['delivered', 'goods_receipt_pending', 'goods_receipt_completed', 'stock_entry_pending', 'completed', 'archived']);
const canManageOrderStatus = (order = {}) => {
  const normalizedStatus = normalizeOrderStatus(order?.status);
  if (!normalizedStatus || ARCHIVE_STATUSES.has(normalizedStatus)) return false;
  const transitions = STATUS_TRANSITIONS[normalizedStatus] || [];
  return transitions.some((nextStatus) => nextStatus !== normalizedStatus);
};

const normalizeOrderStatus = (value) => normalizePurchaseOrderStatus(value);

const normalizeStatusLookupKey = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const normalizeOrderNumber = (value, fallbackSeed = '') => {
  const raw = String(value || '').trim();
  const digitMatch = raw.match(/\d+/g);
  if (digitMatch?.length) {
    const joined = digitMatch.join('');
    return `siparis-${joined.slice(-5).padStart(5, '0')}`;
  }

  const seed = String(fallbackSeed || raw || '0');
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return `siparis-${String(Math.abs(hash) % 100000).padStart(5, '0')}`;
};

const resolveStatusBadgeTone = (status) => {
  const lookupKey = normalizeStatusLookupKey(status);
  if (!lookupKey) return 'neutral';
  const isKnownStatus = PURCHASE_ORDER_STATUSES.includes(lookupKey) || Boolean(LEGACY_PURCHASE_ORDER_STATUS_MAP[lookupKey]);
  if (!isKnownStatus) return 'neutral';
  const normalizedStatus = normalizeOrderStatus(status);
  return getPurchaseOrderStatusTone(normalizedStatus) || 'neutral';
};

const isKnownOrderStatus = (status) => {
  const lookupKey = normalizeStatusLookupKey(status);
  return Boolean(lookupKey && (PURCHASE_ORDER_STATUSES.includes(lookupKey) || LEGACY_PURCHASE_ORDER_STATUS_MAP[lookupKey]));
};

const resolveStockEntryMode = (order = {}) => {
  const rawMode = String(order.stockEntryMode || order.stockEntryMethod || '').trim().toLowerCase();
  return rawMode === 'manual' ? 'manual' : rawMode === 'auto' ? 'auto' : '';
};

const isTruthyFlag = (value) => value === true || value === 'true' || value === 1 || value === '1';

const isArchivedOrder = (order = {}) => {
  const normalizedStatus = normalizeOrderStatus(order.status);
  if (normalizedStatus === 'archived' || ARCHIVE_STATUSES.has(normalizedStatus)) return true;
  if (CANCELLED_STATUSES.has(normalizedStatus)) {
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    const cancelledEntry = [...history]
      .reverse()
      .find((entry) => CANCELLED_STATUSES.has(normalizeOrderStatus(entry?.status)));
    const cancelledAt = new Date(cancelledEntry?.at || order.cancelledAt || order.canceledAt || order.updatedAt || order.createdAt || 0).getTime();
    return Number.isFinite(cancelledAt) && Date.now() - cancelledAt >= ORDER_CANCEL_ARCHIVE_DELAY_MS;
  }
  return isTruthyFlag(order.archived) || Boolean(order.archivedAt);
};

const isGoodsReceiptCompletedOrder = (order = {}) => (
  isTruthyFlag(order.goodsReceiptCompleted)
  || isTruthyFlag(order.goods_receipt_completed)
  || Boolean(order.goodsReceiptCompletedAt)
);

const isStockEntryCompleted = (order = {}) => {
  const normalized = normalizeOrderStatus(order.status);
  if (normalized === 'completed' || normalized === 'archived') {
    return true;
  }

  const booleanFlags = [
    order.stockEntryCompleted,
    order.isGoodsReceiptDone,
    order.irsaliyeAccepted,
  ];

  if (booleanFlags.some((value) => value === true)) {
    return true;
  }

  const dateFields = [
    order.stockBookedAt,
    order.goodsReceiptAt,
    order.stockEntryCompletedAt,
    order.entryCompletedAt,
    order.irsaliyeAcceptedAt,
    order.receiptAcceptedAt,
  ];

  return dateFields.some((value) => Boolean(value));
};

const isManualStockEntryPending = (order = {}) => {
  if (isArchivedOrder(order)) return false;

  const normalizedStatus = normalizeOrderStatus(order.status);
  if (normalizedStatus === 'stock_entry_pending') {
    return resolveStockEntryMode(order) !== 'auto' && !isStockEntryCompleted(order);
  }

  const goodsReceiptCompleted = isGoodsReceiptCompletedOrder(order);
  const stockEntryCompleted = isStockEntryCompleted(order);
  return goodsReceiptCompleted && resolveStockEntryMode(order) === 'manual' && !stockEntryCompleted;
};

const mapOrderStatusToTurkishLabel = (status) => {
  if (!isKnownOrderStatus(status)) return 'Bilinmeyen Durum';
  return getVisiblePurchaseOrderStatusLabel(status) || 'Sipariş Güncellendi';
};

const canManualGoodsReceipt = (order = {}) => {
  const normalized = normalizeOrderStatus(order.status);
  return normalized === 'delivered' || normalized === 'goods_receipt_pending';
};

const canAutoStockEntry = (order = {}) => canManualGoodsReceipt(order);

const getArchiveEligibility = (order = {}) => {
  const normalized = normalizeOrderStatus(order.status);
  if (normalized === 'cancelled' || normalized === 'archived') return true;
  if (normalized === 'completed') return isStockEntryCompleted(order) && !isManualStockEntryPending(order);
  return isArchivedOrder(order);
};

const formatTimelineDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(',', '');
};

const getActivityDisplayMeta = (entry = {}) => {
  const rawStatus = normalizeOrderStatus(entry?.status);
  const rawType = normalizeOrderStatus(entry?.type || 'status_change');
  const typeLabelMap = {
    created: 'Sipariş Oluşturuldu',
    status_change: 'Durum Güncellendi',
    status_auto_progress: 'Durum Güncellendi',
  };
  const timelineMessageMap = {
    submitted_for_approval: 'Satın alma talebi onaya gönderildi',
    approved: 'Satın alma talebi onaylandı',
    supplier_notified: 'Sipariş tedarikçiye iletildi',
    preparing: 'Tedarikçi hazırlık sürecine aldı',
    ready_to_ship: 'Sipariş sevke hazırlandı',
    in_transit: 'Sipariş yola çıktı',
    goods_receipt_pending: 'Depo mal kabul bekliyor',
    goods_receipt_completed: 'Mal kabul tamamlandı',
    completed: 'Stok girişi tamamlandı',
  };
  const statusLabel = timelineMessageMap[rawStatus] || mapOrderStatusToTurkishLabel(rawStatus);
  const typeLabel = typeLabelMap[rawType] || 'Sipariş Güncellendi';
  return {
    eventType: rawStatus || rawType || 'status_change',
    label: rawStatus ? statusLabel : typeLabel,
    at: formatTimelineDateTime(entry?.at),
    note: rawStatus ? statusLabel : (String(entry?.note || '').trim() || 'Açıklama notu bulunmuyor.'),
  };
};

const getStatusTimestamp = (order = {}, targetStatus) => {
  const normalizedTarget = normalizeOrderStatus(targetStatus);
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  const match = history.find((entry) => normalizeOrderStatus(entry?.status) === normalizedTarget);
  if (match?.at) {
    const time = new Date(match.at).getTime();
    if (Number.isFinite(time)) return time;
  }

  const fallbackFieldMap = {
    submitted_for_approval: order.createdAt,
    approved: order.approvedAt || order.reviewedAt,
    supplier_notified: order.supplierNotifiedAt,
    preparing: order.preparingAt,
    ready_to_ship: order.readyToShipAt,
    in_transit: order.shippedAt,
    goods_receipt_pending: order.arrivedAt || order.deliveredAt,
    goods_receipt_completed: order.receivedAt,
    completed: order.completedAt || order.stockEntryCompletedAt || order.receivedAt,
  };

  const fallbackValue = fallbackFieldMap[normalizedTarget];
  if (!fallbackValue) return Number.NaN;
  const time = new Date(fallbackValue).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
};

const dedupeActivityLogEntries = (entries = []) => {
  const seen = new Set();
  const deduped = [];
  const technicalTypeKeywords = ['sync', 'repair'];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const type = normalizeOrderStatus(entry?.type || 'status_change');
    const status = normalizeOrderStatus(entry?.status);
    const isTechnical = technicalTypeKeywords.some((keyword) => type.includes(keyword));
    const hasMeaningfulStatus = Boolean(status && mapOrderStatusToTurkishLabel(status) !== 'Sipariş Güncellendi');
    const isCreatedEvent = type === 'created';

    if (isTechnical) continue;
    if (!hasMeaningfulStatus && !isCreatedEvent) continue;

    const key = [
      hasMeaningfulStatus ? status : '',
      isCreatedEvent ? 'created' : 'status_change',
    ].join('|');

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      ...entry,
      type: isCreatedEvent ? 'created' : 'status_change',
    });
  }

  return deduped.sort((a, b) => new Date(a?.at || 0).getTime() - new Date(b?.at || 0).getTime());
};

const resolveActualArrivalDate = (order = {}) => {
  const directFields = [
    order.receivedAt,
    order.deliveredAt,
    order.arrivedAt,
    order.reachedWarehouseAt,
  ];

  const firstDirect = directFields.find(Boolean);
  if (firstDirect) {
    return firstDirect;
  }

  const historyRows = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  for (let index = historyRows.length - 1; index >= 0; index -= 1) {
    const entry = historyRows[index];
    if (!entry?.at) continue;
    const normalized = normalizeOrderStatus(entry.status);
    if (DELIVERY_REACHED_STATUSES.has(normalized)) {
      return entry.at;
    }
  }

  const normalizedOrderStatus = normalizeOrderStatus(order.status);
  if (DELIVERY_REACHED_STATUSES.has(normalizedOrderStatus)) {
    return order.updatedAt || order.createdAt || '';
  }

  return '';
};

const getWaitingHours = (order = {}) => {
  const arrivalDate = resolveActualArrivalDate(order);
  if (!arrivalDate) return 0;

  const arrivalMs = new Date(arrivalDate).getTime();
  if (!Number.isFinite(arrivalMs)) return 0;

  return Math.max(0, (Date.now() - arrivalMs) / (1000 * 60 * 60));
};

let pdfMakeModulePromise = null;
let xlsxModulePromise = null;

const loadPdfMakeModule = async () => {
  if (!pdfMakeModulePromise) {
    pdfMakeModulePromise = Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ]).then(([pdfMakeModule, pdfFontsModule]) => ({
      pdfMake: pdfMakeModule?.default || pdfMakeModule,
      pdfFonts: pdfFontsModule?.default || pdfFontsModule,
    }));
  }
  return pdfMakeModulePromise;
};

const loadXlsxModule = async () => {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import('xlsx').then((module) => module?.default || module);
  }
  return xlsxModulePromise;
};

const resolveEmbeddedPdfVfs = (pdfFonts) => {
  const nestedVfs = pdfFonts?.pdfMake?.vfs || pdfFonts?.vfs || pdfFonts?.default?.pdfMake?.vfs || pdfFonts?.default?.vfs;
  if (nestedVfs && Object.keys(nestedVfs).length > 0) {
    return nestedVfs;
  }

  const rawFontMap = pdfFonts && typeof pdfFonts === 'object' ? pdfFonts : {};
  const directFontEntries = Object.entries(rawFontMap).filter(([key, value]) => key.toLowerCase().endsWith('.ttf') && typeof value === 'string');
  return directFontEntries.length ? Object.fromEntries(directFontEntries) : {};
};

const ensurePdfReady = async () => {
  const { pdfMake, pdfFonts } = await loadPdfMakeModule();
  const embeddedVfs = resolveEmbeddedPdfVfs(pdfFonts);
  if ((!pdfMake.vfs || Object.keys(pdfMake.vfs).length === 0) && Object.keys(embeddedVfs).length > 0) {
    pdfMake.vfs = embeddedVfs;
  }
  if (!pdfMake.vfs || Object.keys(pdfMake.vfs).length === 0) {
    throw new Error('PDF altyapısı hazırlanamadı. Lütfen sayfayı yenileyip tekrar deneyin.');
  }
  return pdfMake;
};

const ORDER_TABLE_PAGE_SIZE = 5;

const isCurrent = (currentStatus, value) => normalizeOrderStatus(currentStatus) === normalizeOrderStatus(value);

const isCancelledOption = (value) => String(value || '') === 'cancelled';

const getStatusStepTypeLabel = ({ current, locked }) => {
  if (current) return 'Mevcut';
  if (locked) return 'Uygun değil';
  return 'Sonraki';
};

const getStatusStepDescription = ({ current, selectable }) => {
  if (current) return 'Mevcut';
  if (selectable) return 'Sonraki';
  return '';
};

function StatusStepCard({
  value,
  index,
  selected,
  current,
  selectable,
  locked,
  completed,
  cancelled,
  actionTarget,
  onSelect,
}) {
  const meta = getStatusMeta(value);
  const typeLabel = getStatusStepTypeLabel({ current, locked });
  const description = getStatusStepDescription({ value, current, selectable, locked, cancelled });

  const isPreparing = value === 'preparing' || value === 'submitted_for_approval';

  const className = [
    'status-step-card',
    `group-${meta.valueGroup}`,
    `status-${value}`,
    current ? 'is-current' : '',
    selected ? 'is-selected' : '',
    locked ? 'is-locked' : '',
    completed ? 'is-completed' : '',
    selectable && !locked ? 'is-selectable' : '',
    cancelled ? 'is-cancel-option' : '',
    isPreparing && current ? 'is-preparing-active' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={className}
      style={{ '--status-step-index': index }}
      onClick={() => {
        if (locked) return;
        onSelect(actionTarget || value);
      }}
      role="radio"
      aria-label={`${meta.label} - ${typeLabel}`}
      aria-checked={selected}
      aria-selected={selected}
      aria-disabled={locked}
      disabled={locked}
      tabIndex={locked ? -1 : 0}
    >
      <span className="status-step-card-head">
        <span className="status-step-title-wrap">
          <span className="status-step-live-dot" aria-hidden="true" />
          <strong className="status-step-title">{meta.label}</strong>
        </span>
        <span className="status-step-badge">{typeLabel}</span>
      </span>

      {description ? <small className="status-step-description">{description}</small> : null}

      <span className="status-step-flow" aria-hidden="true">
        <span className="status-step-flow-dot" />
      </span>
    </button>
  );
}

function OrderStatusFlowPanel({ currentStatus, selectedStatus, onSelectStatus, isLoading = false }) {
  const canonicalCurrentStatus = normalizeOrderStatus(currentStatus);
  const visibleCurrentStatus = mapPurchaseOrderStatusToVisibleStatus(canonicalCurrentStatus);
  const selectableActionMap = useMemo(
    () => {
      const entries = new Map();
      entries.set(visibleCurrentStatus, canonicalCurrentStatus);
      (STATUS_TRANSITIONS[canonicalCurrentStatus] || []).forEach((actionStatus) => {
        const visibleStatus = actionStatus === 'approved'
          ? 'supplier_notified'
          : mapPurchaseOrderStatusToVisibleStatus(actionStatus);
        entries.set(visibleStatus, actionStatus);
      });
      return entries;
    },
    [canonicalCurrentStatus, visibleCurrentStatus],
  );
  const selectedVisibleStatus = useMemo(() => {
    if (selectedStatus === 'approved') return 'supplier_notified';
    return mapPurchaseOrderStatusToVisibleStatus(selectedStatus);
  }, [selectedStatus]);

  if (isLoading) {
    return (
      <div className="order-status-flow-panel is-loading" role="status" aria-live="polite" aria-busy="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={`status-skeleton-${index}`} className="status-step-card skeleton" style={{ '--status-step-index': index }}>
            <span className="status-step-skeleton-line status-step-skeleton-line-title" />
            <span className="status-step-skeleton-line status-step-skeleton-line-meta" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="order-status-flow-panel" role="radiogroup" aria-label="Sipariş durumu seçimi">
      {ORDER_STATUS_SEQUENCE.map((value, index) => {
        const current = isCurrent(visibleCurrentStatus, value);
        const selectable = selectableActionMap.has(value);
        const locked = !selectable;
        const cancelled = isCancelledOption(value);
        const currentIndex = ORDER_STATUS_SEQUENCE.indexOf(visibleCurrentStatus);
        const stepIndex = ORDER_STATUS_SEQUENCE.indexOf(value);
        const completed = !cancelled
          && canonicalCurrentStatus !== 'cancelled'
          && currentIndex > -1
          && stepIndex > -1
          && stepIndex < currentIndex;

        return (
          <StatusStepCard
            key={value}
            value={value}
            index={index}
            selected={selectedVisibleStatus === value}
            current={current}
            selectable={selectable}
            locked={locked}
            completed={completed}
            cancelled={cancelled}
            actionTarget={selectableActionMap.get(value)}
            onSelect={onSelectStatus}
          />
        );
      })}
    </div>
  );
}

function ActiveOrdersTable({ columns, rows, isLoading }) {
  return <DataTable columns={columns} rows={rows} isLoading={isLoading} emptyMessage="Aktif sipariş bulunmuyor." initialSort={{ key: 'createdAt', direction: 'desc' }} pageSize={ORDER_TABLE_PAGE_SIZE} />;
}

function WarehouseIncomingTable({ columns, rows, isLoading }) {
  return <DataTable columns={columns} rows={rows} isLoading={isLoading} emptyMessage="Mal kabul bekleyen sipariş bulunmuyor." initialSort={{ key: 'entryStatus', direction: 'desc' }} topHorizontalScroll pageSize={ORDER_TABLE_PAGE_SIZE} />;
}

function ManualStockEntryPendingTable({ columns, rows, isLoading }) {
  return <DataTable columns={columns} rows={rows} isLoading={isLoading} emptyMessage="Manuel stok girişi bekleyen sipariş bulunmuyor." initialSort={{ key: 'goodsReceiptCompletedAt', direction: 'desc' }} topHorizontalScroll pageSize={ORDER_TABLE_PAGE_SIZE} />;
}

function ArchiveOrdersTable({ columns, rows, isLoading }) {
  return <DataTable columns={columns} rows={rows} isLoading={isLoading} emptyMessage="Arşivde sipariş bulunmuyor." initialSort={{ key: 'createdAt', direction: 'desc' }} pageSize={ORDER_TABLE_PAGE_SIZE} />;
}

export default function PurchaseOrders() {
  const { user } = useAuth();
  const dialog = useDialog();
  const routeStateRef = useRef({});
  const createdByAutocompleteRef = useRef(null);
  const goodsReceiptSubmitInFlightRef = useRef(new Set());
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [createdBySearch, setCreatedBySearch] = useState('');
  const [createdByOptions, setCreatedByOptions] = useState([]);
  const [isCreatedByLoading, setIsCreatedByLoading] = useState(false);
  const [isCreatedByDropdownOpen, setIsCreatedByDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [processingId, setProcessingId] = useState('');
  const [statusModalOrder, setStatusModalOrder] = useState(null);
  const [nextStatus, setNextStatus] = useState('');
  const [detailOrder, setDetailOrder] = useState(null);
  const [receiptModalOrder, setReceiptModalOrder] = useState(null);
  const [receiptDecisionMode, setReceiptDecisionMode] = useState('auto');
  const [detailItems, setDetailItems] = useState([]);
  const [statusNote, setStatusNote] = useState('');
  const [receiptNote, setReceiptNote] = useState('');
  const [exportingPdfId, setExportingPdfId] = useState('');

  const detailActivityLog = useMemo(
    () => dedupeActivityLogEntries(detailOrder?.activityLog || []),
    [detailOrder?.activityLog]
  );

  const isAdmin = user?.role === 'admin';

  const loadData = async () => {
    try {
      setIsLoading(true);
      const apiQuery = {
        search: '',
        supplierId: '',
      };
      const [orders, supplierList] = await Promise.all([
        procurementService.listAllOrders(apiQuery),
        supplierService.list(),
      ]);
      const normalizedOrders = (Array.isArray(orders) ? orders : []).map((order) => ({
        ...order,
        orderNumber: normalizeOrderNumber(order.orderNumber, order.id),
      }));
      setRows(normalizedOrders);
      setSuppliers(supplierList);
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Takibi', message: error.message || 'Siparişler yüklenemedi.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    routeStateRef.current = window.history?.state?.usr || {};
  }, []);

  useEffect(() => {
    const routeState = routeStateRef.current || {};
    const targetOrderId = String(routeState.openOrderId || routeState.entityId || '').trim();
    const targetOrderNumber = String(routeState.openOrderNumber || routeState.referenceCode || '').trim();
    if ((!targetOrderId && !targetOrderNumber) || rows.length === 0) return;

    const targetRow = rows.find((row) => (
      (targetOrderId && String(row.id || '').trim() === targetOrderId)
      || (targetOrderNumber && normalizeOrderNumber(row.orderNumber, row.id) === normalizeOrderNumber(targetOrderNumber, targetOrderNumber))
    ));
    if (!targetRow) return;

    void openDetail(targetRow);
    routeStateRef.current = {};
    window.history.replaceState(
      { ...(window.history.state || {}), usr: {} },
      document.title,
      window.location.pathname + window.location.search
    );
  }, [rows]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!createdByAutocompleteRef.current?.contains(event.target)) {
        setIsCreatedByDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    const keyword = createdBySearch.trim();

    if (keyword.length < 2) {
      setCreatedByOptions([]);
      setIsCreatedByLoading(false);
      return undefined;
    }

    let cancelled = false;
    setIsCreatedByLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const users = await userService.search(keyword);
        if (cancelled) return;

        const normalizedKeyword = keyword.toLowerCase();
        const options = (Array.isArray(users) ? users : [])
          .map((item) => {
            const fullName = String(item.name || item.fullName || item.username || '').trim();
            const username = String(item.username || '').trim();
            const sicilNo = String(item.registerPin || item.employeeNo || item.sicilNo || '').trim();
            const mail = String(item.email || '').trim();

            const label = fullName || username || sicilNo || mail;
            if (!label) return null;

            const secondary = [username && username !== label ? username : '', sicilNo ? `Sicil: ${sicilNo}` : '']
              .filter(Boolean)
              .join(' • ');

            const searchText = [
              fullName,
              username,
              sicilNo,
              mail,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();

            return {
              value: String(item.id || username || sicilNo || fullName),
              label,
              secondary,
              filterValue: [fullName, username, sicilNo].filter(Boolean).join(' '),
              searchText,
            };
          })
          .filter(Boolean)
          .filter((option) => option.searchText.includes(normalizedKeyword));

        const deduped = [];
        const seen = new Set();
        options.forEach((option) => {
          const key = `${option.label}__${option.secondary}`.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(option);
          }
        });

        setCreatedByOptions(deduped.slice(0, 12));
        setIsCreatedByDropdownOpen(true);
      } catch {
        if (!cancelled) {
          setCreatedByOptions([]);
          setIsCreatedByDropdownOpen(true);
        }
      } finally {
        if (!cancelled) {
          setIsCreatedByLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [createdBySearch]);

  const filteredRows = useMemo(() => {
    const searchNormalized = normalizeSearchText(filters.search);

    return rows.filter((row) => {
      const matchesSearch = !searchNormalized
        || [row.orderNumber, row.supplierName, row.createdByName]
          .filter(Boolean)
          .some((value) => includesNormalized(value, searchNormalized));

      const matchesStatus = !filters.status || normalizeOrderStatus(row.status) === normalizeOrderStatus(filters.status);
      const matchesSupplier = !filters.supplierId || row.supplierId === filters.supplierId;
      const createdByQuery = normalizeSearchText(filters.createdBy);
      const matchesCreatedBy = !createdByQuery || [
        row.createdByName,
        row.createdBy,
        row.createdByUsername,
        row.createdByEmployeeNo,
        row.createdBySicilNo,
      ]
        .filter(Boolean)
        .some((value) => includesNormalized(value, createdByQuery));

      const createdAt = row.createdAt ? new Date(row.createdAt) : null;
      const estimatedDelivery = row.estimatedDeliveryDate ? new Date(row.estimatedDeliveryDate) : null;

      const matchesOrderDate = isOrderWithinDateBounds(createdAt, filters);

      const amount = Number(row.grandTotal ?? row.totalAmount ?? 0);
      const matchesAmountMin = !filters.amountMin || amount >= parseMoneyInput(filters.amountMin, 0);
      const matchesAmountMax = !filters.amountMax || amount <= parseMoneyInput(filters.amountMax, 0);

      return (
        matchesSearch
        && matchesStatus
        && matchesSupplier
        && matchesCreatedBy
        && matchesOrderDate
        && matchesAmountMin
        && matchesAmountMax
      );
    });
  }, [rows, filters]);

  const applyOrderDatePreset = (preset) => {
    setFilters((current) => ({ ...current, ...buildOrderDatePreset(preset) }));
  };

  const handleCreatedByInputChange = (value) => {
    setCreatedBySearch(value);
    setFilters((current) => ({ ...current, createdBy: value }));
    if (value.trim().length >= 2) {
      setIsCreatedByDropdownOpen(true);
    }
  };

  const handleCreatedBySelect = (option) => {
    const nextFilterValue = option?.filterValue || option?.label || '';
    setCreatedBySearch(option?.label || nextFilterValue);
    setFilters((current) => ({ ...current, createdBy: nextFilterValue }));
    setIsCreatedByDropdownOpen(false);
  };

  const clearCreatedByFilter = () => {
    setCreatedBySearch('');
    setCreatedByOptions([]);
    setIsCreatedByDropdownOpen(false);
    setFilters((current) => ({ ...current, createdBy: '' }));
  };

  const openStatusModal = (order) => {
    if (!canManageOrderStatus(order)) {
      setToast({ type: 'info', title: 'Sipariş Takibi', message: 'Bu adım sistem akışına bağlı olarak ilerliyor. Uygun işlem adımından devam edebilirsiniz.' });
      return;
    }
    setStatusModalOrder(order);
    setNextStatus(normalizeOrderStatus(order.status));
    setStatusNote('');
  };

  const handleStatusUpdate = async (event) => {
    event.preventDefault();
    if (!statusModalOrder || !nextStatus) return;

    const currentStatus = normalizeOrderStatus(statusModalOrder.status);
    const normalizedNextStatus = normalizeOrderStatus(nextStatus);
    const allowedTransitions = STATUS_TRANSITIONS[currentStatus] || [currentStatus];
    if (!allowedTransitions.includes(normalizedNextStatus)) {
      setToast({ type: 'error', title: 'Sipariş Takibi', message: 'Seçilen durum geçişi bu aşamada geçerli değil.' });
      return;
    }

    try {
      setProcessingId(statusModalOrder.id);
      await procurementService.updateOrderStatus(statusModalOrder.id, { status: normalizedNextStatus, note: statusNote });
      setToast({ type: 'success', title: 'Sipariş Takibi', message: 'Sipariş durumu güncellendi.' });
      setStatusModalOrder(null);
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Takibi', message: error.message || 'Durum güncellenemedi.' });
    } finally {
      setProcessingId('');
    }
  };

  const openDetail = async (order) => {
    try {
      setProcessingId(order.id);
      const items = await procurementService.getOrderItems(order.id);
      setDetailOrder(order);
      setDetailItems(items);
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Takibi', message: error.message || 'Sipariş detayları yüklenemedi.' });
    } finally {
      setProcessingId('');
    }
  };

  const openReceiptModal = (order) => {
    setReceiptModalOrder(order);
    setReceiptNote('');
    setReceiptDecisionMode('auto');
  };

  const handleConfirmGoodsReceipt = async (event) => {
    event.preventDefault();
    if (!receiptModalOrder) return;
    const orderId = String(receiptModalOrder.id || '').trim();
    if (!orderId) return;
    if (goodsReceiptSubmitInFlightRef.current.has(orderId)) return;

    try {
      goodsReceiptSubmitInFlightRef.current.add(orderId);
      setProcessingId(orderId);
      await procurementService.updateOrderStatus(receiptModalOrder.id, {
        status: 'goods_receipt_completed',
        stockEntryMode: receiptDecisionMode,
        note: receiptNote ?
          `Mal kabul notu: ${receiptNote}`
          : receiptDecisionMode === 'manual' ?
            'Mal kabul tamamlandı. Stok girişi manuel tamamlanacak.'
            : 'Mal kabul tamamlandı. Stok girişi otomatik tamamlandı.',
      });

      setToast({
        type: 'success',
        title: 'Mal Kabul',
        message: receiptDecisionMode === 'manual' ?
          'Mal kabul tamamlandı. Sipariş stok girişi bekleyenlere aktarıldı.'
          : 'Mal kabul ve otomatik stok girişi tamamlandı. Sipariş arşive taşındı.',
      });
      setReceiptModalOrder(null);
      setReceiptNote('');
      setReceiptDecisionMode('auto');
      await loadData();
    } catch (error) {
      const message = String(error?.message || '').trim();
      setToast({
        type: 'error',
        title: 'Mal Kabul',
        message: message || 'Mal kabul onaylanamadı.',
      });
    } finally {
      goodsReceiptSubmitInFlightRef.current.delete(orderId);
      setProcessingId('');
    }
  };


  const handleCancelOrder = async (order) => {
    if (!order) return;
    const confirmed = await dialog.confirm({
      title: 'Siparişi İptal Et',
      description: `${normalizeOrderNumber(order.orderNumber, order.id)} numaralı siparişi iptal etmek istediğinize emin misiniz?`,
      confirmText: 'Siparişi İptal Et',
      cancelText: 'Vazgeç',
      variant: 'error',
      closeOnBackdrop: false,
    });
    if (!confirmed) return;

    try {
      setProcessingId(order.id);
      await procurementService.updateOrderStatus(order.id, { status: 'cancelled' });
      await dialog.success({
        title: 'Sipariş İptal Edildi',
        description: `${normalizeOrderNumber(order.orderNumber, order.id)} numaralı sipariş başarıyla iptal edildi.`,
        confirmText: 'Tamam',
      });
      await loadData();
    } catch (error) {
      await dialog.error({
        title: 'Sipariş İptal Edilemedi',
        description: error.message || 'Sipariş iptal işlemi sırasında bir hata oluştu.',
      });
    } finally {
      setProcessingId('');
    }
  };

  const handleExportOrderXlsx = async (order) => {
    if (!order) return;
    try {
      const XLSX = await loadXlsxModule();
      const items = await procurementService.getOrderItems(order.id);
      const rows = items.map((item) => ({
        SKU: item.sku || '-',
        Urun: item.productName || '-',
        Miktar: Number(item.quantity || 0),
        'Birim Fiyat': Number(item.unitPrice || 0),
        Toplam: Number(item.totalPrice || 0),
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ SKU: '-', Urun: '-', Miktar: 0, 'Birim Fiyat': 0, Toplam: 0 }]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Siparis Kalemleri');
      XLSX.writeFile(workbook, `${normalizeOrderNumber(order.orderNumber, order.id)}-detay.xlsx`);
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Takibi', message: error.message || 'Sipariş dışa aktarılamadı.' });
    }
  };

  const handleExportOrderPdf = async (order) => {
    if (!order) return;
    try {
      setExportingPdfId(order.id);
      const pdfMake = await ensurePdfReady();
      const items = await procurementService.getOrderItems(order.id);
      const tableBody = [
        [
          { text: 'SKU', style: 'tableHeader' },
          { text: 'Ürün', style: 'tableHeader' },
          { text: 'Miktar', style: 'tableHeader' },
          { text: 'Birim Fiyat', style: 'tableHeader' },
          { text: 'Toplam', style: 'tableHeader' },
        ],
        ...items.map((item) => ([
          { text: String(item.sku || '-'), style: 'tableCell' },
          { text: String(item.productName || '-'), style: 'tableCell' },
          { text: String(formatNumber(item.quantity || 0)), style: 'tableCell' },
          { text: String(formatCurrency(item.unitPrice || 0, order.currency)), style: 'tableCell' },
          { text: String(formatCurrency(item.totalPrice || 0, order.currency)), style: 'tableCell' },
        ])),
      ];

      const docDefinition = {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: [36, 44, 36, 36],
        defaultStyle: { font: 'Roboto', fontSize: 9.5, lineHeight: 1.28 },
        content: [
          { text: `Sipariş Raporu - ${normalizeOrderNumber(order.orderNumber, order.id)}`, style: 'title' },
          { text: `Tedarikçi: ${order.supplierName || '-'}\nTarih: ${formatDate(order.createdAt)}`, style: 'meta', margin: [0, 8, 0, 12] },
          {
            table: { headerRows: 1, dontBreakRows: true, widths: [70, '*', 58, 88, 88], body: tableBody },
            layout: {
              fillColor: (rowIndex) => (rowIndex === 0 ? '#eef2f7' : rowIndex % 2 === 0 ? '#fafcff' : '#ffffff'),
              hLineColor: () => '#dbe3ee',
              vLineColor: () => '#dbe3ee',
              paddingLeft: () => 7,
              paddingRight: () => 7,
              paddingTop: () => 6,
              paddingBottom: () => 6,
            },
          },
        ],
        styles: {
          title: { fontSize: 16, bold: true, color: '#0f172a' },
          meta: { fontSize: 9, color: '#475569' },
          tableHeader: { bold: true, color: '#0f172a', fontSize: 9 },
          tableCell: { color: '#1f2937', fontSize: 8.8 },
        },
      };

      pdfMake.createPdf(docDefinition).download(`${normalizeOrderNumber(order.orderNumber, order.id)}-raporu.pdf`);
    } catch (error) {
      setToast({ type: 'error', title: 'Sipariş Takibi', message: error.message || 'Sipariş PDF dışa aktarımı başarısız.' });
    } finally {
      setExportingPdfId('');
    }
  };

  const buildColumns = ({ showStatusAction = true, showCancelAction = true } = {}) => [
    {
      key: 'orderNumber',
      label: 'Sipariş No',
      render: (row) => normalizeOrderNumber(row.orderNumber, row.id),
      sortValue: (row) => normalizeOrderNumber(row.orderNumber, row.id),
    },
    { key: 'supplierName', label: 'Tedarikçi' },
    {
      key: 'warehouseCity',
      label: 'Depo / Mağaza',
      render: (row) => formatTurkishDisplayText(row.warehouseCity || row.deliveryLocation, '-'),
    },
    {
      key: 'createdByName',
      label: 'Oluşturan Kullanıcı',
      render: (row) => row.createdByName || 'Sistem',
    },
    { key: 'totalItemQty', label: 'Toplam Adet', sortValue: (row) => Number(row.totalItemQty || 0) },
    {
      key: 'grandTotal',
      label: 'Toplam Tutar',
      render: (row) => formatCurrency(row.grandTotal ?? row.totalAmount ?? 0),
      sortValue: (row) => Number(row.grandTotal ?? row.totalAmount ?? 0),
    },
    {
      key: 'status',
      label: 'Durum',
      render: (row) => <StatusBadge tone={resolveStatusBadgeTone(row.status)}>{mapOrderStatusToTurkishLabel(row.status)}</StatusBadge>,
      sortable: false,
    },
    {
      key: 'createdAt',
      label: 'Sipariş Tarihi',
      render: (row) => formatDate(row.createdAt),
      sortValue: (row) => new Date(row.createdAt).getTime(),
    },
    {
      key: 'estimatedDeliveryDate',
      label: 'Tahmini Teslim',
      render: (row) => {
        const isLate = row.estimatedDeliveryDate
          && new Date(row.estimatedDeliveryDate) < new Date()
          && !ARCHIVE_STATUSES.has(normalizeOrderStatus(row.status));
        return (
          <span className={isLate ? 'text-danger' : ''}>{formatDateOnly(row.estimatedDeliveryDate)}</span>
        );
      },
      sortValue: (row) => (row.estimatedDeliveryDate ? new Date(row.estimatedDeliveryDate).getTime() : 0),
    },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      render: (row) => (
        <div className="table-actions">
          <button className="text-button" type="button" onClick={() => openDetail(row)} disabled={processingId === row.id}>Detay</button>
          {isAdmin && showStatusAction && canManageOrderStatus(row) ? <button className="text-button" type="button" onClick={() => openStatusModal(row)} disabled={processingId === row.id}>Durum</button> : null}
          {isAdmin && showCancelAction && row.status !== 'cancelled' ? <button className="text-button" type="button" onClick={() => handleCancelOrder(row)} disabled={processingId === row.id}>İptal</button> : null}
        </div>
      ),
    },
  ];

  const approvalColumns = useMemo(() => buildColumns({ showStatusAction: true, showCancelAction: true }), [processingId, isAdmin]);
  const activeColumns = useMemo(() => buildColumns({ showStatusAction: true, showCancelAction: true }), [processingId, isAdmin]);
  const archiveColumns = useMemo(() => buildColumns({ showStatusAction: false, showCancelAction: false }), [processingId, isAdmin]);
  const warehouseArrivalPendingColumns = useMemo(() => ([
    { key: 'orderNumber', label: 'Sipariş No', render: (row) => normalizeOrderNumber(row.orderNumber, row.id), sortValue: (row) => normalizeOrderNumber(row.orderNumber, row.id) },
    { key: 'supplierName', label: 'Tedarikçi' },
    {
      key: 'warehouseCity',
      label: 'Depo / Mağaza',
      render: (row) => row.warehouseCity || row.deliveryLocation || '-',
    },
    {
      key: 'estimatedDeliveryDate',
      label: 'Tahmini Teslim',
      render: (row) => formatDateOnly(row.estimatedDeliveryDate),
      sortValue: (row) => (row.estimatedDeliveryDate ? new Date(row.estimatedDeliveryDate).getTime() : 0),
    },
    {
      key: 'actualArrivalDate',
      label: 'Gerçek Ulaşma Tarihi',
      render: (row) => formatDate(resolveActualArrivalDate(row)),
      sortValue: (row) => {
        const value = resolveActualArrivalDate(row);
        return value ? new Date(value).getTime() : 0;
      },
    },
    {
      key: 'itemCount',
      label: 'Toplam Kalem',
      render: (row) => formatNumber(row.itemCount || 0),
      sortValue: (row) => Number(row.itemCount || 0),
    },
    {
      key: 'grandTotal',
      label: 'Toplam Tutar',
      render: (row) => formatCurrency(row.grandTotal ?? row.totalAmount ?? 0),
      sortValue: (row) => Number(row.grandTotal ?? row.totalAmount ?? 0),
    },
    {
      key: 'status',
      label: 'Durum',
      render: (row) => <StatusBadge tone={resolveStatusBadgeTone(row.status)}>{mapOrderStatusToTurkishLabel(row.status)}</StatusBadge>,
      sortable: false,
    },
    {
      key: 'entryStatus',
      label: 'Giriş Durumu',
      render: (row) => {
        const waitingHours = getWaitingHours(row);
        const waitingDays = Math.floor(waitingHours / 24);
        const isCritical = waitingHours >= 48;

        return (
          <div className="table-inline-stack">
            <StatusBadge tone={isCritical ? 'danger' : 'warning'}>Giriş Bekliyor</StatusBadge>
          </div>
        );
      },
      sortValue: (row) => getWaitingHours(row),
    },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      render: (row) => (
        <div className="table-actions">
          <button className="text-button" type="button" onClick={() => openDetail(row)} disabled={processingId === row.id}>Detay</button>
          <button
            className="text-button"
            type="button"
            onClick={() => openReceiptModal(row)}
            disabled={!isAdmin || processingId === row.id || !canManualGoodsReceipt(row)}
            title={!isAdmin ? 'Mal kabul onayı için yetkiniz bulunmuyor.' : undefined}
          >
            Mal Kabul
          </button>
        </div>
      ),
    },
  ]), [processingId, isAdmin]);

  const manualStockEntryPendingColumns = useMemo(() => ([
    { key: 'orderNumber', label: 'Sipariş No', render: (row) => normalizeOrderNumber(row.orderNumber, row.id), sortValue: (row) => normalizeOrderNumber(row.orderNumber, row.id) },
    { key: 'supplierName', label: 'Tedarikçi' },
    {
      key: 'warehouseCity',
      label: 'Depo / Mağaza',
      render: (row) => row.warehouseCity || row.deliveryLocation || '-',
    },
    {
      key: 'goodsReceiptCompletedAt',
      label: 'Mal Kabul Tarihi',
      render: (row) => formatDate(row.goodsReceiptCompletedAt || row.updatedAt),
      sortValue: (row) => new Date(row.goodsReceiptCompletedAt || row.updatedAt || row.createdAt).getTime(),
    },
    {
      key: 'itemCount',
      label: 'Toplam Kalem',
      render: (row) => formatNumber(row.itemCount || 0),
      sortValue: (row) => Number(row.itemCount || 0),
    },
    {
      key: 'grandTotal',
      label: 'Toplam Tutar',
      render: (row) => formatCurrency(row.grandTotal ?? row.totalAmount ?? 0),
      sortValue: (row) => Number(row.grandTotal ?? row.totalAmount ?? 0),
    },
    {
      key: 'status',
      label: 'Durum',
      render: (row) => <StatusBadge tone={resolveStatusBadgeTone(row.status)}>{mapOrderStatusToTurkishLabel(row.status)}</StatusBadge>,
      sortable: false,
    },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      render: (row) => (
        <div className="table-actions">
          <button className="text-button" type="button" onClick={() => openDetail(row)} disabled={processingId === row.id}>Detay</button>
          <button className="text-button" type="button" onClick={() => handleExportOrderXlsx(row)} disabled={processingId === row.id}>Excel</button>
        </div>
      ),
    },
  ]), [processingId]);

  const approvalPendingRows = useMemo(() => filteredRows.filter((row) => {
    const normalizedStatus = normalizeOrderStatus(row.status);
    if (ARCHIVE_STATUSES.has(normalizedStatus)) return false;
    if (!APPROVAL_PENDING_STATUSES.has(normalizedStatus)) return false;
    return row.approvalRequested !== false;
  }), [filteredRows]);

  const warehouseArrivalPendingRows = useMemo(() => filteredRows.filter((row) => {
    const normalizedStatus = normalizeOrderStatus(row.status);
    if (!(normalizedStatus === 'delivered' || normalizedStatus === 'goods_receipt_pending')) return false;
    return !isStockEntryCompleted(row);
  }), [filteredRows]);

  const manualStockEntryPendingRows = useMemo(() => filteredRows.filter((row) => {
    return isManualStockEntryPending(row);
  }), [filteredRows]);

  const activeRows = useMemo(
    () => filteredRows.filter((row) => (
      !ARCHIVE_STATUSES.has(normalizeOrderStatus(row.status))
      && !approvalPendingRows.some((pending) => pending.id === row.id)
      && !warehouseArrivalPendingRows.some((pending) => pending.id === row.id)
      && !manualStockEntryPendingRows.some((pending) => pending.id === row.id)
      && normalizeOrderStatus(row.status) !== 'completed'
    )),
    [filteredRows, approvalPendingRows, warehouseArrivalPendingRows, manualStockEntryPendingRows]
  );

  const archiveRows = useMemo(
    () => filteredRows.filter((row) => (
      getArchiveEligibility(row)
      && !warehouseArrivalPendingRows.some((pending) => pending.id === row.id)
      && !manualStockEntryPendingRows.some((pending) => pending.id === row.id)
    )),
    [filteredRows, warehouseArrivalPendingRows, manualStockEntryPendingRows]
  );

  const viewSummary = useMemo(() => ({
    pendingCount: approvalPendingRows.length,
    pendingAmount: approvalPendingRows.reduce((sum, row) => sum + (Number(row.grandTotal ?? row.totalAmount ?? 0) || 0), 0),
    waitingReceiptCount: warehouseArrivalPendingRows.length,
    waitingReceiptAmount: warehouseArrivalPendingRows.reduce((sum, row) => sum + (Number(row.grandTotal ?? row.totalAmount ?? 0) || 0), 0),
    manualEntryCount: manualStockEntryPendingRows.length,
    manualEntryAmount: manualStockEntryPendingRows.reduce((sum, row) => sum + (Number(row.grandTotal ?? row.totalAmount ?? 0) || 0), 0),
    activeCount: activeRows.length,
    activeAmount: activeRows.reduce((sum, row) => sum + (Number(row.grandTotal ?? row.totalAmount ?? 0) || 0), 0),
    archiveCount: archiveRows.length,
    archiveAmount: archiveRows.reduce((sum, row) => sum + (Number(row.grandTotal ?? row.totalAmount ?? 0) || 0), 0),
  }), [approvalPendingRows, warehouseArrivalPendingRows, manualStockEntryPendingRows, activeRows, archiveRows]);

  const delayedSummary = useMemo(() => {
    const now = new Date();
    const delayedRows = filteredRows.filter((row) => {
      if (!row?.estimatedDeliveryDate) return false;
      if (ARCHIVE_STATUSES.has(normalizeOrderStatus(row.status))) return false;
      return new Date(row.estimatedDeliveryDate) < now;
    });

    return {
      count: delayedRows.length,
      amount: delayedRows.reduce((sum, row) => sum + (Number(row.grandTotal ?? row.totalAmount ?? 0) || 0), 0),
    };
  }, [filteredRows]);

  const dueTodaySummary = useMemo(() => {
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const dueTodayRows = filteredRows.filter((row) => {
      if (!row?.estimatedDeliveryDate) return false;
      if (ARCHIVE_STATUSES.has(normalizeOrderStatus(row.status))) return false;
      return new Date(row.estimatedDeliveryDate).toISOString().slice(0, 10) === todayIso;
    });

    return {
      count: dueTodayRows.length,
      amount: dueTodayRows.reduce((sum, row) => sum + (Number(row.grandTotal ?? row.totalAmount ?? 0) || 0), 0),
    };
  }, [filteredRows]);

  const lifecyclePerformance = useMemo(() => {
    const collectStage = (startStatus, endStatus) => calculateLifecycleStageMetric({
      orders: filteredRows,
      startStatus,
      endStatus,
      getStatusTimestamp,
    });

    const total = filteredRows.length;
    const approval = collectStage('submitted_for_approval', 'approved');
    const supplierNotify = collectStage('approved', 'supplier_notified');
    const delivery = collectStage('supplier_notified', 'goods_receipt_completed');
    return {
      avgApprovalHours: approval.averageHours,
      avgSupplierNotifyHours: supplierNotify.averageHours,
      avgDeliveryHours: delivery.averageHours,
      approvalActiveCount: approval.activeCount,
      delayedRate: total ? (delayedSummary.count / total) * 100 : null,
      total,
    };
  }, [delayedSummary.count, filteredRows]);

  const bottleneckData = useMemo(() => {
    const stageDefinitions = [
      { key: 'approval', name: 'Onay bekleme', start: 'submitted_for_approval', end: 'approved' },
      { key: 'supplier', name: 'Tedarikçiye iletim', start: 'approved', end: 'supplier_notified' },
      { key: 'preparation', name: 'Hazırlık süreci', start: 'supplier_notified', end: 'ready_to_ship' },
      { key: 'receipt', name: 'Mal kabul', start: 'in_transit', end: 'goods_receipt_completed' },
      { key: 'stockEntry', name: 'Stok girişi', start: 'goods_receipt_completed', end: 'completed' },
    ];

    return stageDefinitions
      .map((stage) => {
        const metric = calculateLifecycleStageMetric({
          orders: filteredRows,
          startStatus: stage.start,
          endStatus: stage.end,
          getStatusTimestamp,
        });

        if (!metric.sampleCount) {
          return null;
        }

        return {
          key: stage.key,
          name: stage.name,
          value: Number(metric.averageHours.toFixed(1)),
          activeCount: metric.activeCount,
        };
      })
      .filter(Boolean);
  }, [filteredRows]);

  const dailyVolumeData = useMemo(() => {
    const now = new Date();
    const buckets = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      buckets.push({
        key,
        day: date.toLocaleDateString('tr-TR', { weekday: 'short' }),
        count: 0,
      });
    }

    const indexByKey = new Map(buckets.map((item) => [item.key, item]));
    filteredRows.forEach((row) => {
      if (!row.createdAt) return;
      const key = new Date(row.createdAt).toISOString().slice(0, 10);
      const target = indexByKey.get(key);
      if (target) {
        target.count += 1;
      }
    });

    return buckets;
  }, [filteredRows]);

  const supplierIntensityData = useMemo(() => {
    const bySupplier = new Map();
    filteredRows.forEach((row) => {
      const supplierName = String(row.supplierName || 'Bilinmiyor').trim() || 'Bilinmiyor';
      bySupplier.set(supplierName, (bySupplier.get(supplierName) || 0) + 1);
    });

    return Array.from(bySupplier.entries())
      .map(([name, count]) => ({
        name: name.length > 18 ? `${name.slice(0, 18)}…` : name,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredRows]);

  const formatMetricHours = (value) => {
    if (!Number.isFinite(value) || value === null) return 'Veri yok';
    if (value < 24) return `${formatNumber(Number(value.toFixed(1)))} sa`;
    const days = value / 24;
    return `${formatNumber(Number(days.toFixed(1)))} gün`;
  };

  const subtotalAmount = detailOrder?.subtotalAmount ?? detailOrder?.totalAmount ?? 0;
  const taxAmount = detailOrder?.taxAmount ?? 0;
  const shippingFee = detailOrder?.shippingFee ?? 0;
  const discountAmount = detailOrder?.discountAmount ?? 0;
  const grandTotal = detailOrder?.grandTotal ?? (subtotalAmount + taxAmount + shippingFee - discountAmount);
  const orderCurrency = detailOrder?.currency;
  const statusModalTotal = statusModalOrder ?
    Number(statusModalOrder.grandTotal ?? statusModalOrder.totalAmount ?? 0) || 0
    : 0;
  const statusModalCurrency = statusModalOrder?.currency;

  const detailDeliveredQty = detailOrder?.status === 'delivered' ?
    Number(detailOrder?.totalItemQty || 0)
    : Number(detailOrder?.deliveredQuantityTotal || 0);
  const detailRemainingQty = Math.max(0, Number(detailOrder?.totalItemQty || 0) - detailDeliveredQty);
  const detailTotalCases = Number(detailOrder?.totalCaseQty ?? detailOrder?.caseTotal ?? 0);

  return (
    <div className="page-stack purchase-orders-page">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageHeader
        className="dashboard-hero"
        icon={<Receipt size={22} />}
        title="Sipariş Takibi"
        description="Sipariş süreç akışını onay, giriş bekleyen, aktif operasyon ve arşiv bölümlerinde yönetin."
      />

      <section className="mod-summary-grid purchase-orders-summary-grid">
        <div className="mod-stat purchase-orders-stat stat-active">
          <div className="mod-stat-icon mod-icon-cyan"><Clock size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Onay Bekleyenler</span>
            <span className="mod-stat-value">{formatNumber(viewSummary.pendingCount)}</span>
            <div className="purchase-orders-stat-meta">
              <span className="purchase-orders-stat-amount">Toplam: {formatCurrency(viewSummary.pendingAmount || 0)}</span>
            </div>
          </div>
        </div>
        <div className="mod-stat purchase-orders-stat stat-transit">
          <div className="mod-stat-icon mod-icon-violet"><Truck size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Giriş Bekleyen</span>
            <span className="mod-stat-value">{formatNumber(viewSummary.waitingReceiptCount)}</span>
            <div className="purchase-orders-stat-meta">
              <span className="purchase-orders-stat-amount">Toplam: {formatCurrency(viewSummary.waitingReceiptAmount || 0)}</span>
            </div>
          </div>
        </div>
        <div className="mod-stat purchase-orders-stat stat-transit">
          <div className="mod-stat-icon mod-icon-amber"><Truck size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Aktif Sipariş</span>
            <span className="mod-stat-value">{formatNumber(viewSummary.activeCount)}</span>
            <div className="purchase-orders-stat-meta">
              <span className="purchase-orders-stat-amount">Toplam: {formatCurrency(viewSummary.activeAmount || 0)}</span>
            </div>
          </div>
        </div>
        <div className="mod-stat purchase-orders-stat stat-completed">
          <div className="mod-stat-icon mod-icon-indigo"><Archive size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Arşiv</span>
            <span className="mod-stat-value">{formatNumber(viewSummary.archiveCount)}</span>
            <div className="purchase-orders-stat-meta">
              <span className="purchase-orders-stat-amount">Toplam: {formatCurrency(viewSummary.archiveAmount || 0)}</span>
            </div>
          </div>
        </div>
        <div className="mod-stat purchase-orders-stat stat-delayed">
          <div className="mod-stat-icon mod-icon-rose"><AlertTriangle size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Geciken Sipariş</span>
            <span className="mod-stat-value">{formatNumber(delayedSummary.count)}</span>
            <div className="purchase-orders-stat-meta">
              <span className="purchase-orders-stat-amount">Tutar: {formatCurrency(delayedSummary.amount || 0)}</span>
            </div>
          </div>
        </div>
        <div className="mod-stat purchase-orders-stat stat-due-today">
          <div className="mod-stat-icon mod-icon-green"><CalendarDays size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Bugün Teslim Beklenen</span>
            <span className="mod-stat-value">{formatNumber(dueTodaySummary.count)}</span>
            <div className="purchase-orders-stat-meta">
              <span className="purchase-orders-stat-amount">Tutar: {formatCurrency(dueTodaySummary.amount || 0)}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="purchase-orders-chart-grid" aria-label="Sipariş trend grafikleri">
        <article className="mod-card purchase-orders-chart-card">
          <div className="purchase-orders-chart-head">
            <h3>Sipariş Süreç Performansı</h3>
          </div>
          <div className="purchase-orders-chart-body">
            {lifecyclePerformance.total ? (
              <div className="purchase-orders-lifecycle-grid">
                <div className="purchase-orders-lifecycle-metric">
                  <span>Onaya Gönderildi / Onay Bekliyor</span>
                  <strong>{formatMetricHours(lifecyclePerformance.avgApprovalHours)}</strong>
                  <small>{formatNumber(lifecyclePerformance.approvalActiveCount)} aktif sipariş</small>
                </div>
                <div className="purchase-orders-lifecycle-metric">
                  <span>Ortalama tedarikçiye iletme süresi</span>
                  <strong>{formatMetricHours(lifecyclePerformance.avgSupplierNotifyHours)}</strong>
                </div>
                <div className="purchase-orders-lifecycle-metric">
                  <span>Ortalama teslimat süresi</span>
                  <strong>{formatMetricHours(lifecyclePerformance.avgDeliveryHours)}</strong>
                </div>
                <div className="purchase-orders-lifecycle-metric">
                  <span>Geciken sipariş oranı</span>
                  <strong>{lifecyclePerformance.delayedRate === null ? 'Veri yok' : `%${formatNumber(lifecyclePerformance.delayedRate.toFixed(1))}`}</strong>
                </div>
              </div>
            ) : <p className="chart-empty">Veri yok</p>}
          </div>
        </article>

        <article className="mod-card purchase-orders-chart-card">
          <div className="purchase-orders-chart-head">
            <h3>Gün Bazlı Sipariş Hacmi</h3>
          </div>
          <div className="purchase-orders-chart-body">
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={dailyVolumeData} margin={{ top: 8, right: 8, left: -18, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip formatter={(value) => [formatNumber(value), 'Sipariş']} />
                <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="mod-card purchase-orders-chart-card">
          <div className="purchase-orders-chart-head">
            <h3>Tedarikçi Bazlı Sipariş Yoğunluğu</h3>
          </div>
          <div className="purchase-orders-chart-body">
            {supplierIntensityData.length ? (
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={supplierIntensityData} margin={{ top: 8, right: 8, left: -18, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip formatter={(value) => [formatNumber(value), 'Sipariş']} />
                  <Bar dataKey="count" fill="#0ea5c9" radius={[6, 6, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="chart-empty">Veri yok</p>}
          </div>
        </article>

        <article className="mod-card purchase-orders-chart-card">
          <div className="purchase-orders-chart-head">
            <h3>Süreç Aşamalarına Göre Ortalama Bekleme</h3>
          </div>
          <div className="purchase-orders-chart-body">
            {bottleneckData.length ? (
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={bottleneckData} margin={{ top: 8, right: 8, left: -18, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip formatter={(value) => [`${formatNumber(value)} saat`, 'Ortalama süre']} />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[6, 6, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="chart-empty">Veri yok</p>}
          </div>
        </article>
      </section>

      <div className="mod-card purchase-orders-filter-shell">
        <div className="mod-card-header purchase-orders-filter-header">
          <div className="mod-card-icon mod-icon-violet"><Filter size={18} /></div>
          <div>
            <h3>Filtreler</h3>
            <p>Arama, tedarikçi ve durum filtreleriyle sipariş görünümünü netleştirin.</p>
          </div>
        </div>
        <FilterBar className="purchase-orders-filter">
          <div className="purchase-orders-filter-block purchase-orders-filter-basic">
            <label className="field-group">
              <span>Arama</span>
              <input
                value={filters.search}
                onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                placeholder="Sipariş no veya tedarikçi ara"
              />
            </label>
            <label className="field-group">
              <span>Tedarikçi</span>
              <select
                value={filters.supplierId}
                onChange={(event) => setFilters((current) => ({ ...current, supplierId: event.target.value }))}
              >
                <option value="">Tüm Tedarikçiler</option>
                {suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="field-group">
              <span>Durum</span>
              <select
                value={filters.status}
                onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
              >
                <option value="">Tüm Durumlar</option>
                {ORDER_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </select>
            </label>
            <label className="field-group">
              <span>Sipariş Başlangıç</span>
              <input
                type="date"
                value={filters.orderDateFrom}
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  orderDateFrom: event.target.value,
                  orderDateFromTime: '',
                }))}
              />
            </label>
            <label className="field-group">
              <span>Sipariş Bitiş</span>
              <input
                type="date"
                value={filters.orderDateTo}
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  orderDateTo: event.target.value,
                  orderDateToTime: '',
                }))}
              />
            </label>
            <label className="field-group purchase-orders-amount-field">
              <span>Tutar Min</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={filters.amountMin}
                onChange={(event) => setFilters((current) => ({ ...current, amountMin: normalizeMoneyInput(event.target.value) }))}
                placeholder="0"
              />
            </label>
            <label className="field-group purchase-orders-amount-field">
              <span>Tutar Max</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={filters.amountMax}
                onChange={(event) => setFilters((current) => ({ ...current, amountMax: normalizeMoneyInput(event.target.value) }))}
                placeholder="0"
              />
            </label>

            <label className="field-group purchase-orders-created-by-field" ref={createdByAutocompleteRef}>
              <span>Oluşturan</span>
              <div className="searchable-combobox">
                <div className="searchable-combobox-input-wrap">
                  <input
                    type="text"
                    value={createdBySearch}
                    onChange={(event) => handleCreatedByInputChange(event.target.value)}
                    onFocus={() => setIsCreatedByDropdownOpen(createdBySearch.trim().length >= 2)}
                    placeholder="İsim veya sicil ile ara"
                    autoComplete="off"
                  />
                </div>

                {isCreatedByDropdownOpen ? (
                  <div className="searchable-combobox-dropdown" role="listbox">
                    {isCreatedByLoading ? (
                      <div className="searchable-combobox-empty">Kullanıcılar aranıyor...</div>
                    ) : null}

                    {!isCreatedByLoading && createdBySearch.trim().length < 2 ? (
                      <div className="searchable-combobox-empty">Arama için en az 2 karakter yazın</div>
                    ) : null}

                    {!isCreatedByLoading && createdBySearch.trim().length >= 2 && !createdByOptions.length ? (
                      <div className="searchable-combobox-empty">Eşleşen kullanıcı bulunamadı</div>
                    ) : null}

                    {!isCreatedByLoading && createdByOptions.length
                      ? createdByOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className="searchable-combobox-option"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleCreatedBySelect(option)}
                        >
                          <span className="searchable-combobox-option-text">
                            <span className="searchable-combobox-option-label">{option.label}</span>
                            {option.secondary ? <span className="searchable-combobox-option-secondary">{option.secondary}</span> : null}
                          </span>
                        </button>
                      ))
                      : null}
                  </div>
                ) : null}
              </div>
            </label>

            <div className="purchase-orders-filter-actions">
              <button className="ghost-button purchase-orders-quick-button" type="button" onClick={() => applyOrderDatePreset('today')}>Bugün</button>
              <button className="ghost-button purchase-orders-quick-button" type="button" onClick={() => applyOrderDatePreset('last24')}>Son 24 Saat</button>
              <button className="ghost-button purchase-orders-quick-button" type="button" onClick={() => applyOrderDatePreset('last7')}>Son 7 Gün</button>
              <button
                className="ghost-button purchase-orders-clear-button"
                type="button"
                onClick={() => {
                  setFilters(initialFilters);
                  setCreatedBySearch('');
                  setCreatedByOptions([]);
                  setIsCreatedByDropdownOpen(false);
                }}
              >
                Temizle
              </button>
            </div>
          </div>
        </FilterBar>
      </div>

      <div className="mod-card">
        <div className="mod-card-header"><div className="mod-card-icon mod-icon-indigo"><PackageCheck size={18} /></div><div><h3>Aktif Sipariş Listesi</h3><p>Operasyonel olarak devam eden siparişler</p></div></div>
        <ActiveOrdersTable columns={activeColumns} rows={activeRows} isLoading={isLoading} />
      </div>

      <div className="mod-card">
        <div className="mod-card-header"><div className="mod-card-icon mod-icon-cyan"><Clock size={18} /></div><div><h3>Onay Bekleyen Siparişler</h3><p>Onay sürecindeki siparişler bu alanda listelenir.</p></div></div>
        <DataTable columns={approvalColumns} rows={approvalPendingRows} isLoading={isLoading} emptyMessage="Onay bekleyen sipariş bulunmuyor." initialSort={{ key: 'createdAt', direction: 'desc' }} pageSize={ORDER_TABLE_PAGE_SIZE} />
      </div>

      <div className="mod-card">
        <div className="mod-card-header"><div className="mod-card-icon mod-icon-violet"><Truck size={18} /></div><div><h3>Depoya Ulaşan / Giriş Bekleyen Siparişler</h3><p>Depoya ulaşmış ve mal kabul / stok giriş işlemi bekleyen siparişleri buradan yönetin.</p></div></div>
        <WarehouseIncomingTable columns={warehouseArrivalPendingColumns} rows={warehouseArrivalPendingRows} isLoading={isLoading} />
      </div>

      <div className="mod-card">
        <div className="mod-card-header"><div className="mod-card-icon mod-icon-amber"><ClipboardList size={18} /></div><div><h3>Stok Girişi Bekleyen Siparişler</h3><p>Manuel stok girişi gereken siparişleri stok operasyon ekranından tamamlayın.</p></div></div>
        <ManualStockEntryPendingTable columns={manualStockEntryPendingColumns} rows={manualStockEntryPendingRows} isLoading={isLoading} />
      </div>

      <div className="mod-card">
        <div className="mod-card-header"><div className="mod-card-icon mod-icon-green"><Archive size={18} /></div><div><h3>Arşiv</h3><p>Tamamlanan ve iptal edilen sipariş kayıtları</p></div></div>
        <ArchiveOrdersTable columns={archiveColumns} rows={archiveRows} isLoading={isLoading} />
      </div>

      <FormModal
        isOpen={Boolean(receiptModalOrder)}
        title="Mal Kabul Kararı"
        description={receiptModalOrder ? `${normalizeOrderNumber(receiptModalOrder.orderNumber, receiptModalOrder.id)} siparişi için mal kabul ve stok giriş yöntemini seçin.` : 'Depoya ulaşan siparişin mal kabul kararını yönetin.'}
        headerIcon={<PackageCheck size={18} />}
        onClose={() => {
          setReceiptModalOrder(null);
          setReceiptNote('');
          setReceiptDecisionMode('auto');
        }}
        modalClassName="order-status-modal order-status-modal-rebuild"
      >
        <form className="status-rebuild-shell" onSubmit={handleConfirmGoodsReceipt}>
          <div className="status-rebuild-body">
            <section className="status-card status-context-card" aria-label="Mal kabul özeti">
              <div className="status-card-head">
                <h4>Mal Kabul Özeti</h4>
                <p>Mal kabul sonrası stok giriş yöntemini seçerek siparişi doğru akışa yönlendirin.</p>
              </div>
              <div className="status-context-grid">
                <div className="status-context-item">
                  <span>Sipariş No</span>
                  <strong>{normalizeOrderNumber(receiptModalOrder?.orderNumber, receiptModalOrder?.id)}</strong>
                </div>
                <div className="status-context-item">
                  <span>Tedarikçi</span>
                  <strong>{receiptModalOrder?.supplierName || '-'}</strong>
                </div>
                <div className="status-context-item">
                  <span>Depo / Mağaza</span>
                  <strong>{receiptModalOrder?.warehouseCity || receiptModalOrder?.deliveryLocation || '-'}</strong>
                </div>
                <div className="status-context-item is-total">
                  <span>Toplam Tutar</span>
                  <strong>{formatCurrency(Number(receiptModalOrder?.grandTotal ?? receiptModalOrder?.totalAmount ?? 0), receiptModalOrder?.currency)}</strong>
                </div>
              </div>
            </section>

            <section className="status-card status-note-card">
              <div className="status-card-head">
                <h4><Route size={14} /> Modül Seçimi</h4>
                <p>Mal kabul sonrası akışı modül seçimiyle yönetin.</p>
              </div>
              <div className="goods-receipt-decision-grid goods-receipt-segmented-grid">
                <label className={`goods-receipt-decision ${receiptDecisionMode === 'auto' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="receiptDecisionMode"
                    value="auto"
                    checked={receiptDecisionMode === 'auto'}
                    onChange={(event) => setReceiptDecisionMode(event.target.value)}
                  />
                  <span className="decision-title">Siparişten Getir</span>
                  <small>Mal kabul tamamlanır, sipariş kaydına göre stoklar otomatik işlenir.</small>
                </label>
                <label className={`goods-receipt-decision ${receiptDecisionMode === 'manual' ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="receiptDecisionMode"
                    value="manual"
                    checked={receiptDecisionMode === 'manual'}
                    onChange={(event) => setReceiptDecisionMode(event.target.value)}
                  />
                  <span className="decision-title">Manuel Ürün Girişi</span>
                  <small>Mal kabul tamamlanır, sipariş manuel stok girişi bekleyenler listesine aktarılır.</small>
                </label>
              </div>
            </section>

            <section className="status-card status-note-card">
              <div className="status-card-head">
                <h4><ClipboardList size={14} /> Mal Kabul Notu</h4>
                <p>Opsiyonel: irsaliye/mal kabul notunu ekleyebilirsiniz.</p>
              </div>
              <label className="field-group">
                <span>Not</span>
                <textarea
                  rows="4"
                  value={receiptNote}
                  onChange={(event) => setReceiptNote(event.target.value)}
                  placeholder="Örn: irsaliye kontrolü tamamlandı, koli sayısı doğrulandı..."
                />
              </label>
            </section>
          </div>
          <div className="status-rebuild-footer">
            <button className="ghost-button" type="button" onClick={() => setReceiptModalOrder(null)}>İptal</button>
            <button className="primary-button" type="submit" disabled={!isAdmin || !receiptModalOrder || processingId === receiptModalOrder?.id}>
              {processingId === receiptModalOrder?.id ? 'Kaydediliyor...' : 'Mal Kabul Kararını Kaydet'}
            </button>
          </div>
        </form>
      </FormModal>

      <FormModal
        isOpen={Boolean(statusModalOrder)}
        title="Sipariş Durumu Güncelle"
        description={statusModalOrder ? `${normalizeOrderNumber(statusModalOrder.orderNumber, statusModalOrder.id)} siparişi için durum geçişini ve ekip notunu yönetin.` : 'Durum geçişini tek ekranda yönetin.'}
        headerIcon={<CheckCircle2 size={18} />}
        onClose={() => setStatusModalOrder(null)}
        modalClassName="order-status-modal order-status-modal-rebuild"
      >
        <form className="status-rebuild-shell" onSubmit={handleStatusUpdate}>
          <div className="status-rebuild-body">
            {statusModalOrder && (
              <section className="status-card status-context-card" aria-label="Sipariş context özeti">
                <div className="status-card-head">
                  <h4>Sipariş Context Özeti</h4>
                  <p>Durum değişikliği yapmadan önce işlem yapılan sipariş bağlamını doğrulayın.</p>
                </div>
                <div className="status-context-grid">
                  <div className="status-context-item">
                    <span>PO</span>
                    <strong>{normalizeOrderNumber(statusModalOrder.orderNumber, statusModalOrder.id)}</strong>
                  </div>
                  <div className="status-context-item">
                    <span>Tedarikçi</span>
                    <strong>{statusModalOrder.supplierName || '-'}</strong>
                  </div>
                  <div className="status-context-item">
                    <span>Mevcut Durum</span>
                    <strong>
                      <StatusBadge tone={resolveStatusBadgeTone(statusModalOrder.status)}>
                        {mapOrderStatusToTurkishLabel(statusModalOrder.status)}
                      </StatusBadge>
                    </strong>
                  </div>
                  <div className="status-context-item is-total">
                    <span>Toplam Tutar</span>
                    <strong>{formatCurrency(statusModalTotal, statusModalCurrency)}</strong>
                  </div>
                  <div className="status-context-item">
                    <span>Sipariş Tarihi</span>
                    <strong>{formatDate(statusModalOrder.createdAt)}</strong>
                  </div>
                  <div className="status-context-item">
                    <span>Tahmini Teslim</span>
                    <strong>{formatDateOnly(statusModalOrder.estimatedDeliveryDate)}</strong>
                  </div>
                </div>
              </section>
            )}

            <section className="status-card">
              <div className="status-card-head">
                <h4><Route size={14} /> Yeni Durum</h4>
                <p>Siparişin ilerlemesini temsil eden bir sonraki durumu seçin.</p>
              </div>
              <OrderStatusFlowPanel
                currentStatus={statusModalOrder?.status}
                selectedStatus={nextStatus}
                onSelectStatus={setNextStatus}
                isLoading={!statusModalOrder}
              />
            </section>

            <section className="status-card status-helper-card">
              <div className="status-helper-icon" aria-hidden="true"><Info size={15} /></div>
              <div>
                <h5>Durum Açıklaması</h5>
                <p>{STATUS_HELP[nextStatus] || 'Durum açıklaması bulunamadı.'}</p>
              </div>
            </section>

            <section className="status-card status-note-card">
              <div className="status-card-head">
                <h4><ClipboardList size={14} /> Durum Notu</h4>
                <p>Opsiyonel: ekip içi takip için kısa not bırakın.</p>
              </div>
              <label className="field-group">
                <span>Not</span>
                <textarea
                  rows="5"
                  value={statusNote}
                  onChange={(event) => setStatusNote(event.target.value)}
                  placeholder="Örn: tedarikçi onayı alındı, ürün hazırlıkta, sevk planlandı..."
                />
              </label>
            </section>
          </div>
          <div className="status-rebuild-footer">
            <button className="ghost-button" type="button" onClick={() => setStatusModalOrder(null)}>İptal</button>
            <button className="primary-button" type="submit" disabled={!statusModalOrder || processingId === statusModalOrder?.id}>{processingId === statusModalOrder?.id ? 'Güncelleniyor...' : 'Durumu Güncelle'}</button>
          </div>
        </form>
      </FormModal>

      <FormModal
        isOpen={Boolean(detailOrder)}
        title="Sipariş Detayı"
        description={detailOrder ? `${normalizeOrderNumber(detailOrder.orderNumber, detailOrder.id)} numaralı siparişin detayları, finansal özeti ve geçmişi.` : 'Sipariş içeriğini ve operasyonel özetini inceleyin.'}
        headerIcon={<Receipt size={18} />}
        onClose={() => setDetailOrder(null)}
        modalClassName="purchase-order-modal purchase-order-modal-rebuild"
      >
        <div className="po-detail-shell">
          <div className="po-detail-body-scroll">
            <section className="po-section po-snapshot-section">
              <div className="po-section-head">
                <h4><ClipboardList size={14} /> Sipariş Snapshot / Üst Özet</h4>
                <p>Siparişin temel operasyonel, teslimat ve finans verileri.</p>
              </div>
              <div className="po-snapshot-grid">
                <div className="po-snapshot-item">
                  <span>Sipariş Kalemi</span>
                  <strong>{formatNumber(detailItems.length)}</strong>
                </div>
                <div className="po-snapshot-item">
                  <span>Toplam Miktar</span>
                  <strong>{formatNumber(detailOrder?.totalItemQty || 0)}</strong>
                </div>
                <div className="po-snapshot-item is-total">
                  <span>Genel Toplam</span>
                  <strong>{formatCurrency(grandTotal, orderCurrency)}</strong>
                </div>

                <div className="po-snapshot-item"><span>Tedarikçi</span><strong>{detailOrder?.supplierName || '-'}</strong></div>
                <div className="po-snapshot-item is-status"><span>Sipariş Durumu</span><strong><StatusBadge tone={resolveStatusBadgeTone(detailOrder?.status)}>{mapOrderStatusToTurkishLabel(detailOrder?.status)}</StatusBadge></strong></div>
                <div className="po-snapshot-item"><span>Oluşturan</span><strong>{detailOrder?.createdByName || detailOrder?.createdBy || 'Sistem'}</strong></div>

                <div className="po-snapshot-item"><span>Sipariş Tarihi</span><strong>{formatDate(detailOrder?.createdAt)}</strong></div>
                <div className="po-snapshot-item"><span>Tahmini Teslim</span><strong>{formatDateOnly(detailOrder?.estimatedDeliveryDate)}</strong></div>
                <div className="po-snapshot-item"><span>Teslim Edilen Miktar</span><strong>{formatNumber(detailDeliveredQty)}</strong></div>

                <div className="po-snapshot-item"><span>Kalan Teslimat</span><strong>{formatNumber(detailRemainingQty)}</strong></div>
                <div className="po-snapshot-item"><span>Toplam Koli / Toplam Adet</span><strong>{formatNumber(detailTotalCases)} / {formatNumber(detailOrder?.totalItemQty || 0)}</strong></div>
                <div className="po-snapshot-item"><span>Depo / Mağaza</span><strong>{detailOrder?.warehouseCity || detailOrder?.deliveryLocation || '-'}</strong></div>
              </div>
            </section>

            <section className="po-section po-lines-section">
              <div className="po-section-head">
                <h4><PackageCheck size={14} /> Sipariş Kalemleri</h4>
                <p>Siparişte yer alan ürünler, miktarlar ve satır toplamları.</p>
              </div>
              <div className="po-lines-table-wrap">
                <table className="po-lines-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Ürün</th>
                      <th className="is-right">Miktar</th>
                      <th className="is-right">Birim Fiyat</th>
                      <th className="is-right">Toplam</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailItems.map((item, index) => (
                      <tr key={item.id || `${item.sku}-${index}`}>
                        <td className="sku-cell">{item.sku || '-'}</td>
                        <td className="name-cell">
                          <strong>{item.productName || '-'}</strong>
                          <small>{item.supplierSku ? `Tedarikçi SKU: ${item.supplierSku}` : (item.unit ? `Birim: ${item.unit}` : '-')}</small>
                        </td>
                        <td className="is-right">
                          <strong>{formatNumber(item.quantity || 0)}</strong>
                          <small>{item.deliveredQty || item.remainingQty ? `${formatNumber(item.deliveredQty || 0)} teslim / ${formatNumber(item.remainingQty || Math.max(0, Number(item.quantity || 0) - Number(item.deliveredQty || 0)))} kalan` : ''}</small>
                        </td>
                        <td className="is-right">{formatCurrency(item.unitPrice, orderCurrency)}</td>
                        <td className="is-right emphasis">{formatCurrency(item.totalPrice, orderCurrency)}</td>
                      </tr>
                    ))}
                    {!detailItems.length ? <tr><td colSpan={5}>Kalem bulunmuyor.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="po-section po-finance-section">
              <div className="po-section-head">
                <h4><CircleDollarSign size={14} /> Finansal Özet</h4>
                <p>Siparişin finansal etkisini kalem bazında izleyin.</p>
              </div>
              <div className="po-financial-summary">
                <div className="summary-row">
                  <span>Ara Toplam</span>
                  <strong>{formatCurrency(subtotalAmount, orderCurrency)}</strong>
                </div>
                <div className="summary-row">
                  <span>KDV</span>
                  <strong>{formatCurrency(taxAmount, orderCurrency)}</strong>
                </div>
                <div className="summary-row">
                  <span>Kargo / Lojistik</span>
                  <strong>{formatCurrency(shippingFee, orderCurrency)}</strong>
                </div>
                <div className="summary-row">
                  <span>İndirim</span>
                  <strong>{discountAmount ? formatCurrency(discountAmount, orderCurrency) : '-'}</strong>
                </div>
                <div className="summary-row summary-row-total">
                  <span>Genel Toplam</span>
                  <strong>{formatCurrency(grandTotal, orderCurrency)}</strong>
                </div>
              </div>
            </section>

            <section className="po-section po-activity-section">
              <div className="po-section-head">
                <h4><History size={14} /> Aktivite Geçmişi</h4>
                <p>Siparişin akışındaki son hareketler.</p>
              </div>
              {detailActivityLog.length > 0 ? (
                <ul className="po-activity-timeline">
                  {detailActivityLog.map((entry, index) => {
                    const display = getActivityDisplayMeta(entry);
                    return (
                    <li key={`${entry.at || 'ts'}-${entry.status || entry.type || index}`} className={index === detailActivityLog.length - 1 ? 'is-latest' : ''}>
                      <span className="activity-dot" aria-hidden="true" />
                      <div className="po-activity-content">
                        <div className="po-activity-head">
                          <strong>{display.label}</strong>
                          <span>{display.at}</span>
                        </div>
                        <p>{display.note}</p>
                      </div>
                    </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="po-activity-empty">Henüz kaydedilmiş aktivite geçmişi bulunmuyor.</div>
              )}
            </section>
          </div>
          <div className="po-detail-footer">
            <div className="po-detail-actions-right">
              <button className="ghost-button" type="button" onClick={() => setDetailOrder(null)}>Kapat</button>
              <button className="ghost-button" type="button" onClick={() => detailOrder && handleExportOrderPdf(detailOrder)}>
                <FileText size={14} /> PDF İndir
              </button>
              <button className="ghost-button" type="button" onClick={() => detailOrder && handleExportOrderXlsx(detailOrder)}>
                <FileSpreadsheet size={14} /> Excel İndir
              </button>
            </div>
          </div>
        </div>
      </FormModal>
    </div>
  );
}
