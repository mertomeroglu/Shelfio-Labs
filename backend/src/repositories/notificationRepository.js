import crypto from 'crypto';
import { createFileRepository } from './fileRepository.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { getActiveTenantId } from '../tenant/tenantContext.js';
import { normalizeTurkishTextDeep } from '../utils/turkishText.js';

const baseRepo = createFileRepository({ fileName: 'notifications.json', defaultData: [] });

const normalizeNotificationRecord = (item = {}) => normalizeTurkishTextDeep(item);

const normalizeNotificationCollection = (items = []) => (
  Array.isArray(items) ? items.map((item) => normalizeNotificationRecord(item)) : []
);

const readNormalizedAll = async () => {
  const rows = await baseRepo.getAll();
  const normalized = normalizeNotificationCollection(rows);
  if (config.runStartupMaintenance && JSON.stringify(rows) !== JSON.stringify(normalized)) {
    await baseRepo.writeData(normalized);
  }
  return normalized;
};

const fromDate = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

const mapNotificationFromDb = (row = {}) => normalizeNotificationRecord({
  ...(row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {}),
  id: row.id,
  tenantId: row.tenantId,
  userId: row.userId,
  type: row.type || '',
  title: row.title || '',
  message: row.message || '',
  severity: row.severity || 'low',
  isRead: row.isRead === true,
  relatedTaskId: row.relatedTaskId || null,
  dedupeKey: row.dedupeKey || null,
  actionUrl: row.actionUrl || '',
  actionType: row.actionType || '',
  audience: row.audience || undefined,
  delivery: row.delivery || undefined,
  payload: row.payload || undefined,
  createdAt: fromDate(row.createdAt),
  createdBy: row.createdBy || null,
});

const buildUserWhere = (userId, {
  onlyUnread = false,
  severity,
  active = true,
  assigned = false,
  excludeIds = [],
  excludeTypes = [],
} = {}) => {
  const where = {
    tenantId: getActiveTenantId(),
    userId,
  };
  if (onlyUnread || active !== false) {
    where.isRead = false;
  }
  if (severity) {
    where.severity = severity;
  }
  if (assigned) {
    where.relatedTaskId = { not: null };
  }
  if (Array.isArray(excludeIds) && excludeIds.length) {
    where.id = { notIn: excludeIds };
  }
  if (Array.isArray(excludeTypes) && excludeTypes.length) {
    where.type = { notIn: excludeTypes };
  }
  return where;
};

const getDelegate = async () => {
  const prisma = await getPrisma();
  return prisma.notification;
};

const buildTenantWhere = (extra = {}) => ({
  tenantId: getActiveTenantId(),
  ...extra,
});

export const notificationRepo = {
  ...baseRepo,

  async getAll() {
    const delegate = await getDelegate();
    const rows = await delegate.findMany({
      where: buildTenantWhere(),
    });
    return rows.map((row) => mapNotificationFromDb(row));
  },

  async findById(id) {
    const delegate = await getDelegate();
    const row = await delegate.findFirst({
      where: buildTenantWhere({ id }),
    });
    return row ? mapNotificationFromDb(row) : null;
  },

  async writeData(items) {
    return baseRepo.writeData(normalizeNotificationCollection(items));
  },

  async create(item) {
    const nextItem = {
      id: item.id || crypto.randomUUID(),
      ...item,
    };
    return baseRepo.create(normalizeNotificationRecord(nextItem));
  },

  async updateById(id, updater) {
    return baseRepo.updateById(id, (current) => {
      const nextValue = typeof updater === 'function' ? updater(current) : updater;
      return normalizeNotificationRecord(nextValue);
    });
  },

  async findByUserId(userId) {
    const delegate = await getDelegate();
    const rows = await delegate.findMany({
      where: buildTenantWhere({ userId }),
    });
    return rows.map((row) => mapNotificationFromDb(row));
  },

  async findByUserIdPaged(userId, options = {}) {
    const delegate = await getDelegate();
    const where = buildUserWhere(userId, options);
    const rows = await delegate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: Math.max(0, Number(options.skip || 0)),
      take: Math.max(1, Number(options.take || 30)),
    });
    return rows.map((row) => mapNotificationFromDb(row));
  },

  async countByUserId(userId, options = {}) {
    const delegate = await getDelegate();
    return delegate.count({ where: buildUserWhere(userId, options) });
  },

  async getSummaryByUserId(userId, options = {}) {
    const delegate = await getDelegate();
    const baseWhere = buildUserWhere(userId, { ...options, active: false, onlyUnread: false });
    const [totalCount, unreadCount, severityRows] = await Promise.all([
      delegate.count({ where: baseWhere }),
      delegate.count({ where: { ...baseWhere, isRead: false } }),
      delegate.groupBy({
        by: ['severity'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    return {
      unreadCount,
      totalCount,
      severityCounts: severityRows.reduce((acc, row) => {
        const key = row.severity || 'low';
        acc[key] = row._count?._all || 0;
        return acc;
      }, {}),
    };
  },

  async getAnalyticsByUserId(userId, options = {}) {
    const delegate = await getDelegate();
    const where = buildUserWhere(userId, { ...options, active: false, onlyUnread: false });
    const [total, typeRows, recentActionRows] = await Promise.all([
      delegate.count({ where }),
      delegate.groupBy({
        by: ['type'],
        where,
        _count: { _all: true },
        orderBy: { _count: { type: 'desc' } },
        take: 1,
      }),
      delegate.findMany({
        where,
        select: { payload: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    return {
      total,
      typeRows,
      recentActions: recentActionRows.map((row) => row.payload?.actionLog).filter(Array.isArray),
    };
  },

  async findByUserAndDedupeKey(userId, dedupeKey) {
    if (!dedupeKey) return null;
    const delegate = await getDelegate();
    const row = await delegate.findFirst({
      where: buildTenantWhere({ userId, dedupeKey }),
    });
    return row ? mapNotificationFromDb(row) : null;
  },

  async markAllAsRead(userId) {
    const delegate = await getDelegate();
    const result = await delegate.updateMany({
      where: buildTenantWhere({ userId, isRead: false }),
      data: { isRead: true },
    });
    return { updated: result.count > 0 };
  },
};
