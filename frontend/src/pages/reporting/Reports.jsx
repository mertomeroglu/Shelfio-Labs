import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Package, TrendingUp, Activity, FileDown, AlertTriangle, Layers, Truck, ArrowDownUp, RotateCcw, ShieldAlert } from 'lucide-react';
import DataTable from '../../components/DataTable.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Toast from '../../components/Toast.jsx';
import {
  formatCurrency,
  formatDate,
  formatDateOnly,
  formatMovementRouteLabel,
  formatNumber,
  formatReturnReasonLabel,
  formatStorageTypeLabel,
  includesNormalized,
} from '../../services/formatters.js';
import { reportService } from '../../services/reportService.js';
import { productService } from '../../services/productService.js';
import { isRequestCancellation } from '../../services/api.js';

const INITIAL_REPORT = {
  overview: {},
  inventory: [],
  criticalItems: [],
  movementReport: [],
  categoryReport: [],
  supplierReport: [],
  returnReport: [],
  salesReturnReport: [],
  expiryRiskReport: [],
  marginReport: [],
  supplierPerformanceReport: [],
  orderApprovalLeadReport: [],
  goodsReceiptPerformanceReport: [],
  priceCatalogDiffReport: [],
  accessAuditReport: [],
  currency: 'TRY',
};

const INITIAL_FILTERS = {
  startDate: '',
  endDate: '',
};

const INITIAL_SALES_RETURN_FILTERS = {
  productId: '',
  productSearch: '',
  startDate: '',
  endDate: '',
};

const REASON_TONE = {
  pos_sale: 'primary',
  write_off: 'danger',
  customer_return: 'warning',
  product_purchase: 'success',
  supplier_return: 'warning',
  transfer_in: 'neutral',
  transfer_out: 'neutral',
  manual_adjustment: 'warning',
  count_surplus: 'warning',
  count_deficit: 'warning',
};

const TYPE_LABELS = {
  IN: 'Giriş',
  OUT: 'Çıkış',
  ADJUSTMENT: 'Düzeltme',
  TRANSFER: 'Transfer',
};

const RISK_LABELS = {
  critical: 'Kritik',
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük',
  normal: 'Düşük',
};

const EMPTY_DISPLAY_VALUES = new Set(['', '-', 'bilinmiyor', 'unknown', 'undefined', 'null', 'n/a']);

const cleanReportText = (value) => String(value ?? '').trim();

const hasMeaningfulReportText = (value) => {
  const normalized = cleanReportText(value).toLocaleLowerCase('tr-TR');
  return Boolean(normalized && !EMPTY_DISPLAY_VALUES.has(normalized));
};

const normalizeReportCode = (value) => cleanReportText(value)
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const formatCleanReportText = (value, fallback) => (hasMeaningfulReportText(value) ? cleanReportText(value) : fallback);

const isDepotLocation = (value) => {
  const normalized = normalizeReportCode(value);
  return normalized.includes('depo') || normalized.includes('warehouse') || normalized.includes('backroom');
};

const isShelfLocation = (value) => {
  const normalized = normalizeReportCode(value);
  return normalized.includes('reyon') || normalized.includes('shelf') || normalized.includes('raf');
};

const formatMovementReason = (row = {}) => {
  const reasonCode = normalizeReportCode(row.reasonCode || row.reason);
  const type = normalizeReportCode(row.type);
  const note = normalizeReportCode([row.reasonLabel, row.reason, row.note, row.description].filter(Boolean).join(' '));
  const fromLocation = [row.fromLocationLabel, row.fromLocation].filter(Boolean).join(' ');
  const toLocation = [row.toLocationLabel, row.toLocation, row.locationLabel, row.location].filter(Boolean).join(' ');

  if (reasonCode.includes('transfer') || type === 'transfer' || note.includes('transfer')) {
    if (isDepotLocation(fromLocation) && isShelfLocation(toLocation)) return 'Depodan reyona transfer';
    if (isShelfLocation(fromLocation) && isDepotLocation(toLocation)) return 'Reyondan depoya transfer';
    return 'Stok transferi';
  }

  if (reasonCode.includes('pos_sale') || reasonCode.includes('sale') || note.includes('satis') || note.includes('pos_satis')) {
    return 'Satış işlemi';
  }

  if (reasonCode.includes('customer_return') || reasonCode.includes('return') || note.includes('iade')) {
    return 'Müşteri iadesi';
  }

  if (reasonCode.includes('write_off') || reasonCode.includes('imha') || reasonCode.includes('waste') || note.includes('imha') || note.includes('skt')) {
    return 'SKT geçmiş ürün imhası';
  }

  if (reasonCode.includes('product_purchase') || note.includes('mal_kabul') || note.includes('satinalma')) {
    return 'Satın alma / mal kabul';
  }

  if (reasonCode.includes('manual_adjustment') || reasonCode.includes('count_') || type === 'adjustment') {
    return 'Manuel stok düzeltmesi';
  }

  return formatCleanReportText(row.reasonLabel, formatCleanReportText(row.reason, 'Sebep tanımlanmadı'));
};

const RETURN_REASON_DISPLAY_LABELS = {
  automatic_random_return: 'Otomatik iade simülasyonu',
  auto_random_return: 'Otomatik iade simülasyonu',
  random_return: 'Otomatik iade simülasyonu',
  customer_request: 'Müşteri talebi',
  customer_return: 'Müşteri talebi',
  wrong_product: 'Yanlış ürün',
  defective: 'Kusurlu ürün',
  damaged: 'Hasarlı ürün',
  expired: 'Son kullanma tarihi geçmiş',
  customer_changed_mind: 'Müşteri vazgeçti',
  other: 'Diğer',
};

const formatReportReturnReason = (row = {}) => {
  const rawReason = row.returnReason;
  const normalizedReason = normalizeReportCode(rawReason);
  if (RETURN_REASON_DISPLAY_LABELS[normalizedReason]) return RETURN_REASON_DISPLAY_LABELS[normalizedReason];

  const label = cleanReportText(row.returnReasonLabel);
  const normalizedLabel = normalizeReportCode(label);
  if (RETURN_REASON_DISPLAY_LABELS[normalizedLabel]) return RETURN_REASON_DISPLAY_LABELS[normalizedLabel];
  if (hasMeaningfulReportText(label) && !label.includes('_')) return label;

  const formatterLabel = formatReturnReasonLabel(rawReason, '');
  if (hasMeaningfulReportText(formatterLabel) && !formatterLabel.includes('_')) return formatterLabel;

  return 'Diğer';
};

const PDF_FONT_FAMILY = 'Roboto';
const PDF_HEADER_COLOR = [30, 64, 175];
const PDF_BORDER_COLOR = [203, 213, 225];
const PDF_TEXT_COLOR = [15, 23, 42];
const REPORT_ARRAY_KEYS = Object.keys(INITIAL_REPORT).filter((key) => Array.isArray(INITIAL_REPORT[key]));
const REPORT_PAGE_SIZE = 50;
const SECTION_REPORT_KEYS = {
  inventory: 'inventory',
  critical: 'criticalItems',
  expiry: 'expiryRiskReport',
  margin: 'marginReport',
  supplier_performance: 'supplierPerformanceReport',
  category: 'categoryReport',
  supplier: 'supplierReport',
  order_approval_lead: 'orderApprovalLeadReport',
  goods_receipt_performance: 'goodsReceiptPerformanceReport',
  price_catalog_diff: 'priceCatalogDiffReport',
  access_audit: 'accessAuditReport',
  movement: 'movementReport',
  returns: 'returnReport',
  sales_returns: 'salesReturnReport',
};
const SECTION_LOAD_ORDER = [
  'inventory',
  'critical',
  'category',
  'supplier',
  'expiry',
  'margin',
  'supplier_performance',
  'order_approval_lead',
  'goods_receipt_performance',
  'price_catalog_diff',
  'access_audit',
  'movement',
  'returns',
  'sales_returns',
];

const createSectionStates = (status = 'pending') =>
  Object.keys(SECTION_REPORT_KEYS).reduce((states, section) => {
    states[section] = {
      status,
      page: 1,
      pageSize: REPORT_PAGE_SIZE,
      total: 0,
      totalPages: 1,
      durationMs: null,
      error: '',
    };
    return states;
  }, {});

const waitForDeferredSlot = () => new Promise((resolve) => setTimeout(resolve, 140));

const normalizeReportPayload = (payload = {}) => {
  const normalized = { ...payload };
  REPORT_ARRAY_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(normalized, key)) {
      normalized[key] = Array.isArray(normalized[key]) ? normalized[key] : [];
    }
  });
  return normalized;
};

const mergeReportState = (current, payload = {}) => {
  const normalizedPayload = normalizeReportPayload(payload);
  const nextState = { ...current, ...normalizedPayload };

  REPORT_ARRAY_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(normalizedPayload, key)) {
      return;
    }
    nextState[key] = Array.isArray(current[key]) ? current[key] : INITIAL_REPORT[key];
  });

  return nextState;
};

const loadPdfExportModules = async () => {
  const [jspdfModule, autoTableModule, pdfFontsModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  return {
    jsPDF: jspdfModule.jsPDF || jspdfModule.default,
    autoTable: autoTableModule.default || autoTableModule,
    pdfFonts: pdfFontsModule.default || pdfFontsModule,
  };
};

const getPdfVfs = (pdfFonts) => {
  const nestedVfs = pdfFonts?.pdfMake?.vfs || pdfFonts?.vfs || pdfFonts?.default?.pdfMake?.vfs || pdfFonts?.default?.vfs;
  if (nestedVfs && Object.keys(nestedVfs).length > 0) {
    return nestedVfs;
  }

  const rawFontMap = pdfFonts && typeof pdfFonts === 'object' ? pdfFonts : {};
  const directFontEntries = Object.entries(rawFontMap).filter(([key, value]) => key.toLowerCase().endsWith('.ttf') && typeof value === 'string');
  return directFontEntries.length ? Object.fromEntries(directFontEntries) : {};
};

const ensureTurkishPdfFont = (doc, pdfFonts) => {
  const fontList = typeof doc.getFontList === 'function' ? doc.getFontList() : {};
  if (fontList?.[PDF_FONT_FAMILY]) {
    return;
  }

  const vfs = getPdfVfs(pdfFonts);
  const regular = vfs['Roboto-Regular.ttf'];
  const bold = vfs['Roboto-Medium.ttf'] || vfs['Roboto-Bold.ttf'];

  if (!regular || typeof doc.addFileToVFS !== 'function' || typeof doc.addFont !== 'function') {
    return;
  }

  doc.addFileToVFS('Roboto-Regular.ttf', regular);
  doc.addFont('Roboto-Regular.ttf', PDF_FONT_FAMILY, 'normal');

  if (bold) {
    doc.addFileToVFS('Roboto-Bold.ttf', bold);
    doc.addFont('Roboto-Bold.ttf', PDF_FONT_FAMILY, 'bold');
  }
};

const normalizePdfText = (value) => {
  const text = String(value ?? '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
};

export default function Reports() {
  const [report, setReport] = useState(INITIAL_REPORT);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [exportingSection, setExportingSection] = useState('');
  const [toast, setToast] = useState(null);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [activeFilters, setActiveFilters] = useState(INITIAL_FILTERS);
  const [salesReturnFilters, setSalesReturnFilters] = useState(INITIAL_SALES_RETURN_FILTERS);
  const [activeSalesReturnFilters, setActiveSalesReturnFilters] = useState(INITIAL_SALES_RETURN_FILTERS);
  const [productOptions, setProductOptions] = useState([]);
  const [isProductListLoading, setIsProductListLoading] = useState(false);
  const [sectionStates, setSectionStates] = useState(() => createSectionStates('idle'));
  const exportResetTimerRef = useRef(null);
  const requestSequenceRef = useRef(0);
  const activeControllerRef = useRef(null);

  const loadSection = async (section, page = 1, nextFilters = activeFilters, requestId = requestSequenceRef.current, signal = null) => {
    const reportKey = SECTION_REPORT_KEYS[section];
    if (!reportKey) return;

    const startedAt = performance.now();
    setSectionStates((current) => ({
      ...current,
      [section]: {
        ...(current[section] || {}),
        status: 'loading',
        page,
        error: '',
      },
    }));

    try {
      const sectionData = await reportService.getSection(section, {
        page,
        pageSize: REPORT_PAGE_SIZE,
        ...nextFilters,
      }, signal ? { signal } : {});

      if (requestSequenceRef.current !== requestId || signal?.aborted) {
        return;
      }

      const rows = Array.isArray(sectionData?.rows) ? sectionData.rows : [];
      const meta = sectionData?.meta || {};
      setReport((current) => ({
        ...current,
        [reportKey]: rows,
      }));
      setSectionStates((current) => ({
        ...current,
        [section]: {
          ...(current[section] || {}),
          status: 'loaded',
          page: meta.page || page,
          pageSize: meta.pageSize || REPORT_PAGE_SIZE,
          total: meta.total || rows.length,
          totalPages: meta.totalPages || 1,
          durationMs: Math.round(performance.now() - startedAt),
          error: '',
        },
      }));
    } catch (error) {
      if (isRequestCancellation(error) || signal?.aborted) {
        return;
      }
      if (requestSequenceRef.current !== requestId) {
        return;
      }
      setSectionStates((current) => ({
        ...current,
        [section]: {
          ...(current[section] || {}),
          status: 'error',
          durationMs: Math.round(performance.now() - startedAt),
          error: error.message || 'Rapor bölümü yüklenemedi.',
        },
      }));
      setToast({ type: 'error', title: 'Raporlar', message: error.message || 'Rapor bölümü yüklenemedi.' });
    }
  };

  const loadDeferredSections = async (requestId, nextFilters, signal = null) => {
    for (const section of SECTION_LOAD_ORDER) {
      if (requestSequenceRef.current !== requestId || signal?.aborted) {
        return;
      }
      await loadSection(section, 1, nextFilters, requestId, signal);
      await waitForDeferredSlot();
    }
  };

  const loadData = async (nextFilters = activeFilters) => {
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;

    try {
      setIsLoading(true);
      setLoadError('');
      setSectionStates(createSectionStates('pending'));
      setReport(INITIAL_REPORT);
      const summaryData = await reportService.getSummary({ includeDetails: false, ...nextFilters }, { signal: controller.signal });
      if (requestSequenceRef.current !== requestId || controller.signal.aborted) {
        return;
      }
      setReport(mergeReportState(INITIAL_REPORT, summaryData || {}));
      setIsLoading(false);
      loadDeferredSections(requestId, nextFilters, controller.signal);
    } catch (error) {
      if (isRequestCancellation(error) || controller.signal.aborted) {
        if (requestSequenceRef.current === requestId) {
          setIsLoading(false);
        }
        return;
      }
      if (requestSequenceRef.current !== requestId) {
        return;
      }
      setIsLoading(false);
      setLoadError(error.message || 'Rapor verileri yüklenemedi.');
      setSectionStates(createSectionStates('idle'));
      setToast({ type: 'error', title: 'Raporlar', message: error.message || 'Rapor verileri yüklenemedi.' });
    }
  };

  useEffect(() => {
    loadData(activeFilters);
    return () => {
      activeControllerRef.current?.abort();
    };
  }, [activeFilters.startDate, activeFilters.endDate]);

  useEffect(() => {
    let isMounted = true;
    setIsProductListLoading(true);
    productService.list({ fetchAll: true, includeUnlisted: false, includeListDetails: true })
      .then((rows) => {
        if (!isMounted) return;
        setProductOptions(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (!isMounted) return;
        setToast({ type: 'error', title: 'Raporlar', message: error.message || 'Ürün listesi alınamadı.' });
      })
      .finally(() => {
        if (isMounted) setIsProductListLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => () => {
    requestSequenceRef.current += 1;
    if (exportResetTimerRef.current) {
      clearTimeout(exportResetTimerRef.current);
    }
  }, []);

  const handleExportSection = async (section) => {
    if (exportResetTimerRef.current) {
      clearTimeout(exportResetTimerRef.current);
    }

    try {
      setExportingSection(section);
      exportResetTimerRef.current = setTimeout(() => {
        setExportingSection('');
      }, 12000);
      await reportService.downloadSectionXlsx(section, section === 'sales_returns' ? activeSalesReturnFilters : activeFilters);
    } catch (error) {
      setToast({ type: 'error', title: 'Raporlar', message: error.message || 'Excel raporu indirilemedi.' });
    } finally {
      if (exportResetTimerRef.current) {
        clearTimeout(exportResetTimerRef.current);
        exportResetTimerRef.current = null;
      }
      setExportingSection('');
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleSalesReturnFilterChange = (key, value) => {
    setSalesReturnFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === 'productSearch' ? { productId: '' } : {}),
    }));
  };

  const applyFilters = () => {
    if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) {
      setToast({ type: 'error', title: 'Raporlar', message: 'Başlangıç tarihi bitiş tarihinden sonra olamaz.' });
      return;
    }

    setActiveFilters({ ...filters });
  };

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
    setActiveFilters(INITIAL_FILTERS);
  };

  const applySalesReturnFilters = () => {
    if (salesReturnFilters.startDate && salesReturnFilters.endDate && salesReturnFilters.startDate > salesReturnFilters.endDate) {
      setToast({ type: 'error', title: 'Satış ve İade Raporu', message: 'Başlangıç tarihi bitiş tarihinden sonra olamaz.' });
      return;
    }

    const nextFilters = {
      productId: salesReturnFilters.productId,
      startDate: salesReturnFilters.startDate,
      endDate: salesReturnFilters.endDate,
    };
    setActiveSalesReturnFilters({ ...salesReturnFilters, ...nextFilters });
    loadSection('sales_returns', 1, nextFilters);
  };

  const resetSalesReturnFilters = () => {
    setSalesReturnFilters(INITIAL_SALES_RETURN_FILTERS);
    setActiveSalesReturnFilters(INITIAL_SALES_RETURN_FILTERS);
    loadSection('sales_returns', 1, INITIAL_SALES_RETURN_FILTERS);
  };

  const refreshLiveData = () => {
    if (filters.startDate !== activeFilters.startDate || filters.endDate !== activeFilters.endDate) {
      applyFilters();
      return;
    }

    loadData(activeFilters);
  };

  const handleSectionPageChange = (section, nextPage) => {
    const current = sectionStates[section] || {};
    const normalizedPage = Math.min(current.totalPages || 1, Math.max(1, nextPage));
    if (normalizedPage === current.page || current.status === 'loading') {
      return;
    }
    loadSection(section, normalizedPage, section === 'sales_returns' ? activeSalesReturnFilters : activeFilters);
  };

  const renderSectionStatus = (section) => {
    const state = sectionStates[section] || {};
    if (state.status === 'loaded') {
      return (
        <span className="report-section-status">
          {formatNumber(state.total || 0)} kayıt · {state.durationMs ?? 0} ms
        </span>
      );
    }
    if (state.status === 'loading') {
      return <span className="report-section-status">Yükleniyor...</span>;
    }
    if (state.status === 'pending') {
      return <span className="report-section-status">Sırada</span>;
    }
    return null;
  };

  const renderServerPager = (section) => {
    const state = sectionStates[section] || {};
    if (!state.total || state.total <= (state.pageSize || REPORT_PAGE_SIZE)) {
      return null;
    }

    const firstRow = ((state.page || 1) - 1) * (state.pageSize || REPORT_PAGE_SIZE) + 1;
    const lastRow = Math.min((state.page || 1) * (state.pageSize || REPORT_PAGE_SIZE), state.total);

    return (
      <div className="table-pagination report-server-pagination">
        <div className="table-pagination-summary">
          <span>Sayfa {state.page} / {state.totalPages}</span>
          <span className="table-pagination-total">· {firstRow}-{lastRow} / {formatNumber(state.total)} kayıt</span>
        </div>
        <div className="table-pagination-actions">
          <button className="ghost-button" type="button" onClick={() => handleSectionPageChange(section, 1)} disabled={state.page <= 1 || state.status === 'loading'}>İlk</button>
          <button className="ghost-button" type="button" onClick={() => handleSectionPageChange(section, state.page - 1)} disabled={state.page <= 1 || state.status === 'loading'}>Önceki</button>
          <button className="primary-button" type="button" onClick={() => handleSectionPageChange(section, state.page + 1)} disabled={state.page >= state.totalPages || state.status === 'loading'}>Sonraki</button>
          <button className="ghost-button" type="button" onClick={() => handleSectionPageChange(section, state.totalPages)} disabled={state.page >= state.totalPages || state.status === 'loading'}>Son</button>
        </div>
      </div>
    );
  };

  const renderReportTable = (section, columns, rows, emptyMessage, tableProps = {}) => {
    const state = sectionStates[section] || {};
    const isSectionLoading = state.status === 'loading' || state.status === 'pending';
    const safeRows = Array.isArray(rows) ? rows : [];

    return (
      <>
        {state.error ? <div className="alert error">Rapor bölümü alınırken hata oluştu: {state.error}</div> : null}
        <DataTable
          columns={columns}
          rows={safeRows}
          isLoading={isLoading || isSectionLoading}
          emptyMessage={emptyMessage}
          pageSize={REPORT_PAGE_SIZE}
          {...tableProps}
        />
        {renderServerPager(section)}
      </>
    );
  };

  const sanitizePdfValue = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'number') return formatNumber(value);
    if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
    if (Array.isArray(value)) return value.map((item) => sanitizePdfValue(item)).join(', ');
    if (typeof value === 'object') return '-';
    return normalizePdfText(value);
  };

  const buildPdfCellValue = (section, column, row) => {
    if (typeof column.pdfFormatter === 'function') {
      return column.pdfFormatter(row, report.currency);
    }
    if (section === 'inventory' && ['purchasePrice', 'salePrice', 'stockValue'].includes(column.key)) {
      return formatCurrency(row[column.key], report.currency);
    }
    if (section === 'inventory' && ['expiryDate', 'createdAt', 'updatedAt', 'priceUpdatedAt', 'lastPriceChangeAt', 'lastPriceChangeDate'].includes(column.key)) {
      return column.key === 'expiryDate' ? formatDateOnly(row[column.key]) : formatDate(row[column.key]);
    }
    if (section === 'movement' && column.key === 'createdAt') {
      return formatDate(row.createdAt);
    }
    if (section === 'movement' && column.key === 'location') {
      return row.routeLabel || formatMovementRouteLabel(row, '-');
    }
    if (section === 'movement' && column.key === 'type') {
      return TYPE_LABELS[row.type] || row.type || '-';
    }
    if (section === 'movement' && column.key === 'reasonLabel') {
      return formatMovementReason(row);
    }
    if (section === 'returns' && column.key === 'createdAt') {
      return formatDate(row.createdAt);
    }
    if (section === 'returns' && column.key === 'customerName') {
      return formatCleanReportText(row.customerName, 'Müşteri bilgisi yok');
    }
    if (section === 'returns' && column.key === 'customerAddress') {
      return formatCleanReportText(row.customerAddress, 'Adres bilgisi yok');
    }
    if (section === 'returns' && column.key === 'returnReason') {
      return formatReportReturnReason(row);
    }
    if (section === 'returns' && column.key === 'returnReasonDetail') {
      return formatCleanReportText(row.returnReasonDetail, 'Detay girilmedi');
    }
    if (section === 'returns' && column.key === 'productsSummary') {
      return formatCleanReportText(row.productsSummary, 'Ürün bilgisi yok');
    }
    if (section === 'returns' && column.key === 'cashierName') {
      return formatCleanReportText(row.cashierName, 'Kasiyer bilgisi yok');
    }
    if (section === 'critical' && column.key === 'isActive') {
      return row.isActive !== false ? 'Aktif' : 'Pasif';
    }
    if (section === 'expiry' && column.key === 'potentialWriteOffValue') {
      return formatCurrency(row.potentialWriteOffValue, report.currency);
    }
    if (section === 'expiry' && column.key === 'riskLevel') {
      return RISK_LABELS[row.riskLevel] || row.riskLevel || '-';
    }
    if (section === 'margin' && ['purchasePrice', 'salePrice', 'unitMargin', 'stockMarginPotential'].includes(column.key)) {
      return formatCurrency(row[column.key], report.currency);
    }
    if (section === 'supplierPerformance' && column.key === 'riskLevel') {
      return RISK_LABELS[row.riskLevel] || row.riskLevel || '-';
    }
    if (column.key === 'totalValue' || column.key === 'totalAmount' || column.key === 'totalStockValue') {
      return formatCurrency(row[column.key], report.currency);
    }
    if (/(date|tarih|createdAt|updatedAt|expiryDate|skt)/i.test(column.key)) {
      return formatDate(row[column.key]);
    }
    return row[column.key];
  };

  const createSectionPdf = async ({ section, title, rows, columns, filterSummary, orientation = 'landscape' }) => {
    const { jsPDF, autoTable, pdfFonts } = await loadPdfExportModules();
    const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
    ensureTurkishPdfFont(doc, pdfFonts);
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 34;
    const marginY = 30;
    const generatedAt = new Date().toLocaleString('tr-TR');
    const safeRows = Array.isArray(rows) ? rows : [];
    const safeColumns = columns.filter((column) => column?.key && column?.label);
    const head = [safeColumns.map((column) => column.label)];
    const body = safeRows.map((row) => safeColumns.map((column) => sanitizePdfValue(buildPdfCellValue(section, column, row))));
    const metadataText = [
      `Rapor Tarihi: ${generatedAt}`,
      `Toplam Kayıt: ${formatNumber(safeRows.length)}`,
      `Filtre Özeti: ${normalizePdfText(filterSummary || 'Varsayılan görünüm')}`,
    ];

    const drawHeader = () => {
      doc.setFont(PDF_FONT_FAMILY, 'bold');
      doc.setFontSize(15);
      doc.text(title, marginX, marginY);
      doc.setFont(PDF_FONT_FAMILY, 'normal');
      doc.setFontSize(10);
      doc.text(metadataText[0], marginX, marginY + 16);
      doc.text(metadataText[1], marginX + 260, marginY + 16);
      doc.text(metadataText[2], marginX, marginY + 30);
      doc.text(`Sayfa ${doc.internal.getNumberOfPages()}`, pageWidth - marginX, marginY + 16, { align: 'right' });
    };

    if (!body.length) {
      drawHeader();
      doc.setFont(PDF_FONT_FAMILY, 'normal');
      doc.setFontSize(11);
      doc.text('Filtrelere uygun veri bulunamadı.', marginX, marginY + 58);
      return doc;
    }

    doc.setFont(PDF_FONT_FAMILY, 'normal');
    doc.setCharSpace(0);

    const columnStyles = safeColumns.reduce((styles, column, index) => {
      styles[index] = {
        minCellWidth: Number(column.minWidth || 58),
        cellWidth: column.width || 'auto',
      };
      return styles;
    }, {});

    autoTable(doc, {
      startY: marginY + 44,
      head,
      body,
      theme: 'striped',
      showHead: 'everyPage',
      tableWidth: 'auto',
      horizontalPageBreak: true,
      horizontalPageBreakRepeat: 0,
      rowPageBreak: 'avoid',
      margin: { left: marginX, right: marginX, top: marginY + 44, bottom: 28 },
      styles: {
        font: PDF_FONT_FAMILY,
        fontSize: 10,
        cellPadding: { top: 8, right: 10, bottom: 8, left: 10 },
        lineHeight: 1.35,
        valign: 'middle',
        overflow: 'linebreak',
        textColor: PDF_TEXT_COLOR,
        lineColor: PDF_BORDER_COLOR,
        lineWidth: 0.6,
        cellWidth: 'auto',
      },
      headStyles: {
        fillColor: PDF_HEADER_COLOR,
        textColor: 255,
        fontStyle: 'bold',
        halign: 'left',
        valign: 'middle',
        minCellHeight: 26,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      bodyStyles: {
        fillColor: [255, 255, 255],
      },
      columnStyles,
      didParseCell: (data) => {
        if (data.section === 'body' && typeof data.cell.raw === 'string') {
          data.cell.text = [normalizePdfText(data.cell.raw) || '-'];
        }
      },
      didDrawPage: () => {
        drawHeader();
      },
    });

    return doc;
  };

  const renderExportActions = (section) => (
    <div className="report-export-actions">
      <button className="ghost-button report-export-button" type="button" onClick={() => handleExportSection(section)} disabled={isLoading || exportingSection === section}>
        <FileDown size={14} /> {exportingSection === section ? 'İndiriliyor...' : 'Excel İndir'}
      </button>
    </div>
  );

  const filteredProductOptions = useMemo(() => {
    const search = String(salesReturnFilters.productSearch || '').trim();
    const normalizedProducts = (Array.isArray(productOptions) ? productOptions : []).map((product) => ({
      id: product.productId || product.id,
      name: product.productName || product.name || '-',
      sku: product.sku || '',
      barcode: product.barcode || '',
    })).filter((product) => product.id);

    if (!search) return normalizedProducts.slice(0, 120);
    return normalizedProducts
      .filter((product) => (
        includesNormalized(product.name, search)
        || includesNormalized(product.sku, search)
        || includesNormalized(product.barcode, search)
      ))
      .slice(0, 120);
  }, [productOptions, salesReturnFilters.productSearch]);

  const selectedSalesReturnProduct = useMemo(() => (
    (Array.isArray(productOptions) ? productOptions : []).find((product) => String(product.productId || product.id) === String(activeSalesReturnFilters.productId)) || null
  ), [productOptions, activeSalesReturnFilters.productId]);

  const salesReturnSummary = useMemo(() => (
    (Array.isArray(report.salesReturnReport) ? report.salesReturnReport : []).reduce((summary, row) => ({
      soldQty: summary.soldQty + Number(row.soldQty || 0),
      salesAmount: summary.salesAmount + Number(row.salesAmount || 0),
      returnQty: summary.returnQty + Number(row.returnQty || 0),
      returnAmount: summary.returnAmount + Number(row.returnAmount || 0),
      netQty: summary.netQty + Number(row.netQty || 0),
      netAmount: summary.netAmount + Number(row.netAmount || 0),
    }), {
      soldQty: 0,
      salesAmount: 0,
      returnQty: 0,
      returnAmount: 0,
      netQty: 0,
      netAmount: 0,
    })
  ), [report.salesReturnReport]);

  const salesReturnEmptyMessage = activeSalesReturnFilters.productId
    ? 'Bu ürün için satış veya iade kaydı bulunamadı.'
    : 'Satış ve iade raporu için kayıt bulunmuyor.';

  const inventoryColumns = [
    { key: 'productId', label: 'ID' },
    { key: 'productName', label: 'Ürün Adı' },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Barkod' },
    { key: 'categoryId', label: 'Kategori ID' },
    { key: 'categoryName', label: 'Kategori Adı' },
    { key: 'categoryCode', label: 'Kategori Kodu' },
    { key: 'supplierId', label: 'Tedarikçi ID' },
    { key: 'supplierName', label: 'Tedarikçi Adı' },
    { key: 'purchasePrice', label: 'Alış Fiyatı', render: (row) => formatCurrency(row.purchasePrice, report.currency), sortValue: (row) => row.purchasePrice },
    { key: 'salePrice', label: 'Satış Fiyatı', render: (row) => formatCurrency(row.salePrice, report.currency), sortValue: (row) => row.salePrice },
    { key: 'unit', label: 'Birim' },
    { key: 'criticalStock', label: 'Kritik Stok' },
    { key: 'maxStock', label: 'Maks. Stok' },
    { key: 'totalStock', label: 'Toplam Stok' },
    { key: 'warehouseStock', label: 'Depo Stok' },
    { key: 'shelfStock', label: 'Reyon Stok' },
    { key: 'expiryDate', label: 'Son Kullanma Tarihi', render: (row) => formatDateOnly(row.expiryDate) },
    { key: 'sectionId', label: 'Reyon ID' },
    { key: 'sectionName', label: 'Reyon Adı' },
    { key: 'sectionNumber', label: 'Reyon No' },
    { key: 'shelfSide', label: 'Raf Tarafı' },
    { key: 'shelfNo', label: 'Raf No' },
    { key: 'shelfLevel', label: 'Raf Seviyesi' },
    { key: 'shelfCode', label: 'Raf Kodu' },
    { key: 'isActive', label: 'Durum', render: (row) => <StatusBadge tone={row.isActive !== false ? 'success' : 'danger'}>{row.isActive !== false ? 'Aktif' : 'Pasif'}</StatusBadge>, sortable: false },
    { key: 'linkedSupplierCount', label: 'Bağlı Tedarikçi Sayısı' },
    { key: 'eslLinkedCount', label: 'Bağlı ESL Sayısı' },
    { key: 'supplierMappings', label: 'Tedarikçi Eşleşmeleri', render: (row) => Array.isArray(row.supplierMappings) ? row.supplierMappings.length : 0 },
    { key: 'linkedEslDevices', label: 'Bağlı ESL Cihazları', render: (row) => Array.isArray(row.linkedEslDevices) ? row.linkedEslDevices.length : 0 },
    { key: 'stockValue', label: 'Stok Değeri', render: (row) => formatCurrency(row.stockValue, report.currency), sortValue: (row) => row.stockValue },
    { key: 'createdAt', label: 'Oluşturulma Tarihi', render: (row) => formatDate(row.createdAt), sortValue: (row) => new Date(row.createdAt).getTime() },
    { key: 'updatedAt', label: 'Güncellenme Tarihi', render: (row) => formatDate(row.updatedAt), sortValue: (row) => new Date(row.updatedAt).getTime() },
    { key: 'lastPriceChangeAt', label: 'FDT', render: (row) => formatDate(row.lastPriceChangeAt || row.lastPriceChangeDate), sortValue: (row) => row.lastPriceChangeAt || row.lastPriceChangeDate ? new Date(row.lastPriceChangeAt || row.lastPriceChangeDate).getTime() : 0 },
    { key: 'batchSummary', label: 'Parti No', render: (row) => row.batchSummary || row.batchNo1 || '-' },
    { key: 'storageTypeLabel', label: 'Saklama Tipi', render: (row) => row.storageTypeLabel || formatStorageTypeLabel(row.storageType || row.requiredStorageType) },
  ];

  const movementColumns = [
    { key: 'referenceNo', label: 'Ref' },
    { key: 'productName', label: 'Ürün' },
    { key: 'type', label: 'Tip', render: (row) => <StatusBadge tone={row.type === 'IN' ? 'success' : row.type === 'OUT' ? 'danger' : row.type === 'TRANSFER' ? 'primary' : 'warning'}>{TYPE_LABELS[row.type] || row.type}</StatusBadge>, sortable: false },
    { key: 'reasonLabel', label: 'Sebep', render: (row) => <StatusBadge tone={REASON_TONE[row.reasonCode] || 'neutral'}>{formatMovementReason(row)}</StatusBadge>, sortable: false },
    { key: 'location', label: 'Konum', render: (row) => row.routeLabel || formatMovementRouteLabel(row, '-'), sortable: false },
    { key: 'qty', label: 'Miktar' },
    { key: 'previousQuantity', label: 'Önceki' },
    { key: 'nextQuantity', label: 'Sonraki' },
    { key: 'userName', label: 'Kullanıcı' },
    { key: 'createdAt', label: 'Tarih', render: (row) => formatDate(row.createdAt), sortValue: (row) => new Date(row.createdAt).getTime() },
  ];

  const categoryColumns = [
    { key: 'name', label: 'Kategori' },
    { key: 'productCount', label: 'Ürün Çeşidi Sayısı' },
    { key: 'totalQuantity', label: 'Toplam Stok' },
    { key: 'totalValue', label: 'Stok Değeri', render: (row) => formatCurrency(row.totalValue, report.currency), sortValue: (row) => row.totalValue },
  ];

  const supplierColumns = [
    { key: 'name', label: 'Tedarikçi' },
    { key: 'productCount', label: 'Ürün Çeşidi Sayısı' },
    { key: 'totalQuantity', label: 'Toplam Stok' },
    { key: 'totalValue', label: 'Stok Değeri', render: (row) => formatCurrency(row.totalValue, report.currency), sortValue: (row) => row.totalValue },
  ];

  const expiryRiskColumns = [
    { key: 'sku', label: 'SKU' },
    { key: 'productName', label: 'Ürün' },
    { key: 'categoryName', label: 'Kategori' },
    { key: 'totalStock', label: 'Stok' },
    { key: 'expiryDate', label: 'SKT' },
    { key: 'daysToExpiry', label: 'Kalan Gün' },
    {
      key: 'riskLevel',
      label: 'Risk',
      render: (row) => (
        <StatusBadge tone={row.riskLevel === 'critical' ? 'danger' : row.riskLevel === 'high' ? 'warning' : row.riskLevel === 'medium' ? 'primary' : 'success'}>
          {RISK_LABELS[row.riskLevel] || row.riskLevel || '-'}
        </StatusBadge>
      ),
      sortable: false,
    },
    { key: 'potentialWriteOffValue', label: 'Potansiyel Zayi', render: (row) => formatCurrency(row.potentialWriteOffValue, report.currency), sortValue: (row) => row.potentialWriteOffValue },
  ];

  const marginColumns = [
    { key: 'sku', label: 'SKU' },
    { key: 'productName', label: 'Ürün' },
    { key: 'categoryName', label: 'Kategori' },
    { key: 'supplierName', label: 'Tedarikçi' },
    { key: 'purchasePrice', label: 'Alış', render: (row) => formatCurrency(row.purchasePrice, report.currency), sortValue: (row) => row.purchasePrice },
    { key: 'salePrice', label: 'Satış', render: (row) => formatCurrency(row.salePrice, report.currency), sortValue: (row) => row.salePrice },
    { key: 'unitMargin', label: 'Birim Marj', render: (row) => formatCurrency(row.unitMargin, report.currency), sortValue: (row) => row.unitMargin },
    { key: 'marginPct', label: 'Marj %' },
    { key: 'categoryAvgMarginPct', label: 'Kategori Ort. Marj %' },
    { key: 'erosionPct', label: 'Erozyon %' },
    {
      key: 'erosionRisk',
      label: 'Erozyon Riski',
      render: (row) => <StatusBadge tone={row.erosionRisk === 'high' ? 'danger' : row.erosionRisk === 'medium' ? 'warning' : 'success'}>{RISK_LABELS[row.erosionRisk] || row.erosionRisk || '-'}</StatusBadge>,
      sortable: false,
    },
    { key: 'stockMarginPotential', label: 'Stok Marj Pot.', render: (row) => formatCurrency(row.stockMarginPotential, report.currency), sortValue: (row) => row.stockMarginPotential },
  ];

  const supplierPerformanceColumns = [
    { key: 'supplierName', label: 'Tedarikçi' },
    { key: 'productCount', label: 'Ürün Çeşidi' },
    { key: 'activeProductCount', label: 'Aktif Ürün' },
    { key: 'criticalProductCount', label: 'Kritik Ürün' },
    { key: 'totalStock', label: 'Toplam Stok' },
    { key: 'totalStockValue', label: 'Stok Değeri', render: (row) => formatCurrency(row.totalStockValue, report.currency), sortValue: (row) => row.totalStockValue },
    { key: 'avgMarginPct', label: 'Ort. Marj %' },
    { key: 'orderCount', label: 'Sipariş' },
    { key: 'delayedOrderCount', label: 'Geciken Sipariş' },
    { key: 'onTimeScore', label: 'Zamanında Teslim Skoru' },
    { key: 'supplierScore', label: 'Tedarikçi Skoru' },
    {
      key: 'riskLevel',
      label: 'Risk',
      render: (row) => <StatusBadge tone={row.riskLevel === 'high' ? 'danger' : row.riskLevel === 'medium' ? 'warning' : 'success'}>{RISK_LABELS[row.riskLevel] || row.riskLevel || '-'}</StatusBadge>,
      sortable: false,
    },
  ];

  const orderApprovalLeadColumns = [
    { key: 'orderNumber', label: 'Sipariş No' },
    { key: 'supplierName', label: 'Tedarikçi' },
    { key: 'onayaDusmeSuresi', label: 'Onaya Düşme Süresi' },
    { key: 'onaylanmaSuresi', label: 'Onaylanma Süresi' },
    { key: 'tedarikciyeIletimSuresi', label: 'Tedarikçiye İletim Süresi' },
    { key: 'depoyaUlasmaSuresi', label: 'Depoya Ulaşma Süresi' },
    { key: 'currentStatus', label: 'Durum' },
    { key: 'createdAt', label: 'Tarih', render: (row) => formatDate(row.createdAt), sortValue: (row) => new Date(row.createdAt).getTime() },
  ];

  const goodsReceiptPerformanceColumns = [
    { key: 'productName', label: 'Ürün' },
    { key: 'bekleyenGirisSayisi', label: 'Bekleyen Giriş' },
    { key: 'ortalamaGirisTamamlamaSaati', label: 'Ort. Tamamlama (Saat)' },
    { key: 'urunBazliGirisYogunlugu', label: 'Ürün Bazlı Giriş Yoğunluğu' },
    { key: 'gecikenGirisSayisi', label: 'Geciken Giriş' },
    { key: 'genelBekleyenGirisSayisi', label: 'Genel Bekleyen Giriş' },
    { key: 'genelOrtalamaGirisTamamlamaSaati', label: 'Genel Ort. Tamamlama (Saat)' },
    { key: 'genelGecikenGirisSayisi', label: 'Genel Geciken Giriş' },
  ];

  const priceCatalogDiffColumns = [
    { key: 'supplierName', label: 'Tedarikçi' },
    { key: 'zamGelenUrunSayisi', label: 'Zam Gelen Ürün' },
    { key: 'indirimeGirenUrunSayisi', label: 'İndirime Giren Ürün' },
    { key: 'yeniUrunSayisi', label: 'Yeni Ürün' },
    { key: 'kaldirilanUrunSayisi', label: 'Kaldırılan Ürün' },
    { key: 'karsilastirilanKayitSayisi', label: 'Karşılaştırılan Kayıt' },
    { key: 'tedarikciBazliFiyatDegisimOrani', label: 'Fiyat Değişim Oranı (%)' },
  ];

  const auditMetricColumns = [
    { key: 'kategori', label: 'Kategori' },
    { key: 'metrik', label: 'Metrik' },
    { key: 'deger', label: 'Değer' },
    { key: 'detay', label: 'Detay' },
  ];

  const returnColumns = [
    { key: 'referenceNo', label: 'İade Ref' },
    { key: 'originalSaleRef', label: 'Orijinal Fiş' },
    { key: 'customerName', label: 'Müşteri', render: (row) => formatCleanReportText(row.customerName, 'Müşteri bilgisi yok') },
    { key: 'customerAddress', label: 'Adres', render: (row) => formatCleanReportText(row.customerAddress, 'Adres bilgisi yok') },
    {
      key: 'returnReason',
      label: 'İade Nedeni',
      render: (row) => <StatusBadge tone={normalizeReportCode(row.returnReason) === 'other' ? 'warning' : 'neutral'}>{formatReportReturnReason(row)}</StatusBadge>,
      sortable: false,
    },
    { key: 'returnReasonDetail', label: 'Detay', render: (row) => formatCleanReportText(row.returnReasonDetail, 'Detay girilmedi') },
    { key: 'productsSummary', label: 'Ürün(ler)', render: (row) => formatCleanReportText(row.productsSummary, 'Ürün bilgisi yok') },
    { key: 'itemCount', label: 'Adet' },
    { key: 'totalAmount', label: 'Toplam Tutar', render: (row) => formatCurrency(row.totalAmount, report.currency), sortValue: (row) => row.totalAmount },
    { key: 'cashierName', label: 'Kasiyer', render: (row) => formatCleanReportText(row.cashierName, 'Kasiyer bilgisi yok') },
    { key: 'createdAt', label: 'Tarih', render: (row) => formatDate(row.createdAt), sortValue: (row) => new Date(row.createdAt).getTime() },
  ];

  const salesReturnColumns = [
    { key: 'date', label: 'Tarih', render: (row) => formatDateOnly(row.date), sortValue: (row) => new Date(row.date).getTime() },
    { key: 'productName', label: 'Ürün Adı' },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Barkod' },
    { key: 'soldQty', label: 'Toplam Satış Adedi' },
    { key: 'salesAmount', label: 'Toplam Satış Tutarı', render: (row) => formatCurrency(row.salesAmount, report.currency), sortValue: (row) => row.salesAmount },
    { key: 'returnQty', label: 'Toplam İade Adedi' },
    { key: 'returnAmount', label: 'Toplam İade Tutarı', render: (row) => formatCurrency(row.returnAmount, report.currency), sortValue: (row) => row.returnAmount },
    { key: 'netQty', label: 'Net Satış Adedi' },
    { key: 'netAmount', label: 'Net Satış Tutarı', render: (row) => formatCurrency(row.netAmount, report.currency), sortValue: (row) => row.netAmount },
    { key: 'saleRefs', label: 'Satış Ref.' },
    { key: 'returnRefs', label: 'İade Ref.' },
    { key: 'customerRefs', label: 'Müşteri/Sipariş Ref.' },
  ];

  return (
    <div className="page-stack reports-page">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageHeader className="dashboard-hero" icon={<BarChart3 size={22} />} title="Raporlar" description="Stok ve operasyon verilerini analiz edin." />
      {loadError ? <div className="alert error">Rapor verileri alınırken hata oluştu: {loadError}</div> : null}

      <div className="mod-card reports-filter-card">
        <div className="mod-card-header report-card-header">
          <div className="mod-card-icon mod-icon-indigo"><Activity size={18} /></div>
          <div className="reports-filter-heading">
            <h3>Güncel Veriyle Hesaplama</h3>
            <p>Seçili tarih aralığındaki raporlar, güncel sistem verileri üzerinden yeniden hesaplanır.</p>
          </div>
        </div>
        <div className="reports-filter-grid">
          <div className="reports-filter-fields">
            <label className="field-group reports-filter-field">
              <span>Başlangıç Tarihi</span>
              <input type="date" value={filters.startDate} onChange={(event) => handleFilterChange('startDate', event.target.value)} />
            </label>
            <label className="field-group reports-filter-field">
              <span>Bitiş Tarihi</span>
              <input type="date" value={filters.endDate} onChange={(event) => handleFilterChange('endDate', event.target.value)} />
            </label>
          </div>
          <div className="reports-filter-actions">
            <span className="reports-filter-meta-text">Son hesaplama: {formatDate(report.generatedAt)}</span>
            <button className="primary-button" type="button" onClick={applyFilters} disabled={isLoading}>Filtreyi Uygula</button>
            <button className="ghost-button" type="button" onClick={resetFilters} disabled={isLoading && !activeFilters.startDate && !activeFilters.endDate}>Temizle</button>
            <button className="ghost-button" type="button" onClick={refreshLiveData} disabled={isLoading}>Verileri Yenile</button>
          </div>
        </div>
        {false ? <div className="reports-filter-footnote">
          <span className="reports-filter-meta-chip">Aktif aralık: {activeFilters.startDate || activeFilters.endDate ? `${activeFilters.startDate || '...'} - ${activeFilters.endDate || '...'}` : 'Tüm veri'}</span>
          <span className="reports-filter-meta-chip">Son hesaplama: {formatDate(report.generatedAt)}</span>
        </div> : null}
      </div>


      <div className="report-grid">
        <div className="mod-card">
          <div className="mod-card-header report-card-header">
            <div className="mod-card-icon mod-icon-blue"><Package size={18} /></div>
            <div><h3>Ürün Raporu</h3><p>Stok, fiyat ve durum bilgileri</p>{renderSectionStatus('inventory')}</div>
            {renderExportActions('inventory')}
          </div>
          <div className="report-table-scroll report-table-scroll-wide">
            {renderReportTable('inventory', inventoryColumns, report.inventory, 'Ürün raporu bulunmuyor.', { keyField: 'productId' })}
          </div>
        </div>
        <div className="mod-card">
          <div className="mod-card-header report-card-header">
            <div className="mod-card-icon mod-icon-rose"><AlertTriangle size={18} /></div>
            <div><h3>Kritik Stok Raporu</h3><p>Eşik altındaki ürünler</p>{renderSectionStatus('critical')}</div>
            {renderExportActions('critical')}
          </div>
          <div className="report-table-scroll">
            {renderReportTable('critical', inventoryColumns, report.criticalItems, 'Kritik ürün bulunmuyor.', { keyField: 'productId' })}
          </div>
        </div>
      </div>

      <div className="report-grid">
        <div className="mod-card">
          <div className="mod-card-header report-card-header">
            <div className="mod-card-icon mod-icon-rose"><AlertTriangle size={18} /></div>
            <div><h3>SKT Risk Raporu</h3><p>Son kullanma tarihine göre riskli ürünler</p>{renderSectionStatus('expiry')}</div>
            {renderExportActions('expiry')}
          </div>
          <div className="report-table-scroll">
            {renderReportTable('expiry', expiryRiskColumns, report.expiryRiskReport, 'SKT risk raporu bulunmuyor.', { keyField: 'productId' })}
          </div>
        </div>
      </div>

      <div className="report-grid">
        <div className="mod-card">
          <div className="mod-card-header report-card-header">
            <div className="mod-card-icon mod-icon-amber"><TrendingUp size={18} /></div>
            <div><h3>Kar Marj ve Erozyon Raporu</h3><p>Marj kaybı ve karlılık riski analizi</p>{renderSectionStatus('margin')}</div>
            {renderExportActions('margin')}
          </div>
          <div className="report-table-scroll">
            {renderReportTable('margin', marginColumns, report.marginReport, 'Marj raporu bulunmuyor.', { keyField: 'productId' })}
          </div>
        </div>

        <div className="mod-card">
          <div className="mod-card-header report-card-header">
            <div className="mod-card-icon mod-icon-green"><Truck size={18} /></div>
            <div><h3>Tedarikçi Performans Skor Kartı</h3><p>Tedarikçi kalite ve risk puanlaması</p>{renderSectionStatus('supplier_performance')}</div>
            {renderExportActions('supplier_performance')}
          </div>
          <div className="report-table-scroll">
            {renderReportTable('supplier_performance', supplierPerformanceColumns, report.supplierPerformanceReport, 'Tedarikçi performans raporu bulunmuyor.', { keyField: 'supplierId' })}
          </div>
        </div>
      </div>

      <div className="report-grid">
        <div className="mod-card">
          <div className="mod-card-header report-card-header">
            <div className="mod-card-icon mod-icon-amber"><Layers size={18} /></div>
            <div><h3>Kategori Bazlı Rapor</h3><p>Kategoriye göre hacim ve değer</p>{renderSectionStatus('category')}</div>
            {renderExportActions('category')}
          </div>
          <div className="report-table-scroll">
            {renderReportTable('category', categoryColumns, report.categoryReport, 'Kategori raporu bulunmuyor.')}
          </div>
        </div>
        <div className="mod-card">
          <div className="mod-card-header report-card-header">
            <div className="mod-card-icon mod-icon-green"><Truck size={18} /></div>
            <div><h3>Tedarikçi Bazlı Rapor</h3><p>Tedarikçilere göre stok yoğunluğu</p>{renderSectionStatus('supplier')}</div>
            {renderExportActions('supplier')}
          </div>
          <div className="report-table-scroll">
            {renderReportTable('supplier', supplierColumns, report.supplierReport, 'Tedarikçi raporu bulunmuyor.')}
          </div>
        </div>
      </div>

      <div className="report-grid">
        <div className="mod-card">
          <div className="mod-card-header report-card-header">
            <div className="mod-card-icon mod-icon-indigo"><Activity size={18} /></div>
            <div><h3>Sipariş Onay Süreleri Raporu</h3><p>Onay ve operasyon akış süresi metrikleri</p>{renderSectionStatus('order_approval_lead')}</div>
            {renderExportActions('order_approval_lead')}
          </div>
          <div className="report-table-scroll">
            {renderReportTable('order_approval_lead', orderApprovalLeadColumns, report.orderApprovalLeadReport, 'Sipariş onay süreleri raporu bulunmuyor.', { keyField: 'orderId', initialSort: { key: 'createdAt', direction: 'desc' } })}
          </div>
        </div>
        <div className="mod-card">
          <div className="mod-card-header report-card-header">
            <div className="mod-card-icon mod-icon-blue"><Package size={18} /></div>
            <div><h3>Mal Kabul ve Giriş Performans Raporu</h3><p>Bekleyen giriş, tamamlama süresi ve yoğunluk analizi</p>{renderSectionStatus('goods_receipt_performance')}</div>
            {renderExportActions('goods_receipt_performance')}
          </div>
          <div className="report-table-scroll">
            {renderReportTable('goods_receipt_performance', goodsReceiptPerformanceColumns, report.goodsReceiptPerformanceReport, 'Mal kabul performans raporu bulunmuyor.', { keyField: 'productId' })}
          </div>
        </div>
      </div>

      <div className="report-grid">
        <div className="mod-card">
          <div className="mod-card-header report-card-header">
            <div className="mod-card-icon mod-icon-amber"><TrendingUp size={18} /></div>
            <div><h3>Fiyat Değişim ve Katalog Fark Raporu</h3><p>Katalog farkları ve tedarikçi bazlı fiyat değişim oranları</p>{renderSectionStatus('price_catalog_diff')}</div>
            {renderExportActions('price_catalog_diff')}
          </div>
          <div className="report-table-scroll">
            {renderReportTable('price_catalog_diff', priceCatalogDiffColumns, report.priceCatalogDiffReport, 'Fiyat değişim raporu bulunmuyor.', { keyField: 'supplierId' })}
          </div>
        </div>
        <div className="mod-card">
          <div className="mod-card-header report-card-header">
            <div className="mod-card-icon mod-icon-rose"><ShieldAlert size={18} /></div>
            <div><h3>Erişim ve İşlem Denetim Raporu</h3><p>Audit log, erişim talepleri ve işlem yoğunluğu metrikleri</p>{renderSectionStatus('access_audit')}</div>
            {renderExportActions('access_audit')}
          </div>
          <div className="report-table-scroll">
            {renderReportTable('access_audit', auditMetricColumns, report.accessAuditReport, 'Erişim denetim raporu bulunmuyor.')}
          </div>
        </div>
      </div>

      <div className="mod-card">
        <div className="mod-card-header report-card-header">
          <div className="mod-card-icon mod-icon-indigo"><ArrowDownUp size={18} /></div>
          <div><h3>Stok Hareket Raporu</h3><p>Tarih aralığı ve tipe göre filtrelenmiş hareketler</p>{renderSectionStatus('movement')}</div>
          {renderExportActions('movement')}
        </div>
        <div className="report-table-scroll report-table-scroll-tall">
          {renderReportTable('movement', movementColumns, report.movementReport, 'Hareket raporu bulunmuyor.', { initialSort: { key: 'createdAt', direction: 'desc' } })}
        </div>
      </div>

      <div className="mod-card sales-return-report-card">
        <div className="mod-card-header report-card-header">
          <div className="mod-card-icon mod-icon-green"><TrendingUp size={18} /></div>
          <div><h3>Satış ve İade Raporu</h3><p>Ürün, tarih ve işlem referansı bazında gerçek satış/iade özeti</p>{renderSectionStatus('sales_returns')}</div>
          {renderExportActions('sales_returns')}
        </div>

        <div className="sales-return-filter-grid">
          <label className="field-group reports-filter-field">
            <span>Ürün Ara</span>
            <input
              type="search"
              value={salesReturnFilters.productSearch}
              onChange={(event) => handleSalesReturnFilterChange('productSearch', event.target.value)}
              placeholder="Ürün adı, SKU veya barkod"
            />
          </label>
          <label className="field-group reports-filter-field">
            <span>Ürün Seç</span>
            <select value={salesReturnFilters.productId} onChange={(event) => handleSalesReturnFilterChange('productId', event.target.value)} disabled={isProductListLoading}>
              <option value="">Genel toplamlar</option>
              {filteredProductOptions.map((product) => (
                <option key={product.id} value={product.id}>{product.name} {product.sku ? `- ${product.sku}` : ''} {product.barcode ? `- ${product.barcode}` : ''}</option>
              ))}
            </select>
          </label>
          <label className="field-group reports-filter-field">
            <span>Başlangıç Tarihi</span>
            <input type="date" value={salesReturnFilters.startDate} onChange={(event) => handleSalesReturnFilterChange('startDate', event.target.value)} />
          </label>
          <label className="field-group reports-filter-field">
            <span>Bitiş Tarihi</span>
            <input type="date" value={salesReturnFilters.endDate} onChange={(event) => handleSalesReturnFilterChange('endDate', event.target.value)} />
          </label>
          <div className="sales-return-filter-actions">
            <button className="primary-button" type="button" onClick={applySalesReturnFilters} disabled={sectionStates.sales_returns?.status === 'loading'}>Raporu Getir</button>
            <button className="ghost-button" type="button" onClick={resetSalesReturnFilters} disabled={sectionStates.sales_returns?.status === 'loading'}>Temizle</button>
          </div>
        </div>

        <div className="report-summary-grid sales-return-summary-grid">
          <div className="report-summary-card"><span>Ürün</span><strong>{selectedSalesReturnProduct ? (selectedSalesReturnProduct.productName || selectedSalesReturnProduct.name) : 'Genel Toplam'}</strong></div>
          <div className="report-summary-card"><span>Toplam Satış Adedi</span><strong>{formatNumber(salesReturnSummary.soldQty)}</strong></div>
          <div className="report-summary-card"><span>Toplam Satış Tutarı</span><strong>{formatCurrency(salesReturnSummary.salesAmount, report.currency)}</strong></div>
          <div className="report-summary-card"><span>Toplam İade Adedi</span><strong>{formatNumber(salesReturnSummary.returnQty)}</strong></div>
          <div className="report-summary-card"><span>Toplam İade Tutarı</span><strong>{formatCurrency(salesReturnSummary.returnAmount, report.currency)}</strong></div>
          <div className="report-summary-card"><span>Net Satış Adedi</span><strong>{formatNumber(salesReturnSummary.netQty)}</strong></div>
          <div className="report-summary-card"><span>Net Satış Tutarı</span><strong>{formatCurrency(salesReturnSummary.netAmount, report.currency)}</strong></div>
        </div>

        {activeSalesReturnFilters.productId && salesReturnSummary.soldQty <= 0 ? <div className="alert warning">Bu ürün için satış kaydı bulunamadı.</div> : null}
        {activeSalesReturnFilters.productId && salesReturnSummary.returnQty <= 0 ? <div className="alert warning">Bu ürün için iade kaydı bulunamadı.</div> : null}

        <div className="report-table-scroll report-table-scroll-tall">
          {renderReportTable('sales_returns', salesReturnColumns, report.salesReturnReport, salesReturnEmptyMessage, { initialSort: { key: 'date', direction: 'desc' } })}
        </div>
      </div>

      <div className="mod-card">
        <div className="mod-card-header report-card-header">
          <div className="mod-card-icon mod-icon-amber"><RotateCcw size={18} /></div>
          <div><h3>İade Raporu</h3><p>İade sebebi, müşteri ve ürün detayları</p>{renderSectionStatus('returns')}</div>
          {renderExportActions('returns')}
        </div>
        <div className="report-table-scroll report-table-scroll-tall">
          {renderReportTable('returns', returnColumns, report.returnReport, 'İade raporu bulunmuyor.', { initialSort: { key: 'createdAt', direction: 'desc' } })}
        </div>
      </div>

    </div>
  );
}
