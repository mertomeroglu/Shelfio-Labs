import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Filter, MapPin, Search, Shuffle, Snowflake, Thermometer, Warehouse, Boxes, AlertTriangle, Clock3, ListChecks, PackageCheck } from 'lucide-react';
import DataTable from '../../components/DataTable.jsx';
import FilterBar from '../../components/FilterBar.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Toast from '../../components/Toast.jsx';
import './LocationManagement.css';
import {
  formatDepotLocationLabel,
  formatNumber,
  formatStorageTypeLabel,
  includesNormalized,
  normalizeSearchText,
} from '../../services/formatters.js';
import { productService } from '../../services/productService.js';
import { sectionService } from '../../services/sectionService.js';
import { stockService } from '../../services/stockService.js';
import { warehouseService } from '../../services/warehouseService.js';

const LOCATION_TYPES = {
  SECTION: 'reyon',
  WAREHOUSE: 'depo',
};

const SECTION_DETAIL_FIELDS = [
  ['Lokasyon Tipi', 'locationTypeLabel'],
  ['Reyon Adı', 'scopeName'],
  ['Reyon Kodu', 'scopeCode'],
  ['Taraf', 'sideLabel'],
  ['Raf', 'shelfNo'],
  ['Kat', 'levelNo'],
  ['Göz Kodu', 'locationCodeLabel'],
  ['Göz Durumu', 'statusLabel'],
  ['Ürün Adı', 'productName'],
  ['SKU', 'sku'],
  ['Barkod', 'barcode'],
  ['Kategori', 'categoryName'],
  ['Birim', 'unitLabel'],
  ['Saklama Tipi', 'storageTypeLabel'],
  ['Göz Stok', 'stockLabel'],
  ['Göz Kapasitesi', 'capacityLabel'],
  ['Doluluk', 'occupancyLabel'],
  ['Göz Desisi', 'slotDesiLabel'],
  ['Kritik Stok', 'criticalLabel'],
  ['Son Besleme', 'lastFeedAtLabel'],
  ['Son Hareket', 'lastMovementAtLabel'],
  ['Not', 'note'],
];

const WAREHOUSE_DETAIL_FIELDS = [
  ['Lokasyon Tipi', 'locationTypeLabel'],
  ['Lokasyon Kodu', 'locationCodeLabel'],
  ['Depo Bilgisi', 'scopeLabel'],
  ['Sıra', 'rowLabel'],
  ['Taraf', 'sideLabel'],
  ['Raf', 'shelfNo'],
  ['Kat', 'levelNo'],
  ['Ürün Adı', 'productName'],
  ['SKU', 'sku'],
  ['Barkod', 'barcode'],
  ['Kategori', 'categoryName'],
  ['Mevcut Stok', 'stockLabel'],
  ['Kapasite', 'capacityLabel'],
  ['Doluluk', 'occupancyLabel'],
  ['Parti No', 'batchNo'],
  ['SKT', 'skt'],
  ['Saklama Tipi', 'storageTypeLabel'],
  ['Son Giriş', 'lastInAt'],
  ['Son Çıkış', 'lastOutAt'],
  ['Not', 'note'],
];

const SECTION_DETAIL_GROUPS = [
  {
    id: 'location',
    title: 'Lokasyon Bilgisi',
    fields: [
      ['Lokasyon Tipi', 'locationTypeLabel'],
      ['Reyon Adı', 'scopeName'],
      ['Reyon Kodu', 'scopeCode'],
      ['Taraf', 'sideLabel'],
      ['Raf', 'shelfNo'],
      ['Kat', 'levelNo'],
      ['Göz Kodu', 'locationCodeLabel'],
      ['Göz Durumu', 'statusLabel'],
    ],
  },
  {
    id: 'product',
    title: 'Ürün Bilgisi',
    fields: [
      ['Ürün Adı', 'productName'],
      ['SKU', 'sku'],
      ['Barkod', 'barcode'],
      ['Kategori', 'categoryName'],
      ['Birim', 'unitLabel'],
      ['Saklama Tipi', 'storageTypeLabel'],
    ],
  },
  {
    id: 'operational',
    title: 'Operasyon Bilgisi',
    fields: [
      ['Doluluk', 'occupancyLabel'],
      ['Göz Kapasitesi', 'capacityLabel'],
      ['Göz Desisi', 'slotDesiLabel'],
      ['Kritik Stok', 'criticalLabel'],
      ['Son Besleme', 'lastFeedAtLabel'],
      ['Son Hareket', 'lastMovementAtLabel'],
    ],
  },
];

const WAREHOUSE_DETAIL_GROUPS = [
  {
    id: 'location',
    title: 'Lokasyon Bilgisi',
    fields: [
      ['Lokasyon Tipi', 'locationTypeLabel'],
      ['Lokasyon Kodu', 'locationCodeLabel'],
      ['Depo Bilgisi', 'scopeLabel'],
      ['Sıra', 'rowLabel'],
      ['Taraf', 'sideLabel'],
      ['Raf', 'shelfNo'],
      ['Kat', 'levelNo'],
      ['Lokasyon Durumu', 'statusLabel'],
    ],
  },
  {
    id: 'product',
    title: 'Ürün Bilgisi',
    fields: [
      ['Ürün Adı', 'productName'],
      ['SKU', 'sku'],
      ['Barkod', 'barcode'],
      ['Kategori', 'categoryName'],
      ['Saklama Tipi', 'storageTypeLabel'],
      ['Mevcut Stok', 'stockLabel'],
      ['Kapasite', 'capacityLabel'],
      ['Doluluk', 'occupancyLabel'],
    ],
  },
  {
    id: 'operational',
    title: 'Operasyon Bilgisi',
    fields: [
      ['Son Giriş', 'lastInAt'],
      ['Son Çıkış', 'lastOutAt'],
    ],
  },
];

const storageTypeLabel = (value) => formatStorageTypeLabel(value);

const locationDisplayLabel = (value) => formatDepotLocationLabel(value, value || '-');

const storageToneClass = (value) => {
  if (value === 'cold_chain') return 'is-cold';
  if (value === 'freezer') return 'is-freezer';
  return 'is-Ortam';
};

const statusTone = (value) => {
  if (value === 'Kritik') return 'danger';
  if (value === 'Dolu') return 'success';
  if (value === 'Boş' || value === 'Bos') return 'neutral';
  return 'neutral';
};

const isEmptyStatus = (value) => value === 'Bos' || value === 'Boş';
const statusLabel = (value) => (value === 'Bos' ? 'Boş' : value);

const formatDateTimeLabel = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('tr-TR');
};

const toPercent = (value) => `${Number(value || 0).toFixed(0)}%`;
const occupancyValue = (value) => Math.max(0, Math.min(100, Number(value || 0)));
const clampPercent = (value) => Math.max(0, Math.min(100, Number(value || 0)));
const storageTypeShortLabel = (value) => {
  if (value === 'cold_chain') return 'Soğuk';
  if (value === 'freezer') return 'Donuk';
  return 'Ortam';
};

const sectionCode = (numberValue) => `R-${String(numberValue || 0).padStart(2, '0')}`;
const sectionLocationCode = (sectionNo, side, shelfNo, levelNo) => `R${String(sectionNo || 0).padStart(2, '0')}-${side}-${String(shelfNo).padStart(2, '0')}-${String(levelNo).padStart(2, '0')}`;
const sectionSlotKey = (sectionId, item = {}) => {
  if (!sectionId || !item.shelfSide || !item.shelfNo || !item.shelfLevel) return null;
  return `${sectionId}-${item.shelfSide}-${item.shelfNo}-${item.shelfLevel}`;
};

const movementTypeLabel = (movement = {}) => {
  if (movement.reasonCode === 'transfer_to_shelf') return 'Besleme';
  if (movement.type === 'TRANSFER') return 'Transfer';
  if (movement.type === 'IN') return 'Giriş';
  if (movement.type === 'OUT') return 'Çıkış';
  if (movement.type === 'ADJUSTMENT') return 'Düzeltme';
  return movement.type || '-';
};

function LocationFilters({ locationType, categoryOptions, sectionOptions, filters, actions, onApply }) {
  return (
    <>
      <FilterBar
        className="products-filter-bar-minimal location-toolbar-filter-bar"
        actions={(
          <>
            <button className="primary-button" type="button" onClick={onApply}>Filtrele</button>
            <button className="ghost-button" type="button" onClick={actions.resetFilters}>Temizle</button>
          </>
        )}
      >
        <label className="field-group">
          <span><Search size={14} /> Arama</span>
          <input value={filters.searchText} onChange={(event) => actions.setSearchText(event.target.value)} placeholder="SKU, barkod, ürün ara" />
        </label>
        <label className="field-group">
          <span>SKU</span>
          <input value={filters.skuSearch} onChange={(event) => actions.setSkuSearch(event.target.value)} placeholder="SKU ara" />
        </label>
        <label className="field-group">
          <span>Barkod</span>
          <input value={filters.barcodeSearch} onChange={(event) => actions.setBarcodeSearch(event.target.value)} placeholder="Barkod ara" />
        </label>
        <label className="field-group">
          <span><Filter size={14} /> Kategori</span>
          <select value={filters.categoryFilter} onChange={(event) => actions.setCategoryFilter(event.target.value)}>
            <option value="">Tüm Kategoriler</option>
            {categoryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        {locationType === LOCATION_TYPES.SECTION ? (
          <label className="field-group">
            <span>Reyon</span>
            <select value={filters.sectionFilter} onChange={(event) => actions.setSectionFilter(event.target.value)}>
              <option value="">Tüm Reyonlar</option>
              {sectionOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="field-group">
          <span>Durum</span>
          <select value={filters.statusFilter} onChange={(event) => actions.setStatusFilter(event.target.value)}>
            <option value="">Tüm Durumlar</option>
            <option value="Bos">Boş</option>
            <option value="Dolu">Dolu</option>
            <option value="Kritik">Kritik</option>
            <option value="cold_chain">Soğuk</option>
            <option value="freezer">Donuk / Dondurucu</option>
            <option value="Ortam">Ortam</option>
            <option value="needs_refill">Besleme Gereken</option>
          </select>
        </label>
        <label className="field-group">
          <span>Reyon No / Lokasyon Kodu</span>
          <input value={filters.locationCodeSearch} onChange={(event) => actions.setLocationCodeSearch(event.target.value)} placeholder="Örn. R03-L-02-01" />
        </label>
        <label className="field-group">
          <span>Doluluk</span>
          <select value={filters.occupancyFilter} onChange={(event) => actions.setOccupancyFilter(event.target.value)}>
            <option value="">Tümü</option>
            <option value="high">%80 ve üzeri</option>
            <option value="mid">%40 - %79</option>
            <option value="low">%0 - %39</option>
          </select>
        </label>
      </FilterBar>

    </>
  );
}

function LocationHeader({ locationType, onLocationTypeChange, categoryOptions, sectionOptions, filters, actions, onApply }) {
  return (
    <>
      <PageHeader
        className="dashboard-hero"
        icon={<MapPin size={22} />}
        title="Lokasyon Yönetimi"
        description="Depo ve reyon lokasyonlarını analiz edin."
      />

      <section className="location-type-switch-wrap" aria-label="Lokasyon tipi seçimi">
        <span className="location-type-switch-label">Lokasyon Tipi</span>
        <div className="location-type-toggle location-type-toggle-hero" role="group" aria-label="Lokasyon tipi seçimi">
          <button
            type="button"
            className={locationType === LOCATION_TYPES.SECTION ? 'active' : ''}
            aria-pressed={locationType === LOCATION_TYPES.SECTION}
            onClick={() => onLocationTypeChange(LOCATION_TYPES.SECTION)}
          >
            <MapPin size={14} /> Reyon
          </button>
          <button
            type="button"
            className={locationType === LOCATION_TYPES.WAREHOUSE ? 'active' : ''}
            aria-pressed={locationType === LOCATION_TYPES.WAREHOUSE}
            onClick={() => onLocationTypeChange(LOCATION_TYPES.WAREHOUSE)}
          >
            <Warehouse size={14} /> Depo
          </button>
        </div>
      </section>

      <div className="mod-card location-toolbar-card products-filter-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-violet"><Filter size={18} /></div>
          <div><h3>Filtreler</h3><p>Lokasyon listesini daraltmak için filtreleyin</p></div>
        </div>
        <LocationFilters
          locationType={locationType}
          categoryOptions={categoryOptions}
          sectionOptions={sectionOptions}
          filters={filters}
          actions={actions}
          onApply={onApply}
        />
      </div>
    </>
  );
}

function LocationSummaryCards({ items }) {
  return (
    <section className="location-summary-grid">
      {items.map((item) => (
        <div className="mod-stat" key={item.label}>
          <div className={`mod-stat-icon ${item.iconClass || 'mod-icon-blue'}`}>{item.icon || <Boxes size={20} />}</div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">{item.label}</span>
            <span className="mod-stat-value">{item.value}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function LocationLegend() {
  return (
    <div className="location-legend">
      <span><i className="legend-dot is-empty"></i> Boş</span>
      <span><i className="legend-dot is-full"></i> Dolu</span>
      <span><Thermometer size={14} /> Ortam</span>
      <span><Snowflake size={14} /> Soğuk</span>
      <span><Snowflake size={14} /> Dondurucu</span>
    </div>
  );
}

function LocationDetailPanel({ locationType, selectedLocation, onMove, onCreateRefillRequest, onViewRefillHistory, onMoveSlot }) {
  const detailGroups = locationType === LOCATION_TYPES.SECTION ? SECTION_DETAIL_GROUPS : WAREHOUSE_DETAIL_GROUPS;
  const isSectionMode = locationType === LOCATION_TYPES.SECTION;
  const isSelectedEmpty = selectedLocation ? isEmptyStatus(selectedLocation.status) : false;
  const locationGroup = detailGroups.find((group) => group.id === 'location') || detailGroups[0];
  const productGroup = detailGroups.find((group) => group.id === 'product') || detailGroups[1];
  const operationalGroup = detailGroups.find((group) => group.id === 'operational') || detailGroups[2];

  const renderGroup = (group, keyPrefix = '') => (
    <section className={`location-detail-group location-detail-group-${group.id}`} key={`${keyPrefix}${group.id}`}>
      <header className="location-detail-group-head">
        <h4>{group.title}</h4>
      </header>
      <div className={`location-detail-items location-detail-items-${group.id}`}>
        {group.fields.map(([label, key]) => {
          const value = selectedLocation ? (selectedLocation[key] || '-') : '-';
          const isPlaceholder = !selectedLocation || !selectedLocation[key];
          return (
            <article className={`location-detail-item location-detail-item-${group.id}`} key={`${keyPrefix}${group.id}-${label}-${key}`}>
              <span>{label}</span>
              <strong className={isPlaceholder ? 'is-placeholder' : ''}>{value}</strong>
            </article>
          );
        })}
      </div>
    </section>
  );

  const renderActionFooter = () => {
    if (isSectionMode && isSelectedEmpty) {
      return (
        <div className="location-empty-actions">
          <p>Bu raf gözü boş.</p>
          <button className="ghost-button" type="button" onClick={onCreateRefillRequest}><ListChecks size={14} /> Reyon Besleme Talebi</button>
        </div>
      );
    }

    if (isSectionMode && selectedLocation && !isSelectedEmpty) {
      return (
        <div className="location-empty-actions">
          <p>Bu raf gözünde ürün bulunuyor.</p>
          <button className="ghost-button" type="button" onClick={onViewRefillHistory}><Clock3 size={14} /> Besleme Geçmişi</button>
          <button className="ghost-button" type="button" onClick={onMoveSlot}><Shuffle size={14} /> Göz Değiştir</button>
        </div>
      );
    }

    if (!isSectionMode && selectedLocation) {
      return (
        <div className="location-empty-actions">
          <p>{isSelectedEmpty ? 'Bu depo lokasyonu boş.' : 'Bu depo lokasyonunda ürün bulunuyor.'}</p>
          <button className="primary-button" type="button" onClick={onMove} disabled={isSelectedEmpty}><Shuffle size={14} /> Ürün Taşı</button>
        </div>
      );
    }

    return (
      <div className="location-empty-actions location-empty-actions-disabled">
        <p>Aksiyonlar için listeden bir lokasyon seçin.</p>
        <button className="ghost-button" type="button" disabled>Göz Değiştir</button>
      </div>
    );
  };

  return (
    <aside className="location-right-detail mod-card">
      <div className="mod-card-header">
        <div className="mod-card-icon mod-icon-violet"><MapPin size={18} /></div>
        <div>
          <h3>Lokasyon Detayı</h3>
          <p>Tek tıkla seçili lokasyon ayrıntıları</p>
        </div>
      </div>

      {selectedLocation ? (
        <div className="location-right-detail-body">
          <div className="location-detail-groups location-detail-groups-two-column">
            <div className="location-detail-column location-detail-column-left">
              {locationGroup ? renderGroup(locationGroup) : null}
            </div>
            <div className="location-detail-column location-detail-column-right">
              {productGroup ? renderGroup(productGroup) : null}
              {operationalGroup ? renderGroup(operationalGroup) : null}
            </div>
          </div>
          <div className="location-detail-footer">
            {renderActionFooter()}
          </div>
        </div>
      ) : (
        <div className="location-right-detail-body">
          <div className="location-detail-groups location-detail-groups-two-column" aria-hidden="true">
            <div className="location-detail-column location-detail-column-left">
              {locationGroup ? renderGroup(locationGroup, 'empty-') : null}
            </div>
            <div className="location-detail-column location-detail-column-right">
              {productGroup ? renderGroup(productGroup, 'empty-') : null}
              {operationalGroup ? renderGroup(operationalGroup, 'empty-') : null}
            </div>
          </div>
          <div className="location-detail-footer">
            {renderActionFooter()}
          </div>
        </div>
      )}
    </aside>
  );
}

function ReyonGridView({ selectedSection, rows, selectedLocationCode, setSelectedLocationCode }) {
  const levelNumbers = [1, 2, 3, 4, 5];
  const shelfNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const sideConfigs = useMemo(() => ([
    { key: 'L', label: 'Sol Hat', description: 'Koridorun sol raf yüzeyi' },
    { key: 'R', label: 'Sağ Hat', description: 'Koridorun sağ raf yüzeyi' },
  ]), []);

  const gridMap = useMemo(() => rows.reduce((acc, row) => {
    acc[`${row.side}-${row.shelfNo}-${row.levelNo}`] = row;
    return acc;
  }, {}), [rows]);

  const sideStats = useMemo(() => sideConfigs.reduce((acc, side) => {
    const sideRows = rows.filter((row) => row.side === side.key);
    const totalSlots = 50;
    const occupiedSlots = sideRows.filter((row) => !isEmptyStatus(row.status)).length;
    const criticalSlots = sideRows.filter((row) => row.isCritical).length;
    const avgOccupancy = occupiedSlots ? sideRows.reduce((sum, row) => sum + occupancyValue(row.occupancyPercent), 0) / occupiedSlots : 0;
    acc[side.key] = {
      occupiedSlots,
      emptySlots: Math.max(totalSlots - occupiedSlots, 0),
      criticalSlots,
      avgOccupancy,
    };
    return acc;
  }, {}), [rows, sideConfigs]);

  const renderCell = (sideKey, shelfNo, levelNo) => {
    const row = gridMap[`${sideKey}-${shelfNo}-${levelNo}`];
    const isSelected = selectedLocationCode === row?.locationCode;
    const occupancy = occupancyValue(row?.occupancyPercent);
    const status = row?.status || 'Bos';
    const locationLabel = row?.locationCodeLabel || sectionLocationCode(selectedSection?.number, sideKey, shelfNo, levelNo);
    const primaryLabel = row?.sku || locationLabel;
    const secondaryLabel = row?.productName || (isEmptyStatus(status) ? 'Lokasyon boş' : storageTypeShortLabel(row?.storageType));

    return (
      <button
        key={`${sideKey}-${shelfNo}-${levelNo}`}
        className={`lm-shelf-slot ${isEmptyStatus(status) ? 'is-empty' : 'has-item'} ${storageToneClass(row?.storageType || 'Ortam')} status-${String(status).toLowerCase()} ${row?.isCritical ? 'is-critical' : ''} ${isSelected ? 'is-selected' : ''}`}
        type="button"
        onClick={() => row?.locationCode && setSelectedLocationCode(row.locationCode)}
        title={`${locationLabel} | ${row?.statusLabel || statusLabel(status)} | ${row?.productName || 'Boş'} | ${row?.stockLabel || '0'} / ${row?.capacityLabel || '0'}`}
      >
        <span className="lm-shelf-slot-kicker">{locationLabel}</span>
        <span className="lm-cell-topline">
          <strong>{primaryLabel}</strong>
        </span>
        <span className="lm-cell-subline">{secondaryLabel}</span>
        <span className="lm-shelf-slot-meta">
          <em>{row?.statusLabel || statusLabel(status)}</em>
          <span>{row?.stockLabel || '0'} / {row?.capacityLabel || '0'}</span>
        </span>
        <span className="lm-cell-metrics">
          <span>{row?.occupancyLabel || toPercent(occupancy)}</span>
          <span>{storageTypeShortLabel(row?.storageType)}</span>
        </span>
        <span className="lm-shelf-slot-meter">
          <span className="lm-cell-progress" aria-hidden="true"><i style={{ width: `${occupancy}%` }} /></span>
        </span>
      </button>
    );
  };

  return (
    <div className="location-detail-panel mod-card">
      <div className="mod-card-header">
        <div className="mod-card-icon mod-icon-indigo"><MapPin size={18} /></div>
        <div>
          <h3>Reyon Grid</h3>
          <p>{selectedSection ? `${selectedSection.name} için daha yoğun raf-kat matrisi` : 'Reyon seçin'}</p>
        </div>
      </div>
      <div className="lm-grid-shell lm-grid-shell-section">
        <div className="lm-grid-toolbar lm-grid-toolbar-section-shelf">
          <div className="lm-grid-toolbar-copy">
            <strong>{selectedSection?.code || 'Reyon seçilmedi'}</strong>
            <span>Reyon yüzeyi raf sıraları ve ürün gözleriyle market rafı gibi okunacak şekilde düzenlendi.</span>
          </div>
          <LocationLegend />
        </div>
        <div className="lm-reyon-shelf-faces">
          {sideConfigs.map((side) => {
            const stats = sideStats[side.key] || { occupiedSlots: 0, emptySlots: 50, criticalSlots: 0, avgOccupancy: 0 };
            return (
              <section className="lm-shelf-face" key={side.key}>
                <header className="lm-shelf-face-head">
                  <div>
                    <h4>{side.label}</h4>
                    <p>{side.description}</p>
                  </div>
                  <div className="lm-shelf-face-stats">
                    <span><strong>{stats.occupiedSlots}</strong> dolu</span>
                    <span><strong>{stats.emptySlots}</strong> boş</span>
                    <span><strong>{stats.criticalSlots}</strong> kritik</span>
                    <span><strong>{toPercent(stats.avgOccupancy)}</strong> ort. doluluk</span>
                  </div>
                </header>
                <div className="lm-shelf-bay-head" aria-hidden="true">
                  <span className="lm-shelf-bay-head-label">Raf</span>
                  {levelNumbers.map((levelNo) => <span key={`${side.key}-head-${levelNo}`}>Bölme {levelNo}</span>)}
                </div>
                <div className="lm-shelf-wall" role="grid" aria-label={`${side.label} raf matrisi`}>
                  {shelfNumbers.map((shelfNo) => (
                    <div className="lm-shelf-row" key={`${side.key}-shelf-${shelfNo}`}>
                      <div className="lm-shelf-row-label">
                        <strong>{side.key}{String(shelfNo).padStart(2, '0')}</strong>
                        <span>Raf {shelfNo}</span>
                      </div>
                      <div className="lm-shelf-row-track">
                        {levelNumbers.map((levelNo) => renderCell(side.key, shelfNo, levelNo))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DepotGridView({ selectedWarehouseRowNo, setSelectedWarehouseRowNo, selectedWarehouseSide, setSelectedWarehouseSide, warehouseGridMap, selectedLocationCode, setSelectedLocationCode }) {
  const selectedRowSideValue = `${selectedWarehouseRowNo}-${selectedWarehouseSide}`;
  const rowSideOptions = [
    { value: '1-L', label: 'D1 Sol' },
    { value: '1-R', label: 'D1 Sağ' },
    { value: '2-L', label: 'D2 Sol' },
    { value: '2-R', label: 'D2 Sağ' },
    { value: '3-L', label: 'D3 Sol' },
    { value: '3-R', label: 'D3 Sağ' },
  ];
  const selectedCells = useMemo(() => Object.values(warehouseGridMap || {}), [warehouseGridMap]);
  const depotStats = useMemo(() => {
    const totalSlots = 150;
    const occupiedSlots = selectedCells.filter((row) => row && !isEmptyStatus(row.status)).length;
    const criticalSlots = selectedCells.filter((row) => row?.isCritical).length;
    const coldSlots = selectedCells.filter((row) => row?.storageType === 'cold_chain').length;
    const freezerSlots = selectedCells.filter((row) => row?.storageType === 'freezer').length;
    return {
      occupiedSlots,
      emptySlots: Math.max(totalSlots - occupiedSlots, 0),
      criticalSlots,
      coldSlots,
      freezerSlots,
    };
  }, [selectedCells]);

  const renderDepotCell = (shelfNo, levelNo) => {
    const row = warehouseGridMap[`${shelfNo}-${levelNo}`];
    const status = row?.status || 'Bos';
    const isSelected = selectedLocationCode === row?.locationCode;
    const occupancy = occupancyValue(row?.occupancyPercent);
    const label = row?.sku || (isEmptyStatus(status) ? 'Boş' : locationDisplayLabel(row?.locationCode));

    return (
      <button
        key={`depot-cell-${shelfNo}-${levelNo}`}
        className={`lm-matrix-cell lm-matrix-cell-depot depot-cell ${isEmptyStatus(status) ? 'is-empty' : 'has-item'} ${storageToneClass(row?.storageType || 'Ortam')} status-${status.toLowerCase().replace(/\s+/g, '-')} ${isSelected ? 'is-selected' : ''}`}
        type="button"
        onClick={() => row?.locationCode && setSelectedLocationCode(row.locationCode)}
        title={`${row?.locationCodeLabel || locationDisplayLabel(row?.locationCode)} | ${row?.statusLabel || statusLabel(status)} | ${row?.productName || 'Boş'} | ${row?.stockLabel || '0'} / ${row?.capacityLabel || '0'} | ${storageTypeLabel(row?.storageType || 'Ortam')}`}
      >
        <span className="lm-cell-cap" aria-hidden="true"><i style={{ width: `${occupancy}%` }} /></span>
        <strong>{label}</strong>
        <small>{row?.statusLabel || statusLabel(status)}</small>
        <span className="lm-cell-foot">{row ? `${row.stockLabel || '0'} / ${row.capacityLabel || '0'}` : '0 / 0'} • {storageTypeShortLabel(row?.storageType)}</span>
      </button>
    );
  };

  return (
    <div className="location-detail-panel mod-card">
      <div className="mod-card-header">
        <div className="mod-card-icon mod-icon-blue"><Warehouse size={18} /></div>
        <div>
          <h3>Depo Yerleşim Gridi</h3>
          <p>3 sıra x 2 taraf x 15 raf x 10 kat (900 lokasyon)</p>
        </div>
      </div>
      <div className="lm-grid-shell lm-grid-shell-depot">
        <div className="lm-grid-toolbar lm-grid-toolbar-depot">
          <div className="lm-grid-toolbar-copy">
            <strong>{`D${selectedWarehouseRowNo} · ${selectedWarehouseSide === 'L' ? 'Sol' : 'Sağ'} Koridor`}</strong>
            <span>Seçili koridor için 15 x 10 matriste doluluk ve saklama tipi aynı yüzeyde okunur.</span>
          </div>
          <LocationLegend />
        </div>

        <div className="lm-depot-context">
          <div className="lm-depot-switcher" role="tablist" aria-label="Depo sıra ve taraf seçimi">
            {rowSideOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={selectedRowSideValue === option.value ? 'is-active' : ''}
                aria-pressed={selectedRowSideValue === option.value}
                onClick={() => {
                  const [rowNo, side] = option.value.split('-');
                  setSelectedWarehouseRowNo(rowNo || '1');
                  setSelectedWarehouseSide(side || 'L');
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="lm-depot-metrics">
            <span><strong>{depotStats.occupiedSlots}</strong> dolu</span>
            <span><strong>{depotStats.emptySlots}</strong> boş</span>
            <span><strong>{depotStats.criticalSlots}</strong> kritik</span>
            <span><strong>{depotStats.coldSlots}</strong> soğuk</span>
            <span><strong>{depotStats.freezerSlots}</strong> donuk</span>
          </div>
        </div>

        <div className="lm-grid-scroll">
          <div className="lm-matrix-grid lm-matrix-grid-depot" role="grid" aria-label="Depo yerleşim matrisi">
            <div className="lm-matrix-corner">Raf</div>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((levelNo) => <div className="lm-matrix-axis lm-matrix-axis-top" key={`depot-head-${levelNo}`}>K{levelNo}</div>)}
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].flatMap((shelfNo) => ([
              <div className="lm-matrix-axis lm-matrix-axis-side" key={`depot-row-${shelfNo}`}>{selectedWarehouseSide}{String(shelfNo).padStart(2, '0')}</div>,
              ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((levelNo) => renderDepotCell(shelfNo, levelNo)),
            ]))}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildCommonPredicate(filters, criticalMap) {
  const hasStorageToggles = filters.onlyOrtam || filters.onlyCold || filters.onlyFreezer;
  return (row) => {
    const query = normalizeSearchText(filters.searchText);
    const skuQuery = normalizeSearchText(filters.skuSearch);
    const barcodeQuery = normalizeSearchText(filters.barcodeSearch);
    const searchMatch = !query || [row.productName, row.sku, row.barcode, row.locationCode]
      .filter(Boolean)
      .some((value) => includesNormalized(value, query));

    const skuMatch = !skuQuery || includesNormalized(row.sku, skuQuery);
    const barcodeMatch = !barcodeQuery || includesNormalized(row.barcode, barcodeQuery);

    const categoryMatch = !filters.categoryFilter || String(row.categoryName || '') === filters.categoryFilter;
    const sectionMatch = !filters.sectionFilter || String(row.sectionId || '') === filters.sectionFilter;
    const sideMatch = !filters.sideFilter || String(row.side || '') === String(filters.sideFilter || '');
    const locationCodeMatch = !filters.locationCodeSearch.trim() || includesNormalized(row.locationCode, filters.locationCodeSearch);

    const emptyMatch = !filters.onlyEmpty || isEmptyStatus(row.status);
    const filledMatch = !filters.onlyFilled || row.status === 'Dolu';
    const criticalThreshold = Number(criticalMap.get(row.productId) || 0);
    const isCritical = Boolean(row.productId) && Number(row.stockNumeric || 0) <= criticalThreshold;
    const criticalMatch = !filters.onlyCritical || isCritical;
    const statusMatch = !filters.statusFilter || (() => {
      if (filters.statusFilter === 'Kritik') return isCritical;
      if (filters.statusFilter === 'Bos') return isEmptyStatus(row.status);
      if (filters.statusFilter === 'cold_chain') return row.storageType === 'cold_chain';
      if (filters.statusFilter === 'freezer') return row.storageType === 'freezer';
      if (filters.statusFilter === 'Ortam') return row.storageType === 'Ortam';
      if (filters.statusFilter === 'needs_refill') return Boolean(row.refillNeeded);
      return row.status === filters.statusFilter;
    })();

    const storageChecks = [];
    if (filters.onlyOrtam) storageChecks.push(row.storageType === 'Ortam');
    if (filters.onlyCold) storageChecks.push(row.storageType === 'cold_chain');
    if (filters.onlyFreezer) storageChecks.push(row.storageType === 'freezer');
    const storageMatch = !hasStorageToggles || storageChecks.some(Boolean);

    const occupancyValue = Number(row.occupancyPercent || 0);
    const occupancyMatch = !filters.occupancyFilter
      || (filters.occupancyFilter === 'high' && occupancyValue >= 80)
      || (filters.occupancyFilter === 'mid' && occupancyValue >= 40 && occupancyValue < 80)
      || (filters.occupancyFilter === 'low' && occupancyValue < 40);

    const refillMatch = !filters.onlyNeedsRefill || Boolean(row.refillNeeded);

    return searchMatch
      && skuMatch
      && barcodeMatch
      && categoryMatch
      && sectionMatch
      && sideMatch
      && locationCodeMatch
      && statusMatch
      && emptyMatch
      && filledMatch
      && criticalMatch
      && storageMatch
      && occupancyMatch
      && refillMatch;
  };
}

export default function LocationManagementPage() {
  const [locationType, setLocationType] = useState(LOCATION_TYPES.SECTION);

  const [searchText, setSearchText] = useState('');
  const [skuSearch, setSkuSearch] = useState('');
  const [barcodeSearch, setBarcodeSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [sideFilter, setSideFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [occupancyFilter, setOccupancyFilter] = useState('');
  const [locationCodeSearch, setLocationCodeSearch] = useState('');

  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [onlyCritical, setOnlyCritical] = useState(false);
  const [onlyCold, setOnlyCold] = useState(false);
  const [onlyFreezer, setOnlyFreezer] = useState(false);
  const [onlyOrtam, setOnlyOrtam] = useState(false);
  const [onlyNeedsRefill, setOnlyNeedsRefill] = useState(false);

  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [selectedLocationCode, setSelectedLocationCode] = useState('');
  const [sectionListSearch, setSectionListSearch] = useState('');
  const sectionListRef = useRef(null);
  const sectionListSearchInputRef = useRef(null);
  const selectedLocationRef = useRef(null);
  const [selectedWarehouseRowNo, setSelectedWarehouseRowNo] = useState('1');
  const [selectedWarehouseSide, setSelectedWarehouseSide] = useState('L');

  const [sections, setSections] = useState([]);
  const [products, setProducts] = useState([]);
  const [selectedSectionProducts, setSelectedSectionProducts] = useState([]);
  const [warehouseRows, setWarehouseRows] = useState([]);
  const [warehouseSummary, setWarehouseSummary] = useState(null);
  const [derivedDepotAssignments, setDerivedDepotAssignments] = useState([]);
  const [derivedDepotZones, setDerivedDepotZones] = useState([]);
  const [derivedShelfPlan, setDerivedShelfPlan] = useState([]);
  const [derivedShelfZones, setDerivedShelfZones] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSectionDetailLoading, setIsSectionDetailLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [transferModal, setTransferModal] = useState({
    isOpen: false,
    transferDirection: 'warehouse_to_section',
    sourceLocationCode: '',
    sourceProductLabel: '',
    targetLocationCode: '',
  });
  const [movementModal, setMovementModal] = useState({
    isOpen: false,
    isLoading: false,
    locationCode: '',
    productLabel: '',
    rows: [],
    error: '',
  });
  const [refillHistoryModal, setRefillHistoryModal] = useState({
    isOpen: false,
    isLoading: false,
    locationCode: '',
    productLabel: '',
    rows: [],
    summary: {
      lastFeedAt: '',
      totalQty: 0,
      operationNote: '-',
      movementCount: 0,
    },
    error: '',
  });
  const [slotMoveModal, setSlotMoveModal] = useState({
    isOpen: false,
    isSubmitting: false,
    sourceLocationCode: '',
    sourceProductId: '',
    sourceProductLabel: '',
    sourceStorageType: '',
    targetLocationCode: '',
    targetOptions: [],
  });

  const handleCreateRefillRequestAction = useCallback(async () => {
    const currentSelected = selectedLocationRef.current;
    if (locationType !== LOCATION_TYPES.SECTION) {
      setToast({ type: 'warning', title: 'Reyon Besleme Talebi', message: 'Besleme talebi yalnızca reyon görünümünde oluşturulabilir.' });
      return;
    }

    const sectionId = String(currentSelected?.sectionId || selectedSectionId || '').trim();
    if (!sectionId) {
      setToast({ type: 'error', title: 'Reyon Besleme Talebi', message: 'Önce bir reyon seçin.' });
      return;
    }

    const candidateProducts = selectedSectionProducts
      .filter((item) => String(item.sectionId || '') === sectionId)
      .map((item) => {
        const shelfStock = Number(item.shelfStock || 0);
        const criticalStock = Number(item.criticalStock || 0);
        const targetStock = Number(item.maxShelfStock || item.shelfMaxStock || criticalStock || 1);
        const warehouseStock = Number(item.warehouseStock || 0);
        const deficit = Math.max(0, targetStock - shelfStock);
        return {
          item,
          shelfStock,
          warehouseStock,
          criticalStock,
          targetStock,
          deficit,
          needsRefill: shelfStock <= criticalStock || deficit > 0,
        };
      })
      .filter((entry) => entry.warehouseStock > 0);

    const selectedProductId = String(currentSelected?.productId || '').trim();
    const selectedCandidate = selectedProductId ?
      candidateProducts.find((entry) => String(entry.item.id) === selectedProductId)
      : null;
    const refillCandidate = selectedCandidate
      || candidateProducts
        .filter((entry) => entry.needsRefill)
        .sort((a, b) => b.deficit - a.deficit)[0]
      || candidateProducts.sort((a, b) => b.warehouseStock - a.warehouseStock)[0]
      || null;

    if (!refillCandidate) {
      setToast({ type: 'warning', title: 'Reyon Besleme Talebi', message: 'Talep oluşturmak için depoda stoğu olan uygun ürün bulunamadı.' });
      return;
    }

    const requestedQty = Math.max(
      1,
      Math.min(
        refillCandidate.warehouseStock,
        refillCandidate.deficit > 0 ? refillCandidate.deficit : Math.max(1, refillCandidate.criticalStock || 1)
      )
    );

    try {
      const created = await sectionService.createTransferRequest(sectionId, {
        productId: refillCandidate.item.id,
        quantity: requestedQty,
        note: `Lokasyon ${locationDisplayLabel(currentSelected?.locationCode || selectedLocationCode)} için otomatik besleme talebi. Mevcut reyon stok: ${formatNumber(refillCandidate.shelfStock)} | Hedef stok: ${formatNumber(refillCandidate.targetStock)}.`,
      });
      setToast({
        type: 'success',
        title: 'Reyon Besleme Talebi',
        message: `${refillCandidate.item.name || refillCandidate.item.sku || 'Ürün'} için ${formatNumber(requestedQty)} adet talep oluşturuldu (${created?.status || 'Bekliyor'}).`,
      });
    } catch (error) {
      setToast({ type: 'error', title: 'Reyon Besleme Talebi', message: error.message || 'Besleme talebi oluşturulamadı.' });
    }
  }, [locationType, selectedLocationCode, selectedSectionId, selectedSectionProducts]);

  const closeMovementModal = useCallback(() => {
    setMovementModal({
      isOpen: false,
      isLoading: false,
      locationCode: '',
      productLabel: '',
      rows: [],
      error: '',
    });
  }, []);

  const handleViewMovementsAction = useCallback(async () => {
    const currentSelected = selectedLocationRef.current;
    const locationCode = String(currentSelected?.locationCode || selectedLocationCode || '').trim();
    const productId = String(currentSelected?.productId || '').trim();
    if (!locationCode || !productId) {
      setToast({ type: 'error', title: 'Stok Hareketleri', message: 'Önce ürün bulunan bir lokasyon seçin.' });
      return;
    }

    setMovementModal({
      isOpen: true,
      isLoading: true,
      locationCode,
      productLabel: String(currentSelected?.productName || currentSelected?.sku || '-'),
      rows: [],
      error: '',
    });

    try {
      const movements = await stockService.getMovements({ productId, forceRefresh: true });
      const normalizedRows = (Array.isArray(movements) ? movements : [])
        .filter((movement) => ['IN', 'OUT', 'ADJUSTMENT', 'TRANSFER'].includes(String(movement.type || '').toUpperCase()))
        .map((movement) => {
          const operationSource = [
            movement.referenceNo ? `Ref: ${movement.referenceNo}` : '',
            movement.reasonLabel || movement.reasonCode || '',
            movement.warehouseLocation ? `Depo Lokasyonu: ${locationDisplayLabel(movement.warehouseLocation)}` : '',
            movement.sourceLocationCode ? `Kaynak Kodu: ${locationDisplayLabel(movement.sourceLocationCode)}` : '',
            movement.fromLocationLabel || movement.fromLocation ? `Kaynak: ${movement.fromLocationLabel || movement.fromLocation}` : '',
            movement.toLocationLabel || movement.toLocation ? `Hedef: ${movement.toLocationLabel || movement.toLocation}` : '',
            movement.note ? `Not: ${movement.note}` : '',
          ].filter(Boolean).join(' • ');

          return {
            id: movement.id,
            createdAt: movement.createdAt,
            createdAtLabel: formatDateTimeLabel(movement.createdAt),
            typeLabel: movementTypeLabel(movement),
            qtyLabel: formatNumber(movement.qty || 0),
            userName: movement.userName || '-',
            operationSource: operationSource || '-',
          };
        })
        .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));

      setMovementModal((current) => ({ ...current, isLoading: false, rows: normalizedRows, error: '' }));
    } catch (error) {
      setMovementModal((current) => ({ ...current, isLoading: false, rows: [], error: error.message || 'Hareket geçmişi alınamadı.' }));
    }
  }, [selectedLocationCode]);

  const closeRefillHistoryModal = useCallback(() => {
    setRefillHistoryModal({
      isOpen: false,
      isLoading: false,
      locationCode: '',
      productLabel: '',
      rows: [],
      summary: {
        lastFeedAt: '',
        totalQty: 0,
        operationNote: '-',
        movementCount: 0,
      },
      error: '',
    });
  }, []);

  const handleViewRefillHistoryAction = useCallback(async () => {
    const currentSelected = selectedLocationRef.current;
    const locationCode = String(currentSelected?.locationCode || selectedLocationCode || '').trim();
    const productId = String(currentSelected?.productId || '').trim();
    if (!locationCode || !productId) {
      setToast({ type: 'error', title: 'Besleme Geçmişi', message: 'Önce ürün bulunan bir lokasyon seçin.' });
      return;
    }

    setRefillHistoryModal({
      isOpen: true,
      isLoading: true,
      locationCode,
      productLabel: String(currentSelected?.productName || currentSelected?.sku || '-'),
      rows: [],
      summary: {
        lastFeedAt: '',
        totalQty: 0,
        operationNote: '-',
        movementCount: 0,
      },
      error: '',
    });

    try {
      const movements = await stockService.getMovements({ productId, forceRefresh: true });
      const refillRows = (Array.isArray(movements) ? movements : [])
        .filter((movement) => {
          const reasonCode = String(movement.reasonCode || '').toLowerCase();
          const note = String(movement.note || '').toLowerCase();
          return reasonCode === 'transfer_to_shelf'
            || (String(movement.type || '').toUpperCase() === 'TRANSFER' && String(movement.toLocation || '').toLowerCase() === 'reyon')
            || note.includes('besleme');
        })
        .map((movement) => ({
          id: movement.id,
          createdAt: movement.createdAt,
          createdAtLabel: formatDateTimeLabel(movement.createdAt),
          qty: Number(movement.qty || 0),
          qtyLabel: formatNumber(movement.qty || 0),
          userName: movement.userName || '-',
          sourceLabel: movement.warehouseLocation ?
            `Depo ${locationDisplayLabel(movement.warehouseLocation)}`
            : (movement.fromLocationLabel || movement.fromLocation || 'Depo'),
          note: movement.note || '-',
          referenceNo: movement.referenceNo || '-',
        }))
        .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));

      const summary = {
        lastFeedAt: refillRows[0]?.createdAtLabel || '-',
        totalQty: refillRows.reduce((sum, item) => sum + Number(item.qty || 0), 0),
        operationNote: refillRows.find((item) => item.note && item.note !== '-')?.note || '-',
        movementCount: refillRows.length,
      };

      setRefillHistoryModal((current) => ({ ...current, isLoading: false, rows: refillRows, summary, error: '' }));
    } catch (error) {
      setRefillHistoryModal((current) => ({ ...current, isLoading: false, rows: [], error: error.message || 'Besleme geçmişi alınamadı.' }));
    }
  }, [selectedLocationCode]);

  const closeSlotMoveModal = useCallback(() => {
    setSlotMoveModal({
      isOpen: false,
      isSubmitting: false,
      sourceLocationCode: '',
      sourceProductId: '',
      sourceProductLabel: '',
      sourceStorageType: '',
      targetLocationCode: '',
      targetOptions: [],
    });
  }, []);

  const resetFilters = () => {
    setSearchText('');
    setSkuSearch('');
    setBarcodeSearch('');
    setCategoryFilter('');
    setSectionFilter('');
    setSideFilter('');
    setStatusFilter('');
    setOccupancyFilter('');
    setLocationCodeSearch('');
    setOnlyEmpty(false);
    setOnlyFilled(false);
    setOnlyCritical(false);
    setOnlyCold(false);
    setOnlyFreezer(false);
    setOnlyOrtam(false);
    setOnlyNeedsRefill(false);
  };

  const filters = {
    searchText,
    skuSearch,
    barcodeSearch,
    categoryFilter,
    sectionFilter,
    sideFilter,
    statusFilter,
    occupancyFilter,
    locationCodeSearch,
    onlyEmpty,
    onlyFilled,
    onlyCritical,
    onlyCold,
    onlyFreezer,
    onlyOrtam,
    onlyNeedsRefill,
  };

  const filterActions = {
    setSearchText,
    setSkuSearch,
    setBarcodeSearch,
    setCategoryFilter,
    setSectionFilter,
    setSideFilter,
    setStatusFilter,
    setOccupancyFilter,
    setLocationCodeSearch,
    setOnlyEmpty,
    setOnlyFilled,
    setOnlyCritical,
    setOnlyCold,
    setOnlyFreezer,
    setOnlyOrtam,
    setOnlyNeedsRefill,
    resetFilters,
  };

  const productCriticalMap = useMemo(() => {
    const map = new Map();
    products.forEach((item) => map.set(item.id, Number(item.criticalStock || 0)));
    return map;
  }, [products]);

  const productCategoryById = useMemo(() => {
    const map = new Map();
    products.forEach((item) => map.set(item.id, item.categoryName || '-'));
    return map;
  }, [products]);

  const productById = useMemo(() => {
    const map = new Map();
    products.forEach((item) => map.set(String(item.id), item));
    return map;
  }, [products]);

  const categoryOptions = useMemo(() => {
    const set = new Set();
    products.forEach((item) => item.categoryName && set.add(item.categoryName));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [products]);

  useEffect(() => {
    const loadAll = async () => {
      try {
        setIsLoading(true);
        const [sectionList, productList, warehouseData] = await Promise.all([
          sectionService.list(),
          productService.listForLocationManagement(),
          warehouseService.listLocations({ includeShelfDetails: false }),
        ]);

        const safeSections = Array.isArray(sectionList) ? sectionList : [];
        const safeProducts = Array.isArray(productList) ? productList : [];
        const productShelfPlan = safeProducts
          .filter((item) => item.sectionId && item.shelfSide && item.shelfNo && item.shelfLevel)
          .map((item) => ({
            sectionId: item.sectionId,
            sectionNumber: item.sectionNumber || null,
            sectionName: item.sectionName || null,
            locationCode: null,
            shelfSide: String(item.shelfSide || 'L').toUpperCase(),
            shelfNo: Number(item.shelfNo || 0),
            shelfLevel: Number(item.shelfLevel || 0),
            productId: item.id,
            productName: item.name,
            sku: item.sku,
            storageType: item.requiredStorageType || item.storageType || 'Ortam',
            shelfStock: Number(item.shelfStock || 0),
            maxShelfStock: Number(item.maxShelfStock || item.shelfCapacity || 0),
            averageDesi: Number(item.averageDesi || 0),
            isVirtualLocation: item.isVirtualLocation === true,
            capacityMode: item.capacityMode || null,
            stockingStrategy: item.stockingStrategy || null,
          }));
        setSections(safeSections);
        setProducts(safeProducts);
        setWarehouseRows(Array.isArray(warehouseData?.rows) ? warehouseData.rows : []);
        setWarehouseSummary(warehouseData?.summary || null);
        setDerivedDepotAssignments(Array.isArray(warehouseData?.depotAssignments) ? warehouseData.depotAssignments : []);
        setDerivedDepotZones(Array.isArray(warehouseData?.depotZones) ? warehouseData.depotZones : []);
        setDerivedShelfPlan(Array.isArray(warehouseData?.shelfPlan) && warehouseData.shelfPlan.length ? warehouseData.shelfPlan : productShelfPlan);
        setDerivedShelfZones(Array.isArray(warehouseData?.shelfZones) ? warehouseData.shelfZones : []);
        setSelectedSectionId((current) => current || safeSections[0]?.id || '');
      } catch (error) {
        setToast({ type: 'error', title: 'Lokasyon Yönetimi', message: error.message || 'Lokasyon verileri yüklenemedi.' });
      } finally {
        setIsLoading(false);
      }
    };

    loadAll();
  }, []);

  useEffect(() => {
    const loadSectionProducts = async () => {
      if (!selectedSectionId) {
        setSelectedSectionProducts([]);
        return;
      }

      if (Array.isArray(derivedShelfPlan) && derivedShelfPlan.length > 0) {
        const rows = derivedShelfPlan
          .filter((item) => String(item.sectionId || '') === String(selectedSectionId || ''))
          .map((item) => {
            const product = productById.get(String(item.productId || '')) || {};
            return {
              ...product,
              id: product.id || item.productId,
              sectionId: item.sectionId,
              shelfSide: item.shelfSide,
              shelfNo: item.shelfNo,
              shelfLevel: item.shelfLevel,
              requiredStorageType: item.storageType || product.requiredStorageType || 'Ortam',
              shelfStock: Number(item.shelfStock ?? product.shelfStock ?? 0),
              maxShelfStock: Number(item.maxShelfStock ?? product.maxShelfStock ?? product.shelfMaxStock ?? 0),
              averageDesi: Number(item.averageDesi ?? product.averageDesi ?? 0),
              isVirtualLocation: item.isVirtualLocation ?? product.isVirtualLocation ?? false,
              capacityMode: item.capacityMode ?? product.capacityMode ?? null,
              productName: product.name || item.productName || '-',
              sku: product.sku || item.sku || '-',
              barcode: product.barcode || '-',
              categoryName: product.categoryName || '-',
            };
          });

        setSelectedSectionProducts(rows);
        return;
      }

      try {
        setIsSectionDetailLoading(true);
        const rows = await sectionService.getProducts(selectedSectionId);
        setSelectedSectionProducts(Array.isArray(rows) ? rows : []);
      } catch (error) {
        setToast({ type: 'error', title: 'Reyon Detayı', message: error.message || 'Reyon ürünleri yüklenemedi.' });
        setSelectedSectionProducts([]);
      } finally {
        setIsSectionDetailLoading(false);
      }
    };

    loadSectionProducts();
  }, [derivedShelfPlan, productById, selectedSectionId]);

  const shelfZoneBySectionId = useMemo(() => {
    const map = new Map();
    (Array.isArray(derivedShelfZones) ? derivedShelfZones : []).forEach((item) => {
      map.set(String(item.sectionId || ''), item);
    });
    return map;
  }, [derivedShelfZones]);

  const sectionCards = useMemo(() => {
    const bySectionId = new Map();
    products.forEach((item) => {
      if (!item.sectionId) return;
      if (!bySectionId.has(item.sectionId)) bySectionId.set(item.sectionId, []);
      bySectionId.get(item.sectionId).push(item);
    });

    return sections.map((section) => {
      const sectionProducts = bySectionId.get(section.id) || [];
      const occupied = new Set(sectionProducts.map((item) => sectionSlotKey(section.id, item)).filter(Boolean));
      const skuSet = new Set(sectionProducts.map((item) => item.sku || item.id).filter(Boolean));
      const fallbackShelfStockTotal = sectionProducts.reduce((sum, item) => sum + Number(item.shelfStock || 0), 0);
      const fallbackShelfCapacityTotal = sectionProducts.reduce((sum, item) => sum + Number(item.maxShelfStock || item.shelfMaxStock || item.maxStock || 0), 0);
      const fallbackDesiRows = sectionProducts
        .map((item) => {
          const averageDesi = Number(item.averageDesi || 0);
          const shelfStock = Number(item.shelfStock || 0);
          const shelfCapacity = Number(item.maxShelfStock || item.shelfMaxStock || item.maxStock || 0);
          return { averageDesi, shelfStock, shelfCapacity };
        })
        .filter((item) => item.averageDesi > 0 && item.shelfCapacity > 0);
      const fallbackCurrentDesi = fallbackDesiRows.reduce((sum, item) => sum + (item.averageDesi * item.shelfStock), 0);
      const fallbackMaxDesi = fallbackDesiRows.reduce((sum, item) => sum + (item.averageDesi * item.shelfCapacity), 0);

      const storageCounter = { Ortam: 0, cold_chain: 0, freezer: 0 };
      sectionProducts.forEach((item) => {
        const storageType = item.requiredStorageType || 'Ortam';
        storageCounter[storageType] = (storageCounter[storageType] || 0) + 1;
      });

      const dominantStorageType = Object.entries(storageCounter).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Ortam';
      const storageVariants = Object.values(storageCounter).filter((count) => count > 0).length;
      const zone = shelfZoneBySectionId.get(String(section.id || ''));
      const totalSlotsCandidate = Number(zone?.totalPhysicalSlots ?? zone?.totalSlots ?? 100);
      const totalSlots = Number.isFinite(totalSlotsCandidate) && totalSlotsCandidate > 0 ? totalSlotsCandidate : 100;
      const uniqueOccupiedSlots = Number(zone?.occupiedPhysicalSlots ?? zone?.occupiedSlots ?? occupied.size);
      const occupiedSlots = Math.min(uniqueOccupiedSlots, totalSlots);
      const shelfStockTotal = Number(zone?.shelfStockTotal ?? fallbackShelfStockTotal);
      const shelfCapacityTotal = Number(zone?.shelfCapacityTotal ?? fallbackShelfCapacityTotal);
      const stockUsageRate = zone?.stockUsageRate !== null && zone?.stockUsageRate !== undefined
        ? clampPercent(zone.stockUsageRate)
        : shelfCapacityTotal > 0
          ? clampPercent((shelfStockTotal / shelfCapacityTotal) * 100)
          : null;
      const hasDesiData = Boolean(zone?.hasDesiData ?? fallbackMaxDesi > 0);
      const currentDesi = hasDesiData ? Number(zone?.currentDesi ?? fallbackCurrentDesi) : null;
      const maxDesi = hasDesiData ? Number(zone?.maxDesi ?? fallbackMaxDesi) : null;
      const desiUsageRate = hasDesiData && maxDesi > 0
        ? clampPercent(zone?.desiUsageRate ?? ((currentDesi / maxDesi) * 100))
        : null;

      return {
        ...section,
        code: sectionCode(section.number),
        sectionId: section.id,
        reyonType: storageVariants > 1 ? 'karma' : (dominantStorageType === 'cold_chain' ? 'soğuk' : dominantStorageType === 'freezer' ? 'dondurucu' : 'ambient'),
        categories: Array.from(new Set(sectionProducts.map((item) => item.categoryName).filter(Boolean))),
        categoryLabel: Array.from(new Set(sectionProducts.map((item) => item.categoryName).filter(Boolean))).slice(0, 2).join(', ') || '-',
        totalProducts: sectionProducts.length,
        productVarietyCount: Number(zone?.productVarietyCount ?? zone?.skuCount ?? skuSet.size),
        totalSlots,
        occupiedSlots,
        emptySlots: Math.max(0, totalSlots - occupiedSlots),
        reservedSlots: 0,
        blockedSlots: 0,
        occupancyRate: totalSlots ? clampPercent((uniqueOccupiedSlots / totalSlots) * 100) : 0,
        stockUsageRate,
        hasDesiData,
        maxDesi,
        currentDesi,
        desiUsageRate,
        maxProductCapacity: shelfCapacityTotal,
        currentProductCount: shelfStockTotal,
        dominantStorageType,
        hasCold: storageCounter.cold_chain > 0,
        hasFreezer: storageCounter.freezer > 0,
        hasOrtam: storageCounter.Ortam > 0,
        criticalCount: sectionProducts.filter((item) => Number(item.shelfStock || 0) <= Number(item.criticalStock || 0)).length,
        lastFeedAt: sectionProducts.map((item) => item.updatedAt).filter(Boolean).sort().at(-1) || null,
        lastCountAt: sectionProducts.map((item) => item.createdAt).filter(Boolean).sort().at(-1) || null,
      };
    });
  }, [products, sections, shelfZoneBySectionId]);

  const visibleSectionCards = useMemo(() => {
    return sectionCards.filter((card) => {
      const query = normalizeSearchText(searchText);
      const productMatch = !query || [card.name, card.code, ...(card.categories || [])]
        .filter(Boolean)
        .some((value) => includesNormalized(value, query));
      const sectionMatch = !sectionFilter || card.id === sectionFilter;
      const emptyMatch = !onlyEmpty || card.emptySlots > 0;
      const fullMatch = !onlyFilled || card.occupiedSlots > 0;
      const criticalMatch = !onlyCritical || card.criticalCount > 0;
      const storageChecks = [];
      if (onlyOrtam) storageChecks.push(card.dominantStorageType === 'Ortam');
      if (onlyCold) storageChecks.push(card.dominantStorageType === 'cold_chain');
      if (onlyFreezer) storageChecks.push(card.dominantStorageType === 'freezer');
      const storageMatch = !storageChecks.length || storageChecks.some(Boolean);
      return productMatch && sectionMatch && emptyMatch && fullMatch && criticalMatch && storageMatch;
    });
  }, [onlyOrtam, onlyCold, onlyCritical, onlyEmpty, onlyFilled, onlyFreezer, searchText, sectionCards, sectionFilter]);

  const listedSectionCards = useMemo(() => {
    const query = normalizeSearchText(sectionListSearch);
    if (!query) return visibleSectionCards;

    return visibleSectionCards.filter((card) => [
      card.name,
      card.code,
      card.categoryLabel,
      card.reyonType,
      storageTypeLabel(card.dominantStorageType),
    ]
      .filter(Boolean)
      .some((value) => includesNormalized(value, query)));
  }, [sectionListSearch, visibleSectionCards]);

  const applyFilters = () => {
    setSelectedLocationCode('');
  };

  const selectedSection = useMemo(() => listedSectionCards.find((item) => item.id === selectedSectionId) || listedSectionCards[0] || null, [selectedSectionId, listedSectionCards]);

  useEffect(() => {
    if (!listedSectionCards.length) {
      setSelectedSectionId('');
      return;
    }
    if (!listedSectionCards.some((item) => item.id === selectedSectionId)) {
      setSelectedSectionId(listedSectionCards[0].id);
    }
  }, [selectedSectionId, listedSectionCards]);

  const sectionGridRows = useMemo(() => {
    const slotMap = { L: {}, R: {} };
    const columnStorageType = { L: {}, R: {} };

    selectedSectionProducts.forEach((product) => {
      const side = product.shelfSide || 'L';
      const shelfNo = Number(product.shelfNo || 0);
      const levelNo = Number(product.shelfLevel || 0);
      if (!shelfNo || !levelNo) return;

      if (!slotMap[side][shelfNo]) slotMap[side][shelfNo] = {};
      if (!slotMap[side][shelfNo][levelNo]) slotMap[side][shelfNo][levelNo] = [];
      slotMap[side][shelfNo][levelNo].push(product);

      if (!columnStorageType[side][shelfNo]) columnStorageType[side][shelfNo] = new Set();
      columnStorageType[side][shelfNo].add(product.requiredStorageType || 'Ortam');
    });

    const rows = [];
    for (const side of ['L', 'R']) {
      for (let shelfNo = 1; shelfNo <= 10; shelfNo += 1) {
        const inferredSet = columnStorageType[side][shelfNo] ? Array.from(columnStorageType[side][shelfNo]) : [];
        const inferredStorageType = inferredSet.length > 1 ? 'Ortam' : (inferredSet[0] || 'Ortam');

        for (let levelNo = 1; levelNo <= 5; levelNo += 1) {
          const productsInCell = slotMap[side]?.[shelfNo]?.[levelNo] || [];
          const product = productsInCell[0] || null;
          const stockNumeric = productsInCell.reduce((sum, item) => sum + Number(item.shelfStock || 0), 0);
          const capacity = resolveSlotCapacity(productsInCell, stockNumeric);
          const occupancyPercent = Math.max(0, Math.min(100, (stockNumeric / capacity) * 100));
          const minShelfStock = productsInCell.reduce((sum, item) => sum + Number(item.criticalStock || 0), 0);
          const targetShelfStock = productsInCell.reduce((sum, item) => sum + Number(item.maxShelfStock || item.shelfMaxStock || item.maxStock || 0), 0);
          const slotDesi = productsInCell.reduce((sum, item) => sum + resolveSlotDesiValue(item), 0);
          const refillNeeded = Boolean(product) && stockNumeric <= minShelfStock;
          const suggestedRefillQty = refillNeeded ? Math.max(0, targetShelfStock - stockNumeric) : 0;
          const slotStatus = product ? (refillNeeded ? 'Kritik' : 'Dolu') : 'Bos';
          const lastMovementAt = product?.updatedAt || null;
          const lastFeedAt = product?.updatedAt || null;
          const lastCountAt = product?.createdAt || null;
          const locationCode = sectionLocationCode(selectedSection?.number || 0, side, shelfNo, levelNo);
          rows.push({
            locationType: LOCATION_TYPES.SECTION,
            locationTypeLabel: 'Reyon',
            locationCode,
            locationCodeLabel: locationDisplayLabel(locationCode),
            status: slotStatus,
            statusLabel: statusLabel(slotStatus),
            sectionId: selectedSection?.id || '',
            scopeName: selectedSection?.name || '-',
            scopeCode: sectionCode(selectedSection?.number || 0),
            productId: product?.id || '',
            productName: product?.name || '-',
            sku: product?.sku || '-',
            barcode: product?.barcode || '-',
            categoryName: product?.categoryName || '-',
            unitLabel: product?.unit || '-',
            storageType: product?.requiredStorageType || inferredStorageType,
            storageTypeLabel: storageTypeLabel(product?.requiredStorageType || inferredStorageType),
            stockNumeric,
            stockLabel: formatNumber(stockNumeric),
            capacity,
            capacityLabel: formatNumber(capacity),
            occupancyPercent,
            occupancyLabel: toPercent(occupancyPercent),
            slotDesi,
            slotDesiCapacity: capacity,
            slotDesiLabel: `${formatNumber(slotDesi)} / ${formatNumber(capacity)}`,
            minShelfStock,
            targetShelfStock,
            refillNeeded,
            refillNeededLabel: refillNeeded ? 'Evet' : 'Hayır',
            suggestedRefillQty,
            suggestedRefillLabel: formatNumber(suggestedRefillQty),
            isCritical: refillNeeded,
            criticalLabel: refillNeeded ? `Kritik (${formatNumber(minShelfStock)})` : `Normal (${formatNumber(minShelfStock)})`,
            note: product?.stockWarning ? `Stok uyarısı: ${product.stockWarning}` : '-',
            scopeLabel: selectedSection ? `${selectedSection.name} (${sectionCode(selectedSection.number)})` : '-',
            side,
            sideLabel: side === 'L' ? 'Sol' : 'Sağ',
            shelfNo,
            levelNo,
            rowLabel: '-',
            batchNo: '-',
            skt: '-',
            lastInAt: formatDateTimeLabel(lastFeedAt),
            lastOutAt: '-',
            lastFeedAt,
            lastFeedAtLabel: formatDateTimeLabel(lastFeedAt),
            lastMovementAt,
            lastMovementAtLabel: formatDateTimeLabel(lastMovementAt),
            lastCountAt,
            lastCountAtLabel: formatDateTimeLabel(lastCountAt),
          });
        }
      }
    }

    return rows;
  }, [selectedSection, selectedSectionProducts]);

  const handleMoveSlotAction = useCallback(() => {
    const currentSelected = selectedLocationRef.current;
    const locationCode = String(currentSelected?.locationCode || selectedLocationCode || '').trim();
    const productId = String(currentSelected?.productId || '').trim();
    if (!locationCode || !productId) {
      setToast({ type: 'error', title: 'Göz Değiştir', message: 'Önce ürün bulunan bir lokasyon seçin.' });
      return;
    }

    const sourceStorageType = String(currentSelected?.storageType || 'Ortam');
    const targetOptions = sectionGridRows
      .filter((row) => String(row.locationCode || '').trim() && String(row.locationCode || '') !== locationCode)
      .filter((row) => isEmptyStatus(row.status))
      .filter((row) => String(row.storageType || 'Ortam') === sourceStorageType)
      .map((row) => ({
        value: String(row.locationCode || ''),
        side: row.side,
        shelfNo: Number(row.shelfNo || 0),
        levelNo: Number(row.levelNo || 0),
        sectionId: row.sectionId,
        label: `${row.locationCodeLabel || locationDisplayLabel(row.locationCode)} • ${row.sideLabel || '-'} • Raf ${row.shelfNo || '-'} / Kat ${row.levelNo || '-'} • ${storageTypeLabel(row.storageType)}`,
      }))
      .sort((left, right) => left.label.localeCompare(right.label, 'tr'));

    if (!targetOptions.length) {
      setToast({
        type: 'warning',
        title: 'Göz Değiştir',
        message: 'Uygun hedef lokasyon bulunamadı. Aynı saklama tipinde boş lokasyon gerekli.',
      });
      return;
    }

    setSlotMoveModal({
      isOpen: true,
      isSubmitting: false,
      sourceLocationCode: locationCode,
      sourceProductId: productId,
      sourceProductLabel: String(currentSelected?.productName || currentSelected?.sku || '-'),
      sourceStorageType,
      targetLocationCode: targetOptions[0].value,
      targetOptions,
    });
  }, [sectionGridRows, selectedLocationCode]);

  const warehouseRowsNormalized = useMemo(() => {
    return warehouseRows.map((row) => ({
      ...row,
      locationType: LOCATION_TYPES.WAREHOUSE,
      locationTypeLabel: 'Depo',
      locationCodeLabel: locationDisplayLabel(row.locationCode),
      scopeLabel: `Depo Sırası D${row.rowNo}`,
      statusLabel: statusLabel(row.status),
      rowLabel: `D${row.rowNo}`,
      sideLabel: row.side === 'L' ? 'Sol' : 'Sağ',
      categoryName: productCategoryById.get(row.productId) || '-',
      stockNumeric: Number(row.warehouseStock || 0),
      stockLabel: formatNumber(row.warehouseStock || 0),
      capacityLabel: `${formatNumber(row.capacity || row.palletCapacity || 1)} palet`,
      occupancyLabel: `${formatNumber(row.palletCount || 0)} / ${formatNumber(row.capacity || row.palletCapacity || 1)}`,
      occupancyPercent: Number(row.capacity || row.palletCapacity || 0) > 0 ? (Number(row.palletCount || 0) / Number(row.capacity || row.palletCapacity || 1)) * 100 : 0,
      refillNeeded: false,
      refillNeededLabel: '-',
      suggestedRefillLabel: '-',
      storageTypeLabel: storageTypeLabel(row.storageType),
    }));
  }, [productCategoryById, warehouseRows]);

  const warehouseStockByProductId = useMemo(() => {
    const map = new Map();
    warehouseRowsNormalized.forEach((row) => {
      const productId = String(row.productId || '').trim();
      if (!productId) return;
      const current = Number(map.get(productId) || 0);
      map.set(productId, current + Number(row.stockNumeric || 0));
    });
    return map;
  }, [warehouseRowsNormalized]);

  const predicate = useMemo(() => buildCommonPredicate(filters, productCriticalMap), [filters, productCriticalMap]);
  const filteredSectionRows = useMemo(() => sectionGridRows.filter(predicate), [predicate, sectionGridRows]);
  const filteredWarehouseRows = useMemo(() => warehouseRowsNormalized.filter(predicate), [predicate, warehouseRowsNormalized]);

  const warehouseGridRows = useMemo(() => {
    const rowNo = Number(selectedWarehouseRowNo || 1);
    return filteredWarehouseRows.filter((item) => item.rowNo === rowNo && item.side === selectedWarehouseSide);
  }, [filteredWarehouseRows, selectedWarehouseRowNo, selectedWarehouseSide]);

  const warehouseGridMap = useMemo(() => {
    const map = {};
    warehouseGridRows.forEach((item) => {
      map[`${item.shelfNo}-${item.levelNo}`] = item;
    });
    return map;
  }, [warehouseGridRows]);

  const activeRows = locationType === LOCATION_TYPES.SECTION ? filteredSectionRows : filteredWarehouseRows;

  const handleMoveProductAction = useCallback(() => {
    const currentSelected = selectedLocationRef.current;
    const sourceLocationCode = String(currentSelected?.locationCode || selectedLocationCode || '').trim();
    if (!sourceLocationCode) {
      setToast({ type: 'error', title: 'Ürün Taşı', message: 'Önce taşınacak lokasyonu seçin.' });
      return;
    }

    if (!currentSelected?.productId && !currentSelected?.sku) {
      setToast({ type: 'error', title: 'Ürün Taşı', message: 'Seçili lokasyonda taşınacak ürün bulunmuyor.' });
      return;
    }

    const targetRows = activeRows.filter((row) => String(row.locationCode || '') !== sourceLocationCode);
    if (!targetRows.length) {
      setToast({ type: 'warning', title: 'Ürün Taşı', message: 'Hedef lokasyon bulunamadı. Filtreleri genişletin.' });
      return;
    }

    setTransferModal({
      isOpen: true,
      transferDirection: locationType === LOCATION_TYPES.WAREHOUSE ? 'warehouse_to_section' : 'section_to_warehouse',
      sourceLocationCode,
      sourceProductLabel: String(currentSelected?.productName || currentSelected?.sku || '-'),
      targetLocationCode: String(targetRows[0]?.locationCode || ''),
    });
  }, [activeRows, selectedLocationCode]);

  const locationIndex = useMemo(() => {
    const map = new Map();
    [...sectionGridRows, ...warehouseRowsNormalized].forEach((item) => map.set(item.locationCode, item));
    return map;
  }, [sectionGridRows, warehouseRowsNormalized]);

  const activeSelectedLocation = useMemo(() => {
    if (!selectedLocationCode) return null;
    return locationIndex.get(selectedLocationCode) || null;
  }, [locationIndex, selectedLocationCode]);

  const transferTargetOptions = useMemo(() => {
    const sourceLocationCode = String(transferModal.sourceLocationCode || '').trim();
    if (!sourceLocationCode) return [];
    const allRows = [...sectionGridRows, ...warehouseRowsNormalized];
    const sourceRow = allRows.find((row) => String(row.locationCode || '') === sourceLocationCode);
    if (!sourceRow) return [];

    const direction = transferModal.transferDirection || 'warehouse_to_section';
    const sourceTypeRequired = direction === 'warehouse_to_section' ? LOCATION_TYPES.WAREHOUSE : LOCATION_TYPES.SECTION;
    const targetTypeRequired = direction === 'warehouse_to_section' ? LOCATION_TYPES.SECTION : LOCATION_TYPES.WAREHOUSE;
    if (sourceRow.locationType !== sourceTypeRequired) return [];

    return allRows
      .filter((row) => String(row.locationCode || '').trim() && String(row.locationCode || '') !== sourceLocationCode)
      .filter((row) => row.locationType === targetTypeRequired)
      .map((row) => ({
        value: String(row.locationCode || ''),
        label: `${row.locationCodeLabel || locationDisplayLabel(row.locationCode)} • ${row.scopeLabel || '-'} • ${row.storageTypeLabel || '-'} • ${row.status || '-'}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'tr'));
  }, [sectionGridRows, warehouseRowsNormalized, transferModal.sourceLocationCode, transferModal.transferDirection]);

  const closeTransferModal = useCallback(() => {
    setTransferModal({
      isOpen: false,
      transferDirection: 'warehouse_to_section',
      sourceLocationCode: '',
      sourceProductLabel: '',
      targetLocationCode: '',
    });
  }, []);

  const handleConfirmTransfer = useCallback(() => {
    if (!transferModal.sourceLocationCode || !transferModal.targetLocationCode) {
      setToast({ type: 'error', title: 'Ürün Taşı', message: 'Kaynak ve hedef lokasyon bilgisi zorunludur.' });
      return;
    }

    const source = locationIndex.get(transferModal.sourceLocationCode);
    const target = locationIndex.get(transferModal.targetLocationCode);
    const isWarehouseToSection = transferModal.transferDirection === 'warehouse_to_section';
    if (!source || !target) {
      setToast({ type: 'error', title: 'Ürün Taşı', message: 'Kaynak veya hedef lokasyon bilgisi doğrulanamadı.' });
      return;
    }
    if (isWarehouseToSection && !(source.locationType === LOCATION_TYPES.WAREHOUSE && target.locationType === LOCATION_TYPES.SECTION)) {
      setToast({ type: 'error', title: 'Ürün Taşı', message: 'Depodan Reyona yönünde yalnızca depo kaynaklı transfer yapılabilir.' });
      return;
    }
    if (!isWarehouseToSection && !(source.locationType === LOCATION_TYPES.SECTION && target.locationType === LOCATION_TYPES.WAREHOUSE)) {
      setToast({ type: 'error', title: 'Ürün Taşı', message: 'Reyondan Depoya yönünde yalnızca reyon kaynaklı transfer yapılabilir.' });
      return;
    }

    setToast({
      type: 'success',
      title: 'Ürün Taşı',
      message: `${transferModal.sourceProductLabel || 'Ürün'} için ${isWarehouseToSection ? 'Depodan Reyona' : 'Reyondan Depoya'} taşıma talebi oluşturuldu: ${locationDisplayLabel(transferModal.sourceLocationCode)} -> ${locationDisplayLabel(transferModal.targetLocationCode)}`,
    });
    closeTransferModal();
  }, [closeTransferModal, locationIndex, transferModal.sourceLocationCode, transferModal.sourceProductLabel, transferModal.targetLocationCode, transferModal.transferDirection]);

  const handleConfirmSlotMove = useCallback(async () => {
    if (!slotMoveModal.sourceProductId || !slotMoveModal.targetLocationCode) {
      setToast({ type: 'error', title: 'Göz Değiştir', message: 'Kaynak ürün ve hedef lokasyon bilgisi zorunludur.' });
      return;
    }

    const target = slotMoveModal.targetOptions.find((item) => item.value === slotMoveModal.targetLocationCode);
    if (!target) {
      setToast({ type: 'error', title: 'Göz Değiştir', message: 'Seçilen hedef lokasyon geçersiz.' });
      return;
    }

    setSlotMoveModal((current) => ({ ...current, isSubmitting: true }));
    try {
      await productService.update(slotMoveModal.sourceProductId, {
        sectionId: target.sectionId,
        shelfSide: target.side,
        shelfNo: target.shelfNo,
        shelfLevel: target.levelNo,
      });

      setProducts((current) => current.map((item) => {
        if (String(item.id) !== String(slotMoveModal.sourceProductId)) return item;
        return {
          ...item,
          sectionId: target.sectionId,
          shelfSide: target.side,
          shelfNo: target.shelfNo,
          shelfLevel: target.levelNo,
        };
      }));

      setDerivedShelfPlan((current) => current.map((item) => {
        if (String(item.productId || '') !== String(slotMoveModal.sourceProductId)) return item;
        return {
          ...item,
          sectionId: target.sectionId,
          shelfSide: target.side,
          shelfNo: target.shelfNo,
          shelfLevel: target.levelNo,
        };
      }));

      setSelectedSectionProducts((current) => current.map((item) => {
        if (String(item.id || item.productId || '') !== String(slotMoveModal.sourceProductId)) return item;
        return {
          ...item,
          shelfSide: target.side,
          shelfNo: target.shelfNo,
          shelfLevel: target.levelNo,
        };
      }));

      setSelectedLocationCode(target.value);
      setToast({
        type: 'success',
        title: 'Göz Değiştir',
        message: `${slotMoveModal.sourceProductLabel || 'Ürün'} için lokasyon güncellendi: ${locationDisplayLabel(slotMoveModal.sourceLocationCode)} -> ${locationDisplayLabel(target.value)}`,
      });
      closeSlotMoveModal();
    } catch (error) {
      setSlotMoveModal((current) => ({ ...current, isSubmitting: false }));
      setToast({ type: 'error', title: 'Göz Değiştir', message: error.message || 'Lokasyon güncellenemedi.' });
    }
  }, [closeSlotMoveModal, slotMoveModal.sourceLocationCode, slotMoveModal.sourceProductId, slotMoveModal.sourceProductLabel, slotMoveModal.targetLocationCode, slotMoveModal.targetOptions]);

  useEffect(() => {
    selectedLocationRef.current = activeSelectedLocation;
  }, [activeSelectedLocation]);

  useEffect(() => {
    setSelectedLocationCode('');
    if (locationType === LOCATION_TYPES.WAREHOUSE) {
      setSectionFilter('');
    }
  }, [locationType]);

  useEffect(() => {
    if (selectedLocationCode && !locationIndex.has(selectedLocationCode)) {
      setSelectedLocationCode('');
    }
  }, [locationIndex, selectedLocationCode]);

  const handleLocationRowClick = (row) => {
    if (!row?.locationCode) return;
    setSelectedLocationCode((current) => (current === row.locationCode ? '' : row.locationCode));
  };

  const handleSectionListWheel = (event) => {
    const container = sectionListRef.current;
    if (!container) return;

    const hasHorizontalOverflow = container.scrollWidth > container.clientWidth;
    const isVerticalIntent = Math.abs(event.deltaY) > Math.abs(event.deltaX);

    if (!hasHorizontalOverflow || !isVerticalIntent) return;

    event.preventDefault();
    container.scrollLeft += event.deltaY;
  };

  const warehouseSummaryCards = useMemo(() => {
    const total = filteredWarehouseRows.length;
    const full = filteredWarehouseRows.filter((item) => item.status === 'Dolu').length;
    const empty = filteredWarehouseRows.filter((item) => isEmptyStatus(item.status)).length;
    const Ortam = filteredWarehouseRows.filter((item) => item.storageType === 'Ortam').length;
    const cold = filteredWarehouseRows.filter((item) => item.storageType === 'cold_chain').length;
    const freezer = filteredWarehouseRows.filter((item) => item.storageType === 'freezer').length;

    return [
      { label: 'Toplam Lokasyon', value: formatNumber(total), icon: <MapPin size={18} />, iconClass: 'mod-icon-blue' },
      { label: 'Dolu Lokasyon', value: formatNumber(full), icon: <PackageCheck size={18} />, iconClass: 'mod-icon-emerald' },
      { label: 'Boş Lokasyon', value: formatNumber(empty), icon: <Boxes size={18} />, iconClass: 'mod-icon-cyan' },
      { label: 'Ortam Kapasite', value: formatNumber(Ortam), icon: <Thermometer size={18} />, iconClass: 'mod-icon-violet' },
      { label: 'Soğuk Kapasite', value: formatNumber(cold), icon: <Snowflake size={18} />, iconClass: 'mod-icon-cyan' },
      { label: 'Dondurucu Kapasite', value: formatNumber(freezer), icon: <Snowflake size={18} />, iconClass: 'mod-icon-indigo' },
    ];
  }, [filteredWarehouseRows]);

  const depotZoneCountByRow = useMemo(() => {
    const map = new Map();
    (Array.isArray(derivedDepotZones) ? derivedDepotZones : []).forEach((item) => {
      map.set(Number(item.rowNo || 0), Number(item.totalLocations || 0));
    });
    return map;
  }, [derivedDepotZones]);

  const sectionColumns = [
    { key: 'locationCode', label: 'Lokasyon Kodu', render: (row) => row.locationCodeLabel || locationDisplayLabel(row.locationCode) },
    { key: 'scopeLabel', label: 'Reyon', render: (row) => row.scopeLabel || '-' },
    {
      key: 'status',
      label: 'Durum',
      render: (row) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>,
      sortValue: (row) => ({ Bos: 0, Dolu: 1, Kritik: 2 }[String(row.status || '')] ?? 99),
    },
    {
      key: 'productName',
      label: 'Ürün',
      className: 'location-cell-product',
      render: (row) => <span className="location-table-clamp-2">{row.productName || '-'}</span>,
    },
    {
      key: 'sku',
      label: 'SKU',
      className: 'location-cell-sku',
      render: (row) => <span className="location-table-clamp-2">{row.sku || '-'}</span>,
    },
    {
      key: 'storageTypeLabel',
      label: 'Saklama Tipi',
      render: (row) => <span className={`location-chip ${storageToneClass(row.storageType)}`}>{storageTypeLabel(row.storageType)}</span>,
      sortValue: (row) => storageTypeLabel(row.storageType),
    },
    { key: 'stockLabel', label: 'Stok', render: (row) => row.stockLabel || '-' },
    { key: 'occupancyLabel', label: 'Doluluk', render: (row) => row.occupancyLabel || '-' },
  ];

  const sectionSummaryCards = useMemo(() => {
    const totalSlots = visibleSectionCards.length * 100;
    const filled = filteredSectionRows.filter((item) => item.status === 'Dolu').length;
    const empty = filteredSectionRows.filter((item) => isEmptyStatus(item.status)).length;
    const ambientCols = filteredSectionRows.filter((item) => item.storageType === 'Ortam').length;
    const coldCols = filteredSectionRows.filter((item) => item.storageType === 'cold_chain').length;
    const freezerCols = filteredSectionRows.filter((item) => item.storageType === 'freezer').length;
    const criticalSlots = filteredSectionRows.filter((item) => item.isCritical).length;
    const totalVariety = new Set(filteredSectionRows.filter((item) => item.productId).map((item) => item.productId)).size;
    const avgOccupancy = filteredSectionRows.length ?
      filteredSectionRows.reduce((sum, item) => sum + Number(item.occupancyPercent || 0), 0) / filteredSectionRows.length
      : 0;

    return [
      { label: 'Toplam Göz', value: formatNumber(totalSlots), icon: <Boxes size={18} />, iconClass: 'mod-icon-violet' },
      { label: 'Dolu Göz', value: formatNumber(filled), icon: <PackageCheck size={18} />, iconClass: 'mod-icon-emerald' },
      { label: 'Boş Göz', value: formatNumber(empty), icon: <Boxes size={18} />, iconClass: 'mod-icon-cyan' },
      { label: 'Ortam Gözü', value: formatNumber(ambientCols), icon: <Thermometer size={18} />, iconClass: 'mod-icon-violet' },
      { label: 'Soğuk Göz', value: formatNumber(coldCols), icon: <Snowflake size={18} />, iconClass: 'mod-icon-cyan' },
      { label: 'Dondurucu Göz', value: formatNumber(freezerCols), icon: <Snowflake size={18} />, iconClass: 'mod-icon-indigo' },
      { label: 'Toplam Ürün Çeşidi', value: formatNumber(totalVariety), icon: <Boxes size={18} />, iconClass: 'mod-icon-blue' },
      { label: 'Kritik Göz', value: formatNumber(criticalSlots), icon: <AlertTriangle size={18} />, iconClass: 'mod-icon-rose' },
      { label: 'Ortalama Doluluk', value: `${avgOccupancy.toFixed(1)}%`, icon: <PackageCheck size={18} />, iconClass: 'mod-icon-emerald' },
    ];
  }, [filteredSectionRows, visibleSectionCards]);

  const warehouseColumns = [
    {
      key: 'locationSummary',
      label: 'Depo Konumu',
      className: 'location-cell-product',
      render: (row) => (
        <span className="location-table-clamp-2">
          <strong>{row.locationCodeLabel || locationDisplayLabel(row.locationCode)}</strong>
          <br />
          <span>{row.scopeLabel || '-'} • D{row.rowNo}-{row.sideLabel} / R{formatNumber(row.shelfNo || 0)}-K{formatNumber(row.levelNo || 0)}</span>
        </span>
      ),
      sortable: false,
    },
    { key: 'status', label: 'Durum', render: (row) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>, sortable: false },
    {
      key: 'productName',
      label: 'Ürün',
      className: 'location-cell-product',
      render: (row) => <span className="location-table-clamp-2">{row.productName || '-'}</span>,
    },
    {
      key: 'sku',
      label: 'SKU',
      className: 'location-cell-sku',
      render: (row) => <span className="location-table-clamp-2">{row.sku || '-'}</span>,
    },
    { key: 'storageTypeLabel', label: 'Saklama Tipi', render: (row) => <span className={`location-chip ${storageToneClass(row.storageType)}`}>{storageTypeLabel(row.storageType)}</span>, sortable: false },
    { key: 'stockLabel', label: 'Stok', render: (row) => row.stockLabel || '-' },
    { key: 'palletInfo', label: 'Palet', render: (row) => `${formatNumber(row.palletCount || 0)} / ${formatNumber(row.palletCapacity || 1)}` },
    { key: 'occupancyLabel', label: 'Doluluk', render: (row) => row.occupancyLabel || '-' },
    { key: 'batchNo', label: 'Parti', render: (row) => row.batchNo || '-' },
    { key: 'skt', label: 'SKT', render: (row) => row.skt || '-' },
  ];

  const suggestionText = useMemo(() => {
    if (!activeSelectedLocation || !isEmptyStatus(activeSelectedLocation.status)) return '';
    const requiredStorageType = activeSelectedLocation.storageType || 'Ortam';
    const sectionCategory = String(selectedSection?.categoryLabel || '').trim().toLowerCase();

    const candidates = products
      .filter((item) => (item.requiredStorageType || 'Ortam') === requiredStorageType)
      .filter((item) => item.isActive !== false)
      .map((item) => {
        const critical = Number(item.criticalStock || 0);
        const warehouseStock = Number(warehouseStockByProductId.get(String(item.id)) || 0);
        const categoryName = String(item.categoryName || '').trim().toLowerCase();
        const categoryMatch = !sectionCategory || (categoryName && categoryName === sectionCategory);
        const stockFit = warehouseStock > 0 ? Math.min(2, warehouseStock / Math.max(1, critical || 1)) : 0;
        const score = (categoryMatch ? 2 : 0) + stockFit;
        return {
          item,
          warehouseStock,
          critical,
          categoryMatch,
          score,
        };
      })
      .filter((entry) => entry.warehouseStock > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (!candidates.length) {
      return 'Uygun ürün bulunamadı. Bu saklama tipinde depoda stoklu ürün yok.';
    }

    return candidates
      .map((entry, index) => {
        const reasons = [
          `Depo stok: ${formatNumber(entry.warehouseStock)}`,
          `Kritik esik: ${formatNumber(entry.critical)}`,
          `Saklama: ${storageTypeLabel(entry.item.requiredStorageType || requiredStorageType)}`,
        ];
        if (entry.categoryMatch) reasons.push('Kategori uyumlu');
        return `${index + 1}. ${entry.item.name} (${reasons.join(' • ')})`;
      })
      .join('\n');
  }, [activeSelectedLocation, products, selectedSection?.categoryLabel, warehouseStockByProductId]);

  return (
    <div className="page-stack location-management-page">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <LocationHeader
        locationType={locationType}
        onLocationTypeChange={setLocationType}
        categoryOptions={categoryOptions}
        sectionOptions={sections}
        filters={filters}
        actions={filterActions}
        onApply={applyFilters}
      />

      {locationType === LOCATION_TYPES.SECTION ? (
        <>
          <LocationSummaryCards items={sectionSummaryCards} />

          <section className="location-three-stack location-three-stack-section">
            <div className="location-stack-row location-section-top-grid">
              <div className="location-list-panel mod-card">
                <div className="mod-card-header">
                  <div className="mod-card-icon mod-icon-cyan"><MapPin size={18} /></div>
                  <div className="location-list-header-main">
                    <h3>Reyon Listesi</h3>
                    <p>Seç ve gridde tek tıkla lokasyon detayına in</p>
                  </div>
                  <div className="location-list-header-search">
                    <Search size={14} aria-hidden="true" className="location-list-header-search-icon" />
                    <input
                      ref={sectionListSearchInputRef}
                      type="text"
                      value={sectionListSearch}
                      onChange={(event) => setSectionListSearch(event.target.value)}
                      placeholder="Reyon ara"
                      aria-label="Reyon listesinde ara"
                    />
                  </div>
                </div>
                <div className="location-card-list" ref={sectionListRef} onWheel={handleSectionListWheel}>
                  {listedSectionCards.map((item) => (
                    <button key={item.id} className={`location-reyon-card ${selectedSection?.id === item.id ? 'is-selected' : ''}`} type="button" onClick={() => setSelectedSectionId(item.id)}>
                      <div className="location-reyon-card-head">
                        <strong>{item.name}</strong>
                        <span>{item.code}</span>
                      </div>
                      <div className="location-reyon-card-grid">
                        <span>Kategori</span><strong>{item.categoryLabel || '-'}</strong>
                        <span>Saklama Tipi</span><strong>{storageTypeLabel(item.dominantStorageType)} ({item.reyonType})</strong>
                        <span>Doluluk</span><strong>{item.occupancyRate.toFixed(1)}% ({item.occupiedSlots}/{item.totalSlots})</strong>
                        <span>Ürün Çeşidi</span><strong>{formatNumber(item.productVarietyCount)}</strong>
                        <span>Kritik Ürün</span><strong>{formatNumber(item.criticalCount)}</strong>
                        <span>Stok Kullanımı</span><strong>{formatNumber(item.currentProductCount)} / {formatNumber(item.maxProductCapacity)}{item.stockUsageRate !== null ? ` (${item.stockUsageRate.toFixed(1)}%)` : ''}</strong>
                        <span>Desi Kullanımı</span><strong>{item.hasDesiData ? `${formatNumber(item.currentDesi)} / ${formatNumber(item.maxDesi)} (${item.desiUsageRate.toFixed(1)}%)` : 'Desi verisi yok'}</strong>
                        <span>Kapasite</span><strong>{formatNumber(item.totalSlots)} fiziksel slot</strong>
                        <span>Son Besleme</span><strong>{formatDateTimeLabel(item.lastFeedAt)}</strong>
                      </div>
                    </button>
                  ))}
                  {!listedSectionCards.length ? (
                    <div className="location-list-mini-empty">Aramaya uygun reyon bulunamadı.</div>
                  ) : null}
                </div>
              </div>

              <LocationDetailPanel
                locationType={locationType}
                selectedLocation={activeSelectedLocation}
                onMove={handleMoveProductAction}
                onCreateRefillRequest={handleCreateRefillRequestAction}
                onViewMovements={handleViewMovementsAction}
                onViewRefillHistory={handleViewRefillHistoryAction}
                onMoveSlot={handleMoveSlotAction}
              />
            </div>

            <div className="location-stack-row location-grid-area">
              <ReyonGridView
                selectedSection={selectedSection}
                rows={filteredSectionRows}
                selectedLocationCode={selectedLocationCode}
                setSelectedLocationCode={setSelectedLocationCode}
              />

              <div className="mod-card">
                <div className="mod-card-header">
                  <div className="mod-card-icon mod-icon-indigo"><MapPin size={18} /></div>
                  <div>
                    <h3>Reyon Lokasyon Listesi</h3>
                    <p>Raf/kat/lokasyon/stok bilgilerini tablo olarak görüntüleyin</p>
                  </div>
                </div>
                <div className="reyon-location-table-scroll">
                  <DataTable
                    columns={sectionColumns}
                    rows={filteredSectionRows}
                    isLoading={isLoading || isSectionDetailLoading}
                    emptyMessage="Filtreye uygun reyon lokasyonu bulunamadı."
                    initialSort={{ key: 'locationCode', direction: 'asc' }}
                    pageSize={10}
                    topHorizontalScroll
                    onRowClick={handleLocationRowClick}
                    isRowSelected={(row) => row.locationCode === selectedLocationCode}
                  />
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <LocationSummaryCards items={warehouseSummaryCards} />

          <section className="location-three-stack location-three-stack-warehouse">
            <div className="location-stack-row location-warehouse-top-grid">
              <div className="location-list-panel mod-card location-warehouse-info-panel">
                <div className="mod-card-header">
                  <div className="mod-card-icon mod-icon-cyan"><Warehouse size={18} /></div>
                  <div>
                    <h3>Depo Bilgisi</h3>
                    <p>3 sıra x 2 taraf x 15 raf x 10 kat</p>
                  </div>
                </div>
                <div className="location-metric-strip">
                  <div><span>D1</span><strong>{formatNumber(depotZoneCountByRow.get(1) || filteredWarehouseRows.filter((item) => item.rowNo === 1).length)}</strong></div>
                  <div><span>D2</span><strong>{formatNumber(depotZoneCountByRow.get(2) || filteredWarehouseRows.filter((item) => item.rowNo === 2).length)}</strong></div>
                  <div><span>D3</span><strong>{formatNumber(depotZoneCountByRow.get(3) || filteredWarehouseRows.filter((item) => item.rowNo === 3).length)}</strong></div>
                  <div><span>Toplam Kapasite</span><strong>{formatNumber(warehouseSummary?.totalLocations || 900)}</strong></div>
                </div>
                <LocationLegend />
              </div>

              <LocationDetailPanel
                locationType={locationType}
                selectedLocation={activeSelectedLocation}
                onMove={handleMoveProductAction}
                onCreateRefillRequest={handleCreateRefillRequestAction}
                onViewMovements={handleViewMovementsAction}
                onViewRefillHistory={handleViewRefillHistoryAction}
                onMoveSlot={handleMoveSlotAction}
              />
            </div>

            <div className="location-stack-row location-grid-area">
              <DepotGridView
                selectedWarehouseRowNo={selectedWarehouseRowNo}
                setSelectedWarehouseRowNo={setSelectedWarehouseRowNo}
                selectedWarehouseSide={selectedWarehouseSide}
                setSelectedWarehouseSide={setSelectedWarehouseSide}
                warehouseGridMap={warehouseGridMap}
                selectedLocationCode={selectedLocationCode}
                setSelectedLocationCode={setSelectedLocationCode}
              />

              <div className="mod-card">
                <div className="mod-card-header">
                  <div className="mod-card-icon mod-icon-indigo"><Warehouse size={18} /></div>
                  <div>
                    <h3>Depo Lokasyon Listesi</h3>
                    <p>Raf/kat/lokasyon/stok/parti/SKT göre anlık görünüm</p>
                  </div>
                </div>
                <div className="reyon-location-table-scroll depot-location-table-scroll">
                  <DataTable
                    columns={warehouseColumns}
                    rows={filteredWarehouseRows}
                    isLoading={isLoading}
                    emptyMessage="Filtreye uygun lokasyon bulunamadı."
                    pageSize={10}
                    topHorizontalScroll
                    onRowClick={handleLocationRowClick}
                    isRowSelected={(row) => row.locationCode === selectedLocationCode}
                  />
                </div>
              </div>
            </div>

          </section>
        </>
      )}

      {(isLoading || isSectionDetailLoading) ? (
        <div className="table-panel loading-state">
          <span className="loader"></span>
          <p>Lokasyon verileri hazırlanıyor...</p>
        </div>
      ) : null}

      {transferModal.isOpen ? (
        <div className="location-action-modal-backdrop" role="presentation" onClick={closeTransferModal}>
          <div className="location-action-modal location-transfer-modal" role="dialog" aria-modal="true" aria-labelledby="location-transfer-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="location-action-modal-head">
              <h4 id="location-transfer-modal-title">Ürün Taşı</h4>
            </div>
            <div className="category-type-segment location-transfer-direction" role="group" aria-label="Transfer yönü">
              <button
                type="button"
                className={transferModal.transferDirection === 'warehouse_to_section' ? 'is-active' : ''}
                onClick={() => setTransferModal((current) => ({ ...current, transferDirection: 'warehouse_to_section', targetLocationCode: '' }))}
              >
                Depodan Reyona
              </button>
              <button
                type="button"
                className={transferModal.transferDirection === 'section_to_warehouse' ? 'is-active' : ''}
                onClick={() => setTransferModal((current) => ({ ...current, transferDirection: 'section_to_warehouse', targetLocationCode: '' }))}
              >
                Reyondan Depoya
              </button>
            </div>
            <div className="location-transfer-modal-grid">
              <label className="field-group">
                <span>{transferModal.transferDirection === 'warehouse_to_section' ? 'Kaynak (Depo)' : 'Kaynak (Reyon)'}</span>
                <input value={locationDisplayLabel(transferModal.sourceLocationCode)} readOnly />
              </label>
              <label className="field-group">
                <span>Ürün</span>
                <input value={transferModal.sourceProductLabel || '-'} readOnly />
              </label>
              <label className="field-group location-transfer-target-field">
                <span>{transferModal.transferDirection === 'warehouse_to_section' ? 'Hedef (Reyon)' : 'Hedef (Depo)'}</span>
                <select value={transferModal.targetLocationCode} onChange={(event) => setTransferModal((current) => ({ ...current, targetLocationCode: event.target.value }))}>
                  <option value="">Hedef lokasyon seçin</option>
                  {transferTargetOptions.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="location-action-modal-actions">
              <button className="ghost-button" type="button" onClick={closeTransferModal}>İptal</button>
              <button className="primary-button" type="button" onClick={handleConfirmTransfer}>Taşıma Talebini Oluştur</button>
            </div>
          </div>
        </div>
      ) : null}

      {movementModal.isOpen ? (
        <div className="location-action-modal-backdrop" role="presentation" onClick={closeMovementModal}>
          <div className="location-action-modal location-history-modal" role="dialog" aria-modal="true" aria-labelledby="location-movements-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="location-action-modal-head">
              <h4 id="location-movements-modal-title">Stok Hareketleri</h4>
              <p>
                Lokasyon: {locationDisplayLabel(movementModal.locationCode)} • Ürün: {movementModal.productLabel || '-'}
              </p>
            </div>

            {movementModal.isLoading ? <p>Hareket kayıtları yükleniyor...</p> : null}
            {!movementModal.isLoading && movementModal.error ? <p>{movementModal.error}</p> : null}

            {!movementModal.isLoading && !movementModal.error ? (
              <div className="location-history-table-wrap">
                {movementModal.rows.length ? (
                  <table className="location-history-table" aria-label="Stok hareketleri tablosu">
                    <thead>
                      <tr>
                        <th>Tarih</th>
                        <th>İşlem Tipi</th>
                        <th>Miktar</th>
                        <th>Kullanıcı</th>
                        <th>Kaynak İşlem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movementModal.rows.map((row, index) => (
                        <tr key={row.id || `${row.createdAtLabel || 'movement'}-${index}`}>
                          <td>{row.createdAtLabel}</td>
                          <td>{row.typeLabel}</td>
                          <td>{row.qtyLabel}</td>
                          <td>{row.userName}</td>
                          <td>{row.operationSource}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="location-history-empty">Seçili lokasyon için hareket bulunamadı.</div>
                )}
              </div>
            ) : null}

            <div className="location-action-modal-actions">
              <button className="primary-button" type="button" onClick={closeMovementModal}>Kapat</button>
            </div>
          </div>
        </div>
      ) : null}

      {refillHistoryModal.isOpen ? (
        <div className="location-action-modal-backdrop" role="presentation" onClick={closeRefillHistoryModal}>
          <div className="location-action-modal location-history-modal" role="dialog" aria-modal="true" aria-labelledby="location-refill-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="location-action-modal-head">
              <h4 id="location-refill-modal-title">Besleme Geçmişi</h4>
              <p>
                Lokasyon: {locationDisplayLabel(refillHistoryModal.locationCode)} • Ürün: {refillHistoryModal.productLabel || '-'}
              </p>
            </div>

            <div className="location-refill-summary-grid">
              <article>
                <span>Son Besleme</span>
                <strong>{refillHistoryModal.summary.lastFeedAt || '-'}</strong>
              </article>
              <article>
                <span>Toplam Besleme</span>
                <strong>{formatNumber(refillHistoryModal.summary.totalQty || 0)}</strong>
              </article>
              <article>
                <span>Kayıt Sayısı</span>
                <strong>{formatNumber(refillHistoryModal.summary.movementCount || 0)}</strong>
              </article>
              <article>
                <span>Operasyon Notu</span>
                <strong>{refillHistoryModal.summary.operationNote || '-'}</strong>
              </article>
            </div>

            {refillHistoryModal.isLoading ? <p>Besleme kayıtları yükleniyor...</p> : null}
            {!refillHistoryModal.isLoading && refillHistoryModal.error ? <p>{refillHistoryModal.error}</p> : null}

            {!refillHistoryModal.isLoading && !refillHistoryModal.error ? (
              <div className="location-history-table-wrap">
                {refillHistoryModal.rows.length ? (
                  <table className="location-history-table" aria-label="Besleme geçmişi tablosu">
                    <thead>
                      <tr>
                        <th>Tarih</th>
                        <th>Miktar</th>
                        <th>İşlemi Yapan</th>
                        <th>Kaynak</th>
                        <th>Referans / Not</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refillHistoryModal.rows.map((row, index) => (
                        <tr key={row.id || `${row.createdAtLabel || 'refill'}-${index}`}>
                          <td>{row.createdAtLabel}</td>
                          <td>{row.qtyLabel}</td>
                          <td>{row.userName}</td>
                          <td>{row.sourceLabel}</td>
                          <td>{`${row.referenceNo} • ${row.note}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="location-history-empty">Seçili lokasyon için besleme kaydı bulunamadı.</div>
                )}
              </div>
            ) : null}

            <div className="location-action-modal-actions">
              <button className="primary-button" type="button" onClick={closeRefillHistoryModal}>Kapat</button>
            </div>
          </div>
        </div>
      ) : null}

      {slotMoveModal.isOpen ? (
        <div className="location-action-modal-backdrop" role="presentation" onClick={closeSlotMoveModal}>
          <div className="location-action-modal location-slot-move-modal" role="dialog" aria-modal="true" aria-labelledby="location-slot-move-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="location-action-modal-head">
              <h4 id="location-slot-move-modal-title">Göz Değiştir</h4>
              <p>
                Ürün: {slotMoveModal.sourceProductLabel || '-'} • Kaynak: {locationDisplayLabel(slotMoveModal.sourceLocationCode)}
              </p>
            </div>
            <div className="location-slot-move-grid">
              <label className="field-group">
                <span>Mevcut Göz</span>
                <input value={locationDisplayLabel(slotMoveModal.sourceLocationCode)} readOnly />
              </label>
              <label className="field-group">
                <span>Saklama Tipi</span>
                <input value={storageTypeLabel(slotMoveModal.sourceStorageType || 'Ortam')} readOnly />
              </label>
              <label className="field-group location-slot-target-field">
                <span>Hedef Göz (Uygun Lokasyonlar)</span>
                <select value={slotMoveModal.targetLocationCode} onChange={(event) => setSlotMoveModal((current) => ({ ...current, targetLocationCode: event.target.value }))}>
                  {slotMoveModal.targetOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="location-action-modal-actions">
              <button className="ghost-button" type="button" onClick={closeSlotMoveModal} disabled={slotMoveModal.isSubmitting}>İptal</button>
              <button className="primary-button" type="button" onClick={handleConfirmSlotMove} disabled={slotMoveModal.isSubmitting || !slotMoveModal.targetLocationCode}>
                {slotMoveModal.isSubmitting ? 'Taşınıyor...' : 'Göz Değişikliğini Onayla'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}






const resolveSlotDesiValue = (item = {}) => {
  const candidate = Number(item.slotDesi || item.desi || item.unitDesi || item.volumeDesi || 0);
  if (Number.isFinite(candidate) && candidate > 0) return candidate;
  const stockFallback = Number(item.shelfStock || 0);
  return Number.isFinite(stockFallback) && stockFallback > 0 ? stockFallback : 0;
};

const resolveSlotCapacity = (productsInCell = [], stockNumeric = 0) => {
  const explicitCapacity = productsInCell.reduce((sum, item) => sum + Number(item.maxShelfStock || item.shelfMaxStock || item.maxStock || 0), 0);
  if (explicitCapacity > 0) {
    return explicitCapacity;
  }
  const criticalBased = productsInCell.reduce((sum, item) => sum + Number(item.criticalStock || 0), 0) * 3;
  const stockBased = stockNumeric > 0 ? Math.ceil(stockNumeric * 1.5) : 0;
  return Math.max(criticalBased, stockBased, stockNumeric > 0 ? 6 : 0, 1);
};
