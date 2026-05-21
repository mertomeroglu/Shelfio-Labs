import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, BadgePercent, BarChart3, Boxes, Calculator, CheckCircle2, Clock3, Filter, Layers, RefreshCw, Search, ShieldCheck, ShieldAlert, Sparkles, TrendingUp, X } from 'lucide-react';
import { ResponsiveContainer, BarChart as RBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip } from 'recharts';
import PageHeader from '../../components/PageHeader';
import FilterBar from '../../components/FilterBar';
import StatusBadge from '../../components/StatusBadge';
import Toast from '../../components/Toast';
import { formatStorageTypeLabel, normalizeTurkishText } from '../../services/formatters.js';
import { pricingAnalysisService } from '../../services/pricingAnalysisService';
import { categoryService } from '../../services/categoryService';
import { getProductDisplayPrice, productService } from '../../services/productService';
import { getReadableCategoryLabelName } from '../../utils/categoryLabelDisplay.js';
import { formatDaysLabel,
  formatPercent,
  riskToneMap,
  toRiskLabel,
  toSktLabel,
} from '../../utils/pricingAnalysisHelpers';
import {
  PRICE_PRESETS,
  applyPricePreset,
  buildReasonSummary,
  calculateMarginPercent,
  classifyActionType,
  classifyExpirationRisk,
  estimateImpact,
  mapEmptyStateReason,
  normalizePrice,
  rowMatchesPricePreset,
  toSafeNumber,
  toggleAllIds,
  toggleSelectedIds,
} from './utils/pricingRecommendationsUtils';
import { isCatalogUnlistedProduct } from '../../utils/productListing.js';

const currency = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

const FILTER_DEFAULTS = {
  risk: '',
  sktStatus: '',
  salesSpeed: '',
  hasSuggestion: '',
};

const PRESET_OPTIONS = [
  { id: PRICE_PRESETS.nearExpiry, label: 'SKT Yaklaşanlar', ariaLabel: 'SKT Yaklasanlar' },
  { id: PRICE_PRESETS.slowSelling, label: 'Yavaş Satış', ariaLabel: 'Yavas Satis' },
  { id: PRICE_PRESETS.overstocked, label: 'Aşırı Stok', ariaLabel: 'Asiri Stok' },
  { id: PRICE_PRESETS.highMargin, label: 'Yüksek Marj Potansiyeli', ariaLabel: 'Yuksek Marj Potansiyeli' },
];

const BULK_ACTIONS = {
  APPLY_DISCOUNT: 'apply-discount',
  ADD_CAMPAIGN: 'add-campaign',
  KEEP_PRICE: 'keep-price',
};

const BULK_SCOPE_OPTIONS = [
  { value: 'category', label: 'Kategori Bazlı' },
  { value: 'products', label: 'Ürün Bazlı' },
  { value: 'priceRange', label: 'Fiyat Aralığı' },
];

const BULK_OPERATION_OPTIONS = [
  { value: 'increase', label: 'Zam yap' },
  { value: 'decrease', label: 'İndirim yap' },
  { value: 'fixed', label: 'Fiyatı sabit değere çek' },
];

const BULK_ROUNDING_OPTIONS = [
  { value: 'none', label: 'Küsuratı koru' },
  { value: 'x99', label: 'x,99 ile bitir' },
  { value: 'integer', label: 'En yakın tam sayıya yuvarla' },
  { value: 'half', label: 'En yakın 0,50’ye yuvarla' },
];

const getProductPrice = (product) => normalizePrice(getProductDisplayPrice(product));
const getProductName = (product) => product?.productName || product?.name || 'Ürün';
const getProductCategoryName = (product) => product?.categoryName || product?.category?.name || '-';
const normalizeTextKey = (value) => String(value || '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
const toAsciiLabel = (value) => String(value || '')
  .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
  .replace(/ü/g, 'u').replace(/Ü/g, 'U')
  .replace(/ş/g, 's').replace(/Ş/g, 'S')
  .replace(/ı/g, 'i').replace(/İ/g, 'I')
  .replace(/ö/g, 'o').replace(/Ö/g, 'O')
  .replace(/ç/g, 'c').replace(/Ç/g, 'C');
const splitTagList = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
};

const buildLabelLookup = (labels = []) => {
  const map = new Map();
  labels.forEach((item) => {
    const labelName = String(item.labelName || item.name || '').trim();
    if (!labelName) return;
    [item.labelId, item.id, item.tagId, labelName].forEach((key) => {
      const normalizedKey = String(key || '').trim();
      if (normalizedKey) map.set(normalizedKey, item);
    });
  });
  return map;
};

const getProductTags = (product, labelLookup = new Map()) => {
  const tags = [
    ...splitTagList(product?.etiket),
    ...splitTagList(product?.etiketler),
    ...splitTagList(product?.tags),
    ...splitTagList(product?.labels),
    ...splitTagList(product?.labelName),
    ...splitTagList(product?.tagName),
    ...splitTagList(product?.subCategoryName),
  ];
  [product?.labelId, product?.tagId, product?.selectedTagId].forEach((key) => {
    const matched = labelLookup.get(String(key || '').trim());
    if (matched?.labelName) tags.push(matched.labelName);
  });
  const resolvedTags = tags.map((tag) => {
    const matched = labelLookup.get(String(tag || '').trim());
    return matched?.labelName || tag;
  });
  const seen = new Set();
  return resolvedTags.filter((tag) => {
    const key = normalizeTextKey(tag);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const formatTechnicalSourceLabel = (value, fallback = '-') => {
  const normalized = normalizeTextKey(value).replace(/\./g, '_').replace(/\s+/g, '_');
  if (!normalized) return fallback;
  const labels = {
    supplier_product_mapping: 'Tedarikçi ürün eşleşmesi',
    product_master_fallback: 'Ürün ana verisi',
    product_or_category_tax_rate: 'Ürün/kategori KDV oranı',
    settings_price_recommendation_policy: 'Fiyat öneri politikası',
    settings_pricerecommendationpolicy: 'Fiyat öneri politikası',
    controlled_default_policy: 'Kontrollü varsayılan politika',
    stock_batches_fefo: 'FEFO stok partileri',
    stock_expiry_summary: 'Stok SKT özeti',
    storage_type_policy: 'Saklama tipi politikası',
    case_band_tariff: 'Koli bazlı tarife',
    case_based_tariff: 'Koli bazlı tarife',
    settings_logisticstariffs: 'Lojistik tarifeler',
    settings_logistics_tariffs: 'Lojistik tarifeler',
    logisticstariffs: 'Lojistik tarifeler',
    defaultpolicy: 'Varsayılan politika',
    default_policy: 'Varsayılan politika',
    sell_price_recommendation: 'Satış fiyatı önerisi',
    bulk_price_update: 'Toplu fiyat güncellemesi',
    update: 'Ürün güncellemesi',
    actual: 'Gerçek kayıt',
    estimated: 'Tahmini değer',
  };
  return labels[normalized] || String(value || fallback).replaceAll('_', ' ');
};

const USER_FACING_TECHNICAL_REPLACEMENTS = [
  [/\bsettings\.logisticsTariffs\b/gi, 'Lojistik tarife'],
  [/\blogisticsTariffs\b/g, 'lojistik tarifeler'],
  [/\bdefaultPolicy\b/g, 'varsayılan politika'],
  [/\bdefault_policy\b/gi, 'varsayılan politika'],
  [/\bambient\b/gi, 'Ortam'],
  [/\bchilled\b/gi, 'Soğuk'],
  [/\bfrozen\b/gi, 'Donuk'],
  [/\bstandard\b/gi, 'Standart'],
];

const formatUserFacingTechnicalText = (value, fallback = '-') => {
  const raw = normalizeTurkishText(value, '').trim();
  if (!raw) return fallback;
  let text = raw;
  USER_FACING_TECHNICAL_REPLACEMENTS.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });
  return text
    .replace(/\s*[•|]\s*/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

const formatCalculationStorageLabel = (value, fallback = '-') => {
  const normalized = normalizeTextKey(value);
  if (!normalized) return fallback;
  if (normalized === 'chilled') return 'Soğuk';
  if (normalized === 'standard') return 'Standart';
  if (normalized === 'frozen') return 'Donuk';
  if (normalized === 'ambient') return 'Ortam';
  const label = formatStorageTypeLabel(value, '');
  return label === 'Donuk / Dondurucu' ? 'Donuk' : label || formatUserFacingTechnicalText(value, fallback);
};

const formatCalculationComponentDetail = (row = {}, calculation = null) => {
  const labelKey = normalizeTextKey(row?.label);
  const sourceLabel = formatTechnicalSourceLabel(row?.source, '');
  const detailText = formatUserFacingTechnicalText(row?.details, '');
  const unitsPerCase = Number(calculation?.costs?.unitsPerCase || calculation?.product?.casePack || 1) || 1;
  const totalUnits = Number(calculation?.product?.currentStock || calculation?.product?.stockLevel || unitsPerCase) || unitsPerCase;
  const caseCount = Math.max(1, Math.ceil(totalUnits / Math.max(1, unitsPerCase)));
  const storageLabel = formatCalculationStorageLabel(calculation?.product?.storageType, '-');

  if (labelKey.includes('lojistik')) {
    const logisticsLabel = sourceLabel || 'Lojistik tarife';
    return `${logisticsLabel} · ${caseCount} koli / ${totalUnits} birim`;
  }
  if (labelKey.includes('operasyon')) {
    return 'Operasyon varsayımı · koli elleçleme dahil';
  }
  if (labelKey.includes('fire') || labelKey.includes('skt') || labelKey.includes('risk')) {
    return 'FEFO stok partileri ve yakın SKT riski dahil';
  }
  if (labelKey.includes('saklama') || sourceLabel === 'Saklama tipi politikası') {
    return storageLabel;
  }
  return detailText ? `${sourceLabel || 'Veri kaynağı'} · ${detailText}` : (sourceLabel || 'Veri kaynağı');
};

const getFirstValue = (source, keys, fallback = undefined) => {
  if (!source || typeof source !== 'object') return fallback;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
};

const hasText = (value) => String(value ?? '').trim().length > 0;

const normalizeRecommendationReasonText = (value) => {
  let text = String(value || '').trim();
  if (!text) return '';

  const replacements = [
    [/\bicin\b/gi, 'için'],
    [/\bgun\b/gi, 'gün'],
    [/\burun\b/gi, 'ürün'],
    [/\bstok donuyor\b/gi, 'stok dönüyor'],
    [/\bfire riskini azaltmak icin\b/gi, 'fire riskini azaltmak için'],
    [/\bsatis\b/gi, 'satış'],
    [/\byaklasiyor\b/gi, 'yaklaşıyor'],
    [/\bguvenli\b/gi, 'güvenli'],
    [/\bdusuk\b/gi, 'düşük'],
  ];

  replacements.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  return text;
};

const getOptionalNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeRiskKey = (value, fallback = 'medium') => {
  const key = normalizeTextKey(value);
  if (!key) return fallback;
  if (['critical', 'kritik', 'urgent', 'acil', 'very high', 'cok yuksek', 'çok yüksek'].includes(key)) return 'critical';
  if (['high', 'yuksek', 'yüksek', 'danger', 'riskli'].includes(key)) return 'high';
  if (['medium', 'orta', 'moderate', 'normal'].includes(key)) return 'medium';
  if (['low', 'dusuk', 'düşük', 'safe', 'guvenli', 'güvenli'].includes(key)) return 'low';
  return fallback;
};

const getRiskLevelFromScore = (score) => {
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
};

const normalizeSktKey = (value, daysToExpiry) => {
  const key = normalizeTextKey(value);
  if (['critical', 'kritik', 'expired', 'gecmis', 'geçmiş', 'acil'].includes(key)) return 'critical';
  if (['soon', 'yaklasiyor', 'yaklaşıyor', 'near', 'warning', 'uyari', 'uyarı'].includes(key)) return 'soon';
  if (['safe', 'guvenli', 'güvenli', 'normal'].includes(key)) return 'safe';
  return classifyExpirationRisk(daysToExpiry);
};

const normalizeActionKey = (value, fallback) => {
  const key = normalizeTextKey(value);
  if (['urgent', 'acil', 'critical', 'kritik', 'acil indirim'].includes(key)) return 'urgent';
  if (['discount', 'indirim', 'markdown', 'price decrease', 'fiyat dusur', 'fiyat düşür'].includes(key)) return 'discount';
  if (['keep', 'koru', 'fiyat koruma', 'protect', 'no change'].includes(key)) return 'keep';
  if (['increase', 'zam', 'price increase', 'fiyat artir', 'fiyat artır'].includes(key)) return 'increase';
  if (['none', 'no action', 'aksiyon yok'].includes(key)) return 'none';
  return fallback;
};

const appendAnalysisRows = (target, rows, sourceSection) => {
  if (!Array.isArray(rows)) return;
  rows.forEach((row) => {
    if (row && typeof row === 'object') {
      target.push({ ...row, sourceSection: row.sourceSection || sourceSection });
    }
  });
};

const collectPricingRows = (analysis) => {
  const rows = [];
  const containers = [analysis, analysis?.data, analysis?.result, analysis?.payload].filter(Boolean);
  const rowKeys = [
    'recommendations',
    'rows',
    'items',
    'products',
    'priceActions',
    'actionList',
    'pricingActions',
    'suggestions',
    'data',
  ];

  containers.forEach((container, containerIndex) => {
    if (Array.isArray(container)) {
      appendAnalysisRows(rows, container, `analysis-${containerIndex}`);
      return;
    }

    const sections = container.sections || container.sectionRows || {};
    Object.entries(sections).forEach(([sectionName, sectionRows]) => {
      appendAnalysisRows(rows, sectionRows, sectionName);
    });

    rowKeys.forEach((key) => {
      appendAnalysisRows(rows, container[key], key);
    });
  });

  return rows;
};

const mapProductToPricingSignal = (product, index) => {
  const id = product?.id || product?.productId || product?.sku || `product-${index}`;
  const currentPrice = normalizePrice(getFirstValue(product, ['currentPrice', 'salePrice', 'price', 'unitPrice', 'referencePrice'], getProductDisplayPrice(product)));
  const cost = normalizePrice(getFirstValue(product, ['cost', 'costPrice', 'purchasePrice', 'buyingPrice', 'supplierPrice'], 0));
  const stockLevel = toSafeNumber(getFirstValue(product, ['currentStock', 'stockLevel', 'stock', 'stockQuantity', 'quantity', 'totalStock', 'onHand'], 0), 0);
  const salesVelocity = toSafeNumber(getFirstValue(product, ['avgDailySales', 'averageDailySales', 'salesVelocity', 'dailySalesRate', 'dailySales'], 0), 0);
  const daysToExpiry = getOptionalNumber(getFirstValue(product, ['daysToExpiry', 'daysUntilExpiry', 'daysUntilExpiration', 'expiryDays', 'sktDays', 'nearestExpiryDays']));
  const baseDiscount = toSafeNumber(getFirstValue(product, ['suggestedDiscountRate', 'suggestedDiscount', 'discountRate', 'discountPercent'], 0), 0);
  const expirationRisk = normalizeSktKey(getFirstValue(product, ['sktStatus', 'expirationRisk', 'expiryRisk']), daysToExpiry);
  const computedActionType = classifyActionType({
    discountPercent: baseDiscount,
    expirationRisk,
    salesVelocity,
    stock: stockLevel,
  });
  const actionType = normalizeActionKey(getFirstValue(product, ['actionType', 'suggestedAction', 'recommendedAction']), computedActionType);
  const riskLevel = normalizeRiskKey(
    getFirstValue(product, ['riskLevel', 'risk', 'riskStatus']),
    actionType === 'urgent' || expirationRisk === 'critical' ? 'high' : 'medium',
  );
  const hasRealSignal = baseDiscount > 0
    || actionType === 'urgent'
    || ['critical', 'high'].includes(riskLevel)
    || ['critical', 'soon'].includes(expirationRisk)
    || (stockLevel > 0 && salesVelocity <= 1)
    || stockLevel >= 40;

  if (!id || currentPrice <= 0 || !hasRealSignal) return null;

  return {
    id,
    productId: product?.productId || id,
    productName: getProductName(product),
    category: getProductCategoryName(product),
    supplierName: product?.supplierName || product?.supplier?.name || '-',
    sku: product?.sku || product?.barcode || '-',
    currentPrice,
    cost,
    suggestedDiscount: Math.max(0, baseDiscount),
    stockLevel,
    salesVelocity,
    stockTurnoverRate: salesVelocity > 0 ? salesVelocity / Math.max(stockLevel, 1) : 0,
    expirationRisk,
    riskLevel,
    actionType,
    daysToExpiry,
    trend: Array.isArray(product?.salesTrendLast14Days) ? product.salesTrendLast14Days : [],
    currentMarginPercent: calculateMarginPercent(currentPrice, cost),
    sourceSection: 'products',
  };
};

const normalizePricingActionRow = (sourceRow, index) => {
  const productInfo = sourceRow?.product || sourceRow?.productInfo || {};
  const merged = { ...productInfo, ...sourceRow };
  if (!merged?.productId && !merged?.id && !merged?.productName && !merged?.name) return null;

  const id = String(merged.productId || merged.id || `${merged.productName || merged.name || 'urun'}-${index}`);
  const currentPrice = normalizePrice(getFirstValue(merged, ['currentPrice', 'salePrice', 'price', 'unitPrice', 'referencePrice', 'productPrice'], 0));
  const cost = normalizePrice(getFirstValue(merged, ['cost', 'costPrice', 'purchasePrice', 'buyingPrice', 'supplierPrice'], 0));
  const stockLevel = toSafeNumber(getFirstValue(merged, ['currentStock', 'stockLevel', 'stock', 'stockQuantity', 'quantity', 'totalStock', 'onHand'], 0), 0);
  const salesVelocity = toSafeNumber(getFirstValue(merged, ['avgDailySales', 'averageDailySales', 'salesVelocity', 'dailySalesRate', 'dailySales'], 0), 0);
  const stockTurnoverRate = toSafeNumber(getFirstValue(merged, ['stockTurnoverRate'], salesVelocity > 0 ? salesVelocity / Math.max(stockLevel, 1) : 0), 0);
  const daysToExpiry = getOptionalNumber(getFirstValue(merged, ['daysToExpiry', 'daysUntilExpiry', 'daysUntilExpiration', 'expiryDays', 'sktDays']));
  const expirationRisk = normalizeSktKey(getFirstValue(merged, ['sktStatus', 'expirationRisk', 'expiryRisk']), daysToExpiry);
  const discountSuggestion = merged.discountSuggestion && typeof merged.discountSuggestion === 'object' ? merged.discountSuggestion : {};
  const rawDiscount = getFirstValue(
    merged,
    ['suggestedDiscountRate', 'suggestedDiscount', 'discountRate', 'discountPercent', 'actionPercent'],
    discountSuggestion.discountRate,
  );
  const suggestedDiscount = clampPercent(rawDiscount);
  const computedActionType = classifyActionType({
    discountPercent: suggestedDiscount,
    expirationRisk,
    salesVelocity,
    stock: stockLevel,
  });
  const normalizedActionType = normalizeActionKey(
    getFirstValue(merged, ['actionType', 'suggestedAction', 'recommendedAction', 'actionSuggestion']),
    computedActionType,
  );
  const currentMarginPercent = calculateMarginPercent(currentPrice, cost);
  const riskScoreFromSource = getOptionalNumber(getFirstValue(merged, ['riskScore', 'score']));
  const riskScore = Number.isFinite(riskScoreFromSource)
    ? Math.max(0, Math.min(100, Math.round(riskScoreFromSource)))
    : buildFallbackRiskScore({ daysToExpiry, stockLevel, salesVelocity, stockTurnoverRate, expirationRisk });
  const riskLevel = normalizeRiskKey(
    getFirstValue(merged, ['riskLevel', 'risk', 'riskStatus']),
    getRiskLevelFromScore(riskScore),
  );
  const action = getActionModel({
    currentPrice,
    actionType: normalizedActionType,
    actionPercent: suggestedDiscount,
    suggestedPrice: getFirstValue(merged, ['suggestedPrice', 'newPrice'], discountSuggestion.newPrice),
  });
  const trendSource = Array.isArray(merged.salesTrendLast14Days)
    ? merged.salesTrendLast14Days
    : Array.isArray(merged.salesTrend)
      ? merged.salesTrend
      : Array.isArray(merged.trend) ? merged.trend : [];
  const trend = trendSource.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const estimatedMarginPercent = calculateMarginPercent(action.suggestedPrice, cost);

  const row = {
    id,
    productId: merged.productId || id,
    productName: hasText(merged.productName || merged.name) ? String(merged.productName || merged.name).trim() : 'Bilinmeyen ürün',
    sku: hasText(merged.sku || merged.barcode) ? String(merged.sku || merged.barcode).trim() : '-',
    supplierName: hasText(merged.supplierName || merged.supplier?.name) ? String(merged.supplierName || merged.supplier?.name).trim() : 'Tedarikçi bilgisi yok',
    categoryName: hasText(merged.categoryName || merged.category || merged.category?.name) ? String(merged.categoryName || merged.category || merged.category?.name).trim() : 'Kategori yok',
    category: hasText(merged.categoryName || merged.category || merged.category?.name) ? String(merged.categoryName || merged.category || merged.category?.name).trim() : 'Kategori yok',
    currentPrice,
    cost,
    suggestedPrice: action.suggestedPrice,
    suggestedDiscount: action.actionPercent,
    simulatedDiscount: action.actionPercent,
    actionType: action.actionType,
    actionLabel: action.actionLabel,
    actionPercent: action.actionPercent,
    actionSimulationText: action.simulationText,
    priceChangePercent: action.priceChangePercent,
    riskLevel,
    riskScore,
    riskLabel: `${toRiskLabel(riskLevel)} • ${riskScore}`,
    stockLevel,
    salesVelocity,
    salesSpeedKey: getSalesSpeedKey(salesVelocity),
    stockTurnoverRate,
    expirationRisk,
    daysToExpiry,
    trend,
    currentMarginPercent,
    estimatedMarginPercent,
    impact: null,
    marginImpact: Number.isFinite(currentMarginPercent) && Number.isFinite(estimatedMarginPercent)
      ? estimatedMarginPercent - currentMarginPercent
      : null,
    salesImpact: null,
    stockImpact: null,
    stockEndEstimate: null,
    recommendationReason: '',
    sourceSection: merged.sourceSection || 'pricing',
    isCatalogUnlisted: isCatalogUnlistedProduct(merged),
  };

  row.recommendationReason = buildRecommendationReason({
    daysToExpiry: row.daysToExpiry,
    expirationRisk: row.expirationRisk,
    stockLevel: row.stockLevel,
    salesVelocity: row.salesVelocity,
    stockTurnoverRate: row.stockTurnoverRate,
    currentMarginPercent: row.currentMarginPercent,
    actionLabel: row.actionLabel,
    riskLevel: row.riskLevel,
  });
  row.reasonSummary = row.recommendationReason;

  validatePricingActionRow(row);
  return row;
};

const applyRoundingRule = (price, rule) => {
  const value = normalizePrice(price);
  if (rule === 'x99') return Math.max(0.01, normalizePrice(Math.floor(value) + 0.99));
  if (rule === 'integer') return Math.max(0.01, normalizePrice(Math.round(value)));
  if (rule === 'half') return Math.max(0.01, normalizePrice(Math.round(value * 2) / 2));
  return Math.max(0.01, value);
};

const SIMPLE_MARGIN_THRESHOLD = 12;

const calculateBulkPrice = ({ currentPrice, operation, adjustmentType, adjustmentValue, roundingRule }) => {
  const base = normalizePrice(currentPrice);
  const value = toSafeNumber(adjustmentValue, 0);
  let next = base;
  if (operation === 'fixed') next = value;
  else if (adjustmentType === 'percent') next = operation === 'increase' ? base * (1 + value / 100) : base * (1 - value / 100);
  else next = operation === 'increase' ? base + value : base - value;
  return applyRoundingRule(next, roundingRule);
};

const getRegularSalePrice = (product) => {
  const candidate = getFirstValue(product, ['salePrice', 'originalPrice', 'regularPrice', 'basePrice', 'price'], getProductDisplayPrice(product));
  return normalizePrice(candidate);
};

const hasCampaignPrice = (product) => Boolean(
  product?.hasActiveDiscount === true
  || product?.activeCampaign
  || product?.campaignPrice
  || product?.discountedPrice
);

const getEffectiveCampaignPrice = (product) => {
  const effective = normalizePrice(getFirstValue(product, ['currentPrice', 'campaignPrice', 'discountedPrice'], 0));
  const regular = getRegularSalePrice(product);
  if (!hasCampaignPrice(product) || effective <= 0 || effective >= regular) return null;
  return effective;
};

const calculateCampaignEffectiveAfterRegularChange = (product, nextRegularPrice) => {
  if (!hasCampaignPrice(product)) return null;
  const campaign = product.activeCampaign || {};
  const regular = normalizePrice(nextRegularPrice);
  if (regular <= 0) return null;

  const mode = normalizeTextKey(campaign.appliedMode || campaign.discountMode || campaign.discountType || campaign.valueType);
  const amount = toSafeNumber(campaign.discountAmount ?? campaign.configuredDiscountAmount, 0);
  const rate = toSafeNumber(campaign.effectiveDiscountRate ?? campaign.discountRate, 0);

  if (amount > 0 && ['amount', 'fixed', 'amount_off', 'currency', 'manual'].includes(mode)) {
    return normalizePrice(Math.max(0.01, regular - amount));
  }
  if (rate > 0) {
    return normalizePrice(Math.max(0.01, regular * (1 - (rate / 100))));
  }

  const currentRegular = getRegularSalePrice(product);
  const currentEffective = getEffectiveCampaignPrice(product);
  if (currentRegular > 0 && currentEffective !== null) {
    return normalizePrice(Math.max(0.01, regular * (currentEffective / currentRegular)));
  }
  return null;
};

const classifyBulkMarginRisk = ({ nextRegularPrice, campaignEffectiveAfter, cost }) => {
  const regularMarginAfter = calculateMarginPercent(nextRegularPrice, cost);
  const campaignMarginAfter = campaignEffectiveAfter !== null ? calculateMarginPercent(campaignEffectiveAfter, cost) : null;
  const regularLoss = cost > 0 && nextRegularPrice > 0 && nextRegularPrice < cost;
  const regularLowMargin = !regularLoss && regularMarginAfter !== null && regularMarginAfter >= 0 && regularMarginAfter < SIMPLE_MARGIN_THRESHOLD;
  const campaignLoss = cost > 0 && campaignEffectiveAfter !== null && campaignEffectiveAfter < cost;
  const campaignLowMargin = !campaignLoss && campaignMarginAfter !== null && campaignMarginAfter >= 0 && campaignMarginAfter < SIMPLE_MARGIN_THRESHOLD;

  let riskReason = 'Regular fiyat marjı sağlıklı';
  if (campaignLoss) riskReason = 'Aktif kampanya fiyatı maliyet altında';
  else if (campaignLowMargin) riskReason = 'Kampanya etkisiyle düşük marj';
  else if (regularLoss) riskReason = 'Yeni regular fiyat maliyet altında';
  else if (regularLowMargin) riskReason = `Yeni regular fiyat %${SIMPLE_MARGIN_THRESHOLD} marj eşiğinin altında`;

  return {
    regularMarginAfter,
    campaignMarginAfter,
    regularLoss,
    regularLowMargin,
    campaignLoss,
    campaignLowMargin,
    hasRegularRisk: regularLoss || regularLowMargin,
    hasCampaignRisk: campaignLoss || campaignLowMargin,
    hasMarginRisk: regularLoss || regularLowMargin || campaignLoss || campaignLowMargin,
    hasNegativeMargin: regularLoss || campaignLoss,
    riskReason,
  };
};

const buildBulkMarginWarningText = (summary) => {
  if (!summary.marginRiskCount) return '';
  if (summary.campaignRiskCount > 0 && summary.regularRiskCount === 0) {
    if (summary.campaignLossCount > 0) {
      return `${summary.campaignRiskCount} üründe aktif kampanya nedeniyle efektif fiyat maliyet altında kalıyor. Regular fiyat güncellemesi ayrı hesaplandı; risk aktif kampanyalı fiyattan kaynaklanıyor.`;
    }
    return `${summary.campaignRiskCount} üründe aktif kampanya nedeniyle efektif fiyat %${SIMPLE_MARGIN_THRESHOLD} marj eşiğinin altında kalıyor. Regular fiyat güncellemesi ayrı hesaplandı.`;
  }
  if (summary.regularRiskCount > 0 && summary.campaignRiskCount > 0) {
    return `${summary.regularRiskCount} üründe regular fiyat, ${summary.campaignRiskCount} üründe aktif kampanya kaynaklı marj riski var.`;
  }
  if (summary.regularLossCount > 0) return `${summary.regularRiskCount} üründe yeni regular fiyat maliyet altında kalıyor.`;
  return `${summary.regularRiskCount} üründe yeni regular fiyat %${SIMPLE_MARGIN_THRESHOLD} marj eşiğinin altında kalıyor.`;
};

const ActionSparkline = ({ values = [] }) => {
  if (!values.length) return <span className="pricing-mini-chart-empty">-</span>;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const spread = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - (((value - min) / spread) * 100);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg className="pricing-mini-chart" viewBox="0 0 100 100" role="img" aria-label="Satış trendi mini grafik">
      <polyline fill="none" strokeWidth="8" stroke="currentColor" points={points} />
    </svg>
  );
};

const formatCurrency = (value) => currency.format(toSafeNumber(value, 0));

const formatSignedCurrency = (value) => {
  const numeric = toSafeNumber(value, NaN);
  if (!Number.isFinite(numeric)) return 'Veri yok';
  const sign = numeric > 0 ? '+' : '';
  return `${sign}${formatCurrency(numeric)}`;
};

const clampPercent = (value, min = 0, max = 80) => Math.min(Math.max(toSafeNumber(value, 0), min), max);

const getSalesSpeedKey = (salesVelocity) => {
  const velocity = toSafeNumber(salesVelocity, NaN);
  if (!Number.isFinite(velocity)) return 'unknown';
  if (velocity <= 1) return 'slow';
  if (velocity >= 4) return 'fast';
  return 'normal';
};

const buildFallbackRiskScore = ({ daysToExpiry, stockLevel, salesVelocity, stockTurnoverRate, expirationRisk }) => {
  let score = 0;
  const days = toSafeNumber(daysToExpiry, NaN);
  const stock = Math.max(0, toSafeNumber(stockLevel, 0));
  const velocity = Math.max(0, toSafeNumber(salesVelocity, 0));
  const turnover = Math.max(0, toSafeNumber(stockTurnoverRate, 0));

  if (expirationRisk === 'critical' || (Number.isFinite(days) && days <= 3)) score += 35;
  else if (expirationRisk === 'soon' || (Number.isFinite(days) && days <= 10)) score += 22;
  if (stock >= 80 && velocity <= 1) score += 22;
  else if (stock >= 40 && velocity <= 2) score += 14;
  if (velocity <= 0.4 && stock > 10) score += 14;
  if (turnover > 0 && turnover < 0.08) score += 10;

  return Math.min(100, Math.round(score));
};

const buildRecommendationReason = ({
  daysToExpiry,
  expirationRisk,
  stockLevel,
  salesVelocity,
  stockTurnoverRate,
  currentMarginPercent,
  actionLabel,
  riskLevel,
}) => {
  const days = toSafeNumber(daysToExpiry, NaN);
  const stock = Math.max(0, toSafeNumber(stockLevel, 0));
  const velocity = Math.max(0, toSafeNumber(salesVelocity, 0));
  const turnover = Math.max(0, toSafeNumber(stockTurnoverRate, 0));
  const margin = toSafeNumber(currentMarginPercent, NaN);

  if (expirationRisk === 'critical' || (Number.isFinite(days) && days <= 3)) {
    return `SKT ${formatDaysLabel(daysToExpiry)} içinde; fire riskini azaltmak için ${actionLabel.toLocaleLowerCase('tr-TR')}.`;
  }
  if (expirationRisk === 'soon' || (Number.isFinite(days) && days <= 10)) {
    return `SKT yaklaşıyor (${formatDaysLabel(daysToExpiry)}); stok devrini hızlandıracak güvenli fiyat aksiyonu önerildi.`;
  }
  if (stock >= 40 && velocity <= 1) {
    return `Stok ${Math.round(stock)} adet ve günlük satış ${velocity.toFixed(1)}; stok eritme için ${actionLabel.toLocaleLowerCase('tr-TR')}.`;
  }
  if (velocity <= 1 || (turnover > 0 && turnover < 0.08)) {
    return `Satış hızı düşük ve devir zayıf; talebi canlandıracak kontrollü aksiyon önerildi.`;
  }
  if (Number.isFinite(margin) && margin < 12) {
    return `Mevcut marj ${formatPercent(margin)}; marjı korumak için agresif indirim yerine temkinli öneri üretildi.`;
  }
  if (velocity >= 4 && ['low', 'medium'].includes(riskLevel)) {
    return 'Talep güçlü ve risk sınırlı; fiyat koruma veya zam yönlü güvenli öneri üretildi.';
  }
  return 'Satış verisi sınırlı olduğu için güvenli öneri üretildi.';
};

const getActionModel = ({ currentPrice, actionType, actionPercent, suggestedPrice }) => {
  const current = normalizePrice(currentPrice);
  const percent = clampPercent(actionPercent);
  const normalizedSuggested = normalizePrice(suggestedPrice);

  if (['urgent', 'discount'].includes(actionType) && percent > 0 && current > 0) {
    const nextPrice = normalizePrice(current * (1 - percent / 100));
    return {
      actionType,
      actionLabel: `%${Math.round(percent)} indirim önerisi`,
      actionPercent: percent,
      suggestedPrice: nextPrice,
      priceChangePercent: -percent,
      simulationText: `${formatCurrency(current)} -> ${formatCurrency(nextPrice)} (${formatPercent(percent)} indirim)`,
    };
  }

  if (actionType === 'increase' && percent > 0 && current > 0) {
    const nextPrice = normalizePrice(current * (1 + percent / 100));
    return {
      actionType,
      actionLabel: 'Zam önerisi',
      actionPercent: percent,
      suggestedPrice: nextPrice,
      priceChangePercent: percent,
      simulationText: `${formatCurrency(current)} -> ${formatCurrency(nextPrice)} (${formatPercent(percent)} zam)`,
    };
  }

  const nextPrice = normalizedSuggested > 0 ? normalizedSuggested : current;
  return {
    actionType: actionType === 'none' ? 'none' : 'keep',
    actionLabel: actionType === 'none' ? 'Aksiyon yok' : 'Fiyat koruma',
    actionPercent: 0,
    suggestedPrice: nextPrice,
    priceChangePercent: 0,
    simulationText: nextPrice > 0 ? `${formatCurrency(nextPrice)} korunur` : 'Fiyat verisi yok',
  };
};

const validatePricingActionRow = (row) => {
  const missing = ['id', 'productName', 'sku', 'supplierName', 'categoryName', 'currentPrice', 'suggestedPrice', 'actionLabel', 'riskLevel', 'recommendationReason']
    .filter((key) => row[key] === undefined || row[key] === null || row[key] === '' || (typeof row[key] === 'number' && !Number.isFinite(row[key])));
  if (missing.length) {
    console.warn('[PricingAnalysis] Fiyat Aksiyon Listesi satırı eksik alanlarla normalize edildi.', {
      id: row.id,
      productName: row.productName,
      missing,
    });
  }
};

const enrichPricingActionRowForTable = (row, simulationDiscounts = {}) => {
  const simulatedDiscount = clampPercent(simulationDiscounts[row.id] ?? row.suggestedDiscount);
  const simulatedAction = getActionModel({
    currentPrice: row.currentPrice,
    actionType: simulatedDiscount > 0 ? (row.actionType === 'urgent' ? 'urgent' : 'discount') : row.actionType,
    actionPercent: simulatedDiscount,
    suggestedPrice: row.suggestedPrice,
  });
  const suggestedPrice = simulatedAction.suggestedPrice;
  const estimatedMarginPercent = calculateMarginPercent(suggestedPrice, row.cost);
  const impact = estimateImpact({
    currentPrice: row.currentPrice,
    cost: row.cost,
    stock: row.stockLevel,
    salesVelocity: row.salesVelocity,
    discountPercent: simulatedDiscount,
  });
  const stockEndEstimate = Number.isFinite(impact.depletionDays) ? impact.depletionDays : null;
  const recommendationReason = buildRecommendationReason({
    daysToExpiry: row.daysToExpiry,
    expirationRisk: row.expirationRisk,
    stockLevel: row.stockLevel,
    salesVelocity: row.salesVelocity,
    stockTurnoverRate: row.stockTurnoverRate,
    currentMarginPercent: row.currentMarginPercent,
    actionLabel: simulatedAction.actionLabel,
    riskLevel: row.riskLevel,
  });

  return {
    ...row,
    simulatedDiscount,
    suggestedPrice,
    actionLabel: simulatedAction.actionLabel,
    actionPercent: simulatedAction.actionPercent,
    actionSimulationText: simulatedAction.simulationText,
    priceChangePercent: simulatedAction.priceChangePercent,
    estimatedMarginPercent,
    impact,
    marginImpact: Number.isFinite(row.currentMarginPercent) && Number.isFinite(estimatedMarginPercent)
      ? estimatedMarginPercent - row.currentMarginPercent
      : null,
    salesImpact: Number.isFinite(impact.estimatedSalesIncreasePct) ? impact.estimatedSalesIncreasePct : null,
    stockImpact: stockEndEstimate,
    stockEndEstimate,
    recommendationReason,
    reasonSummary: recommendationReason || buildReasonSummary({
      daysToExpiry: row.daysToExpiry,
      stock: row.stockLevel,
      salesVelocity: row.salesVelocity,
      stockTurnoverRate: row.stockTurnoverRate,
      suggestedDiscount: simulatedDiscount,
    }),
  };
};

const normalizePricingRowsResponse = (response) => {
  if (Array.isArray(response)) {
    return {
      rows: response,
      pagination: response.meta?.pagination || null,
    };
  }

  const rows = Array.isArray(response?.items) ? response.items
    : Array.isArray(response?.rows) ? response.rows
      : Array.isArray(response?.data) ? response.data
        : [];

  return {
    rows,
    pagination: response?.meta?.pagination || response?.pagination || null,
  };
};

const PricingActionListLoading = () => (
  <div className="pricing-action-loading" role="status" aria-live="polite">
    <RefreshCw size={20} className="pricing-spin" />
    <strong>Fiyat analizi yükleniyor</strong>
    <span>Aksiyon listesi hazırlanıyor...</span>
    <div className="pricing-action-skeleton" aria-hidden="true">
      {[0, 1, 2].map((item) => <i key={item} />)}
    </div>
  </div>
);

const renderChartEmptyState = (title, description) => (
  <div className="analytics-empty-state" role="status">
    <BarChart3 size={18} />
    <strong>{title}</strong>
    <span>{description}</span>
  </div>
);

const PricingChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value ?? 0;
  return (
    <div className="pricing-chart-tooltip">
      <strong>{label}</strong>
      <span>{Number(value).toLocaleString('tr-TR')} ürün</span>
    </div>
  );
};

function BulkPriceUpdateModal({
  isOpen,
  products = [],
  categories = [],
  labels = [],
  onClose,
  onApply,
  isApplying = false,
}) {
  const [scope, setScope] = useState('category');
  const [form, setForm] = useState({
    categoryId: '',
    tag: '',
    productSearch: '',
    selectedProductIds: [],
    minPrice: '',
    maxPrice: '',
    operation: 'increase',
    adjustmentType: 'percent',
    adjustmentValue: '',
    roundingRule: 'none',
    acknowledged: false,
  });
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsProductSearchOpen(false);
    setForm((current) => ({ ...current, acknowledged: false }));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || scope !== 'products') return undefined;
    const handlePointerDown = (event) => {
      if (event.target.closest('.pricing-bulk-product-search-shell')) return;
      setIsProductSearchOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, scope]);

  const labelLookup = useMemo(() => buildLabelLookup(labels), [labels]);

  const normalizedProducts = useMemo(() => (
    products.map((product) => ({
      ...product,
      id: String(product.id || product.productId || ''),
      categoryId: String(product.categoryId || product.productCategoryId || product.category?.id || ''),
      productName: getProductName(product),
      categoryName: getProductCategoryName(product),
      currentRegularPrice: getRegularSalePrice(product),
      currentEffectivePrice: getProductPrice(product),
      campaignEffectivePrice: getEffectiveCampaignPrice(product),
      hasActiveCampaign: hasCampaignPrice(product),
      purchasePrice: normalizePrice(product.purchasePrice || product.cost || 0),
      tags: getProductTags(product, labelLookup),
    })).filter((product) => product.id)
  ), [labelLookup, products]);

  const selectedCategory = useMemo(() => categories.find((item) => String(item.id) === String(form.categoryId)) || null, [categories, form.categoryId]);

  const categoryTags = useMemo(() => {
    if (!selectedCategory) return [];
    const fromLabelMaster = labels
      .filter((item) => String(item.categoryId || '') === String(selectedCategory.id))
      .map((item) => ({
        value: String(item.labelName || item.name || '').trim(),
        label: getReadableCategoryLabelName(item),
        sortOrder: Number(item.sortOrder || 0),
      }))
      .filter((item) => item.value);
    const rows = normalizedProducts.filter((product) => String(product.categoryId || '') === String(selectedCategory.id)
      || normalizeTextKey(product.categoryName) === normalizeTextKey(selectedCategory.name));
    const counts = new Map();
    rows.forEach((product) => {
      product.tags.forEach((tag) => {
        const key = normalizeTextKey(tag);
        if (!key) return;
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
    const fromProducts = [...counts.entries()]
      .filter(([, count]) => count > 0)
      .map(([tag]) => ({ value: tag, label: tag, sortOrder: 0 }));
    const merged = new Map();
    [...fromLabelMaster, ...fromProducts].forEach((item) => {
      const key = normalizeTextKey(item.value);
      if (!key || merged.has(key)) return;
      merged.set(key, item);
    });
    return [...merged.values()]
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.label.localeCompare(b.label, 'tr'));
  }, [labels, normalizedProducts, selectedCategory]);

  const productSearchRows = useMemo(() => {
    const needle = normalizeTextKey(form.productSearch);
    if (needle.length < 2) return [];
    return normalizedProducts
      .filter((product) => normalizeTextKey(`${product.productName} ${product.sku || ''} ${product.barcode || ''} ${product.categoryName}`).includes(needle))
      .slice(0, 24);
  }, [form.productSearch, normalizedProducts]);

  const selectedProducts = useMemo(() => {
    const selected = new Set(form.selectedProductIds.map(String));
    return normalizedProducts.filter((product) => selected.has(String(product.id)));
  }, [form.selectedProductIds, normalizedProducts]);

  const availableProductSearchRows = useMemo(() => {
    if (scope !== 'products') return [];
    const selected = new Set(form.selectedProductIds.map(String));
    return productSearchRows.filter((product) => !selected.has(String(product.id)));
  }, [form.selectedProductIds, productSearchRows, scope]);

  const affectedProducts = useMemo(() => {
    if (scope === 'category') {
      if (!selectedCategory) return [];
      const tagNeedle = normalizeTextKey(form.tag);
      return normalizedProducts.filter((product) => {
        const categoryMatch = String(product.categoryId || '') === String(selectedCategory.id)
          || normalizeTextKey(product.categoryName) === normalizeTextKey(selectedCategory.name);
        if (!categoryMatch) return false;
        if (!tagNeedle) return true;
        return product.tags.some((tag) => normalizeTextKey(tag) === tagNeedle);
      });
    }
    if (scope === 'products') {
      const selected = new Set(form.selectedProductIds.map(String));
      return normalizedProducts.filter((product) => selected.has(String(product.id)));
    }
    const min = form.minPrice === '' ? -Infinity : toSafeNumber(form.minPrice, NaN);
    const max = form.maxPrice === '' ? Infinity : toSafeNumber(form.maxPrice, NaN);
    if (Number.isNaN(min) || Number.isNaN(max) || min > max) return [];
    return normalizedProducts.filter((product) => product.currentRegularPrice >= min && product.currentRegularPrice <= max);
  }, [form.categoryId, form.maxPrice, form.minPrice, form.selectedProductIds, form.tag, normalizedProducts, scope, selectedCategory]);

  const hasValidAdjustment = toSafeNumber(form.adjustmentValue, 0) > 0;
  const canBuildPreview = hasValidAdjustment && affectedProducts.length > 0;

  const previewRows = useMemo(() => {
    if (!canBuildPreview) return [];
    return affectedProducts.map((product) => {
      const nextRegularPrice = calculateBulkPrice({
        currentPrice: product.currentRegularPrice,
        operation: form.operation,
        adjustmentType: form.adjustmentType,
        adjustmentValue: form.adjustmentValue,
        roundingRule: form.roundingRule,
      });
      const campaignEffectiveAfter = calculateCampaignEffectiveAfterRegularChange(product, nextRegularPrice);
      const currentRegularMargin = calculateMarginPercent(product.currentRegularPrice, product.purchasePrice);
      const currentCampaignMargin = product.campaignEffectivePrice !== null ? calculateMarginPercent(product.campaignEffectivePrice, product.purchasePrice) : null;
      const risk = classifyBulkMarginRisk({
        nextRegularPrice,
        campaignEffectiveAfter,
        cost: product.purchasePrice,
      });
      return {
        ...product,
        currentPrice: product.currentRegularPrice,
        nextPrice: nextRegularPrice,
        nextRegularPrice,
        campaignEffectiveAfter,
        currentMargin: currentRegularMargin,
        currentRegularMargin,
        currentCampaignMargin,
        regularMarginAfter: risk.regularMarginAfter,
        campaignMarginAfter: risk.campaignMarginAfter,
        ...risk,
      };
    });
  }, [affectedProducts, canBuildPreview, form.adjustmentType, form.adjustmentValue, form.operation, form.roundingRule]);

  const previewSummary = useMemo(() => {
    const count = previewRows.length;
    const avgBefore = count ? previewRows.reduce((sum, row) => sum + row.currentRegularPrice, 0) / count : 0;
    const avgAfter = count ? previewRows.reduce((sum, row) => sum + row.nextRegularPrice, 0) / count : 0;
    const marginRiskCount = previewRows.filter((row) => row.hasMarginRisk).length;
    const regularLossCount = previewRows.filter((row) => row.regularLoss).length;
    const regularLowMarginCount = previewRows.filter((row) => row.regularLowMargin).length;
    const regularRiskCount = previewRows.filter((row) => row.hasRegularRisk).length;
    const campaignLossCount = previewRows.filter((row) => row.campaignLoss).length;
    const campaignLowMarginCount = previewRows.filter((row) => row.campaignLowMargin).length;
    const campaignRiskCount = previewRows.filter((row) => row.hasCampaignRisk).length;
    const negativeMarginCount = previewRows.filter((row) => row.hasNegativeMargin).length;
    const invalidPriceCount = previewRows.filter((row) => !Number.isFinite(row.nextRegularPrice) || row.nextRegularPrice <= 0).length;
    return {
      count,
      avgBefore,
      avgAfter,
      marginRiskCount,
      regularLossCount,
      regularLowMarginCount,
      regularRiskCount,
      campaignLossCount,
      campaignLowMarginCount,
      campaignRiskCount,
      negativeMarginCount,
      invalidPriceCount,
    };
  }, [previewRows]);

  const marginWarningText = useMemo(() => buildBulkMarginWarningText(previewSummary), [previewSummary]);

  const previewExamples = useMemo(() => [...previewRows]
    .sort((left, right) => Number(right.hasMarginRisk) - Number(left.hasMarginRisk))
    .slice(0, 4)
    .map((row) => {
    const delta = normalizePrice(row.nextRegularPrice - row.currentRegularPrice);
    const pct = row.currentRegularPrice > 0 ? (delta / row.currentRegularPrice) * 100 : 0;
    return {
      id: row.id,
      productName: row.productName || 'Ürün',
      sku: row.sku || row.barcode || '-',
      currentRegularPrice: row.currentRegularPrice,
      nextRegularPrice: row.nextRegularPrice,
      campaignEffectivePrice: row.campaignEffectivePrice,
      campaignEffectiveAfter: row.campaignEffectiveAfter,
      purchasePrice: row.purchasePrice,
      regularMarginAfter: row.regularMarginAfter,
      campaignMarginAfter: row.campaignMarginAfter,
      riskReason: row.riskReason,
      hasActiveCampaign: row.hasActiveCampaign,
      hasMarginRisk: row.hasMarginRisk,
      delta,
      pct,
    };
  }), [previewRows]);

  const previewState = useMemo(() => {
    if (scope === 'products' && form.selectedProductIds.length === 0) return { tone: 'empty', message: 'Önizleme için en az bir ürün seçin.' };
    if (scope === 'category' && !form.categoryId) return { tone: 'empty', message: 'Kategori ve fiyat kuralını seçtiğinizde önizleme otomatik oluşur.' };
    if (!hasValidAdjustment) return { tone: 'empty', message: 'İşlem değeri girildiğinde önizleme otomatik hesaplanır.' };
    if (scope === 'priceRange' && form.minPrice !== '' && form.maxPrice !== '' && toSafeNumber(form.minPrice, NaN) > toSafeNumber(form.maxPrice, NaN)) {
      return { tone: 'empty', message: 'Minimum fiyat maksimum fiyattan büyük olamaz.' };
    }
    if (previewSummary.count === 0) return { tone: 'warning', message: 'Güncellenecek ürün bulunamadı.' };
    if (previewSummary.invalidPriceCount > 0) return { tone: 'warning', message: 'İşlem bazı ürünlerde sıfır veya negatif fiyat oluşturuyor.' };
    return { tone: 'ready', message: '' };
  }, [form.categoryId, form.maxPrice, form.minPrice, form.selectedProductIds.length, hasValidAdjustment, previewSummary, scope]);

  const validation = useMemo(() => {
    if (scope === 'products' && form.selectedProductIds.length === 0) return 'Güncelleme için en az bir ürün seçin.';
    const value = toSafeNumber(form.adjustmentValue, 0);
    if (value <= 0) return 'Geçerli bir fiyat değişim değeri girin.';
    if (previewSummary.count === 0) return 'Güncellenecek ürün bulunamadı.';
    if (previewSummary.invalidPriceCount > 0) return 'İşlem bazı ürünlerde sıfır veya negatif fiyat oluşturuyor.';
    if (!form.acknowledged) return 'Devam etmek için güvenlik onayını işaretleyin.';
    return '';
  }, [form.acknowledged, form.adjustmentValue, form.selectedProductIds.length, previewSummary, scope]);

  const toggleSelectedProduct = (productId) => {
    setForm((current) => {
      if (current.selectedProductIds.includes(productId)) return current;
      return {
        ...current,
        selectedProductIds: [...current.selectedProductIds, productId],
      };
    });
    setIsProductSearchOpen(false);
  };

  const removeSelectedProduct = (productId) => {
    setForm((current) => ({
      ...current,
      selectedProductIds: current.selectedProductIds.filter((id) => id !== productId),
    }));
  };

  const handleApply = () => {
    if (!form.acknowledged) return;
    if (validation) return;
    onApply(previewRows.map((row) => ({ product: row, nextPrice: row.nextPrice })));
  };

  if (!isOpen) return null;

  return (
    <div className="pricing-modal-backdrop" role="presentation">
      <section className="pricing-bulk-modal" role="dialog" aria-modal="true" aria-labelledby="pricing-bulk-title">
        <header className="pricing-bulk-modal-head">
          <div className="mod-card-icon mod-icon-indigo"><Calculator size={20} /></div>
          <div>
            <h2 id="pricing-bulk-title">Toplu Fiyat Güncelleme</h2>
            <p>Kategori, ürün grubu veya seçili ürünler bazında toplu fiyat artışı / indirimi uygulayın.</p>
          </div>
          <button type="button" className="ghost-button pricing-modal-close" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </header>

        <div className="pricing-bulk-modal-body">
          <div className="pricing-bulk-tabs" role="tablist" aria-label="Toplu fiyat kapsamı">
            {BULK_SCOPE_OPTIONS.map((option) => (
              <button key={option.value} type="button" className={scope === option.value ? 'is-active' : ''} onClick={() => { setScope(option.value); setIsProductSearchOpen(false); }}>
                {option.label}
              </button>
            ))}
          </div>

          <div className="pricing-bulk-grid">
            <div className="pricing-bulk-panel">
              <h3>Kapsam</h3>
              {scope === 'category' ? (
                <div className="pricing-bulk-form-grid">
                  <label className="field-group"><span>Kategori</span><select value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value, tag: '' }))}><option value="">Kategori seçin</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label className="field-group"><span>Alt kategori / etiket</span><select value={form.tag} onChange={(event) => setForm((current) => ({ ...current, tag: event.target.value }))}><option value="">Tüm etiketler</option>{categoryTags.map((tag) => <option key={tag.value} value={tag.value}>{tag.label}</option>)}</select></label>
                  <div className="pricing-bulk-count"><Layers size={16} /> {affectedProducts.length} ürün etkilenecek</div>
                </div>
              ) : null}

              {scope === 'products' ? (
                <div className="pricing-bulk-products">
                  <div className="pricing-bulk-product-search-shell">
                    <label className="field-group">
                      <span>Ürün ara</span>
                      <input
                        value={form.productSearch}
                        onFocus={() => setIsProductSearchOpen(normalizeTextKey(form.productSearch).length >= 2)}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setForm((current) => ({ ...current, productSearch: nextValue }));
                          setIsProductSearchOpen(normalizeTextKey(nextValue).length >= 2);
                        }}
                        placeholder="Ürün adı, SKU veya barkod yazın"
                      />
                    </label>
                    {isProductSearchOpen ? (
                      <div className="pricing-bulk-product-popover" role="listbox" aria-label="Ürün seçimi">
                        {normalizeTextKey(form.productSearch).length < 2 ? (
                          <div className="pricing-bulk-product-search-empty">Ürün adı, SKU veya barkod yazarak arama yapın.</div>
                        ) : availableProductSearchRows.length ? (
                          <div className="pricing-bulk-product-list">
                            {availableProductSearchRows.map((product) => (
                              <button key={product.id} type="button" onClick={() => toggleSelectedProduct(product.id)}>
                                <span>
                                  <strong>{product.productName}</strong>
                                  <small>{product.sku || product.barcode || 'SKU yok'} • {product.categoryName} • Regular {formatCurrency(product.currentRegularPrice)}{product.campaignEffectivePrice !== null ? ` • Kampanyalı ${formatCurrency(product.campaignEffectivePrice)}` : ''}</small>
                                </span>
                                <CheckCircle2 size={16} />
                              </button>
                            ))}
                          </div>
                        ) : productSearchRows.length ? (
                          <div className="pricing-bulk-product-search-empty">Eşleşen ürünler zaten seçildi.</div>
                        ) : (
                          <div className="pricing-bulk-product-search-empty">Aramayla eşleşen ürün bulunamadı.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {scope === 'priceRange' ? (
                <div className="pricing-bulk-form-grid">
                  <label className="field-group"><span>Minimum fiyat</span><input type="number" min="0" step="0.01" value={form.minPrice} onChange={(event) => setForm((current) => ({ ...current, minPrice: event.target.value }))} /></label>
                  <label className="field-group"><span>Maksimum fiyat</span><input type="number" min="0" step="0.01" value={form.maxPrice} onChange={(event) => setForm((current) => ({ ...current, maxPrice: event.target.value }))} /></label>
                  <div className="pricing-bulk-count"><Search size={16} /> {affectedProducts.length} ürün aralıkta</div>
                </div>
              ) : null}
            </div>

            <div className="pricing-bulk-panel">
              <h3>Uygulama Türü</h3>
              <div className="pricing-bulk-form-grid">
                <label className="field-group"><span>İşlem</span><select value={form.operation} onChange={(event) => setForm((current) => ({ ...current, operation: event.target.value }))}>{BULK_OPERATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label className="field-group"><span>Tip</span><select value={form.adjustmentType} disabled={form.operation === 'fixed'} onChange={(event) => setForm((current) => ({ ...current, adjustmentType: event.target.value }))}><option value="percent">Yüzde</option><option value="amount">Tutar</option></select></label>
                <label className="field-group"><span>{form.operation === 'fixed' ? 'Sabit fiyat' : 'Değer'}</span><input type="number" min="0" step="0.01" value={form.adjustmentValue} onChange={(event) => setForm((current) => ({ ...current, adjustmentValue: event.target.value }))} /></label>
                <label className="field-group"><span>Küsurat kuralı</span><select value={form.roundingRule} onChange={(event) => setForm((current) => ({ ...current, roundingRule: event.target.value }))}>{BULK_ROUNDING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              </div>
            </div>
          </div>

          {scope === 'products' ? (
            <div className="pricing-bulk-selected-products pricing-bulk-selected-products--full">
              <div className="pricing-bulk-selected-head">
                <strong>Seçilen Ürünler</strong>
                <span>{selectedProducts.length} ürün seçildi</span>
              </div>
              {selectedProducts.length ? (
                <div className="pricing-bulk-selected-list pricing-bulk-selected-list--compact">
                  {selectedProducts.map((product) => (
                    <div key={product.id} className="pricing-bulk-selected-item">
                      <span>
                        <strong>{product.productName}</strong>
                        <small>{product.sku || product.barcode || 'SKU yok'} • {product.categoryName} • Regular {formatCurrency(product.currentRegularPrice)}{product.campaignEffectivePrice !== null ? ` • Kampanyalı ${formatCurrency(product.campaignEffectivePrice)}` : ''}</small>
                      </span>
                      <button type="button" className="ghost-button" onClick={() => removeSelectedProduct(product.id)} aria-label={`${product.productName} ürününü kaldır`}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="pricing-bulk-selected-empty">Henüz ürün seçilmedi.</div>
              )}
            </div>
          ) : null}

          <div className="pricing-bulk-preview">
            <div className="pricing-bulk-preview-head">
              <div>
                <h3>Önizleme</h3>
                <p>Seçili kapsam ve fiyat kurallarına göre sonuç otomatik hesaplanır.</p>
              </div>
            </div>
            {previewState.tone === 'ready' ? (
              <>
                <div className="pricing-bulk-preview-stats">
                  <div><span>Etkilenecek ürün</span><strong>{previewSummary.count}</strong></div>
                  <div><span>Regular mevcut ort.</span><strong>{formatCurrency(previewSummary.avgBefore)}</strong></div>
                  <div><span>Yeni regular ort.</span><strong>{formatCurrency(previewSummary.avgAfter)}</strong></div>
                  <div><span>Regular risk</span><strong>{previewSummary.regularRiskCount}</strong></div>
                  <div><span>Kampanya riski</span><strong>{previewSummary.campaignRiskCount}</strong></div>
                  <div><span>Negatif marj</span><strong>{previewSummary.negativeMarginCount}</strong></div>
                </div>
                {previewSummary.marginRiskCount > 0 ? <div className="pricing-bulk-warning"><AlertTriangle size={16} /> {marginWarningText}</div> : null}
                <div className="pricing-bulk-warning pricing-bulk-warning--info"><AlertTriangle size={16} /> Marj hesabı basit maliyet/fiyat oranına göre yapılır; lojistik, fire ve KDV dahil değildir. Maliyet hesabı purchasePrice/cost alanından yapılır.</div>
                <div className="pricing-bulk-preview-sample-head">
                  <strong>Örnek ürünler</strong>
                  <span>Regular fiyat, kampanyalı efektif fiyat ve risk nedeni ayrı gösterilir</span>
                </div>
                <div className="pricing-bulk-preview-list">
                  {previewExamples.map((row) => (
                    <div key={row.id}>
                      <strong>{row.productName}</strong>
                      <span>Regular: {formatCurrency(row.currentRegularPrice)} → {formatCurrency(row.nextRegularPrice)}</span>
                      <span>{row.hasActiveCampaign ? `Kampanyalı: ${formatCurrency(row.campaignEffectivePrice || 0)} → ${formatCurrency(row.campaignEffectiveAfter || row.campaignEffectivePrice || 0)}` : 'Kampanya yok'}</span>
                      <span>Maliyet: {formatCurrency(row.purchasePrice)} • Regular marj: {row.regularMarginAfter === null ? '-' : formatPercent(row.regularMarginAfter)}{row.campaignMarginAfter === null ? '' : ` • Kampanya marjı: ${formatPercent(row.campaignMarginAfter)}`}</span>
                      <span className={row.hasMarginRisk ? 'is-negative' : 'is-positive'}>{row.riskReason}</span>
                      <span className={row.delta < 0 ? 'is-negative' : 'is-positive'}>
                        {row.delta < 0 ? '' : '+'}{formatCurrency(row.delta)} ({row.pct < 0 ? '' : '+'}{formatPercent(row.pct)})
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : previewState.tone === 'warning' ? (
              <div className="pricing-bulk-warning"><AlertTriangle size={16} /> {previewState.message}</div>
            ) : (
              <div className="pricing-bulk-preview-empty">{previewState.message}</div>
            )}
          </div>
        </div>

        <footer className="pricing-bulk-modal-foot">
          <label className="pricing-bulk-ack">
            <input type="checkbox" checked={form.acknowledged} onChange={(event) => setForm((current) => ({ ...current, acknowledged: event.target.checked }))} />
            <span>Fiyat güncellemesinin ürün fiyat geçmişine işleneceğini ve geri alma işleminin manuel takip gerektireceğini onaylıyorum.</span>
          </label>
          <div className="pricing-bulk-foot-actions pricing-sell-price-foot-actions">
            <button type="button" className="ghost-button" onClick={onClose}>Vazgeç</button>
            <button type="button" className="primary-button" onClick={handleApply} disabled={isApplying || !form.acknowledged || Boolean(validation)}>
              {isApplying ? 'Uygulanıyor...' : 'Güncellemeyi Uygula'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function SellPriceAdvisorModal({
  isOpen,
  rows = [],
  onClose,
  onCalculate,
  onApprove,
  calculation,
  isLoading,
  isApproving,
}) {
  const [productId, setProductId] = useState('');
  const [targetMarginPct, setTargetMarginPct] = useState(22);
  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setProductId('');
    setTargetMarginPct(22);
    setQuery('');
    setIsSearchOpen(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isSearchOpen) return undefined;
    const handlePointerDown = (event) => {
      const searchRoot = event.target instanceof Element ? event.target.closest('.pricing-sell-price-search-shell') : null;
      if (!searchRoot) setIsSearchOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, isSearchOpen]);

  if (!isOpen) return null;

  const normalizedQuery = normalizeTextKey(query);
  const canSearchProducts = normalizedQuery.length >= 2;
  const filteredRows = rows
    .filter((row) => !isCatalogUnlistedProduct(row))
    .filter((row) => {
      if (!canSearchProducts) return false;
      return [row.productName, row.sku, row.barcode].some((value) => normalizeTextKey(value).includes(normalizedQuery));
    })
    .slice(0, 20);

  const selectedRow = rows.find((row) => String(row.productId || row.id) === String(productId)) || null;
  const safeTargetMargin = Number(targetMarginPct || 0);
  const canCalculate = Boolean(productId) && safeTargetMargin > 0 && safeTargetMargin <= 70 && !isLoading;
  const shouldShowDropdown = isSearchOpen && canSearchProducts;
  const calculationProductId = String(calculation?.product?.id || calculation?.product?.productId || '');
  const isCalculationAligned = Boolean(calculation && productId && calculationProductId === String(productId));
  const visibleCalculation = isCalculationAligned ? calculation : null;
  const componentRows = Array.isArray(visibleCalculation?.costs?.componentRows) ? visibleCalculation.costs.componentRows : [];
  const difference = Number(visibleCalculation?.recommendation?.difference || 0);
  const resultCards = visibleCalculation ? [
    {
      key: 'sale-price',
      label: 'Önerilen satış fiyatı',
      value: currency.format(visibleCalculation.recommendation?.recommendedSalePrice || visibleCalculation.recommendation?.suggestedSalePrice || 0),
      tone: 'is-primary',
    },
    {
      key: 'effective-cost',
      label: 'Efektif birim maliyet',
      value: currency.format(visibleCalculation.costs?.totalEffectiveUnitCost || visibleCalculation.costs?.totalEstimatedCost || 0),
      tone: 'is-success',
    },
    {
      key: 'difference',
      label: 'Mevcut fiyat farkı',
      value: `${difference >= 0 ? '+' : ''}${currency.format(difference)}`,
      tone: 'is-neutral',
    },
    {
      key: 'expected-margin',
      label: 'Beklenen marj',
      value: `%${Number(visibleCalculation.recommendation?.expectedMarginPct || 0).toFixed(2)}`,
      tone: 'is-warning',
    },
    {
      key: 'profit',
      label: 'Beklenen brüt kâr',
      value: currency.format(visibleCalculation.recommendation?.expectedProfit || 0),
      tone: 'is-success',
    },
  ] : [];

  return (
    <div className="pricing-modal-backdrop" role="presentation">
      <section className="pricing-bulk-modal pricing-sell-price-modal" role="dialog" aria-modal="true" aria-labelledby="sell-price-title">
        <header className="pricing-bulk-modal-head pricing-sell-price-modal-head">
          <div className="mod-card-icon mod-icon-cyan"><BadgePercent size={20} /></div>
          <div>
            <h2 id="sell-price-title">Ne Kadara Satmalıyım?</h2>
            <p>Alış maliyeti, lojistik, KDV ve risk etkisini birlikte okuyup uygulanabilir satış fiyatını hesaplayın.</p>
          </div>
          <button type="button" className="ghost-button pricing-modal-close" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </header>

        <div className="pricing-bulk-modal-body pricing-sell-price-modal-body">
          <div className="pricing-bulk-grid pricing-sell-price-grid">
            <div className="pricing-sell-price-main-column">
              <div className="pricing-bulk-panel pricing-sell-price-panel">
                <div className="pricing-sell-price-panel-head">
                  <h3>Ürün ve hedef</h3>
                  <p>Ürünü seçin, hedef brüt marjı girin ve fiyat önerisini oluşturun.</p>
                </div>
                <div className="pricing-bulk-form-grid pricing-sell-price-form-grid">
                  <label className="field-group pricing-sell-price-search-shell">
                    <span>Ürün ara</span>
                    <input
                      value={query}
                      onFocus={() => {
                        if (canSearchProducts) setIsSearchOpen(true);
                      }}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        const nextNormalizedQuery = normalizeTextKey(nextValue);
                        setQuery(nextValue);
                        setIsSearchOpen(nextNormalizedQuery.length >= 2);
                        setProductId('');
                      }}
                      placeholder="Ürün adı, SKU veya barkod yazın"
                      autoComplete="off"
                      role="combobox"
                      aria-expanded={shouldShowDropdown}
                      aria-controls="sell-price-product-listbox"
                    />
                    {shouldShowDropdown ? (
                      <div className="pricing-bulk-product-popover pricing-sell-price-product-popover" role="presentation">
                        {filteredRows.length ? (
                          <div className="pricing-bulk-product-list pricing-sell-price-product-list" role="listbox" id="sell-price-product-listbox" aria-label="Ürün önerileri">
                            {filteredRows.map((row) => {
                              const id = row.productId || row.id;
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  className={String(productId) === String(id) ? 'is-selected' : ''}
                                  onClick={() => {
                                    setProductId(id);
                                    setQuery([row.productName, row.sku || row.barcode].filter(Boolean).join(' • '));
                                    setIsSearchOpen(false);
                                  }}
                                  role="option"
                                  aria-selected={String(productId) === String(id)}
                                >
                                  <span>
                                    <strong>{row.productName}</strong>
                                    <small>{row.sku || '-'} • {row.barcode || '-'} • {currency.format(row.currentPrice || 0)}</small>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="pricing-bulk-product-search-empty pricing-sell-price-search-empty">Eşleşme bulunamadı.</div>
                        )}
                      </div>
                    ) : null}
                  </label>
                  <label className="field-group">
                    <span>Hedef marj (%)</span>
                    <input type="number" min="1" max="70" value={targetMarginPct} onChange={(event) => setTargetMarginPct(event.target.value)} />
                  </label>
                </div>
                {selectedRow ? (
                  <div className="pricing-sell-price-selection-summary">
                    <strong>{selectedRow.productName}</strong>
                    <span>{selectedRow.sku || '-'} · {selectedRow.barcode || '-'} · {currency.format(selectedRow.currentPrice || 0)}</span>
                  </div>
                ) : null}
                <div className="pricing-sell-price-action-row">
                  <button type="button" className="primary-button pricing-sell-price-calculate-btn" onClick={() => onCalculate({ productId, targetMarginPct: Number(targetMarginPct || 0) })} disabled={!canCalculate}>
                    {isLoading ? 'Hesaplanıyor...' : 'Hesapla'}
                  </button>
                </div>
              </div>

              <div className="pricing-bulk-panel pricing-sell-price-panel pricing-sell-price-result-panel">
                <div className="pricing-sell-price-panel-head">
                  <h3>Hesap sonucu</h3>
                  <p>Önerilen fiyat, maliyet etkisi ve beklenen kârlılık.</p>
                </div>
                {!visibleCalculation ? (
                  <div className="pricing-bulk-preview-empty pricing-sell-price-empty">
                    <strong>Henüz hesaplama yok</strong>
                    <span>Soldan bir ürün seçip hedef marj ile hesaplamayı başlatın.</span>
                  </div>
                ) : (
                  <>
                    <div className="pricing-sell-price-result-summary">
                      <div>
                        <span>Seçili ürün</span>
                        <strong>{visibleCalculation.product?.productName || selectedRow?.productName || '-'}</strong>
                      </div>
                      <div>
                        <span>Mevcut satış</span>
                        <strong>{currency.format(visibleCalculation.current?.salePrice || 0)}</strong>
                      </div>
                      <div>
                        <span>Hedef marj</span>
                        <strong>%{Number(visibleCalculation.recommendation?.targetMarginPct || 0).toFixed(0)}</strong>
                      </div>
                      <div>
                        <span>Son FDT</span>
                        <strong>{visibleCalculation.priceHistory?.lastPriceChangeDate || visibleCalculation.current?.lastPriceChangeDate || '-'}</strong>
                      </div>
                    </div>
                    <div className="pricing-sell-price-metrics">
                      {resultCards.map((card) => (
                        <article key={card.key} className={`pricing-sell-price-metric ${card.tone}`.trim()}>
                          <span>{card.label}</span>
                          <strong>{card.value}</strong>
                        </article>
                      ))}
                    </div>
                    <div className="pricing-sell-price-summary-list">
                      {(visibleCalculation.calculationSummary || []).map((line) => <div key={line}>{formatUserFacingTechnicalText(line, '-')}</div>)}
                    </div>
                    <div className="pricing-sell-price-foot-note">
                      Bu öneri alış maliyeti, lojistik, operasyon ve risk bileşenleriyle hesaplandı. KDV dahil normal satış fiyatı standardı korunur; kampanya fiyatı güncellenmez.
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="pricing-sell-price-side-column">
              <div className="pricing-bulk-panel pricing-sell-price-panel pricing-sell-price-side-panel">
                <div className="pricing-sell-price-panel-head">
                  <h3>Hesap girdileri</h3>
                  <p>Seçili ürün için kullanılan maliyet ve risk kaynakları.</p>
                </div>
                {!visibleCalculation ? (
                  <div className="pricing-sell-price-input-empty">Hesaplama sonrası alış, lojistik, operasyon ve risk bileşenleri burada açılır.</div>
                ) : (
                  <>
                    <div className="pricing-sell-price-input-grid">
                      <div><span>SKU</span><strong>{visibleCalculation.product?.sku || '-'}</strong></div>
                      <div><span>Barkod</span><strong>{visibleCalculation.product?.barcode || '-'}</strong></div>
                      <div><span>Birim / koli</span><strong>{visibleCalculation.product?.unit || 'adet'} / {visibleCalculation.product?.casePack || visibleCalculation.costs?.unitsPerCase || 1}</strong></div>
                      <div><span>Saklama</span><strong>{formatCalculationStorageLabel(visibleCalculation.product?.storageType)}</strong></div>
                      <div><span>Kategori</span><strong>{visibleCalculation.product?.categoryName || '-'}</strong></div>
                      <div><span>KDV standardı</span><strong>%{Number(visibleCalculation.costs?.vatRatePct || 0).toFixed(0)}</strong></div>
                    </div>
                    <div className="pricing-sell-price-cost-breakdown">
                      {componentRows.map((row) => (
                      <div key={row.key} className="pricing-sell-price-cost-row">
                        <div>
                          <strong>{row.label}</strong>
                            <span>{formatCalculationComponentDetail(row, visibleCalculation)}</span>
                        </div>
                        <b>{currency.format(row.amount || 0)}</b>
                        </div>
                      ))}
                    </div>
                    {visibleCalculation.campaign?.isActive ? (
                      <div className="pricing-sell-price-alert">
                        Aktif kampanya: {visibleCalculation.campaign.name} · kampanya fiyatı {currency.format(visibleCalculation.campaign.campaignPrice || 0)}. Bu ekran normal satış fiyatını önerir.
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <footer className="pricing-bulk-modal-foot pricing-sell-price-modal-foot">
          <div className="pricing-sell-price-foot-note">
            Hesaplama, alış maliyeti, lojistik, KDV ve operasyon varsayımlarını kullanır.
          </div>
          <div className="pricing-bulk-foot-actions pricing-sell-price-foot-actions">
            <button type="button" className="ghost-button" onClick={onClose}>Kapat</button>
            <button
              type="button"
              className="primary-button"
              onClick={() => onApprove({
                productId: visibleCalculation?.product?.id || selectedRow?.productId,
                salePrice: visibleCalculation?.recommendation?.suggestedSalePrice,
                targetMarginPct: visibleCalculation?.recommendation?.targetMarginPct,
              })}
              disabled={!visibleCalculation || isApproving}
            >
              {isApproving ? 'Onaylanıyor...' : 'Fiyatı Onayla'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function PricingAnalysis() {
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(FILTER_DEFAULTS);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [expandedRowId, setExpandedRowId] = useState('');
  const [rowDetails, setRowDetails] = useState({});
  const [rowDetailLoadingId, setRowDetailLoadingId] = useState('');
  const [simulationDiscounts, setSimulationDiscounts] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkDiscountRate, setBulkDiscountRate] = useState(20);
  const [toast, setToast] = useState({ type: '', message: '' });
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoryLabels, setCategoryLabels] = useState([]);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [isSellPriceModalOpen, setIsSellPriceModalOpen] = useState(false);
  const [sellPriceCalculation, setSellPriceCalculation] = useState(null);
  const [sellPriceLoading, setSellPriceLoading] = useState(false);
  const [sellPriceApproving, setSellPriceApproving] = useState(false);
  const [criticalFilterActive, setCriticalFilterActive] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const [tableMeta, setTableMeta] = useState(null);
  const rowsPerPage = 10;

  const loadPricingData = useCallback(async ({ signal, forceRefresh = false, keepContent = false } = {}) => {
    if (keepContent) setIsRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const analysisParams = {
        universe: 'listed_active',
        categoryId: filters.categoryId,
        supplierId: filters.supplierId,
        riskLevel: filters.risk,
        sktStatus: filters.sktStatus,
        salesSpeed: filters.salesSpeed,
        discountOnly: filters.hasSuggestion === true ? 'true' : undefined,
        page: tablePage,
        limit: rowsPerPage,
        sort: 'risk_desc',
      };
      if (forceRefresh) analysisParams.forceRefresh = true;
      const [summaryResponse, rowsResponse, categoryResponse, productResponse, labelResponse] = await Promise.allSettled([
        pricingAnalysisService.getSummary(analysisParams, { signal }),
        pricingAnalysisService.getRows(analysisParams, { signal }),
        categoryService.list({ forceRefresh }),
        productService.list({ universe: 'listed_active', includeUnlisted: false, fetchAll: true, forceRefresh }),
        categoryService.listLabels({ forceRefresh }),
      ]);
      if (signal?.aborted) return;
      if (summaryResponse.status === 'rejected') throw summaryResponse.reason;
      if (rowsResponse.status === 'rejected') throw rowsResponse.reason;
      const rowResult = normalizePricingRowsResponse(rowsResponse.value);
      const rowList = rowResult.rows;
      setAnalysis({ ...summaryResponse.value, rows: rowList });
      setTableMeta(rowResult.pagination);
      setCategories(categoryResponse.status === 'fulfilled' && Array.isArray(categoryResponse.value) ? categoryResponse.value : []);
      setProducts(productResponse.status === 'fulfilled' && Array.isArray(productResponse.value) ? productResponse.value : []);
      setCategoryLabels(labelResponse.status === 'fulfilled' && Array.isArray(labelResponse.value) ? labelResponse.value : []);
    } catch (loadError) {
      if (loadError?.name === 'AbortError' || signal?.aborted) return;
      setError(loadError.message || 'Fiyat analizi alınamadı.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [filters, tablePage]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPricingData({ signal: controller.signal });
    return () => controller.abort();
  }, [loadPricingData]);

  const recommendationRows = useMemo(() => {
    const collectedRows = collectPricingRows(analysis);
    const sourceRows = collectedRows.length ? collectedRows : products.map(mapProductToPricingSignal).filter(Boolean);

    const uniqueMap = new Map();

    sourceRows.forEach((row, index) => {
      const normalizedRow = normalizePricingActionRow(row, index);
      if (!normalizedRow || uniqueMap.has(normalizedRow.id)) return;
      uniqueMap.set(normalizedRow.id, normalizedRow);
    });

    return [...uniqueMap.values()];
  }, [analysis, products]);

  const visibleRows = useMemo(() => {
    let rows = recommendationRows;

    if (selectedPreset) {
      rows = rows.filter((row) => rowMatchesPricePreset(row, selectedPreset));
    }
    if (filters.risk) {
      rows = rows.filter((row) => row.riskLevel === filters.risk);
    }
    if (filters.sktStatus) {
      rows = rows.filter((row) => row.expirationRisk === filters.sktStatus);
    }
    if (filters.salesSpeed) {
      rows = rows.filter((row) => {
        if (filters.salesSpeed === 'fast') return row.salesVelocity >= 4;
        if (filters.salesSpeed === 'slow') return row.salesVelocity <= 1;
        return row.salesVelocity > 1 && row.salesVelocity < 4;
      });
    }
    if (filters.hasSuggestion === true) {
      rows = rows.filter((row) => row.suggestedDiscount > 0);
    } else if (filters.hasSuggestion === false) {
      rows = rows.filter((row) => row.suggestedDiscount <= 0);
    }
    if (criticalFilterActive) {
      rows = rows.filter((row) => row.actionType === 'urgent' || row.expirationRisk === 'critical' || row.riskLevel === 'critical');
    }

    return rows.map((row) => {
      const simulatedDiscount = clampPercent(simulationDiscounts[row.id] ?? row.suggestedDiscount);
      const simulatedAction = getActionModel({
        currentPrice: row.currentPrice,
        actionType: simulatedDiscount > 0 ? (row.actionType === 'urgent' ? 'urgent' : 'discount') : row.actionType,
        actionPercent: simulatedDiscount,
        suggestedPrice: row.suggestedPrice,
      });
      return {
        ...row,
        simulatedDiscount,
        suggestedPrice: simulatedAction.suggestedPrice,
        actionLabel: simulatedAction.actionLabel,
        actionPercent: simulatedAction.actionPercent,
        actionSimulationText: simulatedAction.simulationText,
        priceChangePercent: simulatedAction.priceChangePercent,
      };
    });
  }, [recommendationRows, selectedPreset, simulationDiscounts, filters, criticalFilterActive]);

  const selectedRows = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return visibleRows.filter((row) => selectedSet.has(row.id));
  }, [selectedIds, visibleRows]);

  const bulkModalProducts = useMemo(() => {
    if (products.length) return products;
    return recommendationRows.map((row) => ({
      id: row.productId || row.id,
      productId: row.productId || row.id,
      productName: row.productName,
      categoryName: row.category,
      categoryId: row.categoryId || row.productCategoryId || '',
      salePrice: row.currentPrice,
      purchasePrice: row.cost,
      currentStock: row.stockLevel,
      avgDailySales: row.salesVelocity,
      sku: row.sku,
    }));
  }, [products, recommendationRows]);

  const sellPriceRows = useMemo(() => {
    const activeProductRows = products
      .filter((product) => !isCatalogUnlistedProduct(product))
      .map((product, index) => ({
        id: product.id || product.productId || `product-${index}`,
        productId: product.id || product.productId || `product-${index}`,
        productName: getProductName(product),
        sku: product.sku || '-',
        barcode: product.barcode || '-',
        currentPrice: getProductPrice(product),
        category: getProductCategoryName(product),
      }))
      .filter((row) => row.productId && Number(row.currentPrice || 0) > 0);
    return activeProductRows.length ? activeProductRows : recommendationRows;
  }, [products, recommendationRows]);

  const summary = useMemo(() => {
    const rows = visibleRows;
    const analysisSummary = analysis?.summary || {};
    const total = Number(analysisSummary.totalAnalyzedProducts ?? tableMeta?.total ?? rows.length);
    const urgentCount = Number(analysisSummary.highRiskProducts ?? rows.filter((row) => row.actionType === 'urgent').length);
    const discountCount = Number(analysisSummary.discountSuggestedProducts ?? rows.filter((row) => row.simulatedDiscount > 0).length);
    const keepCount = Math.max(0, total - discountCount);
    const avgDiscount = discountCount
      ? rows
          .filter((row) => row.simulatedDiscount > 0)
          .reduce((sum, row) => sum + row.simulatedDiscount, 0) / discountCount
      : 0;

    return {
      total,
      urgentCount,
      discountCount,
      keepCount,
      avgDiscount: Number(avgDiscount.toFixed(1)),
    };
  }, [analysis?.summary, tableMeta?.total, visibleRows]);

  const metricCards = useMemo(() => {
    const urgentMessage = summary.urgentCount > 0 ?
      `${summary.urgentCount} ürün için hızlı aksiyon gerekiyor.`
      : 'Acil müdahale gerektiren ürün yok.';

    const discountMessage = summary.discountCount > 0 ?
      `${summary.discountCount} ürün için indirim önerisi hazır.`
      : 'İndirim gerektiren ürün görünmüyor.';

    const keepMessage = summary.keepCount > 0 ?
      `${summary.keepCount} ürün fiyat koruma modunda.`
      : 'Fiyat koruma adayı ürün görünmüyor.';

    return [
      {
        id: 'urgent',
        label: 'Acil İşlem',
        value: summary.urgentCount,
        icon: <ShieldAlert size={16} />,
        iconClass: 'mod-icon-rose',
        message: urgentMessage,
        onClick: () => handleCardFilter('urgent'),
        toneClass: 'is-primary-urgent',
      },
      {
        id: 'discount',
        label: 'İndirim Önerisi',
        value: summary.discountCount,
        icon: <BadgePercent size={16} />,
        iconClass: 'mod-icon-cyan',
        message: discountMessage,
        onClick: () => handleCardFilter('discount'),
        toneClass: '',
      },
      {
        id: 'keep',
        label: 'Fiyat Koruma',
        value: summary.keepCount,
        icon: <ShieldCheck size={16} />,
        iconClass: 'mod-icon-emerald',
        message: keepMessage,
        onClick: () => handleCardFilter('keep'),
        toneClass: '',
      },
      {
        id: 'all',
        label: 'Toplam Öneri',
        value: summary.total,
        icon: <Boxes size={16} />,
        iconClass: 'mod-icon-indigo',
        message: summary.total > 0 ? 'Sistem önerileri analiz ederek listeliyor.' : 'Şu an öneri listesi boş görünüyor.',
        onClick: () => handleCardFilter('all'),
        toneClass: '',
      },
    ];
  }, [summary]);

  const pricingActionChartData = useMemo(() => ([
    { name: 'Acil', adet: summary.urgentCount },
    { name: 'İndirim', adet: summary.discountCount },
    { name: 'Koruma', adet: summary.keepCount },
  ]), [summary]);

  const pricingRiskChartData = useMemo(() => {
    const riskMap = { critical: 0, high: 0, medium: 0, low: 0 };
    visibleRows.forEach((row) => {
      const risk = String(row.riskLevel || '').toLowerCase('tr-TR');
      if (risk in riskMap) riskMap[risk] += 1;
    });

    return [
      { name: 'Kritik', adet: riskMap.critical },
      { name: 'Yüksek', adet: riskMap.high },
      { name: 'Orta', adet: riskMap.medium },
      { name: 'Düşük', adet: riskMap.low },
    ];
  }, [visibleRows]);

  const pricingExpiryChartData = useMemo(() => {
    const buckets = {
      urgent: 0,
      short: 0,
      medium: 0,
      long: 0,
    };

    visibleRows.forEach((row) => {
      const day = Number(row.daysToExpiry);
      if (!Number.isFinite(day)) return;
      if (day <= 7) buckets.urgent += 1;
      else if (day <= 14) buckets.short += 1;
      else if (day <= 30) buckets.medium += 1;
      else buckets.long += 1;
    });

    return [
      { name: '0-7 gün', adet: buckets.urgent },
      { name: '8-14 gün', adet: buckets.short },
      { name: '15-30 gün', adet: buckets.medium },
      { name: '30+ gün', adet: buckets.long },
    ];
  }, [visibleRows]);

  const criticalRows = useMemo(
    () => visibleRows.filter((row) => row.actionType === 'urgent' || row.expirationRisk === 'critical').slice(0, 5),
    [visibleRows],
  );

  const emptyState = useMemo(
    () => mapEmptyStateReason({ rows: recommendationRows, filters }),
    [recommendationRows, filters],
  );

  const activeFilterCount = useMemo(
    () => [filters.risk, filters.sktStatus, filters.salesSpeed, filters.hasSuggestion !== '' ? 'suggestion' : '', selectedPreset, criticalFilterActive ? 'critical' : ''].filter(Boolean).length,
    [filters, selectedPreset, criticalFilterActive],
  );

  const toggleRowSelection = (rowId, checked) => {
    setSelectedIds((prev) => toggleSelectedIds(prev, rowId, checked));
  };

  const toggleAllSelection = (checked) => {
    setSelectedIds((prev) => toggleAllIds(prev, visibleRows, checked));
  };

  const updateSimulationDiscount = (rowId, value) => {
    const parsed = Math.max(0, Math.min(80, toSafeNumber(value, 0)));
    setSimulationDiscounts((prev) => ({ ...prev, [rowId]: parsed }));
  };

  const toggleRowDetail = async (row) => {
    const rowId = row?.id;
    if (!rowId) return;
    if (expandedRowId === rowId) {
      setExpandedRowId('');
      return;
    }
    setExpandedRowId(rowId);
    if (rowDetails[rowId]) return;
    setRowDetailLoadingId(rowId);
    try {
      const detail = await pricingAnalysisService.getDetail(row.productId || rowId, {
        categoryId: filters.categoryId,
        supplierId: filters.supplierId,
        riskLevel: filters.risk,
        sktStatus: filters.sktStatus,
        salesSpeed: filters.salesSpeed,
      });
      setRowDetails((current) => ({ ...current, [rowId]: detail }));
    } catch {
      setRowDetails((current) => ({ ...current, [rowId]: { priceHistory: [], priceHistoryCount: row.priceHistoryCount || 0 } }));
    } finally {
      setRowDetailLoadingId('');
    }
  };

  const handlePresetClick = (presetId) => {
    const nextPreset = selectedPreset === presetId ? '' : presetId;
    setSelectedPreset(nextPreset);
    setFilters((prev) => applyPricePreset(prev, nextPreset));
    setSelectedIds([]);
  };

  const handleCardFilter = (mode) => {
    if (mode === 'urgent') {
      setFilters((prev) => ({ ...prev, sktStatus: 'critical' }));
      setSelectedPreset(PRICE_PRESETS.nearExpiry);
      setCriticalFilterActive(true);
      return;
    }
    if (mode === 'discount') {
      setFilters((prev) => ({ ...prev, hasSuggestion: true }));
      return;
    }
    if (mode === 'keep') {
      setFilters((prev) => ({ ...prev, hasSuggestion: false }));
      return;
    }
    setFilters(FILTER_DEFAULTS);
    setSelectedPreset('');
    setCriticalFilterActive(false);
  };

  const openCampaignFlow = (rows, intent) => {
    const productIds = rows.map((row) => row.productId).filter(Boolean);
    if (!productIds.length) {
      setToast({ type: 'warning', message: 'Kampanya aktarımı için en az bir ürün seçin.' });
      return;
    }

    localStorage.setItem(
      'pricingCampaignDraft',
      JSON.stringify({
        intent,
        productIds,
        discountRate: bulkDiscountRate,
        createdAt: new Date().toISOString(),
      }),
    );

    navigate(`/kampanya-yonetimi?source=pricing&intent=${intent}&count=${productIds.length}`);
  };

  const handleBulkAction = (action) => {
    if (!selectedRows.length) {
      setToast({ type: 'warning', message: 'Toplu işlem için ürün seçimi yapın.' });
      return;
    }

    if (action === BULK_ACTIONS.ADD_CAMPAIGN) {
      openCampaignFlow(selectedRows, 'campaign');
      return;
    }

    if (action === BULK_ACTIONS.APPLY_DISCOUNT) {
      const newDiscount = Math.max(0, Math.min(80, toSafeNumber(bulkDiscountRate, 0)));
      setSimulationDiscounts((prev) => {
        const next = { ...prev };
        selectedRows.forEach((row) => {
          next[row.id] = newDiscount;
        });
        return next;
      });
      setToast({
        type: 'success',
        message: (
          <>
            {selectedRows.length} ürüne %{Math.round(newDiscount)} simülasyon indirimi uygulandı.
            <span className="sr-only">{selectedRows.length} urune %{Math.round(newDiscount)} simulasyon indirimi uygulandi</span>
          </>
        ),
      });
      return;
    }

    if (action === BULK_ACTIONS.KEEP_PRICE) {
      setSimulationDiscounts((prev) => {
        const next = { ...prev };
        selectedRows.forEach((row) => {
          next[row.id] = 0;
        });
        return next;
      });
      setToast({ type: 'info', message: `${selectedRows.length} ürün fiyat koruma moduna alındı.` });
    }
  };

  const handleApplyBulkPriceUpdate = async (updates) => {
    if (!Array.isArray(updates) || updates.length === 0) {
      setToast({ type: 'warning', message: 'Güncellenecek ürün bulunamadı.' });
      return;
    }
    setBulkApplying(true);
    try {
      await Promise.all(updates.map(({ product, nextPrice }) => productService.update(product.id, {
        salePrice: normalizePrice(nextPrice),
        lastPriceChangeSource: 'bulk_price_update',
      })));
      pricingAnalysisService.invalidateCache?.();
      await loadPricingData({ forceRefresh: true });
      setSimulationDiscounts({});
      setSelectedIds([]);
      setIsBulkModalOpen(false);
      setToast({ type: 'success', message: `${updates.length} ürün için fiyat güncellemesi uygulandı.` });
    } catch (applyError) {
      setToast({ type: 'error', message: applyError.message || 'Toplu fiyat güncelleme uygulanamadı.' });
    } finally {
      setBulkApplying(false);
    }
  };

  const handleCalculateSellPrice = async (payload) => {
    if (!payload?.productId) {
      setToast({ type: 'warning', message: 'Hesaplama için ürün seçin.' });
      return;
    }
    setSellPriceLoading(true);
    try {
      const result = await pricingAnalysisService.calculateSellPrice(payload);
      setSellPriceCalculation(result);
    } catch (calcError) {
      setToast({ type: 'error', message: calcError.message || 'Satış fiyatı hesaplanamadı.' });
    } finally {
      setSellPriceLoading(false);
    }
  };

  const handleApproveSellPrice = async (payload) => {
    if (!payload?.productId || !payload?.salePrice) {
      setToast({ type: 'warning', message: 'Onaylanacak fiyat bulunamadı.' });
      return;
    }
    setSellPriceApproving(true);
    try {
      const result = await pricingAnalysisService.approveSellPrice(payload);
      pricingAnalysisService.invalidateCache?.();
      await loadPricingData({ forceRefresh: true });
      setSellPriceCalculation((current) => current ? {
        ...current,
        current: { ...current.current, salePrice: result.salePrice },
      } : current);
      setToast({ type: 'success', message: 'Önerilen fiyat onaylandı ve fiyat geçmişine işlendi.' });
    } catch (approveError) {
      setToast({ type: 'error', message: approveError.message || 'Fiyat onaylanamadı.' });
    } finally {
      setSellPriceApproving(false);
    }
  };

  const handleRefreshAnalysis = () => {
    if (loading || isRefreshing) return;
    pricingAnalysisService.invalidateCache?.();
    void loadPricingData({ forceRefresh: true, keepContent: true });
  };

  const resetFilters = () => {
    setFilters(FILTER_DEFAULTS);
    setSelectedPreset('');
    setCriticalFilterActive(false);
    setSelectedIds([]);
    setTablePage(1);
  };

  useEffect(() => {
    setTablePage(1);
  }, [filters, selectedPreset, criticalFilterActive]);

  const totalRows = Number(tableMeta?.total ?? visibleRows.length);
  const totalPages = Math.max(1, Number(tableMeta?.totalPages ?? Math.ceil(visibleRows.length / rowsPerPage)));
  const pagedRows = useMemo(
    () => visibleRows.map((row) => enrichPricingActionRowForTable(row, simulationDiscounts)),
    [visibleRows, simulationDiscounts],
  );
  const visibleRangeStart = totalRows ? ((tablePage - 1) * rowsPerPage) + 1 : 0;
  const visibleRangeEnd = totalRows ? Math.min(tablePage * rowsPerPage, totalRows) : 0;

  const allSelected = pagedRows.length > 0 && pagedRows.every((row) => selectedIds.includes(row.id));
  const renderTablePagination = () => {
    if (!visibleRows.length) return null;
    return (
      <div className="pricing-table-pagination pricing-table-pagination--top" aria-label="Sayfalama">
        <div className="pricing-table-pagination-row">
          <span className="pricing-table-pagination-summary">{totalRows} kayıttan {visibleRangeStart}-{visibleRangeEnd} arası</span>
          <button type="button" className="ghost-button pricing-toolbar-button pricing-table-pagination-button" onClick={() => setTablePage((prev) => Math.max(1, prev - 1))} disabled={tablePage === 1}>Önceki</button>
          <span className="pricing-table-pagination-page">Sayfa {tablePage} / {totalPages}</span>
          <button type="button" className="primary-button pricing-toolbar-button pricing-table-pagination-button" onClick={() => setTablePage((prev) => Math.min(totalPages, prev + 1))} disabled={tablePage >= totalPages}>Sonraki</button>
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard-page page-stack pricing-analysis-page pricing-layout">
      <PageHeader
        className="dashboard-hero"
        icon={<TrendingUp size={22} />}
        title="Fiyat & Talep Analizi"
        description="Stok, satış ve fiyat verilerine göre fiyat aksiyonlarını analiz edin."
        actions={
          <div className="pricing-header-actions">
            <span className="pricing-info-chip" aria-label="Son güncelleme bilgisi">
              <Clock3 size={14} />
              Son güncelleme: <strong>{analysis?.generatedAt ? new Date(analysis.generatedAt).toLocaleString('tr-TR') : '-'}</strong>
            </span>
            <div className="pricing-header-action-group" role="group" aria-label="Fiyat analizi aksiyonları">
              <button
                type="button"
                className="primary-button pricing-toolbar-button pricing-header-action-button pricing-refresh-icon-button"
                onClick={handleRefreshAnalysis}
                disabled={loading || isRefreshing}
                aria-busy={isRefreshing}
                aria-label="Analizleri Yenile"
                title="Analizleri Yenile"
              >
                <RefreshCw size={16} className={isRefreshing ? 'pricing-spin' : ''} />
              </button>
              <button type="button" className="primary-button pricing-toolbar-button pricing-header-action-button pricing-bulk-launch-primary" onClick={() => setIsBulkModalOpen(true)}>
                <Calculator size={16} /> Toplu Fiyat Güncelleme
              </button>
              <button type="button" className="primary-button pricing-toolbar-button pricing-header-action-button pricing-bulk-launch-primary" onClick={() => { setSellPriceCalculation(null); setIsSellPriceModalOpen(true); }}>
                <BadgePercent size={16} /> Ne Kadara Satmalıyım?
              </button>
            </div>
          </div>
        }
      />

      {criticalRows.length > 0 && (
        <div className="pricing-critical-hero pricing-section" role="alert" aria-live="polite">
          <div className="pricing-critical-hero-icon" aria-hidden="true"><AlertTriangle size={28} /></div>
          <div>
            <h3>Öncelikli Fiyat Aksiyonları</h3>
            <span className="sr-only">Oncelikli Fiyat Aksiyonlari</span>
            <p>{criticalRows.length} ürün acil indirim veya fiyat koruma değerlendirmesi bekliyor.</p>
          </div>
          <button
            type="button"
            className={`ghost-button ${criticalFilterActive ? 'is-active' : ''}`}
            onClick={() => {
              if (criticalFilterActive) {
                setCriticalFilterActive(false);
                setFilters((prev) => ({ ...prev, sktStatus: '' }));
              } else {
                handleCardFilter('urgent');
              }
            }}
            aria-pressed={criticalFilterActive}
          >
            {criticalFilterActive ? 'Kritik Filtresini Kaldır' : 'Kritikleri Filtrele'}
          </button>
        </div>
      )}

      <div className="dashboard-grid dashboard-grid--4 pricing-summary-grid pricing-summary-grid-meaningful pricing-section">
        {metricCards.map((card) => (
          <button
            key={card.id}
            type="button"
            className={`mod-stat pricing-clickable-stat pricing-insight-stat ${card.toneClass}`.trim()}
            onClick={card.onClick}
          >
            <div className={`mod-stat-icon ${card.iconClass || 'mod-icon-blue'}`}>{card.icon || <Sparkles size={16} />}</div>
            <div className="mod-stat-body">
              <span className="mod-stat-label">{card.label}</span>
              <span className="mod-stat-value">{card.value}</span>
              <span className="mod-stat-caption">{card.message}</span>
            </div>
          </button>
        ))}
      </div>

      <section className="pricing-chart-grid pricing-section" aria-label="Fiyat ve talep grafik özeti">
        <article className="mod-card pricing-chart-card">
          <div className="pricing-chart-head">
            <div>
              <h3><BarChart3 size={15} /> Aksiyon Dağılımı</h3>
              <p>Fiyat önerilerinin aksiyon tiplerine göre dağılımı.</p>
            </div>
            <span>{summary.total} kayıt</span>
          </div>
          <div className="pricing-chart-body">
            {pricingActionChartData.some((item) => item.adet > 0) ? (
              <ResponsiveContainer width="100%" height={188}>
                <RBarChart data={pricingActionChartData} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <RTooltip content={<PricingChartTooltip />} />
                  <Bar dataKey="adet" name="Ürün" fill="#2563eb" radius={[8, 8, 0, 0]} />
                </RBarChart>
              </ResponsiveContainer>
            ) : renderChartEmptyState('Henüz grafik verisi yok', 'Aksiyon sinyalleri oluştukça dağılım burada görünür.')}
          </div>
          <div className="pricing-chart-foot"><BarChart3 size={14} /> Öncelik, indirim ve koruma aksiyonlarını birlikte izler.</div>
        </article>

        <article className="mod-card pricing-chart-card">
          <div className="pricing-chart-head">
            <div>
              <h3><ShieldAlert size={15} /> Risk Profili</h3>
              <p>Ürünlerin marj, SKT ve talep sinyallerine göre risk bandı.</p>
            </div>
            <span>Risk seviyesine göre</span>
          </div>
          <div className="pricing-chart-body">
            {pricingRiskChartData.some((item) => item.adet > 0) ? (
              <ResponsiveContainer width="100%" height={188}>
                <RBarChart data={pricingRiskChartData} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <RTooltip content={<PricingChartTooltip />} />
                  <Bar dataKey="adet" name="Ürün" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
                </RBarChart>
              </ResponsiveContainer>
            ) : renderChartEmptyState('Henüz risk grafiği yok', 'Risk seviyeleri oluştuğunda bu panel otomatik güncellenir.')}
          </div>
          <div className="pricing-chart-foot"><BarChart3 size={14} /> Kritik ve yüksek riskli ürünleri hızlı ayırır.</div>
        </article>

        <article className="mod-card pricing-chart-card">
          <div className="pricing-chart-head">
            <div>
              <h3><Clock3 size={15} /> SKT Baskı Haritası</h3>
              <p>Son kullanma tarihi yaklaşan ürünlerin gün bandı görünümü.</p>
            </div>
            <span>Gün bandına göre</span>
          </div>
          <div className="pricing-chart-body">
            {pricingExpiryChartData.some((item) => item.adet > 0) ? (
              <ResponsiveContainer width="100%" height={188}>
                <RBarChart data={pricingExpiryChartData} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <RTooltip content={<PricingChartTooltip />} />
                  <Bar dataKey="adet" name="Ürün" fill="#f97316" radius={[8, 8, 0, 0]} />
                </RBarChart>
              </ResponsiveContainer>
            ) : renderChartEmptyState('Henüz SKT baskı verisi yok', 'SKT sinyalleri oluştuğunda gün bandı görünümü burada yer alır.')}
          </div>
          <div className="pricing-chart-foot"><TrendingUp size={14} /> Yakın SKT kaynaklı fiyat baskısını görünür kılar.</div>
        </article>
      </section>

      <div className="mod-card pricing-filter-shell pricing-section pricing-filter-section">
        <div className="pricing-filter-title-row">
          <div className="pricing-filter-title-left">
            <span className="mod-card-icon mod-icon-cyan"><Filter size={15} /></span>
            <h3>Fiyat Öneri Filtreleri</h3>
          </div>
        </div>
        <FilterBar className="pricing-analysis-filter products-filter-bar-minimal">
          <label className="field-group pricing-filter-field">
            <span>Risk Seviyesi</span>
            <select
              value={filters.risk}
              onChange={(event) => setFilters((prev) => ({ ...prev, risk: event.target.value }))}
            >
              <option value="">Tüm riskler</option>
              <option value="low">Düşük</option>
              <option value="medium">Orta</option>
              <option value="high">Yüksek</option>
              <option value="critical">Kritik</option>
            </select>
          </label>
          <label className="field-group pricing-filter-field">
            <span>SKT</span>
            <select
              value={filters.sktStatus}
              onChange={(event) => setFilters((prev) => ({ ...prev, sktStatus: event.target.value }))}
            >
              <option value="">Tüm durumlar</option>
              <option value="safe">Güvenli</option>
              <option value="soon">Yaklaşıyor</option>
              <option value="critical">Kritik</option>
            </select>
          </label>
          <label className="field-group pricing-filter-field">
            <span>Satış Hızı</span>
            <select
              value={filters.salesSpeed}
              onChange={(event) => setFilters((prev) => ({ ...prev, salesSpeed: event.target.value }))}
            >
              <option value="">Tüm hızlar</option>
              <option value="fast">Hızlı</option>
              <option value="normal">Normal</option>
              <option value="slow">Yavaş</option>
            </select>
          </label>
          <label className="field-group pricing-filter-field">
            <span>Öneri Durumu</span>
            <select
              value={filters.hasSuggestion === '' ? '' : String(filters.hasSuggestion)}
              onChange={(event) => {
                const value = event.target.value;
                setFilters((prev) => ({
                  ...prev,
                  hasSuggestion: value === '' ? '' : value === 'true',
                }));
              }}
            >
              <option value="">Tüm ürünler</option>
              <option value="true">Önerisi olanlar</option>
              <option value="false">Fiyat koru</option>
            </select>
          </label>
          <div className="pricing-filter-inline-meta">
            <span className="pricing-info-chip">Aktif filtre: <strong>{activeFilterCount}</strong></span>
            <button type="button" className="ghost-button pricing-filter-action" onClick={resetFilters}>
              Filtreleri Temizle
            </button>
          </div>
        </FilterBar>

        <div className="pricing-preset-row" aria-label="Akıllı filtre sekmeleri">
          {PRESET_OPTIONS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`pricing-preset-chip ${selectedPreset === preset.id ? 'is-active' : ''}`}
              onClick={() => handlePresetClick(preset.id)}
              aria-label={preset.ariaLabel}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {selectedRows.length > 0 && (
        <div className="pricing-bulk-bar pricing-section" role="region" aria-label="Toplu aksiyon çubuğu">
          <span>{selectedRows.length} ürün seçili<span className="sr-only">{selectedRows.length} urun secili</span></span>
          <label>
            Toplu indirim (%)
            <input
              type="number"
              min="0"
              max="80"
              value={bulkDiscountRate}
              onChange={(event) => setBulkDiscountRate(event.target.value)}
            />
          </label>
          <button type="button" className="primary-button" aria-label="Toplu Indirim Uygula" onClick={() => handleBulkAction(BULK_ACTIONS.APPLY_DISCOUNT)}>
            Toplu İndirim Uygula
          </button>
          <button type="button" className="ghost-button" onClick={() => handleBulkAction(BULK_ACTIONS.ADD_CAMPAIGN)}>
            Kampanyaya Ekle
          </button>
          <button type="button" className="ghost-button" onClick={() => handleBulkAction(BULK_ACTIONS.KEEP_PRICE)}>
            Fiyatı Koru
          </button>
        </div>
      )}

      <div className="mod-card pricing-section pricing-action-list-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-indigo"><BadgePercent size={18} /></div>
          <div>
            <h2>Fiyat Aksiyon Listesi</h2>
            <p>Satır bazında etki simülasyonu, marj karşılaştırması ve karar desteği.</p>
          </div>
          {renderTablePagination()}
        </div>

        {loading ? (
          <PricingActionListLoading />
        ) : error ? (
          <div className="table-empty">{error}</div>
        ) : visibleRows.length === 0 ? (
          <div className="mod-empty-state pricing-empty-state" role="status">
            <BadgePercent size={24} />
            <h4>Fiyat aksiyonu gerektiren ürün bulunmuyor</h4>
            <p>Satış hızı, stok seviyesi ve marj dengede. Şu an fiyat değişikliği önerilmiyor.</p>
            <p className="pricing-empty-why">Neden: {emptyState.description}</p>
            <div className="pricing-empty-state__actions">
              <button type="button" className="ghost-button" onClick={resetFilters}>
                Filtreleri Sıfırla
              </button>
            </div>
            <div className="pricing-empty-insights" role="note" aria-label="Sistem içgörüleri">
              <div>
                <strong>Son 7 günde fiyat önerisi oluşmadı</strong>
                <span>Fiyat dalgalanması aksiyon eşiğini aşmadı.</span>
              </div>
              <div>
                <strong>Stok devri stabil</strong>
                <span>Yavaşlayan veya aşırı hızlanan kritik ürün görünmüyor.</span>
              </div>
              <div>
                <strong>Riskli ürün bulunmuyor</strong>
                <span>SKT ve marj sinyalleri güvenli aralıkta.</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="table-wrapper pricing-action-table-wrapper">
              <table className="data-table" aria-label="Fiyat aksiyon tablosu">
                <thead>
                  <tr>
                    <th>
                        <input
                          type="checkbox"
                          aria-label="Tum satirlari sec"
                          checked={allSelected}
                          onChange={(event) => toggleAllSelection(event.target.checked)}
                        />
                    </th>
                    <th>Ürün</th>
                    <th>Kategori</th>
                    <th>Mevcut Fiyat</th>
                    <th>Önerilen Aksiyon</th>
                    <th>Risk Seviyesi</th>
                    <th>Marj / Satış / Stok Etkisi</th>
                    <th>Öneri Nedeni</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => {
                  const isExpanded = expandedRowId === row.id;
                  const isSelected = selectedIds.includes(row.id);
                  const dangerMargin = Number.isFinite(row.estimatedMarginPercent) && row.estimatedMarginPercent < 12;
                  const actionLabel = hasText(row.actionLabel) ? row.actionLabel : 'Aksiyon yok';
                  const riskLabel = hasText(row.riskLabel) ? row.riskLabel : toRiskLabel(row.riskLevel);
                  const reasonLabel = normalizeRecommendationReasonText(row.recommendationReason || row.reasonSummary) || 'Satış verisi sınırlı olduğu için güvenli öneri üretildi.';
                  const actionTone = row.actionType === 'urgent' ? 'danger' : row.actionType === 'discount' ? 'warning' : row.actionType === 'increase' ? 'primary' : row.actionType === 'none' ? 'neutral' : 'success';
                  const marginText = Number.isFinite(row.currentMarginPercent) && Number.isFinite(row.estimatedMarginPercent)
                    ? <>Marj: {formatPercent(row.currentMarginPercent)} → <span className={dangerMargin ? 'pricing-emphasis is-danger' : 'pricing-emphasis'}>{formatPercent(row.estimatedMarginPercent)}</span></>
                    : 'Marj: Hesaplanamadı';
                  const profitClass = Number.isFinite(row.impact?.profitImpact) && row.impact.profitImpact < 0 ? 'pricing-impact-negative' : 'pricing-impact-positive';
                  return (
                    <Fragment key={row.id}>
                      <tr className={`pricing-action-row pricing-action-row--${row.actionType || 'default'} ${row.actionType === 'urgent' ? 'pricing-row--urgent' : ''} ${isExpanded ? 'pricing-action-row--selected' : ''}`.trim()}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${toAsciiLabel(row.productName)} satirini sec`}
                            checked={isSelected}
                            onChange={(event) => toggleRowSelection(row.id, event.target.checked)}
                          />
                        </td>
                        <td>
                          <strong>
                            {row.isCatalogUnlisted ? <span className="product-new-badge">Yeni</span> : null}
                            {String(row.productName || '').trim() || 'Bilinmeyen ürün'}
                          </strong>
                          <div className="pricing-row-subtext">SKU: {String(row.sku || '').trim() || '-'}</div>
                          <div className="pricing-row-subtext">Tedarikçi: {String(row.supplierName || '').trim() || '-'}</div>
                          <ActionSparkline values={row.trend} />
                        </td>
                        <td>{String(row.category || '').trim() || '-'}</td>
                        <td>
                          <div>{formatCurrency(row.currentPrice)}</div>
                          <div className="pricing-emphasis">{formatCurrency(row.suggestedPrice)}</div>
                          <div className="pricing-row-subtext">
                            {row.priceChangePercent < 0 ? `${formatPercent(Math.abs(row.priceChangePercent))} indirim` : row.priceChangePercent > 0 ? `${formatPercent(row.priceChangePercent)} zam` : 'Değişim yok'}
                          </div>
                        </td>
                        <td>
                          <div className="pricing-action-cell">
                            {hasText(actionLabel) ? <StatusBadge tone={actionTone}>{actionLabel}</StatusBadge> : <span>Aksiyon yok</span>}
                            {row.actionSimulationText ? <div className="pricing-row-subtext">{row.actionSimulationText}</div> : null}
                          </div>
                        </td>
                        <td>
                          <div className="pricing-risk-cell">
                            {hasText(riskLabel) ? <StatusBadge tone={riskToneMap[row.riskLevel] || 'neutral'}>{riskLabel}</StatusBadge> : <StatusBadge tone="neutral">Belirsiz</StatusBadge>}
                            <div className="pricing-row-subtext">
                              SKT: {toSktLabel(row.expirationRisk)} | Satış: {row.salesSpeedKey === 'slow' ? 'Yavaş' : row.salesSpeedKey === 'fast' ? 'Hızlı' : row.salesSpeedKey === 'normal' ? 'Normal' : 'Belirsiz'}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="pricing-metric-stack">
                            <div className="pricing-mini-metric">
                              <span>Marj</span>
                              <strong>{marginText}</strong>
                            </div>
                            <div className="pricing-mini-metric">
                              <span>Satış</span>
                              <strong>{Number.isFinite(row.salesImpact) ? formatPercent(row.salesImpact) : 'Veri yok'}</strong>
                            </div>
                            <div className="pricing-mini-metric">
                              <span>Ciro</span>
                              <strong>{Number.isFinite(row.impact?.revenueImpact) ? formatSignedCurrency(row.impact.revenueImpact) : 'Veri yok'}</strong>
                            </div>
                            <div className={`pricing-mini-metric ${profitClass}`}>
                              <span>Kar</span>
                              <strong>{Number.isFinite(row.impact?.profitImpact) ? formatSignedCurrency(row.impact.profitImpact) : 'Kar etkisi hesaplanamadı'}</strong>
                            </div>
                            {Number.isFinite(row.stockEndEstimate) ? (
                              <div className="pricing-mini-metric">
                                <span>Stok bitiş</span>
                                <strong>{row.stockEndEstimate} gün</strong>
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div className="pricing-row-reason" title={reasonLabel}>{reasonLabel}</div>
                          <button
                            type="button"
                            className="ghost-button pricing-reason-toggle"
                            onClick={() => toggleRowDetail(row)}
                          >
                            {isExpanded ? 'Kapat' : 'Neden?'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="pricing-explanation-row pricing-explanation-row--selected">
                          <td colSpan={8}>
                            <div className="pricing-explanation">
                              {rowDetailLoadingId === row.id ? (
                                <div className="pricing-detail-loading">Satır detayı yükleniyor...</div>
                              ) : null}
                              <div className="pricing-explanation-summary">
                                <strong>Neden Bu Aksiyon Öneriliyor?</strong>
                                <p>{reasonLabel}</p>
                                {rowDetails[row.id] ? (
                                  <small>Fiyat geçmişi kayıtları: {Number(rowDetails[row.id]?.priceHistoryCount || 0)}</small>
                                ) : null}
                              </div>
                              <div className="pricing-explanation-grid">
                                <div>
                                  <strong>Stok / SKT</strong>
                                  <p>Stok: {Math.round(row.stockLevel)} | SKT: {formatDaysLabel(row.daysToExpiry)}</p>
                                </div>
                                <div>
                                  <strong>Satış Hızı / Devir</strong>
                                  <p>
                                    Günlük satış: {toSafeNumber(row.salesVelocity, 0).toFixed(1)} | Devir: {toSafeNumber(row.stockTurnoverRate, 0).toFixed(2)}
                                  </p>
                                </div>
                                <div>
                                  <strong>İndirim Simülasyonu</strong>
                                  <span className="sr-only">Indirim Simulasyonu</span>
                                  <div className="pricing-simulation-controls">
                                    {[10, 20, 30].map((value) => (
                                      <button
                                        key={value}
                                        type="button"
                                        className={`pricing-sim-chip ${Math.round(row.simulatedDiscount) === value ? 'is-active' : ''}`}
                                        onClick={() => updateSimulationDiscount(row.id, value)}
                                      >
                                        %{value}
                                      </button>
                                    ))}
                                    <input
                                      type="range"
                                      min="0"
                                      max="80"
                                      value={row.simulatedDiscount}
                                      onChange={(event) => updateSimulationDiscount(row.id, event.target.value)}
                                      aria-label={`${row.productName} indirim slider`}
                                    />
                                    <input
                                      type="number"
                                      min="0"
                                      max="80"
                                      value={Math.round(row.simulatedDiscount)}
                                      onChange={(event) => updateSimulationDiscount(row.id, event.target.value)}
                                      aria-label={`${row.productName} indirim kutusu`}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <BulkPriceUpdateModal
        isOpen={isBulkModalOpen}
        products={bulkModalProducts}
        categories={categories}
        labels={categoryLabels}
        onClose={() => setIsBulkModalOpen(false)}
        onApply={handleApplyBulkPriceUpdate}
        isApplying={bulkApplying}
      />

      <SellPriceAdvisorModal
        isOpen={isSellPriceModalOpen}
        rows={sellPriceRows}
        onClose={() => setIsSellPriceModalOpen(false)}
        onCalculate={handleCalculateSellPrice}
        onApprove={handleApproveSellPrice}
        calculation={sellPriceCalculation}
        isLoading={sellPriceLoading}
        isApproving={sellPriceApproving}
      />

      {toast.message ? <Toast toast={toast} onClose={() => setToast({ type: '', message: '' })} /> : null}
    </div>
  );
}

export default PricingAnalysis;
