import { Prisma } from '@prisma/client';
import { getPrisma } from '../providers/postgresProvider.js';
import { getActiveTenantId } from '../tenant/tenantContext.js';
import { normalizeDateOnly } from '../utils/batchExpiry.js';
import { parsePagePagination, resolveWhitelistedSort } from '../utils/pagination.js';
import { resolveSktPolicy, SKT_POLICIES } from '../utils/sktPolicy.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';

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

const positiveQuantityWhere = {
  OR: [
    { totalQuantity: { gt: 0 } },
    { warehouseQuantity: { gt: 0 } },
    { shelfQuantity: { gt: 0 } },
  ],
};

export const buildActiveExpiryBatchWhere = ({ today, expiredOnly = false, includeToday = false } = {}) => {
  const date = normalizeQueryDate(today || new Date());
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
    Prisma.sql`(COALESCE(b.total_quantity, 0) > 0 OR COALESCE(b.warehouse_quantity, 0) > 0 OR COALESCE(b.shelf_quantity, 0) > 0)`,
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
    unitCost: Number(row.unitCost || 0),
    sktPolicy: sktPolicy.policy,
    sktPolicyReason: sktPolicy.reason || '',
    isSktApplicable: sktPolicy.policy !== SKT_POLICIES.NOT_APPLICABLE,
    ...riskMeta(daysToExpiry),
  };
};

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
    const today = normalizeQueryDate(query.today || new Date());
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
      expiredRows,
      trackingRows,
      summaryRows,
      categoryBuckets,
      optionRows,
    ] = await withPostgresQueryLogging('GET /api/stock/expiry-tracking', () => Promise.all([
      prisma.$queryRaw`${cte}
        SELECT * FROM filtered
        WHERE "daysToExpiry" < 0
        ORDER BY ${SORT_SQL[expiredSort]}
        LIMIT ${expiredPagination.limit} OFFSET ${expiredPagination.skip}`,
      prisma.$queryRaw`${cte}
        SELECT * FROM filtered
        WHERE "daysToExpiry" >= 0
        ORDER BY ${SORT_SQL[trackingSort]}
        LIMIT ${trackingPagination.limit} OFFSET ${trackingPagination.skip}`,
      prisma.$queryRaw`${cte}
        SELECT
          COUNT(*)::int AS "totalRows",
          COUNT(*) FILTER (WHERE "daysToExpiry" < 0)::int AS expired,
          COUNT(*) FILTER (WHERE "daysToExpiry" = 0)::int AS today,
          COUNT(*) FILTER (WHERE "daysToExpiry" BETWEEN 1 AND 3)::int AS "in3",
          COUNT(*) FILTER (WHERE "daysToExpiry" BETWEEN 4 AND 7)::int AS "in7",
          COUNT(*) FILTER (WHERE "daysToExpiry" > 7)::int AS later,
          COALESCE(SUM("unitCost" * "totalQuantity") FILTER (WHERE "daysToExpiry" <= 7), 0)::numeric AS "riskValue"
        FROM filtered`,
      prisma.$queryRaw`${cte}
        SELECT "categoryName" AS label, COUNT(*)::int AS value
        FROM filtered
        WHERE "daysToExpiry" <= 7
        GROUP BY "categoryName"
        ORDER BY value DESC, label ASC
        LIMIT 5`,
      prisma.$queryRaw`${cte}
        SELECT
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT "categoryName" ORDER BY "categoryName"), '-') AS categories,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT "supplierName" ORDER BY "supplierName"), '-') AS suppliers
        FROM filtered`,
    ]));

    const summary = summaryRows[0] || {};
    const expiredTotal = Number(summary.expired || 0);
    const trackingTotal = Math.max(0, Number(summary.totalRows || 0) - expiredTotal);
    return {
      expiredRows: expiredRows.map(mapRow),
      trackingRows: trackingRows.map(mapRow),
      pagination: {
        expired: paginationMeta(expiredPagination, expiredTotal),
        tracking: paginationMeta(trackingPagination, trackingTotal),
      },
      summary: {
        totalRows: Number(summary.totalRows || 0),
        expired: Number(summary.expired || 0),
        today: Number(summary.today || 0),
        in3: Number(summary.in3 || 0),
        in7: Number(summary.in7 || 0),
        later: Number(summary.later || 0),
        riskValue: Number(summary.riskValue || 0),
      },
      charts: {
        categoryBuckets: categoryBuckets.map((item) => ({
          label: item.label || 'Kategori yok',
          value: Number(item.value || 0),
          tone: 'primary',
        })),
      },
      options: {
        categories: optionRows[0]?.categories || [],
        suppliers: optionRows[0]?.suppliers || [],
      },
      filters,
      sort: { expired: expiredSort, tracking: trackingSort },
    };
  },
};
