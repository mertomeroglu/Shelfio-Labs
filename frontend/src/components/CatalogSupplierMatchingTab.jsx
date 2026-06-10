import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CheckCircle2, Database, Download, Eye, FileDown, FileUp, RefreshCw, Search, Tag, XCircle } from 'lucide-react';
import DataTable from './DataTable.jsx';
import FilterBar from './FilterBar.jsx';
import FormModal from './FormModal.jsx';
import { procurementService } from '../services/procurementService.js';
import { productService } from '../services/productService.js';
import { formatCurrency, formatDate, formatNumber, formatStorageTypeLabel } from '../services/formatters.js';

const loadXlsx = async () => {
  const mod = await import('xlsx');
  return mod.default || mod;
};

const initialSummary = {
  priceUpCount: 0,
  priceDownCount: 0,
  newProductCount: 0,
  removedCount: 0,
  unchangedCount: 0,
  invalidCount: 0,
};

const STATUS_ORDER = {
  'Zam Geldi': 1,
  İndirim: 2,
  'Yeni Ürün': 3,
  Kaldırıldı: 4,
  Değişmedi: 5,
  Hatalı: 6,
};

const CATALOG_TEMPLATE_COLUMNS_V2 = [
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
  'categoryPath',
  'subCategory',
  'productDescription',
  'shortDescription',
  'manufacturerCode',
  'modelCode',
  'baseUnit',
  'packSize',
  'casesPerPallet',
  'caseBarcode',
  'quantityPerPackage',
  'netWeight',
  'grossWeight',
  'volume',
  'packageType',
  'storageType',
  'listPrice',
  'recommendedSalePrice',
  'currency',
  'vatRate',
  'discountRate',
  'discountAmount',
  'campaignPrice',
  'priceValidFrom',
  'priceValidUntil',
  'maximumOrderQty',
  'orderMultiple',
  'availabilityStatus',
  'supplierStockQty',
  'supplierWarehouseCode',
  'deliveryType',
  'returnable',
  'catalogVersion',
  'catalogValidFrom',
  'catalogValidUntil',
  'supplierNote',
  'rowAction',
  'imageUrl',
  'productUrl',
  'manualNote',
  'expectedMatchHint',
  'suggestedCategory',
  'suggestedBrand',
  'suggestedUnit',
];

const CATALOG_TEMPLATE_REQUIRED = new Set([
  'productName',
  'unit',
  'purchasePrice',
  'categoryName',
  'brand',
]);

const CATALOG_TEMPLATE_SAMPLE_V2 = [
  "Algida Carte D'Or Mini Cikolata 6x60 ml",
  'SUP-ICE-0001',
  '8691000011305',
  'SHF-03-07557',
  'Adet',
  12,
  46.25,
  1,
  3,
  'Mayis ozel fiyati',
  'Dondurma',
  'Algida',
  'TRUE',
  'Gida > Dondurma > Mini Paket',
  'Mini Dondurma',
  'Cikolatali mini dondurma coklu paket.',
  'Mini cikolatali paket',
  'ALG-MINI-60',
  'CD-MINI',
  'Adet',
  '6x60 ml',
  80,
  '8691000011306',
  6,
  0.36,
  0.42,
  '360 ml',
  'Kutu',
  'Donuk',
  51.5,
  59.9,
  'TRY',
  10,
  10,
  5.25,
  46.25,
  '2026-05-01',
  '2026-05-31',
  200,
  1,
  'available',
  500,
  'IST-DONUK-01',
  'cold_chain',
  'FALSE',
  '2026-05',
  '2026-05-01',
  '2026-05-31',
  'Donuk zincirle teslim edilmelidir.',
  'upsert',
  'https://example.com/images/algida-mini.jpg',
  'https://example.com/products/algida-mini',
  'Yeni urunse kategori kontrolu yapilsin.',
  'Barkod ile eslesme beklenir.',
  'Dondurma',
  'Algida',
  'Adet',
];

const CATALOG_TEMPLATE_DESCRIPTIONS = {
  productName: 'Tedarikcinin katalogdaki urun adi.',
  supplierProductCode: 'Tedarikciye ait benzersiz urun kodu.',
  barcode: 'EAN/GTIN barkod. Yoksa supplierProductCode ile manuel kontrol yapilir.',
  sku: 'Shelfio SKU veya tedarikci stok kodu.',
  unit: 'Satis veya siparis birimi.',
  unitsPerCase: 'Koli icindeki ana birim adedi.',
  purchasePrice: 'Tedarik alis fiyati.',
  minimumOrderQty: 'Minimum siparis miktari.',
  leadTimeDays: 'Termin suresi.',
  campaignInfo: 'Kampanya veya ticari not.',
  categoryName: 'Kategori adi.',
  brand: 'Marka.',
};

const CATALOG_TEMPLATE_VALUE_LISTS = {
  unit: ['Adet', 'Koli', 'Paket', 'Kutu', 'Kg', 'Litre'],
  baseUnit: ['Adet', 'Kg', 'Litre', 'Metre'],
  currency: ['TRY', 'USD', 'EUR'],
  vatRate: [0, 1, 10, 20],
  availabilityStatus: ['available', 'limited', 'out_of_stock', 'preorder', 'inactive'],
  packageType: ['Kutu', 'Paket', 'Koli', 'Sise', 'Teneke', 'Dökme'],
  deliveryType: ['standard', 'cold_chain', 'frozen_chain', 'store_transfer'],
  rowAction: ['upsert', 'disable', 'ignore'],
  isActive: ['TRUE', 'FALSE'],
  returnable: ['TRUE', 'FALSE'],
};

const normalize = (value) => String(value || '').trim().toLowerCase('tr-TR');

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatPriceCell = (value) => (value === null || value === undefined || value === '' ? '-' : formatCurrency(value, 'TRY'));

const formatChangeCell = (value) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  const numeric = Number(value);
  const sign = numeric > 0 ? '+' : '';
  return `${sign}${numeric.toFixed(2)}%`;
};

const getStatusTone = (status) => {
  if (status === 'Zam Geldi') return 'danger';
  if (status === 'İndirim') return 'success';
  if (status === 'Yeni Ürün') return 'primary';
  if (status === 'Kaldırıldı') return 'warning';
  if (status === 'Hatalı') return 'danger';
  return 'neutral';
};

const resolveCatalogSourceLabel = (value, fallback = 'Manuel Yükleme') => {
  const label = String(value || '').trim();
  if (!label) return fallback;
  if (label.toLocaleLowerCase('tr-TR') === 'sistemden üretildi') return 'Sistem';
  return label;
};

const APPROVAL_STATUS_LABELS = {
  pending_approval: 'Onay bekliyor',
  manual_decision_pending: 'Karar bekliyor',
  manual_match_required: 'Eşleme gerekli',
  draft_created: 'Taslak oluşturuldu',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
};

const RISK_LABELS = {
  none: 'Risk yok',
  duplicate_barcode: 'Barkod çakışması',
  duplicate_supplier_code: 'Tedarikçi kodu çakışması',
  duplicate_product: 'Ürün çakışması',
  hard_delete_conflict: 'Silinen ürünle çakışıyor',
  no_match: 'Eşleşme bulunamadı',
  matched_product_missing: 'Eşleşen sistem ürünü bulunamadı',
  manual_decision_required: 'Manuel karar gerekiyor',
  manual_product_required: 'Bağlanacak ürün seçilmeli',
  duplicate_barcode_existing_product: 'Barkod başka bir üründe mevcut',
  duplicate_supplier_product_code: 'Tedarikçi ürün kodu çakışıyor',
  supplier_product_code_conflict: 'Tedarikçi ürün kodu çakışıyor',
  manual_draft_conflict: 'Taslak oluşturma çakışma nedeniyle engellendi',
  invalid_or_conflict: 'Hatalı veya çakışmalı satır',
  brand_conflict: 'Marka çakışması',
  unit_conflict: 'Birim çakışması',
  pack_size_conflict: 'Paket miktarı çakışması',
  category_conflict: 'Kategori çakışması',
};

const MATCH_TYPE_LABELS = {
  barcode: 'Barkod',
  supplierProductCode: 'Tedarikçi Ürün Kodu',
  supplier_product_code: 'Tedarikçi Ürün Kodu',
  sku: 'SKU',
  productId: 'Ürün ID',
  product_id: 'Ürün ID',
  productName: 'Ürün Adı',
  product_name: 'Ürün Adı',
  manual: 'Manuel Eşleşme',
  none: 'Eşleşme Yok',
  unknown: 'Bilinmiyor',
};

const PRICE_BASIS_LABELS = {
  unit: 'Birim',
  case: 'Koli',
  package: 'Paket',
  box: 'Kutu',
  bottle: 'Şişe',
  piece: 'Adet',
  each: 'Adet',
  unknown: 'Bilinmiyor',
  none: 'Yok',
};

const DIFF_STATUS_LABELS = {
  price_increased: 'Zam Geldi',
  price_decreased: 'İndirim Geldi',
  unchanged: 'Değişmedi',
  new_product: 'Yeni Ürün',
  new_product_candidate: 'Yeni Ürün',
  removed_product: 'Kaldırılan Ürün',
  removed_product_candidate: 'Kaldırılan Ürün',
  matched_existing_product: 'Mevcut Ürün',
  ambiguous_match: 'Eşleşme Gerekli',
  price_review_required: 'Fiyat Kontrolü Gerekli',
  invalid_row: 'Hatalı Satır',
  currency_review_required: 'Para Birimi Kontrolü Gerekli',
  vat_review_required: 'KDV Kontrolü Gerekli',
  price_scale_suspected: 'Fiyat Ölçek Şüphesi',
  none: 'Durum Yok',
  unknown: 'Bilinmiyor',
};

const MATCH_STATUS_LABELS = DIFF_STATUS_LABELS;
const STATUS_LABELS = DIFF_STATUS_LABELS;

const formatNullableLabel = (value, fallback = '—') => {
  if (value === null || value === undefined || value === '') return fallback;
  const str = String(value).trim();
  if (!str) return fallback;
  if (str === 'none') return 'Yok';
  if (str === 'unknown') return 'Bilinmiyor';
  return str;
};

const formatDiffStatus = (value) => {
  if (value === null || value === undefined || value === '') return 'Durum Yok';
  const key = String(value).trim();
  if (key === 'none') return 'Durum Yok';
  return DIFF_STATUS_LABELS[key] || 'Bilinmeyen Durum';
};

const formatMatchType = (value) => {
  if (value === null || value === undefined || value === '') return 'Eşleşme Yok';
  const key = String(value).trim();
  if (key === 'none') return 'Eşleşme Yok';
  return MATCH_TYPE_LABELS[key] || 'Bilinmiyor';
};

const formatPriceBasis = (value) => {
  if (value === null || value === undefined || value === '') return 'Yok';
  const key = String(value).trim();
  if (key === 'none') return 'Yok';
  return PRICE_BASIS_LABELS[key] || 'Bilinmiyor';
};

const formatMatchStatus = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const key = String(value).trim();
  if (key === 'none') return 'Durum Yok';
  return DIFF_STATUS_LABELS[key] || 'Bilinmeyen Durum';
};

const formatCatalogDiffStatus = (value) => {
  return formatMatchStatus(value);
};

const formatConfidence = (value) => {
  const num = Number(value || 0);
  return `%${num} güven`;
};

const TECHNICAL_LABELS = {
  available: 'Tedarik edilebilir',
  out_of_stock: 'Tedarikçide stok yok',
  limited: 'Sınırlı stok',
  preorder: 'Ön sipariş',
  inactive: 'Pasif',
  CREATE_NEW_PRODUCT: 'Yeni ürün',
  MATCHED: 'Mevcut ürünle eşleşti',
  MANUAL_MATCH: 'Manuel eşleşme gerekli',
  APPROVE_UPDATE: 'Mevcut eşleşme güncellenecek',
  INVALID: 'Hatalı satır',
  CONFLICT: 'Çakışma var',
  EXCLUDE: 'Hariç tutuldu',
  no_match: 'Eşleşme bulunamadı',
  matched_product_missing: 'Eşleşen sistem ürünü bulunamadı',
  manual_decision_required: 'Manuel karar gerekiyor',
  pending_approval: 'Onay bekliyor',
  pending: 'Onay bekliyor',
  draft: 'Taslak',
  staged: 'Katalog taslağı',
  staged_draft_product: 'Katalogdan gelen taslak',
  manual_decision_pending: 'Karar bekliyor',
  manual_match_required: 'Manuel eşleşme gerekli',
  manual_review_required: 'Manuel kontrol gerekli',
  auto_commit_ready: 'Otomatik işleme hazır',
  skipped: 'Atlandı',
  skippedBecauseCreateDraftDisabled: 'Otomatik ürün oluşturma kapalıdır',
  invalid_or_conflict: 'Hatalı veya çakışmalı satır',
  missing_manual_product: 'Bağlanacak ürün seçilmedi',
  missing_target_product: 'Eşleşen sistem ürünü bulunamadı',
  rejected: 'Reddedildi',
  resolved_manual_match: 'Mevcut ürüne bağlandı',
  resolved_draft_created: 'Taslak ürün oluşturuldu',
  draft_created: 'Taslak ürün oluşturuldu',
  manual_match: 'Mevcut ürüne bağlanacak',
  create_draft_product: 'Güvenli taslak oluşturulacak',
  skip: 'Onay için bekletilecek',
  reject: 'Reddedildi',

  // Match Types
  barcode: 'Barkod',
  supplierProductCode: 'Tedarikçi Ürün Kodu',
  supplier_product_code: 'Tedarikçi Ürün Kodu',
  sku: 'SKU',
  productId: 'Ürün ID',
  product_id: 'Ürün ID',
  productName: 'Ürün Adı',
  product_name: 'Ürün Adı',
  manual: 'Manuel Eşleşme',
  none: 'Eşleşme Yok',
  unknown: 'Bilinmiyor',

  // Price Basis
  unit: 'Birim',
  case: 'Koli',
  package: 'Paket',
  box: 'Kutu',
  bottle: 'Şişe',
  piece: 'Adet',
  each: 'Adet',
};

const TECHNICAL_SENTENCE_LABELS = {
  'Auto product creation disabled.': 'Otomatik ürün oluşturma kapalıdır.',
  'Pending approval.': 'Onay bekliyor.',
  'Draft product.': 'Taslak ürün.',
  'No match.': 'Eşleşme bulunamadı.',
  'Invalid row.': 'Hatalı satır.',
  'New catalog product was kept pending because automatic draft product creation is disabled.': 'Otomatik taslak ürün oluşturma kapalı olduğu için yeni katalog ürünü onay beklemeye alındı.',
  'New catalog product was intentionally left pending.': 'Yeni katalog ürünü daha sonra karar verilmek üzere beklemeye alındı.',
  'Manual match decision requires a selected product.': 'Mevcut ürüne bağlama kararı için bir ürün seçilmelidir.',
};

const formatTechnicalLabel = (value, labels = {}) => {
  const key = String(value || '').trim();
  if (!key) return '';
  if (labels[key]) return labels[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toLocaleUpperCase('tr-TR'));
};

const formatApprovalStatusLabel = (value) => formatTechnicalLabel(value || 'pending_approval', APPROVAL_STATUS_LABELS);

const trValue = (value, fallback = '—') => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if (raw.startsWith('match:')) return trValue(raw.slice(6), fallback);
  return TECHNICAL_SENTENCE_LABELS[raw] || TECHNICAL_LABELS[raw] || formatTechnicalLabel(raw, TECHNICAL_LABELS);
};

const trList = (values = [], fallback = '—') => {
  const list = values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => trValue(value, ''))
    .filter(Boolean);
  return list.length ? list.join(' | ') : fallback;
};

const displayValue = (value, fallback = '—') => {
  if (value === null || value === undefined || value === '') return fallback;
  return value;
};

const hasDisplayValue = (value) => value !== null && value !== undefined && value !== '';

const formatDetailCurrency = (value, currency = 'TRY', fallback = '—') => {
  if (!hasDisplayValue(value)) return fallback;
  return formatCurrency(value, currency || 'TRY');
};

const formatCurrencyVatValue = (currency, vatRate) => {
  const safeCurrency = String(currency || 'TRY').trim() || 'TRY';
  if (!hasDisplayValue(vatRate)) return `${safeCurrency} / KDV belirtilmedi`;
  return `${safeCurrency} / %${vatRate}`;
};

const formatApprovalRiskLabel = (row = {}) => {
  if (row.duplicateBarcodeRisk) return 'Barkod çakışması';
  if (row.duplicateSupplierCodeRisk) return 'Tedarikçi kodu çakışması';
  const risk = String(row.risk || '').trim();
  if (!risk || risk === 'none') return 'Risk yok';
  return formatTechnicalLabel(risk, RISK_LABELS);
};

const APPROVAL_QUEUE_FILTERS = [
  { value: 'all', label: 'Tümü' },
  { value: 'pending', label: 'Onay bekleyen' },
  { value: 'risk', label: 'Çakışma riski olan' },
  { value: 'draft_created', label: 'Taslak oluşturulan' },
  { value: 'holding', label: 'Bekletilen' },
  { value: 'rejected', label: 'Reddedilen' },
];

const APPROVAL_PENDING_STATUSES = new Set(['pending_approval', 'manual_decision_pending', 'manual_match_required', 'manual_match_needed']);
const APPROVAL_DRAFT_STATUSES = new Set(['draft_created', 'resolved_draft_created']);
const APPROVAL_MATCHED_STATUSES = new Set(['resolved_manual_match', 'resolved', 'matched']);
const APPROVAL_HOLDING_STATUSES = new Set(['skipped', 'skip', 'manual_decision_required']);

const hasApprovalRisk = (row = {}) => (
  Boolean(row.duplicateBarcodeRisk || row.duplicateSupplierCodeRisk)
  || ['duplicate_barcode', 'duplicate_supplier_code', 'matched_product_missing', 'invalid_or_conflict', 'manual_draft_conflict']
    .some((key) => String(row.risk || '').includes(key) || String(row.newProductReason || '').includes(key))
);

const getApprovalQueueTone = (row = {}) => {
  const status = String(row.status || '').trim();
  if (status === 'rejected') return 'rejected';
  if (hasApprovalRisk(row)) return 'danger';
  if (APPROVAL_DRAFT_STATUSES.has(status)) return 'primary';
  if (APPROVAL_MATCHED_STATUSES.has(status)) return 'success';
  if (APPROVAL_HOLDING_STATUSES.has(status)) return 'neutral';
  if (APPROVAL_PENDING_STATUSES.has(status)) return 'warning';
  return 'neutral';
};

const getApprovalQueueStatusLabel = (row = {}) => {
  const status = String(row.status || '').trim();
  if (status === 'rejected' && row.draftProductId) return 'Taslak reddedildi';
  if (status === 'rejected') return 'Reddedildi';
  if (hasApprovalRisk(row)) return 'Çakışma riski';
  if (APPROVAL_DRAFT_STATUSES.has(status)) return 'Taslak oluşturuldu';
  if (APPROVAL_MATCHED_STATUSES.has(status)) return 'Mevcut ürünle eşleşti';
  if (APPROVAL_HOLDING_STATUSES.has(status)) return 'Bekletiliyor';
  return formatApprovalStatusLabel(status);
};

const getApprovalQueueInfoText = (row = {}) => {
  if (String(row.status || '') === 'rejected') {
    return [
      'Bu katalog satırı sisteme alınmadı.',
      row.decisionNote ? `Reddetme notu: ${row.decisionNote}` : '',
    ].filter(Boolean).join(' ');
  }
  return [
    formatApprovalRiskLabel(row),
    trValue(row.availabilityStatus, ''),
    row.supplierStockQty !== '' && row.supplierStockQty !== undefined ? `Stok ${row.supplierStockQty}` : '',
  ].filter(Boolean).join(' · ') || '-';
};

export default function CatalogSupplierMatchingTab({ suppliers = [], products = [], isAdmin = false, onDataRefresh = null }) {
  const [supplierId, setSupplierId] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierSearchOpen, setSupplierSearchOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [supplierProducts, setSupplierProducts] = useState([]);
  const [versions, setVersions] = useState([]);
  const [approvalQueueRows, setApprovalQueueRows] = useState([]);
  const [approvalFilters, setApprovalFilters] = useState({ supplierId: '', status: 'pending', duplicateRisk: '', query: '' });
  const [approvalAction, setApprovalAction] = useState(null);
  const [approvalProductSearch, setApprovalProductSearch] = useState('');
  const [approvalSelectedProductId, setApprovalSelectedProductId] = useState('');
  const [approvalDecisionNote, setApprovalDecisionNote] = useState('');
  const [showApprovalQueue, setShowApprovalQueue] = useState(false);
  const [activeImportData, setActiveImportData] = useState(null);
  const [catalogDetail, setCatalogDetail] = useState(null);
  const [versionModalSupplierId, setVersionModalSupplierId] = useState('');
  const [rowDetail, setRowDetail] = useState(null);
  const [manualDecisions, setManualDecisions] = useState({});
  const [draftConfirmRow, setDraftConfirmRow] = useState(null);
  const [draftConfirmSubmitting, setDraftConfirmSubmitting] = useState(false);
  const [draftConfirmError, setDraftConfirmError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [approvalActionError, setApprovalActionError] = useState('');
  // Katalog görüntüleme modal state
  const [viewCatalog, setViewCatalog] = useState(null); // { version, rows }
  const [viewLoading, setViewLoading] = useState(false);
  const [backendSearchResults, setBackendSearchResults] = useState({});
  const [isSearchingBackend, setIsSearchingBackend] = useState({});
  const [approvalBackendSearchOptions, setApprovalBackendSearchOptions] = useState([]);
  const [isSearchingApprovalBackend, setIsSearchingApprovalBackend] = useState(false);

  const handleProductSearch = async (rowId, query) => {
    const trimmed = String(query || '').trim();
    if (trimmed.length < 2) {
      setBackendSearchResults((current) => {
        const next = { ...current };
        delete next[rowId];
        return next;
      });
      return;
    }
    setIsSearchingBackend((current) => ({ ...current, [rowId]: true }));
    try {
      const res = await productService.list({ search: trimmed, limit: 50 });
      let productsList = [];
      if (Array.isArray(res)) {
        productsList = res;
      } else if (res && typeof res === 'object') {
        productsList = res.data?.items?.products || res.items?.products || res.data || res.products || [];
        if (!Array.isArray(productsList)) {
          productsList = [];
        }
      }
      const mapped = productsList.map((item) => ({
        value: String(item.id),
        label: [
          item.sku,
          item.barcode,
          item.name,
          item.brand,
          item.categoryName || item.etiket,
          item.isActive === false ? 'Pasif' : 'Aktif',
          item.isListed === false ? 'Listesiz' : 'Listeli',
        ].filter(Boolean).join(' | '),
        rawItem: item,
      }));
      setBackendSearchResults((current) => ({ ...current, [rowId]: mapped }));
    } catch (err) {
      console.error('Product search error:', err);
    } finally {
      setIsSearchingBackend((current) => ({ ...current, [rowId]: false }));
    }
  };

  const handleApprovalProductSearch = async (query) => {
    const trimmed = String(query || '').trim();
    if (trimmed.length < 2) {
      setApprovalBackendSearchOptions([]);
      return;
    }
    setIsSearchingApprovalBackend(true);
    try {
      const res = await productService.list({ search: trimmed, limit: 50 });
      let productsList = [];
      if (Array.isArray(res)) {
        productsList = res;
      } else if (res && typeof res === 'object') {
        productsList = res.data?.items?.products || res.items?.products || res.data || res.products || [];
        if (!Array.isArray(productsList)) {
          productsList = [];
        }
      }
      const mapped = productsList.map((item) => ({
        value: String(item.id),
        label: [
          item.sku,
          item.barcode,
          item.name,
          item.brand,
          item.categoryName || item.etiket,
          item.isActive === false ? 'Pasif' : 'Aktif',
          item.isListed === false ? 'Listesiz' : 'Listeli',
        ].filter(Boolean).join(' | '),
        rawItem: item,
      }));
      setApprovalBackendSearchOptions(mapped);
    } catch (err) {
      console.error('Approval product search error:', err);
    } finally {
      setIsSearchingApprovalBackend(false);
    }
  };

  const uploadSectionRef = useRef(null);
  const supplierSearchRef = useRef(null);

  const loadCatalogData = async () => {
    const [versionRows, supplierProductRows, queueRows] = await Promise.all([
      procurementService.listCatalogVersions(),
      procurementService.listSupplierProducts({ fetchAll: true }),
      procurementService.listCatalogApprovalQueue(),
    ]);
    setVersions(Array.isArray(versionRows) ? versionRows : []);
    setSupplierProducts(Array.isArray(supplierProductRows) ? supplierProductRows : []);
    setApprovalQueueRows(Array.isArray(queueRows) ? queueRows : []);
  };

  useEffect(() => {
    loadCatalogData().catch((error) => {
      setMessage({ type: 'error', text: error.message || 'Katalog verileri alınamadı.' });
    });
  }, []);

  useEffect(() => {
    if (activeImportData?.importId && activeImportData?.status !== 'committed') {
      setShowApprovalQueue(false);
    }
  }, [activeImportData?.importId, activeImportData?.status]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!supplierSearchRef.current) return;
      if (!supplierSearchRef.current.contains(event.target)) {
        setSupplierSearchOpen(false);
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const supplierOptions = useMemo(
    () => suppliers
      .filter((item) => item.isActive !== false)
      .map((item) => ({ value: String(item.id), label: item.name || '-' })),
    [suppliers]
  );

  const filteredSupplierOptions = useMemo(() => {
    const query = normalize(supplierSearch);
    if (!query) return supplierOptions.slice(0, 12);
    return supplierOptions.filter((item) => normalize(item.label).includes(query)).slice(0, 12);
  }, [supplierOptions, supplierSearch]);

  const selectedSupplierOption = useMemo(
    () => supplierOptions.find((item) => item.value === String(supplierId)) || null,
    [supplierId, supplierOptions],
  );

  const productById = useMemo(() => {
    const map = new Map();
    products.forEach((item) => {
      map.set(String(item.id), item);
    });
    return map;
  }, [products]);

  const productSearchOptions = useMemo(() => products.map((item) => ({
    value: String(item.id),
    label: [
      item.sku,
      item.barcode,
      item.name,
      item.brand,
      item.categoryName || item.etiket,
      item.isActive === false ? 'Pasif' : 'Aktif',
      item.isListed === false ? 'Listesiz' : 'Listeli',
    ].filter(Boolean).join(' | '),
    searchText: normalize([
      item.sku,
      item.barcode,
      item.name,
      item.brand,
      item.categoryName || item.etiket,
      item.isActive === false ? 'pasif' : 'aktif',
      item.isListed === false ? 'listesiz' : 'listeli',
    ].filter(Boolean).join(' ')),
  })), [products]);

  const approvalProductOptions = useMemo(() => {
    const query = normalize(approvalProductSearch);
    return productSearchOptions
      .filter((item) => !query || item.searchText.includes(query))
      .slice(0, 30);
  }, [approvalProductSearch, productSearchOptions]);

  const filteredApprovalQueueRows = useMemo(() => {
    const query = normalize(approvalFilters.query);
    return approvalQueueRows.filter((row) => {
      const status = String(row.status || '').trim();
      if (approvalFilters.supplierId && String(row.supplierId) !== String(approvalFilters.supplierId)) return false;
      if (approvalFilters.status === 'pending' && (!APPROVAL_PENDING_STATUSES.has(status) || hasApprovalRisk(row))) return false;
      if (approvalFilters.status === 'risk' && !hasApprovalRisk(row)) return false;
      if (approvalFilters.status === 'draft_created' && !APPROVAL_DRAFT_STATUSES.has(status)) return false;
      if (approvalFilters.status === 'holding' && !APPROVAL_HOLDING_STATUSES.has(status)) return false;
      if (approvalFilters.status === 'rejected' && status !== 'rejected') return false;
      if (approvalFilters.duplicateRisk === 'yes' && !row.duplicateBarcodeRisk && !row.duplicateSupplierCodeRisk) return false;
      if (approvalFilters.duplicateRisk === 'no' && (row.duplicateBarcodeRisk || row.duplicateSupplierCodeRisk)) return false;
      if (!query) return true;
      return normalize([
        row.supplierName,
        row.catalogVersion,
        row.supplierProductCode,
        row.supplierSku,
        row.barcode,
        row.productName,
        row.brand,
        row.category,
        row.status,
      ].filter(Boolean).join(' ')).includes(query);
    });
  }, [approvalFilters, approvalQueueRows]);

  const versionsBySupplier = useMemo(() => {
    const map = new Map();
    versions.forEach((row) => {
      const key = String(row.supplierId || '');
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(row);
    });
    return map;
  }, [versions]);

  const currentCatalogRows = useMemo(
    () => [...versions].sort((left, right) => new Date(right.uploadedAt || 0) - new Date(left.uploadedAt || 0)),
    [versions],
  );

  const selectedSupplierProducts = useMemo(
    () => supplierProducts.filter((item) => String(item.supplierId) === String(supplierId) && item.isActive !== false),
    [supplierProducts, supplierId],
  );

  const activeCatalogForSupplier = useMemo(
    () => (versionsBySupplier.get(String(supplierId)) || []).find((item) => item.isActive === true) || null,
    [versionsBySupplier, supplierId],
  );

  const selectedSupplierVersions = useMemo(
    () => versionsBySupplier.get(String(versionModalSupplierId)) || [],
    [versionsBySupplier, versionModalSupplierId],
  );

  const existingById = useMemo(() => {
    const map = new Map();
    selectedSupplierProducts.forEach((item) => {
      map.set(String(item.id), item);
    });
    return map;
  }, [selectedSupplierProducts]);

  const existingByProductId = useMemo(() => {
    const map = new Map();
    selectedSupplierProducts.forEach((item) => {
      map.set(String(item.productId), item);
    });
    return map;
  }, [selectedSupplierProducts]);

  const existingByCode = useMemo(() => {
    const map = new Map();
    selectedSupplierProducts.forEach((item) => {
      if (item.supplierProductCode) {
        map.set(`code:${normalize(item.supplierProductCode)}`, item);
      }
      if (item.barcode) {
        map.set(`barcode:${normalize(item.barcode)}`, item);
      }
    });
    return map;
  }, [selectedSupplierProducts]);

  const previewRows = useMemo(
    () => (Array.isArray(activeImportData?.rows) ? activeImportData.rows : []),
    [activeImportData],
  );

  const uploadFileName = activeImportData?.fileName || selectedFile?.name || '-';

  const enrichedRows = useMemo(() => {
    return previewRows.map((row) => {
      const rowDecision = manualDecisions[row.rowId] || {};
      const existing = existingById.get(String(row.existingSupplierProductId))
        || existingByProductId.get(String(row.matchedProductId || ''))
        || existingByCode.get(`code:${normalize(row.supplierProductCode)}`)
        || existingByCode.get(`barcode:${normalize(row.barcode)}`)
        || null;

      const oldPrice = toNumber(existing?.purchasePrice);
      const newPrice = toNumber(row.purchasePrice);
      const priceDiff = oldPrice !== null && newPrice !== null ? Number((newPrice - oldPrice).toFixed(2)) : null;
      const changePct = oldPrice && newPrice !== null ? ((newPrice - oldPrice) / oldPrice) * 100 : null;

      let status = row.diffStatus ? formatDiffStatus(row.diffStatus) : 'Değişmedi';
      if (!row.diffStatus) {
        if (Array.isArray(row.errors) && row.errors.length > 0) {
          status = 'Hatalı Satır';
        } else if (!existing) {
          status = 'Yeni Ürün';
        } else if (priceDiff !== null && priceDiff > 0.0001) {
          status = 'Zam Geldi';
        } else if (priceDiff !== null && priceDiff < -0.0001) {
          status = 'İndirim Geldi';
        }
      }

      return {
        id: row.rowId,
        source: 'preview',
        catalogImportId: activeImportData?.importId || '',
        supplierId: activeImportData?.supplierId || supplierId || '',
        supplierName: activeImportData?.supplierName || selectedSupplierOption?.label || '',
        importFileName: uploadFileName,
        importDate: activeImportData?.uploadedAt || '',
        rowNumber: row.rowNumber || '',
        rawSheetName: row.rawSheetName || '',
        sourceRowHash: row.sourceRowHash || '',
        productName: row.excelProductName || existing?.supplierProductName || productById.get(String(row.matchedProductId || ''))?.name || '-',
        supplierSku: row.sku || '',
        brandName: row.brand || '',
        categoryName: row.categoryName || '',
        unit: row.unit || '',
        packSize: row.packSize || row.unitsPerCase || '',
        unitsPerCase: row.unitsPerCase || '',
        baseUnit: row.baseUnit || '',
        casesPerPallet: row.casesPerPallet || '',
        caseBarcode: row.caseBarcode || '',
        quantityPerPackage: row.quantityPerPackage || row.unitsPerCase || '',
        netWeight: row.netWeight || '',
        grossWeight: row.grossWeight || '',
        volume: row.volume || '',
        packageType: row.packageType || '',
        storageType: row.storageType || '',
        vatRate: row.vatRate || '',
        listPrice: row.listPrice || '',
        recommendedSalePrice: row.recommendedSalePrice || '',
        discountRate: row.discountRate || '',
        discountAmount: row.discountAmount || '',
        campaignPrice: row.campaignPrice || '',
        priceValidFrom: row.priceValidFrom || '',
        priceValidUntil: row.priceValidUntil || '',
        currency: row.currency || existing?.currency || 'TRY',
        minOrderQuantity: row.minimumOrderQty || '',
        maximumOrderQty: row.maximumOrderQty || '',
        orderMultiple: row.orderMultiple || '',
        leadTimeDays: row.leadTimeDays || '',
        campaignInfo: row.campaignInfo || '',
        availabilityStatus: row.availabilityStatus || (row.isActive === false ? 'inactive' : 'available'),
        supplierStockQty: row.supplierStockQty || '',
        supplierWarehouseCode: row.supplierWarehouseCode || '',
        deliveryType: row.deliveryType || '',
        returnable: row.returnable ?? '',
        catalogVersion: row.catalogVersion || '',
        catalogValidFrom: row.catalogValidFrom || '',
        catalogValidUntil: row.catalogValidUntil || '',
        description: row.productDescription || row.shortDescription || row.description || row.campaignInfo || '',
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
        barcode: row.barcode || existing?.barcode || '-',
        supplierProductCode: row.supplierProductCode || existing?.supplierProductCode || '-',
        status,
        matchedBy: row.matchedBy || 'none',
        purchasePriceBasis: row.purchasePriceBasis || 'unknown',
        oldPurchasePriceBasis: row.oldPurchasePriceBasis || 'unknown',
        diffStatus: row.diffStatus || '',
        oldPrice,
        newPrice,
        priceDiff,
        changePct,
        oldMoq: toNumber(existing?.minimumOrderQty),
        newMoq: toNumber(row.minimumOrderQty),
        oldCase: toNumber(existing?.unitsPerCase),
        newCase: toNumber(row.unitsPerCase),
        oldCatalogName: activeCatalogForSupplier?.fileName || '-',
        newCatalogName: uploadFileName,
        existingSupplierProductId: existing?.id || row.existingSupplierProductId || '',
        existingSupplierProductCode: row.existingSupplierProductCode || existing?.supplierProductCode || '',
        matchedProductId: row.matchedProductId || existing?.productId || '',
        matchedSku: row.matchedSku || productById.get(String(row.matchedProductId || ''))?.sku || '',
        matchedBarcode: row.matchedBarcode || productById.get(String(row.matchedProductId || ''))?.barcode || '',
        matchedProductName: row.matchedProductName || productById.get(String(row.matchedProductId || ''))?.name || '',
        matchedBrand: row.matchedBrand || productById.get(String(row.matchedProductId || ''))?.brand || '',
        matchedCategory: row.matchedCategory || productById.get(String(row.matchedProductId || ''))?.categoryName || productById.get(String(row.matchedProductId || ''))?.etiket || '',
        matchedUnit: row.matchedUnit || productById.get(String(row.matchedProductId || ''))?.unit || '',
        matchStatus: row.matchStatus || '',
        actionType: row.actionType || '',
        confidence: row.confidenceScore ?? '',
        confidenceLabel: row.confidenceLabel || '',
        decision: rowDecision.decision || row.decision || '',
        reason: row.reason || row.matchReason || '',
        riskLevel: row.riskLevel || '',
        blockingIssue: row.blockingIssue || '',
        duplicateBarcode: Boolean(row.duplicateBarcode),
        duplicateSupplierCode: Boolean(row.duplicateSupplierCode),
        invalidBarcode: Boolean(row.invalidBarcode),
        missingRequiredFields: Boolean(row.missingRequiredFields || row.errors?.length),
        missingRequiredFieldNames: row.missingRequiredFieldNames || [],
        manualActionRequired: Boolean(row.manualActionRequired),
        suggestedAction: row.suggestedAction || '',
        manualDecision: rowDecision.decision || row.manualDecision || '',
        manualProductId: rowDecision.manualProductId || row.manualProductId || '',
        manualProductSku: productById.get(String(rowDecision.manualProductId || row.manualProductId || ''))?.sku || row.manualProductSku || '',
        manualProductName: productById.get(String(rowDecision.manualProductId || row.manualProductId || ''))?.name || row.manualProductName || '',
        manualDecisionNote: rowDecision.decisionNote || row.manualDecisionNote || row.decisionNote || '',
        canCommit: Boolean(row.canCommit),
        canCreateDraftProduct: row.actionType === 'CREATE_NEW_PRODUCT' && !row.duplicateBarcode && !row.duplicateSupplierCode && !row.invalidBarcode && !row.missingRequiredFields,
        createdByManualApproval: rowDecision.decision === 'create_draft_product',
        pendingApprovalReason: row.pendingApprovalReason || (row.actionType === 'CREATE_NEW_PRODUCT' ? 'manual_decision_required' : ''),
        willCreateProduct: rowDecision.decision === 'create_draft_product' || Boolean(row.willCreateProduct),
        willUpdateSupplierProduct: rowDecision.decision === 'manual_match' || rowDecision.decision === 'create_draft_product' || Boolean(row.willUpdateSupplierProduct),
        willSkipPendingApproval: rowDecision.decision === 'skip' || (!rowDecision.decision && Boolean(row.willSkipPendingApproval)),
        createsDraftProductAutomatically: Boolean(row.createsDraftProductAutomatically),
        expectedCreateDraftProductsFlag: Boolean(row.expectedCreateDraftProductsFlag),
        catalogVisibility: row.catalogVisibility || '',
        productIsListed: row.productIsListed ?? '',
        productIsActive: row.productIsActive ?? '',
        hardDeleteConflictRisk: Boolean(row.hardDeleteConflictRisk),
        note: row.note || '',
        errors: row.errors || [],
      };
    });
  }, [activeCatalogForSupplier?.fileName, activeImportData?.importId, activeImportData?.supplierId, activeImportData?.supplierName, activeImportData?.uploadedAt, existingByCode, existingById, existingByProductId, manualDecisions, previewRows, productById, selectedSupplierOption?.label, supplierId, uploadFileName]);

  const removedRows = useMemo(() => {
    if (!previewRows.length) return [];

    const existingIdSet = new Set(enrichedRows.map((item) => String(item.existingSupplierProductId || '')).filter(Boolean));
    const productIdSet = new Set(enrichedRows.map((item) => String(item.matchedProductId || '')).filter(Boolean));
    const codeSet = new Set(
      previewRows
        .map((item) => `code:${normalize(item.supplierProductCode)}`)
        .filter((value) => value !== 'code:')
    );
    const barcodeSet = new Set(
      previewRows
        .map((item) => `barcode:${normalize(item.barcode)}`)
        .filter((value) => value !== 'barcode:')
    );

    return selectedSupplierProducts
      .filter((item) => {
        if (existingIdSet.has(String(item.id || ''))) return false;
        if (productIdSet.has(String(item.productId || ''))) return false;
        if (item.supplierProductCode && codeSet.has(`code:${normalize(item.supplierProductCode)}`)) return false;
        if (item.barcode && barcodeSet.has(`barcode:${normalize(item.barcode)}`)) return false;
        return true;
      })
      .map((item) => ({
        id: `removed-${item.id}`,
        source: 'removed',
        productName: item.supplierProductName || productById.get(String(item.productId))?.name || '-',
        barcode: item.barcode || '-',
        supplierProductCode: item.supplierProductCode || '-',
        status: 'Kaldırılan Ürün',
        oldPrice: toNumber(item.purchasePrice),
        newPrice: null,
        priceDiff: null,
        changePct: null,
        oldMoq: toNumber(item.minimumOrderQty),
        newMoq: null,
        oldCase: toNumber(item.unitsPerCase),
        newCase: null,
        oldCatalogName: activeCatalogForSupplier?.fileName || '-',
        newCatalogName: uploadFileName,
        existingSupplierProductId: item.id,
        matchedProductId: item.productId,
        errors: [],
      }));
  }, [activeCatalogForSupplier?.fileName, enrichedRows, previewRows, productById, selectedSupplierProducts, uploadFileName]);

  const diffRows = useMemo(
    () => [...enrichedRows, ...removedRows].sort((left, right) => {
      const leftRank = STATUS_ORDER[left.status] || 99;
      const rightRank = STATUS_ORDER[right.status] || 99;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return String(left.productName || '').localeCompare(String(right.productName || ''), 'tr');
    }),
    [enrichedRows, removedRows],
  );

  const summary = useMemo(() => {
    const next = { ...initialSummary };

    diffRows.forEach((row) => {
      if (row.status === 'Zam Geldi') next.priceUpCount += 1;
      if (row.status === 'İndirim' || row.status === 'İndirim Geldi') next.priceDownCount += 1;
      if (row.status === 'Yeni Ürün') next.newProductCount += 1;
      if (row.status === 'Kaldırıldı' || row.status === 'Kaldırılan Ürün') next.removedCount += 1;
      if (row.status === 'Değişmedi') next.unchangedCount += 1;
      if (row.status === 'Hatalı' || row.status === 'Hatalı Satır') next.invalidCount += 1;
      if (row.status === 'Eşleşme Gerekli') next.ambiguousCount += 1;
      if ([
        'Fiyat Kontrolü Gerekli',
        'Para Birimi Kontrolü Gerekli',
        'KDV Kontrolü Gerekli',
        'KDV Bazı Kontrolü Gerekli',
        'Fiyat Ölçek Şüphesi',
        'Manuel İnceleme',
      ].includes(row.status)) next.priceReviewCount += 1;
    });

    return next;
  }, [diffRows]);

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
  };

  const handleViewCatalog = async (version) => {
    setViewLoading(true);
    try {
      const rows = await procurementService.getCatalogVersionRows(version.id);
      setViewCatalog({ version, rows: Array.isArray(rows) ? rows : [] });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Katalog satırları alınamadı.' });
    } finally {
      setViewLoading(false);
    }
  };

  const handleDownloadExcel = async (version) => {
    try {
      const XLSX = await loadXlsx();
      const rows = await procurementService.getCatalogVersionRows(version.id);
      if (!Array.isArray(rows) || !rows.length) {
        setMessage({ type: 'error', text: 'İndirilecek katalog satırı bulunamadı.' });
        return;
      }

      const header = [
        'Sıra', 'SKU', 'Barkod', 'Ürün Adı', 'Marka', 'Ana Kategori', 'Alt Kategori / Etiket',
        'Birim', 'Koli İçi Adet', 'Palet Koli Adedi', 'Saklama Tipi',
        'Referans Alış (TRY)', 'MOQ Birim Alış (TRY)', '10+ Koli Birim Alış (TRY)',
        'Liste Fiyatı', 'Önerilen Satış', 'Para Birimi', 'KDV', 'Bulunurluk', 'Tedarikçi Stok',
        'Açıklama', 'Tedarikçi Notu', 'Min Sipariş (Koli)', 'Teslimat (Gün)',
      ];

      const dataRows = rows.map((r) => [
        r.rowIndex,
        r.sku,
        r.barcode,
        r.productName,
        r.brand,
        r.categoryName,
        r.subCategory,
        r.unit,
        r.unitsPerCase,
        r.casesPerPallet,
        formatStorageTypeLabel(r.storageType),
        r.purchasePrice,
        r.moqUnitPrice,
        r.bulk10PlusUnitPrice,
        r.listPrice,
        r.recommendedSalePrice,
        r.currency,
        r.vatRate,
        r.availabilityStatus,
        r.supplierStockQty,
        r.productDescription,
        r.supplierNote,
        r.minimumOrderQty,
        r.leadTimeDays,
      ]);

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
      ws['!cols'] = header.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
      XLSX.utils.book_append_sheet(wb, ws, 'Katalog');
      const safeName = String(version.supplierName || 'katalog').replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ _-]/g, '').trim();
      XLSX.writeFile(wb, `${safeName}-katalog-v${version.versionNo || 1}.xlsx`);
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Excel indirme başarısız.' });
    }
  };

  const toExportValue = (value) => {
    if (value === true) return 'TRUE';
    if (value === false) return 'FALSE';
    if (value === null || value === undefined || value === '') return '-';
    if (Array.isArray(value)) return value.join(' | ');
    return value;
  };

  const buildPreviewExportRows = (rows) => rows.map((row) => ({
    catalogImportId: activeImportData?.importId || row.catalogImportId || '',
    catalogVersionId: '',
    supplierId: row.supplierId || activeImportData?.supplierId || supplierId || '',
    supplierName: row.supplierName || activeImportData?.supplierName || selectedSupplierOption?.label || '',
    importFileName: row.importFileName || uploadFileName,
    importDate: row.importDate || activeImportData?.uploadedAt || '',
    rowNumber: row.rowNumber || '',
    rawSheetName: row.rawSheetName || '',
    sourceRowHash: row.sourceRowHash || '',
    supplierProductCode: row.supplierProductCode,
    supplierSku: row.supplierSku,
    barcode: row.barcode,
    productName: row.productName,
    brandName: row.brandName,
    categoryName: row.categoryName,
    unit: row.unit,
    baseUnit: row.baseUnit,
    packSize: row.packSize,
    casesPerPallet: row.casesPerPallet,
    caseBarcode: row.caseBarcode,
    unitsPerCase: row.unitsPerCase,
    quantityPerPackage: row.quantityPerPackage,
    netWeight: row.netWeight,
    grossWeight: row.grossWeight,
    volume: row.volume,
    packageType: row.packageType,
    storageType: row.storageType,
    vatRate: row.vatRate,
    purchasePrice: row.newPrice,
    listPrice: row.listPrice,
    recommendedSalePrice: row.recommendedSalePrice,
    discountRate: row.discountRate,
    discountAmount: row.discountAmount,
    campaignPrice: row.campaignPrice,
    priceValidFrom: row.priceValidFrom,
    priceValidUntil: row.priceValidUntil,
    currency: row.currency,
    minOrderQuantity: row.minOrderQuantity,
    maximumOrderQty: row.maximumOrderQty,
    orderMultiple: row.orderMultiple,
    leadTimeDays: row.leadTimeDays,
    availabilityStatus: row.availabilityStatus,
    supplierStockQty: row.supplierStockQty,
    supplierWarehouseCode: row.supplierWarehouseCode,
    deliveryType: row.deliveryType,
    returnable: row.returnable,
    catalogVersion: row.catalogVersion,
    catalogValidFrom: row.catalogValidFrom,
    catalogValidUntil: row.catalogValidUntil,
    description: row.description,
    productDescription: row.productDescription,
    shortDescription: row.shortDescription,
    manufacturerCode: row.manufacturerCode,
    modelCode: row.modelCode,
    imageUrl: row.imageUrl,
    productUrl: row.productUrl,
    supplierNote: row.supplierNote,
    rowAction: row.rowAction,
    manualNote: row.manualNote,
    expectedMatchHint: row.expectedMatchHint,
    suggestedCategory: row.suggestedCategory,
    suggestedBrand: row.suggestedBrand,
    suggestedUnit: row.suggestedUnit,
    matchedProductId: row.matchedProductId,
    matchedSku: row.matchedSku,
    matchedBarcode: row.matchedBarcode,
    matchedProductName: row.matchedProductName,
    matchedBrand: row.matchedBrand,
    matchedCategory: row.matchedCategory,
    matchedUnit: row.matchedUnit,
    existingSupplierProductId: row.existingSupplierProductId,
    existingSupplierProductCode: row.existingSupplierProductCode,
    matchStatus: row.matchStatus,
    actionType: row.actionType,
    confidence: row.confidence,
    confidenceLabel: row.confidenceLabel,
    decision: row.decision,
    reason: row.reason,
    riskLevel: row.riskLevel,
    blockingIssue: row.blockingIssue,
    duplicateBarcode: row.duplicateBarcode,
    duplicateSupplierCode: row.duplicateSupplierCode,
    invalidBarcode: row.invalidBarcode,
    missingRequiredFields: row.missingRequiredFields,
    missingRequiredFieldNames: row.missingRequiredFieldNames,
    manualActionRequired: row.manualActionRequired,
    suggestedAction: row.suggestedAction,
    manualDecision: row.manualDecision,
    manualProductId: row.manualProductId,
    manualProductSku: row.manualProductSku,
    manualProductName: row.manualProductName,
    decisionNote: row.manualDecisionNote,
    canCreateDraftProduct: row.canCreateDraftProduct,
    createdByManualApproval: row.createdByManualApproval,
    pendingApprovalReason: row.pendingApprovalReason,
    canCommit: row.canCommit,
    willCreateProduct: row.willCreateProduct,
    willUpdateSupplierProduct: row.willUpdateSupplierProduct,
    willSkipPendingApproval: row.willSkipPendingApproval,
    createsDraftProductAutomatically: row.createsDraftProductAutomatically,
    expectedCreateDraftProductsFlag: row.expectedCreateDraftProductsFlag,
    catalogVisibility: row.catalogVisibility,
    productIsListed: row.productIsListed,
    productIsActive: row.productIsActive,
    hardDeleteConflictRisk: row.hardDeleteConflictRisk,
    note: row.note,
    oldPrice: row.oldPrice,
    newPrice: row.newPrice,
    priceDiff: row.priceDiff,
    changePct: row.changePct,
    oldMoq: row.oldMoq,
    newMoq: row.newMoq,
    oldCase: row.oldCase,
    newCase: row.newCase,
    uiStatus: row.status,
    errors: row.errors,
  })).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toExportValue(value)])));

  const appendSheet = (XLSX, workbook, name, rows) => {
    const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: 'No rows' }]);
    worksheet['!cols'] = Object.keys(rows[0] || { note: '' }).map((key) => ({ wch: Math.min(Math.max(String(key).length + 4, 14), 34) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, name);
  };

  const buildApprovalExportRows = (rows) => rows.map((row) => ({
    supplierName: row.supplierName || '',
    catalogVersion: row.catalogVersion || row.fileName || '',
    rowNumber: row.rowNumber || '',
    barcode: row.barcode || '',
    supplierProductCode: row.supplierProductCode || '',
    productName: row.productName || '',
    brand: row.brand || '',
    category: row.category || '',
    unit: row.unit || '',
    packSize: row.packSize || '',
    unitsPerCase: row.unitsPerCase || '',
    quantityPerPackage: row.quantityPerPackage || '',
    purchasePrice: row.purchasePrice ?? '',
    listPrice: row.listPrice ?? '',
    recommendedSalePrice: row.recommendedSalePrice ?? '',
    status: row.status || '',
    availabilityStatus: row.availabilityStatus || '',
    supplierStockQty: row.supplierStockQty ?? '',
    vatRate: row.vatRate ?? '',
    productDescription: row.productDescription || row.shortDescription || '',
    supplierNote: row.supplierNote || '',
    missingRequiredFields: Array.isArray(row.missingRequiredFieldNames) ? row.missingRequiredFieldNames.join(', ') : '',
    risk: row.risk || '',
    suggestedAction: row.suggestedAction || '',
    decisionNote: row.decisionNote || '',
    draftProductId: row.draftProductId || '',
    matchedProductId: row.matchedProductId || '',
  }));

  const handleDownloadApprovalQueueExcel = async () => {
    const XLSX = await loadXlsx();
    const rows = buildApprovalExportRows(filteredApprovalQueueRows);
    const workbook = XLSX.utils.book_new();
    appendSheet(XLSX, workbook, 'Summary', [
      { metric: 'totalRows', value: rows.length },
      { metric: 'pendingRows', value: filteredApprovalQueueRows.filter((row) => row.sourceType === 'catalog_import_row').length },
      { metric: 'draftProducts', value: filteredApprovalQueueRows.filter((row) => row.sourceType === 'staged_draft_product').length },
      { metric: 'duplicateRisks', value: filteredApprovalQueueRows.filter((row) => row.duplicateBarcodeRisk || row.duplicateSupplierCodeRisk).length },
      { metric: 'rejectedIgnored', value: filteredApprovalQueueRows.filter((row) => row.status === 'rejected').length },
    ]);
    appendSheet(XLSX, workbook, 'Pending Rows', rows.filter((row) => !['draft_created', 'rejected'].includes(row.status)));
    appendSheet(XLSX, workbook, 'Draft Products', rows.filter((row) => row.status === 'draft_created' || row.draftProductId));
    appendSheet(XLSX, workbook, 'Duplicate Risks', rows.filter((row) => row.risk && row.risk !== 'none'));
    appendSheet(XLSX, workbook, 'Rejected Ignored', rows.filter((row) => row.status === 'rejected'));
    XLSX.writeFile(workbook, 'urun-onay-kuyrugu.xlsx');
  };

  const handleDownloadPreviewExcel = async () => {
    if (!diffRows.length) {
      setMessage({ type: 'error', text: 'İndirilecek önizleme satırı bulunamadı.' });
      return;
    }
    const XLSX = await loadXlsx();

    const details = buildPreviewExportRows(diffRows);
    const manualRows = details.filter((row) => row.manualActionRequired === 'TRUE');
    const conflictRows = details.filter((row) => row.actionType === 'INVALID' || row.actionType === 'CONFLICT' || row.missingRequiredFields === 'TRUE');
    const newPendingRows = details.filter((row) => row.actionType === 'CREATE_NEW_PRODUCT' || row.willSkipPendingApproval === 'TRUE');
    const newPendingSheetRows = newPendingRows.map((row) => ({
      suggestedProductName: row.productName,
      barcode: row.barcode,
      supplierProductCode: row.supplierProductCode,
      brand: row.brandName,
      category: row.categoryName,
      unit: row.unit,
      packSize: row.packSize,
      unitsPerCase: row.unitsPerCase,
      quantityPerPackage: row.quantityPerPackage,
      purchasePrice: row.purchasePrice,
      listPrice: row.listPrice,
      recommendedSalePrice: row.recommendedSalePrice,
      currency: row.currency,
      vatRate: row.vatRate,
      availabilityStatus: row.availabilityStatus,
      supplierStockQty: row.supplierStockQty,
      productDescription: row.productDescription || row.description,
      supplierNote: row.supplierNote,
      decisionStatus: row.manualDecision || 'manual_decision_pending',
      suggestedAction: row.suggestedAction,
      decisionNote: row.decisionNote,
    }));
    const summaryRows = [
      { metric: 'catalogImportId', value: activeImportData?.importId || '-' },
      { metric: 'supplierId', value: activeImportData?.supplierId || supplierId || '-' },
      { metric: 'supplierName', value: activeImportData?.supplierName || selectedSupplierOption?.label || '-' },
      { metric: 'importFileName', value: uploadFileName },
      { metric: 'totalRows', value: diffRows.length },
      { metric: 'matchedOrUpdated', value: details.filter((row) => row.actionType === 'MATCHED').length },
      { metric: 'manualActionRequired', value: manualRows.length },
      { metric: 'newProductsPendingApproval', value: newPendingRows.length },
      { metric: 'invalidOrConflictRows', value: conflictRows.length },
      { metric: 'createDraftProductsDefault', value: 'FALSE' },
      { metric: 'createdProductsByDefault', value: 0 },
    ];

    const workbook = XLSX.utils.book_new();
    appendSheet(XLSX, workbook, 'Preview Summary', summaryRows);
    appendSheet(XLSX, workbook, 'Row Details', details);
    appendSheet(XLSX, workbook, 'Manual Actions Needed', manualRows);
    appendSheet(XLSX, workbook, 'Conflicts Invalid Rows', conflictRows);
    appendSheet(XLSX, workbook, 'New Products Pending', newPendingSheetRows);

    const safeName = String(activeImportData?.supplierName || selectedSupplierOption?.label || 'katalog-onizleme')
      .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ _-]/g, '')
      .trim() || 'katalog-onizleme';
    XLSX.writeFile(workbook, `${safeName}-katalog-onizleme-detay.xlsx`);
  };

  const handleSelectSupplier = (option) => {
    setSupplierId(String(option.value));
    setSupplierSearch(option.label || '');
    setSupplierSearchOpen(false);
  };

  const downloadTemplate = async () => {
    const XLSX = await loadXlsx();
    const workbook = XLSX.utils.book_new();
    const templateSheet = XLSX.utils.aoa_to_sheet([CATALOG_TEMPLATE_COLUMNS_V2, CATALOG_TEMPLATE_SAMPLE_V2]);
    templateSheet['!cols'] = CATALOG_TEMPLATE_COLUMNS_V2.map((item) => ({ wch: Math.min(Math.max(item.length + 4, 16), 34) }));
    templateSheet['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(workbook, templateSheet, 'KatalogSablonu');

    const dictionaryRows = CATALOG_TEMPLATE_COLUMNS_V2.map((column) => ({
      kolonAdi: column,
      aciklama: CATALOG_TEMPLATE_DESCRIPTIONS[column] || 'Opsiyonel katalog detayi.',
      zorunluMu: CATALOG_TEMPLATE_REQUIRED.has(column) || column === 'supplierProductCode' || column === 'barcode' ? 'Kosullu' : 'Hayir',
      ornekDeger: CATALOG_TEMPLATE_SAMPLE_V2[CATALOG_TEMPLATE_COLUMNS_V2.indexOf(column)] ?? '',
      sistemdeKullaniliyorMu: 'Evet',
      katalogKartindaGorunurMu: 'Evet',
      yeniUrunEslesmesineEtkisiVarMi: ['barcode', 'supplierProductCode', 'brand', 'unit', 'unitsPerCase', 'categoryName', 'categoryPath'].includes(column) ? 'Evet' : 'Hayir',
      backendDurumu: 'Okunuyor',
    }));
    const dictionarySheet = XLSX.utils.json_to_sheet(dictionaryRows);
    dictionarySheet['!cols'] = Object.keys(dictionaryRows[0]).map((key) => ({ wch: Math.max(key.length + 4, 18) }));
    XLSX.utils.book_append_sheet(workbook, dictionarySheet, 'AlanSozlugu');

    const maxValueRows = Math.max(...Object.values(CATALOG_TEMPLATE_VALUE_LISTS).map((list) => list.length));
    const valueHeaders = Object.keys(CATALOG_TEMPLATE_VALUE_LISTS);
    const valueRows = Array.from({ length: maxValueRows }, (_, index) => valueHeaders.map((key) => CATALOG_TEMPLATE_VALUE_LISTS[key][index] ?? ''));
    const valueSheet = XLSX.utils.aoa_to_sheet([valueHeaders, ...valueRows]);
    valueSheet['!cols'] = valueHeaders.map((key) => ({ wch: Math.max(key.length + 4, 16) }));
    XLSX.utils.book_append_sheet(workbook, valueSheet, 'DegerListeleri');

    const exampleRows = [
      CATALOG_TEMPLATE_COLUMNS_V2,
      CATALOG_TEMPLATE_SAMPLE_V2,
      CATALOG_TEMPLATE_COLUMNS_V2.map((column) => (column === 'barcode' ? '8691000099999' : column === 'productName' ? 'Yeni Katalog Urunu' : '')),
    ];
    const exampleSheet = XLSX.utils.aoa_to_sheet(exampleRows);
    exampleSheet['!cols'] = templateSheet['!cols'];
    XLSX.utils.book_append_sheet(workbook, exampleSheet, 'OrnekYeniUrun');

    const readmeSheet = XLSX.utils.aoa_to_sheet([
      ['Konu', 'Aciklama'],
      ['Dosya', 'katalog-sablonu-v2.xlsx'],
      ['Kolon sayisi', CATALOG_TEMPLATE_COLUMNS_V2.length],
      ['Eski kolonlar', 'Ilk 13 kolon ayni sirada korunur.'],
      ['Yeni urun', 'Otomatik urun olusturulmaz; onay kuyruguna duser.'],
      ['Para birimi', 'Bos birakilirsa TRY varsayilir.'],
      ['Zorunlu alanlar', 'productName, unit, purchasePrice, categoryName, brand ve supplierProductCode veya barcode.'],
    ]);
    readmeSheet['!cols'] = [{ wch: 24 }, { wch: 96 }];
    XLSX.utils.book_append_sheet(workbook, readmeSheet, 'README');

    XLSX.writeFile(workbook, 'katalog-sablonu-v2.xlsx');
  };

  const handleStartUpload = async () => {
    const file = selectedFile;
    if (!file) return;

    if (!supplierId) {
      setMessage({ type: 'error', text: 'Önce tedarikçi seçmeden katalog yükleme başlatılamaz.' });
      return;
    }

    try {
      setLoading(true);
      setMessage(null);

      const XLSX = await loadXlsx();
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const parsedRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      const preview = await procurementService.previewCatalogImport({
        supplierId,
        fileName: file.name,
        rows: parsedRows,
      });

      setActiveImportData(preview);
      setManualDecisions({});
      setMessage({ type: 'success', text: 'Katalog parse edildi. Otomatik fark analizi tabloya işlendi.' });
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Excel import önizlemesi oluşturulamadı.' });
    } finally {
      setLoading(false);
    }
  };

  const updateManualDecision = (rowId, patch) => {
    setManualDecisions((current) => ({
      ...current,
      [rowId]: {
        ...(current[rowId] || {}),
        ...patch,
      },
    }));
  };

  const clearManualDecision = (rowId) => {
    setManualDecisions((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
  };

  const confirmPreviewDraftDecision = async () => {
    if (!draftConfirmRow) return;
    try {
      setDraftConfirmSubmitting(true);
      setDraftConfirmError('');
      updateManualDecision(draftConfirmRow.id, { decision: 'create_draft_product', manualProductId: '' });
      setMessage({
        type: 'success',
        text: 'Güvenli taslak kararı seçildi. Farkları onayladığınızda ürün satışa açılmadan onay bekleyen taslak olarak kaydedilecek.',
      });
      setDraftConfirmRow(null);
    } catch (error) {
      const errorMessage = error.message || 'Taslak kararı uygulanamadı.';
      setDraftConfirmError(errorMessage);
      setMessage({ type: 'error', text: 'Taslak oluşturulamadı. Lütfen hata detayını kontrol edin.' });
    } finally {
      setDraftConfirmSubmitting(false);
    }
  };

  const buildCommitRowDecisions = () => Object.entries(manualDecisions)
    .map(([rowId, value]) => ({
      rowId,
      decision: value.decision,
      manualProductId: value.manualProductId || '',
      decisionNote: value.decisionNote || '',
    }))
    .filter((item) => item.decision);

  const handleCommit = async () => {
    if (!activeImportData?.importId) return;

    try {
      setLoading(true);
      const result = await procurementService.commitCatalogImport(activeImportData.importId, {
        createDraftProducts: false,
        rowDecisions: buildCommitRowDecisions(),
      });
      const report = result?.commitReport || result?.summary || {};
      const pendingCount = Number(report.newProductPendingApprovalCount || 0) + Number(report.manualSkippedCount || 0);
      setMessage({
        type: 'success',
        text: `Katalog farkları işlendi. Yeni ürünler bekleyen onaylara aktarıldı. Güncellenen eşleşme: ${formatNumber(report.updatedSupplierProductCount || 0)}. Bekleyen karar: ${formatNumber(pendingCount)}. Oluşturulan ürün: ${formatNumber(report.createdProductCount || 0)}.`,
      });
      setActiveImportData((current) => ({
        ...(current || {}),
        status: result.status || 'committed',
        commitReport: report,
        pendingApprovalRows: result?.pendingApprovalRows || [],
        invalidRows: result?.invalidRows || [],
      }));
      await loadCatalogData();
      setShowApprovalQueue(pendingCount > 0);
      if (typeof onDataRefresh === 'function') {
        await onDataRefresh();
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Katalog içe aktarımı başarısız oldu.' });
    } finally {
      setLoading(false);
    }
  };

  const openApprovalAction = (type, row) => {
    setApprovalAction({ type, row });
    setApprovalProductSearch('');
    setApprovalSelectedProductId('');
    setApprovalDecisionNote('');
    setApprovalActionError('');
  };

  const closeApprovalAction = () => {
    setApprovalAction(null);
    setApprovalProductSearch('');
    setApprovalSelectedProductId('');
    setApprovalDecisionNote('');
    setApprovalActionError('');
  };

  const handleApprovalActionSubmit = async () => {
    if (!approvalAction?.row) return;
    const formatApiFieldErrors = (payload = {}) => Object.values(payload.fieldErrors || {})
      .filter(Boolean)
      .join(' ');
    try {
      setLoading(true);
      setApprovalActionError('');
      if (approvalAction.type === 'match') {
        await procurementService.matchCatalogApprovalQueueRow(approvalAction.row.id, {
          manualProductId: approvalSelectedProductId,
          decisionNote: approvalDecisionNote,
        });
        setMessage({ type: 'success', text: 'Katalog satırı mevcut sistem ürününe bağlandı. Yeni ürün oluşturulmadı.' });
      } else if (approvalAction.type === 'create_draft') {
        const result = await procurementService.createCatalogApprovalQueueDraft(approvalAction.row.id, {
          decisionNote: approvalDecisionNote,
        });
        const draftProductId = result?.draftProductId || result?.product?.id || '';
        setApprovalQueueRows((current) => current.map((row) => (
          row.id === approvalAction.row.id
            ? {
              ...row,
              sourceType: 'staged_draft_product',
              status: 'draft_created',
              draftProductId,
              draftProductSku: result?.product?.sku || row.draftProductSku || '',
              decisionNote: 'Ürün taslağı oluşturuldu. Taslak / Eksik Ürünler filtresinde tamamlayabilirsiniz.',
              canCreateDraftProduct: false,
            }
            : row
        )));
        setMessage({
          type: 'success',
          text: draftProductId
            ? `Ürün taslağı oluşturuldu. Taslak / Eksik Ürünler filtresinde tamamlayabilirsiniz. ID: ${draftProductId}`
            : 'Ürün taslağı oluşturuldu. Taslak / Eksik Ürünler filtresinde tamamlayabilirsiniz.',
        });
      } else if (approvalAction.type === 'reject') {
        await procurementService.rejectCatalogApprovalQueueRow(approvalAction.row.id, {
          reason: approvalDecisionNote,
        });
        setMessage({ type: 'success', text: 'Katalog satırı reddedildi. Ürün oluşturulmadı ve eşleşme yapılmadı.' });
      } else if (approvalAction.type === 'undo') {
        await procurementService.undoCatalogApprovalQueueDecision(approvalAction.row.id, {
          decisionNote: approvalDecisionNote,
        });
        setMessage({ type: 'success', text: 'Katalog kararı geri alındı. Satır yeniden onay bekleyen duruma taşındı.' });
      }
      closeApprovalAction();
      await loadCatalogData();
      if (typeof onDataRefresh === 'function') await onDataRefresh();
    } catch (error) {
      const fieldErrorText = formatApiFieldErrors(error.payload);
      const errorMessage = [error.message || 'Ürün onay kuyruğu işlemi başarısız oldu.', fieldErrorText]
        .filter(Boolean)
        .join(' ');
      setApprovalActionError(errorMessage);
      setMessage({
        type: 'error',
        text: approvalAction.type === 'create_draft'
          ? 'Taslak oluşturulamadı. Lütfen hata detayını kontrol edin.'
          : errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  const renderManualDecisionCell = (row) => {
    const isNewPending = row.actionType === 'CREATE_NEW_PRODUCT' || row.willSkipPendingApproval || row.pendingApprovalReason;
    if (!isNewPending || row.source === 'removed') return <span className="catalog-muted-dash">-</span>;

    const decision = manualDecisions[row.id] || {};
    const searchValue = decision.search || '';
    const hasSearchQuery = searchValue.trim().length >= 2;
    const currentOptions = hasSearchQuery
      ? (backendSearchResults[row.id] || [])
      : productSearchOptions.filter((item) => !searchValue || item.searchText.includes(normalize(searchValue))).slice(0, 25);

    let selectedProduct = productById.get(String(decision.manualProductId || '')) || null;
    if (!selectedProduct && decision.manualProductId) {
      const rowOptions = backendSearchResults[row.id] || [];
      const option = rowOptions.find((opt) => String(opt.value) === String(decision.manualProductId));
      if (option && option.rawItem) {
        selectedProduct = option.rawItem;
      }
    }

    const decisionBadge = decision.decision === 'manual_match'
      ? 'Mevcut ürüne bağlanacak'
      : decision.decision === 'create_draft_product'
        ? 'Güvenli taslak oluşturulacak'
        : decision.decision === 'skip'
          ? 'Onay için bekletilecek'
          : decision.decision === 'reject'
            ? 'Reddedildi'
            : row.missingRequiredFields
              ? 'Hatalı satır · düzeltme gerekli'
              : row.duplicateBarcode || row.duplicateSupplierCode || row.actionType === 'MANUAL_MATCH' || row.diffStatus === 'ambiguous_match'
                ? 'Eşleşme gerekli · manuel kontrol'
                : 'Yeni ürün · onay bekliyor';

    return (
      <div className="catalog-manual-decision-cell">
        <span className={`catalog-status-pill ${decision.decision === 'reject' || row.missingRequiredFields ? 'is-danger' : decision.decision ? 'is-primary' : 'is-warning'}`}>
          {decisionBadge}
        </span>
        <div className="catalog-manual-actions">
          <button
            type="button"
            className={`text-button ${decision.decision === 'manual_match' ? 'is-active' : ''}`}
            title="Bu katalog satırını sistemdeki mevcut bir ürüne bağlar. Yeni ürün oluşturulmaz."
            onClick={() => updateManualDecision(row.id, { decision: 'manual_match' })}
          >
            Mevcut Ürüne Bağla
          </button>
          <button
            type="button"
            className={`text-button ${decision.decision === 'create_draft_product' ? 'is-active' : ''}`}
            disabled={!row.canCreateDraftProduct}
            onClick={() => setDraftConfirmRow(row)}
            title={row.canCreateDraftProduct ? 'Bu ürünü satışa kapalı ve pasif bir taslak olarak oluşturur.' : 'Bu satırda çakışma veya hata olduğu için taslak oluşturulamaz.'}
          >
            Güvenli Taslak Oluştur
          </button>
          <button
            type="button"
            className={`text-button ${decision.decision === 'skip' ? 'is-active' : ''}`}
            title="Bu satır için şu an işlem yapmaz; daha sonra karar vermek üzere bekletir."
            onClick={() => updateManualDecision(row.id, { decision: 'skip', manualProductId: '' })}
          >
            Onay İçin Beklet
          </button>
          <button
            type="button"
            className={`text-button ${decision.decision === 'reject' ? 'is-active' : ''}`}
            title="Bu katalog satırını yok sayar. Ürün oluşturulmaz ve eşleşme yapılmaz."
            onClick={() => updateManualDecision(row.id, { decision: 'reject', manualProductId: '' })}
          >
            Reddet
          </button>
        </div>
        {decision.decision === 'manual_match' ? (
          <div className="catalog-product-select-wrap">
            <input
              value={searchValue}
              onChange={(event) => {
                const val = event.target.value;
                updateManualDecision(row.id, { search: val });
                handleProductSearch(row.id, val);
              }}
              placeholder="SKU, barkod, ad, marka, kategori veya satış durumu ara"
              aria-label="Manuel ürün arama"
            />
            <select
              value={decision.manualProductId || ''}
              onChange={(event) => updateManualDecision(row.id, { manualProductId: event.target.value })}
              aria-label="Manuel eşleşecek ürün"
            >
              <option value="">Ürün seçin</option>
              {currentOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            {hasSearchQuery && !isSearchingBackend[row.id] && currentOptions.length === 0 ? (
              <div className="catalog-search-no-results" style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '4px' }}>
                Eşleşen ürün bulunamadı
              </div>
            ) : null}
            {isSearchingBackend[row.id] ? (
              <div className="catalog-search-loading" style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '4px' }}>
                Aranıyor...
              </div>
            ) : null}
            {selectedProduct ? (
              <small>{`${selectedProduct.sku || '-'} | ${selectedProduct.barcode || '-'} | ${selectedProduct.name || '-'}`}</small>
            ) : null}
          </div>
        ) : null}
        <textarea
          rows={1}
          value={decision.decisionNote || ''}
          onChange={(event) => updateManualDecision(row.id, { decisionNote: event.target.value })}
          placeholder="Not Ekle"
          aria-label="Bu satır için manuel karar notu ekler."
          title="Bu satır için manuel karar notu ekler."
        />
        {decision.decision ? (
          <button type="button" className="text-button" title="Bu satır için seçilen manuel kararı temizler." onClick={() => clearManualDecision(row.id)}>
            Kararı Sıfırla
          </button>
        ) : null}
      </div>
    );
  };

  const currentCatalogColumns = [
    {
      key: 'supplierName',
      label: 'Tedarikçi',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{row.supplierName || '-'}</div>
          {row.supplierCode ? <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{row.supplierCode}</div> : null}
        </div>
      ),
    },
    {
      key: 'catalogName',
      label: 'Katalog Adı',
      render: (row) => (
        <div className="catalog-name-cell">
          <div className="catalog-name-main">{row.catalogName || row.fileName || '-'}</div>
          <div className="catalog-name-meta">{resolveCatalogSourceLabel(row.sourceLabel, 'Manuel Yükleme')}</div>
        </div>
      ),
    },
    {
      key: 'versionNo',
      label: 'Versiyon',
      render: (row) => <span style={{ fontWeight: 600 }}>v{row.versionNo || 1}</span>,
      sortValue: (row) => row.versionNo || 1,
    },
    {
      key: 'sourceLabel',
      label: 'Kaynak',
      render: (row) => (
        <span className={`catalog-status-pill ${row.sourceType === 'generated' ? 'is-primary' : 'is-neutral'}`}>
          <Tag size={11} style={{ marginRight: 4 }} />
          {resolveCatalogSourceLabel(row.sourceLabel, 'Manuel Yükleme')}
        </span>
      ),
    },
    {
      key: 'totalRowCount',
      label: 'Ürün Sayısı',
      render: (row) => <strong>{formatNumber(row.totalRowCount || 0)}</strong>,
      sortValue: (row) => row.totalRowCount || 0,
    },
    {
      key: 'uploadedAt',
      label: 'Oluşturulma Tarihi',
      render: (row) => formatDate(row.uploadedAt || row.createdAt),
      sortValue: (row) => row.uploadedAt || row.createdAt || '',
    },
    {
      key: 'verificationStatus',
      label: 'Doğrulama Durumu',
      render: (row) => (
        <span className={`catalog-status-pill ${row.verificationStatus === 'verified' ? 'is-success' : 'is-warning'}`}>
          {row.verificationStatus === 'verified' ? 'Doğrulandı' : 'Bekliyor'}
        </span>
      ),
    },
    {
      key: 'importStatus',
      label: 'Import Durumu',
      render: (row) => (
        <span className={`catalog-status-pill ${row.importStatus === 'completed' ? 'is-success' : 'is-neutral'}`}>
          {row.importStatus === 'completed' ? 'Tamamlandı' : row.importStatus || '-'}
        </span>
      ),
    },
    {
      key: 'isActiveVersion',
      label: 'Aktif Katalog',
      render: (row) => (
        <span className={`catalog-status-pill ${row.isActiveVersion || row.isActive ? 'is-active' : 'is-archived'}`}>
          {row.isActiveVersion || row.isActive ? 'Aktif' : 'Arşiv'}
        </span>
      ),
      sortValue: (row) => (row.isActiveVersion || row.isActive ? 1 : 0),
    },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      render: (row) => (
        <div className="catalog-inline-actions">
          <button
            type="button"
            className="text-button"
            disabled={viewLoading}
            onClick={() => handleViewCatalog(row)}
            title="Katalog satırlarını görüntüle"
          >
            <Eye size={13} style={{ marginRight: 3 }} />
            Görüntüle
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => handleDownloadExcel(row)}
            title="Kataloğu Excel olarak indir"
          >
            <FileDown size={13} style={{ marginRight: 3 }} />
            Excel İndir
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setCatalogDetail(row)}
          >
            Detay
          </button>
          {row.sourceType !== 'generated' ? (
            <button
              type="button"
              className="text-button"
              onClick={() => setVersionModalSupplierId(String(row.supplierId))}
            >
              Versiyonlar
            </button>
          ) : null}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setSupplierId(String(row.supplierId));
              setSupplierSearch(row.supplierName || '');
              setSupplierSearchOpen(false);
              uploadSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            Yeni Katalog Yükle
          </button>
        </div>
      ),
    },
  ];

  const diffColumns = [
    { key: 'productName', label: 'Ürün Adı' },
    {
      key: 'barcodeCode',
      label: 'Barkod / Tedarikçi Ürün Kodu',
      render: (row) => (
        <div className="catalog-barcode-cell">
          <span>{row.barcode || '-'}</span>
          <small>{row.supplierProductCode || '-'}</small>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Durum',
      render: (row) => <span className={`catalog-status-pill is-${getStatusTone(row.status)}`}>{row.status}</span>,
    },
    {
      key: 'matchedBy',
      label: 'Eşleşme',
      render: (row) => (
        <div className="catalog-barcode-cell">
          <span>{formatMatchType(row.matchedBy)}</span>
          <small>{formatConfidence(row.confidence)}</small>
        </div>
      ),
    },
    {
      key: 'manualDecision',
      label: 'Manuel Karar',
      sortable: false,
      render: renderManualDecisionCell,
    },
    {
      key: 'priceBasis',
      label: 'Eski / Yeni Baz',
      render: (row) => `${formatPriceBasis(row.oldPurchasePriceBasis)} / ${formatPriceBasis(row.purchasePriceBasis)}`,
    },
    { key: 'oldPrice', label: 'Eski Birim Fiyat', render: (row) => formatPriceCell(row.oldPrice), sortValue: (row) => row.oldPrice ?? -1 },
    { key: 'newPrice', label: 'Yeni Birim Fiyat', render: (row) => formatPriceCell(row.newPrice), sortValue: (row) => row.newPrice ?? -1 },
    {
      key: 'priceDiff',
      label: 'Fark',
      render: (row) => {
        if (row.priceDiff === null || row.priceDiff === undefined) return '-';
        const sign = row.priceDiff > 0 ? '+' : '';
        const tone = row.priceDiff > 0 ? 'is-up' : row.priceDiff < 0 ? 'is-down' : '';
        return <span className={`catalog-diff-value ${tone}`.trim()}>{`${sign}${formatCurrency(row.priceDiff, 'TRY')}`}</span>;
      },
      sortValue: (row) => row.priceDiff ?? -999999,
    },
    {
      key: 'changePct',
      label: 'Değişim %',
      render: (row) => {
        if (row.changePct === null || row.changePct === undefined) return '-';
        const tone = row.changePct > 0 ? 'is-up' : row.changePct < 0 ? 'is-down' : '';
        return <span className={`catalog-diff-value ${tone}`.trim()}>{formatChangeCell(row.changePct)}</span>;
      },
      sortValue: (row) => row.changePct ?? -999999,
    },
    {
      key: 'actions',
      label: 'Aksiyon',
      sortable: false,
      render: (row) => (
        <button type="button" className="text-button" onClick={() => setRowDetail(row)}>
          Detay
        </button>
      ),
    },
  ];

  const summaryCards = [
    { key: 'priceUpCount', label: 'Zam Gelen Ürün', value: summary.priceUpCount, tone: 'is-up' },
    { key: 'priceDownCount', label: 'İndirime Giren Ürün', value: summary.priceDownCount, tone: 'is-down' },
    { key: 'newProductCount', label: 'Yeni Ürün', value: summary.newProductCount, tone: 'is-primary' },
    { key: 'removedCount', label: 'Kaldırılan Ürün', value: summary.removedCount, tone: 'is-warning' },
    { key: 'unchangedCount', label: 'Değişmeyen Ürün', value: summary.unchangedCount, tone: 'is-neutral' },
    { key: 'invalidCount', label: 'Hatalı Satır', value: summary.invalidCount, tone: 'is-danger' },
  ];

  const approvalSummaryCards = [
    { key: 'total', label: 'Bekleyen Onaylar', value: filteredApprovalQueueRows.length, tone: 'is-primary' },
    { key: 'pending', label: 'Karar Bekleyen', value: filteredApprovalQueueRows.filter((row) => row.sourceType === 'catalog_import_row').length, tone: 'is-warning' },
    { key: 'draft', label: 'Taslak Ürün', value: filteredApprovalQueueRows.filter((row) => row.sourceType === 'staged_draft_product').length, tone: 'is-neutral' },
    { key: 'risk', label: 'Çakışma Riski', value: filteredApprovalQueueRows.filter((row) => row.duplicateBarcodeRisk || row.duplicateSupplierCodeRisk).length, tone: 'is-danger' },
  ];

  const hasActivePreview = Boolean(activeImportData?.importId && activeImportData?.status !== 'committed' && diffRows.length);
  const showPreviewTable = !hasActivePreview || !showApprovalQueue;

  const approvalColumns = [
    {
      key: 'supplierName',
      label: 'Tedarikçi / Katalog',
      render: (row) => (
        <div className="catalog-name-cell">
          <div className="catalog-name-main">{row.supplierName || '-'}</div>
          <div className="catalog-name-meta">{row.catalogVersion || '-'} · Satır {row.rowNumber || '-'}</div>
        </div>
      ),
    },
    {
      key: 'productName',
      label: 'Ürün',
      render: (row) => (
        <div className="catalog-name-cell">
          <div className="catalog-name-main">{row.productName || '-'}</div>
          <div className="catalog-name-meta">{[row.brand, row.category, row.unit, row.packSize].filter(Boolean).join(' · ') || '-'}</div>
          {row.sourceType === 'catalog_import_row' ? <span className="catalog-status-pill is-primary">Yeni Ürün</span> : null}
        </div>
      ),
    },
    {
      key: 'codes',
      label: 'Kodlar',
      render: (row) => (
        <div className="catalog-barcode-cell">
          <span>{row.barcode || '-'}</span>
          <small>{row.supplierProductCode || row.supplierSku || '-'}</small>
        </div>
      ),
    },
    {
      key: 'prices',
      label: 'Fiyat / Koli',
      render: (row) => (
        <div className="catalog-barcode-cell">
          <span>{row.purchasePrice !== '' ? formatCurrency(row.purchasePrice, row.currency || 'TRY') : '-'}</span>
          <small>{[
            row.listPrice !== '' && row.listPrice !== undefined ? `Liste ${formatCurrency(row.listPrice, row.currency || 'TRY')}` : '',
            row.recommendedSalePrice !== '' && row.recommendedSalePrice !== undefined ? `Önerilen ${formatCurrency(row.recommendedSalePrice, row.currency || 'TRY')}` : '',
            row.vatRate !== '' && row.vatRate !== undefined ? `KDV ${row.vatRate}%` : '',
          ].filter(Boolean).join(' · ') || '-'}</small>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Durum / Risk',
      render: (row) => (
        <div className="catalog-barcode-cell">
          <span className={`catalog-status-pill is-${getApprovalQueueTone(row)}`}>
            {getApprovalQueueStatusLabel(row)}
          </span>
          <small>{getApprovalQueueInfoText(row)}</small>
        </div>
      ),
    },
    {
      key: 'decision',
      label: 'Not / Taslak',
      render: (row) => (
        <div className="catalog-name-cell">
          <div className="catalog-name-main">{trValue(row.decisionNote || row.supplierNote || row.suggestedAction)}</div>
          <div className="catalog-name-meta">{row.draftProductId ? `${row.draftProductSku || '—'} · ${row.draftProductId}` : 'Otomatik ürün oluşturulmaz'}</div>
        </div>
      ),
    },
    {
      key: 'actions',
      label: 'Aksiyon',
      className: 'catalog-approval-actions-cell',
      sortable: false,
      render: (row) => (
        <div className="catalog-inline-actions">
          {String(row.status || '') === 'rejected' ? (
            <>
              <button type="button" className="text-button" disabled={!isAdmin || loading} onClick={() => openApprovalAction('undo', row)}>
                Kararı Geri Al
              </button>
              <button type="button" className="text-button" onClick={() => setRowDetail(row)}>
                Detay
              </button>
              {row.decisionNote ? (
                <button type="button" className="text-button" onClick={() => setRowDetail(row)}>
                  Notu Gör
                </button>
              ) : null}
            </>
          ) : row.sourceType === 'catalog_import_row' && row.status !== 'draft_created' && !row.draftProductId ? (
            <>
              <button type="button" className="text-button" disabled={!isAdmin || loading} onClick={() => openApprovalAction('match', row)}>
                Mevcut Ürüne Bağla
              </button>
              <button type="button" className="text-button" disabled={!isAdmin || loading || !row.canCreateDraftProduct} onClick={() => openApprovalAction('create_draft', row)}>
                Güvenli Taslak Oluştur
              </button>
              <button type="button" className="text-button" disabled={!isAdmin || loading} onClick={() => openApprovalAction('reject', row)}>
                Reddet
              </button>
            </>
          ) : (
            <>
              <button type="button" className="text-button" onClick={() => setRowDetail(row)}>
                Detay
              </button>
              <span className="catalog-muted-dash">Aktif ürüne dönüştürme ayrı iş</span>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mod-card catalog-current-list-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-indigo"><Database size={18} /></div>
          <div>
            <h3>Mevcut Kataloglar</h3>
            <p>Aktif ve geçmiş tedarikçi kataloglarını görüntüleyin.</p>
          </div>
          {loading ? <span style={{ fontSize: '0.8rem', color: 'var(--muted)', marginLeft: 'auto' }}>Yükleniyor...</span> : null}
        </div>

        <div className="catalog-current-list-table-wrap">
          <DataTable
            columns={currentCatalogColumns}
            rows={currentCatalogRows}
            emptyMessage="Henüz katalog verisi bulunamadı."
            pageSize={10}
            topHorizontalScroll
          />
        </div>
      </div>

      <div className="mod-card" ref={uploadSectionRef}>
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-cyan"><FileUp size={18} /></div>
          <div><h3>Yeni Katalog-Tedarikçi Eşleştirmesi</h3><p>Tedarikçi arayın, katalog yükleyin ve otomatik fark analizini başlatın.</p></div>
          <div className="table-actions catalog-upload-actions-head">
            <button type="button" className="ghost-button" onClick={downloadTemplate}>
              <Download size={15} /> Katalog Şablonu İndir
            </button>
          </div>
        </div>

        {message ? (
          <div className={`catalog-import-alert ${message.type === 'error' ? 'is-error' : 'is-success'}`}>
            {message.text}
          </div>
        ) : null}

        <FilterBar className="products-filter-bar-minimal suppliers-filter-bar-minimal catalog-upload-inline-form catalog-upload-layout">
          <label className="field-group catalog-supplier-search-field" ref={supplierSearchRef}>
            <span>Tedarikçi Ara</span>
            <div className="catalog-supplier-search-wrap">
              <input
              value={supplierSearch}
              onFocus={() => setSupplierSearchOpen(true)}
              onChange={(event) => {
                setSupplierSearch(event.target.value);
                setSupplierId('');
                setSupplierSearchOpen(true);
              }}
              placeholder="Tedarikçi adı ile ara"
              aria-label="Tedarikçi ara"
            />
            </div>
            {supplierSearchOpen && (
              <div className="catalog-supplier-suggestion-list" role="listbox" aria-label="Tedarikçi önerileri">
                {filteredSupplierOptions.length ? (
                  filteredSupplierOptions.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={`catalog-supplier-suggestion-item ${supplierId === item.value ? 'is-active' : ''}`}
                      onClick={() => handleSelectSupplier(item)}
                    >
                      {item.label}
                    </button>
                  ))
                ) : (
                  <div className="catalog-supplier-suggestion-empty">Eşleşen tedarikçi bulunamadı.</div>
                )}
              </div>
            )}
          </label>
          <label className="field-group catalog-upload-file-field">
            <span>Katalog Dosyası</span>
            <input type="file" accept=".xlsx,.xls" onChange={handleFileSelect} disabled={!isAdmin || loading} />
          </label>
          <div className="field-group catalog-upload-action-field">
            <span>&nbsp;</span>
            <button type="button" className="primary-button catalog-upload-submit" onClick={handleStartUpload} disabled={!isAdmin || loading || !supplierId || !selectedFile}>
              {loading ? 'Yükleniyor...' : 'Yüklemeyi Başlat'}
            </button>
            <small className="catalog-supplier-selected-note">&nbsp;</small>
          </div>
        </FilterBar>
      </div>

      <div className="mod-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-violet"><BarChart3 size={18} /></div>
          <div><h3>Fark Analizi Tablosu</h3><p>Yeni katalog ile son aktif katalog arasındaki fiyat ve ürün farkları.</p></div>
          <div className="table-actions catalog-upload-action-wrap">
            <button
              type="button"
              className="ghost-button"
              onClick={handleDownloadPreviewExcel}
              disabled={!activeImportData?.importId || !diffRows.length}
            >
              <FileDown size={15} /> Detaylı Önizleme İndir
            </button>
            <button
              type="button"
              className="primary-button catalog-commit-btn"
              onClick={handleCommit}
              disabled={!isAdmin || !activeImportData?.importId || loading || activeImportData?.status === 'committed'}
            >
              Farkları Onayla ve Aktif Katalog Yap
            </button>
          </div>
        </div>

        <div className="catalog-import-alert">
          Bu tablo şu an yüklediğiniz katalogun önizlemesidir. Yeni ürünleri burada eşleyebilir, taslak oluşturabilir, bekletebilir veya reddedebilirsiniz. Farkları onayladığınızda bekleyen kararlar onay kuyruğuna aktarılır.
        </div>

        <div className="catalog-summary-strip" role="status" aria-live="polite">
          {summaryCards.map((item) => (
            <div key={item.key} className={`catalog-summary-mini ${item.tone}`.trim()}>
              <span>{item.label}</span>
              <strong>{formatNumber(item.value || 0)}</strong>
            </div>
          ))}
        </div>

        {showPreviewTable ? (
          <DataTable columns={diffColumns} rows={diffRows} emptyMessage="Önce tedarikçi seçip yeni katalog yükleyin." pageSize={10} topHorizontalScroll />
        ) : (
          <div className="catalog-import-alert">
            Bekleyen katalog ürünleri açıkken önizleme tablosu geçici olarak gizlendi. Önizlemeye dönmek için bekleyen onay panelini kapatın.
          </div>
        )}
      </div>

      <div className="mod-card catalog-approval-queue-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-cyan"><CheckCircle2 size={18} /></div>
          <div>
            <h3>Bekleyen Katalog Ürünleri</h3>
            <p>Bu bölüm daha önce kaydedilmiş ve hâlâ karara bağlanmamış katalog ürünlerini gösterir.</p>
          </div>
          <div className="table-actions catalog-upload-action-wrap">
            <button type="button" className="ghost-button" onClick={() => loadCatalogData()} disabled={loading}>
              <RefreshCw size={15} /> Yenile
            </button>
            <button type="button" className="ghost-button" onClick={handleDownloadApprovalQueueExcel} disabled={!filteredApprovalQueueRows.length}>
              <FileDown size={15} /> Onay Kuyruğu XLSX
            </button>
            <button type="button" className="primary-button" onClick={() => setShowApprovalQueue((current) => !current)}>
              {showApprovalQueue ? 'Bekleyen Onayları Kapat' : 'Bekleyen Onayları Göster'}
            </button>
          </div>
        </div>

        <div className="catalog-summary-strip" role="status" aria-live="polite">
          {approvalSummaryCards.map((item) => (
            <div key={item.key} className={`catalog-summary-mini ${item.tone}`.trim()}>
              <span>{item.label}</span>
              <strong>{formatNumber(item.value || 0)}</strong>
            </div>
          ))}
        </div>

        <div className="catalog-approval-legend" aria-label="Onay kuyruğu renk açıklamaları">
          <span><i className="catalog-legend-dot is-warning" /> Sarı: Onay bekliyor</span>
          <span><i className="catalog-legend-dot is-danger" /> Kırmızı: Çakışma riski</span>
          <span><i className="catalog-legend-dot is-primary" /> Mor: Taslak oluşturuldu</span>
          <span><i className="catalog-legend-dot is-neutral" /> Gri: Bekletiliyor</span>
          <span><i className="catalog-legend-dot is-success" /> Yeşil: Eşleşti/tamamlandı</span>
          <span><i className="catalog-legend-dot is-rejected" /> Koyu kırmızı: Reddedildi</span>
        </div>

        {showApprovalQueue ? (
          <>
            {hasActivePreview ? (
              <div className="catalog-import-alert">
                Aktif önizleme açık olduğu için aynı anda iki karar tablosu göstermemek adına Fark Analizi Tablosu gizlendi.
              </div>
            ) : null}

            <FilterBar className="products-filter-bar-minimal suppliers-filter-bar-minimal catalog-approval-filter-bar">
              <label className="field-group">
                <span>Tedarikçi</span>
                <select value={approvalFilters.supplierId} onChange={(event) => setApprovalFilters((current) => ({ ...current, supplierId: event.target.value }))}>
                  <option value="">Tümü</option>
                  {supplierOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="field-group">
                <span>Durum</span>
                <select value={approvalFilters.status} onChange={(event) => setApprovalFilters((current) => ({ ...current, status: event.target.value }))}>
                  {APPROVAL_QUEUE_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label className="field-group">
                <span>Çakışma Riski</span>
                <select value={approvalFilters.duplicateRisk} onChange={(event) => setApprovalFilters((current) => ({ ...current, duplicateRisk: event.target.value }))}>
                  <option value="">Tümü</option>
                  <option value="yes">Risk var</option>
                  <option value="no">Risk yok</option>
                </select>
              </label>
              <label className="field-group">
                <span>Arama</span>
                <input
                  value={approvalFilters.query}
                  onChange={(event) => setApprovalFilters((current) => ({ ...current, query: event.target.value }))}
                  placeholder="Barkod, ürün, marka, kategori veya tedarikçi ara"
                />
              </label>
            </FilterBar>

            <div className="catalog-approval-table-scroll">
              <DataTable
                columns={approvalColumns}
                rows={filteredApprovalQueueRows}
                emptyMessage="Bekleyen katalog ürünü yok. Yeni katalog yüklediğinizde onay bekleyen ürünler burada görünecek."
                pageSize={10}
                topHorizontalScroll
              />
            </div>
          </>
        ) : null}
      </div>

      <FormModal
        isOpen={Boolean(catalogDetail)}
        title="Katalog Detayı"
        description="Katalog metadata ve özet bilgiler"
        headerIcon={<Database size={16} />}
        onClose={() => setCatalogDetail(null)}
        modalClassName="product-form-fit-modal supplier-catalog-modal supplier-catalog-detail-modal modal-header-standardized"
        confirmOnDirtyClose={false}
      >
        {catalogDetail ? (
          <div className="modal-form modal-structured-form supplier-catalog-detail-form">
            <div className="modal-form-body-scroll supplier-catalog-detail-body">
              <section className="modal-form-section supplier-catalog-detail-section">
                <div className="catalog-detail-grid">
                  <article className="catalog-detail-item"><span>Tedarikçi</span><strong>{catalogDetail.supplierName || '-'}</strong></article>
                  <article className="catalog-detail-item"><span>Katalog Dosyası</span><strong>{catalogDetail.fileName || '-'}</strong></article>
                  <article className="catalog-detail-item"><span>Yüklenme Tarihi</span><strong>{formatDate(catalogDetail.uploadedAt)}</strong></article>
                  <article className="catalog-detail-item"><span>Geçerlilik</span><strong>{formatDate(catalogDetail.validityStart)} - {catalogDetail.validityEnd ? formatDate(catalogDetail.validityEnd) : 'Süresiz'}</strong></article>
                  <article className="catalog-detail-item"><span>Son Güncelleme</span><strong>{formatDate(catalogDetail.activatedAt || catalogDetail.uploadedAt)}</strong></article>
                  <article className="catalog-detail-item"><span>Durum</span><strong>{catalogDetail.isActive ? 'Aktif' : 'Arşiv'}</strong></article>
                </div>
              </section>
            </div>
            <div className="modal-actions supplier-catalog-modal-footer">
              <button type="button" className="ghost-button" onClick={() => setCatalogDetail(null)}>Kapat</button>
            </div>
          </div>
        ) : null}
      </FormModal>

      <FormModal
        isOpen={Boolean(versionModalSupplierId)}
        title="Katalog Versiyonları"
        description="Seçili tedarikçinin katalog geçmişi"
        onClose={() => setVersionModalSupplierId('')}
        modalClassName="product-form-fit-modal supplier-catalog-modal supplier-catalog-draft-modal modal-header-standardized"
        confirmOnDirtyClose={false}
      >
        <div className="modal-body">
          <DataTable
            columns={[
              { key: 'fileName', label: 'Dosya' },
              { key: 'uploadedAt', label: 'Yüklenme', render: (row) => formatDate(row.uploadedAt) },
              { key: 'validityStart', label: 'Geçerlilik Başlangıç', render: (row) => formatDate(row.validityStart) },
              { key: 'validityEnd', label: 'Geçerlilik Bitiş', render: (row) => row.validityEnd ? formatDate(row.validityEnd) : 'Süresiz' },
              { key: 'status', label: 'Durum', render: (row) => row.isActive ? 'Aktif' : 'Arşiv' },
            ]}
            rows={selectedSupplierVersions}
            emptyMessage="Versiyon kaydı bulunmuyor."
            pageSize={10}
          />
        </div>
      </FormModal>

      <FormModal
        isOpen={Boolean(rowDetail)}
        title="Ürün Fark Detayı"
        description="Seçili katalog satırındaki ürün, fiyat ve eşleşme bilgileri."
        onClose={() => setRowDetail(null)}
        modalClassName="product-form-fit-modal supplier-catalog-modal supplier-catalog-diff-modal modal-header-standardized"
        confirmOnDirtyClose={false}
      >
        {rowDetail ? (
          <div className="modal-body catalog-diff-detail-grid">
            <section className="modal-form-section">
              <h4>Ürün Bilgileri</h4>
              <div className="catalog-detail-grid">
                <article className="catalog-detail-item"><span>Ürün adı</span><strong>{displayValue(rowDetail.productName)}</strong></article>
                <article className="catalog-detail-item"><span>Barkod</span><strong>{displayValue(rowDetail.barcode)}</strong></article>
                <article className="catalog-detail-item"><span>Tedarikçi ürün kodu</span><strong>{displayValue(rowDetail.supplierProductCode)}</strong></article>
                <article className="catalog-detail-item"><span>Marka</span><strong>{displayValue(rowDetail.brandName)}</strong></article>
                <article className="catalog-detail-item"><span>Kategori</span><strong>{displayValue(rowDetail.categoryName)}</strong></article>
                <article className="catalog-detail-item"><span>Birim / paket</span><strong>{[rowDetail.unit, rowDetail.packSize || rowDetail.unitsPerCase].filter(Boolean).join(' / ') || '—'}</strong></article>
                <article className="catalog-detail-item"><span>Açıklama</span><strong>{displayValue(rowDetail.productDescription || rowDetail.shortDescription || rowDetail.description)}</strong></article>
                {rowDetail.imageUrl ? <article className="catalog-detail-item"><span>Görsel</span><strong><a href={rowDetail.imageUrl} target="_blank" rel="noreferrer">Görseli aç</a></strong></article> : null}
              </div>
            </section>

            <section className="modal-form-section">
              <h4>Fiyat ve Sipariş Bilgileri</h4>
              <div className="catalog-detail-grid">
                <article className="catalog-detail-item"><span>Eski fiyat</span><strong>{formatPriceCell(rowDetail.oldPrice).replace('-', '—')}</strong></article>
                <article className="catalog-detail-item"><span>Yeni alış fiyatı</span><strong>{formatPriceCell(rowDetail.newPrice).replace('-', '—')}</strong></article>
                <article className="catalog-detail-item"><span>Eski fiyat bazı</span><strong>{formatPriceBasis(rowDetail.oldPurchasePriceBasis)}</strong></article>
                <article className="catalog-detail-item"><span>Yeni fiyat bazı</span><strong>{formatPriceBasis(rowDetail.purchasePriceBasis)}</strong></article>
                <article className="catalog-detail-item"><span>Liste fiyatı</span><strong>{formatDetailCurrency(rowDetail.listPrice, rowDetail.currency)}</strong></article>
                <article className="catalog-detail-item"><span>Önerilen satış fiyatı</span><strong>{formatDetailCurrency(rowDetail.recommendedSalePrice, rowDetail.currency)}</strong></article>
                <article className="catalog-detail-item"><span>Para birimi / KDV</span><strong>{formatCurrencyVatValue(rowDetail.currency, rowDetail.vatRate)}</strong></article>
                <article className="catalog-detail-item"><span>Eski MOQ</span><strong>{displayValue(rowDetail.oldMoq)}</strong></article>
                <article className="catalog-detail-item"><span>Yeni MOQ</span><strong>{displayValue(rowDetail.newMoq)}</strong></article>
                <article className="catalog-detail-item"><span>Eski koli içi</span><strong>{displayValue(rowDetail.oldCase)}</strong></article>
                <article className="catalog-detail-item"><span>Yeni koli içi</span><strong>{displayValue(rowDetail.newCase)}</strong></article>
                <article className="catalog-detail-item"><span>Tedarikçi stok</span><strong>{displayValue(rowDetail.supplierStockQty)}</strong></article>
                <article className="catalog-detail-item"><span>Bulunurluk</span><strong>{trValue(rowDetail.availabilityStatus)}</strong></article>
              </div>
            </section>

            <section className="modal-form-section">
              <h4>Katalog ve Tedarikçi Bilgileri</h4>
              <div className="catalog-detail-grid">
                <article className="catalog-detail-item"><span>Son aktif katalog</span><strong>{displayValue(rowDetail.oldCatalogName)}</strong></article>
                <article className="catalog-detail-item"><span>Yeni yüklenen katalog</span><strong>{displayValue(rowDetail.newCatalogName)}</strong></article>
                <article className="catalog-detail-item"><span>Tedarikçi notu</span><strong>{displayValue(rowDetail.supplierNote)}</strong></article>
                <article className="catalog-detail-item"><span>Kampanya bilgisi</span><strong>{displayValue(rowDetail.campaignInfo || rowDetail.campaignPrice)}</strong></article>
              </div>
            </section>

            <section className="modal-form-section">
              <h4>Eşleşme ve Risk</h4>
              <div className="catalog-detail-grid">
                <article className="catalog-detail-item"><span>Ürün durumu</span><strong><span className={`catalog-status-pill is-${getStatusTone(rowDetail.status)}`}>{rowDetail.status}</span></strong></article>
                <article className="catalog-detail-item"><span>Eşleşme yöntemi</span><strong>{formatMatchType(rowDetail.matchedBy)}</strong></article>
                <article className="catalog-detail-item"><span>Eşleşme durumu</span><strong>{formatMatchStatus(rowDetail.matchStatus || rowDetail.status)}</strong></article>
                <article className="catalog-detail-item"><span>Karar</span><strong>{trList([rowDetail.actionType, rowDetail.matchStatus, rowDetail.confidence])}</strong></article>
                <article className="catalog-detail-item"><span>Risk</span><strong><span className={`catalog-status-pill ${rowDetail.reason || rowDetail.pendingApprovalReason ? 'is-warning' : 'is-success'}`}>{trList([rowDetail.reason, rowDetail.pendingApprovalReason], 'Risk yok')}</span></strong></article>
                <article className="catalog-detail-item"><span>Eksik alanlar</span><strong>{rowDetail.missingRequiredFieldNames?.length ? rowDetail.missingRequiredFieldNames.join(', ') : 'Eksik alan yok'}</strong></article>
                <article className="catalog-detail-item"><span>Güvenlik notu</span><strong>{rowDetail.actionType === 'CREATE_NEW_PRODUCT' ? 'Yeni ürün · Onay bekliyor · Otomatik ürün oluşturulmaz · Manuel onay gerekir' : 'Otomatik ürün oluşturulmaz'}</strong></article>
              </div>
              {rowDetail.errors?.length ? <div className="catalog-diff-errors"><strong>Hata:</strong> {trList(rowDetail.errors)}</div> : null}
            </section>
          </div>
        ) : null}
      </FormModal>

      <FormModal
        isOpen={Boolean(draftConfirmRow)}
        title="Yeni Ürün Taslağı Oluştur"
        description="Bu işlem yalnızca manuel onayla güvenli bir ürün taslağı oluşturur."
        onClose={() => {
          if (draftConfirmSubmitting) return;
          setDraftConfirmError('');
          setDraftConfirmRow(null);
        }}
        modalClassName={`product-form-fit-modal supplier-catalog-modal supplier-catalog-compact-modal ${approvalAction?.type === 'create_draft' ? 'supplier-catalog-draft-modal' : ''} modal-header-standardized`.trim()}
        confirmOnDirtyClose={false}
      >
        {draftConfirmRow ? (
          <div className="modal-body catalog-draft-confirm">
            <p><strong>{draftConfirmRow.productName || '-'}</strong></p>
            <p>Bu ürün satışa açılmayacak. Ürün onay bekleyen taslak olarak kaydedilecek.</p>
            <div className="catalog-detail-grid">
              <article className="catalog-detail-item"><span>Satış durumu</span><strong>Satışta değil</strong></article>
              <article className="catalog-detail-item"><span>Ürün durumu</span><strong>Pasif</strong></article>
              <article className="catalog-detail-item"><span>Kayıt türü</span><strong>Onay bekleyen taslak</strong></article>
              <article className="catalog-detail-item"><span>Kaynak</span><strong>Katalogdan gelen taslak</strong></article>
            </div>
            <div className="catalog-import-alert">
              Bu işlemden sonra ürün müşteri ekranında görünmez, satışa açılmaz, stok oluşturulmaz ve yalnızca onay bekleyen taslak olarak saklanır.
            </div>
            {draftConfirmError ? <div className="catalog-import-alert is-error">{draftConfirmError}</div> : null}
            <div className="modal-actions supplier-catalog-modal-footer">
              <button type="button" className="ghost-button" disabled={draftConfirmSubmitting} onClick={() => {
                setDraftConfirmError('');
                setDraftConfirmRow(null);
              }}>Vazgeç</button>
              <button
                type="button"
                className="primary-button"
                disabled={draftConfirmSubmitting}
                onClick={confirmPreviewDraftDecision}
              >
                {draftConfirmSubmitting ? 'Taslak oluşturuluyor...' : 'Güvenli Taslak Oluştur'}
              </button>
            </div>
          </div>
        ) : null}
      </FormModal>

      <FormModal
        isOpen={Boolean(approvalAction)}
        title={
          approvalAction?.type === 'match'
            ? 'Mevcut Ürüne Bağla'
            : approvalAction?.type === 'create_draft'
              ? 'Yeni Ürün Taslağı Oluştur'
              : approvalAction?.type === 'undo'
                ? 'Kararı Geri Al'
                : 'Katalog Satırını Reddet'
        }
        description={approvalAction?.type === 'create_draft'
          ? 'Bu işlem yalnızca manuel onayla güvenli bir ürün taslağı oluşturur.'
          : approvalAction?.type === 'undo'
            ? 'Reddedilen katalog satırı yeniden onay bekleyen duruma alınır.'
            : 'Ürün onay kuyruğu kararı yalnızca seçili katalog satırına uygulanır.'}
        headerIcon={approvalAction?.type === 'reject' ? <XCircle size={16} /> : <Search size={16} />}
        onClose={closeApprovalAction}
        modalClassName="product-form-fit-modal supplier-catalog-modal supplier-catalog-compact-modal modal-header-standardized"
        confirmOnDirtyClose={false}
      >
        {approvalAction ? (
          <div className="modal-body catalog-approval-action-modal">
            <div className="catalog-detail-grid catalog-approval-info-grid">
              <article className="catalog-detail-item"><span>Ürün</span><strong>{approvalAction.row.productName || '-'}</strong></article>
              <article className="catalog-detail-item"><span>Barkod</span><strong>{approvalAction.row.barcode || '-'}</strong></article>
              <article className="catalog-detail-item"><span>Tedarikçi Kodu</span><strong>{approvalAction.row.supplierProductCode || '-'}</strong></article>
              <article className="catalog-detail-item"><span>Risk</span><strong>{formatApprovalRiskLabel(approvalAction.row)}</strong></article>
            </div>

            {approvalAction.type === 'match' ? (
              <div className="catalog-approval-form-section catalog-approval-product-section">
                <label className="field-group">
                  <span>Ürün Arama</span>
                  <input
                    value={approvalProductSearch}
                    onChange={(event) => {
                      const val = event.target.value;
                      setApprovalProductSearch(val);
                      handleApprovalProductSearch(val);
                    }}
                    placeholder="SKU, barkod, ürün adı, marka, kategori veya satış durumu ara"
                    aria-label="Ürün arama"
                  />
                </label>
                <label className="field-group">
                  <span>Eşlenecek Ürün</span>
                  <select
                    value={approvalSelectedProductId}
                    onChange={(event) => setApprovalSelectedProductId(event.target.value)}
                    aria-label="Eşlenecek ürün"
                  >
                    <option value="">Ürün seçin</option>
                    {(approvalProductSearch.trim().length >= 2 ? approvalBackendSearchOptions : approvalProductOptions).map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                  {approvalProductSearch.trim().length >= 2 && !isSearchingApprovalBackend && approvalBackendSearchOptions.length === 0 ? (
                    <div className="catalog-search-no-results" style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '4px' }}>
                      Eşleşen ürün bulunamadı
                    </div>
                  ) : null}
                  {isSearchingApprovalBackend ? (
                    <div className="catalog-search-loading" style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '4px' }}>
                      Aranıyor...
                    </div>
                  ) : null}
                </label>
              </div>
            ) : null}

            {approvalAction.type === 'create_draft' ? (
              <div className="catalog-draft-confirm">
                <p>Bu ürün satışa açılmayacak. Ürün onay bekleyen taslak olarak kaydedilecek.</p>
                <div className="catalog-detail-grid">
                  <article className="catalog-detail-item"><span>Satış durumu</span><strong>Satışta değil</strong></article>
                  <article className="catalog-detail-item"><span>Ürün durumu</span><strong>Pasif</strong></article>
                  <article className="catalog-detail-item"><span>Kayıt türü</span><strong>Onay bekleyen taslak</strong></article>
                  <article className="catalog-detail-item"><span>Kaynak</span><strong>Katalogdan gelen taslak</strong></article>
                </div>
                <div className="catalog-import-alert">
                  Bu işlemden sonra ürün müşteri ekranında görünmez, satışa açılmaz, stok oluşturulmaz ve yalnızca onay bekleyen taslak olarak saklanır.
                </div>
                {approvalAction.row.duplicateBarcodeRisk || approvalAction.row.duplicateSupplierCodeRisk ? (
                  <p className="catalog-diff-errors">Çakışma riski bulunduğu için taslak oluşturma engellenir.</p>
                ) : null}
              </div>
            ) : null}

            {approvalActionError ? <div className="catalog-import-alert is-error">{approvalActionError}</div> : null}

            <label className="field-group catalog-approval-note-field">
              <span>{approvalAction.type === 'reject' ? 'Reddetme Nedeni' : approvalAction.type === 'undo' ? 'Geri Alma Notu' : 'Manuel Not'}</span>
              <textarea
                rows={3}
                value={approvalDecisionNote}
                onChange={(event) => setApprovalDecisionNote(event.target.value)}
                placeholder={approvalAction.type === 'reject' ? 'Neden yok sayıldığını yazın' : approvalAction.type === 'undo' ? 'Kararın neden geri alındığını yazın' : 'Karar notu'}
              />
            </label>

            <div className="modal-actions supplier-catalog-modal-footer">
              <button type="button" className="ghost-button" disabled={loading} onClick={closeApprovalAction}>Vazgeç</button>
              <button
                type="button"
                className="primary-button"
                disabled={
                  loading
                  || (approvalAction.type === 'match' && !approvalSelectedProductId)
                  || (approvalAction.type === 'reject' && !approvalDecisionNote.trim())
                  || (approvalAction.type === 'create_draft' && !approvalAction.row.canCreateDraftProduct)
                }
                onClick={handleApprovalActionSubmit}
              >
                {loading && approvalAction.type === 'create_draft'
                  ? 'Taslak oluşturuluyor...'
                  : approvalAction.type === 'match'
                    ? 'Mevcut Ürüne Bağla'
                    : approvalAction.type === 'create_draft'
                      ? 'Güvenli Taslak Oluştur'
                      : approvalAction.type === 'undo'
                        ? 'Kararı Geri Al'
                        : 'Reddet'}
              </button>
            </div>
          </div>
        ) : null}
      </FormModal>

      {/* Katalog Görüntüleme Modal */}
      <FormModal
        isOpen={Boolean(viewCatalog)}
        title={viewCatalog ? `${viewCatalog.version.supplierName} — Katalog Satırları` : 'Katalog'}
        description={viewCatalog ? `${formatNumber(viewCatalog.rows.length)} ürün | Kaynak: ${viewCatalog.version.sourceLabel || 'Sistem'}` : ''}
        headerIcon={<BarChart3 size={16} />}
        onClose={() => setViewCatalog(null)}
        modalClassName="product-form-fit-modal supplier-catalog-modal supplier-catalog-rows-modal modal-header-standardized"
        confirmOnDirtyClose={false}
      >
        {viewCatalog ? (
          <div className="modal-form modal-structured-form supplier-catalog-rows-form">
            <div className="modal-form-body-scroll supplier-catalog-rows-body">
              <section className="modal-form-section supplier-catalog-rows-section">
                <div className="supplier-catalog-rows-table-wrap">
                  <table className="supplier-catalog-rows-table">
                    <thead>
                      <tr>
                        {['#', 'SKU', 'Barkod', 'Tedarikçi Ürün Kodu', 'Ürün Adı', 'Marka', 'Kategori', 'Birim', 'Koli İçi', 'Alış Fiyatı', 'MOQ', 'Teslimat'].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {viewCatalog.rows.slice(0, 200).map((r, i) => (
                        <tr key={r.rowIndex || i}>
                          <td className="is-muted">{r.rowIndex}</td>
                          <td>{r.sku}</td>
                          <td>{r.barcode}</td>
                          <td>{r.supplierProductCode || '-'}</td>
                          <td className="is-clamp">{r.productName}</td>
                          <td>{r.brand}</td>
                          <td>{r.categoryName}</td>
                          <td>{r.unit}</td>
                          <td className="is-right">{r.unitsPerCase}</td>
                          <td className="is-right is-strong">{formatCurrency(r.purchasePrice, 'TRY')}</td>
                          <td className="is-right">{r.minimumOrderQty}</td>
                          <td>{r.leadTimeDays} gün</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {viewCatalog.rows.length > 200 ? (
                  <div className="supplier-catalog-rows-limit-note">
                    İlk 200 satır gösteriliyor. Tamamını görmek için Excel olarak indirin. (Toplam: {formatNumber(viewCatalog.rows.length)})
                  </div>
                ) : null}
              </section>
            </div>
            <div className="modal-actions supplier-catalog-modal-footer">
              <button type="button" className="ghost-button" onClick={() => setViewCatalog(null)}>Kapat</button>
            </div>
          </div>
        ) : null}
      </FormModal>
    </>
  );
}
