const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const DISCOUNT_THRESHOLD = 10;

const normalizeText = (value) => String(value || '').toLocaleLowerCase('tr-TR');

const isExpirySensitiveProduct = (product = {}) => {
  const haystack = normalizeText([
    product.categoryName,
    product.category,
    product.storageType,
    product.name,
  ].filter(Boolean).join(' '));

  const excluded = ['temizlik', 'kisisel', 'kişisel', 'elektronik', 'kitap', 'kirtasiye', 'kırtasiye', 'ev, yasam', 'ev, yaşam'];
  if (excluded.some((key) => haystack.includes(key))) return false;

  const included = ['gida', 'gıda', 'icecek', 'içecek', 'sut', 'süt', 'kahvalti', 'kahvaltı', 'meyve', 'sebze', 'hazir', 'hazır', 'donuk', 'et', 'tavuk', 'balik', 'balık', 'atistirmalik', 'atıştırmalık', 'bebek', 'evcil'];
  return included.some((key) => haystack.includes(key));
};

const getDiscountRate = ({ daysToExpiry, salesSpeed, overStockRatio, trendDirection, expirySensitive = true }) => {
  let rate = 0;

  if (expirySensitive && daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 3) rate += 22;
  else if (expirySensitive && daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 7) rate += 15;

  if (salesSpeed === 'slow') rate += 5;
  if (overStockRatio >= 1.1) rate += 8;
  if (trendDirection === 'down') rate += 5;

  return clamp(rate, 0, 35);
};

const buildPrimaryAction = ({
  shouldOrder,
  shouldDiscount,
  isSuppressed,
  hasCampaignSignal,
  hasWatchSignal,
}) => {
  if (shouldOrder) return 'order_priority';
  if (shouldDiscount) return 'discount_action';
  if (!isSuppressed && hasCampaignSignal) return 'campaign_candidate';
  if (isSuppressed || hasWatchSignal) return 'watch_only';
  return 'hold_price';
};

const primaryActionLabel = {
  discount_action: 'Aksiyon Gerekli',
  watch_only: 'İzlenmeli',
  hold_price: 'Fiyatı Koru',
  order_priority: 'Sipariş Baskısı',
  campaign_candidate: 'Kampanya Adayı',
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

    const expirySensitive = isExpirySensitiveProduct(product);
    const expiredSignal = daysToExpiry !== null && daysToExpiry < 0;
    const nearExpirySignal = expirySensitive && daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 7;
    const criticalExpirySignal = expirySensitive && daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 3;
    const ignoredExpirySignal = !expirySensitive && daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 7;
    const slowSignal = metrics.salesSpeed === 'slow';
    const overstockSignal = overStockRatio >= 1.0;
    const strongOverstockSignal = overStockRatio >= 1.1;
    const demandDownSignal = metrics.trendDirection === 'down';

    const discountRate = getDiscountRate({
      daysToExpiry,
      salesSpeed: metrics.salesSpeed,
      overStockRatio,
      trendDirection: metrics.trendDirection,
      expirySensitive,
    });

    if (expiredSignal) {
      reasons.push('SKT geçmiş');
      reasonCodes.push('expired_product', 'expired_product_disposal_required');
    } else if (nearExpirySignal) {
      reasons.push('SKT yaklaşmış');
      reasonCodes.push('near_expiry');
    } else if (ignoredExpirySignal) {
      reasons.push('SKT sinyali kategori nedeniyle izlemeye alındı');
      reasonCodes.push('expiry_signal_ignored');
    }
    if (slowSignal) {
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

    if (expiredSignal) blockingReasons.push('expired_product', 'expired_product_disposal_required');
    if (activeCampaignConflict) blockingReasons.push('active_campaign_conflict');
    if (stockGuardrail?.blocksDiscount) blockingReasons.push(...(stockGuardrail.blockingReasons || ['stock_guardrail_blocked']));
    if (procurementGuardrail?.blocksDiscount) blockingReasons.push(...(procurementGuardrail.blockingReasons || ['replenishment_guardrail_blocked']));
    if (marginGuardrail?.blocksDiscount) blockingReasons.push(...(marginGuardrail.blockingReasons || ['margin_guardrail_blocked']));

    const suggestedOrderQty = getOrderRecommendationQty({
      totalStock,
      criticalStock,
      avgDaily7: metrics.avgDaily7,
      leadTimeDays,
    });

    const shouldOrder =
      !expiredSignal &&
      suggestedOrderQty > 0 &&
      (totalStock <= criticalStock || metrics.salesSpeed === 'fast' || (daysToStockout !== null && daysToStockout <= leadTimeDays + 4));

    if (shouldOrder) blockingReasons.push('order_priority_guardrail');

    const uniqueBlockingReasons = [...new Set(blockingReasons)];
    const hasQualifiedDiscountSignal =
      criticalExpirySignal ||
      nearExpirySignal ||
      (slowSignal && strongOverstockSignal) ||
      (slowSignal && demandDownSignal) ||
      (strongOverstockSignal && demandDownSignal);
    const hasCampaignSignal =
      !expiredSignal &&
      !nearExpirySignal &&
      !shouldOrder &&
      !uniqueBlockingReasons.length &&
      ((slowSignal && overstockSignal) || (overstockSignal && demandDownSignal));
    const hasWatchSignal = expiredSignal || slowSignal || demandDownSignal || ignoredExpirySignal || overStockRatio >= 1.0;
    const isSuppressed = expiredSignal || (discountRate >= DISCOUNT_THRESHOLD && uniqueBlockingReasons.length > 0);
    const shouldDiscount = discountRate >= DISCOUNT_THRESHOLD && hasQualifiedDiscountSignal && !isSuppressed && !shouldOrder;

    if (shouldDiscount) {
      effects.push('stok devir hızı artabilir');
      if (nearExpirySignal) effects.push('SKT kaynaklı fire riski azalabilir');
    } else if (isSuppressed) {
      effects.push('indirim guardrail nedeniyle bastırıldı');
    }

    const orderDateDays = metrics.trendDirection === 'up' ? Math.max(0, leadTimeDays - 2) : Math.max(1, leadTimeDays - 1);
    const suggestedOrderDate = shouldOrder ? addDays(new Date(), orderDateDays) : null;

    const orderReason = [];
    if (totalStock <= criticalStock) orderReason.push('kritik stok sınırında');
    if (metrics.salesSpeed === 'fast') orderReason.push('satış hızı yüksek');
    if (daysToStockout !== null && daysToStockout <= leadTimeDays + 4) orderReason.push('stok bitiş süresi kısa');

    const currentPrice = Number(product.salePrice || 0);
    const newPrice = shouldDiscount ? Number((currentPrice * (1 - discountRate / 100)).toFixed(2)) : currentPrice;

    const primaryAction = buildPrimaryAction({
      shouldOrder,
      shouldDiscount,
      isSuppressed,
      hasCampaignSignal,
      hasWatchSignal,
    });

    let actionSuggestion = primaryActionLabel[primaryAction] || 'İzlemeye devam et';
    if (expiredSignal) actionSuggestion = 'SKT geçmiş ürün için imha / iade değerlendirmesi yap';
    else if (primaryAction === 'discount_action') actionSuggestion = 'Dinamik indirim aksiyonu uygula';
    else if (primaryAction === 'campaign_candidate') actionSuggestion = 'Kampanya adayı olarak planla';
    else if (primaryAction === 'order_priority') actionSuggestion = 'Sipariş planını öne çek';
    else if (primaryAction === 'watch_only') actionSuggestion = 'İzlemeye devam et';

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
      expirySensitive,
      expiredSignal,
      primaryAction,
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
        primaryAction,
        primaryActionLabel: primaryActionLabel[primaryAction],
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
      primaryAction,
      primaryActionLabel: primaryActionLabel[primaryAction],
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

