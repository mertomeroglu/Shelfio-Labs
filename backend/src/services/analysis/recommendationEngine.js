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
  buildRecommendations({
    product,
    metrics,
    daysToExpiry,
    overStockRatio,
    daysToStockout,
    totalStock,
    criticalStock,
    leadTimeDays,
    activeCampaignConflict = null,
    stockGuardrail = {},
    procurementGuardrail = {},
    marginGuardrail = {},
  }) {
    const reasons = [];
    const effects = [];
    const reasonCodes = [];
    const blockingReasons = [];

    const discountRate = getDiscountRate({
      daysToExpiry,
      salesSpeed: metrics.salesSpeed,
      overStockRatio,
      trendDirection: metrics.trendDirection,
    });

    if (daysToExpiry !== null && daysToExpiry <= 7) {
      reasons.push('SKT yaklaşmış');
      reasonCodes.push('near_expiry');
    }
    if (metrics.salesSpeed === 'slow') {
      reasons.push('satış hızı düşük');
      reasonCodes.push('slow_sales');
    }
    if (overStockRatio >= 1.0) {
      reasons.push('stok seviyesi yüksek');
      reasonCodes.push('overstock');
    }
    if (metrics.trendDirection === 'down') {
      reasons.push('satış trendi düşüşte');
      reasonCodes.push('demand_down');
    }

    if (activeCampaignConflict) blockingReasons.push('active_campaign_conflict');
    if (stockGuardrail?.blocksDiscount) blockingReasons.push(...(stockGuardrail.blockingReasons || ['stock_guardrail_blocked']));
    if (procurementGuardrail?.blocksDiscount) blockingReasons.push(...(procurementGuardrail.blockingReasons || ['replenishment_guardrail_blocked']));
    if (marginGuardrail?.blocksDiscount) blockingReasons.push(...(marginGuardrail.blockingReasons || ['margin_guardrail_blocked']));

    const uniqueBlockingReasons = [...new Set(blockingReasons)];
    const isSuppressed = discountRate >= 10 && uniqueBlockingReasons.length > 0;
    const shouldDiscount = discountRate >= 10 && !isSuppressed;

    if (shouldDiscount) {
      effects.push('stok devir hızı artabilir');
      effects.push('SKT kaynaklı fire riski azalabilir');
    } else if (isSuppressed) {
      effects.push('indirim guardrail nedeniyle bastırıldı');
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
    if (isSuppressed) actionSuggestion = 'İndirim önerme; stok, kampanya, tedarik veya marj guardrailini kontrol et';
    else if (shouldOrder && shouldDiscount) actionSuggestion = 'Fiyat indirimi + erken sipariş kombinasyonu uygula';
    else if (shouldOrder) actionSuggestion = 'Sipariş planını öne çek';
    else if (shouldDiscount) actionSuggestion = 'Dinamik indirim veya kampanya başlat';
    else if (overStockRatio >= 1.1 && metrics.salesSpeed === 'slow') actionSuggestion = 'Ön raf görünürlüğü ve paket tekliflerini artır';

    const sourceMetrics = {
      sold7: Number(metrics.sold7 || 0),
      sold30: Number(metrics.sold30 || 0),
      avgDailySales: Number(metrics.avgDaily7 || 0),
      salesSpeed: metrics.salesSpeed,
      trendDirection: metrics.trendDirection,
      totalStock,
      criticalStock,
      daysToStockout,
      daysToExpiry,
      overStockRatio,
      leadTimeDays,
      currentMarginPercent: marginGuardrail?.currentMarginPercent ?? null,
      activeCampaignFlag: Boolean(activeCampaignConflict),
      replenishmentSupportFlag: Boolean(procurementGuardrail?.hasPipeline),
      lowStockGuardrailFlag: Boolean(stockGuardrail?.blocksDiscount),
      marginGuardrailFlag: Boolean(marginGuardrail?.blocksDiscount),
    };

    return {
      discount: {
        hasSuggestion: shouldDiscount,
        discountRate: shouldDiscount ? discountRate : 0,
        opportunityDiscountRate: discountRate,
        recommendedDiscountRate: shouldDiscount ? discountRate : 0,
        newPrice,
        reason: reasons.length ? reasons.join(', ') : 'Belirgin indirim sinyali yok',
        expectedImpact: effects.length ? effects.join(' ve ') : 'Etkisi sınırlı',
        reasonCodes,
        blockingReasons: uniqueBlockingReasons,
        suggestedAction: actionSuggestion,
        isSuppressed,
        suppressionReason: isSuppressed ? uniqueBlockingReasons.join(',') : '',
        sourceMetrics,
        activeCampaignFlag: Boolean(activeCampaignConflict),
        activeCampaignConflict,
        replenishmentSupportFlag: Boolean(procurementGuardrail?.hasPipeline),
        lowStockGuardrailFlag: Boolean(stockGuardrail?.blocksDiscount),
        marginGuardrailFlag: Boolean(marginGuardrail?.blocksDiscount),
      },
      order: {
        hasSuggestion: shouldOrder,
        suggestedQty: suggestedOrderQty,
        suggestedOrderDate,
        reason: orderReason.length ? orderReason.join(', ') : 'Sipariş gereksinimi düşük',
        reasonCodes: orderReason.length ? ['order_pressure'] : [],
      },
      actionSuggestion,
      reasonCodes,
      blockingReasons: uniqueBlockingReasons,
      suggestedAction: actionSuggestion,
      recommendedDiscountRate: shouldDiscount ? discountRate : 0,
      isSuppressed,
      suppressionReason: isSuppressed ? uniqueBlockingReasons.join(',') : '',
      sourceMetrics,
    };
  },
};

