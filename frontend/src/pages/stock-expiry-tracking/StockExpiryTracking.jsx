import { useEffect, useMemo, useState } from 'react';
import './StockExpiryTracking.css';
import {
  CalendarClock,
  CheckCircle2,
  Download,
  Eye,
  Filter,
  History,
  Package,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import DataTable from '../../components/DataTable.jsx';
import FormModal from '../../components/FormModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Toast from '../../components/Toast.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { formatDate, formatNumber, formatUnit } from '../../services/formatters.js';
import { productService } from '../../services/productService.js';
import { stockService } from '../../services/stockService.js';
import { resolveSktPolicy, SKT_POLICIES } from '../../utils/sktPolicy.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const baseFilters = {
  search: '',
  category: '',
  supplier: '',
  risk: '',
  window: '',
  location: '',
  startDate: '',
  endDate: '',
  inStockOnly: true,
};

const toDateOnly = (value) => String(value || '').slice(0, 10);

const diffDaysFromToday = (value) => {
  const raw = toDateOnly(value);
  if (!raw) return null;
  const target = Date.parse(`${raw}T00:00:00.000Z`);
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(target) || !Number.isFinite(today)) return null;
  return Math.floor((target - today) / DAY_MS);
};

const resolveRisk = (daysToExpiry) => {
  if (daysToExpiry === null) return { key: 'unknown', label: 'SKT yok', tone: 'neutral' };
  if (daysToExpiry < 0) return { key: 'expired', label: 'SKT geçmiş', tone: Math.abs(daysToExpiry) > 30 ? 'danger' : 'warning' };
  if (daysToExpiry === 0) return { key: 'today', label: 'Bugün kritik', tone: 'danger' };
  if (daysToExpiry <= 3) return { key: '3days', label: '1-3 gün', tone: 'warning' };
  if (daysToExpiry <= 7) return { key: '7days', label: '4-7 gün', tone: 'primary' };
  return { key: 'later', label: 'Takipte', tone: 'neutral' };
};

const isRiskWindowRow = (row) => row.daysToExpiry !== null && row.daysToExpiry <= 7;
const isExpiredRow = (row) => Number(row.daysToExpiry) < 0;
const isTrackingRow = (row) => !isExpiredRow(row);
const isDisposalEligibleRow = (row) => isExpiredRow(row) && row.isSktApplicable !== false && Number(row.totalQuantity || 0) > 0;

const getProductCategory = (product = {}) => (
  product.categoryName
  || product.category?.name
  || product.mainCategory
  || product.category
  || '-'
);

const getProductSupplier = (product = {}) => (
  product.supplierName
  || product.defaultSupplierName
  || product.primarySupplierName
  || product.supplier?.name
  || '-'
);

const formatLastUpdated = (value) => {
  if (!value) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
};

const buildExpiryRows = (stocks = [], products = []) => {
  const productMap = new Map(products.flatMap((item) => [
    [String(item.id), item],
    [String(item.productId || item.id), item],
  ]));

  return stocks.flatMap((stock) => {
    const product = productMap.get(String(stock.productId)) || stock.product || {};
    const policyProduct = {
      ...product,
      ...stock,
      categoryName: getProductCategory(product),
      supplierName: getProductSupplier(product),
      categoryCode: product.categoryCode || product.category?.code || stock.categoryCode || '',
      category: product.category || stock.category || null,
      name: stock.productName || product.name || product.productName || '',
    };
    const sktPolicy = stock.sktPolicy || resolveSktPolicy(policyProduct);
    const isSktApplicable = sktPolicy.policy !== SKT_POLICIES.NOT_APPLICABLE;
    const batches = Array.isArray(stock.batches) ? stock.batches : Array.isArray(stock.productBatches) ? stock.productBatches : [];

    return batches
      .filter((batch) => toDateOnly(batch.skt) && Number(batch.totalQuantity || batch.quantity || 0) > 0)
      .map((batch) => {
        const daysToExpiry = diffDaysFromToday(batch.skt);
        const risk = resolveRisk(daysToExpiry);
        const warehouseQuantity = Number(batch.warehouseQuantity || 0);
        const shelfQuantity = Number(batch.shelfQuantity || 0);
        const totalQuantity = Number(batch.totalQuantity || warehouseQuantity + shelfQuantity || 0);
        return {
          id: batch.id || `${stock.productId}-${batch.batchNo || 'batch'}-${toDateOnly(batch.skt)}`,
          productId: stock.productId,
          productName: stock.productName || product.name || product.productName || '-',
          sku: stock.sku || product.sku || '-',
          barcode: stock.barcode || product.barcode || '-',
          batchNo: batch.batchNo || '-',
          skt: toDateOnly(batch.skt),
          daysToExpiry,
          warehouseQuantity,
          shelfQuantity,
          totalQuantity,
          categoryName: getProductCategory(product),
          supplierName: getProductSupplier(product),
          riskKey: risk.key,
          riskLabel: risk.label,
          riskTone: risk.tone,
          sktPolicy: sktPolicy.policy,
          sktPolicyReason: sktPolicy.reason || '',
          isSktApplicable,
          unitCost: Number(stock.purchasePrice || product.purchasePrice || product.costPrice || 0),
        };
      });
  }).sort((left, right) => String(left.skt).localeCompare(String(right.skt)) || String(left.productName).localeCompare(String(right.productName), 'tr'));
};

const downloadCsv = (rows, fileName = 'skt-takibi.csv') => {
  const headers = ['Ürün adı', 'SKU', 'Barkod', 'Parti No', 'SKT Tarihi', 'Kalan gün', 'Depo stok', 'Reyon stok', 'Toplam stok', 'Kategori', 'Tedarikçi', 'Risk'];
  const body = rows.map((row) => [
    row.productName,
    row.sku,
    row.barcode,
    row.batchNo,
    row.skt,
    row.daysToExpiry ?? '',
    row.warehouseQuantity,
    row.shelfQuantity,
    row.totalQuantity,
    row.categoryName,
    row.supplierName,
    row.riskLabel,
  ]);
  const csv = [headers, ...body]
    .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export default function StockExpiryTracking() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState(baseFilters);
  const [selectedIds, setSelectedIds] = useState([]);
  const [detailRow, setDetailRow] = useState(null);
  const [disposeTarget, setDisposeTarget] = useState(null);
  const [disposeNote, setDisposeNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [toast, setToast] = useState(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'user';

  const loadData = async () => {
    try {
      setLoading(true);
      const [stockRows, productRows] = await Promise.all([
        stockService.getStocks({ fetchAll: true, includeBatches: true, forceRefresh: true }),
        productService.list({ fetchAll: true, includeTotal: true }),
      ]);
      const nextRows = buildExpiryRows(Array.isArray(stockRows) ? stockRows : [], Array.isArray(productRows) ? productRows : [])
        .filter((row) => row.isSktApplicable !== false);
      setRows(nextRows);
      setSelectedIds((current) => current.filter((id) => nextRows.some((row) => String(row.id) === String(id))));
      setLastUpdated(new Date());
    } catch (error) {
      setToast({ type: 'error', title: 'SKT Takibi', message: error.message || 'SKT verileri yüklenemedi.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredRows = useMemo(() => {
    const search = filters.search.trim().toLocaleLowerCase('tr-TR');
    return rows.filter((row) => {
      if (search) {
        const haystack = [row.productName, row.sku, row.barcode, row.batchNo].join(' ').toLocaleLowerCase('tr-TR');
        if (!haystack.includes(search)) return false;
      }
      if (filters.category && row.categoryName !== filters.category) return false;
      if (filters.supplier && row.supplierName !== filters.supplier) return false;
      if (filters.risk && row.riskKey !== filters.risk) return false;
      if (filters.window === 'expired' && !isExpiredRow(row)) return false;
      if (filters.window === 'today' && row.daysToExpiry !== 0) return false;
      if (filters.window === '3days' && !(row.daysToExpiry >= 1 && row.daysToExpiry <= 3)) return false;
      if (filters.window === '7days' && !(row.daysToExpiry >= 4 && row.daysToExpiry <= 7)) return false;
      if (filters.location === 'warehouse' && !(row.warehouseQuantity > 0)) return false;
      if (filters.location === 'shelf' && !(row.shelfQuantity > 0)) return false;
      if (filters.startDate && row.skt < filters.startDate) return false;
      if (filters.endDate && row.skt > filters.endDate) return false;
      if (filters.inStockOnly && !(Number(row.totalQuantity || 0) > 0)) return false;
      return true;
    });
  }, [filters, rows]);

  const trackingRows = useMemo(() => filteredRows.filter(isTrackingRow), [filteredRows]);
  const expiredRows = useMemo(() => filteredRows.filter(isExpiredRow), [filteredRows]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => expiredRows.some((row) => String(row.id) === String(id))));
  }, [expiredRows]);

  const selectedRows = useMemo(
    () => expiredRows.filter((row) => selectedIds.some((id) => String(id) === String(row.id))),
    [expiredRows, selectedIds]
  );
  const selectedExpiredRows = selectedRows.filter(isDisposalEligibleRow);

  const categoryOptions = useMemo(() => Array.from(new Set(rows.map((row) => row.categoryName).filter((item) => item && item !== '-'))).sort((a, b) => a.localeCompare(b, 'tr')), [rows]);
  const supplierOptions = useMemo(() => Array.from(new Set(rows.map((row) => row.supplierName).filter((item) => item && item !== '-'))).sort((a, b) => a.localeCompare(b, 'tr')), [rows]);

  const summary = useMemo(() => {
    const expired = rows.filter((row) => row.riskKey === 'expired');
    const today = rows.filter((row) => row.riskKey === 'today');
    const in3 = rows.filter((row) => row.riskKey === '3days');
    const in7 = rows.filter((row) => row.riskKey === '7days');
    const later = rows.filter((row) => row.riskKey === 'later');
    const riskValue = rows
      .filter(isRiskWindowRow)
      .reduce((sum, row) => sum + (Number(row.unitCost || 0) * Number(row.totalQuantity || 0)), 0);
    return {
      today: today.length,
      in3: in3.length,
      in7: in7.length,
      later: later.length,
      expired: expired.length,
      disposalWaiting: expired.filter(isDisposalEligibleRow).length,
      riskValue,
    };
  }, [rows]);

  const openDispose = (targetRows) => {
    const safeRows = (Array.isArray(targetRows) ? targetRows : []).filter(isDisposalEligibleRow);
    if (!safeRows.length) {
      setToast({ type: 'error', title: 'SKT Takibi', message: 'İmha için yalnız SKT politikası uygun, stoklu ve tarihi geçmiş partiler seçilebilir.' });
      return;
    }
    setDisposeTarget(safeRows);
    setDisposeNote('');
  };

  const confirmDispose = async () => {
    const targetRows = Array.isArray(disposeTarget) ? disposeTarget : [];
    if (!targetRows.length) return;
    try {
      setProcessing(true);
      const result = await stockService.disposeExpiredBatches({
        items: targetRows.map((row) => ({ batchId: row.id })),
        reason: 'SKT geçmiş ürün imhası',
        note: disposeNote,
      });
      setToast({
        type: 'success',
        title: 'SKT Takibi',
        message: `${formatNumber(result?.disposedBatchCount || targetRows.length)} parti batch düzeyinde imha edildi.`,
      });
      setDisposeTarget(null);
      setDisposeNote('');
      setSelectedIds([]);
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'SKT Takibi', message: error.message || 'SKT imhası başarısız.' });
    } finally {
      setProcessing(false);
    }
  };

  const allVisibleExpiredSelected = expiredRows.length > 0 && expiredRows.every((row) => selectedIds.some((id) => String(id) === String(row.id)));

  const sharedColumns = [
    { key: 'productName', label: 'Ürün adı', className: 'stock-expiry-page__cell-wide', render: (row) => <span className="stock-expiry-page__cell-clamp">{formatUnit(row.productName)}</span> },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Barkod', render: (row) => row.barcode || '-' },
    { key: 'batchNo', label: 'Parti No' },
    { key: 'skt', label: 'SKT Tarihi', render: (row) => formatDate(row.skt), sortValue: (row) => new Date(row.skt).getTime() },
    {
      key: 'daysToExpiry',
      label: 'Kalan gün',
      render: (row) => row.daysToExpiry < 0 ? `${Math.abs(row.daysToExpiry)} gün geçti` : `${row.daysToExpiry} gün`,
      sortValue: (row) => row.daysToExpiry ?? 9999,
    },
    { key: 'warehouseQuantity', label: 'Depo stok', render: (row) => formatNumber(row.warehouseQuantity || 0), sortValue: (row) => row.warehouseQuantity || 0 },
    { key: 'shelfQuantity', label: 'Reyon stok', render: (row) => formatNumber(row.shelfQuantity || 0), sortValue: (row) => row.shelfQuantity || 0 },
    { key: 'totalQuantity', label: 'Toplam stok', render: (row) => formatNumber(row.totalQuantity || 0), sortValue: (row) => row.totalQuantity || 0 },
    { key: 'categoryName', label: 'Kategori', render: (row) => row.categoryName || '-' },
    { key: 'supplierName', label: 'Tedarikçi', className: 'stock-expiry-page__cell-wide', render: (row) => <span className="stock-expiry-page__cell-clamp">{row.supplierName || '-'}</span> },
    {
      key: 'risk',
      label: 'Risk / Durum',
      render: (row) => <StatusBadge tone={row.riskTone}>{row.riskLabel}</StatusBadge>,
      sortable: false,
    },
    {
      key: 'action',
      label: 'İşlem',
      className: 'stock-expiry-page__cell-actions',
      render: (row) => (
        <div className="stock-expiry-page__row-actions">
          <button className="stock-expiry-page__button stock-expiry-page__button--ghost" type="button" onClick={() => setDetailRow(row)}><Eye size={14} /> Detay</button>
        </div>
      ),
      sortable: false,
    },
  ];

  const expiredColumns = [
    {
      key: 'select',
      label: '',
      className: 'stock-expiry-page__cell-select',
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.some((id) => String(id) === String(row.id))}
          onChange={(event) => {
            setSelectedIds((current) => event.target.checked
              ? Array.from(new Set([...current, row.id]))
              : current.filter((id) => String(id) !== String(row.id)));
          }}
          aria-label={`${row.batchNo} partisini seç`}
        />
      ),
      sortable: false,
    },
    ...sharedColumns.slice(0, -1),
    {
      key: 'action',
      label: 'İşlem',
      className: 'stock-expiry-page__cell-actions',
      render: (row) => (
        <div className="stock-expiry-page__row-actions">
          <button className="stock-expiry-page__button stock-expiry-page__button--ghost" type="button" onClick={() => setDetailRow(row)}><Eye size={14} /> Detay</button>
          <button className="stock-expiry-page__button stock-expiry-page__button--danger" type="button" onClick={() => openDispose([row])} disabled={!isAdmin || !isDisposalEligibleRow(row) || processing}>
            <Trash2 size={14} /> İmha Et
          </button>
        </div>
      ),
      sortable: false,
    },
  ];

  return (
    <div className="page-stack stock-expiry-page">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageHeader
        className="dashboard-hero stock-expiry-page__hero"
        icon={<CalendarClock size={22} />}
        title="SKT Takibi"
        description="SKT yaklaşan ve geçmiş ürünleri izleyin, riskleri yönetin ve gerekli imha işlemlerini kontrollü başlatın."
        actions={(
          <div className="stock-expiry-page__header-actions">
            <button className="stock-expiry-page__button stock-expiry-page__button--ghost" type="button" onClick={loadData} disabled={loading || processing}>
              <RefreshCw size={14} /> Yenile
            </button>
            <span className="stock-expiry-page__last-updated">
              {lastUpdated ? `Son güncelleme: ${formatLastUpdated(lastUpdated)}` : loading ? 'Veriler yükleniyor' : 'Henüz yenilenmedi'}
            </span>
          </div>
        )}
      />

      <ExpiryOverview summary={summary} rows={rows} totalRows={rows.length} />
      <ExpiryFilters
        filters={filters}
        setFilters={setFilters}
        categoryOptions={categoryOptions}
        supplierOptions={supplierOptions}
      />

      <ExpiryTableSection
        title="SKT Geçmiş"
        description="SKT'si geçmiş ve aksiyon bekleyen ürünler. Seçim ve toplu imha yalnız burada yapılır."
        icon={<History size={18} />}
        rows={expiredRows}
        actions={(
          <>
            <label className="stock-expiry-page__check stock-expiry-page__check--compact">
              <input
                type="checkbox"
                checked={allVisibleExpiredSelected}
                onChange={(event) => setSelectedIds(event.target.checked ? expiredRows.map((row) => row.id) : [])}
                disabled={!expiredRows.length}
              />
              <span>Tümünü seç</span>
            </label>
            <button className="stock-expiry-page__button stock-expiry-page__button--danger" type="button" onClick={() => openDispose(selectedRows)} disabled={!isAdmin || !selectedExpiredRows.length || processing}>
              <Trash2 size={14} /> Seçili ürünleri imha et
            </button>
            <button className="stock-expiry-page__button stock-expiry-page__button--ghost" type="button" onClick={() => downloadCsv(expiredRows, 'skt-gecmis.csv')} disabled={!expiredRows.length}>
              <Download size={14} /> Excel dışa aktar
            </button>
          </>
        )}
      >
        <DataTable
          columns={expiredColumns}
          rows={expiredRows}
          keyField="id"
          isLoading={loading}
          emptyMessage="SKT'si geçmiş batch bulunmuyor."
          initialSort={{ key: 'skt', direction: 'asc' }}
          pageSize={10}
          compactPagination
          topHorizontalScroll
          panelClassName="stock-expiry-page__data-panel"
          tableWrapperClassName="stock-expiry-page__table-wrapper"
          tableClassName="stock-expiry-page__table"
          loadingStateClassName="stock-expiry-page__loading"
          emptyStateClassName="stock-expiry-page__empty"
        />
      </ExpiryTableSection>

      <ExpiryTableSection
        title="SKT Takip"
        description="Yaklaşan SKT ürünlerini izleyin. Geçmiş kayıtlar bu tabloda gösterilmez."
        icon={<CalendarClock size={18} />}
        rows={trackingRows}
        actions={(
          <button className="stock-expiry-page__button stock-expiry-page__button--ghost" type="button" onClick={() => downloadCsv(trackingRows, 'skt-takip.csv')} disabled={!trackingRows.length}>
            <Download size={14} /> Excel dışa aktar
          </button>
        )}
      >
        <DataTable
          columns={sharedColumns}
          rows={trackingRows}
          keyField="id"
          isLoading={loading}
          emptyMessage="SKT takip için aktif batch bulunmuyor."
          initialSort={{ key: 'skt', direction: 'asc' }}
          pageSize={10}
          compactPagination
          topHorizontalScroll
          panelClassName="stock-expiry-page__data-panel"
          tableWrapperClassName="stock-expiry-page__table-wrapper"
          tableClassName="stock-expiry-page__table"
          loadingStateClassName="stock-expiry-page__loading"
          emptyStateClassName="stock-expiry-page__empty"
        />
      </ExpiryTableSection>

      <FormModal
        isOpen={Boolean(detailRow)}
        title="Parti Detayı"
        description={detailRow ? `${detailRow.productName} / ${detailRow.batchNo}` : ''}
        onClose={() => setDetailRow(null)}
        modalClassName="stock-expiry-page__detail-modal"
        confirmOnDirtyClose={false}
      >
        {detailRow ? (
          <div className="skt-detail-grid">
            <div><span>Ürün</span><strong>{formatUnit(detailRow.productName)}</strong></div>
            <div><span>SKU</span><strong>{detailRow.sku}</strong></div>
            <div><span>Barkod</span><strong>{detailRow.barcode}</strong></div>
            <div><span>Parti No</span><strong>{detailRow.batchNo}</strong></div>
            <div><span>SKT</span><strong>{formatDate(detailRow.skt)}</strong></div>
            <div><span>Durum</span><StatusBadge tone={detailRow.riskTone}>{detailRow.riskLabel}</StatusBadge></div>
            <div><span>Depo stok</span><strong>{formatNumber(detailRow.warehouseQuantity)}</strong></div>
            <div><span>Reyon stok</span><strong>{formatNumber(detailRow.shelfQuantity)}</strong></div>
            <div><span>Toplam stok</span><strong>{formatNumber(detailRow.totalQuantity)}</strong></div>
            <div><span>Tedarikçi</span><strong>{detailRow.supplierName || '-'}</strong></div>
          </div>
        ) : null}
        <div className="modal-actions app-dialog-actions stock-expiry-page__modal-actions">
          <button className="outline-button" type="button" onClick={() => setDetailRow(null)}>Kapat</button>
        </div>
      </FormModal>

      <FormModal
        isOpen={Boolean(disposeTarget)}
        title="SKT Geçmiş Parti İmhası"
        description={disposeTarget ? `${formatNumber(disposeTarget.length)} parti batch düzeyinde imha edilecek.` : ''}
        onClose={() => {
          if (!processing) {
            setDisposeTarget(null);
            setDisposeNote('');
          }
        }}
        confirmOnDirtyClose={false}
      >
        <div className="modal-form movement-expired-disposal-modal">
          <div className="movement-critical-note">Varsayılan imha nedeni: SKT geçmiş ürün imhası</div>
          <label className="field-group">
            <span>Ek Not</span>
            <textarea value={disposeNote} onChange={(event) => setDisposeNote(event.target.value)} placeholder="İmha onayı için ek not" disabled={processing} />
          </label>
          <div className="modal-actions app-dialog-actions">
            <button className="outline-button" type="button" onClick={() => { setDisposeTarget(null); setDisposeNote(''); }} disabled={processing}>Vazgeç</button>
            <button className="danger-button" type="button" onClick={confirmDispose} disabled={processing}>{processing ? 'İmha Ediliyor...' : 'Evet, İmha Et'}</button>
          </div>
        </div>
      </FormModal>
    </div>
  );
}

function ExpiryOverview({ summary, rows, totalRows }) {
  const riskBuckets = [
    { label: 'SKT geçmiş', value: summary.expired, tone: 'danger' },
    { label: 'Bugün', value: summary.today, tone: 'danger' },
    { label: '1-3 gün', value: summary.in3, tone: 'warning' },
    { label: '4-7 gün', value: summary.in7, tone: 'primary' },
    { label: '7+ gün', value: summary.later, tone: 'neutral' },
  ];
  const nearTermBuckets = [
    { label: 'Bugün', value: summary.today, tone: 'danger' },
    { label: '1-3 gün', value: summary.in3, tone: 'warning' },
    { label: '4-7 gün', value: summary.in7, tone: 'primary' },
  ];
  const categoryBuckets = buildCategoryRiskBuckets(rows);
  const actionBuckets = [
    { label: 'İmha bekleyen', value: summary.disposalWaiting, tone: 'warning' },
    { label: 'Geçmiş diğer', value: Math.max(0, Number(summary.expired || 0) - Number(summary.disposalWaiting || 0)), tone: 'danger' },
    { label: 'Takipte', value: Math.max(0, Number(totalRows || 0) - Number(summary.expired || 0)), tone: 'primary' },
  ];

  return (
    <section className="stock-expiry-page__overview" aria-label="SKT analiz grafikleri">
      <ChartPanel
        title="SKT Risk Dağılımı"
        description={`${formatNumber(totalRows)} SKT partisi tekil risk bantlarında`}
        icon={<CheckCircle2 size={16} />}
      >
        <HorizontalBarChart items={riskBuckets} />
      </ChartPanel>
      <ChartPanel
        title="Gün Bazlı Risk Yoğunluğu"
        description="Yakın dönem SKT baskısını gün aralığına göre izleyin"
        icon={<CalendarClock size={16} />}
      >
        <ColumnChart items={nearTermBuckets} />
      </ChartPanel>
      <ChartPanel
        title="Kategori Bazlı Yoğunluk"
        description="Geçmiş ve 7 gün içindeki riskli partilerin kategori kırılımı"
        icon={<Package size={16} />}
      >
        <HorizontalBarChart items={categoryBuckets} emptyText="Riskli kategori bulunmuyor" />
      </ChartPanel>
      <ChartPanel
        title="Aksiyon Durumu"
        description="Geçmiş, imha bekleyen ve takipteki parti dağılımı"
        icon={<Trash2 size={16} />}
      >
        <ColumnChart items={actionBuckets} />
      </ChartPanel>
    </section>
  );
}

function buildCategoryRiskBuckets(rows = []) {
  const counts = new Map();
  rows
    .filter((row) => row.daysToExpiry !== null && row.daysToExpiry <= 7)
    .forEach((row) => {
      const key = row.categoryName || 'Kategori yok';
      counts.set(key, (counts.get(key) || 0) + 1);
    });

  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value, tone: 'primary' }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, 'tr'))
    .slice(0, 5);
}

function ChartPanel({ title, description, icon, children }) {
  return (
    <article className="stock-expiry-page__chart-panel">
      <SectionHeader icon={icon} title={title} description={description} />
      <div className="stock-expiry-page__chart-body">{children}</div>
    </article>
  );
}

function HorizontalBarChart({ items = [], emptyText = 'Veri bulunmuyor' }) {
  const chartItems = items.map((item) => ({ ...item, value: Math.max(0, Number(item?.value || 0)) }));
  const maxValue = Math.max(1, ...chartItems.map((item) => item.value));
  const hasData = chartItems.some((item) => item.value > 0);

  if (!hasData) {
    return <div className="stock-expiry-page__chart-empty">{emptyText}</div>;
  }

  return (
    <div className="stock-expiry-page__bar-chart">
      {chartItems.map((item) => (
        <div className="stock-expiry-page__bar-row" key={item.label}>
          <span>{item.label}</span>
          <div className="stock-expiry-page__bar-track">
            <i className={`stock-expiry-page__bar-fill stock-expiry-page__bar-fill--${item.tone || 'neutral'}`} style={{ width: `${Math.max(7, Math.round((item.value / maxValue) * 100))}%` }} />
          </div>
          <strong>{formatNumber(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function ColumnChart({ items = [], emptyText = 'Veri bulunmuyor' }) {
  const chartItems = items.map((item) => ({ ...item, value: Math.max(0, Number(item?.value || 0)) }));
  const maxValue = Math.max(1, ...chartItems.map((item) => item.value));
  const hasData = chartItems.some((item) => item.value > 0);

  if (!hasData) {
    return <div className="stock-expiry-page__chart-empty">{emptyText}</div>;
  }

  return (
    <div className="stock-expiry-page__column-chart">
      <div className="stock-expiry-page__column-plot">
        {chartItems.map((item) => (
          <div className="stock-expiry-page__column-item" key={item.label}>
            <span className="stock-expiry-page__column-value">{formatNumber(item.value)}</span>
            <i className={`stock-expiry-page__column-bar stock-expiry-page__column-bar--${item.tone || 'neutral'}`} style={{ height: `${Math.max(12, Math.round((item.value / maxValue) * 100))}%` }} />
          </div>
        ))}
      </div>
      <div className="stock-expiry-page__column-axis">
        {chartItems.map((item) => <span key={item.label}>{item.label}</span>)}
      </div>
    </div>
  );
}

function ExpiryFilters({ filters, setFilters, categoryOptions, supplierOptions }) {
  return (
    <section className="stock-expiry-page__panel stock-expiry-page__filters">
      <SectionHeader icon={<Filter size={18} />} title="Filtreler" description="SKT risklerini ürün, parti, konum ve süreye göre daraltın." />
      <div className="stock-expiry-page__filter-grid">
        <label className="stock-expiry-page__field stock-expiry-page__field--search"><span>Arama</span><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Ürün, SKU, barkod veya parti" /></label>
        <label className="stock-expiry-page__field"><span>Kategori</span><select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="">Tümü</option>{categoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="stock-expiry-page__field"><span>Tedarikçi</span><select value={filters.supplier} onChange={(event) => setFilters((current) => ({ ...current, supplier: event.target.value }))}><option value="">Tümü</option>{supplierOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="stock-expiry-page__field"><span>Risk seviyesi</span><select value={filters.risk} onChange={(event) => setFilters((current) => ({ ...current, risk: event.target.value }))}><option value="">Tümü</option><option value="expired">SKT geçmiş</option><option value="today">Bugün kritik</option><option value="3days">1-3 gün</option><option value="7days">4-7 gün</option><option value="later">7+ gün</option></select></label>
        <label className="stock-expiry-page__field"><span>SKT durumu</span><select value={filters.window} onChange={(event) => setFilters((current) => ({ ...current, window: event.target.value }))}><option value="">Tümü</option><option value="expired">Geçmiş</option><option value="today">Bugün</option><option value="3days">1-3 gün</option><option value="7days">4-7 gün</option></select></label>
        <label className="stock-expiry-page__field"><span>Reyon / Stok konumu</span><select value={filters.location} onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))}><option value="">Tüm konumlar</option><option value="shelf">Reyonda stoku olanlar</option><option value="warehouse">Depoda stoku olanlar</option></select></label>
        <label className="stock-expiry-page__field"><span>Başlangıç SKT</span><input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} /></label>
        <label className="stock-expiry-page__field"><span>Bitiş SKT</span><input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} /></label>
        <label className="stock-expiry-page__check stock-expiry-page__check--filter">
          <input type="checkbox" checked={filters.inStockOnly} onChange={(event) => setFilters((current) => ({ ...current, inStockOnly: event.target.checked }))} />
          <span>Stokta kalanlar</span>
        </label>
      </div>
    </section>
  );
}

function ExpiryTableSection({ children, title, description, icon, rows, actions }) {
  return (
    <section className="stock-expiry-page__panel stock-expiry-page__table-shell">
      <div className="stock-expiry-page__table-head">
        <div className="stock-expiry-page__table-title">
          <span className="stock-expiry-page__section-icon">{icon}</span>
          <div>
            <h3>{title}</h3>
            <p>{description} <strong>{formatNumber(rows.length)} parti</strong></p>
          </div>
        </div>
        <div className="stock-expiry-page__toolbar">{actions}</div>
      </div>
      <div className="stock-expiry-page__table-frame">{children}</div>
    </section>
  );
}

function SectionHeader({ icon, title, description }) {
  return (
    <div className="stock-expiry-page__section-head">
      <span className="stock-expiry-page__section-icon">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}
