import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { dataDefaults } from '../config/config.js';
import { eslDeviceRepo, eslHistoryRepo } from '../repositories/eslRepository.js';
import { stockRepo } from '../repositories/stockRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { resolveStoreScheduleStatus as resolveTimezoneAwareStoreScheduleStatus } from '../utils/storeSchedule.js';
import { applyCampaignPricingToProduct, listActiveCampaignDefinitions } from './campaignPricingService.js';
import { productService } from './productService.js';

const TEMPLATE_TYPES = ['standard', 'campaign', 'discount'];
const HEARTBEAT_TTL_MS = 1000 * 60 * 2;

const resolveDeviceStatus = (device) => {
  const explicitStatus = String(device.status || '').trim().toLowerCase();
  if (explicitStatus === 'offline') {
    return 'offline';
  }

  const heartbeatAt = device.lastHeartbeatAt || device.lastSeenAt || device.updatedAt || device.lastSyncAt || null;
  const heartbeatMs = heartbeatAt ? new Date(heartbeatAt).getTime() : 0;
  const hasValidHeartbeat = Boolean(heartbeatMs) && !Number.isNaN(heartbeatMs);
  if (!hasValidHeartbeat) {
    return 'offline';
  }

  if (Date.now() - heartbeatMs > HEARTBEAT_TTL_MS) {
    return 'offline';
  }

  return 'online';
};

const NON_REAL_PRICE_EVENT_SOURCES = new Set([
  'legacy_price_updated_at',
  'legacy',
  'import',
  'bulk_import',
  'bulk_update',
  'seed',
  'migration',
  'updated_at',
]);

const toIsoDateValue = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const normalizePriceEvent = (event = {}) => {
  const at = toIsoDateValue(event.createdAt || event.at || event.date || event.updatedAt || event.lastPriceUpdate);
  if (!at) return null;
  const salePrice = event.salePrice ?? event.price ?? event.currentPrice ?? event.newPrice;
  return {
    at,
    salePrice: salePrice === undefined || salePrice === null ? null : Number(salePrice),
    price: salePrice === undefined || salePrice === null ? null : Number(salePrice),
    previousSalePrice: event.previousSalePrice ?? event.previousPrice ?? null,
    source: String(event.source || '').trim().toLowerCase(),
  };
};

const resolveLastRealPriceChangeDate = (product = {}) => {
  const payload = product?.payload && typeof product.payload === 'object' ? product.payload : {};
  const rows = [
    ...(Array.isArray(product.priceEvents) ? product.priceEvents : []),
    ...(Array.isArray(product.priceHistory) ? product.priceHistory : []),
    ...(Array.isArray(payload.priceEvents) ? payload.priceEvents : []),
    ...(Array.isArray(payload.priceHistory) ? payload.priceHistory : []),
  ];
  const events = rows
    .map(normalizePriceEvent)
    .filter(Boolean)
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());

  if (!events.length) return '';

  let latestReal = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (NON_REAL_PRICE_EVENT_SOURCES.has(event.source)) continue;
    if (!Number.isFinite(Number(event.salePrice ?? event.price))) continue;
    const explicitPrevious = event.previousSalePrice;
    const previousFromHistory = index > 0 ? (events[index - 1].salePrice ?? events[index - 1].price) : null;
    const previous = explicitPrevious ?? previousFromHistory;
    if (!Number.isFinite(Number(previous))) continue;
    if (Math.round(Number(previous) * 100) !== Math.round(Number(event.salePrice ?? event.price) * 100)) {
      latestReal = event;
    }
  }

  const selected = latestReal
    || [...events].reverse().find((event) => !NON_REAL_PRICE_EVENT_SOURCES.has(event.source))
    || events[events.length - 1];
  return selected?.at ? String(selected.at).slice(0, 10) : '';
};

const resolvePreviousSalePrice = (product = {}) => {
  const payload = product?.payload && typeof product.payload === 'object' ? product.payload : {};
  const direct = Number(product.previousSalePrice ?? product.previousPrice ?? product.oldPrice ?? payload.previousSalePrice ?? payload.previousPrice);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const rows = [
    ...(Array.isArray(product.priceEvents) ? product.priceEvents : []),
    ...(Array.isArray(product.priceHistory) ? product.priceHistory : []),
    ...(Array.isArray(payload.priceEvents) ? payload.priceEvents : []),
    ...(Array.isArray(payload.priceHistory) ? payload.priceHistory : []),
  ];

  const currentPrice = Number(product.salePrice ?? product.currentPrice ?? product.price ?? 0);
  const events = rows
    .map(normalizePriceEvent)
    .filter(Boolean)
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());

  const explicit = events.find((event) => Number.isFinite(Number(event.previousSalePrice)) && Number(event.previousSalePrice) > 0)?.previousSalePrice;
  if (Number.isFinite(Number(explicit)) && Number(explicit) > 0) return Number(explicit);

  const previousFromHistory = events.find((event) => {
    const price = Number(event.salePrice ?? event.price);
    return Number.isFinite(price) && price > 0 && Math.round(price * 100) !== Math.round(currentPrice * 100);
  });
  if (previousFromHistory) return Number(previousFromHistory.salePrice ?? previousFromHistory.price);

  return Number.isFinite(currentPrice) && currentPrice > 0 ? Number((currentPrice * 1.15).toFixed(2)) : 0;
};

const normalizeDevice = (device) => ({
  ...device,
  status: resolveDeviceStatus(device),
  lastSeenAt: device.lastHeartbeatAt || device.lastSeenAt || device.lastSyncAt || null,
});

const toOptionalString = (value, maxLength = 120) => {
  const text = String(value || '').trim();
  return text ? text.slice(0, maxLength) : '';
};

const toOptionalNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const toPriceNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : fallback;
};

const formatEslPrice = (value) => toPriceNumber(value, 0).toFixed(2);

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const createScheduleHash = (payload = {}) => crypto
  .createHash('sha256')
  .update(stableStringify(payload))
  .digest('hex');

const createAssignmentHash = (payload = {}) => crypto
  .createHash('sha256')
  .update(stableStringify(payload))
  .digest('hex');

const normalizeBridgeLabel = (value = {}) => {
  const label = value && typeof value === 'object' ? value : {};
  const price = formatEslPrice(label.price ?? label.displayPrice ?? 0);
  const previousPriceValue = label.previousPrice === undefined || label.previousPrice === null || label.previousPrice === ''
    ? ''
    : formatEslPrice(label.previousPrice);

  return {
    deviceId: toOptionalString(label.deviceId, 120),
    productId: toOptionalString(label.productId || label.assignedProductId, 120),
    assignedProductId: toOptionalString(label.assignedProductId || label.productId, 120),
    template: toOptionalString(label.template || 'standard', 40) || 'standard',
    clearLabel: Boolean(label.clearLabel),
    productName: toOptionalString(label.productName || 'Ürün Seçilmedi', 240) || 'Ürün Seçilmedi',
    barcode: toOptionalString(label.barcode || '0000000000000', 80) || '0000000000000',
    price,
    regularPrice: toPriceNumber(label.regularPrice ?? price, 0),
    displayPrice: toPriceNumber(label.displayPrice ?? price, 0),
    campaignPrice: label.campaignPrice === null || label.campaignPrice === undefined ? null : toPriceNumber(label.campaignPrice, 0),
    hasActiveCampaign: Boolean(label.hasActiveCampaign),
    campaignName: toOptionalString(label.campaignName || '', 160),
    priceSource: toOptionalString(label.priceSource || '', 40),
    previousPrice: previousPriceValue,
    brand: toOptionalString(label.brand || '', 120),
    unit: toOptionalString(label.unit || '', 40),
    origin: toOptionalString(label.origin || 'Turkiye', 120) || 'Turkiye',
    expiryDate: toOptionalString(label.expiryDate || '', 40),
    lastPriceChangeDate: toOptionalString(label.lastPriceChangeDate || label.expiryDate || '', 40),
  };
};

const resolveEslLabelPricing = (product = {}, activeCampaigns = []) => {
  const regularPrice = toPriceNumber(product.salePrice ?? product.currentPrice ?? product.price ?? 0, 0);
  const pricedProduct = applyCampaignPricingToProduct(
    { ...product, salePrice: regularPrice },
    Array.isArray(activeCampaigns) ? activeCampaigns : [],
    { includeGeneralCampaigns: true }
  );

  const resolvedCampaignPrice = toPriceNumber(
    pricedProduct.campaignPrice ?? pricedProduct.discountedPrice ?? pricedProduct.currentPrice,
    0
  );
  const hasActiveCampaign = pricedProduct.hasActiveDiscount === true
    && resolvedCampaignPrice > 0
    && Math.round(resolvedCampaignPrice * 100) < Math.round(regularPrice * 100);
  const displayPrice = hasActiveCampaign ? resolvedCampaignPrice : regularPrice;
  const activeCampaign = hasActiveCampaign ? pricedProduct.activeCampaign || null : null;

  return {
    regularPrice,
    displayPrice,
    campaignPrice: hasActiveCampaign ? resolvedCampaignPrice : null,
    hasActiveCampaign,
    campaignName: activeCampaign?.customerTitle || activeCampaign?.publicName || activeCampaign?.displayName || activeCampaign?.name || '',
    activeCampaign,
    priceSource: hasActiveCampaign ? 'campaign' : 'regular',
  };
};

const resolveTemplateForEslPricing = (template, eslPricing = {}) => {
  const requestedTemplate = toOptionalString(template || 'standard', 40) || 'standard';
  return requestedTemplate;
};

const isPlaceholderBarcodeValue = (value) => {
  const barcode = toOptionalString(value, 80);
  return !barcode || barcode === '0000000000000';
};

const toTimeMs = (value) => {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

const resolveBridgeAssignedProductId = (device = {}, label = {}) => toOptionalString(
  device.bridgeAssignedProductId
  || device.bridgeAssignment?.assignedProductId
  || label.productId
  || label.assignedProductId,
  120
);

const shouldUseBridgeAssignedLabel = ({ device = {}, label = {}, assignedProduct = null }) => {
  if (!label || typeof label !== 'object') {
    return { useBridgeLabel: false, reason: 'missing_label' };
  }

  if (device.bridgeAssignedClearLabel === true || label.clearLabel === true) {
    return { useBridgeLabel: false, reason: 'bridge_clear_label' };
  }

  const assignedProductId = toOptionalString(device.assignedProductId, 120);
  if (!assignedProductId) {
    return { useBridgeLabel: false, reason: 'unassigned_device' };
  }

  const bridgeAssignedProductId = resolveBridgeAssignedProductId(device, label);
  if (assignedProductId && bridgeAssignedProductId && assignedProductId !== bridgeAssignedProductId) {
    return {
      useBridgeLabel: false,
      reason: 'assigned_product_mismatch',
      assignedProductId,
      bridgeAssignedProductId,
    };
  }

  const labelBarcode = toOptionalString(label.barcode, 80);
  const assignedBarcode = toOptionalString(assignedProduct?.barcode, 80);
  if (assignedProductId && assignedBarcode && !isPlaceholderBarcodeValue(labelBarcode) && labelBarcode !== assignedBarcode) {
    return {
      useBridgeLabel: false,
      reason: 'assigned_barcode_mismatch',
      assignedProductId,
      bridgeAssignedProductId,
      labelBarcode,
      assignedBarcode,
    };
  }

  const assignedChangedAt = toTimeMs(device.lastSyncAt);
  const bridgeSyncedAt = Math.max(
    toTimeMs(device.bridgeAssignmentSyncedAt),
    toTimeMs(device.bridgeAssignment?.updatedAt),
    toTimeMs(device.bridgeAssignment?.lastSyncAt)
  );
  if (assignedProductId && assignedChangedAt && bridgeSyncedAt && assignedChangedAt > bridgeSyncedAt) {
    return {
      useBridgeLabel: false,
      reason: 'assigned_newer_than_bridge_label',
      assignedProductId,
      bridgeAssignedProductId,
      assignedChangedAt: new Date(assignedChangedAt).toISOString(),
      bridgeSyncedAt: new Date(bridgeSyncedAt).toISOString(),
    };
  }

  return {
    useBridgeLabel: true,
    reason: 'bridge_label_current',
    assignedProductId,
    bridgeAssignedProductId,
  };
};

const buildResolvedLabelPayload = async ({ device, product = null, activeCampaigns = null }) => {
  const template = device?.template || 'standard';
  if (!device?.assignedProductId || !product) {
    return normalizeBridgeLabel({
      deviceId: device?.id || '',
      template,
      clearLabel: true,
      productName: 'Ürün Seçilmedi',
      barcode: '0000000000000',
      price: '0.00',
      previousPrice: '0.00',
      origin: 'Turkiye',
    });
  }

  const resolvedActiveCampaigns = Array.isArray(activeCampaigns) ? activeCampaigns : await listActiveCampaignDefinitions();
  const eslPricing = resolveEslLabelPricing(product, resolvedActiveCampaigns);
  const effectiveTemplate = resolveTemplateForEslPricing(template, eslPricing);
  const computedFdtDate = resolveLastRealPriceChangeDate(product);
  const fallbackStoredFdt = product.lastPriceChangeDate || product.lastPriceChangeAt || '';
  const fdtDate = computedFdtDate || (fallbackStoredFdt ? String(fallbackStoredFdt).slice(0, 10) : '');
  const previousDisplayPrice = eslPricing.hasActiveCampaign ? formatEslPrice(eslPricing.regularPrice) : '';

  return normalizeBridgeLabel({
    deviceId: device.id,
    productId: product.id,
    assignedProductId: product.id,
    template: effectiveTemplate,
    clearLabel: false,
    productName: product.name || 'Bilinmeyen Urun',
    barcode: product.barcode || '0000000000000',
    price: formatEslPrice(eslPricing.displayPrice),
    regularPrice: eslPricing.regularPrice,
    displayPrice: eslPricing.displayPrice,
    campaignPrice: eslPricing.campaignPrice,
    hasActiveCampaign: eslPricing.hasActiveCampaign,
    campaignName: eslPricing.campaignName,
    priceSource: eslPricing.priceSource,
    previousPrice: previousDisplayPrice,
    brand: product.brand || '',
    unit: product.unit || 'Adet',
    origin: product.origin || 'Turkiye',
    expiryDate: fdtDate,
    lastPriceChangeDate: fdtDate,
  });
};

const isDeletedDevice = (device) => Boolean(device?.isDeleted);

const TIME_RE = /^\d{2}:\d{2}$/;

const normalizeScheduleTime = (value, fallback) => (
  TIME_RE.test(String(value || '')) ? String(value) : fallback
);

const normalizeScheduleArray = (value) => (Array.isArray(value) ? value.map((item) => ({ ...(item || {}) })) : []);

const buildScheduleStatePayload = (settings = {}) => {
  const weeklySchedule = normalizeScheduleArray(settings.weeklySchedule);
  const specialDays = normalizeScheduleArray(settings.specialDays);
  const payload = {
    timezone: toOptionalString(settings.timezone || 'Europe/Istanbul', 80) || 'Europe/Istanbul',
    openingTime: normalizeScheduleTime(settings.openingTime, '10:00'),
    closingTime: normalizeScheduleTime(settings.closingTime, '22:00'),
    closedDays: Array.isArray(settings.closedDays) ? settings.closedDays.map((day) => String(day || '').trim()).filter(Boolean) : [],
    holidayMode: Boolean(settings.holidayMode),
    weeklySchedule,
    specialDays,
    updatedAt: toOptionalString(settings.updatedAt, 80),
  };

  return {
    ...payload,
    scheduleHash: createScheduleHash({
      timezone: payload.timezone,
      openingTime: payload.openingTime,
      closingTime: payload.closingTime,
      closedDays: payload.closedDays,
      holidayMode: payload.holidayMode,
      weeklySchedule: payload.weeklySchedule,
      specialDays: payload.specialDays,
    }),
  };
};

const normalizeIncomingScheduleState = (payload = {}) => {
  const source = payload.schedule && typeof payload.schedule === 'object' ? payload.schedule : payload;
  return buildScheduleStatePayload({
    timezone: source.timezone,
    openingTime: source.openingTime,
    closingTime: source.closingTime,
    closedDays: source.closedDays,
    holidayMode: source.holidayMode,
    weeklySchedule: source.weeklySchedule,
    specialDays: source.specialDays,
    updatedAt: source.updatedAt,
  });
};

const ensureSeedDevices = async () => {
  const current = await eslDeviceRepo.getAll();
  if (Array.isArray(current) && current.length > 0) {
    return current;
  }

  const defaults = Array.isArray(dataDefaults.eslDevices) ? dataDefaults.eslDevices : [];
  if (!defaults.length) {
    return [];
  }

  const restored = defaults.map((item) => ({
    ...item,
    isDeleted: false,
    deletedAt: null,
  }));
  await eslDeviceRepo.replaceAll(restored);
  return restored;
};

const getActiveDevices = async () => {
  const devices = await ensureSeedDevices();
  return devices.filter((device) => !isDeletedDevice(device));
};

const getResolvedProductById = async (productId) => {
  const id = String(productId || '').trim();
  if (!id) return null;
  try {
    return await productService.getById(id, { includeGeneralCampaigns: true });
  } catch (error) {
    if (error?.statusCode === 404 || error?.status === 404) return null;
    throw error;
  }
};

const enrichDevice = async (device, activeCampaigns = null) => {
  const normalized = normalizeDevice(device);

  if (!device.assignedProductId) {
    return { ...normalized, product: null };
  }

  const product = await getResolvedProductById(device.assignedProductId);
  if (!product) {
    return { ...normalized, product: null };
  }

  const stock = await stockRepo.findByProductId(product.id);
  const resolvedActiveCampaigns = Array.isArray(activeCampaigns) ? activeCampaigns : await listActiveCampaignDefinitions();
  const eslPricing = resolveEslLabelPricing(product, resolvedActiveCampaigns);

  return {
    ...normalized,
    product: {
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode || '',
      salePrice: eslPricing.regularPrice,
      regularPrice: eslPricing.regularPrice,
      displayPrice: eslPricing.displayPrice,
      campaignPrice: eslPricing.campaignPrice,
      hasActiveCampaign: eslPricing.hasActiveCampaign,
      campaignName: eslPricing.campaignName,
      priceSource: eslPricing.priceSource,
      unit: product.unit || 'Adet',
      origin: product.origin || '',
      expiryDate: product.skt || product.expiryDate || '',
      currentStock: stock?.quantity || 0,
    },
  };
};

export const eslService = {
  async listDevices() {
    const [devices, activeCampaigns] = await Promise.all([
      getActiveDevices(),
      listActiveCampaignDefinitions(),
    ]);
    const enriched = await Promise.all(devices.map((device) => enrichDevice(device, activeCampaigns)));
    return enriched;
  },

  async getDeviceById(id) {
    const device = await eslDeviceRepo.findById(id);
    if (!device || isDeletedDevice(device)) {
      throw createNotFoundError('ESL cihazı bulunamadı');
    }
    return enrichDevice(device);
  },

  async getCurrentLabel(deviceId) {
    console.log('[ESL DEBUG] getCurrentLabel deviceId:', deviceId);
    const device = await eslDeviceRepo.findById(deviceId);
    if (!device || isDeletedDevice(device)) {
      throw createNotFoundError('ESL cihazı bulunamadı');
    }

    // Cihaz endpoint'e eriştiyse heartbeat'i tazele
    const heartbeatNow = new Date().toISOString();
    const heartbeatedDevice = {
      ...device,
      status: 'online',
      lastHeartbeatAt: heartbeatNow,
      lastSeenAt: heartbeatNow,
      updatedAt: heartbeatNow,
    };
    await eslDeviceRepo.updateById(deviceId, heartbeatedDevice);

    const assignedProduct = heartbeatedDevice.assignedProductId
      ? await getResolvedProductById(heartbeatedDevice.assignedProductId)
      : null;

    if (heartbeatedDevice.bridgeAssignedLabel && typeof heartbeatedDevice.bridgeAssignedLabel === 'object') {
      const bridgeClearLabel = heartbeatedDevice.bridgeAssignedClearLabel
        ?? heartbeatedDevice.bridgeAssignedLabel.clearLabel
        ?? false;
      const cachedLabel = normalizeBridgeLabel({
        ...heartbeatedDevice.bridgeAssignedLabel,
        deviceId: heartbeatedDevice.id,
        template: heartbeatedDevice.bridgeAssignedTemplate || heartbeatedDevice.bridgeAssignedLabel.template || 'standard',
        clearLabel: bridgeClearLabel,
      });
      const bridgeDecision = shouldUseBridgeAssignedLabel({
        device,
        label: cachedLabel,
        assignedProduct,
      });
      if (bridgeDecision.useBridgeLabel) {
        const bridgeResult = {
          ...cachedLabel,
          currentLabelSource: 'bridgeAssignedLabel',
          assignedProductId: heartbeatedDevice.assignedProductId || cachedLabel.assignedProductId || null,
          bridgeAssignedProductId: resolveBridgeAssignedProductId(heartbeatedDevice, cachedLabel) || null,
          staleBridgeLabelIgnored: false,
        };
        console.log('[ESL DEBUG] getCurrentLabel bridge cache response:', JSON.stringify({
          deviceId: bridgeResult.deviceId,
          template: bridgeResult.template,
          clearLabel: bridgeResult.clearLabel,
          assignedProductId: bridgeResult.assignedProductId,
          bridgeAssignedProductId: bridgeResult.bridgeAssignedProductId,
          assignmentHash: heartbeatedDevice.bridgeAssignmentHash || heartbeatedDevice.bridgeAssignmentVersion || null,
        }));
        return bridgeResult;
      }

      console.warn('[ESL WARN] stale bridgeAssignedLabel ignored for current-label', {
        deviceId,
        reason: bridgeDecision.reason,
        assignedProductId: bridgeDecision.assignedProductId || heartbeatedDevice.assignedProductId || null,
        bridgeAssignedProductId: bridgeDecision.bridgeAssignedProductId || resolveBridgeAssignedProductId(heartbeatedDevice, cachedLabel) || null,
        labelProductId: cachedLabel.productId || cachedLabel.assignedProductId || null,
        labelBarcode: cachedLabel.barcode || null,
      });
    }

    console.log('[ESL DEBUG] assignedProductId:', heartbeatedDevice.assignedProductId, 'template:', heartbeatedDevice.template);
    if (!heartbeatedDevice.assignedProductId) {
      return {
        deviceId: heartbeatedDevice.id,
        template: heartbeatedDevice.template || 'standard',
        clearLabel: true,
        productName: 'Ürün Seçilmedi',
        barcode: '0000000000000',
        price: '0.00',
        previousPrice: '0.00',
        origin: 'Turkiye',
        expiryDate: '',
        currentLabelSource: 'unassigned',
        assignedProductId: null,
        bridgeAssignedProductId: resolveBridgeAssignedProductId(heartbeatedDevice, heartbeatedDevice.bridgeAssignedLabel || {}) || null,
        staleBridgeLabelIgnored: Boolean(heartbeatedDevice.bridgeAssignedLabel),
      };
    }

    if (!assignedProduct) {
      return {
        deviceId: heartbeatedDevice.id,
        template: heartbeatedDevice.template || 'standard',
        clearLabel: true,
        productName: 'Ürün Seçilmedi',
        barcode: '0000000000000',
        price: '0.00',
        previousPrice: '0.00',
        origin: 'Turkiye',
        expiryDate: '',
        currentLabelSource: 'assignedProductMissing',
        assignedProductId: heartbeatedDevice.assignedProductId || null,
        bridgeAssignedProductId: resolveBridgeAssignedProductId(heartbeatedDevice, heartbeatedDevice.bridgeAssignedLabel || {}) || null,
        staleBridgeLabelIgnored: Boolean(heartbeatedDevice.bridgeAssignedLabel),
      };
    }

    const product = assignedProduct;
    const computedFdtDate = resolveLastRealPriceChangeDate(product);
    const fallbackStoredFdt = product.lastPriceChangeDate || product.lastPriceChangeAt || '';
    const fdtDate = computedFdtDate || (fallbackStoredFdt ? String(fallbackStoredFdt).slice(0, 10) : '');
    const activeCampaigns = await listActiveCampaignDefinitions();
    const eslPricing = resolveEslLabelPricing(product, activeCampaigns);
    const previousDisplayPrice = eslPricing.regularPrice;
    const effectiveTemplate = resolveTemplateForEslPricing(heartbeatedDevice.template || 'standard', eslPricing);

    const result = {
      deviceId: heartbeatedDevice.id,
      productId: product.id,
      assignedProductId: product.id,
      bridgeAssignedProductId: resolveBridgeAssignedProductId(heartbeatedDevice, heartbeatedDevice.bridgeAssignedLabel || {}) || null,
      template: effectiveTemplate,
      clearLabel: false,
      productName: product.name || 'Bilinmeyen Urun',
      barcode: product.barcode || '0000000000000',
      price: formatEslPrice(eslPricing.displayPrice),
      regularPrice: eslPricing.regularPrice,
      displayPrice: eslPricing.displayPrice,
      campaignPrice: eslPricing.campaignPrice,
      hasActiveCampaign: eslPricing.hasActiveCampaign,
      campaignName: eslPricing.campaignName,
      priceSource: eslPricing.priceSource,
      previousPrice: eslPricing.hasActiveCampaign ? formatEslPrice(previousDisplayPrice) : '',
      origin: product.origin || 'Turkiye',
      expiryDate: fdtDate,
      lastPriceChangeDate: fdtDate,
      currentLabelSource: 'assignedProduct',
      staleBridgeLabelIgnored: Boolean(heartbeatedDevice.bridgeAssignedLabel),
    };
    console.log('[ESL DEBUG] getCurrentLabel response:', JSON.stringify(result));
    return result;
  },

  async getScheduleStatus(deviceId) {
    const device = await eslDeviceRepo.findById(deviceId);
    if (!device || isDeletedDevice(device)) {
      throw createNotFoundError('ESL cihazı bulunamadı');
    }

    const settings = await settingsRepo.getSettings();
    const status = resolveTimezoneAwareStoreScheduleStatus(settings, new Date());
    return {
      deviceId,
      isStoreOpen: status.isStoreOpen,
      dayKey: status.dayKey,
      openingTime: status.opensAt,
      closingTime: status.closesAt,
      holidayMode: Boolean(settings.holidayMode),
      timezone: status.timeZone,
      localDate: status.localDate,
      localTime: status.localTime,
      timestamp: new Date().toISOString(),
    };
  },

  async getScheduleState() {
    const settings = await settingsRepo.getSettings();
    return {
      ...buildScheduleStatePayload(settings),
      timestamp: new Date().toISOString(),
    };
  },

  async bridgeScheduleSync(payload = {}) {
    const current = await settingsRepo.getSettings();
    const scheduleState = normalizeIncomingScheduleState(payload);
    const incomingHash = toOptionalString(payload.scheduleHash || payload.schedule?.scheduleHash || scheduleState.scheduleHash, 128);
    const currentHash = current.bridgeScheduleHash || buildScheduleStatePayload(current).scheduleHash;
    if (incomingHash && currentHash === incomingHash) {
      return {
        synced: false,
        reason: 'unchanged',
        scheduleHash: incomingHash,
        bridgeScheduleSyncedAt: current.bridgeScheduleSyncedAt || null,
      };
    }

    const now = new Date().toISOString();
    const nextSettings = {
      ...current,
      timezone: scheduleState.timezone,
      openingTime: scheduleState.openingTime,
      closingTime: scheduleState.closingTime,
      closedDays: scheduleState.closedDays,
      holidayMode: scheduleState.holidayMode,
      weeklySchedule: scheduleState.weeklySchedule,
      specialDays: scheduleState.specialDays,
      bridgeScheduleSyncedAt: now,
      bridgeScheduleHash: scheduleState.scheduleHash,
      bridgeScheduleSourceUpdatedAt: scheduleState.updatedAt || null,
      updatedAt: now,
    };

    await settingsRepo.updateSettings(nextSettings);
    return {
      synced: true,
      scheduleHash: scheduleState.scheduleHash,
      bridgeScheduleSyncedAt: now,
      sourceUpdatedAt: scheduleState.updatedAt || null,
    };
  },

  async getHeartbeatState(deviceId) {
    const device = await eslDeviceRepo.findById(deviceId);
    if (!device || isDeletedDevice(device)) {
      throw createNotFoundError('ESL cihazı bulunamadı');
    }

    const heartbeatAt = device.lastHeartbeatAt || device.lastSeenAt || device.updatedAt || device.lastSyncAt || null;
    const heartbeatMs = heartbeatAt ? new Date(heartbeatAt).getTime() : 0;
    const ageSeconds = heartbeatMs && !Number.isNaN(heartbeatMs)
      ? Math.max(0, Math.round((Date.now() - heartbeatMs) / 1000))
      : null;

    return {
      deviceId: device.id,
      status: resolveDeviceStatus(device),
      lastHeartbeatAt: heartbeatAt,
      heartbeatAgeSeconds: ageSeconds,
      battery: device.batteryLevel ?? null,
      firmwareVersion: device.firmwareVersion || '',
      localIp: device.ipAddress || '',
      timestamp: new Date().toISOString(),
    };
  },

  async getAssignmentState(deviceId) {
    const device = await eslDeviceRepo.findById(deviceId);
    if (!device || isDeletedDevice(device)) {
      throw createNotFoundError('ESL cihazı bulunamadı');
    }

    const product = device.assignedProductId ? await getResolvedProductById(device.assignedProductId) : null;
    const label = await buildResolvedLabelPayload({ device, product });
    const assignmentInput = {
      deviceId: device.id,
      assignedProductId: device.assignedProductId || null,
      template: device.template || 'standard',
      lastSyncAt: device.lastSyncAt || null,
      updatedAt: device.updatedAt || null,
      clearLabel: label.clearLabel,
      label,
    };
    const assignmentHash = createAssignmentHash(assignmentInput);

    return {
      deviceId: device.id,
      assignedProductId: device.assignedProductId || null,
      template: device.template || 'standard',
      lastSyncAt: device.lastSyncAt || null,
      updatedAt: device.updatedAt || null,
      clearLabel: label.clearLabel,
      label,
      assignmentVersion: assignmentHash,
      assignmentHash,
      timestamp: new Date().toISOString(),
    };
  },

  async createDevice(payload) {
    const name = String(payload.name || '').trim();
    const macAddress = String(payload.macAddress || '').trim();
    const location = String(payload.location || '').trim();

    if (!name) throw new AppError(400, 'Cihaz adı gereklidir');
    if (!macAddress) throw new AppError(400, 'MAC adresi gereklidir');

    const existing = await eslDeviceRepo.findByMac(macAddress);
    if (existing && !isDeletedDevice(existing)) throw new AppError(409, 'Bu MAC adresi zaten kayıtlı');

    const now = new Date().toISOString();

    if (existing && isDeletedDevice(existing)) {
      const revivedDevice = {
        ...existing,
        name,
        macAddress,
        model: String(payload.model || existing.model || 'ESP32 Lite 2.9"').trim(),
        firmwareVersion: String(payload.firmwareVersion || existing.firmwareVersion || '1.0.0').trim(),
        batteryLevel: Math.min(100, Math.max(0, Number(payload.batteryLevel) || existing.batteryLevel || 100)),
        status: 'online',
        assignedProductId: null,
        template: null,
        lastSyncAt: null,
        location,
        ipAddress: String(payload.ipAddress || '').trim(),
        isDeleted: false,
        deletedAt: null,
        updatedAt: now,
      };
      await eslDeviceRepo.updateById(existing.id, revivedDevice);
      return enrichDevice(revivedDevice);
    }

    const device = {
      id: uuidv4(),
      name,
      macAddress,
      model: String(payload.model || 'ESP32 Lite 2.9"').trim(),
      firmwareVersion: String(payload.firmwareVersion || '1.0.0').trim(),
      batteryLevel: Math.min(100, Math.max(0, Number(payload.batteryLevel) || 100)),
      status: 'online',
      assignedProductId: null,
      lastSyncAt: null,
      location,
      ipAddress: String(payload.ipAddress || '').trim(),
      isDeleted: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await eslDeviceRepo.create(device);
    return enrichDevice(device);
  },

  async updateDevice(id, payload) {
    const device = await eslDeviceRepo.findById(id);
    if (!device || isDeletedDevice(device)) throw createNotFoundError('ESL cihazı bulunamadı');

    const updated = {
      ...device,
      name: String(payload.name || device.name).trim(),
      location: String(payload.location || device.location).trim(),
      status: payload.status || device.status,
      batteryLevel: payload.batteryLevel != null ? Math.min(100, Math.max(0, Number(payload.batteryLevel))) : device.batteryLevel,
      updatedAt: new Date().toISOString(),
    };

    await eslDeviceRepo.updateById(id, updated);
    return enrichDevice(updated);
  },

  async deleteDevice(id) {
    const device = await eslDeviceRepo.findById(id);
    if (!device || isDeletedDevice(device)) throw createNotFoundError('ESL cihazı bulunamadı');
    const now = new Date().toISOString();
    const softDeleted = {
      ...device,
      isDeleted: true,
      deletedAt: now,
      assignedProductId: null,
      template: null,
      updatedAt: now,
    };
    await eslDeviceRepo.updateById(id, softDeleted);
    return softDeleted;
  },

  async sendToDevice(payload, actorUser = null) {
    console.log('[ESL DEBUG] sendToDevice payload:', payload);
    const { deviceId, productId, template, customFields } = payload;

    if (!deviceId) throw new AppError(400, 'Cihaz seçimi gereklidir');
    if (!productId) throw new AppError(400, 'Ürün seçimi gereklidir');
    if (!template) throw new AppError(400, 'Şablon seçimi gereklidir');

    if (!TEMPLATE_TYPES.includes(template)) {
      throw new AppError(400, 'Geçersiz şablon tipi');
    }

    const device = await eslDeviceRepo.findById(deviceId);
    if (!device || isDeletedDevice(device)) throw createNotFoundError('ESL cihazı bulunamadı');

    const product = await getResolvedProductById(productId);
    if (!product) throw createNotFoundError('Ürün bulunamadı');

    const activeCampaigns = await listActiveCampaignDefinitions();
    const eslPricing = resolveEslLabelPricing(product, activeCampaigns);
    const effectiveTemplate = resolveTemplateForEslPricing(template, eslPricing);

    const now = new Date().toISOString();
    const actorId = String(actorUser?.id || payload.actorId || payload.userId || '').trim();
    const actorName = String(actorUser?.name || actorUser?.username || payload.actorName || payload.userName || '').trim();
    const nextAssignmentDevice = {
      ...device,
      assignedProductId: productId,
      template: effectiveTemplate,
      lastSyncAt: now,
      updatedAt: now,
    };
    const label = await buildResolvedLabelPayload({
      device: nextAssignmentDevice,
      product,
      activeCampaigns,
    });
    const assignmentInput = {
      deviceId,
      assignedProductId: productId,
      template: effectiveTemplate,
      lastSyncAt: now,
      updatedAt: now,
      clearLabel: false,
      label,
    };
    const assignmentHash = createAssignmentHash(assignmentInput);

    // Update device assignment
    const updatedDevice = {
      ...nextAssignmentDevice,
      bridgeAssignmentSyncedAt: now,
      bridgeReportedAt: now,
      bridgeAssignmentVersion: assignmentHash,
      bridgeAssignmentHash: assignmentHash,
      bridgeAssignment: {
        deviceId,
        assignedProductId: productId,
        template: effectiveTemplate,
        lastSyncAt: now,
        updatedAt: now,
        clearLabel: false,
      },
      bridgeAssignedProductId: productId,
      bridgeAssignedTemplate: effectiveTemplate,
      bridgeAssignedClearLabel: false,
      bridgeAssignedLabel: label,
      lastSyncAt: now,
      updatedAt: now,
    };
    await eslDeviceRepo.updateById(deviceId, updatedDevice);

    // Persist sonrası doşrulama
    const verifyDevice = await eslDeviceRepo.findById(deviceId);
    console.log('[ESL DEBUG] sendToDevice persist doşrulama:', {
      deviceId,
      assignedProductId: verifyDevice?.assignedProductId,
      template: verifyDevice?.template,
      persisted: verifyDevice?.assignedProductId === productId,
    });

    // Record history
    const historyEntry = {
      id: uuidv4(),
      deviceId,
      deviceName: device.name,
      productId,
      productName: product.name,
      productSku: product.sku,
      productBarcode: product.barcode || '',
      salePrice: eslPricing.displayPrice,
      regularPrice: eslPricing.regularPrice,
      displayPrice: eslPricing.displayPrice,
      campaignPrice: eslPricing.campaignPrice,
      hasActiveCampaign: eslPricing.hasActiveCampaign,
      priceSource: eslPricing.priceSource,
      template: effectiveTemplate,
      customFields: {
        ...(customFields || {}),
        regularPrice: eslPricing.regularPrice,
        displayPrice: eslPricing.displayPrice,
        campaignPrice: eslPricing.campaignPrice,
        hasActiveCampaign: eslPricing.hasActiveCampaign,
        campaignName: eslPricing.campaignName,
        priceSource: eslPricing.priceSource,
        ...(actorId ? { actorId } : {}),
        ...(actorName ? { actorName } : {}),
      },
      status: 'success',
      syncDuration: 0,
      payload: {
        regularPrice: eslPricing.regularPrice,
        displayPrice: eslPricing.displayPrice,
        campaignPrice: eslPricing.campaignPrice,
        hasActiveCampaign: eslPricing.hasActiveCampaign,
        campaignName: eslPricing.campaignName,
        priceSource: eslPricing.priceSource,
        actorId: actorId || null,
        actorName: actorName || null,
      },
      createdAt: now,
    };

    await eslHistoryRepo.create(historyEntry);
    console.log('[ESL DEBUG] sendToDevice tamamlandı:', { assignedProductId: updatedDevice.assignedProductId, template: updatedDevice.template, historyId: historyEntry.id });

    return {
      device: await enrichDevice(updatedDevice, activeCampaigns),
      history: historyEntry,
      message: `"${product.name}" etiketi "${device.name}" cihazına başarıyla gönderildi.`,
    };
  },

  async clearLabel(deviceId) {
    const device = await eslDeviceRepo.findById(deviceId);
    if (!device || isDeletedDevice(device)) throw createNotFoundError('ESL cihazı bulunamadı');

    const now = new Date().toISOString();
    const clearLabelPayload = await buildResolvedLabelPayload({
      device: { ...device, assignedProductId: null, template: null },
      product: null,
    });
    const assignmentHash = createAssignmentHash({
      deviceId,
      assignedProductId: null,
      template: null,
      lastSyncAt: now,
      updatedAt: now,
      clearLabel: true,
      label: clearLabelPayload,
    });
    const updated = {
      ...device,
      assignedProductId: null,
      template: null,
      bridgeAssignmentSyncedAt: now,
      bridgeReportedAt: now,
      bridgeAssignmentVersion: assignmentHash,
      bridgeAssignmentHash: assignmentHash,
      bridgeAssignment: {
        deviceId,
        assignedProductId: null,
        template: null,
        lastSyncAt: now,
        updatedAt: now,
        clearLabel: true,
      },
      bridgeAssignedProductId: null,
      bridgeAssignedTemplate: null,
      bridgeAssignedClearLabel: true,
      bridgeAssignedLabel: clearLabelPayload,
      lastSyncAt: now,
      updatedAt: now,
    };

    await eslDeviceRepo.updateById(deviceId, updated);
    return {
      device: await enrichDevice(updated),
      message: device.assignedProductId
        ? `"${device.name}" cihazının etiketi başarıyla temizlendi.`
        : `"${device.name}" cihazında temizlenecek etiket yoktu; önizleme sıfırlandı.`,
    };
  },

  async syncCampaignLabels({ actorUser = null } = {}) {
    const [devices, activeCampaigns] = await Promise.all([
      getActiveDevices(),
      listActiveCampaignDefinitions(),
    ]);
    const assignedDevices = devices.filter((device) => device.assignedProductId && !isDeletedDevice(device));
    const now = new Date().toISOString();
    const actorId = String(actorUser?.id || '').trim();
    const actorName = String(actorUser?.name || actorUser?.username || '').trim();
    const results = [];

    for (const device of assignedDevices) {
      const product = await getResolvedProductById(device.assignedProductId);
      if (!product) continue;
      const eslPricing = resolveEslLabelPricing(product, activeCampaigns);
      if (!eslPricing.hasActiveCampaign) continue;

      const status = resolveDeviceStatus(device) === 'online' ? 'success' : 'queued';
      const historyEntry = {
        id: uuidv4(),
        deviceId: device.id,
        deviceName: device.name,
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        productBarcode: product.barcode || '',
        salePrice: eslPricing.displayPrice,
        regularPrice: eslPricing.regularPrice,
        displayPrice: eslPricing.displayPrice,
        campaignPrice: eslPricing.campaignPrice,
        hasActiveCampaign: eslPricing.hasActiveCampaign,
        priceSource: eslPricing.priceSource,
        template: resolveTemplateForEslPricing(device.template || 'standard', eslPricing),
        customFields: {
          campaignId: eslPricing.activeCampaign?.id || null,
          campaignName: eslPricing.campaignName,
          originalPrice: eslPricing.regularPrice,
          regularPrice: eslPricing.regularPrice,
          displayPrice: eslPricing.displayPrice,
          campaignPrice: eslPricing.campaignPrice,
          hasActiveCampaign: eslPricing.hasActiveCampaign,
          effectiveDiscountRate: eslPricing.activeCampaign?.effectiveDiscountRate || 0,
          priceSource: eslPricing.priceSource,
          syncReason: 'campaign_changed',
          ...(actorId ? { actorId } : {}),
          ...(actorName ? { actorName } : {}),
        },
        status,
        payload: {
          syncReason: 'campaign_changed',
          queued: status === 'queued',
          regularPrice: eslPricing.regularPrice,
          displayPrice: eslPricing.displayPrice,
          campaignPrice: eslPricing.campaignPrice,
          hasActiveCampaign: eslPricing.hasActiveCampaign,
          campaignName: eslPricing.campaignName,
          priceSource: eslPricing.priceSource,
          actorId: actorId || null,
          actorName: actorName || null,
        },
        createdAt: now,
      };

      if (status === 'success') {
        await eslDeviceRepo.updateById(device.id, {
          ...device,
          template: resolveTemplateForEslPricing(device.template || 'standard', eslPricing),
          lastSyncAt: now,
          updatedAt: now,
        });
      }

      await eslHistoryRepo.create(historyEntry);
      results.push(historyEntry);
    }

    return {
      synced: results.filter((item) => item.status === 'success').length,
      queued: results.filter((item) => item.status === 'queued').length,
      total: results.length,
    };
  },

  async updateBattery(deviceId, payload) {
    const device = await eslDeviceRepo.findById(deviceId);
    if (!device || isDeletedDevice(device)) throw createNotFoundError('ESL cihazı bulunamadı');

    const battery = Math.min(100, Math.max(0, Math.round(Number(payload.battery))));
    if (isNaN(battery)) throw new AppError(400, 'Geçerli bir batarya değeri gereklidir');

    const updated = {
      ...device,
      batteryLevel: battery,
      status: 'online',
      lastHeartbeatAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await eslDeviceRepo.updateById(deviceId, updated);
    return { deviceId, batteryLevel: battery };
  },

  async updateHeartbeat(deviceId, payload = {}) {
    const device = await eslDeviceRepo.findById(deviceId);
    if (!device || isDeletedDevice(device)) throw createNotFoundError('ESL cihazı bulunamadı');

    const now = new Date().toISOString();
    const battery = toOptionalNumber(payload.battery);
    const signal = toOptionalNumber(payload.signal);
    const firmwareVersion = toOptionalString(payload.firmwareVersion || device.firmwareVersion);
    const localIp = toOptionalString(payload.localIp || device.ipAddress, 80);
    const bridgeTimestamp = toOptionalString(payload.timestamp, 80);

    const updated = {
      ...device,
      ...(battery !== null ? { batteryLevel: Math.min(100, Math.max(0, Math.round(battery))) } : {}),
      ...(firmwareVersion ? { firmwareVersion } : {}),
      ...(localIp ? { ipAddress: localIp } : {}),
      status: 'online',
      lastHeartbeatAt: now,
      lastSeenAt: now,
      bridgeHeartbeatAt: now,
      ...(bridgeTimestamp ? { bridgeReportedAt: bridgeTimestamp } : {}),
      ...(signal !== null ? { signal } : {}),
      updatedAt: now,
    };

    await eslDeviceRepo.updateById(deviceId, updated);
    return {
      deviceId,
      status: 'online',
      lastHeartbeatAt: now,
      batteryLevel: updated.batteryLevel ?? null,
    };
  },

  async bridgeLabelSync(deviceId, payload = {}) {
    const device = await eslDeviceRepo.findById(deviceId);
    if (!device || isDeletedDevice(device)) throw createNotFoundError('ESL cihazı bulunamadı');

    const incomingDeviceId = toOptionalString(payload.deviceId || deviceId, 120);
    if (incomingDeviceId && incomingDeviceId !== deviceId) {
      throw new AppError(400, 'Cihaz kimliği route ile eşleşmiyor');
    }

    const label = normalizeBridgeLabel({
      ...(payload.label || payload.bridgeAssignedLabel || {}),
      deviceId,
      template: payload.template || payload.label?.template || 'standard',
      clearLabel: payload.clearLabel ?? payload.label?.clearLabel,
    });
    const assignmentHash = toOptionalString(payload.assignmentHash || payload.assignmentVersion, 128)
      || createAssignmentHash({
        deviceId,
        assignedProductId: payload.assignedProductId || null,
        template: payload.template || label.template,
        lastSyncAt: payload.lastSyncAt || null,
        updatedAt: payload.updatedAt || null,
        clearLabel: label.clearLabel,
        label,
      });

    const currentHash = device.bridgeAssignmentHash || device.bridgeAssignmentVersion || '';
    if (currentHash && currentHash === assignmentHash) {
      return {
        deviceId,
        synced: false,
        reason: 'unchanged',
        assignmentHash,
        bridgeAssignmentSyncedAt: device.bridgeAssignmentSyncedAt || null,
      };
    }

    const now = new Date().toISOString();
    const updated = {
      ...device,
      bridgeAssignmentSyncedAt: now,
      bridgeAssignmentVersion: assignmentHash,
      bridgeAssignmentHash: assignmentHash,
      bridgeAssignment: {
        deviceId,
        assignedProductId: payload.assignedProductId || null,
        template: payload.template || label.template,
        lastSyncAt: payload.lastSyncAt || null,
        updatedAt: payload.updatedAt || null,
        clearLabel: label.clearLabel,
      },
      bridgeAssignedProductId: payload.assignedProductId || null,
      bridgeAssignedTemplate: payload.template || label.template,
      bridgeAssignedClearLabel: label.clearLabel,
      bridgeAssignedLabel: label,
    };

    await eslDeviceRepo.updateById(deviceId, updated);
    return {
      deviceId,
      synced: true,
      assignmentHash,
      bridgeAssignmentSyncedAt: now,
      clearLabel: label.clearLabel,
    };
  },

  async listHistory(query = {}) {
    const history = await eslHistoryRepo.getAll();
    const page = Math.max(1, Number.parseInt(String(query.page || '1'), 10) || 1);

    const filtered = history.filter((entry) => {
      const matchesDevice = !query.deviceId || entry.deviceId === query.deviceId;
      const matchesProduct = !query.productId || entry.productId === query.productId;
      return matchesDevice && matchesProduct;
    });

    const sorted = [...filtered].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const hasLimit = query.limit !== undefined && query.limit !== null && query.limit !== '';
    const limit = hasLimit
      ? Math.min(100, Math.max(1, Number.parseInt(String(query.limit), 10) || 100))
      : Math.max(1, sorted.length || 1);
    const offset = (page - 1) * limit;
    const items = sorted.slice(offset, offset + limit);

    return {
      items,
      pagination: {
        mode: 'offset',
        page,
        limit,
        total: sorted.length,
        totalPages: Math.max(1, Math.ceil(sorted.length / limit)),
        hasNextPage: offset + items.length < sorted.length,
      },
    };
  },

  async clearHistory() {
    await eslHistoryRepo.clearAll();
    return { message: 'Güncelleme geçmişi temizlendi' };
  },

  async getStats() {
    const [devices, history] = await Promise.all([
      getActiveDevices(),
      eslHistoryRepo.getAll(),
    ]);

    const normalizedDevices = devices.map(normalizeDevice);

    const onlineCount = normalizedDevices.filter((d) => d.status === 'online').length;
    const offlineCount = normalizedDevices.filter((d) => d.status === 'offline').length;
    const assignedCount = normalizedDevices.filter((d) => d.assignedProductId).length;
    const totalUpdates = history.length;

    return {
      totalDevices: normalizedDevices.length,
      onlineCount,
      offlineCount,
      assignedCount,
      unassignedCount: normalizedDevices.length - assignedCount,
      totalUpdates,
    };
  },
};

