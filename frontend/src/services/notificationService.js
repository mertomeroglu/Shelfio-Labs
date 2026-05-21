import { api, buildQueryString } from './api.js';

import { normalizeTurkishText } from '../utils/turkishText.js';

const NOTIFICATIONS_CHANGED_EVENT = 'shelfio:notifications-changed';
export const NOTIFICATION_PREFS_KEY = 'shelfio.notification.preferences.v1';
export const NOTIFICATION_TYPE_OPTIONS = [
  { type: 'task', label: 'Görevler', description: 'Görev atama, güncelleme ve gecikme bildirimlerini gösterir.' },
  { type: 'stock', label: 'Stok', description: 'Genel stok hareketi ve stok uyarılarını gösterir.' },
  { type: 'critical_stock', label: 'Kritik Stok', description: 'Kritik seviyenin altına düşen ürünleri bildirir.' },
  { type: 'expiry_soon', label: 'SKT Yaklaşan Ürünler', description: 'Son kullanma tarihi yaklaşan ürünleri gösterir.' },
  { type: 'skt_expired', label: 'SKT Geçti', description: 'SKT tarihi dolan parti ve ürün stoklarını bildirir.' },
  { type: 'order', label: 'Siparişler', description: 'Sipariş akışı ve onay bildirimlerini gösterir.' },
  { type: 'purchase_suggestion', label: 'Sipariş Önerileri', description: 'Otomatik sipariş önerisi ve tedarik sinyallerini gösterir.' },
  { type: 'campaign', label: 'Kampanya Yönetimi', description: 'Kampanya başlangıç, bitiş ve performans bildirimlerini gösterir.' },
  { type: 'gift_card', label: 'Hediye Kartı', description: 'Hediye kartı tanımlama ve kullanım bildirimlerini gösterir.' },
  { type: 'transfer_request', label: 'Depo Transfer Talepleri', description: 'Depo transfer talebi ve durum güncellemelerini gösterir.' },
  { type: 'goods_receipt', label: 'Mal Kabul', description: 'Mal kabul ve teslim alma bildirimlerini gösterir.' },
  { type: 'batch_entry', label: 'Parti Girişi', description: 'Parti ve lot bazlı giriş bildirimlerini gösterir.' },
  { type: 'esl', label: 'ESL / Etiket Yönetimi', description: 'Elektronik etiket güncelleme ve hata bildirimlerini gösterir.' },
  { type: 'pricing_analysis', label: 'Fiyat & Talep Analizi', description: 'Fiyat ve talep analizi sinyallerini gösterir.' },
  { type: 'report', label: 'Raporlar', description: 'Rapor üretimi ve hesaplama sonuçlarını gösterir.' },
  { type: 'access_request', label: 'Erişim Talepleri', description: 'Geçici erişim talepleri ve karar bildirimlerini gösterir.' },
];
export const DEFAULT_NOTIFICATION_SETTINGS = {
  task: true,
  stock: true,
  critical_stock: true,
  expiry_soon: true,
  skt_expired: true,
  order: true,
  purchase_suggestion: true,
  campaign: true,
  gift_card: true,
  transfer_request: true,
  goods_receipt: true,
  batch_entry: true,
  esl: true,
  pricing_analysis: true,
  report: true,
  access_request: true,
};
export const NOTIFICATION_TYPE_ALIASES = {
  task: ['task', 'overdue', 'upcoming', 'sla', 'assigned', 'updated', 'mention', 'comment', 'task_overdue', 'task_updated'],
  stock: ['stock', 'stock_out', 'out_of_stock', 'stockout', 'stok_bitimi', 'inventory', 'stock_alert'],
  critical_stock: ['critical_stock', 'low_stock', 'kritik_stok'],
  expiry_soon: ['expiry_soon', 'expiring', 'expiration_soon', 'skt_yaklasan'],
  skt_expired: ['skt_expired', 'expired_batch', 'expiration_expired', 'skt_gecmis', 'skt_geçmiş'],
  order: ['order', 'purchase_order', 'order_approval', 'siparis', 'procurement'],
  purchase_suggestion: ['purchase_suggestion', 'purchase_suggestions', 'order_recommendation', 'siparis_onerisi'],
  campaign: ['campaign', 'campaign_management', 'promotion', 'announcement_campaign'],
  gift_card: ['gift_card', 'giftcard', 'hediye_karti'],
  transfer_request: ['transfer_request', 'transfer_requests', 'stock_transfer', 'warehouse_transfer', 'depo_transfer_talebi'],
  goods_receipt: ['goods_receipt', 'mal_kabul', 'delivery_receipt'],
  batch_entry: ['batch_entry', 'batch', 'lot_entry', 'parti_girisi'],
  esl: ['esl', 'label', 'etiket', 'label_update'],
  pricing_analysis: ['pricing_analysis', 'price_analysis', 'demand_analysis', 'fiyat_talep_analizi'],
  report: ['report', 'reports', 'report_ready', 'rapor'],
  access_request: ['access_request', 'access_request_opened', 'access_request_rejected', 'access_granted', 'access_expired', 'erisim_talebi'],
};

function emitNotificationsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT));
}

export function sanitizeNotificationSettings(value) {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
  const normalized = { ...DEFAULT_NOTIFICATION_SETTINGS };
  Object.keys(DEFAULT_NOTIFICATION_SETTINGS).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      normalized[key] = Boolean(value[key]);
    }
  });
  return normalized;
}

export function readNotificationSettings() {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATION_SETTINGS };
    return sanitizeNotificationSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }
}

export function isNotificationEnabled(type, settings = DEFAULT_NOTIFICATION_SETTINGS) {
  const normalizedType = String(type || '').toLowerCase();
  const directValue = settings[normalizedType];
  if (typeof directValue === 'boolean') {
    return directValue;
  }
  const groupedType = Object.keys(NOTIFICATION_TYPE_ALIASES).find((key) => (
    NOTIFICATION_TYPE_ALIASES[key].includes(normalizedType)
  ));
  if (groupedType) {
    return settings[groupedType] !== false;
  }
  return true;
}

export function getNotificationTypeMeta(type) {
  const normalizedType = String(type || '').toLowerCase();
  const groupedType = Object.keys(NOTIFICATION_TYPE_ALIASES).find((key) => (
    key === normalizedType || NOTIFICATION_TYPE_ALIASES[key].includes(normalizedType)
  ));
  return NOTIFICATION_TYPE_OPTIONS.find((item) => item.type === (groupedType || normalizedType)) || null;
}

export function getVisibleNotifications(notifications = [], settings = DEFAULT_NOTIFICATION_SETTINGS) {
  return (Array.isArray(notifications) ? notifications : []).filter((item) =>
    isNotificationEnabled(item?.type, settings)
  );
}

export function getUnreadNotificationCount(notifications = [], settings = DEFAULT_NOTIFICATION_SETTINGS) {
  return getVisibleNotifications(notifications, settings).reduce(
    (count, item) => (item?.isRead ? count : count + 1),
    0
  );
}

export function isTaskNotification(item = {}) {
  const actionType = String(item?.actionType || '').toLowerCase();
  const category = String(item?.category || '').toLowerCase();
  const type = String(item?.type || '').toLowerCase();
  return actionType === 'task'
    || category === 'task'
    || type === 'task'
    || TASK_TYPES.has(type)
    || Boolean(item?.relatedTaskId);
}

export function getUnreadTaskNotificationCount(notifications = [], settings = DEFAULT_NOTIFICATION_SETTINGS) {
  return getVisibleNotifications(notifications, settings).reduce(
    (count, item) => (!item?.isRead && isTaskNotification(item) ? count + 1 : count),
    0
  );
}

const TASK_TYPES = new Set(['overdue', 'sla', 'upcoming', 'assigned', 'updated', 'comment', 'mention']);
const GENERIC_NOTIFICATION_ROUTES = new Set(['/anasayfa', '/dashboard', '/bildirimler', '/']);
const STOCK_NOTIFICATION_TYPES = new Set(['stock', 'critical_stock', 'expiry_soon', 'skt_expired', 'goods_receipt', 'batch_entry']);
const ORDER_NOTIFICATION_TYPES = new Set(['order', 'purchase_order', 'order_approval', 'siparis', 'procurement']);
const ACCESS_NOTIFICATION_TYPES = new Set(['access_request', 'access_request_opened', 'access_request_rejected', 'access_granted', 'access_expired', 'erisim_talebi']);

const pickFirstString = (...values) => {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
};

const normalizeRoutePath = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith('/') ? raw : `/${raw}`;
};

const resolveRouteState = (item = {}) => {
  const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
  const entityId = payload.entityId || payload.id || payload.refId || payload.productId || payload.orderId || payload.requestId || payload.taskId || null;
  const referenceCode = payload.referenceCode || payload.referenceNo || payload.orderNumber || payload.transferCode || payload.requestCode || payload.requestId || null;
  const state = {
    notificationId: item.id,
    entityId,
    referenceCode,
  };

  if (item.relatedTaskId) {
    state.openTaskId = item.relatedTaskId;
  }
  if (payload.productId || payload.entityType === 'product') {
    state.highlightProductId = payload.productId || payload.entityId || payload.id || null;
  }
  if (payload.orderId || payload.orderNumber || payload.entityType === 'order') {
    state.openOrderId = payload.orderId || payload.entityId || payload.id || null;
    state.openOrderNumber = payload.orderNumber || payload.referenceCode || payload.referenceNo || null;
  }
  if (payload.requestId || payload.entityType === 'access_request') {
    state.openRequestId = payload.requestId || payload.entityId || payload.id || null;
  }
  if (payload.quickAssignProductId) {
    state.quickAssignProductId = payload.quickAssignProductId;
  }

  return state;
};

function normalizePriority(value) {
  const severity = String(value || '').toLowerCase();
  if (severity === 'critical') return 'high';
  if (severity === 'high') return 'high';
  if (severity === 'warning') return 'medium';
  if (severity === 'medium') return 'medium';
  return 'low';
}

function inferActionType(item) {
  if (item?.actionType) {
    return String(item.actionType).toLowerCase();
  }

  const type = String(item?.type || '').toLowerCase();
  const payloadType = String(item?.payload?.entityType || item?.payload?.module || '').toLowerCase();
  const combined = `${type} ${payloadType}`;
  if (item?.relatedTaskId || TASK_TYPES.has(type)) return 'task';
  if (combined.includes('transfer')) return 'transfer_request';
  if (combined.includes('access')) return 'access_request';
  if (combined.includes('return') || combined.includes('iade')) return 'return';
  if (combined.includes('campaign') || combined.includes('promotion') || combined.includes('kampanya')) return 'campaign';
  if (combined.includes('price') || combined.includes('pricing') || combined.includes('fiyat')) return 'pricing_analysis';
  if (combined.includes('gift')) return 'gift_card';
  if (combined.includes('esl') || combined.includes('label') || combined.includes('etiket')) return 'esl';
  if (combined.includes('report') || combined.includes('rapor')) return 'report';
  if (combined.includes('suggestion') || combined.includes('oner')) return 'purchase_suggestion';
  if (combined.includes('order') || combined.includes('siparis') || combined.includes('purchase') || combined.includes('approval')) return 'order';
  if (combined.includes('skt_expired') || combined.includes('skt') || combined.includes('expiry') || combined.includes('expired')) return 'stock';
  if (combined.includes('goods_receipt') || combined.includes('mal_kabul') || combined.includes('batch')) return 'stock';
  if (combined.includes('stock') || combined.includes('stok') || combined.includes('expiry') || combined.includes('inventory') || combined.includes('batch')) return 'stock';
  return 'system';
}

function inferActionUrl(actionType, item) {
  const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
  const explicitRoute = normalizeRoutePath(
    pickFirstString(
      item?.targetRoute,
      payload.targetRoute,
      payload.route,
      payload.moduleRoute,
      item?.actionUrl
    )
  );
  if (explicitRoute && !GENERIC_NOTIFICATION_ROUTES.has(explicitRoute.toLowerCase())) return explicitRoute;
  if (actionType === 'task') return '/gorev-planlama';
  if (actionType === 'transfer_request') return '/depo-transfer-talepleri';
  if (actionType === 'order') return '/siparis-takibi';
  if (actionType === 'purchase_suggestion') return '/siparis-onerileri';
  if (actionType === 'stock') {
    return payload.productId || payload.entityType === 'product' ? '/urunler' : '/stok-islemleri';
  }
  if (actionType === 'return') return '/pos-kasa';
  if (actionType === 'access_request') return '/erisim-talepleri';
  if (actionType === 'campaign' || actionType === 'gift_card') return '/kampanya-yonetimi';
  if (actionType === 'pricing_analysis') return '/fiyat-talep-analizi';
  if (actionType === 'esl') return '/etiket-yonetimi';
  if (actionType === 'report') return '/raporlar';
  return '';
}

function inferActionLabel(actionType, item) {
  const type = String(item?.type || '').toLowerCase();
  const title = String(item?.title || '').toLocaleLowerCase('tr-TR');
  if (actionType === 'mobile_order_draft' || title.includes('mobil sipariş tasla')) return 'Detay Görüntüle';
  if (actionType === 'task') return 'Göreve Git';
  if (actionType === 'stock') return 'Stokları Gör';
  if (actionType === 'transfer_request') return 'Transferi İncele';
  if (actionType === 'access_request') return 'Talebi İncele';
  if (actionType === 'return') return 'İadeyi İncele';
  if (actionType === 'campaign' || actionType === 'pricing_analysis' || actionType === 'gift_card') return 'İncele';
  if (actionType === 'order') {
    if (type.includes('approval') || type.includes('onay') || type.includes('bekliyor')) return 'Onaya Git';
    return 'Siparişleri Gör';
  }
  return 'İncele';
}

function inferCategory(actionType) {
  if (actionType === 'task') return 'task';
  if (actionType === 'order' || actionType === 'purchase_suggestion') return 'order';
  return 'system';
}

function toUserFriendlyNotificationText(value) {
  const raw = normalizeTurkishText(value);
  if (!raw) return '';
  return raw
    .replace(/\bSLA bildirimi\b/gi, 'Gecikme Uyarısı')
    .replace(/\bSLA uyarısı\b/gi, 'Gecikme Uyarısı')
    .replace(/\bSLA notification\b/gi, 'Gecikme Uyarısı')
    .replace(/\bSLA riski\b/gi, 'Gecikme Uyarısı')
    .replace(/\bSLA riskleri\b/gi, 'Gecikme Uyarıları')
    .replace(/\bSLA\b/gi, 'Gecikme');
}

export function normalizeNotification(item = {}) {
  const actionType = inferActionType(item);
  return {
    id: item.id,
    type: item.type || 'system',
    title: toUserFriendlyNotificationText(item.title || 'Bildirim'),
    description: toUserFriendlyNotificationText(item.description || item.message || ''),
    isRead: Boolean(item.isRead),
    priority: normalizePriority(item.priority || item.severity),
    createdAt: item.createdAt,
    actionUrl: inferActionUrl(actionType, item),
    actionType,
    actionLabel: inferActionLabel(actionType, item),
    category: inferCategory(actionType),
    relatedTaskId: item.relatedTaskId || null,
    message: toUserFriendlyNotificationText(item.message || item.description || ''),
    payload: item.payload || null,
    createdBy: item.createdBy || null,
  };
}

export function resolveNotificationDestination(item = {}) {
  const actionType = inferActionType(item);
  const route = inferActionUrl(actionType, item);
  const state = resolveRouteState(item);
  if (route) {
    return { route, state, fallbackMessage: '' };
  }

  const type = String(item?.type || '').toLowerCase();
  if ((actionType === 'access_request' || ACCESS_NOTIFICATION_TYPES.has(type)) && (state.openRequestId || state.entityId || state.referenceCode)) {
    return { route: '/erisim-talepleri', state, fallbackMessage: '' };
  }
  if ((actionType === 'order' || ORDER_NOTIFICATION_TYPES.has(type)) && (state.openOrderId || state.openOrderNumber || state.entityId || state.referenceCode)) {
    return { route: '/siparis-takibi', state, fallbackMessage: '' };
  }
  if (actionType === 'system' && !type) {
    return { route: '', state, fallbackMessage: 'Bu bildirim için detay bağlantısı bulunamadı.' };
  }

  if (STOCK_NOTIFICATION_TYPES.has(type)) {
    return { route: state.highlightProductId ? '/urunler' : '/stok-islemleri', state, fallbackMessage: '' };
  }

  return { route: '', state, fallbackMessage: 'Bu bildirim için detay bağlantısı bulunamadı.' };
}

export const notificationEvents = {
  changed: NOTIFICATIONS_CHANGED_EVENT,
};

export const notificationService = {
  create: async (payload = {}) => {
    const response = await api.post('/notifications/broadcast', payload);
    emitNotificationsChanged();
    return response;
  },
  list: async (params = {}) => {
    const list = await api.get(`/notifications${buildQueryString(params)}`);
    return Array.isArray(list) ? list.map((item) => normalizeNotification(item)) : [];
  },
  summary: () => api.get('/notifications/summary'),
  analytics: () => api.get('/notifications/analytics'),
  markAsRead: async (id) => {
    const response = await api.patch(`/notifications/${id}/read`);
    emitNotificationsChanged();
    return response;
  },
  trackAction: async (id, action = 'open') => {
    const response = await api.post(`/notifications/${id}/action`, { action });
    emitNotificationsChanged();
    return response;
  },
  snooze: async (id, preset = '1h') => {
    const response = await api.post(`/notifications/${id}/snooze`, { preset });
    emitNotificationsChanged();
    return response;
  },
  mute: async (id) => {
    const response = await api.post(`/notifications/${id}/mute`, {});
    emitNotificationsChanged();
    return response;
  },
  muteType: async (type) => {
    const response = await api.post('/notifications/mute-type', { type });
    emitNotificationsChanged();
    return response;
  },
  markAllAsRead: async () => {
    const response = await api.patch('/notifications/read-all');
    emitNotificationsChanged();
    return response;
  },
  deleteMany: async (ids = []) => {
    const response = await api.delete('/notifications', { ids });
    emitNotificationsChanged();
    return response;
  },
};
