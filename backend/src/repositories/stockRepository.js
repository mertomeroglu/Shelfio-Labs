import { dataDefaults } from '../config/config.js';
import { productRepo } from './productRepository.js';
import { createFileRepository } from './fileRepository.js';
import { enrichBatchExpiryState, summarizeBatchAvailability } from '../utils/batchExpiry.js';

const repository = createFileRepository({ fileName: 'stocks.json', defaultData: dataDefaults.stocks, idKey: 'productId' });
const MIN_WAREHOUSE_RATIO = 0.3;
const DEFAULT_MAX_SHELF_RATIO = 0.7;

const normalizeQty = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

const normalizeStockDateOnly = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

const normalizeBatchNo = (value) => String(value || '').trim();

const resolveMaxShelfStock = (product, totalQuantity) => {
  const explicit = normalizeQty(product?.maxShelfStock);
  if (explicit > 0) {
    return explicit;
  }

  const maxStockBased = normalizeQty(product?.maxStock);
  if (maxStockBased > 0) {
    return Math.max(1, Math.floor(maxStockBased * DEFAULT_MAX_SHELF_RATIO));
  }

  if (totalQuantity <= 1) {
    return totalQuantity;
  }

  return Math.max(1, Math.floor(totalQuantity * DEFAULT_MAX_SHELF_RATIO));
};

const distributeStock = ({ totalQuantity, maxShelfStock }) => {
  const safeTotal = normalizeQty(totalQuantity);
  if (safeTotal <= 0) {
    return {
      warehouseQuantity: 0,
      shelfQuantity: 0,
      quantity: 0,
    };
  }

  let shelfQuantity = Math.min(normalizeQty(maxShelfStock), safeTotal);
  const minWarehouseQuantity = safeTotal <= 1 ? 0 : Math.ceil(safeTotal * MIN_WAREHOUSE_RATIO);
  const maxShelfAllowed = Math.max(safeTotal - minWarehouseQuantity, 0);
  shelfQuantity = Math.min(shelfQuantity, maxShelfAllowed);

  const warehouseQuantity = Math.max(safeTotal - shelfQuantity, 0);

  return {
    warehouseQuantity,
    shelfQuantity,
    quantity: warehouseQuantity + shelfQuantity,
  };
};

const normalizeBatches = (batches) => {
  if (!Array.isArray(batches)) return [];

  return batches.map((batch) => {
    const warehouseQuantity = normalizeQty(batch?.warehouseQuantity);
    const shelfQuantity = normalizeQty(batch?.shelfQuantity);
    const totalQuantity = warehouseQuantity + shelfQuantity;

    const normalized = {
      ...batch,
      batchNo: normalizeBatchNo(batch?.batchNo),
      skt: normalizeStockDateOnly(batch?.skt),
      warehouseQuantity,
      shelfQuantity,
      totalQuantity,
      status: totalQuantity > 0 ? 'Aktif' : 'Tukendi',
    };
    return enrichBatchExpiryState(normalized);
  });
};

const resolveTotalQuantity = (stock) => {
  const hasWarehouse = stock?.warehouseQuantity !== undefined;
  const hasShelf = stock?.shelfQuantity !== undefined;

  if (hasWarehouse || hasShelf) {
    const warehouseQuantity = hasWarehouse ? normalizeQty(stock.warehouseQuantity) : 0;
    const shelfQuantity = hasShelf ? normalizeQty(stock.shelfQuantity) : 0;
    const bySplit = warehouseQuantity + shelfQuantity;
    const declared = normalizeQty(stock?.quantity);
    return Math.max(bySplit, declared);
  }

  return normalizeQty(stock?.quantity);
};

const deriveBatchSummary = (stock) => {
  const batches = normalizeBatches(stock?.batches);
  const activeBatches = batches.filter((item) => normalizeQty(item.totalQuantity) > 0 && item.isExpired !== true);
  const nearestBatch = [...activeBatches]
    .filter((item) => item.skt)
    .sort((left, right) => left.skt.localeCompare(right.skt) || left.batchNo.localeCompare(right.batchNo, 'tr'))[0] || null;

  return {
    batches,
    activeBatches,
    nearestBatch,
    batchWarehouseQuantity: activeBatches.reduce((sum, item) => sum + normalizeQty(item.warehouseQuantity), 0),
    batchShelfQuantity: activeBatches.reduce((sum, item) => sum + normalizeQty(item.shelfQuantity), 0),
    expiredBatchCount: batches.filter((item) => item.isExpired === true && normalizeQty(item.totalQuantity) > 0).length,
  };
};

const normalizeStock = (stock, product) => {
  if (!stock) return null;

  const hasWarehouse = stock?.warehouseQuantity !== undefined;
  const hasShelf = stock?.shelfQuantity !== undefined;
  const hasSplit = hasWarehouse || hasShelf;
  const reserved = normalizeQty(stock?.reserved);
  const batchSummary = deriveBatchSummary(stock);

  let warehouseQuantity = hasWarehouse ? normalizeQty(stock.warehouseQuantity) : 0;
  let shelfQuantity = hasShelf ? normalizeQty(stock.shelfQuantity) : 0;

  if (!hasWarehouse && batchSummary.batchWarehouseQuantity > 0) {
    warehouseQuantity = batchSummary.batchWarehouseQuantity;
  }

  if (!hasShelf && batchSummary.batchShelfQuantity > 0) {
    shelfQuantity = batchSummary.batchShelfQuantity;
  }

  if (!hasSplit && batchSummary.batches.length === 0) {
    const totalQuantity = resolveTotalQuantity(stock);
    const maxShelfStock = resolveMaxShelfStock(product, totalQuantity);
    const distribution = distributeStock({ totalQuantity, maxShelfStock });
    warehouseQuantity = distribution.warehouseQuantity;
    shelfQuantity = distribution.shelfQuantity;
  }

  const quantity = warehouseQuantity + shelfQuantity;
  const batchAvailability = summarizeBatchAvailability(batchSummary.batches, { reserved });
  const sellableQuantity = batchSummary.batches.length > 0 ? batchAvailability.sellableQuantity : quantity;
  const nearestExpiry = batchSummary.nearestBatch?.skt || '';
  const fefoDefaultBatchNo = batchSummary.nearestBatch?.batchNo || '';
  const fefoDefaultExpiry = batchSummary.nearestBatch?.skt || '';

  return {
    ...stock,
    warehouseQuantity,
    shelfQuantity,
    quantity,
    physicalQuantity: quantity,
    sellableQuantity,
    expiredQuantity: batchAvailability.expiredQuantity,
    reserved,
    onHand: quantity,
    available: Math.max(sellableQuantity - reserved, 0),
    batches: batchSummary.batches,
    batchCount: batchSummary.activeBatches.length,
    expiredBatchCount: batchSummary.expiredBatchCount,
    nearestExpiry,
    fefoDefaultBatchNo,
    fefoDefaultExpiry,
  };
};

const isDistributionEqual = (left, right) =>
  normalizeQty(left?.warehouseQuantity) === normalizeQty(right?.warehouseQuantity) &&
  normalizeQty(left?.shelfQuantity) === normalizeQty(right?.shelfQuantity) &&
  normalizeQty(left?.quantity) === normalizeQty(right?.quantity);

const buildProductMap = async () => {
  const products = await productRepo.getAll();
  return new Map(products.map((item) => [item.id, item]));
};

const buildNextPayload = ({ productId, product, existingStock, incoming }) => {
  const base = existingStock || {
    productId,
    warehouseQuantity: 0,
    shelfQuantity: 0,
    quantity: 0,
    batches: [],
    reserved: 0,
  };

  if (typeof incoming === 'number') {
    const totalQuantity = normalizeQty(incoming);
    const maxShelfStock = resolveMaxShelfStock(product, totalQuantity);
    const distribution = distributeStock({ totalQuantity, maxShelfStock });

    return normalizeStock(
      {
        ...base,
        productId,
        warehouseQuantity: distribution.warehouseQuantity,
        shelfQuantity: distribution.shelfQuantity,
        quantity: distribution.quantity,
        updatedAt: new Date().toISOString(),
      },
      product
    );
  }

  const hasWarehouse = incoming?.warehouseQuantity !== undefined;
  const hasShelf = incoming?.shelfQuantity !== undefined;
  const hasQuantity = incoming?.quantity !== undefined;

  let warehouseQuantity = hasWarehouse ? normalizeQty(incoming.warehouseQuantity) : normalizeQty(base.warehouseQuantity);
  let shelfQuantity = hasShelf ? normalizeQty(incoming.shelfQuantity) : normalizeQty(base.shelfQuantity);

  if (!hasWarehouse && !hasShelf && hasQuantity) {
    const totalQuantity = normalizeQty(incoming.quantity);
    const maxShelfStock = resolveMaxShelfStock(product, totalQuantity);
    const distribution = distributeStock({ totalQuantity, maxShelfStock });
    warehouseQuantity = distribution.warehouseQuantity;
    shelfQuantity = distribution.shelfQuantity;
  }

  return normalizeStock(
    {
      ...base,
      ...incoming,
      productId,
      warehouseQuantity,
      shelfQuantity,
      quantity: warehouseQuantity + shelfQuantity,
      batches: Array.isArray(incoming?.batches) ? incoming.batches : (base.batches || []),
      reserved: incoming?.reserved !== undefined ? normalizeQty(incoming.reserved) : normalizeQty(base.reserved),
      updatedAt: new Date().toISOString(),
    },
    product
  );
};

export const stockRepo = {
  async getAll() {
    const stocks = await repository.getAll();
    const productMap = await buildProductMap();
    return stocks
      .map((stock) => normalizeStock(stock, productMap.get(stock.productId)))
      .filter(Boolean);
  },
  async findByProductId(productId) {
    const stock = await repository.findById(productId);
    const product = await productRepo.findById(productId);
    return normalizeStock(stock, product);
  },
  async upsert(productId, quantityOrPayload) {
    const product = await productRepo.findById(productId);
    const existing = await repository.findById(productId);
    const existingNormalized = normalizeStock(existing, product);
    const payload = buildNextPayload({ productId, product, existingStock: existingNormalized, incoming: quantityOrPayload });

    if (existing) {
      const updated = await repository.updateById(productId, { ...existing, ...payload });
      return normalizeStock(updated, product);
    }

    const created = await repository.create(payload);
    return normalizeStock(created, product);
  },
  async upsertDetailed(productId, payload = {}) {
    return this.upsert(productId, payload);
  },
  async deleteByProductId(productId) {
    return repository.deleteById(productId);
  },
  async normalizeAll() {
    const productMap = await buildProductMap();
    const stocks = await repository.getAll();
    let normalizedCount = 0;
    let productsWithoutExplicitCapacity = 0;

    for (const product of productMap.values()) {
      if (normalizeQty(product.maxShelfStock) <= 0) {
        productsWithoutExplicitCapacity += 1;
      }
    }

    for (const stock of stocks) {
      const product = productMap.get(stock.productId);
      const normalized = normalizeStock(stock, product);
      if (!normalized) continue;
      if (!isDistributionEqual(stock, normalized)) {
        await repository.updateById(stock.productId, {
          ...stock,
          ...normalized,
          updatedAt: new Date().toISOString(),
        });
        normalizedCount += 1;
      }
    }

    return { normalizedCount, productsWithoutExplicitCapacity };
  },
};
