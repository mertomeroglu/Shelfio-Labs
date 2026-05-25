export const SKT_POLICIES = Object.freeze({
  REQUIRED: 'required',
  OPTIONAL: 'optional',
  NOT_APPLICABLE: 'not_applicable',
  MANUAL_REVIEW: 'manual_review',
});

const CATEGORY_CODES = Object.freeze({
  SNACK: 'ATSRM',
  BABY: 'BEBEK',
  CLEANING: 'TMZLK',
  ELECTRONICS: 'ELKTR',
  MEAT: 'ETBLK',
  HOME: 'EVYSM',
  PET: 'EVCHY',
  BAKERY: 'FRPST',
  FROZEN_READY: 'HZYMK',
  PAPER_WET_WIPE: 'KGTIM',
  BOOK_STATIONERY_TOY: 'KTOYN',
  PERSONAL_CARE: 'KBKSG',
  PRODUCE: 'MYSBZ',
  DAIRY_BREAKFAST: 'SUTKH',
  PANTRY: 'TMGDA',
  BEVERAGE: 'ICECK',
});

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const hasAny = (text, tokens) => tokens.some((token) => text.includes(token));

const resolveCategoryCode = ({ product = {}, category = {} } = {}) => {
  const safeCategory = category && typeof category === 'object' ? category : {};
  return String(
    product.categoryCode
    || product.category_code
    || safeCategory.code
    || product.category?.code
    || ''
  ).trim().toLocaleUpperCase('tr-TR');
};

const resolveCategoryName = ({ product = {}, category = {} } = {}) => {
  const safeCategory = category && typeof category === 'object' ? category : {};
  return String(
    product.categoryName
    || product.category
    || safeCategory.name
    || product.category?.name
    || ''
  );
};

const resolveLabel = (product = {}) => String(
  product.etiket
  || product.labelName
  || product.categoryLabelName
  || product.tag
  || ''
);

const inferCategoryCode = (categoryName) => {
  const name = normalizeText(categoryName);
  if (name.includes('atistirmalik')) return CATEGORY_CODES.SNACK;
  if (name.includes('bebek')) return CATEGORY_CODES.BABY;
  if (name.includes('deterjan') || name.includes('temizlik')) return CATEGORY_CODES.CLEANING;
  if (name.includes('elektronik')) return CATEGORY_CODES.ELECTRONICS;
  if (name.includes('et') && name.includes('tavuk')) return CATEGORY_CODES.MEAT;
  if (name.includes('ev yasam')) return CATEGORY_CODES.HOME;
  if (name.includes('evcil')) return CATEGORY_CODES.PET;
  if (name.includes('firin') || name.includes('pastane')) return CATEGORY_CODES.BAKERY;
  if (name.includes('hazir yemek') || name.includes('donuk')) return CATEGORY_CODES.FROZEN_READY;
  if (name.includes('kagit') || name.includes('islak mendil')) return CATEGORY_CODES.PAPER_WET_WIPE;
  if (name.includes('kitap') || name.includes('kirtasiye') || name.includes('oyuncak')) return CATEGORY_CODES.BOOK_STATIONERY_TOY;
  if (name.includes('kisisel bakim') || name.includes('kozmetik') || name.includes('saglik')) return CATEGORY_CODES.PERSONAL_CARE;
  if (name.includes('meyve') || name.includes('sebze')) return CATEGORY_CODES.PRODUCE;
  if (name.includes('sut') || name.includes('kahvaltilik')) return CATEGORY_CODES.DAIRY_BREAKFAST;
  if (name.includes('temel gida')) return CATEGORY_CODES.PANTRY;
  if (name.includes('icecek')) return CATEGORY_CODES.BEVERAGE;
  return '';
};

export const resolveSktPolicy = ({ product = {}, category = {} } = {}) => {
  const rawCategoryName = resolveCategoryName({ product, category });
  const categoryCode = resolveCategoryCode({ product, category }) || inferCategoryCode(rawCategoryName);
  const categoryName = normalizeText(rawCategoryName);
  const label = normalizeText(resolveLabel(product));
  const name = normalizeText(product.name || product.productName || '');
  const combined = [categoryName, label, name].filter(Boolean).join(' ');
  const batchNoRequired = true;

  const result = (policy, reason, extra = {}) => ({
    policy,
    sktPolicy: policy,
    batchNoRequired,
    reason,
    ...extra,
  });

  if (!categoryCode && !categoryName) {
    return result(SKT_POLICIES.MANUAL_REVIEW, 'Kategori bilgisi eksik', { manualReviewReason: 'missing_category' });
  }

  if (categoryCode === CATEGORY_CODES.BEVERAGE && hasAny(label, ['mutfak gerecleri'])) {
    return result(SKT_POLICIES.MANUAL_REVIEW, 'İçecek altında gıda dışı etiket', { manualReviewReason: 'category_label_conflict' });
  }

  if (categoryCode === CATEGORY_CODES.PET) {
    if (hasAny(combined, ['mama', 'odul', 'konserve'])) return result(SKT_POLICIES.REQUIRED, 'Evcil hayvan maması');
    return result(SKT_POLICIES.MANUAL_REVIEW, 'Evcil hayvan ürünü mama/aksesuar ayrımı ister', { manualReviewReason: 'pet_food_or_accessory' });
  }

  if ([CATEGORY_CODES.MEAT, CATEGORY_CODES.FROZEN_READY, CATEGORY_CODES.BAKERY, CATEGORY_CODES.PRODUCE].includes(categoryCode)) {
    return result(SKT_POLICIES.REQUIRED, 'Taze, soğuk zincir, donuk veya fırın ürünü');
  }

  if ([CATEGORY_CODES.SNACK, CATEGORY_CODES.PANTRY].includes(categoryCode)) {
    return result(SKT_POLICIES.REQUIRED, 'Gıda ürünü');
  }

  if (categoryCode === CATEGORY_CODES.BEVERAGE) {
    if (hasAny(combined, ['cay', 'kahve'])) return result(SKT_POLICIES.OPTIONAL, 'Uzun raf ömürlü içecek/TETT');
    return result(SKT_POLICIES.REQUIRED, 'İçecek gıda ürünü');
  }

  if (categoryCode === CATEGORY_CODES.DAIRY_BREAKFAST) {
    if (hasAny(combined, ['sut', 'ayran', 'kefir', 'yogurt', 'peynir', 'labne', 'tereyag', 'tereyagi', 'krema', 'yumurta', 'zeytin'])) {
      return result(SKT_POLICIES.REQUIRED, 'Süt/kahvaltılık kısa raf ömürlü ürün');
    }
    if (hasAny(combined, ['bal', 'recel', 'tahin', 'gevrek', 'cikolata', 'ezme'])) {
      return result(SKT_POLICIES.OPTIONAL, 'Uzun raf ömürlü kahvaltılık');
    }
    return result(SKT_POLICIES.OPTIONAL, 'Kahvaltılık ürün tipi teyit gerektirebilir');
  }

  if (categoryCode === CATEGORY_CODES.BABY) {
    if (hasAny(combined, ['bebek mamasi', 'mama'])) return result(SKT_POLICIES.REQUIRED, 'Bebek maması');
    if (hasAny(combined, ['bebek bezi', 'tekstil', 'aksesuar', 'biberon', 'emzik'])) {
      return result(SKT_POLICIES.NOT_APPLICABLE, 'Bebek bezi/tekstil/aksesuar');
    }
    if (hasAny(combined, ['sampuan', 'bakim', 'cilt', 'hijyen', 'islak mendil'])) {
      return result(SKT_POLICIES.OPTIONAL, 'Bebek bakım/hijyen ürünü');
    }
    return result(SKT_POLICIES.MANUAL_REVIEW, 'Bebek ürünü alt tipi net değil', { manualReviewReason: 'baby_subtype_unclear' });
  }

  if (categoryCode === CATEGORY_CODES.CLEANING) {
    if (hasAny(combined, ['bez', 'sunger', 'tel', 'gerec', 'gerecleri'])) {
      return result(SKT_POLICIES.NOT_APPLICABLE, 'Temizlik gereci');
    }
    return result(SKT_POLICIES.OPTIONAL, 'Temizlik kimyasalı veya oda kokusu');
  }

  if (categoryCode === CATEGORY_CODES.PAPER_WET_WIPE) {
    if (hasAny(combined, ['islak mendil'])) return result(SKT_POLICIES.OPTIONAL, 'Islak mendil');
    return result(SKT_POLICIES.NOT_APPLICABLE, 'Kağıt ürünü');
  }

  if (categoryCode === CATEGORY_CODES.PERSONAL_CARE) {
    return result(SKT_POLICIES.OPTIONAL, 'Kişisel bakım/kozmetik/sağlık ürünü');
  }

  if (categoryCode === CATEGORY_CODES.ELECTRONICS) {
    if (hasAny(combined, ['pil', 'batarya'])) return result(SKT_POLICIES.OPTIONAL, 'Pil/batarya için SKT opsiyonel');
    return result(SKT_POLICIES.NOT_APPLICABLE, 'Elektronik/aksesuar');
  }

  if ([CATEGORY_CODES.BOOK_STATIONERY_TOY, CATEGORY_CODES.HOME].includes(categoryCode)) {
    return result(SKT_POLICIES.NOT_APPLICABLE, 'Gıda dışı dayanıklı ürün');
  }

  return result(SKT_POLICIES.MANUAL_REVIEW, 'Kategori/etiket kuralı net değil', { manualReviewReason: 'unknown_rule' });
};

export const shouldRequireSkt = (context) => resolveSktPolicy(context).policy === SKT_POLICIES.REQUIRED;

export const shouldAcceptSktInput = (context) => resolveSktPolicy(context).policy !== SKT_POLICIES.NOT_APPLICABLE;
