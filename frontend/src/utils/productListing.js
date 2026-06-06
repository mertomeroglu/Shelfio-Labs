const normalizeListingKey = (value) => String(value ?? '').trim().toLocaleLowerCase('tr-TR');

const TRUE_KEYS = new Set([
  'true',
  '1',
  'yes',
  'active',
  'aktif',
  'listed',
  'in_store',
  'instore',
  'store_listed',
]);

const FALSE_KEYS = new Set([
  'false',
  '0',
  'no',
  'inactive',
  'pasif',
  'passive',
  'unlisted',
  'catalog',
  'catalog_only',
  'not_listed',
  'pending_listing',
  'new_catalog',
]);

const readListingSignal = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const key = normalizeListingKey(value);
  if (!key) return null;
  if (TRUE_KEYS.has(key)) return true;
  if (FALSE_KEYS.has(key)) return false;
  return null;
};

export function isCatalogUnlistedProduct(product = {}) {
  const directSignals = [
    product.isListed,
    product.listed,
    product.storeListed,
    product.inStore,
  ]
    .map(readListingSignal)
    .filter((value) => typeof value === 'boolean');

  if (directSignals.includes(false)) return true;
  if (directSignals.includes(true)) return false;

  const sourceKey = normalizeListingKey(product.source || product.sourceSection || product.universe || product.listType);
  if (sourceKey && (
    sourceKey.includes('catalog_only')
    || sourceKey.includes('unlisted')
    || sourceKey === 'catalog'
    || sourceKey.includes('new_catalog')
  )) {
    return true;
  }

  if (sourceKey && (
    sourceKey.includes('listed')
    || sourceKey.includes('store')
    || sourceKey.includes('active')
  )) {
    return false;
  }

  return false;
}
