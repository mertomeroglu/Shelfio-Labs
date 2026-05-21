import { pricingAnalysisService } from './analysis/pricingAnalysisService.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const safeArray = (value) => (Array.isArray(value) ? value : []);
const uniq = (rows = []) => [...new Set(rows.map((value) => String(value || '').trim()).filter(Boolean))];

const normalizeCampaignRow = (row = {}) => {
  const currentPrice = toNumber(row.currentPrice ?? row.salePrice, 0);
  const cost = toNumber(row.purchasePrice ?? row.supplierPrice, 0);
  const stockLevel = toNumber(row.totalStock ?? row.stockLevel, 0);
  const salesVelocity = toNumber(row.avgDailySales ?? row.salesVelocity, 0);
  const daysToExpiry = row.daysToExpiry == null ? null : toNumber(row.daysToExpiry, null);
  return {
    id: String(row.productId || row.id || ''),
    productId: String(row.productId || row.id || ''),
    productName: row.productName || row.name || 'Bilinmeyen urun',
    sku: row.sku || '',
    categoryId: row.categoryId || '',
    category: row.categoryName || row.category || '-',
    brand: row.brand || row.supplierName || '-',
    supplierName: row.supplierName || '-',
    stockLevel,
    salesVelocity,
    daysToExpiry,
    expiryDate: row.expiryDate || null,
    expirySource: row.expirySource || 'unknown',
    expiryBatchNo: row.expiryBatchNo || null,
    currentPrice,
    cost,
    currentMarginPercent: currentPrice > 0 ? Number((((currentPrice - cost) / currentPrice) * 100).toFixed(1)) : null,
    suggestedDiscount: toNumber(row.discountSuggestion?.discountRate ?? row.suggestedDiscount, 0),
    riskScore: toNumber(row.riskScore, 0),
    riskLevel: row.riskLevel || 'medium',
    riskFactors: safeArray(row.riskFactors),
    daysToStockout: row.daysToStockout ?? null,
    estimatedStockoutDate: row.estimatedStockoutDate || null,
    orderSuggestion: row.orderSuggestion || null,
    salesDataMessage: salesVelocity > 0 ? '' : 'Tahmin için yeterli satış verisi yok.',
  };
};

const summarizeRows = (rows = []) => ({
  productIds: uniq(rows.map((row) => row.productId)),
  categoryNames: uniq(rows.map((row) => row.category)),
  brandNames: uniq(rows.map((row) => row.brand)),
  affectedProductCount: rows.length,
  avgDailySales: Number((rows.reduce((sum, row) => sum + toNumber(row.salesVelocity, 0), 0) / Math.max(1, rows.length)).toFixed(2)),
  avgStockLevel: Number((rows.reduce((sum, row) => sum + toNumber(row.stockLevel, 0), 0) / Math.max(1, rows.length)).toFixed(2)),
  avgMarginPercent: Number((rows.reduce((sum, row) => sum + toNumber(row.currentMarginPercent, 0), 0) / Math.max(1, rows.length)).toFixed(1)),
  minDaysToExpiry: rows
    .map((row) => row.daysToExpiry)
    .filter((value) => value !== null && value !== undefined)
    .reduce((min, value) => (min === null ? value : Math.min(min, value)), null),
});

const buildSuggestion = ({ id, title, reason, rows, recommendedDiscount, type = 'product', priority = 'medium' }) => {
  const summary = summarizeRows(rows);
  return {
    id,
    title,
    reason,
    type,
    priority,
    recommendedDiscount: clamp(Math.round(recommendedDiscount), 0, 80),
    ...summary,
    rows,
    source: 'backend_analysis_engine',
    signalBullets: [
      `Ortalama gunluk satis: ${summary.avgDailySales}.`,
      `Ortalama stok: ${summary.avgStockLevel}.`,
      summary.minDaysToExpiry == null ? 'Gercek SKT sinyali bulunmayan urunler ayrica isaretlendi.' : `En yakin SKT: ${summary.minDaysToExpiry} gun.`,
    ],
    impactSummary: 'Satis hizi, stok, SKT, marj ve risk skoru birlikte degerlendirildi.',
    riskSummary: 'Indirim uygulanmadan once marj ve stok yeterliligi kontrol edilmelidir.',
  };
};

const buildSuggestionsFromRows = (rows = []) => {
  const sourceRows = safeArray(rows).map(normalizeCampaignRow).filter((row) => row.productId);
  const slowRows = sourceRows
    .filter((row) => row.salesVelocity <= 1.2 && row.stockLevel > 0)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 12);
  const expiryRows = sourceRows
    .filter((row) => row.daysToExpiry != null && row.daysToExpiry <= 14 && row.stockLevel > 0)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry || b.riskScore - a.riskScore)
    .slice(0, 12);
  const overstockRows = sourceRows
    .filter((row) => row.stockLevel >= Math.max(20, row.salesVelocity * 21))
    .sort((a, b) => b.stockLevel - a.stockLevel)
    .slice(0, 12);
  const lowMarginRows = sourceRows
    .filter((row) => row.currentMarginPercent != null && row.currentMarginPercent < 12 && row.stockLevel > 0)
    .sort((a, b) => a.currentMarginPercent - b.currentMarginPercent)
    .slice(0, 8);

  return [
    slowRows.length && buildSuggestion({
      id: 'slow-moving',
      title: `${slowRows.length} yavas satan urun icin indirim kampanyasi`,
      reason: 'Satis hizi dusuk ve stok bekleme riski yuksek urunler secildi.',
      rows: slowRows,
      recommendedDiscount: 16,
      priority: slowRows.some((row) => row.riskLevel === 'critical' || row.riskLevel === 'high') ? 'high' : 'medium',
    }),
    expiryRows.length && buildSuggestion({
      id: 'near-expiry',
      title: `${expiryRows.length} urunde SKT odakli hizli kampanya`,
      reason: 'Gercek batch SKT bilgisine gore SKT baskisi olan urunler onceliklendirildi.',
      rows: expiryRows,
      recommendedDiscount: expiryRows.some((row) => row.daysToExpiry <= 3) ? 25 : 18,
      priority: expiryRows.some((row) => row.daysToExpiry <= 3) ? 'critical' : 'high',
    }),
    overstockRows.length && buildSuggestion({
      id: 'overstock',
      title: `${overstockRows.length} urun icin stok eritme kampanyasi`,
      reason: 'Stok seviyesi mevcut satis hizina gore yuksek.',
      rows: overstockRows,
      recommendedDiscount: 14,
      type: 'category',
      priority: 'medium',
    }),
    lowMarginRows.length && buildSuggestion({
      id: 'margin-watch',
      title: `${lowMarginRows.length} dusuk marjli urunde kontrollu aksiyon`,
      reason: 'Marj riski dusuk indirim veya fiyat koruma gerektiriyor.',
      rows: lowMarginRows,
      recommendedDiscount: 6,
      priority: 'medium',
    }),
  ].filter(Boolean);
};

export const calculateCampaignImpact = ({
  rows = [],
  discountRate = 0,
  durationDays = 7,
  scopeLabel = 'Kampanya',
  currency = 'TRY',
  scopeProductCount = null,
  eligibleProductCount = null,
  affectedProductCount = null,
} = {}) => {
  const scopedRows = safeArray(rows).map(normalizeCampaignRow).filter((row) => row.productId);
  const resolvedScopeProductCount = Math.max(
    toNumber(scopeProductCount, 0),
    toNumber(eligibleProductCount, 0),
    toNumber(affectedProductCount, 0),
    scopedRows.length,
  );
  if (!scopedRows.length) {
    return {
      isEmpty: true,
      scopeLabel,
      currency,
      productCount: resolvedScopeProductCount,
      eligibleProductCount: resolvedScopeProductCount,
      affectedProductCount: resolvedScopeProductCount,
      analysisCandidateCount: 0,
      previewProductCount: 0,
      recommendation: 'Simulasyon icin backend analiz verisi bulunamadi.',
      riskLevel: 'Bilgi yok',
      salesIncreasePct: 0,
      revenueChange: 0,
      marginImpact: 0,
      stockDepletionDays: 0,
      stockTurnEffect: 0,
      riskReductionScore: 0,
      modelName: 'analiz_oneri_motoru',
    };
  }

  const safeDiscount = clamp(toNumber(discountRate, 0), 0, 80);
  const safeDuration = Math.max(1, toNumber(durationDays, 7));
  let baseRevenue = 0;
  let campaignRevenue = 0;
  let baseProfit = 0;
  let campaignProfit = 0;
  let baseUnits = 0;
  let campaignUnits = 0;
  let totalStock = 0;
  let totalDailySales = 0;
  let riskScore = 0;

  scopedRows.forEach((row) => {
    const price = Math.max(0, toNumber(row.currentPrice, 0));
    const cost = Math.max(0, toNumber(row.cost, 0));
    const stock = Math.max(0, toNumber(row.stockLevel, 0));
    const dailySales = Math.max(0, toNumber(row.salesVelocity, 0));
    const expiryPressure = row.daysToExpiry == null ? 0 : clamp((14 - row.daysToExpiry) / 14, 0, 1);
    const slowBoost = dailySales <= 0.4 ? 1.35 : dailySales <= 1.2 ? 1.15 : 1;
    const estimatedBoost = clamp((safeDiscount / 100) * (0.85 + (safeDiscount / 100) * 0.9) * slowBoost * (1 + expiryPressure * 0.55), 0, 1.2);
    const projectedDailySales = dailySales * (1 + estimatedBoost);
    const projectedUnits = Math.min(stock, projectedDailySales * safeDuration);
    const baselineUnits = Math.min(stock, dailySales * safeDuration);
    const campaignPrice = price * (1 - safeDiscount / 100);

    baseUnits += baselineUnits;
    campaignUnits += projectedUnits;
    baseRevenue += baselineUnits * price;
    campaignRevenue += projectedUnits * campaignPrice;
    baseProfit += baselineUnits * Math.max(price - cost, 0);
    campaignProfit += projectedUnits * (campaignPrice - cost);
    totalStock += stock;
    totalDailySales += dailySales;
    if (campaignPrice <= cost) riskScore += 24;
    if (stock <= Math.max(3, dailySales * 5)) riskScore += 8;
    if (expiryPressure > 0.5) riskScore += 8;
  });

  const salesIncreasePct = baseUnits > 0 ? Number((((campaignUnits - baseUnits) / baseUnits) * 100).toFixed(1)) : 0;
  const revenueChange = Number((campaignRevenue - baseRevenue).toFixed(2));
  const marginImpact = baseProfit > 0 ? Number((((campaignProfit - baseProfit) / baseProfit) * 100).toFixed(1)) : 0;
  const stockDepletionDays = totalDailySales > 0 ? Number((totalStock / Math.max(totalDailySales, campaignUnits / safeDuration)).toFixed(1)) : 0;
  const stockTurnEffect = totalStock > 0 ? Number((clamp((campaignUnits - baseUnits) / totalStock, 0, 1) * 100).toFixed(1)) : 0;
  const riskReductionScore = Number(clamp(stockTurnEffect + Math.max(0, salesIncreasePct * 0.25), 0, 100).toFixed(1));
  const avgRisk = riskScore / Math.max(1, scopedRows.length);
  const riskLevel = avgRisk >= 24 ? 'Kritik' : avgRisk >= 14 ? 'Yüksek' : avgRisk >= 7 ? 'Orta' : 'Düşük';

  return {
    isEmpty: false,
    scopeLabel,
    currency,
    productCount: resolvedScopeProductCount,
    eligibleProductCount: resolvedScopeProductCount,
    affectedProductCount: resolvedScopeProductCount,
    analysisCandidateCount: scopedRows.length,
    previewProductCount: scopedRows.length,
    salesIncreasePct,
    revenueChange,
    marginImpact,
    stockDepletionDays,
    stockTurnEffect,
    riskReductionScore,
    riskLevel,
    modelName: 'analiz_oneri_motoru',
    recommendation: riskLevel === 'Kritik'
      ? 'Indirim marj veya stok riskini artiriyor; kapsam daraltilmali.'
      : 'Analiz motoru indirim etkisini stok, satis hizi, SKT ve marj sinyallerine gore hesaplandi.',
    metricsSummary: resolvedScopeProductCount > scopedRows.length
      ? `${resolvedScopeProductCount} urun kapsami - ${scopedRows.length} analiz adayi`
      : `${scopedRows.length} urun - backend analiz verisi`,
  };
};

export const campaignAnalysisService = {
  async getSuggestions(query = {}) {
    const analysis = await pricingAnalysisService.getAnalysis({ ...query, limit: undefined });
    const responseLimit = Math.min(1000, Math.max(50, toNumber(query.limit, 500)));
    const normalizedRows = safeArray(analysis.rows).map(normalizeCampaignRow);
    const eligibleProductCount = toNumber(analysis?.summary?.totalAnalyzedProducts, normalizedRows.length);
    const rows = normalizedRows
      .sort((left, right) => toNumber(right.riskScore, 0) - toNumber(left.riskScore, 0))
      .slice(0, responseLimit);
    return {
      generatedAt: new Date().toISOString(),
      source: 'backend_analysis_engine',
      eligibleProductCount,
      analysisCandidateCount: rows.length,
      analysisLimit: responseLimit,
      rows,
      suggestions: buildSuggestionsFromRows(analysis.rows),
    };
  },

  async simulate(payload = {}) {
    return calculateCampaignImpact(payload);
  },
};
