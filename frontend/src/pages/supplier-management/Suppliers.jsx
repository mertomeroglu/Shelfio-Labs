import { useEffect, useMemo, useState } from 'react';
import './SupplierManagement.css';
import { useLocation } from 'react-router-dom';
import { Truck, Award, Zap, Clock, Timer, Filter, Plus, Link2, TrendingUp, TrendingDown, ShoppingCart } from 'lucide-react';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import CatalogSupplierMatchingTab from '../../components/CatalogSupplierMatchingTab.jsx';
import DataTable from '../../components/DataTable.jsx';
import FilterBar from '../../components/FilterBar.jsx';
import FormModal, { FormGrid, FormSection } from '../../components/FormModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { SearchableCombobox } from '../../components/SearchBar.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Toast from '../../components/Toast.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { procurementService } from '../../services/procurementService.js';
import { productService } from '../../services/productService.js';
import { sectionService } from '../../services/sectionService.js';
import { stockService } from '../../services/stockService.js';
import { supplierService } from '../../services/supplierService.js';
import { warehouseService } from '../../services/warehouseService.js';
import {
  formatCurrency,
  formatDepotLocationLabel,
  formatNumber,
  formatStorageTypeLabel,
  includesNormalized,
  normalizeSearchText,
  resolveProductTaxonomy,
} from '../../services/formatters.js';
import { resolveSktPolicy, SKT_POLICIES } from '../../utils/sktPolicy.js';

const MONEY_MATCH_FIELDS = new Set(['purchasePrice', 'tierPrice3Case', 'tierPrice10Case', 'tierPrice20Case']);

const normalizeMoneyInput = (value) => String(value ?? '').replace(',', '.');

const parseMoneyInput = (value, fallback = 0) => {
  const normalized = normalizeMoneyInput(value).trim();
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const initialForm = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  address: '',
  isActive: true,
  tedarikciTuru: '',
  website: '',
  kategoriler: '',
};

const SUPPLIER_TYPE_OPTIONS = [
  'Üretici',
  'Distribütör',
  'Toptancı',
  'İthalatçı',
  'Yerel Tedarikçi',
  'Bölgesel Dağıtıcı',
];

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

const initialFilters = {
  search: '',
  tedarikciTuru: '',
  kategori: '',
  gecikme: '',
};

const initialMatchFilters = {
  search: '',
  supplierId: '',
  supplierSearch: '',
  isActive: '',
};

const initialMatchForm = {
  productId: '',
  supplierId: '',
  supplierSku: '',
  supplierProductCode: '',
  purchasePrice: '',
  tierPrice3Case: '',
  tierPrice10Case: '',
  tierPrice20Case: '',
  currency: 'TRY',
  minimumOrderQty: '1',
  leadTimeDays: '3',
  isPrimary: false,
  isActive: true,
  note: '',
};

const MATCH_CREATE_MODES = {
  PRODUCT_SUPPLIER: 'PRODUCT_SUPPLIER',
  PRODUCT_BATCH: 'PRODUCT_BATCH',
  PRODUCT_DEPOT: 'PRODUCT_DEPOT',
  PRODUCT_REYON: 'PRODUCT_REYON',
};

const initialDepotMatchForm = {
  productId: '',
  locationCode: '',
  isPrimary: true,
  isAlternative: false,
  maxStock: '',
  status: 'Aktif',
  note: '',
};

const initialReyonMatchForm = {
  productId: '',
  sectionId: '',
  shelfSide: '',
  shelfNo: '',
  shelfLevel: '',
  shelfCode: '',
  shelfCapacity: '',
  placementPriority: 'normal',
  slotMaxDesi: '',
  note: '',
};

const initialBatchMatchForm = {
  productId: '',
  batchNo: '',
  skt: '',
  totalQuantity: '',
  warehouseQuantity: '',
  shelfQuantity: '',
  note: '',
};

const MATCH_MODULE_TABS = {
  HOME: 'HOME',
  PRODUCT_SUPPLIER: 'PRODUCT_SUPPLIER',
  CATALOG_SUPPLIER: 'CATALOG_SUPPLIER',
  PRODUCT_BATCH: 'PRODUCT_BATCH',
  BATCH_EXPIRY: 'BATCH_EXPIRY',
  PRODUCT_DEPOT: 'PRODUCT_DEPOT',
  PRODUCT_REYON: 'PRODUCT_REYON',
};

const initialBatchFilters = {
  search: '',
  expiryStatus: '',
};

const initialBatchExpiryFilters = {
  search: '',
  batchNo: '',
  startDate: '',
  endDate: '',
  expiryStatus: '',
  onlyUpcoming: false,
  onlyExpired: false,
};

const initialDepotFilters = {
  search: '',
  storageType: '',
};

const initialReyonFilters = {
  search: '',
};

const initialSupplierMatchEditForm = {
  productId: '',
  supplierId: '',
  purchasePrice: '',
  leadTimeDays: '3',
  minimumOrderQty: '1',
  note: '',
  isPrimary: true,
};

const initialBatchEditForm = {
  productId: '',
  batchNo: '',
  skt: '',
  totalQuantity: '',
  warehouseQuantity: '',
  shelfQuantity: '',
};

const initialDepotEditForm = {
  productId: '',
  locationCode: '',
  storageType: '',
  status: 'Aktif',
};

const initialReyonEditForm = {
  productId: '',
  sectionId: '',
  shelfSide: '',
  shelfNo: '',
  shelfLevel: '',
};

const resolveSupplierLeadTimeDays = (supplier) => {
  const explicit = Number(supplier?.averageDeliveryDays || supplier?.leadTimeDays || 0);
  if (Number.isFinite(explicit) && explicit > 0) {
    return String(Math.max(1, Math.round(explicit)));
  }

  const status = String(supplier?.gecikmeDurumu || '').toLowerCase();
  if (status === 'düşük' || status === 'zamanında') return '2';
  if (status === 'orta') return '4';
  if (status === 'yüksek') return '6';
  return '3';
};

const formatDate = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('tr-TR');
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toDateOnly = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isValidDateOnly = (value) => {
  const dateOnly = toDateOnly(value);
  if (!dateOnly) return false;
  const parsed = new Date(`${dateOnly}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && toDateOnly(parsed) === dateOnly;
};

const getTodayStart = () => {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
};

const addDaysDateOnly = (startDate, days) => {
  const base = startDate instanceof Date && !Number.isNaN(startDate.getTime()) ? startDate : getTodayStart();
  const next = new Date(base.getTime() + (Number(days || 0) * MS_PER_DAY));
  return toDateOnly(next);
};

const clampChangeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  return parsed.getTime() > now.getTime() ? now.toISOString() : parsed.toISOString();
};

const formatDays = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(1)} gün`;
};

const pickPrimaryMatchCandidate = (group = []) => {
  if (!Array.isArray(group) || !group.length) return null;

  const primaryRows = group.filter((item) => item.isPrimary || item.isPreferred);
  const activePrimaryRows = primaryRows.filter((item) => item.isActive !== false);
  const activeRows = group.filter((item) => item.isActive !== false);
  const pool = activePrimaryRows.length ?
     activePrimaryRows
    : (primaryRows.length ? primaryRows : (activeRows.length ? activeRows : group));

  return pool
    .slice()
    .sort((left, right) => {
      const leftPrice = Number(left.purchasePrice || Number.MAX_SAFE_INTEGER);
      const rightPrice = Number(right.purchasePrice || Number.MAX_SAFE_INTEGER);
      if (leftPrice !== rightPrice) return leftPrice - rightPrice;

      const leftLead = Number(left.leadTimeDays || Number.MAX_SAFE_INTEGER);
      const rightLead = Number(right.leadTimeDays || Number.MAX_SAFE_INTEGER);
      if (leftLead !== rightLead) return leftLead - rightLead;

      const leftName = String(left.supplierName || '');
      const rightName = String(right.supplierName || '');
      return leftName.localeCompare(rightName, 'tr');
    })[0] || null;
};

const normalizeStorageBucket = (rawValue) => {
  const normalized = String(rawValue || '').trim().toLowerCase('tr-TR');
  if (!normalized) return 'ambient';
  if (normalized.includes('freezer') || normalized.includes('dondur')) return 'freezer';
  if (normalized.includes('cold') || normalized.includes('soğ') || normalized.includes('sog')) return 'cold';
  if (normalized.includes('ortam') || normalized.includes('ambient')) return 'ambient';
  return 'ambient';
};

const isStorageCompatible = (productStorage, targetStorage) => {
  const productBucket = normalizeStorageBucket(productStorage);
  const targetBucket = normalizeStorageBucket(targetStorage);

  if (productBucket === 'freezer') return targetBucket === 'freezer';
  if (productBucket === 'cold') return targetBucket === 'cold';
  return targetBucket === 'ambient' || targetBucket === 'cold';
};

const inferSectionStorageBucket = (section) => {
  const text = `${section?.name || ''} ${section?.description || ''}`.toLowerCase('tr-TR');
  if (!text) return 'ambient';
  if (text.includes('-18') || text.includes('dondur')) return 'freezer';
  if (text.includes('❄') || text.includes('+0') || text.includes('+1') || text.includes('+2') || text.includes('+3') || text.includes('+4') || text.includes('soğ')) {
    return text.includes('karma') ? 'mixed' : 'cold';
  }
  return 'ambient';
};

const buildReyonShelfCode = ({ sectionNo, shelfSide, shelfNo, shelfLevel }) => {
  const normalizedSectionNo = String(sectionNo || '').trim();
  const normalizedSide = String(shelfSide || '').trim().toUpperCase();
  const normalizedShelfNo = String(shelfNo || '').trim();
  const normalizedShelfLevel = String(shelfLevel || '').trim();

  if (!normalizedSectionNo || !normalizedSide || !normalizedShelfNo || !normalizedShelfLevel) {
    return '';
  }

  return `${normalizedSectionNo}${normalizedSide}${normalizedShelfNo}-${normalizedShelfLevel}`;
};

const parseWebsiteUrl = (rawValue) => {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;

  const tryParse = (candidate) => {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed;
    } catch {
      return null;
    }
  };

  return tryParse(raw) || tryParse(`https://${raw}`);
};

const formatSignedPercent = (value) => {
  const numeric = Number(value || 0);
  const sign = numeric > 0 ? '+' : '';
  return `${sign}${numeric.toFixed(1)}%`;
};

const PRODUCT_CONTEXT_EXCLUDED_TOP_LEVEL_KEYS = new Set([
  'id',
  'productId',
  'name',
  'productName',
  'sku',
  'barcode',
  'unit',
  'categoryName',
  'categoryId',
  'unitsPerCase',
  'casesPerPallet',
]);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const toMetricLabel = (key) => String(key || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/_/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const resolveBadgeTone = (rawValue) => {
  const normalized = String(rawValue || '').trim().toLocaleLowerCase('tr-TR');
  if (!normalized) return null;

  if (['aktif', 'active', 'normal', 'zamanında', 'zamaninda', 'düşük', 'dusuk', 'true', 'evet'].includes(normalized)) return 'success';
  if (['yaklaşan', 'yaklasan', 'warning', 'orta'].includes(normalized)) return 'warning';
  if (['pasif', 'inactive', 'kritik', 'expired', 'süresi geçmiş', 'suresi gecmis', 'yüksek', 'yuksek', 'false', 'hayır', 'hayir'].includes(normalized)) return 'danger';
  return null;
};

const formatMetricValue = (key, value) => {
  if (value === null || value === undefined) return { value: '-', tone: null };

  if (typeof value === 'boolean') {
    return { value: value ? 'Evet' : 'Hayır', tone: value ? 'success' : 'danger' };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { value: '-', tone: null };

    if (/(price|cost|value|revenue|amount|fiyat|tutar)/i.test(key)) {
      return { value: formatCurrency(value, 'TRY'), tone: null };
    }

    if (/(rate|ratio|margin|percent|percentage|performans)/i.test(key)) {
      return { value: `${value.toFixed(2)}%`, tone: null };
    }

    if (/(days|day|sure|süre)/i.test(key)) {
      return { value: formatDays(value), tone: null };
    }

    return { value: formatNumber(value), tone: null };
  }

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return { value: '-', tone: null };

    if (/(date|expiry|skt|updated|created)/i.test(key)) {
      return { value: formatDate(text), tone: null };
    }

    const badgeTone = resolveBadgeTone(text);
    return { value: text, tone: badgeTone };
  }

  return { value: '-', tone: null };
};

const collectObjectMetrics = (source, parentKey = '') => {
  if (!isPlainObject(source)) return [];

  const metrics = [];
  Object.entries(source).forEach(([key, rawValue]) => {
    if (rawValue === null || rawValue === undefined) return;

    if (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      const formatted = formatMetricValue(key, rawValue);
      if (formatted.value === '-') return;

      metrics.push({
        key: `${parentKey}.${key}`,
        label: toMetricLabel(key),
        value: formatted.value,
        tone: formatted.tone,
      });
      return;
    }

    if (isPlainObject(rawValue)) {
      Object.entries(rawValue).forEach(([nestedKey, nestedValue]) => {
        if (nestedValue === null || nestedValue === undefined) return;
        if (!['string', 'number', 'boolean'].includes(typeof nestedValue)) return;

        const formatted = formatMetricValue(nestedKey, nestedValue);
        if (formatted.value === '-') return;

        metrics.push({
          key: `${parentKey}.${key}.${nestedKey}`,
          label: `${toMetricLabel(key)} ${toMetricLabel(nestedKey)}`,
          value: formatted.value,
          tone: formatted.tone,
        });
      });
    }
  });

  return metrics;
};

const summarizeArrayMetrics = (key, value) => {
  if (!Array.isArray(value)) return [];

  const metrics = [{
    key: `${key}.count`,
    label: 'Kayıt Sayısı',
    value: formatNumber(value.length),
    tone: null,
  }];

  const numericTotals = new Map();
  value.forEach((item) => {
    if (!isPlainObject(item)) return;
    Object.entries(item).forEach(([nestedKey, nestedValue]) => {
      const numeric = Number(nestedValue);
      if (!Number.isFinite(numeric)) return;
      if (/(^id$|Id$|^index$)/.test(nestedKey)) return;
      numericTotals.set(nestedKey, (numericTotals.get(nestedKey) || 0) + numeric);
    });
  });

  const totals = Array.from(numericTotals.entries())
    .filter(([, total]) => Number.isFinite(total) && total !== 0)
    .sort((left, right) => {
      const leftScore = /(stock|quantity|count|pallet|price|value|days|total|available|reserved)/i.test(left[0]) ? 1 : 0;
      const rightScore = /(stock|quantity|count|pallet|price|value|days|total|available|reserved)/i.test(right[0]) ? 1 : 0;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return Math.abs(right[1]) - Math.abs(left[1]);
    })
    .slice(0, 4)
    .map(([nestedKey, total]) => ({
      key: `${key}.${nestedKey}`,
      label: `Toplam ${toMetricLabel(nestedKey)}`,
      value: formatMetricValue(nestedKey, total).value,
      tone: null,
    }));

  return [...metrics, ...totals];
};

const resolveExpiryStatus = (value) => {
  if (!value) return 'unknown';
  const expiry = new Date(value);
  if (Number.isNaN(expiry.getTime())) return 'unknown';

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const expiryStart = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate()).getTime();
  const diffDays = Math.floor((expiryStart - todayStart) / MS_PER_DAY);

  if (diffDays < 0) return 'expired';
  if (diffDays <= 7) return 'critical';
  if (diffDays <= 30) return 'warning';
  return 'normal';
};

const getExpiryStatusLabel = (status) => {
  if (status === 'expired') return 'Süresi Geçmiş';
  if (status === 'critical') return 'Kritik';
  if (status === 'warning') return 'Yaklaşıyor';
  if (status === 'normal') return 'Normal';
  return 'Belirsiz';
};

const getExpiryStatusTone = (status) => {
  if (status === 'expired' || status === 'critical') return 'danger';
  if (status === 'warning') return 'warning';
  if (status === 'normal') return 'success';
  return 'neutral';
};

const resolveBatchExpiryDate = (batch = {}) => {
  const direct = toDateOnly(batch.skt);
  if (direct) return { value: direct, source: 'record' };

  return { value: null, source: 'missing' };
};

const getLatestClampedDate = (...values) => values
  .map((value) => clampChangeDate(value))
  .filter(Boolean)
  .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || new Date().toISOString();

const formatMatchLocationParts = (parts = []) => parts
  .map((part) => String(part || '').trim())
  .filter((part) => part && part !== '-')
  .join(' • ') || '-';

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseSupplierCategories = (rawValue, knownCategories) => {
  const raw = String(rawValue || '').trim();
  if (!raw) return [];

  const matches = [];
  knownCategories.forEach((category) => {
    const pattern = new RegExp(`(^|,\\s*)(${escapeRegExp(category)})(?=,\\s*|$)`);
    const result = pattern.exec(raw);
    if (result) {
      const startIndex = result.index + (result[1]?.length || 0);
      matches.push({ category, startIndex });
    }
  });

  if (matches.length > 0) {
    return [...new Set(matches.sort((a, b) => a.startIndex - b.startIndex).map((item) => item.category))];
  }

  return [...new Set(raw.split(',').map((part) => part.trim()).filter(Boolean))];
};

const getBrandFromProductName = (name) => {
  const value = String(name || '').trim();
  if (!value) return '';
  return value.split(/[\s-]+/).find(Boolean) || '';
};

const getMarginRate = (salePrice, purchasePrice) => {
  const sale = Number(salePrice || 0);
  const purchase = Number(purchasePrice || 0);
  if (!Number.isFinite(sale) || !Number.isFinite(purchase) || sale <= 0 || purchase <= 0 || purchase >= sale) {
    return null;
  }
  return ((sale - purchase) / sale) * 100;
};

const getSupplierScore = ({ purchasePrice, leadTimeDays, deliveryPerformance = MIN_DELIVERY_PERFORMANCE, productRows = [] }) => {
  const safeRows = Array.isArray(productRows) ? productRows : [];
  const minPrice = safeRows.length ? Math.min(...safeRows.map((item) => Number(item.purchasePrice || 0)).filter((value) => value > 0)) : Number(purchasePrice || 0);
  const minLead = safeRows.length ? Math.min(...safeRows.map((item) => Number(item.leadTimeDays || 0)).filter((value) => value > 0)) : Number(leadTimeDays || 0);

  const priceRatio = minPrice > 0 ? (Number(purchasePrice || 0) / minPrice) : 1;
  const leadRatio = minLead > 0 ? (Number(leadTimeDays || 0) / minLead) : 1;
  const perfRatio = Math.max(0.01, Math.min(1, Number(deliveryPerformance || MIN_DELIVERY_PERFORMANCE) / 100));

  const weighted = (priceRatio * 0.55) + (leadRatio * 0.25) + ((1 / perfRatio) * 0.20);
  const score = Math.max(0, Math.min(100, 120 - (weighted * 35)));
  return Number(score.toFixed(1));
};

function Sparkline({ values = [], ariaLabel = 'Trend grafiği' }) {
  const points = useMemo(() => {
    if (!Array.isArray(values) || values.length === 0) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    return values
      .map((value, index) => {
        const x = (index / Math.max(1, values.length - 1)) * 100;
        const y = 24 - (((value - min) / range) * 24);
        return `${x},${y}`;
      })
      .join(' ');
  }, [values]);

  return (
    <svg className="supplier-sparkline" viewBox="0 0 100 24" role="img" aria-label={ariaLabel}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Suppliers({ mode = 'suppliers' }) {
  const { user } = useAuth();
  const location = useLocation();
  const isMatchesModule = mode === 'matches';
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [sections, setSections] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [matchFilters, setMatchFilters] = useState(initialMatchFilters);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMatchModalOpen, setIsMatchModalOpen] = useState(false);
  const [matchCreateMode, setMatchCreateMode] = useState(MATCH_CREATE_MODES.PRODUCT_SUPPLIER);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [matchForm, setMatchForm] = useState(initialMatchForm);
  const [batchMatchForm, setBatchMatchForm] = useState(initialBatchMatchForm);
  const [depotMatchForm, setDepotMatchForm] = useState(initialDepotMatchForm);
  const [reyonMatchForm, setReyonMatchForm] = useState(initialReyonMatchForm);
  const [supplierProducts, setSupplierProducts] = useState([]);
  const [warehouseLocations, setWarehouseLocations] = useState([]);
  const [isMatchReferenceLoading, setIsMatchReferenceLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [matchSubmitting, setMatchSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [matchModuleTab, setMatchModuleTab] = useState(MATCH_MODULE_TABS.HOME);
  const [batchFilters, setBatchFilters] = useState(initialBatchFilters);
  const [batchExpiryFilters, setBatchExpiryFilters] = useState(initialBatchExpiryFilters);
  const [depotFilters, setDepotFilters] = useState(initialDepotFilters);
  const [reyonFilters, setReyonFilters] = useState(initialReyonFilters);
  const [isMatchEditModalOpen, setIsMatchEditModalOpen] = useState(false);
  const [matchEditType, setMatchEditType] = useState('');
  const [matchEditSubmitting, setMatchEditSubmitting] = useState(false);
  const [supplierMatchEditForm, setSupplierMatchEditForm] = useState(initialSupplierMatchEditForm);
  const [batchEditForm, setBatchEditForm] = useState(initialBatchEditForm);
  const [depotEditForm, setDepotEditForm] = useState(initialDepotEditForm);
  const [reyonEditForm, setReyonEditForm] = useState(initialReyonEditForm);

  const isAdmin = user?.role === 'admin';

  const loadData = async () => {
    try {
      const hasWarmCache =
        supplierService.hasListCache()
        && productService.hasListCache({ universe: 'listed_active', includeUnlisted: false })
        && procurementService.hasSupplierProductsCache()
        && stockService.hasStocksCache()
        && sectionService.hasListCache();

      if (!hasWarmCache) {
        setIsLoading(true);
      }

      const [supplierList, productList, supplierProductList, stockList, sectionList, warehouseResult] = await Promise.all([
        supplierService.list(),
        productService.list({ universe: 'listed_active', includeUnlisted: false, fetchAll: true, includeListDetails: true }),
        procurementService.listSupplierProducts({ fetchAll: true }),
        stockService.getStocks({ fetchAll: true, includeBatches: false }),
        sectionService.list(),
        warehouseService.listLocations().catch(() => ({ rows: [] })),
      ]);
      setSuppliers(supplierList || []);
      setProducts(productList || []);
      setSupplierProducts(Array.isArray(supplierProductList) ? supplierProductList : []);
      setStocks(Array.isArray(stockList) ? stockList : []);
      setSections(Array.isArray(sectionList) ? sectionList : []);
      setWarehouseLocations(Array.isArray(warehouseResult?.rows) ? warehouseResult.rows : []);
    } catch (error) {
      setToast({ type: 'error', title: 'Tedarikçiler', message: error.message || 'Tedarikçiler yüklenemedi.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const productTaxonomyById = useMemo(() => {
    const map = new Map();
    products.forEach((product) => {
      const taxonomy = resolveProductTaxonomy(product);
      map.set(String(product.id), taxonomy);
    });
    return map;
  }, [products]);

  const allMainCategories = useMemo(
    () => [...new Set(Array.from(productTaxonomyById.values()).map((item) => String(item.mainCategory || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')),
    [productTaxonomyById]
  );

  const productCategoryById = useMemo(() => {
    const map = new Map();
    products.forEach((product) => {
      const key = String(product.id);
      const value = String(productTaxonomyById.get(key)?.mainCategory || product.categoryName || '').trim();
      if (value) map.set(key, value);
    });
    return map;
  }, [productTaxonomyById, products]);

  const supplierCategoryInfoById = useMemo(() => {
    const linkedCategorySets = new Map();
    const linkedTagSets = new Map();

    supplierProducts.forEach((link) => {
      const supplierId = String(link.supplierId || '');
      const productId = String(link.productId || '');
      if (!supplierId || !productId) return;

      const category = productCategoryById.get(productId);
      const taxonomy = productTaxonomyById.get(productId) || null;
      if (!category) return;

      if (!linkedCategorySets.has(supplierId)) {
        linkedCategorySets.set(supplierId, new Set());
      }
      linkedCategorySets.get(supplierId).add(category);

      const tag = String(taxonomy?.subCategory || '').trim();
      if (tag && tag !== '-') {
        if (!linkedTagSets.has(supplierId)) {
          linkedTagSets.set(supplierId, new Set());
        }
        tag.split(',').map((part) => part.trim()).filter(Boolean).forEach((part) => linkedTagSets.get(supplierId).add(part));
      }
    });

    const infoMap = new Map();

    suppliers.forEach((supplier) => {
      const supplierId = String(supplier.id || '');
      const linkedSet = linkedCategorySets.get(supplierId) || new Set();
      const tagSet = linkedTagSets.get(supplierId) || new Set();

      if (linkedSet.size === 0) {
        parseSupplierCategories(supplier.kategoriler, allMainCategories).forEach((category) => linkedSet.add(category));
      }

      const categories = [...linkedSet].sort((a, b) => a.localeCompare(b, 'tr'));
      const isAllCategories = allMainCategories.length > 0 && allMainCategories.every((category) => linkedSet.has(category));

      infoMap.set(supplierId, {
        categories,
        tags: [...tagSet].sort((a, b) => a.localeCompare(b, 'tr')),
        isAllCategories,
      });
    });

    return infoMap;
  }, [allMainCategories, productCategoryById, supplierProducts, suppliers]);

  const getSupplierCategoryInfo = (supplier) => supplierCategoryInfoById.get(String(supplier?.id || '')) || { categories: [], tags: [], isAllCategories: false };

  const getSupplierCategoryText = (supplier) => {
    const info = getSupplierCategoryInfo(supplier);
    if (info.isAllCategories) return 'Tüm Kategoriler';
    if (info.categories.length > 0) {
      if (!info.tags.length) return info.categories.join(', ');
      return `${info.categories.join(', ')} • Etiket: ${info.tags.join(', ')}`;
    }
    return String(supplier?.kategoriler || '').trim() || '';
  };

  // Auto-open edit modal when navigated with highlightSupplierId state
  useEffect(() => {
    const targetId = location.state?.highlightSupplierId;
    if (targetId && suppliers.length > 0) {
      const target = suppliers.find((s) => s.id === targetId);
      if (target) openEditModal(target);
      window.history.replaceState({}, '');
    }
  }, [location.state, suppliers]);

  /* Unique values for filter dropdowns */
  const uniqueTypes = useMemo(() => [...new Set(suppliers.map((s) => s.tedarikciTuru).filter(Boolean))].sort(), [suppliers]);
  const uniqueCategories = useMemo(() => allMainCategories, [allMainCategories]);
  const uniqueGecikme = useMemo(() => [...new Set(suppliers.map((s) => s.gecikmeDurumu).filter(Boolean))].sort(), [suppliers]);

  /* Filtering */
  const filteredRows = useMemo(() => {
    return suppliers.filter((item) => {
      const categoryText = getSupplierCategoryText(item);
      const matchesSearch = !filters.search || [item.name, categoryText, item.tedarikciTuru].filter(Boolean).some((value) => value.toLowerCase().includes(filters.search.toLowerCase()));
      const matchesType = !filters.tedarikciTuru || item.tedarikciTuru === filters.tedarikciTuru;
      const matchesCategory = !filters.kategori || getSupplierCategoryInfo(item).categories.includes(filters.kategori);
      const matchesGecikme = !filters.gecikme || item.gecikmeDurumu === filters.gecikme;
      return matchesSearch && matchesType && matchesCategory && matchesGecikme;
    });
  }, [filters, suppliers, supplierCategoryInfoById]);

  /* Summary & Analytics */
  const analytics = useMemo(() => {
    const total = suppliers.length;
    const totalLinked = suppliers.reduce((sum, s) => sum + (s.productCount || 0), 0);
    const totalOrders = suppliers.reduce((sum, s) => sum + Number(s.orderMetrics?.totalOrders || 0), 0);
    const totalOrdersLast30 = suppliers.reduce((sum, s) => sum + Number(s.orderMetrics?.orderCountLast30Days || 0), 0);
    const averageDelayDays = suppliers.length ?
       suppliers.reduce((sum, s) => sum + Number(s.orderMetrics?.averageDelayDays || 0), 0) / suppliers.length
      : 0;
    const topSupplier = suppliers.length ? suppliers.reduce((a, b) => ((a.productCount || 0) > (b.productCount || 0) ? a : b)) : null;
    const bestDelivery = suppliers.length ? suppliers.reduce((a, b) => (parseFloat(a.teslimatPerformansi) > parseFloat(b.teslimatPerformansi) ? a : b)) : null;
    const lowDelay = suppliers.filter((s) => ['düşük', 'zamanında'].includes(String(s.gecikmeDurumu || '').toLowerCase())).length;

    const weightedDeliveryDuration = suppliers.reduce(
      (acc, supplier) => {
        const avgDays = Number(supplier.orderMetrics?.averageDeliveryDays);
        const delivered = Number(supplier.orderMetrics?.deliveredOrderCount || 0);
        if (!Number.isFinite(avgDays) || delivered <= 0) return acc;
        return {
          totalDays: acc.totalDays + (avgDays * delivered),
          totalDelivered: acc.totalDelivered + delivered,
        };
      },
      { totalDays: 0, totalDelivered: 0 }
    );

    const deliveryDurationAvg = weightedDeliveryDuration.totalDelivered ?
       weightedDeliveryDuration.totalDays / weightedDeliveryDuration.totalDelivered
      : null;

    const deliveryRates30 = suppliers.map((s) => Number(s.performanceTrend?.deliveryRateLast30Days || 0));
    const deliveryRates30Prev = suppliers.map((s) => Number(s.performanceTrend?.deliveryRatePrev30Days || 0));
    const delayAvg30 = suppliers.map((s) => Number(s.performanceTrend?.delayAvgLast30Days || 0));
    const delayAvg30Prev = suppliers.map((s) => Number(s.performanceTrend?.delayAvgPrev30Days || 0));
    const delayAvg7 = suppliers.map((s) => Number(s.performanceTrend?.delayAvgLast7Days || 0));
    const delayAvg7Prev = suppliers.map((s) => Number(s.performanceTrend?.delayAvgPrev7Days || 0));

    const deliveryRate30 = deliveryRates30.length ? deliveryRates30.reduce((sum, val) => sum + val, 0) / deliveryRates30.length : 0;
    const deliveryRate30Prev = deliveryRates30Prev.length ? deliveryRates30Prev.reduce((sum, val) => sum + val, 0) / deliveryRates30Prev.length : 0;
    const delayRate30 = delayAvg30.length ? delayAvg30.reduce((sum, val) => sum + val, 0) / delayAvg30.length : 0;
    const delayRate30Prev = delayAvg30Prev.length ? delayAvg30Prev.reduce((sum, val) => sum + val, 0) / delayAvg30Prev.length : 0;
    const delayRate7 = delayAvg7.length ? delayAvg7.reduce((sum, val) => sum + val, 0) / delayAvg7.length : 0;
    const delayRate7Prev = delayAvg7Prev.length ? delayAvg7Prev.reduce((sum, val) => sum + val, 0) / delayAvg7Prev.length : 0;

    const deliveryTrendPercent = deliveryRate30Prev ?
       ((deliveryRate30 - deliveryRate30Prev) / Math.abs(deliveryRate30Prev)) * 100
      : (deliveryRate30 ? 100 : 0);
    const delayTrendPercent = delayRate30Prev ?
       ((delayRate30 - delayRate30Prev) / Math.abs(delayRate30Prev)) * 100
      : (delayRate30 ? 100 : 0);
    const delayTrendPercent7 = delayRate7Prev ?
       ((delayRate7 - delayRate7Prev) / Math.abs(delayRate7Prev)) * 100
      : (delayRate7 ? 100 : 0);

    const sparklineAggregate = Array.from({ length: 30 }, (_, index) => {
      const values = suppliers
        .map((supplier) => Number(supplier.performanceTrend?.deliverySparklineLast30Days?.[index]))
        .filter((value) => Number.isFinite(value));

      if (!values.length) return 0;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    });

    const lastOrderDate = suppliers
      .map((supplier) => supplier.orderMetrics?.lastOrderDate)
      .filter(Boolean)
      .sort((a, b) => new Date(b) - new Date(a))[0] || null;

    const categoryMap = {};
    suppliers.forEach((s) => {
      getSupplierCategoryInfo(s).categories.forEach((category) => {
        categoryMap[category] = (categoryMap[category] || 0) + 1;
      });
    });
    const categoryDistribution = Object.entries(categoryMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    return {
      total,
      totalLinked,
      totalOrders,
      totalOrdersLast30,
      averageDelayDays,
      deliveryDurationAvg,
      deliveryRate30,
      deliveryRate30Prev,
      deliveryTrendPercent,
      delayRate30,
      delayRate30Prev,
      delayRate7,
      delayRate7Prev,
      delayTrendPercent,
      delayTrendPercent7,
      sparklineAggregate,
      lastOrderDate,
      topSupplier,
      bestDelivery,
      lowDelay,
      categoryDistribution,
    };
  }, [supplierCategoryInfoById, suppliers]);

  const openCreateModal = () => {
    setEditingItem(null);
    setForm(initialForm);
    setIsModalOpen(true);
  };

  const openCreateMatchModal = async () => {
    setMatchCreateMode(MATCH_CREATE_MODES.PRODUCT_SUPPLIER);
    setMatchForm(initialMatchForm);
    setBatchMatchForm(initialBatchMatchForm);
    setDepotMatchForm(initialDepotMatchForm);
    setReyonMatchForm(initialReyonMatchForm);
    setIsMatchModalOpen(true);

    setIsMatchReferenceLoading(true);
    setIsMatchReferenceLoading(false);
  };

  const openEditModal = (row) => {
    const currentType = String(row.tedarikciTuru || '').trim();
    const normalizedType = SUPPLIER_TYPE_OPTIONS.includes(currentType) ? currentType : '';
    const categoryPreset = getSupplierCategoryInfo(row).categories;
    setEditingItem(row);
    setForm({
      name: row.name || '',
      contactName: row.contactName || '',
      phone: row.phone || '',
      email: row.email || '',
      address: row.address || '',
      isActive: row.isActive,
      tedarikciTuru: normalizedType,
      website: row.website || '',
      kategoriler: categoryPreset.length ? categoryPreset.join(', ') : (row.kategoriler || ''),
    });
    setIsModalOpen(true);
  };

  const selectedFormCategories = useMemo(
    () => parseSupplierCategories(form.kategoriler, uniqueCategories),
    [form.kategoriler, uniqueCategories]
  );

  const toggleFormCategory = (category) => {
    if (!category) return;

    setForm((current) => {
      const currentList = parseSupplierCategories(current.kategoriler, uniqueCategories);
      const exists = currentList.includes(category);
      const nextList = exists ?
         currentList.filter((item) => item !== category)
        : [...currentList, category];

      const normalized = uniqueCategories.filter((item) => nextList.includes(item));
      return {
        ...current,
        kategoriler: normalized.join(', '),
      };
    });
  };

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setToast({ type: 'error', title: 'Tedarikçiler', message: 'Tedarikçi adı zorunludur.' });
      return;
    }

    try {
      setSubmitting(true);
      if (editingItem) {
        await supplierService.update(editingItem.id, form);
        setToast({ type: 'success', title: 'Tedarikçiler', message: 'Tedarikçi güncellendi.' });
      } else {
        await supplierService.create(form);
        setToast({ type: 'success', title: 'Tedarikçiler', message: 'Yeni tedarikçi eklendi.' });
      }
      setIsModalOpen(false);
      setEditingItem(null);
      setForm(initialForm);
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Tedarikçiler', message: error.message || 'İşlem başarısız.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await supplierService.remove(deleteTarget.id);
      setToast({ type: 'success', title: 'Tedarikçiler', message: 'Tedarikçi silindi.' });
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Tedarikçiler', message: error.message || 'Tedarikçi silinemedi.' });
    } finally {
      setDeleteTarget(null);
    }
  };

  const metricsSource = editingItem || null;

  const productOptions = useMemo(
    () =>
      products.map((item) => ({
        value: String(item.id),
        label: item.name || '-',
        secondary: [item.sku, item.barcode].filter(Boolean).join(' • '),
        searchText: [item.name, item.sku, item.barcode, item.categoryName].filter(Boolean).join(' '),
      })),
    [products]
  );

  const supplierOptions = useMemo(
    () =>
      suppliers.map((item) => ({
        value: String(item.id),
        label: item.name || '-',
        secondary: [item.tedarikciTuru, getSupplierCategoryText(item)].filter(Boolean).join(' • '),
        searchText: [item.name, item.tedarikciTuru, getSupplierCategoryText(item)].filter(Boolean).join(' '),
      })),
    [supplierCategoryInfoById, suppliers]
  );

  const matchSupplierFilterOptions = useMemo(
    () => [
      { value: '', label: 'Tüm Tedarikçiler', searchText: 'tüm tedarikçiler hepsi' },
      ...supplierOptions,
    ],
    [supplierOptions]
  );

  const selectedCreateProductId =
    matchCreateMode === MATCH_CREATE_MODES.PRODUCT_SUPPLIER ?
       matchForm.productId
      : matchCreateMode === MATCH_CREATE_MODES.PRODUCT_BATCH ?
         batchMatchForm.productId
      : matchCreateMode === MATCH_CREATE_MODES.PRODUCT_DEPOT ?
         depotMatchForm.productId
        : reyonMatchForm.productId;

  const selectedMatchProduct = useMemo(
    () => products.find((item) => String(item.id) === String(selectedCreateProductId)) || null,
    [products, selectedCreateProductId]
  );
  const selectedMatchSktPolicy = useMemo(() => resolveSktPolicy(selectedMatchProduct || {}), [selectedMatchProduct]);
  const isSelectedMatchSktRequired = selectedMatchSktPolicy.policy === SKT_POLICIES.REQUIRED;
  const isSelectedMatchSktApplicable = selectedMatchSktPolicy.policy !== SKT_POLICIES.NOT_APPLICABLE;

  useEffect(() => {
    if (isSelectedMatchSktApplicable || !batchMatchForm.skt) return;
    setBatchMatchForm((current) => ({ ...current, skt: '' }));
  }, [batchMatchForm.skt, isSelectedMatchSktApplicable]);

  const batchEditProduct = useMemo(
    () => products.find((item) => String(item.id) === String(batchEditForm.productId)) || null,
    [batchEditForm.productId, products]
  );
  const batchEditSktPolicy = useMemo(() => resolveSktPolicy(batchEditProduct || {}), [batchEditProduct]);
  const isBatchEditSktRequired = batchEditSktPolicy.policy === SKT_POLICIES.REQUIRED;
  const isBatchEditSktApplicable = batchEditSktPolicy.policy !== SKT_POLICIES.NOT_APPLICABLE;

  const duplicateMatch = useMemo(
    () =>
      supplierProducts.find(
        (row) => String(row.productId) === String(matchForm.productId) && String(row.supplierId) === String(matchForm.supplierId)
      ) || null,
    [supplierProducts, matchForm.productId, matchForm.supplierId]
  );

  const warehouseLocationOptions = useMemo(
    () => warehouseLocations
      .filter((item) => String(item.locationType || 'depo').toLowerCase('tr-TR') === 'depo')
      .map((item) => ({
        value: String(item.locationCode || ''),
        label: formatDepotLocationLabel(item.locationCode, String(item.locationCode || '-')),
        secondary: [
          item.storageTypeLabel || formatStorageTypeLabel(item.storageType),
          `Sıra ${item.rowNo ?? '-'} ${item.side || '-'} / Raf ${item.shelfNo ?? '-'} / Kat ${item.levelNo ?? '-'}`,
        ].join(' • '),
        searchText: [
          item.locationCode,
          item.storageTypeLabel,
          item.storageType,
          item.side,
          item.rowNo,
          item.shelfNo,
          item.levelNo,
        ].filter(Boolean).join(' '),
      })),
    [warehouseLocations]
  );

  const warehouseLocationByCode = useMemo(() => {
    const map = new Map();
    warehouseLocations.forEach((item) => {
      map.set(String(item.locationCode || ''), item);
    });
    return map;
  }, [warehouseLocations]);

  const selectedDepotLocation = useMemo(
    () => warehouseLocationByCode.get(String(depotMatchForm.locationCode || '')) || null,
    [depotMatchForm.locationCode, warehouseLocationByCode]
  );
  const selectedDepotEditLocation = useMemo(
    () => warehouseLocationByCode.get(String(depotEditForm.locationCode || '')) || null,
    [depotEditForm.locationCode, warehouseLocationByCode]
  );

  const reyonSectionOptions = useMemo(
    () => sections.filter((item) => item.isActive !== false).map((item) => ({
      value: String(item.id),
      label: `${item.number || '-'} - ${item.name || '-'}`,
      secondary: item.description || '',
      searchText: [item.number, item.name, item.description].filter(Boolean).join(' '),
    })),
    [sections]
  );

  const sectionById = useMemo(() => {
    const map = new Map();
    sections.forEach((item) => {
      map.set(String(item.id), item);
    });
    return map;
  }, [sections]);

  const reyonGridOptions = useMemo(() => {
    const selectedSectionId = String(reyonMatchForm.sectionId || '');
    const rows = products.filter((item) => String(item.sectionId || '') === selectedSectionId);
    const sideSet = new Set();
    const shelfSet = new Set();
    const levelSet = new Set();

    rows.forEach((item) => {
      if (item.shelfSide) sideSet.add(String(item.shelfSide));
      if (item.shelfNo != null && String(item.shelfNo).trim()) shelfSet.add(String(item.shelfNo));
      if (item.shelfLevel != null && String(item.shelfLevel).trim()) levelSet.add(String(item.shelfLevel));
    });

    const section = sectionById.get(selectedSectionId) || null;
    const fallbackShelfCount = Math.max(1, Number(section?.shelfCount || 15));
    const fallbackLevelCount = Math.max(1, Number(section?.shelfLevels || 10));
    const fallbackShelfOptions = Array.from({ length: fallbackShelfCount }, (_, index) => String(index + 1));
    const fallbackLevelOptions = Array.from({ length: fallbackLevelCount }, (_, index) => String(index + 1));
    const normalizedSideOptions = Array.from(sideSet)
      .map((item) => String(item || '').trim().toUpperCase())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'tr'));

    return {
      sideOptions: normalizedSideOptions.length ? normalizedSideOptions : ['L', 'R'],
      shelfOptions: Array.from(shelfSet).sort((a, b) => Number(a) - Number(b)).length ?
         Array.from(shelfSet).sort((a, b) => Number(a) - Number(b))
        : fallbackShelfOptions,
      levelOptions: Array.from(levelSet).sort((a, b) => Number(a) - Number(b)).length ?
         Array.from(levelSet).sort((a, b) => Number(a) - Number(b))
        : fallbackLevelOptions,
    };
  }, [products, reyonMatchForm.sectionId, sectionById]);

  const isMatchDetailsDisabled = !selectedCreateProductId;
  const selectedProductUnitsPerCase = Math.max(1, Number(selectedMatchProduct?.unitsPerCase || 24));
  const selectedProductCasesPerPallet = Math.max(1, Number(selectedMatchProduct?.casesPerPallet || 60));
  const selectedProductUnitsPerPallet = Math.max(
    1,
    Number(selectedMatchProduct?.unitsPerPallet || selectedProductUnitsPerCase * selectedProductCasesPerPallet)
  );

  const selectedProductContextSections = useMemo(() => {
    if (!selectedMatchProduct || !isPlainObject(selectedMatchProduct)) return [];

    const topLevelMetrics = [];
    const sections = [];

    Object.entries(selectedMatchProduct).forEach(([key, value]) => {
      if (PRODUCT_CONTEXT_EXCLUDED_TOP_LEVEL_KEYS.has(key)) return;
      if (value === null || value === undefined) return;

      if (['string', 'number', 'boolean'].includes(typeof value)) {
        const formatted = formatMetricValue(key, value);
        if (formatted.value === '-') return;
        topLevelMetrics.push({
          key: `top.${key}`,
          label: toMetricLabel(key),
          value: formatted.value,
          tone: formatted.tone,
        });
        return;
      }

      if (isPlainObject(value)) {
        const objectMetrics = collectObjectMetrics(value, key).slice(0, 18);
        if (objectMetrics.length) {
          sections.push({
            key,
            title: toMetricLabel(key),
            metrics: objectMetrics,
          });
        }
        return;
      }

      if (Array.isArray(value)) {
        const arrayMetrics = summarizeArrayMetrics(key, value);
        if (arrayMetrics.length) {
          sections.push({
            key,
            title: toMetricLabel(key),
            metrics: arrayMetrics,
          });
        }
      }
    });

    if (topLevelMetrics.length) {
      sections.unshift({
        key: 'top-level',
        title: 'Ürün Metrikleri',
        metrics: topLevelMetrics,
      });
    }

    return sections;
  }, [selectedMatchProduct]);

  const canSaveMatch =
    !isMatchReferenceLoading
    && Boolean(selectedCreateProductId)
    && Boolean(matchForm.supplierId)
    && parseMoneyInput(matchForm.purchasePrice, 0) > 0
    && Number(matchForm.leadTimeDays) > 0
    && !duplicateMatch;

  const canSaveDepotMatch =
    !isMatchReferenceLoading
    && Boolean(depotMatchForm.productId)
    && Boolean(depotMatchForm.locationCode);

  const canSaveBatchMatch =
    !isMatchReferenceLoading
    && Boolean(batchMatchForm.productId)
    && Boolean(String(batchMatchForm.batchNo || '').trim())
    && (!isSelectedMatchSktRequired || isValidDateOnly(batchMatchForm.skt));

  const canSaveReyonMatch =
    !isMatchReferenceLoading
    && Boolean(reyonMatchForm.productId)
    && Boolean(reyonMatchForm.sectionId)
    && Boolean(reyonMatchForm.shelfSide)
    && Boolean(reyonMatchForm.shelfNo)
    && Boolean(reyonMatchForm.shelfLevel);

  const canSubmitMatch =
    matchCreateMode === MATCH_CREATE_MODES.PRODUCT_SUPPLIER ?
       canSaveMatch
      : matchCreateMode === MATCH_CREATE_MODES.PRODUCT_BATCH ?
         canSaveBatchMatch
      : matchCreateMode === MATCH_CREATE_MODES.PRODUCT_DEPOT ?
         canSaveDepotMatch
        : canSaveReyonMatch;

  const handleMatchProductChange = (productId) => {
    const selectedProduct = products.find((item) => String(item.id) === String(productId));
    const suggestedSupplierCode = String(selectedProduct?.sku || '').trim();

    setMatchForm((current) => ({ ...current, productId }));
    setBatchMatchForm((current) => ({ ...current, productId }));
    setDepotMatchForm((current) => ({ ...current, productId }));
    setReyonMatchForm((current) => ({ ...current, productId }));

    if (suggestedSupplierCode) {
      setMatchForm((current) => ({
        ...current,
        productId,
        supplierSku: current.supplierSku || suggestedSupplierCode,
        supplierProductCode: current.supplierProductCode || suggestedSupplierCode,
      }));
    }
  };

  const handleMatchCreateModeChange = (nextMode) => {
    const preservedProductId = String(selectedCreateProductId || '');
    setMatchCreateMode(nextMode);
    setMatchForm({ ...initialMatchForm, productId: preservedProductId });
    setBatchMatchForm({ ...initialBatchMatchForm, productId: preservedProductId });
    setDepotMatchForm({ ...initialDepotMatchForm, productId: preservedProductId });
    setReyonMatchForm({ ...initialReyonMatchForm, productId: preservedProductId });
  };

  const handleMatchFieldChange = (key, value) => {
    setMatchForm((current) => ({ ...current, [key]: MONEY_MATCH_FIELDS.has(key) ? normalizeMoneyInput(value) : value }));
  };

  const handleMatchSupplierChange = (supplierId) => {
    const selectedSupplier = suppliers.find((item) => String(item.id) === String(supplierId));
    setMatchForm((current) => ({
      ...current,
      supplierId,
      leadTimeDays: resolveSupplierLeadTimeDays(selectedSupplier),
    }));
  };

  const handleDepotFieldChange = (key, value) => {
    setDepotMatchForm((current) => ({ ...current, [key]: value }));
  };

  const handleReyonFieldChange = (key, value) => {
    setReyonMatchForm((current) => ({ ...current, [key]: value }));
  };

  const handleCreateSupplierMatch = async () => {
    if (!matchForm.productId || !matchForm.supplierId || !matchForm.purchasePrice || Number(matchForm.leadTimeDays) <= 0) {
      setToast({ type: 'error', title: 'Yeni Eşleşme', message: 'Ürün, tedarikçi, alış fiyatı ve temin süresi zorunludur.' });
      return false;
    }

    if (Number(matchForm.minimumOrderQty || 0) <= 0) {
      setToast({ type: 'error', title: 'Yeni Eşleşme', message: 'Minimum sipariş koli değeri 0’dan büyük olmalıdır.' });
      return false;
    }

    if (duplicateMatch) {
      setToast({ type: 'error', title: 'Yeni Eşleşme', message: 'Bu ürün ve tedarikçi için eşleşme zaten mevcut.' });
      return false;
    }

    const finalNote = String(matchForm.note || '').trim();
    const group = groupedMatchesByProduct.get(String(matchForm.productId || '')) || [];

    if (matchForm.isPrimary && group.some((item) => item.isPrimary || item.isPreferred)) {
      await Promise.all(
        group
          .filter((item) => item.isPrimary || item.isPreferred)
          .map((item) => procurementService.updateSupplierProduct(item.id, { isPrimary: false, isPreferred: false }))
      );
    }

    await procurementService.createSupplierProduct({
      productId: matchForm.productId,
      supplierId: matchForm.supplierId,
      supplierProductName: selectedMatchProduct?.name || '',
      supplierSku: String(matchForm.supplierSku || '').trim(),
      supplierProductCode: String(matchForm.supplierProductCode || '').trim(),
      barcode: selectedMatchProduct?.barcode || '',
      purchasePrice: parseMoneyInput(matchForm.purchasePrice),
      tierPrice3Case: matchForm.tierPrice3Case ? parseMoneyInput(matchForm.tierPrice3Case) : undefined,
      tierPrice10Case: matchForm.tierPrice10Case ? parseMoneyInput(matchForm.tierPrice10Case) : undefined,
      tierPrice20Case: matchForm.tierPrice20Case ? parseMoneyInput(matchForm.tierPrice20Case) : undefined,
      currency: 'TRY',
      priceUnit: 'koli',
      minimumOrderQty: Number(matchForm.minimumOrderQty || 1),
      minOrderUnit: 'koli',
      defaultOrderUnit: 'koli',
      orderUnit: 'koli',
      leadTimeDays: Number(matchForm.leadTimeDays || 3),
      unitsPerPack: Math.max(1, Number(selectedMatchProduct?.unitsPerPack || 1)),
      unitsPerBox: 1,
      unitsPerCase: selectedProductUnitsPerCase,
      casesPerPallet: selectedProductCasesPerPallet,
      unitsPerPallet: selectedProductUnitsPerPallet,
      note: finalNote,
      isPrimary: Boolean(matchForm.isPrimary),
      isPreferred: Boolean(matchForm.isPrimary),
      isActive: Boolean(matchForm.isActive),
    });

    return true;
  };

  const handleCreateDepotMatch = async () => {
    if (!depotMatchForm.productId || !depotMatchForm.locationCode) {
      setToast({ type: 'error', title: 'Ürün-Depo Eşleşme', message: 'Ürün ve depo lokasyon kodu zorunludur.' });
      return false;
    }

    const locationRow = warehouseLocationByCode.get(String(depotMatchForm.locationCode || '')) || null;
    const productStorage = selectedMatchProduct?.requiredStorageType || selectedMatchProduct?.storageType || 'Ortam';
    if (locationRow && !isStorageCompatible(productStorage, locationRow.storageType || locationRow.storageTypeLabel || 'Ortam')) {
      setToast({ type: 'error', title: 'Ürün-Depo Eşleşme', message: 'Seçilen ürünün saklama tipi bu depo lokasyonu ile uyumlu değil.' });
      return false;
    }

    if (depotMatchForm.maxStock && Number(depotMatchForm.maxStock) < 0) {
      setToast({ type: 'error', title: 'Ürün-Depo Eşleşme', message: 'Depo max stok alanı negatif olamaz.' });
      return false;
    }

    const sourceLocations = Array.isArray(selectedMatchProduct?.depotLocations) ? selectedMatchProduct.depotLocations : [];
    const nextLocations = sourceLocations.filter((item) => String(item.locationCode || '') !== String(depotMatchForm.locationCode));
    nextLocations.push({
      locationCode: String(depotMatchForm.locationCode),
      storageType: String(locationRow?.storageType || selectedMatchProduct?.requiredStorageType || 'Ortam'),
      status: String(locationRow?.status || 'Aktif'),
      warehouseStock: Number(locationRow?.warehouseStock || 0),
      palletCount: Number(locationRow?.palletCount || 1),
      rowNo: locationRow?.rowNo,
      side: locationRow?.side,
      shelfNo: locationRow?.shelfNo,
      levelNo: locationRow?.levelNo,
      note: String(depotMatchForm.note || '').trim(),
      capacity: depotMatchForm.maxStock ? Number(depotMatchForm.maxStock) : Number(locationRow?.palletCapacity || 1),
    });

    await productService.update(depotMatchForm.productId, {
      defaultWarehouseLocationCode: String(selectedMatchProduct?.defaultWarehouseLocationCode || depotMatchForm.locationCode),
      warehouseMaxStock: depotMatchForm.maxStock ? Number(depotMatchForm.maxStock) : Number(selectedMatchProduct?.warehouseMaxStock || 0),
      depotLocations: nextLocations,
    });

    return true;
  };

  const handleCreateBatchMatch = async () => {
    if (!batchMatchForm.productId) {
      setToast({ type: 'error', title: 'Ürün-Parti-SKT Eşleşme', message: 'Ürün seçimi zorunludur.' });
      return false;
    }

    if (!String(batchMatchForm.batchNo || '').trim()) {
      setToast({ type: 'error', title: 'Ürün-Parti-SKT Eşleşme', message: 'Parti no boş olamaz.' });
      return false;
    }

    if (isSelectedMatchSktRequired && !isValidDateOnly(batchMatchForm.skt)) {
      setToast({ type: 'error', title: 'Ürün-Parti-SKT Eşleşme', message: 'SKT geçerli bir tarih olmalıdır.' });
      return false;
    }
    if (!isSelectedMatchSktRequired && String(batchMatchForm.skt || '').trim() && !isValidDateOnly(batchMatchForm.skt)) {
      setToast({ type: 'error', title: 'Ürün-Parti-SKT Eşleşme', message: 'SKT geçerli bir tarih olmalıdır.' });
      return false;
    }

    const product = products.find((item) => String(item.id) === String(batchMatchForm.productId));
    if (!product) {
      setToast({ type: 'error', title: 'Ürün-Parti-SKT Eşleşme', message: 'Ürün bulunamadı.' });
      return false;
    }

    const existing = Array.isArray(product.productBatches) ? product.productBatches : [];
    const nextBatchNo = String(batchMatchForm.batchNo).trim();
    const duplicate = existing.some((item) => String(item.batchNo || item.partiNo || '').trim().toLocaleLowerCase('tr-TR') === nextBatchNo.toLocaleLowerCase('tr-TR'));
    if (duplicate) {
      setToast({ type: 'error', title: 'Ürün-Parti-SKT Eşleşme', message: 'Aynı ürün altında aynı parti no tekrar kaydedilemez.' });
      return false;
    }

    await stockService.upsertBatch(batchMatchForm.productId, {
      batchNo: nextBatchNo,
      skt: isSelectedMatchSktApplicable ? toDateOnly(batchMatchForm.skt) : '',
      warehouseQuantity: Number(batchMatchForm.warehouseQuantity || 0),
      shelfQuantity: Number(batchMatchForm.shelfQuantity || 0),
      status: isSelectedMatchSktApplicable ? resolveExpiryStatus(batchMatchForm.skt) : 'Aktif',
    });
    return true;
  };

  const handleCreateReyonMatch = async () => {
    if (!reyonMatchForm.productId || !reyonMatchForm.sectionId || !reyonMatchForm.shelfSide || !reyonMatchForm.shelfNo || !reyonMatchForm.shelfLevel) {
      setToast({ type: 'error', title: 'Ürün-Reyon Eşleşme', message: 'Ürün, reyon, taraf, raf ve kat alanları zorunludur.' });
      return false;
    }

    const section = sectionById.get(String(reyonMatchForm.sectionId || '')) || null;
    const productStorage = selectedMatchProduct?.requiredStorageType || selectedMatchProduct?.storageType || 'Ortam';
    const sectionStorage = inferSectionStorageBucket(section);
    if (sectionStorage !== 'mixed' && !isStorageCompatible(productStorage, sectionStorage)) {
      setToast({ type: 'error', title: 'Ürün-Reyon Eşleşme', message: 'Ürünün saklama tipi seçilen reyon tipi ile uyumlu değil.' });
      return false;
    }

    const shelfCodeFromSlots = buildReyonShelfCode({
      sectionNo: section?.number,
      shelfSide: reyonMatchForm.shelfSide,
      shelfNo: reyonMatchForm.shelfNo,
      shelfLevel: reyonMatchForm.shelfLevel,
    });
    const shelfCode = String(reyonMatchForm.shelfCode || '').trim() || shelfCodeFromSlots;

    if (!shelfCode) {
      setToast({ type: 'error', title: 'Ürün-Reyon Eşleşme', message: 'Lokasyon kodu üretilemedi, lütfen reyon ve lokasyon alanlarını kontrol edin.' });
      return false;
    }

    await productService.update(reyonMatchForm.productId, {
      sectionId: reyonMatchForm.sectionId,
      shelfSide: String(reyonMatchForm.shelfSide),
      shelfNo: Number(reyonMatchForm.shelfNo),
      shelfLevel: Number(reyonMatchForm.shelfLevel),
      shelfCode,
      defaultShelfLocationCode: shelfCode,
      shelfMaxStock: Number(selectedMatchProduct?.shelfMaxStock || 0),
      placementPriority: String(reyonMatchForm.placementPriority || 'normal'),
      slotMaxDesi: Number(selectedMatchProduct?.averageDesi || selectedMatchProduct?.desi || 0),
      note: String(reyonMatchForm.note || '').trim(),
    });

    return true;
  };

  const handleCreateMatch = async (event) => {
    event.preventDefault();

    try {
      setMatchSubmitting(true);
      let created = false;
      if (matchCreateMode === MATCH_CREATE_MODES.PRODUCT_SUPPLIER) {
        created = await handleCreateSupplierMatch();
        if (created) setToast({ type: 'success', title: 'Yeni Eşleşme', message: 'Ürün-tedarikçi eşleşmesi oluşturuldu.' });
      } else if (matchCreateMode === MATCH_CREATE_MODES.PRODUCT_BATCH) {
        created = await handleCreateBatchMatch();
        if (created) setToast({ type: 'success', title: 'Yeni Eşleşme', message: 'Ürün-parti-SKT eşleşmesi oluşturuldu.' });
      } else if (matchCreateMode === MATCH_CREATE_MODES.PRODUCT_DEPOT) {
        created = await handleCreateDepotMatch();
        if (created) setToast({ type: 'success', title: 'Yeni Eşleşme', message: 'Ürün-depo eşleşmesi oluşturuldu.' });
      } else {
        created = await handleCreateReyonMatch();
        if (created) setToast({ type: 'success', title: 'Yeni Eşleşme', message: 'Ürün-reyon eşleşmesi oluşturuldu.' });
      }

      if (created) {
        setIsMatchModalOpen(false);
        await loadData();
      }
    } catch (error) {
      setToast({ type: 'error', title: 'Yeni Eşleşme', message: error.message || 'Eşleşme oluşturulamadı.' });
    } finally {
      setMatchSubmitting(false);
    }
  };

  const closeMatchEditModal = () => {
    setIsMatchEditModalOpen(false);
    setMatchEditType('');
    setSupplierMatchEditForm(initialSupplierMatchEditForm);
    setBatchEditForm(initialBatchEditForm);
    setDepotEditForm(initialDepotEditForm);
    setReyonEditForm(initialReyonEditForm);
  };

  const openSupplierMatchEdit = (row) => {
    const productId = String(row.productId || '');
    const group = groupedMatchesByProduct.get(productId) || [];
    const selectedRow = group.find((item) => String(item.supplierId) === String(row.supplierId)) || group[0] || null;

    setSupplierMatchEditForm({
      ...initialSupplierMatchEditForm,
      id: selectedRow?.id || '',
      productId,
      supplierId: String(selectedRow?.supplierId || row.supplierId || ''),
      purchasePrice: selectedRow?.purchasePrice != null ? String(selectedRow.purchasePrice) : '',
      leadTimeDays: selectedRow?.leadTimeDays != null ? String(selectedRow.leadTimeDays) : '3',
      minimumOrderQty: selectedRow?.minimumOrderQty != null ? String(selectedRow.minimumOrderQty) : '1',
      note: String(selectedRow?.note || ''),
      isPrimary: true,
    });
    setMatchEditType('supplier');
    setIsMatchEditModalOpen(true);
  };

  const openBatchMatchEdit = (row) => {
    setBatchEditForm({
      ...initialBatchEditForm,
      productId: String(row.productId || ''),
      batchNo: String(row.batchNo || ''),
      skt: row.skt ? String(row.skt).slice(0, 10) : '',
      totalQuantity: String(Number(row.totalQuantity || 0)),
      warehouseQuantity: String(Number(row.warehouseQuantity || 0)),
      shelfQuantity: String(Number(row.shelfQuantity || 0)),
      sourceBatchNo: String(row.batchNo || ''),
      sourceSkt: row.skt ? String(row.skt).slice(0, 10) : '',
    });
    setMatchEditType('batch');
    setIsMatchEditModalOpen(true);
  };

  const openDepotMatchEdit = (row) => {
    const locationMeta = warehouseLocationByCode.get(String(row.locationCode || '')) || null;
    setDepotEditForm({
      ...initialDepotEditForm,
      productId: String(row.productId || ''),
      locationCode: String(row.locationCode || ''),
      storageType: String(locationMeta?.storageType || row.storageType || ''),
      status: String(row.status || 'Aktif'),
      sourceLocationCode: String(row.locationCode || ''),
    });
    setMatchEditType('depot');
    setIsMatchEditModalOpen(true);
  };

  const openReyonMatchEdit = (row) => {
    setReyonEditForm({
      ...initialReyonEditForm,
      productId: String(row.productId || ''),
      sectionId: String(row.sectionId || ''),
      shelfSide: String(row.shelfSide || ''),
      shelfNo: String(row.shelfNo || ''),
      shelfLevel: String(row.shelfLevel || ''),
    });
    setMatchEditType('reyon');
    setIsMatchEditModalOpen(true);
  };

  const handleSaveSupplierMatchEdit = async (event) => {
    event.preventDefault();

    if (!supplierMatchEditForm.productId || !supplierMatchEditForm.supplierId || parseMoneyInput(supplierMatchEditForm.purchasePrice, 0) <= 0 || Number(supplierMatchEditForm.leadTimeDays || 0) <= 0) {
      setToast({ type: 'error', title: 'Eşleşme Düzenle', message: 'Ürün, tedarikçi, alış fiyatı ve teslim süresi zorunludur.' });
      return;
    }

    try {
      setMatchEditSubmitting(true);

      const product = products.find((item) => String(item.id) === String(supplierMatchEditForm.productId));
      const group = groupedMatchesByProduct.get(String(supplierMatchEditForm.productId)) || [];
      const selectedMatch = group.find((item) => String(item.supplierId) === String(supplierMatchEditForm.supplierId)) || null;

      if (selectedMatch?.id) {
        await procurementService.updateSupplierProduct(selectedMatch.id, {
          purchasePrice: parseMoneyInput(supplierMatchEditForm.purchasePrice),
          leadTimeDays: Number(supplierMatchEditForm.leadTimeDays),
          minimumOrderQty: Number(supplierMatchEditForm.minimumOrderQty || 1),
          note: String(supplierMatchEditForm.note || '').trim(),
          isPrimary: true,
          isPreferred: true,
          isActive: true,
        });
      } else {
        await procurementService.createSupplierProduct({
          productId: supplierMatchEditForm.productId,
          supplierId: supplierMatchEditForm.supplierId,
          supplierProductName: product?.name || '',
          supplierSku: '',
          supplierProductCode: '',
          barcode: product?.barcode || '',
          purchasePrice: parseMoneyInput(supplierMatchEditForm.purchasePrice),
          currency: 'TRY',
          priceUnit: 'koli',
          minimumOrderQty: Number(supplierMatchEditForm.minimumOrderQty || 1),
          minOrderUnit: 'koli',
          defaultOrderUnit: 'koli',
          orderUnit: 'koli',
          leadTimeDays: Number(supplierMatchEditForm.leadTimeDays),
          unitsPerPack: Math.max(1, Number(product?.unitsPerPack || 1)),
          unitsPerBox: 1,
          unitsPerCase: Math.max(1, Number(product?.unitsPerCase || 24)),
          casesPerPallet: Math.max(1, Number(product?.casesPerPallet || 60)),
          unitsPerPallet: Math.max(1, Number(product?.unitsPerPallet || (Number(product?.unitsPerCase || 24) * Number(product?.casesPerPallet || 60)))),
          note: String(supplierMatchEditForm.note || '').trim(),
          isPrimary: true,
          isPreferred: true,
          isActive: true,
        });
      }

      const currentPrimaryRows = group.filter((item) => String(item.supplierId) !== String(supplierMatchEditForm.supplierId) && (item.isPrimary || item.isPreferred));
      if (currentPrimaryRows.length) {
        await Promise.all(currentPrimaryRows.map((item) => procurementService.updateSupplierProduct(item.id, { isPrimary: false, isPreferred: false })));
      }

      setToast({ type: 'success', title: 'Eşleşme Düzenle', message: 'Ürün-tedarikçi eşleşmesi güncellendi.' });
      closeMatchEditModal();
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Eşleşme Düzenle', message: error.message || 'Ürün-tedarikçi eşleşmesi güncellenemedi.' });
    } finally {
      setMatchEditSubmitting(false);
    }
  };

  const handleSaveBatchEdit = async (event) => {
    event.preventDefault();

    const editProduct = products.find((item) => String(item.id) === String(batchEditForm.productId));
    const editSktPolicy = resolveSktPolicy(editProduct || {});
    const isEditSktRequired = editSktPolicy.policy === SKT_POLICIES.REQUIRED;
    const isEditSktApplicable = editSktPolicy.policy !== SKT_POLICIES.NOT_APPLICABLE;

    if (!batchEditForm.productId || !String(batchEditForm.batchNo || '').trim()) {
      setToast({ type: 'error', title: 'Parti-SKT Düzenle', message: 'Parti no zorunludur.' });
      return;
    }

    if (isEditSktRequired && !isValidDateOnly(batchEditForm.skt)) {
      setToast({ type: 'error', title: 'Parti-SKT Düzenle', message: 'Bu ürün grubu için geçerli SKT zorunludur.' });
      return;
    }

    if (!isEditSktRequired && String(batchEditForm.skt || '').trim() && !isValidDateOnly(batchEditForm.skt)) {
      setToast({ type: 'error', title: 'Parti-SKT Düzenle', message: 'SKT geçerli bir tarih olmalıdır.' });
      return;
    }

    try {
      setMatchEditSubmitting(true);
      const product = editProduct;
      const sourceBatches = Array.isArray(product?.productBatches) ? product.productBatches : [];
      const nextBatchNo = String(batchEditForm.batchNo || '').trim();
      const duplicate = sourceBatches.some((item) => {
        const itemBatchNo = String(item.batchNo || item.partiNo || '').trim();
        const itemSkt = toDateOnly(item.skt || item.expiryDate);
        const isSource = itemBatchNo === String(batchEditForm.sourceBatchNo || '') && itemSkt === String(batchEditForm.sourceSkt || '');
        return !isSource && itemBatchNo.toLocaleLowerCase('tr-TR') === nextBatchNo.toLocaleLowerCase('tr-TR');
      });

      if (duplicate) {
        setToast({ type: 'error', title: 'Parti-SKT Düzenle', message: 'Aynı ürün altında aynı parti no tekrar kaydedilemez.' });
        return;
      }

      await stockService.upsertBatch(batchEditForm.productId, {
        sourceBatchNo: batchEditForm.sourceBatchNo,
        batchNo: nextBatchNo,
        skt: isEditSktApplicable ? toDateOnly(batchEditForm.skt) : '',
        warehouseQuantity: Number(batchEditForm.warehouseQuantity || 0),
        shelfQuantity: Number(batchEditForm.shelfQuantity || 0),
        status: isEditSktApplicable ? resolveExpiryStatus(batchEditForm.skt) : 'Aktif',
      });
      setToast({ type: 'success', title: 'Parti-SKT Düzenle', message: 'Ürün-parti-SKT eşleşmesi güncellendi.' });
      closeMatchEditModal();
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Parti-SKT Düzenle', message: error.message || 'Parti-SKT bilgisi güncellenemedi.' });
    } finally {
      setMatchEditSubmitting(false);
    }
  };

  const handleSaveDepotEdit = async (event) => {
    event.preventDefault();

    if (!depotEditForm.productId || !depotEditForm.locationCode) {
      setToast({ type: 'error', title: 'Depo Eşleşmesi', message: 'Depo lokasyon kodu zorunludur.' });
      return;
    }

    try {
      setMatchEditSubmitting(true);
      const product = products.find((item) => String(item.id) === String(depotEditForm.productId));
      const selectedLocation = warehouseLocationByCode.get(String(depotEditForm.locationCode || '')) || null;
      const resolvedStorageType = String(
        selectedLocation?.storageType
        || depotEditForm.storageType
        || product?.requiredStorageType
        || 'Ortam'
      );
      const sourceLocations = Array.isArray(product?.depotLocations) ? product.depotLocations : [];

      let updated = false;
      const nextLocations = sourceLocations.map((item) => {
        if (!updated && String(item.locationCode || '') === String(depotEditForm.sourceLocationCode || '')) {
          updated = true;
          return {
            ...item,
            locationCode: String(depotEditForm.locationCode),
            storageType: resolvedStorageType,
            status: String(depotEditForm.status || item.status || 'Aktif'),
          };
        }
        return item;
      });

      if (!updated) {
        nextLocations.push({
          locationCode: String(depotEditForm.locationCode),
          storageType: resolvedStorageType,
          status: String(depotEditForm.status || 'Aktif'),
          warehouseStock: Number(product?.warehouseStock || 0),
        });
      }

      await productService.update(depotEditForm.productId, {
        defaultWarehouseLocationCode: String(depotEditForm.locationCode),
        depotLocations: nextLocations,
      });

      setToast({ type: 'success', title: 'Depo Eşleşmesi', message: 'Ürün-depo eşleşmesi güncellendi.' });
      closeMatchEditModal();
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Depo Eşleşmesi', message: error.message || 'Depo eşleşmesi güncellenemedi.' });
    } finally {
      setMatchEditSubmitting(false);
    }
  };

  const handleSaveReyonEdit = async (event) => {
    event.preventDefault();

    if (!reyonEditForm.productId || !reyonEditForm.sectionId) {
      setToast({ type: 'error', title: 'Reyon Eşleşmesi', message: 'Bağlı reyon seçimi zorunludur.' });
      return;
    }

    try {
      setMatchEditSubmitting(true);
      const section = sectionById.get(String(reyonEditForm.sectionId));
      const shelfCode = (section && reyonEditForm.shelfSide && reyonEditForm.shelfNo && reyonEditForm.shelfLevel) ?
         `${section.number}${reyonEditForm.shelfSide}${reyonEditForm.shelfNo}-${reyonEditForm.shelfLevel}`
        : undefined;

      await productService.update(reyonEditForm.productId, {
        sectionId: reyonEditForm.sectionId,
        shelfSide: reyonEditForm.shelfSide || undefined,
        shelfNo: reyonEditForm.shelfNo ? Number(reyonEditForm.shelfNo) : undefined,
        shelfLevel: reyonEditForm.shelfLevel ? Number(reyonEditForm.shelfLevel) : undefined,
        shelfCode,
      });

      setToast({ type: 'success', title: 'Reyon Eşleşmesi', message: 'Ürün-reyon eşleşmesi güncellendi.' });
      closeMatchEditModal();
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Reyon Eşleşmesi', message: error.message || 'Reyon eşleşmesi güncellenemedi.' });
    } finally {
      setMatchEditSubmitting(false);
    }
  };

  const supplierProductTableRows = useMemo(() => {
    const productMap = new Map(products.map((item) => [String(item.id), item]));
    const supplierMap = new Map(suppliers.map((item) => [String(item.id), item]));

    return (supplierProducts || []).map((item) => {
      const product = productMap.get(String(item.productId || '')) || null;
      const supplier = supplierMap.get(String(item.supplierId || '')) || null;
      return {
        ...item,
        productName: item.productName || product?.name || '-',
        productSku: item.productSku || item.sku || product?.sku || '-',
        barcode: item.barcode || product?.barcode || '-',
        supplierName: item.supplierName || supplier?.name || '-',
        isActive: item.isActive !== false,
      };
    });
  }, [products, supplierProducts, suppliers]);

  const stockMap = useMemo(() => {
    const map = new Map();
    stocks.forEach((item) => {
      map.set(String(item.productId || ''), item);
    });
    return map;
  }, [stocks]);

  const groupedMatchesByProduct = useMemo(() => {
    const map = new Map();
    supplierProductTableRows.forEach((item) => {
      const key = String(item.productId || '');
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return map;
  }, [supplierProductTableRows]);

  const supplierMatchEditCandidates = useMemo(() => {
    const productId = String(supplierMatchEditForm.productId || '');
    if (!productId) return [];

    const product = products.find((item) => String(item.id) === productId) || null;
    const productCategory = String(productTaxonomyById.get(productId)?.mainCategory || product?.categoryName || '').trim();
    const group = groupedMatchesByProduct.get(productId) || [];
    const resolvedPrimary = pickPrimaryMatchCandidate(group);
    const supplierById = new Map(suppliers.map((item) => [String(item.id), item]));
    const candidateMap = new Map();

    group
      .map((item) => {
        const supplier = supplierById.get(String(item.supplierId || '')) || null;
        const deliveryDays = Number(item.leadTimeDays || 0);
        const itemSupplierId = String(item.supplierId || '');
        const resolvedPrimarySupplierId = String(resolvedPrimary?.supplierId || '');
        return [String(item.supplierId || ''), {
          id: item.id,
          supplierId: itemSupplierId,
          supplierName: supplier?.name || item.supplierName || '-',
          purchasePrice: Number(item.purchasePrice || 0),
          leadTimeDays: deliveryDays > 0 ? deliveryDays : 3,
          minimumOrderQty: Number(item.minimumOrderQty || 1),
          note: String(item.note || ''),
          isPrimary: itemSupplierId === resolvedPrimarySupplierId,
          isActive: item.isActive !== false,
          hasExistingMatch: true,
        }];
      })
      .forEach(([supplierId, entry]) => {
        if (!supplierId) return;
        candidateMap.set(supplierId, entry);
      });

    suppliers
      .filter((supplier) => supplier.isActive !== false)
      .forEach((supplier) => {
        const supplierId = String(supplier.id || '');
        if (!supplierId || candidateMap.has(supplierId)) return;

        const supplierCategoryInfo = supplierCategoryInfoById.get(supplierId) || { categories: [], isAllCategories: false };
        const isEligibleByCategory = !productCategory
          || supplierCategoryInfo.isAllCategories
          || supplierCategoryInfo.categories.includes(productCategory);

        if (!isEligibleByCategory) return;

        candidateMap.set(supplierId, {
          id: '',
          supplierId,
          supplierName: supplier.name || '-',
          purchasePrice: 0,
          leadTimeDays: Number(resolveSupplierLeadTimeDays(supplier) || 3),
          minimumOrderQty: Math.max(1, Number(supplier.minOrderCaseQty || 1)),
          note: '',
          isPrimary: false,
          isActive: true,
          hasExistingMatch: false,
        });
      });

    return Array.from(candidateMap.values())
      .filter((item) => item.supplierId)
      .sort((left, right) => {
        if (left.hasExistingMatch !== right.hasExistingMatch) {
          return left.hasExistingMatch ? -1 : 1;
        }
        const leftPrice = Number(left.purchasePrice || 0);
        const rightPrice = Number(right.purchasePrice || 0);
        if (leftPrice !== rightPrice) return leftPrice - rightPrice;
        return String(left.supplierName || '').localeCompare(String(right.supplierName || ''), 'tr');
      });
  }, [groupedMatchesByProduct, productTaxonomyById, products, supplierCategoryInfoById, supplierMatchEditForm.productId, suppliers]);

  useEffect(() => {
    if (matchEditType !== 'supplier') return;
    if (!supplierMatchEditCandidates.length) return;
    if (supplierMatchEditCandidates.some((item) => String(item.supplierId) === String(supplierMatchEditForm.supplierId))) return;

    setSupplierMatchEditForm((current) => ({
      ...current,
      supplierId: supplierMatchEditCandidates[0].supplierId,
    }));
  }, [matchEditType, supplierMatchEditCandidates, supplierMatchEditForm.supplierId]);

  const selectedSupplierMatchCandidate = useMemo(
    () => supplierMatchEditCandidates.find((item) => String(item.supplierId) === String(supplierMatchEditForm.supplierId)) || null,
    [supplierMatchEditCandidates, supplierMatchEditForm.supplierId]
  );

  useEffect(() => {
    if (matchEditType !== 'supplier' || !selectedSupplierMatchCandidate) return;

    setSupplierMatchEditForm((current) => {
      const next = {
        ...current,
        id: selectedSupplierMatchCandidate.id || current.id,
        purchasePrice: Number.isFinite(selectedSupplierMatchCandidate.purchasePrice) ?
           String(selectedSupplierMatchCandidate.purchasePrice)
          : current.purchasePrice,
        leadTimeDays: Number.isFinite(selectedSupplierMatchCandidate.leadTimeDays) ?
           String(selectedSupplierMatchCandidate.leadTimeDays)
          : current.leadTimeDays,
        minimumOrderQty: Number.isFinite(selectedSupplierMatchCandidate.minimumOrderQty) ?
           String(Math.max(1, selectedSupplierMatchCandidate.minimumOrderQty))
          : current.minimumOrderQty,
        note: selectedSupplierMatchCandidate.note || current.note,
      };

      if (
        next.id === current.id
        && next.purchasePrice === current.purchasePrice
        && next.leadTimeDays === current.leadTimeDays
        && next.minimumOrderQty === current.minimumOrderQty
        && next.note === current.note
      ) {
        return current;
      }

      return next;
    });
  }, [matchEditType, selectedSupplierMatchCandidate]);

  const selectedProductSummary = useMemo(() => {
    if (!selectedMatchProduct) {
      return {
        productName: '-',
        sku: '-',
        barcode: '-',
        brand: '-',
        category: '-',
        subCategory: '-',
        unit: '-',
        storageType: '-',
        unitsPerCase: '-',
        casesPerPallet: '-',
        primarySupplier: '-',
        defaultDepotLocation: '-',
        shelfCode: '-',
        totalStock: '-',
        nearestExpiry: '-',
        stockWarning: '-',
        averageDesi: '-',
      };
    }

    const productId = String(selectedMatchProduct.id || '');
    const taxonomy = productTaxonomyById.get(productId) || resolveProductTaxonomy(selectedMatchProduct);
    const supplierGroup = groupedMatchesByProduct.get(productId) || [];
    const primaryRow = pickPrimaryMatchCandidate(supplierGroup);
    const primarySupplier = primaryRow ?
       suppliers.find((item) => String(item.id) === String(primaryRow.supplierId))?.name || primaryRow.supplierName || '-'
      : '-';

    return {
      productName: selectedMatchProduct.name || '-',
      sku: selectedMatchProduct.sku || '-',
      barcode: selectedMatchProduct.barcode || '-',
      brand: selectedMatchProduct.brand || getBrandFromProductName(selectedMatchProduct.name),
      category: taxonomy.mainCategory || selectedMatchProduct.categoryName || '-',
      subCategory: taxonomy.subCategory || '-',
      unit: selectedMatchProduct.unit || '-',
      storageType: selectedMatchProduct.requiredStorageType || selectedMatchProduct.storageType || 'Ortam',
      unitsPerCase: formatNumber(selectedProductUnitsPerCase),
      casesPerPallet: formatNumber(selectedProductCasesPerPallet),
      primarySupplier,
      defaultDepotLocation: selectedMatchProduct.defaultWarehouseLocationCode || '-',
      shelfCode: selectedMatchProduct.shelfCode || selectedMatchProduct.defaultShelfLocationCode || '-',
      totalStock: formatNumber(Number(selectedMatchProduct.totalStock || selectedMatchProduct.currentStock || 0)),
      nearestExpiry: formatDate(selectedMatchProduct.nearestExpiry || selectedMatchProduct.expiryDate),
      stockWarning: selectedMatchProduct.stockWarning || '-',
      averageDesi: formatNumber(Number(selectedMatchProduct.averageDesi || selectedMatchProduct.desi || 0)),
    };
  }, [
    groupedMatchesByProduct,
    productTaxonomyById,
    selectedMatchProduct,
    selectedProductCasesPerPallet,
    selectedProductUnitsPerCase,
    suppliers,
  ]);

  const supplierMatchesTableRows = useMemo(() => {
    const search = normalizeSearchText(matchFilters.search);
    const supplierSearch = normalizeSearchText(matchFilters.supplierSearch);

    return products
      .map((product) => {
        const productId = String(product.id || '');
        const group = groupedMatchesByProduct.get(productId) || [];
        const taxonomy = productTaxonomyById.get(productId) || resolveProductTaxonomy(product);

        const defaultMatch = pickPrimaryMatchCandidate(group);

        const stock = stockMap.get(productId) || null;
        const warehouseStock = Number(stock?.warehouseStock || stock?.warehouseQuantity || 0);
        const shelfStock = Number(stock?.shelfStock || stock?.shelfQuantity || 0);
        const totalStock = Number(stock?.totalStock || stock?.quantity || (warehouseStock + shelfStock));

        const supplier = defaultMatch ? suppliers.find((item) => String(item.id) === String(defaultMatch.supplierId)) || null : null;
        const deliveryPerformance = getEffectiveDeliveryPerformance(supplier?.teslimatPerformansi);
        const marginRate = defaultMatch ? getMarginRate(product.salePrice, defaultMatch.purchasePrice) : null;
        const supplierScore = defaultMatch ?
           getSupplierScore({
            purchasePrice: defaultMatch.purchasePrice,
            leadTimeDays: defaultMatch.leadTimeDays,
            deliveryPerformance,
            productRows: group,
          })
          : null;

        const row = {
          id: productId,
          productId,
          productName: product.name || '-',
          productSku: product.sku || '-',
          barcode: product.barcode || '-',
          mainCategoryName: taxonomy.mainCategory || '-',
          subCategoryName: taxonomy.subCategory || '-',
          brand: getBrandFromProductName(product.name),
          supplierId: defaultMatch?.supplierId || '',
          supplierName: defaultMatch?.supplierName || '-',
          purchasePrice: defaultMatch ? Number(defaultMatch.purchasePrice || 0) : null,
          currency: defaultMatch?.currency || 'TRY',
          leadTimeDays: defaultMatch ? Number(defaultMatch.leadTimeDays || 0) : null,
          hasDefaultMatch: Boolean(defaultMatch),
          totalSupplierCount: group.length,
          alternativeSupplierCount: Math.max(0, group.length - (defaultMatch ? 1 : 0)),
          alternativeSupplierNames: group
            .filter((item) => !defaultMatch || String(item.supplierId) !== String(defaultMatch.supplierId))
            .map((item) => item.supplierName)
            .filter(Boolean)
            .slice(0, 3),
          isActive: product.isActive !== false,
          totalStock,
          marginRate,
          supplierScore,
          storageType: product.requiredStorageType || product.storageType || 'Ortam',
          teslimatPerformansi: defaultMatch ? `${deliveryPerformance}%` : '',
          gecikmeDurumu: supplier?.gecikmeDurumu || '',
          warehouseStock,
          warehouseMaxStock: Number(product.warehouseMaxStock || 0),
          shelfStock,
          shelfMaxStock: Number(product.maxShelfStock || product.shelfMaxStock || 0),
          nearestExpiry: product.nearestExpiry || product.fefoBatch?.skt || null,
          criticalStock: Number(product.criticalStock || 0),
        };

        const matchesSearch = !search || [row.productName, row.productSku, row.barcode, row.supplierName, row.mainCategoryName, row.subCategoryName].filter(Boolean).some((value) => includesNormalized(value, search));
        const matchesSupplier = !matchFilters.supplierId || String(row.supplierId) === String(matchFilters.supplierId);
        const matchesSupplierSearch = !supplierSearch || includesNormalized(row.supplierName, supplierSearch);
        const matchesActive = !matchFilters.isActive || String(row.isActive) === String(matchFilters.isActive);

        return (matchesSearch && matchesSupplier && matchesSupplierSearch && matchesActive) ? row : null;
      })
      .filter(Boolean);
  }, [groupedMatchesByProduct, matchFilters, productTaxonomyById, products, stockMap, suppliers]);

  const matchAnalytics = useMemo(() => {
    const rows = supplierMatchesTableRows;
    const totalProducts = rows.length;
    const matchedProducts = rows.filter((item) => item.hasDefaultMatch).length;
    const activeMatches = rows.filter((item) => item.hasDefaultMatch && item.isActive).length;
    const avgPurchasePrice = matchedProducts ?
       rows.filter((item) => item.purchasePrice != null).reduce((sum, item) => sum + Number(item.purchasePrice || 0), 0) / matchedProducts
      : 0;
    const avgLeadTime = matchedProducts ?
       rows.filter((item) => item.leadTimeDays != null).reduce((sum, item) => sum + Number(item.leadTimeDays || 0), 0) / matchedProducts
      : 0;
    const avgSupplierScore = matchedProducts ?
       rows.filter((item) => item.supplierScore != null).reduce((sum, item) => sum + Number(item.supplierScore || 0), 0) / matchedProducts
      : 0;
    const coverage = totalProducts ? (matchedProducts / totalProducts) * 100 : 0;
    const sparkline = rows
      .filter((item) => item.purchasePrice != null)
      .slice(0, 30)
      .map((item) => Number(item.purchasePrice || 0));

    return {
      totalProducts,
      matchedProducts,
      activeMatches,
      avgPurchasePrice,
      avgLeadTime,
      avgSupplierScore,
      coverage,
      sparkline,
    };
  }, [supplierMatchesTableRows]);

  const productBatchRows = useMemo(() => {
    const stockByProductId = new Map(
      (stocks || []).map((item) => [String(item.productId || item.id || ''), item])
    );

    return products
      .flatMap((product) => {
        const taxonomy = productTaxonomyById.get(String(product.id)) || resolveProductTaxonomy(product);
        const stockRow = stockByProductId.get(String(product.id || '')) || null;
        const normalizedBatches = Array.isArray(stockRow?.batches) ? stockRow.batches : [];
        const batchByNo = new Map();

        normalizedBatches.forEach((batch, index) => {
          const rawBatchNo = String(batch.batchNo || batch.partiNo || batch.lotNo || '').trim();
          if (!rawBatchNo) return;
          const batchKey = rawBatchNo.toLocaleLowerCase('tr-TR');
          const expiry = resolveBatchExpiryDate(batch);
          const warehouseQuantity = Number(batch.warehouseQuantity || 0);
          const shelfQuantity = Number(batch.shelfQuantity || 0);
          const totalQuantity = Number(batch.totalQuantity ?? batch.quantity ?? batch.qtyBalance ?? (warehouseQuantity + shelfQuantity) ?? 0);
          const createdAt = getLatestClampedDate(stockRow?.updatedAt, product.createdAt);
          const updatedAt = getLatestClampedDate(stockRow?.updatedAt, product.updatedAt, product.createdAt);
          const expiryStatus = resolveExpiryStatus(expiry.value);
          const location = formatMatchLocationParts([
            product.depotLocationDisplay || product.depotLocationCode || product.defaultWarehouseLocationCode,
            product.sectionName,
          ]);
          const normalizedRow = {
            id: String(batch.id || `${product.id}-${rawBatchNo}`),
            batchId: batch.id || null,
            productId: product.id,
            productName: product.name || '-',
            productSku: product.sku || '-',
            sku: product.sku || '-',
            barcode: product.barcode || '-',
            mainCategoryName: taxonomy.mainCategory || '-',
            subCategoryName: taxonomy.subCategory || '-',
            batchNo: rawBatchNo,
            partiNo: rawBatchNo,
            type: batch.type || 'product_batch_expiry',
            skt: expiry.value,
            expiryDate: expiry.value,
            sktSource: expiry.source,
            location,
            locationContext: location,
            totalQuantity,
            quantity: totalQuantity,
            warehouseQuantity,
            shelfQuantity,
            expiryStatus,
            status: expiryStatus,
            createdAt,
            updatedAt,
            note: String(batch.note || ''),
            isFallbackBatch: false,
            sourceIndex: index,
          };
          const previous = batchByNo.get(batchKey);
          if (!previous) {
            batchByNo.set(batchKey, normalizedRow);
            return;
          }

          const previousSktTime = new Date(previous.skt || '9999-12-31').getTime();
          const currentSktTime = new Date(normalizedRow.skt || '9999-12-31').getTime();
          const chosenSkt = currentSktTime < previousSktTime ? normalizedRow.skt : previous.skt;
          batchByNo.set(batchKey, {
            ...previous,
            skt: chosenSkt,
            expiryDate: chosenSkt,
            expiryStatus: chosenSkt ? resolveExpiryStatus(chosenSkt) : 'unknown',
            status: chosenSkt ? resolveExpiryStatus(chosenSkt) : 'unknown',
            totalQuantity: Number(previous.totalQuantity || 0) + Number(normalizedRow.totalQuantity || 0),
            quantity: Number(previous.quantity || 0) + Number(normalizedRow.quantity || 0),
            warehouseQuantity: Number(previous.warehouseQuantity || 0) + Number(normalizedRow.warehouseQuantity || 0),
            shelfQuantity: Number(previous.shelfQuantity || 0) + Number(normalizedRow.shelfQuantity || 0),
            updatedAt: getLatestClampedDate(previous.updatedAt, normalizedRow.updatedAt),
            isDuplicateCollapsed: true,
          });
        });

        return Array.from(batchByNo.values());
      })
      .sort((left, right) => {
        const leftTime = left.skt ? new Date(left.skt).getTime() : Number.POSITIVE_INFINITY;
        const rightTime = right.skt ? new Date(right.skt).getTime() : Number.POSITIVE_INFINITY;
        return leftTime - rightTime;
      });
  }, [productTaxonomyById, products, stocks]);

  const filteredBatchRows = useMemo(() => {
    const search = normalizeSearchText(batchFilters.search);
    return productBatchRows.filter((row) => {
      const matchesSearch = !search
        || [row.productName, row.productSku, row.barcode, row.batchNo].filter(Boolean).some((value) => includesNormalized(value, search));
      const matchesStatus = !batchFilters.expiryStatus || row.expiryStatus === batchFilters.expiryStatus;
      return matchesSearch && matchesStatus;
    });
  }, [batchFilters, productBatchRows]);

  const filteredBatchExpiryRows = useMemo(() => {
    const search = normalizeSearchText(batchExpiryFilters.search);
    const batchSearch = normalizeSearchText(batchExpiryFilters.batchNo);
    const startDate = toDateOnly(batchExpiryFilters.startDate);
    const endDate = toDateOnly(batchExpiryFilters.endDate);

    return productBatchRows.filter((row) => {
      const matchesSearch = !search
        || [row.productName, row.productSku, row.sku, row.barcode].filter(Boolean).some((value) => includesNormalized(value, search));
      const matchesBatch = !batchSearch || includesNormalized(row.batchNo, batchSearch);
      const rowSkt = toDateOnly(row.skt);
      const matchesStart = !startDate || (rowSkt && rowSkt >= startDate);
      const matchesEnd = !endDate || (rowSkt && rowSkt <= endDate);
      const matchesStatus = !batchExpiryFilters.expiryStatus || row.expiryStatus === batchExpiryFilters.expiryStatus;
      const matchesUpcoming = !batchExpiryFilters.onlyUpcoming || ['critical', 'warning'].includes(row.expiryStatus);
      const matchesExpired = !batchExpiryFilters.onlyExpired || row.expiryStatus === 'expired';
      return matchesSearch && matchesBatch && matchesStart && matchesEnd && matchesStatus && matchesUpcoming && matchesExpired;
    });
  }, [batchExpiryFilters, productBatchRows]);

  const depotMatchRows = useMemo(() => {
    return products
      .flatMap((product) => {
        const taxonomy = productTaxonomyById.get(String(product.id)) || resolveProductTaxonomy(product);
        const locations = Array.isArray(product.depotLocations) ? product.depotLocations : [];
        const normalizedLocations = locations.length > 0 ?
           locations
          : product.defaultWarehouseLocationCode ?
             [{
              locationCode: product.defaultWarehouseLocationCode,
              storageType: product.requiredStorageType || product.storageType || 'Ortam',
              status: 'Aktif',
              palletCount: 0,
              warehouseStock: Number(product.warehouseStock || 0),
              batchNo: null,
            }]
            : [];

        return normalizedLocations.map((location, index) => ({
          id: `${product.id}-${String(location.locationCode || index)}`,
          productId: product.id,
          productName: product.name || '-',
          productSku: product.sku || '-',
          barcode: product.barcode || '-',
          mainCategoryName: taxonomy.mainCategory || '-',
          subCategoryName: taxonomy.subCategory || '-',
          locationCode: location.locationCode || '-',
          storageType: location.storageType || product.requiredStorageType || 'Ortam',
          status: location.status || 'Tanımsız',
          warehouseStock: Number(location.warehouseStock || 0),
          warehouseMaxStock: Number(product.warehouseMaxStock || 0),
          criticalStock: Number(product.criticalStock || 0),
          palletCount: Number(location.palletCount || 0),
          batchNo: location.batchNo || location.batchDisplay || '-',
        }));
      })
      .sort((left, right) => String(left.locationCode || '').localeCompare(String(right.locationCode || ''), 'tr'));
  }, [productTaxonomyById, products]);

  const filteredDepotRows = useMemo(() => {
    const search = normalizeSearchText(depotFilters.search);
    return depotMatchRows.filter((row) => {
      const matchesSearch = !search
        || [row.productName, row.productSku, row.barcode, row.locationCode, row.batchNo].filter(Boolean).some((value) => includesNormalized(value, search));
      const matchesStorage = !depotFilters.storageType || row.storageType === depotFilters.storageType;
      return matchesSearch && matchesStorage;
    });
  }, [depotFilters, depotMatchRows]);

  const generatedReyonShelfCode = useMemo(() => {
    const section = sectionById.get(String(reyonMatchForm.sectionId || '')) || null;
    return buildReyonShelfCode({
      sectionNo: section?.number,
      shelfSide: reyonMatchForm.shelfSide,
      shelfNo: reyonMatchForm.shelfNo,
      shelfLevel: reyonMatchForm.shelfLevel,
    });
  }, [reyonMatchForm.sectionId, reyonMatchForm.shelfLevel, reyonMatchForm.shelfNo, reyonMatchForm.shelfSide, sectionById]);

  const reyonMatchRows = useMemo(() => {
    return products
      .map((product) => {
        const productId = String(product.id || '');
        const taxonomy = productTaxonomyById.get(productId) || resolveProductTaxonomy(product);
        const section = sectionById.get(String(product.sectionId || '')) || null;
        const shelfSide = String(product.shelfSide || '').trim();
        const shelfNo = String(product.shelfNo || '').trim();
        const shelfLevel = String(product.shelfLevel || '').trim();
        const shelfCode = product.shelfCode
          || product.defaultShelfLocationCode
          || (section && shelfSide && shelfNo && shelfLevel ? `${section.number}${shelfSide}${shelfNo}-${shelfLevel}` : '-');

        const shelfStock = Number(product.shelfStock || 0);
        const shelfCapacity = Number(product.maxShelfStock || product.shelfMaxStock || 0);

        return {
          id: productId,
          productId,
          productName: product.name || '-',
          productSku: product.sku || '-',
          barcode: product.barcode || '-',
          mainCategoryName: taxonomy.mainCategory || '-',
          sectionId: product.sectionId || '',
          sectionName: section?.name || '-',
          sectionNo: section?.number || '-',
          shelfSide,
          shelfNo,
          shelfLevel,
          shelfCode,
          shelfStock,
          shelfCapacity,
          isActive: product.isActive !== false,
        };
      })
      .sort((left, right) => String(left.productName || '').localeCompare(String(right.productName || ''), 'tr'));
  }, [productTaxonomyById, products, sectionById]);

  const filteredReyonRows = useMemo(() => {
    const search = normalizeSearchText(reyonFilters.search);
    return reyonMatchRows.filter((row) => {
      const matchesSearch = !search
        || [row.productName, row.barcode, row.mainCategoryName, row.sectionName, row.sectionNo, row.shelfCode]
          .filter(Boolean)
          .some((value) => includesNormalized(value, search));
      return matchesSearch;
    });
  }, [reyonFilters, reyonMatchRows]);

  const batchAnalytics = useMemo(() => {
    const rows = filteredBatchRows;
    const totalRows = rows.length;
    const uniqueProducts = new Set(rows.map((item) => String(item.productId || '')).filter(Boolean)).size;
    const totalQuantity = rows.reduce((sum, item) => sum + Number(item.totalQuantity || 0), 0);
    const warehouseQuantity = rows.reduce((sum, item) => sum + Number(item.warehouseQuantity || 0), 0);
    const shelfQuantity = rows.reduce((sum, item) => sum + Number(item.shelfQuantity || 0), 0);

    const statusCounts = {
      expired: 0,
      critical: 0,
      warning: 0,
      normal: 0,
      unknown: 0,
    };

    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const remainingDays = [];
    let nearestExpiryDate = null;

    rows.forEach((item) => {
      const statusKey = Object.prototype.hasOwnProperty.call(statusCounts, item.expiryStatus) ? item.expiryStatus : 'unknown';
      statusCounts[statusKey] += 1;

      if (!item.skt) return;
      const date = new Date(item.skt);
      if (Number.isNaN(date.getTime())) return;

      if (!nearestExpiryDate || date.getTime() < nearestExpiryDate.getTime()) {
        nearestExpiryDate = date;
      }

      const expiryStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      remainingDays.push(Math.floor((expiryStart - todayStart) / MS_PER_DAY));
    });

    const avgRemainingDays = remainingDays.length ?
       remainingDays.reduce((sum, day) => sum + day, 0) / remainingDays.length
      : null;

    const riskCount = statusCounts.expired + statusCounts.critical;
    const riskRate = totalRows ? (riskCount / totalRows) * 100 : 0;
    const warehouseShare = totalQuantity ? (warehouseQuantity / totalQuantity) * 100 : 0;

    const categoryCounter = new Map();
    rows.forEach((item) => {
      const key = item.mainCategoryName || '-';
      categoryCounter.set(key, (categoryCounter.get(key) || 0) + 1);
    });
    const topCategories = Array.from(categoryCounter.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));

    const quantitySparkline = rows
      .slice()
      .sort((left, right) => {
        const leftTime = left.skt ? new Date(left.skt).getTime() : Number.POSITIVE_INFINITY;
        const rightTime = right.skt ? new Date(right.skt).getTime() : Number.POSITIVE_INFINITY;
        return leftTime - rightTime;
      })
      .slice(0, 30)
      .map((item) => Number(item.totalQuantity || 0));

    return {
      totalRows,
      uniqueProducts,
      totalQuantity,
      warehouseQuantity,
      shelfQuantity,
      warehouseShare,
      statusCounts,
      avgRemainingDays,
      nearestExpiryDate,
      riskCount,
      riskRate,
      topCategories,
      quantitySparkline,
    };
  }, [filteredBatchRows]);

  const batchExpiryAnalytics = useMemo(() => {
    const rows = filteredBatchExpiryRows;
    const statusCounts = rows.reduce((acc, item) => {
      const key = Object.prototype.hasOwnProperty.call(acc, item.expiryStatus) ? item.expiryStatus : 'unknown';
      acc[key] += 1;
      return acc;
    }, { expired: 0, critical: 0, warning: 0, normal: 0, unknown: 0 });

    return {
      totalRows: rows.length,
      uniqueProducts: new Set(rows.map((item) => String(item.productId || '')).filter(Boolean)).size,
      expiredCount: statusCounts.expired,
      upcomingCount: statusCounts.critical + statusCounts.warning,
      normalCount: statusCounts.normal,
      fallbackCount: rows.filter((item) => item.isFallbackBatch).length,
      statusCounts,
    };
  }, [filteredBatchExpiryRows]);

  const depotAnalytics = useMemo(() => {
    const rows = filteredDepotRows;
    const totalRows = rows.length;
    const uniqueProducts = new Set(rows.map((item) => String(item.productId || '')).filter(Boolean)).size;
    const totalStock = rows.reduce((sum, item) => sum + Number(item.warehouseStock || 0), 0);
    const totalPallet = rows.reduce((sum, item) => sum + Number(item.palletCount || 0), 0);
    const totalCapacity = rows.reduce((sum, item) => {
      const capacity = Number(item.warehouseMaxStock || 0);
      return capacity > 0 ? sum + capacity : sum;
    }, 0);
    const fillRate = totalCapacity ? (totalStock / totalCapacity) * 100 : 0;

    let activeCount = 0;
    let passiveCount = 0;
    const storageCounter = new Map();
    const categoryStockCounter = new Map();
    let criticalStockCount = 0;

    rows.forEach((item) => {
      const statusText = String(item.status || '').toLowerCase('tr-TR');
      if (statusText.includes('aktif')) activeCount += 1;
      if (statusText.includes('pasif')) passiveCount += 1;

      const storageKey = item.storageType || '-';
      storageCounter.set(storageKey, (storageCounter.get(storageKey) || 0) + 1);

      const categoryKey = item.mainCategoryName || '-';
      categoryStockCounter.set(categoryKey, (categoryStockCounter.get(categoryKey) || 0) + Number(item.warehouseStock || 0));

      const criticalStock = Number(item.criticalStock || 0);
      if (criticalStock > 0 && Number(item.warehouseStock || 0) <= criticalStock) {
        criticalStockCount += 1;
      }
    });

    const topStorageTypes = Array.from(storageCounter.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([name, count]) => ({ name, count }));

    const topCategoryStocks = Array.from(categoryStockCounter.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([name, stock]) => ({ name, stock }));

    const stockSparkline = rows
      .slice()
      .sort((left, right) => Number(right.warehouseStock || 0) - Number(left.warehouseStock || 0))
      .slice(0, 30)
      .map((item) => Number(item.warehouseStock || 0));

    return {
      totalRows,
      uniqueProducts,
      totalStock,
      totalPallet,
      totalCapacity,
      fillRate,
      activeCount,
      passiveCount,
      criticalStockCount,
      topStorageTypes,
      topCategoryStocks,
      stockSparkline,
    };
  }, [filteredDepotRows]);

  const recentSupplierMatchRows = useMemo(
    () => supplierProductTableRows
      .slice()
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
        return rightTime - leftTime;
      })
      .slice(0, 8),
    [supplierProductTableRows]
  );

  const upcomingBatchRows = useMemo(
    () => productBatchRows.filter((row) => row.skt).slice(0, 8),
    [productBatchRows]
  );

  const matchHomeSummary = useMemo(() => {
    const supplierMatchCount = supplierProductTableRows.length;
    const batchMatchCount = productBatchRows.length;
    const depotMatchCount = depotMatchRows.length;
    const reyonMatchCount = reyonMatchRows.length;
    const total = supplierMatchCount + batchMatchCount + depotMatchCount + reyonMatchCount;
    const coveredProducts = new Set([
      ...supplierProductTableRows.map((item) => String(item.productId || '')),
      ...productBatchRows.map((item) => String(item.productId || '')),
      ...depotMatchRows.map((item) => String(item.productId || '')),
      ...reyonMatchRows.map((item) => String(item.productId || '')),
    ].filter(Boolean));

    return {
      total,
      supplierMatchCount,
      batchMatchCount,
      depotMatchCount,
      reyonMatchCount,
      coveredProducts: coveredProducts.size,
    };
  }, [depotMatchRows, productBatchRows, reyonMatchRows, supplierProductTableRows]);

  const depotStorageTypeOptions = useMemo(
    () => [...new Set(depotMatchRows.map((row) => row.storageType).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr')),
    [depotMatchRows]
  );

  const activeSectionOptions = useMemo(
    () => sections.filter((item) => item.isActive !== false),
    [sections]
  );

  const supplierProductColumns = [
    { key: 'productSku', label: 'SKU' },
    { key: 'productName', label: 'Ürün' },
    { key: 'mainCategoryName', label: 'Kategori' },
    { key: 'subCategoryName', label: 'Alt Kategori', render: (row) => row.subCategoryName || '-' },
    {
      key: 'supplierName',
      label: 'Ana Tedarikçi',
      render: (row) => <span className={row.hasDefaultMatch ? '' : 'muted-text'}>{row.hasDefaultMatch ? row.supplierName : 'Varsayılan eşleşme yok'}</span>,
    },
    {
      key: 'storageType',
      label: 'Saklama Tipi',
      render: (row) => row.storageType || '-',
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
      className: 'sup-col-actions',
      sortable: false,
      render: (row) => (
        <div className="table-actions">
          <button className="text-button" type="button" onClick={() => openSupplierMatchEdit(row)}>Düzenle</button>
        </div>
      ),
    },
  ];

  const batchColumns = [
    { key: 'batchNo', label: 'Parti No' },
    { key: 'productName', label: 'Ürün' },
    { key: 'barcode', label: 'Barkod' },
    { key: 'mainCategoryName', label: 'Kategori' },
    { key: 'subCategoryName', label: 'Alt Kategori', render: (row) => row.subCategoryName || '-' },
    { key: 'skt', label: 'Parti SKT', render: (row) => row.skt ? formatDate(row.skt) : 'SKT yok' },
    { key: 'totalQuantity', label: 'Parti Toplam Stok', render: (row) => formatNumber(row.totalQuantity || 0), sortValue: (row) => Number(row.totalQuantity || 0) },
    {
      key: 'expiryStatus',
      label: 'Parti Durumu',
      render: (row) => {
        return <StatusBadge tone={getExpiryStatusTone(row.expiryStatus)}>{getExpiryStatusLabel(row.expiryStatus)}</StatusBadge>;
      },
    },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      render: (row) => (
        <div className="table-actions">
          <button className="text-button" type="button" onClick={() => openBatchMatchEdit(row)}>Düzenle</button>
        </div>
      ),
    },
  ];

  const batchExpiryColumns = [
    { key: 'sku', label: 'SKU', render: (row) => row.sku || row.productSku || '-' },
    { key: 'barcode', label: 'Barkod' },
    { key: 'productName', label: 'Ürün' },
    { key: 'batchNo', label: 'Parti No' },
    { key: 'skt', label: 'SKT', render: (row) => row.skt ? formatDate(row.skt) : 'SKT yok', sortValue: (row) => new Date(row.skt || '9999-12-31').getTime() },
    { key: 'location', label: 'Lokasyon', render: (row) => row.location || row.locationContext || '-' },
    {
      key: 'expiryStatus',
      label: 'SKT Durumu',
      render: (row) => <StatusBadge tone={getExpiryStatusTone(row.expiryStatus)}>{getExpiryStatusLabel(row.expiryStatus)}</StatusBadge>,
    },
    {
      key: 'totalQuantity',
      label: 'Stok / Miktar',
      render: (row) => formatNumber(row.totalQuantity || row.quantity || 0),
      sortValue: (row) => Number(row.totalQuantity || row.quantity || 0),
    },
    {
      key: 'updatedAt',
      label: 'Son İşlem Tarihi',
      render: (row) => formatDate(row.updatedAt || row.createdAt),
      sortValue: (row) => new Date(row.updatedAt || row.createdAt || 0).getTime(),
    },
    {
      key: 'actions',
      label: 'İşlem',
      sortable: false,
      render: (row) => (
        <div className="table-actions">
          <button className="text-button" type="button" onClick={() => openBatchMatchEdit(row)}>Düzenle</button>
        </div>
      ),
    },
  ];

  const depotColumns = [
    { key: 'productSku', label: 'SKU' },
    { key: 'barcode', label: 'Barkod' },
    { key: 'productName', label: 'Ürün' },
    { key: 'mainCategoryName', label: 'Kategori' },
    { key: 'locationCode', label: 'Depo Lokasyon Kodu' },
    { key: 'storageType', label: 'Saklama Tipi' },
    {
      key: 'warehouseStock',
      label: 'Depo Stok',
      sortValue: (row) => Number(row.warehouseStock || 0),
      render: (row) => formatNumber(row.warehouseStock || 0),
    },
    { key: 'status', label: 'Depo Lokasyon Durumu', render: (row) => <StatusBadge tone="neutral">{row.status || '-'}</StatusBadge> },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      render: (row) => (
        <div className="table-actions">
          <button className="text-button" type="button" onClick={() => openDepotMatchEdit(row)}>Düzenle</button>
        </div>
      ),
    },
  ];

  const reyonColumns = [
    { key: 'productName', label: 'Ürün' },
    { key: 'barcode', label: 'Barkod' },
    { key: 'mainCategoryName', label: 'Kategori' },
    { key: 'sectionName', label: 'Bağlı Reyon', render: (row) => `${row.sectionNo || '-'} - ${row.sectionName || '-'}` },
    { key: 'shelfCode', label: 'Reyon Kodu / Lokasyon', render: (row) => row.shelfCode || '-' },
    { key: 'shelfStock', label: 'Reyon Stok', render: (row) => formatNumber(row.shelfStock || 0), sortValue: (row) => Number(row.shelfStock || 0) },
    { key: 'shelfCapacity', label: 'Reyon Kapasitesi', render: (row) => formatNumber(row.shelfCapacity || 0), sortValue: (row) => Number(row.shelfCapacity || 0) },
    { key: 'status', label: 'Durum', render: (row) => <StatusBadge tone={row.isActive ? 'success' : 'danger'}>{row.isActive ? 'Aktif' : 'Pasif'}</StatusBadge> },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      render: (row) => (
        <div className="table-actions">
          <button className="text-button" type="button" onClick={() => openReyonMatchEdit(row)}>Düzenle</button>
        </div>
      ),
    },
  ];

  const recentSupplierMatchColumns = [
    { key: 'productName', label: 'Ürün' },
    { key: 'supplierName', label: 'Tedarikçi' },
    { key: 'purchasePrice', label: 'Alış Fiyatı', render: (row) => formatCurrency(Number(row.purchasePrice || 0), row.currency || 'TRY') },
    { key: 'updatedAt', label: 'Son Güncelleme', render: (row) => formatDate(row.updatedAt || row.createdAt) },
  ];

  const upcomingBatchColumns = [
    { key: 'productName', label: 'Ürün' },
    { key: 'batchNo', label: 'Parti No' },
    { key: 'skt', label: 'SKT', render: (row) => row.skt ? formatDate(row.skt) : 'SKT yok' },
    { key: 'totalQuantity', label: 'Miktar', render: (row) => formatNumber(row.totalQuantity || 0) },
  ];

  const matchHomeRecentChangesRows = useMemo(() => {
    const supplierRows = supplierProductTableRows.map((row) => ({
      id: `supplier-${row.id}`,
      changeType: 'Ürün-Tedarikçi',
      productName: row.productName,
      detail: row.supplierName || '-',
      status: row.isActive ? 'Aktif' : 'Pasif',
      changedAt: clampChangeDate(row.updatedAt || row.createdAt),
    }));

    const batchRows = productBatchRows.map((row) => ({
      id: `batch-${row.id}`,
      changeType: 'Parti No-SKT',
      productName: row.productName,
      detail: `${row.batchNo || '-'} / SKT ${row.skt ? formatDate(row.skt) : 'SKT yok'}`,
      status: getExpiryStatusLabel(row.expiryStatus),
      changedAt: clampChangeDate(row.updatedAt || row.createdAt),
    }));

    const depotRows = depotMatchRows.map((row) => ({
      id: `depot-${row.id}`,
      changeType: 'Ürün-Depo',
      productName: row.productName,
      detail: row.locationCode || '-',
      status: row.status || '-',
      changedAt: clampChangeDate(row.updatedAt || row.createdAt),
    }));

    const reyonRows = reyonMatchRows.map((row) => ({
      id: `reyon-${row.id}`,
      changeType: 'Ürün-Reyon',
      productName: row.productName,
      detail: row.shelfCode || '-',
      status: row.isActive ? 'Aktif' : 'Pasif',
      changedAt: clampChangeDate(row.updatedAt || row.createdAt),
    }));

    return [...supplierRows, ...batchRows, ...depotRows, ...reyonRows]
      .slice()
      .sort((left, right) => new Date(right.changedAt || 0).getTime() - new Date(left.changedAt || 0).getTime());
  }, [depotMatchRows, productBatchRows, reyonMatchRows, supplierProductTableRows]);

  const matchHomeRecentChangesColumns = [
    { key: 'changeType', label: 'Eşleşme Türü' },
    { key: 'productName', label: 'Ürün' },
    { key: 'detail', label: 'Detay' },
    { key: 'status', label: 'Durum', render: (row) => <StatusBadge tone={String(row.status).toLocaleLowerCase('tr-TR').includes('aktif') ? 'success' : 'neutral'}>{row.status || '-'}</StatusBadge> },
    { key: 'changedAt', label: 'Değişiklik Tarihi', render: (row) => formatDate(row.changedAt) },
  ];

  /* Columns */
  const columns = [
    {
      key: 'name',
      label: 'Firma',
      className: 'sup-col-firma',
      render: (row) => (
        <span className="product-name-with-status" aria-label={row.isActive ? 'Aktif tedarikçi' : 'Pasif tedarikçi'}>
          <span className={`product-status-dot ${row.isActive ? 'active' : 'passive'}`} title={row.isActive ? 'Aktif tedarikçi' : 'Pasif tedarikçi'} aria-hidden="true" />
          <span className="supplier-name-text" title={row.name || '-'}>{row.name || '-'}</span>
        </span>
      ),
    },
    {
      key: 'id',
      label: 'Kod',
      className: 'sup-col-kod',
      render: (row) => <span className="muted-text">{row.supplierCode || row.id || '-'}</span>,
    },
    { key: 'tedarikciTuru', label: 'Tür', className: 'sup-col-tur', render: (row) => <span className="supplier-type-badge">{row.tedarikciTuru || '-'}</span> },
    {
      key: 'kategoriler',
      label: 'Ana Kategoriler',
      className: 'sup-col-kategoriler',
      render: (row) => {
        const info = getSupplierCategoryInfo(row);
        if (info.isAllCategories) {
          return (
            <div className="supplier-categories">
              <span className="supplier-cat-chip">Tüm Kategoriler</span>
            </div>
          );
        }

        if (info.categories.length > 0) {
          return (
            <div className="supplier-categories">
              {info.categories.map((cat) => (
                <span key={cat} className="supplier-cat-chip">{cat}</span>
              ))}
            </div>
          );
        }

        return row.kategoriler || '-';
      },
    },
    {
      key: 'primaryProductCount',
      label: 'Ana Ürün',
      className: 'sup-col-sayi',
      sortValue: (row) => Number(row.primaryProductCount || row.productCount || 0),
      render: (row) => <strong>{formatNumber(Number(row.primaryProductCount || row.productCount || 0))}</strong>,
    },
    {
      key: 'minOrderCaseQty',
      label: 'Minimum Sipariş',
      className: 'sup-col-min',
      sortValue: (row) => Number(row.minOrderCaseQty || 0),
      render: (row) => (row.minOrderCaseQty ? `${formatNumber(row.minOrderCaseQty)} koli` : '-'),
    },
    {
      key: 'averageLeadTime',
      label: 'Ortalama Temin Süresi',
      className: 'sup-col-temin',
      sortValue: (row) => Number(row.averageLeadTime || row.orderMetrics?.averageDeliveryDays || 0),
      render: (row) => formatDays(row.averageLeadTime || row.orderMetrics?.averageDeliveryDays),
    },
    {
      key: 'teslimatPerformansi',
      label: 'Teslimat',
      className: 'sup-col-teslimat',
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
      className: 'sup-col-gecikme',
      render: (row) => {
        if (!row.gecikmeDurumu) return '-';

        const value = row.gecikmeDurumu.toLowerCase();
        const tone = value === 'zamanında' || value === 'düşük' ? 'success' : value === 'orta' ? 'warning' : 'danger';

        return <StatusBadge tone={tone}>{row.gecikmeDurumu}</StatusBadge>;
      },
    },
    {
      key: 'actions',
      label: 'İşlemler',
      className: 'sup-col-actions',
      sortable: false,
      render: (row) =>
        isAdmin ? (
          <div className="table-actions">
            <button className="text-button" type="button" onClick={() => openEditModal(row)}>Düzenle</button>
            <button className="text-button danger" type="button" onClick={() => setDeleteTarget(row)}>Sil</button>
          </div>
        ) : (
          <span className="muted-text">Salt okunur</span>
        ),
    },
  ];

  return (
    <div className={`page-stack ${isMatchesModule ? 'matches-page' : 'suppliers-page'}`}>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageHeader
        className="dashboard-hero"
        icon={isMatchesModule ? <Link2 size={22} /> : <Truck size={22} />}
        title={isMatchesModule ? 'Eşleşmeler' : 'Tedarikçiler'}
        description={isMatchesModule ?
           'Ürün eşleşmelerini modüler yapı altında yönetin.'
          : 'Tedarikçileri ve firma bilgilerini yönetin.'}
        actions={
          isAdmin ? (
            <div className="suppliers-header-actions">
              {isMatchesModule ? (
                <button className="primary-button suppliers-header-btn supplier-match-create-btn" type="button" onClick={openCreateMatchModal}>
                  <Link2 size={16} /> Yeni Eşleşme Oluştur
                </button>
              ) : (
                <button className="primary-button suppliers-header-btn" type="button" onClick={openCreateModal}><Plus size={16} /> Yeni Tedarikçi</button>
              )}
            </div>
          ) : null
        }
      />

      {isMatchesModule ? (
        <section className="location-type-switch-wrap suppliers-list-toggle-wrap" aria-label="Eşleşme modülü görünüm seçimi">
          <span className="location-type-switch-label">Eşleşme Modülü</span>
          <div className="location-type-toggle location-type-toggle-hero" role="tablist" aria-label="Eşleşme modülü görünüm seçimi">
            <button
              type="button"
              role="tab"
              aria-selected={matchModuleTab === MATCH_MODULE_TABS.HOME}
              className={matchModuleTab === MATCH_MODULE_TABS.HOME ? 'active' : ''}
              onClick={() => setMatchModuleTab(MATCH_MODULE_TABS.HOME)}
            >
              <Award size={14} /> Ana Sayfa
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={matchModuleTab === MATCH_MODULE_TABS.PRODUCT_SUPPLIER}
              className={matchModuleTab === MATCH_MODULE_TABS.PRODUCT_SUPPLIER ? 'active' : ''}
              onClick={() => setMatchModuleTab(MATCH_MODULE_TABS.PRODUCT_SUPPLIER)}
            >
              <Link2 size={14} /> Ürün-Tedarikçi Eşleşmeleri
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={matchModuleTab === MATCH_MODULE_TABS.CATALOG_SUPPLIER}
              className={matchModuleTab === MATCH_MODULE_TABS.CATALOG_SUPPLIER ? 'active' : ''}
              onClick={() => setMatchModuleTab(MATCH_MODULE_TABS.CATALOG_SUPPLIER)}
            >
              <ShoppingCart size={14} /> Katalog-Tedarikçi Eşleşmesi
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={matchModuleTab === MATCH_MODULE_TABS.PRODUCT_BATCH}
              className={matchModuleTab === MATCH_MODULE_TABS.PRODUCT_BATCH ? 'active' : ''}
              onClick={() => setMatchModuleTab(MATCH_MODULE_TABS.PRODUCT_BATCH)}
            >
              <Clock size={14} /> Ürün-Parti Eşleşmeleri
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={matchModuleTab === MATCH_MODULE_TABS.PRODUCT_DEPOT}
              className={matchModuleTab === MATCH_MODULE_TABS.PRODUCT_DEPOT ? 'active' : ''}
              onClick={() => setMatchModuleTab(MATCH_MODULE_TABS.PRODUCT_DEPOT)}
            >
              <Truck size={14} /> Ürün-Depo Eşleşmeleri
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={matchModuleTab === MATCH_MODULE_TABS.PRODUCT_REYON}
              className={matchModuleTab === MATCH_MODULE_TABS.PRODUCT_REYON ? 'active' : ''}
              onClick={() => setMatchModuleTab(MATCH_MODULE_TABS.PRODUCT_REYON)}
            >
              <Zap size={14} /> Ürün-Reyon Eşleşmeleri
            </button>
          </div>
        </section>
      ) : null}

      {!isMatchesModule ? (
      <div className="supplier-perf-section">
        <div className="supplier-perf-layout">
          <div className="supplier-perf-column">
            <div className="supplier-perf-mini-card">
              <div className="supplier-perf-head">
                <div className="supplier-perf-icon mod-icon-blue"><Truck size={18} /></div>
                <div className="supplier-perf-label">Toplam Tedarikçi</div>
              </div>
              <div className="supplier-perf-value">{formatNumber(analytics.total)}</div>
              <div className="supplier-perf-sub">Sistemde kayıtlı firma</div>
            </div>

            <div className="supplier-perf-mini-card">
              <div className="supplier-perf-head">
                <div className="supplier-perf-icon mod-icon-emerald"><Clock size={18} /></div>
                <div className="supplier-perf-label">Düşük Gecikme</div>
              </div>
              <div className="supplier-perf-value">{formatNumber(analytics.lowDelay)}</div>
              <div className="supplier-perf-sub">Gecikmesi düşük firma</div>
            </div>
          </div>

          <div className="supplier-perf-column">
            <div className="supplier-perf-mini-card">
              <div className="supplier-perf-head">
                <div className="supplier-perf-icon mod-icon-cyan"><Zap size={18} /></div>
                <div className="supplier-perf-label">30 Gün Teslimat Trendi</div>
              </div>
              <div className="supplier-perf-value supplier-perf-value-inline">
                {analytics.deliveryRate30.toFixed(1)}%
                <span className={`supplier-trend-pill ${analytics.deliveryTrendPercent >= 0 ? 'is-up' : 'is-down'}`}>
                  {analytics.deliveryTrendPercent >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {formatSignedPercent(analytics.deliveryTrendPercent)}
                </span>
              </div>
              <Sparkline values={analytics.sparklineAggregate} ariaLabel="Son 30 gün teslimat performansı" />
              <div className="supplier-perf-sub">Önceki 30 güne göre değişim</div>
            </div>

            <div className="supplier-perf-column supplier-perf-column-tall">
              <div className="supplier-perf-mini-card supplier-perf-mini-card-tall">
                <div className="supplier-perf-head">
                  <div className="supplier-perf-icon mod-icon-amber"><Timer size={18} /></div>
                  <div className="supplier-perf-label">Teslimat Hızı ve Hacim</div>
                </div>
                <div className="supplier-insight-list">
                  <div className="supplier-insight-row">
                    <span>Ortalama teslim süresi</span>
                    <strong>{formatDays(analytics.deliveryDurationAvg)}</strong>
                  </div>
                  <div className="supplier-insight-row">
                    <span>Ortalama gecikme süresi</span>
                    <strong>{analytics.averageDelayDays.toFixed(2)} gün</strong>
                  </div>
                  <div className="supplier-insight-row">
                    <span>En yüksek teslimat</span>
                    <strong className="supplier-insight-strong-clip">{analytics.bestDelivery?.name || '-'}</strong>
                  </div>
                  <div className="supplier-insight-row">
                    <span>Toplam bağlı ürün</span>
                    <strong>{formatNumber(analytics.totalLinked)}</strong>
                  </div>
                  <div className="supplier-insight-row">
                    <span>Kategori dağılımı </span>
                    <strong>
                      {analytics.categoryDistribution.slice(0, 3).map(([category, count]) => `${category} (${count})`).join(', ') || '-'}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="supplier-perf-mini-card">
              <div className="supplier-perf-head">
                <div className="supplier-perf-icon mod-icon-indigo"><Award size={18} /></div>
                <div className="supplier-perf-label">En Çok Ürün Çeşidi</div>
              </div>
              <div className="supplier-perf-value supplier-perf-value-clip">{analytics.topSupplier?.name || '-'}</div>
              <div className="supplier-perf-sub">{formatNumber(analytics.topSupplier?.productCount || 0)} ürün çeşidi</div>
            </div>

          </div>

          <div className="supplier-perf-column">
            <div className="supplier-perf-mini-card">
              <div className="supplier-perf-head">
                <div className="supplier-perf-icon mod-icon-cyan"><Zap size={18} /></div>
                <div className="supplier-perf-label">Gecikme Trendi</div>
              </div>
              <div className="supplier-perf-value supplier-perf-value-inline">
                {analytics.delayRate30.toFixed(2)} gün
                <span className={`supplier-trend-pill ${analytics.delayTrendPercent <= 0 ? 'is-up' : 'is-down'}`}>
                  {analytics.delayTrendPercent <= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {formatSignedPercent(analytics.delayTrendPercent)}
                </span>
              </div>
              <div className="supplier-perf-sub">
                7 gün: {analytics.delayRate7.toFixed(2)} gün ({formatSignedPercent(analytics.delayTrendPercent7)})
              </div>
            </div>

            <div className="supplier-perf-mini-card">
              <div className="supplier-perf-head">
                <div className="supplier-perf-icon mod-icon-amber"><ShoppingCart size={18} /></div>
                <div className="supplier-perf-label">Sipariş / İşlem Özeti</div>
              </div>
              <div className="supplier-perf-value">{formatNumber(analytics.totalOrders)}</div>
              <div className="supplier-perf-sub">Toplam sipariş • Son 30 gün: {formatNumber(analytics.totalOrdersLast30)}</div>
              <div className="supplier-perf-sub">Son sipariş: {formatDate(analytics.lastOrderDate)}</div>
            </div>
          </div>

        </div>
      </div>
      ) : null}

      {!isMatchesModule ? (
        <>
          <div className="mod-card suppliers-filter-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-violet"><Filter size={18} /></div>
              <div><h3>Filtreler</h3><p>Tedarikçi listesini daraltın</p></div>
            </div>
            <FilterBar
              className="products-filter-bar-minimal suppliers-filter-bar-minimal"
              actions={(
                <>
                  <button className="primary-button" type="button" onClick={() => setFilters((current) => ({ ...current }))}>Filtrele</button>
                  <button className="ghost-button" type="button" onClick={() => setFilters(initialFilters)}>Temizle</button>
                </>
              )}
            >
              <label className="field-group">
                <span>Arama</span>
                <input value={filters.search} onChange={(e) => setFilters((c) => ({ ...c, search: e.target.value }))} placeholder="Firma veya kategori ara" />
              </label>
              <label className="field-group">
                <span>Tedarikçi Türü</span>
                <select value={filters.tedarikciTuru} onChange={(e) => setFilters((c) => ({ ...c, tedarikciTuru: e.target.value }))}>
                  <option value="">Tüm Türler</option>
                  {uniqueTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="field-group">
                <span>Kategori</span>
                <select value={filters.kategori} onChange={(e) => setFilters((c) => ({ ...c, kategori: e.target.value }))}>
                  <option value="">Tüm Kategoriler</option>
                  {uniqueCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field-group">
                <span>Gecikme Durumu</span>
                <select value={filters.gecikme} onChange={(e) => setFilters((c) => ({ ...c, gecikme: e.target.value }))}>
                  <option value="">Tüm Durumlar</option>
                  {uniqueGecikme.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </label>
            </FilterBar>
          </div>

          <div className="mod-card suppliers-list-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-blue"><Truck size={18} /></div>
              <div><h3>Tedarikçi Listesi</h3><p>Tüm tedarikçileri görüntüleyin ve yönetin</p></div>
            </div>
            <DataTable columns={columns} rows={filteredRows} isLoading={isLoading} emptyMessage="Tedarikçi kaydı bulunmuyor." initialSort={{ key: 'primaryProductCount', direction: 'desc' }} pageSize={10} />
          </div>
        </>
      ) : null}

      {isMatchesModule && matchModuleTab === MATCH_MODULE_TABS.HOME ? (
        <>
          <div className="supplier-perf-section">
            <div className="supplier-perf-layout supplier-perf-layout-matches">
              <div className="supplier-perf-column">
                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-blue"><Link2 size={18} /></div>
                    <div className="supplier-perf-label">Toplam Eşleşme</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(matchHomeSummary.total)}</div>
                  <div className="supplier-perf-sub">Modüldeki tüm eşleşme kayıtları</div>
                </div>
              </div>

              <div className="supplier-perf-column">
                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-cyan"><Link2 size={18} /></div>
                    <div className="supplier-perf-label">Ürün-Tedarikçi</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(matchHomeSummary.supplierMatchCount)}</div>
                  <div className="supplier-perf-sub">Aktif ürün-tedarikçi eşleşmeleri</div>
                </div>
              </div>

              <div className="supplier-perf-column">
                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-amber"><Clock size={18} /></div>
                    <div className="supplier-perf-label">Ürün-Parti</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(matchHomeSummary.batchMatchCount)}</div>
                  <div className="supplier-perf-sub">Parti kayıtlarıyla eşleşen ürünler</div>
                </div>

                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-indigo"><Truck size={18} /></div>
                    <div className="supplier-perf-label">Ürün-Depo</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(matchHomeSummary.depotMatchCount)}</div>
                  <div className="supplier-perf-sub">Depo lokasyonlarına bağlı eşleşmeler</div>
                </div>

                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-violet"><Zap size={18} /></div>
                    <div className="supplier-perf-label">Ürün-Reyon</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(matchHomeSummary.reyonMatchCount)}</div>
                  <div className="supplier-perf-sub">Reyon lokasyonuna bağlı eşleşmeler</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-cyan"><Clock size={18} /></div>
              <div><h3>Son Eşleşme Değişiklikleri</h3><p>Modüldeki son güncellenen eşleşme kayıtları</p></div>
            </div>
            <DataTable columns={matchHomeRecentChangesColumns} rows={matchHomeRecentChangesRows} isLoading={isLoading} emptyMessage="Değişiklik kaydı bulunmuyor." initialSort={{ key: 'changedAt', direction: 'desc' }} pageSize={10} />
          </div>
        </>
      ) : null}

      {isMatchesModule && matchModuleTab === MATCH_MODULE_TABS.PRODUCT_SUPPLIER ? (
        <>
          <div className="supplier-perf-section">
            <div className="supplier-perf-layout supplier-perf-layout-matches">
              <div className="supplier-perf-column">
                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-blue"><Link2 size={18} /></div>
                    <div className="supplier-perf-label">Toplam Ürün</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(matchAnalytics.totalProducts)}</div>
                  <div className="supplier-perf-sub">Tabloya yansıyan ürün adedi</div>
                </div>

                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-emerald"><Award size={18} /></div>
                    <div className="supplier-perf-label">Varsayılan Eşleşme</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(matchAnalytics.matchedProducts)}</div>
                  <div className="supplier-perf-sub">Kapsama: %{matchAnalytics.coverage.toFixed(1)}</div>
                </div>
              </div>

              <div className="supplier-perf-column">
                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-cyan"><ShoppingCart size={18} /></div>
                    <div className="supplier-perf-label">Ortalama Alış Fiyatı</div>
                  </div>
                  <div className="supplier-perf-value supplier-perf-value-inline">{formatCurrency(matchAnalytics.avgPurchasePrice || 0, 'TRY')}</div>
                  <Sparkline values={matchAnalytics.sparkline} ariaLabel="Eşleşmelerde alış fiyatı eğilimi" />
                  <div className="supplier-perf-sub">Seçili filtreye göre ortalama</div>
                </div>
              </div>

              <div className="supplier-perf-column">
                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-amber"><Clock size={18} /></div>
                    <div className="supplier-perf-label">Ortalama Temin Süresi</div>
                  </div>
                  <div className="supplier-perf-value">{formatDays(matchAnalytics.avgLeadTime)}</div>
                  <div className="supplier-perf-sub">Aktif varsayılan eşleşmelerde ortalama</div>
                </div>

                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-indigo"><Zap size={18} /></div>
                    <div className="supplier-perf-label">Ortalama Puan</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(matchAnalytics.avgSupplierScore || 0)} / 100</div>
                  <div className="supplier-perf-sub">Aktif eşleşme: {formatNumber(matchAnalytics.activeMatches)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-violet"><Filter size={18} /></div>
              <div><h3>Filtreler</h3><p>Ürün-tedarikçi eşleşmelerini daraltın</p></div>
            </div>
            <FilterBar
              className="products-filter-bar-minimal suppliers-filter-bar-minimal"
              actions={(
                <>
                  <button className="primary-button" type="button" onClick={() => setMatchFilters((current) => ({ ...current }))}>Filtrele</button>
                  <button className="ghost-button" type="button" onClick={() => setMatchFilters(initialMatchFilters)}>Temizle</button>
                </>
              )}
            >
              <label className="field-group"><span>Arama</span><input value={matchFilters.search} onChange={(event) => setMatchFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Ürün, SKU, barkod ara" /></label>
              <label className="field-group"><span>Tedarikçi</span><SearchableCombobox options={matchSupplierFilterOptions} value={matchFilters.supplierId} onChange={(selected) => setMatchFilters((current) => ({ ...current, supplierId: selected }))} placeholder="Tedarikçi ara ve seç" noResultsText="Eşleşen tedarikçi bulunamadı" ariaLabel="Tedarikçi filtresi" /></label>
              <label className="field-group"><span>Tedarikçi Arama</span><input value={matchFilters.supplierSearch} onChange={(event) => setMatchFilters((current) => ({ ...current, supplierSearch: event.target.value }))} placeholder="Tedarikçi adına göre ara" /></label>
              <label className="field-group"><span>Durum</span><select value={matchFilters.isActive} onChange={(event) => setMatchFilters((current) => ({ ...current, isActive: event.target.value }))}><option value="">Tümü</option><option value="true">Aktif</option><option value="false">Pasif</option></select></label>
            </FilterBar>
          </div>

          <div className="mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-cyan"><Link2 size={18} /></div>
              <div><h3>Ürün-Tedarikçi Eşleşmeleri</h3><p>Bu sekme ürün ve tedarikçi eşleşme listesini gösterir.</p></div>
            </div>
            <DataTable
              columns={supplierProductColumns}
              rows={supplierMatchesTableRows}
              isLoading={isLoading}
              emptyMessage="Ürün-tedarikçi eşleşmesi bulunmuyor."
              initialSort={{ key: 'productName', direction: 'asc' }}
              pageSize={10}
            />
          </div>
        </>
      ) : null}

      {isMatchesModule && matchModuleTab === MATCH_MODULE_TABS.CATALOG_SUPPLIER ? (
        <CatalogSupplierMatchingTab
          suppliers={suppliers}
          products={products}
          isAdmin={isAdmin}
          onDataRefresh={loadData}
        />
      ) : null}

      {isMatchesModule && matchModuleTab === MATCH_MODULE_TABS.PRODUCT_BATCH ? (
        <>
          <div className="supplier-perf-section">
            <div className="supplier-perf-layout supplier-perf-layout-matches">
              <div className="supplier-perf-column">
                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-amber"><Clock size={18} /></div>
                    <div className="supplier-perf-label">Toplam Parti Kaydı</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(batchAnalytics.totalRows)}</div>
                  <div className="supplier-perf-sub">Filtreye giren kayıt adedi</div>
                </div>

                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-indigo"><Award size={18} /></div>
                    <div className="supplier-perf-label">Kapsanan Ürün</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(batchAnalytics.uniqueProducts)}</div>
                  <div className="supplier-perf-sub">Farklı ürün sayısı</div>
                </div>
              </div>

              <div className="supplier-perf-column">
                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-emerald"><ShoppingCart size={18} /></div>
                    <div className="supplier-perf-label">Toplam Parti Stoğu</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(batchAnalytics.totalQuantity)}</div>
                  <div className="supplier-perf-sub">Depo %{batchAnalytics.warehouseShare.toFixed(1)} • Reyon %{(100 - batchAnalytics.warehouseShare).toFixed(1)}</div>
                </div>

                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-violet"><Link2 size={18} /></div>
                    <div className="supplier-perf-label">Kritik Parti</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(batchAnalytics.riskCount)}</div>
                  <div className="supplier-perf-sub">Süresi geçmiş + kritik seviyedeki kayıtlar</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-violet"><Filter size={18} /></div>
              <div><h3>Filtreler</h3><p>Ürün-parti eşleşmelerini daraltın</p></div>
            </div>
            <FilterBar
              className="products-filter-bar-minimal suppliers-filter-bar-minimal"
              actions={(
                <>
                  <button className="primary-button" type="button" onClick={() => setBatchFilters((current) => ({ ...current }))}>Filtrele</button>
                  <button className="ghost-button" type="button" onClick={() => setBatchFilters(initialBatchFilters)}>Temizle</button>
                </>
              )}
            >
              <label className="field-group">
                <span>Arama</span>
                <input value={batchFilters.search} onChange={(event) => setBatchFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Parti no, ürün veya barkod ara" />
              </label>
              <label className="field-group">
                <span>SKT Durumu</span>
                <select value={batchFilters.expiryStatus} onChange={(event) => setBatchFilters((current) => ({ ...current, expiryStatus: event.target.value }))}>
                  <option value="">Tümü</option>
                  <option value="expired">Süresi Geçmiş</option>
                  <option value="critical">Kritik</option>
                  <option value="warning">Yaklaşıyor</option>
                  <option value="normal">Normal</option>
                </select>
              </label>
            </FilterBar>
          </div>

          <div className="mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-amber"><Clock size={18} /></div>
              <div><h3>Ürün-Parti Eşleşmeleri</h3><p>Parti, SKT ve miktar odaklı görünüm</p></div>
            </div>
            <DataTable
              columns={batchColumns}
              rows={filteredBatchRows}
              isLoading={isLoading}
              emptyMessage="Ürün-parti eşleşmesi bulunmuyor."
              initialSort={{ key: 'skt', direction: 'asc' }}
              pageSize={10}
            />
          </div>
        </>
      ) : null}

      {isMatchesModule && matchModuleTab === MATCH_MODULE_TABS.PRODUCT_DEPOT ? (
        <>
          <div className="supplier-perf-section">
            <div className="supplier-perf-layout supplier-perf-layout-matches">
              <div className="supplier-perf-column">
                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-blue"><Truck size={18} /></div>
                    <div className="supplier-perf-label">Toplam Lokasyon</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(depotAnalytics.totalRows)}</div>
                  <div className="supplier-perf-sub">Filtreye giren ürün-depo eşleşmeleri</div>
                </div>

                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-indigo"><Award size={18} /></div>
                    <div className="supplier-perf-label">Kapsanan Ürün</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(depotAnalytics.uniqueProducts)}</div>
                  <div className="supplier-perf-sub">Lokasyon alanına dağılan ürün adedi</div>
                </div>
              </div>

              <div className="supplier-perf-column">
                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-emerald"><ShoppingCart size={18} /></div>
                    <div className="supplier-perf-label">Depo Stok Toplamı</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(depotAnalytics.totalStock)}</div>
                  <Sparkline values={depotAnalytics.stockSparkline} ariaLabel="Depo stok dağılım eğilimi" />
                  <div className="supplier-perf-sub">Lokasyon başına ortalama: {depotAnalytics.totalRows ? formatNumber(depotAnalytics.totalStock / depotAnalytics.totalRows) : '0'}</div>
                </div>
              </div>

              <div className="supplier-perf-column">
                <div className="supplier-perf-mini-card">
                  <div className="supplier-perf-head">
                    <div className="supplier-perf-icon mod-icon-cyan"><Link2 size={18} /></div>
                    <div className="supplier-perf-label">Toplam Palet</div>
                  </div>
                  <div className="supplier-perf-value">{formatNumber(depotAnalytics.totalPallet)}</div>
                  <div className="supplier-perf-sub">Kapasite doluluğu: %{depotAnalytics.fillRate.toFixed(1)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-violet"><Filter size={18} /></div>
              <div><h3>Filtreler</h3><p>Ürün-depo eşleşmelerini daraltın</p></div>
            </div>
            <FilterBar
              className="products-filter-bar-minimal suppliers-filter-bar-minimal"
              actions={(
                <>
                  <button className="primary-button" type="button" onClick={() => setDepotFilters((current) => ({ ...current }))}>Filtrele</button>
                  <button className="ghost-button" type="button" onClick={() => setDepotFilters(initialDepotFilters)}>Temizle</button>
                </>
              )}
            >
              <label className="field-group">
                <span>Arama</span>
                <input value={depotFilters.search} onChange={(event) => setDepotFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Ürün, barkod, lokasyon veya parti no ara" />
              </label>
              <label className="field-group">
                <span>Saklama Tipi</span>
                <select value={depotFilters.storageType} onChange={(event) => setDepotFilters((current) => ({ ...current, storageType: event.target.value }))}>
                  <option value="">Tümü</option>
                  {depotStorageTypeOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
            </FilterBar>
          </div>

          <div className="mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-blue"><Truck size={18} /></div>
              <div><h3>Ürün-Depo Eşleşmeleri</h3><p>Depo lokasyonu ve stok alanı bazlı eşleşme görünümü</p></div>
            </div>
            <DataTable
              columns={depotColumns}
              rows={filteredDepotRows}
              isLoading={isLoading}
              emptyMessage="Ürün-depo eşleşmesi bulunmuyor."
              initialSort={{ key: 'locationCode', direction: 'asc' }}
              pageSize={10}
            />
          </div>
        </>
      ) : null}

      {isMatchesModule && matchModuleTab === MATCH_MODULE_TABS.PRODUCT_REYON ? (
        <>
          <div className="mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-violet"><Filter size={18} /></div>
              <div><h3>Filtreler</h3><p>Ürün-reyon eşleşmelerini daraltın</p></div>
            </div>
            <FilterBar
              className="products-filter-bar-minimal suppliers-filter-bar-minimal"
              actions={(
                <>
                  <button className="primary-button" type="button" onClick={() => setReyonFilters((current) => ({ ...current }))}>Filtrele</button>
                  <button className="ghost-button" type="button" onClick={() => setReyonFilters(initialReyonFilters)}>Temizle</button>
                </>
              )}
            >
              <label className="field-group">
                <span>Arama</span>
                <input value={reyonFilters.search} onChange={(event) => setReyonFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Ürün, barkod, kategori, reyon veya kod ara" />
              </label>
            </FilterBar>
          </div>

          <div className="mod-card">
            <div className="mod-card-header">
              <div className="mod-card-icon mod-icon-violet"><Zap size={18} /></div>
              <div><h3>Ürün-Reyon Eşleşmeleri</h3><p>Reyon lokasyonu, stok ve kapasite görünümü</p></div>
            </div>
            <DataTable
              columns={reyonColumns}
              rows={filteredReyonRows}
              isLoading={isLoading}
              emptyMessage="Ürün-reyon eşleşmesi bulunmuyor."
              initialSort={{ key: 'productName', direction: 'asc' }}
              pageSize={10}
            />
          </div>
        </>
      ) : null}

      {/* Form Modal */}

      <FormModal
        isOpen={isModalOpen}
        title={editingItem ? 'Tedarikçi Düzenle' : 'Yeni Tedarikçi Ekle'}
        description={editingItem ? 'Seçili tedarikçi bilgilerini bu alandan güncelleyebilirsiniz.' : 'Bu kısımdan yeni tedarikçi ekleyebilirsiniz.'}
        headerIcon={editingItem ? <Truck size={17} /> : <Plus size={17} />}
        onClose={() => { setIsModalOpen(false); setEditingItem(null); }}
        modalClassName="supplier-form-fit-modal modal-header-standardized"
      >
        <form className="modal-form modal-structured-form" onSubmit={handleSubmit}>
          <div className="modal-form-body-scroll">
            <section className="modal-form-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">Firma Bilgisi</h4>
              </div>
              <div className="form-grid modal-form-grid supplier-grid-company">
                <label className="field-group"><span>Firma Adı<span className="modal-required">*</span></span><input autoFocus name="name" value={form.name} onChange={handleChange} placeholder="Örn. ABC Gıda A.Ş." /></label>
                <label className="field-group">
                  <span>Tedarikçi Türü</span>
                  <select name="tedarikciTuru" value={form.tedarikciTuru} onChange={handleChange}>
                    <option value="">Tür seçin</option>
                    {SUPPLIER_TYPE_OPTIONS.map((typeOption) => (
                      <option key={typeOption} value={typeOption}>{typeOption}</option>
                    ))}
                  </select>
                </label>
                <div className="field-group supplier-category-multiselect">
                  <span>Kategoriler</span>
                  <div className="supplier-category-checkbox-grid" role="group" aria-label="Tedarikçi kategorileri">
                    {uniqueCategories.map((category) => {
                      const isChecked = selectedFormCategories.includes(category);
                      return (
                        <label key={category} className={`supplier-category-check ${isChecked ? 'is-checked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleFormCategory(category)}
                          />
                          <span>{category}</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="supplier-category-selected-strip">
                    {selectedFormCategories.length ?
                       selectedFormCategories.map((category) => <span key={category} className="supplier-category-pill">{category}</span>)
                      : <span className="supplier-category-empty">Kategori seçilmedi</span>}
                  </div>
                </div>
              </div>
            </section>

            <section className="modal-form-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">Yetkili</h4>
              </div>
              <div className="form-grid modal-form-grid supplier-grid-contact">
                <label className="field-group"><span>Yetkili Kişi</span><input name="contactName" value={form.contactName} onChange={handleChange} /></label>
                <label className="field-group"><span>Telefon</span><input name="phone" value={form.phone} onChange={handleChange} /></label>
                <label className="field-group"><span>E-posta</span><input name="email" value={form.email} onChange={handleChange} /></label>
                <label className="field-group"><span>Website</span><input name="website" value={form.website} onChange={handleChange} placeholder="https://..." /></label>
              </div>
            </section>

            <section className="modal-form-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">Ek Bilgiler</h4>
              </div>
              <div className="form-grid modal-form-grid supplier-grid-extra">
                <label className="field-group full-span">
                  <div className="field-label-row">
                    <span>Açıklama / Adres</span>
                    <div className="supplier-inline-status">
                      <span className="supplier-inline-status-label">Durum</span>
                      <button
                        type="button"
                        className={`user-status-switch ${form.isActive ? 'is-active' : 'is-passive'}`}
                        onClick={() => setForm((current) => ({ ...current, isActive: !current.isActive }))}
                        aria-pressed={form.isActive}
                        aria-label="Tedarikçi aktiflik durumu"
                      >
                        <span className="user-status-switch-indicator" aria-hidden="true" />
                        <span className="user-status-switch-option option-passive">Pasif</span>
                        <span className="user-status-switch-option option-active">Aktif</span>
                      </button>
                    </div>
                  </div>
                  <textarea name="address" rows="3" value={form.address} onChange={handleChange}></textarea>
                </label>
              </div>
            </section>

            <section className="modal-form-section supplier-metrics-readonly-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">Sistem Metrikleri</h4>
              </div>
              <div className="form-grid modal-form-grid supplier-grid-extra">
                <label className="field-group"><span>Tedarikçi Kodu</span><input value={metricsSource ? (metricsSource.supplierCode || metricsSource.id || '-') : 'Kaydedildikten sonra üretilir'} readOnly /></label>
                <label className="field-group"><span>Min Sipariş Koli</span><input value={metricsSource ? (metricsSource.minOrderCaseQty ?? '-') : '-'} readOnly /></label>
                <label className="field-group"><span>Teslimat Performansı</span><input value={metricsSource ? (metricsSource.teslimatPerformansi || '-') : '-'} readOnly /></label>
                <label className="field-group"><span>Gecikme Durumu</span><input value={metricsSource ? (metricsSource.gecikmeDurumu || '-') : '-'} readOnly /></label>
                <label className="field-group"><span>Son Sipariş</span><input value={metricsSource ? (formatDate(metricsSource.sonSiparis || metricsSource.orderMetrics?.lastOrderDate) || '-') : '-'} readOnly /></label>
                <label className="field-group"><span>Ort. Teslim Süresi</span><input value={metricsSource ? formatDays(metricsSource.ortalamaTeslimSuresi ?? metricsSource.orderMetrics?.averageDeliveryDays) : '-'} readOnly /></label>
              </div>
            </section>
          </div>
          <div className="modal-actions modal-actions-sticky">
            <button className="ghost-button" type="button" onClick={() => { setIsModalOpen(false); setEditingItem(null); }}>İptal</button>
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Kaydediliyor...' : editingItem ? 'Güncelle' : 'Kaydet'}</button>
          </div>
        </form>
      </FormModal>

      <FormModal
        isOpen={isMatchModalOpen}
        title="Yeni Eşleşme"
        description="Ürün-tedarikçi, ürün-parti-SKT, ürün-depo veya ürün-reyon eşleşmesini veri modeline uygun alanlarla oluşturun."
        headerIcon={<Link2 size={17} />}
        onClose={() => setIsMatchModalOpen(false)}
        modalClassName="supplier-form-fit-modal supplier-match-modal app-modal-standard"
      >
        <form className="modal-form modal-structured-form supplier-match-form" onSubmit={handleCreateMatch}>
          <div className="modal-form-body-scroll supplier-match-scroll-shell">
            <div className="supplier-match-topbar">
              <div className="supplier-match-mode-switch" role="tablist" aria-label="Eşleşme tipi seçimi">
                <button type="button" role="tab" className={matchCreateMode === MATCH_CREATE_MODES.PRODUCT_SUPPLIER ? 'active' : ''} aria-selected={matchCreateMode === MATCH_CREATE_MODES.PRODUCT_SUPPLIER} onClick={() => handleMatchCreateModeChange(MATCH_CREATE_MODES.PRODUCT_SUPPLIER)}>
                  Ürün-Tedarikçi
                </button>
                <button type="button" role="tab" className={matchCreateMode === MATCH_CREATE_MODES.PRODUCT_BATCH ? 'active' : ''} aria-selected={matchCreateMode === MATCH_CREATE_MODES.PRODUCT_BATCH} onClick={() => handleMatchCreateModeChange(MATCH_CREATE_MODES.PRODUCT_BATCH)}>
                  Ürün-Parti-SKT
                </button>
                <button type="button" role="tab" className={matchCreateMode === MATCH_CREATE_MODES.PRODUCT_DEPOT ? 'active' : ''} aria-selected={matchCreateMode === MATCH_CREATE_MODES.PRODUCT_DEPOT} onClick={() => handleMatchCreateModeChange(MATCH_CREATE_MODES.PRODUCT_DEPOT)}>
                  Ürün-Depo
                </button>
                <button type="button" role="tab" className={matchCreateMode === MATCH_CREATE_MODES.PRODUCT_REYON ? 'active' : ''} aria-selected={matchCreateMode === MATCH_CREATE_MODES.PRODUCT_REYON} onClick={() => handleMatchCreateModeChange(MATCH_CREATE_MODES.PRODUCT_REYON)}>
                  Ürün-Reyon
                </button>
              </div>
            </div>

            <div className="supplier-match-split-layout supplier-match-split-layout--body">
              <div className="supplier-match-split-main">
                <FormSection title="Temel Bilgi" description="Eşleşme tipi ve zorunlu temel alanları seçin.">
                  <FormGrid>
                    <label className="field-group col-6">
                      <span>Ürün Seçimi<span className="modal-required">*</span></span>
                      <div className="product-supplier-combobox">
                        <SearchableCombobox
                          options={productOptions}
                          value={String(selectedCreateProductId || '')}
                          onChange={handleMatchProductChange}
                          placeholder="Ürün ara ve seç"
                          noResultsText="Eşleşen ürün bulunamadı"
                          ariaLabel="Ürün seçimi"
                        />
                      </div>
                    </label>

                    {matchCreateMode === MATCH_CREATE_MODES.PRODUCT_SUPPLIER ? (
                      <label className="field-group col-6">
                        <span>Tedarikçi Seçimi<span className="modal-required">*</span></span>
                        <div className="product-supplier-combobox">
                          <SearchableCombobox
                            options={supplierOptions}
                            value={String(matchForm.supplierId || '')}
                            onChange={handleMatchSupplierChange}
                            placeholder="Tedarikçi ara ve seç"
                            noResultsText="Eşleşen tedarikçi bulunamadı"
                            ariaLabel="Tedarikçi seçimi"
                          />
                        </div>
                      </label>
                    ) : null}

                    {matchCreateMode === MATCH_CREATE_MODES.PRODUCT_DEPOT ? (
                      <label className="field-group col-6">
                        <span>Depo Lokasyon Seçimi<span className="modal-required">*</span></span>
                        <div className="product-supplier-combobox">
                          <SearchableCombobox
                            options={warehouseLocationOptions}
                            value={String(depotMatchForm.locationCode || '')}
                            onChange={(value) => handleDepotFieldChange('locationCode', value)}
                            placeholder="Depo lokasyon kodu ara"
                            noResultsText="Eşleşen lokasyon bulunamadı"
                            ariaLabel="Depo lokasyon seçimi"
                          />
                        </div>
                      </label>
                    ) : null}

                    {matchCreateMode === MATCH_CREATE_MODES.PRODUCT_REYON ? (
                      <label className="field-group col-6">
                        <span>Reyon Seçimi<span className="modal-required">*</span></span>
                        <div className="product-supplier-combobox">
                          <SearchableCombobox
                            options={reyonSectionOptions}
                            value={String(reyonMatchForm.sectionId || '')}
                            onChange={(value) => handleReyonFieldChange('sectionId', value)}
                            placeholder="Reyon ara ve seç"
                            noResultsText="Eşleşen reyon bulunamadı"
                            ariaLabel="Reyon seçimi"
                          />
                        </div>
                      </label>
                    ) : null}

                    {duplicateMatch && matchCreateMode === MATCH_CREATE_MODES.PRODUCT_SUPPLIER ? (
                      <div className="supplier-match-duplicate-alert col-12" role="alert">
                        Bu ürün ve tedarikçi için eşleşme zaten var.
                      </div>
                    ) : null}
                  </FormGrid>
                </FormSection>

                {matchCreateMode === MATCH_CREATE_MODES.PRODUCT_SUPPLIER ? (
                  <>
                    <FormSection title="Ticari Alanlar" description="Fiyat ve sipariş koşullarını tek satırda belirleyin." className={isMatchDetailsDisabled ? 'is-disabled' : ''}>
                      <FormGrid className="supplier-match-trade-grid">
                        <div className="supplier-match-pricing-row col-12">
                          <label className="field-group supplier-match-price-cell supplier-match-price-cell-main">
                            <span>Alış Fiyatı<span className="modal-required">*</span></span>
                            <div className="supplier-match-price-inline supplier-match-price-inline-compact">
                              <input type="number" min="0" step="0.01" value={matchForm.purchasePrice} onChange={(event) => handleMatchFieldChange('purchasePrice', event.target.value)} disabled={isMatchDetailsDisabled} />
                              <span className="supplier-match-currency-pill" aria-label="Para birimi">TRY</span>
                            </div>
                          </label>

                          <label className="field-group supplier-match-price-cell">
                            <span>MOQ Birim Alış</span>
                            <input type="number" min="1" value={matchForm.minimumOrderQty} onChange={(event) => handleMatchFieldChange('minimumOrderQty', event.target.value)} disabled={isMatchDetailsDisabled} />
                          </label>

                          <label className="field-group supplier-match-price-cell">
                            <span>3 Koli Fiyatı</span>
                            <input type="number" min="0" step="0.01" value={matchForm.tierPrice3Case} onChange={(event) => handleMatchFieldChange('tierPrice3Case', event.target.value)} disabled={isMatchDetailsDisabled} />
                          </label>

                          <label className="field-group supplier-match-price-cell">
                            <span>10 Koli Fiyatı</span>
                            <input type="number" min="0" step="0.01" value={matchForm.tierPrice10Case} onChange={(event) => handleMatchFieldChange('tierPrice10Case', event.target.value)} disabled={isMatchDetailsDisabled} />
                          </label>

                          <label className="field-group supplier-match-price-cell">
                            <span>20 Koli Fiyatı</span>
                            <input type="number" min="0" step="0.01" value={matchForm.tierPrice20Case} onChange={(event) => handleMatchFieldChange('tierPrice20Case', event.target.value)} disabled={isMatchDetailsDisabled} />
                          </label>
                        </div>
                      </FormGrid>
                    </FormSection>

                    <FormSection title="Durum ve Operasyon" description="Temin süresi, varsayılan tedarikçi ve not alanlarını yönetin." className={isMatchDetailsDisabled ? 'is-disabled' : ''}>
                      <FormGrid className="supplier-match-operation-grid">
                        <label className="field-group supplier-match-price-cell supplier-match-delivery-card">
                          <span>Tahmini Teslim (Gün)<span className="modal-required">*</span></span>
                          <input type="number" min="1" value={matchForm.leadTimeDays} onChange={(event) => handleMatchFieldChange('leadTimeDays', event.target.value)} disabled={isMatchDetailsDisabled} />
                        </label>

                        <div className="field-group supplier-match-note-field supplier-match-note-inline-field supplier-match-switch-inline supplier-match-delivery-card">
                          <span>Varsayılan Tedarikçi</span>
                          <label className={`supplier-match-switch ${matchForm.isPrimary ? 'is-on' : ''}`}>
                            <input type="checkbox" checked={Boolean(matchForm.isPrimary)} onChange={(event) => handleMatchFieldChange('isPrimary', event.target.checked)} disabled={isMatchDetailsDisabled} />
                            <span className="supplier-match-switch-track" aria-hidden="true">
                              <span className="supplier-match-switch-knob" />
                            </span>
                            <span className="supplier-match-switch-text">{matchForm.isPrimary ? 'Evet' : 'Hayır'}</span>
                          </label>
                        </div>

                        <label className="field-group supplier-match-note-field supplier-match-note-inline-field">
                          <span>Not</span>
                          <textarea rows={1} value={matchForm.note} onChange={(event) => handleMatchFieldChange('note', event.target.value)} placeholder="Opsiyonel not" disabled={isMatchDetailsDisabled} />
                        </label>
                      </FormGrid>
                    </FormSection>
                  </>
                ) : null}

                {matchCreateMode === MATCH_CREATE_MODES.PRODUCT_BATCH ? (
                  <FormSection title="Parti No - SKT Alanları" description="Parti no ile SKT ilişkisini ürün altında benzersiz şekilde oluşturun." className={isMatchDetailsDisabled ? 'is-disabled' : ''}>
                    <FormGrid className="supplier-match-batch-grid">
                      <label className="field-group col-6">
                        <span>SKU</span>
                        <input value={selectedMatchProduct?.sku || '-'} readOnly />
                      </label>
                      <label className="field-group col-6">
                        <span>Barkod</span>
                        <input value={selectedMatchProduct?.barcode || '-'} readOnly />
                      </label>
                      <label className="field-group col-4">
                        <span>Parti No<span className="modal-required">*</span></span>
                        <input
                          value={batchMatchForm.batchNo}
                          onChange={(event) => setBatchMatchForm((current) => ({ ...current, batchNo: event.target.value }))}
                          placeholder="Örn. PR-2026-04"
                        />
                      </label>
                      {isSelectedMatchSktApplicable ? (
                        <label className="field-group col-4">
                          <span>SKT{isSelectedMatchSktRequired ? <span className="modal-required">*</span> : null}</span>
                          <input
                            type="date"
                            value={batchMatchForm.skt}
                            onChange={(event) => setBatchMatchForm((current) => ({ ...current, skt: event.target.value }))}
                          />
                        </label>
                      ) : null}
                      <label className="field-group col-4">
                        <span>Toplam Miktar</span>
                        <input
                          type="number"
                          min="0"
                          value={batchMatchForm.totalQuantity}
                          onChange={(event) => setBatchMatchForm((current) => ({ ...current, totalQuantity: event.target.value }))}
                          placeholder="Örn. 120"
                        />
                      </label>
                      <label className="field-group col-6">
                        <span>Depo Miktarı</span>
                        <input
                          type="number"
                          min="0"
                          value={batchMatchForm.warehouseQuantity}
                          onChange={(event) => setBatchMatchForm((current) => ({ ...current, warehouseQuantity: event.target.value }))}
                          placeholder="Örn. 80"
                        />
                      </label>
                      <label className="field-group col-6">
                        <span>Reyon Miktarı</span>
                        <input
                          type="number"
                          min="0"
                          value={batchMatchForm.shelfQuantity}
                          onChange={(event) => setBatchMatchForm((current) => ({ ...current, shelfQuantity: event.target.value }))}
                          placeholder="Örn. 40"
                        />
                      </label>
                      {isSelectedMatchSktApplicable ? (
                        <label className="field-group col-6">
                          <span>Durum</span>
                          <input value={getExpiryStatusLabel(resolveExpiryStatus(batchMatchForm.skt))} readOnly />
                        </label>
                      ) : null}
                      <label className="field-group col-6">
                        <span>Maliyet/SKT Notu</span>
                        <textarea
                          rows={1}
                          value={batchMatchForm.note}
                          onChange={(event) => setBatchMatchForm((current) => ({ ...current, note: event.target.value }))}
                          placeholder="Opsiyonel not"
                        />
                      </label>
                    </FormGrid>
                  </FormSection>
                ) : null}

                {matchCreateMode === MATCH_CREATE_MODES.PRODUCT_DEPOT ? (
                  <FormSection title="Depo Alanları" description="Depo eşleşmesine ait lokasyon bilgilerini düzenli grid ile girin." className={isMatchDetailsDisabled ? 'is-disabled' : ''}>
                    <FormGrid className="supplier-match-depot-grid">
                      <label className="field-group col-3"><span>Depo Sıra No</span><input value={selectedDepotLocation?.rowNo ?? '-'} readOnly /></label>
                      <label className="field-group col-3"><span>Depo Taraf</span><input value={selectedDepotLocation?.side || '-'} readOnly /></label>
                      <label className="field-group col-3"><span>Depo Raf</span><input value={selectedDepotLocation?.shelfNo ?? '-'} readOnly /></label>
                      <label className="field-group col-3"><span>Depo Kat</span><input value={selectedDepotLocation?.levelNo ?? '-'} readOnly /></label>

                      <label className="field-group col-6"><span>Depo Lokasyon Kodu<span className="modal-required">*</span></span><input value={depotMatchForm.locationCode || ''} readOnly /></label>
                      <label className="field-group col-6"><span>Depo Max Stok</span><input type="number" min="0" value={depotMatchForm.maxStock} onChange={(event) => handleDepotFieldChange('maxStock', event.target.value)} placeholder="Örn. 120" /></label>

                      <label className="field-group col-12"><span>Not</span><textarea rows={2} value={depotMatchForm.note} onChange={(event) => handleDepotFieldChange('note', event.target.value)} placeholder="Depo eşleşme notu" /></label>
                    </FormGrid>
                  </FormSection>
                ) : null}

                {matchCreateMode === MATCH_CREATE_MODES.PRODUCT_REYON ? (
                  <FormSection title="Reyon Alanları" description="Reyon yerleşim alanlarını kompakt, iki satırlı düzende seçin." className={isMatchDetailsDisabled ? 'is-disabled' : ''}>
                    <FormGrid className="supplier-match-reyon-grid">
                      <label className="field-group supplier-match-reyon-no">
                        <span>Reyon No<span className="modal-required">*</span></span>
                        <input value={sectionById.get(String(reyonMatchForm.sectionId || ''))?.number || ''} readOnly />
                      </label>
                      <label className="field-group supplier-match-reyon-name">
                        <span>Reyon Adı</span>
                        <input value={sectionById.get(String(reyonMatchForm.sectionId || ''))?.name || '-'} readOnly />
                      </label>

                      <label className="field-group supplier-match-reyon-side"><span>Taraf (L/R)<span className="modal-required">*</span></span><select value={reyonMatchForm.shelfSide} onChange={(event) => handleReyonFieldChange('shelfSide', event.target.value)}><option value="">Seçin</option>{reyonGridOptions.sideOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                      <label className="field-group supplier-match-reyon-shelf"><span>Raf<span className="modal-required">*</span></span><select value={reyonMatchForm.shelfNo} onChange={(event) => handleReyonFieldChange('shelfNo', event.target.value)}><option value="">Seçin</option>{reyonGridOptions.shelfOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                      <label className="field-group supplier-match-reyon-level"><span>Kat<span className="modal-required">*</span></span><select value={reyonMatchForm.shelfLevel} onChange={(event) => handleReyonFieldChange('shelfLevel', event.target.value)}><option value="">Seçin</option>{reyonGridOptions.levelOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>

                      <label className="field-group supplier-match-reyon-code">
                        <span>Lokasyon Kodu</span>
                        <input
                          readOnly 
                          value={
                            reyonMatchForm.sectionId && reyonMatchForm.shelfSide && reyonMatchForm.shelfNo && reyonMatchForm.shelfLevel ?
                               `${sectionById.get(String(reyonMatchForm.sectionId || ''))?.number || ''}${reyonMatchForm.shelfSide}${reyonMatchForm.shelfNo}-${reyonMatchForm.shelfLevel}`
                              : ''
                          }
                        />
                      </label>
                      <label className="field-group supplier-match-reyon-note"><span>Not</span><textarea rows={1} value={reyonMatchForm.note} onChange={(event) => handleReyonFieldChange('note', event.target.value)} placeholder="Reyon yerleşim notu" /></label>
                    </FormGrid>
                  </FormSection>
                ) : null}
              </div>

              <aside className="supplier-match-summary-panel" aria-label="Seçilen ürün özeti">
                <h5>Ürün Özeti</h5>
                <div className="supplier-match-summary-grid">
                  <div><span>Ürün Adı</span><strong>{selectedProductSummary.productName}</strong></div>
                  <div><span>SKU</span><strong>{selectedProductSummary.sku}</strong></div>
                  <div><span>Barkod</span><strong>{selectedProductSummary.barcode}</strong></div>
                  <div><span>Marka</span><strong>{selectedProductSummary.brand}</strong></div>
                  <div><span>Kategori</span><strong>{selectedProductSummary.category}</strong></div>
                  <div><span>Alt Kategori</span><strong>{selectedProductSummary.subCategory}</strong></div>
                  <div><span>Birim</span><strong>{selectedProductSummary.unit}</strong></div>
                  <div><span>Saklama Tipi</span><strong>{selectedProductSummary.storageType}</strong></div>
                  <div><span>Koli İçi Adet</span><strong>{selectedProductSummary.unitsPerCase}</strong></div>
                  <div><span>Palet Başına Koli</span><strong>{selectedProductSummary.casesPerPallet}</strong></div>
                  <div><span>Varsayılan Depo Lokasyonu</span><strong>{selectedProductSummary.defaultDepotLocation}</strong></div>
                  <div><span>Raf Kodu</span><strong>{selectedProductSummary.shelfCode}</strong></div>
                </div>
              </aside>
            </div>
          </div>

          <div className="modal-actions modal-actions-sticky supplier-match-actions">
            <span className="supplier-match-action-info">{isMatchReferenceLoading ? 'Eşleşmeler kontrol ediliyor...' : ''}</span>
            <div className="supplier-match-actions-right">
              <button className="ghost-button" type="button" onClick={() => setIsMatchModalOpen(false)}>İptal</button>
              <button className="primary-button" type="submit" disabled={matchSubmitting || !canSubmitMatch}>{matchSubmitting ? 'Kaydediliyor...' : 'Kaydet'}</button>
            </div>
          </div>
        </form>
      </FormModal>

      <FormModal
        isOpen={isMatchEditModalOpen}
        title={
          matchEditType === 'supplier' ?
             'Ürün-Tedarikçi Eşleşmesi Düzenle'
            : matchEditType === 'batch' ?
               'Ürün-Parti-SKT Eşleşmesi Düzenle'
              : matchEditType === 'depot' ?
                 'Ürün-Depo Eşleşmesi Düzenle'
                : 'Ürün-Reyon Eşleşmesi Düzenle'
        }
        description="Eşleşme bilgisini güncelleyip kaydedin."
        headerIcon={<Link2 size={17} />}
        onClose={closeMatchEditModal}
        modalClassName="supplier-form-fit-modal supplier-match-modal"
      >
        {matchEditType === 'supplier' ? (
          <form className="modal-form modal-structured-form" onSubmit={handleSaveSupplierMatchEdit}>
            <div className="modal-form-body-scroll">
              <FormSection title="Tedarikçi Eşleşmesi" description="Varsayılan tedarikçi ve temel ticari alanları güncelleyin.">
                <FormGrid>
                  <label className="field-group col-6">
                    <span>Ürün</span>
                    <input value={products.find((item) => String(item.id) === String(supplierMatchEditForm.productId))?.name || '-'} readOnly />
                  </label>
                  <label className="field-group col-6">
                    <span>Varsayılan Tedarikçi</span>
                    <select value={supplierMatchEditForm.supplierId} onChange={(event) => setSupplierMatchEditForm((current) => ({ ...current, supplierId: event.target.value }))}>
                      <option value="">Tedarikçi seçin</option>
                      {supplierMatchEditCandidates.map((item) => (
                        <option key={item.supplierId} value={item.supplierId}>{item.supplierName}</option>
                      ))}
                    </select>
                  </label>
                  <div className="supplier-match-edit-cards col-12" role="group" aria-label="Ürüne bağlı tedarikçiler">
                    {supplierMatchEditCandidates.map((item) => {
                      const isSelected = String(item.supplierId) === String(supplierMatchEditForm.supplierId);
                      return (
                        <button
                          key={item.supplierId}
                          type="button"
                          className={`supplier-match-edit-card ${isSelected ? 'is-active' : ''}`}
                          onClick={() => setSupplierMatchEditForm((current) => ({ ...current, supplierId: item.supplierId }))}
                        >
                          <strong>{item.supplierName}</strong>
                          <span>{formatCurrency(item.purchasePrice || 0, 'TRY')} • {formatNumber(item.leadTimeDays || 0)} gün</span>
                        </button>
                      );
                    })}
                  </div>
                  {supplierMatchEditCandidates.length <= 1 ? (
                    <div className="supplier-match-edit-empty col-12">Başka tedarikçi görüntülenemedi.</div>
                  ) : null}
                  <label className="field-group col-4">
                    <span>Alış Fiyatı</span>
                    <input type="number" min="0" step="0.01" value={supplierMatchEditForm.purchasePrice} onChange={(event) => setSupplierMatchEditForm((current) => ({ ...current, purchasePrice: normalizeMoneyInput(event.target.value) }))} />
                  </label>
                  <label className="field-group col-4">
                    <span>Teslim Süresi (Gün)</span>
                    <input type="number" min="1" value={supplierMatchEditForm.leadTimeDays} onChange={(event) => setSupplierMatchEditForm((current) => ({ ...current, leadTimeDays: event.target.value }))} />
                  </label>
                  <label className="field-group col-4">
                    <span>Min. Sipariş (Koli)</span>
                    <input type="number" min="1" value={supplierMatchEditForm.minimumOrderQty} onChange={(event) => setSupplierMatchEditForm((current) => ({ ...current, minimumOrderQty: event.target.value }))} />
                  </label>
                  <label className="field-group col-12">
                    <span>Not</span>
                    <textarea rows="2" value={supplierMatchEditForm.note} onChange={(event) => setSupplierMatchEditForm((current) => ({ ...current, note: event.target.value }))} />
                  </label>
                </FormGrid>
              </FormSection>
            </div>
            <div className="modal-actions modal-actions-sticky">
              <button className="ghost-button" type="button" onClick={closeMatchEditModal}>İptal</button>
              <button className="primary-button" type="submit" disabled={matchEditSubmitting}>{matchEditSubmitting ? 'Kaydediliyor...' : 'Güncelle'}</button>
            </div>
          </form>
        ) : null}

        {matchEditType === 'batch' ? (
          <form className="modal-form modal-structured-form" onSubmit={handleSaveBatchEdit}>
            <div className="modal-form-body-scroll">
              <FormSection title="Parti No - SKT Bilgisi" description="SKT son kullanma tarihidir; güncelleme tarihi işlem zamanından oluşturulur.">
                <FormGrid>
                  <label className="field-group col-6">
                    <span>Parti No</span>
                    <input value={batchEditForm.batchNo} onChange={(event) => setBatchEditForm((current) => ({ ...current, batchNo: event.target.value }))} />
                  </label>
                  {isBatchEditSktApplicable ? (
                    <label className="field-group col-6">
                      <span>SKT{isBatchEditSktRequired ? <span className="modal-required">*</span> : null}</span>
                      <input type="date" value={batchEditForm.skt} onChange={(event) => setBatchEditForm((current) => ({ ...current, skt: event.target.value }))} />
                    </label>
                  ) : null}
                  <label className="field-group col-6">
                    <span>Depo Miktarı</span>
                    <input type="number" min="0" value={batchEditForm.warehouseQuantity} onChange={(event) => setBatchEditForm((current) => ({ ...current, warehouseQuantity: event.target.value, totalQuantity: String(Number(event.target.value || 0) + Number(current.shelfQuantity || 0)) }))} />
                  </label>
                  <label className="field-group col-6">
                    <span>Reyon Miktarı</span>
                    <input type="number" min="0" value={batchEditForm.shelfQuantity} onChange={(event) => setBatchEditForm((current) => ({ ...current, shelfQuantity: event.target.value, totalQuantity: String(Number(current.warehouseQuantity || 0) + Number(event.target.value || 0)) }))} />
                  </label>
                </FormGrid>
              </FormSection>
            </div>
            <div className="modal-actions modal-actions-sticky">
              <button className="ghost-button" type="button" onClick={closeMatchEditModal}>İptal</button>
              <button className="primary-button" type="submit" disabled={matchEditSubmitting}>{matchEditSubmitting ? 'Kaydediliyor...' : 'Güncelle'}</button>
            </div>
          </form>
        ) : null}

        {matchEditType === 'depot' ? (
          <form className="modal-form modal-structured-form" onSubmit={handleSaveDepotEdit}>
            <div className="modal-form-body-scroll">
              <FormSection title="Depo Eşleşmesi" description="Depo lokasyonunu arayıp seçerek eşleşme bilgisini güncelleyin.">
                <FormGrid>
                  <label className="field-group col-6">
                    <span>Depo Lokasyon Kodu</span>
                    <SearchableCombobox
                      options={warehouseLocationOptions}
                      value={String(depotEditForm.locationCode || '')}
                      onChange={(value) => {
                        const selectedValue = String(value || '');
                        const selectedLocation = warehouseLocationByCode.get(selectedValue) || null;
                        setDepotEditForm((current) => ({
                          ...current,
                          locationCode: selectedValue,
                          storageType: String(selectedLocation?.storageType || current.storageType || 'Ortam'),
                        }));
                      }}
                      placeholder="Depo lokasyon kodu ara"
                      noResultsText="Eşleşen lokasyon bulunamadı"
                      ariaLabel="Depo lokasyon kodu seçimi"
                    />
                  </label>
                  <label className="field-group col-6">
                    <span>Saklama Tipi</span>
                    <input value={selectedDepotEditLocation?.storageType || depotEditForm.storageType || '-'} readOnly />
                  </label>
                  <label className="field-group col-6">
                    <span>Durum</span>
                    <select value={depotEditForm.status} onChange={(event) => setDepotEditForm((current) => ({ ...current, status: event.target.value }))}>
                      <option value="Aktif">Aktif</option>
                      <option value="Pasif">Pasif</option>
                    </select>
                  </label>
                </FormGrid>
              </FormSection>
            </div>
            <div className="modal-actions modal-actions-sticky">
              <button className="ghost-button" type="button" onClick={closeMatchEditModal}>İptal</button>
              <button className="primary-button" type="submit" disabled={matchEditSubmitting}>{matchEditSubmitting ? 'Kaydediliyor...' : 'Güncelle'}</button>
            </div>
          </form>
        ) : null}

        {matchEditType === 'reyon' ? (
          <form className="modal-form modal-structured-form" onSubmit={handleSaveReyonEdit}>
            <div className="modal-form-body-scroll">
              <FormSection title="Reyon Eşleşmesi" description="Bağlı reyon ve reyon lokasyonunu güncelleyin.">
                <FormGrid>
                  <label className="field-group col-6">
                    <span>Bağlı Reyon</span>
                    <select value={reyonEditForm.sectionId} onChange={(event) => setReyonEditForm((current) => ({ ...current, sectionId: event.target.value }))}>
                      <option value="">Reyon seçin</option>
                      {activeSectionOptions.map((item) => (
                        <option key={item.id} value={item.id}>{item.number} - {item.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field-group col-2">
                    <span>Taraf</span>
                    <select value={reyonEditForm.shelfSide} onChange={(event) => setReyonEditForm((current) => ({ ...current, shelfSide: event.target.value }))}>
                      <option value="">-</option>
                      <option value="L">L</option>
                      <option value="R">R</option>
                    </select>
                  </label>
                  <label className="field-group col-2">
                    <span>Raf</span>
                    <input type="number" min="1" value={reyonEditForm.shelfNo} onChange={(event) => setReyonEditForm((current) => ({ ...current, shelfNo: event.target.value }))} />
                  </label>
                  <label className="field-group col-2">
                    <span>Kat</span>
                    <input type="number" min="1" value={reyonEditForm.shelfLevel} onChange={(event) => setReyonEditForm((current) => ({ ...current, shelfLevel: event.target.value }))} />
                  </label>
                </FormGrid>
              </FormSection>
            </div>
            <div className="modal-actions modal-actions-sticky">
              <button className="ghost-button" type="button" onClick={closeMatchEditModal}>İptal</button>
              <button className="primary-button" type="submit" disabled={matchEditSubmitting}>{matchEditSubmitting ? 'Kaydediliyor...' : 'Güncelle'}</button>
            </div>
          </form>
        ) : null}
      </FormModal>

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        title="Tedarikçi Sil"
        description={deleteTarget ? `${deleteTarget.name} kaydını silmek istediğinize emin misiniz? Bağlı ürün çeşitleri varsa işlem engellenir.` : ''}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        confirmText="Sil"
      />
    </div>
  );
}
