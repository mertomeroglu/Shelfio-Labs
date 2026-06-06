import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleX,
  Clock3,
  FileSearch,
  Filter,
  History,
  KeyRound,
  Search,
  ShieldAlert,
  Timer,
  UserRound,
} from 'lucide-react';
import FilterBar from '../../components/FilterBar.jsx';
import { useDialog } from '../../components/ConfirmModal.jsx';
import FormModal from '../../components/FormModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Toast from '../../components/Toast.jsx';
import { InputWithIcon } from '../../components/SearchBar.jsx';
import { getPermissionLabel, replacePermissionCodesInText } from '../../config/accessRequestPermissions.js';
import { accessService } from '../../services/accessService.js';
import { useLocation, useNavigate } from 'react-router-dom';

const PAGE_SIZE = 10;

const STATUS_LABEL = {
  pending: 'Beklemede',
  active: 'Aktif',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  revoked: 'İptal Edildi',
  expired: 'Süresi Doldu',
};

const STATUS_CLASS = {
  pending: 'is-pending',
  active: 'is-approved',
  approved: 'is-approved',
  rejected: 'is-rejected',
  revoked: 'is-rejected',
  expired: 'is-expired',
};

const RISK_LABEL = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
};

const RISK_CLASS = {
  low: 'risk-low',
  medium: 'risk-medium',
  high: 'risk-high',
};

const PERMISSION_LABELS = {
  'purchase:create': 'Satın Alma Oluşturma',
  'purchase:approve': 'Satın Alma Onayı',
  'purchase:read': 'Satın Alma Görüntüleme',
  'purchase:view': 'Satın Alma Görüntüleme',
  'access_request:approve': 'Erişim Talebi Onaylama',
  'access_request:reject': 'Erişim Talebi Reddetme',
  'temporary_grant:revoke': 'Geçici Yetki İptali',
  'user:update': 'Kullanıcı Düzenleme',
  'settings:update': 'Sistem Ayarları Güncelleme',
  'stock:update': 'Stok Güncelleme',
  'esl:update': 'ESL Güncelleme',
  'task:update': 'Görev Güncelleme',
};

const DEFAULT_FILTERS = {
  status: '',
  startDate: '',
  endDate: '',
  search: '',
  reason: '',
};

function formatRequestDisplayId(requestId, prefix = 'TAL') {
  const raw = String(requestId || '').trim();
  if (!raw) return '-';
  const compact = raw.replace(/[^a-zA-Z0-9]/g, '');
  if (!compact) return '-';
  const numericSeed = compact.slice(0, 10);
  let hash = 0;
  for (let i = 0; i < numericSeed.length; i += 1) {
    hash = ((hash << 5) - hash + numericSeed.charCodeAt(i)) | 0;
  }
  return `${prefix}-${String(Math.abs(hash) % 10000).padStart(4, '0')}`;
}

function formatPermissionLabel(permission) {
  return getPermissionLabel(permission);
}

function formatMinutesHuman(minutes) {
  const value = Number(minutes || 0);
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value < 60) return `${value} dk`;
  const hours = Math.floor(value / 60);
  const remaining = value % 60;
  return remaining ? `${hours} sa ${remaining} dk` : `${hours} sa`;
}

function formatDateTimeSafe(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('tr-TR');
}

function getAuditTrailSafe(row) {
  if (!row || typeof row !== 'object') return [];
  if (Array.isArray(row.auditTrail)) return row.auditTrail.filter(Boolean);
  if (Array.isArray(row.history)) return row.history.filter(Boolean);
  if (Array.isArray(row.logs)) return row.logs.filter(Boolean);
  return [];
}

function getRequestIdentity(row) {
  if (!row || typeof row !== 'object') return '';
  if (row.id) return String(row.id);
  if (row.requestId) return String(row.requestId);
  return [row.userId, row.permission, row.storeId, row.createdAt]
    .map((part) => String(part || '').trim())
    .join('|');
}

function getRequestRowKey(row, scope) {
  return `${scope}:${getRequestIdentity(row)}`;
}

function normalizeReasonValue(value) {
  return replacePermissionCodesInText(value, '').trim();
}

function isMeaningfulReason(value) {
  const normalized = normalizeReasonValue(value).toLocaleLowerCase('tr-TR');
  return Boolean(normalized) && normalized !== 'null' && normalized !== 'demo';
}

function paginateRows(rows, currentPage) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  return {
    totalPages,
    currentPage: safePage,
    pageRows: rows.slice(startIndex, startIndex + PAGE_SIZE),
    startIndex,
  };
}

function PaginationBar({ label, total, currentPage, totalPages, onChange }) {
  if (!total) return null;
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(total, currentPage * PAGE_SIZE);
  return (
    <div className="access-archive-pagination">
      <span className="access-archive-pagination-label">{label}</span>
      <strong>{start}-{end} / {total}</strong>
      <button type="button" className="ghost-button" onClick={() => onChange(currentPage - 1)} disabled={currentPage <= 1}>
        Önceki
      </button>
      <span>Sayfa {currentPage} / {totalPages}</span>
      <button type="button" className="primary-button" onClick={() => onChange(currentPage + 1)} disabled={currentPage >= totalPages}>
        Sonraki
      </button>
    </div>
  );
}

export default function AccessRequestsAdmin() {
  const location = useLocation();
  const navigate = useNavigate();
  const dialog = useDialog();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [activeTab, setActiveTab] = useState('pending');
  const [detailModal, setDetailModal] = useState({ open: false, row: null });
  const [rejectModal, setRejectModal] = useState({ open: false, ids: [], note: '' });
  const [durationModal, setDurationModal] = useState({ open: false, ids: [], requestId: '', durationMinutes: 240, note: '', scope: 'pending' });
  const [pageByTab, setPageByTab] = useState({ pending: 1, active: 1, archive: 1 });

  const load = async ({ silent = false, overrides = {} } = {}) => {
    if (!silent) setLoading(true);
    try {
      const query = { ...filters, ...overrides };
      const list = await accessService.listRequests(query);
      setRows(Array.isArray(list) ? list : []);
    } catch (error) {
      setToast({ type: 'error', title: 'Erişim Talepleri', message: error.message || 'Kayıtlar yüklenemedi.' });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const reasonOptions = useMemo(() => {
    const seen = new Set();
    return rows
      .map((row) => normalizeReasonValue(row.reasonDisplay || row.reason || row.justification))
      .filter((value) => isMeaningfulReason(value))
      .filter((value) => {
        const key = value.toLocaleLowerCase('tr-TR');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => left.localeCompare(right, 'tr'));
  }, [rows]);

  const reasonFilteredRows = useMemo(() => {
    if (!filters.reason) return rows;
    return rows.filter((row) => normalizeReasonValue(row.reasonDisplay || row.reason || row.justification) === filters.reason);
  }, [filters.reason, rows]);

  const pendingRows = useMemo(() => reasonFilteredRows
    .filter((item) => (item.effectiveStatus || item.status) === 'pending')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [reasonFilteredRows]);

  const activeRows = useMemo(() => reasonFilteredRows
    .filter((item) => (item.effectiveStatus || item.status) === 'active')
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)), [reasonFilteredRows]);

  const archiveRows = useMemo(() => reasonFilteredRows
    .filter((item) => {
      const status = item.effectiveStatus || item.status;
      return status !== 'pending' && status !== 'active';
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [reasonFilteredRows]);

  useEffect(() => {
    setPageByTab((current) => ({
      pending: Math.min(current.pending, Math.max(1, Math.ceil(pendingRows.length / PAGE_SIZE))),
      active: Math.min(current.active, Math.max(1, Math.ceil(activeRows.length / PAGE_SIZE))),
      archive: Math.min(current.archive, Math.max(1, Math.ceil(archiveRows.length / PAGE_SIZE))),
    }));
  }, [pendingRows.length, activeRows.length, archiveRows.length]);

  const pendingPagination = useMemo(() => paginateRows(pendingRows, pageByTab.pending), [pageByTab.pending, pendingRows]);
  const activePagination = useMemo(() => paginateRows(activeRows, pageByTab.active), [activeRows, pageByTab.active]);
  const archivePagination = useMemo(() => paginateRows(archiveRows, pageByTab.archive), [archiveRows, pageByTab.archive]);

  const summary = useMemo(() => {
    const pendingCount = pendingRows.length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const approvedToday = reasonFilteredRows.filter((item) => (
      (item.effectiveStatus || item.status) === 'active'
      && item.reviewedAt
      && new Date(item.reviewedAt).getTime() >= todayStart.getTime()
    )).length;

    const statusCounts = {
      pending: pendingRows.length,
      active: activeRows.length,
      approved: archiveRows.filter((item) => (item.effectiveStatus || item.status) === 'approved').length,
      rejected: archiveRows.filter((item) => (item.effectiveStatus || item.status) === 'rejected').length,
    };

        return {
      pendingCount,
      approvedToday,
      compactMetrics: [
        { key: 'pendingCount', label: 'Bekleyen Talep', value: pendingCount, tone: 'is-pending', fillWidth: '100%', kind: 'summary' },
        { key: 'approvedToday', label: 'Bugün Onaylanan', value: approvedToday, tone: 'is-approved', fillWidth: '100%', kind: 'summary' },
      ],
      statusChart: [
        { key: 'pending', label: 'Bekleyen', value: statusCounts.pending },
        { key: 'active', label: 'Aktif', value: statusCounts.active },
        { key: 'approved', label: 'Onaylanan', value: statusCounts.approved },
        { key: 'rejected', label: 'Reddedilen', value: statusCounts.rejected },
      ],
    };
  }, [activeRows.length, archiveRows, pendingRows.length, reasonFilteredRows]);

  const quickApprove = async (row) => {
    try {
      await accessService.approveRequest(row.id, { durationMinutes: Number(row.requestedDurationMinutes || 240), note: 'Satır içi onay' });
      setToast({ type: 'success', title: 'Erişim Talepleri', message: 'Talep onaylandı.' });
      await load({ silent: true });
    } catch (error) {
      setToast({ type: 'error', title: 'Erişim Talepleri', message: error.message || 'Onay işlemi başarısız.' });
    }
  };

  const confirmExtend = async () => {
    const targetIds = durationModal.scope === 'pending'
      ? durationModal.ids
      : durationModal.requestId ? [durationModal.requestId] : [];
    if (!targetIds.length) return;
    const value = Number(durationModal.durationMinutes);
    if (!Number.isFinite(value) || value < 15) {
      setToast({ type: 'error', title: 'Erişim Talepleri', message: 'Geçerli süre girin (min 15 dk).' });
      return;
    }
    try {
      if (targetIds.length === 1) {
        await accessService.extendRequest(targetIds[0], { durationMinutes: value, note: durationModal.note });
      } else {
        await accessService.bulkAction({ ids: targetIds, action: 'extend', durationMinutes: value, note: durationModal.note });
      }
      setToast({ type: 'success', title: 'Erişim Talepleri', message: 'Talep süresi güncellendi.' });
      setDurationModal({ open: false, ids: [], requestId: '', durationMinutes: 240, note: '', scope: 'pending' });
      await load({ silent: true });
    } catch (error) {
      setToast({ type: 'error', title: 'Erişim Talepleri', message: error.message || 'Süre güncellenemedi.' });
    }
  };

  const confirmReject = async () => {
    if (!rejectModal.ids.length) return;
    try {
      if (rejectModal.ids.length === 1) {
        await accessService.rejectRequest(rejectModal.ids[0], { note: rejectModal.note });
      } else {
        await accessService.bulkAction({ ids: rejectModal.ids, action: 'reject', note: rejectModal.note });
      }
      setToast({ type: 'success', title: 'Erişim Talepleri', message: 'Red işlemi tamamlandı.' });
      setRejectModal({ open: false, ids: [], note: '' });
      await load({ silent: true });
    } catch (error) {
      setToast({ type: 'error', title: 'Erişim Talepleri', message: error.message || 'Red işlemi başarısız.' });
    }
  };

  const cancelActiveAccess = async (row) => {
    if (!row?.grantId) {
      setToast({ type: 'error', title: 'Erişim Talepleri', message: 'İptal için grant kaydı bulunamadı.' });
      return;
    }
    const confirmed = await dialog.confirm({
      title: 'Aktif Erişimi İptal Et',
      description: 'Aktif erişimi iptal etmek istiyor musunuz?',
      confirmText: 'Evet, İptal Et',
      cancelText: 'Vazgeç',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await accessService.revokeGrant(row.grantId);
      setToast({ type: 'success', title: 'Erişim Talepleri', message: 'Aktif erişim iptal edildi.' });
      await load({ silent: true });
    } catch (error) {
      setToast({ type: 'error', title: 'Erişim Talepleri', message: error.message || 'İptal işlemi başarısız.' });
    }
  };

  const openDurationModal = (row, scope = 'pending') => {
    const defaultDuration = scope === 'active'
      ? Math.max(15, Number(row.activeRemainingMinutes || row.requestedDurationMinutes || 60))
      : Math.max(15, Number(row.requestedDurationMinutes || 240));
    setDurationModal({
      open: true,
      ids: scope === 'pending' ? [row.id] : [],
      requestId: scope === 'active' ? row.id : '',
      durationMinutes: defaultDuration,
      note: '',
      scope,
    });
  };

  const renderRowActions = (row, inActiveTab = false) => (
    <>
      {!inActiveTab ? (
        <>
          <button type="button" className="outline-button" onClick={() => setDetailModal({ open: true, row })}><FileSearch size={14} /> İncele</button>
          <button type="button" className="primary-button" onClick={() => quickApprove(row)}>Onayla</button>
          <button type="button" className="danger-button" onClick={() => setRejectModal({ open: true, ids: [row.id], note: '' })}>Reddet</button>
          <button type="button" className="outline-button" onClick={() => openDurationModal(row, 'pending')}>Süre</button>
        </>
      ) : (
        <>
          <button type="button" className="primary-button" onClick={() => openDurationModal(row, 'active')}>Süre</button>
          <button type="button" className="danger-button" onClick={() => cancelActiveAccess(row)}>İptal Et</button>
        </>
      )}
    </>
  );

  const renderReasonCell = (row) => normalizeReasonValue(row.reasonDisplay || row.reason || row.justification) || '-';
  const renderReasonPreview = (row) => {
    const text = renderReasonCell(row);
    return text.length > 64 ? `${text.slice(0, 61)}...` : text;
  };

  useEffect(() => {
    const targetRequestId = String(location.state?.openRequestId || location.state?.entityId || location.state?.referenceCode || '').trim();
    if (!targetRequestId || rows.length === 0) return;
    const targetRow = rows.find((row) => String(row.id || '').trim() === targetRequestId);
    if (!targetRow) return;
    setDetailModal({ open: true, row: targetRow });
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate, rows]);

  return (
    <div className="page-stack access-requests-page">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageHeader
        className="dashboard-hero"
        icon={<ShieldAlert size={22} />}
        title="Erişim Talepleri"
        description="Geçici erişim taleplerini incele, süre belirle ve onayla veya reddet."
      />

      {false ? <section className="access-requests-section-card access-requests-chart-card">
        <div className="access-status-chart access-status-chart-compact">
          {[...summary.compactMetrics, ...summary.statusChart.map((item) => {
            const total = summary.statusChart.reduce((sum, entry) => sum + entry.value, 0) || 1;
            return {
              ...item,
              tone: STATUS_CLASS[item.key] || '',
              fillWidth: `${Math.max(8, (item.value / total) * 100)}%`,
              kind: 'status',
            };
          })].map((item) => (
            <article key={item.key} className={`access-status-chart-item access-status-chart-item-${item.kind}`}>
              <div className="access-status-chart-head">
                <span className="access-status-chart-label">{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <div className="access-status-chart-bar">
                <span className={`access-status-chart-fill ${item.tone || ''}`} style={{ width: item.fillWidth }} />
              </div>
            </article>
          ))}
        </div>
        {false ? <article className="access-kpi-card">
          <div className="access-kpi-icon tone-amber"><Clock3 size={18} /></div>
          <div className="access-kpi-body"><span>Bekleyen Talep</span><strong>{summary.pendingCount}</strong></div>
        </article> : null}
        {false ? <article className="access-kpi-card">
          <div className="access-kpi-icon tone-emerald"><CheckCircle2 size={18} /></div>
          <div className="access-kpi-body"><span>Bugün Onaylanan</span><strong>{summary.approvedToday}</strong></div>
        </article> : null}
      </section> : null}

      <section className="access-requests-section-card access-filters-card">
        <header className="mod-card-header access-filter-header-minimal">
          <div className="mod-card-icon mod-icon-violet"><Filter size={18} /></div>
          <div><h3 className="mod-card-title">Filtreler</h3><p className="mod-card-desc">Durum, tarih ve gerekçeye göre filtreleyin.</p></div>
        </header>
        <FilterBar className="access-filter-bar">
          <label className="field-group">
            <span>Arama</span>
            <InputWithIcon
              className="access-input-with-icon"
              icon={<Search size={14} />}
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Gerekçe veya kullanıcı ara"
            />
          </label>
          <label className="field-group">
            <span>Durum</span>
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              <option value="">Tümü</option>
              <option value="pending">Beklemede</option>
              <option value="approved">Onaylandı</option>
              <option value="rejected">Reddedildi</option>
              <option value="expired">Süresi Doldu</option>
            </select>
          </label>
          <label className="field-group">
            <span>Gerekçe</span>
            <select value={filters.reason} onChange={(event) => setFilters((current) => ({ ...current, reason: event.target.value }))}>
              <option value="">Tümü</option>
              {reasonOptions.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
            </select>
          </label>
          <label className="field-group">
            <span>Başlangıç</span>
            <input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} />
          </label>
          <label className="field-group">
            <span>Bitiş</span>
            <input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} />
          </label>
          <div className="access-filter-inline-actions">
            <button type="button" className="primary-button" onClick={() => load({ overrides: {} })}>Filtrele</button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                load({ overrides: DEFAULT_FILTERS });
              }}
            >
              Temizle
            </button>
          </div>
        </FilterBar>
      </section>

      <section className="access-requests-section-card access-requests-tabs-card">
        <div className="access-requests-tabs" role="tablist" aria-label="Talep sekmeleri">
          <button type="button" role="tab" aria-selected={activeTab === 'pending'} className={`access-requests-tab ${activeTab === 'pending' ? 'is-active' : ''}`} onClick={() => setActiveTab('pending')}>Bekleyen Talepler <strong>{pendingRows.length}</strong></button>
          <button type="button" role="tab" aria-selected={activeTab === 'active'} className={`access-requests-tab ${activeTab === 'active' ? 'is-active' : ''}`} onClick={() => setActiveTab('active')}>Aktif Talepler <strong>{activeRows.length}</strong></button>
          <button type="button" role="tab" aria-selected={activeTab === 'archive'} className={`access-requests-tab ${activeTab === 'archive' ? 'is-active' : ''}`} onClick={() => setActiveTab('archive')}>Arşiv <strong>{archiveRows.length}</strong></button>
        </div>
      </section>

      {activeTab === 'pending' ? (
        <section className="access-requests-section-card access-requests-section-card-priority">
          <header className="access-requests-section-header">
            <div><h3><Clock3 size={16} /> Bekleyen Talepler</h3><p>Öncelikli işlem bekleyen erişim istekleri</p></div>
            <span className="access-requests-count-badge">{pendingRows.length}</span>
          </header>
          {loading ? <div className="notification-empty">Yükleniyor...</div> : null}
          {!loading && pendingRows.length === 0 ? <div className="notification-empty">Bekleyen talep yok.</div> : null}
          {!loading && pendingRows.length > 0 ? (
            <>
              <PaginationBar
                label="Bekleyen kayıtlar"
                total={pendingRows.length}
                currentPage={pendingPagination.currentPage}
                totalPages={pendingPagination.totalPages}
                onChange={(page) => setPageByTab((current) => ({ ...current, pending: page }))}
              />
              <div className="table-shell access-requests-table-shell">
                <table className="table-view access-requests-table access-requests-table-pending">
                  <thead><tr><th>Talep ID</th><th>Kullanıcı</th><th>Yetki</th><th>Risk</th><th>Süre</th><th>Tarih</th><th>Gerekçe</th><th>Durum</th><th>İnceleyen</th><th>Aksiyon</th></tr></thead>
                  <tbody>
                    {pendingPagination.pageRows.map((row) => (
                      <Fragment key={getRequestRowKey(row, 'pending')}>
                        <tr>
                          <td data-label="Talep ID"><span className="access-meta-inline">{formatRequestDisplayId(row.id)}</span></td>
                          <td data-label="Kullanıcı"><div className="access-user-cell"><strong><UserRound size={14} /> {row.requesterName || row.userId}</strong><small>Talep sahibi</small></div></td>
                          <td data-label="Yetki"><span className="access-permission-chip" title={formatPermissionLabel(row.permission)}><KeyRound size={13} /> {formatPermissionLabel(row.permission)}</span></td>
                          <td data-label="Risk"><span className={`access-risk-chip ${RISK_CLASS[row.riskLevel] || ''}`}>{RISK_LABEL[row.riskLevel] || 'Düşük'}</span></td>
                          <td data-label="Süre"><span className="access-meta-inline"><Clock3 size={13} /> {row.requestedDurationMinutes} dk</span></td>
                          <td data-label="Tarih"><span className="access-meta-inline">{formatDateTimeSafe(row.createdAt)}</span></td>
                          <td data-label="Gerekçe" className="access-reason-cell" title={renderReasonCell(row)}>{renderReasonPreview(row)}</td>
                          <td data-label="Durum"><span className={`access-status-chip ${STATUS_CLASS.pending}`}>{STATUS_LABEL.pending}</span></td>
                          <td data-label="İnceleyen"><span className="access-reviewer-placeholder">{row.assignedTo || 'Henüz atanmadı'}</span></td>
                          <td data-label="Aksiyon" className="access-action-cell"><div className="table-actions always-visible access-inline-actions">{renderRowActions(row, false)}</div></td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'active' ? (
        <section className="access-requests-section-card access-requests-section-card-active">
          <header className="access-requests-section-header">
            <div><h3><CheckCircle2 size={16} /> Aktif Talepler</h3><p>Onaylanmış ve halen geçerli erişimler</p></div>
            <span className="access-requests-count-badge">{activeRows.length}</span>
          </header>
          {loading ? <div className="notification-empty">Yükleniyor...</div> : null}
          {!loading && activeRows.length === 0 ? <div className="notification-empty">Aktif talep yok.</div> : null}
          {!loading && activeRows.length > 0 ? (
            <>
              <PaginationBar
                label="Aktif kayıtlar"
                total={activeRows.length}
                currentPage={activePagination.currentPage}
                totalPages={activePagination.totalPages}
                onChange={(page) => setPageByTab((current) => ({ ...current, active: page }))}
              />
              <div className="table-shell access-requests-table-shell">
                <table className="table-view access-requests-table access-requests-table-active">
                  <thead><tr><th>Talep ID</th><th>Kullanıcı</th><th>Yetki</th><th>Risk</th><th>Kalan Süre</th><th>Bitiş</th><th>Durum</th><th>Aksiyon</th></tr></thead>
                  <tbody>
                    {activePagination.pageRows.map((row) => (
                      <Fragment key={getRequestRowKey(row, 'active')}>
                        <tr>
                          <td data-label="Talep ID"><span className="access-meta-inline">{formatRequestDisplayId(row.id)}</span></td>
                          <td data-label="Kullanıcı"><div className="access-user-cell"><strong><UserRound size={14} /> {row.requesterName || row.userId}</strong><small>Talep sahibi</small></div></td>
                          <td data-label="Yetki"><span className="access-permission-chip" title={formatPermissionLabel(row.permission)}><KeyRound size={13} /> {formatPermissionLabel(row.permission)}</span></td>
                          <td data-label="Risk"><span className={`access-risk-chip ${RISK_CLASS[row.riskLevel] || ''}`}>{RISK_LABEL[row.riskLevel] || 'Düşük'}</span></td>
                          <td data-label="Kalan Süre"><span className="access-meta-inline"><Timer size={13} /> {formatMinutesHuman(row.activeRemainingMinutes)}</span></td>
                          <td data-label="Bitiş"><span className="access-meta-inline">{formatDateTimeSafe(row.grantExpiresAt)}</span></td>
                          <td data-label="Durum"><span className={`access-status-chip ${STATUS_CLASS.active}`}>{STATUS_LABEL.active}</span></td>
                          <td data-label="Aksiyon" className="access-action-cell"><div className="table-actions always-visible access-inline-actions">{renderRowActions(row, true)}</div></td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'archive' ? (
        <section className="access-requests-section-card access-requests-section-card-history">
          <header className="access-requests-section-header">
            <div><h3><History size={16} /> Arşiv</h3><p>Süresi biten ve tamamlanan talepler</p></div>
            <span className="access-requests-count-badge">{archiveRows.length}</span>
          </header>
          {loading ? <div className="notification-empty">Yükleniyor...</div> : null}
          {!loading && archiveRows.length === 0 ? <div className="notification-empty">Arşiv kaydı yok.</div> : null}
          {!loading && archiveRows.length > 0 ? (
            <>
              <PaginationBar
                label="Arşiv kayıtları"
                total={archiveRows.length}
                currentPage={archivePagination.currentPage}
                totalPages={archivePagination.totalPages}
                onChange={(page) => setPageByTab((current) => ({ ...current, archive: page }))}
              />
              <div className="table-shell access-requests-table-shell">
                <table className="table-view access-requests-table access-requests-table-history">
                  <thead><tr><th>Talep ID</th><th>Kullanıcı</th><th>Yetki</th><th>Risk</th><th>Süre</th><th>Tarih</th><th>Gerekçe</th><th>Durum</th><th>İnceleyen</th><th>Aksiyon</th></tr></thead>
                  <tbody>
                    {archivePagination.pageRows.map((row) => (
                      <Fragment key={getRequestRowKey(row, 'archive')}>
                        <tr>
                          <td data-label="Talep ID"><span className="access-meta-inline">{formatRequestDisplayId(row.id)}</span></td>
                          <td data-label="Kullanıcı"><div className="access-user-cell"><strong><UserRound size={14} /> {row.requesterName || row.userId}</strong><small>Talep sahibi</small></div></td>
                          <td data-label="Yetki"><span className="access-permission-chip" title={formatPermissionLabel(row.permission)}><KeyRound size={13} /> {formatPermissionLabel(row.permission)}</span></td>
                          <td data-label="Risk"><span className={`access-risk-chip ${RISK_CLASS[row.riskLevel] || ''}`}>{RISK_LABEL[row.riskLevel] || 'Düşük'}</span></td>
                          <td data-label="Süre"><span className="access-meta-inline"><Clock3 size={13} /> {row.requestedDurationMinutes} dk</span></td>
                          <td data-label="Tarih"><span className="access-meta-inline">{formatDateTimeSafe(row.createdAt)}</span></td>
                          <td data-label="Gerekçe" className="access-reason-cell" title={renderReasonCell(row)}>{renderReasonPreview(row)}</td>
                          <td><span className={`access-status-chip ${STATUS_CLASS[row.effectiveStatus || row.status] || ''}`}>{STATUS_LABEL[row.effectiveStatus || row.status] || row.effectiveStatus || row.status}</span></td>
                          <td data-label="İnceleyen">{row.reviewerName ? <span>{row.reviewerName}</span> : <span className="access-reviewer-placeholder">Atanmamış</span>}</td>
                          <td data-label="Aksiyon" className="access-action-cell">
                            <div className="table-actions always-visible access-inline-actions">
                              <button type="button" className="outline-button" onClick={() => setDetailModal({ open: true, row })}><FileSearch size={14} /> İncele</button>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <FormModal
        isOpen={rejectModal.open}
        title="Red Onayı"
        description={`${rejectModal.ids.length} talep reddedilecek. Gerekçe notu ekleyebilirsiniz.`}
        headerIcon={<CircleX size={16} />}
        onClose={() => setRejectModal({ open: false, ids: [], note: '' })}
        modalClassName="access-review-modal access-reject-modal-shell"
        confirmOnDirtyClose={false}
      >
        <form
          className="modal-form modal-structured-form access-reject-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            confirmReject();
          }}
        >
          <div className="modal-form-body-scroll access-reject-modal-body">
            <section className="modal-form-section access-reject-modal-section">
              <div className="modal-form-section-head">
                <h4 className="modal-form-section-title">Red Nedeni</h4>
                <p className="modal-form-section-desc">Talebin neden reddedildiğini kısa ve anlaşılır biçimde belirtin.</p>
              </div>
              <label className="field-group">
                <textarea rows={3} value={rejectModal.note} onChange={(event) => setRejectModal((current) => ({ ...current, note: event.target.value }))} placeholder="Gerekçe notunu yazın" />
              </label>
            </section>
          </div>
          <div className="modal-actions modal-actions-sticky access-reject-modal-footer">
            <button type="button" className="outline-button" onClick={() => setRejectModal({ open: false, ids: [], note: '' })}>Vazgeç</button>
            <button type="submit" className="danger-button access-modal-reject"><CircleX size={15} /> Reddet</button>
          </div>
        </form>
      </FormModal>

      <FormModal
        isOpen={durationModal.open}
        title="Süre"
        description="Seçilen talepler için erişim süresini güncelleyin."
        headerIcon={<Timer size={16} />}
        onClose={() => setDurationModal({ open: false, ids: [], requestId: '', durationMinutes: 240, note: '', scope: 'pending' })}
        modalClassName="access-review-modal access-extend-modal"
        confirmOnDirtyClose={false}
      >
        <div className="modal-form modal-structured-form">
          <div className="modal-form-body-scroll access-extend-modal-body">
            <div className="grid-form">
              <label className="field-group access-extend-modal-duration-field"><span>Yeni Süre (dakika)</span><input type="number" min="15" max="43200" value={durationModal.durationMinutes} onChange={(event) => setDurationModal((current) => ({ ...current, durationMinutes: event.target.value }))} /></label>
              <label className="field-group form-col-span-2 access-extend-modal-note-field"><span>Not</span><textarea rows={3} value={durationModal.note} onChange={(event) => setDurationModal((current) => ({ ...current, note: event.target.value }))} /></label>
            </div>
          </div>
          <div className="modal-actions modal-actions-sticky access-extend-modal-footer">
            <button type="button" className="outline-button" onClick={() => setDurationModal({ open: false, ids: [], requestId: '', durationMinutes: 240, note: '', scope: 'pending' })}>Vazgeç</button>
            <button type="button" className="primary-button" onClick={confirmExtend}>Süreyi Kaydet</button>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={detailModal.open && Boolean(detailModal.row)}
        title="Talep Detayı"
        description={detailModal.row ? `${detailModal.row.requesterName || detailModal.row.userId} kullanıcısının erişim talebi` : ''}
        headerIcon={<FileSearch size={16} />}
        onClose={() => setDetailModal({ open: false, row: null })}
        modalClassName="access-request-detail-modal"
        confirmOnDirtyClose={false}
      >
        {detailModal.row ? (
          <div className="modal-form">
            <div className="modal-form-body-scroll access-request-detail-body">
              <div className="access-request-detail-grid">
                <div><span>Kullanıcı</span><strong>{detailModal.row.requesterName || detailModal.row.userId}</strong></div>
                <div><span>Yetki</span><strong>{formatPermissionLabel(detailModal.row.permission)}</strong></div>
                <div><span>Durum</span><strong>{STATUS_LABEL[detailModal.row.effectiveStatus || detailModal.row.status] || (detailModal.row.effectiveStatus || detailModal.row.status)}</strong></div>
                <div><span>Risk</span><strong>{RISK_LABEL[detailModal.row.riskLevel] || 'Düşük'}</strong></div>
                <div><span>Talep Süresi</span><strong>{formatMinutesHuman(detailModal.row.requestedDurationMinutes)}</strong></div>
                <div><span>Talep ID</span><strong>{formatRequestDisplayId(detailModal.row.id)}</strong></div>
                <div><span>Talep Zamanı</span><strong>{formatDateTimeSafe(detailModal.row.createdAt)}</strong></div>
              </div>
              <article className="access-request-detail-note">
                <h4>Gerekçe</h4>
                <p>{renderReasonCell(detailModal.row) || 'Gerekçe belirtilmemiş.'}</p>
              </article>
              <article className="access-request-detail-note">
                <h4>İnceleme Notu</h4>
                <p>{replacePermissionCodesInText(detailModal.row.reviewNoteDisplay || detailModal.row.reviewNote, 'Henüz değerlendirme notu eklenmedi.')}</p>
              </article>
            </div>
            <div className="modal-actions modal-actions-sticky access-request-detail-footer">
              <button type="button" className="ghost-button" onClick={() => setDetailModal({ open: false, row: null })}>Kapat</button>
            </div>
          </div>
        ) : null}
      </FormModal>
    </div>
  );
}
