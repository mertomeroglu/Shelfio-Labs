import { v4 as uuidv4 } from 'uuid';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { categoryRepo } from '../repositories/categoryRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { sectionRepo } from '../repositories/sectionRepository.js';
import { stockRepo } from '../repositories/stockRepository.js';
import { supplierRepo } from '../repositories/supplierRepository.js';
import { warehouseLocationRepo } from '../repositories/warehouseLocationRepository.js';
import { warehouseMovementRepo } from '../repositories/warehouseMovementRepository.js';
import { buildVirtualDepotZones } from '../utils/depotAssignment.js';
import { formatStorageTypeLabel, normalizeStorageTypeCode } from '../utils/displayLabels.js';
import { includesSearchText, normalizeSearchText } from '../utils/validators.js';
import { isActiveRetailProduct } from '../utils/retailStockPolicy.js';

const ROW_COUNT = 3;
const SIDES = ['L', 'R'];
const SHELF_COUNT = 15;
const LEVEL_COUNT = 10;

const MOVEMENT_TYPES = new Set([
  'MAL_KABUL',
  'REYONA_TRANSFER',
  'DEPOYA_IADE',
  'SAYIM_DUZELTMESI',
  'FIRE_ZAYI',
  'TRANSFER_CIKISI',
]);

const normalizeStorageType = (value) => {
  return normalizeStorageTypeCode(value);
};

const storageLabel = (value) => formatStorageTypeLabel(value);

const resolveStatus = (location) => {
  if (Number(location.palletCount || 0) > 0) return 'Dolu';
  return 'Boş';
};

const locationCode = (rowNo, side, shelfNo, levelNo) => `D${rowNo}-${side}-${String(shelfNo).padStart(2, '0')}-${String(levelNo).padStart(2, '0')}`;

const WAREHOUSE_STRUCTURE = {
  rowCount: ROW_COUNT,
  sidePerRow: SIDES.length,
  shelfPerSide: SHELF_COUNT,
  levelPerShelf: LEVEL_COUNT,
  palletPerLevel: 1,
  totalCapacity: ROW_COUNT * SIDES.length * SHELF_COUNT * LEVEL_COUNT,
  levelCapacityPerRow: SIDES.length * SHELF_COUNT,
};

const storageTypeByRow = (rowNo) => {
  if (rowNo === 2) return 'cold_chain';
  if (rowNo === 3) return 'freezer';
  return 'Ortam';
};

const createDefaultLocations = () => {
  const rows = [];
  for (let rowNo = 1; rowNo <= ROW_COUNT; rowNo += 1) {
    for (const side of SIDES) {
      for (let shelfNo = 1; shelfNo <= SHELF_COUNT; shelfNo += 1) {
        for (let levelNo = 1; levelNo <= LEVEL_COUNT; levelNo += 1) {
          const storageType = storageTypeByRow(rowNo);
          rows.push({
            id: uuidv4(),
            rowNo,
            side,
            shelfNo,
            levelNo,
            locationCode: locationCode(rowNo, side, shelfNo, levelNo),
            storageType,
            storageTypeLabel: storageLabel(storageType),
            status: 'Boş',
            productId: null,
            productName: null,
            sku: null,
            barcode: null,
            supplierId: null,
            supplierName: null,
            batchNo: null,
            skt: null,
            palletCount: 0,
            palletCapacity: 1,
            occupancy: 0,
            warehouseStock: 0,
            lastInAt: null,
            lastOutAt: null,
            note: '',
            isReserved: false,
            isBlocked: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }
  }
  return rows;
};

const isStorageCompatible = (category, storageType) => {
  if (category?.requiresFreezer) return storageType === 'freezer';
  if (category?.requiresColdChain) return storageType === 'cold_chain';
  return storageType === 'Ortam';
};

const withComputedFields = (row) => {
  const palletCapacity = 1;
  const palletCount = Math.max(0, Math.min(1, Number(row.palletCount || 0)));
  const occupancy = palletCount > 0 ? 1 : 0;
  return {
    ...row,
    palletCapacity,
    palletCount,
    occupancy,
    status: resolveStatus({ ...row, palletCount }),
    storageTypeLabel: storageLabel(row.storageType),
  };
};

const enrichLocationRow = (row) => {
  const assignedSkus = row?.sku ? [row.sku] : [];
  return {
    ...row,
    locationType: 'depo',
    occupancyStatus: row.status,
    assignedSkuCount: assignedSkus.length,
    assignedSkus,
    capacity: Number(row.palletCapacity || 1),
  };
};

const ensureInitialized = async () => {
  const all = await warehouseLocationRepo.getAll();
  if (all.length) return all.map(withComputedFields);
  const generated = createDefaultLocations();
  await warehouseLocationRepo.writeData(generated);
  return generated.map(withComputedFields);
};

const buildSummary = (locations) => {
  const total = locations.length;
  const empty = locations.filter((x) => x.status === 'Boş').length;
  const full = locations.filter((x) => x.status === 'Dolu').length;

  const Ortam = locations.filter((x) => x.storageType === 'Ortam').length;
  const cold = locations.filter((x) => x.storageType === 'cold_chain').length;
  const freezer = locations.filter((x) => x.storageType === 'freezer').length;

  return {
    totalLocations: total,
    emptyLocations: empty,
    fullLocations: full,
    reservedLocations: 0,
    blockedLocations: 0,
    OrtamCapacity: Ortam,
    coldChainCapacity: cold,
    freezerCapacity: freezer,
  };
};

const buildDepotAssignments = (locations) =>
  locations
    .filter((row) => Number(row.palletCount || 0) > 0 || row.productId)
    .map((row) => ({
      locationCode: row.locationCode,
      locationType: 'depo',
      storageType: row.storageType,
      occupancyStatus: row.status,
      productId: row.productId || null,
      productName: row.productName || null,
      sku: row.sku || null,
      batchNo: row.batchNo || null,
      skt: row.skt || null,
      palletCount: Number(row.palletCount || 0),
      capacity: Number(row.palletCapacity || 1),
    }));

const buildDepotZones = (locations) => {
  const zoneMap = new Map();

  for (const row of locations) {
    const key = `ROW-${row.rowNo}`;
    if (!zoneMap.has(key)) {
      zoneMap.set(key, {
        zoneCode: key,
        rowNo: row.rowNo,
        storageType: row.storageType,
        totalLocations: 0,
        occupiedLocations: 0,
        emptyLocations: 0,
      });
    }

    const zone = zoneMap.get(key);
    zone.totalLocations += 1;
    if (row.status === 'Dolu') zone.occupiedLocations += 1;
    if (row.status === 'Boş') zone.emptyLocations += 1;
  }

  return [
    ...[...zoneMap.values()].sort((left, right) => Number(left.rowNo) - Number(right.rowNo)),
    ...buildVirtualDepotZones(),
  ];
};

const buildShelfPlan = ({ products, sections, stocks }) => {
  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const stockMap = new Map(stocks.map((stock) => [stock.productId, stock]));

  return products
    .filter((product) => isActiveRetailProduct(product) && product.sectionId && product.shelfSide && product.shelfNo && product.shelfLevel)
    .map((product) => {
      const section = sectionMap.get(product.sectionId);
      const stock = stockMap.get(product.id);
      const sectionNumber = section?.number || null;
      return {
        sectionId: product.sectionId,
        sectionNumber,
        sectionName: section?.name || null,
        locationCode: sectionNumber
          ? `R${String(sectionNumber).padStart(2, '0')}-${String(product.shelfSide || 'L').toUpperCase()}-${String(product.shelfNo).padStart(2, '0')}-${String(product.shelfLevel).padStart(2, '0')}`
          : null,
        shelfSide: String(product.shelfSide || 'L').toUpperCase(),
        shelfNo: Number(product.shelfNo || 0),
        shelfLevel: Number(product.shelfLevel || 0),
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        storageType: product.requiredStorageType || 'Ortam',
        shelfStock: Number(stock?.shelfQuantity || 0),
        maxShelfStock: Number(product.maxShelfStock || 0),
      };
    })
    .sort((left, right) => String(left.locationCode || '').localeCompare(String(right.locationCode || ''), 'tr'));
};

const buildShelfZones = ({ sections, shelfPlan }) => {
  const group = new Map();
  for (const section of sections) {
    group.set(section.id, {
      sectionId: section.id,
      sectionNumber: section.number,
      sectionName: section.name,
      totalSlots: 100,
      occupiedSlots: 0,
      assignedSkuCount: 0,
    });
  }

  for (const item of shelfPlan) {
    const row = group.get(item.sectionId);
    if (!row) continue;
    row.occupiedSlots += 1;
    row.assignedSkuCount += 1;
  }

  return [...group.values()]
    .map((row) => ({
      ...row,
      emptySlots: Math.max(0, Number(row.totalSlots || 0) - Number(row.occupiedSlots || 0)),
      occupancyRate: row.totalSlots ? (Number(row.occupiedSlots || 0) / Number(row.totalSlots || 1)) * 100 : 0,
    }))
    .sort((left, right) => Number(left.sectionNumber || 0) - Number(right.sectionNumber || 0));
};

const applyFilters = (locations, query) => {
  return locations.filter((row) => {
    const q = normalizeSearchText(query.search);
    const matchesSearch = !q || [row.locationCode, row.productName, row.sku, row.barcode, row.batchNo]
      .filter(Boolean)
      .some((v) => includesSearchText(v, q));

    const status = String(query.status || '').trim();
    const matchesStatus = !status || row.status === status;

    const storageType = normalizeStorageType(query.storageType);
    const matchesStorage = !String(query.storageType || '').trim() || row.storageType === storageType;

    const productId = String(query.productId || '').trim();
    const matchesProduct = !productId || String(row.productId || '') === productId;

    const rowNo = Number(query.rowNo || 0);
    const matchesRow = !rowNo || row.rowNo === rowNo;

    const side = String(query.side || '').toUpperCase();
    const matchesSide = !side || row.side === side;

    return matchesSearch && matchesStatus && matchesStorage && matchesProduct && matchesRow && matchesSide;
  });
};

const findSuggestedLocation = (locations, productId, mode = 'nearest', requiredStorageType = '') => {
  const empty = locations.filter((x) => x.status === 'Boş');
  const storageScoped = requiredStorageType
    ? empty.filter((item) => String(item.storageType || 'Ortam') === String(requiredStorageType))
    : empty;
  const pool = storageScoped.length ? storageScoped : empty;
  if (!pool.length) return null;

  if (!productId) return pool[0];

  const sameProduct = locations.filter((x) => x.productId === productId);
  if (!sameProduct.length || mode === 'fifo' || mode === 'fefo') return pool[0];

  const anchor = sameProduct[0];
  const ranked = [...pool].sort((a, b) => {
    const da = Math.abs(a.rowNo - anchor.rowNo) + Math.abs(a.shelfNo - anchor.shelfNo) + Math.abs(a.levelNo - anchor.levelNo);
    const db = Math.abs(b.rowNo - anchor.rowNo) + Math.abs(b.shelfNo - anchor.shelfNo) + Math.abs(b.levelNo - anchor.levelNo);
    return da - db;
  });

  return ranked[0] || null;
};

const updateWarehouseStock = async (productId, delta) => {
  if (!productId || !Number.isFinite(delta) || delta === 0) return;
  const current = await stockRepo.findByProductId(productId);
  const nextWarehouse = Math.max(0, Number(current?.warehouseQuantity || 0) + delta);
  const shelf = Number(current?.shelfQuantity || 0);
  await stockRepo.upsert(productId, { warehouseQuantity: nextWarehouse, shelfQuantity: shelf });
};

export const warehouseService = {
  async listLocations(query = {}) {
    const locations = await ensureInitialized();
    const filtered = applyFilters(locations, query);
    const [products, sections, stocks] = await Promise.all([
      productRepo.getAll(),
      sectionRepo.getAll(),
      stockRepo.getAll(),
    ]);

    const productId = String(query.productId || '').trim();
    const suggestMode = String(query.suggestMode || 'nearest').toLowerCase();
    let requiredStorageType = '';
    if (productId) {
      const product = await productRepo.findById(productId);
      if (product?.categoryId) {
        const category = await categoryRepo.findById(product.categoryId);
        if (category?.requiresFreezer) requiredStorageType = 'freezer';
        else if (category?.requiresColdChain) requiredStorageType = 'cold_chain';
        else requiredStorageType = 'Ortam';
      }
    }
    const suggested = findSuggestedLocation(locations, productId, suggestMode, requiredStorageType);
    const depotAssignments = buildDepotAssignments(locations);
    const depotZones = buildDepotZones(locations);
    const shelfPlan = buildShelfPlan({ products, sections, stocks });
    const shelfZones = buildShelfZones({ sections, shelfPlan });

    return {
      rows: filtered.map(enrichLocationRow),
      summary: buildSummary(locations),
      structure: WAREHOUSE_STRUCTURE,
      depotAssignments,
      depotZones,
      shelfPlan,
      shelfZones,
      suggestedLocation: suggested ? {
        id: suggested.id,
        locationCode: suggested.locationCode,
        rowNo: suggested.rowNo,
        side: suggested.side,
        shelfNo: suggested.shelfNo,
        levelNo: suggested.levelNo,
        storageType: suggested.storageType,
        suggestMode,
      } : null,
    };
  },

  async getSummary() {
    const locations = await ensureInitialized();
    return {
      ...buildSummary(locations),
      structure: WAREHOUSE_STRUCTURE,
    };
  },

  async listMovements(query = {}) {
    const rows = await warehouseMovementRepo.getAll();
    const filtered = rows.filter((item) => {
      const type = String(query.type || '').trim();
      const locationCodeQ = String(query.locationCode || '').trim();
      const productId = String(query.productId || '').trim();
      const q = normalizeSearchText(query.search);

      const matchesType = !type || item.movementType === type;
      const matchesLoc = !locationCodeQ || String(item.locationCode || '') === locationCodeQ;
      const matchesProduct = !productId || String(item.productId || '') === productId;
      const matchesSearch = !q || [item.productName, item.sku, item.barcode, item.batchNo, item.locationCode, item.description]
        .filter(Boolean)
        .some((v) => includesSearchText(v, q));

      return matchesType && matchesLoc && matchesProduct && matchesSearch;
    });

    return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async updateLocation(id, payload) {
    const all = await ensureInitialized();
    const location = all.find((x) => x.id === id);
    if (!location) throw createNotFoundError('Depo lokasyonu bulunamadı');

    const now = new Date().toISOString();
    const action = String(payload.action || '').toLowerCase();
    let updated = { ...location };

    if (action === 'reserve') {
      updated.isReserved = true;
    } else if (action === 'unreserve') {
      updated.isReserved = false;
    } else if (action === 'block') {
      updated.isBlocked = true;
    } else if (action === 'unblock') {
      updated.isBlocked = false;
    } else if (action === 'clear') {
      updated = {
        ...updated,
        productId: null,
        productName: null,
        sku: null,
        barcode: null,
        supplierId: null,
        supplierName: null,
        batchNo: null,
        skt: null,
        palletCount: 0,
        warehouseStock: 0,
        note: '',
        lastOutAt: now,
      };
    } else {
      throw new AppError(400, 'Geçersiz lokasyon aksiyonu');
    }

    updated.updatedAt = now;
    updated = withComputedFields(updated);

    await warehouseLocationRepo.updateById(id, updated);
    return updated;
  },

  async createMovement(payload, user) {
    const movementType = String(payload.movementType || '').trim().toUpperCase();
    if (!MOVEMENT_TYPES.has(movementType)) {
      throw new AppError(400, 'Geçersiz depo hareket tipi');
    }

    const productId = String(payload.productId || '').trim();
    const supplierId = String(payload.supplierId || '').trim();
    const locationCode = String(payload.locationCode || '').trim();
    const batchNo = String(payload.batchNo || '').trim();
    const skt = String(payload.skt || '').trim();
    const description = String(payload.description || '').trim();
    const qty = Math.max(0, Number(payload.qty || 0));

    if (!productId || !locationCode || !qty) {
      throw new AppError(400, 'productId, locationCode ve qty zorunludur');
    }

    const [product, supplier, locations, category] = await Promise.all([
      productRepo.findById(productId),
      supplierId ? supplierRepo.findById(supplierId) : Promise.resolve(null),
      ensureInitialized(),
      (async () => {
        const p = await productRepo.findById(productId);
        return p?.categoryId ? categoryRepo.findById(p.categoryId) : null;
      })(),
    ]);

    if (!product) throw createNotFoundError('Ürün bulunamadı');
    if (supplierId && !supplier) throw createNotFoundError('Tedarikçi bulunamadı');

    const location = locations.find((x) => x.locationCode === locationCode);
    if (!location) throw createNotFoundError('Lokasyon bulunamadı');

    if (!isStorageCompatible(category, location.storageType)) {
      throw new AppError(400, 'Ürün saklama tipi ile depo lokasyonu uyumlu değil');
    }

    const now = new Date().toISOString();
    const updated = { ...location };
    let stockDelta = 0;

    if (movementType === 'MAL_KABUL' || movementType === 'DEPOYA_IADE') {
      if (updated.palletCount >= 1) throw new AppError(400, 'Lokasyon dolu, en fazla 1 palet tutulabilir');
      updated.productId = product.id;
      updated.productName = product.name;
      updated.sku = product.sku;
      updated.barcode = product.barcode || '';
      updated.supplierId = supplier?.id || null;
      updated.supplierName = supplier?.name || null;
      updated.batchNo = batchNo || null;
      updated.skt = skt || null;
      updated.palletCount = 1;
      updated.warehouseStock = qty;
      updated.lastInAt = now;
      updated.note = description || updated.note || '';
      stockDelta = qty;
    }

    if (movementType === 'REYONA_TRANSFER' || movementType === 'TRANSFER_CIKISI' || movementType === 'FIRE_ZAYI') {
      if (String(updated.productId || '') !== productId) {
        throw new AppError(400, 'Lokasyondaki ürün ile hareket ürünü eşleşmiyor');
      }
      updated.palletCount = 0;
      updated.warehouseStock = Math.max(0, Number(updated.warehouseStock || 0) - qty);
      if (updated.warehouseStock <= 0) {
        updated.productId = null;
        updated.productName = null;
        updated.sku = null;
        updated.barcode = null;
        updated.supplierId = null;
        updated.supplierName = null;
        updated.batchNo = null;
        updated.skt = null;
      }
      updated.lastOutAt = now;
      updated.note = description || updated.note || '';
      stockDelta = -qty;
    }

    if (movementType === 'SAYIM_DUZELTMESI') {
      updated.warehouseStock = qty;
      updated.palletCount = qty > 0 ? 1 : 0;
      if (qty > 0) {
        updated.productId = product.id;
        updated.productName = product.name;
        updated.sku = product.sku;
        updated.barcode = product.barcode || '';
      }
      if (qty <= 0) {
        updated.productId = null;
        updated.productName = null;
        updated.sku = null;
        updated.barcode = null;
        updated.supplierId = null;
        updated.supplierName = null;
        updated.batchNo = null;
        updated.skt = null;
      }
      updated.note = description || updated.note || '';
      stockDelta = qty - Number(location.warehouseStock || 0);
    }

    updated.updatedAt = now;
    const normalized = withComputedFields(updated);
    await warehouseLocationRepo.updateById(location.id, normalized);
    await updateWarehouseStock(product.id, stockDelta);

    const movement = {
      id: uuidv4(),
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      barcode: product.barcode || '',
      supplierId: supplier?.id || null,
      supplierName: supplier?.name || null,
      locationId: normalized.id,
      locationCode: normalized.locationCode,
      batchNo: batchNo || normalized.batchNo || null,
      skt: skt || normalized.skt || null,
      movementType,
      qty,
      createdAt: now,
      createdBy: user?.id || null,
      createdByName: user?.name || 'Sistem',
      description,
    };

    await warehouseMovementRepo.create(movement);

    return {
      movement,
      location: normalized,
    };
  },
};


