import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Package2, ScanLine, Search, X } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';
import { productService } from '../../services/productService.js';
import { stockService } from '../../services/stockService.js';
import { getDepotDisplayLabel, getProductDisplayUnit } from '../../services/productService.js';
import { usePersonnelProductSearch } from '../../hooks/usePersonnelProductSearch.js';
import { CAMERA_PERMISSION_HELP_TEXT, getCameraErrorMessage, logCameraError, startHtml5Scanner, waitForCameraElement } from '../../utils/cameraAccess.js';

const baseForm = {
  barcode: '',
  productId: '',
  physicalQuantity: '',
};

function resolveDepotStock(product) {
  return Number(product?.stockSummary?.warehouseStock ?? product?.warehouseStock ?? 0) || 0;
}

function resolveShelfStock(product) {
  return Number(product?.stockSummary?.shelfStock ?? product?.shelfStock ?? 0) || 0;
}

function resolveSystemStock(product) {
  return Number(product?.stockSummary?.totalStock ?? product?.totalStock ?? product?.onHand ?? 0) || 0;
}

function resolveDepotLocation(product) {
  if (Array.isArray(product?.depotLocations) && product.depotLocations.length > 0) {
    return getDepotDisplayLabel(product.depotLocations[0]?.locationCode);
  }
  return getDepotDisplayLabel(product?.defaultWarehouseLocationCode || product?.warehouseLocationCode || '-');
}

async function createHtml5Scanner(elementId) {
  const { Html5Qrcode } = await import('html5-qrcode');
  return new Html5Qrcode(elementId);
}

export default function PersonnelCount() {
  const { user } = useAuth();
  const scannerRef = useRef(null);
  const [form, setForm] = useState(baseForm);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [message, setMessage] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const { results: searchResults, isSearching } = usePersonnelProductSearch(searchQuery, { limit: 8 });

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) {
      setIsScanning(false);
      return;
    }
    try { await scanner.stop(); } catch {}
    try { await scanner.clear(); } catch {}
    scannerRef.current = null;
    setIsScanning(false);
  }, []);

  useEffect(() => () => {
    void stopScanner();
  }, [stopScanner]);

  const systemStock = useMemo(() => resolveSystemStock(selectedProduct), [selectedProduct]);
  const depotStock = useMemo(() => resolveDepotStock(selectedProduct), [selectedProduct]);
  const shelfStock = useMemo(() => resolveShelfStock(selectedProduct), [selectedProduct]);
  const physicalQuantity = useMemo(() => {
    const parsed = Number(form.physicalQuantity);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }, [form.physicalQuantity]);
  const difference = useMemo(() => {
    if (physicalQuantity === null) return null;
    return systemStock - physicalQuantity;
  }, [physicalQuantity, systemStock]);

  const clearCountSelection = useCallback(() => {
    setForm(baseForm);
    setSelectedProduct(null);
    setSearchQuery('');
    setMessage(null);
  }, []);

  const countStatus = useMemo(() => {
    if (!selectedProduct || physicalQuantity === null || difference === null) return null;
    if (difference === 0) {
      return {
        tone: 'success',
        icon: CheckCircle2,
        title: 'Fark yok',
        text: 'Sistem stoğu ile fiziksel sayım eşleşiyor.',
      };
    }
    if (difference > 0) {
      return {
        tone: 'danger',
        icon: AlertTriangle,
        title: 'Eksik stok uyarısı',
        text: `${difference} adet eksik görünüyor. Kayıt sırasında sebep "Sayım farkı" olarak işlenecek.`,
      };
    }
    return {
      tone: 'warning',
      icon: AlertTriangle,
      title: 'Fazla stok uyarısı',
      text: `${Math.abs(difference)} adet fazla sayıldı. Otomatik stok artışı yapılmayacak.`,
    };
  }, [difference, physicalQuantity, selectedProduct]);
  const CountStatusIcon = countStatus?.icon || AlertTriangle;

  const applySelectedProduct = useCallback((product) => {
    setSelectedProduct(product || null);
    setForm((current) => ({
      ...current,
      barcode: product?.barcode || current.barcode,
      productId: String(product?.id || ''),
    }));
    setSearchQuery('');
    setMessage(null);
  }, []);

  const resolveProductByBarcode = useCallback(async (barcode) => {
    const normalized = String(barcode || '').trim();
    if (!normalized) {
      setMessage({ tone: 'warning', text: 'Barkod okutun veya ürün seçin.' });
      return;
    }
    setLookupLoading(true);
    setMessage(null);
    try {
      const product = await productService.findByBarcode(normalized);
      applySelectedProduct(product);
    } catch {
      setSelectedProduct(null);
      setForm((current) => ({ ...current, productId: '' }));
      setMessage({ tone: 'error', text: 'Barkoda ait ürün bulunamadı.' });
    } finally {
      setLookupLoading(false);
    }
  }, [applySelectedProduct]);

  const handleLookupInputChange = useCallback((value) => {
    setForm((current) => ({ ...current, barcode: value, productId: '' }));
    setSearchQuery(value);
    setMessage(null);
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      setSelectedProduct(null);
      return;
    }
    setSelectedProduct(null);
  }, []);

  const handleLookupKeyDown = useCallback((event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const firstSearchResult = searchResults[0];
    if (firstSearchResult) {
      applySelectedProduct(firstSearchResult);
      return;
    }
    void resolveProductByBarcode(form.barcode);
  }, [applySelectedProduct, form.barcode, resolveProductByBarcode, searchResults]);

  const startScanner = useCallback(async () => {
    if (isScanning) {
      await stopScanner();
      return;
    }
    setMessage(null);
    setIsScanning(true);
    try {
      await waitForCameraElement('personnel-count-reader');
      const scanner = await createHtml5Scanner('personnel-count-reader');
      scannerRef.current = scanner;
      await startHtml5Scanner(
        scanner,
        { fps: 10, qrbox: { width: 240, height: 150 } },
        async (decodedText) => {
          await stopScanner();
          const barcode = String(decodedText || '').trim();
          setForm((current) => ({ ...current, barcode }));
          await resolveProductByBarcode(barcode);
        },
        () => {}
      );
    } catch (error) {
      logCameraError(error, 'personnel-count');
      try { await scannerRef.current?.clear(); } catch {}
      setMessage({ tone: 'error', text: `${getCameraErrorMessage(error)} ${CAMERA_PERMISSION_HELP_TEXT}` });
      setIsScanning(false);
      scannerRef.current = null;
      return;
    }
  }, [isScanning, resolveProductByBarcode, stopScanner]);

  const submitCount = useCallback(async () => {
    if (!selectedProduct || !form.productId) {
      setMessage({ tone: 'error', text: 'Önce barkod okutun veya ürün seçin.' });
      return;
    }
    if (physicalQuantity === null) {
      setMessage({ tone: 'error', text: 'Fiziksel sayım miktarı 0 veya daha büyük olmalıdır.' });
      return;
    }
    if (difference === 0) {
      setMessage({ tone: 'success', text: 'Fark yok. Sayım sonucu onaylandı.' });
      return;
    }
    if ((difference || 0) < 0) {
      setMessage({ tone: 'warning', text: 'Fazla stok tespit edildi. Otomatik stok artırımı yapılmadı.' });
      return;
    }

    const actorName = String(user?.name || user?.username || 'Personel').trim() || 'Personel';
    const actorId = String(user?.id || '').trim();
    const timestamp = new Date().toISOString();
    let remaining = Number(difference || 0);
    let currentDepot = depotStock;
    let currentShelf = shelfStock;
    const noteParts = [
      'Sebep: Sayım farkı',
      'Kaynak: Personel Sayım Modülü',
      `İşlemi Yapan: ${actorName}`,
      `Kullanıcı ID: ${actorId || '-'}`,
      `İşlem Tarihi: ${timestamp}`,
      `Sistem Stok: ${systemStock}`,
      `Depo Stok: ${depotStock}`,
      `Reyon Stok: ${shelfStock}`,
      `Fiziksel Sayım: ${physicalQuantity}`,
      `Fark: ${difference}`,
    ];

    try {
      setSaving(true);
      setMessage(null);

      const depotDecrease = Math.min(remaining, currentDepot);
      if (depotDecrease > 0) {
        await stockService.stockOut({
          productId: form.productId,
          qty: depotDecrease,
          location: 'depo',
          reasonCode: 'count_deficit',
          reasonLabel: 'Sayım farkı',
          note: [...noteParts, `Düşülen Lokasyon: Depo`, `Eski Stok: ${currentDepot}`, `Yeni Stok: ${currentDepot - depotDecrease}`].join(' | '),
        });
        currentDepot -= depotDecrease;
        remaining -= depotDecrease;
      }

      const shelfDecrease = Math.min(remaining, currentShelf);
      if (shelfDecrease > 0) {
        await stockService.stockOut({
          productId: form.productId,
          qty: shelfDecrease,
          location: 'reyon',
          reasonCode: 'count_deficit',
          reasonLabel: 'Sayım farkı',
          note: [...noteParts, `Düşülen Lokasyon: Reyon`, `Eski Stok: ${currentShelf}`, `Yeni Stok: ${currentShelf - shelfDecrease}`].join(' | '),
        });
        currentShelf -= shelfDecrease;
        remaining -= shelfDecrease;
      }

      if (remaining > 0) {
        throw new Error('Sayım farkı kadar düşülecek yeterli stok bulunamadı.');
      }

      const refreshedProduct = await productService.getById(form.productId, { forceRefresh: true });
      setSelectedProduct(refreshedProduct);
      setForm((current) => ({ ...current, physicalQuantity: '' }));
      setMessage({ tone: 'success', text: 'Sayım kaydedildi. Eksik stok "Sayım farkı" olarak işlendi.' });
    } catch (error) {
      setMessage({ tone: 'error', text: error?.message || 'Sayım kaydedilemedi.' });
    } finally {
      setSaving(false);
    }
  }, [depotStock, difference, form.productId, physicalQuantity, selectedProduct, shelfStock, systemStock, user?.id, user?.name, user?.username]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <section className="personnel-section-card">
        <div className="personnel-section-head">
          <h2 className="personnel-section-title-emphasized"><Package2 size={18} className="personnel-title-icon personnel-title-icon-search" /> Sayım</h2>
        </div>

        <div style={{ display: 'grid', gap: '12px' }}>
          <div className="personnel-search-wrapper">
            <Search size={20} />
            <input
              className="personnel-input"
              placeholder="Barkod okut veya ürün ara"
              value={form.barcode}
              onChange={(event) => handleLookupInputChange(event.target.value)}
              onKeyDown={handleLookupKeyDown}
            />
            <div className="personnel-search-actions">
              {form.barcode || selectedProduct ? (
                <button type="button" className="personnel-action-inside" aria-label="Arama alanını temizle" onClick={clearCountSelection}>
                  <X size={16} />
                </button>
              ) : null}
              <button type="button" className="personnel-action-inside" aria-label="Barkod tara" onClick={startScanner}>
                <ScanLine size={20} />
              </button>
            </div>
          </div>

          {isScanning ? <div style={{ borderRadius: '12px', overflow: 'hidden' }}><div id="personnel-count-reader" /></div> : null}

          {isSearching ? <span style={{ display: 'block', fontSize: '0.8rem', color: '#64748b' }}>Aranıyor...</span> : null}

          {searchResults.length > 0 ? (
            <ul className="autocomplete-dropdown" style={{ position: 'relative', top: 0, boxShadow: 'none', border: '1px solid var(--p-border)' }}>
              {searchResults.map((item) => (
                <li key={item.id} onClick={() => applySelectedProduct(item)}>
                  <strong>{item.productName}</strong>
                  <small>{item.categoryName || 'Kategori Yok'} • Barkod: {item.barcode || '-'}</small>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className="personnel-section-card">
        <div className="personnel-info-grid">
          <div style={{ gridColumn: '1 / -1' }}>
            <span>Ürün Bilgisi</span>
            <strong>{selectedProduct?.productName || 'Ürün seçilmedi'}</strong>
          </div>
          <div>
            <span>Sistem Stok</span>
            <strong>{systemStock} {selectedProduct ? getProductDisplayUnit(selectedProduct) : 'adet'}</strong>
          </div>
          <div>
            <span>Depo Stok</span>
            <strong>{depotStock}</strong>
          </div>
          <div>
            <span>Reyon Stok</span>
            <strong>{shelfStock}</strong>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <span>Depo Lokasyonu</span>
            <strong>{selectedProduct ? resolveDepotLocation(selectedProduct) : '-'}</strong>
          </div>
          <label style={{ gridColumn: '1 / -1', display: 'grid', gap: '6px' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>Fiziksel Sayım Miktarı</span>
            <input
              className="personnel-input"
              type="number"
              min="0"
              step="1"
              value={form.physicalQuantity}
              onChange={(event) => setForm((current) => ({ ...current, physicalQuantity: event.target.value }))}
              placeholder="0"
              disabled={!selectedProduct}
            />
          </label>
          <div style={{ gridColumn: '1 / -1' }}>
            <span>Fark</span>
            <strong style={{ color: difference === 0 ? '#16a34a' : (difference || 0) < 0 ? '#d97706' : '#dc2626' }}>
              {difference === null ? '-' : difference}
            </strong>
          </div>
        </div>

        {countStatus ? (
          <div className={`personnel-count-status personnel-count-status--${countStatus.tone}`}>
            <CountStatusIcon size={18} />
            <div>
              <strong>{countStatus.title}</strong>
              <span>{countStatus.text}</span>
            </div>
          </div>
        ) : null}

        {message ? (
          <div
            className="personnel-empty-state"
            style={{
              marginTop: '14px',
              padding: '14px 16px',
              textAlign: 'left',
              color: message.tone === 'success' ? '#166534' : message.tone === 'warning' ? '#9a3412' : message.tone === 'error' ? '#b91c1c' : '#1d4ed8',
              background: message.tone === 'success' ? '#ecfdf5' : message.tone === 'warning' ? '#fff7ed' : message.tone === 'error' ? '#fef2f2' : '#eff6ff',
              border: `1px solid ${message.tone === 'success' ? '#bbf7d0' : message.tone === 'warning' ? '#fed7aa' : message.tone === 'error' ? '#fecaca' : '#bfdbfe'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {message.tone === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              <span>{message.text}</span>
            </div>
            {message.tone === 'error' && String(message.text || '').includes('Kamera') ? (
              <button type="button" className="personnel-action-secondary" style={{ marginTop: '10px' }} onClick={startScanner} disabled={isScanning}>
                Tekrar Dene
              </button>
            ) : null}
          </div>
        ) : null}

        <button type="button" className="primary-button" style={{ width: '100%', marginTop: '16px', justifyContent: 'center' }} onClick={submitCount} disabled={saving || !selectedProduct}>
          {saving ? 'Kaydediliyor...' : 'Sayımı Kaydet'}
        </button>
      </section>
    </div>
  );
}
