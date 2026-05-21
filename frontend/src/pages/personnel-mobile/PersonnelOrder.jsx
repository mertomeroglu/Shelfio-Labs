import { useEffect, useMemo, useState } from 'react';
import { Bell, PackagePlus, Plus, Search, Trash2, X, PackageSearch, ClipboardList, PackageCheck } from 'lucide-react';
import { formatCurrency } from '../../services/formatters.js';
import { getProductDisplayPrice, getProductDisplayUnit, productService } from '../../services/productService.js';
import { notificationService } from '../../services/notificationService.js';
import { useAuth } from '../../hooks/useAuth.js';
import { formatRecommendedOrderByUnit, getOrderableUnits, getPrimaryOrderUnit, getUnitMultiplier as getSharedUnitMultiplier, toOrderUnitLabel } from '../../utils/orderUnit.js';

const DRAFT_STORAGE_KEY = 'personnel_order_drafts';

function readDrafts() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistDrafts(value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Local draft cache is optional.
  }
}

function resolveStock(item) {
  return Number(item?.available ?? item?.stockSummary?.available ?? item?.currentStock ?? item?.totalStock ?? item?.onHand ?? 0);
}

function resolveStockBreakdown(item) {
  const summary = item?.stockSummary || {};
  const warehouse = Number(summary.warehouseStock ?? item?.warehouseStock ?? 0) || 0;
  const shelf = Number(summary.shelfStock ?? item?.shelfStock ?? 0) || 0;
  const total = Number(summary.totalStock ?? item?.totalStock ?? item?.onHand ?? (warehouse + shelf)) || 0;
  return { warehouse, shelf, total };
}

function resolveShelfCapacity(product) {
  const summary = Number(product?.stockSummary?.shelfCapacity ?? 0);
  const direct = Number(product?.shelfCapacity ?? 0);
  return Math.max(0, summary || direct || 100);
}

function normalizedUnitKey(unit) {
  return String(unit || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, ' ');
}

function getUnitMultiplier(product, unit) {
  return getSharedUnitMultiplier(product, unit);
}

function resolveOrderUnits(product) {
  return getOrderableUnits(product).map((unit) => toOrderUnitLabel(unit));
}

function isFractionalUnit(unit) {
  const value = String(unit || '').trim().toLocaleLowerCase('tr-TR');
  return ['kg', 'kilogram', 'g', 'gram', 'l', 'lt', 'litre', 'ml'].includes(value);
}

function unitRoundDown(value, unit) {
  const safe = Math.max(0, Number(value || 0));
  if (isFractionalUnit(unit)) return Number((Math.floor(safe * 10) / 10).toFixed(1));
  return Math.floor(safe);
}

export default function PersonnelOrder() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [sendingNotification, setSendingNotification] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [draftQuantity, setDraftQuantity] = useState('');
  const [draftUnit, setDraftUnit] = useState('Adet');
  const [draftNote, setDraftNote] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [message, setMessage] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (!isModalOpen) return undefined;
    const { style } = document.body;
    const prevOverflow = style.overflow;
    const prevTouchAction = style.touchAction;
    style.overflow = 'hidden';
    style.touchAction = 'none';
    return () => {
      style.overflow = prevOverflow;
      style.touchAction = prevTouchAction;
    };
  }, [isModalOpen]);

  useEffect(() => {
    setDrafts(readDrafts());
    setLoading(false);
  }, []);

  const saveDrafts = (nextDrafts) => {
    setDrafts(nextDrafts);
    persistDrafts(nextDrafts);
  };

  const handleSearchChange = async (event) => {
    const value = event.target.value;
    setSearchQuery(value);

    if (value.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const rows = await productService.list({ includeUnlisted: false, fetchAll: true, includeListDetails: true });
      const needle = value.toLocaleLowerCase('tr-TR');
      const matched = (Array.isArray(rows) ? rows : [])
        .filter((item) =>
          item.productName?.toLocaleLowerCase('tr-TR').includes(needle)
            || String(item.barcode || '').includes(value)
            || String(item.sku || '').toLocaleLowerCase('tr-TR').includes(needle))
        .slice(0, 8);
      setSearchResults(matched);
    } catch (error) {
      console.error('PersonnelOrder search failed', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectProduct = (item) => {
    const units = resolveOrderUnits(item);
    const primaryUnit = getPrimaryOrderUnit(item);
    const displayPrimaryUnit = primaryUnit.charAt(0).toUpperCase() + primaryUnit.slice(1);
    setSelectedProduct(item);
    setSearchQuery('');
    setSearchResults([]);
    setDraftQuantity('');
    setDraftUnit(units.find((unit) => normalizedUnitKey(unit) === normalizedUnitKey(displayPrimaryUnit)) || units[0] || 'Adet');
    setDraftNote('');
    setMessage('');
  };

  const handleAddDraft = () => {
    if (!selectedProduct) return;

    const qty = Number(draftQuantity);
    const allowFraction = isFractionalUnit(draftUnit);
    const invalidQty = !Number.isFinite(qty) || qty <= 0 || (!allowFraction && !Number.isInteger(qty));
    if (invalidQty) {
      setMessage(allowFraction ? "Miktar 0'dan buyuk olmali." : 'Miktar 1 veya daha buyuk tam sayi olmali.');
      return;
    }
    if (qty > selectedMaxOrderInUnit) {
      setMessage(`Miktar en fazla ${selectedMaxOrderInUnit} ${draftUnit} olabilir.`);
      return;
    }
    const unitMultiplier = getUnitMultiplier(selectedProduct, draftUnit);
    const quantityBase = qty * unitMultiplier;

    const nextDraft = {
      id: String(Date.now()),
      productId: selectedProduct.id,
      productName: selectedProduct.productName,
      sku: selectedProduct.sku || '',
      barcode: selectedProduct.barcode,
      quantity: qty,
      unit: draftUnit,
      unitMultiplier,
      quantityBase,
      baseUnit: 'Adet',
      unitPrice: getProductDisplayPrice(selectedProduct),
      note: draftNote.trim(),
      createdAt: new Date().toISOString(),
    };

    saveDrafts([...drafts, nextDraft]);
    setSelectedProduct(null);
    setDraftQuantity('');
    setDraftUnit(getProductDisplayUnit(selectedProduct));
    setDraftNote('');
    setMessage('');
  };

  const handleRemoveDraft = (draftId) => {
    saveDrafts(drafts.filter((item) => item.id !== draftId));
  };

  const draftSummary = useMemo(() => {
    const totalItem = drafts.length;
    const totalQty = drafts.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    return { totalItem, totalQty };
  }, [drafts]);

  const quantityNumber = Number(draftQuantity);
  const stockBreakdown = resolveStockBreakdown(selectedProduct);
  const selectedShelfCapacity = resolveShelfCapacity(selectedProduct);
  const currentStock = resolveStock(selectedProduct);
  const selectedUnitMultiplier = getUnitMultiplier(selectedProduct, draftUnit);
  const selectedUnits = useMemo(() => resolveOrderUnits(selectedProduct), [selectedProduct]);
  const requestedBaseQuantity = Number.isFinite(quantityNumber) && quantityNumber > 0 ?
    quantityNumber * selectedUnitMultiplier
    : 0;
  const projectedStock = currentStock + requestedBaseQuantity;
  const targetShelfStock = useMemo(
    () => Math.floor(Math.max(0, selectedShelfCapacity) * 0.9),
    [selectedShelfCapacity]
  );
  const neededForTargetQty = useMemo(
    () => Math.max(0, targetShelfStock - stockBreakdown.shelf),
    [targetShelfStock, stockBreakdown.shelf]
  );
  const shelfGapQty = useMemo(
    () => Math.max(0, selectedShelfCapacity - stockBreakdown.shelf),
    [selectedShelfCapacity, stockBreakdown.shelf]
  );
  const selectedMaxOrderQty = useMemo(
    () => Math.max(0, Math.min(stockBreakdown.warehouse, shelfGapQty)),
    [stockBreakdown.warehouse, shelfGapQty]
  );
  const selectedRecommendedQty = useMemo(
    () => Math.max(0, Math.min(neededForTargetQty, stockBreakdown.warehouse)),
    [neededForTargetQty, stockBreakdown.warehouse]
  );
  const selectedMaxOrderInUnit = useMemo(() => {
    const raw = selectedMaxOrderQty / Math.max(1, selectedUnitMultiplier);
    return unitRoundDown(raw, draftUnit);
  }, [selectedMaxOrderQty, selectedUnitMultiplier, draftUnit]);
  const recommendedOrderDisplay = useMemo(
    () => formatRecommendedOrderByUnit(selectedProduct, selectedRecommendedQty, getPrimaryOrderUnit(selectedProduct)),
    [selectedProduct, selectedRecommendedQty]
  );
  const recommendationHint = useMemo(() => {
    if (!selectedProduct) return '';
    if (selectedShelfCapacity <= 0) return 'Reyon kapasitesi bulunamadı, varsayılan kapasite kullanılıyor.';
    if (stockBreakdown.warehouse <= 0) return 'Depo stok yok.';
    if (neededForTargetQty <= 0) return 'Reyon hedef dolulukta, sipariş gerekmez.';
    return '';
  }, [selectedProduct, selectedShelfCapacity, stockBreakdown.warehouse, neededForTargetQty]);
  
  const handleNotifySelf = async () => {
    if (drafts.length === 0 || sendingNotification) return;
    if (!user?.id) {
      setMessage('Aktif kullanıcı kimliği bulunamadı. Tekrar giriş yapın.');
      return;
    }

    setSendingNotification(true);
    setMessage('');
    try {
      const lines = drafts.slice(0, 8).map((item) => {
        const unit = String(item.unit || 'Adet');
        const baseInfo = Number(item.unitMultiplier || 1) > 1
          ? ` | ${Number(item.quantity || 0) * Number(item.unitMultiplier || 1)} adet karsiligi`
          : '';
        const barcodeInfo = item.barcode ? ` | Barkod: ${item.barcode}` : '';
        return `- ${item.productName} | ${item.quantity} ${unit}${barcodeInfo}${baseInfo}${item.note ? ` | Not: ${item.note}` : ''}`;
      });
      const suffix = drafts.length > 8 ? `\n... +${drafts.length - 8} ürün daha` : '';
      const summaryText = `Toplam ${draftSummary.totalItem} ürün, ${draftSummary.totalQty} adet\n${lines.join('\n')}${suffix}`;

      await notificationService.create({
        title: 'Mobil sipariş taslağı',
        message: `${user?.name || 'Personel'} tarafından oluşturuldu.\n${summaryText}`,
        type: 'order',
        severity: 'medium',
        actionUrl: '/bildirimler',
        actionType: 'mobile_order_draft',
        targeting: {
          mode: 'users',
          userIds: [user.id],
        },
      });

      saveDrafts([]);
      setMessage('Sipariş taslağı başarıyla iletildi.');
    } catch (error) {
      console.error('PersonnelOrder notify self failed', error);
      setMessage(error?.message || 'Bildirim gönderilemedi.');
    } finally {
      setSendingNotification(false);
    }
  };

  if (loading) {
    return <div className="personnel-empty-state">Sipariş modülü yükleniyor...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <section className="personnel-section-card">
        <h3 className="personnel-section-title-emphasized"><PackageSearch size={18} /> Ürün Ekle</h3>
        <div style={{ position: 'relative' }}>
          <div className="personnel-search-wrapper">
            <Search size={20} />
            <input className="personnel-input" placeholder="Ürün adı veya barkod..." value={searchQuery} onChange={handleSearchChange} />
          </div>

          {isSearching && <span style={{ display: 'block', marginTop: '6px', fontSize: '0.8rem', color: '#64748b' }}>Aranıyor...</span>}

          {searchResults.length > 0 && (
            <ul className="autocomplete-dropdown" style={{ top: '100%', marginTop: '4px' }}>
              {searchResults.map((item) => (
                <li key={item.id} onClick={() => handleSelectProduct(item)} style={{ cursor: 'pointer' }}>
                  <strong>{item.productName}</strong>
                  <small>Barkod: {item.barcode || '-'} - Mevcut Stok: {resolveStock(item)}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {selectedProduct && (
        <section className="personnel-section-card" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <strong style={{ fontSize: '1rem', color: '#1e40af' }}>{selectedProduct.productName}</strong>
              <span style={{ fontSize: '0.8rem', color: '#3b82f6' }}>Barkod: {selectedProduct.barcode || '-'} | Stok: {resolveStock(selectedProduct)}</span>
            </div>
            <button type="button" className="ghost-button" style={{ minHeight: '32px', padding: '0 8px', color: '#64748b' }} onClick={() => setSelectedProduct(null)}>
              <X size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
              <input
                className="personnel-input"
                type="number"
                min={isFractionalUnit(draftUnit) ? '0.1' : '1'}
                step={isFractionalUnit(draftUnit) ? '0.1' : '1'}
                max={selectedMaxOrderInUnit > 0 ? String(selectedMaxOrderInUnit) : undefined}
                placeholder="Miktar"
                value={draftQuantity}
                onChange={(event) => setDraftQuantity(event.target.value)}
              />
              <select className="personnel-select" value={draftUnit} onChange={(e) => setDraftUnit(e.target.value)}>
                {selectedUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </div>
            
            {requestedBaseQuantity > 0 && (
              <div className="personnel-info-grid" style={{ padding: '12px', background: '#ffffff' }}>
                <div><span>Mevcut Stok</span><strong>{stockBreakdown.total} {getProductDisplayUnit(selectedProduct)}</strong></div>
                <div><span>Sipariş Sonrası Toplam Stok</span><strong style={{ color: '#16a34a' }}>{projectedStock} {getProductDisplayUnit(selectedProduct)}</strong></div>
              </div>
            )}
            <div className="personnel-order-qty-hints" aria-label="Sipariş miktarı rehberi">
              <div className="personnel-order-qty-chip">
                <span>Maksimum Sipariş Miktarı</span>
                <strong>{isFractionalUnit(draftUnit) ? Number(selectedMaxOrderInUnit).toFixed(1) : Math.floor(selectedMaxOrderInUnit)} {draftUnit}</strong>
              </div>
              <div className="personnel-order-qty-chip">
                <span>Önerilen Sipariş Miktarı</span>
                <strong>{recommendedOrderDisplay.text}</strong>
              </div>
            </div>
            {recommendationHint ? <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{recommendationHint}</div> : null}
            
            <input className="personnel-input" type="text" placeholder="Sipariş notu (isteğe bağlı)" value={draftNote} onChange={(event) => setDraftNote(event.target.value)} />
            
            <button type="button" className="primary-button" onClick={handleAddDraft}>
              <Plus size={18} /> Taslağa Ekle
            </button>
          </div>
        </section>
      )}

      <section className="personnel-section-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 className="personnel-section-title-emphasized" style={{ margin: 0 }}><ClipboardList size={18} /> Taslak Siparişler</h3>
          <span className="personnel-badge blue">{draftSummary.totalItem} ürün</span>
        </div>

        {drafts.length === 0 ? (
          <div className="personnel-empty-state" style={{ padding: '24px 16px' }}>Taslak sipariş listeniz boş.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <ul className="personnel-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {drafts.slice(0, 3).map((item) => (
                <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '12px', background: '#f8fafc' }}>
                  <div style={{ background: '#fffbeb', color: '#f59e0b', width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <PackagePlus size={18} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: '0.9rem', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.productName}</strong>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Miktar: {item.quantity} {item.unit || 'Adet'}</span>
                  </div>
                  <button type="button" style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => handleRemoveDraft(item.id)}>
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
              <button type="button" className="secondary-button" onClick={() => setIsModalOpen(true)}>Tüm Taslakları Gör ({drafts.length})</button>
              <button type="button" className="primary-button" onClick={handleNotifySelf} disabled={sendingNotification}>
                <Bell size={18} /> {sendingNotification ? 'İletiliyor...' : 'Taslakları Onaya İlet'}
              </button>
            </div>
          </div>
        )}
      </section>

      {message && (
        <div style={{ padding: '12px', borderRadius: '12px', background: message.includes('başarılı') || message.includes('iletildi') ? '#dcfce7' : '#fee2e2', color: message.includes('başarılı') || message.includes('iletildi') ? '#166534' : '#991b1b', fontSize: '0.9rem', fontWeight: 600, textAlign: 'center' }}>
          {message}
        </div>
      )}

      {isModalOpen ? (
        <div className="personnel-modal-overlay" role="dialog" aria-modal="true">
          <div className="personnel-modal-card personnel-draft-modal">
            <header className="personnel-modal-header personnel-draft-modal-header">
              <div className="personnel-draft-modal-title-wrap">
                <span className="personnel-draft-modal-title-icon"><PackageCheck size={18} /></span>
                <div>
                  <h3>Sipariş Taslağı</h3>
                  <p>Mobil sipariş taslağındaki ürünleri inceleyebilirsiniz.</p>
                </div>
              </div>
              <button type="button" className="personnel-modal-close" onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </header>

            <div className="personnel-modal-body personnel-draft-modal-body">
              <div className="personnel-draft-summary-card" aria-label="Taslak özeti">
                <div className="personnel-draft-summary-cell">
                  <span>Toplam Ürün</span>
                  <strong>{drafts.length}</strong>
                </div>
                <div className="personnel-draft-summary-divider" />
                <div className="personnel-draft-summary-cell">
                  <span>Toplam Adet</span>
                  <strong>{draftSummary.totalQty}</strong>
                </div>
              </div>

              <div className="personnel-draft-list-wrap">
                <strong className="personnel-draft-list-title">Sipariş Listesi</strong>
                <ul className="personnel-draft-list">
                  {drafts.map((item) => (
                    <li key={item.id} className="personnel-draft-line-card">
                      <div className="personnel-draft-line-main">
                        <strong className="personnel-draft-line-name">{item.productName}</strong>
                        <span className="personnel-draft-line-qty">Sipariş: {item.quantity} {item.unit || 'Adet'}</span>
                        {(item.sku || item.barcode) ? <small className="personnel-draft-line-meta">{item.sku ? `SKU: ${item.sku}` : `Barkod: ${item.barcode}`}</small> : null}
                        {item.note ? <small className="personnel-draft-line-note">Not: {item.note}</small> : null}
                      </div>
                      <div className="personnel-draft-line-pricing">
                        {Number(item.unitPrice || 0) > 0 ? <span>{formatCurrency(Number(item.unitPrice || 0))}</span> : null}
                        {Number(item.unitPrice || 0) > 0 ? <strong>{formatCurrency(Number(item.unitPrice || 0) * Number(item.quantity || 0))}</strong> : null}
                      </div>
                      <button type="button" className="personnel-draft-line-remove" onClick={() => handleRemoveDraft(item.id)}>
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <footer className="personnel-draft-modal-footer">
              <button type="button" className="secondary-button" onClick={() => setIsModalOpen(false)}>Kapat</button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
