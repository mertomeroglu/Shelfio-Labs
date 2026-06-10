import React, { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Layers, Info, Trash2, Edit, Search, ListChecks, Clock3, Shuffle, X, RotateCw } from 'lucide-react';
import LocationPlanCanvas from './LocationPlanCanvas.jsx';
import StatusBadge from '../../../components/StatusBadge.jsx';
import { collapseLayoutItemsForPlan, resolveLayoutBoundaries } from '../../../services/locationLayoutService.js';

const stripEmojis = (str) => {
  if (!str) return '';
  return str
    .replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F900}-\u{1F9FF}\u{1F300}-\u{1F5FF}\u{1F500}-\u{1F5FF}\u{2702}-\u{27B0}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2900}-\u{297F}]/gu, '')
    .trim();
};

const statusTone = (value) => {
  if (value === 'Kritik') return 'danger';
  if (value === 'Dolu') return 'success';
  if (value === 'Boş' || value === 'Bos') return 'neutral';
  return 'neutral';
};

const isEmptyStatus = (value) => value === 'Bos' || value === 'Boş';
const statusLabel = (value) => (value === 'Bos' ? 'Boş' : value);

const formatNumber = (value) => {
  if (value === undefined || value === null) return '-';
  return Number(value).toLocaleString('tr-TR');
};

const storageTypeLabel = (value) => {
  if (value === 'cold_chain') return 'Soğuk Zincir';
  if (value === 'freezer') return 'Dondurucu / Donuk';
  return 'Ortam Sıcaklığı';
};

const storageToneClass = (value) => {
  if (value === 'cold_chain') return 'is-cold';
  if (value === 'freezer') return 'is-freezer';
  return 'is-Ortam';
};

const locationDisplayLabel = (value) => {
  if (!value) return '-';
  return value;
};

const FILTER_OPTIONS = [
  { key: 'all', label: 'Tümü' },
  { key: 'section', label: 'Reyonlar' },
  { key: 'shelf', label: 'Raflar' },
  { key: 'warehouse_location', label: 'Depolar' },
  { key: 'cashier', label: 'Kasalar' },
  { key: 'entrance', label: 'Kapılar' },
  { key: 'aisle', label: 'Koridorlar' },
  { key: 'service_area', label: 'Diğer' },
];

const FILTER_MAPPING = {
  section: ['section', 'section_common_area'],
  warehouse_location: ['warehouse_location', 'warehouse_common_area'],
  entrance: ['entrance', 'exit', 'warehouse_door'],
  service_area: ['service_area', 'empty_area', 'custom', 'campaign_stand', 'zone'],
};

const OBJECT_TYPE_LABELS = {
  section: 'Reyon',
  shelf: 'Raf',
  shelf_stack: 'Raf',
  warehouse_location: 'Depo Lokasyonu',
  warehouse_stack: 'Depo Lokasyonu',
  section_common_area: 'Ortak Reyon Alanı',
  warehouse_common_area: 'Ortak Depo Alanı',
  cashier: 'Kasa',
  entrance: 'Giriş',
  exit: 'Çıkış',
  warehouse_door: 'Depo Kapısı',
  service_area: 'Servis Alanı',
  aisle: 'Koridor',
  empty_area: 'Boş Alan',
  zone: 'Bölge',
  custom: 'Özel Alan',
};

const normalizeObjectType = (objectType) => {
  if (objectType === 'shelf_stack') return 'shelf';
  if (objectType === 'warehouse_stack') return 'warehouse_location';
  return objectType || 'custom';
};

const objectTypeLabel = (objectType) => OBJECT_TYPE_LABELS[objectType] || OBJECT_TYPE_LABELS[normalizeObjectType(objectType)] || objectType || 'Alan';

const OBJECT_TYPE_DESCRIPTIONS = {
  section: 'Fiziksel reyon alanı; bağlı raf ve ortak ürün özetini gösterir.',
  shelf: 'Reyona bağlı raf modülü; kat bazında ürün yerleşimini gösterir.',
  shelf_stack: 'Reyona bağlı raf modülü; kat bazında ürün yerleşimini gösterir.',
  warehouse_location: 'Depo lokasyonu; kat/doluluk ve ürün seviyelerini gösterir.',
  warehouse_stack: 'Depo lokasyonu; kat/doluluk ve ürün seviyelerini gösterir.',
  section_common_area: 'Reyona bağlı ortak ürün alanı; fiziksel raf gözü işgal etmez.',
  warehouse_common_area: 'Depo ortak ürün alanı; depo ürünlerini ortak havuzda listeler.',
  cashier: 'Ödeme noktası ve müşteri akışı alanı.',
  service_area: 'Danışma veya müşteri hizmetleri alanı.',
  entrance: 'Mağaza giriş akış noktası.',
  exit: 'Mağaza çıkış akış noktası.',
  warehouse_door: 'Depo erişim kapısı ve operasyon geçiş noktası.',
  aisle: 'Plan içi dolaşım koridoru.',
  empty_area: 'Kullanıma ayrılmış boş plan alanı.',
  zone: 'Plan üzerinde gruplayıcı bölge.',
  custom: 'Özel tanımlı operasyon alanı.',
};

const objectDescription = (objectType) => (
  OBJECT_TYPE_DESCRIPTIONS[objectType]
  || OBJECT_TYPE_DESCRIPTIONS[normalizeObjectType(objectType)]
  || 'Plan üzerinde tanımlı operasyon alanı.'
);

const fieldValue = (...values) => {
  const found = values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return found === undefined ? '-' : found;
};

const resolveSectionId = (obj) => (
  obj?.metadata?.sectionId
  || obj?.sectionId
  || obj?.linkedSectionId
  || obj?.properties?.linkedSectionId
  || obj?.metadata?.linkedSectionId
  || obj?.properties?.sectionId
  || null
);

const isGenericSectionCommonAreaLabel = (label) => {
  const normalized = String(label || '').trim().toLocaleLowerCase('tr-TR');
  return !normalized
    || normalized === 'ortak reyon'
    || normalized === 'ortak reyon alanı'
    || normalized === 'section_common_area';
};

const objectDisplayTitle = (obj) => {
  if (!obj) return 'Alan Detayları';
  const metadata = obj.metadata || {};
  const cleanLabel = stripEmojis(obj.label);
  if (obj.objectType === 'section_common_area') {
    if (!isGenericSectionCommonAreaLabel(cleanLabel)) return cleanLabel;
    return metadata.sectionName ? `${metadata.sectionName} Ortak Alanı` : 'Ortak Reyon Alanı';
  }
  return cleanLabel || metadata.sectionName || objectTypeLabel(obj.objectType);
};

export default function LocationPlanSection({
  layout = null,
  isLoading = false,
  error = null,
  onRefresh = () => {},
  canManage = false,
  onOpenEditor = () => {},
  selectedLocationCode = '',
  onSelectLocationCode = () => {},
  products = [],
  // Details Panel Props
  selectedLocation = null,
  onMove = () => {},
  onCreateRefillRequest = () => {},
  onViewMovements = () => {},
  onViewRefillHistory = () => {},
  onMoveSlot = () => {},
  // Shared filter state
  activeFilters = null,
  setActiveFilters = null,
  // Layout integration
  hideHeader = false,
  hideEditButton = false,
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitTrigger, setFitTrigger] = useState(0);
  const [planRotation, setPlanRotation] = useState(0);
  const [selectedPlanObjectId, setSelectedPlanObjectId] = useState('');
  
  const [localActiveFilters, setLocalActiveFilters] = useState(new Set());
  const actualActiveFilters = activeFilters || localActiveFilters;
  const actualSetActiveFilters = setActiveFilters || setLocalActiveFilters;

  const [barcodeSearch, setBarcodeSearch] = useState('');
  const [searchMessage, setSearchMessage] = useState(null);
  const [highlightedObjectId, setHighlightedObjectId] = useState(null);
  const searchTimeoutRef = useRef(null);
  const msgTimeoutRef = useRef(null);

  const items = useMemo(
    () => collapseLayoutItemsForPlan(layout?.items || []),
    [layout?.items]
  );
  const boundaries = useMemo(
    () => resolveLayoutBoundaries(layout, items),
    [items, layout]
  );

  // Resolve visible types based on checked filters
  const visibleTypes = useMemo(() => {
    const types = new Set();
    if (actualActiveFilters.size === 0) return types; // Empty active filters means show all

    actualActiveFilters.forEach((filterKey) => {
      const mapped = FILTER_MAPPING[filterKey];
      if (mapped) {
        mapped.forEach((t) => types.add(t));
      } else {
        types.add(filterKey);
      }
    });
    return types;
  }, [actualActiveFilters]);

  const selectedObject = useMemo(() => {
    if (selectedPlanObjectId) {
      const selectedById = items.find((item) => String(item.id) === String(selectedPlanObjectId));
      if (selectedById) return selectedById;
    }
    if (!selectedLocationCode) return null;
    return items.find((item) => (
      item.locationCodeSnapshot === selectedLocationCode
      || item.metadata?.levels?.some((level) => level.shelfCode === selectedLocationCode)
    )) || null;
  }, [items, selectedLocationCode, selectedPlanObjectId]);

  useEffect(() => {
    if (!selectedPlanObjectId || visibleTypes.size === 0) return;
    const selectedItem = items.find((item) => String(item.id) === String(selectedPlanObjectId));
    if (selectedItem && !visibleTypes.has(selectedItem.objectType)) {
      setSelectedPlanObjectId('');
    }
  }, [items, selectedPlanObjectId, visibleTypes]);

  const selectedSectionSummary = useMemo(() => {
    if (selectedObject?.objectType !== 'section') return null;
    const sectionId = resolveSectionId(selectedObject);
    const sectionItems = sectionId ? items.filter((item) => (
      item.id !== selectedObject.id
      && String(resolveSectionId(item) || '') === String(sectionId)
    )) : [];
    const shelfStacks = sectionItems.filter((item) => item.objectType === 'shelf');
    const levels = shelfStacks.flatMap((item) => item.metadata?.levels || []);
    const occupiedLevels = levels.filter((level) => (
      (level.products || []).length > 0 || Number(level.occupancy || 0) > 0
    ));
    const commonArea = sectionItems.find((item) => item.objectType === 'section_common_area');
    return {
      shelfCount: shelfStacks.length,
      levelCount: levels.length,
      occupiedLevelCount: occupiedLevels.length,
      productCount: levels.reduce(
        (total, level) => total + (level.products || []).length,
        Number(commonArea?.metadata?.commonProductCount || 0)
      ),
    };
  }, [items, selectedObject]);

  useEffect(() => {
    if (!selectedLocationCode) return;
    const matchingItem = items.find((item) => (
      item.locationCodeSnapshot === selectedLocationCode
      || item.metadata?.levels?.some((level) => level.shelfCode === selectedLocationCode)
    ));
    if (matchingItem) setSelectedPlanObjectId(matchingItem.id);
  }, [items, selectedLocationCode]);

  const findLayoutItemByBarcode = (searchText, layoutItems, productList) => {
    const cleanSearch = String(searchText || '').trim();
    if (!cleanSearch) return null;

    // 1. Find product by barcode or SKU
    const matchedProduct = productList.find(
      (p) => String(p.barcode || '').trim() === cleanSearch || String(p.sku || '').trim() === cleanSearch
    );

    // 2. If product found, try to match by its assigned location or IDs
    if (matchedProduct) {
      let matchedItem = layoutItems.find(
        (item) => String(item.metadata?.productId || '') === String(matchedProduct.id)
          || item.metadata?.levels?.some((level) => (
            level.products || []
          ).some((product) => String(product.id) === String(matchedProduct.id)))
      );
      if (matchedItem) return matchedItem;

      matchedItem = layoutItems.find(
        (item) => String(item.metadata?.sku || '').trim() === String(matchedProduct.sku || '').trim()
          || item.metadata?.levels?.some((level) => (
            level.products || []
          ).some((product) => String(product.sku || '').trim() === String(matchedProduct.sku || '').trim()))
      );
      if (matchedItem) return matchedItem;

      if (matchedProduct.sectionId) {
        matchedItem = layoutItems.find(
          (item) => item.objectType === 'shelf' && String(resolveSectionId(item) || '') === String(matchedProduct.sectionId)
        );
        if (matchedItem) return matchedItem;

        matchedItem = layoutItems.find(
          (item) => item.objectType === 'section' && String(resolveSectionId(item) || '') === String(matchedProduct.sectionId)
        );
        if (matchedItem) return matchedItem;
      }
    }

    // 3. Direct matching on layout items metadata (direct SKU match)
    let matchedItem = layoutItems.find(
      (item) => String(item.metadata?.sku || '').trim() === cleanSearch
        || item.metadata?.levels?.some((level) => (
          level.products || []
        ).some((product) => String(product.sku || '').trim() === cleanSearch))
    );
    if (matchedItem) return matchedItem;

    matchedItem = layoutItems.find(
      (item) => String(item.metadata?.barcode || '').trim() === cleanSearch
        || item.metadata?.levels?.some((level) => (
          level.products || []
        ).some((product) => String(product.barcode || '').trim() === cleanSearch))
    );
    if (matchedItem) return matchedItem;

    matchedItem = layoutItems.find(
      (item) => String(item.locationCodeSnapshot || '').trim() === cleanSearch
        || item.metadata?.levels?.some((level) => String(level.shelfCode || '').trim() === cleanSearch)
    );
    if (matchedItem) return matchedItem;

    return null;
  };

  const handleBarcodeSearch = () => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);

    const found = findLayoutItemByBarcode(barcodeSearch, items, products);
    if (found) {
      setHighlightedObjectId(found.id);
      setSearchMessage({ type: 'success', text: 'Konum bulundu!' });
      
      msgTimeoutRef.current = setTimeout(() => setSearchMessage(null), 3000);
      searchTimeoutRef.current = setTimeout(() => setHighlightedObjectId(null), 8000);

      handleSelectObject(found);
    } else {
      setHighlightedObjectId(null);
      setSearchMessage({ type: 'error', text: 'Barkoda ait lokasyon bulunamadı' });
      msgTimeoutRef.current = setTimeout(() => setSearchMessage(null), 4000);
    }
  };

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);
    };
  }, []);

  // Handle zooming
  const handleZoomIn = () => setZoom((z) => Math.min(2.5, z + 0.15));
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, z - 0.15));
  
  // Fit layout to screen (reset zoom & pan)
  const handleFit = () => {
    setFitTrigger((prev) => prev + 1);
  };

  const handleRotationChange = (rotation) => {
    setPlanRotation(rotation);
    setFitTrigger((prev) => prev + 1);
  };

  const handleClearSearch = () => {
    setBarcodeSearch('');
    setHighlightedObjectId(null);
    setSearchMessage(null);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (msgTimeoutRef.current) clearTimeout(msgTimeoutRef.current);
  };

  // Toggle filter chip
  const handleToggleFilter = (key) => {
    const next = new Set(actualActiveFilters);
    if (key === 'all') {
      next.clear();
    } else {
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
    }
    actualSetActiveFilters(next);
  };

  const handleSelectObject = useCallback((obj) => {
    setSelectedPlanObjectId(obj?.id || '');
    if (!onSelectLocationCode) return;
    if (!obj) {
      onSelectLocationCode('');
      return;
    }
    const firstOperationalCode = obj.metadata?.levels?.find((level) => level.shelfCode)?.shelfCode;
    onSelectLocationCode(firstOperationalCode || obj.locationCodeSnapshot || '');
  }, [onSelectLocationCode]);

  const renderProductCards = (productRows = [], emptyText = 'Ürün bulunamadı') => (
    (!productRows || productRows.length === 0) ? (
      <p className="lm-plan-product-empty">
        {emptyText}
      </p>
    ) : (
      <div className="lm-plan-common-products-list">
        {productRows.map((prod, index) => (
          <div key={prod.id || `${prod.sku || 'product'}-${index}`} className="lm-plan-common-product-item">
            <div className="lm-plan-common-product-head">
              <span style={{ fontWeight: '600', color: '#1e293b' }}>{prod.name || prod.productName || 'Ürün'}</span>
              {prod.isVirtualLocation && (
                <span className="lm-plan-product-badge">Sanal lokasyon</span>
              )}
            </div>
            <div className="lm-plan-common-product-meta">
              <span>SKU: {prod.sku || '-'}{prod.barcode ? ` | Barkod: ${prod.barcode}` : ''}</span>
              {(prod.shelfQuantity != null || prod.warehouseQuantity != null || prod.quantity != null) ? (
                <span>
                  {prod.shelfQuantity != null ? `Raf: ${prod.shelfQuantity}` : ''}
                  {prod.shelfQuantity != null && prod.warehouseQuantity != null ? ' / ' : ''}
                  {prod.warehouseQuantity != null ? `Depo: ${prod.warehouseQuantity}` : ''}
                  {prod.quantity != null && prod.shelfQuantity == null && prod.warehouseQuantity == null ? `Stok: ${prod.quantity}` : ''}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    )
  );

  const renderLevelList = (levels = [], typeLabel = 'Kat') => (
    <div className="lm-plan-level-list">
      {levels.map((level, index) => {
        const levelProducts = level.products || [];
        const hasUnassignedOccupancy = levelProducts.length === 0
          && (
            Number(level.occupancy || 0) > 0
            || String(level.status || '').toLocaleLowerCase('tr-TR') === 'dolu'
          );
        const levelStateLabel = levelProducts.length
          ? `${levelProducts.length} ürün`
          : hasUnassignedOccupancy ? 'Atanmamış' : 'Boş';
        return (
          <article key={`${level.levelNo || index + 1}-${level.shelfCode || index}`} className="lm-plan-level-item">
            <header>
              <div>
                <strong>{typeLabel} {level.levelNo || index + 1}</strong>
                <span>{level.shelfCode || level.locationCode || '-'}</span>
              </div>
              <span className={levelProducts.length ? 'is-filled' : hasUnassignedOccupancy ? 'is-unassigned' : 'is-empty'}>
                {levelStateLabel}
              </span>
            </header>
            {levelProducts.length > 0 ? (
              <div className="lm-plan-level-products">
                {levelProducts.map((product, productIndex) => (
                  <div key={product.id || `${product.sku || 'level-product'}-${productIndex}`}>
                    <strong>{product.name || product.productName || 'Ürün'}</strong>
                    <span>
                      {product.sku ? `SKU: ${product.sku}` : 'SKU: -'}
                      {product.barcode ? ` · Barkod: ${product.barcode}` : ''}
                    </span>
                    {(product.shelfQuantity != null || product.warehouseQuantity != null || product.quantity != null) && (
                      <span>
                        {product.shelfQuantity != null ? `Raf: ${formatNumber(product.shelfQuantity || 0)}` : ''}
                        {product.shelfQuantity != null && product.warehouseQuantity != null ? ' · ' : ''}
                        {product.warehouseQuantity != null ? `Depo: ${formatNumber(product.warehouseQuantity || 0)}` : ''}
                        {product.quantity != null && product.shelfQuantity == null && product.warehouseQuantity == null ? `Stok: ${formatNumber(product.quantity || 0)}` : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );

  const renderSelectedObjectDetails = () => {
    if (!selectedObject) return null;

    const normalizedType = normalizeObjectType(selectedObject.objectType);
    const metadata = selectedObject.metadata || {};
    const levels = metadata.levels || [];
    const isCommonArea = normalizedType === 'section_common_area' || normalizedType === 'warehouse_common_area';
    const isStack = (normalizedType === 'shelf' || normalizedType === 'warehouse_location') && levels.length > 0;
    const productsInObject = metadata.products || [];
    const sectionId = resolveSectionId(selectedObject);

    if (normalizedType === 'section') {
      return (
        <div className="lm-plan-info-meta-section">
          <h5>Reyon Özeti</h5>
          <div className="lm-plan-info-field"><span>Reyon:</span><strong>{fieldValue(stripEmojis(selectedObject.label), metadata.sectionName, 'Reyon')}</strong></div>
          <div className="lm-plan-info-field"><span>Reyon ID:</span><strong>{fieldValue(sectionId)}</strong></div>
          <div className="lm-plan-info-field"><span>Kod:</span><strong>{fieldValue(selectedObject.locationCodeSnapshot, metadata.sectionNumber, metadata.sectionCode)}</strong></div>
          <div className="lm-plan-info-field"><span>Raf Stack:</span><strong>{selectedSectionSummary?.shelfCount ?? 0}</strong></div>
          <div className="lm-plan-info-field"><span>Toplam Kat:</span><strong>{selectedSectionSummary?.levelCount ?? 0}</strong></div>
          <div className="lm-plan-info-field"><span>Dolu Kat:</span><strong>{selectedSectionSummary?.occupiedLevelCount ?? 0}</strong></div>
          <div className="lm-plan-info-field"><span>Ürün:</span><strong>{selectedSectionSummary?.productCount ?? metadata.productCount ?? 0}</strong></div>
        </div>
      );
    }

    if (isStack) {
      return (
        <div className="lm-plan-stack-details">
          <div className="lm-plan-stack-summary">
            <div>
              <span>Fiziksel Modül</span>
              <strong>{normalizedType === 'shelf' ? 'Raf Stack' : 'Depo Stack'}</strong>
            </div>
            <span className="lm-plan-level-count">{levels.length} Kat</span>
          </div>
          <div className="lm-plan-info-meta-section">
            <h5>{normalizedType === 'shelf' ? 'Raf Bilgisi' : 'Depo Bilgisi'}</h5>
            <div className="lm-plan-info-field"><span>Bağlı Alan:</span><strong>{fieldValue(metadata.sectionName, metadata.sectionId, metadata.rowNo ? `D${metadata.rowNo}` : '')}</strong></div>
            <div className="lm-plan-info-field"><span>Taraf:</span><strong>{fieldValue(metadata.shelfSide, metadata.side)}</strong></div>
            <div className="lm-plan-info-field"><span>Raf:</span><strong>{fieldValue(metadata.shelfNo)}</strong></div>
          </div>
          {renderLevelList(levels)}
        </div>
      );
    }

    if (isCommonArea) {
      return (
        <div className="lm-plan-common-area-details">
          <div className="lm-plan-info-meta-section">
            <h5>Lokasyon Bilgisi</h5>
            {normalizedType === 'section_common_area' ? (
              <div className="lm-plan-info-field">
                <span>Reyon:</span>
                <strong>{fieldValue(metadata.sectionName, selectedObject.locationCodeSnapshot?.split('-')[0])}</strong>
              </div>
            ) : null}
            <div className="lm-plan-info-field"><span>Toplam Ürün:</span><strong>{metadata.commonProductCount ?? productsInObject.length ?? 0} ürün</strong></div>
            <div className="lm-plan-info-field"><span>Fiziksel Durum:</span><strong className="lm-plan-common-badge" style={{ color: '#10b981', fontWeight: '600' }}>Fiziksel göz işgal etmez</strong></div>
          </div>

          <div className="lm-plan-info-meta-section lm-plan-common-products" style={{ borderTop: '1px solid rgba(226, 232, 240, 0.9)', paddingTop: '12px' }}>
            <h5 style={{ marginBottom: '8px' }}>Ortak Alan Ürünleri</h5>
            {renderProductCards(productsInObject, 'Bu alanda ürün yok')}
          </div>
        </div>
      );
    }

    if (selectedLocation) {
      return (
        <>
          <div className="lm-plan-info-meta-section">
            <h5>Lokasyon Bilgisi</h5>
            <div className="lm-plan-info-field"><span>Lokasyon Tipi:</span><strong>{selectedLocation.locationTypeLabel || objectTypeLabel(selectedObject.objectType)}</strong></div>
            <div className="lm-plan-info-field"><span>Alan / Reyon:</span><strong>{selectedLocation.scopeLabel || selectedLocation.scopeName || '-'}</strong></div>
            {selectedLocation.sideLabel && <div className="lm-plan-info-field"><span>Taraf:</span><strong>{selectedLocation.sideLabel}</strong></div>}
            {selectedLocation.shelfNo && <div className="lm-plan-info-field"><span>Raf / Kat:</span><strong>Raf {selectedLocation.shelfNo} / Kat {selectedLocation.levelNo || '-'}</strong></div>}
            <div className="lm-plan-info-field"><span>Durum:</span><strong><StatusBadge tone={statusTone(selectedLocation.status)}>{statusLabel(selectedLocation.status)}</StatusBadge></strong></div>
          </div>

          <div className="lm-plan-info-meta-section">
            <h5>Ürün Bilgisi</h5>
            <div className="lm-plan-info-field"><span>Ürün Adı:</span><strong className="lm-plan-info-product-name">{selectedLocation.productName || '-'}</strong></div>
            <div className="lm-plan-info-field"><span>SKU:</span><strong>{selectedLocation.sku || '-'}</strong></div>
            {selectedLocation.barcode && selectedLocation.barcode !== '-' && <div className="lm-plan-info-field"><span>Barkod:</span><strong>{selectedLocation.barcode}</strong></div>}
            {selectedLocation.categoryName && <div className="lm-plan-info-field"><span>Kategori:</span><strong>{selectedLocation.categoryName}</strong></div>}
            <div className="lm-plan-info-field"><span>Saklama Tipi:</span><strong><span className={`location-chip ${storageToneClass(selectedLocation.storageType)}`}>{storageTypeLabel(selectedLocation.storageType)}</span></strong></div>
          </div>

          <div className="lm-plan-info-meta-section">
            <h5>Operasyonel Durum</h5>
            <div className="lm-plan-info-field"><span>Doluluk Oranı:</span><strong>{selectedLocation.occupancyLabel || '-'}</strong></div>
            <div className="lm-plan-info-field"><span>Mevcut Stok:</span><strong>{selectedLocation.stockLabel || '-'}</strong></div>
            {selectedLocation.capacityLabel && <div className="lm-plan-info-field"><span>Kapasite:</span><strong>{selectedLocation.capacityLabel}</strong></div>}
            {selectedLocation.slotDesiLabel && <div className="lm-plan-info-field"><span>Göz Desisi:</span><strong>{selectedLocation.slotDesiLabel}</strong></div>}
          </div>
        </>
      );
    }

    return (
      <div className="lm-plan-info-meta-section">
        <h5>Alan Bilgisi</h5>
        <div className="lm-plan-info-field"><span>Başlık:</span><strong>{stripEmojis(selectedObject.label) || objectTypeLabel(selectedObject.objectType)}</strong></div>
        <div className="lm-plan-info-field"><span>Tür:</span><strong>{objectTypeLabel(selectedObject.objectType)}</strong></div>
        {sectionId && (
          <div className="lm-plan-info-field"><span>Bağlı Alan ID:</span><strong>{sectionId}</strong></div>
        )}
        <div className="lm-plan-info-field"><span>Açıklama:</span><strong>{fieldValue(metadata.description, selectedObject.properties?.description, objectDescription(selectedObject.objectType))}</strong></div>
        {productsInObject.length ? (
          <div className="lm-plan-info-meta-section lm-plan-common-products">
            <h5>Ürünler</h5>
            {renderProductCards(productsInObject)}
          </div>
        ) : null}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="lm-plan-section loading mod-card">
        <div className="lm-plan-skeleton">
          <span className="loader"></span>
          <p>Mağaza Planı yükleniyor...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="lm-plan-section error mod-card">
        <div className="lm-plan-error-state">
          <h4>Mağaza Planı Yüklenemedi</h4>
          <p>{error?.payload?.message || error?.message || 'Lütfen bağlantınızı veya yetkilerinizi kontrol edip tekrar deneyin.'}</p>
          <button className="secondary-button" type="button" onClick={onRefresh}>
            Yeniden Dene
          </button>
        </div>
      </div>
    );
  }

  if (!layout) return null;

  const { source, name, version } = layout;

  return (
    <section className="lm-plan-section mod-card">
      {!hideHeader && (
        <header className="mod-card-header lm-plan-section-header">
          <div className="lm-plan-title-area">
            <div className="mod-card-icon mod-icon-indigo">
              <Layers size={18} />
            </div>
            <div>
              <h3>Mağaza Planı</h3>
              <p>Reyon, depo ve operasyonel alanları tek planda görüntüleyin.</p>
            </div>
          </div>

          <div className="lm-plan-header-badge-area">
            {canManage && !hideEditButton && (
              <button
                className="primary-button lm-plan-edit-btn"
                type="button"
                onClick={onOpenEditor}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Edit size={14} /> Düzenleme Modu
              </button>
            )}
          </div>
        </header>
      )}

      {/* Toolbar */}
      <div className="lm-plan-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div className="lm-plan-toolbar-controls">
            <button className="ghost-button" type="button" title="Yakınlaştır" onClick={handleZoomIn}>
              <ZoomIn size={16} />
            </button>
            <button className="ghost-button" type="button" title="Uzaklaştır" onClick={handleZoomOut}>
              <ZoomOut size={16} />
            </button>
            <button className="ghost-button" type="button" title="Görünümü Ortala" onClick={handleFit}>
              <Maximize2 size={16} /> Görünümü Sığdır
            </button>
          </div>

          <div className="lm-plan-barcode-search" style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Barkod ile bul..."
                value={barcodeSearch}
                onChange={(e) => setBarcodeSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleBarcodeSearch();
                }}
                className="lm-plan-barcode-input"
                style={{
                  padding: '6px 44px 6px 12px',
                  fontSize: '0.78rem',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  width: '180px',
                  outline: 'none',
                  transition: 'all 0.15s ease',
                }}
              />
              <div style={{ position: 'absolute', right: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {barcodeSearch && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '2px',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title="Temizle"
                  >
                    <X size={12} />
                  </button>
                )}
                <Search size={14} style={{ color: '#64748b', pointerEvents: 'none' }} />
              </div>
            </div>
            {searchMessage && (
              <span className={`lm-plan-search-msg ${searchMessage.type === 'error' ? 'is-error' : 'is-success'}`} style={{
                marginLeft: '10px',
                fontSize: '0.72rem',
                fontWeight: '600',
                color: searchMessage.type === 'error' ? '#ef4444' : '#10b981'
              }}>
                {searchMessage.text}
              </span>
            )}
          </div>
        </div>

        <div className="lm-plan-toolbar-end">
          <div className="lm-plan-rotation-control" aria-label="Görünümü Döndür">
            <span><RotateCw size={13} /> Görünümü Döndür</span>
            {[0, 90, 180, 270].map((rotation) => (
              <button
                key={rotation}
                type="button"
                className={planRotation === rotation ? 'is-active' : ''}
                onClick={() => handleRotationChange(rotation)}
                aria-pressed={planRotation === rotation}
              >
                {rotation}°
              </button>
            ))}
          </div>

          {/* Filter Chips */}
          <div className="lm-plan-filter-chips">
            {FILTER_OPTIONS.map((opt) => {
              const isActive = opt.key === 'all' ? (actualActiveFilters.size === 0) : actualActiveFilters.has(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  className={`lm-plan-filter-chip ${isActive ? 'is-active' : ''}`}
                  onClick={() => handleToggleFilter(opt.key)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Grid Area */}
      <div className="lm-plan-grid-layout">
        {/* SVG Canvas */}
        <div className="lm-plan-canvas-column">
          <LocationPlanCanvas
            items={items}
            selectedObjectId={selectedObject?.id}
            highlightedObjectId={highlightedObjectId}
            onSelectObject={handleSelectObject}
            zoom={zoom}
            setZoom={setZoom}
            pan={pan}
            setPan={setPan}
            visibleTypes={visibleTypes}
            fitTrigger={fitTrigger}
            rotation={planRotation}
            boundaries={boundaries}
          />
        </div>

        {/* Object Info Details Panel */}
        <aside className="lm-plan-info-column">
          {selectedObject ? (
            <div className="lm-plan-object-info-card">
              <header className="lm-plan-object-info-header">
                <div className="lm-plan-object-info-icon">
                  <Info size={16} />
                </div>
                <div>
                  <h4>{objectDisplayTitle(selectedObject)}</h4>
                  <p>{objectDescription(selectedObject.objectType)}</p>
                </div>
              </header>

              <div className="lm-plan-object-info-body">
                {/* 1. Core Layout Metadata */}
                <div className="lm-plan-info-hero-row">
                  <span className={`lm-plan-object-type-badge is-${normalizeObjectType(selectedObject.objectType)}`}>
                    {objectTypeLabel(selectedObject.objectType)}
                  </span>
                  <span className="lm-plan-object-role">{selectedObject.objectType}</span>
                </div>
                <div className="lm-plan-info-field">
                  <span>Tür:</span>
                  <strong>{selectedObject.objectType === 'section_common_area' ? 'Ortak Reyon Alanı' : selectedObject.objectType === 'warehouse_common_area' ? 'Ortak Depo Alanı' : selectedObject.objectType}</strong>
                </div>
                {selectedObject.locationCodeSnapshot && (
                  <div className="lm-plan-info-field">
                    <span>Kod:</span>
                    <strong>{selectedObject.locationCodeSnapshot}</strong>
                  </div>
                )}

                {renderSelectedObjectDetails()}

                <div className="lm-plan-info-meta-section">
                  <div className="lm-plan-info-field" style={{ opacity: 0.7 }}>
                    <span>X / Y Koordinat:</span>
                    <strong>{selectedObject.x}px / {selectedObject.y}px</strong>
                  </div>
                  <div className="lm-plan-info-field" style={{ opacity: 0.7 }}>
                    <span>Boyut:</span>
                    <strong>{selectedObject.width}w x {selectedObject.height}h</strong>
                  </div>
                </div>

                {selectedLocation && (
                  <div className="lm-plan-info-meta-section" style={{ borderTop: '2px solid rgba(226, 232, 240, 0.9)', paddingTop: '14px', gap: '8px' }}>
                    {selectedLocation.locationType === 'reyon' || selectedLocation.locationType === 'section' ? (
                      isEmptyStatus(selectedLocation.status) ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                          <p style={{ margin: '0 0 4px 0', fontSize: '0.7rem', color: '#64748b' }}>Bu raf gözü boş.</p>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={onCreateRefillRequest}
                            style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.74rem', padding: '8px 12px' }}
                          >
                            <ListChecks size={14} /> Reyon Besleme Talebi
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={onViewRefillHistory}
                            style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.74rem', padding: '8px 12px' }}
                          >
                            <Clock3 size={14} /> Besleme Geçmişi
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={onMoveSlot}
                            style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.74rem', padding: '8px 12px' }}
                          >
                            <Shuffle size={14} /> Göz Değiştir
                          </button>
                        </div>
                      )
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                        <button
                          className="primary-button"
                          type="button"
                          onClick={onMove}
                          disabled={isEmptyStatus(selectedLocation.status)}
                          style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.74rem', padding: '8px 12px' }}
                        >
                          <Shuffle size={14} /> Ürün Taşı
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Common Area product list or standard details */}
                {false && (() => {
                  const isCommonArea = selectedObject.objectType === 'section_common_area' || selectedObject.objectType === 'warehouse_common_area';
                  const isSection = selectedObject.objectType === 'section';
                  const levels = selectedObject.metadata?.levels || [];
                  const isStack = (
                    selectedObject.objectType === 'shelf'
                    || selectedObject.objectType === 'warehouse_location'
                  ) && levels.length > 0;

                  if (isSection && selectedSectionSummary) {
                    return (
                      <div className="lm-plan-info-meta-section">
                        <h5>Reyon Özeti</h5>
                        <div className="lm-plan-info-field">
                          <span>Reyon:</span>
                          <strong>{stripEmojis(selectedObject.label) || '-'}</strong>
                        </div>
                        <div className="lm-plan-info-field">
                          <span>Raf Modülü:</span>
                          <strong>{selectedSectionSummary.shelfCount}</strong>
                        </div>
                        <div className="lm-plan-info-field">
                          <span>Toplam Kat:</span>
                          <strong>{selectedSectionSummary.levelCount}</strong>
                        </div>
                        <div className="lm-plan-info-field">
                          <span>Dolu Kat:</span>
                          <strong>{selectedSectionSummary.occupiedLevelCount}</strong>
                        </div>
                        <div className="lm-plan-info-field">
                          <span>Ürün:</span>
                          <strong>{selectedSectionSummary.productCount}</strong>
                        </div>
                      </div>
                    );
                  }

                  if (isStack) {
                    return (
                      <div className="lm-plan-stack-details">
                        <div className="lm-plan-stack-summary">
                          <div>
                            <span>Fiziksel Modül</span>
                            <strong>
                              {selectedObject.objectType === 'shelf' ? 'Raf Stack' : 'Depo Stack'}
                            </strong>
                          </div>
                          <span className="lm-plan-level-count">{levels.length} Kat</span>
                        </div>
                        <div className="lm-plan-level-list">
                          {levels.map((level) => {
                            const levelProducts = level.products || [];
                            const hasUnassignedOccupancy = levelProducts.length === 0
                              && (
                                Number(level.occupancy || 0) > 0
                                || String(level.status || '').toLocaleLowerCase('tr-TR') === 'dolu'
                              );
                            const levelStateLabel = levelProducts.length
                              ? `${levelProducts.length} ürün`
                              : hasUnassignedOccupancy ? 'Atanmamış' : 'Boş';
                            return (
                              <article key={`${level.levelNo}-${level.shelfCode}`} className="lm-plan-level-item">
                                <header>
                                  <div>
                                    <strong>Kat {level.levelNo}</strong>
                                    <span>{level.shelfCode || '-'}</span>
                                  </div>
                                  <span className={levelProducts.length ? 'is-filled' : hasUnassignedOccupancy ? 'is-unassigned' : 'is-empty'}>
                                    {levelStateLabel}
                                  </span>
                                </header>
                                {levelProducts.length > 0 && (
                                  <div className="lm-plan-level-products">
                                    {levelProducts.map((product) => (
                                      <div key={product.id || `${product.sku}-${product.name}`}>
                                        <strong>{product.name || 'Ürün'}</strong>
                                        <span>
                                          {product.sku ? `SKU: ${product.sku}` : ''}
                                          {product.barcode ? ` · Barkod: ${product.barcode}` : ''}
                                        </span>
                                        {(product.shelfQuantity != null || product.warehouseQuantity != null) && (
                                          <span>
                                            Raf: {formatNumber(product.shelfQuantity || 0)}
                                            {' · '}
                                            Depo: {formatNumber(product.warehouseQuantity || 0)}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (isCommonArea) {
                    return (
                      <div className="lm-plan-common-area-details">
                        <div className="lm-plan-info-meta-section">
                          <h5>Lokasyon Bilgisi</h5>
                          {selectedObject.objectType === 'section_common_area' && (
                            <div className="lm-plan-info-field">
                              <span>Reyon:</span>
                              <strong>{selectedObject.metadata?.sectionName || `Reyon ${selectedObject.locationCodeSnapshot?.split('-')[0]}`}</strong>
                            </div>
                          )}
                          <div className="lm-plan-info-field">
                            <span>Toplam Ürün:</span>
                            <strong>{selectedObject.metadata?.commonProductCount || 0} ürün</strong>
                          </div>
                          <div className="lm-plan-info-field">
                            <span>Fiziksel Durum:</span>
                            <strong className="lm-plan-common-badge" style={{ color: '#10b981', fontWeight: '600' }}>Fiziksel göz işgal etmez</strong>
                          </div>
                        </div>

                        <div className="lm-plan-info-meta-section lm-plan-common-products" style={{ borderTop: '1px solid rgba(226, 232, 240, 0.9)', paddingTop: '12px' }}>
                          <h5 style={{ marginBottom: '8px' }}>Ortak Alan Ürünleri</h5>
                          {(!selectedObject.metadata?.products || selectedObject.metadata.products.length === 0) ? (
                            <p style={{ fontSize: '0.72rem', color: '#64748b', fontStyle: 'italic', margin: '8px 0' }}>
                              Bu alanda ürün yok
                            </p>
                          ) : (
                            <div className="lm-plan-common-products-list">
                              {selectedObject.metadata.products.map((prod) => (
                                <div key={prod.id} className="lm-plan-common-product-item" style={{
                                  padding: '8px 10px',
                                  borderRadius: '8px',
                                  border: '1px solid #f1f5f9',
                                  backgroundColor: '#f8fafc',
                                  fontSize: '0.74rem',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '4px'
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '4px' }}>
                                    <span style={{ fontWeight: '600', color: '#1e293b' }}>{prod.name}</span>
                                    {prod.isVirtualLocation && (
                                      <span style={{
                                        backgroundColor: '#eff6ff',
                                        color: '#2563eb',
                                        padding: '1px 5px',
                                        borderRadius: '4px',
                                        fontSize: '0.62rem',
                                        fontWeight: 'bold',
                                        whiteSpace: 'nowrap'
                                      }}>Sanal lokasyon</span>
                                    )}
                                  </div>
                                  <div style={{ color: '#64748b', display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                                    <span>SKU: {prod.sku} {prod.barcode ? `| Barkod: ${prod.barcode}` : ''}</span>
                                    <span style={{ fontWeight: '500' }}>
                                      {selectedObject.objectType === 'section_common_area' ? (
                                        `Stok: ${prod.shelfQuantity || 0} / Depo: ${prod.warehouseQuantity || 0}`
                                      ) : (
                                        `Depo: ${prod.warehouseQuantity || 0}`
                                      )}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <>
                      {/* 2. Rich Operational Details if matches selectedLocation */}
                      {selectedLocation ? (
                        <>
                          <div className="lm-plan-info-meta-section">
                            <h5>Lokasyon Bilgisi</h5>
                            <div className="lm-plan-info-field">
                              <span>Lokasyon Tipi:</span>
                              <strong>{selectedLocation.locationTypeLabel || '-'}</strong>
                            </div>
                            <div className="lm-plan-info-field">
                              <span>Alan / Reyon:</span>
                              <strong>{selectedLocation.scopeLabel || selectedLocation.scopeName || '-'}</strong>
                            </div>
                            {selectedLocation.sideLabel && (
                              <div className="lm-plan-info-field">
                                <span>Taraf:</span>
                                <strong>{selectedLocation.sideLabel}</strong>
                              </div>
                            )}
                            {selectedLocation.shelfNo && (
                              <div className="lm-plan-info-field">
                                <span>Raf / Kat:</span>
                                <strong>Raf {selectedLocation.shelfNo} / Kat {selectedLocation.levelNo || '-'}</strong>
                              </div>
                            )}
                            <div className="lm-plan-info-field">
                              <span>Durum:</span>
                              <strong><StatusBadge tone={statusTone(selectedLocation.status)}>{statusLabel(selectedLocation.status)}</StatusBadge></strong>
                            </div>
                          </div>

                          <div className="lm-plan-info-meta-section">
                            <h5>Ürün Bilgisi</h5>
                            <div className="lm-plan-info-field">
                              <span>Ürün Adı:</span>
                              <strong className="lm-plan-info-product-name">{selectedLocation.productName || '-'}</strong>
                            </div>
                            <div className="lm-plan-info-field">
                              <span>SKU:</span>
                              <strong>{selectedLocation.sku || '-'}</strong>
                            </div>
                            {selectedLocation.barcode && selectedLocation.barcode !== '-' && (
                              <div className="lm-plan-info-field">
                                <span>Barkod:</span>
                                <strong>{selectedLocation.barcode}</strong>
                              </div>
                            )}
                            {selectedLocation.categoryName && (
                              <div className="lm-plan-info-field">
                                <span>Kategori:</span>
                                <strong>{selectedLocation.categoryName}</strong>
                              </div>
                            )}
                            <div className="lm-plan-info-field">
                              <span>Saklama Tipi:</span>
                              <strong><span className={`location-chip ${storageToneClass(selectedLocation.storageType)}`}>{storageTypeLabel(selectedLocation.storageType)}</span></strong>
                            </div>
                          </div>

                          <div className="lm-plan-info-meta-section">
                            <h5>Operasyonel Durum</h5>
                            <div className="lm-plan-info-field">
                              <span>Doluluk Oranı:</span>
                              <strong>{selectedLocation.occupancyLabel || '-'}</strong>
                            </div>
                            <div className="lm-plan-info-field">
                              <span>Mevcut Stok:</span>
                              <strong>{selectedLocation.stockLabel || '-'}</strong>
                            </div>
                            {selectedLocation.capacityLabel && (
                              <div className="lm-plan-info-field">
                                <span>Kapasite:</span>
                                <strong>{selectedLocation.capacityLabel}</strong>
                              </div>
                            )}
                            {selectedLocation.slotDesiLabel && (
                              <div className="lm-plan-info-field">
                                <span>Göz Desisi:</span>
                                <strong>{selectedLocation.slotDesiLabel}</strong>
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="lm-plan-info-meta-section">
                          <p style={{ fontSize: '0.72rem', color: '#64748b', margin: 0 }}>
                            Bu alan fiziksel bir reyon rafı veya depo hücresi değildir.
                          </p>
                        </div>
                      )}

                      {/* 3. Coordinate details */}
                      <div className="lm-plan-info-meta-section">
                        <div className="lm-plan-info-field" style={{ opacity: 0.7 }}>
                          <span>X / Y Koordinat:</span>
                          <strong>{selectedObject.x}px / {selectedObject.y}px</strong>
                        </div>
                        <div className="lm-plan-info-field" style={{ opacity: 0.7 }}>
                          <span>Boyut:</span>
                          <strong>{selectedObject.width}w x {selectedObject.height}h</strong>
                        </div>
                      </div>

                      {/* 4. Action Buttons in details footer */}
                      {selectedLocation && (
                        <div className="lm-plan-info-meta-section" style={{ borderTop: '2px solid rgba(226, 232, 240, 0.9)', paddingTop: '14px', gap: '8px' }}>
                          {selectedLocation.locationType === 'reyon' || selectedLocation.locationType === 'section' ? (
                            isEmptyStatus(selectedLocation.status) ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                                <p style={{ margin: '0 0 4px 0', fontSize: '0.7rem', color: '#64748b' }}>Bu raf gözü boş.</p>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={onCreateRefillRequest}
                                  style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.74rem', padding: '8px 12px' }}
                                >
                                  <ListChecks size={14} /> Reyon Besleme Talebi
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={onViewRefillHistory}
                                  style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.74rem', padding: '8px 12px' }}
                                >
                                  <Clock3 size={14} /> Besleme Geçmişi
                                </button>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={onMoveSlot}
                                  style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.74rem', padding: '8px 12px' }}
                                >
                                  <Shuffle size={14} /> Göz Değiştir
                                </button>
                              </div>
                            )
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                              <button
                                className="primary-button"
                                type="button"
                                onClick={onMove}
                                disabled={isEmptyStatus(selectedLocation.status)}
                                style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.74rem', padding: '8px 12px' }}
                              >
                                <Shuffle size={14} /> Ürün Taşı
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div className="lm-plan-object-info-empty" style={{ height: '100%', minHeight: '320px' }}>
              <Layers size={32} className="lm-plan-empty-icon" />
              <h4>Haritadan bir alan seçin</h4>
              <p>Seçili alanın detayları burada görüntülenir.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
