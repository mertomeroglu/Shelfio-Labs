import { v4 as uuidv4 } from 'uuid';
import { storeLayoutRepo } from '../repositories/storeLayoutRepository.js';
import { AppError } from '../utils/appError.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { config } from '../config/config.js';
import { getActiveTenantId } from '../tenant/tenantContext.js';
import { sectionRepo } from '../repositories/sectionRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { warehouseLocationRepo } from '../repositories/warehouseLocationRepository.js';
import { stockRepo } from '../repositories/stockRepository.js';


const VALID_OBJECT_TYPES = new Set([
  'shelf', 'cashier', 'entrance', 'exit', 'wall', 'aisle', 'label', 'zone',
  'section', 'warehouse_location', 'warehouse_door', 'service_area', 'empty_area',
  'section_common_area', 'warehouse_common_area',
  'custom', 'cold_cabinet', 'campaign_stand',
  'boundary', 'store_boundary', 'warehouse_boundary', 'store_zone', 'warehouse_zone', 'layout_boundary', 'layout_zone',
  'shelf_stack', 'warehouse_stack'
]);

const TRANSIENT_LAYOUT_ITEM_ID_PREFIXES = ['local-', 'generated-', 'plan-stack-'];
const EDITOR_VIEW = 'editor';


const VALID_STATUSES = new Set(['draft', 'published', 'archived']);

const RENDER_ORDER = {
  'aisle': 1,
  'empty_area': 1,
  'wall': 1,
  'zone': 1,
  'section': 2,
  'shelf': 3,
  'shelf_stack': 3,
  'warehouse_location': 3,
  'warehouse_stack': 3,
  'section_common_area': 4,
  'warehouse_common_area': 4,
  'cashier': 5,
  'entrance': 5,
  'exit': 5,
  'warehouse_door': 5,
  'service_area': 5,
  'label': 5
};

const FALLBACK_LAYOUT = {
  BOUNDARY_PADDING: 48,
  START_X: 120,
  START_Y: 180,
  SECTION_COLUMNS: 4,
  SECTION_BODY_WIDTH: 56,
  SECTION_MIN_HEIGHT: 300,
  SECTION_BLOCK_WIDTH: 250,
  SECTION_GAP_X: 132,
  SECTION_GAP_Y: 138,
  SHELF_STACK_WIDTH: 76,
  SHELF_STACK_HEIGHT: 22,
  SHELF_STACK_GAP: 7,
  SHELF_SIDE_GAP: 18,
  COMMON_AREA_WIDTH: 112,
  COMMON_AREA_HEIGHT: 38,
  WAREHOUSE_ZONE_GAP: 190,
  WAREHOUSE_ROW_WIDTH: 230,
  WAREHOUSE_STACK_WIDTH: 82,
  WAREHOUSE_STACK_HEIGHT: 22,
  WAREHOUSE_STACK_GAP: 7,
  CASHIER_ZONE_GAP: 145,
};

const SECTION_CAPACITY = {
  SIDES: ['L', 'R'],
  SHELVES_PER_SIDE: 10,
  LEVELS_PER_SHELF: 5,
};

const WAREHOUSE_CAPACITY = {
  ROWS: 3,
  SIDES: ['L', 'R'],
  SHELVES_PER_SIDE: 15,
  LEVELS_PER_SHELF: 10,
};

const getSortOrder = (objectType) => {
  return RENDER_ORDER[objectType] || 99;
};

const isEmptyField = (val) => val === null || val === undefined || String(val).trim() === '';

const hasPhysicalShelfLocation = (product) => Boolean(
  product?.sectionId
  && product.isVirtualLocation !== true
  && !isEmptyField(product.shelfSide)
  && !isEmptyField(product.shelfNo)
  && !isEmptyField(product.shelfLevel)
);

const isSectionCommonProduct = (product) => Boolean(
  product?.sectionId
  && product.isVirtualLocation === true
);

const getShelfProductKey = ({ sectionId, shelfSide, shelfNo, shelfLevel }) => (
  `${String(sectionId)}-${String(shelfSide).toUpperCase()}-${Number(shelfNo)}-${Number(shelfLevel)}`
);

const toProductMetadata = (product) => ({
  id: product.id,
  name: product.name,
  sku: product.sku,
  barcode: product.barcode || '',
  sectionId: product.sectionId || null,
  shelfSide: product.shelfSide || null,
  shelfNo: product.shelfNo ?? null,
  shelfLevel: product.shelfLevel ?? null,
  shelfCode: product.shelfCode || null,
  isVirtualLocation: product.isVirtualLocation === true,
  shelfQuantity: product.stock?.shelfQuantity || 0,
  warehouseQuantity: product.stock?.warehouseQuantity || 0,
  quantity: product.stock?.quantity || 0,
  currentStock: product.currentStock ?? product.stock?.quantity ?? null,
  criticalStock: product.criticalStock ?? null,
  maxShelfStock: product.maxShelfStock ?? null,
  maxStock: product.maxStock ?? null,
});

const sectionCommonAreaLabel = (sectionName) => (
  sectionName ? `${sectionName} Ortak Alanı` : 'Ortak Reyon Alanı'
);

const isGenericSectionCommonAreaLabel = (label) => {
  const normalized = String(label || '').trim().toLocaleLowerCase('tr-TR');
  return !normalized
    || normalized === 'ortak reyon'
    || normalized === 'ortak reyon alanı'
    || normalized === 'section_common_area';
};

const validateObjectType = (objectType) => {
  if (!objectType || !VALID_OBJECT_TYPES.has(objectType)) {
    throw new AppError(400, `Geçersiz objectType: ${objectType}. Kabul edilen değerler: ${[...VALID_OBJECT_TYPES].join(', ')}`);
  }
};

const validateItems = (items) => {
  if (!Array.isArray(items)) {
    throw new AppError(400, 'items bir dizi olmalıdır');
  }
  const usedIds = new Set();
  for (const item of items) {
    validateObjectType(item.objectType);
    const itemId = String(item.id || '').trim();
    if (itemId) {
      if (usedIds.has(itemId)) {
        throw new AppError(400, `Aynı nesne kimliği birden fazla kez gönderildi: ${itemId}`);
      }
      usedIds.add(itemId);
    }
    ['x', 'y', 'width', 'height'].forEach((key) => {
      if (!Number.isFinite(Number(item?.[key]))) {
        throw new AppError(400, `Konum ve boyut değerleri sayısal olmalıdır: ${key}`);
      }
    });
    if (![0, 90, 180, 270].includes(Number(item.rotation ?? 0))) {
      throw new AppError(400, `Geçersiz rotasyon değeri: ${item.rotation}`);
    }
    if (item.objectType === 'section_common_area' && !(item.sectionId || item.properties?.linkedSectionId || item.properties?.metadata?.sectionId)) {
      throw new AppError(400, 'Ortak reyon alanı için sectionId zorunludur');
    }
  }
};

const isEditorView = (view) => String(view || '').trim().toLowerCase() === EDITOR_VIEW;

const shouldRegenerateLayoutItemId = (value) => {
  const id = String(value || '').trim();
  return !id || TRANSIENT_LAYOUT_ITEM_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
};

const sanitizeStoredMetadata = (metadata = {}, { includeProducts = true } = {}) => {
  if (!metadata || typeof metadata !== 'object') return {};
  const nextMetadata = { ...metadata };
  delete nextMetadata.visualProjectionOffsetX;
  delete nextMetadata.boundingBox;
  delete nextMetadata.sourceItemIds;
  delete nextMetadata.labelCache;
  delete nextMetadata.computedBounds;
  delete nextMetadata.hovered;
  delete nextMetadata.selected;

  if (!includeProducts) {
    delete nextMetadata.products;
  }

  if (Array.isArray(nextMetadata.levels)) {
    nextMetadata.levels = nextMetadata.levels.map((level) => {
      const nextLevel = { ...level };
      if (!includeProducts) {
        delete nextLevel.products;
      }
      return nextLevel;
    });
  }

  return nextMetadata;
};

const getDefaultColor = (type) => {
  switch (type) {
    case 'section':
    case 'shelf':
      return '#FFA000';
    case 'warehouse_location':
      return '#78909C';
    case 'entrance':
      return '#4CAF50';
    case 'exit':
      return '#F44336';
    case 'cashier':
      return '#2196F3';
    case 'warehouse_door':
      return '#8D6E63';
    case 'aisle':
      return '#ECEFF1';
    case 'service_area':
      return '#9C27B0';
    default:
      return '#CFD8DC';
  }
};

const getDefaultIcon = (type) => {
  switch (type) {
    case 'section':
    case 'shelf':
      return 'shelves';
    case 'warehouse_location':
      return 'warehouse';
    case 'entrance':
      return 'login';
    case 'exit':
      return 'logout';
    case 'cashier':
      return 'point_of_sale';
    case 'warehouse_door':
      return 'door_front';
    case 'aisle':
      return 'view_week';
    case 'service_area':
      return 'support_agent';
    default:
      return 'crop_free';
  }
};

async function hydrateLayoutWithRuntimeInventory(layout, storeId) {
  if (!layout || !layout.items || layout.items.length === 0) {
    return layout;
  }

  const prisma = await getPrisma();

  // Load all products with stock from database
  let dbProducts = [];
  try {
    dbProducts = await prisma.product.findMany({
      include: { stock: true }
    });
  } catch (e) {
    console.error('Failed to load products for runtime hydration:', e);
    return layout;
  }

  // Load all warehouse locations from database
  let dbWarehouseLocations = [];
  try {
    dbWarehouseLocations = await prisma.warehouseLocation.findMany({});
  } catch (e) {
    console.error('Failed to load warehouse locations for runtime hydration:', e);
    return layout;
  }

  // Map products by shelf coordinates
  const productsByShelfKey = new Map(); // key: "sectionId-shelfSide-shelfNo-shelfLevel"
  // Group virtual products for common areas
  const commonProductsBySectionId = new Map();
  // Set of product IDs that are linked to specific warehouse locations
  const assignedProductIdsInWarehouse = new Set(
    dbWarehouseLocations.map(wl => wl.productId).filter(Boolean)
  );
  // Group virtual products for warehouse common area
  const commonWarehouseProducts = [];

  dbProducts.forEach(p => {
    if (p.isActive === false) return;

    if (hasPhysicalShelfLocation(p)) {
      const key = getShelfProductKey({
        sectionId: p.sectionId,
        shelfSide: p.shelfSide,
        shelfNo: p.shelfNo,
        shelfLevel: p.shelfLevel,
      });
      if (!productsByShelfKey.has(key)) {
        productsByShelfKey.set(key, []);
      }
      productsByShelfKey.get(key).push(p);
    }

    if (isSectionCommonProduct(p)) {
      if (!commonProductsBySectionId.has(p.sectionId)) {
        commonProductsBySectionId.set(p.sectionId, []);
      }
      commonProductsBySectionId.get(p.sectionId).push(toProductMetadata(p));
    }

    const whQty = p.stock?.warehouseQuantity ?? 0;
    const hasWarehouseStock = whQty > 0;
    const isNotLinkedToSpecificLocation = !assignedProductIdsInWarehouse.has(p.id);

    if (hasWarehouseStock && isNotLinkedToSpecificLocation) {
      commonWarehouseProducts.push({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode || '',
        isVirtualLocation: p.isVirtualLocation === true,
        warehouseQuantity: whQty,
        shelfQuantity: p.stock?.shelfQuantity || 0
      });
    }
  });

  // Group warehouse locations by coordinates and by ID/code
  const warehouseLocationsByCoordinates = new Map(); // key: "rowNo-side-shelfNo-levelNo"
  const warehouseLocationsByCode = new Map();
  const warehouseLocationsById = new Map();

  dbWarehouseLocations.forEach(wl => {
    warehouseLocationsById.set(wl.id, wl);
    if (wl.locationCode) {
      warehouseLocationsByCode.set(wl.locationCode, wl);
    }
    const coordsKey = `${wl.rowNo}-${String(wl.side).toUpperCase()}-${wl.shelfNo}-${wl.levelNo}`;
    warehouseLocationsByCoordinates.set(coordsKey, wl);
  });

  // Hydrate each layout item
  layout.items = layout.items.map(item => {
    const objectType = item.objectType;
    let metadata = item.metadata || item.properties?.metadata || {};
    const sectionId = item.linkedSectionId || item.sectionId || item.properties?.linkedSectionId || item.properties?.sectionId || metadata?.sectionId || null;
    const wlId = item.linkedWarehouseLocationId || item.properties?.linkedWarehouseLocationId || null;
    const locationCodeSnapshot = item.locationCodeSnapshot || item.properties?.locationCodeSnapshot || null;

    if (objectType === 'section_common_area') {
      const list = commonProductsBySectionId.get(sectionId) || [];
      metadata = {
        ...metadata,
        commonAreaType: 'section',
        commonProductCount: list.length,
        products: list,
      };
      item.metadata = metadata;
    } 
    else if (objectType === 'shelf' || objectType === 'shelf_stack') {
      const shelfSide = item.properties?.shelfSide || metadata.shelfSide || metadata.side || null;
      const shelfNo = item.properties?.shelfNo ?? metadata.shelfNo ?? null;
      const shelfLevel = item.properties?.shelfLevel ?? metadata.shelfLevel ?? null;

      if (sectionId && shelfSide && shelfNo !== null && shelfNo !== undefined) {
        const rawLevels = Array.isArray(metadata.levels) && metadata.levels.length > 0
          ? metadata.levels
          : shelfLevel !== null && shelfLevel !== undefined
            ? [{ levelNo: shelfLevel }]
            : Array.from({ length: SECTION_CAPACITY.LEVELS_PER_SHELF }, (_, index) => ({ levelNo: index + 1 }));

        const baseShelfCode = locationCodeSnapshot || metadata.shelfCode || null;
        const hydratedLevels = rawLevels.map((level, index) => {
          const levelNo = Number(level?.levelNo ?? level?.shelfLevel ?? level?.level ?? level?.no ?? index + 1);
          const key = getShelfProductKey({ sectionId, shelfSide, shelfNo, shelfLevel: levelNo });
          const products = (productsByShelfKey.get(key) || []).map(toProductMetadata);
          return {
            ...level,
            levelNo,
            shelfCode: level?.shelfCode || (baseShelfCode && rawLevels.length === 1
              ? baseShelfCode
              : baseShelfCode
                ? `${baseShelfCode}-${String(levelNo).padStart(2, '0')}`
                : null),
            products,
            isEmpty: products.length === 0,
          };
        });

        const stackProducts = hydratedLevels.flatMap((level) => level.products || []);
        const firstProduct = stackProducts[0] || null;

        item.linkedProductId = firstProduct?.id || null;
        metadata = {
          ...metadata,
          sectionId,
          shelfSide: String(shelfSide).toUpperCase(),
          shelfNo: Number(shelfNo),
          levels: hydratedLevels,
          levelCount: hydratedLevels.length,
          occupiedLevelCount: hydratedLevels.filter((level) => (level.products || []).length > 0).length,
          products: stackProducts,
          isEmpty: stackProducts.length === 0,
          collapsedStack: hydratedLevels.length > 1 || metadata.collapsedStack === true,
          sku: firstProduct?.sku || null,
          productName: firstProduct?.name || null,
          barcode: firstProduct?.barcode || '',
        };
        item.metadata = metadata;
      }
    } 
    else if (objectType === 'warehouse_location' || objectType === 'warehouse_stack') {
      const isStack = objectType === 'warehouse_stack' || metadata.collapsedStack === true;

      if (isStack) {
        const rowNo = Number(metadata.rowNo);
        const side = metadata.side ? String(metadata.side).toUpperCase() : null;
        const shelfNo = Number(metadata.shelfNo);

        if (rowNo && side && shelfNo) {
          const rawLevels = Array.isArray(metadata.levels) && metadata.levels.length > 0
            ? metadata.levels
            : Array.from({ length: WAREHOUSE_CAPACITY.LEVELS_PER_SHELF }, (_, index) => ({ levelNo: index + 1 }));

          const hydratedLevels = rawLevels.map((level, index) => {
            const levelNo = Number(level.levelNo ?? index + 1);
            const coordsKey = `${rowNo}-${side}-${shelfNo}-${levelNo}`;
            const matchedWL = warehouseLocationsByCoordinates.get(coordsKey);

            let levelProducts = [];
            let status = 'Boş';
            let occupancy = 0;
            let shelfCode = level.shelfCode || null;

            if (matchedWL) {
              status = matchedWL.status === 'Bo?' ? 'Boş' : (matchedWL.status || 'Boş');
              occupancy = matchedWL.occupancy ? Number(matchedWL.occupancy) : 0;
              shelfCode = matchedWL.locationCode;
              if (matchedWL.productId) {
                levelProducts = [{
                  id: matchedWL.productId,
                  name: matchedWL.productName || '',
                  sku: matchedWL.sku || '',
                  barcode: matchedWL.barcode || '',
                  warehouseQuantity: matchedWL.warehouseStock || 0,
                }];
              }
            }

            return {
              ...level,
              levelNo,
              shelfCode,
              status,
              occupancy,
              products: levelProducts,
              isEmpty: levelProducts.length === 0 && occupancy <= 0,
            };
          });

          metadata = {
            ...metadata,
            rowNo,
            side,
            shelfNo,
            levels: hydratedLevels,
            levelCount: hydratedLevels.length,
            occupiedLevelCount: hydratedLevels.filter((level) => !level.isEmpty).length,
            products: hydratedLevels.flatMap((level) => level.products || []),
            isEmpty: hydratedLevels.every((level) => level.isEmpty),
            collapsedStack: true,
          };
          item.metadata = metadata;
        }
      } 
      else {
        // Single warehouse location
        let matchedWL = null;
        if (wlId) matchedWL = warehouseLocationsById.get(wlId);
        if (!matchedWL && locationCodeSnapshot) matchedWL = warehouseLocationsByCode.get(locationCodeSnapshot);

        if (matchedWL) {
          item.linkedProductId = matchedWL.productId || null;
          const rawStatus = matchedWL.status || 'Boş';
          metadata.status = rawStatus === 'Bo?' ? 'Boş' : rawStatus;
          metadata.occupancy = matchedWL.occupancy ? Number(matchedWL.occupancy) : 0;
          metadata.warehouseStock = matchedWL.warehouseStock || 0;
          metadata.palletCount = matchedWL.palletCount || 0;

          if (matchedWL.productId) {
            metadata.sku = matchedWL.sku;
            metadata.productName = matchedWL.productName;
            metadata.products = [{
              id: matchedWL.productId,
              name: matchedWL.productName,
              sku: matchedWL.sku,
              barcode: matchedWL.barcode || '',
            }];
          } else {
            metadata.sku = null;
            metadata.productName = null;
            metadata.products = [];
          }
          item.metadata = metadata;
        }
      }
    } 
    else if (objectType === 'warehouse_common_area') {
      metadata = {
        ...metadata,
        commonAreaType: 'warehouse',
        commonProductCount: commonWarehouseProducts.length,
        products: commonWarehouseProducts,
      };
      item.metadata = metadata;
    }

    return item;
  });

  return layout;
}


async function formatLayout(layout, source = 'published', options = {}) {
  if (!layout) return null;
  const includeProducts = options.includeProducts !== false;

  // Hydrate product binding from database dynamically
  let dbProducts = [];
  let dbWarehouseLocations = [];

  if (includeProducts && config.dataStore === 'postgres') {
    const prisma = await getPrisma();
    dbProducts = await prisma.product.findMany({
      include: { stock: true }
    });
    dbWarehouseLocations = await prisma.warehouseLocation.findMany({});
  } else if (includeProducts) {
    try {
      const allProds = await productRepo.getAll();
      let dbStocks = [];
      try {
        dbStocks = await stockRepo.getAll();
      } catch (e) {}
      const stockMap = new Map(dbStocks.map(s => [s.productId, s]));
      dbProducts = allProds.map(p => ({ ...p, stock: stockMap.get(p.id) || null }));
    } catch (e) {
      console.error('Failed to load products for layout hydration:', e);
    }
    try {
      dbWarehouseLocations = await warehouseLocationRepo.getAll();
    } catch (e) {
      console.error('Failed to load warehouse locations for layout hydration:', e);
    }
  }

  // Map products by shelf coordinates
  const productsByShelfKey = new Map(); // key: "sectionId-shelfSide-shelfNo-shelfLevel"

  // Group virtual products for common areas
  const commonProductsBySectionId = new Map();
  const commonWarehouseProducts = [];

  dbProducts.forEach(p => {
    if (hasPhysicalShelfLocation(p)) {
      const key = getShelfProductKey({
        sectionId: p.sectionId,
        shelfSide: p.shelfSide,
        shelfNo: p.shelfNo,
        shelfLevel: p.shelfLevel,
      });
      if (!productsByShelfKey.has(key)) productsByShelfKey.set(key, []);
      productsByShelfKey.get(key).push(p);
    }

    // Determine if product is virtual for common reyon area
    if (isSectionCommonProduct(p)) {
      if (!commonProductsBySectionId.has(p.sectionId)) {
        commonProductsBySectionId.set(p.sectionId, []);
      }
      commonProductsBySectionId.get(p.sectionId).push(toProductMetadata(p));
    }

    // Determine if product is virtual for common warehouse area
    const whQty = p.stock?.warehouseQuantity ?? 0;
    const isVirtualDepot = isEmptyField(p.depotLocationCode) && 
                           (p.isVirtualLocation === true || p.depotLocationCode === null) && 
                           (whQty >= 0);
    if (isVirtualDepot) {
      commonWarehouseProducts.push({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode || '',
        isVirtualLocation: p.isVirtualLocation === true,
        warehouseQuantity: whQty,
        shelfQuantity: p.stock?.shelfQuantity || 0
      });
    }
  });

  // Map warehouse locations by locationCode or id
  const warehouseLocById = new Map();
  const warehouseLocByCode = new Map();
  dbWarehouseLocations.forEach(wl => {
    warehouseLocById.set(wl.id, wl);
    if (wl.locationCode) {
      warehouseLocByCode.set(wl.locationCode, wl);
    }
  });

  const formattedItems = (layout.items || []).map(item => {
    const properties = item.properties || {};
    let linkedProductId = properties.linkedProductId || null;
    let metadata = sanitizeStoredMetadata(properties.metadata || {}, { includeProducts });
    const resolvedSectionId = item.sectionId 
      || properties.sectionId 
      || properties.linkedSectionId 
      || metadata.sectionId 
      || null;
    
    // For shelves and collapsed shelf stacks, search the operational products by coordinates.
    if (includeProducts && (item.objectType === 'shelf' || item.objectType === 'shelf_stack')) {
      const sectionId = resolvedSectionId;
      const shelfSide = properties.shelfSide || metadata.shelfSide || metadata.side || null;
      const shelfNo = properties.shelfNo ?? metadata.shelfNo ?? null;
      const shelfLevel = properties.shelfLevel ?? metadata.shelfLevel ?? null;
      
      if (sectionId && shelfSide && shelfNo !== null && shelfNo !== undefined) {
        const rawLevels = Array.isArray(metadata.levels) && metadata.levels.length > 0
          ? metadata.levels
          : shelfLevel !== null && shelfLevel !== undefined
            ? [{ levelNo: shelfLevel, shelfCode: properties.locationCodeSnapshot || null }]
            : Array.from({ length: SECTION_CAPACITY.LEVELS_PER_SHELF }, (_, index) => ({ levelNo: index + 1 }));

        const baseShelfCode = properties.locationCodeSnapshot || metadata.shelfCode || null;
        const hydratedLevels = rawLevels.map((level, index) => {
          const levelNo = Number(level?.levelNo ?? level?.shelfLevel ?? level?.level ?? level?.no ?? index + 1);
          const key = getShelfProductKey({ sectionId, shelfSide, shelfNo, shelfLevel: levelNo });
          const products = (productsByShelfKey.get(key) || []).map(toProductMetadata);
          return {
            ...level,
            levelNo,
            shelfCode: level?.shelfCode || level?.code || (baseShelfCode && rawLevels.length === 1
              ? baseShelfCode
              : baseShelfCode
                ? `${baseShelfCode}-${String(levelNo).padStart(2, '0')}`
                : null),
            products,
            isEmpty: products.length === 0,
          };
        });
        const stackProducts = hydratedLevels.flatMap((level) => level.products || []);
        const firstProduct = stackProducts[0] || null;

        linkedProductId = firstProduct?.id || null;
        metadata = {
          ...metadata,
          sectionId,
          shelfSide: String(shelfSide).toUpperCase(),
          shelfNo: Number(shelfNo),
          levels: hydratedLevels,
          levelCount: hydratedLevels.length,
          occupiedLevelCount: hydratedLevels.filter((level) => (level.products || []).length > 0).length,
          products: stackProducts,
          isEmpty: stackProducts.length === 0,
          collapsedStack: hydratedLevels.length > 1 || metadata.collapsedStack === true,
          sku: firstProduct?.sku || null,
          productName: firstProduct?.name || null,
          barcode: firstProduct?.barcode || '',
        };
      }
    }
    
    // For warehouse_location, find by linkedWarehouseLocationId or locationCodeSnapshot
    if (includeProducts && item.objectType === 'warehouse_location') {
      const wlId = properties.linkedWarehouseLocationId || null;
      const wlCode = properties.locationCodeSnapshot || null;
      
      let matchedWL = null;
      if (wlId) matchedWL = warehouseLocById.get(wlId);
      if (!matchedWL && wlCode) matchedWL = warehouseLocByCode.get(wlCode);
      
      if (matchedWL) {
        linkedProductId = matchedWL.productId || null;
        // Sanitize corrupted Turkish status value: 'Bo?' → 'Boş'
        const rawStatus = matchedWL.status || 'Boş';
        metadata.status = rawStatus === 'Bo?' ? 'Boş' : rawStatus;
        metadata.occupancy = matchedWL.occupancy ? Number(matchedWL.occupancy) : 0;
        metadata.warehouseStock = matchedWL.warehouseStock || 0;
        metadata.palletCount = matchedWL.palletCount || 0;
        if (matchedWL.productId) {
          metadata.sku = matchedWL.sku;
          metadata.productName = matchedWL.productName;
        } else {
          metadata.sku = null;
          metadata.productName = null;
        }
      }
    }

    // For section_common_area
    if (item.objectType === 'section_common_area') {
      const list = commonProductsBySectionId.get(resolvedSectionId) || [];
      metadata = {
        ...metadata,
        commonAreaType: 'section',
        commonProductCount: list.length,
        ...(includeProducts ? { products: list } : {}),
      };
    }

    // For warehouse_common_area
    if (item.objectType === 'warehouse_common_area') {
      const list = commonWarehouseProducts;
      metadata = {
        ...metadata,
        commonAreaType: 'warehouse',
        commonProductCount: list.length,
        ...(includeProducts ? { products: list } : {}),
      };
    }

    return {
      id: item.id,
      objectType: item.objectType,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      rotation: item.rotation,
      label: item.label,
      color: properties.color || getDefaultColor(item.objectType),
      icon: properties.icon || getDefaultIcon(item.objectType),
      isLocked: properties.isLocked || false,
      isVisible: properties.isVisible ?? true,
      linkedSectionId: resolvedSectionId,
      linkedWarehouseLocationId: properties.linkedWarehouseLocationId || null,
      linkedLocationZoneId: properties.linkedLocationZoneId || null,
      linkedProductId,
      locationCodeSnapshot: properties.locationCodeSnapshot || null,
      metadata
    };
  });

  // Inject missing common area items at runtime
  let activeSections = [];
  if (config.dataStore === 'postgres') {
    const prisma = await getPrisma();
    activeSections = await prisma.section.findMany({
      orderBy: [{ number: 'asc' }, { name: 'asc' }],
    });
  } else {
    try {
      activeSections = await sectionRepo.getAll();
    } catch (e) {
      console.error(e);
    }
  }
  activeSections = (activeSections || []).sort((a, b) => Number(a.number || 0) - Number(b.number || 0));
  const sectionById = new Map(activeSections.map((sec) => [String(sec.id), sec]));

  formattedItems.forEach((item) => {
    if (item.objectType !== 'section_common_area') return;
    const sectionId = item.linkedSectionId || item.metadata?.sectionId || null;
    const section = sectionId ? sectionById.get(String(sectionId)) : null;
    const sectionName = item.metadata?.sectionName || section?.name || null;
    if (sectionName) {
      item.metadata = {
        ...item.metadata,
        sectionId: item.metadata?.sectionId || sectionId,
        sectionName,
      };
    }
    if (isGenericSectionCommonAreaLabel(item.label)) {
      item.label = sectionCommonAreaLabel(sectionName);
    }
  });

  const existingSectionCommonIds = new Set();
  let hasWarehouseCommon = false;

  formattedItems.forEach(item => {
    if (item.objectType === 'section_common_area') {
      existingSectionCommonIds.add(item.linkedSectionId);
    }
    if (item.objectType === 'warehouse_common_area') {
      hasWarehouseCommon = true;
    }
  });

  // Inject missing section_common_area items
  activeSections.forEach(sec => {
    if (!existingSectionCommonIds.has(sec.id)) {
      const sectionItem = formattedItems.find(item => item.objectType === 'section' && item.linkedSectionId === sec.id);
      let x = 80;
      let y = 180;
      let width = 60;
      let height = 35;
      if (sectionItem) {
        x = sectionItem.x - 10;
        y = sectionItem.y - 45;
      }
      
      const list = commonProductsBySectionId.get(sec.id) || [];
      const sectionNumPad = String(sec.number).padStart(2, '0');

      formattedItems.push({
        id: `generated-section-common-${sec.id}`,
        objectType: 'section_common_area',
        x,
        y,
        width,
        height,
        rotation: 0,
        label: sectionCommonAreaLabel(sec.name),
        color: '#FFA000',
        icon: 'layers',
        isLocked: true,
        isVisible: true,
        linkedSectionId: sec.id,
        linkedWarehouseLocationId: null,
        linkedLocationZoneId: null,
        linkedProductId: null,
        locationCodeSnapshot: `R${sectionNumPad}-ORTAK`,
        metadata: {
          commonAreaType: 'section',
          generatedDefault: true,
          sectionId: sec.id,
          sectionName: sec.name,
          commonProductCount: list.length,
          ...(includeProducts ? { products: list } : {})
        }
      });
    }
  });

  // Inject missing warehouse_common_area item
  if (!hasWarehouseCommon) {
    const list = commonWarehouseProducts;
    const whItems = formattedItems.filter(item => item.objectType === 'warehouse_location');
    let x = 800;
    let y = 300;
    if (whItems.length > 0) {
      const minX = Math.min(...whItems.map(w => w.x));
      const minY = Math.min(...whItems.map(w => w.y));
      x = minX - 60;
      y = minY;
    }
    formattedItems.push({
      id: 'generated-warehouse-common',
      objectType: 'warehouse_common_area',
      x,
      y,
      width: 45,
      height: 120,
      rotation: 0,
      label: 'Ortak Depo Alanı',
      color: '#78909C',
      icon: 'warehouse',
      isLocked: true,
      isVisible: true,
      linkedSectionId: null,
      linkedWarehouseLocationId: null,
      linkedLocationZoneId: null,
      linkedProductId: null,
      locationCodeSnapshot: 'DEPO-ORTAK',
      metadata: {
        commonAreaType: 'warehouse',
        generatedDefault: true,
        commonProductCount: list.length,
        ...(includeProducts ? { products: list } : {})
      }
    });
  }

  // Sort formattedItems to ensure SVG render order
  formattedItems.sort((a, b) => getSortOrder(a.objectType) - getSortOrder(b.objectType));

  return {
    id: layout.id,
    name: layout.name,
    status: layout.status,
    source,
    storeId: layout.storeId || null,
    version: layout.version,
    canvasWidth: layout.canvasWidth,
    canvasHeight: layout.canvasHeight,
    gridWidth: Math.floor(layout.canvasWidth / 40),
    gridHeight: Math.floor(layout.canvasHeight / 40),
    gridSize: 40,
    metadata: layout.metadata,
    items: formattedItems
  };
}

async function generateFallbackLayout(storeId, options = {}) {
  const includeProducts = options.includeProducts !== false;
  let sections = [];
  if (config.dataStore === 'postgres') {
    const prisma = await getPrisma();
    sections = await prisma.section.findMany({
      orderBy: [{ number: 'asc' }, { name: 'asc' }],
    });
  } else {
    sections = await sectionRepo.getAll();
  }
  
  sections = (sections || [])
    .filter((section) => section.isActive !== false)
    .sort((a, b) => Number(a.number || 0) - Number(b.number || 0));

  let products = [];
  if (includeProducts && config.dataStore === 'postgres') {
    const prisma = await getPrisma();
    products = await prisma.product.findMany({
      include: { stock: true }
    });
  } else if (includeProducts) {
    try {
      const allProds = await productRepo.getAll();
      let dbStocks = [];
      try {
        dbStocks = await stockRepo.getAll();
      } catch (e) {}
      const stockMap = new Map(dbStocks.map(s => [s.productId, s]));
      products = allProds.map(p => ({ ...p, stock: stockMap.get(p.id) || null }));
    } catch (e) {
      console.error('Failed to load products for fallback hydration:', e);
      products = await productRepo.getAll();
    }
  }

  // Group virtual products for common areas
  const commonProductsBySectionId = new Map();
  const commonWarehouseProducts = [];

  products.forEach(p => {
    // Determine if product is virtual for common reyon area
    if (isSectionCommonProduct(p)) {
      if (!commonProductsBySectionId.has(p.sectionId)) {
        commonProductsBySectionId.set(p.sectionId, []);
      }
      commonProductsBySectionId.get(p.sectionId).push(toProductMetadata(p));
    }

    // Determine if product is virtual for common warehouse area
    const whQty = p.stock?.warehouseQuantity ?? 0;
    const isVirtualDepot = isEmptyField(p.depotLocationCode) && 
                           (p.isVirtualLocation === true || p.depotLocationCode === null) && 
                           (whQty >= 0);
    if (isVirtualDepot) {
      commonWarehouseProducts.push({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode || '',
        isVirtualLocation: p.isVirtualLocation === true,
        warehouseQuantity: whQty,
        shelfQuantity: p.stock?.shelfQuantity || 0
      });
    }
  });

  let whLocations = await warehouseLocationRepo.getAll();
  if (!whLocations || whLocations.length === 0) {
    whLocations = [];
    const SIDES = ['L', 'R'];
    for (let rowNo = 1; rowNo <= 3; rowNo++) {
      for (const side of SIDES) {
        for (let shelfNo = 1; shelfNo <= 15; shelfNo++) {
          for (let levelNo = 1; levelNo <= 10; levelNo++) {
            whLocations.push({
              id: `wh-transient-${rowNo}-${side}-${shelfNo}-${levelNo}`,
              rowNo,
              side,
              shelfNo,
              levelNo,
              locationCode: `D${rowNo}-${side}-${String(shelfNo).padStart(2, '0')}-${String(levelNo).padStart(2, '0')}`,
              storageType: rowNo === 2 ? 'cold_chain' : rowNo === 3 ? 'freezer' : 'Ortam',
              status: 'Boş',
              palletCount: 0,
              occupancy: 0,
            });
          }
        }
      }
    }
  }

  const items = [];
  const sectionIdMap = new Map();
  const shelfGroups = new Map();
  sections.forEach((section) => {
    SECTION_CAPACITY.SIDES.forEach((side) => {
      for (let shelfNo = 1; shelfNo <= SECTION_CAPACITY.SHELVES_PER_SIDE; shelfNo += 1) {
        shelfGroups.set(`${section.id}-${side}-${shelfNo}`, {
          sectionId: section.id,
          side,
          shelfNo,
          levels: new Map(),
        });
      }
    });
  });

  products.forEach((product) => {
    if (!hasPhysicalShelfLocation(product)) return;
    const side = String(product.shelfSide).toUpperCase();
    const shelfNo = Number(product.shelfNo);
    const levelNo = Number(product.shelfLevel);
    if (
      !SECTION_CAPACITY.SIDES.includes(side)
      || shelfNo < 1
      || shelfNo > SECTION_CAPACITY.SHELVES_PER_SIDE
      || levelNo < 1
      || levelNo > SECTION_CAPACITY.LEVELS_PER_SHELF
    ) return;
    const key = `${product.sectionId}-${side}-${shelfNo}`;
    const group = shelfGroups.get(key);
    if (!group) return;
    if (!group.levels.has(levelNo)) group.levels.set(levelNo, []);
    group.levels.get(levelNo).push(product);
  });

  const totalSections = sections.length;
  const rowCount = Math.max(1, Math.ceil(totalSections / FALLBACK_LAYOUT.SECTION_COLUMNS));
  const activeColumns = Math.max(1, Math.min(totalSections, FALLBACK_LAYOUT.SECTION_COLUMNS));
  const sectionRowHeights = Array.from({ length: rowCount }, () => FALLBACK_LAYOUT.SECTION_MIN_HEIGHT);

  sections.forEach((section, index) => {
    const row = Math.floor(index / FALLBACK_LAYOUT.SECTION_COLUMNS);
    const requiredHeight = SECTION_CAPACITY.SHELVES_PER_SIDE
      * (FALLBACK_LAYOUT.SHELF_STACK_HEIGHT + FALLBACK_LAYOUT.SHELF_STACK_GAP) + 24;
    sectionRowHeights[row] = Math.max(sectionRowHeights[row], requiredHeight);
  });

  const sectionRowOffsets = [];
  sectionRowHeights.forEach((height, row) => {
    sectionRowOffsets[row] = row === 0
      ? FALLBACK_LAYOUT.START_Y
      : sectionRowOffsets[row - 1] + sectionRowHeights[row - 1] + FALLBACK_LAYOUT.SECTION_GAP_Y;
  });

  // Generate sections and section common areas
  sections.forEach((sec, index) => {
    const column = index % FALLBACK_LAYOUT.SECTION_COLUMNS;
    const row = Math.floor(index / FALLBACK_LAYOUT.SECTION_COLUMNS);
    const blockStartX = FALLBACK_LAYOUT.START_X
      + column * (FALLBACK_LAYOUT.SECTION_BLOCK_WIDTH + FALLBACK_LAYOUT.SECTION_GAP_X);
    const x = blockStartX + (FALLBACK_LAYOUT.SECTION_BLOCK_WIDTH - FALLBACK_LAYOUT.SECTION_BODY_WIDTH) / 2;
    const y = sectionRowOffsets[row];
    const width = FALLBACK_LAYOUT.SECTION_BODY_WIDTH;
    const height = sectionRowHeights[row];

    const secItem = {
      id: `generated-section-${sec.id}`,
      objectType: 'section',
      x,
      y,
      width,
      height,
      rotation: 0,
      label: sec.name,
      color: '#FFA000',
      icon: 'shelves',
      isLocked: true,
      isVisible: true,
      linkedSectionId: sec.id,
      linkedWarehouseLocationId: null,
      linkedLocationZoneId: null,
      linkedProductId: null,
      locationCodeSnapshot: String(sec.number).padStart(2, '0'),
      metadata: {
        sectionId: sec.id,
        sectionNumber: sec.number,
        sectionName: sec.name,
        generatedDefault: false,
        boundingBox: {
          x: blockStartX,
          y: y - FALLBACK_LAYOUT.COMMON_AREA_HEIGHT - 18,
          width: FALLBACK_LAYOUT.SECTION_BLOCK_WIDTH,
          height: height + FALLBACK_LAYOUT.COMMON_AREA_HEIGHT + 18,
        },
      }
    };
    items.push(secItem);
    sectionIdMap.set(sec.id, secItem);

    // Generate section common area item
    const list = commonProductsBySectionId.get(sec.id) || [];
    const sectionNumPad = String(sec.number).padStart(2, '0');
    items.push({
      id: `generated-section-common-${sec.id}`,
      objectType: 'section_common_area',
      x: blockStartX + (FALLBACK_LAYOUT.SECTION_BLOCK_WIDTH - FALLBACK_LAYOUT.COMMON_AREA_WIDTH) / 2,
      y: y - FALLBACK_LAYOUT.COMMON_AREA_HEIGHT - 18,
      width: FALLBACK_LAYOUT.COMMON_AREA_WIDTH,
      height: FALLBACK_LAYOUT.COMMON_AREA_HEIGHT,
      rotation: 0,
      label: sectionCommonAreaLabel(sec.name),
      color: '#FFA000',
      icon: 'layers',
      isLocked: true,
      isVisible: true,
      linkedSectionId: sec.id,
      linkedWarehouseLocationId: null,
      linkedLocationZoneId: null,
      linkedProductId: null,
      locationCodeSnapshot: `R${sectionNumPad}-ORTAK`,
      metadata: {
        commonAreaType: 'section',
        generatedDefault: true,
        sectionId: sec.id,
        sectionName: sec.name,
        commonProductCount: list.length,
        ...(includeProducts ? { products: list } : {})
      }
    });
  });

  // Generate one physical shelf stack per section + side + shelf number.
  shelfGroups.forEach((group) => {
    const secItem = sectionIdMap.get(group.sectionId);
    if (!secItem) return;

    const sectionNumber = secItem.metadata.sectionNumber;
    const baseCode = `R${String(sectionNumber).padStart(2, '0')}-${group.side}-${String(group.shelfNo).padStart(2, '0')}`;
    const levels = Array.from({ length: SECTION_CAPACITY.LEVELS_PER_SHELF }, (_, index) => {
      const levelNo = index + 1;
      const levelProducts = group.levels.get(levelNo) || [];
      return {
        levelNo,
        shelfCode: `${baseCode}-${String(levelNo).padStart(2, '0')}`,
        products: levelProducts.map(toProductMetadata),
        isEmpty: levelProducts.length === 0,
      };
    });
    const productsInStack = levels.flatMap((level) => level.products);
    const x = group.side === 'L'
      ? secItem.x - FALLBACK_LAYOUT.SHELF_SIDE_GAP - FALLBACK_LAYOUT.SHELF_STACK_WIDTH
      : secItem.x + secItem.width + FALLBACK_LAYOUT.SHELF_SIDE_GAP;
    const y = secItem.y + 12
      + (group.shelfNo - 1) * (FALLBACK_LAYOUT.SHELF_STACK_HEIGHT + FALLBACK_LAYOUT.SHELF_STACK_GAP);

    items.push({
      id: `generated-shelf-${group.sectionId}-${group.side}-${group.shelfNo}`,
      objectType: 'shelf',
      x,
      y,
      width: FALLBACK_LAYOUT.SHELF_STACK_WIDTH,
      height: FALLBACK_LAYOUT.SHELF_STACK_HEIGHT,
      rotation: 0,
      label: baseCode,
      color: '#F8FAFC',
      icon: 'crop_free',
      isLocked: true,
      isVisible: true,
      linkedSectionId: group.sectionId,
      linkedWarehouseLocationId: null,
      linkedLocationZoneId: null,
      linkedProductId: productsInStack[0]?.id || null,
      locationCodeSnapshot: baseCode,
      metadata: {
        sectionId: group.sectionId,
        sectionName: secItem.metadata.sectionName,
        shelfSide: group.side,
        shelfNo: group.shelfNo,
        levelCount: levels.length,
        occupiedLevelCount: levels.filter((level) => !level.isEmpty).length,
        levels,
        products: productsInStack,
        isEmpty: productsInStack.length === 0,
        generatedDefault: false,
        collapsedStack: true,
      },
    });
  });

  const reyonBottom = sectionRowOffsets[rowCount - 1] + sectionRowHeights[rowCount - 1];
  const reyonZoneWidth = activeColumns * FALLBACK_LAYOUT.SECTION_BLOCK_WIDTH
    + Math.max(0, activeColumns - 1) * FALLBACK_LAYOUT.SECTION_GAP_X;
  const warehouseStartX = FALLBACK_LAYOUT.START_X
    + reyonZoneWidth
    + FALLBACK_LAYOUT.WAREHOUSE_ZONE_GAP
    + 130;
  const warehouseStartY = FALLBACK_LAYOUT.START_Y - 12;
  const warehouseGroups = new Map();

  for (let rowNo = 1; rowNo <= WAREHOUSE_CAPACITY.ROWS; rowNo += 1) {
    WAREHOUSE_CAPACITY.SIDES.forEach((side) => {
      for (let shelfNo = 1; shelfNo <= WAREHOUSE_CAPACITY.SHELVES_PER_SIDE; shelfNo += 1) {
        warehouseGroups.set(`${rowNo}-${side}-${shelfNo}`, {
          rowNo,
          side,
          shelfNo,
          levels: new Map(),
        });
      }
    });
  }

  whLocations.forEach((location) => {
    const rowNo = Number(location.rowNo);
    const side = String(location.side).toUpperCase();
    const shelfNo = Number(location.shelfNo);
    const levelNo = Number(location.levelNo);
    if (
      rowNo < 1
      || rowNo > WAREHOUSE_CAPACITY.ROWS
      || !WAREHOUSE_CAPACITY.SIDES.includes(side)
      || shelfNo < 1
      || shelfNo > WAREHOUSE_CAPACITY.SHELVES_PER_SIDE
      || levelNo < 1
      || levelNo > WAREHOUSE_CAPACITY.LEVELS_PER_SHELF
    ) return;
    const key = `${rowNo}-${side}-${shelfNo}`;
    const group = warehouseGroups.get(key);
    if (!group) return;
    if (!group.levels.has(levelNo)) group.levels.set(levelNo, []);
    group.levels.get(levelNo).push(location);
  });

  // Generate one physical warehouse stack per row + side + shelf number.
  warehouseGroups.forEach((group) => {
    const baseCode = `D${group.rowNo}-${group.side}-${String(group.shelfNo).padStart(2, '0')}`;
    const levels = Array.from({ length: WAREHOUSE_CAPACITY.LEVELS_PER_SHELF }, (_, index) => {
        const levelNo = index + 1;
        const locations = group.levels.get(levelNo) || [];
        const location = locations[0];
        const levelProducts = location?.productId ? [{
          id: location.productId,
          name: location.productName || '',
          sku: location.sku || '',
          barcode: location.barcode || '',
          warehouseQuantity: location.warehouseStock || 0,
        }] : [];
        return {
          levelNo,
          shelfCode: location?.locationCode || `${baseCode}-${String(levelNo).padStart(2, '0')}`,
          status: location?.status || 'Boş',
          occupancy: Number(location?.occupancy || 0),
          storageType: location?.storageType,
          products: levelProducts,
          isEmpty: levelProducts.length === 0 && Number(location?.occupancy || 0) <= 0,
        };
      });
    const rowX = warehouseStartX + (group.rowNo - 1) * FALLBACK_LAYOUT.WAREHOUSE_ROW_WIDTH;
    const sideX = group.side === 'L'
      ? rowX
      : rowX + FALLBACK_LAYOUT.WAREHOUSE_STACK_WIDTH + 22;
    const y = warehouseStartY + 56
      + (group.shelfNo - 1) * (FALLBACK_LAYOUT.WAREHOUSE_STACK_HEIGHT + FALLBACK_LAYOUT.WAREHOUSE_STACK_GAP);
    const representative = [...group.levels.values()][0]?.[0];

    items.push({
      id: `generated-wh-${group.rowNo}-${group.side}-${group.shelfNo}`,
      objectType: 'warehouse_location',
      x: sideX,
      y,
      width: FALLBACK_LAYOUT.WAREHOUSE_STACK_WIDTH,
      height: FALLBACK_LAYOUT.WAREHOUSE_STACK_HEIGHT,
      rotation: 0,
      label: baseCode,
      color: '#D1FAE5',
      icon: 'warehouse',
      isLocked: true,
      isVisible: true,
      linkedSectionId: null,
      linkedWarehouseLocationId: representative?.id || null,
      linkedLocationZoneId: null,
      linkedProductId: representative?.productId || null,
      locationCodeSnapshot: baseCode,
      metadata: {
        rowNo: group.rowNo,
        side: group.side,
        shelfNo: group.shelfNo,
        levelCount: levels.length,
        occupiedLevelCount: levels.filter((level) => !level.isEmpty).length,
        levels,
        products: levels.flatMap((level) => level.products),
        storageType: representative?.storageType,
        isEmpty: levels.every((level) => level.isEmpty),
        generatedDefault: false,
        collapsedStack: true,
      },
    });
  });

  const maxWarehouseShelfNo = Math.max(
    1,
    ...[...warehouseGroups.values()].map((group) => group.shelfNo)
  );
  const warehouseZoneHeight = 90
    + maxWarehouseShelfNo * (FALLBACK_LAYOUT.WAREHOUSE_STACK_HEIGHT + FALLBACK_LAYOUT.WAREHOUSE_STACK_GAP);

  items.push({
    id: 'generated-aisle-warehouse',
    objectType: 'aisle',
    x: warehouseStartX - 158,
    y: warehouseStartY,
    width: Math.max(
      3 * FALLBACK_LAYOUT.WAREHOUSE_ROW_WIDTH + 140,
      FALLBACK_LAYOUT.WAREHOUSE_ROW_WIDTH
    ),
    height: warehouseZoneHeight,
    rotation: 0,
    label: 'Depo Operasyon Alanı',
    color: '#E2E8F0',
    icon: 'view_week',
    isLocked: true,
    isVisible: true,
    linkedSectionId: null,
    linkedWarehouseLocationId: null,
    linkedLocationZoneId: null,
    linkedProductId: null,
    locationCodeSnapshot: null,
    metadata: { generatedDefault: true, zoneType: 'warehouse' },
  });

  // Generate warehouse common area item
  items.push({
    id: 'generated-warehouse-common',
    objectType: 'warehouse_common_area',
    x: warehouseStartX - 130,
    y: warehouseStartY + 56,
    width: 104,
    height: 92,
    rotation: 0,
    label: 'Ortak Depo Alanı',
    color: '#78909C',
    icon: 'warehouse',
    isLocked: true,
    isVisible: true,
    linkedSectionId: null,
    linkedWarehouseLocationId: null,
    linkedLocationZoneId: null,
    linkedProductId: null,
    locationCodeSnapshot: 'DEPO-ORTAK',
    metadata: {
      commonAreaType: 'warehouse',
      generatedDefault: true,
      commonProductCount: commonWarehouseProducts.length,
      ...(includeProducts ? { products: commonWarehouseProducts } : {})
    }
  });

  // Generate warehouse door
  items.push({
    id: 'generated-door-warehouse',
    objectType: 'warehouse_door',
    x: warehouseStartX - 158,
    y: warehouseStartY + warehouseZoneHeight / 2 - 27,
    width: 58,
    height: 54,
    rotation: 0,
    label: 'Depo Kapısı',
    color: '#8D6E63',
    icon: 'door_front',
    isLocked: true,
    isVisible: true,
    linkedSectionId: null,
    linkedWarehouseLocationId: null,
    linkedLocationZoneId: null,
    linkedProductId: null,
    locationCodeSnapshot: null,
    metadata: { generatedDefault: true }
  });

  // Keep checkout/service traffic in a dedicated zone below warehouse operations.
  const bottomZoneStartY = reyonBottom + FALLBACK_LAYOUT.CASHIER_ZONE_GAP;
  const centerX = Math.max(480, FALLBACK_LAYOUT.START_X + reyonZoneWidth / 2);

  // Generate entrance
  const defaultEntrance = {
    id: 'generated-entrance-main',
    objectType: 'entrance',
    x: centerX - 30,
    y: 20,
    width: 60,
    height: 40,
    rotation: 0,
    label: 'Giriş',
    color: '#4CAF50',
    icon: 'login',
    isLocked: true,
    isVisible: true,
    linkedSectionId: null,
    linkedWarehouseLocationId: null,
    linkedLocationZoneId: null,
    linkedProductId: null,
    locationCodeSnapshot: null,
    metadata: { generatedDefault: true }
  };
  items.push(defaultEntrance);

  // Generate exit
  const defaultExit = {
    id: 'generated-exit-main',
    objectType: 'exit',
    x: centerX - 30,
    y: bottomZoneStartY + 70,
    width: 60,
    height: 40,
    rotation: 0,
    label: 'Çıkış',
    color: '#F44336',
    icon: 'logout',
    isLocked: true,
    isVisible: true,
    linkedSectionId: null,
    linkedWarehouseLocationId: null,
    linkedLocationZoneId: null,
    linkedProductId: null,
    locationCodeSnapshot: null,
    metadata: { generatedDefault: true }
  };
  items.push(defaultExit);

  // Generate cashiers
  for (let i = 0; i < 4; i++) {
    items.push({
      id: `generated-cashier-B${i + 1}`,
      objectType: 'cashier',
      x: centerX - 362 + (i * 82),
      y: bottomZoneStartY,
      width: 60,
      height: 34,
      rotation: 0,
      label: `Kasa B${i + 1}`,
      color: '#2196F3',
      icon: 'point_of_sale',
      isLocked: true,
      isVisible: true,
      linkedSectionId: null,
      linkedWarehouseLocationId: null,
      linkedLocationZoneId: null,
      linkedProductId: null,
      locationCodeSnapshot: null,
      metadata: { generatedDefault: true }
    });
  }
  for (let i = 0; i < 4; i++) {
    items.push({
      id: `generated-cashier-B${i + 5}`,
      objectType: 'cashier',
      x: centerX + 34 + (i * 82),
      y: bottomZoneStartY,
      width: 60,
      height: 34,
      rotation: 0,
      label: `Kasa B${i + 5}`,
      color: '#2196F3',
      icon: 'point_of_sale',
      isLocked: true,
      isVisible: true,
      linkedSectionId: null,
      linkedWarehouseLocationId: null,
      linkedLocationZoneId: null,
      linkedProductId: null,
      locationCodeSnapshot: null,
      metadata: { generatedDefault: true }
    });
  }

  // Generate main aisle (main corridor)
  items.push({
    id: 'generated-aisle-main',
    objectType: 'aisle',
    x: FALLBACK_LAYOUT.START_X - 36,
    y: FALLBACK_LAYOUT.START_Y - 70,
    width: reyonZoneWidth + 72,
    height: reyonBottom - FALLBACK_LAYOUT.START_Y + 110,
    rotation: 0,
    label: 'Reyon Koridorları',
    color: '#ECEFF1',
    icon: 'view_week',
    isLocked: true,
    isVisible: true,
    linkedSectionId: null,
    linkedWarehouseLocationId: null,
    linkedLocationZoneId: null,
    linkedProductId: null,
    locationCodeSnapshot: null,
    metadata: { generatedDefault: true }
  });

  // Generate service area (Müşteri Hizmetleri)
  items.push({
    id: 'generated-service-area',
    objectType: 'service_area',
    x: FALLBACK_LAYOUT.START_X,
    y: bottomZoneStartY + 10,
    width: 150,
    height: 80,
    rotation: 0,
    label: 'Müşteri Hizmetleri',
    color: '#9C27B0',
    icon: 'support_agent',
    isLocked: true,
    isVisible: true,
    linkedSectionId: null,
    linkedWarehouseLocationId: null,
    linkedLocationZoneId: null,
    linkedProductId: null,
    locationCodeSnapshot: null,
    metadata: { generatedDefault: true }
  });

  // Generate empty area (Danışma / Boş Alan)
  items.push({
    id: 'generated-empty-area',
    objectType: 'empty_area',
    x: FALLBACK_LAYOUT.START_X,
    y: 20,
    width: 200,
    height: 80,
    rotation: 0,
    label: 'Danışma / Boş Alan',
    color: '#CFD8DC',
    icon: 'crop_free',
    isLocked: true,
    isVisible: true,
    linkedSectionId: null,
    linkedWarehouseLocationId: null,
    linkedLocationZoneId: null,
    linkedProductId: null,
    locationCodeSnapshot: null,
    metadata: { generatedDefault: true }
  });

  // Sort items according to SVG render order to ensure proper layering in the frontend
  items.sort((a, b) => getSortOrder(a.objectType) - getSortOrder(b.objectType));

  const isWarehouseItem = (item) => (
    item.objectType === 'warehouse_location'
    || item.objectType === 'warehouse_common_area'
    || item.objectType === 'warehouse_door'
    || item.metadata?.zoneType === 'warehouse'
  );
  const getItemsBoundary = (boundaryItems, label, type) => {
    const minX = Math.min(...boundaryItems.map((item) => item.x));
    const minY = Math.min(...boundaryItems.map((item) => item.y));
    const maxX = Math.max(...boundaryItems.map((item) => item.x + item.width));
    const maxY = Math.max(...boundaryItems.map((item) => item.y + item.height));
    return {
      x: minX - FALLBACK_LAYOUT.BOUNDARY_PADDING,
      y: minY - FALLBACK_LAYOUT.BOUNDARY_PADDING,
      width: maxX - minX + FALLBACK_LAYOUT.BOUNDARY_PADDING * 2,
      height: maxY - minY + FALLBACK_LAYOUT.BOUNDARY_PADDING * 2,
      label,
      type,
    };
  };

  const storeBoundary = getItemsBoundary(
    items.filter((item) => !isWarehouseItem(item)),
    'Mağaza Sınırı',
    'store'
  );
  const warehouseBoundary = getItemsBoundary(
    items.filter(isWarehouseItem),
    'Depo Sınırı',
    'warehouse'
  );
  const boundaries = [storeBoundary, warehouseBoundary];
  const overallMinX = Math.min(...boundaries.map((item) => item.x));
  const overallMinY = Math.min(...boundaries.map((item) => item.y));
  const overallMaxX = Math.max(...boundaries.map((item) => item.x + item.width));
  const overallMaxY = Math.max(...boundaries.map((item) => item.y + item.height));
  const canvasWidth = overallMaxX - Math.min(0, overallMinX) + FALLBACK_LAYOUT.BOUNDARY_PADDING;
  const canvasHeight = overallMaxY - Math.min(0, overallMinY) + FALLBACK_LAYOUT.BOUNDARY_PADDING;
  const gridSize = 40;
  const gridWidth = Math.floor(canvasWidth / gridSize);
  const gridHeight = Math.floor(canvasHeight / gridSize);

  return {
    id: 'generated',
    name: 'Varsayılan Mağaza Planı',
    status: 'generated',
    source: 'generated',
    storeId: storeId || null,
    version: 0,
    canvasWidth,
    canvasHeight,
    gridWidth,
    gridHeight,
    gridSize,
    metadata: {
      isGenerated: true,
      boundary: storeBoundary,
      boundaries,
    },
    items
  };
}

export const storeLayoutService = {
  /**
   * Tüm layout'ları listele (opsiyonel status filtre).
   */
  async listLayouts(query = {}) {
    const where = {};
    if (query.status && VALID_STATUSES.has(query.status)) {
      where.status = query.status;
    }
    if (query.storeId) {
      where.storeId = query.storeId;
    }
    const layouts = await storeLayoutRepo.findMany(where);
    return layouts;
  },

  /**
   * Tek layout + items getir.
   */
  async getLayoutById(id, options = {}) {
    const layout = await storeLayoutRepo.findById(id);
    if (!layout) {
      throw new AppError(404, 'Layout bulunamadı');
    }
    return await formatLayout(layout, layout.status === 'published' ? 'published' : 'draft', options);
  },

  /**
   * Aktif / published layout getir. Yoksa fallback üret.
   */
  async getActiveLayout(storeId = null, options = {}) {
    const prisma = await getPrisma();
    const where = { status: 'published' };
    if (storeId) {
      where.storeId = storeId;
    }
    const dbLayout = await prisma.storeLayout.findFirst({
      where,
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });

    if (dbLayout) {
      const formatted = await formatLayout(dbLayout, 'published', options);
      const hydrated = await hydrateLayoutWithRuntimeInventory(formatted, storeId);
      return hydrated;
    }

    return generateFallbackLayout(storeId, options);
  },

  /**
   * Yeni draft layout oluştur.
   */
  async createLayout(data, user) {
    const id = uuidv4();
    const layout = await storeLayoutRepo.create({
      id,
      name: data.name || 'Yeni Plan',
      storeId: data.storeId || null,
      status: 'draft',
      version: 1,
      canvasWidth: data.canvasWidth || 1200,
      canvasHeight: data.canvasHeight || 800,
      metadata: data.metadata || null,
      createdBy: user?.id || null,
    });
    return layout;
  },

  /**
   * Draft layout güncelle. Published layout düzenlenemez.
   */
  async updateLayout(id, data, user) {
    const existing = await storeLayoutRepo.findById(id);
    if (!existing) {
      throw new AppError(404, 'Layout bulunamadı');
    }
    if (existing.status !== 'draft') {
      throw new AppError(400, 'Sadece draft durumundaki layout düzenlenebilir');
    }

    const updateData = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.storeId !== undefined) updateData.storeId = data.storeId;
    if (data.canvasWidth !== undefined) updateData.canvasWidth = data.canvasWidth;
    if (data.canvasHeight !== undefined) updateData.canvasHeight = data.canvasHeight;
    if (data.metadata !== undefined) updateData.metadata = data.metadata;

    const updated = await storeLayoutRepo.update(id, updateData);
    return updated;
  },

  /**
   * Draft layout sil. Published/archived silinemez.
   */
  async deleteLayout(id) {
    const existing = await storeLayoutRepo.findById(id);
    if (!existing) {
      throw new AppError(404, 'Layout bulunamadı');
    }
    if (existing.status !== 'draft') {
      throw new AppError(400, 'Sadece draft durumundaki layout silinebilir');
    }
    await storeLayoutRepo.remove(id);
    return { message: 'Layout silindi' };
  },

  /**
   * Draft → published yap.
   * Transaction:
   *   1. Aynı tenant+store'daki mevcut published → archived
   *   2. Bu draft → published, version++, publishedAt/publishedBy set
   */
  async publishLayout(id, user) {
    const existing = await storeLayoutRepo.findById(id);
    if (!existing) {
      throw new AppError(404, 'Layout bulunamadı');
    }
    if (existing.status !== 'draft') {
      throw new AppError(400, 'Sadece draft durumundaki layout yayınlanabilir');
    }

    const prisma = await getPrisma();
    const result = await prisma.$transaction(async (tx) => {
      await tx.storeLayout.updateMany({
        where: {
          storeId: existing.storeId,
          status: 'published',
          id: { not: id },
        },
        data: { status: 'archived' },
      });

      const published = await tx.storeLayout.update({
        where: { id },
        data: {
          status: 'published',
          version: existing.version + 1,
          publishedAt: new Date(),
          publishedBy: user?.id || null,
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });

      return published;
    });

    return await formatLayout(result, 'published');
  },

  /**
   * Mevcut layout'tan yeni draft kopyası oluştur.
   */
  async duplicateLayout(id, user) {
    const existing = await storeLayoutRepo.findById(id);
    if (!existing) {
      throw new AppError(404, 'Layout bulunamadı');
    }

    const newLayoutId = uuidv4();
    const prisma = await getPrisma();

    const result = await prisma.$transaction(async (tx) => {
      const newLayout = await tx.storeLayout.create({
        data: {
          id: newLayoutId,
          name: `${existing.name} (Kopya)`,
          storeId: existing.storeId,
          status: 'draft',
          version: 1,
          canvasWidth: existing.canvasWidth,
          canvasHeight: existing.canvasHeight,
          metadata: existing.metadata,
          createdBy: user?.id || null,
        },
      });

      if (existing.items && existing.items.length > 0) {
        const newItems = existing.items.map((item) => ({
          id: uuidv4(),
          layoutId: newLayoutId,
          objectType: item.objectType,
          label: item.label,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          rotation: item.rotation,
          zIndex: item.zIndex,
          sectionId: item.sectionId,
          properties: item.properties,
          sortOrder: item.sortOrder,
        }));

        await tx.storeLayoutItem.createMany({ data: newItems });
      }

      return tx.storeLayout.findFirst({
        where: { id: newLayoutId },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    return await formatLayout(result, 'draft');
  },

  /**
   * Layout item'larını toplu güncelle (replace-all semantics).
   * Sadece draft layout'lar için çalışır.
   */
  async upsertItems(layoutId, items, user) {
    const existing = await storeLayoutRepo.findById(layoutId);
    if (!existing) {
      throw new AppError(404, 'Layout bulunamadı');
    }
    if (existing.status !== 'draft') {
      throw new AppError(400, 'Sadece draft durumundaki layout\'un öğeleri düzenlenebilir');
    }

    validateItems(items);

    const prisma = await getPrisma();
    const result = await prisma.$transaction(async (tx) => {
      // Find any incoming item IDs that already exist in other layouts to prevent Unique Constraint Violation
      const incomingIds = items.map((item) => String(item.id || '').trim()).filter(Boolean);
      const existingDbItems = await tx.storeLayoutItem.findMany({
        where: {
          id: { in: incomingIds },
          layoutId: { not: layoutId },
        },
        select: { id: true },
      });
      const idsToRegenerate = new Set(existingDbItems.map((item) => item.id));

      await tx.storeLayoutItem.deleteMany({ where: { layoutId } });

      const assignedIds = new Set();
      const newItems = items.map((item, index) => {
        const nextId = shouldRegenerateLayoutItemId(item.id) || idsToRegenerate.has(String(item.id || '').trim()) || assignedIds.has(String(item.id || '').trim())
          ? uuidv4()
          : String(item.id).trim();
        assignedIds.add(nextId);
        return {
          id: nextId,
          layoutId,
          objectType: item.objectType,
          label: item.label || null,
          x: Math.round(Number(item.x ?? 0)),
          y: Math.round(Number(item.y ?? 0)),
          width: Math.round(Number(item.width ?? 40)),
          height: Math.round(Number(item.height ?? 40)),
          rotation: Math.round(Number(item.rotation ?? 0)),
          zIndex: Math.round(Number(item.zIndex ?? 0)),
          sectionId: item.sectionId || item.properties?.linkedSectionId || item.properties?.metadata?.sectionId || null,
          properties: {
            ...(item.properties || {}),
            metadata: sanitizeStoredMetadata(item.properties?.metadata || {}, { includeProducts: false }),
          },
          sortOrder: Math.round(Number(item.sortOrder ?? index)),
        };
      });

      if (newItems.length > 0) {
        await tx.storeLayoutItem.createMany({ data: newItems });
      }

      return tx.storeLayout.findFirst({
        where: { id: layoutId },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    return await formatLayout(result, 'draft');
  },

  /**
   * Draft oluşturma için generated fallback kaynak olarak kullanılabilmesi
   */
  async createDraftFromGeneratedLayout(storeId, user) {
    const fallback = await generateFallbackLayout(storeId);
    const newLayoutId = uuidv4();
    const prisma = await getPrisma();

    const result = await prisma.$transaction(async (tx) => {
      const newLayout = await tx.storeLayout.create({
        data: {
          id: newLayoutId,
          name: 'Varsayılan Şablon Taslağı',
          storeId,
          status: 'draft',
          version: 1,
          canvasWidth: fallback.canvasWidth,
          canvasHeight: fallback.canvasHeight,
          metadata: {
            createdFromGenerated: true,
            boundary: fallback.metadata?.boundary || null,
            boundaries: fallback.metadata?.boundaries || null,
          },
          createdBy: user?.id || null,
        },
      });

      const newItems = fallback.items.map((item, index) => ({
        id: uuidv4(),
        layoutId: newLayoutId,
        objectType: item.objectType,
        label: item.label,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
        zIndex: 0,
        sectionId: item.linkedSectionId || null,
        properties: {
          color: item.color,
          icon: item.icon,
          isLocked: item.isLocked,
          isVisible: item.isVisible,
          linkedWarehouseLocationId: item.linkedWarehouseLocationId || null,
          linkedLocationZoneId: item.linkedLocationZoneId || null,
          linkedProductId: item.linkedProductId || null,
          locationCodeSnapshot: item.locationCodeSnapshot || null,
          metadata: item.metadata
        },
        sortOrder: index,
      }));

      if (newItems.length > 0) {
        await tx.storeLayoutItem.createMany({ data: newItems });
      }

      return tx.storeLayout.findFirst({
        where: { id: newLayoutId },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    return await formatLayout(result, 'draft');
  },
};
