import { api } from './api.js';

const numberOr = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const TRANSIENT_ID_PREFIXES = ['local-', 'generated-', 'plan-stack-'];
const PERSISTABLE_OBJECT_TYPES = new Set([
  'section',
  'shelf',
  'shelf_stack',
  'warehouse_location',
  'warehouse_stack',
  'section_common_area',
  'warehouse_common_area',
  'cashier',
  'entrance',
  'exit',
  'warehouse_door',
  'service_area',
  'aisle',
  'empty_area',
  'zone',
  'custom',
  'cold_cabinet',
  'campaign_stand',
]);

const buildQuery = (params = {}) => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : '';
};

const isTransientLayoutItemId = (value) => {
  const id = String(value || '').trim();
  return !id || TRANSIENT_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
};

const sanitizePersistedMetadata = (metadata = {}) => {
  if (!metadata || typeof metadata !== 'object') return null;

  const nextMetadata = { ...metadata };
  delete nextMetadata.products;
  delete nextMetadata.levelProducts;
  delete nextMetadata.computedBounds;
  delete nextMetadata.labelCache;
  delete nextMetadata.visualProjectionOffsetX;
  delete nextMetadata.sourceItemIds;
  delete nextMetadata.boundingBox;
  delete nextMetadata.hovered;
  delete nextMetadata.selected;

  if (Array.isArray(nextMetadata.levels)) {
    nextMetadata.levels = nextMetadata.levels.map((level) => {
      const nextLevel = { ...level };
      delete nextLevel.products;
      return nextLevel;
    });
  }

  if (Object.keys(nextMetadata).length === 0) return null;
  return nextMetadata;
};

export const toPersistableLayoutItems = (items = []) => {
  const usedIds = new Set();

  return items.reduce((result, item, index) => {
    if (!item || !PERSISTABLE_OBJECT_TYPES.has(item.objectType)) {
      return result;
    }

    const metadata = sanitizePersistedMetadata(item.metadata || item.properties?.metadata || {});
    const linkedSectionId = item.sectionId || item.linkedSectionId || item.properties?.linkedSectionId || metadata?.sectionId || null;
    const linkedWarehouseLocationId = item.linkedWarehouseLocationId || item.properties?.linkedWarehouseLocationId || null;
    const locationCodeSnapshot = item.locationCodeSnapshot || item.properties?.locationCodeSnapshot || null;
    const candidateId = String(item.id || '').trim();
    const shouldReuseId = candidateId && !isTransientLayoutItemId(candidateId) && !usedIds.has(candidateId);
    const persistedId = shouldReuseId ? candidateId : undefined;

    if (persistedId) {
      usedIds.add(persistedId);
    }

    result.push({
      id: persistedId,
      objectType: item.objectType,
      label: String(item.label || '').trim() || null,
      x: Math.round(numberOr(item.x, 0)),
      y: Math.round(numberOr(item.y, 0)),
      width: Math.max(5, Math.round(numberOr(item.width, 40))),
      height: Math.max(5, Math.round(numberOr(item.height, 40))),
      rotation: [0, 90, 180, 270].includes(Number(item.rotation)) ? Number(item.rotation) : 0,
      sectionId: linkedSectionId,
      properties: {
        color: item.color || item.properties?.color || '',
        isLocked: Boolean(item.isLocked ?? item.properties?.isLocked ?? metadata?.userLocked),
        userLocked: Boolean(item.isLocked ?? item.properties?.isLocked ?? metadata?.userLocked),
        isVisible: item.isVisible !== false && item.properties?.isVisible !== false,
        linkedSectionId,
        linkedWarehouseLocationId,
        linkedLocationZoneId: item.linkedLocationZoneId || item.properties?.linkedLocationZoneId || null,
        linkedProductId: item.linkedProductId || item.properties?.linkedProductId || null,
        locationCodeSnapshot,
        metadata,
      },
      sortOrder: index,
    });
    return result;
  }, []);
};

const getStackKey = (item) => {
  if (item?.metadata?.collapsedStack) return null;
  if (item?.objectType === 'shelf') {
    const sectionId = item.linkedSectionId || item.metadata?.sectionId;
    const side = item.metadata?.shelfSide;
    const shelfNo = item.metadata?.shelfNo;
    if (sectionId && side && shelfNo != null) return `shelf:${sectionId}:${side}:${shelfNo}`;
  }
  if (item?.objectType === 'warehouse_location') {
    const rowNo = item.metadata?.rowNo;
    const side = item.metadata?.side;
    const shelfNo = item.metadata?.shelfNo;
    if (rowNo != null && side && shelfNo != null) return `warehouse:${rowNo}:${side}:${shelfNo}`;
  }
  return null;
};

const getLevelFromItem = (item) => {
  if (Array.isArray(item.metadata?.levels) && item.metadata.levels.length) {
    return item.metadata.levels.map((level) => ({
      ...level,
      products: Array.isArray(level.products)
        ? level.products
        : (level.product ? [level.product] : []),
    }));
  }
  const levelNo = item.metadata?.shelfLevel ?? item.metadata?.levelNo;
  if (levelNo == null) return [];
  return [{
    levelNo: numberOr(levelNo),
    shelfCode: item.locationCodeSnapshot || item.label || '',
    status: item.metadata?.status,
    occupancy: item.metadata?.occupancy,
    storageType: item.metadata?.storageType,
    products: item.metadata?.products || [],
  }];
};

const completeStackLevels = (item) => {
  const isShelf = item?.objectType === 'shelf';
  const isWarehouse = item?.objectType === 'warehouse_location';
  if (!isShelf && !isWarehouse) return item;

  const expectedLevelCount = isWarehouse ? 10 : 5;
  const sourceLevels = Array.isArray(item.metadata?.levels) ? item.metadata.levels : [];
  const levelsByNumber = new Map(
    sourceLevels.map((level) => [numberOr(level.levelNo), level])
  );
  const baseCode = String(item.locationCodeSnapshot || item.label || '');
  const levels = Array.from({ length: expectedLevelCount }, (_, index) => {
    const levelNo = index + 1;
    const existing = levelsByNumber.get(levelNo);
    const products = existing?.products || [];
    const occupancy = numberOr(existing?.occupancy, 0);
    return {
      ...existing,
      levelNo,
      shelfCode: existing?.shelfCode || `${baseCode}-${String(levelNo).padStart(2, '0')}`,
      status: existing?.status || (isWarehouse ? 'Boş' : undefined),
      occupancy,
      products,
      isEmpty: products.length === 0 && occupancy <= 0,
    };
  });
  const products = levels.flatMap((level) => level.products);

  return {
    ...item,
    metadata: {
      ...item.metadata,
      levelCount: expectedLevelCount,
      occupiedLevelCount: levels.filter((level) => !level.isEmpty).length,
      levels,
      products,
      isEmpty: levels.every((level) => level.isEmpty),
    },
  };
};

export const isLayoutItemUserLocked = (item) => Boolean(
  item?.properties?.userLocked ?? item?.metadata?.userLocked
);

export const normalizeLayoutItemForEditor = (item = {}) => {
  const userLocked = isLayoutItemUserLocked(item);
  const metadata = item.metadata || item.properties?.metadata || {};
  return {
    ...item,
    metadata,
    isLocked: userLocked,
    properties: {
      ...(item.properties || {}),
      isLocked: userLocked,
      userLocked,
      metadata,
    },
  };
};

export const resolveStackLevels = (item) => {
  if (!item) return [];
  const levels = Array.isArray(item.metadata?.levels) ? item.metadata.levels : [];
  if (!levels.length) return [];
  return [...levels]
    .sort((a, b) => numberOr(a.levelNo) - numberOr(b.levelNo))
    .map((level, index) => {
      const products = Array.isArray(level.products)
        ? level.products
        : (level.product ? [level.product] : []);
      return {
        ...level,
        levelNo: level.levelNo ?? index + 1,
        products,
      };
    });
};

export const collectStackProducts = (item) => {
  const fromLevels = resolveStackLevels(item).flatMap((level) => level.products || []);
  if (fromLevels.length) return fromLevels;
  return Array.isArray(item?.metadata?.products) ? item.metadata.products : [];
};

export const collapseLayoutItemsForPlan = (items = []) => {
  const groups = new Map();
  const output = [];

  items.forEach((item) => {
    const key = getStackKey(item);
    if (!key) {
      output.push(item);
      return;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  groups.forEach((group, key) => {
    const base = group[0];
    const levels = group.flatMap(getLevelFromItem);
    const levelsByNumber = new Map();
    levels.forEach((level) => {
      const levelNo = numberOr(level.levelNo);
      const existing = levelsByNumber.get(levelNo);
      const mergedProducts = [
        ...(existing?.products || []),
        ...(Array.isArray(level.products) ? level.products : []),
      ];
      levelsByNumber.set(levelNo, {
        ...(existing || {}),
        ...level,
        levelNo,
        products: mergedProducts,
      });
    });
    const uniqueLevels = [...levelsByNumber.values()].sort((a, b) => numberOr(a.levelNo) - numberOr(b.levelNo));
    const products = uniqueLevels.flatMap((level) => level.products || []);
    const isWarehouse = base.objectType === 'warehouse_location';
    const minX = Math.min(...group.map((item) => numberOr(item.x)));
    const minY = Math.min(...group.map((item) => numberOr(item.y)));
    const width = Math.max(isWarehouse ? 72 : 68, ...group.map((item) => numberOr(item.width, 0)));
    const height = Math.max(20, ...group.map((item) => numberOr(item.height, 0)));
    const baseCode = isWarehouse
      ? `D${base.metadata?.rowNo}-${base.metadata?.side}-${String(base.metadata?.shelfNo).padStart(2, '0')}`
      : String(base.locationCodeSnapshot || base.label || '').replace(/-\d{2}$/, '');

    output.push({
      ...base,
      id: `plan-stack-${key}`,
      x: minX,
      y: minY,
      width,
      height,
      label: baseCode,
      locationCodeSnapshot: baseCode,
      metadata: {
        ...base.metadata,
        levelCount: uniqueLevels.length,
        levels: uniqueLevels,
        products,
        collapsedStack: true,
        sourceItemIds: group.map((item) => item.id),
      },
    });
  });

  const isWarehouseItem = (item) => (
    item.objectType === 'warehouse_location'
    || item.objectType === 'warehouse_common_area'
    || item.objectType === 'warehouse_door'
    || item.metadata?.zoneType === 'warehouse'
  );
  const completedOutput = output.map(completeStackLevels);
  const warehouseItems = completedOutput.filter(isWarehouseItem);
  const storeItems = completedOutput.filter((item) => !isWarehouseItem(item));
  if (!warehouseItems.length || !storeItems.length) return completedOutput;

  const storeMaxX = Math.max(...storeItems.map((item) => numberOr(item.x) + numberOr(item.width)));
  const warehouseMinX = Math.min(...warehouseItems.map((item) => numberOr(item.x)));
  const minimumZoneGap = 150;
  const offsetX = Math.max(0, storeMaxX + minimumZoneGap - warehouseMinX);
  if (!offsetX) return completedOutput;

  return completedOutput.map((item) => {
    if (!isWarehouseItem(item)) return item;
    return {
      ...item,
      x: numberOr(item.x) + offsetX,
      metadata: {
        ...item.metadata,
        visualProjectionOffsetX: offsetX,
      },
    };
  });
};

export const resolveLayoutBoundary = (layout, items = []) => {
  const stored = layout?.metadata?.boundary;
  if (stored && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(stored[key])))) {
    return {
      x: Number(stored.x),
      y: Number(stored.y),
      width: Number(stored.width),
      height: Number(stored.height),
    };
  }
  if (!items.length) return { x: 24, y: 24, width: 1152, height: 752 };
  const padding = 42;
  const minX = Math.min(...items.map((item) => numberOr(item.x)));
  const minY = Math.min(...items.map((item) => numberOr(item.y)));
  const maxX = Math.max(...items.map((item) => numberOr(item.x) + numberOr(item.width)));
  const maxY = Math.max(...items.map((item) => numberOr(item.y) + numberOr(item.height)));
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
};

export const resolveLayoutBoundaries = (layout, items = []) => {
  const stored = layout?.metadata?.boundaries;
  if (Array.isArray(stored) && stored.length) {
    return stored
      .filter((boundary) => ['x', 'y', 'width', 'height'].every(
        (key) => Number.isFinite(Number(boundary?.[key]))
      ))
      .map((boundary, index) => ({
        x: Number(boundary.x),
        y: Number(boundary.y),
        width: Number(boundary.width),
        height: Number(boundary.height),
        label: boundary.label || (index === 0 ? 'Mağaza Sınırı' : 'Alan Sınırı'),
        type: boundary.type || (index === 0 ? 'store' : 'secondary'),
      }));
  }
  const warehouseItems = items.filter((item) => (
    item.objectType === 'warehouse_location'
    || item.objectType === 'warehouse_common_area'
    || item.objectType === 'warehouse_door'
    || item.metadata?.zoneType === 'warehouse'
  ));
  const storeItems = items.filter((item) => !warehouseItems.includes(item));
  if (warehouseItems.length && storeItems.length) {
    return [
      {
        ...resolveLayoutBoundary(null, storeItems),
        label: 'Mağaza Sınırı',
        type: 'store',
      },
      {
        ...resolveLayoutBoundary(null, warehouseItems),
        label: 'Depo Sınırı',
        type: 'warehouse',
      },
    ];
  }
  return [{
    ...resolveLayoutBoundary(layout, items),
    label: 'Mağaza Sınırı',
    type: 'store',
  }];
};

export const locationLayoutService = {
  list: (params = {}) => {
    return api.get(`/location-layouts${buildQuery(params)}`);
  },

  getById: (id, params = {}) => api.get(`/location-layouts/${id}${buildQuery(params)}`),

  getPublishedLayout: (params = {}) => {
    const queryParams = typeof params === 'string' ? { storeId: params } : params;
    return api.get(`/location-layouts/active${buildQuery(queryParams)}`);
  },

  create: (payload) => api.post('/location-layouts', payload),

  update: (id, payload) => api.put(`/location-layouts/${id}`, payload),

  remove: (id) => api.delete(`/location-layouts/${id}`),

  publish: (id) => api.post(`/location-layouts/${id}/publish`),

  duplicate: (id) => api.post(`/location-layouts/${id}/duplicate`),

  upsertItems: (id, items) => api.put(`/location-layouts/${id}/items`, { items: toPersistableLayoutItems(items) }),
};
