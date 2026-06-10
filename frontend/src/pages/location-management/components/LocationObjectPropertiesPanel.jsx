import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, Lock, Eye, EyeOff, List, Loader, Link2 } from 'lucide-react';
import LocationProductAssignmentPanel from './LocationProductAssignmentPanel.jsx';
import { sectionService } from '../../../services/sectionService.js';
import { useAuth } from '../../../hooks/useAuth.js';
import { hasPermission, PERMISSIONS } from '../../../config/permissions.js';
import {
  collectStackProducts,
  isLayoutItemUserLocked,
  resolveStackLevels,
} from '../../../services/locationLayoutService.js';

const stripEmojis = (str) => {
  if (!str) return '';
  return str
    .replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F900}-\u{1F9FF}\u{1F300}-\u{1F5FF}\u{1F500}-\u{1F5FF}\u{2702}-\u{27B0}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2900}-\u{297F}]/gu, '')
    .trim();
};

const OBJECT_TYPES = [
  { value: 'section', label: 'Reyon' },
  { value: 'shelf', label: 'Raf' },
  { value: 'warehouse_location', label: 'Depo Hücresi' },
  { value: 'warehouse_door', label: 'Depo Kapısı' },
  { value: 'cashier', label: 'Kasa' },
  { value: 'entrance', label: 'Giriş' },
  { value: 'exit', label: 'Çıkış' },
  { value: 'aisle', label: 'Koridor' },
  { value: 'zone', label: 'Bölge' },
  { value: 'cold_cabinet', label: 'Soğuk Dolap' },
  { value: 'campaign_stand', label: 'Kampanya Standı' },
  { value: 'service_area', label: 'Servis Alanı' },
  { value: 'empty_area', label: 'Boş Alan' },
  { value: 'custom', label: 'Özel Alan' },
];

const COMMON_AREA_TYPES = new Set(['section_common_area', 'warehouse_common_area']);
const ALLOWED_ROTATIONS = [0, 90, 180, 270];

const clampNumber = (value, min) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.round(parsed));
};

const toFormState = (selectedObject) => ({
  label: stripEmojis(selectedObject?.label) || '',
  objectType: selectedObject?.objectType || 'custom',
  color: selectedObject?.color || '',
  x: String(Math.max(0, Number(selectedObject?.x) || 0)),
  y: String(Math.max(0, Number(selectedObject?.y) || 0)),
  width: String(Math.max(5, Number(selectedObject?.width) || 5)),
  height: String(Math.max(5, Number(selectedObject?.height) || 5)),
  rotation: String(ALLOWED_ROTATIONS.includes(Number(selectedObject?.rotation)) ? Number(selectedObject?.rotation) : 0),
  isLocked: isLayoutItemUserLocked(selectedObject),
  isVisible: selectedObject?.isVisible !== false && selectedObject?.properties?.isVisible !== false,
});

const toSanitizedObject = (selectedObject, formState) => {
  const userLocked = Boolean(formState.isLocked);
  return {
    ...selectedObject,
    label: stripEmojis(formState.label || ''),
    objectType: formState.objectType,
    color: formState.color || '',
    x: clampNumber(formState.x, 0),
    y: clampNumber(formState.y, 0),
    width: clampNumber(formState.width, 5),
    height: clampNumber(formState.height, 5),
    rotation: ALLOWED_ROTATIONS.includes(Number(formState.rotation)) ? Number(formState.rotation) : 0,
    isLocked: userLocked,
    isVisible: Boolean(formState.isVisible),
    properties: {
      ...(selectedObject.properties || {}),
      isLocked: userLocked,
      userLocked,
    },
    metadata: {
      ...(selectedObject.metadata || {}),
      userLocked,
    },
  };
};

export default function LocationObjectPropertiesPanel({
  selectedObject,
  onChangeObject,
  onDeleteObject,
}) {
  const { user } = useAuth();
  const [isAssignMode, setIsAssignMode] = useState(false);
  const [isSectionProductsMode, setIsSectionProductsMode] = useState(false);
  const [sectionProducts, setSectionProducts] = useState([]);
  const [isSectionProductsLoading, setIsSectionProductsLoading] = useState(false);
  const [sectionList, setSectionList] = useState([]);
  const [isSectionListLoading, setIsSectionListLoading] = useState(false);
  const [formState, setFormState] = useState(() => toFormState(selectedObject));
  const editSessionRef = useRef(null);

  useEffect(() => {
    setIsAssignMode(false);
    setIsSectionProductsMode(false);
    setSectionProducts([]);
    setFormState(toFormState(selectedObject));
    editSessionRef.current = null;
  }, [selectedObject?.id, selectedObject?.x, selectedObject?.y, selectedObject?.width, selectedObject?.height, selectedObject?.rotation, selectedObject?.label, selectedObject?.color, selectedObject?.isLocked, selectedObject?.isVisible, selectedObject?.objectType]);

  const updateForm = (field, value) => {
    setFormState((current) => ({ ...current, [field]: value }));
  };

  const beginFieldSession = () => {
    if (!selectedObject || editSessionRef.current) return;
    editSessionRef.current = selectedObject;
  };

  const previewObject = (nextFormState) => {
    if (!selectedObject) return;
    onChangeObject(toSanitizedObject(selectedObject, nextFormState), { commit: false });
  };

  const commitObject = (nextFormState) => {
    if (!selectedObject) return;
    const initialSnapshot = editSessionRef.current || selectedObject;
    onChangeObject(toSanitizedObject(selectedObject, nextFormState), {
      commit: true,
      initialItems: undefined,
      itemsSnapshot: undefined,
      initialObject: initialSnapshot,
    });
    editSessionRef.current = null;
  };

  const linkedSectionId = selectedObject?.sectionId || selectedObject?.properties?.linkedSectionId || '';
  const linkedWarehouseLocationId = selectedObject?.properties?.linkedWarehouseLocationId || '';
  const linkedProductId = selectedObject?.properties?.linkedProductId || '';
  const locationCodeSnapshot = selectedObject?.properties?.locationCodeSnapshot || '';

  const isCommonArea = COMMON_AREA_TYPES.has(selectedObject?.objectType);
  const isUserLocked = Boolean(formState.isLocked);
  const isCoordinatesDisabled = isUserLocked && !isCommonArea;
  const canEditType = !isUserLocked && !isCommonArea;
  const canEditRotation = !isUserLocked && !isCommonArea;
  const commonAreaTone = selectedObject?.objectType === 'warehouse_common_area' ? 'is-warehouse' : 'is-section';
  const lockHint = isCommonArea
    ? 'Ortak alanlar taşınabilir ve boyutlanabilir; tür ve bağlı sistem alanları korunur.'
    : isUserLocked
      ? 'Kilitli nesnede konum, boyut ve görünür alanlar pasif kalır.'
      : 'Değerler blur veya Enter sonrasında geri al geçmişine tek adım olarak yazılır.';

  const canAssign = hasPermission(user, PERMISSIONS.LOCATION_PRODUCT_ASSIGN);
  const type = selectedObject?.objectType;
  const hasSnapshot = !!locationCodeSnapshot;
  const isAssignable = type === 'shelf' || type === 'warehouse_location' || hasSnapshot;

  const commonAreaMeta = useMemo(() => {
    if (!isCommonArea || !selectedObject) return null;
    const commonAreaType = selectedObject.metadata?.commonAreaType || (selectedObject.objectType === 'section_common_area' ? 'section' : 'warehouse');
    const productCount = selectedObject.metadata?.commonProductCount || 0;
    const productsList = selectedObject.metadata?.products || [];
    return { commonAreaType, productCount, productsList };
  }, [isCommonArea, selectedObject]);

  const resolvedSectionId = selectedObject?.sectionId
    || selectedObject?.linkedSectionId
    || selectedObject?.properties?.linkedSectionId
    || selectedObject?.metadata?.sectionId
    || selectedObject?.metadata?.linkedSectionId
    || selectedObject?.properties?.sectionId
    || '';

  const isSectionType = selectedObject?.objectType === 'section';
  const isStackType = (
    selectedObject?.objectType === 'shelf'
    || selectedObject?.objectType === 'shelf_stack'
    || selectedObject?.objectType === 'warehouse_location'
    || selectedObject?.objectType === 'warehouse_stack'
  );
  const stackLevels = useMemo(() => resolveStackLevels(selectedObject), [selectedObject]);
  const stackProducts = useMemo(() => collectStackProducts(selectedObject), [selectedObject]);

  const handleShowSectionProducts = useCallback(async () => {
    const sectionId = isSectionType ? resolvedSectionId : '';
    if (!sectionId) return;
    try {
      setIsSectionProductsLoading(true);
      setIsSectionProductsMode(true);
      const products = await sectionService.getProducts(sectionId);
      setSectionProducts(Array.isArray(products) ? products : []);
    } catch (err) {
      console.error('Reyon urunleri yuklenemedi:', err);
      setSectionProducts([]);
    } finally {
      setIsSectionProductsLoading(false);
    }
  }, [isSectionType, resolvedSectionId]);

  const loadSectionList = useCallback(async () => {
    if (sectionList.length > 0 || isSectionListLoading) return;
    try {
      setIsSectionListLoading(true);
      const sections = await sectionService.list();
      setSectionList(Array.isArray(sections) ? sections : []);
    } catch (err) {
      console.error('Reyon listesi yuklenemedi:', err);
    } finally {
      setIsSectionListLoading(false);
    }
  }, [sectionList.length, isSectionListLoading]);

  useEffect(() => {
    if (isStackType) loadSectionList();
  }, [isStackType, loadSectionList]);

  const handleLinkShelfToSection = useCallback((sectionId) => {
    if (!selectedObject || !onChangeObject) return;
    const section = sectionList.find((s) => String(s.id) === String(sectionId));
    const shelfSide = selectedObject.metadata?.shelfSide || selectedObject.properties?.shelfSide || 'L';
    const shelfNo = selectedObject.metadata?.shelfNo || selectedObject.properties?.shelfNo || '01';
    const sectionNumber = section?.number || '';
    const locationCode = sectionNumber
      ? `R${String(sectionNumber).padStart(2, '0')}-${shelfSide}-${String(shelfNo).padStart(2, '0')}`
      : '';
    const updatedObject = {
      ...selectedObject,
      sectionId: sectionId || null,
      linkedSectionId: sectionId || null,
      metadata: {
        ...(selectedObject.metadata || {}),
        sectionId: sectionId || null,
        sectionName: section?.name || '',
        sectionNumber: sectionNumber,
        shelfSide,
        shelfNo,
      },
      properties: {
        ...(selectedObject.properties || {}),
        linkedSectionId: sectionId || null,
        locationCodeSnapshot: locationCode || selectedObject.properties?.locationCodeSnapshot || null,
      },
      locationCodeSnapshot: locationCode || selectedObject.locationCodeSnapshot || '',
    };
    onChangeObject(updatedObject, { commit: true });
  }, [selectedObject, onChangeObject, sectionList]);

  const handleShelfMetaChange = useCallback((field, value) => {
    if (!selectedObject || !onChangeObject) return;
    const updatedObject = {
      ...selectedObject,
      metadata: {
        ...(selectedObject.metadata || {}),
        [field]: value,
      },
      properties: {
        ...(selectedObject.properties || {}),
        [field]: value,
      },
    };
    onChangeObject(updatedObject, { commit: true });
  }, [selectedObject, onChangeObject]);

  if (!selectedObject) {
    return (
      <aside className="lm-layout-properties">
        <div className="lm-layout-properties-empty">
          <Info size={28} className="lm-properties-empty-icon" />
          <p>Düzenlemek için plandan bir öğe seçin.</p>
        </div>
      </aside>
    );
  }

  if (isAssignMode) {
    return (
      <LocationProductAssignmentPanel
        selectedObject={selectedObject}
        onChangeObject={onChangeObject}
        onBack={() => setIsAssignMode(false)}
      />
    );
  }

  if (isSectionProductsMode) {
    return (
      <aside className="lm-layout-properties">
        <header className="lm-layout-properties-header">
          <h4>Reyon Ürünleri</h4>
          <p>{stripEmojis(selectedObject.label) || 'Reyon'}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setIsSectionProductsMode(false)}
            style={{ marginTop: '8px', fontSize: '0.74rem', padding: '6px 12px' }}
          >
            Özelliklere Dön
          </button>
        </header>
        <div className="lm-layout-properties-form" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
          {isSectionProductsLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '16px', color: '#64748b' }}>
              <Loader size={16} className="spinner" />
              <span>Ürünler yükleniyor...</span>
            </div>
          ) : sectionProducts.length === 0 ? (
            <p style={{ fontSize: '0.74rem', color: '#64748b', padding: '16px', fontStyle: 'italic' }}>
              Bu reyonda ürün bulunamadı.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0' }}>
              <p style={{ fontSize: '0.7rem', color: '#94a3b8', padding: '0 2px', margin: 0 }}>
                Toplam {sectionProducts.length} ürün
              </p>
              {sectionProducts.map((prod, index) => (
                <div
                  key={prod.id || `sp-${index}`}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#f8fafc',
                    fontSize: '0.74rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '3px',
                  }}
                >
                  <strong style={{ color: '#1e293b' }}>{prod.name || prod.productName || 'Ürün'}</strong>
                  <span style={{ color: '#64748b', fontSize: '0.7rem' }}>
                    SKU: {prod.sku || '-'}
                    {prod.barcode ? ` | Barkod: ${prod.barcode}` : ''}
                  </span>
                  <span style={{ color: '#64748b', fontSize: '0.7rem' }}>
                    {prod.shelfSide ? `Taraf: ${prod.shelfSide}` : ''}
                    {prod.shelfNo ? ` | Raf: ${prod.shelfNo}` : ''}
                    {prod.shelfLevel ? ` | Kat: ${prod.shelfLevel}` : ''}
                    {!prod.shelfSide && !prod.shelfNo && !prod.shelfLevel ? 'Ortak Alan' : ''}
                  </span>
                  <span style={{ color: '#475569', fontSize: '0.7rem' }}>
                    {prod.shelfStock != null ? `Raf: ${prod.shelfStock}` : ''}
                    {prod.shelfStock != null && prod.warehouseStock != null ? ' / ' : ''}
                    {prod.warehouseStock != null ? `Depo: ${prod.warehouseStock}` : ''}
                    {prod.totalStock != null && prod.shelfStock == null ? `Stok: ${prod.totalStock}` : ''}
                  </span>
                  {prod.isActive === false && (
                    <span style={{ color: '#ef4444', fontSize: '0.65rem', fontWeight: 600 }}>Pasif</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="lm-layout-properties">
      <header className="lm-layout-properties-header">
        <h4>Özellikler</h4>
        <p>{stripEmojis(selectedObject.label) || selectedObject.objectType.toUpperCase()}</p>
        <div className={`lm-layout-properties-status-banner ${isUserLocked ? 'is-locked' : 'is-editable'} ${isCommonArea ? commonAreaTone : ''}`}>
          {isCommonArea ? 'Ortak Alan — Düzenlenebilir' : isUserLocked ? 'Kilitli Nesne' : 'Düzenlenebilir Nesne'}
        </div>
        <div className="lm-layout-properties-hint">{lockHint}</div>
      </header>

      <div className="lm-layout-properties-form">
        <label className="lm-properties-field">
          <span>Görünür İsim</span>
          <input
            type="text"
            value={formState.label}
            onFocus={beginFieldSession}
            onChange={(event) => {
              const nextFormState = { ...formState, label: stripEmojis(event.target.value) };
              updateForm('label', nextFormState.label);
              previewObject(nextFormState);
            }}
            onBlur={() => commitObject(formState)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            disabled={isUserLocked}
            placeholder="Örn: Reyon 1"
          />
        </label>

        <label className="lm-properties-field">
          <span>Obje Türü</span>
          <select
            value={formState.objectType}
            onChange={(event) => {
              const nextFormState = { ...formState, objectType: event.target.value };
              updateForm('objectType', nextFormState.objectType);
              onChangeObject(toSanitizedObject(selectedObject, nextFormState), { commit: true });
            }}
            disabled={!canEditType}
          >
            {OBJECT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="lm-properties-field">
          <span>Renk Kodu</span>
          <div className="lm-properties-color-picker-wrap">
            <input
              type="color"
              value={formState.color && formState.color.startsWith('#') ? formState.color : '#cbd5e1'}
              onChange={(event) => {
                const nextFormState = { ...formState, color: event.target.value };
                updateForm('color', nextFormState.color);
                previewObject(nextFormState);
              }}
              onBlur={() => commitObject(formState)}
              disabled={isUserLocked}
            />
            <input
              type="text"
              value={formState.color}
              onFocus={beginFieldSession}
              onChange={(event) => {
                const nextFormState = { ...formState, color: event.target.value };
                updateForm('color', nextFormState.color);
                previewObject(nextFormState);
              }}
              onBlur={() => commitObject(formState)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              disabled={isUserLocked}
              placeholder="#FFFFFF"
            />
          </div>
        </label>

        <div className="lm-properties-row-grid">
          {[
            ['x', 'X Konumu'],
            ['y', 'Y Konumu'],
            ['width', 'Genişlik'],
            ['height', 'Yükseklik'],
          ].map(([field, label]) => (
            <label key={field} className="lm-properties-field">
              <span>{label} (px)</span>
              <input
                type="number"
                value={formState[field]}
                onFocus={beginFieldSession}
                onChange={(event) => {
                  const nextFormState = { ...formState, [field]: event.target.value };
                  updateForm(field, event.target.value);
                  previewObject(nextFormState);
                }}
                onBlur={() => commitObject(formState)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                disabled={isCoordinatesDisabled}
              />
            </label>
          ))}
        </div>

        <label className="lm-properties-field">
          <span>Dönüş</span>
          <select
            value={formState.rotation}
            onChange={(event) => {
              const nextFormState = { ...formState, rotation: event.target.value };
              updateForm('rotation', nextFormState.rotation);
              onChangeObject(toSanitizedObject(selectedObject, nextFormState), { commit: true });
            }}
            disabled={!canEditRotation}
          >
            {ALLOWED_ROTATIONS.map((rotation) => (
              <option key={rotation} value={rotation}>{rotation}°</option>
            ))}
          </select>
        </label>

        <div className="lm-properties-toggles">
          <label className="lm-properties-toggle-label">
            <input
              type="checkbox"
              checked={formState.isLocked}
              onChange={(event) => {
                const nextFormState = { ...formState, isLocked: event.target.checked };
                setFormState(nextFormState);
                onChangeObject(toSanitizedObject(selectedObject, nextFormState), { commit: true });
              }}
            />
            <span className="lm-properties-toggle-copy">
              <Lock size={12} /> Nesneyi Kilitle
            </span>
          </label>

          <label className="lm-properties-toggle-label">
            <input
              type="checkbox"
              checked={formState.isVisible}
              onChange={(event) => {
                const nextFormState = { ...formState, isVisible: event.target.checked };
                setFormState(nextFormState);
                onChangeObject(toSanitizedObject(selectedObject, nextFormState), { commit: true });
              }}
            />
            <span className="lm-properties-toggle-copy">
              {formState.isVisible ? <Eye size={12} /> : <EyeOff size={12} />} Planda Göster
            </span>
          </label>
        </div>

        <div className="lm-properties-meta-section">
          <h5>Operasyon Bağlantıları</h5>
          <div className="lm-properties-readonly-field">
            <span>Kod Snapshot</span>
            <strong>{locationCodeSnapshot || 'Bağlantı Yok'}</strong>
          </div>
          <div className="lm-properties-readonly-field">
            <span>Linked Section ID</span>
            <strong>{linkedSectionId || 'Bağlantı Yok'}</strong>
          </div>
          <div className="lm-properties-readonly-field">
            <span>Linked Warehouse Location ID</span>
            <strong>{linkedWarehouseLocationId || 'Bağlantı Yok'}</strong>
          </div>
          <div className="lm-properties-readonly-field">
            <span>Linked Product ID</span>
            <strong>{linkedProductId || 'Bağlantı Yok'}</strong>
          </div>
        </div>

        {commonAreaMeta ? (
          <div className="lm-properties-meta-section">
            <h5>Ortak Alan Detayları</h5>
            <div className="lm-properties-readonly-field">
              <span>Ortak Alan Türü</span>
              <strong>{commonAreaMeta.commonAreaType === 'section' ? 'Reyon (Sanal)' : 'Depo (Sanal)'}</strong>
            </div>
            <div className="lm-properties-readonly-field">
              <span>Ürün Sayısı</span>
              <strong>{commonAreaMeta.productCount} ürün</strong>
            </div>
            <div className="lm-properties-readonly-field is-stack">
              <span>Ortak Ürünler</span>
              <div className="lm-properties-list-box">
                {commonAreaMeta.productsList.length === 0 ? (
                  <span className="lm-properties-list-empty">Bu alanda ürün yok.</span>
                ) : commonAreaMeta.productsList.map((product) => (
                  <div key={product.id} className="lm-properties-list-row">
                    <span>{product.name}</span>
                    <span>SKU: {product.sku}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {!isCommonArea && isAssignable ? (
          <div className="lm-properties-assignment-action-wrap">
            <h5>Ürün Atama</h5>
            {!hasSnapshot ? (
              <div className="lm-properties-assign-warning">Bu alan ürün atamaya uygun değil.</div>
            ) : (
              <>
                <button
                  className="lm-properties-assign-btn"
                  type="button"
                  onClick={() => setIsAssignMode(true)}
                  disabled={!canAssign}
                >
                  Ürün Yerleştir / Ata
                </button>
                {!canAssign ? (
                  <p className="lm-properties-assign-help-text text-danger">Ürün atama yetkiniz bulunmamaktadır.</p>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {isSectionType && resolvedSectionId ? (
          <div className="lm-properties-assignment-action-wrap">
            <h5>Reyon Ürünleri</h5>
            <button
              className="lm-properties-assign-btn"
              type="button"
              onClick={handleShowSectionProducts}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <List size={14} /> Atanan ürünleri gör
            </button>
          </div>
        ) : null}

        {isStackType ? (
          <div className="lm-properties-meta-section">
            <h5 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Link2 size={13} /> Raf-Reyon İlişkisi</h5>
            <label className="lm-properties-field">
              <span>Bağlı Reyon</span>
              <select
                value={resolvedSectionId}
                onChange={(e) => handleLinkShelfToSection(e.target.value)}
                disabled={isUserLocked}
              >
                <option value="">-- Reyon Seç --</option>
                {sectionList.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} (#{s.number})</option>
                ))}
              </select>
            </label>
            <div className="lm-properties-row-grid">
              <label className="lm-properties-field">
                <span>Taraf</span>
                <select
                  value={selectedObject?.metadata?.shelfSide || selectedObject?.properties?.shelfSide || 'L'}
                  onChange={(e) => handleShelfMetaChange('shelfSide', e.target.value)}
                  disabled={isUserLocked}
                >
                  <option value="L">Sol (L)</option>
                  <option value="R">Sağ (R)</option>
                </select>
              </label>
              <label className="lm-properties-field">
                <span>Raf No</span>
                <input
                  type="text"
                  value={selectedObject?.metadata?.shelfNo || selectedObject?.properties?.shelfNo || ''}
                  onChange={(e) => handleShelfMetaChange('shelfNo', e.target.value)}
                  disabled={isUserLocked}
                  placeholder="01"
                />
              </label>
            </div>
            <label className="lm-properties-field">
              <span>Kat Sayısı</span>
              <input
                type="number"
                min="1"
                max="20"
                value={selectedObject?.metadata?.levelCount || stackLevels.length || 5}
                onChange={(e) => handleShelfMetaChange('levelCount', Math.max(1, Number(e.target.value) || 1))}
                disabled={isUserLocked}
              />
            </label>
            {resolvedSectionId ? (
              <div className="lm-properties-readonly-field">
                <span>Bağlı Reyon</span>
                <strong>{sectionList.find((s) => String(s.id) === String(resolvedSectionId))?.name || resolvedSectionId}</strong>
              </div>
            ) : null}
            {stackLevels.length > 0 ? (
              <div className="lm-properties-readonly-field is-stack">
                <span>Katlar ve Ürünler ({stackProducts.length} ürün)</span>
                <div className="lm-properties-list-box" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                  {stackLevels.map((level, index) => {
                    const levelProducts = level.products || [];
                    return (
                      <div key={`${level.levelNo || index + 1}-${level.shelfCode || index}`} className="lm-properties-list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                          <strong>Kat {level.levelNo || index + 1}</strong>
                          <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{level.shelfCode || '-'}</span>
                        </div>
                        {levelProducts.length === 0 ? (
                          <span className="lm-properties-list-empty">Boş</span>
                        ) : levelProducts.map((product, productIndex) => (
                          <div key={product.id || `${product.sku || 'product'}-${productIndex}`} style={{ fontSize: '0.72rem', color: '#334155' }}>
                            <span>{product.name || product.productName || 'Ürün'}</span>
                            {product.sku ? <span style={{ color: '#64748b' }}> · SKU: {product.sku}</span> : null}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <button
          className="lm-properties-delete-btn"
          type="button"
          onClick={() => onDeleteObject(selectedObject.id)}
          disabled={isUserLocked || isCommonArea}
          style={isUserLocked || isCommonArea ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
        >
          {isCommonArea
            ? 'Ortak Alan (Silinemez)'
            : (isUserLocked ? 'Kilitli Öğe (Silinemez)' : 'Öğeyi Plandan Sil')}
        </button>
      </div>
    </aside>
  );
}
