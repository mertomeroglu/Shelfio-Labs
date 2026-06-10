import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './SettingsCampaignShell.css';
import { SlidersHorizontal, Settings as SettingsIcon, Settings2, BarChart3, Home, BadgePercent, Package, Layers, Tags, Phone, Mail, MapPin, Hash, Building, Save, Shield, ShieldCheck, Lock, LockOpen, Eye, EyeOff, KeyRound, Gift, Plus, Trash2, X, Shuffle, FileText, FileSpreadsheet, ChevronDown, ChevronUp, Megaphone, CalendarDays, TrendingUp, RefreshCw, Eraser, Sparkles, Info, AlertTriangle, CalendarClock, Coins, TrendingDown, PackageSearch, Percent, MoreHorizontal } from 'lucide-react';
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
import { campaignAnalysisService } from '../../../services/campaignAnalysisService.js';
import { procurementService } from '../../../services/procurementService.js';
import { posService } from '../../../services/posService.js';
import { userService } from '../../../services/userService.js';
import { buildCampaignCreatedNotificationPayload, notificationService } from '../../../services/notificationService.js';
import { playNotificationTone, preloadNotificationTone } from '../../../utils/notificationSound.js';
import { normalizeTurkishText as normalizeMojibakeText } from '../../../utils/turkishText.js';
import { SUPPORT_CONTACT } from '../../../constants/contact.js';
import { getModuleLabelTr } from '../../../constants/moduleLabels.js';
import {
  applyBulkCampaignAction,
  buildCampaignEmptyState,
  buildCampaignSuggestionPresentation,
  buildCampaignSuggestions,
  calculateCampaignImpact,
  CAMPAIGN_SUGGESTION_MODULES,
  CAMPAIGN_TEMPLATE_LIBRARY,
  isCampaignSuggestionDiscountActionable,
  mapPricingRowsForCampaigns,
  mergeCrossModuleIntelligence,
  previewDynamicRuleImpact,
  resolveCampaignSuggestionDraftTarget,
} from './campaignManagementUtils.js';
import {
  autoSaleRunner,
  AUTO_SALE_DENSITY_OPTIONS,
  AUTO_SALE_DURATION_OPTIONS,
  DEFAULT_AUTO_SALE_CONFIG,
  DEFAULT_AUTO_SALE_SUMMARY,
} from './autoSaleRunner.js';
import { generateRandomCode } from './settingsCampaignHelpers.js';
import CampaignActionCandidatesTable from './CampaignActionCandidatesTable.jsx';
import { CampaignBarChart } from './CampaignBarChart.jsx';
import { CampaignGiftCardKpiRow } from './CampaignGiftCardPanel.jsx';
import {
  createDefaultCampaignDraft,
  normalizeCampaignDraftModuleKey,
  useCampaignDrafts,
} from './useCampaignDraftsByModule.js';

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

const initialForm = {
  currency: 'TRY',
  dateFormat: 'DD.MM.YYYY',
  storeName: '',
  branchCode: '',
  storeAddress: '',
  storePhone: '',
  storeEmail: '',
  taxNumber: '',
  openingTime: DEFAULT_OPENING_TIME,
  closingTime: DEFAULT_CLOSING_TIME,
  closedDays: [],
  holidayMode: false,
  weeklySchedule: createDefaultWeeklySchedule(),
  specialDays: [],
  logisticsTariffs: [],
  notificationSoundEnabled: true,
  notificationSoundVolume: 40,
  notificationSound: 'dragon-studio-clean-minimal-pop-467466.mp3',
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
    || /\bicin\s+(hızlı indirim|aksiyon|indirim onerisi|oneri)\b/.test(key);
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
  general: 'Mağaza Geneli',
  category: 'Kategori',
  product: 'Ürün',
  brand: 'Marka',
  expiry: 'SKT Bazlı',
  sales: 'Satış Bazlı',
  dynamic: 'Dinamik',
};

const CAMPAIGN_VIEW_KEYS = new Set(['all', 'product', 'category', 'brand', 'expiry', 'sales', 'giftCards', 'dynamic']);

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

const CAMPAIGN_SUGGESTION_STATUS_LABELS = {
  eligible: 'Uygun',
  suppressed: 'Bastırıldı',
  blocked: 'Bloklu',
  conflict: 'Çakışma',
};

const CAMPAIGN_RECOMMENDATION_TYPE_LABELS = {
  near_expiry: 'SKT Yaklaşan',
  near_expiry_suppressed: 'SKT Yaklaşan',
  overstock: 'Fazla Stok',
  overstock_suppressed: 'Fazla Stok',
  slow_moving: 'Yavaş Satan',
  slow_moving_suppressed: 'Yavaş Satan',
  discount_opportunity: 'İndirim Fırsatı',
  discount_opportunity_suppressed: 'İndirim Fırsatı',
  demand_down: 'Talep Düşüşü',
  demand_down_suppressed: 'Talep Düşüşü',
  margin_watch: 'Marj Takibi',
  margin_watch_suppressed: 'Marj Takibi',
  expired_product: 'SKT Geçmiş Ürün',
  expired_product_suppressed: 'SKT Geçmiş Ürün',
  expired_product_disposal_required: 'İmha / İade Gerekli',
  cross_module_priority: 'Çapraz Öncelik',
  cross_module_opportunity: 'Çapraz Fırsat',
  campaign_opportunity: 'Kampanya Fırsatı',
};

const CAMPAIGN_TABLE_PAGE_SIZE = 5;
const CAMPAIGN_CANDIDATE_PAGE_SIZE = 6;
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
const formatCampaignTableValue = (value, fallback = '—') => {
  const normalized = normalizeCampaignInsightText(String(value ?? '').trim());
  return normalized && normalized !== '-' ? normalized : fallback;
};
const formatCampaignMarginPercent = (row = {}) => {
  const margin = Number(row?.currentMarginPercent);
  const hasPricingBasis = Number(row?.currentPrice || 0) > 0 || Number(row?.cost || 0) > 0;
  if (!Number.isFinite(margin) || (!hasPricingBasis && margin === 0)) return 'Veri yok';
  return `%${formatNumber(margin)}`;
};
const formatCampaignRefreshDateTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Henüz güncellenmedi';
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

const getCampaignSuggestionStatus = (item = {}) => {
  const blockingReasons = Array.isArray(item.blockingReasons) ? item.blockingReasons : [];
  const hasConflict = Boolean(
    item.activeCampaignConflict
    || item.activeCampaignId
    || item.activeCampaignName
    || Number(item.sourceMetrics?.activeCampaignConflictCount || 0) > 0
    || blockingReasons.includes('active_campaign_conflict')
  );
  if (hasConflict) return 'conflict';
  if (item.isSuppressed || item.suppressed || item.suppressionReason) return 'suppressed';
  if (blockingReasons.length || item.blockingReason || item.conflictReason) return 'blocked';
  return 'eligible';
};
const isCampaignSuggestionActionable = (item = {}) => {
  if (getCampaignSuggestionStatus(item) === 'suppressed') return false;
  if (!isCampaignSuggestionDiscountActionable(item)) return false;
  return Number(item?.affectedProductCount || 0) > 0;
};

const getCampaignSuggestionStatusLabel = (item = {}) => CAMPAIGN_SUGGESTION_STATUS_LABELS[getCampaignSuggestionStatus(item)] || 'Uygun';
const getCampaignSuggestionStatusDisplayLabel = (item = {}) => ({
  eligible: 'Uygun',
  suppressed: 'Bastırıldı',
  blocked: 'Bloklu',
  conflict: 'Çakışma',
})[getCampaignSuggestionStatus(item)] || 'Uygun';
const getCampaignSuggestionStatusToneClass = (item = {}) => {
  const status = getCampaignSuggestionStatus(item);
  if (status === 'eligible') return 'is-success';
  if (status === 'conflict' || status === 'blocked') return 'is-danger';
  return 'is-neutral';
};

const formatCampaignRecommendationType = (value) => {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_');
  if (CAMPAIGN_RECOMMENDATION_TYPE_LABELS[key]) return CAMPAIGN_RECOMMENDATION_TYPE_LABELS[key];
  const readable = key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1))
    .join(' ');
  return normalizeCampaignInsightText(readable || 'Kampanya Fırsatı');
};

const CAMPAIGN_SCOPE_LABELS = {
  product: 'Ürün Bazlı',
  category: 'Kategori Bazlı',
  brand: 'Marka Bazlı',
  expiry: 'SKT / Fire Riski',
  sales: 'Satış Performansı',
  general: 'Mağaza Geneli',
  'urun kumesi': 'Ürün Grubu',
  'ürün kümesi': 'Ürün Grubu',
  'satis performansi': 'Satış Performansı',
  'satış performansı': 'Satış Performansı',
};

const formatCampaignScopeLabel = (value, fallback = 'Kampanya Kapsamı') => {
  const raw = normalizeCampaignInsightText(String(value || '').trim());
  if (!raw) return fallback;
  const key = raw.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
  const technicalKey = String(value || '').trim().toLocaleLowerCase('tr-TR').replace(/-/g, '_').replace(/\s+/g, ' ');
  return CAMPAIGN_SCOPE_LABELS[key] || CAMPAIGN_SCOPE_LABELS[technicalKey] || normalizeCampaignInsightText(raw);
};

const getCampaignSuggestionShortAction = (suggestion = {}) => {
  const recommendationType = String(suggestion?.recommendationType || suggestion?.id || '').toLocaleLowerCase('tr-TR');
  const actionText = normalizeCampaignInsightText(suggestion?.suggestedAction || suggestion?.action || '');
  if (recommendationType.includes('margin')) return 'Marj koruma önerisi';
  if (recommendationType.includes('overstock')) return 'Stok eritme önerisi';
  if (recommendationType.includes('expiry') || actionText.toLocaleLowerCase('tr-TR').includes('skt')) return 'Kısa süreli indirim';
  if (recommendationType.includes('demand') || recommendationType.includes('slow')) return 'Satış canlandırma önerisi';
  if (recommendationType.includes('discount')) return 'İndirim fırsatı';
  return actionText ? actionText.replace(/\.$/, '') : 'Kampanya önerisi';
};

const getCampaignSuggestionImpactSummary = (suggestion = {}) => {
  const secondaryTags = Array.isArray(suggestion.secondaryTags) ? suggestion.secondaryTags : [];
  const tags = secondaryTags.map((item) => normalizeCampaignInsightText(item)).filter(Boolean).slice(0, 3);
  if (tags.length) return tags.join(' | ');
  const impact = normalizeCampaignInsightText(suggestion.impactSummary || suggestion.riskSummary || suggestion.reason || '');
  return impact || 'Etki detayda';
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
  if (text.includes('Çoklu alım')) return 'is-warning';
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
    description: 'Seçili Ürünlerin brüt marjı.',
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
      recommendation: 'Kapsam seçimi yaptiktan veya veri geldikten sonra simülasyon hesaplanır.',
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
      ? `${formatNumber(productCount)} Ürün kapsamı ve ${formatNumber(analysisCandidateCount)} analiz adayı`
      : `${formatNumber(analysisCandidateCount)} Ürün`;
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
      recommendation: 'Bu kampanya kapsamı için yeterli satış geçmişi bulunmadıgindan tahmin Üretilemedi.',
      explanation: 'Bu kampanya kapsamı için yeterli satış geçmişi bulunmadıgindan tahmin Üretilemedi.',
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
    ? `${formatNumber(productCount)} Ürün kapsamı ve ${formatNumber(analysisCandidateCount)} analiz adayı`
    : `${formatNumber(analysisCandidateCount)} Ürün`;
  let recommendation = `${scopeLabel} için ${scopeCountText} Üzerinden hesaplanan simülasyon hazır.`;
  if (negativeMarginShare > 0.2) {
    recommendation = 'İndirim oranı mevcut marjı fazla zorluyor; kampanyayı daraltın veya oranı düşürün.';
  } else if (zeroStockShare > 0.15) {
    recommendation = 'Stok bulunmayan Ürünler etkiyi sınırlıyor; kampanya kapsamını stoğu hazır Ürünlerle netleştirin.';
  } else if (expiryPressureShare > 0.35) {
    recommendation = 'SKT baskısı yüksek Ürünler kampanyayı destekliyor; kısa süreli ve görünürlük odaklı bir akis Önerilir.';
  } else if (overStockShare > 0.3 && slowSellerShare > 0.35) {
    recommendation = 'Yavaş satan yüksek stoklu ürünlerde kampanya stok devrini anlamlı biçimde hızlandırabilir.';
  } else if (fastSellerShare > 0.35 && safeDiscount >= 20) {
    recommendation = 'Hızlı satan Ürünlerde yüksek indirim gereksiz marj kaybı yaratabilir; oranı daha kontrollü tutun.';
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
    active: 'Mağaza Geneli Aktif Kampanya Listesi',
    archive: 'Mağaza Geneli Kampanya Arşivi',
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
  general: 'Mağaza Geneli Kampanya Listesi',
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
    active: { title: 'Mağaza Geneli Aktif Kampanya Listesi', description: 'Mağaza geneli aktif kampanyalar.', icon: Megaphone },
    archive: { title: 'Mağaza Geneli Kampanya Arşivi', description: 'Mağaza geneli kampanyaların kapanan kayıtları.', icon: CalendarDays },
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
  { key: 'expiry', label: 'SKT Bazlı', type: 'expiry' },
  { key: 'sales', label: 'Satış Bazlı', type: 'sales' },
  { key: 'product', label: 'Ürün Bazlı', type: 'product' },
  { key: 'category', label: 'Kategori Bazlı', type: 'category' },
  { key: 'brand', label: 'Marka Bazlı', type: 'brand' },
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

const CAMPAIGN_UI_TURKISH_WORD_REPLACEMENTS = [
  [/\bMağaza\b/g, 'Mağaza'],
  [/\bmağaza\b/g, 'mağaza'],
  [/\bUrun\b/g, 'Ürün'],
  [/\burun\b/g, 'ürün'],
  [/\bUrunler\b/g, 'Ürünler'],
  [/\burunler\b/g, 'ürünler'],
  [/\bUrunlerde\b/g, 'Ürünlerde'],
  [/\burunlerde\b/g, 'ürünlerde'],
  [/\bSatış\b/g, 'Satış'],
  [/\bsatış\b/g, 'satış'],
  [/\bSecili\b/g, 'Seçili'],
  [/\bsecili\b/g, 'seçili'],
  [/\bSecim\b/g, 'Seçim'],
  [/\bsecim\b/g, 'seçim'],
  [/\bSecilen\b/g, 'Seçilen'],
  [/\bsecilen\b/g, 'seçilen'],
  [/\bTum\b/g, 'Tüm'],
  [/\btum\b/g, 'tüm'],
  [/\bYuksek\b/g, 'Yüksek'],
  [/\byuksek\b/g, 'yüksek'],
  [/\bDusuk\b/g, 'Düşük'],
  [/\bdusuk\b/g, 'düşük'],
  [/\bÖncelik\b/g, 'Öncelik'],
  [/\boncelik\b/g, 'öncelik'],
  [/\bOneri\b/g, 'Öneri'],
  [/\boneri\b/g, 'öneri'],
  [/\bOnerileri\b/g, 'Önerileri'],
  [/\bonerileri\b/g, 'önerileri'],
  [/\bOnerilen\b/g, 'Önerilen'],
  [/\bonerilen\b/g, 'önerilen'],
  [/\bGorunum\b/g, 'Görünüm'],
  [/\bgorunum\b/g, 'görünüm'],
  [/\bGorunurluk\b/g, 'Görünürlük'],
  [/\bgorunurluk\b/g, 'görünürlük'],
  [/\bHızlı\b/g, 'Hızlı'],
  [/\bhızlı\b/g, 'hızlı'],
  [/\bİndirim\b/g, 'İndirim'],
  [/\bindirim\b/g, 'indirim'],
  [/\bFırsat\b/g, 'Fırsat'],
  [/\bfırsat\b/g, 'fırsat'],
  [/\bFırsatlari\b/g, 'Fırsatları'],
  [/\bfırsatları\b/g, 'fırsatları'],
  [/\bYaklasan\b/g, 'Yaklaşan'],
  [/\byaklaşan\b/g, 'yaklaşan'],
  [/\bBaslangic\b/g, 'Başlangıç'],
  [/\bbaslangic\b/g, 'başlangıç'],
  [/\bBitis\b/g, 'Bitiş'],
  [/\bbitiş\b/g, 'bitiş'],
  [/\bIptal\b/g, 'İptal'],
  [/\biptal\b/g, 'iptal'],
  [/\bIcerik\b/g, 'İçerik'],
  [/\bicerik\b/g, 'içerik'],
  [/\bIc\b/g, 'İç'],
  [/\bic\b/g, 'iç'],
  [/\bSoguk\b/g, 'Soğuk'],
  [/\bsoguk\b/g, 'soğuk'],
  [/\bSehirlerarasi\b/g, 'Şehirlerarası'],
  [/\bsehirlerarasi\b/g, 'şehirlerarası'],
  [/\bCarsamba\b/g, 'Çarşamba'],
  [/\bPersembe\b/g, 'Perşembe'],
  [/\bSali\b/g, 'Salı'],
  [/\bKayit\b/g, 'Kayıt'],
  [/\bkayit\b/g, 'kayıt'],
  [/\bArsiv\b/g, 'Arşiv'],
  [/\barsiv\b/g, 'arşiv'],
  [/\bYayinda\b/g, 'Yayında'],
  [/\byayında\b/g, 'yayında'],
  [/\bPlanlandı\b/g, 'Planlandı'],
  [/\bplanlandi\b/g, 'planlandı'],
];

const normalizeCampaignUiText = (value) => {
  const repaired = normalizeMojibakeText(repairSettingsMojibake(String(value || '')));
  const normalized = SETTINGS_TURKISH_TEXT_REPLACEMENTS.reduce(
    (text, [wrong, correct]) => text.split(wrong).join(correct),
    repaired,
  );
  const withTurkishWords = CAMPAIGN_UI_TURKISH_WORD_REPLACEMENTS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    normalized,
  );
  return normalizeMojibakeText(withTurkishWords);
};

const CAMPAIGN_INSIGHT_TURKISH_WORD_REPLACEMENTS = [
  [/\bURUN\b/g, 'ÜRÜN'],
  [/\bUrun\b/g, 'Ürün'],
  [/\burun\b/g, 'Ürün'],
  [/\bSATIS\b/g, 'SATIS'],
  [/\bSatış\b/g, 'Satış'],
  [/\bsatış\b/g, 'satış'],
  [/\bONERI\b/g, 'ÖNERİ'],
  [/\bOneri\b/g, 'Öneri'],
  [/\boneri\b/g, 'Öneri'],
  [/\bONERILEN\b/g, 'ÖNERİLEN'],
  [/\bOnerilen\b/g, 'Önerilen'],
  [/\bonerilen\b/g, 'Önerilen'],
  [/\bGUNLUK\b/g, 'GÜNLÜK'],
  [/\bGunluk\b/g, 'Günlük'],
  [/\bgunluk\b/g, 'günlük'],
  [/\bDUSUK\b/g, 'DÜŞÜK'],
  [/\bDusuk\b/g, 'Düşük'],
  [/\bdusuk\b/g, 'düşük'],
  [/\bSEÇİLDI\b/g, 'SEÇİLDİ'],
  [/\bSecildi\b/g, 'Seçildi'],
  [/\bsecildi\b/g, 'seçildi'],
  [/\bSEÇİM\b/g, 'SEÇİM'],
  [/\bSecim\b/g, 'Seçim'],
  [/\bsecim\b/g, 'seçim'],
  [/\bSEÇİLI\b/g, 'SEÇİLİ'],
  [/\bSecili\b/g, 'Seçili'],
  [/\bsecili\b/g, 'seçili'],
  [/\bONCELIK\b/g, 'ÖNCELİK'],
  [/\bÖncelik\b/g, 'Öncelik'],
  [/\boncelik\b/g, 'Öncelik'],
  [/\bYETERLILIGI\b/g, 'YETERLILIGI'],
  [/\bYeterliligi\b/g, 'Yeterliligi'],
  [/\byeterliligi\b/g, 'yeterliligi'],
  [/\bTUKENME\b/g, 'TÜKENME'],
  [/\bTukenme\b/g, 'Tükenme'],
  [/\btukenme\b/g, 'tükenme'],
  [/\bBRUT\b/g, 'BRÜT'],
  [/\bBrut\b/g, 'Brüt'],
  [/\bbrut\b/g, 'brüt'],
  [/\bISLEM\b/g, 'ISLEM'],
  [/\bIslem\b/g, 'İşlem'],
  [/\bişlem\b/g, 'işlem'],
  [/\bHIZLI\b/g, 'HIZLI'],
  [/\bHızlı\b/g, 'Hızlı'],
  [/\bhızlı\b/g, 'hızlı'],
  [/\bOLUSTUR\b/g, 'OLUSTUR'],
  [/\bOluştur\b/g, 'Oluştur'],
  [/\boluştur\b/g, 'oluştur'],
  [/\bGERCEK\b/g, 'GERÇEK'],
  [/\bGercek\b/g, 'Gerçek'],
  [/\bgercek\b/g, 'gerçek'],
  [/\bINDIRIM\b/g, 'INDIRIM'],
  [/\bİndirim\b/g, 'İndirim'],
  [/\bindirim\b/g, 'indirim'],
  [/\bARTISI\b/g, 'ARTISI'],
  [/\bArtisi\b/g, 'Artisi'],
  [/\bartışı\b/g, 'artışı'],
  [/\bURUNDE\b/g, 'ÜRÜNDE'],
  [/\bUrunde\b/g, 'Üründe'],
  [/\burunde\b/g, 'Üründe'],
  [/\bURUNLERDE\b/g, 'ÜRÜNLERDE'],
  [/\bUrunlerde\b/g, 'Ürünlerde'],
  [/\burunlerde\b/g, 'Ürünlerde'],
  [/\bYAKLASAN\b/g, 'YAKLAŞAN'],
  [/\bYaklasan\b/g, 'Yaklaşan'],
  [/\byaklaşan\b/g, 'yaklaşan'],
  [/\bBASKISI\b/g, 'BASKISI'],
  [/\bBaskisi\b/g, 'Baskisi'],
  [/\bbaskısı\b/g, 'baskısı'],
  [/\bDEGERLENDIRILDI\b/g, 'DEGERLENDIRILDI'],
  [/\bDegerlendirildi\b/g, 'Degerlendirildi'],
  [/\bdeğerlendirildi\b/g, 'değerlendirildi'],
  [/\bHIZI\b/g, 'HIZI'],
  [/\bHızı\b/g, 'Hızı'],
  [/\bhızı\b/g, 'hızı'],
  [/\bORANI\b/g, 'ORANI'],
  [/\bOrani\b/g, 'Orani'],
  [/\boranı\b/g, 'oranı'],
  [/\bAKISINA\b/g, 'AKISINA'],
  [/\bAkisina\b/g, 'Akisina'],
  [/\bakisina\b/g, 'akisina'],
  [/\bAKTARILIR\b/g, 'AKTARILIR'],
  [/\bAktarilir\b/g, 'Aktarilir'],
  [/\baktarilir\b/g, 'aktarilir'],
  [/\bHIZINI\b/g, 'HIZINI'],
  [/\bHızıni\b/g, 'Hızıni'],
  [/\bhızıni\b/g, 'hızıni'],
  [/\bARTIRMA\b/g, 'ARTIRMA'],
  [/\bArtirma\b/g, 'Artirma'],
  [/\bartırma\b/g, 'artırma'],
  [/\bGOSTER\b/g, 'GÖSTER'],
  [/\bGoster\b/g, 'Göster'],
  [/\bgoster\b/g, 'göster'],
  [/\bKirtasiye\b/g, 'Kirtasiye'],
  [/\bkirtasiye\b/g, 'kirtasiye'],
  [/\bIcecek\b/g, 'İçecek'],
  [/\bicecek\b/g, 'içecek'],
  [/\bKagit\b/g, 'Kagit'],
  [/\bkagit\b/g, 'kagit'],
  [/\bislak\b/g, 'islak'],
  [/\bSut\b/g, 'Süt'],
  [/\bsut\b/g, 'süt'],
  [/\bKahvaltilik\b/g, 'Kahvaltilik'],
  [/\bkahvaltilik\b/g, 'kahvaltilik'],
  [/\bGida\b/g, 'Gida'],
  [/\bgida\b/g, 'gida'],
  [/\bFirin\b/g, 'Firin'],
  [/\bfirin\b/g, 'firin'],
  [/\bKisisel\b/g, 'Kisisel'],
  [/\bkisisel\b/g, 'kisisel'],
  [/\bBakim\b/g, 'Bakim'],
  [/\bbakim\b/g, 'bakim'],
  [/\bSaglik\b/g, 'Saglik'],
  [/\bsaglik\b/g, 'saglik'],
  [/\bYasam\b/g, 'Yasam'],
  [/\byasam\b/g, 'yasam'],
  [/\bHazir\b/g, 'Hazir'],
  [/\bhazır\b/g, 'hazır'],
  [/\bBalik\b/g, 'Balik'],
  [/\bbalik\b/g, 'balik'],
  [/\bAtıştırmalık\b/g, 'Atıştırmalık'],
  [/\batistirmalik\b/g, 'atistirmalik'],
  [/\bTedarikci\b/g, 'Tedarikçi'],
  [/\btedarikci\b/g, 'tedarikçi'],
  [/\bCok\b/g, 'Çok'],
  [/\bcok\b/g, 'Çok'],
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

const normalizeCampaignInsightText = (value) => normalizeCampaignUiText(
  CAMPAIGN_INSIGHT_TURKISH_WORD_REPLACEMENTS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    normalizeCampaignText(value),
  )
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
  archived: 'Arsiv',
});

Object.assign(CAMPAIGN_MODULE_TABLE_TITLES, {
  all: { active: 'Aktif Kampanya Listesi', archive: 'Kampanya Arşivi' },
  general: { active: 'Mağaza Geneli Aktif Kampanya Listesi', archive: 'Mağaza Geneli Kampanya Arşivi' },
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
  { value: 'notify', label: 'Bildirim Günder' },
  { value: 'create_task', label: 'Görev Oluştur' },
  { value: 'notify_and_task', label: 'Bildirim + Görev' },
  { value: 'create_campaign', label: 'Kampanya Oluştur' },
  { value: 'apply_discount', label: 'İndirim Uygula' },
  { value: 'assign_task', label: 'Görev Ata' },
];

const normalizeCodeValue = (value) => String(value || '').trim().toUpperCase();

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
  if (text === 'Zeynep ^ahin') return 'Zeynep Sahin';
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
        targetCategoryLabelIds: Array.isArray(item?.targetCategoryLabelIds) ?
           item.targetCategoryLabelIds.map((id) => String(id || '').trim()).filter(Boolean)
          : [],
        targetCategoryLabels: Array.isArray(item?.targetCategoryLabels) ?
           item.targetCategoryLabels.map((label) => normalizeCampaignInsightText(label)).filter(Boolean)
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

const isCampaignPastEndDate = (campaign = {}, now = new Date()) => {
  if (!campaign || campaign.isIndefinite) return false;
  const endsAt = getCampaignEndBoundary(campaign);
  return Boolean(endsAt && now > endsAt);
};

const isDefaultCampaignArchiveRow = (campaign = {}, now = new Date()) => (
  !isCampaignCurrentlyActive(campaign, now)
  && !isCampaignPlanned(campaign, now)
  && !isCampaignPastEndDate(campaign, now)
);

const formatCampaignDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('tr-TR');
};

const normalizeCampaignBrandKey = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const getCampaignProductMatch = (campaign = {}, product = {}) => {
  const productId = String(product?.id || product?.productId || '').trim();
  const categoryId = String(product?.categoryId || '').trim();
  const categoryLabelId = String(product?.labelId || product?.tagId || product?.selectedTagId || product?.categoryLabelId || '').trim();
  const categoryLabelName = normalizeSearchText(product?.etiket || product?.categoryLabelName || product?.labelName || product?.tag || '');
  const brand = normalizeCampaignBrandKey(product?.brand || product?.brandName);
  const targetProductIds = Array.isArray(campaign.targetProductIds) ? campaign.targetProductIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  const targetCategoryIds = Array.isArray(campaign.targetCategoryIds) ? campaign.targetCategoryIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  const targetCategoryLabelIds = Array.isArray(campaign.targetCategoryLabelIds) ? campaign.targetCategoryLabelIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  const targetCategoryLabelNames = Array.isArray(campaign.targetCategoryLabels) ? campaign.targetCategoryLabels.map(normalizeSearchText).filter(Boolean) : [];
  const targetBrands = Array.isArray(campaign.targetBrands) ? campaign.targetBrands.map(normalizeCampaignBrandKey).filter(Boolean) : [];
  const productMatched = productId && targetProductIds.includes(productId);
  const labelMatched = targetCategoryLabelIds.length
    ? (categoryLabelId && targetCategoryLabelIds.includes(categoryLabelId)) || (categoryLabelName && targetCategoryLabelNames.includes(categoryLabelName))
    : true;
  const categoryMatched = categoryId && targetCategoryIds.includes(categoryId) && labelMatched;
  const brandMatched = brand && targetBrands.includes(brand);
  const hasExplicitScope = targetProductIds.length || targetCategoryIds.length || targetCategoryLabelIds.length || targetBrands.length;
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

const mapSettingsToForm = (data = {}) => {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
  ...(() => {
    const weeklySchedule = normalizeWeeklySchedule({
      weeklySchedule: source.weeklySchedule,
      openingTime: source.openingTime,
      closingTime: source.closingTime,
      closedDays: source.closedDays,
    });
    const legacy = deriveLegacyWorkingHours(weeklySchedule);
    return {
      openingTime: legacy.openingTime,
      closingTime: legacy.closingTime,
      closedDays: legacy.closedDays,
      weeklySchedule,
      holidayMode: Boolean(source.holidayMode),
      specialDays: normalizeSpecialDays(source.specialDays),
    };
  })(),
  currency: 'TRY',
  dateFormat: source.dateFormat || 'DD.MM.YYYY',
  storeName: source.storeName || '',
  branchCode: source.branchCode || '',
  storeAddress: source.storeAddress || '',
  storePhone: source.storePhone || '',
  storeEmail: source.storeEmail || '',
  taxNumber: source.taxNumber || '',
  logisticsTariffs: normalizeLogisticsTariffs(source.logisticsTariffs),
  customerRelations: {
    giftCards: normalizeGiftCards(source?.customerRelations?.giftCards),
    campaigns: normalizeCampaigns(source?.customerRelations?.campaigns),
    automationCenter: normalizeAutomationCenter(source?.customerRelations?.automationCenter),
  },
  };
};

const SYSTEM_DESK_ROWS = [
  { code: 'B1', label: 'Kasa 1 PIN' },
  { code: 'B2', label: 'Kasa 2 PIN' },
  { code: 'B3', label: 'Kasa 3 PIN' },
  { code: 'B4', label: 'Kasa 4 PIN' },
  { code: 'B5', label: 'Kasa 5 PIN' },
  { code: 'B6', label: 'Kasa 6 PIN' },
  { code: 'B7', label: 'Kasa 7 PIN' },
  { code: 'B8', label: 'Yönetim Kasasi PIN' },
];

const AUTO_SALE_DESK_OPTIONS = SYSTEM_DESK_ROWS.map((row) => ({
  code: row.code,
  label: row.label.replace(/\s*PIN$/i, ''),
}));

const AUTO_SALE_PAYMENT_LABELS = {
  cash: 'Nakit',
  card: 'Kart',
  qr: 'QR Ödeme',
  eft: 'Havale/EFT',
  giftcard: 'Hediye Kartı',
};

const LICENSE_STATUS_META = {
  active: { label: 'Aktif', tone: 'active' },
  activated: { label: 'Aktif', tone: 'active' },
  expired: { label: 'Süresi dolmuş', tone: 'expired' },
  suspended: { label: 'Askıya alınmış', tone: 'suspended' },
  revoked: { label: 'İptal edilmiş', tone: 'revoked' },
  canceled: { label: 'İptal edilmiş', tone: 'revoked' },
  cancelled: { label: 'İptal edilmiş', tone: 'revoked' },
  pending: { label: 'Beklemede', tone: 'pending' },
};

const LICENSE_PLAN_LABELS = {
  starter: 'Başlangıç',
  basic: 'Başlangıç',
  professional: 'Profesyonel',
  pro: 'Profesyonel',
  enterprise: 'Kurumsal',
};

const pickLicenseExpiryValue = (...sources) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const value = source.expiresAt ?? source.expires_at ?? source.validUntil ?? source.renewalDate ?? source.renewalAt;
    if (value !== null && value !== undefined && String(value).trim()) return value;
  }
  return null;
};

const formatLicenseExpiryDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Istanbul',
  }).format(date);
};

export const formatLicenseExpiryDisplay = (license = {}, summary = {}) => {
  const status = String(summary?.status || license?.status || '').trim().toLowerCase();
  const isExpired = status === 'expired';
  const isDemo = summary?.isDemo === true
    || license?.isDemo === true
    || String(summary?.planSlug || license?.planSlug || license?.plan || license?.planCode || '').trim().toLowerCase() === 'demo'
    || String(summary?.licenseType || license?.licenseType || '').trim().toLowerCase() === 'demo';
  const expiryValue = pickLicenseExpiryValue(summary, license);
  const remainingDays = Number(summary?.remainingDays ?? license?.remainingDays);
  const hasRemainingDays = Number.isFinite(remainingDays);

  if (!expiryValue) {
    return isExpired ? 'Süresi doldu' : '∞ Süresiz';
  }

  const dateLabel = formatLicenseExpiryDate(expiryValue);
  const expiryTime = new Date(expiryValue).getTime();
  const expiredByDate = Number.isFinite(expiryTime) && expiryTime < Date.now();
  if (isExpired || expiredByDate || (hasRemainingDays && remainingDays < 0)) {
    return dateLabel ? `${dateLabel} · Süresi doldu` : 'Süresi doldu';
  }

  if (isDemo && hasRemainingDays) {
    const days = Math.max(0, Math.floor(remainingDays));
    return dateLabel ? `${dateLabel} · ${days} gün kaldı` : `${days} gün kaldı`;
  }

  return dateLabel || '∞ Süresiz';
};

const formatLicenseDate = (value) => {
  if (!value) return '-';
  return formatDate(value) || '-';
};

const maskLicenseKeyForDisplay = (value) => {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!normalized) return '-';
  if (normalized.includes('****')) return normalized;

  const parts = normalized.split('-').filter(Boolean);
  if (parts.length >= 3) {
    return [parts[0], ...parts.slice(1, -1).map(() => '****'), parts[parts.length - 1]].join('-');
  }

  if (normalized.length <= 8) return '****';
  return `${normalized.slice(0, 4)}-****-${normalized.slice(-4)}`;
};

const getLicenseStatusMeta = (status) => {
  const key = String(status || '').trim().toLowerCase();
  return LICENSE_STATUS_META[key] || { label: status || 'Beklemede', tone: 'pending' };
};

const getLicensePlanLabel = (license = {}, plan = {}) => {
  const name = plan?.name || license?.planName || license?.planLabel;
  if (name) return name;
  const code = String(plan?.code || license?.plan || license?.planCode || '').trim().toLowerCase();
  return LICENSE_PLAN_LABELS[code] || code || '-';
};

const getLicenseModuleLabel = (value) => {
  return getModuleLabelTr(value, normalizeMojibakeText(String(value || '').replace(/_/g, ' ')));
};

const uniqueLicenseModules = (modules = []) => {
  const seen = new Set();
  return (Array.isArray(modules) ? modules : [])
    .map(getLicenseModuleLabel)
    .filter(Boolean)
    .filter((label) => {
      const key = normalizeSearchText(label);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const buildLicenseOverview = (user = {}, form = {}) => {
  const license = user?.license || {};
  const summary = user?.licenseSummary || license?.licenseSummary || {};
  const plan = user?.plan || {};
  const tenant = user?.tenant || {};
  const activeStore = user?.activeStore || {};
  const limits = license?.limits || {};
  const enabledModules = uniqueLicenseModules(license.enabledModules || user?.enabledModules || []);

  return {
    status: getLicenseStatusMeta(license.status),
    maskedKey: maskLicenseKeyForDisplay(license.maskedKey || license.licenseKey),
    plan: getLicensePlanLabel(license, plan),
    tenantName: tenant.name || license.tenantName || '-',
    storeName: activeStore.name || form.storeName || license.storeName || '-',
    startsAt: formatLicenseDate(license.startsAt || license.activatedAt || license.createdAt),
    expiresAt: formatLicenseExpiryDisplay(license, summary),
    enabledModules,
    limits: [
      { key: 'stores', label: 'Mağaza limiti', value: limits.stores ?? license.storeLimit },
      { key: 'users', label: 'Kullanıcı limiti', value: limits.users ?? license.userLimit },
      { key: 'eslDevices', label: 'ESL / cihaz limiti', value: limits.eslDevices ?? license.eslDeviceLimit },
    ].filter((item) => item.value !== null && item.value !== undefined && item.value !== ''),
  };
};

const AUTO_SALE_TRANSACTION_TYPE_LABELS = {
  sale: 'Satış',
  return: 'Iade',
};

const formatAutoSaleRemainingTime = (milliseconds) => {
  if (milliseconds === null || milliseconds === undefined) return 'Manuel';
  const totalSeconds = Math.max(0, Math.ceil(Number(milliseconds || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const NOTIFICATION_SOUND_ENABLED_KEY = 'shelfio.toast.sound.enabled';
const NOTIFICATION_SOUND_VOLUME_KEY = 'shelfio.toast.sound.volume';
const DEFAULT_NOTIFICATION_SOUND = 'dragon-studio-clean-minimal-pop-467466.mp3';

const NOTIFICATION_SOUNDS = [
  { value: 'dragon-studio-clean-minimal-pop-467466.mp3', label: 'Bildirim 1' },
  { value: 'dragon-studio-new-notification-3-398649.mp3', label: 'Bildirim 2' },
  { value: 'dragon-studio-new-notification-444814.mp3', label: 'Bildirim 3' },
  { value: 'dragon-studio-notification-click-sound-455421.mp3', label: 'Bildirim 4' },
  { value: 'dragon-studio-notification-sound-effect-372475.mp3', label: 'Bildirim 5' },
  { value: 'dragon-studio-pop-402322.mp3', label: 'Bildirim 6' },
  { value: 'soundshelfstudio-ui-app-notification-524745.mp3', label: 'Bildirim 7' },
  { value: 'universfield-new-notification-010-352755.mp3', label: 'Bildirim 8' },
  { value: 'universfield-new-notification-016-350210.mp3', label: 'Bildirim 9' },
  { value: 'universfield-new-notification-038-487899 (1).mp3', label: 'Bildirim 10' },
  { value: 'universfield-new-notification-038-487899.mp3', label: 'Bildirim 11' },
  { value: 'universfield-new-notification-051-494246.mp3', label: 'Bildirim 12' },
  { value: 'universfield-new-notification-062-494544.mp3', label: 'Bildirim 13' },
];

const clampSoundVolume = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 40;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const normalizeNotificationSound = (value) => {
  const normalized = String(value || '').trim();
  return NOTIFICATION_SOUNDS.some((sound) => sound.value === normalized)
    ? normalized
    : DEFAULT_NOTIFICATION_SOUND;
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

const getAuditActorName = (row = {}) => row.actorName || row.actor || row.userName || '-';
const getAuditActionLabel = (row = {}) => row.actionLabel || row.action || 'Kullanıcı işlemi';
const getAuditSummary = (row = {}) => row.summary || row.details || row.detail || row.note || '-';
const getAuditObjectLabel = (row = {}) => row.entityLabel || row.entityId || row.referenceCode || row.requestId || '-';
const getAuditStatusLabel = (row = {}) => {
  if (row.statusCode) return String(row.statusCode);
  if (row.severity) return String(row.severity);
  return '-';
};
const getAuditMetadataJson = (row = {}) => {
  const value = row.metadata || row.payload || null;
  if (!value) return 'Metadata bulunmuyor.';
  try {
    return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2);
  } catch {
    return String(value);
  }
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
  if (row.os || row.browser) {
    return {
      os: row.os || 'Bilinmiyor',
      browser: row.browser || 'Bilinmiyor',
    };
  }
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

const LOGIN_EVENT_LABELS = {
  login_success: 'Başarılı giriş',
  login_failed: 'Başarısız giriş',
  logout: 'Çıkış',
  token_refresh: 'Oturum yenileme',
};

const LOGIN_SOURCE_LABELS = {
  admin_web: 'Admin/Web',
  personnel_mobile: 'Personel Mobil',
  customer_mobile: 'Müşteri Mobil',
};

const LOGIN_STATUS_LABELS = {
  success: 'Başarılı',
  failed: 'Başarısız',
};

const getLoginEventLabel = (value) => LOGIN_EVENT_LABELS[String(value || '').trim()] || String(value || '-');
const getLoginSourceLabel = (value) => LOGIN_SOURCE_LABELS[String(value || '').trim()] || String(value || '-');
const getLoginStatusLabel = (value) => LOGIN_STATUS_LABELS[String(value || '').trim()] || String(value || '-');
const getLoginActorName = (row = {}) => row.name || row.userName || row.username || row.email || '-';

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
  module: '',
  source: '',
  status: '',
  from: '',
  to: '',
  user: '',
  search: '',
};

const DEFAULT_LOGIN_ACTIVITY_FILTERS = {
  user: '',
  eventType: '',
  source: '',
  status: '',
  from: '',
  to: '',
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
      try {
        window.localStorage.removeItem('pricingCampaignDraft');
        window.localStorage.removeItem('orderCampaignDraft');
      } catch {
        // ignore cleanup errors
      }
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
    return parsed.flatMap((item, index) => buildLogDetailLines(item, prefix ? `${prefix} ${index + 1}` : `Satir ${index + 1}`));
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
    log.errorType ? `Hata Sinifi: ${log.errorType}` : '',
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
  const [availableCategoryLabels, setAvailableCategoryLabels] = useState([]);
  const [availableProducts, setAvailableProducts] = useState([]);
  const [availableBrands, setAvailableBrands] = useState([]);
  const [availableProductsLoading, setAvailableProductsLoading] = useState(false);
  const [availableProductsLoaded, setAvailableProductsLoaded] = useState(false);

  const [giftCardModalOpen, setGiftCardModalOpen] = useState(false);
  const [customerRelationsModalTab, setCustomerRelationsModalTab] = useState('giftCards');
  const [giftCardCloseConfirmOpen, setGiftCardCloseConfirmOpen] = useState(false);
  const [giftCardDraft, setGiftCardDraft] = useState(createDefaultGiftCardDraft());
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
  const [loginActivitiesLoading, setLoginActivitiesLoading] = useState(false);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const [loadedLogTabs, setLoadedLogTabs] = useState(new Set());
  const [developerLogDetailLoading, setDeveloperLogDetailLoading] = useState(false);
  const [exportingPdfType, setExportingPdfType] = useState('');
  const [autoSalePanelOpen, setAutoSalePanelOpen] = useState(false);
  const [autoSaleActive, setAutoSaleActive] = useState(false);
  const [autoSaleConfig, setAutoSaleConfig] = useState(DEFAULT_AUTO_SALE_CONFIG);
  const [autoSaleSummary, setAutoSaleSummary] = useState(DEFAULT_AUTO_SALE_SUMMARY);
  const [autoSaleError, setAutoSaleError] = useState('');
  const [autoSaleRemainingMs, setAutoSaleRemainingMs] = useState(null);
  const [autoSaleRecentTransactions, setAutoSaleRecentTransactions] = useState([]);
  const [autoSaleAvailability, setAutoSaleAvailability] = useState(null);
  const [campaignTypeView, setCampaignTypeView] = useState(() => {
    if (typeof window === 'undefined') return 'all';
    try {
      const params = new URLSearchParams(window.location.search);
      return normalizeCampaignViewKey(params.get('campaignView'), 'all');
    } catch {
      return 'all';
    }
  });
  const [selectedCampaignIdsByModule, setSelectedCampaignIdsByModule] = useState({});
  const [bulkDiscountRate, setBulkDiscountRate] = useState('15');
  const [suggestionRefreshKey, setSuggestionRefreshKey] = useState(0);
  const [campaignSuggestionRefreshing, setCampaignSuggestionRefreshing] = useState(false);
  const [campaignSuggestionRefreshedAt, setCampaignSuggestionRefreshedAt] = useState(null);
  const [campaignCandidatePagesByModule, setCampaignCandidatePagesByModule] = useState({});
  const [campaignTablePages, setCampaignTablePages] = useState({});
  const [homeCampaignTableView, setHomeCampaignTableView] = useState('active');
  const [selectedCampaignDetail, setSelectedCampaignDetail] = useState(null);
  const [editingCampaignId, setEditingCampaignId] = useState('');
  const [selectedCampaignSuggestion, setSelectedCampaignSuggestion] = useState(null);
  const [openCampaignActionMenuId, setOpenCampaignActionMenuId] = useState(null);
  const [campaignModuleUiState, setCampaignModuleUiState] = useState({});
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
  const [campaignInsightPages, setCampaignInsightPages] = useState({});
  const {
    activeCampaignDraftModule,
    campaignDraft,
    updateCampaignDraft,
    hydrateCampaignDraft,
    resetCampaignDraft,
    resetAllCampaignDrafts,
  } = useCampaignDrafts(campaignTypeView);
  const setCampaignDraft = (updater) => updateCampaignDraft(activeCampaignDraftModule, updater);
  const getCampaignModuleUiState = (moduleKey = activeCampaignDraftModule) => {
    const safeModuleKey = normalizeCampaignDraftModuleKey(moduleKey, 'general');
    return campaignModuleUiState[safeModuleKey] || {};
  };
  const updateCampaignModuleUiState = (moduleKey, patch) => {
    const safeModuleKey = normalizeCampaignDraftModuleKey(moduleKey, 'general');
    setCampaignModuleUiState((current) => ({
      ...current,
      [safeModuleKey]: {
        ...(current[safeModuleKey] || {}),
        ...(typeof patch === 'function' ? patch(current[safeModuleKey] || {}) : patch),
      },
    }));
  };
  const activeCampaignModuleUiState = getCampaignModuleUiState(activeCampaignDraftModule);
  const productCampaignSearch = activeCampaignModuleUiState.productSearch || '';
  const categoryLabelSearch = activeCampaignModuleUiState.categoryLabelSearch || '';
  const brandCampaignSearch = activeCampaignModuleUiState.brandSearch || '';
  const setProductCampaignSearch = (value) => updateCampaignModuleUiState(activeCampaignDraftModule, { productSearch: value });
  const setCategoryLabelSearch = (value) => updateCampaignModuleUiState(activeCampaignDraftModule, { categoryLabelSearch: value });
  const setBrandCampaignSearch = (value) => updateCampaignModuleUiState(activeCampaignDraftModule, { brandSearch: value });
  const selectedCampaignIds = selectedCampaignIdsByModule[campaignTypeView] || [];
  const setSelectedCampaignIds = (updater) => {
    setSelectedCampaignIdsByModule((current) => {
      const previous = current[campaignTypeView] || [];
      const next = typeof updater === 'function' ? updater(previous) : updater;
      return {
        ...current,
        [campaignTypeView]: Array.isArray(next) ? next : [],
      };
    });
  };

  const loadCampaignProducts = async ({ forceRefresh = false, includeCampaignDetails = true } = {}) => {
    if (availableProductsLoading) return;
    if (availableProductsLoaded && !forceRefresh) return;
    setAvailableProductsLoading(true);
    try {
      const products = await productService.list({
        universe: 'listed_active',
        includeUnlisted: false,
        includeTotal: false,
        fetchAll: true,
        includeCampaignDetails,
        forceRefresh,
      });
      const list = Array.isArray(products) ? products : [];
      setAvailableProducts(list);
      setAvailableBrands(buildCampaignBrandOptions(list));
      setAvailableProductsLoaded(true);
    } catch (error) {
      setAvailableProducts([]);
      setAvailableBrands([]);
      setToast({
        type: 'error',
        title: 'Kampanya Ürünleri',
        message: error?.message || 'Ürün verileri yüklenemedi.',
      });
    } finally {
      setAvailableProductsLoading(false);
    }
  };
  const campaignEditScope = ['general', 'product', 'category', 'brand'].includes(String(campaignDraft.type || '').trim())
    ? String(campaignDraft.type || '').trim()
    : 'general';
  const safeForm = form && typeof form === 'object' && !Array.isArray(form) ? form : initialForm;
  const notificationSoundEnabled = safeForm.notificationSoundEnabled !== false;
  const notificationSoundVolume = clampSoundVolume(safeForm.notificationSoundVolume);
  const notificationSound = normalizeNotificationSound(safeForm.notificationSound);
  const updateNotificationSoundSettings = (patch) => {
    setForm((current) => ({
      ...current,
      ...(typeof patch === 'function' ? patch(current) : patch),
    }));
  };

  const [securityUnlocked, setSecurityUnlocked] = useState(false);
  const [securityEditMode, setSecurityEditMode] = useState(false);
  const [showPinGate, setShowPinGate] = useState(false);

  const isAdmin = user?.role === 'admin';
  const isPlatformAdmin = Boolean(user?.isSuperUser);
  const autoSaleValidationMessage = useMemo(
    () => autoSaleRunner.validate(autoSaleConfig),
    [autoSaleConfig],
  );
  const resolvedPageMode = pageMode === 'campaign' || pageMode === 'settings'
    ? pageMode
    : (location.pathname === '/kampanya-yonetimi' ? 'campaign' : 'settings');
  const isCampaignPage = resolvedPageMode === 'campaign';
  const isSettingsPage = resolvedPageMode === 'settings';
  const isAnyPinSaving = Boolean(savingDeskCode) || savingSystemManagementPin || savingRoleManagementPin;
  const weeklyScheduleRows = useMemo(
    () => normalizeWeeklySchedule({ weeklySchedule: safeForm.weeklySchedule }),
    [safeForm.weeklySchedule],
  );
  const selectedScheduleRow = useMemo(
    () => weeklyScheduleRows.find((row) => row.dayKey === selectedScheduleDay) || weeklyScheduleRows[0] || null,
    [weeklyScheduleRows, selectedScheduleDay],
  );

  const triggerLogTabLoad = useCallback(async (tabName, force = false) => {
    if ((!isSettingsPage && !isCampaignPage) || activityLogCollapsed) {
      return;
    }

    if (loadedLogTabs.has(tabName) && !force) {
      return;
    }

    try {
      if (tabName === 'activity') {
        if (!isAdmin) return;
        setLoginActivitiesLoading(true);
        const rows = await settingsService.getLoginActivities(20);
        setLoginActivities(sanitizeObjectRows(rows));
        setLoginActivitiesTotal(extractResponseTotal(rows));
      } else if (tabName === 'audit') {
        if (!isAdmin) return;
        setAuditLogsLoading(true);
        const rows = await settingsService.getAuditLogs(50);
        setAuditLogs(sanitizeObjectRows(rows));
        setAuditLogsTotal(extractResponseTotal(rows));
      } else if (tabName === 'developer') {
        if (!isPlatformAdmin) return;
        setDeveloperLogsLoading(true);
        const rows = await settingsService.getDeveloperLogs({ ...developerLogFilters, limit: 50 });
        setDeveloperLogs(sanitizeObjectRows(rows));
        setDeveloperLogsTotal(extractResponseTotal(rows));
      }

      setLoadedLogTabs((prev) => {
        const next = new Set(prev);
        next.add(tabName);
        return next;
      });
    } catch (error) {
      console.error(`[SettingsCampaignShell:loadLogTab:${tabName}]`, error);
    } finally {
      if (tabName === 'activity') setLoginActivitiesLoading(false);
      if (tabName === 'audit') setAuditLogsLoading(false);
      if (tabName === 'developer') setDeveloperLogsLoading(false);
    }
  }, [isSettingsPage, isCampaignPage, activityLogCollapsed, loadedLogTabs, isAdmin, isPlatformAdmin, developerLogFilters]);

  useEffect(() => {
    if (!activityLogCollapsed && (isSettingsPage || isCampaignPage)) {
      void triggerLogTabLoad(activityLogTab);
    }
  }, [activityLogTab, activityLogCollapsed, isSettingsPage, isCampaignPage, triggerLogTabLoad]);

  const logisticsCargoTypeSummary = useMemo(() => {
    const grouped = new Map();
    normalizeLogisticsTariffs(safeForm.logisticsTariffs).forEach((row) => {
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
  }, [safeForm.logisticsTariffs]);

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
    setAutoSaleError('');
    autoSaleRunner.clearError();
    if (autoSaleValidationMessage) {
      setAutoSaleError(autoSaleValidationMessage);
      return;
    }
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
      setAutoSaleRecentTransactions(Array.isArray(snapshot.recentTransactions) ? snapshot.recentTransactions : []);
    });
    autoSaleRunner.resumeIfNeeded();
    void autoSaleRunner.refreshRecentTransactions();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (isCampaignPage || !autoSalePanelOpen) return undefined;
    let cancelled = false;
    const loadAvailability = async () => {
      try {
        const result = await posService.getAutomaticSaleAvailability();
        if (!cancelled) setAutoSaleAvailability(result || null);
      } catch {
        if (!cancelled) setAutoSaleAvailability(null);
      }
    };
    loadAvailability();
    const intervalId = window.setInterval(loadAvailability, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [autoSalePanelOpen, autoSaleSummary.totalCount, isCampaignPage]);

  useEffect(() => {
    if (!weeklyScheduleRows.length) return;
    if (!weeklyScheduleRows.some((row) => row.dayKey === selectedScheduleDay)) {
      setSelectedScheduleDay(weeklyScheduleRows[0].dayKey);
    }
  }, [weeklyScheduleRows, selectedScheduleDay]);

  const normalizeForm = (value) => {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : initialForm;
    return {
    ...source,
    closedDays: [...(source.closedDays || [])].sort(),
    weeklySchedule: normalizeWeeklySchedule({ weeklySchedule: source.weeklySchedule }),
    specialDays: normalizeSpecialDays(source.specialDays)
      .sort((left, right) => {
        const byDate = left.date.localeCompare(right.date, 'tr-TR');
        if (byDate !== 0) return byDate;
        return left.id.localeCompare(right.id, 'tr-TR');
      }),
  logisticsTariffs: normalizeLogisticsTariffs(source.logisticsTariffs),
  notificationSoundEnabled: source.notificationSoundEnabled !== false,
  notificationSoundVolume: clampSoundVolume(source.notificationSoundVolume),
  notificationSound: normalizeNotificationSound(source.notificationSound),
  customerRelations: {
      giftCards: normalizeGiftCards(source?.customerRelations?.giftCards)
        .map((item) => ({
          ...item,
          allowedCategoryIds: [...item.allowedCategoryIds].sort(),
        }))
        .sort((a, b) => a.code.localeCompare(b.code, 'tr-TR')),
      campaigns: normalizeCampaigns(source?.customerRelations?.campaigns)
        .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR')),
      automationCenter: normalizeAutomationCenter(source?.customerRelations?.automationCenter),
    },
    };
  };

  const isDirty = useMemo(() => {
    return JSON.stringify(normalizeForm(form)) !== JSON.stringify(normalizeForm(savedForm));
  }, [form, savedForm]);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const data = await settingsService.get();
      const settingsData = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      const mapped = mapSettingsToForm(settingsData);
      setForm(mapped);
      setSavedForm(mapped);
      setUpdatedAt(settingsData.updatedAt || '');
      
      setLoginActivitiesTotal(settingsData.loginActivitiesCount ?? 0);
      setAuditLogsTotal(settingsData.auditLogsCount ?? 0);
      setDeveloperLogsTotal(settingsData.developerLogsCount ?? 0);

      setLoginActivities([]);
      setAuditLogs([]);
      setDeveloperLogs([]);
      setLoadedLogTabs(new Set());

      if (isAdmin) {
        setDeskPins(createDefaultDeskPins(settingsData.deskPins || {}));
        setSystemManagementPin(String(settingsData.posPin || '1234').slice(0, 4));
        setRoleManagementPin(String(settingsData.roleManagementPin || '1234').slice(0, 4));
      }

      if (!activityLogCollapsed && (isSettingsPage || isCampaignPage)) {
        void triggerLogTabLoad(activityLogTab, true);
      }
    } catch (error) {
      setToast({ type: 'error', title: 'Sistem Ayarlari', message: error.message || 'Ayarlar yüklenemedi.' });
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
      categoryService.listLabels(),
    ]).then(([categoryResult, labelResult]) => {
      setAvailableCategories(categoryResult.status === 'fulfilled' && Array.isArray(categoryResult.value) ? categoryResult.value : []);
      setAvailableCategoryLabels(labelResult.status === 'fulfilled' && Array.isArray(labelResult.value) ? labelResult.value : []);
    });
    if (isCampaignPage) return;
    reportService.getDashboard().then((d) => {
      const overview = d?.overview && typeof d.overview === 'object' ? d.overview : {};
      setStats({
        totalProducts: Number(overview.totalProducts || 0) || 0,
        totalSuppliers: Number(overview.totalSuppliers || 0) || 0,
        totalStockQuantity: Number(overview.totalStockQuantity || 0) || 0,
      });
    }).catch(() => {});
  }, [isCampaignPage]);

  useEffect(() => {
    if (!isCampaignPage) return;

    const loadCrossModuleSignals = async () => {
      try {
        setCrossModuleLoading(true);
        setCrossModuleError('');
        const shouldForceRefresh = Number(suggestionRefreshKey || 0) > 0;
        const [purchaseResult, campaignResult] = await Promise.allSettled([
          procurementService.listSuggestions({ status: 'pending', limit: 40 }),
          campaignAnalysisService.getSuggestions({
            full: false,
            limit: 80,
            forceRefresh: shouldForceRefresh,
          }),
        ]);
        if (purchaseResult.status === 'rejected') console.error('[SettingsCampaignShell:purchaseSuggestions]', purchaseResult.reason);
        if (campaignResult.status === 'rejected') console.error('[SettingsCampaignShell:campaignAnalyticsSnapshot]', campaignResult.reason);
        const purchaseSuggestions = purchaseResult.status === 'fulfilled' ? purchaseResult.value : [];
        const campaignAnalysis = campaignResult.status === 'fulfilled' ? campaignResult.value : {};
        setPricingSignals({});
        setBackendCampaignRows(Array.isArray(campaignAnalysis?.rows) ? campaignAnalysis.rows : []);
        setBackendCampaignSuggestions([
          ...(Array.isArray(campaignAnalysis?.suggestions) ? campaignAnalysis.suggestions : []),
        ]);
        setCampaignEligibleProductCount(Math.max(0, Number(campaignAnalysis?.eligibleProductCount || 0) || 0));
        setOrderSuggestionSignals(Array.isArray(purchaseSuggestions) ? purchaseSuggestions : []);
      } catch (error) {
        setCrossModuleError(error.message || 'Modüller arasi veri yüklenemedi.');
        setPricingSignals({});
        setBackendCampaignRows([]);
        setBackendCampaignSuggestions([]);
        setCampaignEligibleProductCount(0);
        setOrderSuggestionSignals([]);
      } finally {
        setCrossModuleLoading(false);
        setCampaignSuggestionRefreshing(false);
        setCampaignSuggestionRefreshedAt(new Date());
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
    const productBackedCampaignViews = new Set(['product', 'brand']);
    if (isCampaignPage && productBackedCampaignViews.has(campaignTypeView)) {
      void loadCampaignProducts();
    }
  }, [campaignTypeView, isCampaignPage]);

  useEffect(() => {
    if (isCampaignPage || !autoSalePanelOpen) return;
    void loadCampaignProducts({ includeCampaignDetails: false });
  }, [autoSalePanelOpen, isCampaignPage]);

  useEffect(() => {
    if (!isCampaignPage || typeof window === 'undefined') return;

    try {
      const pricingDraftRaw = window.localStorage.getItem('pricingCampaignDraft');
      if (pricingDraftRaw) {
        const pricingDraft = JSON.parse(pricingDraftRaw);
        const productIds = Array.isArray(pricingDraft?.productIds) ? pricingDraft.productIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
        const targetModule = productIds.length ? 'product' : 'dynamic';
        updateCampaignDraft(targetModule, (current) => ({
          ...current,
          type: productIds.length ? 'product' : 'dynamic',
          name: pricingDraft?.campaignName || current.name || 'Seçili Ürünlerde İndirim',
          sourceContext: pricingDraft?.source || 'pricing_demand_analysis',
          discountRate: String(pricingDraft?.discountRate || current.discountRate || 12),
          targetProductIds: productIds,
          targetProductIdsText: productIds.length ? productIds.join(', ') : current.targetProductIdsText,
        }));
        if (productIds.length) setCampaignTypeView('product');
        window.localStorage.removeItem('orderCampaignDraft');
        window.localStorage.removeItem('pricingCampaignDraft');
      }

      const orderDraftRaw = window.localStorage.getItem('orderCampaignDraft');
      if (orderDraftRaw) {
        const orderDraft = JSON.parse(orderDraftRaw);
        const productIds = Array.isArray(orderDraft?.productIds) ? orderDraft.productIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
        const targetModule = productIds.length ? 'product' : normalizeCampaignDraftModuleKey(orderDraft?.type || 'category', 'category');
        updateCampaignDraft(targetModule, (current) => ({
          ...current,
          name: orderDraft?.name || current.name || 'Order Recommendations kaynaklı kampanya',
          type: productIds.length ? 'product' : (orderDraft?.type || current.type || 'category'),
          targetProductIds: productIds,
          targetProductIdsText: productIds.length ? productIds.join(', ') : current.targetProductIdsText,
        }));
        if (productIds.length) setCampaignTypeView('product');
      }
    } catch {
      // Local draft parse hatası kampanya ekranini kesmemeli.
    }
  }, [isCampaignPage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(NOTIFICATION_SOUND_ENABLED_KEY, notificationSoundEnabled ? 'true' : 'false');
      window.localStorage.setItem(NOTIFICATION_SOUND_VOLUME_KEY, String(clampSoundVolume(notificationSoundVolume)));
    } catch {
      // Local storage erisim hatası kritik değil.
    }
  }, [notificationSoundEnabled, notificationSoundVolume]);

  useEffect(() => {
    try {
      preloadNotificationTone(notificationSound);
    } catch {
      // ignore
    }
  }, [notificationSound]);

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
      setToast({ type: 'warning', title: 'Ses Ayarlari', message: 'Önce bildirim sesini aktif edin.' });
      return;
    }

    try {
      await playNotificationTone(clampSoundVolume(notificationSoundVolume), notificationSound);
    } catch {
      setToast({ type: 'error', title: 'Ses Ayarlari', message: 'Ses Önizlemesi baslatilamadı.' });
    }
  };

  const loadDeveloperLogs = async (filters = developerLogFilters) => {
    if (!isPlatformAdmin) return;
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

  const handleSelectDeveloperLog = async (row) => {
    setSelectedDeveloperLog(row);
    setDeveloperLogModalOpen(true);
    if (row && row.id && row.hasFullStack) {
      try {
        setDeveloperLogDetailLoading(true);
        const res = await settingsService.getDeveloperLogDetail(row.id);
        if (res?.data) {
          setSelectedDeveloperLog(res.data);
        } else if (res) {
          setSelectedDeveloperLog(res);
        }
      } catch (error) {
        console.error('[SettingsCampaignShell:fetchDeveloperLogDetail]', error);
        setToast({ type: 'error', title: 'Geliştirici Logu', message: error.message || 'Log detayları yüklenemedi.' });
      } finally {
        setDeveloperLogDetailLoading(false);
      }
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
    logPdfExportStep(flow, 'Basladı', { rowCount });

    const { pdfMake, ready } = await ensurePdfMakeReady();
    if (!ready) {
      throw new Error('PDF font altyapisi hazır değil');
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
    if (text.includes('kayıt bulunamadı') || text.includes('kayıt bulunamadı')) {
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
        Kullanıcı: getAuditActorName(row),
        Modül: row.module || '-',
        İşlem: getAuditActionLabel(row),
        'Kayıt/Nesne': getAuditObjectLabel(row),
        Özet: getAuditSummary(row),
        Kaynak: row.source || '-',
        IP: row.ip || '-',
        Durum: getAuditStatusLabel(row),
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Tarih/Saat': '-', Kullanıcı: '-', Modül: '-', İşlem: '-', 'Kayıt/Nesne': '-', Özet: '-', Kaynak: '-', IP: '-', Durum: '-' }]);
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
          { text: 'Modül', style: 'tableHeader' },
          { text: 'İşlem', style: 'tableHeader' },
          { text: 'Özet', style: 'tableHeader' },
          { text: 'Durum', style: 'tableHeader' },
        ],
        ...sourceRows.map((row) => ([
          { text: safeReportCell(formatDateTime(row.createdAt || row.at)), style: 'tableCellSubtle' },
          { text: safeReportCell(getAuditActorName(row)), style: 'tableCell' },
          { text: safeReportCell(row.module), style: 'tableCell' },
          { text: safeReportCell(getAuditActionLabel(row)), style: 'tableCell' },
          { text: safeReportCell(getAuditSummary(row)), style: 'tableCellWrap' },
          { text: safeReportCell(getAuditStatusLabel(row)), style: 'tableCell' },
        ])),
      ];

      const docDefinition = {
        pageSize: 'A4',
        pageOrientation: 'landscape',
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
              widths: [92, 90, 70, 120, '*', 52],
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
        'İşlem': row.action || '-',
        'Kullanıcı': row.userName || row.user || '-',
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Tarih/Saat': '-', 'Hata Tipi': '-', Mesaj: '-', Kaynak: '-', 'İşlem': '-', 'Kullanıcı': '-' }]);
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
            { text: 'Filtre kriterlerine uygun kayıt bulunamadı.', style: 'tableCellWrap' },
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
        'Kullanıcı': getLoginActorName(item),
        Rol: item.role || '-',
        Kaynak: getLoginSourceLabel(item.source),
        Olay: getLoginEventLabel(item.eventType),
        Durum: getLoginStatusLabel(item.status),
        'E-posta/Kullanıcı Adı': item.email || item.username || '-',
        'IP Adresi': item.ipAddress || item.ip || '-',
        'İşletim Sistemi': os,
        'Tarayıcı': browser,
        'Tarih/Saat': formatDateTime(resolveLoginActivityDate(item)),
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(sheetRows.length ? sheetRows : [{ Kullanıcı: '-', Rol: '-', Kaynak: '-', Olay: '-', Durum: '-', 'E-posta/Kullanıcı Adı': '-', 'IP Adresi': '-', 'İşletim Sistemi': '-', Tarayıcı: '-', 'Tarih/Saat': '-' }]);
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
          { text: 'Kullanıcı', style: 'tableHeader' },
          { text: 'Rol', style: 'tableHeader' },
          { text: 'Kaynak', style: 'tableHeader' },
          { text: 'Olay', style: 'tableHeader' },
          { text: 'IP Adresi', style: 'tableHeader' },
          { text: 'Durum', style: 'tableHeader' },
          { text: 'Tarih/Saat', style: 'tableHeader' },
        ],
        ...rows.map((item) => {
          return [
            { text: safeReportCell(getLoginActorName(item)), style: 'tableCell' },
            { text: safeReportCell(item.role), style: 'tableCell' },
            { text: safeReportCell(getLoginSourceLabel(item.source)), style: 'tableCell' },
            { text: safeReportCell(getLoginEventLabel(item.eventType)), style: 'tableCell' },
            { text: safeReportCell(item.ipAddress || item.ip), style: 'tableCell' },
            { text: safeReportCell(getLoginStatusLabel(item.status)), style: 'tableCell' },
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
              widths: [78, 46, 86, 74, 66, 54, '*'],
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
      setToast({ type: 'success', title: 'Sistem Kayıtlari', message: 'Kayıt basariyla oluşturuldu.' });
    } catch (error) {
      setToast({ type: 'error', title: 'Sistem Kayıtlari', message: error.message || 'Kayıt oluşturulamadı.' });
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

  const auditModules = useMemo(() => {
    const values = new Set();
    (auditLogs || []).forEach((row) => {
      const value = String(row.module || '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr-TR'));
  }, [auditLogs]);

  const auditSources = useMemo(() => {
    const values = new Set();
    (auditLogs || []).forEach((row) => {
      const value = String(row.source || '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr-TR'));
  }, [auditLogs]);

  const auditStatuses = useMemo(() => {
    const values = new Set();
    (auditLogs || []).forEach((row) => {
      const value = String(row.statusCode || row.severity || '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => String(a).localeCompare(String(b), 'tr-TR'));
  }, [auditLogs]);

  const loginUsers = useMemo(() => {
    const values = new Set();
    (loginActivities || []).forEach((row) => {
      const value = String(getLoginActorName(row)).trim();
      if (value && value !== '-') values.add(value);
      const email = String(row.email || '').trim();
      if (email) values.add(email);
      const username = String(row.username || '').trim();
      if (username) values.add(username);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr-TR'));
  }, [loginActivities]);

  const loginEventOptions = useMemo(() => {
    const values = new Set(Object.keys(LOGIN_EVENT_LABELS));
    (loginActivities || []).forEach((row) => {
      const value = String(row.eventType || '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr-TR'));
  }, [loginActivities]);

  const loginSourceOptions = useMemo(() => {
    const values = new Set(Object.keys(LOGIN_SOURCE_LABELS));
    (loginActivities || []).forEach((row) => {
      const value = String(row.source || '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b, 'tr-TR'));
  }, [loginActivities]);

  const loginStatusOptions = useMemo(() => {
    const values = new Set(Object.keys(LOGIN_STATUS_LABELS));
    (loginActivities || []).forEach((row) => {
      const value = String(row.status || '').trim();
      if (value) values.add(value);
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
      const moduleName = String(row.module || '');
      const sourceName = String(row.source || '');
      const statusCode = String(row.statusCode || row.severity || '');
      if (active.action && action !== active.action) return false;
      if (active.user && userName !== active.user) return false;
      if (active.module && moduleName !== active.module) return false;
      if (active.source && sourceName !== active.source) return false;
      if (active.status && statusCode !== active.status) return false;
      if (query) {
        const haystack = [action, userName, moduleName, sourceName, row.entityType, row.entityId, row.entityLabel, row.endpoint, row.details, row.detail, row.summary, row.id]
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
      const userName = String(getLoginActorName(row));
      const ipValue = String(row.ipAddress || row.ip || '');
      const eventType = String(row.eventType || '');
      const source = String(row.source || '');
      const status = String(row.status || '');
      if (active.user && userName !== active.user && row.email !== active.user && row.username !== active.user) return false;
      if (active.eventType && eventType !== active.eventType) return false;
      if (active.source && source !== active.source) return false;
      if (active.status && status !== active.status) return false;
      if (active.ip && !ipValue.toLocaleLowerCase('tr-TR').includes(String(active.ip).toLocaleLowerCase('tr-TR'))) return false;
      if (query) {
        const parsed = parseUserAgentInfo(row);
        const haystack = [
          userName,
          row.email,
          row.username,
          row.role,
          row.department,
          getLoginSourceLabel(source),
          getLoginEventLabel(eventType),
          getLoginStatusLabel(status),
          row.failureReason,
          row.requestId,
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
    if (type === 'audit') {
      setToast({ type: 'warning', title: 'Audit Log', message: 'Audit kayıtları güvenlik nedeniyle bu ekrandan temizlenemez.' });
      return;
    }
    const labels = {
      activity: 'aktivite kayıtları',
      audit: 'audit kayıtları',
      developer: 'geliştirici loglari',
    };
    const label = labels[type] || 'log kayıtları';
    const approved = await dialog.confirm({
      title: 'Kayıtlar temizlensin mi?',
      description: 'Bu işlem seçili log tÜründeki kayıtları temizler.',
      confirmText: 'Temizle',
      cancelText: 'Vazgeç',
      tone: 'danger',
      closeOnBackdrop: true,
    });
    if (!approved) return;

    try {
      if (type === 'developer') setDeveloperLogsLoading(true);
      else if (type === 'activity') setLoginActivitiesLoading(true);
      else if (type === 'audit') setAuditLogsLoading(true);

      await settingsService.clearLogs(type);
      await triggerLogTabLoad(type, true);
      setToast({ type: 'success', title: 'Log Kayıtlari', message: `${label} temizlendi.` });
    } catch (error) {
      setToast({ type: 'error', title: 'Log Kayıtlari', message: error.message || 'Log kayıtları temizlenemedi.' });
    } finally {
      if (type === 'developer') setDeveloperLogsLoading(false);
      else if (type === 'activity') setLoginActivitiesLoading(false);
      else if (type === 'audit') setAuditLogsLoading(false);
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
      setToast({ type: 'error', title: 'Audit Log', message: error.message || 'Audit log detaylari yüklenemedi.' });
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
      setToast({ type: 'warning', title: 'Ayarlar', message: 'Tarih araligi için bitiş tarihi zorunludur.' });
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
        storeName: form.storeName,
        branchCode: form.branchCode,
        storePhone: form.storePhone,
        storeEmail: form.storeEmail,
        taxNumber: form.taxNumber,
        storeAddress: form.storeAddress,
        weeklySchedule,
        specialDays: normalizeSpecialDays(form.specialDays),
        logisticsTariffs: normalizeLogisticsTariffs(form.logisticsTariffs),
        notificationSoundEnabled: form.notificationSoundEnabled !== false,
        notificationSoundVolume: clampSoundVolume(form.notificationSoundVolume),
        notificationSound: normalizeNotificationSound(form.notificationSound),
        holidayMode: Boolean(form.holidayMode),
        openingTime: legacy.openingTime,
        closingTime: legacy.closingTime,
        closedDays: legacy.closedDays,
      });
      const mapped = mapSettingsToForm(next);
      setUpdatedAt(next.updatedAt);
      setForm(mapped);
      setSavedForm(mapped);
      setToast({ type: 'success', title: 'Sistem Ayarlari', message: 'Ayarlar kaydedildi' });
    } catch (error) {
      const errorMsg = error?.payload?.message || error?.message || 'Ayarlar kaydedilemedi.';
      setToast({ type: 'error', title: 'Sistem Ayarlari', message: errorMsg });
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
    resetAllCampaignDrafts();
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
      setToast({ type: 'error', title: 'Müşteri İlişkileri', message: 'Kullanim hakkı en az 1 olmalıdır.' });
      return;
    }
    if (!giftCardDraft.isAllCategoriesSelected && giftCardDraft.allowedCategoryIds.length === 0) {
      setToast({ type: 'error', title: 'Müşteri İlişkileri', message: "En az bir kategori seçin veya tüm kategoriler toggle'ını açın." });
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
      setToast({ type: 'error', title: 'Müşteri İlişkileri', message: 'Kart kodu Üretilemedi. Lütfen tekrar deneyin.' });
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

  const customerRelations = safeForm.customerRelations && typeof safeForm.customerRelations === 'object'
    ? safeForm.customerRelations
    : initialForm.customerRelations;
  const giftCards = Array.isArray(customerRelations.giftCards) ? customerRelations.giftCards : [];
  const campaigns = Array.isArray(customerRelations.campaigns) ? customerRelations.campaigns : [];
  const automationCenter = normalizeAutomationCenter(customerRelations.automationCenter);
  const automationRules = automationCenter.rules || [];
  const pricingRows = useMemo(() => (
    Array.isArray(backendCampaignRows) && backendCampaignRows.length ? backendCampaignRows : mapPricingRowsForCampaigns({ sections: pricingSignals })
  ), [backendCampaignRows, pricingSignals]);
  const availableProductMap = useMemo(
    () => new Map((Array.isArray(availableProducts) ? availableProducts : []).map((product) => [String(product?.id || ''), product])),
    [availableProducts],
  );
  const campaignAnalyticsRows = useMemo(() => {
    return (Array.isArray(pricingRows) ? pricingRows : []).map((row) => {
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
        categoryLabelId: String(row?.categoryLabelId || row?.labelId || row?.tagId || product?.categoryLabelId || product?.labelId || product?.tagId || product?.selectedTagId || ''),
        categoryLabelName: normalizeCampaignInsightText(String(row?.categoryLabelName || row?.labelName || row?.etiket || product?.categoryLabelName || product?.labelName || product?.etiket || product?.tag || '').trim()),
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
  const selectedCategoryIdSet = useMemo(
    () => new Set((campaignDraft.targetCategoryIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
    [campaignDraft.targetCategoryIds],
  );
  const allCategoryLabelOptions = useMemo(() => {
    const optionMap = new Map();
    const addOption = ({ id, label, categoryId, categoryName }) => {
      const safeId = String(id || label || '').trim();
      const safeLabel = normalizeCampaignInsightText(String(label || safeId || '').trim());
      const safeCategoryId = String(categoryId || '').trim();
      if (!safeId || !safeLabel || !safeCategoryId) return;
      optionMap.set(safeId, {
        id: safeId,
        label: safeLabel,
        categoryId: safeCategoryId,
        categoryName: normalizeCampaignInsightText(String(categoryName || '').trim()),
      });
    };

    (Array.isArray(availableCategoryLabels) ? availableCategoryLabels : []).forEach((item) => {
      addOption({
        id: item?.labelId || item?.id || item?.tagId || item?.selectedTagId || item?.labelName,
        label: item?.labelName || item?.name || item?.etiket || item?.label,
        categoryId: item?.categoryId || item?.categoryCode || item?.category?.id,
        categoryName: item?.categoryName || item?.category?.name,
      });
    });

    (Array.isArray(availableCategories) ? availableCategories : []).forEach((category) => {
      const categoryId = String(category?.id || category?.categoryId || '').trim();
      const categoryName = String(category?.name || category?.categoryName || categoryId).trim();
      const rawLabels = Array.isArray(category?.etiketler)
        ? category.etiketler
        : String(category?.etiketler || '').split(',').map((item) => item.trim()).filter(Boolean);
      rawLabels.forEach((label) => {
        const labelName = typeof label === 'object' ? (label.labelName || label.name || label.etiket || label.label) : label;
        const labelId = typeof label === 'object' ? (label.labelId || label.id || label.tagId || labelName) : `${categoryId}:${labelName}`;
        addOption({ id: labelId, label: labelName, categoryId, categoryName });
      });
    });

    return [...optionMap.values()].sort((left, right) => left.label.localeCompare(right.label, 'tr-TR'));
  }, [availableCategories, availableCategoryLabels]);
  const selectedCategoryLabelIdSet = useMemo(
    () => new Set((campaignDraft.targetCategoryLabelIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
    [campaignDraft.targetCategoryLabelIds],
  );
  const selectedCategoryLabelOptions = useMemo(
    () => allCategoryLabelOptions.filter((option) => selectedCategoryLabelIdSet.has(option.id)),
    [allCategoryLabelOptions, selectedCategoryLabelIdSet],
  );
  const visibleCategoryLabelOptions = useMemo(() => {
    if (!selectedCategoryIdSet.size) return [];
    const needle = normalizeSearchText(categoryLabelSearch);
    return allCategoryLabelOptions
      .filter((option) => selectedCategoryIdSet.has(option.categoryId))
      .filter((option) => !needle || normalizeSearchText(`${option.label} ${option.categoryName}`).includes(needle))
      .slice(0, 40);
  }, [allCategoryLabelOptions, categoryLabelSearch, selectedCategoryIdSet]);

  useEffect(() => {
    if (!campaignDraft.targetCategoryLabelIds?.length) return;
    const allowedIds = new Set(allCategoryLabelOptions.filter((option) => selectedCategoryIdSet.has(option.categoryId)).map((option) => option.id));
    const nextIds = campaignDraft.targetCategoryLabelIds.filter((id) => allowedIds.has(String(id || '').trim()));
    if (nextIds.length !== campaignDraft.targetCategoryLabelIds.length) {
      setCampaignDraft((current) => ({ ...current, targetCategoryLabelIds: nextIds }));
    }
  }, [allCategoryLabelOptions, campaignDraft.targetCategoryLabelIds, selectedCategoryIdSet]);

  const campaignSuggestions = useMemo(() => {
    const base = Array.isArray(backendCampaignSuggestions) ? backendCampaignSuggestions : [];
    void suggestionRefreshKey;
    return buildCampaignSuggestionPresentation(base).all;
  }, [backendCampaignSuggestions, suggestionRefreshKey]);

  const filteredCampaignSuggestions = campaignSuggestions;

  const campaignSuggestionPresentation = useMemo(
    () => buildCampaignSuggestionPresentation(filteredCampaignSuggestions),
    [filteredCampaignSuggestions]
  );
  const actionableCampaignSuggestions = useMemo(
    () => filteredCampaignSuggestions.filter(isCampaignSuggestionActionable),
    [filteredCampaignSuggestions]
  );
  const actionableCampaignSuggestionPresentation = useMemo(
    () => buildCampaignSuggestionPresentation(actionableCampaignSuggestions),
    [actionableCampaignSuggestions]
  );

  const dashboardCampaignSuggestions = actionableCampaignSuggestionPresentation.dashboardHighlights;
  const campaignSuggestionCandidateRows = actionableCampaignSuggestionPresentation.all;
  const moduleCampaignSuggestions = actionableCampaignSuggestionPresentation.byModule[campaignTypeView] || [];
  const visibleCampaignSuggestions = campaignTypeView === 'all'
    ? dashboardCampaignSuggestions
    : moduleCampaignSuggestions;

  const campaignCandidatePage = Math.max(1, Number(campaignCandidatePagesByModule[campaignTypeView] || 1));
  const setCampaignCandidatePage = (updater) => {
    setCampaignCandidatePagesByModule((current) => {
      const previous = Math.max(1, Number(current[campaignTypeView] || 1));
      const next = typeof updater === 'function' ? updater(previous) : updater;
      return { ...current, [campaignTypeView]: Math.max(1, Number(next) || 1) };
    });
  };
  const campaignCandidateTotalPages = Math.max(1, Math.ceil(campaignSuggestionCandidateRows.length / CAMPAIGN_CANDIDATE_PAGE_SIZE));
  const safeCampaignCandidatePage = Math.min(campaignCandidatePage, campaignCandidateTotalPages);
  const campaignCandidateStartIndex = campaignSuggestionCandidateRows.length
    ? ((safeCampaignCandidatePage - 1) * CAMPAIGN_CANDIDATE_PAGE_SIZE) + 1
    : 0;
  const campaignCandidateEndIndex = Math.min(
    campaignSuggestionCandidateRows.length,
    safeCampaignCandidatePage * CAMPAIGN_CANDIDATE_PAGE_SIZE,
  );
  const pagedCampaignSuggestionCandidateRows = useMemo(
    () => campaignSuggestionCandidateRows.slice(
      (safeCampaignCandidatePage - 1) * CAMPAIGN_CANDIDATE_PAGE_SIZE,
      safeCampaignCandidatePage * CAMPAIGN_CANDIDATE_PAGE_SIZE,
    ),
    [campaignSuggestionCandidateRows, safeCampaignCandidatePage],
  );

  useEffect(() => {
    setCampaignCandidatePage(1);
  }, [campaignSuggestionCandidateRows.length, campaignTypeView]);

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

  const campaignScenarioOptions = useMemo(() => ({
    'discount-10': { label: '%10 indirim', discountRate: 10, description: 'Daha kontrollü hacim artışı hedefler.' },
    'discount-20': { label: '%20 indirim', discountRate: 20, description: 'SKT ve stok baskısında dengeli hızlanma sağlar.' },
    'discount-30': { label: '%30 indirim', discountRate: 30, description: 'Çok kritik Ürünlerde hızlı tüketim etkisi Üretir.' },
    'bundle': { label: 'Çoklu alım', discountRate: 16, description: 'Sepet büyütme ile stok eritme arasında dengeli bir seçenek sunar.' },
    'price-up': { label: 'Fiyat artışı testi', discountRate: 0, description: 'Güçlü talep gören Ürünlerde marj optimizasyonu odaklıdir.' },
  }), []);

  const expirySuggestions = useMemo(
    () => actionableCampaignSuggestionPresentation.byModule.expiry || [],
    [actionableCampaignSuggestionPresentation]
  );

  const salesSuggestions = useMemo(
    () => actionableCampaignSuggestionPresentation.byModule.sales || [],
    [actionableCampaignSuggestionPresentation]
  );

  const campaignMatchesActiveModule = (item, { includeModule = true } = {}) => {
    if (includeModule && campaignTypeView !== 'all' && !isCampaignInModule(item, campaignTypeView)) return false;
    return true;
  };

  const campaignSummary = useMemo(() => {
    const now = new Date();
    const summaryCampaigns = campaigns;
    const activeCampaignItems = summaryCampaigns.filter((item) => isCampaignCurrentlyActive(item, now));
    const active = activeCampaignItems.length;
    const planned = summaryCampaigns.filter((item) => isCampaignPlanned(item, now)).length;
    const archive = summaryCampaigns.filter((item) => isDefaultCampaignArchiveRow(item, now)).length;
    const dynamic = summaryCampaigns.filter((item) => item.type === 'dynamic').length;
    const categoryBased = summaryCampaigns.filter((item) => item.type === 'category').length;
    const urgentSuggestionCount = filteredCampaignSuggestions.filter((item) => item.priority === 'critical' || item.priority === 'high').length;
    const expiringSoon = activeCampaignItems.filter((item) => {
      if (item.isIndefinite || !item.endsAt) return false;
      const end = new Date(item.endsAt);
      if (Number.isNaN(end.getTime())) return false;
      const diffDays = Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      return diffDays >= 0 && diffDays <= 7;
    }).length;
    const campaignProductIds = new Set();
    if (campaignTypeView === 'all') {
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
    }

    return {
      total: summaryCampaigns.length,
      active,
      planned,
      archive,
      dynamic,
      categoryBased,
      expiringSoon,
      promotedProducts: campaignProductIds.size,
      urgentSuggestionCount,
    };
  }, [campaignAnalyticsRows, campaignTypeView, campaigns, filteredCampaignSuggestions]);

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((item) => campaignMatchesActiveModule(item));
  }, [campaignTypeView, campaigns]);

  const moduleCampaignRows = useMemo(() => {
    if (!['general', 'product', 'category', 'brand', 'expiry', 'sales'].includes(campaignTypeView)) {
      return [];
    }

    return [...filteredCampaigns.filter((item) => isCampaignInModule(item, campaignTypeView))]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [campaignTypeView, filteredCampaigns]);

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
      const selectedLabelIds = new Set((campaignDraft.targetCategoryLabelIds || []).map((id) => String(id || '').trim()).filter(Boolean));
      const selectedLabelNames = new Set(selectedCategoryLabelOptions.map((item) => normalizeSearchText(item.label)).filter(Boolean));
      return campaignAnalyticsRows.filter((row) => {
        if (!selectedCategoryIdSet.has(String(row?.categoryId || '').trim())) return false;
        if (!selectedLabelIds.size) return true;
        const rowLabelId = String(row?.categoryLabelId || '').trim();
        const rowLabelName = normalizeSearchText(row?.categoryLabelName || row?.etiket || '');
        return (rowLabelId && selectedLabelIds.has(rowLabelId)) || (rowLabelName && selectedLabelNames.has(rowLabelName));
      });
    }
    if (campaignDraft.type === 'brand') {
      return campaignAnalyticsRows.filter((row) => selectedBrandKeySet.has(normalizeSearchText(row?.brand || '')));
    }
    return campaignAnalyticsRows;
  }, [campaignAnalyticsRows, campaignDraft.targetCategoryLabelIds, campaignDraft.targetProductIds, campaignDraft.type, selectedBrandKeySet, selectedCategoryIdSet, selectedCategoryLabelOptions]);
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
          : 'Mağaza Geneli İndirim',
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
      targetCategoryLabelIds: requestType === 'category' && Array.isArray(campaignDraft.targetCategoryLabelIds) ? campaignDraft.targetCategoryLabelIds : [],
      targetCategoryLabels: requestType === 'category' ? selectedCategoryLabelOptions.map((item) => item.label).filter(Boolean) : [],
      targetBrands: requestType === 'brand' ? selectedCampaignBrands : [],
      scopeLabel: campaignTypeView === 'product'
        ? 'Ürün Bazlı Kampanya'
        : campaignTypeView === 'category'
          ? 'Kategori Bazlı Kampanya'
          : campaignTypeView === 'brand'
            ? 'Marka Bazlı Kampanya'
            : 'Mağaza Geneli İndirim',
      currency: form.currency,
    };
  }, [
    campaignDraft.discountRate,
    campaignDraft.endsAt,
    campaignDraft.isIndefinite,
    campaignDraft.startsAt,
    campaignDraft.targetCategoryIds,
    campaignDraft.targetCategoryLabelIds,
    campaignDraft.targetProductIds,
    campaignDraft.type,
    campaignSimulationDurationDays,
    campaignTypeView,
    form.currency,
    selectedCampaignBrands,
    selectedCategoryLabelOptions,
  ]);
  const campaignSimulationRequestKey = useMemo(
    () => JSON.stringify(campaignSimulationRequest),
    [campaignSimulationRequest],
  );

  useEffect(() => {
    if (!isCampaignPage) return;
    if (!['product', 'category', 'brand'].includes(campaignTypeView)) {
      setBackendCampaignSimulation(null);
      setCampaignSimulationLoading(false);
      setCampaignSimulationError('');
      return;
    }
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
  }, [campaignSimulationRequestKey, campaignTypeView, isCampaignPage]);

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
    emptyMessage: 'Mevcut kural kosullarina uyan Ürün bulunamadı.',
  }), [automationPreviewRows, campaignDraft.discountRate, campaignDraft.dynamicRule?.discountRate, campaignSimulationDurationDays, form.currency]);

  const crossModuleInsights = useMemo(() => mergeCrossModuleIntelligence({
    pricingRows,
    purchaseSuggestions: orderSuggestionSignals,
  }), [pricingRows, orderSuggestionSignals]);

  const campaignEmptyState = useMemo(() => buildCampaignEmptyState({
    campaigns: filteredCampaigns,
    suggestions: filteredCampaignSuggestions,
    tab: campaignTypeView,
  }), [filteredCampaigns, filteredCampaignSuggestions, campaignTypeView]);

  const campaignHomeSummary = useMemo(() => {
    const cards = giftCards;
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
  }, [campaigns, giftCards]);

  const homeCampaignTableConfig = useMemo(() => {
    const now = new Date();
    if (homeCampaignTableView === 'planned') {
      return {
        title: 'Planlanan Kampanyalar',
        description: 'Henüz başlamamış, başlangıç tarihini bekleyen kampanyalar burada izlenir.',
        rows: filteredCampaigns
          .filter((item) => isCampaignPlanned(item, now))
          .sort((a, b) => new Date(a.startsAt || 0).getTime() - new Date(b.startsAt || 0).getTime()),
        tableKey: 'home-planned',
        mode: 'planned',
        sectionMeta: CAMPAIGN_TABLE_SECTION_META.all.active,
        emptyTitle: 'Planlanan kampanya bulunmuyor',
        emptyDescription: 'Başlangıç tarihini bekleyen kampanya kaydı yok.',
      };
    }
    if (homeCampaignTableView === 'archive') {
      return {
        title: CAMPAIGN_TABLE_SECTION_META.all.archive.title,
        description: 'Bitiş tarihi geçmiş eski kampanyalar gizlenerek pasif veya arşivlenmiş güncel kayıtlar izlenir.',
        rows: filteredCampaigns
          .filter((item) => isDefaultCampaignArchiveRow(item, now))
          .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
        tableKey: 'home-archive',
        mode: 'archive',
        sectionMeta: CAMPAIGN_TABLE_SECTION_META.all.archive,
        emptyTitle: 'Arşiv kaydı bulunmuyor',
        emptyDescription: 'Varsayılan arşivde gösterilecek güncel kayıt yok.',
      };
    }
    return {
      title: 'Aktif Kampanyalar',
      description: 'Şu an yayında olan gerçek kampanya kayıtları burada izlenir.',
      rows: filteredCampaigns
        .filter((item) => isCampaignCurrentlyActive(item, now))
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()),
      tableKey: 'home-active',
      mode: 'active',
      sectionMeta: CAMPAIGN_TABLE_SECTION_META.all.active,
      emptyTitle: 'Aktif kampanya bulunmuyor',
      emptyDescription: 'Şu an yayında olan kampanya kaydı yok.',
    };
  }, [filteredCampaigns, homeCampaignTableView]);

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

    filteredCampaigns.forEach((item) => {
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
      { name: 'Ürün', count: buckets.product },
      { name: 'Kategori', count: buckets.category },
      { name: 'Marka', count: buckets.brand },
      { name: 'SKT', count: buckets.expiry },
      { name: 'Satış', count: buckets.sales },
      { name: 'Dinamik', count: buckets.dynamic },
    ];
  }, [filteredCampaigns]);

  const campaignStatusChartData = useMemo(() => ([
    { name: 'Yayında', count: campaignSummary.active },
    { name: 'Planlandı', count: campaignSummary.planned },
    { name: 'Yayında Değil', count: campaignSummary.archive },
    { name: 'Yakında Bitecek', count: campaignSummary.expiringSoon },
  ]), [campaignSummary]);

  const campaignSuggestionChartData = useMemo(() => {
    const buckets = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    actionableCampaignSuggestions.forEach((item) => {
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
  }, [actionableCampaignSuggestions]);
  const campaignStatusDistributionData = useMemo(() => {
    const now = new Date();
    const buckets = {
      active: 0,
      planned: 0,
      expired: 0,
      stopped: 0,
    };

    filteredCampaigns.forEach((item) => {
      const rawStatus = String(item?.status || '').trim().toLowerCase();
      const endsAt = getCampaignEndBoundary(item);
      if (isCampaignCurrentlyActive(item, now)) {
        buckets.active += 1;
      } else if (isCampaignPlanned(item, now)) {
        buckets.planned += 1;
      } else if (!item?.isIndefinite && endsAt && endsAt < now) {
        buckets.expired += 1;
      } else if (['archived', 'paused', 'inactive', 'cancelled', 'canceled', 'deleted', 'expired'].includes(rawStatus) || item?.isActive === false) {
        buckets.stopped += 1;
      } else {
        buckets.stopped += 1;
      }
    });

    return [
      { name: 'Yayında', count: buckets.active, color: '#059669' },
      { name: 'Planlı', count: buckets.planned, color: '#d97706' },
      { name: 'Bitmiş', count: buckets.expired, color: '#64748b' },
      { name: 'Sonlandırılmış', count: buckets.stopped, color: '#dc2626' },
    ];
  }, [filteredCampaigns]);

  const campaignTypeDistributionData = useMemo(() => {
    const colors = ['#4f46e5', '#059669', '#0ea5e9', '#7c3aed', '#dc2626', '#d97706', '#0891b2'];
    return campaignTypeChartData.map((item, index) => ({
      ...item,
      color: colors[index % colors.length],
    }));
  }, [campaignTypeChartData]);

  const campaignSuggestionDistributionData = useMemo(() => {
    const colors = ['#dc2626', '#ea580c', '#d97706', '#059669'];
    return campaignSuggestionChartData.map((item, index) => ({
      ...item,
      color: colors[index % colors.length],
    }));
  }, [campaignSuggestionChartData]);

  const hasCampaignStatusChartData = campaignStatusDistributionData.some((item) => Number(item.count || 0) > 0);
  const hasCampaignTypeChartData = campaignTypeDistributionData.some((item) => Number(item.count || 0) > 0);
  const hasCampaignSuggestionChartData = campaignSuggestionDistributionData.some((item) => Number(item.count || 0) > 0);
  const campaignHeaderRefreshLabel = `Son güncelleme: ${formatCampaignRefreshDateTime(campaignSuggestionRefreshedAt)}`;
  const campaignStatusEmptyState = campaigns.length
    ? {
        title: 'Seçili filtrelerde sonuç bulunamadı',
        description: 'Kampanya durumu dağılımı için uygun kayıt görünmüyor.',
      }
    : {
        title: 'Henüz kampanya verisi oluşmadı',
        description: 'Kampanya kaydı oluşturulduğunda durum dağılımı burada görünecek.',
      };
  const campaignTypeEmptyState = campaigns.length
    ? {
        title: 'Bu dönem için dağılım verisi oluşmadı',
        description: 'Seçili kapsamda kampanya tipi dağılımı bulunmuyor.',
      }
    : {
        title: 'Gösterilecek kampanya verisi bulunmuyor',
        description: 'Kampanya eklendiğinde tür dağılımı otomatik hesaplanacak.',
      };
  const campaignSuggestionEmptyState = crossModuleError
    ? {
        title: 'Veri yüklenemedi, lütfen yenileyin',
        description: 'Öneri önceliği verisi alınamadı.',
      }
    : actionableCampaignSuggestions.length
      ? {
          title: 'Seçili filtrelerde sonuç bulunamadı',
          description: 'Öneri önceliği dağılımı için uygun kayıt yok.',
        }
      : {
          title: 'Öneri önceliği verisi henüz oluşmadı',
          description: 'Kampanya önerileri üretildiğinde öncelik dağılımı burada görünecek.',
        };

  const isHomeCampaignView = campaignTypeView === 'all';
  const isCampaignBuilderView = ['product', 'category', 'brand'].includes(campaignTypeView);
  const isManualOnlyCampaignModule = ['category', 'brand'].includes(campaignTypeView);
  const shouldShowCampaignSuggestionPanel = isCampaignBuilderView && !isManualOnlyCampaignModule;
  const campaignBuilderMeta = useMemo(() => {
    if (campaignTypeView === 'product') {
      return {
        title: 'Ürün Bazlı Kampanya',
        description: 'Kampanyanin uygulanacagi Ürünleri seçin.',
        forcedType: 'product',
        scopeLabel: 'Ürün Seçimi',
        scopeDescription: 'Kampanyanin uygulanacagi Ürünleri seçin.',
      };
    }
    if (campaignTypeView === 'category') {
      return {
        title: 'Kategori Bazlı Kampanya',
        description: 'Kampanyanin uygulanacagi kategorileri seçin.',
        forcedType: 'category',
        scopeLabel: 'Kategori Seçimi',
        scopeDescription: 'Kampanyanin uygulanacagi kategorileri seçin.',
      };
    }
    if (campaignTypeView === 'brand') {
      return {
        title: 'Marka Bazlı Kampanya',
        description: 'Kampanyanin uygulanacagi markalari seçin.',
        forcedType: 'brand',
        scopeLabel: 'Marka Seçimi',
        scopeDescription: 'Kampanyanin uygulanacagi markalari seçin.',
      };
    }
    return {
      title: 'Mağaza Geneli Kampanya',
      description: 'Tüm mağaza Ürünlerine uygulanacak genel kampanya bilgilerini tanımlayın.',
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
      return false;
    }

    if (!['general', 'category', 'product', 'brand', 'dynamic'].includes(type)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Kampanya tipi geçersiz.' });
      return false;
    }

    if (!Number.isFinite(discountRate) || discountRate <= 0 || discountRate > 100) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'İndirim oranı 1-100 arasında olmalıdır.' });
      return false;
    }

    if (!isIndefinite && (!startsAt || !endsAt)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Başlangıç ve bitiş tarihi zorunludur.' });
      return false;
    }

    if (!isIndefinite && new Date(startsAt) > new Date(endsAt)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Bitiş tarihi başlangıçtan Önce olamaz.' });
      return false;
    }

    if (type === 'category' && (!Array.isArray(campaignDraft.targetCategoryIds) || campaignDraft.targetCategoryIds.length === 0)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Kategori kampanyası için en az bir kategori seçin.' });
      return false;
    }
    if (type === 'product' && (!Array.isArray(campaignDraft.targetProductIds) || campaignDraft.targetProductIds.length === 0)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Ürün kampanyası için en az bir Ürün seçin.' });
      return false;
    }
    if (type === 'brand' && (!Array.isArray(campaignDraft.targetBrands) || campaignDraft.targetBrands.length === 0)) {
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: 'Marka kampanyası için en az bir marka seçin.' });
      return false;
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
      targetCategoryLabelIds: type === 'category' ? campaignDraft.targetCategoryLabelIds : [],
      targetCategoryLabels: type === 'category' ? selectedCategoryLabelOptions.map((item) => item.label).filter(Boolean) : [],
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

      let notificationFailed = false;
      if (!existingCampaign && String(campaignDraft.sourceContext || '').trim().toLowerCase() === 'pricing_demand_analysis') {
        try {
          await notificationService.create(buildCampaignCreatedNotificationPayload({
            campaign: nextCampaign,
            campaignName: nextCampaign.name,
            source: 'pricing_demand_analysis',
          }));
        } catch (notificationError) {
          notificationFailed = true;
          console.warn('[campaign-notification:create:error]', notificationError);
        }
      }

      resetCampaignDraft(activeCampaignDraftModule);
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
        type: notificationFailed ? 'warning' : 'success',
        title: notificationFailed ? 'Kampanya kaydedildi' : 'Kampanya Yönetimi',
        message: notificationFailed
          ? 'Kampanya oluşturuldu ancak bildirim oluşturulamadı.'
          : draftWillBePlanned
          ? `Bu kampanya ileri tarihli olarak planlandi. Kampanya ${formatCampaignDate(startsAt)} tarihinde baslayacak ve o tarihe kadar fiyatlara yansimayacaktir.`
          : (existingCampaign ? 'Kampanya güncellendi.' : 'Kampanya eklendi.'),
      });
      return true;
    } catch (error) {
      setForm((current) => ({
        ...current,
        customerRelations: previousCustomerRelations,
      }));
      setToast({ type: 'error', title: 'Kampanya Yönetimi', message: error?.message || (existingCampaign ? 'Kampanya güncellenemedi.' : 'Kampanya kaydedilemedi.') });
      return false;
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
    if (!isCampaignSuggestionDiscountActionable(suggestion)) {
      setSelectedCampaignSuggestion(suggestion);
      setToast({
        type: 'warning',
        title: 'Kampanya YÃ¶netimi',
        message: 'Bu sinyal indirim kampanyasÄ± deÄŸil; fiyat, maliyet ve marj koÅŸullarÄ±nÄ± detaydan inceleyin.',
      });
      return;
    }
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
    const suggestionDraftTarget = resolveCampaignSuggestionDraftTarget({
      ...suggestion,
      productIds: nextProductIds,
      categoryIds: nextCategoryIds,
      brandNames: nextBrands,
    }, campaignTypeView);
    const targetView = suggestionDraftTarget.targetView;
    if (!targetView) {
      setSelectedCampaignSuggestion(suggestion);
      setToast({
        type: 'warning',
        title: 'Kampanya Yönetimi',
        message: 'Bu fırsat için önce ürün, kategori veya marka kapsamı netleşmeli.',
      });
      return;
    }
    const sourceModule = suggestionDraftTarget.sourceModule;
    const recommendedDiscount = Number(suggestion.recommendedDiscount ?? suggestion.recommendedDiscountRate);
    const recommendationTitle = normalizeCampaignInsightText(suggestion.title || '');
    const publicName = resolvePublicCampaignName({
      name: recommendationTitle,
      type: targetView,
      sourceModule,
    });
    hydrateCampaignDraft(targetView, {
      ...createDefaultCampaignDraft(targetView),
      name: publicName,
      publicName,
      displayName: publicName,
      internalName: recommendationTitle,
      recommendationTitle,
      type: targetView,
      sourceModule,
      discountRate: Number.isFinite(recommendedDiscount) && recommendedDiscount > 0 ? String(recommendedDiscount) : '',
      priority: suggestion.priority === 'critical' ? 9 : suggestion.priority === 'high' ? 7 : 5,
      targetProductIds: targetView === 'product' ? nextProductIds : [],
      targetCategoryIds: targetView === 'category' ? [...new Set(nextCategoryIds.map((id) => String(id || '').trim()).filter(Boolean))] : [],
      targetCategoryLabelIds: [],
      targetBrands: targetView === 'brand' ? normalizeCampaignBrandSelections(nextBrands, availableBrandLabelMap) : [],
    });
    setCampaignTypeView(targetView);
    setSelectedCampaignSuggestion(null);
  };

  const applyCampaignKpiAction = (key) => {
    if (key === 'dynamic') {
      setCampaignTypeView('dynamic');
      return;
    }
    if (key === 'urgent') {
      setCampaignTypeView('all');
      return;
    }
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
        message: `${selectedCampaignIds.length} kampanyada ${action} uygulandi`,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]).slice(0, 80));

    setToast({ type: 'success', title: 'Kampanya Yönetimi', message: 'Toplu işlem uygulandi.' });
  };

  const removeCampaign = async (campaignId) => {
    await persistCustomerRelations({
      ...(form.customerRelations || {}),
      campaigns: (form.customerRelations?.campaigns || []).filter((item) => item.id !== campaignId),
    }, 'Kampanya silindi.', 'Kampanya silinemedi.');
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
          archiveReason: nextActive ? '' : 'Yönetim tarafindan sonlandırıldı',
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
          ? { ...item, isActive: false, status: 'archived', archivedAt: new Date().toISOString(), archiveReason: 'Yönetim tarafindan sonlandırıldı' }
          : item
      )),
    }, 'Kampanya arsive tasindi.', 'Kampanya arsive tasinamadı.');
  };

  const editCampaignFromRow = (campaign) => {
    const campaignModule = normalizeCampaignDraftModuleKey(
      campaign?.type === 'dynamic' ? (campaign?.sourceModule || campaign?.module || classifyCampaignModule(campaign)) : campaign?.type,
      'general'
    );
    hydrateCampaignDraft(campaignModule, {
      ...createDefaultCampaignDraft(campaignModule),
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
      targetCategoryLabelIds: Array.isArray(campaign.targetCategoryLabelIds) ? campaign.targetCategoryLabelIds : [],
      targetProductIds: Array.isArray(campaign.targetProductIds) ? campaign.targetProductIds : [],
      targetBrands: normalizeCampaignBrandSelections(Array.isArray(campaign.targetBrands) ? campaign.targetBrands : [], availableBrandLabelMap),
      isActive: campaign.isActive !== false,
    });
    if (campaignModule !== activeCampaignDraftModule) {
      setCampaignTypeView(campaignModule);
    }
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
    resetCampaignDraft(activeCampaignDraftModule);
    setBrandCampaignSearch('');
  };

  const toggleCampaignCategory = (categoryId) => {
    setCampaignDraft((current) => {
      const nextSet = current.targetCategoryIds.includes(categoryId) ?
         current.targetCategoryIds.filter((id) => id !== categoryId)
        : [...current.targetCategoryIds, categoryId];
      const nextCategoryIds = new Set(nextSet);
      const nextLabelIds = (current.targetCategoryLabelIds || []).filter((labelId) => {
        const option = allCategoryLabelOptions.find((item) => item.id === labelId);
        return option && nextCategoryIds.has(option.categoryId);
      });
      return { ...current, targetCategoryIds: nextSet, targetCategoryLabelIds: nextLabelIds };
    });
  };

  const toggleCampaignCategoryLabel = (labelId) => {
    const safeLabelId = String(labelId || '').trim();
    if (!safeLabelId) return;
    setCampaignDraft((current) => {
      const currentLabels = Array.isArray(current.targetCategoryLabelIds) ? current.targetCategoryLabelIds : [];
      const nextSet = currentLabels.includes(safeLabelId)
        ? currentLabels.filter((id) => id !== safeLabelId)
        : [...currentLabels, safeLabelId];
      return { ...current, targetCategoryLabelIds: nextSet };
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

  const filteredGiftCards = giftCards;
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
      const stock = Number(
        product.shelfStock
        ?? product.shelfQuantity
        ?? product.currentStock
        ?? product.stockLevel
        ?? product.totalStock
        ?? product.quantity
        ?? 0
      );
      const price = Number(product.effectivePrice ?? product.currentPrice ?? product.salePrice ?? product.price ?? 0);
      return stock > 0 && price > 0;
    }).length
  ), [availableProducts]);
  const displayedAutoSaleEligibleProductCount = Number.isFinite(Number(autoSaleAvailability?.eligibleProductCount))
    ? Number(autoSaleAvailability.eligibleProductCount)
    : autoSaleEligibleProductCount;

  const filteredExpiryRows = expirySignalRows;

  const filteredExpirySuggestions = useMemo(() => {
    if (!filteredExpiryRows.length) return [];
    const rowIds = new Set(filteredExpiryRows.map((row) => String(row?.productId || row?.id || '')));
    return expirySuggestions.filter((item) => {
      if (!isCampaignSuggestionActionable(item)) return false;
      const rowMatch = Array.isArray(item?.productIds) && item.productIds.some((id) => rowIds.has(String(id)));
      return rowMatch;
    });
  }, [expirySuggestions, filteredExpiryRows]);

  const filteredSalesRows = salesSignalRows;

  const filteredSalesSuggestions = useMemo(() => {
    if (!filteredSalesRows.length) return [];
    const rowIds = new Set(filteredSalesRows.map((row) => String(row?.productId || row?.id || '')));
    return salesSuggestions.filter((item) => {
      if (!isCampaignSuggestionActionable(item)) return false;
      const rowMatch = Array.isArray(item?.productIds) && item.productIds.some((id) => rowIds.has(String(id)));
      return rowMatch;
    });
  }, [filteredSalesRows, salesSuggestions]);

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
          product.categoryLabelName,
          product.etiket,
          product.tag,
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
    const base = createDefaultCampaignDraft(activeCampaignDraftModule);
    return JSON.stringify(campaignDraft) !== JSON.stringify(base);
  }, [activeCampaignDraftModule, campaignDraft]);

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
    resetCampaignDraft(activeCampaignDraftModule);
    setAutomationRuleDraft(createDefaultAutomationRuleDraft());
    setGiftCardModalOpen(true);
  };

  const closeGiftCardModal = () => {
    setGiftCardCloseConfirmOpen(false);
    setGiftCardDraft(createDefaultGiftCardDraft());
    resetCampaignDraft(activeCampaignDraftModule);
    setAutomationRuleDraft(createDefaultAutomationRuleDraft());
    setGiftCardModalOpen(false);

    if (location.pathname === '/kampanya-yonetimi') {
      navigate('/sistem-ayarları');
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
      return 'Yeni PIN bos birakilamaz.';
    }
    if (!/^\d{4}$/.test(normalized)) {
      return 'PIN 4 haneli ve sadece sayı olmalıdır.';
    }
    if (String(currentPin || '').trim() === normalized) {
      return 'Yeni PIN mevcut PIN ile ayni olamaz.';
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
  };

  const renderCampaignBarChart = (rows = [], ariaLabel = 'Kampanya grafiği') => {
    return <CampaignBarChart rows={rows} ariaLabel={ariaLabel} formatNumber={formatNumber} />;
    const normalizedRows = rows.map((item) => ({
      ...item,
      count: Math.max(0, Number(item?.count || 0) || 0),
    }));
    const maxCount = Math.max(1, ...normalizedRows.map((item) => item.count));

    return (
      <div className="campaign-bar-chart" role="img" aria-label={ariaLabel}>
        {normalizedRows.map((item) => {
          const width = item.count > 0 ? Math.max(8, (item.count / maxCount) * 100) : 0;
          return (
            <div className="campaign-bar-chart-row" key={item.name}>
              <div className="campaign-bar-chart-label">
                <span>{item.name}</span>
                <strong>{formatNumber(item.count)}</strong>
              </div>
              <div className="campaign-bar-chart-track" aria-hidden="true">
                <span
                  className="campaign-bar-chart-fill"
                  style={{
                    '--campaign-chart-bar-width': `${width}%`,
                    '--campaign-chart-bar-color': item.color || '#4f46e5',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderCampaignChartEmpty = ({ title, description, showRefresh = false } = {}) => (
    <div className="campaign-chart-empty" role="status">
      <span className="campaign-chart-empty-icon" aria-hidden="true">
        {showRefresh ? <AlertTriangle size={18} /> : <Info size={18} />}
      </span>
      <strong>{title || 'Gösterilecek kampanya verisi bulunmuyor'}</strong>
      <span>{description || 'Veri oluştuğunda bu alan otomatik güncellenecek.'}</span>
      {showRefresh ? (
        <button
          type="button"
          className="ghost-button campaign-chart-empty-action"
          onClick={handleCampaignSuggestionsRefresh}
          disabled={campaignSuggestionRefreshing}
        >
          <RefreshCw size={14} className={campaignSuggestionRefreshing ? 'is-spinning' : ''} />
          Yenile
        </button>
      ) : null}
    </div>
  );

  const renderCampaignPagination = (key, total) => {
    const totalPages = Math.max(1, Math.ceil(total / CAMPAIGN_TABLE_PAGE_SIZE));
    const page = Math.min(getCampaignTablePage(key), totalPages);
    const start = total ? ((page - 1) * CAMPAIGN_TABLE_PAGE_SIZE) + 1 : 0;
    const end = total ? Math.min(page * CAMPAIGN_TABLE_PAGE_SIZE, total) : 0;
    if (!total) return null;

    return (
      <div className="campaign-table-pagination">
        <span>{start}-{end} / {formatNumber(total)}</span>
        <div className="campaign-table-pagination-actions">
          <button type="button" className="ghost-button" disabled={page === 1 || totalPages === 1} onClick={() => setCampaignTablePage(key, page - 1)}>Önceki</button>
          <button type="button" className="ghost-button" disabled={page === totalPages || totalPages === 1} onClick={() => setCampaignTablePage(key, page + 1)}>Sonraki</button>
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
    if (!total) return null;

    return (
      <div className="campaign-suggestions-pagination">
        <span>{start}-{end} / {formatNumber(total)}</span>
        <div className="campaign-suggestions-pagination-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={page === 1 || totalPages === 1}
            onClick={() => setCampaignInsightPage(key, page - 1)}
          >
            Önceki
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={page === totalPages || totalPages === 1}
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
  const pagedProductSuggestions = useMemo(
    () => paginateCampaignInsightRows(moduleCampaignSuggestions, 'product-suggestions'),
    [campaignInsightPages, moduleCampaignSuggestions]
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
    if (/sat[ii][ss]\s+verisi\s+yok/i.test(text)) return 'Yeterli satış verisi yok';
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
    description = 'Kritik kampanya göstergelerini tek satirda okuyun.',
    className = '',
    gridClassName = '',
    itemClassName = '',
  } = {}) => (
    <section className={`campaign-dashboard-card campaign-summary-section ${className}`.trim()} aria-label="Kampanya Özet göstergeleri">
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
    <section className="campaign-dashboard-card campaign-explainer-section" aria-label="Kampanya bilgi notlari">
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

  const renderCampaignSuggestionActions = (suggestion, primaryLabel = 'Kampanya Oluştur') => {
    const menuId = String(suggestion?.id || suggestion?.title || suggestion?.recommendationType || primaryLabel);
    const isMenuOpen = openCampaignActionMenuId === menuId;
    const canCreateCampaign = isCampaignSuggestionDiscountActionable(suggestion);
    return (
      <div className="table-actions campaign-insight-row-actions campaign-row-actions--menu">
        <button type="button" className="primary-button" onClick={() => createCampaignFromSuggestion(suggestion)} disabled={!canCreateCampaign} title={canCreateCampaign ? primaryLabel : 'Bu sinyal indirim kampanyasi olusturmaz'}>{canCreateCampaign ? primaryLabel : 'Indirim Yok'}</button>
        <div className="campaign-row-action-menu">
          <button
            type="button"
            className="campaign-row-action-menu-trigger"
            aria-label="Diğer aksiyonlar"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            title="Diğer aksiyonlar"
            onClick={() => setOpenCampaignActionMenuId((current) => (current === menuId ? null : menuId))}
          >
            <MoreHorizontal size={17} aria-hidden="true" />
          </button>
          {isMenuOpen ? (
            <div className="campaign-row-action-menu-panel" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpenCampaignActionMenuId(null);
                  setSelectedCampaignSuggestion(suggestion);
                }}
              >
                Detay
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderCampaignActionCandidatesTable = ({
    title,
    description,
    icon: SectionIcon = Megaphone,
    total,
    rows,
    paginationKey,
    columns,
    tableClassName = '',
    rowClassName,
    emptyTitle,
    emptyDescription,
  }) => (
    <CampaignActionCandidatesTable
      title={title}
      description={description}
      icon={SectionIcon}
      total={total}
      rows={rows}
      pagination={renderCampaignInsightPagination(paginationKey, total)}
      columns={columns}
      tableClassName={tableClassName}
      rowClassName={rowClassName}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
    />
  );

  const renderCampaignActionCandidatesTableLegacy = ({
    title,
    description,
    icon: SectionIcon = Megaphone,
    total,
    rows,
    paginationKey,
    columns,
    tableClassName = '',
    rowClassName,
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
        {renderCampaignInsightPagination(paginationKey, total)}
      </div>
      {total ? (
        <div className="table-wrapper campaign-insight-table-wrap">
          <table className={`data-table campaign-active-table campaign-standard-table campaign-insight-table campaign-insight-suggestion-table ${tableClassName}`.trim()}>
            <thead><tr>{columns.map((column) => <th key={column.key} className={column.className || ''}>{column.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={typeof rowClassName === 'function' ? rowClassName(row) : ''}>
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
        {renderCampaignInsightPagination(paginationKey, total)}
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
                  title: `${normalizeCampaignInsightText(row.productName)} için aksiyon Önerisi`,
                  reason: normalizeCampaignInsightText(row.summary),
                  affectedProductCount: 1,
                  recommendedDiscount: Math.max(8, Number(row?.suggestedDiscount || 12)),
                  type: 'product',
                  productIds: [row.productId || row.id],
                  priority: row.riskLevel || 'medium',
                  impactSummary: normalizeCampaignInsightText(row.recommendation),
                  riskSummary: 'Aksiyon Öncesi marj ve stok yeterliligi tekrar kontrol edilmelidir.',
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
                    'Satış hızı düşük ve stok bekleme riski yüksek Ürünler seçildi.',
                    'SKT, stok ve marj sinyalleri birlikte değerlendirildi.',
                    'Önerilen indirim oranı kampanya taslağına başlangıç değeri olarak aktarilir.',
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
                        <button type="button" className="ghost-button" onClick={() => setSelectedCampaignSuggestion(actionSuggestion)}>Detay</button>
                        <button type="button" className="primary-button" onClick={() => createCampaignFromSuggestion(actionSuggestion)}>Oluştur</button>
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
            <strong>{simulation?.recommendation || 'Öneri Üretilemedi.'}</strong>
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
    emptyMessage = 'Gösterilecek veri bulunamadı.',
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
            <span>Veri geldikçe daha fazla Ürün sinyali burada görünür.</span>
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
            ? 'Seçili aksiyonun etkisi satış hızı, stok ve marj sinyallerine göre hesaplandi.'
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
                    <b>{formatNumber(affectedCount)} Ürün etkilenecek</b>
                    {hasSeparateCandidateCount ? <small>Analiz Önizlemesi {formatNumber(candidateCount)} aday Ürün Üzerinden hesaplandi</small> : null}
                  </div>
                </div>
                <div className="campaign-preview-stats campaign-preview-stats--compact">
                  <div><span>Tahmini satış artışı</span><strong>{formatSimulationPercent(simulation?.salesIncreasePct)}</strong></div>
                  <div><span>Tahmini ciro etkisi</span><strong>{formatSimulationMoney(simulation?.revenueChange)}</strong></div>
                  <div><span>Tahmini marj etkisi</span><strong>{formatSimulationPercent(simulation?.marginImpact)}</strong></div>
                  <div><span>Stok devir etkisi</span><strong>{formatSimulationPercent(simulation?.stockTurnEffect)}</strong></div>
                  <div><span>{metricTailLabel === 'SKT riski' ? 'SKT riski' : 'Risk seviyesi'}</span><strong>{metricTailLabel === 'SKT riski' ? formatSimulationPercent(simulation?.riskReductionScore) : normalizeCampaignInsightText(simulation?.riskLevel || '-')}</strong></div>
                  <div><span>{metricTailLabel === 'SKT riski' ? 'Etkilenen Ürün sayısı' : 'Ortalama stok tükenme'}</span><strong>{metricTailLabel === 'SKT riski' ? formatNumber(affectedCount) : (hasStockDepletion ? `${formatNumber(simulation?.stockDepletionDays)} gün` : 'Yeterli satış verisi yok')}</strong></div>
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
        reason: 'Sistem tarafindan sonlandırıldı',
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
          ? 'Sistem tarafindan sonlandırıldı'
          : 'Yönetim tarafindan sonlandırıldı',
        badgeClassName: 'neutral',
        isActive: false,
        canEdit: false,
      };
    }

    return {
      label: 'Yayında değil',
      reason: rawStatus === 'draft' || rawStatus === 'paused' || rawStatus === 'inactive' || !archiveReason
        ? 'Yayında değil'
        : 'Yönetim tarafindan sonlandırıldı',
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
    mode = 'active',
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
          {renderCampaignPagination(tableKey, rows.length)}
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
                const detailActionLabel = mode === 'planned' ? 'Gözden Geçir' : 'Görüntüle';
                const detailViewMode = mode === 'planned' ? 'planned' : (statusMeta.isActive ? 'active' : 'archive');

                return (
                <tr key={item.id} className="campaign-active-row">
                  {selectable ? <td><input type="checkbox" aria-label={`${item.name} kampanyasıni seç`} checked={selectedCampaignIds.includes(item.id)} onChange={(event) => toggleCampaignSelection(item.id, event.target.checked)} /></td> : null}
                  <td><strong>{item.name}</strong><div className="muted-text">{getCampaignPriorityDisplayLabel(item.priority)}</div></td>
                  <td>{CAMPAIGN_TYPE_LABELS[item.type] || item.type}</td>
                  <td>%{formatNumber(item.discountRate)}</td>
                  <td>{item.startsAt || '-'}</td>
                  <td>{item.isIndefinite ? 'Süresiz' : (item.endsAt || '-')}</td>
                  <td><span className={`badge ${statusMeta.badgeClassName}`}>{statusMeta.label}</span></td>
                  <td>{statusMeta.reason}</td>
                  <td className="table-cell-actions">
                    <div className="table-actions campaign-row-actions">
                      <button className="text-button" type="button" onClick={() => setSelectedCampaignDetail({ ...item, __viewMode: detailViewMode })}>{detailActionLabel}</button>
                      {statusMeta.canEdit ? (
                        <>
                          <button className="text-button" type="button" onClick={() => openCampaignEditModal(item)}>Düzenle</button>
                          <button className="text-button danger" type="button" onClick={() => toggleCampaignStatus(item.id)}>Sonlandir</button>
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

    const now = new Date();
    const activeRows = rows.filter((item) => isCampaignCurrentlyActive(item, now));
    const plannedRows = rows.filter((item) => isCampaignPlanned(item, now));
    const archiveRows = rows.filter((item) => isDefaultCampaignArchiveRow(item, now));
    const moduleTitles = CAMPAIGN_MODULE_TABLE_TITLES[tableKeyPrefix] || CAMPAIGN_MODULE_TABLE_TITLES.all;
    const activeDescription = tableKeyPrefix === 'expiry'
      ? 'Yayındaki SKT odaklı kampanyaları takip edin.'
      : tableKeyPrefix === 'sales'
        ? 'Yayındaki satış performansı odaklı kampanyaları takip edin.'
        : 'Yayındaki kampanyaları takip edin.';
    const archiveDescription = tableKeyPrefix === 'expiry'
      ? 'Geçmiş SKT kampanyalarını ve kapanma durumlarını inceleyin.'
      : tableKeyPrefix === 'sales'
        ? 'Geçmiş satış bazlı kampanyaları ve kapanma durumlarını inceleyin.'
        : 'Geçmiş, pasif veya arşivlenmiş kampanyaları inceleyin.';

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
          description: activeDescription,
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
          description: archiveDescription,
          rows: archiveRows,
          tableKey: `${tableKeyPrefix}-archive`,
          sectionMeta: CAMPAIGN_TABLE_SECTION_META[tableKeyPrefix]?.archive,
          emptyTitle: 'Kayıt bulunamadı',
          emptyDescription: tableKeyPrefix === 'expiry' ? 'Kampanya arşivi bos.' : 'Kampanya arşivi bos.',
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
    emptyMessage: 'Önerinin bagli oldugu Ürün verisi bulunamadı.',
  }), [form.currency, selectedCampaignSuggestion, selectedSuggestionRows]);
  const selectedSuggestionPriceUpSimulation = useMemo(() => {
    if (!selectedSuggestionRows.length) {
      return {
        isEmpty: true,
        title: 'Alternatif fiyat etkisi hazır değil',
        emptyMessage: 'Ürün verisi olmadan fiyat etkisi hesaplanamiyor.',
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
        ? 'Talep güçlü oldugu için küçük bir fiyat artışı marj optimizasyonu için test edilebilir.'
        : 'Satış hızı sınırlı Ürünlerde fiyat artışı yerine kampanya veya görünürlük aksiyonu daha güvenlidir.',
      metricsSummary: `${formatNumber(rows.length)} Ürün • %5 fiyat artışı varsayımi • satışta sınırlı daralma kabulü`,
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
  const licenseOverview = useMemo(() => buildLicenseOverview(user, form), [form, user]);

  return (
    <div ref={pageRootRef} className={`page-stack ${isCampaignPage ? 'campaign-management-page' : ''}`}>
      <Toast toast={toast} onClose={() => setToast(null)} />
      {showPinGate && (
        <PinGate
          title="Güvenlik Dogrulamasi"
          description="Hassas ayarlara erismek için PIN giriniz."
          type="settings"
          onSuccess={() => { setSecurityUnlocked(true); setSecurityEditMode(true); setShowPinGate(false); }}
          onCancel={() => setShowPinGate(false)}
        />
      )}
      <PageHeader
        className="dashboard-hero"
        icon={isCampaignPage ? <Megaphone size={22} /> : <SettingsIcon size={22} />}
        title={isCampaignPage ? 'Kampanya Yönetimi' : 'Sistem Ayarlari'}
        description={isCampaignPage ? 'Kampanya performansını analiz edin.' : 'Mağaza ve sistem ayarlarını yapılandırın.'}
        actions={isCampaignPage ? (
          <div className="campaign-header-actions" aria-label="Kampanya sayfası aksiyonları">
            <span className="campaign-header-updated" aria-live="polite">
              {campaignHeaderRefreshLabel}
            </span>
            <button
              type="button"
              className="primary-button campaign-header-refresh-button"
              onClick={handleCampaignSuggestionsRefresh}
              disabled={campaignSuggestionRefreshing}
              title="Yenile"
              aria-label="Kampanya verilerini yenile"
            >
              <RefreshCw size={15} className={campaignSuggestionRefreshing ? 'is-spinning' : ''} />
              Yenile
            </button>
          </div>
        ) : (
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
        )}
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
                  }}
                >
                  <TabIcon size={14} />
                  <span className="campaign-switch-label">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {isCampaignPage && visibleCampaignSuggestions.length ? (
        <div className="sr-only campaign-sr-actions" aria-label="Kampanya Önerisi hızlı aksiyonları">
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
              <div className="s-auto-sale-title-copy">
                <h3 className="s-card-title">Otomatik Satış Paneli</h3>
                <p className="s-card-desc">Seçilen kasalarda gerçek Ürün, stok ve Ödeme akisiyla satış Üretir.</p>
              </div>
            </div>
            <div className="s-auto-sale-header-actions">
              <span className="s-auto-sale-source-note">Kaynak: Otomatik satış paneli</span>
              <span className={`s-auto-sale-status-badge ${autoSaleActive ? 'is-active' : 'is-passive'}`}>{autoSaleActive ? 'Aktif' : 'Pasif'}</span>
              <button type="button" className="primary-button" onClick={startAutoSaleAutomation} disabled={autoSaleActive || Boolean(autoSaleValidationMessage)}>
                Baslat
              </button>
              <button type="button" className="ghost-button danger" onClick={stopAutoSaleAutomation} disabled={!autoSaleActive}>
                Durdur
              </button>
            </div>
          </div>

          <fieldset className="s-auto-sale-fieldset">
            <div className="s-auto-sale-fieldset-title">Ayarlar</div>
            <div className="s-auto-sale-grid s-auto-sale-primary-grid">
              <label className="s-field">
                <span className="s-field-label">Yogunluk</span>
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
                <span className="s-field-label">Iade oranı (%)</span>
                <input className="s-config-input" type="number" min="0" max="100" step="0.1" value={autoSaleConfig.returnRate} onChange={(event) => updateAutoSaleConfig('returnRate', event.target.value)} disabled={autoSaleActive} />
              </label>
              <label className="s-field">
                <span className="s-field-label">Minimum Ürün çeşidi</span>
                <input className="s-config-input" type="number" min="1" step="1" value={autoSaleConfig.minProductCount} onChange={(event) => updateAutoSaleConfig('minProductCount', event.target.value)} disabled={autoSaleActive} />
              </label>
              <label className="s-field">
                <span className="s-field-label">Maksimum Ürün çeşidi</span>
                <input className="s-config-input" type="number" min="1" step="1" value={autoSaleConfig.maxProductCount} onChange={(event) => updateAutoSaleConfig('maxProductCount', event.target.value)} disabled={autoSaleActive} />
              </label>
              <label className="s-field">
                <span className="s-field-label">Çalisma süresi</span>
                <select className="s-config-select" value={autoSaleConfig.duration} onChange={(event) => updateAutoSaleConfig('duration', event.target.value)} disabled={autoSaleActive}>
                  {AUTO_SALE_DURATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </div>
            {autoSaleConfig.duration === 'custom' ? (
              <div className="s-auto-sale-grid s-auto-sale-duration-grid">
                <label className="s-field">
                  <span className="s-field-label">Özel süre (dk)</span>
                  <input className="s-config-input" type="number" min="1" step="1" value={autoSaleConfig.customMinutes} onChange={(event) => updateAutoSaleConfig('customMinutes', event.target.value)} disabled={autoSaleActive} />
                </label>
              </div>
            ) : null}

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

            {autoSaleError || autoSaleValidationMessage ? <div className="s-auto-sale-error" role="alert">{autoSaleError || autoSaleValidationMessage}</div> : null}
          </fieldset>

          <div className="s-auto-sale-bottom-grid">
            <section className="s-auto-sale-sub-card">
              <div className="s-auto-sale-sub-card-head">
                <h4>Üretilen Satış Özeti</h4>
                <span>{autoSaleActive ? 'Çalisiyor' : 'Beklemede'}</span>
              </div>
              <div className="s-auto-sale-summary-grid">
                <div><span>Toplam satış adedi</span><strong>{formatNumber(autoSaleSummary.totalCount)}</strong></div>
                <div><span>Toplam satış tutari</span><strong>{formatCurrency(autoSaleSummary.totalAmount)}</strong></div>
                <div><span>Son satış zamani</span><strong>{autoSaleSummary.lastSaleAt ? formatDate(autoSaleSummary.lastSaleAt) : '-'}</strong></div>
                <div><span>Aktif kasalar</span><strong>{(autoSaleSummary.activeDeskCodes || autoSaleConfig.deskCodes).join(', ') || '-'}</strong></div>
                <div><span>Stokta uygun Ürün sayısi</span><strong>{formatNumber(displayedAutoSaleEligibleProductCount)}</strong></div>
                <div><span>Kalan süre</span><strong>{autoSaleActive ? formatAutoSaleRemainingTime(autoSaleRemainingMs) : '-'}</strong></div>
                <div><span>Iade oranı</span><strong>%{Number(autoSaleConfig.returnRate || 0).toLocaleString('tr-TR')}</strong></div>
                <div><span>Olusan iade adedi</span><strong>{formatNumber(autoSaleSummary.returnedCount || 0)}</strong></div>
              </div>
            </section>
            <section className="s-auto-sale-sub-card s-auto-sale-recent-card">
              <div className="s-auto-sale-sub-card-head">
                <h4>Son 5 İşlem</h4>
                <span>Otomatik panel</span>
              </div>
              {autoSaleRecentTransactions.length ? (
                <div className="s-auto-sale-recent-list">
                  {autoSaleRecentTransactions.map((transaction) => (
                    <div className="s-auto-sale-recent-row" key={transaction.referenceNo}>
                      <div className="s-auto-sale-recent-main">
                        <strong>{transaction.referenceNo || '-'}</strong>
                        <span>{AUTO_SALE_TRANSACTION_TYPE_LABELS[transaction.type] || transaction.type || '-'}</span>
                      </div>
                      <div className="s-auto-sale-recent-meta">
                        <span>{formatCurrency(transaction.totalAmount || 0)}</span>
                        <span>{transaction.deskCode || '-'}</span>
                        <span>{AUTO_SALE_PAYMENT_LABELS[transaction.paymentMethod] || transaction.paymentMethod || '-'}</span>
                        <span>{transaction.createdAt ? formatDate(transaction.createdAt) : '-'}</span>
                        <span>{formatNumber(transaction.itemCount || 0)} Ürün</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="s-auto-sale-recent-empty">Henüz otomatik işlem yok.</div>
              )}
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
                <button type="button" className="mod-stat campaign-stat-button" onClick={() => applyCampaignKpiAction('active')}>
                  <div className="mod-stat-icon mod-icon-green"><ShieldCheck size={20} /></div><div className="mod-stat-body"><span className="mod-stat-label">Aktif Kampanya</span><span className="mod-stat-value">{formatNumber(campaignSummary.active)}</span><span className="mod-stat-caption">Su anda yayında</span></div>
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
                <button type="button" className="mod-stat campaign-stat-button" onClick={() => applyCampaignKpiAction('active')}>
                  <div className="mod-stat-icon mod-icon-cyan"><Gift size={20} /></div><div className="mod-stat-body"><span className="mod-stat-label">Kampanyali Ürün</span><span className="mod-stat-value">{formatNumber(campaignSummary.promotedProducts)}</span><span className="mod-stat-caption">Aktif kampanya kapsamı</span></div>
                </button>
              </section>
            ) : null}

            {isHomeCampaignView ? (
              <section className="campaign-chart-grid campaign-section" aria-label="Kampanya Özet grafikleri">
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
                        renderCampaignBarChart(campaignStatusDistributionData, 'Kampanya durumu dağılımı')
                      ) : (
                        renderCampaignChartEmpty(campaignStatusEmptyState)
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
                        renderCampaignBarChart(campaignTypeDistributionData, 'Kampanya tipi dağılımı')
                      ) : (
                        renderCampaignChartEmpty(campaignTypeEmptyState)
                      )}
                    </div>
                  </div>
                </article>

                <article className="campaign-chart-card campaign-chart-card--suggestion">
                  <div className="campaign-chart-head">
                    <span className="campaign-chart-badge campaign-chart-badge--amber" aria-hidden="true"><Sparkles size={16} /></span>
                    <div>
                      <h4>Öneri Önceliği</h4>
                      <p className="campaign-chart-desc">Kampanya Önerilerinin Öncelik seviyeleri.</p>
                    </div>
                  </div>
                  <div className="campaign-chart-body">
                    <div className="campaign-chart-canvas">
                      {hasCampaignSuggestionChartData ? (
                        renderCampaignBarChart(campaignSuggestionDistributionData, 'Öneri önceliği dağılımı')
                      ) : (
                        renderCampaignChartEmpty({
                          ...campaignSuggestionEmptyState,
                          showRefresh: Boolean(crossModuleError),
                        })
                      )}
                    </div>
                  </div>
                </article>
              </section>
            ) : null}

            {isHomeCampaignView ? (
              <section className="campaign-table-card campaign-suggestion-candidates-card campaign-section" aria-label="Kampanya öneri adayları">
                <div className="campaign-table-card-head">
                  <div className="campaign-table-card-head-main">
                    <span className="campaign-table-card-icon mod-icon-amber" aria-hidden="true"><Sparkles size={16} /></span>
                    <div>
                      <h4>Kampanya Öneri Adayları</h4>
                      <p>Modüllerden bağımsız oluşan, kampanyaya dönüştürülebilecek öneri adayları.</p>
                    </div>
                  </div>
                  {campaignSuggestionCandidateRows.length ? (
                    <div className="campaign-candidate-pagination campaign-candidate-pagination--top" aria-label="Kampanya öneri adayları sayfalama">
                      <span>{formatNumber(campaignCandidateStartIndex)}-{formatNumber(campaignCandidateEndIndex)} / {formatNumber(campaignSuggestionCandidateRows.length)}</span>
                      <div>
                        <button type="button" className="ghost-button" disabled={safeCampaignCandidatePage === 1} onClick={() => setCampaignCandidatePage((current) => Math.max(1, current - 1))}>Önceki</button>
                        <button type="button" className="ghost-button" disabled={safeCampaignCandidatePage === campaignCandidateTotalPages} onClick={() => setCampaignCandidatePage((current) => Math.min(campaignCandidateTotalPages, current + 1))}>Sonraki</button>
                      </div>
                    </div>
                  ) : null}
                </div>

                {campaignSuggestionCandidateRows.length ? (
                  <>
                  <div className="table-wrapper campaign-suggestion-candidates-wrap">
                    <table className="data-table campaign-standard-table campaign-suggestion-candidates-table">
                      <thead>
                        <tr>
                          <th>Öneri Başlığı</th>
                          <th>Modül / Kapsam</th>
                          <th>Öneri Türü</th>
                          <th>Öncelik</th>
                          <th>Durum</th>
                          <th>Etkilenen Ürün</th>
                          <th>Önerilen Aksiyon</th>
                          <th>Neden</th>
                          <th>İşlemler</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedCampaignSuggestionCandidateRows.map((suggestion) => (
                          <tr key={`candidate-${suggestion.id || suggestion.recommendationType || suggestion.title}`}>
                            <td className="campaign-suggestion-candidate-title">
                              <strong title={normalizeCampaignInsightText(suggestion.title)}>{normalizeCampaignInsightText(suggestion.title)}</strong>
                              <span>{normalizeCampaignInsightText(suggestion.scopeLabel || CAMPAIGN_TYPE_LABELS[suggestion.type] || 'Çapraz fırsat')}</span>
                            </td>
                            <td>
                              <span className="campaign-signal-pill is-neutral">{normalizeCampaignInsightText(suggestion.moduleLabel || suggestion.primaryModule || 'Genel')}</span>
                            </td>
                            <td>{formatCampaignRecommendationType(suggestion.recommendationType || suggestion.id || 'campaign_opportunity')}</td>
                            <td>
                              <span className={`campaign-signal-pill ${getCampaignToneClass(suggestion.priority)}`}>
                                {getCampaignPriorityDisplayLabel(suggestion.priority)}
                              </span>
                            </td>
                            <td>
                              <span className={`campaign-signal-pill ${getCampaignSuggestionStatusToneClass(suggestion)}`}>
                                {getCampaignSuggestionStatusDisplayLabel(suggestion)}
                              </span>
                            </td>
                            <td>{formatNumber(suggestion.affectedProductCount || 0)} Ürün</td>
                            <td className="campaign-suggestion-candidate-action">
                              <span>{normalizeCampaignInsightText(suggestion.suggestedAction || 'Kampanya oluştur')}</span>
                              {Number(suggestion.recommendedDiscount || 0) > 0 ? <small>%{formatNumber(suggestion.recommendedDiscount)} indirim</small> : null}
                            </td>
                            <td className="campaign-suggestion-candidate-reason">
                              <span title={normalizeCampaignInsightText(suggestion.reason)}>{normalizeCampaignInsightText(suggestion.reason || 'Gerekçe verisi yok.')}</span>
                            </td>
                            <td className="table-cell-actions">
                              {renderCampaignSuggestionActions(suggestion, 'Kampanya Oluştur')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                ) : (
                  <div className="campaign-table-empty">
                    <strong>Gösterilecek kampanya öneri adayı bulunmuyor.</strong>
                    <span>Analiz motorundan gelen uygun öneriler oluştuğunda bu listede görünür.</span>
                  </div>
                )}
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
                        <h4>{campaignTypeView === 'general' ? 'Mağaza Geneli İndirim' : 'Kampanya Bilgileri'}</h4>
                        <p>{campaignTypeView === 'general' ? 'Tüm mağaza Ürünlerine uygulanacak genel kampanya bilgilerini tanımlayın.' : 'Kampanyanin temel kimliğini ve indirimi tanımlayın.'}</p>
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
                          <p>Arama ile Ürün ekleyin; tüm Ürünler sayfa açilisinda yüklenmez.</p>
                        </div>
                        <div className="campaign-product-picker">
                          <div className="campaign-product-search-row">
                            <label className="field-group">
                              <span>Ürün ara</span>
                              <input
                                type="search"
                                value={productCampaignSearch}
                                onFocus={() => { void loadCampaignProducts(); }}
                                onChange={(event) => {
                                  setProductCampaignSearch(event.target.value);
                                  if (!availableProductsLoaded) void loadCampaignProducts();
                                }}
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
                              productCampaignSearch && availableProductsLoading ? (
                                <div className="campaign-product-search-empty">Ürünler yükleniyor...</div>
                              ) : productCampaignSearch ? (
                                <div className="campaign-product-search-empty">Eşleşen Ürün bulunamadı.</div>
                              ) : null
                            )}
                          </div>

                          <div className="campaign-selected-products" aria-label="Seçilen Ürünler">
                            <div className="campaign-selected-products-head">
                              <strong>Seçilen Ürünler</strong>
                              <span>{formatNumber(selectedCampaignProducts.length)} Ürün</span>
                            </div>
                            {selectedCampaignProducts.length ? (
                              <div className="campaign-selected-product-list">
                                {selectedCampaignProducts.map((product) => (
                                  <span key={product.id} className="campaign-selected-product-chip">
                                    {product.label}
                                    <button type="button" onClick={() => toggleCampaignProduct(product.id)} aria-label={`${product.label} Ürünönü kaldır`}>
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
                          <p>Kampanyanin uygulanacagi kategorileri seçin.</p>
                        </div>
                        <div className="campaign-category-scope-layout">
                          <section className="campaign-category-scope-pane">
                            <div className="campaign-category-scope-pane-head">
                              <h5>Kategori Seçimi</h5>
                              <span>{formatNumber(campaignDraft.targetCategoryIds.length)} seçili</span>
                            </div>
                            <div className="s-giftcard-category-grid campaign-category-grid-list">
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
                          </section>
                          <section className="campaign-category-scope-pane">
                            <div className="campaign-category-label-scope">
                              <div className="campaign-category-label-toolbar">
                                <label className="field-group">
                                  <span>Etiket Ara <small>(Opsiyonel)</small></span>
                                  <input
                                    type="search"
                                    value={categoryLabelSearch}
                                    onChange={(event) => setCategoryLabelSearch(event.target.value)}
                                    placeholder="Etiket adı veya kategori"
                                  />
                                </label>
                                {selectedCategoryLabelOptions.length ? <span className="campaign-category-label-count">{formatNumber(selectedCategoryLabelOptions.length)} etiket seçildi</span> : null}
                              </div>
                              {selectedCategoryLabelOptions.length ? (
                                <div className="campaign-category-label-selected" aria-label="Seçilen etiketler">
                                  {selectedCategoryLabelOptions.map((option) => (
                                    <span key={option.id} className="campaign-selected-product-chip">
                                      {option.label}
                                      <button type="button" onClick={() => toggleCampaignCategoryLabel(option.id)} aria-label={`${option.label} etiketini kaldır`}>
                                        <X size={12} />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              <div className="campaign-category-label-grid">
                                {selectedCategoryIdSet.size && visibleCategoryLabelOptions.length ? (
                                  visibleCategoryLabelOptions.map((option) => (
                                    <button
                                      key={option.id}
                                      type="button"
                                      className={`campaign-category-label-chip ${selectedCategoryLabelIdSet.has(option.id) ? 'is-selected' : ''}`}
                                      onClick={() => toggleCampaignCategoryLabel(option.id)}
                                    >
                                      <span>{option.label}</span>
                                      {option.categoryName ? <small>{option.categoryName}</small> : null}
                                    </button>
                                  ))
                                ) : null}
                              </div>
                            </div>
                          </section>
                        </div>
                      </article>
                    ) : null}

                    {campaignTypeView === 'brand' ? (
                      <article className="campaign-form-group">
                        <div className="campaign-form-group-head">
                          <h4>Marka Seçimi</h4>
                          <p>Kampanyanin uygulanacagi markalari seçin.</p>
                        </div>
                        <div className="campaign-product-picker campaign-brand-picker">
                          <div className="campaign-brand-toolbar">
                            <label className="field-group campaign-brand-search-field">
                              <span>Marka ara</span>
                              <input
                                type="search"
                                value={brandCampaignSearch}
                                onFocus={() => { void loadCampaignProducts(); }}
                                onChange={(event) => {
                                  setBrandCampaignSearch(event.target.value);
                                  if (!availableProductsLoaded) void loadCampaignProducts();
                                }}
                                placeholder="En az 2 karakter ile arayin"
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
                                <span>{availableProductsLoading ? 'Markalar yükleniyor...' : 'Markalar Ürün verilerinden dinamik olarak listelenir.'}</span>
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
                          : 'Bu kampanya kapsamı için yeterli satış geçmişi bulunmadıgindan tahmin Üretilemedi.';

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
                    <button className="outline-button" type="button" onClick={() => resetCampaignDraft(activeCampaignDraftModule)}>Taslağı Temizle</button>
                  </div>
                </section>
                ) : null}

                {shouldShowCampaignSuggestionPanel ? renderCampaignActionCandidatesTable({
                  title: 'Ürün Bazlı Öneriler',
                  description: 'Aksiyon alınabilir ürün önerileri sade tablo görünümünde listelenir.',
                  icon: Package,
                  total: moduleCampaignSuggestions.length,
                  rows: pagedProductSuggestions.pageRows,
                  paginationKey: 'product-suggestions',
                  tableClassName: 'campaign-insight-table--compact campaign-insight-table--product-actions',
                  emptyTitle: 'Bu modülde öneri yok',
                  emptyDescription: 'Uygun ve aksiyon alınabilir ürün önerileri oluştuğunda burada görünür.',
                  columns: [
                    { key: 'title', label: 'Öneri Başlığı', className: 'campaign-insight-title-cell campaign-insight-cell-title', render: (suggestion) => <strong title={normalizeCampaignInsightText(suggestion.title)}>{normalizeCampaignInsightText(suggestion.title)}</strong> },
                    { key: 'recommendationType', label: 'Öneri Türü', className: 'campaign-insight-cell-type', render: (suggestion) => <span className="campaign-signal-pill is-neutral">{formatCampaignRecommendationType(suggestion.recommendationType || suggestion.id || 'campaign_opportunity')}</span> },
                    { key: 'scope', label: 'Kapsam', className: 'campaign-insight-cell-scope', render: (suggestion) => formatCampaignScopeLabel(suggestion.scopeLabel || CAMPAIGN_TYPE_LABELS[suggestion.type] || 'Ürün Bazlı') },
                    { key: 'product', label: 'Etkilenen Ürün', className: 'campaign-insight-cell-count', render: (suggestion) => `${formatNumber(suggestion.affectedProductCount)} Ürün` },
                    { key: 'discount', label: 'Önerilen İndirim', className: 'campaign-insight-metric-cell', render: (suggestion) => Number(suggestion.recommendedDiscount || 0) > 0 ? `%${formatNumber(suggestion.recommendedDiscount)}` : '—' },
                    { key: 'priority', label: 'Öncelik', className: 'campaign-insight-cell-status', render: (suggestion) => <span className={`campaign-signal-pill ${getCampaignToneClass(suggestion.priority)}`}>{getCampaignPriorityDisplayLabel(suggestion.priority)}</span> },
                    { key: 'status', label: 'Uygunluk Durumu', className: 'campaign-insight-cell-status', render: (suggestion) => <span className={`campaign-signal-pill ${getCampaignSuggestionStatusToneClass(suggestion)}`}>{getCampaignSuggestionStatusDisplayLabel(suggestion)}</span> },
                    { key: 'impact', label: 'Etki Özeti', className: 'campaign-insight-cell-impact', render: (suggestion) => <span title={getCampaignSuggestionImpactSummary(suggestion)}>{getCampaignSuggestionImpactSummary(suggestion)}</span> },
                    {
                      key: 'actions',
                      label: 'İşlemler',
                      className: 'table-cell-actions campaign-insight-cell-actions',
                      render: (suggestion) => (
                        renderCampaignSuggestionActions(suggestion, 'Kampanya Oluştur')
                      ),
                    },
                  ],
                }) : null}

                {isCampaignBuilderView ? renderSingleCampaignModuleTable({
                  title: CAMPAIGN_MODULE_SINGLE_TABLE_TITLES[campaignTypeView] || 'Kampanya Listesi',
                  description: 'Aktif kampanyalar, planlananlar ve arşiv kayıtları ayrı tablolarda izlenir.',
                  rows: moduleCampaignRows,
                  tableKeyPrefix: campaignTypeView,
                  splitLifecycle: true,
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
                      <CampaignGiftCardKpiRow
                        assignedGiftCardCount={assignedGiftCardCount}
                        assignableGiftCardCount={assignableGiftCards.length}
                        activeGiftCardCount={activeGiftCardCount}
                        formatNumber={formatNumber}
                      />

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
                            <span>Deger</span>
                            <input type="number" min="0" step="0.01" value={giftCardDraft.value} onChange={(event) => setGiftCardDraft((current) => ({ ...current, value: event.target.value }))} placeholder={giftCardDraft.valueType === 'percentage' ? '10' : '150'} />
                          </label>
                        </div>
                        <div className="s-giftcard-inline-fields s-giftcard-inline-fields--triple">
                          <label>
                            <span>Kullanim Hakki</span>
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
                            <span>Geçerlilik Tarihi / Son Kullanim Tarihi</span>
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
                      <h4>Mevcut Kartlar ({filteredGiftCards.length})</h4>
                      {giftCards.length === 0 ? (
                        <div className="s-giftcard-empty campaign-giftcard-empty">
                          <Gift size={20} />
                          <p>Henüz hediye kartı tanımlanmadı. Yeni bir kart oluşturarak müşteri bağlılığını artırabilirsiniz.</p>
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
                                {isExpired ? <small className="campaign-giftcard-expired">Geçerliligi doldu</small> : null}
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
                                  setToast({ type: 'info', title: 'Hediye Kartı', message: 'Kart bilgisi forma aktarildi.' });
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
                      description: 'SKT yaklaşan Ürünleri hızlıca okuyun, riski sadeleştirin ve indirim aksiyonunu tek ekrandan başlatın.',
                      className: 'expiry-campaign-header',
                    })}

                    {renderCampaignKpiCards([
                      {
                        icon: AlertTriangle,
                        iconClassName: 'mod-icon-rose',
                        label: 'Bugün Kritik SKT',
                        value: formatNumber(filteredExpiryRows.filter((row) => Number(row?.daysToExpiry || 999) <= 0).length),
                        description: 'Bugün aksiyon bekleyen Ürünler',
                      },
                      {
                        icon: CalendarClock,
                        iconClassName: 'mod-icon-amber',
                        label: '3 Gün İçinde SKT',
                        value: formatNumber(filteredExpiryRows.filter((row) => {
                          const days = Number(row?.daysToExpiry || 999);
                          return days > 0 && days <= 3;
                        }).length),
                        description: 'Hızlı indirim adayı Ürünler',
                      },
                      {
                        icon: CalendarDays,
                        iconClassName: 'mod-icon-indigo',
                        label: '7 Gün İçinde SKT',
                        value: formatNumber(filteredExpiryRows.filter((row) => {
                          const days = Number(row?.daysToExpiry || 999);
                          return days > 0 && days <= 7;
                        }).length),
                        description: 'Planli kampanya adayı Ürünler',
                      },
                      {
                        icon: Coins,
                        iconClassName: 'mod-icon-violet',
                        label: 'Olasi Fire Riski',
                        value: formatCurrency(filteredExpiryRows.reduce((sum, row) => sum + (Number(row?.stockLevel || 0) * Number(row?.currentPrice || 0)), 0), form.currency),
                        description: 'Stok değeri Üzerinden tahmini risk',
                      },
                    ], {
                      title: 'Kampanya Bilgileri',
                      description: 'SKT riski ve hızlı indirim kapsamını Özetleyen temel göstergeler.',
                      className: 'expiry-campaign-metrics',
                      gridClassName: 'expiry-campaign-metrics-grid',
                      itemClassName: 'expiry-campaign-metric-card',
                    })}

                  </section>

                  <div className="campaign-content-sections campaign-insight-layout campaign-insight-layout--insight">
                    {renderCampaignActionCandidatesTable({
                      title: 'Hızlı İndirim Adayları',
                      description: 'SKT odaklı indirim Önerilerini takip edin.',
                      icon: Megaphone,
                      total: filteredExpirySuggestions.length,
                      rows: pagedExpirySuggestions.pageRows,
                      paginationKey: 'expiry-suggestions',
                      tableClassName: 'campaign-insight-table--compact campaign-insight-table--expiry-actions',
                      emptyTitle: 'Aksiyon adayı bulunamadı.',
                      emptyDescription: 'Yeni indirim Önerileri veri geldikçe burada görünür.',
                      columns: [
                        { key: 'action', label: 'Aksiyon Başlığı', className: 'campaign-insight-title-cell campaign-insight-cell-title', render: (suggestion) => <strong title={normalizeCampaignInsightText(suggestion.title)}>{normalizeCampaignInsightText(suggestion.title)}</strong> },
                        { key: 'type', label: 'Öneri Türü', className: 'campaign-insight-cell-type', render: (suggestion) => <span className="campaign-signal-pill is-neutral">{formatCampaignRecommendationType(suggestion.recommendationType || 'near_expiry')}</span> },
                        { key: 'scope', label: 'Kapsam', className: 'campaign-insight-cell-scope', render: (suggestion) => formatCampaignScopeLabel(suggestion.scopeLabel || 'SKT / fire riski') },
                        { key: 'product', label: 'Etkilenen Ürün', className: 'campaign-insight-cell-count', render: (suggestion) => `${formatNumber(suggestion.affectedProductCount)} Ürün` },
                        { key: 'discount', label: 'Önerilen İndirim', className: 'campaign-insight-metric-cell', render: (suggestion) => `%${formatNumber(suggestion.recommendedDiscount)}` },
                        { key: 'risk', label: 'Risk / Öncelik', className: 'campaign-insight-cell-risk', render: (suggestion) => <span className={`campaign-signal-pill ${getCampaignToneClass(suggestion.priority)}`}>{getCampaignPriorityDisplayLabel(suggestion.priority)}</span> },
                        { key: 'status', label: 'Durum', className: 'campaign-insight-cell-status', render: (suggestion) => <span className={`campaign-signal-pill ${getCampaignSuggestionStatusToneClass(suggestion)}`}>{getCampaignSuggestionStatusDisplayLabel(suggestion)}</span> },
                        {
                          key: 'actions',
                          label: 'İşlemler',
                          className: 'table-cell-actions campaign-insight-cell-actions',
                          render: (suggestion) => (
                            renderCampaignSuggestionActions(suggestion, 'Oluştur')
                          ),
                        },
                      ],
                    })}

                    {renderCampaignProductCandidatesTable({
                      title: 'Ürün Listesi',
                      description: 'SKT’si yaklaşan Ürünleri takip edin.',
                      icon: CalendarDays,
                      total: expiryInsightCards.length,
                      rows: pagedExpirySignals.pageRows,
                      mode: 'expiry',
                      paginationKey: 'expiry-signals',
                      emptyTitle: 'Kayıt bulunamadı',
                      emptyDescription: 'Aksiyon adayı yok.',
                    })}
                  </div>

                  {renderSingleCampaignModuleTable({
                    title: 'SKT Bazlı Kampanya Listesi',
                    description: 'Aktif, planlanan ve arşiv SKT kampanyaları ayrı alanlarda izlenir.',
                    rows: moduleCampaignRows,
                    tableKeyPrefix: 'expiry',
                    sectionClassName: 'campaign-section campaign-module-single-table--insight',
                    emptyTitle: 'Kayıt bulunamadı',
                    emptyDescription: 'Henüz SKT bazlı kampanya oluşturulmadı.',
                    splitLifecycle: true,
                  })}
                </section>
                ) : null}
                {campaignTypeView === 'sales' ? (
                <section className="sales-campaign-page campaign-dashboard-shell campaign-dashboard-shell--sales campaign-module-insight-card campaign-module-insight-card--sales campaign-section">
                  <section className="sales-campaign-control campaign-sales-control-section campaign-creation-card campaign-section">
                    {renderCampaignAnalysisHeader({
                      icon: TrendingUp,
                      iconClassName: 'mod-icon-indigo',
                      title: 'Satış Bazlı Kampanya Merkezi',
                      description: 'Satış, marj ve stok baskısıni aynı akışta okuyun; kampanya aksiyonunu hızlıca seçin.',
                      className: 'sales-campaign-header',
                    })}

                    {renderCampaignKpiCards([
                      {
                        icon: TrendingDown,
                        iconClassName: 'mod-icon-rose',
                        label: 'Yavaş Satan Ürün',
                        value: formatNumber(filteredSalesRows.filter((row) => Number(row?.salesVelocity || 0) <= 1.2).length),
                        description: 'Günlük satış ortalaması düşük Ürünler',
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
                        description: 'Satış hızına göre fazla stok taşıyan Ürünler',
                      },
                      {
                        icon: Percent,
                        iconClassName: 'mod-icon-green',
                        label: 'Ortalama Marj',
                        value: `%${formatNumber(filteredSalesRows.length ? filteredSalesRows.reduce((sum, row) => sum + Number(row?.currentMarginPercent || 0), 0) / filteredSalesRows.length : 0)}`,
                        description: 'Listedeki ortalama brüt marj',
                      },
                      {
                        icon: Megaphone,
                        iconClassName: 'mod-icon-indigo',
                        label: 'Kampanya Adayi',
                        value: formatNumber(salesInsightCards.length),
                        description: 'Sistem tarafindan aksiyon Önerilen Ürünler',
                      },
                    ], {
                      title: 'Kampanya Bilgileri',
                      description: '',
                      className: 'sales-campaign-metrics',
                      gridClassName: 'sales-campaign-metrics-grid',
                      itemClassName: 'sales-campaign-metric-card',
                    })}

                  </section>

                  <div className="sales-campaign-tables campaign-content-sections campaign-insight-layout campaign-insight-layout--insight">
                    {renderCampaignActionCandidatesTable({
                      title: 'Satış Odaklı Kampanya Listesi',
                      description: 'Satış hızı ve stok baskısına göre Önerilen kampanya aksiyonlarını takip edin.',
                      icon: Megaphone,
                      total: filteredSalesSuggestions.length,
                      rows: pagedSalesSuggestions.pageRows,
                      paginationKey: 'sales-suggestions',
                      tableClassName: 'campaign-insight-table--compact campaign-insight-table--sales-actions',
                      rowClassName: (suggestion) => Number(suggestion?.affectedProductCount || 0) <= 0 ? 'campaign-insight-row--muted' : '',
                      emptyTitle: 'Kampanya adayı bulunamadı.',
                      emptyDescription: 'Yeni Öneriler veri geldikçe burada görünür.',
                      columns: [
                        { key: 'campaign', label: 'Kampanya', className: 'campaign-insight-title-cell campaign-insight-cell-title', render: (suggestion) => <strong title={formatCampaignTableValue(suggestion.title)}>{formatCampaignTableValue(suggestion.title)}</strong> },
                        { key: 'recommendationType', label: 'Öneri Türü', className: 'campaign-insight-cell-type', render: (suggestion) => <span className="campaign-signal-pill is-neutral">{formatCampaignRecommendationType(suggestion.recommendationType || 'sales_opportunity')}</span> },
                        { key: 'scope', label: 'Kapsam', className: 'campaign-insight-cell-scope', render: (suggestion) => formatCampaignTableValue(formatCampaignScopeLabel(suggestion.scopeLabel || 'Satış performansı')) },
                        { key: 'product', label: 'Etkilenen Ürün', className: 'campaign-insight-cell-count', render: (suggestion) => Number(suggestion.affectedProductCount || 0) > 0 ? `${formatNumber(suggestion.affectedProductCount)} Ürün` : '—' },
                        { key: 'margin', label: 'Ortalama Marj', className: 'campaign-insight-metric-cell', render: (suggestion) => {
                          const margin = averageCampaignMetric(getCampaignSuggestionRows(suggestion), (row) => Number(row?.currentMarginPercent || 0));
                          return Number.isFinite(Number(margin)) && Number(margin) > 0 ? `%${formatNumber(margin)}` : '—';
                        } },
                        { key: 'type', label: 'Tür', className: 'campaign-insight-cell-kind', render: (suggestion) => <span className="campaign-signal-pill is-neutral">{formatCampaignScopeLabel(CAMPAIGN_TYPE_LABELS[suggestion.type] || 'Çapraz')} kampanya</span> },
                        { key: 'status', label: 'Durum', className: 'campaign-insight-cell-status', render: (suggestion) => <span className={`campaign-signal-pill ${getCampaignSuggestionStatusToneClass(suggestion)}`}>{getCampaignSuggestionStatusDisplayLabel(suggestion)}</span> },
                        {
                          key: 'actions',
                          label: 'İşlemler',
                          className: 'table-cell-actions campaign-insight-cell-actions',
                          render: (suggestion) => (
                            renderCampaignSuggestionActions(suggestion, 'Oluştur')
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
                      emptyDescription: 'Aksiyon adayı yok.',
                    })}
                  </div>

                  {renderSingleCampaignModuleTable({
                    title: 'Satış Bazlı Kampanya Listesi',
                    description: 'Aktif, planlanan ve arşiv satış kampanyaları ayrı alanlarda izlenir.',
                    rows: moduleCampaignRows,
                    tableKeyPrefix: 'sales',
                    sectionClassName: 'campaign-section campaign-module-single-table--insight',
                    emptyTitle: 'Kayıt bulunamadı',
                    emptyDescription: 'Satış bazlı kampanya kaydı henüz bulunmuyor.',
                    splitLifecycle: true,
                  })}
                </section>
                ) : null}
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
                  <div className="campaign-home-table-tabs" role="tablist" aria-label="Kampanya liste görünümü">
                    {[
                      { key: 'active', label: 'Aktif', count: campaignSummary.active },
                      { key: 'planned', label: 'Planlanan', count: campaignSummary.planned },
                      { key: 'archive', label: 'Arşiv', count: campaignSummary.archive },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        className={homeCampaignTableView === tab.key ? 'is-active' : ''}
                        aria-selected={homeCampaignTableView === tab.key}
                        onClick={() => setHomeCampaignTableView(tab.key)}
                      >
                        <span>{tab.label}</span>
                        <strong>{formatNumber(tab.count)}</strong>
                      </button>
                    ))}
                  </div>
                  {homeCampaignTableView === 'active' ? renderCampaignTable({
                    title: 'Aktif Kampanyalar',
                    description: 'Şu an yayında olan gerçek kampanya kayıtları burada izlenir.',
                    rows: homeCampaignTableView === 'active' ? homeCampaignTableConfig.rows : [],
                    tableKey: 'home-active',
                    mode: 'active',
                    sectionMeta: CAMPAIGN_TABLE_SECTION_META.all.active,
                    emptyTitle: 'Aktif kampanya bulunmuyor',
                    emptyDescription: 'Şu an yayında olan kampanya kaydı yok.',
                  }) : null}
                  {homeCampaignTableView === 'planned' ? renderCampaignTable({
                    title: 'Planlanan Kampanyalar',
                    description: 'Henüz başlamamış, başlangıç tarihini bekleyen kampanyalar burada izlenir.',
                    rows: homeCampaignTableConfig.rows,
                    tableKey: 'home-planned',
                    mode: 'planned',
                    sectionMeta: CAMPAIGN_TABLE_SECTION_META.all.active,
                    emptyTitle: 'Planlanan kampanya bulunmuyor',
                    emptyDescription: 'Başlangıç tarihini bekleyen kampanya kaydı yok.',
                  }) : null}
                  {homeCampaignTableView === 'archive' ? renderCampaignTable({
                    title: CAMPAIGN_TABLE_SECTION_META.all.archive.title,
                    description: 'Geçmiş, pasif veya arşivlenmiş kampanyaların tek ana kayıt alanıdır.',
                    rows: homeCampaignTableConfig.rows,
                    tableKey: 'home-archive',
                    mode: 'archive',
                    sectionMeta: CAMPAIGN_TABLE_SECTION_META.all.archive,
                    emptyTitle: 'Arşiv kaydı bulunmuyor',
                    emptyDescription: 'Geçmiş kampanya kaydı oluştuğunda burada listelenir.',
                  }) : null}
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
                  <p className="s-card-desc">Mağaza kimliği, iletişim bilgileri ve Çalisma düzeni</p>
                </div>
              </div>

              <h4 className="s-category-subtitle">Temel Bilgiler</h4>
              <div className="s-field-grid s-store-basic-grid">
                <label className="s-field">
                  <span className="s-field-label"><Building size={14} /> Mağaza Adı</span>
                   <input type="text" value={form.storeName} placeholder="Shelfio Market" onChange={(event) => setForm((current) => ({ ...current, storeName: event.target.value }))} disabled={!isAdmin || isLoading} />
                </label>
                <label className="s-field">
                  <span className="s-field-label"><Hash size={14} /> Sube Kodu</span>
                   <input type="text" value={form.branchCode} placeholder="SHF-001" onChange={(event) => setForm((current) => ({ ...current, branchCode: event.target.value }))} disabled={!isAdmin || isLoading} />
                </label>
                <label className="s-field">
                  <span className="s-field-label"><Phone size={14} /> Telefon</span>
                   <input type="tel" value={form.storePhone} placeholder="+90 555 000 00 00" onChange={(event) => setForm((current) => ({ ...current, storePhone: event.target.value }))} disabled={!isAdmin || isLoading} />
                </label>
                <label className="s-field">
                  <span className="s-field-label"><Mail size={14} /> E-posta</span>
                   <input type="email" value={form.storeEmail} placeholder={SUPPORT_CONTACT.email} onChange={(event) => setForm((current) => ({ ...current, storeEmail: event.target.value }))} disabled={!isAdmin || isLoading} />
                </label>
                <label className="s-field s-store-tax-field">
                  <span className="s-field-label"><Hash size={14} /> Vergi No</span>
                   <input type="text" value={form.taxNumber} placeholder="1234567890" onChange={(event) => setForm((current) => ({ ...current, taxNumber: event.target.value }))} disabled={!isAdmin || isLoading} />
                </label>
                <label className="s-field s-store-address-field">
                  <span className="s-field-label"><MapPin size={14} /> Adres</span>
                   <input type="text" value={form.storeAddress} placeholder="Istanbul / Türkiye" onChange={(event) => setForm((current) => ({ ...current, storeAddress: event.target.value }))} disabled={!isAdmin || isLoading} />
                </label>
              </div>

              <section className="s-license-card" aria-label="Lisans bilgileri">
                <div className="s-license-card-head">
                  <div className="s-license-title-wrap">
                    <span className="s-license-icon"><KeyRound size={17} /></span>
                    <div>
                      <h4>Lisansım</h4>
                      <p>Shelfio erişiminiz için kullanılan lisans bilgilerini görüntüleyin.</p>
                    </div>
                  </div>
                  <span className={`s-license-status s-license-status--${licenseOverview.status.tone}`}>
                    {licenseOverview.status.label}
                  </span>
                </div>

                <div className="s-license-info-grid">
                  {[
                    ['Lisans anahtarı', licenseOverview.maskedKey],
                    ['Paket / Plan', licenseOverview.plan],
                    ['Lisans Sahibi Kurum', licenseOverview.tenantName || 'Tanımlı değil'],
                    ['Mağaza', licenseOverview.storeName || 'Tanımlı değil'],
                    ['Başlangıç tarihi', licenseOverview.startsAt],
                    ['Bitiş / yenileme tarihi', licenseOverview.expiresAt],
                  ].map(([label, value]) => (
                    <div className="s-license-info-row" key={label}>
                      <span>{label}</span>
                      <strong>{value || '-'}</strong>
                    </div>
                  ))}
                </div>

                <div className="s-license-subsection">
                  <span className="s-license-subtitle">Aktif modüller</span>
                  <div className="s-license-chip-list">
                    {licenseOverview.enabledModules.length ? licenseOverview.enabledModules.map((moduleLabel) => (
                      <span className="s-license-module-chip" key={moduleLabel}>{moduleLabel}</span>
                    )) : (
                      <span className="s-license-muted">Modül bilgisi bulunmuyor.</span>
                    )}
                  </div>
                </div>

                <div className="s-license-limit-grid">
                  {licenseOverview.limits.length ? licenseOverview.limits.map((item) => (
                    <div className="s-license-limit-box" key={item.key}>
                      <span>{item.label}</span>
                      <strong>{formatNumber(item.value)}</strong>
                    </div>
                  )) : (
                    <div className="s-license-limit-box s-license-limit-box--empty">
                      <span>Limit bilgisi</span>
                      <strong>-</strong>
                    </div>
                  )}
                </div>
              </section>

              <h4 className="s-category-subtitle s-hours-subtitle">Çalisma Saatleri</h4>
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
                          <span className="s-field-label">Açilis</span>
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
                          <span className="s-field-label">Kapanis</span>
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
                      <div className="s-hours-ops-empty" style={{ padding: '8px 0', fontSize: '0.82rem', color: '#64748b' }}>Saat ayari için bir gün seçin.</div>
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
                    <option value="TRY">TRY</option>
                  </select>
                </div>

                <div className="s-config-item s-config-item-updated">
                  <span className="s-config-label">Son Güncelleme</span>
                  <span className="s-config-value">{updatedAt ? formatDate(updatedAt) : '-'}</span>
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
                    <span className="s-automation-desc">Sistem bildirimlerinin size gösterilmesini açip kapatin</span>
                  </div>
                  <div className="s-sound-toggle-actions">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notificationSoundEnabled}
                      className={`s-automation-toggle ${notificationSoundEnabled ? 'is-active' : 'is-passive'}`}
                      onClick={() => updateNotificationSoundSettings((current) => ({
                        notificationSoundEnabled: current.notificationSoundEnabled === false,
                      }))}
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
                      onChange={(event) => updateNotificationSoundSettings({
                        notificationSoundVolume: clampSoundVolume(event.target.value),
                      })}
                      disabled={!notificationSoundEnabled}
                    />
                    <strong className="s-sound-volume-value">%{clampSoundVolume(notificationSoundVolume)}</strong>
                    <button type="button" className="s-audit-btn s-sound-test-btn" onClick={handlePreviewNotificationSound}>
                      <Settings2 size={14} /> Bildirimi Test Et
                    </button>
                  </div>
                  <div className="s-sound-file-control" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', paddingTop: '10px', borderTop: '1px solid rgba(139, 92, 246, 0.1)', width: '100%', gap: '10px' }}>
                    <span className="s-config-label" style={{ fontSize: '0.8rem' }}>Bildirim Sesi</span>
                    <select
                      value={notificationSound}
                      onChange={(event) => updateNotificationSoundSettings({
                        notificationSound: normalizeNotificationSound(event.target.value),
                      })}
                      disabled={!notificationSoundEnabled}
                      className="s-config-select"
                      style={{ padding: '6px 10px', fontSize: '0.82rem', height: '34px', minWidth: '150px' }}
                    >
                      {NOTIFICATION_SOUNDS.map((sound) => (
                        <option key={sound.value} value={sound.value}>{sound.label}</option>
                      ))}
                    </select>
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
                    <h3 className="s-card-title">Izleme ve Log Kayıtlari</h3>
                    <p className="s-card-desc">Giriş aktiviteleri, audit kayıtları ve teknik log detaylari</p>
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
                      {formatTabCount('Giriş Aktiviteleri', loginActivitiesTotal)}
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
                    {isPlatformAdmin ? <button
                      type="button"
                      role="tab"
                      aria-selected={activityLogTab === 'developer'}
                      className={`s-activity-log-tab ${activityLogTab === 'developer' ? 'is-active' : ''}`}
                      onClick={() => setActivityLogTab('developer')}
                    >
                      {formatTabCount('Geliştirici', developerLogsTotal)}
                    </button> : null}
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
                            <h3 className="s-card-title">Giriş Aktiviteleri</h3>
                            <p className="s-card-desc">Oturum, giriş güvenliği ve cihaz bilgileri</p>
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

                        {loginActivitiesLoading ? (
                          <div className="s-empty-state">Giriş aktiviteleri yükleniyor...</div>
                        ) : loginActivities.length ? (
                          <div className="s-login-activity-list">
                            {loginActivities.map((activity) => {
                              const { browser } = parseUserAgentInfo(activity);
                              const loginDate = resolveLoginActivityDate(activity);
                              return (
                                <article className="s-login-activity-item" key={activity.id}>
                                  <div className="s-login-activity-main">
                                    <strong>{getLoginActorName(activity)}</strong>
                                    <span>Rol: {activity.role || '-'}</span>
                                    <span>Kaynak: {getLoginSourceLabel(activity.source)}</span>
                                    <span>Olay: {getLoginEventLabel(activity.eventType)}</span>
                                    <span>Zaman: {formatDateTime(loginDate)}</span>
                                  </div>
                                  <div className="s-login-activity-meta">
                                    <span>IP: {activity.ipAddress || activity.ip || 'IP yok'}</span>
                                    <span>Tarayıcı: {browser}</span>
                                    <span>Durum: {getLoginStatusLabel(activity.status)}</span>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="s-empty-state">Henüz kayıtli giriş aktivitesi bulunmuyor.</div>
                        )}
                      </section>
                    )}

                    {activityLogTab === 'audit' && (
                      <section className="s-activity-log-block s-audit-log-card">
                        <div className="s-card-header s-card-header-tight">
                          <div className="s-card-icon s-icon-slate"><Shield size={18} /></div>
                          <div className="s-card-header-copy">
                            <h3 className="s-card-title">Audit Log</h3>
                            <p className="s-card-desc">Kullanıcı işlem geçmişini izleyin</p>
                          </div>
                          <div className="s-login-activity-actions">
                            <button type="button" className="s-audit-btn" onClick={openAuditLogManagerModal}>
                              Detay
                            </button>
                          </div>
                        </div>

                        {auditLogsLoading ? (
                          <div className="s-empty-state">Audit log kayıtları yükleniyor...</div>
                        ) : auditLogs.length ? (
                          <div className="s-audit-log-list">
                            {auditLogs.slice(0, 16).map((log) => (
                              <article className="s-audit-log-item" key={log.id}>
                                <div className="s-audit-log-main">
                                  <strong>{getAuditActionLabel(log)}</strong>
                                  <span>{log.actorName || 'Sistem'} - {log.module || 'modul yok'}</span>
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

                    {isPlatformAdmin && activityLogTab === 'developer' && (
                      <section className="s-activity-log-block s-developer-log-card">
                        <div className="s-card-header s-card-header-tight">
                          <div className="s-card-icon s-icon-slate"><FileText size={18} /></div>
                          <div className="s-card-header-copy">
                            <h3 className="s-card-title">Geliştirici Logları</h3>
                            <p className="s-card-desc">Sistem hatalarini ve teknik loglari buradan izleyin.</p>
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

                        {developerLogsLoading ? (
                          <div className="s-empty-state">Loglar yükleniyor...</div>
                        ) : (
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
                        )}

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
        description="Önerinin veri sinyallerini, beklenen etkiyi ve karar senaryolarini inceleyin."
        headerIcon={<Megaphone size={16} />}
        onClose={() => setSelectedCampaignSuggestion(null)}
        modalClassName="product-form-fit-modal campaign-suggestion-detail-modal"
        confirmOnDirtyClose={false}
      >
        {selectedCampaignSuggestion ? (
          <>
          <div className="campaign-detail-modal-body">
            <section className="campaign-detail-section">
              <h4>Neden bu Öneri çıktı?</h4>
              <p>{normalizeCampaignInsightText(selectedCampaignSuggestion.reason)}</p>
            </section>
            <section className="campaign-detail-section campaign-detail-section--metric-cards" aria-label="Kampanya Önerisi metrikleri">
              <div className="campaign-suggestion-metric-grid">
                <div className="campaign-suggestion-metric-card is-products">
                  <span className="campaign-suggestion-metric-icon" aria-hidden="true"><PackageSearch size={16} /></span>
                  <span>Etkilenen Ürün</span>
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
                  'Satış hızı düşük ve stok bekleme riski yüksek Ürünler seçildi.',
                  'Mevcut aktif kampanyalarla isim Çakışmasi kontrol edildi.',
                  'Önerilen indirim oranı kampanya simülasyonuna başlangıç değeri olarak aktarilir.',
                ]).map((item) => <li key={item}>{normalizeCampaignInsightText(item)}</li>)}
              </ul>
            </section>
            <section className="campaign-detail-section campaign-detail-section--signals">
              <h4>Operasyonel sinyaller</h4>
              <div className="campaign-detail-grid">
                <div><span>Ortalama günlük satış</span><strong>{formatNumber(averageCampaignMetric(selectedSuggestionRows, (row) => Number(row?.salesVelocity || 0)))} adet</strong></div>
                <div><span>Ortalama stok</span><strong>{formatNumber(averageCampaignMetric(selectedSuggestionRows, (row) => Number(row?.stockLevel || 0)))} adet</strong></div>
                <div><span>Stok baskısı</span><strong>{formatNumber(selectedSuggestionRows.filter((row) => Number(row?.stockLevel || 0) > Math.max(20, Number(row?.salesVelocity || 0) * 21)).length)} Ürün</strong></div>
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
            <button type="button" className="primary-button" onClick={() => createCampaignFromSuggestion(selectedCampaignSuggestion)} disabled={!isCampaignSuggestionDiscountActionable(selectedCampaignSuggestion)}>
              {isCampaignSuggestionDiscountActionable(selectedCampaignSuggestion) ? 'Kampanya Oluştur' : 'Indirim Onerisi Degil'}
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
                        <input
                          type="search"
                          value={productCampaignSearch}
                          onFocus={() => { void loadCampaignProducts(); }}
                          onChange={(event) => {
                            setProductCampaignSearch(event.target.value);
                            if (!availableProductsLoaded) void loadCampaignProducts();
                          }}
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
                        productCampaignSearch && availableProductsLoading ? (
                          <div className="campaign-product-search-empty">Ürünler yükleniyor...</div>
                        ) : productCampaignSearch ? (
                          <div className="campaign-product-search-empty">Eşleşen Ürün bulunamadı.</div>
                        ) : null
                      )}
                    </div>
                    <div className="campaign-selected-products" aria-label="Seçilen Ürünler">
                      <div className="campaign-selected-products-head">
                        <strong>Seçilen Ürünler</strong>
                        <span>{formatNumber(selectedCampaignProducts.length)} Ürün</span>
                      </div>
                      {selectedCampaignProducts.length ? (
                        <div className="campaign-selected-product-list">
                          {selectedCampaignProducts.map((product) => (
                            <span key={product.id} className="campaign-selected-product-chip">
                              {product.label}
                              <button type="button" onClick={() => toggleCampaignProduct(product.id)} aria-label={`${product.label} Ürünönü kaldır`}>
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
                <section className="campaign-edit-grid campaign-category-scope-layout">
                  <section className="campaign-category-scope-pane">
                    <div className="campaign-category-scope-pane-head">
                      <h5>Kategori Seçimi</h5>
                      <span>{formatNumber(campaignDraft.targetCategoryIds.length)} seçili</span>
                    </div>
                    <div className="s-giftcard-category-grid campaign-category-grid-list">
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
                  <section className="campaign-category-scope-pane">
                    <div className="campaign-category-label-scope">
                      <div className="campaign-category-label-toolbar">
                        <label className="field-group">
                          <span>Etiket Ara <small>(Opsiyonel)</small></span>
                          <input type="search" value={categoryLabelSearch} onChange={(event) => setCategoryLabelSearch(event.target.value)} placeholder="Etiket adı veya kategori" />
                        </label>
                        {selectedCategoryLabelOptions.length ? <span className="campaign-category-label-count">{formatNumber(selectedCategoryLabelOptions.length)} etiket seçildi</span> : null}
                      </div>
                      {selectedCategoryLabelOptions.length ? (
                        <div className="campaign-category-label-selected" aria-label="Seçilen etiketler">
                          {selectedCategoryLabelOptions.map((option) => (
                            <span key={option.id} className="campaign-selected-product-chip">
                              {option.label}
                              <button type="button" onClick={() => toggleCampaignCategoryLabel(option.id)} aria-label={`${option.label} etiketini kaldır`}>
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="campaign-category-label-grid">
                        {selectedCategoryIdSet.size && visibleCategoryLabelOptions.length ? visibleCategoryLabelOptions.map((option) => (
                          <button key={option.id} type="button" className={`campaign-category-label-chip ${selectedCategoryLabelIdSet.has(option.id) ? 'is-selected' : ''}`} onClick={() => toggleCampaignCategoryLabel(option.id)}>
                            <span>{option.label}</span>
                            {option.categoryName ? <small>{option.categoryName}</small> : null}
                          </button>
                        )) : null}
                      </div>
                    </div>
                  </section>
                </section>
              ) : null}

              {campaignEditScope === 'brand' ? (
                <section className="campaign-edit-grid">
                  <div className="campaign-product-picker campaign-brand-picker">
                    <div className="campaign-brand-toolbar">
                      <label className="field-group campaign-brand-search-field">
                        <span>Marka ara</span>
                        <input
                          type="search"
                          value={brandCampaignSearch}
                          onFocus={() => { void loadCampaignProducts(); }}
                          onChange={(event) => {
                            setBrandCampaignSearch(event.target.value);
                            if (!availableProductsLoaded) void loadCampaignProducts();
                          }}
                          placeholder="En az 2 karakter ile arayin"
                        />
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
                  <span>Uygulama Önceliği</span>
                  <strong>{getCampaignPriorityDisplayLabel(selectedCampaignDetail.priority)}</strong>
                  <small className="muted-text">{getCampaignPriorityValueLabel(selectedCampaignDetail.priority)}</small>
                </div>
              </section>
              <section className="campaign-detail-section campaign-detail-section--products">
                <div className="campaign-detail-products-head">
                  <div>
                    <h4>Kampanyaya dahil Ürünler</h4>
                    <p>Eski fiyat ve kampanya sonrasi yeni fiyat Ürün bazinda gösterilir.</p>
                    {selectedCampaignDetailScopeCount > selectedCampaignDetailPreviewCount ? (
                      <small className="muted-text">Tablo, analiz Önizlemesindeki {formatNumber(selectedCampaignDetailPreviewCount)} aday ürünü gösterir.</small>
                    ) : null}
                  </div>
                  <span>{formatNumber(selectedCampaignDetailScopeCount || selectedCampaignDetailPreviewCount)} Ürün</span>
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
                    <strong>Bu kampanyaya bagli Ürün bulunamadı.</strong>
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
                    <span>Deger</span>
                    <input type="number" min="0" step="0.01" value={giftCardDraft.value} onChange={(event) => setGiftCardDraft((current) => ({ ...current, value: event.target.value }))} placeholder={giftCardDraft.valueType === 'percentage' ? '10' : '150'} />
                  </label>
                  <label>
                    <span>Kullanim Hakki</span>
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
                    <span>Kategori Geçerliligi</span>
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
                <h4>Mevcut Hediye Kartlari</h4>
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
        description="Mağaza için Özel Çalisma saati tanımlayın. Tek gün veya tarih araligi seçebilirsiniz."
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

            {/* Tarih alanlari */}
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

            {/* Saat alanlari */}
            <section className="modal-form-section special-day-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">Çalisma Saatleri</h4>
              </div>
              <div className="special-day-time-grid">
                <label className="field-group">
                  <span>Açilis Saati</span>
                  <input
                    type="time"
                    value={specialDayDraft.startTime}
                    onChange={(event) => setSpecialDayDraft((current) => ({ ...current, startTime: event.target.value }))}
                  />
                </label>
                <label className="field-group">
                  <span>Kapanis Saati</span>
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
                  placeholder="Örn: Yılbaşı Özel Çalisma saati, bayram tatili vb."
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
        description="Seçilen kullanıcı işlem kaydını read-only olarak inceleyin."
        headerIcon={<FileText size={16} />}
        modalClassName="product-form-fit-modal s-audit-detail-modal"
        onClose={() => {
          setAuditModalOpen(false);
          setSelectedAuditLog(null);
        }}
      >
        <div className="modal-form modal-structured-form s-audit-detail-form">
          <div className="modal-form-body-scroll s-audit-detail-scroll s-log-detail-body">
            <FormSection title="Kayıt Özeti" description="İşlem, kullanıcı, kaynak ve durum bilgileri.">
              <FormGrid className="s-log-detail-grid">
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>İşlem</span>
                  <input type="text" value={getAuditActionLabel(selectedAuditLog || {})} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Kullanıcı</span>
                  <input type="text" value={getAuditActorName(selectedAuditLog || {})} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Zaman</span>
                  <input type="text" value={formatDateTime(selectedAuditLog?.createdAt || selectedAuditLog?.at)} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Durum</span>
                  <input type="text" value={getAuditStatusLabel(selectedAuditLog || {})} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Kayıt ID</span>
                  <input type="text" value={selectedAuditLog?.id || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Modül</span>
                  <input type="text" value={selectedAuditLog?.module || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Kaynak</span>
                  <input type="text" value={selectedAuditLog?.source || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Rol</span>
                  <input type="text" value={selectedAuditLog?.actorRole || '-'} readOnly />
                </label>
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>E-posta</span>
                  <input type="text" value={selectedAuditLog?.actorEmail || '-'} readOnly />
                </label>
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>Kayıt / Nesne</span>
                  <input type="text" value={getAuditObjectLabel(selectedAuditLog || {})} readOnly />
                </label>
              </FormGrid>
            </FormSection>

            <FormSection title="İstek Bilgisi" description="Endpoint, method, IP ve istek izleme bilgileri.">
              <FormGrid className="s-log-detail-grid">
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Method</span>
                  <input type="text" value={selectedAuditLog?.method || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Durum Kodu</span>
                  <input type="text" value={selectedAuditLog?.statusCode || '-'} readOnly />
                </label>
                <label className="field-group col-6 s-log-detail-readonly-field">
                  <span>Endpoint</span>
                  <input type="text" value={selectedAuditLog?.endpoint || '-'} readOnly />
                </label>
                <label className="field-group col-4 s-log-detail-readonly-field">
                  <span>Request ID</span>
                  <input type="text" value={selectedAuditLog?.requestId || selectedAuditLog?.correlationId || '-'} readOnly />
                </label>
                <label className="field-group col-4 s-log-detail-readonly-field">
                  <span>IP</span>
                  <input type="text" value={selectedAuditLog?.ip || '-'} readOnly />
                </label>
                <label className="field-group col-4 s-log-detail-readonly-field">
                  <span>User Agent</span>
                  <input type="text" value={selectedAuditLog?.userAgent || '-'} readOnly />
                </label>
              </FormGrid>
            </FormSection>

            <FormSection title="Aksiyon Detayı" description="İşlem özeti ve sanitize edilmiş metadata.">
              <FormGrid className="s-log-detail-grid">
                <label className="field-group col-12 s-log-detail-readonly-field">
                  <span>Özet</span>
                  <textarea
                    value={formatLogDetailsForDisplay(getAuditSummary(selectedAuditLog || {}), 'Özet içeriği bulunmuyor.')}
                    readOnly
                    rows={4}
                    className="s-log-detail-textarea"
                  />
                </label>
                <label className="field-group col-12 s-log-detail-readonly-field">
                  <span>Metadata JSON</span>
                  <textarea
                    value={getAuditMetadataJson(selectedAuditLog || {})}
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
        description="Teknik hata kaydıni read-only olarak inceleyin."
        headerIcon={<FileText size={16} />}
        modalClassName="product-form-fit-modal s-devlog-detail-modal"
        onClose={() => {
          setDeveloperLogModalOpen(false);
          setSelectedDeveloperLog(null);
        }}
      >
        <div className="modal-form modal-structured-form s-devlog-detail-form">
          <div className="modal-form-body-scroll s-devlog-detail-scroll s-log-detail-body">
            {developerLogDetailLoading ? (
              <div className="s-empty-state">Detaylar yükleniyor...</div>
            ) : (
              <>
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
                  <span>Hata Sinifi</span>
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
              </>
            )}
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
        description="Seçilen oturum güvenliği kaydını read-only olarak inceleyin."
        headerIcon={<ShieldCheck size={16} />}
        modalClassName="product-form-fit-modal s-audit-detail-modal"
        onClose={() => {
          setLoginActivityDetailModalOpen(false);
          setSelectedLoginActivity(null);
        }}
      >
        <div className="modal-form modal-structured-form s-audit-detail-form">
          <div className="modal-form-body-scroll s-audit-detail-scroll s-log-detail-body">
            <FormSection title="Kayıt Özeti" description="Kullanıcı, kaynak, olay ve zaman bilgileri.">
              <FormGrid className="s-log-detail-grid">
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Kullanıcı</span>
                  <input type="text" value={getLoginActorName(selectedLoginActivity || {})} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>E-posta / Kullanıcı Adı</span>
                  <input type="text" value={selectedLoginActivity?.email || selectedLoginActivity?.username || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Rol</span>
                  <input type="text" value={selectedLoginActivity?.role || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Departman</span>
                  <input type="text" value={selectedLoginActivity?.department || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Kaynak</span>
                  <input type="text" value={getLoginSourceLabel(selectedLoginActivity?.source)} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Olay</span>
                  <input type="text" value={getLoginEventLabel(selectedLoginActivity?.eventType)} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Durum</span>
                  <input type="text" value={getLoginStatusLabel(selectedLoginActivity?.status)} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Zaman</span>
                  <input type="text" value={formatDateTime(resolveLoginActivityDate(selectedLoginActivity))} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>IP</span>
                  <input type="text" value={selectedLoginActivity?.ipAddress || selectedLoginActivity?.ip || '-'} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>İşletim Sistemi</span>
                  <input type="text" value={parseUserAgentInfo(selectedLoginActivity).os} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Tarayıcı</span>
                  <input type="text" value={parseUserAgentInfo(selectedLoginActivity).browser} readOnly />
                </label>
                <label className="field-group col-3 s-log-detail-readonly-field">
                  <span>Request ID</span>
                  <input type="text" value={selectedLoginActivity?.requestId || '-'} readOnly />
                </label>
                {selectedLoginActivity?.failureReason ? (
                  <label className="field-group col-12 s-log-detail-readonly-field">
                    <span>Başarısızlık Sebebi</span>
                    <input type="text" value={selectedLoginActivity.failureReason} readOnly />
                  </label>
                ) : null}
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
        description="Sistemdeki kullanıcı işlem geçmişini filtreleyin, dışa aktarın ve inceleyin"
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
                <label className="field-group s-devlog-field s-devlog-field-level">
                  <span>Modul</span>
                  <select name="module" value={auditLogFilters.module} onChange={handleAuditLogFilterChange}>
                    <option value="">Tumu</option>
                    {auditModules.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="field-group s-devlog-field s-devlog-field-level">
                  <span>Kaynak</span>
                  <select name="source" value={auditLogFilters.source} onChange={handleAuditLogFilterChange}>
                    <option value="">Tumu</option>
                    {auditSources.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="field-group s-devlog-field s-devlog-field-level">
                  <span>Durum</span>
                  <select name="status" value={auditLogFilters.status} onChange={handleAuditLogFilterChange}>
                    <option value="">Tumu</option>
                    {auditStatuses.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
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
                        <th>Kullanıcı</th>
                        <th>Modül</th>
                        <th>İşlem</th>
                        <th>Kayıt / Nesne</th>
                        <th>Özet</th>
                        <th>Kaynak</th>
                        <th>IP</th>
                        <th>Durum</th>
                        <th>Detay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAuditLogs.map((row) => (
                        <tr key={row.id}>
                          <td className="s-devlog-cell-time">{formatDateTime(row.createdAt || row.at)}</td>
                          <td className="s-devlog-cell-user">{getAuditActorName(row)}</td>
                          <td className="s-devlog-cell-source">{row.module || '-'}</td>
                          <td className="s-devlog-cell-action">{getAuditActionLabel(row)}</td>
                          <td className="s-devlog-cell-action">{getAuditObjectLabel(row)}</td>
                          <td className="s-devlog-cell-message">{getAuditSummary(row)}</td>
                          <td className="s-devlog-cell-source">{row.source || '-'}</td>
                          <td className="s-devlog-cell-action">{row.ip || '-'}</td>
                          <td className="s-devlog-cell-level">
                            <span className={`s-log-level-badge level-${String(row.severity || 'info').toLowerCase()}`}>
                              {getAuditStatusLabel(row)}
                            </span>
                          </td>
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
        title="Giriş Aktiviteleri Yönetimi"
        description="Oturum güvenliği kayıtlarını filtreleyin, dışa aktarın ve inceleyin"
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
                  <span>Olay Tipi</span>
                  <select name="eventType" value={loginActivityFilters.eventType} onChange={handleLoginActivityFilterChange}>
                    <option value="">Tümü</option>
                    {loginEventOptions.map((item) => <option key={item} value={item}>{getLoginEventLabel(item)}</option>)}
                  </select>
                </label>
                <label className="field-group s-devlog-field s-devlog-field-level">
                  <span>Kaynak</span>
                  <select name="source" value={loginActivityFilters.source} onChange={handleLoginActivityFilterChange}>
                    <option value="">Tümü</option>
                    {loginSourceOptions.map((item) => <option key={item} value={item}>{getLoginSourceLabel(item)}</option>)}
                  </select>
                </label>
                <label className="field-group s-devlog-field s-devlog-field-level">
                  <span>Durum</span>
                  <select name="status" value={loginActivityFilters.status} onChange={handleLoginActivityFilterChange}>
                    <option value="">Tümü</option>
                    {loginStatusOptions.map((item) => <option key={item} value={item}>{getLoginStatusLabel(item)}</option>)}
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
                <label className="field-group s-devlog-field s-devlog-field-level">
                  <span>IP</span>
                  <input type="text" name="ip" value={loginActivityFilters.ip} onChange={handleLoginActivityFilterChange} placeholder="IP adresi" />
                </label>
                <label className="field-group s-devlog-field s-devlog-field-search">
                  <span>Arama</span>
                  <input type="text" name="search" value={loginActivityFilters.search} onChange={handleLoginActivityFilterChange} placeholder="Kullanıcı, rol, cihaz, sebep" />
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
                        <th>Tarih</th>
                        <th>Kullanıcı</th>
                        <th>Rol</th>
                        <th>Kaynak</th>
                        <th>Olay</th>
                        <th>IP</th>
                        <th>Tarayıcı</th>
                        <th>Durum</th>
                        <th>Detay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLoginActivities.map((row) => {
                        const parsed = parseUserAgentInfo(row);
                        return (
                          <tr key={row.id}>
                            <td className="s-devlog-cell-time">{formatDateTime(resolveLoginActivityDate(row))}</td>
                            <td className="s-devlog-cell-user">{getLoginActorName(row)}</td>
                            <td className="s-devlog-cell-action">{row.role || '-'}</td>
                            <td className="s-devlog-cell-source">{getLoginSourceLabel(row.source)}</td>
                            <td className="s-devlog-cell-action">{getLoginEventLabel(row.eventType)}</td>
                            <td className="s-devlog-cell-action">{row.ipAddress || row.ip || '-'}</td>
                            <td className="s-devlog-cell-source">{parsed.browser}</td>
                            <td className="s-devlog-cell-level">
                              <span className={`s-log-level-badge level-${row.status === 'failed' ? 'error' : 'info'}`}>
                                {getLoginStatusLabel(row.status)}
                              </span>
                            </td>
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
                    placeholder="Örn. kullanıcı kaydı, siparis onayi"
                    disabled={creatingDeveloperLog}
                  />
                </label>

                <label className="field-group col-6">
                  <span>Ilgili sayfa / servis adresi</span>
                  <input
                    type="text"
                    name="endpoint"
                    value={developerLogDraft.endpoint}
                    onChange={handleDeveloperLogDraftChange}
                    placeholder="Örn. /api/orders veya Ürünler sayfası"
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
                  <span>Hata sinifi / tipi</span>
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
                                handleSelectDeveloperLog(row);
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
