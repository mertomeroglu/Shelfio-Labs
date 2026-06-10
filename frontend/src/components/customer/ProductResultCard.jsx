import { Heart, MapPin, PackageOpen, ShoppingCart } from 'lucide-react';
import { cleanSectionDisplayName, formatCurrency } from '../../services/formatters.js';
import { getProductDisplayPrice } from '../../services/productService.js';

function resolveAvailableStock(product) {
  return Number(
    product?.available
    ?? product?.stockSummary?.available
    ?? product?.currentStock
    ?? product?.totalStock
    ?? product?.onHand
    ?? 0
  );
}

function resolveLocation(product) {
  return cleanSectionDisplayName(product?.shelfCode || product?.defaultShelfLocationCode || product?.sectionName || '-');
}

function resolveDisplayCategory(product = {}) {
  return String(
    product.categoryName
    || product.categoryLabelName
    || product.displayCategory
    || product.category
    || product.etiket
    || product.labelName
    || ''
  ).trim() || '-';
}

export default function ProductResultCard({
  product,
  onDetail,
  onAddToCart,
  isFavorite = false,
  onToggleFavorite,
  cartQuantity = 0,
}) {
  if (!product) return null;
  const price = getProductDisplayPrice(product);
  const originalPrice = Number(product.originalPrice ?? product.salePrice ?? product.price ?? price);
  const hasDiscount = Boolean(product.hasActiveDiscount) && originalPrice > price;
  const campaignLabel = product.activeCampaign?.name || product.campaignInfo || product.campaignBadge || '';
  const stock = resolveAvailableStock(product);
  const inStore = stock > 0;
  const productName = product.productName || product.name || '-';
  const categoryLabel = resolveDisplayCategory(product);

  return (
    <article className={`product-result-card product-result-card--compact ${!inStore ? 'product-result-card--out-of-stock' : ''}`} onClick={() => onDetail(product.id)}>
      <h4 className="product-result-card__title line-clamp-2">{productName}</h4>
      <p className="product-result-card__category">{categoryLabel}</p>
      <div className={`product-result-card__availability ${inStore ? 'is-available' : 'is-unavailable'}`}>
        <PackageOpen size={13} />
        <span>{inStore ? 'Mağazada mevcut' : 'Tükendi'}</span>
      </div>
      {hasDiscount ? <p className="product-result-card__category">{campaignLabel || 'Kampanyalı ürün'}</p> : null}
      <div className="product-result-card__location-chip">
        <MapPin size={12} />
        <span>{resolveLocation(product)}</span>
        {cartQuantity > 0 ? (
          <span className="product-result-card__cart-hint-inline" aria-label="Sepetteki miktar">
            Sepette {cartQuantity}
          </span>
        ) : null}
      </div>

      <div className="product-result-card__footer-row">
        <div className="product-result-card__price">
          {hasDiscount ? <small style={{ textDecoration: 'line-through' }}>{formatCurrency(originalPrice)}</small> : null}
          <strong>{formatCurrency(price)}</strong>
        </div>
        <div className="product-result-card__actions-compact">
          {onToggleFavorite ? (
            <button
              type="button"
              className={`ghost-button product-result-card__icon-btn ${isFavorite ? 'is-favorite' : ''}`}
              aria-label={isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
              onClick={(event) => {
                event.stopPropagation();
                onToggleFavorite(product.id);
              }}
            >
              <Heart size={18} />
            </button>
          ) : null}

          <button
            type="button"
            className="primary-button product-result-card__icon-btn"
            disabled={!inStore}
            aria-label="Sepete ekle"
            onClick={(event) => {
              event.stopPropagation();
              if (inStore) onAddToCart(product.id);
            }}
          >
            <ShoppingCart size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}
