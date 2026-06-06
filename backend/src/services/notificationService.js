import { v4 as uuidv4 } from 'uuid';
import { notificationRepo } from '../repositories/notificationRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { taskRepo } from '../repositories/taskRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { parsePagePagination } from '../utils/pagination.js';
import { normalizeTurkishText } from '../utils/turkishText.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_WINDOW_MS = 24 * 60 * 60 * 1000;
const SLA_START_WINDOW_MS = 4 * 60 * 60 * 1000;
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical', 'warning']);
const VALID_TARGET_MODES = new Set(['all', 'department', 'role', 'users']);
const MENTION_REGEX = /@([a-zA-Z0-9._-]+)/g;
const SNOOZE_PRESETS = {
  '1h': 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  eod: null,
};

const PRIORITY_WEIGHT = {
  critical: 4,
  high: 3,
  warning: 2,
  medium: 2,
  low: 1,
};

const GROUPABLE_OPERATIONAL_TYPES = new Set([
  'skt_expired',
  'expiry_soon',
  'critical_stock',
  'stock_out',
  'out_of_stock',
  'stockout',
]);
const GROUP_WINDOW_MS = 15 * 60 * 1000;

const TYPE_LABELS_TR = {
  overdue: 'Geciken Görev',
  upcoming: 'Yaklaşan Teslim',
  sla: 'SLA Riski',
  assigned: 'Görev Ataması',
  updated: 'Görev Güncellemesi',
  mention: 'Bahsedilme',
  comment: 'Yorum',
  stock_out: 'Stok Bitimi',
  critical_stock: 'Kritik Stok',
  expiry_soon: 'SKT Yaklaşan Ürün',
  skt_expired: 'SKT Geçti',
  system: 'Sistem',
  order: 'Sipariş',
  task: 'Görev',
  purchase_order: 'Sipariş Takibi',
  goods_receipt: 'Mal Kabul',
  campaign: 'Kampanya Yönetimi',
  pricing_analysis: 'Fiyat & Talep Analizi',
  price_recommendations: 'Fiyat & Talep Analizi',
  pricing_demand_analysis: 'Fiyat & Talep Analizi',
  price_demand_analysis: 'Fiyat & Talep Analizi',
};

const ACTION_LABELS_TR = {
  open: 'Açıldı',
  inspect: 'İncele',
  'go-task': 'Göreve Git',
  'create-order': 'Sipariş Oluştur',
  'add-stock': 'Stok Ekle',
  click: 'Tıklandı',
  close: 'Kapatıldı',
  dismiss: 'Göz Ardı Edildi',
  archive: 'Arşivlendi',
  mark_read: 'Okundu',
};

const PRICING_DEMAND_SOURCE_LABEL = 'Fiyat & Talep Analizi';
const PRICING_DEMAND_SOURCE_ALIASES = new Set([
  'price recommendations',
  'price_recommendations',
  'price-recommendations',
  'pricing recommendations',
  'pricing_recommendations',
  'pricing_demand_analysis',
  'pricing demand analysis',
  'price_demand_analysis',
  'price demand analysis',
  'pricing_analysis',
  'pricing analysis',
  'price_analysis',
  'price analysis',
  'demand_analysis',
  'demand analysis',
  'fiyat_talep_analizi',
  'fiyat talep analizi',
  'pricing',
]);

const normalizeNotificationKey = (value) => String(value ?? '')
  .trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[._-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const extractTextFromObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const keys = ['campaignName', 'name', 'publicName', 'displayName', 'title', 'label', 'message', 'text', 'description'];
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      const text = String(candidate).trim();
      if (text && text !== '[object Object]') return text;
    }
  }
  return '';
};

const toNotificationText = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = normalizeTurkishText(value).trim();
    return text && text !== '[object Object]' ? text : fallback;
  }
  const objectText = extractTextFromObject(value);
  return objectText ? normalizeTurkishText(objectText).trim() : fallback;
};

const resolveSourceLabel = (value, fallback = '') => {
  const raw = toNotificationText(value, '');
  const key = normalizeNotificationKey(raw);
  if (!key) return fallback;
  if (PRICING_DEMAND_SOURCE_ALIASES.has(key) || key.includes('price recommendations')) {
    return PRICING_DEMAND_SOURCE_LABEL;
  }
  return raw;
};

const pickFirstText = (...values) => {
  for (const value of values) {
    const text = toNotificationText(value, '');
    if (text) return text;
  }
  return '';
};

const resolveCampaignName = (source = {}, fallback = 'Yeni kampanya') => {
  const payload = source?.payload && typeof source.payload === 'object' ? source.payload : {};
  const campaign = payload.campaign && typeof payload.campaign === 'object' ? payload.campaign : {};
  const rootCampaign = source?.campaign && typeof source.campaign === 'object' ? source.campaign : {};
  return pickFirstText(
    payload.campaignName,
    campaign.name,
    campaign.publicName,
    campaign.displayName,
    rootCampaign.name,
    source.campaignName,
    source.name,
    payload.name,
    fallback
  ) || fallback;
};

const buildCampaignCreatedMessage = (campaignName, sourceLabel = PRICING_DEMAND_SOURCE_LABEL) => {
  const name = toNotificationText(campaignName, 'Yeni kampanya');
  const label = resolveSourceLabel(sourceLabel, PRICING_DEMAND_SOURCE_LABEL);
  return name === 'Yeni kampanya'
    ? `Yeni kampanya ${label} üzerinden oluşturuldu.`
    : `"${name}" kampanyası ${label} üzerinden oluşturuldu.`;
};

const isPricingDemandSource = (value) => {
  const key = normalizeNotificationKey(value);
  return PRICING_DEMAND_SOURCE_ALIASES.has(key) || key.includes('price recommendations') || key.includes('fiyat talep analizi');
};

const isPricingCampaignCreatedPayload = (source = {}) => {
  const payload = source?.payload && typeof source.payload === 'object' ? source.payload : {};
  const sourceMatches = [
    payload.source,
    payload.sourceModule,
    payload.module,
    payload.page,
    payload.pageName,
    payload.sourceLabel,
    source.source,
    source.sourceLabel,
    source.actionType,
    source.type,
  ].some(isPricingDemandSource);
  if (!sourceMatches) return false;

  const actionText = [
    source.type,
    source.actionType,
    payload.event,
    payload.action,
    payload.entityType,
    payload.module,
  ].map((value) => normalizeNotificationKey(value)).join(' ');
  return actionText.includes('campaign')
    || actionText.includes('kampanya')
    || Boolean(payload.campaignId || payload.campaignName || payload.campaign);
};

export const normalizeNotificationRecordPayload = (input = {}) => {
  const payload = input?.payload && typeof input.payload === 'object' ? { ...input.payload } : input?.payload || null;
  const base = {
    ...input,
    title: toNotificationText(input.title, 'Bildirim'),
    message: toNotificationText(input.message, ''),
    actionUrl: input.actionUrl || input.targetRoute || null,
    actionType: input.actionType || null,
    payload,
  };

  if (!isPricingCampaignCreatedPayload(base)) {
    return base;
  }

  const campaignName = resolveCampaignName(base);
  const sourceLabel = PRICING_DEMAND_SOURCE_LABEL;
  return {
    ...base,
    type: 'campaign',
    title: 'Kampanya oluşturuldu',
    message: buildCampaignCreatedMessage(campaignName, sourceLabel),
    actionUrl: '/kampanya-yonetimi',
    actionType: 'campaign',
    payload: {
      ...(payload && typeof payload === 'object' ? payload : {}),
      event: 'campaign_created',
      entityType: 'campaign',
      campaignName,
      source: 'pricing_demand_analysis',
      sourceLabel,
      targetRoute: '/kampanya-yonetimi',
    },
  };
};

const toTurkishLabel = (value, dictionary) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '-';
  if (dictionary[normalized]) return dictionary[normalized];
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toLocaleUpperCase('tr-TR'));
};

const createNotificationRecord = ({
  userId,
  type,
  title,
  message,
  severity = 'low',
  relatedTaskId = null,
  dedupeKey = null,
  actionUrl = null,
  actionType = null,
  createdBy = null,
  audience = null,
  delivery = null,
  payload = null,
  isDraft = false,
}) => {
  const normalized = normalizeNotificationRecordPayload({
    userId,
    type,
    title,
    message,
    severity,
    relatedTaskId,
    dedupeKey,
    actionUrl,
    actionType,
    createdBy,
    audience,
    delivery,
    payload,
    isDraft,
  });
  return {
    id: uuidv4(),
    userId,
    type: normalized.type,
    title: normalized.title,
    message: normalized.message,
    severity: VALID_SEVERITIES.has(severity) ? severity : 'low',
    isRead: false,
    createdAt: new Date().toISOString(),
    relatedTaskId,
    dedupeKey,
    actionUrl: normalized.actionUrl,
    actionType: normalized.actionType,
    createdBy,
    audience,
    delivery,
    payload: normalized.payload,
    isDraft: Boolean(isDraft),
  };
};

const normalizeGroupableType = (type) => {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'out_of_stock' || normalized === 'stockout') return 'stock_out';
  return normalized;
};

const isGroupedNotificationPayload = (payload) => (
  payload && typeof payload === 'object' && payload.isNotificationGroup === true
);

const buildGroupWindowKey = (now = new Date()) => {
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const safeTime = Number.isFinite(time) ? time : Date.now();
  return Math.floor(safeTime / GROUP_WINDOW_MS);
};

const resolveGroupSource = (payload = {}, actionType = '') => (
  String(payload.sourceModule || payload.module || payload.source || actionType || 'stock')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_') || 'stock'
);

const buildOperationalGroupDedupeKey = ({ userId, type, severity, actionType, payload, now = new Date() }) => {
  const normalizedType = normalizeGroupableType(type);
  const source = resolveGroupSource(payload || {}, actionType);
  const windowKey = payload?.groupWindowKey || buildGroupWindowKey(now);
  return `notification-group:${userId}:${normalizedType}:${severity || 'low'}:${source}:${windowKey}`;
};

const getOperationalGroupTitle = (type, count) => {
  const safeCount = Math.max(1, Number(count) || 1);
  if (type === 'skt_expired') return `${safeCount} üründe SKT geçti`;
  if (type === 'expiry_soon') return `${safeCount} üründe SKT yaklaşıyor`;
  if (type === 'critical_stock') return `${safeCount} üründe kritik stok seviyesi görüldü`;
  if (type === 'stock_out') return `${safeCount} ürünün stoğu tükendi`;
  return `${safeCount} benzer bildirim`;
};

const buildOperationalGroupItem = (payload = {}, source = {}, now = new Date()) => {
  const itemPayload = payload && typeof payload === 'object' ? payload : {};
  return {
    productId: itemPayload.productId || itemPayload.entityId || null,
    sku: itemPayload.sku || itemPayload.productSku || '',
    barcode: itemPayload.barcode || '',
    productName: itemPayload.productName || itemPayload.name || source.title || '',
    batchNo: itemPayload.batchNo || '',
    expiryDate: itemPayload.expiryDate || itemPayload.skt || '',
    quantity: itemPayload.quantity ?? itemPayload.currentStock ?? itemPayload.stock ?? null,
    reason: itemPayload.reason || source.type || '',
    reasonLabel: itemPayload.reasonLabel || source.message || '',
    sourceKey: source.dedupeKey || itemPayload.sourceKey || itemPayload.eventId || `${source.type}:${source.title}:${source.message}`,
    createdAt: now.toISOString(),
  };
};

const mergeOperationalGroupRecord = (existing, source, now = new Date()) => {
  const payload = existing.payload && typeof existing.payload === 'object' ? existing.payload : {};
  const items = Array.isArray(payload.items) ? [...payload.items] : [];
  const incoming = buildOperationalGroupItem(source.payload, source, now);
  const existingKeys = new Set(items.map((item) => String(item.sourceKey || '').trim()).filter(Boolean));
  if (!existingKeys.has(incoming.sourceKey)) {
    items.push(incoming);
  }
  const type = normalizeGroupableType(source.type);
  const title = getOperationalGroupTitle(type, items.length);
  const existingWeight = PRIORITY_WEIGHT[existing.severity] || 1;
  const incomingWeight = PRIORITY_WEIGHT[source.severity] || 1;
  return {
    ...existing,
    type,
    title,
    message: 'Benzer uyarılar tek bildirime toplandı. Detay için bildirimi açın.',
    severity: incomingWeight > existingWeight ? source.severity : existing.severity,
    isRead: false,
    createdAt: now.toISOString(),
    actionUrl: source.actionUrl || existing.actionUrl,
    actionType: source.actionType || existing.actionType,
    payload: {
      ...payload,
      isNotificationGroup: true,
      entityType: 'notification_group',
      groupType: type,
      groupLabel: TYPE_LABELS_TR[type] || toTurkishLabel(type, TYPE_LABELS_TR),
      groupWindow: '15m',
      itemCount: items.length,
      affectedProductCount: countUniqueGroupProducts(items),
      sampleProductNames: items.slice(0, 5).map((item) => item.productName).filter(Boolean),
      items,
    },
  };
};

const countUniqueGroupProducts = (items = []) => new Set(
  items
    .map((item) => String(item.productId || item.sku || item.productName || '').trim())
    .filter(Boolean),
).size;

const maybeCreateGroupedOperationalNotification = async (payload) => {
  const now = new Date();
  const type = normalizeGroupableType(payload.type);
  if (!GROUPABLE_OPERATIONAL_TYPES.has(type) || isGroupedNotificationPayload(payload.payload)) {
    return null;
  }

  const groupKey = payload.payload?.notificationGroupKey || buildOperationalGroupDedupeKey({
    userId: payload.userId,
    type,
    severity: payload.severity,
    actionType: payload.actionType,
    payload: payload.payload,
    now,
  });
  const source = { ...payload, type, dedupeKey: payload.dedupeKey || payload.payload?.sourceKey || null };
  const existing = await notificationRepo.findByUserAndDedupeKey(payload.userId, groupKey);
  if (existing) {
    const next = mergeOperationalGroupRecord(existing, source, now);
    await notificationRepo.updateById(existing.id, next);
    return next;
  }

  const item = buildOperationalGroupItem(payload.payload, source, now);
  const record = createNotificationRecord({
    ...payload,
    type,
    title: getOperationalGroupTitle(type, 1),
    message: 'Benzer uyarılar tek bildirime toplandı. Detay için bildirimi açın.',
    dedupeKey: groupKey,
    payload: {
      ...(payload.payload && typeof payload.payload === 'object' ? payload.payload : {}),
      isNotificationGroup: true,
      entityType: 'notification_group',
      groupType: type,
      groupLabel: TYPE_LABELS_TR[type] || toTurkishLabel(type, TYPE_LABELS_TR),
      groupWindow: '15m',
      itemCount: 1,
      affectedProductCount: countUniqueGroupProducts([item]),
      sampleProductNames: item.productName ? [item.productName] : [],
      items: [item],
    },
  });
  await notificationRepo.create(record);
  return record;
};

const getActorName = (actorUser) => {
  const safe = String(actorUser?.name || '').trim();
  return safe || 'Bir kullanıcı';
};

const parseDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const extractMentionTokens = (text) => {
  const source = String(text || '');
  const tokens = new Set();
  for (const match of source.matchAll(MENTION_REGEX)) {
    const token = String(match[1] || '').trim().toLowerCase();
    if (token) tokens.add(token);
  }
  return Array.from(tokens);
};

const resolveMentionedUserIds = async (text) => {
  const tokens = extractMentionTokens(text);
  if (tokens.length === 0) return [];

  const users = await userRepo.getAll();
  const matched = new Set();

  users.forEach((item) => {
    const username = String(item.username || '').trim().toLowerCase();
    const localPart = username.includes('@') ? username.split('@')[0] : username;
    if (tokens.includes(username) || tokens.includes(localPart)) {
      matched.add(item.id);
    }
  });

  return Array.from(matched);
};

const maybeCreate = async (payload) => {
  if (!payload?.userId || !payload?.type || !payload?.message) {
    return null;
  }

  const groupedRecord = await maybeCreateGroupedOperationalNotification(payload);
  if (groupedRecord) {
    return groupedRecord;
  }

  if (payload.dedupeKey) {
    const existing = await notificationRepo.findByUserAndDedupeKey(payload.userId, payload.dedupeKey);
    if (existing) {
      return existing;
    }
  }

  const record = createNotificationRecord(payload);
  await notificationRepo.create(record);
  return record;
};

const buildEndOfDayIso = () => {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
};

const normalizeStringList = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
};

const normalizeTargeting = (raw = {}) => {
  const mode = String(raw.mode || 'all').trim().toLowerCase();
  return {
    mode: VALID_TARGET_MODES.has(mode) ? mode : 'all',
    departments: normalizeStringList(raw.departments),
    roles: normalizeStringList(raw.roles),
    userIds: normalizeStringList(raw.userIds),
  };
};

const normalizeDelivery = (raw = {}) => {
  const sendAt = String(raw.sendAt || '').trim();
  const expiresAt = String(raw.expiresAt || '').trim();
  return {
    sendAt: sendAt || null,
    expiresAt: expiresAt || null,
    isPinned: Boolean(raw.isPinned),
    requireReadReceipt: Boolean(raw.requireReadReceipt),
  };
};

const toLocaleKey = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const resolveTargetUserIds = async (targeting) => {
  const users = await userRepo.getAll();
  const activeUsers = users.filter((item) => item?.isActive);

  if (targeting.mode === 'all') {
    return activeUsers.map((item) => item.id);
  }

  if (targeting.mode === 'department') {
    const departmentSet = new Set(targeting.departments.map((item) => toLocaleKey(item)));
    return activeUsers
      .filter((item) => departmentSet.has(toLocaleKey(item.department)))
      .map((item) => item.id);
  }

  if (targeting.mode === 'role') {
    const roleSet = new Set(targeting.roles.map((item) => String(item || '').trim().toLowerCase()));
    return activeUsers
      .filter((item) => roleSet.has(String(item.role || '').trim().toLowerCase()))
      .map((item) => item.id);
  }

  const idSet = new Set(targeting.userIds);
  return activeUsers
    .filter((item) => idSet.has(item.id))
    .map((item) => item.id);
};

const parseSafeDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const normalizeUserPrefs = (prefs = {}) => ({
  mutedTypes: Array.isArray(prefs.mutedTypes) ? prefs.mutedTypes.map((item) => String(item || '').trim()).filter(Boolean) : [],
  mutedNotificationIds: Array.isArray(prefs.mutedNotificationIds) ? prefs.mutedNotificationIds.map((item) => String(item || '').trim()).filter(Boolean) : [],
  snoozedNotificationIds: prefs.snoozedNotificationIds && typeof prefs.snoozedNotificationIds === 'object'
    ? Object.entries(prefs.snoozedNotificationIds).reduce((acc, [key, value]) => {
      const safeKey = String(key || '').trim();
      const safeValue = String(value || '').trim();
      if (safeKey && safeValue) {
        acc[safeKey] = safeValue;
      }
      return acc;
    }, {})
    : {},
});

const getUserNotificationPrefs = async (userId) => {
  const settings = await settingsRepo.getSettings();
  const all = settings.notificationPreferencesByUser && typeof settings.notificationPreferencesByUser === 'object'
    ? settings.notificationPreferencesByUser
    : {};

  return {
    settings,
    all,
    current: normalizeUserPrefs(all[userId] || {}),
  };
};

const saveUserNotificationPrefs = async (userId, prefs) => {
  const { settings, all } = await getUserNotificationPrefs(userId);
  const next = {
    ...settings,
    notificationPreferencesByUser: {
      ...all,
      [userId]: normalizeUserPrefs(prefs),
    },
    updatedAt: new Date().toISOString(),
  };

  await settingsRepo.updateSettings(next);
  return next.notificationPreferencesByUser[userId];
};

const filterByPreferences = (items, prefs) => {
  const now = Date.now();
  return items.filter((item) => {
    if (prefs.mutedNotificationIds.includes(item.id)) return false;
    if (prefs.mutedTypes.includes(String(item.type || '').toLowerCase())) return false;

    const snoozedUntil = prefs.snoozedNotificationIds[item.id];
    if (!snoozedUntil) return true;

    const untilTs = new Date(snoozedUntil).getTime();
    if (!Number.isNaN(untilTs) && untilTs > now) {
      return false;
    }

    return true;
  });
};

const buildPreferenceQueryOptions = (prefs = {}) => {
  const now = Date.now();
  const snoozedIds = Object.entries(prefs.snoozedNotificationIds || {})
    .filter(([, value]) => {
      const untilTs = new Date(value).getTime();
      return !Number.isNaN(untilTs) && untilTs > now;
    })
    .map(([id]) => id);

  return {
    excludeIds: [...new Set([...(prefs.mutedNotificationIds || []), ...snoozedIds])],
    excludeTypes: Array.isArray(prefs.mutedTypes) ? prefs.mutedTypes : [],
  };
};

const compactNotificationPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const keys = [
    'source',
    'sourceLabel',
    'module',
    'entityType',
    'referenceNo',
    'referenceId',
    'taskId',
    'orderId',
    'transferRequestId',
    'productId',
    'campaignId',
    'customerId',
  ];
  const compact = {};
  keys.forEach((key) => {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') {
      compact[key] = payload[key];
    }
  });
  if (Array.isArray(payload.items)) {
    compact.items = payload.items.slice(0, 10).map((item) => ({
      id: item?.id || item?.productId || item?.sku || '',
      productId: item?.productId || item?.id || '',
      productName: item?.productName || item?.name || '',
      name: item?.name || item?.productName || '',
      quantity: item?.quantity ?? item?.qty ?? '',
      unit: item?.unit || '',
      barcode: item?.barcode || '',
    }));
    compact.itemCount = payload.items.length;
  }
  return Object.keys(compact).length ? compact : null;
};

const compactNotificationForList = (item = {}) => ({
  id: item.id,
  userId: item.userId,
  type: item.type,
  title: item.title,
  message: item.message,
  severity: item.severity,
  isRead: item.isRead,
  relatedTaskId: item.relatedTaskId,
  dedupeKey: item.dedupeKey,
  actionUrl: item.actionUrl,
  actionType: item.actionType,
  createdAt: item.createdAt,
  createdBy: item.createdBy,
  source: item.source,
  sourceLabel: item.sourceLabel,
  category: item.category,
  priority: item.priority,
  actionLabel: item.actionLabel,
  payload: compactNotificationPayload(item.payload),
});

const sortByPriorityAndTime = (items) => [...items].sort((left, right) => {
  const severityDelta = (PRIORITY_WEIGHT[right.severity] || 1) - (PRIORITY_WEIGHT[left.severity] || 1);
  if (severityDelta !== 0) return severityDelta;
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
});

const isTaskOpen = (task) => String(task?.status || '') !== 'completed';

export const notificationService = {
  async notifyUser({ userId, type, title, message, severity = 'low', relatedTaskId = null, dedupeKey = null, actionUrl = null, actionType = null, payload = null, createdBy = null }) {
    return maybeCreate({
      userId,
      type,
      title,
      message,
      severity,
      relatedTaskId,
      dedupeKey,
      actionUrl,
      actionType,
      payload,
      createdBy,
    });
  },

  async createManualNotification(actorUserId, payload = {}) {
    const title = toNotificationText(payload.title, '');
    const message = toNotificationText(payload.message, '');
    const type = String(payload.type || 'system').trim().toLowerCase() || 'system';
    const severity = String(payload.severity || 'medium').trim().toLowerCase();
    const actionUrl = String(payload.targetRoute || payload.actionUrl || '').trim() || '/bildirimler';
    const actionType = String(payload.actionType || '').trim().toLowerCase() || 'system';
    const isDraft = Boolean(payload.saveAsDraft);
    const targeting = normalizeTargeting(payload.targeting || {});
    const delivery = normalizeDelivery(payload.delivery || {});

    if (!title) {
      throw new AppError(400, 'Bildirim başlığı zorunludur.');
    }

    if (!message) {
      throw new AppError(400, 'Bildirim içeriği zorunludur.');
    }

    if (!VALID_SEVERITIES.has(severity)) {
      throw new AppError(400, 'Bildirim önceliği geçersiz.');
    }

    const sendAt = parseSafeDate(delivery.sendAt);
    if (delivery.sendAt && !sendAt) {
      throw new AppError(400, 'Planlanan gönderim tarihi geçersiz.');
    }

    const expiresAt = parseSafeDate(delivery.expiresAt);
    if (delivery.expiresAt && !expiresAt) {
      throw new AppError(400, 'Geçerlilik tarihi geçersiz.');
    }

    if (sendAt && expiresAt && expiresAt.getTime() <= sendAt.getTime()) {
      throw new AppError(400, 'Geçerlilik tarihi, planlanan tarihten sonra olmalıdır.');
    }

    if (targeting.mode === 'department' && targeting.departments.length === 0) {
      throw new AppError(400, 'En az bir departman seçin.');
    }

    if (targeting.mode === 'role' && targeting.roles.length === 0) {
      throw new AppError(400, 'En az bir rol seçin.');
    }

    if (targeting.mode === 'users' && targeting.userIds.length === 0) {
      throw new AppError(400, 'En az bir kullanıcı seçin.');
    }

    const targetUserIds = isDraft
      ? [actorUserId]
      : await resolveTargetUserIds(targeting);

    const finalRecipientIds = new Set(targetUserIds);
    finalRecipientIds.add(actorUserId);

    if (finalRecipientIds.size === 0) {
      throw new AppError(400, 'Hedef kullanıcı bulunamadı.');
    }

    const nowIso = new Date().toISOString();
    const createdRecords = [];

    for (const userId of finalRecipientIds) {
      const record = createNotificationRecord({
        userId,
        type,
        title,
        message,
        severity,
        actionUrl,
        actionType,
        createdBy: actorUserId,
        payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : null,
        audience: {
          mode: targeting.mode,
          departments: targeting.departments,
          roles: targeting.roles,
          userIds: targeting.userIds,
        },
        delivery: {
          sendAt: sendAt ? sendAt.toISOString() : nowIso,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          isPinned: delivery.isPinned,
          requireReadReceipt: delivery.requireReadReceipt,
        },
        isDraft,
      });

      if (sendAt && sendAt.getTime() > Date.now()) {
        record.createdAt = sendAt.toISOString();
      }

      await notificationRepo.create(record);
      createdRecords.push(record);
    }

    return {
      status: isDraft ? 'draft' : 'sent',
      recipientCount: createdRecords.length,
      targeting,
      delivery: {
        ...delivery,
        sendAt: sendAt ? sendAt.toISOString() : null,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
      notifications: createdRecords,
    };
  },

  async syncTaskAlertsForUser(userId) {
    if (!userId) return;

    const tasks = await taskRepo.findByAssignedTo(userId);
    const now = Date.now();

    for (const task of tasks) {
      if (!isTaskOpen(task)) {
        continue;
      }

      const dueDate = parseDate(task.dueDate);
      const createdAt = parseDate(task.createdAt);

      if (dueDate) {
        const diff = dueDate.getTime() - now;

        if (diff < 0) {
          const daysLate = Math.max(1, Math.floor((now - dueDate.getTime()) / DAY_MS));
          await maybeCreate({
            userId,
            type: 'overdue',
            title: 'Geciken Görev',
            message: `${task.taskNo || 'Görev'} görevi ${daysLate} gündür gecikti`,
            severity: 'high',
            relatedTaskId: task.id,
            dedupeKey: `overdue:${task.id}:${daysLate}`,
          });
        } else if (diff <= UPCOMING_WINDOW_MS) {
          await maybeCreate({
            userId,
            type: 'upcoming',
            title: 'Yaklaşan Son Tarih',
            message: `${task.taskNo || 'Görev'} görevinin süresi yarın doluyor`,
            severity: 'medium',
            relatedTaskId: task.id,
            dedupeKey: `upcoming:${task.id}:${String(task.dueDate)}`,
          });
        }
      }

      if (task.status === 'pending' && createdAt && (now - createdAt.getTime()) >= SLA_START_WINDOW_MS) {
        await maybeCreate({
          userId,
          type: 'sla',
          title: 'SLA Uyarısı',
          message: `${task.taskNo || 'Görev'} görevi belirlenen sürede bağlatılmadı`,
          severity: 'high',
          relatedTaskId: task.id,
          dedupeKey: `sla:${task.id}`,
        });
      }
    }
  },

  async handleTaskCreated(task, actorUser) {
    if (task?.assignedTo && task.assignedTo !== actorUser?.id) {
      await maybeCreate({
        userId: task.assignedTo,
        type: 'assigned',
        title: 'Yeni Görev Ataması',
        message: `Size yeni bir görev atandı: ${task.title}`,
        severity: 'medium',
        relatedTaskId: task.id,
      });
    }

    const mentionUsers = await resolveMentionedUserIds(task?.description);
    for (const mentionedUserId of mentionUsers) {
      if (mentionedUserId === actorUser?.id) continue;
      await maybeCreate({
        userId: mentionedUserId,
        type: 'mention',
        title: 'Bahsedildiniz',
        message: `${task.title} görevinde sizden bahsedildi`,
        severity: 'medium',
        relatedTaskId: task.id,
      });
    }
  },

  async handleTaskUpdated(previousTask, updatedTask, actorUser, options = {}) {
    const actorName = getActorName(actorUser);
    const statusOnly = Boolean(options.statusOnly);

    const previousAssignee = previousTask?.assignedTo || null;
    const nextAssignee = updatedTask?.assignedTo || null;

    if (nextAssignee && nextAssignee !== previousAssignee && nextAssignee !== actorUser?.id) {
      await maybeCreate({
        userId: nextAssignee,
        type: 'assigned',
        title: 'Yeni Görev Ataması',
        message: `Size yeni bir görev atandı: ${updatedTask.title}`,
        severity: 'medium',
        relatedTaskId: updatedTask.id,
      });
    }

    if (!statusOnly && nextAssignee && nextAssignee !== actorUser?.id) {
      await maybeCreate({
        userId: nextAssignee,
        type: 'updated',
        title: 'Görev Güncellendi',
        message: `${actorName}, ${updatedTask.title} görevini güncelledi`,
        severity: 'low',
        relatedTaskId: updatedTask.id,
      });
    }

    const previousMentions = new Set(await resolveMentionedUserIds(previousTask?.description));
    const nextMentions = await resolveMentionedUserIds(updatedTask?.description);

    for (const mentionedUserId of nextMentions) {
      if (mentionedUserId === actorUser?.id) continue;
      if (previousMentions.has(mentionedUserId)) continue;

      await maybeCreate({
        userId: mentionedUserId,
        type: 'mention',
        title: 'Bahsedildiniz',
        message: `${updatedTask.title} görevinde sizden bahsedildi`,
        severity: 'medium',
        relatedTaskId: updatedTask.id,
      });
    }
  },

  async handleTaskComment(task, commentText, actorUser) {
    const mentionedUsers = await resolveMentionedUserIds(commentText);
    for (const mentionedUserId of mentionedUsers) {
      if (mentionedUserId === actorUser?.id) continue;
      await maybeCreate({
        userId: mentionedUserId,
        type: 'comment',
        title: 'Yorum Bildirimi',
        message: `${task.title} görevinde sizden bahsedildi`,
        severity: 'medium',
        relatedTaskId: task.id,
      });
    }
  },

  async listForUser(userId, { page, limit, onlyUnread, severity, active = true, assigned } = {}) {
    const pagination = parsePagePagination({ page, limit }, { defaultLimit: 30, maxLimit: 200 });
    const { current: prefs } = await getUserNotificationPrefs(userId);
    const queryOptions = {
      ...buildPreferenceQueryOptions(prefs),
      skip: pagination.skip,
      take: pagination.limit,
      onlyUnread,
      severity,
      active,
      assigned,
    };
    const [items, total] = await Promise.all([
      notificationRepo.findByUserIdPaged(userId, queryOptions),
      notificationRepo.countByUserId(userId, queryOptions),
    ]);

    return {
      items: items.map((item) => ({ ...compactNotificationForList(item), mutedByRule: false })),
      pagination: {
        mode: 'offset',
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
        hasNextPage: pagination.skip + items.length < total,
        nextCursor: null,
        cursorVersion: null,
      },
      filters: {
        unread: Boolean(onlyUnread),
        severity: severity || null,
        active: Boolean(active),
        assigned: Boolean(assigned),
      },
      sort: { key: 'createdAt_desc', direction: 'desc' },
    };
  },

  async getSummary(userId) {
    const { current: prefs } = await getUserNotificationPrefs(userId);
    return notificationRepo.getSummaryByUserId(userId, buildPreferenceQueryOptions(prefs));
  },

  async markAsRead(userId, notificationId) {
    const existing = await notificationRepo.findById(notificationId);
    if (!existing || existing.userId !== userId) {
      throw createNotFoundError('Bildirim bulunamadı');
    }

    if (existing.isRead) {
      return existing;
    }

    const updated = {
      ...existing,
      isRead: true,
    };

    await notificationRepo.updateById(notificationId, updated);
    return updated;
  },

  async trackAction(userId, notificationId, actionName = 'open') {
    const existing = await notificationRepo.findById(notificationId);
    if (!existing || existing.userId !== userId) {
      throw createNotFoundError('Bildirim bulunamadı');
    }

    const now = new Date().toISOString();
    const actionLog = Array.isArray(existing.actionLog) ? [...existing.actionLog] : [];
    actionLog.push({ at: now, action: String(actionName || 'open') });

    const updated = {
      ...existing,
      isRead: true,
      actionTakenAt: now,
      actionLog,
    };

    await notificationRepo.updateById(notificationId, updated);
    return updated;
  },

  async snoozeForUser(userId, notificationId, preset = '1h') {
    const existing = await notificationRepo.findById(notificationId);
    if (!existing || existing.userId !== userId) {
      throw createNotFoundError('Bildirim bulunamadı');
    }

    const normalizedPreset = String(preset || '1h').toLowerCase();
    const offset = SNOOZE_PRESETS[normalizedPreset];
    const snoozedUntil = offset === null
      ? buildEndOfDayIso()
      : new Date(Date.now() + (offset || SNOOZE_PRESETS['1h'])).toISOString();

    const { current } = await getUserNotificationPrefs(userId);
    const nextPrefs = {
      ...current,
      snoozedNotificationIds: {
        ...current.snoozedNotificationIds,
        [notificationId]: snoozedUntil,
      },
    };

    await saveUserNotificationPrefs(userId, nextPrefs);
    return { notificationId, snoozedUntil };
  },

  async muteNotificationForUser(userId, notificationId) {
    const existing = await notificationRepo.findById(notificationId);
    if (!existing || existing.userId !== userId) {
      throw createNotFoundError('Bildirim bulunamadı');
    }

    const { current } = await getUserNotificationPrefs(userId);
    const next = {
      ...current,
      mutedNotificationIds: current.mutedNotificationIds.includes(notificationId)
        ? current.mutedNotificationIds
        : [...current.mutedNotificationIds, notificationId],
    };

    await saveUserNotificationPrefs(userId, next);
    return { notificationId, muted: true };
  },

  async muteTypeForUser(userId, type) {
    const normalizedType = String(type || '').trim().toLowerCase();
    const { current } = await getUserNotificationPrefs(userId);
    const next = {
      ...current,
      mutedTypes: current.mutedTypes.includes(normalizedType)
        ? current.mutedTypes
        : [...current.mutedTypes, normalizedType],
    };

    await saveUserNotificationPrefs(userId, next);
    return { type: normalizedType, muted: true };
  },

  async getAnalytics(userId) {
    const actionMap = new Map();
    const { current: prefs } = await getUserNotificationPrefs(userId);
    const analytics = await notificationRepo.getAnalyticsByUserId(userId, buildPreferenceQueryOptions(prefs));
    analytics.recentActions.forEach((log) => {
      log.forEach((entry) => {
        const action = String(entry?.action || 'open').toLowerCase();
        actionMap.set(action, (actionMap.get(action) || 0) + 1);
      });
    });

    const mostFrequentType = analytics.typeRows?.[0] || null;
    const mostActioned = [...actionMap.entries()].sort((a, b) => b[1] - a[1])[0] || null;

    return {
      total: analytics.total,
      mostFrequentType: mostFrequentType
        ? {
          type: mostFrequentType.type || 'system',
          typeLabel: toTurkishLabel(mostFrequentType.type || 'system', TYPE_LABELS_TR),
          count: mostFrequentType._count?._all || 0,
        }
        : null,
      mostActioned: mostActioned
        ? {
          action: mostActioned[0],
          actionLabel: toTurkishLabel(mostActioned[0], ACTION_LABELS_TR),
          count: mostActioned[1],
        }
        : null,
    };
  },

  async markAllAsRead(userId) {
    await notificationRepo.markAllAsRead(userId);
    return this.getSummary(userId);
  },

  async removeManyForUser(userId, notificationIds = []) {
    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return this.getSummary(userId);
    }

    for (const notificationId of notificationIds) {
      const existing = await notificationRepo.findById(notificationId);
      if (existing && existing.userId === userId) {
        await notificationRepo.deleteById(notificationId);
      }
    }

    return this.getSummary(userId);
  },
};

