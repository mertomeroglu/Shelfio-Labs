import { useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, MapPin, X } from 'lucide-react';

function CategoryThumb({ categoryImage, categoryName, productName }) {
  const [failed, setFailed] = useState(false);

  if (categoryImage && !failed) {
    return (
      <img
        src={categoryImage}
        alt={categoryName || ''}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="customer-route-plan-thumb-fallback">
      <span>{String(productName || '?').substring(0, 1).toUpperCase()}</span>
    </div>
  );
}

const resolveRouteLocationChipText = (item = {}) => (
  item.location?.staticText
  || item.location?.readableLocation
  || item.readableLocation
  || 'Lokasyon bilgisi yok'
);

const resolveRouteLocationDetailText = (item = {}) => {
  return '';
};

export default function CustomerCartRoutePlanSheet({
  isOpen,
  onClose,
  loading,
  error,
  routePlan,
  customerId = '',
  cart = {},
}) {
  const [checkedItems, setCheckedItems] = useState({});

  const checklistKey = `shelfio.customer.routeChecklist.${customerId || 'guest'}`;

  // Read checked items from localStorage when drawer opens or customer changes
  useEffect(() => {
    if (isOpen) {
      try {
        const raw = localStorage.getItem(checklistKey);
        const parsed = raw ? JSON.parse(raw) : {};
        setCheckedItems(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        setCheckedItems({});
      }
    }
  }, [isOpen, checklistKey]);

  // Prevent background scrolling when bottom sheet is open
  useEffect(() => {
    if (isOpen) {
      const { style } = document.body;
      const prevOverflow = style.overflow;
      const prevTouchAction = style.touchAction;
      style.overflow = 'hidden';
      style.touchAction = 'none';
      return () => {
        style.overflow = prevOverflow;
        style.touchAction = prevTouchAction;
      };
    }
    return undefined;
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggle = (productId) => {
    const pid = String(productId);
    const nextChecked = {
      ...checkedItems,
      [pid]: !checkedItems[pid],
    };
    setCheckedItems(nextChecked);
    try {
      localStorage.setItem(checklistKey, JSON.stringify(nextChecked));
    } catch (e) {
      // ignore storage write errors
    }
  };

  const routes = Array.isArray(routePlan?.route) ? routePlan.route : [];
  const missing = Array.isArray(routePlan?.missingLocation) ? routePlan.missingLocation : [];
  const totalItemsCount = routes.length + missing.length;

  return (
    <div className="customer-route-plan-backdrop" role="dialog" aria-modal="true" aria-label="Toplama Planı Panel" onClick={onClose}>
      <div className="customer-route-plan-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Top Handle for mobile drawer */}
        <div className="customer-route-plan-drag-handle" aria-hidden="true" onClick={onClose} />

        {/* Header */}
        <header className="customer-route-plan-header">
          <div className="customer-route-plan-title-area">
            <h2>Toplama Planı</h2>
            {totalItemsCount > 0 && (
              <span className="customer-route-plan-count-badge">
                {totalItemsCount} Ürün
              </span>
            )}
          </div>
          <button type="button" className="customer-route-plan-close-btn" onClick={onClose} aria-label="Kapat">
            <X size={20} />
          </button>
        </header>

        {/* Info Box */}
        <div className="customer-route-plan-info">
          <AlertCircle size={16} className="info-icon" />
          <p>Bu liste ürünleri mağaza içinde daha kolay toplamanız için hazırlanır. Sepetinizi veya ödeme işlemini değiştirmez.</p>
        </div>

        {/* Content Area */}
        <div className="customer-route-plan-content">
          {loading ? (
            <div className="customer-route-plan-state is-loading">
              <Loader2 size={32} className="spinner" />
              <span>Rota planı yükleniyor...</span>
            </div>
          ) : error ? (
            <div className="customer-route-plan-state is-error">
              <AlertCircle size={32} />
              <span>{error}</span>
            </div>
          ) : totalItemsCount === 0 ? (
            <div className="customer-route-plan-state is-empty">
              <span>Sepetinizde planlanacak ürün yok.</span>
            </div>
          ) : (
            <div className="customer-route-plan-list-container">
              {/* Route List */}
              {routes.length > 0 && (
                <div className="customer-route-plan-section">
                  <div className="customer-route-plan-section-items">
                    {routes.map((item) => {
                      const isChecked = !!checkedItems[String(item.productId)];
                      const chipText = resolveRouteLocationChipText(item);
                      const detailText = resolveRouteLocationDetailText(item);
                      return (
                        <div key={item.productId} className={`customer-route-plan-item ${isChecked ? 'is-checked' : ''}`}>
                          {/* Route Order Circle Badge */}
                          <div className="customer-route-plan-order-badge">
                            {item.location?.pickOrder || item.routeOrder}
                          </div>

                          <label className="customer-route-plan-checkbox-wrapper">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggle(item.productId)}
                              className="customer-route-plan-checkbox-input"
                              aria-label={`${item.productName || 'Ürün'} toplandı olarak işaretle`}
                            />
                            <span className="customer-route-plan-checkbox-custom">
                              {isChecked && <Check size={14} />}
                            </span>
                          </label>

                          {/* Image Thumbnail */}
                          <div className="customer-route-plan-thumb">
                            <CategoryThumb
                              categoryImage={item.categoryImage}
                              categoryName={item.categoryName}
                              productName={item.productName}
                            />
                          </div>

                          {/* Detail Info */}
                          <div className="customer-route-plan-details">
                            <h3 className="customer-route-plan-item-name">{item.productName}</h3>
                            <div className="customer-route-plan-location-row">
                              <span className={`customer-route-plan-location-tag${item.location?.routeConfidence === 'low' ? ' is-low-confidence' : ''}`}>
                                <MapPin size={12} />
                                {chipText}
                              </span>
                              {detailText ? (
                                <small className="customer-route-plan-location-detail">{detailText}</small>
                              ) : null}
                            </div>
                          </div>

                          <div className="customer-route-plan-qty">
                            <strong>{item.quantity}</strong>
                            <small>{item.unit || 'adet'}</small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Missing Location List */}
              {missing.length > 0 && (
                <div className="customer-route-plan-section missing-section">
                  <h4 className="customer-route-plan-section-title">Konum bilgisi olmayan ürünler</h4>
                  <div className="customer-route-plan-section-items">
                    {missing.map((item) => {
                      const isChecked = !!checkedItems[String(item.productId)];
                      return (
                        <div key={item.productId} className={`customer-route-plan-item ${isChecked ? 'is-checked' : ''}`}>
                          <label className="customer-route-plan-checkbox-wrapper">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggle(item.productId)}
                              className="customer-route-plan-checkbox-input"
                              aria-label={`${item.productName || 'Ürün'} toplandı olarak işaretle`}
                            />
                            <span className="customer-route-plan-checkbox-custom">
                              {isChecked && <Check size={14} />}
                            </span>
                          </label>

                          {/* Image Thumbnail */}
                          <div className="customer-route-plan-thumb">
                            <CategoryThumb
                              categoryImage={item.categoryImage}
                              categoryName={item.categoryName}
                              productName={item.productName}
                            />
                          </div>

                          {/* Detail Info */}
                          <div className="customer-route-plan-details">
                            <h3 className="customer-route-plan-item-name">{item.productName}</h3>
                            <div className="customer-route-plan-location-row">
                              <span className="customer-route-plan-location-tag missing">
                                Lokasyon bilgisi eksik
                              </span>
                            </div>
                          </div>

                          <div className="customer-route-plan-qty">
                            <strong>{item.quantity}</strong>
                            <small>{item.unit || 'adet'}</small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="customer-route-plan-footer">
          <p className="customer-route-plan-footer-hint">Ürünleri topladıktan sonra alışverişi kasada tamamlayabilirsiniz.</p>
          <button type="button" className="customer-route-plan-close-action-btn" onClick={onClose}>
            Kapat
          </button>
        </footer>
      </div>
    </div>
  );
}
