import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { posService } from '../../src/services/posService.js';
import { productRepo } from '../../src/repositories/productRepository.js';
import { stockRepo } from '../../src/repositories/stockRepository.js';
import { categoryRepo } from '../../src/repositories/categoryRepository.js';
import { customerRepo } from '../../src/repositories/customerRepository.js';
import { userRepo } from '../../src/repositories/userRepository.js';
import { salesRepo } from '../../src/repositories/salesRepository.js';
import { movementRepo } from '../../src/repositories/movementRepository.js';
import { settingsRepo } from '../../src/repositories/settingsRepository.js';
import { disconnectPrisma } from '../../src/providers/postgresProvider.js';
import {
  getStoreLocalParts,
  getStoreTimezone,
  resolveStoreScheduleForDate,
  zonedLocalDateTimeToUtc,
} from '../../src/utils/storeSchedule.js';
import { MAIN_STORE_ID, MAIN_TENANT_ID, runWithTenantContext } from '../../src/tenant/tenantContext.js';

const DAYS = 45;
const MAX_STOCK_SELL_THROUGH = 0.62;
const AVG_UNITS_PER_SALE = 5.8;
const DEFAULT_MAX_SALES = 260;
const LOG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../runtime-logs/sales-seed');

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const roundMoney = (value) => Math.round(toNumber(value) * 100) / 100;

const toPositiveInt = (value, fallback) => {
  const numeric = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const mulberry32 = (seed) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
};

const hashSeed = (value) => {
  const text = String(value || 'shelfio-sales-45-days');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const pick = (rng, rows) => rows[Math.floor(rng() * rows.length)];

const pickWeighted = (rng, rows, weightFn) => {
  const weightedRows = rows
    .map((row) => ({ row, weight: Math.max(0, toNumber(weightFn(row), 0)) }))
    .filter((item) => item.weight > 0);
  const total = weightedRows.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return rows.length ? pick(rng, rows) : null;

  let cursor = rng() * total;
  for (const item of weightedRows) {
    cursor -= item.weight;
    if (cursor <= 0) return item.row;
  }
  return weightedRows[weightedRows.length - 1]?.row || null;
};

const addDaysToLocalDate = (localDate, delta) => {
  const [year, month, day] = String(localDate).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10);
};

const isWeekendLocalDate = (localDate) => {
  const [year, month, day] = String(localDate).split('-').map(Number);
  const weekDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekDay === 0 || weekDay === 6;
};

const chooseBasketSize = (rng) => {
  const roll = rng();
  if (roll < 0.18) return 1 + Math.floor(rng() * 2);
  if (roll < 0.86) return 3 + Math.floor(rng() * 6);
  return 9 + Math.floor(rng() * 7);
};

const chooseQuantity = (rng, product) => {
  const shelf = toNumber(product.remainingShelf, 0);
  if (shelf <= 1) return 1;
  const price = toNumber(product.salePrice, 0);
  const cheapMultiplier = price > 0 && price < 60 ? 1 : 0;
  const roll = rng();
  let qty = 1;
  if (roll > 0.94 + (cheapMultiplier * 0.02)) qty = 3;
  else if (roll > 0.74) qty = 2;
  if (cheapMultiplier && rng() > 0.96) qty += 1;
  return Math.max(1, Math.min(qty, Math.floor(shelf)));
};

const buildPaymentMethod = (rng) => pickWeighted(rng, [
  { method: 'card', weight: 58 },
  { method: 'cash', weight: 30 },
  { method: 'qr', weight: 8 },
  { method: 'eft', weight: 4 },
], (row) => row.weight).method;

const freezeDateFor = async (date, callback) => {
  const RealDate = global.Date;
  const fixedTime = date.getTime();
  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedTime]));
    }

    static now() {
      return fixedTime;
    }
  }
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;
  global.Date = FrozenDate;
  try {
    return await callback();
  } finally {
    global.Date = RealDate;
  }
};

const resolveSaleInstant = (rng, settings, localDate) => {
  const timezone = getStoreTimezone(settings);
  const schedule = resolveStoreScheduleForDate(settings, localDate);
  if (schedule.isClosed || schedule.openMinutes === null || schedule.closeMinutes === null || schedule.openMinutes === schedule.closeMinutes) {
    return null;
  }

  const open = schedule.openMinutes;
  const close = schedule.openMinutes < schedule.closeMinutes ? schedule.closeMinutes : schedule.closeMinutes + (24 * 60);
  const windows = [
    { start: Math.max(open, 10 * 60), end: Math.min(close, 12 * 60), weight: 12 },
    { start: Math.max(open, 12 * 60), end: Math.min(close, 15 * 60), weight: 25 },
    { start: Math.max(open, 15 * 60), end: Math.min(close, 18 * 60), weight: 28 },
    { start: Math.max(open, 18 * 60), end: Math.min(close, 21 * 60 + 30), weight: 35 },
  ].filter((row) => row.end > row.start + 10);

  const chosen = pickWeighted(rng, windows.length ? windows : [{ start: open, end: close, weight: 1 }], (row) => row.weight);
  const minute = Math.floor(chosen.start + (rng() * (chosen.end - chosen.start)));
  const secondJitter = Math.floor(rng() * 60);
  const utc = zonedLocalDateTimeToUtc(localDate, minute % (24 * 60), timezone);
  if (!utc) return null;
  utc.setSeconds(secondJitter, Math.floor(rng() * 1000));
  return utc;
};

const buildDayPlan = (rng, settings, todayLocalDate) => {
  const rows = [];
  for (let daysAgo = DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
    const localDate = addDaysToLocalDate(todayLocalDate, -daysAgo);
    let base = 5 + Math.floor(rng() * 5);
    if (daysAgo <= 6) base = 16 + Math.floor(rng() * 9);
    else if (daysAgo <= 20) base = 9 + Math.floor(rng() * 7);

    const weekendMultiplier = isWeekendLocalDate(localDate) ? 1.25 + (rng() * 0.18) : 0.9 + (rng() * 0.22);
    const noise = 0.82 + (rng() * 0.36);
    const schedule = resolveStoreScheduleForDate(settings, localDate);
    rows.push({
      localDate,
      daysAgo,
      desired: schedule.isClosed ? 0 : Math.max(1, Math.round(base * weekendMultiplier * noise)),
      isClosed: schedule.isClosed,
    });
  }
  return rows;
};

const scaleDayPlan = (dayPlan, targetSales) => {
  const desiredTotal = dayPlan.reduce((sum, row) => sum + row.desired, 0);
  if (desiredTotal <= 0 || targetSales <= 0) return dayPlan.map((row) => ({ ...row, count: 0 }));

  const scale = targetSales / desiredTotal;
  const scaled = dayPlan.map((row) => {
    const raw = row.desired * scale;
    return {
      ...row,
      raw,
      count: row.desired > 0 && targetSales >= DAYS ? Math.max(1, Math.floor(raw)) : Math.floor(raw),
      remainder: raw % 1,
    };
  });

  let current = scaled.reduce((sum, row) => sum + row.count, 0);
  const byRemainder = [...scaled].sort((a, b) => b.remainder - a.remainder);
  let index = 0;
  while (current < targetSales && byRemainder.length) {
    byRemainder[index % byRemainder.length].count += 1;
    current += 1;
    index += 1;
  }
  return scaled.sort((a, b) => a.localDate.localeCompare(b.localDate));
};

const resolveCashierContext = async () => {
  const users = await userRepo.getAll();
  const user = users.find((row) => row?.isActive !== false && ['admin', 'owner', 'manager'].includes(String(row?.role || '').toLowerCase()))
    || users.find((row) => row?.isActive !== false)
    || null;

  return {
    id: user?.id || null,
    name: user?.name || user?.fullName || user?.username || 'Kasiyer',
    role: 'admin',
    assignedDeskCode: 'B1',
  };
};

const resolveCustomerPayload = (rng, customers) => {
  if (!customers.length || rng() > 0.36) return null;
  const customer = pickWeighted(rng, customers, (row) => {
    const spent = Math.min(8, Math.log10(toNumber(row.totalSpent, 0) + 10));
    const orders = Math.min(6, Math.log10(toNumber(row.totalOrders, 0) + 2));
    return 1 + spent + orders;
  });
  if (!customer) return null;
  return {
    id: customer.id,
    customerNo: customer.customerNo || null,
    name: customer.name || null,
    phone: customer.phone || null,
    email: customer.email || null,
  };
};

const buildProductPool = async (rng) => {
  const [products, stocks, categories] = await Promise.all([
    productRepo.getAll(),
    stockRepo.getAll(),
    categoryRepo.getAll(),
  ]);

  const stockByProductId = new Map(stocks.map((stock) => [stock.productId, stock]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  return products
    .map((product) => {
      const stock = stockByProductId.get(product.id) || {};
      const shelfQuantity = Math.floor(toNumber(stock.shelfQuantity, 0));
      const salePrice = toNumber(product.salePrice, 0);
      const maxSellable = Math.max(0, Math.floor(shelfQuantity * MAX_STOCK_SELL_THROUGH) - Math.min(3, Math.floor(shelfQuantity * 0.08)));
      const category = categoryById.get(product.categoryId);
      return {
        ...product,
        categoryName: category?.name || product.categoryName || product.category || 'Kategorisiz',
        shelfQuantity,
        remainingShelf: shelfQuantity,
        maxSellable,
        soldByScript: 0,
        salePrice,
        popularity: 0.7 + (rng() * 1.1) + (rng() > 0.84 ? 1.4 : 0),
      };
    })
    .filter((product) =>
      product.isActive === true
      && product.isListed === true
      && product.id
      && product.id !== '__bag__'
      && product.salePrice > 0
      && product.shelfQuantity > 0
      && product.maxSellable > 0
    );
};

const buildBasket = (rng, pool) => {
  const targetSize = chooseBasketSize(rng);
  const items = [];
  const used = new Set();
  const categoryCounts = new Map();

  for (let index = 0; index < targetSize; index += 1) {
    const candidates = pool.filter((product) =>
      !used.has(product.id)
      && product.remainingShelf > 0
      && product.soldByScript < product.maxSellable
    );
    if (!candidates.length) break;

    const product = pickWeighted(rng, candidates, (row) => {
      const soldRatio = row.maxSellable > 0 ? row.soldByScript / row.maxSellable : 1;
      const categoryPenalty = 1 / (1 + toNumber(categoryCounts.get(row.categoryName), 0) * 0.55);
      const remainingBias = Math.sqrt(Math.max(1, row.remainingShelf));
      return row.popularity * categoryPenalty * remainingBias * Math.max(0.08, 1 - soldRatio);
    });
    if (!product) break;

    const hardRemaining = Math.max(0, product.maxSellable - product.soldByScript);
    const qty = Math.min(chooseQuantity(rng, product), product.remainingShelf, hardRemaining);
    if (qty <= 0) {
      used.add(product.id);
      continue;
    }

    items.push({ productId: product.id, quantity: qty });
    product.remainingShelf -= qty;
    product.soldByScript += qty;
    used.add(product.id);
    categoryCounts.set(product.categoryName, toNumber(categoryCounts.get(product.categoryName), 0) + 1);
  }

  return items;
};

const restoreBasketReservation = (poolById, items) => {
  for (const item of items) {
    const product = poolById.get(item.productId);
    if (!product) continue;
    product.remainingShelf += item.quantity;
    product.soldByScript = Math.max(0, product.soldByScript - item.quantity);
  }
};

const summarizeCategories = (sales) => {
  const categories = new Map();
  for (const sale of sales) {
    for (const item of sale.items || []) {
      const current = categories.get(item.categoryName) || { categoryName: item.categoryName, qty: 0, lines: 0 };
      current.qty += toNumber(item.quantity, 0);
      current.lines += 1;
      categories.set(item.categoryName, current);
    }
  }
  return [...categories.values()].sort((a, b) => b.qty - a.qty).slice(0, 12);
};

const main = async () => {
  const seed = hashSeed(process.env.SALES_SEED || `sales-${new Date().toISOString().slice(0, 10)}`);
  const rng = mulberry32(seed);
  const settings = await settingsRepo.getSettings();
  const todayLocalDate = getStoreLocalParts(new Date(), getStoreTimezone(settings)).localDate;
  const cashierContext = await resolveCashierContext();
  const [customersRaw, beforeSales] = await Promise.all([
    customerRepo.getAll(),
    salesRepo.findMany({ startDate: addDaysToLocalDate(todayLocalDate, -(DAYS - 1)), endDate: todayLocalDate }, { includeItems: true }),
  ]);
  const customers = customersRaw.filter((customer) => customer?.isActive !== false);

  await fs.mkdir(LOG_DIR, { recursive: true });

  const pool = await buildProductPool(rng);
  const poolById = new Map(pool.map((product) => [product.id, product]));
  const stockBudgetUnits = pool.reduce((sum, product) => sum + product.maxSellable, 0);
  const dayPlanRaw = buildDayPlan(rng, settings, todayLocalDate);
  const desiredSales = dayPlanRaw.reduce((sum, row) => sum + row.desired, 0);
  const maxSales = toPositiveInt(process.env.SALES_SEED_MAX_SALES, DEFAULT_MAX_SALES);
  const targetSales = Math.max(0, Math.min(desiredSales, Math.floor(stockBudgetUnits / AVG_UNITS_PER_SALE), maxSales));
  const dayPlan = scaleDayPlan(dayPlanRaw, targetSales);

  const created = [];
  const skipped = [];
  const partialLogPath = path.join(LOG_DIR, `realistic-sales-45-days-${new Date().toISOString().replace(/[:.]/g, '-')}.partial.json`);

  if (pool.length < 8 || targetSales <= 0) {
    throw new Error(`Yeterli aktif/listelenen/stoklu urun yok. productPool=${pool.length}, stockBudgetUnits=${stockBudgetUnits}`);
  }

  console.log(`[sales-seed] productPool=${pool.length}, stockBudgetUnits=${stockBudgetUnits}, targetSales=${targetSales}, seed=${seed}, partialLog=${partialLogPath}`);

  for (const day of dayPlan) {
    for (let saleIndex = 0; saleIndex < day.count; saleIndex += 1) {
      const saleDate = resolveSaleInstant(rng, settings, day.localDate);
      if (!saleDate) {
        skipped.push({ localDate: day.localDate, reason: 'store_closed_or_no_open_window' });
        continue;
      }

      const items = buildBasket(rng, pool);
      if (!items.length) {
        skipped.push({ localDate: day.localDate, reason: 'insufficient_remaining_sellable_stock' });
        continue;
      }

      const paymentMethod = buildPaymentMethod(rng);
      const payload = {
        deskCode: cashierContext.assignedDeskCode,
        items,
        paymentMethod,
        customer: resolveCustomerPayload(rng, customers),
      };

      try {
        const sale = await freezeDateFor(saleDate, () => posService.completeSale(payload, cashierContext));
        const enrichedItems = (sale.items || []).map((item) => {
          const product = poolById.get(item.productId);
          return {
            productId: item.productId,
            sku: item.sku,
            name: item.name,
            categoryName: product?.categoryName || 'Kategorisiz',
            quantity: item.quantity,
            totalPrice: item.totalPrice,
          };
        });
        created.push({
          id: sale.id,
          referenceNo: sale.referenceNo,
          createdAt: sale.createdAt,
          totalAmount: sale.totalAmount,
          paymentMethod: sale.paymentMethod,
          itemCount: enrichedItems.length,
          unitCount: enrichedItems.reduce((sum, item) => sum + toNumber(item.quantity, 0), 0),
          items: enrichedItems,
        });
        await fs.writeFile(partialLogPath, JSON.stringify({
          generatedAt: new Date().toISOString(),
          seed,
          days: DAYS,
          targetSales,
          createdSaleCount: created.length,
          skippedCount: skipped.length,
          createdSales: created.map((row) => ({
            id: row.id,
            referenceNo: row.referenceNo,
            createdAt: row.createdAt,
            totalAmount: row.totalAmount,
            paymentMethod: row.paymentMethod,
            itemCount: row.itemCount,
            unitCount: row.unitCount,
          })),
          skipped,
        }, null, 2), 'utf8');
        if (created.length % 25 === 0) {
          console.log(`[sales-seed] progress ${created.length}/${targetSales}`);
        }
      } catch (error) {
        restoreBasketReservation(poolById, items);
        skipped.push({
          localDate: day.localDate,
          reason: error?.message || String(error),
          itemCount: items.length,
        });
      }
    }
  }

  const startDate = addDaysToLocalDate(todayLocalDate, -(DAYS - 1));
  const [afterSales, stocksAfter, movementsAfter] = await Promise.all([
    salesRepo.findMany({ startDate, endDate: todayLocalDate }, { includeItems: true }),
    stockRepo.getAll(),
    movementRepo.getAll(),
  ]);

  const createdIds = new Set(created.map((sale) => sale.id));
  const createdFromRepo = (afterSales || []).filter((sale) => createdIds.has(sale.id));
  const movementReferenceNos = new Set(created.map((sale) => sale.referenceNo));
  const relatedMovements = (movementsAfter || []).filter((movement) =>
    movement?.reasonCode === 'pos_sale' && movementReferenceNos.has(movement.referenceNo)
  );
  const negativeStocks = (stocksAfter || []).filter((stock) =>
    toNumber(stock.shelfQuantity, 0) < 0 || toNumber(stock.warehouseQuantity, 0) < 0
  );

  const itemCount = created.reduce((sum, sale) => sum + sale.itemCount, 0);
  const unitCount = created.reduce((sum, sale) => sum + sale.unitCount, 0);
  const totalAmount = roundMoney(created.reduce((sum, sale) => sum + toNumber(sale.totalAmount, 0), 0));
  const paymentBreakdown = created.reduce((acc, sale) => {
    acc[sale.paymentMethod] = (acc[sale.paymentMethod] || 0) + 1;
    return acc;
  }, {});
  const categories = summarizeCategories(created);
  const skippedByReason = skipped.reduce((acc, row) => {
    acc[row.reason] = (acc[row.reason] || 0) + 1;
    return acc;
  }, {});

  const logPath = path.join(LOG_DIR, `realistic-sales-45-days-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const logPayload = {
    generatedAt: new Date().toISOString(),
    seed,
    days: DAYS,
    range: { startDate, endDate: todayLocalDate },
    beforeSales45Days: Array.isArray(beforeSales) ? beforeSales.length : null,
    afterSales45Days: Array.isArray(afterSales) ? afterSales.length : null,
    createdSaleCount: created.length,
    createdSaleItemCount: itemCount,
    createdUnitCount: unitCount,
    totalAmount,
    paymentBreakdown,
    categorySummary: categories,
    skippedCount: skipped.length,
    skippedByReason,
    validation: {
      createdRowsVisibleInSalesRepo: createdFromRepo.length,
      stockMovementRowsForCreatedSales: relatedMovements.length,
      negativeStockCount: negativeStocks.length,
    },
    createdSales: created.map((sale) => ({
      id: sale.id,
      referenceNo: sale.referenceNo,
      createdAt: sale.createdAt,
      totalAmount: sale.totalAmount,
      paymentMethod: sale.paymentMethod,
      itemCount: sale.itemCount,
      unitCount: sale.unitCount,
    })),
  };
  await fs.writeFile(logPath, JSON.stringify(logPayload, null, 2), 'utf8');
  await fs.rm(partialLogPath, { force: true });

  console.log('[sales-seed] completed');
  console.log(JSON.stringify({
    days: DAYS,
    range: logPayload.range,
    createdSaleCount: created.length,
    createdSaleItemCount: itemCount,
    createdUnitCount: unitCount,
    skippedCount: skipped.length,
    skippedByReason,
    totalAmount,
    paymentBreakdown,
    categorySummary: categories,
    validation: logPayload.validation,
    rollbackLog: logPath,
  }, null, 2));

  if (negativeStocks.length > 0) {
    throw new Error(`Negative stock detected after generation: ${negativeStocks.length}`);
  }

  return logPayload;
};

runWithTenantContext({ tenantId: MAIN_TENANT_ID, storeId: MAIN_STORE_ID }, async () => {
  try {
    await main();
  } catch (error) {
    console.error('[sales-seed] failed:', error?.message || error);
    process.exitCode = 1;
  } finally {
    await disconnectPrisma();
  }
});
