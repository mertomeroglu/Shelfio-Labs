import { Barcode, Camera, LoaderCircle, PackagePlus, RotateCcw, Search, X } from 'lucide-react';
import { formatCurrency } from '../../services/formatters.js';
import { getProductDisplayPrice, getProductDisplayUnit } from '../../services/productService.js';

export default function CustomerCartQuickScanModal({
  open,
  status,
  error,
  product,
  lastCode,
  manualQuery,
  searchResults,
  onManualQueryChange,
  onManualSearch,
  onSelectResult,
  onAdd,
  onSkip,
  onRetry,
  onClose,
}) {
  if (!open) return null;

  const price = getProductDisplayPrice(product);
  const originalPrice = Number(product?.originalPrice ?? product?.salePrice ?? product?.price ?? price);
  const hasDiscount = product?.hasActiveDiscount === true && originalPrice > price;
  const productName = product?.productName || product?.name || 'Ürün';
  const unit = getProductDisplayUnit(product);
  const isSearching = status === 'manual-searching';

  return (
    <div className="customer-cart-scan-overlay" role="dialog" aria-modal="true" aria-label="Hızlı ürün ekle">
      <section className="customer-cart-scan-sheet">
        <header className="customer-cart-scan-header">
          <div>
            <span className="customer-cart-scan-title-icon"><PackagePlus size={18} /></span>
            <div>
              <h3>Hızlı Ürün Ekle</h3>
              <p>Barkodu kameraya gösterin.</p>
            </div>
          </div>
          <button type="button" className="ghost-button" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </header>

        <div className="customer-cart-scan-camera">
          <div id="customer-cart-quick-scan-reader" />
          {status === 'resolving-product' ? (
            <div className="customer-cart-scan-camera-state">
              <LoaderCircle size={24} className="spin" />
              <span>Ürün aranıyor...</span>
            </div>
          ) : null}
        </div>

        {status === 'scanning' ? (
          <div className="customer-cart-scan-hint"><Camera size={16} /> Barkodu çerçevenin içinde tutun.</div>
        ) : null}

        <form
          className="customer-cart-scan-search"
          onSubmit={(event) => {
            event.preventDefault();
            onManualSearch?.();
          }}
        >
          <label htmlFor="customer-cart-quick-search">Manuel ürün arama</label>
          <div className="customer-cart-scan-search-row">
            <input
              id="customer-cart-quick-search"
              type="search"
              value={manualQuery}
              onChange={(event) => onManualQueryChange?.(event.target.value)}
              placeholder="Barkod, ürün adı veya SKU girin"
              autoComplete="off"
            />
            <button type="submit" className="primary-button" disabled={isSearching || !String(manualQuery || '').trim()} aria-label="Ürün ara">
              {isSearching ? <LoaderCircle size={18} className="spin" /> : <Search size={18} />}
            </button>
          </div>
        </form>

        {status === 'search-results' && searchResults.length > 0 ? (
          <div className="customer-cart-scan-results" aria-label="Arama sonuçları">
            <div className="customer-cart-scan-results-head">
              <strong>Ürün seçin</strong>
              <small>{searchResults.length} sonuç</small>
            </div>
            <div className="customer-cart-scan-results-list">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  className="customer-cart-scan-result"
                  onClick={() => onSelectResult?.(result)}
                >
                  <span>
                    <strong>{result.productName || result.name || 'Ürün'}</strong>
                    <small>{[result.barcode || result.sku, getProductDisplayUnit(result)].filter(Boolean).join(' · ')}</small>
                  </span>
                  <b>{formatCurrency(getProductDisplayPrice(result))}</b>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {status === 'permission-error' || status === 'product-not-found' ? (
          <div className="customer-cart-scan-message is-error">
            <Barcode size={20} />
            <div>
              <strong>{status === 'product-not-found' ? 'Ürün bulunamadı' : 'Kamera açılamadı'}</strong>
              <p>{error || 'Lütfen tekrar deneyin.'}</p>
              {status === 'product-not-found' && lastCode ? <small>Aranan değer: {lastCode}</small> : null}
            </div>
            <button type="button" className="primary-button" onClick={onRetry}><RotateCcw size={15} /> Tekrar Dene</button>
          </div>
        ) : null}

        {status === 'product-found' && product ? (
          <div className="customer-cart-scan-product">
            <div className="customer-cart-scan-product-copy">
              <small>Ürün bulundu</small>
              <h4>{productName}</h4>
              <p>{[product.barcode || product.sku, unit].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="customer-cart-scan-price">
              {hasDiscount ? <del>{formatCurrency(originalPrice)}</del> : null}
              <strong>{formatCurrency(price)}</strong>
              {hasDiscount ? <small>{product.activeCampaign?.name || product.campaignInfo || 'Kampanyalı fiyat'}</small> : null}
            </div>
            <div className="customer-cart-scan-actions">
              <button type="button" className="ghost-button" onClick={onSkip}>Geç</button>
              <button type="button" className="primary-button" onClick={onAdd}><PackagePlus size={17} /> Ekle</button>
            </div>
          </div>
        ) : null}

        <button type="button" className="ghost-button customer-cart-scan-close" onClick={onClose}>Kapat</button>
      </section>
    </div>
  );
}
