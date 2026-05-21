const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getDiscountRate = ({ daysToExpiry, salesSpeed, overStockRatio, trendDirection }) => {
  let rate = 0;

  if (daysToExpiry !== null && daysToExpiry <= 3) rate += 22;
  else if (daysToExpiry !== null && daysToExpiry <= 7) rate += 15;

  if (salesSpeed === 'slow') rate += 10;
  if (overStockRatio >= 1.1) rate += 8;
  if (trendDirection === 'down') rate += 5;

  return clamp(rate, 0, 35);
};

const getOrderRecommendationQty = ({ totalStock, criticalStock, avgDaily7, leadTimeDays }) => {
  const safeDays = Math.max(7, leadTimeDays + 4);
  const targetStock = Math.max(criticalStock * 2, Math.ceil(avgDaily7 * safeDays));
  const need = Math.max(targetStock - totalStock, 0);
  return Math.ceil(need);
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + Math.max(0, days));
  return next.toISOString();
};

export const recommendationEngine = {
  buildRecommendations({ product, metrics, daysToExpiry, overStockRatio, daysToStockout, totalStock, criticalStock, leadTimeDays }) {
    const reasons = [];
    const effects = [];

    const discountRate = getDiscountRate({
      daysToExpiry,
      salesSpeed: metrics.salesSpeed,
      overStockRatio,
      trendDirection: metrics.trendDirection,
    });

    const shouldDiscount = discountRate >= 10;
    if (daysToExpiry !== null && daysToExpiry <= 7) reasons.push('SKT yaklaşmış');
    if (metrics.salesSpeed === 'slow') reasons.push('satış hızı düşük');
    if (overStockRatio >= 1.0) reasons.push('stok seviyesi yüksek');
    if (metrics.trendDirection === 'down') reasons.push('satış trendi düşüşte');

    if (shouldDiscount) {
      effects.push('stok devir hızı artabilir');
      effects.push('SKT kaynaklı fire riski azalabilir');
    }

    const suggestedOrderQty = getOrderRecommendationQty({
      totalStock,
      criticalStock,
      avgDaily7: metrics.avgDaily7,
      leadTimeDays,
    });

    const shouldOrder =
      suggestedOrderQty > 0 &&
      (totalStock <= criticalStock || metrics.salesSpeed === 'fast' || (daysToStockout !== null && daysToStockout <= leadTimeDays + 4));

    const orderDateDays = metrics.trendDirection === 'up' ? Math.max(0, leadTimeDays - 2) : Math.max(1, leadTimeDays - 1);
    const suggestedOrderDate = shouldOrder ? addDays(new Date(), orderDateDays) : null;

    const orderReason = [];
    if (totalStock <= criticalStock) orderReason.push('kritik stok sınırında');
    if (metrics.salesSpeed === 'fast') orderReason.push('satış hızı yüksek');
    if (daysToStockout !== null && daysToStockout <= leadTimeDays + 4) orderReason.push('stok bitiş süresi kısa');

    const currentPrice = Number(product.salePrice || 0);
    const newPrice = shouldDiscount ? Number((currentPrice * (1 - discountRate / 100)).toFixed(2)) : currentPrice;

    let actionSuggestion = 'İzlemeye devam et';
    if (shouldOrder && shouldDiscount) actionSuggestion = 'Fiyat indirimi + erken sipariş kombinasyonu uygula';
    else if (shouldOrder) actionSuggestion = 'Sipariş planını öne çek';
    else if (shouldDiscount) actionSuggestion = 'Dinamik indirim veya kampanya başlat';
    else if (overStockRatio >= 1.1 && metrics.salesSpeed === 'slow') actionSuggestion = 'Ön raf görünürlüğü ve paket tekliflerini artır';

    return {
      discount: {
        hasSuggestion: shouldDiscount,
        discountRate,
        newPrice,
        reason: reasons.length ? reasons.join(', ') : 'Belirgin indirim sinyali yok',
        expectedImpact: effects.length ? effects.join(' ve ') : 'Etkisi sınırlı',
      },
      order: {
        hasSuggestion: shouldOrder,
        suggestedQty: suggestedOrderQty,
        suggestedOrderDate,
        reason: orderReason.length ? orderReason.join(', ') : 'Sipariş gereksinimi düşük',
      },
      actionSuggestion,
    };
  },
};

