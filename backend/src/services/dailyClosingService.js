import { config } from '../config/config.js';
import { dailyStoreClosingRepo } from '../repositories/dailyStoreClosingRepository.js';
import { salesRepo } from '../repositories/salesRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { getStoreLocalParts, getStoreTimezone, zonedLocalDateTimeToUtc } from '../utils/storeSchedule.js';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_STORE_ID = 'store-main';
const DAY_MS = 24 * 60 * 60 * 1000;
export const OFFICIAL_DAILY_CLOSE = 'official_daily_close';
export const MANUAL_SNAPSHOT = 'manual_snapshot';

const roundMoney = (value) => Number((Number(value || 0) || 0).toFixed(4));

export const addDaysToLocalDate = (localDate, days) => {
  const [year, month, day] = String(localDate || '').split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return date.toISOString().slice(0, 10);
};

const getClosingId = (storeId, businessDate, closingType = OFFICIAL_DAILY_CLOSE) => (
  closingType === OFFICIAL_DAILY_CLOSE
    ? `daily-closing-${storeId}-${businessDate}`
    : `daily-closing-${storeId}-${businessDate}-${closingType}-${uuidv4()}`
);

const getStoreId = (settings = {}) => String(settings.storeId || settings.defaultStoreId || DEFAULT_STORE_ID).trim() || DEFAULT_STORE_ID;

const normalizeClosingType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === OFFICIAL_DAILY_CLOSE ? OFFICIAL_DAILY_CLOSE : MANUAL_SNAPSHOT;
};

const normalizeSaleType = (value) => String(value || 'sale').trim().toLowerCase();

const isCountableSale = (sale = {}) => {
  const status = String(sale.status || '').trim().toLowerCase();
  return !['cancelled', 'canceled', 'void', 'deleted'].includes(status);
};

const sumItemQuantity = (sale = {}) => {
  const items = Array.isArray(sale.items) ? sale.items : [];
  return items.reduce((sum, item) => sum + Math.max(0, Number(item?.quantity || 0) || 0), 0);
};

export const buildDailyClosingMetrics = (sales = []) => {
  const rows = Array.isArray(sales) ? sales.filter(isCountableSale) : [];
  const saleRows = rows.filter((sale) => normalizeSaleType(sale.type) !== 'return');
  const returnRows = rows.filter((sale) => normalizeSaleType(sale.type) === 'return');
  const grossSalesAmount = roundMoney(saleRows.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0));
  const returnAmount = roundMoney(returnRows.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0));

  return {
    salesCount: saleRows.length,
    returnCount: returnRows.length,
    transactionCount: saleRows.length + returnRows.length,
    grossSalesAmount,
    returnAmount,
    netRevenue: roundMoney(grossSalesAmount - returnAmount),
    itemCount: rows.reduce((sum, sale) => sum + sumItemQuantity(sale), 0),
  };
};

const normalizePaymentMethod = (value) => String(value || 'cash').trim().toLowerCase() || 'cash';

export const buildDailyClosingPaymentBreakdown = (sales = []) => {
  const rows = Array.isArray(sales) ? sales.filter(isCountableSale) : [];
  return rows.reduce((acc, sale) => {
    const sign = normalizeSaleType(sale.type) === 'return' ? -1 : 1;
    const payments = Array.isArray(sale.payments) && sale.payments.length
      ? sale.payments
      : [{ method: sale.paymentMethod || 'cash', amount: sale.totalAmount || 0 }];
    payments.forEach((payment) => {
      const method = normalizePaymentMethod(payment?.method);
      acc[method] = roundMoney((acc[method] || 0) + (sign * Number(payment?.amount || 0)));
    });
    return acc;
  }, {});
};

const buildOperationalState = (settings = {}) => {
  const deskActivationState = settings?.deskActivationState && typeof settings.deskActivationState === 'object'
    ? settings.deskActivationState
    : {};
  const openDeskCodes = Object.entries(deskActivationState)
    .filter(([, isOpen]) => isOpen === true)
    .map(([deskCode]) => deskCode);
  return {
    openDeskCodes,
    hasOpenDesks: openDeskCodes.length > 0,
  };
};

const buildClosingPayload = ({ storeId, businessDate, timezone, closingType, metrics, source, rangeStartUtc, rangeEndUtc, closedAt, sales, operationalState }) => ({
  id: getClosingId(storeId, businessDate, closingType),
  storeId,
  businessDate,
  closingType,
  closedAt: closedAt.toISOString(),
  timezone,
  ...metrics,
  source,
  payload: {
    rangeStartUtc: rangeStartUtc.toISOString(),
    rangeEndUtc: rangeEndUtc.toISOString(),
    zeroActivity: metrics.transactionCount === 0,
    paymentBreakdown: buildDailyClosingPaymentBreakdown(sales),
    openDeskCodes: operationalState.openDeskCodes,
    hasOpenDesks: operationalState.hasOpenDesks,
    generatedBy: closingType === OFFICIAL_DAILY_CLOSE ? 'daily-closing-job' : 'pos-manual-snapshot',
  },
});

const mapClosingRow = (row = {}) => ({
  id: row.id,
  storeId: row.storeId,
  businessDate: row.businessDate instanceof Date ? row.businessDate.toISOString().slice(0, 10) : String(row.businessDate || '').slice(0, 10),
  closingType: normalizeClosingType(row.closingType),
  closedAt: row.closedAt instanceof Date ? row.closedAt.toISOString() : row.closedAt,
  timezone: row.timezone,
  salesCount: Number(row.salesCount || 0),
  returnCount: Number(row.returnCount || 0),
  transactionCount: Number(row.transactionCount || 0),
  grossSalesAmount: roundMoney(row.grossSalesAmount),
  returnAmount: roundMoney(row.returnAmount),
  netRevenue: roundMoney(row.netRevenue),
  itemCount: Number(row.itemCount || 0),
  source: row.source || null,
  payload: row.payload || {},
  createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

const getSalesForBusinessDatePostgres = async ({ rangeStartUtc, rangeEndUtc }) => {
  const prisma = await getPrisma();
  return prisma.sale.findMany({
    where: {
      createdAt: {
        gte: rangeStartUtc,
        lt: rangeEndUtc,
      },
    },
    select: {
      id: true,
      type: true,
      status: true,
      totalAmount: true,
      items: true,
      createdAt: true,
    },
  });
};

const getSalesForBusinessDateJson = async ({ businessDate, timezone, rangeStartUtc = null, rangeEndUtc = null }) => {
  const sales = await salesRepo.getAll();
  return sales.filter((sale) => {
    const parsed = new Date(sale.createdAt);
    if (!Number.isFinite(parsed.getTime())) return false;
    if (rangeStartUtc && parsed < rangeStartUtc) return false;
    if (rangeEndUtc && parsed >= rangeEndUtc) return false;
    return getStoreLocalParts(parsed, timezone).localDate === businessDate;
  });
};

const saveClosingPostgres = async (closing) => {
  const prisma = await getPrisma();
  const businessDate = new Date(`${closing.businessDate}T00:00:00.000Z`);
  const upsertWithRawSql = async () => {
    const rows = await prisma.$queryRaw`
      INSERT INTO daily_store_closings (
        id, store_id, business_date, closing_type, closed_at, timezone, sales_count, return_count, transaction_count,
        gross_sales_amount, return_amount, net_revenue, item_count, source, payload
      )
      VALUES (
        ${closing.id}, ${closing.storeId}, ${businessDate}, ${closing.closingType}, ${new Date(closing.closedAt)}, ${closing.timezone}, ${closing.salesCount},
        ${closing.returnCount}, ${closing.transactionCount}, ${closing.grossSalesAmount},
        ${closing.returnAmount}, ${closing.netRevenue}, ${closing.itemCount}, ${closing.source}, ${closing.payload}
      )
      ON CONFLICT (id) DO UPDATE SET
        closing_type = EXCLUDED.closing_type,
        closed_at = EXCLUDED.closed_at,
        timezone = EXCLUDED.timezone,
        sales_count = EXCLUDED.sales_count,
        return_count = EXCLUDED.return_count,
        transaction_count = EXCLUDED.transaction_count,
        gross_sales_amount = EXCLUDED.gross_sales_amount,
        return_amount = EXCLUDED.return_amount,
        net_revenue = EXCLUDED.net_revenue,
        item_count = EXCLUDED.item_count,
        source = EXCLUDED.source,
        payload = EXCLUDED.payload,
        updated_at = now()
      RETURNING
        id,
        store_id AS "storeId",
        business_date AS "businessDate",
        closing_type AS "closingType",
        closed_at AS "closedAt",
        timezone,
        sales_count AS "salesCount",
        return_count AS "returnCount",
        transaction_count AS "transactionCount",
        gross_sales_amount AS "grossSalesAmount",
        return_amount AS "returnAmount",
        net_revenue AS "netRevenue",
        item_count AS "itemCount",
        source,
        payload,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;
    return mapClosingRow(rows?.[0] || closing);
  };

  if (!prisma.dailyStoreClosing?.upsert) {
    return upsertWithRawSql();
  }

  try {
    const createPayload = {
      id: closing.id,
      storeId: closing.storeId,
      businessDate,
      closingType: closing.closingType,
      closedAt: new Date(closing.closedAt),
      timezone: closing.timezone,
      salesCount: closing.salesCount,
      returnCount: closing.returnCount,
      transactionCount: closing.transactionCount,
      grossSalesAmount: closing.grossSalesAmount,
      returnAmount: closing.returnAmount,
      netRevenue: closing.netRevenue,
      itemCount: closing.itemCount,
      source: closing.source,
      payload: closing.payload,
    };
    const updatePayload = {
      closingType: closing.closingType,
      closedAt: new Date(closing.closedAt),
      timezone: closing.timezone,
      salesCount: closing.salesCount,
      returnCount: closing.returnCount,
      transactionCount: closing.transactionCount,
      grossSalesAmount: closing.grossSalesAmount,
      returnAmount: closing.returnAmount,
      netRevenue: closing.netRevenue,
      itemCount: closing.itemCount,
      source: closing.source,
      payload: closing.payload,
    };
    const row = closing.closingType === OFFICIAL_DAILY_CLOSE
      ? await prisma.dailyStoreClosing.upsert({
        where: { id: closing.id },
        create: createPayload,
        update: updatePayload,
      })
      : await prisma.dailyStoreClosing.create({ data: createPayload });
    return mapClosingRow(row);
  } catch (error) {
    if (error?.code === 'P2021') {
      console.warn('[daily-closing-service] daily_store_closings table is missing; closing snapshot was not persisted');
      return mapClosingRow({
        ...closing,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        payload: {
          ...(closing.payload || {}),
          skippedPersistence: true,
          reason: 'daily_store_closings table is missing',
        },
      });
    }
    throw error;
  }
};

const saveClosingJson = async (closing) => {
  const existing = await dailyStoreClosingRepo.findById(closing.id);
  const now = new Date().toISOString();
  if (existing && closing.closingType === OFFICIAL_DAILY_CLOSE) {
    return dailyStoreClosingRepo.updateById(closing.id, {
      ...existing,
      ...closing,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    });
  }
  return dailyStoreClosingRepo.create({
    ...closing,
    createdAt: now,
    updatedAt: now,
  });
};

export const dailyClosingService = {
  async closeBusinessDate(businessDate, { source = 'manual', closingType = OFFICIAL_DAILY_CLOSE, closedAt = null } = {}) {
    const settings = await settingsRepo.getSettings();
    const timezone = getStoreTimezone(settings);
    const storeId = getStoreId(settings);
    const safeClosingType = normalizeClosingType(closingType);
    const localDate = String(businessDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      throw new Error('businessDate must be YYYY-MM-DD');
    }

    const rangeStartUtc = zonedLocalDateTimeToUtc(localDate, 0, timezone);
    const officialRangeEndUtc = zonedLocalDateTimeToUtc(addDaysToLocalDate(localDate, 1), 0, timezone);
    const safeClosedAt = closedAt ? new Date(closedAt) : (safeClosingType === OFFICIAL_DAILY_CLOSE ? officialRangeEndUtc : new Date());
    const rangeEndUtc = safeClosingType === OFFICIAL_DAILY_CLOSE ? officialRangeEndUtc : safeClosedAt;
    const sales = config.dataStore === 'postgres'
      ? await getSalesForBusinessDatePostgres({ rangeStartUtc, rangeEndUtc })
      : await getSalesForBusinessDateJson({ businessDate: localDate, timezone, rangeStartUtc, rangeEndUtc });
    const metrics = buildDailyClosingMetrics(sales);
    const operationalState = buildOperationalState(settings);
    const closing = buildClosingPayload({
      storeId,
      businessDate: localDate,
      timezone,
      closingType: safeClosingType,
      metrics,
      source,
      rangeStartUtc,
      rangeEndUtc,
      closedAt: safeClosedAt,
      sales,
      operationalState,
    });

    return config.dataStore === 'postgres'
      ? saveClosingPostgres(closing)
      : saveClosingJson(closing);
  },

  async closeCurrentManualSnapshot({ source = 'pos-manual-snapshot' } = {}) {
    const settings = await settingsRepo.getSettings();
    const timezone = getStoreTimezone(settings);
    const today = getStoreLocalParts(new Date(), timezone).localDate;
    return this.closeBusinessDate(today, {
      source,
      closingType: MANUAL_SNAPSHOT,
      closedAt: new Date(),
    });
  },

  async closePreviousBusinessDate({ source = 'scheduler' } = {}) {
    const settings = await settingsRepo.getSettings();
    const timezone = getStoreTimezone(settings);
    const today = getStoreLocalParts(new Date(), timezone).localDate;
    return this.closeBusinessDate(addDaysToLocalDate(today, -1), { source });
  },

  async ensureRecentClosings(days = 7, { source = 'startup-backfill' } = {}) {
    const settings = await settingsRepo.getSettings();
    const timezone = getStoreTimezone(settings);
    const today = getStoreLocalParts(new Date(), timezone).localDate;
    const safeDays = Math.max(1, Math.min(31, Math.floor(Number(days) || 7)));
    const results = [];
    for (let offset = safeDays; offset >= 1; offset -= 1) {
      results.push(await this.closeBusinessDate(addDaysToLocalDate(today, -offset), { source }));
    }
    return results;
  },

  async listRecentClosings(days = 7, { includeToday = true, closingType = null } = {}) {
    const settings = await settingsRepo.getSettings();
    const timezone = getStoreTimezone(settings);
    const storeId = getStoreId(settings);
    const today = getStoreLocalParts(new Date(), timezone).localDate;
    const startDate = addDaysToLocalDate(today, -Math.max(1, Math.floor(Number(days) || 7)));
    const endDate = includeToday ? addDaysToLocalDate(today, 1) : today;
    const safeClosingType = closingType ? normalizeClosingType(closingType) : null;

    if (config.dataStore === 'postgres') {
      const prisma = await getPrisma();
      if (!prisma.dailyStoreClosing?.findMany) {
        const rows = await prisma.$queryRaw`
          SELECT
            id,
            store_id AS "storeId",
            business_date AS "businessDate",
            closing_type AS "closingType",
            closed_at AS "closedAt",
            timezone,
            sales_count AS "salesCount",
            return_count AS "returnCount",
            transaction_count AS "transactionCount",
            gross_sales_amount AS "grossSalesAmount",
            return_amount AS "returnAmount",
            net_revenue AS "netRevenue",
            item_count AS "itemCount",
            source,
            payload,
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM daily_store_closings
          WHERE store_id = ${storeId}
            AND business_date >= ${new Date(`${startDate}T00:00:00.000Z`)}
            AND business_date < ${new Date(`${endDate}T00:00:00.000Z`)}
            AND (${safeClosingType}::text IS NULL OR closing_type = ${safeClosingType})
          ORDER BY business_date ASC, closed_at ASC
        `;
        return rows.map(mapClosingRow);
      }
      const rows = await prisma.dailyStoreClosing.findMany({
        where: {
          storeId,
          businessDate: {
            gte: new Date(`${startDate}T00:00:00.000Z`),
            lt: new Date(`${endDate}T00:00:00.000Z`),
          },
          ...(safeClosingType ? { closingType: safeClosingType } : {}),
        },
        orderBy: [{ businessDate: 'asc' }, { closedAt: 'asc' }],
      });
      return rows.map(mapClosingRow);
    }

    const rows = await dailyStoreClosingRepo.getAll();
    return rows
      .filter((row) => row.storeId === storeId && row.businessDate >= startDate && row.businessDate < endDate)
      .filter((row) => !safeClosingType || normalizeClosingType(row.closingType) === safeClosingType)
      .sort((a, b) => String(a.businessDate).localeCompare(String(b.businessDate)) || String(a.closedAt || '').localeCompare(String(b.closedAt || '')))
      .map(mapClosingRow);
  },

  getNextLocalMidnightDelay(settings = {}, now = new Date()) {
    const timezone = getStoreTimezone(settings);
    const local = getStoreLocalParts(now, timezone);
    const nextLocalDate = addDaysToLocalDate(local.localDate, 1);
    const nextMidnightUtc = zonedLocalDateTimeToUtc(nextLocalDate, 0, timezone);
    return Math.max(1000, nextMidnightUtc.getTime() - now.getTime());
  },

  getMaxTimerDelay() {
    return DAY_MS;
  },
};

export const __dailyClosingInternals = {
  buildDailyClosingMetrics,
  buildDailyClosingPaymentBreakdown,
  addDaysToLocalDate,
  normalizeClosingType,
  OFFICIAL_DAILY_CLOSE,
  MANUAL_SNAPSHOT,
};
