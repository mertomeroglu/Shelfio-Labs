import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, Loader2, Search, X, ClipboardList } from 'lucide-react';
import { taskService } from '../../services/taskService.js';
import { useAuth } from '../../hooks/useAuth.js';
import { formatTaskDisplayDescription, formatTaskDisplayTitle } from '../../utils/taskDisplay.js';

const PRIORITY_META = {
  low: { label: 'Düşük', className: 'green' },
  medium: { label: 'Orta', className: 'amber' },
  high: { label: 'Yüksek', className: 'red' },
};

const STATUS_LABELS = {
  completed: 'Tamamlandı',
  pending: 'Bekliyor',
  'in-progress': 'Devam Ediyor',
  cancelled: 'İptal Edildi',
  overdue: 'Gecikmiş',
  archived: 'Arşivlendi',
  awaiting_approval: 'Onay Bekliyor',
};

function toPriorityKey(value) {
  const text = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (text === 'high' || text === 'yuksek' || text === 'yüksek' || text === 'kritik') return 'high';
  if (text === 'medium' || text === 'orta') return 'medium';
  return 'low';
}

function toStatusKey(value) {
  const text = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (text === 'completed' || text === 'completade' || text === 'tamamlandi' || text === 'tamamlandı') return 'completed';
  if (text === 'cancelled' || text === 'canceled' || text === 'iptal') return 'cancelled';
  if (text === 'archived' || text === 'arsiv' || text === 'arşiv') return 'archived';
  if (text === 'awaiting_approval' || text === 'awaiting approval' || text === 'onay bekliyor') return 'awaiting_approval';
  if (text === 'in-progress' || text === 'in_progress' || text === 'devam eden') return 'in-progress';
  if (text === 'overdue' || text === 'gecikmis' || text === 'gecikmiş') return 'overdue';
  return 'pending';
}

function getStatusLabel(value) {
  return STATUS_LABELS[toStatusKey(value)] || STATUS_LABELS.pending;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeTaskRow(task = {}, index = 0) {
  const id = String(task.id || '').trim();
  const fallbackId = String(task.taskNo || task.referenceNo || task.referenceId || `${task.title || 'task'}-${task.createdAt || task.updatedAt || ''}-${index}`).trim();
  const stableId = id || fallbackId || `task-${index}`;
  const clientKey = String(task.clientKey || stableId || `task-${index}`);
  return { ...task, id: stableId, clientKey };
}

function normalizeIdentityValue(value) {
  return String(value || '').trim().toLocaleLowerCase('tr-TR');
}

function isTaskAssignedToCurrentUser(task = {}, user = {}) {
  if (!user) return false;

  const userKeys = new Set(
    [
      user?.id,
      user?.userId,
      user?.personnelId,
      user?.staffId,
      user?.username,
      user?.email,
      user?.name,
    ]
      .map(normalizeIdentityValue)
      .filter(Boolean)
  );

  if (userKeys.size === 0) return false;

  return [
    task?.assignedTo,
    task?.userId,
    task?.assigneeUserId,
    task?.personnelId,
    task?.staffId,
    task?.assignedPersonId,
    task?.assignedUserId,
    task?.assignedStaffId,
    task?.assigneeId,
    task?.assigneeUsername,
    task?.assigneeEmail,
    task?.assigneeName,
  ]
    .map(normalizeIdentityValue)
    .filter(Boolean)
    .some((value) => userKeys.has(value));
}

function TaskDetailModal({ task, onClose }) {
  if (!task) return null;
  const priority = PRIORITY_META[task.priorityKey] || PRIORITY_META.low;
  const statusKey = toStatusKey(task.status);

  return (
    <div className="personnel-modal-overlay" role="dialog" aria-modal="true" aria-label="Görev detayı">
      <div className="personnel-modal-card">
        <header className="personnel-modal-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <ClipboardList size={18} color="var(--p-accent)" />
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--p-ink)' }}>Görev Detayı</h3>
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>{formatTaskDisplayTitle(task)}</p>
          </div>
          <button type="button" className="personnel-modal-close" onClick={onClose} aria-label="Kapat">
            <X size={20} />
          </button>
        </header>

        <div className="personnel-modal-body">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <span className={`personnel-badge ${priority.className}`}>{priority.label}</span>
            <span className="personnel-badge neutral">{getStatusLabel(task.status)}</span>
          </div>

          <div className="personnel-info-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <div><span>Görev No</span><strong>{task.taskNo || '-'}</strong></div>
            <div><span>Atanan</span><strong>{task.assigneeName || 'Atama yok'}</strong></div>
            <div><span>Başlangıç</span><strong>{formatDate(task.createdAt)}</strong></div>
            <div><span>Son Tarih</span><strong>{formatDate(task.dueDate)}</strong></div>
          </div>

          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
            <span style={{ display: 'block', fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>Açıklama</span>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{formatTaskDisplayDescription(task) || 'Açıklama bulunmuyor.'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PersonnelTasks() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [togglingId, setTogglingId] = useState('');
  const [detailTask, setDetailTask] = useState(null);

  const loadTasks = useCallback(async () => {
    const currentUserId = String(user?.id || user?.userId || '').trim();
    const rows = await taskService.list(currentUserId ? { assignedTo: currentUserId } : {});
    const normalized = Array.isArray(rows) ? rows.map((row, index) => normalizeTaskRow(row, index)) : [];

    const byId = new Map();
    normalized.forEach((item) => {
      const key = String(item.id || item.clientKey || '');
      if (!key) return;
      const prev = byId.get(key);
      if (!prev) {
        byId.set(key, item);
        return;
      }
      const prevTime = new Date(prev.updatedAt || prev.createdAt || 0).getTime();
      const nextTime = new Date(item.updatedAt || item.createdAt || 0).getTime();
      if (nextTime >= prevTime) byId.set(key, item);
    });

    setTasks(Array.from(byId.values()));
  }, [user?.id, user?.userId]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setLoading(true);
      try {
        if (!mounted) return;
        await loadTasks();
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [loadTasks]);

  const normalizedTasks = useMemo(
    () => tasks
      .map((item) => {
        const isMine = isTaskAssignedToCurrentUser(item, user);
        return { ...item, priorityKey: toPriorityKey(item.priority), statusKey: toStatusKey(item.status), isMine };
      })
      .filter((item) => item.isMine),
    [tasks, user]
  );

  const filteredTasks = useMemo(() => {
    const needle = searchQuery.trim().toLocaleLowerCase('tr-TR');
    return normalizedTasks.filter((item) => {
      if (statusFilter !== 'all' && item.statusKey !== statusFilter) return false;
      if (!needle) return true;
      return (
        String(item.title || '').toLocaleLowerCase('tr-TR').includes(needle)
        || formatTaskDisplayTitle(item).toLocaleLowerCase('tr-TR').includes(needle)
        || String(item.description || '').toLocaleLowerCase('tr-TR').includes(needle)
        || formatTaskDisplayDescription(item).toLocaleLowerCase('tr-TR').includes(needle)
        || String(item.taskNo || '').toLocaleLowerCase('tr-TR').includes(needle)
      );
    });
  }, [normalizedTasks, searchQuery, statusFilter]);

  const handleToggle = async (task) => {
    if (!task?.id || togglingId) return;
    setTogglingId(task.id);
    try {
      const nextStatus = task.statusKey === 'in-progress' || task.statusKey === 'pending' || task.statusKey === 'awaiting_approval' ? 'completed' : 'pending';
      if (nextStatus === 'completed') {
        await taskService.update(task.id, { status: 'completed' });
      } else {
        await taskService.toggleStatus(task.id);
      }
      await loadTasks();
    } finally {
      setTogglingId('');
    }
  };

  if (loading) return <div className="personnel-empty-state">Görevler yükleniyor...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="personnel-search-wrapper">
          <Search size={20} />
          <input className="personnel-input" placeholder="Görev ara..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <select className="personnel-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Tüm Durumlar</option>
          <option value="pending">Bekleyen</option>
          <option value="in-progress">Devam Eden</option>
          <option value="awaiting_approval">Onay Bekleyen</option>
          <option value="completed">Tamamlanan</option>
        </select>
      </div>

      {filteredTasks.length === 0 ? <div className="personnel-empty-state">Eşleşen görev bulunamadı.</div> : (
        <ul className="personnel-list" style={{ padding: 0, margin: 0, listStyle: 'none' }}>
          {filteredTasks.map((task) => {
            const isDone = task.statusKey === 'completed';
            const themeClass = isDone ? 'theme-green' : task.statusKey === 'pending' || task.statusKey === 'awaiting_approval' ? 'theme-red' : 'theme-amber';
            return (
              <li key={task.id || task.clientKey} className={`personnel-list-card ${themeClass}`}>
                <div className="personnel-list-card-header">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                    <div className="personnel-traffic-lights">
                      <span className={task.priorityKey === 'low' ? 'active green' : 'green'} />
                      <span className={task.priorityKey === 'medium' ? 'active amber' : 'amber'} />
                      <span className={task.priorityKey === 'high' ? 'active red' : 'red'} />
                    </div>
                    <h3 className="personnel-list-card-title">{formatTaskDisplayTitle(task)}</h3>
                    <div className="personnel-list-card-meta">{task.taskNo || '-'} • {formatDate(task.updatedAt || task.createdAt)}</div>
                  </div>
                </div>

                <div className="personnel-list-card-actions">
                  <button type="button" className="secondary-button" onClick={() => setDetailTask(task)} aria-label="Görev detayı">
                    <Info size={16} /> Detay
                  </button>
                  <button type="button" className={isDone ? 'ghost-button' : 'primary-button'} disabled={togglingId === task.id || !task.isMine} onClick={() => handleToggle(task)}>
                    {togglingId === task.id ? <Loader2 size={16} /> : null}
                    {isDone ? 'Geri Al' : 'Tamamla'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {detailTask ? <TaskDetailModal task={detailTask} onClose={() => setDetailTask(null)} /> : null}
    </div>
  );
}
