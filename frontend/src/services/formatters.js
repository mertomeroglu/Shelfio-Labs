const DATE_ONLY_OPTIONS = { day: '2-digit', month: '2-digit', year: 'numeric' };
const DATE_TIME_OPTIONS = { ...DATE_ONLY_OPTIONS, hour: '2-digit', minute: '2-digit' };
const DEFAULT_STORE_TIMEZONE = 'Europe/Istanbul';

export const RETURN_REASON_LABELS = {
  customer_request: 'Müşteri Talebi',
  wrong_product: 'Yanlış Ürün',
  defective: 'Kusurlu Ürün',
  damaged: 'Hasarlı Ürün',
  expired: 'Son Kullanma Tarihi Geçmiş',
  customer_changed_mind: 'Müşteri Vazgeçti',
  other: 'Diğer',
};

export const STORAGE_TYPE_LABELS = {
  Ortam: 'Ortam',
  ortam: 'Ortam',
  ambient: 'Ortam',
  cold_chain: 'Soğuk Zincir',
  cold: 'Soğuk Zincir',
  freezer: 'Donuk / Dondurucu',
  frozen: 'Donuk / Dondurucu',
  mixed: 'Karma',
};

export const DEPOT_LOCATION_LABELS = {
  'OVR-FROZEN': 'Donuk Ortak Alan',
  'OVR-COLD': 'Soğuk Ortak Alan',
  'OVR-AMBIENT': 'Ortam Ortak Alan',
  'DIRECT-SUPPLY': 'Doğrudan Tedarik',
  'NO-BACKROOM': 'Arka Depo Yok',
};

export const STOCK_LOCATION_LABELS = {
  depo: 'Depo',
  reyon: 'Reyon',
  pos: 'Müşteri / POS',
  customer: 'Müşteri',
  customer_return: 'Müşteri İadesi',
  iade_alani: 'İade Alanı',
  kalite_kontrol: 'Kalite Kontrol',
};

export const normalizeStorageTypeCode = (value, fallback = 'Ortam') => {
  const raw = String(value || '').trim();
  const normalized = raw.toLocaleLowerCase('tr-TR');
  if (['cold_chain', 'soguk_zincir', 'soguk zincir', 'soğuk zincir', 'cold'].includes(normalized)) return 'cold_chain';
  if (['freezer', 'frozen', 'dondurucu', 'donuk'].includes(normalized)) return 'freezer';
  if (['ambient', 'ortam'].includes(normalized)) return 'Ortam';
  return raw || fallback;
};

export const formatReturnReasonLabel = (value, fallback = '-') => {
  const key = String(value || '').trim();
  if (!key) return fallback;
  return RETURN_REASON_LABELS[key] || key;
};

export const formatStorageTypeLabel = (value, fallback = '-') => {
  const code = normalizeStorageTypeCode(value, '');
  if (!code) return fallback;
  return STORAGE_TYPE_LABELS[code] || STORAGE_TYPE_LABELS[String(code).toLocaleLowerCase('tr-TR')] || code;
};

export const formatDepotLocationLabel = (value, fallback = '-') => {
  const code = String(value || '').trim();
  if (!code) return fallback;
  return DEPOT_LOCATION_LABELS[code] || code;
};

export const formatStockLocationLabel = (value, fallback = '-') => {
  const key = String(value || '').trim();
  if (!key) return fallback;
  return STOCK_LOCATION_LABELS[key] || key;
};

export const formatTurkishDisplayText = (value, fallback = '-') => {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text
    .replace(/\?stanbul/gi, 'İstanbul')
    .replace(/\bIstanbul\b/g, 'İstanbul')
    .replace(/\bistanbul\b/g, 'İstanbul')
    .replace(/\bIzmir\b/g, 'İzmir')
    .replace(/\bizmir\b/g, 'İzmir');
};

const TURKISH_TEXT_REPLACEMENTS = [
  ['Ã–', 'Ö'],
  ['Ã¼', 'ü'],
  ['Ä±', 'ı'],
  ['ÅŸ', 'ş'],
  ['Ã§', 'ç'],
  ['ÄŸ', 'ğ'],
  ['Ã¶', 'ö'],
  ['Ãœ', 'Ü'],
  ['Ä°', 'İ'],
  ['Å', 'Ş'],
  ['Ã‡', 'Ç'],
  ['Ä', 'Ğ'],
  ['â€¢', '•'],
  ['Ã¢â‚¬Â¢', '•'],
  ['?r?n', 'ürün'],
];

export const normalizeTurkishText = (value, fallback = '-') => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  return TURKISH_TEXT_REPLACEMENTS.reduce((text, [from, to]) => text.replaceAll(from, to), raw);
};

export const joinDisplayParts = (parts = [], separator = ' • ') => {
  const items = (Array.isArray(parts) ? parts : [])
    .map((part) => normalizeTurkishText(part, ''))
    .filter(Boolean);
  return items.join(separator);
};

export const formatMovementRouteLabel = (movement = {}, fallback = '-') => {
  const reasonCode = String(movement?.reasonCode || '').trim().toLowerCase();
  const fromLabel = String(movement?.fromLocationLabel || '').trim() || formatStockLocationLabel(movement?.fromLocation, '');
  const toLabel = String(movement?.toLocationLabel || '').trim() || formatStockLocationLabel(movement?.toLocation, '');
  const locationLabel = String(movement?.locationLabel || '').trim() || formatStockLocationLabel(movement?.location, '');

  if (fromLabel && toLabel) {
    return `${fromLabel} -> ${toLabel}`;
  }

  if (reasonCode === 'customer_return' && toLabel) {
    return `Müşteri / POS -> ${toLabel}`;
  }

  if (locationLabel) return locationLabel;
  return fallback;
};

const hasExplicitTime = (value) => {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return false;
  return /\d{1,2}:\d{2}/.test(text) || /T\d{2}/.test(text);
};

const isMidnight = (date) => (
  date.getHours() === 0
  && date.getMinutes() === 0
  && date.getSeconds() === 0
  && date.getMilliseconds() === 0
);

export const formatDate = (value, includeTime = 'auto') => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return '-';
  }

  const mode = includeTime === true ? 'always' : includeTime === false ? 'never' : 'auto';
  const shouldShowTime = mode === 'always' || (mode === 'auto' && hasExplicitTime(value) && !isMidnight(date));

  if (!shouldShowTime) {
    return date.toLocaleDateString('tr-TR', DATE_ONLY_OPTIONS);
  }

  return date.toLocaleString('tr-TR', DATE_TIME_OPTIONS);
};

export const formatDateInTimeZone = (value, includeTime = 'auto', timeZone = DEFAULT_STORE_TIMEZONE) => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return '-';
  }

  const mode = includeTime === true ? 'always' : includeTime === false ? 'never' : 'auto';
  const shouldShowTime = mode === 'always' || (mode === 'auto' && hasExplicitTime(value) && !isMidnight(date));
  const options = shouldShowTime ? DATE_TIME_OPTIONS : DATE_ONLY_OPTIONS;

  return date.toLocaleString('tr-TR', {
    ...options,
    timeZone: timeZone || DEFAULT_STORE_TIMEZONE,
  });
};

export const formatDateOnly = (value) => {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('tr-TR', DATE_ONLY_OPTIONS);
};

export const formatCurrency = (value, currency = 'TRY') => {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
};

export const formatNumber = (value) => new Intl.NumberFormat('tr-TR').format(Number(value || 0));

export const formatOrderDisplayId = (value, fallback = '-') => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const digitMatch = raw.match(/\d+/g);
  if (digitMatch?.length) return `siparis-${digitMatch.join('').slice(-5).padStart(5, '0')}`;
  const seed = raw.replace(/[^a-z0-9]/gi, '');
  if (!seed) return fallback;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return `siparis-${String(Math.abs(hash) % 100000).padStart(5, '0')}`;
};

export const formatCustomerOrderDisplayId = (value, fallback = '-') => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (/^MOB(?:-R)?-\d{8}-\d{4}$/i.test(raw)) return raw.toUpperCase();
  if (/^cust-order/i.test(raw)) return raw;
  return raw;
};

export const formatUserRole = (role) => {
  if (role === 'admin') {
    return 'Yönetici';
  }

  if (role === 'user') {
    return 'Personel';
  }

  if (role === 'viewer') {
    return 'Komisyon B';
  }

  if (role === 'komisyon_b') {
    return 'Komisyon B';
  }

  if (role === 'komisyon_c') {
    return 'Komisyon C';
  }

  if (role === 'komisyon_v') {
    return 'Komisyon V';
  }

  if (role === 'cashier') {
    return 'Kasiyer';
  }

  if (role === 'depo_personeli') {
    return 'Depo Personeli';
  }

  return role || '-';
};

export const formatUnit = (value) => {
  if (!value || typeof value !== 'string') return value || '';
  return value.replace(/(\d)\s+(g|kg|ml|L|lt|cl|adet|paket|kutu|çift)\b/gi, '$1$2');
};

const SEARCH_CHAR_MAP = {
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ı: 'i',
  I: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ş: 's',
  Ş: 's',
  ü: 'u',
  Ü: 'u',
};

export const normalizeSearchText = (value) => String(value || '')
  .replace(/[ÇçĞğIıİÖöŞşÜü]/g, (char) => SEARCH_CHAR_MAP[char] || char)
  .toLocaleLowerCase('tr-TR')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export const includesNormalized = (value, query) => {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  return normalizeSearchText(value).includes(needle);
};

const normalizeToken = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const splitCategoryTokens = (value) => String(value || '')
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean);

const sanitizeSubCategoryLabel = (value, fallback = '-') => {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text;
};

export const buildCategoryLookup = (categories = []) => {
  const categoryById = new Map();
  const categoryByName = new Map();

  (Array.isArray(categories) ? categories : []).forEach((category) => {
    const id = String(category?.id || '').trim();
    const name = String(category?.name || '').trim();
    if (id) categoryById.set(id, category);
    if (name) categoryByName.set(normalizeToken(name), category);
  });

  return { categoryById, categoryByName };
};

export const resolveProductTaxonomy = (product = {}, categoryLookup = null) => {
  const lookup = categoryLookup || buildCategoryLookup([]);
  const directCategoryId = String(product?.categoryId || '').trim();
  const directCategoryName = String(product?.categoryName || '').trim();
  const etiket = String(product?.etiket || '').trim();

  const directCategory = directCategoryId ?
    lookup.categoryById.get(directCategoryId) || null
    : (directCategoryName ? lookup.categoryByName.get(normalizeToken(directCategoryName)) || null : null);

  const resolvedCategoryName = sanitizeSubCategoryLabel(directCategory?.name || directCategoryName, '-');
  const parentCategory = directCategory?.parentCategoryId ?
    lookup.categoryById.get(String(directCategory.parentCategoryId)) || null
    : null;

  const mainCategory = sanitizeSubCategoryLabel(parentCategory?.name || resolvedCategoryName, '-');

  if (parentCategory?.name) {
    return {
      mainCategory,
      subCategory: sanitizeSubCategoryLabel(resolvedCategoryName, '-'),
      categoryId: directCategoryId,
      parentCategoryId: String(directCategory?.parentCategoryId || ''),
    };
  }

  const rawAltTokens = splitCategoryTokens(etiket);
  const mainTokenSet = new Set(splitCategoryTokens(mainCategory).map(normalizeToken));
  const filteredAltTokens = rawAltTokens.filter((token) => !mainTokenSet.has(normalizeToken(token)));
  const subCategory = filteredAltTokens.join(', ');

  return {
    mainCategory,
    subCategory: sanitizeSubCategoryLabel(subCategory, '-'),
    categoryId: directCategoryId,
    parentCategoryId: '',
  };
};

const toTaxonomyTokenList = (value) => splitCategoryTokens(value)
  .map((token) => sanitizeSubCategoryLabel(token, '').trim())
  .filter((token) => token && token !== '-');

const compareTr = (left, right) => String(left || '').localeCompare(String(right || ''), 'tr');

export const resolveCategoryMainLabel = (category = {}, categoryLookup = null) => {
  const lookup = categoryLookup || buildCategoryLookup([]);
  const parentId = String(category?.parentCategoryId || '').trim();
  if (!parentId) {
    return sanitizeSubCategoryLabel(category?.name || '-', '-');
  }

  const parent = lookup.categoryById.get(parentId) || null;
  return sanitizeSubCategoryLabel(parent?.name || category?.name || '-', '-');
};

export const buildTaxonomyResolver = ({ products = [], categories = [] } = {}) => {
  const categoryLookup = buildCategoryLookup(categories);
  const tagsByMainCategory = new Map();

  const ensureMainSet = (mainCategory) => {
    const key = sanitizeSubCategoryLabel(mainCategory, '').trim();
    if (!key) return null;
    if (!tagsByMainCategory.has(key)) {
      tagsByMainCategory.set(key, new Set());
    }
    return tagsByMainCategory.get(key);
  };

  (Array.isArray(categories) ? categories : []).forEach((category) => {
    const parentId = String(category?.parentCategoryId || '').trim();
    if (!parentId) return;
    const parent = categoryLookup.categoryById.get(parentId) || null;
    const mainCategory = sanitizeSubCategoryLabel(parent?.name || '', '').trim();
    const subLabel = sanitizeSubCategoryLabel(category?.name || '', '').trim();
    if (!mainCategory || !subLabel) return;
    ensureMainSet(mainCategory)?.add(subLabel);
  });

  (Array.isArray(products) ? products : []).forEach((product) => {
    const taxonomy = resolveProductTaxonomy(product, categoryLookup);
    const mainCategory = sanitizeSubCategoryLabel(taxonomy.mainCategory, '').trim();
    if (!mainCategory) return;
    const targetSet = ensureMainSet(mainCategory);
    if (!targetSet) return;
    toTaxonomyTokenList(taxonomy.subCategory).forEach((token) => {
      if (normalizeToken(token) !== normalizeToken(mainCategory)) {
        targetSet.add(token);
      }
    });
  });

  const getTagsForMainCategory = (mainCategory) => {
    const key = sanitizeSubCategoryLabel(mainCategory, '').trim();
    if (!key || !tagsByMainCategory.has(key)) return [];
    return [...tagsByMainCategory.get(key)].sort(compareTr);
  };

  const getTagsForCategory = (category) => {
    const mainCategory = resolveCategoryMainLabel(category, categoryLookup);
    return getTagsForMainCategory(mainCategory);
  };

  return {
    categoryLookup,
    getTagsForMainCategory,
    getTagsForCategory,
  };
};

export const resolveStockPairMeta = ({ current = 0, capacity = 0, critical = 0 } = {}) => {
  const x = Number(current || 0);
  const y = Number(capacity || 0);
  const criticalLevel = Number(critical || 0);
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const overCapacity = safeY > 0 && safeX > safeY;
  const isZero = safeX <= 0;
  const isCritical = !overCapacity && !isZero && criticalLevel > 0 && safeX <= criticalLevel;

  return {
    current: safeX,
    capacity: safeY,
    overCapacity,
    isZero,
    isCritical,
    display: `${formatNumber(safeX)} / ${formatNumber(safeY)}`,
    tone: overCapacity ? 'danger' : isCritical ? 'warning' : isZero ? 'neutral' : 'success',
  };
};
