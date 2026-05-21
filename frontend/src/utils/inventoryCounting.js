const COUNT_ARCHIVE_STORAGE_KEY = 'shelfio.inventory.countArchive.v1';
const DEMO_MAX_AGE_DAYS = 45;

const hasWindow = () => typeof window !== 'undefined' && Boolean(window.localStorage);

export const isDemoInventoryCountingEnabled = () => {
  const env = import.meta.env || {};
  return env.DEV === true && String(env.VITE_ENABLE_DEMO_COUNTING || '').toLowerCase() === 'true';
};

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeText = (value, fallback = '-') => {
  const text = String(value || '').trim();
  return text || fallback;
};

const hashSeed = (value) => {
  const text = String(value || '').trim() || 'seed';
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const seededRatio = (seed, offset = 0) => {
  const source = Math.sin((seed + 1) * 12.9898 + offset * 78.233) * 43758.5453;
  return source - Math.floor(source);
};

const resolveProductIdentity = (product = {}) => {
  const productId = String(product.id || product.productId || '').trim();
  const productName = normalizeText(product.name || product.productName, 'Ürün');
  const sku = normalizeText(product.sku);
  const barcode = normalizeText(product.barcode);
  return { productId, productName, sku, barcode };
};

const resolveProductSystemStock = (product = {}) => {
  return Math.max(
    0,
    toFiniteNumber(
      product.totalStockResolved
      ?? product.totalStock
      ?? product.currentStock
      ?? product.stockSummary?.totalStock
      ?? product.quantity
      ?? (toFiniteNumber(product.warehouseStock, 0) + toFiniteNumber(product.shelfStock, 0)),
      0
    )
  );
};

const normalizeArchiveRecord = (record = {}) => {
  const systemStock = Math.max(0, toFiniteNumber(record.systemStock, 0));
  const physicalCount = Math.max(0, toFiniteNumber(record.physicalCount, systemStock));
  const difference = Number.isFinite(Number(record.difference))
    ? Number(record.difference)
    : Number((physicalCount - systemStock).toFixed(2));
  const countedAt = String(record.countedAt || record.lastCountedAt || '').trim();
  return {
    id: normalizeText(record.id, `count-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    productId: normalizeText(record.productId, ''),
    productName: normalizeText(record.productName, 'Ürün'),
    sku: normalizeText(record.sku),
    barcode: normalizeText(record.barcode),
    systemStock,
    physicalCount,
    difference,
    actorName: normalizeText(record.actorName || record.userName || record.createdBy || 'Sistem'),
    resultCode: normalizeText(record.resultCode || record.status || 'matched'),
    resultLabel: normalizeText(record.resultLabel || record.outcome || 'Eşleşti'),
    countedAt,
    source: normalizeText(record.source || 'manual'),
  };
};

export const readInventoryCountArchive = () => {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(COUNT_ARCHIVE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeArchiveRecord) : [];
  } catch {
    return [];
  }
};

export const writeInventoryCountArchive = (records = []) => {
  if (!hasWindow()) return;
  try {
    const normalized = Array.isArray(records) ? records.map(normalizeArchiveRecord) : [];
    window.localStorage.setItem(COUNT_ARCHIVE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // no-op
  }
};

export const appendInventoryCountArchiveRecord = (record) => {
  const normalizedRecord = normalizeArchiveRecord(record);
  const current = readInventoryCountArchive();
  writeInventoryCountArchive([normalizedRecord, ...current]);
  return normalizedRecord;
};

export const createInventoryCountRecord = ({
  product,
  systemStock,
  physicalCount,
  actorName = 'Sistem',
  countedAt = new Date().toISOString(),
  resultCode = 'matched',
  resultLabel = 'Eşleşti',
  source = 'manual',
} = {}) => {
  const identity = resolveProductIdentity(product);
  const normalizedSystemStock = Math.max(0, toFiniteNumber(systemStock, resolveProductSystemStock(product)));
  const normalizedPhysicalCount = Math.max(0, toFiniteNumber(physicalCount, normalizedSystemStock));
  return normalizeArchiveRecord({
    id: `count-${identity.productId || 'product'}-${Date.parse(countedAt) || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...identity,
    systemStock: normalizedSystemStock,
    physicalCount: normalizedPhysicalCount,
    difference: Number((normalizedPhysicalCount - normalizedSystemStock).toFixed(2)),
    actorName,
    countedAt,
    resultCode,
    resultLabel,
    source,
  });
};

export const createDemoInventoryCountRecord = (product) => {
  const identity = resolveProductIdentity(product);
  const seed = hashSeed(`${identity.productId}-${identity.sku}-${identity.barcode}`);
  const systemStock = resolveProductSystemStock(product);
  const ageDays = Math.floor(seededRatio(seed, 1) * DEMO_MAX_AGE_DAYS);
  const hour = Math.floor(seededRatio(seed, 2) * 10) + 8;
  const minute = Math.floor(seededRatio(seed, 3) * 12) * 5;
  const countedAtDate = new Date();
  countedAtDate.setSeconds(0, 0);
  countedAtDate.setDate(countedAtDate.getDate() - ageDays);
  countedAtDate.setHours(hour, minute, 0, 0);
  const variance = Math.max(0, Math.round(Math.min(systemStock, (seed % 5))));
  const modePick = seed % 7;
  const physicalCount = modePick < 4
    ? systemStock
    : modePick < 6
      ? Math.max(0, systemStock - variance)
      : systemStock + variance;
  const difference = physicalCount - systemStock;
  const resultCode = difference === 0 ? 'matched' : difference < 0 ? 'deficit' : 'surplus';
  const resultLabel = difference === 0 ? 'Eşleşti' : difference < 0 ? 'Eksik' : 'Fazla';
  return normalizeArchiveRecord({
    id: `demo-count-${identity.productId || seed}`,
    ...identity,
    systemStock,
    physicalCount,
    difference,
    actorName: 'Demo Sayım',
    countedAt: countedAtDate.toISOString(),
    resultCode,
    resultLabel,
    source: 'demo',
  });
};

export const buildInventoryCountArchive = (products = [], options = {}) => {
  const persisted = Array.isArray(options.records) ? options.records.map(normalizeArchiveRecord) : readInventoryCountArchive();
  const includeDemo = options.includeDemo === true || (options.includeDemo !== false && isDemoInventoryCountingEnabled());
  const latestByProductId = new Map();
  persisted.forEach((record) => {
    const productId = String(record.productId || '').trim();
    if (!productId) return;
    const current = latestByProductId.get(productId);
    const currentTime = current ? Date.parse(current.countedAt || '') : 0;
    const nextTime = Date.parse(record.countedAt || '') || 0;
    if (!current || nextTime >= currentTime) {
      latestByProductId.set(productId, record);
    }
  });

  const demoRecords = includeDemo
    ? (Array.isArray(products) ? products : [])
      .map((product) => createDemoInventoryCountRecord(product))
      .filter((record) => !latestByProductId.has(String(record.productId || '').trim()))
    : [];

  return [...persisted, ...demoRecords].sort((left, right) => {
    const rightTime = Date.parse(right.countedAt || '') || 0;
    const leftTime = Date.parse(left.countedAt || '') || 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return String(left.productName || '').localeCompare(String(right.productName || ''), 'tr');
  });
};

export const buildInventoryLastCountMap = (products = [], options = {}) => {
  const archive = buildInventoryCountArchive(products, options);
  return archive.reduce((map, record) => {
    const productId = String(record.productId || '').trim();
    if (!productId || map.has(productId)) return map;
    map.set(productId, record);
    return map;
  }, new Map());
};

export const resolveInventoryCountDifferenceTone = (difference) => {
  if (difference === 0) return 'success';
  if (difference < 0) return 'danger';
  return 'warning';
};
