import { useEffect, useMemo, useState } from 'react';
import { MapPin, Package, Search, Warehouse, Grid3x3, ArrowLeft } from 'lucide-react';
import { getDepotDisplayLabel, productService } from '../../services/productService.js';

const PAGE_SIZE = 20;

function resolveDepotLocation(product) {
  if (Array.isArray(product?.depotLocations) && product.depotLocations.length > 0) {
    return getDepotDisplayLabel(product.depotLocations[0]?.locationCode);
  }
  return getDepotDisplayLabel(product?.defaultWarehouseLocationCode || product?.warehouseLocationCode || '-');
}

function resolveShelfLocation(product) {
  return String(product?.shelfCode || product?.defaultShelfLocationCode || product?.sectionNumber || product?.sectionName || '-');
}

function resolveStockSummary(product) {
  const summary = product?.stockSummary || {};
  const shelf = Number(summary.shelfStock ?? product?.shelfStock ?? 0);
  const warehouse = Number(summary.warehouseStock ?? product?.warehouseStock ?? 0);
  const total = Number(summary.totalStock ?? product?.totalStock ?? product?.onHand ?? shelf + warehouse);
  return { total, shelf, warehouse };
}

function normalizeText(value) {
  return String(value || '').trim().toLocaleLowerCase('tr-TR');
}

export default function PersonnelLocation() {
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [allProducts, setAllProducts] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [activeModule, setActiveModule] = useState('reyon');
  const [reyonCode, setReyonCode] = useState('');
  const [depotCode, setDepotCode] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    let mounted = true;
    productService
      .list({ includeUnlisted: false })
      .then((rows) => {
        if (!mounted) return;
        setAllProducts(Array.isArray(rows) ? rows : []);
        setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const categories = useMemo(() => {
    const map = new Map();
    allProducts.forEach((product) => {
      const id = String(product?.categoryId || '').trim();
      const name = String(product?.categoryName || '').trim();
      const key = id || normalizeText(name);
      if (!key || map.has(key)) return;
      map.set(key, { id: id || key, name: name || 'Kategori Yok' });
    });
    return Array.from(map.values()).sort((left, right) => left.name.localeCompare(right.name, 'tr-TR'));
  }, [allProducts]);
  const reyonSearchCode = useMemo(() => String(reyonCode || '').trim().toUpperCase(), [reyonCode]);
  const depotSearchCode = useMemo(() => String(depotCode || '').trim().toUpperCase(), [depotCode]);

  const filteredResults = useMemo(() => {
    if (!searchQuery && !reyonSearchCode && !depotSearchCode && !selectedCategoryId) return [];
    const searchNeedle = normalizeText(searchQuery);
    const reyonNeedle = normalizeText(reyonSearchCode);
    const depotNeedle = normalizeText(depotSearchCode);
    const selectedCategory = categories.find((item) => String(item.id) === String(selectedCategoryId)) || null;
    const selectedCategoryName = normalizeText(selectedCategory?.name || '');

    return allProducts
      .filter((item) => {
        if (searchNeedle.length >= 2) {
          const matchesText = normalizeText(item.productName).includes(searchNeedle)
            || String(item.barcode || '').includes(searchQuery)
            || normalizeText(String(item.sku || '')).includes(searchNeedle);
          if (!matchesText) return false;
        }
        if (reyonNeedle && !normalizeText(resolveShelfLocation(item)).includes(reyonNeedle)) return false;
        if (depotNeedle && !normalizeText(resolveDepotLocation(item)).includes(depotNeedle)) return false;
        if (selectedCategoryId) {
          const productCategoryId = String(item?.categoryId || '').trim();
          const productCategoryName = normalizeText(item?.categoryName || '');
          if (productCategoryId !== String(selectedCategoryId) && (!selectedCategoryName || productCategoryName !== selectedCategoryName)) {
            return false;
          }
        }
        return true;
      });
  }, [allProducts, categories, searchQuery, reyonSearchCode, depotSearchCode, selectedCategoryId]);

  const visibleResults = useMemo(() => filteredResults.slice(0, visibleCount), [filteredResults, visibleCount]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, reyonSearchCode, depotSearchCode, selectedCategoryId]);

  const selectedStock = useMemo(() => resolveStockSummary(selectedProduct), [selectedProduct]);
  const listedCount = filteredResults.length;
  const locationCodeGuide = activeModule === 'reyon' ?
    'Reyon kodu: [ReyonNo][L/R][RafNo]-[Kat]. Örnek: 10L3-2'
    : 'Depo kodu: D[DepoNo]-[L/R]-[RafNo]-[Kat]. Örnek: D2-R-13-07';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {!selectedProduct && (
        <section className="personnel-section-card">
          <div className="personnel-segmented-control" style={{ marginBottom: '16px' }}>
            <button type="button" className={activeModule === 'reyon' ? 'is-active' : ''} onClick={() => { setActiveModule('reyon'); setDepotCode(''); }}>
              <Grid3x3 size={16} style={{ display: 'inline-block', verticalAlign: 'text-bottom', marginRight: '6px' }} /> Reyon
            </button>
            <button type="button" className={activeModule === 'depo' ? 'is-active' : ''} onClick={() => { setActiveModule('depo'); setReyonCode(''); }}>
              <Warehouse size={16} style={{ display: 'inline-block', verticalAlign: 'text-bottom', marginRight: '6px' }} /> Depo
            </button>
          </div>

          {activeModule === 'reyon' ? (
            <div className="personnel-form-group">
              <span>Reyon Kodu Ara</span>
              <input className="personnel-input" placeholder="Örn: 10L3-2" value={reyonCode} onChange={(e) => setReyonCode(e.target.value)} />
            </div>
          ) : (
            <div className="personnel-form-group">
              <span>Depo Kodu Ara</span>
              <input className="personnel-input" placeholder="Örn: D2-R-13-07" value={depotCode} onChange={(e) => setDepotCode(e.target.value)} />
            </div>
          )}
          <div className="personnel-code-info-box">
            {locationCodeGuide}
          </div>

          <div style={{ width: '100%', height: '1px', background: '#e2e8f0', margin: '16px 0' }}></div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="personnel-search-wrapper">
              <Search size={20} />
              <input
                className="personnel-input"
                placeholder="Ürün adı, barkod veya SKU ara..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <select
              className="personnel-select"
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
            >
              <option value="">Tüm Kategoriler</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>
        </section>
      )}

      {loading ? <div className="personnel-empty-state">Sorgulanıyor...</div> : null}

      {!loading && !selectedProduct && filteredResults.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="personnel-list-count">{listedCount} ürün listeleniyor</div>
          {visibleResults.map((item) => {
            const stock = resolveStockSummary(item);
            return (
              <div key={item.id} className="personnel-list-card" style={{ cursor: 'pointer' }} onClick={() => setSelectedProduct(item)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                    <strong style={{ fontSize: '1rem', color: '#0f172a' }}>{item.productName}</strong>
                    <span className="personnel-inline-code">Barkod: {item.barcode || '-'}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '6px', fontSize: '0.85rem', color: '#64748b' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><MapPin size={14} /> Reyon: {resolveShelfLocation(item)}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Package size={14} /> Toplam Stok: {stock.total}</span>
                    <span>Depo: {stock.warehouse}</span>
                    <span>Reyon: {stock.shelf}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {visibleResults.length < filteredResults.length ? (
            <button type="button" className="ghost-button" style={{ minHeight: '40px', justifyContent: 'center' }} onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}>
              Daha Fazla Göster
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && filteredResults.length === 0 && !selectedProduct && (searchQuery.length >= 2 || reyonSearchCode || depotSearchCode || selectedCategoryId) ? (
        <div className="personnel-empty-state">{selectedCategoryId ? 'Seçilen kategoriye ait ürün bulunamadı.' : 'Eşleşen ürün bulunamadı.'}</div>
      ) : null}

      {selectedProduct ? (
        <section className="personnel-section-card">
          <button type="button" className="ghost-button" style={{ minHeight: '36px', padding: '0 12px', marginBottom: '16px', fontSize: '0.85rem' }} onClick={() => setSelectedProduct(null)}>
            <ArrowLeft size={16} /> Aramaya Dön
          </button>
          <div style={{ paddingBottom: '12px', borderBottom: '1px solid #e2e8f0', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0f172a' }}>{selectedProduct.productName}</h3>
          </div>
          <div className="personnel-info-grid">
            <div><span>Depo Lokasyonu</span><strong>{resolveDepotLocation(selectedProduct)}</strong></div>
            <div><span>Reyon Lokasyonu</span><strong>{resolveShelfLocation(selectedProduct)}</strong></div>
            <div><span>Depo Stok</span><strong>{selectedStock.warehouse}</strong></div>
            <div><span>Reyon Stok</span><strong>{selectedStock.shelf}</strong></div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
