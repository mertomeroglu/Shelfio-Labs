import { v4 as uuidv4 } from 'uuid';
import { dataDefaults } from '../config/config.js';
import { ROLE_PERMISSIONS } from '../config/permissions.js';
import { accessAuditLogRepo } from '../repositories/accessAuditLogRepository.js';
import { createFileRepository } from '../repositories/fileRepository.js';
import { movementRepo } from '../repositories/movementRepository.js';
import { purchaseOrderRepo } from '../repositories/purchaseOrderRepository.js';
import { salesRepo } from '../repositories/salesRepository.js';
import { taskRepo } from '../repositories/taskRepository.js';
import { temporaryPermissionGrantRepo } from '../repositories/temporaryPermissionGrantRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { warehouseMovementRepo } from '../repositories/warehouseMovementRepository.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { formatMovementRouteLabel, formatPermissionLabel, replacePermissionCodesInText } from '../utils/displayLabels.js';
import { hashPassword } from '../utils/password.js';
import { sanitizeUserInput, validateUserPayload } from '../utils/validators.js';
import { getPurchaseOrderStatusLabel, normalizePurchaseOrderStatus } from '../domain/purchaseOrderLifecycle.js';

const SUPER_ADMIN_ID = 'u-admin-1';
const SUPER_ADMIN_USERNAME = 'mert.omeroglu@shelfio.com';

const transferRequestRepo = createFileRepository({ fileName: 'stockTransferRequests.json', defaultData: [] });
const transferRequestAuditRepo = createFileRepository({ fileName: 'stockTransferRequestAudits.json', defaultData: [] });

const formatOrderReference = (value, fallbackSeed = '') => {
  const raw = String(value || '').trim();
  const digitMatch = raw.match(/\d+/g);
  if (digitMatch?.length) return `siparis-${digitMatch.join('').slice(-5).padStart(5, '0')}`;
  const seed = String(fallbackSeed || raw || '0');
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return `siparis-${String(Math.abs(hash) % 100000).padStart(5, '0')}`;
};

const purchaseOrderActivityLabel = (status, type = '') => {
  const normalizedStatus = normalizePurchaseOrderStatus(status, '');
  const normalizedType = String(type || '').trim();
  if (normalizedStatus === 'goods_receipt_pending') return 'Mal kabul beklemeye alındı';
  if (normalizedStatus === 'goods_receipt_completed') return 'Mal kabulü tamamladı';
  if (normalizedStatus === 'stock_entry_pending') return 'Stok girişi beklemeye alındı';
  if (normalizedStatus === 'completed') return 'Stok girişini tamamladı';
  if (normalizedStatus === 'archived') return 'Siparişi arşivledi';
  if (normalizedStatus === 'cancelled') return 'Siparişi iptal etti';
  if (normalizedType === 'status_auto_progress') return 'Sipariş durumunu otomatik ilerletti';
  return 'Satın alma durumunu güncelledi';
};

const purchaseOrderActivityModule = (status) => {
  const normalizedStatus = normalizePurchaseOrderStatus(status, '');
  if (['delivered', 'goods_receipt_pending', 'goods_receipt_completed', 'stock_entry_pending'].includes(normalizedStatus)) return 'Mal Kabul';
  if (['completed', 'archived'].includes(normalizedStatus)) return 'Satın Alma';
  return 'Satın Alma';
};

const DEPARTMENT_DEFAULTS = {
  admin: 'Yönetim',
  user: 'Operasyon',
  cashier: 'Satış',
  viewer: 'IT',
  depo_personeli: 'Operasyon',
  komisyon_b: 'Yönetim',
  komisyon_c: 'Finans',
  komisyon_v: 'Operasyon',
};

const CRITICAL_PERMISSIONS = new Set([
  'purchase:create',
  'purchase:approve',
  'stock:update',
  'user:create',
  'user:update',
  'settings:update',
]);

const ROLE_PRIORITY = {
  admin: 0,
  user: 1,
  cashier: 2,
  depo_personeli: 3,
  komisyon_b: 4,
  komisyon_c: 5,
  komisyon_v: 6,
  viewer: 50,
};

const normalizeDepartment = (value, fallbackRole = 'user') => {
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (raw === 'satış' || raw === 'satis') return 'Satış';
  if (raw === 'operasyon') return 'Operasyon';
  if (raw === 'finans') return 'Finans';
  if (raw === 'it') return 'IT';
  if (raw === 'yönetim' || raw === 'yonetim') return 'Yönetim';
  return DEPARTMENT_DEFAULTS[fallbackRole] || 'Operasyon';
};

const toMs = (value) => {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) ? time : 0;
};

const summarizeMovementDetail = (movement = {}) => {
  const parts = [
    movement.productName,
    movement.qty ? `${movement.qty} adet` : '',
    movement.routeLabel || formatMovementRouteLabel(movement, ''),
  ].filter(Boolean);
  return parts.join(' • ');
};

const summarizeWarehouseMovementDetail = (movement = {}) => {
  const parts = [
    movement.productName,
    movement.qty ? `${movement.qty} adet` : '',
    movement.locationCode || movement.affectedLocation || '',
  ].filter(Boolean);
  return parts.join(' • ');
};

const mapAccessAuditActionLabel = (action, permission) => {
  const permissionLabel = formatPermissionLabel(permission, permission || 'Yetki');
  const labels = {
    request_created: 'Erişim talebi oluşturdu',
    request_approved: 'Erişim talebini onayladı',
    request_rejected: 'Erişim talebini reddetti',
    grant_created: 'Geçici yetki tanımladı',
    grant_revoked: 'Geçici yetkiyi iptal etti',
    grant_expired: 'Geçici yetkinin süresini tamamladı',
    grant_duration_updated: 'Geçici yetki süresini güncelledi',
    task_created: 'Görev akışını tetikledi',
  };
  return labels[action] || `${permissionLabel} üzerinde işlem yaptı`;
};

const collectUserActivities = ({
  targetUserId = '',
  limit = 20,
  sales = [],
  movements = [],
  warehouseMovements = [],
  transferRequests = [],
  transferRequestAudits = [],
  purchaseOrders = [],
  tasks = [],
  accessAuditLogs = [],
} = {}) => {
  const target = String(targetUserId || '').trim();
  const rows = [];
  const duplicateWarehouseKeys = new Set();

  const pushEvent = (event) => {
    const userId = String(event?.userId || '').trim();
    const atMs = toMs(event?.at);
    if (!userId || !atMs) return;
    if (target && userId !== target) return;

    rows.push({
      id: event.id || `${event.module}-${event.reference || 'ref'}-${atMs}`,
      userId,
      type: event.type || 'İşlem',
      module: event.module || '-',
      detail: replacePermissionCodesInText(event.detail || '-', '-'),
      reference: event.reference || '-',
      at: new Date(atMs).toISOString(),
      atMs,
    });
  };

  (Array.isArray(sales) ? sales : []).forEach((sale) => {
    pushEvent({
      id: `sale:${sale.id}`,
      userId: sale.cashierId,
      type: sale.type === 'return' ? 'POS iadesi aldı' : 'POS satışı tamamladı',
      module: 'POS',
      detail: `${sale.type === 'return' ? 'İade' : 'Satış'} • ${Number(sale.totalAmount || 0).toFixed(2)} TL • ${sale.items?.[0]?.name || 'Ürün'}`,
      reference: sale.referenceNo || sale.receiptNo || sale.id,
      at: sale.createdAt,
    });
  });

  (Array.isArray(movements) ? movements : []).forEach((movement) => {
    const type = movement.reasonCode === 'customer_return'
      ? 'Müşteri iadesi kabul etti'
      : movement.reasonCode === 'pos_sale'
        ? 'Stoktan POS çıkışı yaptı'
        : movement.type === 'TRANSFER'
          ? 'Stok transferi yaptı'
          : movement.type === 'OUT'
            ? 'Stok çıkışı yaptı'
            : movement.type === 'IN'
              ? 'Stok girişi yaptı'
              : 'Stok hareketi yaptı';

    if (movement.referenceNo) {
      duplicateWarehouseKeys.add(`${movement.referenceNo}|${movement.userId || ''}|${movement.createdAt || ''}`);
    }

    pushEvent({
      id: `movement:${movement.id}`,
      userId: movement.userId,
      type,
      module: 'Stok',
      detail: summarizeMovementDetail(movement),
      reference: movement.referenceNo || movement.id,
      at: movement.createdAt,
    });
  });

  (Array.isArray(warehouseMovements) ? warehouseMovements : []).forEach((movement) => {
    const dedupeKey = `${movement.referenceNo || ''}|${movement.createdBy || ''}|${movement.createdAt || ''}`;
    if (duplicateWarehouseKeys.has(dedupeKey)) return;

    pushEvent({
      id: `warehouse:${movement.id}`,
      userId: movement.createdBy,
      type: movement.movementType === 'MAL_KABUL' ? 'Mal kabul kaydı oluşturdu' : 'Depo hareketi kaydetti',
      module: movement.movementType === 'MAL_KABUL' ? 'Mal Kabul' : 'Depo',
      detail: summarizeWarehouseMovementDetail(movement),
      reference: movement.referenceNo || movement.id,
      at: movement.createdAt,
    });
  });

  (Array.isArray(transferRequests) ? transferRequests : []).forEach((request) => {
    pushEvent({
      id: `transfer-request:create:${request.id}`,
      userId: request.requestedBy,
      type: 'Transfer talebi oluşturdu',
      module: 'Transfer',
      detail: `${request.productName || 'Ürün'} • ${request.quantity || request.requestedQuantity || 0} adet • ${request.status || 'Bekliyor'}`,
      reference: request.id,
      at: request.createdAt,
    });

    if (request.handledBy && request.completedAt) {
      pushEvent({
        id: `transfer-request:handled:${request.id}`,
        userId: request.handledBy,
        type: 'Transfer talebini işleme aldı',
        module: 'Transfer',
        detail: `${request.productName || 'Ürün'} • ${request.fulfillmentStatus || request.status || 'İşlendi'} • ${request.handledNote || 'İşlem tamamlandı'}`,
        reference: request.id,
        at: request.completedAt,
      });
    }
  });

  (Array.isArray(transferRequestAudits) ? transferRequestAudits : []).forEach((audit) => {
    pushEvent({
      id: `transfer-audit:${audit.id}`,
      userId: audit.actorId,
      type: 'Transfer talebini güncelledi',
      module: 'Transfer',
      detail: `${audit.toStatus || audit.event || 'Durum güncellendi'} • ${audit.note || 'Transfer kaydı işlendi.'}`,
      reference: audit.transferRequestId || audit.id,
      at: audit.createdAt,
    });
  });

  (Array.isArray(purchaseOrders) ? purchaseOrders : []).forEach((order) => {
    pushEvent({
      id: `purchase-order:create:${order.id}`,
      userId: order.createdBy,
      type: 'Satın alma siparişi oluşturdu',
      module: 'Satın Alma',
      detail: `${order.supplierName || 'Tedarikçi'} • ${order.currentStatus || order.status || 'Açık'} • ${Number(order.totalAmount || order.grandTotal || 0).toFixed(2)} TL`,
      reference: formatOrderReference(order.orderNumber, order.id),
      at: order.createdAt,
    });

    (Array.isArray(order.activityLog) ? order.activityLog : []).forEach((log) => {
      pushEvent({
        id: `purchase-order:activity:${log.id}`,
        userId: log.by,
        type: log.status === 'goods_receipt_completed' ? 'Mal kabulü tamamladı' : 'Satın alma durumunu güncelledi',
        module: log.status === 'goods_receipt_completed' ? 'Mal Kabul' : 'Satın Alma',
        detail: replacePermissionCodesInText(log.note || order.supplierName || 'Sipariş durumu güncellendi.', '-'),
        reference: formatOrderReference(log.orderNumber || order.orderNumber, order.id),
        at: log.at,
      });
    });
  });

  (Array.isArray(tasks) ? tasks : []).forEach((task) => {
    pushEvent({
      id: `task:create:${task.id}`,
      userId: task.createdBy,
      type: 'Görev oluşturdu',
      module: 'Görev',
      detail: `${task.taskNo || task.id} • ${task.title || 'Görev'} • ${task.status || 'Açık'}`,
      reference: task.taskNo || task.id,
      at: task.createdAt,
    });

    if (task.assignedTo && task.updatedAt) {
      pushEvent({
        id: `task:assigned:${task.id}`,
        userId: task.assignedTo,
        type: 'Görev üzerinde işlem yaptı',
        module: 'Görev',
        detail: `${task.taskNo || task.id} • ${task.title || 'Görev'} • ${task.status || 'Güncellendi'}`,
        reference: task.taskNo || task.id,
        at: task.updatedAt,
      });
    }

    (Array.isArray(task.comments) ? task.comments : []).forEach((comment) => {
      pushEvent({
        id: `task:comment:${comment.id}`,
        userId: comment.authorId,
        type: 'Göreve yorum ekledi',
        module: 'Görev',
        detail: `${task.taskNo || task.id} • ${comment.text || 'Yorum eklendi.'}`,
        reference: task.taskNo || task.id,
        at: comment.createdAt,
      });
    });
  });

  (Array.isArray(accessAuditLogs) ? accessAuditLogs : []).forEach((log) => {
    const actorId = String(log.actorId || '').trim();
    if (!actorId || actorId === 'system') return;

    pushEvent({
      id: `access-audit:${log.id}`,
      userId: actorId,
      type: mapAccessAuditActionLabel(log.action, log.permission),
      module: 'Erişim',
      detail: `${formatPermissionLabel(log.permission, log.permission)} • ${replacePermissionCodesInText(log.metadata?.note || '', '') || 'Yetki akışı işlendi.'}`,
      reference: log.requestId || log.id,
      at: log.createdAt,
    });
  });

  return rows
    .sort((left, right) => right.atMs - left.atMs)
    .slice(0, Math.max(1, Number(limit || 20)));
};

const buildUserActivityMap = (sources) => {
  const map = new Map();
  const events = collectUserActivities({ ...sources, limit: Number.MAX_SAFE_INTEGER });

  events.forEach((event) => {
    const previous = map.get(event.userId);
    if (!previous || event.atMs > previous.atMs) {
      map.set(event.userId, {
        atMs: event.atMs,
        at: event.at,
        label: event.type,
      });
    }
  });

  return map;
};

const mapUser = (user, options = {}) => {
  const basePermissions = ROLE_PERMISSIONS[user.role] || [];
  const temporaryPermissions = options.temporaryPermissionsByUserId?.get(user.id) || [];
  const nonBaseTemporary = temporaryPermissions.filter((permission) => !basePermissions.includes(permission));
  const effectivePermissions = basePermissions.includes('*')
    ? ['*']
    : Array.from(new Set([...basePermissions, ...temporaryPermissions]));

  const criticalPermissions = effectivePermissions.includes('*')
    ? Array.from(CRITICAL_PERMISSIONS)
    : effectivePermissions.filter((permission) => CRITICAL_PERMISSIONS.has(permission));

  const lastAction = options.activityMap?.get(user.id) || null;
  const lastLoginMs = toMs(user.lastLoginAt);
  const lastActionMs = toMs(lastAction?.at);
  const referenceMs = Math.max(lastLoginMs, lastActionMs);
  const now = Date.now();
  const inactiveDays = referenceMs > 0 ? Math.floor((now - referenceMs) / (1000 * 60 * 60 * 24)) : null;
  const activityStatus = inactiveDays === null ? 'inactive' : inactiveDays <= 7 ? 'active' : 'inactive';

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email || '',
    role: user.role,
    department: normalizeDepartment(user.department, user.role),
    storeId: user.storeId || 'store-main',
    assignedDeskCode: user.assignedDeskCode || null,
    registerPin: user.registerPin || '',
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt || null,
    lastActionAt: lastAction?.at || null,
    lastActionLabel: lastAction?.label || null,
    activityStatus,
    inactiveDays,
    hasSpecialPermissions: nonBaseTemporary.length > 0,
    specialPermissions: nonBaseTemporary,
    effectivePermissions,
    criticalPermissions,
    hasCriticalPermissions: criticalPermissions.length > 0,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

const ensureAdminSafety = async (userId, nextRole, nextActive) => {
  const users = await userRepo.getAll();
  const activeAdmins = users.filter((item) => item.role === 'admin' && item.isActive);
  const current = users.find((item) => item.id === userId);

  if (!current || current.role !== 'admin' || !current.isActive) {
    return;
  }

  const remainsActiveAdmin = nextRole === 'admin' && nextActive;
  if (!remainsActiveAdmin && activeAdmins.length <= 1) {
    throw new AppError(400, 'Sistemde en az bir aktif yönetici kullanıcı bulunmalıdır');
  }
};

const loadActivitySources = async () => {
  const [sales, movements, warehouseMovements, transferRequests, transferRequestAudits, purchaseOrders, tasks, accessAuditLogs] = await Promise.all([
    salesRepo.getAll(),
    movementRepo.getAll(),
    warehouseMovementRepo.getAll(),
    transferRequestRepo.getAll(),
    transferRequestAuditRepo.getAll(),
    purchaseOrderRepo.getAll(),
    taskRepo.getAll(),
    accessAuditLogRepo.getAll(),
  ]);

  return {
    sales: Array.isArray(sales) ? sales : [],
    movements: Array.isArray(movements) ? movements : [],
    warehouseMovements: Array.isArray(warehouseMovements) ? warehouseMovements : [],
    transferRequests: Array.isArray(transferRequests) ? transferRequests : [],
    transferRequestAudits: Array.isArray(transferRequestAudits) ? transferRequestAudits : [],
    purchaseOrders: Array.isArray(purchaseOrders) ? purchaseOrders : [],
    tasks: Array.isArray(tasks) ? tasks : [],
    accessAuditLogs: Array.isArray(accessAuditLogs) ? accessAuditLogs : [],
  };
};

export const userService = {
  async list() {
    let users = await userRepo.getAll();

    if (!Array.isArray(users) || users.length === 0) {
      for (const item of dataDefaults.users) {
        await userRepo.create(item);
      }
      users = await userRepo.getAll();
    }

    const [grants, activitySources] = await Promise.all([
      temporaryPermissionGrantRepo.getAll(),
      loadActivitySources(),
    ]);

    const now = Date.now();
    const temporaryPermissionsByUserId = new Map();
    for (const grant of grants || []) {
      if (grant.status !== 'active') continue;
      if (new Date(grant.expiresAt).getTime() <= now) continue;
      if (!temporaryPermissionsByUserId.has(grant.userId)) {
        temporaryPermissionsByUserId.set(grant.userId, []);
      }
      temporaryPermissionsByUserId.get(grant.userId).push(String(grant.permission || '').trim());
    }

    const activityMap = buildUserActivityMap(activitySources);

    return users
      .map((item) => mapUser(item, { temporaryPermissionsByUserId, activityMap }))
      .sort((left, right) => {
        const roleDiff = (ROLE_PRIORITY[left.role] ?? 99) - (ROLE_PRIORITY[right.role] ?? 99);
        if (roleDiff !== 0) return roleDiff;
        return new Date(right.createdAt) - new Date(left.createdAt);
      });
  },

  async listActivities(userId, query = {}) {
    const existing = await userRepo.findById(userId);
    if (!existing) {
      throw createNotFoundError('Kullanıcı bulunamadı');
    }

    const limit = Math.min(50, Math.max(5, Number(query.limit || 20)));
    const activitySources = await loadActivitySources();
    return collectUserActivities({
      ...activitySources,
      targetUserId: userId,
      limit,
    });
  },

  async create(payload) {
    validateUserPayload(payload);
    const input = sanitizeUserInput(payload);

    const existing = await userRepo.findByUsername(input.username);
    if (existing) {
      throw new AppError(409, 'Bu kullanıcı adı zaten kayıtlı');
    }

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(input.password);

    const user = {
      id: uuidv4(),
      username: input.username,
      passwordHash,
      role: input.role,
      department: normalizeDepartment(input.department, input.role),
      storeId: input.storeId || 'store-main',
      assignedDeskCode: input.role === 'cashier' ? input.assignedDeskCode || '' : null,
      registerPin: input.registerPin,
      name: input.name,
      email: input.email,
      isActive: input.isActive,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await userRepo.create(user);
    return mapUser(user);
  },

  async update(id, payload) {
    validateUserPayload(payload, { partial: true });
    const existing = await userRepo.findById(id);

    if (!existing) {
      throw createNotFoundError('Kullanıcı bulunamadı');
    }

    const merged = sanitizeUserInput({ ...existing, ...payload });
    const isProtectedSuperAdmin = existing.id === SUPER_ADMIN_ID || existing.username === SUPER_ADMIN_USERNAME;

    if (isProtectedSuperAdmin && merged.role !== 'admin') {
      throw new AppError(400, 'Super admin kullanıcısının rolü değiştirilemez.');
    }

    const sameUsername = await userRepo.findByUsername(merged.username);
    if (sameUsername && sameUsername.id !== id) {
      throw new AppError(409, 'Bu kullanıcı adı zaten kayıtlı');
    }

    await ensureAdminSafety(id, merged.role, merged.isActive);

    const updated = {
      ...existing,
      username: merged.username,
      role: merged.role,
      department: normalizeDepartment(merged.department || existing.department, merged.role),
      storeId: merged.storeId || existing.storeId || 'store-main',
      assignedDeskCode: merged.role === 'cashier' ? merged.assignedDeskCode || '' : null,
      registerPin: merged.registerPin,
      name: merged.name,
      email: merged.email,
      isActive: merged.isActive,
      updatedAt: new Date().toISOString(),
    };

    if (payload.password) {
      updated.passwordHash = await hashPassword(merged.password);
    }

    await userRepo.updateById(id, updated);
    return mapUser(updated);
  },

  async remove(id, actorId) {
    const existing = await userRepo.findById(id);

    if (!existing) {
      throw createNotFoundError('Kullanıcı bulunamadı');
    }

    const isProtectedSuperAdmin = existing.id === SUPER_ADMIN_ID || existing.username === SUPER_ADMIN_USERNAME;
    if (isProtectedSuperAdmin) {
      throw new AppError(400, 'Super admin kullanıcısı silinemez.');
    }

    if (actorId && String(actorId) === String(id)) {
      throw new AppError(400, 'Kendi hesabınızı silemezsiniz.');
    }

    await ensureAdminSafety(id, 'user', false);
    await userRepo.deleteById(id);
  },
};
