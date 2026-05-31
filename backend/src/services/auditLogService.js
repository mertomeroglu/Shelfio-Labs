import { auditLogRepo } from '../repositories/auditLogRepository.js';
import { accessAuditLogRepo } from '../repositories/accessAuditLogRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { getPrisma } from '../providers/postgresProvider.js';

const MAX_AUDIT_LIMIT = 500;
const SENSITIVE_KEY_PATTERN = /(password|pass|token|secret|authorization|cookie|pin|code|license|card|cvv|iban|phone|email|tc|identity|file|base64|image|attachment)/i;

const cleanText = (value, max = 500) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...(truncated)` : text;
};

const parseDateBoundary = (value, suffix) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const date = new Date(`${text}${suffix}`);
  return Number.isFinite(date.getTime()) ? date : null;
};

const maskSensitiveData = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 5) return '[max-depth]';
  if (typeof value === 'string') return cleanText(value, 700);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => maskSensitiveData(item, depth + 1));

  const masked = {};
  Object.entries(value).slice(0, 80).forEach(([key, raw]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      masked[key] = '***';
      return;
    }
    masked[key] = maskSensitiveData(raw, depth + 1);
  });
  return masked;
};

const normalizeEndpoint = (value = '') => String(value || '')
  .split('?')[0]
  .replace(/^\/api(?=\/|$)/, '')
  .replace(/\/+/g, '/')
  .replace(/\/$/, '') || '/';

const routeMatches = (path, pattern) => {
  const pathParts = normalizeEndpoint(path).split('/').filter(Boolean);
  const patternParts = normalizeEndpoint(pattern).split('/').filter(Boolean);
  if (pathParts.length !== patternParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
};

const actionMappings = [
  { method: 'POST', pattern: '/auth/login', module: 'auth', action: 'Giriş yapıldı', entityType: 'session' },
  { method: 'POST', pattern: '/products', module: 'products', action: 'Ürün oluşturuldu', entityType: 'product' },
  { method: 'PUT', pattern: '/products/:id', module: 'products', action: 'Ürün güncellendi', entityType: 'product' },
  { method: 'PATCH', pattern: '/products/:id', module: 'products', action: 'Ürün güncellendi', entityType: 'product' },
  { method: 'DELETE', pattern: '/products/:id', module: 'products', action: 'Ürün silindi', entityType: 'product', severity: 'critical' },
  { method: 'POST', pattern: '/stock/movements', module: 'stock', action: 'Stok hareketi oluşturuldu', entityType: 'stock_movement' },
  { method: 'POST', pattern: '/stock/in', module: 'stock', action: 'Stok girişi yapıldı', entityType: 'stock_movement' },
  { method: 'POST', pattern: '/stock/out', module: 'stock', action: 'Stok çıkışı yapıldı', entityType: 'stock_movement', severity: 'warning' },
  { method: 'POST', pattern: '/stock/adjust', module: 'stock', action: 'Stok düzeltildi', entityType: 'stock_movement', severity: 'warning' },
  { method: 'POST', pattern: '/stock/transfer', module: 'stock', action: 'Stok transfer edildi', entityType: 'stock_movement' },
  { method: 'PUT', pattern: '/stock/products/:productId/batches', module: 'stock', action: 'Stok parti bilgisi güncellendi', entityType: 'stock_batch' },
  { method: 'POST', pattern: '/stock/movements/:id/cancel', module: 'stock', action: 'Stok hareketi iptal edildi', entityType: 'stock_movement', severity: 'critical' },
  { method: 'POST', pattern: '/stock/expired-batches/dispose', module: 'stock', action: 'SKT stoğu imha edildi', entityType: 'stock_movement', severity: 'critical' },
  { method: 'POST', pattern: '/stock/expiry/expired-notifications/run', module: 'stock', action: 'SKT bildirimleri çalıştırıldı', entityType: 'stock_expiry' },
  { method: 'POST', pattern: '/stock/disposal', module: 'stock', action: 'Stok imha edildi', entityType: 'stock_movement', severity: 'critical' },
  { method: 'POST', pattern: '/pos/sales', module: 'pos', action: 'Satış yapıldı', entityType: 'sale' },
  { method: 'POST', pattern: '/pos/sales/automatic', module: 'pos', action: 'Otomatik satış yapıldı', entityType: 'sale', source: 'automation' },
  { method: 'POST', pattern: '/pos/returns', module: 'pos', action: 'İade alındı', entityType: 'sale_return', severity: 'warning' },
  { method: 'POST', pattern: '/pos/day-end/close', module: 'pos', action: 'Gün sonu kapatıldı', entityType: 'day_end' },
  { method: 'PATCH', pattern: '/pos/desks/activation-status', module: 'pos', action: 'Kasa durumu güncellendi', entityType: 'pos_desk' },
  { method: 'POST', pattern: '/procurement/orders', module: 'procurement', action: 'Sipariş oluşturuldu', entityType: 'purchase_order' },
  { method: 'PATCH', pattern: '/procurement/orders/:id/status', module: 'procurement', action: 'Sipariş durumu güncellendi', entityType: 'purchase_order' },
  { method: 'POST', pattern: '/procurement/logistics-quote', module: 'procurement', action: 'Lojistik teklif hesaplandı', entityType: 'logistics_quote' },
  { method: 'POST', pattern: '/procurement/supplier-products', module: 'procurement', action: 'Tedarikçi ürünü oluşturuldu', entityType: 'supplier_product' },
  { method: 'PUT', pattern: '/procurement/supplier-products/:id', module: 'procurement', action: 'Tedarikçi ürünü güncellendi', entityType: 'supplier_product' },
  { method: 'DELETE', pattern: '/procurement/supplier-products/:id', module: 'procurement', action: 'Tedarikçi ürünü silindi', entityType: 'supplier_product', severity: 'warning' },
  { method: 'POST', pattern: '/settings', module: 'settings', action: 'Ayar güncellendi', entityType: 'settings' },
  { method: 'PUT', pattern: '/settings', module: 'settings', action: 'Ayar güncellendi', entityType: 'settings' },
  { method: 'PUT', pattern: '/settings/logistics-tariffs', module: 'settings', action: 'Lojistik tarifeleri güncellendi', entityType: 'settings' },
  { method: 'PATCH', pattern: '/settings/system-desk-pin', module: 'settings', action: 'Kasa PIN güncellendi', entityType: 'settings' },
  { method: 'DELETE', pattern: '/settings/logs/:type', module: 'settings', action: 'Log kayıtları temizlendi', entityType: 'log', severity: 'warning' },
  { method: 'POST', pattern: '/esl/send', module: 'esl', action: 'Etiket cihaza gönderildi', entityType: 'esl_device' },
  { method: 'POST', pattern: '/esl/clear', module: 'esl', action: 'Etiket temizlendi', entityType: 'esl_device', severity: 'warning' },
  { method: 'POST', pattern: '/esl/devices/:id/clear-label', module: 'esl', action: 'Etiket temizlendi', entityType: 'esl_device', severity: 'warning' },
  { method: 'DELETE', pattern: '/esl/history', module: 'esl', action: 'Etiket geçmişi temizlendi', entityType: 'esl_history', severity: 'warning' },
  { method: 'POST', pattern: '/esl/devices', module: 'esl', action: 'ESL cihazı oluşturuldu', entityType: 'esl_device' },
  { method: 'PUT', pattern: '/esl/devices/:id', module: 'esl', action: 'ESL cihazı güncellendi', entityType: 'esl_device' },
  { method: 'DELETE', pattern: '/esl/devices/:id', module: 'esl', action: 'ESL cihazı silindi', entityType: 'esl_device', severity: 'warning' },
  { method: 'POST', pattern: '/users', module: 'users', action: 'Kullanıcı oluşturuldu', entityType: 'user', severity: 'warning' },
  { method: 'PUT', pattern: '/users/:id', module: 'users', action: 'Kullanıcı güncellendi', entityType: 'user', severity: 'warning' },
  { method: 'PATCH', pattern: '/users/:id', module: 'users', action: 'Kullanıcı güncellendi', entityType: 'user', severity: 'warning' },
  { method: 'DELETE', pattern: '/users/:id', module: 'users', action: 'Kullanıcı silindi', entityType: 'user', severity: 'critical' },
  { method: 'POST', pattern: '/notifications', module: 'notifications', action: 'Bildirim oluşturuldu', entityType: 'notification' },
  { method: 'POST', pattern: '/notifications/broadcast', module: 'notifications', action: 'Bildirim oluşturuldu', entityType: 'notification' },
  { method: 'PATCH', pattern: '/notifications/read-all', module: 'notifications', action: 'Bildirimler okundu yapıldı', entityType: 'notification' },
  { method: 'PATCH', pattern: '/notifications/:id/read', module: 'notifications', action: 'Bildirim okundu yapıldı', entityType: 'notification' },
  { method: 'POST', pattern: '/notifications/:id/action', module: 'notifications', action: 'Bildirim aksiyonu işlendi', entityType: 'notification' },
  { method: 'POST', pattern: '/notifications/:id/snooze', module: 'notifications', action: 'Bildirim ertelendi', entityType: 'notification' },
  { method: 'POST', pattern: '/notifications/:id/mute', module: 'notifications', action: 'Bildirim susturuldu', entityType: 'notification' },
  { method: 'POST', pattern: '/notifications/mute-type', module: 'notifications', action: 'Bildirim türü susturuldu', entityType: 'notification' },
  { method: 'DELETE', pattern: '/notifications', module: 'notifications', action: 'Bildirim silindi', entityType: 'notification', severity: 'warning' },
  { method: 'POST', pattern: '/access-requests', module: 'access', action: 'Erişim talebi oluşturuldu', entityType: 'access_request' },
  { method: 'POST', pattern: '/access-requests/:id/approve', module: 'access', action: 'Erişim talebi onaylandı', entityType: 'access_request', severity: 'critical' },
  { method: 'POST', pattern: '/access-requests/:id/reject', module: 'access', action: 'Erişim talebi reddedildi', entityType: 'access_request', severity: 'warning' },
  { method: 'POST', pattern: '/access-requests/:id/extend', module: 'access', action: 'Erişim süresi uzatıldı', entityType: 'access_request', severity: 'critical' },
  { method: 'POST', pattern: '/temporary-grants', module: 'access', action: 'Geçici yetki oluşturuldu', entityType: 'temporary_grant', severity: 'critical' },
  { method: 'DELETE', pattern: '/temporary-grants/:id', module: 'access', action: 'Geçici yetki iptal edildi', entityType: 'temporary_grant', severity: 'critical' },
  { method: 'POST', pattern: '/temporary-grants/:id/revoke', module: 'access', action: 'Geçici yetki iptal edildi', entityType: 'temporary_grant', severity: 'critical' },
  { method: 'POST', pattern: '/categories', module: 'categories', action: 'Kategori oluşturuldu', entityType: 'category' },
  { method: 'PUT', pattern: '/categories/:id', module: 'categories', action: 'Kategori güncellendi', entityType: 'category' },
  { method: 'DELETE', pattern: '/categories/:id', module: 'categories', action: 'Kategori silindi', entityType: 'category', severity: 'warning' },
  { method: 'POST', pattern: '/suppliers', module: 'suppliers', action: 'Tedarikçi oluşturuldu', entityType: 'supplier' },
  { method: 'PUT', pattern: '/suppliers/:id', module: 'suppliers', action: 'Tedarikçi güncellendi', entityType: 'supplier' },
  { method: 'DELETE', pattern: '/suppliers/:id', module: 'suppliers', action: 'Tedarikçi silindi', entityType: 'supplier', severity: 'warning' },
  { method: 'POST', pattern: '/customers', module: 'customers', action: 'Müşteri oluşturuldu', entityType: 'customer' },
  { method: 'PUT', pattern: '/customers/:id', module: 'customers', action: 'Müşteri güncellendi', entityType: 'customer' },
  { method: 'PATCH', pattern: '/customers/:id', module: 'customers', action: 'Müşteri güncellendi', entityType: 'customer' },
  { method: 'PATCH', pattern: '/customers/:id/status', module: 'customers', action: 'Müşteri durumu güncellendi', entityType: 'customer' },
  { method: 'POST', pattern: '/customers/:id/gift-cards', module: 'customers', action: 'Müşteriye hediye kartı tanımlandı', entityType: 'gift_card' },
  { method: 'POST', pattern: '/customers/gift-cards/bulk-assign', module: 'customers', action: 'Toplu hediye kartı tanımlandı', entityType: 'gift_card' },
  { method: 'POST', pattern: '/customers/:id/discounts', module: 'customers', action: 'Müşteri indirimi tanımlandı', entityType: 'customer_discount' },
  { method: 'POST', pattern: '/customers/notifications/send', module: 'customers', action: 'Müşteri bildirimi gönderildi', entityType: 'customer_notification' },
  { method: 'POST', pattern: '/warehouse/movements', module: 'warehouse', action: 'Depo hareketi oluşturuldu', entityType: 'warehouse_movement' },
  { method: 'PATCH', pattern: '/warehouse/locations/:id', module: 'warehouse', action: 'Depo lokasyonu güncellendi', entityType: 'warehouse_location' },
];

const resolveRouteMapping = (method, endpoint) => {
  const normalizedMethod = String(method || '').toUpperCase();
  const matched = actionMappings.find((item) => item.method === normalizedMethod && routeMatches(endpoint, item.pattern));
  if (matched) return matched;

  const module = normalizeEndpoint(endpoint).split('/').filter(Boolean)[0] || 'system';
  return {
    method: normalizedMethod,
    module,
    action: 'Kullanıcı işlemi',
    entityType: module,
  };
};

const extractEntityId = (endpoint, body = {}) => {
  const parts = normalizeEndpoint(endpoint).split('/').filter(Boolean);
  const idLike = [...parts].reverse().find((part) => /[a-z0-9][a-z0-9_-]{4,}/i.test(part) && !['status', 'movements', 'returns', 'sales'].includes(part));
  return cleanText(body?.id || body?.productId || body?.orderId || body?.deviceId || body?.customerId || body?.userId || idLike, 120);
};

const extractEntityLabel = (body = {}) => cleanText(
  body.name || body.productName || body.title || body.sku || body.barcode || body.referenceNo || body.orderNumber,
  200,
);

const getClientIp = (req) => (
  req.ip
  || (Array.isArray(req.headers['x-forwarded-for'])
    ? req.headers['x-forwarded-for'][0]
    : String(req.headers['x-forwarded-for'] || '').split(',')[0])
  || ''
);

const normalizeAuditRow = (row, overrides = {}) => {
  const createdAt = row.createdAt || row.at || row.timestamp || new Date().toISOString();
  return {
    id: String(overrides.id || row.id || `${overrides.source || 'legacy'}:${Date.now()}`),
    createdAt,
    at: createdAt,
    actorUserId: row.actorUserId || row.actorId || row.userId || null,
    actorName: row.actorName || row.actor || row.userName || overrides.actorName || null,
    actorRole: row.actorRole || null,
    actorEmail: row.actorEmail || null,
    action: row.actionLabel || row.action || row.type || overrides.action || 'Kullanıcı işlemi',
    module: row.module || overrides.module || 'legacy',
    entityType: row.entityType || overrides.entityType || null,
    entityId: row.entityId || row.referenceId || row.requestId || row.orderId || row.transferRequestId || null,
    entityLabel: row.entityLabel || row.referenceCode || row.targetName || null,
    method: row.method || null,
    endpoint: row.endpoint || null,
    statusCode: row.statusCode || null,
    ip: row.ip || row.actorIp || null,
    userAgent: row.userAgent || null,
    requestId: row.requestId || null,
    correlationId: row.correlationId || null,
    summary: row.summary || row.details || row.detail || row.note || overrides.summary || '',
    details: row.summary || row.details || row.detail || row.note || overrides.summary || '',
    metadata: row.metadata || row.payload || null,
    severity: row.severity || overrides.severity || 'info',
    source: row.source || overrides.source || 'legacy',
  };
};

const loadLegacyRows = async () => {
  const rows = [];

  const settings = await settingsRepo.getSettings();
  (Array.isArray(settings.auditLogs) ? settings.auditLogs : []).forEach((row) => {
    rows.push(normalizeAuditRow(row, { id: `settings:${row.id}`, module: 'settings', source: 'settings_legacy' }));
  });

  const accessLogs = await accessAuditLogRepo.getAll();
  (Array.isArray(accessLogs) ? accessLogs : []).forEach((row) => {
    rows.push(normalizeAuditRow(row, { id: `access:${row.id}`, module: 'access', source: 'access_audit_legacy' }));
  });

  try {
    const prisma = await getPrisma();
    const [purchaseActivities, transferAudits, eslHistory, movements, sales] = await Promise.all([
      prisma.purchaseOrderActivityLog.findMany({ orderBy: { at: 'desc' }, take: 150 }),
      prisma.transferAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 150 }),
      prisma.eslHistory.findMany({ orderBy: { createdAt: 'desc' }, take: 150 }),
      prisma.stockMovement.findMany({ orderBy: { createdAt: 'desc' }, take: 150 }),
      prisma.sale.findMany({ orderBy: { createdAt: 'desc' }, take: 150 }),
    ]);

    purchaseActivities.forEach((row) => rows.push(normalizeAuditRow(row, {
      id: `purchase:${row.id}`,
      module: 'procurement',
      source: 'purchase_order_activity_legacy',
      entityType: 'purchase_order',
      summary: row.note || row.status || row.type || '',
    })));
    transferAudits.forEach((row) => rows.push(normalizeAuditRow(row, {
      id: `transfer:${row.id}`,
      module: 'transfer',
      source: 'transfer_audit_legacy',
      entityType: 'transfer_request',
      summary: row.note || `${row.fromStatus || '-'} -> ${row.toStatus || '-'}`,
    })));
    eslHistory.forEach((row) => rows.push(normalizeAuditRow(row, {
      id: `esl:${row.id}`,
      module: 'esl',
      source: 'esl_history_legacy',
      entityType: 'esl_device',
      entityId: row.deviceId,
      entityLabel: row.deviceName || row.productName,
      action: row.status === 'success' ? 'Etiket işlemi tamamlandı' : 'Etiket işlemi',
      summary: row.status || row.template || '',
    })));
    movements.forEach((row) => rows.push(normalizeAuditRow(row, {
      id: `stock:${row.id}`,
      module: 'stock',
      source: 'stock_movement_legacy',
      entityType: 'stock_movement',
      entityId: row.productId,
      entityLabel: row.productName,
      action: row.reasonLabel || row.reasonCode || row.type || 'Stok hareketi',
      summary: `${row.type || 'movement'} ${row.qty || ''}`.trim(),
    })));
    sales.forEach((row) => rows.push(normalizeAuditRow(row, {
      id: `sale:${row.id}`,
      module: 'pos',
      source: 'sales_legacy',
      entityType: row.type === 'return' ? 'sale_return' : 'sale',
      entityId: row.id,
      entityLabel: row.referenceNo,
      action: row.type === 'return' ? 'İade alındı' : 'Satış yapıldı',
      summary: `${row.referenceNo || row.id} / ${row.totalAmount || 0}`,
    })));
  } catch (error) {
    console.warn('[audit-log:legacy-sources-skipped]', error?.message || error);
  }

  return rows;
};

const matchesLegacyFilters = (row, filters = {}) => {
  const createdAt = new Date(row.createdAt || row.at || 0);
  if (filters.fromDate && (!Number.isFinite(createdAt.getTime()) || createdAt < filters.fromDate)) return false;
  if (filters.toDate && (!Number.isFinite(createdAt.getTime()) || createdAt > filters.toDate)) return false;
  if (filters.module && row.module !== filters.module) return false;
  if (filters.action && row.action !== filters.action) return false;
  if (filters.source && row.source !== filters.source) return false;
  if (filters.user && row.actorName !== filters.user) return false;
  if (filters.status && String(row.statusCode || '') !== String(filters.status)) return false;
  if (filters.search) {
    const haystack = [
      row.actorName,
      row.action,
      row.module,
      row.entityType,
      row.entityId,
      row.entityLabel,
      row.summary,
      row.endpoint,
      row.requestId,
    ].filter(Boolean).join(' ').toLocaleLowerCase('tr-TR');
    if (!haystack.includes(String(filters.search).toLocaleLowerCase('tr-TR'))) return false;
  }
  return true;
};

export const auditLogService = {
  sanitizeMetadata: maskSensitiveData,

  shouldAuditRequest(req) {
    const method = String(req.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;

    const endpoint = normalizeEndpoint(req.originalUrl || req.url || '');
    const excludedPrefixes = [
      '/health',
      '/settings/developer-logs',
      '/settings/audit-logs',
      '/reports/dashboard',
      '/notifications/unread',
      '/notifications/poll',
      '/customer-auth',
      '/proximity/events',
    ];
    if (excludedPrefixes.some((prefix) => endpoint.startsWith(prefix))) return false;
    if (/\/search|\/autocomplete|\/suggestions\/preview/.test(endpoint)) return false;
    if (/^\/esl\/devices\/[^/]+\/(battery|heartbeat|bridge-label-sync|render-confirm)$/.test(endpoint)) return false;
    if (endpoint === '/esl/settings/bridge-schedule-sync') return false;

    return true;
  },

  buildRequestEntry(req, res) {
    const endpoint = normalizeEndpoint(req.originalUrl || req.url || '');
    const mapping = resolveRouteMapping(req.method, endpoint);
    const statusCode = Number(res.statusCode || 0);
    const user = req.user || {};
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const entityId = extractEntityId(endpoint, body);
    const entityLabel = extractEntityLabel(body);

    return {
      actorUserId: user.id || null,
      actorName: user.name || user.username || body.username || null,
      actorRole: user.role || null,
      actorEmail: user.email || null,
      action: mapping.action,
      module: mapping.module,
      entityType: mapping.entityType,
      entityId,
      entityLabel,
      method: String(req.method || '').toUpperCase(),
      endpoint,
      statusCode,
      ip: cleanText(getClientIp(req), 120),
      userAgent: cleanText(req.headers['user-agent'] || '', 600),
      requestId: cleanText(req.requestId || req.headers['x-request-id'] || '', 120),
      correlationId: cleanText(req.headers['x-correlation-id'] || req.requestId || '', 120),
      summary: entityLabel
        ? `${mapping.action}: ${entityLabel}`
        : `${mapping.action} (${String(req.method || '').toUpperCase()} ${endpoint})`,
      metadata: maskSensitiveData({
        params: req.params || {},
        query: req.query || {},
        body,
      }),
      severity: mapping.severity || (statusCode >= 500 ? 'warning' : 'info'),
      source: mapping.source || (endpoint.includes('/automation') ? 'automation' : 'user_action'),
    };
  },

  async record(entry = {}) {
    return auditLogRepo.create(entry);
  },

  async list(query = {}) {
    const limit = Math.min(MAX_AUDIT_LIMIT, Math.max(1, Number(query.limit) || 100));
    const page = Math.max(1, Number(query.page) || 1);
    const filters = {
      module: cleanText(query.module, 100),
      action: cleanText(query.action, 200),
      source: cleanText(query.source, 100),
      status: cleanText(query.status, 20),
      actorUserId: cleanText(query.actorUserId, 120),
      user: cleanText(query.user, 200),
      search: cleanText(query.search, 200),
      fromDate: parseDateBoundary(query.from, 'T00:00:00.000Z'),
      toDate: parseDateBoundary(query.to, 'T23:59:59.999Z'),
    };
    const includeLegacy = query.includeLegacy !== false && String(query.includeLegacy || 'true') !== 'false';

    let central = { items: [], total: 0, limit, page };
    try {
      central = await auditLogRepo.list({ filters, limit, page });
    } catch (error) {
      console.warn('[audit-log:central-list-skipped]', error?.message || error);
    }

    if (!includeLegacy) return central;

    const legacyRows = (await loadLegacyRows()).filter((row) => matchesLegacyFilters(row, filters));
    const combined = [...central.items, ...legacyRows]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    return {
      items: combined.slice(0, limit),
      total: central.total + legacyRows.length,
      centralTotal: central.total,
      legacyTotal: legacyRows.length,
      limit,
      page,
    };
  },
};
