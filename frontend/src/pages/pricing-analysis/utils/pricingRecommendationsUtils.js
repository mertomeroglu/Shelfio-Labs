export const PRICE_PRESETS = {
  nearExpiry: 'nearExpiry',
  slowSelling: 'slowSelling',
  overstocked: 'overstocked',
  highMargin: 'highMargin',
  campaignEligible: 'campaignEligible',
  conflicted: 'conflicted',
  blocked: 'blocked',
};

const REMOVED_PRICE_FILTER_KEYS = new Set();

export const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizePrice = (value) => Math.max(0, Number(toSafeNumber(value, 0).toFixed(2)));

export const calculateDiscountPercent = (currentPrice, suggestedPrice) => {
  const current = toSafeNumber(currentPrice, 0);
  const suggested = toSafeNumber(suggestedPrice, 0);
  if (current <= 0) return 0;
  const value = ((current - suggested) / current) * 100;
  return Math.max(0, Number(value.toFixed(1)));
};

export const calculateMarginPercent = (price, cost) => {
  const safePrice = toSafeNumber(price, 0);
  const safeCost = toSafeNumber(cost, 0);
  if (safePrice <= 0) return null;
  return Number((((safePrice - safeCost) / safePrice) * 100).toFixed(1));
};

export const classifyExpirationRisk = (daysToExpiry) => {
  const days = toSafeNumber(daysToExpiry, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(days)) return 'unknown';
  if (days <= 3) return 'critical';
  if (days <= 10) return 'soon';
  return 'safe';
};

export const classifyActionType = ({
  discountPercent = 0,
  expirationRisk = 'safe',
  salesVelocity = 0,
  stock = 0,
} = {}) => {
  if (expirationRisk === 'critical' || (stock > 0 && salesVelocity <= 0.4 && stock > 25)) {
    return 'urgent';
  }
  if (discountPercent > 0) return 'discount';
  return 'keep';
};

export const estimateImpact = ({
  currentPrice,
  cost,
  stock,
  salesVelocity,
  discountPercent,
} = {}) => {
  const safePrice = normalizePrice(currentPrice);
  const safeCost = normalizePrice(cost);
  const safeStock = Math.max(0, toSafeNumber(stock, 0));
  const safeVelocity = Math.max(0, toSafeNumber(salesVelocity, 0));
  const safeDiscount = Math.max(0, toSafeNumber(discountPercent, 0));

  const elasticity = 1.15;
  const demandMultiplier = 1 + ((safeDiscount / 100) * elasticity);
  const expectedSales = Number((safeVelocity * demandMultiplier).toFixed(2));
  const depletionDays = expectedSales > 0 ? Number((safeStock / expectedSales).toFixed(1)) : Number.POSITIVE_INFINITY;
  const estimatedSalesIncreasePct = safeVelocity > 0
    ? Number((((expectedSales - safeVelocity) / safeVelocity) * 100).toFixed(1))
    : 0;

  const periodDays = 14;
  const currentRevenue = Number((safePrice * safeVelocity * periodDays).toFixed(2));
  const discountedPrice = normalizePrice(safePrice * (1 - (safeDiscount / 100)));
  const projectedRevenue = Number((discountedPrice * expectedSales * periodDays).toFixed(2));
  const revenueImpact = Number((projectedRevenue - currentRevenue).toFixed(2));

  const currentProfit = Number(((safePrice - safeCost) * safeVelocity * periodDays).toFixed(2));
  const projectedProfit = Number(((discountedPrice - safeCost) * expectedSales * periodDays).toFixed(2));
  const profitImpact = Number((projectedProfit - currentProfit).toFixed(2));

  return {
    expectedSales,
    depletionDays,
    estimatedSalesIncreasePct,
    revenueImpact,
    profitImpact,
  };
};

export const buildReasonSummary = ({
  daysToExpiry,
  stock,
  salesVelocity,
  stockTurnoverRate,
  suggestedDiscount,
} = {}) => {
  const dayLabel = Number.isFinite(toSafeNumber(daysToExpiry, NaN)) ? `${Math.max(0, Math.round(daysToExpiry))} gün` : 'bilinmiyor';
  const stockState = toSafeNumber(stock, 0) > 40 ? 'Yüksek stok' : 'Kontrollü stok';
  const speedState = toSafeNumber(salesVelocity, 0) < 1 ? 'düşük satış hızı' : 'normal satış hızı';
  const turnoverState = toSafeNumber(stockTurnoverRate, 0) < 0.6 ? 'zayıf devir' : 'dengeli devir';
  const discountState = toSafeNumber(suggestedDiscount, 0) > 0 ? `%${Math.round(suggestedDiscount)} indirim önerisi` : 'fiyat koruma önerisi';

  return `${stockState}, ${speedState}, SKT ${dayLabel}, ${turnoverState} -> ${discountState}`;
};

export const applyPricePreset = (currentFilters = {}, preset) => {
  const base = Object.fromEntries(
    Object.entries(currentFilters).filter(([key]) => !REMOVED_PRICE_FILTER_KEYS.has(key))
  );
  switch (preset) {
    case PRICE_PRESETS.nearExpiry:
      return { ...base, sktStatus: 'critical' };
    case PRICE_PRESETS.slowSelling:
      return { ...base, salesSpeed: 'slow' };
    case PRICE_PRESETS.overstocked:
      return { ...base };
    case PRICE_PRESETS.highMargin:
      return { ...base };
    case PRICE_PRESETS.campaignEligible:
    case PRICE_PRESETS.conflicted:
    case PRICE_PRESETS.blocked:
      return { ...base };
    default:
      return base;
  }
};

export const rowMatchesPricePreset = (row = {}, preset) => {
  const days = toSafeNumber(row.daysToExpiry, Number.POSITIVE_INFINITY);
  const salesVelocity = Math.max(0, toSafeNumber(row.salesVelocity, 0));
  const stock = Math.max(0, toSafeNumber(row.stockLevel, 0));
  const margin = toSafeNumber(row.currentMarginPercent, -999);
  const blockingReasons = Array.isArray(row.blockingReasons) ? row.blockingReasons : [];
  const hasActiveCampaignConflict = Boolean(row.activeCampaignConflict || row.activeCampaignFlag || row.hasActiveDiscount);
  const hasLowStockBlock = Boolean(row.lowStockGuardrailFlag || row.stockGuardrail?.blocksDiscount || blockingReasons.some((reason) => ['critical_stock', 'near_critical_fast_moving', 'low_stock_coverage', 'stock_guardrail_blocked'].includes(reason)));
  const hasWeakReplenishment = Boolean(row.procurementGuardrail?.pipelineWeak || row.replenishmentSupportFlag === false || blockingReasons.some((reason) => ['replenishment_pipeline_missing', 'long_lead_time', 'goods_receipt_pending_not_secured', 'replenishment_guardrail_blocked'].includes(reason)));
  const hasLowMarginBlock = Boolean(row.marginGuardrailFlag || row.marginGuardrail?.blocksDiscount || blockingReasons.some((reason) => ['low_margin', 'price_at_or_below_cost', 'margin_guardrail_blocked'].includes(reason)));
  const hasGuardrail = hasLowStockBlock || hasWeakReplenishment || hasLowMarginBlock;

  switch (preset) {
    case PRICE_PRESETS.nearExpiry:
      return Number.isFinite(days) && days <= 10;
    case PRICE_PRESETS.slowSelling:
      return salesVelocity <= 1;
    case PRICE_PRESETS.overstocked:
      return stock >= 40 && salesVelocity <= 2;
    case PRICE_PRESETS.highMargin:
      return margin >= 30;
    case PRICE_PRESETS.campaignEligible:
      return row.campaignEligible !== false && row.actionType === 'campaign_candidate';
    case PRICE_PRESETS.conflicted:
      return hasActiveCampaignConflict;
    case PRICE_PRESETS.blocked:
      return hasGuardrail || Boolean(row.isSuppressed || row.suppressionReason || blockingReasons.length);
    default:
      return true;
  }
};

export const mapEmptyStateReason = ({ rows = [], filters = {} } = {}) => {
  if (Array.isArray(rows) && rows.length > 0) {
    return {
      title: 'Filtreyle eşleşen ürün bulunamadı',
      description: 'Mevcut filtre kombinasyonu bu ekranda aksiyon gerektiren ürün döndürmüyor.',
    };
  }

  if (filters.sktStatus === 'critical') {
    return {
      title: 'SKT riski tespit edilmedi',
      description: 'Kritik veya yakın SKT riski olan ürün görünmüyor.',
    };
  }

  if (filters.salesSpeed === 'slow') {
    return {
      title: 'Yavaş satış baskısı görülmedi',
      description: 'Satış ve stok seviyeleri dengeli görünüyor.',
    };
  }

  return {
    title: 'Fiyat aksiyonu gerektiren ürün bulunmuyor',
    description: 'Fiyat aksiyonu gerektiren ürün bulunmuyor. Satış ve stok seviyeleri dengede.',
  };
};

export const toggleSelectedIds = (selectedIds = [], rowId, checked) => {
  const set = new Set(selectedIds);
  const shouldSelect = typeof checked === 'boolean' ? checked : !set.has(rowId);
  if (shouldSelect) set.add(rowId);
  else set.delete(rowId);
  return [...set];
};

export const toggleAllIds = (selectedIds = [], rows = [], checked) => {
  const set = new Set(selectedIds);
  const rowIds = (Array.isArray(rows) ? rows : []).map((item) => item.id).filter(Boolean);
  const shouldSelect = typeof checked === 'boolean' ? checked : rowIds.some((id) => !set.has(id));

  if (shouldSelect) rowIds.forEach((id) => set.add(id));
  else rowIds.forEach((id) => set.delete(id));

  return [...set];
};
