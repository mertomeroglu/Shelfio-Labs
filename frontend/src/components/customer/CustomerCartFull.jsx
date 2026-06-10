import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ListChecks, MapPin, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { formatCurrency, normalizeTurkishText } from '../../services/formatters.js';
import { getProductDisplayPrice } from '../../services/productService.js';

function repairCustomerText(value, fallback = '') {
  return normalizeTurkishText(value, fallback);
}

function resolveLocationLabel(product) {
  return repairCustomerText(product?.shelfCode || product?.defaultShelfLocationCode || product?.sectionName || '', '-');
}

function buildCartMetaItems(product, available) {
  const unitLabel = repairCustomerText(product?.unit || '', 'adet');
  const locationLabel = resolveLocationLabel(product);
  const items = [{ key: 'unit', label: `Birim: ${unitLabel}` }];
  if (locationLabel && locationLabel !== '-') {
    items.push({ key: 'location', label: locationLabel });
  }
  items.push({ key: 'stock', label: available ? 'Mağazada mevcut' : 'Mağazada mevcut değil' });
  return items;
}

function ConfirmActionModal({ title, description, confirmLabel, tone = 'info', onCancel, onConfirm }) {
  const Icon = tone === 'success' ? CheckCircle2 : ListChecks;
  return (
    <div className="cart-info-modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="cart-info-modal-card cart-confirm-modal-card">
        <header className="cart-confirm-header">
          <div className="cart-confirm-heading">
            <div className={`cart-confirm-icon ${tone === 'success' ? 'is-success' : 'is-info'}`}><Icon size={16} /></div>
            <strong>{title}</strong>
          </div>
          <button type="button" className="ghost-button cart-confirm-close" onClick={onCancel} aria-label="Kapat">
            <X size={16} />
          </button>
        </header>
        <div className="cart-confirm-body">
          <p className="cart-confirm-text">{description}</p>
        </div>
        <div className="cart-confirm-actions">
          <button type="button" className="ghost-button cart-btn-secondary" onClick={onCancel}>Vazgeç</button>
          <button type="button" className="primary-button cart-btn-primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export default function CustomerCartFull({
  cartEntries,
  onUpdateQuantity,
  onStartShopping,
  onCheckout,
  onOpenProduct,
  onClearCart,
  onShowMessage,
  cartSyncError = '',
  onRetryCartSync,
}) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmCheckout, setConfirmCheckout] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const previousCartIdsRef = useRef([]);
  const hasOpenModal = Boolean(confirmCheckout || confirmClear);

  useEffect(() => {
    if (!hasOpenModal) return undefined;
    const { style } = document.body;
    const prevOverflow = style.overflow;
    const prevTouchAction = style.touchAction;
    style.overflow = 'hidden';
    style.touchAction = 'none';
    return () => {
      style.overflow = prevOverflow;
      style.touchAction = prevTouchAction;
    };
  }, [hasOpenModal]);

  useEffect(() => {
    const nextIds = cartEntries.map(({ product }) => String(product.id));
    const previousIds = previousCartIdsRef.current;
    setSelectedIds((current) => {
      const nextSelection = current.filter((id) => nextIds.includes(String(id)));
      const nextSelectionSet = new Set(nextSelection.map(String));
      nextIds
        .filter((id) => !previousIds.includes(id))
        .forEach((id) => {
          if (!nextSelectionSet.has(id)) nextSelection.push(id);
        });
      return nextSelection;
    });
    previousCartIdsRef.current = nextIds;
  }, [cartEntries]);

  const selectedSet = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
  const scopedEntries = useMemo(
    () => cartEntries.filter(({ product }) => selectedSet.has(String(product.id))),
    [cartEntries, selectedSet]
  );
  const scopedSubtotal = useMemo(
    () => scopedEntries.reduce((sum, row) => sum + (getProductDisplayPrice(row.product) * Number(row.quantity || 0)), 0),
    [scopedEntries]
  );
  const vat = scopedSubtotal * 0.1;
  const grandTotal = scopedSubtotal + vat;
  const hasSelection = selectedIds.length > 0;

  const toggleSelection = (productId) => {
    const pid = String(productId);
    setSelectedIds((current) => (current.includes(pid) ? current.filter((id) => id !== pid) : [...current, pid]));
  };

  const toggleAll = () => {
    if (selectedIds.length === cartEntries.length) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(cartEntries.map(({ product }) => String(product.id)));
  };

  if (cartEntries.length === 0) {
    return (
      <div className="customer-subpage customer-cart-full customer-cart-full-v2">
        <div className="empty-state-box cart-empty-box">
          <ShoppingBag size={64} color="#cbd5e1" />
          <h4>Sepetiniz boş</h4>
          <p>Sepetinizde henüz ürün bulunmuyor.</p>
          <button className="primary-button" onClick={onStartShopping}>Alışverişe Başla</button>
        </div>
      </div>
    );
  }

  return (
    <div className="customer-subpage customer-cart-full customer-cart-full-v2">
      <div className="cart-item-list cart-item-list-full">
        <div className="cart-list-selection-head">
          <label>
            <input type="checkbox" checked={selectedIds.length === cartEntries.length} onChange={toggleAll} />
            <span>Tümünü Seç</span>
          </label>
          <div className="cart-list-selection-actions">
            <small>{`${selectedIds.length} ürün seçili`}</small>
            <button
              type="button"
              className="ghost-button cart-clear-btn"
              onClick={() => setConfirmClear(true)}
            >
              Sepeti Temizle
            </button>
          </div>
        </div>

        {cartEntries.map(({ product, quantity }) => {
          const productLoading = product?.isCartProductLoading === true;
          const productUnavailable = product?.isCartProductUnavailable === true;
          const unitPrice = getProductDisplayPrice(product);
          const locationLabel = resolveLocationLabel(product);
          const available = !productLoading && Number(product?.available ?? product?.stockSummary?.available ?? product?.currentStock ?? product?.totalStock ?? 0) > 0;
          const metaItems = buildCartMetaItems(product, available);

          return (
            <article
              key={product.id}
              className="cart-full-item cart-full-item-minimal cart-full-item-clickable"
              onClick={() => { if (!productLoading && !productUnavailable) onOpenProduct?.(product.id); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (!productLoading && !productUnavailable) onOpenProduct?.(product.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="cart-full-item-main cart-full-item-main-v2">
                <div className="cart-item-main-left">
                  <label className="cart-item-select">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(String(product.id))}
                      onChange={() => toggleSelection(product.id)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </label>
                  <div className="item-details">
                    <strong>{repairCustomerText(product.productName, 'Ürün')}</strong>
                    <div className="price-row">
                      <span className="price">{formatCurrency(unitPrice)}</span>
                    </div>
                    <div className="cart-item-inline-meta">
                      {productLoading ? <small>Ürün bilgileri yükleniyor...</small> : null}
                      {productUnavailable ? <small className="is-passive">Bu ürün artık satışta değil.</small> : null}
                      {!productLoading ? metaItems.map((meta) => (
                        <small
                          key={`${product.id}-${meta.key}`}
                          className={meta.label === 'Mağazada mevcut' ? 'is-ok' : meta.label === 'Mağazada mevcut değil' ? 'is-passive' : ''}
                        >
                          {meta.key === 'location' && locationLabel !== '-' ? <MapPin size={12} /> : null}
                          {meta.label}
                        </small>
                      )) : null}
                    </div>
                  </div>
                </div>
                <div className="cart-item-main-right">
                  <div className="cart-item-control-row">
                    <div className="qty-controls">
                      <button type="button" disabled={productLoading} onClick={(event) => { event.stopPropagation(); onUpdateQuantity(product.id, quantity - 1); }} aria-label="Azalt"><Minus size={15} /></button>
                      <span>{quantity}</span>
                      <button
                        type="button"
                        disabled={productLoading || !available || quantity >= Number(product?.available ?? product?.stockSummary?.available ?? product?.currentStock ?? product?.totalStock ?? 0)}
                        style={(!available || quantity >= Number(product?.available ?? product?.stockSummary?.available ?? product?.currentStock ?? product?.totalStock ?? 0)) ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                        onClick={(event) => { event.stopPropagation(); onUpdateQuantity(product.id, quantity + 1); }}
                        aria-label="Artır"
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="ghost-button cart-remove-btn"
                      aria-label="Ürünü sepetten kaldır"
                      onClick={(event) => { event.stopPropagation(); onUpdateQuantity(product.id, 0); }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="cart-full-summary cart-surface-shell">
        <div className="summary-row"><span>Toplam</span><strong>{formatCurrency(scopedSubtotal)}</strong></div>
        <div className="summary-row"><span>KDV</span><strong>{formatCurrency(vat)}</strong></div>
        <div className="summary-row total"><span>Genel Toplam</span><strong>{formatCurrency(grandTotal)}</strong></div>
        {cartSyncError ? (
          <div className="customer-mobile-order-error">
            <span>{cartSyncError}</span>
            <button type="button" className="ghost-button" onClick={onRetryCartSync}>Tekrar Dene</button>
          </div>
        ) : null}
        <div className="cart-summary-actions">
          <button
            type="button"
            className="primary-button cart-checkout-btn"
            onClick={() => {
              if (!hasSelection) {
                onShowMessage?.('Lütfen en az bir ürün seçin.', 'error');
                return;
              }
              if (scopedEntries.some((row) => row.product?.isCartProductLoading === true)) {
                onShowMessage?.('Sepet bilgileri hazırlanıyor. Lütfen kısa bir süre sonra tekrar deneyin.', 'error');
                return;
              }
              if (scopedEntries.some((row) => row.product?.isCartProductUnavailable === true)) {
                onShowMessage?.('Sepetinizde artık satışta olmayan ürünler var. Devam etmek için bu ürünleri kaldırın.', 'error');
                return;
              }
              const outOfStockSelected = scopedEntries.some(
                (row) =>
                  Number(
                    row.product?.available ??
                      row.product?.stockSummary?.available ??
                      row.product?.currentStock ??
                      row.product?.totalStock ??
                      0
                  ) <= 0
              );
              if (outOfStockSelected) {
                onShowMessage?.('Sepetinizde stokta olmayan ürünler bulunmaktadır. Lütfen bu ürünleri sepetten çıkarın.', 'error');
                return;
              }
              const insufficientSelected = scopedEntries.some(
                (row) => {
                  const stockLimit = Number(
                    row.product?.available ??
                      row.product?.stockSummary?.available ??
                      row.product?.currentStock ??
                      row.product?.totalStock ??
                      0
                  );
                  return row.quantity > stockLimit;
                }
              );
              if (insufficientSelected) {
                onShowMessage?.('Sepetinizdeki bazı ürünlerin miktarı mevcut stoku aşmaktadır. Lütfen miktarları güncelleyin.', 'error');
                return;
              }
              setConfirmCheckout(true);
            }}
          >
            Kasada Tamamla
          </button>
        </div>
      </div>

      {confirmClear ? (
        <ConfirmActionModal
          title="Sepeti Temizle"
          description="Sepetteki tüm ürünler silinsin mi?"
          confirmLabel="Sepeti Temizle"
          tone="info"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            onClearCart?.();
            setSelectedIds([]);
            setConfirmClear(false);
          }}
        />
      ) : null}

      {confirmCheckout ? (
        <ConfirmActionModal
          title="Sepetiniz için kasa kodu oluşturulsun mu?"
          description="Oluşturulan QR kodu veya kasa kodunu kasiyere gösterin. Alışverişiniz ve ödemeniz kasada tamamlanacak."
          confirmLabel="Kasa Kodunu Hazırla"
          tone="success"
          onCancel={() => setConfirmCheckout(false)}
          onConfirm={() => {
            onCheckout(selectedIds);
            setSelectedIds([]);
            setConfirmCheckout(false);
          }}
        />
      ) : null}
    </div>
  );
}
