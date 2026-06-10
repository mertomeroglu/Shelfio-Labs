import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Package, PackageSearch, Filter, Plus, RefreshCw, Search } from 'lucide-react';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import DataTable from '../../components/DataTable.jsx';
import FilterBar from '../../components/FilterBar.jsx';
import FormModal, { FormGrid, FormSection } from '../../components/FormModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Toast from '../../components/Toast.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { categoryService } from '../../services/categoryService.js';
import {
  buildTaxonomyResolver,
  buildCategoryLookup,
  formatCurrency,
  formatDate,
  formatDepotLocationLabel,
  formatNumber,
  formatStorageTypeLabel,
  formatUnit,
  includesNormalized,
  normalizeStorageTypeCode,
  resolveProductTaxonomy,
  resolveStockPairMeta,
} from '../../services/formatters.js';
import { procurementService } from '../../services/procurementService.js';
import { productService } from '../../services/productService.js';
import { sectionService } from '../../services/sectionService.js';
import { supplierService } from '../../services/supplierService.js';
import { warehouseService } from '../../services/warehouseService.js';
import { getReadableCategoryLabelName } from '../../utils/categoryLabelDisplay.js';
import { buildInventoryLastCountMap } from '../../utils/inventoryCounting.js';
import { isCatalogUnlistedProduct } from '../../utils/productListing.js';

const normalizeMoneyInput = (value) => String(value ?? '').replace(',', '.');

const parseMoneyInput = (value, fallback = 0) => {
  const normalized = normalizeMoneyInput(value).trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const initialForm = {
  sku: '',
  barcode: '',
  name: '',
  brand: '',
  categoryId: '',
  primarySupplierId: '',
  sectionId: '',
  shelfSide: '',
  shelfNo: '',
  shelfLevel: '',
  depotLocationCode: '',
  depotLocationManual: '',
  requiredStorageType: 'Ortam',
  unit: 'Adet',
  purchasePrice: '',
  salePrice: '',
  etiket: '',
  criticalStock: '',
  averageDesi: '',
  unitsPerCase: '24',
  casesPerPallet: '60',
  unitsPerPallet: '1440',
  isActive: true,
};

const initialFilters = {
  search: '',
  categoryId: '',
  supplierSearch: '',
  reyonNo: '',
  productState: 'listed',
  etiket: '',
  campaignOnly: false,
  criticalOnly: false,
};

const DRAFT_MISSING_FIELD_LABELS = {
  productName: 'ürün adı eksik',
  barcodeOrSku: 'barkod/SKU eksik',
  barcode: 'barkod eksik',
  sku: 'SKU eksik',
  category: 'kategori eksik',
  tag: 'etiket/tag eksik',
  salePrice: 'satış fiyatı eksik',
  purchasePrice: 'alış fiyatı eksik',
  vatRate: 'KDV eksik',
  section: 'reyon eksik',
  unit: 'birim eksik',
  brand: 'marka eksik',
  supplierMapping: 'tedarikçi bağlantısı eksik',
};

const isDraftProduct = (product = {}) => (
  product.isCatalogDraft === true
  || product.status === 'draft'
  || product.defaultStatus === 'draft'
  || product.payload?.status === 'draft'
  || product.payload?.defaultStatus === 'draft'
  || product.payload?.completionStatus === 'incomplete'
  || (
    product.isListed === false
    && product.isActive === false
    && String(product.catalogVisibility || '').trim() === 'staged'
  )
);

const isCatalogDraftProduct = (product = {}) => (
  product.isListed !== true
  && product.isActive !== true
  && isDraftProduct(product)
  && (
    product.sourceReadModel === 'catalog_import'
    || product.draftSource === 'catalog_import'
    || product.catalogImportId
    || product.catalogImportRowId
    || product.supplierCatalogRowId
    || product.supplierCatalogVersionId
    || product.supplierProductCode
    || product.catalogVisibility === 'staged'
    || product.payload?.sourceReadModel === 'catalog_import'
    || product.payload?.draftSource === 'catalog_import'
    || product.payload?.catalogVisibility === 'staged'
    || product.payload?.catalogImportId
    || product.payload?.catalogImportRowId
    || product.payload?.supplierCatalogRowId
    || product.payload?.supplierCatalogVersionId
    || product.payload?.supplierProductCode
    || product.payload?.supplierId
  )
);

const getDraftMissingFields = (product = {}) => (
  Array.isArray(product.missingFields) ? product.missingFields : []
)
  .map((field) => DRAFT_MISSING_FIELD_LABELS[field] || field)
  .filter(Boolean);

const getDraftPublishMissingFields = (form = {}) => {
  const missing = [];
  if (!String(form.name || '').trim()) missing.push('Ürün adı');
  if (!String(form.barcode || form.sku || '').trim()) missing.push('Barkod veya SKU');
  if (!String(form.categoryId || '').trim()) missing.push('Kategori');
  if (!String(form.etiket || '').trim()) missing.push('Etiket/tag');
  if (!String(form.brand || '').trim()) missing.push('Marka');
  if (!String(form.unit || '').trim()) missing.push('Birim');
  if (!(Number(form.purchasePrice) > 0)) missing.push('Alış fiyatı');
  if (!(Number(form.salePrice) > 0)) missing.push('Satış fiyatı');
  if (!String(form.sectionId || '').trim()) missing.push('Reyon/lokasyon');
  if (!String(form.primarySupplierId || '').trim()) missing.push('Tedarikçi bağlantısı');
  return missing;
};

const PRODUCT_PAGE_SIZE = 10;
const DEFAULT_PRODUCT_PAGINATION = {
  mode: 'offset',
  page: 1,
  limit: PRODUCT_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasNextPage: false,
};
const UNDEFINED_FIELD_TEXT = 'Tanımsız';

const hasDisplayNumber = (value) => value !== null
  && value !== undefined
  && value !== ''
  && Number.isFinite(Number(value));

const renderOptionalNumber = (value, options = {}) => (
  hasDisplayNumber(value)
    ? Number(value).toLocaleString('tr-TR', options)
    : UNDEFINED_FIELD_TEXT
);

const renderMissingFields = (fields) => {
  if (!Array.isArray(fields) || !fields.length) {
    return <span className="product-missing-fields product-missing-fields--complete" title="Eksik alan yok">+</span>;
  }

  const visibleFields = fields.slice(0, 2);
  const remainingCount = fields.length - visibleFields.length;

  return (
    <span className="product-missing-fields product-missing-fields--missing" title={fields.join(', ')}>
      {visibleFields.map((field) => (
        <span key={field} className="product-missing-fields__tag">{field}</span>
      ))}
      {remainingCount > 0 ? <span className="product-missing-fields__more">+{remainingCount}</span> : null}
    </span>
  );
};

const DEFAULT_PRODUCT_SUMMARY = {
  totalProducts: 0,
  activeListedProducts: 0,
  listedProducts: 0,
  unlistedProducts: 0,
  catalogOnlyProducts: 0,
  filteredTotal: 0,
  currentPageCount: 0,
};

const PRODUCT_SORT_FIELD_MAP = {
  sku: 'sku',
  barcode: 'barcode',
  name: 'name',
  brandName: 'brand',
  purchasePrice: 'purchase_price',
  salePrice: 'sale_price',
  discountedPrice: 'campaign_price',
  lastPriceChangeDate: 'last_price_change_at',
  updatedAt: 'updated_at',
};

const toProductApiSort = (sortConfig) => {
  const field = PRODUCT_SORT_FIELD_MAP[sortConfig?.key] || 'updated_at';
  const direction = sortConfig?.direction === 'asc' ? 'asc' : 'desc';
  return `${field}_${direction}`;
};

const UNIT_OPTIONS = [
  { value: 'Adet', label: 'Adet' },
  { value: 'Paket', label: 'Paket' },
  { value: 'Şişe', label: 'Şişe' },
  { value: 'Kutu', label: 'Kutu' },
  { value: 'Koli', label: 'Koli' },
  { value: 'Kg', label: 'Kg' },
  { value: 'g', label: 'Gram (g)' },
  { value: 'L', label: 'Litre (L)' },
  { value: 'ml', label: 'Mililitre (ml)' },
  { value: 'Kova', label: 'Kova' },
  { value: 'Bidon', label: 'Bidon' },
  { value: 'Tüp', label: 'Tüp' },
  { value: 'Viyol', label: 'Viyol' },
  { value: 'Demet', label: 'Demet' },
  { value: 'Kavanoz', label: 'Kavanoz' },
  { value: 'Kap', label: 'Kap' },
  { value: 'Poşet', label: 'Poşet' },
  { value: 'Rulo', label: 'Rulo' },
  { value: 'Tablet', label: 'Tablet' },
];

const BARCODE_LENGTH = 13;
const SKU_PREFIX = 'SHF';
const SKU_PADDING = 4;
const DEFAULT_SKU_CATEGORY_TOKEN = 'PRD';
const CATEGORY_TOKEN_IGNORE = new Set(['ve', 'ile', 'reyon', 'reyonu', 'kategori', 'urun', 'urunler', 'ürün', 'ürünler']);

const STORAGE_TYPE_OPTIONS = [
  { value: 'Ortam', label: 'Ortam' },
  { value: 'cold_chain', label: 'Soğuk Zincir' },
  { value: 'freezer', label: 'Donuk / Dondurucu' },
];

const normalizeStorageTypeValue = (value, fallback = 'Ortam') => {
  return normalizeStorageTypeCode(value, fallback);
};

const FRESH_PRODUCE_KEYWORDS = ['meyve', 'sebze'];

const normalizeKeywordText = (value) => String(value || '').toLocaleLowerCase('tr-TR');

const isFreshProduceText = (value) => {
  const text = normalizeKeywordText(value);
  return FRESH_PRODUCE_KEYWORDS.some((keyword) => text.includes(keyword));
};

const virtualDepotLabels = {
  'OVR-AMBIENT': 'Ortam Ortak Alan',
  'OVR-COLD': 'Soğuk Ortak Alan',
  'OVR-FROZEN': 'Donuk Ortak Alan',
  'DIRECT-SUPPLY': 'Doğrudan Tedarik',
  'NO-BACKROOM': 'Arka Depo Yok',
};

const normalizeDepotAssignmentType = (value) => {
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (!raw) return '';
  if (['fixed_pallet', 'fixed-pallet', 'physical', 'bounded_physical'].includes(raw)) return 'fixed_pallet';
  if (['shared_overflow', 'shared-overflow', 'virtual_overflow'].includes(raw)) return 'shared_overflow';
  if (['direct_supply', 'direct-supply', 'direct'].includes(raw)) return 'direct_supply';
  if (['no_backroom_stock', 'no-backroom-stock', 'no_backroom'].includes(raw)) return 'no_backroom_stock';
  return raw;
};

const normalizeCapacityMode = (value) => {
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (!raw) return '';
  if (['bounded', 'fixed', 'limited'].includes(raw)) return 'bounded';
  if (['unbounded_virtual', 'unbounded-virtual', 'unbounded', 'virtual'].includes(raw)) return 'unbounded_virtual';
  if (['not_applicable', 'not-applicable', 'direct_supply'].includes(raw)) return 'not_applicable';
  if (['no_capacity', 'no-capacity', 'no_backroom_stock'].includes(raw)) return 'no_capacity';
  if (['needs_review', 'needs-review'].includes(raw)) return 'needs_review';
  return raw;
};

const deriveCapacityMode = ({ assignment = '', mode = '', capacity = 0 } = {}) => {
  const normalizedAssignment = normalizeDepotAssignmentType(assignment);
  let normalizedMode = normalizeCapacityMode(mode);

  if (normalizedAssignment === 'fixed_pallet') normalizedMode = 'bounded';
  else if (normalizedAssignment === 'shared_overflow') normalizedMode = 'unbounded_virtual';
  else if (normalizedAssignment === 'direct_supply') normalizedMode = 'not_applicable';
  else if (normalizedAssignment === 'no_backroom_stock') normalizedMode = 'no_capacity';

  const numericCapacity = Math.max(0, Number(capacity || 0));
  if (!normalizedMode || (normalizedMode === 'bounded' && numericCapacity <= 0)) {
    return 'needs_review';
  }
  return normalizedMode;
};

const resolveDepotStatusLabel = (row) => {
  const code = String(row.depotLocationCode || row.defaultWarehouseLocationCode || '').trim();
  const normalizedStorage = normalizeStorageTypeValue(row.storageType || row.requiredStorageType || 'Ortam');
  if (code && virtualDepotLabels[code]) return virtualDepotLabels[code];
  if (normalizedStorage === 'freezer') return 'Donuk Ortak Alan';
  if (normalizedStorage === 'cold_chain') return 'Soğuk Ortak Alan';
  return 'Ortak Depo Alanı';
};

const normalizeDepotDisplayText = (value) => String(value || '')
  .replace(/\bSo\?uk\b/gi, 'Soğuk')
  .replace(/\bSo\?uk Zincir\b/gi, 'Soğuk Zincir')
  .replace(/\bSo\?uk Ortak Alan\b/gi, 'Soğuk Ortak Alan')
  .replace(/\bSoguk\b/gi, 'Soğuk')
  .replace(/\bSoguk Zincir\b/gi, 'Soğuk Zincir')
  .replace(/SoÄŸuk/g, 'Soğuk')
  .replace(/SoÃ„Å¸uk/g, 'Soğuk')
  .replace(/AlanÄ±/g, 'Alanı')
  .replace(/Alan\?/g, 'Alanı')
  .replace(/DoÄŸrudan/g, 'Doğrudan')
  .replace(/Do\?rudan/g, 'Doğrudan')
  .replace(/TedarikÃ§i/g, 'Tedarikçi');

const renderDepotLocation = (row) => {
  const code = row.depotLocationCode || row.defaultWarehouseLocationCode || '-';
  const cleanCode = normalizeDepotDisplayText(code);
  if (!row.isVirtualLocation) return cleanCode;
  const label = normalizeDepotDisplayText(row.depotLocationDisplay || row.depotLocationLabel || virtualDepotLabels[code] || formatDepotLocationLabel(code, 'Ortak Depo Alanı'));
  return (
    <span className="status-chip status-info" title={`${cleanCode} sanal depo alanıdır, fiziksel palet lokasyonu değildir.`}>
      {label}
    </span>
  );
};

export default function Products() {
  const { user } = useAuth();
  const location = useLocation();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [labelMaster, setLabelMaster] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [sections, setSections] = useState([]);
  const [warehouseLocations, setWarehouseLocations] = useState([]);
  const [supplierProducts, setSupplierProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReferenceLoading, setIsReferenceLoading] = useState(true);
  const [filters, setFilters] = useState(initialFilters);
  const [productPage, setProductPage] = useState(1);
  const [productPagination, setProductPagination] = useState(DEFAULT_PRODUCT_PAGINATION);
  const [productSummaryMeta, setProductSummaryMeta] = useState(DEFAULT_PRODUCT_SUMMARY);
  const [tableSort, setTableSort] = useState({ key: 'updatedAt', direction: 'desc' });
  const [form, setForm] = useState(initialForm);
  const [editingItem, setEditingItem] = useState(null);
  const [viewItem, setViewItem] = useState(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [rejectingDraftId, setRejectingDraftId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [modalInitialForm, setModalInitialForm] = useState(initialForm);

  const isAdmin = user?.role === 'admin' || user?.role === 'user';

  const loadReferenceData = async () => {
    try {
      setIsReferenceLoading(true);
      const supplierProductsPromise = procurementService.listSupplierProducts({ fetchAll: true });
      const [categoryList, supplierList, sectionList, labelList, locationResult] = await Promise.all([
        categoryService.list(),
        supplierService.list(),
        sectionService.list(),
        categoryService.listLabels({ forceRefresh: true }),
        warehouseService.listLocations().catch(() => ({ rows: [] })),
      ]);

      setCategories(categoryList);
      setSuppliers(supplierList);
      setSections(sectionList);
      setLabelMaster(Array.isArray(labelList) ? labelList : []);
      setWarehouseLocations(Array.isArray(locationResult?.rows) ? locationResult.rows : []);

      try {
        const supplierProductList = await supplierProductsPromise;
        setSupplierProducts(Array.isArray(supplierProductList) ? supplierProductList : []);
      } catch {
        setSupplierProducts([]);
      }
    } catch (error) {
      setToast({ type: 'error', title: 'Ürünler', message: error.message || 'Referans veriler yüklenemedi.' });
    } finally {
      setIsReferenceLoading(false);
    }
  };

  const resolveSectionIdFilter = useCallback((value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    const matched = sections.find((section) => (
      String(section.number ?? '').trim() === normalized
      || includesNormalized(section.name || '', normalized)
    ));
    return matched?.id || '';
  }, [sections]);

  const loadProducts = useCallback(async () => {
    try {
      setIsLoading(true);
      const productState = filters.productState || 'listed';
      const isDraftFilter = productState === 'drafts';
      const isAllFilter = productState === 'all';
      const isInactiveFilter = productState === 'inactive';
      const productList = await productService.list({
        fetchAll: false,
        universe: isDraftFilter || isAllFilter ? 'all' : 'listed_active',
        includeUnlisted: isDraftFilter || isAllFilter,
        includeDrafts: isDraftFilter ? '1' : '',
        catalogVisibility: isDraftFilter ? 'staged' : '',
        sourceReadModel: isDraftFilter ? 'catalog_import' : '',
        completionStatus: isDraftFilter ? 'incomplete' : '',
        search: String(filters.search || '').trim(),
        categoryId: filters.categoryId,
        supplierSearch: String(filters.supplierSearch || '').trim(),
        sectionId: resolveSectionIdFilter(filters.reyonNo),
        status: isDraftFilter
          ? 'draft'
          : isInactiveFilter
            ? 'inactive'
            : '',
        etiket: filters.etiket,
        campaignOnly: filters.campaignOnly ? 'true' : '',
        includeGeneralCampaigns: true,
        page: productPage,
        limit: PRODUCT_PAGE_SIZE,
        includeTotal: true,
        sort: toProductApiSort(tableSort),
        forceRefresh: true,
      });
      const pagination = productList?.meta?.pagination || DEFAULT_PRODUCT_PAGINATION;
      const responseSummary = productList?.meta?.summary || {};
      const totalPages = Number(pagination.totalPages || 1);
      if (productPage > totalPages) {
        setProductPage(totalPages);
      }
      setProducts(productList);
      setProductSummaryMeta({
        ...DEFAULT_PRODUCT_SUMMARY,
        ...responseSummary,
        filteredTotal: Number(responseSummary.filteredTotal ?? pagination.total ?? 0),
        currentPageCount: Number(responseSummary.currentPageCount ?? productList.length ?? 0),
      });
      setProductPagination({
        ...DEFAULT_PRODUCT_PAGINATION,
        ...pagination,
        page: pagination.page || productPage,
        limit: pagination.limit || PRODUCT_PAGE_SIZE,
        total: Number(pagination.total || 0),
        totalPages,
      });
    } catch (error) {
      setToast({ type: 'error', title: 'Ürünler', message: error.message || 'Ürünler yüklenemedi.' });
    } finally {
      setIsLoading(false);
    }
  }, [filters, productPage, resolveSectionIdFilter, tableSort]);

  useEffect(() => {
    loadReferenceData();
  }, []);

  useEffect(() => {
    setProductPage(1);
  }, [filters, tableSort]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Auto-open edit modal when navigated with highlightProductId state
  useEffect(() => {
    const targetId = location.state?.highlightProductId;
    if (targetId && products.length > 0) {
      const target = products.find((p) => p.id === targetId);
      if (target) void openEditModal(target);
      // Clear state to avoid re-triggering
      window.history.replaceState({}, '');
    }
  }, [location.state, products]);

  const taxonomyResolver = useMemo(
    () => buildTaxonomyResolver({ products, categories }),
    [products, categories]
  );

  const categoryLookup = useMemo(
    () => taxonomyResolver.categoryLookup || buildCategoryLookup(categories),
    [taxonomyResolver, categories]
  );

  const enrichedRows = useMemo(() => {
    return products.map((item) => {
      const taxonomy = resolveProductTaxonomy(item, categoryLookup);
      const stock = item.stockSummary || item.stock || null;

      const batches = Array.isArray(stock?.productBatches) ?
        stock.productBatches
        : (Array.isArray(stock?.batches) ? stock.batches : []);
      const activeBatches = batches
        .filter((batch) => Number(batch?.totalQuantity || 0) > 0)
        .sort((left, right) => String(left?.skt || '').localeCompare(String(right?.skt || ''), 'tr'));
      const batchPreviewRows = Array.isArray(item.batchPreview) ? item.batchPreview : [];
      const batchNoList = (Array.isArray(item.batchNoPreview) && item.batchNoPreview.length
        ? item.batchNoPreview.map((batchNo) => String(batchNo || '').trim()).filter(Boolean)
        : activeBatches.map((batch) => String(batch.batchNo || '').trim()).filter(Boolean))
        .slice(0, 3);
      const reyonStock = Number(stock?.shelfStock ?? item.shelfStock ?? 0);
      const depoStock = Number(stock?.warehouseStock ?? item.warehouseStock ?? 0);
      const reyonCapacity = Number(stock?.shelfMaxStock ?? item.shelfCapacity ?? item.maxShelfStock ?? item.shelfMaxStock ?? 0);
      const depoCapacity = Number(stock?.warehouseMaxStock ?? item.depotCapacity ?? item.warehouseMaxStock ?? item.maxWarehouseStock ?? item.maxStock ?? 0);
      const totalStock = Number(
        stock?.totalStock
        ?? stock?.quantity
        ?? item.totalStock
        ?? item.currentStock
          ?? (reyonStock + depoStock)
      );

      const storageType = normalizeStorageTypeValue(item.requiredStorageType);
      const depotAssignmentType = normalizeDepotAssignmentType(
        stock?.depotAssignmentType
        ?? item.depotAssignmentType
        ?? item.warehouseAssignmentType
      );
      const rawCapacityMode = normalizeCapacityMode(
        stock?.capacityMode
        ?? item.capacityMode
        ?? item.warehouseCapacityMode
      );
      const capacityMode = deriveCapacityMode({
        assignment: depotAssignmentType,
        mode: rawCapacityMode,
        capacity: depoCapacity,
      });
      const depotLocationCode = item.depotLocationCode || item.defaultWarehouseLocationCode || '-';
      const isVirtualLocation = item.isVirtualLocation === true
        || depotAssignmentType === 'shared_overflow'
        || capacityMode === 'unbounded_virtual'
        || String(depotLocationCode).startsWith('OVR-');
      const storageTemperature = storageType === 'freezer' ?
        '-18°C'
        : storageType === 'cold_chain' ?
          '+1/+4°C'
          : 'Ortam';

      const batchStockSummary = item.shortBatchSummary || (activeBatches.length
        ? activeBatches
          .slice(0, 3)
          .map((batch) => `${batch.batchNo || '-'}: ${formatNumber(Number(batch.totalQuantity || 0))}`)
          .join(' | ')
        : '-');
      const resolvedBatchCount = Number(item.batchCount ?? stock?.batchCount ?? activeBatches.length ?? 0);
      const draftMissingFields = getDraftMissingFields(item);

      return {
        ...item,
        isFreshProduce: isFreshProduceText(taxonomy.mainCategory) || isFreshProduceText(taxonomy.subCategory) || isFreshProduceText(item.etiket),
        brandName: item.brand || '-',
        mainCategoryName: taxonomy.mainCategory,
        subCategoryName: taxonomy.subCategory,
        primarySupplierName: item.supplierName || item.primarySupplier?.name || '-',
        shelfCodeResolved: String(item.shelfCodeResolved || '').trim(),
        reyonStock,
        depoStock,
        reyonCapacity,
        depoCapacity,
        totalStockResolved: totalStock,
        batchCount: resolvedBatchCount,
        batchNo1: batchNoList[0] || '',
        batchNo2: batchNoList[1] || '',
        batchNo3: batchNoList[2] || '',
        batchQty1: Number(batchPreviewRows[0]?.totalQuantity ?? activeBatches[0]?.totalQuantity ?? 0),
        batchQty2: Number(batchPreviewRows[1]?.totalQuantity ?? activeBatches[1]?.totalQuantity ?? 0),
        batchQty3: Number(batchPreviewRows[2]?.totalQuantity ?? activeBatches[2]?.totalQuantity ?? 0),
        batchStockSummary,
        storageTypeLabel: formatStorageTypeLabel(storageType),
        storageTemperature,
        placementPriority: item.placementPriority || '-',
        averageDesi: item.averageDesi,
        unitsPerCase: item.unitsPerCase,
        casesPerPallet: item.casesPerPallet,
        unitsPerPallet: item.unitsPerPallet,
        depotAssignmentType,
        capacityMode,
        needsReview: capacityMode === 'needs_review' || item.needsReview === true,
        storageType,
        draftMissingFields,
        isDraftProduct: isDraftProduct(item),
        depotLocationCode,
        depotLocationLabel: item.depotLocationDisplay || item.depotLocationLabel || virtualDepotLabels[item.depotLocationCode] || formatDepotLocationLabel(item.depotLocationCode, '-'),
        isVirtualLocation,
      };
    });
  }, [products, categoryLookup]);

  const filteredRows = enrichedRows;
  const inventoryLastCountMap = useMemo(() => buildInventoryLastCountMap(enrichedRows), [enrichedRows]);
  const displayRows = useMemo(
    () => filteredRows.map((row) => ({
      ...row,
      lastCountedAt: inventoryLastCountMap.get(String(row.id || ''))?.countedAt || row.lastCountedAt || null,
    })),
    [filteredRows, inventoryLastCountMap]
  );

  const summary = useMemo(
    () => ({
      total: productPagination.total || productSummaryMeta.filteredTotal || enrichedRows.length,
      active: productSummaryMeta.activeListedProducts || 0,
      currentPage: productSummaryMeta.currentPageCount || enrichedRows.length,
      critical: enrichedRows.filter((item) => item.isCritical).length,
      overCapacity: enrichedRows.filter((item) => {
        const depotMeta = resolveStockPairMeta({
          current: item.warehouseStock,
          capacity: item.warehouseMaxStock,
          critical: item.criticalStock,
        });
        const shelfMeta = resolveStockPairMeta({
          current: item.shelfStock,
          capacity: item.maxShelfStock ?? item.shelfMaxStock,
          critical: item.criticalStock,
        });
        return depotMeta.overCapacity || shelfMeta.overCapacity;
      }).length,
    }),
    [enrichedRows, productPagination.total, productSummaryMeta]
  );

  const productInsightData = useMemo(() => {
    const totalRows = Math.max(enrichedRows.length, 1);
    const categoryMap = enrichedRows.reduce((acc, item) => {
      const key = String(item.mainCategoryName || item.subCategoryName || 'Kategorisiz').trim() || 'Kategorisiz';
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map());

    const categoryDistribution = [...categoryMap.entries()]
      .map(([label, count]) => ({
        label,
        count,
        percent: Math.round((count / totalRows) * 100),
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);

    const riskBuckets = enrichedRows.reduce((acc, item) => {
      const totalStock = Number(item.totalStockResolved ?? 0);
      const criticalStock = Math.max(0, Number(item.criticalStock || 0));
      if (criticalStock > 0 && totalStock <= criticalStock) acc.critical += 1;
      else if (criticalStock > 0 && totalStock <= Math.max(criticalStock * 1.5, criticalStock + 5)) acc.watch += 1;
      else acc.healthy += 1;
      return acc;
    }, { critical: 0, watch: 0, healthy: 0 });

    const riskDistribution = [
      { id: 'critical', label: 'Kritik', count: riskBuckets.critical, toneClass: 'is-critical' },
      { id: 'watch', label: 'Yakın Risk', count: riskBuckets.watch, toneClass: 'is-watch' },
      { id: 'healthy', label: 'Sağlıklı', count: riskBuckets.healthy, toneClass: 'is-healthy' },
    ].map((item) => ({
      ...item,
      percent: Math.round((item.count / totalRows) * 100),
    }));

    const listingBaseTotal = Math.max(
      Number(productSummaryMeta.listedProducts || 0)
      + Number(productSummaryMeta.unlistedProducts || 0)
      + Number(productSummaryMeta.catalogOnlyProducts || 0),
      1
    );

    const listingDistribution = [
      {
        id: 'listed',
        label: 'Listelenmiş',
        count: Number(productSummaryMeta.listedProducts || productSummaryMeta.activeListedProducts || 0),
        toneClass: 'is-listed',
      },
      {
        id: 'unlisted',
        label: 'Listelenmemiş',
        count: Number(productSummaryMeta.unlistedProducts || 0),
        toneClass: 'is-unlisted',
      },
      {
        id: 'catalog',
        label: 'Sadece katalog',
        count: Number(productSummaryMeta.catalogOnlyProducts || 0),
        toneClass: 'is-catalog',
      },
    ].map((item) => ({
      ...item,
      percent: Math.round((item.count / listingBaseTotal) * 100),
    }));

    const criticalProducts = enrichedRows
      .filter((item) => item.isCritical)
      .map((item) => {
        const totalStock = Number(item.totalStockResolved ?? 0);
        const criticalStock = Math.max(0, Number(item.criticalStock || 0));
        return {
          id: item.id,
          name: item.name || 'Ürün',
          totalStock,
          criticalStock,
          gap: Math.max(criticalStock - totalStock, 0),
        };
      })
      .sort((left, right) => right.gap - left.gap || left.totalStock - right.totalStock)
      .slice(0, 4);

    return {
      categoryDistribution,
      riskDistribution,
      listingDistribution,
      criticalProducts,
    };
  }, [enrichedRows, productSummaryMeta]);

  const matchedSupplierOptions = useMemo(() => {
    if (!editingItem?.id) return [];
    const map = new Map(suppliers.map((item) => [String(item.id), item]));
    return supplierProducts
      .filter((row) => String(row.productId) === String(editingItem.id) && row.isActive !== false)
      .map((row) => map.get(String(row.supplierId)))
      .filter(Boolean)
      .map((item) => ({ value: String(item.id), label: item.name }));
  }, [editingItem?.id, supplierProducts, suppliers]);

  const selectedCategoryName = useMemo(() => {
    if (!form.categoryId) return '';
    return categories.find((item) => String(item.id) === String(form.categoryId))?.name || '';
  }, [categories, form.categoryId]);

  const filterLabelOptions = useMemo(() => {
    const seen = new Set();
    return labelMaster
      .map((item) => ({
        value: String(item.labelName || '').trim(),
        label: getReadableCategoryLabelName(item),
      }))
      .filter((item) => {
        if (!item.value || seen.has(item.value)) return false;
        seen.add(item.value);
        return true;
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'tr'));
  }, [labelMaster]);

  const selectedCategoryTagOptions = useMemo(() => {
    if (!form.categoryId) return [];
    const options = labelMaster
      .filter((item) => String(item.categoryId || '') === String(form.categoryId))
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.labelName || '').localeCompare(String(b.labelName || ''), 'tr'))
      .map((item) => ({
        value: String(item.labelId || item.id),
        labelName: String(item.labelName || ''),
        labelCode: String(item.labelDisplayCode || item.labelCode || ''),
        labelSlug: String(item.labelSlug || ''),
      }));

    const currentLabelId = String(form.etiket || '').trim();
    if (currentLabelId && !options.some((item) => item.value === currentLabelId)) {
      const matched = labelMaster.find((item) => String(item.labelId || item.id) === currentLabelId);
      if (matched) {
        options.push({
          value: String(matched.labelId || matched.id),
          labelName: String(matched.labelName || ''),
          labelCode: String(matched.labelDisplayCode || matched.labelCode || ''),
          labelSlug: String(matched.labelSlug || ''),
        });
      }
    }
    return options;
  }, [form.categoryId, form.etiket, labelMaster]);

  const isFreshProduceSelection = useMemo(() => {
    if (!form.categoryId) return false;
    const selectedCategory = categories.find((item) => String(item.id) === String(form.categoryId));
    const tags = selectedCategoryTagOptions.map((item) => item.labelName);
    return isFreshProduceText(selectedCategory?.name)
      || tags.some((tag) => isFreshProduceText(tag))
      || isFreshProduceText(selectedCategoryTagOptions.find((item) => item.value === String(form.etiket || ''))?.labelName);
  }, [categories, form.categoryId, form.etiket, selectedCategoryTagOptions]);

  const logisticsLabels = useMemo(() => {
    if (!isFreshProduceSelection) {
      return {
        unitsPerCase: 'Koli İçi Adet',
        casesPerPallet: 'Palet Başına Koli',
        unitsPerPallet: 'Palet Başına Toplam Adet',
      };
    }

    return {
      unitsPerCase: 'Kasa Başına Kg',
      casesPerPallet: 'Palet Başına Kasa',
      unitsPerPallet: 'Palet Başına Toplam Kg',
    };
  }, [isFreshProduceSelection]);

  const resolveFirstEmptyShelfForSection = useCallback((targetSectionId, excludedProductId = null) => {
    if (!targetSectionId) return null;

    const occupied = new Set();
    products.forEach((item) => {
      if (excludedProductId && String(item.id) === String(excludedProductId)) return;
      if (
        String(item.sectionId || '') === String(targetSectionId)
        && item.shelfSide
        && Number.isFinite(Number(item.shelfNo))
        && Number.isFinite(Number(item.shelfLevel))
      ) {
        occupied.add(`${item.shelfSide}-${Number(item.shelfNo)}-${Number(item.shelfLevel)}`);
      }
    });

    const sideOrder = ['R', 'L'];
    for (const side of sideOrder) {
      for (let shelfNo = 1; shelfNo <= 10; shelfNo += 1) {
        for (let shelfLevel = 1; shelfLevel <= 5; shelfLevel += 1) {
          const key = `${side}-${shelfNo}-${shelfLevel}`;
          if (!occupied.has(key)) {
            return { side, shelfNo, shelfLevel };
          }
        }
      }
    }

    return null;
  }, [products]);

  const resolveRecommendedSectionIdForCategory = useCallback((categoryId) => {
    if (!categoryId) return '';

    const sectionUsage = new Map();
    products.forEach((item) => {
      if (String(item.categoryId || '') === String(categoryId) && item.sectionId) {
        const key = String(item.sectionId);
        sectionUsage.set(key, (sectionUsage.get(key) || 0) + 1);
      }
    });

    let recommendedSectionId = '';
    let maxUsage = 0;
    sectionUsage.forEach((count, sectionId) => {
      if (count > maxUsage) {
        maxUsage = count;
        recommendedSectionId = sectionId;
      }
    });

    if (recommendedSectionId) return recommendedSectionId;

    const selectedCategory = categories.find((item) => String(item.id) === String(categoryId));
    const categoryTokens = String(selectedCategory?.name || '')
      .toLocaleLowerCase('tr-TR')
      .replaceAll('&', ' ')
      .split(/[^a-z0-9çşıöşü]+/i)
      .filter((token) => token.length > 1 && !CATEGORY_TOKEN_IGNORE.has(token));

    if (!categoryTokens.length) return '';

    let semanticSection = null;
    let semanticScore = 0;
    sections
      .filter((section) => section.isActive)
      .forEach((section) => {
        const sectionTokens = String(section.name || '')
          .toLocaleLowerCase('tr-TR')
          .replaceAll('&', ' ')
          .split(/[^a-z0-9çşıöşü]+/i)
          .filter((token) => token.length > 1 && !CATEGORY_TOKEN_IGNORE.has(token));
        const sectionTokenSet = new Set(sectionTokens);
        const score = categoryTokens.reduce((sum, token) => (sectionTokenSet.has(token) ? sum + 1 : sum), 0);
        if (score > semanticScore) {
          semanticScore = score;
          semanticSection = section;
        }
      });

    return semanticSection ? String(semanticSection.id) : '';
  }, [categories, products, sections]);

  const selectedStorageTypeLabel = useMemo(() => {
    const selected = STORAGE_TYPE_OPTIONS.find((item) => item.value === form.requiredStorageType);
    return selected?.label || 'Ortam';
  }, [form.requiredStorageType]);

  const defaultWarehouseLocationPreview = useMemo(() => {
    const explicitCode = String(form.depotLocationCode || '').trim();
    if (explicitCode === '__manual') return String(form.depotLocationManual || '').trim() || 'Elle giriş bekleniyor';
    if (explicitCode === '__shared') {
      const normalizedStorage = normalizeStorageTypeValue(form.requiredStorageType || 'Ortam');
      if (normalizedStorage === 'freezer') return 'OVR-FROZEN';
      if (normalizedStorage === 'cold_chain') return 'OVR-COLD';
      return 'OVR-AMBIENT';
    }
    if (explicitCode) return explicitCode;

    if (editingItem?.defaultWarehouseLocationCode) {
      return editingItem.defaultWarehouseLocationCode;
    }

    const normalizedStorageType = normalizeStorageTypeValue(form.requiredStorageType);
    const counts = new Map();
    products.forEach((item) => {
      if (normalizeStorageTypeValue(item.requiredStorageType) !== normalizedStorageType) return;
      const locationCode = String(item.defaultWarehouseLocationCode || '').trim();
      if (!locationCode) return;
      counts.set(locationCode, (counts.get(locationCode) || 0) + 1);
    });

    if (!counts.size) {
      return '-';
    }

    let bestCode = '-';
    let bestCount = 0;
    counts.forEach((count, code) => {
      if (count > bestCount) {
        bestCount = count;
        bestCode = code;
      }
    });

    return bestCode;
  }, [editingItem?.defaultWarehouseLocationCode, form.depotLocationCode, form.depotLocationManual, form.requiredStorageType, products]);

  const createRandomBarcode = () => {
    let value = '';
    for (let i = 0; i < BARCODE_LENGTH; i += 1) {
      value += Math.floor(Math.random() * 10);
    }
    return value;
  };

  const generateUniqueBarcode = () => {
    const usedBarcodes = new Set(
      products
        .map((item) => String(item.barcode || '').trim())
        .filter(Boolean)
    );

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = createRandomBarcode();
      if (!usedBarcodes.has(candidate)) {
        return candidate;
      }
    }

    return String(Date.now()).slice(-BARCODE_LENGTH);
  };

  const resolveSkuCategoryToken = (categoryId) => {
    const selectedCategory = categories.find((item) => String(item.id) === String(categoryId));
    const preferred = String(selectedCategory?.code || '').trim();
    if (preferred) {
      const normalizedPreferred = preferred
        .toLocaleUpperCase('tr-TR')
        .replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, '')
        .slice(0, 4);
      if (normalizedPreferred) return normalizedPreferred;
    }

    const fallback = String(selectedCategory?.name || '')
      .toLocaleUpperCase('tr-TR')
      .replace(/[^A-Z0-9ÇĞİÖŞÜ]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.slice(0, 2))
      .join('')
      .slice(0, 4);

    return fallback || DEFAULT_SKU_CATEGORY_TOKEN;
  };

  const generateUniqueSku = (categoryId = '', excludeProductId = null) => {
    const categoryToken = resolveSkuCategoryToken(categoryId);
    const skuPrefix = `${SKU_PREFIX}-${categoryToken}-`;
    const skuPattern = new RegExp(`^${skuPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`, 'i');
    const usedSkus = new Set(
      products
        .filter((item) => item.id !== excludeProductId)
        .map((item) => String(item.sku || '').trim().toUpperCase())
        .filter(Boolean)
    );

    const maxSequence = products.reduce((max, item) => {
      const raw = String(item.sku || '').trim();
      const match = raw.match(skuPattern);
      if (!match) return max;
      const seq = Number(match[1]);
      if (!Number.isFinite(seq)) return max;
      return Math.max(max, seq);
    }, 0);

    let nextSequence = maxSequence + 1;
    for (let attempt = 0; attempt < 5000; attempt += 1) {
      const candidate = `${skuPrefix}${String(nextSequence).padStart(SKU_PADDING, '0')}`;
      if (!usedSkus.has(candidate.toUpperCase())) {
        return candidate;
      }
      nextSequence += 1;
    }

    return `${skuPrefix}${String(Date.now()).slice(-SKU_PADDING)}`;
  };

  const recommendedSection = useMemo(() => {
    if (!form.categoryId || !sections.length) {
      return null;
    }

    const tokenize = (value) =>
      String(value || '')
        .toLocaleLowerCase('tr-TR')
        .replaceAll('&', ' ')
        .split(/[^a-z0-9çşıöşü]+/i)
        .filter((token) => token.length > 1 && !CATEGORY_TOKEN_IGNORE.has(token));

    const categoryTokens = tokenize(selectedCategoryName);

    let semanticCandidate = null;
    if (categoryTokens.length) {
      sections
        .filter((section) => section.isActive)
        .forEach((section) => {
          const sectionTokenSet = new Set(tokenize(section.name));
          const score = categoryTokens.reduce((sum, token) => (sectionTokenSet.has(token) ? sum + 1 : sum), 0);
          if (score <= 0) return;

          if (!semanticCandidate || score > semanticCandidate.score) {
            semanticCandidate = { section, score };
          }
        });
    }

    if (semanticCandidate?.section) {
      return {
        id: String(semanticCandidate.section.id),
        name: semanticCandidate.section.name,
        number: semanticCandidate.section.number,
        usageCount: 0,
      };
    }

    const sectionUsage = new Map();
    products.forEach((item) => {
      if (String(item.categoryId) === String(form.categoryId) && item.sectionId) {
        const key = String(item.sectionId);
        sectionUsage.set(key, (sectionUsage.get(key) || 0) + 1);
      }
    });

    if (!sectionUsage.size) {
      return null;
    }

    let recommendedSectionId = null;
    let maxUsage = 0;
    sectionUsage.forEach((count, sectionId) => {
      if (count > maxUsage) {
        maxUsage = count;
        recommendedSectionId = sectionId;
      }
    });

    const section = sections.find((item) => String(item.id) === recommendedSectionId && item.isActive);
    if (!section) {
      return null;
    }

    return {
      id: String(section.id),
      name: section.name,
      number: section.number,
      usageCount: maxUsage,
    };
  }, [form.categoryId, products, sections, selectedCategoryName]);

  const suggestedEmptyShelf = useMemo(() => {
    const targetSectionId = String(form.sectionId || recommendedSection?.id || '');
    if (!targetSectionId) return null;

    const occupied = new Set();
    products.forEach((item) => {
      if (editingItem && item.id === editingItem.id) return;
      if (
        String(item.sectionId) === targetSectionId
        && item.shelfSide
        && Number.isFinite(Number(item.shelfNo))
        && Number.isFinite(Number(item.shelfLevel))
      ) {
        occupied.add(`${item.shelfSide}-${Number(item.shelfNo)}-${Number(item.shelfLevel)}`);
      }
    });

    const sideOrder = ['R', 'L'];
    for (const side of sideOrder) {
      for (let shelfNo = 1; shelfNo <= 10; shelfNo += 1) {
        for (let shelfLevel = 1; shelfLevel <= 5; shelfLevel += 1) {
          const key = `${side}-${shelfNo}-${shelfLevel}`;
          if (!occupied.has(key)) {
            return { side, shelfNo, shelfLevel };
          }
        }
      }
    }

    return null;
  }, [editingItem, form.sectionId, products, recommendedSection]);

  const currentShelfCodePreview = useMemo(() => {
    const resolvedSectionId = String(form.sectionId || recommendedSection?.id || '');
    const section = sections.find((item) => String(item.id) === resolvedSectionId);
    const shelfSide = String(form.shelfSide || suggestedEmptyShelf?.side || '').trim();
    const shelfNo = String(form.shelfNo || suggestedEmptyShelf?.shelfNo || '').trim();
    const shelfLevel = String(form.shelfLevel || suggestedEmptyShelf?.shelfLevel || '').trim();

    if (!section || !shelfSide || !shelfNo || !shelfLevel) {
      return '-';
    }
    return `${section.number}${shelfSide}${shelfNo}-${shelfLevel}`;
  }, [form.sectionId, form.shelfLevel, form.shelfNo, form.shelfSide, recommendedSection?.id, sections, suggestedEmptyShelf?.shelfLevel, suggestedEmptyShelf?.shelfNo, suggestedEmptyShelf?.side]);

  const sharedDepotCode = useMemo(() => {
    const normalizedStorage = normalizeStorageTypeValue(form.requiredStorageType || 'Ortam');
    if (normalizedStorage === 'freezer') return 'OVR-FROZEN';
    if (normalizedStorage === 'cold_chain') return 'OVR-COLD';
    return 'OVR-AMBIENT';
  }, [form.requiredStorageType]);

  const selectedDepotLocationCode = useMemo(() => {
    if (form.depotLocationCode === '__manual') return String(form.depotLocationManual || '').trim();
    if (form.depotLocationCode === '__shared') return sharedDepotCode;
    return String(form.depotLocationCode || '').trim();
  }, [form.depotLocationCode, form.depotLocationManual, sharedDepotCode]);

  const normalizeFormForCompare = (value) => ({
    ...value,
    shelfNo: value.shelfNo === '' || value.shelfNo == null ? '' : String(value.shelfNo),
    shelfLevel: value.shelfLevel === '' || value.shelfLevel == null ? '' : String(value.shelfLevel),
    salePrice: value.salePrice === '' || value.salePrice == null ? '' : String(value.salePrice),
    purchasePrice: value.purchasePrice === '' || value.purchasePrice == null ? '' : String(value.purchasePrice),
    criticalStock: value.criticalStock === '' || value.criticalStock == null ? '' : String(value.criticalStock),
    averageDesi: value.averageDesi === '' || value.averageDesi == null ? '' : String(value.averageDesi),
    depotLocationCode: value.depotLocationCode || '',
    depotLocationManual: value.depotLocationManual || '',
    unitsPerCase: value.unitsPerCase === '' || value.unitsPerCase == null ? '' : String(value.unitsPerCase),
    casesPerPallet: value.casesPerPallet === '' || value.casesPerPallet == null ? '' : String(value.casesPerPallet),
    unitsPerPallet: value.unitsPerPallet === '' || value.unitsPerPallet == null ? '' : String(value.unitsPerPallet),
  });

  const isModalDirty = useMemo(() => {
    if (!isModalOpen) {
      return false;
    }
    return JSON.stringify(normalizeFormForCompare(form)) !== JSON.stringify(normalizeFormForCompare(modalInitialForm));
  }, [form, isModalOpen, modalInitialForm]);

  const openCreateModal = () => {
    const formWithSuggestedBarcode = {
      ...initialForm,
      sku: generateUniqueSku(''),
      barcode: generateUniqueBarcode(),
    };
    setEditingItem(null);
    setForm(formWithSuggestedBarcode);
    setModalInitialForm(formWithSuggestedBarcode);
    setIsModalOpen(true);
  };

  const openEditModal = async (item) => {
    let detailItem = item;
    if (item?.id) {
      try {
        detailItem = await productService.getById(item.id);
      } catch (error) {
        setToast({ type: 'error', title: 'Ürünler', message: error.message || 'Ürün detayı yüklenemedi.' });
      }
    }

    const mappedForm = {
      sku: detailItem.sku,
      barcode: detailItem.barcode || '',
      name: detailItem.name,
      categoryId: detailItem.categoryId,
      primarySupplierId: detailItem.supplierId || detailItem.primarySupplier?.id || '',
      sectionId: detailItem.sectionId || '',
      shelfSide: detailItem.shelfSide || '',
      shelfNo: detailItem.shelfNo || '',
      shelfLevel: detailItem.shelfLevel || '',
      depotLocationCode: detailItem.defaultWarehouseLocationCode || detailItem.depotLocationCode || '',
      depotLocationManual: '',
      requiredStorageType: normalizeStorageTypeValue(detailItem.requiredStorageType),
      unit: detailItem.unit || 'adet',
      salePrice: detailItem.salePrice,
      purchasePrice: detailItem.purchasePrice === 0 || Number(detailItem.purchasePrice) > 0 ? String(detailItem.purchasePrice) : '',
      etiket: String(detailItem.labelId || detailItem.tagId || detailItem.selectedTagId || ''),
      criticalStock: detailItem.criticalStock,
      brand: detailItem.brand || '',
      averageDesi: detailItem.averageDesi === 0 || Number(detailItem.averageDesi) > 0 ? String(detailItem.averageDesi) : '',
      unitsPerCase: String(detailItem.unitsPerCase || 24),
      casesPerPallet: String(detailItem.casesPerPallet || 60),
      unitsPerPallet: String(detailItem.unitsPerPallet || (Number(detailItem.unitsPerCase || 24) * Number(detailItem.casesPerPallet || 60))),
      isActive: detailItem.isActive,
    };

    setEditingItem(detailItem);
    setForm(mappedForm);
    setModalInitialForm(mappedForm);
    setIsModalOpen(true);
  };

  const openViewModal = async (item) => {
    let detailItem = item;
    if (item?.id) {
      try {
        detailItem = await productService.getById(item.id);
      } catch (error) {
        setToast({ type: 'error', title: 'Ürünler', message: error.message || 'Ürün detayı yüklenemedi.' });
      }
    }
    setViewItem(detailItem);
    setIsViewModalOpen(true);
  };

  const closeModal = () => {
    setCloseConfirmOpen(false);
    setIsModalOpen(false);
    setForm(initialForm);
    setModalInitialForm(initialForm);
    setEditingItem(null);
  };

  const requestCloseModal = () => {
    if (isModalDirty) {
      setCloseConfirmOpen(true);
      return;
    }
    closeModal();
  };

  const handleFormChange = (event) => {
    const { name, value, type, checked } = event.target;
    const normalizedValue = ['purchasePrice', 'salePrice'].includes(name) ? normalizeMoneyInput(value) : value;
    setForm((current) => {
      const next = { ...current, [name]: type === 'checkbox' ? checked : normalizedValue };

      if (name === 'categoryId' && !editingItem) {
        next.sku = generateUniqueSku(value);
      }

      if (name === 'categoryId') {
        const selectedCategory = categories.find((item) => String(item.id) === String(value));
        const availableTagIds = labelMaster
          .filter((item) => String(item.categoryId || '') === String(value))
          .map((item) => String(item.labelId || item.id));
        const currentEtiket = String(next.etiket || '').trim();
        const categoryChanged = String(current.categoryId || '') !== String(value || '');
        const nextEtiket = categoryChanged ?
          ''
          : (availableTagIds.includes(currentEtiket) ? currentEtiket : '');
        next.etiket = nextEtiket;
        if (selectedCategory?.requiresFreezer) next.requiredStorageType = 'freezer';
        else if (selectedCategory?.requiresColdChain) next.requiredStorageType = 'cold_chain';
        else next.requiredStorageType = 'Ortam';

        const isFreshProduceCategory = isFreshProduceText(selectedCategory?.name)
          || selectedCategoryTagOptions.some((tag) => isFreshProduceText(tag.labelName))
          || isFreshProduceText(selectedCategoryTagOptions.find((tag) => tag.value === nextEtiket)?.labelName);
        if (isFreshProduceCategory) {
          next.unit = 'kg';
          next.unitsPerCase = next.unitsPerCase || '20';
          next.casesPerPallet = next.casesPerPallet || '40';
          next.unitsPerPallet = String(Math.max(1, Number(next.unitsPerCase || 20)) * Math.max(1, Number(next.casesPerPallet || 40)));
        }

        if (!editingItem) {
          const recommendedSectionId = resolveRecommendedSectionIdForCategory(value);
          if (recommendedSectionId) {
            next.sectionId = recommendedSectionId;
            const autoShelf = resolveFirstEmptyShelfForSection(recommendedSectionId, null);
            if (autoShelf) {
              next.shelfSide = autoShelf.side;
              next.shelfNo = String(autoShelf.shelfNo);
              next.shelfLevel = String(autoShelf.shelfLevel);
            }
          }
        }
      }

      if (name === 'unitsPerCase' || name === 'casesPerPallet') {
        const unitsPerCase = Math.max(1, Number(next.unitsPerCase || 0));
        const casesPerPallet = Math.max(1, Number(next.casesPerPallet || 0));
        next.unitsPerPallet = String(unitsPerCase * casesPerPallet);
      }

      if (name === 'sectionId') {
        const selectedSectionId = String(value || '');
        if (selectedSectionId) {
          const occupied = new Set();
          products.forEach((item) => {
            if (editingItem && item.id === editingItem.id) return;
            if (
              String(item.sectionId || '') === selectedSectionId
              && item.shelfSide
              && Number.isFinite(Number(item.shelfNo))
              && Number.isFinite(Number(item.shelfLevel))
            ) {
              occupied.add(`${item.shelfSide}-${Number(item.shelfNo)}-${Number(item.shelfLevel)}`);
            }
          });

          const sectionChanged = String(current.sectionId || '') !== selectedSectionId;
          const hasCompleteShelf = Boolean(current.shelfSide && current.shelfNo && current.shelfLevel);
          if (sectionChanged || !hasCompleteShelf) {
            const sideOrder = ['R', 'L'];
            let autoShelf = null;
            for (const side of sideOrder) {
              for (let shelfNo = 1; shelfNo <= 10; shelfNo += 1) {
                for (let shelfLevel = 1; shelfLevel <= 5; shelfLevel += 1) {
                  const key = `${side}-${shelfNo}-${shelfLevel}`;
                  if (!occupied.has(key)) {
                    autoShelf = { side, shelfNo, shelfLevel };
                    break;
                  }
                }
                if (autoShelf) break;
              }
              if (autoShelf) break;
            }

            if (autoShelf) {
              next.shelfSide = autoShelf.side;
              next.shelfNo = String(autoShelf.shelfNo);
              next.shelfLevel = String(autoShelf.shelfLevel);
            }
          }
        }
      }

      return next;
    });
  };

  const handleActiveToggle = () => {
    setForm((current) => ({ ...current, isActive: !current.isActive }));
  };

  const handleGenerateBarcode = () => {
    const nextBarcode = generateUniqueBarcode();
    setForm((current) => ({ ...current, barcode: nextBarcode }));
  };

  const applyRecommendedPlacement = () => {
    if (!form.categoryId) return;

    const nextSectionId = String(form.sectionId || recommendedSection?.id || '');
    if (!nextSectionId && !suggestedEmptyShelf) return;

    setForm((current) => ({
      ...current,
      sectionId: nextSectionId || current.sectionId,
      shelfSide: suggestedEmptyShelf?.side || current.shelfSide,
      shelfNo: suggestedEmptyShelf?.shelfNo ? String(suggestedEmptyShelf.shelfNo) : current.shelfNo,
      shelfLevel: suggestedEmptyShelf?.shelfLevel ? String(suggestedEmptyShelf.shelfLevel) : current.shelfLevel,
    }));
  };

  const saveProduct = async () => {
    if (
      !form.name.trim() ||
      !form.sku.trim() ||
      !form.barcode.trim() ||
      !form.brand.trim() ||
      !form.unit.trim() ||
      !form.categoryId ||
      !String(form.etiket || '').trim() ||
      !String(form.requiredStorageType || '').trim()
    ) {
      setToast({ type: 'error', title: 'Ürünler', message: 'SKU, Barkod, Ürün Adı, Marka, Kategori, Etiket, Birim ve Saklama Tipi zorunludur.' });
      return false;
    }

    const duplicateSku = products.find((item) => item.id !== editingItem?.id && String(item.sku || '').trim().toUpperCase() === form.sku.trim().toUpperCase());
    if (duplicateSku) {
      setToast({ type: 'error', title: 'Ürünler', message: 'SKU benzersiz olmalıdır.' });
      return false;
    }

    const duplicateBarcode = products.find((item) => item.id !== editingItem?.id && String(item.barcode || '').trim() === form.barcode.trim());
    if (duplicateBarcode) {
      setToast({ type: 'error', title: 'Ürünler', message: 'Barkod benzersiz olmalıdır.' });
      return false;
    }

    const nameLower = form.name.trim().toLowerCase();
    const unitLower = form.unit.trim().toLowerCase();
    if (/(cips|kraker|bisküvi|kuruyemiş|çikolata)/.test(nameLower) && /(şişe|bidon|kova)/.test(unitLower)) {
      setToast({ type: 'error', title: 'Geçersiz Birim', message: 'Atıştırmalık ürünler için Şişe, Bidon veya Kova birimi seçilemez. Lütfen Paket veya Kutu seçin.' });
      return false;
    }
    if (/(su |gazoz|kola|meyve suyu|şampuan|sıvı sabun|yağ)/.test(nameLower) && /(paket|adet)/.test(unitLower) && !/(paket)/.test(nameLower)) {
      setToast({ type: 'error', title: 'Geçersiz Birim', message: 'Sıvı ürünler için Paket veya Adet (tekil) birimi seçilemez. Lütfen Şişe, Bidon veya Kutu seçin.' });
      return false;
    }

    const selectedLabelOption = selectedCategoryTagOptions.find((item) => item.value === String(form.etiket || ''));
    const isPublishingDraft = editingItem && isDraftProduct(editingItem) && form.isActive === true;
    if (isPublishingDraft) {
      const missingForPublish = getDraftPublishMissingFields(form);
      if (missingForPublish.length) {
        setToast({
          type: 'error',
          title: 'Taslak ürün',
          message: `Satışa açmadan önce tamamlayın: ${missingForPublish.join(', ')}.`,
        });
        return false;
      }
    }

    const payload = {
      sku: form.sku.trim(),
      barcode: form.barcode.trim(),
      name: form.name.trim(),
      brand: form.brand.trim(),
      categoryId: form.categoryId,
      primarySupplierId: form.primarySupplierId || undefined,
      supplierId: form.primarySupplierId || undefined,
      requiredStorageType: normalizeStorageTypeValue(form.requiredStorageType),
      unit: form.unit.trim(),
      purchasePrice: parseMoneyInput(form.purchasePrice, 0),
      salePrice: parseMoneyInput(form.salePrice, 0),
      etiket: selectedLabelOption?.labelName || '',
      tagId: String(form.etiket || '').trim(),
      selectedTagId: String(form.etiket || '').trim(),
      criticalStock: form.criticalStock === '' ? undefined : Number(form.criticalStock),
      averageDesi: form.averageDesi === '' ? undefined : Number(form.averageDesi),
      sectionId: form.sectionId || undefined,
      shelfSide: form.shelfSide || undefined,
      shelfNo: form.shelfNo === '' ? undefined : Number(form.shelfNo),
      shelfLevel: form.shelfLevel === '' ? undefined : Number(form.shelfLevel),
      depotLocationCode: selectedDepotLocationCode || undefined,
      physicalLocationCode: selectedDepotLocationCode || undefined,
      defaultWarehouseLocationCode: selectedDepotLocationCode || undefined,
      unitsPerCase: Number(form.unitsPerCase || 24),
      casesPerPallet: Number(form.casesPerPallet || 60),
      unitsPerPallet: Number(form.unitsPerPallet || (Number(form.unitsPerCase || 24) * Number(form.casesPerPallet || 60))),
      isActive: form.isActive,
    };

    if (isPublishingDraft) {
      payload.isListed = true;
      payload.catalogVisibility = 'published';
      payload.orderActivatedStatus = 'active';
    } else if (editingItem && isDraftProduct(editingItem)) {
      payload.isListed = false;
      payload.catalogVisibility = 'staged';
      payload.orderActivatedStatus = 'pending';
      payload.isActive = false;
    }

    if (isFreshProduceSelection) {
      payload.unit = 'Kg';
    }

    try {
      setSubmitting(true);
      if (editingItem) {
        await productService.update(editingItem.id, payload);
        setToast({ type: 'success', title: 'Ürünler', message: 'Ürün bilgisi güncellendi.' });
      } else {
        await productService.create(payload);
        setToast({ type: 'success', title: 'Ürünler', message: 'Yeni ürün başarıyla eklendi.' });
      }
      closeModal();
      await loadProducts();
      return true;
    } catch (error) {
      setToast({ type: 'error', title: 'Ürünler', message: error.message || 'İşlem başarısız.' });
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await saveProduct();
  };

  const rejectDraftProduct = async (item) => {
    if (!item?.id || !isDraftProduct(item)) return;
    if (!isCatalogDraftProduct(item)) {
      setToast({ type: 'error', title: 'Taslak ürün', message: 'Bu kayıt katalog taslağı olarak doğrulanamadığı için reddedilemedi.' });
      return;
    }
    try {
      setSubmitting(true);
      setRejectingDraftId(item.id);
      await productService.update(item.id, {
        rejectDraft: true,
        rejectedReason: 'Ürünler sayfası Taslak / Eksik Ürünler filtresinden reddedildi.',
      });
      setToast({ type: 'success', title: 'Taslak ürün', message: 'Taslak ürün reddedildi. Ürün satışa açılmadı ve aktif ürün listesine eklenmedi.' });
      await loadProducts();
    } catch (error) {
      const message = error?.payload?.message || error?.message || 'Bu kayıt katalog taslağı olarak doğrulanamadığı için reddedilemedi.';
      setToast({ type: 'error', title: 'Taslak ürün', message });
    } finally {
      setRejectingDraftId('');
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    try {
      await productService.remove(deleteTarget.id);
      setToast({ type: 'success', title: 'Ürünler', message: 'Ürün kaydı silindi.' });
      setDeleteTarget(null);
      await loadProducts();
    } catch (error) {
      setToast({ type: 'error', title: 'Ürünler', message: error.message || 'Ürün silinemedi.' });
      setDeleteTarget(null);
    }
  };

  const renderStockRatioBadge = (currentValue, capacityValue) => {
    const current = Math.max(0, Number(currentValue || 0));
    const capacity = Math.max(0, Number(capacityValue || 0));
    const isOverCapacity = capacity > 0 ? current > capacity : current > 0;

    return (
      <StatusBadge tone={isOverCapacity ? 'danger' : 'success'}>
        <span className="products-stock-ratio">{formatNumber(current)} / {formatNumber(capacity)}</span>
      </StatusBadge>
    );
  };

  const renderDepotStockCell = (row) => {
    const current = Math.max(0, Number(row.depoStock || 0));
    const capacity = Math.max(0, Number(row.depoCapacity || 0));
    const assignment = normalizeDepotAssignmentType(row.depotAssignmentType);
    const mode = deriveCapacityMode({ assignment, mode: row.capacityMode, capacity });
    const isVirtual = row.isVirtualLocation === true || assignment === 'shared_overflow' || mode === 'unbounded_virtual';
    const hasPhysicalBoundedCapacity = mode === 'bounded' && capacity > 0;

    if (mode === 'not_applicable' || assignment === 'direct_supply') {
      return <StatusBadge tone="info">Doğrudan Tedarik</StatusBadge>;
    }

    if (mode === 'no_capacity' || assignment === 'no_backroom_stock') {
      return <StatusBadge tone="neutral">Arka Depo Yok</StatusBadge>;
    }

    if (hasPhysicalBoundedCapacity) {
      const isOverCapacity = current > capacity;
      return (
        <StatusBadge tone={isOverCapacity ? 'danger' : 'success'}>
          <span className="products-stock-ratio">{formatNumber(current)} / {formatNumber(capacity)}</span>
        </StatusBadge>
      );
    }

    if (mode === 'needs_review' || row.needsReview === true) {
      return <StatusBadge tone="warning">İnceleme Gerekli</StatusBadge>;
    }

    if (isVirtual) {
      return (
        <span className="products-depot-stock-cell" title={String(row.depotLocationCode || '-') + ' sanal/ortak depo alanı'}>
          <StatusBadge tone="info">{formatNumber(current)}</StatusBadge>
        </span>
      );
    }

    if (capacity > 0 && mode === 'bounded') {
      const isOverCapacity = current > capacity;
      return (
        <StatusBadge tone={isOverCapacity ? 'danger' : 'success'}>
          <span className="products-stock-ratio">{formatNumber(current)} / {formatNumber(capacity)}</span>
        </StatusBadge>
      );
    }

    return <StatusBadge tone="warning">İnceleme Gerekli</StatusBadge>;
  };

  const renderBatchPreviewCell = (row, index) => {
    const batchNo = String(row?.[`batchNo${index}`] || '').trim();
    const quantity = Number(row?.[`batchQty${index}`] || 0);
    if (!batchNo || batchNo === '-') {
      return <span className="products-batch-cell is-empty">-</span>;
    }

    return (
      <span className="products-batch-cell" title={quantity > 0 ? `${batchNo} • ${formatNumber(quantity)} adet` : batchNo}>
        <span className="products-batch-no">{batchNo}</span>
        {quantity > 0 ? <span className="products-batch-qty">{formatNumber(quantity)} adet</span> : null}
      </span>
    );
  };

  const toDisplayPrice = (value) => {
    const price = Number(value);
    return Number.isFinite(price) && price > 0 ? price : null;
  };

  const getDisplayCampaign = (row) => {
    if (!row?.hasActiveDiscount && !row?.activeCampaign) return null;
    return row?.activeCampaign || row?.pricing?.activeCampaign || row?.productListView?.activeCampaign || null;
  };

  const getProductCampaignPrice = (row) => {
    const salePrice = toDisplayPrice(row?.salePrice ?? row?.originalPrice ?? row?.price);
    const isCampaignPrice = (price) => price !== null && (salePrice === null || price < salePrice);
    const directPrice = toDisplayPrice(row?.campaignPrice);
    if (isCampaignPrice(directPrice)) return directPrice;

    const activeCampaignPrice = toDisplayPrice(row?.activeCampaign?.price ?? row?.activeCampaign?.campaignPrice);
    if (isCampaignPrice(activeCampaignPrice)) return activeCampaignPrice;

    const effectivePrice = toDisplayPrice(row?.effectivePrice);
    if (isCampaignPrice(effectivePrice)) return effectivePrice;

    const pricingCampaignPrice = toDisplayPrice(row?.pricing?.campaignPrice);
    if (isCampaignPrice(pricingCampaignPrice)) return pricingCampaignPrice;

    const pricingEffectivePrice = toDisplayPrice(row?.pricing?.effectivePrice);
    if (isCampaignPrice(pricingEffectivePrice) && getDisplayCampaign(row)) return pricingEffectivePrice;

    const discountedPrice = toDisplayPrice(row?.discountedPrice);
    if (isCampaignPrice(discountedPrice) && (row?.hasActiveDiscount || salePrice !== null)) return discountedPrice;

    return null;
  };

  const getProductCampaignLabel = (row) => getDisplayCampaign(row)?.name || '';

  const columns = [
    { key: 'sku', label: 'SKU', className: 'products-cell-nowrap products-sticky-col products-sticky-col-1' },
    { key: 'barcode', label: 'Barkod', className: 'products-cell-nowrap products-sticky-col products-sticky-col-2' },
    {
      key: 'name',
      label: 'Ürün',
      className: 'products-cell-product products-sticky-col products-sticky-col-3',
      render: (row) => (
        <span className="product-name-with-status" aria-label={`${formatUnit(row.name)} ${row.isActive ? '(Aktif)' : '(Pasif)'}`}>
          <span className={`product-status-dot ${row.isActive ? 'active' : 'passive'}`} title={row.isActive ? 'Aktif ürün' : 'Pasif ürün'} aria-hidden="true" />
          <span className="product-name-cell">
            {isCatalogUnlistedProduct(row) ? <span className="product-new-badge">Yeni</span> : null}
            {row.isDraftProduct ? <span className="product-new-badge">Taslak</span> : null}
            {formatUnit(row.name)}
          </span>
        </span>
      ),
    },
    { key: 'brandName', label: 'Marka', className: 'products-cell-nowrap' },
    { key: 'mainCategoryName', label: 'Kategori', className: 'products-cell-nowrap', sortable: false },
    { key: 'shelfCodeResolved', label: 'Raf Kodu', className: 'products-cell-nowrap', render: (row) => row.shelfCodeResolved || UNDEFINED_FIELD_TEXT, sortable: false },
    { key: 'depotLocationCode', label: 'Depo Kodu', className: 'products-cell-nowrap', render: renderDepotLocation, sortable: false },
    { key: 'unit', label: 'Birim', className: 'products-cell-nowrap', sortable: false },
    { key: 'purchasePrice', label: 'Alış Fiyatı', render: (row) => formatCurrency(row.purchasePrice), sortValue: (row) => Number(row.purchasePrice || 0) },
    { key: 'salePrice', label: 'Satış Fiyatı', render: (row) => formatCurrency(row.salePrice), sortValue: (row) => Number(row.salePrice || 0) },
    {
      key: 'draftMissingFields',
      label: 'Eksik Alanlar',
      className: 'products-cell-supplier',
      render: (row) => renderMissingFields(row.draftMissingFields),
      sortable: false,
    },
    {
      key: 'draftStatus',
      label: 'Durum',
      className: 'products-cell-nowrap',
      render: (row) => row.isDraftProduct ? (
        <div className="table-actions">
          <StatusBadge tone="warning">Taslak</StatusBadge>
          <StatusBadge tone="danger">Satışta Değil</StatusBadge>
          {row.draftMissingFields?.length ? <StatusBadge tone="info">Eksik Bilgi</StatusBadge> : null}
          {row.sourceReadModel === 'catalog_import' || row.draftSource === 'catalog_import' ? <StatusBadge tone="neutral">Katalogdan Geldi</StatusBadge> : null}
        </div>
      ) : (
        <StatusBadge tone={row.isActive ? 'success' : 'neutral'}>{row.isActive ? 'Satışta' : 'Pasif'}</StatusBadge>
      ),
      sortable: false,
    },
    {
      key: 'discountedPrice',
      label: 'Kampanya Fiyatı',
      render: (row) => {
        const campaign = getDisplayCampaign(row);
        const campaignPrice = campaign ? getProductCampaignPrice(row) : null;
        const campaignLabel = getProductCampaignLabel(row);
        return campaignPrice !== null ? (
          <div>
            <strong>{formatCurrency(campaignPrice)}</strong>
            {campaignLabel ? <div style={{ fontSize: '0.72rem', color: '#0f766e' }}>{campaignLabel}</div> : null}
            {Number(row?.campaignConflictCount || 0) > 0 ? (
              <div
                title={`Bu ürün ${Number(row.campaignConflictCount || 0) + 1} aktif kampanyada, en düşük/uygun fiyat uygulanıyor.`}
                style={{ fontSize: '0.7rem', color: '#b45309', fontWeight: 600 }}
              >
                Çakışma: {Number(row.campaignConflictCount || 0) + 1} kampanya
              </div>
            ) : null}
          </div>
        ) : '—';
      },
      sortValue: (row) => {
        const price = getDisplayCampaign(row) ? getProductCampaignPrice(row) : null;
        return Number.isFinite(price) ? price : null;
      },
    },
    { key: 'lastPriceChangeDate', label: 'FDT', className: 'products-cell-nowrap', render: (row) => formatDate(row.lastPriceChangeDate || row.lastPriceChangeAt), sortValue: (row) => row.lastPriceChangeAt || row.lastPriceChangeDate ? new Date(row.lastPriceChangeAt || row.lastPriceChangeDate).getTime() : 0 },
    {
      key: 'reyonStock',
      label: 'Reyon Stok',
      render: (row) => renderStockRatioBadge(row.reyonStock, row.reyonCapacity),
      sortValue: (row) => Number(row.reyonStock || 0),
      sortable: false,
    },
    {
      key: 'depoStock',
      label: 'Depo Stok',
      render: (row) => renderDepotStockCell(row),
      sortValue: (row) => Number(row.depoStock || 0),
      sortable: false,
    },
    { key: 'totalStockResolved', label: 'Toplam Stok', render: (row) => formatNumber(row.totalStockResolved || 0), sortValue: (row) => Number(row.totalStockResolved || 0), sortable: false },
    { key: 'batchCount', label: 'Parti Sayısı', className: 'products-cell-nowrap', render: (row) => formatNumber(row.batchCount || 0), sortable: false },
    { key: 'batchNo1', label: 'Parti No 1', className: 'products-cell-nowrap products-batch-preview-col', render: (row) => renderBatchPreviewCell(row, 1), sortable: false },
    { key: 'batchNo2', label: 'Parti No 2', className: 'products-cell-nowrap products-batch-preview-col', render: (row) => renderBatchPreviewCell(row, 2), sortable: false },
    { key: 'batchNo3', label: 'Parti No 3', className: 'products-cell-nowrap products-batch-preview-col', render: (row) => renderBatchPreviewCell(row, 3), sortable: false },
    {
      key: 'stockStatus',
      label: 'Stok Uyarısı',
      render: (row) => {
        const tone = row.stockWarning === 'Kritik'
          ? 'danger'
          : row.stockWarning === 'Düşük'
            ? 'warning'
            : row.stockWarning === 'Yüksek'
              ? 'info'
              : 'neutral';
        return <StatusBadge tone={tone}>{row.stockWarning || 'Normal'}</StatusBadge>;
      },
      sortable: false,
    },
    { key: 'updatedAt', label: 'Güncelleme', render: (row) => formatDate(row.updatedAt), sortValue: (row) => new Date(row.updatedAt).getTime() },
    { key: 'storageTypeLabel', label: 'Saklama Tipi', className: 'products-cell-nowrap', sortable: false },
    { key: 'averageDesi', label: 'Ortalama Desi', render: (row) => renderOptionalNumber(row.averageDesi, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), sortValue: (row) => Number(row.averageDesi ?? -1), sortable: false },
    {
      key: 'unitsPerCase',
      label: 'Koli/Kasa İçeriği',
      render: (row) => hasDisplayNumber(row.unitsPerCase)
        ? (row.isFreshProduce ? `${formatNumber(row.unitsPerCase)} kg/kasa` : formatNumber(row.unitsPerCase))
        : UNDEFINED_FIELD_TEXT,
      sortValue: (row) => Number(row.unitsPerCase ?? -1),
      sortable: false,
    },
    {
      key: 'casesPerPallet',
      label: 'Palet Dizilimi',
      render: (row) => hasDisplayNumber(row.casesPerPallet)
        ? (row.isFreshProduce ? `${formatNumber(row.casesPerPallet)} kasa/palet` : `${formatNumber(row.casesPerPallet)} koli/palet`)
        : UNDEFINED_FIELD_TEXT,
      sortValue: (row) => Number(row.casesPerPallet ?? -1),
      sortable: false,
    },
    { key: 'primarySupplierName', label: 'Ana Tedarikçi', className: 'products-cell-supplier', render: (row) => <span className="product-supplier-cell">{row.primarySupplierName || '-'}</span>, sortable: false },
    {
      key: 'lastCountedAt',
      label: 'Son Sayım Tarihi',
      className: 'products-cell-nowrap',
      render: (row) => formatDate(row.lastCountedAt),
      sortValue: (row) => row.lastCountedAt ? (Date.parse(row.lastCountedAt) || 0) : 0,
    },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      render: (row) =>
        isAdmin ? (
          <div className="table-actions">
            <button className="text-button" type="button" onClick={() => void openViewModal(row)}>
              Görüntüle
            </button>
            <button className="text-button" type="button" onClick={() => openEditModal(row)}>
              {row.isDraftProduct ? 'Eksikleri Tamamla' : 'Düzenle'}
            </button>
            {row.isDraftProduct ? (
              <button className="text-button danger" type="button" disabled={!isCatalogDraftProduct(row) || submitting} onClick={() => void rejectDraftProduct(row)}>
                {rejectingDraftId === row.id ? 'Reddediliyor...' : 'Taslağı Reddet'}
              </button>
            ) : (
              <button className="text-button danger" type="button" onClick={() => setDeleteTarget(row)}>
                Sil
              </button>
            )}
          </div>
        ) : (
          <span className="muted-text">Salt okunur</span>
        ),
    },
  ];

  return (
    <div className="page-stack products-page">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageHeader
        className="dashboard-hero"
        icon={<PackageSearch size={22} />}
        title="Ürünler"
        description="Mağazada satışa açık ürünleri görüntüleyin, filtreleyin ve yönetin."
        actions={
          isAdmin ? (
            <button className="primary-button" type="button" onClick={openCreateModal}>
              <Plus size={16} /> Yeni Ürün
            </button>
          ) : null
        }
      />

      <div className="mod-card products-filter-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-violet"><Filter size={18} /></div>
          <div><h3>Filtreler</h3><p>Ürün listesini kategori, tedarikçi, durum ve reyon bilgisine göre daraltın.</p></div>
        </div>
        <FilterBar
          className="products-filter-bar-minimal"
          actions={(
            <>
              <button className="primary-button" type="button" onClick={() => setProductPage(1)}>Filtrele</button>
              <button className="ghost-button" type="button" onClick={() => { setFilters(initialFilters); setProductPage(1); }}>Temizle</button>
            </>
          )}
        >
          <label className="field-group">
            <span>Arama</span>
            <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="SKU, barkod, ürün, ana/alt kategori veya tedarikçi ara" />
          </label>
          <label className="field-group">
            <span>Ana Kategori</span>
            <select value={filters.categoryId} onChange={(event) => setFilters((current) => ({ ...current, categoryId: event.target.value }))}>
              <option value="">Tüm Ana Kategoriler</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="field-group">
            <span>Tedarikçi</span>
            <input
              value={filters.supplierSearch}
              onChange={(event) => setFilters((current) => ({ ...current, supplierSearch: event.target.value }))}
              autoComplete="off"
              placeholder="Tedarikçi adı ile ara"
            />
          </label>
          <label className="field-group products-filter-half">
            <span>Ürün Durumu</span>
            <select value={filters.productState} onChange={(event) => setFilters((current) => ({ ...current, productState: event.target.value }))}>
              <option value="listed">Satıştaki Ürünler</option>
              <option value="drafts">Taslak / Eksik Ürünler</option>
              <option value="all">Tüm Ürünler</option>
              <option value="inactive">Pasif Ürünler</option>
            </select>
          </label>
          <label className="field-group products-filter-half">
            <span>Etiket</span>
            <select value={filters.etiket} onChange={(event) => setFilters((current) => ({ ...current, etiket: event.target.value }))}>
              <option value="">Tüm Etiketler</option>
              {filterLabelOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="field-group products-filter-half">
            <span>Kampanya</span>
            <select value={filters.campaignOnly ? 'campaign' : ''} onChange={(event) => setFilters((current) => ({ ...current, campaignOnly: event.target.value === 'campaign' }))}>
              <option value="">Tüm Ürünler</option>
              <option value="campaign">Kampanyalı</option>
            </select>
          </label>
          <label className="field-group products-filter-half">
            <span>Reyon No</span>
            <input
              value={filters.reyonNo}
              onChange={(event) => setFilters((current) => ({ ...current, reyonNo: event.target.value }))}
              placeholder="Reyon no ile sorgulama yap"
            />
          </label>
        </FilterBar>
      </div>

      <div className="mod-card products-list-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-blue"><Package size={18} /></div>
          <div>
            <h3>Satıştaki Ürünler</h3>
            <p>{formatNumber(productPagination.total || 0)} ürün · {productPagination.total ? `${((productPagination.page || 1) - 1) * (productPagination.limit || PRODUCT_PAGE_SIZE) + 1}-${Math.min((productPagination.page || 1) * (productPagination.limit || PRODUCT_PAGE_SIZE), productPagination.total || 0)}` : '0-0'} arası gösteriliyor</p>
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={displayRows}
          isLoading={isLoading || isReferenceLoading}
          emptyMessage="Filtreye uygun ürün bulunmuyor."
          pageSize={PRODUCT_PAGE_SIZE}
          serverPagination={{
            page: productPagination.page || productPage,
            limit: productPagination.limit || PRODUCT_PAGE_SIZE,
            total: productPagination.total || 0,
            totalPages: productPagination.totalPages || 1,
          }}
          onPageChange={setProductPage}
          sortConfig={tableSort}
          onSortChange={setTableSort}
          manualSorting
          onRowClick={(row) => void openViewModal(row)}
        />
      </div>

      <FormModal
        isOpen={isViewModalOpen}
        title="Ürün Görüntüle"
        description="Ürün bilgilerini detaylı olarak görüntüleyin."
        headerIcon={<PackageSearch size={17} />}
        modalClassName="product-form-fit-modal product-view-modal"
        onClose={() => {
          setIsViewModalOpen(false);
          setViewItem(null);
        }}
        confirmOnDirtyClose={false}
      >
        <div className="modal-form modal-structured-form product-view-content">
          <div className="modal-form-body-scroll product-view-scroll">
            <div className="product-view-kpi-grid">
              <div>
                <span>Toplam Stok</span>
                <strong>{formatNumber(Number(viewItem?.totalStockResolved ?? viewItem?.totalStock ?? ((Number(viewItem?.warehouseStock || 0)) + (Number(viewItem?.shelfStock || 0)))))}</strong>
              </div>
              <div>
                <span>Reyon Stok</span>
                <strong>{formatNumber(Number(viewItem?.reyonStock ?? viewItem?.shelfStock ?? 0))}</strong>
              </div>
              <div>
                <span>Depo Stok</span>
                <strong>{formatNumber(Number(viewItem?.depoStock ?? viewItem?.warehouseStock ?? 0))}</strong>
              </div>
            </div>

            <div className="product-view-section">
              <h4>Kimlik ve Sınıflama</h4>
              <div className="product-view-grid">
                <div><span>Ürün Adı</span><strong>{viewItem?.name || '-'}</strong></div>
                <div><span>Marka</span><strong>{viewItem?.brand || '-'}</strong></div>
                <div><span>SKU</span><strong>{viewItem?.sku || '-'}</strong></div>
                <div><span>Barkod</span><strong>{viewItem?.barcode || '-'}</strong></div>
                <div><span>Birim</span><strong>{viewItem?.unit || '-'}</strong></div>
                <div><span>Saklama Tipi</span><strong>{formatStorageTypeLabel(viewItem?.requiredStorageType || viewItem?.storageType)}</strong></div>
              </div>
            </div>

            <div className="product-view-section">
              <h4>Fiyat ve Yerleşim</h4>
              <div className="product-view-grid">
                <div><span>Alış Fiyatı</span><strong>{formatCurrency(viewItem?.purchasePrice || 0)}</strong></div>
                <div><span>Satış Fiyatı</span><strong>{formatCurrency(viewItem?.salePrice || 0)}</strong></div>
                <div><span>Kampanya Fiyatı</span><strong>{getDisplayCampaign(viewItem) && getProductCampaignPrice(viewItem) !== null ? formatCurrency(getProductCampaignPrice(viewItem)) : '—'}</strong></div>
                <div><span>Aktif Kampanya</span><strong>{getProductCampaignLabel(viewItem) || '—'}</strong></div>
                <div><span>FDT</span><strong>{formatDate(viewItem?.lastPriceChangeDate || viewItem?.lastPriceChangeAt)}</strong></div>
                <div><span>Raf Kodu</span><strong>{viewItem?.shelfCodeResolved || UNDEFINED_FIELD_TEXT}</strong></div>
                <div><span>Depo Kodu</span><strong>{viewItem ? renderDepotLocation(viewItem) : '-'}</strong></div>
                <div><span>Kritik Stok Eşiği</span><strong>{formatNumber(Number(viewItem?.criticalStock || 0))}</strong></div>
                <div><span>Durum</span><strong>{viewItem?.isActive ? 'Aktif' : 'Pasif'}</strong></div>
              </div>
            </div>
            <div className="product-view-section">
              <h4>Parti Bilgisi</h4>
              <div className="product-view-grid">
                {(Array.isArray(viewItem?.productBatches) ? viewItem.productBatches : Array.isArray(viewItem?.batches) ? viewItem.batches : [])
                  .filter((batch) => Number(batch?.totalQuantity || 0) > 0)
                  .slice(0, 6)
                  .map((batch) => (
                    <div key={`${batch.batchNo}-${batch.skt || ''}`}>
                      <span>{batch.skt ? `SKT ${formatDate(batch.skt, false)}` : 'Parti'}</span>
                      <strong>{batch.batchNo} · {formatNumber(Number(batch.totalQuantity || 0))} adet</strong>
                    </div>
                  ))}
                {!(Array.isArray(viewItem?.productBatches) ? viewItem.productBatches : Array.isArray(viewItem?.batches) ? viewItem.batches : [])
                  .some((batch) => Number(batch?.totalQuantity || 0) > 0) && (
                    <div><span>Parti No</span><strong>-</strong></div>
                  )}
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={() => { setIsViewModalOpen(false); setViewItem(null); }}>
              Kapat
            </button>
            {isAdmin ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  if (!viewItem) return;
                  setIsViewModalOpen(false);
                  void openEditModal(viewItem);
                }}
              >
                Düzenle
              </button>
            ) : null}
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={isModalOpen}
        title={editingItem && isDraftProduct(editingItem) ? 'Taslak Ürünü Tamamla' : editingItem ? 'Ürün Düzenle' : 'Yeni Ürün Ekle'}
        description={editingItem && isDraftProduct(editingItem) ? 'Eksik alanları tamamlayıp ürünü satışa açabilirsiniz. Stok otomatik oluşturulmaz.' : editingItem ? 'Seçili ürün bilgilerini bu alandan güncelleyebilirsiniz.' : 'Bu kısımdan yeni ürün ekleyebilirsiniz.'}
        headerIcon={editingItem ? <PackageSearch size={17} /> : <Plus size={17} />}
        onClose={requestCloseModal}
        confirmOnDirtyClose={false}
        modalClassName="product-form-fit-modal app-modal-standard"
      >
        <form className="modal-form modal-structured-form" onSubmit={handleSubmit}>
          <div className="modal-form-body-scroll">
            {editingItem && isDraftProduct(editingItem) ? (
              <div className="catalog-import-alert">
                Taslak ürün satışta değildir. Satışa açmak için ürün adı, barkod/SKU, kategori, etiket, marka, birim, alış/satış fiyatı, reyon ve tedarikçi bağlantısı tamamlanmalıdır.
              </div>
            ) : null}
            <FormSection title="Temel Bilgiler" description="Ürünün kimlik ve takip bilgilerini girin.">
              <FormGrid className="product-grid-basic">
                <label className="field-group col-6">
                  <span>Ürün Adı<span className="modal-required">*</span></span>
                  <input autoFocus required name="name" value={form.name} onChange={handleFormChange} placeholder="Örn. Organik Süt 1L" />
                </label>
                <label className="field-group col-6">
                  <span>Marka<span className="modal-required">*</span></span>
                  <input required name="brand" value={form.brand} onChange={handleFormChange} placeholder="Örn. Pınar" />
                </label>
                <label className="field-group col-4 sku-field-auto">
                  <span className="sku-label-row">
                    <span>SKU<span className="modal-required">*</span></span>
                    <small className="product-sku-auto-note">SKU sistem tarafından otomatik oluşturulur.</small>
                  </span>
                  <input required name="sku" value={form.sku} onChange={handleFormChange} placeholder="SHF-PRD-0001" readOnly />
                </label>
                <label className="field-group col-4">
                  <span>Barkod<span className="modal-required">*</span></span>
                  <div className="product-barcode-inline">
                    <input
                      required
                      name="barcode"
                      value={form.barcode}
                      onChange={handleFormChange}
                      placeholder="8690000000001"
                    />
                    <button
                      className="product-barcode-generate-btn"
                      type="button"
                      onClick={handleGenerateBarcode}
                      aria-label="Rastgele barkod üret"
                      title="Rastgele barkod üret"
                    >
                      <RefreshCw size={15} />
                    </button>
                  </div>
                </label>
                <label className="field-group col-4">
                  <span>Birim<span className="modal-required">*</span></span>
                  <select required name="unit" value={form.unit} onChange={handleFormChange} className="unit-select-modern">
                    {UNIT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </FormGrid>
            </FormSection>

            <FormSection
              className="product-category-supplier-section"
              title="Kategori ve Sınıflama"
              description="Ürün ana verisini kategori ve etiket alanlarıyla sınıflandırın."
            >
              <FormGrid className="product-grid-supplier">
                <label className="field-group col-4">
                  <span>Kategori<span className="modal-required">*</span></span>
                  <select required name="categoryId" value={form.categoryId} onChange={handleFormChange}>
                    <option value="">Kategori seçin</option>
                    {categories.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field-group col-4">
                  <span>Saklama Tipi<span className="modal-required">*</span></span>
                  <select required name="requiredStorageType" value={form.requiredStorageType} onChange={handleFormChange}>
                    {STORAGE_TYPE_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field-group col-4">
                  <span>Tedarikçi{editingItem && isDraftProduct(editingItem) ? <span className="modal-required">*</span> : null}</span>
                  <select name="primarySupplierId" value={form.primarySupplierId} onChange={handleFormChange}>
                    <option value="">Tedarikçi seçin</option>
                    {suppliers.filter((item) => item.isActive !== false).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
              </FormGrid>
            </FormSection>

            <FormSection className="product-location-plan-section" title="Yerleşim ve Planlama" description="Ürünün varsayılan raf/depo ve lojistik planlama alanları.">
              <FormGrid className="product-grid-price">
                <label className="field-group col-4">
                  <span>Varsayılan Reyon</span>
                  <select name="sectionId" value={form.sectionId} onChange={handleFormChange}>
                    <option value="">Reyon seçin</option>
                    {sections.filter((item) => item.isActive).map((item) => (
                      <option key={item.id} value={item.id}>{item.number} - {item.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field-group col-4">
                  <span className="stock-code-label-row">
                    <span>Raf Kodu (Taraf/Raf/Kat)</span>
                    <button
                      className="ghost-button stock-apply-icon-btn"
                      type="button"
                      onClick={applyRecommendedPlacement}
                      disabled={!form.categoryId || (!recommendedSection && !suggestedEmptyShelf)}
                      title="Önerilen yerleşimi uygula"
                      aria-label="Önerilen yerleşimi uygula"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </span>
                  <div className="modal-inline-row">
                    <select name="shelfSide" value={form.shelfSide} onChange={handleFormChange}>
                      <option value="">Taraf</option>
                      <option value="L">L</option>
                      <option value="R">R</option>
                    </select>
                    <input name="shelfNo" type="number" min="1" value={form.shelfNo} onChange={handleFormChange} placeholder="Raf" />
                    <input name="shelfLevel" type="number" min="1" value={form.shelfLevel} onChange={handleFormChange} placeholder="Kat" />
                  </div>
                </label>
                <div className="field-group stock-compact-field col-4">
                  <span>Oluşan Raf Kodu</span>
                  <input value={currentShelfCodePreview} readOnly />
                </div>
                <label className="field-group col-4 products-depot-location-field">
                  <span>Depo Lokasyonu</span>
                  <select name="depotLocationCode" value={form.depotLocationCode} onChange={handleFormChange}>
                    <option value="">Otomatik öneri ({defaultWarehouseLocationPreview})</option>
                    <option value="__shared">Ortak Depo</option>
                    <option value="OVR-AMBIENT">Ortam Ortak Alan</option>
                    <option value="OVR-COLD">Soğuk Ortak Alan</option>
                    <option value="OVR-FROZEN">Donuk Ortak Alan</option>
                    {warehouseLocations.map((item) => {
                      const code = String(item.locationCode || item.depotLocationCode || item.id || '').trim();
                      if (!code || virtualDepotLabels[code]) return null;
                      return <option key={code} value={code}>{code}</option>;
                    })}
                  </select>
                  <div className="products-depot-location-actions">
                    <button className="text-button" type="button" onClick={() => setForm((current) => ({ ...current, depotLocationCode: '__shared' }))}>
                      Ortak Depo
                    </button>
                    <button className="text-button" type="button" onClick={() => setForm((current) => ({ ...current, depotLocationCode: '__manual' }))}>
                      Elle Gir
                    </button>
                  </div>
                </label>
                {form.depotLocationCode === '__manual' ? (
                  <label className="field-group col-4 products-depot-location-manual">
                    <span>Elle Gir</span>
                    <input name="depotLocationManual" value={form.depotLocationManual} onChange={handleFormChange} placeholder="Örn. D1-R-01-01 veya OVR-AMBIENT" />
                  </label>
                ) : (
                  <div className="field-group stock-compact-field col-4">
                    <span>Seçilen Depo Lokasyonu</span>
                    <input value={selectedDepotLocationCode || defaultWarehouseLocationPreview} readOnly />
                  </div>
                )}
                <label className="field-group stock-compact-field col-4">
                  <span>Ortalama Desi</span>
                  <input name="averageDesi" type="number" min="0" step="0.01" value={form.averageDesi} onChange={handleFormChange} placeholder="Örn. 0.45" />
                </label>
              </FormGrid>
            </FormSection>

            <FormSection title="Satış ve Durum" description="Alış/satış fiyatları, kritik stok eşiği ve ürün durumunu yönetin.">
              <FormGrid className="product-grid-price">
                <label className="field-group col-3">
                  <span>Alış Fiyatı</span>
                  <input name="purchasePrice" type="number" min="0" step="0.01" value={form.purchasePrice} onChange={handleFormChange} />
                </label>
                <label className="field-group col-3">
                  <span>Satış Fiyatı</span>
                  <input name="salePrice" type="number" min="0" step="0.01" value={form.salePrice} onChange={handleFormChange} />
                </label>
                <label className="field-group col-3">
                  <span>Kritik Stok</span>
                  <input name="criticalStock" type="number" min="0" value={form.criticalStock} onChange={handleFormChange} />
                </label>
                <div className="field-group product-active-field product-active-field-tight modal-status-field col-3 product-status-cell">
                  <span>Ürün Durumu</span>
                  <label
                    className={`product-status-toggle ${form.isActive ? 'is-active' : 'is-passive'}`}
                    aria-label={`Ürün durumu: ${form.isActive ? 'Aktif' : 'Pasif'}`}
                  >
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={handleActiveToggle}
                    />
                    <span className="product-status-toggle-track" aria-hidden="true">
                      <span className="product-status-toggle-knob" />
                    </span>
                    <span className="product-status-toggle-label passive">Pasif</span>
                    <span className="product-status-toggle-label active">Aktif</span>
                  </label>
                </div>
              </FormGrid>
            </FormSection>

            <FormSection title="Lojistik Bilgi" description="Ürün bazlı koli ve palet bilgisini yönetin.">
              <FormGrid className="product-grid-price">
                <label className="field-group col-4">
                  <span>{logisticsLabels.unitsPerCase}<span className="modal-required">*</span></span>
                  <input required name="unitsPerCase" type="number" min="1" value={form.unitsPerCase} onChange={handleFormChange} />
                </label>
                <label className="field-group col-4">
                  <span>{logisticsLabels.casesPerPallet}<span className="modal-required">*</span></span>
                  <input required name="casesPerPallet" type="number" min="1" value={form.casesPerPallet} onChange={handleFormChange} />
                </label>
                <label className="field-group col-4">
                  <span>{logisticsLabels.unitsPerPallet}</span>
                  <input name="unitsPerPallet" type="number" min="1" value={form.unitsPerPallet} readOnly />
                </label>
              </FormGrid>
            </FormSection>

            <FormSection title="Etiketler" description="Seçilen kategoriye bağlı ürün etiketini belirleyin.">
              <FormGrid className="product-grid-price">
                <label className="field-group col-6">
                  <span>Ürün Etiketi<span className="modal-required">*</span></span>
                  <select required name="etiket" value={form.etiket} onChange={handleFormChange} disabled={!form.categoryId}>
                    <option value="">
                      {form.categoryId ? 'Etiket seçin' : 'Önce kategori seçin'}
                    </option>
                    {selectedCategoryTagOptions.map((tag) => (
                      <option key={tag.value} value={tag.value}>{tag.labelName}</option>
                    ))}
                  </select>
                </label>
              </FormGrid>
            </FormSection>

          </div>
          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={requestCloseModal}>İptal</button>
            <button className="primary-button" type="submit" disabled={submitting}>
              {submitting
                ? 'Kaydediliyor...'
                : editingItem && isDraftProduct(editingItem) && form.isActive
                  ? 'Satışa Aç / Listele'
                  : editingItem
                    ? 'Güncelle'
                    : 'Kaydet'}
            </button>
          </div>
        </form>
      </FormModal>
      <ConfirmModal
        isOpen={closeConfirmOpen}
        title="Değişiklikler Kaydedilmedi"
        description="Kaydedilmemiş değişiklikleriniz silinecek. Bu işlemi onaylıyor musunuz?"
        confirmText="Değişiklikleri Sil ve Kapat"
        cancelText="Vazgeç"
        tone="confirm"
        closeButton={false}
        primaryAction="cancel"
        confirmButtonVariant="danger-ghost"
        dialogClassName="unsaved-changes-dialog"
        closeOnBackdrop={false}
        onConfirm={closeModal}
        onCancel={() => setCloseConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        title="Ürün Sil"
        description={deleteTarget ? `${deleteTarget.name} kaydını silmek istediğinize emin misiniz? Hareket geçmişi olan ürünler silinemez.` : ''}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        confirmText="Sil"
      />
    </div>
  );
}
