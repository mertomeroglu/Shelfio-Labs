import { settingsRepo } from '../repositories/settingsRepository.js';
import { categoryRepo } from '../repositories/categoryRepository.js';
import { productRepo } from '../repositories/productRepository.js';

const TURKISH_ASCII_MAP = {
  ç: 'c', Ç: 'c',
  ğ: 'g', Ğ: 'g',
  ı: 'i', İ: 'i',
  ö: 'o', Ö: 'o',
  ş: 's', Ş: 's',
  ü: 'u', Ü: 'u',
};

const normalizeUnicodeText = (value) => String(value || '').normalize('NFC');
const normalizeKey = (value) => normalizeUnicodeText(value).trim().toLocaleLowerCase('tr-TR');
const toAscii = (value) => normalizeUnicodeText(value).replace(/[çÇğĞıİöÖşŞüÜ]/g, (char) => TURKISH_ASCII_MAP[char] || char);
const toSlug = (value) => toAscii(value)
  .toLocaleLowerCase('tr-TR')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

const extractAlphaTokens = (value) => toAscii(value)
  .toLocaleUpperCase('tr-TR')
  .replace(/[^A-Z0-9 ]+/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

const stopwords = new Set(['VE', 'ILE', 'ICIN', 'GENEL', 'URUN', 'URUNLERI']);

const buildReadableToken = (labelName) => {
  const tokens = extractAlphaTokens(labelName).filter((token) => !stopwords.has(token));
  const compact = tokens.join('');
  if (!compact) return 'GENL';
  return compact.slice(0, 4).padEnd(4, 'X');
};

const buildCategoryPrefix = (categoryCode) => {
  const raw = toAscii(String(categoryCode || 'GEN')).toLocaleUpperCase('tr-TR').replace(/[^A-Z0-9]+/g, '');
  return (raw.slice(0, 3) || 'GEN').padEnd(3, 'X');
};

const uniquePush = (arr, value) => {
  const item = String(value || '').trim();
  if (!item) return;
  if (!arr.includes(item)) arr.push(item);
};

const toLabelCode = (categoryCode, labelSlug, takenCodes) => {
  const base = `LBL_${String(categoryCode || 'GENEL').toLocaleUpperCase('tr-TR')}_${String(labelSlug || 'etiket').toLocaleUpperCase('tr-TR').replace(/[^A-Z0-9]+/g, '_')}`.slice(0, 64);
  if (!takenCodes.has(base)) {
    takenCodes.add(base);
    return base;
  }
  let i = 2;
  while (i < 10000) {
    const next = `${base}_${i}`;
    if (!takenCodes.has(next)) {
      takenCodes.add(next);
      return next;
    }
    i += 1;
  }
  return `${base}_${Date.now()}`;
};

const pickBestCategoryCode = (hintCounter, defaultCategoryCode = 'GENEL') => {
  let bestCode = defaultCategoryCode;
  let bestScore = -1;
  hintCounter.forEach((score, code) => {
    if (score > bestScore) {
      bestScore = score;
      bestCode = code;
    }
  });
  return bestCode;
};

const buildMasterIndex = (labels) => {
  const byId = new Map();
  const byCode = new Map();
  const byDisplayCode = new Map();
  const bySlug = new Map();
  const byName = new Map();
  labels.forEach((item) => {
    const label = {
      ...item,
      labelId: String(item.labelId || item.id || '').trim(),
      labelCode: String(item.labelCode || '').trim(),
      labelDisplayCode: String(item.labelDisplayCode || '').trim(),
      labelName: normalizeUnicodeText(item.labelName || '').trim(),
      labelSlug: toSlug(item.labelSlug || item.labelName || ''),
      legacyCodes: Array.isArray(item.legacyCodes) ? item.legacyCodes.map((entry) => String(entry || '').trim()).filter(Boolean) : [],
    };
    if (!label.labelId || !label.labelName) return;
    byId.set(label.labelId, label);
    if (label.labelCode) byCode.set(label.labelCode.toLocaleUpperCase('tr-TR'), label);
    if (label.labelDisplayCode) byDisplayCode.set(label.labelDisplayCode.toLocaleUpperCase('tr-TR'), label);
    if (label.labelSlug) bySlug.set(label.labelSlug.toLocaleLowerCase('tr-TR'), label);
    byName.set(normalizeKey(label.labelName), label);
    label.legacyCodes.forEach((legacy) => byCode.set(String(legacy).toLocaleUpperCase('tr-TR'), label));
  });
  return { byId, byCode, byDisplayCode, bySlug, byName };
};

const resolveLabelFromAny = ({ ref = '', name = '', slug = '' }, index) => {
  const rawRef = String(ref || '').trim();
  if (rawRef) {
    const byId = index.byId.get(rawRef);
    if (byId) return byId;
    const byCode = index.byCode.get(rawRef.toLocaleUpperCase('tr-TR'));
    if (byCode) return byCode;
    const byDisplay = index.byDisplayCode.get(rawRef.toLocaleUpperCase('tr-TR'));
    if (byDisplay) return byDisplay;
  }
  const normalizedName = normalizeKey(name);
  if (normalizedName && index.byName.has(normalizedName)) return index.byName.get(normalizedName);
  const normalizedSlug = toSlug(slug || name || '');
  if (normalizedSlug && index.bySlug.has(normalizedSlug.toLocaleLowerCase('tr-TR'))) {
    return index.bySlug.get(normalizedSlug.toLocaleLowerCase('tr-TR'));
  }
  return null;
};

const groupByCategory = (labels) => {
  const grouped = new Map();
  labels.forEach((label) => {
    const key = String(label.categoryId || '');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(label.labelName);
  });
  return grouped;
};

const persistCategoryEtiketler = async (categories, labels) => {
  const grouped = groupByCategory(labels);
  for (const category of categories) {
    if (category.parentCategoryId) continue;
    const list = (grouped.get(String(category.id)) || []).slice().sort((a, b) => a.localeCompare(b, 'tr'));
    const nextEtiketler = list.join(', ');
    await categoryRepo.updateById(category.id, {
      ...category,
      etiketler: nextEtiketler,
      updatedAt: new Date().toISOString(),
    });
  }
};

const getExistingLabelNames = (existingMaster = []) => {
  const deduped = new Map();
  existingMaster
    .map((item) => normalizeUnicodeText(item?.labelName || '').trim())
    .filter(Boolean)
    .forEach((labelName) => {
      const key = normalizeKey(labelName);
      if (!deduped.has(key)) deduped.set(key, labelName);
    });
  return [...deduped.values()];
};

const buildMasterLabels = async ({ existingMaster = [] } = {}) => {
  const [categories, products] = await Promise.all([
    categoryRepo.getAll(),
    productRepo.getAll(),
  ]);
  const authoritativeLabels = getExistingLabelNames(existingMaster);

  const mainCategories = categories.filter((item) => !item.parentCategoryId);
  const categoryByCode = new Map();
  const categoryByName = new Map();
  mainCategories.forEach((category) => {
    const code = String(category.code || '').trim().toLocaleUpperCase('tr-TR');
    if (code) categoryByCode.set(code, category);
    categoryByName.set(normalizeKey(category.name), category);
  });

  const oldByName = new Map();
  existingMaster.forEach((item) => {
    oldByName.set(normalizeKey(item?.labelName), item);
  });

  const hints = new Map();
  const ensureHintBucket = (labelName) => {
    const key = normalizeKey(labelName);
    if (!hints.has(key)) hints.set(key, new Map());
    return hints.get(key);
  };
  const addHint = (labelName, categoryCode, score = 1) => {
    const normalizedCode = String(categoryCode || '').trim().toLocaleUpperCase('tr-TR');
    if (!normalizedCode) return;
    const bucket = ensureHintBucket(labelName);
    bucket.set(normalizedCode, (bucket.get(normalizedCode) || 0) + score);
  };

  existingMaster.forEach((item) => addHint(item?.labelName, item?.categoryCode, 10));

  products.forEach((product) => {
    const labelName = normalizeUnicodeText(product?.etiket || '').trim();
    if (!labelName) return;
    const category = categories.find((cat) => String(cat.id) === String(product.categoryId || ''));
    const mainCategory = category?.parentCategoryId
      ? categories.find((cat) => String(cat.id) === String(category.parentCategoryId))
      : category;
    if (!mainCategory?.code) return;
    addHint(labelName, mainCategory.code, 5);
  });

  const takenCodes = new Set();
  const takenDisplayCodes = new Set();
  const displayCodeCounter = new Map();
  const labels = [];

  authoritativeLabels.forEach((labelName, index) => {
    const key = normalizeKey(labelName);
    const old = oldByName.get(key) || null;
    const hintBucket = hints.get(key) || new Map();
    const categoryCode = pickBestCategoryCode(hintBucket, old?.categoryCode || 'GENEL');
    const category = categoryByCode.get(categoryCode) || null;
    const labelSlug = toSlug(labelName);
    const labelId = String(old?.labelId || old?.id || `lbl-${toSlug(`${categoryCode}-${labelName}`) || index + 1}`);
    const readablePrefix = buildCategoryPrefix(categoryCode);
    const readableToken = buildReadableToken(labelName);
    const displayCounterKey = `${readablePrefix}-${readableToken}`;
    const nextSeq = (displayCodeCounter.get(displayCounterKey) || 0) + 1;
    displayCodeCounter.set(displayCounterKey, nextSeq);
    let labelDisplayCode = `${readablePrefix}-${readableToken}-${String(nextSeq).padStart(3, '0')}`;
    while (takenDisplayCodes.has(labelDisplayCode)) {
      const seq = (displayCodeCounter.get(displayCounterKey) || nextSeq) + 1;
      displayCodeCounter.set(displayCounterKey, seq);
      labelDisplayCode = `${readablePrefix}-${readableToken}-${String(seq).padStart(3, '0')}`;
    }
    takenDisplayCodes.add(labelDisplayCode);

    const labelCode = old?.labelCode
      ? String(old.labelCode)
      : toLabelCode(categoryCode, labelSlug, takenCodes);

    const legacyCodes = [];
    uniquePush(legacyCodes, old?.labelCode);
    uniquePush(legacyCodes, old?.labelDisplayCode);
    (Array.isArray(old?.legacyCodes) ? old.legacyCodes : []).forEach((entry) => uniquePush(legacyCodes, entry));

    labels.push({
      labelId,
      labelCode,
      labelDisplayCode,
      labelName,
      labelSlug,
      categoryId: category?.id || null,
      categoryCode,
      isActive: old?.isActive !== false,
      sortOrder: index + 1,
      legacyCodes,
    });
  });

  return labels;
};

const buildAudit = ({ masterLabels, products, categories, preIndex }) => {
  const index = preIndex || buildMasterIndex(masterLabels);

  const duplicateLabelNameMap = new Map();
  const codeToLabelIds = new Map();
  const slugToLabelIds = new Map();
  const categoryCodeMissing = [];
  const mojibakeMatches = [];

  const mojibakePattern = /(Ã|Ä|Å|�|\?stanbul|\?)/u;

  masterLabels.forEach((label) => {
    const nameKey = normalizeKey(label.labelName);
    if (!duplicateLabelNameMap.has(nameKey)) duplicateLabelNameMap.set(nameKey, []);
    duplicateLabelNameMap.get(nameKey).push(label.labelId);

    const addCode = (code) => {
      const key = String(code || '').trim().toLocaleUpperCase('tr-TR');
      if (!key) return;
      if (!codeToLabelIds.has(key)) codeToLabelIds.set(key, new Set());
      codeToLabelIds.get(key).add(label.labelId);
    };
    addCode(label.labelCode);
    addCode(label.labelDisplayCode);
    (Array.isArray(label.legacyCodes) ? label.legacyCodes : []).forEach(addCode);

    const slugKey = String(label.labelSlug || '').trim().toLocaleLowerCase('tr-TR');
    if (slugKey) {
      if (!slugToLabelIds.has(slugKey)) slugToLabelIds.set(slugKey, new Set());
      slugToLabelIds.get(slugKey).add(label.labelId);
    }

    if (!String(label.categoryCode || '').trim()) categoryCodeMissing.push(label.labelId);
    if (mojibakePattern.test(String(label.labelName || ''))) mojibakeMatches.push(`label:${label.labelId}`);
  });

  const duplicates = [...duplicateLabelNameMap.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ name, labelIds: ids }));

  const sameCodeMultipleLabels = [...codeToLabelIds.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([code, ids]) => ({ code, labelIds: [...ids] }));

  const slugCollisions = [...slugToLabelIds.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([slug, ids]) => ({ slug, labelIds: [...ids] }));

  const productWithoutMaster = [];
  const productBrokenRef = [];
  products.forEach((product) => {
    const payload = product?.payload && typeof product.payload === 'object' ? product.payload : {};
    const candidateRef = payload.labelId || product.tagId || product.selectedTagId || product.etiket || '';
    const resolved = resolveLabelFromAny({ ref: candidateRef, name: product.etiket, slug: payload.labelSlug || '' }, index);
    if (!resolved && String(product.etiket || '').trim()) {
      productWithoutMaster.push({ productId: product.id, etiket: product.etiket });
    }
    if (candidateRef && !resolved) {
      productBrokenRef.push({ productId: product.id, ref: candidateRef });
    }
    if (mojibakePattern.test(String(product.etiket || ''))) {
      mojibakeMatches.push(`product:${product.id}`);
    }
  });

  const categoryMap = new Map(categories.map((item) => [String(item.id), item]));
  const categoriesMissingLabelLinks = masterLabels
    .filter((item) => !categoryMap.has(String(item.categoryId || '')))
    .map((item) => item.labelId);

  return {
    duplicateLabelsByName: duplicates,
    sameCodeMappedToMultipleLabels: sameCodeMultipleLabels,
    categoryCodeMissing,
    slugCollisions,
    mojibakeMatches,
    productWithoutMasterLabel: productWithoutMaster,
    brokenProductLabelReferences: productBrokenRef,
    labelsWithMissingCategory: categoriesMissingLabelLinks,
  };
};

const normalizeProductsToCanonicalLabels = async ({ products, index }) => {
  let updatedCount = 0;
  let brokenFixedCount = 0;
  const unresolved = [];

  for (const product of products) {
    const payload = product?.payload && typeof product.payload === 'object' ? product.payload : {};
    const currentRef = payload.labelId || product.tagId || product.selectedTagId || product.etiket || '';
    const resolved = resolveLabelFromAny({ ref: currentRef, name: product.etiket, slug: payload.labelSlug || '' }, index);
    if (!resolved) {
      if (String(product.etiket || '').trim()) {
        unresolved.push({ productId: product.id, etiket: product.etiket, ref: currentRef });
      }
      continue;
    }

    const nextPayload = {
      ...payload,
      labelId: resolved.labelId,
      labelCode: resolved.labelCode,
      labelDisplayCode: resolved.labelDisplayCode,
      labelSlug: resolved.labelSlug,
      legacyLabelCodes: resolved.legacyCodes || [],
    };

    const nextProduct = {
      ...product,
      etiket: resolved.labelName,
      tagId: resolved.labelId,
      selectedTagId: resolved.labelId,
      payload: nextPayload,
      updatedAt: new Date().toISOString(),
    };

    const changed = JSON.stringify({
      etiket: product.etiket,
      tagId: product.tagId,
      selectedTagId: product.selectedTagId,
      payloadLabelId: payload.labelId,
      payloadLabelCode: payload.labelCode,
      payloadLabelDisplayCode: payload.labelDisplayCode,
    }) !== JSON.stringify({
      etiket: nextProduct.etiket,
      tagId: nextProduct.tagId,
      selectedTagId: nextProduct.selectedTagId,
      payloadLabelId: nextPayload.labelId,
      payloadLabelCode: nextPayload.labelCode,
      payloadLabelDisplayCode: nextPayload.labelDisplayCode,
    });

    if (changed) {
      updatedCount += 1;
      if (currentRef && String(currentRef) !== String(resolved.labelId)) brokenFixedCount += 1;
      await productRepo.updateById(product.id, nextProduct);
    }
  }

  return { updatedCount, brokenFixedCount, unresolved };
};

export const categoryLabelService = {
  async list() {
    const settings = await settingsRepo.getSettings();
    const labels = Array.isArray(settings?.categoryLabelMaster) ? settings.categoryLabelMaster : [];
    return labels
      .map((item) => ({
        ...item,
        labelId: String(item.labelId || item.id || '').trim(),
        labelName: normalizeUnicodeText(item.labelName || '').trim(),
        labelSlug: toSlug(item.labelSlug || item.labelName || ''),
        legacyCodes: Array.isArray(item.legacyCodes) ? item.legacyCodes : [],
      }))
      .filter((item) => item.labelId && item.labelName)
      .sort((left, right) =>
        Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
        || String(left.labelDisplayCode || '').localeCompare(String(right.labelDisplayCode || ''), 'tr')
      );
  },

  async resolveLabel(reference = {}) {
    const labels = await this.list();
    const index = buildMasterIndex(labels);
    return resolveLabelFromAny(reference, index);
  },

  async syncAuthoritative() {
    const [settings, categories, products] = await Promise.all([
      settingsRepo.getSettings(),
      categoryRepo.getAll(),
      productRepo.getAll(),
    ]);
    const existingMaster = Array.isArray(settings?.categoryLabelMaster) ? settings.categoryLabelMaster : [];
    const labels = await buildMasterLabels({ existingMaster });
    const index = buildMasterIndex(labels);
    const migration = await normalizeProductsToCanonicalLabels({ products, index });
    const audit = buildAudit({ masterLabels: labels, products: await productRepo.getAll(), categories, preIndex: index });

    const nextSettings = {
      ...(settings && typeof settings === 'object' ? settings : {}),
      categoryLabelMaster: labels,
      categoryLabelSyncMeta: {
        source: 'postgres.settings.categoryLabelMaster',
        authoritativeCount: labels.length,
        syncedAt: new Date().toISOString(),
      },
    };
    await settingsRepo.updateSettings(nextSettings);
    await persistCategoryEtiketler(categories, labels);

    return {
      authoritativeCount: labels.length,
      migratedProductCount: migration.updatedCount,
      brokenProductReferenceFixedCount: migration.brokenFixedCount,
      unresolvedProductLabelCount: migration.unresolved.length,
      unresolvedProductLabels: migration.unresolved.slice(0, 250),
      audit,
      labels,
    };
  },
};
