import { v4 as uuidv4 } from 'uuid';
import { productRepo } from '../repositories/productRepository.js';
import { purchaseOrderItemRepo } from '../repositories/purchaseOrderItemRepository.js';
import { purchaseOrderRepo } from '../repositories/purchaseOrderRepository.js';
import { supplierRepo } from '../repositories/supplierRepository.js';
import { supplierProductRepo } from '../repositories/supplierProductRepository.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { sanitizeSupplierInput, validateSupplierPayload } from '../utils/validators.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const toDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const dayKey = (value) => {
  const parsed = toDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
};

const average = (values) => {
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
};

const round = (value, precision = 1) => {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
};

const toSupplierCode = (supplier) => {
  const direct = String(supplier?.supplierCode || '').trim();
  if (direct) return direct;

  const id = String(supplier?.id || '').trim();
  const normalized = id.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (normalized) return `SUP-${normalized.slice(-6)}`;

  return `SUP-${Date.now().toString().slice(-6)}`;
};

const getWindowBounds = (days, offsetDays = 0) => {
  const now = new Date();
  const end = new Date(now.getTime() - (offsetDays * DAY_MS));
  const start = new Date(end.getTime() - (days * DAY_MS));
  return { start, end };
};

const inRange = (date, start, end) => {
  if (!date) return false;
  const ts = date.getTime();
  return ts >= start.getTime() && ts < end.getTime();
};

const calculatePerformance = (supplier, orders, itemsByOrderId) => {
  const now = new Date();
  const orderCreatedDates = orders.map((order) => toDate(order.createdAt)).filter(Boolean);
  const lastOrderDate = orderCreatedDates.length
    ? new Date(Math.max(...orderCreatedDates.map((date) => date.getTime()))).toISOString()
    : null;

  const deliveryEvents = [];

  for (const order of orders) {
    const createdAt = toDate(order.createdAt);
    const estimatedDate = toDate(order.estimatedDeliveryDate);
    const statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    const deliveredHistory = [...statusHistory]
      .reverse()
      .find((entry) => entry?.status === 'delivered' || entry?.status === 'partially_delivered');
    const deliveredAt = toDate(deliveredHistory?.at);

    if (!deliveredAt || !createdAt) continue;

    const onTime = estimatedDate ? deliveredAt.getTime() <= estimatedDate.getTime() : true;
    const delayDays = estimatedDate
      ? Math.max(0, (deliveredAt.getTime() - estimatedDate.getTime()) / DAY_MS)
      : 0;
    const leadTimeDays = Math.max(0, (deliveredAt.getTime() - createdAt.getTime()) / DAY_MS);

    deliveryEvents.push({
      deliveredAt,
      onTime,
      delayDays,
      leadTimeDays,
    });
  }

  const deliveredCount = deliveryEvents.length;
  const deliveryRateOverall = deliveredCount
      ? round((deliveryEvents.filter((entry) => entry.onTime).length / deliveredCount) * 100, 1)
    : 0;

  const avgDelayDaysOverall = deliveredCount
    ? round(average(deliveryEvents.map((entry) => entry.delayDays)), 2)
    : 0;
  const avgDeliveryDays = deliveredCount
    ? round(average(deliveryEvents.map((entry) => entry.leadTimeDays)), 1)
    : null;

  const aggregateWindow = (days, offsetDays = 0) => {
    const { start, end } = getWindowBounds(days, offsetDays);
    const scoped = deliveryEvents.filter((entry) => inRange(entry.deliveredAt, start, end));
    if (!scoped.length) {
      return { deliveryRate: 0, avgDelayDays: 0, count: 0 };
    }

    return {
      deliveryRate: round((scoped.filter((entry) => entry.onTime).length / scoped.length) * 100, 1),
      avgDelayDays: round(average(scoped.map((entry) => entry.delayDays)), 2),
      count: scoped.length,
    };
  };

  const aggregateOrderWindow = (days, offsetDays = 0) => {
    const { start, end } = getWindowBounds(days, offsetDays);
    return orders.filter((order) => inRange(toDate(order.createdAt), start, end)).length;
  };

  const last30 = aggregateWindow(30, 0);
  const prev30 = aggregateWindow(30, 30);
  const last7 = aggregateWindow(7, 0);
  const prev7 = aggregateWindow(7, 7);

  const sparklineBuckets = new Map();
  for (const entry of deliveryEvents) {
    const key = dayKey(entry.deliveredAt);
    if (!key) continue;
    if (!sparklineBuckets.has(key)) {
      sparklineBuckets.set(key, { total: 0, onTime: 0 });
    }
    const bucket = sparklineBuckets.get(key);
    bucket.total += 1;
    if (entry.onTime) bucket.onTime += 1;
  }

  const sparkline = [];
  let carryRate = last30.deliveryRate || deliveryRateOverall || 0;
  for (let day = 29; day >= 0; day -= 1) {
    const date = new Date(now.getTime() - (day * DAY_MS));
    const key = dayKey(date);
    const bucket = sparklineBuckets.get(key);
    if (bucket?.total) {
      carryRate = round((bucket.onTime / bucket.total) * 100, 1);
    }
    sparkline.push(carryRate);
  }

  const periodDelta = (current, previous) => {
    if (!previous) return current ? 100 : 0;
    return round(((current - previous) / Math.abs(previous)) * 100, 1);
  };

  const deliveryTrend = periodDelta(last30.deliveryRate, prev30.deliveryRate);
  const delayTrend = periodDelta(last30.avgDelayDays, prev30.avgDelayDays);

  const orderItemRows = orders.flatMap((order) => itemsByOrderId.get(order.id) || []);
  const totalOrderQuantity = orderItemRows.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  return {
    productCount: supplier.productCount,
    orderMetrics: {
      totalOrders: orders.length,
      orderCountLast30Days: aggregateOrderWindow(30, 0),
      lastOrderDate,
      deliveredOrderCount: deliveredCount,
      totalOrderQuantity,
      averageDeliveryDays: avgDeliveryDays,
      averageDelayDays: avgDelayDaysOverall,
    },
    performanceTrend: {
      deliverySparklineLast30Days: sparkline,
      deliveryRateLast30Days: last30.deliveryRate,
      deliveryRatePrev30Days: prev30.deliveryRate,
      deliveryRateLast7Days: last7.deliveryRate,
      deliveryRatePrev7Days: prev7.deliveryRate,
      deliveryTrendPercent: deliveryTrend,
      delayAvgLast30Days: last30.avgDelayDays,
      delayAvgPrev30Days: prev30.avgDelayDays,
      delayAvgLast7Days: last7.avgDelayDays,
      delayAvgPrev7Days: prev7.avgDelayDays,
      delayTrendPercent: delayTrend,
    },
  };
};

const mapSupplier = async (supplier, context = null) => {
  const effectiveContext = context || await (async () => {
    const [products, orders, orderItems, supplierProducts] = await Promise.all([
      productRepo.getAll(),
      purchaseOrderRepo.getAll(),
      purchaseOrderItemRepo.getAll(),
      supplierProductRepo.getAll(),
    ]);

    const itemsByOrderId = new Map();
    for (const row of orderItems) {
      if (!itemsByOrderId.has(row.orderId)) itemsByOrderId.set(row.orderId, []);
      itemsByOrderId.get(row.orderId).push(row);
    }

    return { products, orders, itemsByOrderId, supplierProducts };
  })();

  const activeMatches = effectiveContext.supplierProducts.filter((item) => item.supplierId === supplier.id && item.isActive !== false);
  const linkedProductCount = new Set(activeMatches.map((item) => item.productId)).size;
  const primaryProductCount = activeMatches.filter((item) => item.isDefault === true).length;
  const minOrderCaseQty = activeMatches.length
    ? Math.min(...activeMatches.map((item) => Number(item.minimumOrderQty || 1)).filter((value) => Number.isFinite(value) && value > 0))
    : 1;
  const explicitLeadTimes = activeMatches
    .map((item) => Number(item.leadTimeDays || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const supplierOrders = effectiveContext.orders.filter((order) => order.supplierId === supplier.id);
  const performance = calculatePerformance({ ...supplier, productCount: linkedProductCount }, supplierOrders, effectiveContext.itemsByOrderId);
  const avgDelayDays = Number(performance.orderMetrics?.averageDelayDays || 0);
  const gecikmeDurumu = avgDelayDays <= 0.5 ? 'Düşük' : avgDelayDays <= 1.5 ? 'Orta' : 'Yüksek';
  const region = String(
    supplier.region
    || supplier.city
    || (Array.isArray(supplier.warehouses) ? supplier.warehouses[0] : '')
    || (String(supplier.address || '').split(',')[0] || '')
  ).trim() || 'Belirsiz';
  const averageLeadTime = explicitLeadTimes.length > 0
    ? round(average(explicitLeadTimes), 1)
    : performance.orderMetrics?.averageDeliveryDays ?? null;
  const status = supplier.isActive !== false ? 'active' : 'inactive';
  const coveredCategories = Array.isArray(supplier.categories) && supplier.categories.length > 0
    ? supplier.categories
    : String(supplier.kategoriler || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

  return {
    ...supplier,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierListView: {
      supplierId: supplier.id,
      supplierName: supplier.name,
      type: supplier.type || supplier.tedarikciTuru || '',
      coveredCategories,
      activeProductCount: linkedProductCount,
      primaryProductCount,
      averageLeadTime,
      status,
    },
    code: supplier.code || supplier.supplierCode || toSupplierCode(supplier),
    type: supplier.type || supplier.tedarikciTuru || '',
    tedarikciTuru: supplier.tedarikciTuru || supplier.type || '',
    region,
    status,
    coveredCategories,
    activeProductCount: linkedProductCount,
    primaryProductCount,
    averageLeadTime,
    supplierCode: toSupplierCode(supplier),
    productCount: linkedProductCount,
    minOrderCaseQty: Math.max(1, Math.floor(minOrderCaseQty || 1)),
    teslimatPerformansi: `${Number(performance.performanceTrend?.deliveryRateLast30Days || 0).toFixed(1)}%`,
    delayStatus: gecikmeDurumu,
    gecikmeDurumu,
    sonSiparis: performance.orderMetrics?.lastOrderDate || null,
    ortalamaTeslimSuresi: performance.orderMetrics?.averageDeliveryDays ?? null,
    ...performance,
  };
};

const fromDateValue = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

const listSuppliersFromPostgres = async () => {
  const prisma = await getPrisma();
  const [suppliers, supplierStats] = await withPostgresQueryLogging('GET /api/suppliers', () => Promise.all([
    prisma.supplier.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        supplierCode: true,
        code: true,
        name: true,
        type: true,
        tedarikciTuru: true,
        website: true,
        minimumOrderQty: true,
        minimumOrderCaseQty: true,
        coveredCategories: true,
        delayStatus: true,
        linkedProductCount: true,
        isActive: true,
        categories: true,
        productCount: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.supplierProduct.groupBy({
      by: ['supplierId'],
      where: { isActive: { not: false } },
      _count: { productId: true, id: true },
      _min: { minimumOrderQty: true },
      _avg: { leadTimeDays: true },
    }),
  ]));
  const statsBySupplier = new Map((supplierStats || []).map((row) => [String(row.supplierId || ''), row]));

  return suppliers.map((supplier) => {
    const stats = statsBySupplier.get(supplier.id);
    const linkedProductCount = Number(stats?._count?.productId || supplier.linkedProductCount || supplier.productCount || 0);
    const coveredCategories = Array.isArray(supplier.coveredCategories)
      ? supplier.coveredCategories
      : Array.isArray(supplier.categories)
        ? supplier.categories
        : [];
    const averageLeadTime = stats?._avg?.leadTimeDays ? round(stats._avg.leadTimeDays, 1) : null;
    const minOrderCaseQty = Number(stats?._min?.minimumOrderQty || supplier.minimumOrderCaseQty || supplier.minimumOrderQty || 1);
    const status = supplier.isActive !== false ? 'active' : 'inactive';

    return {
      ...(supplier.payload && typeof supplier.payload === 'object' ? supplier.payload : {}),
      id: supplier.id,
      supplierId: supplier.id,
      supplierName: supplier.name,
      name: supplier.name,
      code: supplier.code || supplier.supplierCode || toSupplierCode(supplier),
      supplierCode: supplier.supplierCode || supplier.code || toSupplierCode(supplier),
      type: supplier.type || supplier.tedarikciTuru || '',
      tedarikciTuru: supplier.tedarikciTuru || supplier.type || '',
      website: supplier.website,
      isActive: supplier.isActive !== false,
      status,
      coveredCategories,
      activeProductCount: linkedProductCount,
      primaryProductCount: 0,
      linkedProductCount,
      productCount: linkedProductCount,
      minOrderCaseQty: Math.max(1, Math.floor(minOrderCaseQty || 1)),
      averageLeadTime,
      delayStatus: supplier.delayStatus || 'Düşük',
      gecikmeDurumu: supplier.delayStatus || 'Düşük',
      supplierListView: {
        supplierId: supplier.id,
        supplierName: supplier.name,
        type: supplier.type || supplier.tedarikciTuru || '',
        coveredCategories,
        activeProductCount: linkedProductCount,
        primaryProductCount: 0,
        averageLeadTime,
        status,
      },
      createdAt: fromDateValue(supplier.createdAt),
      updatedAt: fromDateValue(supplier.updatedAt),
    };
  });
};

export const supplierService = {
  async list() {
    if (config.dataStore === 'postgres') {
      return listSuppliersFromPostgres();
    }

    const [suppliers, products, orders, orderItems, supplierProducts] = await Promise.all([
      supplierRepo.getAll(),
      productRepo.getAll(),
      purchaseOrderRepo.getAll(),
      purchaseOrderItemRepo.getAll(),
      supplierProductRepo.getAll(),
    ]);

    const itemsByOrderId = new Map();
    for (const row of orderItems) {
      if (!itemsByOrderId.has(row.orderId)) itemsByOrderId.set(row.orderId, []);
      itemsByOrderId.get(row.orderId).push(row);
    }

    const context = { products, orders, itemsByOrderId, supplierProducts };
    const mapped = await Promise.all(suppliers.map((item) => mapSupplier(item, context)));
    return mapped.sort((left, right) => Number(right.isActive) - Number(left.isActive) || left.name.localeCompare(right.name, 'tr'));
  },

  async getById(id) {
    const supplier = await supplierRepo.findById(id);
    if (!supplier) {
      throw createNotFoundError('Tedarikçi bulunamadı');
    }

    return mapSupplier(supplier);
  },

  async create(payload) {
    validateSupplierPayload(payload);
    const input = sanitizeSupplierInput(payload);
    const existing = await supplierRepo.findByName(input.name);

    if (existing) {
      throw new AppError(409, 'Tedarikçi adı zaten mevcut');
    }

    const now = new Date().toISOString();
    const newId = uuidv4();
    const supplier = {
      id: newId,
      ...input,
      supplierCode: toSupplierCode({ id: newId }),
      linkedProductCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await supplierRepo.create(supplier);
    return mapSupplier(supplier);
  },

  async update(id, payload) {
    validateSupplierPayload(payload, { partial: true });
    const existing = await supplierRepo.findById(id);
    if (!existing) {
      throw createNotFoundError('Tedarikçi bulunamadı');
    }

    const input = sanitizeSupplierInput({ ...existing, ...payload });
    const sameNameSupplier = await supplierRepo.findByName(input.name);
    if (sameNameSupplier && sameNameSupplier.id !== id) {
      throw new AppError(409, 'Tedarikçi adı zaten mevcut');
    }

    const updated = {
      ...existing,
      ...input,
      supplierCode: existing.supplierCode || toSupplierCode(existing),
      updatedAt: new Date().toISOString(),
    };

    await supplierRepo.updateById(id, updated);
    return mapSupplier(updated);
  },

  async remove(id) {
    const supplier = await supplierRepo.findById(id);
    if (!supplier) {
      throw createNotFoundError('Tedarikçi bulunamadı');
    }

    const supplierProducts = await supplierProductRepo.getAll();
    const linkedProduct = supplierProducts.find((item) => item.supplierId === id && item.isActive !== false);
    if (linkedProduct) {
      throw new AppError(400, 'Bu tedarikçiye bağlı ürünler var');
    }

    await supplierRepo.deleteById(id);
    return supplier;
  },
};
