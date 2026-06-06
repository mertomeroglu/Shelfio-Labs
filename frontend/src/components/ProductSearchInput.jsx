import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, ScanBarcode, Camera, CameraOff, X } from 'lucide-react';
import { productService } from '../services/productService.js';
import { normalizeSearchText } from '../services/formatters.js';
import { CAMERA_PERMISSION_HELP_TEXT, getCameraErrorMessage, logCameraError, startHtml5Scanner, waitForCameraElement } from '../utils/cameraAccess.js';

const loadHtml5Qrcode = async () => {
  const mod = await import('html5-qrcode');
  return mod.Html5Qrcode;
};

export default function ProductSearchInput({ stocks, value, onChange, disabled }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');

  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);

  const selected = stocks.find((s) => s.productId === value) || null;

  const tokenStartsWithQuery = (value, query) => {
    const text = normalizeSearchText(value);
    if (!text || !query) return false;
    if (query.includes(' ')) return text.includes(query);
    const tokens = text.split(/\s+/).filter(Boolean);
    return tokens.some((token) => token.startsWith(query));
  };

 /*  Dışarı tıklayınca kapat  */
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

 /*  Scanner temizlişi  */
  useEffect(() => {
    return () => stopScanner();
  }, []);

 /*  Filtreleme  */
  const filtered = stocks.filter((item) => {
    if (!item.isActive) return false;
    if (!query.trim()) return true;
    const q = normalizeSearchText(query);
    return (
      tokenStartsWithQuery(item.productName, q) ||
      tokenStartsWithQuery(item.name, q) ||
      tokenStartsWithQuery(item.brand || item.brandName, q) ||
      tokenStartsWithQuery(item.categoryName || item.mainCategoryName, q) ||
      tokenStartsWithQuery(item.supplierName || item.supplierProductName, q) ||
      tokenStartsWithQuery(item.sku, q) ||
      normalizeSearchText(item.barcode).includes(q)
    );
  });

 /*  Seçim  */
  const selectProduct = useCallback(
    (productId) => {
      onChange(productId);
      setQuery('');
      setOpen(false);
    },
    [onChange]
  );

 /*  Barkod okuyucu  */
  const startScanner = useCallback(async () => {
    if (html5QrRef.current) return;
    setScanError('');
    setScanning(true);
    try {
      const Html5Qrcode = await loadHtml5Qrcode();
      await waitForCameraElement('product-search-reader');
      const html5Qr = new Html5Qrcode('product-search-reader');
      html5QrRef.current = html5Qr;
      await startHtml5Scanner(
        html5Qr,
        { fps: 10, qrbox: { width: 250, height: 140 } },
        async (decodedText) => {
          stopScanner();
          try {
            const product = await productService.findByBarcode(decodedText);
            if (product?.id) {
              selectProduct(product.id);
            }
          } catch {
            setScanError('Barkoda ait ürün bulunamadı.');
          }
        },
        () => {}
      );
    } catch (error) {
      logCameraError(error, 'product-search');
      setScanError(`${getCameraErrorMessage(error)} ${CAMERA_PERMISSION_HELP_TEXT}`);
      try { await html5QrRef.current?.clear(); } catch {}
      html5QrRef.current = null;
      setScanning(false);
    }
  }, [selectProduct]);

  const stopScanner = useCallback(() => {
    const qr = html5QrRef.current;
    if (qr) {
      qr.stop().catch(() => {});
      qr.clear();
      html5QrRef.current = null;
    }
    setScanning(false);
  }, []);

 /*  Seçimi temizle  */
  const clearSelection = () => {
    onChange('');
    setQuery('');
    inputRef.current?.focus();
  };

  return (
    <div className="product-search-wrapper" ref={wrapperRef}>
      <span className="field-group-label">Ürün</span>

 {/* ?? Seçili ürün gösterimi  */}
      {selected ? (
        <div className="product-search-selected">
          <div className="product-search-selected-info">
            <strong>{selected.productName}</strong>
            <span className="product-search-meta">{selected.sku}{selected.barcode ? ` • ${selected.barcode}` : ''} • Stok: {selected.quantity}</span>
          </div>
          {!disabled && (
            <button type="button" className="product-search-clear" onClick={clearSelection} title="Temizle">
              <X size={16} />
            </button>
          )}
        </div>
      ) : (
 /*  Arama input  */
        <div className="product-search-input-row">
          <div className="product-search-field">
            <Search size={16} className="product-search-icon" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Ürün adı, SKU veya barkod yazın..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              disabled={disabled}
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            className={`product-search-scan-btn ${scanning ? 'active' : ''}`}
            onClick={scanning ? stopScanner : startScanner}
            disabled={disabled}
            title={scanning ? 'Kamerayı kapat' : 'Barkod oku'}
          >
            {scanning ? <CameraOff size={18} /> : <ScanBarcode size={18} />}
          </button>
        </div>
      )}

 {/* ?? Barkod kamera  */}
      {scanning && (
        <div className="product-search-camera">
          <div id="product-search-reader" ref={scannerRef}></div>
          <div className="product-search-camera-hint">
            <Camera size={14} /> Barkodu kamera görüş alanına tutun
          </div>
        </div>
      )}

      {scanError && (
        <div className="product-search-scan-error">
          <span>{scanError}</span>
          <button type="button" className="ghost-button" onClick={startScanner} disabled={disabled || scanning}>
            Tekrar Dene
          </button>
        </div>
      )}

 {/* ?? Açılır sonuç listesi  */}
      {open && !selected && !scanning && (
        <div className="product-search-dropdown">
          {filtered.length === 0 ? (
            <div className="product-search-empty">Eşleşen ürün bulunamadı</div>
          ) : (
            filtered.slice(0, 50).map((item) => (
              <button
                type="button"
                key={item.productId}
                className="product-search-option"
                onMouseDown={() => selectProduct(item.productId)}
              >
                <span className="product-search-option-name">{item.productName}</span>
                <span className="product-search-option-detail">
                  {item.sku}{item.barcode ? ` • ${item.barcode}` : ''} • Stok: {item.quantity}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
