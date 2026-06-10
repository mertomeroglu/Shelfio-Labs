import { ArrowLeft, Heart, MapPin, Sparkles, Tag, Activity, Layers, CalendarClock, Package, ShieldCheck, Shapes } from 'lucide-react';
import { Minus, Plus } from 'lucide-react';
import { cleanSectionDisplayName, formatCurrency } from '../../services/formatters.js';
import { getProductDisplayPrice } from '../../services/productService.js';
import { resolveCustomerProductStockPresentation } from './customerProductStockStatus.js';

function parseHistoryDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveHistoryPrice(row = {}) {
  return Number(row?.price ?? row?.salePrice ?? row?.newPrice ?? row?.currentPrice ?? row?.value ?? row?.amount ?? 0);
}

function buildEffectiveCampaignPoint(product, regularRows = []) {
  const currentPrice = Number(getProductDisplayPrice(product) || 0);
  const originalPrice = Number(product?.originalPrice ?? product?.salePrice ?? product?.price ?? currentPrice);
  const campaignPrice = Number(product?.campaignPrice ?? product?.discountedPrice ?? currentPrice);
  const activeCampaign = product?.activeCampaign || (Array.isArray(product?.activeCampaigns) ? product.activeCampaigns[0] : null) || null;
  const latestRegularRow = regularRows.length ? regularRows[regularRows.length - 1] : null;
  const regularReferencePrice = Number(latestRegularRow?.price || originalPrice || currentPrice);

  if (!activeCampaign || !Number.isFinite(campaignPrice) || campaignPrice <= 0) return null;
  if (!Number.isFinite(regularReferencePrice) || regularReferencePrice <= 0) return null;
  if (campaignPrice >= regularReferencePrice) return null;

  const campaignStartDate = activeCampaign?.startsAt || activeCampaign?.startAt || activeCampaign?.createdAt || new Date().toISOString();
  const parsedCampaignDate = parseHistoryDate(campaignStartDate);
  const latestOrder = Number(latestRegularRow?.order || 0);
  const order = Math.max(
    parsedCampaignDate ? parsedCampaignDate.getTime() : 0,
    latestOrder + 1,
  );
  const campaignName = activeCampaign?.publicName || activeCampaign?.displayName || activeCampaign?.name || product?.campaignInfo || product?.campaignName || '';
  const effectiveRate = regularReferencePrice > 0
    ? Number((((regularReferencePrice - campaignPrice) / regularReferencePrice) * 100).toFixed(2))
    : 0;

  return {
    id: `campaign-effective-${String(activeCampaign?.id || product?.id || 'current')}`,
    code: String(activeCampaign?.id || product?.id || 'current'),
    price: campaignPrice,
    date: campaignStartDate,
    endDate: activeCampaign?.endsAt || activeCampaign?.endAt || '',
    source: 'campaign',
    label: 'Kampanya fiyatı',
    campaignName,
    order,
    regularPrice: regularReferencePrice,
    discountRate: effectiveRate,
  };
}

function normalizePriceHistory(product) {
  const regularRows = (Array.isArray(product?.priceHistory) ? product.priceHistory : [])
    .map((row, index) => {
      const price = resolveHistoryPrice(row);
      const rawDate = row?.at || row?.date || row?.eventDate || row?.createdAt || row?.updatedAt || row?.timestamp || '';
      const parsed = parseHistoryDate(rawDate);
      const eventId = row?.priceEventId || row?.id || `${rawDate || 'row'}-${index}`;
      return {
        id: eventId,
        code: row?.fdtCode || row?.fdtNo || row?.fdtId || row?.priceEventCode || row?.eventCode || row?.transactionCode || row?.referenceCode || row?.code || row?.sku || eventId,
        price,
        date: rawDate,
        source: 'regular',
        label: 'Regular Fiyat',
        order: parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : index,
      };
    })
    .filter((row) => Number.isFinite(row.price) && row.price > 0);
  const sortedRegularRows = regularRows.sort((a, b) => a.order - b.order);
  const effectiveCampaignPoint = buildEffectiveCampaignPoint(product, sortedRegularRows);
  return effectiveCampaignPoint ? [...sortedRegularRows, effectiveCampaignPoint] : sortedRegularRows;
}

function formatDetailDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
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

function buildSmoothPath(points) {
  if (!Array.isArray(points) || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const path = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] || current;
    const afterNext = points[index + 2] || next;
    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (afterNext.x - current.x) / 6;
    const cp2y = next.y - (afterNext.y - current.y) / 6;
    path.push(`C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`);
  }
  return path.join(' ');
}

function renderPriceHistoryChart(priceHistory) {
  const rows = Array.isArray(priceHistory) ? priceHistory : [];
  if (!rows.length) {
    return (
      <div className="customer-price-history-empty">
        Fiyat geçmişi verisi bulunamadı.
      </div>
    );
  }

  const chartRows = rows
    .map((item) => ({ ...item, price: Number(item.price || 0) }))
    .filter((item) => Number.isFinite(item.price) && item.price > 0);

  if (!chartRows.length) {
    return (
      <div className="customer-price-history-empty">
        Fiyat geçmişi verisi bulunamadı.
      </div>
    );
  }

  const formatHistoryDate = (value) => {
    if (!value) return '-';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short' });
  };

  const latestFdtRows = chartRows.slice(-5);
  const latestStartIndex = chartRows.length - latestFdtRows.length;

  if (latestFdtRows.length === 1) {
    const onlyRow = latestFdtRows[0];
    return (
      <div className="customer-price-history-single-point">
        <span className="customer-price-history-single-dot" />
        <div>
          <strong>{formatCurrency(onlyRow.price)}</strong>
          <small>{formatHistoryDate(onlyRow.date)}</small>
        </div>
      </div>
    );
  }

  const width = 360;
  const height = 168;
  const pad = { top: 10, right: 10, bottom: 28, left: 34 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const prices = latestFdtRows.map((item) => item.price);
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const spread = Math.max(rawMax - rawMin, rawMax * 0.04, 1);
  const minPrice = rawMin === rawMax ? rawMin - spread / 2 : rawMin - spread * 0.12;
  const maxPrice = rawMin === rawMax ? rawMax + spread / 2 : rawMax + spread * 0.12;
  const priceRange = Math.max(maxPrice - minPrice, 1);
  const points = latestFdtRows.map((item, index) => {
    const x = pad.left + (latestFdtRows.length === 1 ? chartWidth / 2 : (index / (latestFdtRows.length - 1)) * chartWidth);
    const y = pad.top + chartHeight - ((item.price - minPrice) / priceRange) * chartHeight;
    return { ...item, x, y, label: String(latestStartIndex + index + 1), dateLabel: formatHistoryDate(item.date) };
  });
  const linePath = buildSmoothPath(points);
  const chartColor = '#6366f1';

  return (
    <div className="customer-price-history-chart customer-price-history-chart-fdt">
      <svg className="customer-price-history-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Ürün fiyat geçmişi çizgi grafiği" preserveAspectRatio="xMidYMid meet">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = pad.top + chartHeight * ratio;
          return <line key={`grid-${ratio}`} x1={pad.left} x2={pad.left + chartWidth} y1={y} y2={y} className="customer-price-history-grid-line" />;
        })}
        <line x1={pad.left} x2={pad.left} y1={pad.top} y2={pad.top + chartHeight} className="customer-price-history-y-axis" />
        <line x1={pad.left} x2={pad.left + chartWidth} y1={pad.top + chartHeight} y2={pad.top + chartHeight} className="customer-price-history-zero-line" />
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const value = maxPrice - (priceRange * ratio);
          const y = pad.top + chartHeight * ratio;
          return <text key={`axis-${ratio}`} x={pad.left - 7} y={y + 3} textAnchor="end" className="customer-price-history-axis-label">{formatCurrency(value).replace(',00', '')}</text>;
        })}
        <path d={linePath} fill="none" stroke={chartColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="customer-price-history-line" />
        {points.map((point, index) => (
          <g key={point.id || `${point.label}-${index}`}>
            <circle cx={point.x} cy={point.y} r="3.4" className="customer-price-history-dot" />
            <title>{`${point.label}. işlem - ${point.dateLabel}: ${formatCurrency(point.price)}${point.source === 'campaign' ? ` (${point.campaignName || 'Kampanya Fiyatı'})` : ''}`}</title>
          </g>
        ))}
        {points.map((point, index) => (
          <text key={`x-${point.id || index}`} x={point.x} y={height - 7} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} className="customer-price-history-x-label">{point.label}</text>
        ))}
      </svg>
    </div>
  );
}

function ProductInfoCard({ icon: Icon, label, value, valueClassName = '' }) {
  return (
    <div className="customer-product-info-card">
      <small>
        <span className="customer-product-info-icon" aria-hidden="true">
          <Icon size={13} />
        </span>
        {label}
      </small>
      <strong className={valueClassName}>{value}</strong>
    </div>
  );
}

export default function CustomerProductDetail({
  product,
  stockForecast,
  stockForecastLoading = false,
  stockForecastError = false,
  similarProducts,
  onBack,
  onAddToCart,
  onUpdateCartQuantity,
  cartQuantity = 0,
  onDetail,
  isFavorite = false,
  onToggleFavorite,
}) {
  if (!product) return null;

  const currentPrice = getProductDisplayPrice(product);
  const originalPrice = Number(product.originalPrice ?? product.salePrice ?? product.price ?? currentPrice);
  const hasDiscount = Boolean(product.hasActiveDiscount) && originalPrice > currentPrice;
  const campaignInfo = product.activeCampaign?.name || product.campaignInfo || product.campaignName || '';
  const stockPresentation = resolveCustomerProductStockPresentation({
    product,
    stockForecast,
    stockForecastLoading,
    stockForecastError,
  });
  const priceHistory = normalizePriceHistory(product);
  const hasHistoryRows = priceHistory.length > 0;
  const latestHistoryRow = hasHistoryRows ? priceHistory[priceHistory.length - 1] : null;
  const latestPrice = Number(latestHistoryRow?.price || currentPrice);
  const previousPrice = latestHistoryRow?.source === 'campaign'
    ? Number(latestHistoryRow?.regularPrice || originalPrice || latestPrice)
    : Number(priceHistory.length >= 2 ? priceHistory[priceHistory.length - 2]?.price || latestPrice : latestPrice);
  const changeAmount = latestPrice - previousPrice;
  const changeRatio = previousPrice > 0 ? ((changeAmount / previousPrice) * 100) : 0;
  const currentCartQuantity = Math.max(0, Math.floor(Number(cartQuantity || 0)));

  return (
    <div className="customer-subpage customer-product-detail-page">
      <header className="subpage-header">
        <button type="button" className="customer-product-detail-back-button" onClick={onBack} aria-label="Geri dön">
          <ArrowLeft size={20} />
        </button>
        <h3 className="customer-detail-title-with-icon"><Sparkles size={16} /><span>Ürün Detayı</span></h3>
      </header>

      <section className="customer-section customer-product-detail-hero">
        <h2 className="customer-product-detail-title">{product.productName}</h2>
        <div className="customer-product-detail-meta-row">
          <div className="customer-product-detail-meta-item"><span>Barkod</span><strong>{product.barcode || '-'}</strong></div>
          <div className="customer-product-detail-meta-item"><span>SKU</span><strong>{product.sku || '-'}</strong></div>
        </div>
        <div className="detail-price-row customer-detail-price-row">
          <strong className="current-price customer-current-price">{formatCurrency(currentPrice)}</strong>
          {hasDiscount ? <del className="old-price">{formatCurrency(originalPrice)}</del> : null}
          {hasDiscount ? <span className="campaign-tag"><Tag size={12} /> {campaignInfo || 'Kampanya'}</span> : null}
        </div>
        <div className="customer-detail-action-row">
          {!stockPresentation.inStore ? (
            <button
              type="button"
              className="primary-button detail-add-btn customer-detail-add-btn"
              disabled
              style={{
                opacity: 0.6,
                cursor: 'not-allowed',
                backgroundColor: '#cbd5e1',
                borderColor: '#cbd5e1',
                color: '#64748b'
              }}
            >
              Bu ürün şu an stokta bulunmamaktadır
            </button>
          ) : currentCartQuantity > 0 ? (
            <div className="customer-detail-qty-control" aria-label="Sepetteki ürün adedi">
              <button type="button" onClick={() => onUpdateCartQuantity?.(product.id, currentCartQuantity - 1)} aria-label="Adedi azalt">
                <Minus size={17} />
              </button>
              <strong>{currentCartQuantity}</strong>
              <button
                type="button"
                disabled={currentCartQuantity >= stockPresentation.canonicalAvailableStock}
                onClick={() => onUpdateCartQuantity?.(product.id, currentCartQuantity + 1)}
                aria-label="Adedi artır"
              >
                <Plus size={17} />
              </button>
            </div>
          ) : (
            <button type="button" className="primary-button detail-add-btn customer-detail-add-btn" onClick={() => onAddToCart(product.id)}>Sepete Ekle</button>
          )}
          {onToggleFavorite ? (
            <button
              type="button"
              className={`customer-detail-favorite-icon-btn ${isFavorite ? 'is-active' : ''}`}
              onClick={() => onToggleFavorite(product.id)}
              aria-label={isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
              title={isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
            >
              <Heart size={19} fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
          ) : null}
        </div>
      </section>

      <section className="customer-section customer-product-info-grid-wrap">
        <h3 className="customer-product-section-head"><MapPin size={18} color="#3b82f6" /> {'Mağaza ve Ürün Durumu'}</h3>
        <div className="customer-product-info-grid">
          <ProductInfoCard icon={Shapes} label="Kategori" value={resolveDisplayCategory(product)} />
          <ProductInfoCard icon={Package} label="Birim" value={product.unit || 'Adet'} />
          <ProductInfoCard icon={MapPin} label="Reyon" value={cleanSectionDisplayName(product.shelfCode || product.defaultShelfLocationCode || product.sectionName || '-')} />
          <ProductInfoCard icon={CalendarClock} label={'Tahmini stok bitişi'} value={stockPresentation.estimatedStockoutLabel} />
          <ProductInfoCard icon={CalendarClock} label="Son yenilenme" value={stockPresentation.replenishmentLabel} />
          <ProductInfoCard icon={ShieldCheck} label="Stok Durumu" value={stockPresentation.stockStatusLabel} valueClassName={stockPresentation.stockStatusClassName} />
        </div>
      </section>

      <section className="customer-section">
        <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px', color: '#0f172a' }}>
          <Activity size={20} color="#6366f1" /> Fiyat Geçmişi
        </h3>
        <div className="customer-price-history-summary">
          <div><small>Bir önceki fiyat</small><strong>{formatCurrency(previousPrice)}</strong></div>
          <div><small>Güncel fiyat</small><strong>{formatCurrency(latestPrice)}</strong></div>
          <div><small>Değişim</small><strong style={{ color: changeAmount > 0 ? '#dc2626' : changeAmount < 0 ? '#16a34a' : '#334155' }}>{changeAmount === 0 ? '%0,00' : `${changeAmount > 0 ? '+' : ''}%${changeRatio.toFixed(2)}`}</strong></div>
        </div>
        <div className="price-chart-box">
          {renderPriceHistoryChart(priceHistory)}
          {!hasHistoryRows ? <small className="customer-price-history-fallback">Geçmiş veri olmadığı için önceki ve güncel fiyat aynı gösterildi.</small> : null}
        </div>
      </section>

      <section className="customer-section customer-similar-wrap">
        <h3 className="customer-product-section-head"><Layers size={18} color="#f97316" /> Benzer Ürünler</h3>
        {Array.isArray(similarProducts) && similarProducts.length > 0 ? (
          <div className="customer-similar-grid">
            {similarProducts.slice(0, 4).map((item) => (
              <button key={item.id} type="button" className="mini-product-card customer-similar-card" onClick={() => onDetail(item.id)}>
                <strong className="customer-similar-title">{item.productName}</strong>
                <p>{formatCurrency(getProductDisplayPrice(item))}</p>
                <small>{resolveDisplayCategory(item)}</small>
              </button>
            ))}
          </div>
        ) : <div className="empty-state-box">Bu ürün için benzer ürün bulunamadı.</div>}
      </section>
    </div>
  );
}
