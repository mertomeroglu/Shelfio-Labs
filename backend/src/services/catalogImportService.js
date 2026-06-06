import { v4 as uuidv4 } from 'uuid';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { catalogImportRepo } from '../repositories/catalogImportRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { supplierCatalogVersionRepo } from '../repositories/supplierCatalogVersionRepository.js';
import { supplierProductRepo } from '../repositories/supplierProductRepository.js';
import { supplierRepo } from '../repositories/supplierRepository.js';
import { normalizeUnit } from '../utils/unitSystem.js';
import { resolveProductBaseUnit } from '../utils/productUnitQuality.js';


const CATALOG_MATCH_STATUSES = {
  MATCHED: 'Eşleşti',
  NEW_PRODUCT: 'Yeni Ürün',
  MANUAL: 'Manuel Kontrol',
  INVALID: 'Hatalı',
};

const CATALOG_CLASSIFICATIONS = {
  MATCHED: 'Eşleşti',
  NEW_PRODUCT: 'Yeni Ürün',
  UPDATE: 'Güncellenecek',
  MISSING: 'Eksik Veri',
  CONFLICT: 'Çakışmalı Kayıt',
};

const ACTION_TYPES = {
  VIEW: 'VIEW',
  MATCHED: 'MATCHED',
  MANUAL_MATCH: 'MANUAL_MATCH',
  CREATE_NEW_PRODUCT: 'CREATE_NEW_PRODUCT',
  APPROVE_UPDATE: 'APPROVE_UPDATE',
  INVALID: 'INVALID',
  CONFLICT: 'CONFLICT',
  EXCLUDE: 'EXCLUDE',
};

const MANUAL_DECISIONS = {
  MANUAL_MATCH: 'manual_match',
  CREATE_DRAFT_PRODUCT: 'create_draft_product',
  SKIP: 'skip',
  REJECT: 'reject',
};

const CATALOG_APPROVAL_STATUSES = {
  PENDING: 'pending_approval',
  MANUAL_MATCH_NEEDED: 'manual_match_needed',
  DRAFT_CREATED: 'draft_created',
  RESOLVED_MANUAL_MATCH: 'resolved_manual_match',
  RESOLVED_DRAFT_CREATED: 'resolved_draft_created',
  REJECTED: 'rejected',
  RESOLVED: 'resolved',
};

const REQUIRED_IMPORT_COLUMNS = ['productName'];
const REQUIRED_NEW_PRODUCT_FIELDS = ['productName', 'unit', 'purchasePrice', 'categoryName', 'brand'];

const FIELD_ALIASES = {
  productName: ['urunadi', 'productname', 'name', 'urun', 'itemname'],
  supplierProductCode: ['tedarikciurunkodu', 'supplierproductcode', 'suppliercode', 'vendorcode', 'urun_kodu'],
  barcode: ['barkod', 'barcode', 'ean', 'gtin'],
  sku: ['sku', 'stokkodu', 'stok_kodu'],
  unit: ['birim', 'unit', 'olcubirimi'],
  unitsPerCase: ['koliici', 'unitspercase', 'quantitypercase', 'koli'],
  purchasePrice: ['alisfiyati', 'purchaseprice', 'price', 'fiyat'],
  minimumOrderQty: ['moq', 'minimumorderqty', 'minorderqty', 'minimumsiparis'],
  leadTimeDays: ['terminsuresi', 'leadtimedays', 'leadtime', 'teslimsuresi'],
  campaignInfo: ['kampanya', 'kampanyabilgisi', 'campaign', 'discount', 'campaigninfo'],
  categoryName: ['kategori', 'category', 'categoryname'],
  brand: ['marka', 'brand'],
  isActive: ['aktiflik', 'isactive', 'active', 'durum'],
  categoryPath: ['categorypath', 'kategoriyolu'],
  subCategory: ['subcategory', 'altkategori'],
  productDescription: ['productdescription', 'description', 'urunaciklamasi'],
  shortDescription: ['shortdescription', 'shortdesc', 'kisaaciklama'],
  manufacturerCode: ['manufacturercode', 'ureticiurunodu', 'ureticiurunkodu'],
  modelCode: ['modelcode', 'modelkodu'],
  baseUnit: ['baseunit', 'anabirim'],
  packSize: ['packsize', 'paketboyutu', 'ambalaj'],
  casesPerPallet: ['casesperpallet', 'paletkoliadedi'],
  caseBarcode: ['casebarcode', 'kolibarkodu'],
  quantityPerPackage: ['quantityperpackage', 'paketicimiktar'],
  netWeight: ['netweight', 'netagirlik'],
  grossWeight: ['grossweight', 'brutagirlik'],
  volume: ['volume', 'hacim'],
  packageType: ['packagetype', 'ambalajtipi'],
  storageType: ['storagetype', 'saklamatipi'],
  listPrice: ['listprice', 'listefiyati'],
  recommendedSalePrice: ['recommendedsaleprice', 'onerilensatisfiyati', 'saleprice'],
  currency: ['currency', 'parabirimi'],
  vatRate: ['vatrate', 'kdv', 'kdvorani'],
  discountRate: ['discountrate', 'indirimorani'],
  discountAmount: ['discountamount', 'indirimtutari'],
  campaignPrice: ['campaignprice', 'kampanyafiyati'],
  priceValidFrom: ['pricevalidfrom', 'fiyatbaslangic'],
  priceValidUntil: ['pricevaliduntil', 'fiyatbitis'],
  maximumOrderQty: ['maximumorderqty', 'maxorderqty', 'maksimumsiparis'],
  orderMultiple: ['ordermultiple', 'sipariskati'],
  availabilityStatus: ['availabilitystatus', 'bulunurluk'],
  supplierStockQty: ['supplierstockqty', 'tedarikcistok'],
  supplierWarehouseCode: ['supplierwarehousecode', 'tedarikcidepokodu'],
  deliveryType: ['deliverytype', 'teslimattipi'],
  returnable: ['returnable', 'iadeedilebilir'],
  catalogVersion: ['catalogversion', 'katalogversiyonu'],
  catalogValidFrom: ['catalogvalidfrom', 'katalogbaslangic'],
  catalogValidUntil: ['catalogvaliduntil', 'katalogbitis'],
  supplierNote: ['suppliernote', 'tedarikcinotu'],
  rowAction: ['rowaction', 'satiraksiyonu'],
  imageUrl: ['imageurl', 'gorselurl'],
  productUrl: ['producturl', 'urunurl'],
  manualNote: ['manualnote', 'manuelnot'],
  expectedMatchHint: ['expectedmatchhint', 'bekleneneslesme'],
  suggestedCategory: ['suggestedcategory', 'onerilenkategori'],
  suggestedBrand: ['suggestedbrand', 'onerilenmarka'],
  suggestedUnit: ['suggestedunit', 'onerilenbirim'],
};

const NUMERIC_IMPORT_FIELDS = new Set([
  'unitsPerCase',
  'purchasePrice',
  'minimumOrderQty',
  'leadTimeDays',
  'casesPerPallet',
  'quantityPerPackage',
  'netWeight',
  'grossWeight',
  'listPrice',
  'recommendedSalePrice',
  'vatRate',
  'discountRate',
  'discountAmount',
  'campaignPrice',
  'maximumOrderQty',
  'orderMultiple',
  'supplierStockQty',
]);

const DATE_IMPORT_FIELDS = new Set([
  'priceValidFrom',
  'priceValidUntil',
  'catalogValidFrom',
  'catalogValidUntil',
]);

const normalizeText = (value) => String(value || '').trim();
const normalizeComparable = (value) => normalizeText(value).toLocaleLowerCase('tr-TR');
const normalizeKey = (value) => normalizeText(value).toLowerCase('tr-TR').replace(/[^a-z0-9ığüşöç]/g, '');

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const toBooleanOrNull = (value) => {
  const raw = normalizeText(value).toLocaleLowerCase('tr-TR');
  if (!raw) return null;
  if (['true', '1', 'yes', 'y', 'evet', 'aktif'].includes(raw)) return true;
  if (['false', '0', 'no', 'n', 'hayir', 'hayır', 'pasif'].includes(raw)) return false;
  return null;
};

const parseDate = (value) => {
  const raw = normalizeText(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const tokenize = (value) => normalizeText(value)
  .toLocaleLowerCase('tr-TR')
  .split(/\s+/)
  .map((item) => item.trim())
  .filter(Boolean);

const scoreNameSimilarity = (leftName, rightName) => {
  const leftTokens = new Set(tokenize(leftName));
  const rightTokens = new Set(tokenize(rightName));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });

  const union = leftTokens.size + rightTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
};

const parseDateOnly = (value) => {
  const parsed = parseDate(value);
  return parsed ? parsed.slice(0, 10) : '';
};

const getProductCategoryName = (product = {}) => normalizeText(
  product.categoryName
  || product.category?.name
  || product.etiket
  || product.categoryLabel
);

const hasMeaningfulValue = (value) => normalizeText(value).length > 0;

const valuesConflict = (left, right) => (
  hasMeaningfulValue(left)
  && hasMeaningfulValue(right)
  && normalizeComparable(left) !== normalizeComparable(right)
);

const isPackSizeConflict = (left, right) => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  if (leftNumber <= 0 || rightNumber <= 0) return false;
  return leftNumber !== rightNumber;
};

const evaluateMatchGuards = ({ row, product, reason }) => {
  if (!product) {
    return {
      canAutoMatch: false,
      riskLevel: 'high',
      guardIssues: ['matched_product_missing'],
      blockingIssue: 'matched_product_missing',
    };
  }

  const guardIssues = [];
  if (valuesConflict(row.brand, product.brand)) guardIssues.push('brand_conflict');
  if (valuesConflict(row.unit, product.unit)) guardIssues.push('unit_conflict');
  if (isPackSizeConflict(row.unitsPerCase, product.unitsPerCase)) guardIssues.push('pack_size_conflict');
  const rowCategory = row.categoryName || row.categoryPath;
  if (valuesConflict(rowCategory, getProductCategoryName(product))) guardIssues.push('category_conflict');

  const strongIdentifier = ['barcode', 'sku', 'supplier_product_code'].includes(reason);
  const nameOnly = reason === 'name_similarity';

  return {
    canAutoMatch: strongIdentifier && guardIssues.length === 0 && !nameOnly,
    riskLevel: guardIssues.length ? 'high' : (nameOnly ? 'medium' : 'low'),
    guardIssues,
    blockingIssue: guardIssues[0] || '',
  };
};

const isValidBarcode = (barcode) => {
  const raw = normalizeText(barcode);
  if (!raw) return false;
  if (!/^[0-9]+$/.test(raw)) return false;
  return raw.length >= 8 && raw.length <= 14;
};

const confidenceLabelFor = (score) => {
  const numeric = Number(score || 0);
  if (numeric >= 92) return 'high';
  if (numeric >= 65) return 'medium';
  if (numeric > 0) return 'low';
  return 'none';
};

const getMappedValue = (row, aliases) => {
  const entries = Object.entries(row || {});
  for (const [key, value] of entries) {
    if (aliases.includes(normalizeKey(key))) {
      return value;
    }
  }
  return '';
};

const readImportField = (row, fieldName) => getMappedValue(row, FIELD_ALIASES[fieldName] || [fieldName]);

const normalizeImportRow = (row = {}, index = 0) => {
  const productName = normalizeText(readImportField(row, 'productName'));
  const supplierProductCode = normalizeText(readImportField(row, 'supplierProductCode'));
  const barcode = normalizeText(readImportField(row, 'barcode'));
  const sku = normalizeText(readImportField(row, 'sku'));
  const categoryName = normalizeText(readImportField(row, 'categoryName'));
  const rawUnit = normalizeText(readImportField(row, 'unit'));
  const unit = resolveProductBaseUnit({
    name: productName,
    etiket: categoryName,
    categoryName,
    unit: normalizeUnit(rawUnit, categoryName),
  }).unit;
  const unitsPerCase = toNumberOrNull(readImportField(row, 'unitsPerCase')) || 1;
  const purchasePrice = toNumberOrNull(readImportField(row, 'purchasePrice'));
  const minimumOrderQty = toNumberOrNull(readImportField(row, 'minimumOrderQty')) || 1;
  const leadTimeDays = toNumberOrNull(readImportField(row, 'leadTimeDays'));
  const campaignInfo = normalizeText(readImportField(row, 'campaignInfo'));
  const brand = normalizeText(readImportField(row, 'brand'));
  const activeParsed = toBooleanOrNull(readImportField(row, 'isActive'));

  const extraFields = {};
  Object.keys(FIELD_ALIASES).forEach((fieldName) => {
    if ([
      'productName',
      'supplierProductCode',
      'barcode',
      'sku',
      'unit',
      'unitsPerCase',
      'purchasePrice',
      'minimumOrderQty',
      'leadTimeDays',
      'campaignInfo',
      'categoryName',
      'brand',
      'isActive',
      'currency',
      'vatRate',
      'listPrice',
      'recommendedSalePrice',
    ].includes(fieldName)) return;

    const rawValue = readImportField(row, fieldName);
    if (NUMERIC_IMPORT_FIELDS.has(fieldName)) {
      extraFields[fieldName] = toNumberOrNull(rawValue);
    } else if (DATE_IMPORT_FIELDS.has(fieldName)) {
      extraFields[fieldName] = parseDateOnly(rawValue);
    } else if (fieldName === 'returnable') {
      extraFields[fieldName] = toBooleanOrNull(rawValue);
    } else {
      extraFields[fieldName] = normalizeText(rawValue);
    }
  });

  return {
    rowId: `row-${index + 1}`,
    rowNumber: index + 1,
    excelProductName: productName,
    supplierProductCode,
    barcode,
    sku,
    unit,
    unitsPerCase,
    purchasePrice,
    minimumOrderQty,
    leadTimeDays: leadTimeDays || 0,
    campaignInfo,
    categoryName,
    brand,
    isActive: activeParsed ?? true,
    currency: normalizeText(readImportField(row, 'currency')) || 'TRY',
    vatRate: toNumberOrNull(readImportField(row, 'vatRate')),
    listPrice: toNumberOrNull(readImportField(row, 'listPrice')),
    recommendedSalePrice: toNumberOrNull(readImportField(row, 'recommendedSalePrice')),
    ...extraFields,
    original: row,
  };
};

const findBestProductMatch = ({ row, products, supplierProducts, supplierId }) => {
  const barcodeMatch = row.barcode
     ? products.find((item) => normalizeText(item.barcode) && normalizeText(item.barcode) === row.barcode)
    : null;
  if (barcodeMatch) {
    return { product: barcodeMatch, score: 0.98, reason: 'barcode' };
  }

  const supplierCodeMatch = row.supplierProductCode
     ? supplierProducts.find((item) => String(item.supplierId) === String(supplierId) && normalizeText(item.supplierProductCode) === row.supplierProductCode)
    : null;

  if (supplierCodeMatch) {
    const product = products.find((item) => String(item.id) === String(supplierCodeMatch.productId));
    if (product) {
      return { product, score: 0.94, reason: 'supplier_product_code' };
    }
  }

  let best = null;
  for (const product of products) {
    const skuScore = row.sku && normalizeText(product.sku) === row.sku ? 1 : 0;
    const nameScore = scoreNameSimilarity(row.excelProductName, product.name);
    const score = Math.max(skuScore * 0.95, nameScore);
    if (!best || score > best.score) {
      best = { product, score, reason: skuScore ? 'sku' : 'name_similarity' };
    }
  }

  return best && best.score >= 0.45 ? best : null;
};

const collectLegacyRowErrors = ({ row, duplicateBarcodeRows, duplicateSupplierCodeRows }) => {
  const errors = [];

  if (!row.excelProductName) {
    errors.push('Ürün adı eksik');
  }

  if (!row.barcode) {
    errors.push('Barkod eksik');
  } else if (!isValidBarcode(row.barcode)) {
    errors.push('Invalid barcode format');
  }

  if (row.purchasePrice === null || row.purchasePrice <= 0) {
    errors.push('Fiyat formatı hatalı');
  }

  if (!Number.isFinite(Number(row.minimumOrderQty)) || Number(row.minimumOrderQty) <= 0) {
    errors.push('MOQ hatalı');
  }

  if (duplicateBarcodeRows.has(row.barcode) && row.barcode) {
    errors.push('Duplicate satır (aynı barkod birden fazla satırda)');
  }

  if (duplicateSupplierCodeRows.has(row.supplierProductCode) && row.supplierProductCode) {
    errors.push('Aynı tedarikçi ürün kodu birden fazla satırda');
  }

  return errors;
};

const collectRowErrors = ({ row, duplicateBarcodeRows, duplicateSupplierCodeRows }) => {
  const errors = [];
  const missingRequiredFieldNames = [];

  if (!row.excelProductName) missingRequiredFieldNames.push('productName');
  if (!row.barcode && !row.supplierProductCode) missingRequiredFieldNames.push('supplierProductCode|barcode');
  if (row.purchasePrice === null || row.purchasePrice <= 0) missingRequiredFieldNames.push('purchasePrice');
  if (!row.unit) missingRequiredFieldNames.push('unit');
  if (!row.categoryName) missingRequiredFieldNames.push('categoryName');
  if (!row.brand) missingRequiredFieldNames.push('brand');

  if (row.barcode && !isValidBarcode(row.barcode)) {
    errors.push('Invalid barcode format');
  }

  if (!Number.isFinite(Number(row.minimumOrderQty)) || Number(row.minimumOrderQty) <= 0) {
    errors.push('MOQ invalid');
  }

  if (duplicateBarcodeRows.has(row.barcode) && row.barcode) {
    errors.push('Duplicate barcode in catalog rows');
  }

  if (duplicateSupplierCodeRows.has(row.supplierProductCode) && row.supplierProductCode) {
    errors.push('Duplicate supplier product code in catalog rows');
  }

  return {
    errors: [
      ...missingRequiredFieldNames.map((field) => `Missing required field: ${field}`),
      ...errors,
    ],
    missingRequiredFieldNames,
  };
};

const buildDuplicateSets = (rows) => {
  const barcodeCounter = new Map();
  const supplierCodeCounter = new Map();

  rows.forEach((row) => {
    if (row.barcode) {
      barcodeCounter.set(row.barcode, (barcodeCounter.get(row.barcode) || 0) + 1);
    }

    if (row.supplierProductCode) {
      supplierCodeCounter.set(row.supplierProductCode, (supplierCodeCounter.get(row.supplierProductCode) || 0) + 1);
    }
  });

  const duplicateBarcodeRows = new Set(Array.from(barcodeCounter.entries()).filter(([, count]) => count > 1).map(([value]) => value));
  const duplicateSupplierCodeRows = new Set(Array.from(supplierCodeCounter.entries()).filter(([, count]) => count > 1).map(([value]) => value));

  return { duplicateBarcodeRows, duplicateSupplierCodeRows };
};

const resolveUpdateType = ({ row, existing }) => {
  if (!existing) return 'Yeni Eşleşme';

  const changed = [];
  if (Number(existing.purchasePrice || 0) !== Number(row.purchasePrice || 0)) changed.push('Alış Fiyatı');
  if (Number(existing.minimumOrderQty || 0) !== Number(row.minimumOrderQty || 0)) changed.push('MOQ');
  if (Number(existing.unitsPerCase || 0) !== Number(row.unitsPerCase || 0)) changed.push('Koli İçi');
  if (normalizeText(existing.supplierProductCode) !== normalizeText(row.supplierProductCode)) changed.push('Tedarikçi Ürün Kodu');
  if (Number(existing.leadTimeDays || 0) !== Number(row.leadTimeDays || 0)) changed.push('Termin');

  return changed.length ? changed.join(', ') : 'Değişiklik Yok';
};

const summarizeCounts = (rows) => {
  const summary = {
    matchedCount: 0,
    newProductCount: 0,
    updateCount: 0,
    invalidCount: 0,
    conflictCount: 0,
    manualCount: 0,
    excludedCount: 0,
  };

  rows.forEach((row) => {
    if (row.actionType === ACTION_TYPES.EXCLUDE) summary.excludedCount += 1;

    if (row.classification === CATALOG_CLASSIFICATIONS.MATCHED) summary.matchedCount += 1;
    if (row.classification === CATALOG_CLASSIFICATIONS.NEW_PRODUCT) summary.newProductCount += 1;
    if (row.classification === CATALOG_CLASSIFICATIONS.UPDATE) summary.updateCount += 1;
    if (row.classification === CATALOG_CLASSIFICATIONS.MISSING) summary.invalidCount += 1;
    if (row.classification === CATALOG_CLASSIFICATIONS.CONFLICT) summary.conflictCount += 1;
    if (row.matchStatus === CATALOG_MATCH_STATUSES.MANUAL) summary.manualCount += 1;
  });

  return summary;
};

const stripVersionPayload = (version) => ({
  id: version.id,
  supplierId: version.supplierId,
  supplierName: version.supplierName,
  importId: version.importId,
  fileName: version.fileName,
  uploadedAt: version.uploadedAt,
  validityStart: version.validityStart,
  validityEnd: version.validityEnd,
  isActive: version.isActive === true,
  status: version.status || (version.isActive === true ? 'active' : 'archived'),
  activatedAt: version.activatedAt || null,
  archivedAt: version.archivedAt || null,
  summary: version.summary || {},
});

const buildPreviewRows = ({ rows, products, supplierProducts, supplierId }) => {
  const { duplicateBarcodeRows, duplicateSupplierCodeRows } = buildDuplicateSets(rows);

  return rows.map((row) => {
    const { errors, missingRequiredFieldNames } = collectRowErrors({ row, duplicateBarcodeRows, duplicateSupplierCodeRows });

    const bestMatch = findBestProductMatch({ row, products, supplierProducts, supplierId });
    const matchedProduct = bestMatch?.product || null;
    const matchedProductId = matchedProduct?.id || '';
    const matchedProductName = matchedProduct?.name || '';
    const confidenceScore = Number(((bestMatch?.score || 0) * 100).toFixed(1));
    const guardResult = evaluateMatchGuards({ row, product: matchedProduct, reason: bestMatch?.reason || '' });
    const duplicateBarcode = duplicateBarcodeRows.has(row.barcode) && Boolean(row.barcode);
    const duplicateSupplierCode = duplicateSupplierCodeRows.has(row.supplierProductCode) && Boolean(row.supplierProductCode);
    const invalidBarcode = Boolean(row.barcode) && !isValidBarcode(row.barcode);

    const existingSupplierProduct = matchedProductId
       ? supplierProducts.find((item) => String(item.supplierId) === String(supplierId) && String(item.productId) === String(matchedProductId))
      : null;

    let classification = CATALOG_CLASSIFICATIONS.NEW_PRODUCT;
    let matchStatus = CATALOG_MATCH_STATUSES.NEW_PRODUCT;
    let actionType = ACTION_TYPES.CREATE_NEW_PRODUCT;

    if (errors.length) {
      classification = duplicateBarcode || duplicateSupplierCode
         ? CATALOG_CLASSIFICATIONS.CONFLICT
        : CATALOG_CLASSIFICATIONS.MISSING;
      matchStatus = CATALOG_MATCH_STATUSES.INVALID;
      actionType = duplicateBarcode || duplicateSupplierCode ? ACTION_TYPES.CONFLICT : ACTION_TYPES.INVALID;
    } else if (bestMatch && confidenceScore >= 92 && guardResult.canAutoMatch) {
      const updateType = resolveUpdateType({ row, existing: existingSupplierProduct });
      classification = updateType === 'Değişiklik Yok' ? CATALOG_CLASSIFICATIONS.MATCHED : CATALOG_CLASSIFICATIONS.UPDATE;
      matchStatus = CATALOG_MATCH_STATUSES.MATCHED;
      actionType = ACTION_TYPES.MATCHED;
    } else if (bestMatch && confidenceScore >= 45) {
      classification = CATALOG_CLASSIFICATIONS.UPDATE;
      matchStatus = CATALOG_MATCH_STATUSES.MANUAL;
      actionType = ACTION_TYPES.MANUAL_MATCH;
    }

    const manualActionRequired = (
      actionType === ACTION_TYPES.CREATE_NEW_PRODUCT
      || actionType === ACTION_TYPES.MANUAL_MATCH
      || actionType === ACTION_TYPES.INVALID
      || actionType === ACTION_TYPES.CONFLICT
    );
    const reasonParts = [
      bestMatch?.reason ? `match:${bestMatch.reason}` : 'no_match',
      ...guardResult.guardIssues,
      ...errors,
    ].filter(Boolean);

    return {
      ...row,
      matchedProductId,
      matchedProductName,
      matchedSku: matchedProduct?.sku || '',
      matchedBarcode: matchedProduct?.barcode || '',
      matchedBrand: matchedProduct?.brand || '',
      matchedCategory: matchedProduct ? getProductCategoryName(matchedProduct) : '',
      matchedUnit: matchedProduct?.unit || '',
      confidenceScore,
      confidenceLabel: confidenceLabelFor(confidenceScore),
      matchReason: bestMatch?.reason || '',
      existingSupplierProductId: existingSupplierProduct?.id || '',
      existingSupplierProductCode: existingSupplierProduct?.supplierProductCode || '',
      classification,
      matchStatus,
      updateType: resolveUpdateType({ row, existing: existingSupplierProduct }),
      actionType,
      decision: manualActionRequired ? 'manual_review_required' : 'auto_commit_ready',
      reason: reasonParts.join(' | '),
      riskLevel: guardResult.riskLevel,
      blockingIssue: guardResult.blockingIssue,
      duplicateBarcode,
      duplicateSupplierCode,
      invalidBarcode,
      missingRequiredFields: errors.length > 0,
      missingRequiredFieldNames,
      manualActionRequired,
      suggestedAction: actionType === ACTION_TYPES.CREATE_NEW_PRODUCT
        ? 'Review and approve as a new product'
        : actionType === ACTION_TYPES.MANUAL_MATCH
          ? 'Select the correct existing product'
          : actionType === ACTION_TYPES.INVALID || actionType === ACTION_TYPES.CONFLICT
            ? 'Fix catalog row before commit'
            : 'Commit supplier product update',
      canCommit: actionType === ACTION_TYPES.MATCHED,
      willCreateProduct: false,
      willUpdateSupplierProduct: actionType === ACTION_TYPES.MATCHED,
      willSkipPendingApproval: actionType === ACTION_TYPES.CREATE_NEW_PRODUCT || actionType === ACTION_TYPES.MANUAL_MATCH,
      createsDraftProductAutomatically: false,
      expectedCreateDraftProductsFlag: false,
      catalogVisibility: actionType === ACTION_TYPES.CREATE_NEW_PRODUCT ? 'pending_approval' : '',
      productIsListed: matchedProduct ? matchedProduct.isListed !== false : null,
      productIsActive: matchedProduct ? matchedProduct.isActive !== false : null,
      hardDeleteConflictRisk: false,
      note: manualActionRequired ? 'Ürün oluşturma veya mevcut ürüne bağlama işlemi için manuel onay gerekir.' : '',
      errors,
      isExcluded: false,
      manualProductId: '',
      lastImportAt: new Date().toISOString(),
    };
  });
};

const ensureImportColumns = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError(400, 'Excel dosyasında işlenecek satır bulunamadı.');
  }

  const first = rows[0] || {};
  const normalizedKeys = Object.keys(first).map((key) => normalizeKey(key));

  const hasProductName = normalizedKeys.some((key) => FIELD_ALIASES.productName.includes(key));

  if (!hasProductName) {
    throw new AppError(400, `Excel kolonları eksik. Zorunlu kolonlar: ${REQUIRED_IMPORT_COLUMNS.join(', ')}`);
  }
};

const resolveDraftMissingFields = (row = {}) => {
  const missing = [];
  if (!normalizeText(row.excelProductName || row.productName || row.name)) missing.push('productName');
  if (!normalizeText(row.barcode || row.sku)) missing.push('barcodeOrSku');
  if (!normalizeText(row.categoryName)) missing.push('category');
  if (!normalizeText(row.brand)) missing.push('brand');
  if (!normalizeText(row.unit)) missing.push('unit');
  if (!Number(row.purchasePrice || 0)) missing.push('purchasePrice');
  if (!Number(row.recommendedSalePrice || row.salePrice || 0)) missing.push('salePrice');
  if (row.vatRate === '' || row.vatRate === null || row.vatRate === undefined) missing.push('vatRate');
  missing.push('tag', 'section', 'supplierMapping');
  return Array.from(new Set(missing));
};

const compactFieldErrors = (fieldErrors = {}) => Object.fromEntries(
  Object.entries(fieldErrors).filter(([, value]) => Boolean(value))
);

const getDraftCreateErrorDetails = (error, row = {}) => {
  const rawMessage = String(error?.message || '');
  return {
    errorCode: 'CATALOG_DRAFT_PRODUCT_CREATE_FAILED',
    fieldErrors: compactFieldErrors({
      productName: normalizeText(row.excelProductName || row.productName || row.name) ? '' : 'Ürün adı eksik.',
      barcode: normalizeText(row.barcode || row.sku) ? '' : 'Barkod veya SKU eksik.',
      category: error?.code === 'P2003' && rawMessage.includes('products_category_id_fkey')
        ? 'Kategori eşleşemedi; taslak kategori bağlantısı olmadan oluşturulmalı.'
        : '',
      barcodeDuplicate: error?.code === 'P2002' && rawMessage.toLowerCase().includes('barcode')
        ? 'Bu barkod sistemde zaten var.'
        : '',
      skuDuplicate: error?.code === 'P2002' && rawMessage.toLowerCase().includes('sku')
        ? 'Bu SKU sistemde zaten var.'
        : '',
    }),
    details: {
      prismaCode: error?.code || null,
      causeMessage: rawMessage,
    },
  };
};

const createDraftProductPayload = ({ row, supplier, createdAt }) => {
  const id = `prd-${uuidv4().slice(0, 12)}`;
  const missingFields = resolveDraftMissingFields(row);
  const draftPayload = {
    draftSource: 'catalog_import',
    sourceReadModel: 'catalog_import',
    catalogVisibility: 'staged',
    completionStatus: 'incomplete',
    missingFields,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierProductCode: normalizeText(row.supplierProductCode),
    originalCatalogRow: row,
    createdFromCatalogAt: createdAt,
    registerOnOrder: false,
  };
  const normalizedName = normalizeText(row.excelProductName || row.productName || row.name) || 'Yeni Ürün Taslağı';

  return {
    id,
    sku: normalizeText(row.sku) || `DRF-${id.slice(-6).toUpperCase()}`,
    barcode: normalizeText(row.barcode),
    name: normalizedName,
    brand: normalizeText(row.brand),
    categoryId: null,
    categoryName: normalizeText(row.categoryName),
    supplierId: supplier.id,
    supplierName: supplier.name,
    unit: resolveProductBaseUnit({
      name: row.excelProductName || row.productName || row.name,
      etiket: normalizeText(row.categoryName),
      categoryName: normalizeText(row.categoryName),
      unit: normalizeUnit(row.unit, normalizeText(row.categoryName)),
    }).unit,
    purchasePrice: Number(row.purchasePrice || 0),
    salePrice: Number(row.recommendedSalePrice || row.salePrice || row.purchasePrice || 0),
    criticalStock: 0,
    maxShelfStock: 0,
    maxStock: 0,
    unitsPerCase: Math.max(1, Number(row.unitsPerCase || 1)),
    casesPerPallet: 1,
    unitsPerPallet: Math.max(1, Number(row.unitsPerCase || 1)),
    minimumOrderCaseQty: Math.max(1, Number(row.minimumOrderQty || 1)),
    requiredStorageType: 'Ortam',
    isListed: false,
    registerOnOrder: false,
    catalogVisibility: 'staged',
    defaultStatus: 'pending_approval',
    status: 'draft',
    isActive: false,
    sourceReadModel: 'catalog_import',
    completionStatus: 'incomplete',
    missingFields,
    draftSource: 'catalog_import',
    createdAt,
    updatedAt: createdAt,
    lastImportSource: 'supplier_catalog',
    payload: draftPayload,
  };
};

const createCatalogApprovalDraftProductPayload = ({ row, supplier, createdAt, importId }) => {
  const draft = createDraftProductPayload({ row, supplier, createdAt });
  return {
    ...draft,
    catalogImportId: importId,
    catalogImportRowId: row.rowId,
    catalogImportRowNumber: row.rowNumber || null,
    sourceRowHash: row.sourceRowHash || '',
    payload: {
      ...(draft.payload || {}),
      catalogImportId: importId,
      catalogImportRowId: row.rowId,
      catalogImportRowNumber: row.rowNumber || null,
      sourceRowHash: row.sourceRowHash || '',
      catalogVersionId: row.catalogVersionId || '',
      categoryName: normalizeText(row.categoryName),
    },
  };
};

const createOrUpdateSupplierProductPayload = ({ existing, productId, supplierId, row, now }) => ({
  id: existing?.id || `sp-${uuidv4().slice(0, 18)}`,
  productId,
  supplierId,
  supplierProductCode: normalizeText(row.supplierProductCode),
  supplierProductName: normalizeText(row.excelProductName),
  supplierSku: normalizeText(row.sku),
  barcode: normalizeText(row.barcode),
  purchasePrice: Number(row.purchasePrice || existing?.purchasePrice || 0),
  currency: normalizeText(row.currency) || existing?.currency || 'TRY',
  minimumOrderQty: Math.max(1, Number(row.minimumOrderQty || existing?.minimumOrderQty || 1)),
  leadTimeDays: Math.max(1, Number(row.leadTimeDays || existing?.leadTimeDays || 3)),
  priceUnit: normalizeText(row.baseUnit) || existing?.priceUnit || 'adet',
  minOrderUnit: existing?.minOrderUnit || 'koli',
  defaultOrderUnit: normalizeText(row.baseUnit) || existing?.defaultOrderUnit || 'koli',
  unitsPerPack: Math.max(1, Number(existing?.unitsPerPack || 1)),
  unitsPerBox: Math.max(1, Number(existing?.unitsPerBox || 1)),
  unitsPerCase: Math.max(1, Number(row.unitsPerCase || existing?.unitsPerCase || 1)),
  casesPerPallet: Math.max(1, Number(row.casesPerPallet || existing?.casesPerPallet || 1)),
  unitsPerPallet: Math.max(1, Number(existing?.unitsPerPallet || row.unitsPerCase || 1)),
  campaignInfo: normalizeText(row.campaignInfo),
  listPrice: row.listPrice ?? existing?.listPrice ?? null,
  recommendedSalePrice: row.recommendedSalePrice ?? existing?.recommendedSalePrice ?? null,
  vatRate: row.vatRate ?? existing?.vatRate ?? null,
  packSize: normalizeText(row.packSize) || existing?.packSize || '',
  quantityPerPackage: row.quantityPerPackage ?? existing?.quantityPerPackage ?? null,
  caseBarcode: normalizeText(row.caseBarcode) || existing?.caseBarcode || '',
  availabilityStatus: normalizeText(row.availabilityStatus) || existing?.availabilityStatus || '',
  supplierStockQty: row.supplierStockQty ?? existing?.supplierStockQty ?? null,
  supplierWarehouseCode: normalizeText(row.supplierWarehouseCode) || existing?.supplierWarehouseCode || '',
  deliveryType: normalizeText(row.deliveryType) || existing?.deliveryType || '',
  returnable: row.returnable ?? existing?.returnable ?? null,
  supplierNote: normalizeText(row.supplierNote) || existing?.supplierNote || '',
  productDescription: normalizeText(row.productDescription) || existing?.productDescription || '',
  isDefault: existing?.isDefault === true,
  isActive: row.isActive !== false,
  note: existing?.note || 'Katalog import güncellemesi',
  lastPriceUpdate: now,
  createdAt: existing?.createdAt || now,
  updatedAt: now,
});

const normalizeManualDecision = (value) => {
  const decision = normalizeText(value).toLowerCase();
  return Object.values(MANUAL_DECISIONS).includes(decision) ? decision : '';
};

const buildRowDecisionMap = (rowDecisions = []) => {
  const map = new Map();
  if (!Array.isArray(rowDecisions)) return map;

  rowDecisions.forEach((item) => {
    const rowKey = normalizeText(item?.rowId || item?.rowNumber);
    const decision = normalizeManualDecision(item?.decision);
    if (!rowKey || !decision) return;
    map.set(rowKey, {
      decision,
      manualProductId: normalizeText(item.manualProductId),
      decisionNote: normalizeText(item.decisionNote),
    });
  });

  return map;
};

const parseApprovalQueueRowId = (value) => {
  const raw = normalizeText(value);
  const [kind, sourceId, ...rest] = raw.split(':');
  return { kind, sourceId, rowId: rest.join(':') };
};

const isResolvedApprovalStatus = (row = {}) => {
  const status = normalizeText(row.catalogApprovalStatus || row.commitStatus);
  return [
    CATALOG_APPROVAL_STATUSES.RESOLVED_MANUAL_MATCH,
    CATALOG_APPROVAL_STATUSES.RESOLVED_DRAFT_CREATED,
    CATALOG_APPROVAL_STATUSES.REJECTED,
    CATALOG_APPROVAL_STATUSES.RESOLVED,
    'supplier_product_created',
    'supplier_product_updated',
  ].includes(status);
};

const isPendingApprovalImportRow = (row = {}) => {
  if (isResolvedApprovalStatus(row)) return false;
  const status = normalizeText(row.catalogApprovalStatus || row.commitStatus || row.pendingApprovalReason);
  return (
    row.actionType === ACTION_TYPES.CREATE_NEW_PRODUCT
    || row.manualActionRequired === true
    || row.willSkipPendingApproval === true
    || status === CATALOG_APPROVAL_STATUSES.PENDING
    || status === 'manual_decision_pending'
    || status === 'skippedBecauseCreateDraftDisabled'
    || status === 'manual_decision_required'
    || status === 'manual_match_required'
    || Boolean(row.pendingApprovalReason)
  );
};

const isApprovalHistoryImportRow = (row = {}) => (
  isPendingApprovalImportRow(row)
  || [
    CATALOG_APPROVAL_STATUSES.RESOLVED_MANUAL_MATCH,
    CATALOG_APPROVAL_STATUSES.RESOLVED_DRAFT_CREATED,
    CATALOG_APPROVAL_STATUSES.REJECTED,
    CATALOG_APPROVAL_STATUSES.RESOLVED,
  ].includes(normalizeText(row.catalogApprovalStatus || row.commitStatus))
);

const buildProductLookup = (products = []) => ({
  productMap: new Map(products.map((item) => [String(item.id), item])),
  barcodeMap: new Map(
    products
      .filter((item) => normalizeText(item.barcode))
      .map((item) => [normalizeText(item.barcode), item])
  ),
});

const buildSupplierProductLookup = (supplierProducts = [], supplierId = '') => ({
  byProduct: new Map(
    supplierProducts
      .filter((item) => String(item.supplierId) === String(supplierId))
      .map((item) => [`${item.productId}:${item.supplierId}`, item])
  ),
  byCode: new Map(
    supplierProducts
      .filter((item) => String(item.supplierId) === String(supplierId) && normalizeText(item.supplierProductCode))
      .map((item) => [normalizeComparable(item.supplierProductCode), item])
  ),
});

const normalizeApprovalQueueImportRow = ({ row, catalogImport, productLookup, supplierProductLookup, draftProduct = null }) => {
  const duplicateBarcodeProduct = row.barcode ? productLookup.barcodeMap.get(normalizeText(row.barcode)) : null;
  const duplicateSupplierCodeRow = row.supplierProductCode ? supplierProductLookup.byCode.get(normalizeComparable(row.supplierProductCode)) : null;
  const resolvedDraftProduct = draftProduct || productLookup.productMap.get(String(row.draftProductId || row.productId || '')) || null;
  const riskParts = [
    duplicateBarcodeProduct ? 'duplicate_barcode' : '',
    duplicateSupplierCodeRow ? 'duplicate_supplier_code' : '',
    row.invalidBarcode || row.actionType === ACTION_TYPES.INVALID ? 'invalid_or_conflict' : '',
    normalizeText(row.pendingApprovalReason) === 'matched_product_missing' ? 'matched_product_missing' : '',
  ].filter(Boolean);

  return {
    id: `import:${catalogImport.id}:${row.rowId}`,
    sourceType: 'catalog_import_row',
    importId: catalogImport.id,
    supplierId: catalogImport.supplierId,
    supplierName: catalogImport.supplierName,
    catalogVersion: catalogImport.fileName || catalogImport.id,
    fileName: catalogImport.fileName || '',
    uploadedAt: catalogImport.uploadedAt || catalogImport.committedAt || '',
    rowId: row.rowId,
    rowNumber: row.rowNumber || '',
    supplierProductCode: normalizeText(row.supplierProductCode),
    supplierSku: normalizeText(row.sku || row.supplierSku),
    barcode: normalizeText(row.barcode),
    productName: normalizeText(row.excelProductName || row.productName || row.name),
    brand: normalizeText(row.brand || row.brandName),
    category: normalizeText(row.categoryName || row.category),
    unit: normalizeText(row.unit),
    packSize: row.packSize || row.unitsPerCase || '',
    unitsPerCase: row.unitsPerCase || '',
    quantityPerPackage: row.quantityPerPackage || '',
    baseUnit: row.baseUnit || '',
    casesPerPallet: row.casesPerPallet || '',
    caseBarcode: row.caseBarcode || '',
    netWeight: row.netWeight || '',
    grossWeight: row.grossWeight || '',
    volume: row.volume || '',
    packageType: row.packageType || '',
    storageType: row.storageType || '',
    purchasePrice: row.purchasePrice ?? '',
    listPrice: row.listPrice ?? '',
    recommendedSalePrice: row.recommendedSalePrice ?? '',
    currency: row.currency || 'TRY',
    vatRate: row.vatRate ?? '',
    discountRate: row.discountRate ?? '',
    discountAmount: row.discountAmount ?? '',
    campaignPrice: row.campaignPrice ?? '',
    priceValidFrom: row.priceValidFrom || '',
    priceValidUntil: row.priceValidUntil || '',
    maximumOrderQty: row.maximumOrderQty ?? '',
    orderMultiple: row.orderMultiple ?? '',
    availabilityStatus: row.availabilityStatus || '',
    supplierStockQty: row.supplierStockQty ?? '',
    supplierWarehouseCode: row.supplierWarehouseCode || '',
    deliveryType: row.deliveryType || '',
    returnable: row.returnable ?? '',
    catalogValidFrom: row.catalogValidFrom || '',
    catalogValidUntil: row.catalogValidUntil || '',
    productDescription: row.productDescription || '',
    shortDescription: row.shortDescription || '',
    manufacturerCode: row.manufacturerCode || '',
    modelCode: row.modelCode || '',
    imageUrl: row.imageUrl || '',
    productUrl: row.productUrl || '',
    supplierNote: row.supplierNote || '',
    rowAction: row.rowAction || '',
    manualNote: row.manualNote || '',
    expectedMatchHint: row.expectedMatchHint || '',
    suggestedCategory: row.suggestedCategory || '',
    suggestedBrand: row.suggestedBrand || '',
    suggestedUnit: row.suggestedUnit || '',
    missingRequiredFieldNames: Array.isArray(row.missingRequiredFieldNames) ? row.missingRequiredFieldNames : [],
    confidenceScore: row.confidenceScore ?? row.confidence ?? '',
    newProductReason: row.pendingApprovalReason || row.reason || row.matchReason || 'manual_decision_required',
    duplicateBarcodeRisk: Boolean(duplicateBarcodeProduct),
    duplicateSupplierCodeRisk: Boolean(duplicateSupplierCodeRow),
    risk: riskParts.join(', ') || 'none',
    suggestedAction: row.suggestedAction || 'Mevcut ürüne eşle veya güvenli taslak oluştur.',
    decisionNote: row.decisionNote || row.manualDecisionNote || row.note || '',
    rejectedAt: row.rejectedAt || '',
    rejectedBy: row.rejectedBy || '',
    resolvedAt: row.resolvedAt || '',
    resolvedBy: row.resolvedBy || '',
    status: row.catalogApprovalStatus || row.commitStatus || CATALOG_APPROVAL_STATUSES.PENDING,
    draftProductId: resolvedDraftProduct?.id || row.draftProductId || '',
    draftProductSku: resolvedDraftProduct?.sku || '',
    matchedProductId: row.manualProductId || row.matchedProductId || '',
    canCreateDraftProduct: !duplicateBarcodeProduct && !duplicateSupplierCodeRow && !row.draftProductId,
  };
};

const findApprovalImportRow = async (approvalId) => {
  const parsed = parseApprovalQueueRowId(approvalId);
  if (parsed.kind !== 'import' || !parsed.sourceId || !parsed.rowId) {
    throw new AppError(400, 'Geçersiz onay kuyruğu satırı.');
  }

  const catalogImport = await catalogImportRepo.findById(parsed.sourceId);
  if (!catalogImport) throw createNotFoundError('Katalog import satırı bulunamadı.');

  const rowIndex = (catalogImport.rows || []).findIndex((row) => String(row.rowId) === String(parsed.rowId));
  if (rowIndex < 0) throw createNotFoundError('Katalog satırı bulunamadı.');

  return { catalogImport, row: catalogImport.rows[rowIndex], rowIndex };
};

const persistApprovalImportRow = async ({ catalogImport, rowIndex, nextRow }) => {
  const rows = [...(catalogImport.rows || [])];
  rows[rowIndex] = nextRow;
  const pendingApprovalRows = rows.filter(isPendingApprovalImportRow);
  const now = new Date().toISOString();
  await catalogImportRepo.updateById(catalogImport.id, {
    ...catalogImport,
    rows,
    pendingApprovalRows,
    updatedAt: now,
  });

  const versions = await supplierCatalogVersionRepo.getAll();
  const relatedVersions = versions.filter((version) => String(version.importId) === String(catalogImport.id));
  await Promise.all(relatedVersions.map((version) => {
    const versionRows = Array.isArray(version.rows) ? version.rows.map((item) => (
      String(item.rowId) === String(nextRow.rowId) ? { ...item, ...nextRow } : item
    )) : version.rows;
    const versionPendingRows = Array.isArray(versionRows) ? versionRows.filter(isPendingApprovalImportRow) : version.pendingApprovalRows;
    return supplierCatalogVersionRepo.updateById(version.id, {
      ...version,
      rows: versionRows,
      pendingApprovalRows: versionPendingRows,
      updatedAt: now,
    });
  }));
};

export const catalogImportService = {
  async listApprovalQueue(query = {}) {
    const [imports, products, supplierProducts, suppliers] = await Promise.all([
      catalogImportRepo.getAll(),
      productRepo.getAll(),
      supplierProductRepo.getAll(),
      supplierRepo.getAll(),
    ]);
    const productLookup = buildProductLookup(products);
    const supplierNameById = new Map(suppliers.map((supplier) => [String(supplier.id), supplier.name || supplier.title || '-']));

    const rows = [];
    imports.forEach((catalogImport) => {
      const supplierProductLookup = buildSupplierProductLookup(supplierProducts, catalogImport.supplierId);
      (catalogImport.rows || []).filter(isApprovalHistoryImportRow).forEach((row) => {
        const draftProduct = products.find((product) => (
          String(product.catalogImportId || '') === String(catalogImport.id)
          && String(product.catalogImportRowId || '') === String(row.rowId)
        )) || null;
        rows.push(normalizeApprovalQueueImportRow({ row, catalogImport, productLookup, supplierProductLookup, draftProduct }));
      });
    });

    products
      .filter((product) => (
        product.sourceReadModel === 'catalog_import'
        && ['staged', 'rejected'].includes(normalizeText(product.catalogVisibility))
        && product.isListed === false
        && product.isActive === false
        && ['draft', 'pending_approval', 'rejected', ''].includes(normalizeText(product.status || product.defaultStatus))
      ))
      .forEach((product) => {
        const productStatus = normalizeText(product.status || product.defaultStatus);
        const isRejectedDraft = productStatus === CATALOG_APPROVAL_STATUSES.REJECTED || normalizeText(product.catalogVisibility) === CATALOG_APPROVAL_STATUSES.REJECTED;
        rows.push({
          id: `draft:${product.id}`,
          sourceType: 'staged_draft_product',
          importId: product.catalogImportId || '',
          supplierId: product.supplierId || '',
          supplierName: product.supplierName || supplierNameById.get(String(product.supplierId || '')) || '-',
          catalogVersion: product.lastImportSource || 'catalog_import',
          fileName: product.lastImportSource || 'catalog_import',
          uploadedAt: product.createdAt || '',
          rowId: product.catalogImportRowId || '',
          rowNumber: product.catalogImportRowNumber || '',
          supplierProductCode: product.supplierProductCode || '',
          supplierSku: product.sku || '',
          barcode: product.barcode || '',
          productName: product.name || product.productName || '-',
          brand: product.brand || '',
          category: product.categoryName || product.etiket || '',
          unit: product.unit || '',
          packSize: product.unitsPerCase || '',
          unitsPerCase: product.unitsPerCase || '',
          purchasePrice: product.purchasePrice ?? '',
          listPrice: product.salePrice ?? '',
          currency: product.currency || 'TRY',
          confidenceScore: '',
          newProductReason: 'staged_manual_draft_product',
          duplicateBarcodeRisk: Boolean(product.barcode && productLookup.barcodeMap.get(normalizeText(product.barcode))?.id !== product.id),
          duplicateSupplierCodeRisk: false,
          risk: 'none',
          suggestedAction: isRejectedDraft ? 'Taslak reddedildi. Katalog satırı sisteme alınmadı.' : 'Ürün onay sürecinde zorunlu alanları tamamlayın.',
          decisionNote: product.decisionNote || product.payload?.rejectionNote || product.payload?.cleanupNote || '',
          rejectedAt: product.rejectedAt || product.payload?.rejectedAt || '',
          rejectedBy: product.rejectedBy || product.payload?.rejectedBy || '',
          status: isRejectedDraft ? CATALOG_APPROVAL_STATUSES.REJECTED : CATALOG_APPROVAL_STATUSES.DRAFT_CREATED,
          draftProductId: product.id,
          draftProductSku: product.sku || '',
          matchedProductId: '',
          canCreateDraftProduct: false,
        });
      });

    const supplierId = normalizeText(query.supplierId);
    const status = normalizeText(query.status);
    const duplicateRisk = normalizeText(query.duplicateRisk);
    const category = normalizeComparable(query.category);
    const brand = normalizeComparable(query.brand);
    return rows
      .filter((row) => !supplierId || String(row.supplierId) === supplierId)
      .filter((row) => !status || String(row.status) === status)
      .filter((row) => !duplicateRisk || (duplicateRisk === 'yes' ? row.duplicateBarcodeRisk || row.duplicateSupplierCodeRisk : !row.duplicateBarcodeRisk && !row.duplicateSupplierCodeRisk))
      .filter((row) => !category || normalizeComparable(row.category).includes(category))
      .filter((row) => !brand || normalizeComparable(row.brand).includes(brand))
      .sort((left, right) => new Date(right.uploadedAt || 0) - new Date(left.uploadedAt || 0));
  },

  async matchApprovalQueueRow(approvalId, payload = {}, actorUser = {}) {
    const manualProductId = normalizeText(payload.manualProductId);
    if (!manualProductId) throw new AppError(400, 'Eşlenecek ürün seçimi zorunludur.');
    const { catalogImport, row, rowIndex } = await findApprovalImportRow(approvalId);
    if (isResolvedApprovalStatus(row)) throw new AppError(409, 'Bu satır zaten sonuçlandırılmış.');

    const [product, supplierProducts] = await Promise.all([
      productRepo.findById(manualProductId),
      supplierProductRepo.getAll(),
    ]);
    if (!product) throw createNotFoundError('Seçilen ürün bulunamadı.');
    if (product.isActive === false) throw new AppError(409, 'Pasif ürün manuel eşleşme için kullanılamaz.');

    const lookup = buildSupplierProductLookup(supplierProducts, catalogImport.supplierId);
    const duplicateSupplierCode = row.supplierProductCode ? lookup.byCode.get(normalizeComparable(row.supplierProductCode)) : null;
    if (duplicateSupplierCode && String(duplicateSupplierCode.productId) !== String(manualProductId)) {
      throw new AppError(409, 'Bu tedarikçi ürün kodu başka bir ürüne bağlı.');
    }

    const now = new Date().toISOString();
    const existing = lookup.byProduct.get(`${manualProductId}:${catalogImport.supplierId}`) || null;
    const supplierProduct = createOrUpdateSupplierProductPayload({
      existing,
      productId: manualProductId,
      supplierId: catalogImport.supplierId,
      row,
      now,
    });
    if (existing) await supplierProductRepo.updateById(existing.id, supplierProduct);
    else await supplierProductRepo.create(supplierProduct);

    const nextRow = {
      ...row,
      catalogApprovalStatus: CATALOG_APPROVAL_STATUSES.RESOLVED_MANUAL_MATCH,
      commitStatus: CATALOG_APPROVAL_STATUSES.RESOLVED_MANUAL_MATCH,
      manualDecision: MANUAL_DECISIONS.MANUAL_MATCH,
      manualProductId,
      productId: manualProductId,
      supplierProductId: supplierProduct.id,
      matchStatus: 'manual_matched',
      decisionNote: normalizeText(payload.decisionNote),
      manualActionRequired: false,
      willCreateProduct: false,
      willUpdateSupplierProduct: true,
      willSkipPendingApproval: false,
      resolvedAt: now,
      resolvedBy: actorUser?.id || 'system',
    };
    await persistApprovalImportRow({ catalogImport, rowIndex, nextRow });
    return { row: nextRow, supplierProduct };
  },

  async createApprovalQueueDraft(approvalId, payload = {}, actorUser = {}) {
    const { catalogImport, row, rowIndex } = await findApprovalImportRow(approvalId);
    if (isResolvedApprovalStatus(row)) throw new AppError(409, 'Bu satır zaten sonuçlandırılmış.');

    const [supplier, products, supplierProducts] = await Promise.all([
      supplierRepo.findById(catalogImport.supplierId),
      productRepo.getAll(),
      supplierProductRepo.getAll(),
    ]);
    if (!supplier) throw createNotFoundError('Tedarikçi bulunamadı.');

    const productLookup = buildProductLookup(products);
    if (row.barcode && productLookup.barcodeMap.has(normalizeText(row.barcode))) {
      throw new AppError(409, 'Barkod başka bir üründe mevcut. Taslak oluşturmak yerine mevcut ürüne eşleyin.');
    }
    if (products.some((product) => String(product.catalogImportId || '') === String(catalogImport.id) && String(product.catalogImportRowId || '') === String(row.rowId))) {
      throw new AppError(409, 'Bu katalog satırı için taslak ürün zaten oluşturulmuş.');
    }

    const supplierProductLookup = buildSupplierProductLookup(supplierProducts, catalogImport.supplierId);
    const duplicateSupplierCode = row.supplierProductCode ? supplierProductLookup.byCode.get(normalizeComparable(row.supplierProductCode)) : null;
    if (duplicateSupplierCode) throw new AppError(409, 'Bu tedarikçi ürün kodu zaten bağlı.');

    const now = new Date().toISOString();
    const draftProduct = createCatalogApprovalDraftProductPayload({ row, supplier, createdAt: now, importId: catalogImport.id });
    draftProduct.categoryId = null;
    let createdDraftProduct;
    try {
      createdDraftProduct = await productRepo.create(draftProduct);
    } catch (error) {
      throw new AppError(500, 'Satışa kapalı taslak ürün oluşturulamadı. Ürün adı, barkod/SKU ve katalog satırı bilgilerini kontrol edin.', getDraftCreateErrorDetails(error, row));
      throw new AppError(500, 'Satışa kapalı taslak ürün oluşturulamadı. Ürün adı, barkod/SKU ve katalog satırı bilgilerini kontrol edin.', {
        errorCode: 'CATALOG_DRAFT_PRODUCT_CREATE_FAILED',
        fieldErrors: {
          productName: normalizeText(row.excelProductName || row.productName) ? undefined : 'Ürün adı eksik.',
          barcode: normalizeText(row.barcode || row.sku) ? undefined : 'Barkod veya SKU eksik.',
        },
        causeMessage: error?.message,
      });
    }
    let supplierProduct;
    try {
      supplierProduct = createOrUpdateSupplierProductPayload({
        existing: null,
        productId: draftProduct.id,
        supplierId: catalogImport.supplierId,
        row,
        now,
      });
      await supplierProductRepo.create(supplierProduct);
    } catch (error) {
      try {
        await productRepo.remove(draftProduct.id);
      } catch {
        // Rollback best-effort: orphan supplier product oluşmasını engellemek ana güvenlik hedefidir.
      }
      throw new AppError(500, 'Taslak ürün oluşturuldu ancak tedarikçi bağlantısı kurulamadı. İşlem geri alındı; tedarikçi ürün kodunu kontrol edin.', {
        errorCode: 'CATALOG_DRAFT_SUPPLIER_LINK_FAILED',
        fieldErrors: {
          supplierProductCode: normalizeText(row.supplierProductCode) ? undefined : 'Tedarikçi ürün kodu eksik.',
        },
        causeMessage: error?.message,
      });
    }

    const nextRow = {
      ...row,
      catalogApprovalStatus: CATALOG_APPROVAL_STATUSES.RESOLVED_DRAFT_CREATED,
      commitStatus: CATALOG_APPROVAL_STATUSES.RESOLVED_DRAFT_CREATED,
      manualDecision: MANUAL_DECISIONS.CREATE_DRAFT_PRODUCT,
      productId: draftProduct.id,
      draftProductId: draftProduct.id,
      supplierProductId: supplierProduct.id,
      createdByManualApproval: true,
      decisionNote: normalizeText(payload.decisionNote),
      manualActionRequired: false,
      willCreateProduct: true,
      willUpdateSupplierProduct: true,
      willSkipPendingApproval: false,
      catalogVisibility: 'staged',
      resolvedAt: now,
      resolvedBy: actorUser?.id || 'system',
    };
    await persistApprovalImportRow({ catalogImport, rowIndex, nextRow });
    return {
      row: nextRow,
      product: createdDraftProduct || draftProduct,
      supplierProduct,
      draftProductId: draftProduct.id,
      message: 'Ürün taslağı oluşturuldu. Ürün satışa açılmadı; onay bekleyen taslak olarak kaydedildi.',
    };
  },

  async rejectApprovalQueueRow(approvalId, payload = {}, actorUser = {}) {
    const parsed = parseApprovalQueueRowId(approvalId);
    if (parsed.kind === 'draft' && parsed.sourceId) {
      const product = await productRepo.findById(parsed.sourceId);
      if (!product) throw createNotFoundError('Taslak ürün bulunamadı.');
      const reason = normalizeText(payload.reason || payload.decisionNote);
      if (!reason) throw new AppError(400, 'Reddetme nedeni zorunludur.');
      const now = new Date().toISOString();
      const existingPayload = product.payload && typeof product.payload === 'object' ? product.payload : {};
      const rejected = {
        ...product,
        status: CATALOG_APPROVAL_STATUSES.REJECTED,
        defaultStatus: CATALOG_APPROVAL_STATUSES.REJECTED,
        isListed: false,
        isActive: false,
        catalogVisibility: CATALOG_APPROVAL_STATUSES.REJECTED,
        orderActivatedStatus: CATALOG_APPROVAL_STATUSES.REJECTED,
        decisionNote: reason,
        rejectedAt: now,
        rejectedBy: actorUser?.id || 'system',
        payload: {
          ...existingPayload,
          catalogVisibility: CATALOG_APPROVAL_STATUSES.REJECTED,
          completionStatus: CATALOG_APPROVAL_STATUSES.REJECTED,
          rejectionNote: reason,
          rejectedAt: now,
          rejectedBy: actorUser?.id || 'system',
        },
        updatedAt: now,
      };
      await productRepo.updateById(product.id, rejected);
      return { product: rejected, row: { id: approvalId, status: CATALOG_APPROVAL_STATUSES.REJECTED } };
    }

    const { catalogImport, row, rowIndex } = await findApprovalImportRow(approvalId);
    if (isResolvedApprovalStatus(row)) throw new AppError(409, 'Bu satır zaten sonuçlandırılmış.');
    const reason = normalizeText(payload.reason || payload.decisionNote);
    if (!reason) throw new AppError(400, 'Reddetme nedeni zorunludur.');

    const now = new Date().toISOString();
    const nextRow = {
      ...row,
      catalogApprovalStatus: CATALOG_APPROVAL_STATUSES.REJECTED,
      commitStatus: CATALOG_APPROVAL_STATUSES.REJECTED,
      manualDecision: 'reject',
      decisionNote: reason,
      manualActionRequired: false,
      willCreateProduct: false,
      willUpdateSupplierProduct: false,
      willSkipPendingApproval: true,
      rejectedAt: now,
      rejectedBy: actorUser?.id || 'system',
    };
    await persistApprovalImportRow({ catalogImport, rowIndex, nextRow });
    return { row: nextRow };
  },

  async undoApprovalQueueDecision(approvalId, payload = {}, actorUser = {}) {
    const parsed = parseApprovalQueueRowId(approvalId);
    const now = new Date().toISOString();

    if (parsed.kind === 'draft' && parsed.sourceId) {
      const product = await productRepo.findById(parsed.sourceId);
      if (!product) throw createNotFoundError('Taslak ürün bulunamadı.');
      const existingPayload = product.payload && typeof product.payload === 'object' ? product.payload : {};
      const restored = {
        ...product,
        status: 'draft',
        defaultStatus: 'draft',
        isListed: false,
        isActive: false,
        catalogVisibility: 'staged',
        orderActivatedStatus: 'pending',
        payload: {
          ...existingPayload,
          catalogVisibility: 'staged',
          completionStatus: 'incomplete',
          decisionRestoredAt: now,
          decisionRestoredBy: actorUser?.id || 'system',
          decisionRestoreNote: normalizeText(payload.reason || payload.decisionNote),
        },
        updatedAt: now,
      };
      await productRepo.updateById(product.id, restored);
      return { product: restored, row: { id: approvalId, status: CATALOG_APPROVAL_STATUSES.DRAFT_CREATED } };
    }

    const { catalogImport, row, rowIndex } = await findApprovalImportRow(approvalId);
    const status = normalizeText(row.catalogApprovalStatus || row.commitStatus);
    if (status !== CATALOG_APPROVAL_STATUSES.REJECTED) {
      throw new AppError(409, 'Yalnızca reddedilen katalog kararları geri alınabilir.');
    }

    const nextRow = {
      ...row,
      catalogApprovalStatus: CATALOG_APPROVAL_STATUSES.PENDING,
      commitStatus: CATALOG_APPROVAL_STATUSES.PENDING,
      manualDecision: '',
      decisionNote: normalizeText(payload.reason || payload.decisionNote),
      manualActionRequired: true,
      willCreateProduct: false,
      willUpdateSupplierProduct: false,
      willSkipPendingApproval: true,
      rejectionRevertedAt: now,
      rejectionRevertedBy: actorUser?.id || 'system',
    };
    delete nextRow.rejectedAt;
    delete nextRow.rejectedBy;
    await persistApprovalImportRow({ catalogImport, rowIndex, nextRow });
    return { row: nextRow };
  },

  async listImports(query = {}) {
    const supplierId = normalizeText(query.supplierId);
    const imports = await catalogImportRepo.getAll();

    return imports
      .filter((item) => !supplierId || String(item.supplierId) === supplierId)
      .sort((left, right) => new Date(right.uploadedAt || 0) - new Date(left.uploadedAt || 0))
      .map((item) => ({
        id: item.id,
        supplierId: item.supplierId,
        supplierName: item.supplierName,
        fileName: item.fileName,
        uploadedAt: item.uploadedAt,
        status: item.status,
        validityStart: item.validityStart,
        validityEnd: item.validityEnd,
        summary: item.summary,
      }));
  },

  async previewImport(payload = {}, actorUser = {}) {
    const supplierId = normalizeText(payload.supplierId);
    const fileName = normalizeText(payload.fileName) || 'catalog.xlsx';
    const validityStart = parseDate(payload.validityStart) || new Date().toISOString();
    const validityEnd = parseDate(payload.validityEnd);
    const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];

    if (!supplierId) throw new AppError(400, 'Tedarikçi seçimi zorunludur.');

    ensureImportColumns(sourceRows);

    const [supplier, products, supplierProducts] = await Promise.all([
      supplierRepo.findById(supplierId),
      productRepo.getAll(),
      supplierProductRepo.getAll(),
    ]);

    if (!supplier) throw createNotFoundError('Tedarikçi bulunamadı');

    const normalizedRows = sourceRows.map((row, index) => normalizeImportRow(row, index));
    const previewRows = buildPreviewRows({
      rows: normalizedRows,
      products,
      supplierProducts,
      supplierId,
    });

    const summary = summarizeCounts(previewRows);
    const now = new Date().toISOString();

    const importRecord = {
      id: `imp-${uuidv4().slice(0, 12)}`,
      supplierId,
      supplierName: supplier.name,
      fileName,
      uploadedAt: now,
      uploadedBy: actorUser?.id || 'system',
      status: 'staging',
      validityStart,
      validityEnd,
      summary,
      rows: previewRows,
      requiredApproval: true,
      columnsValidated: true,
    };

    await catalogImportRepo.create(importRecord);

    return {
      importId: importRecord.id,
      supplierId,
      supplierName: supplier.name,
      fileName,
      uploadedAt: now,
      summary,
      rows: previewRows,
      status: importRecord.status,
    };
  },

  async updateImportRow(importId, rowId, payload = {}) {
    const existingImport = await catalogImportRepo.findById(importId);
    if (!existingImport) throw createNotFoundError('Import kaydı bulunamadı');
    if (existingImport.status !== 'staging') {
      throw new AppError(409, 'Sadece staging durumundaki import kayıtları güncellenebilir.');
    }

    let changed = false;
    const nextRows = (existingImport.rows || []).map((row) => {
      if (String(row.rowId) !== String(rowId)) return row;
      changed = true;

      const actionType = payload.actionType ? String(payload.actionType) : row.actionType;
      const isExcluded = actionType === ACTION_TYPES.EXCLUDE;
      const manualProductId = normalizeText(payload.manualProductId || row.manualProductId);

      let matchStatus = row.matchStatus;
      if (actionType === ACTION_TYPES.MANUAL_MATCH) {
        matchStatus = CATALOG_MATCH_STATUSES.MANUAL;
      }

      if ((actionType === ACTION_TYPES.APPROVE_UPDATE || actionType === ACTION_TYPES.MATCHED) && row.errors.length === 0) {
        matchStatus = CATALOG_MATCH_STATUSES.MATCHED;
      }

      if (actionType === ACTION_TYPES.CREATE_NEW_PRODUCT && row.errors.length === 0) {
        matchStatus = CATALOG_MATCH_STATUSES.NEW_PRODUCT;
      }

      return {
        ...row,
        actionType,
        isExcluded,
        manualProductId,
        matchedProductId: manualProductId || row.matchedProductId,
        matchStatus,
      };
    });

    if (!changed) throw createNotFoundError('Import satırı bulunamadı');

    const summary = summarizeCounts(nextRows);
    const updated = {
      ...existingImport,
      rows: nextRows,
      summary,
      updatedAt: new Date().toISOString(),
    };

    await catalogImportRepo.updateById(existingImport.id, updated);

    return {
      importId: updated.id,
      summary,
      rows: nextRows,
      status: updated.status,
    };
  },

  async commitImport(importId, payload = {}, actorUser = {}) {
    const existingImport = await catalogImportRepo.findById(importId);
    if (!existingImport) throw createNotFoundError('Import kaydı bulunamadı');
    if (existingImport.status !== 'staging') {
      throw new AppError(409, 'Bu import zaten işlendi.');
    }

    const createDraftProducts = payload.createDraftProducts === true;
    const rowDecisionMap = buildRowDecisionMap(payload.rowDecisions);
    const [supplier, products, supplierProducts, versions] = await Promise.all([
      supplierRepo.findById(existingImport.supplierId),
      productRepo.getAll(),
      supplierProductRepo.getAll(),
      supplierCatalogVersionRepo.getAll(),
    ]);

    if (!supplier) throw createNotFoundError('Tedarikçi bulunamadı');

    const now = new Date().toISOString();
    const productMap = new Map(products.map((item) => [String(item.id), item]));
    const productBarcodeMap = new Map(
      products
        .filter((item) => normalizeText(item.barcode))
        .map((item) => [normalizeText(item.barcode), item])
    );
    const supplierProductMap = new Map(
      supplierProducts
        .filter((item) => String(item.supplierId) === String(existingImport.supplierId))
        .map((item) => [`${item.productId}:${item.supplierId}`, item])
    );
    const supplierProductCodeMap = new Map(
      supplierProducts
        .filter((item) => String(item.supplierId) === String(existingImport.supplierId) && normalizeText(item.supplierProductCode))
        .map((item) => [normalizeComparable(item.supplierProductCode), item])
    );

    const appliedRows = [];
    const versionSnapshot = [];
    const committedRows = [];
    const pendingApprovalRows = [];
    const invalidRows = [];
    const commitSummary = {
      matchedUpdatedCount: 0,
      manualSkippedCount: 0,
      newProductPendingApprovalCount: 0,
      createdProductCount: 0,
      updatedSupplierProductCount: 0,
      invalidRowCount: 0,
      conflictRowCount: 0,
      skippedBecauseCreateDraftDisabledCount: 0,
    };

    for (const row of existingImport.rows || []) {
      const rowDecision = rowDecisionMap.get(String(row.rowId)) || rowDecisionMap.get(String(row.rowNumber)) || null;
      const manualDecision = rowDecision?.decision || '';
      const decisionNote = rowDecision?.decisionNote || row.decisionNote || '';

      if (row.isExcluded || row.actionType === ACTION_TYPES.EXCLUDE) {
        committedRows.push({ ...row, commitStatus: 'excluded', canCommit: false });
        continue;
      }

      if (row.errors.length || row.actionType === ACTION_TYPES.INVALID || row.actionType === ACTION_TYPES.CONFLICT) {
        if (row.actionType === ACTION_TYPES.CONFLICT) commitSummary.conflictRowCount += 1;
        else commitSummary.invalidRowCount += 1;
        const skipped = {
          ...row,
          commitStatus: 'invalid_or_conflict',
          canCommit: false,
          willCreateProduct: false,
          willUpdateSupplierProduct: false,
          willSkipPendingApproval: false,
        };
        invalidRows.push(skipped);
        committedRows.push(skipped);
        continue;
      }

      if (manualDecision === MANUAL_DECISIONS.REJECT) {
        commitSummary.manualRejectedCount = Number(commitSummary.manualRejectedCount || 0) + 1;
        committedRows.push({
          ...row,
          manualDecision,
          decisionNote,
          commitStatus: 'rejected',
          manualActionRequired: false,
          canCommit: false,
          willCreateProduct: false,
          willUpdateSupplierProduct: false,
          willSkipPendingApproval: false,
          pendingApprovalReason: '',
          note: decisionNote || 'Yeni katalog ürünü önizleme aşamasında reddedildi.',
        });
        continue;
      }

      if (manualDecision === MANUAL_DECISIONS.SKIP) {
        commitSummary.manualSkippedCount += 1;
        const pending = {
          ...row,
          manualDecision,
          decisionNote,
          commitStatus: 'manual_decision_pending',
          manualActionRequired: true,
          canCommit: false,
          willCreateProduct: false,
          willUpdateSupplierProduct: false,
          willSkipPendingApproval: true,
          pendingApprovalReason: 'manual_decision_pending',
          note: decisionNote || 'Yeni katalog ürünü daha sonra karar verilmek üzere beklemeye alındı.',
        };
        pendingApprovalRows.push(pending);
        committedRows.push(pending);
        continue;
      }

      const manualProductId = normalizeText(rowDecision?.manualProductId || row.manualProductId);
      let targetProductId = (manualDecision === MANUAL_DECISIONS.MANUAL_MATCH || row.actionType === ACTION_TYPES.MANUAL_MATCH)
        ? manualProductId
        : normalizeText(row.matchedProductId);
      let createdByManualApproval = false;

      if (manualDecision === MANUAL_DECISIONS.MANUAL_MATCH && !targetProductId) {
        commitSummary.manualSkippedCount += 1;
        const pending = {
          ...row,
          manualDecision,
          decisionNote,
          commitStatus: 'missing_manual_product',
          manualActionRequired: true,
          canCommit: false,
          willCreateProduct: false,
          willUpdateSupplierProduct: false,
          willSkipPendingApproval: true,
          pendingApprovalReason: 'manual_product_required',
          note: 'Mevcut ürüne bağlama kararı için bir ürün seçilmelidir.',
        };
        pendingApprovalRows.push(pending);
        committedRows.push(pending);
        continue;
      }

      if (!targetProductId && row.actionType === ACTION_TYPES.CREATE_NEW_PRODUCT && manualDecision === MANUAL_DECISIONS.CREATE_DRAFT_PRODUCT) {
        const duplicateProduct = row.barcode ? productBarcodeMap.get(normalizeText(row.barcode)) : null;
        const duplicateSupplierCode = row.supplierProductCode ? supplierProductCodeMap.get(normalizeComparable(row.supplierProductCode)) : null;

        if (duplicateProduct || duplicateSupplierCode) {
          commitSummary.conflictRowCount += 1;
          const conflict = {
            ...row,
            manualDecision,
            decisionNote,
            commitStatus: 'manual_draft_conflict',
            manualActionRequired: true,
            canCommit: false,
            willCreateProduct: false,
            willUpdateSupplierProduct: false,
            willSkipPendingApproval: true,
            pendingApprovalReason: duplicateProduct ? 'duplicate_barcode_existing_product' : 'duplicate_supplier_product_code',
            suggestedAction: 'Select the existing product with manual match.',
            note: duplicateProduct
              ? 'Taslak ürün oluşturma engellendi çünkü bu barkod mevcut bir üründe kullanılıyor.'
              : 'Taslak ürün oluşturma engellendi çünkü bu tedarikçi ürün kodu aynı tedarikçide zaten mevcut.',
          };
          pendingApprovalRows.push(conflict);
          committedRows.push(conflict);
          continue;
        }

        const draftProduct = createDraftProductPayload({ row, supplier, createdAt: now });
        await productRepo.create(draftProduct);
        productMap.set(String(draftProduct.id), draftProduct);
        if (draftProduct.barcode) productBarcodeMap.set(normalizeText(draftProduct.barcode), draftProduct);
        targetProductId = draftProduct.id;
        createdByManualApproval = true;
        commitSummary.createdProductCount += 1;
      } else if (!targetProductId && row.actionType === ACTION_TYPES.CREATE_NEW_PRODUCT && createDraftProducts) {
        const draftProduct = createDraftProductPayload({ row, supplier, createdAt: now });
        await productRepo.create(draftProduct);
        productMap.set(String(draftProduct.id), draftProduct);
        if (draftProduct.barcode) productBarcodeMap.set(normalizeText(draftProduct.barcode), draftProduct);
        targetProductId = draftProduct.id;
        commitSummary.createdProductCount += 1;
      } else if (!targetProductId && row.actionType === ACTION_TYPES.CREATE_NEW_PRODUCT && !createDraftProducts) {
        commitSummary.newProductPendingApprovalCount += 1;
        commitSummary.skippedBecauseCreateDraftDisabledCount += 1;
        const pending = {
          ...row,
          commitStatus: 'pending_approval',
          manualDecision: manualDecision || '',
          decisionNote,
          manualActionRequired: true,
          canCommit: false,
          willCreateProduct: false,
          willUpdateSupplierProduct: false,
          willSkipPendingApproval: true,
          createsDraftProductAutomatically: false,
          expectedCreateDraftProductsFlag: false,
          catalogVisibility: 'pending_approval',
          hardDeleteConflictRisk: false,
          pendingApprovalReason: 'manual_decision_required',
          note: 'Otomatik taslak ürün oluşturma kapalı olduğu için yeni katalog ürünü onay beklemeye alındı.',
        };
        pendingApprovalRows.push(pending);
        committedRows.push(pending);
        continue;
      }

      if (!targetProductId) {
        commitSummary.manualSkippedCount += 1;
        const pending = {
          ...row,
          commitStatus: 'manual_match_required',
          manualDecision: manualDecision || '',
          decisionNote,
          manualActionRequired: true,
          canCommit: false,
          willCreateProduct: false,
          willUpdateSupplierProduct: false,
          willSkipPendingApproval: true,
          pendingApprovalReason: 'manual_match_required',
          note: 'Bu satır işlenmeden önce mevcut bir sistem ürünüyle eşleştirilmelidir.',
        };
        pendingApprovalRows.push(pending);
        committedRows.push(pending);
        continue;
      }
      if (!productMap.has(String(targetProductId))) {
        commitSummary.manualSkippedCount += 1;
        const pending = {
          ...row,
          commitStatus: 'missing_target_product',
          manualDecision: manualDecision || '',
          decisionNote,
          manualActionRequired: true,
          canCommit: false,
          willCreateProduct: false,
          willUpdateSupplierProduct: false,
          willSkipPendingApproval: true,
          pendingApprovalReason: 'missing_target_product',
          note: 'Seçilen hedef ürün artık sistemde bulunmuyor.',
        };
        pendingApprovalRows.push(pending);
        committedRows.push(pending);
        continue;
      }

      if (manualDecision === MANUAL_DECISIONS.MANUAL_MATCH && productMap.get(String(targetProductId))?.isActive === false) {
        commitSummary.manualSkippedCount += 1;
        const pending = {
          ...row,
          manualDecision,
          decisionNote,
          commitStatus: 'inactive_target_product',
          manualActionRequired: true,
          canCommit: false,
          willCreateProduct: false,
          willUpdateSupplierProduct: false,
          willSkipPendingApproval: true,
          pendingApprovalReason: 'inactive_target_product',
          note: 'Selected target product is inactive and cannot be used for manual catalog matching.',
        };
        pendingApprovalRows.push(pending);
        committedRows.push(pending);
        continue;
      }

      const duplicateSupplierCode = row.supplierProductCode ? supplierProductCodeMap.get(normalizeComparable(row.supplierProductCode)) : null;
      if (duplicateSupplierCode && String(duplicateSupplierCode.productId) !== String(targetProductId)) {
        commitSummary.conflictRowCount += 1;
        const conflict = {
          ...row,
          manualDecision: manualDecision || '',
          decisionNote,
          commitStatus: 'supplier_product_code_conflict',
          manualActionRequired: true,
          canCommit: false,
          willCreateProduct: false,
          willUpdateSupplierProduct: false,
          willSkipPendingApproval: true,
          pendingApprovalReason: 'duplicate_supplier_product_code',
          note: 'Supplier product code already belongs to another product for this supplier.',
        };
        pendingApprovalRows.push(conflict);
        committedRows.push(conflict);
        continue;
      }

      const key = `${targetProductId}:${existingImport.supplierId}`;
      const existing = supplierProductMap.get(key) || null;
      const nextSupplierProduct = createOrUpdateSupplierProductPayload({
        existing,
        productId: targetProductId,
        supplierId: existingImport.supplierId,
        row,
        now,
      });

      if (existing) {
        await supplierProductRepo.updateById(existing.id, nextSupplierProduct);
      } else {
        await supplierProductRepo.create(nextSupplierProduct);
      }
      commitSummary.updatedSupplierProductCount += 1;
      if (
        row.actionType === ACTION_TYPES.MATCHED
        || row.actionType === ACTION_TYPES.APPROVE_UPDATE
        || manualDecision === MANUAL_DECISIONS.MANUAL_MATCH
      ) {
        commitSummary.matchedUpdatedCount += 1;
      }

      supplierProductMap.set(key, nextSupplierProduct);
      if (nextSupplierProduct.supplierProductCode) {
        supplierProductCodeMap.set(normalizeComparable(nextSupplierProduct.supplierProductCode), nextSupplierProduct);
      }

      appliedRows.push({
        rowId: row.rowId,
        productId: targetProductId,
        supplierProductId: nextSupplierProduct.id,
        actionType: manualDecision === MANUAL_DECISIONS.MANUAL_MATCH ? ACTION_TYPES.MANUAL_MATCH : row.actionType,
        manualDecision,
      });

      versionSnapshot.push(nextSupplierProduct);
      committedRows.push({
        ...row,
        commitStatus: existing ? 'supplier_product_updated' : 'supplier_product_created',
        manualDecision: manualDecision || row.manualDecision || '',
        manualProductId: manualDecision === MANUAL_DECISIONS.MANUAL_MATCH ? targetProductId : row.manualProductId,
        decisionNote,
        matchStatus: manualDecision === MANUAL_DECISIONS.MANUAL_MATCH ? 'manual_matched' : row.matchStatus,
        productId: targetProductId,
        supplierProductId: nextSupplierProduct.id,
        createdByManualApproval,
        manualActionRequired: false,
        canCommit: true,
        willCreateProduct: createdByManualApproval,
        willUpdateSupplierProduct: true,
        willSkipPendingApproval: false,
        catalogVisibility: createdByManualApproval ? 'staged' : row.catalogVisibility,
      });
    }

    const previousActiveVersions = versions.filter((item) => String(item.supplierId) === String(existingImport.supplierId) && item.isActive === true);

    for (const version of previousActiveVersions) {
      await supplierCatalogVersionRepo.updateById(version.id, {
        ...version,
        isActive: false,
        status: 'archived',
        archivedAt: now,
        updatedAt: now,
      });
    }

    const newVersion = {
      id: `catv-${uuidv4().slice(0, 12)}`,
      supplierId: existingImport.supplierId,
      supplierName: existingImport.supplierName,
      importId: existingImport.id,
      fileName: existingImport.fileName,
      uploadedAt: existingImport.uploadedAt,
      validityStart: existingImport.validityStart,
      validityEnd: existingImport.validityEnd || null,
      isActive: true,
      status: 'active',
      activatedAt: now,
      createdBy: actorUser?.id || 'system',
      summary: {
        ...existingImport.summary,
        appliedCount: appliedRows.length,
        ...commitSummary,
      },
      supplierProductSnapshot: versionSnapshot,
      appliedRows,
      rows: committedRows,
      pendingApprovalRows,
      invalidRows,
      createdAt: now,
      updatedAt: now,
    };

    await supplierCatalogVersionRepo.create(newVersion);

    const finalizedImport = {
      ...existingImport,
      status: 'committed',
      committedAt: now,
      committedBy: actorUser?.id || 'system',
      summary: {
        ...existingImport.summary,
        appliedCount: appliedRows.length,
        ...commitSummary,
      },
      rows: committedRows,
      pendingApprovalRows,
      invalidRows,
    };

    await catalogImportRepo.updateById(existingImport.id, finalizedImport);

    return {
      importId: finalizedImport.id,
      status: finalizedImport.status,
      summary: finalizedImport.summary,
      commitReport: commitSummary,
      pendingApprovalRows,
      invalidRows,
      activeCatalogVersion: stripVersionPayload(newVersion),
    };
  },

  async listCatalogVersions(query = {}) {
    const filterSupplierId = normalizeText(query.supplierId);
    const [versions, supplierProducts, suppliers] = await Promise.all([
      supplierCatalogVersionRepo.getAll(),
      supplierProductRepo.getAll(),
      supplierRepo.getAll(),
    ]);

    // Gerçek import edilmiş versiyonlar
    const realVersions = versions
      .filter((item) => !filterSupplierId || String(item.supplierId) === filterSupplierId)
      .sort((left, right) => new Date(right.uploadedAt || 0) - new Date(left.uploadedAt || 0))
      .map(stripVersionPayload);

    // Gerçek versiyonu olan tedarikçilerin ID seti
    const suppliersWithRealCatalog = new Set(realVersions.map((v) => String(v.supplierId)));

    // Tedarikçi başına ürün eşleşmelerini grupla
    const productsBySupplierId = new Map();
    supplierProducts.forEach((sp) => {
      const key = String(sp.supplierId || '');
      if (!key) return;
      if (!productsBySupplierId.has(key)) productsBySupplierId.set(key, []);
      productsBySupplierId.get(key).push(sp);
    });

    const supplierMap = new Map(suppliers.map((s) => [String(s.id), s]));

    // Generated katalogları üret — sadece gerçek kataloğu olmayan tedarikçiler için
    const generatedVersions = [];
    productsBySupplierId.forEach((rows, sid) => {
      if (filterSupplierId && sid !== filterSupplierId) return;
      if (suppliersWithRealCatalog.has(sid)) return; // Gerçek kataloğu varsa generated üretme
      if (!rows.length) return;

      const activeRows = rows.filter((r) => r.isActive !== false);
      if (!activeRows.length) return;

      const supplier = supplierMap.get(sid);
      const supplierName = supplier?.name || rows[0]?.supplierName || sid;
      const supplierCode = supplier?.supplierCode || supplier?.code || sid;
      const createdAt = rows.reduce((earliest, r) => {
        const d = r.createdAt || r.updatedAt || '';
        return d < earliest ? d : earliest;
      }, rows[0].createdAt || new Date().toISOString());

      generatedVersions.push({
        id: `gen-catv-${sid}`,
        supplierId: sid,
        supplierCode,
        supplierName,
        importId: null,
        fileName: `${supplierName} - Sistem Kataloğu`,
        catalogName: `${supplierName} Ürün Kataloğu`,
        uploadedAt: createdAt,
        validityStart: createdAt,
        validityEnd: null,
        isActive: true,
        isActiveVersion: true,
        status: 'active',
        sourceType: 'generated',
        sourceLabel: 'Sistemden Üretildi',
        versionNo: 1,
        totalRowCount: activeRows.length,
        verificationStatus: 'verified',
        importStatus: 'completed',
        downloadable: true,
        viewable: true,
        activatedAt: createdAt,
        archivedAt: null,
        summary: {
          matchedCount: activeRows.length,
          newProductCount: 0,
          updateCount: 0,
          invalidCount: 0,
        },
        createdAt,
        updatedAt: createdAt,
      });
    });

    // Gerçek versiyonlara da sourceType/sourceLabel ekle
    const enrichedRealVersions = realVersions.map((v) => ({
      ...v,
      sourceType: v.sourceType || 'import',
      sourceLabel: v.sourceLabel || 'Manuel Yükleme',
      versionNo: v.versionNo || 1,
      isActiveVersion: v.isActive === true,
      totalRowCount: v.summary?.appliedCount || v.summary?.matchedCount || 0,
      verificationStatus: 'verified',
      importStatus: 'completed',
      downloadable: true,
      viewable: true,
    }));

    return [
      ...enrichedRealVersions,
      ...generatedVersions.sort((a, b) => String(a.supplierName).localeCompare(String(b.supplierName), 'tr')),
    ];
  },

  async getCatalogVersionRows(versionId) {
    // Generated katalog mu?
    if (String(versionId).startsWith('gen-catv-')) {
      const sid = String(versionId).replace('gen-catv-', '');
      const [supplierProducts, products, suppliers] = await Promise.all([
        supplierProductRepo.getAll(),
        productRepo.getAll(),
        supplierRepo.getAll(),
      ]);

      const productMap = new Map(products.map((p) => [String(p.id), p]));
      const supplier = suppliers.find((s) => String(s.id) === sid);
      const rows = supplierProducts.filter((sp) => String(sp.supplierId) === sid && sp.isActive !== false);

      return rows.map((sp, index) => {
        const product = productMap.get(String(sp.productId)) || {};
        return {
          rowIndex: index + 1,
          productId: sp.productId || product.id || '',
          sku: sp.supplierSku || product.sku || '-',
          barcode: sp.barcode || product.barcode || '-',
          productName: sp.supplierProductName || product.name || '-',
          brand: product.brand || '-',
          categoryName: product.categoryName || product.etiket || '-',
          subCategory: product.etiket || '-',
          unit: product.unit || 'Adet',
          unitsPerCase: sp.unitsPerCase || product.unitsPerCase || 1,
          casesPerPallet: sp.casesPerPallet || product.casesPerPallet || 1,
          storageType: product.requiredStorageType || 'Ortam',
          purchasePrice: sp.purchasePrice || 0,
          listPrice: sp.listPrice ?? product.salePrice ?? '',
          recommendedSalePrice: sp.recommendedSalePrice ?? product.salePrice ?? '',
          vatRate: sp.vatRate ?? '',
          packSize: sp.packSize || '',
          quantityPerPackage: sp.quantityPerPackage || '',
          availabilityStatus: sp.availabilityStatus || '',
          supplierStockQty: sp.supplierStockQty ?? '',
          supplierNote: sp.supplierNote || '',
          productDescription: sp.productDescription || product.productDescription || product.description || '',
          salePrice: product.salePrice || 0,
          previousSalePrice: product.previousSalePrice || null,
          lastPriceChangePercent: product.lastPriceChangePercent || null,
          priceHistory: Array.isArray(product.priceHistory) ? product.priceHistory : [],
          moqUnitPrice: sp.purchasePrice || 0,
          bulk10PlusUnitPrice: sp.tierPrice10Case || sp.purchasePrice || 0,
          minimumOrderQty: sp.minimumOrderQty || sp.minOrderQty || 1,
          leadTimeDays: sp.leadTimeDays || 3,
          currency: sp.currency || 'TRY',
          supplierProductCode: sp.supplierProductCode || '-',
          isActive: sp.isActive !== false,
        };
      });
    }

    // Gerçek katalog versiyonu
    const version = await supplierCatalogVersionRepo.findById(versionId);
    if (!version) throw createNotFoundError('Katalog versiyonu bulunamadı');

    const snapshot = Array.isArray(version.supplierProductSnapshot) ? version.supplierProductSnapshot : [];
    const products = await productRepo.getAll();
    const productMap = new Map(products.map((p) => [String(p.id), p]));

    return snapshot.map((sp, index) => {
      const product = productMap.get(String(sp.productId)) || {};
      return {
        rowIndex: index + 1,
        productId: sp.productId || product.id || '',
        sku: sp.supplierSku || product.sku || '-',
        barcode: sp.barcode || product.barcode || '-',
        productName: sp.supplierProductName || product.name || '-',
        brand: product.brand || '-',
        categoryName: product.categoryName || product.etiket || '-',
        subCategory: product.etiket || '-',
        unit: product.unit || 'Adet',
        unitsPerCase: sp.unitsPerCase || product.unitsPerCase || 1,
        casesPerPallet: sp.casesPerPallet || product.casesPerPallet || 1,
        storageType: product.requiredStorageType || 'Ortam',
        purchasePrice: sp.purchasePrice || 0,
        listPrice: sp.listPrice ?? product.salePrice ?? '',
        recommendedSalePrice: sp.recommendedSalePrice ?? product.salePrice ?? '',
        vatRate: sp.vatRate ?? '',
        packSize: sp.packSize || '',
        quantityPerPackage: sp.quantityPerPackage || '',
        availabilityStatus: sp.availabilityStatus || '',
        supplierStockQty: sp.supplierStockQty ?? '',
        supplierNote: sp.supplierNote || '',
        productDescription: sp.productDescription || product.productDescription || product.description || '',
        salePrice: product.salePrice || 0,
        previousSalePrice: product.previousSalePrice || null,
        lastPriceChangePercent: product.lastPriceChangePercent || null,
        priceHistory: Array.isArray(product.priceHistory) ? product.priceHistory : [],
        moqUnitPrice: sp.purchasePrice || 0,
        bulk10PlusUnitPrice: sp.tierPrice10Case || sp.purchasePrice || 0,
        minimumOrderQty: sp.minimumOrderQty || sp.minOrderQty || 1,
        leadTimeDays: sp.leadTimeDays || 3,
        currency: sp.currency || 'TRY',
        supplierProductCode: sp.supplierProductCode || '-',
        isActive: sp.isActive !== false,
      };
    });
  },

  async activateVersion(versionId, actorUser = {}) {
    const targetVersion = await supplierCatalogVersionRepo.findById(versionId);
    if (!targetVersion) throw createNotFoundError('Katalog versiyonu bulunamadı');

    const [allVersions, allSupplierProducts] = await Promise.all([
      supplierCatalogVersionRepo.getAll(),
      supplierProductRepo.getAll(),
    ]);

    const now = new Date().toISOString();

    const supplierVersions = allVersions.filter((item) => String(item.supplierId) === String(targetVersion.supplierId));
    for (const version of supplierVersions) {
      const shouldBeActive = String(version.id) === String(targetVersion.id);
      await supplierCatalogVersionRepo.updateById(version.id, {
        ...version,
        isActive: shouldBeActive,
        status: shouldBeActive ? 'active' : 'archived',
        activatedAt: shouldBeActive ? now : version.activatedAt,
        archivedAt: shouldBeActive ? null : now,
        updatedAt: now,
        lastActivatedBy: actorUser?.id || 'system',
      });
    }

    const targetSnapshot = Array.isArray(targetVersion.supplierProductSnapshot) ? targetVersion.supplierProductSnapshot : [];
    const targetSnapshotIds = new Set(targetSnapshot.map((item) => String(item.id)));

    const supplierRows = allSupplierProducts.filter((item) => String(item.supplierId) === String(targetVersion.supplierId));

    for (const row of supplierRows) {
      const shouldBeActive = targetSnapshotIds.has(String(row.id));
      await supplierProductRepo.updateById(row.id, {
        ...row,
        isActive: shouldBeActive,
        updatedAt: now,
      });
    }

    for (const snapshotItem of targetSnapshot) {
      const existing = supplierRows.find((item) => String(item.id) === String(snapshotItem.id));
      if (!existing) {
        await supplierProductRepo.create({
          ...snapshotItem,
          isActive: true,
          updatedAt: now,
          createdAt: snapshotItem.createdAt || now,
        });
      }
    }

    return {
      versionId: targetVersion.id,
      supplierId: targetVersion.supplierId,
      activatedAt: now,
      status: 'active',
    };
  },
};

export const __catalogImportInternals = {
  normalizeImportRow,
  collectRowErrors,
  buildPreviewRows,
  FIELD_ALIASES,
};

