export const PRODUCT_UNIVERSES = Object.freeze({
  LISTED_ACTIVE: 'listed_active',
  LISTED: 'listed',
  UNLISTED: 'unlisted',
  CATALOG_ONLY: 'catalog_only',
  ALL: 'all',
});

const PRODUCT_UNIVERSE_ALIASES = Object.freeze({
  listed_active: PRODUCT_UNIVERSES.LISTED_ACTIVE,
  'listed-active': PRODUCT_UNIVERSES.LISTED_ACTIVE,
  active_listed: PRODUCT_UNIVERSES.LISTED_ACTIVE,
  'active-listed': PRODUCT_UNIVERSES.LISTED_ACTIVE,
  listed: PRODUCT_UNIVERSES.LISTED,
  unlisted: PRODUCT_UNIVERSES.UNLISTED,
  catalog: PRODUCT_UNIVERSES.CATALOG_ONLY,
  catalog_only: PRODUCT_UNIVERSES.CATALOG_ONLY,
  'catalog-only': PRODUCT_UNIVERSES.CATALOG_ONLY,
  all: PRODUCT_UNIVERSES.ALL,
  tumu: PRODUCT_UNIVERSES.ALL,
  hepsi: PRODUCT_UNIVERSES.ALL,
});

export const normalizeProductUniverse = (value, fallback = null) => {
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (!raw) return fallback;
  return PRODUCT_UNIVERSE_ALIASES[raw] || fallback;
};

export const buildProductUniverseWhere = (universe, { includeUnlisted = false } = {}) => {
  const normalizedUniverse = normalizeProductUniverse(universe);

  switch (normalizedUniverse) {
    case PRODUCT_UNIVERSES.LISTED_ACTIVE:
      return {
        isListed: { not: false },
        isActive: { not: false },
      };
    case PRODUCT_UNIVERSES.LISTED:
      return {
        isListed: { not: false },
      };
    case PRODUCT_UNIVERSES.UNLISTED:
      return {
        isListed: false,
      };
    case PRODUCT_UNIVERSES.CATALOG_ONLY:
      return {
        OR: [
          { catalogVisibility: 'catalog_only' },
          {
            AND: [
              { isListed: false },
              { registerOnOrder: true },
            ],
          },
        ],
      };
    case PRODUCT_UNIVERSES.ALL:
      return {};
    default:
      return includeUnlisted ? {} : { isListed: { not: false } };
  }
};

export const matchesProductUniverse = (product = {}, universe, { includeUnlisted = false } = {}) => {
  const normalizedUniverse = normalizeProductUniverse(universe);
  const isListed = product?.isListed !== false;
  const isActive = product?.isActive !== false;
  const catalogVisibility = String(product?.catalogVisibility || '').trim().toLocaleLowerCase('tr-TR');
  const registerOnOrder = product?.registerOnOrder === true;

  switch (normalizedUniverse) {
    case PRODUCT_UNIVERSES.LISTED_ACTIVE:
      return isListed && isActive;
    case PRODUCT_UNIVERSES.LISTED:
      return isListed;
    case PRODUCT_UNIVERSES.UNLISTED:
      return !isListed;
    case PRODUCT_UNIVERSES.CATALOG_ONLY:
      return catalogVisibility === 'catalog_only' || (!isListed && registerOnOrder);
    case PRODUCT_UNIVERSES.ALL:
      return true;
    default:
      return includeUnlisted || isListed;
  }
};
