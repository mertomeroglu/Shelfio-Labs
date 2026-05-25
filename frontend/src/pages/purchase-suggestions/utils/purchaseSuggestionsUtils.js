const RISK_BY_DAYS = {
  critical: 3,
  high: 7,
};

export const LOOKBACK_DAYS = 30;

export const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getAverageDailySales = (row = {}) => {
  const fromDailyDemand = toSafeNumber(row.avgDailyDemand, NaN);
  if (Number.isFinite(fromDailyDemand) && fromDailyDemand >= 0) return fromDailyDemand;
  const fromDailySales = toSafeNumber(row.avgDailySales, NaN);
  if (Number.isFinite(fromDailySales) && fromDailySales >= 0) return fromDailySales;
  const recentSales = toSafeNumber(row.recentSalesQty, NaN);
  const lookback = Math.max(1, toSafeNumber(row.lookbackDays, LOOKBACK_DAYS));
  if (Number.isFinite(recentSales) && recentSales >= 0) {
    return Number((recentSales / lookback).toFixed(2));
  }
  return 0;
};

export const getLeadTimeDays = (row = {}) => {
  const lead = toSafeNumber(row.leadTimeDays, NaN);
  if (Number.isFinite(lead) && lead >= 0) return lead;
  return 0;
};

export const getCurrentStock = (row = {}) => {
  const current = toSafeNumber(row.currentStock, NaN);
  if (Number.isFinite(current)) return current;
  const total = toSafeNumber(row.totalStock, NaN);
  if (Number.isFinite(total)) return total;
  return 0;
};

export const getRecentSales7 = (row = {}) => {
  const direct = toSafeNumber(row.sold7, NaN);
  if (Number.isFinite(direct) && direct >= 0) return direct;

  const explicit = toSafeNumber(row.recentSales7, NaN);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;

  const avgDailySales = getAverageDailySales(row);
  return Number((Math.max(0, avgDailySales) * 7).toFixed(1));
};

export const getPackSize = (row = {}) => {
  const palletSize = toSafeNumber(row.unitsPerPallet, 0);
  if (String(row.roundingUnit || '').toLowerCase() === 'palet' && palletSize > 0) return palletSize;

  const caseSize = toSafeNumber(row.unitsPerCase, 0);
  if (caseSize > 0) return caseSize;
  return 0;
};

export const getStockoutProjection = (row = {}, nowDate = new Date()) => {
  const avgDailySales = getAverageDailySales(row);
  const recentSales7 = getRecentSales7(row);
  const currentStock = getCurrentStock(row);
  const leadTimeDays = getLeadTimeDays(row);
  const minStock = Math.max(
    toSafeNumber(row.safetyStock, 0),
    toSafeNumber(row.minStock, 0),
    toSafeNumber(row.criticalStock, 0),
  );
  const packSize = getPackSize(row);
  const minimumOrderQty = Math.max(
    toSafeNumber(row.minimumOrderQty, 0),
    toSafeNumber(row.minOrderQty, 0),
    toSafeNumber(row.moq, 0),
  );
  const safetyDays = Math.min(5, Math.max(0.75, toSafeNumber(row.safetyDays, leadTimeDays > 0 ? leadTimeDays * 0.35 : 1.25)));
  const safetyBufferUnits = Math.max(minStock, Math.ceil(avgDailySales * safetyDays));
  const packPenaltyUnits = Math.ceil(Math.max(packSize, minimumOrderQty) * 0.2);
  const effectiveStock = Math.max(0, currentStock - safetyBufferUnits - packPenaltyUnits);

  if (avgDailySales <= 0 || recentSales7 <= 0) {
    return {
      avgDailySales,
      recentSales7,
      currentStock,
      leadTimeDays,
      safetyDays,
      safetyBufferUnits,
      packPenaltyUnits,
      effectiveStock,
      daysToStockout: Number.POSITIVE_INFINITY,
      estimatedStockoutDate: recentSales7 <= 0 ? 'Düşük hareket / veri yetersiz' : 'Tahmin edilemiyor',
      estimatedStockoutDateIso: '',
      status: recentSales7 <= 0 ? 'insufficient-data' : 'unknown',
    };
  }

  const daysToStockout = Number((effectiveStock / avgDailySales).toFixed(1));
  const date = new Date(nowDate);
  date.setDate(date.getDate() + Math.max(0, Math.ceil(daysToStockout)));

  return {
    avgDailySales,
    recentSales7,
    currentStock,
    leadTimeDays,
    safetyDays,
    safetyBufferUnits,
    packPenaltyUnits,
    effectiveStock,
    daysToStockout,
    estimatedStockoutDate: date.toLocaleDateString('tr-TR'),
    estimatedStockoutDateIso: date.toISOString().slice(0, 10),
    status: daysToStockout <= 0 ? 'critical' : 'calculated',
  };
};

export const estimateDaysToStockout = (row = {}) => {
  const explicit = toSafeNumber(row.daysToStockout, NaN);
  const projection = getStockoutProjection(row);
  if (Number.isFinite(explicit) && Number.isFinite(projection.daysToStockout)) {
    const blended = Math.min(explicit, projection.daysToStockout);
    return Number(blended.toFixed(1));
  }
  if (Number.isFinite(explicit)) return explicit;
  return projection.daysToStockout;
};

export const estimateStockoutDate = (row = {}, nowDate = new Date()) => {
  const projection = getStockoutProjection(row, nowDate);
  if (projection.estimatedStockoutDate) return projection.estimatedStockoutDate;

  const rawDate = row.estimatedStockoutDate || row.stockoutDate || '';
  if (rawDate) return String(rawDate);
  return 'Tahmin edilemiyor';
};

export const classifyStockoutRisk = (daysToStockout) => {
  const safeDays = toSafeNumber(daysToStockout, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(safeDays)) return 'low';
  if (safeDays <= 0) return 'critical';
  if (safeDays <= RISK_BY_DAYS.critical) return 'critical';
  if (safeDays <= RISK_BY_DAYS.high) return 'high';
  if (safeDays <= 14) return 'medium';
  return 'low';
};

export const getConfidenceScore = (row = {}) => {
  const explicit = toSafeNumber(row.confidenceScore, NaN);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)));

  const avgDailySales = getAverageDailySales(row);
  const leadTime = getLeadTimeDays(row);
  const reasonPenalty = Array.isArray(row.reasonTags) ? Math.min(18, row.reasonTags.length * 4) : 0;

  let score = 82;
  if (avgDailySales <= 0) score -= 28;
  if (avgDailySales > 20) score -= 8;
  if (leadTime <= 0) score -= 16;
  if (leadTime > 30) score -= 12;
  score -= reasonPenalty;

  return Math.max(10, Math.min(95, Math.round(score)));
};

export const formatConfidenceScore = (row = {}) => {
  const score = getConfidenceScore(row);
  return `${score}%`;
};

export const resolveTrendDirection = (row = {}) => {
  if (row.trendDirection) return String(row.trendDirection);
  const avg = getAverageDailySales(row);
  const prev = toSafeNumber(row.previousAvgDailySales, NaN);
  if (!Number.isFinite(prev) || prev <= 0) return 'flat';
  const ratio = avg / prev;
  if (ratio >= 1.12) return 'up';
  if (ratio <= 0.88) return 'down';
  return 'flat';
};

export const buildSuggestionQuantity = (row = {}) => {
  const avgDailySales = getAverageDailySales(row);
  const leadTime = getLeadTimeDays(row);
  const safetyStock = toSafeNumber(row.safetyStock, toSafeNumber(row.minStock, 0));
  const currentStock = getCurrentStock(row);
  const qty = (avgDailySales * leadTime) + safetyStock - currentStock;
  return Math.max(0, Math.ceil(qty));
};

export const formatFormulaSummary = (row = {}) => {
  const avgDailySales = Number(getAverageDailySales(row).toFixed(2));
  const leadTime = getLeadTimeDays(row);
  const safetyStock = toSafeNumber(row.safetyStock, toSafeNumber(row.minStock, 0));
  const currentStock = getCurrentStock(row);
  const suggested = buildSuggestionQuantity(row);

  return {
    avgDailySales,
    leadTime,
    safetyStock,
    currentStock,
    suggested,
    text: `(${avgDailySales} x ${leadTime}) + ${safetyStock} - ${currentStock} = ${suggested}`,
  };
};

export const buildRecommendationExplanation = (row = {}, nowDate = new Date()) => {
  const trend = resolveTrendDirection(row);
  const projection = getStockoutProjection(row, nowDate);
  const daysToStockout = estimateDaysToStockout(row);
  const estimatedStockoutDate = projection.estimatedStockoutDate || estimateStockoutDate(row, nowDate);
  const formula = formatFormulaSummary(row);
  const confidenceScore = getConfidenceScore(row);
  const currentStock = getCurrentStock(row);
  const recentSales7 = getRecentSales7(row);
  const leadTimeDays = getLeadTimeDays(row);

  const riskDrivers = [];
  if (Number.isFinite(daysToStockout) && daysToStockout <= 3) riskDrivers.push('Stok tükenmeye çok yakın.');
  if (recentSales7 >= 28 || getAverageDailySales(row) >= 4) riskDrivers.push('Son günlerde satış hızı yüksek.');
  if (getAverageDailySales(row) > 0 && getAverageDailySales(row) <= 1.2) riskDrivers.push('Satış hızı düşük, stok devir riski var.');
  if (leadTimeDays >= 7) riskDrivers.push('Tedarik süresi uzun olduğu için öneri güçlendirildi.');
  if (confidenceScore < 55) riskDrivers.push('Veri güven skoru düşük, öneri dikkatle incelenmeli.');
  if (projection.status === 'insufficient-data') riskDrivers.push('Düşük hareket / veri yetersiz.');
  if (trend === 'up' && !riskDrivers.includes('Son günlerde satış hızı yüksek.')) riskDrivers.push('Talep eğilimi yukarı yönlü.');

  const bulletPoints = [...new Set(riskDrivers)].slice(0, 4);
  const summaryParts = [];
  if (Number.isFinite(daysToStockout)) {
    summaryParts.push(daysToStockout <= 0 ? 'Güvenli stok tamponu tükenmiş durumda.' : `${daysToStockout} gün içinde stok baskısı bekleniyor.`);
  } else if (projection.status === 'insufficient-data') {
    summaryParts.push('Satış hareketi zayıf olduğu için stok bitiş tarihi kesin hesaplanamıyor.');
  }
  if (leadTimeDays > 0) summaryParts.push(`${leadTimeDays} günlük temin süresi planı sıkıştırıyor.`);
  if (recentSales7 > 0) summaryParts.push(`Son 7 günde ${recentSales7} adet satış sinyali görüldü.`);

  const title = Number.isFinite(daysToStockout) && daysToStockout <= 3
    ? 'Acil sipariş sinyali'
    : leadTimeDays >= 7
      ? 'Temin baskısı yüksek'
      : confidenceScore < 55
        ? 'Dikkatli değerlendirme gerekli'
        : 'Öneri özeti';

  return {
    title,
    trend,
    daysToStockout,
    estimatedStockoutDate,
    formula,
    summary: summaryParts.join(' '),
    riskDrivers: bulletPoints,
    confidenceScore,
    recentSales7,
    currentStock,
    leadTimeDays,
    avgDailySales: projection.avgDailySales,
    projection,
  };
};

const hasPositiveMinStock = (product = {}) => {
  const minStock = toSafeNumber(product.minStock, NaN);
  const criticalStock = toSafeNumber(product.criticalStock, NaN);
  return (Number.isFinite(minStock) && minStock > 0) || (Number.isFinite(criticalStock) && criticalStock > 0);
};

const hasSalesInLookback = (product = {}, lookbackDays = LOOKBACK_DAYS) => {
  const avgDailySales = toSafeNumber(product.avgDailySales, NaN);
  if (Number.isFinite(avgDailySales) && avgDailySales > 0) return true;

  const recentSales = toSafeNumber(product.recentSalesQty, NaN);
  if (Number.isFinite(recentSales)) return recentSales > 0;

  const lastSaleAt = product.lastSaleAt || product.lastSoldAt;
  if (!lastSaleAt) return false;
  const diff = Date.now() - new Date(lastSaleAt).getTime();
  if (!Number.isFinite(diff)) return false;
  return diff <= lookbackDays * 24 * 60 * 60 * 1000;
};

const hasSufficientStock = (product = {}) => {
  const stock = getCurrentStock(product);
  const minStock = Math.max(toSafeNumber(product.minStock, 0), toSafeNumber(product.criticalStock, 0));
  const avgDailySales = toSafeNumber(product.avgDailySales, 0);
  const dynamicTarget = minStock + (avgDailySales * 7);
  return stock > Math.max(minStock, dynamicTarget);
};

export const buildEmptyStateBreakdown = ({
  rows = [],
  products = [],
  supplierProducts = [],
  lookbackDays = LOOKBACK_DAYS,
} = {}) => {
  const safeProducts = Array.isArray(products) ? products : [];
  const safeRows = Array.isArray(rows) ? rows : [];
  const supplierByProduct = new Map();
  (Array.isArray(supplierProducts) ? supplierProducts : []).forEach((item) => {
    const productId = String(item.productId || item.id || '');
    if (!productId) return;
    const existing = supplierByProduct.get(productId) || [];
    existing.push(item);
    supplierByProduct.set(productId, existing);
  });

  const missingMinStock = safeProducts.filter((product) => !hasPositiveMinStock(product)).length;
  const missingLeadTime = safeProducts.filter((product) => {
    const key = String(product.id || product.productId || '');
    const suppliers = supplierByProduct.get(key) || [];
    if (!suppliers.length) return true;
    return !suppliers.some((item) => toSafeNumber(item.leadTimeDays, 0) > 0);
  }).length;
  const noRecentSales = safeProducts.filter((product) => !hasSalesInLookback(product, lookbackDays)).length;
  const sufficientStock = safeProducts.filter((product) => hasSufficientStock(product)).length;

  return {
    totalProducts: safeProducts.length,
    totalRecommendations: safeRows.length,
    missingMinStock,
    missingLeadTime,
    noRecentSales,
    sufficientStock,
    lookbackDays,
  };
};

export const PRESET_FILTERS = {
  critical3: 'critical3',
  risk7: 'risk7',
  fastSelling: 'fastSelling',
  slowOrOverstock: 'slowOrOverstock',
  criticalNeed: 'critical_need',
  noInbound: 'no_inbound',
  missingData: 'missing_data',
  longLeadTime: 'long_lead_time',
  highRisk: 'high_risk',
  fastStockout: 'fast_stockout',
};

export const applyPresetToFilters = (currentFilters = {}, preset) => {
  const base = { ...currentFilters };
  switch (preset) {
    case PRESET_FILTERS.critical3:
      return { ...base, riskLevel: 'critical', preset: 'fast_stockout' };
    case PRESET_FILTERS.risk7:
      return { ...base, riskLevel: base.riskLevel || 'high', preset: 'high_risk' };
    case PRESET_FILTERS.fastSelling:
    case PRESET_FILTERS.slowOrOverstock:
      return { ...base, preset: '' };
    case PRESET_FILTERS.criticalNeed:
      return { ...base, preset };
    case PRESET_FILTERS.noInbound:
      return { ...base, preset };
    case PRESET_FILTERS.missingData:
      return { ...base, preset };
    case PRESET_FILTERS.longLeadTime:
      return { ...base, preset };
    case PRESET_FILTERS.highRisk:
      return { ...base, preset, riskLevel: base.riskLevel || 'high' };
    case PRESET_FILTERS.fastStockout:
      return { ...base, preset };
    default:
      return { ...base, preset: '' };
  }
};

export const rowMatchesPreset = (row = {}, preset) => {
  const days = estimateDaysToStockout(row);
  const avg = getAverageDailySales(row);
  const stock = getCurrentStock(row);

  switch (preset) {
    case PRESET_FILTERS.critical3:
      return Number.isFinite(days) && days <= 3;
    case PRESET_FILTERS.risk7:
      return Number.isFinite(days) && days <= 7;
    case PRESET_FILTERS.fastSelling:
      return avg >= 8;
    case PRESET_FILTERS.slowOrOverstock:
      return avg <= 1 && stock >= Math.max(10, avg * 21);
    default:
      return true;
  }
};

export const groupRecommendationsBySupplier = (rows = []) => {
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const supplierId = String(row.supplierId || row.supplierCode || row.supplierName || 'unknown');
    const supplierName = String(row.supplierName || 'Tedarikçi Tanımsız');
    const current = groups.get(supplierId) || { supplierId, supplierName, rows: [] };
    current.rows.push(row);
    groups.set(supplierId, current);
  });

  return [...groups.values()].sort((left, right) => left.supplierName.localeCompare(right.supplierName, 'tr'));
};

export const toggleSelectedRow = (selectedIds = [], rowId, forceChecked) => {
  const set = new Set(selectedIds);
  const shouldSelect = typeof forceChecked === 'boolean' ? forceChecked : !set.has(rowId);
  if (shouldSelect) set.add(rowId);
  else set.delete(rowId);
  return [...set];
};

export const toggleAllSelectedRows = (selectedIds = [], rows = [], forceChecked) => {
  const rowIds = (Array.isArray(rows) ? rows : []).map((item) => item.id).filter(Boolean);
  const set = new Set(selectedIds);
  const shouldSelectAll = typeof forceChecked === 'boolean' ? forceChecked : rowIds.some((id) => !set.has(id));

  if (shouldSelectAll) {
    rowIds.forEach((id) => set.add(id));
  } else {
    rowIds.forEach((id) => set.delete(id));
  }

  return [...set];
};

export const formatLastUpdated = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return date.toLocaleString('tr-TR');
};

export const shouldAutoGenerateOnLoad = ({ hasTriggered = false, isGenerating = false } = {}) => {
  return !hasTriggered && !isGenerating;
};

