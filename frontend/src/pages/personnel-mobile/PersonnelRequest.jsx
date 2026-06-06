import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Search, Send, GitCompareArrows, Boxes, BarChart3, X } from 'lucide-react';
import { getDepotDisplayLabel } from '../../services/productService.js';
import { sectionService } from '../../services/sectionService.js';
import { useAuth } from '../../hooks/useAuth.js';
import { usePersonnelProductSearch } from '../../hooks/usePersonnelProductSearch.js';

function resolveProductName(item) {
  return item?.name || item?.productName || '-';
}

function resolveShelfCode(item) {
  return item?.shelfCode || item?.defaultShelfLocationCode || item?.sectionName || '-';
}

function resolveDepotCode(item) {
  const firstDepot = Array.isArray(item?.depotLocations) ? item.depotLocations[0]?.locationCode : '';
  return getDepotDisplayLabel(firstDepot || item?.defaultWarehouseLocationCode || item?.warehouseLocationCode || '-');
}

function resolveStockBreakdown(item) {
  const summary = item?.stockSummary || {};
  return {
    warehouse: Number(summary.warehouseStock ?? item?.warehouseStock ?? 0) || 0,
    shelf: Number(summary.shelfStock ?? item?.shelfStock ?? 0) || 0,
  };
}

function resolveSourceLocations(item) {
  const depotLocations = Array.isArray(item?.depotLocations) ? item.depotLocations : [];
  const options = depotLocations.map((entry) => String(entry?.locationCode || '').trim()).filter(Boolean);
  const fallback = String(item?.defaultWarehouseLocationCode || item?.warehouseLocationCode || '').trim();
  if (fallback && !options.includes(fallback)) options.unshift(fallback);
  const mappedOptions = options.map((value) => ({ value, label: getDepotDisplayLabel(value) }));
  return mappedOptions.length ? mappedOptions : [{ value: '-', label: '-' }];
}

function parseShelfMeta(code) {
  const value = String(code || '').trim().toUpperCase();
  const match = value.match(/^(\d+)([LR])(\d+)(?:-(\d+))?$/);
  if (!match) return { side: '', shelfNo: '', levelNo: '' };
  return { side: match[2], shelfNo: match[3], levelNo: match[4] || '' };
}

function buildShelfCode({ side, shelfNo, levelNo, seed }) {
  const upperSide = String(side || '').toUpperCase();
  const shelf = String(shelfNo || '').replace(/\D/g, '');
  const level = String(levelNo || '').replace(/\D/g, '');
  const seedPart = String(seed || '').trim().toUpperCase();
  if (!upperSide || !shelf) return '';
  const base = seedPart.match(/^(\d+)/)?.[1] || '1';
  const head = `${base}${upperSide}${shelf}`;
  return level ? `${head}-${level}` : head;
}

function resolveRequestStatusClass(status) {
  const value = String(status || '').trim().toLocaleLowerCase('tr-TR');
  if (value === 'bekliyor') return 'amber';
  if (value === 'tamamlandı') return 'green';
  if (value === 'reddedildi') return 'red';
  return 'neutral';
}

const INITIAL_FORM = {
  sourceLocation: '',
  targetShelfCode: '',
  targetDepotCode: '',
  quantity: 1,
  requestNote: '',
};

export default function PersonnelRequest() {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [requestForm, setRequestForm] = useState(INITIAL_FORM);
  const [transferDirection, setTransferDirection] = useState('warehouse_to_shelf');
  const [resultMessage, setResultMessage] = useState('');
  const [lastTransferSummary, setLastTransferSummary] = useState(null);
  const [recentRequests, setRecentRequests] = useState([]);
  const { results: filteredProducts, isSearching: isProductSearching } = usePersonnelProductSearch(productSearch, { limit: 8 });

  useEffect(() => {
    let mounted = true;
    const loadRecentRequests = async () => {
      try {
        const rows = await sectionService.listTransferRequests({ limit: 8 });
        if (!mounted) return;
        setRecentRequests(Array.isArray(rows) ? rows.slice(0, 8) : []);
      } catch {
        if (!mounted) return;
        setRecentRequests([]);
      }
    };
    void loadRecentRequests();
    return () => {
      mounted = false;
    };
  }, []);

  const sourceLocationOptions = useMemo(() => resolveSourceLocations(selectedProduct), [selectedProduct]);
  const shelfLocationCode = useMemo(() => resolveShelfCode(selectedProduct), [selectedProduct]);
  const defaultDepotCode = useMemo(() => resolveDepotCode(selectedProduct), [selectedProduct]);

  const stock = useMemo(() => resolveStockBreakdown(selectedProduct), [selectedProduct]);
  const maxTransferQty = useMemo(
    () => (transferDirection === 'warehouse_to_shelf' ? Math.max(0, stock.warehouse) : Math.max(0, stock.shelf)),
    [stock.shelf, stock.warehouse, transferDirection]
  );
  const totalQty = useMemo(() => {
    const raw = Number(requestForm.quantity || 0);
    if (!Number.isFinite(raw)) return 1;
    return Math.min(Math.max(1, Math.floor(raw)), Math.max(1, maxTransferQty || 1));
  }, [requestForm.quantity, maxTransferQty]);

  const projectedStock = useMemo(() => {
    if (transferDirection === 'warehouse_to_shelf') {
      return {
        warehouseAfter: Math.max(0, stock.warehouse - totalQty),
        shelfAfter: stock.shelf + totalQty,
      };
    }
    return {
      warehouseAfter: stock.warehouse + totalQty,
      shelfAfter: Math.max(0, stock.shelf - totalQty),
    };
  }, [stock.shelf, stock.warehouse, totalQty, transferDirection]);

  const shelfCapacity = useMemo(() => {
    const fromSummary = Number(selectedProduct?.stockSummary?.shelfCapacity ?? 0);
    const fromProduct = Number(selectedProduct?.shelfCapacity ?? 0);
    return fromSummary || fromProduct || 100;
  }, [selectedProduct]);

  const targetFillRatio = useMemo(() => Math.min(100, Math.round((projectedStock.shelfAfter / Math.max(1, shelfCapacity)) * 100)), [projectedStock.shelfAfter, shelfCapacity]);

  const suggestedSlot = useMemo(() => {
    if (!selectedProduct) return '';
    const parsed = parseShelfMeta(requestForm.targetShelfCode || resolveShelfCode(selectedProduct));
    return buildShelfCode({ side: parsed.side || 'L', shelfNo: parsed.shelfNo || '1', levelNo: parsed.levelNo || '1', seed: resolveShelfCode(selectedProduct) });
  }, [requestForm.targetShelfCode, selectedProduct]);

  const targetShelfName = useMemo(() => {
    if (!requestForm.targetShelfCode) return '-';
    return `Reyon ${requestForm.targetShelfCode}`;
  }, [requestForm.targetShelfCode]);

  const canUseWarehouseToShelf = stock.warehouse > 0;
  const canUseShelfToWarehouse = stock.shelf > 0;

  const handleProductSelect = (product) => {
    const sourceOptions = resolveSourceLocations(product);
    const targetShelfCode = resolveShelfCode(product);
    const targetDepotCode = resolveDepotCode(product);
    setSelectedProduct(product);
    setProductSearch('');
    setRequestForm((prev) => ({
      ...prev,
      sourceLocation: sourceOptions[0]?.value || '-',
      targetShelfCode,
      targetDepotCode,
    }));
  };

  const handleApplySuggestedTarget = () => {
    if (transferDirection === 'warehouse_to_shelf') {
      if (!suggestedSlot) return;
      setRequestForm((prev) => ({ ...prev, targetShelfCode: suggestedSlot }));
      return;
    }
    if (!defaultDepotCode || defaultDepotCode === '-') return;
    setRequestForm((prev) => ({ ...prev, targetDepotCode: defaultDepotCode }));
  };

  const handleUseOriginalSource = () => {
    if (transferDirection === 'warehouse_to_shelf') {
      setRequestForm((prev) => ({ ...prev, sourceLocation: sourceLocationOptions[0]?.value || '-' }));
      return;
    }
    setRequestForm((prev) => ({ ...prev, sourceLocation: shelfLocationCode || '-' }));
  };

  const handleSubmit = async () => {
    if (!selectedProduct || saving) return;
    setSaving(true);
    setResultMessage('');
    try {
      const sectionId = String(selectedProduct.sectionId || '').trim();
      if (!sectionId) throw new Error('Seçilen ürün için reyon bilgisi bulunamadı.');

      const response = await sectionService.createTransferRequest(sectionId, {
        productId: selectedProduct.id,
        quantity: totalQty,
        note: requestForm.requestNote,
        shelfCode: transferDirection === 'warehouse_to_shelf' ? requestForm.targetShelfCode : requestForm.sourceLocation,
        metadata: {
          sourceLocation: requestForm.sourceLocation,
          targetDepotCode: requestForm.targetDepotCode,
          targetShelfCode: requestForm.targetShelfCode,
          transferDirection,
          requestedBy: user?.id || user?.username || 'personel',
        },
      });

      setResultMessage(response?.message || 'Talep başarıyla oluşturuldu.');
      setLastTransferSummary({
        quantity: totalQty,
        direction: transferDirection,
        warehouseAfter: projectedStock.warehouseAfter,
        shelfAfter: projectedStock.shelfAfter,
        fillRatio: targetFillRatio,
      });
      setRecentRequests((current) => [{
        id: response?.id || `${Date.now()}`,
        productName: selectedProduct.productName,
        sectionName: selectedProduct.sectionName || targetShelfName,
        quantity: totalQty,
        createdAt: response?.createdAt || new Date().toISOString(),
        status: response?.status || 'Bekliyor',
      }, ...current].slice(0, 8));
      setRequestForm(INITIAL_FORM);
      setSelectedProduct(null);
    } catch (error) {
      setResultMessage(error?.message || 'Talep oluşturma başarısız.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="personnel-page-stack-tight">
      {!selectedProduct && (
        <section className="personnel-section-card">
          <h3 className="personnel-section-title-emphasized"><Boxes size={18} /> Ürün Seçimi</h3>

          <div style={{ position: 'relative' }}>
            <div className="personnel-search-wrapper">
              <Search size={20} />
              <input
                className="personnel-input"
                placeholder="Ürün ara (ad, barkod, SKU)"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
              />
            </div>

            {filteredProducts.length > 0 && (
              <ul className="autocomplete-dropdown" style={{ top: '100%', marginTop: '4px' }}>
                {filteredProducts.map((item) => (
                  <li key={item.id} onClick={() => handleProductSelect(item)} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                        <strong style={{ fontSize: '0.95rem', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{resolveProductName(item)}</strong>
                        <small style={{ color: '#64748b' }}>Barkod: {item.barcode || '-'} | Depo: {resolveDepotCode(item)} | Reyon: {resolveShelfCode(item)}</small>
                      </div>
                      <ArrowRight size={16} color="#94a3b8" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {isProductSearching && <span style={{ display: 'block', marginTop: '6px', fontSize: '0.8rem', color: '#64748b' }}>Aranıyor...</span>}
          </div>

          <div className="personnel-request-recent-wrap">
            <div className="personnel-request-recent-head">Son Talepler</div>
            {recentRequests.length === 0 ? (
              <div className="personnel-empty-state personnel-empty-state-compact">Henüz talep oluşturulmamış.</div>
            ) : (
              <div className="personnel-list">
                {recentRequests.map((item) => (
                  <div key={item.id} className="personnel-list-card personnel-recent-request-card">
                    <div className="personnel-recent-request-row">
                      <strong>{item.productName || '-'}</strong>
                      <span className={`personnel-badge ${resolveRequestStatusClass(item.status)}`}>{item.status || '-'}</span>
                    </div>
                    <div className="personnel-recent-request-meta">
                      <span>Hedef Reyon: {item.sectionName || item.sectionNumber || '-'}</span>
                      <span>Transfer: {Number(item.quantity || 0)} adet</span>
                      <span>{new Date(item.createdAt || Date.now()).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {selectedProduct && (
        <section className="personnel-section-card" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <strong style={{ fontSize: '1rem', color: '#1e40af' }}>{resolveProductName(selectedProduct)}</strong>
              <span style={{ fontSize: '0.8rem', color: '#3b82f6' }}>Barkod: {selectedProduct.barcode || '-'}</span>
            </div>
            <button type="button" className="ghost-button" style={{ minHeight: '32px', padding: '0 8px', color: '#64748b' }} onClick={() => setSelectedProduct(null)}>
              <X size={18} />
            </button>
          </div>

          <div className="personnel-info-grid personnel-info-grid-compact" style={{ background: '#ffffff' }}>
            <div><span>Mevcut Depo Stok</span><strong>{stock.warehouse}</strong></div>
            <div><span>Mevcut Reyon Stok</span><strong>{stock.shelf}</strong></div>
          </div>
        </section>
      )}

      {selectedProduct ? (
        <section className="personnel-section-card personnel-request-card-tight">
          <h3 className="personnel-section-title-emphasized"><GitCompareArrows size={18} /> Reyon Besleme Talebi</h3>

          <div className="personnel-request-form-stack">
            <div className="personnel-form-group personnel-form-group-tight">
              <span>Transfer Yönü</span>
              <select
                className="personnel-select"
                value={transferDirection}
                onChange={(e) => {
                  const nextDirection = e.target.value;
                  setTransferDirection(nextDirection);
                  setRequestForm((prev) => ({
                    ...prev,
                    sourceLocation: nextDirection === 'warehouse_to_shelf' ?
                      (sourceLocationOptions[0]?.value || '-')
                      : (shelfLocationCode || '-'),
                  }));
                }}
              >
                <option value="warehouse_to_shelf">Depodan Reyona</option>
                <option value="shelf_to_warehouse" disabled={!canUseShelfToWarehouse}>Reyondan Depoya</option>
              </select>
            </div>

            <div className="personnel-form-group personnel-form-group-tight">
              <span>{transferDirection === 'warehouse_to_shelf' ? 'Kaynak Lokasyon (Depo)' : 'Kaynak Reyon Kodu'}</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                {transferDirection === 'warehouse_to_shelf' ? (
                  <select className="personnel-select" style={{ flex: 1 }} value={requestForm.sourceLocation} onChange={(e) => setRequestForm((prev) => ({ ...prev, sourceLocation: e.target.value }))}>
                    {sourceLocationOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                ) : (
                  <input className="personnel-input" style={{ flex: 1 }} placeholder="Örn: 10L3-2" value={requestForm.sourceLocation} onChange={(e) => setRequestForm((prev) => ({ ...prev, sourceLocation: e.target.value.toUpperCase() }))} />
                )}
                <button type="button" className="secondary-button" style={{ whiteSpace: 'nowrap' }} onClick={handleUseOriginalSource}>Doldur</button>
              </div>
            </div>

            {transferDirection === 'warehouse_to_shelf' ? (
              <div className="personnel-form-group personnel-form-group-tight">
                <span>Hedef Reyon Kodu</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input className="personnel-input" style={{ flex: 1 }} placeholder="Örn: 10L3-2" value={requestForm.targetShelfCode} onChange={(e) => setRequestForm((prev) => ({ ...prev, targetShelfCode: e.target.value.toUpperCase() }))} />
                  <button type="button" className="secondary-button" style={{ whiteSpace: 'nowrap' }} onClick={handleApplySuggestedTarget}>Önerilen</button>
                </div>
              </div>
            ) : (
              <div className="personnel-form-group personnel-form-group-tight">
                <span>Hedef Depo Lokasyon Kodu</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input className="personnel-input" style={{ flex: 1 }} placeholder="Örn: D2-R-13-07" value={requestForm.targetDepotCode} onChange={(e) => setRequestForm((prev) => ({ ...prev, targetDepotCode: e.target.value.toUpperCase() }))} />
                  <button type="button" className="secondary-button" style={{ whiteSpace: 'nowrap' }} onClick={handleApplySuggestedTarget}>Önerilen</button>
                </div>
              </div>
            )}

            <div className="personnel-request-dual-grid">
              <div className="personnel-form-group personnel-form-group-tight">
                <span>Transfer Adedi</span>
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, maxTransferQty || 1)}
                  className="personnel-input"
                  placeholder={`1-${Math.max(1, maxTransferQty || 1)}`}
                  value={requestForm.quantity}
                  onChange={(e) => setRequestForm((prev) => ({ ...prev, quantity: e.target.value }))}
                />
              </div>

              <div className="personnel-form-group personnel-form-group-tight">
                <span>Hedef Doluluk</span>
                <input className="personnel-input" style={{ background: '#f8fafc', color: '#16a34a', fontWeight: 700 }} readOnly value={`%${targetFillRatio}`} />
              </div>
            </div>

            <div className="personnel-form-group personnel-form-group-tight">
              <span>Talep Notu</span>
              <textarea className="personnel-input personnel-note-input" rows={2} style={{ resize: 'none' }} value={requestForm.requestNote} onChange={(e) => setRequestForm((prev) => ({ ...prev, requestNote: e.target.value }))} placeholder="Not (opsiyonel)" />
            </div>

            <button
              type="button"
              className="primary-button personnel-btn-block"
              disabled={
                saving
                || !requestForm.sourceLocation
                || (transferDirection === 'warehouse_to_shelf' ? !requestForm.targetShelfCode : !requestForm.targetDepotCode)
                || (transferDirection === 'warehouse_to_shelf' ? !canUseWarehouseToShelf : !canUseShelfToWarehouse)
              }
              onClick={handleSubmit}
            >
              <Send size={18} /> {saving ? 'Gönderiliyor...' : 'Talebi Gönder'}
            </button>
          </div>
        </section>
      ) : null}

      {resultMessage && (
        <div style={{ padding: '12px', borderRadius: '12px', background: resultMessage.includes('başarılı') ? '#dcfce7' : '#fee2e2', color: resultMessage.includes('başarılı') ? '#166534' : '#991b1b', fontSize: '0.9rem', fontWeight: 600, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={16} /> {resultMessage}
        </div>
      )}

      {lastTransferSummary ? (
        <section className="personnel-section-card">
          <h3 className="personnel-section-title-emphasized"><BarChart3 size={18} /> Son Transfer Özeti</h3>
          <div className="personnel-info-grid personnel-info-grid-compact" style={{ background: '#f8fafc' }}>
            <div style={{ gridColumn: '1 / -1', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '2px' }}>
              <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'block' }}>Yön</span>
              <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{lastTransferSummary.direction === 'warehouse_to_shelf' ? 'Depodan Reyona' : 'Reyondan Depoya'}</strong>
            </div>
            <div><span>Değişim Miktarı</span><strong style={{ color: '#3b82f6' }}>{lastTransferSummary.quantity} Adet</strong></div>
            <div><span>Hedef Doluluk</span><strong style={{ color: '#22c55e' }}>%{lastTransferSummary.fillRatio}</strong></div>
            <div><span>Depo Sonrası</span><strong>{lastTransferSummary.warehouseAfter}</strong></div>
            <div><span>Reyon Sonrası</span><strong>{lastTransferSummary.shelfAfter}</strong></div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
