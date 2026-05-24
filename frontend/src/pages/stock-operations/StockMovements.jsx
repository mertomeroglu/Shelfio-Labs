import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './StockOperations.css';
import { Boxes, Package, AlertTriangle, Activity, ArrowDownUp, ArrowRightLeft, TrendingUp, TrendingDown, RefreshCw, Filter, Trash2, ScanBarcode, Camera, CameraOff, CheckCircle2 } from 'lucide-react';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import DataTable from '../../components/DataTable.jsx';
import FilterBar from '../../components/FilterBar.jsx';
import FormModal from '../../components/FormModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import ProductSearchInput from '../../components/ProductSearchInput.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Toast from '../../components/Toast.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { formatCurrency, formatDate, formatDepotLocationLabel, formatMovementRouteLabel, formatNumber, formatStockLocationLabel, formatStorageTypeLabel, formatUnit } from '../../services/formatters.js';
import { procurementService } from '../../services/procurementService.js';
import { getPurchaseOrderStatusLabel, normalizePurchaseOrderStatus } from '../../utils/purchaseOrderLifecycle.js';
import { productService } from '../../services/productService.js';
import { sectionService } from '../../services/sectionService.js';
import { supplierService } from '../../services/supplierService.js';
import { stockService } from '../../services/stockService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { CAMERA_PERMISSION_HELP_TEXT, getCameraErrorMessage, logCameraError, startHtml5Scanner, waitForCameraElement } from '../../utils/cameraAccess.js';
import {
  buildInventoryCountArchive,
  createInventoryCountRecord,
  readInventoryCountArchive,
  resolveInventoryCountDifferenceTone,
  writeInventoryCountArchive,
} from '../../utils/inventoryCounting.js';

const loadHtml5Qrcode = async () => {
  const mod = await import('html5-qrcode');
  return mod.Html5Qrcode;
};

const baseMovementForm = {
  productId: '',
  qty: '',
  targetQuantity: '',
  location: 'depo',
  reasonCode: '',
  note: '',
};

const baseTransferForm = {
  productId: '',
  sourceWarehouseLocation: '',
  targetSectionNumber: '',
  targetSectionId: '',
  targetSectionName: '',
  targetSide: '',
  targetShelfNo: '',
  targetLevelNo: '',
  suggestedSlot: '',
  transferCaseCount: '',
  qty: '',
  fromLocation: 'depo',
  toLocation: 'reyon',
  requestNote: '',
  approvalConfirmed: false,
  note: '',
};

const baseAdjustmentForm = {
  productId: '',
  adjustmentReason: 'sayım farkı',
  scope: 'toplam',
  location: 'depo',
  isBatchBased: false,
  batchNo: '',
  targetQuantity: '',
  description: '',
  approvalConfirmed: false,
  highRiskConfirmed: false,
};

const baseDisposalForm = {
  productId: '',
  qty: '',
  location: 'depo',
  sourceLocationCode: '',
  reason: 'expired',
  batchNo: '',
  approvalConfirmed: false,
  note: '',
};

const baseQuickEntryForm = {
  barcode: '',
  productId: '',
  qty: '',
};

const baseCountForm = {
  barcode: '',
  productId: '',
  physicalQuantity: '',
};

const getTodayDateValue = () => new Date().toISOString().slice(0, 10);

const createBaseReceiptForm = () => ({
  productId: '',
  supplierId: '',
  irsaliyeNo: '',
  productionDate: getTodayDateValue(),
  batchNo: '',
  skt: '',
  acceptedCaseCount: '',
  qty: '',
  purchasePrice: '',
  acceptanceType: 'satın alma',
  receiptDate: getTodayDateValue(),
  warehouseLocation: '',
  acceptanceNote: '',
});

const baseOutForm = {
  productId: '',
  qty: '',
  location: 'depo',
  reasonCode: '',
  note: '',
  outputType: 'sevkiyat',
  sourceLocationType: 'depo',
  sourceLocationCode: '',
  batchNo: '',
  userNote: '',
  approvalConfirmed: false,
};

const DISPOSAL_REASON_OPTIONS = [
  { value: 'expired', label: 'SKT geçti' },
  { value: 'packaging_damaged', label: 'Ambalaj hasarlı' },
  { value: 'spoiled', label: 'Bozulmuş' },
  { value: 'broken_spill', label: 'Kırık / dökülme' },
  { value: 'quality_reject', label: 'Kalite red' },
];

const getStorageTypeLabel = (value) => formatStorageTypeLabel(value);

const MOVEMENT_REASON_OPTIONS = {
  IN: [
    { value: 'product_purchase', label: 'Ürün Satın Alımı' },
    { value: 'customer_return', label: 'Müşteri İadesi' },
    { value: 'manual_adjustment', label: 'Manuel Düzeltme' },
    { value: 'transfer_in', label: 'Transfer Girişi' },
  ],
  OUT: [
    { value: 'pos_sale', label: 'Satış (POS İşlemi)' },
    { value: 'supplier_return', label: 'Tedarikçiye İade' },
    { value: 'write_off', label: 'İmha' },
    { value: 'manual_adjustment', label: 'Manuel Düzeltme' },
    { value: 'transfer_out', label: 'Transfer Çıkışı' },
  ],
};

const REASON_TONE = {
  pos_sale: 'primary',
  customer_return: 'warning',
  product_purchase: 'success',
  supplier_return: 'warning',
  write_off: 'danger',
  transfer_in: 'neutral',
  transfer_out: 'neutral',
  transfer_to_shelf: 'primary',
  transfer_to_warehouse: 'neutral',
  count_surplus: 'warning',
  count_deficit: 'warning',
  manual_adjustment: 'warning',
};

const LOCATION_OPTIONS = [
  { value: 'depo', label: 'Depo' },
  { value: 'reyon', label: 'Reyon' },
];

const ACCEPTANCE_TYPE_OPTIONS = [
  { value: 'satın alma', label: 'Satın Alma' },
  { value: 'iade giriş', label: 'İade Giriş' },
  { value: 'transfer giriş', label: 'Transfer Giriş' },
  { value: 'sayım farkı', label: 'Sayım Farkı' },
];

const OUT_TYPE_OPTIONS = [
  { value: 'sevkiyat', label: 'Sevkiyat', reasonCode: 'transfer_out' },
  { value: 'fire', label: 'Fire', reasonCode: 'write_off' },
  { value: 'transfer çıkışı', label: 'Transfer Çıkışı', reasonCode: 'transfer_out' },
];

const SOURCE_LOCATION_TYPE_OPTIONS = [
  { value: 'depo', label: 'Depo Lokasyonu' },
  { value: 'reyon', label: 'Reyon Lokasyonu' },
];

const ADJUSTMENT_REASON_OPTIONS = [
  { value: 'sayım farkı', label: 'Sayım Farkı' },
  { value: 'hasar', label: 'Hasar' },
  { value: 'yanlış giriş', label: 'Yanlış Giriş' },
  { value: 'sistemsel düzeltme', label: 'Sistemsel Düzeltme' },
  { value: 'fire', label: 'Fire' },
  { value: 'iade düzeltmesi', label: 'İade Düzeltmesi' },
];

const TYPE_LABELS = {
  IN: 'Giriş',
  OUT: 'Çıkış',
  ADJUSTMENT: 'Düzeltme',
  TRANSFER: 'Transfer',
};

const OPERATION_HISTORY_META = {
  RECEIPT: {
    title: 'Mal Kabul - Son 5 İşlem',
    matcher: (item) => item.type === 'IN',
  },
  OUT: {
    title: 'Stok Çıkışı - Son 5 İşlem',
    matcher: (item) => item.type === 'OUT' && item.reasonCode !== 'write_off',
  },
  ADJUSTMENT: {
    title: 'Stok Düzeltme - Son 5 İşlem',
    matcher: (item) => item.type === 'ADJUSTMENT',
  },
  TRANSFER: {
    title: 'Reyon Besleme - Son 5 İşlem',
    matcher: (item) => item.type === 'TRANSFER',
  },
  DISPOSAL: {
    title: 'Stok İmha - Son 5 İşlem',
    matcher: (item) => item.type === 'OUT' && item.reasonCode === 'write_off',
  },
};

const parseBatchAndSktFromNote = (note) => {
  const raw = String(note || '');
  const batchMatch = raw.match(/Parti\s*No\s*:\s*([^|]+)/i);
  const sktMatch = raw.match(/SKT\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  return {
    batchNo: batchMatch ? batchMatch[1].trim() : '',
    skt: sktMatch ? sktMatch[1].trim() : '',
  };
};

const buildMovementNote = ({ batchNo = '', skt = '', note = '' } = {}) => {
  return [
    String(batchNo || '').trim() ? `Parti No: ${String(batchNo).trim()}` : '',
    String(skt || '').trim() ? `SKT: ${String(skt).trim()}` : '',
    String(note || '').trim(),
  ].filter(Boolean).join(' | ');
};

const buildCountAlertMeta = ({ tone = 'info', title = '', text = '' }) => ({
  tone,
  title,
  text,
  icon: tone === 'success' || tone === 'info-success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />,
});

const resolveCountDifferenceAlert = (countDifference) => {
  if (countDifference === null) return null;
  if (countDifference === 0) {
    return buildCountAlertMeta({
      tone: 'success',
      title: 'Fark yok',
      text: 'Fiziksel sayım sistem stoğu ile eşleşiyor. Kayıt sırasında stok hareketi oluşturulmaz.',
    });
  }
  if (countDifference > 0) {
    return buildCountAlertMeta({
      tone: 'warning',
      title: 'Eksik stok tespit edildi',
      text: `Eksik ${formatNumber(countDifference)} adet için kayıt sırasında stok "Sayım farkı" sebebiyle düşülecek.`,
    });
  }
  return buildCountAlertMeta({
    tone: 'neutral',
    title: 'Fazla stok tespit edildi',
    text: 'Otomatik stok artırımı yapılmaz. Manuel giriş veya onaylı düzeltme gerekir.',
  });
};

const resolveCountFeedbackAlert = (message) => {
  if (!message?.text) return null;
  const tone = message.tone || 'info';
  if (tone === 'success') {
    return buildCountAlertMeta({ tone: 'success', title: 'Sayım kaydedildi', text: message.text });
  }
  if (tone === 'warning') {
    return buildCountAlertMeta({ tone: 'warning', title: 'İşlem onay bekliyor', text: message.text });
  }
  if (tone === 'error') {
    return buildCountAlertMeta({ tone: 'error', title: 'İşlem tamamlanamadı', text: message.text });
  }
  return buildCountAlertMeta({ tone: 'info-success', title: 'Bilgilendirme', text: message.text });
};

const PAGE_VIEW_OPTIONS = [
  { value: 'VIEW', label: 'Stok Görüntüleme' },
  { value: 'MOVEMENTS', label: 'Stok Hareketleri' },
  { value: 'OPERATIONS', label: 'Stok İşlemleri' },
  { value: 'COUNT', label: 'Sayım' },
];

const OPERATION_VIEW_OPTIONS = [
  { value: 'RECEIPT', label: 'Mal Kabul ve Parti Girişi' },
  { value: 'OUT', label: 'Stok Çıkışı' },
  { value: 'ADJUSTMENT', label: 'Stok Düzeltme' },
  { value: 'TRANSFER', label: 'Reyon Besleme' },
  { value: 'DISPOSAL', label: 'Stok İmha' },
];

const formatRelativeTime = (value) => {
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return '-';
  const diffMs = Date.now() - target.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'az önce';
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))} dk önce`;
  if (diffMs < day) return `${Math.max(1, Math.floor(diffMs / hour))} saat önce`;
  return `${Math.max(1, Math.floor(diffMs / day))} gün önce`;
};

const normalizeDecimalInput = (value) => String(value ?? '').replace(',', '.');

const parsePositiveNumber = (value) => {
  const normalized = Number(normalizeDecimalInput(value));
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return normalized;
};

const parseNonNegativeNumber = (value) => {
  const normalized = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(normalized) || normalized < 0) return null;
  return normalized;
};

const normalizeSectionNumber = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) {
    return String(Number(raw));
  }
  return raw.toLowerCase();
};

const buildStockUpdateMessage = (movement, fallbackLabel = 'Stok güncellendi') => {
  if (!movement) return fallbackLabel;
  const previous = Number(movement.previousQuantity);
  const next = Number(movement.nextQuantity);
  const locationLabel = movement.location === 'reyon' ? 'Reyon' : 'Depo';

  if (!Number.isFinite(previous) || !Number.isFinite(next)) {
    return fallbackLabel;
  }

  return `${fallbackLabel}: ${locationLabel} ${formatNumber(previous)} -> ${formatNumber(next)}`;
};

export default function StockMovements() {
  const { user } = useAuth();
  const [stocks, setStocks] = useState([]);
  const [movements, setMovements] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [sections, setSections] = useState([]);
  const [receiptLocationRows, setReceiptLocationRows] = useState([]);
  const [outWarehouseRows, setOutWarehouseRows] = useState([]);
  const [disposalWarehouseRows, setDisposalWarehouseRows] = useState([]);
  const [receiptLocationOptions, setReceiptLocationOptions] = useState([]);
  const [receiptSuggestedLocation, setReceiptSuggestedLocation] = useState(null);
  const [productsById, setProductsById] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [pendingReceiptOrders, setPendingReceiptOrders] = useState([]);
  const [selectedPendingReceiptOrder, setSelectedPendingReceiptOrder] = useState(null);
  const [selectedPendingReceiptItems, setSelectedPendingReceiptItems] = useState([]);
  const [selectedPendingReceiptItemId, setSelectedPendingReceiptItemId] = useState('');
  const [receiptMode, setReceiptMode] = useState('manual');
  const [hasLoadedPendingReceiptOrders, setHasLoadedPendingReceiptOrders] = useState(false);
  const [autoLinkedNoticeSeenItemKeys, setAutoLinkedNoticeSeenItemKeys] = useState({});
  const [autoLinkedNoticeItemKey, setAutoLinkedNoticeItemKey] = useState('');
  const [receiptCompletedItemKeys, setReceiptCompletedItemKeys] = useState({});
  const [pendingReceiptLoading, setPendingReceiptLoading] = useState(false);
  const [pendingReceiptIdQuery, setPendingReceiptIdQuery] = useState('');
  const [filters, setFilters] = useState({ search: '', type: '', reasonCode: '', location: '', productId: '', maxStock: '', criticalOnly: false, outOfStockOnly: false });
  const [inForm, setInForm] = useState(baseMovementForm);
  const [outForm, setOutForm] = useState(baseOutForm);
  const [adjustForm, setAdjustForm] = useState(baseAdjustmentForm);
  const [transferForm, setTransferForm] = useState(baseTransferForm);
  const [disposalForm, setDisposalForm] = useState(baseDisposalForm);
  const [processingType, setProcessingType] = useState('');
  const [quickEntryModalOpen, setQuickEntryModalOpen] = useState(false);
  const [receiptForm, setReceiptForm] = useState(() => createBaseReceiptForm());
  const [quickEntryType, setQuickEntryType] = useState('IN');
  const [activePageView, setActivePageView] = useState('');
  const [activeOperation, setActiveOperation] = useState('RECEIPT');
  const [receiptErrors, setReceiptErrors] = useState({});
  const [outErrors, setOutErrors] = useState({});
  const [adjustErrors, setAdjustErrors] = useState({});
  const [transferErrors, setTransferErrors] = useState({});
  const [disposalErrors, setDisposalErrors] = useState({});
  const [expiredBatchRows, setExpiredBatchRows] = useState([]);
  const [selectedExpiredBatchIds, setSelectedExpiredBatchIds] = useState([]);
  const [expiredBatchDisposalTarget, setExpiredBatchDisposalTarget] = useState(null);
  const [expiredBatchDisposalNote, setExpiredBatchDisposalNote] = useState('');
  const [transferSectionRows, setTransferSectionRows] = useState([]);
  const [transferWarehouseRows, setTransferWarehouseRows] = useState([]);
  const [quickEntryForm, setQuickEntryForm] = useState(baseQuickEntryForm);
  const [quickEntryScanning, setQuickEntryScanning] = useState(false);
  const [quickEntryScanError, setQuickEntryScanError] = useState('');
  const [cancelTargetMovement, setCancelTargetMovement] = useState(null);
  const [cancelProcessing, setCancelProcessing] = useState(false);
  const [countForm, setCountForm] = useState(baseCountForm);
  const [countLookupLoading, setCountLookupLoading] = useState(false);
  const [countMessage, setCountMessage] = useState(null);
  const [countArchiveRecords, setCountArchiveRecords] = useState(() => readInventoryCountArchive());
  const [countArchivePage, setCountArchivePage] = useState(1);

  const quickEntryScannerRef = useRef(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'user';

  const stopQuickEntryScanner = useCallback(() => {
    const scanner = quickEntryScannerRef.current;
    if (scanner) {
      scanner.stop().catch(() => {});
      scanner.clear().catch(() => {});
      quickEntryScannerRef.current = null;
    }
    setQuickEntryScanning(false);
  }, []);

  useEffect(() => {
    return () => {
      stopQuickEntryScanner();
    };
  }, [stopQuickEntryScanner]);

  const loadData = async (query = filters) => {
    try {
      const hasWarmCache =
        stockService.hasStocksCache()
        && stockService.hasMovementsCache(query)
        && productService.hasListCache()
        && supplierService.hasListCache()
        && sectionService.hasListCache();

      if (!hasWarmCache) {
        setIsLoading(true);
      }

      const [stockRows, movementRows, productRows, supplierRows, sectionRows, expiredRows] = await Promise.all([
        stockService.getStocks({ fetchAll: false, page: 1, limit: 100, includeBatches: false }),
        stockService.getMovements({ ...query, page: 1, limit: 50 }),
        productService.list({ fetchAll: false, page: 1, limit: 100, includeTotal: true }),
        supplierService.list(),
        sectionService.list(),
        stockService.getExpiredBatchWarnings({ fetchAll: true, limit: 500 }),
      ]);
      setStocks(stockRows);
      setMovements(movementRows);
      setSuppliers(Array.isArray(supplierRows) ? supplierRows : []);
      setProducts(Array.isArray(productRows) ? productRows : []);
      setSections(Array.isArray(sectionRows) ? sectionRows : []);
      setExpiredBatchRows(Array.isArray(expiredRows) ? expiredRows : []);
      setSelectedExpiredBatchIds((current) => current.filter((id) => (Array.isArray(expiredRows) ? expiredRows : []).some((row) => String(row.id) === String(id))));
      setProductsById(Object.fromEntries(productRows.map((item) => [item.id, item])));
      setPendingReceiptOrders((current) => (Array.isArray(current) ? current : []));
    } catch (error) {
      setToast({ type: 'error', title: 'Stok İşlemleri', message: error.message || 'Stok verileri yüklenemedi.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedPendingReceiptOrder?.id) return;
    const stillExists = pendingReceiptOrders.some((item) => String(item.id) === String(selectedPendingReceiptOrder.id));
    if (stillExists) return;
    setSelectedPendingReceiptOrder(null);
    setSelectedPendingReceiptItems([]);
    setSelectedPendingReceiptItemId('');
  }, [pendingReceiptOrders, selectedPendingReceiptOrder]);

  const loadPendingReceiptOrders = useCallback(async () => {
    try {
      setPendingReceiptLoading(true);
      const rows = await procurementService.listOrders({ status: 'stock_entry_pending' }).catch(() => []);
      const pendingRows = (Array.isArray(rows) ? rows : [])
        .filter((row) => normalizePurchaseOrderStatus(row?.status || row?.currentStatus, '') === 'stock_entry_pending');
      setPendingReceiptOrders(pendingRows);
      setHasLoadedPendingReceiptOrders(true);
    } catch (error) {
      setToast({ type: 'error', title: 'Mal Kabul', message: error.message || 'Sipariş listesi yüklenemedi.' });
    } finally {
      setPendingReceiptLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadReceiptLocationOptions = async () => {
      try {
        const [suggestResult, allResult] = await Promise.all([
          warehouseService.listLocations({
            productId: receiptForm.productId || undefined,
            suggestMode: 'fefo',
          }),
          warehouseService.listLocations({}),
        ]);

        const allRows = Array.isArray(allResult?.rows) ? allResult.rows : [];
        const requiredStorageType = productsById[receiptForm.productId]?.requiredStorageType || 'Ortam';
        const emptyCompatibleRows = allRows.filter((row) => row.status === 'Boş' && String(row.storageType || 'Ortam') === String(requiredStorageType));

        setReceiptLocationRows(allRows);
        setReceiptLocationOptions(emptyCompatibleRows.map((row) => row.locationCode));
        setReceiptSuggestedLocation(suggestResult?.suggestedLocation || null);
      } catch {
        setReceiptLocationRows([]);
        setReceiptLocationOptions([]);
        setReceiptSuggestedLocation(null);
      }
    };

    loadReceiptLocationOptions();
  }, [productsById, receiptForm.productId]);

  useEffect(() => {
    const loadOutWarehouseRows = async () => {
      if (!outForm.productId) {
        setOutWarehouseRows([]);
        return;
      }
      try {
        const result = await warehouseService.listLocations({ productId: outForm.productId });
        const rows = Array.isArray(result?.rows) ? result.rows : [];
        setOutWarehouseRows(rows);
      } catch {
        setOutWarehouseRows([]);
      }
    };

    loadOutWarehouseRows();
  }, [outForm.productId]);

  useEffect(() => {
    const loadDisposalWarehouseRows = async () => {
      if (!disposalForm.productId) {
        setDisposalWarehouseRows([]);
        return;
      }
      try {
        const result = await warehouseService.listLocations({ productId: disposalForm.productId });
        const rows = Array.isArray(result?.rows) ? result.rows : [];
        setDisposalWarehouseRows(rows);
      } catch {
        setDisposalWarehouseRows([]);
      }
    };

    loadDisposalWarehouseRows();
  }, [disposalForm.productId]);

  useEffect(() => {
    if (!receiptForm.productId) return;
    const autoLocation = receiptSuggestedLocation?.locationCode || receiptLocationOptions[0] || '';
    if (!autoLocation) return;
    setReceiptForm((current) => (current.warehouseLocation === autoLocation ?
      current
      : { ...current, warehouseLocation: autoLocation }));
    setReceiptErrors((current) => ({ ...current, warehouseLocation: '' }));
  }, [receiptForm.productId, receiptLocationOptions, receiptSuggestedLocation]);

  const receiptSelectedProduct = useMemo(() => productsById[receiptForm.productId] || null, [productsById, receiptForm.productId]);
  const selectedPendingReceiptItem = useMemo(
    () => selectedPendingReceiptItems.find((item) => String(item.id || item.productId || '') === String(selectedPendingReceiptItemId || '')) || null,
    [selectedPendingReceiptItemId, selectedPendingReceiptItems],
  );
  const pendingReceiptEnteredQtyByProduct = useMemo(() => {
    if (!selectedPendingReceiptOrder?.id) return {};

    const orderNumber = String(selectedPendingReceiptOrder.orderNumber || '').trim().toLowerCase();
    const map = {};

    movements.forEach((movement) => {
      if (!movement?.productId || String(movement.type || '') !== 'IN') return;

      const movementOrderNo = String(movement.irsaliyeNo || '').trim().toLowerCase();
      const movementNote = String(movement.note || '').trim().toLowerCase();
      const hasOrderMatch = orderNumber ?
        movementOrderNo === orderNumber || movementNote.includes(orderNumber)
        : true;
      if (!hasOrderMatch) return;

      const productId = String(movement.productId || '').trim();
      if (!productId) return;
      map[productId] = Number(map[productId] || 0) + Number(movement.qty || 0);
    });

    return map;
  }, [movements, selectedPendingReceiptOrder]);
  const isReceiptBoundToOrder = Boolean(selectedPendingReceiptOrder?.id);
  const outSelectedProduct = useMemo(() => productsById[outForm.productId] || null, [outForm.productId, productsById]);

  const receiptUnitsPerCase = useMemo(() => {
    const units = Number(receiptSelectedProduct?.unitsPerCase || 1);
    return Number.isFinite(units) && units > 0 ? units : 1;
  }, [receiptSelectedProduct]);

  const stockBatchesByProduct = useMemo(() => {
    const index = {};
    for (const stock of stocks) {
      if (!stock?.productId) continue;
      const productBatches = {};
      for (const batch of Array.isArray(stock.batches) ? stock.batches : []) {
        const batchNo = String(batch?.batchNo || '').trim();
        if (!batchNo) continue;
        productBatches[batchNo.toLowerCase()] = {
          batchNo,
          skt: String(batch?.skt || '').trim(),
          qtyBalance: Number(batch?.totalQuantity || 0),
          warehouseQuantity: Number(batch?.warehouseQuantity || 0),
          shelfQuantity: Number(batch?.shelfQuantity || 0),
        };
      }
      index[stock.productId] = productBatches;
    }
    return index;
  }, [stocks]);

  const movementBatchesByProduct = useMemo(() => {
    const index = Object.fromEntries(
      Object.entries(stockBatchesByProduct).map(([productId, batches]) => [productId, { ...batches }])
    );
    for (const movement of movements) {
      if (!movement?.productId) continue;
      const batchNo = String(movement.batchNo || parseBatchAndSktFromNote(movement.note).batchNo || '').trim();
      if (!batchNo) continue;
      const skt = String(movement.skt || parseBatchAndSktFromNote(movement.note).skt || '').trim();
      const key = batchNo.toLowerCase();
      if (!index[movement.productId]) index[movement.productId] = {};
      if (!index[movement.productId][key]) {
        index[movement.productId][key] = { batchNo, skt, qtyBalance: 0 };
      }
      const qty = Number(movement.qty || 0);
      if (movement.type === 'IN') index[movement.productId][key].qtyBalance += qty;
      if (movement.type === 'OUT') index[movement.productId][key].qtyBalance -= qty;
      if (!index[movement.productId][key].skt && skt) {
        index[movement.productId][key].skt = skt;
      }
    }
    return index;
  }, [movements, stockBatchesByProduct]);

  const outBatchOptions = useMemo(() => {
    const productBatches = Object.values(movementBatchesByProduct[outForm.productId] || {});
    return productBatches
      .filter((item) => Number(item.qtyBalance || 0) > 0)
      .sort((left, right) => String(left.skt || '9999-12-31').localeCompare(String(right.skt || '9999-12-31')));
  }, [movementBatchesByProduct, outForm.productId]);

  const outSuggestedBatch = useMemo(() => outBatchOptions[0] || null, [outBatchOptions]);

  const outSelectedBatch = useMemo(() => {
    const target = String(outForm.batchNo || '').trim().toLowerCase();
    if (!target) return null;
    return outBatchOptions.find((item) => String(item.batchNo || '').trim().toLowerCase() === target) || null;
  }, [outBatchOptions, outForm.batchNo]);

  const outLocationOptions = useMemo(() => {
    if (!outForm.productId) return [];

    if (outForm.sourceLocationType === 'depo') {
      return outWarehouseRows
        .filter((row) => String(row.productId || '') === String(outForm.productId) && Number(row.warehouseStock || 0) > 0)
        .map((row) => ({
          value: row.locationCode,
          label: `${formatDepotLocationLabel(row.locationCode, row.locationCode)} (${formatNumber(row.warehouseStock || 0)} adet)`,
          storageType: row.storageType || 'Ortam',
          stock: Number(row.warehouseStock || 0),
        }));
    }

    const shelfCode = outSelectedProduct?.shelfCode || '';
    const shelfStock = Number(stocks.find((item) => String(item.productId) === String(outForm.productId))?.shelfStock || 0);
    if (!shelfCode) return [];
    return [{ value: shelfCode, label: `${shelfCode} (${formatNumber(shelfStock)} adet)`, storageType: outSelectedProduct?.requiredStorageType || 'Ortam', stock: shelfStock }];
  }, [outForm.productId, outForm.sourceLocationType, outSelectedProduct, outWarehouseRows, stocks]);

  const disposalBatchOptions = useMemo(() => {
    const productBatches = Object.values(movementBatchesByProduct[disposalForm.productId] || {});
    return productBatches
      .filter((item) => Number(item.qtyBalance || 0) > 0)
      .sort((left, right) => String(left.skt || '9999-12-31').localeCompare(String(right.skt || '9999-12-31')));
  }, [disposalForm.productId, movementBatchesByProduct]);

  const disposalSelectedBatch = useMemo(() => {
    const target = String(disposalForm.batchNo || '').trim().toLowerCase();
    if (!target) return null;
    return disposalBatchOptions.find((item) => String(item.batchNo || '').trim().toLowerCase() === target) || null;
  }, [disposalBatchOptions, disposalForm.batchNo]);

  const disposalSelectedProduct = useMemo(() => productsById[disposalForm.productId] || null, [disposalForm.productId, productsById]);

  const disposalLocationOptions = useMemo(() => {
    if (!disposalForm.productId) return [];

    if (disposalForm.location === 'depo') {
      return disposalWarehouseRows
        .filter((row) => String(row.productId || '') === String(disposalForm.productId) && Number(row.warehouseStock || 0) > 0)
        .map((row) => ({
          value: row.locationCode,
          label: `${formatDepotLocationLabel(row.locationCode, row.locationCode)} (${formatNumber(row.warehouseStock || 0)} adet)`,
          storageType: row.storageType || 'Ortam',
          stock: Number(row.warehouseStock || 0),
        }));
    }

    const shelfCode = disposalSelectedProduct?.shelfCode || '';
    const shelfStock = Number(stocks.find((item) => String(item.productId) === String(disposalForm.productId))?.shelfStock || 0);
    if (!shelfCode || shelfStock <= 0) return [];
    return [{ value: shelfCode, label: `${shelfCode} (${formatNumber(shelfStock)} adet)`, storageType: disposalSelectedProduct?.requiredStorageType || 'Ortam', stock: shelfStock }];
  }, [disposalForm.location, disposalForm.productId, disposalSelectedProduct, disposalWarehouseRows, stocks]);

  const batchSktByProduct = useMemo(() => {
    const index = {};
    for (const movement of movements) {
      if (movement.type !== 'IN' || !movement.productId) continue;
      const parsed = parseBatchAndSktFromNote(movement.note);
      if (!parsed.batchNo || !parsed.skt) continue;
      const productBatches = index[movement.productId] || {};
      const key = parsed.batchNo.toLowerCase();
      if (!productBatches[key]) {
        productBatches[key] = parsed.skt;
      }
      index[movement.productId] = productBatches;
    }
    return index;
  }, [movements]);

  const resolveSktByBatch = useCallback((productId, batchNo) => {
    const normalizedBatch = String(batchNo || '').trim().toLowerCase();
    if (!productId || !normalizedBatch) return '';

    const fromMovements = batchSktByProduct[productId]?.[normalizedBatch] || '';
    if (fromMovements) {
      return fromMovements;
    }

    const fromStocks = stockBatchesByProduct[productId]?.[normalizedBatch]?.skt || '';
    if (fromStocks) {
      return fromStocks;
    }

    return '';
  }, [batchSktByProduct, stockBatchesByProduct]);

  const filteredStocks = useMemo(() => {
    const maxStock = Number(filters.maxStock);
    return stocks.filter((item) => {
      const warehouseStock = Number(item.warehouseStock || 0);
      const shelfStock = Number(item.shelfStock || 0);
      const total = Number(item.totalStock || item.quantity || 0);
      const scopedStock = filters.location === 'depo' ?
        warehouseStock
        : filters.location === 'reyon' ?
          shelfStock
          : total;

      const matchesLocation = !filters.location || scopedStock > 0;
      const matchesMaxStock = !filters.maxStock || (Number.isFinite(maxStock) && maxStock > 0 && scopedStock < maxStock);
      const criticalThreshold = Number(item.criticalStock || 0);
      const matchesCriticalOnly = !filters.criticalOnly || (scopedStock > 0 && scopedStock <= criticalThreshold);
      const matchesOutOfStockOnly = !filters.outOfStockOnly || scopedStock <= 0;
      return matchesLocation && matchesMaxStock && matchesCriticalOnly && matchesOutOfStockOnly;
    });
  }, [filters.criticalOnly, filters.location, filters.maxStock, filters.outOfStockOnly, stocks]);

  const filteredMovements = useMemo(() => {
    const maxMovementQty = Number(filters.maxStock);
    return movements.filter((item) => {
      const qty = Number(item.qty || 0);
      const matchesQty = !filters.maxStock || (Number.isFinite(maxMovementQty) && maxMovementQty > 0 && qty < maxMovementQty);
      const matchesReason = !filters.reasonCode || String(item.reasonCode || '') === filters.reasonCode;

      if (!filters.location) {
        return matchesQty && matchesReason;
      }

      const movementLocations = [item.location, item.fromLocation, item.toLocation].filter(Boolean);
      const matchesLocation = movementLocations.includes(filters.location);
      return matchesQty && matchesReason && matchesLocation;
    });
  }, [filters.location, filters.maxStock, filters.reasonCode, movements]);

  const reasonFilterOptions = useMemo(() => {
    const map = new Map();
    Object.values(MOVEMENT_REASON_OPTIONS)
      .flat()
      .forEach((item) => map.set(item.value, item.label));

    movements.forEach((item) => {
      const code = String(item.reasonCode || '').trim();
      if (!code) return;
      if (!map.has(code)) {
        map.set(code, item.reasonLabel || item.reason || code);
      }
    });

    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, 'tr'));
  }, [movements]);

  const typeFilterOptions = useMemo(() => {
    const map = new Map();
    ['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER'].forEach((type) => {
      map.set(type, TYPE_LABELS[type] || type);
    });

    movements.forEach((item) => {
      const type = String(item.type || '').trim().toUpperCase();
      if (!type) return;
      if (!map.has(type)) {
        map.set(type, TYPE_LABELS[type] || type);
      }
    });

    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [movements]);

  const stockByProductId = useMemo(
    () => Object.fromEntries(stocks.map((item) => [item.productId, item])),
    [stocks]
  );

  const recentMovementsByProductId = useMemo(() => {
    const index = {};
    for (const movement of movements) {
      if (!movement?.productId) continue;
      if (!index[movement.productId]) index[movement.productId] = [];
      if (index[movement.productId].length < 20) {
        index[movement.productId].push(movement);
      }
    }
    return index;
  }, [movements]);

  const summary = useMemo(
    () => {
      const totalWarehouseStock = filteredStocks.reduce((sum, item) => sum + (item.warehouseStock || 0), 0);
      const totalShelfStock = filteredStocks.reduce((sum, item) => sum + (item.shelfStock || 0), 0);
      const totalStock = filteredStocks.reduce((sum, item) => sum + (item.totalStock || item.quantity || 0), 0);
      const nearDepletionCount = filteredStocks.filter((item) => {
        const currentStock = item.totalStock || item.quantity || 0;
        const criticalThreshold = item.criticalStock || 0;
        return currentStock > 0 && currentStock <= criticalThreshold;
      }).length;
      const outOfStockCount = filteredStocks.filter((item) => (item.totalStock || item.quantity || 0) <= 0).length;
      const shelfOccupancyRate = totalStock > 0 ? (totalShelfStock / totalStock) * 100 : 0;
      const warehouseOccupancyRate = totalStock > 0 ? (totalWarehouseStock / totalStock) * 100 : 0;

      return {
        totalStock,
        totalMovements: filteredMovements.length,
        nearDepletionCount,
        outOfStockCount,
        shelfOccupancyRate,
        warehouseOccupancyRate,
      };
    },
    [filteredMovements.length, filteredStocks]
  );

  const adjustSelectedStock = useMemo(() => stockByProductId[adjustForm.productId] || null, [adjustForm.productId, stockByProductId]);
  const countSelectedStock = useMemo(() => stockByProductId[countForm.productId] || null, [countForm.productId, stockByProductId]);
  const countSelectedProduct = useMemo(() => productsById[countForm.productId] || null, [countForm.productId, productsById]);
  const countExpectedQuantity = useMemo(
    () => Number(countSelectedStock?.totalStock || countSelectedStock?.quantity || 0),
    [countSelectedStock]
  );
  const countWarehouseStock = useMemo(() => Number(countSelectedStock?.warehouseStock || 0), [countSelectedStock]);
  const countShelfStock = useMemo(() => Number(countSelectedStock?.shelfStock || 0), [countSelectedStock]);
  const countPhysicalQuantity = useMemo(() => {
    if (!String(countForm.physicalQuantity || '').trim()) return null;
    return parseNonNegativeNumber(countForm.physicalQuantity);
  }, [countForm.physicalQuantity]);
  const countDifference = useMemo(() => {
    if (countPhysicalQuantity === null) return null;
    return countExpectedQuantity - countPhysicalQuantity;
  }, [countExpectedQuantity, countPhysicalQuantity]);
  const adjustOldStock = useMemo(() => {
    if (!adjustSelectedStock) return 0;
    if (adjustForm.scope === 'lokasyon') {
      return adjustForm.location === 'reyon' ?
        Number(adjustSelectedStock.shelfStock || 0)
        : Number(adjustSelectedStock.warehouseStock || 0);
    }
    return Number(adjustSelectedStock.totalStock || adjustSelectedStock.quantity || 0);
  }, [adjustForm.location, adjustForm.scope, adjustSelectedStock]);

  const adjustNewStock = useMemo(() => {
    const value = parseNonNegativeNumber(adjustForm.targetQuantity);
    return value === null ? null : value;
  }, [adjustForm.targetQuantity]);

  const adjustDifference = useMemo(() => {
    if (adjustNewStock === null) return null;
    return adjustNewStock - adjustOldStock;
  }, [adjustNewStock, adjustOldStock]);

  const adjustIsHighDifference = useMemo(() => {
    if (adjustDifference === null) return false;
    const threshold = Math.max(20, Math.floor(adjustOldStock * 0.4));
    return Math.abs(adjustDifference) >= threshold;
  }, [adjustDifference, adjustOldStock]);

  const transferSelectedProduct = useMemo(() => productsById[transferForm.productId] || null, [productsById, transferForm.productId]);
  const transferSectionsByNumber = useMemo(() => {
    const index = new Map();
    sections.forEach((section) => {
      const normalized = normalizeSectionNumber(section?.number);
      if (normalized) {
        index.set(normalized, section);
      }
    });
    return index;
  }, [sections]);

  const transferResolvedTargetSection = useMemo(() => {
    const normalizedTarget = normalizeSectionNumber(transferForm.targetSectionNumber);
    if (normalizedTarget) {
      return transferSectionsByNumber.get(normalizedTarget) || null;
    }
    if (!transferSelectedProduct?.sectionId) return null;
    return {
      id: transferSelectedProduct.sectionId,
      name: transferSelectedProduct.sectionName || '',
      number: transferSelectedProduct.sectionNumber || '',
    };
  }, [transferForm.targetSectionNumber, transferSectionsByNumber, transferSelectedProduct]);
  const transferUnitsPerCase = useMemo(() => {
    const units = Number(transferSelectedProduct?.unitsPerCase || 1);
    return Number.isFinite(units) && units > 0 ? units : 1;
  }, [transferSelectedProduct]);

  useEffect(() => {
    const loadTransferData = async () => {
      if (!transferForm.productId) {
        setTransferWarehouseRows([]);
        setTransferSectionRows([]);
        return;
      }

      try {
        const [warehouseResult, sectionProducts] = await Promise.all([
          warehouseService.listLocations({ productId: transferForm.productId }),
          transferSelectedProduct?.sectionId ? sectionService.getProducts(transferSelectedProduct.sectionId) : Promise.resolve([]),
        ]);
        setTransferWarehouseRows(Array.isArray(warehouseResult?.rows) ? warehouseResult.rows : []);
        setTransferSectionRows(Array.isArray(sectionProducts) ? sectionProducts : []);
      } catch {
        setTransferWarehouseRows([]);
        setTransferSectionRows([]);
      }
    };

    loadTransferData();
  }, [transferForm.productId, transferSelectedProduct?.sectionId]);

  const transferWarehouseLocationOptions = useMemo(() => {
    return transferWarehouseRows
      .filter((row) => String(row.productId || '') === String(transferForm.productId) && Number(row.warehouseStock || 0) > 0)
      .map((row) => ({
        value: row.locationCode,
        label: `${formatDepotLocationLabel(row.locationCode, row.locationCode)} (${formatNumber(row.warehouseStock || 0)} adet)`,
        storageType: row.storageType || 'Ortam',
        stock: Number(row.warehouseStock || 0),
      }));
  }, [transferForm.productId, transferWarehouseRows]);

  const transferSelectedWarehouse = useMemo(() => {
    return transferWarehouseLocationOptions.find((item) => String(item.value) === String(transferForm.sourceWarehouseLocation || '')) || null;
  }, [transferForm.sourceWarehouseLocation, transferWarehouseLocationOptions]);

  useEffect(() => {
    if (!transferForm.productId) return;
    if (!transferWarehouseLocationOptions.length) return;
    const autoLocation = transferWarehouseLocationOptions[0]?.value || '';
    if (!autoLocation) return;
    setTransferForm((current) => (current.sourceWarehouseLocation === autoLocation ?
      current
      : { ...current, sourceWarehouseLocation: autoLocation }));
    setTransferErrors((current) => ({ ...current, sourceWarehouseLocation: '' }));
  }, [transferForm.productId, transferWarehouseLocationOptions]);

  const transferSuggestedSlot = useMemo(() => {
    if (!transferSelectedProduct?.sectionId) return null;

    const occupied = new Set(
      transferSectionRows
        .filter((item) => String(item.id) !== String(transferForm.productId))
        .map((item) => `${item.shelfSide || 'L'}-${Number(item.shelfNo || 0)}-${Number(item.shelfLevel || 0)}`)
    );

    const preferred = {
      side: transferSelectedProduct.shelfSide || 'L',
      shelfNo: Number(transferSelectedProduct.shelfNo || 1),
      levelNo: Number(transferSelectedProduct.shelfLevel || 1),
    };

    const preferredKey = `${preferred.side}-${preferred.shelfNo}-${preferred.levelNo}`;
    if (!occupied.has(preferredKey)) {
      return preferred;
    }

    for (const side of ['L', 'R']) {
      for (let shelfNo = 1; shelfNo <= 10; shelfNo += 1) {
        for (let levelNo = 1; levelNo <= 5; levelNo += 1) {
          const key = `${side}-${shelfNo}-${levelNo}`;
          if (!occupied.has(key)) {
            return { side, shelfNo, levelNo };
          }
        }
      }
    }

    return null;
  }, [transferForm.productId, transferSectionRows, transferSelectedProduct]);
  const countArchiveRows = useMemo(
    () => buildInventoryCountArchive(products, { records: countArchiveRecords }),
    [countArchiveRecords, products]
  );
  const countArchiveTotalPages = useMemo(
    () => Math.max(1, Math.ceil(countArchiveRows.length / 10)),
    [countArchiveRows.length]
  );
  const paginatedCountArchiveRows = useMemo(() => {
    const startIndex = (countArchivePage - 1) * 10;
    return countArchiveRows.slice(startIndex, startIndex + 10);
  }, [countArchivePage, countArchiveRows]);

  useEffect(() => {
    setCountArchivePage((current) => Math.min(current, countArchiveTotalPages));
  }, [countArchiveTotalPages]);

  useEffect(() => {
    if (!transferSelectedProduct) return;
    if (!transferSuggestedSlot) return;
    setTransferForm((current) => {
      const suggestedSlot = `${transferSelectedProduct.sectionNumber || '-'}-${transferSuggestedSlot.side}-${String(transferSuggestedSlot.shelfNo).padStart(2, '0')}-${String(transferSuggestedSlot.levelNo).padStart(2, '0')}`;
      return {
        ...current,
        targetSectionNumber: current.targetSectionNumber || String(transferSelectedProduct.sectionNumber || ''),
        targetSectionId: transferSelectedProduct.sectionId || current.targetSectionId,
        targetSectionName: transferSelectedProduct.sectionName || current.targetSectionName,
        targetSide: current.targetSide || transferSuggestedSlot.side,
        targetShelfNo: current.targetShelfNo || String(transferSuggestedSlot.shelfNo),
        targetLevelNo: current.targetLevelNo || String(transferSuggestedSlot.levelNo),
        suggestedSlot,
      };
    });
  }, [transferSelectedProduct, transferSuggestedSlot]);

  const applySuggestedTransferSlot = () => {
    if (!transferSuggestedSlot || !transferSelectedProduct) return;
    setTransferForm((current) => ({
      ...current,
      targetSectionNumber: String(transferSelectedProduct.sectionNumber || current.targetSectionNumber || ''),
      targetSectionId: transferSelectedProduct.sectionId || current.targetSectionId,
      targetSectionName: transferSelectedProduct.sectionName || current.targetSectionName,
      targetSide: transferSuggestedSlot.side,
      targetShelfNo: String(transferSuggestedSlot.shelfNo),
      targetLevelNo: String(transferSuggestedSlot.levelNo),
      suggestedSlot: `${transferSelectedProduct.sectionNumber || '-'}-${transferSuggestedSlot.side}-${String(transferSuggestedSlot.shelfNo).padStart(2, '0')}-${String(transferSuggestedSlot.levelNo).padStart(2, '0')}`,
    }));
    setTransferErrors((current) => ({ ...current, targetSlot: '', targetSectionId: '' }));
  };

  const transferTargetCurrentStock = useMemo(() => Number(stockByProductId[transferForm.productId]?.shelfStock || 0), [stockByProductId, transferForm.productId]);
  const transferTargetCapacity = useMemo(() => Number(stockByProductId[transferForm.productId]?.maxShelfStock || 0), [stockByProductId, transferForm.productId]);
  const transferQtyPreview = useMemo(() => parsePositiveNumber(transferForm.qty) || 0, [transferForm.qty]);
  const transferAfterShelfStock = useMemo(() => transferTargetCurrentStock + transferQtyPreview, [transferQtyPreview, transferTargetCurrentStock]);
  const transferAfterWarehouseStock = useMemo(() => {
    const current = Number(stockByProductId[transferForm.productId]?.warehouseStock || 0);
    return Math.max(0, current - transferQtyPreview);
  }, [stockByProductId, transferForm.productId, transferQtyPreview]);
  const transferAfterFillRate = useMemo(() => {
    if (!transferTargetCapacity || transferTargetCapacity <= 0) return 0;
    return Math.min(100, Math.max(0, (transferAfterShelfStock / transferTargetCapacity) * 100));
  }, [transferAfterShelfStock, transferTargetCapacity]);

  const isTransferTargetMatchingProductSection = useMemo(() => {
    if (!transferSelectedProduct?.sectionId || !transferResolvedTargetSection?.id) return false;
    return String(transferSelectedProduct.sectionId) === String(transferResolvedTargetSection.id);
  }, [transferResolvedTargetSection?.id, transferSelectedProduct?.sectionId]);

  const submitMovement = async (type, form, reset) => {
    if (!form.productId) {
      setToast({ type: 'error', title: 'Stok İşlemleri', message: 'Ürün seçimi zorunludur.' });
      return;
    }

    if (type !== 'ADJUSTMENT' && !String(form.qty).trim()) {
      setToast({ type: 'error', title: 'Stok İşlemleri', message: 'Miktar alanı zorunludur.' });
      return;
    }

    if (type === 'ADJUSTMENT' && !String(form.targetQuantity).trim()) {
      setToast({ type: 'error', title: 'Stok İşlemleri', message: 'Yeni stok seviyesi zorunludur.' });
      return;
    }

    const qty = type !== 'ADJUSTMENT' ? parsePositiveNumber(form.qty) : null;
    if (type !== 'ADJUSTMENT' && qty === null) {
      setToast({ type: 'error', title: 'Stok İşlemleri', message: 'Miktar alanı pozitif sayısal bir değer olmalıdır.' });
      return;
    }

    const targetQuantity = type === 'ADJUSTMENT' ? parseNonNegativeNumber(form.targetQuantity) : null;
    if (type === 'ADJUSTMENT' && targetQuantity === null) {
      setToast({ type: 'error', title: 'Stok İşlemleri', message: 'Yeni stok seviyesi 0 veya daha büyük sayısal bir değer olmalıdır.' });
      return;
    }

    const note = String(form.note || '').trim();

    const payload = {
      productId: form.productId,
      qty: qty ?? undefined,
      targetQuantity: targetQuantity ?? undefined,
      location: form.location || 'depo',
      reasonCode: form.reasonCode || (type === 'IN' ? 'product_purchase' : type === 'OUT' ? 'manual_adjustment' : 'manual_adjustment'),
      note,
    };

    try {
      setProcessingType(type);
      let result = null;
      if (type === 'IN') {
        result = await stockService.stockIn(payload);
      }
      if (type === 'OUT') {
        result = await stockService.stockOut(payload);
      }
      if (type === 'ADJUSTMENT') {
        result = await stockService.adjust(payload);
      }
      const actionLabel = type === 'IN' ? 'Stok güncellendi' : type === 'OUT' ? 'Stok güncellendi' : 'Stok düzeltildi';
      setToast({ type: 'success', title: 'Stok İşlemleri', message: buildStockUpdateMessage(result?.movement, actionLabel) });
      reset(baseMovementForm);
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Stok İşlemleri', message: error.message || 'Stok hareketi oluşturulamadı.' });
    } finally {
      setProcessingType('');
    }
  };

  const submitOut = async () => {
    const errors = {};
    if (!outForm.productId) errors.productId = 'Ürün seçimi zorunludur.';
    if (!String(outForm.qty).trim()) errors.qty = 'Çıkış miktarı zorunludur.';
    if (!outForm.outputType) errors.outputType = 'Çıkış tipi zorunludur.';
    if (!outForm.sourceLocationType) errors.sourceLocationType = 'Kaynak lokasyon tipi zorunludur.';
    if (!String(outForm.sourceLocationCode || '').trim()) errors.sourceLocationCode = 'Kaynak lokasyon zorunludur.';

    const qty = parsePositiveNumber(outForm.qty);
    if (String(outForm.qty).trim() && qty === null) {
      errors.qty = 'Çıkış miktarı pozitif sayısal bir değer olmalıdır.';
    }

    const selectedStock = stockByProductId[outForm.productId] || null;
    const currentLocationStock = outForm.sourceLocationType === 'reyon' ?
      Number(selectedStock?.shelfStock || 0)
      : Number(selectedStock?.warehouseStock || 0);

    if (qty !== null && qty > currentLocationStock) {
      errors.qty = 'Stoktan fazla çıkış yapılamaz.';
    }

    const selectedLocation = outLocationOptions.find((item) => String(item.value) === String(outForm.sourceLocationCode || ''));
    const requiredStorageType = outSelectedProduct?.requiredStorageType || 'Ortam';
    if (outForm.sourceLocationType === 'depo' && selectedLocation) {
      if (String(selectedLocation.storageType || 'Ortam') !== String(requiredStorageType)) {
        errors.sourceLocationCode = 'Yanlış saklama tipli lokasyondan çıkış yapılamaz.';
      }
    }

    if (outBatchOptions.length > 0 && !String(outForm.batchNo || '').trim()) {
      errors.batchNo = 'Bu ürün için lot/parti seçimi zorunludur.';
    }

    const criticalThreshold = Number(selectedStock?.criticalStock || 0);
    const nextStock = qty !== null ? Math.max(0, currentLocationStock - qty) : currentLocationStock;
    const isCriticalOut = qty !== null && (qty >= (currentLocationStock * 0.5) || (criticalThreshold > 0 && nextStock <= criticalThreshold));
    if (isCriticalOut && !outForm.approvalConfirmed) {
      errors.approvalConfirmed = 'Kritik çıkış için onay kutusu zorunludur.';
    }

    setOutErrors(errors);
    if (Object.keys(errors).length) return;

    const mappedReason = OUT_TYPE_OPTIONS.find((item) => item.value === outForm.outputType)?.reasonCode || 'manual_adjustment';
    const payload = {
      productId: outForm.productId,
      qty,
      location: outForm.sourceLocationType,
      reasonCode: mappedReason,
      outputType: outForm.outputType,
      sourceLocationType: outForm.sourceLocationType,
      sourceLocationCode: outForm.sourceLocationCode,
      batchNo: outForm.batchNo || undefined,
      userNote: String(outForm.userNote || '').trim(),
      approvalRequired: isCriticalOut,
      note: buildMovementNote({
        batchNo: outForm.batchNo,
        note: [`Çıkış Tipi: ${outForm.outputType}`, `Kaynak: ${outForm.sourceLocationCode}`, String(outForm.userNote || '').trim()].filter(Boolean).join(' | '),
      }),
    };

    try {
      setProcessingType('OUT');
      const result = await stockService.stockOut(payload);
      setToast({ type: 'success', title: 'Stok Çıkışı', message: buildStockUpdateMessage(result?.movement, 'Stok çıkışı kaydedildi') });
      setOutForm(baseOutForm);
      setOutErrors({});
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Stok Çıkışı', message: error.message || 'Stok çıkışı kaydedilemedi.' });
    } finally {
      setProcessingType('');
    }
  };

  const submitTransfer = async () => {
    const errors = {};
    if (!transferForm.productId) errors.productId = 'Ürün seçimi zorunludur.';
    if (!String(transferForm.sourceWarehouseLocation || '').trim()) errors.sourceWarehouseLocation = 'Kaynak depo lokasyonu zorunludur.';
    if (!String(transferForm.qty).trim()) errors.qty = 'Transfer miktarı zorunludur.';
    if (!String(transferForm.targetSectionNumber || '').trim()) {
      errors.targetSectionId = 'Hedef reyon kodu zorunludur.';
    } else if (!transferResolvedTargetSection?.id) {
      errors.targetSectionId = 'Girilen hedef reyon kodu bulunamadı.';
    } else if (!isTransferTargetMatchingProductSection) {
      errors.targetSectionId = 'Bu ürün için kendi bağlı olduğu reyon kodunu kullanın.';
    }
    if (!transferForm.targetSide || !transferForm.targetShelfNo || !transferForm.targetLevelNo) errors.targetSlot = 'Hedef slot bilgisi eksik.';

    const qty = parsePositiveNumber(transferForm.qty);
    if (String(transferForm.qty).trim() && qty === null) {
      errors.qty = 'Transfer miktarı pozitif sayısal bir değer olmalıdır.';
    }

    if (!transferSelectedWarehouse || Number(transferSelectedWarehouse.stock || 0) <= 0) {
      errors.sourceWarehouseLocation = 'Kaynak depo lokasyonu boş olduğu için işlem yapılamaz.';
    }

    if (qty !== null && transferSelectedWarehouse && qty > Number(transferSelectedWarehouse.stock || 0)) {
      errors.qty = 'Transfer miktarı kaynak depo stokundan fazla olamaz.';
    }

    if (transferTargetCapacity > 0 && qty !== null && (transferTargetCurrentStock + qty) > transferTargetCapacity) {
      errors.qty = 'Reyon kapasitesi bu transfer için uygun değil.';
    }

    const requiredStorageType = transferSelectedProduct?.requiredStorageType || 'Ortam';
    if (transferSelectedWarehouse && String(transferSelectedWarehouse.storageType || 'Ortam') !== String(requiredStorageType)) {
      errors.sourceWarehouseLocation = 'Kaynak depo lokasyonu ürün saklama tipine uygun değil.';
    }

    setTransferErrors(errors);
    if (Object.keys(errors).length) return;

    try {
      setProcessingType('TRANSFER');
      const result = await stockService.transfer({
        productId: transferForm.productId,
        qty,
        fromLocation: transferForm.fromLocation,
        toLocation: transferForm.toLocation,
        note: [
          `Kaynak Depo Lokasyonu: ${transferForm.sourceWarehouseLocation}`,
          `Hedef Reyon: ${transferResolvedTargetSection?.number || transferForm.targetSectionNumber || '-'} (${transferResolvedTargetSection?.name || '-'})`,
          `Hedef Slot: ${transferForm.targetSide}-${transferForm.targetShelfNo}-${transferForm.targetLevelNo}`,
          String(transferForm.note || '').trim(),
        ].filter(Boolean).join(' | '),
      });
      const movement = result?.movement;
      const sourceLabel = movement?.fromLocation === 'reyon' ? 'Reyon' : 'Depo';
      const prev = Number(movement?.previousQuantity);
      const next = Number(movement?.nextQuantity);
      const msg = Number.isFinite(prev) && Number.isFinite(next) ?
        `Transfer kaydedildi: ${sourceLabel} ${formatNumber(prev)} -> ${formatNumber(next)}`
        : 'Depo/Reyon transferi kaydedildi.';
      setToast({ type: 'success', title: 'Stok İşlemleri', message: msg });
      setTransferForm(baseTransferForm);
      setTransferErrors({});
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Stok İşlemleri', message: error.message || 'Transfer işlemi başarısız.' });
    } finally {
      setProcessingType('');
    }
  };

  const submitTransferRequest = async () => {
    const errors = {};
    if (!transferForm.productId) errors.productId = 'Ürün seçimi zorunludur.';
    if (!String(transferForm.targetSectionNumber || '').trim()) {
      errors.targetSectionId = 'Hedef reyon kodu zorunludur.';
    } else if (!transferResolvedTargetSection?.id) {
      errors.targetSectionId = 'Talep için hedef reyon bulunamadı.';
    } else if (!isTransferTargetMatchingProductSection) {
      errors.targetSectionId = 'Talep için ürünün bağlı olduğu reyon kodunu girin.';
    }
    const qty = parsePositiveNumber(transferForm.qty);
    if (qty === null) errors.qty = 'Talep miktarı zorunludur.';
    if (!transferForm.targetSide || !transferForm.targetShelfNo || !transferForm.targetLevelNo) errors.targetSlot = 'Hedef slot bilgisi zorunludur.';

    setTransferErrors(errors);
    if (Object.keys(errors).length) return;

    try {
      setProcessingType('TRANSFER_REQUEST');
      await sectionService.createTransferRequest(transferResolvedTargetSection.id, {
        productId: transferForm.productId,
        quantity: qty,
        note: [
          `Talep Türü: Reyon Besleme`,
          `Hedef Reyon: ${transferResolvedTargetSection?.number || '-'} (${transferResolvedTargetSection?.name || '-'})`,
          `Hedef Taraf: ${transferForm.targetSide}`,
          `Hedef Raf: ${transferForm.targetShelfNo}`,
          `Hedef Kat: ${transferForm.targetLevelNo}`,
          `Gönderen: ${user?.name || user?.username || 'Kullanıcı'}`,
          String(transferForm.requestNote || '').trim(),
        ].filter(Boolean).join(' | '),
      });

      setToast({ type: 'success', title: 'Talep Gönderildi', message: 'Reyon besleme talebi kiosk kuyruğuna düştü (Yeni Talep).' });
      setTransferForm((current) => ({ ...baseTransferForm, productId: current.productId }));
      setTransferErrors({});
    } catch (error) {
      setToast({ type: 'error', title: 'Talep Gönder', message: error.message || 'Talep gönderilemedi.' });
    } finally {
      setProcessingType('');
    }
  };

  const selectPendingReceiptOrder = async (order) => {
    if (!order?.id) return;
    try {
      setPendingReceiptLoading(true);
      const items = await procurementService.getOrderItems(order.id);
      const safeItems = Array.isArray(items) ? items : [];
      const defaultItem = safeItems[0] || null;
      setSelectedPendingReceiptOrder(order);
      setSelectedPendingReceiptItems(safeItems);
      setSelectedPendingReceiptItemId(defaultItem ? String(defaultItem.id || defaultItem.productId || '') : '');
    } catch (error) {
      setToast({ type: 'error', title: 'Mal Kabul', message: error.message || 'Sipariş kalemleri yüklenemedi.' });
    } finally {
      setPendingReceiptLoading(false);
    }
  };

  const applyPendingOrderToReceiptForm = (order = selectedPendingReceiptOrder, item = selectedPendingReceiptItem) => {
    if (!order?.id || !item?.productId) return;
    const qty = Number(item.quantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const itemUnitPrice = Number(item.unitPrice || item.purchasePrice || 0);
    setReceiptForm((current) => ({
      ...current,
      productId: item.productId,
      supplierId: String(order.supplierId || current.supplierId || '').trim(),
      irsaliyeNo: String(order.orderNumber || current.irsaliyeNo || '').trim(),
      acceptedCaseCount: String(qty),
      qty: String(qty),
      purchasePrice: itemUnitPrice > 0 ? String(itemUnitPrice) : current.purchasePrice,
      acceptanceType: 'satın alma',
      acceptanceNote: order ?
        `${order.orderNumber || '-'} sipariş kalemi`
        : current.acceptanceNote,
    }));
    setReceiptErrors((current) => ({
      ...current,
      productId: '',
      supplierId: '',
      acceptedCaseCount: '',
      qty: '',
      purchasePrice: '',
    }));

    const itemKey = String(item.id || item.productId || '');
    if (itemKey && !autoLinkedNoticeSeenItemKeys[itemKey]) {
      setAutoLinkedNoticeSeenItemKeys((current) => ({ ...current, [itemKey]: true }));
      setAutoLinkedNoticeItemKey(itemKey);
    }
  };

  useEffect(() => {
    if (!selectedPendingReceiptOrder?.id || !selectedPendingReceiptItem) return;
    applyPendingOrderToReceiptForm(selectedPendingReceiptOrder, selectedPendingReceiptItem);
  }, [selectedPendingReceiptItem, selectedPendingReceiptOrder]);

  useEffect(() => {
    if (!selectedPendingReceiptOrder?.id || !selectedPendingReceiptItems.length) return;
    const itemExists = selectedPendingReceiptItems.some((item) => String(item.id || item.productId || '') === String(selectedPendingReceiptItemId || ''));
    if (!itemExists) {
      const firstItem = selectedPendingReceiptItems[0];
      setSelectedPendingReceiptItemId(String(firstItem.id || firstItem.productId || ''));
    }
  }, [selectedPendingReceiptItemId, selectedPendingReceiptItems, selectedPendingReceiptOrder]);

  useEffect(() => {
    if (!autoLinkedNoticeItemKey) return undefined;
    const timer = setTimeout(() => setAutoLinkedNoticeItemKey(''), 2200);
    return () => clearTimeout(timer);
  }, [autoLinkedNoticeItemKey]);

  const submitReceipt = async () => {
    const errors = {};
    if (!receiptForm.productId) errors.productId = 'Ürün seçimi zorunludur.';
    if (!String(receiptForm.batchNo).trim()) errors.batchNo = 'Parti No zorunludur.';
    if (!String(receiptForm.skt).trim()) errors.skt = 'SKT zorunludur.';
    if (!String(receiptForm.acceptedCaseCount).trim()) errors.acceptedCaseCount = 'Toplam kabul edilen koli zorunludur.';
    if (!String(receiptForm.acceptanceType).trim()) errors.acceptanceType = 'Kabul tipi zorunludur.';
    if (!String(receiptForm.receiptDate).trim()) errors.receiptDate = 'Mal kabul tarihi zorunludur.';
    if (!String(receiptForm.warehouseLocation).trim()) errors.warehouseLocation = 'Depo lokasyonu seçilmeden kayıt alınamaz.';

    if (selectedPendingReceiptOrder?.id) {
      if (!selectedPendingReceiptItem?.productId) {
        errors.productId = 'Sipariş kalemi seçimi zorunludur.';
      } else if (String(receiptForm.productId || '') !== String(selectedPendingReceiptItem.productId || '')) {
        errors.productId = 'Seçili sipariş kalemi ile ürün eşleşmiyor. Sipariş kalemini yeniden seçin.';
      } else {
        const selectedItemKey = String(selectedPendingReceiptItem.id || selectedPendingReceiptItem.productId || '');
        const alreadyEnteredForProduct = Number(pendingReceiptEnteredQtyByProduct[String(selectedPendingReceiptItem.productId || '')] || 0) > 0;
        if (alreadyEnteredForProduct) {
          errors.productId = 'Aynı ürün için siparişe bağlı mal kabul zaten oluşturuldu.';
        }
        if (selectedItemKey && receiptCompletedItemKeys[selectedItemKey]) {
          errors.productId = 'Bu sipariş kalemi için mal kabul zaten tamamlandı.';
        }
      }
    }

    const acceptedCaseCount = parsePositiveNumber(receiptForm.acceptedCaseCount);
    if (String(receiptForm.acceptedCaseCount).trim() && acceptedCaseCount === null) {
      errors.acceptedCaseCount = 'Koli miktarı pozitif sayısal bir değer olmalıdır.';
    }

    const qty = parsePositiveNumber(receiptForm.qty);
    if (qty === null) {
      errors.qty = 'Koli x koli içi adet ile hesaplanan giriş miktarı geçersiz.';
    }

    const purchasePrice = parsePositiveNumber(receiptForm.purchasePrice);
    if (purchasePrice === null) {
      errors.purchasePrice = 'Alış fiyatı pozitif bir sayı olmalıdır.';
    }

    const today = new Date().toISOString().slice(0, 10);
    if (receiptForm.skt && receiptForm.skt < today) {
      errors.skt = 'SKT bugünden geride olamaz.';
    }

    const selectedLocation = receiptLocationRows.find((item) => String(item.locationCode) === String(receiptForm.warehouseLocation));
    const requiredStorageType = receiptSelectedProduct?.requiredStorageType || 'Ortam';
    if (selectedLocation && String(selectedLocation.storageType || 'Ortam') !== String(requiredStorageType)) {
      errors.warehouseLocation = 'Seçilen depo lokasyonu ürünün saklama tipine uygun değil.';
    }

    const duplicateBatch = movements.some((item) => {
      if (String(item.productId || '') !== String(receiptForm.productId || '')) return false;
      const existingBatch = String(item.batchNo || parseBatchAndSktFromNote(item.note).batchNo || '').trim().toLowerCase();
      const incomingBatch = String(receiptForm.batchNo || '').trim().toLowerCase();
      return existingBatch && incomingBatch && existingBatch === incomingBatch;
    });
    if (duplicateBatch) {
      errors.batchNo = 'Aynı ürün için aynı parti numarası tekrar açılamaz.';
    }

    const receiptResolvedSupplierId = String(
      selectedPendingReceiptOrder?.supplierId
      || receiptForm.supplierId
      || receiptSelectedProduct?.supplierId
      || receiptSelectedProduct?.primarySupplierId
      || stockByProductId[receiptForm.productId]?.supplierId
      || ''
    ).trim();
    if (!receiptResolvedSupplierId) {
      errors.productId = 'Seçilen ürün için tedarikçi bilgisi bulunamadı. Sipariş seçip tekrar deneyin.';
    }

    setReceiptErrors(errors);
    if (Object.keys(errors).length) return;

    const payload = {
      productId: receiptForm.productId,
      qty,
      location: 'depo',
      entryType: 'receipt',
      reasonCode: 'product_purchase',
      batchNo: String(receiptForm.batchNo).trim(),
      skt: receiptForm.skt,
      purchasePrice,
      acceptedCaseCount,
      acceptanceType: receiptForm.acceptanceType,
      acceptanceNote: String(receiptForm.acceptanceNote || '').trim(),
      receiptDate: receiptForm.receiptDate,
      warehouseLocation: String(receiptForm.warehouseLocation || '').trim(),
      supplierId: receiptResolvedSupplierId,
      irsaliyeNo: String(receiptForm.irsaliyeNo || selectedPendingReceiptOrder?.orderNumber || '').trim() || `IRS-${Date.now()}`,
      productionDate: String(receiptForm.productionDate || receiptForm.receiptDate || getTodayDateValue()).trim(),
      note: buildMovementNote({
        batchNo: receiptForm.batchNo,
        skt: receiptForm.skt,
        note: [
          `Kabul Tipi: ${receiptForm.acceptanceType}`,
          String(receiptForm.acceptanceNote || '').trim(),
        ].filter(Boolean).join(' | '),
      }),
    };

    try {
      setProcessingType('RECEIPT');
      const result = await stockService.stockIn(payload);
      if (payload.warehouseLocation) {
        await warehouseService.createMovement({
          movementType: 'MAL_KABUL',
          productId: payload.productId,
          supplierId: payload.supplierId,
          locationCode: payload.warehouseLocation,
          batchNo: payload.batchNo,
          skt: payload.skt,
          qty: payload.qty,
          description: payload.note,
        });
      }

      setToast({ type: 'success', title: 'Mal Kabul', message: buildStockUpdateMessage(result?.movement, 'Mal kabul kaydı oluşturuldu') });
      setReceiptErrors({});
      if (selectedPendingReceiptOrder?.id) {
        const selectedItemKey = String(selectedPendingReceiptItem?.id || selectedPendingReceiptItem?.productId || '');
        if (selectedItemKey) {
          setReceiptCompletedItemKeys((current) => ({ ...current, [selectedItemKey]: true }));
        }
        const activeOrder = selectedPendingReceiptOrder;
        const activeItemKey = String(selectedPendingReceiptItem?.id || selectedPendingReceiptItem?.productId || '');
        setReceiptForm((current) => ({
          ...createBaseReceiptForm(),
          productId: current.productId,
          supplierId: current.supplierId,
          irsaliyeNo: current.irsaliyeNo,
          purchasePrice: current.purchasePrice,
        }));
        await loadData();
        await selectPendingReceiptOrder(activeOrder);
        if (activeItemKey) {
          setSelectedPendingReceiptItemId(activeItemKey);
        }
      } else {
        setReceiptForm(createBaseReceiptForm());
        await loadData();
      }
    } catch (error) {
      const rawError = String(error?.message || '');
      const friendlyMessage = rawError.includes('supplierId zorunludur') ?
        'Seçilen siparişin tedarikçi bilgisi bulunamadı. Lütfen siparişi yeniden seçin veya ürünün tedarikçi eşleşmesini tamamlayın.'
        : (error.message || 'Mal kabul kaydı oluşturulamadı.');
      setToast({ type: 'error', title: 'Mal Kabul', message: friendlyMessage });
    } finally {
      setProcessingType('');
    }
  };

  const submitDisposal = async () => {
    const errors = {};
    if (!disposalForm.productId) errors.productId = 'İmha için ürün seçimi zorunludur.';
    if (!String(disposalForm.qty).trim()) errors.qty = 'İmha miktarı zorunludur.';
    if (!disposalForm.reason) errors.reason = 'İmha nedeni zorunludur.';
    if (!String(disposalForm.batchNo || '').trim()) errors.batchNo = 'Parti / lot seçimi zorunludur.';
    if (!String(disposalForm.sourceLocationCode || '').trim()) errors.sourceLocationCode = 'Kaynak lokasyon zorunludur.';

    const qty = parsePositiveNumber(disposalForm.qty);
    if (String(disposalForm.qty).trim() && qty === null) {
      errors.qty = 'İmha miktarı pozitif sayısal bir değer olmalıdır.';
    }

    const selectedLocation = disposalLocationOptions.find((item) => String(item.value) === String(disposalForm.sourceLocationCode || ''));
    if (!selectedLocation || Number(selectedLocation.stock || 0) <= 0) {
      errors.sourceLocationCode = 'Seçilen lokasyonda imha edilecek stok bulunmuyor.';
    }

    if (qty !== null && selectedLocation && qty > Number(selectedLocation.stock || 0)) {
      errors.qty = 'İmha miktarı seçilen lokasyon stokundan fazla olamaz.';
    }

    if (qty !== null && disposalSelectedBatch && qty > Number(disposalSelectedBatch.qtyBalance || 0)) {
      errors.qty = 'İmha miktarı seçilen parti stokundan fazla olamaz.';
    }

    const requiredStorageType = disposalSelectedProduct?.requiredStorageType || 'Ortam';
    if (selectedLocation && String(selectedLocation.storageType || 'Ortam') !== String(requiredStorageType)) {
      errors.sourceLocationCode = 'Yanlış saklama tipindeki lokasyondan imha yapılamaz.';
    }

    const selectedStock = stockByProductId[disposalForm.productId] || null;
    const currentLocationStock = disposalForm.location === 'reyon' ?
      Number(selectedStock?.shelfStock || 0)
      : Number(selectedStock?.warehouseStock || 0);
    const criticalThreshold = Number(selectedStock?.criticalStock || 0);
    const nextStock = qty !== null ? Math.max(0, currentLocationStock - qty) : currentLocationStock;
    const isCriticalDisposal = qty !== null && (qty >= (currentLocationStock * 0.4) || (criticalThreshold > 0 && nextStock <= criticalThreshold));
    if (isCriticalDisposal && !disposalForm.approvalConfirmed) {
      errors.approvalConfirmed = 'Kritik imha için ikinci onay zorunludur.';
    }

    setDisposalErrors(errors);
    if (Object.keys(errors).length) return;

    const selectedReason = DISPOSAL_REASON_OPTIONS.find((item) => item.value === disposalForm.reason);
    const reasonText = selectedReason?.label || 'İmha';
    const combinedNote = [
      `İmha Nedeni: ${reasonText}`,
      `Parti: ${disposalForm.batchNo}`,
      `Kaynak Lokasyon: ${disposalForm.sourceLocationCode}`,
      String(disposalForm.note || '').trim(),
    ].filter(Boolean).join(' | ');

    try {
      setProcessingType('DISPOSAL');
      const result = await stockService.stockOut({
        productId: disposalForm.productId,
        qty,
        location: disposalForm.location,
        reasonCode: 'write_off',
        sourceLocationType: disposalForm.location,
        sourceLocationCode: disposalForm.sourceLocationCode,
        batchNo: disposalForm.batchNo,
        note: combinedNote,
      });
      setToast({ type: 'success', title: 'Stok İşlemleri', message: buildStockUpdateMessage(result?.movement, 'İmha işlemi kaydedildi') });
      setDisposalForm(baseDisposalForm);
      setDisposalErrors({});
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Stok İşlemleri', message: error.message || 'İmha işlemi başarısız.' });
    } finally {
      setProcessingType('');
    }
  };

  const openExpiredBatchDisposal = (rows) => {
    const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (!safeRows.length) {
      setToast({ type: 'error', title: 'SKT Uyarıları', message: 'İmha için en az bir SKT geçmiş parti seçin.' });
      return;
    }
    setExpiredBatchDisposalTarget(safeRows);
    setExpiredBatchDisposalNote('');
  };

  const confirmExpiredBatchDisposal = async () => {
    const rows = Array.isArray(expiredBatchDisposalTarget) ? expiredBatchDisposalTarget : [];
    if (!rows.length) return;

    try {
      setProcessingType('EXPIRED_DISPOSAL');
      const result = await stockService.disposeExpiredBatches({
        items: rows.map((row) => ({ batchId: row.id })),
        reason: 'SKT geçmiş ürün imhası',
        note: expiredBatchDisposalNote,
      });
      setToast({
        type: 'success',
        title: 'SKT Uyarıları',
        message: `${formatNumber(result?.disposedBatchCount || rows.length)} parti batch düzeyinde imha edildi.`,
      });
      setExpiredBatchDisposalTarget(null);
      setExpiredBatchDisposalNote('');
      setSelectedExpiredBatchIds([]);
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'SKT Uyarıları', message: error.message || 'SKT geçmiş ürün imhası başarısız.' });
    } finally {
      setProcessingType('');
    }
  };

  const submitTotalAdjustment = async () => {
    const errors = {};
    if (!adjustForm.productId) errors.productId = 'Ürün seçimi zorunludur.';
    if (!adjustForm.adjustmentReason) errors.adjustmentReason = 'Düzeltme sebebi zorunludur.';
    if (!String(adjustForm.targetQuantity).trim()) errors.targetQuantity = 'Yeni stok seviyesi zorunludur.';
    if (!String(adjustForm.description || '').trim()) errors.description = 'Açıklama zorunludur.';
    if (adjustForm.isBatchBased && !String(adjustForm.batchNo || '').trim()) errors.batchNo = 'Parti bazlı düzeltmede lot/parti seçimi zorunludur.';

    const targetQty = parseNonNegativeNumber(adjustForm.targetQuantity);
    if (String(adjustForm.targetQuantity).trim() && targetQty === null) {
      errors.targetQuantity = 'Yeni stok seviyesi 0 veya daha büyük olmalıdır.';
    }
    if (adjustDifference === 0) {
      errors.targetQuantity = 'Eski stok ve yeni stok farklı olmalıdır.';
    }
    if (adjustIsHighDifference && !adjustForm.highRiskConfirmed) {
      errors.highRiskConfirmed = 'Yüksek fark için ek onay zorunludur.';
    }

    setAdjustErrors(errors);
    if (Object.keys(errors).length) return;

    try {
      setProcessingType('ADJUSTMENT');

      const noteBase = [
        `Düzeltme Sebebi: ${adjustForm.adjustmentReason}`,
        `Kapsam: ${adjustForm.scope === 'lokasyon' ? 'Lokasyon Bazlı' : 'Toplam Stok'}`,
        adjustForm.isBatchBased ? `Parti: ${adjustForm.batchNo}` : '',
        String(adjustForm.description || '').trim(),
      ].filter(Boolean).join(' | ');

      if (adjustForm.scope === 'lokasyon') {
        await stockService.adjust({
          productId: adjustForm.productId,
          location: adjustForm.location,
          targetQuantity: targetQty,
          reasonCode: 'manual_adjustment',
          note: noteBase,
          batchNo: adjustForm.isBatchBased ? adjustForm.batchNo : undefined,
        });
      } else {
        const selectedStock = stocks.find((item) => item.productId === adjustForm.productId);
        const warehouseStock = Number(selectedStock?.warehouseStock || selectedStock?.warehouseQuantity || 0);
        const shelfStock = Number(selectedStock?.shelfStock || selectedStock?.shelfQuantity || 0);
        const currentTotal = Number(selectedStock?.totalStock || selectedStock?.quantity || (warehouseStock + shelfStock));

        if (targetQty > currentTotal) {
          await stockService.stockIn({
            productId: adjustForm.productId,
            qty: targetQty - currentTotal,
            location: 'depo',
            reasonCode: 'manual_adjustment',
            note: noteBase,
            batchNo: adjustForm.isBatchBased ? adjustForm.batchNo : undefined,
          });
        } else {
          let remainingDecrease = currentTotal - targetQty;

          const depoDecrease = Math.min(remainingDecrease, warehouseStock);
          if (depoDecrease > 0) {
            await stockService.stockOut({
              productId: adjustForm.productId,
              qty: depoDecrease,
              location: 'depo',
              reasonCode: 'manual_adjustment',
              note: noteBase,
              batchNo: adjustForm.isBatchBased ? adjustForm.batchNo : undefined,
            });
            remainingDecrease -= depoDecrease;
          }

          if (remainingDecrease > 0) {
            if (remainingDecrease > shelfStock) {
              throw new Error('Toplam stok düşümü için yeterli reyon stoğu bulunamadı.');
            }

            await stockService.stockOut({
              productId: adjustForm.productId,
              qty: remainingDecrease,
              location: 'reyon',
              reasonCode: 'manual_adjustment',
              note: noteBase,
              batchNo: adjustForm.isBatchBased ? adjustForm.batchNo : undefined,
            });
          }
        }
      }

      setToast({
        type: 'success',
        title: 'Stok Düzeltme',
        message: 'Stok düzeltmesi kaydedildi.',
      });
      setAdjustForm(baseAdjustmentForm);
      setAdjustErrors({});
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Stok İşlemleri', message: error.message || 'Toplam stok düzeltmesi başarısız.' });
    } finally {
      setProcessingType('');
    }
  };

  const openQuickEntryModal = (type) => {
    setQuickEntryType(type);
    setQuickEntryForm(baseQuickEntryForm);
    setQuickEntryScanError('');
    setQuickEntryModalOpen(true);
  };

  const closeQuickEntryModal = () => {
    stopQuickEntryScanner();
    setQuickEntryModalOpen(false);
    setQuickEntryForm(baseQuickEntryForm);
    setQuickEntryScanError('');
  };

  const resolveBarcodeToProduct = useCallback(async (barcodeValue) => {
    const barcode = String(barcodeValue || '').trim();
    if (!barcode) {
      setQuickEntryScanError('Barkod girin veya okutun.');
      return;
    }
    setQuickEntryScanError('');
    try {
      const product = await productService.findByBarcode(barcode);
      if (!product?.id) {
        setQuickEntryScanError('Barkoda ait ürün bulunamadı.');
        return;
      }
      setQuickEntryForm((current) => ({
        ...current,
        barcode,
        productId: product.id,
      }));
    } catch {
      setQuickEntryScanError('Barkoda ait ürün bulunamadı.');
    }
  }, []);

  const resolveCountProduct = useCallback(async (barcodeValue) => {
    const barcode = String(barcodeValue || '').trim();
    if (!barcode) {
      setCountMessage({ tone: 'error', text: 'Barkod girin veya okutun.' });
      setCountForm((current) => ({ ...current, productId: '', physicalQuantity: '' }));
      return;
    }

    try {
      setCountLookupLoading(true);
      setCountMessage(null);
      const product = await productService.findByBarcode(barcode);
      if (!product?.id) {
        setCountForm((current) => ({ ...current, barcode, productId: '', physicalQuantity: '' }));
        setCountMessage({ tone: 'error', text: 'Barkoda ait ürün bulunamadı.' });
        return;
      }

      setCountForm({
        barcode,
        productId: product.id,
        physicalQuantity: '',
      });
      setCountMessage(null);
    } catch {
      setCountForm((current) => ({ ...current, barcode, productId: '', physicalQuantity: '' }));
      setCountMessage({ tone: 'error', text: 'Barkoda ait ürün bulunamadı.' });
    } finally {
      setCountLookupLoading(false);
    }
  }, []);

  const handleCountLookup = async (event) => {
    event.preventDefault();
    await resolveCountProduct(countForm.barcode);
  };

  const registerCountArchiveRecord = useCallback((payload) => {
    const record = createInventoryCountRecord(payload);
    setCountArchiveRecords((current) => {
      const next = [record, ...current];
      writeInventoryCountArchive(next);
      return next;
    });
    setCountArchivePage(1);
    return record;
  }, []);

  const submitCount = async () => {
    if (!countForm.productId) {
      setCountMessage({ tone: 'error', text: 'Önce barkod okutun veya ürün bulun.' });
      return;
    }

    if (!String(countForm.physicalQuantity || '').trim()) {
      setCountMessage({ tone: 'error', text: 'Fiziksel sayım miktarı zorunludur.' });
      return;
    }

    if (countPhysicalQuantity === null) {
      setCountMessage({ tone: 'error', text: 'Fiziksel sayım miktarı 0 veya daha büyük sayısal bir değer olmalıdır.' });
      return;
    }

    if (countDifference === 0) {
      registerCountArchiveRecord({
        product: countSelectedProduct || countSelectedStock,
        systemStock: countExpectedQuantity,
        physicalCount: countPhysicalQuantity,
        actorName: String(user?.name || 'Sistem').trim() || 'Sistem',
        resultCode: 'matched',
        resultLabel: 'Eşleşti',
      });
      setCountMessage({ tone: 'info', text: 'Fark yok. Stok hareketi oluşturulmadı.' });
      return;
    }

    if ((countDifference || 0) < 0) {
      registerCountArchiveRecord({
        product: countSelectedProduct || countSelectedStock,
        systemStock: countExpectedQuantity,
        physicalCount: countPhysicalQuantity,
        actorName: String(user?.name || 'Sistem').trim() || 'Sistem',
        resultCode: 'surplus',
        resultLabel: 'Fazla',
      });
      setCountMessage({ tone: 'warning', text: 'Fazla stok tespit edildi, manuel giriş veya onaylı düzeltme gerekir.' });
      return;
    }

    const deficit = Number(countDifference || 0);
    const movementDate = new Date().toISOString();
    const actorName = String(user?.name || 'Sistem').trim() || 'Sistem';

    try {
      setProcessingType('COUNT');
      setCountMessage(null);

      let remainingDeficit = deficit;
      let currentWarehouse = countWarehouseStock;
      let currentShelf = countShelfStock;
      const baseNoteParts = [
        'Sebep: Sayım farkı',
        'Kaynak: Sayım Modülü',
        `İşlemi Yapan: ${actorName}`,
        `İşlem Tarihi: ${movementDate}`,
        `Beklenen Miktar: ${countExpectedQuantity}`,
        `Fiziksel Sayım: ${countPhysicalQuantity}`,
        `Fark Miktarı: ${deficit}`,
      ];

      const warehouseDecrease = Math.min(remainingDeficit, currentWarehouse);
      if (warehouseDecrease > 0) {
        const nextWarehouse = currentWarehouse - warehouseDecrease;
        await stockService.stockOut({
          productId: countForm.productId,
          qty: warehouseDecrease,
          location: 'depo',
          reasonCode: 'count_deficit',
          reasonLabel: 'Sayım Farkı',
          note: [
            ...baseNoteParts,
            `Eski Stok: ${currentWarehouse}`,
            `Yeni Stok: ${nextWarehouse}`,
            `Düşülen Lokasyon: Depo`,
          ].join(' | '),
        });
        currentWarehouse = nextWarehouse;
        remainingDeficit -= warehouseDecrease;
      }

      const shelfDecrease = Math.min(remainingDeficit, currentShelf);
      if (shelfDecrease > 0) {
        const nextShelf = currentShelf - shelfDecrease;
        await stockService.stockOut({
          productId: countForm.productId,
          qty: shelfDecrease,
          location: 'reyon',
          reasonCode: 'count_deficit',
          reasonLabel: 'Sayım Farkı',
          note: [
            ...baseNoteParts,
            `Eski Stok: ${currentShelf}`,
            `Yeni Stok: ${nextShelf}`,
            `Düşülen Lokasyon: Reyon`,
          ].join(' | '),
        });
        currentShelf = nextShelf;
        remainingDeficit -= shelfDecrease;
      }

      if (remainingDeficit > 0) {
        throw new Error('Sayım farkı kadar düşülecek yeterli stok bulunamadı.');
      }

      setToast({
        type: 'success',
        title: 'Sayım',
        message: 'Sayım farkı işlendi ve stok düşümü kaydedildi.',
      });
      registerCountArchiveRecord({
        product: countSelectedProduct || countSelectedStock,
        systemStock: countExpectedQuantity,
        physicalCount: countPhysicalQuantity,
        actorName,
        countedAt: movementDate,
        resultCode: 'deficit',
        resultLabel: 'Eksik',
      });
      setCountMessage({ tone: 'success', text: 'Sayım kaydedildi.' });
      setCountForm(baseCountForm);
      await loadData();
    } catch (error) {
      setCountMessage({ tone: 'error', text: error.message || 'Sayım kaydı oluşturulamadı.' });
      setToast({
        type: 'error',
        title: 'Sayım',
        message: error.message || 'Sayım kaydı oluşturulamadı.',
      });
    } finally {
      setProcessingType('');
    }
  };

  const startQuickEntryScanner = useCallback(async () => {
    if (quickEntryScannerRef.current) {
      return;
    }
    setQuickEntryScanError('');
    setQuickEntryScanning(true);

    try {
      const Html5Qrcode = await loadHtml5Qrcode();
      await waitForCameraElement('quick-stock-reader');
      const scanner = new Html5Qrcode('quick-stock-reader');
      quickEntryScannerRef.current = scanner;

      await startHtml5Scanner(
        scanner,
        { fps: 10, qrbox: { width: 250, height: 140 } },
        async (decodedText) => {
          stopQuickEntryScanner();
          await resolveBarcodeToProduct(decodedText);
        },
        () => {}
      );
    } catch (error) {
      logCameraError(error, 'quick-stock');
      try { await quickEntryScannerRef.current?.clear(); } catch {}
      quickEntryScannerRef.current = null;
      setQuickEntryScanning(false);
      setQuickEntryScanError(`${getCameraErrorMessage(error)} ${CAMERA_PERMISSION_HELP_TEXT}`);
    }
  }, [resolveBarcodeToProduct, stopQuickEntryScanner]);

  const submitQuickEntry = async (event) => {
    event.preventDefault();
    if (!quickEntryForm.productId) {
      setToast({ type: 'error', title: 'Hızlı Giriş', message: 'Önce barkod okutun.' });
      return;
    }
    if (!String(quickEntryForm.qty).trim()) {
      setToast({ type: 'error', title: 'Hızlı Giriş', message: 'Miktar zorunludur.' });
      return;
    }

    const qty = parsePositiveNumber(quickEntryForm.qty);
    if (qty === null) {
      setToast({ type: 'error', title: 'Hızlı Giriş', message: 'Miktar pozitif sayısal bir değer olmalıdır.' });
      return;
    }

    const note = 'Hızlı barkod işlemi';

    const payload = {
      productId: quickEntryForm.productId,
      qty,
      location: 'depo',
      reasonCode: quickEntryType === 'IN' ? 'product_purchase' : 'manual_adjustment',
      note,
    };

    try {
      setProcessingType(`QUICK_${quickEntryType}`);
      let result = null;
      if (quickEntryType === 'IN') {
        result = await stockService.stockIn(payload);
      } else {
        result = await stockService.stockOut(payload);
      }
      setToast({
        type: 'success',
        title: 'Hızlı Giriş',
        message: buildStockUpdateMessage(result?.movement, `${quickEntryType === 'IN' ? 'Stok girişi' : 'Stok çıkışı'} barkod ile kaydedildi`),
      });
      closeQuickEntryModal();
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Hızlı Giriş', message: error.message || 'Hızlı barkod kaydı başarısız.' });
    } finally {
      setProcessingType('');
    }
  };

  const handleCancelMovement = async () => {
    if (!cancelTargetMovement?.id) return;
    try {
      setCancelProcessing(true);
      await stockService.cancelMovement(cancelTargetMovement.id, {
        reason: 'İşlem öncesi bağlam ekranından kullanıcı iptali',
      });
      setToast({
        type: 'success',
        title: 'İşlem İptali',
        message: 'Hareket iptal edildi ve stok geri alındı.',
      });
      setCancelTargetMovement(null);
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'İşlem İptali', message: error.message || 'Hareket iptal edilemedi.' });
    } finally {
      setCancelProcessing(false);
    }
  };

  const quickSelectedProduct = useMemo(() => {
    if (!quickEntryForm.productId) return null;
    return stocks.find((item) => item.productId === quickEntryForm.productId) || null;
  }, [quickEntryForm.productId, stocks]);

  const supplierById = useMemo(() => {
    const map = new Map();
    suppliers.forEach((item) => map.set(String(item.id), item.name || '-'));
    return map;
  }, [suppliers]);

  const selectedContextProductId = useMemo(() => {
    if (activeOperation === 'RECEIPT') return receiptForm.productId;
    if (activeOperation === 'OUT') return outForm.productId;
    if (activeOperation === 'TRANSFER') return transferForm.productId;
    if (activeOperation === 'ADJUSTMENT') return adjustForm.productId;
    if (activeOperation === 'DISPOSAL') return disposalForm.productId;
    return '';
  }, [activeOperation, adjustForm.productId, disposalForm.productId, outForm.productId, receiptForm.productId, transferForm.productId]);

  const pendingReceiptColumns = useMemo(() => ([
    { key: 'orderNumber', label: 'Sipariş No' },
    { key: 'supplierName', label: 'Tedarikçi' },
    {
      key: 'warehouseCity',
      label: 'Depo / Mağaza',
      render: (row) => row.warehouseCity || row.deliveryLocation || '-',
    },
    {
      key: 'itemCount',
      label: 'Kalem',
      render: (row) => formatNumber(row.itemCount || 0),
      sortValue: (row) => Number(row.itemCount || 0),
    },
    {
      key: 'grandTotal',
      label: 'Toplam',
      render: (row) => formatCurrency(row.grandTotal ?? row.totalAmount ?? 0),
      sortValue: (row) => Number(row.grandTotal ?? row.totalAmount ?? 0),
    },
    {
      key: 'status',
      label: 'Lifecycle',
      render: (row) => getPurchaseOrderStatusLabel(row.status || row.currentStatus),
    },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      render: (row) => (
        <button
          type="button"
          className="text-button"
          onClick={() => selectPendingReceiptOrder(row)}
          disabled={pendingReceiptLoading}
        >
          Seç
        </button>
      ),
    },
  ]), [pendingReceiptLoading]);

  const filteredPendingReceiptOrders = useMemo(() => {
    const query = String(pendingReceiptIdQuery || '').trim().toLowerCase();
    if (!query) return pendingReceiptOrders;
    return pendingReceiptOrders.filter((row) => {
      const orderId = String(row.id || '').toLowerCase();
      const orderNo = String(row.orderNumber || '').toLowerCase();
      return orderId.includes(query) || orderNo.includes(query);
    });
  }, [pendingReceiptIdQuery, pendingReceiptOrders]);

  const renderReadonlyProductBlock = (productId) => {
    const stock = stockByProductId[productId] || {};
    const product = productsById[productId] || {};
    const hasProduct = Boolean(productId);
    const readonlyItems = [
      { label: 'Ürün', value: hasProduct ? (product.name || stock.productName || '-') : '-' },
      { label: 'SKU', value: hasProduct ? (product.sku || stock.sku || '-') : '-' },
      { label: 'Barkod', value: hasProduct ? (product.barcode || '-') : '-' },
      { label: 'Birim', value: hasProduct ? (product.unit || stock.unit || '-') : '-' },
      { label: 'Saklama', value: hasProduct ? getStorageTypeLabel(product.requiredStorageType) : '-' },
      { label: 'Toplam', value: hasProduct ? formatNumber(stock.totalStock || stock.quantity || 0) : '-' },
      { label: 'Depo', value: hasProduct ? formatNumber(stock.warehouseStock || 0) : '-' },
      { label: 'Reyon', value: hasProduct ? formatNumber(stock.shelfStock || 0) : '-' },
      { label: 'Kritik', value: hasProduct ? formatNumber(stock.criticalStock || product.criticalStock || 0) : '-' },
    ];

    return (
      <div className="movement-readonly-block movement-readonly-inline">
        <div className="movement-readonly-chips" aria-label="Seçili ürün özet bilgileri">
          {readonlyItems.map((item) => (
            <span key={item.label} className="movement-readonly-chip">
              <strong>{item.label}</strong>
              <em>{item.value}</em>
            </span>
          ))}
        </div>
      </div>
    );
  };

  const renderMovementContext = (productId, operationType) => {
    const operationMeta = OPERATION_HISTORY_META[operationType] || OPERATION_HISTORY_META.RECEIPT;

    if (!productId) {
      return (
        <div className="movement-context-template" aria-hidden="true">
          <div className="movement-context-stock-grid">
            <div className="movement-context-stock-item movement-context-stock-item-placeholder">
              <span>Toplam</span>
              <strong>-</strong>
            </div>
            <div className="movement-context-stock-item movement-context-stock-item-placeholder">
              <span>Depo</span>
              <strong>-</strong>
            </div>
            <div className="movement-context-stock-item movement-context-stock-item-placeholder">
              <span>Reyon</span>
              <strong>-</strong>
            </div>
          </div>
          <div className="movement-context-history movement-context-history-placeholder">
            <div className="movement-context-history-title">Son stok hareketleri</div>
            <ul>
              <li><span className="movement-context-history-badge tone-neutral">--</span><span>Hareket kaydı bekleniyor</span></li>
              <li><span className="movement-context-history-badge tone-neutral">--</span><span>Hareket kaydı bekleniyor</span></li>
            </ul>
          </div>
          <div className="movement-context-history movement-context-history-placeholder movement-context-history-secondary">
            <div className="movement-context-history-title">{operationMeta.title}</div>
            <ul>
              <li><span className="movement-context-history-badge tone-neutral">--</span><span>İşlem kaydı bekleniyor</span></li>
              <li><span className="movement-context-history-badge tone-neutral">--</span><span>İşlem kaydı bekleniyor</span></li>
            </ul>
          </div>
          <div className="movement-readonly-block">
            <div className="movement-readonly-grid">
              <label className="field-group"><span>Saklama Tipi</span><input value="-" readOnly /></label>
              <label className="field-group"><span>Varsayılan Tedarikçi</span><input value="-" readOnly /></label>
              <label className="field-group"><span>Son Alış Fiyatı</span><input value="-" readOnly /></label>
              <label className="field-group"><span>Son İşlem Yapan</span><input value="-" readOnly /></label>
            </div>
          </div>
        </div>
      );
    }

    const stock = stockByProductId[productId];
    const product = productsById[productId] || {};
    const allRecent = recentMovementsByProductId[productId] || [];
    const recent = allRecent.slice(0, 5);
    const operationRecent = allRecent.filter(operationMeta.matcher).slice(0, 5);
    if (!stock) {
      return <div className="movement-context-empty">Seçili ürün için stok kaydı bulunamadı.</div>;
    }

    const lastInMovement = movements.find((item) => String(item.productId || '') === String(productId) && item.type === 'IN') || null;
    const lastMovementUser = (recent.find((item) => String(item.userName || '').trim())?.userName || '-');
    const defaultSupplierName = product.supplierName
      || supplierById.get(String(product.supplierId || product.primarySupplierId || stock.supplierId || ''))
      || stock.supplierName
      || '-';
    const lastPurchasePrice = Number(lastInMovement?.purchasePrice || product.purchasePrice || 0);

    return (
      <div className="movement-context-wrap">
        <div className="movement-context-stock-grid">
          <div className="movement-context-stock-item">
            <span>Toplam</span>
            <strong>{formatNumber(stock.totalStock || stock.quantity || 0)}</strong>
          </div>
          <div className="movement-context-stock-item">
            <span>Depo</span>
            <strong>{formatNumber(stock.warehouseStock || 0)}</strong>
          </div>
          <div className="movement-context-stock-item">
            <span>Reyon</span>
            <strong>{formatNumber(stock.shelfStock || 0)}</strong>
          </div>
        </div>
        <div className="movement-readonly-block">
          <div className="movement-readonly-grid">
            <label className="field-group"><span>Saklama Tipi</span><input value={getStorageTypeLabel(product.requiredStorageType)} readOnly /></label>
            <label className="field-group"><span>Varsayılan Tedarikçi</span><input value={defaultSupplierName} readOnly /></label>
            <label className="field-group"><span>Son Alış Fiyatı</span><input value={Number.isFinite(lastPurchasePrice) && lastPurchasePrice > 0 ? `${formatNumber(lastPurchasePrice)} TL` : '-'} readOnly /></label>
            <label className="field-group"><span>Son İşlem Yapan</span><input value={lastMovementUser} readOnly /></label>
          </div>
        </div>
        <div className="movement-context-history">
          <div className="movement-context-history-title">Son stok hareketleri</div>
          {recent.length ? (
            <ul>
              {recent.map((item) => {
                const sign = item.type === 'IN' ? '+' : item.type === 'OUT' ? '-' : item.type === 'TRANSFER' ? '-' : '±';
                const qty = formatNumber(item.qty || 0);
                const label = TYPE_LABELS[item.type] || item.type;
                return (
                  <li key={item.id}>
                    <span className={`movement-context-history-badge tone-${item.type?.toLowerCase() || 'neutral'}`}>{sign}{qty}</span>
                    <span>{label} - {formatRelativeTime(item.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted-text">Bu ürün için hareket kaydı bulunmuyor.</p>
          )}
        </div>
        <div className="movement-context-history movement-context-history-secondary">
          <div className="movement-context-history-title">{operationMeta.title}</div>
          {operationRecent.length ? (
            <ul>
              {operationRecent.map((item) => {
                const sign = item.type === 'IN' ? '+' : item.type === 'OUT' ? '-' : item.type === 'TRANSFER' ? '-' : '±';
                const qty = formatNumber(item.qty || 0);
                const label = TYPE_LABELS[item.type] || item.type;
                const canCancel = isAdmin && !item.cancelledAt && !item.cancellationOfMovementId;
                return (
                  <li key={`op-${item.id}`}>
                    <span className={`movement-context-history-badge tone-${item.type?.toLowerCase() || 'neutral'}`}>{sign}{qty}</span>
                    <span>{label} - {formatRelativeTime(item.createdAt)}{item.cancelledAt ? ' (İptal Edildi)' : ''}</span>
                    {canCancel ? (
                      <button
                        type="button"
                        className="ghost-button movement-context-cancel-btn"
                        onClick={() => setCancelTargetMovement(item)}
                      >
                        İptal Et
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted-text">Bu işlem tipi için henüz kayıt bulunmuyor.</p>
          )}
        </div>
      </div>
    );
  };

  const stockColumns = [
    { key: 'sku', label: 'SKU' },
    { key: 'productName', label: 'Ürün', render: (row) => formatUnit(row.productName) },
    { key: 'warehouseStock', label: 'Depo Stok', sortValue: (row) => row.warehouseStock || 0 },
    { key: 'shelfStock', label: 'Reyon Stok', sortValue: (row) => row.shelfStock || 0 },
    { key: 'totalStock', label: 'Toplam Stok', sortValue: (row) => row.totalStock || row.quantity || 0 },
    { key: 'criticalStock', label: 'Kritik Eşik' },
    { key: 'unit', label: 'Birim' },
    {
      key: 'isActive',
      label: 'Durum',
      render: (row) => <StatusBadge tone={row.isActive ? 'success' : 'danger'}>{row.isActive ? 'Aktif' : 'Pasif'}</StatusBadge>,
      sortable: false,
    },
    {
      key: 'isCritical',
      label: 'Stok Uyarısı',
      render: (row) => {
        const totalStock = row.totalStock || row.quantity || 0;
        if (totalStock <= 0) {
          return <StatusBadge tone="danger">Tükenmiş</StatusBadge>;
        }
        if (row.isCritical) {
          return <StatusBadge tone="warning">Kritik</StatusBadge>;
        }
        return <StatusBadge tone="neutral">Normal</StatusBadge>;
      },
      sortable: false,
    },
  ];

  const selectedExpiredBatchRows = expiredBatchRows.filter((row) => selectedExpiredBatchIds.some((id) => String(id) === String(row.id)));
  const allExpiredRowsSelected = expiredBatchRows.length > 0 && selectedExpiredBatchIds.length === expiredBatchRows.length;
  const expiredBatchColumns = [
    {
      key: 'select',
      label: '',
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedExpiredBatchIds.some((id) => String(id) === String(row.id))}
          onChange={(event) => {
            setSelectedExpiredBatchIds((current) => event.target.checked
              ? Array.from(new Set([...current, row.id]))
              : current.filter((id) => String(id) !== String(row.id)));
          }}
          disabled={!isAdmin || processingType === 'EXPIRED_DISPOSAL'}
          aria-label={`${row.batchNo} partisini seç`}
        />
      ),
      sortable: false,
    },
    { key: 'productName', label: 'Ürün adı', render: (row) => formatUnit(row.productName) },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Barkod', render: (row) => row.barcode || '-' },
    { key: 'batchNo', label: 'Parti No' },
    { key: 'skt', label: 'SKT Tarihi', render: (row) => formatDate(row.skt), sortValue: (row) => new Date(row.skt).getTime() },
    { key: 'warehouseQuantity', label: 'Depo Stok', render: (row) => formatNumber(row.warehouseQuantity || 0), sortValue: (row) => row.warehouseQuantity || 0 },
    { key: 'shelfQuantity', label: 'Reyon Stok', render: (row) => formatNumber(row.shelfQuantity || 0), sortValue: (row) => row.shelfQuantity || 0 },
    { key: 'totalQuantity', label: 'Toplam Stok', render: (row) => formatNumber(row.totalQuantity || 0), sortValue: (row) => row.totalQuantity || 0 },
    {
      key: 'riskStatus',
      label: 'Risk / Durum',
      render: (row) => <StatusBadge tone={row.daysExpired > 30 ? 'danger' : 'warning'}>{row.riskStatus || 'SKT geçmiş'}</StatusBadge>,
      sortable: false,
    },
    {
      key: 'action',
      label: 'Aksiyon',
      render: (row) => (
        <button
          className="danger-button movement-inline-action movement-inline-action-compact"
          type="button"
          onClick={() => openExpiredBatchDisposal([row])}
          disabled={!isAdmin || processingType === 'EXPIRED_DISPOSAL'}
        >
          İmha Et
        </button>
      ),
      sortable: false,
    },
  ];

  const movementColumns = [
    { key: 'referenceNo', label: 'Ref No' },
    { key: 'transferRequestId', label: 'Talep ID', render: (row) => row.transferRequestId || '-' },
    { key: 'productName', label: 'Ürün', render: (row) => formatUnit(row.productName) },
    { key: 'sku', label: 'SKU' },
    { key: 'type', label: 'Tip', render: (row) => <StatusBadge tone={row.type === 'IN' ? 'success' : row.type === 'OUT' ? 'danger' : row.type === 'TRANSFER' ? 'primary' : 'warning'}>{TYPE_LABELS[row.type] || row.type}</StatusBadge>, sortable: false },
    { key: 'sourceLocation', label: 'Kaynak', render: (row) => row.fromLocationLabel || formatStockLocationLabel(row.fromLocation, '-') },
    { key: 'targetLocation', label: 'Hedef', render: (row) => row.toLocationLabel || formatStockLocationLabel(row.toLocation, '-') },
    { key: 'reasonLabel', label: 'Sebep', render: (row) => <StatusBadge tone={REASON_TONE[row.reasonCode] || 'neutral'}>{row.reasonLabel || row.reason || 'Bilinmiyor'}</StatusBadge>, sortable: false },
    {
      key: 'location',
      label: 'Konum',
      render: (row) => {
        return row.routeLabel || formatMovementRouteLabel(row, '-');
      },
      sortable: false,
    },
    { key: 'qty', label: 'Miktar' },
    { key: 'transferRequestStatus', label: 'Durum', render: (row) => row.transferRequestStatus || '-' },
    { key: 'previousQuantity', label: 'Önceki Stok' },
    { key: 'nextQuantity', label: 'Sonraki Stok' },
    { key: 'userName', label: 'İşlemi Yapan' },
    { key: 'note', label: 'Not', render: (row) => row.note || '-' },
    { key: 'createdAt', label: 'Tarih', render: (row) => formatDate(row.createdAt), sortValue: (row) => new Date(row.createdAt).getTime() },
  ];

  return (
    <div className="page-stack stock-movements-page">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <ConfirmModal
        isOpen={Boolean(cancelTargetMovement)}
        title="Stok Hareketini İptal Et"
        description={cancelTargetMovement ? `Bu hareket iptal edilecek ve stok geri alınacak. Ref: ${cancelTargetMovement.referenceNo || '-'} işlemini iptal etmek istediğinize emin misiniz?` : ''}
        confirmText={cancelProcessing ? 'İptal Ediliyor...' : 'Evet, İptal Et'}
        cancelText="Vazgeç"
        tone="danger"
        onCancel={() => {
          if (!cancelProcessing) setCancelTargetMovement(null);
        }}
        onConfirm={handleCancelMovement}
      />
      <FormModal
        isOpen={Boolean(expiredBatchDisposalTarget)}
        title="SKT Geçmiş Parti İmhası"
        description={expiredBatchDisposalTarget ? `${formatNumber(expiredBatchDisposalTarget.length)} parti batch düzeyinde imha edilecek.` : ''}
        modalClassName="movement-expired-disposal-dialog"
        onClose={() => {
          if (processingType !== 'EXPIRED_DISPOSAL') {
            setExpiredBatchDisposalTarget(null);
            setExpiredBatchDisposalNote('');
          }
        }}
        confirmOnDirtyClose={false}
      >
        <div className="modal-form movement-expired-disposal-modal">
          <div className="movement-critical-note">Varsayılan imha nedeni: SKT geçmiş ürün imhası</div>
          <label className="field-group">
            <span>Ek Not</span>
            <textarea
              value={expiredBatchDisposalNote}
              onChange={(event) => setExpiredBatchDisposalNote(event.target.value)}
              placeholder="İmha onayı için ek not"
              disabled={processingType === 'EXPIRED_DISPOSAL'}
            />
          </label>
          <div className="modal-actions app-dialog-actions">
            <button
              className="outline-button"
              type="button"
              onClick={() => {
                setExpiredBatchDisposalTarget(null);
                setExpiredBatchDisposalNote('');
              }}
              disabled={processingType === 'EXPIRED_DISPOSAL'}
            >
              Vazgeç
            </button>
            <button className="danger-button" type="button" onClick={confirmExpiredBatchDisposal} disabled={processingType === 'EXPIRED_DISPOSAL'}>
              {processingType === 'EXPIRED_DISPOSAL' ? 'İmha Ediliyor...' : 'Evet, İmha Et'}
            </button>
          </div>
        </div>
      </FormModal>
      <PageHeader className="dashboard-hero" icon={<Boxes size={22} />} title="Stok İşlemleri" description="Stok giriş, çıkış ve düzeltme işlemlerini yönetin." />

      <div className="mod-card movement-type-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-cyan"><ArrowDownUp size={18} /></div>
          <div><h3>Sayfa Seçimi</h3><p>Stok sürecini görüntüleme, hareket ve işlem adımlarına ayırın.</p></div>
        </div>
        <div className="movement-type-switch" role="tablist" aria-label="Stok sayfa görünümü seçimi">
          {PAGE_VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={activePageView === option.value}
              className={`movement-type-chip ${activePageView === option.value ? 'active' : ''}`}
              onClick={() => setActivePageView(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {activePageView === 'VIEW' ? (
        <section className="mod-summary-grid six">
          <div className="mod-stat">
            <div className="mod-stat-icon mod-icon-blue"><Package size={20} /></div>
            <div className="mod-stat-body">
              <span className="mod-stat-label">Toplam Stok</span>
              <span className="mod-stat-value">{formatNumber(summary.totalStock)}</span>
              <span className="mod-stat-caption">Depodaki toplam adet</span>
            </div>
          </div>
          <div className="mod-stat">
            <div className="mod-stat-icon mod-icon-cyan"><ArrowRightLeft size={20} /></div>
            <div className="mod-stat-body">
              <span className="mod-stat-label">Reyon Doluluk Oranı</span>
              <span className="mod-stat-value">%{summary.shelfOccupancyRate.toFixed(1)}</span>
              <span className="mod-stat-caption">Reyondaki stok payı</span>
            </div>
          </div>
          <div className="mod-stat">
            <div className="mod-stat-icon mod-icon-indigo"><Package size={20} /></div>
            <div className="mod-stat-body">
              <span className="mod-stat-label">Depo Doluluk Oranı</span>
              <span className="mod-stat-value">%{summary.warehouseOccupancyRate.toFixed(1)}</span>
              <span className="mod-stat-caption">Depodaki stok payı</span>
            </div>
          </div>
          <div className="mod-stat">
            <div className="mod-stat-icon mod-icon-rose"><AlertTriangle size={20} /></div>
            <div className="mod-stat-body">
              <span className="mod-stat-label">Bitmeye Yaklaşan</span>
              <span className="mod-stat-value">{formatNumber(summary.nearDepletionCount)}</span>
              <span className="mod-stat-caption">Kritik eşiğe gelen ürün</span>
            </div>
          </div>
          <div className="mod-stat">
            <div className="mod-stat-icon mod-icon-orange"><TrendingDown size={20} /></div>
            <div className="mod-stat-body">
              <span className="mod-stat-label">Stokta Olmayan</span>
              <span className="mod-stat-value">{formatNumber(summary.outOfStockCount)}</span>
              <span className="mod-stat-caption">Tükenen ürün çeşidi</span>
            </div>
          </div>
          <div className="mod-stat">
            <div className="mod-stat-icon mod-icon-amber"><Activity size={20} /></div>
            <div className="mod-stat-body">
              <span className="mod-stat-label">Hareket Kaydı</span>
              <span className="mod-stat-value">{formatNumber(summary.totalMovements)}</span>
              <span className="mod-stat-caption">Filtreye göre hareket</span>
            </div>
          </div>
        </section>
      ) : null}

      {activePageView === 'OPERATIONS' ? (
        <>
          <div className="mod-card movement-type-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-cyan"><ArrowDownUp size={18} /></div>
              <div><h3>İşlem Tipi</h3><p>İşlem kartını seçin, yalnızca o panel açılsın.</p></div>
            </div>
            <div className="movement-type-switch" role="tablist" aria-label="Stok işlem tipi seçimi">
              {OPERATION_VIEW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={activeOperation === option.value}
                  className={`movement-type-chip ${activeOperation === option.value ? 'active' : ''}`}
                  onClick={() => setActiveOperation(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="movement-operations-layout">
          <div className="movement-ops-grid movement-ops-grid-single">
        {activeOperation === 'RECEIPT' ? (
        <form className="movement-op-card op-in active" onSubmit={(event) => { event.preventDefault(); submitReceipt(); }}>
          <div className="movement-op-header">
            <div className="mod-card-icon mod-icon-cyan"><Package size={18} /></div>
            <div><h3>Mal Kabul ve Parti Girişi</h3><p>Ürünleri parti/lot bilgisiyle depoya alın; miktar ve SKT kaydını tek adımda tamamlayın.</p></div>
          </div>

          <div className="movement-receipt-flow">
            <section className="movement-receipt-step movement-pending-orders-panel">
              <div className="movement-receipt-step-head">
                <h4>1. Sipariş Seçimi</h4>
                <p>Siparişten ilerleyin veya manuel ürün girişi ile devam edin.</p>
              </div>

              <div className="movement-receipt-mode-switch">
                <div className="movement-receipt-mode-toggle" role="tablist" aria-label="Mal kabul modu">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={receiptMode === 'order'}
                    className={`movement-receipt-mode-btn ${receiptMode === 'order' ? 'active' : ''}`}
                    onClick={() => {
                      setReceiptMode('order');
                      if (!hasLoadedPendingReceiptOrders) {
                        loadPendingReceiptOrders();
                      }
                    }}
                    disabled={pendingReceiptLoading}
                  >
                    Siparişten Getir
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={receiptMode === 'manual'}
                    className={`movement-receipt-mode-btn ${receiptMode === 'manual' ? 'active' : ''}`}
                    onClick={() => {
                      setReceiptMode('manual');
                      setPendingReceiptIdQuery('');
                      setSelectedPendingReceiptOrder(null);
                      setSelectedPendingReceiptItems([]);
                      setSelectedPendingReceiptItemId('');
                    }}
                  >
                    Manuel Ürün Girişi
                  </button>
                </div>
                {receiptMode === 'order' ? (
                  <label className="field-group movement-receipt-id-filter">
                    <input
                      value={pendingReceiptIdQuery}
                      onChange={(event) => setPendingReceiptIdQuery(event.target.value)}
                      placeholder="Sipariş ID girin"
                      aria-label="Sipariş ID ile filtrele"
                    />
                  </label>
                ) : null}
              </div>

              {receiptMode === 'order' ? (
                <DataTable
                  columns={pendingReceiptColumns}
                  rows={filteredPendingReceiptOrders}
                  isLoading={pendingReceiptLoading}
                  emptyMessage="Stok girişi bekleyen sipariş bulunmuyor."
                  initialSort={{ key: 'createdAt', direction: 'desc' }}
                  topHorizontalScroll
                />
              ) : null}
            </section>

            {receiptMode === 'order' && selectedPendingReceiptOrder ? (
              <section className="movement-receipt-step">
                <div className="movement-receipt-step-head">
                  <h4>2. Sipariş Kalemleri</h4>
                  <p>Kalemler siparişe otomatik bağlıdır, ayrıca ürün seçimi gerekmez.</p>
                </div>
                <ul className="movement-receipt-item-list">
                  {selectedPendingReceiptItems.map((item) => {
                    const itemKey = String(item.id || item.productId || '');
                    const isSelected = String(selectedPendingReceiptItemId || '') === itemKey;
                    const enteredQty = Number(pendingReceiptEnteredQtyByProduct[String(item.productId || '')] || 0);
                    const isCompleted = Boolean(receiptCompletedItemKeys[itemKey]) || enteredQty > 0;
                    const statusClass = isCompleted ? 'is-entered' : (isSelected ? 'is-selected' : 'is-missing');
                    return (
                      <li key={item.id || `${item.productId}-${item.sku || ''}`}>
                        <button
                          type="button"
                          className={`movement-receipt-item-btn ${statusClass} ${isSelected ? 'is-active-focus' : ''}`}
                          onClick={() => setSelectedPendingReceiptItemId(itemKey)}
                          disabled={isCompleted}
                        >
                          <span>{item.productName || item.sku || '-'}</span>
                          <strong>{formatNumber(item.quantity || 0)} adet</strong>
                          <small>{isCompleted ? 'Giriş tamamlandı' : (isSelected ? 'Kalem seçildi' : 'Giriş bekliyor')}</small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            <section className="movement-receipt-step">
              <div className="movement-receipt-step-head">
                <h4>{receiptMode === 'order' ? '3. Giriş Formu' : '2. Giriş Formu'}</h4>
                <p>Parti, SKT ve kabul bilgilerini tamamlayıp işlemi kaydedin.</p>
              </div>
              {!isReceiptBoundToOrder ? (
                <ProductSearchInput
                  stocks={stocks}
                  value={receiptForm.productId}
                  onChange={(id) => {
                    setReceiptForm((current) => ({ ...current, productId: id, warehouseLocation: '', qty: '', acceptedCaseCount: '' }));
                    setReceiptErrors((current) => ({ ...current, productId: '' }));
                  }}
                  disabled={!isAdmin}
                />
              ) : (
                (selectedPendingReceiptItemId && String(autoLinkedNoticeItemKey) === String(selectedPendingReceiptItemId)) ? (
                  <div className="movement-linked-order-note">Ürün, seçilen sipariş kaleminden otomatik bağlandı.</div>
                ) : null
              )}
              {receiptErrors.productId ? <small className="movement-field-error">{receiptErrors.productId}</small> : null}

              {renderReadonlyProductBlock(receiptForm.productId)}
              <div className="movement-inline-grid">
                <label className="field-group"><span>Parti No</span><input value={receiptForm.batchNo} onChange={(event) => { setReceiptForm((current) => ({ ...current, batchNo: event.target.value })); setReceiptErrors((current) => ({ ...current, batchNo: '' })); }} placeholder="örn. PINAR-B7K29Q-01" disabled={!isAdmin} /></label>
                <label className="field-group"><span>SKT</span><input type="date" value={receiptForm.skt} onChange={(event) => { setReceiptForm((current) => ({ ...current, skt: event.target.value })); setReceiptErrors((current) => ({ ...current, skt: '' })); }} disabled={!isAdmin} /></label>
              </div>
              <div className="movement-inline-grid movement-inline-errors">
                {receiptErrors.batchNo ? <small className="movement-field-error">{receiptErrors.batchNo}</small> : <span />}
                {receiptErrors.skt ? <small className="movement-field-error">{receiptErrors.skt}</small> : <span />}
              </div>
              <div className="movement-inline-grid">
                <label className="field-group"><span>Kabul Tipi</span><select value={receiptForm.acceptanceType} onChange={(event) => { setReceiptForm((current) => ({ ...current, acceptanceType: event.target.value })); setReceiptErrors((current) => ({ ...current, acceptanceType: '' })); }} disabled={!isAdmin}>{ACCEPTANCE_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <label className="field-group"><span>Mal Kabul Tarihi</span><input type="date" value={receiptForm.receiptDate} onChange={(event) => { setReceiptForm((current) => ({ ...current, receiptDate: event.target.value })); setReceiptErrors((current) => ({ ...current, receiptDate: '' })); }} disabled={!isAdmin} /></label>
              </div>
              <div className="movement-inline-grid movement-inline-errors">
                {receiptErrors.acceptanceType ? <small className="movement-field-error">{receiptErrors.acceptanceType}</small> : <span />}
                {receiptErrors.receiptDate ? <small className="movement-field-error">{receiptErrors.receiptDate}</small> : <span />}
              </div>
              <div className="movement-inline-grid movement-inline-grid-four">
                <label className="field-group"><span>Toplam Kabul Edilen Koli</span><input type="number" min="1" value={receiptForm.acceptedCaseCount} onChange={(event) => {
                  const caseValue = event.target.value;
                  const parsedCase = parsePositiveNumber(caseValue);
                  setReceiptForm((current) => ({
                    ...current,
                    acceptedCaseCount: caseValue,
                    qty: parsedCase === null ? '' : String(parsedCase * receiptUnitsPerCase),
                  }));
                  setReceiptErrors((current) => ({ ...current, acceptedCaseCount: '', qty: '' }));
                }} disabled={!isAdmin} /></label>
                <label className="field-group"><span>Giriş Miktarı (Adet - Otomatik)</span><input type="number" min="1" value={receiptForm.qty} readOnly /></label>
                <label className="field-group"><span>Alış Fiyatı</span><input type="number" min="0" step="0.01" value={receiptForm.purchasePrice} onChange={(event) => { setReceiptForm((current) => ({ ...current, purchasePrice: normalizeDecimalInput(event.target.value) })); setReceiptErrors((current) => ({ ...current, purchasePrice: '' })); }} disabled={!isAdmin} /></label>
                <label className="field-group"><span>Depo Lokasyonu (Otomatik)</span><input value={formatDepotLocationLabel(receiptForm.warehouseLocation)} readOnly /></label>
              </div>
              <div className="movement-inline-grid movement-inline-grid-four movement-inline-errors">
                {receiptErrors.acceptedCaseCount ? <small className="movement-field-error">{receiptErrors.acceptedCaseCount}</small> : <span />}
                {receiptErrors.qty ? <small className="movement-field-error">{receiptErrors.qty}</small> : <span />}
                {receiptErrors.purchasePrice ? <small className="movement-field-error">{receiptErrors.purchasePrice}</small> : <span />}
                {receiptErrors.warehouseLocation ? <small className="movement-field-error">{receiptErrors.warehouseLocation}</small> : <span />}
              </div>
              <label className="field-group"><span>Kabul Notu</span><textarea value={receiptForm.acceptanceNote} onChange={(event) => setReceiptForm((current) => ({ ...current, acceptanceNote: event.target.value }))} disabled={!isAdmin} placeholder="Kabul ile ilgili not ekleyin" /></label>
            </section>
          </div>
          <button className="primary-button movement-submit-btn" type="submit" disabled={!isAdmin || processingType === 'RECEIPT'}>{processingType === 'RECEIPT' ? 'Kaydediliyor...' : 'Mal Kabulü Kaydet'}</button>
        </form>
        ) : null}

        {activeOperation === 'OUT' ? (
        <form className="movement-op-card op-out active" onSubmit={(event) => { event.preventDefault(); submitOut(); }}>
          <div className="movement-op-header">
            <div className="movement-op-header-main">
              <div className="mod-card-icon mod-icon-rose"><TrendingDown size={18} /></div>
              <div><h3>Stok Çıkışı</h3><p>Operasyon veya sevkiyat çıkışı</p></div>
            </div>
          </div>
          <ProductSearchInput stocks={stocks} value={outForm.productId} onChange={(id) => { setOutForm((current) => ({ ...current, productId: id, sourceLocationCode: '', batchNo: '', approvalConfirmed: false })); setOutErrors((current) => ({ ...current, productId: '' })); }} disabled={!isAdmin} />
          {outErrors.productId ? <small className="movement-field-error">{outErrors.productId}</small> : null}

          {renderReadonlyProductBlock(outForm.productId)}
          <label className="field-group"><span>FEFO Lot Önerisi</span><input value={outSuggestedBatch?.batchNo || '-'} readOnly /></label>

          <div className="movement-inline-grid movement-inline-grid-three">
            <label className="field-group"><span>Çıkış Tipi</span><select value={outForm.outputType} onChange={(event) => { setOutForm((current) => ({ ...current, outputType: event.target.value })); setOutErrors((current) => ({ ...current, outputType: '' })); }} disabled={!isAdmin}>{OUT_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="field-group"><span>Kaynak Lokasyon Tipi</span><select value={outForm.sourceLocationType} onChange={(event) => { setOutForm((current) => ({ ...current, sourceLocationType: event.target.value, sourceLocationCode: '', batchNo: '' })); setOutErrors((current) => ({ ...current, sourceLocationType: '', sourceLocationCode: '' })); }} disabled={!isAdmin}>{SOURCE_LOCATION_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="field-group"><span>Kaynak Lokasyon</span><select value={outForm.sourceLocationCode} onChange={(event) => { setOutForm((current) => ({ ...current, sourceLocationCode: event.target.value })); setOutErrors((current) => ({ ...current, sourceLocationCode: '' })); }} disabled={!isAdmin || !outForm.productId}><option value="">Lokasyon seçin</option>{outLocationOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          </div>
          <div className="movement-inline-grid movement-inline-grid-three movement-inline-errors">
            {outErrors.outputType ? <small className="movement-field-error">{outErrors.outputType}</small> : <span />}
            {outErrors.sourceLocationType ? <small className="movement-field-error">{outErrors.sourceLocationType}</small> : <span />}
            {outErrors.sourceLocationCode ? <small className="movement-field-error">{outErrors.sourceLocationCode}</small> : <span />}
          </div>
          <div className="movement-inline-grid">
            <label className="field-group"><span>Miktar</span><input type="number" min="1" value={outForm.qty} onChange={(event) => { setOutForm((current) => ({ ...current, qty: event.target.value, approvalConfirmed: false })); setOutErrors((current) => ({ ...current, qty: '' })); }} disabled={!isAdmin} /></label>
            <label className="field-group"><span>Parti / Lot</span><select value={outForm.batchNo} onChange={(event) => { setOutForm((current) => ({ ...current, batchNo: event.target.value })); setOutErrors((current) => ({ ...current, batchNo: '' })); }} disabled={!isAdmin || !outBatchOptions.length}><option value="">Lot seçin</option>{outBatchOptions.map((item) => <option key={item.batchNo} value={item.batchNo}>{item.batchNo}</option>)}</select></label>
          </div>
          <div className="movement-inline-grid movement-inline-errors">
            {outErrors.qty ? <small className="movement-field-error">{outErrors.qty}</small> : <span />}
            {outErrors.batchNo ? <small className="movement-field-error">{outErrors.batchNo}</small> : <span />}
          </div>
          <label className="field-group"><span>Kullanıcı Notu</span><textarea value={outForm.userNote} onChange={(event) => setOutForm((current) => ({ ...current, userNote: event.target.value }))} disabled={!isAdmin} placeholder="Çıkışla ilgili açıklama" /></label>
          {(parsePositiveNumber(outForm.qty) || 0) > 0 ? (
            <div className="movement-critical-note">Çıkış sonrası kalan stok: {formatNumber(Math.max(0, (outForm.sourceLocationType === 'reyon' ? Number(stockByProductId[outForm.productId]?.shelfStock || 0) : Number(stockByProductId[outForm.productId]?.warehouseStock || 0)) - Number(parsePositiveNumber(outForm.qty) || 0)))} adet</div>
          ) : null}
          <label className="checkbox-group stock-filter-checkbox">
            <input type="checkbox" checked={outForm.approvalConfirmed} onChange={(event) => { setOutForm((current) => ({ ...current, approvalConfirmed: event.target.checked })); setOutErrors((current) => ({ ...current, approvalConfirmed: '' })); }} disabled={!isAdmin} />
            <span>Onaylıyorum</span>
          </label>
          {outErrors.approvalConfirmed ? <small className="movement-field-error">{outErrors.approvalConfirmed}</small> : null}
          <button className="danger-button movement-submit-btn" type="submit" disabled={!isAdmin || processingType === 'OUT'}>{processingType === 'OUT' ? 'Kaydediliyor...' : 'Çıkışı Kaydet'}</button>
        </form>
        ) : null}

        {activeOperation === 'ADJUSTMENT' ? (
        <form className="movement-op-card op-adjust active" onSubmit={(event) => { event.preventDefault(); submitTotalAdjustment(); }}>
          <div className="movement-op-header">
            <div className="mod-card-icon mod-icon-amber"><RefreshCw size={18} /></div>
            <div><h3>Stok Düzeltme</h3><p>Toplam stok seviyesi düzeltme işlemi</p></div>
          </div>
          <ProductSearchInput stocks={stocks} value={adjustForm.productId} onChange={(id) => { setAdjustForm((current) => ({ ...current, productId: id })); setAdjustErrors((current) => ({ ...current, productId: '' })); }} disabled={!isAdmin} />
          {adjustErrors.productId ? <small className="movement-field-error">{adjustErrors.productId}</small> : null}
          {renderReadonlyProductBlock(adjustForm.productId)}
          <div className="movement-inline-grid">
            <label className="field-group">
              <span>Düzeltme Sebebi</span>
              <select
                value={adjustForm.adjustmentReason}
                onChange={(event) => {
                  setAdjustForm((current) => ({ ...current, adjustmentReason: event.target.value }));
                  setAdjustErrors((current) => ({ ...current, adjustmentReason: '' }));
                }}
                disabled={!isAdmin}
              >
                {ADJUSTMENT_REASON_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="field-group">
              <span>Kapsam</span>
              <select
                value={adjustForm.scope}
                onChange={(event) => setAdjustForm((current) => ({ ...current, scope: event.target.value }))}
                disabled={!isAdmin}
              >
                <option value="toplam">Toplam Stok</option>
                <option value="lokasyon">Lokasyon Bazlı</option>
              </select>
            </label>
          </div>
          <div className="movement-inline-grid movement-inline-errors">
            {adjustErrors.adjustmentReason ? <small className="movement-field-error">{adjustErrors.adjustmentReason}</small> : <span />}
            <span />
          </div>
          {adjustForm.scope === 'lokasyon' ? (
            <label className="field-group">
              <span>Düzeltme Lokasyonu</span>
              <select
                value={adjustForm.location}
                onChange={(event) => setAdjustForm((current) => ({ ...current, location: event.target.value }))}
                disabled={!isAdmin}
              >
                {LOCATION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          ) : null}
          <label className="checkbox-group stock-filter-checkbox">
            <input
              type="checkbox"
              checked={adjustForm.isBatchBased}
              onChange={(event) => {
                setAdjustForm((current) => ({ ...current, isBatchBased: event.target.checked, batchNo: event.target.checked ? current.batchNo : '' }));
                setAdjustErrors((current) => ({ ...current, batchNo: '' }));
              }}
              disabled={!isAdmin}
            />
            <span>Parti/Lot bazlı düzeltme</span>
          </label>
          {adjustForm.isBatchBased ? (
            <label className="field-group">
              <span>Parti / Lot</span>
              <select
                value={adjustForm.batchNo}
                onChange={(event) => {
                  setAdjustForm((current) => ({ ...current, batchNo: event.target.value }));
                  setAdjustErrors((current) => ({ ...current, batchNo: '' }));
                }}
                disabled={!isAdmin || !outBatchOptions.length}
              >
                <option value="">Lot seçin</option>
                {outBatchOptions.map((item) => <option key={item.batchNo} value={item.batchNo}>{item.batchNo}</option>)}
              </select>
            </label>
          ) : null}
          {adjustErrors.batchNo ? <small className="movement-field-error">{adjustErrors.batchNo}</small> : null}
          <div className="movement-readonly-block movement-adjust-inline">
            <div className="movement-readonly-grid movement-adjust-stock-grid">
              <label className="field-group"><span>Eski Stok</span><input value={formatNumber(adjustOldStock)} readOnly /></label>
              <label className="field-group"><span>Yeni Stok</span><input type="number" min="0" value={adjustForm.targetQuantity} onChange={(event) => { setAdjustForm((current) => ({ ...current, targetQuantity: event.target.value })); setAdjustErrors((current) => ({ ...current, targetQuantity: '' })); }} disabled={!isAdmin} /></label>
              <label className="field-group"><span>Fark</span><input value={adjustDifference === null ? '-' : formatNumber(adjustDifference)} readOnly /></label>
            </div>
          </div>
          {adjustErrors.targetQuantity ? <small className="movement-field-error">{adjustErrors.targetQuantity}</small> : null}
          {adjustIsHighDifference ? (
            <div className="movement-critical-note">Yüksek fark tespit edildi: {formatNumber(adjustDifference || 0)} adet. Ek onay gereklidir.</div>
          ) : null}
          <label className="field-group">
            <span>Açıklama</span>
            <textarea
              value={adjustForm.description}
              onChange={(event) => {
                setAdjustForm((current) => ({ ...current, description: event.target.value }));
                setAdjustErrors((current) => ({ ...current, description: '' }));
              }}
              placeholder="Düzeltme açıklaması"
              disabled={!isAdmin}
            />
          </label>
          {adjustErrors.description ? <small className="movement-field-error">{adjustErrors.description}</small> : null}
          {adjustIsHighDifference ? (
            <>
              <label className="checkbox-group stock-filter-checkbox">
                <input
                  type="checkbox"
                  checked={adjustForm.highRiskConfirmed}
                  onChange={(event) => {
                    setAdjustForm((current) => ({ ...current, highRiskConfirmed: event.target.checked }));
                    setAdjustErrors((current) => ({ ...current, highRiskConfirmed: '' }));
                  }}
                  disabled={!isAdmin}
                />
                <span>Yüksek fark için ek onayı veriyorum</span>
              </label>
              {adjustErrors.highRiskConfirmed ? <small className="movement-field-error">{adjustErrors.highRiskConfirmed}</small> : null}
            </>
          ) : null}
          <button className="outline-button movement-submit-btn" type="submit" disabled={!isAdmin || processingType === 'ADJUSTMENT'}>{processingType === 'ADJUSTMENT' ? 'Kaydediliyor...' : 'Toplamı Kaydet'}</button>
        </form>
        ) : null}

        {activeOperation === 'TRANSFER' ? (
        <form className="movement-op-card op-transfer active" onSubmit={(event) => { event.preventDefault(); }}>
          <div className="movement-op-header">
            <div className="mod-card-icon mod-icon-blue"><ArrowRightLeft size={18} /></div>
            <div><h3>Reyon Besleme</h3><p>Depo ve reyon arası stok transferi</p></div>
          </div>
          <ProductSearchInput stocks={stocks} value={transferForm.productId} onChange={(id) => { setTransferForm((current) => ({ ...baseTransferForm, productId: id, targetSectionNumber: String(productsById[id]?.sectionNumber || '') })); setTransferErrors((current) => ({ ...current, productId: '' })); }} disabled={!isAdmin} />
          {transferErrors.productId ? <small className="movement-field-error">{transferErrors.productId}</small> : null}
          {renderReadonlyProductBlock(transferForm.productId)}
          <div className="movement-transfer-row-wrap">
          <div className="movement-inline-grid movement-transfer-single-row">
            <label className="field-group">
              <span>Kaynak Depo Lokasyonu</span>
              <select
                value={transferForm.sourceWarehouseLocation}
                onChange={(event) => {
                  setTransferForm((current) => ({ ...current, sourceWarehouseLocation: event.target.value }));
                  setTransferErrors((current) => ({ ...current, sourceWarehouseLocation: '' }));
                }}
                disabled={!isAdmin || !transferWarehouseLocationOptions.length}
              >
                <option value="">Lokasyon seçin</option>
                {transferWarehouseLocationOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="field-group">
              <span>Hedef Reyon Kodu</span>
              <input
                value={transferForm.targetSectionNumber}
                onChange={(event) => {
                  const nextNumber = event.target.value;
                  const resolved = transferSectionsByNumber.get(normalizeSectionNumber(nextNumber));
                  setTransferForm((current) => ({
                    ...current,
                    targetSectionNumber: nextNumber,
                    targetSectionId: resolved?.id || '',
                    targetSectionName: resolved?.name || '',
                  }));
                  setTransferErrors((current) => ({ ...current, targetSectionId: '' }));
                }}
                placeholder={transferSelectedProduct?.sectionNumber ? `Öneri: ${transferSelectedProduct.sectionNumber}` : 'örn. R-12'}
                disabled={!isAdmin}
              />
            </label>
          </div>
          </div>
          <div className="movement-inline-grid movement-inline-errors">
            {transferErrors.sourceWarehouseLocation ? <small className="movement-field-error">{transferErrors.sourceWarehouseLocation}</small> : <span />}
            {transferErrors.targetSectionId ? <small className="movement-field-error">{transferErrors.targetSectionId}</small> : <span />}
          </div>
          {!transferErrors.targetSectionId && transferSelectedProduct?.sectionNumber ? (
            <small className="movement-field-hint">Önerilen reyon kodu: {transferSelectedProduct.sectionNumber} ({transferSelectedProduct.sectionName || '-'})</small>
          ) : null}
          <div className="movement-inline-grid movement-inline-grid-five">
            <label className="field-group">
              <span>Koli Sayısı</span>
              <input
                type="number"
                min="0"
                step="1"
                value={transferForm.transferCaseCount}
                onChange={(event) => {
                  const raw = event.target.value;
                  const caseCount = parseNonNegativeNumber(raw);
                  setTransferForm((current) => ({
                    ...current,
                    transferCaseCount: raw,
                    qty: caseCount === null ? '' : String(caseCount * transferUnitsPerCase),
                  }));
                  setTransferErrors((current) => ({ ...current, qty: '' }));
                }}
                disabled={!isAdmin}
              />
            </label>
            <label className="field-group transfer-readonly-field"><span>Toplam Adet</span><input value={transferForm.qty} readOnly /></label>
            <label className="field-group transfer-readonly-field"><span>Transfer Sonrası Reyon Stok</span><input value={formatNumber(transferAfterShelfStock)} readOnly /></label>
            <label className="field-group transfer-readonly-field"><span>Depo Stok (Sonrası)</span><input value={formatNumber(transferAfterWarehouseStock)} readOnly /></label>
            <label className="field-group transfer-readonly-field"><span>Hedef Doluluk (Sonrası)</span><input value={transferTargetCapacity > 0 ? `%${formatNumber(transferAfterFillRate)}` : '-'} readOnly /></label>
          </div>
          {transferErrors.qty ? <small className="movement-field-error">{transferErrors.qty}</small> : null}
          <div className="movement-inline-grid movement-inline-grid-five">
            <label className="field-group">
              <span>Taraf</span>
              <select
                value={transferForm.targetSide}
                onChange={(event) => {
                  setTransferForm((current) => ({ ...current, targetSide: event.target.value }));
                  setTransferErrors((current) => ({ ...current, targetSlot: '' }));
                }}
                disabled={!isAdmin}
              >
                <option value="">Seçin</option>
                <option value="L">Sol</option>
                <option value="R">Sağ</option>
              </select>
            </label>
            <label className="field-group">
              <span>Raf No</span>
              <input
                type="number"
                min="1"
                value={transferForm.targetShelfNo}
                onChange={(event) => {
                  setTransferForm((current) => ({ ...current, targetShelfNo: event.target.value }));
                  setTransferErrors((current) => ({ ...current, targetSlot: '' }));
                }}
                disabled={!isAdmin}
              />
            </label>
            <label className="field-group">
              <span>Kat No</span>
              <input
                type="number"
                min="1"
                value={transferForm.targetLevelNo}
                onChange={(event) => {
                  setTransferForm((current) => ({ ...current, targetLevelNo: event.target.value }));
                  setTransferErrors((current) => ({ ...current, targetSlot: '' }));
                }}
                disabled={!isAdmin}
              />
            </label>
            <label className="field-group transfer-readonly-field"><span>Hedef Reyon Adı</span><input value={transferResolvedTargetSection?.name || transferForm.targetSectionName || '-'} readOnly /></label>
            <label className="field-group transfer-readonly-field"><span>Önerilen Slot</span><input value={transferForm.suggestedSlot || '-'} readOnly /></label>
          </div>
          <button className="outline-button movement-inline-action movement-inline-action-compact" type="button" onClick={applySuggestedTransferSlot} disabled={!isAdmin || !transferSuggestedSlot}>Önerileni Uygula</button>
          {transferErrors.targetSlot ? <small className="movement-field-error">{transferErrors.targetSlot}</small> : null}
          {transferTargetCapacity > 0 && transferAfterShelfStock > transferTargetCapacity ? (
            <div className="movement-critical-note">Kapasite uyarısı: hedef reyon kapasitesi aşılır.</div>
          ) : null}
          <label className="field-group">
            <span>Talep Notu</span>
            <textarea
              value={transferForm.requestNote}
              onChange={(event) => setTransferForm((current) => ({ ...current, requestNote: event.target.value }))}
              placeholder="Kiosk/depo ekibine not"
              disabled={!isAdmin}
            />
          </label>
          <button className="primary-button movement-request-btn" type="button" onClick={submitTransferRequest} disabled={!isAdmin || processingType === 'TRANSFER_REQUEST'}>{processingType === 'TRANSFER_REQUEST' ? 'Gönderiliyor...' : 'Talep Gönder'}</button>
        </form>
        ) : null}

        {activeOperation === 'DISPOSAL' ? (
        <>
        <form className="movement-op-card op-disposal active" onSubmit={(event) => { event.preventDefault(); submitDisposal(); }}>
          <div className="movement-op-header">
            <div className="mod-card-icon mod-icon-rose"><Trash2 size={18} /></div>
            <div><h3>Stok İmha</h3><p>Bozulmuş, hasarlı veya kullanım dışı ürünleri stoktan düşür</p></div>
          </div>
          <ProductSearchInput stocks={stocks} value={disposalForm.productId} onChange={(id) => { setDisposalForm((current) => ({ ...current, productId: id, sourceLocationCode: '', batchNo: '', approvalConfirmed: false })); setDisposalErrors((current) => ({ ...current, productId: '' })); }} disabled={!isAdmin} />
          {disposalErrors.productId ? <small className="movement-field-error">{disposalErrors.productId}</small> : null}
          {renderReadonlyProductBlock(disposalForm.productId)}
          <div className="movement-inline-grid movement-inline-grid-five movement-disposal-single-row">
            <label className="field-group"><span>Stok Konumu</span><select value={disposalForm.location} onChange={(event) => { setDisposalForm((current) => ({ ...current, location: event.target.value, sourceLocationCode: '' })); setDisposalErrors((current) => ({ ...current, sourceLocationCode: '' })); }} disabled={!isAdmin}>{LOCATION_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="field-group"><span>Kaynak Lokasyon</span><select value={disposalForm.sourceLocationCode} onChange={(event) => { setDisposalForm((current) => ({ ...current, sourceLocationCode: event.target.value })); setDisposalErrors((current) => ({ ...current, sourceLocationCode: '' })); }} disabled={!isAdmin || !disposalForm.productId}><option value="">Lokasyon seçin</option>{disposalLocationOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="field-group"><span>Parti No</span><select value={disposalForm.batchNo} onChange={(event) => { setDisposalForm((current) => ({ ...current, batchNo: event.target.value })); setDisposalErrors((current) => ({ ...current, batchNo: '' })); }} disabled={!isAdmin || !disposalBatchOptions.length}><option value="">Parti seçin</option>{disposalBatchOptions.map((item) => <option key={item.batchNo} value={item.batchNo}>{item.batchNo} ({formatNumber(item.qtyBalance || 0)} adet)</option>)}</select></label>
            <label className="field-group"><span>Miktar</span><input type="number" min="1" value={disposalForm.qty} onChange={(event) => { setDisposalForm((current) => ({ ...current, qty: event.target.value, approvalConfirmed: false })); setDisposalErrors((current) => ({ ...current, qty: '' })); }} disabled={!isAdmin} /></label>
            <label className="field-group"><span>İmha Nedeni</span><select value={disposalForm.reason} onChange={(event) => { setDisposalForm((current) => ({ ...current, reason: event.target.value })); setDisposalErrors((current) => ({ ...current, reason: '' })); }} disabled={!isAdmin}>{DISPOSAL_REASON_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          </div>
          <div className="movement-inline-grid movement-inline-grid-five movement-inline-errors">
            <span />
            {disposalErrors.sourceLocationCode ? <small className="movement-field-error">{disposalErrors.sourceLocationCode}</small> : <span />}
            {disposalErrors.batchNo ? <small className="movement-field-error">{disposalErrors.batchNo}</small> : <span />}
            {disposalErrors.qty ? <small className="movement-field-error">{disposalErrors.qty}</small> : <span />}
            <span />
            {disposalErrors.reason ? <small className="movement-field-error">{disposalErrors.reason}</small> : <span />}
          </div>
          {(parsePositiveNumber(disposalForm.qty) || 0) > 0 ? (
            <div className="movement-critical-note">
              İmha sonrası stok: {formatNumber(Math.max(0, (disposalForm.location === 'reyon' ? Number(stockByProductId[disposalForm.productId]?.shelfStock || 0) : Number(stockByProductId[disposalForm.productId]?.warehouseStock || 0)) - Number(parsePositiveNumber(disposalForm.qty) || 0)))} adet
            </div>
          ) : null}
          {(() => {
            const qty = parsePositiveNumber(disposalForm.qty) || 0;
            const currentStock = disposalForm.location === 'reyon' ?
              Number(stockByProductId[disposalForm.productId]?.shelfStock || 0)
              : Number(stockByProductId[disposalForm.productId]?.warehouseStock || 0);
            const criticalThreshold = Number(stockByProductId[disposalForm.productId]?.criticalStock || 0);
            const nextStock = Math.max(0, currentStock - qty);
            const isCritical = qty > 0 && (qty >= (currentStock * 0.4) || (criticalThreshold > 0 && nextStock <= criticalThreshold));
            return isCritical ? <div className="movement-critical-note"><strong>Yüksek riskli imha:</strong> işlem sonrası stok kritik seviyeye inebilir.</div> : null;
          })()}
          <label className="checkbox-group stock-filter-checkbox">
            <input type="checkbox" checked={disposalForm.approvalConfirmed} onChange={(event) => { setDisposalForm((current) => ({ ...current, approvalConfirmed: event.target.checked })); setDisposalErrors((current) => ({ ...current, approvalConfirmed: '' })); }} disabled={!isAdmin} />
            <span>Onaylıyorum</span>
          </label>
          {disposalErrors.approvalConfirmed ? <small className="movement-field-error">{disposalErrors.approvalConfirmed}</small> : null}
          <label className="field-group"><span>İmha Notu</span><textarea value={disposalForm.note} onChange={(event) => setDisposalForm((current) => ({ ...current, note: event.target.value }))} placeholder="İmha ile ilgili açıklama" disabled={!isAdmin} /></label>
          <button className="danger-button movement-submit-btn" type="submit" disabled={!isAdmin || processingType === 'DISPOSAL'}>{processingType === 'DISPOSAL' ? 'Kaydediliyor...' : 'İmha Et'}</button>
        </form>
        </>
        ) : null}
          </div>
          <div className="mod-card movement-context-card movement-context-side">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-indigo"><Activity size={18} /></div>
              <div><h3>İşlem Öncesi Bağlam</h3><p>Anlık stok ve son hareketleri kontrol ederek daha güvenli işlem yapın.</p></div>
            </div>
            {renderMovementContext(selectedContextProductId, activeOperation)}
          </div>
          </div>
          {activeOperation === 'DISPOSAL' ? (
            <div className="movement-op-card op-disposal active movement-expired-warning-card movement-expired-warning-card-full">
              <div className="movement-op-header">
                <div className="mod-card-icon mod-icon-rose"><AlertTriangle size={18} /></div>
                <div><h3>SKT Geçmiş Ürün Uyarıları</h3><p>Yalnızca SKT tarihi geçmiş ve stokta kalan batch kayıtları listelenir.</p></div>
              </div>
              <div className="movement-expired-warning-actions">
                <label className="checkbox-group stock-filter-checkbox">
                  <input
                    type="checkbox"
                    checked={allExpiredRowsSelected}
                    onChange={(event) => setSelectedExpiredBatchIds(event.target.checked ? expiredBatchRows.map((row) => row.id) : [])}
                    disabled={!isAdmin || !expiredBatchRows.length || processingType === 'EXPIRED_DISPOSAL'}
                  />
                  <span>Tümünü seç</span>
                </label>
                <button
                  className="danger-button movement-inline-action"
                  type="button"
                  onClick={() => openExpiredBatchDisposal(selectedExpiredBatchRows)}
                  disabled={!isAdmin || !selectedExpiredBatchRows.length || processingType === 'EXPIRED_DISPOSAL'}
                >
                  Seçili Ürünleri İmha Et
                </button>
              </div>
              <DataTable
                columns={expiredBatchColumns}
                rows={expiredBatchRows}
                keyField="id"
                isLoading={isLoading}
                emptyMessage="SKT geçmiş aktif batch bulunmuyor."
                initialSort={{ key: 'skt', direction: 'asc' }}
                pageSize={10}
                topHorizontalScroll
              />
            </div>
          ) : null}
        </>
      ) : null}

      {activePageView === 'COUNT' ? (
        <section className="movement-count-layout movement-page-panel-spaced">
          <div className="movement-op-card op-adjust active movement-count-card">
            <div className="movement-op-header">
              <div className="mod-card-icon mod-icon-amber"><ScanBarcode size={18} /></div>
              <div><h3>Sayım</h3><p>Fiziksel sayımı sistem stoğu ile karşılaştırın ve eksik farkı kaydedin.</p></div>
            </div>

            <form className="movement-count-lookup" onSubmit={handleCountLookup}>
              <label className="field-group movement-count-barcode-field">
                <span>Barkod</span>
                <input
                  value={countForm.barcode}
                  onChange={(event) => {
                    const barcode = event.target.value;
                    setCountForm((current) => ({ ...current, barcode }));
                    if (countMessage?.tone === 'error') {
                      setCountMessage(null);
                    }
                  }}
                  placeholder="Barkod okutun veya barkod arayın"
                  aria-label="Barkod okutun veya barkod arayın"
                />
              </label>
              <button className="outline-button movement-count-lookup-btn" type="submit" disabled={countLookupLoading}>
                {countLookupLoading ? 'Aranıyor...' : 'Ürünü Bul'}
              </button>
            </form>

            {countForm.productId && countSelectedStock ? (
              <>
                <div className="movement-count-summary">
                  <div className="movement-count-summary-head">
                    <strong>{countSelectedProduct?.name || countSelectedStock?.productName || '-'}</strong>
                    <span>{countSelectedProduct?.sku || countSelectedStock?.sku || '-'} / {countSelectedProduct?.barcode || countForm.barcode || '-'}</span>
                  </div>
                  <div className="movement-count-summary-grid">
                    <div><span>Ürün adı</span><strong>{countSelectedProduct?.name || countSelectedStock?.productName || '-'}</strong></div>
                    <div><span>SKU / barkod</span><strong>{countSelectedProduct?.sku || countSelectedStock?.sku || '-'} / {countSelectedProduct?.barcode || countForm.barcode || '-'}</strong></div>
                    <div><span>Sistem toplam stok</span><strong>{formatNumber(countExpectedQuantity)}</strong></div>
                    <div><span>Depo stok</span><strong>{formatNumber(countWarehouseStock)}</strong></div>
                    <div><span>Reyon stok</span><strong>{formatNumber(countShelfStock)}</strong></div>
                    <div><span>Beklenen miktar</span><strong>{formatNumber(countExpectedQuantity)}</strong></div>
                  </div>
                </div>

                <div className="movement-count-action-grid">
                  <label className="field-group">
                    <span>Fiziksel sayım miktarı</span>
                    <input
                      type="number"
                      min="0"
                      value={countForm.physicalQuantity}
                      onChange={(event) => {
                        setCountForm((current) => ({ ...current, physicalQuantity: event.target.value }));
                        setCountMessage(null);
                      }}
                      placeholder="Fiziksel miktarı girin"
                    />
                  </label>
                  <label className="field-group">
                    <span>Fark</span>
                    <input
                      value={countDifference === null ? '-' : formatNumber(Math.abs(countDifference))}
                      readOnly
                    />
                  </label>
                </div>

                {countPhysicalQuantity !== null ? (() => {
                  const alert = resolveCountDifferenceAlert(countDifference);
                  if (!alert) return null;
                  return (
                    <div className={`movement-count-state tone-${alert.tone}`}>
                      <div className="movement-count-alert-icon" aria-hidden="true">{alert.icon}</div>
                      <div className="movement-count-alert-copy">
                        <strong>{alert.title}</strong>
                        <span>{alert.text}</span>
                      </div>
                    </div>
                  );
                })() : null}

                <div className="movement-count-actions">
                  <button
                    className="primary-button movement-submit-btn"
                    type="button"
                    onClick={submitCount}
                    disabled={!isAdmin || processingType === 'COUNT'}
                  >
                    {processingType === 'COUNT' ? 'Kaydediliyor...' : 'Sayımı Kaydet'}
                  </button>
                </div>
              </>
            ) : (
              <div className="movement-count-empty">
                <h4>Ürün bekleniyor</h4>
                <p>Barkod okutulduğunda ürün özeti burada gösterilir.</p>
              </div>
            )}

            {countMessage ? (() => {
              const alert = resolveCountFeedbackAlert(countMessage);
              if (!alert) return null;
              return (
                <div className={`movement-count-feedback tone-${alert.tone}`}>
                  <div className="movement-count-alert-icon" aria-hidden="true">{alert.icon}</div>
                  <div className="movement-count-alert-copy">
                    <strong>{alert.title}</strong>
                    <span>{alert.text}</span>
                  </div>
                </div>
              );
            })() : null}
          </div>
          <div className="mod-card movement-count-archive-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-blue"><Activity size={18} /></div>
              <div>
                <h3>Sayım Arşivi</h3>
                <p>Son fiziksel sayım kayıtlarını ürün, fark ve işlem sonucu ile takip edin.</p>
              </div>
            </div>

            {countArchiveRows.length === 0 ? (
              <div className="empty-state-box">Henüz gerçek sayım kaydı yok.</div>
            ) : (
              <>
                <div className="movement-count-archive-table-wrap">
                  <table className="movement-count-archive-table">
                    <thead>
                      <tr>
                        <th>Tarih</th>
                        <th>Ürün</th>
                        <th>SKU / Barkod</th>
                        <th>Sistem Stok</th>
                        <th>Fiziksel Sayım</th>
                        <th>Fark</th>
                        <th>İşlem Yapan</th>
                        <th>Sonuç</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedCountArchiveRows.map((row) => {
                        const difference = Number(row.difference || 0);
                        const differenceTone = resolveInventoryCountDifferenceTone(difference);
                        const differenceLabel = difference === 0 ? '0' : `${difference > 0 ? '+' : ''}${formatNumber(difference)}`;
                        return (
                          <tr key={row.id}>
                            <td>{formatDate(row.countedAt)}</td>
                            <td>{row.productName || '-'}</td>
                            <td>{row.sku || '-'} / {row.barcode || '-'}</td>
                            <td>{formatNumber(row.systemStock || 0)}</td>
                            <td>{formatNumber(row.physicalCount || 0)}</td>
                            <td><StatusBadge tone={differenceTone}>{differenceLabel}</StatusBadge></td>
                            <td>{row.actorName || '-'}</td>
                            <td><StatusBadge tone={differenceTone}>{row.resultLabel || '-'}</StatusBadge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="table-pagination report-server-pagination movement-count-archive-pagination">
                  <div className="table-pagination-summary">
                    <span>Sayfa {countArchivePage} / {countArchiveTotalPages}</span>
                    <span className="table-pagination-total">
                      · {countArchiveRows.length
                        ? `${((countArchivePage - 1) * 10) + 1}-${Math.min(countArchivePage * 10, countArchiveRows.length)} / ${countArchiveRows.length} kayıt`
                        : '0-0 / 0 kayıt'}
                    </span>
                  </div>
                  <div className="table-pagination-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setCountArchivePage(1)}
                      disabled={countArchivePage <= 1}
                    >
                      İlk
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setCountArchivePage((current) => Math.max(1, current - 1))}
                      disabled={countArchivePage <= 1}
                    >
                      Önceki
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => setCountArchivePage((current) => Math.min(countArchiveTotalPages, current + 1))}
                      disabled={countArchivePage >= countArchiveTotalPages}
                    >
                      Sonraki
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setCountArchivePage(countArchiveTotalPages)}
                      disabled={countArchivePage >= countArchiveTotalPages}
                    >
                      Son
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}

      {!activePageView ? (
      <div className="mod-card products-filter-card stock-movement-filter-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-cyan"><ArrowDownUp size={18} /></div>
          <div><h3>Görünüm Seçimi Bekleniyor</h3><p>Üstteki Sayfa Seçimi alanından bir görünüm seçerek devam edin.</p></div>
        </div>
      </div>
      ) : null}

      {(activePageView === 'VIEW' || activePageView === 'MOVEMENTS') ? (
      <div className="mod-card products-filter-card stock-movement-filter-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-violet"><Filter size={18} /></div>
          <div>
            <h3>Filtreler</h3>
            <p>{activePageView === 'MOVEMENTS' ? 'Hareket listesini daraltmak için filtreleyin' : 'Ürün listesini daraltmak için filtreleyin'}</p>
          </div>
        </div>
        <FilterBar
          className="products-filter-bar-minimal stock-movement-filter-bar"
          actions={(
            <>
              <button className="primary-button" type="button" onClick={() => loadData(filters)}>Filtrele</button>
              <button className="ghost-button" type="button" onClick={() => { const reset = { search: '', type: '', reasonCode: '', location: '', productId: '', maxStock: '', criticalOnly: false, outOfStockOnly: false }; setFilters(reset); loadData(reset); }}>Temizle</button>
            </>
          )}
        >
          <label className="field-group"><span>Arama</span><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Ref, ürün veya kullanıcı ara" /></label>
          {activePageView === 'MOVEMENTS' ? (
            <label className="field-group">
              <span>Tip</span>
              <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
                <option value="">Tüm Tipler</option>
                {typeFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          ) : null}
          {activePageView === 'MOVEMENTS' ? (
            <label className="field-group">
              <span>Sebep</span>
              <select value={filters.reasonCode} onChange={(event) => setFilters((current) => ({ ...current, reasonCode: event.target.value }))}>
                <option value="">Tüm Sebepler</option>
                {reasonFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          ) : null}
          <label className="field-group"><span>Konum</span><select value={filters.location} onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))}><option value="">Tüm Konumlar</option><option value="depo">Depo</option><option value="reyon">Reyon</option></select></label>
          <label className="field-group">
            <span>{activePageView === 'MOVEMENTS' ? 'İşlem Miktarı (Şundan Az)' : 'Stok Miktarı (Şundan Az)'}</span>
            <input type="number" min="1" value={filters.maxStock} onChange={(event) => setFilters((current) => ({ ...current, maxStock: event.target.value }))} placeholder="örn. 5" />
          </label>
          {activePageView === 'VIEW' ? (
            <div className="field-group stock-movement-toggle-group">
              <label className="critical-stock-toggle-control">
                <input
                  type="checkbox"
                  checked={filters.criticalOnly}
                  onChange={(event) => setFilters((current) => ({ ...current, criticalOnly: event.target.checked }))}
                />
                <span className="critical-stock-toggle-slider" aria-hidden="true"></span>
                <span className="critical-stock-toggle-text">Kritik stokta olanlar</span>
              </label>
              <label className="critical-stock-toggle-control">
                <input
                  type="checkbox"
                  checked={filters.outOfStockOnly}
                  onChange={(event) => setFilters((current) => ({ ...current, outOfStockOnly: event.target.checked }))}
                />
                <span className="critical-stock-toggle-slider" aria-hidden="true"></span>
                <span className="critical-stock-toggle-text">Tükenmiş ürünler</span>
              </label>
            </div>
          ) : null}
        </FilterBar>
      </div>
      ) : null}

      {activePageView === 'VIEW' ? (
      <div className="mod-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-blue"><Package size={18} /></div>
          <div><h3>Stok Özeti</h3><p>Anlık stok, kritik seviye ve ürün durumu</p></div>
        </div>
        <DataTable columns={stockColumns} rows={filteredStocks} isLoading={isLoading} emptyMessage="Stok verisi bulunmuyor." pageSize={10} />
      </div>
      ) : null}

      {activePageView === 'MOVEMENTS' ? (
      <div className="mod-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-indigo"><Activity size={18} /></div>
          <div><h3>Hareket Geçmişi</h3><p>Filtrelenmiş tüm stok hareketleri</p></div>
        </div>
        <DataTable columns={movementColumns} rows={filteredMovements} isLoading={isLoading} emptyMessage="Hareket kaydı bulunmuyor." initialSort={{ key: 'createdAt', direction: 'desc' }} pageSize={10} />
      </div>
      ) : null}

      <FormModal
        isOpen={quickEntryModalOpen}
        title={quickEntryType === 'IN' ? 'Hızlı Barkod Girişi' : 'Hızlı Barkod Çıkışı'}
        onClose={closeQuickEntryModal}
        modalClassName="quick-entry-modal"
      >
        <form className="modal-form quick-entry-form" onSubmit={submitQuickEntry}>
          <div className="quick-entry-actions">
            {quickSelectedProduct ? <span className="quick-entry-found">Ürün bulundu: {quickSelectedProduct.productName}</span> : null}
          </div>

          <label className="field-group quick-barcode-manual-group">
            <span>Barkod (Elle)</span>
            <div className="quick-barcode-manual-row">
              <input
                value={quickEntryForm.barcode}
                onChange={(event) => setQuickEntryForm((current) => ({ ...current, barcode: event.target.value, productId: '' }))}
                placeholder="Barkod numarası girin"
                disabled={!isAdmin}
              />
              <button
                type="button"
                className={`outline-button quick-scan-trigger ${quickEntryScanning ? 'is-scanning' : ''}`}
                onClick={quickEntryScanning ? stopQuickEntryScanner : startQuickEntryScanner}
                disabled={!isAdmin}
                title={quickEntryScanning ? 'Taramayı Durdur' : 'Barkod Oku'}
              >
                {quickEntryScanning ? <CameraOff size={16} /> : <ScanBarcode size={16} />}
              </button>
              <button
                type="button"
                className="outline-button quick-barcode-manual-btn"
                onClick={() => resolveBarcodeToProduct(quickEntryForm.barcode)}
                disabled={!isAdmin}
              >
                Ürünü Bul
              </button>
            </div>
          </label>

          {quickEntryScanning ? (
            <div className="quick-entry-camera">
              <div id="quick-stock-reader"></div>
              <div className="quick-entry-camera-hint"><Camera size={14} /> Barkodu kamera alanına tutun</div>
            </div>
          ) : null}

          {quickEntryScanError ? (
            <div className="quick-entry-error">
              <span>{quickEntryScanError}</span>
              <button type="button" className="ghost-button" onClick={startQuickEntryScanner} disabled={quickEntryScanning}>
                Tekrar Dene
              </button>
            </div>
          ) : null}

          <label className="field-group">
            <span>Miktar</span>
            <input type="number" min="1" value={quickEntryForm.qty} onChange={(event) => setQuickEntryForm((current) => ({ ...current, qty: event.target.value }))} disabled={!isAdmin} />
          </label>

          <button className={quickEntryType === 'IN' ? 'primary-button' : 'danger-button'} type="submit" disabled={!isAdmin || processingType === `QUICK_${quickEntryType}`}>
            {processingType === `QUICK_${quickEntryType}` ? 'Kaydediliyor...' : quickEntryType === 'IN' ? 'Hızlı Girişi Kaydet' : 'Hızlı Çıkışı Kaydet'}
          </button>
        </form>
      </FormModal>
    </div>
  );
}
