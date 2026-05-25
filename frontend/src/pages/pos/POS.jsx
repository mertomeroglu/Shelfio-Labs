import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, ScanBarcode, Trash2, CreditCard, Banknote, RotateCcw,
  Plus, Minus, XCircle, CheckCircle2, Receipt, ArrowLeft, Search, Eraser,
  DoorOpen, AlertTriangle, X, Loader2, Camera, CameraOff,
  QrCode, Building2, Printer, FileText, Split, Hash, LayoutGrid, Gift, Tag,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';
import { useDialog } from '../../components/ConfirmModal.jsx';
import { posService } from '../../services/posService.js';
import { settingsService } from '../../services/settingsService.js';
import { formatReturnReasonLabel, formatUnit } from '../../services/formatters.js';
import { SUPPORT_CONTACT } from '../../constants/contact.js';
import { CAMERA_PERMISSION_HELP_TEXT, getCameraErrorMessage, logCameraError, startHtml5Scanner, waitForCameraElement } from '../../utils/cameraAccess.js';

const loadHtml5Qrcode = async () => {
  const mod = await import('html5-qrcode');
  return mod.Html5Qrcode;
};

/* Audio */
const audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
function playBeep(freq = 1200, duration = 100, vol = 0.13) {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.frequency.value = freq; gain.gain.value = vol;
  osc.start(); osc.stop(audioCtx.currentTime + duration / 1000);
}
const beepScan = () => playBeep(1200, 80, 0.12);
const beepSuccess = () => { playBeep(880, 80, 0.1); setTimeout(() => playBeep(1320, 120, 0.1), 100); };
const beepRemove = () => { playBeep(640, 70, 0.09); setTimeout(() => playBeep(520, 90, 0.09), 75); };
const beepError = () => playBeep(300, 200, 0.15);

/* Constants */
const PAYMENT_METHODS = [
  { key: 'cash', label: 'Nakit', icon: Banknote, color: '#16a34a' },
  { key: 'card', label: 'Kart', icon: CreditCard, color: '#2563eb' },
  { key: 'qr', label: 'QR Ödeme', icon: QrCode, color: '#7c3aed' },
  { key: 'eft', label: 'Havale/EFT', icon: Building2, color: '#0891b2' },
  { key: 'giftcard', label: 'Hediye Kartı', icon: Gift, color: '#db2777' },
];

const RETURN_REASONS = [
  { key: 'defective', label: 'Kusurlu Ürün' },
  { key: 'customer_request', label: 'Müşteri Talebi' },
  { key: 'wrong_product', label: 'Yanlış Ürün' },
  { key: 'other', label: 'Diğer' },
];

const RETURN_TYPES = [
  { key: 'original', label: 'Orijinal ödeme yöntemi' },
  { key: 'cash', label: 'Nakit iade' },
  { key: 'card', label: 'Kart iade' },
  { key: 'exchange', label: 'Değişim' },
];

const buildPreviewReferenceNo = (prefix) =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(100 + Math.random() * 900)}`;

const APP_FOOTER_TEXT = '© 2026 Shelfio Stok ve Fiyat Yönetim Platformu. Tüm hakları saklıdır.';
const BAG_PRODUCT = {
  id: '__bag__',
  barcode: 'BAG-001',
  name: 'Poşet',
  sku: 'BAG',
  salePrice: 1,
  currentStock: 9999,
};

const STORE_LEGAL_INFO = {
  companyName: 'Shelfio Magazacilik Ltd. Sti.',
  taxOffice: 'Bornova Vergi Dairesi',
  taxNumber: '1567957351',
  mersisNo: '0274058163400001',
  website: 'www.shelfio.com',
  email: SUPPORT_CONTACT.email,
  phone: '+90 534 271 83 94',
  address: 'Kazımdirik, 372. Sk.',
};

const STORE_EFT_INFO = {
  bankName: 'Halkbank',
  accountName: 'Shelfio Magazacilik Ltd. Sti.',
  iban: 'TR59 9889 1077 3250 5329 4475 10',
};

function BagLineIcon({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8.4 3.6h7.2l1.6 4.9H6.8z" />
      <path d="M6.7 8.5h10.6c.9 0 1.5.8 1.4 1.7l-1 8.8a2.4 2.4 0 0 1-2.4 2H8.7a2.4 2.4 0 0 1-2.4-2l-1-8.8c-.1-.9.5-1.7 1.4-1.7Z" />
      <path d="M8.9 3.6 8.2 8.5" />
      <path d="M15.1 3.6 15.8 8.5" />
      <path d="M9.2 12.3c1.8 1.1 3.8 1.1 5.6 0" />
    </svg>
  );
}

function LockIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

const DESK_LABELS = {
  B1: 'Kasa 1',
  B2: 'Kasa 2',
  B3: 'Kasa 3',
  B4: 'Kasa 4',
  B5: 'Kasa 5',
  B6: 'Kasa 6',
  B7: 'Kasa 7',
  B8: 'Yönetim Kasası',
};
const ACTIVE_DESK_SESSIONS_KEY = 'pos_active_desk_sessions';
const ALL_CATEGORY_ID = '__all__';
const CATEGORY_PAGE_SIZE = 120;

const toSafeText = (value) => String(value ?? '').trim();
const toCents = (value) => Math.round((Number(value) || 0) * 100);
const fromCents = (value) => (Number(value) || 0) / 100;

const resolveProductId = (product, index = 0) => {
  const candidates = [product?.id, product?.productId, product?.barcode, product?.sku];
  for (const candidate of candidates) {
    const normalized = toSafeText(candidate);
    if (normalized) return normalized;
  }
  return `product-fallback-${index}`;
};

const normalizeCategories = (items) => {
  const list = Array.isArray(items) ? items : [];
  const seenIds = new Set();

  return list.reduce((acc, item, index) => {
    const safeId = toSafeText(item?.id || item?.categoryId);
    if (safeId) {
      if (seenIds.has(safeId)) return acc;
      seenIds.add(safeId);
    }

    acc.push({
      ...item,
      _safeId: safeId,
      _renderKey: safeId || `category-${toSafeText(item?.name).toLowerCase() || 'unknown'}-${index}`,
    });
    return acc;
  }, []);
};

const normalizeProducts = (items) => {
  const list = Array.isArray(items) ? items : [];
  const seenIds = new Set();

  return list.reduce((acc, item, index) => {
    const safeProductId = resolveProductId(item, index);
    if (seenIds.has(safeProductId)) return acc;
    seenIds.add(safeProductId);

    acc.push({
      ...item,
      _safeProductId: safeProductId,
      _renderKey: `${safeProductId}-${index}`,
    });
    return acc;
  }, []);
};

const resolvePosUnitPrice = (product = {}) => Number(
  product?.currentPrice
  ?? product?.discountedPrice
  ?? product?.salePrice
  ?? product?.price
  ?? product?.unitPrice
  ?? 0
) || 0;

const normalizeSales = (items) => {
  const list = Array.isArray(items) ? items : [];
  return list.map((item, index) => {
    const safeId = toSafeText(item?.id) || toSafeText(item?.referenceNo) || `sale-${index}`;
    return {
      ...item,
      _renderKey: `${safeId}-${index}`,
      items: Array.isArray(item?.items) ? item.items : [],
      payments: Array.isArray(item?.payments) ? item.payments : [],
    };
  });
};

const clearActiveDeskSession = (deskCode) => {
  try {
    const raw = localStorage.getItem(ACTIVE_DESK_SESSIONS_KEY);
    const sessions = raw ? JSON.parse(raw) : {};
    if (sessions && typeof sessions === 'object') {
      delete sessions[deskCode];
      localStorage.setItem(ACTIVE_DESK_SESSIONS_KEY, JSON.stringify(sessions));
    }
  } catch {
    // ignore storage errors
  }
};

const pLabel = (key) => PAYMENT_METHODS.find((m) => m.key === key)?.label || key;

const normalizeGiftCards = (items) => {
  if (!Array.isArray(items)) return [];

  return items
    .map((item, index) => ({
      id: toSafeText(item?.id) || `gift-${index}`,
      code: toSafeText(item?.code).toUpperCase(),
      name: toSafeText(item?.name) || 'Hediye Kartı',
      valueType: toSafeText(item?.valueType) === 'percentage' ? 'percentage' : 'amount',
      value: Number(item?.value) || 0,
      usageLimit: Math.max(1, Math.floor(Number(item?.usageLimit ?? item?.maxUsage ?? 1) || 1)),
      maxUsage: Math.max(1, Math.floor(Number(item?.usageLimit ?? item?.maxUsage ?? 1) || 1)),
      usedCount: Math.max(0, Math.floor(Number(item?.usedCount) || 0)),
      remainingUsage: Math.max(0, Math.floor(Number(item?.remainingUsage ?? (Number(item?.usageLimit ?? item?.maxUsage ?? 1) || 1) - (Number(item?.usedCount) || 0)) || 0)),
      allowedCategoryIds: Array.isArray(item?.allowedCategoryIds) ? item.allowedCategoryIds.map((id) => toSafeText(id)).filter(Boolean) : [],
      isActive: item?.isActive !== false,
    }))
    .filter((item) => item.code && item.value > 0 && item.isActive);
};

export default function POS({ deskCode = 'B1' }) {
  const { user } = useAuth();
  const dialog = useDialog();
  const location = useLocation();
  const navigate = useNavigate();
  const deskLabel = DESK_LABELS[deskCode] || deskCode;

  /* State */
  const [cart, setCart] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const [barcode, setBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cameraScanning, setCameraScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [priceChecking, setPriceChecking] = useState(false);
  const [priceModal, setPriceModal] = useState(false);
  const [priceBarcode, setPriceBarcode] = useState('');
  const [priceResult, setPriceResult] = useState(null);
  const [priceError, setPriceError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searching, setSearching] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [categoryProducts, setCategoryProducts] = useState([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState('');
  const [categoryRenderLimit, setCategoryRenderLimit] = useState(CATEGORY_PAGE_SIZE);

  // Kasa kilitli mi
  const [locked, setLocked] = useState(false);
  // Kilit açma için sicil inputu
  const [unlockInput, setUnlockInput] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const unlockInputRef = useRef(null);
  const [showCategoryBrowser, setShowCategoryBrowser] = useState(false);


  const [customer, setCustomer] = useState(null);

  const [toast, setToast] = useState(null);
  const [paymentModal, setPaymentModal] = useState(false);
  const [exitModal, setExitModal] = useState(false);
  const [discountRate, setDiscountRate] = useState('0');
  const [isDiscountEditorOpen, setIsDiscountEditorOpen] = useState(false);
  const [discountDraft, setDiscountDraft] = useState('0');
  const [processing, setProcessing] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [lastAction, setLastAction] = useState(null);
  const [todaySales, setTodaySales] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [sessionStartedAt] = useState(new Date().toISOString());

  // Split payment state
  const [splitMode, setSplitMode] = useState(false);
  const [payments, setPayments] = useState([]);
  const [singleMethod, setSingleMethod] = useState('cash');
  const [qrPaymentRef, setQrPaymentRef] = useState('');
  const [eftPaymentInfo, setEftPaymentInfo] = useState(STORE_EFT_INFO);
  const [giftCards, setGiftCards] = useState([]);
  const [giftCardCode, setGiftCardCode] = useState('');
  const [appliedGiftCard, setAppliedGiftCard] = useState(null);
  const [receivedAmount, setReceivedAmount] = useState('');

  // Return state
  const [returnMode, setReturnMode] = useState(false);
  const [returnModal, setReturnModal] = useState(false);
  const [returnSearchRef, setReturnSearchRef] = useState('');
  const [originalSale, setOriginalSale] = useState(null);
  const [returnItems, setReturnItems] = useState([]);
  const [returnReason, setReturnReason] = useState('customer_request');
  const [returnReasonDetail, setReturnReasonDetail] = useState('');
  const [returnCustomerName, setReturnCustomerName] = useState('');
  const [returnCustomerAddress, setReturnCustomerAddress] = useState('');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [returnType, setReturnType] = useState('original');
  const [partialReturnEnabled, setPartialReturnEnabled] = useState(true);
  const [returnAmountDraft, setReturnAmountDraft] = useState('0');
  const [returnReferencePreview, setReturnReferencePreview] = useState('');
  const [returnSearching, setReturnSearching] = useState(false);
  const [returnSalePickerOpen, setReturnSalePickerOpen] = useState(false);
  const [returnSalePickerLoading, setReturnSalePickerLoading] = useState(false);
  const [returnSalePickerQuery, setReturnSalePickerQuery] = useState('');
  const [returnSalePickerItems, setReturnSalePickerItems] = useState([]);

  // Receipt/Invoice state
  const [receiptData, setReceiptData] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);

  // History detail
  const [historyDetail, setHistoryDetail] = useState(null);

  const barcodeRef = useRef(null);
  const cameraScannerRef = useRef(null);
  const searchTimerRef = useRef(null);
  const categoryProductsCacheRef = useRef(new Map());
  const cartEndRef = useRef(null);
  const externalReturnRequestRef = useRef('');

  /* Effects */
  useEffect(() => {
    if (barcodeRef.current && !paymentModal && !showHistory && !exitModal && !showSearch && !returnModal && !showReceipt && !showInvoice && !priceModal) {
      barcodeRef.current.focus();
    }
  }, [paymentModal, showHistory, exitModal, showSearch, returnModal, showReceipt, showInvoice, priceModal, cart.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const stopCameraScanner = useCallback(async () => {
    const scanner = cameraScannerRef.current;
    if (!scanner) {
      setCameraScanning(false);
      return;
    }
    try { await scanner.stop(); } catch {}
    try { await scanner.clear(); } catch {}
    cameraScannerRef.current = null;
    setCameraScanning(false);
  }, []);

  useEffect(() => () => { void stopCameraScanner(); }, [stopCameraScanner]);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const query = barcode.trim();
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      setShowSearch(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const data = await posService.searchProducts(query);
        setSearchResults(normalizeProducts(data));
        setShowSearch(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [barcode]);

  useEffect(() => { cartEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [cart.length]);
  useEffect(() => { setCategoryRenderLimit(CATEGORY_PAGE_SIZE); }, [selectedCategoryId, categorySearchQuery]);
  useEffect(() => {
    if (!showCategoryBrowser) return;
    if (selectedCategoryId !== ALL_CATEGORY_ID) return;
    if (categoryProductsCacheRef.current.size > 0) return;
    const firstCategory = categories.find((category) => category?._safeId && category._safeId !== ALL_CATEGORY_ID);
    if (firstCategory?._safeId) {
      setSelectedCategoryId(firstCategory._safeId);
    }
  }, [showCategoryBrowser, selectedCategoryId, categories]);

  useEffect(() => {
    let active = true;

    const loadCategories = async () => {
      try {
        const data = await posService.getCategories();
        if (!active) return;
        const normalized = normalizeCategories(data);
        const totalProducts = normalized.reduce((sum, item) => sum + (Number(item.productCount) || 0), 0);
        const allCategory = {
          id: ALL_CATEGORY_ID,
          name: 'Tüm Ürünler (Hepsi)',
          code: 'ALL',
          productCount: totalProducts,
          _safeId: ALL_CATEGORY_ID,
          _renderKey: 'category-all',
        };
        setCategories([allCategory, ...normalized]);
        setSelectedCategoryId(ALL_CATEGORY_ID);
      } catch {
        if (!active) return;
        setCategories([]);
      }
    };

    loadCategories();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadGiftCards = async () => {
      try {
        const settings = await settingsService.get();
        if (!active) return;
        setGiftCards(normalizeGiftCards(settings?.customerRelations?.giftCards));
      } catch {
        if (!active) return;
        setGiftCards([]);
      }
    };

    loadGiftCards();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedCategoryId) {
      setCategoryProducts([]);
      return;
    }

    let active = true;

    const loadProducts = async () => {
      setCategoryLoading(true);
      try {
        if (selectedCategoryId === ALL_CATEGORY_ID) {
          const cachedLists = [...categoryProductsCacheRef.current.values()];
          if (cachedLists.length > 0) {
            setCategoryProducts(normalizeProducts(cachedLists.flat()));
          } else {
            setCategoryProducts([]);
          }
          return;
        }
        if (categoryProductsCacheRef.current.has(selectedCategoryId)) {
          if (active) {
            setCategoryProducts(categoryProductsCacheRef.current.get(selectedCategoryId) || []);
          }
          return;
        }
        const data = normalizeProducts(await posService.getProductsByCategory(selectedCategoryId));
        if (active) {
          categoryProductsCacheRef.current.set(selectedCategoryId, data);
          setCategoryProducts(data);
        }
      } catch {
        if (active) {
          setCategoryProducts([]);
        }
      } finally {
        if (active) {
          setCategoryLoading(false);
        }
      }
    };

    loadProducts();

    return () => {
      active = false;
    };
  }, [selectedCategoryId]);

  /* Helpers */
  const showToast = (type, message) => setToast({ type, message });
  const totalItems = cart.reduce((s, i) => s + i.quantity, 0);
  const subtotalCents = cart.reduce((sum, item) => sum + (toCents(item.unitPrice) * (Number(item.quantity) || 0)), 0);
  const subtotal = fromCents(subtotalCents);
  const discountRaw = Math.max(Number(discountRate) || 0, 0);
  const appliedDiscountRate = Math.min(discountRaw, 100);
  const discountAmountCents = Math.min(Math.round((subtotalCents * appliedDiscountRate) / 100), subtotalCents);
  const discountAmount = fromCents(discountAmountCents);
  const grandTotalCents = Math.max(subtotalCents - discountAmountCents, 0);
  const grandTotal = fromCents(grandTotalCents);
  const discountScale = subtotal > 0 ? grandTotal / subtotal : 1;

  const openDiscountEditor = () => {
    setDiscountDraft(String(appliedDiscountRate.toFixed(0)));
    setIsDiscountEditorOpen(true);
  };

  const applyDiscountRate = () => {
    const parsed = Number(discountDraft);
    const normalized = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100) : 0;
    setDiscountRate(String(normalized));
    setIsDiscountEditorOpen(false);
  };

  const clearDiscountRate = () => {
    setDiscountDraft('0');
    setDiscountRate('0');
    setIsDiscountEditorOpen(false);
  };

  const vatAmount = cart.reduce((sum, item) => {
    const lineGross = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0);
    const vatRate = Number.isFinite(Number(item.vatRate)) ? Math.max(Number(item.vatRate), 0) : 20;
    const lineVat = lineGross - (lineGross / (1 + vatRate / 100));
    return sum + (lineVat * discountScale);
  }, 0);
  const receivedCents = toCents(receivedAmount);
  const received = fromCents(receivedCents);
  const paymentsTotalCents = payments.reduce((s, p) => s + toCents(p.amount), 0);
  const paymentsTotal = fromCents(paymentsTotalCents);
  const remaining = splitMode ? fromCents(Math.max(grandTotalCents - paymentsTotalCents, 0)) : 0;
  const change = !splitMode && singleMethod === 'cash' ? fromCents(Math.max(receivedCents - grandTotalCents, 0)) : 0;

  const formatPrice = (val) =>
    new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 }).format(fromCents(toCents(val)));
  const formatTime = (iso) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  };
  const formatDate = (iso) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('tr-TR');
  };

  const normalizedCategoryQuery = categorySearchQuery.trim().toLocaleLowerCase('tr-TR');
  const filteredCategoryProducts = useMemo(() => (
    normalizedCategoryQuery
      ? categoryProducts.filter((product) => {
        const name = toSafeText(product?.name).toLocaleLowerCase('tr-TR');
        const barcodeText = toSafeText(product?.barcode).toLocaleLowerCase('tr-TR');
        const skuText = toSafeText(product?.sku).toLocaleLowerCase('tr-TR');
        return name.includes(normalizedCategoryQuery)
          || barcodeText.includes(normalizedCategoryQuery)
          || skuText.includes(normalizedCategoryQuery);
      })
      : categoryProducts
  ), [categoryProducts, normalizedCategoryQuery]);
  const visibleCategoryProducts = useMemo(
    () => filteredCategoryProducts.slice(0, categoryRenderLimit),
    [filteredCategoryProducts, categoryRenderLimit]
  );

  /*  Cart Operations  */
  const addToCart = useCallback((product) => {
    const safeProductId = resolveProductId(product);
    const safeProductName = toSafeText(product?.name || product?.productName) || 'İsimsiz Ürün';
    const safeSalePrice = resolvePosUnitPrice(product);

    setCart((prev) => {
      const existing = prev.find((item) => item.productId === safeProductId);
      if (existing) {
        return prev.map((item) =>
          item.productId === safeProductId ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, {
        productId: safeProductId,
        barcode: toSafeText(product?.barcode),
        name: safeProductName,
        sku: toSafeText(product?.sku),
        categoryId: toSafeText(product?.categoryId),
        vatRate: Number(product?.vatRate ?? 20),
        unitPrice: safeSalePrice,
        salePrice: Number(product?.salePrice ?? product?.price ?? safeSalePrice) || safeSalePrice,
        discountedPrice: product?.discountedPrice ?? null,
        hasActiveDiscount: product?.hasActiveDiscount === true,
        campaignInfo: toSafeText(product?.campaignInfo || product?.activeCampaign?.name),
        quantity: 1,
        currentStock: Number(product?.currentStock ?? 0),
      }];
    });
    setSelectedId(safeProductId);
    setLastAction({
      productName: safeProductName,
      at: new Date().toISOString(),
    });
    beepScan();
  }, []);

  const addBagToCart = () => {
    addToCart(BAG_PRODUCT);
    showToast('success', 'Poşet sepete eklendi');
  };

  const handleBarcodeScan = useCallback(async (scanValue = '') => {
    const code = (typeof scanValue === 'string' ? scanValue : barcode).trim();
    if (!code) return;
    setScanning(true);
    try {
      try {
        const product = await posService.findByBarcode(code);
        addToCart(product);
        setBarcode('');
        return;
      } catch {
        // fallback to product name lookup
      }

      const candidates = normalizeProducts(await posService.searchProducts(code));
      if (candidates.length > 0) {
        addToCart(candidates[0]);
        setBarcode('');
      } else {
        beepError();
        showToast('error', 'Ürün bulunamadı');
      }
    } catch (error) {
      beepError();
      showToast('error', error.message || 'Ürün bulunamadı');
    } finally {
      setScanning(false);
      barcodeRef.current?.focus();
    }
  }, [barcode, addToCart]);

  const handleBarcodeKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleBarcodeScan(); } };

  const startCameraScanner = useCallback(async () => {
    if (cameraScanning) {
      await stopCameraScanner();
      return;
    }
    setCameraError('');
    setCameraScanning(true);
    try {
      const Html5Qrcode = await loadHtml5Qrcode();
      await waitForCameraElement('pos-barcode-camera-reader');
      const scanner = new Html5Qrcode('pos-barcode-camera-reader');
      cameraScannerRef.current = scanner;
      await startHtml5Scanner(
        scanner,
        { fps: 12, qrbox: { width: 260, height: 160 } },
        async (decodedText) => {
          const code = String(decodedText || '').trim();
          await stopCameraScanner();
          setBarcode(code);
          await handleBarcodeScan(code);
        },
        () => {}
      );
    } catch (error) {
      logCameraError(error, 'pos-camera');
      try { await cameraScannerRef.current?.clear(); } catch {}
      cameraScannerRef.current = null;
      setCameraScanning(false);
      const message = `${getCameraErrorMessage(error)} ${CAMERA_PERMISSION_HELP_TEXT}`;
      setCameraError(message);
      showToast('error', message);
    }
  }, [cameraScanning, handleBarcodeScan, stopCameraScanner]);

  const handlePriceCheck = useCallback(async () => {
    const code = priceBarcode.trim();
    if (!code) {
      setPriceError('Barkod girin.');
      return;
    }
    setPriceError('');
    const localPools = [...categoryProductsCacheRef.current.values(), categoryProducts, searchResults, cart].flat();
    const localMatch = localPools.find((product) => toSafeText(product?.barcode) === code);
    if (localMatch) {
      const name = formatUnit(localMatch?.name || localMatch?.productName || 'Ürün');
      const price = resolvePosUnitPrice(localMatch);
      setPriceResult({ name, price, barcode: String(localMatch?.barcode || code) });
      return;
    }
    setPriceChecking(true);
    try {
      const product = await posService.findByBarcode(code);
      const name = formatUnit(product?.name || product?.productName || 'Ürün');
      const price = resolvePosUnitPrice(product);
      setPriceResult({
        name,
        price,
        barcode: String(product?.barcode || code),
      });
    } catch {
      setPriceResult(null);
      setPriceError('Sonuç bulunamadı. Barkodu kontrol edip tekrar deneyin.');
    } finally {
      setPriceChecking(false);
    }
  }, [priceBarcode, categoryProducts, searchResults, cart]);

  const handleClosePriceModal = useCallback(() => {
    setPriceModal(false);
    setPriceResult(null);
    setPriceError('');
    setPriceBarcode('');
    barcodeRef.current?.focus();
  }, []);

  const handleLookupAnotherPrice = useCallback(() => {
    setPriceResult(null);
    setPriceError('');
    setPriceBarcode('');
  }, []);

  const handleSearchSelect = (product) => {
    addToCart(product);
    setBarcode(''); setSearchQuery(''); setSearchResults([]); setShowSearch(false);
    barcodeRef.current?.focus();
  };

  const updateQuantity = (productId, delta) => {
    const currentItem = cart.find((item) => item.productId === productId);
    const willBeRemoved = Boolean(currentItem && currentItem.quantity + delta <= 0);
    const willIncrease = Boolean(currentItem && delta > 0);
    setCart((prev) => prev.map((item) =>
      item.productId === productId ? { ...item, quantity: Math.max(item.quantity + delta, 0) } : item
    ).filter((item) => item.quantity > 0));
    const updatedItem = cart.find((item) => item.productId === productId);
    if (updatedItem) {
      setLastAction({
        productName: updatedItem.name,
        at: new Date().toISOString(),
      });
    }
    if (willBeRemoved) {
      beepRemove();
    } else if (willIncrease) {
      beepScan();
    }
  };

  const removeItem = (productId) => {
    const exists = cart.some((item) => item.productId === productId);
    setCart((prev) => prev.filter((item) => item.productId !== productId));
    if (selectedId === productId) setSelectedId(null);
    if (exists) {
      beepRemove();
    }
  };

  const clearCart = () => {
    if (cart.length > 0) {
      beepRemove();
    }
    setCart([]); setSelectedId(null); setDiscountRate('0'); setBarcode(''); setLastSale(null); setLastAction(null);
    barcodeRef.current?.focus();
  };

  const quickAdjustSelected = (delta) => {
    if (!selectedId) {
      showToast('error', 'Önce bir satır seçin');
      return;
    }
    updateQuantity(selectedId, delta);
  };

  const quickRemoveSelected = () => {
    if (!selectedId) {
      showToast('error', 'Önce bir satır seçin');
      return;
    }
    removeItem(selectedId);
  };

  /*  Payment  */
  const openPayment = () => {
    if (cart.length === 0) { showToast('error', 'Sepet boş, ürün ekleyin'); return; }
    setReceivedAmount(''); setSplitMode(false); setPayments([]);
    setSingleMethod('cash');
    setGiftCardCode('');
    setAppliedGiftCard(null);
    setQrPaymentRef(`SAT-${Date.now().toString().slice(-8)}`);
    setEftPaymentInfo(STORE_EFT_INFO);
    setPaymentModal(true);
  };

  const getGiftCardEligibleSubtotal = (giftCard) => {
    if (!giftCard) return 0;
    const allowed = Array.isArray(giftCard.allowedCategoryIds) ? giftCard.allowedCategoryIds.filter(Boolean) : [];
    if (allowed.length === 0) {
      return subtotal;
    }
    return cart.reduce((sum, item) => (
      allowed.includes(toSafeText(item.categoryId)) ? sum + (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0) : sum
    ), 0);
  };

  const applyGiftCard = async () => {
    const code = toSafeText(giftCardCode).toUpperCase();
    if (!code) {
      showToast('error', 'Hediye kartı kodu girin');
      return;
    }

    const card = giftCards.find((item) => item.code === code);
    if (!card) {
      showToast('error', 'Kart kodu bulunamadı veya pasif durumda');
      return;
    }

    if (Number(card.remainingUsage ?? card.usageLimit ?? 1) <= 0) {
      showToast('error', 'Bu hediye kartının kullanım hakkı kalmadı');
      return;
    }

    const eligibleSubtotal = getGiftCardEligibleSubtotal(card);
    if (eligibleSubtotal <= 0.01) {
      showToast('error', 'Bu hediye kartı sepetteki kategoriye uygun değil');
      return;
    }

    const rawValue = card.valueType === 'percentage' ? (eligibleSubtotal * card.value) / 100 : card.value;
    const deduction = Math.min(Math.max(rawValue, 0), eligibleSubtotal, grandTotal);
    if (deduction <= 0.01) {
      showToast('error', 'Karttan düşülecek tutar bulunamadı');
      return;
    }

    const remainingTotal = Math.max(grandTotal - deduction, 0);

    if (deduction < grandTotal - 0.01) {
      const confirmed = await dialog.confirm({
        title: 'Kısmi Hediye Kartı Kullanımı',
        description: `${formatPrice(deduction)} tutarını hediye kartından düşelim mi? Kalan ${formatPrice(remainingTotal)} için ödeme yöntemi seçeceksiniz.`,
        confirmText: 'Tutarı Düş',
        cancelText: 'Vazgeç',
        closeOnBackdrop: true,
      });

      if (!confirmed) {
        return;
      }

      setSplitMode(true);
      setPayments([{ method: 'giftcard', amount: deduction.toFixed(2) }]);
      setSingleMethod('cash');
      setAppliedGiftCard({ code: card.code, name: card.name, deductedAmount: deduction, remainingTotal });
      showToast('success', `Hediye kartı uygulandı. Kalan: ${formatPrice(remainingTotal)}`);
      return;
    }

    setSplitMode(false);
    setSingleMethod('giftcard');
    setPayments([]);
    setAppliedGiftCard({ code: card.code, name: card.name, deductedAmount: deduction, remainingTotal });
    showToast('success', `Hediye kartı tüm tutarı karşıladı: ${formatPrice(deduction)}`);
  };

  const clearGiftCard = () => {
    setGiftCardCode('');
    setAppliedGiftCard(null);
    setPayments((prev) => prev.filter((payment) => payment.method !== 'giftcard'));
    setSplitMode(false);
    setSingleMethod('cash');
  };

  const addSplitPayment = (method) => {
    setPayments((prev) => [...prev, { method, amount: '' }]);
  };

  const updateSplitAmount = (idx, amount) => {
    setPayments((prev) => prev.map((p, i) => i === idx ? { ...p, amount } : p));
  };

  const removeSplitPayment = (idx) => {
    setPayments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCompleteSale = async () => {
    if (splitMode) {
      if (paymentsTotal < grandTotal - 0.01) {
        showToast('error', `Ödeme toplamı (${formatPrice(paymentsTotal)}) yetersiz`); return;
      }
      const validPayments = payments.filter((p) => Number(p.amount) > 0);
      if (validPayments.length === 0) { showToast('error', 'En az bir ödeme ekleyin'); return; }
    } else {
      if (singleMethod === 'giftcard' && !appliedGiftCard) {
        showToast('error', 'Önce hediye kartı kodu ekleyin'); return;
      }
      if (singleMethod === 'cash' && received < grandTotal) {
        showToast('error', 'Alınan tutar toplam tutardan az olamaz'); return;
      }
    }

    setProcessing(true);
    try {
      const payload = {
        items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })),
        discount: discountAmount,
        customer: customer || undefined,
        deskCode,
        giftCardCode: appliedGiftCard?.code || undefined,
      };

      if (splitMode) {
        payload.payments = payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount) }));
      } else {
        payload.paymentMethod = singleMethod;
        if (singleMethod === 'cash') payload.receivedAmount = received;
      }

      const result = await posService.completeSale(payload);
      setReceiptData(result); setLastSale(result); setPaymentModal(false);
      setCart([]); setSelectedId(null); setDiscountRate('0'); setBarcode(''); setLastAction(null);
      setPayments([]); setSplitMode(false); setGiftCardCode(''); setAppliedGiftCard(null);
      beepSuccess();
      showToast('success', `Satış tamamlandı - ${result.referenceNo}`);
      setShowReceipt(true);
    } catch (error) {
      beepError(); showToast('error', error.message || 'Satış tamamlanamadı');
    } finally { setProcessing(false); }
  };

  /*  Return  */
  const openReturnModal = () => {
    setReturnSearchRef(''); setOriginalSale(null); setReturnItems([]);
    setReturnReason('customer_request'); setRefundMethod('cash');
    setReturnType('original');
    setPartialReturnEnabled(true);
    setReturnAmountDraft('0');
    setReturnReferencePreview(buildPreviewReferenceNo('RET'));
    setReturnReasonDetail('');
    setReturnCustomerName('');
    setReturnCustomerAddress('');
    setReturnSalePickerOpen(false);
    setReturnSalePickerQuery('');
    setReturnSalePickerItems([]);
    setReturnModal(true);
  };

  const hydrateReturnSale = async (sale) => {
    const sourceSale = sale && typeof sale === 'object' ? sale : null;
    if (!sourceSale) return;

    let allSales = [];
    try {
      allSales = await posService.getAllSales({ type: 'return', originalSaleRef: sourceSale.referenceNo, full: true });
    } catch {
      allSales = [];
    }

    const previousReturnMap = new Map();
    (Array.isArray(allSales) ? allSales : [])
      .filter((row) => row?.type === 'return' && row?.originalSaleRef === sourceSale.referenceNo)
      .forEach((row) => {
        (Array.isArray(row.items) ? row.items : []).forEach((item) => {
          const productId = String(item?.productId || '');
          if (!productId) return;
          const qty = Math.max(0, Number(item?.quantity || 0));
          previousReturnMap.set(productId, (previousReturnMap.get(productId) || 0) + qty);
        });
      });

    const hydratedItems = (sourceSale.items || []).map((item) => {
      const productId = String(item?.productId || '');
      const originalQty = Math.max(0, Number(item?.quantity || 0));
      const alreadyReturnedQty = Math.max(0, Number(previousReturnMap.get(productId) || 0));
      const maxReturnQty = Math.max(0, originalQty - alreadyReturnedQty);
      return {
        ...item,
        maxReturnQty,
        alreadyReturnedQty,
        returnQty: maxReturnQty,
        selected: maxReturnQty > 0,
      };
    });

    const totalReturnable = hydratedItems.reduce((sum, item) => sum + Number(item.maxReturnQty || 0), 0);
    if (totalReturnable <= 0) {
      showToast('error', 'Bu fişin iadesi daha önce tamamen yapılmış.');
      setOriginalSale(sourceSale);
      setReturnItems([]);
      setReturnSearchRef(sourceSale.referenceNo || '');
      return;
    }

    setOriginalSale(sourceSale);
    setReturnItems(hydratedItems);
    setReturnSearchRef(sourceSale?.referenceNo || '');

    if (Array.isArray(sourceSale?.payments) && sourceSale.payments.length > 0) {
      const primaryPayment = [...sourceSale.payments].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0];
      if (primaryPayment?.method) {
        setRefundMethod(primaryPayment.method);
      }
    } else if (sourceSale?.paymentMethod) {
      setRefundMethod(sourceSale.paymentMethod);
    }
  };

  const searchOriginalSale = async () => {
    if (!returnSearchRef.trim()) { showToast('error', 'Fiş numarası girin'); return; }
    setReturnSearching(true);
    try {
      const sale = await posService.getSaleByReference(returnSearchRef.trim());
      if (sale.type !== 'sale') { showToast('error', 'Bu referans bir satış değil'); return; }
      await hydrateReturnSale(sale);
    } catch (error) {
      beepError(); showToast('error', error.message || 'Satış bulunamadı');
    } finally { setReturnSearching(false); }
  };

  const startReturnFromReference = async (referenceNo) => {
    const safeReference = toSafeText(referenceNo);
    if (!safeReference) return;

    setReturnMode(true);
    openReturnModal();
    setReturnSearchRef(safeReference);
    setReturnSearching(true);

    try {
      const sale = await posService.getSaleByReference(safeReference);
      if (sale.type !== 'sale') {
        showToast('error', 'Bu referans bir satış değil');
        return;
      }
      await hydrateReturnSale(sale);
      showToast('success', `${safeReference} fişi iade için yüklendi`);
    } catch (error) {
      beepError();
      showToast('error', error.message || 'Satış bulunamadı');
    } finally {
      setReturnSearching(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const mode = toSafeText(params.get('mode')).toLocaleLowerCase('tr-TR');
    const referenceNo = toSafeText(params.get('ref'));
    const requestKey = `${mode}:${referenceNo}`;

    if (mode !== 'return' || !referenceNo) return;
    if (externalReturnRequestRef.current === requestKey) return;

    externalReturnRequestRef.current = requestKey;
    startReturnFromReference(referenceNo);
  }, [location.search]);

  const openReturnSalePicker = async () => {
    setReturnSalePickerOpen(true);
    if (returnSalePickerItems.length > 0) {
      return;
    }

    setReturnSalePickerLoading(true);
    try {
      const sales = await posService.getAllSales({ type: 'sale', limit: 50 });
      const onlySales = normalizeSales(sales).filter((item) => item.type === 'sale');
      setReturnSalePickerItems(onlySales);
    } catch {
      setReturnSalePickerItems([]);
      showToast('error', 'Geçmiş satışlar yüklenemedi');
    } finally {
      setReturnSalePickerLoading(false);
    }
  };

  const selectReturnSaleFromPicker = async (sale) => {
    await hydrateReturnSale(sale);
    setReturnSalePickerOpen(false);
    setReturnSalePickerQuery('');
    showToast('success', `${sale.referenceNo} fişi seçildi`);
  };

  const filteredReturnSalePickerItems = returnSalePickerItems.filter((sale) => {
    const query = returnSalePickerQuery.trim().toLocaleLowerCase('tr-TR');
    if (!query) return true;

    const haystack = [
      sale.referenceNo,
      sale.cashierName,
      formatDate(sale.createdAt),
      formatTime(sale.createdAt),
    ].map((value) => toSafeText(value).toLocaleLowerCase('tr-TR')).join(' ');

    return haystack.includes(query);
  });

  const toggleReturnItem = (idx) => {
    if (!partialReturnEnabled) {
      return;
    }
    setReturnItems((prev) => prev.map((item, i) =>
      i === idx ? { ...item, selected: !item.selected, returnQty: !item.selected ? Number(item.maxReturnQty || item.quantity || 0) : 0 } : item
    ));
  };

  const updateReturnQty = (idx, qty) => {
    if (!partialReturnEnabled) {
      return;
    }
    setReturnItems((prev) => prev.map((item, i) =>
      i === idx ? { ...item, returnQty: Math.min(Math.max(qty, 0), Number(item.maxReturnQty || item.quantity || 0)) } : item
    ));
  };

  const returnTotal = returnItems.filter((i) => i.selected && i.returnQty > 0)
    .reduce((sum, i) => sum + i.unitPrice * i.returnQty, 0);

  useEffect(() => {
    setReturnAmountDraft(returnTotal.toFixed(2));
  }, [returnTotal]);

  useEffect(() => {
    if (!returnItems.length) return;
    if (partialReturnEnabled) return;

    setReturnItems((prev) => prev.map((item) => ({ ...item, selected: true, returnQty: Number(item.maxReturnQty || item.quantity || 0) })));
  }, [partialReturnEnabled, returnItems.length]);

  const originalRefundMethodLabel = pLabel(refundMethod);

  const handleProcessReturn = async () => {
    const items = returnItems.filter((i) => i.selected && i.returnQty > 0);
    if (!returnSearchRef.trim()) { showToast('error', 'Fiş numarası girin'); return; }
    if (!returnCustomerName.trim()) { showToast('error', 'Ad soyad girin'); return; }
    if (!returnCustomerAddress.trim()) { showToast('error', 'Adres girin'); return; }
    if (!returnReason) { showToast('error', 'İade nedeni seçin'); return; }
    if (returnReason === 'other' && !returnReasonDetail.trim()) { showToast('error', 'Diğer nedeni için açıklama girin'); return; }
    if (items.length === 0) { showToast('error', 'İade edilecek ürün seçin'); return; }

    const invalidLine = items.find((item) => Number(item.returnQty || 0) > Number(item.maxReturnQty || item.quantity || 0));
    if (invalidLine) {
      showToast('error', `${formatUnit(invalidLine.name)} için iade adedi kalan miktarı aşıyor`);
      return;
    }

    const requestedReturnAmount = Number(returnAmountDraft);
    if (!Number.isFinite(requestedReturnAmount) || requestedReturnAmount <= 0) {
      showToast('error', 'İade edilecek tutar 0 dan büyük olmalı'); return;
    }
    if (requestedReturnAmount > returnTotal + 0.01) {
      showToast('error', 'İade tutarı seçilen ürün toplamını aşamaz'); return;
    }

    const scaleRatio = returnTotal > 0 ? Math.min(requestedReturnAmount / returnTotal, 1) : 1;
    const resolvedRefundMethod = returnType === 'original' ?
      (refundMethod || 'cash')
      : (returnType === 'exchange' ? 'cash' : returnType);

    setProcessing(true);
    try {
      const payload = {
        items: items.map((i) => ({ productId: i.productId, quantity: i.returnQty, unitPrice: Number((i.unitPrice * scaleRatio).toFixed(2)) })),
        originalSaleRef: originalSale?.referenceNo || null,
        returnReason,
        returnReasonDetail: [
          returnReason === 'other' ? returnReasonDetail.trim() : null,
          returnType === 'exchange' ? 'İade Türü: Değişim' : null,
        ].filter(Boolean).join(' | ') || null,
        customer: {
          name: returnCustomerName.trim(),
          address: returnCustomerAddress.trim(),
        },
        refundMethod: resolvedRefundMethod,
        deskCode,
      };

      const result = await posService.processReturn(payload);
      setReceiptData(result);
      setLastSale(result);
      setReturnModal(false);
      setCart([]);
      setSelectedId(null);
      setDiscountRate('0');
      setBarcode('');
      setOriginalSale(null);
      setReturnItems([]);
      setReturnReasonDetail('');
      setReturnCustomerName('');
      setReturnCustomerAddress('');
      setLastAction(null);
      beepSuccess();
      showToast('success', `İade tamamlandı - ${result.referenceNo}`);
      setShowReceipt(true);
    } catch (error) {
      beepError();
      showToast('error', error.message || 'İade tamamlanamadı');
    } finally {
      setProcessing(false);
    }
  };

  const handleQuickReturn = async () => {
    if (cart.length === 0) { showToast('error', 'Sepet boş'); return; }

    setProcessing(true);
    try {
      const payload = {
        items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })),
        returnReason: 'other',
        refundMethod,
        deskCode,
      };

      const result = await posService.processReturn(payload);
      setReceiptData(result);
      setLastSale(result);
      setCart([]);
      setSelectedId(null);
      setDiscountRate('0');
      setBarcode('');
      setLastAction(null);
      beepSuccess();
      showToast('success', `İade tamamlandı - ${result.referenceNo}`);
      setShowReceipt(true);
    } catch (error) {
      beepError();
      showToast('error', error.message || 'İade tamamlanamadı');
    } finally {
      setProcessing(false);
    }
  };

  const loadTodaySales = async () => {
    try {
      const sales = await posService.getTodaySales();
      setTodaySales(normalizeSales(sales));
      setShowHistory(true);
      setHistoryDetail(null);
    } catch {
      showToast('error', 'İşlem geçmişi yüklenemedi');
    }
  };

  const handleExitRequest = () => {
    setExitModal(true);
  };

  const handleExitConfirm = () => {
    setExitModal(false);
    clearActiveDeskSession(deskCode);
    navigate('/pos-kasa');
  };

  /*  Print Receipt  */
  const printReceipt = async () => {
    if (!receiptData) return;
    try {
      await posService.downloadReceiptPdf(receiptData, { deskCode });
    } catch {
      showToast('error', 'Fiş PDF oluşturulamadı');
    }
  };

  /* nvoice  */
  const printEInvoice = async () => {
    if (!receiptData) return;
    try {
      await posService.downloadInvoicePdf(receiptData, { deskCode });
    } catch {
      showToast('error', 'Fatura PDF oluşturulamadı');
    }
  };

  /*  History View  */
  if (showHistory) {
    return (
      <div className="pos-screen">
        <div className="pos-history-view">
          <div className="pos-history-header">
            <button className="pos-btn pos-btn-ghost" type="button" onClick={() => { setShowHistory(false); setHistoryDetail(null); }}>
              <ArrowLeft size={20} /> Kasaya Dön
            </button>
            <h2>Tüm İşlemler</h2>
          </div>

          {historyDetail ? (
            <div className="pos-detail-view">
              <button className="pos-btn pos-btn-ghost" type="button" onClick={() => setHistoryDetail(null)}>
                <ArrowLeft size={16} /> Listeye Dön
              </button>
              <div className="pos-detail-card">
                <div className="pos-detail-head">
                  <h3>{historyDetail.referenceNo}</h3>
                  <span className={`pos-detail-badge ${historyDetail.type}`}>{historyDetail.type === 'return' ? 'İade' : 'Satış'}</span>
                </div>
                <div className="pos-detail-meta">
                  <span>Kasiyer: {historyDetail.cashierName}</span>
                  <span>Tarih: {formatDate(historyDetail.createdAt)} {formatTime(historyDetail.createdAt)}</span>
                  <span>Ödeme: {(historyDetail.payments || []).map((p) => `${pLabel(p.method)} ${formatPrice(p.amount)}`).join(', ') || pLabel(historyDetail.paymentMethod)}</span>
                  {historyDetail.originalSaleRef && <span>Orijinal Fiş: {historyDetail.originalSaleRef}</span>}
                  {historyDetail.returnReason && <span>İade Nedeni: {historyDetail.returnReasonLabel || formatReturnReasonLabel(historyDetail.returnReason)}</span>}
                </div>
                <table className="pos-detail-table">
                  <thead><tr><th>Ürün</th><th>Barkod</th><th>Adet</th><th>B.Fiyat</th><th>Toplam</th></tr></thead>
                  <tbody>
                    {(historyDetail.items || []).map((i, idx) => (
                      <tr key={i.productId || i.barcode || `${i.name || 'item'}-${idx}`}><td>{i.name}</td><td>{i.barcode}</td><td>{i.quantity}</td><td>{formatPrice(i.unitPrice)}</td><td>{formatPrice(i.totalPrice)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div className="pos-detail-totals">
                  <span>Toplam Ürün: {(historyDetail.items || []).length}</span>
                  <span>Toplam Adet: {(historyDetail.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)}</span>
                  <span>Ara Toplam: {formatPrice(historyDetail.subtotal)}</span>
                  {historyDetail.discount > 0 && <span>İndirim: -{formatPrice(historyDetail.discount)}</span>}
                  <strong>Toplam: {formatPrice(historyDetail.totalAmount)}</strong>
                  {historyDetail.changeAmount > 0 && <span>Para Üstü: {formatPrice(historyDetail.changeAmount)}</span>}
                </div>
                <div className="pos-detail-actions">
                  <button className="pos-btn pos-btn-primary" type="button" onClick={() => { setReceiptData(historyDetail); printReceipt(); }}><Printer size={16} /> Fiş Yazdır</button>
                  <button className="pos-btn pos-btn-secondary" type="button" onClick={() => { setReceiptData(historyDetail); printEInvoice(); }}><FileText size={16} /> e-Fatura</button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="pos-history-list">
                {todaySales.length === 0 ? (
                  <div className="pos-empty-state"><Receipt size={52} strokeWidth={1.2} /><p>Bugün henüz işlem yok</p></div>
                ) : todaySales.map((s) => (
                  <div key={s._renderKey} className={`pos-history-row ${s.type === 'return' ? 'pos-return-row' : ''}`}
                    onClick={() => setHistoryDetail(s)} style={{ cursor: 'pointer' }}>
                    <div className="pos-history-ref"><strong>{s.referenceNo}</strong><span>{formatTime(s.createdAt)}</span></div>
                    <div className="pos-history-detail">
                      <span>{s.items.length} ürün · {(s.payments || []).map((p) => pLabel(p.method)).join(', ') || pLabel(s.paymentMethod)}</span>
                      <span className="pos-history-type">{s.type === 'return' ? 'İade' : 'Satış'}</span>
                    </div>
                    <div className="pos-history-amount"><strong>{s.type === 'return' ? '-' : ''}{formatPrice(s.totalAmount)}</strong></div>
                  </div>
                ))}
              </div>
              <div className="pos-history-summary">
                <span>Toplam Satış: <strong>{formatPrice(todaySales.filter((s) => s.type === 'sale').reduce((a, s) => a + s.totalAmount, 0))}</strong></span>
                <span>Toplam İade: <strong>{formatPrice(todaySales.filter((s) => s.type === 'return').reduce((a, s) => a + s.totalAmount, 0))}</strong></span>
                <span>İşlem: <strong>{todaySales.length}</strong></span>
              </div>
            </>
          )}
        </div>
        <footer className="pos-screen-footer">{APP_FOOTER_TEXT}</footer>
      </div>
    );
  }

  /*  Receipt Post-Sale View  */
  if (showReceipt && receiptData) {
    const receiptItems = Array.isArray(receiptData.items) ? receiptData.items : [];
    const receiptPayments = Array.isArray(receiptData.payments) && receiptData.payments.length > 0 ?
      receiptData.payments
      : [{ method: receiptData.paymentMethod || 'cash', amount: receiptData.totalAmount }];
    const receiptSubtotal = Number(receiptData.subtotal || 0);
    const receiptDiscount = Number(receiptData.discount || 0);
    const receiptTotal = Number(receiptData.totalAmount || 0);
    const receiptDiscountScale = receiptSubtotal > 0 ? Math.max(0, Math.min((receiptSubtotal - receiptDiscount) / receiptSubtotal, 1)) : 1;
    const receiptVatAmount = receiptItems.reduce((sum, item) => {
      const lineTotal = Number(item.totalPrice || ((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0)));
      const lineVatRate = Number.isFinite(Number(item.vatRate)) ? Math.max(Number(item.vatRate), 0) : 20;
      const lineVat = lineTotal - (lineTotal / (1 + lineVatRate / 100));
      return sum + (lineVat * receiptDiscountScale);
    }, 0);
    const receiptVatBase = Math.max(0, receiptTotal - receiptVatAmount);

    return (
      <div className="pos-screen">
        <div className="pos-receipt-view">
          <div className="pos-receipt-slip">
            <div className="pos-receipt-slip-head">
              <strong>{STORE_LEGAL_INFO.companyName}</strong>
              <span>{STORE_LEGAL_INFO.address}</span>
              <span>Tel: {STORE_LEGAL_INFO.phone}</span>
            </div>

            <div className="pos-receipt-slip-meta">
              <div><span>Belge</span><strong>{receiptData.type === 'return' ? 'Perakende İade Fişi' : 'Perakende Satış Fişi'}</strong></div>
              <div><span>Fiş No</span><strong>{receiptData.referenceNo || '-'}</strong></div>
              <div><span>Tarih</span><strong>{formatDate(receiptData.createdAt)} {formatTime(receiptData.createdAt)}</strong></div>
              <div><span>Kasa</span><strong>{deskLabel}</strong></div>
              <div><span>Kasiyer</span><strong>{receiptData.cashierName || user?.name || '-'}</strong></div>
              {receiptData.originalSaleRef ? <div><span>Orijinal Fiş</span><strong>{receiptData.originalSaleRef}</strong></div> : null}
            </div>

            <div className="pos-receipt-slip-items">
              {receiptItems.map((item, index) => (
                <div className="pos-receipt-slip-item" key={item.productId || item.barcode || `${item.name || 'item'}-${index}`}>
                  <div className="pos-receipt-slip-item-line">
                    <strong>{formatUnit(item.name)}</strong>
                    <span>{formatPrice(item.totalPrice)}</span>
                  </div>
                  <small>{Number(item.quantity) || 0} x {formatPrice(item.unitPrice)}</small>
                </div>
              ))}
            </div>

            <div className="pos-receipt-slip-summary">
              <div><span>Ara Toplam</span><strong>{formatPrice(receiptData.subtotal)}</strong></div>
              <div><span>KDV Matrah</span><strong>{formatPrice(receiptVatBase)}</strong></div>
              <div><span>KDV Tutarı</span><strong>{formatPrice(receiptVatAmount)}</strong></div>
              <div><span>İndirim</span><strong>-{formatPrice(receiptData.discount || 0)}</strong></div>
              <div className="is-total"><span>TOPLAM</span><strong>{formatPrice(receiptData.totalAmount)}</strong></div>
              {receiptData.changeAmount > 0 ? <div><span>Para Üstü</span><strong>{formatPrice(receiptData.changeAmount)}</strong></div> : null}
            </div>

            <div className="pos-receipt-slip-payments">
              {receiptPayments.map((payment, index) => (
                <div key={`${payment.method || 'payment'}-${payment.amount || 0}-${index}`}>
                  <span>{pLabel(payment.method)}</span>
                  <strong>{formatPrice(payment.amount)}</strong>
                </div>
              ))}
            </div>

            <div className="pos-receipt-slip-foot">
              <span>{receiptData.type === 'return' ? 'İade işlemi tamamlandı' : 'Bizi tercih ettiğiniz için teşekkür ederiz'}</span>
            </div>
          </div>

          <div className="pos-receipt-actions">
            <button className="pos-receipt-action-btn" type="button" onClick={printReceipt}><Printer size={22} /><span>Fiş Yazdır</span></button>
            <button className="pos-receipt-action-btn" type="button" onClick={printEInvoice}><FileText size={22} /><span>e-Fatura</span></button>
            <button className="pos-receipt-action-btn pos-receipt-new" type="button" onClick={() => { setShowReceipt(false); setReceiptData(null); }}>
              <ShoppingCart size={22} /><span>Yeni Satış</span>
            </button>
          </div>
        </div>
        <footer className="pos-screen-footer">{APP_FOOTER_TEXT}</footer>
      </div>
    );
  }

  /*  Locked POS View  */
  if (locked) {
    return (
      <div className="pos-screen pos-locked-mode">
        <div className="pos-locked-modal">
          <div className="pos-locked-icon"><LockIcon size={48} /></div>
          <h2>Kasa Kilitli</h2>
          <p>Kasa işlemleri devre dışı bırakıldı.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setUnlockError('');
              const enteredRaw = String(unlockInput || '').trim();
              const enteredDigits = enteredRaw.replace(/\D/g, '');
              const valid = [user?.registerPin, user?.registerNo, user?.sicil]
                .map((x) => String(x || '').trim())
                .filter(Boolean);

              const isValid = valid.some((value) => {
                const normalizedValue = String(value).trim();
                const normalizedDigits = normalizedValue.replace(/\D/g, '');
                return normalizedValue === enteredRaw || (enteredDigits && normalizedDigits === enteredDigits);
              });

              if (isValid) {
                setLocked(false);
                setUnlockInput('');
                setUnlockError('');
                setTimeout(() => barcodeRef.current?.focus(), 80);
              } else {
                setUnlockError('Geçersiz sicil numarası!');
                setUnlockInput('');
                setTimeout(() => unlockInputRef.current?.focus(), 80);
              }
            }}
            className="pos-locked-form"
            autoComplete="off"
          >
            <label className="pos-locked-label">Sicil Numarası ile Aç</label>
            <input
              ref={unlockInputRef}
              className="pos-locked-input"
              type="text"
              placeholder="Sicil numarası"
              value={unlockInput}
              onChange={(e) => setUnlockInput(e.target.value)}
              autoFocus
            />
            {unlockError && <div className="pos-locked-error">{unlockError}</div>}
            <button className="pos-locked-unlock-btn" type="submit">Kilit Aç</button>
          </form>
        </div>
      </div>
    );
  }

  /*  Main POS Render  */
  return (
    <div className={`pos-screen ${returnMode ? 'pos-return-theme' : ''}`}>
      {toast && (
        <div className={`pos-toast pos-toast-${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* ? TOP BAR  */}
      <header className="pos-topbar">
        <div className="pos-topbar-left">
          <div className="pos-logo-mark"><ShoppingCart size={20} /></div>
          <div className="pos-topbar-title">
            <h1>{returnMode ? 'İade Modu' : 'Kasa'}</h1>
            {returnMode && <span className="pos-return-badge">İADE</span>}
          </div>
        </div>

        <div className="pos-topbar-center">
          <div className="pos-barcode-wrap">
            <ScanBarcode size={20} />
            <input ref={barcodeRef} className="pos-barcode-input" type="text"
              placeholder="Barkod okutun veya ürün adı yazın..." value={barcode}
              onChange={(e) => setBarcode(e.target.value)} onKeyDown={handleBarcodeKeyDown}
              disabled={scanning} autoComplete="off" />
            {barcode && (
              <button className="pos-search-clear" type="button" onClick={() => { setBarcode(''); setSearchResults([]); setShowSearch(false); }}>
                <XCircle size={16} />
              </button>
            )}
            <button className="pos-barcode-btn" type="button" onClick={handleBarcodeScan} disabled={scanning || !barcode.trim()}>Ekle</button>
            <button
              className="pos-barcode-btn"
              type="button"
              onClick={startCameraScanner}
              disabled={scanning}
              title={cameraScanning ? 'Kamerayı kapat' : 'Kamera ile barkod tara'}
            >
              {cameraScanning ? <CameraOff size={15} /> : <Camera size={15} />}
            </button>
            {showSearch && searchQuery.trim().length >= 2 && (
              <div className="pos-search-dropdown">
                {searching ? <div className="pos-search-loading">Aranıyor...</div>
                  : searchResults.length === 0 ? <div className="pos-search-empty">Sonuç bulunamadı</div>
                  : searchResults.map((p, idx) => (
                    <button key={p._renderKey || `${resolveProductId(p, idx)}-${idx}`} className="pos-search-item" type="button" onClick={() => handleSearchSelect(p)}>
                      <div className="pos-search-item-info"><strong>{formatUnit(p.name)}</strong><small>{p.barcode} | {p.sku}</small></div>
                      <div className="pos-search-item-price">{formatPrice(resolvePosUnitPrice(p))}</div>
                    </button>
                  ))}
              </div>
            )}
          </div>
          {cameraScanning ? (
            <div className="pos-camera-reader">
              <div id="pos-barcode-camera-reader" />
            </div>
          ) : null}
          {cameraError ? (
            <div className="pos-camera-error">
              <span>{cameraError}</span>
              <button type="button" className="ghost-button" onClick={startCameraScanner} disabled={cameraScanning}>
                Tekrar Dene
              </button>
            </div>
          ) : null}
        </div>
        <div className="pos-topbar-right">
          <div className="pos-topbar-shortcuts">
            <button
              className={`pos-topbar-shortcut ${showCategoryBrowser ? 'is-active' : ''}`}
              type="button"
              onClick={() => setShowCategoryBrowser((current) => !current)}
            >
              <LayoutGrid size={15} /> {showCategoryBrowser ? 'Kategori Penceresini Kapat' : 'Kategoriler'}
            </button>
            <button
              className="pos-topbar-shortcut pos-topbar-shortcut-price"
              type="button"
              onClick={() => {
                setPriceBarcode(barcode.trim());
                setPriceResult(null);
                setPriceModal(true);
              }}
            >
              <ScanBarcode size={15} /> Fiyat Görüntüle
            </button>
            <button
              className={`pos-topbar-shortcut pos-topbar-shortcut-mode ${returnMode ? 'is-active' : ''}`}
              type="button"
              onClick={() => { setReturnMode(!returnMode); clearCart(); }}
            >
              <RotateCcw size={15} /> {returnMode ? 'Satış Modu' : 'İade Modu'}
            </button>
            <button className="pos-topbar-shortcut" type="button" onClick={loadTodaySales}>
              <Receipt size={15} /> Geçmiş
            </button>
            <button
              className="pos-topbar-shortcut pos-topbar-lock-btn"
              type="button"
              onClick={() => setLocked(true)}
              title="Kasa Kilitle"
              disabled={locked}
            >
              <LockIcon size={18} /> Kilitle
            </button>
          </div>
          <div className="pos-topbar-meta-grid">
            <div className="pos-topbar-meta-item is-desk">
              <small>Aktif Kasa</small>
              <strong>{deskLabel}</strong>
            </div>
            <div className="pos-topbar-meta-item is-cashier">
              <small>Kasiyer</small>
              <strong>{user?.name || '-'}</strong>
            </div>
            <div className="pos-topbar-meta-item is-session">
              <small>Oturum Başlangıcı</small>
              <strong>{formatTime(sessionStartedAt)}</strong>
            </div>
            <div className="pos-topbar-meta-item is-customer">
              <small>Müşteri</small>
              <strong>{customer?.name || 'Genel Satış'}</strong>
            </div>
          </div>
          <button className="pos-exit-btn" type="button" onClick={handleExitRequest} title="Kasa Modundan Çık">
            <DoorOpen size={18} /><span>Çık</span>
          </button>
        </div>
      </header>

      {showSearch && <div className="pos-search-overlay" onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearch(false); }} />}

      {priceModal && (
        <div className="pos-modal-backdrop" onClick={handleClosePriceModal}>
          <div className="pos-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pos-modal-header">
              <div className="pos-modal-header-main">
                <span className="pos-modal-header-icon" aria-hidden="true"><Tag size={18} /></span>
                <div className="pos-modal-header-copy">
                  <h2>Fiyat Görüntüle</h2>
                  <p>Barkod ile ürün fiyatını hızlıca sorgulayın.</p>
                </div>
              </div>
              <button className="pos-modal-close" type="button" onClick={handleClosePriceModal}><X size={20} /></button>
            </div>
            {priceResult ? (
              <div className="pos-price-result-view">
                <div className="pos-price-result-card">
                  <strong>{priceResult.name}</strong>
                  <span>Barkod: {priceResult.barcode}</span>
                  <div className="pos-price-result-amount">{formatPrice(priceResult.price)}</div>
                </div>
                <div className="pos-modal-actions pos-price-result-actions">
                  <button className="pos-btn pos-btn-secondary" type="button" onClick={handleClosePriceModal}>Geri Dön</button>
                  <button className="pos-modal-confirm-btn" type="button" onClick={handleLookupAnotherPrice}>Yeni Fiyat Görüntüle</button>
                </div>
              </div>
            ) : (
              <>
                <label className="field-group" style={{ marginTop: 6 }}>
                  <span>Barkod</span>
                  <div className="pos-price-input-wrap">
                    <ScanBarcode size={16} />
                    <input
                      className="pos-cash-input pos-price-modal-input"
                      type="text"
                      placeholder="Barkod girin"
                      value={priceBarcode}
                      onChange={(e) => setPriceBarcode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handlePriceCheck();
                        }
                      }}
                      autoFocus
                    />
                  </div>
                </label>
                <div className="pos-modal-actions">
                  <button className="pos-btn pos-btn-secondary" type="button" onClick={handleClosePriceModal}>Vazgeç</button>
                  <button className="pos-modal-confirm-btn" type="button" onClick={handlePriceCheck} disabled={priceChecking || !priceBarcode.trim()}>
                    {priceChecking ? 'Sorgulanıyor...' : 'Fiyatı Göster'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showCategoryBrowser && (
        <div className="pos-modal-backdrop" onClick={() => setShowCategoryBrowser(false)}>
          <div className="pos-modal pos-category-browser-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pos-modal-header">
              <h2><LayoutGrid size={18} /> Kategoriler</h2>
              <div className="pos-category-browser-head-actions">
                <button className="pos-modal-close" type="button" onClick={() => setShowCategoryBrowser(false)}><X size={20} /></button>
              </div>
            </div>

            <div className="pos-category-browser-layout">
              <div className="pos-category-browser-sidebar" role="tablist" aria-label="Kategoriler">
                {categories.map((category) => (
                  <button
                    key={category._renderKey}
                    type="button"
                    className={`pos-category-side-btn${selectedCategoryId === category._safeId ? ' active' : ''}`}
                    onClick={() => {
                      if (category._safeId) {
                        setSelectedCategoryId(category._safeId);
                      }
                    }}
                  >
                    <span>{category.name}</span>
                    <small>{category.productCount || 0}</small>
                  </button>
                ))}
              </div>

              <div className="pos-category-browser-products">
                <div className="pos-category-search-row">
                  <Search size={16} />
                  <input
                    type="text"
                    className="pos-category-search-input"
                    placeholder="Kategori içi ürün ara (ad, barkod, SKU)"
                    value={categorySearchQuery}
                    onChange={(e) => setCategorySearchQuery(e.target.value)}
                    autoComplete="off"
                  />
                  {categorySearchQuery && (
                    <button
                      type="button"
                      className="pos-category-search-clear"
                      onClick={() => setCategorySearchQuery('')}
                      aria-label="Aramayı temizle"
                    >
                      <XCircle size={16} />
                    </button>
                  )}
                </div>
                <div className="pos-product-grid pos-category-browser-grid">
                  {categoryLoading ? (
                    <div className="pos-grid-placeholder">
                      <Loader2 size={28} className="pos-spinner" />
                      <p>Ürünler yükleniyor...</p>
                    </div>
                  ) : filteredCategoryProducts.length === 0 ? (
                    <div className="pos-grid-placeholder">
                      <LayoutGrid size={28} />
                      <p>{categoryProducts.length === 0 ? 'Bu kategoride ürün bulunamadı' : 'Aramaya uygun ürün bulunamadı'}</p>
                      <small>{categoryProducts.length === 0 ? 'Farklı bir kategori seçin' : 'Arama ifadesini değiştirin'}</small>
                    </div>
                  ) : visibleCategoryProducts.map((product, idx) => (
                    <button
                      key={product._renderKey || `${resolveProductId(product, idx)}-${idx}`}
                      className="pos-product-card"
                      type="button"
                      onClick={() => handleSearchSelect(product)}
                    >
                      <span className="pos-product-name">{formatUnit(product.name)}</span>
                      <span className="pos-product-price">{formatPrice(resolvePosUnitPrice(product))}</span>
                      <span className={`pos-product-stock ${(product.currentStock || 0) <= 0 ? 'out' : (product.currentStock || 0) <= 5 ? 'low' : ''}`}>
                        Stok: {product.currentStock || 0}
                      </span>
                    </button>
                  ))}
                  {!categoryLoading && visibleCategoryProducts.length < filteredCategoryProducts.length ? (
                    <button
                      type="button"
                      className="pos-category-load-more"
                      onClick={() => setCategoryRenderLimit((current) => current + CATEGORY_PAGE_SIZE)}
                    >
                      Daha Fazla Ürün Yükle
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ? BODY - 3 Column  */}
      <div className="pos-body pos-body-2col">

        {/* DDLE: Product Grid + Cart  */}
        <div className="pos-cart-panel">
          <div className="pos-cart-header">
            <h2><ShoppingCart size={18} /> Sepet {cart.length > 0 && <span className="pos-cart-badge">{totalItems}</span>}</h2>
            {cart.length > 0 && <button className="pos-clear-all-btn" type="button" onClick={clearCart}><Eraser size={15} /> Temizle</button>}
          </div>

          {cart.length === 0 ? (
            <div className="pos-empty-state">
              <ScanBarcode size={56} strokeWidth={1} />
              <p className="pos-empty-title">Barkod okutun veya ürün arayın</p>
              <p className="pos-empty-sub">Ürünler otomatik olarak sepete eklenir</p>
            </div>
          ) : (
            <>
              <div className="pos-cart-table-head">
                <span className="pos-th-name">Ürün</span>
                <span className="pos-th-qty">Adet</span>
                <span className="pos-th-unit">B.Fiyat</span>
                <span className="pos-th-kdv">KDV</span>
                <span className="pos-th-total">Toplam</span>
                <span className="pos-th-action"></span>
              </div>
              <div className="pos-cart-list">
                {cart.map((item, idx) => (
                  <div key={item.productId || `${item.barcode || item.sku || 'cart-item'}-${idx}`} className={`pos-cart-row ${selectedId === item.productId ? 'pos-row-selected' : ''}`} onClick={() => setSelectedId(item.productId)}>
                    <div className="pos-cart-info"><strong>{formatUnit(item.name)}</strong><small>{item.barcode} · KDV: %{Number.isFinite(Number(item.vatRate)) ? Number(item.vatRate) : 20}</small></div>
                    <div className="pos-cart-qty">
                      <button className="pos-qty-btn" type="button" onClick={(e) => { e.stopPropagation(); updateQuantity(item.productId, -1); }}><Minus size={15} /></button>
                      <span className="pos-qty-value">{item.quantity}</span>
                      <button className="pos-qty-btn" type="button" onClick={(e) => { e.stopPropagation(); updateQuantity(item.productId, 1); }}><Plus size={15} /></button>
                    </div>
                    <div className="pos-cart-unit-price">{formatPrice(item.unitPrice)}</div>
                    <div className="pos-cart-vat-price">{formatPrice((item.unitPrice * item.quantity) - ((item.unitPrice * item.quantity) / (1 + ((Number.isFinite(Number(item.vatRate)) ? Number(item.vatRate) : 20) / 100))))}</div>
                    <div className="pos-cart-line-total">{formatPrice(item.unitPrice * item.quantity)}</div>
                    <button className="pos-remove-btn" type="button" onClick={(e) => { e.stopPropagation(); removeItem(item.productId); }}><Trash2 size={15} /></button>
                  </div>
                ))}
                <div ref={cartEndRef} />
              </div>
            </>
          )}

          <div className="pos-quick-actions">
            <button className="pos-action-btn pos-action-bag" type="button" onClick={addBagToCart} disabled={returnMode || cart.length === 0}><BagLineIcon size={20} /> Poşet Ekle</button>
            <button className="pos-action-btn pos-action-plus" type="button" onClick={() => quickAdjustSelected(1)} disabled={cart.length === 0 || !selectedId}><Plus size={20} /> Adet Artır</button>
            <button className="pos-action-btn pos-action-minus" type="button" onClick={() => quickAdjustSelected(-1)} disabled={cart.length === 0 || !selectedId}><Minus size={20} /> Adet Azalt</button>
            <button className="pos-action-btn pos-action-remove" type="button" onClick={quickRemoveSelected} disabled={cart.length === 0 || !selectedId}><Trash2 size={20} /> Satırı Sil</button>
            <button className="pos-action-btn pos-action-clear" type="button" onClick={clearCart} disabled={cart.length === 0}><Eraser size={20} /> Sepeti Temizle</button>
          </div>
        </div>

        {/* GHT: Payment & Customer  */}
        <div className="pos-payment-panel">
          <div className="pos-totals">
            <div className="pos-order-summary">
              <span>Toplam Çeşit Ürün: <strong>{cart.length}</strong></span>
              <span>Toplam Adet Ürün: <strong>{totalItems}</strong></span>
            </div>
            <div className="pos-total-row"><span>Ara Toplam</span><span>{formatPrice(subtotal)}</span></div>
            <div className="pos-total-row"><span>KDV</span><span>{formatPrice(vatAmount)}</span></div>
            <div className="pos-total-row pos-grand-total"><span>TOPLAM</span><strong>{formatPrice(grandTotal)}</strong></div>
          </div>

          {lastSale && (
            <div className={`pos-last-sale ${lastSale.type === 'return' ? 'pos-last-return' : ''}`}>
              <Receipt size={16} />
              <div><strong>{lastSale.referenceNo}</strong><small>{lastSale.type === 'return' ? 'İade' : 'Satış'} · {formatPrice(lastSale.totalAmount)}</small></div>
            </div>
          )}

          <div className="pos-main-actions">
            <button
              type="button"
              className="pos-discount-trigger pos-discount-trigger-full"
              onClick={() => (isDiscountEditorOpen ? setIsDiscountEditorOpen(false) : openDiscountEditor())}
            >
              {isDiscountEditorOpen ? 'İndirim Alanını Kapat' : `İndirim Uygula (%${appliedDiscountRate.toFixed(0)})`}
            </button>

            {isDiscountEditorOpen ? (
              <div className="pos-discount-drawer">
                <div className="pos-discount-controls">
                  {[5, 10, 15, 20].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      className={`pos-discount-chip ${Number(discountDraft) === rate ? 'active' : ''}`}
                      onClick={() => setDiscountDraft(String(rate))}
                    >
                      %{rate}
                    </button>
                  ))}
                  <div className="pos-discount-input-wrap"><span>%</span>
                    <input className="pos-discount-input" type="number" min="0" max="100" step="1" value={discountDraft} onChange={(e) => setDiscountDraft(e.target.value)} />
                  </div>
                  <button type="button" className="pos-discount-action" onClick={applyDiscountRate}>Uygula</button>
                  <button type="button" className="pos-discount-action clear" onClick={clearDiscountRate} disabled={appliedDiscountRate <= 0}>İndirimi Temizle</button>
                  <button type="button" className="pos-discount-action ghost" onClick={() => setIsDiscountEditorOpen(false)}>Vazgeç</button>
                </div>
                <div className="pos-total-row"><span>İndirim</span><span>%{appliedDiscountRate.toFixed(0)}</span></div>
                <div className="pos-total-row pos-discount-applied-row"><span>İndirim Tutarı</span><span>-{formatPrice(discountAmount)}</span></div>
              </div>
            ) : null}

            {!returnMode ? (
              <button className="pos-complete-btn" type="button" onClick={openPayment} disabled={cart.length === 0}>
                <CheckCircle2 size={24} /><span>Satışı Tamamla</span>
                {grandTotal > 0 && <strong>{formatPrice(grandTotal)}</strong>}
              </button>
            ) : (
              <>
                <button className="pos-complete-btn pos-complete-return" type="button" onClick={openReturnModal} disabled={processing}>
                  <RotateCcw size={24} /><span>{processing ? 'İşleniyor...' : 'İade Başlat'}</span>
                  {grandTotal > 0 && <strong>{formatPrice(grandTotal)}</strong>}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ? PAYMENT MODAL - 5 Types + Split  */}
      {paymentModal && (
        <div className="pos-modal-backdrop" onClick={() => setPaymentModal(false)}>
          <div className="pos-modal pos-payment-modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="pos-modal-header">
              <div className="pos-modal-header-main">
                <span className="pos-modal-header-icon" aria-hidden="true"><CreditCard size={18} /></span>
                <div className="pos-modal-header-copy">
                  <h2>Ödeme</h2>
                  <p>Ödeme yöntemini seçin ve tahsilatı tamamlayın.</p>
                </div>
              </div>
              <button className="pos-modal-close" type="button" onClick={() => setPaymentModal(false)}><X size={20} /></button>
            </div>

            <div className="pos-modal-total"><span><Banknote size={18} /> Ödenecek Tutar</span><strong>{formatPrice(grandTotal)}</strong></div>

            {/* Mode toggle */}
            <div className="pos-pay-mode-toggle">
              <button className={`pos-pay-mode-btn ${!splitMode ? 'active' : ''}`} type="button" onClick={() => { setSplitMode(false); setPayments([]); }}>
                <CreditCard size={16} /> Tek Ödeme
              </button>
              <button className={`pos-pay-mode-btn ${splitMode ? 'active' : ''}`} type="button" onClick={() => setSplitMode(true)}>
                <Split size={16} /> Parçalı Ödeme
              </button>
            </div>

            {!splitMode ? (
              <>
                {/* Single payment - 5 methods */}
                <div className="pos-modal-methods-grid">
                  {PAYMENT_METHODS.map((m) => {
                    const Icon = m.icon;
                    return (
                      <button key={m.key} className={`pos-payment-btn ${singleMethod === m.key ? 'active' : ''}`}
                        type="button" onClick={() => setSingleMethod(m.key)} style={singleMethod === m.key ? { borderColor: m.color, color: m.color } : {}}>
                        <Icon size={34} /><span>{m.label}</span>
                      </button>
                    );
                  })}
                </div>
                {singleMethod === 'cash' && (
                  <div className="pos-cash-section">
                    <label className="pos-cash-label"><span className="pos-cash-label-title"><Banknote size={16} /> Alınan Tutar</span>
                      <input className="pos-cash-input pos-cash-input-modal" type="number" min="0" step="0.01" value={receivedAmount} onChange={(e) => setReceivedAmount(e.target.value)} autoFocus />
                    </label>
                    <div className="pos-quick-amounts">
                      {[grandTotal, Math.ceil(grandTotal / 10) * 10, Math.ceil(grandTotal / 50) * 50, Math.ceil(grandTotal / 100) * 100, 200, 500]
                        .filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 6)
                        .map((amount) => (<button key={amount} className="pos-quick-btn" type="button" onClick={() => setReceivedAmount(String(amount))}>{formatPrice(amount)}</button>))}
                    </div>
                    {received >= grandTotal && <div className="pos-change-display">Para Üstü: <strong>{formatPrice(change)}</strong></div>}
                  </div>
                )}
                {singleMethod === 'qr' && (
                  <div className="pos-qr-section">
                    <div className="pos-qr-frame">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=6&data=${encodeURIComponent(`SHELFIO|REF:${qrPaymentRef || 'SAT-QR'}|TUTAR:${grandTotal.toFixed(2)}|PB:TRY`)}`}
                        alt="QR ödeme kodu"
                        loading="lazy"
                      />
                    </div>
                    <div className="pos-qr-meta">
                      <strong>QR ile Ödeme</strong>
                      <span>Referans: {qrPaymentRef || 'SAT-QR'}</span>
                      <span>Tutar: {formatPrice(grandTotal)}</span>
                      <small>Müşteri mobil bankacılık veya cüzdan uygulamasıyla QR kodu okutarak ödeme yapabilir.</small>
                    </div>
                  </div>
                )}
                {singleMethod === 'eft' && (
                  <div className="pos-eft-section">
                    <div className="pos-eft-title"><Building2 size={16} /> Havale/EFT Bilgileri</div>
                    <div className="pos-eft-row"><span>Banka</span><strong>{eftPaymentInfo.bankName}</strong></div>
                    <div className="pos-eft-row"><span>Alıcı Adı</span><strong>{eftPaymentInfo.accountName}</strong></div>
                    <div className="pos-eft-row"><span>IBAN</span><strong className="pos-eft-iban">{eftPaymentInfo.iban}</strong></div>
                  </div>
                )}
                {singleMethod === 'giftcard' && (
                  <div className="pos-giftcard-section">
                    <div className="pos-giftcard-title"><Gift size={16} /> Hediye Kartı</div>
                    <div className="pos-giftcard-input-row">
                      <input
                        className="pos-giftcard-input"
                        type="text"
                        value={giftCardCode}
                        onChange={(event) => setGiftCardCode(event.target.value.toUpperCase())}
                        placeholder="Kart kodunu girin"
                      />
                      <button type="button" className="pos-giftcard-apply" onClick={applyGiftCard}>Kodu Ekle</button>
                    </div>
                    {appliedGiftCard ? (
                      <div className="pos-giftcard-summary">
                        <span>{appliedGiftCard.name} ({appliedGiftCard.code})</span>
                        <strong>Düşülen: {formatPrice(appliedGiftCard.deductedAmount)}</strong>
                        {appliedGiftCard.remainingTotal > 0.01 ? <small>Kalan: {formatPrice(appliedGiftCard.remainingTotal)}</small> : null}
                        <button type="button" onClick={clearGiftCard}>Kodu Temizle</button>
                      </div>
                    ) : (
                      <div className="pos-giftcard-hint">Kod eklendikten sonra tutar düşülür. Kalan varsa diğer ödeme yöntemini seçebilirsiniz.</div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Split payment */}
                <div className="pos-split-section">
                  {appliedGiftCard ? (
                    <div className="pos-split-giftcard-note">
                      <Gift size={15} /> {appliedGiftCard.code} kartından {formatPrice(appliedGiftCard.deductedAmount)} düşüldü. Kalan için ödeme yöntemi ekleyin.
                    </div>
                  ) : null}
                  <div className="pos-split-methods">
                    {PAYMENT_METHODS.map((m) => {
                      const Icon = m.icon;
                      return (
                        <button key={m.key} className="pos-split-add-btn" type="button" onClick={() => addSplitPayment(m.key)}>
                          <Icon size={18} /> {m.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="pos-split-list">
                    {payments.length === 0 ? (
                      <div className="pos-split-empty">Ödeme yöntemi eklemek için yukarıdaki butonlara tıklayın</div>
                    ) : payments.map((p, idx) => {
                      const mInfo = PAYMENT_METHODS.find((m) => m.key === p.method);
                      const Icon = mInfo?.icon || Banknote;
                      return (
                        <div key={`${p.method || 'payment'}-${idx}`} className="pos-split-row">
                          <div className="pos-split-row-label"><Icon size={18} /> {mInfo?.label}</div>
                          <input className="pos-split-amount-input" type="number" min="0" step="0.01" placeholder="0.00"
                            value={p.amount} onChange={(e) => updateSplitAmount(idx, e.target.value)} />
                          <button className="pos-split-remove" type="button" onClick={() => removeSplitPayment(idx)}><X size={16} /></button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="pos-split-summary">
                    <div className="pos-split-sum-row"><span>Ödenen:</span><strong>{formatPrice(paymentsTotal)}</strong></div>
                    <div className="pos-split-sum-row"><span>Kalan:</span><strong className={remaining > 0.01 ? 'text-red' : 'text-green'}>{formatPrice(remaining)}</strong></div>
                  </div>
                </div>
              </>
            )}

            <div className="pos-modal-actions">
              <button className="pos-btn pos-btn-ghost" type="button" onClick={() => setPaymentModal(false)}>İptal</button>
              <button className="pos-modal-confirm-btn" type="button" onClick={handleCompleteSale}
                disabled={processing || (!splitMode && singleMethod === 'cash' && received < grandTotal) || (splitMode && paymentsTotal < grandTotal - 0.01)}>
                <CheckCircle2 size={20} /> {processing ? 'İşleniyor...' : 'Satışı Tamamla'}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="pos-screen-footer">{APP_FOOTER_TEXT}</footer>

      {/* ? RETURN MODAL - Receipt Search  */}
      {returnModal && (
        <div className="pos-modal-backdrop" onClick={() => setReturnModal(false)}>
          <div className="pos-modal pos-return-modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="pos-modal-header">
              <h2><RotateCcw size={20} /> Fiş ile İade</h2>
              <button className="pos-modal-close" type="button" onClick={() => setReturnModal(false)}><X size={20} /></button>
            </div>

            {/* Search by reference */}
            <div className="pos-return-search">
              <div className="pos-return-search-row">
                <Hash size={18} />
                <input className="pos-return-search-input" type="text" placeholder="Fiş numarası girin (örn: SAT-20260311-123)"
                  value={returnSearchRef} onChange={(e) => setReturnSearchRef(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') searchOriginalSale(); }} />
                <button className="pos-btn pos-btn-primary" type="button" onClick={searchOriginalSale} disabled={returnSearching}>
                  {returnSearching ? <Loader2 size={16} className="pos-spinner" /> : <Search size={16} />} Ara
                </button>
              </div>
              <button className="pos-return-picker-toggle" type="button" onClick={openReturnSalePicker}>
                Geçmiş Satışlardan Fiş Seç
              </button>

              {returnSalePickerOpen ? (
                <div className="pos-return-picker-panel">
                  <div className="pos-return-picker-head">
                    <input
                      type="text"
                      className="pos-return-picker-input"
                      placeholder="Fiş no veya kasiyer ara"
                      value={returnSalePickerQuery}
                      onChange={(event) => setReturnSalePickerQuery(event.target.value)}
                    />
                    <button type="button" className="pos-return-picker-close" onClick={() => setReturnSalePickerOpen(false)}>Kapat</button>
                  </div>

                  <div className="pos-return-picker-list">
                    {returnSalePickerLoading ? (
                      <div className="pos-return-picker-empty"><Loader2 size={15} className="pos-spinner" /> Geçmiş satışlar yükleniyor...</div>
                    ) : filteredReturnSalePickerItems.length === 0 ? (
                      <div className="pos-return-picker-empty">Filtreye uygun satış bulunamadı.</div>
                    ) : filteredReturnSalePickerItems.slice(0, 80).map((sale) => (
                      <button type="button" key={sale._renderKey} className="pos-return-picker-row" onClick={() => { void selectReturnSaleFromPicker(sale); }}>
                        <strong>{sale.referenceNo}</strong>
                        <span>{formatDate(sale.createdAt)} {formatTime(sale.createdAt)}</span>
                        <span>{formatPrice(sale.totalAmount)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="pos-return-customer-grid">
              <div className="pos-return-option-group">
                <label>Ad Soyad</label>
                <input
                  className="pos-return-text-input"
                  type="text"
                  placeholder="Müşteri ad soyad"
                  value={returnCustomerName}
                  onChange={(e) => setReturnCustomerName(e.target.value)}
                />
              </div>
              <div className="pos-return-option-group">
                <label>Adres</label>
                <input
                  className="pos-return-text-input"
                  type="text"
                  placeholder="Müşteri adresi"
                  value={returnCustomerAddress}
                  onChange={(e) => setReturnCustomerAddress(e.target.value)}
                />
              </div>
            </div>

            {originalSale && (
              <>
                <div className="pos-return-sale-info">
                  <span><strong>{originalSale.referenceNo}</strong></span>
                  <span>{formatDate(originalSale.createdAt)} {formatTime(originalSale.createdAt)}</span>
                  <span>Toplam: {formatPrice(originalSale.totalAmount)}</span>
                </div>

                <div className="pos-return-sale-info pos-return-sale-info-muted">
                  <span><strong>İade Fiş No (Önizleme):</strong> {returnReferencePreview || '-'}</span>
                  <span><strong>Orijinal Ödeme:</strong> {originalRefundMethodLabel}</span>
                </div>

                {/* Item selection */}
                <div className="pos-return-items">
                  <div className="pos-return-items-head">
                    <span>Seç</span><span>Ürün</span><span>Adet</span><span>İade Adet</span><span>Kalan</span><span>Tutar</span>
                  </div>
                  {returnItems.map((item, idx) => (
                    <div key={item.productId || item.barcode || `${item.name || 'return-item'}-${idx}`} className={`pos-return-item-row ${item.selected ? 'selected' : ''}`}>
                      <input type="checkbox" checked={item.selected} onChange={() => toggleReturnItem(idx)} disabled={!partialReturnEnabled} />
                      <span className="pos-return-item-name">{item.name}</span>
                      <span>{item.quantity}</span>
                      <div className="pos-return-qty-ctrl">
                        <button type="button" onClick={() => updateReturnQty(idx, item.returnQty - 1)} disabled={!item.selected || !partialReturnEnabled}><Minus size={14} /></button>
                        <span>{item.returnQty}</span>
                        <button type="button" onClick={() => updateReturnQty(idx, item.returnQty + 1)} disabled={!item.selected || !partialReturnEnabled}><Plus size={14} /></button>
                      </div>
                      <span>Kalan: {Number(item.maxReturnQty || item.quantity || 0)}</span>
                      <span>{formatPrice(item.unitPrice * item.returnQty)}</span>
                    </div>
                  ))}
                </div>

                {/* Reason & refund method */}
                <div className="pos-return-options">
                  <div className="pos-return-option-group">
                    <label>İade Nedeni</label>
                    <select value={returnReason} onChange={(e) => setReturnReason(e.target.value)}>
                      {RETURN_REASONS.map((r) => <option key={r.key} value={r.key}>{formatReturnReasonLabel(r.key, r.label)}</option>)}
                    </select>
                    {returnReason === 'other' && (
                      <textarea
                        className="pos-return-textarea"
                        placeholder="Diğer neden için kısa açıklama yazın"
                        value={returnReasonDetail}
                        onChange={(e) => setReturnReasonDetail(e.target.value)}
                        rows={3}
                      />
                    )}
                  </div>
                  <div className="pos-return-option-group">
                    <label>İade Türü</label>
                    <select value={returnType} onChange={(e) => setReturnType(e.target.value)}>
                      {RETURN_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="pos-return-options">
                  <div className="pos-return-option-group">
                    <label>Orijinal ödeme yöntemi (otomatik)</label>
                    <input className="pos-return-text-input" type="text" value={originalRefundMethodLabel} readOnly />
                  </div>
                  <div className="pos-return-option-group">
                    <label>İade Ödeme Yöntemi</label>
                    <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} disabled={returnType !== 'original'}>
                      {PAYMENT_METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </div>
                </div>

                <label className="pos-return-partial-toggle">
                  <input type="checkbox" checked={partialReturnEnabled} onChange={(e) => setPartialReturnEnabled(e.target.checked)} />
                  <span>Kısmi iade seçeneği (ürün bazlı iade)</span>
                </label>

                <div className="pos-return-option-group">
                  <label>İade edilecek tutar (düzenlenebilir)</label>
                  <input
                    className="pos-return-text-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={returnAmountDraft}
                    onChange={(e) => setReturnAmountDraft(e.target.value)}
                  />
                </div>

                <div className="pos-return-total">
                  <span>İade Toplam:</span><strong>{formatPrice(Number(returnAmountDraft) || 0)}</strong>
                </div>
              </>
            )}

            <div className="pos-modal-actions">
              <button className="pos-btn pos-btn-ghost" type="button" onClick={() => setReturnModal(false)}>İptal</button>
              <button className="pos-modal-confirm-btn pos-return-confirm" type="button" onClick={handleProcessReturn}
                disabled={processing || !originalSale || returnItems.filter((i) => i.selected && i.returnQty > 0).length === 0}>
                <RotateCcw size={18} /> {processing ? 'İşleniyor...' : 'İadeyi Tamamla'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* T MODAL  */}
      {exitModal && (
        <div className="pos-modal-backdrop" onClick={() => setExitModal(false)}>
          <div className="pos-modal pos-exit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pos-exit-icon"><AlertTriangle size={36} /></div>
            <h2>Kasa Modundan Çık</h2>
            <p>Kasa ekranından çıkmak istiyor musunuz?</p>
            {cart.length > 0 && <p className="pos-exit-warn">Sepetteki {cart.length} ürün silinecektir.</p>}
            <div className="pos-modal-actions">
              <button className="pos-btn pos-btn-ghost" type="button" onClick={() => setExitModal(false)}>İptal</button>
              <button className="pos-exit-confirm-btn" type="button" onClick={handleExitConfirm}><DoorOpen size={18} /> Çık</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
