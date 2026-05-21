import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Clock, Loader, CheckCircle2, Filter, Plus, Search, AlertTriangle, ArrowUp, ArrowRight, ArrowDown } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import DataTable from '../../components/DataTable.jsx';
import FilterBar from '../../components/FilterBar.jsx';
import FormModal from '../../components/FormModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { SearchableCombobox } from '../../components/SearchBar.jsx';
import Toast from '../../components/Toast.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { formatDate, formatDateOnly, formatNumber } from '../../services/formatters.js';
import { taskService } from '../../services/taskService.js';
import { userService } from '../../services/userService.js';
import { formatTaskDisplayDescription, formatTaskDisplayTitle } from '../../utils/taskDisplay.js';

const initialForm = {
  title: '',
  description: '',
  assignedTo: '',
  priority: 'medium',
  dueDate: '',
};

const initialFilters = {
  search: '',
  status: '',
  priority: '',
  assignedTo: '',
  assignedToMe: false,
  department: '',
  overdueOnly: false,
  startDate: '',
  endDate: '',
};

const priorityLabels = { low: 'Düşük', medium: 'Orta', high: 'Yüksek' };
const statusLabels = { pending: 'Bekliyor', 'in-progress': 'Devam Ediyor', completed: 'Tamamlandı' };

const PRIORITY_META = {
  high: { icon: ArrowUp, className: 'task-badge-high', label: 'Yüksek' },
  medium: { icon: ArrowRight, className: 'task-badge-medium', label: 'Orta' },
  low: { icon: ArrowDown, className: 'task-badge-low', label: 'Düşük' },
};

const STATUS_META = {
  pending: { icon: Clock, className: 'task-badge-pending', label: 'Bekliyor' },
  'in-progress': { icon: Loader, className: 'task-badge-progress', label: 'Devam Ediyor' },
  completed: { icon: CheckCircle2, className: 'task-badge-completed', label: 'Tamamlandı' },
};

function TaskBadge({ meta }) {
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span className={`task-badge ${meta.className}`}>
      <Icon size={13} />
      {meta.label}
    </span>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const normalizeDepartment = (value) => {
  const text = String(value || '').trim();
  return text || 'Operasyon';
};

const formatRemaining = (dueDate) => {
  if (!dueDate) return '-';
  const dueMs = new Date(dueDate).getTime();
  if (!Number.isFinite(dueMs)) return '-';
  const diff = dueMs - Date.now();
  const abs = Math.abs(diff);

  if (abs < HOUR_MS) {
    const minutes = Math.max(1, Math.floor(abs / (60 * 1000)));
    return diff < 0 ? `${minutes} dk gecikti` : `${minutes} dk kaldı`;
  }

  if (abs < DAY_MS) {
    const hours = Math.max(1, Math.floor(abs / HOUR_MS));
    return diff < 0 ? `${hours} saat gecikti` : `${hours} saat kaldı`;
  }

  const days = Math.max(1, Math.floor(abs / DAY_MS));
  return diff < 0 ? `${days} gün gecikti` : `${days} gün kaldı`;
};

const formatOverdueBadgeLabel = (dueDate) => {
  if (!dueDate) return 'Gecikmiş';
  const dueMs = new Date(dueDate).getTime();
  if (!Number.isFinite(dueMs)) return 'Gecikmiş';

  const overdueMs = Date.now() - dueMs;
  if (overdueMs <= 0) return 'Gecikmiş';

  const totalHours = Math.max(1, Math.floor(overdueMs / HOUR_MS));

  if (totalHours < 24) {
    return `${totalHours} saat gecikti`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days} gün ${hours} saat gecikti` : `${days} gün gecikti`;
};

const getDeadlineMeta = (task) => {
  if (!task?.dueDate || task.status === 'completed') {
    return { isOverdue: false, isUpcoming: false, remainingLabel: '-' };
  }

  const dueMs = new Date(task.dueDate).getTime();
  if (!Number.isFinite(dueMs)) {
    return { isOverdue: false, isUpcoming: false, remainingLabel: '-' };
  }

  const diff = dueMs - Date.now();
  return {
    isOverdue: diff < 0,
    isUpcoming: diff >= 0 && diff <= DAY_MS,
    remainingLabel: formatRemaining(task.dueDate),
    overdueBadgeLabel: diff < 0 ? formatOverdueBadgeLabel(task.dueDate) : 'Gecikmiş',
  };
};

export default function Tasks() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState(initialFilters);
  const [form, setForm] = useState(initialForm);
  const [editingItem, setEditingItem] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [viewOnlyMode, setViewOnlyMode] = useState(false);

  const isAdmin = user?.role === 'admin';

  const loadData = async () => {
    try {
      setIsLoading(true);
      const taskList = await taskService.list();
      setTasks(taskList);

      if (isAdmin) {
        const userList = await userService.list();
        setUsers(userList);
      }
    } catch (error) {
      setToast({ type: 'error', title: 'Görevler', message: error.message || 'Görevler yüklenemedi.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const usersById = useMemo(() => {
    const map = new Map();
    users.forEach((item) => map.set(item.id, item));
    return map;
  }, [users]);

  const workloadByUser = useMemo(() => {
    const map = new Map();
    tasks
      .filter((item) => item.status !== 'completed')
      .forEach((item) => {
        if (!item.assignedTo) return;
        map.set(item.assignedTo, (map.get(item.assignedTo) || 0) + 1);
      });
    return map;
  }, [tasks]);

  const departmentOptions = useMemo(() => {
    const set = new Set(users.map((item) => normalizeDepartment(item.department)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [users]);

  const filteredRows = useMemo(() => {
    return tasks.filter((item) => {
      const deadlineMeta = getDeadlineMeta(item);
      const matchesSearch =
        !filters.search ||
        [item.taskNo, item.title, formatTaskDisplayTitle(item), item.description, formatTaskDisplayDescription(item), item.assigneeName]
          .filter(Boolean)
          .some((v) => v.toLowerCase().includes(filters.search.toLowerCase()));
      const matchesStatus = !filters.status || item.status === filters.status;
      const matchesPriority = !filters.priority || item.priority === filters.priority;
      const matchesAssignee = !filters.assignedTo || item.assignedTo === filters.assignedTo;
      const matchesMine = !filters.assignedToMe || item.assignedTo === user?.id;
      const department = normalizeDepartment(usersById.get(item.assignedTo)?.department);
      const matchesDepartment = !filters.department || department === filters.department;
      const matchesOverdue = !filters.overdueOnly || deadlineMeta.isOverdue;

      const referenceDate = new Date(item.dueDate || item.createdAt || 0).getTime();
      const startDateMs = filters.startDate ? new Date(`${filters.startDate}T00:00:00`).getTime() : 0;
      const endDateMs = filters.endDate ? new Date(`${filters.endDate}T23:59:59`).getTime() : 0;
      const matchesStart = !startDateMs || (Number.isFinite(referenceDate) && referenceDate >= startDateMs);
      const matchesEnd = !endDateMs || (Number.isFinite(referenceDate) && referenceDate <= endDateMs);

      return matchesSearch && matchesStatus && matchesPriority && matchesAssignee && matchesMine && matchesDepartment && matchesOverdue && matchesStart && matchesEnd;
    });
  }, [filters, tasks, user?.id, usersById]);

  const summary = useMemo(
    () => {
      const overdue = tasks.filter((task) => getDeadlineMeta(task).isOverdue).length;
      const upcoming = tasks.filter((task) => getDeadlineMeta(task).isUpcoming).length;
      const myTasks = tasks.filter((task) => task.assignedTo === user?.id && task.status !== 'completed').length;
      return {
        total: tasks.length,
        pending: tasks.filter((t) => t.status === 'pending').length,
        inProgress: tasks.filter((t) => t.status === 'in-progress').length,
        completed: tasks.filter((t) => t.status === 'completed').length,
        overdue,
        upcoming,
        myTasks,
      };
    },
    [tasks, user?.id]
  );

  const openCreateModal = () => {
    setEditingItem(null);
    setForm(initialForm);
    setViewOnlyMode(false);
    setIsModalOpen(true);
  };

  const openEditModal = (item, { readOnly = false } = {}) => {
    setEditingItem(item);
    const isReadOnly = Boolean(readOnly);
    setForm({
      title: isReadOnly ? formatTaskDisplayTitle(item) : item.title,
      description: isReadOnly ? formatTaskDisplayDescription(item) : item.description || '',
      assignedTo: item.assignedTo || '',
      priority: item.priority || 'medium',
      dueDate: item.dueDate ? item.dueDate.slice(0, 10) : '',
    });
    setViewOnlyMode(isReadOnly);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setForm(initialForm);
    setEditingItem(null);
    setViewOnlyMode(false);
  };

  const assigneeOptions = useMemo(
    () => users.map((candidate) => ({
      value: candidate.id,
      label: candidate.name || candidate.username || 'İsimsiz Personel',
      secondary: candidate.registerPin ? `Sicil No: ${candidate.registerPin}` : 'Sicil No: -',
      searchText: [candidate.name, candidate.username, candidate.email, candidate.registerPin].filter(Boolean).join(' '),
    })),
    [users]
  );

  const handleFormChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (viewOnlyMode) {
      closeModal();
      return;
    }

    if (!form.title.trim()) {
      setToast({ type: 'error', title: 'Görevler', message: 'Görev bağlışı zorunludur.' });
      return;
    }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      assignedTo: form.assignedTo || undefined,
      priority: form.priority,
      dueDate: form.dueDate || undefined,
    };

    try {
      setSubmitting(true);
      if (editingItem) {
        await taskService.update(editingItem.id, payload);
        setToast({ type: 'success', title: 'Görevler', message: 'Görev güncellendi.' });
      } else {
        await taskService.create(payload);
        setToast({ type: 'success', title: 'Görevler', message: 'Yeni görev oluşturuldu.' });
      }
      closeModal();
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Görevler', message: error.message || 'İşlem başarısız.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (task) => {
    try {
      await taskService.toggleStatus(task.id);
      setToast({
        type: 'success',
        title: 'Görevler',
        message: task.status === 'completed' ? 'Görev yeniden açıldı.' : 'Görev tamamlandı.',
      });
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Görevler', message: error.message || 'Durum değiştirilemedi.' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await taskService.remove(deleteTarget.id);
      setToast({ type: 'success', title: 'Görevler', message: 'Görev silindi.' });
      setDeleteTarget(null);
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Görevler', message: error.message || 'Görev silinemedi.' });
      setDeleteTarget(null);
    }
  };

  const columns = [
    { key: 'taskNo', label: 'Görev No', render: (row) => row.taskNo || '-' },
    { key: 'title', label: 'Görev', render: (row) => formatTaskDisplayTitle(row) },
    {
      key: 'assigneeName',
      label: 'Atanan Kişi',
      render: (row) => {
        if (!row.assigneeName) {
          return <span className="muted-text">Atanmadı</span>;
        }
        const count = workloadByUser.get(row.assignedTo) || 0;
        return (
          <div className="task-assignee-cell" title={`Açık görev: ${count}`}>
            <strong>{row.assigneeName}</strong>
            <small>{count} açık görev</small>
          </div>
        );
      },
    },
    {
      key: 'priority',
      label: 'Öncelik',
      render: (row) => <TaskBadge meta={PRIORITY_META[row.priority]} />,
    },
    {
      key: 'status',
      label: 'Durum',
      render: (row) => <TaskBadge meta={STATUS_META[row.status]} />,
    },
    {
      key: 'startDate',
      label: 'Başlangıç Tarihi',
      render: (row) => formatDate(row.startDate || row.createdAt),
      sortValue: (row) => new Date(row.startDate || row.createdAt || 0).getTime(),
    },
    {
      key: 'dueDate',
      label: 'Son Tarih',
      render: (row) => {
        if (!row.dueDate) return '-';
        const meta = getDeadlineMeta(row);
        return (
          <div className="task-deadline-cell">
            <span>{formatDateOnly(row.dueDate)}</span>
            {meta.isOverdue ? <span className="task-deadline-badge is-overdue">{meta.overdueBadgeLabel}</span> : null}
            {!meta.isOverdue && meta.isUpcoming ? <span className="task-deadline-badge is-upcoming">Yaklaşıyor</span> : null}
          </div>
        );
      },
      sortValue: (row) => (row.dueDate ? new Date(row.dueDate).getTime() : 0),
    },
    {
      key: 'creatorName',
      label: 'Oluşturan',
      render: (row) => row.creatorName || '-',
    },
    {
      key: 'updatedAt',
      label: 'Güncelleme',
      render: (row) => formatDate(row.updatedAt),
      sortValue: (row) => new Date(row.updatedAt).getTime(),
    },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      className: 'tasks-actions-cell',
      render: (row) => {
        const isAssignedUser = row.assignedTo === user?.id;

        return (
        <div className="table-actions">
          {(isAdmin || isAssignedUser) && (
            <button
              className={`text-button ${row.status === 'completed' ? 'warning' : 'success'} ${isAssignedUser ? '' : 'is-disabled'}`}
              type="button"
              onClick={() => handleToggle(row)}
              disabled={!isAssignedUser}
            >
              {row.status === 'completed' ? 'Geri Al' : 'Tamamla'}
            </button>
          )}
          {isAdmin && (
            <>
              <button className="text-button" type="button" onClick={() => openEditModal(row)}>
                Düzenle
              </button>
              <button className="text-button danger" type="button" onClick={() => setDeleteTarget(row)}>
                Sil
              </button>
            </>
          )}
        </div>
      );
      },
    },
  ];

  useEffect(() => {
    const openTaskId = location.state?.openTaskId;
    if (!openTaskId || tasks.length === 0) {
      return;
    }

    const targetTask = tasks.find((item) => item.id === openTaskId);
    if (targetTask) {
      openEditModal(targetTask, { readOnly: true });
    }

    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate, tasks]);

  return (
    <div className="page-stack tasks-page">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageHeader
        className="dashboard-hero"
        icon={<ClipboardList size={22} />}
        title="Görev Planlama"
        description="Görevleri planlayın, atayın ve ilerlemeyi takip edin."
        actions={
          isAdmin ? (
            <button className="primary-button task-plan-button" type="button" onClick={openCreateModal}>
              <Plus size={16} /> Görev Planla
            </button>
          ) : null
        }
      />

      <section className="mod-summary-grid task-summary-grid">
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-blue"><ClipboardList size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Toplam Görev</span>
            <span className="mod-stat-value">{formatNumber(summary.total)}</span>
            <span className="mod-stat-caption">Sistemdeki tüm görevler</span>
          </div>
        </div>
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-amber"><Clock size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Bekleyen</span>
            <span className="mod-stat-value">{formatNumber(summary.pending)}</span>
            <span className="mod-stat-caption">İşlem bekleyen görevler</span>
          </div>
        </div>
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-indigo"><Loader size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Devam Eden</span>
            <span className="mod-stat-value">{formatNumber(summary.inProgress)}</span>
            <span className="mod-stat-caption">Aktif yürütülen görevler</span>
          </div>
        </div>
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-green"><CheckCircle2 size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Tamamlanan</span>
            <span className="mod-stat-value">{formatNumber(summary.completed)}</span>
            <span className="mod-stat-caption">Bitirilen görevler</span>
          </div>
        </div>
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-rose"><AlertTriangle size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Geciken</span>
            <span className="mod-stat-value">{formatNumber(summary.overdue)}</span>
            <span className="mod-stat-caption">Son tarihi aşan görevler</span>
          </div>
        </div>
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-amber"><Clock size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Yaklaşan</span>
            <span className="mod-stat-value">{formatNumber(summary.upcoming)}</span>
            <span className="mod-stat-caption">Yaklaşan teslim tarihleri</span>
          </div>
        </div>
        <div className="mod-stat">
          <div className="mod-stat-icon mod-icon-indigo"><Search size={20} /></div>
          <div className="mod-stat-body">
            <span className="mod-stat-label">Bana Atananlar</span>
            <span className="mod-stat-value">{formatNumber(summary.myTasks)}</span>
            <span className="mod-stat-caption">Size atanmış görevler</span>
          </div>
        </div>
      </section>

      <div className="mod-card task-filter-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-violet"><Filter size={18} /></div>
          <div><h3>Filtreler</h3><p>Görevleri daraltmak için filtreleyin</p></div>
        </div>
        <FilterBar>
          <label className="field-group">
            <span>Arama</span>
            <input value={filters.search} onChange={(e) => setFilters((c) => ({ ...c, search: e.target.value }))} placeholder="Görev no veya görev adı ara" />
          </label>
          <label className="field-group">
            <span>Durum</span>
            <select value={filters.status} onChange={(e) => setFilters((c) => ({ ...c, status: e.target.value }))}>
              <option value="">Tüm Durumlar</option>
              <option value="pending">Bekliyor</option>
              <option value="in-progress">Devam Ediyor</option>
              <option value="completed">Tamamlandı</option>
            </select>
          </label>
          <label className="field-group">
            <span>Öncelik</span>
            <select value={filters.priority} onChange={(e) => setFilters((c) => ({ ...c, priority: e.target.value }))}>
              <option value="">Tüm Öncelikler</option>
              <option value="high">Yüksek</option>
              <option value="medium">Orta</option>
              <option value="low">Düşük</option>
            </select>
          </label>
          <label className="field-group">
            <span>Başlangıç Tarihi</span>
            <input type="date" value={filters.startDate} onChange={(e) => setFilters((c) => ({ ...c, startDate: e.target.value }))} />
          </label>
          <label className="field-group">
            <span>Bitiş Tarihi</span>
            <input type="date" value={filters.endDate} onChange={(e) => setFilters((c) => ({ ...c, endDate: e.target.value }))} />
          </label>
          {isAdmin && (
            <label className="field-group">
              <span>Departman</span>
              <select value={filters.department} onChange={(e) => setFilters((c) => ({ ...c, department: e.target.value }))}>
                <option value="">Tüm Departmanlar</option>
                {departmentOptions.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </label>
          )}
          {isAdmin && (
            <label className="field-group">
              <span>Atanan Kişi</span>
              <select value={filters.assignedTo} onChange={(e) => setFilters((c) => ({ ...c, assignedTo: e.target.value }))}>
                <option value="">Tüm Personel</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
          )}
        </FilterBar>
      </div>

      <div className="mod-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-blue"><ClipboardList size={18} /></div>
          <div><h3>Görev Listesi</h3><p>Tüm görevleri görüntüleyin ve yönetin</p></div>
        </div>
        <DataTable columns={columns} rows={filteredRows} isLoading={isLoading} emptyMessage="Görev bulunmuyor." initialSort={{ key: 'updatedAt', direction: 'desc' }} pageSize={10} />
      </div>

      <FormModal
        isOpen={isModalOpen}
        title={viewOnlyMode ? 'Görev Detayı' : editingItem ? 'Görev Düzenle' : 'Yeni Görev Ekle'}
        description={viewOnlyMode ? 'Bildirimden açılan görev bilgisi.' : editingItem ? 'Seçili görev bilgisini bu alandan güncelleyebilirsiniz.' : 'Bu kısımdan yeni görev ekleyebilirsiniz.'}
        headerIcon={editingItem ? <ClipboardList size={17} /> : <Plus size={17} />}
        onClose={closeModal}
        modalClassName="task-form-fit-modal"
      >
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="form-grid two-columns">
            <label className="field-group full-span">
              <span>Görev Başlığı</span>
              <input name="title" value={form.title} onChange={handleFormChange} disabled={viewOnlyMode} />
            </label>
            <label className="field-group full-span">
              <span>Açıklama</span>
              <textarea name="description" rows="3" value={form.description} onChange={handleFormChange} disabled={viewOnlyMode}></textarea>
            </label>
            <label className="field-group task-assignee-field">
              <span>Ara ya da Seç</span>
              <SearchableCombobox
                options={assigneeOptions}
                value={form.assignedTo}
                onChange={(nextValue) => setForm((current) => ({ ...current, assignedTo: nextValue }))}
                placeholder="Personel adı veya sicil no ara"
                noResultsText="Sonuç bulunamadı"
                ariaLabel="Atanacak personeli seç"
                disabled={isLoading || viewOnlyMode}
              />
            </label>
            <div className="field-group task-priority-field">
              <span>Öncelik</span>
              <div className="task-priority-radio-group" role="radiogroup" aria-label="Görev öncelişi">
                <label className="task-priority-radio task-priority-low">
                  <input type="radio" name="priority" value="low" checked={form.priority === 'low'} onChange={handleFormChange} disabled={viewOnlyMode} />
                  <span>Düşük</span>
                </label>
                <label className="task-priority-radio task-priority-medium">
                  <input type="radio" name="priority" value="medium" checked={form.priority === 'medium'} onChange={handleFormChange} disabled={viewOnlyMode} />
                  <span>Orta</span>
                </label>
                <label className="task-priority-radio task-priority-high">
                  <input type="radio" name="priority" value="high" checked={form.priority === 'high'} onChange={handleFormChange} disabled={viewOnlyMode} />
                  <span>Yüksek</span>
                </label>
              </div>
            </div>
            <label className="field-group">
              <span>Son Tarih</span>
              <input name="dueDate" type="date" value={form.dueDate} onChange={handleFormChange} disabled={viewOnlyMode} />
            </label>
          </div>
          <div className="modal-actions">
            <button className="ghost-button" type="button" onClick={closeModal}>{viewOnlyMode ? 'Kapat' : 'İptal'}</button>
            {!viewOnlyMode ? <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Kaydediliyor...' : editingItem ? 'Güncelle' : 'Kaydet'}</button> : null}
          </div>
        </form>
      </FormModal>

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        title="Görev Sil"
        description={deleteTarget ? `"${deleteTarget.title}" görevini silmek istedişinize emin misiniz?` : ''}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        confirmText="Sil"
      />
    </div>
  );
}
