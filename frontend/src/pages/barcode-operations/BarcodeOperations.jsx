import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  ScanBarcode,
  Camera,
  CameraOff,
  Package,
  MapPin,
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  ClipboardList,
  X,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader.jsx';
import Toast from '../../components/Toast.jsx';
import ScanInput from '../../components/ScanInput.jsx';
import { productService } from '../../services/productService.js';
import { stockService } from '../../services/stockService.js';
import { formatDepotLocationLabel, formatUnit } from '../../services/formatters.js';
import { normalizeBarcodeInput } from '../../utils/barcode.js';
import { CAMERA_PERMISSION_HELP_TEXT, getCameraErrorMessage, logCameraError, startHtml5Scanner, waitForCameraElement } from '../../utils/cameraAccess.js';

const normalizeMoneyInput = (value) => String(value ?? '').replace(',', '.');

const parseMoneyInput = (value, fallback = 0) => {
  const normalized = normalizeMoneyInput(value).trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ACTION_TYPES = [
  { id: 'stock-in', label: 'Sipariş Girdisi', icon: TrendingUp, color: '#16a34a' },
  { id: 'stock-out', label: 'Sipariş Ver', icon: ShoppingCart, color: '#2563eb' },
  { id: 'stock-decrease', label: 'Stok Azalt', icon: TrendingDown, color: '#ef4444' },
  { id: 'stock-increase', label: 'Stok Yükselt', icon: TrendingUp, color: '#16a34a' },
  { id: 'price-update', label: 'Fiyat Güncelle', icon: ({ size = 20, ...props }) => <span style={{ fontSize: size, fontWeight: 700, lineHeight: 1 }} {...props}>₺</span>, color: '#f59e0b' },
];

export default function BarcodeOperations() {
  const [scanning, setScanning] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeAction, setActiveAction] = useState(null);
  const [actionForm, setActionForm] = useState({});
  const [actionLoading, setActionLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [toast, setToast] = useState(null);

  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);

  const showToast = (type, title, message) => setToast({ type, title, message });

  const lookupBarcode = useCallback(async (barcode) => {
    const normalizedBarcode = normalizeBarcodeInput(barcode);
    if (!normalizedBarcode) return;
    setLoading(true);
    setError('');
    setProduct(null);
    setActiveAction(null);
    setActionForm({});
    try {
      const result = await productService.findByBarcode(normalizedBarcode);
      setProduct(result);
    } catch (err) {
      if (err.status >= 500 || err.status === 0) {
        setError(err.message || 'Barkod arama servisi hata verdi. Lütfen tekrar deneyin.');
      } else if (err.status === 404) {
        setError('Bu barkodla eşleşen ürün bulunamadı.');
      } else {
        setError(err.message || 'Ürün bulunamadı');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const startScanner = useCallback(async () => {
    if (html5QrRef.current) return;
    setCameraError('');
    try {
      await waitForCameraElement('barcode-reader');
      const html5Qr = new Html5Qrcode('barcode-reader');
      html5QrRef.current = html5Qr;
      setScanning(true);
      await startHtml5Scanner(
        html5Qr,
        {
          fps: 12,
          aspectRatio: 16 / 9,
          qrbox: (viewfinderWidth, viewfinderHeight) => ({
            width: Math.floor(viewfinderWidth * 0.88),
            height: Math.floor(viewfinderHeight * 0.72),
          }),
        },
        (decodedText) => {
          stopScanner();
          lookupBarcode(decodedText);
        },
        () => {}
      );
    } catch (error) {
      logCameraError(error, 'barcode-operations');
      try { await html5QrRef.current?.clear(); } catch {}
      setScanning(false);
      html5QrRef.current = null;
      const message = `${getCameraErrorMessage(error)} ${CAMERA_PERMISSION_HELP_TEXT}`;
      setCameraError(message);
      showToast('error', 'Kamera Hatası', message);
    }
  }, [lookupBarcode]);

  const stopScanner = useCallback(() => {
    if (html5QrRef.current) {
      html5QrRef.current.stop().catch(() => {});
      html5QrRef.current.clear().catch(() => {});
      html5QrRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => () => stopScanner(), [stopScanner]);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    lookupBarcode(manualBarcode);
  };

  const resetState = () => {
    setProduct(null);
    setError('');
    setActiveAction(null);
    setActionForm({});
    setManualBarcode('');
  };

  const handleActionSubmit = async (e) => {
    e.preventDefault();
    if (!product || !activeAction) return;
    setActionLoading(true);
    try {
      switch (activeAction) {
        case 'stock-in':
          await stockService.stockIn({
            productId: product.id,
            qty: Number(actionForm.qty),
            note: actionForm.note || '',
          });
          showToast('success', 'Başarılı', `${actionForm.qty} adet stok giriş yapıldı.`);
          break;
        case 'stock-out':
          await stockService.stockOut({
            productId: product.id,
            qty: Number(actionForm.qty),
            note: actionForm.note || '',
          });
          showToast('success', 'Başarılı', `${actionForm.qty} adet stok çıkış yapıldı.`);
          break;
        case 'stock-decrease':
          await stockService.adjust({
            productId: product.id,
            targetQuantity: Math.max(0, product.currentStock - Number(actionForm.qty)),
            note: actionForm.note || 'Barkod ile stok azaltma',
          });
          showToast('success', 'Başarılı', `Stok ${actionForm.qty} adet azaltıldı.`);
          break;
        case 'stock-increase':
          await stockService.adjust({
            productId: product.id,
            targetQuantity: product.currentStock + Number(actionForm.qty),
            note: actionForm.note || 'Barkod ile stok artırma',
          });
          showToast('success', 'Başarılı', `Stok ${actionForm.qty} adet artırıldı.`);
          break;
        case 'price-update':
          await productService.update(product.id, {
            purchasePrice: parseMoneyInput(actionForm.purchasePrice ?? product.purchasePrice),
            salePrice: parseMoneyInput(actionForm.salePrice ?? product.salePrice),
          });
          showToast('success', 'Başarılı', 'Fiyat güncellendi.');
          break;
        default:
          break;
      }
      const refreshed = await productService.findByBarcode(product.barcode || product.sku);
      setProduct(refreshed);
      setActiveAction(null);
      setActionForm({});
    } catch (err) {
      showToast('error', 'Hata', err.message || 'İşlem başarısız.');
    } finally {
      setActionLoading(false);
    }
  };

  const renderActionForm = () => {
    if (!activeAction) return null;

    if (activeAction === 'price-update') {
      return (
        <form className="barcode-action-form" onSubmit={handleActionSubmit}>
          <div className="barcode-form-grid">
            <label className="barcode-form-field">
              <span>Alış Fiyatı</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={actionForm.purchasePrice ?? product.purchasePrice ?? ''}
                onChange={(e) => setActionForm({ ...actionForm, purchasePrice: normalizeMoneyInput(e.target.value) })}
                required
              />
            </label>
            <label className="barcode-form-field">
              <span>Satış Fiyatı</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={actionForm.salePrice ?? product.salePrice ?? ''}
                onChange={(e) => setActionForm({ ...actionForm, salePrice: normalizeMoneyInput(e.target.value) })}
                required
              />
            </label>
          </div>
          <div className="barcode-form-actions">
            <button type="submit" className="primary-button" disabled={actionLoading}>
              {actionLoading ? 'Kaydediliyor...' : 'Fiyatı Güncelle'}
            </button>
            <button type="button" className="ghost-button" onClick={() => { setActiveAction(null); setActionForm({}); }}>
              Vazgeç
            </button>
          </div>
        </form>
      );
    }

    const isDecrease = activeAction === 'stock-decrease';
    const isIncrease = activeAction === 'stock-increase';
    const label = isDecrease ? 'Azaltılacak Miktar' : isIncrease ? 'Artırılacak Miktar' : 'Miktar';

    return (
      <form className="barcode-action-form" onSubmit={handleActionSubmit}>
        <div className="barcode-form-grid">
          <label className="barcode-form-field">
            <span>{label}</span>
            <input
              type="number"
              min="1"
              max={isDecrease ? product.currentStock : undefined}
              value={actionForm.qty ?? ''}
              onChange={(e) => setActionForm({ ...actionForm, qty: e.target.value })}
              placeholder="0"
              required
            />
          </label>
          <label className="barcode-form-field">
            <span>Not (Opsiyonel)</span>
            <input
              type="text"
              value={actionForm.note ?? ''}
              onChange={(e) => setActionForm({ ...actionForm, note: e.target.value })}
              placeholder="Açıklama giriniz..."
            />
          </label>
        </div>
        <div className="barcode-form-actions">
          <button type="submit" className="primary-button" disabled={actionLoading || !actionForm.qty}>
            {actionLoading ? 'İşleniyor...' : 'Onayla'}
          </button>
          <button type="button" className="ghost-button" onClick={() => { setActiveAction(null); setActionForm({}); }}>
            Vazgeç
          </button>
        </div>
      </form>
    );
  };

  return (
    <div className="page-stack">
      <PageHeader
        className="dashboard-hero"
        icon={<ScanBarcode size={22} />}
        title="Barkod İşlemleri"
        description="Barkod ile hızlı stok ve fiyat işlemleri yapın."
        actions={
          product && (
            <button className="ghost-button" onClick={resetState}>
              <RotateCcw size={16} /> Yeni Tarama
            </button>
          )
        }
      />

      {!product && (
        <div className="barcode-scanner-section mod-card">
          <div className="mod-card-header">
            <div className="mod-card-icon mod-icon-indigo"><ScanBarcode size={18} /></div>
            <div><h3>Barkod Tarayıcı</h3><p>Kamera veya manuel giriş ile ürün barkodunu okuyun</p></div>
          </div>
          <div className="barcode-scanner-tabs">
            <button
              className={`barcode-tab ${scanning ? 'active' : ''}`}
              onClick={scanning ? stopScanner : startScanner}
              type="button"
            >
              {scanning ? <CameraOff size={18} /> : <Camera size={18} />}
              {scanning ? 'Kamerayı Kapat' : 'Kamera ile Tara'}
            </button>
          </div>

          <div
            className={`barcode-camera-area ${scanning ? 'active' : ''}`}
            ref={scannerRef}
          >
            <div id="barcode-reader" />
            {scanning && <div className="barcode-scan-overlay" aria-hidden="true" />}
            {!scanning && (
              <div className="barcode-camera-placeholder">
                <ScanBarcode size={48} strokeWidth={1.2} />
                <p>Kamera ile taramak için yukarıdaki düşmeye basın</p>
                {cameraError ? (
                  <>
                    <span className="barcode-modal-error">{cameraError}</span>
                    <button type="button" className="ghost-button" onClick={startScanner}>
                      Tekrar Dene
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </div>

          <div className="barcode-divider">
            <span>veya</span>
          </div>

          <ScanInput
            className="barcode-manual-form"
            value={manualBarcode}
            onChange={setManualBarcode}
            onSubmit={handleManualSubmit}
            placeholder="Barkod numarasını giriniz veya okutunuz..."
            loading={loading}
            buttonText="Ara"
          />

          {loading && (
            <div className="loading-state inline">
              <div className="loader" />
              <span>Ürün aranıyor...</span>
            </div>
          )}

          {error && (
            <div className="barcode-error">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}

      {product && (
        <>
          <div className="barcode-product-card mod-card">
            <div className="barcode-product-header">
              <div className="barcode-product-icon">
                <Package size={24} />
              </div>
              <div className="barcode-product-identity">
                <h3>{formatUnit(product.name)}</h3>
                <div className="barcode-product-meta">
                  <span className="barcode-sku">{product.sku}</span>
                  {product.barcode && <span className="barcode-code">{product.barcode}</span>}
                </div>
              </div>
              <div className={`badge ${product.isCritical ? 'danger' : 'success'}`}>
                {product.isCritical ? 'Kritik Stok' : 'Normal'}
              </div>
            </div>

            <div className="barcode-product-stats">
              <div className="barcode-stat">
                <span className="barcode-stat-label">Depo Stok</span>
                <strong className={product.isCritical ? 'text-danger' : ''}>{product.warehouseStock ?? product.currentStock ?? 0}</strong>
              </div>
              <div className="barcode-stat">
                <span className="barcode-stat-label">Reyon Stok</span>
                <strong>{product.storeStock ?? 0}</strong>
              </div>
              <div className="barcode-stat">
                <span className="barcode-stat-label">Fiyat</span>
                <strong>{product.salePrice?.toFixed(2) || '0.00'} TL</strong>
              </div>
            </div>

            <div className="barcode-product-details">
              <div className="barcode-detail-row">
                <MapPin size={14} />
                <span className="barcode-detail-label">Depo Konum</span>
                <span>{formatDepotLocationLabel(product.warehouseLocation)}</span>
              </div>
              <div className="barcode-detail-row">
                <MapPin size={14} />
                <span className="barcode-detail-label">Reyon Konum</span>
                <span>{product.sectionName || '-'} {product.shelfCode ? `/ ${product.shelfCode}` : ''}</span>
              </div>
              <div className="barcode-detail-row">
                <Package size={14} />
                <span className="barcode-detail-label">SKU</span>
                <span>{product.sku || '-'}</span>
              </div>
              <div className="barcode-detail-row">
                <ScanBarcode size={14} />
                <span className="barcode-detail-label">Barkod</span>
                <span>{product.barcode || '-'}</span>
              </div>
            </div>
          </div>

          <div className="barcode-actions-section mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-amber"><ClipboardList size={18} /></div>
              <div><h3>Hızlı İşlemler</h3><p>Stok ve fiyat güncellemelerini buradan yapın</p></div>
            </div>
            <div className="barcode-action-buttons">
              {ACTION_TYPES.map((action) => (
                <button
                  key={action.id}
                  className={`barcode-action-btn ${activeAction === action.id ? 'active' : ''}`}
                  style={{ '--action-color': action.color }}
                  onClick={() => {
                    setActiveAction(activeAction === action.id ? null : action.id);
                    setActionForm({});
                  }}
                  type="button"
                >
                  <action.icon size={20} />
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
            {renderActionForm()}
          </div>
        </>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
