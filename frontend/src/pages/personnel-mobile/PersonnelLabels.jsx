import { useEffect, useMemo, useState } from 'react';
import { Battery, BadgePercent, CheckCircle2, Megaphone, Monitor, Search, Send, Tag, Wifi, WifiOff, ScanLine, Smartphone, Settings2, Image, Layers } from 'lucide-react';
import ESLPreview from '../../components/ESLPreview.jsx';
import { eslService } from '../../services/eslService.js';
import { productService } from '../../services/productService.js';
import { barcodeLookupService } from '../../services/barcodeLookupService.js';

const TEMPLATES = [
  { id: 'standard', label: 'Standart (2.9")', shortLabel: 'Standart', desc: 'Ürün adı, barkod, fiyat, menşei', icon: Tag },
  { id: 'campaign', label: 'Fırsat', shortLabel: 'Fırsat', desc: 'Büyük fiyat vurgusu ve fırsat bandı içerir', icon: Megaphone },
  { id: 'discount', label: 'İndirim', shortLabel: 'İndirim', desc: 'Eski fiyat ve indirimli fiyat vurgusunu gösterir', icon: BadgePercent },
];

function resolveProductName(item) {
  return item?.name || item?.productName || '-';
}

function resolveProductPrice(item) {
  return Number(item?.salePrice ?? item?.currentPrice ?? item?.price ?? 0);
}

function resolveProductOrigin(item) {
  return item?.origin || 'Türkiye';
}

function resolveProductExpiry(item) {
  return item?.nearestExpiry || item?.expiryDate || item?.skt || '';
}

function resolveLocation(item) {
  return item?.sectionName || item?.shelfCode || item?.defaultShelfLocationCode || item?.defaultWarehouseLocationCode || '-';
}

function normalizeTurkishInput(value) {
  return String(value ?? '').normalize('NFC');
}

function normalizeForSearch(value) {
  return normalizeTurkishInput(value).toLocaleLowerCase('tr-TR');
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function PersonnelLabels() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [devices, setDevices] = useState([]);
  const [products, setProducts] = useState([]);
  const [stats, setStats] = useState(null);

  const [scanValue, setScanValue] = useState('');
  const [scanError, setScanError] = useState('');
  const [scanResult, setScanResult] = useState(null);

  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('standard');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');

  const [resultMessage, setResultMessage] = useState('');

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      const [devicesResult, productsResult, statsResult] = await Promise.allSettled([
        eslService.listDevices(),
        productService.list({ includeUnlisted: false, fetchAll: true, includeListDetails: true }),
        eslService.getStats(),
      ]);

      if (!mounted) return;

      setDevices(devicesResult.status === 'fulfilled' && Array.isArray(devicesResult.value) ? devicesResult.value : []);
      setProducts(productsResult.status === 'fulfilled' && Array.isArray(productsResult.value) ? productsResult.value : []);
      setStats(statsResult.status === 'fulfilled' ? statsResult.value : null);
      setLoading(false);
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedProduct = useMemo(
    () => products.find((item) => String(item.id) === String(selectedProductId)) || null,
    [products, selectedProductId]
  );

  const selectedDevice = useMemo(
    () => devices.find((item) => String(item.id) === String(selectedDeviceId)) || null,
    [devices, selectedDeviceId]
  );

  const filteredProducts = useMemo(() => {
    const query = normalizeTurkishInput(productSearch).trim();
    if (query.length < 2) return [];
    const needle = normalizeForSearch(query);

    return products
      .filter((item) =>
        normalizeForSearch(resolveProductName(item)).includes(needle)
          || String(item.barcode || '').includes(query)
          || normalizeForSearch(String(item.sku || '')).includes(needle)
      )
      .slice(0, 10);
  }, [products, productSearch]);

  const filteredDevices = useMemo(() => {
    const query = barcodeLookupService.normalizeScanValue(scanValue);
    if (!query) return devices;
    const needle = query.toLocaleLowerCase('tr-TR');
    return devices.filter((device) =>
      String(device?.id || '').toLocaleLowerCase('tr-TR').includes(needle)
      || String(device?.name || '').toLocaleLowerCase('tr-TR').includes(needle)
      || String(device?.macAddress || '').toLocaleLowerCase('tr-TR').includes(needle)
      || String(device?.barcode || '').toLocaleLowerCase('tr-TR').includes(needle)
      || String(device?.qrCode || '').toLocaleLowerCase('tr-TR').includes(needle)
    );
  }, [devices, scanValue]);

  const handleScanLookup = async () => {
    setScanError('');
    setResultMessage('');
    const token = barcodeLookupService.normalizeScanValue(scanValue);
    if (!token) {
      setScanResult(null);
      return;
    }

    try {
      const result = await barcodeLookupService.resolveLabelScan(token, { products, devices });
      if (result.kind === 'none' || result.kind === 'not-found') {
        setScanResult(null);
        setScanError('Etiket, cihaz veya ürün bulunamadı.');
        return;
      }

      setScanResult(result);
      if (result.device?.id) setSelectedDeviceId(result.device.id);
      if (result.product?.id) setSelectedProductId(result.product.id);
    } catch (error) {
      setScanResult(null);
      setScanError(error?.message || 'Tarama sonucu işlenemedi.');
    }
  };

  const handleApply = async () => {
    if (!selectedDevice || !selectedProduct || !selectedTemplate || saving) return;

    setSaving(true);
    setResultMessage('');
    try {
      const response = await eslService.sendToDevice({
        deviceId: selectedDevice.id,
        productId: selectedProduct.id,
        template: selectedTemplate,
      });

      setResultMessage(response?.message || 'Etiket güncelleme başarılı.');

      const [nextDevices, nextStats] = await Promise.allSettled([
        eslService.listDevices(),
        eslService.getStats(),
      ]);

      if (nextDevices.status === 'fulfilled' && Array.isArray(nextDevices.value)) {
        setDevices(nextDevices.value);
      }
      if (nextStats.status === 'fulfilled') {
        setStats(nextStats.value);
      }
    } catch (error) {
      setResultMessage(error?.message || 'Etiket güncelleme başarısız.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="personnel-empty-state">Etiket verileri yükleniyor...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <section className="personnel-kpi-grid">
        <article className="personnel-kpi-card">
          <div className="kpi-icon blue"><Monitor size={20} /></div>
          <div className="kpi-data"><strong>{stats?.totalDevices || 0}</strong><span>Toplam Cihaz</span></div>
        </article>
        <article className="personnel-kpi-card">
          <div className="kpi-icon green"><Wifi size={20} /></div>
          <div className="kpi-data"><strong>{stats?.onlineCount || 0}</strong><span>Çevrim İçi</span></div>
        </article>
        <article className="personnel-kpi-card">
          <div className="kpi-icon red"><WifiOff size={20} /></div>
          <div className="kpi-data"><strong>{stats?.offlineCount || 0}</strong><span>Çevrim Dışı</span></div>
        </article>
        <article className="personnel-kpi-card">
          <div className="kpi-icon amber"><Tag size={20} /></div>
          <div className="kpi-data"><strong>{stats?.totalUpdates || 0}</strong><span>Toplam İşlem</span></div>
        </article>
      </section>

      <section className="personnel-section-card">
        <h3 className="personnel-section-title-emphasized"><Search size={18} style={{ color: '#2563eb' }} /> 1. Ürün Seçimi</h3>

        <div className="personnel-search-wrapper" style={{ marginBottom: filteredProducts.length > 0 || selectedProduct ? '12px' : '0' }}>
          <Search size={20} />
          <input
            className="personnel-input"
            placeholder="Ürün ara (ad, barkod, SKU)"
            value={productSearch}
            onChange={(e) => setProductSearch(normalizeTurkishInput(e.target.value))}
          />
        </div>

        {filteredProducts.length > 0 && (
          <ul className="autocomplete-dropdown" style={{ position: 'relative', top: '0', boxShadow: 'none', border: '1px solid var(--p-border)', marginBottom: selectedProduct ? '16px' : '0' }}>
            {filteredProducts.map((item) => (
              <li key={item.id} onClick={() => { setSelectedProductId(item.id); setProductSearch(''); }} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <strong>{resolveProductName(item)}</strong>
                    <small>{item.barcode || '-'} - {resolveLocation(item)}</small>
                  </div>
                  <CheckCircle2 size={16} color="var(--p-accent)" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {selectedProduct && (
          <div className="personnel-info-grid">
            <div style={{ gridColumn: '1 / -1', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '4px' }}>
              <strong style={{ fontSize: '1rem', color: 'var(--p-accent)' }}>{resolveProductName(selectedProduct)}</strong>
            </div>
            <div><span>Barkod</span><strong>{selectedProduct.barcode || '-'}</strong></div>
            <div><span>Menşei</span><strong>{resolveProductOrigin(selectedProduct)}</strong></div>
            <div><span>SKT</span><strong>{resolveProductExpiry(selectedProduct) || '-'}</strong></div>
            <div><span>Fiyat</span><strong>{resolveProductPrice(selectedProduct).toFixed(2)} TL</strong></div>
          </div>
        )}
      </section>

      <section className="personnel-section-card">
        <h3 className="personnel-section-title-emphasized"><Smartphone size={18} style={{ color: '#2563eb' }} /> 2. Cihaz Seçimi</h3>

        <div className="personnel-search-wrapper" style={{ marginBottom: '12px' }}>
          <ScanLine size={20} />
          <input
            className="personnel-input"
            placeholder="Cihaz ara (ESL ID, MAC, barkod)"
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
          />
          <button type="button" className="personnel-action-inside" onClick={handleScanLookup}>Bul</button>
        </div>

        {scanError && <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '12px', fontWeight: 600 }}>{scanError}</div>}

        {scanResult && (
          <div className="personnel-info-grid" style={{ marginBottom: '16px', background: '#eff6ff', borderColor: '#bfdbfe' }}>
            <div style={{ gridColumn: '1 / -1', borderBottom: '1px solid #bfdbfe', paddingBottom: '8px', marginBottom: '4px' }}>
              <strong style={{ fontSize: '0.95rem', color: '#1e40af' }}>Eşleşen Tarama Sonucu</strong>
            </div>
            <div><span>Ürün</span><strong>{resolveProductName(scanResult.product)}</strong></div>
            <div><span>Cihaz</span><strong>{scanResult.device?.id || '-'}</strong></div>
            <div><span>MAC</span><strong>{scanResult.device?.macAddress || '-'}</strong></div>
            <div><span>Lokasyon</span><strong>{scanResult.product ? resolveLocation(scanResult.product) : (scanResult.device?.location || '-')}</strong></div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredDevices.map((device) => (
            <button
              key={device.id}
              type="button"
              className={`secondary-button ${selectedDeviceId === device.id ? 'active' : ''}`}
              style={{
                justifyContent: 'flex-start',
                background: selectedDeviceId === device.id ? '#eff6ff' : '#ffffff',
                borderColor: selectedDeviceId === device.id ? '#3b82f6' : '#cbd5e1',
                color: selectedDeviceId === device.id ? '#1e40af' : '#334155',
                textAlign: 'left'
              }}
              onClick={() => setSelectedDeviceId(device.id)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                <strong style={{ fontSize: '0.95rem', fontWeight: selectedDeviceId === device.id ? 700 : 600 }}>{device.name || device.id}</strong>
                <span style={{ fontSize: '0.75rem', color: selectedDeviceId === device.id ? '#3b82f6' : '#64748b' }}>
                  {device.status === 'online' ? 'Çevrim İçi' : 'Çevrim Dışı'} - {device.macAddress || '-'}
                </span>
              </div>
              {selectedDeviceId === device.id && <CheckCircle2 size={18} color="#3b82f6" />}
            </button>
          ))}
          {filteredDevices.length === 0 && (
            <div className="personnel-empty-state" style={{ padding: '16px' }}>Cihaz bulunamadı.</div>
          )}
        </div>
      </section>

      <section className="personnel-section-card">
        <h3 className="personnel-section-title-emphasized"><Settings2 size={18} style={{ color: '#2563eb' }} /> 3. Cihaz Bilgisi</h3>
        <div className="personnel-info-grid" style={{ gap: '8px', padding: '12px' }}>
          <div><span>Cihaz Adı</span><strong>{selectedDevice?.name || selectedDevice?.id || '-'}</strong></div>
          <div><span>Model</span><strong>{selectedDevice?.model || '-'}</strong></div>
          <div><span>Bağlantı</span><strong>{selectedDevice ? (selectedDevice?.status === 'online' ? 'Çevrim İçi' : 'Çevrim Dışı') : '-'}</strong></div>
          <div><span>Durum</span><strong>{selectedDevice ? (selectedDevice?.status === 'online' ? 'Aktif' : 'Pasif') : '-'}</strong></div>
          <div><span>Firmware</span><strong>{selectedDevice?.firmwareVersion || '-'}</strong></div>
          <div><span>MAC</span><strong>{selectedDevice?.macAddress || '-'}</strong></div>
          <div><span>IP</span><strong>{selectedDevice?.ipAddress || '-'}</strong></div>
          <div><span>Konum</span><strong>{selectedDevice?.location || '-'}</strong></div>
          <div><span>Son Senkron</span><strong>{formatDate(selectedDevice?.lastSyncAt || selectedDevice?.lastSeenAt)}</strong></div>
          <div><span>Pil</span><strong>{typeof selectedDevice?.batteryLevel === 'number' ? `%${selectedDevice.batteryLevel}` : '-'}</strong></div>
        </div>
      </section>

      <section className="personnel-section-card">
        <h3 className="personnel-section-title-emphasized"><Layers size={18} style={{ color: '#2563eb' }} /> 4. Şablon Seçimi</h3>
        <div className="personnel-template-card-grid">
          {TEMPLATES.map((tpl) => {
            const Icon = tpl.icon;
            const isSelected = selectedTemplate === tpl.id;
            return (
              <button
                key={tpl.id}
                type="button"
                className={`personnel-template-card ${isSelected ? 'is-selected' : ''}`}
                onClick={() => setSelectedTemplate(tpl.id)}
              >
                <div className="personnel-template-card__head">
                  <span className="personnel-template-card__icon" aria-hidden="true"><Icon size={16} /></span>
                  <span className="personnel-template-card__badge">{isSelected ? 'Seçili' : 'Hazır'}</span>
                </div>
                <strong>{tpl.label}</strong>
              </button>
            );
          })}
        </div>
        <p style={{ margin: '10px 0 0 0', fontSize: '0.8rem', color: '#64748b', textAlign: 'center' }}>
          {TEMPLATES.find(t => t.id === selectedTemplate)?.desc}
        </p>
      </section>

      <section className="personnel-section-card">
        <h3 className="personnel-section-title-emphasized"><Image size={18} style={{ color: '#2563eb' }} /> 5. Etiket Önizleme</h3>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', background: '#f8fafc', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
          <ESLPreview
            product={selectedProduct ? {
              name: resolveProductName(selectedProduct),
              barcode: selectedProduct.barcode || '',
              salePrice: resolveProductPrice(selectedProduct),
              previousSalePrice: Number(selectedProduct?.previousSalePrice ?? selectedProduct?.listPrice ?? selectedProduct?.originalPrice ?? 0),
              origin: resolveProductOrigin(selectedProduct),
              expiryDate: resolveProductExpiry(selectedProduct),
            } : null}
            template={selectedTemplate}
          />
        </div>
      </section>

      <section className="personnel-section-card">
        <h3 className="personnel-section-title-emphasized"><Send size={18} style={{ color: '#2563eb' }} /> 6. Uygula</h3>
        <button
          type="button"
          className="primary-button personnel-btn-block"
          disabled={!selectedDevice || !selectedProduct || saving}
          onClick={handleApply}
        >
          {saving ? 'Gönderiliyor...' : 'Etiketi Uygula'}
        </button>
        {resultMessage && (
          <div style={{ marginTop: '12px', padding: '12px', borderRadius: '8px', background: '#dcfce7', color: '#166534', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Battery size={16} /> {resultMessage}
          </div>
        )}
      </section>
    </div>
  );
}
