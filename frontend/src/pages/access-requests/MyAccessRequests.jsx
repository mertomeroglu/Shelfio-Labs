import { useEffect, useMemo, useState } from 'react';
import { Clock3, ShieldPlus } from 'lucide-react';
import PageHeader from '../../components/PageHeader.jsx';
import Toast from '../../components/Toast.jsx';
import { accessService } from '../../services/accessService.js';
import {
  getAccessRequestDisplayLabel,
  getPageAccessRequestOption,
  PAGE_ACCESS_REQUEST_OPTIONS,
  replacePermissionCodesInText,
} from '../../config/accessRequestPermissions.js';

const STATUS_LABEL = {
  pending: 'Beklemede',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
};

export default function MyAccessRequests() {
  const [toast, setToast] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    pagePath: PAGE_ACCESS_REQUEST_OPTIONS[0]?.pagePath || '',
    requestedDurationMinutes: 240,
    reason: '',
  });
  const [sending, setSending] = useState(false);

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const list = await accessService.listRequests();
      setRows(Array.isArray(list) ? list : []);
    } catch (error) {
      setToast({ type: 'error', title: 'Erişim Talebi', message: error.message || 'Kayıtlar yüklenemedi.' });
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const sortedRows = useMemo(() => [...rows].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [rows]);
  const selectedPageOption = useMemo(() => getPageAccessRequestOption(form.pagePath), [form.pagePath]);

  const submit = async (event) => {
    event.preventDefault();
    const pageOption = getPageAccessRequestOption(form.pagePath);
    if (!pageOption) {
      setToast({ type: 'error', title: 'Erişim Talebi', message: 'Talep edilecek sayfayı seçin.' });
      return;
    }
    try {
      setSending(true);
      await accessService.createRequest({
        permission: pageOption.permission,
        pageAccess: {
          pagePath: pageOption.pagePath,
          pageLabel: pageOption.pageLabel,
          displayLabel: pageOption.label,
        },
        requestedDurationMinutes: Number(form.requestedDurationMinutes),
        reason: form.reason,
      });
      setToast({ type: 'success', title: 'Erişim Talebi', message: 'Talebin yöneticilere iletildi.' });
      setForm((current) => ({ ...current, reason: '' }));
      await load({ silent: true });
    } catch (error) {
      setToast({ type: 'error', title: 'Erişim Talebi', message: error.message || 'Talep oluşturulamadı.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-stack access-requests-page access-my-requests-page">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageHeader
        className="dashboard-hero"
        icon={<ShieldPlus size={22} />}
        title="Taleplerim"
        description="Geçici erişim taleplerini oluştur ve durumlarını takip et."
      />

      <section className="access-requests-section-card access-my-request-create-card">
        <header className="access-requests-section-header">
          <div>
            <h3><ShieldPlus size={16} /> Yeni Talep</h3>
            <p>Sayfayı ve süreyi seçip kısa gerekçenizi iletin.</p>
          </div>
        </header>

        <form className="access-my-request-form" onSubmit={submit}>
          <div className="access-my-request-inline-fields">
            <label className="field-group">
              <span>Sayfa</span>
              <select value={form.pagePath} onChange={(event) => setForm((c) => ({ ...c, pagePath: event.target.value }))}>
                {PAGE_ACCESS_REQUEST_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>

            <label className="field-group">
              <span>Süre (dakika)</span>
              <input
                type="number"
                min="15"
                max="43200"
                value={form.requestedDurationMinutes}
                onChange={(event) => setForm((c) => ({ ...c, requestedDurationMinutes: event.target.value }))}
              />
            </label>
          </div>

          {selectedPageOption ? (
            <div className="access-my-request-selected-summary">
              {selectedPageOption.label}
            </div>
          ) : null}

          <label className="field-group access-my-request-reason">
            <span>Gerekçe</span>
            <textarea rows={3} required value={form.reason} onChange={(event) => setForm((c) => ({ ...c, reason: event.target.value }))} placeholder="Talep nedeninizi kısa ve net yazın" />
          </label>

          <div className="access-my-request-actions">
            <button type="submit" className="primary-button" disabled={sending || !String(form.reason || '').trim()}>
              <Clock3 size={16} /> {sending ? 'Gönderiliyor...' : 'Erişim Talep Et'}
            </button>
          </div>
        </form>
      </section>

      <section className="access-requests-section-card access-requests-section-card-history access-my-request-history-card">
        <header className="access-requests-section-header">
          <div>
            <h3><Clock3 size={16} /> Geçmiş Talepler</h3>
            <p>Gönderdiğiniz taleplerin durumlarını izleyin.</p>
          </div>
          <span className="access-requests-count-badge">{sortedRows.length}</span>
        </header>

        {loading ? <div className="notification-empty">Yükleniyor...</div> : null}
        {!loading && sortedRows.length === 0 ? <div className="notification-empty">Henüz talebin yok.</div> : null}
        {!loading && sortedRows.length > 0 ? (
          <div className="table-shell access-requests-table-shell">
            <table className="table-view access-requests-table access-my-requests-table">
              <colgroup>
                <col style={{ width: '34%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '30%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Yetki / Süre</th>
                  <th>Durum</th>
                  <th>Tarih</th>
                  <th>Not</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Yetki / Süre">
                      <div className="access-my-permission-duration">
                        <strong>{getAccessRequestDisplayLabel(row)}</strong>
                        <span>{row.requestedDurationMinutes} dk</span>
                      </div>
                    </td>
                    <td data-label="Durum">
                      <span className={`access-status-chip is-${row.status || 'pending'}`}>
                        {STATUS_LABEL[row.status] || row.status}
                      </span>
                    </td>
                    <td data-label="Tarih"><span className="access-meta-inline">{new Date(row.createdAt).toLocaleString('tr-TR')}</span></td>
                    <td data-label="Not" className="access-reason-cell">{replacePermissionCodesInText(row.reviewNoteDisplay || row.reviewNote, '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
