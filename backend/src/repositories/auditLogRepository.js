import { getPrisma } from '../providers/postgresProvider.js';

const toIso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const clean = (value) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const mapAuditLogFromDb = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    createdAt: toIso(row.createdAt),
    at: toIso(row.createdAt),
    actorUserId: row.actorUserId || null,
    actorName: row.actorName || null,
    actorRole: row.actorRole || null,
    actorEmail: row.actorEmail || null,
    action: row.action || null,
    module: row.module || null,
    entityType: row.entityType || null,
    entityId: row.entityId || null,
    entityLabel: row.entityLabel || null,
    method: row.method || null,
    endpoint: row.endpoint || null,
    statusCode: row.statusCode || null,
    ip: row.ip || null,
    userAgent: row.userAgent || null,
    requestId: row.requestId || null,
    correlationId: row.correlationId || null,
    summary: row.summary || null,
    details: row.summary || null,
    metadata: row.metadata || null,
    severity: row.severity || 'info',
    source: row.source || 'user_action',
    archivedAt: toIso(row.archivedAt),
  };
};

const buildWhere = (filters = {}) => {
  const where = {
    archivedAt: null,
  };

  if (filters.fromDate || filters.toDate) {
    where.createdAt = {};
    if (filters.fromDate) where.createdAt.gte = filters.fromDate;
    if (filters.toDate) where.createdAt.lte = filters.toDate;
  }

  if (filters.module) where.module = filters.module;
  if (filters.action) where.action = filters.action;
  if (filters.source) where.source = filters.source;
  if (filters.status) {
    const statusNumber = Number(filters.status);
    if (Number.isFinite(statusNumber)) where.statusCode = Math.floor(statusNumber);
  }
  if (filters.actorUserId) where.actorUserId = filters.actorUserId;
  if (filters.user) where.actorName = filters.user;

  if (filters.search) {
    const contains = String(filters.search).trim();
    where.OR = [
      { actorName: { contains, mode: 'insensitive' } },
      { actorEmail: { contains, mode: 'insensitive' } },
      { action: { contains, mode: 'insensitive' } },
      { module: { contains, mode: 'insensitive' } },
      { entityType: { contains, mode: 'insensitive' } },
      { entityId: { contains, mode: 'insensitive' } },
      { entityLabel: { contains, mode: 'insensitive' } },
      { endpoint: { contains, mode: 'insensitive' } },
      { summary: { contains, mode: 'insensitive' } },
      { requestId: { contains, mode: 'insensitive' } },
    ];
  }

  return where;
};

export const auditLogRepo = {
  async create(payload = {}) {
    const prisma = await getPrisma();
    const row = await prisma.auditLog.create({
      data: {
        id: clean(payload.id) || undefined,
        createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
        actorUserId: clean(payload.actorUserId),
        actorName: clean(payload.actorName),
        actorRole: clean(payload.actorRole),
        actorEmail: clean(payload.actorEmail),
        action: clean(payload.action),
        module: clean(payload.module),
        entityType: clean(payload.entityType),
        entityId: clean(payload.entityId),
        entityLabel: clean(payload.entityLabel),
        method: clean(payload.method),
        endpoint: clean(payload.endpoint),
        statusCode: Number.isFinite(Number(payload.statusCode)) ? Math.floor(Number(payload.statusCode)) : null,
        ip: clean(payload.ip),
        userAgent: clean(payload.userAgent),
        requestId: clean(payload.requestId),
        correlationId: clean(payload.correlationId),
        summary: clean(payload.summary),
        metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : null,
        severity: clean(payload.severity) || 'info',
        source: clean(payload.source) || 'user_action',
      },
    });
    return mapAuditLogFromDb(row);
  },

  async list({ filters = {}, limit = 100, page = 1 } = {}) {
    const prisma = await getPrisma();
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
    const safePage = Math.max(1, Number(page) || 1);
    const where = buildWhere(filters);
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map(mapAuditLogFromDb).filter(Boolean),
      total,
      limit: safeLimit,
      page: safePage,
    };
  },
};
