import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Search, AlertTriangle, CheckCircle2, Trash2, Loader, CornerDownRight, Sparkles, Boxes } from 'lucide-react';
import { productService } from '../../../services/productService.js';
import { warehouseService } from '../../../services/warehouseService.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { hasPermission, PERMISSIONS } from '../../../config/permissions.js';

export default function LocationProductAssignmentPanel({
  selectedObject,
  onChangeObject,
  onBack,
}) {
  const { user } = useAuth();
  const canAssign = useMemo(() => hasPermission(user, PERMISSIONS.LOCATION_PRODUCT_ASSIGN), [user]);

  // States
  const [levelsData, setLevelsData] = useState([]);
  const [targetLevel, setTargetLevel] = useState(1);
  const [productToUnassign, setProductToUnassign] = useState(null);
  const [currentProduct, setCurrentProduct] = useState(null);
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // Selected product from search for assignment preview
  const [selectedProductForAssign, setSelectedProductForAssign] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Overwrite confirm prompts
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [showUnassignConfirm, setShowUnassignConfirm] = useState(false);
  const [showDifferentLocationConfirm, setShowDifferentLocationConfirm] = useState(false);

  // Extract metadata from selectedObject
  const objectType = selectedObject?.objectType || '';
  const locationCodeSnapshot = selectedObject?.properties?.locationCodeSnapshot || selectedObject?.locationCodeSnapshot || '';
  const linkedSectionId = selectedObject?.sectionId || selectedObject?.properties?.linkedSectionId || '';
  const linkedWarehouseLocationId = selectedObject?.properties?.linkedWarehouseLocationId || '';
  const linkedProductId = selectedObject?.properties?.linkedProductId || selectedObject?.linkedProductId || '';

  // Shelf coordinates metadata
  const shelfSide = selectedObject?.properties?.shelfSide || selectedObject?.shelfSide || '';
  const shelfNo = selectedObject?.properties?.shelfNo || selectedObject?.shelfNo || '';

  // 1. Debounce Search Input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 320);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 2. Trigger Search
  useEffect(() => {
    if (debouncedSearchQuery.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const searchProducts = async () => {
      try {
        setIsSearching(true);
        setErrorMsg(null);
        const results = await productService.listForLocationManagement({
          search: debouncedSearchQuery,
          limit: 15,
        });
        setSearchResults(results);
      } catch (err) {
        console.error('Ürün arama hatası:', err);
        setErrorMsg('Ürünler aranırken bir hata oluştu.');
      } finally {
        setIsSearching(false);
      }
    };

    searchProducts();
  }, [debouncedSearchQuery]);

  // 3. Load Current Product details on selected object mount/change
  const loadCurrentProduct = async () => {
    if (!locationCodeSnapshot) return;

    try {
      setIsLoadingCurrent(true);
      setErrorMsg(null);
      setLevelsData([]);

      const levelCount = Number(selectedObject?.metadata?.levelCount || selectedObject?.properties?.levelCount || (objectType === 'warehouse_location' ? 10 : 5));

      if (objectType === 'shelf') {
        const sSide = selectedObject?.properties?.shelfSide || selectedObject?.shelfSide || selectedObject?.metadata?.shelfSide || 'L';
        const sNo = selectedObject?.properties?.shelfNo || selectedObject?.shelfNo || selectedObject?.metadata?.shelfNo || '01';
        const sId = selectedObject?.sectionId || selectedObject?.properties?.linkedSectionId || selectedObject?.metadata?.sectionId || '';

        if (!sId) {
          setErrorMsg('Bu rafın bağlı olduğu bir reyon tanımlı değil.');
          setIsLoadingCurrent(false);
          return;
        }

        const products = await productService.listForLocationManagement({
          sectionId: sId,
          forceRefresh: true,
        });

        // Filter products for this stack
        const matches = products.filter(
          (p) =>
            String(p.shelfSide).toUpperCase() === String(sSide).toUpperCase() &&
            Number(p.shelfNo) === Number(sNo)
        );

        // Map levels 1 to levelCount
        const baseCode = locationCodeSnapshot || '';
        const list = Array.from({ length: levelCount }, (_, idx) => {
          const levelNo = idx + 1;
          const levelProducts = matches.filter((p) => Number(p.shelfLevel) === levelNo);
          return {
            levelNo,
            shelfCode: `${baseCode}-${String(levelNo).padStart(2, '0')}`,
            products: levelProducts,
          };
        });
        setLevelsData(list);
      } else if (objectType === 'warehouse_location') {
        const wRow = selectedObject?.metadata?.rowNo || selectedObject?.properties?.rowNo;
        const wSide = selectedObject?.metadata?.side || selectedObject?.properties?.side || selectedObject?.metadata?.shelfSide || selectedObject?.properties?.shelfSide || 'L';
        const wShelf = selectedObject?.metadata?.shelfNo || selectedObject?.properties?.shelfNo || '01';

        const response = await warehouseService.listLocations({ forceRefresh: true });
        const matchedLocations = (response?.rows || []).filter(
          (r) =>
            Number(r.rowNo) === Number(wRow) &&
            String(r.side).toUpperCase() === String(wSide).toUpperCase() &&
            Number(r.shelfNo) === Number(wShelf)
        );

        const list = Array.from({ length: levelCount }, (_, idx) => {
          const levelNo = idx + 1;
          const loc = matchedLocations.find((l) => Number(l.levelNo) === levelNo);
          
          const levelProducts = [];
          if (loc && loc.productId) {
            levelProducts.push({
              id: loc.productId,
              name: loc.productName || 'Ürün',
              sku: loc.sku || '',
              barcode: loc.barcode || '',
              warehouseStock: loc.warehouseStock || 0,
              shelfStock: 0,
              unit: 'Adet',
              warehouseLocationId: loc.id,
              warehouseLocationCode: loc.locationCode,
            });
          }

          return {
            levelNo,
            shelfCode: loc?.locationCode || `D${wRow}-${wSide}-${String(wShelf).padStart(2, '0')}-${String(levelNo).padStart(2, '0')}`,
            warehouseLocationId: loc?.id,
            products: levelProducts,
          };
        });
        setLevelsData(list);
      }
    } catch (err) {
      console.error('Stack ürünleri yüklenemedi:', err);
      setErrorMsg('Bu konumdaki katların ürün bilgileri yüklenemedi.');
    } finally {
      setIsLoadingCurrent(false);
    }
  };

  useEffect(() => {
    loadCurrentProduct();
    setSelectedProductForAssign(null);
    setSearchQuery('');
    setSuccessMsg(null);
    setErrorMsg(null);
    setShowOverwriteConfirm(false);
    setShowUnassignConfirm(false);
    setShowDifferentLocationConfirm(false);
    setTargetLevel(1);
    setProductToUnassign(null);
  }, [selectedObject?.id]);

  // Set currentProduct based on targetLevel and levelsData for overwrite conflict checks
  useEffect(() => {
    const targetLvlData = levelsData.find((lvl) => lvl.levelNo === targetLevel);
    const existingProductOnLevel = targetLvlData?.products?.[0] || null;
    setCurrentProduct(existingProductOnLevel);
  }, [targetLevel, levelsData]);

  // 4. Clean Turkish text warnings
  const locationTypeLabel = useMemo(() => {
    if (objectType === 'shelf') return 'Raf / Göz Hücresi';
    if (objectType === 'warehouse_location') return 'Depo Lokasyonu';
    return 'Lokasyon';
  }, [objectType]);

  // 5. Handle Assignment Action
  const handleAssign = async (replace = false) => {
    if (!selectedProductForAssign || !canAssign) return;

    const targetLvlData = levelsData.find((lvl) => lvl.levelNo === targetLevel);
    const existingProductOnLevel = targetLvlData?.products?.[0] || null;

    // Check conflict (overwrite) if not confirmed yet
    if (!replace) {
      // Conflict Case 1: Target location already has another product
      if (existingProductOnLevel && existingProductOnLevel.id !== selectedProductForAssign.id) {
        setShowOverwriteConfirm(true);
        return;
      }

      // Conflict Case 2: Selected product is already at another location
      const isAlreadyOnOtherLocation =
        selectedProductForAssign.sectionId ||
        selectedProductForAssign.depotLocationCode;
      
      const isSameLocation =
        objectType === 'shelf'
          ? (selectedProductForAssign.sectionId === linkedSectionId &&
             selectedProductForAssign.shelfSide === shelfSide &&
             Number(selectedProductForAssign.shelfNo) === Number(shelfNo) &&
             Number(selectedProductForAssign.shelfLevel) === targetLevel)
          : (selectedProductForAssign.depotLocationCode === targetLvlData?.shelfCode);

      if (isAlreadyOnOtherLocation && !isSameLocation) {
        setShowDifferentLocationConfirm(true);
        return;
      }

      // If already on this exact location, tell the user
      if (isSameLocation) {
        setErrorMsg('Bu ürün zaten bu lokasyonda tanımlı.');
        return;
      }
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const payload = {
        targetType: objectType === 'shelf' ? 'section_shelf' : 'warehouse_location',
        sectionId: objectType === 'shelf' ? linkedSectionId : undefined,
        shelfSide: objectType === 'shelf' ? shelfSide : undefined,
        shelfNo: objectType === 'shelf' ? shelfNo : undefined,
        shelfLevel: objectType === 'shelf' ? targetLevel : undefined,
        warehouseLocationCode: objectType === 'warehouse_location' ? targetLvlData?.shelfCode : undefined,
        warehouseLocationId: objectType === 'warehouse_location' ? targetLvlData?.warehouseLocationId : undefined,
        replaceExisting: true, // we confirmed through UI prompts
        expectedCurrentProductId: existingProductOnLevel ? existingProductOnLevel.id : null,
      };

      await productService.assignLocation(selectedProductForAssign.id, payload);

      // Success
      setSuccessMsg('Ürün lokasyona atandı.');
      
      // Update local selected object linkedProductId metadata so UI stays in sync
      if (onChangeObject) {
        const updatedObject = {
          ...selectedObject,
          properties: {
            ...(selectedObject.properties || {}),
            linkedProductId: selectedProductForAssign.id,
          },
        };
        onChangeObject(updatedObject);
      }

      // Clean UI states
      setSelectedProductForAssign(null);
      setSearchQuery('');
      setShowOverwriteConfirm(false);
      setShowDifferentLocationConfirm(false);
      
      // Reload current product details
      await loadCurrentProduct();
    } catch (err) {
      console.error('Lokasyon atama hatası:', err);
      setErrorMsg(err.message || 'Ürün lokasyona atanamadı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 6. Handle Unassign Action
  const handleUnassign = async () => {
    if (!productToUnassign || !canAssign) return;

    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      await productService.assignLocation(productToUnassign.id, {
        targetType: 'unassign',
      });

      setSuccessMsg('Atama kaldırıldı.');

      // Update layout in-memory metadata
      if (onChangeObject) {
        const updatedObject = {
          ...selectedObject,
          properties: {
            ...(selectedObject.properties || {}),
            linkedProductId: null,
          },
        };
        onChangeObject(updatedObject);
      }

      setShowUnassignConfirm(false);
      setProductToUnassign(null);
      await loadCurrentProduct();
    } catch (err) {
      console.error('Atama kaldırma hatası:', err);
      setErrorMsg(err.message || 'Atama kaldırılamadı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!locationCodeSnapshot) {
    return (
      <div className="lm-properties-assignment-panel empty">
        <AlertTriangle size={20} className="lm-properties-warning-icon" />
        <p>Bu alan ürün atamaya uygun değil.</p>
        <button className="lm-properties-back-btn" onClick={onBack}>
          <ArrowLeft size={14} /> Özelliklere Dön
        </button>
      </div>
    );
  }

  return (
    <div className="lm-properties-assignment-panel">
      {/* Header */}
      <header className="lm-assignment-panel-header">
        <button className="lm-assignment-back-btn" onClick={onBack} title="Geri">
          <ArrowLeft size={16} />
          <span>Özellikler</span>
        </button>
        <h4>Ürün Yerleşimi</h4>
        <div className="lm-assignment-badge-container">
          <span className="lm-assignment-type-badge">{locationTypeLabel}</span>
          <span className="lm-assignment-code-badge">{locationCodeSnapshot}</span>
        </div>
      </header>

      <div className="lm-assignment-panel-scroll">
        {/* Messages */}
        {errorMsg && (
          <div className="lm-assignment-alert error">
            <AlertTriangle size={14} />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="lm-assignment-alert success">
            <CheckCircle2 size={14} />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="lm-assignment-info-notice-card">
          <h5>⚠️ Canlı Operasyonel İşlem</h5>
          <p>Bu işlem görsel plan taslağından bağımsızdır. Ürün ataması kaydedildiği anda operasyonel lokasyon güncellenir.</p>
          <ul>
            <li>Stok miktarı değişmez; yalnızca ürünün raf/depo konumu güncellenir.</li>
            <li>Plan düzenlemelerini iptal etseniz bile ürün ataması korunur.</li>
          </ul>
        </div>

        {/* 1. MEVCUT ATANMIŞ ÜRÜNLER (KATLAR) */}
        <section className="lm-assignment-section">
          <h5>Mevcut Atanmış Ürünler</h5>
          {isLoadingCurrent ? (
            <div className="lm-assignment-loader">
              <Loader className="spinner" size={18} />
              <span>Yükleniyor...</span>
            </div>
          ) : levelsData.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {levelsData.map((lvl) => (
                <div
                  key={lvl.levelNo}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#f8fafc',
                    fontSize: '0.74rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong style={{ color: '#1e293b' }}>Kat {lvl.levelNo}</strong>
                    <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>{lvl.shelfCode}</span>
                  </div>
                  {lvl.products.length === 0 ? (
                    <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Boş</span>
                  ) : (
                    lvl.products.map((prod) => (
                      <div
                        key={prod.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          borderTop: '1px dashed #e2e8f0',
                          paddingTop: '6px',
                          marginTop: '4px',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>{prod.name}</span>
                        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>
                          SKU: {prod.sku} | Barkod: {prod.barcode || '-'}
                        </span>
                        {prod.shelfStock !== undefined && (
                          <div style={{ display: 'flex', gap: '8px', color: '#475569', fontSize: '0.7rem' }}>
                            <span>Raf Stok: <strong>{prod.shelfStock}</strong></span>
                            <span>Depo Stok: <strong>{prod.warehouseStock}</strong></span>
                          </div>
                        )}
                        {canAssign && (
                          <button
                            type="button"
                            className="lm-assignment-unassign-btn"
                            onClick={() => {
                              setProductToUnassign(prod);
                              setShowUnassignConfirm(true);
                            }}
                            disabled={isSubmitting}
                            style={{
                              alignSelf: 'flex-end',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 6px',
                              fontSize: '0.68rem',
                              color: '#ef4444',
                              border: '1px solid #fee2e2',
                              borderRadius: '4px',
                              backgroundColor: '#fef2f2',
                              cursor: 'pointer',
                              marginTop: '2px',
                            }}
                          >
                            <Trash2 size={12} /> Atamayı Kaldır
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="lm-assignment-empty-card">
              <span>Bu lokasyonda şu anda ürün tanımlı değil.</span>
            </div>
          )}
        </section>

        {/* 2. SEARCH & ASSIGN NEW PRODUCT */}
        {canAssign ? (
          <section className="lm-assignment-section">
            <h5>Yeni Ürün Ata</h5>
            
            {/* Search Box */}
            <div className="lm-assignment-search-box">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder="Ürün adı, SKU veya barkod ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={isSubmitting}
              />
              {isSearching && <Loader className="spinner search-loading" size={12} />}
            </div>

            {/* Results List */}
            {searchResults.length > 0 && (
              <ul className="lm-assignment-results-list">
                {searchResults.map((prod) => (
                  <li
                    key={prod.id}
                    className={`lm-assignment-result-item ${selectedProductForAssign?.id === prod.id ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedProductForAssign(prod);
                      setShowOverwriteConfirm(false);
                      setShowDifferentLocationConfirm(false);
                      setErrorMsg(null);
                    }}
                  >
                    <div className="result-text">
                      <span className="result-name">{prod.name}</span>
                      <span className="result-meta">SKU: {prod.sku} | Barkod: {prod.barcode || '-'}</span>
                      <span className="result-meta">Brand: {prod.brand || '-'} | Stok: {prod.totalStock ?? 0} {prod.unit || 'Adet'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {searchQuery.trim().length >= 2 && searchResults.length === 0 && !isSearching && (
              <div className="lm-assignment-no-results">
                Aramanıza uygun ürün bulunamadı.
              </div>
            )}

            {/* Assignment Preview & Confirmations */}
            {selectedProductForAssign && (
              <div className="lm-assignment-preview-card">
                <div className="preview-header">
                  <Sparkles size={14} className="preview-sparkle" />
                  <span>Seçilen Ürün Önizlemesi</span>
                </div>
                <div className="preview-body">
                  <strong>{selectedProductForAssign.name}</strong>
                  <span>SKU: {selectedProductForAssign.sku}</span>
                </div>

                <label className="lm-assignment-level-select-label" style={{ marginTop: '12px', display: 'block' }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '4px' }}>
                    Hedef Kat / Seviye
                  </span>
                  <select
                    value={targetLevel}
                    onChange={(e) => setTargetLevel(Number(e.target.value))}
                    className="lm-assignment-level-select"
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.74rem',
                      backgroundColor: '#fff',
                    }}
                  >
                    {levelsData.map((lvl) => (
                      <option key={lvl.levelNo} value={lvl.levelNo}>
                        Kat {lvl.levelNo} {lvl.products.length > 0 ? `(${lvl.products.map(p => p.name).join(', ')})` : '(Boş)'}
                      </option>
                    ))}
                  </select>
                </label>

                {/* Conflict: Target Overwrite Warning */}
                {showOverwriteConfirm && (
                  <div className="lm-assignment-warning-box">
                    <AlertTriangle size={16} />
                    <div>
                      <h6>Mevcut Ürün Üzerine Yazma Uyarısı</h6>
                      <p>
                        Hedef lokasyondaki mevcut ürün (<strong>{currentProduct?.name}</strong>) kaldırılacak ve yerine yeni ürün (<strong>{selectedProductForAssign.name}</strong>) atanacaktır.
                      </p>
                      <p style={{ marginTop: '4px', fontWeight: 'bold' }}>
                        ⚠️ Stok miktarı değişmez. Bu işlem, layout kaydından bağımsız, canlı bir operasyonel işlemdir.
                      </p>
                    </div>
                  </div>
                )}

                {/* Conflict: Selected Product exists elsewhere warning */}
                {showDifferentLocationConfirm && (
                  <div className="lm-assignment-warning-box">
                    <AlertTriangle size={16} />
                    <div>
                      <h6>Ürün Konum Değişikliği (Relocation) Uyarısı</h6>
                      <p>
                        Seçilen ürün (<strong>{selectedProductForAssign.name}</strong>) şu anda başka bir lokasyonda (<strong>{selectedProductForAssign.shelfCode || selectedProductForAssign.depotLocationCode || 'Bilinmeyen'}</strong>) tanımlıdır.
                      </p>
                      <p>
                        Ürün eski konumundan sökülecek ve yeni konuma (<strong>{locationCodeSnapshot}</strong>) atanacaktır.
                      </p>
                      <p style={{ marginTop: '4px', fontWeight: 'bold' }}>
                        ⚠️ Stok miktarı değişmez. Bu işlem, layout kaydından bağımsız, canlı bir operasyonel işlemdir.
                      </p>
                    </div>
                  </div>
                )}

                <div className="lm-assignment-info-notice">
                  <p>⚠️ Bu işlem ürünün operasyonel lokasyon bilgisini günceller; stok miktarını değiştirmez. Görsel taslaktan bağımsızdır.</p>
                </div>

                <div className="lm-assignment-preview-actions">
                  <button
                    type="button"
                    className="lm-assignment-confirm-btn"
                    onClick={() => handleAssign(showOverwriteConfirm || showDifferentLocationConfirm)}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Atanıyor...' : 'Atamayı Onayla'}
                  </button>
                  <button
                    type="button"
                    className="lm-assignment-cancel-btn"
                    onClick={() => {
                      setSelectedProductForAssign(null);
                      setShowOverwriteConfirm(false);
                      setShowDifferentLocationConfirm(false);
                    }}
                    disabled={isSubmitting}
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : (
          <div className="lm-assignment-unauthorized">
            <span>Ürün atama yetkiniz bulunmamaktadır.</span>
          </div>
        )}
      </div>

      {/* Unassign Confirmation Overlay Modal/Strip */}
      {showUnassignConfirm && (
        <div className="lm-assignment-dialog-overlay">
          <div className="lm-assignment-dialog">
            <h5>Atamayı Kaldır?</h5>
            <p>
              <strong>{productToUnassign?.name}</strong> ürününü bu lokasyondan sökmek istediğinize emin misiniz? Operasyonel verilerde ürün yerleşimsiz duruma gelecektir.
            </p>
            <p style={{ marginTop: '8px', fontSize: '0.74rem', color: '#64748b' }}>
              ⚠️ Stok miktarı değişmez. Bu işlem, layout kaydından bağımsız, canlı bir operasyonel işlemdir.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn-danger"
                onClick={handleUnassign}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Kaldırılıyor...' : 'Evet, Atamayı Kaldır'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setShowUnassignConfirm(false);
                  setProductToUnassign(null);
                }}
                disabled={isSubmitting}
              >
                Vazgeç
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
