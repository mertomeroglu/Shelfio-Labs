import { Prisma } from '@prisma/client';
import { getPrisma } from '../providers/postgresProvider.js';
import { getActiveTenantId } from '../tenant/tenantContext.js';
import { normalizeDateOnly } from '../utils/batchExpiry.js';
import { parsePagePagination, resolveWhitelistedSort } from '../utils/pagination.js';
import { resolveSktPolicy, SKT_POLICIES } from '../utils/sktPolicy.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';
import { config } from '../config/config.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const VALID_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (dateOnly, days) => new Date(Date.parse(`${dateOnly}T00:00:00.000Z`) + (days * DAY_MS))
  .toISOString()
  .slice(0, 10);

const normalizeText = (value) => String(value || '').trim();
const normalizeQueryDate = (value) => {
  const normalized = normalizeDateOnly(value);
  return VALID_DATE_ONLY.test(normalized) ? normalized : '';
};

const currentStoreDate = (now = new Date()) => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone || 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  } catch {
    return normalizeQueryDate(now);
  }
};

const positiveQuantityWhere = {
  OR: [
    { warehouseQuantity: { gt: 0 } },
    { shelfQuantity: { gt: 0 } },
  ],
};

export const buildActiveExpiryBatchWhere = ({ today, expiredOnly = false, includeToday = false } = {}) => {
  const date = normalizeQueryDate(today || currentStoreDate());
  return {
    ...positiveQuantityWhere,
    skt: expiredOnly
      ? (includeToday ? { lte: date } : { lt: date })
      : { not: null },
    stock: {
      product: {
        isActive: { not: false },
        isListed: { not: false },
      },
    },
  };
};

const normalizeFilters = (query = {}) => ({
  search: normalizeText(query.search || query.q),
  category: normalizeText(query.category),
  supplier: normalizeText(query.supplier),
  risk: normalizeText(query.risk),
  window: normalizeText(query.window),
  location: normalizeText(query.location),
  startDate: normalizeQueryDate(query.startDate),
  endDate: normalizeQueryDate(query.endDate),
});

const buildDateWindowSql = (key, today) => {
  const in3Days = addDays(today, 3);
  const in7Days = addDays(today, 7);
  if (key === 'expired') return Prisma.sql`b.skt < ${today}`;
  if (key === 'today') return Prisma.sql`b.skt = ${today}`;
  if (key === '3days') return Prisma.sql`b.skt > ${today} AND b.skt <= ${in3Days}`;
  if (key === '7days') return Prisma.sql`b.skt > ${in3Days} AND b.skt <= ${in7Days}`;
  if (key === 'later') return Prisma.sql`b.skt > ${in7Days}`;
  return null;
};

const buildFilteredBatchCte = ({ filters, tenantId, today }) => {
  const clauses = [
    Prisma.sql`b.tenant_id = ${tenantId}`,
    Prisma.sql`st.tenant_id = ${tenantId}`,
    Prisma.sql`p.tenant_id = ${tenantId}`,
    Prisma.sql`COALESCE(p.is_active, TRUE) <> FALSE`,
    Prisma.sql`COALESCE(p.is_listed, TRUE) <> FALSE`,
    Prisma.sql`b.skt ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    Prisma.sql`(COALESCE(b.warehouse_quantity, 0) > 0 OR COALESCE(b.shelf_quantity, 0) > 0 OR COALESCE(b.total_quantity, 0) > 0)`,
  ];

  if (filters.search) {
    const search = `%${filters.search}%`;
    clauses.push(Prisma.sql`(p.name ILIKE ${search} OR p.sku ILIKE ${search} OR COALESCE(p.barcode, '') ILIKE ${search} OR b.batch_no ILIKE ${search})`);
  }
  if (filters.category) clauses.push(Prisma.sql`COALESCE(c.name, '-') = ${filters.category}`);
  if (filters.supplier) clauses.push(Prisma.sql`COALESCE(s.name, '-') = ${filters.supplier}`);
  if (filters.location === 'warehouse') clauses.push(Prisma.sql`COALESCE(b.warehouse_quantity, 0) > 0`);
  if (filters.location === 'shelf') clauses.push(Prisma.sql`COALESCE(b.shelf_quantity, 0) > 0`);
  if (filters.startDate) clauses.push(Prisma.sql`b.skt >= ${filters.startDate}`);
  if (filters.endDate) clauses.push(Prisma.sql`b.skt <= ${filters.endDate}`);
  const riskSql = buildDateWindowSql(filters.risk, today);
  const windowSql = buildDateWindowSql(filters.window, today);
  if (riskSql) clauses.push(riskSql);
  if (windowSql) clauses.push(windowSql);

  return Prisma.sql`
    WITH filtered AS (
      SELECT
        b.id,
        b.product_id AS "productId",
        p.name AS "productName",
        p.sku,
        COALESCE(p.barcode, '') AS barcode,
        b.batch_no AS "batchNo",
        b.skt,
        COALESCE(b.warehouse_quantity, 0)::int AS "warehouseQuantity",
        COALESCE(b.shelf_quantity, 0)::int AS "shelfQuantity",
        GREATEST(COALESCE(b.total_quantity, 0), COALESCE(b.warehouse_quantity, 0) + COALESCE(b.shelf_quantity, 0))::int AS "totalQuantity",
        COALESCE(b.total_quantity, 0)::int AS "declaredTotalQuantity",
        COALESCE(c.name, '-') AS "categoryName",
        COALESCE(c.code, '') AS "categoryCode",
        COALESCE(s.name, '-') AS "supplierName",
        COALESCE(p.etiket, '') AS etiket,
        COALESCE(p.purchase_price, 0)::numeric AS "unitCost",
        (b.skt::date - ${today}::date)::int AS "daysToExpiry"
      FROM stock_batches b
      JOIN stocks st ON st.id = b.stock_id
      JOIN products p ON p.id = st.product_id
      LEFT JOIN categories c ON c.id = p.category_id AND c.tenant_id = ${tenantId}
      LEFT JOIN suppliers s ON s.id = p.supplier_id AND s.tenant_id = ${tenantId}
      WHERE ${Prisma.join(clauses, ' AND ')}
    )
  `;
};

const SORT_SQL = {
  skt_asc: Prisma.sql`"skt" ASC, "productName" ASC, id ASC`,
  skt_desc: Prisma.sql`"skt" DESC, "productName" ASC, id ASC`,
  product_name_asc: Prisma.sql`"productName" ASC, "skt" ASC, id ASC`,
  product_name_desc: Prisma.sql`"productName" DESC, "skt" ASC, id ASC`,
  sku_asc: Prisma.sql`sku ASC, "skt" ASC, id ASC`,
  sku_desc: Prisma.sql`sku DESC, "skt" ASC, id ASC`,
  barcode_asc: Prisma.sql`barcode ASC, "skt" ASC, id ASC`,
  barcode_desc: Prisma.sql`barcode DESC, "skt" ASC, id ASC`,
  batch_no_asc: Prisma.sql`"batchNo" ASC, "skt" ASC, id ASC`,
  batch_no_desc: Prisma.sql`"batchNo" DESC, "skt" ASC, id ASC`,
  days_to_expiry_asc: Prisma.sql`"daysToExpiry" ASC, "skt" ASC, id ASC`,
  days_to_expiry_desc: Prisma.sql`"daysToExpiry" DESC, "skt" ASC, id ASC`,
  warehouse_quantity_asc: Prisma.sql`"warehouseQuantity" ASC, "skt" ASC, id ASC`,
  warehouse_quantity_desc: Prisma.sql`"warehouseQuantity" DESC, "skt" ASC, id ASC`,
  shelf_quantity_asc: Prisma.sql`"shelfQuantity" ASC, "skt" ASC, id ASC`,
  shelf_quantity_desc: Prisma.sql`"shelfQuantity" DESC, "skt" ASC, id ASC`,
  total_quantity_asc: Prisma.sql`"totalQuantity" ASC, "skt" ASC, id ASC`,
  total_quantity_desc: Prisma.sql`"totalQuantity" DESC, "skt" ASC, id ASC`,
  category_name_asc: Prisma.sql`"categoryName" ASC, "skt" ASC, id ASC`,
  category_name_desc: Prisma.sql`"categoryName" DESC, "skt" ASC, id ASC`,
  supplier_name_asc: Prisma.sql`"supplierName" ASC, "skt" ASC, id ASC`,
  supplier_name_desc: Prisma.sql`"supplierName" DESC, "skt" ASC, id ASC`,
};

const normalizeSort = (value) => resolveWhitelistedSort(
  value,
  Object.keys(SORT_SQL),
  'skt_asc',
  { context: 'GET /api/stock/expiry-tracking' }
);

const riskMeta = (daysToExpiry) => {
  if (daysToExpiry < 0) return { riskKey: 'expired', riskLabel: 'SKT geçmiş', riskTone: Math.abs(daysToExpiry) > 30 ? 'danger' : 'warning' };
  if (daysToExpiry === 0) return { riskKey: 'today', riskLabel: 'Bugün kritik', riskTone: 'danger' };
  if (daysToExpiry <= 3) return { riskKey: '3days', riskLabel: '1-3 gün', riskTone: 'warning' };
  if (daysToExpiry <= 7) return { riskKey: '7days', riskLabel: '4-7 gün', riskTone: 'primary' };
  return { riskKey: 'later', riskLabel: 'Takipte', riskTone: 'neutral' };
};

const mapRow = (row = {}) => {
  const daysToExpiry = Number(row.daysToExpiry || 0);
  const sktPolicy = resolveSktPolicy({
    product: {
      name: row.productName,
      categoryName: row.categoryName,
      categoryCode: row.categoryCode,
      etiket: row.etiket,
    },
    category: { name: row.categoryName, code: row.categoryCode },
  });
  return {
    ...row,
    daysToExpiry,
    warehouseQuantity: Number(row.warehouseQuantity || 0),
    shelfQuantity: Number(row.shelfQuantity || 0),
    totalQuantity: Number(row.totalQuantity || 0),
    declaredTotalQuantity: Number(row.declaredTotalQuantity || 0),
    hasQuantityMismatch: Number(row.declaredTotalQuantity || 0) !== Number(row.totalQuantity || 0),
    disposalEligible: daysToExpiry < 0
      && sktPolicy.policy === SKT_POLICIES.REQUIRED
      && Number(row.totalQuantity || 0) > 0,
    unitCost: Number(row.unitCost || 0),
    sktPolicy: sktPolicy.policy,
    sktPolicyReason: sktPolicy.reason || '',
    isSktApplicable: sktPolicy.policy === SKT_POLICIES.REQUIRED,
    ...riskMeta(daysToExpiry),
  };
};

const requiredOnly = (row = {}) => row.sktPolicy === SKT_POLICIES.REQUIRED;

const paginateRows = (rows = [], pagination) => rows.slice(pagination.skip, pagination.skip + pagination.limit);

const buildSummary = (rows = []) => rows.reduce((acc, row) => {
  const days = Number(row.daysToExpiry || 0);
  acc.totalRows += 1;
  if (days < 0) acc.expired += 1;
  else if (days === 0) acc.today += 1;
  else if (days <= 3) acc.in3 += 1;
  else if (days <= 7) acc.in7 += 1;
  else acc.later += 1;
  if (days <= 7) acc.riskValue += Number(row.unitCost || 0) * Number(row.totalQuantity || 0);
  return acc;
}, { totalRows: 0, expired: 0, today: 0, in3: 0, in7: 0, later: 0, riskValue: 0 });

const buildCategoryBuckets = (rows = []) => {
  const buckets = new Map();
  rows
    .filter((row) => Number(row.daysToExpiry || 0) <= 7)
    .forEach((row) => {
      const label = row.categoryName || 'Kategori yok';
      buckets.set(label, (buckets.get(label) || 0) + 1);
    });
  return [...buckets.entries()]
    .map(([label, value]) => ({ label, value, tone: 'primary' }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, 'tr'))
    .slice(0, 5);
};

const buildOptions = (rows = []) => ({
  categories: [...new Set(rows.map((row) => row.categoryName).filter((value) => value && value !== '-'))].sort((a, b) => a.localeCompare(b, 'tr')),
  suppliers: [...new Set(rows.map((row) => row.supplierName).filter((value) => value && value !== '-'))].sort((a, b) => a.localeCompare(b, 'tr')),
});

const paginationMeta = (pagination, total) => ({
  mode: 'offset',
  page: pagination.page,
  limit: pagination.limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
  hasNextPage: pagination.skip + pagination.limit < total,
  nextCursor: null,
  cursorVersion: null,
});

export const expiryTrackingService = {
  async getReadModel(query = {}) {
    const prisma = await getPrisma();
    const tenantId = getActiveTenantId();
    const today = normalizeQueryDate(query.today || currentStoreDate());
    const filters = normalizeFilters(query);
    const expiredPagination = parsePagePagination(
      { page: query.expiredPage, limit: query.expiredLimit },
      { defaultLimit: DEFAULT_PAGE_SIZE, maxLimit: MAX_PAGE_SIZE }
    );
    const trackingPagination = parsePagePagination(
      { page: query.trackingPage, limit: query.trackingLimit },
      { defaultLimit: DEFAULT_PAGE_SIZE, maxLimit: MAX_PAGE_SIZE }
    );
    const expiredSort = normalizeSort(query.expiredSort);
    const trackingSort = normalizeSort(query.trackingSort);
    const cte = buildFilteredBatchCte({ filters, tenantId, today });

    const [
      expiredRawRows,
      trackingRawRows,
    ] = await withPostgresQueryLogging('GET /api/stock/expiry-tracking', () => Promise.all([
      prisma.$queryRaw`${cte}
        SELECT * FROM filtered
        WHERE "daysToExpiry" < 0
        ORDER BY ${SORT_SQL[expiredSort]}`,
      prisma.$queryRaw`${cte}
        SELECT * FROM filtered
        WHERE "daysToExpiry" >= 0
        ORDER BY ${SORT_SQL[trackingSort]}`,
    ]));

    const expiredRequiredRows = expiredRawRows.map(mapRow).filter(requiredOnly);
    const trackingRequiredRows = trackingRawRows.map(mapRow).filter(requiredOnly);
    const allRequiredRows = [...expiredRequiredRows, ...trackingRequiredRows];
    const summary = buildSummary(allRequiredRows);
    const expiredTotal = expiredRequiredRows.length;
    const trackingTotal = trackingRequiredRows.length;
    return {
      expiredRows: paginateRows(expiredRequiredRows, expiredPagination),
      trackingRows: paginateRows(trackingRequiredRows, trackingPagination),
      pagination: {
        expired: paginationMeta(expiredPagination, expiredTotal),
        tracking: paginationMeta(trackingPagination, trackingTotal),
      },
      summary: {
        totalRows: summary.totalRows,
        expired: summary.expired,
        today: summary.today,
        in3: summary.in3,
        in7: summary.in7,
        later: summary.later,
        riskValue: Number(summary.riskValue || 0),
      },
      charts: {
        categoryBuckets: buildCategoryBuckets(allRequiredRows),
      },
      options: buildOptions(allRequiredRows),
      filters,
      sort: { expired: expiredSort, tracking: trackingSort },
    };
  },
};
