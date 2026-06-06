import { getPrisma } from '../providers/postgresProvider.js';

const clean = (value, max = 600) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}...(truncated)` : text;
};

const toIso = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const mapLoginActivityFromDb = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId || null,
    userType: row.userType || null,
    name: row.name || null,
    userName: row.name || null,
    email: row.email || null,
    username: row.username || null,
    role: row.role || null,
    department: row.department || null,
    eventType: row.eventType || null,
    source: row.source || null,
    status: row.status || null,
    ip: row.ip || null,
    ipAddress: row.ip || null,
    userAgent: row.userAgent || null,
    browser: row.browser || null,
    os: row.os || null,
    requestId: row.requestId || null,
    failureReason: row.failureReason || null,
    createdAt: toIso(row.createdAt),
    at: toIso(row.createdAt),
    archivedAt: toIso(row.archivedAt),
  };
};

const buildWhere = (filters = {}) => {
  const where = { archivedAt: null };
  const and = [];

  if (filters.fromDate || filters.toDate) {
    where.createdAt = {};
    if (filters.fromDate) where.createdAt.gte = filters.fromDate;
    if (filters.toDate) where.createdAt.lte = filters.toDate;
  }
  if (filters.userId) where.userId = filters.userId;
  if (filters.eventType) where.eventType = filters.eventType;
  if (filters.source) where.source = filters.source;
  if (filters.status) where.status = filters.status;
  if (filters.ip) where.ip = { contains: filters.ip, mode: 'insensitive' };
  if (filters.user) {
    and.push({
      OR: [
        { name: filters.user },
        { username: filters.user },
        { email: filters.user },
      ],
    });
  }
  if (filters.search) {
    const contains = String(filters.search).trim();
    const searchOr = [
      { name: { contains, mode: 'insensitive' } },
      { username: { contains, mode: 'insensitive' } },
      { email: { contains, mode: 'insensitive' } },
      { role: { contains, mode: 'insensitive' } },
      { department: { contains, mode: 'insensitive' } },
      { eventType: { contains, mode: 'insensitive' } },
      { source: { contains, mode: 'insensitive' } },
      { status: { contains, mode: 'insensitive' } },
      { ip: { contains, mode: 'insensitive' } },
      { browser: { contains, mode: 'insensitive' } },
      { os: { contains, mode: 'insensitive' } },
      { requestId: { contains, mode: 'insensitive' } },
      { failureReason: { contains, mode: 'insensitive' } },
    ];
    and.push({ OR: searchOr });
  }

  if (and.length) where.AND = and;

  return where;
};

export const loginActivityRepo = {
  async create(payload = {}) {
    const prisma = await getPrisma();
    const row = await prisma.loginActivityLog.create({
      data: {
        id: clean(payload.id, 120) || undefined,
        userId: clean(payload.userId, 120),
        userType: clean(payload.userType, 60),
        name: clean(payload.name || payload.userName, 200),
        email: clean(payload.email, 240),
        username: clean(payload.username, 200),
        role: clean(payload.role, 120),
        department: clean(payload.department, 160),
        eventType: clean(payload.eventType, 80),
        source: clean(payload.source, 80),
        status: clean(payload.status, 40),
        ip: clean(payload.ip || payload.ipAddress, 120),
        userAgent: clean(payload.userAgent, 700),
        browser: clean(payload.browser, 80),
        os: clean(payload.os, 80),
        requestId: clean(payload.requestId, 120),
        failureReason: clean(payload.failureReason, 240),
        createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
      },
    });
    return mapLoginActivityFromDb(row);
  },

  async list({ filters = {}, limit = 100, page = 1 } = {}) {
    const prisma = await getPrisma();
    const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 100));
    const safePage = Math.max(1, Number(page) || 1);
    const where = buildWhere(filters);
    const [rows, total] = await Promise.all([
      prisma.loginActivityLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.loginActivityLog.count({ where }),
    ]);

    return {
      items: rows.map(mapLoginActivityFromDb).filter(Boolean),
      total,
      limit: safeLimit,
      page: safePage,
    };
  },

  async archiveAll() {
    const prisma = await getPrisma();
    const result = await prisma.loginActivityLog.updateMany({
      where: { archivedAt: null },
      data: { archivedAt: new Date() },
    });
    return result.count || 0;
  },
};
