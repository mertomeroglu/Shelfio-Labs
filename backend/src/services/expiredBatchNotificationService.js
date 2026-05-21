import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/config.js';
import { notificationRepo } from '../repositories/notificationRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { getPrisma, isPostgresEnabled } from '../providers/postgresProvider.js';
import { normalizeDateOnly } from '../utils/batchExpiry.js';

const NOTIFICATION_TYPE = 'skt_expired';
const ACTION_URL = '/stok-islemleri';
const ACTION_TYPE = 'stock';
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
    where: {
      totalQuantity: { gt: 0 },
      stock: {
        product: {
          isActive: { not: false },
          isListed: { not: false },
        },
      },
    },
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

const summarizePlan = ({ candidates, skipped, targetUsers, existingNotifications, dryRun }) => {
  const existingKeys = new Set(existingNotifications.map((item) => item.dedupeKey).filter(Boolean));
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

  return {
    dryRun: Boolean(dryRun),
    totalExpiredBatches: candidates.length,
    existingNotificationBatches: rows.filter((item) => existingKeys.has(item.sourceKey)).length,
    newNotificationBatches: rows.filter((item) => item.willCreate).length,
    skippedBatches: skipped.length + rows.filter((item) => !item.willCreate).length,
    targetUserCount: targetUsers.length,
    notificationsToCreate: rows.reduce((sum, item) => sum + item.missingRecipientCount, 0),
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
    const existingByKeyAndUser = new Set(
      existingNotifications
        .filter((item) => item.dedupeKey)
        .map((item) => `${item.dedupeKey}:${item.userId}`),
    );
    const created = [];

    if (!dryRun) {
      for (const candidate of candidates) {
        for (const user of targetUsers) {
          const duplicateKey = `${candidate.sourceKey}:${user.id}`;
          if (existingByKeyAndUser.has(duplicateKey)) continue;
          const payload = buildExpiredBatchNotificationRecord(candidate, { userId: user.id, now });
          const record = await notificationRepo.create(payload);
          existingByKeyAndUser.add(duplicateKey);
          created.push(record);
        }
      }
    }

    const summary = summarizePlan({
      candidates,
      skipped,
      targetUsers,
      existingNotifications: dryRun ? existingNotifications : [...existingNotifications, ...created],
      dryRun,
    });

    return {
      todayKey,
      ...summary,
      createdCount: created.length,
      createdIds: created.map((item) => item.id),
    };
  },
};
