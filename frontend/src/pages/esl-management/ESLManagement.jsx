import { useCallback, useEffect, useRef, useState } from 'react';
import './ESLManagement.css';
import { useLocation } from 'react-router-dom';
import {
  Monitor,
  Send,
  Wifi,
  WifiOff,
  Battery,
  RefreshCw,
  Search,
  Tag,
  History,
  Cpu,
  CheckCircle2,
  Package,
  Eye,
  Trash2,
  XCircle,
  QrCode,
  ScanLine,
  Link2,
  AlertCircle,
  LayoutTemplate,
  Megaphone,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader.jsx';
import Toast from '../../components/Toast.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import ESLPreview from '../../components/ESLPreview.jsx';
import ScanInput from '../../components/ScanInput.jsx';
import { eslService } from '../../services/eslService.js';
import { productService } from '../../services/productService.js';
import { barcodeLookupService } from '../../services/barcodeLookupService.js';
import { formatUnit, normalizeSearchText } from '../../services/formatters.js';

const TEMPLATES = [
  {
    id: 'standard',
    label: 'Standart (2.9")',
    desc: 'Ürün adı, barkod, fiyat, menşei',
    selectedNote: 'Standart şablon için seçim yapıldı',
  },
  {
    id: 'campaign',
    label: 'Fırsat',
    desc: 'Büyük fiyat vurgusu, fırsat bandı',
    selectedNote: 'Fırsat şablonu için seçim yapıldı',
  },
  {
    id: 'discount',
    label: 'İndirim',
    desc: 'Üstü çizili eski fiyat ve indirimli fiyat vurgusu',
    selectedNote: 'İndirim şablonu için seçim yapıldı',
  },
];

const SEND_TIMEOUT_MS = 15000;
const REFRESH_TIMEOUT_MS = 10000;
const HISTORY_PAGE_SIZE = 10;

const withTimeout = (promise, ms, message) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    window.clearTimeout(timeoutId);
  });
};

const formatDate = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const UNASSIGNED_LABEL_LOCATION = 'Ürün atanmamış';

const hasAssignedProduct = (device) => Boolean(device?.assignedProductId && device?.product);

const getLabelLocationDisplay = (device) => (
  hasAssignedProduct(device) ? (device.location || '-') : UNASSIGNED_LABEL_LOCATION
);

const resolveEslDisplayPricing = (product = {}) => {
  const regularPrice = Number(product.salePrice ?? product.regularPrice ?? product.price ?? 0) || 0;
  const campaignPrice = Number(
    product.campaignPrice
    ?? product.discountedPrice
    ?? product.activeCampaign?.price
    ?? product.activeCampaign?.campaignPrice
    ?? product.currentPrice
    ?? 0
  ) || 0;
  const hasActiveCampaign = Boolean(product.hasActiveDiscount || product.hasActiveCampaign)
    && campaignPrice > 0
    && Math.round(campaignPrice * 100) < Math.round(regularPrice * 100);
  const displayPrice = hasActiveCampaign ? campaignPrice : regularPrice;

  return {
    regularPrice,
    campaignPrice: hasActiveCampaign ? campaignPrice : null,
    displayPrice,
    hasActiveCampaign,
    priceSource: hasActiveCampaign ? 'campaign' : 'regular',
  };
};

const resolveTemplateForPricing = (template, pricing) => {
  const requestedTemplate = String(template || '').trim();
  if (pricing?.hasActiveCampaign && (!requestedTemplate || requestedTemplate === 'standard' || requestedTemplate === 'campaign')) {
    return 'discount';
  }
  return requestedTemplate || 'standard';
};

export default function ESLManagement() {
  const location = useLocation();
  const deviceSelectionRef = useRef(null);
  const isMountedRef = useRef(true);
  const [devices, setDevices] = useState([]);
  const [products, setProducts] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [refreshingDevices, setRefreshingDevices] = useState(false);
  const sendingRef = useRef(false);

  // Form state
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('standard');
  const [previewNonce, setPreviewNonce] = useState(0);
  const [productSearch, setProductSearch] = useState('');
  const [scanValue, setScanValue] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanMatch, setScanMatch] = useState(null);

  const [toast, setToast] = useState(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmClearLabelOpen, setConfirmClearLabelOpen] = useState(false);

  const showToast = (type, title, message) => {
    if (isMountedRef.current) setToast({ type, title, message });
  };

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
    setHistoryPage((current) => Math.min(current, totalPages));
  }, [history]);

  useEffect(() => {
    if (!sending) return undefined;

    const fallbackId = window.setTimeout(() => {
      sendingRef.current = false;
      setSending(false);
    }, SEND_TIMEOUT_MS + 2000);

    return () => window.clearTimeout(fallbackId);
  }, [sending]);

  const scrollToDeviceSelection = useCallback(() => {
    window.requestAnimationFrame(() => {
      try {
        deviceSelectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        // no-op
      }
    });
  }, []);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const [devicesResult, productsResult, historyResult, statsResult] = await Promise.allSettled([
        eslService.listDevices(),
        productService.list({ fetchAll: true, includeGeneralCampaigns: true }),
        eslService.listHistory(),
        eslService.getStats(),
      ]);

      const devicesData = devicesResult.status === 'fulfilled' ? devicesResult.value : [];
      const productsData = productsResult.status === 'fulfilled' ? productsResult.value : [];
      const historyData = historyResult.status === 'fulfilled' ? historyResult.value : [];
      const statsData = statsResult.status === 'fulfilled' ? statsResult.value : null;

      if (!isMountedRef.current) return;
      setDevices(Array.isArray(devicesData) ? devicesData : []);
      setProducts(Array.isArray(productsData) ? productsData : []);
      setHistory(Array.isArray(historyData) ? historyData : []);
      setStats(statsData);

      if (!silent && historyResult.status === 'rejected') {
        showToast('warning', 'Uyarı', 'ESL geçmiş kaydı geçici olarak okunamadı. Sistem güvenli modda devam ediyor.');
      }

      if (!silent && (devicesResult.status === 'rejected' || productsResult.status === 'rejected')) {
        const baseError = devicesResult.status === 'rejected' ? devicesResult.reason : productsResult.reason;
        throw baseError;
      }
    } catch (err) {
      showToast('error', 'Yükleme Hatası', err?.message || 'ESL verileri yüklenemedi.');
    } finally {
      if (!silent && isMountedRef.current) setLoading(false);
    }
  }, [scrollToDeviceSelection]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const quickAssignProductId = location.state?.quickAssignProductId;
    if (!quickAssignProductId || products.length === 0) {
      return;
    }

    const targetProduct = products.find((item) => item.id === quickAssignProductId);
    if (!targetProduct) {
      return;
    }

    setSelectedProductId(targetProduct.id);
    setProductSearch('');
    setScanMatch(null);
    setScanError('');

    if (location.state?.openDeviceSelection) {
      setToast({
        type: 'info',
        title: 'Etiket Ata',
        message: 'Ürün seçildi. Etiket atamak için cihaz seçin ve gönderin.',
      });
      scrollToDeviceSelection();
    }

    window.history.replaceState({}, '');
  }, [location.state, products, scrollToDeviceSelection]);

  const handleRefresh = useCallback(async () => {
    if (refreshingDevices) return;

    setRefreshingDevices(true);
    try {
      const [devicesData, statsData] = await withTimeout(
        Promise.all([
          eslService.listDevices(),
          eslService.getStats(),
        ]),
        REFRESH_TIMEOUT_MS,
        'Etiket durumları zaman aşımına uğradı.'
      );
      if (!isMountedRef.current) return;
      setDevices(Array.isArray(devicesData) ? devicesData : []);
      setStats(statsData);
    } catch (err) {
      showToast('error', 'Yenileme Hatası', err?.message || 'Etiket durumları yenilenemedi.');
    } finally {
      if (isMountedRef.current) setRefreshingDevices(false);
    }
  }, [refreshingDevices]);

  // Gönderim sonrası hafif yenileme - ürün listesi (5000 kayıt) değişmez, sadece cihaz/geçmiş/istatistik güncellenir
  const refreshAfterSend = useCallback(async () => {
    try {
      const [devicesData, historyData, statsData] = await Promise.all([
        eslService.listDevices(),
        eslService.listHistory(),
        eslService.getStats(),
      ]);
      if (!isMountedRef.current) return;
      setDevices(devicesData);
      setHistory(historyData);
      setStats(statsData);
    } catch (_) { /* ignore */ }
  }, []);

  const selectedProduct = products.find((p) => p.id === selectedProductId) || null;
  const selectedProductPricing = selectedProduct ? resolveEslDisplayPricing(selectedProduct) : null;
  const effectiveSelectedTemplate = selectedProductPricing
    ? resolveTemplateForPricing(selectedTemplate, selectedProductPricing)
    : selectedTemplate;
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) || null;
  const hasSelectedDevice = Boolean(selectedDevice);
  const historyTotalPages = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const historyStart = history.length ? ((historyPage - 1) * HISTORY_PAGE_SIZE) + 1 : 0;
  const historyEnd = history.length ? Math.min(historyPage * HISTORY_PAGE_SIZE, history.length) : 0;
  const pagedHistory = history.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);
  const isProductSelected = Boolean(selectedProductId);
  const isDeviceSelected = Boolean(selectedDeviceId);
  const isTemplateSelected = Boolean(effectiveSelectedTemplate);

  const tokenStartsWithQuery = (value, query) => {
    const text = normalizeSearchText(value);
    if (!text || !query) return false;
    if (query.includes(' ')) return text.includes(query);
    const tokens = text.split(/[^0-9a-zçşıöşü]+/i).filter(Boolean);
    return tokens.some((token) => token.startsWith(query));
  };

  const filteredProducts = products.filter((p) => {
    if (!productSearch.trim()) return true;
    const q = normalizeSearchText(productSearch);
    return (
      tokenStartsWithQuery(p.name, q) ||
      tokenStartsWithQuery(p.productName, q) ||
      tokenStartsWithQuery(p.brand || p.brandName, q) ||
      tokenStartsWithQuery(p.categoryName || p.mainCategoryName, q) ||
      tokenStartsWithQuery(p.supplierName || p.supplierProductName, q) ||
      tokenStartsWithQuery(p.sku, q) ||
      normalizeSearchText(p.barcode).includes(q)
    );
  });

  const handleProductSelect = (productId) => {
    setSelectedProductId((prev) => (prev === productId ? '' : productId));
    setProductSearch('');
  };

  const handleDeviceSelect = (deviceId) => {
    setSelectedDeviceId((prev) => (prev === deviceId ? '' : deviceId));
  };

  const handleTemplateSelect = (templateId) => {
    setSelectedTemplate((prev) => (prev === templateId ? '' : templateId));
  };

  const handleSendToDevice = async (templateOverride) => {
    const requestedTemplate = typeof templateOverride === 'string' && templateOverride.trim() ?
      templateOverride
      : selectedTemplate;
    const effectiveTemplate = resolveTemplateForPricing(requestedTemplate, selectedProductPricing);

    if (!selectedDeviceId || !selectedProductId || !effectiveTemplate) {
      showToast('error', 'Eksik Bilgi', 'Lütfen cihaz, ürün ve şablon seçimi yapın.');
      return;
    }

    // Ref-tabanlı kilit: çift tıklama ve yarış koşulunu önler
    if (sendingRef.current) return;
    sendingRef.current = true;

    const payload = { deviceId: selectedDeviceId, productId: selectedProductId, template: effectiveTemplate };

    setSending(true);
    let timeoutId;
    try {
      const result = await Promise.race([
        eslService.sendToDevice(payload),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('İstek zaman aşımına uşradı, lütfen tekrar deneyin.')), SEND_TIMEOUT_MS);
        }),
      ]);
      showToast('success', 'Gönderildi', result.message);
    } catch (err) {
      console.error('[ESL] Gönderim hatası:', err);
      showToast('error', 'Gönderim Hatası', err.message);
    } finally {
      clearTimeout(timeoutId);
      setSending(false);
      sendingRef.current = false;
      refreshAfterSend().catch(() => {});
    }
  };

  const handleScanSubmit = async (event) => {
    event.preventDefault();
    const token = barcodeLookupService.normalizeScanValue(scanValue);
    if (!token) return;

    setScanLoading(true);
    setScanError('');
    setScanMatch(null);

    try {
      const result = await barcodeLookupService.resolveLabelScan(token, { products, devices });
      if (result.kind === 'not-found' || result.kind === 'none') {
        setScanError('Ürün veya etiket kaydı bulunamadı');
        return;
      }

      setScanMatch(result);

      if (result.device?.id) {
        setSelectedDeviceId(result.device.id);
      }

      if (result.product?.id) {
        setSelectedProductId(result.product.id);
      }
    } catch (error) {
      setScanError(error.message || 'Tarama sonucu işlenemedi');
    } finally {
      setScanLoading(false);
    }
  };

  const clearScanResult = () => {
    setScanValue('');
    setScanMatch(null);
    setScanError('');
  };

  const handleQuickTemplateApply = async (templateId) => {
    setSelectedTemplate(resolveTemplateForPricing(templateId, selectedProductPricing));
    await handleSendToDevice(templateId);
  };

  const resolvePreviousSalePrice = (product) => {
    if (!product) return null;
    const direct = Number(product.previousSalePrice ?? product.previousPrice ?? product.oldPrice);
    if (Number.isFinite(direct) && direct > 0) return direct;

    const events = [
      ...(Array.isArray(product.priceEvents) ? product.priceEvents : []),
      ...(Array.isArray(product.priceHistory) ? product.priceHistory : []),
    ]
      .map((event) => ({
        at: event.createdAt || event.at || event.date || event.updatedAt || '',
        salePrice: Number(event.salePrice ?? event.price ?? event.currentPrice ?? event.newPrice),
        previousSalePrice: Number(event.previousSalePrice ?? event.previousPrice),
      }))
      .filter((event) => event.at || Number.isFinite(event.previousSalePrice))
      .sort((left, right) => new Date(right.at || 0).getTime() - new Date(left.at || 0).getTime());

    const explicit = events.find((event) => Number.isFinite(event.previousSalePrice) && event.previousSalePrice > 0)?.previousSalePrice;
    if (Number.isFinite(explicit) && explicit > 0) return explicit;

    const current = Number(product.salePrice ?? product.currentPrice ?? product.price);
    const previousFromHistory = events.find((event) => Number.isFinite(event.salePrice) && event.salePrice > 0 && Math.round(event.salePrice * 100) !== Math.round(current * 100))?.salePrice;
    if (Number.isFinite(previousFromHistory) && previousFromHistory > 0) return previousFromHistory;

    return Number.isFinite(current) && current > 0 ? Number((current * 1.15).toFixed(2)) : null;
  };

  const resolvedScanProduct = scanMatch?.product || null;
  const resolvedScanDevice = scanMatch?.device || (resolvedScanProduct ? devices.find((item) => item.assignedProductId === resolvedScanProduct.id) || null : null);
  const scanTemplateLabel = TEMPLATES.find((item) => item.id === (resolvedScanDevice?.template || selectedTemplate))?.label || '-';

  const handleClearHistory = async () => {
    setConfirmClearOpen(false);
    try {
      await eslService.clearHistory();
      setHistory([]);
      showToast('success', 'Temizlendi', 'Güncelleme geçmişi başarıyla silindi.');
      await loadData({ silent: true });
    } catch (err) {
      showToast('error', 'Hata', 'Geçmiş temizlenemedi: ' + err.message);
    }
  };

  const resetLabelSelection = useCallback((resultDevice = null) => {
    setSelectedProductId('');
    setSelectedTemplate('standard');
    setProductSearch('');
    setScanValue('');
    setScanMatch(null);
    setScanError('');
    setPreviewNonce((current) => current + 1);

    if (!selectedDeviceId) return;

    setDevices((currentDevices) => currentDevices.map((device) => (
      device.id === selectedDeviceId
        ? {
            ...device,
            ...(resultDevice || {}),
            assignedProductId: null,
            product: null,
            template: null,
          }
        : device
    )));
  }, [selectedDeviceId]);

  const handleClearLabel = async () => {
    setConfirmClearLabelOpen(false);
    const deviceIdToClear = selectedDeviceId;
    let clearedDeviceFromApi = null;

    resetLabelSelection(selectedDevice ? {
      ...selectedDevice,
      assignedProductId: null,
      product: null,
      template: null,
    } : null);

    if (!deviceIdToClear) {
      resetLabelSelection();
      showToast('success', 'Önizleme Temizlendi', 'Seçili ürün ve etiket önizlemesi temizlendi.');
      return;
    }

    if (sendingRef.current) {
      showToast('success', 'Onizleme Temizlendi', 'Secili urun ve etiket onizlemesi temizlendi.');
      return;
    }
    sendingRef.current = true;
    setSending(true);
    let timeoutId;
    try {
      const result = await Promise.race([
        eslService.clearLabel(deviceIdToClear),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('İstek zaman aşımına uşradı, lütfen tekrar deneyin.')), SEND_TIMEOUT_MS);
        }),
      ]);
      clearedDeviceFromApi = result?.device || null;
      resetLabelSelection(clearedDeviceFromApi);
      showToast('success', 'Etiket Temizlendi', result.message);
    } catch (err) {
      showToast('error', 'Hata', 'Etiket temizlenemedi: ' + err.message);
    } finally {
      clearTimeout(timeoutId);
      try {
        await refreshAfterSend();
        resetLabelSelection(clearedDeviceFromApi);
      } finally {
        setSending(false);
        sendingRef.current = false;
      }
    }
  };

  if (loading) {
    return (
      <div className="page-stack esl-page">
        <PageHeader className="dashboard-hero" icon={<Monitor size={22} />} title="Etiket Yönetimi" description="Yükleniyor..." />
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <RefreshCw size={24} className="spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack esl-page">

      <PageHeader
        className="dashboard-hero"
        icon={<Monitor size={22} />}
        title="Etiket Yönetimi"
        description="Raf etiketlerini yönetin ve cihazlara gönderin."
        actions={(
          <button
            type="button"
            className="btn btn-primary esl-refresh-devices-btn"
            onClick={handleRefresh}
            disabled={refreshingDevices}
          >
            <RefreshCw size={16} className={refreshingDevices ? 'spin' : ''} />
            {refreshingDevices ? 'Yenileniyor...' : 'Etiketleri Yenile'}
          </button>
        )}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Stats */}
      <section className="mod-summary-grid four">
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-blue"><Cpu size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Toplam Cihaz</span>
            <span className="mod-stat-value">{stats?.totalDevices || 0}</span>
            <span className="mod-stat-caption">Kayıtlı Etiket Sayısı</span>
          </div>
        </div>
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-green"><Wifi size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Çevrimiçi</span>
            <span className="mod-stat-value">{stats?.onlineCount || 0}</span>
            <span className="mod-stat-caption">Bağlı cihaz</span>
          </div>
        </div>
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-rose"><WifiOff size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Çevrimdışı</span>
            <span className="mod-stat-value">{stats?.offlineCount || 0}</span>
            <span className="mod-stat-caption">Erişilemeyen cihaz</span>
          </div>
        </div>
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-violet"><History size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Toplam Güncelleme</span>
            <span className="mod-stat-value">{stats?.totalUpdates || 0}</span>
            <span className="mod-stat-caption">Gönderilen etiket</span>
          </div>
        </div>
      </section>

      {/* Main Layout: Left (form) + Right (preview) */}
      <div className="esl-main-layout">
        {/* LEFT: Configuration */}
        <div className="esl-config-panel">
          <div className="mod-card esl-scan-panel">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-indigo"><QrCode size={18} /></div>
              <div><h3>Hızlı Etiket Tarama</h3><p>Barkod veya cihaz ID tarayarak hızlı işlem yapın</p></div>
            </div>
            <div className="esl-form-body">
              <ScanInput
                value={scanValue}
                onChange={(value) => {
                  setScanValue(value);
                  if (scanError) setScanError('');
                }}
                onSubmit={handleScanSubmit}
                placeholder="Barkod, QR, ESL cihaz ID veya MAC okutun"
                loading={scanLoading}
                buttonText="Bul"
              />

              {scanError && <div className="esl-scan-error">{scanError}</div>}

              {scanMatch && (
                <div className="esl-scan-result">
                  <div className="esl-scan-result-head">
                    <span className="esl-scan-kind">
                      {scanMatch.kind === 'device' ? <Monitor size={13} /> : <ScanLine size={13} />}
                      {scanMatch.kind === 'device' ? 'Etiket/Cihaz Eşleşti' : 'Ürün Barkodu Eşleşti'}
                    </span>
                    <button type="button" className="text-button" onClick={clearScanResult}>Temizle</button>
                  </div>

                  <div className="esl-scan-grid">
                    <div><span>Ürün Adı</span><strong>{formatUnit(resolvedScanProduct?.name || '-')}</strong></div>
                    <div><span>Barkod</span><strong>{resolvedScanProduct?.barcode || '-'}</strong></div>
                    <div><span>Etikete Gidecek Fiyat</span><strong>₺{resolveEslDisplayPricing(resolvedScanProduct).displayPrice.toFixed(2)}</strong></div>
                    <div><span>Mevcut Etiket Tipi</span><strong>{scanTemplateLabel}</strong></div>
                    <div><span>ESL Cihaz ID</span><strong>{resolvedScanDevice?.id || '-'}</strong></div>
                    <div><span>Reyon / Lokasyon</span><strong>{resolvedScanProduct?.sectionName || resolvedScanDevice?.location || '-'}</strong></div>
                    <div><span>Son Güncelleme</span><strong>{formatDate(resolvedScanDevice?.lastSyncAt || resolvedScanProduct?.updatedAt)}</strong></div>
                  </div>

                  <div className="esl-scan-actions">
                    <button type="button" className="btn esl-quick-action-btn esl-quick-action-standard" onClick={() => handleQuickTemplateApply('standard')} disabled={!selectedDeviceId || !selectedProductId || sending}>
                      <LayoutTemplate size={14} /> Standart Etiket Uygula
                    </button>
                    <button type="button" className="btn esl-quick-action-btn esl-quick-action-campaign" onClick={() => handleQuickTemplateApply('campaign')} disabled={!selectedDeviceId || !selectedProductId || sending}>
                      Fırsat Etiketi Uygula
                    </button>
                    <button type="button" className="btn esl-quick-action-btn esl-quick-action-discount" onClick={() => handleQuickTemplateApply('discount')} disabled={!selectedDeviceId || !selectedProductId || sending}>
                      İndirim Etiketi Uygula
                    </button>
                    <button type="button" className="btn esl-quick-action-btn esl-quick-action-resend" onClick={() => handleSendToDevice()} disabled={!selectedDeviceId || !selectedProductId || sending}>
                      Etiketi Yeniden Gönder
                    </button>
                    <button type="button" className="btn esl-quick-action-btn esl-quick-action-match" onClick={() => {
                      if (resolvedScanDevice?.id) setSelectedDeviceId(resolvedScanDevice.id);
                      if (resolvedScanProduct?.id) setSelectedProductId(resolvedScanProduct.id);
                    }} disabled={!resolvedScanDevice && !resolvedScanProduct}>
                      <Link2 size={14} /> Eşleştirmeyi Güncelle
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Product Selection */}
          <div className="mod-card" id="esl-product-selection">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-blue"><Package size={18} /></div>
              <div><h3>Ürün Seçimi</h3><p>Etikete basılacak ürünü seçin</p></div>
              <span className={`esl-section-status ${isProductSelected ? 'selected' : 'pending'}`}>
                {isProductSelected ? <><CheckCircle2 size={14} /> Ürün seçimi yapıldı</> : <><AlertCircle size={14} /> Ürün seçimi bekleniyor</>}
              </span>
            </div>
            <div className="esl-form-body">
              <label className="field-group">
                <span>Ürün Ara</span>
                <div className="esl-search-input">
                  <Search size={16} />
                  <input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="SKU, ürün adı veya barkod..."
                  />
                </div>
              </label>
              {productSearch.trim() && (
                <div className="esl-search-results">
                  {filteredProducts.slice(0, 8).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`esl-search-item ${p.id === selectedProductId ? 'selected' : ''}`}
                      onClick={() => handleProductSelect(p.id)}
                    >
                      <div className="esl-search-item-info">
                        <strong>{formatUnit(p.name)}</strong>
                        <small>{p.sku} · {p.barcode || '-'}</small>
                      </div>
                      <span className="esl-search-item-price">₺{resolveEslDisplayPricing(p).displayPrice.toFixed(2)}</span>
                    </button>
                  ))}
                  {filteredProducts.length === 0 && (
                    <div className="esl-search-empty">
                      <AlertCircle size={16} /> Arama kriterine uygun ürün bulunamadı.
                    </div>
                  )}
                </div>
              )}
              {selectedProduct && (
                <div className="esl-selected-product">
                  <CheckCircle2 size={16} />
                  <div>
                    <strong>{formatUnit(selectedProduct.name)}</strong>
                    <small>{selectedProduct.sku} · ₺{selectedProductPricing.displayPrice.toFixed(2)}</small>
                  </div>
                </div>
              )}
              {!selectedProduct && (
                <label className="field-group esl-manual-select-group">
                  <span>veya listeden seçin</span>
                  <select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}>
                    <option value="">Ürün seçin...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>

          {/* Device Selection */}
          <div className="mod-card" id="esl-device-selection" ref={deviceSelectionRef}>
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-green"><Monitor size={18} /></div>
              <div><h3>Cihaz Seçimi</h3><p>Hedef etiketi seçin</p></div>
              <span className={`esl-section-status ${isDeviceSelected ? 'selected' : 'pending'}`}>
                {isDeviceSelected ? 'Cihaz seçili' : <><AlertCircle size={14} /> Cihaz seçimi bekleniyor</>}
              </span>
            </div>
            <div className="esl-form-body">
              <div className="esl-device-grid">
                {devices.map((device) => (
                  <button
                    key={device.id}
                    type="button"
                    className={`esl-device-card ${device.id === selectedDeviceId ? 'selected' : ''} ${device.status !== 'online' ? 'offline' : ''}`}
                    onClick={() => handleDeviceSelect(device.id)}
                  >
                    <div className="esl-device-card-header">
                      <span className={`esl-device-status-chip ${device.status}`}>
                        {device.status === 'online' ? <Wifi size={13} /> : <WifiOff size={13} />}
                        {device.status === 'online' ? 'Çevrimiçi' : 'Çevrimdışı'}
                      </span>
                      <span className="esl-device-signal-time">{formatDate(device.lastSeenAt || device.lastSyncAt)}</span>
                    </div>

                    <div className="esl-device-main">
                      <strong>{device.name}</strong>
                      <small>{getLabelLocationDisplay(device)}</small>
                    </div>

                    <div className="esl-device-meta">
                      <span className="esl-device-meta-pill esl-device-battery-pill">
                        <Battery size={12} /> %{device.batteryLevel}
                      </span>
                      <span className="esl-device-meta-pill esl-device-mac">{device.macAddress}</span>
                    </div>

                    {device.product && (
                      <div className="esl-device-assigned">
                        <Tag size={11} /> {formatUnit(device.product.name)}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Template Selection */}
          <div className="mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-violet"><Tag size={18} /></div>
              <div><h3>Şablon Seçimi</h3><p>Etiket düzenini belirleyin</p></div>
              <span className={`esl-section-status ${isTemplateSelected ? 'selected' : 'pending'}`}>
                {isTemplateSelected ? <><CheckCircle2 size={14} /> Şablon seçimi yapıldı</> : <><AlertCircle size={14} /> Şablon seçimi bekleniyor</>}
              </span>
            </div>
            <div className="esl-form-body">
              <div className="esl-template-grid esl-template-grid-compact">
                {TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    className={`esl-template-card esl-template-card-compact ${tpl.id === effectiveSelectedTemplate ? 'selected' : ''}`}
                    onClick={() => handleTemplateSelect(tpl.id)}
                  >
                    <div className="esl-template-icon">
                      {tpl.id === 'campaign' || tpl.id === 'discount' ? <Megaphone size={20} /> : <LayoutTemplate size={20} />}
                    </div>
                    <div className="esl-template-info">
                      <strong>{tpl.label}</strong>
                      <small>{tpl.desc}</small>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Preview + Actions */}
        <div className="esl-preview-panel">
          <div className="mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-amber"><Eye size={18} /></div>
              <div><h3>Etiket Önizleme</h3><p>E-paper görünümünün canlı simülasyonu</p></div>
            </div>
            <div className="esl-preview-container">
              <ESLPreview
                key={`${selectedDeviceId || 'no-device'}-${selectedProductId || 'empty'}-${effectiveSelectedTemplate || 'standard'}-${previewNonce}`}
                product={selectedProduct ? {
                  name: selectedProduct.name,
                  barcode: selectedProduct.barcode || '',
                  salePrice: selectedProductPricing.displayPrice,
                  previousSalePrice: selectedProductPricing.hasActiveCampaign ? selectedProductPricing.regularPrice : resolvePreviousSalePrice(selectedProduct),
                  origin: selectedProduct.origin || 'Türkiye',
                  expiryDate: selectedProduct.lastPriceChangeDate || selectedProduct.lastPriceChangeAt || '',
                } : null}
                template={effectiveSelectedTemplate}
              />

              {selectedProduct && (
                <div className="esl-preview-info">
                  <div className="esl-preview-info-row">
                    <span>Ürün:</span>
                    <strong>{formatUnit(selectedProduct.name)}</strong>
                  </div>
                  <div className="esl-preview-info-row">
                    <span>SKU:</span>
                    <strong>{selectedProduct.sku}</strong>
                  </div>
                  <div className="esl-preview-info-row">
                    <span>Barkod:</span>
                    <strong>{selectedProduct.barcode || '-'}</strong>
                  </div>
                  <div className="esl-preview-info-row">
                    <span>Etikete gidecek fiyat:</span>
                    <strong>₺{selectedProductPricing.displayPrice.toFixed(2)}</strong>
                  </div>
                  {selectedProductPricing.hasActiveCampaign ? (
                    <div className="esl-preview-info-row">
                      <span>Regular fiyat:</span>
                      <strong>₺{selectedProductPricing.regularPrice.toFixed(2)}</strong>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="esl-action-buttons">
                <button
                  className="btn esl-preview-action-btn esl-preview-refresh-btn"
                  onClick={() => {
                    setPreviewNonce((current) => current + 1);
                  }}
                  disabled={!selectedProduct}
                >
                  <RefreshCw size={16} /> Önizlemeyi Güncelle
                </button>
                <button
                  className="btn btn-primary esl-send-btn"
                  onClick={() => handleSendToDevice()}
                  disabled={!selectedProductId || !selectedDeviceId || sending || (selectedDevice && selectedDevice.status !== 'online')}
                >
                  <Send size={16} /> {sending ? 'Gönderiliyor...' : selectedDevice && selectedDevice.status !== 'online' ? 'Cihaz Çevrimdışı' : 'Cihaza Gönder'}
                </button>
                <button
                  className="btn btn-danger-outline"
                  onClick={() => setConfirmClearLabelOpen(true)}
                  disabled={(!selectedDeviceId && !selectedProductId && !scanMatch) || sending}
                >
                  <XCircle size={16} /> Etiketi Temizle
                </button>
              </div>
            </div>
          </div>

          {/* Selected Device Info */}
          <div className="mod-card esl-device-info-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-green"><Cpu size={18} /></div>
              <div><h3>Cihaz Bilgisi</h3><p>{hasSelectedDevice ? selectedDevice.name : '-'}</p></div>
            </div>
            <div className="esl-device-detail esl-device-detail-modern">
              <div className="esl-device-hero">
                <div className="esl-device-hero-title">
                  <strong>{hasSelectedDevice ? selectedDevice.name : '-'}</strong>
                  <span>{hasSelectedDevice ? selectedDevice.model : '-'}</span>
                </div>
                <div className="esl-device-hero-badges">
                  <span className={`esl-device-status-chip ${hasSelectedDevice ? selectedDevice.status : 'pending'}`}>
                    {hasSelectedDevice ? (selectedDevice.status === 'online' ? <Wifi size={13} /> : <WifiOff size={13} />) : <WifiOff size={13} />}
                    {hasSelectedDevice ? (selectedDevice.status === 'online' ? 'Çevrimiçi' : 'Çevrimdışı') : '-'}
                  </span>
                  <span className="esl-device-battery-chip">
                    <Battery size={13} />
                    {hasSelectedDevice ? `%${selectedDevice.batteryLevel}` : '-'}
                  </span>
                </div>
              </div>

              <div className="esl-device-grid">
                <div className="esl-device-info-item">
                  <span>Model</span>
                  <strong>{hasSelectedDevice ? selectedDevice.model : '-'}</strong>
                </div>
                <div className="esl-device-info-item">
                  <span>Firmware</span>
                  <strong>{hasSelectedDevice ? `v${selectedDevice.firmwareVersion}` : '-'}</strong>
                </div>
                <div className="esl-device-info-item">
                  <span>MAC Adresi</span>
                  <strong>{hasSelectedDevice ? selectedDevice.macAddress : '-'}</strong>
                </div>
                <div className="esl-device-info-item">
                  <span>IP Adresi</span>
                  <strong>{hasSelectedDevice ? (selectedDevice.ipAddress || '-') : '-'}</strong>
                </div>
                <div className="esl-device-info-item">
                  <span>Konum</span>
                  <strong>{hasSelectedDevice ? getLabelLocationDisplay(selectedDevice) : '-'}</strong>
                </div>
                <div className="esl-device-info-item">
                  <span>Son Senkron</span>
                  <strong>{hasSelectedDevice ? formatDate(selectedDevice.lastSyncAt) : '-'}</strong>
                </div>
              </div>

              <div className="esl-battery-panel">
                <div className="esl-battery-panel-head">
                  <span>Pil Seviyesi</span>
                  <strong>{hasSelectedDevice ? `%${selectedDevice.batteryLevel}` : '-'}</strong>
                </div>
                <div className="esl-battery-bar esl-battery-bar-wide">
                  <div
                    className="esl-battery-fill"
                    style={{ width: hasSelectedDevice ? `${selectedDevice.batteryLevel}%` : '0%' }}
                    data-level={hasSelectedDevice ? (selectedDevice.batteryLevel > 50 ? 'high' : selectedDevice.batteryLevel > 20 ? 'mid' : 'low') : 'low'}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* History Table */}
      <div className="mod-card esl-history-section">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-slate"><History size={18} /></div>
          <div><h3>Güncelleme Geçmişi</h3><p>Cihazlara gönderilen etiket kayıtları</p></div>
          {history.length > 0 && (
            <button
              className="btn btn-ghost btn-sm esl-clear-history-btn"
              onClick={() => setConfirmClearOpen(true)}
              title="Geçmişi temizle"
            >
              <Trash2 size={15} /> Temizle
            </button>
          )}
        </div>
        <div className="table-wrapper">
          <table className="esl-history-table">
            <thead>
              <tr>
                <th>Tarih</th>
                <th>Cihaz</th>
                <th>Ürün</th>
                <th>SKU</th>
                <th className="text-right">Fiyat</th>
                <th>Şablon</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="esl-empty-history">
                      <History size={32} />
                      <p>Henüz etiket gönderimi yapılmadı.</p>
                      <span>Yapılan etiket güncellemeleri burada listelenecektir.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                pagedHistory.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.createdAt)}</td>
                    <td>{entry.deviceName}</td>
                    <td>{formatUnit(entry.productName)}</td>
                    <td><code>{entry.productSku}</code></td>
                    <td className="text-right">₺{(entry.salePrice || 0).toFixed(2)}</td>
                    <td>
                      <span className="esl-template-badge-sm">{entry.template}</span>
                    </td>
                    <td>
                      <span className={`status-badge ${entry.status === 'success' ? 'active' : 'critical'}`}>
                        {entry.status === 'success' ? 'Başarılı' : 'Hata'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {history.length > 0 ? (
          <div className="table-pagination">
            <div className="table-pagination-summary-block">
              <div className="table-pagination-summary">
                <strong>Sayfa {historyPage} / {historyTotalPages}</strong>
                <span className="table-pagination-total">· {historyStart}-{historyEnd} / {history.length} kayıt</span>
              </div>
            </div>
            <div className="table-pagination-actions">
              <button className="ghost-button" type="button" onClick={() => setHistoryPage((current) => Math.max(1, current - 1))} disabled={historyPage === 1}>Önceki</button>
              <button className="primary-button" type="button" onClick={() => setHistoryPage((current) => Math.min(historyTotalPages, current + 1))} disabled={historyPage === historyTotalPages}>Sonraki</button>
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmModal
        isOpen={confirmClearOpen}
        title="Güncelleme Geçmişini Temizle"
        description="Tüm güncelleme geçmişi silinsin mi? Bu işlem geri alınamaz."
        confirmText="Geçmişi Sil"
        cancelText="İptal"
        tone="danger"
        onConfirm={handleClearHistory}
        onCancel={() => setConfirmClearOpen(false)}
      />

      <ConfirmModal
        isOpen={confirmClearLabelOpen}
        title="Mevcut Etiketi Temizle"
        description={`"${selectedDevice?.name || ''}" cihazına atanmış etiket kaldırılsın mı? Cihaz bir sonraki senkronizasyonda boş ekran gösterecektir.`}
        confirmText="Etiketi Temizle"
        cancelText="İptal"
        tone="danger"
        onConfirm={handleClearLabel}
        onCancel={() => setConfirmClearLabelOpen(false)}
      />
    </div>
  );
}
