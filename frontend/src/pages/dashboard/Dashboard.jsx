import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Layers,
  MapPin,
  Package,
  RefreshCcw,
  ShieldAlert,
  ShoppingCart,
  Tag,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import PageHeader from '../../components/PageHeader.jsx';
import PageLoading from '../../components/PageLoading.jsx';
import { reportService } from '../../services/reportService.js';
import { customerAdminService } from '../../services/customerAdminService.js';
import { formatCurrency, formatDateInTimeZone, joinDisplayParts, normalizeTurkishText } from '../../services/formatters.js';
import { isRequestCancellation } from '../../services/api.js';
import {
  VISIBLE_PURCHASE_ORDER_STATUS_SEQUENCE,
  getVisiblePurchaseOrderStatusLabel,
  mapPurchaseOrderStatusToVisibleStatus,
  normalizePurchaseOrderStatus,
} from '../../utils/purchaseOrderLifecycle.js';
import '../../styles/dashboard_redesign.css';

const DASHBOARD_LIFECYCLE_ORDER = VISIBLE_PURCHASE_ORDER_STATUS_SEQUENCE;
const LIFECYCLE_TIME_FILTERS = Object.freeze([
  { key: 'all', label: 'Tüm Zamanlar', days: null },
  { key: '7d', label: 'Son 7 Gün', days: 7 },
  { key: '24h', label: 'Son 24 Saat', hours: 24 },
]);
const SMART_ALERT_SEVERITY_WEIGHT = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});
const SMART_ALERT_ICON_BY_TYPE = Object.freeze({
  goods_receipt_pending_orders: Truck,
  stock_entry_pending_aging: Activity,
  delivery_delay: Clock,
  critical_stock_without_pipeline: AlertTriangle,
  receiving_location_fallback: MapPin,
});
const OPEN_PURCHASE_ORDER_STATUSES = new Set([
  'submitted_for_approval',
  'approved',
  'supplier_notified',
  'preparing',
  'ready_to_ship',
  'in_transit',
  'delivered',
  'goods_receipt_pending',
  'goods_receipt_completed',
  'stock_entry_pending',
]);
const GOODS_RECEIPT_WAITING_STATUSES = new Set(['delivered', 'goods_receipt_pending']);
const STOCK_ENTRY_WAITING_STATUSES = new Set(['stock_entry_pending']);
const COMPLETED_PURCHASE_ORDER_STATUSES = new Set(['completed', 'archived']);

const DASHBOARD_REFRESH_TIMEOUT_MS = 15000;
const DASHBOARD_MONEY_COMPACT_THRESHOLD = 10000000;
const DASHBOARD_MONEY_LARGE_THRESHOLD = 1000000;
let dashboardCache = null;

const formatDashboardMoney = (value) => {
  const amount = Number(value);
  const safeAmount = Number.isFinite(amount) ? amount : 0;

  if (Math.abs(safeAmount) < DASHBOARD_MONEY_COMPACT_THRESHOLD) {
    return formatCurrency(safeAmount);
  }

  const millionValue = safeAmount / 1000000;
  const digits = Math.abs(millionValue) >= 10 ? 1 : 2;
  return `₺${new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(millionValue)} Mn`;
};

const getDashboardMoneyValueClassName = (value) => {
  const amount = Math.abs(Number(value) || 0);
  const classes = ['kpi-value', 'kpi-money-value'];

  if (amount >= DASHBOARD_MONEY_COMPACT_THRESHOLD) {
    classes.push('kpi-money-value-compact');
  } else if (amount >= DASHBOARD_MONEY_LARGE_THRESHOLD) {
    classes.push('kpi-money-value-large');
  }

  return classes.join(' ');
};

const withTimeout = (promise, timeoutMs, controller) => new Promise((resolve, reject) => {
  const timeoutId = window.setTimeout(() => {
    controller?.abort();
    reject(new Error('Dashboard verileri zaman aşımına uğradı'));
  }, timeoutMs);

  Promise.resolve(promise)
    .then((value) => {
      window.clearTimeout(timeoutId);
      resolve(value);
    })
    .catch((error) => {
      window.clearTimeout(timeoutId);
      reject(error);
    });
});

const getActivityRowKey = (item, index = 0) => {
  const id = String(item?.id || item?.movementId || item?.referenceNo || '').trim();
  if (id) return id;
  return [
    item?.createdAt || 'activity',
    item?.userName || 'system',
    item?.productName || 'product',
    item?.type || 'type',
    item?.qty ?? index,
  ].join(':');
};

const ACTIVITY_VERB_MAP = {
  purchase: 'satın alım yaptı',
  sale: 'satış yaptı',
  stock_count: 'sayım yaptı',
  count: 'sayım yaptı',
  order_create: 'sipariş oluşturdu',
  order_created: 'sipariş oluşturdu',
  order_approve: 'siparişi onayladı',
  order_approved: 'siparişi onayladı',
  stock_update: 'stok güncelledi',
  stock_updated: 'stok güncelledi',
  goods_receipt: 'mal kabul yaptı',
  goods_received: 'mal kabul yaptı',
  transfer: 'stok transferi yaptı',
};

const USER_ACTIVITY_KEYWORDS = /(satın|satış|satis|sayım|sayim|sipariş|siparis|stok|mal kabul|transfer|onay)/i;

const getActivityActorName = (item) => {
  const actorName = String(item?.actorName || item?.userName || '').trim();
  if (actorName) return actorName;
  return item?.isSystemEvent ? 'Sistem' : 'Kullanıcı';
};

const getActivitySummary = (item) => {
  const actionKey = String(item?.actionType || item?.type || item?.reasonCode || '').trim().toLowerCase();
  const rawSummary = normalizeTurkishText(item?.actionSummary || item?.reasonLabel || '', '');
  if (ACTIVITY_VERB_MAP[actionKey]) return ACTIVITY_VERB_MAP[actionKey];
  if (rawSummary && USER_ACTIVITY_KEYWORDS.test(rawSummary)) return rawSummary;
  return 'işlem gerçekleştirdi';
};

const getActivityReference = (item) => normalizeTurkishText(item?.referenceCode || item?.referenceNo || item?.referenceId || '', '');

const getActivityTarget = (item) => normalizeTurkishText(item?.targetName || item?.productName || item?.module || '', '');

const getActivityQuantityLabel = (item) => {
  const rawQuantity = item?.quantity ?? item?.qty;
  if (rawQuantity === null || rawQuantity === undefined || rawQuantity === '') return '';
  const quantity = Number(rawQuantity);
  if (!Number.isFinite(quantity)) return '';
  const direction = String(item?.direction || item?.type || '').trim().toUpperCase();
  const prefix = direction === 'IN' ? '+' : direction === 'OUT' ? '-' : '';
  return `${prefix}${quantity}`;
};

const isUserFacingActivity = (item) => {
  const actionKey = String(item?.actionType || item?.type || item?.reasonCode || '').trim().toLowerCase();
  const rawSummary = normalizeTurkishText(item?.actionSummary || item?.reasonLabel || '', '');
  return Boolean(ACTIVITY_VERB_MAP[actionKey] || USER_ACTIVITY_KEYWORDS.test(rawSummary));
};

const getActivityDescription = (item) => {
  return joinDisplayParts([
    getActivityTarget(item) ? `Kayıt: ${getActivityTarget(item)}` : '',
    getActivityQuantityLabel(item) ? `Miktar: ${getActivityQuantityLabel(item)}` : '',
    getActivityReference(item) ? `Referans: ${getActivityReference(item)}` : '',
  ]) || '-';
};

const DashboardAreaChart = ({ data }) => (
  <ResponsiveContainer width="100%" height={240}>
    <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
      <defs>
        <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1} />
          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
      <Area type="monotone" dataKey="in" name="Giriş" stroke="#10b981" fillOpacity={1} fill="url(#colorIn)" strokeWidth={2} />
      <Area type="monotone" dataKey="out" name="Çıkış" stroke="#ef4444" fillOpacity={1} fill="url(#colorOut)" strokeWidth={2} />
    </AreaChart>
  </ResponsiveContainer>
);

const DashboardPieChart = ({ data }) => {
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444'];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="stockQuantity" nameKey="name">
          {data.map((entry, index) => (
            <Cell key={`${entry.name || 'cat'}-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
        <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px' }} />
      </PieChart>
    </ResponsiveContainer>
  );
};

const DashboardMiniRiskChart = ({ data }) => (
  <ResponsiveContainer width="100%" height={170}>
    <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
      <Tooltip
        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
        formatter={(value) => [`${Number(value || 0)} ürün`, 'Adet']}
      />
      <Bar dataKey="value" radius={[8, 8, 0, 0]}>
        {data.map((entry, index) => (
          <Cell key={`${entry.label}-${index}`} fill={entry.color} />
        ))}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);

const normalizeDashboardKpiChangePercent = (comparison) => {
  const safeValue = Number(comparison?.changePercent);
  return Number.isFinite(safeValue) ? safeValue : 0;
};

const formatDashboardKpiTrendLabel = (changePercent, decimals = 1) => {
  if (!Number.isFinite(changePercent) || changePercent === 0) {
    return '%0';
  }

  return `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(decimals)}%`;
};

const buildDashboardKpiTrend = (comparison, { decimals = 1 } = {}) => {
  const status = String(comparison?.status || '').trim().toLowerCase();
  const rawChangePercent = Number(comparison?.changePercent);
  const changePercent = normalizeDashboardKpiChangePercent(comparison);

  if (status === 'no_data') {
    return { tone: 'flat', label: 'Veri yok', icon: null };
  }

  if (status === 'insufficient_data') {
    return { tone: 'flat', label: 'Karşılaştırma yok', icon: null };
  }

  if (!Number.isFinite(changePercent) || changePercent === 0 || status === 'no_change') {
    return { tone: 'flat', label: 'Değişim yok', icon: null };
  }

  return {
    tone: changePercent > 0 ? 'up' : 'down',
    label: `${changePercent > 0 ? '+' : ''}${changePercent.toFixed(decimals)}%`,
    icon: changePercent > 0 ? TrendingUp : TrendingDown,
  };
};

const resolveDashboardKpiTrend = (comparison, { decimals = 1 } = {}) => {
  const status = String(comparison?.status || '').trim().toLowerCase();
  const changePercent = normalizeDashboardKpiChangePercent(comparison);
  const hasValidChangePercent = Number.isFinite(Number(comparison?.changePercent));
  const shouldUseFallback =
    !hasValidChangePercent
    || changePercent === 0
    || status === 'no_data'
    || status === 'insufficient_data'
    || status === 'no_change';

  if (shouldUseFallback) {
    return {
      tone: 'flat',
      label: formatDashboardKpiTrendLabel(0, decimals),
      icon: null,
    };
  }

  return {
    tone: changePercent > 0 ? 'up' : 'down',
    label: formatDashboardKpiTrendLabel(changePercent, decimals),
    icon: changePercent > 0 ? TrendingUp : TrendingDown,
  };
};

const normalizeSmartAlertSeverity = (value) => {
  const severity = String(value || '').trim().toLowerCase();
  return ['low', 'medium', 'high', 'critical'].includes(severity) ? severity : 'medium';
};

const getSmartAlertRoute = (alert) => String(alert?.actionRoute || '').trim() || '/anasayfa';

const getSmartAlertKey = (alert, index = 0) => String(alert?.id || alert?.type || `smart-alert-${index}`);

const getLifecycleOrderAmount = (order = {}) => Number(
  order.totalAmount
  ?? order.grandTotal
  ?? order.subtotalAmount
  ?? order.totalPrice
  ?? order.amount
  ?? 0
);

const getLifecycleOrderDate = (order = {}) => (
  order.createdAt || order.approvedAt || order.updatedAt || order.estimatedDeliveryDate || null
);

const getLifecycleOrderEta = (order = {}) => (
  order.estimatedDeliveryDate || order.requestedDeliveryDate || order.deliveryDate || null
);

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(dashboardCache);
  const [loading, setLoading] = useState(!dashboardCache);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [activityFilters, setActivityFilters] = useState({ startDate: '', endDate: '' });
  const [activityDraftFilters, setActivityDraftFilters] = useState({ startDate: '', endDate: '' });
  const [lifecycleTimeFilter, setLifecycleTimeFilter] = useState('7d');
  const mountedRef = useRef(false);
  const activeRequestIdRef = useRef(0);
  const activeControllerRef = useRef(null);

  const hasMeaningfulSupplierRows = useCallback((rows) => (
    Array.isArray(rows) && rows.some((row) => {
      const supplierId = String(row?.supplierId || '').trim();
      const supplierName = String(row?.supplierName || row?.vendorName || row?.tedarikciAdi || row?.supplier || '').trim();
      const hasMetrics = Number(row?.orderCount || row?.activeOrderCount || 0) > 0
        || Number(row?.delayedOrderCount || row?.delayedDeliveryCount || 0) > 0
        || Number(row?.deliveryTimeDays || row?.avgLeadTimeDays || 0) > 0
        || Number(row?.supplierScore || row?.onTimeScore || 0) > 0;
      return supplierId && supplierName && !supplierId.startsWith('summary-') && hasMetrics;
    })
  ), []);

  const loadDashboard = useCallback(async ({ refresh = false } = {}) => {
    activeControllerRef.current?.abort();

    const controller = new AbortController();
    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    activeControllerRef.current = controller;

    if (!dashboardCache) setLoading(true);
    if (refresh) setIsRefreshing(true);
    setError(null);

    const finishRequest = () => {
      if (!mountedRef.current || activeRequestIdRef.current !== requestId) return;
      setLoading(false);
      setIsRefreshing(false);
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
    };

    try {
      const [dashboardData, summaryData, customerList] = await withTimeout(
        Promise.all([
          reportService.getDashboard({ signal: controller.signal }),
          reportService.getSummary({}, { signal: controller.signal }),
          customerAdminService.list({ signal: controller.signal }).catch(() => []),
        ]),
        DASHBOARD_REFRESH_TIMEOUT_MS,
        controller
      );

      if (!mountedRef.current || activeRequestIdRef.current !== requestId) {
        finishRequest();
        return;
      }

      const supplierRows = hasMeaningfulSupplierRows(dashboardData?.supplierPerformanceReport)
        ? dashboardData.supplierPerformanceReport
        : hasMeaningfulSupplierRows(summaryData?.supplierPerformanceReport)
          ? summaryData.supplierPerformanceReport
          : [];

      const mergedData = {
        ...dashboardData,
        ...summaryData,
        overview: {
          ...(dashboardData?.overview || {}),
          ...(summaryData?.overview || {}),
        },
        supplierPerformanceReport: supplierRows,
        customerList: Array.isArray(customerList) ? customerList : [],
      };

      dashboardCache = mergedData;
      setData(mergedData);
    } catch (err) {
      if (!mountedRef.current || activeRequestIdRef.current !== requestId) {
        finishRequest();
        return;
      }
      if (isRequestCancellation(err)) {
        finishRequest();
        return;
      }
      setError(err.message || 'Veriler yüklenirken hata oluştu');
    } finally {
      finishRequest();
    }
  }, [hasMeaningfulSupplierRows]);

  useEffect(() => {
    mountedRef.current = true;
    loadDashboard();
    return () => {
      mountedRef.current = false;
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
    };
  }, [loadDashboard]);

  const handleRefresh = () => {
    if (loading || isRefreshing) return;
    dashboardCache = null;
    loadDashboard({ refresh: true });
  };

  const categoryChartData = useMemo(() => {
    const sorted = [...(data?.categoryDistribution || [])].sort((a, b) => (b.stockQuantity || 0) - (a.stockQuantity || 0));
    const topThree = sorted.slice(0, 3);
    const otherTotal = sorted.slice(3).reduce((sum, item) => sum + (item.stockQuantity || 0), 0);
    return otherTotal > 0 ? [...topThree, { name: 'Diğer', stockQuantity: otherTotal }] : topThree;
  }, [data?.categoryDistribution]);

  const supplierOperationalOverview = useMemo(() => {
    const rows = (Array.isArray(data?.supplierPerformanceReport) ? data.supplierPerformanceReport : [])
      .map((row) => {
        const score = Number(row?.supplierScore || 0);
        const leadTime = Number(row?.deliveryTimeDays || row?.avgLeadTimeDays || 0);
        const delayedOrders = Number(row?.delayedOrderCount || row?.delayedDeliveryCount || row?.gecikenTeslimatSayisi || 0);
        const orderCount = Number(row?.orderCount || row?.activeOrderCount || 0);
        const onTimeScore = Number(row?.onTimeScore || row?.deliveryPerformance || 0);
        const lateRate = orderCount > 0 ? delayedOrders / orderCount : null;
        return { ...row, score, leadTime, delayedOrders, orderCount, onTimeScore, lateRate };
      })
      .filter((row) => {
        const supplierId = String(row?.supplierId || '').trim();
        const supplierName = String(row?.supplierName || row?.vendorName || row?.tedarikciAdi || row?.supplier || '').trim();
        const hasOperationalSignal = row.orderCount > 0 || row.delayedOrders > 0 || row.leadTime > 0 || row.score > 0 || row.onTimeScore > 0;
        return supplierName && supplierId && !supplierId.startsWith('summary-') && hasOperationalSignal;
      });

    if (!rows.length) {
      return {
        openOrders: 'Veri bulunamadı',
        waitingDelivery: 'Veri bulunamadı',
        delayedCount: 'Veri bulunamadı',
        supplierDistribution: 'Veri bulunamadı',
      };
    }

    const resolveSupplierName = (row) => row?.supplierName || row?.vendorName || row?.tedarikciAdi || row?.supplier || '-';
    const byReliability = [...rows].sort((a, b) => {
      const lateRateA = a.lateRate == null ? Number.POSITIVE_INFINITY : a.lateRate;
      const lateRateB = b.lateRate == null ? Number.POSITIVE_INFINITY : b.lateRate;
      if (lateRateA !== lateRateB) return lateRateA - lateRateB;
      if (b.onTimeScore !== a.onTimeScore) return b.onTimeScore - a.onTimeScore;
      if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount;
      return b.score - a.score;
    });
    const byLeadTime = rows.filter((row) => row.leadTime > 0).sort((a, b) => a.leadTime - b.leadTime);
    const delayedSuppliers = rows.filter((row) => row.delayedOrders > 0);
    const mostDelayedSupplier = [...delayedSuppliers].sort((a, b) => {
      if (b.delayedOrders !== a.delayedOrders) return b.delayedOrders - a.delayedOrders;
      return (b.lateRate || 0) - (a.lateRate || 0);
    })[0] || null;
    const leadTimeRows = rows.filter((row) => row.leadTime > 0);
    const avgLeadTimeRaw = leadTimeRows.length
      ? leadTimeRows.reduce((sum, row) => sum + row.leadTime, 0) / leadTimeRows.length
      : 0;

    return {
      openOrders: rows.reduce((sum, row) => sum + Number(row.openOrderCount ?? row.activeOrderCount ?? row.orderCount ?? 0), 0).toLocaleString('tr-TR'),
      waitingDelivery: rows.reduce((sum, row) => sum + Number(row.waitingDeliveryCount || row.inTransitOrderCount || 0), 0).toLocaleString('tr-TR'),
      delayedCount: delayedSuppliers.length
        ? (mostDelayedSupplier ? `${delayedSuppliers.reduce((sum, row) => sum + Number(row.delayedOrders || 0), 0)} sipariş · en çok ${resolveSupplierName(mostDelayedSupplier)}` : `${delayedSuppliers.length} tedarikçi`)
        : '0 sipariş',
      supplierDistribution: `${rows.length} tedarikçi · ort. ${Number.isFinite(avgLeadTimeRaw) && avgLeadTimeRaw > 0 ? `${Math.round(avgLeadTimeRaw)} gün` : 'teslimat verisi yok'}`,
    };
  }, [data?.supplierPerformanceReport]);

  const stockRiskDistribution = useMemo(() => {
    const overviewData = data?.overview || {};
    const hasBackendRiskCounts = ['outOfStockCount', 'criticalCount', 'lowStockCount', 'overstockCount']
      .some((key) => Number.isFinite(Number(overviewData[key])));
    if (hasBackendRiskCounts) {
      const totalProducts = Number(overviewData.totalProducts || 0);
      const out = Number(overviewData.outOfStockCount || 0);
      const critical = Number(overviewData.criticalCount || 0);
      const low = Number(overviewData.lowStockCount || 0);
      const over = Number(overviewData.overstockCount || 0);
      const normal = Math.max(0, totalProducts - out - critical - low - over);
      return [
        { label: 'Stok Yok', value: out, color: '#7f1d1d' },
        { label: 'Kritik', value: critical, color: '#ef4444' },
        { label: 'Düşük', value: low, color: '#f59e0b' },
        { label: 'Normal', value: normal, color: '#10b981' },
        { label: 'Fazla', value: over, color: '#6366f1' },
      ];
    }
    const inventoryRows = Array.isArray(data?.inventory) ? data.inventory : [];
    if (!inventoryRows.length) {
      return [
        { label: 'Kritik', value: 0, color: '#ef4444' },
        { label: 'Düşük', value: 0, color: '#f59e0b' },
        { label: 'Normal', value: 0, color: '#10b981' },
        { label: 'Fazla', value: 0, color: '#6366f1' },
      ];
    }
    let critical = 0;
    let out = 0;
    let low = 0;
    let normal = 0;
    let over = 0;
    inventoryRows.forEach((item) => {
      const alert = String(item?.stockAlert || '').trim().toLowerCase();
      if (alert === 'out') {
        out += 1;
        return;
      }
      if (alert === 'critical') {
        critical += 1;
        return;
      }
      if (alert === 'low') {
        low += 1;
        return;
      }
      if (alert === 'overstock') {
        over += 1;
        return;
      }
      const qty = Number(item?.quantity || 0);
      const criticalStock = Number(item?.criticalStock || 0);
      const maxStock = Number(item?.maxStock || item?.maxShelfStock || 0);
      if (qty <= 0) out += 1;
      else if (criticalStock > 0 && qty <= criticalStock) critical += 1;
      else if (criticalStock > 0 && qty <= criticalStock + 5) low += 1;
      else if (maxStock > 0 && qty >= maxStock) over += 1;
      else normal += 1;
    });
    return [
      { label: 'Stok Yok', value: out, color: '#7f1d1d' },
      { label: 'Kritik', value: critical, color: '#ef4444' },
      { label: 'Düşük', value: low, color: '#f59e0b' },
      { label: 'Normal', value: normal, color: '#10b981' },
      { label: 'Fazla', value: over, color: '#6366f1' },
    ];
  }, [data?.inventory, data?.overview]);

  const stockRiskInsights = useMemo(() => {
    const summary = Object.fromEntries(stockRiskDistribution.map((item) => [item.label, Number(item.value || 0)]));
    return [
      {
        key: 'critical',
        color: '#991b1b',
        background: '#fef2f2',
        border: '#fecaca',
        text: summary.Kritik > 0
          ? `${summary.Kritik} kritik ürün öncelikli stok kontrolüne alınmalı.`
          : 'Kritik ürün görünmüyor; alarm eşiği stabil seyrediyor.',
      },
      {
        key: 'low',
        color: '#9a3412',
        background: '#fff7ed',
        border: '#fed7aa',
        text: summary.Düşük > 0
          ? `${summary.Düşük} düşük stok ürünü için sipariş önerileri takip edilmeli.`
          : 'Düşük stok bandında ek sipariş baskısı görünmüyor.',
      },
      {
        key: 'normal',
        color: '#166534',
        background: '#ecfdf5',
        border: '#bbf7d0',
        text: summary.Normal > 0
          ? `${summary.Normal} normal stok ürünü için rutin kontrol yeterlidir.`
          : 'Normal stok bandı boş; dağılım yeniden dengelenmeli.',
      },
    ];
  }, [stockRiskDistribution]);

  const locationInsights = useMemo(() => {
    const overviewData = data?.overview || {};
    const totalStock = Number(overviewData.totalStockQuantity || 0);
    const warehouseStock = Number(overviewData.totalWarehouseStockQuantity || 0);
    const shelfStock = Number(overviewData.totalShelfStockQuantity || 0);
    const totalWarehouseCapacity = Math.max(warehouseStock + shelfStock, warehouseStock);
    const usedWarehouseArea = warehouseStock;
    const shelfOccupancyRate = totalStock > 0 ? (shelfStock / totalStock) * 100 : 0;
    const criticalShelves = Number(overviewData.criticalCount || 0);
    const pendingTransfers = Number(overviewData.inTransitPurchaseOrders || 0);
    const categoryRows = Array.isArray(data?.categoryDistribution) ? data.categoryDistribution : [];
    const sortedCategories = [...categoryRows].sort((a, b) => Number(b.stockQuantity || 0) - Number(a.stockQuantity || 0));
    const mostDense = sortedCategories[0]?.name || '-';
    const lowestDense = sortedCategories.length ? sortedCategories[sortedCategories.length - 1]?.name || '-' : '-';
    const transferRate = totalStock > 0 ? Math.round((pendingTransfers / totalStock) * 1000) / 10 : 0;
    const emptyShelfSpots = Math.max(0, Number(overviewData.emptyShelfSpotCount || 0));
    return {
      totalStock,
      warehouseStock,
      shelfStock,
      totalWarehouseCapacity,
      usedWarehouseArea,
      shelfOccupancyRate,
      criticalShelves,
      pendingTransfers,
      mostDense,
      lowestDense,
      transferRate,
      emptyShelfSpots,
    };
  }, [data?.categoryDistribution, data?.overview]);

  const customerOverview = useMemo(() => {
    const customerList = Array.isArray(data?.customerList) ? data.customerList : [];
    const base = data?.customerOverview || data?.customerReport || {};
    const todayKey = new Date().toISOString().slice(0, 10);
    const activeFromList = customerList.filter((item) => item?.isActive !== false);
    const todayFromList = activeFromList.filter((item) => {
      const lastOrderRaw = String(item?.lastOrderAt || item?.lastOrderDate || item?.updatedAt || '');
      return lastOrderRaw.slice(0, 10) === todayKey;
    });
    const since30Days = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentFromList = activeFromList.filter((item) => {
      const lastOrderTime = new Date(item?.lastOrderAt || item?.lastOrderDate || 0).getTime();
      return Number.isFinite(lastOrderTime) && lastOrderTime >= since30Days;
    });
    const avgBasketFromList = activeFromList.length
      ? activeFromList.reduce((sum, item) => sum + Number(item?.averageOrderAmount || item?.avgBasket || 0), 0) / activeFromList.length
      : 0;
    const loyaltyFromList = activeFromList.filter((item) => Number(item?.giftCardUsageCount || item?.giftCardCount || 0) > 0).length;
    return {
      total: Number(base.totalCustomers || base.total || customerList.length || 0),
      active: Number(base.activeCustomers || base.active || activeFromList.length || 0),
      recent: Number(base.recentOrderCustomers || base.recentCustomers || base.recent || recentFromList.length || 0),
      today: Number(base.todayShoppers || base.today || todayFromList.length || 0),
      avgBasket: Number(base.averageBasketAmount || base.avgBasket || avgBasketFromList || 0),
      loyalty: Number(base.loyaltyCustomers || base.giftCardUsers || loyaltyFromList || 0),
      newCustomers: Number(base.newCustomers || base.newRegistered || customerList.filter((item) => String(item?.createdAt || '').slice(0, 10) === todayKey).length || 0),
    };
  }, [data?.customerOverview, data?.customerReport, data?.customerList]);

  const smartAlerts = useMemo(() => {
    const rows = Array.isArray(data?.smartAlerts) ? data.smartAlerts : [];
    return rows
      .filter((alert) => Number(alert?.count || 0) > 0 && String(alert?.title || '').trim())
      .map((alert, index) => ({
        ...alert,
        key: getSmartAlertKey(alert, index),
        severity: normalizeSmartAlertSeverity(alert.severity),
        count: Number(alert.count || 0),
      }))
      .sort((left, right) => (
        (SMART_ALERT_SEVERITY_WEIGHT[right.severity] || 0) - (SMART_ALERT_SEVERITY_WEIGHT[left.severity] || 0)
        || Number(right.count || 0) - Number(left.count || 0)
        || String(left.title || '').localeCompare(String(right.title || ''), 'tr')
      ));
  }, [data?.smartAlerts]);

  const sortedActivityRows = useMemo(() => {
    const rows = Array.isArray(data?.activityFeed)
      ? data.activityFeed
      : Array.isArray(data?.recentMovements)
        ? data.recentMovements
        : [];
    return [...rows].sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
  }, [data?.activityFeed, data?.recentMovements]);

  const filteredActivityRows = useMemo(() => {
    const start = activityFilters.startDate ? new Date(`${activityFilters.startDate}T00:00:00`).getTime() : null;
    const end = activityFilters.endDate ? new Date(`${activityFilters.endDate}T23:59:59`).getTime() : null;
    return sortedActivityRows.filter((item) => {
      const timestamp = new Date(item.createdAt || 0).getTime();
      if (!Number.isFinite(timestamp)) return false;
      if (start && timestamp < start) return false;
      if (end && timestamp > end) return false;
      return true;
    });
  }, [activityFilters.endDate, activityFilters.startDate, sortedActivityRows]);

  const visibleActivityRows = useMemo(
    () => filteredActivityRows.filter(isUserFacingActivity),
    [filteredActivityRows]
  );

  const lifecycleOrders = useMemo(() => {
    const rows = Array.isArray(data?.orderApprovalLeadReport) ? data.orderApprovalLeadReport : [];
    const selectedFilter = LIFECYCLE_TIME_FILTERS.find((item) => item.key === lifecycleTimeFilter) || LIFECYCLE_TIME_FILTERS[1];
    const now = Date.now();
    const since = selectedFilter.hours
      ? now - selectedFilter.hours * 60 * 60 * 1000
      : selectedFilter.days
        ? now - selectedFilter.days * 24 * 60 * 60 * 1000
        : null;
    return rows
      .map((row) => {
        const normalized = normalizePurchaseOrderStatus(row?.currentStatus || row?.status, '');
        const timestamp = new Date(row?.createdAt || row?.updatedAt || 0).getTime();
        const visibleStatus = normalized ? mapPurchaseOrderStatusToVisibleStatus(normalized) : '';
        return normalized ? { ...row, normalizedStatus: normalized, visibleStatus, timestamp } : null;
      })
      .filter((row) => row && (!since || (Number.isFinite(row.timestamp) && row.timestamp >= since)));
  }, [data?.orderApprovalLeadReport, lifecycleTimeFilter]);

  const lifecycleAllOrders = useMemo(() => {
    const rows = Array.isArray(data?.orderApprovalLeadReport) ? data.orderApprovalLeadReport : [];
    return rows
      .map((row) => {
        const normalized = normalizePurchaseOrderStatus(row?.currentStatus || row?.status, '');
        const timestamp = new Date(row?.createdAt || row?.updatedAt || 0).getTime();
        const completedTimestamp = new Date(row?.completedAt || row?.updatedAt || row?.createdAt || 0).getTime();
        const visibleStatus = normalized ? mapPurchaseOrderStatusToVisibleStatus(normalized) : '';
        return normalized ? { ...row, normalizedStatus: normalized, visibleStatus, timestamp, completedTimestamp } : null;
      })
      .filter(Boolean);
  }, [data?.orderApprovalLeadReport]);

  const lifecycleEmptyStateSummary = useMemo(() => {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    return {
      openOrders: lifecycleAllOrders.filter((order) => OPEN_PURCHASE_ORDER_STATUSES.has(order.normalizedStatus)).length,
      goodsReceiptWaiting: lifecycleAllOrders.filter((order) => GOODS_RECEIPT_WAITING_STATUSES.has(order.normalizedStatus)).length,
      stockEntryWaiting: lifecycleAllOrders.filter((order) => STOCK_ENTRY_WAITING_STATUSES.has(order.normalizedStatus)).length,
      completedLast7Days: lifecycleAllOrders.filter((order) => (
        COMPLETED_PURCHASE_ORDER_STATUSES.has(order.normalizedStatus)
        && Number.isFinite(order.completedTimestamp)
        && order.completedTimestamp >= sevenDaysAgo
      )).length,
    };
  }, [lifecycleAllOrders]);

  const lifecycleCounts = useMemo(() => {
    const countMap = new Map(DASHBOARD_LIFECYCLE_ORDER.map((key) => [key, 0]));
    lifecycleOrders.forEach((row) => {
      countMap.set(row.visibleStatus, (countMap.get(row.visibleStatus) || 0) + 1);
    });
    return countMap;
  }, [lifecycleOrders]);

  const lifecycleViewMode = lifecycleOrders.length === 0
    ? 'empty'
    : lifecycleOrders.length <= 2 ? 'low-density' : 'normal';

  const priceCatalogOverview = useMemo(() => {
    const rows = Array.isArray(data?.priceCatalogDiffReport) ? data.priceCatalogDiffReport : [];
    const normalizedRows = rows.filter((row) => {
      const supplierId = String(row?.supplierId || '').trim();
      const supplierName = String(row?.supplierName || '').trim().toLocaleLowerCase('tr-TR');
      const compared = Number(row?.karsilastirilanKayitSayisi || 0);
      const increases = Number(row?.zamGelenUrunSayisi || 0);
      const decreases = Number(row?.indirimeGirenUrunSayisi || 0);
      const hasMetric = compared > 0 || increases > 0 || decreases > 0;
      const isPlaceholder = supplierId === '-' || supplierName.includes('verisi bulunamad');
      return hasMetric && !isPlaceholder;
    });

    return {
      rows: normalizedRows.slice(0, 3),
      comparedTotal: normalizedRows.reduce((sum, row) => sum + Number(row?.karsilastirilanKayitSayisi || 0), 0),
      increasesTotal: normalizedRows.reduce((sum, row) => sum + Number(row?.zamGelenUrunSayisi || 0), 0),
      decreasesTotal: normalizedRows.reduce((sum, row) => sum + Number(row?.indirimeGirenUrunSayisi || 0), 0),
      latestSupplier: normalizedRows[0]?.supplierName || '-',
      analyzedCatalogCount: normalizedRows.length,
      hasData: normalizedRows.length > 0,
    };
  }, [data?.priceCatalogDiffReport]);

  const salesCountTrend = useMemo(
    () => resolveDashboardKpiTrend(data?.overview?.salesComparisons?.todaySalesCount),
    [data?.overview?.salesComparisons?.todaySalesCount]
  );

  const salesRevenueTrend = useMemo(
    () => resolveDashboardKpiTrend(data?.overview?.salesComparisons?.todaySalesRevenue),
    [data?.overview?.salesComparisons?.todaySalesRevenue]
  );

  if (loading && !data) {
    return <PageLoading />;
  }

  if (error && !data) {
    return (
      <div className="dashboard-error">
        <AlertTriangle size={48} />
        <h2>Bir Hata Oluştu</h2>
        <p>{error}</p>
        <button onClick={handleRefresh} className="primary-button">Yeniden Dene</button>
      </div>
    );
  }

  const {
    overview = {},
    recentMovements = [],
    dailyMovements = [],
    goodsReceiptPerformanceReport = [],
    priceCatalogDiffReport = [],
    accessAuditReport = [],
    notificationEngagementReport = [],
    operationalDistribution = {},
    settingsSnapshot = {},
  } = data || {};
  const storeTimezone = settingsSnapshot.timezone || 'Europe/Istanbul';

  return (
    <div className="dashboard-redesign">
      <div className="dashboard-header-row">
        <PageHeader
          title="Shelfio Mağazacılık Ltd. Şti."
          description="Sisteme genel bakış, kritik uyarılar ve operasyonel metrikler."
        />
        <div className="dashboard-header-actions">
          <button className="refresh-btn" onClick={handleRefresh} disabled={loading || isRefreshing}>
            <RefreshCcw size={16} className={loading || isRefreshing ? 'spinning' : ''} />
            {loading || isRefreshing ? 'Yenileniyor...' : 'Yenile'}
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card primary"><div className="kpi-icon"><ShoppingCart size={24} /></div><div className="kpi-content"><span className="kpi-label">Günlük Satış</span><strong className="kpi-value">{overview.todaySalesCount || 0}</strong><span className={`kpi-trend ${salesCountTrend.tone}`.trim()}>{salesCountTrend.icon ? React.createElement(salesCountTrend.icon, { size: 12 }) : null}{salesCountTrend.icon ? ' ' : ''}{salesCountTrend.label}</span></div></div>
        <div className="kpi-card warning"><div className="kpi-icon"><AlertTriangle size={24} /></div><div className="kpi-content"><span className="kpi-label">Kritik Stok</span><strong className="kpi-value">{overview.criticalCount || 0}</strong><span className="kpi-hint">Acil aksiyon bekliyor</span></div></div>
        <div className="kpi-card success kpi-card-money"><div className="kpi-icon"><span className="kpi-currency-symbol">₺</span></div><div className="kpi-content"><span className="kpi-label">Günlük Ciro</span><strong className={getDashboardMoneyValueClassName(overview.todaySalesRevenue)} title={formatCurrency(overview.todaySalesRevenue || 0)}>{formatDashboardMoney(overview.todaySalesRevenue || 0)}</strong><span className={`kpi-trend ${salesRevenueTrend.tone}`.trim()}>{salesRevenueTrend.icon ? React.createElement(salesRevenueTrend.icon, { size: 12 }) : null}{salesRevenueTrend.icon ? ' ' : ''}{salesRevenueTrend.label}</span></div></div>
        <div className="kpi-card purple kpi-card-stock-value kpi-card-money"><div className="kpi-icon"><Package size={24} /></div><div className="kpi-content"><span className="kpi-label">Toplam Stok Değeri</span><strong className={`${getDashboardMoneyValueClassName(overview.totalStockValue)} kpi-money-value-full`} title={formatCurrency(overview.totalStockValue || 0)}>{formatCurrency(overview.totalStockValue || 0)}</strong><span className="kpi-hint">{overview.totalStockQuantity || 0} Birim Ürün</span></div></div>
        <div className="kpi-card orange"><div className="kpi-icon"><Activity size={24} /></div><div className="kpi-content"><span className="kpi-label">Günlük İşlem</span><strong className="kpi-value">{overview.todaySummary?.last24hOperationCount ?? overview.todaySummary?.movementCount ?? 0}</strong><span className="kpi-hint">Son 24 saat işlem</span></div></div>
        <div className="kpi-card blue"><div className="kpi-icon"><ClipboardList size={24} /></div><div className="kpi-content"><span className="kpi-label">Açık Görevler</span><strong className="kpi-value">{Number(overview.openTaskCount ?? operationalDistribution.openTasks ?? 0)}</strong><span className="kpi-hint">Operasyonel görevler</span></div></div>
        <div className="kpi-card slate"><div className="kpi-icon"><ShieldAlert size={24} /></div><div className="kpi-content"><span className="kpi-label">Erişim Talepleri</span><strong className="kpi-value">{accessAuditReport?.find((r) => r.metrik === 'Bekleyen Talepler')?.deger || 0}</strong><span className="kpi-hint">Onay bekleyen</span></div></div>
      </div>

      <div className="dashboard-main-grid">
        <div className="grid-col-8">
          <div className="panel-card lifecycle-card">
            <div className="panel-header lifecycle-panel-header">
              <h3><Layers size={18} /> Sipariş Yaşam Döngüsü</h3>
              <div className="lifecycle-panel-actions">
                <div className="lifecycle-time-filter" role="group" aria-label="Sipariş akışı zaman filtresi">
                  {LIFECYCLE_TIME_FILTERS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={lifecycleTimeFilter === option.key ? 'active' : ''}
                      onClick={() => setLifecycleTimeFilter(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button className="panel-action" type="button" onClick={() => navigate('/siparis-takibi')}>Tümünü Gör <ChevronRight size={14} /></button>
              </div>
            </div>
            <div className="lifecycle-stepper">
              {DASHBOARD_LIFECYCLE_ORDER.map((status, idx) => {
                const count = lifecycleCounts.get(status) || 0;
                return (
                  <div key={status} className={`step-item ${count > 0 ? 'active' : ''} step-${status}`}>
                    <div className="step-node">
                      <div className="step-circle">{idx + 1}</div>
                      {idx < (DASHBOARD_LIFECYCLE_ORDER.length - 1) && <div className="step-line"></div>}
                    </div>
                    <div className="step-info"><span className="step-label">{getVisiblePurchaseOrderStatusLabel(status)}</span><strong className="step-count">{count}</strong></div>
                  </div>
                );
              })}
            </div>
            <div className={`recent-orders-list lifecycle-orders-${lifecycleViewMode}`}>
              {lifecycleViewMode !== 'empty' ? (
                <>
                  {lifecycleOrders.slice(0, lifecycleViewMode === 'low-density' ? 2 : 3).map((order) => {
                    const orderAmount = getLifecycleOrderAmount(order);
                    const orderDate = getLifecycleOrderDate(order);
                    const etaDate = getLifecycleOrderEta(order);
                    return (
                      <div key={order.orderId || order.id || order.orderNumber} className={`mini-order-card ${lifecycleViewMode === 'low-density' ? 'mini-order-card-featured' : ''}`.trim()}>
                        <div className="order-main">
                          <strong>{order.orderNumber || order.orderId || 'Sipariş'}</strong>
                          <span>{order.supplierName || 'Tedarikçi bilgisi yok'}</span>
                          {lifecycleViewMode === 'low-density' ? (
                            <div className="order-featured-meta">
                              <span>Oluşturma: {orderDate ? formatDateInTimeZone(orderDate, false, storeTimezone) : '-'}</span>
                              <span>Tahmini teslim: {etaDate ? formatDateInTimeZone(etaDate, false, storeTimezone) : '-'}</span>
                              <span>Tutar: {orderAmount > 0 ? formatCurrency(orderAmount) : '-'}</span>
                            </div>
                          ) : null}
                        </div>
                        <div className="order-stats">
                          {order.onaylanmaSuresi ? <div className="stat-pill">Onay süresi: {order.onaylanmaSuresi}</div> : null}
                          <div className={`status-badge ${order.visibleStatus}`}>{getVisiblePurchaseOrderStatusLabel(order.normalizedStatus) || 'Bilinmiyor'}</div>
                        </div>
                      </div>
                    );
                  })}
                  {lifecycleViewMode === 'low-density' ? (
                    <div className="lifecycle-sparse-panel">
                      <div className="lifecycle-sparse-head">
                        <strong>Operasyon özeti</strong>
                        <span>Az kayıtlı aralıkta takip edilmesi gereken ana durumlar.</span>
                      </div>
                      <div className="lifecycle-empty-metrics lifecycle-sparse-metrics" aria-label="Sipariş operasyon özeti">
                        <div className="lifecycle-empty-metric"><span>Açık sipariş</span><strong>{lifecycleEmptyStateSummary.openOrders.toLocaleString('tr-TR')}</strong></div>
                        <div className="lifecycle-empty-metric"><span>Mal kabul bekleyen</span><strong>{lifecycleEmptyStateSummary.goodsReceiptWaiting.toLocaleString('tr-TR')}</strong></div>
                        <div className="lifecycle-empty-metric"><span>Stok girişi bekleyen</span><strong>{lifecycleEmptyStateSummary.stockEntryWaiting.toLocaleString('tr-TR')}</strong></div>
                        <div className="lifecycle-empty-metric"><span>Son 7 gün tamamlanan</span><strong>{lifecycleEmptyStateSummary.completedLast7Days.toLocaleString('tr-TR')}</strong></div>
                      </div>
                      <div className="lifecycle-empty-actions lifecycle-sparse-actions">
                        <button type="button" className="primary-button" onClick={() => navigate('/siparis-olustur')}><ClipboardList size={14} /> Yeni Sipariş Oluştur</button>
                        <button type="button" className="ghost-button" onClick={() => navigate('/siparis-takibi')}>Tüm Siparişleri Gör</button>
                        <button type="button" className="ghost-button" onClick={() => navigate('/siparis-takibi?status=goods_receipt_pending')}>Mal Kabul Ekranına Git</button>
                        <button type="button" className="ghost-button" onClick={() => navigate('/stok-islemleri')}>Stok İşlemlerine Git</button>
                      </div>
                      <div className="lifecycle-empty-note lifecycle-sparse-note">
                        <Truck size={14} />
                        <span>Siparişler onaya gönderildikten sonra yaşam döngüsünde izlenir.</span>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="lifecycle-empty-state">
                  <div className="lifecycle-empty-copy">
                    <strong>Bu aralıkta görünür sipariş yok</strong>
                    <p>Seçili zaman filtresinde izlenen satın alma siparişi görünmüyor. Yeni sipariş oluşturabilir veya tüm siparişleri görüntüleyebilirsiniz.</p>
                  </div>
                  <div className="lifecycle-empty-metrics" aria-label="Sipariş operasyon özeti">
                    <div className="lifecycle-empty-metric"><span>Açık sipariş</span><strong>{lifecycleEmptyStateSummary.openOrders.toLocaleString('tr-TR')}</strong></div>
                    <div className="lifecycle-empty-metric"><span>Mal kabul bekleyen</span><strong>{lifecycleEmptyStateSummary.goodsReceiptWaiting.toLocaleString('tr-TR')}</strong></div>
                    <div className="lifecycle-empty-metric"><span>Stok girişi bekleyen</span><strong>{lifecycleEmptyStateSummary.stockEntryWaiting.toLocaleString('tr-TR')}</strong></div>
                    <div className="lifecycle-empty-metric"><span>Son 7 gün tamamlanan</span><strong>{lifecycleEmptyStateSummary.completedLast7Days.toLocaleString('tr-TR')}</strong></div>
                  </div>
                  <div className="lifecycle-empty-actions">
                    <button type="button" className="primary-button" onClick={() => navigate('/siparis-olustur')}><ClipboardList size={14} /> Yeni Sipariş Oluştur</button>
                    <button type="button" className="ghost-button" onClick={() => navigate('/siparis-takibi')}>Tüm Siparişleri Gör</button>
                    <button type="button" className="ghost-button" onClick={() => navigate('/siparis-takibi?status=goods_receipt_pending')}>Mal Kabul Ekranına Git</button>
                    <button type="button" className="ghost-button" onClick={() => navigate('/stok-islemleri')}>Stok İşlemlerine Git</button>
                  </div>
                  <div className="lifecycle-empty-note">
                    <Truck size={14} />
                    <span>Mal kabul ve stok girişi bekleyen siparişler burada öncelikli görünür.</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid-col-4">
          <div className="panel-card danger-light">
            <div className="panel-header"><h3><BellRing size={18} /> Akıllı Uyarılar</h3><span className="badge-red">Öncelikli</span></div>
            <div className="alerts-container">
              {smartAlerts.map((alert, index) => {
                const Icon = SMART_ALERT_ICON_BY_TYPE[alert.type] || AlertTriangle;
                return (
                  <button
                    key={alert.key}
                    type="button"
                    className={`alert-item ${alert.severity}`.trim()}
                    onClick={() => navigate(getSmartAlertRoute(alert))}
                    title={alert.actionLabel || 'İlgili ekrana git'}
                  >
                    <div className="alert-icon"><Icon size={18} /></div>
                    <div className="alert-body">
                      <div className="alert-title-row">
                        <strong>{alert.title}</strong>
                        <span className={`alert-count-badge ${alert.severity}`.trim()}>{alert.count}</span>
                      </div>
                      <p>{alert.message}</p>
                      {index < 3 && alert.actionLabel ? <small>{alert.actionLabel}</small> : null}
                    </div>
                    <ArrowRight size={16} />
                  </button>
                );
              })}
              {overview.criticalCount > 0 && <button type="button" className="alert-item high" onClick={() => navigate('/stok-islemleri')}><div className="alert-icon"><AlertTriangle size={18} /></div><div className="alert-body"><strong>Kritik Stok Seviyesi</strong><p>{overview.criticalCount} ürün kritik stok eşiğinin altında.</p></div><ArrowRight size={16} /></button>}
              {overview.inTransitPurchaseOrders > 0 && <button type="button" className="alert-item medium" onClick={() => navigate('/siparis-takibi')}><div className="alert-icon"><Truck size={18} /></div><div className="alert-body"><strong>Yolda Olan Sevkiyat</strong><p>{overview.inTransitPurchaseOrders} sipariş depoya ulaşmak üzere.</p></div><ArrowRight size={16} /></button>}
              {goodsReceiptPerformanceReport.some((r) => r.gecikenGirisSayisi > 0) && <button type="button" className="alert-item high" onClick={() => navigate('/siparis-takibi')}><div className="alert-icon"><Activity size={18} /></div><div className="alert-body"><strong>Geciken Mal Kabul</strong><p>Bazı teslimatların stok girişi 24 saati geçti.</p></div><ArrowRight size={16} /></button>}
              {priceCatalogDiffReport.some((r) => r.zamGelenUrunSayisi > 0) && <button type="button" className="alert-item info" onClick={() => navigate('/tedarikciler')}><div className="alert-icon"><Tag size={18} /></div><div className="alert-body"><strong>Fiyat Değişim Analizi</strong><p>Tedarikçi kataloglarında yeni zamlar tespit edildi.</p></div><ArrowRight size={16} /></button>}
              {Number(operationalDistribution.expiryRiskCount || 0) > 0 && <button type="button" className="alert-item medium" onClick={() => navigate('/stok-islemleri')}><div className="alert-icon"><Clock size={18} /></div><div className="alert-body"><strong>SKT Yaklaşan Ürünler</strong><p>{operationalDistribution.expiryRiskCount} ürünün son kullanma tarihi yaklaşıyor.</p></div><ArrowRight size={16} /></button>}
              {smartAlerts.length <= 0 && Number(overview.criticalCount || 0) <= 0 && Number(overview.inTransitPurchaseOrders || 0) <= 0 && !goodsReceiptPerformanceReport.some((r) => r.gecikenGirisSayisi > 0) && !priceCatalogDiffReport.some((r) => r.zamGelenUrunSayisi > 0) && Number(operationalDistribution.expiryRiskCount || 0) <= 0 ? <div className="dashboard-empty-note">Öncelikli uyarı bulunmuyor.</div> : null}
            </div>
          </div>
        </div>

        <div className="grid-col-6"><div className="panel-card"><div className="panel-header"><h3><TrendingUp size={18} /> Stok Hareket Trendi (7 Gün)</h3><div className="chart-legend"><span className="dot green"></span> Giriş <span className="dot red"></span> Çıkış</div></div><DashboardAreaChart data={dailyMovements} /></div></div>
        <div className="grid-col-3"><div className="panel-card"><div className="panel-header"><h3><Layers size={18} /> Kategori Dağılımı</h3></div><DashboardPieChart data={categoryChartData} /></div></div>
        <div className="grid-col-3"><div className="panel-card"><div className="panel-header"><h3><AlertTriangle size={18} /> Stok Risk Dağılımı</h3></div><DashboardMiniRiskChart data={stockRiskDistribution} /><div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>{stockRiskInsights.map((item) => <div key={item.key} style={{ fontSize: '0.76rem', lineHeight: 1.45, color: item.color, background: item.background, border: `1px solid ${item.border}`, borderRadius: '10px', padding: '8px 10px' }}>{item.text}</div>)}</div></div></div>
        <div className="grid-col-4"><div className="panel-card supplier-overview-card"><div className="panel-header"><h3><Truck size={18} /> Tedarikçi Operasyon Özeti</h3></div><div className="supplier-mini-cards"><div className="sup-score-card"><div className="sup-info"><strong>Açık Sipariş</strong><span>{supplierOperationalOverview.openOrders}</span></div></div><div className="sup-score-card"><div className="sup-info"><strong>Teslim Bekleyen</strong><span>{supplierOperationalOverview.waitingDelivery}</span></div></div><div className="sup-score-card"><div className="sup-info"><strong>Geciken Sipariş</strong><span>{supplierOperationalOverview.delayedCount}</span></div></div><div className="sup-score-card"><div className="sup-info"><strong>Tedarikçi Dağılımı</strong><span>{supplierOperationalOverview.supplierDistribution}</span></div></div></div></div></div>

        <div className="grid-col-4"><div className="panel-card location-occupancy-card"><div className="panel-header"><h3><MapPin size={18} /> Lokasyon & Doluluk</h3></div><div className="occupancy-stats">{locationInsights.totalStock > 0 ? <><div className="occupancy-item"><div className="occ-header"><span>Depo Stok Payı</span><strong>{Math.round((locationInsights.warehouseStock / locationInsights.totalStock) * 100)}%</strong></div><div className="occ-bar"><div className="occ-fill blue" style={{ width: `${(locationInsights.warehouseStock / locationInsights.totalStock) * 100}%` }}></div></div></div><div className="occupancy-item"><div className="occ-header"><span>Reyon Stok Payı</span><strong>{Math.round((locationInsights.shelfStock / locationInsights.totalStock) * 100)}%</strong></div><div className="occ-bar"><div className="occ-fill green" style={{ width: `${(locationInsights.shelfStock / locationInsights.totalStock) * 100}%` }}></div></div></div><div className="task-stats-grid occupancy-metrics-grid"><div className="task-stat-box"><strong>%{Math.round(locationInsights.shelfOccupancyRate)}</strong><span>Reyon Doluluk Oranı</span></div><div className="task-stat-box"><strong>{locationInsights.pendingTransfers}</strong><span>Bekleyen Transfer</span></div><div className="task-stat-box"><strong>{locationInsights.criticalShelves}</strong><span>Kritik Reyon Sayısı</span></div><div className="task-stat-box"><strong>{locationInsights.totalWarehouseCapacity}</strong><span>Toplam Depo Kapasitesi</span></div><div className="task-stat-box"><strong>{locationInsights.usedWarehouseArea}</strong><span>Kullanılan Depo Alanı</span></div><div className="task-stat-box"><strong>%{locationInsights.transferRate}</strong><span>Reyon Transfer Oranı</span></div><div className="task-stat-box"><strong>{locationInsights.mostDense}</strong><span>En Yoğun Lokasyon</span></div><div className="task-stat-box"><strong>{locationInsights.lowestDense}</strong><span>En Düşük Doluluk</span></div><div className="task-stat-box"><strong>{locationInsights.emptyShelfSpots}</strong><span>Boş Raf Noktası</span></div></div></> : <div className="topbar-notification-empty">Lokasyon doluluk verisi bulunamadı.</div>}</div></div></div>

        <div className="grid-col-4"><div className="panel-card"><div className="panel-header"><h3><Activity size={18} /> Aktivite Akışı</h3><button className="panel-action" type="button" onClick={() => { setActivityDraftFilters(activityFilters); setActivityModalOpen(true); }}>Tümünü Gör <ChevronRight size={14} /></button></div><div className="activity-timeline">{sortedActivityRows.filter(isUserFacingActivity).slice(0, 5).map((m, i) => <div key={getActivityRowKey(m, i)} className="timeline-item"><div className="timeline-marker"></div><div className="timeline-content"><div className="timeline-time">{formatDateInTimeZone(m.createdAt, true, storeTimezone)}</div><div className="timeline-title"><strong>{getActivityActorName(m)}</strong> {getActivitySummary(m)}</div><div className="timeline-desc">{getActivityDescription(m)}</div></div></div>)}</div></div></div>
        <div className="grid-col-6"><div className="panel-card"><div className="panel-header"><h3><ClipboardList size={18} /> Operasyonel Görev Dağılımı</h3></div><div className="task-stats-grid task-stats-grid-compact"><div className="task-stat-box"><Clock size={24} className="text-blue" /><strong>{Number(operationalDistribution?.openTasks || 0)}</strong><span>Bekleyen / Açık</span></div><div className="task-stat-box"><CheckCircle2 size={24} className="text-green" /><strong>{Number(operationalDistribution?.completedTasks || 0)}</strong><span>Tamamlanan</span></div><div className="task-stat-box"><XCircle size={24} className="text-red" /><strong>{Number(operationalDistribution?.overdueTasks || 0)}</strong><span>Geciken</span></div><div className="task-stat-box"><AlertTriangle size={24} className="text-red" /><strong>{Number(operationalDistribution?.criticalTasks || 0)}</strong><span>Kritik</span></div></div></div></div>

        <div className="grid-col-6"><div className="panel-card"><div className="panel-header"><h3><ExternalLink size={18} /> Katalog & Fiyat Analizi</h3></div><div className="price-analysis-summary">{priceCatalogOverview.hasData ? <><div className="catalog-summary-row"><div className="catalog-summary-item"><span>İncelenen Katalog</span><strong>{priceCatalogOverview.analyzedCatalogCount}</strong></div><div className="catalog-summary-item"><span>İncelenen Ürün</span><strong>{priceCatalogOverview.comparedTotal}</strong></div><div className="catalog-summary-item"><span>Son Tedarikçi</span><strong>{priceCatalogOverview.latestSupplier}</strong></div></div>{priceCatalogOverview.rows.map((r) => <div key={r.supplierId} className="price-diff-row"><div className="price-sup"><strong>{r.supplierName}</strong><span>{r.karsilastirilanKayitSayisi} Ürün İncelendi</span></div><div className="price-metrics"><div className="p-metric red"><TrendingUp size={12} /> {r.zamGelenUrunSayisi} Zam</div><div className="p-metric green"><TrendingDown size={12} /> {r.indirimeGirenUrunSayisi} İndirim</div></div></div>)}<div className="catalog-summary-totals"><span className="p-metric red"><TrendingUp size={12} /> Toplam {priceCatalogOverview.increasesTotal} Zam</span><span className="p-metric green"><TrendingDown size={12} /> Toplam {priceCatalogOverview.decreasesTotal} İndirim</span></div></> : <div className="dashboard-empty-note">Henüz analiz edilecek katalog fark verisi bulunmuyor.</div>}</div></div></div>

        <div className="grid-col-12"><div className="panel-card"><div className="panel-header"><h3><Users size={18} /> Müşteri Özeti</h3></div><div className="task-stats-grid"><div className="task-stat-box"><strong>{customerOverview.total}</strong><span>Mevcut Müşteri Sayısı</span></div><div className="task-stat-box"><strong>{customerOverview.active}</strong><span>Aktif Müşteri</span></div><div className="task-stat-box"><strong>{customerOverview.recent}</strong><span>Son 30 Gün Alışveriş</span></div><div className="task-stat-box"><strong>{formatCurrency(customerOverview.avgBasket || 0)}</strong><span>Ortalama Sepet Tutarı</span></div><div className="task-stat-box"><strong>{customerOverview.loyalty}</strong><span>Sadakat / Hediye Kartı</span></div><div className="task-stat-box"><strong>{customerOverview.newCustomers}</strong><span>Yeni Kayıt</span></div></div></div></div>
      </div>
      {activityModalOpen ? (
        <div className="dashboard-activity-modal-backdrop" role="presentation" onClick={() => setActivityModalOpen(false)}>
          <section className="dashboard-activity-modal" role="dialog" aria-modal="true" aria-label="Aktivite Akışı" onClick={(event) => event.stopPropagation()}>
            <div className="dashboard-activity-modal-header">
              <div className="dashboard-activity-modal-header-copy">
                <span className="dashboard-activity-modal-icon" aria-hidden="true">
                  <Activity size={18} />
                </span>
                <div>
                  <h3>Aktivite Akışı</h3>
                  <p>Tüm hareketler tarih sırasıyla listelenir.</p>
                </div>
              </div>
              <button type="button" className="dashboard-activity-modal-close" onClick={() => setActivityModalOpen(false)} aria-label="Kapat">
                <X size={18} />
              </button>
            </div>
            <div className="dashboard-activity-filters">
              <label className="field-group">
                <span>Başlangıç tarihi</span>
                <input type="date" value={activityDraftFilters.startDate} onChange={(event) => setActivityDraftFilters((current) => ({ ...current, startDate: event.target.value }))} />
              </label>
              <label className="field-group">
                <span>Bitiş tarihi</span>
                <input type="date" value={activityDraftFilters.endDate} onChange={(event) => setActivityDraftFilters((current) => ({ ...current, endDate: event.target.value }))} />
              </label>
              <div className="dashboard-activity-filter-actions">
                <button type="button" className="primary-button" onClick={() => setActivityFilters(activityDraftFilters)}>Filtrele</button>
                <button type="button" className="ghost-button" onClick={() => { setActivityDraftFilters({ startDate: '', endDate: '' }); setActivityFilters({ startDate: '', endDate: '' }); }}>Temizle</button>
              </div>
            </div>
            <div className="dashboard-activity-modal-body">
              {visibleActivityRows.length ? (
                <table className="dashboard-activity-table">
                  <thead>
                    <tr>
                      <th>Tarih</th>
                      <th>Kullanıcı</th>
                      <th>İşlem</th>
                      <th>Açıklama</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleActivityRows.map((item, index) => (
                      <tr key={getActivityRowKey(item, index)}>
                        <td>{formatDateInTimeZone(item.createdAt, true, storeTimezone)}</td>
                        <td>{getActivityActorName(item)}</td>
                        <td>{getActivitySummary(item)}</td>
                        <td>{getActivityDescription(item)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="dashboard-activity-empty">
                  <Activity size={28} />
                  <span>Seçili tarih aralığı için aktivite kaydı bulunamadı.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

