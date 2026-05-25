export const SKT_POLICIES = Object.freeze({
  REQUIRED: 'required',
  OPTIONAL: 'optional',
  NOT_APPLICABLE: 'not_applicable',
  MANUAL_REVIEW: 'manual_review',
});

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const hasAny = (text, tokens) => tokens.some((token) => text.includes(token));

const categoryCodeOf = (product = {}) => String(
  product.categoryCode
  || product.category_code
  || product.category?.code
  || ''
).trim().toLocaleUpperCase('tr-TR');

const categoryNameOf = (product = {}) => String(
  product.categoryName
  || product.category
  || product.category?.name
  || ''
);

const inferCategoryCode = (categoryName) => {
  const name = normalizeText(categoryName);
  if (name.includes('atistirmalik')) return 'ATSRM';
  if (name.includes('bebek')) return 'BEBEK';
  if (name.includes('deterjan') || name.includes('temizlik')) return 'TMZLK';
  if (name.includes('elektronik')) return 'ELKTR';
  if (name.includes('et') && name.includes('tavuk')) return 'ETBLK';
  if (name.includes('ev yasam')) return 'EVYSM';
  if (name.includes('evcil')) return 'EVCHY';
  if (name.includes('firin') || name.includes('pastane')) return 'FRPST';
  if (name.includes('hazir yemek') || name.includes('donuk')) return 'HZYMK';
  if (name.includes('kagit') || name.includes('islak mendil')) return 'KGTIM';
  if (name.includes('kitap') || name.includes('kirtasiye') || name.includes('oyuncak')) return 'KTOYN';
  if (name.includes('kisisel bakim') || name.includes('kozmetik') || name.includes('saglik')) return 'KBKSG';
  if (name.includes('meyve') || name.includes('sebze')) return 'MYSBZ';
  if (name.includes('sut') || name.includes('kahvaltilik')) return 'SUTKH';
  if (name.includes('temel gida')) return 'TMGDA';
  if (name.includes('icecek')) return 'ICECK';
  return '';
};

const labelOf = (product = {}) => String(
  product.etiket
  || product.labelName
  || product.categoryLabelName
  || product.tag
  || ''
);

export const resolveSktPolicy = (product = {}) => {
  const rawCategoryName = categoryNameOf(product);
  const categoryCode = categoryCodeOf(product) || inferCategoryCode(rawCategoryName);
  const categoryName = normalizeText(rawCategoryName);
  const label = normalizeText(labelOf(product));
  const name = normalizeText(product.name || product.productName || '');
  const combined = [categoryName, label, name].filter(Boolean).join(' ');

  const result = (policy, reason, extra = {}) => ({
    policy,
    sktPolicy: policy,
    batchNoRequired: true,
    reason,
    ...extra,
  });

  if (!categoryCode && !categoryName) return result(SKT_POLICIES.MANUAL_REVIEW, 'Kategori bilgisi eksik');
  if (categoryCode === 'ICECK' && hasAny(label, ['mutfak gerecleri'])) return result(SKT_POLICIES.MANUAL_REVIEW, 'Kategori/etiket kontrolü gerekir');
  if (categoryCode === 'EVCHY') {
    if (hasAny(combined, ['mama', 'odul', 'konserve'])) return result(SKT_POLICIES.REQUIRED, 'Gıda ürünü');
    return result(SKT_POLICIES.MANUAL_REVIEW, 'Ürün tipi kontrolü gerekir');
  }
  if (['ETBLK', 'HZYMK', 'FRPST', 'MYSBZ', 'ATSRM', 'TMGDA'].includes(categoryCode)) return result(SKT_POLICIES.REQUIRED, 'Gıda ürünü');
  if (categoryCode === 'ICECK') {
    if (hasAny(combined, ['cay', 'kahve'])) return result(SKT_POLICIES.OPTIONAL, 'Opsiyonel tarih');
    return result(SKT_POLICIES.REQUIRED, 'Gıda ürünü');
  }
  if (categoryCode === 'SUTKH') {
    if (hasAny(combined, ['sut', 'ayran', 'kefir', 'yogurt', 'peynir', 'labne', 'tereyag', 'tereyagi', 'krema', 'yumurta', 'zeytin'])) return result(SKT_POLICIES.REQUIRED, 'Kısa raf ömürlü ürün');
    if (hasAny(combined, ['bal', 'recel', 'tahin', 'gevrek', 'cikolata', 'ezme'])) return result(SKT_POLICIES.OPTIONAL, 'Opsiyonel tarih');
    return result(SKT_POLICIES.OPTIONAL, 'Opsiyonel tarih');
  }
  if (categoryCode === 'BEBEK') {
    if (hasAny(combined, ['bebek mamasi', 'mama'])) return result(SKT_POLICIES.REQUIRED, 'Bebek maması');
    if (hasAny(combined, ['bebek bezi', 'tekstil', 'aksesuar', 'biberon', 'emzik'])) return result(SKT_POLICIES.NOT_APPLICABLE, 'SKT gerekmiyor');
    if (hasAny(combined, ['sampuan', 'bakim', 'cilt', 'hijyen', 'islak mendil'])) return result(SKT_POLICIES.OPTIONAL, 'Opsiyonel tarih');
    return result(SKT_POLICIES.MANUAL_REVIEW, 'Ürün tipi kontrolü gerekir');
  }
  if (categoryCode === 'TMZLK') {
    if (hasAny(combined, ['bez', 'sunger', 'tel', 'gerec', 'gerecleri'])) return result(SKT_POLICIES.NOT_APPLICABLE, 'SKT gerekmiyor');
    return result(SKT_POLICIES.OPTIONAL, 'Opsiyonel tarih');
  }
  if (categoryCode === 'KGTIM') {
    if (hasAny(combined, ['islak mendil'])) return result(SKT_POLICIES.OPTIONAL, 'Opsiyonel tarih');
    return result(SKT_POLICIES.NOT_APPLICABLE, 'SKT gerekmiyor');
  }
  if (categoryCode === 'KBKSG') return result(SKT_POLICIES.OPTIONAL, 'Opsiyonel tarih');
  if (categoryCode === 'ELKTR') {
    if (hasAny(combined, ['pil', 'batarya'])) return result(SKT_POLICIES.OPTIONAL, 'Opsiyonel tarih');
    return result(SKT_POLICIES.NOT_APPLICABLE, 'SKT gerekmiyor');
  }
  if (['KTOYN', 'EVYSM'].includes(categoryCode)) return result(SKT_POLICIES.NOT_APPLICABLE, 'SKT gerekmiyor');

  return result(SKT_POLICIES.MANUAL_REVIEW, 'Ürün tipi kontrolü gerekir');
};

export const isSktRequired = (product) => resolveSktPolicy(product).policy === SKT_POLICIES.REQUIRED;
export const isSktApplicable = (product) => resolveSktPolicy(product).policy !== SKT_POLICIES.NOT_APPLICABLE;
