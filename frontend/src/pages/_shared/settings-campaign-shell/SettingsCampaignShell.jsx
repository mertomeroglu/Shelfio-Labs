import { useEffect, useMemo, useRef, useState } from 'react';
import './SettingsCampaignShell.css';
import { SlidersHorizontal, Settings as SettingsIcon, Settings2, BarChart3, Home, BadgePercent, Package, Layers, Tags, Phone, Mail, MapPin, Hash, Building, Save, Shield, ShieldCheck, Lock, LockOpen, Eye, EyeOff, KeyRound, Gift, Plus, Trash2, X, Shuffle, FileText, FileSpreadsheet, ChevronDown, ChevronUp, Megaphone, CalendarDays, TrendingUp, RefreshCw, Eraser, Sparkles, Info, AlertTriangle, CalendarClock, Coins, TrendingDown, PackageSearch, Percent } from 'lucide-react';
import { ResponsiveContainer, BarChart as RBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, LineChart as RLineChart, Line } from 'recharts';
import { useLocation, useNavigate } from 'react-router-dom';
import ConfirmModal, { useDialog } from '../../../components/ConfirmModal.jsx';
import FormModal, { FormGrid, FormSection } from '../../../components/FormModal.jsx';
import PageHeader from '../../../components/PageHeader.jsx';
import PinGate from '../../../components/PinGate.jsx';
import Toast from '../../../components/Toast.jsx';
import { useAuth } from '../../../hooks/useAuth.js';
import { formatCurrency, formatDate, formatNumber, normalizeSearchText } from '../../../services/formatters.js';
import { reportService } from '../../../services/reportService.js';
import { categoryService } from '../../../services/categoryService.js';
import { invalidateProductCache, productService } from '../../../services/productService.js';
import { settingsService } from '../../../services/settingsService.js';
import { customerAdminService } from '../../../services/customerAdminService.js';
import { pricingAnalysisService } from '../../../services/pricingAnalysisService.js';
import { campaignAnalysisService } from '../../../services/campaignAnalysisService.js';
import { procurementService } from '../../../services/procurementService.js';
import { userService } from '../../../services/userService.js';
import { playNotificationTone } from '../../../utils/notificationSound.js';
import { SUPPORT_CONTACT } from '../../../constants/contact.js';
import {
  applyBulkCampaignAction,
  buildCampaignEmptyState,
  buildCampaignSuggestionPresentation,
  buildCampaignSuggestions,
  calculateCampaignImpact,
  CAMPAIGN_SUGGESTION_MODULES,
  CAMPAIGN_TEMPLATE_LIBRARY,
  mapPricingRowsForCampaigns,
  mergeCrossModuleIntelligence,
  previewDynamicRuleImpact,
} from './campaignManagementUtils.js';
import {
  autoSaleRunner,
  AUTO_SALE_DENSITY_OPTIONS,
  AUTO_SALE_DURATION_OPTIONS,
  DEFAULT_AUTO_SALE_CONFIG,
  DEFAULT_AUTO_SALE_SUMMARY,
} from './autoSaleRunner.js';

const DAYS = [
  { key: 'Pazartesi', short: 'Pzt' },
  { key: 'Salı', short: 'Sal' },
  { key: 'Çarşamba', short: 'Çar' },
  { key: 'Perşembe', short: 'Per' },
  { key: 'Cuma', short: 'Cum' },
  { key: 'Cumartesi', short: 'Cts' },
  { key: 'Pazar', short: 'Paz' },
];

const DEFAULT_OPENING_TIME = '10:00';
const DEFAULT_CLOSING_TIME = '22:00';

const createDefaultWeeklySchedule = ({ openingTime = DEFAULT_OPENING_TIME, closingTime = DEFAULT_CLOSING_TIME, closedDays = [] } = {}) => {
  const closedSet = new Set(Array.isArray(closedDays) ? closedDays : []);
  return DAYS.map((day) => ({
    dayKey: day.key,
    opensAt: openingTime,
    closesAt: closingTime,
    isClosed: closedSet.has(day.key),
  }));
};

const normalizeWeeklySchedule = ({ weeklySchedule, openingTime, closingTime, closedDays } = {}) => {
  const fallback = createDefaultWeeklySchedule({ openingTime, closingTime, closedDays });
  if (!Array.isArray(weeklySchedule) || !weeklySchedule.length) {
    return fallback;
  }

  const byDay = new Map(weeklySchedule.map((item) => [String(item?.dayKey || ''), item]));
  return DAYS.map((day) => {
    const source = byDay.get(day.key);
    if (!source) {
      return fallback.find((row) => row.dayKey === day.key);
    }

    const opensAt = /^\d{2}:\d{2}$/.test(String(source.opensAt || '')) ? String(source.opensAt) : DEFAULT_OPENING_TIME;
    const closesAt = /^\d{2}:\d{2}$/.test(String(source.closesAt || '')) ? String(source.closesAt) : DEFAULT_CLOSING_TIME;
    return {
      dayKey: day.key,
      opensAt,
      closesAt,
      isClosed: Boolean(source.isClosed),
    };
  });
};

const normalizeSpecialDays = (items = []) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => ({
      id: String(item?.id || `special-day-${Date.now()}-${index}`),
      startDate: String(item?.startDate || item?.date || ''),
      startTime: /^\d{2}:\d{2}$/.test(String(item?.startTime || item?.opensAt || '')) ?
         String(item?.startTime || item?.opensAt)
        : DEFAULT_OPENING_TIME,
      endDate: String(item?.endDate || ''),
      endTime: /^\d{2}:\d{2}$/.test(String(item?.endTime || '')) ? String(item.endTime) : '',
      date: String(item?.startDate || item?.date || ''),
      opensAt: /^\d{2}:\d{2}$/.test(String(item?.startTime || item?.opensAt || '')) ?
         String(item?.startTime || item?.opensAt)
        : DEFAULT_OPENING_TIME,
      closesAt: /^\d{2}:\d{2}$/.test(String(item?.endTime || item?.closesAt || item?.startTime || item?.opensAt || '')) ?
         String(item?.endTime || item?.closesAt || item?.startTime || item?.opensAt)
        : DEFAULT_CLOSING_TIME,
      isClosed: Boolean(item?.isClosed),
      note: String(item?.note || '').trim(),
    }))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.startDate));
};

const deriveLegacyWorkingHours = (weeklySchedule = []) => {
  const normalized = normalizeWeeklySchedule({ weeklySchedule });
  const closedDays = normalized.filter((row) => row.isClosed).map((row) => row.dayKey);
  const firstOpenDay = normalized.find((row) => !row.isClosed) || normalized[0];

  return {
    openingTime: firstOpenDay?.opensAt || DEFAULT_OPENING_TIME,
    closingTime: firstOpenDay?.closesAt || DEFAULT_CLOSING_TIME,
    closedDays,
  };
};

const normalizeLogisticsTariffs = (rows = []) => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => ({
      id: String(row?.id || `cargo-tariff-${Date.now()}-${index}`),
      cargoTypeCode: String(row?.cargoTypeCode || '').trim().toLowerCase(),
      cargoTypeName: String(row?.cargoTypeName || '').trim(),
      deliveryTarget: String(row?.deliveryTarget || '').trim(),
      storageCompatibility: String(row?.storageCompatibility || '').trim().toLowerCase(),
      distanceType: String(row?.distanceType || 'intercity').trim().toLowerCase(),
      pricingUnit: String(row?.pricingUnit || 'case').trim().toLowerCase(),
      caseQtyMin: Number(row?.caseQtyMin || 1),
      caseQtyMax: row?.caseQtyMax === null || row?.caseQtyMax === undefined || row?.caseQtyMax === '' ? null : Number(row.caseQtyMax),
      basePriceTl: Number(row?.basePriceTl || 0),
      incrementalPricePerCase: row?.incrementalPricePerCase === null || row?.incrementalPricePerCase === undefined || row?.incrementalPricePerCase === '' ? null : Number(row.incrementalPricePerCase),
      desiMin: row?.desiMin === null || row?.desiMin === undefined || row?.desiMin === '' ? null : Number(row.desiMin),
      desiMax: row?.desiMax === null || row?.desiMax === undefined || row?.desiMax === '' ? null : Number(row.desiMax),
      incrementalPricePerDesi: row?.incrementalPricePerDesi === null || row?.incrementalPricePerDesi === undefined || row?.incrementalPricePerDesi === '' ? null : Number(row.incrementalPricePerDesi),
      isColdChain: row?.isColdChain === true,
      isFrozenChain: row?.isFrozenChain === true,
      isInternalTransfer: row?.isInternalTransfer === true,
      isActive: row?.isActive !== false,
      notes: String(row?.notes || '').trim(),
    }))
    .filter((row) => row.cargoTypeCode && row.cargoTypeName)
    .sort((a, b) => {
      const byType = a.cargoTypeName.localeCompare(b.cargoTypeName, 'tr-TR');
      if (byType !== 0) return byType;
      return Number(a.caseQtyMin || 0) - Number(b.caseQtyMin || 0);
    });
};

const formatCaseRange = (row) => {
  if (row.caseQtyMax === null || row.caseQtyMax === undefined) {
    return `${formatNumber(row.caseQtyMin)}+`;
  }
  return `${formatNumber(row.caseQtyMin)} - ${formatNumber(row.caseQtyMax)}`;
};

const STORAGE_COMPATIBILITY_LABELS = {
  ambient: 'Ambiyans',
  cold: 'Soğuk',
  frozen: 'Donuk',
  internal: 'İç Transfer',
};

const DISTANCE_TYPE_LABELS = {
  intercity: 'Şehirlerarası',
  internal_transfer: 'İç Transfer',
};

const formatStorageCompatibility = (value) => {
  const parts = String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) return '-';
  return parts.map((item) => STORAGE_COMPATIBILITY_LABELS[item] || item).join(', ');
};

const STANDARD_TAX_NUMBER = '1567957351';

const initialForm = {
  currency: 'TRY',
  dateFormat: 'DD.MM.YYYY',
  storeName: '',
  branchCode: '',
  storeAddress: '',
  storePhone: '',
  storeEmail: '',
  taxNumber: STANDARD_TAX_NUMBER,
  openingTime: DEFAULT_OPENING_TIME,
  closingTime: DEFAULT_CLOSING_TIME,
  closedDays: [],
  holidayMode: false,
  weeklySchedule: createDefaultWeeklySchedule(),
  specialDays: [],
  logisticsTariffs: [],
  customerRelations: {
    giftCards: [],
    campaigns: [],
    automationCenter: {
      enabled: false,
      autoCreateTasks: false,
      notifyOnCritical: true,
      taskAssigneeUserId: '',
      rules: [],
    },
  },
};

const createDefaultGiftCardDraft = () => ({
  code: '',
  name: '',
  valueType: 'amount',
  value: '',
  usageLimit: '1',
  isAllCategoriesSelected: true,
  allowedCategoryIds: [],
  rewardMode: 'none',
  minSpendForReward: '',
  loyaltyPointCost: '',
  expiresAt: '',
});

const createDefaultCampaignDraft = () => ({
  name: '',
  internalName: '',
  recommendationTitle: '',
  publicName: '',
  type: 'general',
  sourceModule: '',
  discountRate: '',
  startsAt: '',
  endsAt: '',
  isIndefinite: false,
  priority: 0,
  targetCategoryIds: [],
  targetProductIds: [],
  targetBrands: [],
  triggerSalesSpeed: 'any',
  triggerTrendDirection: 'any',
  minOverStockRatio: '1.2',
  isActive: true,
  targetBrand: '',
  targetProductIdsText: '',
  giftCardRewardEnabled: false,
  giftCardRewardCode: '',
  dynamicRule: {
    salesBelow: '1',
    stockAbove: '40',
    expiryBelow: '10',
    discountRate: '15',
  },
});

const FIXED_DATE_CAMPAIGN_TYPES = new Set(['general', 'product', 'category', 'brand']);

const normalizePublicCampaignKey = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isInternalCampaignName = (value) => {
  const key = normalizePublicCampaignKey(value);
  if (!key) return false;
  return /\b(aksiyon onerisi|aksiyon|oneri|draft|test|internal|sinyal|talep sinyali)\b/.test(key)
    || /\bicin\s+(hizli indirim|aksiyon|indirim onerisi|oneri)\b/.test(key);
};

const resolvePublicCampaignName = ({ name = '', type = 'general', sourceModule = '' } = {}) => {
  const cleanName = normalizeCampaignInsightText(name).replace(/\s+\d{1,3}$/, '').trim();
  const moduleKey = normalizeCampaignModuleKey(sourceModule, '');
  const typeKey = String(type || 'general').trim().toLowerCase();

  if (moduleKey === 'expiry' || typeKey === 'expiry') return 'SKT Yaklaşan Ürünlerde Fırsat';
  if (moduleKey === 'sales' || typeKey === 'sales') return 'Satış Fırsatları';
  if (cleanName && !isInternalCampaignName(cleanName)) return cleanName;
  if (typeKey === 'category') return 'Kategori Fırsatları';
  if (typeKey === 'brand') return 'Marka Fırsatları';
  if (typeKey === 'product') return 'Seçili Ürünlerde İndirim';
  return 'Haftanın İndirimli Ürünleri';
};

const createDefaultAutomationRuleDraft = () => ({
  name: '',
  triggerType: 'critical_stock',
  threshold: '0',
  actionType: 'notify',
  waitDays: '3',
  followUpTriggerType: 'low_sales_velocity',
  isActive: true,
});

const CAMPAIGN_TYPE_LABELS = {
  general: 'Genel',
  category: 'Kategori',
  product: 'Ürün',
  brand: 'Marka',
  expiry: 'SKT Bazlı',
  sales: 'Satış Bazlı',
  dynamic: 'Dinamik',
};

const CAMPAIGN_VIEW_KEYS = new Set(['all', 'general', 'product', 'category', 'brand', 'expiry', 'sales', 'giftCards', 'dynamic']);

const normalizeCampaignViewKey = (value, fallback = 'all') => {
  const normalized = String(value || '').trim();
  return CAMPAIGN_VIEW_KEYS.has(normalized) ? normalized : fallback;
};

const CAMPAIGN_STATUS_LABELS = {
  active: 'Yayında',
  scheduled: 'Planlandı',
  paused: 'Yayında değil',
  inactive: 'Yayında değil',
  draft: 'Yayında değil',
  archived: 'Yayında değil',
  expired: 'Süresi bitti',
};

const CAMPAIGN_SUGGESTION_PRIORITY_LABELS = {
  critical: 'Kritik',
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük',
};

const CAMPAIGN_TABLE_PAGE_SIZE = 5;
const CAMPAIGN_SUGGESTIONS_PAGE_SIZE = 5;
const CAMPAIGN_INSIGHT_PAGE_SIZE = 5;
const CAMPAIGN_SIGNAL_TABLE_PAGE_SIZE = 5;
const BRAND_INITIAL_VISIBLE_LIMIT = 10;
const INVALID_CAMPAIGN_BRAND_KEYS = new Set([
  '',
  '-',
  'bilinmiyor',
  'bilinmiyor marka',
  'marka yok',
  'yok',
  'unknown',
  'undefined',
  'null',
  'demo',
  'test',
  'n a',
  'na',
]);

const clampCampaignMetric = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeCampaignBrandLabel = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const repairSettingsMojibake = (value) => {
  const text = String(value || '');
  if (!/[\u00c3\u00c4\u00c5\u00e2\u00c2]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from(Array.from(text).map((char) => char.charCodeAt(0) & 0xff));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return text;
  }
};
const normalizeCampaignText = (value) => normalizeCampaignUiText(String(value || '').replace(/D\u00e2\u201a\u00bak/g, 'Düşük'));
const formatCampaignCount = (value, suffix = '') => `${formatNumber(value)}${suffix ? ` ${suffix}` : ''}`;
const formatCampaignMetricValue = (label, value, suffix = '') => `${label}: ${formatNumber(value)}${suffix ? ` ${suffix}` : ''}`;
const formatCampaignCoverageDays = (stockLevel, salesVelocity) => {
  const stock = Number(stockLevel || 0);
  const velocity = Number(salesVelocity || 0);
  if (stock <= 0) return 'Stok bulunmuyor';
  if (velocity <= 0) return 'Satış verisi yok';
  return `${formatNumber(stock / velocity)} gün`;
};
const formatCampaignDailySales = (salesVelocity) => {
  const velocity = Number(salesVelocity || 0);
  return velocity > 0 ? `${formatNumber(velocity)} adet` : 'Yeterli satış verisi yok';
};
const formatCampaignMarginPercent = (row = {}) => {
  const margin = Number(row?.currentMarginPercent);
  const hasPricingBasis = Number(row?.currentPrice || 0) > 0 || Number(row?.cost || 0) > 0;
  if (!Number.isFinite(margin) || (!hasPricingBasis && margin === 0)) return 'Veri yok';
  return `%${formatNumber(margin)}`;
};
const formatCampaignRefreshDateTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;
};
const getCampaignRiskLabel = (value) => CAMPAIGN_SUGGESTION_PRIORITY_LABELS[String(value || '').toLowerCase()] || 'Orta';

const CampaignChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const count = Number(payload[0]?.value || 0);
  return (
    <div className="campaign-chart-tooltip">
      <strong>{label}</strong>
      <span>{formatNumber(count)} kayıt</span>
    </div>
  );
};
const getExpiryRiskLevel = (daysToExpiry) => {
  const days = Number(daysToExpiry);
  if (!Number.isFinite(days)) return 'low';
  if (days <= 0) return 'critical';
  if (days <= 3) return 'high';
  if (days <= 7) return 'medium';
  return 'low';
};
const normalizeCampaignModuleKey = (value, fallback = 'general') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (['all', 'general', 'product', 'category', 'brand', 'expiry', 'sales', 'giftcards', 'giftCards'].includes(normalized)) {
    return normalized === 'giftcards' ? 'giftCards' : normalized;
  }
  return fallback;
};
const CAMPAIGN_MODULE_TYPE_MAP = {
  general: new Set(['general']),
  product: new Set(['product']),
  category: new Set(['category']),
  brand: new Set(['brand']),
  expiry: new Set(['expiry']),
  sales: new Set(['sales']),
  giftCards: new Set(['giftCards']),
};
const EXPIRY_SUGGESTION_IDS = new Set(['near-expiry']);
const SALES_SUGGESTION_IDS = new Set(['slow-moving']);
const EXPIRY_SIGNAL_TYPES = new Set(['SKT Yaklaşıyor', 'Stok Fazlası', 'Yavaş Satıyor', 'İzleme Gerekiyor']);
const SALES_SIGNAL_TYPES = new Set(['Stok Baskısı', 'Yavaş Satıyor', 'Çok Satıyor', 'Marj Fırsatı', 'Dengeli Performans']);
const classifyCampaignModule = (item = {}) => {
  const scope = normalizeCampaignModuleKey(item?.scope || item?.module || item?.campaignType, '');
  if (CAMPAIGN_MODULE_TYPE_MAP[scope]) return scope;

  const sourceModule = normalizeCampaignModuleKey(item?.sourceModule, '');
  if (CAMPAIGN_MODULE_TYPE_MAP[sourceModule]) return sourceModule;

  const directType = normalizeCampaignModuleKey(item?.type, '');
  if (CAMPAIGN_MODULE_TYPE_MAP[directType]) return directType;

  const tags = [
    item?.targetScope,
    item?.ruleType,
    item?.triggerType,
    item?.sourceModule,
    item?.reason,
    item?.name,
  ]
    .map((value) => normalizeCampaignText(value).toLocaleLowerCase('tr-TR'))
    .filter(Boolean)
    .join(' ');

  if (tags.includes('skt') || tags.includes('son kullanma') || tags.includes('expiry')) return 'expiry';
  if (tags.includes('satış') || tags.includes('stok devri') || tags.includes('marj') || tags.includes('sales')) return 'sales';
  if (Array.isArray(item?.targetBrands) && item.targetBrands.length) return 'brand';
  if (Array.isArray(item?.targetCategoryIds) && item.targetCategoryIds.length) return 'category';
  if (Array.isArray(item?.targetProductIds) && item.targetProductIds.length) return 'product';
  return 'general';
};
const isCampaignInModule = (item, moduleKey) => {
  if (moduleKey === 'all') return true;
  if (moduleKey === 'giftCards') return normalizeCampaignModuleKey(item?.type, '') === 'giftCards';
  return classifyCampaignModule(item) === moduleKey;
};
const getCampaignToneClass = (value) => {
  const key = String(value || '').toLowerCase();
  if (key === 'critical' || key === 'high') return 'is-danger';
  if (key === 'medium') return 'is-warning';
  return 'is-neutral';
};
const formatCampaignMetaLine = (...parts) => parts.filter(Boolean).map((part) => normalizeCampaignText(part)).join(' • ');
const getCampaignSignalType = (row = {}, mode = 'sales') => {
  const daysToExpiry = Number.isFinite(Number(row?.daysToExpiry)) ? Number(row.daysToExpiry) : null;
  const stockLevel = Number(row?.stockLevel || 0);
  const salesVelocity = Number(row?.salesVelocity || 0);
  const margin = Number(row?.currentMarginPercent || 0);
  const stockCoverage = salesVelocity > 0 ? stockLevel / salesVelocity : stockLevel;

  if (mode === 'expiry') {
    if (daysToExpiry != null && daysToExpiry <= 3) return 'SKT Yaklaşıyor';
    if (stockCoverage >= 45) return 'Stok Fazlası';
    if (salesVelocity <= 1.2) return 'Yavaş Satıyor';
    return 'İzleme Gerekiyor';
  }

  if (stockCoverage >= 45) return 'Stok Baskısı';
  if (salesVelocity <= 1.2) return 'Yavaş Satıyor';
  if (salesVelocity >= 3.5 && margin >= 18) return 'Çok Satıyor';
  if (margin >= 28) return 'Marj Fırsatı';
  return 'Dengeli Performans';
};
const buildCampaignSignalSummary = (row = {}, mode = 'sales') => {
  const signal = getCampaignSignalType(row, mode);
  const daysToExpiry = Number.isFinite(Number(row?.daysToExpiry)) ? Number(row.daysToExpiry) : null;
  const stockLevel = Number(row?.stockLevel || 0);
  const salesVelocity = Number(row?.salesVelocity || 0);
  const margin = Number(row?.currentMarginPercent || 0);
  const stockCoverage = salesVelocity > 0 ? stockLevel / salesVelocity : stockLevel;

  if (signal === 'SKT Yaklaşıyor') {
    return 'Son kullanma tarihi yaklaşan ürünlerde hızlı indirim aksiyonu fire riskini azaltır.';
  }
  if (signal === 'Stok Fazlası') {
    return 'Stok seviyesi satış hızına göre yüksek. Eritme kampanyası için öncelikli adaydır.';
  }
  if (signal === 'Stok Baskısı') {
    return 'Mevcut stok, satış hızına kıyasla uzun süre rafta kalacak görünüyor.';
  }
  if (signal === 'Yavaş Satıyor') {
    return 'Günlük satış ortalaması düşük. Görünürlük ve fiyat aksiyonu test edilmelidir.';
  }
  if (signal === 'Çok Satıyor') {
    return 'Talep güçlü ve satış istikrarlı. Kontrollü fiyat artışı veya marj optimizasyonu denenebilir.';
  }
  if (signal === 'Marj Fırsatı') {
    return 'Marj seviyesi güçlü. Kampanya yerine fiyat testi veya sepet büyütme aksiyonu daha uygun olabilir.';
  }
  if (daysToExpiry != null && daysToExpiry <= 7) {
    return `SKT’ye ${formatNumber(daysToExpiry)} gün kaldı. Stok ve satış birlikte izlenmeli.`;
  }
  return `Stok: ${formatNumber(stockLevel)} adet, günlük satış: ${formatNumber(salesVelocity)} adet, brüt marj: %${formatNumber(margin)}.`;
};
const buildCampaignActionRecommendation = (row = {}, mode = 'sales') => {
  const signal = getCampaignSignalType(row, mode);
  const discount = Math.max(10, Math.round(Number(row?.suggestedDiscount || 0) || 0));
  const margin = Number(row?.currentMarginPercent || 0);
  if (signal === 'SKT Yaklaşıyor') return `%${discount || 25} hızlı indirim öner`;
  if (signal === 'Stok Fazlası' || signal === 'Stok Baskısı') return 'Çoklu alım veya raf önü kampanyası öner';
  if (mode === 'sales' && margin < 12 && signal === 'Yavaş Satıyor') return 'Kampanya gerekmez';
  if (signal === 'Yavaş Satıyor') return `%${Math.max(10, discount || 18)} indirimle satış testi yap`;
  if (signal === 'Çok Satıyor') return 'Küçük fiyat artışı testi yap';
  if (signal === 'Marj Fırsatı') return 'Fiyat artırımı veya sepet büyütme aksiyonu dene';
  return 'Aksiyon gerekmiyor';
};
const buildCampaignCompactRecommendation = (row = {}, mode = 'sales') => {
  const signal = getCampaignSignalType(row, mode);
  const margin = Number(row?.currentMarginPercent || 0);
  if (mode === 'expiry') {
    if (signal === 'SKT Yaklaşıyor') return 'Hızlı indirim öner';
    if (signal === 'Stok Fazlası') return 'Stok eritme öner';
    if (signal === 'Yavaş Satıyor') return 'İndirim testi öner';
    return 'Yakın takip öner';
  }
  if (margin < 12 && signal === 'Yavaş Satıyor') return 'Kampanya gerekmez';
  if (signal === 'Stok Baskısı') return 'Çoklu alım kampanyası öner';
  if (signal === 'Yavaş Satıyor') return 'İndirim kampanyası öner';
  if (signal === 'Çok Satıyor') return 'Fiyat artışı test et';
  if (signal === 'Marj Fırsatı') return 'Fiyat artışı test et';
  return 'Kampanya gerekmez';
};
const getCampaignActionTone = (recommendation = '') => {
  const text = String(recommendation || '').toLowerCase();
  if (text.includes('hızlı indirim') || text.includes('indirim')) return 'is-danger';
  if (text.includes('fiyat art')) return 'is-success';
  if (text.includes('çoklu alım')) return 'is-warning';
  return 'is-neutral';
};
const getExpiryStatusBadgeMeta = (daysToExpiry) => {
  const days = Number(daysToExpiry);
  if (!Number.isFinite(days)) return { label: 'Belirsiz', toneClass: 'is-neutral' };
  if (days < 0) return { label: `${formatNumber(Math.abs(days))} gün geçti`, toneClass: 'is-danger' };
  if (days === 0) return { label: 'Bugün', toneClass: 'is-danger' };
  if (days <= 3) return { label: `${formatNumber(days)} gün kaldı`, toneClass: 'is-warning' };
  return { label: `${formatNumber(days)} gün kaldı`, toneClass: days <= 7 ? 'is-info' : 'is-neutral' };
};
const CAMPAIGN_METRIC_EXPLANATIONS = [
  {
    title: 'Stok baskısı',
    description: 'Satış hızına göre fazla stok.',
  },
  {
    title: 'Yavaş satan ürün',
    description: 'Günlük satış ortalaması zayıf.',
  },
  {
    title: 'Ortalama marj',
    description: 'Seçili ürünlerin brüt marjı.',
  },
  {
    title: 'Stok tükenme süresi',
    description: 'Satış varsa tahmini stok ömrü.',
  },
];

const isValidCampaignBrandLabel = (value) => {
  const label = normalizeCampaignBrandLabel(value);
  if (!label) return false;
  const normalizedKey = normalizeSearchText(label);
  if (!normalizedKey) return false;
  return !INVALID_CAMPAIGN_BRAND_KEYS.has(normalizedKey);
};

const buildCampaignBrandOptions = (products = []) => {
  const brandMap = new Map();
  (Array.isArray(products) ? products : []).forEach((product) => {
    const brandLabel = normalizeCampaignBrandLabel(product?.brand || product?.brandName || product?.productListView?.brand || '');
    if (!isValidCampaignBrandLabel(brandLabel)) return;
    const brandKey = normalizeSearchText(brandLabel);
    if (!brandKey || brandMap.has(brandKey)) return;
    brandMap.set(brandKey, brandLabel);
  });
  return Array.from(brandMap.values()).sort((left, right) => left.localeCompare(right, 'tr-TR'));
};

const normalizeCampaignBrandSelections = (values = [], brandLabelMap = new Map()) => {
  const seen = new Set();
  return (Array.isArray(values) ? values : [values])
    .map((value) => {
      const label = normalizeCampaignBrandLabel(value);
      if (!isValidCampaignBrandLabel(label)) return '';
      const key = normalizeSearchText(label);
      if (!key || seen.has(key)) return '';
      seen.add(key);
      return brandLabelMap.get(key) || label;
    })
    .filter(Boolean);
};

const resolveCampaignDaysToExpiry = (product = {}) => {
  if (product?.daysToExpiry != null && Number.isFinite(Number(product.daysToExpiry))) {
    return Number(product.daysToExpiry);
  }

  const rawExpiry = product?.nearestExpiry || product?.expiryDate || product?.skt || product?.fefoBatch?.skt || '';
  if (!rawExpiry) return null;
  const expiryDate = new Date(rawExpiry);
  if (Number.isNaN(expiryDate.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  expiryDate.setHours(0, 0, 0, 0);
  return Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

const deriveFallbackCampaignRow = (product = {}, index = 0) => {
  const stockLevel = Number(product?.currentStock ?? product?.stockLevel ?? product?.totalStock ?? product?.stock ?? 0) || 0;
  const salesVelocity = Math.max(0, Number(product?.avgDailySales ?? product?.salesVelocity ?? product?.dailySalesRate ?? 0) || 0);
  const currentPrice = Math.max(0, Number(product?.currentPrice ?? product?.salePrice ?? product?.price ?? 0) || 0);
  const cost = Math.max(0, Number(product?.cost ?? product?.purchasePrice ?? product?.costPrice ?? 0) || 0);
  const daysToExpiry = resolveCampaignDaysToExpiry(product);
  const currentMarginPercent = currentPrice > 0 ? Number((((currentPrice - cost) / currentPrice) * 100).toFixed(1)) : 0;
  const stockCoverageDays = salesVelocity > 0 ? stockLevel / salesVelocity : Number.POSITIVE_INFINITY;
  const suggestedDiscount = daysToExpiry != null && daysToExpiry <= 3
    ? 28
    : daysToExpiry != null && daysToExpiry <= 7
      ? 22
      : stockCoverageDays >= 45
        ? 18
        : stockCoverageDays >= 21
          ? 14
          : salesVelocity <= 1
            ? 10
            : 6;

  let riskLevel = 'low';
  if ((daysToExpiry != null && daysToExpiry <= 3) || (stockLevel > 60 && salesVelocity <= 0.4)) riskLevel = 'critical';
  else if ((daysToExpiry != null && daysToExpiry <= 7) || stockCoverageDays >= 35 || currentMarginPercent < 12) riskLevel = 'high';
  else if (stockCoverageDays >= 18 || salesVelocity <= 1.2) riskLevel = 'medium';

  return {
    id: String(product?.id || `campaign-fallback-${index}`),
    productId: String(product?.id || `campaign-fallback-${index}`),
    productName: normalizeCampaignText(String(product?.name || product?.productName || `Ürün ${index + 1}`)),
    category: normalizeCampaignText(String(product?.categoryName || product?.category || '-')),
    categoryId: String(product?.categoryId || product?.category || ''),
    brand: normalizeCampaignText(normalizeCampaignBrandLabel(product?.brand || product?.brandName || '')),
    supplierName: normalizeCampaignText(String(product?.supplierName || '-')),
    stockLevel,
    salesVelocity,
    daysToExpiry,
    currentPrice,
    cost,
    currentMarginPercent,
    suggestedDiscount,
    riskLevel,
  };
};

const averageCampaignMetric = (rows = [], selector = () => 0) => {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + Number(selector(row) || 0), 0) / rows.length;
};

const buildCampaignSimulationSnapshot = ({
  rows = [],
  discountRate = 0,
  durationDays = 7,
  scopeLabel = 'Genel kampanya',
  currency = 'TRY',
  emptyMessage = 'Simülasyon için veri bulunamadı.',
  scopeProductCount = null,
} = {}) => {
  const scopedRows = (Array.isArray(rows) ? rows : []).filter((row) => row && (
    Number(row?.currentPrice || 0) > 0
    || Number(row?.stockLevel || 0) > 0
    || Number(row?.salesVelocity || 0) > 0
  ));
  const analysisCandidateCount = scopedRows.length;
  const resolvedScopeProductCount = Number(scopeProductCount);
  const productCount = Number.isFinite(resolvedScopeProductCount) && resolvedScopeProductCount > 0
    ? resolvedScopeProductCount
    : analysisCandidateCount;

  if (!scopedRows.length) {
    return {
      isEmpty: true,
      scopeLabel,
      currency,
      productCount,
      eligibleProductCount: productCount,
      affectedProductCount: productCount,
      analysisCandidateCount,
      previewProductCount: analysisCandidateCount,
      title: 'Etki simülasyonu hazır değil',
      emptyMessage,
      recommendation: 'Kapsam seçimi yaptıktan veya veri geldikten sonra simülasyon hesaplanır.',
      riskLevel: 'Bilgi yok',
      salesIncreasePct: 0,
      revenueChange: 0,
      marginImpact: 0,
      stockDepletionDays: 0,
      stockTurnEffect: 0,
      riskReductionScore: 0,
      metricsSummary: '',
    };
  }

  const safeDiscount = clampCampaignMetric(Number(discountRate || 0) || 0, 0, 80);
  const safeDuration = Math.max(1, Number(durationDays || 7) || 7);
  const avgPrice = Math.max(1, averageCampaignMetric(scopedRows, (row) => row.currentPrice || 0));
  const avgCost = Math.max(0, averageCampaignMetric(scopedRows, (row) => row.cost || 0));
  const avgDailySales = Math.max(0, averageCampaignMetric(scopedRows, (row) => row.salesVelocity || 0));
  const avgStockLevel = Math.max(0, averageCampaignMetric(scopedRows, (row) => row.stockLevel || 0));
  const expiryRows = scopedRows.filter((row) => row?.daysToExpiry != null && Number.isFinite(Number(row.daysToExpiry)));
  const avgDaysToExpiry = expiryRows.length ? averageCampaignMetric(expiryRows, (row) => Number(row.daysToExpiry || 0)) : null;

  const baseImpact = calculateCampaignImpact({
    discountRate: safeDiscount,
    productCount: scopedRows.length,
    durationDays: safeDuration,
    avgPrice,
    avgCost,
    baselineDailySales: avgDailySales,
    avgStockLevel,
    avgDaysToExpiry,
  });

  const totalStock = scopedRows.reduce((sum, row) => sum + Math.max(0, Number(row?.stockLevel || 0)), 0);
  const totalDailySales = scopedRows.reduce((sum, row) => sum + Math.max(0, Number(row?.salesVelocity || 0)), 0);
  if (totalDailySales <= 0) {
    const scopeCountText = productCount > analysisCandidateCount
      ? `${formatNumber(productCount)} ürün kapsamı ve ${formatNumber(analysisCandidateCount)} analiz adayı`
      : `${formatNumber(analysisCandidateCount)} ürün`;
    return {
      isEmpty: false,
      scopeLabel,
      currency,
      productCount,
      eligibleProductCount: productCount,
      affectedProductCount: productCount,
      analysisCandidateCount,
      previewProductCount: analysisCandidateCount,
      avgPrice,
      avgCost,
      avgDailySales,
      avgStockLevel,
      avgDaysToExpiry,
      inventoryCoverageDays: null,
      salesIncreasePct: null,
      revenueChange: null,
      marginImpact: null,
      stockDepletionDays: null,
      stockTurnEffect: null,
      riskReductionScore: null,
      hasEnoughSalesData: false,
      dataQuality: {
        status: 'insufficient_data',
        reason: 'missing_sales_velocity',
      },
      riskLevel: 'Bilgi yok',
      recommendation: 'Bu kampanya kapsamı için yeterli satış geçmişi bulunmadığından tahmin üretilemedi.',
      explanation: 'Bu kampanya kapsamı için yeterli satış geçmişi bulunmadığından tahmin üretilemedi.',
      metricsSummary: `${scopeCountText} • satış geçmişi yok`,
    };
  }
  const zeroStockShare = scopedRows.filter((row) => Number(row?.stockLevel || 0) <= 0).length / scopedRows.length;
  const lowStockShare = scopedRows.filter((row) => {
    const sales = Number(row?.salesVelocity || 0);
    const stock = Number(row?.stockLevel || 0);
    return stock > 0 && stock <= Math.max(3, sales * 5);
  }).length / scopedRows.length;
  const slowSellerShare = scopedRows.filter((row) => Number(row?.salesVelocity || 0) <= 1.2).length / scopedRows.length;
  const fastSellerShare = scopedRows.filter((row) => Number(row?.salesVelocity || 0) >= 3).length / scopedRows.length;
  const overStockShare = scopedRows.filter((row) => {
    const sales = Number(row?.salesVelocity || 0);
    const stock = Number(row?.stockLevel || 0);
    return stock >= Math.max(20, sales * 21);
  }).length / scopedRows.length;
  const campaignPriceByRow = scopedRows.map((row) => {
    const currentPrice = Math.max(0, Number(row?.currentPrice || 0));
    const cost = Math.max(0, Number(row?.cost || 0));
    const campaignPrice = currentPrice * (1 - (safeDiscount / 100));
    const campaignMarginPercent = campaignPrice > 0 ? ((campaignPrice - cost) / campaignPrice) * 100 : -100;
    return {
      campaignPrice,
      cost,
      campaignMarginPercent,
    };
  });
  const negativeMarginShare = campaignPriceByRow.filter((row) => row.campaignPrice <= row.cost).length / scopedRows.length;
  const lowMarginShare = campaignPriceByRow.filter((row) => row.campaignPrice > row.cost && row.campaignMarginPercent < 8).length / scopedRows.length;
  const expiryPressureShare = expiryRows.filter((row) => Number(row?.daysToExpiry || 999) <= 7).length / Math.max(1, expiryRows.length);
  const stockReadiness = clampCampaignMetric(1 - (zeroStockShare * 0.75) - (lowStockShare * 0.25), 0.2, 1);

  const salesIncreasePct = Number((baseImpact.salesIncreasePct * stockReadiness).toFixed(1));
  const revenueChange = Number((baseImpact.revenueChange * stockReadiness).toFixed(2));
  const marginImpact = Number((baseImpact.marginImpact - (negativeMarginShare * 35) - (lowMarginShare * 12)).toFixed(1));
  const stockTurnEffect = Number((baseImpact.stockBurnScore * (1 + (overStockShare * 0.2))).toFixed(1));
  const inventoryCoverageDays = totalDailySales > 0 ? Number((totalStock / totalDailySales).toFixed(1)) : null;
  const stockDepletionDays = Number.isFinite(baseImpact.stockDepletionDays)
    ? Number((baseImpact.stockDepletionDays / stockReadiness).toFixed(1))
    : safeDuration;
  const riskReductionScore = Number((clampCampaignMetric(
    baseImpact.riskReductionScore
      + (expiryPressureShare * 12)
      - (negativeMarginShare * 24)
      - (zeroStockShare * 16),
    0,
    100,
  )).toFixed(1));

  const riskScore = (negativeMarginShare * 55)
    + (lowMarginShare * 24)
    + (zeroStockShare * 30)
    + (lowStockShare * 18)
    + (expiryPressureShare * 22)
    + (overStockShare * 10)
    - (fastSellerShare * 10);
  const riskLevel = riskScore >= 55 ? 'Kritik' : riskScore >= 36 ? 'Yüksek' : riskScore >= 18 ? 'Orta' : 'Düşük';

  const scopeCountText = productCount > analysisCandidateCount
    ? `${formatNumber(productCount)} ürün kapsamı ve ${formatNumber(analysisCandidateCount)} analiz adayı`
    : `${formatNumber(analysisCandidateCount)} ürün`;
  let recommendation = `${scopeLabel} için ${scopeCountText} üzerinden hesaplanan simülasyon hazır.`;
  if (negativeMarginShare > 0.2) {
    recommendation = 'İndirim oranı mevcut marjı fazla zorluyor; kampanyayı daraltın veya oranı düşürün.';
  } else if (zeroStockShare > 0.15) {
    recommendation = 'Stok bulunmayan ürünler etkiyi sınırlıyor; kampanya kapsamını stoğu hazır ürünlerle netleştirin.';
  } else if (expiryPressureShare > 0.35) {
    recommendation = 'SKT baskısı yüksek ürünler kampanyayı destekliyor; kısa süreli ve görünürlük odaklı bir akış önerilir.';
  } else if (overStockShare > 0.3 && slowSellerShare > 0.35) {
    recommendation = 'Yavaş satan yüksek stoklu ürünlerde kampanya stok devrini anlamlı biçimde hızlandırabilir.';
  } else if (fastSellerShare > 0.35 && safeDiscount >= 20) {
    recommendation = 'Hızlı satan ürünlerde yüksek indirim gereksiz marj kaybı yaratabilir; oranı daha kontrollü tutun.';
  }

  return {
    isEmpty: false,
    scopeLabel,
    currency,
    productCount,
    eligibleProductCount: productCount,
    affectedProductCount: productCount,
    analysisCandidateCount,
    previewProductCount: analysisCandidateCount,
    avgPrice,
    avgCost,
    avgDailySales,
    avgStockLevel,
    avgDaysToExpiry,
    inventoryCoverageDays,
    zeroStockShare: Number((zeroStockShare * 100).toFixed(1)),
    negativeMarginShare: Number((negativeMarginShare * 100).toFixed(1)),
    lowMarginShare: Number((lowMarginShare * 100).toFixed(1)),
    salesIncreasePct,
    revenueChange,
    marginImpact,
    stockDepletionDays,
    stockTurnEffect,
    riskReductionScore,
    riskLevel,
    recommendation,
    metricsSummary: `${scopeCountText} • ${formatNumber(avgDailySales)} ortalama günlük satış • ${formatNumber(avgStockLevel)} ortalama stok`,
  };
};

const CAMPAIGN_MODULE_TABLE_TITLES = {
  all: {
    active: 'Aktif Kampanya Listesi',
    archive: 'Kampanya Arşivi',
  },
  general: {
    active: 'Genel Kampanya Aktif Listesi',
    archive: 'Genel Kampanya Arşivi',
  },
  product: {
    active: 'Ürün Bazlı Aktif Kampanya Listesi',
    archive: 'Ürün Bazlı Kampanya Arşivi',
  },
  category: {
    active: 'Kategori Bazlı Aktif Kampanya Listesi',
    archive: 'Kategori Bazlı Kampanya Arşivi',
  },
  brand: {
    active: 'Marka Bazlı Aktif Kampanya Listesi',
    archive: 'Marka Bazlı Kampanya Arşivi',
  },
  expiry: {
    active: 'SKT Bazlı Aktif Kampanya Listesi',
    archive: 'SKT Bazlı Kampanya Arşivi',
  },
  sales: {
    active: 'Satış Bazlı Aktif Kampanya Listesi',
    archive: 'Satış Bazlı Kampanya Arşivi',
  },
  giftCards: {
    active: 'Hediye Kartı Aktif Kampanya Listesi',
    archive: 'Hediye Kartı Kampanya Arşivi',
  },
};

const CAMPAIGN_MODULE_SINGLE_TABLE_TITLES = {
  general: 'Genel Kampanya Listesi',
  product: 'Ürün Bazlı Kampanya Listesi',
  category: 'Kategori Bazlı Kampanya Listesi',
  brand: 'Marka Bazlı Kampanya Listesi',
  expiry: 'SKT Bazlı Kampanya Listesi',
  sales: 'Satış Bazlı Kampanya Listesi',
};

const CAMPAIGN_TABLE_SECTION_META = {
  all: {
    active: { title: 'Aktif Kampanya Listesi', description: 'Yayında olan kampanyalar.', icon: ShieldCheck },
    archive: { title: 'Kampanya Arşivi', description: 'Geçmiş, pasif veya arşivlenmiş kampanyalar.', icon: CalendarDays },
  },
  general: {
    active: { title: 'Genel Kampanya Aktif Listesi', description: 'Genel kapsamlı aktif kampanyalar.', icon: Megaphone },
    archive: { title: 'Genel Kampanya Arşivi', description: 'Genel kampanyaların kapanan kayıtları.', icon: CalendarDays },
  },
  product: {
    active: { title: 'Ürün Bazlı Aktif Kampanya Listesi', description: 'Ürün seçimine dayalı aktif kampanyalar.', icon: Gift },
    archive: { title: 'Ürün Bazlı Kampanya Arşivi', description: 'Ürün bazlı tamamlanan veya duran kampanyalar.', icon: CalendarDays },
  },
  category: {
    active: { title: 'Kategori Bazlı Aktif Kampanya Listesi', description: 'Kategori odaklı aktif kampanyalar.', icon: Hash },
    archive: { title: 'Kategori Bazlı Kampanya Arşivi', description: 'Kategori bazlı kapanan kampanya kayıtları.', icon: CalendarDays },
  },
  brand: {
    active: { title: 'Marka Bazlı Aktif Kampanya Listesi', description: 'Marka odaklı aktif kampanyalar.', icon: Building },
    archive: { title: 'Marka Bazlı Kampanya Arşivi', description: 'Marka bazlı kapanan kampanya kayıtları.', icon: CalendarDays },
  },
  expiry: {
    active: { title: 'SKT Bazlı Aktif Kampanya Listesi', description: 'SKT baskısı nedeniyle tetiklenen aktif kampanyalar.', icon: CalendarDays },
    archive: { title: 'SKT Bazlı Kampanya Arşivi', description: 'SKT odaklı kapanan kampanya kayıtları.', icon: CalendarDays },
  },
  sales: {
    active: { title: 'Satış Bazlı Aktif Kampanya Listesi', description: 'Satış hızı ve stok devrine göre aktif kampanyalar.', icon: TrendingUp },
    archive: { title: 'Satış Bazlı Kampanya Arşivi', description: 'Satış performansı odaklı tamamlanan kampanyalar.', icon: CalendarDays },
  },
};

const CAMPAIGN_TYPE_FILTER_TABS = [
  { key: 'all', label: 'Ana Sayfa', type: '' },
  { key: 'giftCards', label: 'Hediye Kartı', type: 'giftCards' },
  { key: 'general', label: 'Genel', type: 'general' },
  { key: 'product', label: 'Ürün Bazlı', type: 'product' },
  { key: 'category', label: 'Kategori Bazlı', type: 'category' },
  { key: 'brand', label: 'Marka Bazlı', type: 'brand' },
  { key: 'expiry', label: 'SKT Bazlı', type: 'expiry' },
  { key: 'sales', label: 'Satış Bazlı', type: 'sales' },
];

const CAMPAIGN_TYPE_TAB_ICONS = {
  all: Home,
  giftCards: Gift,
  general: BadgePercent,
  product: Package,
  category: Layers,
  brand: Tags,
  expiry: CalendarDays,
  sales: TrendingUp,
  dynamic: Settings2,
};

const CAMPAIGN_MODULE_HEADER_ICON_CLASSES = {
  giftCards: 'mod-icon-rose',
  general: 'mod-icon-violet',
  product: 'mod-icon-violet',
  category: 'mod-icon-violet',
  brand: 'mod-icon-violet',
  expiry: 'mod-icon-amber',
  sales: 'mod-icon-indigo',
};

const SETTINGS_TURKISH_TEXT_REPLACEMENTS = [
  ['\u00c3\u00bc', '\u00fc'],
  ['\u00c3\u00b6', '\u00f6'],
  ['\u00c3\u00a7', '\u00e7'],
  ['\u00c4\u00b1', '\u0131'],
  ['\u00c4\u00b0', '\u0130'],
  ['\u00c4\u009f', '\u011f'],
  ['\u00c4\u0178', '\u011f'],
  ['\u00c4\u009e', '\u011e'],
  ['\u00c4\u017e', '\u011e'],
  ['\u00c5\u009f', '\u015f'],
  ['\u00c5\u0178', '\u015f'],
  ['\u00c5\u009e', '\u015e'],
  ['\u00c5\u017e', '\u015e'],
  ['\u00c3\u0153', '\u00dc'],
  ['\u00c3\u009c', '\u00dc'],
  ['\u00c3\u2013', '\u00d6'],
  ['\u00c3\u0096', '\u00d6'],
  ['\u00c3\u2021', '\u00c7'],
  ['\u00c3\u0087', '\u00c7'],
  ['\u00c2\u00b7', '\u00b7'],
  ['\u00e2\u20ac\u00a2', '\u2022'],
  ['\u00e2\u0080\u00a2', '\u2022'],
];

const normalizeCampaignUiText = (value) => {
  const repaired = repairSettingsMojibake(String(value || ''));
  return SETTINGS_TURKISH_TEXT_REPLACEMENTS.reduce(
    (text, [wrong, correct]) => text.split(wrong).join(correct),
    repaired,
  );
};

const CAMPAIGN_INSIGHT_TURKISH_WORD_REPLACEMENTS = [
  [/\bURUN\b/g, 'ÜRÜN'],
  [/\bUrun\b/g, 'Ürün'],
  [/\burun\b/g, 'ürün'],
  [/\bSATIS\b/g, 'SATIŞ'],
  [/\bSatis\b/g, 'Satış'],
  [/\bsatis\b/g, 'satış'],
  [/\bONERI\b/g, 'ÖNERİ'],
  [/\bOneri\b/g, 'Öneri'],
  [/\boneri\b/g, 'öneri'],
  [/\bONERILEN\b/g, 'ÖNERİLEN'],
  [/\bOnerilen\b/g, 'Önerilen'],
  [/\bonerilen\b/g, 'önerilen'],
  [/\bGUNLUK\b/g, 'GÜNLÜK'],
  [/\bGunluk\b/g, 'Günlük'],
  [/\bgunluk\b/g, 'günlük'],
  [/\bDUSUK\b/g, 'DÜŞÜK'],
  [/\bDusuk\b/g, 'Düşük'],
  [/\bdusuk\b/g, 'düşük'],
  [/\bSECILDI\b/g, 'SEÇİLDİ'],
  [/\bSecildi\b/g, 'Seçildi'],
  [/\bsecildi\b/g, 'seçildi'],
  [/\bSECIM\b/g, 'SEÇİM'],
  [/\bSecim\b/g, 'Seçim'],
  [/\bsecim\b/g, 'seçim'],
  [/\bSECILI\b/g, 'SEÇİLİ'],
  [/\bSecili\b/g, 'Seçili'],
  [/\bsecili\b/g, 'seçili'],
  [/\bONCELIK\b/g, 'ÖNCELİK'],
  [/\bOncelik\b/g, 'Öncelik'],
  [/\boncelik\b/g, 'öncelik'],
  [/\bYETERLILIGI\b/g, 'YETERLİLİĞİ'],
  [/\bYeterliligi\b/g, 'Yeterliliği'],
  [/\byeterliligi\b/g, 'yeterliliği'],
  [/\bTUKENME\b/g, 'TÜKENME'],
  [/\bTukenme\b/g, 'Tükenme'],
  [/\btukenme\b/g, 'tükenme'],
  [/\bBRUT\b/g, 'BRÜT'],
  [/\bBrut\b/g, 'Brüt'],
  [/\bbrut\b/g, 'brüt'],
  [/\bISLEM\b/g, 'İŞLEM'],
  [/\bIslem\b/g, 'İşlem'],
  [/\bislem\b/g, 'işlem'],
  [/\bHIZLI\b/g, 'HIZLI'],
  [/\bHizli\b/g, 'Hızlı'],
  [/\bhizli\b/g, 'hızlı'],
  [/\bOLUSTUR\b/g, 'OLUŞTUR'],
  [/\bOlustur\b/g, 'Oluştur'],
  [/\bolustur\b/g, 'oluştur'],
  [/\bGERCEK\b/g, 'GERÇEK'],
  [/\bGercek\b/g, 'Gerçek'],
  [/\bgercek\b/g, 'gerçek'],
  [/\bINDIRIM\b/g, 'İNDİRİM'],
  [/\bIndirim\b/g, 'İndirim'],
  [/\bindirim\b/g, 'indirim'],
  [/\bARTISI\b/g, 'ARTIŞI'],
  [/\bArtisi\b/g, 'Artışı'],
  [/\bartisi\b/g, 'artışı'],
  [/\bURUNDE\b/g, 'ÜRÜNDE'],
  [/\bUrunde\b/g, 'Üründe'],
  [/\burunde\b/g, 'üründe'],
  [/\bURUNLERDE\b/g, 'ÜRÜNLERDE'],
  [/\bUrunlerde\b/g, 'Ürünlerde'],
  [/\burunlerde\b/g, 'ürünlerde'],
  [/\bYAKLASAN\b/g, 'YAKLAŞAN'],
  [/\bYaklasan\b/g, 'Yaklaşan'],
  [/\byaklasan\b/g, 'yaklaşan'],
  [/\bBASKISI\b/g, 'BASKISI'],
  [/\bBaskisi\b/g, 'Baskısı'],
  [/\bbaskisi\b/g, 'baskısı'],
  [/\bDEGERLENDIRILDI\b/g, 'DEĞERLENDİRİLDİ'],
  [/\bDegerlendirildi\b/g, 'Değerlendirildi'],
  [/\bdegerlendirildi\b/g, 'değerlendirildi'],
  [/\bHIZI\b/g, 'HIZI'],
  [/\bHizi\b/g, 'Hızı'],
  [/\bhizi\b/g, 'hızı'],
  [/\bORANI\b/g, 'ORANI'],
  [/\bOrani\b/g, 'Oranı'],
  [/\borani\b/g, 'oranı'],
  [/\bAKISINA\b/g, 'AKIŞINA'],
  [/\bAkisina\b/g, 'Akışına'],
  [/\bakisina\b/g, 'akışına'],
  [/\bAKTARILIR\b/g, 'AKTARILIR'],
  [/\bAktarilir\b/g, 'Aktarılır'],
  [/\baktarilir\b/g, 'aktarılır'],
  [/\bHIZINI\b/g, 'HIZINI'],
  [/\bHizini\b/g, 'Hızını'],
  [/\bhizini\b/g, 'hızını'],
  [/\bARTIRMA\b/g, 'ARTIRMA'],
  [/\bArtirma\b/g, 'Artırma'],
  [/\bartirma\b/g, 'artırma'],
  [/\bGOSTER\b/g, 'GÖSTER'],
  [/\bGoster\b/g, 'Göster'],
  [/\bgoster\b/g, 'göster'],
  [/\bKirtasiye\b/g, 'Kırtasiye'],
  [/\bkirtasiye\b/g, 'kırtasiye'],
  [/\bIcecek\b/g, 'İçecek'],
  [/\bicecek\b/g, 'içecek'],
  [/\bKagit\b/g, 'Kağıt'],
  [/\bkagit\b/g, 'kağıt'],
  [/\bislak\b/g, 'ıslak'],
  [/\bSut\b/g, 'Süt'],
  [/\bsut\b/g, 'süt'],
  [/\bKahvaltilik\b/g, 'Kahvaltılık'],
  [/\bkahvaltilik\b/g, 'kahvaltılık'],
  [/\bGida\b/g, 'Gıda'],
  [/\bgida\b/g, 'gıda'],
  [/\bFirin\b/g, 'Fırın'],
  [/\bfirin\b/g, 'fırın'],
  [/\bKisisel\b/g, 'Kişisel'],
  [/\bkisisel\b/g, 'kişisel'],
  [/\bBakim\b/g, 'Bakım'],
  [/\bbakim\b/g, 'bakım'],
  [/\bSaglik\b/g, 'Sağlık'],
  [/\bsaglik\b/g, 'sağlık'],
  [/\bYasam\b/g, 'Yaşam'],
  [/\byasam\b/g, 'yaşam'],
  [/\bHazir\b/g, 'Hazır'],
  [/\bhazir\b/g, 'hazır'],
  [/\bBalik\b/g, 'Balık'],
  [/\bbalik\b/g, 'balık'],
  [/\bAtistirmalik\b/g, 'Atıştırmalık'],
  [/\batistirmalik\b/g, 'atıştırmalık'],
  [/\bTedarikci\b/g, 'Tedarikçi'],
  [/\btedarikci\b/g, 'tedarikçi'],
  [/\bCok\b/g, 'Çok'],
  [/\bcok\b/g, 'çok'],
  [/\bDusuk\b/g, 'Düşük'],
  [/\bdusuk\b/g, 'düşük'],
  [/\bYuksek\b/g, 'Yüksek'],
  [/\byuksek\b/g, 'yüksek'],
  [/\bGorunurluk\b/g, 'Görünürlük'],
  [/\bgorunurluk\b/g, 'görünürlük'],
  [/\bDonusum\b/g, 'Dönüşüm'],
  [/\bdonusum\b/g, 'dönüşüm'],
  [/\bTum\b/g, 'Tüm'],
  [/\btum\b/g, 'tüm'],
];

const normalizeCampaignInsightText = (value) => CAMPAIGN_INSIGHT_TURKISH_WORD_REPLACEMENTS.reduce(
  (text, [pattern, replacement]) => text.replace(pattern, replacement),
  normalizeCampaignText(value),
);

const formatCampaignInsightMetaLine = (...parts) => parts
  .filter(Boolean)
  .map((part) => normalizeCampaignInsightText(part))
  .join(' • ');

const getCampaignPriorityDisplayLabel = (priority) => {
  const raw = String(priority ?? '').trim().toLocaleLowerCase('tr-TR');
  const numeric = Number(priority);
  if (Number.isFinite(numeric)) {
    const normalized = Math.max(0, Math.min(9, numeric));
    if (normalized <= 0) return 'Kampanya önceliği atanmadı';
    if (normalized <= 3) return 'Düşük uygulama önceliği';
    if (normalized <= 6) return 'Orta uygulama önceliği';
    return 'Yüksek uygulama önceliği';
  }
  if (['critical', 'high', 'yüksek', 'yuksek'].includes(raw)) return 'Yüksek uygulama önceliği';
  if (['medium', 'normal', 'orta'].includes(raw)) return 'Orta uygulama önceliği';
  if (['low', 'düşük', 'dusuk'].includes(raw)) return 'Düşük uygulama önceliği';
  return 'Orta uygulama önceliği';
};

const getCampaignPriorityValueLabel = (priority) => {
  const numeric = Number(priority);
  if (!Number.isFinite(numeric)) return '';
  const normalized = Math.max(0, Math.min(9, numeric));
  return `Öncelik değeri: ${formatNumber(normalized)} / 9`;
};

Object.assign(CAMPAIGN_STATUS_LABELS, {
  active: 'Aktif',
  paused: 'Beklemede',
  archived: 'Arşiv',
});

Object.assign(CAMPAIGN_MODULE_TABLE_TITLES, {
  all: { active: 'Aktif Kampanya Listesi', archive: 'Kampanya Arşivi' },
  general: { active: 'Genel Kampanya Aktif Listesi', archive: 'Genel Kampanya Arşivi' },
  product: { active: 'Ürün Bazlı Aktif Kampanya Listesi', archive: 'Ürün Bazlı Kampanya Arşivi' },
  category: { active: 'Kategori Bazlı Aktif Kampanya Listesi', archive: 'Kategori Bazlı Kampanya Arşivi' },
  brand: { active: 'Marka Bazlı Aktif Kampanya Listesi', archive: 'Marka Bazlı Kampanya Arşivi' },
  expiry: { active: 'SKT Bazlı Aktif Kampanya Listesi', archive: 'SKT Bazlı Kampanya Arşivi' },
  sales: { active: 'Satış Bazlı Aktif Kampanya Listesi', archive: 'Satış Bazlı Kampanya Arşivi' },
  giftCards: { active: 'Hediye Kartı Aktif Kampanya Listesi', archive: 'Hediye Kartı Kampanya Arşivi' },
});

Object.keys(CAMPAIGN_TABLE_SECTION_META).forEach((sectionKey) => {
  const section = CAMPAIGN_TABLE_SECTION_META[sectionKey];
  if (!section) return;
  if (section.active) {
    section.active.title = normalizeCampaignUiText(section.active.title);
    section.active.description = normalizeCampaignUiText(section.active.description);
  }
  if (section.archive) {
    section.archive.title = normalizeCampaignUiText(section.archive.title);
    section.archive.description = normalizeCampaignUiText(section.archive.description);
  }
});

CAMPAIGN_TYPE_FILTER_TABS.forEach((tab) => {
  tab.label = normalizeCampaignUiText(tab.label);
});

const CAMPAIGN_PRIORITY_OPTIONS = [
  { value: 'all', label: 'Tüm Riskler' },
  { value: 'critical', label: 'Kritik' },
  { value: 'high', label: 'Yüksek' },
  { value: 'medium', label: 'Orta' },
  { value: 'low', label: 'Düşük' },
];

const CAMPAIGN_EXPIRY_DAY_BANDS = [
  { value: 'all', label: 'Tüm Gün Bantları' },
  { value: 'today-past', label: 'Bugün / geçmiş' },
  { value: '1-3', label: '1-3 gün' },
  { value: '4-7', label: '4-7 gün' },
  { value: '8-14', label: '8-14 gün' },
  { value: '15+', label: '15+ gün' },
];

const CAMPAIGN_SALES_VELOCITY_OPTIONS = [
  { value: 'all', label: 'Tüm Satış Hızları' },
  { value: 'none', label: 'Satış yok' },
  { value: 'slow', label: 'Yavaş' },
  { value: 'balanced', label: 'Normal' },
  { value: 'fast', label: 'Hızlı' },
];

const CAMPAIGN_STOCK_TURN_OPTIONS = [
  { value: 'all', label: 'Tüm Stok Devirleri' },
  { value: 'critical', label: 'Yavaş devir' },
  { value: 'moderate', label: 'Normal' },
  { value: 'healthy', label: 'Hızlı devir' },
];

const CAMPAIGN_MARGIN_OPTIONS = [
  { value: 'all', label: 'Tüm Marjlar' },
  { value: 'low', label: 'Düşük marj' },
  { value: 'medium', label: 'Sağlıklı marj' },
  { value: 'high', label: 'Yüksek marj' },
];

const RISK_RULE_OPTIONS = [
  { value: 'critical_stock', label: 'Kritik Stok' },
  { value: 'high_risk_demand', label: 'Yüksek Risk Talep' },
  { value: 'campaign_conflict', label: 'Kampanya Çakışması' },
  { value: 'slow_sales_overstock', label: 'Yavaş Satış + Fazla Stok' },
  { value: 'low_sales_velocity', label: 'Düşüş Satış Hızı' },
  { value: 'high_stock', label: 'Yüksek Stok' },
  { value: 'approaching_expiration', label: 'Yaklaşan SKT' },
  { value: 'price_drop_opportunity', label: 'Fiyat Düşürme Fırsatı' },
];

const RULE_ACTION_OPTIONS = [
  { value: 'notify', label: 'Bildirim Gönder' },
  { value: 'create_task', label: 'Görev Oluştur' },
  { value: 'notify_and_task', label: 'Bildirim + Görev' },
  { value: 'create_campaign', label: 'Kampanya Oluştur' },
  { value: 'apply_discount', label: 'İndirim Uygula' },
  { value: 'assign_task', label: 'Görev Ata' },
];

const READABLE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const normalizeCodeValue = (value) => String(value || '').trim().toUpperCase();

export const generateRandomCode = ({
  length = 5,
  charset = READABLE_CODE_CHARSET,
  excludedCodes = new Set(),
  maxAttempts = 300,
} = {}) => {
  const normalizedExcluded = new Set(Array.from(excludedCodes || []).map((code) => normalizeCodeValue(code)));
  const safeLength = Number.isInteger(length) && length > 0 ? length : 5;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let candidate = '';
    for (let index = 0; index < safeLength; index += 1) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      candidate += charset[randomIndex];
    }

    if (!normalizedExcluded.has(candidate)) {
      return candidate;
    }
  }

  return '';
};

const normalizeGiftCards = (items) => {
  if (!Array.isArray(items)) return [];

  return items
    .map((item, index) => {
      const usageLimitSource = Number(item?.usageLimit ?? item?.maxUsage ?? 1);
      const usageLimit = Number.isFinite(usageLimitSource) && usageLimitSource >= 1 ? Math.floor(usageLimitSource) : 1;
      const usedCountSource = Number(item?.usedCount ?? 0);
      const usedCount = Number.isFinite(usedCountSource) && usedCountSource >= 0 ? Math.floor(usedCountSource) : 0;
      const remainingUsageSource = Number(item?.remainingUsage);
      const remainingUsage = Number.isFinite(remainingUsageSource)
        ? Math.max(0, Math.min(usageLimit, Math.floor(remainingUsageSource)))
        : Math.max(0, usageLimit - usedCount);

      return {
        id: String(item?.id || `gift-${Date.now()}-${index}`),
        code: String(item?.code || '').trim().toUpperCase(),
        name: String(item?.name || '').trim(),
        valueType: item?.valueType === 'percentage' ? 'percentage' : 'amount',
        value: Number(item?.value) || 0,
        usageLimit,
        maxUsage: usageLimit,
        usedCount: Math.min(usedCount, usageLimit),
        remainingUsage,
        allowedCategoryIds: Array.isArray(item?.allowedCategoryIds) ?
           item.allowedCategoryIds.map((id) => String(id || '').trim()).filter(Boolean)
          : [],
        rewardMode: String(item?.rewardMode || 'none').trim().toLowerCase() || 'none',
        minSpendForReward: Number(item?.minSpendForReward || 0) || 0,
        loyaltyPointCost: Number(item?.loyaltyPointCost || 0) || 0,
        expiresAt: String(item?.expiresAt || item?.validUntil || '').trim(),
        isActive: item?.isActive !== false,
        createdAt: String(item?.createdAt || new Date().toISOString()),
      };
    })
    .filter((item) => item.code && item.name && item.value > 0);
};

const CUSTOMER_NAME_ENCODING_FIXES = SETTINGS_TURKISH_TEXT_REPLACEMENTS;

const normalizeCustomerDisplayName = (value) => {
  let text = String(value || '').trim();
  CUSTOMER_NAME_ENCODING_FIXES.forEach(([wrong, correct]) => {
    text = text.split(wrong).join(correct);
  });
  if (text === 'Zeynep ^ahin') return 'Zeynep Şahin';
  return text;
};

const resolveCampaignCustomerDisplayName = (customer) => {
  const mergedName = [
    String(customer?.firstName || '').trim(),
    String(customer?.lastName || '').trim(),
  ].filter(Boolean).join(' ');
  const rawName =
    customer?.fullName
    || customer?.displayName
    || customer?.name
    || customer?.customerName
    || mergedName;
  const normalized = normalizeCustomerDisplayName(rawName);
  if (!normalized) return '';
  if (/^u-[\w-]+$/i.test(normalized)) return '';
  return normalized;
};

const isRealCampaignCustomerRecord = (customer) => String(customer?.customerNo || '').trim() !== '00000006';

const isGiftCardExpired = (card) => {
  if (!String(card?.expiresAt || '').trim()) return false;
  return new Date(`${String(card.expiresAt).trim()}T23:59:59`).getTime() < Date.now();
};

const normalizeCampaigns = (items) => {
  if (!Array.isArray(items)) return [];

  return items
    .map((item, index) => {
      const type = String(item?.type || item?.campaignType || 'general').trim().toLowerCase() || 'general';
      const sourceModule = normalizeCampaignModuleKey(item?.sourceModule || item?.module || '', '');
      const rawName = String(item?.name || '').trim();
      const explicitPublicName = String(item?.publicName || item?.displayName || item?.customerTitle || '').trim();
      const publicName = resolvePublicCampaignName({
        name: explicitPublicName || rawName,
        type,
        sourceModule,
      });

      return {
        id: String(item?.id || `campaign-${Date.now()}-${index}`),
        name: isInternalCampaignName(rawName) ? publicName : (rawName || publicName),
        internalName: String(item?.internalName || (isInternalCampaignName(rawName) ? rawName : '') || item?.recommendationTitle || '').trim(),
        recommendationTitle: String(item?.recommendationTitle || item?.internalName || '').trim(),
        publicName,
        displayName: String(item?.displayName || publicName).trim(),
        type,
        sourceModule,
        module: sourceModule,
        discountRate: Number(item?.discountRate) || 0,
        startsAt: String(item?.startsAt || item?.startAt || '').trim(),
        endsAt: String(item?.endsAt || item?.endAt || '').trim(),
        isIndefinite: Boolean(item?.isIndefinite),
        priority: Math.max(0, Number(item?.priority || 0) || 0),
        status: String(item?.status || (item?.isActive === false ? 'paused' : 'active')).trim().toLowerCase() || 'active',
        conflictPolicy: String(item?.conflictPolicy || 'highest_priority').trim().toLowerCase() || 'highest_priority',
        targetCategoryIds: Array.isArray(item?.targetCategoryIds) ?
           item.targetCategoryIds.map((id) => String(id || '').trim()).filter(Boolean)
          : [],
        targetProductIds: Array.isArray(item?.targetProductIds) ?
           item.targetProductIds.map((id) => String(id || '').trim()).filter(Boolean)
          : [],
        targetBrands: normalizeCampaignBrandSelections(Array.isArray(item?.targetBrands) ? item.targetBrands : []),
        targetBrand: String(item?.targetBrand || '').trim(),
        trigger: item?.trigger && typeof item.trigger === 'object' ?
           {
            salesSpeed: String(item.trigger.salesSpeed || '').trim().toLowerCase(),
            trendDirection: String(item.trigger.trendDirection || '').trim().toLowerCase(),
            minOverStockRatio: Number(item.trigger.minOverStockRatio || 0) || undefined,
            minRiskLevel: String(item.trigger.minRiskLevel || '').trim().toLowerCase(),
            salesBelow: Number(item.trigger.salesBelow || 0) || undefined,
            stockAbove: Number(item.trigger.stockAbove || 0) || undefined,
            expiryBelow: Number(item.trigger.expiryBelow || 0) || undefined,
          }
          : {},
        actions: item?.actions && typeof item.actions === 'object' ?
           {
            autoApplyDiscount: item.actions.autoApplyDiscount === true,
            createTask: item.actions.createTask === true,
            notify: item.actions.notify !== false,
          }
          : { autoApplyDiscount: false, createTask: false, notify: true },
        giftCardRewardEnabled: item?.giftCardRewardEnabled === true,
        giftCardRewardCode: String(item?.giftCardRewardCode || '').trim().toUpperCase(),
        simulation: item?.simulation && typeof item.simulation === 'object' ? item.simulation : {},
        isActive: item?.isActive !== false,
        createdAt: String(item?.createdAt || new Date().toISOString()),
      };
    })
    .filter((item) => item.name && item.discountRate > 0);
};

const isCampaignCurrentlyActive = (campaign = {}, now = new Date()) => {
  if (!campaign || campaign.isActive === false) return false;
  const status = String(campaign.status || 'active').trim().toLowerCase();
  if (['paused', 'inactive', 'archived', 'expired'].includes(status)) return false;

  const startsAt = campaign.startsAt ? new Date(campaign.startsAt) : null;
  if (startsAt && Number.isFinite(startsAt.getTime()) && now < startsAt) return false;
  if (campaign.isIndefinite) return true;

  const endsAtValue = String(campaign.endsAt || '').trim();
  const endsAt = endsAtValue ? new Date(endsAtValue) : null;
  if (endsAt && Number.isFinite(endsAt.getTime())) {
    const endBoundary = /^\d{4}-\d{2}-\d{2}$/.test(endsAtValue) ? new Date(endsAt) : endsAt;
    if (/^\d{4}-\d{2}-\d{2}$/.test(endsAtValue)) {
      endBoundary.setHours(23, 59, 59, 999);
    }
    if (now > endBoundary) return false;
  }
  return true;
};

const isCampaignPlanned = (campaign = {}, now = new Date()) => {
  if (!campaign || campaign.isActive === false) return false;
  const status = String(campaign.status || 'active').trim().toLowerCase();
  if (['paused', 'inactive', 'archived', 'expired', 'cancelled', 'canceled', 'deleted'].includes(status)) return false;
  const startsAt = campaign.startsAt ? new Date(campaign.startsAt) : null;
  return Boolean(startsAt && Number.isFinite(startsAt.getTime()) && startsAt > now);
};

const getCampaignEndBoundary = (campaign = {}) => {
  const endsAtValue = String(campaign?.endsAt || '').trim();
  const endsAt = endsAtValue ? new Date(endsAtValue) : null;
  if (!endsAt || !Number.isFinite(endsAt.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(endsAtValue)) {
    endsAt.setHours(23, 59, 59, 999);
  }
  return endsAt;
};

const isPastCampaignClutter = (campaign = {}, now = new Date()) => {
  if (isCampaignCurrentlyActive(campaign, now) || isCampaignPlanned(campaign, now)) return false;
  const status = String(campaign?.status || '').trim().toLowerCase();
  const endedStatuses = new Set(['archived', 'expired', 'cancelled', 'canceled', 'deleted']);
  if (endedStatuses.has(status)) return true;
  const endsAt = getCampaignEndBoundary(campaign);
  return Boolean(endsAt && endsAt < now);
};

const formatCampaignDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('tr-TR');
};

const normalizeCampaignBrandKey = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const getCampaignProductMatch = (campaign = {}, product = {}) => {
  const productId = String(product?.id || product?.productId || '').trim();
  const categoryId = String(product?.categoryId || '').trim();
  const brand = normalizeCampaignBrandKey(product?.brand || product?.brandName);
  const targetProductIds = Array.isArray(campaign.targetProductIds) ? campaign.targetProductIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  const targetCategoryIds = Array.isArray(campaign.targetCategoryIds) ? campaign.targetCategoryIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  const targetBrands = Array.isArray(campaign.targetBrands) ? campaign.targetBrands.map(normalizeCampaignBrandKey).filter(Boolean) : [];
  const productMatched = productId && targetProductIds.includes(productId);
  const categoryMatched = categoryId && targetCategoryIds.includes(categoryId);
  const brandMatched = brand && targetBrands.includes(brand);
  const hasExplicitScope = targetProductIds.length || targetCategoryIds.length || targetBrands.length;
  const type = String(campaign.type || 'general').trim().toLocaleLowerCase('tr-TR') || 'general';

  if (productMatched) return { scope: 'product', specificity: 5 };
  if (brandMatched) return { scope: 'brand', specificity: 4 };
  if (categoryMatched) return { scope: 'category', specificity: 3 };
  if (['product', 'brand', 'category'].includes(type)) return null;
  if (!hasExplicitScope || type === 'general') return { scope: 'general', specificity: 1 };
  return null;
};

const normalizeAutomationCenter = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  const rules = Array.isArray(source.rules) ?
     source.rules
      .map((rule, index) => ({
        id: String(rule?.id || `automation-rule-${Date.now()}-${index}`),
        name: String(rule?.name || '').trim(),
        triggerType: String(rule?.triggerType || '').trim().toLowerCase() || 'critical_stock',
        threshold: Number(rule?.threshold || 0) || 0,
        actionType: String(rule?.actionType || '').trim().toLowerCase() || 'notify',
        waitDays: Number(rule?.waitDays || 0) || 0,
        followUpTriggerType: String(rule?.followUpTriggerType || 'low_sales_velocity').trim().toLowerCase(),
        isActive: rule?.isActive !== false,
      }))
      .filter((rule) => rule.name)
    : [];

  return {
    enabled: source.enabled === true,
    autoCreateTasks: source.autoCreateTasks === true,
    notifyOnCritical: source.notifyOnCritical !== false,
    taskAssigneeUserId: String(source.taskAssigneeUserId || '').trim(),
    rules,
  };
};

const mapSettingsToForm = (data = {}) => ({
  ...(() => {
    const weeklySchedule = normalizeWeeklySchedule({
      weeklySchedule: data.weeklySchedule,
      openingTime: data.openingTime,
      closingTime: data.closingTime,
      closedDays: data.closedDays,
    });
    const legacy = deriveLegacyWorkingHours(weeklySchedule);
    return {
      openingTime: legacy.openingTime,
      closingTime: legacy.closingTime,
      closedDays: legacy.closedDays,
      weeklySchedule,
      holidayMode: Boolean(data.holidayMode),
      specialDays: normalizeSpecialDays(data.specialDays),
    };
  })(),
  currency: 'TRY',
  dateFormat: data.dateFormat || 'DD.MM.YYYY',
  storeName: data.storeName || '',
  branchCode: data.branchCode || '',
  storeAddress: data.storeAddress || '',
  storePhone: data.storePhone || '',
  storeEmail: data.storeEmail || SUPPORT_CONTACT.email,
  taxNumber: data.taxNumber || STANDARD_TAX_NUMBER,
  logisticsTariffs: normalizeLogisticsTariffs(data.logisticsTariffs),
  customerRelations: {
    giftCards: normalizeGiftCards(data?.customerRelations?.giftCards),
    campaigns: normalizeCampaigns(data?.customerRelations?.campaigns),
    automationCenter: normalizeAutomationCenter(data?.customerRelations?.automationCenter),
  },
});

const SYSTEM_DESK_ROWS = [
  { code: 'B1', label: 'Kasa 1 PIN' },
  { code: 'B2', label: 'Kasa 2 PIN' },
  { code: 'B3', label: 'Kasa 3 PIN' },
  { code: 'B4', label: 'Kasa 4 PIN' },
  { code: 'B5', label: 'Kasa 5 PIN' },
  { code: 'B6', label: 'Kasa 6 PIN' },
  { code: 'B7', label: 'Kasa 7 PIN' },
  { code: 'B8', label: 'Yönetim Kasası PIN' },
];

const AUTO_SALE_DESK_OPTIONS = SYSTEM_DESK_ROWS.map((row) => ({
  code: row.code,
  label: row.label.replace(/\s*PIN$/i, ''),
}));

const formatAutoSaleRemainingTime = (milliseconds) => {
  if (milliseconds === null || milliseconds === undefined) return 'Manuel';
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const NOTIFICATION_SOUND_ENABLED_KEY = 'shelfio.toast.sound.enabled';
const NOTIFICATION_SOUND_VOLUME_KEY = 'shelfio.toast.sound.volume';

const clampSoundVolume = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 40;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const createDefaultDeskPins = (source = {}) => {
  const normalized = {};
  SYSTEM_DESK_ROWS.forEach(({ code }) => {
    normalized[code] = String(source[code] || '1234').slice(0, 4);
  });
  return normalized;
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('tr-TR');
};

const toReportDate = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
};

const safeReportCell = (value) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || '-';
};

const loadXlsx = async () => {
  const mod = await import('xlsx');
  return mod.default || mod;
};

const loadPdfMake = async () => {
  const [pdfMakeModule, pdfFontsModule] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  return {
    pdfMake: pdfMakeModule.default || pdfMakeModule,
    pdfFonts: pdfFontsModule.default || pdfFontsModule,
  };
};

const resolveEmbeddedPdfVfs = (pdfFonts) => {
  const nestedVfs = pdfFonts?.pdfMake?.vfs || pdfFonts?.vfs || pdfFonts?.default?.pdfMake?.vfs || pdfFonts?.default?.vfs;
  if (nestedVfs && Object.keys(nestedVfs).length > 0) {
    return nestedVfs;
  }

  const rawFontMap = pdfFonts && typeof pdfFonts === 'object' ? pdfFonts : {};
  const directFontEntries = Object.entries(rawFontMap).filter(([key, value]) => key.toLowerCase().endsWith('.ttf') && typeof value === 'string');
  return directFontEntries.length ? Object.fromEntries(directFontEntries) : {};
};

const ensurePdfMakeReady = async () => {
  const { pdfMake, pdfFonts } = await loadPdfMake();
  const embeddedVfs = resolveEmbeddedPdfVfs(pdfFonts);
  const hasEmbeddedFonts = Object.keys(embeddedVfs).length > 0;

  if (typeof pdfMake.addVirtualFileSystem === 'function' && hasEmbeddedFonts) {
    pdfMake.addVirtualFileSystem(embeddedVfs);
  } else if ((!pdfMake.vfs || Object.keys(pdfMake.vfs).length === 0) && hasEmbeddedFonts) {
    pdfMake.vfs = embeddedVfs;
  }

  return {
    pdfMake,
    ready: Boolean(pdfMake.vfs && Object.keys(pdfMake.vfs).length > 0),
  };
};

const sanitizeObjectRows = (rows) => (
  Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object') : []
);

const extractResponseTotal = (rows) => {
  const meta = rows?.meta;
  const candidates = [meta?.total, meta?.totalCount, meta?.count];
  const resolved = candidates.find((value) => Number.isFinite(Number(value)));
  return resolved === undefined ? null : Number(resolved);
};

const formatTabCount = (label, total) => (
  Number.isFinite(total) ? `${label} (${formatNumber(total)})` : label
);

const resolveLoginActivityDate = (activity) => {
  const row = activity && typeof activity === 'object' ? activity : {};
  return row.createdAt || row.loginAt || row.loggedInAt || row.timestamp || row.at || null;
};

const parseUserAgentInfo = (activity) => {
  const row = activity && typeof activity === 'object' ? activity : {};
  const ua = String(row.userAgent || row.browserInfo || row.device || '').toLowerCase();

  let os = 'Bilinmiyor';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac os') || ua.includes('macintosh')) os = 'macOS';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) os = 'iOS';
  else if (ua.includes('linux')) os = 'Linux';

  let browser = 'Bilinmiyor';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Chrome';
  else if (ua.includes('firefox/')) browser = 'Firefox';
  else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';
  else if (ua.includes('opr/') || ua.includes('opera')) browser = 'Opera';

  return { os, browser };
};

const getLogLevelLabel = (level) => {
  if (level === 'warning') return 'Uyarı';
  if (level === 'info') return 'Bilgi';
  return 'Hata';
};

const createDeveloperLogDraft = () => ({
  level: 'error',
  source: 'frontend',
  action: 'manual_log',
  endpoint: '',
  message: '',
  stack: '',
  statusCode: '',
  errorType: '',
  requestPayload: '',
  response: '',
});

const DEFAULT_DEVELOPER_LOG_FILTERS = {
  level: '',
  from: '',
  to: '',
  userId: '',
  search: '',
  source: '',
};

const DEFAULT_AUDIT_LOG_FILTERS = {
  action: '',
  from: '',
  to: '',
  user: '',
  search: '',
};

const DEFAULT_LOGIN_ACTIVITY_FILTERS = {
  user: '',
  from: '',
  to: '',
  browser: '',
  ip: '',
  search: '',
};

const parseOptionalJson = (value, _fieldLabel) => {
  const text = String(value || '').trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const formatLogJsonForDisplay = (value) => {
  if (value === null || value === undefined || value === '') return '-';

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return '-';
    try {
      return JSON.stringify(JSON.parse(normalized), null, 2);
    } catch {
      return normalized;
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const parseStructuredLogValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^[{\[]/.test(normalized)) return normalized;
  try {
    return JSON.parse(normalized);
  } catch {
    return normalized;
  }
};

const formatLogDetailKey = (value) => String(value || '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^./, (char) => char.toLocaleUpperCase('tr-TR'));

const formatStructuredLogValue = (value) => {
  const parsed = parseStructuredLogValue(value);
  if (parsed === null || parsed === undefined || parsed === '') return '-';
  if (typeof parsed === 'string') {
    const normalized = parsed.trim();
    if (!normalized) return '-';
    const lowered = normalized.toLocaleLowerCase('tr-TR');
    if (['undefined', 'null', 'nan', '[object object]'].includes(lowered)) return '-';
    return normalized;
  }
  if (typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => formatStructuredLogValue(item)).filter((item) => item && item !== '-').join(', ') || '-';
  }
  if (parsed && typeof parsed === 'object') {
    const summaryCandidate = [
      parsed.message,
      parsed.error,
      parsed.detail,
      parsed.details,
      parsed.reason,
      parsed.title,
    ].find((item) => String(item || '').trim());
    if (summaryCandidate) return formatStructuredLogValue(summaryCandidate);
    return Object.entries(parsed)
      .map(([key, item]) => `${formatLogDetailKey(key)}: ${formatStructuredLogValue(item)}`)
      .join('\n');
  }
  return String(parsed);
};

const buildLogDetailLines = (value, prefix = '') => {
  const parsed = parseStructuredLogValue(value);
  if (parsed === null || parsed === undefined || parsed === '') return [];
  if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') {
    const text = String(parsed).trim();
    return text ? [`${prefix || 'Detay'}: ${text}`] : [];
  }
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item, index) => buildLogDetailLines(item, prefix ? `${prefix} ${index + 1}` : `Satır ${index + 1}`));
  }
  return Object.entries(parsed).flatMap(([key, item]) => {
    const nextPrefix = prefix ? `${prefix} / ${formatLogDetailKey(key)}` : formatLogDetailKey(key);
    if (item && typeof item === 'object') {
      return buildLogDetailLines(item, nextPrefix);
    }
    const text = formatStructuredLogValue(item);
    return text && text !== '-' ? [`${nextPrefix}: ${text}`] : [];
  });
};

const formatLogDetailsForDisplay = (value, emptyText = 'Detay bulunmuyor.') => {
  const directText = formatStructuredLogValue(value);
  if (directText && directText !== '-') {
    const parsed = parseStructuredLogValue(value);
    if (parsed === null || typeof parsed !== 'object') {
      return directText;
    }
  }

  const lines = buildLogDetailLines(value).filter(Boolean);
  return lines.length ? lines.join('\n') : emptyText;
};

const getDeveloperLogPresentation = (row) => {
  const log = row && typeof row === 'object' ? row : {};
  const message = formatStructuredLogValue(log.message);
  const requestDetails = buildLogDetailLines(log.requestPayload || log.payload, 'İstek');
  const responseDetails = buildLogDetailLines(log.response, 'Yanıt');
  const extraDetails = [
    log.statusCode ? `Durum kodu: ${log.statusCode}` : '',
    log.errorType ? `Hata Sınıfı: ${log.errorType}` : '',
    log.requestId ? `Request ID: ${log.requestId}` : '',
    log.correlationId ? `Correlation ID: ${log.correlationId}` : '',
    log.repeatCount && Number(log.repeatCount) > 1 ? `Tekrar: ${log.repeatCount}` : '',
    log.requestUrl || log.endpoint ? `Endpoint: ${log.requestUrl || log.endpoint}` : '',
    log.browserInfo ? `Tarayıcı: ${log.browserInfo}` : '',
    log.ip ? `IP: ${log.ip}` : '',
  ].filter(Boolean);
  const technicalDetails = [...extraDetails, ...requestDetails, ...responseDetails];

  return {
    date: formatDateTime(log.timestamp || log.createdAt || log.at),
    level: getLogLevelLabel(log.level),
    source: log.source || '-',
    action: log.action || '-',
    user: log.userName || log.user || '-',
    message: message || '-',
    stack: formatLogDetailsForDisplay(log.stack, 'Teknik iz bulunmuyor.'),
    technicalDetailsText: technicalDetails.length ? technicalDetails.join('\n') : 'Ek teknik detay bulunmuyor.',
    requestPayload: formatLogDetailsForDisplay(log.requestPayload || log.payload, 'İstek detayı bulunmuyor.'),
    responsePayload: formatLogDetailsForDisplay(log.response, 'Yanıt detayı bulunmuyor.'),
  };
};

export default function SettingsCampaignShell({ pageMode } = {}) {
  const { user } = useAuth();
  const dialog = useDialog();
  const location = useLocation();
  const navigate = useNavigate();
  const pageRootRef = useRef(null);
  const [form, setForm] = useState(initialForm);
  const [savedForm, setSavedForm] = useState(initialForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [updatedAt, setUpdatedAt] = useState('');
  const [stats, setStats] = useState({ totalProducts: 0, totalSuppliers: 0, totalStockQuantity: 0 });
  const [selectedScheduleDay, setSelectedScheduleDay] = useState(DAYS[0].key);
  const [specialDayListModalOpen, setSpecialDayListModalOpen] = useState(false);
  const [specialDayModalOpen, setSpecialDayModalOpen] = useState(false);
  const [specialDayDraft, setSpecialDayDraft] = useState({
    dateMode: 'single',
    startDate: '',
    startTime: DEFAULT_OPENING_TIME,
    endDate: '',
    endTime: '',
    note: '',
  });

  const [deskPins, setDeskPins] = useState(createDefaultDeskPins());
  const [newDeskPins, setNewDeskPins] = useState({});
  const [showDeskPins, setShowDeskPins] = useState({});
  const [pinErrors, setPinErrors] = useState({});
  const [savingDeskCode, setSavingDeskCode] = useState('');
  const [systemManagementPin, setSystemManagementPin] = useState('1234');
  const [newSystemManagementPin, setNewSystemManagementPin] = useState('');
  const [showSystemManagementPin, setShowSystemManagementPin] = useState(false);
  const [systemManagementPinError, setSystemManagementPinError] = useState('');
  const [savingSystemManagementPin, setSavingSystemManagementPin] = useState(false);
  const [roleManagementPin, setRoleManagementPin] = useState('1234');
  const [newRoleManagementPin, setNewRoleManagementPin] = useState('');
  const [showRoleManagementPin, setShowRoleManagementPin] = useState(false);
  const [roleManagementPinError, setRoleManagementPinError] = useState('');
  const [savingRoleManagementPin, setSavingRoleManagementPin] = useState(false);
  const [availableCategories, setAvailableCategories] = useState([]);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [availableBrands, setAvailableBrands] = useState([]);

  const [giftCardModalOpen, setGiftCardModalOpen] = useState(false);
  const [customerRelationsModalTab, setCustomerRelationsModalTab] = useState('giftCards');
  const [giftCardCloseConfirmOpen, setGiftCardCloseConfirmOpen] = useState(false);
  const [giftCardDraft, setGiftCardDraft] = useState(createDefaultGiftCardDraft());
  const [campaignDraft, setCampaignDraft] = useState(createDefaultCampaignDraft());
  const [automationRuleDraft, setAutomationRuleDraft] = useState(createDefaultAutomationRuleDraft());
  const [loginActivities, setLoginActivities] = useState([]);
  const [loginActivitiesTotal, setLoginActivitiesTotal] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLogsTotal, setAuditLogsTotal] = useState(null);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);
  const [developerLogs, setDeveloperLogs] = useState([]);
  const [developerLogsTotal, setDeveloperLogsTotal] = useState(null);
  const [developerLogsLoading, setDeveloperLogsLoading] = useState(false);
  const [developerLogFilters, setDeveloperLogFilters] = useState(DEFAULT_DEVELOPER_LOG_FILTERS);
  const [developerLogModalOpen, setDeveloperLogModalOpen] = useState(false);
  const [selectedDeveloperLog, setSelectedDeveloperLog] = useState(null);
  const [developerLogManagerModalOpen, setDeveloperLogManagerModalOpen] = useState(false);
  const [developerLogCreateModalOpen, setDeveloperLogCreateModalOpen] = useState(false);
  const [creatingDeveloperLog, setCreatingDeveloperLog] = useState(false);
  const [developerLogDraft, setDeveloperLogDraft] = useState(createDeveloperLogDraft());
  const [auditLogManagerModalOpen, setAuditLogManagerModalOpen] = useState(false);
  const [loginActivityManagerModalOpen, setLoginActivityManagerModalOpen] = useState(false);
  const [auditLogManagerLoading, setAuditLogManagerLoading] = useState(false);
  const [loginActivityManagerLoading, setLoginActivityManagerLoading] = useState(false);
  const [auditLogFilters, setAuditLogFilters] = useState(DEFAULT_AUDIT_LOG_FILTERS);
  const [auditLogAppliedFilters, setAuditLogAppliedFilters] = useState(DEFAULT_AUDIT_LOG_FILTERS);
  const [loginActivityFilters, setLoginActivityFilters] = useState(DEFAULT_LOGIN_ACTIVITY_FILTERS);
  const [loginActivityAppliedFilters, setLoginActivityAppliedFilters] = useState(DEFAULT_LOGIN_ACTIVITY_FILTERS);
  const [selectedLoginActivity, setSelectedLoginActivity] = useState(null);
  const [loginActivityDetailModalOpen, setLoginActivityDetailModalOpen] = useState(false);
  const [activityLogTab, setActivityLogTab] = useState('activity');
  const [activityLogCollapsed, setActivityLogCollapsed] = useState(false);
  const [exportingPdfType, setExportingPdfType] = useState('');
  const [autoSalePanelOpen, setAutoSalePanelOpen] = useState(false);
  const [autoSaleActive, setAutoSaleActive] = useState(false);
  const [autoSaleConfig, setAutoSaleConfig] = useState(DEFAULT_AUTO_SALE_CONFIG);
  const [autoSaleSummary, setAutoSaleSummary] = useState(DEFAULT_AUTO_SALE_SUMMARY);
  const [autoSaleError, setAutoSaleError] = useState('');
  const [autoSaleRemainingMs, setAutoSaleRemainingMs] = useState(null);
  const [campaignTypeView, setCampaignTypeView] = useState(() => {
    if (typeof window === 'undefined') return 'all';
    try {
      const params = new URLSearchParams(window.location.search);
      return normalizeCampaignViewKey(params.get('campaignView'), 'all');
    } catch {
      return 'all';
    }
  });
  const [campaignSearch, setCampaignSearch] = useState('');
  const [campaignStatusView, setCampaignStatusView] = useState('all');
  const [selectedCampaignIds, setSelectedCampaignIds] = useState([]);
  const [bulkDiscountRate, setBulkDiscountRate] = useState('15');
  const [campaignSuggestionFilter, setCampaignSuggestionFilter] = useState('all');
  const [suggestionRefreshKey, setSuggestionRefreshKey] = useState(0);
  const [campaignSuggestionRefreshing, setCampaignSuggestionRefreshing] = useState(false);
  const [campaignSuggestionRefreshedAt, setCampaignSuggestionRefreshedAt] = useState(() => new Date());
  const [campaignSuggestionPage, setCampaignSuggestionPage] = useState(1);
  const [giftCardSearch, setGiftCardSearch] = useState('');
  const [giftCardAmountFilter, setGiftCardAmountFilter] = useState('');
  const [campaignTablePages, setCampaignTablePages] = useState({});
  const [selectedCampaignDetail, setSelectedCampaignDetail] = useState(null);
  const [editingCampaignId, setEditingCampaignId] = useState('');
  const [selectedCampaignSuggestion, setSelectedCampaignSuggestion] = useState(null);
  const [productCampaignSearch, setProductCampaignSearch] = useState('');
  const [productCampaignCategoryFilter, setProductCampaignCategoryFilter] = useState('');
  const [productCampaignBrandFilter, setProductCampaignBrandFilter] = useState('');
  const [brandCampaignSearch, setBrandCampaignSearch] = useState('');
  const [automationHistory, setAutomationHistory] = useState([]);
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [campaignCustomers, setCampaignCustomers] = useState([]);
  const [pricingSignals, setPricingSignals] = useState([]);
  const [backendCampaignRows, setBackendCampaignRows] = useState([]);
  const [backendCampaignSuggestions, setBackendCampaignSuggestions] = useState([]);
  const [campaignEligibleProductCount, setCampaignEligibleProductCount] = useState(0);
  const [backendCampaignSimulation, setBackendCampaignSimulation] = useState(null);
  const [campaignSimulationLoading, setCampaignSimulationLoading] = useState(false);
  const [campaignSimulationError, setCampaignSimulationError] = useState('');
  const [orderSuggestionSignals, setOrderSuggestionSignals] = useState([]);
  const [crossModuleLoading, setCrossModuleLoading] = useState(false);
  const [crossModuleError, setCrossModuleError] = useState('');
  const [giftCardAssignmentDraft, setGiftCardAssignmentDraft] = useState({ cardCode: '', customerId: '', customerQuery: '' });
  const [giftCardAssignmentLoading, setGiftCardAssignmentLoading] = useState(false);
  const [expiryDayBandFilter, setExpiryDayBandFilter] = useState('all');
  const [expiryRiskFilter, setExpiryRiskFilter] = useState('all');
  const [expiryCategoryFilter, setExpiryCategoryFilter] = useState('');
  const [expirySearch, setExpirySearch] = useState('');
  const [salesVelocityFilter, setSalesVelocityFilter] = useState('all');
  const [salesStockTurnFilter, setSalesStockTurnFilter] = useState('all');
  const [salesCategoryFilter, setSalesCategoryFilter] = useState('');
  const [salesMarginFilter, setSalesMarginFilter] = useState('all');
  const [salesSupplierFilter, setSalesSupplierFilter] = useState('');
  const [salesSectionFilter, setSalesSectionFilter] = useState('');
  const [salesProductTypeFilter, setSalesProductTypeFilter] = useState('all');
  const [salesRecommendationFilter, setSalesRecommendationFilter] = useState('all');
  const [salesSearch, setSalesSearch] = useState('');
  const [campaignInsightPages, setCampaignInsightPages] = useState({});
  const campaignEditScope = ['general', 'product', 'category', 'brand'].includes(String(campaignDraft.type || '').trim())
    ? String(campaignDraft.type || '').trim()
    : 'general';
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(NOTIFICATION_SOUND_ENABLED_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [notificationSoundVolume, setNotificationSoundVolume] = useState(() => {
    if (typeof window === 'undefined') return 40;
    try {
      return clampSoundVolume(window.localStorage.getItem(NOTIFICATION_SOUND_VOLUME_KEY));
    } catch {
      return 40;
    }
  });

  const [securityUnlocked, setSecurityUnlocked] = useState(false);
  const [securityEditMode, setSecurityEditMode] = useState(false);
  const [showPinGate, setShowPinGate] = useState(false);

  const isAdmin = user?.role === 'admin';
  const resolvedPageMode = pageMode === 'campaign' || pageMode === 'settings'
    ? pageMode
    : (location.pathname === '/kampanya-yonetimi' ? 'campaign' : 'settings');
  const isCampaignPage = resolvedPageMode === 'campaign';
  const isSettingsPage = resolvedPageMode === 'settings';
  const isAnyPinSaving = Boolean(savingDeskCode) || savingSystemManagementPin || savingRoleManagementPin;
  const weeklyScheduleRows = useMemo(
    () => normalizeWeeklySchedule({ weeklySchedule: form.weeklySchedule }),
    [form.weeklySchedule],
  );
  const selectedScheduleRow = useMemo(
    () => weeklyScheduleRows.find((row) => row.dayKey === selectedScheduleDay) || weeklyScheduleRows[0] || null,
    [weeklyScheduleRows, selectedScheduleDay],
  );

  useEffect(() => {
    if ((!isCampaignPage && !isSettingsPage) || !pageRootRef.current || typeof document === 'undefined') {
      return undefined;
    }

    const normalizeNodeTree = (root) => {
      if (!root) return;

      const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let textNode = textWalker.nextNode();
      while (textNode) {
        const nextValue = normalizeCampaignUiText(textNode.nodeValue || '');
        if (nextValue !== textNode.nodeValue) {
          textNode.nodeValue = nextValue;
        }
        textNode = textWalker.nextNode();
      }

      const elementWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let elementNode = elementWalker.nextNode();
      while (elementNode) {
        ['title', 'aria-label', 'placeholder'].forEach((attributeName) => {
          const attributeValue = elementNode.getAttribute(attributeName);
          if (!attributeValue) return;
          const nextValue = normalizeCampaignUiText(attributeValue);
          if (nextValue !== attributeValue) {
            elementNode.setAttribute(attributeName, nextValue);
          }
        });
        elementNode = elementWalker.nextNode();
      }
    };

    normalizeNodeTree(pageRootRef.current);
    const observer = new MutationObserver(() => normalizeNodeTree(pageRootRef.current));
    observer.observe(pageRootRef.current, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [isCampaignPage, isSettingsPage, campaignTypeView, campaignStatusView, campaignSuggestionPage, campaignSuggestionRefreshedAt, activityLogTab]);

  const logisticsCargoTypeSummary = useMemo(() => {
    const grouped = new Map();
    normalizeLogisticsTariffs(form.logisticsTariffs).forEach((row) => {
      if (!grouped.has(row.cargoTypeCode)) {
        grouped.set(row.cargoTypeCode, {
          cargoTypeCode: row.cargoTypeCode,
          cargoTypeName: row.cargoTypeName,
          isActive: false,
          isColdChain: row.isColdChain === true,
          isFrozenChain: row.isFrozenChain === true,
          isInternalTransfer: row.isInternalTransfer === true,
        });
      }
      const current = grouped.get(row.cargoTypeCode);
      current.isActive = current.isActive || row.isActive === true;
    });
    return Array.from(grouped.values());
  }, [form.logisticsTariffs]);

  const logisticsStats = useMemo(() => ({
    activeCargoTypeCount: logisticsCargoTypeSummary.filter((item) => item.isActive).length,
    coldChainTypeCount: logisticsCargoTypeSummary.filter((item) => item.isColdChain).length,
    frozenChainTypeCount: logisticsCargoTypeSummary.filter((item) => item.isFrozenChain).length,
  }), [logisticsCargoTypeSummary]);
  const clearSecurityEditDrafts = () => {
    setNewSystemManagementPin('');
    setNewRoleManagementPin('');
    setNewDeskPins({});
    setSystemManagementPinError('');
    setRoleManagementPinError('');
    setPinErrors({});
  };

  const handleToggleSecurityEditMode = () => {
    if (isAnyPinSaving) return;
    const nextMode = !securityEditMode;
    setSecurityEditMode(nextMode);
    if (!nextMode) {
      setSecurityUnlocked(false);
      clearSecurityEditDrafts();
    }
  };

  const updateAutoSaleConfig = (field, value) => {
    setAutoSaleError('');
    setAutoSaleConfig((current) => {
      const next = { ...current, [field]: value };
      autoSaleRunner.updateConfig(next);
      return next;
    });
  };

  const toggleAutoSaleDesk = (deskCode) => {
    setAutoSaleError('');
    setAutoSaleConfig((current) => {
      const currentCodes = Array.isArray(current.deskCodes) ? current.deskCodes : [];
      const nextCodes = currentCodes.includes(deskCode)
        ? currentCodes.filter((code) => code !== deskCode)
        : [...currentCodes, deskCode];
      const next = { ...current, deskCodes: nextCodes };
      autoSaleRunner.updateConfig(next);
      return next;
    });
  };

  const startAutoSaleAutomation = () => {
    const validationError = autoSaleRunner.start(autoSaleConfig);
    if (validationError) {
      setAutoSaleError(validationError);
    }
  };

  const stopAutoSaleAutomation = () => {
    autoSaleRunner.stop();
  };

  useEffect(() => {
    const unsubscribe = autoSaleRunner.subscribe((snapshot) => {
      setAutoSaleActive(Boolean(snapshot.active));
      setAutoSaleConfig(snapshot.config || DEFAULT_AUTO_SALE_CONFIG);
      setAutoSaleSummary(snapshot.summary || DEFAULT_AUTO_SALE_SUMMARY);
      setAutoSaleError(snapshot.error || '');
      setAutoSaleRemainingMs(snapshot.remainingMs);
    });
    autoSaleRunner.resumeIfNeeded();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!weeklyScheduleRows.length) return;
    if (!weeklyScheduleRows.some((row) => row.dayKey === selectedScheduleDay)) {
      setSelectedScheduleDay(weeklyScheduleRows[0].dayKey);
    }
  }, [weeklyScheduleRows, selectedScheduleDay]);

  const normalizeForm = (value) => ({
    ...value,
    closedDays: [...(value.closedDays || [])].sort(),
    weeklySchedule: normalizeWeeklySchedule({ weeklySchedule: value.weeklySchedule }),
    specialDays: normalizeSpecialDays(value.specialDays)
      .sort((left, right) => {
        const byDate = left.date.localeCompare(right.date, 'tr-TR');
        if (byDate !== 0) return byDate;
        return left.id.localeCompare(right.id, 'tr-TR');
      }),
    logisticsTariffs: normalizeLogisticsTariffs(value.logisticsTariffs),
    customerRelations: {
      giftCards: normalizeGiftCards(value?.customerRelations?.giftCards)
        .map((item) => ({
          ...item,
          allowedCategoryIds: [...item.allowedCategoryIds].sort(),
        }))
        .sort((a, b) => a.code.localeCompare(b.code, 'tr-TR')),
      campaigns: normalizeCampaigns(value?.customerRelations?.campaigns)
        .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR')),
      automationCenter: normalizeAutomationCenter(value?.customerRelations?.automationCenter),
    },
  });

  const isDirty = useMemo(() => {
    return JSON.stringify(normalizeForm(form)) !== JSON.stringify(normalizeForm(savedForm));
  }, [form, savedForm]);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const [data, loginRows, auditRows, developerRows] = await Promise.all([
        settingsService.get(),
        !isCampaignPage && isAdmin ? settingsService.getLoginActivities(20) : Promise.resolve([]),
        !isCampaignPage && isAdmin ? settingsService.getAuditLogs(80) : Promise.resolve([]),
        !isCampaignPage && isAdmin ? settingsService.getDeveloperLogs({ limit: 120 }) : Promise.resolve([]),
      ]);
      const mapped = mapSettingsToForm(data);
      setForm(mapped);
      setSavedForm(mapped);
      setUpdatedAt(data.updatedAt || '');
      setLoginActivities(sanitizeObjectRows(loginRows));
      setLoginActivitiesTotal(extractResponseTotal(loginRows));
      setAuditLogs(sanitizeObjectRows(auditRows));
      setAuditLogsTotal(extractResponseTotal(auditRows));
      setDeveloperLogs(sanitizeObjectRows(developerRows));
      setDeveloperLogsTotal(extractResponseTotal(developerRows));
      if (isAdmin) {
        setDeskPins(createDefaultDeskPins(data.deskPins || {}));
        setSystemManagementPin(String(data.posPin || '1234').slice(0, 4));
        setRoleManagementPin(String(data.roleManagementPin || '1234').slice(0, 4));
      }
    } catch (error) {
      setToast({ type: 'error', title: 'Sistem Ayarları', message: error.message || 'Ayarlar yüklenemedi.' });
    } finally {
      setIsLoading(false);
    }
  };

  const loadCampaignCustomers = async () => {
    try {
      const list = await customerAdminService.list();
      setCampaignCustomers(
        (Array.isArray(list) ? list : []).map((customer) => ({
          ...customer,
          name: normalizeCustomerDisplayName(customer?.name),
        }))
      );
    } catch {
      setCampaignCustomers([]);
    }
  };

  useEffect(() => {
    loadSettings();
    Promise.allSettled([
      categoryService.list(),
      productService.list({ universe: 'listed_active', includeUnlisted: false, includeTotal: false, fetchAll: true, includeCampaignDetails: true }),
    ]).then(([categoryResult, productResult]) => {
      setAvailableCategories(categoryResult.status === 'fulfilled' && Array.isArray(categoryResult.value) ? categoryResult.value : []);
      const products = productResult.status === 'fulfilled' && Array.isArray(productResult.value) ? productResult.value : [];
      setAvailableProducts(products);
      const brands = buildCampaignBrandOptions(products);
      setAvailableBrands(brands);
    });
    if (isCampaignPage) return;
    reportService.getDashboard().then((d) => {
      setStats({
        totalProducts: d.overview.totalProducts,
        totalSuppliers: d.overview.totalSuppliers,
        totalStockQuantity: d.overview.totalStockQuantity,
      });
    }).catch(() => {});
  }, [isCampaignPage]);

  useEffect(() => {
    if (!isCampaignPage) return;

    const loadCrossModuleSignals = async () => {
      try {
        setCrossModuleLoading(true);
        setCrossModuleError('');
        const [pricingAnalysis, purchaseSuggestions, campaignAnalysis] = await Promise.all([
          pricingAnalysisService.getAnalysis({ full: true, forceRefresh: true }),
          procurementService.listSuggestions({ status: 'pending' }),
          campaignAnalysisService.getSuggestions({ full: true, limit: 1000, forceRefresh: true }),
        ]);
        setPricingSignals(pricingAnalysis?.sections || {});
        setBackendCampaignRows(Array.isArray(campaignAnalysis?.rows) ? campaignAnalysis.rows : []);
        setBackendCampaignSuggestions(Array.isArray(campaignAnalysis?.suggestions) ? campaignAnalysis.suggestions : []);
        setCampaignEligibleProductCount(Math.max(0, Number(campaignAnalysis?.eligibleProductCount || pricingAnalysis?.summary?.totalAnalyzedProducts || 0) || 0));
        setOrderSuggestionSignals(Array.isArray(purchaseSuggestions) ? purchaseSuggestions : []);
      } catch (error) {
        setCrossModuleError(error.message || 'Modüller arası veri yüklenemedi.');
        setPricingSignals({});
        setBackendCampaignRows([]);
        setBackendCampaignSuggestions([]);
        setCampaignEligibleProductCount(0);
        setOrderSuggestionSignals([]);
      } finally {
        setCrossModuleLoading(false);
      }
    };

    loadCrossModuleSignals();
  }, [isCampaignPage, suggestionRefreshKey]);

  useEffect(() => {
    if (!isCampaignPage) return;
    userService.list()
      .then((users) => {
        const list = Array.isArray(users) && users.length > 0 ?
           users.map((u) => ({ id: u.id, name: `${u.name || u.username || u.id}` }))
          : [];
        setAssignableUsers(list);
      })
      .catch(() => setAssignableUsers([]));
  }, [isCampaignPage]);

  useEffect(() => {
    if (!isCampaignPage) return;
    void loadCampaignCustomers();
  }, [isCampaignPage]);

  useEffect(() => {
    if (!isCampaignPage || typeof window === 'undefined') return;

    try {
      const pricingDraftRaw = window.localStorage.getItem('pricingCampaignDraft');
      if (pricingDraftRaw) {
        const pricingDraft = JSON.parse(pricingDraftRaw);
        const productIds = Array.isArray(pricingDraft?.productIds) ? pricingDraft.productIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
        setCampaignDraft((current) => ({
          ...current,
          type: productIds.length ? 'product' : 'dynamic',
          name: 'Price Recommendations kaynaklı kampanya',
          discountRate: String(pricingDraft?.discountRate || current.discountRate || 12),
          targetProductIds: productIds,
          targetProductIdsText: productIds.length ? productIds.join(', ') : current.targetProductIdsText,
        }));
        if (productIds.length) setCampaignTypeView('product');
      }

      const orderDraftRaw = window.localStorage.getItem('orderCampaignDraft');
      if (orderDraftRaw) {
        const orderDraft = JSON.parse(orderDraftRaw);
        const productIds = Array.isArray(orderDraft?.productIds) ? orderDraft.productIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
        setCampaignDraft((current) => ({
          ...current,
          name: orderDraft?.name || current.name || 'Order Recommendations kaynaklı kampanya',
          type: productIds.length ? 'product' : (orderDraft?.type || current.type || 'category'),
          targetProductIds: productIds,
          targetProductIdsText: productIds.length ? productIds.join(', ') : current.targetProductIdsText,
        }));
        if (productIds.length) setCampaignTypeView('product');
      }
    } catch {
      // Local draft parse hatasi kampanya ekranini kesmemeli.
    }
  }, [isCampaignPage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(NOTIFICATION_SOUND_ENABLED_KEY, notificationSoundEnabled ? 'true' : 'false');
      window.localStorage.setItem(NOTIFICATION_SOUND_VOLUME_KEY, String(clampSoundVolume(notificationSoundVolume)));
    } catch {
      // Local storage erişim hatası kritik değil.
    }
  }, [notificationSoundEnabled, notificationSoundVolume]);

  useEffect(() => {
    if (!isCampaignPage) return;
    const params = new URLSearchParams(location.search);
    const requestedView = normalizeCampaignViewKey(params.get('campaignView'), '');
    if (requestedView && requestedView !== campaignTypeView) {
      setCampaignTypeView(requestedView);
    }
    if (!requestedView && campaignTypeView !== 'all') {
      setCampaignTypeView('all');
    }
  }, [isCampaignPage, location.search]);

  useEffect(() => {
    if (!isCampaignPage) return;
    const params = new URLSearchParams(location.search);
    const currentView = normalizeCampaignViewKey(params.get('campaignView'), 'all');
    const nextView = normalizeCampaignViewKey(campaignTypeView, 'all');

    if (nextView === 'all') {
      if (!params.has('campaignView')) return;
      params.delete('campaignView');
    } else {
      if (currentView === nextView && params.get('campaignView') === nextView) return;
      params.set('campaignView', nextView);
    }

    navigate({
      pathname: location.pathname,
      search: params.toString() ? `?${params.toString()}` : '',
    }, { replace: true });
  }, [campaignTypeView, isCampaignPage, location.pathname, location.search, navigate]);

  const handlePreviewNotificationSound = async () => {
    if (!notificationSoundEnabled) {
      setToast({ type: 'warning', title: 'Ses Ayarları', message: 'Önce bildirim sesini aktif edin.' });
      return;
    }

    try {
      await playNotificationTone(clampSoundVolume(notificationSoundVolume));
    } catch {
      setToast({ type: 'error', title: 'Ses Ayarları', message: 'Ses Önizlemesi başlatılamadı.' });
    }
  };

  const loadDeveloperLogs = async (filters = developerLogFilters) => {
    if (!isAdmin) return;
    try {
      setDeveloperLogsLoading(true);
      const rows = await settingsService.getDeveloperLogs({ ...filters, limit: 300 });
      setDeveloperLogs(sanitizeObjectRows(rows));
      setDeveloperLogsTotal(extractResponseTotal(rows));
    } catch (error) {
      setToast({ type: 'error', title: 'Geliştirici Logları', message: error.message || 'Loglar yüklenemedi.' });
    } finally {
      setDeveloperLogsLoading(false);
    }
  };

  const logPdfExportStep = (flow, step, details = {}) => {
    console.info(`[PDF Export][${flow}] ${step}`, details);
  };

  const logPdfExportError = (flow, error, details = {}) => {
    const payload = {
      level: 'error',
      source: 'frontend',
      message: error?.message || `${flow} PDF export failed`,
      action: 'settings_pdf_export',
      endpoint: '/settings',
      requestUrl: window.location.href,
      stack: error?.stack || '',
      errorType: 'pdf_export_error',
      browserInfo: navigator.userAgent,
      data: {
        flow,
        ...details,
      },
    };

    console.error(`[PDF Export][${flow}]`, payload);
    settingsService.sendDeveloperLog(payload);
  };

  const downloadPdfBlob = (blob, filename) => {
    const fileBlob = blob instanceof Blob ? blob : new Blob([blob], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(fileBlob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  };

  const createAndDownloadPdf = async ({ flow, filename, docDefinition, rowCount }) => {
    logPdfExportStep(flow, 'Başladı', { rowCount });

    const { pdfMake, ready } = await ensurePdfMakeReady();
    if (!ready) {
      throw new Error('PDF font altyapısı hazır değil');
    }

    logPdfExportStep(flow, 'Font hazır', { vfsEntries: Object.keys(pdfMake.vfs || {}).length });
    const pdfDocument = pdfMake.createPdf(docDefinition);

    const blob = await new Promise((resolve, reject) => {
      try {
        pdfDocument.getBlob((result) => resolve(result));
      } catch (error) {
        reject(error);
      }
    });

    if (!(blob instanceof Blob) || blob.size === 0) {
      throw new Error('PDF blob oluşturulamadı');
    }

    logPdfExportStep(flow, 'Blob oluştu', { size: blob.size, mime: blob.type || 'application/pdf' });
    downloadPdfBlob(blob, filename);
    logPdfExportStep(flow, 'İndirme tetiklendi', { filename });
  };

  const getPdfExportErrorMessage = (error) => {
    const text = String(error?.message || '').toLocaleLowerCase('tr-TR');
    if (text.includes('kayıt bulunamadı') || text.includes('kayit bulunamadi')) {
      return 'Dışa aktarılacak kayıt bulunamadı.';
    }
    return 'PDF dışa aktarma sırasında bir sorun oluştu. Lütfen tekrar deneyin.';
  };

  const handleExportAuditXlsx = async (rowsOverride = null) => {
    try {
      const XLSX = await loadXlsx();
      const reportDate = toReportDate();
      const sourceRows = Array.isArray(rowsOverride) ? rowsOverride : (auditLogs || []);
      const rows = sourceRows.map((row) => ({
        'Tarih/Saat': formatDateTime(row.createdAt || row.at),
        Kullanici: row.actorName || row.actor || row.userName || '-',
        Aksiyon: row.actionLabel || row.action || '-',
        Detay: row.details || row.detail || row.summary || '-',
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Tarih/Saat': '-', Kullanici: '-', Aksiyon: '-', Detay: '-' }]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Audit Log');
      XLSX.writeFile(workbook, `audit-log-raporu-${reportDate}.xlsx`);
    } catch (error) {
      setToast({ type: 'error', title: 'Audit Log', message: error.message || 'Excel dışa aktarma başarısız.' });
    }
  };

  const handleExportAuditPdf = async (rowsOverride = null) => {
    if (exportingPdfType) return;
    const sourceRows = Array.isArray(rowsOverride) ? rowsOverride : (auditLogs || []);
    if (!sourceRows.length) {
      setToast({ type: 'warning', title: 'Audit Log', message: 'Dışa aktarılacak kayıt bulunamadı.' });
      return;
    }

    setExportingPdfType('audit');
    try {
      const reportDate = toReportDate();
      const tableBody = [
        [
          { text: 'Tarih/Saat', style: 'tableHeader' },
          { text: 'Kullanıcı', style: 'tableHeader' },
          { text: 'Aksiyon', style: 'tableHeader' },
          { text: 'Detay', style: 'tableHeader' },
        ],
        ...sourceRows.map((row) => ([
          { text: safeReportCell(formatDateTime(row.createdAt || row.at)), style: 'tableCellSubtle' },
          { text: safeReportCell(row.actorName || row.actor || row.userName), style: 'tableCell' },
          { text: safeReportCell(row.actionLabel || row.action), style: 'tableCell' },
          { text: safeReportCell(row.details || row.detail || row.summary), style: 'tableCellWrap' },
        ])),
      ];

      const docDefinition = {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: [36, 46, 36, 42],
        defaultStyle: {
          font: 'Roboto',
          fontSize: 9.5,
          lineHeight: 1.3,
          color: '#1f2937',
        },
        footer: (currentPage, pageCount) => ({
          margin: [36, 0, 36, 16],
          columns: [
            { text: '' },
            { text: `Sayfa ${currentPage}/${pageCount}`, alignment: 'right', fontSize: 8, color: '#64748b' },
          ],
        }),
        content: [
          { text: 'Sistem Audit Log Raporu', style: 'reportTitle' },
          {
            margin: [0, 8, 0, 16],
            table: {
              widths: [120, '*'],
              body: [
                [{ text: 'Toplam Kayıt', style: 'metaLabel' }, { text: String(sourceRows.length), style: 'metaValue' }],
                [{ text: 'Rapor Tarihi', style: 'metaLabel' }, { text: reportDate, style: 'metaValue' }],
              ],
            },
            layout: 'noBorders',
          },
          {
            table: {
              headerRows: 1,
              dontBreakRows: true,
              keepWithHeaderRows: 1,
              widths: [92, 90, 110, '*'],
              body: tableBody,
            },
            layout: {
              fillColor: (rowIndex) => {
                if (rowIndex === 0) return '#eef2f7';
                return rowIndex % 2 === 0 ? '#fafcff' : '#ffffff';
              },
              hLineColor: () => '#dbe3ee',
              vLineColor: () => '#dbe3ee',
              hLineWidth: () => 1,
              vLineWidth: () => 1,
              paddingLeft: () => 8,
              paddingRight: () => 8,
              paddingTop: () => 7,
              paddingBottom: () => 7,
            },
          },
        ],
        styles: {
          reportTitle: {
            fontSize: 18,
            bold: true,
            color: '#0f172a',
          },
          metaLabel: {
            fontSize: 9.5,
            bold: true,
            color: '#334155',
            margin: [0, 2, 0, 2],
          },
          metaValue: {
            fontSize: 9.5,
            color: '#475569',
            margin: [0, 2, 0, 2],
          },
          tableHeader: {
            bold: true,
            fontSize: 9.5,
            color: '#0f172a',
          },
          tableCell: {
            fontSize: 9,
            color: '#1f2937',
          },
          tableCellSubtle: {
            fontSize: 8.7,
            color: '#475569',
          },
          tableCellWrap: {
            fontSize: 9,
            color: '#1f2937',
            lineHeight: 1.28,
          },
        },
      };

      await createAndDownloadPdf({
        flow: 'AuditLog',
        filename: `audit-log-raporu-${reportDate}.pdf`,
        docDefinition,
        rowCount: sourceRows.length,
      });
      setToast({ type: 'success', title: 'Audit Log', message: 'PDF indirildi.' });
    } catch (error) {
      logPdfExportError('AuditLog', error, { rowCount: sourceRows.length });
      setToast({ type: 'error', title: 'Audit Log', message: getPdfExportErrorMessage(error) });
    } finally {
      setExportingPdfType('');
    }
  };

  const handleExportDeveloperXlsx = async () => {
    try {
      const XLSX = await loadXlsx();
      const reportDate = toReportDate();
      const rows = (developerLogs || []).map((row) => ({
        'Tarih/Saat': formatDateTime(row.timestamp),
        'Hata Tipi': getLogLevelLabel(row.level),
        Mesaj: row.message || '-',
        Kaynak: row.source || '-',
        Islem: row.action || '-',
        Kullanici: row.userName || row.user || '-',
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Tarih/Saat': '-', 'Hata Tipi': '-', Mesaj: '-', Kaynak: '-', Islem: '-', Kullanici: '-' }]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Developer Logs');
      XLSX.writeFile(workbook, `developer-log-raporu-${reportDate}.xlsx`);
    } catch (error) {
      setToast({ type: 'error', title: 'Geliştirici Logları', message: error.message || 'Excel dışa aktarma başarısız.' });
    }
  };

  const handleExportDeveloperPdf = async () => {
    if (exportingPdfType) return;
    const rows = developerLogs || [];
    if (!rows.length) {
      setToast({ type: 'warning', title: 'Geliştirici Logları', message: 'Dışa aktarılacak kayıt bulunamadı.' });
      return;
    }

    setExportingPdfType('developer');
    try {
      const reportDate = toReportDate();
      const body = [
        [
          { text: 'Tarih/Saat', style: 'tableHeader' },
          { text: 'Hata Tipi', style: 'tableHeader' },
          { text: 'Mesaj', style: 'tableHeader' },
          { text: 'Kaynak', style: 'tableHeader' },
          { text: 'İşlem', style: 'tableHeader' },
          { text: 'Kullanıcı', style: 'tableHeader' },
        ],
          ...(rows.length ?
           rows.map((row) => ([
            { text: safeReportCell(formatDateTime(row.timestamp)), style: 'tableCellSubtle' },
            { text: safeReportCell(getLogLevelLabel(row.level)), style: 'tableCell' },
            { text: safeReportCell(row.message), style: 'tableCellWrap' },
            { text: safeReportCell(row.source), style: 'tableCell' },
            { text: safeReportCell(row.action), style: 'tableCell' },
            { text: safeReportCell(row.userName || row.user), style: 'tableCell' },
          ]))
          : [[
            { text: '-', style: 'tableCellSubtle' },
            { text: '-', style: 'tableCell' },
            { text: 'Filtre kriterlerine uygun kayit bulunamadi.', style: 'tableCellWrap' },
            { text: '-', style: 'tableCell' },
            { text: '-', style: 'tableCell' },
            { text: '-', style: 'tableCell' },
          ]]),
      ];

      const docDefinition = {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: [36, 46, 36, 42],
        defaultStyle: {
          font: 'Roboto',
          fontSize: 9.4,
          lineHeight: 1.28,
          color: '#1f2937',
        },
        footer: (currentPage, pageCount) => ({
          margin: [36, 0, 36, 16],
          columns: [
            { text: '' },
            { text: `Sayfa ${currentPage}/${pageCount}`, alignment: 'right', fontSize: 8, color: '#64748b' },
          ],
        }),
        content: [
          { text: 'Geliştirici Log Raporu', style: 'reportTitle' },
          {
            margin: [0, 8, 0, 16],
            table: {
              widths: [120, '*'],
              body: [
                [{ text: 'Toplam Kayit', style: 'metaLabel' }, { text: String(rows.length), style: 'metaValue' }],
                [{ text: 'Rapor Tarihi', style: 'metaLabel' }, { text: reportDate, style: 'metaValue' }],
              ],
            },
            layout: 'noBorders',
          },
          {
            table: {
              headerRows: 1,
              dontBreakRows: true,
              keepWithHeaderRows: 1,
              widths: [76, 58, '*', 66, 80, 74],
              body,
            },
            layout: {
              fillColor: (rowIndex) => {
                if (rowIndex === 0) return '#eef2f7';
                return rowIndex % 2 === 0 ? '#fafcff' : '#ffffff';
              },
              hLineColor: () => '#dbe3ee',
              vLineColor: () => '#dbe3ee',
              hLineWidth: () => 1,
              vLineWidth: () => 1,
              paddingLeft: () => 7,
              paddingRight: () => 7,
              paddingTop: () => 6,
              paddingBottom: () => 6,
            },
          },
        ],
        styles: {
          reportTitle: { fontSize: 18, bold: true, color: '#0f172a' },
          metaLabel: { fontSize: 9.5, bold: true, color: '#334155', margin: [0, 2, 0, 2] },
          metaValue: { fontSize: 9.5, color: '#475569', margin: [0, 2, 0, 2] },
          tableHeader: { bold: true, fontSize: 9.5, color: '#0f172a' },
          tableCell: { fontSize: 9, color: '#1f2937' },
          tableCellSubtle: { fontSize: 8.7, color: '#475569' },
          tableCellWrap: { fontSize: 9, color: '#1f2937', lineHeight: 1.28 },
        },
      };

      await createAndDownloadPdf({
        flow: 'DeveloperLog',
        filename: `developer-log-raporu-${reportDate}.pdf`,
        docDefinition,
        rowCount: rows.length,
      });
      setToast({ type: 'success', title: 'Geliştirici Logları', message: 'PDF indirildi.' });
    } catch (error) {
      logPdfExportError('DeveloperLog', error, { rowCount: rows.length });
      setToast({ type: 'error', title: 'Geliştirici Logları', message: getPdfExportErrorMessage(error) });
    } finally {
      setExportingPdfType('');
    }
  };

  const handleExportDeveloperJson = async () => {
    try {
      const rows = await settingsService.exportDeveloperLogs('json', developerLogFilters);
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `developer-logs-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setToast({ type: 'error', title: 'Geliştirici Logları', message: error.message || 'JSON dışa aktarma başarısız.' });
    }
  };

  const handleExportLoginXlsx = async (rowsOverride = null) => {
    try {
      const XLSX = await loadXlsx();
    const rows = Array.isArray(rowsOverride) ? rowsOverride : (loginActivities || []);

    const sheetRows = rows.map((item) => {
      const { os, browser } = parseUserAgentInfo(item);
      return {
        'Personel Adi': item.userName || '-',
        'Sicil No': item.registerPin || '-',
        'E-posta': item.email || item.username || '-',
        'IP Adresi': item.ipAddress || item.ip || '-',
        'Isletim Sistemi': os,
        Tarayici: browser,
        'Tarih/Saat': formatDateTime(resolveLoginActivityDate(item)),
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(sheetRows.length ? sheetRows : [{ 'Personel Adi': '-', 'Sicil No': '-', 'E-posta': '-', 'IP Adresi': '-', 'Isletim Sistemi': '-', Tarayici: '-', 'Tarih/Saat': '-' }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Giriş Aktiviteleri');
    XLSX.writeFile(workbook, `login-aktivite-raporu-${toReportDate()}.xlsx`);
    } catch (error) {
      setToast({ type: 'error', title: 'Son Giriş Aktiviteleri', message: error.message || 'Excel dışa aktarma başarısız.' });
    }
  };

  const handleExportLoginPdf = async (rowsOverride = null) => {
    if (exportingPdfType) return;
    const rows = Array.isArray(rowsOverride) ? rowsOverride : (loginActivities || []);
    if (!rows.length) {
      setToast({ type: 'warning', title: 'Son Giriş Aktiviteleri', message: 'Dışa aktarılacak kayıt bulunamadı.' });
      return;
    }

    setExportingPdfType('login');
    try {
      const reportDate = toReportDate();
      const tableBody = [
        [
          { text: 'Personel Adı', style: 'tableHeader' },
          { text: 'Sicil No', style: 'tableHeader' },
          { text: 'E-posta', style: 'tableHeader' },
          { text: 'IP Adresi', style: 'tableHeader' },
          { text: 'İşletim Sistemi', style: 'tableHeader' },
          { text: 'Tarih/Saat', style: 'tableHeader' },
        ],
        ...rows.map((item) => {
          const { os } = parseUserAgentInfo(item);
          return [
            { text: safeReportCell(item.userName), style: 'tableCell' },
            { text: safeReportCell(item.registerPin), style: 'tableCell' },
            { text: safeReportCell(item.email || item.username), style: 'tableCellWrap' },
            { text: safeReportCell(item.ipAddress || item.ip), style: 'tableCell' },
            { text: safeReportCell(os), style: 'tableCell' },
            { text: safeReportCell(formatDateTime(resolveLoginActivityDate(item))), style: 'tableCellSubtle' },
          ];
        }),
      ];

      const docDefinition = {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: [36, 46, 36, 42],
        defaultStyle: {
          font: 'Roboto',
          fontSize: 9.5,
          lineHeight: 1.3,
          color: '#1f2937',
        },
        footer: (currentPage, pageCount) => ({
          margin: [36, 0, 36, 16],
          columns: [
            { text: '' },
            { text: `Sayfa ${currentPage}/${pageCount}`, alignment: 'right', fontSize: 8, color: '#64748b' },
          ],
        }),
        content: [
          { text: 'Son Giriş Aktiviteleri Raporu', style: 'reportTitle' },
          {
            margin: [0, 8, 0, 16],
            table: {
              widths: [120, '*'],
              body: [
                [{ text: 'Toplam Kayıt', style: 'metaLabel' }, { text: String(rows.length), style: 'metaValue' }],
                [{ text: 'Rapor Tarihi', style: 'metaLabel' }, { text: reportDate, style: 'metaValue' }],
              ],
            },
            layout: 'noBorders',
          },
          {
            table: {
              headerRows: 1,
              dontBreakRows: true,
              keepWithHeaderRows: 1,
              widths: [86, 52, 112, 76, 74, '*'],
              body: tableBody,
            },
            layout: {
              fillColor: (rowIndex) => {
                if (rowIndex === 0) return '#eef2f7';
                return rowIndex % 2 === 0 ? '#fafcff' : '#ffffff';
              },
              hLineColor: () => '#dbe3ee',
              vLineColor: () => '#dbe3ee',
              hLineWidth: () => 1,
              vLineWidth: () => 1,
              paddingLeft: () => 8,
              paddingRight: () => 8,
              paddingTop: () => 7,
              paddingBottom: () => 7,
            },
          },
        ],
        styles: {
          reportTitle: {
            fontSize: 18,
            bold: true,
            color: '#0f172a',
          },
          metaLabel: {
            fontSize: 9.5,
            bold: true,
            color: '#334155',
            margin: [0, 2, 0, 2],
          },
          metaValue: {
            fontSize: 9.5,
            color: '#475569',
            margin: [0, 2, 0, 2],
          },
          tableHeader: {
            bold: true,
            fontSize: 9.5,
            color: '#0f172a',
          },
          tableCell: {
            fontSize: 9,
            color: '#1f2937',
          },
          tableCellSubtle: {
            fontSize: 8.7,
            color: '#475569',
          },
          tableCellWrap: {
            fontSize: 9,
            color: '#1f2937',
            lineHeight: 1.28,
          },
        },
      };

      await createAndDownloadPdf({
        flow: 'LoginActivity',
        filename: `login-aktivite-raporu-${reportDate}.pdf`,
        docDefinition,
        rowCount: rows.length,
      });
      setToast({ type: 'success', title: 'Son Giriş Aktiviteleri', message: 'PDF indirildi.' });
    } catch (error) {
      logPdfExportError('LoginActivity', error, { rowCount: rows.length });
      setToast({ type: 'error', title: 'Son Giriş Aktiviteleri', message: getPdfExportErrorMessage(error) });
    } finally {
      setExportingPdfType('');
    }
  };

  const handleDeveloperLogFilterChange = (event) => {
    const { name, value } = event.target;
    setDeveloperLogFilters((current) => ({ ...current, [name]: value }));
  };

  const handleDeveloperLogSearch = () => {
    loadDeveloperLogs(developerLogFilters);
  };

  const handleDeveloperLogClearFilters = () => {
    setDeveloperLogFilters(DEFAULT_DEVELOPER_LOG_FILTERS);
    loadDeveloperLogs(DEFAULT_DEVELOPER_LOG_FILTERS);
  };

  const openDeveloperLogManagerModal = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    window.setTimeout(() => {
      setDeveloperLogManagerModalOpen(true);
    }, 0);
  };

  const handleDeveloperLogDraftChange = (event) => {
    const { name, value } = event.target;
    setDeveloperLogDraft((current) => ({ ...current, [name]: value }));
  };

  const openDeveloperLogCreateModal = () => {
    setDeveloperLogDraft(createDeveloperLogDraft());
    setDeveloperLogCreateModalOpen(true);
  };

  const handleCreateDeveloperLog = async (event) => {
    event.preventDefault();

    const message = String(developerLogDraft.message || '').trim();
    if (!message) {
      setToast({ type: 'error', title: 'Sistem Kayıtları', message: 'Hata mesajı alanı zorunludur.' });
      return;
    }

    const payload = {
      level: developerLogDraft.level,
      source: developerLogDraft.source,
      action: String(developerLogDraft.action || '').trim() || 'manual_log',
      endpoint: String(developerLogDraft.endpoint || '').trim(),
      requestUrl: String(developerLogDraft.endpoint || '').trim(),
      message,
      stack: String(developerLogDraft.stack || '').trim(),
      errorType: String(developerLogDraft.errorType || '').trim(),
    };

    if (developerLogDraft.statusCode !== '') {
      payload.statusCode = Number(developerLogDraft.statusCode) || 0;
    }

    try {
      payload.requestPayload = parseOptionalJson(developerLogDraft.requestPayload, 'İstek verisi');
      payload.response = parseOptionalJson(developerLogDraft.response, 'Yanıt verisi');

      setCreatingDeveloperLog(true);
      await settingsService.createDeveloperLog(payload);
      await loadDeveloperLogs();
      setDeveloperLogCreateModalOpen(false);
      setDeveloperLogDraft(createDeveloperLogDraft());
      setToast({ type: 'success', title: 'Sistem Kayıtları', message: 'Kayıt başarıyla oluşturuldu.' });
    } catch (error) {
      setToast({ type: 'error', title: 'Sistem Kayıtları', message: error.message || 'Kayıt oluşturulamadı.' });
    } finally {
      setCreatingDeveloperLog(false);
    }
  };

  const developerUsers = useMemo(() => {
    const map = new Map();
    developerLogs.forEach((row) => {
      const id = String(row.userId || '').trim();
      if (!id) return;
      if (!map.has(id)) {
        map.set(id, row.userName || row.user || id);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [developerLogs]);

  const auditActionOptions = useMemo(() => {
    const values = new Set();
    (auditLogs || []).forEach((row) => {
      const value = String(row.actionLabel || row.action || '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr-TR'));
  }, [auditLogs]);

  const auditUsers = useMemo(() => {
    const values = new Set();
    (auditLogs || []).forEach((row) => {
      const value = String(row.actorName || row.actor || row.userName || '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr-TR'));
  }, [auditLogs]);

  const loginUsers = useMemo(() => {
    const values = new Set();
    (loginActivities || []).forEach((row) => {
      const value = String(row.userName || row.username || '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr-TR'));
  }, [loginActivities]);

  const loginBrowserOptions = useMemo(() => {
    const values = new Set();
    (loginActivities || []).forEach((row) => {
      const parsed = parseUserAgentInfo(row);
      const value = String(parsed.browser || '').trim();
      if (value && value !== 'Bilinmiyor') values.add(value);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr-TR'));
  }, [loginActivities]);

  const isDateInRange = (value, from, to) => {
    if (!value) return false;
    const sourceDate = new Date(value);
    if (Number.isNaN(sourceDate.getTime())) return false;
    const sourceDay = sourceDate.toISOString().slice(0, 10);
    if (from && sourceDay < from) return false;
    if (to && sourceDay > to) return false;
    return true;
  };

  const filteredAuditLogs = useMemo(() => {
    const active = auditLogAppliedFilters;
    const query = String(active.search || '').trim().toLocaleLowerCase('tr-TR');
    return (auditLogs || []).filter((row) => {
      if (!row || typeof row !== 'object') return false;
      const rowDate = row.createdAt || row.at;
      if ((active.from || active.to) && !isDateInRange(rowDate, active.from, active.to)) return false;
      const action = String(row.actionLabel || row.action || '');
      const userName = String(row.actorName || row.actor || row.userName || '');
      if (active.action && action !== active.action) return false;
      if (active.user && userName !== active.user) return false;
      if (query) {
        const haystack = [action, userName, row.details, row.detail, row.summary, row.id]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('tr-TR');
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [auditLogAppliedFilters, auditLogs]);

  const filteredLoginActivities = useMemo(() => {
    const active = loginActivityAppliedFilters;
    const query = String(active.search || '').trim().toLocaleLowerCase('tr-TR');
    return (loginActivities || []).filter((row) => {
      if (!row || typeof row !== 'object') return false;
      const loginDate = resolveLoginActivityDate(row);
      if ((active.from || active.to) && !isDateInRange(loginDate, active.from, active.to)) return false;
      const userName = String(row.userName || row.username || '');
      const ipValue = String(row.ipAddress || row.ip || '');
      const browser = parseUserAgentInfo(row).browser;
      if (active.user && userName !== active.user) return false;
      if (active.browser && browser !== active.browser) return false;
      if (active.ip && !ipValue.toLocaleLowerCase('tr-TR').includes(String(active.ip).toLocaleLowerCase('tr-TR'))) return false;
      if (query) {
        const parsed = parseUserAgentInfo(row);
        const haystack = [
          userName,
          row.registerPin,
          row.email,
          row.username,
          ipValue,
          parsed.os,
          parsed.browser,
          row.userAgent,
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('tr-TR');
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [loginActivities, loginActivityAppliedFilters]);

  const handleAuditLogFilterChange = (event) => {
    const { name, value } = event.target;
    setAuditLogFilters((current) => ({ ...current, [name]: value }));
  };

  const handleAuditLogSearch = async () => {
    try {
      setAuditLogManagerLoading(true);
      const rows = await settingsService.getAuditLogs({ ...auditLogFilters, limit: 300 });
      setAuditLogs(sanitizeObjectRows(rows));
      setAuditLogsTotal(extractResponseTotal(rows));
      setAuditLogAppliedFilters(auditLogFilters);
    } catch (error) {
      setToast({ type: 'error', title: 'Audit Log', message: error.message || 'Audit log filtreleri uygulanamadı.' });
    } finally {
      setAuditLogManagerLoading(false);
    }
  };

  const handleAuditLogClearFilters = async () => {
    try {
      setAuditLogManagerLoading(true);
      const rows = await settingsService.getAuditLogs(300);
      setAuditLogs(sanitizeObjectRows(rows));
      setAuditLogsTotal(extractResponseTotal(rows));
      setAuditLogFilters(DEFAULT_AUDIT_LOG_FILTERS);
      setAuditLogAppliedFilters(DEFAULT_AUDIT_LOG_FILTERS);
    } catch (error) {
      setToast({ type: 'error', title: 'Audit Log', message: error.message || 'Audit log filtreleri temizlenemedi.' });
    } finally {
      setAuditLogManagerLoading(false);
    }
  };

  const handleLoginActivityFilterChange = (event) => {
    const { name, value } = event.target;
    setLoginActivityFilters((current) => ({ ...current, [name]: value }));
  };

  const handleLoginActivitySearch = async () => {
    try {
      setLoginActivityManagerLoading(true);
      const rows = await settingsService.getLoginActivities({ ...loginActivityFilters, limit: 300 });
      setLoginActivities(sanitizeObjectRows(rows));
      setLoginActivitiesTotal(extractResponseTotal(rows));
      setLoginActivityAppliedFilters(loginActivityFilters);
    } catch (error) {
      setToast({ type: 'error', title: 'Son Giriş Aktiviteleri', message: error.message || 'Giriş aktivitesi filtreleri uygulanamadı.' });
    } finally {
      setLoginActivityManagerLoading(false);
    }
  };

  const handleLoginActivityClearFilters = async () => {
    try {
      setLoginActivityManagerLoading(true);
      const rows = await settingsService.getLoginActivities(300);
      setLoginActivities(sanitizeObjectRows(rows));
      setLoginActivitiesTotal(extractResponseTotal(rows));
      setLoginActivityFilters(DEFAULT_LOGIN_ACTIVITY_FILTERS);
      setLoginActivityAppliedFilters(DEFAULT_LOGIN_ACTIVITY_FILTERS);
    } catch (error) {
      setToast({ type: 'error', title: 'Son Giriş Aktiviteleri', message: error.message || 'Giriş aktivitesi filtreleri temizlenemedi.' });
    } finally {
      setLoginActivityManagerLoading(false);
    }
  };

  const refreshCurrentLogTab = async (type) => {
    if (type === 'activity') {
      const rows = await settingsService.getLoginActivities(300);
      setLoginActivities(sanitizeObjectRows(rows));
      setLoginActivitiesTotal(extractResponseTotal(rows));
      setSelectedLoginActivity(null);
      return;
    }

    if (type === 'audit') {
      const rows = await settingsService.getAuditLogs(300);
      setAuditLogs(sanitizeObjectRows(rows));
      setAuditLogsTotal(extractResponseTotal(rows));
      setSelectedAuditLog(null);
      return;
    }

    const rows = await settingsService.getDeveloperLogs({ ...developerLogFilters, limit: 300 });
    setDeveloperLogs(sanitizeObjectRows(rows));
    setDeveloperLogsTotal(extractResponseTotal(rows));
    setSelectedDeveloperLog(null);
  };

  const handleClearLogRecords = async (type = activityLogTab) => {
    const labels = {
      activity: 'aktivite kayıtları',
      audit: 'audit kayıtları',
      developer: 'geliştirici logları',
    };
    const label = labels[type] || 'log kayıtları';
    const approved = await dialog.confirm({
      title: 'Kayıtlar temizlensin mi?',
      description: 'Bu işlem seçili log türündeki kayıtları temizler.',
      confirmText: 'Temizle',
      cancelText: 'Vazgeç',
      tone: 'danger',
      closeOnBackdrop: true,
    });
    if (!approved) return;

    try {
      if (type === 'developer') setDeveloperLogsLoading(true);
      await settingsService.clearLogs(type);
      await refreshCurrentLogTab(type);
      const [loginRows, auditRows, developerRows] = await Promise.all([
        settingsService.getLoginActivities(300),
        isAdmin ? settingsService.getAuditLogs(300) : Promise.resolve([]),
        isAdmin ? settingsService.getDeveloperLogs({ ...developerLogFilters, limit: 300 }) : Promise.resolve([]),
      ]);
      setLoginActivities(sanitizeObjectRows(loginRows));
      setLoginActivitiesTotal(extractResponseTotal(loginRows));
      setAuditLogs(sanitizeObjectRows(auditRows));
      setAuditLogsTotal(extractResponseTotal(auditRows));
      setDeveloperLogs(sanitizeObjectRows(developerRows));
      setDeveloperLogsTotal(extractResponseTotal(developerRows));
      setToast({ type: 'success', title: 'Log Kayıtları', message: `${label} temizlendi.` });
    } catch (error) {
      setToast({ type: 'error', title: 'Log Kayıtları', message: error.message || 'Log kayıtları temizlenemedi.' });
    } finally {
      if (type === 'developer') setDeveloperLogsLoading(false);
    }
  };

  const openAuditLogManagerModal = async (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    try {
      setAuditLogManagerLoading(true);
      const rows = await settingsService.getAuditLogs(300);
      setAuditLogs(sanitizeObjectRows(rows));
      setAuditLogsTotal(extractResponseTotal(rows));
      setAuditLogFilters(DEFAULT_AUDIT_LOG_FILTERS);
      setAuditLogAppliedFilters(DEFAULT_AUDIT_LOG_FILTERS);
      setAuditLogManagerModalOpen(true);
    } catch (error) {
      setToast({ type: 'error', title: 'Audit Log', message: error.message || 'Audit log detayları yüklenemedi.' });
    } finally {
      setAuditLogManagerLoading(false);
    }
  };

  const openLoginActivityManagerModal = async (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    try {
      setLoginActivityManagerLoading(true);
      const rows = await settingsService.getLoginActivities(300);
      setLoginActivities(sanitizeObjectRows(rows));
      setLoginActivitiesTotal(extractResponseTotal(rows));
      setLoginActivityFilters(DEFAULT_LOGIN_ACTIVITY_FILTERS);
      setLoginActivityAppliedFilters(DEFAULT_LOGIN_ACTIVITY_FILTERS);
      setLoginActivityManagerModalOpen(true);
    } catch (error) {
      setToast({ type: 'error', title: 'Son Giriş Aktiviteleri', message: error.message || 'Giriş aktiviteleri yüklenemedi.' });
    } finally {
      setLoginActivityManagerLoading(false);
    }
  };

  const handleWeeklyScheduleChange = (dayKey, field, fieldValue) => {
    setForm((current) => ({
      ...current,
      weeklySchedule: normalizeWeeklySchedule({ weeklySchedule: current.weeklySchedule })
        .map((row) => (row.dayKey === dayKey ? { ...row, [field]: fieldValue } : row)),
    }));
  };

  const toggleWeeklyClosedDay = (dayKey) => {
    setForm((current) => ({
      ...current,
      weeklySchedule: normalizeWeeklySchedule({ weeklySchedule: current.weeklySchedule })
        .map((row) => {
          if (row.dayKey !== dayKey) return row;
          return {
            ...row,
            isClosed: !row.isClosed,
          };
        }),
    }));
  };

  const applySchedulePreset = (scope) => {
    if (!isAdmin || isLoading || !selectedScheduleRow) return;

    const weekendDays = new Set(['Cumartesi', 'Pazar']);
    setForm((current) => {
      const rows = normalizeWeeklySchedule({ weeklySchedule: current.weeklySchedule });
      const source = rows.find((row) => row.dayKey === selectedScheduleDay) || rows[0];
      if (!source) return current;

      const nextRows = rows.map((row) => {
        const shouldApply = scope === 'all' ?
           true
          : scope === 'weekday' ?
             !weekendDays.has(row.dayKey)
            : weekendDays.has(row.dayKey);

        if (!shouldApply) return row;
        return {
          ...row,
          opensAt: source.opensAt,
          closesAt: source.closesAt,
          isClosed: source.isClosed,
        };
      });

      return {
        ...current,
        weeklySchedule: nextRows,
      };
    });
  };

  const addSpecialDay = () => {
    setSpecialDayDraft({
      dateMode: 'single',
      startDate: '',
      startTime: DEFAULT_OPENING_TIME,
      endDate: '',
      endTime: '',
      note: '',
    });
    setSpecialDayModalOpen(true);
  };

  const closeSpecialDayModal = () => {
    setSpecialDayModalOpen(false);
    setSpecialDayDraft({
      dateMode: 'single',
      startDate: '',
      startTime: DEFAULT_OPENING_TIME,
      endDate: '',
      endTime: '',
      note: '',
    });
  };

  const saveSpecialDayDraft = () => {
    if (!specialDayDraft.startDate) {
      setToast({ type: 'warning', title: 'Ayarlar', message: 'Başlangıç tarihi zorunludur.' });
      return;
    }
    if (specialDayDraft.dateMode === 'range' && !specialDayDraft.endDate) {
      setToast({ type: 'warning', title: 'Ayarlar', message: 'Tarih aralığı için bitiş tarihi zorunludur.' });
      return;
    }

    setForm((current) => ({
      ...current,
      specialDays: [
        ...normalizeSpecialDays(current.specialDays),
        {
          id: `special-day-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          startDate: specialDayDraft.startDate,
          startTime: specialDayDraft.startTime || DEFAULT_OPENING_TIME,
          endDate: specialDayDraft.dateMode === 'range' ? (specialDayDraft.endDate || '') : '',
          endTime: specialDayDraft.endTime || '',
          date: specialDayDraft.startDate,
          opensAt: specialDayDraft.startTime || DEFAULT_OPENING_TIME,
          closesAt: specialDayDraft.endTime || specialDayDraft.startTime || DEFAULT_CLOSING_TIME,
          isClosed: false,
          note: specialDayDraft.note || '',
        },
      ],
    }));
    closeSpecialDayModal();
  };

  const updateSpecialDay = (id, field, fieldValue) => {
    setForm((current) => ({
      ...current,
      specialDays: (current.specialDays || []).map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, [field]: fieldValue };
        if (field === 'startDate') next.date = fieldValue;
        if (field === 'startTime') next.opensAt = fieldValue;
        if (field === 'endTime') next.closesAt = fieldValue || next.startTime || DEFAULT_CLOSING_TIME;
        return next;
      }),
    }));
  };

  const removeSpecialDay = (id) => {
    setForm((current) => ({
      ...current,
      specialDays: (current.specialDays || []).filter((item) => item.id !== id),
    }));
  };

  const updateLogisticsTariffRow = (id, field, value) => {
    setForm((current) => ({
      ...current,
      logisticsTariffs: normalizeLogisticsTariffs(current.logisticsTariffs)
        .map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    }));
  };

  const persistSettings = async () => {
    try {
      setIsSaving(true);
      const weeklySchedule = normalizeWeeklySchedule({ weeklySchedule: form.weeklySchedule });
      const legacy = deriveLegacyWorkingHours(weeklySchedule);
      const next = await settingsService.update({
        currency: form.currency,
        dateFormat: form.dateFormat,
        weeklySchedule,
        specialDays: normalizeSpecialDays(form.specialDays),
        logisticsTariffs: normalizeLogisticsTariffs(form.logisticsTariffs),
        holidayMode: Boolean(form.holidayMode),
        openingTime: legacy.openingTime,
        closingTime: legacy.closingTime,
        closedDays: legacy.closedDays,
      });
      const mapped = mapSettingsToForm(next);
      setUpdatedAt(next.updatedAt);
      setForm(mapped);
      setSavedForm(mapped);
      setToast({ type: 'success', title: 'Sistem Ayarları', message: 'Ayarlar kaydedildi' });
    } catch (error) {
      const errorMsg = error?.payload?.message || error?.message || 'Ayarlar kaydedilemedi.';
      setToast({ type: 'error', title: 'Sistem Ayarları', message: errorMsg });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAction = async () => {
    if (!isAdmin || isLoading || isSaving || !isDirty) return;
    await persistSettings();
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!isDirty) {
      return;
    }
    void handleSaveAction();
  };

  const persistCustomerRelationGiftCards = async (nextGiftCards, successMessage, onSuccess) => {
    try {
      setIsSaving(true);
      const next = await settingsService.update({
        customerRelations: {
          giftCards: normalizeGiftCards(nextGiftCards),
          campaigns: normalizeCampaigns(form?.customerRelations?.campaigns),
          automationCenter: normalizeAutomationCenter(form?.customerRelations?.automationCenter),
        },
      });
      const mapped = mapSettingsToForm(next);
      setUpdatedAt(next.updatedAt);
      setForm(mapped);
      setSavedForm(mapped);
      if (typeof onSuccess === 'function') onSuccess();
      if (successMessage) {
        setToast({ type: 'success', title: 'Müşteri İlişkileri', message: successMessage });
      }
    } catch (error) {
      setToast({ type: 'error', title: 'Müşteri İlişkileri', message: error.message || 'Hediye kartı güncellenemedi.' });
    } finally {
      setIsSaving(false);
    }
  };

  const persistCustomerRelations = async (nextCustomerRelations, successMessage, errorMessage = 'Müşteri ilişkileri güncellenemedi.', options = {}) => {
    const previousCustomerRelations = form.customerRelations || {};
    setForm((current) => ({
      ...current,
      customerRelations: nextCustomerRelations,
    }));

    try {
      setIsSaving(true);
      const next = await settingsService.update({
        customerRelations: {
          giftCards: normalizeGiftCards(nextCustomerRelations?.giftCards),
          campaigns: normalizeCampaigns(nextCustomerRelations?.campaigns),
          automationCenter: normalizeAutomationCenter(nextCustomerRelations?.automationCenter),
        },
        skipCampaignPriceHistorySync: options.skipCampaignPriceHistorySync === true,
      });
      const mapped = mapSettingsToForm(next);
      setUpdatedAt(next.updatedAt);
      setForm(mapped);
      setSavedForm(mapped);
      invalidateProductCache();
      if (successMessage) {
        setToast({ type: 'success', title: 'Kampanya Yönetimi', message: successMessage });
      }
      return mapped.customerRelations;
    } catch (error) {
      setForm((current) => ({
        ...current,
        customerRelations: previousCustomerRelations,
      }));
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: error?.message || errorMessage });
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setForm(savedForm);
    setGiftCardDraft(createDefaultGiftCardDraft());
    setCampaignDraft(createDefaultCampaignDraft());
    setAutomationRuleDraft(createDefaultAutomationRuleDraft());
  };

  const toggleGiftCardCategory = (categoryId) => {
    if (giftCardDraft.isAllCategoriesSelected) {
      return;
    }

    setGiftCardDraft((current) => ({
      ...current,
      allowedCategoryIds: current.allowedCategoryIds.includes(categoryId) ?
         current.allowedCategoryIds.filter((id) => id !== categoryId)
        : [...current.allowedCategoryIds, categoryId],
    }));
  };

  const toggleAllCategoriesForGiftCard = () => {
    setGiftCardDraft((current) => {
      const nextAllState = !current.isAllCategoriesSelected;
      return {
        ...current,
        isAllCategoriesSelected: nextAllState,
        allowedCategoryIds: nextAllState ? [] : current.allowedCategoryIds,
      };
    });
  };

  const addGiftCard = () => {
    const code = giftCardDraft.code.trim().toUpperCase();
    const name = giftCardDraft.name.trim();
    const value = Number(giftCardDraft.value);
    const usageLimit = Number(giftCardDraft.usageLimit || 1);

    if (!code) {
      setToast({ type: 'error', title: 'Müşteri İlişkileri', message: 'Kart kodu zorunludur.' });
      return;
    }
    if (!name) {
      setToast({ type: 'error', title: 'Müşteri İlişkileri', message: 'Kart adı zorunludur.' });
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setToast({ type: 'error', title: 'Müşteri İlişkileri', message: 'Kart değeri sıfırdan büyük olmalıdır.' });
      return;
    }
    if (!Number.isFinite(usageLimit) || usageLimit < 1) {
      setToast({ type: 'error', title: 'Müşteri İlişkileri', message: 'Kullanım hakkı en az 1 olmalıdır.' });
      return;
    }
    if (!giftCardDraft.isAllCategoriesSelected && giftCardDraft.allowedCategoryIds.length === 0) {
      setToast({ type: 'error', title: 'Müşteri İlişkileri', message: 'En az bir kategori seçin veya tüm kategoriler toggleını açın.' });
      return;
    }

    const exists = (form.customerRelations?.giftCards || []).some((item) => item.code === code);
    if (exists) {
      setToast({ type: 'error', title: 'Müşteri İlişkileri', message: 'Bu kart kodu zaten tanımlı.' });
      return;
    }

    const normalizedUsageLimit = Math.floor(usageLimit);
    const nextGiftCard = {
      id: `gift-${Date.now()}`,
      code,
      name,
      valueType: giftCardDraft.valueType,
      value,
      usageLimit: normalizedUsageLimit,
      maxUsage: normalizedUsageLimit,
      usedCount: 0,
      remainingUsage: normalizedUsageLimit,
      allowedCategoryIds: giftCardDraft.isAllCategoriesSelected ? [] : [...giftCardDraft.allowedCategoryIds],
      rewardMode: giftCardDraft.rewardMode,
      minSpendForReward: Number(giftCardDraft.minSpendForReward || 0),
      loyaltyPointCost: Number(giftCardDraft.loyaltyPointCost || 0),
      expiresAt: String(giftCardDraft.expiresAt || '').trim(),
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    const nextGiftCards = [...(form.customerRelations?.giftCards || []), nextGiftCard];
    void persistCustomerRelationGiftCards(nextGiftCards, 'Hediye kartı eklendi.', () => {
      setGiftCardDraft(createDefaultGiftCardDraft());
    });
  };

  const buildExistingGiftCardCodeSet = () => new Set((form.customerRelations?.giftCards || []).map((item) => normalizeCodeValue(item.code)).filter(Boolean));

  const handleGenerateGiftCardCode = () => {
    const generatedCode = generateRandomCode({
      length: 5,
      excludedCodes: buildExistingGiftCardCodeSet(),
    });

    if (!generatedCode) {
      setToast({ type: 'error', title: 'Müşteri İlişkileri', message: 'Kart kodu üretilemedi. Lütfen tekrar deneyin.' });
      return;
    }

    setGiftCardDraft((current) => ({ ...current, code: generatedCode }));
  };

  const removeGiftCard = (cardId) => {
    const nextGiftCards = (form.customerRelations?.giftCards || []).filter((item) => item.id !== cardId);
    void persistCustomerRelationGiftCards(nextGiftCards, 'Hediye kartı silindi.');
  };

  const assignGiftCardToCustomer = async () => {
    const customerId = String(giftCardAssignmentDraft.customerId || '').trim();
    const cardCode = normalizeCodeValue(giftCardAssignmentDraft.cardCode);
    const selectedCard = (form.customerRelations?.giftCards || []).find((card) => normalizeCodeValue(card?.code) === cardCode);

    if (!cardCode) {
      setToast({ type: 'error', title: 'Hediye Kartı', message: 'Lütfen Önce atanacak hediye kartını seçin.' });
      return;
    }
    if (!customerId) {
      setToast({ type: 'error', title: 'Hediye Kartı', message: 'Lütfen Önce müşteri seçin.' });
      return;
    }
    if (!selectedCard || selectedCard.isActive === false || isGiftCardExpired(selectedCard)) {
      setToast({ type: 'error', title: 'Hediye Kartı', message: 'Seçilen kart aktif değil veya kullanım süresi dolmuş.' });
      return;
    }

    try {
      setGiftCardAssignmentLoading(true);
      await customerAdminService.assignGiftCard(customerId, { code: cardCode });
      await loadCampaignCustomers();
      setGiftCardAssignmentDraft((current) => ({
        ...current,
        cardCode: '',
      }));
      setToast({
        type: 'success',
        title: 'Hediye Kartı',
        message: `${selectedCard.name} kartı ${normalizeCustomerDisplayName(selectedAssignmentCustomer?.name || 'seçilen müşteriye')} atandı.`,
      });
    } catch (error) {
      setToast({ type: 'error', title: 'Hediye Kartı', message: error?.message || 'Hediye kartı atanamadı.' });
    } finally {
      setGiftCardAssignmentLoading(false);
    }
  };

  const giftCards = form.customerRelations?.giftCards || [];
  const campaigns = form.customerRelations?.campaigns || [];
  const automationCenter = normalizeAutomationCenter(form.customerRelations?.automationCenter);
  const automationRules = automationCenter.rules || [];
  const pricingRows = useMemo(() => (
    backendCampaignRows.length ? backendCampaignRows : mapPricingRowsForCampaigns({ sections: pricingSignals })
  ), [backendCampaignRows, pricingSignals]);
  const availableProductMap = useMemo(
    () => new Map(availableProducts.map((product) => [String(product?.id || ''), product])),
    [availableProducts],
  );
  const campaignAnalyticsRows = useMemo(() => {
    return pricingRows.map((row) => {
      const product = availableProductMap.get(String(row?.productId || row?.id || '')) || null;
      const currentPrice = Math.max(0, Number(row?.currentPrice ?? product?.currentPrice ?? product?.salePrice ?? product?.price ?? 0) || 0);
      const cost = Math.max(0, Number(row?.cost ?? product?.cost ?? product?.purchasePrice ?? product?.costPrice ?? 0) || 0);
      const currentMarginPercent = currentPrice > 0
        ? Number((((currentPrice - cost) / currentPrice) * 100).toFixed(1))
        : Number(row?.currentMarginPercent || 0);

      return {
        ...row,
        id: String(row?.id || row?.productId || product?.id || ''),
        productId: String(row?.productId || row?.id || product?.id || ''),
        productName: normalizeCampaignInsightText(String(row?.productName || product?.name || product?.productName || 'Ürün')),
        sku: String(row?.sku || product?.sku || product?.stockCode || '').trim(),
        barcode: String(row?.barcode || product?.barcode || product?.barcodes?.[0] || '').trim(),
        categoryId: String(row?.categoryId || product?.categoryId || product?.category || ''),
        category: normalizeCampaignInsightText(String(row?.category || product?.categoryName || product?.category || '-').trim() || '-'),
        brand: normalizeCampaignInsightText(normalizeCampaignBrandLabel(row?.brand || product?.brand || product?.brandName || '')),
        supplierName: normalizeCampaignInsightText(String(row?.supplierName || product?.supplierName || product?.supplier || '-').trim() || '-'),
        sectionName: normalizeCampaignInsightText(String(row?.sectionName || product?.sectionName || product?.section || product?.shelfName || '-').trim() || '-'),
        stockLevel: Math.max(0, Number(row?.stockLevel ?? row?.currentStock ?? product?.currentStock ?? product?.stockLevel ?? product?.totalStock ?? 0) || 0),
        salesVelocity: Math.max(0, Number(row?.salesVelocity ?? row?.avgDailySales ?? product?.avgDailySales ?? product?.salesVelocity ?? 0) || 0),
        daysToExpiry: row?.daysToExpiry != null ? Number(row.daysToExpiry) : resolveCampaignDaysToExpiry(product),
        currentPrice,
        cost,
        currentMarginPercent,
        suggestedDiscount: Math.max(0, Number(row?.suggestedDiscount || 0) || 0),
        riskLevel: String(row?.riskLevel || 'medium').trim().toLocaleLowerCase('tr-TR') || 'medium',
      };
    });
  }, [availableProductMap, pricingRows]);

  const campaignSuggestions = useMemo(() => {
    const base = Array.isArray(backendCampaignSuggestions) ? backendCampaignSuggestions : [];
    void suggestionRefreshKey;
    return buildCampaignSuggestionPresentation(base).all;
  }, [backendCampaignSuggestions, suggestionRefreshKey]);

  const campaignSuggestionPresentation = useMemo(
    () => buildCampaignSuggestionPresentation(campaignSuggestions),
    [campaignSuggestions]
  );

  const dashboardCampaignSuggestions = campaignSuggestionPresentation.dashboardHighlights;
  const moduleCampaignSuggestions = campaignSuggestionPresentation.byModule[campaignTypeView] || [];
  const visibleCampaignSuggestions = campaignTypeView === 'all'
    ? dashboardCampaignSuggestions
    : moduleCampaignSuggestions;

  useEffect(() => {
    setCampaignSuggestionPage(1);
  }, [visibleCampaignSuggestions.length, campaignTypeView]);

  const campaignSuggestionTotalPages = Math.max(1, Math.ceil(visibleCampaignSuggestions.length / CAMPAIGN_SUGGESTIONS_PAGE_SIZE));
  const safeCampaignSuggestionPage = Math.min(campaignSuggestionPage, campaignSuggestionTotalPages);
  const pagedCampaignSuggestions = useMemo(
    () => visibleCampaignSuggestions.slice(
      (safeCampaignSuggestionPage - 1) * CAMPAIGN_SUGGESTIONS_PAGE_SIZE,
      safeCampaignSuggestionPage * CAMPAIGN_SUGGESTIONS_PAGE_SIZE,
    ),
    [visibleCampaignSuggestions, safeCampaignSuggestionPage],
  );

  const expirySignalRows = useMemo(
    () => campaignAnalyticsRows
      .filter((row) => row?.daysToExpiry != null)
      .map((row) => ({
        ...row,
        riskLevel: getExpiryRiskLevel(row?.daysToExpiry),
      }))
      .sort((left, right) => Number(left?.daysToExpiry || 999) - Number(right?.daysToExpiry || 999)),
    [campaignAnalyticsRows]
  );

  const salesSignalRows = useMemo(
    () => [...campaignAnalyticsRows].sort((left, right) => Number(left?.salesVelocity || 0) - Number(right?.salesVelocity || 0)),
    [campaignAnalyticsRows]
  );

  const campaignSupplierOptions = useMemo(
    () => [...new Set(campaignAnalyticsRows.map((row) => String(row?.supplierName || '').trim()).filter((value) => value && value !== '-'))].sort((a, b) => a.localeCompare(b, 'tr-TR')),
    [campaignAnalyticsRows]
  );
  const campaignSectionOptions = useMemo(
    () => [...new Set(campaignAnalyticsRows.map((row) => String(row?.sectionName || '').trim()).filter((value) => value && value !== '-'))].sort((a, b) => a.localeCompare(b, 'tr-TR')),
    [campaignAnalyticsRows]
  );
  const campaignScenarioOptions = useMemo(() => ({
    'discount-10': { label: '%10 indirim', discountRate: 10, description: 'Daha kontrollü hacim artışı hedefler.' },
    'discount-20': { label: '%20 indirim', discountRate: 20, description: 'SKT ve stok baskısında dengeli hızlanma sağlar.' },
    'discount-30': { label: '%30 indirim', discountRate: 30, description: 'Çok kritik ürünlerde hızlı tüketim etkisi üretir.' },
    'bundle': { label: 'Çoklu alım', discountRate: 16, description: 'Sepet büyütme ile stok eritme arasında dengeli bir seçenek sunar.' },
    'price-up': { label: 'Fiyat artışı testi', discountRate: 0, description: 'Güçlü talep gören ürünlerde marj optimizasyonu odaklıdır.' },
  }), []);

  const expirySuggestions = useMemo(
    () => campaignSuggestionPresentation.byModule.expiry || [],
    [campaignSuggestionPresentation]
  );

  const salesSuggestions = useMemo(
    () => campaignSuggestionPresentation.byModule.sales || [],
    [campaignSuggestionPresentation]
  );

  const campaignSummary = useMemo(() => {
    const now = new Date();
    const activeCampaignItems = campaigns.filter((item) => isCampaignCurrentlyActive(item, now));
    const active = activeCampaignItems.length;
    const planned = campaigns.filter((item) => isCampaignPlanned(item, now)).length;
    const dynamic = campaigns.filter((item) => item.type === 'dynamic').length;
    const categoryBased = campaigns.filter((item) => item.type === 'category').length;
    const urgentSuggestionCount = campaignSuggestions.filter((item) => item.priority === 'critical' || item.priority === 'high').length;
    const expiringSoon = activeCampaignItems.filter((item) => {
      if (item.isIndefinite || !item.endsAt) return false;
      const end = new Date(item.endsAt);
      if (Number.isNaN(end.getTime())) return false;
      const diffDays = Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      return diffDays >= 0 && diffDays <= 7;
    }).length;
    const campaignProductIds = new Set();
    activeCampaignItems.forEach((campaign) => {
      campaignAnalyticsRows.forEach((row) => {
        if (getCampaignProductMatch(campaign, row)) {
          const id = String(row?.productId || row?.id || '').trim();
          if (id) campaignProductIds.add(id);
        }
      });
      (Array.isArray(campaign.targetProductIds) ? campaign.targetProductIds : []).forEach((id) => {
        const productId = String(id || '').trim();
        if (productId) campaignProductIds.add(productId);
      });
    });

    return {
      total: campaigns.length,
      active,
      planned,
      dynamic,
      categoryBased,
      expiringSoon,
      promotedProducts: campaignProductIds.size,
      urgentSuggestionCount,
    };
  }, [campaignAnalyticsRows, campaigns, campaignSuggestions]);

  const filteredCampaigns = useMemo(() => {
    const byType = campaignTypeView === 'all'
      ? campaigns
      : campaigns.filter((item) => isCampaignInModule(item, campaignTypeView));

    const byStatus = campaignStatusView === 'all' ?
       byType
      : byType.filter((item) => {
        if (campaignStatusView === 'active') return isCampaignCurrentlyActive(item);
        if (campaignStatusView === 'planned') return isCampaignPlanned(item);
        if (campaignStatusView === 'inactive') return !isCampaignCurrentlyActive(item) && !isCampaignPlanned(item);
        if (campaignStatusView === 'expiring') {
          if (item.isIndefinite || !item.endsAt) return false;
          const end = new Date(item.endsAt);
          if (Number.isNaN(end.getTime())) return false;
          const diffDays = Math.ceil((end.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
          return diffDays >= 0 && diffDays <= 7;
        }
        return true;
      });

    const needle = String(campaignSearch || '').trim().toLowerCase();
    if (!needle) return byStatus;

    return byStatus.filter((item) => (
      String(item.name || '').toLowerCase().includes(needle)
      || String(item.type || '').toLowerCase().includes(needle)
      || String(item.status || '').toLowerCase().includes(needle)
    ));
  }, [campaigns, campaignTypeView, campaignStatusView, campaignSearch]);

  const moduleCampaignRows = useMemo(() => {
    if (!['general', 'product', 'category', 'brand', 'expiry', 'sales'].includes(campaignTypeView)) {
      return [];
    }

    const byType = campaigns.filter((item) => isCampaignInModule(item, campaignTypeView));
    const needle = String(campaignSearch || '').trim().toLowerCase();
    const searchedRows = needle
      ? byType.filter((item) => (
        String(item.name || '').toLowerCase().includes(needle)
        || String(item.type || '').toLowerCase().includes(needle)
        || String(item.status || '').toLowerCase().includes(needle)
      ))
      : byType;

    return [...searchedRows].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [campaignSearch, campaignTypeView, campaigns]);

  const campaignSimulationDurationDays = useMemo(() => {
    const startsAt = String(campaignDraft.startsAt || '').trim();
    const endsAt = String(campaignDraft.endsAt || '').trim();
    const isIndefinite = Boolean(campaignDraft.isIndefinite) && !FIXED_DATE_CAMPAIGN_TYPES.has(String(campaignDraft.type || '').trim().toLowerCase());
    if (!isIndefinite && startsAt && endsAt) {
      const startDate = new Date(`${startsAt}T00:00:00`);
      const endDate = new Date(`${endsAt}T00:00:00`);
      if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && endDate >= startDate) {
        return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      }
    }
    return 7;
  }, [campaignDraft.endsAt, campaignDraft.isIndefinite, campaignDraft.startsAt, campaignDraft.type]);
  const campaignDraftIsPlanned = useMemo(
    () => isCampaignPlanned({ ...campaignDraft, isActive: campaignDraft.isActive !== false }),
    [campaignDraft],
  );
  const availableBrandLabelMap = useMemo(
    () => new Map(availableBrands.map((brandName) => [normalizeSearchText(brandName), brandName])),
    [availableBrands],
  );
  const selectedCampaignBrands = useMemo(
    () => normalizeCampaignBrandSelections(campaignDraft.targetBrands, availableBrandLabelMap),
    [availableBrandLabelMap, campaignDraft.targetBrands],
  );
  const selectedBrandKeySet = useMemo(
    () => new Set(selectedCampaignBrands.map((brandName) => normalizeSearchText(brandName)).filter(Boolean)),
    [selectedCampaignBrands],
  );
  const brandCampaignSearchNormalized = useMemo(
    () => normalizeSearchText(brandCampaignSearch),
    [brandCampaignSearch],
  );
  const selectableCampaignBrands = useMemo(
    () => availableBrands.filter((brandName) => !selectedBrandKeySet.has(normalizeSearchText(brandName))),
    [availableBrands, selectedBrandKeySet],
  );
  const visibleCampaignBrands = useMemo(() => {
    if (brandCampaignSearchNormalized.length >= 2) {
      return selectableCampaignBrands.filter((brandName) => normalizeSearchText(brandName).includes(brandCampaignSearchNormalized));
    }
    return selectableCampaignBrands.slice(0, BRAND_INITIAL_VISIBLE_LIMIT);
  }, [brandCampaignSearchNormalized, selectableCampaignBrands]);
  const hiddenCampaignBrandCount = useMemo(
    () => Math.max(0, selectableCampaignBrands.length - BRAND_INITIAL_VISIBLE_LIMIT),
    [selectableCampaignBrands],
  );
  const campaignDraftScopeRows = useMemo(() => {
    if (campaignDraft.type === 'product') {
      const selectedProductIds = new Set((campaignDraft.targetProductIds || []).map((id) => String(id || '').trim()).filter(Boolean));
      return campaignAnalyticsRows.filter((row) => selectedProductIds.has(String(row?.productId || row?.id || '').trim()));
    }
    if (campaignDraft.type === 'category') {
      const selectedCategoryIds = new Set((campaignDraft.targetCategoryIds || []).map((id) => String(id || '').trim()).filter(Boolean));
      return campaignAnalyticsRows.filter((row) => selectedCategoryIds.has(String(row?.categoryId || '').trim()));
    }
    if (campaignDraft.type === 'brand') {
      return campaignAnalyticsRows.filter((row) => selectedBrandKeySet.has(normalizeSearchText(row?.brand || '')));
    }
    return campaignAnalyticsRows;
  }, [campaignAnalyticsRows, campaignDraft.targetCategoryIds, campaignDraft.targetProductIds, campaignDraft.type, selectedBrandKeySet]);
  const campaignDraftScopeProductCount = useMemo(() => {
    if (campaignDraft.type === 'general') {
      return Math.max(
        Number(campaignEligibleProductCount || 0) || 0,
        campaignDraftScopeRows.length,
      );
    }
    return campaignDraftScopeRows.length;
  }, [campaignDraft.type, campaignDraftScopeRows.length, campaignEligibleProductCount]);
  const campaignSimulationFallback = useMemo(() => buildCampaignSimulationSnapshot({
    rows: campaignDraftScopeRows,
    discountRate: Number(campaignDraft.discountRate || 0),
    durationDays: campaignSimulationDurationDays,
    scopeProductCount: campaignDraftScopeProductCount,
    scopeLabel: campaignTypeView === 'product'
      ? 'Ürün Bazlı Kampanya'
      : campaignTypeView === 'category'
        ? 'Kategori Bazlı Kampanya'
        : campaignTypeView === 'brand'
          ? 'Marka Bazlı Kampanya'
          : 'Genel Mağaza İndirimi',
    currency: form.currency,
    emptyMessage: campaignDraft.type === 'product'
      ? 'Simülasyon için en az bir Ürün seçin.'
      : campaignDraft.type === 'category'
        ? 'Simülasyon için en az bir kategori seçin.'
        : campaignDraft.type === 'brand'
          ? 'Simülasyon için en az bir marka seçin.'
      : 'Simülasyon için Ürün verisi bulunamadı.',
  }), [campaignDraft.discountRate, campaignDraft.type, campaignDraftScopeProductCount, campaignDraftScopeRows, campaignSimulationDurationDays, campaignTypeView, form.currency]);
  const campaignSimulationRequest = useMemo(() => {
    const requestType = campaignDraft.type || campaignTypeView || 'general';
    return {
      type: requestType,
      discountRate: Number(campaignDraft.discountRate || 0),
      durationDays: campaignSimulationDurationDays,
      startsAt: campaignDraft.startsAt || '',
      endsAt: campaignDraft.endsAt || '',
      isIndefinite: Boolean(campaignDraft.isIndefinite),
      targetProductIds: requestType === 'product' && Array.isArray(campaignDraft.targetProductIds) ? campaignDraft.targetProductIds : [],
      targetCategoryIds: requestType === 'category' && Array.isArray(campaignDraft.targetCategoryIds) ? campaignDraft.targetCategoryIds : [],
      targetBrands: requestType === 'brand' ? selectedCampaignBrands : [],
      scopeLabel: campaignTypeView === 'product'
        ? 'Ürün Bazlı Kampanya'
        : campaignTypeView === 'category'
          ? 'Kategori Bazlı Kampanya'
          : campaignTypeView === 'brand'
            ? 'Marka Bazlı Kampanya'
            : 'Genel Mağaza İndirimi',
      currency: form.currency,
    };
  }, [
    campaignDraft.discountRate,
    campaignDraft.endsAt,
    campaignDraft.isIndefinite,
    campaignDraft.startsAt,
    campaignDraft.targetCategoryIds,
    campaignDraft.targetProductIds,
    campaignDraft.type,
    campaignSimulationDurationDays,
    campaignTypeView,
    form.currency,
    selectedCampaignBrands,
  ]);
  const campaignSimulationRequestKey = useMemo(
    () => JSON.stringify(campaignSimulationRequest),
    [campaignSimulationRequest],
  );

  useEffect(() => {
    if (!isCampaignPage) return;
    let cancelled = false;

    const loadCampaignSimulation = async () => {
      setCampaignSimulationLoading(true);
      setCampaignSimulationError('');
      try {
        const result = await campaignAnalysisService.simulate(campaignSimulationRequest);
        if (cancelled) return;
        setBackendCampaignSimulation(result || null);
      } catch (error) {
        if (cancelled) return;
        setBackendCampaignSimulation(null);
        setCampaignSimulationError(error?.message || 'Simülasyon hesaplanamadı.');
      } finally {
        if (!cancelled) setCampaignSimulationLoading(false);
      }
    };

    loadCampaignSimulation();
    return () => {
      cancelled = true;
    };
  }, [campaignSimulationRequestKey, isCampaignPage]);

  const campaignSimulation = useMemo(() => {
    if (backendCampaignSimulation) {
      return {
        ...backendCampaignSimulation,
        salesIncreasePct: backendCampaignSimulation.salesIncreasePct ?? backendCampaignSimulation.estimatedSalesIncrease,
        revenueChange: backendCampaignSimulation.revenueChange ?? backendCampaignSimulation.estimatedRevenueChange,
        marginImpact: backendCampaignSimulation.marginImpact ?? backendCampaignSimulation.estimatedMarginImpact,
        stockDepletionDays: backendCampaignSimulation.stockDepletionDays ?? backendCampaignSimulation.estimatedStockDepletionDays,
        stockTurnEffect: backendCampaignSimulation.stockTurnEffect ?? backendCampaignSimulation.stockTurnoverImpact,
        riskReductionScore: backendCampaignSimulation.riskReductionScore ?? backendCampaignSimulation.riskReductionImpact,
        isBackendSimulation: true,
        isLoading: campaignSimulationLoading,
        error: campaignSimulationError,
      };
    }

    return {
      ...campaignSimulationFallback,
      isBackendSimulation: false,
      isPreviewFallback: true,
      isLoading: campaignSimulationLoading,
      error: campaignSimulationError,
    };
  }, [backendCampaignSimulation, campaignSimulationError, campaignSimulationFallback, campaignSimulationLoading]);

  const dynamicRulePreview = useMemo(() => previewDynamicRuleImpact({
    rule: {
      salesBelow: campaignDraft.dynamicRule?.salesBelow,
      stockAbove: campaignDraft.dynamicRule?.stockAbove,
      expiryBelow: campaignDraft.dynamicRule?.expiryBelow,
    },
    pricingRows: campaignAnalyticsRows,
  }), [campaignAnalyticsRows, campaignDraft.dynamicRule]);
  const automationPreviewRows = useMemo(() => {
    if (!dynamicRulePreview.affectedProductIds?.length) return [];
    const affectedIds = new Set(dynamicRulePreview.affectedProductIds.map((id) => String(id || '').trim()).filter(Boolean));
    return campaignAnalyticsRows.filter((row) => affectedIds.has(String(row?.productId || row?.id || '').trim()));
  }, [campaignAnalyticsRows, dynamicRulePreview.affectedProductIds]);
  const automationCampaignSimulation = useMemo(() => buildCampaignSimulationSnapshot({
    rows: automationPreviewRows,
    discountRate: Number(campaignDraft.dynamicRule?.discountRate || campaignDraft.discountRate || 12),
    durationDays: Math.max(3, campaignSimulationDurationDays),
    scopeLabel: 'Otomasyon Kampanya Etkisi',
    currency: form.currency,
    emptyMessage: 'Mevcut kural koşullarına uyan Ürün bulunamadı.',
  }), [automationPreviewRows, campaignDraft.discountRate, campaignDraft.dynamicRule?.discountRate, campaignSimulationDurationDays, form.currency]);

  const crossModuleInsights = useMemo(() => mergeCrossModuleIntelligence({
    pricingRows,
    purchaseSuggestions: orderSuggestionSignals,
  }), [pricingRows, orderSuggestionSignals]);

  const campaignEmptyState = useMemo(() => buildCampaignEmptyState({
    campaigns: filteredCampaigns,
    suggestions: campaignSuggestions,
    tab: campaignTypeView,
  }), [filteredCampaigns, campaignSuggestions, campaignTypeView]);

  const campaignHomeSummary = useMemo(() => {
    const cards = form.customerRelations?.giftCards || [];
    const activeCards = cards.filter((card) => card.isActive !== false).length;
    const inactiveCards = Math.max(0, cards.length - activeCards);
    const utilizationRate = cards.length ? Number(((inactiveCards / cards.length) * 100).toFixed(1)) : 0;

    const activeCampaigns = campaigns.filter((item) => isCampaignCurrentlyActive(item));
    const avgDiscount = activeCampaigns.length ?
       Number((activeCampaigns.reduce((acc, item) => acc + Number(item.discountRate || 0), 0) / activeCampaigns.length).toFixed(1))
      : 0;
    const marginImpact = Number((avgDiscount * -0.45).toFixed(1));

    const expiringRows = activeCampaigns
      .filter((item) => item.endsAt && !item.isIndefinite)
      .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime())
      .slice(0, 5);

    return {
      activeCampaignCount: activeCampaigns.length,
      giftCardCount: cards.length,
      activeGiftCardCount: activeCards,
      inactiveGiftCardCount: inactiveCards,
      utilizationRate,
      avgDiscount,
      marginImpact,
      expiringRows,
    };
  }, [campaigns, form.customerRelations?.giftCards]);

  const activeCampaignRows = useMemo(
    () => campaigns
      .filter((item) => isCampaignCurrentlyActive(item))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [campaigns],
  );

  const plannedCampaignRows = useMemo(
    () => campaigns
      .filter((item) => isCampaignPlanned(item))
      .sort((a, b) => new Date(a.startsAt || 0).getTime() - new Date(b.startsAt || 0).getTime()),
    [campaigns],
  );

  const archiveCampaignRows = useMemo(
    () => campaigns
      .filter((item) => !isCampaignCurrentlyActive(item) && !isCampaignPlanned(item))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [campaigns],
  );

  const activeFilteredCampaignRows = useMemo(
    () => filteredCampaigns
      .filter((item) => isCampaignCurrentlyActive(item))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [filteredCampaigns],
  );

  const plannedFilteredCampaignRows = useMemo(
    () => filteredCampaigns
      .filter((item) => isCampaignPlanned(item))
      .sort((a, b) => new Date(a.startsAt || 0).getTime() - new Date(b.startsAt || 0).getTime()),
    [filteredCampaigns],
  );

  const archiveFilteredCampaignRows = useMemo(
    () => filteredCampaigns
      .filter((item) => !isCampaignCurrentlyActive(item) && !isCampaignPlanned(item))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
    [filteredCampaigns],
  );

  const campaignTypeChartData = useMemo(() => {
    const buckets = {
      general: 0,
      product: 0,
      category: 0,
      brand: 0,
      expiry: 0,
      sales: 0,
      dynamic: 0,
    };

    campaigns.forEach((item) => {
      const moduleKey = classifyCampaignModule(item);
      const typeKey = String(item?.type || '').trim().toLowerCase();
      const key = buckets[moduleKey] !== undefined ? moduleKey : typeKey;
      if (buckets[key] !== undefined) {
        buckets[key] += 1;
      } else {
        buckets.general += 1;
      }
    });

    return [
      { name: 'Genel', count: buckets.general },
      { name: 'Ürün', count: buckets.product },
      { name: 'Kategori', count: buckets.category },
      { name: 'Marka', count: buckets.brand },
      { name: 'SKT', count: buckets.expiry },
      { name: 'Satış', count: buckets.sales },
      { name: 'Dinamik', count: buckets.dynamic },
    ];
  }, [campaigns]);

  const campaignStatusChartData = useMemo(() => ([
    { name: 'Yayında', count: campaignSummary.active },
    { name: 'Planlandı', count: campaignSummary.planned },
    { name: 'Yayında Değil', count: Math.max(0, campaignSummary.total - campaignSummary.active - campaignSummary.planned) },
    { name: 'Yakında Bitecek', count: campaignSummary.expiringSoon },
  ]), [campaignSummary]);

  const campaignSuggestionChartData = useMemo(() => {
    const buckets = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    campaignSuggestions.forEach((item) => {
      const priority = String(item?.priority || '').toLowerCase('tr-TR');
      if (priority === 'critical') buckets.critical += 1;
      else if (priority === 'high') buckets.high += 1;
      else if (priority === 'medium') buckets.medium += 1;
      else buckets.low += 1;
    });

    return [
      { name: 'Kritik', count: buckets.critical },
      { name: 'Yüksek', count: buckets.high },
      { name: 'Orta', count: buckets.medium },
      { name: 'Düşük', count: buckets.low },
    ];
  }, [campaignSuggestions]);
  const hasCampaignStatusChartData = campaignStatusChartData.some((item) => Number(item.count || 0) > 0);
  const hasCampaignTypeChartData = campaignTypeChartData.some((item) => Number(item.count || 0) > 0);
  const hasCampaignSuggestionChartData = campaignSuggestionChartData.some((item) => Number(item.count || 0) > 0);

  const isHomeCampaignView = campaignTypeView === 'all';
  const isCampaignBuilderView = ['general', 'product', 'category', 'brand'].includes(campaignTypeView);
  const campaignBuilderMeta = useMemo(() => {
    if (campaignTypeView === 'product') {
      return {
        title: 'Ürün Bazlı Kampanya',
        description: 'Kampanyanın uygulanacağı ürünleri seçin.',
        forcedType: 'product',
        scopeLabel: 'Ürün Seçimi',
        scopeDescription: 'Kampanyanın uygulanacağı ürünleri seçin.',
      };
    }
    if (campaignTypeView === 'category') {
      return {
        title: 'Kategori Bazlı Kampanya',
        description: 'Kampanyanın uygulanacağı kategorileri seçin.',
        forcedType: 'category',
        scopeLabel: 'Kategori Seçimi',
        scopeDescription: 'Kampanyanın uygulanacağı kategorileri seçin.',
      };
    }
    if (campaignTypeView === 'brand') {
      return {
        title: 'Marka Bazlı Kampanya',
        description: 'Kampanyanın uygulanacağı markaları seçin.',
        forcedType: 'brand',
        scopeLabel: 'Marka Seçimi',
        scopeDescription: 'Kampanyanın uygulanacağı markaları seçin.',
      };
    }
    return {
      title: 'Genel Kampanya',
      description: 'Tüm mağaza ürünlerine uygulanacak genel kampanya bilgilerini tanımlayın.',
      forcedType: 'general',
      scopeLabel: '',
      scopeDescription: '',
    };
  }, [campaignTypeView]);

  useEffect(() => {
    if (!isCampaignBuilderView) return;
    setCampaignDraft((current) => (
      current.type === campaignBuilderMeta.forcedType ?
         current
        : { ...current, type: campaignBuilderMeta.forcedType }
    ));
  }, [campaignBuilderMeta.forcedType, isCampaignBuilderView]);

  const saveCampaignDraft = async (campaignId = '') => {
    const name = String(campaignDraft.name || '').trim();
    const type = String(campaignDraft.type || 'general').trim().toLowerCase();
    const discountRate = Number(campaignDraft.discountRate);
    const startsAt = String(campaignDraft.startsAt || '').trim();
    const endsAt = String(campaignDraft.endsAt || '').trim();
    const requiresFixedDateRange = FIXED_DATE_CAMPAIGN_TYPES.has(type);
    const isIndefinite = requiresFixedDateRange ? false : Boolean(campaignDraft.isIndefinite);
    const priority = Math.max(0, Number(campaignDraft.priority || 0) || 0);
    const targetProductIds = type === 'product' ?
       campaignDraft.targetProductIds
      : [];

    if (!name) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Kampanya adı zorunludur.' });
      return;
    }

    if (!['general', 'category', 'product', 'brand', 'dynamic'].includes(type)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Kampanya tipi geçersiz.' });
      return;
    }

    if (!Number.isFinite(discountRate) || discountRate <= 0 || discountRate > 100) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'İndirim oranı 1-100 arasında olmalıdır.' });
      return;
    }

    if (!isIndefinite && (!startsAt || !endsAt)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Başlangıç ve bitiş tarihi zorunludur.' });
      return;
    }

    if (!isIndefinite && new Date(startsAt) > new Date(endsAt)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Bitiş tarihi başlangıçtan önce olamaz.' });
      return;
    }

    if (type === 'category' && (!Array.isArray(campaignDraft.targetCategoryIds) || campaignDraft.targetCategoryIds.length === 0)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Kategori kampanyası için en az bir kategori seçin.' });
      return;
    }
    if (type === 'product' && (!Array.isArray(campaignDraft.targetProductIds) || campaignDraft.targetProductIds.length === 0)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Ürün kampanyası için en az bir Ürün seçin.' });
      return;
    }
    if (type === 'brand' && (!Array.isArray(campaignDraft.targetBrands) || campaignDraft.targetBrands.length === 0)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Marka kampanyası için en az bir marka seçin.' });
      return;
    }

    const previousCustomerRelations = form.customerRelations || {};
    const existingCampaign = campaignId
      ? (previousCustomerRelations.campaigns || []).find((item) => String(item.id || '') === String(campaignId)) || null
      : null;
    const sourceModule = normalizeCampaignModuleKey(
      campaignDraft.sourceModule || existingCampaign?.sourceModule || existingCampaign?.module || '',
      ''
    );
    const internalName = String(campaignDraft.internalName || campaignDraft.recommendationTitle || existingCampaign?.internalName || existingCampaign?.recommendationTitle || '').trim();
    const publicName = resolvePublicCampaignName({
      name: campaignDraft.publicName || name,
      type,
      sourceModule,
    });
    const draftWillBePlanned = isCampaignPlanned({
      startsAt: isIndefinite ? '' : startsAt,
      isActive: campaignDraft.isActive !== false,
      status: campaignDraft.isActive === false ? 'paused' : 'active',
    });
    const nextCampaign = {
      ...(existingCampaign || {}),
      id: existingCampaign?.id || `campaign-${Date.now()}`,
      name: publicName,
      internalName,
      recommendationTitle: String(campaignDraft.recommendationTitle || internalName || '').trim(),
      publicName,
      displayName: publicName,
      type,
      sourceModule,
      module: sourceModule,
      discountRate,
      startsAt: isIndefinite ? '' : startsAt,
      endsAt: isIndefinite ? '' : endsAt,
      isIndefinite,
      priority,
      status: campaignDraft.isActive ? (draftWillBePlanned ? 'scheduled' : 'active') : 'paused',
      targetCategoryIds: type === 'category' ? campaignDraft.targetCategoryIds : [],
      targetBrands: type === 'brand' ? selectedCampaignBrands : [],
      targetBrand: type === 'brand' ? selectedCampaignBrands.join(', ') : String(campaignDraft.targetBrand || '').trim(),
      targetProductIds,
      trigger: type === 'dynamic' ?
         {
          salesSpeed: campaignDraft.triggerSalesSpeed === 'any' ? '' : campaignDraft.triggerSalesSpeed,
          trendDirection: campaignDraft.triggerTrendDirection === 'any' ? '' : campaignDraft.triggerTrendDirection,
          minOverStockRatio: Number(campaignDraft.minOverStockRatio || 1.2),
          salesBelow: Number(campaignDraft.dynamicRule?.salesBelow || 1),
          stockAbove: Number(campaignDraft.dynamicRule?.stockAbove || 40),
          expiryBelow: Number(campaignDraft.dynamicRule?.expiryBelow || 10),
        }
        : {},
      actions: {
        autoApplyDiscount: type === 'dynamic',
        createTask: type === 'dynamic',
        notify: true,
      },
      giftCardRewardEnabled: campaignDraft.giftCardRewardEnabled,
      giftCardRewardCode: campaignDraft.giftCardRewardCode,
      simulation: {
        ...campaignSimulation,
        durationDays: campaignSimulationDurationDays,
      },
      isActive: campaignDraft.isActive,
      createdAt: existingCampaign?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const nextCustomerRelations = {
      ...previousCustomerRelations,
      campaigns: existingCampaign
        ? (previousCustomerRelations.campaigns || []).map((item) => (String(item.id || '') === String(existingCampaign.id || '') ? nextCampaign : item))
        : [...(previousCustomerRelations.campaigns || []), nextCampaign],
    };

    try {
      const response = await settingsService.update({
        customerRelations: nextCustomerRelations,
      }) || { ...form, customerRelations: nextCustomerRelations };
      const mapped = mapSettingsToForm(response);
      setForm(mapped);
      setSavedForm(mapped);
      setUpdatedAt(response.updatedAt || '');
      invalidateProductCache();

      setCampaignDraft(createDefaultCampaignDraft());
      setEditingCampaignId('');
      setSelectedCampaignDetail(null);
      setAutomationHistory((current) => ([
        {
          id: `log-${Date.now()}`,
          type: existingCampaign ? 'campaign_update' : 'campaign_create',
          status: 'success',
          message: existingCampaign ? `${name} kampanyası güncellendi` : `${name} kampanyası oluşturuldu`,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]).slice(0, 80));
      setToast({
        type: 'success',
        title: 'Kampanya Yönetimi',
        message: draftWillBePlanned
          ? `Bu kampanya ileri tarihli olarak planlandı. Kampanya ${formatCampaignDate(startsAt)} tarihinde başlayacak ve o tarihe kadar fiyatlara yansımayacaktır.`
          : (existingCampaign ? 'Kampanya güncellendi.' : 'Kampanya eklendi.'),
      });
    } catch (error) {
      setForm((current) => ({
        ...current,
        customerRelations: previousCustomerRelations,
      }));
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: error?.message || (existingCampaign ? 'Kampanya güncellenemedi.' : 'Kampanya kaydedilemedi.') });
    }
  };

  const addCampaign = async () => {
    await saveCampaignDraft('');
  };

  const applyCampaignTemplate = (templateId) => {
    const template = CAMPAIGN_TEMPLATE_LIBRARY[templateId];
    if (!template) return;
    setCampaignDraft((current) => ({
      ...current,
      ...template.draft,
      type: String(template.draft.type || current.type || 'general'),
    }));
  };

  const createCampaignFromSuggestion = (suggestion) => {
    const nextProductIds = Array.isArray(suggestion.productIds) ? suggestion.productIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
    const productIdSet = new Set(nextProductIds);
    const derivedCategoryIds = availableProducts
      .filter((product) => productIdSet.has(String(product.id || '')))
      .map((product) => String(product.categoryId || product.category || '').trim())
      .filter(Boolean);
    const derivedBrands = availableProducts
      .filter((product) => productIdSet.has(String(product.id || '')))
      .map((product) => normalizeCampaignBrandLabel(product.brand || product.brandName || ''))
      .filter(isValidCampaignBrandLabel);
    const nextCategoryIds = Array.isArray(suggestion.categoryIds) && suggestion.categoryIds.length ? suggestion.categoryIds : derivedCategoryIds;
    const nextBrands = Array.isArray(suggestion.brandNames) && suggestion.brandNames.length ? suggestion.brandNames : derivedBrands;
    const targetView = suggestion.type === 'product' || (suggestion.type === 'dynamic' && nextProductIds.length) ? 'product' : suggestion.type === 'category' ? 'category' : suggestion.type === 'brand' ? 'brand' : 'general';
    const sourceModule = campaignTypeView === 'expiry'
      ? 'expiry'
      : campaignTypeView === 'sales'
        ? 'sales'
        : (String(suggestion?.id || '') === 'near-expiry'
          ? 'expiry'
          : String(suggestion?.id || '') === 'slow-moving'
            ? 'sales'
            : targetView);
    const recommendationTitle = normalizeCampaignInsightText(suggestion.title || '');
    const publicName = resolvePublicCampaignName({
      name: recommendationTitle,
      type: targetView,
      sourceModule,
    });
    setCampaignDraft((current) => ({
      ...current,
      name: publicName,
      publicName,
      displayName: publicName,
      internalName: recommendationTitle,
      recommendationTitle,
      type: targetView === 'product' ? 'product' : targetView === 'category' ? 'category' : targetView === 'brand' ? 'brand' : 'general',
      sourceModule,
      discountRate: String(suggestion.recommendedDiscount || 10),
      priority: suggestion.priority === 'critical' ? 9 : suggestion.priority === 'high' ? 7 : 5,
      targetProductIds: targetView === 'product' ? nextProductIds : [],
      targetCategoryIds: targetView === 'category' ? [...new Set(nextCategoryIds.map((id) => String(id || '').trim()).filter(Boolean))] : current.targetCategoryIds,
      targetBrands: targetView === 'brand' ? normalizeCampaignBrandSelections(nextBrands, availableBrandLabelMap) : current.targetBrands,
    }));
    setCampaignTypeView(targetView);
    setSelectedCampaignSuggestion(null);
  };

  const applyCampaignKpiAction = (key) => {
    if (key === 'expiring') {
      setCampaignStatusView('expiring');
      return;
    }
    if (key === 'planned') {
      setCampaignStatusView('planned');
      return;
    }
    if (key === 'dynamic') {
      setCampaignTypeView('dynamic');
      return;
    }
    if (key === 'urgent') {
      setCampaignTypeView('all');
      setCampaignSuggestionFilter('dynamic');
      return;
    }
    setCampaignStatusView('all');
    setCampaignTypeView('all');
  };

  const toggleCampaignSelection = (campaignId, checked) => {
    setSelectedCampaignIds((current) => {
      const set = new Set(current);
      if (checked) set.add(campaignId);
      else set.delete(campaignId);
      return [...set];
    });
  };

  const toggleAllCampaignSelections = (checked, sourceRows = filteredCampaigns) => {
    if (checked) {
      setSelectedCampaignIds(sourceRows.map((item) => item.id));
      return;
    }
    setSelectedCampaignIds([]);
  };

  const applyBulkCampaignOperation = async (action) => {
    if (!selectedCampaignIds.length) {
      setToast({ type: 'warning', title: 'Kampanya Yönetimi', message: 'Toplu işlem için seçim yapın.' });
      return;
    }

    const nextCustomerRelations = {
      ...(form.customerRelations || {}),
      campaigns: applyBulkCampaignAction({
        campaigns: form.customerRelations?.campaigns || [],
        selectedIds: selectedCampaignIds,
        action,
        payload: {
          discountRate: bulkDiscountRate,
          type: campaignDraft.type,
        },
      }),
    };

    const persisted = await persistCustomerRelations(nextCustomerRelations, 'Toplu işlem kaydedildi.', 'Toplu işlem kaydedilemedi.');
    if (!persisted) return;

    setAutomationHistory((current) => ([
      {
        id: `log-${Date.now()}`,
        type: 'bulk_action',
        status: 'success',
        message: `${selectedCampaignIds.length} kampanyada ${action} uygulandı`,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]).slice(0, 80));

    setToast({ type: 'success', title: 'Kampanya Yönetimi', message: 'Toplu işlem uygulandı.' });
  };

  const removeCampaign = async (campaignId) => {
    await persistCustomerRelations({
      ...(form.customerRelations || {}),
      campaigns: (form.customerRelations?.campaigns || []).filter((item) => item.id !== campaignId),
    }, 'Kampanya silindi.', 'Kampanya silinemedi.');
  };

  const clearPastCampaigns = async () => {
    const currentCampaigns = form.customerRelations?.campaigns || [];
    const removableCampaigns = currentCampaigns.filter((item) => isPastCampaignClutter(item));
    if (!removableCampaigns.length) {
      setToast({ type: 'info', title: 'Kampanya Yönetimi', message: 'Temizlenecek geçmiş kampanya bulunmuyor.' });
      return;
    }

    const removableIds = new Set(removableCampaigns.map((item) => String(item.id || '')));
    const keptCampaigns = currentCampaigns.filter((item) => !removableIds.has(String(item.id || '')));
    const persisted = await persistCustomerRelations({
      ...(form.customerRelations || {}),
      campaigns: keptCampaigns,
    }, `${removableCampaigns.length} geçmiş kampanya temizlendi.`, 'Geçmiş kampanyalar temizlenemedi.', {
      skipCampaignPriceHistorySync: true,
    });

    if (persisted) {
      setSelectedCampaignIds([]);
      setCampaignStatusView('all');
    }
  };

  const toggleCampaignStatus = async (campaignId) => {
    const targetCampaign = (form.customerRelations?.campaigns || []).find((item) => String(item.id || '') === String(campaignId));
    if (!targetCampaign) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Kampanya bulunamadı.' });
      return;
    }

    const wasLiveOrPlanned = isCampaignCurrentlyActive(targetCampaign) || isCampaignPlanned(targetCampaign);
    const nextActive = !wasLiveOrPlanned;
    await persistCustomerRelations({
      ...(form.customerRelations || {}),
      campaigns: (form.customerRelations?.campaigns || []).map((item) => {
        if (String(item.id || '') !== String(campaignId)) return item;
        return {
          ...item,
          isActive: nextActive,
          status: nextActive ? (isCampaignPlanned(item) ? 'scheduled' : 'active') : 'paused',
          archivedAt: nextActive ? null : item.archivedAt || null,
          archiveReason: nextActive ? '' : 'Yönetim tarafından sonlandırıldı',
          updatedAt: new Date().toISOString(),
        };
      }),
    }, nextActive ? 'Kampanya aktife alındı.' : 'Kampanya sonlandırıldı.', 'Kampanya durumu güncellenemedi.');
  };

  const archiveCampaign = async (campaignId) => {
    await persistCustomerRelations({
      ...(form.customerRelations || {}),
      campaigns: (form.customerRelations?.campaigns || []).map((item) => (
        item.id === campaignId
          ? { ...item, isActive: false, status: 'archived', archivedAt: new Date().toISOString(), archiveReason: 'Yönetim tarafından sonlandırıldı' }
          : item
      )),
    }, 'Kampanya arşive taşındı.', 'Kampanya arşive taşınamadı.');
  };

  const editCampaignFromRow = (campaign) => {
    setCampaignDraft((current) => ({
      ...current,
      name: campaign.name || '',
      publicName: campaign.publicName || campaign.displayName || campaign.name || '',
      internalName: campaign.internalName || '',
      recommendationTitle: campaign.recommendationTitle || campaign.internalName || '',
      type: campaign.type || 'general',
      sourceModule: campaign.sourceModule || campaign.module || classifyCampaignModule(campaign),
      discountRate: String(campaign.discountRate || ''),
      startsAt: campaign.startsAt || '',
      endsAt: campaign.endsAt || '',
      isIndefinite: Boolean(campaign.isIndefinite),
      priority: campaign.priority || 0,
      targetCategoryIds: Array.isArray(campaign.targetCategoryIds) ? campaign.targetCategoryIds : [],
      targetProductIds: Array.isArray(campaign.targetProductIds) ? campaign.targetProductIds : [],
      targetBrands: normalizeCampaignBrandSelections(Array.isArray(campaign.targetBrands) ? campaign.targetBrands : [], availableBrandLabelMap),
      isActive: campaign.isActive !== false,
    }));
    setProductCampaignCategoryFilter('');
    setProductCampaignBrandFilter('');
    setBrandCampaignSearch('');
  };

  const openCampaignEditModal = (campaign) => {
    editCampaignFromRow(campaign);
    setEditingCampaignId(String(campaign?.id || ''));
    setSelectedCampaignDetail({ ...campaign, __viewMode: 'edit' });
  };

  const closeCampaignEditModal = () => {
    setEditingCampaignId('');
    setSelectedCampaignDetail(null);
    setCampaignDraft(createDefaultCampaignDraft());
    setProductCampaignCategoryFilter('');
    setProductCampaignBrandFilter('');
    setBrandCampaignSearch('');
  };

  const toggleCampaignCategory = (categoryId) => {
    setCampaignDraft((current) => {
      const nextSet = current.targetCategoryIds.includes(categoryId) ?
         current.targetCategoryIds.filter((id) => id !== categoryId)
        : [...current.targetCategoryIds, categoryId];
      return { ...current, targetCategoryIds: nextSet };
    });
  };

  const toggleCampaignProduct = (productId) => {
    setCampaignDraft((current) => {
      const nextSet = current.targetProductIds.includes(productId) ?
         current.targetProductIds.filter((id) => id !== productId)
        : [...current.targetProductIds, productId];
      return { ...current, targetProductIds: nextSet };
    });
  };

  const toggleCampaignBrand = (brandName) => {
    const normalizedBrand = normalizeCampaignBrandSelections([brandName], availableBrandLabelMap)[0];
    if (!normalizedBrand) return;
    setCampaignDraft((current) => {
      const currentBrands = normalizeCampaignBrandSelections(current.targetBrands, availableBrandLabelMap);
      const currentKeys = new Set(currentBrands.map((value) => normalizeSearchText(value)));
      const brandKey = normalizeSearchText(normalizedBrand);
      const nextSet = currentKeys.has(brandKey)
        ? currentBrands.filter((value) => normalizeSearchText(value) !== brandKey)
        : [...currentBrands, normalizedBrand];
      return { ...current, targetBrands: nextSet };
    });
  };

  const updateAutomationCenter = (patch) => {
    setForm((current) => ({
      ...current,
      customerRelations: {
        ...(current.customerRelations || {}),
        automationCenter: {
          ...normalizeAutomationCenter(current.customerRelations?.automationCenter),
          ...patch,
        },
      },
    }));
  };

  const addAutomationRule = () => {
    const name = String(automationRuleDraft.name || '').trim();
    if (!name) {
      setToast({ type: 'error', title: 'Otomasyon Merkezi', message: 'Kural adı zorunludur.' });
      return;
    }

    const threshold = Number(automationRuleDraft.threshold || 0);
    const nextRule = {
      id: `automation-rule-${Date.now()}`,
      name,
      triggerType: automationRuleDraft.triggerType,
      threshold: Number.isFinite(threshold) ? threshold : 0,
      actionType: automationRuleDraft.actionType,
      waitDays: Number(automationRuleDraft.waitDays || 0) || 0,
      followUpTriggerType: String(automationRuleDraft.followUpTriggerType || 'low_sales_velocity'),
      isActive: automationRuleDraft.isActive,
    };

    setForm((current) => ({
      ...current,
      customerRelations: {
        ...(current.customerRelations || {}),
        automationCenter: {
          ...normalizeAutomationCenter(current.customerRelations?.automationCenter),
          rules: [...normalizeAutomationCenter(current.customerRelations?.automationCenter).rules, nextRule],
        },
      },
    }));

    setAutomationRuleDraft(createDefaultAutomationRuleDraft());
    setAutomationHistory((current) => ([
      {
        id: `log-${Date.now()}`,
        type: 'rule_create',
        status: 'success',
        message: `${name} otomasyon kurali eklendi`,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]).slice(0, 80));
    setToast({ type: 'success', title: 'Otomasyon Merkezi', message: 'Kural eklendi.' });
  };

  const removeAutomationRule = (ruleId) => {
    setForm((current) => ({
      ...current,
      customerRelations: {
        ...(current.customerRelations || {}),
        automationCenter: {
          ...normalizeAutomationCenter(current.customerRelations?.automationCenter),
          rules: normalizeAutomationCenter(current.customerRelations?.automationCenter).rules.filter((item) => item.id !== ruleId),
        },
      },
    }));
  };

  const toggleAutomationRuleStatus = (ruleId) => {
    setForm((current) => ({
      ...current,
      customerRelations: {
        ...(current.customerRelations || {}),
        automationCenter: {
          ...normalizeAutomationCenter(current.customerRelations?.automationCenter),
          rules: normalizeAutomationCenter(current.customerRelations?.automationCenter).rules.map((item) => {
            if (item.id !== ruleId) return item;
            return { ...item, isActive: !item.isActive };
          }),
        },
      },
    }));
  };

  const filteredGiftCards = useMemo(() => giftCards.filter((card) => {
    const nameMatch = !giftCardSearch || String(card.name || '').toLowerCase().includes(giftCardSearch.toLowerCase());
    const amountMatch = !giftCardAmountFilter || Number(card.value || 0) >= Number(giftCardAmountFilter);
    return nameMatch && amountMatch;
  }), [giftCardAmountFilter, giftCardSearch, giftCards]);
  const campaignCustomerGiftCardMap = useMemo(() => {
    const entries = new Map();
    campaignCustomers.forEach((customer) => {
      if (!isRealCampaignCustomerRecord(customer)) return;
      const customerName = resolveCampaignCustomerDisplayName(customer);
      if (!customerName) return;
      const cards = Array.isArray(customer?.giftCards) ? customer.giftCards : [];
      cards.forEach((card) => {
        const code = normalizeCodeValue(card?.code);
        if (!code) return;
        entries.set(code, {
          customerId: String(customer?.id || ''),
          customerName,
          customerNo: String(customer?.customerNo || ''),
        });
      });
    });
    return entries;
  }, [campaignCustomers]);
  const activeCampaignCustomers = useMemo(
    () => campaignCustomers.filter((customer) => customer?.isActive !== false && isRealCampaignCustomerRecord(customer) && resolveCampaignCustomerDisplayName(customer)),
    [campaignCustomers]
  );
  const filteredCampaignCustomers = useMemo(() => {
    const query = String(giftCardAssignmentDraft.customerQuery || '').trim().toLocaleLowerCase('tr-TR');
    if (!query) return activeCampaignCustomers;
    return activeCampaignCustomers.filter((customer) => {
      const name = resolveCampaignCustomerDisplayName(customer).toLocaleLowerCase('tr-TR');
      const phone = String(customer?.phone || '').toLocaleLowerCase('tr-TR');
      const email = String(customer?.email || '').toLocaleLowerCase('tr-TR');
      const customerNo = String(customer?.customerNo || '').toLocaleLowerCase('tr-TR');
      return name.includes(query) || phone.includes(query) || email.includes(query) || customerNo.includes(query);
    });
  }, [activeCampaignCustomers, giftCardAssignmentDraft.customerQuery]);
  const assignableGiftCards = useMemo(
    () => giftCards.filter((card) => card?.isActive !== false && !isGiftCardExpired(card) && !campaignCustomerGiftCardMap.has(normalizeCodeValue(card?.code))),
    [campaignCustomerGiftCardMap, giftCards]
  );
  const selectedAssignmentCustomer = useMemo(
    () => activeCampaignCustomers.find((customer) => String(customer?.id || '') === String(giftCardAssignmentDraft.customerId || '')) || null,
    [activeCampaignCustomers, giftCardAssignmentDraft.customerId]
  );
  const selectedAssignmentCard = useMemo(
    () => giftCards.find((card) => normalizeCodeValue(card?.code) === normalizeCodeValue(giftCardAssignmentDraft.cardCode)) || null,
    [giftCardAssignmentDraft.cardCode, giftCards]
  );
  const assignedGiftCardCount = campaignCustomerGiftCardMap.size;
  const activeGiftCardCount = giftCards.filter((card) => card?.isActive !== false).length;
  const autoSaleEligibleProductCount = useMemo(() => (
    availableProducts.filter((product) => {
      if (!product?.id || product.isActive === false || product.isListed === false) return false;
      const stock = Number(product.currentStock ?? product.stockLevel ?? product.quantity ?? product.shelfQuantity ?? 0);
      const price = Number(product.effectivePrice ?? product.currentPrice ?? product.salePrice ?? product.price ?? 0);
      return stock > 0 && price > 0;
    }).length
  ), [availableProducts]);

  const matchesCampaignRowSearch = (row, query) => {
    const needle = normalizeSearchText(query);
    if (!needle) return true;
    return [
      row?.productName,
      row?.sku,
      row?.barcode,
      row?.category,
      row?.sectionName,
    ].some((value) => normalizeSearchText(value).includes(needle));
  };

  const filteredExpiryRows = useMemo(() => expirySignalRows.filter((row) => {
    const days = Number(row?.daysToExpiry ?? 999);
    const bandMatch =
      expiryDayBandFilter === 'all'
      || (expiryDayBandFilter === 'today-past' && days <= 0)
      || (expiryDayBandFilter === '1-3' && days >= 1 && days <= 3)
      || (expiryDayBandFilter === '4-7' && days >= 4 && days <= 7)
      || (expiryDayBandFilter === '8-14' && days >= 8 && days <= 14)
      || (expiryDayBandFilter === '15+' && days >= 15);
    const riskMatch = expiryRiskFilter === 'all' || String(row?.riskLevel || '').toLowerCase() === expiryRiskFilter;
    const categoryMatch = !expiryCategoryFilter || String(row?.category || '') === expiryCategoryFilter;
    const searchMatch = matchesCampaignRowSearch(row, expirySearch);
    return bandMatch && riskMatch && categoryMatch && searchMatch;
  }), [expiryCategoryFilter, expiryDayBandFilter, expiryRiskFilter, expirySearch, expirySignalRows]);

  const filteredExpirySuggestions = useMemo(() => {
    if (!filteredExpiryRows.length) return [];
    const rowIds = new Set(filteredExpiryRows.map((row) => String(row?.productId || row?.id || '')));
    return expirySuggestions.filter((item) => {
      const priorityMatch = expiryRiskFilter === 'all' || String(item?.priority || '') === expiryRiskFilter;
      const categoryMatch = !expiryCategoryFilter || (Array.isArray(item?.categoryNames) && item.categoryNames.includes(expiryCategoryFilter));
      const rowMatch = Array.isArray(item?.productIds) && item.productIds.some((id) => rowIds.has(String(id)));
      return priorityMatch && categoryMatch && rowMatch;
    });
  }, [expiryCategoryFilter, expiryRiskFilter, expirySuggestions, filteredExpiryRows]);

  const filteredSalesRows = useMemo(() => salesSignalRows.filter((row) => {
    const velocity = Number(row?.salesVelocity || 0);
    const stockLevel = Number(row?.stockLevel || 0);
    const margin = Number(row?.currentMarginPercent || 0);
    const stockTurn = velocity > 0 ? stockLevel / velocity : stockLevel;
    const signalType = getCampaignSignalType(row, 'sales');
    const recommendationType = buildCampaignActionRecommendation(row, 'sales').toLowerCase();
    const velocityMatch =
      salesVelocityFilter === 'all'
      || (salesVelocityFilter === 'none' && velocity <= 0)
      || (salesVelocityFilter === 'slow' && velocity <= 1.2)
      || (salesVelocityFilter === 'balanced' && velocity > 1.2 && velocity <= 3)
      || (salesVelocityFilter === 'fast' && velocity > 3);
    const stockTurnMatch =
      salesStockTurnFilter === 'all'
      || (salesStockTurnFilter === 'critical' && stockTurn >= 25)
      || (salesStockTurnFilter === 'moderate' && stockTurn >= 12 && stockTurn < 25)
      || (salesStockTurnFilter === 'healthy' && stockTurn < 12);
    const categoryMatch = !salesCategoryFilter || String(row?.category || '') === salesCategoryFilter;
    const supplierMatch = !salesSupplierFilter || String(row?.supplierName || '') === salesSupplierFilter;
    const sectionMatch = !salesSectionFilter || String(row?.sectionName || '') === salesSectionFilter;
    const marginMatch =
      salesMarginFilter === 'all'
      || (salesMarginFilter === 'low' && margin < 18)
      || (salesMarginFilter === 'medium' && margin >= 18 && margin < 30)
      || (salesMarginFilter === 'high' && margin >= 30);
    const typeMatch =
      salesProductTypeFilter === 'all'
      || (salesProductTypeFilter === 'fast' && signalType === 'Çok Satıyor')
      || (salesProductTypeFilter === 'slow' && signalType === 'Yavaş Satıyor')
      || (salesProductTypeFilter === 'pressure' && signalType === 'Stok Baskısı')
      || (salesProductTypeFilter === 'margin' && signalType === 'Marj Fırsatı');
    const recommendationMatch =
      salesRecommendationFilter === 'all'
      || (salesRecommendationFilter === 'discount' && recommendationType.includes('indirim'))
      || (salesRecommendationFilter === 'price-up' && recommendationType.includes('fiyat art'))
      || (salesRecommendationFilter === 'bundle' && recommendationType.includes('çoklu alım'))
      || (salesRecommendationFilter === 'hold' && (recommendationType.includes('aksiyon gerekmiyor') || recommendationType.includes('kampanya gerekmez')));
    const searchMatch = matchesCampaignRowSearch(row, salesSearch);
    return velocityMatch && stockTurnMatch && categoryMatch && supplierMatch && sectionMatch && marginMatch && typeMatch && recommendationMatch && searchMatch;
  }), [salesCategoryFilter, salesMarginFilter, salesProductTypeFilter, salesRecommendationFilter, salesSearch, salesSectionFilter, salesSignalRows, salesStockTurnFilter, salesSupplierFilter, salesVelocityFilter]);

  const filteredSalesSuggestions = useMemo(() => {
    if (!filteredSalesRows.length) return [];
    const rowIds = new Set(filteredSalesRows.map((row) => String(row?.productId || row?.id || '')));
    return salesSuggestions.filter((item) => {
      const categoryMatch = !salesCategoryFilter || (Array.isArray(item?.categoryNames) && item.categoryNames.includes(salesCategoryFilter));
      const rowMatch = Array.isArray(item?.productIds) && item.productIds.some((id) => rowIds.has(String(id)));
      return categoryMatch && rowMatch;
    });
  }, [filteredSalesRows, salesCategoryFilter, salesSuggestions]);

  const expiryInsightCards = useMemo(
    () => filteredExpiryRows
      .map((row) => ({
        ...row,
        signalType: getCampaignSignalType(row, 'expiry'),
        summary: buildCampaignSignalSummary(row, 'expiry'),
        recommendation: buildCampaignCompactRecommendation(row, 'expiry'),
        stockCoverageDays: formatCampaignCoverageDays(row?.stockLevel, row?.salesVelocity),
      }))
      .filter((row) => EXPIRY_SIGNAL_TYPES.has(String(row?.signalType || ''))),
    [filteredExpiryRows]
  );
  const salesInsightCards = useMemo(
    () => filteredSalesRows
      .map((row) => ({
        ...row,
        signalType: getCampaignSignalType(row, 'sales'),
        summary: buildCampaignSignalSummary(row, 'sales'),
        recommendation: buildCampaignCompactRecommendation(row, 'sales'),
        stockCoverageDays: formatCampaignCoverageDays(row?.stockLevel, row?.salesVelocity),
      }))
      .filter((row) => SALES_SIGNAL_TYPES.has(String(row?.signalType || ''))),
    [filteredSalesRows]
  );

  const productCampaignSearchResults = useMemo(() => {
    const needle = normalizeSearchText(productCampaignSearch);
    const selected = new Set(campaignDraft.targetProductIds || []);
    if (!needle) return [];

    return availableProducts
      .filter((product) => {
        const id = String(product.id || '');
        if (!id || selected.has(id)) return false;
        return [
          product.name,
          product.productName,
          product.sku,
          product.barcode,
          product.brand,
          product.brandName,
          product.categoryName,
          product.mainCategoryName,
          product.supplierName,
          product.supplierProductName,
        ].some((value) => normalizeSearchText(value).includes(needle));
      })
      .slice(0, 12);
  }, [availableProducts, campaignDraft.targetProductIds, productCampaignSearch]);

  const selectedCampaignProducts = useMemo(() => {
    const productMap = new Map(availableProducts.map((product) => [String(product.id || ''), product]));
    return (campaignDraft.targetProductIds || []).map((id) => {
      const row = productMap.get(String(id));
      return { id: String(id), label: String(row?.name || row?.productName || id), meta: [row?.sku, row?.brand || row?.brandName].filter(Boolean).join(' | ') };
    });
  }, [availableProducts, campaignDraft.targetProductIds]);

  const isGiftCardDraftDirty = useMemo(() => {
    const base = createDefaultGiftCardDraft();
    return JSON.stringify(giftCardDraft) !== JSON.stringify(base);
  }, [giftCardDraft]);

  const isCampaignDraftDirty = useMemo(() => {
    const base = createDefaultCampaignDraft();
    return JSON.stringify(campaignDraft) !== JSON.stringify(base);
  }, [campaignDraft]);

  const isAutomationRuleDraftDirty = useMemo(() => {
    const base = createDefaultAutomationRuleDraft();
    return JSON.stringify(automationRuleDraft) !== JSON.stringify(base);
  }, [automationRuleDraft]);

  const openCustomerRelationsModal = (tab = 'giftCards') => {
    setCustomerRelationsModalTab(tab);
    setGiftCardCloseConfirmOpen(false);
    const generatedCode = generateRandomCode({
      length: 5,
      excludedCodes: buildExistingGiftCardCodeSet(),
    });
    setGiftCardDraft((current) => ({
      ...createDefaultGiftCardDraft(),
      code: generatedCode || current.code,
    }));
    setCampaignDraft(createDefaultCampaignDraft());
    setAutomationRuleDraft(createDefaultAutomationRuleDraft());
    setGiftCardModalOpen(true);
  };

  const closeGiftCardModal = () => {
    setGiftCardCloseConfirmOpen(false);
    setGiftCardDraft(createDefaultGiftCardDraft());
    setCampaignDraft(createDefaultCampaignDraft());
    setAutomationRuleDraft(createDefaultAutomationRuleDraft());
    setGiftCardModalOpen(false);

    if (location.pathname === '/kampanya-yonetimi') {
      navigate('/sistem-ayarlari');
    }
  };

  const requestCloseGiftCardModal = () => {
    if (isGiftCardDraftDirty || isCampaignDraftDirty || isAutomationRuleDraftDirty) {
      setGiftCardCloseConfirmOpen(true);
      return;
    }
    closeGiftCardModal();
  };

  const validatePinChange = (currentPin, nextPin) => {
    const normalized = String(nextPin || '').trim();
    if (!normalized) {
      return 'Yeni PIN boş bırakılamaz.';
    }
    if (!/^\d{4}$/.test(normalized)) {
      return 'PIN 4 haneli ve sadece sayı olmalıdır.';
    }
    if (String(currentPin || '').trim() === normalized) {
      return 'Yeni PIN mevcut PIN ile aynı olamaz.';
    }
    return '';
  };

  const handleDeskPinInput = (deskCode, rawValue) => {
    const value = String(rawValue || '').replace(/\D/g, '').slice(0, 4);
    setNewDeskPins((current) => ({ ...current, [deskCode]: value }));
    setPinErrors((current) => ({ ...current, [deskCode]: '' }));
  };

  const handleUpdateDeskPin = async (deskCode) => {
    const currentPin = deskPins[deskCode] || '';
    const nextPin = newDeskPins[deskCode] || '';
    const validationError = validatePinChange(currentPin, nextPin);

    if (validationError) {
      setPinErrors((current) => ({ ...current, [deskCode]: validationError }));
      setToast({ type: 'error', title: 'Sistem PIN Yönetimi', message: validationError });
      return;
    }

    try {
      setSavingDeskCode(deskCode);
      const response = await settingsService.updateSystemDeskPin(deskCode, nextPin);
      const updatedDeskPins = createDefaultDeskPins(response.deskPins || {});

      setDeskPins(updatedDeskPins);
      setNewDeskPins((current) => ({ ...current, [deskCode]: '' }));
      setPinErrors((current) => ({ ...current, [deskCode]: '' }));
      setUpdatedAt(response.updatedAt || updatedAt);

      const rowLabel = SYSTEM_DESK_ROWS.find((row) => row.code === deskCode)?.label || deskCode;
      setToast({ type: 'success', title: 'Sistem PIN Yönetimi', message: `${rowLabel} güncellendi.` });
    } catch (error) {
      setToast({ type: 'error', title: 'Sistem PIN Yönetimi', message: error.message || 'PIN güncellenemedi.' });
    } finally {
      setSavingDeskCode('');
    }
  };

  const handleUpdateRoleManagementPin = async () => {
    const currentPin = String(roleManagementPin || '').trim();
    const nextPin = String(newRoleManagementPin || '').trim();
    const validationError = validatePinChange(currentPin, nextPin);

    if (validationError) {
      setRoleManagementPinError(validationError);
      setToast({ type: 'error', title: 'Sistem PIN Yönetimi', message: validationError });
      return;
    }

    try {
      setSavingRoleManagementPin(true);
      const response = await settingsService.update({ roleManagementPin: nextPin });
      const updatedPin = String(response?.roleManagementPin || nextPin).slice(0, 4);
      setRoleManagementPin(updatedPin);
      setNewRoleManagementPin('');
      setRoleManagementPinError('');
      setUpdatedAt(response?.updatedAt || updatedAt);
      setToast({ type: 'success', title: 'Sistem PIN Yönetimi', message: 'Personel Yönetimi PIN güncellendi.' });
    } catch (error) {
      setToast({ type: 'error', title: 'Sistem PIN Yönetimi', message: error.message || 'PIN güncellenemedi.' });
    } finally {
      setSavingRoleManagementPin(false);
    }
  };

  const handleUpdateSystemManagementPin = async () => {
    const currentPin = String(systemManagementPin || '').trim();
    const nextPin = String(newSystemManagementPin || '').trim();
    const validationError = validatePinChange(currentPin, nextPin);

    if (validationError) {
      setSystemManagementPinError(validationError);
      setToast({ type: 'error', title: 'Sistem PIN Yönetimi', message: validationError });
      return;
    }

    try {
      setSavingSystemManagementPin(true);
      const response = await settingsService.update({ posPin: nextPin });
      const updatedPin = String(response?.posPin || nextPin).slice(0, 4);
      setSystemManagementPin(updatedPin);
      setNewSystemManagementPin('');
      setSystemManagementPinError('');
      setUpdatedAt(response?.updatedAt || updatedAt);
      setToast({ type: 'success', title: 'Sistem PIN Yönetimi', message: 'Sistem PIN Yönetimi PIN güncellendi.' });
    } catch (error) {
      setToast({ type: 'error', title: 'Sistem PIN Yönetimi', message: error.message || 'PIN güncellenemedi.' });
    } finally {
      setSavingSystemManagementPin(false);
    }
  };

  const getCampaignTablePage = (key) => Math.max(1, Number(campaignTablePages[key] || 1));

  const setCampaignTablePage = (key, page) => {
    setCampaignTablePages((current) => ({ ...current, [key]: Math.max(1, Number(page) || 1) }));
  };

  const getCampaignInsightPage = (key) => Math.max(1, Number(campaignInsightPages[key] || 1));

  const setCampaignInsightPage = (key, page) => {
    setCampaignInsightPages((current) => ({ ...current, [key]: Math.max(1, Number(page) || 1) }));
  };

  const getCampaignInsightPageSize = (key) => (
    key === 'expiry-signals'
      ? CAMPAIGN_SIGNAL_TABLE_PAGE_SIZE
      : CAMPAIGN_INSIGHT_PAGE_SIZE
  );

  const paginateCampaignInsightRows = (rows, key) => {
    const total = Array.isArray(rows) ? rows.length : 0;
    const pageSize = getCampaignInsightPageSize(key);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(getCampaignInsightPage(key), totalPages);
    const pageRows = total
      ? rows.slice((page - 1) * pageSize, page * pageSize)
      : [];

    return { total, totalPages, page, pageRows };
  };

  const handleCampaignSuggestionsRefresh = () => {
    if (campaignSuggestionRefreshing) return;
    setCampaignSuggestionRefreshing(true);
    setSuggestionRefreshKey((current) => current + 1);
    setCampaignSuggestionRefreshedAt(new Date());
    window.setTimeout(() => setCampaignSuggestionRefreshing(false), 320);
  };

  const renderCampaignPagination = (key, total) => {
    const totalPages = Math.max(1, Math.ceil(total / CAMPAIGN_TABLE_PAGE_SIZE));
    const page = Math.min(getCampaignTablePage(key), totalPages);
    const start = total ? ((page - 1) * CAMPAIGN_TABLE_PAGE_SIZE) + 1 : 0;
    const end = total ? Math.min(page * CAMPAIGN_TABLE_PAGE_SIZE, total) : 0;
    if (!total) return null;

    return (
      <div className="campaign-table-pagination">
        <span>{start}-{end} / {formatNumber(total)} kayıt</span>
        <div className="campaign-table-pagination-actions">
          <button type="button" className="ghost-button" disabled={page === 1 || totalPages === 1} onClick={() => setCampaignTablePage(key, page - 1)}>Önceki</button>
          <span className="campaign-table-pagination-page">Sayfa {page} / {totalPages}</span>
          <button type="button" className="primary-button" disabled={page === totalPages || totalPages === 1} onClick={() => setCampaignTablePage(key, page + 1)}>Sonraki</button>
        </div>
      </div>
    );
  };

  const renderCampaignInsightPagination = (key, total) => {
    const pageSize = getCampaignInsightPageSize(key);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(getCampaignInsightPage(key), totalPages);
    const start = total ? ((page - 1) * pageSize) + 1 : 0;
    const end = total ? Math.min(page * pageSize, total) : 0;
    if (!total || totalPages <= 1) return null;

    return (
      <div className="campaign-suggestions-pagination">
        <span>{start}-{end} / {formatNumber(total)} kayıt</span>
        <div className="campaign-suggestions-pagination-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={page === 1}
            onClick={() => setCampaignInsightPage(key, page - 1)}
          >
            Önceki
          </button>
          <span className="campaign-table-pagination-page">Sayfa {page} / {totalPages}</span>
          <button
            type="button"
            className="primary-button"
            disabled={page === totalPages}
            onClick={() => setCampaignInsightPage(key, page + 1)}
          >
            Sonraki
          </button>
        </div>
      </div>
    );
  };

  const pagedExpirySuggestions = useMemo(
    () => paginateCampaignInsightRows(filteredExpirySuggestions, 'expiry-suggestions'),
    [filteredExpirySuggestions, campaignInsightPages]
  );
  const pagedExpirySignals = useMemo(
    () => paginateCampaignInsightRows(expiryInsightCards, 'expiry-signals'),
    [campaignInsightPages, expiryInsightCards]
  );
  const pagedSalesSuggestions = useMemo(
    () => paginateCampaignInsightRows(filteredSalesSuggestions, 'sales-suggestions'),
    [campaignInsightPages, filteredSalesSuggestions]
  );
  const pagedSalesSignals = useMemo(
    () => paginateCampaignInsightRows(salesInsightCards, 'sales-signals'),
    [campaignInsightPages, salesInsightCards]
  );

  const getCampaignExpiryDisplayMeta = (daysToExpiry) => {
    const days = Number(daysToExpiry);
    if (!Number.isFinite(days)) return { label: 'Belirsiz', toneClass: 'is-neutral' };
    if (days < 0) return { label: 'SKT geçmiş', toneClass: 'is-danger' };
    if (days === 0) return { label: 'Bugün', toneClass: 'is-danger' };
    if (days <= 3) return { label: `${formatNumber(days)} gün`, toneClass: 'is-warning' };
    return { label: `${formatNumber(days)} gün`, toneClass: 'is-neutral' };
  };

  const formatCampaignInsightValue = (value, fallback = 'Tahmin için veri yetersiz') => {
    const text = normalizeCampaignText(String(value || '')).trim();
    if (!text || text === '-') return fallback;
    if (/sat[ıi][şs]\s+verisi\s+yok/i.test(text)) return 'Yeterli satış verisi yok';
    return text;
  };

  const renderCampaignAnalysisHeader = ({
    icon: HeaderIcon,
    iconClassName,
    title,
    description,
    className = '',
  }) => (
    <div className={`campaign-dashboard-header campaign-analysis-header ${className}`.trim()}>
      <div className="campaign-analysis-header-main">
        <div className={`mod-card-icon ${iconClassName}`}><HeaderIcon size={18} /></div>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="campaign-analysis-header-actions">
        <span className="campaign-analysis-refresh-text">Son yenileme: {formatCampaignRefreshDateTime(campaignSuggestionRefreshedAt)}</span>
        <button
          type="button"
          className="campaign-refresh-icon-button"
          onClick={handleCampaignSuggestionsRefresh}
          disabled={campaignSuggestionRefreshing}
          title="Yenile"
          aria-label="Yenile"
        >
          <RefreshCw size={14} className={campaignSuggestionRefreshing ? 'is-spinning' : ''} />
        </button>
      </div>
    </div>
  );

  const renderCampaignModuleHeroHeader = ({
    icon: HeaderIcon,
    iconClassName,
    title,
    description,
  }) => (
    <div className="campaign-module-hero-header">
      <div className="campaign-analysis-header-main">
        <div className={`mod-card-icon ${iconClassName}`}><HeaderIcon size={18} /></div>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
    </div>
  );

  const renderCampaignKpiCards = (items, {
    showHeader = true,
    title = 'Kampanya Bilgileri',
    description = 'Seçili filtrelere göre kritik kampanya göstergelerini tek satırda okuyun.',
    className = '',
    gridClassName = '',
    itemClassName = '',
  } = {}) => (
    <section className={`campaign-dashboard-card campaign-summary-section ${className}`.trim()} aria-label="Kampanya özet göstergeleri">
      {showHeader ? (
        <div className="campaign-insight-panel-head campaign-insight-panel-head--stacked">
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
      ) : null}
      <div className={`campaign-dashboard-grid campaign-dashboard-summary-grid campaign-module-summary-grid ${gridClassName}`.trim()}>
        {items.map((item) => {
          const SummaryIcon = item.icon;

          return (
            <article key={item.label} className={`campaign-module-summary-card ${itemClassName}`.trim()}>
              {SummaryIcon ? (
                <span className={`campaign-module-summary-icon ${item.iconClassName || 'mod-icon-indigo'}`} aria-hidden="true">
                  <SummaryIcon size={16} />
                </span>
              ) : null}
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.description}</small>
            </article>
          );
        })}
      </div>
    </section>
  );

  const renderCampaignExplainerCards = (items) => (
    <section className="campaign-dashboard-card campaign-explainer-section" aria-label="Kampanya bilgi notları">
      <div className="campaign-dashboard-grid campaign-dashboard-insight-grid campaign-metric-explainer-grid campaign-metric-explainer-grid--insight">
        {items.map(({ icon: InsightIcon, title, description }) => (
          <article key={title} className="campaign-metric-explainer-card campaign-metric-explainer-card--soft">
            <span className="campaign-metric-explainer-icon"><InsightIcon size={15} /></span>
            <div>
              <strong>{title}</strong>
              <p>{description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  const renderCampaignFilterPanel = ({
    filters,
    search,
    onSearchChange,
    searchPlaceholder = 'Ürün adı, SKU, barkod',
    onReset,
    description = 'Karar alanını daraltmak için filtreleri birlikte kullanın.',
    searchFirst = false,
    showRefreshAction = true,
    className = '',
    groupClassName = '',
  }) => (
    <section className={`campaign-dashboard-card campaign-filter-toolbar campaign-module-filterbar campaign-module-filterbar--wide campaign-module-filterbar--insight campaign-filter-panel ${className}`.trim()}>
      <div className="campaign-filter-panel-head">
        <h4>Filtreler</h4>
        {description ? <p>{description}</p> : null}
      </div>
      <div className={`campaign-module-filter-group ${filters.length > 4 ? 'campaign-module-filter-group--sales' : ''} ${groupClassName}`.trim()}>
        {searchFirst && onSearchChange ? (
          <label className="field-group campaign-control-field campaign-control-field--search">
            <span>Arama</span>
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
        ) : null}
        {filters.map((filter) => (
          <label key={filter.label} className="field-group campaign-control-field">
            <span>{filter.label}</span>
            <select value={filter.value} onChange={(event) => filter.onChange(event.target.value)}>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>{normalizeCampaignInsightText(option.label)}</option>
              ))}
            </select>
          </label>
        ))}
        {!searchFirst && onSearchChange ? (
          <label className="field-group campaign-control-field campaign-control-field--search">
            <span>Arama</span>
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </label>
        ) : null}
      </div>
      <div className="campaign-module-filter-actions">
        {showRefreshAction ? (
          <button type="button" className="ghost-button" onClick={handleCampaignSuggestionsRefresh} disabled={campaignSuggestionRefreshing}>
            <RefreshCw size={14} className={campaignSuggestionRefreshing ? 'is-spinning' : ''} />
            <span>{campaignSuggestionRefreshing ? 'Yenileniyor...' : 'Önerileri Yenile'}</span>
          </button>
        ) : null}
        <button type="button" className="outline-button" onClick={onReset}>Filtreleri Temizle</button>
      </div>
    </section>
  );

  const renderCampaignScenarioSection = ({
    title,
    description,
    scenarios,
    selectedKey,
    onSelect,
    className = '',
    showSelectedBadge = false,
  }) => (
    <section className={`campaign-dashboard-card campaign-scenario-section ${className}`.trim()}>
      <div className="campaign-insight-panel-head campaign-insight-panel-head--stacked">
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
      <div className="campaign-dashboard-grid campaign-scenario-grid campaign-scenario-strip campaign-scenario-strip--insight">
        {scenarios.map(({ key, icon: ScenarioIcon }) => (
          <button
            key={key}
            type="button"
            className={`campaign-scenario-chip ${selectedKey === key ? 'is-active' : ''}`}
            onClick={() => onSelect(key)}
          >
            <span className="campaign-scenario-chip-icon"><ScenarioIcon size={15} /></span>
            {showSelectedBadge && selectedKey === key ? <span className="campaign-scenario-selected-badge">Seçili</span> : null}
            <strong>{normalizeCampaignInsightText(campaignScenarioOptions[key]?.label || '')}</strong>
            <span>{normalizeCampaignInsightText(campaignScenarioOptions[key]?.description || '')}</span>
          </button>
        ))}
      </div>
    </section>
  );

  const renderCampaignActionCandidatesTable = ({
    title,
    description,
    icon: SectionIcon = Megaphone,
    total,
    rows,
    paginationKey,
    columns,
    emptyTitle,
    emptyDescription,
  }) => (
    <section className="campaign-table-card campaign-insight-standard-section">
      <div className="campaign-table-card-head">
        <div className="campaign-table-card-head-main">
          <span className="campaign-table-card-icon" aria-hidden="true"><SectionIcon size={16} /></span>
          <div>
            <h4>{title}</h4>
            <p>{description}</p>
          </div>
        </div>
        <span>{formatNumber(total)} kayıt</span>
      </div>
      {total ? (
        <div className="table-wrapper campaign-insight-table-wrap">
          <table className="data-table campaign-active-table campaign-standard-table campaign-insight-table campaign-insight-suggestion-table">
            <thead><tr>{columns.map((column) => <th key={column.key} className={column.className || ''}>{column.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((column) => <td key={column.key} className={column.className || ''}>{column.render(row)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="campaign-empty-state-box campaign-empty-state-box--compact" role="status">
          <strong>{emptyTitle}</strong>
          <span>{emptyDescription}</span>
        </div>
      )}
      {renderCampaignInsightPagination(paginationKey, total)}
    </section>
  );

  const renderCampaignProductCandidatesTable = ({
    title,
    description,
    icon: SectionIcon = Info,
    total,
    rows,
    mode,
    paginationKey,
    emptyTitle,
    emptyDescription,
  }) => (
    <section className="campaign-table-card campaign-insight-standard-section">
      <div className="campaign-table-card-head">
        <div className="campaign-table-card-head-main">
          <span className="campaign-table-card-icon" aria-hidden="true"><SectionIcon size={16} /></span>
          <div>
            <h4>{title}</h4>
            <p>{description}</p>
          </div>
        </div>
        <span>{formatNumber(total)} kayıt</span>
      </div>
      {total ? (
        <div className="table-wrapper campaign-insight-table-wrap">
          <table className={`data-table campaign-active-table campaign-standard-table campaign-insight-table campaign-insight-signal-table campaign-insight-signal-table--${mode}`}>
            <thead>
              <tr>
                <th>Ürün</th>
                {mode === 'expiry' ? <th>Kategori / Reyon</th> : null}
                <th>{mode === 'expiry' ? 'SKT’ye Kalan' : 'Satış Durumu'}</th>
                <th>Günlük Satış</th>
                <th>Stok</th>
                <th>Tahmini Stok Tükenme</th>
                <th>Brüt Marj</th>
                <th>Sistem Önerisi</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const detailSuggestion = {
                  id: `sales-inline-${row.id}`,
                  title: `${normalizeCampaignInsightText(row.productName)} için aksiyon önerisi`,
                  reason: normalizeCampaignInsightText(row.summary),
                  affectedProductCount: 1,
                  recommendedDiscount: Math.max(8, Number(row?.suggestedDiscount || 12)),
                  type: 'product',
                  productIds: [row.productId || row.id],
                  priority: row.riskLevel || 'medium',
                  impactSummary: normalizeCampaignInsightText(row.recommendation),
                  riskSummary: 'Aksiyon öncesi marj ve stok yeterliliği tekrar kontrol edilmelidir.',
                };
                const inlineExpirySuggestion = {
                  id: `expiry-inline-${row.id}`,
                  title: `${normalizeCampaignInsightText(row.productName)} için Hızlı İndirim`,
                  reason: normalizeCampaignInsightText(row.summary),
                  affectedProductCount: 1,
                  recommendedDiscount: Math.max(10, Number(row?.suggestedDiscount || 20)),
                  type: 'product',
                  productIds: [row.productId || row.id],
                  priority: row.riskLevel || 'medium',
                  impactSummary: normalizeCampaignInsightText(row.recommendation),
                  riskSummary: 'SKT, stok ve marj etkisi kampanya taslağı oluşturulmadan önce birlikte kontrol edilmelidir.',
                  signalBullets: [
                    'Satış hızı düşük ve stok bekleme riski yüksek ürünler seçildi.',
                    'SKT, stok ve marj sinyalleri birlikte değerlendirildi.',
                    'Önerilen indirim oranı kampanya taslağına başlangıç değeri olarak aktarılır.',
                  ],
                };
                const actionSuggestion = mode === 'expiry' ? inlineExpirySuggestion : detailSuggestion;
                const expiryBadge = mode === 'expiry' ? getExpiryStatusBadgeMeta(row.daysToExpiry) : null;
                return (
                  <tr key={row.id}>
                    <td className="campaign-insight-product-cell">
                      <strong>{normalizeCampaignInsightText(row.productName || 'Ürün')}</strong>
                      {mode === 'sales' ? <span>{normalizeCampaignInsightText(row.summary || 'Satış ve stok durumu takip ediliyor.')}</span> : null}
                    </td>
                    {mode === 'expiry' ? (
                      <td className="campaign-insight-meta-cell">{formatCampaignInsightMetaLine(row.category || 'Kategori yok', row.sectionName && row.sectionName !== '-' ? row.sectionName : '')}</td>
                    ) : null}
                    <td>
                      <span className={`campaign-signal-pill ${mode === 'expiry' ? (expiryBadge?.toneClass || 'is-neutral') : getCampaignToneClass(row.riskLevel)}`}>
                        {mode === 'expiry' ? normalizeCampaignInsightText(expiryBadge?.label || 'Belirsiz') : normalizeCampaignInsightText(row.signalType)}
                      </span>
                    </td>
                    <td className="campaign-insight-metric-cell">{formatCampaignDailySales(row.salesVelocity)}</td>
                    <td className="campaign-insight-metric-cell">{formatNumber(row.stockLevel)} adet</td>
                    <td className="campaign-insight-metric-cell">{formatCampaignInsightValue(row.stockCoverageDays)}</td>
                    <td className="campaign-insight-metric-cell">{formatCampaignMarginPercent(row)}</td>
                    <td><span className={`campaign-action-pill ${getCampaignActionTone(row.recommendation)}`}>{normalizeCampaignInsightText(row.recommendation)}</span></td>
                    <td className="table-cell-actions">
                      <div className="table-actions campaign-insight-row-actions">
                        <button type="button" className="ghost-button" onClick={() => setSelectedCampaignSuggestion(actionSuggestion)}>Detay analizi</button>
                        <button type="button" className="primary-button" onClick={() => createCampaignFromSuggestion(actionSuggestion)}>{mode === 'expiry' ? 'Hızlı indirim oluştur' : 'Kampanya Oluştur'}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="campaign-empty-state-box campaign-empty-state-box--compact" role="status">
          <strong>{normalizeCampaignInsightText(emptyTitle)}</strong>
          <span>{normalizeCampaignInsightText(emptyDescription)}</span>
        </div>
      )}
      {renderCampaignInsightPagination(paginationKey, total)}
    </section>
  );

  const renderCampaignSimulationSection = (simulation, {
    title = 'Etki Simülasyonu',
    description = 'İndirim ve kampanya kapsamına göre tahmini etkiler hesaplanır.',
  } = {}) => (
    <article className="campaign-dashboard-card campaign-simulation-section campaign-form-group campaign-form-group--simulation-compact">
      {simulation?.isEmpty ? (
        <>
          <div className="campaign-form-group-head campaign-form-group-head--simulation">
            <span className="campaign-inline-kicker campaign-inline-kicker--amber">
              <Sparkles size={13} />
              Simülasyon
            </span>
            <h4>{title} <span className="sr-only">Impact Simulation</span></h4>
            <p>{description}</p>
          </div>
          <div className="campaign-product-search-empty campaign-product-search-empty--insight" role="status" style={{ minHeight: 'unset', textAlign: 'left' }}>
            <span className="campaign-inline-kicker campaign-inline-kicker--slate">
              <Info size={13} />
              Veri durumu
            </span>
            <strong>{simulation?.emptyMessage || 'Simülasyon için yeterli veri bulunamadı.'}</strong>
          </div>
        </>
      ) : (
        (() => {
          const hasEnoughSimulationData = simulation?.hasEnoughSalesData !== false && simulation?.dataQuality?.status !== 'insufficient_data';
          const hasStockDepletion = hasEnoughSimulationData && Number.isFinite(Number(simulation?.stockDepletionDays)) && Number(simulation?.stockDepletionDays) > 0;
          const formatSimulationPercent = (value) => {
            if (!hasEnoughSimulationData || value === null || value === undefined) return 'Yeterli satış verisi yok';
            const numeric = Number(value);
            return Number.isFinite(numeric) ? `%${formatNumber(numeric)}` : 'Hesaplanamadı';
          };
          const formatSimulationMoney = (value) => {
            if (!hasEnoughSimulationData || value === null || value === undefined) return 'Yeterli satış verisi yok';
            const numeric = Number(value);
            return Number.isFinite(numeric) ? `${formatNumber(numeric)} ${form.currency}` : 'Hesaplanamadı';
          };
          return (
        <>
          <div className="campaign-form-group-head campaign-form-group-head--simulation">
            <div className="campaign-simulation-copy">
              <span className="campaign-inline-kicker campaign-inline-kicker--amber">
                <Sparkles size={13} />
                Simülasyon
              </span>
              <h4>{title} <span className="sr-only">Impact Simulation</span></h4>
              <p>{description}</p>
            </div>
            <div className="campaign-simulation-risk">
              <span className={`campaign-signal-pill ${getCampaignToneClass(simulation?.riskLevel)}`}>
                {simulation?.riskLevel || 'Risk seviyesi yok'}
              </span>
            </div>
          </div>
          <div className="campaign-preview-stats campaign-preview-stats--compact">
            <div><span>Tahmini satış artışı</span><strong>{formatSimulationPercent(simulation?.salesIncreasePct)}</strong></div>
            <div><span>Tahmini ciro etkisi</span><strong>{formatSimulationMoney(simulation?.revenueChange)}</strong></div>
            <div><span>Tahmini marj etkisi</span><strong>{formatSimulationPercent(simulation?.marginImpact)}</strong></div>
            <div><span>Stok devir etkisi</span><strong>{formatSimulationPercent(simulation?.stockTurnEffect)}</strong></div>
            <div><span>Risk seviyesi</span><strong>{simulation?.riskLevel || '-'}</strong></div>
            <div><span>Ortalama stok tükenme</span><strong>{hasStockDepletion ? `${formatNumber(simulation?.stockDepletionDays)} gün` : 'Yeterli satış verisi yok'}</strong></div>
          </div>
          <div className="campaign-form-tip campaign-simulation-note" style={{ marginTop: '12px' }}>
            <strong>{simulation?.recommendation || 'Öneri üretilemedi.'}</strong>
                {simulation?.metricsSummary ? <span>{normalizeCampaignInsightText(simulation.metricsSummary)}</span> : null}
          </div>
        </>
          );
        })()
      )}
    </article>
  );

  const renderCampaignSimulationPanel = (simulation, {
    title = 'Etki Simülasyonu',
    description = 'İndirim ve kampanya kapsamına göre tahmini etkiler hesaplanır.',
    label = 'Simülasyon',
    metricTailLabel = 'Ortalama stok tükenme',
    selectedScenarioLabel = '',
    advisoryText = '',
    emptyMessage = 'Filtrelere uygun veri bulunamadı.',
    className = '',
  } = {}) => (
    <article className={`campaign-dashboard-card campaign-simulation-section campaign-form-group campaign-form-group--simulation-compact ${className}`.trim()}>
      {simulation?.isEmpty ? (
        <>
          <div className="campaign-form-group-head campaign-form-group-head--simulation">
            <span className="campaign-inline-kicker campaign-inline-kicker--amber">
              <Sparkles size={13} />
              {label}
            </span>
            <h4>{title}</h4>
            <p>{description}</p>
          </div>
          <div className="campaign-empty-state-box campaign-empty-state-box--compact campaign-empty-state-box--simulation" role="status">
            <strong>{emptyMessage}</strong>
            <span>Filtre aralığını genişleterek daha fazla ürün sinyali görebilirsiniz.</span>
          </div>
        </>
      ) : (
        (() => {
          const hasStockDepletion = Number.isFinite(Number(simulation?.stockDepletionDays)) && Number(simulation?.stockDepletionDays) > 0;
          const rowPreviewCount = Array.isArray(simulation?.rows) ? simulation.rows.length : 0;
          const candidateCount = Math.max(
            Number(simulation?.analysisCandidateCount || 0) || 0,
            Number(simulation?.previewProductCount || 0) || 0,
            rowPreviewCount,
          );
          const scopeCount = Math.max(
            Number(simulation?.eligibleProductCount || 0) || 0,
            Number(simulation?.affectedProductCount || 0) || 0,
            Number(simulation?.productCount || 0) || 0,
          );
          const affectedCount = scopeCount > 0 ? scopeCount : candidateCount;
          const hasSeparateCandidateCount = candidateCount > 0 && affectedCount > candidateCount;
          const hasEnoughSalesData = simulation?.hasEnoughSalesData !== false
            && simulation?.dataQuality?.status !== 'insufficient_data'
            && (Number(simulation?.avgDailySales || 0) > 0 || hasStockDepletion || simulation?.isBackendSimulation);
          const formatSimulationPercent = (value) => {
            const numeric = Number(value);
            if (!hasEnoughSalesData || value === null || value === undefined) return 'Yeterli satış verisi yok';
            if (!Number.isFinite(numeric)) return 'Hesaplanamadı';
            return `%${formatNumber(numeric)}`;
          };
          const formatSimulationMoney = (value) => {
            const numeric = Number(value);
            if (!hasEnoughSalesData || value === null || value === undefined) return 'Yeterli satış verisi yok';
            if (!Number.isFinite(numeric)) return 'Hesaplanamadı';
            return formatCurrency(numeric, form.currency);
          };
          const rawRecommendationText = normalizeCampaignInsightText(advisoryText || simulation?.recommendation || '');
          const recommendationText = /backend|analiz motoru|analiz verisi/i.test(rawRecommendationText)
            ? 'Seçili aksiyonun etkisi satış hızı, stok ve marj sinyallerine göre hesaplandı.'
            : rawRecommendationText;
          return (
            <>
              <div className="campaign-form-group-head campaign-form-group-head--simulation">
                <div className="campaign-simulation-copy">
                  <span className="campaign-inline-kicker campaign-inline-kicker--amber">
                    <Sparkles size={13} />
                    {label}
                  </span>
                  <h4>{title}</h4>
                  <p>{description}</p>
                </div>
                <div className="campaign-simulation-risk">
                  <span className={`campaign-signal-pill ${getCampaignToneClass(simulation?.riskLevel)}`}>
                    {normalizeCampaignInsightText(simulation?.riskLevel || 'Risk seviyesi yok')}
                  </span>
                </div>
              </div>
              <div className="campaign-simulation-body">
                <div className="campaign-simulation-summary-card">
                  <span>Seçili senaryo</span>
                  <strong>{selectedScenarioLabel || normalizeCampaignInsightText(simulation?.scopeLabel || label)}</strong>
                  <div>
                    <small>Risk seviyesi</small>
                    <b>{normalizeCampaignInsightText(simulation?.riskLevel || '-')}</b>
                  </div>
                  <div>
                    <small>Kapsam</small>
                    <b>{formatNumber(affectedCount)} ürün etkilenecek</b>
                    {hasSeparateCandidateCount ? <small>Analiz önizlemesi {formatNumber(candidateCount)} aday ürün üzerinden hesaplandı</small> : null}
                  </div>
                </div>
                <div className="campaign-preview-stats campaign-preview-stats--compact">
                  <div><span>Tahmini satış artışı</span><strong>{formatSimulationPercent(simulation?.salesIncreasePct)}</strong></div>
                  <div><span>Tahmini ciro etkisi</span><strong>{formatSimulationMoney(simulation?.revenueChange)}</strong></div>
                  <div><span>Tahmini marj etkisi</span><strong>{formatSimulationPercent(simulation?.marginImpact)}</strong></div>
                  <div><span>Stok devir etkisi</span><strong>{formatSimulationPercent(simulation?.stockTurnEffect)}</strong></div>
                  <div><span>{metricTailLabel === 'SKT riski' ? 'SKT riski' : 'Risk seviyesi'}</span><strong>{metricTailLabel === 'SKT riski' ? formatSimulationPercent(simulation?.riskReductionScore) : normalizeCampaignInsightText(simulation?.riskLevel || '-')}</strong></div>
                  <div><span>{metricTailLabel === 'SKT riski' ? 'Etkilenen ürün sayısı' : 'Ortalama stok tükenme'}</span><strong>{metricTailLabel === 'SKT riski' ? formatNumber(affectedCount) : (hasStockDepletion ? `${formatNumber(simulation?.stockDepletionDays)} gün` : 'Yeterli satış verisi yok')}</strong></div>
                </div>
              </div>
              {recommendationText ? (
                <div className="campaign-form-tip campaign-simulation-note" style={{ marginTop: '12px' }}>
                  <strong>{recommendationText}</strong>
                </div>
              ) : null}
            </>
          );
        })()
      )}
    </article>
  );

  const getCampaignLifecycleMeta = (campaign, now = new Date()) => {
    const rawStatus = String(campaign?.status || '').trim().toLowerCase();
    const archiveReason = String(campaign?.archiveReason || '').trim();
    const endsAtValue = String(campaign?.endsAt || '').trim();
    const endsAt = endsAtValue ? new Date(endsAtValue) : null;
    if (endsAt && Number.isFinite(endsAt.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(endsAtValue)) {
      endsAt.setHours(23, 59, 59, 999);
    }
    const isExpired = Boolean(!campaign?.isIndefinite && endsAt && Number.isFinite(endsAt.getTime()) && endsAt < now);
    const isError = ['error', 'failed', 'cancelled', 'canceled', 'iptal'].includes(rawStatus);
    const isArchived = rawStatus === 'archived';
    const isPlanned = isCampaignPlanned(campaign, now);
    const isActive = isCampaignCurrentlyActive(campaign, now);

    if (isError) {
      return {
        label: 'Yayında değil',
        reason: 'Sistem tarafından sonlandırıldı',
        badgeClassName: 'danger',
        isActive: false,
        canEdit: false,
      };
    }

    if (isPlanned) {
      return {
        label: 'Planlandı',
        reason: `Başlangıç: ${formatCampaignDate(campaign?.startsAt)}. Henüz yayında değil.`,
        badgeClassName: 'warning',
        isActive: false,
        canEdit: true,
      };
    }

    if (isActive) {
      return {
        label: 'Yayında',
        reason: 'Yayında',
        badgeClassName: 'success',
        isActive: true,
        canEdit: true,
      };
    }

    if (isExpired) {
      return {
        label: 'Yayında değil',
        reason: 'Süresi bitti',
        badgeClassName: 'warning',
        isActive: false,
        canEdit: false,
      };
    }

    if (isArchived) {
      return {
        label: 'Yayında değil',
        reason: archiveReason && /sistem|system/i.test(archiveReason)
          ? 'Sistem tarafından sonlandırıldı'
          : 'Yönetim tarafından sonlandırıldı',
        badgeClassName: 'neutral',
        isActive: false,
        canEdit: false,
      };
    }

    return {
      label: 'Yayında değil',
      reason: rawStatus === 'draft' || rawStatus === 'paused' || rawStatus === 'inactive' || !archiveReason
        ? 'Yayında değil'
        : 'Yönetim tarafından sonlandırıldı',
      badgeClassName: 'neutral',
      isActive: false,
      canEdit: false,
    };
  };

  const renderCampaignTable = ({
    title,
    description,
    rows,
    tableKey,
    selectable = false,
    sectionMeta = null,
    cardClassName = '',
    emptyTitle = 'Kayıt bulunamadı',
    emptyDescription = 'Bu modülde gösterilecek kampanya kaydı henüz yok.',
  }) => {
    const totalPages = Math.max(1, Math.ceil(rows.length / CAMPAIGN_TABLE_PAGE_SIZE));
    const page = Math.min(getCampaignTablePage(tableKey), totalPages);
    const pageRows = rows.slice((page - 1) * CAMPAIGN_TABLE_PAGE_SIZE, page * CAMPAIGN_TABLE_PAGE_SIZE);
    const SectionIcon = sectionMeta?.icon || Megaphone;

    return (
      <section className={`campaign-table-card campaign-table-card--single${cardClassName ? ` ${cardClassName}` : ''}`}>
        <div className="campaign-table-card-head">
          <div className="campaign-table-card-head-main">
            <span className="campaign-table-card-icon" aria-hidden="true">
              <SectionIcon size={16} />
            </span>
            <div>
              <h4>{title}</h4>
              <p>{description}</p>
            </div>
          </div>
          <span>{formatNumber(rows.length)} kayıt</span>
        </div>
        <div className="table-wrapper campaign-table-spacer">
          <table className="data-table campaign-active-table campaign-standard-table">
            <thead>
              <tr>
                {selectable ? <th><input type="checkbox" aria-label="Tüm kampanyaları seç" checked={rows.length > 0 && rows.every((item) => selectedCampaignIds.includes(item.id))} onChange={(event) => toggleAllCampaignSelections(event.target.checked, rows)} /></th> : null}
                <th>Kampanya Adı</th>
                <th>Kampanya Tipi</th>
                <th>İndirim Oranı</th>
                <th>Başlangıç Tarihi</th>
                <th>Bitiş Tarihi</th>
                <th>Durum</th>
                <th>Kapanma Nedeni / Durumu</th>
                <th>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length ? pageRows.map((item) => {
                const statusMeta = getCampaignLifecycleMeta(item);

                return (
                <tr key={item.id} className="campaign-active-row">
                  {selectable ? <td><input type="checkbox" aria-label={`${item.name} kampanyasını seç`} checked={selectedCampaignIds.includes(item.id)} onChange={(event) => toggleCampaignSelection(item.id, event.target.checked)} /></td> : null}
                  <td><strong>{item.name}</strong><div className="muted-text">{getCampaignPriorityDisplayLabel(item.priority)}</div></td>
                  <td>{CAMPAIGN_TYPE_LABELS[item.type] || item.type}</td>
                  <td>%{formatNumber(item.discountRate)}</td>
                  <td>{item.startsAt || '-'}</td>
                  <td>{item.isIndefinite ? 'Süresiz' : (item.endsAt || '-')}</td>
                  <td><span className={`badge ${statusMeta.badgeClassName}`}>{statusMeta.label}</span></td>
                  <td>{statusMeta.reason}</td>
                  <td className="table-cell-actions">
                    <div className="table-actions campaign-row-actions">
                      <button className="text-button" type="button" onClick={() => setSelectedCampaignDetail({ ...item, __viewMode: statusMeta.isActive ? 'active' : 'archive' })}>Görüntüle</button>
                      {statusMeta.canEdit ? (
                        <>
                          <button className="text-button" type="button" onClick={() => openCampaignEditModal(item)}>Düzenle</button>
                          <button className="text-button danger" type="button" onClick={() => toggleCampaignStatus(item.id)}>Sonlandır</button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )}) : (
                <tr>
                  <td colSpan={selectable ? 9 : 8}>
                    <div className="analytics-empty-state campaign-table-empty" role="status">
                      <SectionIcon size={18} />
                      <strong>{emptyTitle}</strong>
                      <span>{emptyDescription}</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {renderCampaignPagination(tableKey, rows.length)}
      </section>
    );
  };

  const renderCampaignTableStack = ({
    icon: HeaderIcon = Gift,
    iconClassName = 'mod-icon-indigo',
    title,
    description = 'Bu modüldeki tüm kampanyalar tek tabloda birlikte listelenir.',
    rows,
    tableKeyPrefix,
    sectionClassName = '',
  }) => (
    <section className={`campaign-table-stack campaign-table-stack--standalone${sectionClassName ? ` ${sectionClassName}` : ''}`} aria-label="Kampanya listeleri">
      <div className="mod-card-header">
        <div className={`mod-card-icon ${iconClassName}`}><HeaderIcon size={18} /></div>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      {renderCampaignTable({
        title,
        description,
        rows,
        tableKey: `${tableKeyPrefix}-all`,
        sectionMeta: CAMPAIGN_TABLE_SECTION_META[campaignTypeView]?.active,
      })}
    </section>
  );

  const renderSingleCampaignModuleTable = ({
    title,
    description = 'Bu modüldeki tüm kampanyalar tek tabloda birlikte listelenir.',
    rows,
    tableKeyPrefix,
    sectionClassName = '',
    emptyTitle,
    emptyDescription,
    splitLifecycle = false,
  }) => {
    if (!splitLifecycle) {
      return renderCampaignTable({
        title,
        description,
        rows,
        tableKey: `${tableKeyPrefix}-all`,
        sectionMeta: CAMPAIGN_TABLE_SECTION_META[campaignTypeView]?.active,
        cardClassName: sectionClassName,
        emptyTitle,
        emptyDescription,
      });
    }

    const activeRows = rows.filter((item) => isCampaignCurrentlyActive(item));
    const plannedRows = rows.filter((item) => isCampaignPlanned(item));
    const archiveRows = rows.filter((item) => !isCampaignCurrentlyActive(item) && !isCampaignPlanned(item));
    const moduleTitles = CAMPAIGN_MODULE_TABLE_TITLES[tableKeyPrefix] || CAMPAIGN_MODULE_TABLE_TITLES.all;

    return (
      <section className={`campaign-table-stack campaign-table-stack--lifecycle${sectionClassName ? ` ${sectionClassName}` : ''}`}>
        <div className="campaign-lifecycle-head">
          <div className="campaign-table-card-head-main">
            <span className="campaign-table-card-icon" aria-hidden="true"><Megaphone size={16} /></span>
            <div>
              <h4>{title}</h4>
              <p>{description}</p>
            </div>
          </div>
          <span>{formatNumber(rows.length)} kayıt</span>
        </div>
        {renderCampaignTable({
          title: moduleTitles.active,
          description: tableKeyPrefix === 'expiry' ? 'Yayındaki SKT odaklı kampanyaları takip edin.' : 'Yayındaki satış performansı odaklı kampanyaları takip edin.',
          rows: activeRows,
          tableKey: `${tableKeyPrefix}-active`,
          sectionMeta: CAMPAIGN_TABLE_SECTION_META[tableKeyPrefix]?.active,
          emptyTitle: 'Kayıt bulunamadı',
          emptyDescription: tableKeyPrefix === 'expiry' ? 'Henüz SKT bazlı aktif kampanya oluşturulmadı.' : 'Henüz satış bazlı aktif kampanya oluşturulmadı.',
        })}
        {renderCampaignTable({
          title: 'Planlanan Kampanyalar',
          description: 'İleri başlangıç tarihli kampanyalar burada görünür; başlangıç tarihine kadar fiyatlara yansımaz.',
          rows: plannedRows,
          tableKey: `${tableKeyPrefix}-planned`,
          sectionMeta: CAMPAIGN_TABLE_SECTION_META[tableKeyPrefix]?.active,
          emptyTitle: 'Planlanan kampanya yok',
          emptyDescription: 'Bu modülde ileri tarihli kampanya kaydı yok.',
        })}
        {renderCampaignTable({
          title: moduleTitles.archive,
          description: tableKeyPrefix === 'expiry' ? 'Geçmiş SKT kampanyalarını ve kapanma durumlarını inceleyin.' : 'Geçmiş satış bazlı kampanyaları ve kapanma durumlarını inceleyin.',
          rows: archiveRows,
          tableKey: `${tableKeyPrefix}-archive`,
          sectionMeta: CAMPAIGN_TABLE_SECTION_META[tableKeyPrefix]?.archive,
          emptyTitle: 'Kayıt bulunamadı',
          emptyDescription: tableKeyPrefix === 'expiry' ? 'Kampanya arşivi boş.' : 'Kampanya arşivi boş.',
        })}
      </section>
    );
  };

  const getCampaignSuggestionAffectedLabels = (suggestion) => {
    const productIds = new Set((Array.isArray(suggestion?.productIds) ? suggestion.productIds : []).map((id) => String(id)));
    const productLabels = availableProducts
      .filter((product) => productIds.has(String(product.id || '')))
      .slice(0, 8)
      .map((product) => String(product.name || product.productName || product.id));
    const categoryLabels = Array.isArray(suggestion?.categoryNames) ? suggestion.categoryNames : [];
    const brandLabels = Array.isArray(suggestion?.brandNames) ? suggestion.brandNames : [];
    return [...productLabels, ...categoryLabels, ...brandLabels].filter(Boolean);
  };
  const getCampaignSuggestionRows = (suggestion) => {
    const productIds = new Set((Array.isArray(suggestion?.productIds) ? suggestion.productIds : []).map((id) => String(id)));
    if (!productIds.size) return [];
    return campaignAnalyticsRows.filter((row) => productIds.has(String(row?.productId || row?.id || '')));
  };
  const selectedSuggestionRows = useMemo(
    () => selectedCampaignSuggestion ? getCampaignSuggestionRows(selectedCampaignSuggestion) : [],
    [campaignAnalyticsRows, selectedCampaignSuggestion]
  );
  const selectedSuggestionDiscountSimulation = useMemo(() => buildCampaignSimulationSnapshot({
    rows: selectedSuggestionRows,
    discountRate: Number(selectedCampaignSuggestion?.recommendedDiscount || 0) || 15,
    durationDays: 7,
    scopeLabel: 'Kampanya etkisi',
    currency: form.currency,
    emptyMessage: 'Önerinin bağlı olduğu ürün verisi bulunamadı.',
  }), [form.currency, selectedCampaignSuggestion, selectedSuggestionRows]);
  const selectedSuggestionPriceUpSimulation = useMemo(() => {
    if (!selectedSuggestionRows.length) {
      return {
        isEmpty: true,
        title: 'Alternatif fiyat etkisi hazır değil',
        emptyMessage: 'Ürün verisi olmadan fiyat etkisi hesaplanamıyor.',
      };
    }
    const rows = selectedSuggestionRows;
    const avgPrice = averageCampaignMetric(rows, (row) => Number(row?.currentPrice || 0));
    const avgCost = averageCampaignMetric(rows, (row) => Number(row?.cost || 0));
    const avgDailySales = averageCampaignMetric(rows, (row) => Number(row?.salesVelocity || 0));
    const revenueChange = Number((rows.reduce((sum, row) => sum + (Number(row?.currentPrice || 0) * 0.05 * Number(row?.salesVelocity || 0) * 7 * 0.82), 0)).toFixed(2));
    const marginImpact = avgPrice > 0 ? Number((((((avgPrice * 1.05) - avgCost) / Math.max(avgPrice * 1.05, 1)) * 100) - (((avgPrice - avgCost) / Math.max(avgPrice, 1)) * 100)).toFixed(1)) : 0;
    const salesChange = Number((-6).toFixed(1));
    return {
      isEmpty: false,
      riskLevel: avgDailySales >= 3 ? 'Orta' : 'Yüksek',
      salesIncreasePct: salesChange,
      revenueChange,
      marginImpact,
      stockTurnEffect: Number((Math.max(0, avgDailySales) * 4.5).toFixed(1)),
      stockDepletionDays: Number((averageCampaignMetric(rows, (row) => Number(row?.stockLevel || 0)) / Math.max(avgDailySales * 0.94, 0.1)).toFixed(1)),
      recommendation: avgDailySales >= 3
        ? 'Talep güçlü olduğu için küçük bir fiyat artışı marj optimizasyonu için test edilebilir.'
        : 'Satış hızı sınırlı ürünlerde fiyat artışı yerine kampanya veya görünürlük aksiyonu daha güvenlidir.',
      metricsSummary: `${formatNumber(rows.length)} ürün • %5 fiyat artışı varsayımı • satışta sınırlı daralma kabulü`,
    };
  }, [selectedSuggestionRows]);
  const selectedCampaignDetailProductRows = useMemo(() => {
    if (!selectedCampaignDetail || selectedCampaignDetail.__viewMode === 'edit') return [];

    const productById = new Map(availableProducts.map((product) => [String(product.id || product.productId || ''), product]));
    const analyticsById = new Map(campaignAnalyticsRows.map((row) => [String(row?.productId || row?.id || ''), row]));
    const discountRate = Math.max(0, Number(selectedCampaignDetail.discountRate || 0) || 0);
    const toDetailRow = (source = {}) => {
      const productId = String(source?.productId || source?.id || '');
      const product = productById.get(productId) || {};
      const row = analyticsById.get(productId) || source;
      const oldPrice = Math.max(0, Number(row?.currentPrice ?? product?.currentPrice ?? product?.salePrice ?? product?.price ?? 0) || 0);
      const newPrice = oldPrice > 0 && discountRate > 0
        ? Number((oldPrice * (1 - discountRate / 100)).toFixed(2))
        : oldPrice;
      const stockValue = Number(row?.stockLevel ?? row?.currentStock ?? product?.currentStock ?? product?.stockLevel ?? product?.totalStock);

      return {
        id: productId || String(row?.sku || row?.barcode || row?.productName || row?.name || Math.random()),
        productName: normalizeCampaignInsightText(row?.productName || product?.name || product?.productName || 'Ürün'),
        category: normalizeCampaignInsightText(row?.category || product?.categoryName || product?.category || 'Kategori yok'),
        oldPrice,
        newPrice,
        discountRate,
        stock: Number.isFinite(stockValue) ? Math.max(0, stockValue) : null,
      };
    };

    const directProductIds = [
      ...(Array.isArray(selectedCampaignDetail.targetProductIds) ? selectedCampaignDetail.targetProductIds : []),
      ...(Array.isArray(selectedCampaignDetail.productIds) ? selectedCampaignDetail.productIds : []),
      ...(Array.isArray(selectedCampaignDetail.products) ? selectedCampaignDetail.products.map((item) => item?.id || item?.productId) : []),
    ].map((id) => String(id || '').trim()).filter(Boolean);

    if (directProductIds.length) {
      return directProductIds.map((id) => toDetailRow({ ...(productById.get(id) || {}), ...(analyticsById.get(id) || {}), id, productId: id }));
    }

    const type = String(selectedCampaignDetail.type || '').trim().toLocaleLowerCase('tr-TR');
    const categoryIds = new Set((Array.isArray(selectedCampaignDetail.targetCategoryIds) ? selectedCampaignDetail.targetCategoryIds : []).map((id) => String(id || '').trim()).filter(Boolean));
    const brandKeys = new Set((Array.isArray(selectedCampaignDetail.targetBrands) ? selectedCampaignDetail.targetBrands : []).map((brand) => normalizeSearchText(brand)).filter(Boolean));

    let scopedRows = campaignAnalyticsRows;
    if (type === 'category' && categoryIds.size) {
      scopedRows = campaignAnalyticsRows.filter((row) => categoryIds.has(String(row?.categoryId || '').trim()));
    } else if (type === 'brand' && brandKeys.size) {
      scopedRows = campaignAnalyticsRows.filter((row) => brandKeys.has(normalizeSearchText(row?.brand || row?.brandName || '')));
    }

    return scopedRows.map(toDetailRow);
  }, [availableProducts, campaignAnalyticsRows, selectedCampaignDetail]);
  const selectedCampaignDetailScopeCount = useMemo(() => {
    if (!selectedCampaignDetail || selectedCampaignDetail.__viewMode === 'edit') return 0;
    const type = String(selectedCampaignDetail.type || '').trim().toLocaleLowerCase('tr-TR');
    const simulation = selectedCampaignDetail.simulation && typeof selectedCampaignDetail.simulation === 'object'
      ? selectedCampaignDetail.simulation
      : {};
    const savedScopeCount = Math.max(
      Number(simulation.eligibleProductCount || 0) || 0,
      Number(simulation.affectedProductCount || 0) || 0,
      Number(simulation.productCount || 0) || 0,
    );
    if (type === 'general') {
      return Math.max(
        savedScopeCount,
        Number(campaignEligibleProductCount || 0) || 0,
        selectedCampaignDetailProductRows.length,
      );
    }
    return Math.max(savedScopeCount, selectedCampaignDetailProductRows.length);
  }, [campaignEligibleProductCount, selectedCampaignDetail, selectedCampaignDetailProductRows.length]);
  const selectedCampaignDetailPreviewCount = selectedCampaignDetailProductRows.length;

  const resetExpiryInsightFilters = () => {
    setExpiryDayBandFilter('all');
    setExpiryRiskFilter('all');
    setExpiryCategoryFilter('');
    setExpirySearch('');
  };

  const resetSalesInsightFilters = () => {
    setSalesVelocityFilter('all');
    setSalesStockTurnFilter('all');
    setSalesCategoryFilter('');
    setSalesMarginFilter('all');
    setSalesSupplierFilter('');
    setSalesSectionFilter('');
    setSalesProductTypeFilter('all');
    setSalesRecommendationFilter('all');
    setSalesSearch('');
  };

  const selectedDeveloperLogView = getDeveloperLogPresentation(selectedDeveloperLog);
  const clearAuditDetailView = () => {
    setSelectedAuditLog((current) => (current ? {
      ...current,
      changedKeys: [],
      details: '',
      detail: '',
      summary: '',
      note: '',
    } : current));
  };
  const clearDeveloperDetailView = () => {
    setSelectedDeveloperLog((current) => (current ? {
      ...current,
      message: '',
      stack: '',
      requestPayload: '',
      payload: '',
      response: '',
    } : current));
  };
  const clearLoginActivityDetailView = () => {
    setSelectedLoginActivity((current) => (current ? {
      ...current,
      userAgent: '',
      browserInfo: '',
      device: '',
    } : current));
  };
  const auditDetailHeaderActions = (
    <button
      type="button"
      className="icon-button s-log-detail-clear-btn s-log-detail-clear-btn-danger"
      onClick={() => { void handleClearLogRecords('audit'); }}
      aria-label="Detay içeriğini temizle"
      title="Detay içeriğini temizle"
    >
      <Eraser size={15} />
    </button>
  );
  const developerDetailHeaderActions = (
    <button
      type="button"
      className="icon-button s-log-detail-clear-btn s-log-detail-clear-btn-danger"
      onClick={() => { void handleClearLogRecords('developer'); }}
      aria-label="Detay içeriğini temizle"
      title="Detay içeriğini temizle"
    >
      <Eraser size={15} />
    </button>
  );
  const loginDetailHeaderActions = (
    <button
      type="button"
      className="icon-button s-log-detail-clear-btn s-log-detail-clear-btn-danger"
      onClick={() => { void handleClearLogRecords('activity'); }}
      aria-label="Detay içeriğini temizle"
      title="Detay içeriğini temizle"
    >
      <Eraser size={15} />
    </button>
  );

  return (
    <div ref={pageRootRef} className={`page-stack ${isCampaignPage ? 'campaign-management-page' : ''}`}>
      <Toast toast={toast} onClose={() => setToast(null)} />
      {showPinGate && (
        <PinGate
          title="Güvenlik Doğrulaması"
          description="Hassas ayarlara erişmek için PIN giriniz."
          type="settings"
          onSuccess={() => { setSecurityUnlocked(true); setSecurityEditMode(true); setShowPinGate(false); }}
          onCancel={() => setShowPinGate(false)}
        />
      )}
      <PageHeader
        className="dashboard-hero"
        icon={isCampaignPage ? <Megaphone size={22} /> : <SettingsIcon size={22} />}
        title={isCampaignPage ? 'Kampanya Yönetimi' : 'Sistem Ayarları'}
        description={isCampaignPage ? 'Kampanya performansını analiz edin.' : 'Mağaza ve sistem ayarlarını yapılandırın.'}
        actions={!isCampaignPage ? (
          <div className="settings-header-actions">
            <button
              type="button"
              className={`s-save-indicator settings-header-save ${isDirty ? 'is-active' : ''}`}
              disabled={!isAdmin || isLoading || isSaving || !isDirty}
              onClick={() => { void handleSaveAction(); }}
              aria-label={isSaving ? 'Değişiklikler kaydediliyor' : isDirty ? 'Değişiklikleri kaydet' : 'Kaydedilecek değişiklik yok'}
              title={isSaving ? 'Kaydediliyor...' : isDirty ? 'Değişiklikleri kaydet' : 'Kaydedilecek değişiklik yok'}
              aria-busy={isSaving}
            >
              <Save size={16} />
            </button>
            <button
              type="button"
              className={`icon-button settings-auto-sale-gear ${autoSalePanelOpen ? 'is-active' : ''}`}
              onClick={() => setAutoSalePanelOpen((current) => !current)}
              aria-expanded={autoSalePanelOpen}
              aria-controls="automatic-sales-panel"
              aria-label="Otomatik satış panelini aç"
              title="Otomatik Satış Paneli"
          >
            <SlidersHorizontal size={17} />
          </button>
          </div>
        ) : null}
      />

      {isCampaignPage ? (
        <section className="location-type-switch-wrap campaign-mode-nav-shell campaign-mode-nav-shell--top" aria-label="Kampanya mod seçimi">
          <div className="location-type-toggle location-type-toggle-hero campaign-mode-toggle" role="tablist" aria-label="Kampanya türü seçimi">
            {CAMPAIGN_TYPE_FILTER_TABS.map((tab) => {
              const TabIcon = CAMPAIGN_TYPE_TAB_ICONS[tab.key] || Megaphone;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={campaignTypeView === tab.key}
                  className={campaignTypeView === tab.key ? 'is-active active' : ''}
                  onClick={() => {
                    setCampaignTypeView(tab.key);
                    if (['general', 'product', 'category', 'brand'].includes(tab.type)) {
                      setCampaignDraft((current) => ({ ...current, type: tab.type }));
                    }
                  }}
                >
                  <TabIcon size={14} />
                  <span className="campaign-switch-label">{tab.label}</span>
                  <span className="campaign-switch-count">
                    {formatNumber(tab.key === 'all' ? dashboardCampaignSuggestions.length : (campaignSuggestionPresentation.counts[tab.key] || 0))}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {isCampaignPage && visibleCampaignSuggestions.length ? (
        <div className="sr-only campaign-sr-actions" aria-label="Kampanya önerisi hızlı aksiyonları">
          {visibleCampaignSuggestions.slice(0, 5).map((suggestion) => (
            <button key={`sr-${suggestion.id}`} type="button" aria-label="Öneriden kampanya oluştur" onClick={() => createCampaignFromSuggestion(suggestion)}>
              Öneriden kampanya oluştur
            </button>
          ))}
        </div>
      ) : null}

      {!isCampaignPage && autoSalePanelOpen ? (
        <section id="automatic-sales-panel" className="s-card s-auto-sale-panel" aria-label="Otomatik Satış Paneli">
          <div className="s-card-header s-auto-sale-panel-header">
            <div className="s-auto-sale-title-group">
              <div className="s-card-icon s-icon-green"><Coins size={18} /></div>
              <div>
                <h3 className="s-card-title">Otomatik Satış Paneli</h3>
                <p className="s-card-desc">Seçilen kasalarda gerçek ürün, stok ve ödeme akışıyla satış üretir.</p>
              </div>
            </div>
            <div className="s-auto-sale-header-actions">
              <span className="s-auto-sale-source-note">Kaynak: Otomatik satış paneli</span>
              <span className={`s-auto-sale-status-badge ${autoSaleActive ? 'is-active' : 'is-passive'}`}>{autoSaleActive ? 'Aktif' : 'Pasif'}</span>
              <button type="button" className="primary-button" onClick={startAutoSaleAutomation} disabled={autoSaleActive}>
                Başlat
              </button>
              <button type="button" className="ghost-button danger" onClick={stopAutoSaleAutomation} disabled={!autoSaleActive}>
                Durdur
              </button>
            </div>
          </div>

          <fieldset className="s-auto-sale-fieldset">
            <div className="s-auto-sale-fieldset-title">Ayarlar</div>
            <div className="s-auto-sale-grid">
              <label className="s-field">
                <span className="s-field-label">Yoğunluk</span>
                <select className="s-config-select" value={autoSaleConfig.density} onChange={(event) => updateAutoSaleConfig('density', event.target.value)} disabled={autoSaleActive}>
                  {AUTO_SALE_DENSITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="s-field">
                <span className="s-field-label">Minimum tutar</span>
                <input className="s-config-input" type="number" min="0.01" step="0.01" value={autoSaleConfig.minAmount} onChange={(event) => updateAutoSaleConfig('minAmount', event.target.value)} disabled={autoSaleActive} />
              </label>
              <label className="s-field">
                <span className="s-field-label">Maksimum tutar</span>
                <input className="s-config-input" type="number" min="0.01" step="0.01" value={autoSaleConfig.maxAmount} onChange={(event) => updateAutoSaleConfig('maxAmount', event.target.value)} disabled={autoSaleActive} />
              </label>
              <label className="s-field">
                <span className="s-field-label">Çalışma süresi</span>
                <select className="s-config-select" value={autoSaleConfig.duration} onChange={(event) => updateAutoSaleConfig('duration', event.target.value)} disabled={autoSaleActive}>
                  {AUTO_SALE_DURATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              {autoSaleConfig.duration === 'custom' ? (
                <label className="s-field">
                  <span className="s-field-label">Özel süre (dk)</span>
                  <input className="s-config-input" type="number" min="1" step="1" value={autoSaleConfig.customMinutes} onChange={(event) => updateAutoSaleConfig('customMinutes', event.target.value)} disabled={autoSaleActive} />
                </label>
              ) : null}
              <label className="s-field">
                <span className="s-field-label">İade oranı (%)</span>
                <input className="s-config-input" type="number" min="0" max="100" step="0.1" value={autoSaleConfig.returnRate} onChange={(event) => updateAutoSaleConfig('returnRate', event.target.value)} disabled={autoSaleActive} />
              </label>
              <label className="s-field">
                <span className="s-field-label">Minimum ürün çeşidi</span>
                <input className="s-config-input" type="number" min="1" step="1" value={autoSaleConfig.minProductCount} onChange={(event) => updateAutoSaleConfig('minProductCount', event.target.value)} disabled={autoSaleActive} />
              </label>
              <label className="s-field">
                <span className="s-field-label">Maksimum ürün çeşidi</span>
                <input className="s-config-input" type="number" min="1" step="1" value={autoSaleConfig.maxProductCount} onChange={(event) => updateAutoSaleConfig('maxProductCount', event.target.value)} disabled={autoSaleActive} />
              </label>
            </div>

            <div className="s-auto-sale-fieldset-title">Kasa seçimi</div>
            <div className="s-auto-sale-desk-list" aria-label="Kasa seçimi">
              {AUTO_SALE_DESK_OPTIONS.map((desk) => {
                const isSelected = autoSaleConfig.deskCodes.includes(desk.code);
                return (
                  <button
                    key={desk.code}
                    type="button"
                    className={`s-auto-sale-desk ${isSelected ? 'is-selected' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => toggleAutoSaleDesk(desk.code)}
                    disabled={autoSaleActive}
                  >
                    <span>{desk.label}</span>
                    <small>{desk.code}</small>
                  </button>
                );
              })}
            </div>

            {autoSaleError ? <div className="s-auto-sale-error" role="alert">{autoSaleError}</div> : null}
          </fieldset>

          <div className="s-auto-sale-bottom-grid">
            <section className="s-auto-sale-sub-card">
              <div className="s-auto-sale-sub-card-head">
                <h4>Üretilen Satış Özeti</h4>
                <span>{autoSaleActive ? 'Çalışıyor' : 'Beklemede'}</span>
              </div>
              <div className="s-auto-sale-summary-grid">
                <div><span>Toplam satış adedi</span><strong>{formatNumber(autoSaleSummary.totalCount)}</strong></div>
                <div><span>Toplam satış tutarı</span><strong>{formatCurrency(autoSaleSummary.totalAmount)}</strong></div>
                <div><span>Son satış zamanı</span><strong>{autoSaleSummary.lastSaleAt ? formatDate(autoSaleSummary.lastSaleAt) : '-'}</strong></div>
                <div><span>Aktif kasalar</span><strong>{(autoSaleSummary.activeDeskCodes || autoSaleConfig.deskCodes).join(', ') || '-'}</strong></div>
                <div><span>Stokta uygun ürün sayısı</span><strong>{formatNumber(autoSaleEligibleProductCount)}</strong></div>
                <div><span>Kalan süre</span><strong>{autoSaleActive ? formatAutoSaleRemainingTime(autoSaleRemainingMs) : '-'}</strong></div>
                <div><span>İade oranı</span><strong>%{Number(autoSaleConfig.returnRate || 0).toLocaleString('tr-TR')}</strong></div>
                <div><span>Oluşan iade adedi</span><strong>{formatNumber(autoSaleSummary.returnedCount || 0)}</strong></div>
              </div>
            </section>
          </div>
        </section>
      ) : null}

      <form onSubmit={handleSubmit}>
        {isCampaignPage ? (
          <>
            {isHomeCampaignView ? (
              <span className="sr-only">Ana Sayfa Karar Özeti</span>
            ) : null}

            {isHomeCampaignView ? (
              <section className="mod-summary-grid five campaign-summary-grid b2b-kpi-strip campaign-section">
                <button type="button" className="mod-stat campaign-stat-button" onClick={() => setCampaignStatusView('active')}>
                  <div className="mod-stat-icon mod-icon-green"><ShieldCheck size={20} /></div><div className="mod-stat-body"><span className="mod-stat-label">Aktif Kampanya</span><span className="mod-stat-value">{formatNumber(campaignSummary.active)}</span><span className="mod-stat-caption">Şu anda yayında</span></div>
                </button>
                <button type="button" className="mod-stat campaign-stat-button" onClick={() => applyCampaignKpiAction('planned')}>
                  <div className="mod-stat-icon mod-icon-amber"><CalendarDays size={20} /></div><div className="mod-stat-body"><span className="mod-stat-label">Planlanan Kampanya</span><span className="mod-stat-value">{formatNumber(campaignSummary.planned)}</span><span className="mod-stat-caption">Başlangıcı ileri tarihli</span></div>
                </button>
                <button type="button" className="mod-stat campaign-stat-button" onClick={() => applyCampaignKpiAction('all')}>
                  <div className="mod-stat-icon mod-icon-indigo"><BarChart3 size={20} /></div><div className="mod-stat-body"><span className="mod-stat-label">Toplam Kampanya</span><span className="mod-stat-value">{formatNumber(campaignSummary.total)}</span><span className="mod-stat-caption">Tüm kampanya kayıtları</span></div>
                </button>
                <button type="button" className="mod-stat campaign-stat-button" onClick={() => applyCampaignKpiAction('expiring')}>
                  <div className="mod-stat-icon mod-icon-rose"><Hash size={20} /></div><div className="mod-stat-body"><span className="mod-stat-label">Yakında Bitecek Kampanya</span><span className="mod-stat-value">{formatNumber(campaignSummary.expiringSoon)}</span><span className="mod-stat-caption">7 gün içinde bitecek</span></div>
                </button>
                <button type="button" className="mod-stat campaign-stat-button" onClick={() => setCampaignStatusView('active')}>
                  <div className="mod-stat-icon mod-icon-cyan"><Gift size={20} /></div><div className="mod-stat-body"><span className="mod-stat-label">Kampanyalı Ürün</span><span className="mod-stat-value">{formatNumber(campaignSummary.promotedProducts)}</span><span className="mod-stat-caption">Aktif kampanya kapsamı</span></div>
                </button>
              </section>
            ) : null}

            {isHomeCampaignView ? (
              <section className="campaign-chart-grid campaign-section" aria-label="Kampanya özet grafikleri">
                <article className="campaign-chart-card campaign-chart-card--status">
                  <div className="campaign-chart-head">
                    <span className="campaign-chart-badge campaign-chart-badge--indigo" aria-hidden="true"><BarChart3 size={16} /></span>
                    <div>
                      <h4>Kampanya Durumu</h4>
                      <p className="campaign-chart-desc">Mevcut kampanya kayıtlarının durum dağılımı.</p>
                    </div>
                  </div>
                  <div className="campaign-chart-body">
                    <div className="campaign-chart-canvas">
                      {hasCampaignStatusChartData ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <RBarChart data={campaignStatusChartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                          <RTooltip content={<CampaignChartTooltip />} />
                          <Bar dataKey="count" fill="#4f46e5" radius={[8, 8, 0, 0]} />
                        </RBarChart>
                      </ResponsiveContainer>
                      ) : (
                        <div className="campaign-chart-empty">Gösterilecek kampanya kaydı yok.</div>
                      )}
                    </div>
                  </div>
                </article>

                <article className="campaign-chart-card campaign-chart-card--type">
                  <div className="campaign-chart-head">
                    <span className="campaign-chart-badge campaign-chart-badge--green" aria-hidden="true"><Layers size={16} /></span>
                    <div>
                      <h4>Kampanya Tipi</h4>
                      <p className="campaign-chart-desc">Kampanyaların kapsam türlerine göre dağılımı.</p>
                    </div>
                  </div>
                  <div className="campaign-chart-body">
                    <div className="campaign-chart-canvas">
                      {hasCampaignTypeChartData ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <RBarChart data={campaignTypeChartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                          <RTooltip content={<CampaignChartTooltip />} />
                          <Bar dataKey="count" fill="#059669" radius={[8, 8, 0, 0]} />
                        </RBarChart>
                      </ResponsiveContainer>
                      ) : (
                        <div className="campaign-chart-empty">Kampanya tipi verisi yok.</div>
                      )}
                    </div>
                  </div>
                </article>

                <article className="campaign-chart-card campaign-chart-card--suggestion">
                  <div className="campaign-chart-head">
                    <span className="campaign-chart-badge campaign-chart-badge--amber" aria-hidden="true"><Sparkles size={16} /></span>
                    <div>
                      <h4>Öneri Önceliği</h4>
                      <p className="campaign-chart-desc">Kampanya önerilerinin öncelik seviyeleri.</p>
                    </div>
                  </div>
                  <div className="campaign-chart-body">
                    <div className="campaign-chart-canvas">
                      {hasCampaignSuggestionChartData ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <RBarChart data={campaignSuggestionChartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                          <RTooltip content={<CampaignChartTooltip />} />
                          <Bar dataKey="count" fill="#d97706" radius={[8, 8, 0, 0]} />
                        </RBarChart>
                      </ResponsiveContainer>
                      ) : (
                        <div className="campaign-chart-empty">Gösterilecek öneri verisi yok.</div>
                      )}
                    </div>
                  </div>
                </article>
              </section>
            ) : null}

            {isHomeCampaignView ? (
              <section className="mod-card b2b-section-card campaign-home-decision-card">
                <div className="mod-card-header">
                  <div className="mod-card-icon mod-icon-indigo"><Megaphone size={18} /></div>
                  <div>
                    <h3>Öne Çıkan Fırsatlar</h3>
                    <p>Modül detaylarına taşınan öneriler yerine çapraz ve yönetici seviyesindeki özel fırsatları izleyin.</p>
                  </div>
                  <div
                    className="campaign-refresh-toolbar"
                    aria-label="Kampanya önerileri yenileme aksiyonları"
                    style={{ display: 'inline-flex', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: '8px' }}
                  >
                    <span
                      className="campaign-refresh-label"
                      style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}
                    >
                      Son yenileme: {formatCampaignRefreshDateTime(campaignSuggestionRefreshedAt)}
                    </span>
                    <button
                      type="button"
                      className="primary-button campaign-refresh-button"
                      onClick={handleCampaignSuggestionsRefresh}
                      disabled={campaignSuggestionRefreshing}
                      aria-label="Kampanya önerilerini yenile"
                      title="Yenile"
                      style={{ display: 'inline-flex', flex: '0 0 auto' }}
                    >
                      <RefreshCw size={15} className={campaignSuggestionRefreshing ? 'is-spinning' : ''} />
                    </button>
                    <button
                      type="button"
                      className="ghost-button campaign-clear-history-button"
                      onClick={clearPastCampaigns}
                      disabled={isSaving || archiveCampaignRows.length === 0}
                    >
                      <Eraser size={15} />
                      Geçmiş Kampanyaları Temizle
                    </button>
                  </div>
                </div>

                <section className="campaign-suggestions-panel campaign-suggestions-panel--dashboard" aria-label="Öne çıkan kampanya fırsatları">
                  <div className="campaign-suggestion-list">
                    {pagedCampaignSuggestions.length ? pagedCampaignSuggestions.map((suggestion) => (
                      <article key={suggestion.id} className="campaign-suggestion-row campaign-suggestion-row--special">
                        <div className="campaign-suggestion-main">
                          <strong>{suggestion.title}</strong>
                          <p>{suggestion.reason}</p>
                          <div className="campaign-suggestion-meta">
                            <span>{formatNumber(suggestion.affectedProductCount)} Ürün</span>
                            <span>Önerilen indirim %{formatNumber(suggestion.recommendedDiscount)}</span>
                            <span>{suggestion.recommendationType || 'special_opportunity'}</span>
                            <span>{suggestion.impactSummary || suggestion.expectedImpact || 'Tahmini etki kampanya taslağına yansıtılır.'}</span>
                          </div>
                          <div className="campaign-suggestion-meta campaign-suggestion-meta--secondary">
                            <span>{CAMPAIGN_SUGGESTION_PRIORITY_LABELS[suggestion.priority] || 'Orta'} Öncelik</span>
                            <span>{suggestion.scopeLabel || CAMPAIGN_TYPE_LABELS[suggestion.type] || 'Genel'}</span>
                            <span>{suggestion.moduleLabel || CAMPAIGN_SUGGESTION_MODULES.general.label}</span>
                            {suggestion.giftCardRewardCode ? <span>Hediye kartı: {suggestion.giftCardRewardCode}</span> : null}
                          </div>
                        </div>
                        <div className="campaign-suggestion-actions">
                          <button type="button" className="ghost-button" onClick={() => setSelectedCampaignSuggestion(suggestion)}>
                            Detay
                          </button>
                          <button type="button" className="primary-button" onClick={() => createCampaignFromSuggestion(suggestion)}>
                            Kampanya Oluştur
                          </button>
                        </div>
                      </article>
                    )) : (
                      <div className="campaign-module-empty-state">
                        <strong>Öne çıkan özel fırsat yok</strong>
                        <span>Detaylı öneriler ilgili modül sekmelerine ayrıştırıldı. Sayı rozetlerinden modül önerilerini takip edebilirsiniz.</span>
                      </div>
                    )}
                  </div>
                  {visibleCampaignSuggestions.length > CAMPAIGN_SUGGESTIONS_PAGE_SIZE ? (
                    <div className="campaign-suggestions-pagination">
                      <span>Sayfa {safeCampaignSuggestionPage} / {campaignSuggestionTotalPages}</span>
                      <div className="campaign-suggestions-pagination-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          disabled={safeCampaignSuggestionPage === 1}
                          onClick={() => setCampaignSuggestionPage((current) => Math.max(1, current - 1))}
                        >
                          Önceki
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={safeCampaignSuggestionPage === campaignSuggestionTotalPages}
                          onClick={() => setCampaignSuggestionPage((current) => Math.min(campaignSuggestionTotalPages, current + 1))}
                        >
                          Sonraki
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>

              </section>
            ) : null}

            <div className={`settings-layout is-non-admin campaign-settings-layout campaign-layout-shell campaign-view-${campaignTypeView}`}>
              <div className="settings-col settings-col-left">
                {isCampaignBuilderView ? (
                <section className="mod-card b2b-section-card campaign-creation-card campaign-section">
                  {renderCampaignModuleHeroHeader({
                    icon: CAMPAIGN_TYPE_TAB_ICONS[campaignTypeView] || SettingsIcon,
                    iconClassName: CAMPAIGN_MODULE_HEADER_ICON_CLASSES[campaignTypeView] || 'mod-icon-violet',
                    title: campaignBuilderMeta.title,
                    description: campaignBuilderMeta.description,
                  })}
                  <div className="campaign-form-groups">
                    <article className={`campaign-form-group ${campaignTypeView === 'general' ? 'campaign-form-group--general-compact' : ''} ${['product', 'category', 'brand'].includes(campaignTypeView) ? 'campaign-form-group--scope-compact' : ''}`.trim()}>
                      <div className="campaign-form-group-head">
                        <h4>{campaignTypeView === 'general' ? 'Genel Mağaza İndirimi' : 'Kampanya Bilgileri'}</h4>
                        <p>{campaignTypeView === 'general' ? 'Tüm mağaza ürünlerine uygulanacak genel kampanya bilgilerini tanımlayın.' : 'Kampanyanın temel kimliğini ve indirimi tanımlayın.'}</p>
                      </div>
                      <div className="form-grid campaign-form-fields campaign-form-fields--three campaign-form-fields--general-info">
                        <label className="field-group"><span>Kampanya Adı</span><input type="text" value={campaignDraft.name} onChange={(event) => setCampaignDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Örn: Hafta Sonu Atıştırmalık" /></label>
                        <label className="field-group"><span>İndirim Oranı (%)</span><input type="number" min="1" max="80" value={campaignDraft.discountRate} onChange={(event) => setCampaignDraft((current) => ({ ...current, discountRate: event.target.value }))} /></label>
                        <label className="field-group"><span>Başlangıç Tarihi</span><input type="date" value={campaignDraft.startsAt} onChange={(event) => setCampaignDraft((current) => ({ ...current, startsAt: event.target.value }))} /></label>
                        <label className="field-group"><span>Bitiş Tarihi</span><input type="date" min={campaignDraft.startsAt || undefined} value={campaignDraft.isIndefinite ? '' : campaignDraft.endsAt} disabled={campaignDraft.isIndefinite} onChange={(event) => setCampaignDraft((current) => ({ ...current, endsAt: event.target.value }))} /></label>
                        <div className="field-group field-group--checkbox campaign-indefinite-field">
                          <label className={`campaign-toggle-inline ${campaignDraft.isIndefinite ? 'is-active' : ''}`}>
                            <input
                              type="checkbox"
                              checked={campaignDraft.isIndefinite}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setCampaignDraft((current) => ({ ...current, isIndefinite: checked, endsAt: checked ? '' : current.endsAt }));
                              }}
                            />
                            <span className="campaign-toggle-switch" aria-hidden="true"><span className="campaign-toggle-knob" /></span>
                            <span>Süresiz</span>
                          </label>
                        </div>
                      </div>
                      {campaignDraftIsPlanned ? (
                        <div className="campaign-form-tip" role="status">
                          <strong>Planlandı</strong>
                          <span>Başlangıç: {formatCampaignDate(campaignDraft.startsAt)}. Henüz fiyatlara yansımaz.</span>
                        </div>
                      ) : null}
                    </article>

                    {campaignTypeView === 'product' ? (
                      <article className="campaign-form-group">
                        <div className="campaign-form-group-head">
                          <h4>Ürün Seçimi</h4>
                          <p>Arama ile Ürün ekleyin; tüm ürünler sayfa açılışında yüklenmez.</p>
                        </div>
                        <div className="campaign-product-picker">
                          <div className="campaign-product-search-row">
                            <label className="field-group">
                              <span>Ürün ara</span>
                              <input
                                type="search"
                                value={productCampaignSearch}
                                onChange={(event) => setProductCampaignSearch(event.target.value)}
                                placeholder="Ürün adı, barkod veya SKU"
                              />
                            </label>
                          </div>

                          <div className="campaign-product-results" aria-label="Ürün arama sonuçları">
                            {productCampaignSearchResults.length ? productCampaignSearchResults.map((product) => {
                              const productId = String(product.id || '');
                              const productLabel = String(product.name || product.productName || productId);
                              return (
                                <button key={productId} type="button" className="campaign-product-result" onClick={() => toggleCampaignProduct(productId)}>
                                  <span>{productLabel}</span>
                                  <small>{formatCampaignMetaLine(String(product.categoryName || product.category || 'Kategori yok'), String(product.brand || product.brandName || 'Marka yok'))}</small>
                                  <Plus size={14} />
                                </button>
                              );
                            }) : (
                              productCampaignSearch ? (
                                <div className="campaign-product-search-empty">Eşleşen Ürün bulunamadı.</div>
                              ) : null
                            )}
                          </div>

                          <div className="campaign-selected-products" aria-label="Seçilen ürünler">
                            <div className="campaign-selected-products-head">
                              <strong>Seçilen ürünler</strong>
                              <span>{formatNumber(selectedCampaignProducts.length)} Ürün</span>
                            </div>
                            {selectedCampaignProducts.length ? (
                              <div className="campaign-selected-product-list">
                                {selectedCampaignProducts.map((product) => (
                                  <span key={product.id} className="campaign-selected-product-chip">
                                    {product.label}
                                    <button type="button" onClick={() => toggleCampaignProduct(product.id)} aria-label={`${product.label} Ürününü kaldır`}>
                                      <X size={12} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="campaign-product-search-empty">Henüz Ürün seçilmedi.</div>
                            )}
                          </div>
                        </div>
                      </article>
                    ) : null}

                    {campaignTypeView === 'category' ? (
                      <article className="campaign-form-group">
                        <div className="campaign-form-group-head">
                          <h4>Kategori Seçimi</h4>
                          <p>Kampanyanın uygulanacağı kategorileri seçin.</p>
                        </div>
                        <div className="s-giftcard-category-grid">
                          {availableCategories.map((category) => {
                            const categoryId = String(category.id || '');
                            return (
                              <label key={categoryId} className={`s-giftcard-category-item ${campaignDraft.targetCategoryIds.includes(categoryId) ? 'is-selected' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={campaignDraft.targetCategoryIds.includes(categoryId)}
                                  onChange={() => toggleCampaignCategory(categoryId)}
                                />
                                <span>{String(category.name || categoryId)}</span>
                              </label>
                            );
                          })}
                        </div>
                      </article>
                    ) : null}

                    {campaignTypeView === 'brand' ? (
                      <article className="campaign-form-group">
                        <div className="campaign-form-group-head">
                          <h4>Marka Seçimi</h4>
                          <p>Kampanyanın uygulanacağı markaları seçin.</p>
                        </div>
                        <div className="campaign-product-picker campaign-brand-picker">
                          <div className="campaign-brand-toolbar">
                            <label className="field-group campaign-brand-search-field">
                              <span>Marka ara</span>
                              <input
                                type="search"
                                value={brandCampaignSearch}
                                onChange={(event) => setBrandCampaignSearch(event.target.value)}
                                placeholder="En az 2 karakter ile arayın"
                              />
                            </label>
                            <div className="campaign-form-tip campaign-brand-toolbar-info">
                              {brandCampaignSearchNormalized.length >= 2 ? (
                                <>
                                  <strong>{formatNumber(visibleCampaignBrands.length)} eşleşen marka</strong>
                                  <span>Arama sonucunda listeleniyor.</span>
                                </>
                              ) : hiddenCampaignBrandCount > 0 ? (
                                <>
                                  <strong>+{formatNumber(hiddenCampaignBrandCount)} marka daha var</strong>
                                  <span>Görmek için arama yapın.</span>
                                </>
                              ) : (
                                <span>Markalar ürün verilerinden dinamik olarak listelenir.</span>
                              )}
                            </div>
                            <div className="campaign-selected-products campaign-selected-products--inline" aria-label="Seçilen markalar">
                              <div className="campaign-selected-products-head">
                                <strong>Seçilen Markalar</strong>
                                <span>{formatNumber(selectedCampaignBrands.length)} marka</span>
                              </div>
                              {selectedCampaignBrands.length ? (
                                <div className="campaign-selected-product-list campaign-selected-product-list--inline">
                                  {selectedCampaignBrands.map((brandName) => (
                                    <span key={brandName} className="campaign-selected-product-chip">
                                      {brandName}
                                      <button type="button" onClick={() => toggleCampaignBrand(brandName)} aria-label={`${brandName} markasını kaldır`}>
                                        <X size={12} />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="campaign-product-search-empty campaign-product-search-empty--inline">Henüz marka seçilmedi.</div>
                              )}
                            </div>
                          </div>
                          <div
                            className="s-giftcard-category-grid campaign-brand-grid-list"
                            style={{ marginTop: '12px', maxHeight: brandCampaignSearchNormalized.length >= 2 ? '240px' : '0px', overflowY: 'auto', alignContent: 'start' }}
                          >
                            {brandCampaignSearchNormalized.length >= 2 ? (
                              visibleCampaignBrands.length ? visibleCampaignBrands.map((brandName) => (
                                <button
                                  key={brandName}
                                  type="button"
                                  className="s-giftcard-category-item"
                                  onClick={() => toggleCampaignBrand(brandName)}
                                >
                                  <span>{brandName}</span>
                                  <Plus size={14} />
                                </button>
                              )) : (
                                <div className="campaign-product-search-empty" style={{ gridColumn: '1 / -1' }}>
                                  {availableBrands.length === 0
                                    ? 'Ürün verisinde geçerli marka bulunamadı.'
                                    : 'Aramanıza uygun marka bulunamadı.'}
                                </div>
                              )
                            ) : null}
                          </div>
                        </div>
                      </article>
                    ) : null}

                    {(() => {
                      const hasEnoughSimulationData = campaignSimulation?.hasEnoughSalesData !== false
                        && campaignSimulation?.dataQuality?.status !== 'insufficient_data';
                      const formatMainSimulationPercent = (value) => {
                        if (campaignSimulationLoading) return 'Hesaplanıyor';
                        if (!hasEnoughSimulationData || value === null || value === undefined) return 'Yeterli satış verisi yok';
                        const numeric = Number(value);
                        return Number.isFinite(numeric) ? `%${formatNumber(numeric)}` : 'Hesaplanamadı';
                      };
                      const formatMainSimulationMoney = (value) => {
                        if (campaignSimulationLoading) return 'Hesaplanıyor';
                        if (!hasEnoughSimulationData || value === null || value === undefined) return 'Yeterli satış verisi yok';
                        const numeric = Number(value);
                        return Number.isFinite(numeric) ? `${formatNumber(numeric)} ${form.currency}` : 'Hesaplanamadı';
                      };
                      const formatMainStockDepletion = (value) => {
                        if (campaignSimulationLoading) return 'Hesaplanıyor';
                        if (!hasEnoughSimulationData || value === null || value === undefined) return 'Yeterli satış verisi yok';
                        const numeric = Number(value);
                        return Number.isFinite(numeric) && numeric > 0 ? `${formatNumber(numeric)} gün` : 'Yeterli satış verisi yok';
                      };
                      const simulationExplanation = campaignSimulationError
                        ? campaignSimulationError
                        : hasEnoughSimulationData
                          ? (campaignSimulation?.explanation || 'Simülasyon gerçek satış geçmişi, stok ve kampanya kapsamına göre hesaplanır.')
                          : 'Bu kampanya kapsamı için yeterli satış geçmişi bulunmadığından tahmin üretilemedi.';

                      return (
                        <article className="campaign-form-group">
                          <div className="campaign-form-group-head">
                            <h4>Etki Simülasyonu <span className="sr-only">Impact Simulation</span></h4>
                            <p>Simülasyon gerçek satış geçmişi, stok ve kampanya kapsamına göre hesaplanır.</p>
                          </div>
                          <div className="campaign-preview-stats">
                            <div><span>Tahmini satış artışı <span className="sr-only">Estimated sales increase</span></span><strong>{formatMainSimulationPercent(campaignSimulation?.salesIncreasePct)}</strong></div>
                            <div><span>Tahmini ciro değişimi</span><strong>{formatMainSimulationMoney(campaignSimulation?.revenueChange)}</strong></div>
                            <div><span>Tahmini marj etkisi</span><strong>{formatMainSimulationPercent(campaignSimulation?.marginImpact)}</strong></div>
                            <div><span>Tahmini stok tükenme süresi</span><strong>{formatMainStockDepletion(campaignSimulation?.stockDepletionDays)}</strong></div>
                            <div><span>Stok devir etkisi</span><strong>{formatMainSimulationPercent(campaignSimulation?.stockTurnEffect)}</strong></div>
                            <div><span>Risk azaltma etkisi</span><strong>{formatMainSimulationPercent(campaignSimulation?.riskReductionScore)}</strong></div>
                          </div>
                          <div className="campaign-form-tip campaign-simulation-note" style={{ marginTop: '12px' }}>
                            <strong>{simulationExplanation}</strong>
                            {campaignSimulation?.metricsSummary ? <span>{normalizeCampaignInsightText(campaignSimulation.metricsSummary)}</span> : null}
                          </div>
                        </article>
                      );
                    })()}
                  </div>

                  <div className="modal-actions campaign-form-actions">
                    <button className="primary-button" type="button" onClick={addCampaign}><Plus size={15} /> Kampanya Ekle</button>
                    <button className="outline-button" type="button" onClick={() => setCampaignDraft(createDefaultCampaignDraft())}>Taslağı Temizle</button>
                  </div>
                </section>
                ) : null}

                {isCampaignBuilderView ? (
                  <section className="campaign-suggestions-panel campaign-suggestions-panel--module campaign-section" aria-label={`${CAMPAIGN_SUGGESTION_MODULES[campaignTypeView]?.label || 'Modül'} önerileri`}>
                    <div className="campaign-suggestions-panel-head campaign-suggestions-panel-head--module">
                      <div className="campaign-suggestions-panel-head-main">
                        <span className={`campaign-table-card-icon campaign-suggestions-panel-icon ${CAMPAIGN_MODULE_HEADER_ICON_CLASSES[campaignTypeView] || 'mod-icon-indigo'}`} aria-hidden="true">
                          {(() => {
                            const ModuleSuggestionIcon = CAMPAIGN_TYPE_TAB_ICONS[campaignTypeView] || Sparkles;
                            return <ModuleSuggestionIcon size={16} />;
                          })()}
                        </span>
                        <div className="campaign-suggestions-panel-title">
                          <h4>{CAMPAIGN_SUGGESTION_MODULES[campaignTypeView]?.label || 'Modül'} Önerileri</h4>
                          <p>{formatNumber(moduleCampaignSuggestions.length)} öneri bu modülün primary alanı olarak sınıflandırıldı.</p>
                        </div>
                      </div>
                      <span className="campaign-suggestions-count-pill">{formatNumber(moduleCampaignSuggestions.length)} öneri</span>
                    </div>
                    <div className="campaign-suggestion-list">
                      {pagedCampaignSuggestions.length ? pagedCampaignSuggestions.map((suggestion) => (
                        <article key={suggestion.id} className="campaign-suggestion-row">
                          <div className="campaign-suggestion-main">
                            <strong>{normalizeCampaignInsightText(suggestion.title)}</strong>
                            <p>{normalizeCampaignInsightText(suggestion.reason)}</p>
                            <div className="campaign-suggestion-meta">
                              <span>Tip: {normalizeCampaignInsightText(suggestion.recommendationType || suggestion.id || 'campaign_opportunity')}</span>
                              <span>Scope: {normalizeCampaignInsightText(suggestion.scopeLabel || CAMPAIGN_TYPE_LABELS[suggestion.type] || 'Genel')}</span>
                              <span>Aksiyon: {normalizeCampaignInsightText(suggestion.suggestedAction || 'Kampanya oluştur')}</span>
                            </div>
                            <div className="campaign-suggestion-meta campaign-suggestion-meta--secondary">
                              <span>{formatNumber(suggestion.affectedProductCount)} Ürün</span>
                              <span>Önerilen indirim %{formatNumber(suggestion.recommendedDiscount)}</span>
                              <span>{CAMPAIGN_SUGGESTION_PRIORITY_LABELS[suggestion.priority] || 'Orta'} Öncelik</span>
                              {Array.isArray(suggestion.secondaryTags) && suggestion.secondaryTags.length ? <span>{suggestion.secondaryTags.join(' · ')}</span> : null}
                            </div>
                          </div>
                          <div className="campaign-suggestion-actions">
                            <button type="button" className="ghost-button" onClick={() => setSelectedCampaignSuggestion(suggestion)}>
                              Detay
                            </button>
                            <button type="button" className="primary-button" onClick={() => createCampaignFromSuggestion(suggestion)}>
                              Kampanya Oluştur
                            </button>
                          </div>
                        </article>
                      )) : (
                        <div className="campaign-module-empty-state">
                          <strong>Bu modülde öneri yok</strong>
                          <span>Analiz motoru bu modül için öne çıkan öneri üretmedi. Diğer modüllerdeki sayı rozetlerini kontrol edin.</span>
                        </div>
                      )}
                    </div>
                    {visibleCampaignSuggestions.length > CAMPAIGN_SUGGESTIONS_PAGE_SIZE ? (
                      <div className="campaign-suggestions-pagination">
                        <span>Sayfa {safeCampaignSuggestionPage} / {campaignSuggestionTotalPages}</span>
                        <div className="campaign-suggestions-pagination-actions">
                          <button type="button" className="ghost-button" disabled={safeCampaignSuggestionPage === 1} onClick={() => setCampaignSuggestionPage((current) => Math.max(1, current - 1))}>
                            Önceki
                          </button>
                          <button type="button" className="primary-button" disabled={safeCampaignSuggestionPage === campaignSuggestionTotalPages} onClick={() => setCampaignSuggestionPage((current) => Math.min(campaignSuggestionTotalPages, current + 1))}>
                            Sonraki
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {isCampaignBuilderView ? renderSingleCampaignModuleTable({
                  title: CAMPAIGN_MODULE_SINGLE_TABLE_TITLES[campaignTypeView] || 'Kampanya Listesi',
                  description: 'Aktif ve pasif kampanyalar bu modül için tek tabloda birlikte listelenir.',
                  rows: moduleCampaignRows,
                  tableKeyPrefix: campaignTypeView,
                }) : null}

                {campaignTypeView === 'giftCards' ? (
                <section className="mod-card b2b-section-card campaign-giftcard-card">
                  {renderCampaignModuleHeroHeader({
                    icon: Gift,
                    iconClassName: CAMPAIGN_MODULE_HEADER_ICON_CLASSES.giftCards,
                    title: 'Hediye Kartı',
                    description: 'Müşteri ilişkileri modülü ile entegre kart tanımlarını yönetin.',
                  })}
                  <div className="s-giftcard-modal-grid campaign-giftcard-grid">
                    <section className="s-giftcard-form-box campaign-giftcard-left">
                      <div className="campaign-giftcard-kpi-row" aria-label="Hediye kartı KPI Özet">
                        <div><span>Atanan Kart</span><strong>{formatNumber(assignedGiftCardCount)}</strong></div>
                        <div><span>Atamaya Uygun</span><strong>{formatNumber(assignableGiftCards.length)}</strong></div>
                        <div><span>Aktif Kart Sayısı</span><strong>{formatNumber(activeGiftCardCount)}</strong></div>
                      </div>

                      <div className="campaign-giftcard-pane">
                        <div className="campaign-giftcard-pane-head">
                          <h4>Yeni Hediye Kartı</h4>
                          <p>Kart kodu, değer ve geçerlilik bilgisini tek yerden tanımlayın.</p>
                        </div>
                        <div className="s-giftcard-inline-fields">
                          <label>
                            <span>Kart Adı</span>
                            <input type="text" value={giftCardDraft.name} onChange={(event) => setGiftCardDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Sadakat Kartı" />
                          </label>
                          <label>
                            <span>Kart Kodu</span>
                            <div className="s-giftcard-code-input-wrap">
                              <input
                                type="text"
                                value={giftCardDraft.code}
                                onChange={(event) => setGiftCardDraft((current) => ({ ...current, code: normalizeCodeValue(event.target.value).replace(/[^A-Z0-9]/g, '') }))}
                                placeholder="ÖRN: A7K2P"
                              />
                              <button
                                type="button"
                                className="s-giftcard-code-generate-btn"
                                onClick={handleGenerateGiftCardCode}
                                title="Otomatik oluştur"
                                aria-label="Kart kodunu otomatik oluştur"
                              >
                                <Shuffle size={14} />
                              </button>
                            </div>
                          </label>
                        </div>
                        <div className="s-giftcard-inline-fields">
                          <label>
                            <span>Tip</span>
                            <select value={giftCardDraft.valueType} onChange={(event) => setGiftCardDraft((current) => ({ ...current, valueType: event.target.value }))}>
                              <option value="amount">Tutar</option>
                              <option value="percentage">Yüzde</option>
                            </select>
                          </label>
                          <label>
                            <span>Değer</span>
                            <input type="number" min="0" step="0.01" value={giftCardDraft.value} onChange={(event) => setGiftCardDraft((current) => ({ ...current, value: event.target.value }))} placeholder={giftCardDraft.valueType === 'percentage' ? '10' : '150'} />
                          </label>
                        </div>
                        <div className="s-giftcard-inline-fields s-giftcard-inline-fields--triple">
                          <label>
                            <span>Kullanım Hakkı</span>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={giftCardDraft.usageLimit}
                              onChange={(event) => setGiftCardDraft((current) => ({ ...current, usageLimit: event.target.value }))}
                              placeholder="1"
                            />
                          </label>
                          <label>
                            <span>Min. Harcama</span>
                            <input type="number" min="0" step="0.01" value={giftCardDraft.minSpendForReward} onChange={(event) => setGiftCardDraft((current) => ({ ...current, minSpendForReward: event.target.value }))} />
                          </label>
                          <label>
                            <span>Geçerlilik Tarihi / Son Kullanım Tarihi</span>
                            <input type="date" value={giftCardDraft.expiresAt} onChange={(event) => setGiftCardDraft((current) => ({ ...current, expiresAt: event.target.value }))} />
                          </label>
                        </div>
                        <button type="button" className="primary-button s-giftcard-add-btn" onClick={addGiftCard}>
                          <Plus size={15} /> Kartı Ekle
                        </button>
                      </div>

                      {false ? (
                      <div className="campaign-giftcard-pane campaign-giftcard-assignment-card">
                        <div className="campaign-giftcard-pane-head">
                          <h4>Müşteriye Hediye Kartı Ata</h4>
                          <p>Aktif kartları mevcut müşterilere bağlayın; atama anında listelere yansısın.</p>
                        </div>
                        <div className="s-giftcard-inline-fields">
                          <label>
                            <span>Hediye Kartı</span>
                            <select value={giftCardAssignmentDraft.cardCode} onChange={(event) => setGiftCardAssignmentDraft((current) => ({ ...current, cardCode: event.target.value }))}>
                              <option value="">Kart seçin</option>
                              {assignableGiftCards.map((card) => (
                                <option key={card.id} value={card.code}>
                                  {card.code} ? {card.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Müşteri Ara</span>
                            <input
                              type="search"
                              value={giftCardAssignmentDraft.customerQuery}
                              onChange={(event) => setGiftCardAssignmentDraft((current) => ({ ...current, customerQuery: event.target.value }))}
                              placeholder="Ad, müşteri no, telefon"
                            />
                          </label>
                        </div>
                        <label className="campaign-giftcard-assign-field">
                          <span>Müşteri Seç</span>
                          <select value={giftCardAssignmentDraft.customerId} onChange={(event) => setGiftCardAssignmentDraft((current) => ({ ...current, customerId: event.target.value }))}>
                            <option value="">Müşteri seçin</option>
                            {filteredCampaignCustomers.map((customer) => (
                              <option key={customer.id} value={customer.id}>
                                {normalizeCustomerDisplayName(customer.name)} ? {customer.customerNo || '-'}
                              </option>
                            ))}
                          </select>
                        </label>
                        {(selectedAssignmentCard || selectedAssignmentCustomer) ? (
                          <div className="campaign-giftcard-assignment-summary">
                            <div>
                              <span>Seçilen kart</span>
                              <strong>{selectedAssignmentCard ? `${selectedAssignmentCard.name} (${selectedAssignmentCard.code})` : '-'}</strong>
                            </div>
                            <div>
                              <span>Hedef müşteri</span>
                              <strong>{selectedAssignmentCustomer ? `${normalizeCustomerDisplayName(selectedAssignmentCustomer.name)}${selectedAssignmentCustomer.customerNo ? ` ? ${selectedAssignmentCustomer.customerNo}` : ''}` : '-'}</strong>
                            </div>
                          </div>
                        ) : null}
                        {assignableGiftCards.length === 0 ? (
                          <div className="campaign-giftcard-inline-empty">
                            <Gift size={16} />
                            <span>Atanabilir aktif kart bulunmuyor. Önce yeni bir kart tanımlayın veya atanmış kartları kontrol edin.</span>
                          </div>
                        ) : null}
                        <div className="campaign-giftcard-assignment-actions">
                          <button type="button" className="primary-button" onClick={assignGiftCardToCustomer} disabled={giftCardAssignmentLoading || !giftCardAssignmentDraft.cardCode || !giftCardAssignmentDraft.customerId}>
                            {giftCardAssignmentLoading ? 'Atanıyor...' : 'Müşteriye Ata'}
                          </button>
                          <button
                            type="button"
                            className="outline-button"
                            onClick={() => setGiftCardAssignmentDraft({ cardCode: '', customerId: '', customerQuery: '' })}
                            disabled={giftCardAssignmentLoading}
                          >
                            Seçimi Temizle
                          </button>
                        </div>
                      </div>
                      ) : null}
                    </section>

                    <section className="s-giftcard-list-box campaign-giftcard-right">
                      <div className="s-giftcard-list-filters">
                        <input
                          type="search"
                          className="s-giftcard-search"
                          placeholder="Kart adı ara..."
                          value={giftCardSearch}
                          onChange={(event) => setGiftCardSearch(event.target.value)}
                        />
                        <input
                          type="number"
                          className="s-giftcard-amount-filter"
                          placeholder="Min. miktar"
                          min="0"
                          value={giftCardAmountFilter}
                          onChange={(event) => setGiftCardAmountFilter(event.target.value)}
                        />
                      </div>
                      <h4>Mevcut Kartlar ({filteredGiftCards.length})</h4>
                      {giftCards.length === 0 ? (
                        <div className="s-giftcard-empty campaign-giftcard-empty">
                          <Gift size={20} />
                          <p>Henüz hediye kartı tanımlanmadı. Yeni bir kart oluşturarak müşteri bağlılığını artırabilirsiniz.</p>
                        </div>
                      ) : filteredGiftCards.length === 0 ? (
                        <div className="s-giftcard-empty campaign-giftcard-empty">
                          <Gift size={20} />
                          <p>Arama veya miktar filtresiyle eşleşen kart bulunamadı.</p>
                        </div>
                      ) : (
                        <div className="s-giftcard-list s-giftcard-list--scrollable">
                          {filteredGiftCards.map((card) => {
                            const isExpired = isGiftCardExpired(card);
                            const assignedCustomer = campaignCustomerGiftCardMap.get(normalizeCodeValue(card?.code));
                            const isAssigned = Boolean(assignedCustomer);
                            return (
                            <div key={card.id} className={`s-giftcard-row ${isExpired ? 'is-expired' : ''}`}>
                              <div className="s-giftcard-row-main">
                                <strong>{card.name}</strong>
                                <span>{card.code}</span>
                                <div className="campaign-giftcard-tag-row">
                                  <span>{card.valueType === 'percentage' ? `%${formatNumber(card.value)}` : `${formatNumber(card.value)} ${form.currency}`}</span>
                                  <span>{isAssigned ? 'Atandı' : (isExpired ? 'Pasif' : 'Aktif')}</span>
                                  <span>{card.expiresAt ? `Son kullanım: ${formatDate(card.expiresAt)}` : 'Süresiz'}</span>
                                </div>
                                <small>{assignedCustomer ? `Atandı: ${assignedCustomer.customerName}` : 'Henüz müşteriye atanmadı.'}</small>
                                {isExpired ? <small className="campaign-giftcard-expired">Geçerliliği doldu</small> : null}
                              </div>
                              <div className="campaign-giftcard-actions">
                                {false && !isAssigned && !isExpired ? (
                                  <button
                                    type="button"
                                    className="ghost-button"
                                    onClick={() => setGiftCardAssignmentDraft((current) => ({ ...current, cardCode: card.code }))}
                                  >
                                    Ata
                                  </button>
                                ) : null}
                                <button type="button" className="ghost-button" onClick={() => {
                                  setGiftCardDraft({
                                    ...createDefaultGiftCardDraft(),
                                    ...card,
                                    value: String(card.value || ''),
                                    minSpendForReward: String(card.minSpendForReward || ''),
                                    loyaltyPointCost: String(card.loyaltyPointCost || ''),
                                    expiresAt: String(card.expiresAt || ''),
                                  });
                                  setToast({ type: 'info', title: 'Hediye Kartı', message: 'Kart bilgisi forma aktarıldı.' });
                                }}>
                                  Düzenle
                                </button>
                                <button type="button" className="s-giftcard-delete-btn" onClick={() => removeGiftCard(card.id)} aria-label={`${card.name} kartını sil`}>
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          );})}
                        </div>
                      )}
                    </section>
                  </div>
                </section>
                ) : null}

                {campaignTypeView === 'expiry' ? (
                <section className="expiry-campaign-page campaign-dashboard-shell campaign-dashboard-shell--expiry campaign-module-insight-card campaign-module-insight-card--expiry campaign-section">
                  <section className="expiry-campaign-control campaign-expiry-control-section campaign-creation-card campaign-section">
                    {renderCampaignAnalysisHeader({
                      icon: CalendarDays,
                      iconClassName: 'mod-icon-amber',
                      title: 'SKT Fırsat Merkezi',
                      description: 'SKT yaklaşan ürünleri hızlıca okuyun, riski sadeleştirin ve indirim aksiyonunu tek ekrandan başlatın.',
                      className: 'expiry-campaign-header',
                    })}

                    {renderCampaignKpiCards([
                      {
                        icon: AlertTriangle,
                        iconClassName: 'mod-icon-rose',
                        label: 'Bugün Kritik SKT',
                        value: formatNumber(filteredExpiryRows.filter((row) => Number(row?.daysToExpiry || 999) <= 0).length),
                        description: 'Bugün aksiyon bekleyen ürünler',
                      },
                      {
                        icon: CalendarClock,
                        iconClassName: 'mod-icon-amber',
                        label: '3 Gün İçinde SKT',
                        value: formatNumber(filteredExpiryRows.filter((row) => {
                          const days = Number(row?.daysToExpiry || 999);
                          return days > 0 && days <= 3;
                        }).length),
                        description: 'Hızlı indirim adayı ürünler',
                      },
                      {
                        icon: CalendarDays,
                        iconClassName: 'mod-icon-indigo',
                        label: '7 Gün İçinde SKT',
                        value: formatNumber(filteredExpiryRows.filter((row) => {
                          const days = Number(row?.daysToExpiry || 999);
                          return days > 0 && days <= 7;
                        }).length),
                        description: 'Planlı kampanya adayı ürünler',
                      },
                      {
                        icon: Coins,
                        iconClassName: 'mod-icon-violet',
                        label: 'Olası Fire Riski',
                        value: formatCurrency(filteredExpiryRows.reduce((sum, row) => sum + (Number(row?.stockLevel || 0) * Number(row?.currentPrice || 0)), 0), form.currency),
                        description: 'Stok değeri üzerinden tahmini risk',
                      },
                    ], {
                      title: 'Kampanya Bilgileri',
                      description: 'SKT riski ve hızlı indirim kapsamını özetleyen temel göstergeler.',
                      className: 'expiry-campaign-metrics',
                      gridClassName: 'expiry-campaign-metrics-grid',
                      itemClassName: 'expiry-campaign-metric-card',
                    })}

                    {renderCampaignFilterPanel({
                      filters: [
                        { label: 'SKT’ye kalan gün', value: expiryDayBandFilter, onChange: setExpiryDayBandFilter, options: CAMPAIGN_EXPIRY_DAY_BANDS },
                        { label: 'Risk', value: expiryRiskFilter, onChange: setExpiryRiskFilter, options: CAMPAIGN_PRIORITY_OPTIONS },
                        {
                          label: 'Kategori',
                          value: expiryCategoryFilter,
                          onChange: setExpiryCategoryFilter,
                          options: [{ value: '', label: 'Tüm kategoriler' }, ...availableCategories.map((category) => ({ value: category.name, label: category.name }))],
                        },
                      ],
                      search: expirySearch,
                      onSearchChange: setExpirySearch,
                      searchFirst: true,
                      description: '',
                      showRefreshAction: false,
                      onReset: resetExpiryInsightFilters,
                      className: 'expiry-campaign-filters',
                      groupClassName: 'expiry-campaign-filter-grid',
                    })}
                  </section>

                  <div className="campaign-content-sections campaign-insight-layout campaign-insight-layout--insight">
                    {renderCampaignActionCandidatesTable({
                      title: 'Hızlı İndirim Adayları',
                      description: 'SKT odaklı indirim önerilerini takip edin.',
                      icon: Megaphone,
                      total: filteredExpirySuggestions.length,
                      rows: pagedExpirySuggestions.pageRows,
                      paginationKey: 'expiry-suggestions',
                      emptyTitle: 'Filtrelere uygun aksiyon adayı bulunamadı.',
                      emptyDescription: 'Risk veya kategori filtresini genişleterek yeni indirim önerileri görebilirsiniz.',
                      columns: [
                        { key: 'action', label: 'Aksiyon', className: 'campaign-insight-title-cell', render: (suggestion) => <strong>{normalizeCampaignInsightText(suggestion.title)}</strong> },
                        { key: 'reason', label: 'Gerekçe', className: 'campaign-insight-note-cell', render: (suggestion) => <span className="campaign-insight-note-text">{normalizeCampaignInsightText(suggestion.reason)}</span> },
                        { key: 'type', label: 'Tip', render: (suggestion) => <span className="campaign-signal-pill is-neutral">{normalizeCampaignInsightText(suggestion.recommendationType || 'near_expiry')}</span> },
                        { key: 'scope', label: 'Scope', render: (suggestion) => normalizeCampaignInsightText(suggestion.scopeLabel || 'SKT / fire riski') },
                        { key: 'product', label: 'Ürün', render: (suggestion) => `${formatNumber(suggestion.affectedProductCount)} ürün` },
                        { key: 'discount', label: 'Önerilen İndirim', className: 'campaign-insight-metric-cell', render: (suggestion) => `%${formatNumber(suggestion.recommendedDiscount)}` },
                        { key: 'risk', label: 'Risk Seviyesi', render: (suggestion) => <span className={`campaign-signal-pill ${getCampaignToneClass(suggestion.priority)}`}>{normalizeCampaignInsightText(CAMPAIGN_SUGGESTION_PRIORITY_LABELS[suggestion.priority] || 'Orta')}</span> },
                        {
                          key: 'actions',
                          label: 'İşlem',
                          className: 'table-cell-actions',
                          render: (suggestion) => (
                            <div className="table-actions campaign-insight-row-actions">
                              <button type="button" className="ghost-button" onClick={() => setSelectedCampaignSuggestion(suggestion)}>Detay analizi</button>
                              <button type="button" className="primary-button" onClick={() => createCampaignFromSuggestion(suggestion)}>Hızlı indirim oluştur</button>
                            </div>
                          ),
                        },
                      ],
                    })}

                    {renderCampaignProductCandidatesTable({
                      title: 'Ürün Listesi',
                      description: 'SKT’si yaklaşan ürünleri takip edin.',
                      icon: CalendarDays,
                      total: expiryInsightCards.length,
                      rows: pagedExpirySignals.pageRows,
                      mode: 'expiry',
                      paginationKey: 'expiry-signals',
                      emptyTitle: 'Kayıt bulunamadı',
                      emptyDescription: 'Bu filtrelere uygun aksiyon adayı yok.',
                    })}
                  </div>

                  {renderSingleCampaignModuleTable({
                    title: 'SKT Bazlı Kampanya Listesi',
                    description: 'Aktif ve pasif SKT odaklı kampanyalar tek tabloda birlikte listelenir.',
                    rows: moduleCampaignRows,
                    tableKeyPrefix: 'expiry',
                    sectionClassName: 'campaign-section campaign-module-single-table--insight',
                    emptyTitle: 'Kayıt bulunamadı',
                    emptyDescription: 'Henüz SKT bazlı kampanya oluşturulmadı.',
                  })}
                </section>
                ) : null}

                {false && campaignTypeView === 'expiry' ? (
                <section className="campaign-dashboard-shell campaign-dashboard-shell--expiry campaign-module-insight-card campaign-module-insight-card--expiry campaign-section">
                  <div className="campaign-dashboard-header">
                    <div className="mod-card-icon mod-icon-amber"><CalendarDays size={18} /></div>
                    <div>
                      <h3>SKT Fırsat Merkezi</h3>
                      <p>SKT’si yaklaşan ürünleri analiz edin, hızlı indirim veya stok eritme aksiyonu başlatın.</p>
                    </div>
                  </div>

                  <div className="campaign-dashboard-grid campaign-dashboard-summary-grid campaign-module-summary-grid">
                    <article className="campaign-module-summary-card">
                      <span>Bugün kritik SKT adayı</span>
                      <strong>{formatNumber(filteredExpiryRows.filter((row) => Number(row?.daysToExpiry || 999) <= 0).length)}</strong>
                      <small>Bugün veya geçmiş SKT</small>
                    </article>
                    <article className="campaign-module-summary-card">
                      <span>3 gün içinde SKT dolacak</span>
                      <strong>{formatNumber(filteredExpiryRows.filter((row) => Number(row?.daysToExpiry || 999) <= 3).length)}</strong>
                      <small>Hızlı aksiyon adayı</small>
                    </article>
                    <article className="campaign-module-summary-card">
                      <span>Olası fire riski</span>
                      <strong>{formatNumber(filteredExpiryRows.reduce((sum, row) => sum + (Number(row?.stockLevel || 0) * Number(row?.currentPrice || 0)), 0))} {form.currency}</strong>
                      <small>Stok değeri üzerinden tahmin</small>
                    </article>
                  </div>

                  <div className="campaign-dashboard-grid campaign-dashboard-insight-grid campaign-metric-explainer-grid campaign-metric-explainer-grid--insight">
                    {CAMPAIGN_METRIC_EXPLANATIONS.map((item, index) => {
                      const InsightIcon = [CalendarDays, TrendingUp, Sparkles, Info][index % 4];
                      return (
                        <article key={item.title} className="campaign-metric-explainer-card">
                          <span className="campaign-metric-explainer-icon"><InsightIcon size={15} /></span>
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.description}</p>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="campaign-dashboard-card campaign-filter-toolbar campaign-module-filterbar campaign-module-filterbar--wide campaign-module-filterbar--insight">
                    <div className="campaign-module-filter-group">
                      <label className="field-group campaign-control-field">
                        <span>SKT’ye kalan gün</span>
                        <select value={expiryDayBandFilter} onChange={(event) => setExpiryDayBandFilter(event.target.value)}>
                          {CAMPAIGN_EXPIRY_DAY_BANDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <label className="field-group campaign-control-field">
                        <span>Risk</span>
                        <select value={expiryRiskFilter} onChange={(event) => setExpiryRiskFilter(event.target.value)}>
                          {CAMPAIGN_PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <label className="field-group campaign-control-field">
                        <span>Kategori</span>
                        <select value={expiryCategoryFilter} onChange={(event) => setExpiryCategoryFilter(event.target.value)}>
                          <option value="">Tüm kategoriler</option>
                          {availableCategories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="campaign-module-filter-actions">
                      <button type="button" className="ghost-button" onClick={handleCampaignSuggestionsRefresh} disabled={campaignSuggestionRefreshing}>Önerileri Yenile</button>
                      <button type="button" className="outline-button" onClick={resetExpiryInsightFilters}>Filtreleri Temizle</button>
                    </div>
                  </div>

                  <div className="campaign-dashboard-grid campaign-scenario-grid campaign-scenario-strip campaign-scenario-strip--insight">
                    {['discount-10', 'discount-20', 'discount-30'].map((scenarioKey) => (
                      <button
                        key={scenarioKey}
                        type="button"
                        className={`campaign-scenario-chip ${expiryScenario === scenarioKey ? 'is-active' : ''}`}
                        onClick={() => setExpiryScenario(scenarioKey)}
                      >
                        <span className="campaign-scenario-chip-icon"><Sparkles size={15} /></span>
                        <strong>{campaignScenarioOptions[scenarioKey].label}</strong>
                        <span>{campaignScenarioOptions[scenarioKey].description}</span>
                      </button>
                    ))}
                  </div>

                  {renderCampaignSimulationSection(renderedExpiryCampaignSimulation, {
                    title: 'Hızlı İndirim Simülasyonu',
                    description: 'Seçilen aksiyonun satış, ciro, marj ve stok devir etkisi.',
                  })}

                  <div className="campaign-content-sections campaign-insight-layout campaign-insight-layout--insight">
                    <section className="campaign-dashboard-card campaign-data-section campaign-action-table campaign-insight-panel">
                      <div className="campaign-insight-panel-head">
                        <h4 className="campaign-insight-title-accent">
                          <span className="campaign-inline-kicker campaign-inline-kicker--blue">
                            <Megaphone size={13} />
                            Aksiyon listesi
                          </span>
                          <span>Hızlı indirim adayları</span>
                        </h4>
                        <span>{formatNumber(filteredExpirySuggestions.length)} Öneri</span>
                      </div>
                      {filteredExpirySuggestions.length ? (
                        <div className="table-wrapper campaign-insight-table-wrap">
                          <table className="data-table campaign-active-table campaign-standard-table campaign-insight-table campaign-insight-suggestion-table">
                            <thead>
                              <tr>
                                <th>Aksiyon</th>
                                <th>Gerekçe</th>
                                <th>Ürün</th>
                                <th>Önerilen indirim</th>
                                <th>Risk seviyesi</th>
                                <th>İşlem</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pagedExpirySuggestions.pageRows.map((suggestion) => (
                                <tr key={suggestion.id}>
                                  <td className="campaign-insight-title-cell"><strong>{suggestion.title}</strong></td>
                                  <td className="campaign-insight-note-cell">{suggestion.reason}</td>
                                  <td>{formatNumber(suggestion.affectedProductCount)} ürün</td>
                                  <td className="campaign-insight-metric-cell">%{formatNumber(suggestion.recommendedDiscount)}</td>
                                  <td>
                                    <span className={`campaign-signal-pill ${getCampaignToneClass(suggestion.priority)}`}>
                                      {CAMPAIGN_SUGGESTION_PRIORITY_LABELS[suggestion.priority] || 'Orta'}
                                    </span>
                                  </td>
                                  <td className="table-cell-actions">
                                    <button type="button" className="primary-button" onClick={() => createCampaignFromSuggestion(suggestion)}>Hızlı indirim oluştur</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="analytics-empty-state campaign-module-empty-state" role="status">
                          <span className="campaign-inline-kicker campaign-inline-kicker--slate">
                            <Info size={13} />
                            Veri durumu
                          </span>
                          <strong>Filtrelere uygun SKT verisi bulunamadı.</strong>
                          <span>Gün bandı veya kategori filtresini gevşeterek listeyi tekrar oluşturun.</span>
                        </div>
                      )}
                      {renderCampaignInsightPagination('expiry-suggestions', pagedExpirySuggestions.total)}
                    </section>

                    <section className="campaign-dashboard-card campaign-data-section campaign-signals-table campaign-insight-panel campaign-insight-signal-panel">
                      <div className="campaign-insight-panel-head">
                        <h4>Ürün sinyalleri</h4>
                        <span>{formatNumber(expiryInsightCards.length)} kayıt</span>
                      </div>
                      {expiryInsightCards.length ? (
                        <div className="table-wrapper campaign-insight-table-wrap">
                          <table className="data-table campaign-active-table campaign-standard-table campaign-insight-table campaign-insight-signal-table">
                            <thead>
                              <tr>
                                <th>Ürün</th>
                                <th>Sinyal</th>
                                <th>SKT</th>
                                <th>Stok</th>
                                <th>Günlük satış</th>
                                <th>Tahmini stok bitişi</th>
                                <th>Brüt marj</th>
                                <th>Sistem önerisi</th>
                                <th>İşlem</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pagedExpirySignals.pageRows.map((row) => (
                                <tr key={row.id}>
                                  <td className="campaign-insight-product-cell">
                                    <strong>{row.productName}</strong>
                                    <small>{formatCampaignMetaLine(row.category || 'Kategori yok', row.brand || row.supplierName || 'Marka yok', row.sectionName && row.sectionName !== '-' ? row.sectionName : '')}</small>
                                    <span>{row.summary}</span>
                                  </td>
                                  <td><span className={`campaign-signal-pill ${getCampaignToneClass(row.riskLevel)}`}>{row.signalType}</span></td>
                                  <td>
                                    {(() => {
                                      const expiryBadge = getExpiryStatusBadgeMeta(row.daysToExpiry);
                                      return <span className={`campaign-signal-pill ${expiryBadge.toneClass}`}>{expiryBadge.label}</span>;
                                    })()}
                                  </td>
                                  <td className="campaign-insight-metric-cell">{formatNumber(row.stockLevel)} adet</td>
                                  <td className="campaign-insight-metric-cell">{formatCampaignDailySales(row.salesVelocity)}</td>
                                  <td className="campaign-insight-metric-cell">{row.stockCoverageDays}</td>
                                  <td className="campaign-insight-metric-cell">%{formatNumber(row.currentMarginPercent || 0)}</td>
                                  <td><span className={`campaign-action-pill ${getCampaignActionTone(row.recommendation)}`}>{row.recommendation}</span></td>
                                  <td className="table-cell-actions">
                                    <button type="button" className="text-button" onClick={() => createCampaignFromSuggestion({
                                      id: `expiry-inline-${row.id}`,
                                      title: `${row.productName} için hızlı indirim`,
                                      reason: row.summary,
                                      affectedProductCount: 1,
                                      recommendedDiscount: Math.max(10, Number(row?.suggestedDiscount || 20)),
                                      type: 'product',
                                      productIds: [row.productId || row.id],
                                      priority: row.riskLevel || 'medium',
                                    })}>Hızlı indirim oluştur</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="campaign-empty-state-box">
                          <p>Filtrelere uyan Ürün sinyali yok.</p>
                          <span>Daha geniş bir gün bandı seçerek listeyi genişletebilirsiniz.</span>
                        </div>
                      )}
                      {renderCampaignInsightPagination('expiry-signals', pagedExpirySignals.total)}
                    </section>
                  </div>
                </section>
                ) : null}

                {campaignTypeView === 'sales' ? (
                <section className="sales-campaign-page campaign-dashboard-shell campaign-dashboard-shell--sales campaign-module-insight-card campaign-module-insight-card--sales campaign-section">
                  <section className="sales-campaign-control campaign-sales-control-section campaign-creation-card campaign-section">
                    {renderCampaignAnalysisHeader({
                      icon: TrendingUp,
                      iconClassName: 'mod-icon-indigo',
                      title: 'Satış Bazlı Kampanya Merkezi',
                      description: 'Satış, marj ve stok baskısını aynı akışta okuyun; kampanya aksiyonunu hızlıca seçin.',
                      className: 'sales-campaign-header',
                    })}

                    {renderCampaignKpiCards([
                      {
                        icon: TrendingDown,
                        iconClassName: 'mod-icon-rose',
                        label: 'Yavaş Satan Ürün',
                        value: formatNumber(filteredSalesRows.filter((row) => Number(row?.salesVelocity || 0) <= 1.2).length),
                        description: 'Günlük satış ortalaması düşük ürünler',
                      },
                      {
                        icon: PackageSearch,
                        iconClassName: 'mod-icon-amber',
                        label: 'Stok Baskısı',
                        value: formatNumber(filteredSalesRows.filter((row) => {
                          const velocity = Number(row?.salesVelocity || 0);
                          const stockTurn = velocity > 0 ? Number(row?.stockLevel || 0) / velocity : Number(row?.stockLevel || 0);
                          return stockTurn >= 25;
                        }).length),
                        description: 'Satış hızına göre fazla stok taşıyan ürünler',
                      },
                      {
                        icon: Percent,
                        iconClassName: 'mod-icon-green',
                        label: 'Ortalama Marj',
                        value: `%${formatNumber(filteredSalesRows.length ? filteredSalesRows.reduce((sum, row) => sum + Number(row?.currentMarginPercent || 0), 0) / filteredSalesRows.length : 0)}`,
                        description: 'Seçili filtre bağlamındaki ortalama brüt marj',
                      },
                      {
                        icon: Megaphone,
                        iconClassName: 'mod-icon-indigo',
                        label: 'Kampanya Adayı',
                        value: formatNumber(salesInsightCards.length),
                        description: 'Sistem tarafından aksiyon önerilen ürünler',
                      },
                    ], {
                      title: 'Kampanya Bilgileri',
                      description: '',
                      className: 'sales-campaign-metrics',
                      gridClassName: 'sales-campaign-metrics-grid',
                      itemClassName: 'sales-campaign-metric-card',
                    })}

                    {renderCampaignFilterPanel({
                      filters: [
                        { label: 'Satış hızı', value: salesVelocityFilter, onChange: setSalesVelocityFilter, options: CAMPAIGN_SALES_VELOCITY_OPTIONS },
                        { label: 'Stok devri', value: salesStockTurnFilter, onChange: setSalesStockTurnFilter, options: CAMPAIGN_STOCK_TURN_OPTIONS },
                        {
                          label: 'Kategori',
                          value: salesCategoryFilter,
                          onChange: setSalesCategoryFilter,
                          options: [{ value: '', label: 'Tüm kategoriler' }, ...availableCategories.map((category) => ({ value: category.name, label: category.name }))],
                        },
                        { label: 'Marj', value: salesMarginFilter, onChange: setSalesMarginFilter, options: CAMPAIGN_MARGIN_OPTIONS },
                        {
                          label: 'Ürün tipi',
                          value: salesProductTypeFilter,
                          onChange: setSalesProductTypeFilter,
                          options: [
                            { value: 'all', label: 'Tüm tipler' },
                            { value: 'fast', label: 'Çok satan' },
                            { value: 'slow', label: 'Yavaş satan' },
                            { value: 'pressure', label: 'Stok baskısı' },
                            { value: 'margin', label: 'Marj fırsatı' },
                          ],
                        },
                        {
                          label: 'Öneri tipi',
                          value: salesRecommendationFilter,
                          onChange: setSalesRecommendationFilter,
                          options: [
                            { value: 'all', label: 'Tüm öneriler' },
                            { value: 'discount', label: 'İndirim' },
                            { value: 'bundle', label: 'Çoklu alım' },
                            { value: 'price-up', label: 'Fiyat artışı' },
                            { value: 'hold', label: 'Kampanya gerekmez' },
                          ],
                        },
                      ],
                      search: salesSearch,
                      onSearchChange: setSalesSearch,
                      searchFirst: true,
                      className: 'sales-campaign-filters',
                      groupClassName: 'sales-campaign-filter-grid',
                      description: '',
                      showRefreshAction: false,
                      onReset: resetSalesInsightFilters,
                    })}
                  </section>

                  <div className="sales-campaign-tables campaign-content-sections campaign-insight-layout campaign-insight-layout--insight">
                    {renderCampaignActionCandidatesTable({
                      title: 'Satış Odaklı Kampanya Listesi',
                      description: 'Satış hızı ve stok baskısına göre önerilen kampanya aksiyonlarını takip edin.',
                      icon: Megaphone,
                      total: filteredSalesSuggestions.length,
                      rows: pagedSalesSuggestions.pageRows,
                      paginationKey: 'sales-suggestions',
                      emptyTitle: 'Filtrelere uygun kampanya adayı bulunamadı.',
                      emptyDescription: 'Satış hızı veya stok devri filtresini genişleterek yeni öneriler görebilirsiniz.',
                      columns: [
                        { key: 'campaign', label: 'Kampanya', className: 'campaign-insight-title-cell', render: (suggestion) => <strong>{normalizeCampaignInsightText(suggestion.title)}</strong> },
                        {
                          key: 'reason',
                          label: 'Gerekçe',
                          className: 'campaign-insight-note-cell campaign-sales-reason-cell',
                          render: (suggestion) => (
                            <span className="campaign-sales-reason-text">{normalizeCampaignInsightText(suggestion.reason)}</span>
                          ),
                        },
                        { key: 'product', label: 'Ürün', render: (suggestion) => `${formatNumber(suggestion.affectedProductCount)} ürün` },
                        { key: 'recommendationType', label: 'Tip', render: (suggestion) => <span className="campaign-signal-pill is-neutral">{normalizeCampaignInsightText(suggestion.recommendationType || 'sales_opportunity')}</span> },
                        { key: 'scope', label: 'Scope', render: (suggestion) => normalizeCampaignInsightText(suggestion.scopeLabel || 'Satış performansı') },
                        { key: 'margin', label: 'Ortalama Marj', className: 'campaign-insight-metric-cell', render: (suggestion) => `%${formatNumber(averageCampaignMetric(getCampaignSuggestionRows(suggestion), (row) => Number(row?.currentMarginPercent || 0)))}` },
                        { key: 'type', label: 'Tür', render: (suggestion) => <span className="campaign-signal-pill is-neutral">{normalizeCampaignInsightText(CAMPAIGN_TYPE_LABELS[suggestion.type] || 'Genel')} kampanya</span> },
                        {
                          key: 'actions',
                          label: 'İşlem',
                          className: 'table-cell-actions',
                          render: (suggestion) => (
                            <div className="table-actions campaign-insight-row-actions">
                              <button type="button" className="ghost-button" onClick={() => setSelectedCampaignSuggestion(suggestion)}>Detay</button>
                              <button type="button" className="primary-button" onClick={() => createCampaignFromSuggestion(suggestion)}>Kampanya Oluştur</button>
                            </div>
                          ),
                        },
                      ],
                    })}

                    {renderCampaignProductCandidatesTable({
                      title: 'Satış ve Marj Listesi',
                      description: 'Satış hızı, stok baskısı ve marj durumunu takip edin.',
                      icon: TrendingUp,
                      total: salesInsightCards.length,
                      rows: pagedSalesSignals.pageRows,
                      mode: 'sales',
                      paginationKey: 'sales-signals',
                      emptyTitle: 'Kayıt bulunamadı',
                      emptyDescription: 'Bu filtrelere uygun aksiyon adayı yok.',
                    })}
                  </div>

                  {renderSingleCampaignModuleTable({
                    title: 'Satış Bazlı Kampanya Listesi',
                    description: 'Aktif ve pasif satış performansı odaklı kampanyalar tek tabloda birlikte listelenir.',
                    rows: moduleCampaignRows,
                    tableKeyPrefix: 'sales',
                    sectionClassName: 'campaign-section campaign-module-single-table--insight',
                    emptyTitle: 'Kayıt bulunamadı',
                    emptyDescription: 'Satış bazlı kampanya kaydı henüz bulunmuyor.',
                  })}
                </section>
                ) : null}

                {false && campaignTypeView === 'sales' ? (
                <section className="campaign-dashboard-shell campaign-dashboard-shell--sales campaign-module-insight-card campaign-module-insight-card--sales campaign-section">
                  <div className="campaign-dashboard-header">
                    <div className="campaign-sales-header-main">
                      <div className="mod-card-icon mod-icon-indigo"><TrendingUp size={18} /></div>
                      <div>
                        <h3>Satış Bazlı Kampanya Merkezi</h3>
                        <p>Satış hızı, stok baskısı ve marj verisiyle kampanya veya fiyat aksiyonunu seçin.</p>
                      </div>
                    </div>
                    <div className="campaign-sales-header-actions" aria-label="Satış bazlı aksiyon alanı">
                      <button type="button" className="ghost-button" onClick={handleCampaignSuggestionsRefresh} disabled={campaignSuggestionRefreshing}>
                        <RefreshCw size={14} />
                        <span>Yenile</span>
                      </button>
                      <button type="button" className="outline-button" disabled>
                        <BarChart3 size={14} />
                        <span>Analiz</span>
                      </button>
                      <button type="button" className="outline-button" disabled>
                        <FileSpreadsheet size={14} />
                        <span>Export</span>
                      </button>
                    </div>
                  </div>

                  <div className="campaign-dashboard-grid campaign-dashboard-summary-grid campaign-module-summary-grid">
                    <article className="campaign-module-summary-card">
                      <span>Yavaş satan ürün</span>
                      <strong>{formatNumber(filteredSalesRows.filter((row) => Number(row?.salesVelocity || 0) <= 1.2).length)}</strong>
                      <small>Günlük satış ortalaması zayıf</small>
                    </article>
                    <article className="campaign-module-summary-card">
                      <span>Stok baskısı</span>
                      <strong>{formatNumber(filteredSalesRows.filter((row) => {
                        const velocity = Number(row?.salesVelocity || 0);
                        const stockTurn = velocity > 0 ? Number(row?.stockLevel || 0) / velocity : Number(row?.stockLevel || 0);
                        return stockTurn >= 25;
                      }).length)}</strong>
                      <small>Satış hızına göre fazla stok</small>
                    </article>
                    <article className="campaign-module-summary-card">
                      <span>Ortalama marj</span>
                      <strong>%{formatNumber(filteredSalesRows.length ? filteredSalesRows.reduce((sum, row) => sum + Number(row?.currentMarginPercent || 0), 0) / filteredSalesRows.length : 0)}</strong>
                      <small>Filtreye uyan ortalama</small>
                    </article>
                  </div>

                  <div className="campaign-dashboard-grid campaign-dashboard-insight-grid campaign-metric-explainer-grid campaign-metric-explainer-grid--insight">
                    {CAMPAIGN_METRIC_EXPLANATIONS.map((item, index) => {
                      const InsightIcon = [TrendingUp, BarChart3, Sparkles, Info][index % 4];
                      return (
                        <article key={item.title} className="campaign-metric-explainer-card">
                          <span className="campaign-metric-explainer-icon"><InsightIcon size={15} /></span>
                          <div>
                            <strong>{item.title}</strong>
                            <p>{item.description}</p>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="campaign-dashboard-card campaign-filter-toolbar campaign-module-filterbar campaign-module-filterbar--wide campaign-module-filterbar--insight">
                    <div className="campaign-module-filter-group campaign-module-filter-group--sales">
                      <label className="field-group campaign-control-field">
                        <span>Satış hızı</span>
                        <select value={salesVelocityFilter} onChange={(event) => setSalesVelocityFilter(event.target.value)}>
                          {CAMPAIGN_SALES_VELOCITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <label className="field-group campaign-control-field">
                        <span>Stok devri</span>
                        <select value={salesStockTurnFilter} onChange={(event) => setSalesStockTurnFilter(event.target.value)}>
                          {CAMPAIGN_STOCK_TURN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <label className="field-group campaign-control-field">
                        <span>Kategori</span>
                        <select value={salesCategoryFilter} onChange={(event) => setSalesCategoryFilter(event.target.value)}>
                          <option value="">Tüm kategoriler</option>
                          {availableCategories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                        </select>
                      </label>
                      <label className="field-group campaign-control-field">
                        <span>Marj</span>
                        <select value={salesMarginFilter} onChange={(event) => setSalesMarginFilter(event.target.value)}>
                          {CAMPAIGN_MARGIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <label className="field-group campaign-control-field">
                        <span>Ürün tipi</span>
                        <select value={salesProductTypeFilter} onChange={(event) => setSalesProductTypeFilter(event.target.value)}>
                          <option value="all">Tüm tipler</option>
                          <option value="fast">Çok satan</option>
                          <option value="slow">Yavaş satan</option>
                          <option value="pressure">Stok baskılı</option>
                          <option value="margin">Marj fırsatı</option>
                        </select>
                      </label>
                      <label className="field-group campaign-control-field">
                        <span>Öneri tipi</span>
                        <select value={salesRecommendationFilter} onChange={(event) => setSalesRecommendationFilter(event.target.value)}>
                          <option value="all">Tüm öneriler</option>
                          <option value="discount">İndirim</option>
                          <option value="price-up">Fiyat artışı</option>
                          <option value="hold">Sabit tut</option>
                        </select>
                      </label>
                      <label className="field-group campaign-control-field">
                        <span>Tedarikçi</span>
                        <select value={salesSupplierFilter} onChange={(event) => setSalesSupplierFilter(event.target.value)}>
                          <option value="">Tüm tedarikçiler</option>
                          {campaignSupplierOptions.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
                        </select>
                      </label>
                      <label className="field-group campaign-control-field">
                        <span>Reyon</span>
                        <select value={salesSectionFilter} onChange={(event) => setSalesSectionFilter(event.target.value)}>
                          <option value="">Tüm reyonlar</option>
                          {campaignSectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="campaign-module-filter-actions">
                      <button type="button" className="ghost-button" onClick={handleCampaignSuggestionsRefresh} disabled={campaignSuggestionRefreshing}>Önerileri Yenile</button>
                      <button type="button" className="outline-button" onClick={resetSalesInsightFilters}>Filtreleri Temizle</button>
                    </div>
                  </div>

                  <div className="campaign-dashboard-grid campaign-scenario-grid campaign-scenario-strip campaign-scenario-strip--insight">
                    {['discount-10', 'discount-20', 'bundle', 'price-up'].map((scenarioKey) => (
                      <button
                        key={scenarioKey}
                        type="button"
                        className={`campaign-scenario-chip ${salesScenario === scenarioKey ? 'is-active' : ''}`}
                        onClick={() => setSalesScenario(scenarioKey)}
                      >
                        <span className="campaign-scenario-chip-icon">
                          {scenarioKey === 'bundle' ? <Gift size={15} /> : scenarioKey === 'price-up' ? <TrendingUp size={15} /> : <Sparkles size={15} />}
                        </span>
                        <strong>{campaignScenarioOptions[scenarioKey].label}</strong>
                        <span>{campaignScenarioOptions[scenarioKey].description}</span>
                      </button>
                    ))}
                  </div>

                  {renderCampaignSimulationSection(renderedSalesCampaignSimulation, {
                    title: 'Etki Simülasyonu',
                    description: 'Seçilen senaryonun satış, ciro, marj ve stok devir etkisi.',
                  })}

                  <div className="campaign-content-sections campaign-insight-layout campaign-insight-layout--insight">
                    <section className="campaign-dashboard-card campaign-data-section campaign-action-table campaign-insight-panel">
                      <div className="campaign-insight-panel-head">
                        <h4>Satış odaklı kampanya listesi</h4>
                        <span>{formatNumber(filteredSalesSuggestions.length)} Öneri</span>
                      </div>
                      {filteredSalesSuggestions.length ? (
                        <div className="table-wrapper campaign-insight-table-wrap">
                          <table className="data-table campaign-active-table campaign-standard-table campaign-insight-table campaign-insight-suggestion-table">
                            <thead>
                              <tr>
                                <th>Kampanya</th>
                                <th>Gerekçe</th>
                                <th>Ürün</th>
                                <th>Ortalama marj</th>
                                <th>Tür</th>
                                <th>İşlem</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pagedSalesSuggestions.pageRows.map((suggestion) => (
                                <tr key={suggestion.id}>
                                  <td className="campaign-insight-title-cell"><strong>{suggestion.title}</strong></td>
                                  <td className="campaign-insight-note-cell">{suggestion.reason}</td>
                                  <td>{formatNumber(suggestion.affectedProductCount)} ürün</td>
                                  <td className="campaign-insight-metric-cell">%{formatNumber(averageCampaignMetric(getCampaignSuggestionRows(suggestion), (row) => Number(row?.currentMarginPercent || 0)))}</td>
                                  <td><span className="campaign-signal-pill is-neutral">{CAMPAIGN_TYPE_LABELS[suggestion.type] || 'Genel'} kampanya</span></td>
                                  <td className="table-cell-actions">
                                    <div className="table-actions campaign-insight-row-actions">
                                      <button type="button" className="ghost-button" onClick={() => setSelectedCampaignSuggestion(suggestion)}>Detay</button>
                                      <button type="button" className="primary-button" onClick={() => createCampaignFromSuggestion(suggestion)}>Kampanya Oluştur</button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="analytics-empty-state campaign-module-empty-state" role="status">
                          <TrendingUp size={18} />
                          <strong>Filtrelere uygun satış kampanyası bulunamadı</strong>
                          <span>Satış hızı veya stok devri filtresini gevşeterek havuzu genişletin.</span>
                        </div>
                      )}
                      {renderCampaignInsightPagination('sales-suggestions', pagedSalesSuggestions.total)}
                    </section>

                    <section className="campaign-dashboard-card campaign-data-section campaign-signals-table campaign-insight-panel campaign-insight-signal-panel">
                      <div className="campaign-insight-panel-head">
                        <h4>Satış ve marj sinyalleri</h4>
                        <span>{formatNumber(salesInsightCards.length)} kayıt</span>
                      </div>
                      {salesInsightCards.length ? (
                        <div className="table-wrapper campaign-insight-table-wrap">
                          <table className="data-table campaign-active-table campaign-standard-table campaign-insight-table campaign-insight-signal-table">
                            <thead>
                              <tr>
                                <th>Ürün</th>
                                <th>Sinyal</th>
                                <th>Günlük satış</th>
                                <th>Stok</th>
                                <th>Tahmini stok tükenme</th>
                                <th>Brüt marj</th>
                                <th>Öneri</th>
                                <th>İşlem</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pagedSalesSignals.pageRows.map((row) => (
                                <tr key={row.id}>
                                  <td className="campaign-insight-product-cell">
                                    <strong>{row.productName}</strong>
                                    <small>{formatCampaignMetaLine(row.category || 'Kategori yok', row.brand || row.supplierName || 'Marka yok', row.sectionName && row.sectionName !== '-' ? row.sectionName : '')}</small>
                                    <span>{row.summary}</span>
                                  </td>
                                  <td><span className={`campaign-signal-pill ${getCampaignToneClass(row.riskLevel)}`}>{row.signalType}</span></td>
                                  <td className="campaign-insight-metric-cell">{formatCampaignDailySales(row.salesVelocity)}</td>
                                  <td className="campaign-insight-metric-cell">{formatNumber(row.stockLevel)} adet</td>
                                  <td className="campaign-insight-metric-cell">{row.stockCoverageDays}</td>
                                  <td className="campaign-insight-metric-cell">%{formatNumber(row.currentMarginPercent || 0)}</td>
                                  <td><span className={`campaign-action-pill ${getCampaignActionTone(row.recommendation)}`}>{row.recommendation}</span></td>
                                  <td className="table-cell-actions">
                                    <button type="button" className="ghost-button" onClick={() => setSelectedCampaignSuggestion({
                                      id: `sales-inline-${row.id}`,
                                      title: `${row.productName} için aksiyon önerisi`,
                                      reason: row.summary,
                                      affectedProductCount: 1,
                                      recommendedDiscount: Math.max(8, Number(row?.suggestedDiscount || 12)),
                                      type: 'product',
                                      productIds: [row.productId || row.id],
                                      priority: row.riskLevel || 'medium',
                                      impactSummary: row.recommendation,
                                      riskSummary: 'Aksiyon öncesi marj ve stok yeterliliği tekrar kontrol edilmelidir.',
                                    })}>Detay analizi</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="campaign-empty-state-box">
                          <p>Filtrelere uyan satış sinyali yok.</p>
                          <span>Kategori veya marj filtresini gevşeterek listeyi yeniden oluşturun.</span>
                        </div>
                      )}
                      {renderCampaignInsightPagination('sales-signals', pagedSalesSignals.total)}
                    </section>
                  </div>
                </section>
                ) : null}

                {false && (campaignTypeView === 'expiry' || campaignTypeView === 'sales') ? renderSingleCampaignModuleTable({
                  icon: campaignTypeView === 'expiry' ? CalendarDays : TrendingUp,
                  iconClassName: campaignTypeView === 'expiry' ? 'mod-icon-amber' : 'mod-icon-indigo',
                  title: CAMPAIGN_MODULE_SINGLE_TABLE_TITLES[campaignTypeView] || 'Kampanya Listesi',
                  description: 'Aktif ve pasif kampanyalar bu modül için tek tabloda birlikte listelenir.',
                  rows: moduleCampaignRows,
                  tableKeyPrefix: campaignTypeView,
                  sectionClassName: 'campaign-section',
                }) : null}
              </div>
            </div>

            {isHomeCampaignView ? (
              <div className="campaign-table-stack campaign-table-stack--home" aria-label="Kampanya listeleri">
                <div className="mod-card-header">
                  <div className="mod-card-icon mod-icon-green"><ShieldCheck size={18} /></div>
                  <div>
                    <h3>Kampanya Listesi</h3>
                    <p>Aktif kampanyalar ve kampanya arşivi ayrı tablolarla izlenir.</p>
                  </div>
                </div>
                <div className="campaign-table-stack">
                  {renderCampaignTable({
                    title: CAMPAIGN_TABLE_SECTION_META.all.active.title,
                    description: CAMPAIGN_TABLE_SECTION_META.all.active.description,
                    rows: activeCampaignRows,
                    tableKey: 'home-active',
                    mode: 'active',
                    sectionMeta: CAMPAIGN_TABLE_SECTION_META.all.active,
                  })}
                  {renderCampaignTable({
                    title: 'Planlanan Kampanyalar',
                    description: 'İleri başlangıç tarihli kampanyalar burada görünür; başlangıç tarihine kadar fiyatlara yansımaz.',
                    rows: plannedCampaignRows,
                    tableKey: 'home-planned',
                    mode: 'planned',
                    sectionMeta: CAMPAIGN_TABLE_SECTION_META.all.active,
                    emptyTitle: 'Planlanan kampanya yok',
                    emptyDescription: 'İleri tarihli kampanya kaydı bulunmuyor.',
                  })}
                  {renderCampaignTable({
                    title: CAMPAIGN_TABLE_SECTION_META.all.archive.title,
                    description: CAMPAIGN_TABLE_SECTION_META.all.archive.description,
                    rows: archiveCampaignRows,
                    tableKey: 'home-archive',
                    mode: 'archive',
                    sectionMeta: CAMPAIGN_TABLE_SECTION_META.all.archive,
                  })}
                </div>
              </div>
            ) : null}

          </>
        ) : (
        <>
          <div className="settings-layout">
            <div className="settings-col settings-col-left">
            <section className="s-card s-settings-category-card s-store-category-card">
              <div className="s-card-header">
                <div className="s-card-icon s-icon-blue"><Building size={18} /></div>
                <div className="s-card-header-copy">
                  <h3 className="s-card-title">Mağaza</h3>
                  <p className="s-card-desc">Mağaza kimliği, iletişim bilgileri ve Çalışma düzeni</p>
                </div>
              </div>

              <h4 className="s-category-subtitle">Temel Bilgiler</h4>
              <div className="s-field-grid s-store-basic-grid">
                <label className="s-field">
                  <span className="s-field-label"><Building size={14} /> Mağaza Adı</span>
                  <input type="text" value={form.storeName} placeholder="Shelfio Market" readOnly className="s-field-readonly" />
                </label>
                <label className="s-field">
                  <span className="s-field-label"><Hash size={14} /> Şube Kodu</span>
                  <input type="text" value={form.branchCode} placeholder="SHF-001" readOnly className="s-field-readonly" />
                </label>
                <label className="s-field">
                  <span className="s-field-label"><Phone size={14} /> Telefon</span>
                  <input type="tel" value={form.storePhone} placeholder="+90 555 000 00 00" readOnly className="s-field-readonly" />
                </label>
                <label className="s-field">
                  <span className="s-field-label"><Mail size={14} /> E-posta</span>
                  <input type="email" value={form.storeEmail} placeholder={SUPPORT_CONTACT.email} readOnly className="s-field-readonly" />
                </label>
                <label className="s-field s-store-tax-field">
                  <span className="s-field-label"><Hash size={14} /> Vergi No</span>
                  <input type="text" value={form.taxNumber} placeholder="1234567890" readOnly className="s-field-readonly" />
                </label>
                <label className="s-field s-store-address-field">
                  <span className="s-field-label"><MapPin size={14} /> Adres</span>
                  <input type="text" value={form.storeAddress} placeholder="İstanbul / Türkiye" readOnly className="s-field-readonly" />
                </label>
              </div>

              <h4 className="s-category-subtitle s-hours-subtitle">Çalışma Saatleri</h4>
              <div className="s-work-hours-compact s-work-hours-minimal">
                <div className="s-day-summary-strip" role="tablist" aria-label="Gün seçimi">
                  {weeklyScheduleRows.map((row) => {
                    const dayLabel = DAYS.find((day) => day.key === row.dayKey)?.short || row.dayKey;
                    const isActive = selectedScheduleDay === row.dayKey;
                    const statusText = row.isClosed ? 'Kapalı' : `${row.opensAt} - ${row.closesAt}`;
                    return (
                      <button
                        type="button"
                        key={row.dayKey}
                        role="tab"
                        aria-selected={isActive}
                        className={`s-day-chip ${isActive ? 'is-active' : ''} ${row.isClosed ? 'is-closed' : 'is-open'}`}
                        onClick={() => setSelectedScheduleDay(row.dayKey)}
                        title={`${dayLabel}: ${statusText}`}
                      >
                        <span className="s-day-chip-head">
                          <span className="s-day-chip-label">{dayLabel}</span>
                          <span className="s-day-chip-dot" aria-hidden="true" />
                        </span>
                        <span className="s-day-chip-meta">{row.isClosed ? 'Kapalı' : `${row.opensAt} - ${row.closesAt}`}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="s-hours-ops-grid s-hours-ops-grid-compact" style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-start', marginTop: '12px', padding: '6px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#ffffff', overflowX: 'auto' }}>
                  <div className="s-selected-day-fields-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '10px', whiteSpace: 'nowrap' }}>
                    {selectedScheduleRow ? (
                      <div className="s-selected-day-fields s-selected-day-fields-compact s-selected-day-fields-row" style={{ display: 'flex', gap: '8px', alignItems: 'center', margin: 0, padding: 0 }}>
                        <label className="s-field s-field-inline s-field-inline-compact" style={{ margin: 0, display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
                          <span className="s-field-label">Açılış</span>
                          <input
                            type="time"
                            value={selectedScheduleRow.opensAt}
                            onChange={(event) => handleWeeklyScheduleChange(selectedScheduleRow.dayKey, 'opensAt', event.target.value)}
                            disabled={!isAdmin || isLoading || selectedScheduleRow.isClosed}
                            className="s-hour-input s-hour-input-compact"
                            style={{ width: '130px', minWidth: '130px', height: '34px', padding: '0 8px', fontSize: '0.88rem', boxSizing: 'border-box' }}
                          />
                        </label>

                        <label className="s-field s-field-inline s-field-inline-compact" style={{ margin: 0, display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
                          <span className="s-field-label">Kapanış</span>
                          <input
                            type="time"
                            value={selectedScheduleRow.closesAt}
                            onChange={(event) => handleWeeklyScheduleChange(selectedScheduleRow.dayKey, 'closesAt', event.target.value)}
                            disabled={!isAdmin || isLoading || selectedScheduleRow.isClosed}
                            className="s-hour-input s-hour-input-compact"
                            style={{ width: '130px', minWidth: '130px', height: '34px', padding: '0 8px', fontSize: '0.88rem', boxSizing: 'border-box' }}
                          />
                        </label>

                        <label className={`s-advanced-closed-toggle s-advanced-closed-toggle-compact s-hours-closed-inline ${selectedScheduleRow.isClosed ? 'is-closed' : 'is-open'}`} style={{ alignSelf: 'center', margin: 0, height: '36px', display: 'inline-flex', alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={selectedScheduleRow.isClosed}
                            onChange={() => toggleWeeklyClosedDay(selectedScheduleRow.dayKey)}
                            disabled={!isAdmin || isLoading}
                          />
                          <span>{selectedScheduleRow.isClosed ? 'Kapalı' : 'Açık'}</span>
                        </label>
                      </div>
                    ) : (
                      <div className="s-hours-ops-empty" style={{ padding: '8px 0', fontSize: '0.82rem', color: '#64748b' }}>Saat ayarı için bir gün seçin.</div>
                    )}

                    <div className="s-config-item s-holiday-mode-item s-holiday-mode-item-compact s-holiday-mode-item-inline" style={{ display: 'flex', alignItems: 'center', height: '36px', gap: '10px', margin: 0, padding: '0 0 0 16px', background: 'transparent', border: 'none', borderLeft: '1px solid #cbd5e1', borderRadius: 0 }}>
                      <span className="s-config-label s-automation-title" style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>Tatil Modu</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(form.holidayMode)}
                        className={`s-automation-toggle ${form.holidayMode ? 'is-active' : 'is-passive'} ${!isAdmin || isLoading ? 'is-disabled' : ''}`}
                        onClick={() => {
                          if (!isAdmin || isLoading) return;
                          setForm((current) => ({ ...current, holidayMode: !current.holidayMode }));
                        }}
                        disabled={!isAdmin || isLoading}
                        style={{ margin: 0, transform: 'scale(0.9)', transformOrigin: 'left center' }}
                      >
                        <span className="s-automation-track" aria-hidden="true"><span className="s-automation-knob" /></span>
                        <span className="s-automation-state" style={{ fontSize: '11px' }}>{form.holidayMode ? 'Aktif' : 'Pasif'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="s-special-days-header s-special-days-header-inline" style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0, whiteSpace: 'nowrap' }}>
                    <button type="button" className="s-special-days-collapse-btn" onClick={() => setSpecialDayListModalOpen(true)} style={{ height: '30px', padding: '0 10px', fontSize: '0.79rem', fontWeight: 600, borderRadius: '8px', border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer' }}>Özel Günleri Göster</button>
                    <button type="button" className="s-audit-btn" onClick={addSpecialDay} disabled={!isAdmin || isLoading} style={{ height: '30px', padding: '0 10px', fontSize: '0.79rem', fontWeight: 600, borderRadius: '8px', border: '1px solid #2563eb', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Plus size={13} /> Özel Gün Ekle</button>
                  </div>
                </div>
              </div>
            </section>

            <section className="s-card s-settings-category-card s-operation-category-card">
              <div className="s-card-header">
                <div className="s-card-icon s-icon-violet"><Megaphone size={18} /></div>
                <div className="s-card-header-copy">
                  <h3 className="s-card-title">Operasyon</h3>
                  <p className="s-card-desc">Para birimi ve temel operasyon bilgileri</p>
                </div>
              </div>

              <div className="s-config-grid">
                <div className="s-config-item">
                  <span className="s-config-label">Para Birimi</span>
                  <select name="currency" value="TRY" disabled className="s-config-select">
                    <option value="TRY">₺ TRY</option>
                  </select>
                </div>

                <div className="s-config-item s-config-item-updated">
                  <span className="s-config-label">Son Güncelleme</span>
                  <span className="s-config-value">{updatedAt ? formatDate(updatedAt) : '—'}</span>
                </div>
              </div>
            </section>

            </div>
            <div className="settings-col settings-col-right">
            <section className="s-card s-settings-category-card s-sound-settings-card s-notification-category-card">
              <div className="s-card-header">
                <div className="s-card-icon s-icon-cyan"><Settings2 size={18} /></div>
                <div className="s-card-header-copy">
                  <h3 className="s-card-title">Bildirimler</h3>
                  <p className="s-card-desc">Bildirim görünürlüğü, ses seviyesi ve test kontrolü</p>
                </div>
              </div>

              <div className="s-config-grid">
                <div className="s-config-item s-sound-settings-item">
                  <div className="s-automation-content">
                    <span className="s-config-label s-automation-title">Bildirimler</span>
                    <span className="s-automation-desc">Sistem bildirimlerinin size gösterilmesini açıp kapatın</span>
                  </div>
                  <div className="s-sound-toggle-actions">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notificationSoundEnabled}
                      className={`s-automation-toggle ${notificationSoundEnabled ? 'is-active' : 'is-passive'}`}
                      onClick={() => setNotificationSoundEnabled((current) => !current)}
                    >
                      <span className="s-automation-track" aria-hidden="true">
                        <span className="s-automation-knob" />
                      </span>
                      <span className="s-automation-state">{notificationSoundEnabled ? 'Açık' : 'Kapalı'}</span>
                    </button>
                  </div>
                </div>

                <div className="s-config-item s-sound-volume-item">
                  <span className="s-config-label">Bildirim Ses Seviyesi</span>
                  <div className="s-sound-volume-control">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={notificationSoundVolume}
                      onChange={(event) => setNotificationSoundVolume(clampSoundVolume(event.target.value))}
                      disabled={!notificationSoundEnabled}
                    />
                    <strong className="s-sound-volume-value">%{clampSoundVolume(notificationSoundVolume)}</strong>
                    <button type="button" className="s-audit-btn s-sound-test-btn" onClick={handlePreviewNotificationSound}>
                      <Settings2 size={14} /> Bildirimi Test Et
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {isAdmin && (
              <section className="s-card s-settings-category-card s-security-card s-security-category-card">
                <div className="s-card-header">
                  <div className="s-card-icon s-icon-red"><Shield size={18} /></div>
                  <div className="s-card-header-copy">
                    <h3 className="s-card-title">Güvenlik</h3>
                    <p className="s-card-desc">Sistem PIN yönetimi ve giriş kontrolü ayarları</p>
                  </div>
                </div>

                <div className="s-config-item s-security-summary-item">
                  <div className="s-security-control-inline">
                    <span className="s-config-label s-security-control-title">Giriş Kontrolü</span>
                    <span className="s-security-control-desc">Hassas güvenlik alanlarına erişim PIN doğrulaması ile korunur.</span>
                  </div>
                  {securityUnlocked && (
                    <button
                      type="button"
                      className={`s-security-edit-toggle ${securityEditMode ? 'is-active' : ''}`}
                      onClick={handleToggleSecurityEditMode}
                      disabled={isAnyPinSaving}
                      aria-pressed={securityEditMode}
                    >
                      {securityEditMode ? <Lock size={15} /> : <LockOpen size={15} />}
                      {securityEditMode ? 'Kilitle' : 'Kilidi Aç'}
                    </button>
                  )}
                </div>

                {!securityUnlocked ? (
                  <div className="s-security-locked">
                    <Lock size={20} />
                    <div>
                      <strong>Güvenlik alanı kilitli</strong>
                      <span>Sistem kasa PIN kodlarını görüntülemek veya değiştirmek için doğrulama gereklidir.</span>
                    </div>
                    <button className="s-security-unlock-btn" type="button" onClick={() => setShowPinGate(true)}>
                      <KeyRound size={16} /> Kilidi Aç
                    </button>
                  </div>
                ) : (
                  <div className="s-security-content">
                    <div className="s-system-pin-list">
                      <div className="s-system-pin-row">
                        <div className="s-system-pin-main">
                          <span className="s-system-pin-title">Sistem PIN Yönetimi PIN</span>
                          <div className="s-pin-display">
                            <span className="s-pin-value">{showSystemManagementPin ? systemManagementPin : '?'.repeat(systemManagementPin.length || 4)}</span>
                            <button
                              className="s-pin-toggle"
                              type="button"
                              onClick={() => setShowSystemManagementPin((current) => !current)}
                              aria-label={showSystemManagementPin ? 'Sistem PIN Yönetimi PIN gizle' : 'Sistem PIN Yönetimi PIN göster'}
                            >
                              {showSystemManagementPin ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                        </div>

                        <div className="s-pin-change s-system-pin-change">
                          <label className="s-pin-input-wrap">
                            <span className="s-pin-input-label">Yeni PIN</span>
                            <input
                              type={showSystemManagementPin ? 'text' : 'password'}
                              inputMode="numeric"
                              maxLength={4}
                              value={newSystemManagementPin}
                              onChange={(event) => {
                                const nextValue = String(event.target.value || '').replace(/\D/g, '').slice(0, 4);
                                setNewSystemManagementPin(nextValue);
                                setSystemManagementPinError('');
                              }}
                              placeholder={securityEditMode ? '4 haneli' : 'Önce kilidi açın'}
                              disabled={!securityEditMode || savingSystemManagementPin}
                            />
                          </label>

                          <button
                            className="s-pin-save-btn"
                            type="button"
                            onClick={handleUpdateSystemManagementPin}
                            disabled={!securityEditMode || savingSystemManagementPin}
                          >
                            {savingSystemManagementPin ? 'Kaydediliyor...' : 'Güncelle'}
                          </button>
                        </div>

                        {systemManagementPinError ? <span className="s-system-pin-error">{systemManagementPinError}</span> : null}
                      </div>

                      <div className="s-system-pin-row">
                        <div className="s-system-pin-main">
                          <span className="s-system-pin-title">Personel Yönetimi PIN</span>
                          <div className="s-pin-display">
                            <span className="s-pin-value">{showRoleManagementPin ? roleManagementPin : '?'.repeat(roleManagementPin.length || 4)}</span>
                            <button
                              className="s-pin-toggle"
                              type="button"
                              onClick={() => setShowRoleManagementPin((current) => !current)}
                              aria-label={showRoleManagementPin ? 'Personel Yönetimi PIN gizle' : 'Personel Yönetimi PIN göster'}
                            >
                              {showRoleManagementPin ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                        </div>

                        <div className="s-pin-change s-system-pin-change">
                          <label className="s-pin-input-wrap">
                            <span className="s-pin-input-label">Yeni PIN</span>
                            <input
                              type={showRoleManagementPin ? 'text' : 'password'}
                              inputMode="numeric"
                              maxLength={4}
                              value={newRoleManagementPin}
                              onChange={(event) => {
                                const nextValue = String(event.target.value || '').replace(/\D/g, '').slice(0, 4);
                                setNewRoleManagementPin(nextValue);
                                setRoleManagementPinError('');
                              }}
                              placeholder={securityEditMode ? '4 haneli' : 'Önce kilidi açın'}
                              disabled={!securityEditMode || savingRoleManagementPin}
                            />
                          </label>

                          <button
                            className="s-pin-save-btn"
                            type="button"
                            onClick={handleUpdateRoleManagementPin}
                            disabled={!securityEditMode || savingRoleManagementPin}
                          >
                            {savingRoleManagementPin ? 'Kaydediliyor...' : 'Güncelle'}
                          </button>
                        </div>

                        {roleManagementPinError ? <span className="s-system-pin-error">{roleManagementPinError}</span> : null}
                      </div>
                    </div>

                    <div className="s-system-pin-list">
                      {SYSTEM_DESK_ROWS.map((row) => {
                        const currentPin = deskPins[row.code] || '1234';
                        const nextPin = newDeskPins[row.code] || '';
                        const showPin = Boolean(showDeskPins[row.code]);
                        const rowError = pinErrors[row.code] || '';
                        const isSavingRow = savingDeskCode === row.code;

                        return (
                          <div className="s-system-pin-row" key={row.code}>
                            <div className="s-system-pin-main">
                              <span className="s-system-pin-title">{row.label}</span>
                              <div className="s-pin-display">
                                <span className="s-pin-value">{showPin ? currentPin : '?'.repeat(currentPin.length || 4)}</span>
                                <button
                                  className="s-pin-toggle"
                                  type="button"
                                  onClick={() => setShowDeskPins((current) => ({ ...current, [row.code]: !current[row.code] }))}
                                  aria-label={showPin ? `${row.label} gizle` : `${row.label} göster`}
                                >
                                  {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                              </div>
                            </div>

                            <div className="s-pin-change s-system-pin-change">
                              <label className="s-pin-input-wrap">
                                <span className="s-pin-input-label">Yeni PIN</span>
                                <input
                                  type={showPin ? 'text' : 'password'}
                                  inputMode="numeric"
                                  maxLength={4}
                                  value={nextPin}
                                  onChange={(event) => handleDeskPinInput(row.code, event.target.value)}
                                  placeholder={securityEditMode ? '4 haneli' : 'Önce kilidi açın'}
                                  disabled={!securityEditMode || isSavingRow}
                                />
                              </label>

                              <button
                                className="s-pin-save-btn"
                                type="button"
                                onClick={() => handleUpdateDeskPin(row.code)}
                                disabled={!securityEditMode || isSavingRow}
                              >
                                {isSavingRow ? 'Kaydediliyor...' : 'Güncelle'}
                              </button>
                            </div>

                            {rowError ? <span className="s-system-pin-error">{rowError}</span> : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            )}
          {isAdmin && (
              <section className="s-card s-card-right-compact s-activity-log-wrapper-card">
                <div className="s-card-header">
                  <div className="s-card-icon s-icon-slate"><BarChart3 size={18} /></div>
                  <div className="s-card-header-copy">
                    <h3 className="s-card-title">İzleme ve Log Kayıtları</h3>
                    <p className="s-card-desc">Giriş aktiviteleri, audit kayıtları ve teknik log detayları</p>
                  </div>
                </div>

                <div className="s-activity-log-toolbar">
                  <div className="s-activity-log-tabs" role="tablist" aria-label="Log sekmeleri">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activityLogTab === 'activity'}
                      className={`s-activity-log-tab ${activityLogTab === 'activity' ? 'is-active' : ''}`}
                      onClick={() => setActivityLogTab('activity')}
                    >
                      {formatTabCount('Aktivite', loginActivitiesTotal)}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activityLogTab === 'audit'}
                      className={`s-activity-log-tab ${activityLogTab === 'audit' ? 'is-active' : ''}`}
                      onClick={() => setActivityLogTab('audit')}
                    >
                      {formatTabCount('Audit', auditLogsTotal)}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activityLogTab === 'developer'}
                      className={`s-activity-log-tab ${activityLogTab === 'developer' ? 'is-active' : ''}`}
                      onClick={() => setActivityLogTab('developer')}
                    >
                      {formatTabCount('Geliştirici', developerLogsTotal)}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="s-activity-collapse-btn"
                    onClick={() => setActivityLogCollapsed((current) => !current)}
                    aria-expanded={!activityLogCollapsed}
                  >
                    {activityLogCollapsed ? 'Logları Genişlet' : 'Logları Daralt'}
                  </button>
                </div>

                {!activityLogCollapsed && (
                  <div className="s-activity-log-stack">
                    {activityLogTab === 'activity' && (
                      <section className="s-activity-log-block s-login-activity-card">
                        <div className="s-card-header s-card-header-tight">
                          <div className="s-card-icon s-icon-slate"><ShieldCheck size={18} /></div>
                          <div className="s-card-header-copy">
                            <h3 className="s-card-title">Son Giriş Aktiviteleri</h3>
                            <p className="s-card-desc">Sisteme yapılan başarılı girişler ve cihaz bilgileri</p>
                          </div>
                          <div className="s-login-activity-actions">
                            <button type="button" className="s-audit-btn" onClick={openLoginActivityManagerModal}>
                              Detay
                            </button>
                            <button
                              type="button"
                              className="s-audit-btn s-audit-btn-icon s-audit-btn-danger"
                              onClick={() => { void handleClearLogRecords('activity'); }}
                              aria-label="Detay içeriğini temizle"
                              title="Detay içeriğini temizle"
                            >
                              <Eraser size={14} />
                            </button>
                          </div>
                        </div>

                        {loginActivities.length ? (
                          <div className="s-login-activity-list">
                            {loginActivities.map((activity) => {
                              const { os, browser } = parseUserAgentInfo(activity);
                              const loginDate = resolveLoginActivityDate(activity);
                              return (
                                <article className="s-login-activity-item" key={activity.id}>
                                  <div className="s-login-activity-main">
                                    <strong>{activity.userName || 'Kullanıcı'}</strong>
                                    <span>Kullanıcı Adı: {activity.username || '-'}</span>
                                    <span>Sicil No: {activity.registerPin || '-'}</span>
                                    <span>Giriş Saati: {formatDateTime(loginDate)}</span>
                                  </div>
                                  <div className="s-login-activity-meta">
                                    <span>IP: {activity.ipAddress || activity.ip || 'IP yok'}</span>
                                    <span>İşletim Sistemi: {os}</span>
                                    <span>Tarayıcı: {browser}</span>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="s-empty-state">Henüz kayıtlı giriş aktivitesi bulunmuyor.</div>
                        )}
                      </section>
                    )}

                    {activityLogTab === 'audit' && (
                      <section className="s-activity-log-block s-audit-log-card">
                        <div className="s-card-header s-card-header-tight">
                          <div className="s-card-icon s-icon-slate"><Shield size={18} /></div>
                          <div className="s-card-header-copy">
                            <h3 className="s-card-title">Audit Log</h3>
                            <p className="s-card-desc">Yapılan kritik ayar değişikliklerini izleyin</p>
                          </div>
                          <div className="s-login-activity-actions">
                            <button type="button" className="s-audit-btn" onClick={openAuditLogManagerModal}>
                              Detay
                            </button>
                            <button
                              type="button"
                              className="s-audit-btn s-audit-btn-icon s-audit-btn-danger"
                              onClick={() => { void handleClearLogRecords('audit'); }}
                              aria-label="Detay içeriğini temizle"
                              title="Detay içeriğini temizle"
                            >
                              <Eraser size={14} />
                            </button>
                          </div>
                        </div>

                        {auditLogs.length ? (
                          <div className="s-audit-log-list">
                            {auditLogs.slice(0, 16).map((log) => (
                              <article className="s-audit-log-item" key={log.id}>
                                <div className="s-audit-log-main">
                                  <strong>{log.actionLabel || log.action || 'Ayar işlemi'}</strong>
                                  <span>{log.actorName || 'Sistem'}</span>
                                </div>
                                <div className="s-audit-log-meta">
                                  <time dateTime={log.createdAt}>{formatDateTime(log.createdAt)}</time>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <div className="s-empty-state">Henüz audit log kaydı bulunmuyor.</div>
                        )}
                      </section>
                    )}

                    {activityLogTab === 'developer' && (
                      <section className="s-activity-log-block s-developer-log-card">
                        <div className="s-card-header s-card-header-tight">
                          <div className="s-card-icon s-icon-slate"><FileText size={18} /></div>
                          <div className="s-card-header-copy">
                            <h3 className="s-card-title">Geliştirici Logları</h3>
                            <p className="s-card-desc">Sistem hatalarını ve teknik logları buradan izleyin.</p>
                          </div>
                          <div className="s-login-activity-actions">
                            <button
                              type="button"
                              className="s-audit-btn"
                              onClick={openDeveloperLogManagerModal}
                            >
                              Detay
                            </button>
                            <button
                              type="button"
                              className="s-audit-btn s-audit-btn-icon s-audit-btn-danger"
                              onClick={() => { void handleClearLogRecords('developer'); }}
                              aria-label="Detay içeriğini temizle"
                              title="Detay içeriğini temizle"
                            >
                              <Eraser size={14} />
                            </button>
                          </div>
                        </div>

                        <div className="s-devlog-summary-row">
                          <div className="s-devlog-summary-item">
                            <span>Toplam Kayıt</span>
                            <strong>{Number.isFinite(developerLogsTotal) ? formatNumber(developerLogsTotal) : '-'}</strong>
                          </div>
                          <div className="s-devlog-summary-item">
                            <span>Son Kayıt</span>
                            <strong>{developerLogs[0]?.timestamp ? formatDateTime(developerLogs[0].timestamp) : '-'}</strong>
                          </div>
                        </div>

                      </section>
                    )}
                  </div>
                )}
              </section>
            )}

            </div>
          </div>
        </>
        )}

        {!isCampaignPage ? (
        <div className="s-save-indicator-wrap">
          <button
            className={`s-save-indicator ${isDirty ? 'is-active' : ''}`}
            type="button"
            disabled={!isAdmin || isLoading || isSaving || !isDirty}
            onClick={() => { void handleSaveAction(); }}
            aria-label={isSaving ? 'Değişiklikler kaydediliyor' : isDirty ? 'Değişiklikleri kaydet' : 'Kaydedilecek değişiklik yok'}
            title={isSaving ? 'Kaydediliyor...' : isDirty ? 'Değişiklikleri kaydet' : 'Kaydedilecek değişiklik yok'}
            aria-busy={isSaving}
          >
            <Save size={16} />
          </button>
        </div>
        ) : null}
      </form>

      <FormModal
        isOpen={Boolean(selectedCampaignSuggestion)}
        title={normalizeCampaignInsightText(selectedCampaignSuggestion?.title || 'Kampanya Öneri Detayı')}
        description="Önerinin veri sinyallerini, beklenen etkiyi ve karar senaryolarını inceleyin."
        headerIcon={<Megaphone size={16} />}
        onClose={() => setSelectedCampaignSuggestion(null)}
        modalClassName="product-form-fit-modal campaign-suggestion-detail-modal"
        confirmOnDirtyClose={false}
      >
        {selectedCampaignSuggestion ? (
          <>
          <div className="campaign-detail-modal-body">
            <section className="campaign-detail-section">
              <h4>Neden bu öneri çıktı?</h4>
              <p>{normalizeCampaignInsightText(selectedCampaignSuggestion.reason)}</p>
            </section>
            <section className="campaign-detail-section campaign-detail-section--metric-cards" aria-label="Kampanya önerisi metrikleri">
              <div className="campaign-suggestion-metric-grid">
                <div className="campaign-suggestion-metric-card is-products">
                  <span className="campaign-suggestion-metric-icon" aria-hidden="true"><PackageSearch size={16} /></span>
                  <span>Etkilenen ürün</span>
                  <strong>{formatNumber(selectedCampaignSuggestion.affectedProductCount)}</strong>
                </div>
                <div className="campaign-suggestion-metric-card is-discount">
                  <span className="campaign-suggestion-metric-icon" aria-hidden="true"><Percent size={16} /></span>
                  <span>Önerilen indirim</span>
                  <strong>%{formatNumber(selectedCampaignSuggestion.recommendedDiscount)}</strong>
                </div>
                <div className="campaign-suggestion-metric-card is-priority">
                  <span className="campaign-suggestion-metric-icon" aria-hidden="true"><AlertTriangle size={16} /></span>
                  <span>Öncelik seviyesi</span>
                  <strong>{getCampaignPriorityDisplayLabel(selectedCampaignSuggestion.priority)}</strong>
                </div>
                <div className="campaign-suggestion-metric-card is-type">
                  <span className="campaign-suggestion-metric-icon" aria-hidden="true"><BadgePercent size={16} /></span>
                  <span>Kampanya tipi</span>
                  <strong>{normalizeCampaignInsightText(CAMPAIGN_TYPE_LABELS[selectedCampaignSuggestion.type] || selectedCampaignSuggestion.type)}</strong>
                </div>
              </div>
            </section>
            <section className="campaign-detail-section">
              <h4>Ürünler neden seçildi?</h4>
              <ul>
                {(Array.isArray(selectedCampaignSuggestion.signalBullets) && selectedCampaignSuggestion.signalBullets.length ? selectedCampaignSuggestion.signalBullets : [
                  'Satış hızı düşük ve stok bekleme riski yüksek ürünler seçildi.',
                  'Mevcut aktif kampanyalarla isim çakışması kontrol edildi.',
                  'Önerilen indirim oranı kampanya simülasyonuna başlangıç değeri olarak aktarılır.',
                ]).map((item) => <li key={item}>{normalizeCampaignInsightText(item)}</li>)}
              </ul>
            </section>
            <section className="campaign-detail-section campaign-detail-section--signals">
              <h4>Operasyonel sinyaller</h4>
              <div className="campaign-detail-grid">
                <div><span>Ortalama günlük satış</span><strong>{formatNumber(averageCampaignMetric(selectedSuggestionRows, (row) => Number(row?.salesVelocity || 0)))} adet</strong></div>
                <div><span>Ortalama stok</span><strong>{formatNumber(averageCampaignMetric(selectedSuggestionRows, (row) => Number(row?.stockLevel || 0)))} adet</strong></div>
                <div><span>Stok baskısı</span><strong>{formatNumber(selectedSuggestionRows.filter((row) => Number(row?.stockLevel || 0) > Math.max(20, Number(row?.salesVelocity || 0) * 21)).length)} ürün</strong></div>
                <div><span>Ortalama brüt marj</span><strong>%{formatNumber(averageCampaignMetric(selectedSuggestionRows, (row) => Number(row?.currentMarginPercent || 0)))}</strong></div>
              </div>
            </section>
            <section className="campaign-detail-section">
              <h4>Beklenen sonuç</h4>
              {(() => {
                const hasSuggestionSimulationData = selectedSuggestionDiscountSimulation?.hasEnoughSalesData !== false
                  && selectedSuggestionDiscountSimulation?.dataQuality?.status !== 'insufficient_data';
                const formatSuggestionPercent = (value) => {
                  if (!hasSuggestionSimulationData || value === null || value === undefined) return 'Yeterli satış verisi yok';
                  const numeric = Number(value);
                  return Number.isFinite(numeric) ? `%${formatNumber(numeric)}` : 'Hesaplanamadı';
                };
                const formatSuggestionMoney = (value) => {
                  if (!hasSuggestionSimulationData || value === null || value === undefined) return 'Yeterli satış verisi yok';
                  const numeric = Number(value);
                  return Number.isFinite(numeric) ? formatCurrency(numeric, form.currency) : 'Hesaplanamadı';
                };
                return (
                  <div className="campaign-detail-grid campaign-detail-grid--decision">
                    <div><span>Satış etkisi</span><strong>{formatSuggestionPercent(selectedSuggestionDiscountSimulation?.salesIncreasePct)}</strong></div>
                    <div><span>Ciro etkisi</span><strong>{formatSuggestionMoney(selectedSuggestionDiscountSimulation?.revenueChange)}</strong></div>
                    <div><span>Marj etkisi</span><strong>{formatSuggestionPercent(selectedSuggestionDiscountSimulation?.marginImpact)}</strong></div>
                    <div><span>Stok devir etkisi</span><strong>{formatSuggestionPercent(selectedSuggestionDiscountSimulation?.stockTurnEffect)}</strong></div>
                  </div>
                );
              })()}
            </section>
          </div>
          <div className="modal-actions campaign-form-actions campaign-detail-modal-footer">
            <button type="button" className="primary-button" onClick={() => createCampaignFromSuggestion(selectedCampaignSuggestion)}>
              Kampanya Oluştur
            </button>
            <button type="button" className="outline-button" onClick={() => setSelectedCampaignSuggestion(null)}>
              Kapat
            </button>
          </div>
          </>
        ) : null}
      </FormModal>

      <FormModal
        isOpen={Boolean(selectedCampaignDetail)}
        title={selectedCampaignDetail?.__viewMode === 'edit' ? (selectedCampaignDetail?.name || 'Kampanya Düzenle') : (selectedCampaignDetail?.name || 'Kampanya Detayı')}
        description={selectedCampaignDetail?.__viewMode === 'edit' ? 'Kampanya bilgilerini bu modal içinden güncelleyin.' : 'Kampanya kapsamı, tarihleri ve durum bilgisi.'}
        headerIcon={<ShieldCheck size={16} />}
        onClose={() => (selectedCampaignDetail?.__viewMode === 'edit' ? closeCampaignEditModal() : setSelectedCampaignDetail(null))}
        modalClassName={`product-form-fit-modal campaign-suggestion-detail-modal campaign-detail-view-modal ${selectedCampaignDetail?.__viewMode === 'edit' ? 'campaign-edit-modal' : ''}`.trim()}
        confirmOnDirtyClose={false}
      >
        {selectedCampaignDetail ? (
          selectedCampaignDetail.__viewMode === 'edit' ? (
            <>
            <div className="campaign-detail-modal-body campaign-edit-modal-body">
              <section className="campaign-edit-grid">
                <div className="form-grid campaign-form-fields campaign-form-fields--three campaign-form-fields--general-info">
                  <label className="field-group"><span>Kampanya Adı</span><input type="text" value={campaignDraft.name} onChange={(event) => setCampaignDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Örn: Hafta Sonu Atıştırmalık" /></label>
                  <label className="field-group"><span>İndirim Oranı (%)</span><input type="number" min="1" max="80" value={campaignDraft.discountRate} onChange={(event) => setCampaignDraft((current) => ({ ...current, discountRate: event.target.value }))} /></label>
                  <label className="field-group"><span>Başlangıç Tarihi</span><input type="date" value={campaignDraft.startsAt} onChange={(event) => setCampaignDraft((current) => ({ ...current, startsAt: event.target.value }))} /></label>
                  <label className="field-group"><span>Bitiş Tarihi</span><input type="date" min={campaignDraft.startsAt || undefined} value={campaignDraft.isIndefinite ? '' : campaignDraft.endsAt} disabled={campaignDraft.isIndefinite} onChange={(event) => setCampaignDraft((current) => ({ ...current, endsAt: event.target.value }))} /></label>
                  <div className="field-group field-group--checkbox campaign-indefinite-field">
                    <label className={`campaign-toggle-inline ${campaignDraft.isIndefinite ? 'is-active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={campaignDraft.isIndefinite}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setCampaignDraft((current) => ({ ...current, isIndefinite: checked, endsAt: checked ? '' : current.endsAt }));
                        }}
                      />
                      <span className="campaign-toggle-switch" aria-hidden="true"><span className="campaign-toggle-knob" /></span>
                      <span>Süresiz</span>
                    </label>
                  </div>
                </div>
                {campaignDraftIsPlanned ? (
                  <div className="campaign-form-tip" role="status">
                    <strong>Planlandı</strong>
                    <span>Başlangıç: {formatCampaignDate(campaignDraft.startsAt)}. Henüz fiyatlara yansımaz.</span>
                  </div>
                ) : null}
              </section>

              {campaignEditScope === 'product' ? (
                <section className="campaign-edit-grid">
                  <div className="campaign-product-picker">
                    <div className="campaign-product-search-row">
                      <label className="field-group">
                        <span>Ürün ara</span>
                        <input type="search" value={productCampaignSearch} onChange={(event) => setProductCampaignSearch(event.target.value)} placeholder="Ürün adı, barkod veya SKU" />
                      </label>
                    </div>
                    <div className="campaign-product-results" aria-label="Ürün arama sonuçları">
                      {productCampaignSearchResults.length ? productCampaignSearchResults.map((product) => {
                        const productId = String(product.id || '');
                        const productLabel = String(product.name || product.productName || productId);
                        return (
                          <button key={productId} type="button" className="campaign-product-result" onClick={() => toggleCampaignProduct(productId)}>
                            <span>{productLabel}</span>
                            <small>{formatCampaignMetaLine(String(product.categoryName || product.category || 'Kategori yok'), String(product.brand || product.brandName || 'Marka yok'))}</small>
                            <Plus size={14} />
                          </button>
                        );
                      }) : (
                        productCampaignSearch ? (
                          <div className="campaign-product-search-empty">Eşleşen Ürün bulunamadı.</div>
                        ) : null
                      )}
                    </div>
                    <div className="campaign-selected-products" aria-label="Seçilen ürünler">
                      <div className="campaign-selected-products-head">
                        <strong>Seçilen ürünler</strong>
                        <span>{formatNumber(selectedCampaignProducts.length)} Ürün</span>
                      </div>
                      {selectedCampaignProducts.length ? (
                        <div className="campaign-selected-product-list">
                          {selectedCampaignProducts.map((product) => (
                            <span key={product.id} className="campaign-selected-product-chip">
                              {product.label}
                              <button type="button" onClick={() => toggleCampaignProduct(product.id)} aria-label={`${product.label} Ürününü kaldır`}>
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : <div className="campaign-product-search-empty">Henüz Ürün seçilmedi.</div>}
                    </div>
                  </div>
                </section>
              ) : null}

              {campaignEditScope === 'category' ? (
                <section className="campaign-edit-grid">
                  <div className="s-giftcard-category-grid">
                    {availableCategories.map((category) => {
                      const categoryId = String(category.id || '');
                      return (
                        <label key={categoryId} className={`s-giftcard-category-item ${campaignDraft.targetCategoryIds.includes(categoryId) ? 'is-selected' : ''}`}>
                          <input type="checkbox" checked={campaignDraft.targetCategoryIds.includes(categoryId)} onChange={() => toggleCampaignCategory(categoryId)} />
                          <span>{String(category.name || categoryId)}</span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {campaignEditScope === 'brand' ? (
                <section className="campaign-edit-grid">
                  <div className="campaign-product-picker campaign-brand-picker">
                    <div className="campaign-brand-toolbar">
                      <label className="field-group campaign-brand-search-field">
                        <span>Marka ara</span>
                        <input type="search" value={brandCampaignSearch} onChange={(event) => setBrandCampaignSearch(event.target.value)} placeholder="En az 2 karakter ile arayın" />
                      </label>
                      <div className="campaign-form-tip campaign-brand-toolbar-info">
                        {brandCampaignSearchNormalized.length >= 2
                          ? `${formatNumber(visibleCampaignBrands.length)} eşleşen marka bulundu.`
                          : hiddenCampaignBrandCount > 0
                            ? `+${formatNumber(hiddenCampaignBrandCount)} marka daha var. Görmek için arama yapın.`
                            : 'Markalar Ürün verilerinden dinamik olarak listelenir.'}
                      </div>
                      <div className="campaign-selected-products campaign-selected-products--inline" aria-label="Seçilen markalar">
                        <div className="campaign-selected-products-head">
                          <strong>Seçilen Markalar</strong>
                          <span>{formatNumber(selectedCampaignBrands.length)} marka</span>
                        </div>
                        {selectedCampaignBrands.length ? (
                          <div className="campaign-selected-product-list campaign-selected-product-list--inline">
                            {selectedCampaignBrands.map((brandName) => (
                              <span key={brandName} className="campaign-selected-product-chip">
                                {brandName}
                                <button type="button" onClick={() => toggleCampaignBrand(brandName)} aria-label={`${brandName} markasını kaldır`}>
                                  <X size={12} />
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : <div className="campaign-product-search-empty campaign-product-search-empty--inline">Henüz marka seçilmedi.</div>}
                      </div>
                    </div>
                    <div className="campaign-brand-grid-wrap">
                      <div className="s-giftcard-category-grid campaign-brand-grid">
                        {visibleCampaignBrands.length ? visibleCampaignBrands.map((brandName) => (
                          <button key={brandName} type="button" className="s-giftcard-category-item" onClick={() => toggleCampaignBrand(brandName)}>
                            <span>{brandName}</span>
                            <Plus size={14} />
                          </button>
                        )) : (
                          <div className="campaign-product-search-empty campaign-brand-empty-state">
                            {availableBrands.length === 0
                              ? 'Ürün verisinde geçerli marka bulunamadı.'
                              : brandCampaignSearchNormalized.length > 0 && brandCampaignSearchNormalized.length < 2
                                ? 'Arama için en az 2 karakter girin.'
                                : brandCampaignSearchNormalized.length >= 2
                                  ? 'Aramanıza uygun marka bulunamadı.'
                                  : 'Görüntülenen ilk 10 marka dışındaki kayıtlar için arama yapın.'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

            </div>
              <div className="modal-actions campaign-form-actions campaign-detail-modal-footer">
                <button type="button" className="primary-button" onClick={() => saveCampaignDraft(editingCampaignId)}>
                  Değişiklikleri Kaydet
                </button>
                <button type="button" className="outline-button" onClick={closeCampaignEditModal}>
                  Vazgeç
                </button>
              </div>
            </>
          ) : (
            <>
            <div className="campaign-detail-modal-body">
              <section className="campaign-detail-grid">
                <div><span>Tip</span><strong>{CAMPAIGN_TYPE_LABELS[selectedCampaignDetail.type] || selectedCampaignDetail.type}</strong></div>
                <div><span>İndirim</span><strong>%{formatNumber(selectedCampaignDetail.discountRate)}</strong></div>
                <div><span>Başlangıç</span><strong>{selectedCampaignDetail.startsAt || '-'}</strong></div>
                <div><span>Bitiş</span><strong>{selectedCampaignDetail.isIndefinite ? 'Süresiz' : (selectedCampaignDetail.endsAt || '-')}</strong></div>
                <div><span>Durum</span><strong>{CAMPAIGN_STATUS_LABELS[selectedCampaignDetail.status] || (selectedCampaignDetail.isActive ? 'Aktif' : 'Pasif')}</strong></div>
                <div>
                  <span>Uygulama önceliği</span>
                  <strong>{getCampaignPriorityDisplayLabel(selectedCampaignDetail.priority)}</strong>
                  <small className="muted-text">{getCampaignPriorityValueLabel(selectedCampaignDetail.priority)}</small>
                </div>
              </section>
              <section className="campaign-detail-section campaign-detail-section--products">
                <div className="campaign-detail-products-head">
                  <div>
                    <h4>Kampanyaya dahil ürünler</h4>
                    <p>Eski fiyat ve kampanya sonrası yeni fiyat ürün bazında gösterilir.</p>
                    {selectedCampaignDetailScopeCount > selectedCampaignDetailPreviewCount ? (
                      <small className="muted-text">Tablo, analiz önizlemesindeki {formatNumber(selectedCampaignDetailPreviewCount)} aday ürünü gösterir.</small>
                    ) : null}
                  </div>
                  <span>{formatNumber(selectedCampaignDetailScopeCount || selectedCampaignDetailPreviewCount)} ürün</span>
                </div>
                {selectedCampaignDetailProductRows.length ? (
                  <div className="campaign-detail-product-table-wrap">
                    <table className="data-table campaign-detail-product-table">
                      <thead>
                        <tr>
                          <th>Ürün adı</th>
                          <th>Kategori</th>
                          <th>Eski fiyat</th>
                          <th>Yeni fiyat</th>
                          <th>İndirim oranı</th>
                          <th>Stok</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCampaignDetailProductRows.map((row, index) => (
                          <tr key={`${row.id}-${index}`}>
                            <td><strong>{row.productName}</strong></td>
                            <td>{row.category}</td>
                            <td><span className="campaign-old-price">{row.oldPrice > 0 ? formatCurrency(row.oldPrice, form.currency) : '-'}</span></td>
                            <td><strong className="campaign-new-price">{row.newPrice > 0 ? formatCurrency(row.newPrice, form.currency) : '-'}</strong></td>
                            <td>%{formatNumber(row.discountRate)}</td>
                            <td>{row.stock === null ? '-' : `${formatNumber(row.stock)} adet`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="campaign-empty-state-box campaign-empty-state-box--compact" role="status">
                    <strong>Bu kampanyaya bağlı ürün bulunamadı.</strong>
                  </div>
                )}
              </section>
            </div>
              <div className="modal-actions campaign-form-actions campaign-detail-modal-footer">
                {selectedCampaignDetail.__viewMode !== 'archive' ? (
                  <button type="button" className="primary-button" onClick={() => openCampaignEditModal(selectedCampaignDetail)}>
                    Düzenle
                  </button>
                ) : null}
                <button type="button" className="outline-button" onClick={() => setSelectedCampaignDetail(null)}>
                  Kapat
                </button>
              </div>
            </>
          )
        ) : null}
      </FormModal>

      {giftCardModalOpen && (
        <div className="modal-overlay" onClick={requestCloseGiftCardModal}>
          <div className="modal-card s-giftcard-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header app-dialog-header">
              <div className="app-dialog-title-wrap s-giftcard-header-wrap">
                <span className="s-giftcard-header-icon" aria-hidden="true">
                  <Gift size={18} />
                </span>
                <div className="modal-header-title-wrap">
                  <h3>Hediye Kartı Yönetimi</h3>
                  <p>Yeni kart tanımlayın ve mevcut kartları görüntüleyin.</p>
                </div>
              </div>
              <button className="icon-button" type="button" onClick={requestCloseGiftCardModal} aria-label="Pencereyi kapat">
                <X size={16} />
              </button>
            </div>

            <div className="s-giftcard-modal-grid">
              <section className="s-giftcard-form-box">
                <h4>Yeni Hediye Kartı</h4>
                <label>
                  <span>Kart Kodu</span>
                  <div className="s-giftcard-code-input-wrap">
                    <input
                      type="text"
                      value={giftCardDraft.code}
                      onChange={(event) => setGiftCardDraft((current) => ({ ...current, code: normalizeCodeValue(event.target.value).replace(/[^A-Z0-9]/g, '') }))}
                      placeholder="ORN: A7K2P"
                    />
                    <button
                      type="button"
                      className="s-giftcard-code-generate-btn"
                      onClick={handleGenerateGiftCardCode}
                      title="Otomatik oluştur"
                      aria-label="Kart kodunu otomatik oluştur"
                    >
                      <Shuffle size={14} />
                    </button>
                  </div>
                </label>
                <label>
                  <span>Kart Adı</span>
                  <input type="text" value={giftCardDraft.name} onChange={(event) => setGiftCardDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Sadakat Kartı" />
                </label>
                <div className="s-giftcard-inline-fields">
                  <label>
                    <span>Tip</span>
                    <select value={giftCardDraft.valueType} onChange={(event) => setGiftCardDraft((current) => ({ ...current, valueType: event.target.value }))}>
                      <option value="amount">Tutar</option>
                      <option value="percentage">Yüzde</option>
                    </select>
                  </label>
                  <label>
                    <span>Değer</span>
                    <input type="number" min="0" step="0.01" value={giftCardDraft.value} onChange={(event) => setGiftCardDraft((current) => ({ ...current, value: event.target.value }))} placeholder={giftCardDraft.valueType === 'percentage' ? '10' : '150'} />
                  </label>
                  <label>
                    <span>Kullanım Hakkı</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={giftCardDraft.usageLimit}
                      onChange={(event) => setGiftCardDraft((current) => ({ ...current, usageLimit: event.target.value }))}
                      placeholder="1"
                    />
                  </label>
                </div>

                <div className="s-giftcard-category-box">
                  <div className="s-giftcard-category-head">
                    <span>Kategori Geçerliliği</span>
                    <button
                      type="button"
                      className={`s-giftcard-all-toggle ${giftCardDraft.isAllCategoriesSelected ? 'is-active' : ''}`}
                      onClick={toggleAllCategoriesForGiftCard}
                    >
                      Hepsi 
                    </button>
                  </div>

                  <small>
                    {giftCardDraft.isAllCategoriesSelected ?
                       'Kart tüm kategorilerde geçerlidir.'
                      : 'Kart sadece seçili kategorilerde geçerlidir.'}
                  </small>

                  <div className={`s-giftcard-category-picker ${giftCardDraft.isAllCategoriesSelected ? 'is-disabled' : ''}`}>
                    <div className="s-giftcard-category-list">
                      {availableCategories.map((category) => (
                        <label
                          key={category.id}
                          className={`s-giftcard-category-item ${giftCardDraft.allowedCategoryIds.includes(category.id) ? 'is-selected' : ''} ${giftCardDraft.isAllCategoriesSelected ? 'is-disabled' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={giftCardDraft.allowedCategoryIds.includes(category.id)}
                            onChange={() => toggleGiftCardCategory(category.id)}
                            disabled={giftCardDraft.isAllCategoriesSelected}
                          />
                          <span>{category.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <button type="button" className="s-giftcard-add-btn" onClick={addGiftCard}>
                  <Plus size={15} /> Kartı Ekle
                </button>
              </section>

              <section className="s-giftcard-list-box">
                <h4>Mevcut Hediye Kartları</h4>
                {giftCards.length === 0 ? (
                  <div className="s-giftcard-empty">Henüz hediye kartı tanımlanmadı.</div>
                ) : (
                  <div className="s-giftcard-list">
                    {giftCards.map((card) => (
                      <div key={card.id} className="s-giftcard-row">
                        <div className="s-giftcard-row-main">
                          <strong>{card.name}</strong>
                          <span>{card.code}</span>
                          <small>{card.valueType === 'percentage' ? `%${formatNumber(card.value)}` : `${formatNumber(card.value)} ${form.currency}`}</small>
                          <small>{`Kalan kullanım: ${Math.max(0, Number(card.remainingUsage ?? card.usageLimit ?? 1) || 0)}`}</small>
                        </div>
                        <button type="button" className="s-giftcard-delete-btn" onClick={() => removeGiftCard(card.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={giftCardCloseConfirmOpen}
        title="Değişiklikler Kaydedilmedi"
        description="Kaydedilmemiş değişiklikleriniz silinecek. Bu işlemi onaylıyor musunuz?"
        confirmText="Değişiklikleri Sil ve Kapat"
        cancelText="Vazgeç"
        tone="confirm"
        closeButton={false}
        primaryAction="cancel"
        dialogClassName="unsaved-changes-dialog"
        onConfirm={closeGiftCardModal}
        onCancel={() => setGiftCardCloseConfirmOpen(false)}
      />

      <FormModal
        isOpen={specialDayListModalOpen}
        title="Özel Günleri Göster"
        description="Tanımlı Özel günleri tarih, saat ve durum bilgileriyle görüntüleyin."
        headerIcon={<CalendarDays size={16} />}
        onClose={() => setSpecialDayListModalOpen(false)}
        modalClassName="product-form-fit-modal special-day-list-modal"
        confirmOnDirtyClose={false}
      >
        <div className="modal-form modal-structured-form special-day-list-form">
          <div className="modal-form-body-scroll special-day-list-body">
            <section className="modal-form-section special-day-list-section">
              {(form.specialDays || []).length ? (
                <div className="s-special-days-list special-day-list-compact">
                  {(form.specialDays || []).map((item) => {
                    const startDate = item.startDate || item.date || '-';
                    const endDate = item.endDate || '';
                    const rangeText = endDate ? `${startDate} - ${endDate}` : startDate;
                    const statusText = item.isClosed ? 'Pasif' : (item.isActive === false ? 'Pasif' : 'Aktif');
                    return (
                      <article className="special-day-list-item" key={item.id}>
                        <div className="special-day-list-item-main">
                          <strong>{rangeText}</strong>
                          <div className="special-day-list-item-actions">
                            <span>{item.startTime || item.opensAt || '-'} - {item.endTime || item.closesAt || '-'}</span>
                            <button
                              type="button"
                              className="special-day-delete-btn"
                              onClick={() => removeSpecialDay(item.id)}
                              aria-label="Özel günü sil"
                              title="Özel günü sil"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="special-day-list-item-meta">
                          <span className={`s-logistics-status ${statusText === 'Aktif' ? 'is-active' : 'is-passive'}`}>{statusText}</span>
                          <span>{String(item.note || '-')}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="s-empty-state">Tanımlı Özel gün bulunmuyor.</div>
              )}
            </section>
          </div>
          <div className="modal-actions special-day-list-footer">
            <button type="button" className="ghost-button" onClick={() => setSpecialDayListModalOpen(false)}>Kapat</button>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={specialDayModalOpen}
        title="Özel Gün Ekle"
        description="Mağaza için Özel Çalışma saati tanımlayın. Tek gün veya tarih aralığı seçebilirsiniz."
        headerIcon={<CalendarDays size={16} />}
        modalClassName="product-form-fit-modal special-day-modal"
        onClose={closeSpecialDayModal}
        confirmOnDirtyClose={false}
      >
        <div className="modal-form modal-structured-form special-day-form">
          <div className="modal-form-body-scroll special-day-form-body">

            {/* Seçim tipi */}
            <section className="modal-form-section special-day-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">Seçim Tipi</h4>
              </div>
              <div className="special-day-mode-control" role="radiogroup" aria-label="Tarih seçim tipi">
                {[
                  { key: 'single', label: 'Tek Gün' },
                  { key: 'range', label: 'Tarih Aralığı' },
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    aria-checked={specialDayDraft.dateMode === option.key}
                    className={`special-day-mode-chip ${specialDayDraft.dateMode === option.key ? 'is-active' : ''}`}
                    onClick={() => setSpecialDayDraft((current) => ({ ...current, dateMode: option.key, endDate: '' }))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Tarih alanları */}
            <section className="modal-form-section special-day-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">
                  {specialDayDraft.dateMode === 'range' ? 'Tarih Aralığı' : 'Tarih'}
                </h4>
              </div>
              <div className={`special-day-date-grid ${specialDayDraft.dateMode === 'range' ? 'is-range' : 'is-single'}`}>
                <label className="field-group">
                  <span>{specialDayDraft.dateMode === 'range' ? 'Başlangıç Tarihi' : 'Tarih'}</span>
                  <input
                    type="date"
                    value={specialDayDraft.startDate}
                    onChange={(event) => setSpecialDayDraft((current) => ({ ...current, startDate: event.target.value }))}
                  />
                </label>
                {specialDayDraft.dateMode === 'range' ? (
                  <label className="field-group">
                    <span>Bitiş Tarihi</span>
                    <input
                      type="date"
                      min={specialDayDraft.startDate || undefined}
                      value={specialDayDraft.endDate}
                      onChange={(event) => setSpecialDayDraft((current) => ({ ...current, endDate: event.target.value }))}
                    />
                  </label>
                ) : null}
              </div>
            </section>

            {/* Saat alanları */}
            <section className="modal-form-section special-day-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">Çalışma Saatleri</h4>
              </div>
              <div className="special-day-time-grid">
                <label className="field-group">
                  <span>Açılış Saati</span>
                  <input
                    type="time"
                    value={specialDayDraft.startTime}
                    onChange={(event) => setSpecialDayDraft((current) => ({ ...current, startTime: event.target.value }))}
                  />
                </label>
                <label className="field-group">
                  <span>Kapanış Saati</span>
                  <input
                    type="time"
                    value={specialDayDraft.endTime}
                    onChange={(event) => setSpecialDayDraft((current) => ({ ...current, endTime: event.target.value }))}
                  />
                </label>
              </div>
            </section>

            {/* Not */}
            <section className="modal-form-section special-day-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">Not</h4>
                <p className="modal-form-section-desc">Opsiyonel: bu Özel gün için kısa bir açıklama ekleyin.</p>
              </div>
              <label className="field-group">
                <span>Not</span>
                <textarea
                  rows={3}
                  value={specialDayDraft.note}
                  onChange={(event) => setSpecialDayDraft((current) => ({ ...current, note: event.target.value }))}
                  placeholder="Örn: Yılbaşı Özel Çalışma saati, bayram tatili vb."
                />
              </label>
            </section>

          </div>
          <div className="modal-actions special-day-footer">
            <button type="button" className="ghost-button" onClick={closeSpecialDayModal}>İptal</button>
            <button type="button" className="primary-button" onClick={saveSpecialDayDraft}>Ekle</button>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={auditModalOpen}
        title="Audit Log Detayı"
        description="Seçilen ayar değişikliği kaydını read-only olarak inceleyin."
        headerIcon={<FileText size={16} />}
        modalClassName="product-form-fit-modal s-audit-detail-modal"
        onClose={() => {
          setAuditModalOpen(false);
          setSelectedAuditLog(null);
        }}
      >
        <div className="modal-form modal-structured-form s-audit-detail-form">
          <div className="modal-form-body-scroll s-audit-detail-scroll s-log-detail-body">
            <FormSection title="Kayıt Özeti" description="İşlem, kullanıcı ve zaman bilgileri.">
              <FormGrid className="s-log-detail-grid">
                <label className="field-group col-4 s-log-detail-readonly-field">
                  <span>İşlem</span>
                  <input type="text" value={selectedAuditLog?.actionLabel || selectedAuditLog?.action || '-'} readOnly />
                </label>
                <label className="field-group col-4 s-log-detail-readonly-field">
                  <span>Yapan</span>
                  <input type="text" value={selectedAuditLog?.actorName || '-'} readOnly />
                </label>
                <label className="field-group col-4 s-log-detail-readonly-field">
                  <span>Zaman</span>
                  <input type="text" value={formatDateTime(selectedAuditLog?.createdAt || selectedAuditLog?.at)} readOnly />
                </label>
                <label className="field-group col-4 s-log-detail-readonly-field">
                  <span>Kayıt ID</span>
                  <input type="text" value={selectedAuditLog?.id || '-'} readOnly />
                </label>
                <label className="field-group col-12 s-log-detail-readonly-field s-log-detail-changed-field">
                  <span>Değişen Alanlar</span>
                  <textarea
                    value={Array.isArray(selectedAuditLog?.changedKeys) && selectedAuditLog.changedKeys.length ?
                       selectedAuditLog.changedKeys.join(', ')
                      : 'Değişen alan bilgisi bulunmuyor.'}
                    readOnly
                    rows={3}
                  />
                </label>
              </FormGrid>
            </FormSection>

            <FormSection title="Aksiyon Detayı" description="Log mesajı ve açıklama içeriği.">
              <FormGrid className="s-log-detail-grid">
                <label className="field-group col-12 s-log-detail-readonly-field">
                  <span>Detay</span>
                  <textarea
                    value={formatLogDetailsForDisplay(selectedAuditLog?.details || selectedAuditLog?.detail || selectedAuditLog?.summary || selectedAuditLog?.note, 'Detay içeriği bulunmuyor.')}
                    readOnly
                    rows={8}
                    className="s-log-detail-textarea"
                  />
                </label>
              </FormGrid>
            </FormSection>
          </div>

          <div className="modal-actions s-log-detail-footer">
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setAuditModalOpen(false);
                setSelectedAuditLog(null);
              }}
            >
              Kapat
            </button>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={developerLogModalOpen}
        title="Geliştirici Log Detayı"
        description="Teknik hata kaydını read-only olarak inceleyin."
        headerIcon={<FileText size={16} />}
        modalClassName="product-form-fit-modal s-devlog-detail-modal"
        onClose={() => {
          setDeveloperLogModalOpen(false);
          setSelectedDeveloperLog(null);
        }}
      >
        <div className="modal-form modal-structured-form s-devlog-detail-form">
          <div className="modal-form-body-scroll s-devlog-detail-scroll s-log-detail-body">
            <FormSection title="Kayıt Özeti" description="Hata seviyesi ve aksiyon bilgileri.">
              <FormGrid className="s-log-detail-grid">
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Hata Tipi</span>
                  <input type="text" value={selectedDeveloperLogView.level} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Kaynak</span>
                  <input type="text" value={selectedDeveloperLogView.source} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Tarih</span>
                  <input type="text" value={selectedDeveloperLogView.date} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Kayıt ID</span>
                  <input type="text" value={selectedDeveloperLog?.id || '-'} readOnly />
                </label>
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>İşlem</span>
                  <input type="text" value={selectedDeveloperLogView.action} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Durum kodu</span>
                  <input type="text" value={selectedDeveloperLog?.statusCode || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Hata Sınıfı</span>
                  <input type="text" value={selectedDeveloperLog?.errorType || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Tekrar</span>
                  <input type="text" value={selectedDeveloperLog?.repeatCount || 1} readOnly />
                </label>
              </FormGrid>
            </FormSection>

            <FormSection title="Hata Özeti" description="Mesaj ve stack trace bilgileri.">
              <FormGrid className="s-log-detail-grid">
                <label className="field-group col-12 s-log-detail-readonly-field">
                  <span>Mesaj</span>
                  <textarea value={selectedDeveloperLogView.message} readOnly rows={4} className="s-log-detail-textarea" />
                </label>
                <label className="field-group col-12 s-log-detail-readonly-field">
                  <span>Stack Trace</span>
                  <textarea value={selectedDeveloperLogView.stack} readOnly rows={8} className="s-log-detail-textarea s-log-detail-stack" />
                </label>
              </FormGrid>
            </FormSection>

            <FormSection title="İstek / Kimlik Bilgisi" description="Request bilgileri ve kullanıcı kimliği.">
              <FormGrid className="s-log-detail-grid">
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>Request URL</span>
                  <input type="text" value={selectedDeveloperLog?.requestUrl || selectedDeveloperLog?.endpoint || '-'} readOnly />
                </label>
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>Kullanıcı</span>
                  <input type="text" value={`${selectedDeveloperLogView.user} (${selectedDeveloperLog?.userId || '-'})`} readOnly />
                </label>
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>Tarayıcı</span>
                  <input type="text" value={selectedDeveloperLog?.browserInfo || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>IP</span>
                  <input type="text" value={selectedDeveloperLog?.ip || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Endpoint</span>
                  <input type="text" value={selectedDeveloperLog?.endpoint || '-'} readOnly />
                </label>
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>Request ID</span>
                  <input type="text" value={selectedDeveloperLog?.requestId || '-'} readOnly />
                </label>
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>Correlation ID</span>
                  <input type="text" value={selectedDeveloperLog?.correlationId || '-'} readOnly />
                </label>
              </FormGrid>
            </FormSection>

            <FormSection title="Payload / Response" description="İstek ve yanıt gövdeleri.">
              <FormGrid className="s-log-detail-grid">
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>İstek Detayı</span>
                  <textarea
                    value={selectedDeveloperLogView.requestPayload}
                    readOnly
                    rows={8}
                    className="s-log-detail-textarea"
                  />
                </label>
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>Yanıt Detayı</span>
                  <textarea
                    value={selectedDeveloperLogView.responsePayload}
                    readOnly
                    rows={8}
                    className="s-log-detail-textarea"
                  />
                </label>
              </FormGrid>
            </FormSection>
          </div>

          <div className="modal-actions s-log-detail-footer">
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setDeveloperLogModalOpen(false);
                setSelectedDeveloperLog(null);
              }}
            >
              Kapat
            </button>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={loginActivityDetailModalOpen}
        title="Giriş Aktivitesi Detayı"
        description="Seçilen giriş kaydını read-only olarak inceleyin."
        headerIcon={<ShieldCheck size={16} />}
        modalClassName="product-form-fit-modal s-audit-detail-modal"
        onClose={() => {
          setLoginActivityDetailModalOpen(false);
          setSelectedLoginActivity(null);
        }}
      >
        <div className="modal-form modal-structured-form s-audit-detail-form">
          <div className="modal-form-body-scroll s-audit-detail-scroll s-log-detail-body">
            <FormSection title="Kayıt Özeti" description="Kullanıcı, cihaz ve zaman bilgileri.">
              <FormGrid className="s-log-detail-grid">
                <label className="field-group col-4 s-log-detail-readonly-field">
                  <span>Kullanıcı</span>
                  <input type="text" value={selectedLoginActivity?.userName || selectedLoginActivity?.username || '-'} readOnly />
                </label>
                <label className="field-group col-2 s-log-detail-readonly-field">
                  <span>Sicil No</span>
                  <input type="text" value={selectedLoginActivity?.registerPin || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>IP</span>
                  <input type="text" value={selectedLoginActivity?.ipAddress || selectedLoginActivity?.ip || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Giriş Zamanı</span>
                  <input type="text" value={formatDateTime(resolveLoginActivityDate(selectedLoginActivity))} readOnly />
                </label>
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>E-posta</span>
                  <input type="text" value={selectedLoginActivity?.email || selectedLoginActivity?.username || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>İşletim Sistemi</span>
                  <input type="text" value={parseUserAgentInfo(selectedLoginActivity).os} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Tarayıcı</span>
                  <input type="text" value={parseUserAgentInfo(selectedLoginActivity).browser} readOnly />
                </label>
                <label className="field-group col-12 s-log-detail-readonly-field">
                  <span>User-Agent</span>
                  <textarea
                    value={formatLogDetailsForDisplay(selectedLoginActivity?.userAgent || selectedLoginActivity?.browserInfo || selectedLoginActivity?.device, 'Cihaz ayrıntısı bulunmuyor.')}
                    readOnly
                    rows={4}
                    className="s-log-detail-textarea"
                  />
                </label>
              </FormGrid>
            </FormSection>
          </div>
          <div className="modal-actions s-log-detail-footer">
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setLoginActivityDetailModalOpen(false);
                setSelectedLoginActivity(null);
              }}
            >
              Kapat
            </button>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={auditLogManagerModalOpen}
        title="Audit Log Yönetimi"
        description="Filtreleme, dışa aktarma ve kayıt inceleme işlemlerini buradan yapın"
        headerIcon={<Shield size={16} />}
        onClose={() => setAuditLogManagerModalOpen(false)}
        modalClassName="product-form-fit-modal s-devlog-manager-modal"
      >
        <div className="modal-form modal-structured-form s-devlog-manager-shell">
          <div className="modal-form-body-scroll s-devlog-manager-scroll">
            <section className="s-devlog-section s-devlog-filter-section s-devlog-filter-section-audit">
              <div className="s-devlog-filters">
                <label className="field-group s-devlog-field s-devlog-field-level">
                  <span>İşlem Tipi</span>
                  <select name="action" value={auditLogFilters.action} onChange={handleAuditLogFilterChange}>
                    <option value="">Tümü</option>
                    {auditActionOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="field-group s-devlog-field s-devlog-field-user">
                  <span>Kullanıcı</span>
                  <select name="user" value={auditLogFilters.user} onChange={handleAuditLogFilterChange}>
                    <option value="">Tümü</option>
                    {auditUsers.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="field-group s-devlog-field s-devlog-field-from s-devlog-field-date">
                  <span>Başlangıç</span>
                  <input type="date" name="from" value={auditLogFilters.from} onChange={handleAuditLogFilterChange} />
                </label>
                <label className="field-group s-devlog-field s-devlog-field-to s-devlog-field-date">
                  <span>Bitiş</span>
                  <input type="date" name="to" value={auditLogFilters.to} onChange={handleAuditLogFilterChange} />
                </label>
                <label className="field-group s-devlog-field s-devlog-field-search">
                  <span>Arama / Detay</span>
                  <input type="text" name="search" value={auditLogFilters.search} onChange={handleAuditLogFilterChange} placeholder="Aksiyon, kullanıcı, detay" />
                </label>
              </div>

              <div className="s-devlog-manager-actions s-devlog-controls-actions s-devlog-actions-triple">
                <button type="button" className="s-audit-btn s-devlog-filter-btn s-devlog-action-primary-row" onClick={handleAuditLogSearch}>Filtrele</button>
                <button type="button" className="s-audit-btn" onClick={handleAuditLogClearFilters}>Temizle</button>
                <button type="button" className="s-audit-btn" onClick={() => handleExportAuditXlsx(filteredAuditLogs)}>
                  <FileSpreadsheet size={14} /> Excel İndir
                </button>
              </div>
            </section>

            <section className="s-devlog-section s-devlog-table-section">
              {auditLogManagerLoading ? (
                <div className="s-empty-state">Audit log kayıtları yükleniyor...</div>
              ) : filteredAuditLogs.length ? (
                <div className="s-devlog-table-wrap">
                  <table className="s-devlog-table">
                    <thead>
                      <tr>
                        <th>Tarih & Saat</th>
                        <th>İşlem</th>
                        <th>Kullanıcı</th>
                        <th>Detay</th>
                        <th>İncele</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAuditLogs.map((row) => (
                        <tr key={row.id}>
                          <td className="s-devlog-cell-time">{formatDateTime(row.createdAt || row.at)}</td>
                          <td className="s-devlog-cell-action">{row.actionLabel || row.action || '-'}</td>
                          <td className="s-devlog-cell-user">{row.actorName || row.actor || row.userName || '-'}</td>
                          <td className="s-devlog-cell-message">{row.details || row.detail || row.summary || '-'}</td>
                          <td className="s-devlog-cell-detail">
                            <button
                              type="button"
                              className="s-audit-link"
                              onClick={() => {
                                setSelectedAuditLog(row);
                                setAuditModalOpen(true);
                              }}
                            >
                              İncele
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="s-empty-state">Filtre kriterlerine uygun audit kaydı bulunmuyor.</div>
              )}
            </section>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={loginActivityManagerModalOpen}
        title="Son Giriş Aktiviteleri Yönetimi"
        description="Filtreleme, dışa aktarma ve kayıt inceleme işlemlerini buradan yapın"
        headerIcon={<ShieldCheck size={16} />}
        onClose={() => setLoginActivityManagerModalOpen(false)}
        modalClassName="product-form-fit-modal s-devlog-manager-modal"
      >
        <div className="modal-form modal-structured-form s-devlog-manager-shell">
          <div className="modal-form-body-scroll s-devlog-manager-scroll">
            <section className="s-devlog-section s-devlog-filter-section s-devlog-filter-section-login">
              <div className="s-devlog-filters">
                <label className="field-group s-devlog-field s-devlog-field-user">
                  <span>Kullanıcı</span>
                  <select name="user" value={loginActivityFilters.user} onChange={handleLoginActivityFilterChange}>
                    <option value="">Tümü</option>
                    {loginUsers.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="field-group s-devlog-field s-devlog-field-level">
                  <span>Tarayıcı</span>
                  <select name="browser" value={loginActivityFilters.browser} onChange={handleLoginActivityFilterChange}>
                    <option value="">Tümü</option>
                    {loginBrowserOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="field-group s-devlog-field s-devlog-field-from s-devlog-field-date">
                  <span>Başlangıç</span>
                  <input type="date" name="from" value={loginActivityFilters.from} onChange={handleLoginActivityFilterChange} />
                </label>
                <label className="field-group s-devlog-field s-devlog-field-to s-devlog-field-date">
                  <span>Bitiş</span>
                  <input type="date" name="to" value={loginActivityFilters.to} onChange={handleLoginActivityFilterChange} />
                </label>
              </div>

              <div className="s-devlog-manager-actions s-devlog-controls-actions s-devlog-login-actions s-devlog-actions-triple">
                <button type="button" className="s-audit-btn s-devlog-filter-btn s-devlog-action-primary-row" onClick={handleLoginActivitySearch}>Filtrele</button>
                <button type="button" className="s-audit-btn" onClick={handleLoginActivityClearFilters}>Temizle</button>
                <button type="button" className="s-audit-btn" onClick={() => handleExportLoginXlsx(filteredLoginActivities)}>
                  <FileSpreadsheet size={14} /> Excel İndir
                </button>
              </div>
            </section>

            <section className="s-devlog-section s-devlog-table-section">
              {loginActivityManagerLoading ? (
                <div className="s-empty-state">Giriş aktiviteleri yükleniyor...</div>
              ) : filteredLoginActivities.length ? (
                <div className="s-devlog-table-wrap">
                  <table className="s-devlog-table">
                    <thead>
                      <tr>
                        <th>Tarih & Saat</th>
                        <th>Kullanıcı</th>
                        <th>Sicil No</th>
                        <th>Tarayıcı</th>
                        <th>IP</th>
                        <th>İncele</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLoginActivities.map((row) => {
                        const parsed = parseUserAgentInfo(row);
                        return (
                          <tr key={row.id}>
                            <td className="s-devlog-cell-time">{formatDateTime(resolveLoginActivityDate(row))}</td>
                            <td className="s-devlog-cell-user">{row.userName || row.username || '-'}</td>
                            <td className="s-devlog-cell-action">{row.registerPin || '-'}</td>
                            <td className="s-devlog-cell-source">{parsed.browser}</td>
                            <td className="s-devlog-cell-action">{row.ipAddress || row.ip || '-'}</td>
                            <td className="s-devlog-cell-detail">
                              <button
                                type="button"
                                className="s-audit-link"
                                onClick={() => {
                                  setSelectedLoginActivity(row);
                                  setLoginActivityDetailModalOpen(true);
                                }}
                              >
                                İncele
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="s-empty-state">Filtre kriterlerine uygun giriş aktivitesi bulunmuyor.</div>
              )}
            </section>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={developerLogCreateModalOpen}
        title="Sistem Kaydı Oluştur"
        description="Yönetici olarak manuel hata veya işlem kaydı ekleyin."
        headerIcon={<Plus size={16} />}
        modalClassName="product-form-fit-modal s-devlog-create-modal"
        onClose={() => {
          if (creatingDeveloperLog) return;
          setDeveloperLogCreateModalOpen(false);
          setDeveloperLogDraft(createDeveloperLogDraft());
        }}
      >
        <form className="modal-form modal-structured-form s-devlog-create-form" onSubmit={handleCreateDeveloperLog}>
          <div className="modal-form-body-scroll s-devlog-create-scroll">
            <FormSection className="s-devlog-create-section" title="Kayıt Bilgileri" description="Kaydın türünü ve hangi işlem sırasında oluştuğunu girin.">
              <FormGrid className="s-devlog-create-grid">
                <label className="field-group col-6">
                  <span>Kayıt Türü</span>
                  <select name="level" value={developerLogDraft.level} onChange={handleDeveloperLogDraftChange} disabled={creatingDeveloperLog}>
                    <option value="error">Hata</option>
                    <option value="warning">Uyarı</option>
                    <option value="info">Bilgi</option>
                  </select>
                </label>

                <label className="field-group col-6">
                  <span>Kaynak</span>
                  <select name="source" value={developerLogDraft.source} onChange={handleDeveloperLogDraftChange} disabled={creatingDeveloperLog}>
                    <option value="frontend">Frontend</option>
                    <option value="backend">Backend</option>
                    <option value="api">API</option>
                  </select>
                </label>

                <label className="field-group col-6">
                  <span>İşlem / Adım</span>
                  <input
                    type="text"
                    name="action"
                    value={developerLogDraft.action}
                    onChange={handleDeveloperLogDraftChange}
                    placeholder="Örn. kullanıcı kaydı, sipariş onayı"
                    disabled={creatingDeveloperLog}
                  />
                </label>

                <label className="field-group col-6">
                  <span>İlgili sayfa / servis adresi</span>
                  <input
                    type="text"
                    name="endpoint"
                    value={developerLogDraft.endpoint}
                    onChange={handleDeveloperLogDraftChange}
                    placeholder="Örn. /api/orders veya ürünler sayfası"
                    disabled={creatingDeveloperLog}
                  />
                </label>

                <label className="field-group col-6">
                  <span>Durum kodu</span>
                  <input
                    type="number"
                    min="0"
                    max="999"
                    name="statusCode"
                    value={developerLogDraft.statusCode}
                    onChange={handleDeveloperLogDraftChange}
                    placeholder="Örn. 400 veya 500"
                    disabled={creatingDeveloperLog}
                  />
                </label>

                <label className="field-group col-6">
                  <span>Hata sınıfı / tipi</span>
                  <input
                    type="text"
                    name="errorType"
                    value={developerLogDraft.errorType}
                    onChange={handleDeveloperLogDraftChange}
                    placeholder="Örn. doğrulama hatası, TypeError"
                    disabled={creatingDeveloperLog}
                  />
                </label>
              </FormGrid>
            </FormSection>

            <FormSection className="s-devlog-create-section" title="Detaylar" description="Gerekli açıklamaları ekleyin. Teknik alanlar opsiyoneldir.">
              <FormGrid className="s-devlog-create-grid">
                <label className="field-group col-12">
                  <span>Hata mesajı</span>
                  <textarea
                    name="message"
                    rows="3"
                    value={developerLogDraft.message}
                    onChange={handleDeveloperLogDraftChange}
                    placeholder="Kullanıcının veya yöneticinin anlayacağı kısa açıklamayı yazın."
                    disabled={creatingDeveloperLog}
                  />
                </label>

                <label className="field-group col-12">
                  <span>Teknik detay / stack trace</span>
                  <textarea
                    name="stack"
                    rows="5"
                    value={developerLogDraft.stack}
                    onChange={handleDeveloperLogDraftChange}
                    placeholder="Teknik hata izi veya geliştirici notu. Zorunlu değildir."
                    disabled={creatingDeveloperLog}
                  />
                </label>

                <label className="field-group col-12">
                  <span>İstek verisi</span>
                  <textarea
                    name="requestPayload"
                    rows="4"
                    value={developerLogDraft.requestPayload}
                    onChange={handleDeveloperLogDraftChange}
                    placeholder='JSON zorunlu değildir. İsterseniz düz metin veya JSON yazabilirsiniz.'
                    disabled={creatingDeveloperLog}
                  />
                </label>

                <label className="field-group col-12">
                  <span>Yanıt verisi</span>
                  <textarea
                    name="response"
                    rows="4"
                    value={developerLogDraft.response}
                    onChange={handleDeveloperLogDraftChange}
                    placeholder='JSON zorunlu değildir. Servis yanıtını veya kısa açıklamayı ekleyebilirsiniz.'
                    disabled={creatingDeveloperLog}
                  />
                </label>
              </FormGrid>
            </FormSection>
          </div>

          <div className="modal-actions s-devlog-create-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                if (creatingDeveloperLog) return;
                setDeveloperLogCreateModalOpen(false);
                setDeveloperLogDraft(createDeveloperLogDraft());
              }}
              disabled={creatingDeveloperLog}
            >
              İptal
            </button>
            <button className="primary-button" type="submit" disabled={creatingDeveloperLog}>
              {creatingDeveloperLog ? 'Kaydediliyor...' : 'Kaydı Oluştur'}
            </button>
          </div>
        </form>
      </FormModal>

      <FormModal
        isOpen={developerLogManagerModalOpen}
        title="Geliştirici Log Yönetimi"
        description="Filtreleme, dışa aktarma ve log ekleme işlemlerini buradan yapın"
        headerIcon={<FileText size={16} />}
        onClose={() => setDeveloperLogManagerModalOpen(false)}
        modalClassName="product-form-fit-modal s-devlog-manager-modal"
      >
        <div className="modal-form modal-structured-form s-devlog-manager-shell">
          <div className="modal-form-body-scroll s-devlog-manager-scroll">
            <section className="s-devlog-section s-devlog-filter-section s-devlog-filter-section-developer">
              <div className="s-devlog-filters">
                <label className="field-group s-devlog-field s-devlog-field-level">
                  <span>Hata Tipi</span>
                  <select name="level" value={developerLogFilters.level} onChange={handleDeveloperLogFilterChange}>
                    <option value="">Tümü</option>
                    <option value="error">Error</option>
                    <option value="warning">Warning</option>
                    <option value="info">Info</option>
                  </select>
                </label>
                <label className="field-group s-devlog-field s-devlog-field-source">
                  <span>Kaynak</span>
                  <select name="source" value={developerLogFilters.source} onChange={handleDeveloperLogFilterChange}>
                    <option value="">Tümü</option>
                    <option value="frontend">Frontend</option>
                    <option value="backend">Backend</option>
                    <option value="api">API</option>
                  </select>
                </label>
                <label className="field-group s-devlog-field s-devlog-field-from s-devlog-field-date">
                  <span>Başlangıç</span>
                  <input type="date" name="from" value={developerLogFilters.from} onChange={handleDeveloperLogFilterChange} />
                </label>
                <label className="field-group s-devlog-field s-devlog-field-to s-devlog-field-date">
                  <span>Bitiş</span>
                  <input type="date" name="to" value={developerLogFilters.to} onChange={handleDeveloperLogFilterChange} />
                </label>
                <label className="field-group s-devlog-field s-devlog-field-user">
                  <span>Kullanıcı</span>
                  <select name="userId" value={developerLogFilters.userId} onChange={handleDeveloperLogFilterChange}>
                    <option value="">Tümü</option>
                    {developerUsers.map((row) => (
                      <option key={row.id} value={row.id}>{row.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field-group s-devlog-field s-devlog-field-search">
                  <span>Arama</span>
                  <input
                    type="text"
                    name="search"
                    value={developerLogFilters.search}
                    onChange={handleDeveloperLogFilterChange}
                    placeholder="Mesaj / endpoint"
                  />
                </label>
              </div>

              <div className="s-devlog-manager-actions s-devlog-controls-actions s-devlog-actions-quad">
                <button type="button" className="s-audit-btn s-audit-btn-primary" onClick={openDeveloperLogCreateModal}>
                  <Plus size={14} /> Log Oluştur
                </button>
                <button type="button" className="s-audit-btn s-devlog-filter-btn" onClick={handleDeveloperLogSearch}>
                  Filtrele
                </button>
                <button type="button" className="s-audit-btn" onClick={handleDeveloperLogClearFilters}>
                  Temizle
                </button>
                <button type="button" className="s-audit-btn" onClick={handleExportDeveloperXlsx}>
                  <FileSpreadsheet size={14} /> Excel İndir
                </button>
              </div>
            </section>

            <section className="s-devlog-section s-devlog-table-section">
              {developerLogsLoading ? (
                <div className="s-empty-state">Loglar yükleniyor...</div>
              ) : developerLogs.length ? (
                <div className="s-devlog-table-wrap">
                  <table className="s-devlog-table">
                    <thead>
                      <tr>
                        <th>Tarih & Saat</th>
                        <th>Hata Tipi</th>
                        <th>Mesaj</th>
                        <th>Kaynak</th>
                        <th>İşlem</th>
                        <th>Kullanıcı</th>
                        <th>Detay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {developerLogs.map((row) => (
                        <tr key={row.id}>
                          <td className="s-devlog-cell-time">{formatDateTime(row.timestamp)}</td>
                          <td className="s-devlog-cell-level">
                            <span className={`s-log-level-badge level-${row.level || 'error'}`}>
                              {getLogLevelLabel(row.level)}
                            </span>
                          </td>
                          <td className="s-devlog-cell-message">{getDeveloperLogPresentation(row).message}</td>
                          <td className="s-devlog-cell-source">{row.source || '-'}</td>
                          <td className="s-devlog-cell-action">{row.action || '-'}</td>
                          <td className="s-devlog-cell-user">{row.userName || row.user || '-'}</td>
                          <td className="s-devlog-cell-detail">
                            <button
                              type="button"
                              className="s-audit-link"
                              onClick={() => {
                                setSelectedDeveloperLog(row);
                                setDeveloperLogModalOpen(true);
                              }}
                            >
                              İncele
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="s-empty-state">Henüz log kaydı bulunmuyor</div>
              )}
            </section>
          </div>
        </div>
      </FormModal>
    </div>
  );
}

