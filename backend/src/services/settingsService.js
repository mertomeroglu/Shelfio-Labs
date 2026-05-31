import { settingsRepo } from '../repositories/settingsRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { loginActivityRepo } from '../repositories/loginActivityRepository.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { sanitizeSettingsInput, validateSettingsPayload } from '../utils/validators.js';
import { AppError } from '../utils/appError.js';
import { logisticsTariffService } from './logisticsTariffService.js';
import { eslService } from './eslService.js';
import { applyCampaignPricingToProduct, listActiveCampaignDefinitions } from './campaignPricingService.js';
import { clearPricingAnalysisCache } from './analysis/pricingAnalysisService.js';
import { auditLogService } from './auditLogService.js';

const DEFAULT_DESK_PINS = {
  B1: '1234',
  B2: '1234',
  B3: '1234',
  B4: '1234',
  B5: '1234',
  B6: '1234',
  B7: '1234',
  B8: '1234',
};

const VALID_DESKS = new Set(Object.keys(DEFAULT_DESK_PINS));

const normalizePin = (value) => String(value || '').trim();

const MAX_AUDIT_LOGS = 500;
const MAX_LOGIN_ACTIVITIES = 200;
const MAX_LOGIN_ACTIVITY_QUERY_LIMIT = 1000;
const MAX_DEVELOPER_LOGS = 3000;
const DEVELOPER_LOG_DUPLICATE_WINDOW_MS = 60 * 1000;
const UTF8_BOM = '\uFEFF';

const safeObject = (value) => (value && typeof value === 'object' ? value : {});

const SENSITIVE_KEY_PATTERN = /(password|pass|token|secret|authorization|cookie|pin|code|license)/i;

const parseDateBoundary = (value, suffix = 'T00:00:00.000Z') => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const date = new Date(`${normalized}${suffix}`);
  return Number.isFinite(date.getTime()) ? date : null;
};

const normalizeListLimit = (value, fallback, max) => Math.min(max, Math.max(1, Number(value) || fallback));

const truncateString = (value, maxLength = 4000) => {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...(truncated)` : text;
};

const tryParseJsonString = (value) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || !/^[{\[]/.test(text)) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
};

const normalizeStructuredLogValue = (value) => {
  const parsed = tryParseJsonString(value);
  return maskSensitiveData(parsed);
};

const extractReadableLogMessage = (value) => {
  const parsed = tryParseJsonString(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const candidates = [
      parsed.message,
      parsed.error,
      parsed.detail,
      parsed.details,
      parsed.title,
      parsed.reason,
    ];
    const resolved = candidates.find((item) => String(item || '').trim());
    if (resolved) {
      return truncateString(resolved, 1200);
    }
  }
  return truncateString(typeof parsed === 'string' ? parsed : JSON.stringify(parsed), 1200);
};

const maskSensitiveData = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[max-depth]';

  if (typeof value === 'string') {
    return truncateString(value, 4000);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => maskSensitiveData(item, depth + 1));
  }

  const masked = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      masked[key] = '***';
      return;
    }
    masked[key] = maskSensitiveData(raw, depth + 1);
  });
  return masked;
};

const normalizeDeveloperLevel = (value) => {
  const level = String(value || '').trim().toLowerCase();
  if (['error', 'warning', 'info'].includes(level)) return level;
  return 'error';
};

const normalizeDeveloperSource = (value) => {
  const source = String(value || '').trim().toLowerCase();
  if (['frontend', 'backend', 'api'].includes(source)) return source;
  return 'backend';
};

const pickChangedKeys = (previous = {}, next = {}) => {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changed = [];

  keys.forEach((key) => {
    if (['updatedAt', 'auditLogs', 'loginActivities'].includes(key)) return;
    const before = JSON.stringify(previous[key]);
    const after = JSON.stringify(next[key]);
    if (before !== after) changed.push(key);
  });

  return changed;
};

const appendAuditLog = (settings, entry) => {
  const current = Array.isArray(settings.auditLogs) ? settings.auditLogs : [];
  const next = [entry, ...current].slice(0, MAX_AUDIT_LOGS);
  return next;
};

const appendLoginActivity = (settings, entry) => {
  const current = Array.isArray(settings.loginActivities) ? settings.loginActivities : [];
  const next = [entry, ...current].slice(0, MAX_LOGIN_ACTIVITIES);
  return next;
};

const parseLoginUserAgent = (value = '') => {
  const ua = String(value || '').toLowerCase();
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

const normalizeLoginSource = (value, userType = 'staff') => {
  const source = String(value || '').trim().toLowerCase();
  if (['admin_web', 'personnel_mobile', 'customer_mobile'].includes(source)) return source;
  return userType === 'customer' ? 'customer_mobile' : 'admin_web';
};

const normalizeLoginStatus = (eventType = '') => (
  String(eventType).includes('failed') ? 'failed' : 'success'
);

const normalizeLegacyLoginActivity = (row = {}) => {
  const parsed = parseLoginUserAgent(row.userAgent || row.browserInfo || row.device || '');
  return {
    ...row,
    id: String(row.id || `legacy-login-${row.at || Date.now()}`),
    userType: row.userType || 'staff',
    name: row.name || row.userName || row.username || null,
    userName: row.userName || row.name || row.username || null,
    email: row.email || null,
    role: row.role || null,
    department: row.department || null,
    eventType: row.eventType || 'login_success',
    source: row.source || 'admin_web',
    status: row.status || 'success',
    ip: row.ip || row.ipAddress || null,
    ipAddress: row.ipAddress || row.ip || null,
    browser: row.browser || parsed.browser,
    os: row.os || parsed.os,
    requestId: row.requestId || null,
    failureReason: row.failureReason || null,
    createdAt: row.createdAt || row.at || row.loginAt || row.timestamp || null,
    at: row.at || row.createdAt || row.loginAt || row.timestamp || null,
    isLegacy: true,
  };
};

const appendDeveloperLog = (settings, entry) => {
  const current = Array.isArray(settings.developerLogs) ? settings.developerLogs : [];
  const entrySignature = [
    entry.level,
    entry.source,
    entry.message,
    entry.endpoint,
    entry.stack,
  ].map((value) => String(value || '').trim()).join('|');
  const nowMs = new Date(entry.timestamp || Date.now()).getTime();
  const duplicateIndex = current.findIndex((item) => {
    const itemSignature = [
      item.level,
      item.source,
      item.message,
      item.endpoint,
      item.stack,
    ].map((value) => String(value || '').trim()).join('|');
    const itemMs = new Date(item.timestamp || 0).getTime();
    return itemSignature === entrySignature
      && Number.isFinite(itemMs)
      && Number.isFinite(nowMs)
      && nowMs - itemMs <= DEVELOPER_LOG_DUPLICATE_WINDOW_MS;
  });

  if (duplicateIndex >= 0) {
    const duplicate = current[duplicateIndex];
    const merged = {
      ...duplicate,
      timestamp: entry.timestamp,
      lastOccurredAt: entry.timestamp,
      repeatCount: Number(duplicate.repeatCount || 1) + 1,
      requestId: entry.requestId || duplicate.requestId,
      correlationId: entry.correlationId || duplicate.correlationId,
    };
    return [merged, ...current.filter((_, index) => index !== duplicateIndex)].slice(0, MAX_DEVELOPER_LOGS);
  }

  return [entry, ...current].slice(0, MAX_DEVELOPER_LOGS);
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    const numeric = value.toNumber();
    return Number.isFinite(numeric) ? numeric : null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const pricesEqual = (left, right) => {
  const a = toNumber(left);
  const b = toNumber(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.round(a * 100) === Math.round(b * 100);
};

const dateOnlyFromIso = (value) => {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
};

const getEffectiveCampaignPrice = (product, campaigns) => {
  const pricedProduct = applyCampaignPricingToProduct(product, campaigns, { includeGeneralCampaigns: true });
  const basePrice = toNumber(product?.salePrice ?? product?.price ?? product?.currentPrice) || 0;
  const effectivePrice = toNumber(pricedProduct?.campaignPrice ?? pricedProduct?.discountedPrice ?? pricedProduct?.currentPrice ?? basePrice) || basePrice;
  return { pricedProduct, effectivePrice };
};

const buildCampaignPriceEvent = ({ product, previousPrice, nextPrice, pricedProduct, transition, actorId, actorName }) => {
  const at = new Date().toISOString();
  const productId = String(product?.id || '').trim();
  const activeCampaign = pricedProduct?.activeCampaign || pricedProduct?.appliedCampaign || null;
  const campaignId = activeCampaign?.id || pricedProduct?.activeCampaignId || null;
  const id = `campaign-price-${productId}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const previous = toNumber(previousPrice);
  const next = toNumber(nextPrice);
  const changeDirection = next > previous ? 'increase' : next < previous ? 'decrease' : 'stable';
  const source = transition === 'restore' ? 'campaign_price_restored' : 'campaign_price_applied';
  const changePercent = Number.isFinite(previous) && previous > 0
    ? Number((((next - previous) / previous) * 100).toFixed(2))
    : 0;

  return {
    id,
    priceEventId: id,
    productId,
    sku: product?.sku || null,
    previousSalePrice: previous,
    previousPrice: previous,
    salePrice: next,
    price: next,
    newPrice: next,
    source,
    at,
    eventDate: at,
    date: at,
    currency: 'TRY',
    changeDirection,
    changePercent,
    isSyntheticHistory: false,
    createdAt: at,
    payload: {
      priceEventId: id,
      productId,
      sku: product?.sku || null,
      eventDate: at,
      previousPrice: previous,
      newPrice: next,
      changeDirection,
      changePercent,
      currency: 'TRY',
      source,
      campaignId,
      campaignName: activeCampaign?.name || activeCampaign?.publicName || activeCampaign?.displayName || pricedProduct?.activeCampaignName || '',
      transition,
      actorId,
      actorName,
    },
  };
};

const loadCampaignPriceProducts = async () => {
  if (config.dataStore === 'postgres') {
    const prisma = await getPrisma();
    return prisma.product.findMany({
      include: { priceEvents: true },
      where: {
        isActive: { not: false },
        isListed: { not: false },
      },
    });
  }
  return productRepo.getAll();
};

const persistCampaignPriceEvent = async ({ product, event }) => {
  const payload = product?.payload && typeof product.payload === 'object' ? product.payload : {};
  const existingHistory = Array.isArray(product?.priceHistory)
    ? product.priceHistory
    : (Array.isArray(payload.priceHistory) ? payload.priceHistory : []);
  const nextHistory = [...existingHistory, event];
  const nextPayload = { ...payload, priceHistory: nextHistory };
  const atDate = new Date(event.at);
  const lastPriceChangeDate = dateOnlyFromIso(event.at);

  if (config.dataStore === 'postgres') {
    const prisma = await getPrisma();
    await prisma.product.update({
      where: { id: product.id },
      data: {
        payload: nextPayload,
        priceUpdatedAt: atDate,
        lastPriceChangeDate: lastPriceChangeDate ? new Date(`${lastPriceChangeDate}T00:00:00.000Z`) : atDate,
        lastPriceChangeAt: atDate,
        lastPriceChangeSource: event.source,
      },
    });
    await prisma.productPriceEvent.create({
      data: {
        id: event.id,
        productId: product.id,
        previousSalePrice: event.previousSalePrice,
        salePrice: event.salePrice,
        source: event.source,
        payload: event.payload,
        createdAt: atDate,
      },
    });
    return;
  }

  await productRepo.updateById(product.id, {
    ...product,
    payload: nextPayload,
    priceHistory: nextHistory,
    priceUpdatedAt: event.at,
    lastPriceChangeDate,
    lastPriceChangeAt: event.at,
    lastPriceChangeSource: event.source,
    updatedAt: new Date().toISOString(),
  });
};

const getLatestRecordedPrice = (product = {}) => {
  const payload = product?.payload && typeof product.payload === 'object' ? product.payload : {};
  const rows = [
    ...(Array.isArray(product.priceEvents) ? product.priceEvents : []),
    ...(Array.isArray(product.priceHistory) ? product.priceHistory : []),
    ...(Array.isArray(payload.priceHistory) ? payload.priceHistory : []),
  ]
    .filter(Boolean)
    .sort((left, right) => new Date(left.createdAt || left.at || left.eventDate || 0).getTime() - new Date(right.createdAt || right.at || right.eventDate || 0).getTime());
  const latest = rows[rows.length - 1] || null;
  const recorded = toNumber(latest?.salePrice ?? latest?.price ?? latest?.newPrice ?? latest?.payload?.salePrice ?? latest?.payload?.newPrice);
  return Number.isFinite(recorded) ? recorded : (toNumber(product?.salePrice ?? product?.price ?? product?.currentPrice) || 0);
};

let campaignDefinitionListWarningLogged = false;

const safeListActiveCampaignDefinitions = async ({ settings } = {}) => {
  try {
    const definitions = await listActiveCampaignDefinitions({ settings });
    return Array.isArray(definitions) ? definitions : [];
  } catch (error) {
    if (!campaignDefinitionListWarningLogged) {
      campaignDefinitionListWarningLogged = true;
      console.error('[campaign-price-history-definitions:error]', {
        code: error?.code || null,
        name: error?.name || 'Error',
        message: error?.message || 'Campaign definitions could not be listed.',
      });
    }
    return [];
  }
};

const syncCampaignPriceHistoryForCurrentState = async ({ settings, actorId = 'system', actorName = 'Sistem' }) => {
  const activeCampaigns = await safeListActiveCampaignDefinitions({ settings });
  const products = await loadCampaignPriceProducts();
  const events = [];

  for (const product of products) {
    const recordedPrice = getLatestRecordedPrice(product);
    const current = getEffectiveCampaignPrice(product, activeCampaigns);
    if (pricesEqual(recordedPrice, current.effectivePrice)) continue;

    const basePrice = toNumber(product?.salePrice ?? product?.price ?? product?.currentPrice) || 0;
    const transition = current.pricedProduct?.hasActiveCampaign || current.pricedProduct?.hasActiveDiscount || !pricesEqual(current.effectivePrice, basePrice)
      ? 'apply'
      : 'restore';
    const event = buildCampaignPriceEvent({
      product,
      previousPrice: recordedPrice,
      nextPrice: current.effectivePrice,
      pricedProduct: current.pricedProduct,
      transition,
      actorId,
      actorName,
    });
    await persistCampaignPriceEvent({ product, event });
    events.push(event);
  }

  return { eventCount: events.length };
};

const syncCampaignPriceHistory = async ({ previousSettings, nextSettings, actorId, actorName }) => {
  const previousCampaigns = await safeListActiveCampaignDefinitions({ settings: previousSettings });
  const nextCampaigns = await safeListActiveCampaignDefinitions({ settings: nextSettings });
  const products = await loadCampaignPriceProducts();
  const events = [];

  for (const product of products) {
    const before = getEffectiveCampaignPrice(product, previousCampaigns);
    const after = getEffectiveCampaignPrice(product, nextCampaigns);
    if (pricesEqual(before.effectivePrice, after.effectivePrice)) continue;

    const transition = after.pricedProduct?.hasActiveCampaign || after.pricedProduct?.hasActiveDiscount ? 'apply' : 'restore';
    const event = buildCampaignPriceEvent({
      product,
      previousPrice: before.effectivePrice,
      nextPrice: after.effectivePrice,
      pricedProduct: after.pricedProduct,
      transition,
      actorId,
      actorName,
    });
    await persistCampaignPriceEvent({ product, event });
    events.push(event);
  }

  return { eventCount: events.length };
};

const LOG_GROUP_FIELDS = {
  activity: 'loginActivities',
  login: 'loginActivities',
  audit: 'auditLogs',
  developer: 'developerLogs',
};

const assertFourDigitPin = (pin, message = 'PIN 4 haneli sayisal formatta olmalidir') => {
  if (!/^\d{4}$/.test(normalizePin(pin))) {
    throw new AppError(400, message);
  }
};

export const settingsService = {
  async get(currentUser) {
    const settings = await settingsRepo.getSettings();
    void syncCampaignPriceHistoryForCurrentState({
      settings,
      actorId: 'system',
      actorName: 'Sistem',
    }).catch((error) => {
      console.error('[campaign-price-history-current-sync:error]', error);
    });
    const base = {
      ...settings,
      posPin: undefined,
      roleManagementPin: undefined,
      deskPins: undefined,
    };

    if (currentUser?.role === 'admin') {
      return {
        ...base,
        hasPosPin: Boolean(settings.posPin),
        hasRoleManagementPin: Boolean(settings.roleManagementPin),
        loginActivities: Array.isArray(settings.loginActivities) ? settings.loginActivities : [],
        auditLogs: Array.isArray(settings.auditLogs) ? settings.auditLogs : [],
        developerLogs: Array.isArray(settings.developerLogs) ? settings.developerLogs : [],
        deskPinMeta: {
          B1: Boolean(settings?.deskPins?.B1),
          B2: Boolean(settings?.deskPins?.B2),
          B3: Boolean(settings?.deskPins?.B3),
          B4: Boolean(settings?.deskPins?.B4),
          B5: Boolean(settings?.deskPins?.B5),
          B6: Boolean(settings?.deskPins?.B6),
          B7: Boolean(settings?.deskPins?.B7),
          B8: Boolean(settings?.deskPins?.B8),
        },
      };
    }

    return base;
  },

  async update(payload, currentUser) {
    validateSettingsPayload(payload, { partial: true });
    const current = await settingsRepo.getSettings();
    const input = sanitizeSettingsInput({ ...current, ...payload });

    const deskPins = {
      ...DEFAULT_DESK_PINS,
      ...(current.deskPins || {}),
      ...(input.deskPins || {}),
    };

    const actorId = String(currentUser?.id || 'system');
    const actorName = String(currentUser?.name || currentUser?.username || 'Sistem');

    const nextSettings = {
      ...current,
      ...input,
      deskPins,
      roleManagementPin: input.roleManagementPin || current.roleManagementPin || '1234',
      updatedAt: new Date().toISOString(),
    };

    const changedKeys = pickChangedKeys(current, nextSettings);
    const auditEntry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actorId,
      actorName,
      action: 'settings_update',
      changedKeys,
      at: new Date().toISOString(),
      details: changedKeys.join(', '),
    };
    nextSettings.auditLogs = appendAuditLog(current, auditEntry);

    await settingsRepo.updateSettings(nextSettings);
    if (Object.prototype.hasOwnProperty.call(payload?.customerRelations || {}, 'campaigns')) {
      clearPricingAnalysisCache();
      if (payload?.skipCampaignPriceHistorySync !== true) {
        try {
          await syncCampaignPriceHistory({
            previousSettings: current,
            nextSettings,
            actorId,
            actorName,
          });
          await syncCampaignPriceHistoryForCurrentState({
            settings: nextSettings,
            actorId,
            actorName,
          });
        } catch (error) {
          console.error('[campaign-price-history-sync:error]', error);
        }
      }
      void eslService.syncCampaignLabels({ actorUser: currentUser }).catch((error) => {
        console.error('[campaign-esl-sync:error]', error);
      });
    }
    return nextSettings;
  },

  async recordLoginActivity(user, meta = {}) {
    const userType = String(meta.userType || 'staff').trim().toLowerCase();
    const eventType = String(meta.eventType || 'login_success').trim();
    const userAgent = String(meta.userAgent || meta.device || '');
    const parsed = parseLoginUserAgent(userAgent);

    const entry = {
      userId: user?.id ? String(user.id) : null,
      userType,
      name: String(user?.name || user?.username || meta.identity || 'Bilinmeyen Kullanıcı'),
      email: String(user?.email || (String(meta.identity || '').includes('@') ? meta.identity : '') || ''),
      username: String(user?.username || meta.identity || ''),
      role: String(user?.role || meta.role || (userType === 'customer' ? 'customer' : '') || ''),
      department: String(user?.department || meta.department || ''),
      eventType,
      source: normalizeLoginSource(meta.source, userType),
      status: String(meta.status || normalizeLoginStatus(eventType)),
      ip: String(meta.ip || meta.ipAddress || ''),
      userAgent,
      browser: String(meta.browser || parsed.browser),
      os: String(meta.os || parsed.os),
      requestId: String(meta.requestId || ''),
      failureReason: String(meta.failureReason || ''),
      createdAt: meta.createdAt || new Date().toISOString(),
    };

    return loginActivityRepo.create(entry);
  },

  async getLoginActivities(currentUser, query = {}) {
    const filters = {
      user: String(query.user || '').trim(),
      eventType: String(query.eventType || '').trim(),
      source: String(query.source || '').trim(),
      status: String(query.status || '').trim(),
      ip: String(query.ip || '').trim().toLocaleLowerCase('tr-TR'),
      search: String(query.search || '').trim().toLocaleLowerCase('tr-TR'),
      fromDate: parseDateBoundary(query.from, 'T00:00:00.000Z'),
      toDate: parseDateBoundary(query.to, 'T23:59:59.999Z'),
    };
    if (currentUser?.role !== 'admin') {
      filters.userId = currentUser?.id;
    }

    let central = { items: [], total: 0, limit: 100, page: 1 };
    const limit = normalizeListLimit(query.limit, 100, MAX_LOGIN_ACTIVITY_QUERY_LIMIT);
    try {
      central = await loginActivityRepo.list({
        filters,
        limit,
        page: Math.max(1, Number(query.page) || 1),
      });
    } catch (error) {
      console.warn('[login-activity:central-list-skipped]', error?.message || error);
    }

    const settings = await settingsRepo.getSettings();
    const legacy = (Array.isArray(settings.loginActivities) ? settings.loginActivities : [])
      .map(normalizeLegacyLoginActivity)
      .filter((item) => {
        const loginDate = new Date(item.createdAt || item.loginAt || item.loggedInAt || item.timestamp || item.at || 0);
        if (filters.fromDate && (!Number.isFinite(loginDate.getTime()) || loginDate < filters.fromDate)) return false;
        if (filters.toDate && (!Number.isFinite(loginDate.getTime()) || loginDate > filters.toDate)) return false;
        if (currentUser?.role !== 'admin' && item.userId !== currentUser?.id) return false;

        const userName = String(item.userName || item.username || '').trim();
        if (filters.user && userName !== filters.user && item.email !== filters.user) return false;
        if (filters.eventType && item.eventType !== filters.eventType) return false;
        if (filters.source && item.source !== filters.source) return false;
        if (filters.status && item.status !== filters.status) return false;

        const ipValue = String(item.ipAddress || item.ip || '').toLocaleLowerCase('tr-TR');
        if (filters.ip && !ipValue.includes(filters.ip)) return false;

        if (filters.search) {
          const haystack = [
            userName,
            item.username,
            item.email,
            item.registerPin,
            item.ipAddress,
            item.ip,
            item.userAgent,
            item.browserInfo,
            item.device,
          ]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase('tr-TR');
          if (!haystack.includes(filters.search)) return false;
        }

        return true;
      });

    const rows = [...central.items, ...legacy]
      .sort((left, right) => new Date(right.createdAt || right.at || 0).getTime() - new Date(left.createdAt || left.at || 0).getTime());

    return {
      items: rows.slice(0, limit),
      total: central.total + legacy.length,
      centralTotal: central.total,
      legacyTotal: legacy.length,
      limit,
    };
  },

  async getAuditLogs(currentUser, query = {}) {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new AppError(403, 'Audit log erişimi için yönetici yetkisi gereklidir');
    }

    return auditLogService.list({
      ...query,
      limit: normalizeListLimit(query.limit, 100, MAX_AUDIT_LOGS),
    });
  },

  async recordDeveloperLog(payload = {}, currentUser, requestMeta = {}) {
    const settings = await settingsRepo.getSettings();
    const now = new Date().toISOString();

    const requestPayload = normalizeStructuredLogValue(payload.requestPayload ?? payload.payload ?? null);
    const responsePayload = normalizeStructuredLogValue(payload.response);
    const payloadSnapshot = normalizeStructuredLogValue(payload.payload ?? requestPayload);
    const requestUrl = payload.requestUrl || payload.endpoint || requestMeta.requestUrl || '';
    const userId = payload.userId || payload.user_id || currentUser?.id || null;
    const userName = payload.userName || currentUser?.name || currentUser?.username || null;
    const userRole = payload.userRole || currentUser?.role || null;
    const requestId = payload.requestId || payload.request_id || requestMeta.requestId || null;
    const correlationId = payload.correlationId || payload.correlation_id || requestId || null;

    const entry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      timestamp: now,
      level: normalizeDeveloperLevel(payload.level),
      message: extractReadableLogMessage(payload.message || 'Bilinmeyen hata'),
      source: normalizeDeveloperSource(payload.source || requestMeta.source),
      action: truncateString(payload.action || requestMeta.action || 'Bilinmeyen işlem', 300),
      endpoint: truncateString(payload.endpoint || requestMeta.endpoint || '', 500),
      requestUrl: truncateString(requestUrl, 700),
      requestPayload,
      payload: payloadSnapshot,
      response: responsePayload,
      stack: truncateString(payload.stack || '', 8000),
      statusCode: Number(payload.statusCode || payload.status_code || requestMeta.statusCode || 0) || undefined,
      userId,
      userName,
      userRole,
      user: userName || undefined,
      browserInfo: truncateString(payload.browserInfo || payload.browser || requestMeta.browserInfo || '', 600),
      ip: truncateString(payload.ip || requestMeta.ip || '', 80),
      errorType: truncateString(payload.errorType || '', 120),
      requestId: requestId ? truncateString(requestId, 120) : undefined,
      correlationId: correlationId ? truncateString(correlationId, 120) : undefined,
      description: truncateString(payload.description || payload.summary || payload.action || requestMeta.action || '', 1000),
      repeatCount: Number(payload.repeatCount || 1) || 1,
    };

    const nextSettings = {
      ...settings,
      developerLogs: appendDeveloperLog(settings, entry),
      updatedAt: now,
    };

    await settingsRepo.updateSettings(nextSettings);
    return entry;
  },

  async getDeveloperLogs(currentUser, query = {}) {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new AppError(403, 'Geliştirici logları için yönetici yetkisi gereklidir');
    }

    const settings = await settingsRepo.getSettings();
    let rows = Array.isArray(settings.developerLogs) ? settings.developerLogs : [];

    const level = String(query.level || '').trim().toLowerCase();
    const source = String(query.source || '').trim().toLowerCase();
    const userId = String(query.userId || '').trim();
    const search = String(query.search || '').trim().toLowerCase();
    const fromDate = query.from ? new Date(`${String(query.from)}T00:00:00.000Z`) : null;
    const toDate = query.to ? new Date(`${String(query.to)}T23:59:59.999Z`) : null;

    if (['error', 'warning', 'info'].includes(level)) {
      rows = rows.filter((item) => String(item.level || '').toLowerCase() === level);
    }

    if (['frontend', 'backend', 'api'].includes(source)) {
      rows = rows.filter((item) => String(item.source || '').toLowerCase() === source);
    }

    if (userId) {
      rows = rows.filter((item) => String(item.userId || '') === userId);
    }

    if (fromDate && Number.isFinite(fromDate.getTime())) {
      rows = rows.filter((item) => {
        const ts = new Date(item.timestamp || item.at || item.createdAt || 0);
        return Number.isFinite(ts.getTime()) && ts >= fromDate;
      });
    }

    if (toDate && Number.isFinite(toDate.getTime())) {
      rows = rows.filter((item) => {
        const ts = new Date(item.timestamp || item.at || item.createdAt || 0);
        return Number.isFinite(ts.getTime()) && ts <= toDate;
      });
    }

    if (search) {
      rows = rows.filter((item) => {
        const haystack = [
          item.message,
          item.endpoint,
          item.requestUrl,
          item.action,
          item.source,
        ].join(' ').toLowerCase();
        return haystack.includes(search);
      });
    }

    const limit = normalizeListLimit(query.limit, 200, 1000);
    return {
      items: rows.slice(0, limit),
      total: rows.length,
      limit,
    };
  },

  async clearLogs(type, currentUser) {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new AppError(403, 'Log kayıtlarını temizlemek için yönetici yetkisi gereklidir');
    }

    const key = String(type || '').trim().toLowerCase();
    if (key === 'audit') {
      throw new AppError(400, 'Merkezi audit log kayıtları bu ekrandan temizlenemez');
    }

    const field = LOG_GROUP_FIELDS[key];
    if (!field) {
      throw new AppError(400, 'Temizlenecek log tipi geçersiz');
    }

    const settings = await settingsRepo.getSettings();
    const previousCount = Array.isArray(settings[field]) ? settings[field].length : 0;
    const now = new Date().toISOString();
    const archivedCount = key === 'activity' || key === 'login'
      ? await loginActivityRepo.archiveAll()
      : 0;

    const nextSettings = {
      ...settings,
      [field]: [],
      updatedAt: now,
    };

    await settingsRepo.updateSettings(nextSettings);
    return { type: key, field, clearedCount: previousCount + archivedCount, archivedCount };
  },

  async exportDeveloperLogsCsv(currentUser, query = {}) {
    const { items: rows } = await this.getDeveloperLogs(currentUser, { ...query, limit: 1000 });
    const escape = (value) => {
      const source = String(value ?? '');
      if (source.includes(',') || source.includes('"') || source.includes('\n')) {
        return `"${source.replace(/"/g, '""')}"`;
      }
      return source;
    };

    const header = ['id', 'timestamp', 'level', 'message', 'source', 'action', 'endpoint', 'requestUrl', 'statusCode', 'userId', 'userName', 'ip', 'errorType'];
    const lines = [header.join(',')];

    rows.forEach((item) => {
      const line = [
        item.id,
        item.timestamp,
        item.level,
        item.message,
        item.source,
        item.action,
        item.endpoint,
        item.requestUrl,
        item.statusCode,
        item.userId,
        item.userName,
        item.ip,
        item.errorType,
      ].map(escape).join(',');
      lines.push(line);
    });

    return `${UTF8_BOM}${lines.join('\n')}`;
  },

  async exportAuditLogsCsv(currentUser) {
    const { items: rows } = await this.getAuditLogs(currentUser, { limit: 500 });
    const escape = (value) => {
      const source = String(value ?? '');
      if (source.includes(',') || source.includes('"') || source.includes('\n')) {
        return `"${source.replace(/"/g, '""')}"`;
      }
      return source;
    };

    const header = ['id', 'createdAt', 'actorUserId', 'actorName', 'actorRole', 'action', 'module', 'entityType', 'entityId', 'entityLabel', 'method', 'endpoint', 'statusCode', 'ip', 'source', 'severity', 'summary'];
    const lines = [header.join(',')];

    rows.forEach((item) => {
      const line = [
        item.id,
        item.createdAt || item.at,
        item.actorUserId || item.actorId,
        item.actorName,
        item.actorRole,
        item.action,
        item.module,
        item.entityType,
        item.entityId,
        item.entityLabel,
        item.method,
        item.endpoint,
        item.statusCode,
        item.ip,
        item.source,
        item.severity,
        item.summary || item.details || '',
      ].map(escape).join(',');
      lines.push(line);
    });

    return `${UTF8_BOM}${lines.join('\n')}`;
  },

  async getLogisticsTariffs() {
    const settings = await settingsRepo.getSettings();
    const rows = logisticsTariffService.normalizeTariffs(settings.logisticsTariffs || []);
    return {
      rows,
      cargoTypes: logisticsTariffService.buildCargoTypeSummary(rows),
      stats: {
        activeCargoTypeCount: logisticsTariffService.buildCargoTypeSummary(rows).filter((item) => item.isActive).length,
        coldChainTypeCount: logisticsTariffService.buildCargoTypeSummary(rows).filter((item) => item.isColdChain).length,
        frozenChainTypeCount: logisticsTariffService.buildCargoTypeSummary(rows).filter((item) => item.isFrozenChain).length,
      },
    };
  },

  async updateLogisticsTariffs(payload = {}, currentUser) {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new AppError(403, 'Lojistik tarifeleri güncellemek için yönetici yetkisi gereklidir');
    }

    const settings = await settingsRepo.getSettings();
    const input = sanitizeSettingsInput({ ...settings, logisticsTariffs: payload.logisticsTariffs || [] });
    validateSettingsPayload({ logisticsTariffs: input.logisticsTariffs || [] }, { partial: true });

    const nextSettings = {
      ...settings,
      logisticsTariffs: logisticsTariffService.normalizeTariffs(input.logisticsTariffs || []),
      updatedAt: new Date().toISOString(),
    };

    const auditEntry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actorId: String(currentUser?.id || 'system'),
      actorName: String(currentUser?.name || currentUser?.username || 'Sistem'),
      action: 'settings_logistics_tariffs_update',
      changedKeys: ['logisticsTariffs'],
      at: new Date().toISOString(),
      details: `Lojistik tarifeleri güncellendi (${nextSettings.logisticsTariffs.length} satır)`,
    };
    nextSettings.auditLogs = appendAuditLog(settings, auditEntry);

    await settingsRepo.updateSettings(nextSettings);

    return {
      rows: nextSettings.logisticsTariffs,
      cargoTypes: logisticsTariffService.buildCargoTypeSummary(nextSettings.logisticsTariffs),
    };
  },

  async calculateLogisticsQuote(payload = {}) {
    const settings = await settingsRepo.getSettings();
    const rows = logisticsTariffService.normalizeTariffs(settings.logisticsTariffs || []);

    const quote = logisticsTariffService.calculateQuote({
      rows,
      cargoTypeCode: payload.cargoTypeCode,
      caseQty: payload.caseQty,
      lineItems: payload.lineItems,
      manualOverrideTl: payload.manualOverrideTl,
      storageType: payload.storageType,
      storageTypes: payload.storageTypes,
      distanceType: payload.distanceType,
      isInternalTransfer: payload.isInternalTransfer === true,
    });

    const compatibleRows = logisticsTariffService.filterTariffsForSelection(rows, {
      storageType: payload.storageType,
      distanceType: payload.distanceType,
      isInternalTransfer: payload.isInternalTransfer === true,
    });

    return {
      quote,
      availableCargoTypes: logisticsTariffService.buildCargoTypeSummary(compatibleRows),
    };
  },

  async verifyPin(pin, type = 'pos', deskCode, currentUser, registerPin) {
    if (!pin) {
      throw new AppError(400, 'PIN zorunludur');
    }

    const settings = await settingsRepo.getSettings();
    const normalizedType = String(type || 'pos').trim().toLowerCase();

    if (normalizedType === 'desk') {
      const normalizedDesk = String(deskCode || '').trim().toUpperCase();
      if (!VALID_DESKS.has(normalizedDesk)) {
        throw new AppError(400, 'Geçersiz kasa kodu');
      }

      const normalizedRegisterPin = String(registerPin || '').trim();
      if (!/^\d{4}$/.test(normalizedRegisterPin)) {
        throw new AppError(400, 'Sicil no 4 haneli olmalıdır');
      }

      if (!currentUser?.id) {
        throw new AppError(401, 'Geçersiz oturum');
      }

      const authenticatedUser = await userRepo.findById(currentUser.id);
      if (!authenticatedUser) {
        throw new AppError(401, 'Geçersiz oturum');
      }

      if (!authenticatedUser.isActive) {
        throw new AppError(403, 'Bu kullanıcı pasif durumda');
      }

      if (!['admin', 'cashier'].includes(authenticatedUser.role)) {
        throw new AppError(403, 'Bu kullanıcı için kasa erişim yetkisi yok');
      }

      if (String(authenticatedUser.registerPin || '').trim() !== normalizedRegisterPin) {
        throw new AppError(401, 'Geçersiz sicil numarası');
      }

      if (authenticatedUser.role === 'cashier') {
        const assignedDeskCode = String(authenticatedUser.assignedDeskCode || '').trim().toUpperCase();
        if (!assignedDeskCode) {
          throw new AppError(403, 'Bu kasiyer için atanmış kasa bulunmuyor');
        }
        if (assignedDeskCode !== normalizedDesk) {
          throw new AppError(403, `Bu kullanıcı sadece ${assignedDeskCode} kasasını açabilir`);
        }
      }

      if (normalizedDesk === 'B8') {
        if (authenticatedUser.role !== 'admin') {
          throw new AppError(403, 'Yönetim Kasası için yetkiniz yok');
        }
      }

      const pins = {
        ...DEFAULT_DESK_PINS,
        ...(settings.deskPins || {}),
      };

      if (String(pin) !== String(pins[normalizedDesk])) {
        throw new AppError(401, 'Geçersiz PIN');
      }

      return {
        verified: true,
        deskCode: normalizedDesk,
        registerPin: normalizedRegisterPin,
        userId: authenticatedUser.id,
        userName: authenticatedUser.name,
      };
    }

    if (normalizedType === 'role-management') {
      if (!currentUser || currentUser.role !== 'admin') {
        throw new AppError(403, 'Rol yönetimi için yönetici yetkisi gerekli');
      }
      const rolePin = settings.roleManagementPin || '1234';
      if (String(pin) !== String(rolePin)) {
        throw new AppError(401, 'Geçersiz PIN');
      }
      return { verified: true };
    }

    const storedPin = settings.posPin || '1234';
    if (String(pin) !== String(storedPin)) {
      throw new AppError(401, 'Geçersiz PIN');
    }

    return { verified: true };
  },

  async updateSystemDeskPin(deskCode, newPin, currentUser) {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new AppError(403, 'Bu işlem için yönetici yetkisi gereklidir');
    }

    const normalizedDesk = String(deskCode || '').trim().toUpperCase();
    if (!VALID_DESKS.has(normalizedDesk)) {
      throw new AppError(400, 'Geçersiz kasa kodu');
    }

    const normalizedNewPin = normalizePin(newPin);
    if (!normalizedNewPin) {
      throw new AppError(400, 'Yeni PIN boş olamaz');
    }
    assertFourDigitPin(normalizedNewPin, 'PIN 4 haneli olmalıdır');

    const settings = await settingsRepo.getSettings();
    const currentDeskPins = {
      ...DEFAULT_DESK_PINS,
      ...(settings.deskPins || {}),
    };

    const previousPin = normalizePin(currentDeskPins[normalizedDesk]);
    if (normalizedNewPin === previousPin) {
      throw new AppError(400, 'Yeni PIN mevcut PIN ile aynı olamaz');
    }

    const nextDeskPins = {
      ...currentDeskPins,
      [normalizedDesk]: normalizedNewPin,
    };

    const nextSettings = {
      ...settings,
      deskPins: nextDeskPins,
      updatedAt: new Date().toISOString(),
    };

    const auditEntry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actorId: String(currentUser?.id || 'system'),
      actorName: String(currentUser?.name || currentUser?.username || 'Sistem'),
      action: 'settings_desk_pin_update',
      changedKeys: [`deskPins.${normalizedDesk}`],
      at: new Date().toISOString(),
      details: `${normalizedDesk} kasa PIN güncellendi`,
    };
    nextSettings.auditLogs = appendAuditLog(settings, auditEntry);

    await settingsRepo.updateSettings(nextSettings);

    return {
      deskCode: normalizedDesk,
      updatedAt: nextSettings.updatedAt,
      deskPins: nextDeskPins,
    };
  },
};
