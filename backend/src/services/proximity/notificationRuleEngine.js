import { v4 as uuidv4 } from 'uuid';
import { notificationRepo } from '../../repositories/notificationRepository.js';
import { getPrisma } from '../../providers/postgresProvider.js';
import { listActiveCampaignDefinitions } from '../campaignPricingService.js';
import { eslService } from '../eslService.js';
import { cleanSectionDisplayName } from '../../utils/displayLabels.js';
import { config } from '../../config/config.js';

const SHOWN_STATUS = 'SHOWN';
const SKIPPED_STATUS = 'SKIPPED';
const DEFAULT_CUSTOMER_DOMAIN_COOLDOWN_MINUTES = 30;
const DEFAULT_PRODUCT_DISCOUNT_DEDUPE_SECONDS = 12 * 60 * 60;
const CUSTOMER_NOTIFICATION_TYPES = new Set([
  'PROXIMITY_CAMPAIGN',
  'PROXIMITY_CATEGORY',
  'PROXIMITY_PRODUCT_SUGGESTION',
  'PROXIMITY_PRODUCT_DISCOUNT',
]);

const normalizeText = (value) => String(value || '').trim();
const normalizeLower = (value) => normalizeText(value).toLocaleLowerCase('tr-TR');
const normalizeUpper = (value) => normalizeText(value).toUpperCase();
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const toCooldownBucketKey = (date = new Date(), cooldownMs = DEFAULT_CUSTOMER_DOMAIN_COOLDOWN_MINUTES * 60 * 1000) => {
  const safeCooldownMs = Number.isFinite(Number(cooldownMs)) && Number(cooldownMs) >= 1000
    ? Number(cooldownMs)
    : DEFAULT_CUSTOMER_DOMAIN_COOLDOWN_MINUTES * 60 * 1000;
  return String(Math.floor(date.getTime() / safeCooldownMs));
};

const resolveTargetType = (userType) => (normalizeLower(userType) === 'customer' ? 'customer' : null);
const buildDedupeKey = ({ userId, ruleId, zoneId, beaconDeviceId, now = new Date(), cooldownMs }) =>
  `proximity:${userId}:${ruleId}:${zoneId || beaconDeviceId || 'unknown'}:${toCooldownBucketKey(now, cooldownMs)}`;
const buildProductDiscountDedupeKey = ({ userId, productId, barcode }) => {
  const productKey = normalizeText(productId) || normalizeText(barcode);
  return productKey ? `proximity-product-discount:${userId}:${productKey}` : null;
};
const isCustomerActionUrl = (value) => !normalizeText(value) || normalizeText(value).startsWith('/musteri');
const isSyntheticRuleId = (value) => normalizeText(value).includes(':');
const isPlaceholderBarcode = (value) => {
  const text = normalizeText(value);
  return !text || text === '0000000000000';
};
const toPriceNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'string' ? value.replace(',', '.') : value;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};
const formatTryPrice = (value) => {
  const numeric = toPriceNumberOrNull(value);
  if (numeric === null) return '';
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numeric);
};
const resolveLinkedEslDeviceId = (beaconDevice = {}) => {
  const metadata = isObject(beaconDevice?.metadata) ? beaconDevice.metadata : {};
  return normalizeText(metadata.eslDeviceId || metadata.linkedEslDeviceId || metadata.esl_device_id) || null;
};
const buildProductDetailRoute = (productId) => {
  const id = normalizeText(productId);
  return id ? `/musteri/urun/${encodeURIComponent(id)}` : null;
};
const parseCooldownSeconds = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return null;
  return numeric;
};
const resolveProductDedupeSeconds = (value) => {
  const configured = parseCooldownSeconds(value);
  if (configured !== null) return configured;
  const envConfigured = parseCooldownSeconds(config.proximityProductDedupeSeconds);
  return envConfigured ?? DEFAULT_PRODUCT_DISCOUNT_DEDUPE_SECONDS;
};
const resolveProductDedupeMs = (value) => resolveProductDedupeSeconds(value) * 1000;
const resolveCooldownMs = ({ cooldownSeconds = null, cooldownMinutes = null } = {}) => {
  const seconds = parseCooldownSeconds(cooldownSeconds);
  if (seconds !== null) return Math.round(seconds * 1000);
  const minutes = Math.max(0, Number(cooldownMinutes ?? DEFAULT_CUSTOMER_DOMAIN_COOLDOWN_MINUTES) || 0);
  return Math.round(minutes * 60 * 1000);
};
const normalizeCustomerNotificationType = (value) => {
  const type = normalizeUpper(value);
  return CUSTOMER_NOTIFICATION_TYPES.has(type) ? type : 'PROXIMITY_CAMPAIGN';
};

const getContext = ({ proximityEvent, beaconDevice, locationZone }) => {
  const zoneMetadata = isObject(locationZone?.metadata) ? locationZone.metadata : {};
  const beaconMetadata = isObject(beaconDevice?.metadata) ? beaconDevice.metadata : {};
  const sectionId = normalizeText(
    beaconDevice?.sectionId
    || locationZone?.sectionId
    || beaconMetadata.sectionId
    || zoneMetadata.sectionId
  ) || null;
  const categoryId = normalizeText(zoneMetadata.categoryId || beaconMetadata.categoryId) || null;
  const tags = [
    ...(Array.isArray(zoneMetadata.tags) ? zoneMetadata.tags : []),
    ...(Array.isArray(beaconMetadata.tags) ? beaconMetadata.tags : []),
  ].map((item) => normalizeLower(item)).filter(Boolean);

  return {
    sectionId,
    sectionName: normalizeText(locationZone?.section?.name || locationZone?.sectionName || beaconMetadata.sectionName || zoneMetadata.sectionName) || null,
    categoryId,
    tags,
    beaconDeviceId: beaconDevice?.id || proximityEvent.beaconDeviceId || null,
    locationZoneId: locationZone?.id || proximityEvent.locationZoneId || null,
    zoneName: normalizeText(locationZone?.name) || null,
    zoneCode: locationZone?.code || null,
  };
};

const normalizePriority = (value) => {
  const text = normalizeLower(value);
  if (['danger', 'critical', 'high'].includes(text)) return 'danger';
  if (['success', 'ok'].includes(text)) return 'success';
  if (['warning', 'medium'].includes(text)) return 'warning';
  return 'info';
};

const mapNotificationForClient = (notification) => ({
  id: notification.id,
  type: notification.type,
  title: notification.title,
  body: notification.message,
  severity: notification.severity,
  actionType: notification.actionType,
  actionLabel: notification.payload?.actionLabel || null,
  actionUrl: notification.actionUrl,
  payload: notification.payload || {},
});

const createDelivery = async ({
  userId,
  notificationRuleId = null,
  proximityEventId,
  notificationId = null,
  locationZoneId = null,
  beaconDeviceId = null,
  status,
  skipReason = null,
  dedupeKey = null,
}) => {
  const prisma = await getPrisma();
  return prisma.notificationDelivery.create({
    data: {
      userId,
      notificationRuleId,
      proximityEventId,
      notificationId,
      locationZoneId,
      beaconDeviceId,
      status,
      skipReason,
      dedupeKey,
    },
  });
};

const createSkippedDelivery = async ({ userId, proximityEvent, beaconDevice, locationZone, context, reason, dedupeKey = null }) => createDelivery({
  userId,
  proximityEventId: proximityEvent.id,
  locationZoneId: context?.locationZoneId || locationZone?.id || proximityEvent.locationZoneId || null,
  beaconDeviceId: context?.beaconDeviceId || beaconDevice?.id || proximityEvent.beaconDeviceId || null,
  status: SKIPPED_STATUS,
  skipReason: reason,
  dedupeKey,
});

const resolveExistingNotificationRuleId = async (ruleId) => {
  const normalized = normalizeText(ruleId);
  if (!normalized || isSyntheticRuleId(normalized)) return null;

  const prisma = await getPrisma();
  const rule = await prisma.notificationRule.findUnique({
    where: { id: normalized },
    select: { id: true },
  });
  return rule?.id || null;
};

const findRecentShownDelivery = async ({ userId, notificationRuleId, cooldownMs, beaconDeviceId, locationZoneId, dedupeKey, now }) => {
  const safeCooldownMs = Math.max(0, Number(cooldownMs) || 0);
  if (safeCooldownMs <= 0) return null;
  const prisma = await getPrisma();
  const since = new Date(now.getTime() - safeCooldownMs);
  return prisma.notificationDelivery.findFirst({
    where: {
      userId,
      status: SHOWN_STATUS,
      beaconDeviceId: beaconDeviceId || null,
      locationZoneId: locationZoneId || null,
      createdAt: { gte: since },
      ...(notificationRuleId
        ? { notificationRuleId }
        : { notificationRuleId: null, dedupeKey }),
    },
    orderBy: { createdAt: 'desc' },
  });
};

const findRecentShownProductDiscountDelivery = async ({ userId, dedupeKey, now, dedupeMs }) => {
  if (!userId || !dedupeKey) return null;
  const prisma = await getPrisma();
  const safeDedupeMs = Math.max(1000, Number(dedupeMs) || resolveProductDedupeMs());
  const since = new Date(now.getTime() - safeDedupeMs);
  return prisma.notificationDelivery.findFirst({
    where: {
      userId,
      status: SHOWN_STATUS,
      dedupeKey,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
  });
};

const hasReachedMaxPerVisit = async ({ userId, notificationRuleId, maxPerVisit, beaconDeviceId, locationZoneId, dedupeKey, now }) => {
  const max = Number(maxPerVisit);
  if (!Number.isFinite(max) || max <= 0) return false;
  const prisma = await getPrisma();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const count = await prisma.notificationDelivery.count({
    where: {
      userId,
      status: SHOWN_STATUS,
      beaconDeviceId: beaconDeviceId || null,
      locationZoneId: locationZoneId || null,
      createdAt: { gte: dayStart },
      ...(notificationRuleId
        ? { notificationRuleId }
        : { notificationRuleId: null, dedupeKey }),
    },
  });
  return count >= max;
};

const createNotificationRecord = async ({ userId, userType, ruleId, notification, proximityEvent, beaconDevice, locationZone, context, dedupeKey, enforceNotificationDedupe = true }) => {
  if (enforceNotificationDedupe) {
    const existing = await notificationRepo.findByUserAndDedupeKey(userId, dedupeKey);
    if (existing) return { notification: existing, duplicate: true };
  }

  const targetType = resolveTargetType(userType);
  const payload = {
    ...(isObject(notification.payload) ? notification.payload : {}),
    eventId: proximityEvent.id,
    proximityEventId: proximityEvent.id,
    zoneId: context.locationZoneId,
    zoneCode: context.zoneCode,
    zoneName: context.zoneName,
    beaconDeviceId: context.beaconDeviceId,
    beaconDeviceCode: beaconDevice?.deviceCode || proximityEvent.deviceCode || null,
    sectionId: notification.payload?.sectionId || context.sectionId,
    sectionName: notification.payload?.sectionName || context.sectionName,
    rssi: proximityEvent.rssi,
    eventType: proximityEvent.eventType,
    source: proximityEvent.source,
    actionLabel: notification.actionLabel || null,
  };

  const record = {
    id: uuidv4(),
    userId,
    type: notification.type,
    title: notification.title,
    message: notification.body,
    severity: normalizePriority(notification.severity),
    isRead: false,
    relatedTaskId: notification.relatedTaskId || payload.taskId || null,
    dedupeKey,
    actionUrl: notification.actionUrl || null,
    actionType: notification.actionType || 'none',
    audience: {
      scope: 'customer',
      source: 'proximity',
      userType,
      ruleId,
      locationZoneId: context.locationZoneId,
      beaconDeviceId: context.beaconDeviceId,
      sectionId: context.sectionId,
    },
    delivery: {
      channel: 'webview-proximity',
      source: proximityEvent.source,
      eventId: proximityEvent.id,
    },
    payload,
    createdAt: new Date().toISOString(),
    createdBy: 'proximity-rule-engine',
  };

  return { notification: await notificationRepo.create(record), duplicate: false };
};

const deliverNotification = async ({
  userId,
  userType,
  ruleId,
  cooldownMinutes,
  cooldownSeconds = null,
  bypassCooldown = false,
  maxPerVisit = null,
  bypassMaxPerVisit = false,
  productDedupeKey = null,
  productDedupeReason = 'PRODUCT_DISCOUNT_ALREADY_NOTIFIED_12H',
  productDedupeSeconds = null,
  productDiagnostic = null,
  enforceNotificationDedupe = true,
  notification,
  proximityEvent,
  beaconDevice,
  locationZone,
  context,
}) => {
  const now = new Date();
  const notificationRuleId = await resolveExistingNotificationRuleId(ruleId);
  const cooldownMs = resolveCooldownMs({ cooldownSeconds, cooldownMinutes });
  const dedupeKey = productDedupeKey || buildDedupeKey({
    userId,
    ruleId,
    zoneId: context.locationZoneId,
    beaconDeviceId: context.beaconDeviceId,
    now,
    cooldownMs,
  });

  if (productDedupeKey) {
    const productDedupeMs = resolveProductDedupeMs(productDedupeSeconds);
    const productDelivery = await findRecentShownProductDiscountDelivery({
      userId,
      dedupeKey: productDedupeKey,
      now,
      dedupeMs: productDedupeMs,
    });
    if (productDelivery) {
      const dedupeUntil = new Date(new Date(productDelivery.createdAt).getTime() + productDedupeMs);
      await createDelivery({
        userId,
        notificationRuleId,
        proximityEventId: proximityEvent.id,
        locationZoneId: context.locationZoneId,
        beaconDeviceId: context.beaconDeviceId,
        status: SKIPPED_STATUS,
        skipReason: productDedupeReason,
        dedupeKey: productDedupeKey,
      });
      console.info('[proximity] product discount notification suppressed by product dedupe', {
        reason: productDedupeReason,
        dedupeKey: productDedupeKey,
        dedupeUntil: dedupeUntil.toISOString(),
        productId: productDiagnostic?.productId || null,
        barcode: productDiagnostic?.barcode || null,
        proximityEventId: proximityEvent.id,
      });
      return {
        shouldNotify: false,
        reason: productDedupeReason,
        dedupeUntil: dedupeUntil.toISOString(),
        productId: productDiagnostic?.productId || null,
        barcode: productDiagnostic?.barcode || null,
        productName: productDiagnostic?.productName || null,
        dedupeKey: productDedupeKey,
      };
    }
  }

  const cooldownDelivery = bypassCooldown ? null : await findRecentShownDelivery({
    userId,
    notificationRuleId,
    cooldownMs,
    beaconDeviceId: context.beaconDeviceId,
    locationZoneId: context.locationZoneId,
    dedupeKey,
    now,
  });

  if (cooldownDelivery) {
    await createDelivery({
      userId,
      notificationRuleId,
      proximityEventId: proximityEvent.id,
      locationZoneId: context.locationZoneId,
      beaconDeviceId: context.beaconDeviceId,
      status: SKIPPED_STATUS,
      skipReason: 'COOLDOWN_ACTIVE',
      dedupeKey,
    });
    return { shouldNotify: false, reason: 'COOLDOWN_ACTIVE' };
  }

  const maxReached = bypassMaxPerVisit ? false : await hasReachedMaxPerVisit({
    userId,
    notificationRuleId,
    maxPerVisit,
    beaconDeviceId: context.beaconDeviceId,
    locationZoneId: context.locationZoneId,
    dedupeKey,
    now,
  });

  if (maxReached) {
    await createDelivery({
      userId,
      notificationRuleId,
      proximityEventId: proximityEvent.id,
      locationZoneId: context.locationZoneId,
      beaconDeviceId: context.beaconDeviceId,
      status: SKIPPED_STATUS,
      skipReason: 'MAX_PER_VISIT_REACHED',
      dedupeKey,
    });
    return { shouldNotify: false, reason: 'MAX_PER_VISIT_REACHED' };
  }

  const created = await createNotificationRecord({
    userId,
    userType,
    ruleId,
    notification,
    proximityEvent,
    beaconDevice,
    locationZone,
    context,
    dedupeKey,
    enforceNotificationDedupe,
  });

  if (created.duplicate) {
    await createDelivery({
      userId,
      notificationRuleId,
      proximityEventId: proximityEvent.id,
      notificationId: created.notification.id,
      locationZoneId: context.locationZoneId,
      beaconDeviceId: context.beaconDeviceId,
      status: SKIPPED_STATUS,
      skipReason: 'DEDUPE_ACTIVE',
      dedupeKey,
    });
    return { shouldNotify: false, reason: 'DEDUPE_ACTIVE' };
  }

  await createDelivery({
    userId,
    notificationRuleId,
    proximityEventId: proximityEvent.id,
    notificationId: created.notification.id,
    locationZoneId: context.locationZoneId,
    beaconDeviceId: context.beaconDeviceId,
    status: SHOWN_STATUS,
    dedupeKey,
  });

  return { shouldNotify: true, notification: mapNotificationForClient(created.notification) };
};

const campaignMatchesContext = (campaign = {}, context = {}, products = []) => {
  const targetProductIds = new Set(Array.isArray(campaign.targetProductIds) ? campaign.targetProductIds.map(String) : []);
  const targetCategoryIds = new Set(Array.isArray(campaign.targetCategoryIds) ? campaign.targetCategoryIds.map(String) : []);
  const campaignTags = [
    ...(Array.isArray(campaign.tags) ? campaign.tags : []),
    ...(Array.isArray(campaign.targetTags) ? campaign.targetTags : []),
  ].map((item) => normalizeLower(item)).filter(Boolean);

  if (context.categoryId && targetCategoryIds.has(context.categoryId)) return true;
  if (context.tags.length && campaignTags.some((tag) => context.tags.includes(tag))) return true;
  if (products.some((product) => targetProductIds.has(String(product.id)))) return true;
  if (products.some((product) => product.categoryId && targetCategoryIds.has(String(product.categoryId)))) return true;
  return false;
};

const buildCustomerCampaignCandidate = async ({ context }) => {
  const prisma = await getPrisma();
  const products = context.sectionId
    ? await prisma.product.findMany({
      where: { sectionId: context.sectionId, isListed: { not: false }, isActive: { not: false } },
      select: { id: true, name: true, categoryId: true },
      take: 100,
    })
    : [];

  const campaigns = await listActiveCampaignDefinitions();
  const matched = campaigns.find((campaign) => campaignMatchesContext(campaign, context, products));
  if (!matched) return null;

  const firstProduct = products.find((product) => (
    Array.isArray(matched.targetProductIds) && matched.targetProductIds.map(String).includes(String(product.id))
  )) || products[0] || null;
  const categoryId = context.categoryId || firstProduct?.categoryId || (Array.isArray(matched.targetCategoryIds) ? matched.targetCategoryIds[0] : null);

  return {
    ruleId: `domain:customer-campaign:${matched.id}`,
    cooldownMinutes: Math.max(DEFAULT_CUSTOMER_DOMAIN_COOLDOWN_MINUTES, 30),
    maxPerVisit: 1,
    notification: {
      type: 'PROXIMITY_CAMPAIGN',
      title: matched.customerTitle || matched.publicName || matched.displayName || matched.name || 'YakÄ±ndaki kampanya',
      body: firstProduct?.name
        ? `${firstProduct.name} ve bu bÃ¶lgedeki seÃ§ili Ã¼rÃ¼nlerde kampanya var.`
        : 'Bu bÃ¶lgede aktif kampanya var.',
      severity: 'success',
      actionType: 'campaign',
      actionLabel: 'KampanyayÄ± GÃ¶r',
      actionUrl: categoryId ? `/musteri/kategori/${encodeURIComponent(String(categoryId))}` : '/musteri/kampanyalar',
      payload: {
        campaignId: matched.id,
        campaignName: matched.name || null,
        categoryId: categoryId || null,
        productId: firstProduct?.id || null,
      },
    },
  };
};

const buildCustomerCategoryCandidate = async ({ context }) => {
  if (!context.sectionId && !context.categoryId) return null;
  const prisma = await getPrisma();
  const product = await prisma.product.findFirst({
    where: {
      ...(context.sectionId ? { sectionId: context.sectionId } : {}),
      ...(context.categoryId ? { categoryId: context.categoryId } : {}),
      isListed: { not: false },
      isActive: { not: false },
    },
    select: { id: true, name: true, categoryId: true, category: { select: { name: true, code: true } } },
    orderBy: { name: 'asc' },
  });
  if (!product?.categoryId) return null;

  return {
    ruleId: `domain:customer-category:${product.categoryId}`,
    cooldownMinutes: DEFAULT_CUSTOMER_DOMAIN_COOLDOWN_MINUTES,
    notification: {
      type: 'PROXIMITY_CATEGORY',
      title: product.category?.name ? `${product.category.name} reyonundasÄ±n` : 'YakÄ±ndaki Ã¼rÃ¼nler',
      body: `Bu bÃ¶lgede ${product.name || 'seÃ§ili Ã¼rÃ¼nler'} gibi Ã¼rÃ¼nleri inceleyebilirsin.`,
      severity: 'info',
      actionType: 'route',
      actionLabel: 'ÃœrÃ¼nleri GÃ¶r',
      actionUrl: `/musteri/kategori/${encodeURIComponent(product.category?.code || product.categoryId)}`,
      payload: {
        categoryId: product.categoryId,
        productId: product.id,
      },
    },
  };
};

const findLabelProduct = async ({ label = {}, eslDevice = {} }) => {
  const prisma = await getPrisma();
  const productSelect = {
    id: true,
    name: true,
    barcode: true,
    categoryId: true,
    sectionId: true,
    section: { select: { id: true, name: true, number: true } },
    category: { select: { id: true, name: true, mainSectionName: true, mainSectionNo: true } },
  };
  const barcode = normalizeText(label.barcode);
  const assignedProductId = normalizeText(
    eslDevice.assignedProductId
    || eslDevice.bridgeAssignedProductId
    || label.productId
    || label.assignedProductId
  );
  let barcodeProduct = null;
  if (!isPlaceholderBarcode(barcode)) {
    barcodeProduct = await prisma.product.findFirst({
      where: { barcode, isListed: { not: false }, isActive: { not: false } },
      select: productSelect,
    });
    if (barcodeProduct) {
      if (assignedProductId && String(barcodeProduct.id) !== String(assignedProductId)) {
        console.warn('[proximity] label productId/barcode mismatch; using barcode product', {
          assignedProductId,
          barcode,
          barcodeProductId: barcodeProduct.id,
        });
      }
      return barcodeProduct;
    }
  }

  if (assignedProductId) {
    const product = await prisma.product.findFirst({
      where: { id: assignedProductId, isListed: { not: false }, isActive: { not: false } },
      select: productSelect,
    });
    if (product) return product;
  }

  return null;
};

const hasLabelDiscount = (label = {}) => {
  if (label.hasActiveCampaign === true) return true;
  const regularPrice = toPriceNumberOrNull(label.regularPrice);
  if (regularPrice === null || regularPrice <= 0) return false;

  const discountedPrices = [
    label.campaignPrice,
    label.displayPrice,
    label.price,
  ].map(toPriceNumberOrNull).filter((value) => value !== null && value > 0);

  return discountedPrices.some((value) => Math.round(value * 100) < Math.round(regularPrice * 100));
};

const hasActiveCampaignForProduct = async (product = {}) => {
  if (!product?.id) return false;
  const campaigns = await listActiveCampaignDefinitions();
  return campaigns.some((campaign = {}) => {
    const targetProductIds = Array.isArray(campaign.targetProductIds) ? campaign.targetProductIds.map(String) : [];
    const targetBarcodes = Array.isArray(campaign.targetBarcodes) ? campaign.targetBarcodes.map(String) : [];
    return targetProductIds.includes(String(product.id))
      || (product.barcode && targetBarcodes.includes(String(product.barcode)));
  });
};

const resolveDiscountPrices = (label = {}) => {
  const regularPrice = toPriceNumberOrNull(label.regularPrice);
  const displayPrice = toPriceNumberOrNull(label.displayPrice ?? label.price);
  const campaignPrice = toPriceNumberOrNull(label.campaignPrice);
  const effectivePrice = campaignPrice ?? displayPrice ?? toPriceNumberOrNull(label.price);
  return { regularPrice, displayPrice, campaignPrice, effectivePrice };
};

const resolveProductAisle = ({ product = {}, label = {}, context = {} } = {}) => {
  const sourceName = cleanSectionDisplayName(product?.section?.name, '')
    || cleanSectionDisplayName(label.sectionName || label.displaySectionName || label.currentSectionName, '')
    || cleanSectionDisplayName(product?.category?.mainSectionName, '')
    || cleanSectionDisplayName(context.sectionName, '')
    || cleanSectionDisplayName(context.zoneName, '')
    || 'Yakındaki Reyon';
  const sectionId = normalizeText(product?.sectionId || product?.section?.id || context.sectionId) || null;
  const sectionName = cleanSectionDisplayName(product?.section?.name || label.sectionName || label.displaySectionName || product?.category?.mainSectionName || context.sectionName || sourceName, 'Yakındaki Reyon');
  return {
    sectionId,
    sectionName,
    displaySectionName: sourceName,
  };
};

const buildNativeProductDiscountTitle = ({ sectionName }) => {
  const name = normalizeText(sectionName) || 'Yakındaki Reyon';
  return `${name} reyonundasın`;
};

const ruleConfigScore = (rule = {}, context = {}) => {
  if (rule.beaconDeviceId && rule.beaconDeviceId === context.beaconDeviceId) return 400;
  if (rule.locationZoneId && rule.locationZoneId === context.locationZoneId) return 300;
  if (!rule.beaconDeviceId && !rule.locationZoneId) return 10;
  return 0;
};

const findCustomerProximityRuleConfig = async ({ context, eventType }) => {
  const prisma = await getPrisma();
  const rules = await prisma.notificationRule.findMany({
    where: {
      isActive: true,
      targetType: { equals: 'customer', mode: 'insensitive' },
      trigger: { equals: normalizeUpper(eventType || 'ZONE_ENTER'), mode: 'insensitive' },
      OR: [
        { beaconDeviceId: context.beaconDeviceId },
        { locationZoneId: context.locationZoneId },
        { beaconDeviceId: null, locationZoneId: null },
      ],
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });

  return rules
    .map((rule) => ({ rule, score: ruleConfigScore(rule, context) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || Number(right.rule.priority || 0) - Number(left.rule.priority || 0))[0]?.rule || null;
};

const buildCustomerProductDiscountCandidate = async ({ userId, beaconDevice, context, eventType }) => {
  const eslDeviceId = resolveLinkedEslDeviceId(beaconDevice);
  if (!eslDeviceId) return { candidate: null, reason: 'NO_LINKED_ESL_DEVICE' };

  let currentLabel = null;
  try {
    currentLabel = await eslService.getCurrentLabel(eslDeviceId);
  } catch {
    return { candidate: null, reason: 'NO_LINKED_ESL_DEVICE' };
  }
  const label = isObject(currentLabel?.label) ? currentLabel.label : currentLabel;
  if (!label || label.clearLabel === true || isPlaceholderBarcode(label.barcode)) {
    return { candidate: null, reason: 'NO_LABEL_PRODUCT' };
  }

  const product = await findLabelProduct({ label, eslDevice: {} });
  if (!product) return { candidate: null, reason: 'INVALID_PRODUCT_DETAIL_ROUTE' };
  const labelHasDiscount = hasLabelDiscount(label);
  const actionUrl = buildProductDetailRoute(product.id);
  if (!actionUrl || !isCustomerActionUrl(actionUrl) || actionUrl.startsWith('/personel')) {
    return { candidate: null, reason: 'INVALID_PRODUCT_DETAIL_ROUTE' };
  }

  const productName = normalizeText(label.productName || product.name) || 'Bu ürün';
  const barcode = normalizeText(label.barcode || product.barcode);
  const productDiagnostic = {
    productId: product.id,
    barcode: barcode || null,
    productName,
  };
  const productAisle = resolveProductAisle({ product, label, context });
  const displaySectionName = normalizeText(productAisle.displaySectionName || productAisle.sectionName) || 'Yakındaki Reyon';
  const productDedupeKey = buildProductDiscountDedupeKey({ userId, productId: product.id, barcode });
  if (!productDedupeKey) return { candidate: null, reason: 'INVALID_PRODUCT_DETAIL_ROUTE' };

  const { regularPrice, displayPrice, campaignPrice, effectivePrice } = resolveDiscountPrices(label);
  if (effectivePrice === null) {
    return {
      candidate: null,
      reason: 'NO_ACTIVE_DISCOUNT_FOR_LABEL_PRODUCT',
      productDiagnostic,
      dedupeKey: productDedupeKey,
    };
  }

  if (!labelHasDiscount && !(await hasActiveCampaignForProduct(product))) {
    return {
      candidate: null,
      reason: 'NO_ACTIVE_DISCOUNT_FOR_LABEL_PRODUCT',
      productDiagnostic,
      dedupeKey: productDedupeKey,
    };
  }

  const ruleConfig = await findCustomerProximityRuleConfig({ context, eventType });
  const rulePayload = isObject(ruleConfig?.payload) ? ruleConfig.payload : {};
  const productDedupeSeconds = resolveProductDedupeSeconds(rulePayload.productDedupeSeconds ?? rulePayload.testCooldownSeconds);
  return {
    candidate: {
      ruleId: ruleConfig?.id || `domain:proximity-product-discount:${beaconDevice.id}:${eslDeviceId}:${product.id}`,
      cooldownMinutes: Number(ruleConfig?.cooldownMinutes ?? DEFAULT_CUSTOMER_DOMAIN_COOLDOWN_MINUTES) || DEFAULT_CUSTOMER_DOMAIN_COOLDOWN_MINUTES,
      cooldownSeconds: rulePayload.cooldownSeconds ?? rulePayload.testCooldownSeconds ?? null,
      bypassCooldown: true,
      maxPerVisit: null,
      bypassMaxPerVisit: true,
      productDedupeKey,
      productDedupeSeconds,
      productDiagnostic,
      enforceNotificationDedupe: false,
      notification: {
        type: 'PROXIMITY_PRODUCT_DISCOUNT',
        title: displaySectionName,
        body: 'İlgini çekebilecek ürünler keşfettik.',
        severity: 'info',
        actionType: 'route',
        actionLabel: 'Ürüne Git',
        actionUrl,
        payload: {
          productId: product.id,
          barcode: barcode || null,
          productName,
          regularPrice,
          displayPrice,
          campaignPrice,
          campaignName: normalizeText(label.campaignName) || null,
          zoneId: context.locationZoneId,
          zoneCode: context.zoneCode,
          zoneName: context.zoneName,
          sectionId: productAisle.sectionId,
          sectionName: productAisle.sectionName,
          displaySectionName,
          nativeTitle: buildNativeProductDiscountTitle({ sectionName: displaySectionName }),
          nativeBody: 'İlgini çekebilecek ürünler keşfettik.',
          actionUrl,
          actionLabel: 'Ürüne Git',
          eslDeviceId,
          beaconDeviceId: context.beaconDeviceId,
          beaconDeviceCode: beaconDevice?.deviceCode || null,
        },
      },
    },
    reason: 'PRODUCT_DISCOUNT_NOTIFICATION_CREATED',
  };
};

const ruleSpecificityScore = (rule = {}, context = {}) => {
  const payload = isObject(rule.payload) ? rule.payload : {};
  if (rule.beaconDeviceId && rule.beaconDeviceId === context.beaconDeviceId) return 400;
  if (rule.locationZoneId && rule.locationZoneId === context.locationZoneId) return 300;
  if (payload.sectionId && payload.sectionId === context.sectionId) return 200;
  if (payload.categoryId && payload.categoryId === context.categoryId) return 150;
  const ruleTags = Array.isArray(payload.tags) ? payload.tags.map((tag) => normalizeLower(tag)) : [];
  if (ruleTags.length && ruleTags.some((tag) => context.tags.includes(tag))) return 120;
  if (!rule.beaconDeviceId && !rule.locationZoneId && !payload.sectionId && !payload.categoryId && !ruleTags.length) return 10;
  return 0;
};

const findMatchingGenericRules = async ({ targetType, eventType, context }) => {
  const prisma = await getPrisma();
  const rules = await prisma.notificationRule.findMany({
    where: {
      isActive: true,
      targetType: { equals: targetType, mode: 'insensitive' },
      trigger: { equals: normalizeUpper(eventType), mode: 'insensitive' },
      OR: [
        { beaconDeviceId: context.beaconDeviceId },
        { locationZoneId: context.locationZoneId },
        { beaconDeviceId: null, locationZoneId: null },
      ],
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });

  return rules
    .map((rule) => ({ rule, score: ruleSpecificityScore(rule, context) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || Number(right.rule.priority || 0) - Number(left.rule.priority || 0))
    .map((item) => item.rule);
};

const genericRuleToCandidate = (rule) => {
  const payload = isObject(rule.payload) ? rule.payload : {};
  const actionUrl = rule.actionUrl || payload.actionUrl || '/musteri';
  return {
    ruleId: rule.id,
    cooldownMinutes: Number(rule.cooldownMinutes ?? 30) || 30,
    cooldownSeconds: payload.cooldownSeconds ?? payload.testCooldownSeconds ?? null,
    maxPerVisit: rule.maxPerVisit ?? null,
    notification: {
      type: normalizeCustomerNotificationType(payload.notificationType || rule.type),
      title: rule.title,
      body: rule.body,
      severity: payload.severity || 'info',
      actionType: rule.actionType || payload.actionType || 'route',
      actionLabel: payload.actionLabel || 'Ä°ncele',
      actionUrl: isCustomerActionUrl(actionUrl) ? actionUrl : '/musteri',
      payload,
    },
  };
};

const evaluateCandidates = async ({ candidates, userId, userType, proximityEvent, beaconDevice, locationZone, context }) => {
  let lastReason = 'NO_MATCHING_RULE';
  for (const candidate of candidates) {
    const result = await deliverNotification({
      userId,
      userType,
      ruleId: candidate.ruleId,
      cooldownMinutes: candidate.cooldownMinutes,
      cooldownSeconds: candidate.cooldownSeconds,
      bypassCooldown: candidate.bypassCooldown === true,
      maxPerVisit: candidate.maxPerVisit,
      bypassMaxPerVisit: candidate.bypassMaxPerVisit === true,
      productDedupeKey: candidate.productDedupeKey || null,
      productDedupeReason: candidate.productDedupeReason || 'PRODUCT_DISCOUNT_ALREADY_NOTIFIED_12H',
      productDedupeSeconds: candidate.productDedupeSeconds ?? null,
      productDiagnostic: candidate.productDiagnostic || candidate.notification?.payload || null,
      enforceNotificationDedupe: candidate.enforceNotificationDedupe !== false,
      notification: candidate.notification,
      proximityEvent,
      beaconDevice,
      locationZone,
      context,
    });
    if (result.shouldNotify) return result;
    lastReason = result.reason || lastReason;
    if (result.reason) return result;
  }
  return { shouldNotify: false, reason: lastReason };
};

const buildCustomerCandidates = async ({ context }) => {
  const candidates = [];
  const campaign = await buildCustomerCampaignCandidate({ context });
  if (campaign) candidates.push(campaign);
  const category = await buildCustomerCategoryCandidate({ context });
  if (category) candidates.push(category);
  return candidates;
};

export const notificationRuleEngine = {
  async evaluate({ userId, userType, proximityEvent, beaconDevice, locationZone }) {
    const targetType = resolveTargetType(userType);
    if (targetType !== 'customer') {
      return { shouldNotify: false, reason: 'CUSTOMER_ONLY_FEATURE' };
    }
    const context = getContext({ proximityEvent, beaconDevice, locationZone });
    const productDiscount = await buildCustomerProductDiscountCandidate({
      userId,
      beaconDevice,
      context,
      eventType: proximityEvent.eventType,
    });
    if (!productDiscount.candidate) {
      await createSkippedDelivery({
        userId,
        proximityEvent,
        beaconDevice,
        locationZone,
        context,
        reason: productDiscount.reason,
        dedupeKey: productDiscount.dedupeKey || null,
      });
      return {
        shouldNotify: false,
        reason: productDiscount.reason,
        productId: productDiscount.productDiagnostic?.productId || null,
        barcode: productDiscount.productDiagnostic?.barcode || null,
        productName: productDiscount.productDiagnostic?.productName || null,
        dedupeKey: productDiscount.dedupeKey || null,
      };
    }

    const productDiscountResult = await evaluateCandidates({
      candidates: [productDiscount.candidate],
      userId,
      userType,
      proximityEvent,
      beaconDevice,
      locationZone,
      context,
    });
    if (productDiscountResult.shouldNotify) return productDiscountResult;
    return productDiscountResult;
  },
};
