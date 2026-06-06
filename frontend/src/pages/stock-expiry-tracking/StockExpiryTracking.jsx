import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
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
import { stockService } from '../../services/stockService.js';

const baseFilters = {
  search: '',
  category: '',
  supplier: '',
  risk: '',
  window: '',
  location: '',
  startDate: '',
  endDate: '',
};

const isExpiredRow = (row) => Number(row.daysToExpiry) < 0;
const isDisposalEligibleRow = (row) => isExpiredRow(row) && row.isSktApplicable !== false && Number(row.totalQuantity || 0) > 0;
const formatRiskLabel = (label) => label === 'SKT geçmiş' ? 'Geçmiş' : label;

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

const EMPTY_SUMMARY = { totalRows: 0, expired: 0, today: 0, in3: 0, in7: 0, later: 0, riskValue: 0 };
const EMPTY_PAGINATION = { page: 1, limit: 10, total: 0, totalPages: 1 };
const SORT_KEYS = {
  productName: 'product_name',
  sku: 'sku',
  barcode: 'barcode',
  batchNo: 'batch_no',
  daysToExpiry: 'days_to_expiry',
  warehouseQuantity: 'warehouse_quantity',
  shelfQuantity: 'shelf_quantity',
  totalQuantity: 'total_quantity',
  categoryName: 'category_name',
  supplierName: 'supplier_name',
  skt: 'skt',
};
const toApiSort = (sort = {}) => `${SORT_KEYS[sort.key] || 'skt'}_${sort.direction === 'desc' ? 'desc' : 'asc'}`;

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
  const [expiredRows, setExpiredRows] = useState([]);
  const [trackingRows, setTrackingRows] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [charts, setCharts] = useState({ categoryBuckets: [] });
  const [filterOptions, setFilterOptions] = useState({ categories: [], suppliers: [] });
  const [pagination, setPagination] = useState({ expired: EMPTY_PAGINATION, tracking: EMPTY_PAGINATION });
  const [expiredPage, setExpiredPage] = useState(1);
  const [trackingPage, setTrackingPage] = useState(1);
  const [expiredSort, setExpiredSort] = useState({ key: 'skt', direction: 'asc' });
  const [trackingSort, setTrackingSort] = useState({ key: 'skt', direction: 'asc' });
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
  const deferredSearch = useDeferredValue(filters.search);
  const queryFilters = useMemo(() => ({ ...filters, search: deferredSearch }), [deferredSearch, filters]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const result = await stockService.getExpiryTracking({
        ...queryFilters,
        expiredPage,
        trackingPage,
        expiredLimit: 10,
        trackingLimit: 10,
        expiredSort: toApiSort(expiredSort),
        trackingSort: toApiSort(trackingSort),
      });
      setExpiredRows(Array.isArray(result?.expiredRows) ? result.expiredRows : []);
      setTrackingRows(Array.isArray(result?.trackingRows) ? result.trackingRows : []);
      setSummary(result?.summary || EMPTY_SUMMARY);
      setCharts(result?.charts || { categoryBuckets: [] });
      setFilterOptions(result?.options || { categories: [], suppliers: [] });
      setPagination(result?.pagination || { expired: EMPTY_PAGINATION, tracking: EMPTY_PAGINATION });
      setLastUpdated(new Date());
    } catch (error) {
      setToast({ type: 'error', title: 'SKT Takibi', message: error.message || 'SKT verileri yüklenemedi.' });
    } finally {
      setLoading(false);
    }
  }, [expiredPage, expiredSort, queryFilters, trackingPage, trackingSort]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => expiredRows.some((row) => String(row.id) === String(id))));
  }, [expiredRows]);

  const selectedRows = useMemo(
    () => expiredRows.filter((row) => selectedIds.some((id) => String(id) === String(row.id))),
    [expiredRows, selectedIds]
  );
  const selectedExpiredRows = selectedRows.filter(isDisposalEligibleRow);

  const updateFilters = useCallback((patch) => {
    setFilters((current) => ({ ...current, ...patch }));
    setExpiredPage(1);
    setTrackingPage(1);
  }, []);

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
      render: (row) => <StatusBadge tone={row.riskTone}>{formatRiskLabel(row.riskLabel)}</StatusBadge>,
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
            <Trash2 size={14} /> İmha
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

      <ExpiryOverview summary={summary} charts={charts} totalRows={summary.totalRows} />
      <ExpiryFilters
        filters={filters}
        updateFilters={updateFilters}
        categoryOptions={filterOptions.categories}
        supplierOptions={filterOptions.suppliers}
      />

      <ExpiryTableSection
        title="SKT Geçmiş"
        description="SKT'si geçmiş stoklu ürünler. İmha yalnız SKT politikası uygun partilerde yapılır."
        icon={<History size={18} />}
        rows={expiredRows}
        total={pagination.expired.total}
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
          serverPagination={pagination.expired}
          onPageChange={setExpiredPage}
          sortConfig={expiredSort}
          onSortChange={setExpiredSort}
          manualSorting
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
        total={pagination.tracking.total}
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
          serverPagination={pagination.tracking}
          onPageChange={setTrackingPage}
          sortConfig={trackingSort}
          onSortChange={setTrackingSort}
          manualSorting
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
            <div><span>Durum</span><StatusBadge tone={detailRow.riskTone}>{formatRiskLabel(detailRow.riskLabel)}</StatusBadge></div>
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

function ExpiryOverview({ summary, charts, totalRows }) {
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
  const categoryBuckets = charts?.categoryBuckets || [];
  const actionBuckets = [
    { label: 'SKT geçmiş', value: summary.expired, tone: 'danger' },
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
        description="SKT geçmiş ve takipteki stoklu parti dağılımı"
        icon={<Trash2 size={16} />}
      >
        <ColumnChart items={actionBuckets} />
      </ChartPanel>
    </section>
  );
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

function ExpiryFilters({ filters, updateFilters, categoryOptions, supplierOptions }) {
  return (
    <section className="stock-expiry-page__panel stock-expiry-page__filters">
      <SectionHeader icon={<Filter size={18} />} title="Filtreler" description="SKT risklerini ürün, parti, konum ve süreye göre daraltın." />
      <div className="stock-expiry-page__filter-grid">
        <label className="stock-expiry-page__field stock-expiry-page__field--search"><span>Arama</span><input value={filters.search} onChange={(event) => updateFilters({ search: event.target.value })} placeholder="Ürün, SKU, barkod veya parti" /></label>
        <label className="stock-expiry-page__field"><span>Kategori</span><select value={filters.category} onChange={(event) => updateFilters({ category: event.target.value })}><option value="">Tümü</option>{categoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="stock-expiry-page__field"><span>Tedarikçi</span><select value={filters.supplier} onChange={(event) => updateFilters({ supplier: event.target.value })}><option value="">Tümü</option>{supplierOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label className="stock-expiry-page__field"><span>Risk seviyesi</span><select value={filters.risk} onChange={(event) => updateFilters({ risk: event.target.value })}><option value="">Tümü</option><option value="expired">SKT geçmiş</option><option value="today">Bugün kritik</option><option value="3days">1-3 gün</option><option value="7days">4-7 gün</option><option value="later">7+ gün</option></select></label>
        <label className="stock-expiry-page__field"><span>SKT durumu</span><select value={filters.window} onChange={(event) => updateFilters({ window: event.target.value })}><option value="">Tümü</option><option value="expired">Geçmiş</option><option value="today">Bugün</option><option value="3days">1-3 gün</option><option value="7days">4-7 gün</option></select></label>
        <label className="stock-expiry-page__field"><span>Reyon / Stok konumu</span><select value={filters.location} onChange={(event) => updateFilters({ location: event.target.value })}><option value="">Tüm konumlar</option><option value="shelf">Reyonda stoku olanlar</option><option value="warehouse">Depoda stoku olanlar</option></select></label>
        <label className="stock-expiry-page__field"><span>Başlangıç SKT</span><input type="date" value={filters.startDate} onChange={(event) => updateFilters({ startDate: event.target.value })} /></label>
        <label className="stock-expiry-page__field"><span>Bitiş SKT</span><input type="date" value={filters.endDate} onChange={(event) => updateFilters({ endDate: event.target.value })} /></label>
      </div>
    </section>
  );
}

function ExpiryTableSection({ children, title, description, icon, rows, total = rows.length, actions }) {
  return (
    <section className="stock-expiry-page__panel stock-expiry-page__table-shell">
      <div className="stock-expiry-page__table-head">
        <div className="stock-expiry-page__table-title">
          <span className="stock-expiry-page__section-icon">{icon}</span>
          <div>
            <h3>{title}</h3>
            <p>{description} <strong>{formatNumber(total)} parti</strong></p>
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
