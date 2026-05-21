import { config } from '../config/config.js';
import { createFileRepository } from './fileRepository.js';
import { getPrisma } from '../providers/postgresProvider.js';

const repository = createFileRepository({ fileName: 'sales.json', defaultData: [] });

const toNumber = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
};

const fromDate = (value) => value instanceof Date ? value.toISOString() : value;

const clonePayload = (value) => {
  if (!value || typeof value !== 'object') return {};
  return JSON.parse(JSON.stringify(value));
};

const mapSaleItemFromDb = (row = {}) => ({
  ...clonePayload(row.payload),
  id: row.id,
  productId: row.productId || undefined,
  barcode: row.barcode || '',
  name: row.name || '',
  sku: row.sku || '',
  quantity: row.quantity || 0,
  vatRate: toNumber(row.vatRate) ?? undefined,
  unitPrice: toNumber(row.unitPrice) ?? 0,
  totalPrice: toNumber(row.totalPrice) ?? 0,
});

const mapSaleFromDb = (row = {}) => {
  if (!row) return null;
  const payload = clonePayload(row.payload);
  return {
    ...payload,
    id: row.id,
    referenceNo: row.referenceNo,
    type: row.type,
    deskCode: row.deskCode,
    cashierId: row.cashierId,
    cashierName: row.cashierName,
    items: Array.isArray(row.saleItems) ? row.saleItems.map(mapSaleItemFromDb) : (payload.items || []),
    subtotal: toNumber(row.subtotal) ?? payload.subtotal,
    discount: toNumber(row.discount) ?? payload.discount,
    totalAmount: toNumber(row.totalAmount) ?? payload.totalAmount,
    paymentMethod: row.paymentMethod,
    payments: row.payments || payload.payments || [],
    originalSaleRef: row.originalSaleRef || payload.originalSaleRef || null,
    status: row.status,
    customer: row.customer || payload.customer || null,
    createdAt: fromDate(row.createdAt) || payload.createdAt,
    updatedAt: fromDate(row.updatedAt) || payload.updatedAt,
  };
};

const parseDateStart = (date) => {
  if (!date) return null;
  const value = String(date);
  const parsed = value.length <= 10 ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseDateEnd = (date) => {
  if (!date) return null;
  const value = String(date);
  const parsed = value.length <= 10 ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildSaleWhere = (filters = {}) => {
  const where = {};

  if (filters.type) where.type = String(filters.type);
  if (filters.originalSaleRef) where.originalSaleRef = String(filters.originalSaleRef);
  if (filters.paymentMethod) where.paymentMethod = String(filters.paymentMethod);

  const createdAt = {};
  if (filters.date) {
    createdAt.gte = parseDateStart(filters.date);
    createdAt.lte = parseDateEnd(filters.date);
  } else {
    if (filters.startDate) createdAt.gte = parseDateStart(filters.startDate);
    if (filters.endDate) createdAt.lte = parseDateEnd(filters.endDate);
  }

  Object.keys(createdAt).forEach((key) => {
    if (!createdAt[key]) delete createdAt[key];
  });
  if (Object.keys(createdAt).length) where.createdAt = createdAt;

  return where;
};

const isPostgres = () => config.dataStore === 'postgres';

export const salesRepo = {
  getAll: repository.getAll,
  findById: repository.findById,
  create: repository.create,
  updateById: repository.updateById,
  async findByReference(referenceNo) {
    if (!isPostgres()) {
      const all = await repository.getAll();
      return all.find((sale) => sale.referenceNo === referenceNo) || null;
    }

    const prisma = await getPrisma();
    return mapSaleFromDb(await prisma.sale.findFirst({
      where: { referenceNo: String(referenceNo) },
      include: { saleItems: true },
    }));
  },
  async findMany(filters = {}, options = {}) {
    if (!isPostgres()) {
      return null;
    }

    const prisma = await getPrisma();
    const where = buildSaleWhere(filters);
    const include = options.includeItems === false ? undefined : { saleItems: true };
    const select = options.includeItems === false ? {
      id: true,
      referenceNo: true,
      type: true,
      deskCode: true,
      cashierId: true,
      cashierName: true,
      subtotal: true,
      discount: true,
      totalAmount: true,
      paymentMethod: true,
      payments: true,
      originalSaleRef: true,
      status: true,
      customer: true,
      createdAt: true,
      updatedAt: true,
    } : undefined;

    const query = {
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(include ? { include } : { select }),
    };

    if (options.skip !== undefined) query.skip = options.skip;
    if (options.take !== undefined) query.take = options.take;

    const rows = await prisma.sale.findMany(query);
    return rows.map(mapSaleFromDb);
  },
  async count(filters = {}) {
    if (!isPostgres()) {
      return null;
    }

    const prisma = await getPrisma();
    return prisma.sale.count({ where: buildSaleWhere(filters) });
  },
};
