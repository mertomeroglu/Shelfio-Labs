import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, BadgePercent, BarChart3, Boxes, Calculator, CheckCircle2, Clock3, Filter, Layers, MoreHorizontal, RefreshCw, Search, ShieldCheck, ShieldAlert, Sparkles, TrendingUp, X } from 'lucide-react';
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
import { usePricingFilters } from './hooks/usePricingFilters.js';
import PricingTablePagination from './components/PricingTablePagination.jsx';

const currency = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

const FILTER_DEFAULTS = {
  risk: '',
  sktStatus: '',
  salesSpeed: '',
  hasSuggestion: '',
  primaryAction: '',
  categoryId: '',
  supplierId: '',
  campaignEligibility: '',
  conflict: '',
  blockingReason: '',
  activeCampaignConflict: '',
  guardrail: '',
};

const SKT_STATUS_FILTER_VALUES = new Set(['safe', 'soon', 'critical']);

const normalizeSktStatusFilterValue = (value) => {
  const key = normalizeTextKey(value).replace(/[_\s-]+/g, '-');
  if (!key || ['all', 'tum', 'tum-durumlar', 'tüm-durumlar'].includes(key)) return '';
  if (['safe', 'normal', 'ok', 'guvenli', 'güvenli'].includes(key)) return 'safe';
  if (['soon', 'near', 'upcoming', 'yaklasiyor', 'yaklaşıyor', 'high'].includes(key)) return 'soon';
  if (['critical', 'kritik', 'expired', 'past-due', 'overdue'].includes(key)) return 'critical';
  return SKT_STATUS_FILTER_VALUES.has(key) ? key : '';
};

const isAllSktStatusesSelected = (value) => {
  if (!Array.isArray(value)) return false;
  const selected = new Set(value.map(normalizeSktStatusFilterValue).filter(Boolean));
  return SKT_STATUS_FILTER_VALUES.size > 0 && selected.size === SKT_STATUS_FILTER_VALUES.size;
};

const normalizeSktStatusFilter = (value) => {
  if (Array.isArray(value)) {
    if (!value.length || isAllSktStatusesSelected(value)) return '';
    return value.map(normalizeSktStatusFilterValue).filter(Boolean);
  }
  return normalizeSktStatusFilterValue(value);
};

const rowMatchesSktStatusFilter = (row, filterValue) => {
  const normalizedFilter = normalizeSktStatusFilter(filterValue);
  if (!normalizedFilter || (Array.isArray(normalizedFilter) && normalizedFilter.length === 0)) return true;

  const rowStatus = normalizeSktKey(row?.expirationRisk || row?.sktStatus || row?.expiryRisk || row?.expirationStatus, '');
  if (!rowStatus) return false;
  if (Array.isArray(normalizedFilter)) return normalizedFilter.includes(rowStatus);
  return rowStatus === normalizedFilter;
};

const PRICING_ACTION_TYPES = {
  DISCOUNT: 'discount_action',
  WATCH: 'watch_only',
  HOLD: 'hold_price',
  ORDER: 'order_priority',
  CAMPAIGN: 'campaign_candidate',
};

const PRICING_ACTION_LABELS = {
  [PRICING_ACTION_TYPES.DISCOUNT]: 'Aksiyon Gerekli',
  [PRICING_ACTION_TYPES.WATCH]: 'İzlenmeli',
  [PRICING_ACTION_TYPES.HOLD]: 'Fiyatı Koru',
  [PRICING_ACTION_TYPES.ORDER]: 'Sipariş Baskısı',
  [PRICING_ACTION_TYPES.CAMPAIGN]: 'Kampanya Adayı',
};

const PRESET_OPTIONS = [
  { id: PRICE_PRESETS.nearExpiry, label: 'SKT Yaklaşanlar', ariaLabel: 'SKT Yaklaşanlar' },
  { id: PRICE_PRESETS.slowSelling, label: 'Yavaş Satış', ariaLabel: 'Yavaş Satış' },
  { id: PRICE_PRESETS.overstocked, label: 'Aşırı Stok', ariaLabel: 'Aşırı Stok' },
  { id: PRICE_PRESETS.campaignEligible, label: 'Kampanyaya Alınabilir', ariaLabel: 'Kampanyaya Alınabilir' },
  { id: PRICE_PRESETS.conflicted, label: 'Çakışmalı', ariaLabel: 'Çakışmalı' },
  { id: PRICE_PRESETS.blocked, label: 'Bloklanan Öneriler', ariaLabel: 'Bloklanan Öneriler' },
];

const BULK_ACTIONS = {
  APPLY_DISCOUNT: 'apply-discount',
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

const PRICING_DECISION_ARCHIVE_STORAGE_KEY = 'shelfio.pricingAnalysis.decisionArchive.v1';

const BULK_ROUNDING_OPTIONS = [
  { value: 'none', label: 'Küsuratı koru' },
  { value: 'x99', label: 'x,99 ile bitir' },
  { value: 'integer', label: 'En yakın tam sayıya yuvarla' },
  { value: 'half', label: "En yakın 0,50'ye yuvarla" },
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
    single_price_approval: 'Tekil fiyat onayı',
    sell_price_advisor_modal: 'Ne Kadara Satmalıyım?',
    bulk_price_update_modal: 'Toplu fiyat güncelleme',
    price_action_rollback: 'Fiyat geri alma',
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
  [/\bexpiry[_\s-]*signal[_\s-]*ignored\b/gi, 'SKT sinyali dikkate alınmadı'],
  [/\bweak[_\s-]*demand\b/gi, 'Talep zayıf'],
  [/\bweak[_\s-]*replenishment\b/gi, 'Zayıf tedarik desteği'],
  [/\boverstock[_\s-]*risk\b/gi, 'Stok seviyesi yüksek'],
  [/\bactive[_\s-]*temporary[_\s-]*price[_\s-]*action\b/gi, 'Aktif geçici fiyat uygulaması'],
  [/\bno[_\s-]*active[_\s-]*campaign[_\s-]*conflict\b/gi, 'Kampanya çakışması yok'],
  [/\bmargin[_\s-]*guardrail[_\s-]*(passed|ok)\b/gi, 'Marj sınırı uygun'],
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
    .replace(/\bregular\b/gi, 'satış')
    .replace(/Efektif birim maliyet/gi, 'Tahmini birim maliyet')
    .replace(/Hedef marj/gi, 'Hedef kârlılık')
    .replace(/Beklenen marj/gi, 'Beklenen kârlılık')
    .replace(/Beklenen brüt kâr/gi, 'Tahmini brüt kâr')
    .replace(/Lojistik maliyeti/gi, 'Taşıma payı')
    .replace(/Operasyonel maliyet/gi, 'Mağaza operasyon payı')
    .replace(/Fire \/ SKT risk etkisi/gi, 'Fire ve SKT risk payı')
    .replace(/\bpurchasePrice\/cost\b/gi, 'ürün alış maliyeti')
    .replace(/\bpurchasePrice\b/gi, 'ürün alış maliyeti')
    .replace(/\bcost\b/gi, 'maliyet')
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
    return `${logisticsLabel} · yaklaşık ${caseCount} koli, toplam ${totalUnits} birim üzerinden`;
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
  if (['discount_action', 'aksiyon gerekli', 'action required'].includes(key)) return PRICING_ACTION_TYPES.DISCOUNT;
  if (['watch_only', 'izlenmeli', 'watch only', 'monitor'].includes(key)) return PRICING_ACTION_TYPES.WATCH;
  if (['hold_price', 'fiyati koru', 'fiyatı koru', 'price hold'].includes(key)) return PRICING_ACTION_TYPES.HOLD;
  if (['order_priority', 'siparis baskisi', 'sipariş baskısı', 'order priority'].includes(key)) return PRICING_ACTION_TYPES.ORDER;
  if (['campaign_candidate', 'kampanya adayi', 'kampanya adayı', 'campaign candidate'].includes(key)) return PRICING_ACTION_TYPES.CAMPAIGN;
  if (['urgent', 'acil', 'critical', 'kritik', 'acil indirim'].includes(key)) return 'urgent';
  if (['discount', 'indirim', 'markdown', 'price decrease', 'fiyat dusur', 'fiyat düşür'].includes(key)) return 'discount';
  if (['keep', 'koru', 'fiyat koruma', 'protect', 'no change'].includes(key)) return 'keep';
  if (['increase', 'zam', 'price increase', 'fiyat artir', 'fiyat artır'].includes(key)) return 'increase';
  if (['none', 'no action', 'aksiyon yok'].includes(key)) return 'none';
  return fallback;
};

const TEMPORARY_PRICE_DURATION_BY_RISK = {
  critical: 3,
  high: 7,
  medium: 14,
  low: 21,
};

const getTemporaryPriceDurationDays = (riskLevel) => TEMPORARY_PRICE_DURATION_BY_RISK[normalizeRiskKey(riskLevel)] || TEMPORARY_PRICE_DURATION_BY_RISK.medium;

const addDaysIso = (date, days) => {
  const base = date instanceof Date ? date : new Date(date || Date.now());
  return new Date(base.getTime() + Number(days || 0) * 24 * 60 * 60 * 1000).toISOString();
};

const formatDateShort = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const getTemporaryPriceValidity = (row = {}, referenceDate = new Date()) => {
  const durationDays = Number(row.durationDays || getTemporaryPriceDurationDays(row.riskLevel));
  const endAt = row.endAt || row.revertAt || addDaysIso(row.appliedAt || referenceDate, durationDays);
  return { durationDays, endAt };
};

const getArchivedDecisionStatus = (row = {}) => {
  const status = String(row.archiveStatus || row.activeTemporaryPriceAction?.status || row.temporaryPriceActionStatus || row.status || '').toLowerCase('tr-TR');
  const endAt = row.endAt ? new Date(row.endAt) : null;
  if (status === 'reverted') return { label: 'Geri alındı', tone: 'success' };
  if (status === 'replaced') return { label: 'Yerine yenisi geçti', tone: 'warning' };
  if (status === 'cancelled' || status === 'dismissed') return { label: row.archiveStatusLabel || 'Kapatıldı', tone: 'neutral' };
  if (status === 'expired' || (endAt && !Number.isNaN(endAt.getTime()) && endAt.getTime() <= Date.now())) return { label: 'Süresi doldu', tone: 'warning' };
  if (status === 'active') return { label: 'Uygulandı', tone: 'primary' };
  return { label: row.archiveStatusLabel || 'Uygulandı', tone: 'success' };
};

const formatPriceActionDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
};

const formatPriceActionTypeLabel = (value) => {
  const key = normalizeTextKey(value).replace(/\s+/g, '_');
  if (key === 'bulk_price_update') return 'Toplu fiyat güncelleme';
  if (key === 'single_price_approval') return 'Tekil fiyat onayı';
  return formatTechnicalSourceLabel(value, 'Fiyat işlemi');
};

const formatPriceActionStatusLabel = (action = {}) => {
  const status = String(action.status || '').trim();
  if (status === 'rolled_back') return { label: 'Geri alındı', tone: 'success' };
  if (status === 'partial_rollback') return { label: 'Kısmen geri alındı', tone: 'warning' };
  if (status === 'rollback_skipped') return { label: 'Geri alınamaz', tone: 'danger' };
  return { label: 'Uygulandı', tone: 'primary' };
};

const isRollbackDisabled = (action = {}) => ['rolled_back', 'partial_rollback', 'rollback_skipped'].includes(String(action.status || ''));

const hasCanonicalRecommendationPayload = (row = {}) => Boolean(
  row.discountSuggestion
  || row.orderSuggestion
  || row.suggestedAction
  || row.reasonCodes
  || row.blockingReasons
  || row.sourceMetrics
);

const getBlockingReasons = (row = {}, discountSuggestion = {}) => [
  ...(Array.isArray(row.blockingReasons) ? row.blockingReasons : []),
  ...(Array.isArray(discountSuggestion.blockingReasons) ? discountSuggestion.blockingReasons : []),
].filter(Boolean);

const hasActiveCampaignConflict = (row = {}) => Boolean(row.activeCampaignConflict || row.activeCampaignFlag || row.hasActiveDiscount);

const buildSystemActionModel = ({ merged = {}, fallbackActionType = 'keep', suggestedDiscount = 0 }) => {
  const discountSuggestion = merged.discountSuggestion && typeof merged.discountSuggestion === 'object' ? merged.discountSuggestion : {};
  const orderSuggestion = merged.orderSuggestion && typeof merged.orderSuggestion === 'object' ? merged.orderSuggestion : {};
  const blockingReasons = getBlockingReasons(merged, discountSuggestion);
  const isSuppressed = Boolean(merged.isSuppressed || discountSuggestion.isSuppressed || blockingReasons.length);
  const primaryAction = normalizeActionKey(
    merged.primaryAction || discountSuggestion.primaryAction,
    '',
  );

  if (primaryAction === PRICING_ACTION_TYPES.DISCOUNT) {
    return { actionType: PRICING_ACTION_TYPES.DISCOUNT, actionLabel: PRICING_ACTION_LABELS[primaryAction], tone: 'warning', campaignEligible: true, campaignLabel: 'Fiyat aksiyonu gerekli' };
  }
  if (primaryAction === PRICING_ACTION_TYPES.ORDER) {
    return { actionType: PRICING_ACTION_TYPES.ORDER, actionLabel: PRICING_ACTION_LABELS[primaryAction], tone: 'danger', campaignEligible: false, campaignLabel: 'Önce sipariş aksiyonu' };
  }
  if (primaryAction === PRICING_ACTION_TYPES.CAMPAIGN) {
    return { actionType: PRICING_ACTION_TYPES.CAMPAIGN, actionLabel: PRICING_ACTION_LABELS[primaryAction], tone: 'primary', campaignEligible: true, campaignLabel: 'Kampanyaya alınabilir' };
  }
  if (primaryAction === PRICING_ACTION_TYPES.WATCH) {
    return { actionType: PRICING_ACTION_TYPES.WATCH, actionLabel: PRICING_ACTION_LABELS[primaryAction], tone: 'neutral', campaignEligible: false, campaignLabel: 'Fiyat değişikliği yok' };
  }
  if (primaryAction === PRICING_ACTION_TYPES.HOLD) {
    return { actionType: PRICING_ACTION_TYPES.HOLD, actionLabel: PRICING_ACTION_LABELS[primaryAction], tone: 'success', campaignEligible: false, campaignLabel: 'Kampanya gerekmiyor' };
  }

  if (isSuppressed) {
    if (blockingReasons.includes('active_campaign_conflict')) {
      return { actionType: PRICING_ACTION_TYPES.WATCH, actionLabel: 'Kampanya Aktif', tone: 'neutral', campaignEligible: false, campaignLabel: 'Taslak gerekmez' };
    }
    if (blockingReasons.some((reason) => reason.includes('margin') || reason.includes('cost'))) {
      return { actionType: PRICING_ACTION_TYPES.HOLD, actionLabel: 'Marjı Koru', tone: 'warning', campaignEligible: false, campaignLabel: 'Kampanyaya alınamaz' };
    }
    if (blockingReasons.some((reason) => reason.includes('stock') || reason.includes('replenishment') || reason.includes('lead_time') || reason.includes('receipt'))) {
      return { actionType: PRICING_ACTION_TYPES.ORDER, actionLabel: PRICING_ACTION_LABELS[PRICING_ACTION_TYPES.ORDER], tone: 'danger', campaignEligible: false, campaignLabel: 'Önce stok güvenceye alınmalı' };
    }
    return { actionType: PRICING_ACTION_TYPES.WATCH, actionLabel: PRICING_ACTION_LABELS[PRICING_ACTION_TYPES.WATCH], tone: 'warning', campaignEligible: false, campaignLabel: 'Kontrol kuralı var' };
  }

  if (discountSuggestion.hasSuggestion || suggestedDiscount > 0) {
    return { actionType: PRICING_ACTION_TYPES.DISCOUNT, actionLabel: PRICING_ACTION_LABELS[PRICING_ACTION_TYPES.DISCOUNT], tone: 'warning', campaignEligible: true, campaignLabel: 'Fiyat aksiyonu gerekli' };
  }
  if (orderSuggestion.hasSuggestion) {
    return { actionType: PRICING_ACTION_TYPES.ORDER, actionLabel: PRICING_ACTION_LABELS[PRICING_ACTION_TYPES.ORDER], tone: 'danger', campaignEligible: false, campaignLabel: 'Önce sipariş aksiyonu' };
  }
  if (merged.marginGuardrailFlag || merged.marginGuardrail?.blocksDiscount) {
    return { actionType: PRICING_ACTION_TYPES.HOLD, actionLabel: 'Marjı Koru', tone: 'warning', campaignEligible: false, campaignLabel: 'Kampanyaya alınamaz' };
  }
  if (fallbackActionType === 'increase') {
    return { actionType: 'increase', actionLabel: 'Fiyatı Gözden Geçir', tone: 'primary', campaignEligible: false, campaignLabel: 'Kampanya değil fiyat aksiyonu' };
  }
  return { actionType: PRICING_ACTION_TYPES.HOLD, actionLabel: PRICING_ACTION_LABELS[PRICING_ACTION_TYPES.HOLD], tone: 'success', campaignEligible: false, campaignLabel: 'Kampanya gerekmiyor' };
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
    categoryId: String(product?.categoryId || product?.productCategoryId || product?.category?.id || '').trim(),
    supplierId: String(product?.supplierId || product?.supplier?.id || '').trim(),
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
    ['recommendedDiscountRate', 'suggestedDiscountRate', 'suggestedDiscount', 'discountRate', 'discountPercent', 'actionPercent'],
    discountSuggestion.recommendedDiscountRate ?? discountSuggestion.discountRate,
  );
  const suggestedDiscount = clampPercent(rawDiscount);
  const computedActionType = classifyActionType({
    discountPercent: suggestedDiscount,
    expirationRisk,
    salesVelocity,
    stock: stockLevel,
  });
  const hasBackendPayload = hasCanonicalRecommendationPayload(merged);
  const normalizedActionType = hasBackendPayload
    ? computedActionType
    : normalizeActionKey(
      getFirstValue(merged, ['actionType', 'suggestedAction', 'recommendedAction', 'actionSuggestion']),
      computedActionType,
    );
  const systemAction = buildSystemActionModel({ merged, fallbackActionType: normalizedActionType, suggestedDiscount });
  const currentMarginPercent = calculateMarginPercent(currentPrice, cost);
  const riskScoreFromSource = getOptionalNumber(getFirstValue(merged, ['riskScore', 'score']));
  const riskScore = Number.isFinite(riskScoreFromSource)
    ? Math.max(0, Math.min(100, Math.round(riskScoreFromSource)))
    : buildFallbackRiskScore({ daysToExpiry, stockLevel, salesVelocity, stockTurnoverRate, expirationRisk });
  const riskLevel = normalizeRiskKey(
    getFirstValue(merged, ['riskLevel', 'risk', 'riskStatus']),
    getRiskLevelFromScore(riskScore),
  );
  const simulationAction = getActionModel({
    currentPrice,
    actionType: suggestedDiscount > 0 ? PRICING_ACTION_TYPES.DISCOUNT : systemAction.actionType,
    actionPercent: suggestedDiscount,
    suggestedPrice: getFirstValue(merged, ['suggestedPrice', 'newPrice'], discountSuggestion.newPrice),
  });
  const trendSource = Array.isArray(merged.salesTrendLast14Days)
    ? merged.salesTrendLast14Days
    : Array.isArray(merged.salesTrend)
      ? merged.salesTrend
      : Array.isArray(merged.trend) ? merged.trend : [];
  const trend = trendSource.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const estimatedMarginPercent = calculateMarginPercent(simulationAction.suggestedPrice, cost);

  const row = {
    id,
    productId: merged.productId || id,
    productName: hasText(merged.productName || merged.name) ? String(merged.productName || merged.name).trim() : 'Bilinmeyen ürün',
    categoryId: String(merged.categoryId || merged.productCategoryId || merged.category?.id || '').trim(),
    supplierId: String(merged.supplierId || merged.supplier?.id || '').trim(),
    sku: hasText(merged.sku || merged.barcode) ? String(merged.sku || merged.barcode).trim() : '-',
    supplierName: hasText(merged.supplierName || merged.supplier?.name) ? String(merged.supplierName || merged.supplier?.name).trim() : 'Tedarikçi bilgisi yok',
    categoryName: hasText(merged.categoryName || merged.category || merged.category?.name) ? String(merged.categoryName || merged.category || merged.category?.name).trim() : 'Kategori yok',
    category: hasText(merged.categoryName || merged.category || merged.category?.name) ? String(merged.categoryName || merged.category || merged.category?.name).trim() : 'Kategori yok',
    currentPrice,
    cost,
    suggestedPrice: simulationAction.suggestedPrice,
    suggestedDiscount: simulationAction.actionPercent,
    simulatedDiscount: simulationAction.actionPercent,
    primaryAction: systemAction.actionType,
    actionType: systemAction.actionType,
    sourceRecommendationKey: String(merged.sourceRecommendationKey || '').trim(),
    actionLabel: systemAction.actionLabel,
    actionTone: systemAction.tone,
    actionPercent: suggestedDiscount,
    actionSimulationText: simulationAction.simulationText,
    priceChangePercent: simulationAction.priceChangePercent,
    campaignEligible: systemAction.campaignEligible,
    campaignLabel: systemAction.campaignLabel,
    activeTemporaryPriceAction: merged.activeTemporaryPriceAction || merged.temporaryPriceAction || null,
    hasActiveTemporaryPriceAction: Boolean(merged.hasActiveTemporaryPriceAction || merged.activeTemporaryPriceAction || merged.temporaryPriceAction),
    temporaryPriceActionStatus: merged.temporaryPriceActionStatus || merged.activeTemporaryPriceAction?.status || merged.temporaryPriceAction?.status || '',
    blockingReasons: getBlockingReasons(merged, discountSuggestion),
    reasonCodes: Array.isArray(merged.reasonCodes) ? merged.reasonCodes : (Array.isArray(discountSuggestion.reasonCodes) ? discountSuggestion.reasonCodes : []),
    isSuppressed: Boolean(merged.isSuppressed || discountSuggestion.isSuppressed),
    suppressionReason: merged.suppressionReason || discountSuggestion.suppressionReason || '',
    activeCampaignConflict: merged.activeCampaignConflict || discountSuggestion.activeCampaignConflict || null,
    activeCampaignFlag: Boolean(merged.activeCampaignFlag || discountSuggestion.activeCampaignFlag || merged.hasActiveDiscount),
    lowStockGuardrailFlag: Boolean(merged.lowStockGuardrailFlag || discountSuggestion.lowStockGuardrailFlag),
    marginGuardrailFlag: Boolean(merged.marginGuardrailFlag || discountSuggestion.marginGuardrailFlag),
    replenishmentSupportFlag: Boolean(merged.replenishmentSupportFlag || discountSuggestion.replenishmentSupportFlag),
    stockGuardrail: merged.stockGuardrail || discountSuggestion.stockGuardrail || null,
    procurementGuardrail: merged.procurementGuardrail || discountSuggestion.procurementGuardrail || null,
    marginGuardrail: merged.marginGuardrail || discountSuggestion.marginGuardrail || null,
    sourceMetrics: merged.sourceMetrics || discountSuggestion.sourceMetrics || {},
    sold7: toSafeNumber(getFirstValue(merged, ['sold7', 'salesLast7Days'], discountSuggestion.sourceMetrics?.sold7), 0),
    sold30: toSafeNumber(getFirstValue(merged, ['sold30', 'salesLast30Days'], discountSuggestion.sourceMetrics?.sold30), 0),
    trendDirection: getFirstValue(merged, ['trendDirection'], discountSuggestion.sourceMetrics?.trendDirection || 'flat'),
    lastPriceChangeDate: getFirstValue(merged, ['lastPriceChangeDate', 'lastPriceChangeAt'], ''),
    originalPrice: normalizePrice(getFirstValue(merged, ['originalPrice', 'salePrice'], currentPrice)),
    discountedPrice: getOptionalNumber(getFirstValue(merged, ['discountedPrice', 'campaignPrice'])),
    hasActiveDiscount: Boolean(merged.hasActiveDiscount || merged.activeCampaignFlag || discountSuggestion.activeCampaignFlag),
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

  let riskReason = 'Satış fiyatı kârlılık açısından uygun görünüyor';
  if (campaignLoss) riskReason = 'Aktif kampanya zarar riski oluşturuyor';
  else if (campaignLowMargin) riskReason = 'Aktif kampanya kârlılığı zayıflatıyor';
  else if (regularLoss) riskReason = 'Yeni satış fiyatı alış maliyetinin altında kalıyor';
  else if (regularLowMargin) riskReason = `Yeni satış fiyatı güvenli kârlılık sınırının altında kalıyor`;

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
      return `${summary.campaignRiskCount} üründe aktif kampanya fiyatı alış maliyetinin altına düşüyor. Satış fiyatı güncellemesi ayrı hesaplandı; risk kampanya fiyatından kaynaklanıyor.`;
    }
    return `${summary.campaignRiskCount} üründe aktif kampanya güvenli kârlılık sınırının altında kalıyor. Satış fiyatı güncellemesi ayrı hesaplandı.`;
  }
  if (summary.regularRiskCount > 0 && summary.campaignRiskCount > 0) {
    return `${summary.regularRiskCount} üründe yeni satış fiyatı, ${summary.campaignRiskCount} üründe aktif kampanya kârlılık riski taşıyor.`;
  }
  if (summary.regularLossCount > 0) return `${summary.regularRiskCount} üründe yeni satış fiyatı alış maliyetinin altında kalıyor.`;
  return `${summary.regularRiskCount} üründe yeni satış fiyatı güvenli kârlılık sınırının altında kalıyor.`;
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

  if (['urgent', 'discount', PRICING_ACTION_TYPES.DISCOUNT].includes(actionType) && percent > 0 && current > 0) {
    const nextPrice = normalizePrice(current * (1 - percent / 100));
    return {
      actionType,
      actionLabel: `%${Math.round(percent)} indirim önerisi`,
      actionPercent: percent,
      suggestedPrice: nextPrice,
      priceChangePercent: -percent,
      simulationText: `${formatCurrency(current)} → ${formatCurrency(nextPrice)} (${formatPercent(percent)} indirim)`,
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
      simulationText: `${formatCurrency(current)} → ${formatCurrency(nextPrice)} (${formatPercent(percent)} zam)`,
    };
  }

  const nextPrice = normalizedSuggested > 0 ? normalizedSuggested : current;
  const stableActionType = actionType === 'none' ? 'none' : actionType || PRICING_ACTION_TYPES.HOLD;
  return {
    actionType: stableActionType,
    actionLabel: actionType === 'none' ? 'Aksiyon yok' : (PRICING_ACTION_LABELS[stableActionType] || 'Fiyat koruma'),
    actionPercent: 0,
    suggestedPrice: nextPrice,
    priceChangePercent: 0,
    simulationText: nextPrice > 0 ? `${formatCurrency(nextPrice)} korunur` : 'Fiyat verisi yok',
  };
};

const TECHNICAL_REASON_LABELS = {
  active_campaign_conflict: 'Aktif kampanya çakışması',
  low_margin: 'Düşük marj',
  price_at_or_below_cost: 'Fiyat maliyet sınırında',
  weak_demand: 'Zayıf talep',
  weak_replenishment: 'Zayıf tedarik desteği',
  overstock_risk: 'Fazla stok riski',
  overstock: 'Fazla stok riski',
  stock_level_high: 'Stok seviyesi yüksek',
  expiry_risk: 'SKT riski',
  near_expiry: 'SKT riski',
  expiry_signal_ignored: 'SKT sinyali dikkate alınmadı',
  critical_stock: 'Kritik stok',
  near_critical_fast_moving: 'Hızlı satış ve düşük stok',
  low_stock_coverage: 'Stok karşılama süresi düşük',
  replenishment_pipeline_missing: 'Tedarik hattı zayıf',
  long_lead_time: 'Tedarik süresi uzun',
  goods_receipt_pending_not_secured: 'Mal kabul güvenceye alınmamış',
  active_temporary_price_action: 'Aktif geçici fiyat uygulaması',
  order_priority_guardrail: 'Önce sipariş aksiyonu gerekli',
  stock_guardrail_blocked: 'Stok kontrol kuralı',
  replenishment_guardrail_blocked: 'Tedarik kontrol kuralı',
  margin_guardrail_blocked: 'Marj kontrol kuralı',
  margin_guardrail_passed: 'Marj sınırı uygun',
  slow_sales: 'Zayıf talep',
  weak_sales_velocity: 'Talep zayıf',
  demand_down: 'Talep düşüşte',
  no_active_campaign_conflict: 'Kampanya çakışması yok',
  no_data: 'Veri yetersiz',
  guardrail: 'Kontrol kuralı',
  simulation: 'Etki simülasyonu',
};

const normalizeReasonCodeLabel = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = raw.toLocaleLowerCase('tr-TR').replace(/\s+/g, '_');
  if (TECHNICAL_REASON_LABELS[key]) return TECHNICAL_REASON_LABELS[key];
  return formatUserFacingTechnicalText(raw.replaceAll('_', ' '), 'Veri yetersiz');
};

const buildDecisionReasons = (row = {}, limit = 2) => {
  const reasons = [
    ...(Array.isArray(row.blockingReasons) ? row.blockingReasons : []),
    ...(Array.isArray(row.reasonCodes) ? row.reasonCodes : []),
  ].map(normalizeReasonCodeLabel).filter(Boolean);

  if (row.hasActiveDiscount || row.activeCampaignFlag) reasons.push('Aktif kampanya var');
  if (row.marginGuardrailFlag || row.marginGuardrail?.blocksDiscount) reasons.push('Marj düşük');
  if (row.lowStockGuardrailFlag || row.stockGuardrail?.blocksDiscount) reasons.push('Stok kontrolü gerekli');
  if (row.expirationRisk === 'critical' || row.expirationRisk === 'soon') reasons.push('SKT riski yüksek');
  if (row.salesSpeedKey === 'slow' && Number(row.stockLevel || 0) >= 40) reasons.push('Talep zayıf, stok yüksek');

  if (!reasons.length) {
    const text = normalizeRecommendationReasonText(row.recommendationReason || row.reasonSummary || row.reason || '');
    if (text) reasons.push(text.split(/[.!?]/).map((item) => item.trim()).filter(Boolean)[0]);
  }

  const seen = new Set();
  return reasons
    .map((item) => String(item || '').trim())
    .filter((item) => {
      const key = normalizeTextKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
};

const getDecisionActionLabel = (row = {}) => {
  if (row.hasActiveDiscount || row.activeCampaignFlag || getBlockingReasons(row).includes('active_campaign_conflict')) return 'Kampanya aktif';
  if ([PRICING_ACTION_TYPES.DISCOUNT, 'discount', 'urgent'].includes(row.actionType)) return 'İndirim öner';
  if (row.actionType === 'increase') return 'Fiyat artır';
  if (row.actionType === PRICING_ACTION_TYPES.HOLD) return 'Fiyat koru';
  if ([PRICING_ACTION_TYPES.ORDER, PRICING_ACTION_TYPES.WATCH, 'none'].includes(row.actionType)) return 'İşlem önerilmez';
  return row.suggestedDiscount > 0 ? 'İndirim öner' : 'Fiyat koru';
};

const getDecisionRisk = (row = {}) => {
  const risk = normalizeRiskKey(row.riskLevel, 'medium');
  if (risk === 'critical' || risk === 'high') return { key: 'high', label: 'Yüksek', tone: 'danger' };
  if (risk === 'medium') return { key: 'medium', label: 'Orta', tone: 'warning' };
  return { key: 'low', label: 'Düşük', tone: 'success' };
};

const getPriceChangeLabel = (row = {}) => {
  const change = toSafeNumber(row.priceChangePercent, NaN);
  if (!Number.isFinite(change) || change === 0) return '%0';
  const sign = change > 0 ? '+' : '';
  return `${sign}${formatPercent(change)}`;
};

const getPricingDecisionKey = (row = {}) => {
  const backendKey = String(row.sourceRecommendationKey || '').trim();
  if (backendKey) return backendKey;
  return [
    row.productId || row.product?.id || row.id || '',
    row.actionType || '',
    normalizePrice(row.currentPrice),
    normalizePrice(row.suggestedPrice),
  ].map((part) => String(part ?? '').trim()).join('|');
};

const getPricingDecisionProductKey = (row = {}) => String(row.productId || row.id || row.product?.id || '').trim();

const ACTIVE_TEMPORARY_PRICE_STATUSES = new Set(['active']);

const hasActiveTemporaryPriceAction = (row = {}) => {
  const action = row.activeTemporaryPriceAction || row.temporaryPriceAction || null;
  const status = String(action?.status || row.temporaryPriceActionStatus || '').trim().toLowerCase('tr-TR');
  return Boolean(row.hasActiveTemporaryPriceAction || (action && (!status || ACTIVE_TEMPORARY_PRICE_STATUSES.has(status))));
};

const isActivePricingDecision = (row = {}) => {
  if (row.isLocallyApplied) return false;
  if (hasActiveTemporaryPriceAction(row)) return false;
  return true;
};

const readPricingDecisionArchive = () => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(PRICING_DECISION_ARCHIVE_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writePricingDecisionArchive = (archive = {}) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PRICING_DECISION_ARCHIVE_STORAGE_KEY, JSON.stringify(archive));
  } catch {
    // Session storage may be unavailable; the in-memory state still drives the current view.
  }
};

const hasApplicablePriceDelta = (row = {}) => {
  const currentPrice = normalizePrice(row.currentPrice);
  const suggestedPrice = normalizePrice(row.suggestedPrice);
  if (!currentPrice || !suggestedPrice) return false;
  return Math.round(currentPrice * 100) !== Math.round(suggestedPrice * 100);
};

const canApplyPricingDecision = (row = {}) => (
  row.actionType === PRICING_ACTION_TYPES.DISCOUNT && !hasActiveTemporaryPriceAction(row) && hasApplicablePriceDelta(row)
);

const getPassiveDecisionActionText = (row = {}) => {
  if (hasActiveTemporaryPriceAction(row)) return 'Aktif uygulama var';
  if (row.actionType === PRICING_ACTION_TYPES.WATCH) return 'Takipte';
  if (row.actionType === PRICING_ACTION_TYPES.HOLD) return 'Fiyatı Koru';
  if (row.actionType === PRICING_ACTION_TYPES.ORDER) return 'Sipariş baskısı';
  if (row.actionType === PRICING_ACTION_TYPES.CAMPAIGN) return 'Kampanya adayı';
  if (!normalizePrice(row.suggestedPrice)) return 'Önerilen fiyat yok';
  if (!hasApplicablePriceDelta(row)) return 'Fiyat değişikliği yok';
  return 'Aksiyon yok';
};

const getPassiveDecisionHelpText = (row = {}) => {
  if (canApplyPricingDecision(row) || row.isLocallyApplied) return '';
  if (row.actionType === PRICING_ACTION_TYPES.DISCOUNT) return 'Bu kayıt şu an uygulanamaz';
  return 'Bu kayıt bilgilendirme amaçlıdır';
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
    actionType: simulatedDiscount > 0 ? PRICING_ACTION_TYPES.DISCOUNT : row.actionType,
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
    simulationLabel: simulatedAction.actionLabel,
    simulationPercent: simulatedAction.actionPercent,
    simulationText: simulatedAction.simulationText,
    simulationPriceChangePercent: simulatedAction.priceChangePercent,
    actionPercent: row.actionPercent,
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

function PricingActionDetailModal({
  row,
  detail,
  isLoading,
  isApplying = false,
  onClose,
  onApply,
  onSkip,
}) {
  if (!row) return null;

  const currentMargin = Number.isFinite(row.currentMarginPercent) ? formatPercent(row.currentMarginPercent) : 'Hesaplanamadı';
  const nextMargin = Number.isFinite(row.estimatedMarginPercent) ? formatPercent(row.estimatedMarginPercent) : 'Hesaplanamadı';
  const risk = getDecisionRisk(row);
  const reasons = buildDecisionReasons(row, 8);
  const guardrailReasons = [
    ...(Array.isArray(row.blockingReasons) ? row.blockingReasons : []),
    ...(Array.isArray(row.marginGuardrail?.blockingReasons) ? row.marginGuardrail.blockingReasons : []),
    ...(Array.isArray(row.stockGuardrail?.blockingReasons) ? row.stockGuardrail.blockingReasons : []),
    ...(Array.isArray(row.procurementGuardrail?.blockingReasons) ? row.procurementGuardrail.blockingReasons : []),
  ].map(normalizeReasonCodeLabel).filter(Boolean);
  const uniqueGuardrailReasons = [...new Set(guardrailReasons)];
  const profitClass = Number.isFinite(row.impact?.profitImpact) && row.impact.profitImpact < 0 ? 'is-negative' : 'is-positive';
  const priceHistory = Array.isArray(detail?.priceHistory) ? detail.priceHistory.slice(0, 3) : [];
  const actionLabel = getDecisionActionLabel(row);
  const criticalStockValue = toSafeNumber(row.criticalStock, NaN);
  const activeCampaignLabel = row.campaignName || row.activeCampaignName || row.activeCampaign?.name || (row.hasActiveDiscount || row.activeCampaignFlag ? 'Var' : 'Yok');
  const campaignConflictLabel = getBlockingReasons(row).includes('active_campaign_conflict') || row.activeCampaignConflict ? 'Var' : 'Yok';
  const costRiskLabel = getBlockingReasons(row).includes('price_at_or_below_cost') ? 'Var' : 'Yok';
  const marginLimitLabel = row.marginGuardrailFlag || row.marginGuardrail?.blocksDiscount ? 'Kontrol gerekli' : 'Marj sınırı uygun';
  const guardrailSummary = uniqueGuardrailReasons.length
    ? uniqueGuardrailReasons.map(normalizeReasonCodeLabel)
    : ['Kontrol kuralı engeli yok'];
  const priceHistoryCount = Number(detail?.priceHistoryCount || row.priceHistoryCount || 0);
  const lastManualPriceChange = row.lastManualPriceChangeAt || row.lastManualPriceChangeDate || detail?.lastManualPriceChangeAt || detail?.lastManualPriceChangeDate;
  const stateBadgeClass = (value) => {
    const normalized = String(value || '').toLocaleLowerCase('tr-TR');
    if (normalized.includes('var') || normalized.includes('kontrol')) return 'is-warning';
    if (normalized.includes('yok') || normalized.includes('uygun')) return 'is-muted';
    return 'is-neutral';
  };
  const renderStateBadge = (value) => (
    <span className={`pricing-detail-state-badge ${stateBadgeClass(value)}`}>{value}</span>
  );

  return (
    <div className="pricing-modal-backdrop" role="presentation">
      <section className="pricing-bulk-modal pricing-action-detail-modal" role="dialog" aria-modal="true" aria-labelledby="pricing-action-detail-title">
        <header className="pricing-bulk-modal-head pricing-action-detail-head">
          <div className="pricing-action-detail-titlemark">
            <div className="pricing-action-detail-icon" aria-hidden="true"><Boxes size={18} /></div>
            <div className="pricing-action-detail-titlecopy">
              <h2 id="pricing-action-detail-title">{row.productName || 'Ürün detayı'}</h2>
              <p><span>SKU: {row.sku || '-'}</span><span>{row.category || row.categoryName || '-'}</span></p>
            </div>
          </div>
          <button type="button" className="ghost-button pricing-modal-close" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </header>

        <div className="pricing-bulk-modal-body pricing-action-detail-body">
          {isLoading ? <div className="pricing-detail-loading">Detay bilgileri yükleniyor...</div> : null}

          <section className="pricing-detail-section">
            <div className="pricing-detail-section-head"><h3>Fiyat Özeti</h3></div>
            <div className="pricing-detail-metrics pricing-detail-metrics--price">
              <div><span>Mevcut satış fiyatı</span><strong>{formatCurrency(row.currentPrice)}</strong></div>
              <div><span>Alış fiyatı</span><strong>{formatCurrency(row.cost)}</strong></div>
              <div><span>Önerilen fiyat</span><strong>{formatCurrency(row.suggestedPrice)}</strong></div>
              <div><span>Değişim</span><strong>{getPriceChangeLabel(row)}</strong></div>
              <div><span>Marj önce</span><strong>{currentMargin}</strong></div>
              <div><span>Marj sonra</span><strong>{nextMargin}</strong></div>
            </div>
          </section>

          <section className="pricing-detail-section">
            <div className="pricing-detail-section-head"><h3>Talep ve Stok Özeti</h3></div>
            <div className="pricing-detail-metrics">
              <div><span>7 gün satış</span><strong>{toSafeNumber(row.sold7, 0)}</strong></div>
              <div><span>30 gün satış</span><strong>{toSafeNumber(row.sold30, 0)}</strong></div>
              <div><span>Mevcut stok</span><strong>{Math.round(toSafeNumber(row.stockLevel, 0))}</strong></div>
              <div><span>Kritik stok</span><strong>{Number.isFinite(criticalStockValue) ? Math.round(criticalStockValue) : 'Kayıt yok'}</strong></div>
              <div><span>SKT durumu</span><strong>{toSktLabel(row.expirationRisk)}</strong></div>
              <div><span>Stok riski</span><StatusBadge tone={risk.tone}>{risk.label}</StatusBadge></div>
            </div>
          </section>

          <section className="pricing-detail-section">
            <div className="pricing-detail-section-head"><h3>Kampanya ve Kural Kontrolleri</h3></div>
            <div className="pricing-detail-checks">
              <div><span>Aktif kampanya</span><strong>{renderStateBadge(activeCampaignLabel)}</strong></div>
              <div><span>Kampanya çakışması</span><strong>{renderStateBadge(campaignConflictLabel)}</strong></div>
              <div><span>Maliyet altı riski</span><strong>{renderStateBadge(costRiskLabel)}</strong></div>
              <div><span>Marj sınırı</span><strong>{renderStateBadge(marginLimitLabel)}</strong></div>
            </div>
            <div className="pricing-detail-reason-list">
              {guardrailSummary.map((item) => <span key={item}>{item}</span>)}
            </div>
          </section>

          <section className="pricing-detail-section">
            <div className="pricing-detail-section-head"><h3>Sistem Gerekçesi</h3></div>
            <ul className="pricing-detail-bullets">
              {(reasons.length ? reasons : ['Veri yetersiz olduğu için güvenli öneri üretildi.']).map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section className="pricing-detail-section">
            <div className="pricing-detail-section-head"><h3>Operasyonel Etki</h3></div>
            <div className="pricing-detail-metrics">
              <div><span>Kar etkisi</span><strong className={profitClass}>{Number.isFinite(row.impact?.profitImpact) ? formatSignedCurrency(row.impact.profitImpact) : 'Veri yok'}</strong></div>
              <div><span>Satış etkisi tahmini</span><strong>{Number.isFinite(row.impact?.estimatedSalesIncreasePct) ? `${formatPercent(row.impact.estimatedSalesIncreasePct)}` : 'Veri yok'}</strong></div>
              <div><span>Stok eritme etkisi</span><strong>{Number.isFinite(row.impact?.depletionDays) ? `${row.impact.depletionDays} gün` : 'Veri yok'}</strong></div>
              <div><span>Öneri</span><strong>{actionLabel}</strong></div>
            </div>
          </section>

          <section className="pricing-detail-section">
            <div className="pricing-detail-section-head"><h3>Geçmiş / Ek Bilgi</h3></div>
            <div className="pricing-detail-metrics">
              <div><span>FDT</span><strong>{row.lastPriceChangeDate ? String(row.lastPriceChangeDate).slice(0, 10) : 'Kayıt yok'}</strong></div>
              <div><span>Fiyat geçmişi</span><strong>{priceHistoryCount ? `${priceHistoryCount} kayıt` : 'Kayıt yok'}</strong></div>
              <div><span>Son kampanya</span><strong>{row.campaignName || row.activeCampaignName || 'Yok'}</strong></div>
              <div><span>Son manuel fiyat müdahalesi</span><strong>{lastManualPriceChange ? String(lastManualPriceChange).slice(0, 10) : 'Kayıt yok'}</strong></div>
            </div>
            {priceHistory.length ? (
              <div className="pricing-detail-history">
                {priceHistory.map((item, index) => (
                  <span key={`${item.id || item.createdAt || index}`}>{String(item.createdAt || item.date || '').slice(0, 10) || '-'} · {formatCurrency(item.salePrice || item.price || item.newPrice || 0)}</span>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="pricing-bulk-modal-foot pricing-action-detail-foot">
          <button type="button" className="ghost-button pricing-detail-close-button" onClick={onClose}>Kapat</button>
          <div className="pricing-action-detail-foot-actions">
            <button type="button" className="ghost-button pricing-detail-skip-button" onClick={() => onSkip(row)}>Pas geç</button>
            <button type="button" className="primary-button pricing-detail-apply-button" onClick={() => onApply(row)} disabled={isApplying}>
              {isApplying ? 'Uygulanıyor...' : 'Uygula'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function PriceActionHistoryPanel({
  actions = [],
  isLoading = false,
  rollbackPendingId = '',
  onRollback,
}) {
  return (
    <section className="pricing-recent-actions" aria-label="Son fiyat işlemleri">
      <div className="pricing-recent-actions-head">
        <div>
          <h3>Son İşlemler</h3>
          <p>Bu ekrandan yapılan son 3 fiyat değişikliğini buradan geri alabilirsiniz.</p>
        </div>
      </div>
      {isLoading ? (
        <div className="pricing-recent-actions-empty">Son fiyat işlemleri yükleniyor...</div>
      ) : actions.length ? (
        <div className="pricing-recent-actions-list">
          {actions.slice(0, 3).map((action) => {
            const status = formatPriceActionStatusLabel(action);
            const rollbackDisabled = isRollbackDisabled(action) || rollbackPendingId === action.id;
            return (
              <article key={action.id} className="pricing-recent-action-card">
                <div className="pricing-recent-action-main">
                  <div>
                    <strong>{formatPriceActionTypeLabel(action.type)}</strong>
                    <span>{formatPriceActionDate(action.createdAt)} · {action.scopeLabel || action.scope?.label || 'Kapsam bilgisi yok'}</span>
                  </div>
                  <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                </div>
                <div className="pricing-recent-action-meta">
                  <span>{Number(action.affectedProductCount || 0)} ürün</span>
                  <span>{action.priceSummary || 'Fiyat özeti yok'}</span>
                  <span>{action.actorName || 'Sistem kullanıcısı'}</span>
                </div>
                {action.rollbackSummary ? <p className="pricing-recent-action-note">{action.rollbackSummary}</p> : null}
                <button
                  type="button"
                  className="ghost-button pricing-recent-rollback"
                  onClick={() => onRollback?.(action)}
                  disabled={rollbackDisabled}
                >
                  {rollbackPendingId === action.id ? 'Geri alınıyor...' : 'Geri Al'}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="pricing-recent-actions-empty">Henüz bu modallardan yapılmış fiyat işlemi yok.</div>
      )}
    </section>
  );
}

function PricingRowMoreActions({
  rowId,
  isOpen,
  onToggle,
  onClose,
  onDetail,
  onSkip,
}) {
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const [menuPlacement, setMenuPlacement] = useState({ style: null, direction: 'down' });
  const menuId = `pricing-row-more-menu-${String(rowId || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  const updateMenuPosition = useCallback(() => {
    if (!buttonRef.current || typeof window === 'undefined') return;

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const menuRect = menuRef.current?.getBoundingClientRect();
    const gutter = 8;
    const offset = 6;
    const menuWidth = Math.max(menuRect?.width || 132, buttonRect.width);
    const menuHeight = menuRect?.height || 78;
    const belowSpace = window.innerHeight - buttonRect.bottom - gutter;
    const aboveSpace = buttonRect.top - gutter;
    const shouldOpenUp = belowSpace < menuHeight && aboveSpace > belowSpace;
    const top = shouldOpenUp
      ? Math.max(gutter, buttonRect.top - menuHeight - offset)
      : Math.min(window.innerHeight - menuHeight - gutter, buttonRect.bottom + offset);
    const left = Math.min(
      Math.max(gutter, buttonRect.right - menuWidth),
      Math.max(gutter, window.innerWidth - menuWidth - gutter),
    );

    setMenuPlacement({
      direction: shouldOpenUp ? 'up' : 'down',
      style: {
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        minWidth: `${menuWidth}px`,
      },
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPlacement({ style: null, direction: 'down' });
      return undefined;
    }

    updateMenuPosition();
    const frameId = window.requestAnimationFrame(updateMenuPosition);
    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose?.();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };

    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, updateMenuPosition]);

  const menu = isOpen && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        className={`pricing-row-more-menu pricing-row-more-menu--${menuPlacement.direction}`}
        id={menuId}
        role="menu"
        style={menuPlacement.style || { position: 'fixed', visibility: 'hidden' }}
      >
        <button type="button" role="menuitem" onClick={onDetail}>
          Detay
        </button>
        <button type="button" role="menuitem" className="is-danger-soft" onClick={onSkip}>
          Pas geç
        </button>
      </div>,
      document.body,
    )
    : null;

  return (
    <div className="pricing-row-more">
      <button
        ref={buttonRef}
        type="button"
        className="ghost-button pricing-row-more-button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={onToggle}
      >
        <MoreHorizontal size={15} />
        Diğer
      </button>
      {menu}
    </div>
  );
}

function BulkPriceUpdateModal({
  isOpen,
  products = [],
  productsLoading = false,
  categories = [],
  labels = [],
  onClose,
  onApply,
  isApplying = false,
  recentActions = [],
  recentActionsLoading = false,
  rollbackPendingId = '',
  onRollbackPriceAction,
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

  const scopeDescriptor = useMemo(() => {
    if (scope === 'category') {
      const tagLabel = categoryTags.find((item) => String(item.value) === String(form.tag))?.label || form.tag;
      return {
        type: 'category',
        categoryId: selectedCategory?.id || null,
        tag: form.tag || null,
        label: [selectedCategory?.name || 'Kategori', tagLabel].filter(Boolean).join(' / '),
      };
    }
    if (scope === 'products') {
      return {
        type: 'products',
        productIds: form.selectedProductIds,
        label: `${form.selectedProductIds.length} seçili ürün`,
      };
    }
    return {
      type: 'priceRange',
      minPrice: form.minPrice || null,
      maxPrice: form.maxPrice || null,
      label: `${form.minPrice || '0'} TL - ${form.maxPrice || 'üst sınır yok'} fiyat aralığı`,
    };
  }, [categoryTags, form.maxPrice, form.minPrice, form.selectedProductIds, form.tag, scope, selectedCategory]);

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
    onApply(previewRows.map((row) => ({ product: row, nextPrice: row.nextPrice })), scopeDescriptor);
  };

  if (!isOpen) return null;

  return (
    <div className="pricing-modal-backdrop" role="presentation">
      <section className="pricing-bulk-modal" role="dialog" aria-modal="true" aria-labelledby="pricing-bulk-title">
        <header className="pricing-bulk-modal-head">
          <div className="mod-card-icon mod-icon-indigo"><Calculator size={20} /></div>
          <div>
            <h2 id="pricing-bulk-title">Toplu Fiyat Güncelleme</h2>
            <p>Kategori, etiket, fiyat aralığı veya seçili ürünler için satış fiyatını güvenli şekilde güncelleyin.</p>
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
                  <div className="pricing-bulk-count"><Layers size={16} /> {productsLoading ? 'Ürünler yükleniyor...' : `${affectedProducts.length} ürün önizlemeye dahil`}</div>
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
                          <div className="pricing-bulk-product-search-empty">{productsLoading ? 'Ürünler yükleniyor...' : 'Ürün adı, SKU veya barkod yazarak arama yapın.'}</div>
                        ) : availableProductSearchRows.length ? (
                          <div className="pricing-bulk-product-list">
                            {availableProductSearchRows.map((product) => (
                              <button key={product.id} type="button" onClick={() => toggleSelectedProduct(product.id)}>
                                <span>
                                  <strong>{product.productName}</strong>
                                  <small>{product.sku || product.barcode || 'SKU yok'} • {product.categoryName} • Satış fiyatı {formatCurrency(product.currentRegularPrice)}{product.campaignEffectivePrice !== null ? ` • Kampanyalı ${formatCurrency(product.campaignEffectivePrice)}` : ''}</small>
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
                  <div className="pricing-bulk-count"><Search size={16} /> {productsLoading ? 'Ürünler yükleniyor...' : `${affectedProducts.length} ürün aralıkta`}</div>
                </div>
              ) : null}
            </div>

            <div className="pricing-bulk-panel">
              <h3>Uygulama Türü</h3>
              <div className="pricing-bulk-form-grid">
                <label className="field-group"><span>İşlem</span><select value={form.operation} onChange={(event) => setForm((current) => ({ ...current, operation: event.target.value }))}>{BULK_OPERATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                <label className="field-group"><span>Değişim türü</span><select value={form.adjustmentType} disabled={form.operation === 'fixed'} onChange={(event) => setForm((current) => ({ ...current, adjustmentType: event.target.value }))}><option value="percent">Yüzde</option><option value="amount">Tutar</option></select></label>
                <label className="field-group"><span>{form.operation === 'fixed' ? 'Yeni satış fiyatı' : 'Değişim değeri'}</span><input type="number" min="0" step="0.01" value={form.adjustmentValue} onChange={(event) => setForm((current) => ({ ...current, adjustmentValue: event.target.value }))} /></label>
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
                        <small>{product.sku || product.barcode || 'SKU yok'} • {product.categoryName} • Satış fiyatı {formatCurrency(product.currentRegularPrice)}{product.campaignEffectivePrice !== null ? ` • Kampanyalı ${formatCurrency(product.campaignEffectivePrice)}` : ''}</small>
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
                <p>Uygulamadan önce etkilenecek ürünleri, yeni fiyatı ve kârlılık riskini kontrol edin.</p>
              </div>
            </div>
            {previewState.tone === 'ready' ? (
              <>
                <div className="pricing-bulk-preview-stats">
                  <div><span>Etkilenecek ürün</span><strong>{previewSummary.count}</strong></div>
                  <div><span>Mevcut ortalama satış fiyatı</span><strong>{formatCurrency(previewSummary.avgBefore)}</strong></div>
                  <div><span>Yeni ortalama satış fiyatı</span><strong>{formatCurrency(previewSummary.avgAfter)}</strong></div>
                  <div><span>Kârlılık riski taşıyan ürün</span><strong>{previewSummary.regularRiskCount}</strong></div>
                  <div><span>Kampanya çakışma riski</span><strong>{previewSummary.campaignRiskCount}</strong></div>
                  <div><span>Zarar riski olan ürün</span><strong>{previewSummary.negativeMarginCount}</strong></div>
                </div>
                {previewSummary.marginRiskCount > 0 ? <div className="pricing-bulk-warning"><AlertTriangle size={16} /> {marginWarningText}</div> : null}
                <div className="pricing-bulk-warning pricing-bulk-warning--info"><AlertTriangle size={16} /> Bu ön izleme ürün alış maliyetini baz alır. Kargo, fire ve KDV etkileri bu toplu kontrolde ayrıca hesaplanmaz.</div>
                <div className="pricing-bulk-preview-sample-head">
                  <strong>Örnek ürünler</strong>
                  <span>Satış fiyatı, varsa kampanya fiyatı ve risk nedeni ayrı gösterilir</span>
                </div>
                <div className="pricing-bulk-preview-list">
                  {previewExamples.map((row) => (
                    <div key={row.id}>
                      <strong>{row.productName}</strong>
                      <span>Satış fiyatı: {formatCurrency(row.currentRegularPrice)} → {formatCurrency(row.nextRegularPrice)}</span>
                      <span>{row.hasActiveCampaign ? `Kampanyalı: ${formatCurrency(row.campaignEffectivePrice || 0)} → ${formatCurrency(row.campaignEffectiveAfter || row.campaignEffectivePrice || 0)}` : 'Kampanya yok'}</span>
                      <span>Alış maliyeti: {formatCurrency(row.purchasePrice)} • Satış kârlılığı: {row.regularMarginAfter === null ? '-' : formatPercent(row.regularMarginAfter)}{row.campaignMarginAfter === null ? '' : ` • Kampanya kârlılığı: ${formatPercent(row.campaignMarginAfter)}`}</span>
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

          <label className="pricing-bulk-ack pricing-bulk-ack-section">
            <input type="checkbox" checked={form.acknowledged} onChange={(event) => setForm((current) => ({ ...current, acknowledged: event.target.checked }))} />
            <span>Bu fiyat güncellemesinin fiyat geçmişine kaydedileceğini ve son işlemler alanından güvenli şekilde geri alınabileceğini onaylıyorum.</span>
          </label>

          <PriceActionHistoryPanel
            actions={recentActions}
            isLoading={recentActionsLoading}
            rollbackPendingId={rollbackPendingId}
            onRollback={onRollbackPriceAction}
          />
        </div>

        <footer className="pricing-bulk-modal-foot">
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
  rowsLoading = false,
  onClose,
  onCalculate,
  onApprove,
  calculation,
  isLoading,
  isApproving,
  recentActions = [],
  recentActionsLoading = false,
  rollbackPendingId = '',
  onRollbackPriceAction,
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
      label: 'Tahmini birim maliyet',
      value: currency.format(visibleCalculation.costs?.totalEffectiveUnitCost || visibleCalculation.costs?.totalEstimatedCost || 0),
      tone: 'is-success',
    },
    {
      key: 'difference',
      label: 'Mevcut fiyata göre fark',
      value: `${difference >= 0 ? '+' : ''}${currency.format(difference)}`,
      tone: 'is-neutral',
    },
    {
      key: 'expected-margin',
      label: 'Beklenen kârlılık',
      value: `%${Number(visibleCalculation.recommendation?.expectedMarginPct || 0).toFixed(2)}`,
      tone: 'is-warning',
    },
    {
      key: 'profit',
      label: 'Tahmini brüt kâr',
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
            <p>Ürün maliyeti, taşıma, vergi ve stok riskini birlikte değerlendirerek önerilen satış fiyatını hesaplayın.</p>
          </div>
          <button type="button" className="ghost-button pricing-modal-close" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </header>

        <div className="pricing-bulk-modal-body pricing-sell-price-modal-body">
          <div className="pricing-bulk-grid pricing-sell-price-grid">
            <div className="pricing-sell-price-main-column">
              <div className="pricing-bulk-panel pricing-sell-price-panel">
                <div className="pricing-sell-price-panel-head">
                  <h3>Ürün ve hedef</h3>
                  <p>Ürünü seçin, hedef kârlılığı girin ve uygulanabilir fiyat önerisini oluşturun.</p>
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
                          <div className="pricing-bulk-product-search-empty pricing-sell-price-search-empty">{rowsLoading ? 'Ürünler yükleniyor...' : 'Eşleşme bulunamadı.'}</div>
                        )}
                      </div>
                    ) : null}
                  </label>
                  <label className="field-group">
                    <span>Hedef kârlılık (%)</span>
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
                  <p>Önerilen satış fiyatı, maliyet etkisi ve beklenen kazanç.</p>
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
                        <span>Hedef kârlılık</span>
                        <strong>%{Number(visibleCalculation.recommendation?.targetMarginPct || 0).toFixed(0)}</strong>
                      </div>
                      <div>
                        <span>Son fiyat değişim tarihi</span>
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
                      Bu öneri ürün alış maliyeti, taşıma, operasyon ve stok riskiyle hesaplanır. Kampanya fiyatı değiştirilmez; yalnızca ana satış fiyatı için öneri verir.
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="pricing-sell-price-side-column">
              <div className="pricing-bulk-panel pricing-sell-price-panel pricing-sell-price-side-panel">
                <div className="pricing-sell-price-panel-head">
                  <h3>Hesap girdileri</h3>
                  <p>Fiyat önerisinde kullanılan maliyet, taşıma ve risk bilgileri.</p>
                </div>
                {!visibleCalculation ? (
                  <div className="pricing-sell-price-input-empty">Hesaplama sonrası alış maliyeti, taşıma, operasyon ve risk detayları burada gösterilir.</div>
                ) : (
                  <>
                    <div className="pricing-sell-price-input-grid">
                      <div><span>SKU</span><strong>{visibleCalculation.product?.sku || '-'}</strong></div>
                      <div><span>Barkod</span><strong>{visibleCalculation.product?.barcode || '-'}</strong></div>
                      <div><span>Satış birimi / koli içi</span><strong>{visibleCalculation.product?.unit || 'adet'} / {visibleCalculation.product?.casePack || visibleCalculation.costs?.unitsPerCase || 1}</strong></div>
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
                        Aktif kampanya: {visibleCalculation.campaign.name} · kampanya fiyatı {currency.format(visibleCalculation.campaign.campaignPrice || 0)}. Bu ekran kampanyayı değiştirmez, ana satış fiyatı için öneri verir.
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="pricing-sell-price-foot-note pricing-sell-price-body-note">
            Hesaplama ürün alış maliyeti, taşıma, KDV ve operasyon varsayımlarını kullanır.
          </div>

          <PriceActionHistoryPanel
            actions={recentActions}
            isLoading={recentActionsLoading}
            rollbackPendingId={rollbackPendingId}
            onRollback={onRollbackPriceAction}
          />
        </div>
        <footer className="pricing-bulk-modal-foot pricing-sell-price-modal-foot">
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
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedRowId, setExpandedRowId] = useState('');
  const [openActionMenuId, setOpenActionMenuId] = useState('');
  const [rowDetails, setRowDetails] = useState({});
  const [rowDetailLoadingId, setRowDetailLoadingId] = useState('');
  const [simulationDiscounts, setSimulationDiscounts] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [tablePage, setTablePage] = useState(1);
  const {
    filters,
    setFilters,
    selectedPreset,
    criticalFilterActive,
    setCriticalFilterActive,
    activeFilterCount,
    handlePresetClick,
    handleCardFilter,
    resetFilters,
  } = usePricingFilters({
    defaults: FILTER_DEFAULTS,
    actionTypes: PRICING_ACTION_TYPES,
    applyPreset: applyPricePreset,
    onPresetChange: () => {
      setSelectedIds([]);
      setOpenActionMenuId('');
    },
    onCardFilterChange: () => {
      setOpenActionMenuId('');
    },
    onReset: () => {
      setSelectedIds([]);
      setTablePage(1);
      setOpenActionMenuId('');
    },
  });
  const [bulkDiscountRate, setBulkDiscountRate] = useState(20);
  const [toast, setToast] = useState({ type: '', message: '' });
  const [products, setProducts] = useState([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [categories, setCategories] = useState([]);
  const [categoryLabels, setCategoryLabels] = useState([]);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [rowApplyPendingId, setRowApplyPendingId] = useState('');
  const [isSellPriceModalOpen, setIsSellPriceModalOpen] = useState(false);
  const [sellPriceCalculation, setSellPriceCalculation] = useState(null);
  const [sellPriceLoading, setSellPriceLoading] = useState(false);
  const [sellPriceApproving, setSellPriceApproving] = useState(false);
  const [recentPriceActions, setRecentPriceActions] = useState([]);
  const [recentPriceActionsLoading, setRecentPriceActionsLoading] = useState(false);
  const [rollbackPendingId, setRollbackPendingId] = useState('');
  const [locallyAppliedDecisions, setLocallyAppliedDecisions] = useState(() => readPricingDecisionArchive());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tableMeta, setTableMeta] = useState(null);
  const rowsPerPage = 10;

  const loadPricingData = useCallback(async ({ signal, forceRefresh = false, keepContent = false } = {}) => {
    if (keepContent) setIsRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const baseAnalysisParams = {
        universe: 'listed_active',
        categoryId: filters.categoryId,
        supplierId: filters.supplierId,
        riskLevel: filters.risk,
        sktStatus: normalizeSktStatusFilter(filters.sktStatus) || undefined,
        salesSpeed: filters.salesSpeed,
        primaryAction: filters.primaryAction || undefined,
        discountOnly: filters.hasSuggestion === true ? 'true' : undefined,
        campaignEligibility: filters.campaignEligibility || undefined,
        conflict: filters.conflict || undefined,
        blockingReason: filters.blockingReason || undefined,
        activeCampaignConflict: filters.activeCampaignConflict || undefined,
        guardrail: filters.guardrail || undefined,
        pricePreset: selectedPreset || undefined,
        sort: 'risk_desc',
      };
      const summaryParams = { ...baseAnalysisParams };
      const rowsParams = {
        ...baseAnalysisParams,
        excludeActiveTemporary: 'true',
        page: tablePage,
        limit: rowsPerPage,
      };
      summaryParams.excludeActiveTemporary = rowsParams.excludeActiveTemporary;
      if (forceRefresh) {
        summaryParams.forceRefresh = true;
        rowsParams.forceRefresh = true;
      }
      if (typeof pricingAnalysisService.getSummary !== 'function' || typeof pricingAnalysisService.getRows !== 'function') {
        const legacyResponse = await pricingAnalysisService.getAnalysis(rowsParams, { signal });
        if (signal?.aborted) return;
        const legacyRows = collectPricingRows(legacyResponse);
        setAnalysis({ ...legacyResponse, rows: legacyRows });
        setTableMeta({ total: legacyRows.length, totalPages: Math.max(1, Math.ceil(legacyRows.length / rowsPerPage)), page: 1, limit: rowsPerPage });
        setCategories([]);
        setProducts([]);
        setCategoryLabels([]);
        return;
      }
      const requestGroup = [
        categoryService.list({ forceRefresh }),
        categoryService.listLabels({ forceRefresh }),
      ];
      const [summaryResponse, rowsResponse, categoryResponse, labelResponse] = forceRefresh
        ? [
            { status: 'fulfilled', value: await pricingAnalysisService.getSummary(summaryParams, { signal }) },
            { status: 'fulfilled', value: await pricingAnalysisService.getRows({ ...rowsParams, forceRefresh: undefined }, { signal }) },
            ...(await Promise.allSettled(requestGroup)),
          ]
        : await Promise.allSettled([
            pricingAnalysisService.getSummary(summaryParams, { signal }),
            pricingAnalysisService.getRows(rowsParams, { signal }),
            ...requestGroup,
          ]);
      if (signal?.aborted) return;
      if (summaryResponse.status === 'rejected') throw summaryResponse.reason;
      if (rowsResponse.status === 'rejected') throw rowsResponse.reason;
      const rowResult = normalizePricingRowsResponse(rowsResponse.value);
      const rowList = rowResult.rows;
      setAnalysis({ ...summaryResponse.value, rows: rowList });
      setTableMeta(rowResult.pagination);
      setCategories(categoryResponse.status === 'fulfilled' && Array.isArray(categoryResponse.value) ? categoryResponse.value : []);
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
  }, [filters, selectedPreset, tablePage]);

  const loadPricingProducts = useCallback(async ({ forceRefresh = false } = {}) => {
    if (productsLoading) return;
    if (productsLoaded && !forceRefresh) return;
    setProductsLoading(true);
    try {
      const productRows = await productService.list({
        universe: 'listed_active',
        includeUnlisted: false,
        fetchAll: true,
        forceRefresh,
      });
      setProducts(Array.isArray(productRows) ? productRows : []);
      setProductsLoaded(true);
    } catch (productError) {
      setToast({ type: 'error', message: productError.message || 'Ürün listesi alınamadı.' });
    } finally {
      setProductsLoading(false);
    }
  }, [productsLoaded, productsLoading]);

  const loadRecentPriceActions = useCallback(async () => {
    setRecentPriceActionsLoading(true);
    try {
      const actions = await pricingAnalysisService.getRecentPriceActions({ limit: 3 });
      setRecentPriceActions(Array.isArray(actions) ? actions : []);
    } catch {
      setRecentPriceActions([]);
    } finally {
      setRecentPriceActionsLoading(false);
    }
  }, []);

  const patchPriceRowsLocally = useCallback((priceChanges = []) => {
    const normalizedChanges = new Map(
      (Array.isArray(priceChanges) ? priceChanges : [])
        .map((item) => [
          String(item.productId || item.id || '').trim(),
          normalizePrice(item.salePrice ?? item.nextPrice ?? item.price),
        ])
        .filter(([productId, salePrice]) => productId && salePrice > 0)
    );
    if (!normalizedChanges.size) return;

    const applyToRow = (row = {}) => {
      const rowId = String(row.productId || row.id || row.product?.id || '').trim();
      if (!normalizedChanges.has(rowId)) return row;
      const salePrice = normalizedChanges.get(rowId);
      return {
        ...row,
        currentPrice: salePrice,
        salePrice,
        price: salePrice,
        productPrice: salePrice,
        product: row.product ? { ...row.product, salePrice, price: salePrice } : row.product,
        current: row.current ? { ...row.current, salePrice } : row.current,
      };
    };

    setAnalysis((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: Array.isArray(current.rows) ? current.rows.map(applyToRow) : current.rows,
        sections: current.sections && typeof current.sections === 'object'
          ? Object.fromEntries(Object.entries(current.sections).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.map(applyToRow) : value,
          ]))
          : current.sections,
      };
    });
    setProducts((current) => current.map((product) => {
      const productId = String(product.id || product.productId || '').trim();
      if (!normalizedChanges.has(productId)) return product;
      const salePrice = normalizedChanges.get(productId);
      return { ...product, salePrice, price: salePrice, currentPrice: salePrice };
    }));
  }, []);

  const prependRecentPriceAction = useCallback((action) => {
    if (!action?.id) return;
    setRecentPriceActions((current) => [
      action,
      ...current.filter((item) => item.id !== action.id),
    ].slice(0, 3));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadPricingData({ signal: controller.signal });
    return () => controller.abort();
  }, [loadPricingData]);

  useEffect(() => {
    setTablePage(1);
  }, [filters, selectedPreset, criticalFilterActive]);

  useEffect(() => {
    if (isBulkModalOpen || isSellPriceModalOpen) {
      void loadRecentPriceActions();
      void loadPricingProducts();
    }
  }, [isBulkModalOpen, isSellPriceModalOpen, loadPricingProducts, loadRecentPriceActions]);

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

  const supplierOptions = useMemo(() => {
    const optionMap = new Map();
    [...recommendationRows, ...products].forEach((item) => {
      const value = String(item?.supplierId || item?.supplier?.id || '').trim();
      if (!value || optionMap.has(value)) return;
      const label = item?.supplierName || item?.supplier?.name || value;
      optionMap.set(value, { value, label });
    });
    return [...optionMap.values()].sort((a, b) => a.label.localeCompare(b.label, 'tr-TR'));
  }, [products, recommendationRows]);

  const filteredDecisionRows = useMemo(() => {
    let rows = recommendationRows;

    const mappedRows = rows.map((row) => {
      const simulatedDiscount = clampPercent(simulationDiscounts[row.id] ?? row.suggestedDiscount);
      const simulatedAction = getActionModel({
        currentPrice: row.currentPrice,
        actionType: simulatedDiscount > 0 ? PRICING_ACTION_TYPES.DISCOUNT : row.actionType,
        actionPercent: simulatedDiscount,
        suggestedPrice: row.suggestedPrice,
      });
      return {
        ...row,
        simulatedDiscount,
        suggestedPrice: simulatedAction.suggestedPrice,
        simulationLabel: simulatedAction.actionLabel,
        simulationPercent: simulatedAction.actionPercent,
        simulationText: simulatedAction.simulationText,
        actionSimulationText: simulatedAction.simulationText,
        simulationPriceChangePercent: simulatedAction.priceChangePercent,
        priceChangePercent: simulatedAction.priceChangePercent,
      };
    });

    const activeAppliedByProduct = Object.values(locallyAppliedDecisions).reduce((map, item) => {
      const productKey = getPricingDecisionProductKey(item);
      const status = String(item?.archiveStatus || item?.status || '').trim().toLowerCase('tr-TR');
      if (productKey && (!status || status === 'active')) map.set(productKey, item);
      return map;
    }, new Map());

    const markedRows = mappedRows.map((row) => {
      const decisionKey = getPricingDecisionKey(row);
      const appliedDecision = locallyAppliedDecisions[decisionKey];
      const activeProductDecision = activeAppliedByProduct.get(getPricingDecisionProductKey(row));
      const matchedDecision = appliedDecision || activeProductDecision;
      return matchedDecision
        ? { ...row, ...matchedDecision, isLocallyApplied: true }
        : row;
    });

    return markedRows;
  }, [recommendationRows, simulationDiscounts, locallyAppliedDecisions]);

  const visibleRows = useMemo(
    () => filteredDecisionRows.filter(isActivePricingDecision),
    [filteredDecisionRows],
  );

  const archivedRows = useMemo(() => {
    const existingArchiveKeys = new Set(filteredDecisionRows.map(getPricingDecisionKey).filter(Boolean));
    const archivedFromCurrentRows = filteredDecisionRows.filter((row) => row.isLocallyApplied || hasActiveTemporaryPriceAction(row));
    const archivedSnapshots = Object.values(locallyAppliedDecisions)
      .filter((row) => !existingArchiveKeys.has(row.decisionKey || getPricingDecisionKey(row)))
      .filter((row) => {
        if (selectedPreset && !rowMatchesPricePreset(row, selectedPreset)) return false;
        if (filters.risk && row.riskLevel !== filters.risk) return false;
        if (normalizeSktStatusFilter(filters.sktStatus) && !rowMatchesSktStatusFilter(row, filters.sktStatus)) return false;
        if (filters.salesSpeed) {
          if (filters.salesSpeed === 'fast' && row.salesVelocity < 4) return false;
          if (filters.salesSpeed === 'slow' && row.salesVelocity > 1) return false;
          if (filters.salesSpeed === 'normal' && !(row.salesVelocity > 1 && row.salesVelocity < 4)) return false;
        }
        if (filters.hasSuggestion === true && row.actionType !== PRICING_ACTION_TYPES.DISCOUNT) return false;
        if (filters.hasSuggestion === false && [PRICING_ACTION_TYPES.DISCOUNT, PRICING_ACTION_TYPES.CAMPAIGN, PRICING_ACTION_TYPES.ORDER].includes(row.actionType)) return false;
        if (filters.primaryAction && row.actionType !== filters.primaryAction) return false;
        if (filters.categoryId && String(row.categoryId || row.productCategoryId || '').trim() !== String(filters.categoryId).trim()) return false;
        if (filters.supplierId && String(row.supplierId || '').trim() !== String(filters.supplierId).trim()) return false;
        if (criticalFilterActive && !(row.actionType === PRICING_ACTION_TYPES.DISCOUNT || row.expirationRisk === 'critical' || row.riskLevel === 'critical')) return false;
        return true;
      })
      .map((row) => ({ ...row, isLocallyApplied: true }));
    return [...archivedFromCurrentRows, ...archivedSnapshots]
      .sort((a, b) => new Date(b.archivedAt || b.appliedAt || 0) - new Date(a.archivedAt || a.appliedAt || 0));
  }, [criticalFilterActive, filteredDecisionRows, filters, locallyAppliedDecisions, selectedPreset]);

  const selectedRows = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return visibleRows.filter((row) => selectedSet.has(row.id));
  }, [selectedIds, visibleRows]);

  const bulkModalProducts = useMemo(() => {
    if (products.length) return products;
    if (productsLoading || productsLoaded) return [];
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
  }, [products, productsLoaded, productsLoading, recommendationRows]);

  const sellPriceRows = useMemo(() => {
    if (!productsLoaded && productsLoading) return [];
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
  }, [products, productsLoaded, productsLoading, recommendationRows]);

  const summary = useMemo(() => {
    const rows = visibleRows;
    const analysisSummary = analysis?.summary || {};
    const useVisibleSummary = selectedPreset === PRICE_PRESETS.overstocked || criticalFilterActive;
    const total = useVisibleSummary ? rows.length : Number(analysisSummary.totalAnalyzedProducts ?? tableMeta?.total ?? rows.length);
    const actionRequiredCount = useVisibleSummary
      ? rows.filter((row) => row.actionType === PRICING_ACTION_TYPES.DISCOUNT).length
      : Number(analysisSummary.actionRequiredProducts ?? analysisSummary.discountSuggestedProducts ?? rows.filter((row) => row.actionType === PRICING_ACTION_TYPES.DISCOUNT).length);
    const watchCount = useVisibleSummary
      ? rows.filter((row) => row.actionType === PRICING_ACTION_TYPES.WATCH).length
      : Number(analysisSummary.watchOnlyProducts ?? rows.filter((row) => row.actionType === PRICING_ACTION_TYPES.WATCH).length);
    const holdCount = useVisibleSummary
      ? rows.filter((row) => row.actionType === PRICING_ACTION_TYPES.HOLD).length
      : Number(analysisSummary.holdPriceProducts ?? rows.filter((row) => row.actionType === PRICING_ACTION_TYPES.HOLD).length);
    const orderCount = useVisibleSummary
      ? rows.filter((row) => row.actionType === PRICING_ACTION_TYPES.ORDER).length
      : Number(analysisSummary.orderPriorityProducts ?? rows.filter((row) => row.actionType === PRICING_ACTION_TYPES.ORDER).length);
    const campaignCount = useVisibleSummary
      ? rows.filter((row) => row.actionType === PRICING_ACTION_TYPES.CAMPAIGN).length
      : Number(analysisSummary.campaignCandidateProducts ?? rows.filter((row) => row.actionType === PRICING_ACTION_TYPES.CAMPAIGN).length);
    const discountRows = rows.filter((row) => row.simulatedDiscount > 0);
    const avgDiscount = discountRows.length
      ? discountRows.reduce((sum, row) => sum + row.simulatedDiscount, 0) / discountRows.length
      : 0;

    return {
      total,
      urgentCount: actionRequiredCount,
      discountCount: actionRequiredCount,
      actionRequiredCount,
      watchCount,
      keepCount: holdCount,
      holdCount,
      orderCount,
      campaignCount,
      avgDiscount: Number(avgDiscount.toFixed(1)),
    };
  }, [analysis?.summary, criticalFilterActive, selectedPreset, tableMeta?.total, visibleRows]);

  const metricCards = useMemo(() => {
    const urgentMessage = summary.actionRequiredCount > 0 ?
      `${summary.actionRequiredCount} ürün için gerçek fiyat aksiyonu gerekiyor.`
      : 'Fiyat aksiyonu gerektiren ürün yok.';

    const discountMessage = summary.discountCount > 0 ?
      `${summary.discountCount} ürün indirim eşiğini geçti.`
      : 'İndirim eşiğini geçen ürün görünmüyor.';

    const keepMessage = summary.keepCount > 0 ?
      `${summary.keepCount} ürün fiyat koruma modunda.`
      : 'Fiyat koruma adayı ürün görünmüyor.';

    return [
      {
        id: 'urgent',
        label: 'Aksiyon Gerekli',
        value: summary.actionRequiredCount,
        icon: <ShieldAlert size={16} />,
        iconClass: 'mod-icon-rose',
        message: urgentMessage,
        onClick: () => handleCardFilter(PRICING_ACTION_TYPES.DISCOUNT),
        toneClass: 'is-primary-urgent',
      },
      {
        id: 'watch',
        label: 'İzlenmeli',
        value: summary.watchCount,
        icon: <Clock3 size={16} />,
        iconClass: 'mod-icon-cyan',
        message: summary.watchCount > 0 ? `${summary.watchCount} ürün takipte.` : 'Takip edilecek ürün görünmüyor.',
        onClick: () => handleCardFilter(PRICING_ACTION_TYPES.WATCH),
        toneClass: '',
      },
      {
        id: 'keep',
        label: 'Fiyat Koruma',
        value: summary.keepCount,
        icon: <ShieldCheck size={16} />,
        iconClass: 'mod-icon-emerald',
        message: keepMessage,
        onClick: () => handleCardFilter(PRICING_ACTION_TYPES.HOLD),
        toneClass: '',
      },
      {
        id: 'order',
        label: 'Sipariş Baskısı',
        value: summary.orderCount,
        icon: <Boxes size={16} />,
        iconClass: 'mod-icon-indigo',
        message: summary.orderCount > 0 ? `${summary.orderCount} üründe önce stok/sipariş aksiyonu var.` : 'Sipariş baskısı görünmüyor.',
        onClick: () => handleCardFilter(PRICING_ACTION_TYPES.ORDER),
        toneClass: '',
      },
      {
        id: 'campaign',
        label: 'Kampanya Adayı',
        value: summary.campaignCount,
        icon: <BadgePercent size={16} />,
        iconClass: 'mod-icon-indigo',
        message: summary.campaignCount > 0 ? `${summary.campaignCount} ürün kampanyaya alınabilir.` : discountMessage,
        onClick: () => handleCardFilter(PRICING_ACTION_TYPES.CAMPAIGN),
        toneClass: '',
      },
      {
        id: 'all',
        label: 'Analiz Edilen Ürün',
        value: summary.total,
        icon: <Boxes size={16} />,
        iconClass: 'mod-icon-indigo',
        message: summary.total > 0 ? 'Aksiyon, izleme ve koruma grupları ayrı hesaplandı.' : 'Analiz edilecek ürün görünmüyor.',
        onClick: () => handleCardFilter('all'),
        toneClass: '',
      },
    ];
  }, [summary]);

  const pricingActionChartData = useMemo(() => ([
    { name: 'Aksiyon', adet: summary.actionRequiredCount },
    { name: 'İzle', adet: summary.watchCount },
    { name: 'Koru', adet: summary.keepCount },
    { name: 'Sipariş', adet: summary.orderCount },
    { name: 'Kampanya', adet: summary.campaignCount },
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
    () => visibleRows.filter((row) => row.actionType === PRICING_ACTION_TYPES.DISCOUNT || row.actionType === PRICING_ACTION_TYPES.ORDER).slice(0, 5),
    [visibleRows],
  );

  const emptyState = useMemo(() => {
    const backendTotal = Number(tableMeta?.total ?? recommendationRows.length);
    const hasActiveFilters = [
      filters.risk,
      filters.sktStatus,
      filters.salesSpeed,
      filters.primaryAction,
      filters.categoryId,
      filters.supplierId,
      filters.campaignEligibility,
      filters.conflict,
      filters.blockingReason,
      filters.activeCampaignConflict,
      filters.guardrail,
      filters.hasSuggestion !== '' ? 'suggestion' : '',
      selectedPreset,
      criticalFilterActive ? 'critical' : '',
    ].filter(Boolean).length > 0;
    if (hasActiveFilters && backendTotal === 0) {
      return {
        title: 'Filtreyle eşleşen aktif karar yok',
        description: 'Seçili filtreler için uygulama bekleyen fiyat kararı bulunamadı.',
        isFilteredEmpty: true,
      };
    }
    if (backendTotal === 0) {
      return {
        title: 'Aktif fiyat kararı yok',
        description: 'Şu anda uygulama bekleyen açık fiyat kararı bulunmuyor.',
        isFilteredEmpty: false,
      };
    }
    return mapEmptyStateReason({ rows: recommendationRows, filters });
  }, [criticalFilterActive, filters, recommendationRows, selectedPreset, tableMeta?.total]);

  const toggleRowSelection = (rowId, checked) => {
    setSelectedIds((prev) => toggleSelectedIds(prev, rowId, checked));
  };

  const toggleAllSelection = (checked) => {
    setSelectedIds((prev) => toggleAllIds(prev, visibleRows, checked));
  };

  const toggleRowDetail = async (row) => {
    const rowId = row?.id;
    if (!rowId) return;
    setOpenActionMenuId('');
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

  const archivePricingDecisions = useCallback((rows = [], archiveMeta = {}) => {
    const rowList = Array.isArray(rows) ? rows.filter(Boolean) : [rows].filter(Boolean);
    if (!rowList.length) return;
    const archivedAt = new Date().toISOString();
    setLocallyAppliedDecisions((current) => {
      const next = { ...current };
      rowList.forEach((row) => {
        const decisionKey = getPricingDecisionKey(row);
        if (!decisionKey) return;
        next[decisionKey] = {
          ...row,
          ...archiveMeta,
          decisionKey,
          productKey: getPricingDecisionProductKey(row),
          archivedAt,
          isLocallyApplied: true,
        };
      });
      writePricingDecisionArchive(next);
      return next;
    });
    setSelectedIds((current) => current.filter((id) => !rowList.some((row) => row.id === id)));
    setOpenActionMenuId('');
    setExpandedRowId('');
  }, []);

  const handleBulkAction = (action) => {
    if (!selectedRows.length) {
      setToast({ type: 'warning', message: 'Toplu işlem için ürün seçimi yapın.' });
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
            <span className="sr-only">{selectedRows.length} ürüne %{Math.round(newDiscount)} simülasyon indirimi uygulandı</span>
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

  const handleApplySinglePriceAction = async (row) => {
    const rowId = String(row?.id || row?.productId || '').trim();
    const productId = String(row?.productId || row?.id || row?.product?.id || '').trim();
    const salePrice = normalizePrice(row?.suggestedPrice);
    const currentPrice = normalizePrice(row?.currentPrice);
    if (hasActiveTemporaryPriceAction(row)) {
      setToast({ type: 'warning', message: 'Bu ürün için aktif geçici fiyat uygulaması devam ediyor.' });
      return;
    }
    if (row?.actionType !== PRICING_ACTION_TYPES.DISCOUNT) {
      setToast({ type: 'info', message: `${getPassiveDecisionActionText(row)} satırı fiyat güncelleme aksiyonu değildir.` });
      return;
    }
    if (!rowId || !productId) {
      setToast({ type: 'warning', message: 'Uygulanacak ürün bulunamadı.' });
      return;
    }
    if (!salePrice || salePrice <= 0) {
      setToast({ type: 'warning', message: 'Uygulanacak önerilen fiyat bulunamadı.' });
      return;
    }
    if (Math.round(currentPrice * 100) === Math.round(salePrice * 100)) {
      setToast({ type: 'info', message: `${row.productName || 'Ürün'} için fiyat değişikliği gerekmiyor.` });
      return;
    }
    if (rowApplyPendingId) return;

    setOpenActionMenuId('');
    setRowApplyPendingId(rowId);
    try {
      const duration = getTemporaryPriceValidity(row);
      const result = await pricingAnalysisService.applyTemporaryPriceAction({
        productId,
        salePrice,
        actionType: 'temporary_price_decision',
        recommendationType: row.actionType || PRICING_ACTION_TYPES.DISCOUNT,
        riskLevel: row.riskLevel,
        sourceRecommendationKey: getPricingDecisionKey(row),
        notes: `${row.productName || 'Ürün'} - ${getDecisionActionLabel(row)}`,
        rowSnapshot: {
          id: row.id,
          productId,
          productName: row.productName,
          sku: row.sku,
          currentPrice,
          suggestedPrice: salePrice,
          riskLevel: row.riskLevel,
          recommendationReason: row.recommendationReason || row.reasonSummary || '',
        },
      });
      const appliedAt = result?.appliedAt || new Date().toISOString();
      const durationDays = Number(result?.durationDays || duration.durationDays);
      const endAt = result?.endAt || addDaysIso(appliedAt, durationDays);
      patchPriceRowsLocally(result?.updatedProducts || [{ productId, salePrice }]);
      prependRecentPriceAction({
        id: result?.id || result?.priceActionId || '',
        type: 'temporary_price_decision',
        scopeLabel: row.productName || 'Fiyat kararı',
        affectedProductCount: 1,
        priceSummary: `${formatCurrency(currentPrice)} → ${formatCurrency(salePrice)}`,
        createdAt: appliedAt,
        status: result?.status || 'active',
        statusLabel: 'Uygulandı',
      });
      archivePricingDecisions([row], {
        salePrice,
        actionType: PRICING_ACTION_TYPES.DISCOUNT,
        archiveStatus: 'active',
        archiveStatusLabel: 'Uygulandı',
        activeTemporaryPriceAction: result || null,
        hasActiveTemporaryPriceAction: true,
        temporaryPriceActionStatus: result?.status || 'active',
        appliedAt,
        endAt,
        durationDays,
        appliedActionId: result?.id || result?.priceActionId || '',
      });
      setSelectedIds((current) => current.filter((id) => id !== row.id));
      window.setTimeout(() => {
        void loadRecentPriceActions();
      }, 250);
      setToast({ type: 'success', message: `Fiyat ${durationDays} gün geçerli olacak şekilde uygulandı. Bitiş: ${formatDateShort(endAt)}.` });
    } catch (applyError) {
      console.error('[pricing-analysis] price decision apply failed', applyError);
      const apiMessage = String(applyError?.message || '').trim();
      const isTemporaryPriceInfraError = /geçici fiyat aksiyonu|temporary price action|migration|prisma generate/i.test(apiMessage)
        || applyError?.payload?.errorCode === 'TEMPORARY_PRICE_ACTION_INFRA_NOT_READY';
      const isActiveTemporaryConflict = applyError?.payload?.errorCode === 'ACTIVE_TEMPORARY_PRICE_ACTION_EXISTS'
        || /aktif geçici fiyat uygulaması/i.test(apiMessage);
      const isGenericServerError = !apiMessage || /sunucu hatas[ıi]|server error/i.test(apiMessage);
      if (isActiveTemporaryConflict) {
        void loadPricingData({ forceRefresh: true, keepContent: true });
      }
      setToast({
        type: 'error',
        title: isTemporaryPriceInfraError ? 'Fiyat Altyapısı' : 'Fiyat Güncellemesi',
        message: isTemporaryPriceInfraError
          ? 'Geçici fiyat aksiyonu altyapısı hazır değil. Sistem migration/generate güncellemesi bekliyor.'
          : isActiveTemporaryConflict
            ? 'Bu ürün için aktif geçici fiyat uygulaması devam ediyor.'
          : isGenericServerError
            ? 'Fiyat güncellemesi tamamlanamadı. Backend hata kaydını kontrol edin; fiyat değişikliği uygulanmadı.'
            : apiMessage,
      });
    } finally {
      setRowApplyPendingId('');
    }
  };

  const handleSkipSinglePriceAction = async (row) => {
    if (!row?.id) return;
    const productId = String(row?.productId || row?.id || row?.product?.id || '').trim();
    const sourceRecommendationKey = getPricingDecisionKey(row);
    if (!productId || !sourceRecommendationKey) {
      setToast({ type: 'warning', message: 'Pas geçilecek karar bulunamadı.' });
      return;
    }
    setOpenActionMenuId('');
    try {
      const result = await pricingAnalysisService.skipPricingDecision({
        productId,
        sourceRecommendationKey,
        recommendationType: row.actionType || '',
        riskLevel: row.riskLevel || '',
        notes: `${row.productName || 'Ürün'} - ${getDecisionActionLabel(row)}`,
        rowSnapshot: {
          id: row.id,
          productId,
          productName: row.productName,
          sku: row.sku,
          currentPrice: row.currentPrice,
          suggestedPrice: row.suggestedPrice,
          riskLevel: row.riskLevel,
          recommendationReason: row.recommendationReason || row.reasonSummary || '',
        },
      });
      setSimulationDiscounts((prev) => ({ ...prev, [row.id]: 0 }));
      archivePricingDecisions([row], {
        archiveStatus: 'dismissed',
        archiveStatusLabel: 'Pas geçildi',
        skippedAt: result?.skippedAt || new Date().toISOString(),
        sourceRecommendationKey,
      });
      void loadPricingData({ forceRefresh: true, keepContent: true });
      setToast({ type: 'info', message: `${row.productName || 'Ürün'} kararı kalıcı olarak pas geçildi.` });
    } catch (skipError) {
      setToast({ type: 'error', message: skipError.message || 'Karar pas geçilemedi.' });
    }
  };

  const handleApplyBulkPriceUpdate = async (updates, scopeDescriptor = {}) => {
    if (!Array.isArray(updates) || updates.length === 0) {
      setToast({ type: 'warning', message: 'Güncellenecek ürün bulunamadı.' });
      return;
    }
    setBulkApplying(true);
    try {
      const priceChanges = updates.map(({ product, nextPrice }) => ({
        productId: product.id,
        salePrice: normalizePrice(nextPrice),
      }));
      const result = await pricingAnalysisService.applyBulkPriceUpdate({
        scope: scopeDescriptor,
        updates: priceChanges,
      });
      patchPriceRowsLocally(result?.updatedProducts || priceChanges);
      prependRecentPriceAction(result);
      void loadRecentPriceActions();
      void loadPricingData({ forceRefresh: true, keepContent: true });
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

  const handleRollbackPriceAction = async (action) => {
    if (!action?.id || rollbackPendingId) return;
    setRollbackPendingId(action.id);
    try {
      const result = await pricingAnalysisService.rollbackPriceAction(action.id);
      patchPriceRowsLocally(result?.rolledBackProducts || []);
      setRecentPriceActions((current) => current.map((item) => (
        item.id === action.id
          ? {
            ...item,
            status: result.status || item.status,
            rollbackSummary: result.message || item.rollbackSummary,
          }
          : item
      )));
      void loadPricingData({ forceRefresh: true, keepContent: true });
      void loadRecentPriceActions();
      setToast({
        type: result.status === 'partial_rollback' ? 'warning' : 'success',
        message: result.message || 'Fiyat işlemi geri alındı.',
      });
    } catch (rollbackError) {
      await loadRecentPriceActions();
      setToast({ type: 'error', message: rollbackError.message || 'Fiyat işlemi geri alınamadı.' });
    } finally {
      setRollbackPendingId('');
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
      patchPriceRowsLocally([{ productId: result.productId || payload.productId, salePrice: result.salePrice }]);
      if (result?.action) prependRecentPriceAction(result.action);
      void loadRecentPriceActions();
      void loadPricingData({ forceRefresh: true, keepContent: true });
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

  useEffect(() => {
    setTablePage(1);
    setOpenActionMenuId('');
  }, [filters, selectedPreset, criticalFilterActive]);

  const pagination = tableMeta || {};
  const totalRows = Number(pagination.total ?? visibleRows.length);
  const currentPage = Number(pagination.page ?? tablePage);
  const currentLimit = Number(pagination.limit ?? rowsPerPage);
  const totalPages = Math.max(1, Number(pagination.totalPages ?? Math.ceil(totalRows / Math.max(currentLimit, 1))));
  const pagedRows = useMemo(
    () => visibleRows.map((row) => enrichPricingActionRowForTable(row, simulationDiscounts)),
    [visibleRows, simulationDiscounts],
  );
  const detailModalRow = useMemo(
    () => pagedRows.find((row) => row.id === expandedRowId) || null,
    [expandedRowId, pagedRows],
  );
  const visibleRangeStart = totalRows && pagedRows.length ? ((currentPage - 1) * currentLimit) + 1 : 0;
  const visibleRangeEnd = totalRows && pagedRows.length ? Math.min(((currentPage - 1) * currentLimit) + pagedRows.length, totalRows) : 0;

  const allSelected = pagedRows.length > 0 && pagedRows.every((row) => selectedIds.includes(row.id));
  const tablePagination = (
    <PricingTablePagination
      totalRows={totalRows}
      visibleRangeStart={visibleRangeStart}
      visibleRangeEnd={visibleRangeEnd}
      currentPage={currentPage}
      totalPages={totalPages}
      onPrevious={() => setTablePage((prev) => Math.max(1, prev - 1))}
      onNext={() => setTablePage((prev) => Math.min(totalPages, prev + 1))}
    />
  );

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
            <h3>Öncelikli Kararlar</h3>
            <span className="sr-only">Öncelikli Fiyat Aksiyonları</span>
            <p>{criticalRows.length} ürün gerçek fiyat aksiyonu veya sipariş önceliği bekliyor.</p>
          </div>
          <button
            type="button"
            className={`ghost-button ${filters.primaryAction === PRICING_ACTION_TYPES.DISCOUNT ? 'is-active' : ''}`}
            onClick={() => {
              if (filters.primaryAction === PRICING_ACTION_TYPES.DISCOUNT) {
                setFilters((prev) => ({ ...prev, primaryAction: '' }));
              } else {
                handleCardFilter(PRICING_ACTION_TYPES.DISCOUNT);
              }
            }}
            aria-pressed={filters.primaryAction === PRICING_ACTION_TYPES.DISCOUNT}
          >
            {filters.primaryAction === PRICING_ACTION_TYPES.DISCOUNT ? 'Öncelik Filtresini Kaldır' : 'Aksiyon Gereklileri Filtrele'}
          </button>
        </div>
      )}

      <div className="dashboard-grid dashboard-grid--6 pricing-summary-grid pricing-summary-grid-meaningful pricing-section">
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
              onChange={(event) => setFilters((prev) => ({ ...prev, sktStatus: normalizeSktStatusFilter(event.target.value) }))}
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
            <span>Aksiyon Tipi</span>
            <select
              value={filters.primaryAction}
              onChange={(event) => setFilters((prev) => ({ ...prev, primaryAction: event.target.value, hasSuggestion: '' }))}
            >
              <option value="">Tüm tipler</option>
              <option value={PRICING_ACTION_TYPES.DISCOUNT}>Aksiyon Gerekli</option>
              <option value={PRICING_ACTION_TYPES.WATCH}>İzlenmeli</option>
              <option value={PRICING_ACTION_TYPES.HOLD}>Fiyatı Koru</option>
              <option value={PRICING_ACTION_TYPES.ORDER}>Sipariş Baskısı</option>
              <option value={PRICING_ACTION_TYPES.CAMPAIGN}>Kampanya Adayı</option>
            </select>
          </label>
          <label className="field-group pricing-filter-field">
            <span>Kategori</span>
            <select
              value={filters.categoryId}
              onChange={(event) => setFilters((prev) => ({ ...prev, categoryId: event.target.value }))}
            >
              <option value="">Tüm kategoriler</option>
              {categories.map((category) => {
                const value = String(category?.id || category?.categoryId || '').trim();
                if (!value) return null;
                return (
                  <option key={value} value={value}>
                    {getReadableCategoryLabelName(category, categoryLabels) || category?.name || value}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="field-group pricing-filter-field">
            <span>Tedarikçi</span>
            <select
              value={filters.supplierId}
              onChange={(event) => setFilters((prev) => ({ ...prev, supplierId: event.target.value }))}
            >
              <option value="">Tüm tedarikçiler</option>
              {supplierOptions.map((supplier) => (
                <option key={supplier.value} value={supplier.value}>{supplier.label}</option>
              ))}
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
                  primaryAction: '',
                  hasSuggestion: value === '' ? '' : value === 'true',
                }));
              }}
            >
              <option value="">Tüm ürünler</option>
              <option value="true">Önerisi olanlar</option>
              <option value="false">Fiyat koru</option>
            </select>
          </label>
          <label className="field-group pricing-filter-field">
            <span>Kampanya Uygunluğu</span>
            <select
              value={filters.campaignEligibility}
              onChange={(event) => setFilters((prev) => ({ ...prev, campaignEligibility: event.target.value }))}
            >
              <option value="">Tümü</option>
              <option value="eligible">Kampanyaya alınabilir</option>
              <option value="not_eligible">Kampanyaya alınamaz</option>
              <option value="conflict">Çakışmalı</option>
              <option value="campaign_active">Kampanya aktif</option>
              <option value="campaign_inactive">Kampanya yok</option>
            </select>
          </label>
          <label className="field-group pricing-filter-field">
            <span>Kontrol Kuralı</span>
            <select
              value={filters.guardrail}
              onChange={(event) => setFilters((prev) => ({ ...prev, guardrail: event.target.value }))}
            >
              <option value="">Tümü</option>
              <option value="any">Kural engeli var</option>
              <option value="margin">Marj kuralı</option>
              <option value="stock">Stok kuralı</option>
              <option value="procurement">Tedarik kuralı</option>
              <option value="none">Kural engeli yok</option>
            </select>
          </label>
          <label className="field-group pricing-filter-field">
            <span>Engel Nedeni</span>
            <select
              value={filters.blockingReason}
              onChange={(event) => setFilters((prev) => ({ ...prev, blockingReason: event.target.value }))}
            >
              <option value="">Tüm nedenler</option>
              <option value="active_campaign_conflict">Aktif kampanya çakışması</option>
              <option value="low_margin">Düşük marj</option>
              <option value="price_at_or_below_cost">Fiyat maliyet sınırında</option>
              <option value="critical_stock">Kritik stok</option>
              <option value="low_stock_coverage">Stok karşılama süresi düşük</option>
              <option value="replenishment_pipeline_missing">Tedarik hattı zayıf</option>
              <option value="long_lead_time">Tedarik süresi uzun</option>
            </select>
          </label>
          <div className="pricing-filter-inline-meta">
            <span className="pricing-info-chip">Aktif filtre: <strong>{activeFilterCount}</strong></span>
            <button type="button" className="ghost-button pricing-filter-action" onClick={resetFilters}>
              Temizle
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
          <span>{selectedRows.length} ürün seçili<span className="sr-only">{selectedRows.length} ürün seçili</span></span>
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
          <button type="button" className="primary-button" aria-label="Toplu İndirim Uygula" onClick={() => handleBulkAction(BULK_ACTIONS.APPLY_DISCOUNT)}>
            Toplu İndirim Uygula
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
            <h2>Aktif Kararlar</h2>
            <p>Süreli önerilen fiyat uygulaması bekleyen açık kararlar gösterilir.</p>
          </div>
          {tablePagination}
        </div>

        {loading ? (
          <PricingActionListLoading />
        ) : error ? (
          <div className="table-empty">{error}</div>
        ) : visibleRows.length === 0 ? (
          <div className="mod-empty-state pricing-empty-state" role="status">
            <BadgePercent size={24} />
            <h4>{emptyState.title}</h4>
            <p>{emptyState.isFilteredEmpty ? 'Filtreleri genişleterek diğer açık kararları görüntüleyebilirsiniz.' : 'İşlem yapılmış kararlar alttaki Geçmiş alanında görünür.'}</p>
            <p className="pricing-empty-why">Neden: {emptyState.description}</p>
            <div className="pricing-empty-state__actions">
              <button type="button" className="ghost-button" onClick={resetFilters}>
                Filtreleri Sıfırla
              </button>
            </div>
            {!emptyState.isFilteredEmpty ? (
              <div className="pricing-empty-insights" role="note" aria-label="Sistem içgörüleri">
                <div>
                  <strong>Açık fiyat kararı yok</strong>
                  <span>Backend bu görünüm için uygulama bekleyen kayıt döndürmedi.</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="table-wrapper pricing-action-table-wrapper">
              <table className="data-table" aria-label="Fiyat ve talep karar tablosu">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Tüm satırları seç"
                        checked={allSelected}
                        onChange={(event) => toggleAllSelection(event.target.checked)}
                      />
                    </th>
                    <th>Ürün</th>
                    <th>Öneri</th>
                    <th>Sebep</th>
                    <th>Risk</th>
                    <th>Önerilen Fiyat</th>
                    <th>Geçerlilik</th>
                    <th>Aksiyon</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => {
                  const isSelected = selectedIds.includes(row.id);
                  const decisionAction = getDecisionActionLabel(row);
                  const actionTone = decisionAction === 'İndirim öner'
                    ? 'warning'
                    : decisionAction === 'Fiyat artır'
                      ? 'primary'
                      : decisionAction === 'Kampanya aktif'
                        ? 'neutral'
                        : decisionAction === 'İşlem önerilmez'
                          ? 'danger'
                          : 'success';
                    const reasons = buildDecisionReasons(row, 2);
                    const risk = getDecisionRisk(row);
                    const priceChange = getPriceChangeLabel(row);
                    const validity = getTemporaryPriceValidity(row);
                    const isActionMenuOpen = openActionMenuId === row.id;
                    const canApplyRow = canApplyPricingDecision(row);
                    const isDiscountAction = row.actionType === PRICING_ACTION_TYPES.DISCOUNT;
                    const passiveActionText = getPassiveDecisionActionText(row);
                    const passiveHelpText = getPassiveDecisionHelpText(row);
                    const rowPending = rowApplyPendingId === String(row.id || row.productId || '');
                    return (
                    <tr key={row.id} className={`pricing-action-row pricing-decision-row pricing-action-row--${row.actionType || 'default'} ${row.actionType === PRICING_ACTION_TYPES.DISCOUNT || row.actionType === PRICING_ACTION_TYPES.ORDER ? 'pricing-row--urgent' : ''} ${row.isLocallyApplied ? 'pricing-row--applied' : ''}`.trim()}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${toAsciiLabel(row.productName)} satırını seç`}
                          checked={isSelected}
                          onChange={(event) => toggleRowSelection(row.id, event.target.checked)}
                        />
                      </td>
                      <td>
                        <div className="pricing-product-cell">
                          <strong>
                            {row.isCatalogUnlisted ? <span className="product-new-badge">Yeni</span> : null}
                            {String(row.productName || '').trim() || 'Bilinmeyen ürün'}
                          </strong>
                          <span>SKU: {String(row.sku || '').trim() || '-'}</span>
                          <small>{String(row.category || row.categoryName || '').trim() || '-'}{row.etiket ? ` · ${row.etiket}` : ''}</small>
                        </div>
                      </td>
                      <td>
                        <StatusBadge tone={actionTone}>{decisionAction}</StatusBadge>
                      </td>
                      <td>
                        <div className="pricing-reason-chips">
                          {(reasons.length ? reasons : ['Veri yetersiz']).map((item) => <span key={item}>{item}</span>)}
                        </div>
                      </td>
                      <td>
                        <StatusBadge tone={risk.tone}>{risk.label}</StatusBadge>
                      </td>
                      <td>
                        <div className="pricing-price-decision">
                          <span>{formatCurrency(row.currentPrice)}</span>
                          <strong>{formatCurrency(row.suggestedPrice)}</strong>
                          <small>{priceChange}</small>
                        </div>
                      </td>
                      <td>
                        <div className="pricing-validity-cell">
                          <strong>{validity.durationDays} gün</strong>
                          <span>{formatDateShort(validity.endAt)} biter</span>
                        </div>
                      </td>
                      <td>
                        <div className="pricing-decision-actions">
                          {row.isLocallyApplied ? (
                            <StatusBadge tone="success">Uygulandı</StatusBadge>
                          ) : isDiscountAction ? (
                            <button
                              type="button"
                              className="primary-button pricing-row-apply-button"
                              onClick={() => handleApplySinglePriceAction(row)}
                              disabled={!canApplyRow || rowPending}
                              title={canApplyRow ? 'Önerilen fiyatı ürüne uygula' : passiveActionText}
                            >
                              {rowPending ? 'Uygulanıyor...' : (canApplyRow ? 'Uygula' : passiveActionText)}
                            </button>
                          ) : (
                            <span className="pricing-passive-action-label">
                              {passiveActionText}
                              {passiveHelpText ? <small>{passiveHelpText}</small> : null}
                            </span>
                          )}
                          <PricingRowMoreActions
                            rowId={row.id}
                            isOpen={isActionMenuOpen}
                            onToggle={() => setOpenActionMenuId((current) => (current === row.id ? '' : row.id))}
                            onClose={() => setOpenActionMenuId('')}
                            onDetail={() => toggleRowDetail(row)}
                            onSkip={() => handleSkipSinglePriceAction(row)}
                          />
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="mod-card pricing-section pricing-action-list-card pricing-decision-archive-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-indigo"><Clock3 size={18} /></div>
          <div>
            <h2>Geçmiş</h2>
            <p>Bu oturumda uygulanan, süresi dolan, geri alınan veya kapatılan karar kayıtları.</p>
          </div>
        </div>

        {archivedRows.length === 0 ? (
          <div className="mod-empty-state pricing-empty-state" role="status">
            <Clock3 size={24} />
            <h4>Geçmiş karar yok</h4>
            <p>Bir fiyatı uyguladığınızda veya kararı kapattığınızda kayıt burada görünür.</p>
          </div>
        ) : (
          <div className="table-wrapper pricing-action-table-wrapper">
            <table className="data-table" aria-label="Fiyat ve talep karar geçmişi tablosu">
              <thead>
                <tr>
                  <th>Durum</th>
                  <th>Ürün</th>
                  <th>Öneri</th>
                  <th>Sebep</th>
                  <th>Risk</th>
                  <th>Önerilen Fiyat</th>
                  <th>Geçerlilik</th>
                  <th>Aksiyon</th>
                </tr>
              </thead>
              <tbody>
                {archivedRows.map((archiveRow) => {
                  const activeAction = archiveRow.activeTemporaryPriceAction || null;
                  const activeSnapshot = activeAction?.rowSnapshot && typeof activeAction.rowSnapshot === 'object' ? activeAction.rowSnapshot : null;
                  const historySourceRow = activeSnapshot && !archiveRow.isLocallyApplied
                    ? {
                      ...archiveRow,
                      ...activeSnapshot,
                      actionType: PRICING_ACTION_TYPES.DISCOUNT,
                      archiveStatus: activeAction.status || 'active',
                      appliedAt: activeAction.appliedAt,
                      endAt: activeAction.endAt,
                      durationDays: activeAction.durationDays,
                      activeTemporaryPriceAction: activeAction,
                      hasActiveTemporaryPriceAction: true,
                    }
                    : archiveRow;
                  const row = enrichPricingActionRowForTable(historySourceRow, simulationDiscounts);
                  const decisionAction = getDecisionActionLabel(row);
                  const actionTone = decisionAction === 'İndirim öner'
                    ? 'warning'
                    : decisionAction === 'Fiyat artır'
                      ? 'primary'
                      : decisionAction === 'Kampanya aktif'
                        ? 'neutral'
                        : decisionAction === 'İşlem önerilmez'
                          ? 'danger'
                          : 'success';
                  const reasons = buildDecisionReasons(row, 2);
                  const risk = getDecisionRisk(row);
                  const priceChange = getPriceChangeLabel(row);
                  const archivedAt = row.archivedAt || row.appliedAt;
                  const validity = getTemporaryPriceValidity(row, archivedAt ? new Date(archivedAt) : new Date());
                  const archiveStatus = getArchivedDecisionStatus(row);
                  return (
                    <tr key={`archive-${row.decisionKey || getPricingDecisionKey(row)}`} className="pricing-action-row pricing-decision-row pricing-row--applied">
                      <td>
                        <StatusBadge tone={archiveStatus.tone}>
                          {archiveStatus.label}
                        </StatusBadge>
                      </td>
                      <td>
                        <div className="pricing-product-cell">
                          <strong>{String(row.productName || '').trim() || 'Bilinmeyen ürün'}</strong>
                          <span>SKU: {String(row.sku || '').trim() || '-'}</span>
                          <small>{String(row.category || row.categoryName || '').trim() || '-'}</small>
                        </div>
                      </td>
                      <td>
                        <StatusBadge tone={actionTone}>{decisionAction}</StatusBadge>
                      </td>
                      <td>
                        <div className="pricing-reason-chips">
                          {(reasons.length ? reasons : ['Veri yetersiz']).map((item) => <span key={item}>{item}</span>)}
                        </div>
                      </td>
                      <td>
                        <StatusBadge tone={risk.tone}>{risk.label}</StatusBadge>
                      </td>
                      <td>
                        <div className="pricing-price-decision">
                          <span>{formatCurrency(row.currentPrice)}</span>
                          <strong>{formatCurrency(row.suggestedPrice)}</strong>
                          <small>{priceChange}</small>
                        </div>
                      </td>
                      <td>
                        <div className="pricing-validity-cell">
                          <strong>{validity.durationDays} gün</strong>
                          <span>{formatDateShort(validity.endAt)} biter</span>
                        </div>
                      </td>
                      <td>
                        <div className="pricing-decision-actions">
                          <span className="pricing-passive-action-label">
                            {archivedAt ? new Date(archivedAt).toLocaleString('tr-TR') : 'Bu oturum'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BulkPriceUpdateModal
        isOpen={isBulkModalOpen}
        products={bulkModalProducts}
        productsLoading={productsLoading}
        categories={categories}
        labels={categoryLabels}
        onClose={() => setIsBulkModalOpen(false)}
        onApply={handleApplyBulkPriceUpdate}
        isApplying={bulkApplying}
        recentActions={recentPriceActions}
        recentActionsLoading={recentPriceActionsLoading}
        rollbackPendingId={rollbackPendingId}
        onRollbackPriceAction={handleRollbackPriceAction}
      />

      <SellPriceAdvisorModal
        isOpen={isSellPriceModalOpen}
        rows={sellPriceRows}
        rowsLoading={productsLoading}
        onClose={() => setIsSellPriceModalOpen(false)}
        onCalculate={handleCalculateSellPrice}
        onApprove={handleApproveSellPrice}
        calculation={sellPriceCalculation}
        isLoading={sellPriceLoading}
        isApproving={sellPriceApproving}
        recentActions={recentPriceActions}
        recentActionsLoading={recentPriceActionsLoading}
        rollbackPendingId={rollbackPendingId}
        onRollbackPriceAction={handleRollbackPriceAction}
      />

      <PricingActionDetailModal
        row={detailModalRow}
        detail={detailModalRow ? rowDetails[detailModalRow.id] : null}
        isLoading={Boolean(detailModalRow && rowDetailLoadingId === detailModalRow.id)}
        isApplying={Boolean(detailModalRow && rowApplyPendingId === String(detailModalRow.id || detailModalRow.productId || ''))}
        onClose={() => setExpandedRowId('')}
        onApply={handleApplySinglePriceAction}
        onSkip={handleSkipSinglePriceAction}
      />

      {toast.message ? <Toast toast={toast} onClose={() => setToast({ type: '', message: '' })} /> : null}
    </div>
  );
}

export default PricingAnalysis;
