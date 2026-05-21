export const normalizePositiveInt = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
};

export const isCatalogOnlyProduct = (product = {}) => {
  const catalogVisibility = String(product?.catalogVisibility || '').trim().toLowerCase();
  return catalogVisibility === 'catalog_only' || (product?.isListed === false && product?.registerOnOrder === true);
};

export const isActiveRetailProduct = (product = {}) =>
  product?.isListed !== false && product?.isActive !== false && !isCatalogOnlyProduct(product);

export const stableHash = (value) => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const resolveUnitsPerCase = (product = {}) => normalizePositiveInt(product?.unitsPerCase, 24);

export const buildTwoCaseSkuSet = (products = []) => {
  const active = products.filter(isActiveRetailProduct);
  const twoCaseCount = Math.floor(active.length * 0.25);

  return new Set(
    active
      .map((product) => {
        const priority = String(product?.placementPriority || '').trim().toUpperCase();
        const priorityBoost = priority === 'A' ? 3000000000 : priority === 'B' ? 1500000000 : 0;
        return {
          sku: product.sku,
          score: priorityBoost + stableHash(product.sku || product.id),
        };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, twoCaseCount)
      .map((item) => item.sku)
  );
};

export const resolveShelfCaseCount = (product = {}, twoCaseSkuSet = null) => {
  if (!isActiveRetailProduct(product)) return 0;
  if (twoCaseSkuSet) return twoCaseSkuSet.has(product.sku) ? 2 : 1;
  return stableHash(product.sku || product.id) % 4 === 0 ? 2 : 1;
};

export const resolveSupportCaseCount = (product = {}, shelfCaseCount = 1) => {
  const hash = stableHash(`${product?.sku || product?.id || ''}:depot-support`);
  if (shelfCaseCount >= 2) return 4 + (hash % 5);
  return 2 + (hash % 4);
};

export const buildRetailCaseStockPlan = (product = {}, twoCaseSkuSet = null) => {
  if (!isActiveRetailProduct(product)) {
    return {
      shelfCaseCount: 0,
      supportCaseCount: 0,
      unitsPerCase: resolveUnitsPerCase(product),
      shelfCapacity: 0,
      shelfQuantity: 0,
      warehouseQuantity: 0,
      criticalStock: 0,
      maxStock: 0,
    };
  }

  const unitsPerCase = resolveUnitsPerCase(product);
  const shelfCaseCount = resolveShelfCaseCount(product, twoCaseSkuSet);
  const supportCaseCount = resolveSupportCaseCount(product, shelfCaseCount);
  const shelfCapacity = shelfCaseCount * unitsPerCase;
  const warehouseQuantity = supportCaseCount * unitsPerCase;
  const maxSupportCaseCount = shelfCaseCount >= 2 ? 8 : 5;

  return {
    shelfCaseCount,
    supportCaseCount,
    unitsPerCase,
    shelfCapacity,
    shelfQuantity: shelfCapacity,
    warehouseQuantity,
    criticalStock: Math.max(1, Math.ceil(shelfCapacity * (shelfCaseCount >= 2 ? 0.4 : 0.35))),
    maxStock: shelfCapacity + (maxSupportCaseCount * unitsPerCase),
  };
};

export const deriveShelfStockAlert = ({ product = {}, shelfQuantity = 0, totalQuantity = 0 } = {}) => {
  const payload = product?.payload && typeof product.payload === 'object' ? product.payload : {};
  const explicit = String(product?.stockAlert || payload.stockAlert || '').trim().toLowerCase();
  if (['critical', 'low', 'normal', 'overstock'].includes(explicit)) return explicit;

  const shelf = Math.max(0, Number(shelfQuantity || 0));
  const capacity = Math.max(0, Number(product?.maxShelfStock || product?.shelfCapacity || 0));
  const critical = Math.max(0, Number(product?.criticalStock || 0));
  const lowThreshold = capacity > 0
    ? Math.max(critical + 1, Math.ceil(capacity * 0.65))
    : critical + resolveUnitsPerCase(product);
  const total = Math.max(0, Number(totalQuantity || 0));
  const max = Math.max(0, Number(product?.maxStock || 0));

  if (!isActiveRetailProduct(product)) return 'normal';
  if (shelf <= critical) return 'critical';
  if (shelf <= lowThreshold) return 'low';
  if (capacity > 0 && shelf > capacity) return 'overstock';
  if (max > 0 && total > max) return 'overstock';
  return 'normal';
};

export const stockAlertToSignals = (stockAlert) => {
  if (stockAlert === 'critical') return { isCritical: true, stockWarning: 'Kritik', stockAlert };
  if (stockAlert === 'low') return { isCritical: false, stockWarning: 'Düşük', stockAlert };
  if (stockAlert === 'overstock') return { isCritical: false, stockWarning: 'Yüksek', stockAlert };
  return { isCritical: false, stockWarning: 'Normal', stockAlert: 'normal' };
};
