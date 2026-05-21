import { useEffect, useMemo, useState } from 'react';
import './POS.css';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, TrendingUp, TrendingDown, Banknote, CreditCard,
  Receipt, RotateCcw, ArrowRight, Clock, AlertCircle, Monitor,
  QrCode, Building2, Gift, BarChart3, History, FileText, X,
  Printer, FileDown, FileSpreadsheet,
} from 'lucide-react';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import * as XLSX from 'xlsx';
import { useDialog } from '../../components/ConfirmModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { posService } from '../../services/posService.js';
import { formatReturnReasonLabel } from '../../services/formatters.js';

const PAYMENT_LABELS = { cash: 'Nakit', card: 'Kart', qr: 'QR Ödeme', eft: 'Havale/EFT', giftcard: 'Hediye Kartı' };
const PAYMENT_ICONS = { cash: Banknote, card: CreditCard, qr: QrCode, eft: Building2, giftcard: Gift };
const PAYMENT_COLORS = { cash: 'stat-emerald', card: 'stat-violet', qr: 'stat-purple', eft: 'stat-cyan', giftcard: 'stat-pink' };
const DESK_CONFIG = [
  { code: 'B1', label: 'Kasa 1' },
  { code: 'B2', label: 'Kasa 2' },
  { code: 'B3', label: 'Kasa 3' },
  { code: 'B4', label: 'Kasa 4' },
  { code: 'B5', label: 'Kasa 5' },
  { code: 'B6', label: 'Kasa 6' },
  { code: 'B7', label: 'Kasa 7' },
  { code: 'B8', label: 'Yönetim Kasası', isManagement: true },
];
const ACTIVE_DESK_SESSIONS_KEY = 'pos_active_desk_sessions';
const DAY_END_ARCHIVE_KEY = 'pos_day_end_archives';
const LAST_DAY_END_AT_KEY = 'pos_last_day_end_at';
const DAY_END_ARCHIVE_SEED_VERSION_KEY = 'pos_day_end_seed_version';
const DAY_END_ARCHIVE_SEED_VERSION = '2026-04-15-v2';
const DAY_END_AUTO_MARK_KEY = 'pos_last_auto_day_end_date';
const DAY_END_PAYMENT_METHODS = ['cash', 'card', 'qr', 'eft', 'giftcard'];
const PAYMENT_METHOD_ALIASES = {
  cash: ['nakit'],
  card: ['kart', 'creditcard', 'credit_card', 'debitcard', 'debit_card', 'pos'],
  qr: ['qrcode', 'qrpayment', 'qr_payment', 'karekod'],
  eft: ['havale', 'transfer', 'banktransfer', 'bank_transfer', 'wire'],
  giftcard: ['gift_card', 'gift', 'hediye', 'hediyekarti', 'giftvoucher', 'voucher'],
};
const DEFAULT_ARCHIVE_FILTERS = {
  from: '',
  to: '',
  reference: '',
  paymentMethod: '',
  minAmount: '',
  maxAmount: '',
  cashier: '',
  search: '',
};

const DEFAULT_DAY_END_ARCHIVE_FILTERS = {
  from: '',
  to: '',
  netMin: '',
  netMax: '',
  deskCode: '',
  paymentMethod: '',
  search: '',
};

const sanitizePdfText = (value) => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || '-';
};

const resolveEmbeddedPdfVfs = () => {
  const nestedVfs = pdfFonts?.pdfMake?.vfs || pdfFonts?.vfs || pdfFonts?.default?.pdfMake?.vfs || pdfFonts?.default?.vfs;
  if (nestedVfs && Object.keys(nestedVfs).length > 0) {
    return nestedVfs;
  }

  const rawFontMap = pdfFonts && typeof pdfFonts === 'object' ? pdfFonts : {};
  const directFontEntries = Object.entries(rawFontMap).filter(([key, value]) => key.toLowerCase().endsWith('.ttf') && typeof value === 'string');
  return directFontEntries.length ? Object.fromEntries(directFontEntries) : {};
};

if (!pdfMake.vfs || Object.keys(pdfMake.vfs).length === 0) {
  const embeddedVfs = resolveEmbeddedPdfVfs();
  pdfMake.vfs = embeddedVfs;
}

const createDefaultDayEndArchives = () => {
  const baseDate = new Date('2026-04-05T00:00:00.000Z');
  const cashierPools = [
    ['Hakan Yıldız', 'Seda Acar', 'Mert Ömeroğlu'],
    ['Ebru Şahin', 'Murat Çelik', 'Seda Acar'],
    ['Tolga Demir', 'Hakan Yıldız', 'Ebru Şahin'],
    ['Mert Ömeroğlu', 'Seda Acar', 'Murat Çelik'],
  ];
  const deskPools = [
    ['B1', 'B2', 'B3'],
    ['B2', 'B4', 'B6'],
    ['B1', 'B5', 'B7', 'B8'],
    ['B3', 'B4', 'B6', 'B8'],
  ];

  return Array.from({ length: 10 }, (_, index) => {
    const day = new Date(baseDate);
    day.setUTCDate(baseDate.getUTCDate() + index);
    const dayText = day.toISOString().slice(0, 10);
    const archivedAt = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 22, (index * 7) % 60, 0)).toISOString();
    const rangeStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0)).toISOString();
    const rangeEnd = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 21, 59, 59)).toISOString();

    const totalSales = Number((1120 + (index * 91.4) + ((index % 3) * 37.2)).toFixed(2));
    const totalReturns = Number((58 + ((index % 4) * 16.35)).toFixed(2));
    const netRevenue = Number((totalSales - totalReturns).toFixed(2));
    const salesCount = 19 + (index * 2);
    const returnsCount = 1 + (index % 3);
    const totalItems = 52 + (index * 5);

    const cash = Number((netRevenue * 0.31).toFixed(2));
    const card = Number((netRevenue * 0.42).toFixed(2));
    const qr = Number((netRevenue * 0.14).toFixed(2));
    const eft = Number((netRevenue * 0.08).toFixed(2));
    const giftcard = Number((netRevenue - cash - card - qr - eft).toFixed(2));

    return {
      id: `seed-day-end-${dayText}`,
      date: dayText,
      totalSales,
      totalReturns,
      netRevenue,
      salesCount,
      returnsCount,
      totalItems,
      avgSale: Number((totalSales / Math.max(1, salesCount)).toFixed(2)),
      paymentBreakdown: {
        cash,
        card,
        qr,
        eft,
        giftcard,
      },
      status: 'Arşivde',
      archivedAt,
      rangeStart,
      rangeEnd,
      deskCodes: deskPools[index % deskPools.length],
      cashiers: cashierPools[index % cashierPools.length],
      recordTypes: ['sale', 'return'],
      paymentMethods: ['cash', 'card', 'qr', 'eft', 'giftcard'],
      records: [],
    };
  }).reverse();
};

const DEFAULT_DAY_END_ARCHIVES = createDefaultDayEndArchives();

const normalizePaymentToken = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/[\s_\-/]/g, '');

const PAYMENT_METHOD_LOOKUP = (() => {
  const lookup = {};
  DAY_END_PAYMENT_METHODS.forEach((method) => {
    lookup[normalizePaymentToken(method)] = method;
    (PAYMENT_METHOD_ALIASES[method] || []).forEach((alias) => {
      lookup[normalizePaymentToken(alias)] = method;
    });
    if (PAYMENT_LABELS[method]) {
      lookup[normalizePaymentToken(PAYMENT_LABELS[method])] = method;
    }
  });
  return lookup;
})();

const normalizePaymentMethodKey = (value) => PAYMENT_METHOD_LOOKUP[normalizePaymentToken(value)] || null;

const toSafeNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const toDisplayReferenceNo = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  if (/^(sale|pos)-/i.test(raw)) return raw.replace(/^(sale|pos)-/i, 'SAT-');
  if (/^(ret|return)-/i.test(raw)) return raw.replace(/^(ret|return)-/i, 'IAD-');
  return raw;
};

const resolvePaymentAmount = (value) => {
  if (typeof value === 'number') return toSafeNumber(value);
  if (!value || typeof value !== 'object') return 0;
  if (Number.isFinite(Number(value.net))) return toSafeNumber(value.net);
  if (Number.isFinite(Number(value.sales)) || Number.isFinite(Number(value.returns))) {
    return toSafeNumber(value.sales) - toSafeNumber(value.returns);
  }
  if (Number.isFinite(Number(value.amount))) return toSafeNumber(value.amount);
  if (Number.isFinite(Number(value.value))) return toSafeNumber(value.value);
  return 0;
};

const normalizeStringList = (value) => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
  }
  if (typeof value === 'string') {
    return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  }
  return [];
};

const collectDayEndMetaFromRecords = (records = []) => {
  const deskCodes = new Set();
  const cashiers = new Set();
  const recordTypes = new Set();
  const paymentMethods = new Set();

  (Array.isArray(records) ? records : []).forEach((item) => {
    const deskCode = String(item?.deskCode || '').trim();
    if (deskCode) deskCodes.add(deskCode);

    const cashierName = String(item?.cashierName || '').trim();
    if (cashierName) cashiers.add(cashierName);

    const type = String(item?.type || '').trim().toLowerCase('tr-TR');
    if (type) recordTypes.add(type);

    if (Array.isArray(item?.payments) && item.payments.length) {
      item.payments.forEach((payment) => {
        const method = normalizePaymentMethodKey(payment?.method);
        if (method) paymentMethods.add(method);
      });
    } else {
      const fallbackMethod = normalizePaymentMethodKey(item?.paymentMethod);
      if (fallbackMethod) paymentMethods.add(fallbackMethod);
    }
  });

  return {
    deskCodes: Array.from(deskCodes),
    cashiers: Array.from(cashiers),
    recordTypes: Array.from(recordTypes),
    paymentMethods: Array.from(paymentMethods),
  };
};

const buildPaymentBreakdownFromRecords = (records = []) => {
  const breakdown = DAY_END_PAYMENT_METHODS.reduce((acc, method) => {
    acc[method] = 0;
    return acc;
  }, {});

  (Array.isArray(records) ? records : []).forEach((item) => {
    const sign = item?.type === 'return' ? -1 : 1;
    if (Array.isArray(item?.payments) && item.payments.length) {
      item.payments.forEach((payment) => {
        const method = normalizePaymentMethodKey(payment?.method);
        if (!DAY_END_PAYMENT_METHODS.includes(method)) return;
        breakdown[method] += sign * toSafeNumber(payment?.amount);
      });
      return;
    }

    const fallbackMethod = normalizePaymentMethodKey(item?.paymentMethod);
    if (DAY_END_PAYMENT_METHODS.includes(fallbackMethod)) {
      breakdown[fallbackMethod] += sign * toSafeNumber(item?.totalAmount);
    }
  });

  return breakdown;
};

const findPaymentAmountFromSource = (source, method) => {
  if (!source || typeof source !== 'object') return null;

  if (Object.prototype.hasOwnProperty.call(source, method)) {
    return resolvePaymentAmount(source[method]);
  }

  const methodCandidates = [
    method,
    ...(PAYMENT_METHOD_ALIASES[method] || []),
    PAYMENT_LABELS[method],
  ].filter(Boolean);

  for (const candidate of methodCandidates) {
    if (Object.prototype.hasOwnProperty.call(source, candidate)) {
      return resolvePaymentAmount(source[candidate]);
    }
  }

  let matched = false;
  let total = 0;
  Object.entries(source).forEach(([key, value]) => {
    if (normalizePaymentMethodKey(key) === method) {
      total += resolvePaymentAmount(value);
      matched = true;
    }
  });

  return matched ? total : null;
};

const resolvePaymentAmountFromSources = (method, paymentNetSource, paymentSource) => {
  const fromNet = findPaymentAmountFromSource(paymentNetSource, method);
  if (fromNet !== null) return fromNet;

  const fromMain = findPaymentAmountFromSource(paymentSource, method);
  if (fromMain !== null) return fromMain;

  return 0;
};

const normalizeDayEndReport = (report = {}) => {
  const paymentSource = report.paymentBreakdown && typeof report.paymentBreakdown === 'object' ? report.paymentBreakdown : {};
  const paymentNetSource = report.paymentBreakdownNet && typeof report.paymentBreakdownNet === 'object' ? report.paymentBreakdownNet : {};
  const paymentBreakdown = DAY_END_PAYMENT_METHODS.reduce((acc, method) => {
    acc[method] = toSafeNumber(resolvePaymentAmountFromSources(method, paymentNetSource, paymentSource));
    return acc;
  }, {});

  const hasPaymentData = DAY_END_PAYMENT_METHODS.some((method) => Math.abs(paymentBreakdown[method]) > 0.001);
  const mergedRecords = [
    ...(Array.isArray(report.records) ? report.records : []),
    ...(Array.isArray(report.sales) ? report.sales : []),
    ...(Array.isArray(report.returns) ? report.returns : []),
  ];
  const normalizedRecords = mergedRecords
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ ...item }))
    .sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0));
  const fallbackBreakdown = hasPaymentData || mergedRecords.length === 0 ?
    paymentBreakdown
    : buildPaymentBreakdownFromRecords(mergedRecords);
  const derivedMeta = mergedRecords.length ? collectDayEndMetaFromRecords(mergedRecords) : null;

  const deskCodes = normalizeStringList(report.deskCodes || report.deskCode || derivedMeta?.deskCodes || []);
  const cashiers = normalizeStringList(report.cashiers || report.cashierNames || report.cashierName || derivedMeta?.cashiers || []);
  const recordTypes = normalizeStringList(report.recordTypes || report.operationTypes || derivedMeta?.recordTypes || []);

  const paymentMethods = normalizeStringList(report.paymentMethods || report.paymentTypes || derivedMeta?.paymentMethods || []);
  DAY_END_PAYMENT_METHODS.forEach((method) => {
    if (Math.abs(toSafeNumber(fallbackBreakdown[method])) > 0) {
      paymentMethods.push(method);
    }
  });
  const normalizedPaymentMethods = [...new Set(paymentMethods
    .map((item) => normalizePaymentMethodKey(item) || String(item || '').toLowerCase('tr-TR'))
    .filter(Boolean))];

  return {
    id: String(report.id || report.date || Date.now()),
    date: String(report.date || new Date().toISOString().slice(0, 10)),
    totalSales: toSafeNumber(report.totalSales),
    totalReturns: toSafeNumber(report.totalReturns),
    netRevenue: toSafeNumber(report.netRevenue),
    salesCount: Math.max(0, Math.round(toSafeNumber(report.salesCount))),
    returnsCount: Math.max(0, Math.round(toSafeNumber(report.returnsCount))),
    totalItems: Math.max(0, Math.round(toSafeNumber(report.totalItems))),
    avgSale: toSafeNumber(report.avgSale),
    paymentBreakdown: fallbackBreakdown,
    status: String(report.status || 'Arşivde'),
    archivedAt: report.archivedAt || null,
    rangeStart: report.rangeStart || null,
    rangeEnd: report.rangeEnd || report.archivedAt || null,
    isArchived: report.isArchived === true || String(report.status || '').toLowerCase('tr-TR') === 'arşivde',
    deskCodes,
    cashiers,
    recordTypes,
    paymentMethods: normalizedPaymentMethods,
    records: normalizedRecords,
  };
};

const readDayEndArchives = () => {
  try {
    const seedVersion = localStorage.getItem(DAY_END_ARCHIVE_SEED_VERSION_KEY);
    if (seedVersion !== DAY_END_ARCHIVE_SEED_VERSION) {
      const seeded = DEFAULT_DAY_END_ARCHIVES.map((item) => normalizeDayEndReport(item));
      localStorage.setItem(DAY_END_ARCHIVE_KEY, JSON.stringify(seeded));
      localStorage.setItem(DAY_END_ARCHIVE_SEED_VERSION_KEY, DAY_END_ARCHIVE_SEED_VERSION);
      const latest = seeded[0] || null;
      if (latest?.rangeEnd) {
        localStorage.setItem(LAST_DAY_END_AT_KEY, String(latest.rangeEnd));
      }
      return seeded;
    }

    const raw = localStorage.getItem(DAY_END_ARCHIVE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed.map((item) => normalizeDayEndReport(item));
    if (normalized.length) {
      return normalized;
    }
    return DEFAULT_DAY_END_ARCHIVES.map((item) => normalizeDayEndReport(item));
  } catch {
    return DEFAULT_DAY_END_ARCHIVES.map((item) => normalizeDayEndReport(item));
  }
};

const writeDayEndArchives = (archives) => {
  localStorage.setItem(DAY_END_ARCHIVE_KEY, JSON.stringify(Array.isArray(archives) ? archives : []));
};

const readLastDayEndAt = () => {
  try {
    const raw = localStorage.getItem(LAST_DAY_END_AT_KEY);
    if (raw) return raw;
    const archives = readDayEndArchives();
    if (!archives.length) return null;
    const latest = [...archives].sort((a, b) => new Date(b.rangeEnd || b.archivedAt || b.date) - new Date(a.rangeEnd || a.archivedAt || a.date))[0];
    return latest?.rangeEnd || latest?.archivedAt || null;
  } catch {
    return null;
  }
};

const writeLastDayEndAt = (value) => {
  if (!value) {
    localStorage.removeItem(LAST_DAY_END_AT_KEY);
    return;
  }
  localStorage.setItem(LAST_DAY_END_AT_KEY, String(value));
};

const readActiveDeskSessions = () => {
  try {
    const raw = localStorage.getItem(ACTIVE_DESK_SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeActiveDeskSessions = (sessions) => {
  localStorage.setItem(ACTIVE_DESK_SESSIONS_KEY, JSON.stringify(sessions));
};

const clearAllDeskSessions = () => {
  localStorage.removeItem(ACTIVE_DESK_SESSIONS_KEY);
};

const isAfterTimestamp = (value, threshold) => {
  if (!threshold) return true;
  const source = new Date(value).getTime();
  const limit = new Date(threshold).getTime();
  if (Number.isNaN(source) || Number.isNaN(limit)) return true;
  return source > limit;
};

const createDayEndReportFromSales = ({ records = [], rangeStart = null, rangeEnd = null } = {}) => {
  const list = Array.isArray(records) ? records : [];
  const sales = list.filter((item) => item?.type === 'sale');
  const returns = list.filter((item) => item?.type === 'return');
  const totalSales = sales.reduce((sum, item) => sum + toSafeNumber(item.totalAmount), 0);
  const totalReturns = returns.reduce((sum, item) => sum + toSafeNumber(item.totalAmount), 0);
  const paymentBreakdown = buildPaymentBreakdownFromRecords(list);
  const metadata = collectDayEndMetaFromRecords(list);

  const totalItems = list.reduce((sum, item) => {
    const itemQty = (item?.items || []).reduce((qty, row) => qty + toSafeNumber(row?.quantity), 0);
    return sum + itemQty;
  }, 0);

  const safeRangeEnd = rangeEnd || new Date().toISOString();

  return normalizeDayEndReport({
    id: `day-end-${safeRangeEnd}`,
    date: new Date(safeRangeEnd).toISOString().slice(0, 10),
    totalSales,
    totalReturns,
    netRevenue: totalSales - totalReturns,
    salesCount: sales.length,
    returnsCount: returns.length,
    totalItems,
    avgSale: sales.length ? totalSales / sales.length : 0,
    paymentBreakdown,
    status: 'Arşivde',
    archivedAt: safeRangeEnd,
    rangeStart,
    rangeEnd: safeRangeEnd,
    isArchived: true,
    deskCodes: metadata.deskCodes,
    cashiers: metadata.cashiers,
    recordTypes: metadata.recordTypes,
    paymentMethods: metadata.paymentMethods,
    records: list,
  });
};

export default function POSHub() {
  const navigate = useNavigate();
  const dialog = useDialog();
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  /* Shortcuts state */
  const [dailyReport, setDailyReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [salesHistory, setSalesHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyType, setHistoryType] = useState(null); // 'sale' | 'return'
  const [historyError, setHistoryError] = useState('');
  const [historyDetail, setHistoryDetail] = useState(null);
  const [archiveFilters, setArchiveFilters] = useState(DEFAULT_ARCHIVE_FILTERS);
  const [archiveAppliedFilters, setArchiveAppliedFilters] = useState(DEFAULT_ARCHIVE_FILTERS);
  const [dayEndArchiveFilters, setDayEndArchiveFilters] = useState(DEFAULT_DAY_END_ARCHIVE_FILTERS);
  const [dayEndArchiveAppliedFilters, setDayEndArchiveAppliedFilters] = useState(DEFAULT_DAY_END_ARCHIVE_FILTERS);
  const [dayEndArchiveDetail, setDayEndArchiveDetail] = useState(null);
  const [todaySales, setTodaySales] = useState([]);
  const [activeDeskSessions, setActiveDeskSessions] = useState(() => readActiveDeskSessions());
  const [deskActivationStatus, setDeskActivationStatus] = useState({});
  const [activationBusyDesk, setActivationBusyDesk] = useState('');
  const [dayEndBusy, setDayEndBusy] = useState(false);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [dayEndArchives, setDayEndArchives] = useState(() => readDayEndArchives());
  const [lastDayEndAt, setLastDayEndAt] = useState(() => readLastDayEndAt());
  const [quickReturnTarget, setQuickReturnTarget] = useState(null);

  const assignedDeskCode = (user?.assignedDeskCode || '').toUpperCase();
  const isAdmin = user?.role === 'admin';

  const loadDeskActivationStatus = async () => {
    try {
      const data = await posService.getDeskActivationStatus();
      setDeskActivationStatus(data || {});
    } catch {
      setDeskActivationStatus({});
    }
  };

  useEffect(() => {
    posService.getTodaySales().then(setTodaySales).catch(() => setTodaySales([]));
    loadDeskActivationStatus();
  }, []);

  useEffect(() => {
    setActiveDeskSessions(readActiveDeskSessions());
  }, [assignedDeskCode]);

  const tillSummary = (code) => {
    const sales = todaySales.filter((s) => s.type === 'sale' && (s.deskCode || '') === code);
    const returns = todaySales.filter((s) => s.type === 'return' && (s.deskCode || '') === code);
    const totalSales = sales.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
    const totalReturns = returns.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
    return {
      salesCount: sales.length,
      returnCount: returns.length,
      netRevenue: totalSales - totalReturns,
      records: [...sales, ...returns].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6),
    };
  };

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await posService.getDashboard();
      setDashboard(data);
    } catch (err) {
      setError(err.message || 'Kasa verileri yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  /* Shortcut handlers */
  const loadDailyReport = async () => {
    setReportLoading(true);
    try {
      const rangeEnd = new Date().toISOString();
      const allSales = await posService.getAllSales({ startDate: lastDayEndAt, endDate: rangeEnd, full: true });
      const intervalRecords = (Array.isArray(allSales) ? allSales : []).filter((row) => {
        const createdAt = row?.createdAt || row?.timestamp || null;
        if (!createdAt) return false;
        return isAfterTimestamp(createdAt, lastDayEndAt) && new Date(createdAt).getTime() <= new Date(rangeEnd).getTime();
      });

      if (intervalRecords.length > 0) {
        setDailyReport(createDayEndReportFromSales({ records: intervalRecords, rangeStart: lastDayEndAt, rangeEnd }));
      } else {
        const data = await posService.getDailyReport();
        setDailyReport(normalizeDayEndReport(data));
      }

      setShowReport(true);
    } catch { /* ignore */ }
    finally { setReportLoading(false); }
  };

  const loadSalesHistory = async (type) => {
    setHistoryLoading(true);
    setHistoryError('');
    setHistoryType(type);
    setHistoryDetail(null);
    setDayEndArchiveDetail(null);
    setArchiveFilters(DEFAULT_ARCHIVE_FILTERS);
    setArchiveAppliedFilters(DEFAULT_ARCHIVE_FILTERS);
    try {
      const query = type === 'all' ? { type: 'sale', limit: 50 } : { type, limit: 50 };
      const data = await posService.getAllSales(query);
      setSalesHistory(data);
    } catch {
      setSalesHistory([]);
      setHistoryError('İşlem arşivi yüklenemedi. Lütfen tekrar deneyin.');
    }
    finally { setHistoryLoading(false); }
  };

  const openDayEndArchive = () => {
    setHistoryType('day-end');
    setHistoryError('');
    setHistoryDetail(null);
    setSalesHistory(null);
    setDayEndArchiveDetail(null);
    setDayEndArchiveFilters(DEFAULT_DAY_END_ARCHIVE_FILTERS);
    setDayEndArchiveAppliedFilters(DEFAULT_DAY_END_ARCHIVE_FILTERS);
  };

  const closeHistory = () => {
    setHistoryType(null);
    setHistoryError('');
    setSalesHistory(null);
    setHistoryDetail(null);
    setDayEndArchiveDetail(null);
    setArchiveFilters(DEFAULT_ARCHIVE_FILTERS);
    setArchiveAppliedFilters(DEFAULT_ARCHIVE_FILTERS);
    setDayEndArchiveFilters(DEFAULT_DAY_END_ARCHIVE_FILTERS);
    setDayEndArchiveAppliedFilters(DEFAULT_DAY_END_ARCHIVE_FILTERS);
  };

  const clearDeskSession = (code) => {
    const next = { ...activeDeskSessions };
    delete next[code];
    setActiveDeskSessions(next);
    writeActiveDeskSessions(next);
  };

  const formatPrice = (val) =>
    new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 }).format(toSafeNumber(val));

  const formatTime = (iso) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  };

  const openDetailFromRow = (record) => {
    setHistoryType('detail');
    setHistoryDetail(record);
    setSalesHistory([]);
  };

  const openDayEndDetail = (report) => {
    if (!report) return;
    setDailyReport(normalizeDayEndReport(report));
    setShowReport(true);
  };

  const appendDayEndArchive = (report, archivedAt = null) => {
    const normalized = normalizeDayEndReport(report);
    const stamp = archivedAt || normalized.archivedAt || new Date().toISOString();
    const entry = {
      ...normalized,
      id: `day-end-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      archivedAt: stamp,
      rangeEnd: normalized.rangeEnd || stamp,
      status: 'Arşivde',
      isArchived: true,
    };

    const current = Array.isArray(dayEndArchives) ? dayEndArchives : [];
    const next = [entry, ...current].sort((a, b) => new Date(b.archivedAt || b.rangeEnd || b.date) - new Date(a.archivedAt || a.rangeEnd || a.date));
    setDayEndArchives(next);
    writeDayEndArchives(next);

    if (entry.rangeEnd) {
      setLastDayEndAt(entry.rangeEnd);
      writeLastDayEndAt(entry.rangeEnd);
    }

    return entry;
  };

  useEffect(() => {
    let mounted = true;

    const runAutomaticDayEndCheck = async () => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      if (localStorage.getItem(DAY_END_AUTO_MARK_KEY) === today) return;

      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      const midnightIso = midnight.toISOString();

      try {
        const allSales = await posService.getAllSales({ startDate: lastDayEndAt, endDate: midnightIso, full: true });
        const intervalRecords = (Array.isArray(allSales) ? allSales : []).filter((row) => {
          const createdAt = row?.createdAt || row?.timestamp || null;
          if (!createdAt) return false;
          return isAfterTimestamp(createdAt, lastDayEndAt) && new Date(createdAt).getTime() <= midnight.getTime();
        });

        if (intervalRecords.length && mounted) {
          const intervalReport = createDayEndReportFromSales({ records: intervalRecords, rangeStart: lastDayEndAt, rangeEnd: midnightIso });
          const archivedReport = appendDayEndArchive(intervalReport, midnightIso);
          setDailyReport(archivedReport);
        }

        localStorage.setItem(DAY_END_AUTO_MARK_KEY, today);
      } catch {
        // ignore auto day-end errors silently to avoid breaking POS dashboard flow
      }
    };

    void runAutomaticDayEndCheck();
    const timer = window.setInterval(() => {
      void runAutomaticDayEndCheck();
    }, 60 * 1000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [lastDayEndAt]);

  const getPaymentSummary = (record) => {
    const list = (record?.payments || [])
      .map((payment) => `${PAYMENT_LABELS[payment?.method] || payment?.method || '-'} ${formatPrice(payment?.amount)}`)
      .filter(Boolean);
    return list.join(', ') || PAYMENT_LABELS[record?.paymentMethod] || record?.paymentMethod || '-';
  };

  const archiveCashierOptions = useMemo(() => {
    if (historyType !== 'all' && historyType !== 'return') return [];
    const values = new Set();
    (Array.isArray(salesHistory) ? salesHistory : []).forEach((row) => {
      const name = String(row?.cashierName || '').trim();
      if (name) values.add(name);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr-TR'));
  }, [historyType, salesHistory]);

  const dayEndDeskOptions = useMemo(() => {
    const values = new Set();
    (Array.isArray(dayEndArchives) ? dayEndArchives : []).forEach((row) => {
      normalizeStringList(row?.deskCodes).forEach((item) => values.add(item));
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr-TR'));
  }, [dayEndArchives]);

  const handleArchiveFilterChange = (event) => {
    const { name, value } = event.target;
    const next = { ...archiveFilters, [name]: value };
    setArchiveFilters(next);
    setArchiveAppliedFilters(next);
  };

  const applyArchiveFilters = () => {
    setArchiveAppliedFilters({ ...archiveFilters });
  };

  const clearArchiveFilters = () => {
    setArchiveFilters(DEFAULT_ARCHIVE_FILTERS);
    setArchiveAppliedFilters(DEFAULT_ARCHIVE_FILTERS);
  };

  const applyArchiveQuickRange = (preset) => {
    const now = new Date();
    const end = new Date(now);
    let start = new Date(now);

    if (preset === 'week') {
      const day = start.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diffToMonday);
    }

    const next = {
      ...archiveFilters,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
    setArchiveFilters(next);
    setArchiveAppliedFilters(next);
  };

  const handleDayEndArchiveFilterChange = (event) => {
    const { name, value } = event.target;
    const next = { ...dayEndArchiveFilters, [name]: value };
    setDayEndArchiveFilters(next);
    setDayEndArchiveAppliedFilters(next);
  };

  const applyDayEndArchiveFilters = () => {
    setDayEndArchiveAppliedFilters({ ...dayEndArchiveFilters });
  };

  const clearDayEndArchiveFilters = () => {
    setDayEndArchiveFilters(DEFAULT_DAY_END_ARCHIVE_FILTERS);
    setDayEndArchiveAppliedFilters(DEFAULT_DAY_END_ARCHIVE_FILTERS);
  };

  const applyDayEndQuickRange = (preset) => {
    const now = new Date();
    const end = new Date(now);
    let start = new Date(now);

    if (preset === 'week') {
      const day = start.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diffToMonday);
    }

    const next = {
      ...dayEndArchiveFilters,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
    setDayEndArchiveFilters(next);
    setDayEndArchiveAppliedFilters(next);
  };

  const filteredDayEndArchives = useMemo(() => {
    const source = Array.isArray(dayEndArchives) ? dayEndArchives : [];
    const active = dayEndArchiveAppliedFilters;

    return source.filter((row) => {
      const day = String(row?.date || '');
      if (active.from && (!day || day < active.from)) return false;
      if (active.to && (!day || day > active.to)) return false;

      const netRevenue = toSafeNumber(row?.netRevenue);
      if (active.netMin !== '') {
        const minValue = Number(active.netMin);
        if (Number.isFinite(minValue) && netRevenue < minValue) return false;
      }
      if (active.netMax !== '') {
        const maxValue = Number(active.netMax);
        if (Number.isFinite(maxValue) && netRevenue > maxValue) return false;
      }

      const rowDeskCodes = normalizeStringList(row?.deskCodes);
      if (active.deskCode && !rowDeskCodes.includes(String(active.deskCode))) return false;

      const rowCashiers = normalizeStringList(row?.cashiers);

      const rowTypes = normalizeStringList(row?.recordTypes).map((item) => String(item).toLowerCase('tr-TR'));

      const rowPaymentMethods = normalizeStringList(row?.paymentMethods).map((item) => String(item).toLowerCase('tr-TR'));
      if (active.paymentMethod && !rowPaymentMethods.includes(String(active.paymentMethod).toLowerCase('tr-TR'))) return false;

      const query = String(active.search || '').trim().toLocaleLowerCase('tr-TR');
      if (query) {
        const text = [
          row?.date,
          row?.status,
          row?.id,
          ...rowDeskCodes,
          ...rowCashiers,
          ...rowTypes,
          ...rowPaymentMethods.map((method) => PAYMENT_LABELS[method] || method),
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('tr-TR');
        if (!text.includes(query)) return false;
      }

      return true;
    });
  }, [dayEndArchives, dayEndArchiveAppliedFilters]);

  const dayEndArchivesPreview = useMemo(() => {
    const source = Array.isArray(dayEndArchives) ? [...dayEndArchives] : [];
    return source
      .sort((left, right) => {
        const leftTs = new Date(left?.archivedAt || left?.rangeEnd || left?.date || 0).getTime();
        const rightTs = new Date(right?.archivedAt || right?.rangeEnd || right?.date || 0).getTime();
        return rightTs - leftTs;
      })
      .slice(0, 5);
  }, [dayEndArchives]);

  const openDayEndArchiveDetail = async (reportRow) => {
    if (!reportRow?.id && !reportRow?.date) return;

    setHistoryLoading(true);
    try {
      if (Array.isArray(reportRow?.records) && reportRow.records.length > 0) {
        const normalized = normalizeDayEndReport(reportRow);
        setDayEndArchiveDetail({ ...normalized, records: normalized.records || [] });
        return;
      }

      const dayReport = await posService.getDailyReport(reportRow.date);
      const normalized = normalizeDayEndReport({
        ...dayReport,
        id: reportRow.id,
        status: reportRow.status,
        archivedAt: reportRow.archivedAt,
        rangeStart: reportRow.rangeStart,
        rangeEnd: reportRow.rangeEnd,
        isArchived: true,
      });

      const records = [
        ...(Array.isArray(dayReport?.sales) ? dayReport.sales : []),
        ...(Array.isArray(dayReport?.returns) ? dayReport.returns : []),
      ].sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0));

      setDayEndArchiveDetail({ ...normalized, records });
    } catch {
      setDayEndArchiveDetail({
        ...normalizeDayEndReport(reportRow),
        records: [],
      });
    } finally {
      setHistoryLoading(false);
    }
  };

  const filteredArchiveHistory = useMemo(() => {
    if (historyType !== 'all' && historyType !== 'return') return Array.isArray(salesHistory) ? salesHistory : [];

    const source = Array.isArray(salesHistory) ? salesHistory : [];
    const active = archiveAppliedFilters;
    const forceReturnType = historyType === 'return';

    return source.filter((row) => {
      const rowDate = row?.createdAt ? new Date(row.createdAt) : null;
      const rowDateKey = rowDate && !Number.isNaN(rowDate.getTime()) ? rowDate.toISOString().slice(0, 10) : '';
      if (active.from && (!rowDateKey || rowDateKey < active.from)) return false;
      if (active.to && (!rowDateKey || rowDateKey > active.to)) return false;

      const referenceNo = toDisplayReferenceNo(row?.referenceNo || row?.id || '').toLocaleLowerCase('tr-TR');
      if (active.reference && !referenceNo.includes(String(active.reference).toLocaleLowerCase('tr-TR'))) return false;

      if (forceReturnType && String(row?.type || '') !== 'return') {
        return false;
      }

      const paymentMethods = new Set();
      if (row?.paymentMethod) paymentMethods.add(String(row.paymentMethod).toLowerCase());
      (row?.payments || []).forEach((payment) => {
        const method = String(payment?.method || '').toLowerCase();
        if (method) paymentMethods.add(method);
      });
      if (active.paymentMethod && !paymentMethods.has(String(active.paymentMethod).toLowerCase())) return false;

      const totalAmount = toSafeNumber(row?.totalAmount);
      if (active.minAmount !== '') {
        const minAmount = Number(active.minAmount);
        if (Number.isFinite(minAmount) && totalAmount < minAmount) return false;
      }
      if (active.maxAmount !== '') {
        const maxAmount = Number(active.maxAmount);
        if (Number.isFinite(maxAmount) && totalAmount > maxAmount) return false;
      }

      const cashierName = String(row?.cashierName || '').trim();
      if (active.cashier && cashierName !== active.cashier) return false;

      const query = String(active.search || '').trim().toLocaleLowerCase('tr-TR');
      if (query) {
        const text = [
          toDisplayReferenceNo(row?.referenceNo),
          row?.id,
          row?.type === 'return' ? 'iade' : 'satış',
          row?.paymentMethod,
          PAYMENT_LABELS[row?.paymentMethod],
          cashierName,
          ...(row?.payments || []).map((payment) => PAYMENT_LABELS[payment?.method] || payment?.method),
          ...(row?.items || []).map((item) => item?.name),
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('tr-TR');
        if (!text.includes(query)) return false;
      }

      return true;
    });
  }, [historyType, salesHistory, archiveAppliedFilters]);

  const exportArchivePdf = async () => {
    const rows = filteredArchiveHistory;
    if (!rows.length) {
      await dialog.warning({
        title: historyType === 'return' ? 'Geçmiş İadeler Arşivi' : 'Son Satışlar Arşivi',
        description: 'Dışa aktarılacak kayıt bulunamadı.',
      });
      return;
    }

    const isReturnArchive = historyType === 'return';
    const reportTitle = isReturnArchive ? 'POS Geçmiş İadeler Arşivi' : 'POS Son Satışlar Arşivi';
    const filePrefix = isReturnArchive ? 'pos-gecmis-iadeler-arsivi' : 'pos-son-satislar-arsivi';

    const docDefinition = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [28, 36, 28, 28],
      defaultStyle: {
        font: 'Roboto',
        fontSize: 9,
        color: '#1f2937',
      },
      content: [
        { text: sanitizePdfText(reportTitle), bold: true, fontSize: 14, margin: [0, 0, 0, 4] },
        { text: sanitizePdfText(`Oluşturma: ${new Date().toLocaleString('tr-TR')}`), fontSize: 8.5, color: '#64748b', margin: [0, 0, 0, 10] },
        {
          table: {
            headerRows: 1,
            widths: [122, 108, 74, 68, '*', 86],
            body: [
              ['Tarih', 'Referans', 'Tür', 'Ürün', 'Ödeme', 'Tutar'],
              ...rows.map((record) => [
                sanitizePdfText(new Date(record.createdAt).toLocaleString('tr-TR')),
                sanitizePdfText(toDisplayReferenceNo(record.referenceNo || '-')),
                sanitizePdfText(record.type === 'return' ? 'İade' : 'Satış'),
                sanitizePdfText(`${record.items?.length || 0} ürün`),
                sanitizePdfText(getPaymentSummary(record)),
                sanitizePdfText(formatPrice(record.totalAmount)),
              ]),
            ],
          },
          layout: {
            fillColor: (rowIndex) => (rowIndex === 0 ? '#2563eb' : rowIndex % 2 === 0 ? '#f8fafc' : '#ffffff'),
            hLineColor: () => '#dbe5f0',
            vLineColor: () => '#dbe5f0',
            hLineWidth: () => 0.8,
            vLineWidth: () => 0.8,
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 5,
            paddingBottom: () => 5,
          },
        },
      ],
      styles: {
        tableHeader: {
          color: '#ffffff',
          bold: true,
        },
      },
    };

    pdfMake.createPdf(docDefinition).download(`${filePrefix}-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const exportArchiveExcel = async () => {
    const rows = filteredArchiveHistory;
    if (!rows.length) {
      await dialog.warning({
        title: 'Son Satışlar Arşivi',
        description: 'Dışa aktarılacak kayıt bulunamadı.',
      });
      return;
    }

    const exportRows = rows.map((record) => ({
      Tarih: new Date(record.createdAt).toLocaleString('tr-TR'),
      Referans: toDisplayReferenceNo(record.referenceNo || '-'),
      Tur: record.type === 'return' ? 'İade' : 'Satış',
      Urun: `${record.items?.length || 0} ürün`,
      Odeme: getPaymentSummary(record),
      Tutar: toSafeNumber(record.totalAmount),
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Islem Arsivi');
    XLSX.writeFile(workbook, `pos-islem-arsivi-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportDayEndArchivePdf = async () => {
    const rows = filteredDayEndArchives;
    if (!rows.length) {
      await dialog.warning({
        title: 'Gün Sonu Arşivi',
        description: 'Dışa aktarılacak kayıt bulunamadı.',
      });
      return;
    }

    const docDefinition = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [28, 36, 28, 28],
      defaultStyle: {
        font: 'Roboto',
        fontSize: 9,
        color: '#1f2937',
      },
      content: [
        { text: 'POS Gün Sonu Arşivi', bold: true, fontSize: 14, margin: [0, 0, 0, 4] },
        { text: sanitizePdfText(`Oluşturma: ${new Date().toLocaleString('tr-TR')}`), fontSize: 8.5, color: '#64748b', margin: [0, 0, 0, 10] },
        {
          table: {
            headerRows: 1,
            widths: [86, 94, 94, 94, 76, 72, '*'],
            body: [
              ['Tarih', 'Toplam Satış', 'Toplam İade', 'Net Ciro', 'İşlem', 'Durum', 'Kasa/Kullanıcı'],
              ...rows.map((item) => [
                sanitizePdfText(item.date),
                sanitizePdfText(formatPrice(item.totalSales)),
                sanitizePdfText(formatPrice(item.totalReturns)),
                sanitizePdfText(formatPrice(item.netRevenue)),
                sanitizePdfText(String(toSafeNumber(item.salesCount) + toSafeNumber(item.returnsCount))),
                sanitizePdfText(item.status || 'Arşivde'),
                sanitizePdfText(`${normalizeStringList(item.deskCodes).join(', ') || '-'} / ${normalizeStringList(item.cashiers).join(', ') || '-'}`),
              ]),
            ],
          },
          layout: {
            fillColor: (rowIndex) => (rowIndex === 0 ? '#2563eb' : rowIndex % 2 === 0 ? '#f8fafc' : '#ffffff'),
            hLineColor: () => '#dbe5f0',
            vLineColor: () => '#dbe5f0',
            hLineWidth: () => 0.8,
            vLineWidth: () => 0.8,
          },
        },
      ],
    };

    pdfMake.createPdf(docDefinition).download(`pos-gun-sonu-arsivi-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const exportDayEndArchiveExcel = async () => {
    const rows = filteredDayEndArchives;
    if (!rows.length) {
      await dialog.warning({
        title: 'Gün Sonu Arşivi',
        description: 'Dışa aktarılacak kayıt bulunamadı.',
      });
      return;
    }

    const exportRows = rows.map((item) => ({
      Tarih: item.date,
      ToplamSatis: toSafeNumber(item.totalSales),
      ToplamIade: toSafeNumber(item.totalReturns),
      NetCiro: toSafeNumber(item.netRevenue),
      IslemSayisi: toSafeNumber(item.salesCount) + toSafeNumber(item.returnsCount),
      Durum: item.status || 'Arşivde',
      Kasalar: normalizeStringList(item.deskCodes).join(', ') || '-',
      Kullanicilar: normalizeStringList(item.cashiers).join(', ') || '-',
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Gun Sonu Arsivi');
    XLSX.writeFile(workbook, `pos-gun-sonu-arsivi-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleArchiveDailyReport = async () => {
    if (!dailyReport) return;
    const entry = appendDayEndArchive(dailyReport);
    setDailyReport(entry);

    await dialog.success({
      title: 'Günlük Rapor',
      description: 'Gün sonu kaydı arşive eklendi.',
    });
  };

  const downloadTransactionDocument = async (record, kind) => {
    if (!record || documentBusy) return;
    setDocumentBusy(true);
    try {
      if (kind === 'receipt') {
        await posService.downloadReceiptPdf(record, { deskCode: assignedDeskCode });
      } else {
        await posService.downloadInvoicePdf(record, { deskCode: assignedDeskCode });
      }
    } catch (error) {
      await dialog.error({
        title: 'Belge İndirilemedi',
        description: error?.message || 'PDF oluşturulurken bir hata oluştu.',
      });
    } finally {
      setDocumentBusy(false);
    }
  };

  const handleQuickReturn = async (sale) => {
    if (!sale || sale.type === 'return') return;
    if (!sale.referenceNo) {
      await dialog.warning({
        title: 'Hızlı İade',
        description: 'Detaylı iade başlatmak için satış referansı bulunamadı.',
      });
      return;
    }
    setQuickReturnTarget(sale);
  };

  const proceedQuickReturn = () => {
    if (!quickReturnTarget?.referenceNo) return;
    const targetDesk = String(quickReturnTarget.deskCode || assignedDeskCode || 'B1').toUpperCase();
    setQuickReturnTarget(null);
    navigate(`/kasa?desk=${encodeURIComponent(targetDesk)}&mode=return&ref=${encodeURIComponent(quickReturnTarget.referenceNo)}`);
  };

  const handleDayEnd = async () => {
    if (dayEndBusy) return;
    const approved = await dialog.confirm({
      title: 'Gün Sonu Al',
      description: 'Gün sonu raporu alınacak ve açık kasalar kapatılacak. Devam edilsin mi?',
      confirmText: 'Devam Et',
      cancelText: 'İptal',
      closeOnBackdrop: true,
    });
    if (!approved) return;

    try {
      setDayEndBusy(true);
      const rangeEnd = new Date().toISOString();
      const allSales = await posService.getAllSales({ startDate: lastDayEndAt, endDate: rangeEnd, full: true });
      const intervalRecords = (allSales || []).filter((row) => {
        const createdAt = row?.createdAt || row?.timestamp || null;
        if (!createdAt) return false;
        return isAfterTimestamp(createdAt, lastDayEndAt) && new Date(createdAt).getTime() <= new Date(rangeEnd).getTime();
      });

      if (!intervalRecords.length) {
        await dialog.warning({
          title: 'Gün Sonu Al',
          description: 'Arşivlenecek yeni işlem bulunamadı. Aynı veriler için tekrar gün sonu alınamaz.',
        });
        return;
      }

      const intervalReport = createDayEndReportFromSales({ records: intervalRecords, rangeStart: lastDayEndAt, rangeEnd });
      const archivedReport = appendDayEndArchive(intervalReport, rangeEnd);
      setDailyReport(archivedReport);
      setShowReport(true);

      const openDeskCodes = Object.entries(deskActivationStatus || {})
        .filter(([, isOpen]) => isOpen === true)
        .map(([deskCode]) => deskCode);

      await Promise.all(openDeskCodes.map((deskCode) => posService.setDeskActivation(deskCode, false)));
      clearAllDeskSessions();
      setActiveDeskSessions({});
      await Promise.all([
        loadDeskActivationStatus(),
        loadDashboard(),
        posService.getTodaySales().then(setTodaySales).catch(() => setTodaySales([])),
      ]);
    } catch (error) {
      await dialog.error({
        title: 'Gün Sonu Al',
        description: error?.message || 'Gün sonu işlemi tamamlanamadı.',
      });
    } finally {
      setDayEndBusy(false);
    }
  };

  if (!isAdmin) {
    return <Navigate to="/kasa" replace />;
  }

  if (loading) {
    return (
      <div className="page-stack">
        <PageHeader icon={<ShoppingCart size={22} />} title="POS / Kasa" description="Yükleniyor..." />
        <div className="pos-hub-loading">
          <div className="loader" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-stack">
        <PageHeader icon={<ShoppingCart size={22} />} title="POS / Kasa" description="Günlük kasa operasyonları" />
        <div className="pos-hub-error">
          <AlertCircle size={40} />
          <p>{error}</p>
          <button className="primary-button" onClick={loadDashboard}>Tekrar Dene</button>
        </div>
      </div>
    );
  }

  const d = dashboard || {};
  const intervalTodayRecords = (Array.isArray(todaySales) ? todaySales : []).filter((row) => isAfterTimestamp(row?.createdAt || row?.timestamp, lastDayEndAt));
  const liveDayReport = createDayEndReportFromSales({ records: intervalTodayRecords, rangeStart: lastDayEndAt, rangeEnd: new Date().toISOString() });
  const recentSales = intervalTodayRecords
    .filter((row) => row?.type === 'sale')
    .sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0))
    .slice(0, 6);
  const recentReturns = intervalTodayRecords
    .filter((row) => row?.type === 'return')
    .sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0))
    .slice(0, 6);
  const paymentBreakdown = liveDayReport.paymentBreakdown || d.paymentBreakdown || {};
  const statItems = [
    { key: 'todaySales', label: 'Bugünkü Satış', value: liveDayReport.totalSales, icon: TrendingUp, color: 'stat-green', sub: `${liveDayReport.salesCount || 0} işlem` },
    { key: 'todayReturns', label: 'Bugünkü İade', value: liveDayReport.totalReturns, icon: TrendingDown, color: 'stat-red', sub: `${liveDayReport.returnsCount || 0} işlem` },
    { key: 'dailyRevenue', label: 'Günlük Net Ciro', value: liveDayReport.netRevenue, icon: Banknote, color: 'stat-blue', sub: 'Satış - iade' },
    { key: 'cash', label: 'Nakit', value: paymentBreakdown.cash || 0, icon: Banknote, color: PAYMENT_COLORS.cash },
    { key: 'card', label: 'Kart', value: paymentBreakdown.card || 0, icon: CreditCard, color: PAYMENT_COLORS.card },
    { key: 'qr', label: 'QR Ödeme', value: paymentBreakdown.qr || 0, icon: QrCode, color: PAYMENT_COLORS.qr },
    { key: 'eft', label: 'Havale/EFT', value: paymentBreakdown.eft || 0, icon: Building2, color: PAYMENT_COLORS.eft },
    { key: 'giftcard', label: 'Hediye Kartı', value: paymentBreakdown.giftcard || 0, icon: Gift, color: PAYMENT_COLORS.giftcard },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        className="dashboard-hero"
        icon={<ShoppingCart size={22} />}
        title="POS / Kasa"
        description="Günlük kasa performansı ve operasyonlar"
      />

      {/* Ozet Kartlari */}
      <section className="pos-hub-stats">
        {statItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.key} className="pos-hub-stat">
              <div className={`pos-hub-stat-icon ${item.color || 'stat-blue'}`}><Icon size={20} /></div>
              <div className="pos-hub-stat-body">
                <span className="pos-hub-stat-label">{item.label}</span>
                <span className="pos-hub-stat-value">{formatPrice(item.value)}</span>
                {item.sub && <span className="pos-hub-stat-sub">{item.sub}</span>}
              </div>
            </div>
          );
        })}
      </section>

      {quickReturnTarget ? (
        <div className="pos-hub-overlay pos-hub-overlay-elevated" onClick={() => setQuickReturnTarget(null)}>
          <div className="pos-hub-modal" onClick={(event) => event.stopPropagation()}>
            <div className="pos-hub-modal-header">
              <h3><RotateCcw size={20} /> Hızlı İade</h3>
              <button className="pos-hub-modal-close" type="button" onClick={() => setQuickReturnTarget(null)}><X size={20} /></button>
            </div>
            <div className="pos-hub-modal-body">
              <div className="pos-hub-report-grid">
                <div className="pos-hub-report-item"><span>Fiş</span><strong>{toDisplayReferenceNo(quickReturnTarget.referenceNo)}</strong></div>
                <div className="pos-hub-report-item"><span>Kasa</span><strong>{quickReturnTarget.deskCode || '-'}</strong></div>
                <div className="pos-hub-report-item"><span>Tarih</span><strong>{new Date(quickReturnTarget.createdAt).toLocaleString('tr-TR')}</strong></div>
                <div className="pos-hub-report-item"><span>Tutar</span><strong>{formatPrice(quickReturnTarget.totalAmount)}</strong></div>
              </div>
              <div className="pos-hub-report-actions">
                <button type="button" className="secondary-button pos-hub-action-btn" onClick={() => setQuickReturnTarget(null)}>Vazgeç</button>
                <button type="button" className="primary-button pos-hub-action-btn" onClick={proceedQuickReturn}>İade Ekranını Aç</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Kasa Moduna Gec Buyuk Buton */}
      <section className="pos-hub-launch-section" onClick={() => navigate('/kasa')}>
        <div className="pos-hub-launch-card">
          <div className="pos-hub-launch-icon">
            <Monitor size={48} strokeWidth={1.5} />
          </div>
          <div className="pos-hub-launch-text">
            <h2>Kasa Moduna Geç</h2>
            <p>Tam ekran POS arayüzünü açarak satış yapmaya başlayın</p>
          </div>
          <ArrowRight size={28} />
        </div>
      </section>

      {/* Gunluk Rapor Modal */}
      {showReport && dailyReport && (
        <div className="pos-hub-overlay" onClick={() => setShowReport(false)}>
          <div className="pos-hub-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pos-hub-modal-header">
              <h3><BarChart3 size={20} /> Günlük Rapor • {dailyReport.date}</h3>
              <button className="pos-hub-modal-close" type="button" onClick={() => setShowReport(false)}><X size={20} /></button>
            </div>
            <div className="pos-hub-modal-body">
              <div className="pos-hub-report-grid">
                <div className="pos-hub-report-item"><span>Toplam Satış</span><strong>{formatPrice(dailyReport.totalSales)}</strong></div>
                <div className="pos-hub-report-item"><span>Toplam İade</span><strong className="text-red">{formatPrice(dailyReport.totalReturns)}</strong></div>
                <div className="pos-hub-report-item"><span>Net Ciro</span><strong className="text-green">{formatPrice(dailyReport.netRevenue)}</strong></div>
                <div className="pos-hub-report-item"><span>İşlem Sayısı</span><strong>{toSafeNumber(dailyReport.salesCount) + toSafeNumber(dailyReport.returnsCount)}</strong></div>
              </div>
              <>
                <h4 className="pos-hub-report-subtitle">Ödeme Dağılımı</h4>
                <div className="pos-hub-report-payments">
                  {DAY_END_PAYMENT_METHODS.map((method) => {
                    const Icon = PAYMENT_ICONS[method] || Banknote;
                    const amount = toSafeNumber(dailyReport.paymentBreakdown?.[method]);
                    return (
                      <div key={method} className="pos-hub-report-pay-row">
                        <div className="pos-hub-report-pay-meta">
                          <span className={`pos-hub-report-pay-icon ${PAYMENT_COLORS[method] || 'stat-blue'}`}>
                            <Icon size={15} />
                          </span>
                          <span>{PAYMENT_LABELS[method] || method}</span>
                        </div>
                        <strong>{formatPrice(amount)}</strong>
                      </div>
                    );
                  })}
                </div>
              </>
              {!dailyReport.isArchived && (
                <div className="pos-hub-report-actions">
                  <button type="button" className="secondary-button pos-hub-action-btn" onClick={handleArchiveDailyReport}>
                    Arşive Ekle
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Satis/Iade Gecmisi Modal */}
      {historyType && (
        <div className="pos-hub-overlay" onClick={closeHistory}>
          <div className={`pos-hub-modal pos-hub-modal-wide${historyType === 'all' || historyType === 'return' || historyType === 'day-end' ? ' pos-hub-modal-archive' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="pos-hub-modal-header">
              <h3>
                  {historyType === 'day-end' ? (
                    dayEndArchiveDetail ?
                    <><FileText size={20} /> Gün Sonu Detayı • {dayEndArchiveDetail.date}</>
                    : <><History size={20} /> Gün Sonu Arşivi</>
                ) : historyDetail ? (
                  <><FileText size={20} /> İşlem Detayı</>
                ) : historyType === 'return' ? (
                  <><RotateCcw size={20} /> Geçmiş İadeler</>
                ) : historyType === 'all' ? (
                  <><History size={20} /> Son Satışlar Arşivi</>
                ) : (
                  <><History size={20} /> Geçmiş Satışlar</>
                )}
              </h3>
              <button className="pos-hub-modal-close" type="button" onClick={closeHistory}><X size={20} /></button>
            </div>
            <div className="pos-hub-modal-body">
              {historyLoading ? (
                <div className="pos-hub-empty"><div className="loader" /></div>
              ) : historyError ? (
                <div className="pos-hub-empty pos-hub-empty-error">
                  <AlertCircle size={32} strokeWidth={1.2} />
                  <span>{historyError}</span>
                </div>
              ) : historyType === 'day-end' && dayEndArchiveDetail ? (
                <div className="pos-hub-history-detail">
                  <button className="pos-hub-back-btn" type="button" onClick={() => setDayEndArchiveDetail(null)}>← Listeye Dön</button>
                  <div className="pos-hub-report-grid">
                    <div className="pos-hub-report-item"><span>Toplam Satış</span><strong>{formatPrice(dayEndArchiveDetail.totalSales)}</strong></div>
                    <div className="pos-hub-report-item"><span>Toplam İade</span><strong className="text-red">{formatPrice(dayEndArchiveDetail.totalReturns)}</strong></div>
                    <div className="pos-hub-report-item"><span>Net Ciro</span><strong className="text-green">{formatPrice(dayEndArchiveDetail.netRevenue)}</strong></div>
                    <div className="pos-hub-report-item"><span>İşlem Sayısı</span><strong>{toSafeNumber(dayEndArchiveDetail.salesCount) + toSafeNumber(dayEndArchiveDetail.returnsCount)}</strong></div>
                  </div>

                  {dayEndArchiveDetail.records?.length ? (
                    <table className="pos-hub-table">
                      <thead>
                        <tr><th>Referans</th><th>Tarih</th><th>Tür</th><th>Ürün</th><th>Ödeme</th><th className="text-right">Tutar</th><th className="text-right">Aksiyon</th></tr>
                      </thead>
                      <tbody>
                        {dayEndArchiveDetail.records.map((record, index) => (
                          <tr key={record.id || `${record.referenceNo || 'record'}-${record.createdAt || 'no-date'}-${index}`}>
                            <td><strong>{toDisplayReferenceNo(record.referenceNo || '-')}</strong></td>
                            <td><Clock size={13} /> {new Date(record.createdAt).toLocaleString('tr-TR')}</td>
                            <td>
                              <span className={`pos-hub-pay-badge ${record.type}`}>
                                {record.type === 'return' ? 'İade' : 'Satış'}
                              </span>
                            </td>
                            <td>{record.items?.length || 0} ürün</td>
                            <td><span className={`pos-hub-pay-badge ${record.paymentMethod} ${record.type === 'return' ? 'refund' : ''}`}>{getPaymentSummary(record)}</span></td>
                            <td className="text-right"><strong>{formatPrice(record.totalAmount)}</strong></td>
                            <td className="text-right">
                              <div className="pos-hub-row-actions">
                                <button
                                  type="button"
                                  className="secondary-button pos-hub-action-btn"
                                  onClick={() => openDetailFromRow(record)}
                                >
                                  Detay
                                </button>
                                <button
                                  type="button"
                                  className="secondary-button pos-hub-action-btn"
                                  onClick={() => downloadTransactionDocument(record, 'receipt')}
                                  disabled={documentBusy}
                                >
                                  Fiş
                                </button>
                                <button
                                  type="button"
                                  className="secondary-button pos-hub-action-btn"
                                  onClick={() => downloadTransactionDocument(record, 'invoice')}
                                  disabled={documentBusy}
                                >
                                  Fatura
                                </button>
                                {record.type === 'sale' ? (
                                  <button
                                    type="button"
                                    className="primary-button pos-hub-action-btn"
                                    onClick={() => handleQuickReturn(record)}
                                  >
                                    Hızlı İade
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="pos-hub-empty"><span>Bu güne ait işlem bulunamadı</span></div>
                  )}
                </div>
              ) : historyDetail ? (
                <div className="pos-hub-history-detail">
                  {historyType !== 'detail' && (
                    <button className="pos-hub-back-btn" type="button" onClick={() => setHistoryDetail(null)}>← Listeye Dön</button>
                  )}
                  <div className="pos-hub-detail-head">
                    <h4>{toDisplayReferenceNo(historyDetail.referenceNo)}</h4>
                    <span className={`pos-hub-pay-badge ${historyDetail.type}`}>{historyDetail.type === 'return' ? 'İade' : 'Satış'}</span>
                  </div>
                  <div className="pos-hub-detail-meta">
                    <span>Kasiyer: {historyDetail.cashierName}</span>
                    <span>Tarih: {new Date(historyDetail.createdAt).toLocaleString('tr-TR')}</span>
                    <span>Ödeme: {(historyDetail.payments || []).map((p) => `${PAYMENT_LABELS[p.method] || p.method} ${formatPrice(p.amount)}`).join(', ') || PAYMENT_LABELS[historyDetail.paymentMethod] || historyDetail.paymentMethod}</span>
                    {historyDetail.originalSaleRef && <span>Orijinal Fiş: {historyDetail.originalSaleRef}</span>}
                    {historyDetail.returnReason && <span>İade Nedeni: {historyDetail.returnReasonLabel || formatReturnReasonLabel(historyDetail.returnReason)}</span>}
                  </div>
                  <table className="pos-hub-table">
                    <thead><tr><th>Ürün</th><th>Adet</th><th>B.Fiyat</th><th className="text-right">Toplam</th></tr></thead>
                    <tbody>
                      {(historyDetail.items || []).map((i, idx) => (
                        <tr key={`${i?.id || i?.sku || i?.name || 'satir'}-${idx}`}><td>{i.name}</td><td>{i.quantity}</td><td>{formatPrice(i.unitPrice)}</td><td className="text-right">{formatPrice(i.totalPrice)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="pos-hub-detail-totals">
                    {historyDetail.discount > 0 && <span>İndirim: -{formatPrice(historyDetail.discount)}</span>}
                    <strong>Toplam: {formatPrice(historyDetail.totalAmount)}</strong>
                    {historyDetail.changeAmount > 0 && <span>Para Üstü: {formatPrice(historyDetail.changeAmount)}</span>}
                  </div>
                  <div className="pos-hub-detail-actions">
                    <div className="pos-hub-detail-actions-docs">
                      <button
                        type="button"
                        className="secondary-button pos-hub-action-btn"
                        onClick={() => downloadTransactionDocument(historyDetail, 'receipt')}
                        disabled={documentBusy}
                      >
                        <Printer size={15} /> {documentBusy ? 'Hazırlanıyor...' : 'Fiş İndir'}
                      </button>
                      <button
                        type="button"
                        className="secondary-button pos-hub-action-btn"
                        onClick={() => downloadTransactionDocument(historyDetail, 'invoice')}
                        disabled={documentBusy}
                      >
                        <FileText size={15} /> {documentBusy ? 'Hazırlanıyor...' : 'Fatura İndir'}
                      </button>
                    </div>
                    {historyDetail.type === 'sale' && (
                      <div className="pos-hub-detail-actions-main">
                        <button
                          type="button"
                          className="primary-button pos-hub-action-btn"
                          onClick={() => handleQuickReturn(historyDetail)}
                        >
                          <RotateCcw size={15} /> Hızlı İade
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : historyType === 'day-end' && filteredDayEndArchives.length === 0 ? (
                <div className="pos-hub-empty">
                  <History size={32} strokeWidth={1.2} />
                  <span>Gün sonu arşiv kaydı bulunamadı</span>
                </div>
              ) : historyType !== 'day-end' && filteredArchiveHistory.length === 0 ? (
                <div className="pos-hub-empty">
                  {historyType === 'return' ? <RotateCcw size={32} strokeWidth={1.2} /> : <History size={32} strokeWidth={1.2} />}
                  <span>Kayıt bulunamadı</span>
                </div>
              ) : (
                <>
                  {historyType === 'day-end' && (
                    <section className="s-devlog-section s-devlog-filter-section pos-hub-archive-filters pos-hub-day-end-filter-panel">
                      <div className="s-devlog-filters pos-hub-archive-filters-grid">
                        <label className="field-group s-devlog-field s-devlog-field-date pos-hub-archive-field-from">
                          <span>Başlangıç</span>
                          <input type="date" name="from" value={dayEndArchiveFilters.from} onChange={handleDayEndArchiveFilterChange} />
                        </label>
                        <label className="field-group s-devlog-field s-devlog-field-date pos-hub-archive-field-to">
                          <span>Bitiş</span>
                          <input type="date" name="to" value={dayEndArchiveFilters.to} onChange={handleDayEndArchiveFilterChange} />
                        </label>
                        <label className="field-group s-devlog-field pos-hub-archive-field-min">
                          <span>Net Ciro Min</span>
                          <input type="number" min="0" step="0.01" name="netMin" value={dayEndArchiveFilters.netMin} onChange={handleDayEndArchiveFilterChange} placeholder="0" />
                        </label>
                        <label className="field-group s-devlog-field pos-hub-archive-field-max">
                          <span>Net Ciro Max</span>
                          <input type="number" min="0" step="0.01" name="netMax" value={dayEndArchiveFilters.netMax} onChange={handleDayEndArchiveFilterChange} placeholder="100000" />
                        </label>
                        <label className="field-group s-devlog-field pos-hub-archive-field-desk">
                          <span>Kasa</span>
                          <select name="deskCode" value={dayEndArchiveFilters.deskCode} onChange={handleDayEndArchiveFilterChange}>
                            <option value="">Tümü</option>
                            {dayEndDeskOptions.map((code) => (
                              <option key={code} value={code}>{code}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field-group s-devlog-field pos-hub-archive-field-payment">
                          <span>Ödeme Tipi</span>
                          <select name="paymentMethod" value={dayEndArchiveFilters.paymentMethod} onChange={handleDayEndArchiveFilterChange}>
                            <option value="">Tümü</option>
                            {DAY_END_PAYMENT_METHODS.map((method) => (
                              <option key={method} value={method}>{PAYMENT_LABELS[method] || method}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field-group s-devlog-field s-devlog-field-search pos-hub-archive-field-search">
                          <span>Genel Arama</span>
                          <input type="search" name="search" value={dayEndArchiveFilters.search} onChange={handleDayEndArchiveFilterChange} placeholder="Tarih, kasa, ödeme" />
                        </label>
                      </div>
                      <div className="s-devlog-manager-actions s-devlog-controls-actions pos-hub-archive-filter-actions">
                        <div className="pos-hub-archive-action-main">
                          <button type="button" className="s-audit-btn s-devlog-filter-btn" onClick={applyDayEndArchiveFilters}>Filtrele</button>
                          <button type="button" className="s-audit-btn" onClick={clearDayEndArchiveFilters}>Temizle</button>
                        </div>
                        <div className="pos-hub-archive-action-quick">
                          <button type="button" className="s-audit-btn" onClick={() => applyDayEndQuickRange('today')}>Bugün</button>
                          <button type="button" className="s-audit-btn" onClick={() => applyDayEndQuickRange('week')}>Bu Hafta</button>
                        </div>
                        <div className="pos-hub-archive-action-export">
                          <button type="button" className="s-audit-btn" onClick={exportDayEndArchivePdf}>
                            <FileDown size={14} /> PDF Dışa Aktar
                          </button>
                          <button type="button" className="s-audit-btn" onClick={exportDayEndArchiveExcel}>
                            <FileSpreadsheet size={14} /> Excel Dışa Aktar
                          </button>
                        </div>
                      </div>
                    </section>
                  )}

                  {(historyType === 'all' || historyType === 'return') && (
                    <section className="s-devlog-section s-devlog-filter-section pos-hub-archive-filters">
                      <div className="s-devlog-filters pos-hub-archive-filters-grid">
                        <label className="field-group s-devlog-field s-devlog-field-date pos-hub-archive-field-from">
                          <span>Başlangıç</span>
                          <input type="date" name="from" value={archiveFilters.from} onChange={handleArchiveFilterChange} />
                        </label>
                        <label className="field-group s-devlog-field s-devlog-field-date pos-hub-archive-field-to">
                          <span>Bitiş</span>
                          <input type="date" name="to" value={archiveFilters.to} onChange={handleArchiveFilterChange} />
                        </label>
                        <label className="field-group s-devlog-field pos-hub-archive-field-reference">
                          <span>Referans / İşlem No</span>
                          <input type="text" name="reference" value={archiveFilters.reference} onChange={handleArchiveFilterChange} placeholder="SAT-..., IAD-..." />
                        </label>
                        <label className="field-group s-devlog-field pos-hub-archive-field-payment">
                          <span>Ödeme Tipi</span>
                          <select name="paymentMethod" value={archiveFilters.paymentMethod} onChange={handleArchiveFilterChange}>
                            <option value="">Tümü</option>
                            {DAY_END_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{PAYMENT_LABELS[method] || method}</option>)}
                          </select>
                        </label>
                        <label className="field-group s-devlog-field pos-hub-archive-field-min">
                          <span>Tutar Min</span>
                          <input type="number" min="0" step="0.01" name="minAmount" value={archiveFilters.minAmount} onChange={handleArchiveFilterChange} placeholder="0" />
                        </label>
                        <label className="field-group s-devlog-field pos-hub-archive-field-max">
                          <span>Tutar Max</span>
                          <input type="number" min="0" step="0.01" name="maxAmount" value={archiveFilters.maxAmount} onChange={handleArchiveFilterChange} placeholder="10000" />
                        </label>
                        <label className="field-group s-devlog-field pos-hub-archive-field-user">
                          <span>Kasiyer</span>
                          <select name="cashier" value={archiveFilters.cashier} onChange={handleArchiveFilterChange}>
                            <option value="">Tümü</option>
                            {archiveCashierOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                          </select>
                        </label>
                        <label className="field-group s-devlog-field s-devlog-field-search pos-hub-archive-field-search">
                          <span>Genel Arama</span>
                          <input type="search" name="search" value={archiveFilters.search} onChange={handleArchiveFilterChange} placeholder="Referans, ürün, ödeme, kasiyer" />
                        </label>
                      </div>
                      <div className="s-devlog-manager-actions s-devlog-controls-actions pos-hub-archive-filter-actions">
                        <div className="pos-hub-archive-action-main">
                          <button type="button" className="s-audit-btn s-devlog-filter-btn" onClick={applyArchiveFilters}>Filtrele</button>
                          <button type="button" className="s-audit-btn" onClick={clearArchiveFilters}>Temizle</button>
                        </div>
                        <div className="pos-hub-archive-action-quick">
                          <button type="button" className="s-audit-btn" onClick={() => applyArchiveQuickRange('today')}>Bugün</button>
                          <button type="button" className="s-audit-btn" onClick={() => applyArchiveQuickRange('week')}>Bu Hafta</button>
                        </div>
                        <div className="pos-hub-archive-action-export">
                          <button type="button" className="s-audit-btn" onClick={exportArchivePdf}>
                            <FileDown size={14} /> PDF Dışa Aktar
                          </button>
                          <button type="button" className="s-audit-btn" onClick={exportArchiveExcel}>
                            <FileSpreadsheet size={14} /> Excel Dışa Aktar
                          </button>
                        </div>
                      </div>
                    </section>
                  )}

                  {historyType === 'day-end' ? (
                    <table className="pos-hub-table">
                      <thead>
                        <tr>
                          <th>Tarih</th>
                          <th className="text-right">Toplam Satış</th>
                          <th className="text-right">Toplam İade</th>
                          <th className="text-right">Net Ciro</th>
                          <th className="text-right">İşlem Sayısı</th>
                          <th>Durum</th>
                          <th className="text-right">Aksiyon</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDayEndArchives.map((item) => (
                          <tr key={item.id}>
                            <td><strong>{item.date}</strong></td>
                            <td className="text-right">{formatPrice(item.totalSales)}</td>
                            <td className="text-right">{formatPrice(item.totalReturns)}</td>
                            <td className="text-right"><strong>{formatPrice(item.netRevenue)}</strong></td>
                            <td className="text-right">{toSafeNumber(item.salesCount) + toSafeNumber(item.returnsCount)}</td>
                            <td>{item.status || 'Arşivde'}</td>
                            <td className="text-right">
                              <button type="button" className="secondary-button pos-hub-action-btn" onClick={() => openDayEndArchiveDetail(item)}>Detay</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                  <table className="pos-hub-table">
                    <thead>
                      <tr><th>Referans</th><th>Tarih</th><th>Tür</th><th>Ürün</th><th>Ödeme</th><th className="text-right">Tutar</th><th className="text-right">Aksiyon</th></tr>
                    </thead>
                    <tbody>
                      {filteredArchiveHistory.map((s) => (
                        <tr key={s.id} className="pos-hub-clickable" onClick={() => setHistoryDetail(s)}>
                          <td><strong>{toDisplayReferenceNo(s.referenceNo)}</strong></td>
                          <td><Clock size={13} /> {new Date(s.createdAt).toLocaleString('tr-TR')}</td>
                          <td>
                            <span className={`pos-hub-pay-badge ${s.type}`}>
                              {s.type === 'return' ? 'İade' : 'Satış'}
                            </span>
                          </td>
                          <td>{s.items?.length || 0} ürün</td>
                          <td>
                            <span className={`pos-hub-pay-badge ${s.paymentMethod} ${s.type === 'return' ? 'refund' : ''}`}>
                              {getPaymentSummary(s)}
                            </span>
                          </td>
                          <td className="text-right"><strong>{formatPrice(s.totalAmount)}</strong></td>
                          <td className="text-right">
                            <div className="pos-hub-row-actions">
                              <button
                                type="button"
                                className="secondary-button pos-hub-action-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setHistoryDetail(s);
                                }}
                              >
                                Detay
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Alt Bölüm: Operasyon Paneli */}
      <section className="pos-hub-operations">
        {/* Son Satışlar */}
        <section className="pos-hub-table-card">
          <div className="pos-hub-table-header">
            <div className="pos-hub-table-icon stat-green"><Receipt size={18} /></div>
            <div className="pos-hub-table-title">
              <h3>Son Satışlar</h3>
              <p>Bugünkü satış işlemleri (son 6 kayıt)</p>
            </div>
            <div className="pos-hub-table-header-actions">
              <button type="button" className="secondary-button pos-hub-action-btn" onClick={() => loadSalesHistory('all')}>
                <History size={15} /> Arşiv
              </button>
              <button type="button" className="primary-button pos-hub-action-btn" onClick={handleDayEnd} disabled={dayEndBusy}>
                <BarChart3 size={15} /> {dayEndBusy ? 'İşleniyor...' : 'Gün Sonu Al'}
              </button>
            </div>
          </div>
          <div className="pos-hub-table-body">
            {recentSales.length === 0 ? (
              <div className="pos-hub-empty">
                <Receipt size={32} strokeWidth={1.2} />
                <span>Bugün henüz satış yok</span>
              </div>
            ) : (
              <table className="pos-hub-table">
                <thead>
                  <tr>
                    <th>Referans</th>
                    <th>Saat</th>
                    <th>Ürün</th>
                    <th>Ödeme</th>
                    <th className="text-right">Tutar</th>
                    <th className="text-right">Aksiyon</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map((s) => (
                    <tr key={s.id} className="pos-hub-clickable" onClick={() => openDetailFromRow(s)}>
                      <td><strong>{toDisplayReferenceNo(s.referenceNo)}</strong></td>
                      <td><Clock size={13} /> {formatTime(s.createdAt)}</td>
                      <td>{s.items?.length || 0} ürün</td>
                      <td>
                        <span className={`pos-hub-pay-badge ${s.paymentMethod} ${s.type === 'return' ? 'refund' : ''}`}>
                          {(s.payments || []).map((p) => PAYMENT_LABELS[p.method]).join(', ') || PAYMENT_LABELS[s.paymentMethod] || s.paymentMethod}
                        </span>
                      </td>
                      <td className="text-right"><strong>{formatPrice(s.totalAmount)}</strong></td>
                      <td className="text-right">
                        <div className="pos-hub-row-actions">
                          <button
                            type="button"
                            className="secondary-button pos-hub-action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetailFromRow(s);
                            }}
                          >
                            Detay
                          </button>
                          <button
                            type="button"
                            className="primary-button pos-hub-action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleQuickReturn(s);
                            }}
                          >
                            Hızlı İade
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        {/* Son İadeler */}
        <section className="pos-hub-table-card">
          <div className="pos-hub-table-header">
            <div className="pos-hub-table-icon stat-red"><RotateCcw size={18} /></div>
            <div className="pos-hub-table-title">
              <h3>Son İadeler</h3>
              <p>Bugünkü iade işlemleri (son 6 kayıt)</p>
            </div>
            <div className="pos-hub-table-header-actions">
              <button type="button" className="secondary-button pos-hub-action-btn" onClick={() => loadSalesHistory('return')}>
                <History size={15} /> İade Arşivi
              </button>
            </div>
          </div>
          <div className="pos-hub-table-body">
            {recentReturns.length === 0 ? (
              <div className="pos-hub-empty">
                <RotateCcw size={32} strokeWidth={1.2} />
                <span>Bugün henüz iade yok</span>
              </div>
            ) : (
              <table className="pos-hub-table">
                <thead>
                  <tr>
                    <th>Referans</th>
                    <th>Saat</th>
                    <th>Ürün</th>
                    <th className="text-right">Tutar</th>
                    <th className="text-right">Aksiyon</th>
                  </tr>
                </thead>
                <tbody>
                  {recentReturns.map((s) => (
                    <tr key={s.id} className="pos-hub-clickable" onClick={() => openDetailFromRow(s)}>
                      <td><strong>{toDisplayReferenceNo(s.referenceNo)}</strong></td>
                      <td><Clock size={13} /> {formatTime(s.createdAt)}</td>
                      <td>{s.items?.length || 0} ürün</td>
                      <td className="text-right"><strong className="text-red">{formatPrice(s.totalAmount)}</strong></td>
                      <td className="text-right">
                        <div className="pos-hub-row-actions">
                          <button
                            type="button"
                            className="secondary-button pos-hub-action-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetailFromRow(s);
                            }}
                          >
                            Detay
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </section>

      <section className="pos-hub-table-card pos-hub-day-end-section">
        <div className="pos-hub-table-header">
          <div className="pos-hub-table-icon stat-blue"><BarChart3 size={18} /></div>
          <div className="pos-hub-table-title">
            <h3>Gün Sonu İşlemleri</h3>
            <p>Arşivlenen gün sonu kayıtlarını inceleyin</p>
          </div>
          <div className="pos-hub-table-header-actions pos-hub-day-end-header-actions">
            <div className="pos-hub-day-end-access-note">
              <span>Arşiv Erişimi</span>
              <small>{dayEndArchives.length} gün sonu kaydı, tüm işlem arşivine filtreli erişim</small>
            </div>
            <button type="button" className="secondary-button pos-hub-action-btn" onClick={openDayEndArchive} disabled={historyLoading && historyType === 'day-end'}>
              <History size={15} /> {historyLoading && historyType === 'day-end' ? 'Yükleniyor...' : 'Arşiv'}
            </button>
          </div>
        </div>
        <div className="pos-hub-table-body">
          {dayEndArchivesPreview.length === 0 ? (
            <div className="pos-hub-empty">
              <BarChart3 size={32} strokeWidth={1.2} />
              <span>Henüz arşivlenmiş gün sonu kaydı yok</span>
            </div>
          ) : (
            <table className="pos-hub-table">
              <thead>
                <tr>
                  <th>Tarih</th>
                  <th className="text-right">Toplam Satış</th>
                  <th className="text-right">Toplam İade</th>
                  <th className="text-right">Net Ciro</th>
                  <th className="text-right">İşlem Sayısı</th>
                  <th>Durum</th>
                  <th className="text-right">Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {dayEndArchivesPreview.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.date}</strong></td>
                    <td className="text-right">{formatPrice(item.totalSales)}</td>
                    <td className="text-right">{formatPrice(item.totalReturns)}</td>
                    <td className="text-right"><strong>{formatPrice(item.netRevenue)}</strong></td>
                    <td className="text-right">{toSafeNumber(item.salesCount) + toSafeNumber(item.returnsCount)}</td>
                    <td>{item.status || 'Arşivde'}</td>
                    <td className="text-right">
                      <button type="button" className="secondary-button pos-hub-action-btn" onClick={() => openDayEndDetail(item)}>Detay</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Kasa Listesi (8 Kasa) */}
      <section className="pos-hub-tills">
        <h3 className="pos-hub-section-title">Kasa Listesi</h3>
        <div className="pos-hub-tills-grid">
          {DESK_CONFIG.map(({ code, label, isManagement }) => {
            const isAssigned = !isManagement || isAdmin;
            const isOpen = deskActivationStatus?.[code] === true;
            const activeRegisterPin = activeDeskSessions[code]?.registerPin || null;
            const summary = tillSummary(code);
            const totalOps = summary.salesCount + summary.returnCount;
            const isBusy = activationBusyDesk === code;
            return (
              <article key={code} className={`pos-hub-till-card${isAssigned ? '' : ' pos-hub-till-disabled'}${isManagement ? ' pos-hub-till-management' : ''}`}>
                <div className="pos-hub-till-head">
                  <span className="pos-hub-till-name">{label}</span>
                  <span className={`pos-hub-till-badge ${isOpen && isAssigned ? 'pos-hub-till-badge-open' : 'pos-hub-till-badge-closed'}`}>
                    {!isAssigned ? 'Yetkisiz' : isOpen ? 'Açık' : 'Kapalı'}
                  </span>
                </div>
                {isManagement && <small className="pos-hub-till-note">Sadece yönetici erişebilir</small>}
                {isOpen && activeRegisterPin && (
                  <small className="pos-hub-till-note pos-hub-till-register">Sicil {activeRegisterPin} • Aktif</small>
                )}
                <div className="pos-hub-till-body">
                  <span>Bugünkü İşlem</span>
                  <strong>{totalOps}</strong>
                </div>
                <div className="pos-hub-till-body">
                  <span>Net Ciro</span>
                  <strong>{formatPrice(summary.netRevenue)}</strong>
                </div>
                <div className="pos-hub-till-actions">
                  <button
                    type="button"
                    className="pos-hub-till-mini-btn"
                    onClick={() => {
                      if (!isAssigned || isOpen || isBusy) return;
                      navigate(`/kasa?desk=${code}&mode=activate`);
                    }}
                    disabled={!isAssigned || isOpen || isBusy}
                  >
                    Kasa Aç
                  </button>
                  <button
                    type="button"
                    className="pos-hub-till-mini-btn"
                    onClick={async () => {
                      if (!isAssigned || !isOpen || isBusy) return;
                      try {
                        setActivationBusyDesk(code);
                        await posService.setDeskActivation(code, false);
                        clearDeskSession(code);
                        await loadDeskActivationStatus();
                      } finally {
                        setActivationBusyDesk('');
                      }
                    }}
                    disabled={!isAssigned || !isOpen || isBusy}
                  >
                    {isBusy ? 'İşleniyor...' : 'Kapat'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
