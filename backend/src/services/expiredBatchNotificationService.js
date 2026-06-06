import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/config.js';
import { notificationRepo } from '../repositories/notificationRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { getPrisma, isPostgresEnabled } from '../providers/postgresProvider.js';
import { normalizeDateOnly } from '../utils/batchExpiry.js';
import { buildActiveExpiryBatchWhere } from './expiryTrackingService.js';

const NOTIFICATION_TYPE = 'skt_expired';
const ACTION_URL = '/stok-islemleri';
const ACTION_TYPE = 'stock';
const GROUP_REASON = 'expired_batch_disposal_required';
const TARGET_ROLES = new Set([
  'admin',
  'user',
  'store_manager',
  'inventory',
  'inventory_manager',
  'depo_personeli',
  'komisyon_b',
  'komisyon_c',
]);
const TARGET_DEPARTMENTS = new Set([
  'operasyon',
  'yönetim',
  'yonetim',
  'it',
]);

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toPositiveQuantity = (batch = {}) => (
  Math.max(0, toNumber(batch.totalQuantity ?? batch.total_quantity, 0))
);

const formatTodayKey = (now = new Date(), timezone = config.timezone || 'Europe/Istanbul') => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (byType.year && byType.month && byType.day) {
      return `${byType.year}-${byType.month}-${byType.day}`;
    }
  } catch {
    // Fall through to UTC-safe date-only normalization.
  }
  return normalizeDateOnly(now);
};

const normalizeComparableDate = (value) => normalizeDateOnly(value);

const normalizeLocaleKey = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

export const buildExpiredBatchSourceKey = ({ productId, batchNo, expiryDate }) => {
  const productPart = String(productId || 'unknown-product').trim() || 'unknown-product';
  const batchPart = String(batchNo || 'unknown-batch').trim() || 'unknown-batch';
  const datePart = String(expiryDate || 'unknown-date').trim() || 'unknown-date';
  return `skt-expired:${productPart}:${batchPart}:${datePart}`;
};

export const buildExpiredBatchGroupDedupeKey = (todayKey) => `skt-expired-group:${todayKey}`;

const resolveTargetUsers = async () => {
  const users = await userRepo.getAll();
  return users.filter((user) => {
    if (user?.isActive === false) return false;
    const role = String(user?.role || '').trim().toLowerCase();
    const department = normalizeLocaleKey(user?.department);
    return TARGET_ROLES.has(role) || TARGET_DEPARTMENTS.has(department);
  });
};

const mapBatchRow = (row = {}, todayKey) => {
  const product = row.product || row.stock?.product || {};
  const expiryDate = normalizeComparableDate(row.skt || row.expiryDate || row.expirationDate);
  const quantity = toPositiveQuantity(row);
  if (!expiryDate) {
    return { skipped: true, reason: 'invalid_expiry_date', raw: row };
  }
  if (expiryDate > todayKey) {
    return { skipped: true, reason: 'not_expired_yet', raw: row };
  }
  if (quantity <= 0) {
    return { skipped: true, reason: 'empty_batch', raw: row };
  }
  if (product.isActive === false || product.isListed === false) {
    return { skipped: true, reason: 'product_not_active_or_listed', raw: row };
  }

  const warehouseQuantity = Math.max(0, toNumber(row.warehouseQuantity, 0));
  const shelfQuantity = Math.max(0, toNumber(row.shelfQuantity, 0));
  const batchNo = String(row.batchNo || '').trim() || '-';
  const productId = String(row.productId || product.id || '').trim();
  const sourceKey = buildExpiredBatchSourceKey({ productId, batchNo, expiryDate });
  const locationParts = [];
  if (product.defaultWarehouseLocationCode) locationParts.push(product.defaultWarehouseLocationCode);
  if (warehouseQuantity > 0) locationParts.push(`Depo: ${warehouseQuantity}`);
  if (shelfQuantity > 0) locationParts.push(`Reyon: ${shelfQuantity}`);

  return {
    id: row.id,
    productId,
    sku: product.sku || '',
    barcode: product.barcode || '',
    productName: product.name || 'Ürün',
    batchNo,
    expiryDate,
    quantity,
    shelfQuantity,
    warehouseQuantity,
    locationCode: locationParts.join(' | '),
    sourceKey,
  };
};

const listExpiredBatchCandidatesFromPostgres = async ({ now = new Date() } = {}) => {
  const todayKey = formatTodayKey(now);
  const prisma = await getPrisma();
  const rows = await prisma.stockBatch.findMany({
    where: buildActiveExpiryBatchWhere({ today: todayKey, expiredOnly: true, includeToday: true }),
    select: {
      id: true,
      productId: true,
      batchNo: true,
      skt: true,
      warehouseQuantity: true,
      shelfQuantity: true,
      totalQuantity: true,
      stock: {
        select: {
          product: {
            select: {
              id: true,
              sku: true,
              barcode: true,
              name: true,
              isActive: true,
              isListed: true,
              defaultWarehouseLocationCode: true,
            },
          },
        },
      },
    },
  });

  const candidates = [];
  const skipped = [];
  rows.forEach((row) => {
    const mapped = mapBatchRow(row, todayKey);
    if (mapped.skipped) skipped.push(mapped);
    else candidates.push(mapped);
  });

  return { candidates, skipped, todayKey };
};

export const buildExpiredBatchNotificationRecord = (candidate, { userId, now = new Date() }) => ({
  id: uuidv4(),
  userId,
  type: NOTIFICATION_TYPE,
  title: `SKT Geçti: ${candidate.productName}`,
  message: `${candidate.productName} ürününün ${candidate.batchNo} parti numaralı stoğunun SKT tarihi ${candidate.expiryDate} olarak geçti. Kalan miktar: ${candidate.quantity}.`,
  severity: 'critical',
  isRead: false,
  createdAt: now.toISOString(),
  relatedTaskId: null,
  dedupeKey: candidate.sourceKey,
  actionUrl: ACTION_URL,
  actionType: ACTION_TYPE,
  createdBy: null,
  audience: {
    mode: 'role',
    roles: Array.from(TARGET_ROLES),
  },
  delivery: {
    sendAt: now.toISOString(),
    expiresAt: null,
    isPinned: false,
    requireReadReceipt: false,
  },
  payload: {
    type: NOTIFICATION_TYPE,
    severity: 'critical',
    entityType: 'stock_batch',
    productId: candidate.productId,
    sku: candidate.sku,
    barcode: candidate.barcode,
    productName: candidate.productName,
    batchNo: candidate.batchNo,
    expiryDate: candidate.expiryDate,
    quantity: candidate.quantity,
    shelfQuantity: candidate.shelfQuantity,
    warehouseQuantity: candidate.warehouseQuantity,
    locationCode: candidate.locationCode,
    sourceKey: candidate.sourceKey,
  },
  isDraft: false,
});

const toGroupItem = (candidate = {}, now = new Date()) => ({
  productId: candidate.productId,
  sku: candidate.sku,
  barcode: candidate.barcode,
  productName: candidate.productName,
  batchNo: candidate.batchNo,
  expiryDate: candidate.expiryDate,
  quantity: candidate.quantity,
  shelfQuantity: candidate.shelfQuantity,
  warehouseQuantity: candidate.warehouseQuantity,
  locationCode: candidate.locationCode,
  sourceKey: candidate.sourceKey,
  reason: GROUP_REASON,
  reasonLabel: 'SKT geçmiş ürün - imha / iade değerlendirmesi gerekli',
  createdAt: now.toISOString(),
});

const countAffectedProducts = (items = []) => new Set(
  items
    .map((item) => String(item.productId || item.sku || item.productName || '').trim())
    .filter(Boolean),
).size;

const buildExpiredBatchGroupTitle = (items = []) => {
  const count = countAffectedProducts(items);
  return `${count || items.length} üründe SKT geçti`;
};

const buildExpiredBatchGroupMessage = (items = []) => {
  const batchCount = items.length;
  const productCount = countAffectedProducts(items);
  if (batchCount === productCount) {
    return `${productCount} ürünün SKT tarihi geçti. Detay için bildirimi açın.`;
  }
  return `${productCount} üründe ${batchCount} partinin SKT tarihi geçti. Detay için bildirimi açın.`;
};

export const buildExpiredBatchGroupNotificationRecord = (candidates, {
  userId,
  now = new Date(),
  todayKey = formatTodayKey(now),
} = {}) => {
  const items = candidates.map((candidate) => toGroupItem(candidate, now));
  const affectedProductCount = countAffectedProducts(items);
  return {
    id: uuidv4(),
    userId,
    type: NOTIFICATION_TYPE,
    title: buildExpiredBatchGroupTitle(items),
    message: buildExpiredBatchGroupMessage(items),
    severity: 'critical',
    isRead: false,
    createdAt: now.toISOString(),
    relatedTaskId: null,
    dedupeKey: buildExpiredBatchGroupDedupeKey(todayKey),
    actionUrl: ACTION_URL,
    actionType: ACTION_TYPE,
    createdBy: null,
    audience: {
      mode: 'role',
      roles: Array.from(TARGET_ROLES),
    },
    delivery: {
      sendAt: now.toISOString(),
      expiresAt: null,
      isPinned: false,
      requireReadReceipt: false,
    },
    payload: {
      type: NOTIFICATION_TYPE,
      severity: 'critical',
      entityType: 'notification_group',
      isNotificationGroup: true,
      groupType: NOTIFICATION_TYPE,
      groupLabel: 'SKT geçmiş ürünler',
      groupReason: GROUP_REASON,
      groupReasonLabel: 'SKT geçmiş ürün - imha / iade değerlendirmesi gerekli',
      groupWindow: 'daily_expired_batch_job',
      jobRunKey: todayKey,
      itemCount: items.length,
      affectedProductCount,
      sampleProductNames: items.slice(0, 5).map((item) => item.productName).filter(Boolean),
      sourceKeys: items.map((item) => item.sourceKey).filter(Boolean),
      items,
    },
    isDraft: false,
  };
};

const getGroupSourceKeys = (notification = {}) => {
  const payload = notification.payload && typeof notification.payload === 'object' ? notification.payload : {};
  const keys = new Set();
  if (notification.dedupeKey && notification.dedupeKey.startsWith('skt-expired:')) {
    keys.add(notification.dedupeKey);
  }
  if (payload.sourceKey) keys.add(payload.sourceKey);
  if (Array.isArray(payload.sourceKeys)) {
    payload.sourceKeys.forEach((item) => {
      const key = String(item || '').trim();
      if (key) keys.add(key);
    });
  }
  if (Array.isArray(payload.items)) {
    payload.items.forEach((item) => {
      const key = String(item?.sourceKey || '').trim();
      if (key) keys.add(key);
    });
  }
  return keys;
};

const mergeExpiredBatchGroupNotification = (existing, candidates, { now = new Date(), todayKey }) => {
  const payload = existing.payload && typeof existing.payload === 'object' ? existing.payload : {};
  const existingItems = Array.isArray(payload.items) ? payload.items : [];
  const existingKeys = getGroupSourceKeys(existing);
  const nextItems = [...existingItems];

  candidates.forEach((candidate) => {
    if (existingKeys.has(candidate.sourceKey)) return;
    nextItems.push(toGroupItem(candidate, now));
    existingKeys.add(candidate.sourceKey);
  });

  const affectedProductCount = countAffectedProducts(nextItems);
  return {
    ...existing,
    title: buildExpiredBatchGroupTitle(nextItems),
    message: buildExpiredBatchGroupMessage(nextItems),
    severity: 'critical',
    isRead: false,
    createdAt: now.toISOString(),
    actionUrl: ACTION_URL,
    actionType: ACTION_TYPE,
    payload: {
      ...payload,
      type: NOTIFICATION_TYPE,
      severity: 'critical',
      entityType: 'notification_group',
      isNotificationGroup: true,
      groupType: NOTIFICATION_TYPE,
      groupLabel: 'SKT geçmiş ürünler',
      groupReason: GROUP_REASON,
      groupReasonLabel: 'SKT geçmiş ürün - imha / iade değerlendirmesi gerekli',
      groupWindow: 'daily_expired_batch_job',
      jobRunKey: todayKey,
      itemCount: nextItems.length,
      affectedProductCount,
      sampleProductNames: nextItems.slice(0, 5).map((item) => item.productName).filter(Boolean),
      sourceKeys: nextItems.map((item) => item.sourceKey).filter(Boolean),
      items: nextItems,
    },
  };
};

const isLegacyExpiredBatchNotification = (notification = {}) => (
  notification.type === NOTIFICATION_TYPE
    && typeof notification.dedupeKey === 'string'
    && notification.dedupeKey.startsWith('skt-expired:')
    && !notification.dedupeKey.startsWith('skt-expired-group:')
);

const archiveLegacyExpiredBatchNotifications = async (notifications = [], { groupId, now = new Date() }) => {
  const archived = [];
  for (const notification of notifications) {
    const payload = notification.payload && typeof notification.payload === 'object' ? notification.payload : {};
    const next = {
      ...notification,
      isRead: true,
      status: 'archived',
      payload: {
        ...payload,
        supersededByGroupNotificationId: groupId,
        supersededReason: 'grouped_expired_batch_notification',
        supersededAt: now.toISOString(),
      },
    };
    const updated = await notificationRepo.updateById(notification.id, next);
    archived.push(updated || next);
  }
  return archived;
};

const summarizePlan = ({ candidates, skipped, targetUsers, existingNotifications, dryRun, todayKey }) => {
  const rows = candidates.map((candidate) => {
    const existingForBatch = existingNotifications.filter((item) => item.dedupeKey === candidate.sourceKey);
    const missingRecipients = targetUsers.filter((user) => !existingForBatch.some((item) => item.userId === user.id));
    return {
      ...candidate,
      title: `SKT Geçti: ${candidate.productName}`,
      message: `${candidate.productName} ürününün ${candidate.batchNo} parti numaralı stoğunun SKT tarihi ${candidate.expiryDate} olarak geçti. Kalan miktar: ${candidate.quantity}.`,
      existingNotificationCount: existingForBatch.length,
      missingRecipientCount: missingRecipients.length,
      willCreate: missingRecipients.length > 0,
    };
  });
  const groupKey = buildExpiredBatchGroupDedupeKey(todayKey || 'unknown-day');
  const groupedByUser = targetUsers.map((user) => {
    const existingForUser = existingNotifications.filter((item) => item.userId === user.id);
    const existingGroup = existingForUser.find((item) => item.dedupeKey === groupKey);
    const legacySingles = existingForUser.filter(isLegacyExpiredBatchNotification);
    const legacySourceKeys = new Set();
    legacySingles.forEach((item) => {
      getGroupSourceKeys(item).forEach((key) => legacySourceKeys.add(key));
    });
    const existingGroupKeys = existingGroup ? getGroupSourceKeys(existingGroup) : new Set();
    const missingCandidates = candidates.filter((candidate) => !existingGroupKeys.has(candidate.sourceKey));
    const legacyCandidates = candidates.filter((candidate) => legacySourceKeys.has(candidate.sourceKey));
    const candidatesForGroup = existingGroup ? missingCandidates : [...legacyCandidates, ...missingCandidates];
    const uniqueCandidatesForGroup = candidatesForGroup.filter((candidate, index, source) => (
      source.findIndex((item) => item.sourceKey === candidate.sourceKey) === index
    ));
    return {
      userId: user.id,
      groupKey,
      missingBatchCount: uniqueCandidatesForGroup.length,
      existingBatchCount: candidates.length - missingCandidates.length,
      willCreateOrUpdate: uniqueCandidatesForGroup.length > 0 || (existingGroup && legacySingles.length > 0),
    };
  });

  return {
    dryRun: Boolean(dryRun),
    totalExpiredBatches: candidates.length,
    existingNotificationBatches: groupedByUser.reduce((sum, item) => sum + item.existingBatchCount, 0),
    newNotificationBatches: groupedByUser.reduce((sum, item) => sum + item.missingBatchCount, 0),
    skippedBatches: skipped.length,
    targetUserCount: targetUsers.length,
    notificationsToCreate: groupedByUser.filter((item) => item.willCreateOrUpdate).length,
    groupedNotificationCount: groupedByUser.filter((item) => item.willCreateOrUpdate).length,
    invalidOrIgnoredRows: skipped.length,
    samples: rows.slice(0, 10),
  };
};

const buildUnavailablePlan = (dryRun) => ({
  dryRun: Boolean(dryRun),
  unavailable: true,
  reason: 'postgres_disabled',
  totalExpiredBatches: 0,
  existingNotificationBatches: 0,
  newNotificationBatches: 0,
  skippedBatches: 0,
  targetUserCount: 0,
  notificationsToCreate: 0,
  invalidOrIgnoredRows: 0,
  samples: [],
});

export const expiredBatchNotificationService = {
  async buildPlan({ dryRun = true, now = new Date() } = {}) {
    if (!isPostgresEnabled()) {
      return buildUnavailablePlan(dryRun);
    }

    const [{ candidates, skipped, todayKey }, targetUsers, existingNotifications] = await Promise.all([
      listExpiredBatchCandidatesFromPostgres({ now }),
      resolveTargetUsers(),
      notificationRepo.getAll(),
    ]);

    return {
      todayKey,
      ...summarizePlan({
        candidates,
        skipped,
        targetUsers,
        existingNotifications,
        dryRun,
        todayKey,
      }),
    };
  },

  async run({ dryRun = false, now = new Date() } = {}) {
    if (!isPostgresEnabled()) {
      return buildUnavailablePlan(dryRun);
    }

    const [{ candidates, skipped, todayKey }, targetUsers, existingNotifications] = await Promise.all([
      listExpiredBatchCandidatesFromPostgres({ now }),
      resolveTargetUsers(),
      notificationRepo.getAll(),
    ]);
    const groupKey = buildExpiredBatchGroupDedupeKey(todayKey);
    const created = [];
    const updated = [];
    const archivedLegacy = [];

    if (!dryRun) {
      for (const user of targetUsers) {
        const existingForUser = existingNotifications.filter((item) => item.userId === user.id);
        const existingGroup = existingForUser.find((item) => item.dedupeKey === groupKey);
        const legacySingles = existingForUser.filter(isLegacyExpiredBatchNotification);
        const legacySourceKeys = new Set();
        legacySingles.forEach((item) => {
          getGroupSourceKeys(item).forEach((key) => legacySourceKeys.add(key));
        });
        const existingGroupKeys = existingGroup ? getGroupSourceKeys(existingGroup) : new Set();
        const existingSourceKeys = existingGroup ? existingGroupKeys : new Set();
        const missingCandidates = candidates.filter((candidate) => !existingSourceKeys.has(candidate.sourceKey));
        const legacyCandidates = candidates.filter((candidate) => legacySourceKeys.has(candidate.sourceKey));
        const candidatesForGroup = existingGroup ? missingCandidates : [...legacyCandidates, ...missingCandidates];
        const uniqueCandidatesForGroup = candidatesForGroup.filter((candidate, index, source) => (
          source.findIndex((item) => item.sourceKey === candidate.sourceKey) === index
        ));
        if (uniqueCandidatesForGroup.length === 0) {
          if (existingGroup && legacySingles.length > 0) {
            archivedLegacy.push(...await archiveLegacyExpiredBatchNotifications(legacySingles, {
              groupId: existingGroup.id,
              now,
            }));
          }
          continue;
        }

        if (existingGroup) {
          const next = mergeExpiredBatchGroupNotification(existingGroup, uniqueCandidatesForGroup, { now, todayKey });
          const record = await notificationRepo.updateById(existingGroup.id, next);
          updated.push(record || next);
          if (legacySingles.length > 0) {
            archivedLegacy.push(...await archiveLegacyExpiredBatchNotifications(legacySingles, {
              groupId: existingGroup.id,
              now,
            }));
          }
          continue;
        }

        const payload = buildExpiredBatchGroupNotificationRecord(uniqueCandidatesForGroup, { userId: user.id, now, todayKey });
        const record = await notificationRepo.create(payload);
        created.push(record);
        if (legacySingles.length > 0) {
          archivedLegacy.push(...await archiveLegacyExpiredBatchNotifications(legacySingles, {
            groupId: record.id,
            now,
          }));
        }
      }
    }

    const summary = summarizePlan({
      candidates,
      skipped,
      targetUsers,
      existingNotifications: dryRun ? existingNotifications : [...existingNotifications, ...created, ...updated, ...archivedLegacy],
      dryRun,
      todayKey,
    });

    return {
      todayKey,
      ...summary,
      createdCount: created.length,
      updatedCount: updated.length,
      archivedLegacyCount: archivedLegacy.length,
      createdIds: created.map((item) => item.id),
      updatedIds: updated.map((item) => item.id).filter(Boolean),
    };
  },
};
