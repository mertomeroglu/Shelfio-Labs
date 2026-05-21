import { settingsRepo } from '../repositories/settingsRepository.js';
import { validateCampaignLifecycleIntegrity } from './dataIntegrityService.js';

const ALLOWED_PRICE_CENTS = [0, 25, 50, 75, 90, 95, 99];
const INACTIVE_STATUSES = new Set(['paused', 'inactive', 'passive', 'archived', 'expired', 'cancelled', 'deleted', 'draft']);
const MIN_NON_ZERO_PRICE = 0.01;

const normalizeString = (value) => String(value || '').trim();

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    const numeric = value.toNumber();
    return Number.isFinite(numeric) ? numeric : null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizePriceToAllowedCents = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  const base = Math.floor(numeric);
  const cents = Math.round((numeric - base) * 100);
  if (ALLOWED_PRICE_CENTS.includes(cents)) {
    return Number(numeric.toFixed(2));
  }

  let best = ALLOWED_PRICE_CENTS[0];
  let bestDistance = Math.abs(cents - best);
  for (const candidate of ALLOWED_PRICE_CENTS) {
    const distance = Math.abs(cents - candidate);
    if (distance < bestDistance || (distance === bestDistance && candidate > best)) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return Number((base + (best / 100)).toFixed(2));
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseDate = (value) => {
  const text = normalizeString(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
};

const parseCampaignBoundaryDate = (value, boundary = 'start') => {
  const text = normalizeString(value);
  if (!text) return null;
  const dateOnly = text.match(DATE_ONLY_PATTERN);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return boundary === 'end'
      ? new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999)
      : new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
  }
  return parseDate(text);
};

const toIso = (value) => {
  const parsed = parseDate(value);
  return parsed ? parsed.toISOString() : null;
};

const normalizeBrandTokens = (campaign = {}) => {
  const list = Array.isArray(campaign.targetBrands)
    ? campaign.targetBrands
    : normalizeString(campaign.targetBrand)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  return Array.from(
    new Set(
      list
        .map((item) => normalizeString(item).toLocaleLowerCase('tr-TR'))
        .filter(Boolean)
    )
  );
};

const normalizeScopeTokens = (value) => {
  const list = Array.isArray(value)
    ? value
    : normalizeString(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  return Array.from(new Set(
    list.map((item) => normalizeString(item).toLocaleLowerCase('tr-TR')).filter(Boolean)
  ));
};

const normalizeConflictPolicy = (value) => {
  const raw = normalizeString(value || 'best_price')
    .toLocaleLowerCase('tr-TR')
    .replace(/[\s-]+/g, '_');

  if (['highest_priority', 'priority', 'priority_wins', 'priority_first'].includes(raw)) return 'highest_priority';
  if (['higher_discount_wins', 'highest_discount', 'highest_discount_wins', 'lowest_price', 'lowest_effective_price', 'customer_best_price', 'best', 'best_price'].includes(raw)) {
    return 'best_price';
  }
  return 'best_price';
};

export const normalizeCampaignConflictPolicy = normalizeConflictPolicy;

const normalizeCampaignType = (campaign = {}) => normalizeString(campaign.type || campaign.campaignType || 'general').toLocaleLowerCase('tr-TR') || 'general';

const normalizeCampaignTitleKey = (value) => normalizeString(value)
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ı/g, 'i')
  .replace(/[^a-z0-9\s,]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isInternalCampaignTitle = (value) => {
  const key = normalizeCampaignTitleKey(value);
  if (!key) return false;
  return /\b(dinamik talep|talep sinyali|sinyal|raf aksiyonu|aksiyon)\b/.test(key) || /\s\d{1,3}$/.test(key);
};

const CAMPAIGN_PUBLIC_TITLE_RULES = [
  { keys: ['atistirmalik', 'biskuvi', 'cikolata', 'cips'], title: 'Atıştırmalıklarda İndirim' },
  { keys: ['sut kahvaltilik', 'kahvaltilik', 'peynir', 'yogurt', 'yumurta'], title: 'Kahvaltılıklarda İndirim' },
  { keys: ['deterjan temizlik', 'temizlik'], title: 'Temizlik Ürünlerinde İndirim' },
  { keys: ['et tavuk balik', 'et', 'tavuk', 'balik'], title: 'Et, Tavuk ve Balıkta İndirim' },
  { keys: ['icecek', 'su', 'meyve suyu'], title: 'İçeceklerde İndirim' },
  { keys: ['meyve sebze', 'meyve', 'sebze'], title: 'Meyve Sebzede İndirim' },
  { keys: ['kisisel bakim kozmetik saglik', 'kisisel bakim', 'kozmetik', 'saglik'], title: 'Kişisel Bakımda İndirim' },
  { keys: ['temel gida', 'bakliyat', 'makarna', 'un seker yag'], title: 'Temel Gıdada İndirim' },
  { keys: ['bebek'], title: 'Bebek Ürünlerinde İndirim' },
  { keys: ['elektronik'], title: 'Elektronikte İndirim' },
  { keys: ['kagit islak mendil', 'kagit'], title: 'Kağıt Ürünlerinde İndirim' },
  { keys: ['firin pastane', 'firin', 'pastane'], title: 'Fırın ve Pastane Fırsatları' },
  { keys: ['hazir yemek donuk', 'donuk'], title: 'Hazır Yemek ve Donuk Ürünlerde İndirim' },
  { keys: ['ev yasam'], title: 'Ev ve Yaşam Ürünlerinde İndirim' },
  { keys: ['kitap kirtasiye oyuncak', 'kirtasiye', 'oyuncak'], title: 'Kırtasiye ve Oyuncakta İndirim' },
  { keys: ['evcil hayvan'], title: 'Evcil Hayvan Ürünlerinde İndirim' },
];

const campaignTitleMatchesRule = (titleKey, ruleKey) => {
  if (!titleKey || !ruleKey) return false;
  if (ruleKey.includes(' ')) return titleKey.includes(ruleKey);
  return new RegExp(`(^|[\\s,])${ruleKey}($|[\\s,])`, 'i').test(titleKey);
};

export const resolveCustomerCampaignTitle = (campaign = {}) => {
  const explicitTitle = [
    campaign.customerTitle,
    campaign.publicName,
    campaign.publicTitle,
    campaign.customerDisplayName,
    campaign.displayName,
  ].map(normalizeString).find((value) => value && !isInternalCampaignTitle(value));
  if (explicitTitle) return explicitTitle;

  const rawName = normalizeString(campaign.name || campaign.internalName || '');
  const titleKey = normalizeCampaignTitleKey(rawName);
  if (!titleKey) return 'Kampanya';
  if (/\b(dinamik talep|talep sinyali|sinyal)\b/.test(titleKey)) return 'Haftanın Fırsatları';

  for (const rule of CAMPAIGN_PUBLIC_TITLE_RULES) {
    if (rule.keys.some((key) => campaignTitleMatchesRule(titleKey, key))) return rule.title;
  }

  if (isInternalCampaignTitle(rawName)) return 'Seçili Ürünlerde İndirim';
  return rawName.replace(/\s+\d{1,3}$/, '').trim() || 'Kampanya';
};

const normalizeCampaign = (campaign = {}, now = new Date()) => {
  const startsAtDate = parseCampaignBoundaryDate(campaign.startsAt || campaign.startAt, 'start');
  const endsAtDate = parseCampaignBoundaryDate(campaign.endsAt || campaign.endAt, 'end');
  const isIndefinite = campaign.isIndefinite === true;
  const status = normalizeString(campaign.status || (campaign.isActive === false ? 'paused' : 'active')).toLocaleLowerCase('tr-TR') || 'active';
  const startsAt = startsAtDate ? startsAtDate.toISOString() : null;
  const endsAt = endsAtDate ? endsAtDate.toISOString() : null;
  const isDateActive = isIndefinite
    ? !startsAtDate || startsAtDate.getTime() <= now.getTime()
    : (!startsAtDate || startsAtDate.getTime() <= now.getTime()) && (!endsAtDate || endsAtDate.getTime() >= now.getTime());

  return {
    id: normalizeString(campaign.id),
    name: normalizeString(campaign.name),
    internalName: normalizeString(campaign.internalName || campaign.name),
    publicName: normalizeString(campaign.publicName || campaign.publicTitle),
    customerTitle: normalizeString(campaign.customerTitle || campaign.customerDisplayName),
    displayName: normalizeString(campaign.displayName),
    type: normalizeCampaignType(campaign),
    discountRate: Math.max(0, toNumber(campaign.discountRate) || 0),
    discountAmount: Math.max(0, toNumber(campaign.discountAmount ?? campaign.amountOff ?? campaign.fixedDiscountAmount) || 0),
    priority: Math.max(0, Math.floor(toNumber(campaign.priority) || 0)),
    conflictPolicy: normalizeConflictPolicy(campaign.conflictPolicy),
    isActive: campaign.isActive !== false,
    isIndefinite,
    status,
    startsAt,
    endsAt,
    source: normalizeString(campaign.source),
    targetProductIds: Array.isArray(campaign.targetProductIds)
      ? campaign.targetProductIds.map((id) => normalizeString(id)).filter(Boolean)
      : [],
    targetCategoryIds: Array.isArray(campaign.targetCategoryIds)
      ? campaign.targetCategoryIds.map((id) => normalizeString(id)).filter(Boolean)
      : [],
    targetBrands: normalizeBrandTokens(campaign),
    channelScopes: normalizeScopeTokens(campaign.channelScope || campaign.channelScopes || campaign.channels || campaign.targetChannels),
    audienceScopes: normalizeScopeTokens(campaign.audience || campaign.audiences || campaign.targetAudience || campaign.targetAudiences),
    actions: campaign.actions && typeof campaign.actions === 'object' ? campaign.actions : {},
    trigger: campaign.trigger && typeof campaign.trigger === 'object' ? campaign.trigger : {},
    createdAt: toIso(campaign.createdAt),
    startsAtDate,
    endsAtDate,
    isCurrentlyActive: campaign.isActive !== false && !INACTIVE_STATUSES.has(status) && isDateActive,
  };
};

const resolveCampaignSpecificity = ({ productMatched = false, brandMatched = false, categoryMatched = false, type = 'general' } = {}) => {
  if (productMatched) return { scope: 'product', specificity: 5 };
  if (brandMatched) return { scope: 'brand', specificity: 4 };
  if (categoryMatched) return { scope: 'category', specificity: 3 };
  if (type === 'dynamic') return { scope: 'dynamic', specificity: 2 };
  return { scope: 'general', specificity: 1 };
};

const matchesCampaignChannelScope = (campaign = {}, options = {}) => {
  const channel = normalizeString(options.channel || options.channelScope).toLocaleLowerCase('tr-TR');
  const audience = normalizeString(options.audience || options.customerType || options.userType).toLocaleLowerCase('tr-TR');

  const campaignChannels = Array.isArray(campaign.channelScopes) ? campaign.channelScopes : [];
  const campaignAudiences = Array.isArray(campaign.audienceScopes) ? campaign.audienceScopes : [];

  const channelMatches = !campaignChannels.length || !channel || campaignChannels.includes(channel) || campaignChannels.includes('all') || campaignChannels.includes('tum');
  const audienceMatches = !campaignAudiences.length || !audience || campaignAudiences.includes(audience) || campaignAudiences.includes('all') || campaignAudiences.includes('tum');
  return channelMatches && audienceMatches;
};

const matchCampaignToProduct = (campaign, product = {}, options = {}) => {
  const { includeGeneralCampaigns = true } = options;
  if (!campaign?.isCurrentlyActive) return null;
  if (!matchesCampaignChannelScope(campaign, options)) return null;

  const productId = normalizeString(product.id || product.productId);
  const categoryId = normalizeString(product.categoryId);
  const productBrand = normalizeString(product.brand || product.brandName).toLocaleLowerCase('tr-TR');

  const productMatched = campaign.targetProductIds.includes(productId);
  const categoryMatched = categoryId ? campaign.targetCategoryIds.includes(categoryId) : false;
  const brandMatched = productBrand ? campaign.targetBrands.includes(productBrand) : false;
  const hasExplicitScope = campaign.targetProductIds.length > 0 || campaign.targetCategoryIds.length > 0 || campaign.targetBrands.length > 0;

  if (productMatched || brandMatched || categoryMatched) {
    return resolveCampaignSpecificity({
      productMatched,
      brandMatched,
      categoryMatched,
      type: campaign.type,
    });
  }

  if (campaign.type === 'product' || campaign.type === 'brand' || campaign.type === 'category') {
    return null;
  }

  if (campaign.type === 'dynamic' && hasExplicitScope) {
    return null;
  }

  if ((!hasExplicitScope || campaign.type === 'general') && includeGeneralCampaigns) {
    return { scope: 'general', specificity: 1 };
  }

  return null;
};

const computeDiscountedPrice = ({ salePrice, campaign }) => {
  const baseSalePrice = Number(salePrice || 0);
  if (!Number.isFinite(baseSalePrice) || baseSalePrice <= 0) return null;

  const rate = Math.max(0, Number(campaign.discountRate || 0));
  const amount = Math.max(0, Number(campaign.discountAmount || 0));
  const mode = normalizeString(campaign.discountMode || campaign.discountType || campaign.valueType).toLocaleLowerCase('tr-TR');

  let rawDiscountedPrice = baseSalePrice;
  let appliedMode = null;

  if (amount > 0 && ['fixed', 'amount', 'amount_off', 'currency', 'manual'].includes(mode)) {
    rawDiscountedPrice = baseSalePrice - amount;
    appliedMode = 'amount';
  } else if (rate > 0) {
    rawDiscountedPrice = baseSalePrice * (1 - (rate / 100));
    appliedMode = 'rate';
  } else if (amount > 0) {
    rawDiscountedPrice = baseSalePrice - amount;
    appliedMode = 'amount';
  } else {
    return null;
  }

  rawDiscountedPrice = Number(rawDiscountedPrice.toFixed(2));
  const clampedRawPrice = Math.max(MIN_NON_ZERO_PRICE, Math.min(baseSalePrice, rawDiscountedPrice));
  let discountedPrice = normalizePriceToAllowedCents(clampedRawPrice);
  if (!Number.isFinite(discountedPrice) || discountedPrice >= baseSalePrice) {
    discountedPrice = Number(clampedRawPrice.toFixed(2));
  }

  if (!Number.isFinite(discountedPrice) || discountedPrice <= 0 || discountedPrice >= baseSalePrice) {
    return null;
  }

  const discountAmount = Number((baseSalePrice - discountedPrice).toFixed(2));
  if (!(discountAmount > 0)) return null;

  return {
    discountedPrice: Number(discountedPrice.toFixed(2)),
    discountAmount,
    effectiveDiscountRate: Number(((discountAmount / baseSalePrice) * 100).toFixed(2)),
    appliedMode,
  };
};

const compareCampaignCandidates = (left, right, strategy) => {
  if (strategy === 'highest_priority') {
    if (right.campaign.priority !== left.campaign.priority) return right.campaign.priority - left.campaign.priority;
    if (left.discountedPrice !== right.discountedPrice) return left.discountedPrice - right.discountedPrice;
  } else {
    if (left.discountedPrice !== right.discountedPrice) return left.discountedPrice - right.discountedPrice;
    if (right.discountAmount !== left.discountAmount) return right.discountAmount - left.discountAmount;
  }

  if (right.specificity !== left.specificity) return right.specificity - left.specificity;
  if (right.campaign.priority !== left.campaign.priority) return right.campaign.priority - left.campaign.priority;

  const leftStart = parseDate(left.campaign.startsAt)?.getTime() || 0;
  const rightStart = parseDate(right.campaign.startsAt)?.getTime() || 0;
  if (rightStart !== leftStart) return rightStart - leftStart;

  return String(left.campaign.name || '').localeCompare(String(right.campaign.name || ''), 'tr');
};

const summarizeCampaignCandidate = (candidate, resolutionStrategy) => ({
  id: candidate.campaign.id,
  name: candidate.campaign.name,
  internalName: candidate.campaign.internalName || candidate.campaign.name,
  publicName: resolveCustomerCampaignTitle(candidate.campaign),
  customerTitle: resolveCustomerCampaignTitle(candidate.campaign),
  displayName: resolveCustomerCampaignTitle(candidate.campaign),
  type: candidate.campaign.type,
  discountRate: candidate.campaign.discountRate,
  configuredDiscountAmount: candidate.campaign.discountAmount,
  effectiveDiscountRate: candidate.effectiveDiscountRate,
  discountAmount: candidate.discountAmount,
  discountedPrice: candidate.discountedPrice,
  campaignPrice: candidate.discountedPrice,
  effectivePrice: candidate.discountedPrice,
  startsAt: candidate.campaign.startsAt,
  endsAt: candidate.campaign.endsAt,
  isIndefinite: candidate.campaign.isIndefinite,
  priority: candidate.campaign.priority,
  conflictPolicy: candidate.campaign.conflictPolicy,
  status: candidate.campaign.status,
  source: candidate.campaign.source || null,
  scope: candidate.scope,
  specificity: candidate.specificity,
  appliedMode: candidate.appliedMode,
  resolutionStrategy,
  appliedCampaignReason: getAppliedCampaignReason(resolutionStrategy, 0),
});

const getAppliedCampaignReason = (strategy, conflictCount = 0) => {
  if (strategy === 'highest_priority') {
    return conflictCount > 0
      ? 'highest_priority: once priority, esitlikte en dusuk efektif fiyat uygulandi'
      : 'highest_priority: kampanya fiyatı uygulandı';
  }
  return conflictCount > 0
    ? 'best_price: en dusuk efektif fiyat uygulandi'
    : 'best_price: kampanya fiyatı uygulandı';
};

export const listActiveCampaignDefinitions = async ({ settings, now = new Date() } = {}) => {
  const sourceSettings = settings || await settingsRepo.getSettings();
  const campaigns = Array.isArray(sourceSettings?.customerRelations?.campaigns)
    ? sourceSettings.customerRelations.campaigns
    : [];

  const normalizedCampaigns = campaigns
    .map((campaign) => normalizeCampaign(campaign, now))
  validateCampaignLifecycleIntegrity(normalizedCampaigns, { now });
  return normalizedCampaigns
    .filter((campaign) => campaign.id && campaign.name && campaign.isCurrentlyActive && (campaign.discountRate > 0 || campaign.discountAmount > 0));
};

export const applyCampaignPricingToProduct = (product = {}, activeCampaigns = [], options = {}) => {
  const salePrice = Number(product.salePrice || 0);
  const currentPrice = Number(product.currentPrice || salePrice || 0);
  const baseSalePrice = Number.isFinite(salePrice) && salePrice > 0 ? salePrice : currentPrice;

  if (!Number.isFinite(baseSalePrice) || baseSalePrice <= 0) {
    const fallbackPrice = baseSalePrice > 0 ? baseSalePrice : Number(product.currentPrice || product.salePrice || product.price || 0);
    return {
      ...product,
      salePrice: baseSalePrice > 0 ? baseSalePrice : Number(product.salePrice || 0),
      currentPrice: fallbackPrice,
      price: baseSalePrice > 0 ? baseSalePrice : Number(product.price || product.salePrice || 0),
      discountedPrice: null,
      campaignPrice: null,
      originalPrice: baseSalePrice > 0 ? baseSalePrice : Number(product.salePrice || 0),
      regularPrice: baseSalePrice > 0 ? baseSalePrice : Number(product.salePrice || 0),
      effectivePrice: fallbackPrice,
      productListView: product.productListView ? {
        ...product.productListView,
        currentPrice: fallbackPrice,
        salePrice: baseSalePrice > 0 ? baseSalePrice : Number(product.salePrice || 0),
        price: baseSalePrice > 0 ? baseSalePrice : Number(product.price || product.salePrice || 0),
        campaignPrice: null,
      } : product.productListView,
      productDetailView: product.productDetailView ? {
        ...product.productDetailView,
        currentPrice: fallbackPrice,
        salePrice: baseSalePrice > 0 ? baseSalePrice : Number(product.salePrice || 0),
        price: baseSalePrice > 0 ? baseSalePrice : Number(product.price || product.salePrice || 0),
        campaignPrice: null,
      } : product.productDetailView,
      hasActiveDiscount: false,
      hasActiveCampaign: false,
      discountAmount: 0,
      effectiveDiscountRate: 0,
      activeCampaign: null,
      activeCampaignId: null,
      activeCampaignName: '',
      campaignStartsAt: null,
      campaignEndsAt: null,
      appliedCampaign: null,
      appliedCampaignReason: '',
      activeCampaigns: [],
      candidateCampaigns: [],
      campaignInfo: '',
      campaignBadge: '',
      campaignIds: [],
      campaignCount: 0,
      campaignConflictCount: 0,
      campaignConflictPolicy: null,
      campaignDiscountAmount: 0,
      campaignDiscountPercent: 0,
      campaignValidUntil: null,
      campaignResolutionStrategy: null,
    };
  }

  const candidates = activeCampaigns
    .map((campaign) => {
      const match = matchCampaignToProduct(campaign, product, options);
      if (!match) return null;
      const price = computeDiscountedPrice({ salePrice: baseSalePrice, campaign });
      if (!price) return null;
      return {
        campaign,
        ...match,
        ...price,
      };
    })
    .filter(Boolean);

  if (!candidates.length) {
    return {
      ...product,
      salePrice: baseSalePrice,
      currentPrice: baseSalePrice,
      price: baseSalePrice,
      discountedPrice: null,
      campaignPrice: null,
      originalPrice: baseSalePrice,
      regularPrice: baseSalePrice,
      effectivePrice: baseSalePrice,
      productListView: product.productListView ? {
        ...product.productListView,
        currentPrice: baseSalePrice,
        salePrice: baseSalePrice,
        price: baseSalePrice,
        campaignPrice: null,
      } : product.productListView,
      productDetailView: product.productDetailView ? {
        ...product.productDetailView,
        currentPrice: baseSalePrice,
        salePrice: baseSalePrice,
        price: baseSalePrice,
        campaignPrice: null,
      } : product.productDetailView,
      hasActiveDiscount: false,
      hasActiveCampaign: false,
      discountAmount: 0,
      effectiveDiscountRate: 0,
      activeCampaign: null,
      activeCampaignId: null,
      activeCampaignName: '',
      campaignStartsAt: null,
      campaignEndsAt: null,
      appliedCampaign: null,
      appliedCampaignReason: '',
      activeCampaigns: [],
      candidateCampaigns: [],
      campaignInfo: '',
      campaignBadge: '',
      campaignIds: [],
      campaignCount: 0,
      campaignConflictCount: 0,
      campaignConflictPolicy: null,
      campaignDiscountAmount: 0,
      campaignDiscountPercent: 0,
      campaignValidUntil: null,
      campaignResolutionStrategy: null,
    };
  }

  const resolutionStrategy = candidates.every((candidate) => candidate.campaign.conflictPolicy === 'highest_priority')
    ? 'highest_priority'
    : 'best_price';

  const sortedCandidates = [...candidates].sort((left, right) => compareCampaignCandidates(left, right, resolutionStrategy));
  const selectedCandidate = sortedCandidates[0];
  const summarizedCampaigns = sortedCandidates.map((candidate) => summarizeCampaignCandidate(candidate, resolutionStrategy));
  const selectedCampaign = summarizedCampaigns[0] || null;
  const campaignConflictCount = Math.max(0, summarizedCampaigns.length - 1);
  const appliedCampaignReason = getAppliedCampaignReason(resolutionStrategy, campaignConflictCount);
  const candidateCampaigns = summarizedCampaigns.map((campaign, index) => ({
    ...campaign,
    isWinner: index === 0,
    appliedCampaignReason: index === 0 ? appliedCampaignReason : `${resolutionStrategy}: aday kampanya secilmedi`,
  }));

  return {
    ...product,
    salePrice: baseSalePrice,
    currentPrice: selectedCandidate.discountedPrice,
    price: baseSalePrice,
    discountedPrice: selectedCandidate.discountedPrice,
    campaignPrice: selectedCandidate.discountedPrice,
    originalPrice: baseSalePrice,
    regularPrice: baseSalePrice,
    effectivePrice: selectedCandidate.discountedPrice,
    productListView: product.productListView ? {
      ...product.productListView,
      currentPrice: selectedCandidate.discountedPrice,
      salePrice: baseSalePrice,
      price: baseSalePrice,
      campaignPrice: selectedCandidate.discountedPrice,
    } : product.productListView,
    productDetailView: product.productDetailView ? {
      ...product.productDetailView,
      currentPrice: selectedCandidate.discountedPrice,
      salePrice: baseSalePrice,
      price: baseSalePrice,
      campaignPrice: selectedCandidate.discountedPrice,
    } : product.productDetailView,
    hasActiveDiscount: true,
    hasActiveCampaign: true,
    discountAmount: selectedCandidate.discountAmount,
    effectiveDiscountRate: selectedCandidate.effectiveDiscountRate,
    activeCampaign: selectedCampaign,
    activeCampaignId: selectedCampaign?.id || null,
    activeCampaignName: selectedCampaign?.name || '',
    campaignStartsAt: selectedCampaign?.startsAt || null,
    campaignEndsAt: selectedCampaign?.endsAt || null,
    appliedCampaign: selectedCampaign,
    appliedCampaignReason,
    activeCampaigns: candidateCampaigns,
    candidateCampaigns,
    campaignInfo: selectedCampaign?.name || '',
    campaignBadge: selectedCampaign?.name || '',
    campaignIds: summarizedCampaigns.map((item) => item.id),
    campaignCount: summarizedCampaigns.length,
    campaignConflictCount,
    campaignConflictPolicy: resolutionStrategy,
    campaignDiscountAmount: selectedCandidate.discountAmount,
    campaignDiscountPercent: selectedCandidate.effectiveDiscountRate,
    campaignValidUntil: selectedCampaign?.endsAt || null,
    campaignResolutionStrategy: resolutionStrategy,
  };
};

export const buildCampaignSummariesFromProducts = (products = []) => {
  const campaignMap = new Map();

  products.forEach((product) => {
    const campaignRows = Array.isArray(product.activeCampaigns) ? product.activeCampaigns : [];
    campaignRows.forEach((campaign) => {
      const key = normalizeString(campaign.id);
      if (!key) return;
      const customerTitle = resolveCustomerCampaignTitle(campaign);
      const current = campaignMap.get(key) || {
        id: key,
        name: campaign.name,
        internalName: campaign.internalName || campaign.name,
        publicName: customerTitle,
        customerTitle,
        displayName: customerTitle,
        type: campaign.type || 'general',
        discountRate: Number(campaign.discountRate || 0),
        startsAt: campaign.startsAt || null,
        endsAt: campaign.endsAt || null,
        isIndefinite: campaign.isIndefinite === true,
        priority: Number(campaign.priority || 0),
        conflictPolicy: campaign.conflictPolicy || 'best_price',
        scope: campaign.scope || 'general',
        resolutionStrategy: campaign.resolutionStrategy || product.campaignResolutionStrategy || 'best_price',
        productIds: new Set(),
        products: [],
      };

      const productId = normalizeString(product.id || product.productId);
      if (productId && !current.productIds.has(productId)) {
        current.productIds.add(productId);
        current.products.push(product);
      }

      campaignMap.set(key, current);
    });
  });

  return Array.from(campaignMap.values())
    .map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      internalName: campaign.internalName || campaign.name,
      publicName: campaign.publicName || resolveCustomerCampaignTitle(campaign),
      customerTitle: campaign.customerTitle || campaign.publicName || resolveCustomerCampaignTitle(campaign),
      displayName: campaign.displayName || campaign.publicName || resolveCustomerCampaignTitle(campaign),
      type: campaign.type,
      discountRate: campaign.discountRate,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      isIndefinite: campaign.isIndefinite,
      priority: campaign.priority,
      conflictPolicy: campaign.conflictPolicy,
      scope: campaign.scope,
      resolutionStrategy: campaign.resolutionStrategy,
      productCount: campaign.productIds.size,
      productIds: Array.from(campaign.productIds),
      products: campaign.products,
    }))
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      if (right.discountRate !== left.discountRate) return right.discountRate - left.discountRate;
      return String(left.name || '').localeCompare(String(right.name || ''), 'tr');
    });
};
