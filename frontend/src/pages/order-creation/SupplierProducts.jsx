import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Link2, Plus, Minus, Filter, Package, ShoppingBag, Wallet, Truck, Scale, Boxes, Tag, AlertTriangle, Trash2, Info } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import DataTable from '../../components/DataTable.jsx';
import FilterBar from '../../components/FilterBar.jsx';
import FormModal from '../../components/FormModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { SearchableCombobox } from '../../components/SearchBar.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Toast from '../../components/Toast.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { productService } from '../../services/productService.js';
import { procurementService } from '../../services/procurementService.js';
import { formatCurrency, formatDate, formatNumber, formatStorageTypeLabel, formatTurkishDisplayText, includesNormalized, normalizeSearchText } from '../../services/formatters.js';
import { settingsService } from '../../services/settingsService.js';
import { supplierService } from '../../services/supplierService.js';
import { stockService } from '../../services/stockService.js';
import { dedupeOrderUnits, normalizeOrderUnit } from '../../utils/orderUnit.js';

const CURRENCY_OPTIONS = ['TRY', 'USD', 'EUR'];
const ORDER_UNIT_OPTIONS = ['adet', 'paket', 'kutu', 'koli', 'kasa', 'çuval', 'palet'];
const PROCUREMENT_ORDER_UNITS = ['adet', 'paket', 'kutu', 'koli', 'kasa', 'çuval', 'palet', 'kg', 'şişe'];
const PACKAGING_ORDER_UNITS = ['paket', 'kutu', 'koli', 'kasa', 'çuval', 'palet'];

const normalizeMoneyInput = (value) => String(value ?? '').replace(',', '.');

const parseMoneyInput = (value, fallback = 0) => {
  const normalized = normalizeMoneyInput(value).trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const MIN_DELIVERY_PERFORMANCE = 80;

const getEffectiveDeliveryPerformance = (raw) => {
  const numeric = Number(String(raw ?? '').replace('%', '').replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return MIN_DELIVERY_PERFORMANCE;
  }

  if (numeric < MIN_DELIVERY_PERFORMANCE) return MIN_DELIVERY_PERFORMANCE;
  if (numeric > 100) return 100;
  return numeric;
};

const initialForm = {
  productId: '',
  supplierId: '',
  supplierProductName: '',
  supplierSku: '',
  supplierProductCode: '',
  barcode: '',
  purchasePrice: '',
  tierPrice3Case: '',
  tierPrice10Case: '',
  tierPrice20Case: '',
  currency: 'TRY',
  priceUnit: 'adet',
  minimumOrderQty: '1',
  minOrderUnit: 'adet',
  orderUnit: 'adet',
  leadTimeDays: '3',
  unitsPerPack: '1',
  unitsPerBox: '1',
  unitsPerCase: '1',
  casesPerPallet: '1',
  unitsPerPallet: '1',
  defaultCargoTypeCode: 'standard_intercity',
  supplierLogisticsNote: '',
  note: '',
  isPreferred: false,
  isActive: true,
};

const initialFilters = {
  search: '',
  supplierId: '',
  productId: '',
  isActive: '',
  onlyMultiSupplier: false,
  onlyPreferredAssigned: false,
};

const ORDER_FLOW_MODES = {
  PRODUCT: 'product',
  BULK: 'bulk',
};

const PURCHASE_MODAL_MODES = {
  SINGLE_PURCHASE: 'single_purchase',
  BULK_REVIEW: 'bulk_review',
  CATALOG_CHECKOUT: 'catalog_checkout',
};

const RECENT_PRODUCTS_STORAGE_KEY = 'shelfio.purchaseRecentProducts';
const RECENT_PRODUCTS_MAX = 40;
const PRODUCT_QUICK_PICK_LIMIT = 5;
const PURCHASE_SUGGESTION_HANDOFF_STORAGE_KEY = 'shelfio.purchaseSuggestions.handoffs.v1';
const PURCHASE_SUGGESTION_QUERY_KEYS = ['source', 'intent', 'count', 'handoffId', 'productId', 'supplierId', 'productIds', 'supplierIds'];
const SUPPLIER_PRODUCTS_PAGE_LIMIT = 50;
const toEntityKey = (value) => String(value ?? '').trim();

const normalizeSuggestionIntent = (value = '') => {
  const normalized = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (normalized === 'bulk') return 'bulk';
  if (normalized === 'manual') return 'manual';
  return 'single';
};

const parseSuggestionQueryList = (value = '') => String(value || '')
  .split(',')
  .map((item) => String(item || '').trim())
  .filter(Boolean);

const normalizeSuggestionLookupText = (value = '') => normalizeSearchText(String(value || '').trim());

const sanitizePurchaseSuggestionState = (state) => {
  if (!state || typeof state !== 'object') return null;
  const nextState = { ...state };
  delete nextState.purchaseSuggestionHandoffId;
  delete nextState.purchaseSuggestion;
  delete nextState.purchaseSuggestions;
  delete nextState.purchaseSuggestionFlow;
  return Object.keys(nextState).length ? nextState : null;
};

const readPurchaseSuggestionHandoffStore = () => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(PURCHASE_SUGGESTION_HANDOFF_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const persistPurchaseSuggestionHandoffStore = (handoffStore) => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PURCHASE_SUGGESTION_HANDOFF_STORAGE_KEY, JSON.stringify(handoffStore));
  } catch {
    // no-op
  }
};

const readPurchaseSuggestionHandoff = (handoffId = '') => {
  const normalizedId = String(handoffId || '').trim();
  if (!normalizedId) return null;
  return readPurchaseSuggestionHandoffStore()[normalizedId] || null;
};

const removePurchaseSuggestionHandoff = (handoffId = '') => {
  const normalizedId = String(handoffId || '').trim();
  if (!normalizedId) return;
  const handoffStore = readPurchaseSuggestionHandoffStore();
  if (!handoffStore[normalizedId]) return;
  delete handoffStore[normalizedId];
  persistPurchaseSuggestionHandoffStore(handoffStore);
};

const buildPurchaseSuggestionArchiveSnapshot = (item = {}) => ({
  id: String(item.suggestionId || item.id || '').trim(),
  productId: String(item.productId || '').trim(),
  productName: item.productName || '-',
  sku: item.sku || item.productSku || '-',
  supplierId: String(item.supplierId || '').trim(),
  supplierName: item.supplierName || 'Tedarikçi atanmadı',
  suggestedQty: Number(item.recommendedBaseQuantity || item.recommendedQuantity || 0) || 0,
  purchasePrice: Number(item.purchaseUnitPrice || item.purchasePrice || 0) || 0,
  currentStock: Number(item.currentStock || 0) || 0,
  shelfStock: Number(item.shelfStock || 0) || 0,
  warehouseStock: Number(item.warehouseStock || 0) || 0,
  reason: item.recommendationReason || item.reason || '-',
  actionableReason: item.recommendationReason || item.reason || '-',
  riskLevel: item.riskLevel || '',
  orderUnit: String(item.orderUnit || 'adet').trim().toLocaleLowerCase('tr-TR') || 'adet',
  unitsPerPack: Number(item.unitsPerPack || item.packageSize || 1) || 1,
  unitsPerCase: Number(item.unitsPerCase || item.packageSize || 1) || 1,
  unitsPerPallet: Number(item.unitsPerPallet || item.packageSize || 1) || 1,
  packageSize: Number(item.packageSize || item.unitsPerCase || item.unitsPerPack || 1) || 1,
  createdAt: item.createdAt || '',
  updatedAt: item.updatedAt || new Date().toISOString(),
});

const buildPurchaseSuggestionQueryItems = (searchParams, intent) => {
  const productIds = parseSuggestionQueryList(searchParams.get('productIds'));
  const supplierIds = parseSuggestionQueryList(searchParams.get('supplierIds'));

  if (!productIds.length && searchParams.get('productId')) {
    productIds.push(String(searchParams.get('productId') || '').trim());
  }

  if (!supplierIds.length && searchParams.get('supplierId')) {
    supplierIds.push(String(searchParams.get('supplierId') || '').trim());
  }

  if (!productIds.length) return [];

  const normalizedIntent = normalizeSuggestionIntent(intent);
  const items = productIds.map((productId, index) => ({
    productId,
    supplierId: supplierIds[index] || supplierIds[0] || '',
    recommendedQuantity: 1,
    orderUnit: 'adet',
    source: 'purchase_suggestions_query',
  }));

  return normalizedIntent === 'single' ? items.slice(0, 1) : items;
};

const extractPurchaseSuggestionPayload = ({ locationState, searchParams }) => {
  const handoffId = String(
    searchParams.get('handoffId')
    || locationState?.purchaseSuggestionHandoffId
    || ''
  ).trim();
  const handoff = handoffId ? readPurchaseSuggestionHandoff(handoffId) : null;
  const intent = normalizeSuggestionIntent(
    searchParams.get('intent')
    || handoff?.intent
    || locationState?.purchaseSuggestionFlow?.mode
  );
  const flowItems = Array.isArray(locationState?.purchaseSuggestionFlow?.items) ? locationState.purchaseSuggestionFlow.items : [];
  const stateItems = Array.isArray(locationState?.purchaseSuggestions) ? locationState.purchaseSuggestions : [];
  const singleItem = locationState?.purchaseSuggestion ? [locationState.purchaseSuggestion] : [];
  const handoffItems = Array.isArray(handoff?.items) ? handoff.items : [];
  const candidates = handoffItems.length
    ? handoffItems
    : flowItems.length
    ? flowItems
    : stateItems.length
      ? stateItems
      : singleItem.length
        ? singleItem
        : buildPurchaseSuggestionQueryItems(searchParams, intent);

  const deduped = [];
  const seenKeys = new Set();
  candidates.forEach((item) => {
    if (!item) return;
    const productId = toEntityKey(item.productId);
    const supplierId = String(item.supplierId || '').trim();
    if (!productId) return;
    const dedupeKey = [
      String(item.suggestionId || item.id || '').trim() || productId,
      supplierId,
      String(item.orderUnit || '').trim().toLocaleLowerCase('tr-TR'),
    ].join(':');
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);
    deduped.push(item);
  });
  return {
    handoffId,
    handoff,
    intent,
    items: intent === 'single' ? deduped.slice(0, 1) : deduped,
  };
};

const isValidSuggestionQuantity = (item = {}) => {
  if (item.recommendedQuantity == null || item.recommendedQuantity === '') return true;
  const quantity = Number(item.recommendedQuantity);
  return Number.isFinite(quantity) && quantity > 0;
};

const getSuggestionLookupKey = (item = {}) => {
  const supplierProductId = String(item?.supplierProductId || '').trim();
  const productId = toEntityKey(item?.productId);
  const supplierId = String(item?.supplierId || '').trim();
  return [
    supplierProductId ? `sp:${supplierProductId}` : '',
    productId ? `p:${productId}` : '',
    supplierId ? `s:${supplierId}` : '',
    String(item?.suggestionId || item?.id || '').trim(),
  ].filter(Boolean).join('|') || 'unknown';
};

const isApiSupplierProductRow = (row = {}) => Boolean(
  row
  && row.source === 'api'
  && row.isActive !== false
  && String(row.id || row.supplierProductId || '').trim()
);

const resolveSuggestionRow = (suggestionItem, availableRows = [], products = [], supplierLookup = new Map()) => {
  const supplierProductId = String(suggestionItem?.supplierProductId || '').trim();
  const productId = toEntityKey(suggestionItem?.productId);
  const supplierId = String(suggestionItem?.supplierId || '').trim();
  const suggestionSku = normalizeSuggestionLookupText(suggestionItem?.sku || suggestionItem?.productSku);
  const suggestionName = normalizeSuggestionLookupText(suggestionItem?.productName);

  if (supplierProductId) {
    const directMatch = availableRows.find((row) => (
      String(row?.id || row?.supplierProductId || '').trim() === supplierProductId
      && row?.source === 'api'
      && row?.isActive !== false
    ));
    if (directMatch) return directMatch;
  }

  const matchedProduct = products.find((product) =>
    (productId && toEntityKey(product?.id) === productId)
    || (suggestionSku && normalizeSuggestionLookupText(product?.sku) === suggestionSku)
    || (suggestionName && normalizeSuggestionLookupText(product?.name) === suggestionName)
  ) || null;

  const productIdCandidates = new Set(
    [productId, matchedProduct?.id]
      .map((value) => toEntityKey(value))
      .filter(Boolean)
  );

  const candidates = availableRows.filter((row) => {
    if (!row || row.source !== 'api' || row.isActive === false) return false;
    const rowProductId = toEntityKey(row.productId);
    const rowSku = normalizeSuggestionLookupText(row.productSku);
    const rowName = normalizeSuggestionLookupText(row.productName);
    return (
      (rowProductId && productIdCandidates.has(rowProductId))
      || (suggestionSku && rowSku === suggestionSku)
      || (suggestionName && rowName === suggestionName)
    );
  });

  if (candidates.length) {
    if (supplierId) {
      const exactMatch = candidates.find((row) => String(row.supplierId || '').trim() === supplierId);
      if (exactMatch) return exactMatch;
    }
    return candidates.find((row) => row.isPreferred) || candidates[0] || null;
  }

  if (!matchedProduct) return null;

  const supplierMeta = supplierLookup.get(supplierId) || null;
  const fallbackUnit = String(
    suggestionItem?.orderUnit
    || matchedProduct?.defaultOrderUnit
    || matchedProduct?.orderUnit
    || 'adet'
  ).trim().toLocaleLowerCase('tr-TR') || 'adet';
  const unitsPerCase = Math.max(1, Number(matchedProduct?.unitsPerCase || suggestionItem?.unitsPerCase || suggestionItem?.packageSize || 1));
  const casesPerPallet = Math.max(1, Number(matchedProduct?.casesPerPallet || 1));
  const unitsPerPallet = Math.max(
    1,
    Number(matchedProduct?.unitsPerPallet || suggestionItem?.unitsPerPallet || unitsPerCase * casesPerPallet || 1)
  );

  return {
    id: `suggestion-fallback:${String(suggestionItem?.suggestionId || matchedProduct.id || productId || 'unknown')}`,
    supplierProductId: null,
    source: 'suggestion_fallback',
    isActive: true,
    isPreferred: true,
    productId: matchedProduct.id || productId,
    productName: suggestionItem?.productName || matchedProduct?.name || '-',
    productSku: suggestionItem?.sku || matchedProduct?.sku || '-',
    barcode: matchedProduct?.barcode || '-',
    supplierId: supplierId || matchedProduct?.supplierId || '',
    supplierName: suggestionItem?.supplierName || supplierMeta?.name || 'Tedarikçi atanmadı',
    supplierProductName: suggestionItem?.productName || matchedProduct?.name || '-',
    supplierSku: suggestionItem?.sku || matchedProduct?.sku || '-',
    supplierProductCode: `SUGGESTION-${matchedProduct?.id || productId || 'UNKNOWN'}`,
    purchasePrice: Number(suggestionItem?.purchaseUnitPrice || matchedProduct?.purchasePrice || 0) || 0,
    currency: matchedProduct?.currency || 'TRY',
    minimumOrderQty: 1,
    leadTimeDays: Number(matchedProduct?.leadTimeDays || 3) || 3,
    productUnit: matchedProduct?.unit || '',
    orderUnit: fallbackUnit,
    priceUnit: matchedProduct?.priceUnit || 'adet',
    minOrderUnit: fallbackUnit,
    defaultOrderUnit: fallbackUnit,
    orderableUnits: dedupeOrderUnits([fallbackUnit, matchedProduct?.defaultOrderUnit, matchedProduct?.orderUnit, matchedProduct?.unit, 'adet'].filter(Boolean)),
    unitsPerPack: Math.max(1, Number(matchedProduct?.unitsPerPack || suggestionItem?.unitsPerPack || suggestionItem?.packageSize || 1)),
    unitsPerBox: Math.max(1, Number(matchedProduct?.unitsPerBox || matchedProduct?.unitsPerCase || suggestionItem?.unitsPerCase || suggestionItem?.packageSize || 1)),
    unitsPerCase,
    casesPerPallet,
    unitsPerPallet,
    productCategoryId: matchedProduct?.categoryId || '',
    categoryLabel: matchedProduct?.categoryName || 'Diğer',
    note: '',
    defaultCargoTypeCode: '',
    supplierLogisticsNote: '',
    updatedAt: suggestionItem?.updatedAt || new Date().toISOString(),
    isSuggestionFallback: true,
  };
};

const getSuggestionResolveFailureMessage = (item = {}, products = [], supplierLookup = new Map()) => {
  const productId = toEntityKey(item?.productId);
  const supplierId = String(item?.supplierId || '').trim();
  const suggestionSku = normalizeSuggestionLookupText(item?.sku || item?.productSku);
  const suggestionName = normalizeSuggestionLookupText(item?.productName);
  const matchedProduct = products.find((product) => (
    (productId && toEntityKey(product?.id) === productId)
    || (suggestionSku && normalizeSuggestionLookupText(product?.sku) === suggestionSku)
    || (suggestionName && normalizeSuggestionLookupText(product?.name) === suggestionName)
  )) || null;

  if (!productId && !suggestionSku && !suggestionName) return 'Öneri kaydı eksik olduğu için taslak açılamadı.';
  if (!matchedProduct) return 'Bu öneriye bağlı ürün eşleşmesi bulunamadı.';
  if (supplierId && !supplierLookup.has(supplierId)) return 'Bu öneriye bağlı tedarikçi eşleşmesi bulunamadı.';
  return 'Ürün bulundu ancak geçerli tedarikçi bağlantısı alınamadı.';
};

const DEFAULT_CARGO_TYPES = [
  { cargoTypeCode: 'standard_intercity', cargoTypeName: 'Standart Şehirlerarası' },
  { cargoTypeCode: 'express_next_day', cargoTypeName: 'Hızlı / Ertesi Gün' },
  { cargoTypeCode: 'cold_chain', cargoTypeName: 'Soğuk Zincir' },
  { cargoTypeCode: 'frozen_chain', cargoTypeName: 'Donuk Zincir' },
  { cargoTypeCode: 'store_transfer', cargoTypeName: 'Mağaza / Depo Transfer' },
];

// ── Kullanıcıya gösterilen servis seviyeleri (teknik taşıma tipi değil) ──
const SERVICE_LEVEL_OPTIONS = [
  { value: 'standard', label: 'Standart' },
  { value: 'express', label: 'Express' },
  { value: 'next_day', label: 'Ertesi Gün' },
  { value: 'same_day', label: 'Aynı Gün Teslim' },
];

// Servis seviyesi → teknik kargo kodu eşlemesi (ambient ürünler için)
const SERVICE_LEVEL_TO_CARGO_CODE = {
  standard: 'standard_intercity',
  express: 'express_next_day',
  next_day: 'express_next_day',
  same_day: 'express_next_day',
};

// Koli bazlı tarife (TL) — servis seviyesi × koli aralığı
const CASE_BASED_TARIFF = {
  standard: [
    { min: 1, max: 5, base: 60, perCase: 0 },
    { min: 6, max: 10, base: 90, perCase: 4 },
    { min: 11, max: 20, base: 120, perCase: 3.5 },
    { min: 21, max: 30, base: 160, perCase: 3 },
    { min: 31, max: 50, base: 210, perCase: 2.5 },
    { min: 51, max: Infinity, base: 310, perCase: 2 },
  ],
  express: [
    { min: 1, max: 5, base: 100, perCase: 0 },
    { min: 6, max: 10, base: 150, perCase: 7 },
    { min: 11, max: 20, base: 210, perCase: 6 },
    { min: 21, max: 30, base: 280, perCase: 5 },
    { min: 31, max: 50, base: 360, perCase: 4.5 },
    { min: 51, max: Infinity, base: 500, perCase: 3.5 },
  ],
  next_day: [
    { min: 1, max: 5, base: 80, perCase: 0 },
    { min: 6, max: 10, base: 120, perCase: 5 },
    { min: 11, max: 20, base: 170, perCase: 4.5 },
    { min: 21, max: 30, base: 220, perCase: 4 },
    { min: 31, max: 50, base: 290, perCase: 3.5 },
    { min: 51, max: Infinity, base: 400, perCase: 2.5 },
  ],
  same_day: [
    { min: 1, max: 5, base: 140, perCase: 0 },
    { min: 6, max: 10, base: 210, perCase: 10 },
    { min: 11, max: 20, base: 300, perCase: 9 },
    { min: 21, max: 30, base: 400, perCase: 7.5 },
    { min: 31, max: 50, base: 525, perCase: 6 },
    { min: 51, max: Infinity, base: 725, perCase: 5 },
  ],
};

// Soğuk/donuk zincir için ek çarpan
const COLD_CHAIN_MULTIPLIER = 1.35;
const FROZEN_CHAIN_MULTIPLIER = 1.60;

/**
 * Koli bazlı lojistik hesabı.
 * @param {object} params
 * @param {number} params.totalUnits - toplam sipariş adedi
 * @param {number} params.unitsPerCase - case pack
 * @param {string} params.serviceLevel - 'standard' | 'express' | 'next_day' | 'same_day'
 * @param {string} params.storageType - 'ambient' | 'cold' | 'frozen'
 * @returns {{ caseQty, technicalCargoCode, technicalCargoLabel, fee, reason, error }}
 */
const computeLogisticsQuote = ({ totalUnits, unitsPerCase, serviceLevel, storageType }) => {
  const units = Number(totalUnits || 0);
  const caseSize = Number(unitsPerCase || 0);

  if (!Number.isFinite(caseSize) || caseSize <= 0) {
    return {
      caseQty: null,
      technicalCargoCode: null,
      technicalCargoLabel: null,
      fee: null,
      reason: null,
      error: 'Kargo hesaplanamadı: ürün case pack bilgisi eksik.',
    };
  }

  const caseQty = Math.ceil(units / caseSize);
  const level = SERVICE_LEVEL_OPTIONS.find((o) => o.value === serviceLevel) ? serviceLevel : 'standard';
  const tariffBands = CASE_BASED_TARIFF[level];

  if (!tariffBands) {
    return {
      caseQty,
      technicalCargoCode: null,
      technicalCargoLabel: null,
      fee: null,
      reason: null,
      error: 'Kargo hesaplanamadı: uygun tarife bulunamadı.',
    };
  }

  const band = tariffBands.find((b) => caseQty >= b.min && caseQty <= b.max);
  if (!band) {
    return {
      caseQty,
      technicalCargoCode: null,
      technicalCargoLabel: null,
      fee: null,
      reason: null,
      error: 'Kargo hesaplanamadı: uygun tarife bulunamadı.',
    };
  }

  const baseFee = band.base + (caseQty > band.min ? (caseQty - band.min) * band.perCase : 0);

  // Teknik taşıma koşulunu sistem belirler
  const storage = storageType || 'ambient';
  let technicalCargoCode = SERVICE_LEVEL_TO_CARGO_CODE[level] || 'standard_intercity';
  let technicalCargoLabel = 'Ortam';
  let multiplier = 1;
  let reason = `Toplam ${caseQty} koli, ${SERVICE_LEVEL_OPTIONS.find((o) => o.value === level)?.label || level} servis seviyesi.`;

  if (storage === 'frozen') {
    technicalCargoCode = 'frozen_chain';
    technicalCargoLabel = 'Donuk Zincir';
    multiplier = FROZEN_CHAIN_MULTIPLIER;
    reason = `Siparişte donuk ürün bulunduğu için donuk zincir taşıma kuralı uygulandı. Toplam ${caseQty} koli.`;
  } else if (storage === 'cold') {
    technicalCargoCode = 'cold_chain';
    technicalCargoLabel = 'Soğuk Zincir';
    multiplier = COLD_CHAIN_MULTIPLIER;
    reason = `Siparişte soğuk ürün bulunduğu için soğuk zincir taşıma kuralı uygulandı. Toplam ${caseQty} koli.`;
  } else if (storage === 'mixed_cold') {
    technicalCargoCode = 'cold_chain';
    technicalCargoLabel = 'Soğuk Zincir (Mixed)';
    multiplier = COLD_CHAIN_MULTIPLIER;
    reason = `Karma sipariş: soğuk ve ortam ürünler birlikte. En sıkı uygun kural (soğuk zincir) uygulandı. Toplam ${caseQty} koli.`;
  } else if (storage === 'mixed_frozen') {
    technicalCargoCode = 'frozen_chain';
    technicalCargoLabel = 'Donuk Zincir (Mixed)';
    multiplier = FROZEN_CHAIN_MULTIPLIER;
    reason = `Karma sipariş: donuk ve diğer ürünler birlikte. En sıkı uygun kural (donuk zincir) uygulandı. Toplam ${caseQty} koli.`;
  }

  const fee = Math.round(baseFee * multiplier);

  return {
    caseQty,
    technicalCargoCode,
    technicalCargoLabel,
    fee,
    reason,
    error: null,
  };
};

const getDeliveryLeadDaysForService = (baseLeadDays, serviceLevel) => {
  const lead = Math.max(1, Math.ceil(Number(baseLeadDays || 1) || 1));

  switch (serviceLevel) {
    case 'same_day':
      return 0;
    case 'next_day':
      return 1;
    case 'express':
      return Math.min(lead, 2);
    case 'standard':
    default:
      return lead;
  }
};

const formatDateInputValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const computeEstimatedDeliveryDate = ({ baseLeadDays, serviceLevel }) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + getDeliveryLeadDaysForService(baseLeadDays, serviceLevel));
  return formatDateInputValue(date);
};

/**
 * Birden fazla ürün satırından toplam taşıma koşulunu belirler.
 * En sıkı kural kazanır: frozen > cold > ambient
 */
const resolveStorageTypeFromLines = (lines = [], productMap = new Map()) => {
  let hasFrozen = false;
  let hasCold = false;
  let hasAmbient = false;

  lines.forEach((line) => {
    const normalized = resolveLineStorageType(line, productMap);
    if (normalized === 'frozen') hasFrozen = true;
    else if (normalized === 'cold') hasCold = true;
    else hasAmbient = true;
  });

  if (hasFrozen && (hasCold || hasAmbient)) return 'mixed_frozen';
  if (hasFrozen) return 'frozen';
  if (hasCold && hasAmbient) return 'mixed_cold';
  if (hasCold) return 'cold';
  return 'ambient';
};

const roundCurrencyValue = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(2));
};

const getFirstFiniteNumber = (...values) => {
  for (let index = 0; index < values.length; index += 1) {
    const numeric = Number(values[index]);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const formatOrderUnitSummaryLabel = (unit = 'adet') => normalizeOrderUnit(unit || 'adet');

const resolveDisplayBaseUnit = (item = {}, fallbackUnit = 'adet') => {
  const normalizedFallback = normalizeOrderUnit(fallbackUnit || 'adet') || 'adet';
  const canonicalProductUnit = normalizeOrderUnit(
    item?.productUnit
    || item?.productBaseUnit
    || item?.canonicalUnit
    || ''
  );

  if (canonicalProductUnit === 'kg') {
    return 'kg';
  }

  return PACKAGING_ORDER_UNITS.includes(normalizedFallback) ? 'adet' : normalizedFallback;
};

const formatUnitBreakdownLabel = (entries = []) => entries
  .filter((entry) => Number(entry?.quantity || 0) > 0)
  .map((entry) => `${formatNumber(Number(entry.quantity || 0))} ${formatOrderUnitSummaryLabel(entry.unit)}`)
  .join(' • ');

const getCargoTypeMeta = (cargoTypeCode = '') => DEFAULT_CARGO_TYPES.find((item) => item.cargoTypeCode === cargoTypeCode) || null;

const resolveLineStorageType = (line = {}, productMap = new Map()) => {
  const product = productMap.get(String(line.productId || '')) || null;
  return normalizeStorageType(
    line?.requiredStorageType
    || line?.storageType
    || product?.requiredStorageType
    || product?.storageType
    || product?.storageCondition
    || ''
  );
};

const buildBulkQuoteLineItems = (items = [], productMap = new Map()) => items.map((line) => {
  const product = productMap.get(toEntityKey(line.productId)) || null;
  return {
    quantity: Number(line.quantity || 0) || 0,
    orderUnit: line.unit || 'adet',
    unitsPerCase: Number(line.unitsPerCase || product?.unitsPerCase || 0) || null,
    storageType: resolveLineStorageType(line, productMap),
  };
});

const isTariffRowCompatibleForBulkQuote = (row = {}, { cargoTypeCode = '', storageType = 'ambient', isInternalTransfer = false } = {}) => {
  const normalizedCargoTypeCode = String(cargoTypeCode || '').trim().toLowerCase();
  const rowCargoTypeCode = String(row.cargoTypeCode || '').trim().toLowerCase();
  if (normalizedCargoTypeCode && rowCargoTypeCode !== normalizedCargoTypeCode) return false;
  if (row.isActive === false) return false;

  const rowDistanceType = String(row.distanceType || 'intercity').trim().toLowerCase();
  if (isInternalTransfer) {
    return rowDistanceType === 'internal_transfer';
  }
  if (rowDistanceType !== 'intercity') return false;

  const normalizedStorageType = normalizeStorageType(storageType);
  const compatibility = String(row.storageCompatibility || 'ambient')
    .split(',')
    .map((item) => normalizeStorageType(item))
    .filter(Boolean);

  if (!compatibility.length) return true;
  if (normalizedStorageType === 'frozen') {
    return compatibility.includes('frozen') || compatibility.includes('cold');
  }
  if (normalizedStorageType === 'cold') {
    return compatibility.includes('cold') || compatibility.includes('frozen');
  }
  return compatibility.includes('ambient') || compatibility.includes('cold') || compatibility.includes('frozen');
};

const buildBulkCargoCandidateCodes = ({
  serviceLevel,
  storageType,
  deliveryType,
  shippingCarrier,
  technicalCargoCode,
  logisticsTariffRows = [],
}) => {
  const normalizedServiceLevel = String(serviceLevel || 'standard').trim().toLowerCase();
  const normalizedStorageType = normalizeStorageType(storageType);
  const normalizedDeliveryType = String(deliveryType || '').trim().toLowerCase();
  const normalizedShippingCarrier = String(shippingCarrier || '').trim().toLowerCase();
  const isInternalTransfer = normalizedShippingCarrier === 'store_transfer' || normalizedDeliveryType === 'pickup';
  const candidates = [];

  const pushCandidate = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  pushCandidate(technicalCargoCode);

  if (normalizedShippingCarrier && isCargoTypeCompatible(normalizedShippingCarrier, normalizedStorageType)) {
    pushCandidate(normalizedShippingCarrier);
  }

  if (isInternalTransfer) {
    pushCandidate('store_transfer');
  } else if (normalizedStorageType === 'frozen') {
    pushCandidate('frozen_chain');
    pushCandidate('cold_chain');
  } else if (normalizedStorageType === 'cold') {
    pushCandidate('cold_chain');
    pushCandidate('frozen_chain');
  } else {
    pushCandidate(normalizedServiceLevel === 'standard' ? 'standard_intercity' : 'express_next_day');
    pushCandidate('standard_intercity');
    pushCandidate('express_next_day');
  }

  const compatibleTariffCodes = Array.from(new Set(
    (Array.isArray(logisticsTariffRows) ? logisticsTariffRows : [])
      .filter((row) => isTariffRowCompatibleForBulkQuote(row, { storageType: normalizedStorageType, isInternalTransfer }))
      .map((row) => String(row.cargoTypeCode || '').trim().toLowerCase())
      .filter(Boolean)
  ));

  compatibleTariffCodes.forEach(pushCandidate);
  return candidates.length ? candidates : ['standard_intercity'];
};

const normalizeBulkLogisticsErrorMessage = (message = '') => {
  const normalizedMessage = String(message || '').trim();
  if (!normalizedMessage) return 'Tarife bulunamadı.';
  if (/case pack|koli bilgisi|koli karş/i.test(normalizedMessage)) {
    return 'Tarife bulunamadı: koli / case pack bilgisi eksik.';
  }
  if (/uyumlu değil/i.test(normalizedMessage)) {
    return 'Tarife bulunamadı: teslimat servisi ile taşıma koşulu uyumsuz.';
  }
  if (/tarife|fiyat bandı/i.test(normalizedMessage)) {
    return 'Tarife bulunamadı.';
  }
  return normalizedMessage;
};

const resolveBulkTechnicalCargo = ({
  serviceLevel,
  storageType,
  deliveryType,
  shippingCarrier,
}) => {
  const normalizedDeliveryType = String(deliveryType || '').trim().toLowerCase();
  const normalizedShippingCarrier = String(shippingCarrier || '').trim().toLowerCase();

  if (normalizedShippingCarrier === 'store_transfer' || normalizedDeliveryType === 'pickup') {
    return {
      technicalCargoCode: 'store_transfer',
      technicalCargoLabel: 'Mağaza / Depo Transfer',
      distanceType: 'internal_transfer',
      isInternalTransfer: true,
    };
  }

  if (storageType === 'mixed_frozen' || storageType === 'frozen') {
    return {
      technicalCargoCode: 'frozen_chain',
      technicalCargoLabel: storageType === 'mixed_frozen' ? 'Donuk Zincir (Karma)' : 'Donuk Zincir',
      distanceType: 'intercity',
      isInternalTransfer: false,
    };
  }

  if (storageType === 'mixed_cold' || storageType === 'cold') {
    return {
      technicalCargoCode: 'cold_chain',
      technicalCargoLabel: storageType === 'mixed_cold' ? 'Soğuk Zincir (Karma)' : 'Soğuk Zincir',
      distanceType: 'intercity',
      isInternalTransfer: false,
    };
  }

  const technicalCargoCode = SERVICE_LEVEL_TO_CARGO_CODE[serviceLevel] || normalizedShippingCarrier || 'standard_intercity';
  const cargoTypeMeta = DEFAULT_CARGO_TYPES.find((item) => item.cargoTypeCode === technicalCargoCode);

  return {
    technicalCargoCode,
    technicalCargoLabel: cargoTypeMeta?.cargoTypeName || 'Standart Şehirlerarası',
    distanceType: 'intercity',
    isInternalTransfer: false,
  };
};

const buildBulkGroupMetrics = ({ items = [], productMap = new Map(), stockMap = new Map() }) => {
  const unitTotals = new Map();
  const moqIssues = [];
  let totalBaseQty = 0;
  let totalCaseQty = 0;
  let totalPalletQty = 0;
  let totalWeightKg = 0;
  let totalVolumeDesi = 0;
  let hasWeightData = false;
  let hasVolumeData = false;
  let totalCurrentStock = 0;
  let totalProjectedStock = 0;
  let linesWithStockData = 0;
  let criticalBelowCount = 0;
  let criticalRecoveredCount = 0;
  let targetRecoveredCount = 0;

  items.forEach((line) => {
    const normalizedUnit = normalizeOrderUnit(line.unit || 'adet');
    const selectedQty = Math.max(0, Number(line.quantity || 0) || 0);
    unitTotals.set(normalizedUnit, Number(unitTotals.get(normalizedUnit) || 0) + selectedQty);

    const metrics = computeOrderMetrics({
      quantity: selectedQty,
      unit: normalizedUnit,
      item: line || {},
    });
    const productKey = toEntityKey(line.productId);
    const product = productMap.get(productKey) || null;
    const quantityBase = Math.max(0, Number(metrics?.quantityBase ?? line.quantityBase ?? 0) || 0);
    const unitsPerCase = Math.max(0, Number(line.unitsPerCase || product?.unitsPerCase || 0) || 0);
    const unitsPerPallet = Math.max(0, Number(line.unitsPerPallet || product?.unitsPerPallet || 0) || 0);
    const estimatedCaseQty = normalizedUnit === 'koli'
      ? selectedQty
      : (unitsPerCase > 0 ? Math.ceil(quantityBase / unitsPerCase) : Math.max(0, Number(metrics?.caseQty || 0)));
    const estimatedPalletQty = normalizedUnit === 'palet'
      ? selectedQty
      : (unitsPerPallet > 0 ? Number((quantityBase / unitsPerPallet).toFixed(2)) : Math.max(0, Number(metrics?.paletteQty || 0)));

    totalBaseQty += quantityBase;
    totalCaseQty += Math.max(0, Number(estimatedCaseQty || 0));
    totalPalletQty += Math.max(0, Number(estimatedPalletQty || 0));

    if (metrics?.reason === 'min') {
      moqIssues.push({
        supplierId: line.supplierId,
        supplierName: line.supplierName,
        productId: line.productId,
        productName: line.productName,
        minimumQty: Number(metrics.minQty || line.minimumOrderQty || 1),
        minimumUnit: metrics.minUnit || line.minOrderUnit || line.unit || 'adet',
        selectedQty,
        selectedUnit: normalizedUnit,
      });
    }

    const weightPerBase = getFirstFiniteNumber(
      line.averageWeightKg,
      line.weightKg,
      line.netWeightKg,
      product?.averageWeightKg,
      product?.weightKg,
      product?.netWeightKg,
    );
    if (weightPerBase !== null && weightPerBase > 0 && quantityBase > 0) {
      totalWeightKg += quantityBase * weightPerBase;
      hasWeightData = true;
    }

    const volumePerBase = getFirstFiniteNumber(
      line.averageDesi,
      line.desi,
      product?.averageDesi,
      product?.desi,
    );
    if (volumePerBase !== null && volumePerBase > 0 && quantityBase > 0) {
      totalVolumeDesi += quantityBase * volumePerBase;
      hasVolumeData = true;
    }

    const stock = stockMap.get(productKey) || null;
    if (stock) {
      const warehouseStock = Number(stock.warehouseStock || stock.warehouseQuantity || 0) || 0;
      const shelfStock = Number(stock.shelfStock || stock.shelfQuantity || 0) || 0;
      const currentTotal = Number(stock.totalStock || stock.quantity || (warehouseStock + shelfStock)) || 0;
      const projectedTotal = currentTotal + quantityBase;
      const criticalStock = Number(stock.criticalStock ?? product?.criticalStock ?? 0) || 0;
      const targetStock = Number(product?.targetStock || (criticalStock > 0 ? criticalStock * 2 : 0)) || 0;

      totalCurrentStock += currentTotal;
      totalProjectedStock += projectedTotal;
      linesWithStockData += 1;

      if (criticalStock > 0 && projectedTotal < criticalStock) criticalBelowCount += 1;
      if (criticalStock > 0 && currentTotal < criticalStock && projectedTotal >= criticalStock) criticalRecoveredCount += 1;
      if (targetStock > 0 && currentTotal < targetStock && projectedTotal >= targetStock) targetRecoveredCount += 1;
    }
  });

  const unitBreakdown = Array.from(unitTotals.entries()).map(([unit, quantity]) => ({
    unit,
    quantity: Number(quantity || 0),
  }));

  return {
    storageType: resolveStorageTypeFromLines(items, productMap),
    unitBreakdown,
    unitBreakdownLabel: formatUnitBreakdownLabel(unitBreakdown),
    totalBaseQty: Number(totalBaseQty.toFixed(2)),
    totalCaseQty: Number(totalCaseQty.toFixed(2)),
    totalPalletQty: Number(totalPalletQty.toFixed(2)),
    totalWeightKg: Number(totalWeightKg.toFixed(2)),
    totalVolumeDesi: Number(totalVolumeDesi.toFixed(2)),
    hasWeightData,
    hasVolumeData,
    moqIssues,
    stockImpact: {
      totalCurrentStock: Number(totalCurrentStock.toFixed(2)),
      totalProjectedStock: Number(totalProjectedStock.toFixed(2)),
      linesWithStockData,
      criticalBelowCount,
      criticalRecoveredCount,
      targetRecoveredCount,
    },
  };
};

const buildBulkTariffBandLabel = (quote) => {
  if (!quote?.appliedBand) return null;
  const min = Number(quote.appliedBand.caseQtyMin || 0) || 0;
  const max = quote.appliedBand.caseQtyMax == null ? null : Number(quote.appliedBand.caseQtyMax || 0) || 0;
  if (!min && max === null) return null;
  return max === null
    ? `${formatNumber(min)}+ koli`
    : `${formatNumber(min)}-${formatNumber(max)} koli`;
};

const allocateGroupShippingFees = (items = [], totalShipping = 0) => {
  const totalCents = Math.max(0, Math.round((Number(totalShipping || 0) || 0) * 100));
  if (!items.length || totalCents <= 0) {
    return items.map(() => 0);
  }

  const lineTotals = items.map((item) => Math.max(0, Math.round((Number(enrichLineWithMetrics(item).lineTotal || 0) || 0) * 100)));
  const basisTotal = lineTotals.reduce((sum, value) => sum + value, 0);

  if (basisTotal <= 0) {
    const baseShare = Math.floor(totalCents / items.length);
    let remainder = totalCents - (baseShare * items.length);
    return items.map(() => {
      const nextValue = baseShare + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      return Number((nextValue / 100).toFixed(2));
    });
  }

  const rawShares = lineTotals.map((value) => (value / basisTotal) * totalCents);
  const baseShares = rawShares.map((value) => Math.floor(value));
  let remainder = totalCents - baseShares.reduce((sum, value) => sum + value, 0);
  const remainders = rawShares
    .map((value, index) => ({ index, remainder: value - baseShares[index] }))
    .sort((a, b) => b.remainder - a.remainder);

  for (let index = 0; index < remainders.length && remainder > 0; index += 1) {
    baseShares[remainders[index].index] += 1;
    remainder -= 1;
  }

  return baseShares.map((value) => Number((value / 100).toFixed(2)));
};

const normalizeStorageType = (value) => {
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (!raw) return 'ambient';
  if (raw.includes('frozen') || raw.includes('freezer') || raw.includes('dondur') || raw.includes('donuk')) return 'frozen';
  if (raw.includes('cold') || raw.includes('soğuk') || raw.includes('soguk')) return 'cold';
  return 'ambient';
};

const isCargoTypeCompatible = (cargoTypeCode, storageType) => {
  if (!cargoTypeCode) return true;
  if (storageType === 'frozen') return ['cold_chain', 'frozen_chain'].includes(cargoTypeCode);
  if (storageType === 'cold') return ['cold_chain', 'frozen_chain'].includes(cargoTypeCode);
  return ['standard_intercity', 'express_next_day', 'store_transfer', 'cold_chain', 'frozen_chain'].includes(cargoTypeCode);
};

const MULTI_SUPPLIER_PATTERN = [2, 3, 4, 5, 3, 2];

const PRODUCT_CATEGORY_GROUPS = {
  'cat-001': 'fresh',
  'cat-002': 'meat',
  'cat-003': 'dairy',
  'cat-004': 'grocery',
  'cat-005': 'beverage',
  'cat-006': 'snack',
  'cat-009': 'frozen',
  'cat-010': 'cleaning',
  'cat-011': 'personal-care',
  'cat-012': 'paper',
  'cat-013': 'baby',
  'cat-014': 'home',
};

const CATEGORY_LABELS = {
  'cat-001': 'Meyve, Sebze',
  'cat-002': 'Et, Tavuk, Balık',
  'cat-003': 'Süt, Kahvaltılık',
  'cat-004': 'Temel Gıda',
  'cat-005': 'İçecek',
  'cat-006': 'Atıştırmalık',
  'cat-007': 'Dondurma',
  'cat-008': 'Fırın, Pastane',
  'cat-009': 'Hazır Yemek, Donuk',
  'cat-010': 'Deterjan, Temizlik',
  'cat-011': 'Kişisel Bakım, Kozmetik, Sağlık',
  'cat-012': 'Kağıt, Islak Mendil',
  'cat-013': 'Bebek',
  'cat-014': 'Ev, Yaşam',
  'cat-015': 'Hobi, Oyuncak, Kırtasiye',
  'cat-016': 'Evcil Hayvan',
  'cat-017': 'Elektronik',
};

const BULK_CATEGORY_VAT_RATE_BY_ID = {
  'cat-001': 1,
  'cat-002': 1,
  'cat-003': 1,
  'cat-004': 10,
  'cat-005': 10,
  'cat-006': 10,
  'cat-007': 10,
  'cat-008': 10,
  'cat-009': 10,
  'cat-010': 20,
  'cat-011': 20,
  'cat-012': 20,
  'cat-013': 10,
  'cat-014': 20,
  'cat-015': 20,
  'cat-016': 20,
  'cat-017': 20,
};

const BULK_CATEGORY_VAT_RATE_KEYWORDS = [
  { keywords: ['meyve', 'sebze', 'et', 'tavuk', 'balık', 'balik', 'süt', 'sut', 'kahvaltı', 'kahvalti'], rate: 1 },
  { keywords: ['temel gıda', 'temel gida', 'içecek', 'icecek', 'atıştırmalık', 'atistirmalik', 'dondurma', 'donuk', 'fırın', 'firin', 'pastane', 'bebek', 'sağlık', 'saglik'], rate: 10 },
  { keywords: ['deterjan', 'temizlik', 'kişisel', 'kisisel', 'kozmetik', 'kağıt', 'kagit', 'ıslak mendil', 'ev', 'yaşam', 'yasam', 'hobi', 'oyuncak', 'kırtasiye', 'kirtasiye', 'evcil', 'elektronik'], rate: 20 },
];

const normalizeCategoryKey = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const normalizeCatalogCategoryLabel = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const lowered = text.toLocaleLowerCase('tr-TR');
  if (lowered === 'diğer' || lowered === 'diger' || lowered === 'kategori yok' || lowered === '-') return '';
  return text;
};

const resolveCatalogCategoryMeta = (product = {}, fallback = {}) => {
  const productCategoryId = String(product?.categoryId || fallback?.categoryId || '').trim();
  const productCategoryName = normalizeCatalogCategoryLabel(product?.categoryName);
  const fallbackLabel = normalizeCatalogCategoryLabel(fallback?.categoryLabel);
  const mappedLabel = normalizeCatalogCategoryLabel(CATEGORY_LABELS[productCategoryId]);
  const label = productCategoryName || fallbackLabel || mappedLabel || 'Diğer';
  return {
    categoryId: productCategoryId,
    categoryLabel: label,
  };
};

const resolveVatRateForCategory = ({ categoryId = '', categoryLabel = '' } = {}) => {
  if (categoryId && Object.prototype.hasOwnProperty.call(BULK_CATEGORY_VAT_RATE_BY_ID, categoryId)) {
    return BULK_CATEGORY_VAT_RATE_BY_ID[categoryId];
  }

  const normalizedLabel = normalizeCategoryKey(categoryLabel);
  if (!normalizedLabel) return 20;

  for (let i = 0; i < BULK_CATEGORY_VAT_RATE_KEYWORDS.length; i += 1) {
    const rule = BULK_CATEGORY_VAT_RATE_KEYWORDS[i];
    if (rule.keywords.some((keyword) => normalizedLabel.includes(keyword))) {
      return rule.rate;
    }
  }

  return 20;
};

const REPORT_TABLE_STANDARD = {
  headerFillColor: [236, 243, 255],
  headerTextColor: [17, 24, 39],
  borderColor: [220, 229, 240],
  zebraFillColor: [248, 250, 252],
};

const PDF_FONT_FAMILY = 'Roboto';

let catalogPdfModulesPromise = null;

const loadCatalogPdfModules = async () => {
  if (!catalogPdfModulesPromise) {
    catalogPdfModulesPromise = Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
      import('pdfmake/build/vfs_fonts'),
    ]).then(([jsPdfModule, autoTableModule, pdfFontsModule]) => ({
      jsPDF: jsPdfModule?.jsPDF || jsPdfModule?.default?.jsPDF || jsPdfModule?.default || jsPdfModule,
      autoTable: autoTableModule?.default || autoTableModule?.autoTable || autoTableModule,
      pdfFonts: pdfFontsModule?.default || pdfFontsModule,
    }));
  }
  return catalogPdfModulesPromise;
};

const getPdfVfs = (pdfFonts) => {
  const nestedVfs = pdfFonts?.pdfMake?.vfs || pdfFonts?.vfs || pdfFonts?.default?.pdfMake?.vfs || pdfFonts?.default?.vfs;
  if (nestedVfs && Object.keys(nestedVfs).length > 0) {
    return nestedVfs;
  }

  const rawFontMap = pdfFonts && typeof pdfFonts === 'object' ? pdfFonts : {};
  const directFontEntries = Object.entries(rawFontMap).filter(([key, value]) => key.toLowerCase().endsWith('.ttf') && typeof value === 'string');
  return directFontEntries.length ? Object.fromEntries(directFontEntries) : {};
};

const ensureTurkishPdfFont = (doc, pdfFonts) => {
  const fontList = typeof doc.getFontList === 'function' ? doc.getFontList() : {};
  if (fontList?.[PDF_FONT_FAMILY]) {
    return;
  }

  const vfs = getPdfVfs(pdfFonts);
  const regular = vfs['Roboto-Regular.ttf'];
  const bold = vfs['Roboto-Medium.ttf'] || vfs['Roboto-Bold.ttf'];

  if (!regular || typeof doc.addFileToVFS !== 'function' || typeof doc.addFont !== 'function') {
    return;
  }

  doc.addFileToVFS('Roboto-Regular.ttf', regular);
  doc.addFont('Roboto-Regular.ttf', PDF_FONT_FAMILY, 'normal');

  if (bold) {
    doc.addFileToVFS('Roboto-Bold.ttf', bold);
    doc.addFont('Roboto-Bold.ttf', PDF_FONT_FAMILY, 'bold');
  }
};

const formatTierPricingForReport = (tierPricing = []) => {
  if (!Array.isArray(tierPricing) || !tierPricing.length) return '-';

  const rows = tierPricing
    .map((tier) => {
      const qty = Number(tier?.qty || 0);
      const price = Number(tier?.price || 0);

      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
        return null;
      }

      return `${formatNumber(qty)}+ : ${formatCurrency(price, 'TRY')}`;
    })
    .filter(Boolean);

  return rows.length ? rows.join('\n') : '-';
};

const renderStandardPdfTableReport = ({ doc, autoTable, pdfFonts, title, generatedAtLabel, totalRecords, columns, bodyRows, fileName }) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 28;
  const marginY = 24;

  if (typeof doc.setCharSpace === 'function') {
    doc.setCharSpace(0);
  }
  ensureTurkishPdfFont(doc, pdfFonts);
  doc.setFont(PDF_FONT_FAMILY, 'normal');

  autoTable(doc, {
    startY: marginY + 34,
    margin: { top: marginY + 34, right: marginX, bottom: marginY, left: marginX },
    head: [columns.map((col) => col.header)],
    body: bodyRows,
    theme: 'grid',
    tableLineWidth: 0.2,
    tableLineColor: REPORT_TABLE_STANDARD.borderColor,
    headStyles: {
      fillColor: REPORT_TABLE_STANDARD.headerFillColor,
      textColor: REPORT_TABLE_STANDARD.headerTextColor,
      font: PDF_FONT_FAMILY,
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: { top: 8, right: 8, bottom: 8, left: 8 },
      lineColor: REPORT_TABLE_STANDARD.borderColor,
      lineWidth: 0.2,
      valign: 'middle',
    },
    bodyStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: 'normal',
      fontSize: 8.5,
      textColor: [30, 41, 59],
      cellPadding: { top: 7, right: 8, bottom: 7, left: 8 },
      lineColor: REPORT_TABLE_STANDARD.borderColor,
      lineWidth: 0.2,
      valign: 'middle',
      overflow: 'linebreak',
      minCellHeight: 18,
    },
    alternateRowStyles: {
      fillColor: REPORT_TABLE_STANDARD.zebraFillColor,
    },
    columnStyles: columns.reduce((acc, col, index) => {
      acc[index] = {
        cellWidth: col.width,
        halign: col.align || 'left',
      };
      return acc;
    }, {}),
    rowPageBreak: 'avoid',
    styles: {
      lineColor: REPORT_TABLE_STANDARD.borderColor,
      lineWidth: 0.2,
    },
    didDrawPage: (hookData) => {
      const totalPages = doc.internal.getNumberOfPages();
      const pageNumber = hookData.pageNumber;

      doc.setFont(PDF_FONT_FAMILY, 'bold');
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text(title, marginX, marginY);

      doc.setFont(PDF_FONT_FAMILY, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`Toplam kayıt: ${formatNumber(totalRecords)}`, marginX, marginY + 14);
      doc.text(`Rapor tarihi: ${generatedAtLabel}`, marginX + 150, marginY + 14);
      doc.text(`Sayfa ${pageNumber}/${totalPages}`, pageWidth - marginX, marginY + 6, { align: 'right' });
    },
  });

  doc.save(fileName);
};

const getBrandFromProductName = (name) => {
  const source = String(name || '').trim();
  if (!source) return '-';
  const first = source.split(/\s+/)[0] || '-';
  return first.replace(/[^\p{L}\p{N}&.-]/gu, '') || '-';
};

const getMarginRate = (salePrice, purchasePrice) => {
  const sale = Number(salePrice || 0);
  const purchase = Number(purchasePrice || 0);
  if (!Number.isFinite(sale) || !Number.isFinite(purchase) || sale <= 0) {
    return null;
  }
  return ((sale - purchase) / sale) * 100;
};

const getTierPricing = (purchasePrice, minimumOrderQty = 1) => {
  const basePrice = Number(purchasePrice || 0);
  const minQty = Math.max(1, Number(minimumOrderQty || 1));
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return [];
  }

  return [
    { qty: minQty, price: basePrice },
    { qty: minQty * 3, price: Number((basePrice * 0.96).toFixed(2)) },
    { qty: minQty * 6, price: Number((basePrice * 0.92).toFixed(2)) },
  ];
};

const getSupplierScore = ({ purchasePrice, leadTimeDays, deliveryPerformance, productRows = [] }) => {
  const validRows = productRows.filter((item) => Number(item.purchasePrice || 0) > 0);
  const prices = validRows.map((item) => Number(item.purchasePrice || 0));
  const leads = validRows.map((item) => Math.max(1, Number(item.leadTimeDays || 0)));

  const currentPrice = Math.max(0.01, Number(purchasePrice || 0));
  const currentLead = Math.max(1, Number(leadTimeDays || 0));
  const perf = Math.max(0, Math.min(100, Number(deliveryPerformance || 0)));

  const minPrice = prices.length ? Math.min(...prices) : currentPrice;
  const maxPrice = prices.length ? Math.max(...prices) : currentPrice;
  const minLead = leads.length ? Math.min(...leads) : currentLead;
  const maxLead = leads.length ? Math.max(...leads) : currentLead;

  const priceScore = maxPrice > minPrice ?
     100 - (((currentPrice - minPrice) / (maxPrice - minPrice)) * 100)
    : 100;

  const leadScore = maxLead > minLead ?
     100 - (((currentLead - minLead) / (maxLead - minLead)) * 100)
    : 100;

  const score = (priceScore * 0.4) + (leadScore * 0.3) + (perf * 0.3);
  return Math.max(1, Math.min(100, Math.round(score)));
};

const renderColumnLabel = (label, hint) => (
  <span title={hint}>{label}</span>
);

const SUPPLIER_SECTOR_GROUPS = {
  cleaning: ['SUP-019', 'SUP-013', 'SUP-028', 'SUP-032'],
  dairy: ['SUP-001', 'SUP-004', 'SUP-011', 'SUP-022', 'SUP-034', 'SUP-033'],
  beverage: ['SUP-014', 'SUP-021', 'SUP-017', 'SUP-026', 'SUP-002', 'SUP-023'],
  snack: ['SUP-007', 'SUP-027', 'SUP-010', 'SUP-016', 'SUP-009', 'SUP-029'],
  paper: ['SUP-015', 'SUP-031'],
  baby: ['SUP-031', 'SUP-025'],
  grocery: ['SUP-018', 'SUP-020', 'SUP-024', 'SUP-035', 'SUP-008'],
  general: ['SUP-003', 'SUP-006', 'SUP-012', 'SUP-030'],
};

const getProductGroup = (product) => PRODUCT_CATEGORY_GROUPS[product.categoryId] || 'general';

const getSupplierGroup = (supplierId) => {
  const entries = Object.entries(SUPPLIER_SECTOR_GROUPS);
  for (let i = 0; i < entries.length; i += 1) {
    const [group, ids] = entries[i];
    if (ids.includes(supplierId)) return group;
  }
  return 'general';
};

const makeSupplierProductCode = (supplierId, sku, index = 0) => {
  const supplierTail = String(supplierId || '').slice(-4).toUpperCase() || 'SUPP';
  const skuTail = String(sku || '').slice(-4).toUpperCase() || 'PROD';
  return `${supplierTail}-${skuTail}-${String(index + 1).padStart(2, '0')}`;
};

// Sipariş birimi, ambalaj ve fiyat bilgilerini kullanarak tek noktadan hesap yapan yardımcı
// Fonksiyon: toplam adet, min sipariş eşiği, birim fiyat ve toplam tutarı döner.
// Desteklenen birimler: adet, paket, kutu, koli, çuval, kasa, palet
const computeOrderMetrics = ({
  quantity,
  unit,
  item,
}) => {
  const qty = Number(quantity || 0);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { isValid: false, reason: 'quantity', message: 'Sipariş miktarı pozitif olmalıdır.' };
  }

  const unitsPerPack = Number(item.unitsPerPack || 1);
  const unitsPerBox = Number(item.unitsPerBox || item.unitsPerCase || 1);
  const unitsPerCase = Number(item.unitsPerCase || 1);
  const casesPerPallet = Number(item.casesPerPallet || 1);
  const unitsPerPallet = Number(item.unitsPerPallet || unitsPerCase * casesPerPallet || 1);

  if (unitsPerCase > 1 && unitsPerPallet > 1 && unitsPerPallet < unitsPerCase) {
    return {
      isValid: false,
      reason: 'packaging',
      message: 'Palet ve koli dönüşümleri tutarsız. Ürün ambalaj bilgisini kontrol edin.',
    };
  }

  const priceUnit = normalizeOrderUnit(item.priceUnit || 'adet') || 'adet';
  const minOrderUnit = normalizeOrderUnit(item.minOrderUnit || priceUnit) || priceUnit;
  const selectedUnit = normalizeOrderUnit(unit || priceUnit) || priceUnit;
  const inferredBaseUnit = resolveDisplayBaseUnit(item, priceUnit);

  const toBase = (value, u) => {
    if (u === inferredBaseUnit) return value;
    switch (u) {
      case 'paket':
        return value * unitsPerPack;
      case 'kutu':
        return value * unitsPerBox;
      case 'koli':
        return value * unitsPerCase;
      case 'palet':
        return value * unitsPerPallet;
      case 'kasa':
      case 'çuval':
        return value * unitsPerCase;
      case 'adet':
      default:
        return value;
    }
  };

  const fromBase = (value, u) => {
    if (u === inferredBaseUnit) return value;
    switch (u) {
      case 'paket':
        return value / unitsPerPack;
      case 'kutu':
        return value / unitsPerBox;
      case 'koli':
      case 'kasa':
      case 'çuval':
        return value / unitsPerCase;
      case 'palet':
        return value / unitsPerPallet;
      case 'adet':
      default:
        return value;
    }
  };

  const requiresCaseUnits = ['paket', 'kutu', 'koli', 'kasa', 'çuval'];
  const requiresCase = requiresCaseUnits.includes(priceUnit)
    || requiresCaseUnits.includes(minOrderUnit)
    || requiresCaseUnits.includes(selectedUnit);
  const requiresPallet = priceUnit === 'palet'
    || minOrderUnit === 'palet'
    || selectedUnit === 'palet';

  if (requiresCase && unitsPerCase <= 1) {
    return {
      isValid: false,
      reason: 'packaging',
      message: 'Bu ürün için koli/kasa bilgisi tanımlı değil. Lütfen ürün ambalaj ayarlarını kontrol edin.',
    };
  }
  if (requiresPallet && unitsPerPallet <= 1) {
    return {
      isValid: false,
      reason: 'packaging',
      message: 'Bu ürün için palet bilgisi tanımlı değil. Lütfen ürün ambalaj ayarlarını kontrol edin.',
    };
  }

  const minQty = Number(item.minimumOrderQty || 1);
  const minBase = toBase(minQty, minOrderUnit);
  const baseQty = toBase(qty, selectedUnit);

  // Kritik kural: alış fiyatı her zaman ürünün baz birim fiyatıdır.
  const rawPrice = Number(item.purchasePrice || 0);
  const pricePerBase = rawPrice / Math.max(1, toBase(1, priceUnit));

  if (!Number.isFinite(pricePerBase) || pricePerBase <= 0) {
    return {
      isValid: false,
      reason: 'price',
      message: 'Fiyat bilgisi geçersiz. Lütfen tedarikçi kayıtlarını kontrol edin.',
    };
  }

  const total = baseQty * pricePerBase;
  const passesMin = baseQty >= minBase;

  const caseQty = unitsPerCase > 0 ? baseQty / unitsPerCase : 0;
  const paletteQty = unitsPerPallet > 0 ? baseQty / unitsPerPallet : 0;

  const baseUnitPrice = Number(pricePerBase || 0);
  const tierCandidates = [
    {
      id: 'base',
      minCaseQty: 0,
      unitPriceBase: baseUnitPrice,
      label: 'Baz fiyat',
    },
    {
      id: 'moq',
      minCaseQty: Math.max(0, Number(minBase / Math.max(1, unitsPerCase))),
      unitPriceBase: baseUnitPrice,
      label: 'MOQ fiyatı',
    },
    {
      id: 'case_10',
      minCaseQty: 10,
      unitPriceBase: Number(item.tierPrice10Case || 0) > 0 ? Number(item.tierPrice10Case || 0) / Math.max(1, unitsPerCase) : null,
      label: '10 koli fiyatı',
    },
    {
      id: 'case_20',
      minCaseQty: 20,
      unitPriceBase: Number(item.tierPrice20Case || 0) > 0 ? Number(item.tierPrice20Case || 0) / Math.max(1, unitsPerCase) : null,
      label: '20 koli fiyatı',
    },
    {
      id: 'case_3',
      minCaseQty: 3,
      unitPriceBase: Number(item.tierPrice3Case || 0) > 0 ? Number(item.tierPrice3Case || 0) / Math.max(1, unitsPerCase) : null,
      label: '3 koli fiyatı',
    },
  ].filter((tier) => Number.isFinite(tier.unitPriceBase) && Number(tier.unitPriceBase) > 0);

  const applicable = tierCandidates
    .filter((tier) => caseQty >= tier.minCaseQty)
    .sort((a, b) => b.minCaseQty - a.minCaseQty)[0] || tierCandidates[0];

  const effectiveUnitPriceBase = Number(applicable?.unitPriceBase || baseUnitPrice || 0);
  const discountedTotal = Number((baseQty * effectiveUnitPriceBase).toFixed(2));
  const discountAmount = Math.max(0, Number((total - discountedTotal).toFixed(2)));
  const discountRate = total > 0 ? Number(((discountAmount / total) * 100).toFixed(2)) : 0;

  return {
    isValid: passesMin,
    reason: passesMin ? null : 'min',
    message: passesMin ?
       null
      : `Bu tedarikçi için minimum sipariş ${minQty} ${minOrderUnit} karşılışıdır.`,
    quantityBase: baseQty,
    minBase,
    minQty,
    minUnit: minOrderUnit,
    unitPriceBase: pricePerBase,
    totalPrice: total,
    totalPriceWithTier: discountedTotal,
    discountAmount,
    discountRate,
    appliedTier: applicable?.id || 'base',
    appliedTierId: applicable?.id || 'base',
    appliedTierLabel: applicable?.label || 'Baz fiyat',
    appliedTierMinCaseQty: Number(applicable?.minCaseQty || 0),
    caseQty,
    paletteQty,
    convertedSelectedQty: fromBase(baseQty, selectedUnit),
    tierCandidates,
    selectedUnit,
    priceUnit,
    baseUnit: inferredBaseUnit || 'adet',
    selectedQty: qty,
  };
};

const enrichLineWithMetrics = (line) => {
  const metrics = computeOrderMetrics({
    quantity: Number(line?.quantity || 0),
    unit: line?.unit || 'adet',
    item: line || {},
  });

  if (!metrics || !metrics.isValid && metrics.reason !== 'min') {
    return {
      ...line,
      quantityBase: Number(line?.quantityBase || 0),
      baseUnit: line?.baseUnit || 'adet',
      unitPriceBase: Number(line?.unitPriceBase || line?.unitPrice || 0),
      lineTotal: Number(line?.lineTotal || (Number(line?.unitPrice || 0) * Number(line?.quantity || 0))),
    };
  }

  return {
    ...line,
    quantityBase: Number(metrics.quantityBase || 0),
    baseUnit: metrics.baseUnit || 'adet',
    unitPriceBase: Number(metrics.unitPriceBase || 0),
    lineTotal: Number(metrics.totalPriceWithTier || metrics.totalPrice || 0),
  };
};

const getResolvedLineBaseQuantity = (line = {}) => {
  const explicitBaseQuantity = Number(line?.quantityBase);
  if (Number.isFinite(explicitBaseQuantity) && explicitBaseQuantity > 0) return explicitBaseQuantity;
  const metrics = computeOrderMetrics({
    quantity: Number(line?.quantity || 0),
    unit: line?.unit || 'adet',
    item: line || {},
  });
  const computedBaseQuantity = Number(metrics?.quantityBase || 0);
  if (Number.isFinite(computedBaseQuantity) && computedBaseQuantity > 0) return computedBaseQuantity;
  return Number(line?.quantity || 0);
};

const getUnitBaseMultiplier = (line = {}, unit = 'adet') => {
  const normalizedUnit = normalizeOrderUnit(unit || 'adet') || 'adet';
  const unitsPerPack = Math.max(1, Number(line.unitsPerPack || 1) || 1);
  const unitsPerBox = Math.max(1, Number(line.unitsPerBox || line.unitsPerCase || 1) || 1);
  const unitsPerCase = Math.max(1, Number(line.unitsPerCase || 1) || 1);
  const casesPerPallet = Math.max(1, Number(line.casesPerPallet || 1) || 1);
  const unitsPerPallet = Math.max(1, Number(line.unitsPerPallet || unitsPerCase * casesPerPallet || 1) || 1);

  switch (normalizedUnit) {
    case 'paket':
      return unitsPerPack;
    case 'kutu':
      return unitsPerBox;
    case 'koli':
    case 'kasa':
    case 'çuval':
      return unitsPerCase;
    case 'palet':
      return unitsPerPallet;
    case 'adet':
    default:
      return 1;
  }
};

const getBulkLineEditableUnits = (line = {}) => {
  const unitsPerCase = Math.max(1, Number(line.unitsPerCase || 1) || 1);
  const casesPerPallet = Math.max(1, Number(line.casesPerPallet || 1) || 1);
  const unitsPerPallet = Math.max(1, Number(line.unitsPerPallet || unitsPerCase * casesPerPallet || 1) || 1);
  const hasRealCase = unitsPerCase > 1;
  const hasRealPallet = hasRealCase && casesPerPallet > 1 && unitsPerPallet > unitsPerCase;
  const configured = getAllowedProcurementUnits(line);
  const candidates = [
    line.unit,
    'adet',
    hasRealCase ? 'koli' : null,
    ...configured,
    hasRealPallet ? 'palet' : null,
  ].filter(Boolean);

  return dedupeOrderUnits(candidates)
    .map((unit) => normalizeOrderUnit(unit))
    .filter((unit) => {
      if (!unit || !PROCUREMENT_ORDER_UNITS.includes(unit)) return false;
      if (unit === 'palet') return hasRealPallet;
      if (['koli', 'kasa', 'çuval'].includes(unit)) return hasRealCase;
      return true;
    });
};

const getBulkLineMinQuantity = (line = {}, unit = line.unit || 'adet') => {
  const metrics = computeOrderMetrics({
    quantity: 1,
    unit: unit || 'adet',
    item: line,
  });
  const minBase = Math.max(1, Number(metrics?.minBase || line.minimumOrderQty || 1) || 1);
  const multiplier = Math.max(1, getUnitBaseMultiplier(line, unit));
  return Math.max(1, Math.ceil(minBase / multiplier));
};

const getAllowedProcurementUnits = (item) => {
  const configured = Array.isArray(item?.orderableUnits) ?
     item.orderableUnits
    : [];

  const mappingUnits = [
    item?.defaultOrderUnit,
    item?.minOrderUnit,
    item?.priceUnit,
    item?.orderUnit,
    item?.productUnit,
  ];

  const normalized = dedupeOrderUnits([...configured, ...mappingUnits])
    .map((u) => normalizeOrderUnit(u))
    .filter((u) => PROCUREMENT_ORDER_UNITS.includes(u));

  if (normalized.length) {
    return normalized;
  }

  return ['adet'];
};

const normalizeSupplierProduct = (item, productMap, index = 0, source = 'api') => {
  const product = productMap.get(item.productId);
  const supplierProductId = String(item.id || item.supplierProductId || item.supplierProductMappingId || '').trim();

  const orderUnit = (item.orderUnit || product?.orderUnit || 'adet');
  const unitsPerPack = Number(item.unitsPerPack || product?.unitsPerPack || 1);
  const unitsPerBox = Number(item.unitsPerBox || product?.unitsPerBox || product?.unitsPerCase || 1);
  const unitsPerCase = Number(item.unitsPerCase || product?.unitsPerCase || 1);
  const casesPerPallet = Number(item.casesPerPallet || product?.casesPerPallet || 1);
  const unitsPerPallet = Number(
    item.unitsPerPallet
      || product?.unitsPerPallet
      || unitsPerCase * casesPerPallet
  );
  const priceUnit = (item.priceUnit || 'adet');
  const minOrderUnit = (item.minOrderUnit || priceUnit);

  const orderableUnits = Array.isArray(item.orderableUnits) && item.orderableUnits.length ?
     item.orderableUnits
    : [item.defaultOrderUnit, item.minOrderUnit, item.priceUnit, product?.defaultOrderUnit, product?.orderUnit, product?.unit].filter(Boolean);

  const defaultOrderUnit = (item.defaultOrderUnit
    || product?.defaultOrderUnit
    || priceUnit
    || orderUnit
    || 'adet');

  return {
    id: supplierProductId,
    supplierProductId,
    source,
    productId: item.productId,
    productName: item.productName || product?.name || '-',
    productSku: item.productSku || product?.sku || '-',
    barcode: item.barcode || product?.barcode || '-',
    supplierId: item.supplierId,
    supplierName: item.supplierName || '-',
    supplierProductName: item.supplierProductName || '-',
    supplierSku: item.supplierSku || item.supplierProductSku || '-',
    supplierProductCode: item.supplierProductCode || makeSupplierProductCode(item.supplierId, item.productSku || product?.sku, index),
    ...resolveCatalogCategoryMeta(product),
    note: item.note || '',
    purchasePrice: Number(item.purchasePrice || 0),
    currency: item.currency || 'TRY',
    minimumOrderQty: Number(item.minimumOrderQty || 1),
    // Teslim süresi: 1-3 gün aralışına sıkıştır
    leadTimeDays: (() => {
      const raw = Number(item.leadTimeDays || 3);
      if (!Number.isFinite(raw) || raw <= 0) return 3;
      if (raw > 3) return 3;
      return raw;
    })(),
    isPreferred: Boolean(item.isPreferred || item.isDefault),
    isActive: item.isActive !== false,
    isListed: product?.isListed !== false,
    productBadge: (product?.isListed === false ? (product?.adminBadge || 'Öneri') : (product?.adminBadge || '')),
    lastPriceUpdate: item.lastPriceUpdate || item.updatedAt || item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.lastPriceUpdate || item.createdAt || new Date().toISOString(),
    // Ambalaj / birim bilgileri
    productUnit: product?.unit || '',
    orderUnit,
    unitsPerPack,
    unitsPerBox,
    unitsPerCase,
    casesPerPallet,
    unitsPerPallet,
    priceUnit,
    minOrderUnit,
    orderableUnits: dedupeOrderUnits(orderableUnits),
    defaultOrderUnit,
    defaultCargoTypeCode: item.defaultCargoTypeCode || '',
    supplierLogisticsNote: item.supplierLogisticsNote || '',
  };
};

const syncPreferredByProduct = (rows) => {
  const grouped = rows.reduce((acc, row) => {
    if (!acc[row.productId]) acc[row.productId] = [];
    acc[row.productId].push(row);
    return acc;
  }, {});

  return rows.map((row) => {
    const group = grouped[row.productId] || [];
    const preferredRows = group.filter((item) => item.isPreferred);
    if (preferredRows.length <= 1) {
      return row;
    }
    const chosen = preferredRows.sort((a, b) => a.purchasePrice - b.purchasePrice)[0];
    return { ...row, isPreferred: row.id === chosen.id };
  });
};

const buildDemoRows = (products, suppliers, existingRows = []) => {
  if (!products.length || !suppliers.length) {
    return [];
  }

  const usedPairs = new Set(existingRows.map((row) => `${row.productId}-${row.supplierId}`));
  const productMap = new Map(products.map((item) => [item.id, item]));
  const existingByProduct = existingRows.reduce((acc, row) => {
    if (!acc[row.productId]) acc[row.productId] = [];
    acc[row.productId].push(row);
    return acc;
  }, {});

  const rows = [];
  let globalIndex = 0;

  const getSupplierCandidatesForProduct = (product) => {
    const group = getProductGroup(product);
    const specificIds = SUPPLIER_SECTOR_GROUPS[group] || [];
    let candidateList = suppliers.filter((supplier) => (!specificIds.length ? true : specificIds.includes(supplier.id)) && supplier.isActive !== false);

    if (!candidateList.length && group !== 'general') {
      const generalIds = SUPPLIER_SECTOR_GROUPS.general || [];
      candidateList = suppliers.filter((supplier) => (!generalIds.length ? true : generalIds.includes(supplier.id)) && supplier.isActive !== false);
    }

    return candidateList.length ? candidateList : suppliers;
  };

  products.forEach((product, productIndex) => {
    const existingForProduct = existingByProduct[product.id] || [];
    const baseDesired = MULTI_SUPPLIER_PATTERN[productIndex % MULTI_SUPPLIER_PATTERN.length];
    const desiredTotal = Math.min(5, Math.max(2, baseDesired));
    const needed = Math.max(desiredTotal - existingForProduct.length, 0);
    if (!needed) return;

    const candidates = getSupplierCandidatesForProduct(product);
    const available = candidates.filter((supplier) => !usedPairs.has(`${product.id}-${supplier.id}`));
    if (!available.length) return;

    for (let i = 0; i < needed && i < available.length; i += 1) {
      const supplier = available[i];
      const key = `${product.id}-${supplier.id}`;
      if (usedPairs.has(key)) continue;

      const base = Number(product.purchasePrice || product.salePrice || 10);
      const spread = 1 + ((globalIndex % 7) - 3) * 0.02;
      const unitPrice = Number((base * spread).toFixed(2));
      const now = new Date();
      now.setDate(now.getDate() - (globalIndex % 28));

      rows.push(
        normalizeSupplierProduct(
          {
            id: `demo-sp-${globalIndex + 1}`,
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            barcode: product.barcode,
            supplierId: supplier.id,
            supplierName: supplier.name,
            supplierProductCode: makeSupplierProductCode(supplier.id, product.sku, i),
            purchasePrice: unitPrice,
            currency: 'TRY',
            minimumOrderQty: 1 + (globalIndex % 4) * 2,
            // Demo veriler için teslim süresini 1-3 gün aralışında tut
            leadTimeDays: 1 + (globalIndex % 3),
            isPreferred: false,
            isActive: globalIndex % 9 !== 0,
            lastPriceUpdate: now.toISOString(),
            updatedAt: now.toISOString(),
          },
          productMap,
          globalIndex,
          'demo'
        )
      );

      usedPairs.add(key);
      globalIndex += 1;
    }
  });

  const grouped = rows.reduce((acc, row) => {
    if (!acc[row.productId]) acc[row.productId] = [];
    acc[row.productId].push(row);
    return acc;
  }, {});

  Object.values(grouped).forEach((group) => {
    const activeGroup = group.filter((item) => item.isActive);
    const winnerBase = activeGroup.length ? activeGroup : group;
    const winner = winnerBase.sort((a, b) => a.purchasePrice - b.purchasePrice)[0];
    group.forEach((item) => {
      item.isPreferred = item.id === winner.id;
    });
  });

  return rows;
};

const ORDER_FORM_DEFAULTS = {
  quantity: '1',
  unit: 'adet',
  deliveryLocation: 'store',
  // Varsayılan teslim tarihi, ürünün temin süresine göre tahmini hesaplanır.
  deliveryDateMode: 'estimated',
  deliveryDate: '',
  deliveryType: 'standard',
  serviceLevel: 'standard',
  shippingCarrier: 'standard_intercity',
  vatRate: '20',
  shippingFee: '',
  manualLogisticsOverrideTl: '',
  originDestination: 'Merkez Depo - İzmir',
  arrivalDestination: 'SHF-001',
  orderType: 'normal',
  logisticsType: 'supplier_delivery',
  orderReason: 'critical_restock',
  demandSource: 'warehouse',
  demandLevel: 'medium',
  orderReference: '',
  noteTab: 'operational',
  operationalNote: '',
  supplierNote: '',
  procurementNote: '',
  approvalMode: 'draft',
};

const ORDER_REASON_OPTIONS = [
  { value: 'critical_restock', label: 'Stok tamamlama' },
  { value: 'campaign_preparation', label: 'Kampanya hazırlığı' },
  { value: 'seasonal_demand', label: 'Sezonluk talep' },
  { value: 'new_product_trial', label: 'Yeni ürün deneme' },
];

const DEMAND_SOURCE_OPTIONS = [
  { value: 'warehouse', label: 'Depo' },
  { value: 'shelf', label: 'Reyon' },
  { value: 'central_planning', label: 'Merkezi planlama' },
  { value: 'manual', label: 'Manuel' },
];

const DEMAND_LEVEL_OPTIONS = [
  { value: 'low', label: 'Düşük' },
  { value: 'medium', label: 'Orta' },
  { value: 'high', label: 'Yüksek' },
];

const DELIVERY_TYPE_CARRIER_RULES = {
  standard: ['standard_intercity', 'express_next_day', 'cold_chain', 'frozen_chain'],
  express: ['express_next_day', 'cold_chain', 'frozen_chain'],
  pickup: ['store_transfer'],
};

const CATALOG_CART_ORDER_DEFAULTS = {
  deliveryLocation: 'store',
  deliveryType: '',
  shippingCarrier: '',
  shippingFee: '',
  originDestination: '',
  arrivalDestination: '',
  orderType: 'catalog_cart',
  orderReference: '',
  approvalMode: 'awaiting_approval',
  note: '',
};

const SUPPLIER_GROUP_ORDER_DEFAULTS = {
  deliveryLocation: 'store',
  deliveryDateMode: 'estimated',
  deliveryType: 'standard',
  logisticsType: 'supplier_delivery',
  shippingCarrier: 'standard_intercity',
  shippingFee: '0',
  extraServiceFee: '0',
  orderReason: 'critical_restock',
  originDestination: 'Merkez Depo - İzmir',
  arrivalDestination: '',
  supplierDispatchDate: '',
  deliveryDate: '',
  orderReference: '',
  operationalNote: '',
  supplierNote: '',
  note: '',
};

const toNumeric = (value) => {
  const numeric = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : 0;
};

const buildSupplierGroupDraft = ({ deliveryLocationLabel, supplierCode }) => ({
  ...SUPPLIER_GROUP_ORDER_DEFAULTS,
  arrivalDestination: deliveryLocationLabel || 'Mağaza',
  orderReference: `${String(supplierCode || 'SUP').toUpperCase()}-${new Date().getFullYear()}`,
});

const computeSupplierGroupSummary = ({ items = [], form = {}, resolveVatRate = () => 20 }) => {
  const subtotal = items.reduce((sum, item) => {
    const metrics = enrichLineWithMetrics(item);
    return sum + Number(metrics.lineTotal || 0);
  }, 0);

  const vatAmount = items.reduce((sum, item) => {
    const metrics = enrichLineWithMetrics(item);
    const lineSubtotal = Number(metrics.lineTotal || 0);
    const lineVatRate = Math.max(0, Number(resolveVatRate({
      categoryId: item.productCategoryId,
      categoryLabel: item.categoryLabel,
    }) || 0));
    return sum + (lineSubtotal * (lineVatRate / 100));
  }, 0);

  const vatRate = subtotal > 0 ? Number(((vatAmount / subtotal) * 100).toFixed(2)) : 0;
  const shippingFee = Math.max(0, toNumeric(form.shippingFee));
  const extraServiceFee = Math.max(0, toNumeric(form.extraServiceFee));
  const grandTotal = subtotal + vatAmount + shippingFee + extraServiceFee;

  return {
    subtotal,
    vatRate,
    vatAmount,
    shippingFee,
    extraServiceFee,
    grandTotal,
  };
};

const BULK_QUICK_FORM_DEFAULTS = {
  orderReason: 'critical_restock',
  deliveryType: 'standard',
  serviceLevel: 'standard',
  shippingCarrier: 'standard_intercity',
  shippingFee: '',
  originDestination: '',
  arrivalDestination: '',
  supplierDispatchDate: '',
  deliveryDateMode: 'estimated',
  deliveryDate: '',
  operationalNote: '',
  supplierNote: '',
};

function QuantityStepper({ value, min = 1, disabled, onChange, onAdjust }) {
  return (
    <div className="proc-catalog-stepper">
      <button
        type="button"
        className="proc-catalog-stepper-btn"
        onClick={() => onAdjust(-1)}
        disabled={disabled}
        aria-label="Miktarı azalt"
      >
        <Minus size={12} />
      </button>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <button
        type="button"
        className="proc-catalog-stepper-btn"
        onClick={() => onAdjust(1)}
        disabled={disabled}
        aria-label="Miktarı artır"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

function SupplierCatalogEmptyState({ icon, title, description, action }) {
  return (
    <div className="proc-catalog-empty">
      <div className="proc-catalog-empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action || null}
    </div>
  );
}

function SupplierCatalogFilters({
  catalogCategoryId,
  setCatalogCategoryId,
  catalogCategoryOptions,
  catalogFilters,
  setCatalogFilters,
  catalogSort,
  setCatalogSort,
  onReset,
  activeFilterCount,
  disabled = false,
  compact = false,
}) {
  const filterWrapperClass = compact ?
     'proc-catalog-filters proc-catalog-filters-inline'
    : 'proc-catalog-filters mod-card';

  return (
    <div className={filterWrapperClass}>
      {!compact ? (
        <div className="proc-catalog-filters-head">
          <h4><Filter size={14} /> Filtreler</h4>
        </div>
      ) : null}

      {!disabled ? (
        <div className="proc-catalog-filter-row">
          <div className="proc-catalog-filter-scroll">
            <label className="field-group compact proc-catalog-field-category">
              <span>Kategori</span>
              <select
                value={catalogCategoryId}
                onChange={(event) => setCatalogCategoryId(event.target.value)}
              >
                {catalogCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="field-group compact proc-catalog-field-price">
              <span>Fiyat Min</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Min"
                value={catalogFilters.priceMin}
                onChange={(event) => {
                  const value = normalizeMoneyInput(event.target.value);
                  setCatalogFilters((current) => ({ ...current, priceMin: value }));
                }}
              />
            </label>

            <label className="field-group compact proc-catalog-field-price">
              <span>Fiyat Max</span>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Max"
                value={catalogFilters.priceMax}
                onChange={(event) => {
                  const value = normalizeMoneyInput(event.target.value);
                  setCatalogFilters((current) => ({ ...current, priceMax: value }));
                }}
              />
            </label>

            <label className="field-group compact proc-catalog-field-sort">
              <span>Sıralama</span>
              <select
                value={catalogSort}
                onChange={(event) => setCatalogSort(event.target.value)}
              >
                <option value="priceAsc">Fiyat (Artan)</option>
                <option value="priceDesc">Fiyat (Azalan)</option>
                <option value="leadTimeAsc">Temin (Hızlı)</option>
                <option value="leadTimeDesc">Temin (Yavaş)</option>
                <option value="nameAsc">Ürün Adı (A-Z)</option>
                <option value="discountDesc">İndirim Öncelikli</option>
              </select>
            </label>

            <div className="proc-catalog-toggle-row" role="group" aria-label="Hızlı filtreler">
              {[
                ['inStockOnly', 'Stokta Olanlar'],
                ['discountOnly', 'Kampanyalı'],
                ['quickDeliveryOnly', 'Hızlı Teslim'],
                ['bestPriceOnly', 'En Uygun'],
                ['highScoreOnly', 'Yüksek Puan'],
              ].map(([key, label]) => {
                const isActive = Boolean(catalogFilters[key]);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`proc-catalog-toggle-pill ${isActive ? 'is-active' : ''}`}
                    onClick={() => {
                      setCatalogFilters((current) => ({
                        ...current,
                        [key]: !current[key],
                      }));
                    }}
                  >
                    <span className="proc-catalog-toggle-pill-mark">{isActive ? '✓' : ''}</span>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            className="ghost-button proc-catalog-filter-clear"
            disabled={activeFilterCount === 0}
            onClick={onReset}
          >
            Filtreleri Temizle
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SupplierProductCard({ row, isSelected, isInCart, qty, disabled, onSelect, onAdjustQty, onQtyChange, onAdd, onInfo, getMinQty }) {
  return (
    <div
      className={`proc-catalog-card ${isSelected ? 'is-selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="proc-catalog-card-top">
        <div className="proc-catalog-card-title-block">
          <h4 title={row.productName}>{row.productName}</h4>
          <p>SKU: {row.productSku}</p>
          <p>Barkod: {row.barcode || '-'}</p>
        </div>
        <div className="proc-catalog-card-badges">
          <button
            type="button"
            className="proc-catalog-info-button"
            aria-label={`${row.productName} bilgi`}
            title="Ürün bilgi panelini aç"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onInfo(row);
            }}
          >
            <Info size={16} />
          </button>
          {row.catalogIsBestPrice ? <span className="proc-catalog-badge outline-success">En uygun</span> : null}
          {row.catalogHasDiscount ? <span className="proc-catalog-badge warning">Kampanya</span> : null}
          <span className={`proc-catalog-badge ${Number(row.leadTimeDays || 0) <= 3 ? 'info' : 'soft'}`}>{formatNumber(row.leadTimeDays || 0)} gün</span>
        </div>
      </div>

      <div className="proc-catalog-card-metrics">
        <div><span>MOQ</span><strong>{row.catalogMinOrderLabel}</strong></div>
        <div><span>Kategori</span><strong>{row.catalogCategoryLabel || '-'}</strong></div>
        <div><span>Birim fiyat</span><strong>{formatCurrency(row.catalogCurrentPrice, row.currency || 'TRY')} / adet</strong></div>
        <div><span>Stok</span><strong className={row.catalogInStock ? 'ok' : 'danger'}>{row.catalogInStock ? 'Stokta var' : 'Stok yok'}</strong></div>
      </div>

      <div className="proc-catalog-card-actions" onClick={(event) => event.stopPropagation()}>
        <QuantityStepper
          value={qty}
          min={Math.max(1, Number(getMinQty(row) || row.minimumOrderQty || 1))}
          disabled={disabled}
          onAdjust={onAdjustQty}
          onChange={onQtyChange}
        />
        <button type="button" className="primary-button primary-button-compact" disabled={disabled} onClick={onAdd}>
          <span>{isInCart ? 'Güncelle' : 'Sepete Ekle'}</span>
        </button>
      </div>
    </div>
  );
}

function SupplierProductGrid({ isLoading, rows, pageRows, focusedId, cart, resolveQty, getMinQty, canOrder, onSelect, onAdjustQty, onQtyChange, onAdd, onInfo, onResetFilters }) {
  if (isLoading && !rows.length) {
    return (
      <div className="proc-catalog-grid">
        {Array.from({ length: 12 }).map((_, index) => <div key={index} className="proc-catalog-card skeleton" />)}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <SupplierCatalogEmptyState
        icon={<Package size={28} />}
        title="Tedarikçi için katalog bulunamadı"
        description="Bu tedarikçiye bağlı aktif ürün eşleşmesi görünmüyor."
      />
    );
  }

  if (!pageRows.length) {
    return (
      <SupplierCatalogEmptyState
        icon={<Boxes size={28} />}
        title="Filtre sonucu boş"
        description="Filtreleri yumuşatıp yeniden deneyin."
        action={<button type="button" className="ghost-button" onClick={onResetFilters}>Filtreleri sıfırla</button>}
      />
    );
  }

  return (
    <div className="proc-catalog-grid">
      {pageRows.map((row) => {
        const disabled = !canOrder || !row.isActive || row.source !== 'api';
        return (
          <SupplierProductCard
            key={row.id}
            row={row}
            isSelected={focusedId === row.id}
            isInCart={cart.some((item) => item.id === row.id)}
            qty={resolveQty(row)}
            disabled={disabled}
            onSelect={() => onSelect(row.id)}
            onAdjustQty={(delta) => onAdjustQty(row, delta)}
            onQtyChange={(value) => onQtyChange(row, value)}
            onAdd={() => onAdd(row)}
            onInfo={onInfo}
            getMinQty={getMinQty}
          />
        );
      })}
    </div>
  );
}

function SupplierSidebar({ supplierName, supplierAverageLeadTime, supplierRating, supplierMinOrderAmount, supplierCatalogRows, supplierCategoryCount, inStockCount, discountCount, supplierCatalogLastUpdate }) {
  return (
    <aside className="proc-catalog-sidebar mod-card">
      <h4>Tedarikçi Özeti</h4>
      <div className="proc-catalog-summary-list">
        <div><span>Tedarikçi</span><strong>{supplierName}</strong></div>
        <div><span>Teslimat süresi</span><strong>{supplierAverageLeadTime ? `${formatNumber(Math.round(supplierAverageLeadTime))} gün` : '-'}</strong></div>
        <div><span>Teslimat performansı</span><strong>{supplierRating ? `${supplierRating.toFixed(1)} / 5` : '-'}</strong></div>
        <div><span>Ürün sayısı</span><strong>{formatNumber(supplierCatalogRows.length)}</strong></div>
        <div><span>Aktif kategori</span><strong>{formatNumber(supplierCategoryCount)}</strong></div>
        <div><span>Minimum sipariş</span><strong>{supplierMinOrderAmount ? formatCurrency(supplierMinOrderAmount, 'TRY') : '-'}</strong></div>
      </div>
      <div className="proc-catalog-summary-chips">
        <span className="proc-catalog-badge success">Stokta: {formatNumber(inStockCount)}</span>
        <span className="proc-catalog-badge warning">Kampanya: {formatNumber(discountCount)}</span>
        <span className="proc-catalog-badge soft">Güncelleme: {supplierCatalogLastUpdate ? formatDate(new Date(supplierCatalogLastUpdate), true) : '-'}</span>
      </div>
    </aside>
  );
}

function SupplierCatalogCartPanel({
  cart,
  cartLineCount,
  cartTotalQuantity,
  cartTotalAmount,
  cartAverageLeadTime,
  handleAdjustCatalogCartQty,
  handleUpdateCatalogCartQty,
  handleRemoveCatalogRow,
  handleClearCatalogCart,
  handleOrderSelectedFromCatalog,
  orderSubmitting,
}) {
  return (
    <aside className="proc-catalog-cart-panel mod-card">
      <div className="proc-catalog-cart-kpis" aria-label="Sepet özeti">
        <div>
          <span>Toplam maliyet</span>
          <strong>{formatCurrency(cartTotalAmount, 'TRY')}</strong>
        </div>
        <div>
          <span>Ortalama teslim süresi</span>
          <strong>{cartAverageLeadTime ? `${formatNumber(Math.round(cartAverageLeadTime))} gün` : '-'}</strong>
        </div>
      </div>

      <section className="proc-catalog-detail-section">
        <h4>Sepet ({formatNumber(cartLineCount)})</h4>
        {cart.length ? (
          <div className="proc-catalog-cart-list">
            {cart.map((item) => (
              <div key={item.id} className="proc-catalog-cart-item">
                <div>
                  <strong>{item.productName}</strong>
                  <span>{formatCurrency(item.unitPriceBase || item.unitPrice, item.currency || 'TRY')} / {String(item.baseUnit || 'adet').toLowerCase()} × {formatNumber(item.quantityBase || 0)} {String(item.baseUnit || 'adet').toLowerCase()}</span>
                  <span>{formatNumber(item.quantity)} {item.unit} (sipariş birimi)</span>
                </div>
                <div className="proc-catalog-cart-actions">
                  <QuantityStepper
                    value={Number(item.quantity || 1)}
                    min={Math.max(1, Number(item.minimumOrderQty || 1))}
                    onAdjust={(delta) => handleAdjustCatalogCartQty(item.id, delta, item.minimumOrderQty || 1)}
                    onChange={(value) => handleUpdateCatalogCartQty(item.id, value, item.minimumOrderQty || 1)}
                  />
                  <button type="button" className="proc-catalog-remove-btn" onClick={() => handleRemoveCatalogRow(item.id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted-text proc-catalog-detail-empty">Sepet boş.</p>
        )}

        <div className="proc-catalog-cart-summary">
          <div><span>Toplam satır</span><strong>{formatNumber(cartLineCount)}</strong></div>
          <div><span>Toplam sipariş miktarı</span><strong>{formatNumber(cartTotalQuantity)}</strong></div>
          <div><span>Tutar</span><strong>{formatCurrency(cartTotalAmount, 'TRY')}</strong></div>
        </div>

        <div className="proc-catalog-cart-buttons">
          <button type="button" className="ghost-button" onClick={handleClearCatalogCart} disabled={!cart.length}>Sepeti Temizle</button>
          <button type="button" className="primary-button proc-catalog-cta-button" onClick={handleOrderSelectedFromCatalog} disabled={orderSubmitting}>
            <Truck size={14} /> {orderSubmitting ? 'Gönderiliyor...' : 'Onaya Gönder'}
          </button>
        </div>
      </section>
    </aside>
  );
}

export default function SupplierProducts({ initialView = 'compare' }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isCatalogPage = initialView === 'catalog';
  const normalizedInitialView = initialView === 'compare' ? 'card' : initialView;
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [viewMode, setViewMode] = useState(normalizedInitialView || 'card');
  const [catalogSupplierId, setCatalogSupplierId] = useState('');
  const [catalogCategoryId, setCatalogCategoryId] = useState('');
  const [catalogSort, setCatalogSort] = useState('priceAsc');
  const [catalogFilters, setCatalogFilters] = useState({
    priceMin: '',
    priceMax: '',
    inStockOnly: false,
    discountOnly: false,
    quickDeliveryOnly: false,
    bestPriceOnly: false,
    highScoreOnly: false,
  });
  const [catalogPageIndex, setCatalogPageIndex] = useState(0);
  const [catalogPageInput, setCatalogPageInput] = useState('1');
  const [catalogCart, setCatalogCart] = useState([]);
  const [catalogDraftQtyById, setCatalogDraftQtyById] = useState({});
  const [catalogFocusedRowId, setCatalogFocusedRowId] = useState('');
  const [catalogInfoTarget, setCatalogInfoTarget] = useState(null);
  const [priceHistory, setPriceHistory] = useState({});
  const [priceHistoryTarget, setPriceHistoryTarget] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [productSearchInput, setProductSearchInput] = useState('');
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [highlightedProductIndex, setHighlightedProductIndex] = useState(-1);
  const [form, setForm] = useState(initialForm);
  const [editingItem, setEditingItem] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [recentProductIds, setRecentProductIds] = useState([]);
  const [orderModalItem, setOrderModalItem] = useState(null);
  const [orderModalContext, setOrderModalContext] = useState({ source: 'compare', cartItemId: null });
  const [orderForm, setOrderForm] = useState(() => ({ ...ORDER_FORM_DEFAULTS }));
  const [orderSubmitMode, setOrderSubmitMode] = useState('approval');
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [catalogPdfExporting, setCatalogPdfExporting] = useState(false);
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);
  const [isFavoriteOrder, setIsFavoriteOrder] = useState(false);
  const [hasLastOrderTemplate, setHasLastOrderTemplate] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [isSelectedProductMatchesLoading, setIsSelectedProductMatchesLoading] = useState(false);
  const [storeBranchCode, setStoreBranchCode] = useState('');
  const [orderFlowMode, setOrderFlowMode] = useState(ORDER_FLOW_MODES.PRODUCT);
  const [bulkCart, setBulkCart] = useState([]);
  const [bulkSupplierOrderForms, setBulkSupplierOrderForms] = useState({});
  const [bulkQuickForm, setBulkQuickForm] = useState(BULK_QUICK_FORM_DEFAULTS);
  const [bulkNoteTab, setBulkNoteTab] = useState('operational');
  const [isBulkOrderModalOpen, setIsBulkOrderModalOpen] = useState(false);
  const [isBulkPreviewModalOpen, setIsBulkPreviewModalOpen] = useState(false);
  const [bulkLogisticsQuotes, setBulkLogisticsQuotes] = useState({});
  const [isRowsLoading, setIsRowsLoading] = useState(false);
  const [logisticsTariffRows, setLogisticsTariffRows] = useState([]);
  const [logisticsCargoTypes, setLogisticsCargoTypes] = useState(DEFAULT_CARGO_TYPES);
  const supplierProductsAbortRef = useRef(null);
  const bulkLogisticsRequestIdRef = useRef(0);
  const loadDataRequestIdRef = useRef(0);
  const productSupplierLookupRef = useRef(new Set());
  const suggestionSupplierLookupRef = useRef(new Map());
  const suggestionSupplierLookupSignatureRef = useRef('');
  const suggestionSupplierLookupRequestRef = useRef(0);
  const [suggestionLookupRevision, setSuggestionLookupRevision] = useState(0);
  const supplierCatalogLookupRef = useRef(new Set());
  const selectProductForComparison = useCallback((productId) => {
    const normalizedProductId = toEntityKey(productId);
    setSelectedProductId(normalizedProductId);
    setIsSelectedProductMatchesLoading(Boolean(normalizedProductId));
  }, []);
  const productSearchBoxRef = useRef(null);
  const suggestionAutoOpenSignatureRef = useRef('');

  const isAdmin = user?.role === 'admin' || user?.role === 'user';

  const loadData = async () => {
    const requestId = loadDataRequestIdRef.current + 1;
    loadDataRequestIdRef.current = requestId;
    if (supplierProductsAbortRef.current) supplierProductsAbortRef.current.abort();
    const controller = new AbortController();
    supplierProductsAbortRef.current = controller;

    try {
      const hasWarmCoreCache =
        productService.hasListCache({ includeUnlisted: true })
        && supplierService.hasListCache()
        && stockService.hasStocksCache();
      const initialSupplierProductsQuery = { page: 1, limit: SUPPLIER_PRODUCTS_PAGE_LIMIT };
      const hasWarmRowsCache = procurementService.hasSupplierProductsCache(initialSupplierProductsQuery);

      if (!hasWarmCoreCache && !hasWarmRowsCache) {
        setIsLoading(true);
      }

      const supplierProductsPromise = procurementService.listSupplierProducts(initialSupplierProductsQuery, { signal: controller.signal });
      const [productList, supplierList, stockList] = await Promise.all([
        productService.list({ includeUnlisted: true, fetchAll: true }),
        supplierService.list(),
        stockService.getStocks({ fetchAll: true, includeBatches: false }),
      ]);
      if (requestId !== loadDataRequestIdRef.current || controller.signal.aborted) return;

      setProducts(productList);
      setSuppliers(supplierList);
      setStocks(stockList);
      setIsLoading(false);
      setIsRowsLoading(!hasWarmRowsCache);

      const supplierProducts = await supplierProductsPromise;
      if (requestId !== loadDataRequestIdRef.current || controller.signal.aborted) return;
      const productMap = new Map(productList.map((item) => [item.id, item]));
      const sourceRows = Array.isArray(supplierProducts) ? supplierProducts : [];
      const normalizedApiRows = [];
      const CHUNK_SIZE = 400;
      for (let start = 0; start < sourceRows.length; start += CHUNK_SIZE) {
        if (requestId !== loadDataRequestIdRef.current || controller.signal.aborted) return;
        const chunk = sourceRows.slice(start, start + CHUNK_SIZE);
        chunk.forEach((item, chunkIndex) => {
          normalizedApiRows.push(normalizeSupplierProduct(item, productMap, start + chunkIndex, 'api'));
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const merged = syncPreferredByProduct(normalizedApiRows);
      if (requestId !== loadDataRequestIdRef.current || controller.signal.aborted) return;

      setRows(merged);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setToast({ type: 'error', title: 'Tedarikçi Ürünleri', message: error.message || 'Veriler yüklenemedi.' });
    } finally {
      if (requestId === loadDataRequestIdRef.current) {
        setIsLoading(false);
        setIsRowsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadData();
    return () => {
      if (supplierProductsAbortRef.current) supplierProductsAbortRef.current.abort();
      loadDataRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadStoreBranchCode = async () => {
      try {
        const data = await settingsService.get();
        if (!active) return;
        const branchCode = String(data?.branchCode || '').trim();
        setStoreBranchCode(branchCode);
      } catch {
        if (active) {
          setStoreBranchCode('');
        }
      }
    };

    loadStoreBranchCode();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const shouldLoadLogistics = Boolean(orderModalItem || isBulkOrderModalOpen || isBulkPreviewModalOpen);
    if (!shouldLoadLogistics) return;
    if (logisticsTariffRows.length > 0) return;

    let active = true;
    procurementService.listLogisticsTariffs()
      .then((logisticsData) => {
        if (!active) return;
        if (logisticsData?.rows) {
          setLogisticsTariffRows(Array.isArray(logisticsData.rows) ? logisticsData.rows : []);
        } 
        if (logisticsData?.cargoTypes) {
          setLogisticsCargoTypes(Array.isArray(logisticsData.cargoTypes) && logisticsData.cargoTypes.length ?
             logisticsData.cargoTypes
            : DEFAULT_CARGO_TYPES);
        }
      })
      .catch(() => {
        if (active && logisticsCargoTypes.length === 0) {
          setLogisticsCargoTypes(DEFAULT_CARGO_TYPES);
        }
      });

    return () => {
      active = false;
    };
  }, [isBulkOrderModalOpen, isBulkPreviewModalOpen, logisticsCargoTypes.length, logisticsTariffRows.length, orderModalItem]);

  useEffect(() => {
    if (!orderModalItem) {
      setIsFavoriteOrder(false);
      setHasLastOrderTemplate(false);
      return;
    }

    try {
      const rawFavs = typeof window !== 'undefined' ? window.localStorage.getItem('shelfio.purchaseFavorites') : null;
      const favList = rawFavs ? JSON.parse(rawFavs) : [];
      setIsFavoriteOrder(Array.isArray(favList) && favList.includes(orderModalItem.id));
    } catch {
      setIsFavoriteOrder(false);
    }

    try {
      const rawLast = typeof window !== 'undefined' ? window.localStorage.getItem('shelfio.purchaseLastOrders') : null;
      const map = rawLast ? JSON.parse(rawLast) : {};
      setHasLastOrderTemplate(Boolean(map && map[orderModalItem.id]));
    } catch {
      setHasLastOrderTemplate(false);
    }
  }, [orderModalItem]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(RECENT_PRODUCTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return;
      const normalized = parsed
        .map((item) => String(item || '').trim())
        .filter(Boolean);
      setRecentProductIds(normalized.slice(0, RECENT_PRODUCTS_MAX));
    } catch {
      setRecentProductIds([]);
    }
  }, []);

  useEffect(() => {
    const productId = String(selectedProductId || '').trim();
    setIsSelectedProductMatchesLoading(Boolean(productId));
    if (!productId || typeof window === 'undefined') return;

    setRecentProductIds((current) => {
      const next = [productId, ...current.filter((item) => item !== productId)].slice(0, RECENT_PRODUCTS_MAX);
      try {
        window.localStorage.setItem(RECENT_PRODUCTS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // no-op
      }
      return next;
    });
  }, [selectedProductId]);

  const groupedByProduct = useMemo(() => {
    const groups = new Map();
    rows.forEach((item) => {
      const productKey = toEntityKey(item.productId);
      if (!productKey) return;
      if (!groups.has(productKey)) {
        groups.set(productKey, []);
      }
      groups.get(productKey).push(item);
    });
    return groups;
  }, [rows]);

  const supplierMap = useMemo(() => {
    const map = new Map();
    suppliers.forEach((item) => {
      map.set(item.id, item);
    });
    return map;
  }, [suppliers]);

  const mergeSupplierProductRows = useCallback((supplierProducts = [], productList = products) => {
    const productMap = new Map(productList.map((item) => [item.id, item]));
    const normalizedApiRows = (Array.isArray(supplierProducts) ? supplierProducts : [])
      .map((item, index) => normalizeSupplierProduct(item, productMap, index, 'api'));

    if (!normalizedApiRows.length) return;

    setRows((current) => {
      const byId = new Map(current.map((item) => [String(item.id), item]));
      normalizedApiRows.forEach((item) => {
        byId.set(String(item.id), item);
      });
      return syncPreferredByProduct(Array.from(byId.values()));
    });
  }, [products]);

  const fetchSuggestionSupplierProductRows = useCallback(async (suggestionItem = {}) => {
    const supplierProductId = String(suggestionItem?.supplierProductId || '').trim();
    const productId = toEntityKey(suggestionItem?.productId);
    const supplierId = String(suggestionItem?.supplierId || '').trim();

    const filterRows = (rows = [], mode = '') => (Array.isArray(rows) ? rows : []).filter((row) => {
      const rowSupplierProductId = String(row?.id || row?.supplierProductId || row?.supplierProductMappingId || '').trim();
      const rowProductId = toEntityKey(row?.productId);
      const rowSupplierId = String(row?.supplierId || '').trim();
      if (row?.isActive === false) return false;
      if (mode === 'supplierProduct') return supplierProductId && rowSupplierProductId === supplierProductId;
      if (mode === 'productSupplier') return productId && supplierId && rowProductId === productId && rowSupplierId === supplierId;
      return productId && rowProductId === productId;
    });

    if (supplierProductId) {
      const rows = await procurementService.listSupplierProducts({
        supplierProductId,
        page: 1,
        limit: 1,
        isActive: true,
        forceRefresh: true,
      });
      const exactRows = filterRows(rows, 'supplierProduct');
      if (exactRows.length) return exactRows;
    }

    if (productId && supplierId) {
      const rows = await procurementService.listSupplierProducts({
        productId,
        supplierId,
        page: 1,
        limit: SUPPLIER_PRODUCTS_PAGE_LIMIT,
        isActive: true,
        forceRefresh: true,
      });
      const exactRows = filterRows(rows, 'productSupplier');
      if (exactRows.length) return exactRows;
    }

    if (productId) {
      const rows = await procurementService.listSupplierProducts({
        productId,
        page: 1,
        limit: SUPPLIER_PRODUCTS_PAGE_LIMIT,
        isActive: true,
        forceRefresh: true,
      });
      return filterRows(rows, 'product');
    }

    return [];
  }, []);

  useEffect(() => {
    const productId = toEntityKey(selectedProductId);
    if (!productId || isLoading) return;
    if ((groupedByProduct.get(productId) || []).length) return;
    if (productSupplierLookupRef.current.has(productId)) {
      setIsSelectedProductMatchesLoading(false);
      return;
    }

    productSupplierLookupRef.current.add(productId);
    setIsSelectedProductMatchesLoading(true);
    const controller = new AbortController();

    procurementService.listSupplierProducts(
      { productId, page: 1, limit: SUPPLIER_PRODUCTS_PAGE_LIMIT, forceRefresh: true },
      { signal: controller.signal }
    )
      .then((supplierProducts) => {
        if (controller.signal.aborted) return;
        mergeSupplierProductRows(supplierProducts);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setToast({ type: 'error', title: 'TedarikÃ§i ÃœrÃ¼nleri', message: error.message || 'ÃœrÃ¼n tedarikÃ§ileri yÃ¼klenemedi.' });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsSelectedProductMatchesLoading(false);
        }
      });

    return () => controller.abort();
  }, [groupedByProduct, isLoading, mergeSupplierProductRows, selectedProductId]);

  const mappedSupplierProductCounts = useMemo(() => {
    const map = new Map();
    rows.forEach((item) => {
      const productKey = toEntityKey(item.productId);
      if (!productKey) return;
      const current = map.get(productKey) || 0;
      map.set(productKey, current + 1);
    });
    return map;
  }, [rows]);

  const formProductOptions = useMemo(() => {
    const withCounts = products.map((item) => {
      const itemKey = toEntityKey(item.id);
      const matchCount = mappedSupplierProductCounts.get(itemKey) || 0;
      return {
        value: itemKey,
        label: item.name,
        secondary: `${item.sku || '-'} • ${item.barcode || '-'} • ${matchCount === 0 ? 'Eşleşme yok' : `${matchCount} eşleşme`}`,
        searchText: `${item.name || ''} ${item.sku || ''} ${item.barcode || ''}`,
        sortWeight: matchCount === 0 ? 0 : 1,
      };
    });

    return withCounts
      .sort((a, b) => {
        if (a.sortWeight !== b.sortWeight) return a.sortWeight - b.sortWeight;
        return a.label.localeCompare(b.label, 'tr');
      })
      .map(({ sortWeight, ...rest }) => rest);
  }, [mappedSupplierProductCounts, products]);

  const formSupplierOptions = useMemo(
    () => suppliers
      .map((item) => ({
        value: item.id,
        label: item.name,
        secondary: `${item.contactName || '-'} • ${item.phone || '-'}`,
        searchText: `${item.name || ''} ${item.contactName || ''} ${item.phone || ''}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'tr')),
    [suppliers]
  );

  const productsById = useMemo(() => {
    const map = new Map();
    products.forEach((item) => {
      const key = toEntityKey(item.id);
      if (!key) return;
      map.set(key, item);
    });
    return map;
  }, [products]);

  const deliveryLocationLabel = useMemo(() => {
    const branchName = String(
      user?.storeName
      || user?.branchName
      || user?.storeLabel
      || ''
    ).trim();
    const branchCode = String(
      storeBranchCode
      || user?.branchCode
      || user?.storeCode
      || user?.storeId
      || user?.branchId
      || ''
    ).trim();

    if (branchName && branchCode) {
      return `${branchName} (${branchCode})`;
    }

    if (branchName) {
      return branchName;
    }

    if (branchCode) {
      return `Mağaza No: ${branchCode}`;
    }

    return 'Mağaza';
  }, [storeBranchCode, user]);

  const deliveryLocationOptions = useMemo(() => {
    const branchCode = String(
      storeBranchCode
      || user?.branchCode
      || user?.storeCode
      || user?.storeId
      || user?.branchId
      || ''
    ).trim();

    const branchName = String(
      user?.storeName
      || user?.branchName
      || user?.storeLabel
      || ''
    ).trim();
    const storeDestination = branchName && branchCode ?
       `${branchName} (${branchCode})`
      : branchName ?
         branchName
        : branchCode ?
           `Mağaza No: ${branchCode}`
          : 'Mağaza Teslimat Noktası';

    return [
      {
        value: 'store',
        label: storeDestination,
        destination: storeDestination,
      },
      { value: 'warehouse', label: 'Merkezi Depo Kabul', destination: 'Merkezi Depo Kabul Alanı' },
      { value: 'crossdock', label: 'Çapraz Sevkiyat Alanı', destination: 'Çapraz Sevkiyat Dağıtım Noktası' },
    ];
  }, [storeBranchCode, user]);

  const estimatedDeliveryLabel = useMemo(() => {
    if (!orderForm.deliveryDate) {
      return '-';
    }

    const parsed = new Date(`${orderForm.deliveryDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return '-';
    }

    return parsed.toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }, [orderForm.deliveryDate]);

  const orderMinimumDeliveryDate = useMemo(() => {
    if (!orderModalItem) return formatDateInputValue(new Date());
    return computeEstimatedDeliveryDate({
      baseLeadDays: orderModalItem.leadTimeDays || 3,
      serviceLevel: orderForm.serviceLevel || 'standard',
    });
  }, [orderModalItem, orderForm.serviceLevel]);

  const bulkEstimatedDeliveryLabel = useMemo(() => {
    if (!bulkQuickForm.deliveryDate) {
      return '-';
    }

    const parsed = new Date(`${bulkQuickForm.deliveryDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return '-';
    }

    return parsed.toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }, [bulkQuickForm.deliveryDate]);

  const filteredRows = useMemo(() => {
    const q = normalizeSearchText(filters.search);
    return rows.filter((item) => {
      const matchesSearch = !q || [item.productName, item.productSku, item.barcode, item.supplierName].filter(Boolean).some((value) => includesNormalized(value, q));
      const matchesSupplier = !filters.supplierId || item.supplierId === filters.supplierId;
      const matchesProduct = !filters.productId || toEntityKey(item.productId) === toEntityKey(filters.productId);
      const matchesActive = !filters.isActive || String(item.isActive) === filters.isActive;

      const group = groupedByProduct.get(toEntityKey(item.productId)) || [];
      const matchesMultiSupplier = !filters.onlyMultiSupplier || group.length > 1;
      const matchesPreferredAssigned = !filters.onlyPreferredAssigned || group.some((row) => row.isPreferred);

      return matchesSearch && matchesSupplier && matchesProduct && matchesActive && matchesMultiSupplier && matchesPreferredAssigned;
    });
  }, [filters, groupedByProduct, rows]);

  const summary = useMemo(() => {
    const multiSupplierProductCount = Array.from(groupedByProduct.values()).filter((group) => group.length > 1).length;
    const preferredAssignedProducts = Array.from(groupedByProduct.values()).filter((group) => group.some((item) => item.isPreferred)).length;
    const recentLowPriceUpdates = filteredRows.filter((item) => {
      const date = new Date(item.lastPriceUpdate || item.updatedAt);
      if (Number.isNaN(date.getTime())) return false;
      const dayDiff = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);

      const group = groupedByProduct.get(toEntityKey(item.productId)) || [];
      const minPrice = group.reduce((min, row) => Math.min(min, Number(row.purchasePrice || 0)), Number.POSITIVE_INFINITY);
      return dayDiff <= 30 && Number(item.purchasePrice) === minPrice;
    }).length;

    return {
      total: filteredRows.length,
      active: filteredRows.filter((item) => item.isActive).length,
      supplierCount: new Set(filteredRows.map((item) => item.supplierId)).size,
      multiSupplierProductCount,
      preferredAssignedProducts,
      recentLowPriceUpdates,
    };
  }, [filteredRows, groupedByProduct]);

  const catalogRows = useMemo(() => {
    if (!isCatalogPage && !catalogSupplierId) return [];
    if (!catalogSupplierId) return rows;
    return rows.filter((item) => String(item.supplierId || '') === String(catalogSupplierId || ''));
  }, [rows, catalogSupplierId, isCatalogPage]);

  useEffect(() => {
    const supplierId = String(catalogSupplierId || '').trim();
    if (!supplierId || isLoading) return;
    if (catalogRows.length > 0) return;
    if (supplierCatalogLookupRef.current.has(supplierId)) return;

    supplierCatalogLookupRef.current.add(supplierId);
    setIsRowsLoading(true);
    const controller = new AbortController();

    procurementService.listSupplierProducts(
      { supplierId, page: 1, limit: 100, forceRefresh: true },
      { signal: controller.signal }
    )
      .then((supplierProducts) => {
        if (controller.signal.aborted) return;
        mergeSupplierProductRows(supplierProducts);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setToast({ type: 'error', title: 'TedarikÃ§i KataloÄŸu', message: error.message || 'TedarikÃ§i Ã¼rÃ¼nleri yÃ¼klenemedi.' });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsRowsLoading(false);
        }
      });

    return () => controller.abort();
  }, [catalogRows.length, catalogSupplierId, isLoading, mergeSupplierProductRows]);

  const catalogSupplierOptions = useMemo(() => {
    if (suppliers.length) {
      const unique = new Map();
      suppliers.forEach((item) => {
        const normalizedId = String(item?.id || '').trim();
        if (!normalizedId || unique.has(normalizedId)) return;
        unique.set(normalizedId, { id: normalizedId, name: item.name || normalizedId });
      });

      return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    }

    const unique = new Map();
    rows.forEach((item) => {
      if (!item.supplierId) return;
      const normalizedId = String(item.supplierId).trim();
      if (!unique.has(normalizedId)) {
        unique.set(normalizedId, {
          id: normalizedId,
          name: item.supplierName || normalizedId,
        });
      }
    });

    return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [suppliers, rows]);

  const catalogSupplierComboboxOptions = useMemo(
    () => catalogSupplierOptions.map((item) => ({
      value: item.id,
      label: item.name,
      secondary: item.id,
      searchText: `${item.name} ${item.id}`,
    })),
    [catalogSupplierOptions]
  );

  const stockMap = useMemo(() => {
    const map = new Map();
    stocks.forEach((item) => {
      const productKey = toEntityKey(item?.productId);
      if (!productKey) return;
      map.set(productKey, item);
    });
    return map;
  }, [stocks]);

  const getPriceHistoryFor = useCallback((productId, supplierId) => {
    const key = `${toEntityKey(productId)}-${toEntityKey(supplierId)}`;
    const history = priceHistory[key] || [];
    if (history.length > 0) {
      return history;
    }
    const row = rows.find((item) => toEntityKey(item.productId) === toEntityKey(productId) && toEntityKey(item.supplierId) === toEntityKey(supplierId));
    if (!row) return [];
    return [{ at: row.lastPriceUpdate, price: Number(row.purchasePrice || 0) }];
  }, [priceHistory, rows]);

  const CATALOG_PAGE_SIZE = 9;

  useEffect(() => {
    if (!isCatalogPage && viewMode === 'table') {
      setViewMode('card');
    }
  }, [isCatalogPage, viewMode]);

  const catalogEnrichedRows = useMemo(() => {
    if (!catalogRows.length) return [];

    return catalogRows.map((row) => {
      const rowProductKey = toEntityKey(row.productId);
      const stock = stockMap.get(rowProductKey) || null;
      const warehouseStock = stock ? Number(stock.warehouseStock || stock.warehouseQuantity || 0) : 0;
      const shelfStock = stock ? Number(stock.shelfStock || stock.shelfQuantity || 0) : 0;
      const totalStock = stock ? Number(stock.totalStock || stock.quantity || (warehouseStock + shelfStock)) : 0;
      const inStock = totalStock > 0;

      const history = getPriceHistoryFor(row.productId, row.supplierId)
        .slice()
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

      const lastEntry = history[history.length - 1] || null;
      const previousEntry = history.length > 1 ? history[history.length - 2] : null;

      const currentPrice = Number(row.purchasePrice || lastEntry?.price || 0);
      const oldPrice = previousEntry ? Number(previousEntry.price || 0) : null;

      let discountRate = 0;
      let hasDiscount = false;
      if (oldPrice && oldPrice > 0 && currentPrice > 0 && currentPrice < oldPrice) {
        discountRate = ((oldPrice - currentPrice) / oldPrice) * 100;
        hasDiscount = true;
      }

      const product = productsById.get(rowProductKey) || null;
      const resolvedCategory = resolveCatalogCategoryMeta(product, {
        categoryId: row.productCategoryId,
        categoryLabel: row.categoryLabel,
      });
      const categoryId = resolvedCategory.categoryId || null;
      const categoryLabel = resolvedCategory.categoryLabel || 'Diğer';
      const warehouseCapacityLimit = Number(product?.warehouseMaxStock || 0);
      const shelfCapacityLimit = Number(product?.maxShelfStock || product?.shelfMaxStock || 0);
      const warehouseCapacityRemaining = warehouseCapacityLimit > 0 ? Math.max(0, warehouseCapacityLimit - warehouseStock) : 0;
      const shelfCapacityRemaining = shelfCapacityLimit > 0 ? Math.max(0, shelfCapacityLimit - shelfStock) : 0;
      const maxPurchasableByCapacity = warehouseCapacityRemaining + shelfCapacityRemaining;
      const brand = getBrandFromProductName(product?.name || row.productName);
      const marginRate = getMarginRate(product?.salePrice, currentPrice);
      const tierPricing = getTierPricing(currentPrice, row.minimumOrderQty || 1);

      const supplier = supplierMap.get(row.supplierId);
      const deliveryPerformance = getEffectiveDeliveryPerformance(supplier?.teslimatPerformansi);

      const group = groupedByProduct.get(rowProductKey) || [];
      const groupMinPrice = group.length ?
         Math.min(...group.map((item) => Number(item.purchasePrice || 0) || Number.POSITIVE_INFINITY))
        : currentPrice;
      const isBestPrice = groupMinPrice > 0 && currentPrice === groupMinPrice;
      const supplierScore = getSupplierScore({
        purchasePrice: currentPrice,
        leadTimeDays: row.leadTimeDays,
        deliveryPerformance,
        productRows: group,
      });

      const minOrderQty = Number(row.minimumOrderQty || 1);
      const minOrderFriendly = `${formatNumber(minOrderQty)} ${row.minOrderUnit || row.priceUnit || 'adet'}`;

      return {
        ...row,
        catalogCurrentPrice: currentPrice,
        catalogOldPrice: oldPrice,
        catalogDiscountRate: discountRate,
        catalogHasDiscount: hasDiscount,
        catalogInStock: inStock,
        catalogTotalStock: totalStock,
        catalogWarehouseStock: warehouseStock,
        catalogShelfStock: shelfStock,
        catalogWarehouseCapacityLimit: warehouseCapacityLimit,
        catalogShelfCapacityLimit: shelfCapacityLimit,
        catalogWarehouseCapacityRemaining: warehouseCapacityRemaining,
        catalogShelfCapacityRemaining: shelfCapacityRemaining,
        catalogMaxPurchasableByCapacity: maxPurchasableByCapacity,
        catalogCategoryId: categoryId,
        catalogCategoryLabel: categoryLabel,
        catalogBrand: brand,
        catalogMarginRate: marginRate,
        catalogSupplierScore: supplierScore,
        catalogTierPricing: tierPricing,
        catalogIsBestPrice: isBestPrice,
        catalogMinOrderLabel: minOrderFriendly,
      };
    });
  }, [catalogRows, stockMap, productsById, groupedByProduct, getPriceHistoryFor, supplierMap]);

  const catalogCategoryOptions = useMemo(() => {
    const seen = new Set();
    const options = [];

    catalogEnrichedRows.forEach((row) => {
      const id = String(row.catalogCategoryId || '').trim();
      const label = normalizeCatalogCategoryLabel(row.catalogCategoryLabel);
      if (!id || !label) return;
      const key = `${id}::${label.toLocaleLowerCase('tr-TR')}`;
      if (seen.has(key)) return;
      seen.add(key);
      options.push({ value: id, label });
    });

    return options.sort((left, right) => left.label.localeCompare(right.label, 'tr'));
  }, [catalogEnrichedRows]);

  const catalogFilteredRows = useMemo(() => {
    let data = catalogEnrichedRows;

    if (catalogCategoryId) {
      data = data.filter((row) => row.catalogCategoryId === catalogCategoryId);
    }

    const min = parseMoneyInput(catalogFilters.priceMin, 0);
    const max = parseMoneyInput(catalogFilters.priceMax, 0);
    if (min > 0) {
      data = data.filter((row) => Number(row.catalogCurrentPrice || 0) >= min);
    }
    if (max > 0) {
      data = data.filter((row) => Number(row.catalogCurrentPrice || 0) <= max);
    }

    if (catalogFilters.inStockOnly) {
      data = data.filter((row) => row.catalogInStock);
    }

    if (catalogFilters.discountOnly) {
      data = data.filter((row) => row.catalogHasDiscount);
    }

    if (catalogFilters.quickDeliveryOnly) {
      data = data.filter((row) => Number(row.leadTimeDays || 0) > 0 && Number(row.leadTimeDays || 0) <= 3);
    }

    if (catalogFilters.bestPriceOnly) {
      data = data.filter((row) => row.catalogIsBestPrice);
    }

    if (catalogFilters.highScoreOnly) {
      data = data.filter((row) => Number(row.catalogSupplierScore || 0) >= 85);
    }

    return data;
  }, [catalogEnrichedRows, catalogCategoryId, catalogFilters]);

  const catalogSortedRows = useMemo(() => {
    const data = [...catalogFilteredRows];
    const alpha = (left, right) => String(left.productName || '').localeCompare(String(right.productName || ''), 'tr');

    switch (catalogSort) {
      case 'priceDesc':
        data.sort((left, right) => Number(right.catalogCurrentPrice || 0) - Number(left.catalogCurrentPrice || 0));
        break;
      case 'leadTimeAsc':
        data.sort((left, right) => Number(left.leadTimeDays || 0) - Number(right.leadTimeDays || 0));
        break;
      case 'alphaAsc':
        data.sort(alpha);
        break;
      case 'priceAsc':
      default:
        data.sort((left, right) => Number(left.catalogCurrentPrice || 0) - Number(right.catalogCurrentPrice || 0));
        break;
    }

    return data;
  }, [catalogFilteredRows, catalogSort]);

  const catalogTotalPages = useMemo(
    () => (catalogSortedRows.length ? Math.ceil(catalogSortedRows.length / CATALOG_PAGE_SIZE) : 1),
    [catalogSortedRows],
  );

  const safeCatalogPageIndex = useMemo(
    () => Math.min(catalogPageIndex, Math.max(catalogTotalPages - 1, 0)),
    [catalogPageIndex, catalogTotalPages],
  );

  useEffect(() => {
    setCatalogPageInput(String(safeCatalogPageIndex + 1));
  }, [safeCatalogPageIndex]);

  const catalogPageItems = useMemo(
    () => catalogSortedRows.slice(safeCatalogPageIndex * CATALOG_PAGE_SIZE, (safeCatalogPageIndex + 1) * CATALOG_PAGE_SIZE),
    [catalogSortedRows, safeCatalogPageIndex],
  );

  const catalogFocusedRow = useMemo(() => {
    if (!catalogFocusedRowId) {
      return catalogPageItems[0] || null;
    }
    return catalogEnrichedRows.find((row) => row.id === catalogFocusedRowId) || catalogPageItems[0] || null;
  }, [catalogEnrichedRows, catalogFocusedRowId, catalogPageItems]);

  useEffect(() => {
    if (!catalogPageItems.length) {
      setCatalogFocusedRowId('');
      return;
    }

    if (!catalogFocusedRowId || !catalogPageItems.some((row) => row.id === catalogFocusedRowId)) {
      setCatalogFocusedRowId(catalogPageItems[0].id);
    }
  }, [catalogPageItems, catalogFocusedRowId]);

  // Tablo görünümü için: tüm ürünler, varsayılan tedarikçi ve stok / performans bilgileri
  const tableRows = useMemo(() => {
    if (viewMode !== 'table') {
      return [];
    }

    const search = normalizeSearchText(filters.search);

    const result = products.map((product) => {
      const productKey = toEntityKey(product.id);
      const group = groupedByProduct.get(productKey) || [];

      let defaultMatch = null;
      if (group.length) {
        const preferredActive = group.filter((item) => item.isActive && item.isPreferred);
        const preferredPool = preferredActive.length ? preferredActive : group.filter((item) => item.isPreferred);

        if (preferredPool.length) {
          defaultMatch = preferredPool.slice().sort((a, b) => Number(a.purchasePrice || 0) - Number(b.purchasePrice || 0))[0];
        } else {
          const activeGroup = group.filter((item) => item.isActive);
          const pool = activeGroup.length ? activeGroup : group;
          defaultMatch = pool.slice().sort((a, b) => Number(a.purchasePrice || 0) - Number(b.purchasePrice || 0))[0];
        }
      }

      const stock = stockMap.get(productKey) || null;
      const warehouseStock = stock ? Number(stock.warehouseStock || stock.warehouseQuantity || 0) : 0;
      const shelfStock = stock ? Number(stock.shelfStock || stock.shelfQuantity || 0) : 0;
      const totalStock = stock ? Number(stock.totalStock || stock.quantity || (warehouseStock + shelfStock)) : 0;

      const supplier = defaultMatch ? supplierMap.get(defaultMatch.supplierId) || null : null;
      const teslimatPerformansi = supplier ?
         `${getEffectiveDeliveryPerformance(supplier.teslimatPerformansi)}%`
        : '';
      const gecikmeDurumu = supplier?.gecikmeDurumu || '';
      const categoryLabel = resolveCatalogCategoryMeta(product, { categoryLabel: product.categoryName }).categoryLabel || 'Diğer';
      const brand = getBrandFromProductName(product.name);
      const marginRate = defaultMatch ? getMarginRate(product.salePrice, defaultMatch.purchasePrice) : null;
      const tierPricing = defaultMatch ? getTierPricing(defaultMatch.purchasePrice, defaultMatch.minimumOrderQty || 1) : [];
      const supplierScore = defaultMatch ?
         getSupplierScore({
            purchasePrice: defaultMatch.purchasePrice,
            leadTimeDays: defaultMatch.leadTimeDays,
            deliveryPerformance: getEffectiveDeliveryPerformance(supplier?.teslimatPerformansi),
            productRows: group,
          })
        : null;

      const row = {
        id: product.id,
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        barcode: product.barcode || '-',
        supplierId: defaultMatch?.supplierId || null,
        supplierName: defaultMatch?.supplierName || '-',
        supplierProductName: defaultMatch?.supplierProductName || '',
        purchasePrice: defaultMatch ? Number(defaultMatch.purchasePrice || 0) : null,
        currency: defaultMatch?.currency || 'TRY',
        leadTimeDays: defaultMatch ? Number(defaultMatch.leadTimeDays || 0) : null,
        isActive: product.isActive !== false,
        hasDefaultMatch: Boolean(defaultMatch),
        supplierProductId: defaultMatch?.id || null,
        totalStock,
        warehouseStock,
        shelfStock,
        categoryLabel,
        brand,
        marginRate,
        supplierScore,
        tierPricing,
        teslimatPerformansi,
        gecikmeDurumu,
      };

      const matchesSearch = !search
        || [row.productName, row.productSku, row.barcode, row.supplierName, row.supplierProductName, row.categoryLabel, row.brand]
          .filter(Boolean)
          .some((value) => includesNormalized(value, search));

      const matchesSupplier = !filters.supplierId || row.supplierId === filters.supplierId;
      const matchesProduct = !filters.productId || toEntityKey(row.productId) === toEntityKey(filters.productId);
      const matchesActive = !filters.isActive || String(row.isActive) === filters.isActive;

      return (matchesSearch && matchesSupplier && matchesProduct && matchesActive) ? row : null;
    });

    return result.filter(Boolean);
  }, [products, groupedByProduct, filters, stockMap, supplierMap, viewMode]);

  const selectedProductRows = useMemo(() => {
    if (!selectedProductId) return [];
    return [...(groupedByProduct.get(toEntityKey(selectedProductId)) || [])].sort((a, b) => Number(a.purchasePrice) - Number(b.purchasePrice));
  }, [groupedByProduct, selectedProductId]);

  useEffect(() => {
    if (!selectedProductId) {
      setIsSelectedProductMatchesLoading(false);
      return;
    }
    if (isLoading || isRowsLoading) return;
    const frameId = window.requestAnimationFrame(() => {
      setIsSelectedProductMatchesLoading(false);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [groupedByProduct, isLoading, isRowsLoading, selectedProductId]);

  const selectedMinPrice = useMemo(() => {
    if (!selectedProductRows.length) return null;
    return Math.min(...selectedProductRows.map((item) => Number(item.purchasePrice || 0)));
  }, [selectedProductRows]);

  const selectedMinLeadTime = useMemo(() => {
    if (!selectedProductRows.length) return null;
    return Math.min(...selectedProductRows.map((item) => Number(item.leadTimeDays || 0)));
  }, [selectedProductRows]);

  const selectedBestSuccessSupplierId = useMemo(() => {
    if (!selectedProductRows.length) return null;

    let bestId = null;
    let bestScore = -Infinity;

    selectedProductRows.forEach((item) => {
      const supplier = supplierMap.get(item.supplierId);
      const raw = supplier?.teslimatPerformansi;
      if (!raw) return;

      const numeric = Number(String(raw).replace('%', '').replace(',', '.'));
      if (!Number.isFinite(numeric)) return;

      if (numeric > bestScore) {
        bestScore = numeric;
        bestId = item.id;
      }
    });

    return bestId;
  }, [selectedProductRows, supplierMap]);

  const selectedEfficientSupplierId = useMemo(() => {
    if (!selectedProductRows.length) return null;

    const baseMinPrice = selectedMinPrice !== null ? selectedMinPrice : Math.min(...selectedProductRows.map((item) => Number(item.purchasePrice || 0)));
    const baseMinLead = selectedMinLeadTime !== null ? selectedMinLeadTime : Math.min(...selectedProductRows.map((item) => Number(item.leadTimeDays || 0)));

    const minPrice = baseMinPrice > 0 ? baseMinPrice : 1;
    const minLead = baseMinLead > 0 ? baseMinLead : 1;

    let bestId = null;
    let bestScore = Number.POSITIVE_INFINITY;

    selectedProductRows.forEach((item) => {
      const supplier = supplierMap.get(item.supplierId);
      const perfRaw = supplier?.teslimatPerformansi;

      let successRatio = 1; // 1 = nötr, daha küçük = daha iyi
      if (perfRaw) {
        const perfNumeric = Number(String(perfRaw).replace('%', '').replace(',', '.'));
        if (Number.isFinite(perfNumeric) && perfNumeric > 0 && perfNumeric <= 100) {
          successRatio = (100 - perfNumeric + 1) / 100;
        }
      }

      const priceRatio = Number(item.purchasePrice || 0) / minPrice || 1;
      const leadRatio = Number(item.leadTimeDays || 0) / minLead || 1;

      // Skor aşırlıkları: fiyat %60, teslim süresi %30, performans %10
      const score = (priceRatio * 0.6) + (leadRatio * 0.3) + (successRatio * 0.1);

      if (score < bestScore) {
        bestScore = score;
        bestId = item.id;
      }
    });

    return bestId || selectedProductRows[0]?.id || null;
  }, [selectedProductRows, selectedMinPrice, selectedMinLeadTime, supplierMap]);

  const handleResetCatalogFilters = () => {
    setCatalogCategoryId('');
    setCatalogSort('priceAsc');
    setCatalogFilters({
      priceMin: '',
      priceMax: '',
      inStockOnly: false,
      discountOnly: false,
      quickDeliveryOnly: false,
      bestPriceOnly: false,
      highScoreOnly: false,
    });
    setCatalogPageIndex(0);
  };

  const handleExportCatalogPdf = async () => {
    if (catalogPdfExporting) return;

    if (!activeCatalogSupplier || !catalogSupplierId) {
      setToast({
        type: 'info',
        title: 'Katalog',
        message: 'PDF indirmek için önce bir tedarikçi seçin.',
      });
      return;
    }

    const data = supplierCatalogRows;
    if (!data.length) {
      setToast({
        type: 'info',
        title: 'Katalog',
        message: 'Seçili tedarikçi için dışa aktarılacak katalog kaydı bulunmuyor.',
      });
      return;
    }

    try {
      setCatalogPdfExporting(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const { jsPDF, autoTable, pdfFonts } = await loadCatalogPdfModules();

      const exportSupplierName = activeCatalogSupplier?.name || 'tedarikci';
      const generatedAtLabel = new Date().toLocaleString('tr-TR');
      const safeName = String(exportSupplierName)
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-çğıöşü]/gi, '')
        .slice(0, 48)
        || 'tedarikci';

      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      ensureTurkishPdfFont(doc, pdfFonts);

      const columns = [
        { header: 'Ürün', width: 178, align: 'left' },
        { header: 'SKU', width: 72, align: 'left' },
        { header: 'Barkod', width: 92, align: 'left' },
        { header: 'Stok', width: 58, align: 'right' },
        { header: 'Kategori', width: 92, align: 'left' },
        { header: 'Marka', width: 78, align: 'left' },
        { header: 'Marj (%)', width: 56, align: 'right' },
        { header: 'Puan', width: 56, align: 'right' },
        { header: 'Tier Fiyat', width: 156, align: 'left' },
        { header: 'Alış Fiyatı', width: 86, align: 'right' },
      ];

      const bodyRows = data.map((row) => {
        const marginText = row.catalogMarginRate == null ? '-' : `%${formatNumber(row.catalogMarginRate)}`;
        const scoreText = row.catalogSupplierScore == null ? '-' : `${formatNumber(row.catalogSupplierScore)} / 100`;

        return [
          row.productName || '-',
          row.productSku || '-',
          row.barcode || '-',
          formatNumber(row.catalogTotalStock || 0),
          row.catalogCategoryLabel || '-',
          row.catalogBrand || '-',
          marginText,
          scoreText,
          formatTierPricingForReport(row.catalogTierPricing),
          row.catalogCurrentPrice != null ?
             formatCurrency(Number(row.catalogCurrentPrice || row.purchasePrice || 0), 'TRY')
            : '-',
        ];
      });

      renderStandardPdfTableReport({
        doc,
        autoTable,
        pdfFonts,
        title: 'Tedarikçi Kataloğu',
        generatedAtLabel,
        totalRecords: data.length,
        columns,
        bodyRows,
        fileName: `katalog-${safeName}.pdf`,
      });

      setToast({ type: 'success', title: 'Katalog', message: 'PDF katalog indirildi.' });
    } catch (error) {
      setToast({ type: 'error', title: 'Katalog', message: error?.message || 'PDF katalog oluşturulamadı.' });
    } finally {
      setCatalogPdfExporting(false);
    }
  };

  const handleCatalogNextPage = () => {
    setCatalogPageIndex((current) => {
      if (current + 1 >= catalogTotalPages) return current;
      return current + 1;
    });
  };

  const handleCatalogPrevPage = () => {
    setCatalogPageIndex((current) => {
      if (current <= 0) return 0;
      return current - 1;
    });
  };

  const handleCatalogJumpToPage = (target) => {
    const pageNumber = Number(target || 1) || 1;
    const safe = Math.min(Math.max(pageNumber, 1), catalogTotalPages);
    setCatalogPageIndex(safe - 1);
  };

  const getCatalogDefaultQty = (row) => Math.max(1, Number(row?.minimumOrderQty || 1));

  const resolveCatalogDraftQty = (row) => {
    if (!row?.id) return 1;
    const raw = Number(catalogDraftQtyById[row.id]);
    if (!Number.isFinite(raw) || raw <= 0) {
      return getCatalogDefaultQty(row);
    }
    return Math.max(getCatalogDefaultQty(row), Math.floor(raw));
  };

  const setCatalogDraftQty = (row, nextValue) => {
    if (!row?.id) return;
    const minimum = getCatalogDefaultQty(row);
    const parsed = Number(String(nextValue).replace(',', '.'));
    const safeQty = Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : minimum;

    setCatalogDraftQtyById((current) => ({
      ...current,
      [row.id]: String(safeQty),
    }));
  };

  const adjustCatalogDraftQty = (row, delta) => {
    if (!row?.id) return;
    const minimum = getCatalogDefaultQty(row);
    const current = resolveCatalogDraftQty(row);
    const next = Math.max(minimum, current + delta);

    setCatalogDraftQtyById((state) => ({
      ...state,
      [row.id]: String(next),
    }));
  };

  const handleAddCatalogRow = (row) => {
    if (!row || !row.id) return;
    const selectedQty = resolveCatalogDraftQty(row);
    const defaultUnit = row.defaultOrderUnit || row.priceUnit || row.orderUnit || 'adet';
    const unitPrice = Number(row.catalogCurrentPrice || row.purchasePrice || 0) || 0;

    setCatalogFocusedRowId(row.id);
    setCatalogCart((current) => {
      const existingIndex = current.findIndex((item) => item.id === row.id);

      if (existingIndex >= 0) {
        const next = [...current];
        const updated = {
          ...next[existingIndex],
          quantity: Number(next[existingIndex].quantity || 0) + selectedQty,
        };
        next[existingIndex] = enrichLineWithMetrics(updated);
        return next;
      }

      const created = {
        id: row.id,
        supplierProductId: row.id,
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        supplierCode: row.supplierCode || row.supplierId,
        productName: row.productName,
        productSku: row.productSku,
        productUnit: row.productUnit || '',
        barcode: row.barcode || '-',
        unitPrice,
        quantity: selectedQty,
        unit: defaultUnit,
        minimumOrderQty: getCatalogDefaultQty(row),
        minOrderUnit: row.minOrderUnit || row.priceUnit || 'adet',
        leadTimeDays: Number(row.leadTimeDays || 0),
        tierPrice3Case: Number(row.tierPrice3Case || 0),
        tierPrice10Case: Number(row.tierPrice10Case || 0),
        tierPrice20Case: Number(row.tierPrice20Case || 0),
        currency: row.currency || 'TRY',
        unitsPerPack: Number(row.unitsPerPack || 1),
        unitsPerBox: Number(row.unitsPerBox || row.unitsPerCase || 1),
        unitsPerCase: Number(row.unitsPerCase || 1),
        unitsPerPallet: Number(row.unitsPerPallet || 1),
        casesPerPallet: Number(row.casesPerPallet || 1),
      };

      return [
        ...current,
        enrichLineWithMetrics(created),
      ];
    });
    setToast(null);
  };

  const handleRemoveCatalogRow = (rowId) => {
    setCatalogCart((current) => current.filter((item) => item.id !== rowId));
  };

  const handleUpdateCatalogCartQty = (rowId, nextValue, minimum = 1) => {
    const parsed = Number(String(nextValue).replace(',', '.'));
    if (!Number.isFinite(parsed)) return;
    const safeQty = Math.max(Math.max(1, Number(minimum || 1)), Math.floor(parsed));

    setCatalogCart((current) => current.map((item) => {
      if (item.id !== rowId) return item;
      return enrichLineWithMetrics({ ...item, quantity: safeQty });
    }));
  };

  const handleAdjustCatalogCartQty = (rowId, delta, minimum = 1) => {
    setCatalogCart((current) => current.map((item) => {
      if (item.id !== rowId) return item;
      const safeMin = Math.max(1, Number(minimum || 1));
      const safeQty = Math.max(safeMin, Number(item.quantity || safeMin) + delta);
      return enrichLineWithMetrics({ ...item, quantity: safeQty });
    }));
  };

  const handleClearCatalogCart = () => {
    setCatalogCart([]);
  };

  const handleOrderSelectedFromCatalog = () => {
    if (orderSubmitting) return;

    if (!catalogCart.length) {
      setToast({ type: 'error', title: 'Katalog', message: 'Sepet boş. Onaya göndermek için ürün ekleyin.' });
      return;
    }

    const prioritizedCartItem = catalogCart.find((item) => item.id === catalogFocusedRowId) || catalogCart[0];
    const selectedCatalogRow = catalogEnrichedRows.find((row) => row.id === prioritizedCartItem?.id)
      || rows.find((row) => row.id === prioritizedCartItem?.id)
      || null;

    if (!prioritizedCartItem) {
      setToast({
        type: 'error',
        title: 'Katalog',
        message: 'Siparişe aktarılacak ürün bilgisi bulunamadı.',
      });
      return;
    }

    const modalSeedRow = selectedCatalogRow ?
       {
          ...selectedCatalogRow,
          purchasePrice: Number(prioritizedCartItem.unitPrice || selectedCatalogRow.purchasePrice || 0),
          currency: prioritizedCartItem.currency || selectedCatalogRow.currency || 'TRY',
          minimumOrderQty: Number(prioritizedCartItem.minimumOrderQty || selectedCatalogRow.minimumOrderQty || 1),
          minOrderUnit: prioritizedCartItem.minOrderUnit || selectedCatalogRow.minOrderUnit || selectedCatalogRow.priceUnit || 'adet',
          supplierName: prioritizedCartItem.supplierName || selectedCatalogRow.supplierName,
          productName: prioritizedCartItem.productName || selectedCatalogRow.productName,
          productSku: prioritizedCartItem.productSku || selectedCatalogRow.productSku,
        }
      : {
          ...prioritizedCartItem,
          id: prioritizedCartItem.id,
          supplierProductId: prioritizedCartItem.supplierProductId || prioritizedCartItem.id,
          source: 'api',
          isActive: true,
          purchasePrice: Number(prioritizedCartItem.unitPrice || 0),
          minimumOrderQty: Number(prioritizedCartItem.minimumOrderQty || 1),
          minOrderUnit: prioritizedCartItem.minOrderUnit || prioritizedCartItem.unit || 'adet',
          priceUnit: prioritizedCartItem.unit || 'adet',
          orderUnit: prioritizedCartItem.unit || 'adet',
          productUnit: prioritizedCartItem.productUnit || '',
          unitsPerPack: 1,
          unitsPerCase: 1,
          unitsPerPallet: 1,
          casesPerPallet: 1,
          leadTimeDays: Number(prioritizedCartItem.leadTimeDays || 3),
          productId: prioritizedCartItem.productId,
          supplierId: prioritizedCartItem.supplierId,
          productName: prioritizedCartItem.productName,
          productSku: prioritizedCartItem.productSku,
          supplierName: prioritizedCartItem.supplierName,
          currency: prioritizedCartItem.currency || 'TRY',
          barcode: prioritizedCartItem.barcode || '-',
        };

    setIsCatalogModalOpen(false);
    openOrderModal(modalSeedRow, {
      source: 'catalog',
      cartItemId: prioritizedCartItem.id,
      initialQuantity: Number(prioritizedCartItem.quantity || 1),
      initialUnit: prioritizedCartItem.unit,
    });
  };

  const catalogColumns = [
    { key: 'productName', label: 'Ürün' },
    { key: 'productSku', label: 'SKU' },
    { key: 'barcode', label: 'Barkod' },
    {
      key: 'catalogTotalStock',
      label: renderColumnLabel('Mevcut Stok Adedi', 'Depo ve reyondaki toplam stok miktarı.'),
      render: (row) => formatNumber(row.catalogTotalStock || 0),
      sortValue: (row) => Number(row.catalogTotalStock || 0),
    },
    {
      key: 'catalogCategoryLabel',
      label: renderColumnLabel('Kategori', 'Ürünün ait olduğu kategori.'),
      render: (row) => row.catalogCategoryLabel || '-',
    },
    {
      key: 'catalogBrand',
      label: renderColumnLabel('Marka', 'Ürün adından türetilen marka bilgisi.'),
      render: (row) => row.catalogBrand || '-',
    },
    {
      key: 'catalogMarginRate',
      label: renderColumnLabel('Kâr Marjı', 'Formül: (satış - alış) / satış'),
      render: (row) => (row.catalogMarginRate == null ? '-' : `%${formatNumber(row.catalogMarginRate)}`),
      sortValue: (row) => Number(row.catalogMarginRate || 0),
    },
    {
      key: 'catalogSupplierScore',
      label: renderColumnLabel('Tedarikçi Puanı', 'Teslim süresi, fiyat ve doğruluk birleşik puanı.'),
      render: (row) => `${formatNumber(row.catalogSupplierScore || 0)} / 100`,
      sortValue: (row) => Number(row.catalogSupplierScore || 0),
    },
    {
      key: 'catalogTierPricing',
      label: renderColumnLabel('Çoklu Fiyat (Tier)', 'Adet arttıkça oluşan fiyat kırılımları.'),
      render: (row) => {
        const tiers = Array.isArray(row.catalogTierPricing) ? row.catalogTierPricing : [];
        if (!tiers.length) return '-';
        return tiers.map((tier) => `${formatNumber(tier.qty)}+: ${formatNumber(tier.price)}`).join(' | ');
      },
      sortable: false,
    },
    { key: 'supplierName', label: 'Tedarikçi' },
    {
      key: 'purchasePrice',
      label: 'Alış Fiyatı',
      render: (row) => formatCurrency(row.purchasePrice, row.currency || 'TRY'),
    },
    { key: 'currency', label: 'Para Birimi' },
    {
      key: 'leadTimeDays',
      label: 'Teslim Süresi',
      render: (row) => `${formatNumber(row.leadTimeDays)} gün`,
      sortValue: (row) => Number(row.leadTimeDays || 0),
    },
    {
      key: 'lastPriceUpdate',
      label: 'Son Güncelleme',
      render: (row) => formatDate(row.lastPriceUpdate || row.updatedAt),
      sortValue: (row) => new Date(row.lastPriceUpdate || row.updatedAt).getTime(),
    },
  ];

  const selectedProduct = useMemo(
    () => products.find((item) => toEntityKey(item.id) === toEntityKey(selectedProductId)) || null,
    [products, selectedProductId]
  );

  const selectedProductStock = useMemo(
    () => (selectedProductId ? stocks.find((item) => toEntityKey(item.productId) === toEntityKey(selectedProductId)) || null : null),
    [stocks, selectedProductId]
  );

  const selectedProductCategoryLabel = selectedProduct ?
     (resolveCatalogCategoryMeta(selectedProduct, { categoryLabel: selectedProduct.categoryName }).categoryLabel || 'Kategori bilgisi yok')
    : '-';

  const selectedProductPreferredCount = useMemo(
    () => selectedProductRows.filter((item) => item.isPreferred).length,
    [selectedProductRows]
  );

  const hasSelectedProduct = Boolean(selectedProduct);

  const selectedSupplierCount = selectedProductRows.length;

  const hasComparisonData = hasSelectedProduct && selectedProductRows.length > 0;

  const selectedTotalStock = selectedProductStock ?
     Number(selectedProductStock.totalStock || selectedProductStock.quantity || 0)
    : 0;
  const selectedWarehouseStock = selectedProductStock ? Number(selectedProductStock.warehouseStock || 0) : 0;
  const selectedShelfStock = selectedProductStock ? Number(selectedProductStock.shelfStock || 0) : 0;
  const selectedCriticalStock = Number(selectedProduct?.criticalStock || 0);
  const stockCriticalRatio = selectedCriticalStock > 0 ?
     Math.max(0, Math.min(1, selectedTotalStock / selectedCriticalStock))
    : null;

  const resolveStockTone = useCallback((value) => {
    if (!hasSelectedProduct) return '';
    const numericValue = Number(value || 0);
    if (selectedCriticalStock > 0) {
      if (numericValue <= selectedCriticalStock * 0.6) return 'is-critical';
      if (numericValue <= selectedCriticalStock) return 'is-warning';
      return 'is-positive';
    }
    return numericValue <= 0 ? 'is-critical' : 'is-positive';
  }, [hasSelectedProduct, selectedCriticalStock]);

  const criticalStockTone = useMemo(() => {
    if (!hasSelectedProduct) return '';
    if (stockCriticalRatio === null) return '';
    if (stockCriticalRatio <= 0.6) return 'is-critical';
    if (stockCriticalRatio <= 1) return 'is-warning';
    return 'is-positive';
  }, [hasSelectedProduct, stockCriticalRatio]);

  const productSearchResults = useMemo(() => {
    const q = normalizeSearchText(productSearch);
    if (!q) {
      const recentSet = new Set(recentProductIds);
      const recentProducts = recentProductIds
        .map((id) => productsById.get(toEntityKey(id)) || null)
        .filter(Boolean);
      const fallback = products
        .filter((item) => !recentSet.has(toEntityKey(item.id)))
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'tr'));
      return [...recentProducts, ...fallback];
    }

    return products
      .filter((item) => [item.name, item.sku, item.barcode]
        .filter(Boolean)
        .some((value) => includesNormalized(value, q)))
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'tr'));
  }, [productSearch, products, productsById, recentProductIds]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setProductSearch(productSearchInput);
    }, 180);

    return () => clearTimeout(handle);
  }, [productSearchInput]);

  useEffect(() => {
    if (!isProductSearchOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!productSearchBoxRef.current?.contains(event.target)) {
        setIsProductSearchOpen(false);
        setHighlightedProductIndex(-1);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isProductSearchOpen]);

  const markPreferred = async (target) => {
    try {
      if (target?.source === 'api') {
        await procurementService.updateSupplierProduct(target.id, { isDefault: true });
      }

      setRows((current) =>
        current.map((item) => {
          if (item.productId !== target.productId) return item;
          return { ...item, isPreferred: item.id === target.id, updatedAt: new Date().toISOString() };
        })
      );
      setToast({ type: 'success', title: 'Tedarikçi Ürünleri', message: 'Varsayılan tedarikçi güncellendi.' });
    } catch (error) {
      setToast({ type: 'error', title: 'Tedarikçi Ürünleri', message: error.message || 'Varsayılan tedarikçi güncellenemedi.' });
    }
  };

  const clearPurchaseSuggestionNavigationContext = useCallback((options = {}) => {
    const handoffId = String(options.handoffId || '').trim();
    const removeHandoff = options.removeHandoff === true;
    const nextParams = new URLSearchParams(searchParams);
    let hasQueryContext = false;

    PURCHASE_SUGGESTION_QUERY_KEYS.forEach((key) => {
      if (nextParams.has(key)) {
        nextParams.delete(key);
        hasQueryContext = true;
      }
    });

    const hasStateContext = Boolean(
      location.state?.purchaseSuggestionHandoffId
      || location.state?.purchaseSuggestion
      || location.state?.purchaseSuggestions
      || location.state?.purchaseSuggestionFlow
    );

    if (removeHandoff && handoffId) {
      removePurchaseSuggestionHandoff(handoffId);
    }

    if (!hasQueryContext && !hasStateContext) return;

    navigate(
      {
        pathname: location.pathname,
        search: nextParams.toString() ? `?${nextParams.toString()}` : '',
        hash: location.hash,
      },
      {
        replace: true,
        state: sanitizePurchaseSuggestionState(location.state),
      }
    );
  }, [location.hash, location.pathname, location.state, navigate, searchParams]);

  const queueBulkItem = (item, options = {}) => {
    if (!item || !item.id) return;

    setBulkCart((current) => {
      const existingIndex = current.findIndex((row) => row.supplierProductId === item.id);
      const defaultQty = Math.max(1, Number(options.initialQuantity ?? item.minimumOrderQty ?? 1) || 1);
      const allowedUnits = getAllowedProcurementUnits(item);
      const defaultUnitCandidate = String(
        options.initialUnit
        || item.defaultOrderUnit
        || item.priceUnit
        || item.orderUnit
        || 'adet'
      ).toLocaleLowerCase('tr-TR');
      const defaultUnit = allowedUnits.includes(defaultUnitCandidate)
        ? defaultUnitCandidate
        : (allowedUnits[0] || 'adet');
      const productMeta = productsById.get(toEntityKey(item.productId)) || null;
      const resolvedCategory = resolveCatalogCategoryMeta(productMeta, {
        categoryId: item.productCategoryId,
        categoryLabel: item.categoryLabel,
      });
      const productCategoryId = resolvedCategory.categoryId || '';
      const categoryLabel = resolvedCategory.categoryLabel || 'Diğer';
      const unitPrice = Number(options.unitPrice ?? item.purchasePrice ?? 0) || 0;

      if (existingIndex >= 0) {
        const next = [...current];
        const currentQty = Number(next[existingIndex].quantity || defaultQty) || defaultQty;
        next[existingIndex] = enrichLineWithMetrics({
          ...next[existingIndex],
          quantity: options.replaceExisting ? defaultQty : currentQty + defaultQty,
          unit: defaultUnit,
          unitPrice,
          purchasePrice: unitPrice,
          priceUnit: item.priceUnit || next[existingIndex].priceUnit || 'adet',
          purchaseSuggestionId: options.purchaseSuggestionId || options.suggestionId || next[existingIndex].purchaseSuggestionId || '',
        });
        return next;
      }

      const created = {
        supplierProductId: item.id,
        productId: item.productId,
        supplierId: item.supplierId,
        productName: item.productName,
        supplierName: item.supplierName,
        supplierCode: supplierMap.get(item.supplierId)?.code || supplierMap.get(item.supplierId)?.supplierCode || item.supplierId,
        productCategoryId,
        categoryLabel,
        productSku: item.productSku,
        productUnit: item.productUnit || productsById.get(toEntityKey(item.productId))?.unit || '',
        barcode: item.barcode || '-',
        currency: item.currency || 'TRY',
        unitPrice,
        purchasePrice: unitPrice,
        priceUnit: item.priceUnit || 'adet',
        orderUnit: item.orderUnit || defaultUnit,
        defaultOrderUnit: item.defaultOrderUnit || defaultUnit,
        quantity: defaultQty,
        unit: defaultUnit,
        minimumOrderQty: Number(item.minimumOrderQty || 1),
        minOrderUnit: item.minOrderUnit || item.priceUnit || 'adet',
        leadTimeDays: Number(item.leadTimeDays || 0),
        tierPrice3Case: Number(item.tierPrice3Case || 0),
        tierPrice10Case: Number(item.tierPrice10Case || 0),
        tierPrice20Case: Number(item.tierPrice20Case || 0),
        unitsPerPack: Number(item.unitsPerPack || 1),
        unitsPerBox: Number(item.unitsPerBox || item.unitsPerCase || 1),
        unitsPerCase: Number(item.unitsPerCase || 1),
        unitsPerPallet: Number(item.unitsPerPallet || 1),
        casesPerPallet: Number(item.casesPerPallet || 1),
        recommendationReason: options.recommendationReason || '',
        purchaseSuggestionId: String(options.purchaseSuggestionId || options.suggestionId || '').trim(),
      };
      const editableUnits = getBulkLineEditableUnits(created);
      if (!editableUnits.includes(normalizeOrderUnit(created.unit || 'adet'))) {
        created.unit = editableUnits[0] || 'adet';
      }

      return [
        ...current,
        enrichLineWithMetrics(created),
      ];
    });
  };

  const removeBulkItem = (supplierProductId) => {
    setBulkCart((current) => current.filter((item) => item.supplierProductId !== supplierProductId));
  };

  const updateBulkLineQuantity = (supplierProductId, nextQuantity) => {
    setBulkCart((current) => current.map((item) => {
      if (String(item.supplierProductId || '') !== String(supplierProductId || '')) return item;
      const minimumQuantity = getBulkLineMinQuantity(item, item.unit || 'adet');
      const quantity = Math.max(minimumQuantity, Number(nextQuantity || minimumQuantity) || minimumQuantity);
      return enrichLineWithMetrics({
        ...item,
        quantity,
      });
    }));
  };

  const adjustBulkLineQuantity = (supplierProductId, delta) => {
    setBulkCart((current) => current.map((item) => {
      if (String(item.supplierProductId || '') !== String(supplierProductId || '')) return item;
      const minimumQuantity = getBulkLineMinQuantity(item, item.unit || 'adet');
      const currentQty = Math.max(minimumQuantity, Number(item.quantity || minimumQuantity) || minimumQuantity);
      return enrichLineWithMetrics({
        ...item,
        quantity: Math.max(minimumQuantity, currentQty + delta),
      });
    }));
  };

  const updateBulkLineUnit = (supplierProductId, nextUnitValue) => {
    const nextUnit = normalizeOrderUnit(nextUnitValue || 'adet') || 'adet';

    setBulkCart((current) => current.map((item) => {
      if (String(item.supplierProductId || '') !== String(supplierProductId || '')) return item;
      const editableUnits = getBulkLineEditableUnits(item);
      if (!editableUnits.includes(nextUnit)) return item;

      const currentMetrics = computeOrderMetrics({
        quantity: Math.max(1, Number(item.quantity || 1) || 1),
        unit: item.unit || 'adet',
        item,
      });
      const baseQty = Math.max(1, Number(currentMetrics?.quantityBase || item.quantityBase || item.quantity || 1) || 1);
      const multiplier = getUnitBaseMultiplier(item, nextUnit);
      const nextQty = nextUnit === 'adet'
        ? Math.ceil(baseQty)
        : Math.max(1, Math.ceil(baseQty / Math.max(1, multiplier)));
      const minimumQuantity = getBulkLineMinQuantity(item, nextUnit);

      return enrichLineWithMetrics({
        ...item,
        unit: nextUnit,
        quantity: Math.max(minimumQuantity, nextQty),
      });
    }));
  };

  useEffect(() => {
    if (!isBulkOrderModalOpen || !bulkCart.length) return;

    setBulkCart((current) => {
      let changed = false;
      const next = current.map((item) => {
        const editableUnits = getBulkLineEditableUnits(item);
        const currentUnit = normalizeOrderUnit(item.unit || 'adet') || 'adet';
        const normalizedItem = item.purchasePrice
          ? item
          : { ...item, purchasePrice: Number(item.unitPrice || item.unitPriceBase || 0) || 0, priceUnit: item.priceUnit || 'adet' };
        if (normalizedItem !== item) changed = true;
        const minimumQuantity = getBulkLineMinQuantity(normalizedItem, editableUnits.includes(currentUnit) ? currentUnit : editableUnits[0] || 'adet');
        if (editableUnits.includes(currentUnit) && Number(normalizedItem.quantity || 0) >= minimumQuantity) {
          return normalizedItem === item ? item : enrichLineWithMetrics(normalizedItem);
        }
        changed = true;
        return enrichLineWithMetrics({
          ...normalizedItem,
          unit: editableUnits.includes(currentUnit) ? currentUnit : editableUnits[0] || 'adet',
          quantity: Math.max(minimumQuantity, Number(normalizedItem.quantity || minimumQuantity) || minimumQuantity),
        });
      });
      return changed ? next : current;
    });
  }, [bulkCart.length, isBulkOrderModalOpen]);

  const bulkCartGroupedBySupplier = useMemo(() => {
    const grouped = new Map();

    bulkCart.forEach((item) => {
      const supplierId = String(item.supplierId || item.supplierCode || item.supplierName || 'unknown');
      if (!grouped.has(supplierId)) {
        const supplierMeta = supplierMap.get(item.supplierId) || null;
        grouped.set(supplierId, {
          supplierId,
          supplierName: item.supplierName || supplierMeta?.name || 'Bilinmeyen Tedarikçi',
          supplierCode: item.supplierCode || supplierMeta?.code || supplierMeta?.supplierCode || supplierId,
          averageLeadTimeDays: 0,
          items: [],
        });
      }
      const groupRef = grouped.get(supplierId);
      const existingIndex = groupRef.items.findIndex((line) => String(line.supplierProductId || '') === String(item.supplierProductId || ''));
      if (existingIndex >= 0) {
        const existingLine = groupRef.items[existingIndex];
        groupRef.items[existingIndex] = enrichLineWithMetrics({
          ...existingLine,
          quantity: Number(existingLine.quantity || 0) + Number(item.quantity || 0),
        });
      } else {
        groupRef.items.push(enrichLineWithMetrics(item));
      }
    });

    return Array.from(grouped.values()).map((group) => {
      const averageLeadTimeDays = group.items.length ?
         group.items.reduce((sum, item) => sum + Number(item.leadTimeDays || 0), 0) / group.items.length
        : 0;

      return {
        ...group,
        averageLeadTimeDays,
      };
    });
  }, [bulkCart, supplierMap]);

  const bulkMaxLeadTimeDays = useMemo(
    () => bulkCartGroupedBySupplier.reduce(
      (maxLead, group) => Math.max(maxLead, Math.ceil(Number(group.averageLeadTimeDays || 1) || 1)),
      1,
    ),
    [bulkCartGroupedBySupplier],
  );

  const bulkMinimumDeliveryDate = useMemo(
    () => computeEstimatedDeliveryDate({
      baseLeadDays: bulkMaxLeadTimeDays,
      serviceLevel: bulkQuickForm.serviceLevel || 'standard',
    }),
    [bulkMaxLeadTimeDays, bulkQuickForm.serviceLevel],
  );

  useEffect(() => {
    if (!isBulkOrderModalOpen || !bulkCartGroupedBySupplier.length) return;

    setBulkQuickForm((current) => {
      if (current.deliveryDateMode === 'custom') {
        if (!current.deliveryDate || current.deliveryDate >= bulkMinimumDeliveryDate) return current;
        return { ...current, deliveryDate: '' };
      }

      if (current.deliveryDate === bulkMinimumDeliveryDate && current.deliveryDateMode === 'estimated') {
        return current;
      }

      return {
        ...current,
        deliveryDateMode: 'estimated',
        deliveryDate: bulkMinimumDeliveryDate,
      };
    });
  }, [
    bulkCartGroupedBySupplier.length,
    bulkMinimumDeliveryDate,
    isBulkOrderModalOpen,
  ]);

  useEffect(() => {
    setBulkSupplierOrderForms((current) => {
      const next = {};

      bulkCartGroupedBySupplier.forEach((group) => {
        next[group.supplierId] = current[group.supplierId]
          || buildSupplierGroupDraft({
            deliveryLocationLabel,
            supplierCode: group.supplierCode,
          });
      });

      return next;
    });
  }, [bulkCartGroupedBySupplier, deliveryLocationLabel]);

  useEffect(() => {
    if (!deliveryLocationLabel) return;
    setBulkQuickForm((current) => {
      if (String(current.arrivalDestination || '').trim()) return current;
      return { ...current, arrivalDestination: deliveryLocationLabel };
    });
  }, [deliveryLocationLabel]);

  const resolveBulkGroupForm = useCallback((draftForm, supplierCode) => {
    const base = {
      ...(draftForm || buildSupplierGroupDraft({ deliveryLocationLabel, supplierCode })),
    };

    return {
      ...base,
      orderReason: bulkQuickForm.orderReason || base.orderReason,
      deliveryType: bulkQuickForm.deliveryType || base.deliveryType,
      shippingCarrier: bulkQuickForm.shippingCarrier || base.shippingCarrier,
      shippingFee: bulkQuickForm.shippingFee !== '' ? bulkQuickForm.shippingFee : base.shippingFee,
      originDestination: String(bulkQuickForm.originDestination || '').trim() || base.originDestination,
      arrivalDestination: String(bulkQuickForm.arrivalDestination || '').trim() || base.arrivalDestination,
      supplierDispatchDate: bulkQuickForm.supplierDispatchDate || base.supplierDispatchDate,
      deliveryDate: bulkQuickForm.deliveryDate || base.deliveryDate,
      operationalNote: String(bulkQuickForm.operationalNote || '').trim() || base.operationalNote,
      supplierNote: String(bulkQuickForm.supplierNote || '').trim() || base.supplierNote,
    };
  }, [bulkQuickForm, deliveryLocationLabel]);

  const updateBulkSupplierOrderForm = (supplierId, field, value) => {
    setBulkSupplierOrderForms((current) => ({
      ...current,
      [supplierId]: {
        ...(current[supplierId] || buildSupplierGroupDraft({ deliveryLocationLabel, supplierCode: supplierId })),
        [field]: value,
      },
    }));
  };

  useEffect(() => {
    if (!isBulkOrderModalOpen || !bulkCartGroupedBySupplier.length) {
      setBulkLogisticsQuotes({});
      return;
    }

    const requestId = bulkLogisticsRequestIdRef.current + 1;
    bulkLogisticsRequestIdRef.current = requestId;
    let active = true;
    const productMap = new Map(products.map((item) => [toEntityKey(item.id), item]));

    Promise.all(
      bulkCartGroupedBySupplier.map(async (group) => {
        const draftForm = bulkSupplierOrderForms[group.supplierId]
          || buildSupplierGroupDraft({ deliveryLocationLabel, supplierCode: group.supplierCode });
        const form = resolveBulkGroupForm(draftForm, group.supplierCode);
        const aggregateMetrics = buildBulkGroupMetrics({ items: group.items, productMap, stockMap });
        const technicalCargo = resolveBulkTechnicalCargo({
          serviceLevel: bulkQuickForm.serviceLevel || 'standard',
          storageType: aggregateMetrics.storageType,
          deliveryType: form.deliveryType,
          shippingCarrier: form.shippingCarrier,
        });
        const quoteLineItems = buildBulkQuoteLineItems(group.items, productMap);
        const cargoCandidates = buildBulkCargoCandidateCodes({
          serviceLevel: bulkQuickForm.serviceLevel || 'standard',
          storageType: aggregateMetrics.storageType,
          deliveryType: form.deliveryType,
          shippingCarrier: form.shippingCarrier,
          technicalCargoCode: technicalCargo.technicalCargoCode,
          logisticsTariffRows,
        });

        try {
          let resolvedQuote = null;
          let resolvedCargoCode = technicalCargo.technicalCargoCode;
          let resolvedCargoMeta = getCargoTypeMeta(technicalCargo.technicalCargoCode);
          let lastQuoteError = null;

          for (let candidateIndex = 0; candidateIndex < cargoCandidates.length; candidateIndex += 1) {
            const candidateCargoCode = cargoCandidates[candidateIndex];
            const candidateIsInternalTransfer = candidateCargoCode === 'store_transfer';
            try {
              resolvedQuote = await procurementService.getLogisticsQuote({
                cargoTypeCode: candidateCargoCode,
                distanceType: candidateIsInternalTransfer ? 'internal_transfer' : 'intercity',
                isInternalTransfer: candidateIsInternalTransfer,
                storageType: aggregateMetrics.storageType,
                lineItems: quoteLineItems,
              });
              resolvedCargoCode = candidateCargoCode;
              resolvedCargoMeta = getCargoTypeMeta(candidateCargoCode);
              break;
            } catch (error) {
              lastQuoteError = error;
            }
          }

          if (!resolvedQuote) {
            throw lastQuoteError || new Error('Tarife bulunamadı.');
          }

          return [
            group.supplierId,
            {
              ...aggregateMetrics,
              ...technicalCargo,
              technicalCargoCode: resolvedCargoCode || technicalCargo.technicalCargoCode,
              technicalCargoLabel: resolvedQuote?.cargoTypeName || resolvedCargoMeta?.cargoTypeName || technicalCargo.technicalCargoLabel,
              caseQty: Number((resolvedQuote?.caseQty ?? aggregateMetrics.totalCaseQty) || 0),
              fee: roundCurrencyValue(resolvedQuote?.totalPriceTl ?? 0),
              error: null,
              pending: false,
              fallbackApplied: Boolean(cargoCandidates[0] && cargoCandidates[0] !== resolvedCargoCode),
              deliveryTarget: resolvedQuote?.deliveryTarget || null,
              calculationMethod: resolvedQuote?.calculationMethod || 'case_band_tariff',
              bandLabel: buildBulkTariffBandLabel(resolvedQuote),
              mixedStorageMessage: resolvedQuote?.mixedStorageMessage || null,
              issues: Array.isArray(resolvedQuote?.issues) ? resolvedQuote.issues : [],
            },
          ];
        } catch (error) {
          return [
            group.supplierId,
            {
              ...aggregateMetrics,
              ...technicalCargo,
              caseQty: Number(aggregateMetrics.totalCaseQty || 0),
              fee: null,
              error: normalizeBulkLogisticsErrorMessage(error?.message),
              pending: false,
              fallbackApplied: true,
              deliveryTarget: null,
              calculationMethod: null,
              bandLabel: null,
              mixedStorageMessage: null,
              issues: [],
            },
          ];
        }
      }),
    )
      .then((entries) => {
        if (!active || requestId !== bulkLogisticsRequestIdRef.current) return;
        setBulkLogisticsQuotes(Object.fromEntries(entries));
      })
      .catch(() => {
        if (!active || requestId !== bulkLogisticsRequestIdRef.current) return;
        setBulkLogisticsQuotes({});
      });

    return () => {
      active = false;
    };
  }, [
    bulkCartGroupedBySupplier,
    bulkQuickForm.serviceLevel,
    bulkSupplierOrderForms,
    deliveryLocationLabel,
    isBulkOrderModalOpen,
    logisticsTariffRows,
    products,
    resolveBulkGroupForm,
    stockMap,
  ]);

  const bulkSupplierSummaries = useMemo(
    () => {
      const serviceLevel = bulkQuickForm.serviceLevel || 'standard';
      const productMap = new Map(products.map((item) => [toEntityKey(item.id), item]));

      return bulkCartGroupedBySupplier.map((group) => {
        const draftForm = bulkSupplierOrderForms[group.supplierId]
          || buildSupplierGroupDraft({ deliveryLocationLabel, supplierCode: group.supplierCode });
        const form = resolveBulkGroupForm(draftForm, group.supplierCode);
        const aggregateMetrics = buildBulkGroupMetrics({ items: group.items, productMap, stockMap });
        const technicalCargo = resolveBulkTechnicalCargo({
          serviceLevel,
          storageType: aggregateMetrics.storageType,
          deliveryType: form.deliveryType,
          shippingCarrier: form.shippingCarrier,
        });
        const groupLogisticsQuote = bulkLogisticsQuotes[group.supplierId] || {
          ...aggregateMetrics,
          ...technicalCargo,
          caseQty: Number(aggregateMetrics.totalCaseQty || 0),
          fee: null,
          error: null,
          pending: Boolean(isBulkOrderModalOpen && group.items.length),
          fallbackApplied: false,
          deliveryTarget: null,
          calculationMethod: null,
          bandLabel: null,
          mixedStorageMessage: null,
          issues: [],
        };
        const formWithLogistics = {
          ...form,
          shippingFee: groupLogisticsQuote.fee != null ? String(groupLogisticsQuote.fee) : '0',
        };

        const summary = computeSupplierGroupSummary({ items: group.items, form: formWithLogistics, resolveVatRate: resolveVatRateForCategory });
        const effectiveLeadTimeDays = getDeliveryLeadDaysForService(group.averageLeadTimeDays || 1, serviceLevel);
        const estimatedDeliveryDate = computeEstimatedDeliveryDate({
          baseLeadDays: group.averageLeadTimeDays || 1,
          serviceLevel,
        });
        return {
          ...group,
          form,
          formWithLogistics,
          draftForm,
          summary,
          logisticsQuote: groupLogisticsQuote,
          aggregateMetrics,
          effectiveLeadTimeDays,
          estimatedDeliveryDate,
        };
      });
    },
    [
      bulkCartGroupedBySupplier,
      bulkLogisticsQuotes,
      bulkSupplierOrderForms,
      bulkQuickForm.serviceLevel,
      deliveryLocationLabel,
      isBulkOrderModalOpen,
      products,
      resolveBulkGroupForm,
      stockMap,
    ],
  );

  const bulkCombinedSummary = useMemo(
    () => bulkSupplierSummaries.reduce((acc, group) => ({
      subtotal: acc.subtotal + group.summary.subtotal,
      vatAmount: acc.vatAmount + group.summary.vatAmount,
      shippingFee: acc.shippingFee + group.summary.shippingFee,
      extraServiceFee: acc.extraServiceFee + group.summary.extraServiceFee,
      grandTotal: acc.grandTotal + group.summary.grandTotal,
    }), {
      subtotal: 0,
      vatAmount: 0,
      shippingFee: 0,
      extraServiceFee: 0,
      grandTotal: 0,
    }),
    [bulkSupplierSummaries],
  );

  const bulkDeliverySnapshot = useMemo(() => {
    const quotes = bulkSupplierSummaries.map((group) => group.logisticsQuote).filter(Boolean);
    const hasPending = quotes.some((quote) => quote?.pending === true);
    const resolvedCount = quotes.filter((quote) => quote?.pending !== true && !quote?.error).length;
    const errorCount = quotes.filter((quote) => Boolean(quote?.error)).length;
    const totalCaseQty = quotes.reduce((sum, quote) => sum + Number(quote?.caseQty || 0), 0);
    const totalFee = quotes.reduce((sum, quote) => sum + Number(quote?.fee || 0), 0);
    const totalVolumeDesi = quotes.reduce((sum, quote) => sum + Number(quote?.totalVolumeDesi || 0), 0);
    const totalWeightKg = quotes.reduce((sum, quote) => sum + Number(quote?.totalWeightKg || 0), 0);
    const technicalLabelSet = Array.from(new Set(quotes.map((quote) => quote?.technicalCargoLabel).filter(Boolean)));
    const technicalLabel = technicalLabelSet.length > 1
      ? 'Karma taşıma koşulu'
      : (technicalLabelSet[0] || null);
    const firstError = quotes.find((quote) => quote?.error)?.error || null;
    const missingTariffCount = errorCount;

    return {
      hasError: errorCount > 0,
      hasPending,
      resolvedCount,
      errorCount,
      technicalLabel,
      totalCaseQty: Number(totalCaseQty.toFixed(2)),
      totalFee: roundCurrencyValue(totalFee),
      totalVolumeDesi: Number(totalVolumeDesi.toFixed(2)),
      totalWeightKg: Number(totalWeightKg.toFixed(2)),
      firstError,
      missingTariffCount,
    };
  }, [bulkSupplierSummaries]);

  const bulkSelectionSummary = useMemo(() => {
    const totalLineCount = bulkCart.length;
    const totalQuantity = bulkCart.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    const groupCount = bulkSupplierSummaries.length;

    const groupSummaries = bulkSupplierSummaries.map((group) => {
      const names = [];
      group.items.forEach((item) => {
        const name = String(item.productName || '').trim();
        if (name && !names.includes(name)) names.push(name);
      });

      return {
        supplierId: group.supplierId,
        supplierName: group.supplierName,
        lineCount: group.items.length,
        quantity: group.items.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
        productNames: names,
      };
    });

    return {
      totalLineCount,
      totalQuantity,
      groupCount,
      groupSummaries,
    };
  }, [bulkCart, bulkSupplierSummaries]);

  const bulkTotalOrderQty = bulkSelectionSummary.totalQuantity;

  const submitBulkForApproval = async () => {
    if (!bulkCart.length) {
      setToast({ type: 'error', title: 'Toplu Sipariş', message: 'Onaya göndermek için sepete ürün ekleyin.' });
      return;
    }

    const serviceLevel = bulkQuickForm.serviceLevel || 'standard';

    try {
      setOrderSubmitting(true);
      const productMap = new Map(products.map((item) => [toEntityKey(item.id), item]));

      for (let groupIndex = 0; groupIndex < bulkSupplierSummaries.length; groupIndex += 1) {
        const group = bulkSupplierSummaries[groupIndex];
        const form = resolveBulkGroupForm(group.form || {}, group.supplierCode);
        const summary = group.summary;
        const groupLogisticsQuote = group.logisticsQuote || null;
        const shippingAllocations = allocateGroupShippingFees(group.items, groupLogisticsQuote?.fee || 0);

        for (let i = 0; i < group.items.length; i += 1) {
          const line = group.items[i];
          const product = productMap.get(toEntityKey(line.productId)) || null;
          const lineShippingFee = Number(shippingAllocations[i] || 0);
          const noteParts = [
            form.operationalNote || form.note || 'Toplu sipariş akışından gönderildi.',
            form.supplierNote ? `Tedarikçi Notu: ${form.supplierNote}` : '',
            groupLogisticsQuote?.error ? `Lojistik Notu: ${groupLogisticsQuote.error}` : '',
          ].filter(Boolean);

          await procurementService.createOrder({
            supplierProductId: line.supplierProductId,
            purchaseSuggestionId: line.purchaseSuggestionId || undefined,
            quantity: Number(line.quantity || 1),
            orderUnit: line.unit || 'adet',
            baseQuantity: Number(
              line.quantityBase
              || enrichLineWithMetrics({
                ...line,
                unitsPerCase: line.unitsPerCase || product?.unitsPerCase || 0,
                unitsPerPallet: line.unitsPerPallet || product?.unitsPerPallet || 0,
              }).quantityBase
              || 0
            ),
            note: noteParts.join(' | '),
            supplierNote: form.supplierNote || '',
            deliveryLocation: form.deliveryLocation || 'store',
            deliveryDateMode: bulkQuickForm.deliveryDateMode || (form.deliveryDate ? 'custom' : 'estimated'),
            deliveryDate: form.deliveryDate || null,
            deliveryType: 'standard',
            serviceLevel,
            cargoTypeCode: groupLogisticsQuote?.technicalCargoCode || 'standard_intercity',
            originDestination: form.originDestination || '',
            arrivalDestination: form.arrivalDestination || '',
            orderType: 'bulk_grouped',
            orderReference: `${form.orderReference || `BULK-${Date.now()}-${groupIndex + 1}`}-${i + 1}`,
            approvalRequested: true,
            orderReason: form.orderReason || 'critical_restock',
            operationalNote: form.operationalNote || '',
            procurementContext: {
              purchaseSuggestionId: line.purchaseSuggestionId || undefined,
              purchaseSuggestionMode: line.purchaseSuggestionId ? 'compose_bulk' : undefined,
            },
            vatRate: summary.vatRate,
            shippingFee: lineShippingFee,
            manualOverrideTl: lineShippingFee,
            logisticsSnapshot: groupLogisticsQuote?.error ? null : {
              serviceLevel,
              technicalCargoCode: groupLogisticsQuote?.technicalCargoCode,
              technicalCargoLabel: groupLogisticsQuote?.technicalCargoLabel,
              caseQty: groupLogisticsQuote?.caseQty,
              fee: lineShippingFee,
              groupFee: groupLogisticsQuote?.fee || 0,
              deliveryTarget: groupLogisticsQuote?.deliveryTarget || null,
              bandLabel: groupLogisticsQuote?.bandLabel || null,
              mixedStorageMessage: groupLogisticsQuote?.mixedStorageMessage || null,
              pricingModel: groupLogisticsQuote?.calculationMethod || 'case_band_tariff',
            },
          });
        }
      }

      setToast({
        type: 'success',
        title: 'Toplu Sipariş',
        message: `Sipariş ${bulkSupplierSummaries.length} tedarikçi grubuna bölünerek onaya gönderildi.`,
      });
      setIsBulkPreviewModalOpen(false);
      setIsBulkOrderModalOpen(false);
      setBulkCart([]);
      setBulkSupplierOrderForms({});
      await loadData();
      setOrderFlowMode(ORDER_FLOW_MODES.BULK);
    } catch (error) {
      const errorMessage = error?.message || 'Toplu sipariş gönderilemedi.';
      const isCategoryCompatibilityError = errorMessage === 'Seçilen tedarikçi bu ürün kategorisi için uygun değil.';
      setToast({ type: 'error', title: isCategoryCompatibilityError ? 'Sipariş' : 'Toplu Sipariş', message: errorMessage });
    } finally {
      setOrderSubmitting(false);
    }
  };

  const [hasAutoAssignedPreferred, setHasAutoAssignedPreferred] = useState(false);

  const visibleProductSearchResults = useMemo(
    () => productSearchResults.slice(0, PRODUCT_QUICK_PICK_LIMIT),
    [productSearchResults],
  );

  useEffect(() => {
    if (hasAutoAssignedPreferred || !rows.length) return;

    setRows((current) => {
      const grouped = new Map();
      current.forEach((row) => {
        if (!grouped.has(row.productId)) {
          grouped.set(row.productId, []);
        }
        grouped.get(row.productId).push(row);
      });

      const now = new Date().toISOString();

      const bestByProduct = new Map();
      grouped.forEach((group, productId) => {
        if (!group.length) return;
        if (group.some((item) => item.isPreferred)) return;

        const baseMinPrice = Math.min(...group.map((item) => Number(item.purchasePrice || 0) || 1));
        const baseMinLead = Math.min(...group.map((item) => Number(item.leadTimeDays || 0) || 1));
        const minPrice = baseMinPrice > 0 ? baseMinPrice : 1;
        const minLead = baseMinLead > 0 ? baseMinLead : 1;

        let bestId = null;
        let bestScore = Number.POSITIVE_INFINITY;

        group.forEach((item) => {
          const supplier = supplierMap.get(item.supplierId);
          const perfRaw = supplier?.teslimatPerformansi;

          let successRatio = 1;
          if (perfRaw) {
            const perfNumeric = Number(String(perfRaw).replace('%', '').replace(',', '.'));
            if (Number.isFinite(perfNumeric) && perfNumeric > 0 && perfNumeric <= 100) {
              successRatio = (100 - perfNumeric + 1) / 100;
            }
          }

          const priceRatio = (Number(item.purchasePrice || 0) || minPrice) / minPrice;
          const leadRatio = (Number(item.leadTimeDays || 0) || minLead) / minLead;

          const score = (priceRatio * 0.5) + (leadRatio * 0.3) + (successRatio * 0.2);

          if (score < bestScore) {
            bestScore = score;
            bestId = item.id;
          }
        });

        if (bestId) {
          bestByProduct.set(productId, bestId);
        }
      });

      if (!bestByProduct.size) {
        return current;
      }

      return current.map((row) => {
        const bestId = bestByProduct.get(row.productId);
        if (!bestId) return row;
        return {
          ...row,
          isPreferred: row.id === bestId,
          updatedAt: now,
        };
      });
    });

    setHasAutoAssignedPreferred(true);
  }, [rows, supplierMap, hasAutoAssignedPreferred]);

  const openOrderModal = (item, options = {}) => {
    if (!isAdmin) return false;
    if (!item || !item.id) {
      console.warn('Sipariş ver akışı: geçersiz kayıt', item);
      setToast({ type: 'error', title: 'Satın Alma', message: 'Seçilen tedarikçi ürünü kaydı geçersiz.' });
      return false;
    }
    console.log('[SupplierProducts] openOrderModal - selectedSupplierProduct', {
      selectedSupplierProduct: item,
      id: item.id,
      supplierProductId: item.supplierProductId,
      source: item.source,
    });
    if (item.source && item.source !== 'api') {
      console.warn('Sipariş ver akışı: API dışı kayıt ile deneme', item);
      setToast({
        type: 'error',
        title: 'Satın Alma',
        message: 'Bu öneriye bağlı taslak bulunamadı. Önce ürün için aktif bir tedarikçi eşleşmesi oluşturun.',
      });
      return false;
    }
    if (!item.isActive) {
      setToast({ type: 'error', title: 'Satın Alma', message: 'Pasif tedarikçi eşleşmesinden sipariş verilemez.' });
      return false;
    } 
    const allowedProcurementUnits = getAllowedProcurementUnits(item);
    const defaultUnitCandidate = (item.defaultOrderUnit
      || item.priceUnit
      || item.orderUnit
      || item.productUnit
      || 'adet');
    const defaultUnit = allowedProcurementUnits.includes(String(defaultUnitCandidate).toLowerCase()) ?
       String(defaultUnitCandidate).toLowerCase()
      : allowedProcurementUnits[0];
    const initialUnitCandidate = String(options.initialUnit || defaultUnit).toLowerCase();
    const initialUnit = allowedProcurementUnits.includes(initialUnitCandidate) ? initialUnitCandidate : defaultUnit;
    const initialQty = Math.max(1, Number(options.initialQuantity || item.minimumOrderQty || 1));

    const productCategoryId = item.productCategoryId || products.find((p) => toEntityKey(p.id) === toEntityKey(item.productId))?.categoryId;

    const categoryGroup = productCategoryId ? (PRODUCT_CATEGORY_GROUPS[productCategoryId] || 'general') : 'general';

    let vatRate = '20';
    switch (categoryGroup) {
      case 'snack': // Atıştırmalık
      case 'baby': // Bebek
      case 'cleaning': // Deterjan, Temizlik
      case 'frozen': // Dondurma / Donuk
      case 'beverage': // İçecek
      case 'paper': // Kaşıt, Islak Mendil
        vatRate = '10';
        break;
      case 'meat': // Et, Tavuk, Balık
      case 'fresh': // Meyve, Sebze
      case 'dairy': // Süt, Kahvaltılık
        vatRate = '1';
        break;
      default:
        vatRate = '20'; // Elektronik, Ev Yaşam vb.
        break;
    }

    const estimatedDateValue = computeEstimatedDeliveryDate({
      baseLeadDays: item.leadTimeDays || 3,
      serviceLevel: 'standard',
    });

    const supplierInfo = supplierMap.get(item.supplierId);
    const productInfo = productsById.get(toEntityKey(item.productId));
    const rowStock = stocks.find((stockItem) => toEntityKey(stockItem.productId) === toEntityKey(item.productId)) || null;
    const rowCriticalStock = Number(rowStock?.criticalStock || productInfo?.criticalStock || 0) || 0;
    const initialProcurementNote = String(options.recommendationReason || '').trim();
    const warehouseCity = formatTurkishDisplayText(
      Array.isArray(supplierInfo?.warehouses) && supplierInfo.warehouses.length ?
         supplierInfo.warehouses[0]
        : 'İzmir',
      'İzmir'
    );

    setOrderModalItem(item);
    setOrderModalContext({
      source: options.source || 'compare',
      cartItemId: options.cartItemId || null,
      purchaseSuggestionId: String(options.purchaseSuggestionId || options.suggestionId || '').trim(),
      purchaseSuggestionMode: options.purchaseSuggestionMode || '',
    });
    setOrderSubmitMode('approval');
    setOrderForm({
      ...ORDER_FORM_DEFAULTS,
      quantity: String(initialQty),
      unit: initialUnit,
      vatRate,
      deliveryDateMode: 'estimated',
      deliveryDate: estimatedDateValue,
      shippingCarrier: 'standard_intercity',
      logisticsType: 'supplier_delivery',
      originDestination: `${item.supplierName || 'Tedarikçi'} Depo - ${warehouseCity}`,
      arrivalDestination: 'SHF-001',
      orderReason: rowCriticalStock > 0 ? 'critical_restock' : 'campaign_preparation',
      demandSource: 'warehouse',
      demandLevel: 'medium',
      procurementNote: initialProcurementNote,
    });
    return true;
  };

  const adjustQuantity = (delta) => {
    setOrderForm((current) => {
      const currentValue = Number(current.quantity || 0) || 0;
      const next = Math.max(1, currentValue + delta);
      return { ...current, quantity: String(next) };
    });
  };

  const quickSelectUnit = (targetUnit) => {
    if (!orderModalItem) return;

    const allowedUnits = getAllowedProcurementUnits(orderModalItem);

    if (!allowedUnits.includes(targetUnit)) {
      setOrderForm((current) => ({ ...current, quantity: '1' }));
      return;
    }

    setOrderForm((current) => ({
      ...current,
      unit: targetUnit,
      quantity: '1',
    }));
  };

  const handleQuickQuantityPreset = (preset) => {
    if (!orderModalItem) return;

    const unitsPerCase = Math.max(1, Number(orderModalItem.unitsPerCase || 1));
    const unitsPerPallet = Math.max(1, Number(orderModalItem.unitsPerPallet || unitsPerCase * Number(orderModalItem.casesPerPallet || 1) || 1));
    const allowedUnits = getAllowedProcurementUnits(orderModalItem);

    setOrderForm((current) => {
      const next = { ...current };

      if (preset === 'one_case') {
        if (allowedUnits.includes('koli')) {
          next.unit = 'koli';
          next.quantity = '1';
        } else {
          next.unit = 'adet';
          next.quantity = String(Math.max(1, unitsPerCase));
        }
        return next;
      }

      if (preset === 'one_pallet') {
        if (allowedUnits.includes('palet')) {
          next.unit = 'palet';
          next.quantity = '1';
        } else if (allowedUnits.includes('koli')) {
          next.unit = 'koli';
          next.quantity = String(Math.max(1, Math.ceil(unitsPerPallet / unitsPerCase)));
        } else {
          next.unit = 'adet';
          next.quantity = String(Math.max(1, unitsPerPallet));
        }
        return next;
      }

      if (preset === 'moq') {
        const moqUnit = String(orderModalItem.minOrderUnit || current.unit || 'adet').toLowerCase();
        next.unit = allowedUnits.includes(moqUnit) ? moqUnit : allowedUnits[0];
        next.quantity = String(Math.max(1, Number(orderModalItem.minimumOrderQty || 1)));
        return next;
      }

      if (preset === 'target_stock') {
        const desiredBase = Math.max(1, recommendedOrderBaseQty || Math.max(1, Number(orderModalItem.minimumOrderQty || 1)));

        if (current.unit === 'palet') {
          next.quantity = String(Math.max(1, Math.ceil(desiredBase / unitsPerPallet)));
          return next;
        }

        if (current.unit === 'koli' || current.unit === 'kasa' || current.unit === 'çuval') {
          next.quantity = String(Math.max(1, Math.ceil(desiredBase / unitsPerCase)));
          return next;
        }

        next.quantity = String(Math.max(1, Math.ceil(desiredBase)));
      }

      return next;
    });
  };

  useEffect(() => {
    if (!orderModalItem) return;
    const nextDestination = 'SHF-001';
    if (nextDestination === orderForm.arrivalDestination) return;

    setOrderForm((current) => ({
      ...current,
      arrivalDestination: nextDestination,
    }));
  }, [orderForm.arrivalDestination, orderModalItem]);

  useEffect(() => {
    if (!orderModalItem) return;

    const nextEstimatedDate = computeEstimatedDeliveryDate({
      baseLeadDays: orderModalItem.leadTimeDays || 3,
      serviceLevel: orderForm.serviceLevel || 'standard',
    });

    setOrderForm((current) => {
      if (current.deliveryDateMode === 'custom') {
        if (!current.deliveryDate || current.deliveryDate >= nextEstimatedDate) return current;
        return { ...current, deliveryDate: '' };
      }

      if (current.deliveryDate === nextEstimatedDate && current.deliveryDateMode === 'estimated') {
        return current;
      }

      return {
        ...current,
        deliveryDateMode: 'estimated',
        deliveryDate: nextEstimatedDate,
      };
    });
  }, [orderModalItem, orderForm.serviceLevel]);

  const toggleFavoriteOrder = () => {
    if (!orderModalItem || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('shelfio.purchaseFavorites');
      const list = raw ? JSON.parse(raw) : [];
      const arr = Array.isArray(list) ? [...list] : [];
      const index = arr.indexOf(orderModalItem.id);
      if (index >= 0) {
        arr.splice(index, 1);
        setIsFavoriteOrder(false);
      } else {
        arr.push(orderModalItem.id);
        setIsFavoriteOrder(true);
      }
      window.localStorage.setItem('shelfio.purchaseFavorites', JSON.stringify(arr));
    } catch {
      // ignore
    }
  };

  const applyLastOrderTemplate = () => {
    if (!orderModalItem || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('shelfio.purchaseLastOrders');
      const map = raw ? JSON.parse(raw) : {};
      const template = map && map[orderModalItem.id];
      if (!template) return;
      setOrderForm((current) => ({
        ...current,
        ...ORDER_FORM_DEFAULTS,
        ...template,
        // Eski şablonlar için tahmini teslim tarihi moduna geri dön.
        deliveryDateMode: template?.deliveryDateMode || 'estimated',
        deliveryDate: template?.deliveryDate || current.deliveryDate || '',
      }));
    } catch {
      // ignore
    }
  };

  const handleOrderSubmit = async (event) => {
    event.preventDefault();
    if (!orderModalItem) return;

    const quantity = Number(orderForm.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setToast({ type: 'error', title: 'Satın Alma', message: 'Sipariş miktarı pozitif olmalıdır.' });
      return;
    }

    if (!orderForm.unit) {
      setToast({ type: 'error', title: 'Satın Alma', message: 'Sipariş birimi seçilmelidir.' });
      return;
    }

    const allowedUnits = getAllowedProcurementUnits(orderModalItem);
    if (!allowedUnits.includes(String(orderForm.unit).toLowerCase())) {
      setToast({ type: 'error', title: 'Satın Alma', message: 'Seçilen sipariş birimi bu ürün için geçerli değil.' });
      return;
    }

    if (!orderForm.deliveryLocation) {
      setToast({ type: 'error', title: 'Satın Alma', message: 'Teslimat lokasyonu seçilmelidir.' });
      return;
    }

    if (orderModalSupplier?.isActive === false) {
      setToast({ type: 'error', title: 'Satın Alma', message: 'Pasif tedarikçi için sipariş oluşturulamaz.' });
      return;
    }

    if (!orderForm.serviceLevel) {
      setToast({ type: 'error', title: 'Satın Alma', message: 'Teslimat servisi seçilmelidir.' });
      return;
    }

    if (logisticsQuote?.error) {
      setToast({ type: 'error', title: 'Satın Alma', message: logisticsQuote.error });
      return;
    }

    const metrics = computeOrderMetrics({
      quantity,
      unit: orderForm.unit,
      item: orderModalItem,
    });
    if (!metrics || metrics.reason === 'packaging' || metrics.reason === 'price') {
      setToast({ type: 'error', title: 'Satın Alma', message: metrics?.message || 'Sipariş miktarı geçersiz.' });
      return;
    }

    if (metrics.reason === 'min' && orderSubmitMode === 'approval') {
      setToast({
        type: 'error',
        title: 'Satın Alma',
        message: `MOQ altında sipariş onaya gönderilemez. Minimum ${formatNumber(metrics.minQty)} ${String(metrics.minUnit || '').toUpperCase()}.`,
      });
      return;
    }

    if (criticalStockLevel > 0 && postOrderEstimatedTotalStock < criticalStockLevel && orderSubmitMode === 'approval') {
      setToast({
        type: 'error',
        title: 'Satın Alma',
        message: 'Sipariş sonrası stok kritik seviyenin altında kalıyor. Miktarı artırın veya taslak kaydedin.',
      });
      return;
    }

    const criticalGap = criticalStockLevel > 0 ? Math.max(0, criticalStockLevel - currentTotalStock) : 0;
    if (criticalGap > 0 && Number(metrics.quantityBase || 0) < criticalGap && orderSubmitMode === 'approval') {
      setToast({
        type: 'error',
        title: 'Satın Alma',
        message: 'Kritik stok açığı için sipariş miktarı yetersiz. Miktarı artırın veya taslak kaydedin.',
      });
      return;
    }

    const vatRateValue = Number(orderForm.vatRate || 0) || 0;
    const shippingFeeValue = Number(orderForm.shippingFee || 0) || 0;
    const subtotal = Number(metrics.totalPriceWithTier || metrics.totalPrice || 0);
    const vatAmount = Number(((subtotal * vatRateValue) / 100).toFixed(2));
    const grandTotal = Number((subtotal + vatAmount + shippingFeeValue).toFixed(2));

    let deliveryDateIso = null;
    if (orderForm.deliveryDateMode === 'today' || orderForm.deliveryDateMode === 'tomorrow') {
      const base = new Date();
      if (orderForm.deliveryDateMode === 'tomorrow') {
        base.setDate(base.getDate() + 1);
      }
      deliveryDateIso = base.toISOString();
    } else if ((orderForm.deliveryDateMode === 'custom' || orderForm.deliveryDateMode === 'estimated') && orderForm.deliveryDate) {
      const custom = new Date(`${orderForm.deliveryDate}T00:00:00`);
      if (!Number.isNaN(custom.getTime())) {
        deliveryDateIso = custom.toISOString();
      }
    }

    const payload = {
      supplierProductId: orderModalItem.id,
      purchaseSuggestionId: orderModalContext.purchaseSuggestionId || undefined,
      quantity,
      orderUnit: orderForm.unit || orderModalItem.priceUnit || orderModalItem.orderUnit || 'adet',
      note: orderForm.supplierNote || orderForm.operationalNote || '',
      deliveryLocation: orderForm.deliveryLocation,
      deliveryDateMode: orderForm.deliveryDateMode,
      deliveryDate: deliveryDateIso,
      deliveryType: orderForm.deliveryType,
      shippingCarrier: orderForm.shippingCarrier,
      originDestination: orderForm.originDestination,
      arrivalDestination: orderForm.arrivalDestination || deliveryLocationLabel,
      orderType: orderForm.orderType,
      orderReference: orderForm.orderReference || '',
      approvalRequested: orderSubmitMode === 'approval',
      submitMode: orderSubmitMode,
      vatRate: vatRateValue,
      vatAmount,
      shippingFee: shippingFeeValue,
      subtotal,
      grandTotal,
      procurementContext: {
        purchaseSuggestionId: orderModalContext.purchaseSuggestionId || undefined,
        purchaseSuggestionMode: orderModalContext.purchaseSuggestionMode || undefined,
        orderReason: orderForm.orderReason,
        demandSource: orderForm.demandSource,
        demandLevel: orderForm.demandLevel,
        serviceLevel: orderForm.serviceLevel,
        cargoTypeCode: logisticsQuote?.technicalCargoCode || orderForm.shippingCarrier,
        cargoTypeName: logisticsQuote?.technicalCargoLabel || null,
        supplierDispatchDate: orderForm.supplierDispatchDate || null,
        deliveryTimeSlot: orderForm.deliveryTimeSlot || null,
        supplierStockStatus,
        stockSnapshot: {
          warehouse: currentWarehouseStock,
          shelf: currentShelfStock,
          total: currentTotalStock,
          critical: criticalStockLevel,
          target: targetStockLevel,
          postOrderWarehouse: postOrderEstimatedWarehouseStock,
          postOrderTotal: postOrderEstimatedTotalStock,
          estimatedCoverageDays,
        },
        pricingSnapshot: {
          baseUnitPrice: Number(metrics.unitPriceBase || 0),
          appliedTierId: metrics.appliedTierId,
          appliedTierLabel: metrics.appliedTierLabel,
          discountRate: Number(metrics.discountRate || 0),
          discountAmount: Number(metrics.discountAmount || 0),
          subtotal,
          vatRate: vatRateValue,
          vatAmount,
          shippingFee: shippingFeeValue,
          grandTotal,
        },
        manualOverrideTl: null,
        caseQty: logisticsQuote?.caseQty || null,
          logisticsSnapshot: logisticsQuote && !logisticsQuote.error ?
           {
              serviceLevel: orderForm.serviceLevel,
              technicalCargoCode: logisticsQuote.technicalCargoCode,
              technicalCargoLabel: logisticsQuote.technicalCargoLabel,
              caseQty: logisticsQuote.caseQty,
              fee: logisticsQuote.fee,
              reason: logisticsQuote.reason,
              pricingModel: 'case_based_tariff',
            }
          : null,
      },
      operationalNote: orderForm.operationalNote || '',
      supplierNote: orderForm.supplierNote || '',
      procurementNote: orderForm.procurementNote || '',
    };

    console.log('[SupplierProducts] createOrder - payload', {
      payload,
      selectedSupplierProduct: orderModalItem,
      id: orderModalItem.id,
      supplierProductId: orderModalItem.supplierProductId,
    });

    if (!payload.supplierProductId) {
      setToast({
        type: 'error',
        title: 'Satın Alma',
        message: 'Sipariş oluşturmak için geçerli bir tedarikçi-ürün kaydı bulunamadı.',
      });
      return;
    }

    try {
      setOrderSubmitting(true);
      await procurementService.createOrder(payload);

      try {
        if (typeof window !== 'undefined') {
          const raw = window.localStorage.getItem('shelfio.purchaseLastOrders');
          const map = raw ? JSON.parse(raw) : {};
          map[orderModalItem.id] = {
            quantity: String(quantity),
            unit: payload.orderUnit,
            deliveryLocation: orderForm.deliveryLocation,
            deliveryDateMode: orderForm.deliveryDateMode,
            deliveryDate: orderForm.deliveryDate,
            deliveryType: orderForm.deliveryType,
            shippingCarrier: orderForm.shippingCarrier,
            originDestination: orderForm.originDestination,
            arrivalDestination: orderForm.arrivalDestination,
            vatRate: orderForm.vatRate,
            shippingFee: orderForm.shippingFee,
            orderType: orderForm.orderType,
            orderReference: orderForm.orderReference,
            approvalMode: orderForm.approvalMode,
            orderReason: orderForm.orderReason,
            demandSource: orderForm.demandSource,
            demandLevel: orderForm.demandLevel,
            serviceLevel: orderForm.serviceLevel,
            supplierDispatchDate: orderForm.supplierDispatchDate,
            deliveryTimeSlot: orderForm.deliveryTimeSlot,
            procurementNote: orderForm.procurementNote,
          };
          window.localStorage.setItem('shelfio.purchaseLastOrders', JSON.stringify(map));
        }
      } catch {
        // ignore
      }

      setToast({
        type: 'success',
        title: 'Satın Alma',
        message: orderSubmitMode === 'approval' ?
           'Satın alma siparişi onaya gönderildi. Detayları Sipariş Takibi ekranından takip edebilirsiniz.'
          : 'Satın alma siparişi taslak olarak kaydedildi.',
      });

      if (orderModalContext.source === 'catalog' && orderModalContext.cartItemId) {
        setCatalogCart((current) => current.filter((item) => item.id !== orderModalContext.cartItemId));
      }

      setOrderModalItem(null);
      setOrderModalContext({ source: 'compare', cartItemId: null });
      setOrderForm({ ...ORDER_FORM_DEFAULTS });
    } catch (error) {
      console.error('Sipariş ver hatası', error);
      setToast({ type: 'error', title: 'Satın Alma', message: error.message || 'Sipariş oluşturulamadı.' });
    } finally {
      setOrderSubmitting(false);
    }
  };

  const openCreateModal = () => {
    setEditingItem(null);
    setForm(initialForm);
    setIsModalOpen(true);
  };

  const openCreateModalWithSeed = (seed = {}) => {
    setEditingItem(null);

    const product = products.find((item) => toEntityKey(item.id) === toEntityKey(seed.productId));

    setForm({
      ...initialForm,
      productId: seed.productId || '',
      supplierId: seed.supplierId || '',
      barcode: product?.barcode || '',
      supplierProductCode: seed.productId ? makeSupplierProductCode(seed.supplierId || 'SUPP', product?.sku || 'PROD', 0) : '',
    });
    setIsModalOpen(true);
  };

  const openCreateForSelectedProduct = () => {
    if (!selectedProduct) return;
    setEditingItem(null);
    setForm((current) => ({
      ...initialForm,
      productId: selectedProduct.id,
      barcode: selectedProduct.barcode || '',
    }));
    setIsModalOpen(true);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setForm({
      productId: item.productId,
      supplierId: item.supplierId,
      supplierProductName: item.supplierProductName || '',
      supplierSku: item.supplierSku || '',
      supplierProductCode: item.supplierProductCode || '',
      barcode: item.barcode && item.barcode !== '-' ? item.barcode : '',
      purchasePrice: String(item.purchasePrice || ''),
      tierPrice3Case: item.tierPrice3Case != null ? String(item.tierPrice3Case) : '',
      tierPrice10Case: item.tierPrice10Case != null ? String(item.tierPrice10Case) : '',
      tierPrice20Case: item.tierPrice20Case != null ? String(item.tierPrice20Case) : '',
      currency: item.currency || 'TRY',
      priceUnit: item.priceUnit || 'adet',
      minimumOrderQty: String(item.minimumOrderQty || 1),
      minOrderUnit: item.minOrderUnit || item.priceUnit || 'adet',
      orderUnit: item.defaultOrderUnit || item.priceUnit || 'adet',
      leadTimeDays: String(item.leadTimeDays || 3),
      unitsPerPack: String(item.unitsPerPack || 1),
      unitsPerBox: String(item.unitsPerBox || 1),
      unitsPerCase: String(item.unitsPerCase || 1),
      casesPerPallet: String(item.casesPerPallet || 1),
      unitsPerPallet: String(item.unitsPerPallet || 1),
      defaultCargoTypeCode: item.defaultCargoTypeCode || 'standard_intercity',
      supplierLogisticsNote: item.supplierLogisticsNote || '',
      note: item.note || '',
      isPreferred: item.isPreferred === true,
      isActive: item.isActive !== false,
    });
    setIsModalOpen(true);
  };

  useEffect(() => {
    if (isCatalogPage || isLoading) return;
    if (searchParams.get('newMatch') !== '1') return;

    openCreateModalWithSeed({
      productId: searchParams.get('productId') || '',
      supplierId: searchParams.get('supplierId') || '',
    });

    const next = new URLSearchParams(searchParams);
    next.delete('newMatch');
    next.delete('productId');
    next.delete('supplierId');
    setSearchParams(next, { replace: true });
  }, [isCatalogPage, isLoading, searchParams, setSearchParams]);

  useEffect(() => {
    if (isCatalogPage || isLoading) return;
    if (searchParams.get('catalog') !== '1') return;

    setIsCatalogModalOpen(true);

    const next = new URLSearchParams(searchParams);
    next.delete('catalog');
    setSearchParams(next, { replace: true });
  }, [isCatalogPage, isLoading, searchParams, setSearchParams]);

  useEffect(() => {
    if (isCatalogPage || isLoading || isRowsLoading) return;

    const source = searchParams.get('source') || (location.state?.purchaseSuggestionFlow ? 'oneriler' : '');
    if (source !== 'oneriler') return;

    const suggestionPayload = extractPurchaseSuggestionPayload({
      locationState: location.state,
      searchParams,
    });
    const { handoffId, handoff, intent, items: incomingItems } = suggestionPayload;
    const signatureSeed = handoff?.createdAt
      || location.state?.purchaseSuggestionFlow?.createdAt
      || `${location.key}:${intent}:${handoffId}:${incomingItems.map((item) => `${item.suggestionId || item.id || item.productId}:${item.supplierId || ''}`).join('|')}`;
    if (suggestionSupplierLookupSignatureRef.current !== signatureSeed) {
      suggestionSupplierLookupSignatureRef.current = signatureSeed;
      suggestionSupplierLookupRef.current = new Map();
      suggestionSupplierLookupRequestRef.current += 1;
    }
    if (!incomingItems.length) {
      setToast({ type: 'error', title: 'Taslak Açılamadı', message: 'Öneriye bağlı ürün bilgisi bulunamadı. Öneri listesinden yeniden açmayı deneyin.' });
      clearPurchaseSuggestionNavigationContext({ handoffId, removeHandoff: true });
      return;
    }

    const invalidQuantityItems = incomingItems.filter((item) => !isValidSuggestionQuantity(item));
    const candidateItems = intent === 'bulk'
      ? incomingItems.filter((item) => isValidSuggestionQuantity(item))
      : incomingItems;
    const locallyResolvedSelections = candidateItems.map((item) => ({
      suggestion: item,
      row: resolveSuggestionRow(item, rows, products, supplierMap),
    }));
    const unresolvedApiEntries = locallyResolvedSelections.filter((entry) => !isApiSupplierProductRow(entry.row));
    const lookupStore = suggestionSupplierLookupRef.current;
    const pendingLookups = unresolvedApiEntries.filter((entry) => lookupStore.get(getSuggestionLookupKey(entry.suggestion))?.status === 'pending');
    const lookupsToStart = unresolvedApiEntries.filter((entry) => {
      const status = lookupStore.get(getSuggestionLookupKey(entry.suggestion))?.status || '';
      return status !== 'pending' && status !== 'not_found' && status !== 'error';
    });

    if (lookupsToStart.length) {
      const requestId = suggestionSupplierLookupRequestRef.current + 1;
      suggestionSupplierLookupRequestRef.current = requestId;
      setToast({ type: 'info', title: 'Taslak Hazırlanıyor', message: 'Taslak verisi yükleniyor, lütfen bekleyin.' });
      lookupsToStart.forEach((entry) => {
        lookupStore.set(getSuggestionLookupKey(entry.suggestion), { status: 'pending' });
      });
      setSuggestionLookupRevision((value) => value + 1);

      Promise.all(lookupsToStart.map(async (entry) => {
        const key = getSuggestionLookupKey(entry.suggestion);
        try {
          const fetchedRows = await fetchSuggestionSupplierProductRows(entry.suggestion);
          lookupStore.set(key, { status: fetchedRows.length ? 'resolved' : 'not_found' });
          return fetchedRows;
        } catch (error) {
          lookupStore.set(key, { status: 'error', error });
          return [];
        }
      }))
        .then((results) => {
          if (requestId !== suggestionSupplierLookupRequestRef.current) return;
          const mergedRows = results.flat();
          if (mergedRows.length) {
            mergeSupplierProductRows(mergedRows);
          }
          suggestionAutoOpenSignatureRef.current = '';
          setSuggestionLookupRevision((value) => value + 1);
        });
      return;
    }

    if (pendingLookups.length) return;

    if (suggestionAutoOpenSignatureRef.current === signatureSeed) return;
    suggestionAutoOpenSignatureRef.current = signatureSeed;

    const resolvedSelections = candidateItems
      .map((item) => ({
        suggestion: item,
        row: resolveSuggestionRow(item, rows, products, supplierMap),
      }))
      .filter((entry) => (
        isApiSupplierProductRow(entry.row)
      ));

    if (!resolvedSelections.length) {
      const hasLookupError = candidateItems.some((item) => suggestionSupplierLookupRef.current.get(getSuggestionLookupKey(item))?.status === 'error');
      setToast({
        type: 'error',
        title: 'Taslak Açılamadı',
        message: hasLookupError
          ? 'Taslak verisi şu anda alınamadı. Lütfen öneri listesinden tekrar deneyin.'
          : getSuggestionResolveFailureMessage(candidateItems[0], products, supplierMap),
      });
      clearPurchaseSuggestionNavigationContext({ handoffId, removeHandoff: true });
      suggestionAutoOpenSignatureRef.current = '';
      return;
    }

    if (intent === 'single' || (intent === 'manual' && candidateItems.length === 1)) {
      const target = resolvedSelections[0];
      setOrderFlowMode(ORDER_FLOW_MODES.PRODUCT);
      selectProductForComparison(target.row.productId);
      const didOpen = openOrderModal(
        {
          ...target.row,
          purchasePrice: Number(target.suggestion.purchaseUnitPrice ?? target.row.purchasePrice ?? 0) || 0,
        },
        {
          source: 'suggestion',
          initialQuantity: Number(target.suggestion.recommendedQuantity || target.row.minimumOrderQty || 1),
          initialUnit: target.suggestion.orderUnit || target.row.defaultOrderUnit,
          purchaseUnitPrice: target.suggestion.purchaseUnitPrice,
          recommendationReason: target.suggestion.recommendationReason || target.suggestion.reason || '',
          purchaseSuggestionId: target.suggestion.suggestionId || target.suggestion.id || '',
          purchaseSuggestionMode: 'compose_single',
        }
      );
      if (didOpen) {
        clearPurchaseSuggestionNavigationContext({ handoffId, removeHandoff: false });
      } else {
        suggestionAutoOpenSignatureRef.current = '';
      }
      return;
    }

    setOrderFlowMode(ORDER_FLOW_MODES.BULK);
    setOrderModalItem(null);
    setOrderModalContext({ source: 'compare', cartItemId: null });
    setBulkCart([]);

    resolvedSelections.forEach(({ row, suggestion }) => {
      queueBulkItem(
        {
          ...row,
          purchasePrice: Number(suggestion.purchaseUnitPrice ?? row.purchasePrice ?? 0) || 0,
        },
        {
          initialQuantity: Number(suggestion.recommendedQuantity || row.minimumOrderQty || 1),
          initialUnit: suggestion.orderUnit || row.defaultOrderUnit,
          unitPrice: suggestion.purchaseUnitPrice,
          recommendationReason: suggestion.recommendationReason || suggestion.reason || '',
          purchaseSuggestionId: suggestion.suggestionId || suggestion.id || '',
          replaceExisting: true,
        }
      );
    });
    selectProductForComparison(resolvedSelections[0]?.row?.productId || '');
    setBulkNoteTab('operational');
    setIsBulkOrderModalOpen(true);
    clearPurchaseSuggestionNavigationContext({ handoffId, removeHandoff: false });

    const unresolvedCount = candidateItems.length - resolvedSelections.length;
    const skippedCount = unresolvedCount + invalidQuantityItems.length;
    if (skippedCount > 0) {
      setToast({
        type: 'warning',
        title: 'Toplu Sipariş',
        message: `${formatNumber(resolvedSelections.length)} ürün aktarıldı, ${formatNumber(skippedCount)} kayıt atlandı.`,
      });
    }
  }, [
    clearPurchaseSuggestionNavigationContext,
    fetchSuggestionSupplierProductRows,
    isCatalogPage,
    isLoading,
    isRowsLoading,
    location.key,
    location.state,
    mergeSupplierProductRows,
    openOrderModal,
    queueBulkItem,
    products,
    rows,
    searchParams,
    suggestionLookupRevision,
    supplierMap,
  ]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.productId || !form.supplierId || !form.purchasePrice || !form.currency) {
      setToast({ type: 'error', title: 'Tedarikçi Ürünleri', message: 'Ürün, tedarikçi ve fiyat zorunludur.' });
      return;
    }

    const duplicate = rows.find(
      (item) => toEntityKey(item.productId) === toEntityKey(form.productId)
        && item.supplierId === form.supplierId
        && item.id !== editingItem?.id
    );
    if (duplicate) {
      setToast({
        type: 'error',
        title: 'Tedarikçi Ürünleri',
        message: 'Bu ürün ve tedarikçi için zaten bir eşleşme mevcut. Mevcut kaydı düzenleyin.',
      });
      return;
    }

    const selectedProduct = products.find((item) => toEntityKey(item.id) === toEntityKey(form.productId));
    const selectedSupplier = suppliers.find((item) => item.id === form.supplierId);

    const payload = {
      productId: form.productId,
      supplierId: form.supplierId,
      supplierProductName: form.supplierProductName.trim(),
      supplierSku: form.supplierSku.trim(),
      purchasePrice: parseMoneyInput(form.purchasePrice),
      tierPrice3Case: form.tierPrice3Case ? parseMoneyInput(form.tierPrice3Case) : undefined,
      tierPrice10Case: form.tierPrice10Case ? parseMoneyInput(form.tierPrice10Case) : undefined,
      tierPrice20Case: form.tierPrice20Case ? parseMoneyInput(form.tierPrice20Case) : undefined,
      currency: form.currency,
      priceUnit: (form.priceUnit || 'adet').toLowerCase(),
      minimumOrderQty: Number(form.minimumOrderQty || 1),
      minOrderUnit: (form.minOrderUnit || form.priceUnit || 'adet').toLowerCase(),
      defaultOrderUnit: (form.orderUnit || form.priceUnit || 'adet').toLowerCase(),
      leadTimeDays: Number(form.leadTimeDays || 3),
      supplierProductCode: form.supplierProductCode.trim(),
      barcode: form.barcode.trim(),
      note: form.note.trim(),
      unitsPerPack: Number(form.unitsPerPack || 1),
      unitsPerBox: Number(form.unitsPerBox || 1),
      unitsPerCase: Number(form.unitsPerCase || 1),
      casesPerPallet: Number(form.casesPerPallet || 1),
      unitsPerPallet: Number(form.unitsPerPallet || 1),
      defaultCargoTypeCode: String(form.defaultCargoTypeCode || '').trim().toLowerCase(),
      supplierLogisticsNote: String(form.supplierLogisticsNote || '').trim(),
      isActive: form.isActive,
    };

    const enriched = {
      ...payload,
      id: editingItem?.id || `local-sp-${Date.now()}`,
      source: editingItem?.source || 'local',
      productName: selectedProduct?.name || editingItem?.productName || '-',
      productSku: selectedProduct?.sku || editingItem?.productSku || '-',
      supplierProductName: form.supplierProductName.trim() || editingItem?.supplierProductName || '-',
      supplierSku: form.supplierSku.trim() || editingItem?.supplierSku || '-',
      barcode: form.barcode.trim() || selectedProduct?.barcode || editingItem?.barcode || '-',
      supplierName: selectedSupplier?.name || editingItem?.supplierName || '-',
      supplierProductCode: form.supplierProductCode.trim() || makeSupplierProductCode(form.supplierId, selectedProduct?.sku || editingItem?.productSku || '-', 0),
      note: form.note.trim(),
      currency: form.currency,
      priceUnit: (form.priceUnit || 'adet').toLowerCase(),
      minOrderUnit: (form.minOrderUnit || form.priceUnit || 'adet').toLowerCase(),
      defaultOrderUnit: (form.orderUnit || form.priceUnit || 'adet').toLowerCase(),
      unitsPerPack: Number(form.unitsPerPack || 1),
      unitsPerBox: Number(form.unitsPerBox || 1),
      unitsPerCase: Number(form.unitsPerCase || 1),
      casesPerPallet: Number(form.casesPerPallet || 1),
      unitsPerPallet: Number(form.unitsPerPallet || 1),
      defaultCargoTypeCode: String(form.defaultCargoTypeCode || '').trim().toLowerCase(),
      supplierLogisticsNote: String(form.supplierLogisticsNote || '').trim(),
      tierPrice3Case: form.tierPrice3Case ? parseMoneyInput(form.tierPrice3Case) : null,
      tierPrice10Case: form.tierPrice10Case ? parseMoneyInput(form.tierPrice10Case) : null,
      tierPrice20Case: form.tierPrice20Case ? parseMoneyInput(form.tierPrice20Case) : null,
      isPreferred: editingItem?.isPreferred === true,
      lastPriceUpdate: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      setSubmitting(true);

      if (editingItem?.source === 'api') {
        await procurementService.updateSupplierProduct(editingItem.id, payload);
      } else if (!editingItem) {
        try {
          const apiResult = await procurementService.createSupplierProduct(payload);
          enriched.id = apiResult.id;
          enriched.source = 'api';
        } catch {
          enriched.source = 'local';
        }
      }

      if (editingItem) {
        const key = `${editingItem.productId}-${editingItem.supplierId}`;
        const prevPrice = Number(editingItem.purchasePrice || 0);
        const nextPrice = Number(enriched.purchasePrice || 0);
        if (Number.isFinite(prevPrice) && Number.isFinite(nextPrice) && prevPrice !== nextPrice) {
          setPriceHistory((current) => {
            const history = current[key] || [];
            const nextHistory = [...history, { at: enriched.lastPriceUpdate, price: nextPrice }];
            return { ...current, [key]: nextHistory };
          });
        }
      }

      setRows((current) => {
        const nextRows = editingItem ?
           current.map((item) => (item.id === editingItem.id ? { ...item, ...enriched } : item))
          : [...current, enriched];

        if (enriched.isPreferred) {
          return nextRows.map((item) => (toEntityKey(item.productId) === toEntityKey(enriched.productId) ? { ...item, isPreferred: item.id === enriched.id } : item));
        }

        return syncPreferredByProduct(nextRows);
      });

      setToast({ type: 'success', title: 'Tedarikçi Ürünleri', message: editingItem ? 'Eşleşme güncellendi.' : 'Yeni eşleşme oluşturuldu.' });
      setIsModalOpen(false);
      setForm(initialForm);
      setEditingItem(null);
    } catch (error) {
      setToast({ type: 'error', title: 'Tedarikçi Ürünleri', message: error.message || 'İşlem başarısız.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.source === 'api') {
        await procurementService.removeSupplierProduct(deleteTarget.id);
      }
      setRows((current) => current.filter((item) => item.id !== deleteTarget.id));
      setToast({ type: 'success', title: 'Tedarikçi Ürünleri', message: 'Eşleşme silindi.' });
      setDeleteTarget(null);
    } catch (error) {
      setToast({ type: 'error', title: 'Tedarikçi Ürünleri', message: error.message || 'Silme işlemi başarısız.' });
      setDeleteTarget(null);
    }
  };

  const handleOpenCompareModalFromTable = (event, row) => {
    event.preventDefault();
    event.stopPropagation();

    if (!row?.productId) {
      setToast({ type: 'error', title: 'Tedarikçi Ürünleri', message: 'Ürün bilgisi bulunamadı.' });
      return;
    }

    selectProductForComparison(row.productId);
    setIsCompareModalOpen(true);
  };

  const columns = [
    {
      key: 'productName',
      label: 'Ürün',
      render: (row) => (
        <button
          type="button"
          className="text-button"
          onClick={() => selectProductForComparison(row.productId)}
          title="Detay ve karşılaştırma"
        >
          <span>{row.productName}</span>
          {row.productBadge ? <span className="supplier-product-hot-badge">{row.productBadge}</span> : null}
        </button>
      ),
    },
    { key: 'productSku', label: 'SKU' },
    { key: 'barcode', label: 'Barkod' },
    {
      key: 'categoryLabel',
      label: renderColumnLabel('Kategori', 'Ürünün ait olduğu kategori.'),
      render: (row) => row.categoryLabel || '-',
    },
    {
      key: 'brand',
      label: renderColumnLabel('Marka', 'Ürün adından türetilen marka bilgisi.'),
      render: (row) => row.brand || '-',
    },
    {
      key: 'supplierName',
      label: 'Varsayılan Tedarikçi',
      render: (row) => (
        <span className={row.hasDefaultMatch ? '' : 'muted-text'}>
          {row.hasDefaultMatch ? row.supplierName : 'Varsayılan eşleşme yok'}
        </span>
      ),
    },
    {
      key: 'purchasePrice',
      label: 'Alış Fiyatı',
      sortValue: (row) => Number(row.purchasePrice || 0),
      render: (row) => (row.purchasePrice != null ?
         <StatusBadge tone="neutral">{formatCurrency(row.purchasePrice, row.currency)}</StatusBadge>
        : <span className="muted-text">-</span>),
    },
    {
      key: 'totalStock',
      label: renderColumnLabel('Mevcut Stok Adedi', 'Depo ve reyondaki toplam stok miktarı.'),
      sortValue: (row) => Number(row.totalStock || 0),
      render: (row) => (row.totalStock != null ?
         <strong>{formatNumber(row.totalStock)}</strong>
        : <span className="muted-text">-</span>),
    },
    {
      key: 'marginRate',
      label: renderColumnLabel('Kâr Marjı', 'Formül: (satış - alış) / satış'),
      sortValue: (row) => Number(row.marginRate || 0),
      render: (row) => (row.marginRate == null ?
         <span className="muted-text">-</span>
        : <StatusBadge tone={row.marginRate >= 20 ? 'success' : row.marginRate >= 10 ? 'warning' : 'danger'}>%{formatNumber(row.marginRate)}</StatusBadge>),
    },
    {
      key: 'supplierScore',
      label: renderColumnLabel('Tedarikçi Puanı', 'Teslim süresi, fiyat ve doğruluk birleşik puanı.'),
      sortValue: (row) => Number(row.supplierScore || 0),
      render: (row) => (row.supplierScore != null ?
         <StatusBadge tone={row.supplierScore >= 85 ? 'success' : row.supplierScore >= 70 ? 'warning' : 'danger'}>{formatNumber(row.supplierScore)} / 100</StatusBadge>
        : <span className="muted-text">-</span>),
    },
    {
      key: 'leadTimeDays',
      label: 'Teslim Süresi',
      render: (row) => (row.leadTimeDays != null ? `${formatNumber(row.leadTimeDays)} gün` : '-'),
      sortValue: (row) => Number(row.leadTimeDays || 0),
    },
    {
      key: 'teslimatPerformansi',
      label: 'Teslimat',
      render: (row) => {
        const val = getEffectiveDeliveryPerformance(row.teslimatPerformansi);
        const tone = val >= 95 ? 'success' : val >= 90 ? 'warning' : 'danger';
        const label = `${val}%`;
        return <StatusBadge tone={tone}>{label}</StatusBadge>;
      },
      sortValue: (row) => getEffectiveDeliveryPerformance(row.teslimatPerformansi),
    },
    {
      key: 'gecikmeDurumu',
      label: 'Gecikme',
      render: (row) => (row.gecikmeDurumu ?
         <StatusBadge tone={row.gecikmeDurumu === 'düşük' ? 'success' : 'danger'}>{row.gecikmeDurumu}</StatusBadge>
        : <span className="muted-text">-</span>),
    },
    {
      key: 'isActive',
      label: 'Durum',
      render: (row) => <StatusBadge tone={row.isActive ? 'success' : 'danger'}>{row.isActive ? 'Aktif' : 'Pasif'}</StatusBadge>,
      sortable: false,
    },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      render: (row) => (isAdmin ? (
        <div className="table-actions supplier-match-actions">
          <button
            className="text-button supplier-change-button"
            type="button"
            onClick={(event) => handleOpenCompareModalFromTable(event, row)}
          >
            Tedarikçiyi Değiştir
          </button>
        </div>
      ) : <span className="muted-text">Salt okunur</span>),
    },
  ];

  const orderQuantityNumber = Number(orderForm.quantity || 0);
  const hasValidOrderQuantity = Number.isFinite(orderQuantityNumber) && orderQuantityNumber > 0;

  const currentOrderMetrics = orderModalItem && hasValidOrderQuantity ?
     computeOrderMetrics({
        quantity: orderQuantityNumber,
        unit: orderForm.unit,
        item: orderModalItem,
      })
    : null;

  const orderProductStock = orderModalItem ?
     stocks.find((item) => toEntityKey(item.productId) === toEntityKey(orderModalItem.productId)) || null
    : null;

  const orderModalProduct = orderModalItem ?
     productsById.get(toEntityKey(orderModalItem.productId)) || null
    : null;

  const orderModalSupplier = orderModalItem ?
     supplierMap.get(orderModalItem.supplierId) || null
    : null;

  const orderStorageType = String(orderModalProduct?.storageType || orderModalProduct?.storageCondition || '').trim();
  const normalizedOrderStorageType = normalizeStorageType(orderStorageType || orderModalProduct?.requiredStorageType);

  const [logisticsQuote, setLogisticsQuote] = useState(null);
  const [logisticsQuoteError, setLogisticsQuoteError] = useState('');

  // Koli bazlı lojistik hesabı — servis seviyesi kullanıcı seçer, teknik koşul sistem belirler
  useEffect(() => {
    if (!orderModalItem || !currentOrderMetrics || currentOrderMetrics.reason) {
      setLogisticsQuote(null);
      setLogisticsQuoteError('');
      return;
    }

    const quantityBase = Number(currentOrderMetrics.quantityBase || 0);
    if (!Number.isFinite(quantityBase) || quantityBase <= 0) {
      setLogisticsQuote(null);
      setLogisticsQuoteError('');
      return;
    }

    const rawUnitsPerCase = Number(orderModalItem.unitsPerCase || orderModalProduct?.unitsPerCase || 0);
    const serviceLevel = orderForm.serviceLevel || 'standard';
    const localQuote = computeLogisticsQuote({
      totalUnits: quantityBase,
      unitsPerCase: rawUnitsPerCase,
      serviceLevel,
      storageType: normalizedOrderStorageType,
    });

    if (localQuote.error || !localQuote.technicalCargoCode) {
      setLogisticsQuote(localQuote);
      setLogisticsQuoteError(localQuote.error || '');
      return;
    }

    let cancelled = false;
    procurementService.getLogisticsQuote({
      cargoTypeCode: localQuote.technicalCargoCode,
      lineItems: [{
        quantity: quantityBase,
        orderUnit: 'adet',
        unitsPerCase: rawUnitsPerCase,
        storageType: normalizedOrderStorageType,
      }],
      storageType: normalizedOrderStorageType,
      distanceType: localQuote.technicalCargoCode === 'store_transfer' ? 'internal_transfer' : 'intercity',
      isInternalTransfer: localQuote.technicalCargoCode === 'store_transfer',
    }).then((quote) => {
      if (cancelled) return;
      const result = {
        ...localQuote,
        fee: Number(quote?.totalPriceTl || 0),
        caseQty: quote?.caseQty ?? localQuote.caseQty,
        technicalCargoCode: quote?.cargoTypeCode || localQuote.technicalCargoCode,
        technicalCargoLabel: quote?.cargoTypeName || localQuote.technicalCargoLabel,
        calculationMethod: quote?.calculationMethod,
        bandLabel: quote?.appliedBand ? `${quote.appliedBand.caseQtyMin}-${quote.appliedBand.caseQtyMax || '+'} koli` : '',
        reason: `${quote?.cargoTypeName || localQuote.technicalCargoLabel}: ${quote?.caseQty ?? localQuote.caseQty} koli için tarife hesaplandı.`,
        error: null,
      };
      setLogisticsQuote(result);
      setLogisticsQuoteError('');
      setOrderForm((current) => {
        const currentFee = Number(current.shippingFee || 0);
        if (Math.abs(currentFee - result.fee) >= 0.01) {
          return { ...current, shippingFee: String(result.fee), shippingCarrier: result.technicalCargoCode || current.shippingCarrier };
        }
        return current;
      });
    }).catch((quoteError) => {
      if (cancelled) return;
      setLogisticsQuote({ ...localQuote, error: quoteError.message || 'Kargo hesaplanamadı.' });
      setLogisticsQuoteError(quoteError.message || 'Kargo hesaplanamadı.');
    });

    return () => {
      cancelled = true;
    };
  }, [
    orderModalItem,
    orderModalProduct,
    currentOrderMetrics,
    orderForm.serviceLevel,
    normalizedOrderStorageType,
  ]);

  const categoryLabel = CATEGORY_LABELS[orderModalProduct?.categoryId] || orderModalProduct?.category || '-';
  const supplierCode = orderModalSupplier?.code || orderModalSupplier?.supplierCode || orderModalItem?.supplierId || '-';
  const supplierStockStatus = useMemo(() => {
    const lead = Number(orderModalItem?.leadTimeDays || 0) || 0;
    const performance = getEffectiveDeliveryPerformance(orderModalSupplier?.teslimatPerformansi);

    if (performance >= 95 && lead <= 2) return 'Yüksek';
    if (performance >= 88 && lead <= 4) return 'Orta';
    return 'Sınırlı';
  }, [orderModalItem?.leadTimeDays, orderModalSupplier?.teslimatPerformansi]);

  const currentTotalStock = Number(orderProductStock?.totalStock || orderProductStock?.quantity || 0) || 0;
  const currentWarehouseStock = Number(orderProductStock?.warehouseStock || orderProductStock?.warehouseQuantity || 0) || 0;
  const currentShelfStock = Number(orderProductStock?.shelfStock || orderProductStock?.shelfQuantity || 0) || 0;
  const criticalStockLevel = Number(orderProductStock?.criticalStock || orderModalProduct?.criticalStock || 0) || 0;
  const targetStockLevel = Number(orderModalProduct?.targetStock || (criticalStockLevel > 0 ? (criticalStockLevel * 2) : 100)) || 100;

  const recommendedOrderBaseQty = Math.max(0, Math.ceil(targetStockLevel - currentTotalStock));
  const postOrderEstimatedTotalStock = currentOrderMetrics?.quantityBase ?
     Math.max(0, Math.round(currentTotalStock + Number(currentOrderMetrics.quantityBase || 0)))
    : currentTotalStock;
  const postOrderEstimatedWarehouseStock = currentOrderMetrics?.quantityBase ?
     Math.max(0, Math.round(currentWarehouseStock + Number(currentOrderMetrics.quantityBase || 0)))
    : currentWarehouseStock;
  const estimatedCoverageDays = useMemo(() => {
    const demand = Number(
      orderModalProduct?.avgDailyDemand
      || orderModalProduct?.dailyDemand
      || orderProductStock?.dailyDemand
      || 0
    );

    if (!Number.isFinite(demand) || demand <= 0) return null;
    return Number((postOrderEstimatedTotalStock / demand).toFixed(1));
  }, [orderModalProduct, orderProductStock, postOrderEstimatedTotalStock]);

  const allowedOrderUnits = useMemo(() => (
    orderModalItem ? getAllowedProcurementUnits(orderModalItem) : ['adet']
  ), [orderModalItem]);

  const pricingSummary = useMemo(() => {
    if (!currentOrderMetrics || currentOrderMetrics.reason) return null;
    const vatRateNum = Number(orderForm.vatRate || 0) || 0;
    const shippingValue = Number(orderForm.shippingFee || 0) || 0;
    const subtotal = Number(currentOrderMetrics.totalPriceWithTier || currentOrderMetrics.totalPrice || 0);
    const discount = Number(currentOrderMetrics.discountAmount || 0);
    const vatAmount = Number(((subtotal * vatRateNum) / 100).toFixed(2));
    const grandTotal = Number((subtotal + vatAmount + shippingValue).toFixed(2));

    return {
      subtotal,
      discount,
      vatRateNum,
      vatAmount,
      shippingValue,
      grandTotal,
    };
  }, [currentOrderMetrics, orderForm.shippingFee, orderForm.vatRate]);

  const pricePreviewMetrics = orderModalItem ?
     computeOrderMetrics({
        quantity: 1,
        unit: orderModalItem.priceUnit || orderModalItem.orderUnit || 'adet',
        item: orderModalItem,
      })
    : null;

  let catalogModalLines = [];
  catalogModalLines = useMemo(() => {
    if (orderModalContext.source !== 'catalog') return [];

    return catalogCart.map((cartItem) => {
      const sourceRow = catalogEnrichedRows.find((row) => row.id === cartItem.id)
        || rows.find((row) => row.id === cartItem.id)
        || null;

      const line = {
        id: cartItem.id,
        productId: cartItem.productId || sourceRow?.productId || '',
        productName: cartItem.productName || sourceRow?.productName || '-',
        productSku: cartItem.productSku || sourceRow?.productSku || '-',
        supplierName: cartItem.supplierName || sourceRow?.supplierName || '-',
        quantity: Number(cartItem.quantity || 0),
        unit: cartItem.unit || sourceRow?.orderUnit || sourceRow?.priceUnit || 'adet',
        unitPrice: Number(cartItem.unitPrice || sourceRow?.purchasePrice || 0),
        minimumOrderQty: Number(cartItem.minimumOrderQty || sourceRow?.minimumOrderQty || 1),
        minOrderUnit: cartItem.minOrderUnit || sourceRow?.minOrderUnit || sourceRow?.priceUnit || 'adet',
        currency: cartItem.currency || sourceRow?.currency || orderModalItem?.currency || 'TRY',
        unitsPerPack: Number(cartItem.unitsPerPack || sourceRow?.unitsPerPack || 1),
        unitsPerBox: Number(cartItem.unitsPerBox || sourceRow?.unitsPerBox || sourceRow?.unitsPerCase || 1),
        unitsPerCase: Number(cartItem.unitsPerCase || sourceRow?.unitsPerCase || 1),
        unitsPerPallet: Number(cartItem.unitsPerPallet || sourceRow?.unitsPerPallet || 1),
        casesPerPallet: Number(cartItem.casesPerPallet || sourceRow?.casesPerPallet || 1),
      };
      return enrichLineWithMetrics(line);
    });
  }, [catalogCart, catalogEnrichedRows, orderModalContext.source, orderModalItem?.currency, rows]);

  const catalogModalSummary = useMemo(() => {
    if (!catalogModalLines.length) return null;

    const subtotal = catalogModalLines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
    const vatRateNum = Number(orderForm.vatRate || 0) || 0;
    const shippingValue = Number(orderForm.shippingFee || 0) || 0;
    const vatAmount = Number(((subtotal * vatRateNum) / 100).toFixed(2));
    const grandTotal = Number((subtotal + vatAmount + shippingValue).toFixed(2));
    const currency = catalogModalLines[0]?.currency || orderModalItem?.currency || 'TRY';

    return {
      subtotal,
      vatRateNum,
      vatAmount,
      shippingValue,
      grandTotal,
      currency,
    };
  }, [catalogModalLines, orderForm.shippingFee, orderForm.vatRate, orderModalItem?.currency]);

  const orderReviewLines = useMemo(() => {
    if (orderModalContext.source === 'catalog' && catalogModalLines.length) {
      return catalogModalLines.map((line) => ({
        ...line,
        lineTotal: Number(line.lineTotal || 0),
      }));
    }

    if (!orderModalItem) return [];

    const fallbackQuantity = Number(orderForm.quantity || 0);
    const fallbackUnitPrice = Number(pricePreviewMetrics?.unitPriceBase || orderModalItem.purchasePrice || 0);

    return [{
      id: orderModalItem.id || 'single-order-line',
      productId: orderModalItem.productId || '',
      productName: orderModalItem.productName || '-',
      productSku: orderModalItem.productSku || '-',
      supplierName: orderModalItem.supplierName || '-',
      quantity: fallbackQuantity,
      unit: orderForm.unit || orderModalItem.orderUnit || orderModalItem.priceUnit || 'adet',
      unitPrice: fallbackUnitPrice,
      currency: orderModalItem.currency || 'TRY',
      lineTotal: Number(pricingSummary?.subtotal || 0),
      quantityBase: Number(currentOrderMetrics?.quantityBase || 0),
      baseUnit: String(currentOrderMetrics?.baseUnit || 'adet'),
      unitPriceBase: Number(currentOrderMetrics?.unitPriceBase || fallbackUnitPrice || 0),
    }];
  }, [
    catalogModalLines,
    orderForm.quantity,
    orderForm.unit,
    orderModalContext.source,
    orderModalItem,
    pricePreviewMetrics?.unitPriceBase,
    pricingSummary?.subtotal,
    currentOrderMetrics?.baseUnit,
    currentOrderMetrics?.quantityBase,
    currentOrderMetrics?.unitPriceBase,
  ]);

  const orderReviewSummary = useMemo(() => {
    const lines = orderReviewLines.filter((line) => line && line.id);
    const productCount = lines.length;
    const supplierCount = new Set(
      lines
        .map((line) => String(line.supplierName || '').trim())
        .filter(Boolean)
    ).size;
    const totalQuantity = lines.reduce((sum, line) => sum + (Number(line.quantityBase) || Number(line.quantity) || 0), 0);
    const currency = lines[0]?.currency || orderModalItem?.currency || 'TRY';
    const generalTotal = orderModalContext.source === 'catalog' ?
       Number(catalogModalSummary?.grandTotal || 0)
      : Number(pricingSummary?.grandTotal || 0);

    return {
      productCount,
      supplierCount,
      totalQuantity,
      generalTotal,
      currency,
    };
  }, [
    catalogModalSummary?.grandTotal,
    orderModalContext.source,
    orderModalItem?.currency,
    orderReviewLines,
    pricingSummary?.grandTotal,
  ]);

  const reviewCartQuantityByProductId = useMemo(() => {
    const qtyMap = new Map();
    orderReviewLines.forEach((line) => {
      const key = toEntityKey(line?.productId);
      if (!key) return;
      const current = Number(qtyMap.get(key) || 0);
      qtyMap.set(key, current + getResolvedLineBaseQuantity(line));
    });
    return qtyMap;
  }, [orderReviewLines]);

  const activeOrderModalMode = orderModalContext.source === 'catalog' ?
     PURCHASE_MODAL_MODES.CATALOG_CHECKOUT
    : PURCHASE_MODAL_MODES.SINGLE_PURCHASE;

  const isCatalogCheckoutModal = activeOrderModalMode === PURCHASE_MODAL_MODES.CATALOG_CHECKOUT;
  const isCatalogBulkContext = isCatalogCheckoutModal
    && (orderReviewSummary.productCount > 1 || orderReviewSummary.supplierCount > 1);
  const isSingleOrderContext = !isCatalogCheckoutModal || !isCatalogBulkContext;

  const orderModalTitle = isCatalogCheckoutModal ?
     'Satın Alma Siparişini Onaya Gönder (Katalog İçi)'
    : 'Tekli Satın Alım';

  const orderModalDescription = isCatalogCheckoutModal ?
     (isCatalogBulkContext ?
       'Katalogdan seçilen ürünleri tedarikçi bazlı siparişlere bölerek onaya gönderin.'
      : 'Katalogdan seçilen ürünü tekli satın alım akışında onaya gönderin.')
    : 'Tek ürün ve tek tedarikçi için satın alım detaylarını doğrulayarak onaya gönderin.';

  const singleHeroUnitPrice = useMemo(() => {
    if (!orderModalItem) return 0;
    const metrics = computeOrderMetrics({ quantity: 1, unit: 'adet', item: orderModalItem });
    if (Number.isFinite(metrics?.totalPriceWithTier) && Number(metrics.totalPriceWithTier) > 0) {
      return Number(metrics.totalPriceWithTier);
    }
    if (Number.isFinite(metrics?.totalPrice) && Number(metrics.totalPrice) > 0) {
      return Number(metrics.totalPrice);
    }
    return Number(orderModalItem.purchasePrice || 0) || 0;
  }, [orderModalItem]);

  const singleHeroCasePrice = useMemo(() => {
    if (!orderModalItem) return 0;
    const caseMetrics = computeOrderMetrics({ quantity: 1, unit: 'koli', item: orderModalItem });
    if (Number.isFinite(caseMetrics?.totalPriceWithTier) && Number(caseMetrics.totalPriceWithTier) > 0) {
      return Number(caseMetrics.totalPriceWithTier);
    }
    if (Number.isFinite(caseMetrics?.totalPrice) && Number(caseMetrics.totalPrice) > 0) {
      return Number(caseMetrics.totalPrice);
    }
    const unitPrice = Number(orderModalItem.purchasePrice || 0) || 0;
    const unitsPerCase = Math.max(1, Number(orderModalItem.unitsPerCase || 1));
    return Number((unitPrice * unitsPerCase).toFixed(2));
  }, [orderModalItem]);

  const shouldShowCreateOrderLoading = false;

  const catalogInfoSnapshot = useMemo(() => {
    if (!catalogInfoTarget) return null;

    const sameProductRows = catalogEnrichedRows.filter(
      (row) => String(row.productId || '') === String(catalogInfoTarget.productId || '')
    );

    const lastPurchaseRow = [...sameProductRows]
      .sort((left, right) => new Date(right.lastPriceUpdate || right.updatedAt || 0).getTime() - new Date(left.lastPriceUpdate || left.updatedAt || 0).getTime())[0]
      || catalogInfoTarget;

    const warehouseStock = Number(catalogInfoTarget.catalogWarehouseStock || 0);
    const shelfStock = Number(catalogInfoTarget.catalogShelfStock || 0);
    const totalStock = Number(catalogInfoTarget.catalogTotalStock || (warehouseStock + shelfStock));
    const warehouseCapacityLimit = Number(catalogInfoTarget.catalogWarehouseCapacityLimit || 0);
    const shelfCapacityLimit = Number(catalogInfoTarget.catalogShelfCapacityLimit || 0);
    const maxPurchasable = Number(catalogInfoTarget.catalogMaxPurchasableByCapacity || 0);

    return {
      productName: catalogInfoTarget.productName,
      productSku: catalogInfoTarget.productSku,
      supplierName: lastPurchaseRow?.supplierName || '-',
      lastPurchaseDate: lastPurchaseRow?.lastPriceUpdate || lastPurchaseRow?.updatedAt || null,
      lastPurchasePrice: Number(lastPurchaseRow?.catalogCurrentPrice || lastPurchaseRow?.purchasePrice || 0),
      currency: lastPurchaseRow?.currency || catalogInfoTarget.currency || 'TRY',
      warehouseStock,
      shelfStock,
      totalStock,
      warehouseCapacityLimit,
      shelfCapacityLimit,
      maxPurchasable,
    };
  }, [catalogEnrichedRows, catalogInfoTarget]);

  const activeCatalogSupplier = useMemo(
    () => suppliers.find((item) => String(item.id || '') === String(catalogSupplierId || ''))
      || catalogSupplierOptions.find((item) => String(item.id || '') === String(catalogSupplierId || ''))
      || null,
    [catalogSupplierId, catalogSupplierOptions, suppliers],
  );

  const hasSelectedCatalogSupplier = Boolean(catalogSupplierId);
  const supplierName = activeCatalogSupplier?.name || 'Tedarikçi seçin';

  const supplierCatalogRows = useMemo(
    () => (hasSelectedCatalogSupplier ? catalogSortedRows : []),
    [catalogSortedRows, hasSelectedCatalogSupplier],
  );

  const catalogDisplayPageItems = useMemo(
    () => (hasSelectedCatalogSupplier ? catalogPageItems : []),
    [catalogPageItems, hasSelectedCatalogSupplier],
  );

  const catalogDisplayFocusedRow = useMemo(
    () => (hasSelectedCatalogSupplier ? (catalogFocusedRow || null) : null),
    [catalogFocusedRow, hasSelectedCatalogSupplier],
  );

  const catalogDisplayCart = useMemo(
    () => (hasSelectedCatalogSupplier ? catalogCart : []),
    [catalogCart, hasSelectedCatalogSupplier],
  );

  const supplierCatalogLastUpdate = useMemo(
    () => (supplierCatalogRows.length ?
       supplierCatalogRows.reduce((latest, row) => {
          const ts = new Date(row.lastPriceUpdate || row.updatedAt).getTime();
          return ts > latest ? ts : latest;
        }, 0)
      : null),
    [supplierCatalogRows],
  );

  const supplierAverageLeadTime = useMemo(
    () => (supplierCatalogRows.length ?
       supplierCatalogRows.reduce((sum, row) => sum + Number(row.leadTimeDays || 0), 0) / supplierCatalogRows.length
      : null),
    [supplierCatalogRows],
  );

  const supplierMinOrderAmount = useMemo(
    () => (supplierCatalogRows.length ?
       supplierCatalogRows.reduce((min, row) => {
          const qty = Number(row.minimumOrderQty || 0) || 0;
          const price = Number(row.catalogCurrentPrice || row.purchasePrice || 0) || 0;
          if (!qty || !price) return min;
          const total = qty * price;
          if (min === null) return total;
          return total < min ? total : min;
        }, null)
      : null),
    [supplierCatalogRows],
  );

  const supplierRating = useMemo(() => {
    const supplierRatingRaw = activeCatalogSupplier?.teslimatPerformansi;
    if (!supplierRatingRaw) return null;
    const numeric = Number(String(supplierRatingRaw).replace('%', '').replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return Math.min(Math.max(numeric / 20, 1), 5);
  }, [activeCatalogSupplier?.teslimatPerformansi]);

  const supplierCategoryCount = useMemo(
    () => new Set(supplierCatalogRows.map((row) => row.catalogCategoryId).filter(Boolean)).size,
    [supplierCatalogRows],
  );

  const inStockCount = useMemo(
    () => supplierCatalogRows.filter((row) => row.catalogInStock).length,
    [supplierCatalogRows],
  );

  const discountCount = useMemo(
    () => supplierCatalogRows.filter((row) => row.catalogHasDiscount).length,
    [supplierCatalogRows],
  );

  const cartLineCount = catalogDisplayCart.length;
  const cartTotalQuantity = useMemo(
    () => catalogDisplayCart.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    [catalogDisplayCart],
  );
  const cartTotalAmount = useMemo(
    () => catalogDisplayCart.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0),
    [catalogDisplayCart],
  );
  const cartAverageLeadTime = useMemo(
    () => (cartTotalQuantity > 0 ?
       catalogDisplayCart.reduce((sum, item) => sum + (Number(item.leadTimeDays || 0) * Number(item.quantity || 0)), 0) / cartTotalQuantity
      : null),
    [cartTotalQuantity, catalogDisplayCart],
  );

  const activeCatalogFilterCount = useMemo(
    () => [
      Boolean(catalogCategoryId),
      String(catalogFilters.priceMin || '').trim().length > 0,
      String(catalogFilters.priceMax || '').trim().length > 0,
      Boolean(catalogFilters.inStockOnly),
      Boolean(catalogFilters.discountOnly),
      Boolean(catalogFilters.quickDeliveryOnly),
      Boolean(catalogFilters.bestPriceOnly),
      Boolean(catalogFilters.highScoreOnly),
      catalogSort !== 'priceAsc',
    ].filter(Boolean).length,
    [catalogCategoryId, catalogFilters, catalogSort],
  );

  const supplierInactive = activeCatalogSupplier && activeCatalogSupplier.isActive === false;

  const renderCatalogWorkspace = ({ inModal = false } = {}) => (
    <>
      {!inModal ? (
        <PageHeader
          className="dashboard-hero"
          icon={<ShoppingBag size={22} />}
          title="Tedarikçi Kataloğu"
          description="Tedarikçi ürünlerini inceleyin, sepetten sipariş oluşturup onaya gönderin."
        />
      ) : null}

      <div className={`proc-catalog-toolbar mod-card ${hasSelectedCatalogSupplier ? 'has-selected-supplier' : 'is-empty'}`}>
        <div className="proc-catalog-toolbar-top">
          <div className="proc-catalog-toolbar-left">
            <div className="proc-catalog-toolbar-supplier-selector" aria-label="Tedarikçi seçimi">
              <div className="proc-catalog-toolbar-supplier-icon" aria-hidden="true"><Truck size={16} /></div>
              <SearchableCombobox
                options={catalogSupplierComboboxOptions}
                value={catalogSupplierId}
                onChange={(nextValue) => {
                  setCatalogSupplierId(nextValue);
                  setCatalogPageIndex(0);
                  setCatalogDraftQtyById({});
                  setCatalogFocusedRowId('');
                }}
                placeholder="Tedarikçi seçin"
                noResultsText="Tedarikçi bulunamadı"
                ariaLabel="Tedarikçi seçimi"
                disabled={isLoading}
              />
            </div>
          </div>

          <div className="proc-catalog-toolbar-meta" aria-label="Katalog özeti">
            <span className="proc-catalog-badge soft">Toplam ürün: {formatNumber(supplierCatalogRows.length)}</span>
            <span className="proc-catalog-badge success">Sepet satırı: {formatNumber(cartLineCount)}</span>
          </div>

          <div className="proc-catalog-toolbar-right">
            <button
              type="button"
              className="ghost-button"
              onClick={handleExportCatalogPdf}
              disabled={!hasSelectedCatalogSupplier || catalogPdfExporting}
            >
              {catalogPdfExporting ? 'PDF hazırlanıyor...' : 'PDF Katalog İndir'}
            </button>
          </div>
        </div>

        <div className="proc-catalog-toolbar-filter-panel">
          <div className="proc-catalog-toolbar-filter-head">
            <p>{activeCatalogFilterCount > 0 ? `${formatNumber(activeCatalogFilterCount)} aktif filtre uygulanıyor.` : 'Tüm ürünler gösteriliyor.'}</p>
          </div>

          <SupplierCatalogFilters
            compact
            catalogCategoryId={catalogCategoryId}
            setCatalogCategoryId={(value) => {
              setCatalogCategoryId(value);
              setCatalogPageIndex(0);
            }}
            catalogCategoryOptions={catalogCategoryOptions}
            catalogFilters={catalogFilters}
            setCatalogFilters={(updater) => {
              setCatalogFilters((current) => {
                const next = typeof updater === 'function' ? updater(current) : updater;
                return next;
              });
              setCatalogPageIndex(0);
            }}
            catalogSort={catalogSort}
            setCatalogSort={(value) => {
              setCatalogSort(value);
              setCatalogPageIndex(0);
            }}
            onReset={handleResetCatalogFilters}
            activeFilterCount={activeCatalogFilterCount}
            disabled={!hasSelectedCatalogSupplier}
          />
        </div>
      </div>

      {hasSelectedCatalogSupplier ? (
        <div className="proc-catalog-layout">
          <div className="proc-catalog-sidebar-stack">
            <SupplierSidebar
              supplierName={supplierName}
              supplierAverageLeadTime={supplierAverageLeadTime}
              supplierRating={supplierRating}
              supplierMinOrderAmount={supplierMinOrderAmount}
              supplierCatalogRows={supplierCatalogRows}
              supplierCategoryCount={supplierCategoryCount}
              inStockCount={inStockCount}
              discountCount={discountCount}
              supplierCatalogLastUpdate={supplierCatalogLastUpdate}
            />
          </div>

          <section className="proc-catalog-main">
            <SupplierProductGrid
              isLoading={isLoading || isRowsLoading}
              rows={supplierCatalogRows}
              pageRows={catalogDisplayPageItems}
              focusedId={catalogDisplayFocusedRow?.id}
              cart={catalogDisplayCart}
              resolveQty={resolveCatalogDraftQty}
              getMinQty={getCatalogDefaultQty}
              canOrder={isAdmin && !supplierInactive}
              onSelect={setCatalogFocusedRowId}
              onAdjustQty={adjustCatalogDraftQty}
              onQtyChange={setCatalogDraftQty}
              onAdd={handleAddCatalogRow}
              onInfo={setCatalogInfoTarget}
              onResetFilters={handleResetCatalogFilters}
            />

            <div className="proc-catalog-page-tools">
              <div className="proc-catalog-page-summary">
                <button type="button" className="ghost-button" onClick={handleCatalogPrevPage} disabled={safeCatalogPageIndex === 0}>Önceki</button>
                <span className="table-pagination-total">Sayfa {safeCatalogPageIndex + 1} / {catalogTotalPages}</span>
                <button type="button" className="ghost-button" onClick={handleCatalogNextPage} disabled={safeCatalogPageIndex + 1 >= catalogTotalPages}>Sonraki</button>
              </div>
              <div className="proc-catalog-jump-inline table-pagination-actions">
                <input
                  className="table-page-input"
                  type="number"
                  min="1"
                  max={catalogTotalPages}
                  value={catalogPageInput}
                  onChange={(event) => setCatalogPageInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleCatalogJumpToPage(catalogPageInput);
                  }}
                />
                <button type="button" className="primary-button" onClick={() => handleCatalogJumpToPage(catalogPageInput)}>Git</button>
              </div>
            </div>
          </section>

          <SupplierCatalogCartPanel
            cart={catalogDisplayCart}
            cartLineCount={cartLineCount}
            cartTotalQuantity={cartTotalQuantity}
            cartTotalAmount={cartTotalAmount}
            cartAverageLeadTime={cartAverageLeadTime}
            handleAdjustCatalogCartQty={handleAdjustCatalogCartQty}
            handleUpdateCatalogCartQty={handleUpdateCatalogCartQty}
            handleRemoveCatalogRow={handleRemoveCatalogRow}
            handleClearCatalogCart={handleClearCatalogCart}
            handleOrderSelectedFromCatalog={handleOrderSelectedFromCatalog}
            orderSubmitting={orderSubmitting}
          />
        </div>
      ) : (
        <div className="mod-card">
          <SupplierCatalogEmptyState
            icon={<Truck size={28} />}
            title="Kataloğu görüntülemek için tedarikçi seçin"
            description="Liste ve filtreler, tedarikçi seçiminin ardından aktif olur."
          />
        </div>
      )}
    </>
  );

  if (isCatalogPage) {
    return (
      <div className="page-stack proc-catalog-workspace">
        <Toast toast={toast} onClose={() => setToast(null)} />

        {renderCatalogWorkspace({ inModal: false })}
      </div>
    );
  }

  if (shouldShowCreateOrderLoading) {
    return (
      <div className="page-stack">
        <Toast toast={toast} onClose={() => setToast(null)} />
        <PageHeader
          className="dashboard-hero"
          icon={<Wallet size={22} />}
          title="Sipariş Oluştur"
          description="Ürün bazlı tedarikçi karşılaştırması ile hızlı ve kontrollü satın alma siparişi oluşturun."
        />
        <div className="mod-card supplier-create-loading-state" role="status" aria-live="polite" aria-busy="true">
          <div className="supplier-create-loading-body">
            <span className="loader" aria-hidden="true"></span>
            <span className="supplier-create-loading-text">İşlemler yükleniyor...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`page-stack ${isCatalogPage ? 'supplier-catalog-page' : 'supplier-create-page'}`}>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageHeader
        className="dashboard-hero"
        icon={isCatalogPage ? <ShoppingBag size={22} /> : <Wallet size={22} />}
        title={isCatalogPage ? 'Katalog' : 'Sipariş Oluştur'}
        description={isCatalogPage ?
           'Tedarikçi bazlı fiyat kataloğunu görüntüleyin ve dışarıya aktarın.'
          : 'Ürün bazlı tedarikçi karşılaştırması ile hızlı ve kontrollü satın alma siparişi oluşturun.'}
      />

      {!isCatalogPage && (
        <div className="supplier-order-mode-strip" role="group" aria-label="Sipariş mod seçimi">
          <span className="supplier-order-mode-label">Mod Seçimi</span>
          <div className="supplier-order-mode-toggle" role="tablist" aria-label="Sipariş modu">
              <button
                type="button"
                role="tab"
                aria-selected={!isCatalogModalOpen && orderFlowMode === ORDER_FLOW_MODES.PRODUCT}
                className={`supplier-order-mode-button ${!isCatalogModalOpen && orderFlowMode === ORDER_FLOW_MODES.PRODUCT ? 'active' : ''}`}
                onClick={() => setOrderFlowMode(ORDER_FLOW_MODES.PRODUCT)}
              >
                <Package className="supplier-order-mode-button-icon" size={15} aria-hidden="true" />
                <span className="supplier-order-mode-button-content">
                  <strong>Ürün Bazlı</strong>
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!isCatalogModalOpen && orderFlowMode === ORDER_FLOW_MODES.BULK}
                className={`supplier-order-mode-button ${!isCatalogModalOpen && orderFlowMode === ORDER_FLOW_MODES.BULK ? 'active' : ''}`}
                onClick={() => setOrderFlowMode(ORDER_FLOW_MODES.BULK)}
              >
                <Boxes className="supplier-order-mode-button-icon" size={15} aria-hidden="true" />
                <span className="supplier-order-mode-button-content">
                  <strong>Çoklu Sipariş</strong>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={isCatalogModalOpen}
                className={`supplier-order-mode-button ${isCatalogModalOpen ? 'active' : ''}`}
                onClick={() => setIsCatalogModalOpen(true)}
              >
                <ShoppingBag className="supplier-order-mode-button-icon" size={15} aria-hidden="true" />
                <span className="supplier-order-mode-button-content">
                  <strong>Katalog</strong>
                </span>
              </button>
            </div>
        </div>
      )}

      {/* Özet kartlar kaldırıldı */}
      {viewMode === 'card' && (
        <div className="supplier-create-workspace" aria-label="Sipariş oluştur çalışma alanı">
          <div className="mod-card supplier-product-section supplier-create-left-panel">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-indigo"><Package size={18} /></div>
              <div>
                <h3>Ürün Seçimi</h3>
                <p>Ürün adı, SKU veya barkod ile arayın; seçilen ürün bilgileri aşağıda görüntülenir.</p>
              </div>
            </div>
            <div className="supplier-product-compact-flow">
              <div className="supplier-product-search-box" role="search" ref={productSearchBoxRef}>
                <div className="supplier-product-search-input-wrap">
                  <input
                    value={productSearchInput}
                    onChange={(event) => {
                      setProductSearchInput(event.target.value);
                      setIsProductSearchOpen(true);
                      setHighlightedProductIndex(-1);
                    }}
                    onFocus={() => {
                      setIsProductSearchOpen(true);
                      setHighlightedProductIndex(-1);
                    }}
                    onKeyDown={(event) => {
                      if (!isProductSearchOpen) return;
                      if (event.key === 'Escape') {
                        setIsProductSearchOpen(false);
                        setHighlightedProductIndex(-1);
                        return;
                      }
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        if (!visibleProductSearchResults.length) return;
                        setHighlightedProductIndex((current) => (current + 1) % visibleProductSearchResults.length);
                        return;
                      }
                      if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        if (!visibleProductSearchResults.length) return;
                        setHighlightedProductIndex((current) => {
                          if (current <= 0) return visibleProductSearchResults.length - 1;
                          return current - 1;
                        });
                        return;
                      }
                      if (event.key === 'Enter' && highlightedProductIndex >= 0 && visibleProductSearchResults[highlightedProductIndex]) {
                        event.preventDefault();
                        const item = visibleProductSearchResults[highlightedProductIndex];
                        selectProductForComparison(item.id);
                        setProductSearchInput('');
                        setProductSearch('');
                        setIsProductSearchOpen(false);
                        setHighlightedProductIndex(-1);
                      }
                    }}
                    placeholder="Ürün, SKU, kategori veya tedarikçi ara"
                    aria-label="Ürün ara"
                  />
                </div>

                {isProductSearchOpen && productSearchInput.trim() && !isLoading ? (
                  <div className="supplier-product-search-results" role="listbox" aria-label="Arama sonuçları">
                    {visibleProductSearchResults.length > 0 ? visibleProductSearchResults.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={toEntityKey(selectedProductId) === toEntityKey(item.id)}
                        className={`supplier-product-search-result-item ${toEntityKey(selectedProductId) === toEntityKey(item.id) || index === highlightedProductIndex ? 'is-selected' : ''}`}
                        onClick={() => {
                          selectProductForComparison(item.id);
                          setProductSearchInput('');
                          setProductSearch('');
                          setIsProductSearchOpen(false);
                          setHighlightedProductIndex(-1);
                        }}
                      >
                        <span className="supplier-product-search-result-name">{item.name}</span>
                        <span className="supplier-product-search-result-meta">
                          {item.sku ? `SKU: ${item.sku}` : ''}
                          {item.sku && item.barcode ? ' · ' : ''}
                          {item.barcode ? `Barkod: ${item.barcode}` : ''}
                        </span>
                      </button>
                    )) : (
                      <div className="supplier-product-search-result-empty">
                        <AlertTriangle size={14} /> Arama kriterine uygun ürün bulunamadı.
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className={`supplier-product-context supplier-product-context-info ${hasSelectedProduct ? '' : 'is-empty'}`}>
                <div className="supplier-product-context-head">
                  <h4>{hasSelectedProduct ? `Seçili Ürün: ${selectedProduct.name}` : 'Ürün Bilgileri'}</h4>
                  <p>{hasSelectedProduct ? `SKU: ${selectedProduct.sku || '-'} • Barkod: ${selectedProduct.barcode || '-'}` : 'Ürün seçtiğinizde özet bilgiler burada görüntülenir.'}</p>
                </div>
                <div className="supplier-product-context-grid" aria-label="Seçilen ürün bilgileri">
                  <div className="supplier-product-context-item"><span>SKU</span><strong>{hasSelectedProduct ? (selectedProduct.sku || '-') : '-'}</strong></div>
                  <div className="supplier-product-context-item"><span>Barkod</span><strong>{hasSelectedProduct ? (selectedProduct.barcode || '-') : '-'}</strong></div>
                  <div className="supplier-product-context-item"><span>Birim</span><strong>{hasSelectedProduct ? (selectedProduct.unit || '-') : '-'}</strong></div>
                  <div className="supplier-product-context-item"><span>Kategori</span><strong>{hasSelectedProduct ? selectedProductCategoryLabel : '-'}</strong></div>
                  <div className="supplier-product-context-item"><span>Saklama Tipi</span><strong>{hasSelectedProduct ? formatStorageTypeLabel(selectedProduct.requiredStorageType || selectedProduct.storageType) : '-'}</strong></div>
                  <div className="supplier-product-context-item"><span>Tedarikçi Sayısı</span><strong>{hasSelectedProduct ? formatNumber(selectedSupplierCount) : '-'}</strong></div>
                  <div className={`supplier-product-context-item ${hasSelectedProduct ? resolveStockTone(selectedWarehouseStock) : ''}`}><span>Depo Stok</span><strong>{hasSelectedProduct ? formatNumber(selectedWarehouseStock) : '-'}</strong></div>
                  <div className={`supplier-product-context-item ${hasSelectedProduct ? resolveStockTone(selectedShelfStock) : ''}`}><span>Reyon Stok</span><strong>{hasSelectedProduct ? formatNumber(selectedShelfStock) : '-'}</strong></div>
                  <div className={`supplier-product-context-item ${hasSelectedProduct ? resolveStockTone(selectedTotalStock) : ''}`}><span>Toplam Stok</span><strong>{hasSelectedProduct ? formatNumber(selectedTotalStock) : '-'}</strong></div>
                  <div className={`supplier-product-context-item ${hasSelectedProduct ? criticalStockTone : ''}`}><span>Kritik Stok</span><strong>{hasSelectedProduct ? formatNumber(selectedCriticalStock) : '-'}</strong></div>
                  <div className={`supplier-product-context-item ${hasSelectedProduct && selectedMinPrice !== null ? 'is-positive' : ''}`}><span>En Düşük Alış</span><strong>{hasSelectedProduct && selectedMinPrice !== null ? formatCurrency(selectedMinPrice, 'TRY') : '-'}</strong></div>
                  <div className={`supplier-product-context-item ${hasSelectedProduct && selectedMinLeadTime !== null ? 'is-positive' : ''}`}><span>En Hızlı Temin</span><strong>{hasSelectedProduct && selectedMinLeadTime !== null ? `${formatNumber(selectedMinLeadTime)} gün` : '-'}</strong></div>
                </div>
              </div>
            </div>
          </div>

          <div className="mod-card supplier-compare-panel supplier-create-right-panel">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-cyan"><Scale size={18} /></div>
              <div>
                <h3>Tedarikçi Karşılaştırma</h3>
                <p className="muted-text">
                  {orderFlowMode === ORDER_FLOW_MODES.BULK ?
                     'Kartlardan ürünleri sıraya ekleyin, tedarikçi bazlı akıştan onaya gönderin.'
                    : 'En Verimli etiketi; fiyat, temin ve teslimat performansına göre sistem tarafından belirlenir.'}
                </p>
              </div>
            </div>

            <div className={orderFlowMode === ORDER_FLOW_MODES.BULK ? 'supplier-order-flow-layout' : ''}>
              <div className="supplier-order-flow-main">
                <div className="supplier-compare-grid">
                  {isSelectedProductMatchesLoading && hasSelectedProduct ? (
                    <div className="supplier-compare-card supplier-compare-card-empty" role="status" aria-live="polite">
                      <div className="supplier-compare-top">
                        <strong>Eşleşmeler yükleniyor...</strong>
                      </div>
                      <div className="supplier-compare-meta" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className="loader" aria-hidden="true"></span>
                        <span>Seçilen ürün için tedarikçi karşılaştırması hazırlanıyor.</span>
                      </div>
                    </div>
                  ) : hasSelectedProduct && !hasComparisonData ? (
                    <div className="supplier-compare-card supplier-compare-card-empty" role="status" aria-live="polite">
                      <div className="supplier-compare-top">
                        <strong>Bu ürün için eşleşme bulunamadı.</strong>
                      </div>
                      <div className="supplier-compare-meta">
                        Seçilen ürüne ait aktif tedarikçi kaydı bulunamadı. Farklı bir ürün seçebilir veya katalog akışından ilerleyebilirsiniz.
                      </div>
                    </div>
                  ) : hasComparisonData ? (
                    selectedProductRows.map((item) => {
                  const isLowest = selectedMinPrice !== null && Number(item.purchasePrice) === selectedMinPrice;
                  const isFastest = selectedMinLeadTime !== null && Number(item.leadTimeDays || 0) === selectedMinLeadTime;
                  const isDefault = item.isPreferred;
                  const isEfficient = selectedEfficientSupplierId && item.id === selectedEfficientSupplierId;
                  const isMostSuccessful = selectedBestSuccessSupplierId && item.id === selectedBestSuccessSupplierId;
                  return (
                    <div
                      key={item.id}
                      className={`supplier-compare-card ${isDefault ? 'is-lowest' : ''} ${!item.isActive ? 'is-inactive' : ''}`}
                    >
                      <div className="supplier-compare-top">
                        <strong>{item.supplierName}</strong>
                        <div className="supplier-compare-badges">
                          {item.isPreferred ? (
                            <span className="supplier-chip supplier-chip-default">Varsayılan</span>
                          ) : (
                            <span className="supplier-chip supplier-chip-alt">Alternatif</span>
                          )}
                          {isLowest && <span className="supplier-chip supplier-chip-cheapest">En Ucuz</span>}
                          {isFastest && !isLowest && (
                            <span className="supplier-chip supplier-chip-fastest">En Hızlı Teslim</span>
                          )}
                          {isMostSuccessful && (
                            <span className="supplier-chip supplier-chip-success">En Başarılı</span>
                          )}
                          {isEfficient && (
                            <span className="supplier-chip supplier-chip-efficient">En Verimli</span>
                          )}
                        </div>
                      </div>
                      <div className="supplier-compare-price">{formatCurrency(item.purchasePrice, item.currency)}</div>
                      <div className="supplier-compare-meta">/{item.priceUnit || 'adet'}</div>
                      <div className="supplier-compare-meta-row">
                        <span>MOQ: {formatNumber(item.minimumOrderQty)} {item.minOrderUnit || item.priceUnit || 'adet'}</span>
                        <span>Temin Süresi: {formatNumber(item.leadTimeDays)} gün</span>
                      </div>
                      <div className="supplier-compare-meta-grid">
                        <div className="supplier-compare-meta-item">
                          <span>Koli içi</span>
                          <strong>{item.unitsPerCase > 1 ? `${formatNumber(item.unitsPerCase)} adet` : '-'}</strong>
                        </div>
                        <div className="supplier-compare-meta-item">
                          <span>Stok</span>
                          <strong>D {formatNumber(selectedWarehouseStock)} • R {formatNumber(selectedShelfStock)}</strong>
                        </div>
                        <div className="supplier-compare-meta-item">
                          <span>Son güncelleme</span>
                          <strong>{formatDate(item.lastPriceUpdate || item.updatedAt)}</strong>
                        </div>
                        <div className="supplier-compare-meta-item">
                          <span>Ürün kodu</span>
                          <strong>{item.supplierProductCode || '-'}</strong>
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="supplier-compare-actions">
                          <button
                            type="button"
                            className="primary-button primary-button-compact"
                            disabled={!item.isActive || item.source !== 'api'}
                            onClick={() => {
                              if (orderFlowMode === ORDER_FLOW_MODES.BULK) {
                                queueBulkItem(item);
                                return;
                              }
                              openOrderModal(item);
                            }}
                          >
                            <Truck size={14} />
                            <span>{orderFlowMode === ORDER_FLOW_MODES.BULK ? 'Sıraya Ekle' : 'Onaya Gönder'}</span>
                          </button>
                          <button
                            type="button"
                            className="text-button link-button"
                            onClick={() => markPreferred(item)}
                          >
                            Varsayılan Yap
                          </button>
                        </div>
                      )}
                    </div>
                  );
                    })
                  ) : (
                    <>
                  <div className="supplier-compare-card supplier-compare-card-empty">
                    <div className="supplier-compare-top">
                      <strong>Tedarikçi karşılaştırması ürün seçiminden sonra görüntülenir</strong>
                    </div>
                    <div className="supplier-compare-meta">
                      Seçilen ürün için uygun tedarikçiler bu alanda fiyat, minimum sipariş, stok ve temin süresi bilgileriyle listelenir.
                    </div>
                  </div>
                  <div className="supplier-compare-card supplier-compare-card-empty">
                    <div className="supplier-compare-top">
                      <strong>Karşılaştırma mantığı</strong>
                    </div>
                    <div className="supplier-compare-meta">
                      Sistem, tedarikçileri fiyat, hız, uygunluk ve performans kriterlerine göre otomatik değerlendirir. Varsayılan tedarikçi seçimi kart üzerinden güncellenebilir.
                    </div>
                  </div>
                    </>
                  )}
                </div>
                {hasSelectedProduct && selectedProductRows.length === 1 ? (
                  <div className="supplier-compare-inline-note">
                    Bu ürün için başka aktif tedarikçi görüntülenemedi.
                  </div>
                ) : null}
              </div>

              {orderFlowMode === ORDER_FLOW_MODES.BULK && (
                <div className="supplier-bulk-launch-strip">
                  <div className="supplier-bulk-launch-main">
                    <strong>Toplu Sipariş Akışı</strong>
                    <span>
                      {formatNumber(bulkSelectionSummary.totalLineCount)} seçili kalem • {formatNumber(bulkSelectionSummary.groupCount)} tedarikçi grubu • {formatNumber(bulkSelectionSummary.totalQuantity)} toplam miktar
                    </span>
                  </div>
                  <div className="supplier-bulk-launch-summary" aria-label="Toplu sipariş seçim özeti">
                    {bulkSelectionSummary.groupSummaries.length ? bulkSelectionSummary.groupSummaries.map((group) => (
                      <article key={`${group.supplierId}-launch`} className="supplier-bulk-launch-summary-item">
                        <div className="supplier-bulk-launch-summary-head">
                          <strong>{group.supplierName}</strong>
                          <span>{formatNumber(group.lineCount)} ürün • {formatNumber(group.quantity)} adet</span>
                        </div>
                        <p>{group.productNames.slice(0, 3).join(' • ') || 'Ürün seçilmedi'}</p>
                        {group.productNames.length > 3 ? (
                          <small>+{formatNumber(group.productNames.length - 3)} ürün daha</small>
                        ) : null}
                      </article>
                    )) : (
                      <div className="supplier-bulk-launch-summary-empty">Henüz ürün ve tedarikçi seçimi yapılmadı.</div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setIsBulkOrderModalOpen(true)}
                  >
                    Toplu Siparişi İncele
                  </button>
                </div>
              )}
            </div>
          </div>

          {false ? (
            <div className="supplier-match-missing-note" role="status" aria-live="polite">
              Eşleşmeler yükleniyor...
            </div>
          ) : null}
          {false ? (
            <div className="supplier-match-missing-note" role="status" aria-live="polite">
              Bu ürün için eşleşme bulunamadı.
            </div>
          ) : null}
        </div>
      )}

      <FormModal
        isOpen={isCatalogModalOpen}
        title="Tedarikçi Kataloğu"
        description="Katalogdan ürün seçin, sepete ekleyin ve onaya gönderin."
        headerIcon={<ShoppingBag size={18} />}
        modalClassName="supplier-catalog-modal modal-header-standardized"
        onClose={() => setIsCatalogModalOpen(false)}
      >
        <div className="proc-catalog-workspace proc-catalog-workspace-modal supplier-catalog-modal-workspace">
          {renderCatalogWorkspace({ inModal: true })}
        </div>
      </FormModal>

      <FormModal
        isOpen={isCompareModalOpen}
        title="Tedarikçi Karşılaştırma"
        description="Seçilen ürün için en uygun tedarikçileri fiyat, temin ve performansa göre karşılaştırın."
        headerIcon={<Scale size={18} />}
        modalClassName="supplier-compare-modal modal-header-standardized"
        onClose={() => setIsCompareModalOpen(false)}
      >
        {selectedProduct && isSelectedProductMatchesLoading ? (
          <div className="supplier-empty-state" role="status" aria-live="polite">
            <span className="loader" aria-hidden="true"></span>
            <h4>Eşleşmeler yükleniyor...</h4>
          </div>
        ) : selectedProduct && selectedProductRows.length > 0 ? (
          <div className="mod-card supplier-compare-panel supplier-compare-modal-content">
            <div className="supplier-compare-selected-product">
              <div className="supplier-compare-selected-product-head">
                <h4>Seçilen Ürün</h4>
                <p>Bu ürüne bağlı tedarikçileri karşılaştırın ve varsayılanı karttan güncelleyin.</p>
              </div>
              <div className="supplier-compare-selected-product-grid">
                <div className="supplier-compare-selected-product-item">
                  <span>Ürün Adı</span>
                  <strong>{selectedProduct.name}</strong>
                </div>
                <div className="supplier-compare-selected-product-item">
                  <span>SKU</span>
                  <strong>{selectedProduct.sku || '-'}</strong>
                </div>
                <div className="supplier-compare-selected-product-item">
                  <span>Barkod</span>
                  <strong>{selectedProduct.barcode || '-'}</strong>
                </div>
              </div>
            </div>

            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-cyan"><Scale size={18} /></div>
              <div>
                <h3>Tedarikçi Karşılaştırma</h3>
                <p className="muted-text">En Verimli etiketi; fiyat, temin ve teslimat performansına göre sistem tarafından belirlenir.</p>
              </div>
            </div>

            <div className="supplier-compare-grid">
              {selectedProductRows.map((item) => {
                const isLowest = selectedMinPrice !== null && Number(item.purchasePrice) === selectedMinPrice;
                const isFastest = selectedMinLeadTime !== null && Number(item.leadTimeDays || 0) === selectedMinLeadTime;
                const isDefault = item.isPreferred;
                const isEfficient = selectedEfficientSupplierId && item.id === selectedEfficientSupplierId;
                const isMostSuccessful = selectedBestSuccessSupplierId && item.id === selectedBestSuccessSupplierId;
                return (
                  <div
                    key={item.id}
                    className={`supplier-compare-card ${isDefault ? 'is-lowest' : ''} ${!item.isActive ? 'is-inactive' : ''}`}
                  >
                    <div className="supplier-compare-top">
                      <strong>{item.supplierName}</strong>
                      <div className="supplier-compare-badges">
                        {item.isPreferred ? (
                          <span className="supplier-chip supplier-chip-default">Varsayılan</span>
                        ) : (
                          <span className="supplier-chip supplier-chip-alt">Alternatif</span>
                        )}
                        {isLowest && <span className="supplier-chip supplier-chip-cheapest">En Ucuz</span>}
                        {isFastest && !isLowest && (
                          <span className="supplier-chip supplier-chip-fastest">En Hızlı Teslim</span>
                        )}
                        {isMostSuccessful && (
                          <span className="supplier-chip supplier-chip-success">En Başarılı</span>
                        )}
                        {isEfficient && (
                          <span className="supplier-chip supplier-chip-efficient">En Verimli</span>
                        )}
                      </div>
                    </div>
                    <div className="supplier-compare-price">{formatCurrency(item.purchasePrice, item.currency)}</div>
                    <div className="supplier-compare-meta">/{item.priceUnit || 'adet'}</div>
                    <div className="supplier-compare-meta-row">
                      <span>MOQ: {formatNumber(item.minimumOrderQty)} {item.minOrderUnit || item.priceUnit || 'adet'}</span>
                      <span>Temin Süresi: {formatNumber(item.leadTimeDays)} gün</span>
                    </div>
                    <div className="supplier-compare-meta-grid">
                      <div className="supplier-compare-meta-item">
                        <span>Koli içi</span>
                        <strong>{item.unitsPerCase > 1 ? `${formatNumber(item.unitsPerCase)} adet` : '-'}</strong>
                      </div>
                      <div className="supplier-compare-meta-item">
                        <span>Stok</span>
                        <strong>D {formatNumber(selectedWarehouseStock)} • R {formatNumber(selectedShelfStock)}</strong>
                      </div>
                      <div className="supplier-compare-meta-item">
                        <span>Son güncelleme</span>
                        <strong>{formatDate(item.lastPriceUpdate || item.updatedAt)}</strong>
                      </div>
                      <div className="supplier-compare-meta-item">
                        <span>Ürün kodu</span>
                        <strong>{item.supplierProductCode || '-'}</strong>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="supplier-compare-actions">
                        <button
                          type="button"
                          className="text-button link-button"
                          onClick={() => markPreferred(item)}
                        >
                          Varsayılan Yap
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {selectedProductRows.length === 1 ? (
              <div className="supplier-compare-inline-note">
                Bu ürün için başka aktif tedarikçi görüntülenemedi.
              </div>
            ) : null}
          </div>
        ) : (
          <div className="supplier-empty-state">
            <div className="supplier-empty-icon"><Boxes size={28} /></div>
            <h4>Bu ürün için eşleşme bulunamadı.</h4>
          </div>
        )}
      </FormModal>

      {priceHistoryTarget && (
        <FormModal
          isOpen={!!priceHistoryTarget}
          title="Fiyat Geçmişi"
          onClose={() => setPriceHistoryTarget(null)}
        >
          {(() => {
            const history = getPriceHistoryFor(priceHistoryTarget.productId, priceHistoryTarget.supplierId)
              .slice()
              .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
            const chartData = history.map((entry) => ({
              date: formatDate(entry.at),
              price: entry.price,
            }));

            return (
              <div className="price-history-modal">
                <div className="price-history-header">
                  <p><strong>Ürün:</strong> {priceHistoryTarget.productName}</p>
                  <p><strong>Tedarikçi:</strong> {priceHistoryTarget.supplierName}</p>
                </div>

                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis tickFormatter={(value) => formatCurrency(value, priceHistoryTarget.currency)} />
                      <Tooltip formatter={(value) => formatCurrency(value, priceHistoryTarget.currency)} />
                      <Line type="monotone" dataKey="price" stroke="#4f46e5" dot />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="price-history-table-wrapper">
                  <table className="price-history-table">
                    <thead>
                      <tr>
                        <th>Tarih</th>
                        <th>Fiyat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((entry) => (
                        <tr key={entry.at}>
                          <td>{formatDate(entry.at)}</td>
                          <td>{formatCurrency(entry.price, priceHistoryTarget.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </FormModal>
      )}

      <FormModal
        isOpen={isModalOpen}
        title={editingItem ? 'Eşleşme Düzenle' : 'Yeni Eşleşme'}
        description="Temel, ticari ve lojistik alanları doldurarak ürün-tedarikçi eşleşmesini kaydedin."
        modalClassName="supplier-form-fit-modal app-modal-standard"
        onClose={() => setIsModalOpen(false)}
      >
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="modal-form-body-scroll">
          <section className="modal-form-section">
            <div className="modal-form-section-head">
              <h4 className="modal-form-section-title">Temel Bilgi</h4>
              <p className="modal-form-section-desc">Eşleşecek ürün ve tedarikçiyi seçin. Eşleşmesi olmayan ürünler listede üstte gösterilir.</p>
            </div>
            <div className="modal-form-grid modal-form-grid-12">
              <label className="field-group col-6">
                <span>Ürün</span>
                <SearchableCombobox
                  options={formProductOptions}
                  value={form.productId}
                  onChange={(value) => {
                    const product = products.find((item) => item.id === value);
                    setForm((current) => ({
                      ...current,
                      productId: value,
                      barcode: current.barcode || product?.barcode || '',
                    }));
                  }}
                  placeholder="Ürün ara (ad, SKU, barkod)"
                  noResultsText="Ürün bulunamadı"
                  ariaLabel="Ürün seçimi"
                />
              </label>
              <label className="field-group col-6">
                <span>Tedarikçi</span>
                <SearchableCombobox
                  options={formSupplierOptions}
                  value={form.supplierId}
                  onChange={(value) => setForm((current) => ({ ...current, supplierId: value }))}
                  placeholder="Tedarikçi ara veya seç"
                  noResultsText="Tedarikçi bulunamadı"
                  ariaLabel="Tedarikçi seçimi"
                />
              </label>
              <label className="field-group col-6"><span>Tedarikçi Ürün Adı</span><input value={form.supplierProductName} onChange={(event) => setForm((current) => ({ ...current, supplierProductName: event.target.value }))} placeholder="örn. 12x1 LT Ayran Kolisi" /></label>
              <label className="field-group col-3"><span>Tedarikçi SKU</span><input value={form.supplierSku} onChange={(event) => setForm((current) => ({ ...current, supplierSku: event.target.value }))} placeholder="örn. TED-AYR-1201" /></label>
              <label className="field-group col-3"><span>Barkod (ops.)</span><input value={form.barcode} onChange={(event) => setForm((current) => ({ ...current, barcode: event.target.value }))} placeholder="EAN/GTIN" /></label>
            </div>
          </section>

          <section className="modal-form-section">
            <div className="modal-form-section-head">
              <h4 className="modal-form-section-title">Ticari Bilgi</h4>
              <p className="modal-form-section-desc">Fiyat, sipariş minimumu ve varsayılan tedarikçi kuralını belirleyin.</p>
            </div>
            <div className="modal-form-grid modal-form-grid-12">
              <label className="field-group col-3"><span>Birim Alış Fiyatı</span><input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(event) => setForm((current) => ({ ...current, purchasePrice: normalizeMoneyInput(event.target.value) }))} /></label>
              <label className="field-group col-3"><span>Para Birimi</span><select value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}>{CURRENCY_OPTIONS.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
              <label className="field-group col-3"><span>Fiyat Birimi</span><select value={form.priceUnit} onChange={(event) => setForm((current) => ({ ...current, priceUnit: event.target.value }))}>{ORDER_UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
              <label className="field-group col-3"><span>Min. Sipariş</span><input type="number" min="1" value={form.minimumOrderQty} onChange={(event) => setForm((current) => ({ ...current, minimumOrderQty: event.target.value }))} /></label>
              <label className="field-group col-3"><span>Min. Sipariş Birimi</span><select value={form.minOrderUnit} onChange={(event) => setForm((current) => ({ ...current, minOrderUnit: event.target.value }))}>{ORDER_UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
              <label className="field-group col-3"><span>Varsayılan Sipariş Birimi</span><select value={form.orderUnit} onChange={(event) => setForm((current) => ({ ...current, orderUnit: event.target.value }))}>{ORDER_UNIT_OPTIONS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
              <label className="field-group col-3"><span>3 Koli Fiyatı</span><input type="number" min="0" step="0.01" value={form.tierPrice3Case} onChange={(event) => setForm((current) => ({ ...current, tierPrice3Case: normalizeMoneyInput(event.target.value) }))} /></label>
              <label className="field-group col-3"><span>10 Koli Fiyatı</span><input type="number" min="0" step="0.01" value={form.tierPrice10Case} onChange={(event) => setForm((current) => ({ ...current, tierPrice10Case: normalizeMoneyInput(event.target.value) }))} /></label>
              <label className="field-group col-3"><span>20 Koli Fiyatı</span><input type="number" min="0" step="0.01" value={form.tierPrice20Case} onChange={(event) => setForm((current) => ({ ...current, tierPrice20Case: normalizeMoneyInput(event.target.value) }))} /></label>
              <label className="field-group col-6"><span>Tedarikçi Ürün Kodu</span><input value={form.supplierProductCode} onChange={(event) => setForm((current) => ({ ...current, supplierProductCode: event.target.value }))} placeholder="örn. SUP-ABC-001" /></label>
            </div>
          </section>

          <section className="modal-form-section">
            <div className="modal-form-section-head">
              <h4 className="modal-form-section-title">Lojistik Bilgi</h4>
              <p className="modal-form-section-desc">Temin süresi, ambalaj/palet kırılımları ve operasyon notlarını ekleyin.</p>
            </div>
            <div className="modal-form-grid modal-form-grid-12">
              <label className="field-group col-3"><span>Temin Süresi (Gün)</span><input type="number" min="1" value={form.leadTimeDays} onChange={(event) => setForm((current) => ({ ...current, leadTimeDays: event.target.value }))} /></label>
              <label className="field-group col-3"><span>Paket İçi Adet</span><input type="number" min="1" value={form.unitsPerPack} onChange={(event) => setForm((current) => ({ ...current, unitsPerPack: event.target.value }))} /></label>
              <label className="field-group col-3"><span>Kutu İçi Adet</span><input type="number" min="1" value={form.unitsPerBox} onChange={(event) => setForm((current) => ({ ...current, unitsPerBox: event.target.value }))} /></label>
              <label className="field-group col-3"><span>Koli İçi Adet</span><input type="number" min="1" value={form.unitsPerCase} onChange={(event) => setForm((current) => ({ ...current, unitsPerCase: event.target.value }))} /></label>
              <label className="field-group col-3"><span>Palet Başına Koli</span><input type="number" min="1" value={form.casesPerPallet} onChange={(event) => setForm((current) => ({ ...current, casesPerPallet: event.target.value }))} /></label>
              <label className="field-group col-3"><span>Palet Başına Adet</span><input type="number" min="1" value={form.unitsPerPallet} onChange={(event) => setForm((current) => ({ ...current, unitsPerPallet: event.target.value }))} /></label>
              <label className="field-group col-6">
                <span>Varsayılan Kargo Tipi</span>
                <select value={form.defaultCargoTypeCode} onChange={(event) => setForm((current) => ({ ...current, defaultCargoTypeCode: event.target.value }))}>
                  {(logisticsCargoTypes || DEFAULT_CARGO_TYPES).map((item) => (
                    <option key={item.cargoTypeCode} value={item.cargoTypeCode}>{item.cargoTypeName}</option>
                  ))}
                </select>
              </label>
              <label className="field-group col-6"><span>Tedarikçi Lojistik Notu</span><input value={form.supplierLogisticsNote} onChange={(event) => setForm((current) => ({ ...current, supplierLogisticsNote: event.target.value }))} placeholder="Örn: Sabah sevkiyat kabulü 09:00-11:00" /></label>
              <label className="field-group col-6"><span>Not</span><textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="Opsiyonel ticari/lojistik not" rows={3} /></label>
            </div>
          </section>

          <div className="modal-form-grid modal-form-grid-12">
            <div className="field-group col-6">
              <span>Varsayılan Tedarikçi</span>
              <small className="muted-text">Bu alan sistem tarafından en düşük efektif fiyata göre otomatik belirlenir.</small>
              <input value="Sistem hesaplamalı (manuel seçim kapalı)" readOnly />
            </div>
            <div className="field-group col-6">
              <span>Durum</span>
              <button
                type="button"
                className={`user-status-switch ${form.isActive ? 'is-active' : 'is-passive'}`}
                onClick={() => setForm((current) => ({ ...current, isActive: !current.isActive }))}
                aria-pressed={form.isActive}
                aria-label={`Eşleşme durumu: ${form.isActive ? 'Aktif' : 'Pasif'}`}
              >
                <span className="user-status-switch-indicator" aria-hidden="true"></span>
                <span className="user-status-switch-option option-passive">Pasif</span>
                <span className="user-status-switch-option option-active">Aktif</span>
              </button>
            </div>
          </div>
          </div>
          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={() => setIsModalOpen(false)}>İptal</button>
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Kaydediliyor...' : editingItem ? 'Güncelle' : 'Kaydet'}</button>
          </div>
        </form>
      </FormModal>

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        title="Eşleşme Sil"
        description={deleteTarget ? `${deleteTarget.productName} - ${deleteTarget.supplierName} eşleşmesi silinsin mi?` : ''}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        confirmText="Sil"
      />

      <FormModal
        isOpen={Boolean(catalogInfoSnapshot)}
        title="Ürün Bilgisi"
        description="Son satın alma ve stok kapasite görünümü"
        headerIcon={<Info size={18} />}
        modalClassName="proc-catalog-info-modal modal-header-standardized"
        onClose={() => setCatalogInfoTarget(null)}
      >
        {catalogInfoSnapshot && (
          <div className="proc-catalog-info-content">
            <div className="proc-catalog-info-head">
              <h4>{catalogInfoSnapshot.productName}</h4>
              <p>SKU: {catalogInfoSnapshot.productSku || '-'} • Para birimi: {catalogInfoSnapshot.currency || 'TRY'}</p>
            </div>

            <div className="proc-catalog-info-summary-strip" aria-label="Özet bilgiler">
              <div className="proc-catalog-info-kpi">
                <span>Toplam Stok</span>
                <strong>{formatNumber(catalogInfoSnapshot.totalStock)}</strong>
              </div>
              <div className="proc-catalog-info-kpi">
                <span>Maksimum Alınabilir</span>
                <strong>{formatNumber(catalogInfoSnapshot.maxPurchasable)}</strong>
              </div>
              <div className="proc-catalog-info-kpi">
                <span>Son Alış Fiyatı</span>
                <strong>
                  {catalogInfoSnapshot.lastPurchaseDate ?
                     formatCurrency(catalogInfoSnapshot.lastPurchasePrice || 0, catalogInfoSnapshot.currency)
                    : '-'}
                </strong>
              </div>
            </div>

            <section className="proc-catalog-info-section">
              <h5>Son Satın Alma Bilgisi</h5>
              <div className="proc-catalog-info-grid">
                <div className="proc-catalog-info-item">
                  <span>Tedarikçi</span>
                  <strong>{catalogInfoSnapshot.supplierName || '-'}</strong>
                </div>
                <div className="proc-catalog-info-item">
                  <span>Son Alış Tarihi</span>
                  <strong>{catalogInfoSnapshot.lastPurchaseDate ? formatDate(catalogInfoSnapshot.lastPurchaseDate) : '-'}</strong>
                </div>
                <div className="proc-catalog-info-item">
                  <span>Son Alış Fiyatı</span>
                  <strong>
                    {catalogInfoSnapshot.lastPurchaseDate ?
                       formatCurrency(catalogInfoSnapshot.lastPurchasePrice || 0, catalogInfoSnapshot.currency)
                      : '-'}
                  </strong>
                </div>
              </div>
            </section>

            <section className="proc-catalog-info-section">
              <h5>Stok ve Kapasite</h5>
              <div className="proc-catalog-info-grid">
                <div className="proc-catalog-info-item">
                  <span>Depo Mevcut Stok</span>
                  <strong>{formatNumber(catalogInfoSnapshot.warehouseStock)}</strong>
                </div>
                <div className="proc-catalog-info-item">
                  <span>Reyon Mevcut Stok</span>
                  <strong>{formatNumber(catalogInfoSnapshot.shelfStock)}</strong>
                </div>
                <div className="proc-catalog-info-item">
                  <span>Toplam Stok</span>
                  <strong>{formatNumber(catalogInfoSnapshot.totalStock)}</strong>
                </div>
                <div className="proc-catalog-info-item">
                  <span>Depo Kapasite Limiti</span>
                  <strong>{formatNumber(catalogInfoSnapshot.warehouseCapacityLimit)}</strong>
                </div>
                <div className="proc-catalog-info-item">
                  <span>Reyon Kapasite Limiti</span>
                  <strong>{formatNumber(catalogInfoSnapshot.shelfCapacityLimit)}</strong>
                </div>
                <div className="proc-catalog-info-item">
                  <span>Maksimum Alınabilir Miktar</span>
                  <strong>{formatNumber(catalogInfoSnapshot.maxPurchasable)}</strong>
                </div>
              </div>
            </section>
          </div>
        )}
      </FormModal>

      <FormModal
        isOpen={Boolean(orderModalItem)}
        title={orderModalTitle}
        description={orderModalDescription}
        headerIcon={<Truck size={18} />}
        modalClassName="purchase-order-modal modal-header-standardized"
        onClose={() => {
          setOrderModalItem(null);
          setOrderModalContext({ source: 'compare', cartItemId: null });
        }}
      >
        {orderModalItem && (
          <form className="modal-form purchase-order-form" onSubmit={handleOrderSubmit}>
            <div className="modal-form-body-scroll purchase-order-body-scroll">
              <div className="purchase-order-shell">
                <div className="purchase-order-left-pane">
              {activeOrderModalMode === PURCHASE_MODAL_MODES.SINGLE_PURCHASE ? (
                <section className="purchase-order-section purchase-order-hero purchase-order-surface-card purchase-order-product-hero" aria-label="Tekli satın alım ürün özeti">
                  <div className="purchase-order-product-hero-main">
                    <div className="purchase-order-product-hero-copy">
                      <h3>{orderModalItem.productName || '-'}</h3>
                      <p>
                        SKU: {orderModalItem.productSku || '-'}
                        {' • '}
                        Barkod: {orderModalItem.barcode || orderModalProduct?.barcode || '-'}
                      </p>
                    </div>
                    <div className="purchase-order-product-hero-supplier-badge" title={orderModalItem.supplierName || '-'}>
                      <span className="badge-label">Tedarikçi</span>
                      <strong>{orderModalItem.supplierName || '-'}</strong>
                    </div>
                  </div>
                  <div className="purchase-order-product-hero-prices" aria-label="Ürün fiyat özeti">
                    <div className="purchase-order-product-hero-price-item">
                      <span>Adet Fiyatı</span>
                      <strong>{formatCurrency(singleHeroUnitPrice, orderModalItem.currency)}</strong>
                    </div>
                    <div className="purchase-order-product-hero-price-item">
                      <span>Koli Fiyatı</span>
                      <strong>{formatCurrency(singleHeroCasePrice, orderModalItem.currency)}</strong>
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="purchase-order-section purchase-order-surface-card">
                <div className="purchase-order-section-title">{isSingleOrderContext ? 'Sipariş Ürünü' : 'Sipariş Ürünleri'}</div>
                {orderReviewLines.length ? (
                  <div className="purchase-order-review-line-list" aria-label="Sipariş ürün satırları">
                    {orderReviewLines.map((line) => {
                      const lineStock = stocks.find((s) => toEntityKey(s.productId) === toEntityKey(line.productId)) || null;
                      const lineCurrentStock = Number(lineStock?.totalStock || lineStock?.quantity || 0);
                      const productCartQty = Number(reviewCartQuantityByProductId.get(toEntityKey(line.productId)) || 0);
                      const linePostStock = Math.max(0, lineCurrentStock + productCartQty);
                      const stockDelta = linePostStock - lineCurrentStock;
                      const trendClass = stockDelta > 0 ? 'is-up' : stockDelta < 0 ? 'is-down' : 'is-neutral';
                      const stockIsLow = lineCurrentStock < 10;
                      return (
                        <article key={line.id} className="purchase-order-review-line-row">
                          <div className="purchase-order-review-line-main">
                            <strong>{line.productName || '-'}</strong>
                            <span>SKU: {line.productSku || '-'}</span>
                            <span>{line.supplierName || '-'}</span>
                          </div>
                          <div className="purchase-order-review-line-price">
                            <span>Birim: {formatCurrency(Number(line.unitPriceBase || line.unitPrice || 0), line.currency)} / {String(line.baseUnit || 'adet').toUpperCase()}</span>
                            <span>Miktar: {formatNumber(Number(line.quantityBase || 0))} {String(line.baseUnit || 'adet').toUpperCase()} ({formatNumber(Number(line.quantity || 0))} {String(line.unit || 'adet').toUpperCase()})</span>
                            <strong>Toplam: {formatCurrency(Number(line.lineTotal || 0), line.currency)}</strong>
                          </div>
                          {lineStock ? (
                            <div className={`po-line-stock-strip ${isCatalogCheckoutModal ? '' : 'is-single'}`}>
                              <span className={`po-line-stock-item ${stockIsLow ? 'is-low' : ''}`}>
                                <span className="po-line-stock-label">Mevcut Stok</span>
                                <span className="po-line-stock-value">
                                  {stockIsLow ? '↓ ' : ''}{formatNumber(lineCurrentStock)}
                                </span>
                              </span>
                              <span className="po-line-stock-arrow">→</span>
                              <span className={`po-line-stock-item is-post ${trendClass}`}>
                                <span className="po-line-stock-label">Sipariş Sonrası</span>
                                <span className="po-line-stock-value">
                                  {stockDelta > 0 ? '↑ ' : stockDelta < 0 ? '↓ ' : ''}
                                  {formatNumber(linePostStock)}
                                </span>
                              </span>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="purchase-order-summary-empty">Siparişte gösterilecek ürün bulunamadı.</div>
                )}
              </section>

              {!isCatalogCheckoutModal ? (
              <section className="purchase-order-section">
              <div className="purchase-order-context-grid">
                <div className="purchase-order-context-card purchase-order-surface-card">
                  <strong>Ürün Bilgileri</strong>
                  <span>Birim: {String(orderModalItem.orderUnit || orderModalItem.priceUnit || 'adet').toUpperCase()}</span>
                  <span>Kategori: {categoryLabel}</span>
                  <span>Saklama tipi: {orderStorageType || '-'}</span>
                  <span>MOQ: {formatNumber(orderModalItem.minimumOrderQty || 1)} {String(orderModalItem.minOrderUnit || 'adet').toUpperCase()}</span>
                </div>
                <div className="purchase-order-context-card purchase-order-surface-card">
                  <strong>Stok Bilgileri</strong>
                  <span>Depo stok: {formatNumber(currentWarehouseStock)}</span>
                  <span>Reyon stok: {formatNumber(currentShelfStock)}</span>
                  <span>Toplam stok: {formatNumber(currentTotalStock)}</span>
                </div>
                <div className="purchase-order-context-card purchase-order-surface-card">
                  <strong>Tedarikçi Bilgileri</strong>
                  <span>Varsayılan tedarikçi: {orderModalItem.isPreferred ? 'Evet' : 'Hayır'}</span>
                  <span>Tedarikçi kodu: {supplierCode}</span>
                  <span>Supplier SKU: {orderModalItem.supplierSku || '-'}</span>
                  <span>Ortalama teslim süresi: {formatNumber(orderModalItem.leadTimeDays || 0)} gün</span>
                  <span>Son alış fiyatı: {formatCurrency(orderModalItem.purchasePrice || 0, orderModalItem.currency)}</span>
                  <span>Son sipariş tarihi: {formatDate(orderModalItem.updatedAt || orderModalItem.lastPriceUpdate)}</span>
                </div>
                <div className="purchase-order-context-card purchase-order-surface-card">
                  <strong>Operasyon Özeti</strong>
                  <span>Sipariş nedeni: {ORDER_REASON_OPTIONS.find((option) => option.value === orderForm.orderReason)?.label || '-'}</span>
                  <span>Teslimat servisi: {SERVICE_LEVEL_OPTIONS.find((o) => o.value === orderForm.serviceLevel)?.label || '-'}</span>
                  <span>Varış Mağaza Kodu: SHF-001</span>
                  <span>Taşıma koşulu: {logisticsQuote?.technicalCargoLabel || 'Hesaplanıyor...'}</span>
                </div>
              </div>
              </section>
              ) : null}

              <section className="purchase-order-section purchase-order-surface-card">
                <div className="purchase-order-section-title">Sipariş Girişi</div>
              <div className="purchase-order-main-grid">
                <div className="field-group">
                  <span>Sipariş Birimi *</span>
                  <select
                    value={orderForm.unit}
                    onChange={(event) => setOrderForm((current) => ({ ...current, unit: event.target.value }))}
                  >
                    {allowedOrderUnits.map((u) => (
                      <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
                    ))}
                  </select>
                  <div className="field-helper-text">
                    {(() => {
                      const unitsPerCase = Number(orderModalItem.unitsPerCase || 0);
                      const casesPerPallet = Number(orderModalItem.casesPerPallet || 0);
                      const unitsPerPallet = Number(orderModalItem.unitsPerPallet || unitsPerCase * casesPerPallet || 0);

                      if (unitsPerCase > 1 && unitsPerPallet > 1 && casesPerPallet > 1) {
                        return `1 KOLİ = ${formatNumber(unitsPerCase)} ADET • 1 PALET = ${formatNumber(casesPerPallet)} KOLİ = ${formatNumber(unitsPerPallet)} ADET`;
                      }

                      if (unitsPerCase > 1) {
                        return `1 KOLİ = ${formatNumber(unitsPerCase)} ADET`;
                      }

                      return 'Sipariş birimini seçin';
                    })()}
                  </div>
                </div>

                <label className="field-group">
                  <span>Sipariş Miktarı *</span>
                  <div className="quantity-input-row">
                    <button
                      type="button"
                      className="quantity-stepper"
                      onClick={() => adjustQuantity(-1)}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={orderForm.quantity}
                      onChange={(event) => setOrderForm((current) => ({ ...current, quantity: event.target.value }))}
                    />
                    <button
                      type="button"
                      className="quantity-stepper"
                      onClick={() => adjustQuantity(1)}
                    >
                      +
                    </button>
                  </div>
                  <div className="quantity-quick-row">
                    <button
                      type="button"
                      className="quantity-quick-button"
                      onClick={() => handleQuickQuantityPreset('one_case')}
                    >
                      1 KOLİ
                    </button>
                    <button
                      type="button"
                      className="quantity-quick-button"
                      onClick={() => handleQuickQuantityPreset('one_pallet')}
                    >
                      1 PALET
                    </button>
                    <button
                      type="button"
                      className="quantity-quick-button"
                      onClick={() => handleQuickQuantityPreset('moq')}
                    >
                      MOQ
                    </button>
                    <button
                      type="button"
                      className="quantity-quick-button"
                      onClick={() => handleQuickQuantityPreset('target_stock')}
                    >
                      Eksik Stok
                    </button>
                  </div>
                </label>
                  </div>
              </section>

              <section className="purchase-order-section purchase-order-surface-card">
                <div className="purchase-order-section-title">Teslimat ve Lojistik</div>
                <div className="purchase-order-logistics-new-grid">

                  {/* Kullanıcı seçimi: sadece servis seviyesi */}
                  <label className="field-group">
                    <span>Teslimat Servisi</span>
                    <select
                      value={orderForm.serviceLevel || 'standard'}
                      onChange={(event) => setOrderForm((current) => ({
                        ...current,
                        serviceLevel: event.target.value,
                        deliveryDateMode: 'estimated',
                      }))}
                    >
                      {SERVICE_LEVEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>

                  {/* Sistem belirledi: taşıma koşulu readonly */}
                  <div className="po-logistics-info-row">
                    <div className="po-logistics-info-item">
                      <span>Taşıma Koşulu</span>
                      <strong>{logisticsQuote?.technicalCargoLabel || 'Hesaplanıyor...'}</strong>
                    </div>
                    <div className="po-logistics-info-item">
                      <span>Toplam Koli</span>
                      <strong>
                        {logisticsQuote?.caseQty != null ?
                           `${formatNumber(logisticsQuote.caseQty)} koli`
                          : logisticsQuoteError ? '—' : 'Hesaplanıyor...'}
                      </strong>
                    </div>
                    <div className="po-logistics-info-item">
                      <span>Tahmini Kargo Maliyeti</span>
                      <strong>
                        {logisticsQuote?.fee != null && !logisticsQuote.error ?
                           formatCurrency(logisticsQuote.fee, orderModalItem.currency)
                          : logisticsQuoteError ? '—' : 'Hesaplanıyor...'}
                      </strong>
                    </div>
                  </div>

                  {/* Hata */}
                  {logisticsQuoteError ? (
                    <div className="po-logistics-error" role="alert">
                      {logisticsQuoteError}
                    </div>
                  ) : null}

                  {/* Hesaplama nedeni */}
                  {logisticsQuote?.reason && !logisticsQuote.error ? (
                    <div className="po-logistics-reason">
                      {logisticsQuote.reason}
                    </div>
                  ) : null}

                  {/* Tahmini teslim tarihi */}
                  <article className="purchase-order-schedule-card">
                    <div className="purchase-order-schedule-head">
                      <div className="purchase-order-schedule-copy">
                        <span>Sipariş Zamanı</span>
                        <strong className="delivery-schedule-date">
                          <span className="purchase-order-schedule-pill">Tahmini Teslim</span>
                          <span className="purchase-order-schedule-date-value">{estimatedDeliveryLabel}</span>
                        </strong>
                      </div>
                      <button
                        type="button"
                        className={orderForm.deliveryDateMode === 'custom' ? 'delivery-date-option active' : 'delivery-date-option'}
                        onClick={() => {
                          if (orderForm.deliveryDateMode === 'custom') {
                            setOrderForm((current) => ({ ...current, deliveryDateMode: 'estimated' }));
                            return;
                          }
                          setOrderForm((current) => ({
                            ...current,
                            deliveryDateMode: 'custom',
                            deliveryDate: current.deliveryDate || new Date().toISOString().slice(0, 10),
                          }));
                        }}
                      >
                        İleri Tarihli Sipariş
                      </button>
                    </div>
                    {orderForm.deliveryDateMode === 'custom' && (
                      <input
                        className="purchase-order-schedule-custom-input"
                        type="date"
                        min={orderMinimumDeliveryDate}
                        value={orderForm.deliveryDate}
                        onChange={(event) => setOrderForm((current) => ({ ...current, deliveryDate: event.target.value }))}
                      />
                    )}
                  </article>

                </div>
              </section>

              <section className="purchase-order-section purchase-order-note purchase-order-surface-card">
                <div className="purchase-order-section-title">Sipariş Nedeni ve Notlar</div>
                <div className="purchase-order-reason-grid">
                  <label className="field-group">
                    <span>Sipariş Nedeni</span>
                    <select
                      value={orderForm.orderReason}
                      onChange={(event) => setOrderForm((current) => ({ ...current, orderReason: event.target.value }))}
                    >
                      {ORDER_REASON_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="note-tabs">
                  <button
                    type="button"
                    className={orderForm.noteTab === 'operational' ? 'note-tab active' : 'note-tab'}
                    onClick={() => setOrderForm((current) => ({ ...current, noteTab: 'operational' }))}
                  >
                    Operasyon Notu
                  </button>
                  <button
                    type="button"
                    className={orderForm.noteTab === 'supplier' ? 'note-tab active' : 'note-tab'}
                    onClick={() => setOrderForm((current) => ({ ...current, noteTab: 'supplier' }))}
                  >
                    Tedarikçi Notu
                  </button>
                </div>
                {orderForm.noteTab === 'operational' ? (
                  <label className="field-group">
                    <span>Operasyon Notu</span>
                    <textarea
                      rows="3"
                      value={orderForm.operationalNote}
                      onChange={(event) => setOrderForm((current) => ({ ...current, operationalNote: event.target.value }))}
                      placeholder="Depo ekibi, planlama vb. için notlar"
                    />
                  </label>
                ) : (
                  <label className="field-group">
                    <span>Tedarikçi Notu</span>
                    <textarea
                      rows="3"
                      value={orderForm.supplierNote}
                      onChange={(event) => setOrderForm((current) => ({ ...current, supplierNote: event.target.value }))}
                      placeholder="Tedarikçi tarafına iletilecek özel notlar"
                    />
                  </label>
                )}
              </section>
                </div>

                <aside className="purchase-order-right-pane">
                  <div className="purchase-order-summary-section">
                    <div className="purchase-order-summary-header">
                      <span>HESAP ÖZETİ</span>
                    </div>
                    <div className="purchase-order-tier-strip">
                      <span>Baz: {formatCurrency(orderModalItem.purchasePrice || 0, orderModalItem.currency)} / {String(orderModalItem.priceUnit || 'adet').toUpperCase()}</span>
                      <span>MOQ: {formatNumber(orderModalItem.minimumOrderQty || 1)} {String(orderModalItem.minOrderUnit || orderModalItem.priceUnit || 'adet').toUpperCase()}</span>
                      <span>10 koli: {Number(orderModalItem.tierPrice10Case || 0) > 0 ? formatCurrency(orderModalItem.tierPrice10Case, orderModalItem.currency) : '-'}</span>
                      <span>20 koli: {Number(orderModalItem.tierPrice20Case || 0) > 0 ? formatCurrency(orderModalItem.tierPrice20Case, orderModalItem.currency) : '-'}</span>
                    </div>
                    <div className="purchase-order-summary-card purchase-order-summary-card-finance">
                      {(() => {
                        if (!hasValidOrderQuantity) {
                          return (
                            <div className="purchase-order-summary-empty">
                              Toplam adet ve tutar için geçerli bir miktar girin.
                            </div>
                          );
                        }

                        if (!currentOrderMetrics) {
                          return (
                            <div className="purchase-order-summary-empty">
                              Hesaplama yapılamadı. Lütfen ürün ve tedarikçi bilgilerini kontrol edin.
                            </div>
                          );
                        }

                        if (currentOrderMetrics.reason === 'packaging') {
                          return (
                            <div className="purchase-order-summary-warning">
                              {currentOrderMetrics.message
                                || 'Bu ürün için ambalaj bilgileri eksik. Lütfen ürün ayarlarını kontrol edin.'}
                            </div>
                          );
                        }

                        if (currentOrderMetrics.reason === 'price') {
                          return (
                            <div className="purchase-order-summary-warning">
                              {currentOrderMetrics.message || 'Fiyat bilgisi eksik veya geçersiz.'}
                            </div>
                          );
                        }

                        const labelMap = {
                          adet: 'ADET',
                          paket: 'PAKET',
                          kutu: 'KUTU',
                          koli: 'KOLİ',
                          'çuval': 'ÇUVAL',
                          kasa: 'KASA',
                          palet: 'PALET',
                          kg: 'KG',
                          şişe: 'ŞİŞE',
                        };

                        const selectedUnitLabel = labelMap[currentOrderMetrics.selectedUnit]
                          || currentOrderMetrics.selectedUnit.toUpperCase();
                        const minUnitLabel = labelMap[currentOrderMetrics.minUnit]
                          || currentOrderMetrics.minUnit.toUpperCase();
                        const baseUnitLabel = labelMap[currentOrderMetrics.baseUnit]
                          || currentOrderMetrics.baseUnit.toUpperCase();

                        const subtotalValue = Number(currentOrderMetrics.totalPriceWithTier || currentOrderMetrics.totalPrice || 0);
                        const vatRateNum = Number(orderForm.vatRate || 0) || 0;
                        const vatAmountValue = Number(((subtotalValue * vatRateNum) / 100).toFixed(2));
                        const shippingValue = Number(orderForm.shippingFee || 0) || 0;
                        const grandTotalValue = Number((subtotalValue + vatAmountValue + shippingValue).toFixed(2));

                        return (
                          <>
                            <div className="purchase-order-summary-row">
                              <div className="purchase-order-summary-label">Toplam</div>
                              <div className="purchase-order-summary-value">
                                {formatNumber(orderQuantityNumber)} {selectedUnitLabel}
                                {' '}
                                <span className="purchase-order-summary-muted"> = {formatNumber(currentOrderMetrics.quantityBase)} {baseUnitLabel}
                                </span>
                              </div>
                            </div>
                            {!isCatalogCheckoutModal ? (
                              <div className="purchase-order-summary-row">
                                <div className="purchase-order-summary-label">Kademe</div>
                                <div className="purchase-order-summary-value">
                                  {currentOrderMetrics.appliedTierLabel || 'Baz fiyat'}
                                </div>
                              </div>
                            ) : null}
                            <div className="purchase-order-summary-row">
                              <div className="purchase-order-summary-label">Ara Toplam</div>
                              <div className="purchase-order-summary-amount">
                                {formatCurrency(subtotalValue || 0, orderModalItem.currency)}
                              </div>
                            </div>
                            {Number(currentOrderMetrics.discountAmount || 0) > 0 && (
                              <div className="purchase-order-summary-row">
                                <div className="purchase-order-summary-label">
                                  Kademe İndirimi
                                  {!isCatalogCheckoutModal && currentOrderMetrics.appliedTierId ? ` (${currentOrderMetrics.appliedTierId})` : ''}
                                </div>
                                <div className="purchase-order-summary-amount">
                                  -{formatCurrency(currentOrderMetrics.discountAmount || 0, orderModalItem.currency)}
                                </div>
                              </div>
                            )}
                            <div className="purchase-order-summary-row">
                              <div className="purchase-order-summary-label">KDV ({vatRateNum ? `%${vatRateNum}` : '%0'})</div>
                              <div className="purchase-order-summary-amount">
                                {formatCurrency(vatAmountValue, orderModalItem.currency)}
                              </div>
                            </div>
                            <div className="purchase-order-summary-row">
                              <div className="purchase-order-summary-label">Kargo / Lojistik</div>
                              <div className="purchase-order-summary-amount">
                                {formatCurrency(shippingValue, orderModalItem.currency)}
                              </div>
                            </div>
                            <div className="purchase-order-summary-row purchase-order-summary-row-total">
                              <div className="purchase-order-summary-label">Genel Toplam</div>
                              <div className="purchase-order-summary-amount">
                                {formatCurrency(grandTotalValue, orderModalItem.currency)}
                              </div>
                            </div>
                            {currentOrderMetrics.reason === 'min' && (
                              <div className="purchase-order-summary-meta">
                                <span className="purchase-order-summary-min-warning">
                                  Minimum {formatNumber(currentOrderMetrics.minQty)} {minUnitLabel} sipariş verilmelidir
                                </span>
                              </div>
                            )}
                            {orderProductStock && (
                              <div className="purchase-order-summary-meta">
                                <span>Depo: {formatNumber(currentWarehouseStock)}</span>
                                <span>Reyon: {formatNumber(currentShelfStock)}</span>
                                <span>Toplam: {formatNumber(currentTotalStock)}</span>
                                <span>Sipariş Sonrası Depo: {formatNumber(postOrderEstimatedWarehouseStock)}</span>
                                <span>Sipariş Sonrası Toplam: {formatNumber(postOrderEstimatedTotalStock)}</span>
                              </div>
                            )}
                            {logisticsQuote && (
                              <div className="purchase-order-summary-meta">
                                <span>Toplam koli: {formatNumber(logisticsQuote.caseQty || logisticsQuote.caseCount)}</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </aside>
              </div>
            </div>

            <div className="modal-actions modal-actions-sticky purchase-order-footer-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  setOrderModalItem(null);
                  setOrderModalContext({ source: 'compare', cartItemId: null });
                }}
              >
                İptal
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={orderSubmitting}
                onClick={() => setOrderSubmitMode('approval')}
              >
                {orderSubmitting && orderSubmitMode === 'approval' ? 'Gönderiliyor...' : 'Onaya Gönder'}
              </button>
            </div>
          </form>
        )}
      </FormModal>

            <FormModal
        isOpen={isBulkOrderModalOpen}
        title="Toplu Siparişi İncele ve Onaya Hazırla"
        description="Sipariş girişini, teslimat planını ve notları tek ekranda düzenleyip tedarikçi bazlı onaya gönderin."
        headerIcon={<Truck size={18} />}
        modalClassName="supplier-bulk-order-modal modal-header-standardized"
        onClose={() => {
          setIsBulkOrderModalOpen(false);
          setBulkNoteTab('operational');
        }}
      >
        <div className="sbom-shell">
          <div className="sbom-body">
            <div className="sbom-left">

              {/* ---- Teslimat ve Lojistik ---- */}
              <section className="sbom-card">
                <div className="sbom-card-head">
                  <h5>Teslimat ve Lojistik</h5>
                  <span>Servis seviyesini seçin; teknik taşıma koşulu sistem tarafından belirlenir.</span>
                </div>
                <div className="sbom-delivery-grid">
                  <label className="field-group compact">
                    <span>Teslimat Servisi</span>
                    <select
                      value={bulkQuickForm.serviceLevel || 'standard'}
                      onChange={(event) => setBulkQuickForm((current) => ({
                        ...current,
                        serviceLevel: event.target.value,
                        deliveryDateMode: 'estimated',
                      }))}
                    >
                      {SERVICE_LEVEL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <article className="purchase-order-schedule-card sbom-schedule-card">
                    <div className="purchase-order-schedule-head">
                      <div className="purchase-order-schedule-copy">
                        <span>Sipariş Zamanı</span>
                        <strong className="delivery-schedule-date">
                          <span className="purchase-order-schedule-pill">Tahmini Teslim</span>
                          <span className="purchase-order-schedule-date-value">{bulkEstimatedDeliveryLabel}</span>
                        </strong>
                      </div>
                      <button
                        type="button"
                        className={bulkQuickForm.deliveryDateMode === 'custom' ? 'delivery-date-option active' : 'delivery-date-option'}
                        onClick={() => {
                          if (bulkQuickForm.deliveryDateMode === 'custom') {
                            setBulkQuickForm((current) => ({ ...current, deliveryDateMode: 'estimated', deliveryDate: bulkMinimumDeliveryDate }));
                            return;
                          }
                          setBulkQuickForm((current) => ({
                            ...current,
                            deliveryDateMode: 'custom',
                            deliveryDate: current.deliveryDate || bulkMinimumDeliveryDate,
                          }));
                        }}
                      >
                        İleri Tarihli Sipariş
                      </button>
                    </div>
                    {bulkQuickForm.deliveryDateMode === 'custom' ? (
                      <input
                        className="purchase-order-schedule-custom-input"
                        type="date"
                        min={bulkMinimumDeliveryDate}
                        value={bulkQuickForm.deliveryDate}
                        onChange={(event) => setBulkQuickForm((current) => ({
                          ...current,
                          deliveryDateMode: 'custom',
                          deliveryDate: event.target.value,
                        }))}
                      />
                    ) : null}
                  </article>
                </div>
                <div className="sbom-logistics-bar">
                  <div className="sbom-logi-item">
                    <span>Taşıma Koşulu</span>
                    <strong>
                      {bulkDeliverySnapshot.hasPending && !bulkDeliverySnapshot.resolvedCount ?
                         'Hesaplanıyor...'
                        : (bulkDeliverySnapshot.technicalLabel || 'Ortam')}
                    </strong>
                    {bulkDeliverySnapshot.errorCount ? (
                      <small className="sbom-logi-note">
                        {formatNumber(bulkDeliverySnapshot.errorCount)} tedarikçi için tarife bulunamadı
                      </small>
                    ) : null}
                  </div>
                  <div className="sbom-logi-item">
                    <span>Toplam Koli</span>
                    <strong>
                        {bulkDeliverySnapshot.totalCaseQty > 0 ?
                           `${formatNumber(bulkDeliverySnapshot.totalCaseQty)} koli`
                          : bulkDeliverySnapshot.hasPending ?
                             'Hesaplanıyor...'
                            : '—'}
                    </strong>
                    {bulkDeliverySnapshot.totalVolumeDesi > 0 || bulkDeliverySnapshot.totalWeightKg > 0 ? (
                      <small className="sbom-logi-note">
                        {bulkDeliverySnapshot.totalVolumeDesi > 0 ? `${formatNumber(bulkDeliverySnapshot.totalVolumeDesi)} desi` : null}
                        {bulkDeliverySnapshot.totalVolumeDesi > 0 && bulkDeliverySnapshot.totalWeightKg > 0 ? ' • ' : null}
                        {bulkDeliverySnapshot.totalWeightKg > 0 ? `${formatNumber(bulkDeliverySnapshot.totalWeightKg)} kg` : null}
                      </small>
                    ) : null}
                  </div>
                  <div className="sbom-logi-item">
                    <span>Tahmini Kargo Maliyeti</span>
                    <strong>
                        {bulkDeliverySnapshot.hasPending && !bulkDeliverySnapshot.resolvedCount && !bulkDeliverySnapshot.errorCount ?
                           'Hesaplanıyor...'
                          : formatCurrency(bulkCombinedSummary.shippingFee, 'TRY')}
                    </strong>
                    {bulkDeliverySnapshot.firstError ? <small className="sbom-logi-note">{bulkDeliverySnapshot.firstError}</small> : null}
                  </div>
                </div>
                <p className="sbom-hint">Teknik taşıma koşulu, ürünlerin saklama tipine göre otomatik belirlenir.</p>
              </section>

              {/* ---- Tedarikçi Bazlı Sipariş Blokları ---- */}
              <section className="sbom-card">
                <div className="sbom-card-head">
                  <h5>Tedarikçi Bazlı Sipariş Blokları</h5>
                  <span>{formatNumber(bulkCart.length)} ürün &bull; {formatNumber(bulkSupplierSummaries.length)} tedarikçi</span>
                </div>
                <div className="sbom-supplier-list">
                  {bulkSupplierSummaries.length ? bulkSupplierSummaries.map((group) => {
                    const supplierServiceLabel = SERVICE_LEVEL_OPTIONS.find((o) => o.value === (group.form.serviceLevel || bulkQuickForm.serviceLevel || 'standard'))?.label || 'Standart';
                    const supplierDeliveryLabel = group.form.deliveryDate
                      ? formatDate(group.form.deliveryDate)
                      : group.estimatedDeliveryDate
                        ? formatDate(group.estimatedDeliveryDate)
                        : (bulkEstimatedDeliveryLabel || '-');
                    return (
                    <article key={group.supplierId} className="sbom-group-card">
                      <header className="sbom-group-header">
                        <div className="sbom-group-header-left">
                          <strong className="sbom-group-name">{group.supplierName}</strong>
                          <span className="sbom-group-code">{group.supplierCode}</span>
                        </div>
                        <div className="sbom-group-header-right">
                          <span className="sbom-meta-chip">Servis: {supplierServiceLabel}</span>
                          <span className="sbom-meta-chip">Teslim: {supplierDeliveryLabel}</span>
                          <span className="sbom-meta-chip">Servis temini: {formatNumber(group.effectiveLeadTimeDays)} gün</span>
                        </div>
                      </header>

                      {/* Ürün tablosu */}
                      <div className="sbom-products-table" role="table" aria-label={`${group.supplierName} ürün listesi`}>
                        <div className="sbom-products-head" role="row">
                          <span role="columnheader">Ürün</span>
                          <span role="columnheader">SKU</span>
                          <span role="columnheader">Fiyat</span>
                          <span role="columnheader">Birim / Miktar</span>
                          <span role="columnheader" className="sbom-col-right">Toplam</span>
                        </div>
                        <div className="sbom-products-body">
                          {group.items.map((line) => {
                            const lineTotal = Number(line.lineTotal || 0);
                            const lineVatRate = resolveVatRateForCategory({
                              categoryId: line.productCategoryId,
                              categoryLabel: line.categoryLabel,
                            });
                            const editableUnits = getBulkLineEditableUnits(line);
                            const lineMetrics = computeOrderMetrics({
                              quantity: Math.max(1, Number(line.quantity || 1) || 1),
                              unit: line.unit || 'adet',
                              item: line,
                            });
                            const minimumQuantity = getBulkLineMinQuantity(line, line.unit || 'adet');
                            const quantityBase = Number(lineMetrics?.quantityBase || line.quantityBase || 0);
                            const baseUnit = String(lineMetrics?.baseUnit || line.baseUnit || 'adet').toUpperCase();
                            const hasMoqWarning = lineMetrics?.reason === 'min';
                            return (
                              <div key={line.supplierProductId} className="sbom-product-row" role="row">
                                <div className="sbom-product-cell sbom-product-name" role="cell">
                                  <strong>{line.productName}</strong>
                                  <small>{line.categoryLabel || 'Kategori yok'} &bull; KDV %{formatNumber(lineVatRate)}</small>
                                </div>
                                <div className="sbom-product-cell" role="cell">{line.productSku || '-'}</div>
                                <div className="sbom-product-cell" role="cell">{formatCurrency(line.unitPriceBase || line.unitPrice, line.currency)} / {String(line.baseUnit || 'adet').toUpperCase()}</div>
                                <div className="sbom-product-cell sbom-qty-cell" role="cell">
                                  <div className="sbom-qty-editor">
                                    <select
                                      value={normalizeOrderUnit(line.unit || 'adet') || 'adet'}
                                      onChange={(event) => updateBulkLineUnit(line.supplierProductId, event.target.value)}
                                      aria-label={`${line.productName} sipariş birimi`}
                                    >
                                      {editableUnits.map((unit) => (
                                        <option key={unit} value={unit}>{String(unit).toUpperCase()}</option>
                                      ))}
                                    </select>
                                    <div className="sbom-qty-stepper">
                                      <button
                                        type="button"
                                        onClick={() => adjustBulkLineQuantity(line.supplierProductId, -1)}
                                        aria-label={`${line.productName} miktar azalt`}
                                      >
                                        -
                                      </button>
                                      <input
                                        type="number"
                                        min={minimumQuantity}
                                        step="1"
                                        value={line.quantity}
                                        onChange={(event) => updateBulkLineQuantity(line.supplierProductId, event.target.value)}
                                        aria-label={`${line.productName} sipariş miktarı`}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => adjustBulkLineQuantity(line.supplierProductId, 1)}
                                        aria-label={`${line.productName} miktar artır`}
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                  <small className="sbom-qty-conversion">
                                    {formatNumber(quantityBase)} {baseUnit}
                                  </small>
                                  {hasMoqWarning ? <small className="sbom-qty-warning">Minimumun altında</small> : null}
                                </div>
                                <div className="sbom-product-cell sbom-product-total" role="cell">
                                  <strong>{formatCurrency(lineTotal, line.currency)}</strong>
                                  <button
                                    type="button"
                                    className="ghost-button sbom-remove-btn"
                                    onClick={() => removeBulkItem(line.supplierProductId)}
                                  >
                                    Sil
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Alt toplam */}
                      <div className="sbom-group-totals">
                        <div><span>Ara Toplam</span><strong>{formatCurrency(group.summary.subtotal, 'TRY')}</strong></div>
                        <div><span>KDV (%{formatNumber(group.summary.vatRate)})</span><strong>{formatCurrency(group.summary.vatAmount, 'TRY')}</strong></div>
                        <div>
                          <span>Kargo / Lojistik</span>
                          <div className="sbom-group-total-stack">
                            <strong>
                              {group.logisticsQuote?.pending && group.summary.shippingFee <= 0
                                ? 'Hesaplanıyor...'
                                : formatCurrency(group.summary.shippingFee, 'TRY')}
                            </strong>
                            {group.logisticsQuote?.error ? (
                              <small className="sbom-inline-warning">{group.logisticsQuote.error}</small>
                            ) : group.logisticsQuote?.bandLabel ? (
                              <small className="sbom-inline-note">{group.logisticsQuote.bandLabel}</small>
                            ) : null}
                          </div>
                        </div>
                        <div className="sbom-totals-grand"><span>Tedarikçi Toplamı</span><strong>{formatCurrency(group.summary.grandTotal, 'TRY')}</strong></div>
                      </div>
                    </article>
                  );}) : (
                    <p className="muted-text">Sepete henüz ürün eklenmedi.</p>
                  )}
                </div>
              </section>

              {/* ---- Sipariş Nedeni ve Notlar ---- */}
              <section className="sbom-card">
                <div className="sbom-card-head">
                  <h5>Sipariş Nedeni ve Notlar</h5>
                  <span>Satın alma operasyonuna ait nedeni ve ortak notları tek adımda yönetin.</span>
                </div>
                <div className="sbom-notes-grid">
                  <label className="field-group compact">
                    <span>Sipariş Nedeni</span>
                    <select
                      value={bulkQuickForm.orderReason}
                      onChange={(event) => setBulkQuickForm((current) => ({ ...current, orderReason: event.target.value }))}
                    >
                      {ORDER_REASON_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <div className="sbom-note-tabs-wrap">
                    <div className="note-tabs">
                      <button
                        type="button"
                        className={bulkNoteTab === 'operational' ? 'note-tab active' : 'note-tab'}
                        onClick={() => setBulkNoteTab('operational')}
                      >
                        Operasyon Notu
                      </button>
                      <button
                        type="button"
                        className={bulkNoteTab === 'supplier' ? 'note-tab active' : 'note-tab'}
                        onClick={() => setBulkNoteTab('supplier')}
                      >
                        Tedarikci Notu
                      </button>
                    </div>
                    {bulkNoteTab === 'operational' ? (
                      <label className="field-group compact">
                        <span>Operasyon Notu</span>
                        <textarea
                          rows={3}
                          value={bulkQuickForm.operationalNote}
                          onChange={(event) => setBulkQuickForm((current) => ({ ...current, operationalNote: event.target.value }))}
                          placeholder="Depo ekibi, planlama vb. için notlar"
                        />
                      </label>
                    ) : (
                      <label className="field-group compact">
                        <span>Tedarikçi Notu</span>
                        <textarea
                          rows={3}
                          value={bulkQuickForm.supplierNote}
                          onChange={(event) => setBulkQuickForm((current) => ({ ...current, supplierNote: event.target.value }))}
                          placeholder="Tedarikçiye iletilecek notlar"
                        />
                      </label>
                    )}
                  </div>
                </div>
              </section>
            </div>{/* end sbom-left */}

            {/* ---- Sag Sticky Ozet Panel ---- */}
            <aside className="sbom-right">
              <div className="sbom-summary-card">
                <div className="sbom-summary-header">
                  <h5 className="sbom-summary-title">Hesap Özeti</h5>
                  <p className="sbom-summary-caption">
                    {formatNumber(bulkSupplierSummaries.length)} tedarikçi • {formatNumber(bulkCart.length)} ürün kalemi
                  </p>
                </div>

                {bulkSupplierSummaries.length > 0 ? (
                  <>
                    <div className="sbom-summary-section">
                      <div className="sbom-summary-section-head">
                        <span className="sbom-summary-section-title">Tedarikçi Dağılımı</span>
                        <span className="sbom-summary-section-meta">{formatNumber(bulkSelectionSummary.groupCount)} grup</span>
                      </div>
                      <div className="sbom-summary-suppliers">
                        {bulkSupplierSummaries.map((group) => (
                          <div key={`${group.supplierId}-sum`} className="sbom-summary-row">
                            <span>{group.supplierName}</span>
                            <strong>{formatCurrency(group.summary.grandTotal, 'TRY')}</strong>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="sbom-summary-section sbom-summary-section-costs">
                      <div className="sbom-summary-section-head">
                        <span className="sbom-summary-section-title">Toplamlar</span>
                      </div>
                      <div className="sbom-summary-totals">
                        <div className="sbom-summary-row sbom-summary-row-strong">
                          <span>Ara Toplam</span>
                          <strong>{formatCurrency(bulkCombinedSummary.subtotal, 'TRY')}</strong>
                        </div>
                        <div className="sbom-summary-row">
                          <span>KDV</span>
                          <strong>{formatCurrency(bulkCombinedSummary.vatAmount, 'TRY')}</strong>
                        </div>
                        <div className="sbom-summary-row">
                          <span>Kargo / Lojistik</span>
                          <div className="sbom-summary-value-stack">
                            <strong>{formatCurrency(bulkCombinedSummary.shippingFee, 'TRY')}</strong>
                            {bulkDeliverySnapshot.errorCount ? (
                              <small className="sbom-inline-warning">
                                {formatNumber(bulkDeliverySnapshot.errorCount)} tedarikçi için tarife bulunamadı
                              </small>
                            ) : null}
                          </div>
                        </div>
                        <div className="sbom-summary-row sbom-summary-grand">
                          <span>Genel Toplam</span>
                          <strong>{formatCurrency(bulkCombinedSummary.grandTotal, 'TRY')}</strong>
                        </div>
                      </div>
                    </div>

                  </>
                ) : (
                  <p className="muted-text sbom-summary-empty">Onaya göndermek için önce en az bir ürün ekleyin.</p>
                )}
              </div>
            </aside>
          </div>{/* end sbom-body */}

          <div className="sbom-footer">
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setIsBulkOrderModalOpen(false);
                setBulkNoteTab('operational');
              }}
            >
              İptal
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={submitBulkForApproval}
              disabled={orderSubmitting || !bulkCart.length}
            >
              {orderSubmitting ? 'Gönderiliyor...' : 'Onaya Gönder'}
            </button>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={isBulkPreviewModalOpen}
        title="Toplu Sipariş Önizleme"
        description="Onaya göndermeden önce tedarikçi bazlı sepeti doğrulayın ve tek adımda onaya gönderin."
        headerIcon={<ShoppingBag size={18} />}
        modalClassName="supplier-bulk-preview-modal modal-header-standardized"
        onClose={() => setIsBulkPreviewModalOpen(false)}
      >
        <div className="modal-form supplier-bulk-preview-content">
          <div className="supplier-bulk-preview-shell">
            {/* Sol: tedarikçi bazlı bloklar */}
            <div className="supplier-bulk-preview-left">
              {bulkSupplierSummaries.length ? bulkSupplierSummaries.map((group) => (
                <section key={group.supplierId} className="supplier-bulk-preview-group">
                  <header className="supplier-bulk-preview-group-head">
                    <div>
                      <strong>{group.supplierName}</strong>
                      <span>{formatNumber(group.items?.length || 0)} ürün kalemi</span>
                    </div>
                    <strong className="supplier-bulk-preview-group-total">{formatCurrency(group.summary.grandTotal, 'TRY')}</strong>
                  </header>
                  <div className="supplier-bulk-preview-group-scroll">
                    <div className="supplier-bulk-preview-group-lines">
                      {(group.items || []).map((line) => (
                        <div key={line.supplierProductId} className="supplier-bulk-preview-line">
                          <span className="supplier-bulk-preview-name">{line.productName}</span>
                          <span className="supplier-bulk-preview-qty">{formatNumber(line.quantity)} {String(line.unit || '').toUpperCase()}</span>
                          <strong className="supplier-bulk-preview-price">{formatCurrency(line.lineTotal || 0, line.currency)}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="supplier-bulk-preview-group-subtotals">
                      <span>Ara Toplam: {formatCurrency(group.summary.subtotal, 'TRY')}</span>
                      <span>KDV: {formatCurrency(group.summary.vatAmount, 'TRY')}</span>
                      <span>Kargo: {formatCurrency(group.summary.shippingFee, 'TRY')}</span>
                    </div>
                  </div>
                </section>
              )) : <div className="supplier-bulk-preview-empty">Tedarikçi grubu bulunamadı.</div>}
            </div>

            {/* Sağ: genel özet */}
            <aside className="supplier-bulk-preview-right">
              <div className="supplier-bulk-preview-summary-card">
                <h5>Sipariş Özeti</h5>
                <div className="supplier-bulk-preview-summary-rows">
                  {bulkSupplierSummaries.map((group) => (
                    <div key={`${group.supplierId}-sum`} className="supplier-bulk-preview-summary-row">
                      <span>{group.supplierName}</span>
                      <strong>{formatCurrency(group.summary.grandTotal, 'TRY')}</strong>
                    </div>
                  ))}
                </div>
                <div className="supplier-bulk-preview-totals">
                  <div><span>Toplam Ürün Bedeli</span><strong>{formatCurrency(bulkCombinedSummary.subtotal, 'TRY')}</strong></div>
                  <div><span>Toplam Lojistik</span><strong>{formatCurrency(bulkCombinedSummary.shippingFee, 'TRY')}</strong></div>
                  <div><span>Toplam KDV</span><strong>{formatCurrency(bulkCombinedSummary.vatAmount, 'TRY')}</strong></div>
                  <div className="grand"><span>Nihai Genel Toplam</span><strong>{formatCurrency(bulkCombinedSummary.grandTotal, 'TRY')}</strong></div>
                  <div><span>Toplam Sipariş Miktarı</span><strong>{formatNumber(bulkTotalOrderQty)}</strong></div>
                </div>
              </div>
            </aside>
          </div>

          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={() => setIsBulkPreviewModalOpen(false)}>İptal</button>
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setIsBulkPreviewModalOpen(false);
                submitBulkForApproval();
              }}
              disabled={orderSubmitting || !bulkCart.length}
            >
              {orderSubmitting ? 'Gönderiliyor...' : `${bulkSupplierSummaries.length || 0} Tedarikçi Grubunu Onaya Gönder`}
            </button>
          </div>
        </div>
      </FormModal>
    </div>
  );
}
