import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  AlertTriangle,
  ArrowRightLeft,
  Ban,
  Boxes,
  ChevronLeft,
  CheckCheck,
  ClipboardList,
  Clock3,
  Expand,
  GripVertical,
  Info,
  KanbanSquare,
  List,
  LogIn,
  Minimize2,
  Package,
  Play,
  Power,
  Square,
  CheckSquare,
  Timer,
  Truck,
  UserCircle2,
  X,
} from 'lucide-react';
import DataTable from '../../components/DataTable.jsx';
import FilterBar from '../../components/FilterBar.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import Toast from '../../components/Toast.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { useLocation, useNavigate } from 'react-router-dom';
import { formatDate, formatNumber } from '../../services/formatters.js';
import { sectionService } from '../../services/sectionService.js';

const STATUS_META = {
  pending: { label: 'Bekliyor', tone: 'warning', css: 'warehouse-status-yellow', icon: Clock3 },
  approved: { label: 'Onaylandı', tone: 'primary', css: 'warehouse-status-blue', icon: Boxes },
  in_progress: { label: 'İşlemde', tone: 'warning', css: 'warehouse-status-orange', icon: Timer },
  completed: { label: 'Tamamlandı', tone: 'success', css: 'warehouse-status-green', icon: Package },
  rejected: { label: 'Reddedildi', tone: 'danger', css: 'warehouse-status-red', icon: X },
  failed: { label: 'Hatalı İşlem', tone: 'danger', css: 'warehouse-status-red', icon: AlertTriangle },
  cancelled: { label: 'İptal Edildi', tone: 'neutral', css: 'warehouse-status-slate', icon: Archive },
  archived: { label: 'Arşiv', tone: 'neutral', css: 'warehouse-status-slate', icon: Archive },
  unknown: { label: 'Durum Bilinmiyor', tone: 'neutral', css: 'warehouse-status-slate', icon: AlertTriangle },
};
const STATUS_OPTIONS = ['pending', 'approved', 'in_progress', 'completed', 'failed', 'rejected', 'cancelled', 'archived'];
const WORKFLOW_STATUSES = ['pending', 'approved', 'in_progress', 'completed'];
const ARCHIVE_ELIGIBLE_STATUSES = ['completed', 'failed', 'rejected', 'cancelled', 'archived'];
const SLA_HOURS = 2;
const LIST_PAGE_SIZE = 5;
const ARCHIVE_HOLD_MS = 12 * 60 * 60 * 1000;

const normalizeStatusKey = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'unknown';
  const normalized = raw
    .toLocaleLowerCase('tr-TR')
    .replace(/[ç]/g, 'c')
    .replace(/[ğ]/g, 'g')
    .replace(/[ı]/g, 'i')
    .replace(/[ö]/g, 'o')
    .replace(/[ş]/g, 's')
    .replace(/[ü]/g, 'u')
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');

  const aliases = {
    pending: 'pending',
    bekliyor: 'pending',
    approved: 'approved',
    onaylandi: 'approved',
    queued: 'approved',
    siraya_alindi: 'approved',
    hazirlaniyor: 'approved',
    in_progress: 'in_progress',
    inprogress: 'in_progress',
    islemde: 'in_progress',
    gerceklestiriliyor: 'in_progress',
    completed: 'completed',
    tamamlandi: 'completed',
    rejected: 'rejected',
    reddedildi: 'rejected',
    failed: 'failed',
    error: 'failed',
    hatali_islem: 'failed',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    iptal: 'cancelled',
    iptal_edildi: 'cancelled',
    archived: 'archived',
    arsiv: 'archived',
  };

  return aliases[normalized] || 'unknown';
};

const toStatusLabel = (statusKey) => STATUS_META[statusKey]?.label || STATUS_META.unknown.label;
const toStatusTone = (statusKey) => STATUS_META[statusKey]?.tone || STATUS_META.unknown.tone;
const toStatusClass = (statusKey) => STATUS_META[statusKey]?.css || STATUS_META.unknown.css;

const renderStatusIcon = (statusKey) => {
  const Icon = STATUS_META[statusKey]?.icon;
  if (!Icon) return null;
  return (
    <span className="warehouse-stage-icon">
      <Icon size={14} />
    </span>
  );
};

const normalizeTransferRow = (item = {}) => {
  const statusKey = normalizeStatusKey(item.statusKey || item.status || item.state);
  const origin = item.origin || item.source || 'manual';
  return {
    ...item,
    statusKey,
    statusLabel: toStatusLabel(statusKey),
    origin,
    source: item.source || origin,
    isAutomation: origin === 'automation',
  };
};

const PRIORITY_TONE = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

const PRIORITY_LABEL = {
  high: 'Yüksek',
  medium: 'Orta',
  low: 'Düşük',
};

const resolveSourceRackCode = (item = {}) => {
  const directCode = item.sourceLocationCode || item.sourceWarehouseLocation || item.sourceRackCode || item.sourceShelfCode;
  if (String(directCode || '').trim()) {
    return String(directCode).trim();
  }

  const note = String(item.note || '');
  const fromNote = note.match(/Kaynak\s+Depo\s+Lokasyonu\s*:\s*([^|\n]+)/i)?.[1];
  return String(fromNote || item.sourceLocation || '-').trim();
};

const resolveTargetSectionLabel = (item = {}) => {
  const number = String(item.sectionNumber || '').trim();
  const name = String(item.sectionName || '').trim();
  if (number && name) return `${number} - ${name}`;
  return name || number || '-';
};

const resolveTransferItems = (item) => {
  if (Array.isArray(item.transferItems) && item.transferItems.length) {
    return item.transferItems.map((entry, index) => ({
      id: entry.id || `${item.id}:item:${index}`,
      productName: entry.productName || item.productName || 'Ürün',
      sku: entry.sku || item.sku || '-',
      quantity: Number(entry.quantity || 0),
    }));
  }

  return [{
    id: `${item.id}:single`,
    productName: item.productName || 'Ürün',
    sku: item.sku || '-',
    quantity: Number(item.quantity || 0),
  }];
};

const getTotalQuantity = (item) => resolveTransferItems(item).reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);

const formatHistoryEvent = (entry = {}) => {
  const status = entry.toStatus ? `${entry.fromStatus || 'Başlangıç'} -> ${entry.toStatus}` : (entry.event || 'İşlem');
  const actor = entry.actorName || (entry.origin === 'automation' ? 'Otomasyon' : 'Kullanıcı');
  return `${status} / ${actor}`;
};

const TECHNICAL_MESSAGE_PATTERN = /(prisma|invocation|unknown argument|database|sql|constraint|foreign key|relation|stack|clientvalidationerror|repository|delegate)/i;

const isTechnicalMessage = (value) => TECHNICAL_MESSAGE_PATTERN.test(String(value || ''));

const transferErrorMessage = (error, fallback) => {
  const message = String(error?.payload?.message || error?.message || '').trim();
  if (!message || isTechnicalMessage(message)) return fallback;
  if (error?.status >= 500) return fallback;
  return message;
};

const compactBulkUserMessages = (results = []) => {
  const messages = (Array.isArray(results) ? results : [])
    .filter((item) => !item.ok)
    .map((item) => {
      const productName = item.productName || item.item?.productName || '';
      const message = item.userMessage || 'Talep işlenemedi.';
      return productName ? `${productName}: ${message}` : message;
    })
    .filter(Boolean);
  return [...new Set(messages)].slice(0, 3).join(' ');
};

const resolveArchiveTimestamp = (item = {}) => {
  const candidates = [item.completedAt, item.finishedAt];
  for (const candidate of candidates) {
    const timestamp = new Date(candidate || '').getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
};

const getSlaInfo = (item) => {
  const createdMs = new Date(item.createdAt).getTime();
  if (!Number.isFinite(createdMs)) {
    return { text: '-', isOverdue: false };
  }

  if (item.statusKey === 'completed') {
    return { text: 'Tamamlandı', isOverdue: false };
  }

  const dueMs = createdMs + (SLA_HOURS * 60 * 60 * 1000);
  const diffMinutes = Math.round((dueMs - Date.now()) / 60000);
  if (diffMinutes < 0) {
    return { text: 'Gecikti', isOverdue: true };
  }

  if (diffMinutes < 60) {
    return { text: `${diffMinutes} dk kaldı`, isOverdue: false };
  }

  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (!minutes) {
    return { text: `${hours} saat kaldı`, isOverdue: false };
  }

  return { text: `${hours} sa ${minutes} dk kaldı`, isOverdue: false };
};

const playWakeupTone = () => {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(720, ctx.currentTime);
    oscillator.frequency.linearRampToValueAtTime(920, ctx.currentTime + 0.22);
    gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.36);
  } catch {
    // Tarayıcı izin vermiyorsa sessizce devam et.
  }
};

export default function WarehouseTransferRequests() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const [sections, setSections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  const [updatingId, setUpdatingId] = useState('');
  const [draggingId, setDraggingId] = useState('');
  const [expandedCards, setExpandedCards] = useState({});
  const [terminalUnlocked, setTerminalUnlocked] = useState(user?.role !== 'depo_personeli');
  const [pinCode, setPinCode] = useState('');
  const [wakeSignal, setWakeSignal] = useState(false);
  const [kioskMessage, setKioskMessage] = useState('Yeni transfer talepleri bekleniyor');
  const [toast, setToast] = useState(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [rejectConfirm, setRejectConfirm] = useState({ open: false, requestId: '', productName: '', nextStatus: '', confirmText: 'Onayla', description: '' });
  const [bulkConfirm, setBulkConfirm] = useState({ open: false, action: '', ids: [] });
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState('');
  const [listPage, setListPage] = useState(1);
  const [archivePage, setArchivePage] = useState(1);
  const lastUnfilteredTotalRef = useRef(null);
  const lastActiveCountRef = useRef(0);

  const isDepotKioskUser = user?.role === 'depo_personeli';
  const kioskEnabled = isDepotKioskUser && new URLSearchParams(location.search).get('kiosk') === '1';
  const forceFullscreen = new URLSearchParams(location.search).get('fullscreen') === '1';
  const isTransferManager = user?.role === 'admin' || user?.role === 'depo_personeli';

  const loadRows = async (overrides = {}) => {
    const query = {
      status: overrides.status ?? statusFilter,
      priority: overrides.priority ?? priorityFilter,
      sectionId: overrides.sectionId ?? sectionFilter,
      search: overrides.search ?? searchFilter,
      startDate: overrides.startDate ?? startDate,
      endDate: overrides.endDate ?? endDate,
      includeHistory: overrides.includeHistory ?? true,
      limit: overrides.limit ?? 100,
    };

    try {
      if (!overrides.silent) setIsLoading(true);
      const [data, sectionList] = await Promise.all([
        sectionService.listTransferRequests(query),
        sectionService.list(),
      ]);
      const nextRows = (Array.isArray(data) ? data : []).map(normalizeTransferRow);
      setRows(nextRows);
      setSelectedIds((current) => new Set([...current].filter((id) => nextRows.some((row) => row.id === id))));
      setSections(Array.isArray(sectionList) ? sectionList : []);

      const hasActiveFilters = Boolean(
        query.status || query.priority || query.sectionId || query.search || query.startDate || query.endDate,
      );

      if (!hasActiveFilters) {
        if (lastUnfilteredTotalRef.current === null) {
          lastUnfilteredTotalRef.current = nextRows.length;
        } else {
          const isDepotOperator = user?.role === 'depo_personeli';
          if (isDepotOperator && nextRows.length > lastUnfilteredTotalRef.current) {
            setToast({ type: 'success', title: 'Depo Transfer Talepleri', message: 'Yeni transfer talebi geldi.' });
          }
          lastUnfilteredTotalRef.current = nextRows.length;
        }
      }
    } catch (error) {
      setToast({ type: 'error', title: 'Depo Transfer Talepleri', message: transferErrorMessage(error, 'Transfer talepleri yüklenemedi.') });
    } finally {
      if (!overrides.silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRows({ status: '', priority: '', sectionId: '', search: '', startDate: '', endDate: '' });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (bulkUpdating) return;
      loadRows();
    }, 20000);
    return () => clearInterval(timer);
  }, [statusFilter, priorityFilter, sectionFilter, searchFilter, startDate, endDate, bulkUpdating]);

  useEffect(() => {
    if (!fullscreenMode) {
      document.body.classList.remove('app-fullscreen-lock');
      return;
    }

    document.body.classList.add('app-fullscreen-lock');
    return () => document.body.classList.remove('app-fullscreen-lock');
  }, [fullscreenMode]);

  useEffect(() => {
    if (!fullscreenMode) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setFullscreenMode(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreenMode]);

  const toggleFullscreenMode = () => {
    setFullscreenMode((prev) => {
      const nextValue = !prev;
      if (nextValue) {
        setViewMode('kanban');
      }
      return nextValue;
    });
  };

  const handleExitRequest = () => {
    if (user?.role === 'depo_personeli') {
      setExitConfirmOpen(true);
      return;
    }
    toggleFullscreenMode();
  };

  const handleExitToLogin = () => {
    logout();
    setExitConfirmOpen(false);
    navigate('/giris', { replace: true });
  };

  const handleScreenExit = () => {
    if (kioskEnabled && terminalUnlocked) {
      handleTerminalLogout();
      return;
    }

    if (fullscreenMode || isDepotKioskUser) {
      handleExitRequest();
      return;
    }

    navigate('/anasayfa');
  };

  const canMoveTo = (fromStatus, toStatus) => {
    const fromKey = normalizeStatusKey(fromStatus);
    const toKey = normalizeStatusKey(toStatus);
    if (!fromKey || !toKey || fromKey === 'unknown' || toKey === 'unknown' || fromKey === toKey) {
      return false;
    }
    if (fromKey === 'completed' && toKey === 'archived') return true;
    const currentIndex = WORKFLOW_STATUSES.indexOf(fromKey);
    const nextIndex = WORKFLOW_STATUSES.indexOf(toKey);
    if (currentIndex >= 0 && nextIndex >= 0 && nextIndex === currentIndex + 1) {
      return true;
    }
    return false;
  };

  const canRunAction = (row, action) => canMoveTo(row.statusKey || row.status, action.status);

  const getNextWorkflowStatus = (status) => {
    const index = WORKFLOW_STATUSES.indexOf(normalizeStatusKey(status));
    if (index < 0 || index >= WORKFLOW_STATUSES.length - 1) {
      return null;
    }
    return WORKFLOW_STATUSES[index + 1];
  };

  const getPreviousWorkflowStatus = (status) => {
    const index = WORKFLOW_STATUSES.indexOf(normalizeStatusKey(status));
    if (index <= 0) {
      return null;
    }
    return WORKFLOW_STATUSES[index - 1];
  };

  const getQuickActions = (row) => {
    const status = normalizeStatusKey(row.statusKey || row.status || 'pending');
    if (status === 'completed') {
      return [
        {
          id: 'archive',
          label: toStatusLabel('archived'),
          status: 'archived',
          icon: Archive,
          tone: 'next',
        },
      ];
    }
    const previousStatus = getPreviousWorkflowStatus(status);
    const nextStatus = getNextWorkflowStatus(status);

    return [
      previousStatus ? {
        id: 'previous',
        label: toStatusLabel(previousStatus),
        status: previousStatus,
        icon: ChevronLeft,
        tone: 'previous',
      } : null,
      nextStatus ? {
        id: 'next',
        label: toStatusLabel(nextStatus),
        status: nextStatus,
        icon: ArrowRightLeft,
        tone: 'next',
      } : null,
    ].filter(Boolean);
  };

  const applyStatusUpdate = async (requestId, status, note) => {
    try {
      const statusKey = normalizeStatusKey(status);
      if (statusKey === 'unknown') return;
      setUpdatingId(`${requestId}:${statusKey}`);
      await sectionService.updateTransferRequestStatus(requestId, { status: statusKey, note: note || `${toStatusLabel(statusKey)} aksiyonu` });
      setRows((current) => current.map((entry) => (
        entry.id === requestId ? {
          ...entry,
          statusKey,
          statusLabel: toStatusLabel(statusKey),
          status: toStatusLabel(statusKey),
          completedAt: statusKey === 'completed' ? new Date().toISOString() : entry.completedAt,
          updatedAt: new Date().toISOString(),
        } : entry
      )));
      await loadRows();
    } finally {
      setUpdatingId('');
    }
  };

  const summary = useMemo(() => {
    const pending = rows.filter((item) => item.statusKey === 'pending').length;
    const queued = rows.filter((item) => item.statusKey === 'approved').length;
    const processing = rows.filter((item) => item.statusKey === 'in_progress').length;
    const completed = rows.filter((item) => item.statusKey === 'completed').length;
    const failed = rows.filter((item) => item.statusKey === 'rejected').length;
    return { total: rows.length, pending, queued, processing, completed, failed };
  }, [rows]);

  const activeTransferCount = useMemo(() => rows.filter((item) => ['pending', 'approved', 'in_progress'].includes(item.statusKey)).length, [rows]);
  const hasActiveTransfers = activeTransferCount > 0;
  const archiveRows = useMemo(() => rows.filter((item) => {
    if (!ARCHIVE_ELIGIBLE_STATUSES.includes(item.statusKey)) return false;
    if (['failed', 'rejected', 'cancelled', 'archived'].includes(item.statusKey)) return true;
    const archiveTimestamp = resolveArchiveTimestamp(item);
    if (!archiveTimestamp) return false;
    return archiveTimestamp <= (Date.now() - ARCHIVE_HOLD_MS);
  }), [rows]);
  const archivedIds = useMemo(() => new Set(archiveRows.map((item) => item.id)), [archiveRows]);
  const activeFlowRows = useMemo(() => rows.filter((item) => !archivedIds.has(item.id)), [archivedIds, rows]);

  useEffect(() => {
    if (!kioskEnabled) return;
    setFullscreenMode(true);
    setViewMode('kanban');
  }, [kioskEnabled]);

  useEffect(() => {
    if (!forceFullscreen) return;
    setFullscreenMode(true);
    setViewMode('kanban');
  }, [forceFullscreen]);

  useEffect(() => {
    if (!kioskEnabled) return;

    const previous = lastActiveCountRef.current;
    if (activeTransferCount > previous) {
      lastActiveCountRef.current = activeTransferCount;
      setWakeSignal(true);
      setKioskMessage('Yeni transfer talebi geldi');
      setFullscreenMode(true);
      setViewMode('kanban');
      playWakeupTone();
      const timerId = setTimeout(() => setWakeSignal(false), 3000);
      return () => clearTimeout(timerId);
    }

    if (!activeTransferCount) {
      setKioskMessage('Yeni transfer talepleri bekleniyor');
      setWakeSignal(false);
    }

    lastActiveCountRef.current = activeTransferCount;
    return undefined;
  }, [activeTransferCount, kioskEnabled]);

  useEffect(() => {
    setListPage(1);
  }, [statusFilter, priorityFilter, sectionFilter, searchFilter, startDate, endDate]);

  const handleTerminalLogin = () => {
    if (!kioskEnabled) return;
    const expectedPin = String(user?.registerPin || '');
    if (expectedPin && pinCode !== expectedPin) {
      setToast({ type: 'error', title: 'Depo Terminali', message: 'PIN doğrulaması başarısız.' });
      return;
    }

    setTerminalUnlocked(true);
    setPinCode('');
    setToast({ type: 'success', title: 'Depo Terminali', message: 'Operasyon ekranına giriş yapıldı.' });
  };

  const handleTerminalLogout = () => {
    setTerminalUnlocked(false);
    setPinCode('');
    setViewMode('kanban');
    setKioskMessage(hasActiveTransfers ? 'Yeni transfer talebi geldi' : 'Yeni transfer talepleri bekleniyor');
  };

  const updateStatus = async (requestId, status) => {
    const target = rows.find((item) => item.id === requestId);
    if (!target) return;
    if (!canMoveTo(target.statusKey || target.status, status)) return;

    try {
      await applyStatusUpdate(requestId, status);
      setToast({ type: 'success', title: 'Depo Transfer Talepleri', message: `Talep durumu "${toStatusLabel(normalizeStatusKey(status))}" olarak güncellendi.` });
    } catch (error) {
      setToast({ type: 'error', title: 'Depo Transfer Talepleri', message: transferErrorMessage(error, 'Talep durumu güncellenemedi.') });
    }
  };

  const openRejectConfirm = (row) => {
    setRejectConfirm({
      open: true,
      requestId: row.id,
      productName: row.productName || 'Transfer Talebi',
      nextStatus: 'rejected',
      confirmText: 'Evet, İptal Et',
      description: `${row.productName || 'Transfer talebi'} kaydını iptal etmek istiyor musunuz?`,
    });
  };

  const closeRejectConfirm = () => {
    setRejectConfirm({ open: false, requestId: '', productName: '', nextStatus: '', confirmText: 'Onayla', description: '' });
  };

  const confirmRejectRequest = async () => {
    const requestId = rejectConfirm.requestId;
    const target = rows.find((item) => item.id === requestId);
    const nextStatus = rejectConfirm.nextStatus || 'rejected';

    if (!requestId || !target) {
      closeRejectConfirm();
      return;
    }

    closeRejectConfirm();
    try {
      await applyStatusUpdate(requestId, nextStatus, 'Operasyon ekranından iptal edildi');
      setToast({ type: 'success', title: 'Depo Transfer Talepleri', message: 'Talep iptal edildi.' });
    } catch (error) {
      setToast({ type: 'error', title: 'Depo Transfer Talepleri', message: transferErrorMessage(error, 'Talep iptal edilemedi.') });
    }
  };

  const applyKpiStatusFilter = (status) => {
    setStatusFilter(status);
    loadRows({ status });
  };

  const handleDropToStatus = async (targetStatus) => {
    const requestId = draggingId;
    if (!requestId) return;

    const target = rows.find((item) => item.id === requestId);
    if (!target || !canMoveTo(target.statusKey || target.status, targetStatus)) {
      setDraggingId('');
      return;
    }

    try {
      await applyStatusUpdate(requestId, targetStatus, `Sürükle-bırak ile ${toStatusLabel(normalizeStatusKey(targetStatus))}`);
      setToast({ type: 'success', title: 'Depo Transfer Talepleri', message: `Talep ${toStatusLabel(normalizeStatusKey(targetStatus))} kolonuna taşındı.` });
    } catch (error) {
      setToast({ type: 'error', title: 'Depo Transfer Talepleri', message: transferErrorMessage(error, 'Talep seçilen kolona taşınamadı.') });
    } finally {
      setDraggingId('');
    }
  };

  const toggleCardDetails = (id) => {
    setExpandedCards((current) => ({ ...current, [id]: !current[id] }));
  };

  const getDismissActionMeta = (row) => {
    const status = normalizeStatusKey(row.statusKey || row.status);
    if (status === 'pending' || status === 'approved') {
      return {
        enabled: true,
        title: 'Talebi iptal et',
        onClick: () => openRejectConfirm(row),
      };
    }
    if (status === 'in_progress') {
      return {
        enabled: false,
        title: 'İşlemdeki kayıt iptal edilemez',
        onClick: null,
      };
    }
    if (status === 'completed') {
      return {
        enabled: false,
        title: 'Tamamlanan kayıt arşive alınabilir, iptal edilemez',
        onClick: null,
      };
    }
    return {
      enabled: false,
      title: 'Bu kayıt için iptal işlemi kullanılamaz',
      onClick: null,
    };
  };

  const columns = [
    {
      key: 'select',
      label: '',
      sortable: false,
      render: (row) => (
        <button
          type="button"
          className="warehouse-select-icon"
          disabled={!canSelectRow(row)}
          onClick={() => toggleSelected(row)}
          aria-label={selectedIds.has(row.id) ? 'Seçimi kaldır' : 'Talebi seç'}
        >
          {selectedIds.has(row.id) ? <CheckSquare size={16} /> : <Square size={16} />}
        </button>
      ),
    },
    { key: 'sku', label: 'SKU' },
    { key: 'barcode', label: 'Barkod', render: (row) => row.barcode || '-' },
    {
      key: 'productName',
      label: 'Ürün',
      render: (row) => (
        <div className="transfer-product-cell">
          <strong>{row.productName}</strong>
          <span>Reyon {row.sectionNumber} / {row.sectionName}</span>
          {row.isAutomation ? <span className="warehouse-origin-badge">Otomasyon</span> : null}
        </div>
      ),
    },
    {
      key: 'quantity',
      label: 'İstenen Miktar',
      className: 'numeric-cell',
      render: (row) => <span className="numeric-badge">{formatNumber(row.quantity || 0)}</span>,
      sortValue: (row) => Number(row.quantity || 0),
    },
    {
      key: 'warehouseStockSnapshot',
      label: 'Depo Stoku',
      className: 'numeric-cell',
      render: (row) => <span className="numeric-badge">{formatNumber(row.warehouseStockSnapshot || 0)}</span>,
      sortValue: (row) => Number(row.warehouseStockSnapshot || 0),
    },
    {
      key: 'priority',
      label: 'Öncelik',
      render: (row) => <StatusBadge tone={PRIORITY_TONE[row.priority] || 'neutral'}>{PRIORITY_LABEL[row.priority] || 'Düşük'}</StatusBadge>,
      sortable: false,
    },
    {
      key: 'status',
      label: 'Durum',
      render: (row) => <StatusBadge tone={toStatusTone(row.statusKey)}>{row.statusLabel || toStatusLabel('unknown')}</StatusBadge>,
      sortable: false,
    },
    {
      key: 'history',
      label: 'Geçmiş',
      render: (row) => {
        const last = Array.isArray(row.history) ? row.history[row.history.length - 1] : null;
        return last ? (
          <span className="warehouse-history-mini">{formatHistoryEvent(last)}</span>
        ) : '-';
      },
      sortable: false,
    },
    { key: 'createdAt', label: 'Talep Zamanı', render: (row) => formatDate(row.createdAt), sortValue: (row) => new Date(row.createdAt).getTime() },
    { key: 'note', label: 'Not', render: (row) => row.note || '-' },
    {
      key: 'actions',
      label: 'İşlem',
      sortable: false,
      render: (row) => {
        if (!isTransferManager) {
          return <span className="table-placeholder">-</span>;
        }
        const dismissAction = getDismissActionMeta(row);

        return (
          <div className="table-actions always-visible transfer-actions transfer-actions-inline">
            <button
              type="button"
              className="outline-button compact-action transfer-dismiss-btn"
              disabled={!dismissAction.enabled}
              onClick={dismissAction.onClick || undefined}
              title={dismissAction.title}
              aria-label={dismissAction.title}
            >
              <X size={13} />
            </button>
            {getQuickActions(row).map((action) => {
              const Icon = action.icon;
              const isDisabled = !action.status || !canRunAction(row, action) || updatingId === `${row.id}:${action.status}`;
              return (
              <button
                key={`${row.id}:${action.id}`}
                className={`outline-button compact-action transfer-quick-btn transfer-quick-${action.tone}`}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  if (!action.status) return;
                  updateStatus(row.id, action.status);
                }}
              >
                <Icon size={13} /> {action.label}
              </button>
            );
            })}
          </div>
        );
      },
    },
  ];

  const groupedRows = useMemo(() => {
    return WORKFLOW_STATUSES.reduce((acc, status) => {
      acc[status] = activeFlowRows.filter((item) => item.statusKey === status);
      return acc;
    }, {});
  }, [activeFlowRows]);

  const archiveListRows = useMemo(
    () => [...archiveRows].sort((left, right) => (
      (resolveArchiveTimestamp(right) || new Date(right.updatedAt || right.createdAt).getTime())
      - (resolveArchiveTimestamp(left) || new Date(left.updatedAt || left.createdAt).getTime())
    )),
    [archiveRows],
  );
  const listTotalPages = Math.max(1, Math.ceil(activeFlowRows.length / LIST_PAGE_SIZE));
  const normalizedListPage = Math.min(listPage, listTotalPages);
  const listStartIndex = activeFlowRows.length ? ((normalizedListPage - 1) * LIST_PAGE_SIZE) + 1 : 0;
  const listEndIndex = activeFlowRows.length ? Math.min(normalizedListPage * LIST_PAGE_SIZE, activeFlowRows.length) : 0;
  const paginatedListRows = useMemo(() => {
    const startIndex = (normalizedListPage - 1) * LIST_PAGE_SIZE;
    return activeFlowRows.slice(startIndex, startIndex + LIST_PAGE_SIZE);
  }, [activeFlowRows, normalizedListPage]);
  const archiveTotalPages = Math.max(1, Math.ceil(archiveListRows.length / LIST_PAGE_SIZE));
  const normalizedArchivePage = Math.min(archivePage, archiveTotalPages);
  const archiveStartIndex = archiveListRows.length ? ((normalizedArchivePage - 1) * LIST_PAGE_SIZE) + 1 : 0;
  const archiveEndIndex = archiveListRows.length ? Math.min(normalizedArchivePage * LIST_PAGE_SIZE, archiveListRows.length) : 0;
  const paginatedArchiveRows = useMemo(() => {
    const startIndex = (normalizedArchivePage - 1) * LIST_PAGE_SIZE;
    return archiveListRows.slice(startIndex, startIndex + LIST_PAGE_SIZE);
  }, [archiveListRows, normalizedArchivePage]);

  const visibleSelectionRows = useMemo(() => {
    if (viewMode === 'archive') return archiveListRows;
    return activeFlowRows;
  }, [activeFlowRows, archiveListRows, viewMode]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.has(row.id)),
    [rows, selectedIds],
  );

  const selectedColumnKey = useMemo(() => {
    const statuses = [...new Set(selectedRows.map((row) => normalizeStatusKey(row.statusKey || row.status)).filter((status) => WORKFLOW_STATUSES.includes(status)))];
    return statuses.length === 1 ? statuses[0] : '';
  }, [selectedRows]);
  const selectedColumnLabel = selectedColumnKey ? toStatusLabel(selectedColumnKey) : '';
  const statusFilterKey = normalizeStatusKey(statusFilter);
  const filteredColumnKey = WORKFLOW_STATUSES.includes(statusFilterKey) ? statusFilterKey : '';
  const selectionScopeKey = selectedColumnKey || filteredColumnKey;

  const canSelectRow = (row) => {
    const status = normalizeStatusKey(row?.statusKey || row?.status);
    return !selectedColumnKey || selectedIds.has(row?.id) || status === selectedColumnKey;
  };

  const toggleSelected = (row) => {
    if (!row?.id) return;
    if (!canSelectRow(row)) return;
    const rowStatus = normalizeStatusKey(row.statusKey || row.status);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        const currentRows = rows.filter((item) => next.has(item.id));
        const currentStatuses = [...new Set(currentRows.map((item) => normalizeStatusKey(item.statusKey || item.status)).filter(Boolean))];
        if (currentStatuses.length && !currentStatuses.includes(rowStatus)) return next;
        next.add(row.id);
      }
      return next;
    });
  };

  const selectRows = (items = [], forcedStatus = '') => {
    const validItems = (items || []).filter((item) => WORKFLOW_STATUSES.includes(normalizeStatusKey(item?.statusKey || item?.status)));
    const targetStatus = normalizeStatusKey(forcedStatus) !== 'unknown'
      ? normalizeStatusKey(forcedStatus)
      : selectionScopeKey;
    const uniqueStatuses = [...new Set(validItems.map((item) => normalizeStatusKey(item.statusKey || item.status)))];
    const firstVisibleStatus = WORKFLOW_STATUSES.find((status) => uniqueStatuses.includes(status)) || '';
    const resolvedStatus = WORKFLOW_STATUSES.includes(targetStatus)
      ? targetStatus
      : (uniqueStatuses.length === 1 ? uniqueStatuses[0] : firstVisibleStatus);

    if (!resolvedStatus) {
      setToast({ type: 'info', title: 'Toplu İşlem', message: 'Toplu seçim için önce bir kolon seçin.' });
      return;
    }

    if (!WORKFLOW_STATUSES.includes(targetStatus) && uniqueStatuses.length > 1) {
      setToast({ type: 'info', title: 'Toplu İşlem', message: `${toStatusLabel(resolvedStatus)} kolonu seçildi.` });
    }

    setSelectedIds((current) => {
      const next = selectedColumnKey && selectedColumnKey === resolvedStatus ? new Set(current) : new Set();
      validItems.filter((item) => normalizeStatusKey(item.statusKey || item.status) === resolvedStatus).forEach((item) => {
        if (item?.id) next.add(item.id);
      });
      return next;
    });
  };

  const toggleColumnSelection = (status, items = []) => {
    if (selectedColumnKey === status) {
      clearSelection();
      return;
    }
    selectRows(items, status);
  };

  const clearSelection = () => setSelectedIds(new Set());

  const getBulkEligibleRows = (action, sourceRows = selectedRows) => {
    const actionKey = String(action || '').toLowerCase();
    if (actionKey === 'approve') return sourceRows.filter((row) => row.statusKey === 'pending');
    if (actionKey === 'start') return sourceRows.filter((row) => row.statusKey === 'approved');
    if (actionKey === 'complete') return sourceRows.filter((row) => row.statusKey === 'in_progress');
    if (actionKey === 'back_to_pending') return sourceRows.filter((row) => row.statusKey === 'approved');
    if (actionKey === 'back_to_approved') return sourceRows.filter((row) => row.statusKey === 'in_progress');
    if (actionKey === 'reject') return sourceRows.filter((row) => row.statusKey === 'pending');
    if (actionKey === 'cancel') return sourceRows.filter((row) => ['approved', 'in_progress'].includes(row.statusKey));
    if (actionKey === 'archive') return sourceRows.filter((row) => row.statusKey === 'completed');
    return [];
  };

  const bulkAdvanceAction = selectedColumnKey === 'pending'
    ? 'approve'
    : selectedColumnKey === 'approved'
      ? 'start'
      : selectedColumnKey === 'in_progress'
        ? 'complete'
        : '';
  const bulkPreviousAction = selectedColumnKey === 'approved'
    ? 'back_to_pending'
    : selectedColumnKey === 'in_progress'
      ? 'back_to_approved'
      : '';
  const bulkDangerAction = selectedColumnKey === 'pending'
    ? 'reject'
    : ['approved', 'in_progress'].includes(selectedColumnKey)
      ? 'cancel'
      : '';
  const bulkArchiveAction = selectedColumnKey === 'completed' ? 'archive' : '';
  const bulkDangerLabel = bulkDangerAction === 'reject' ? 'Toplu Reddet' : 'Toplu İptal';

  const runBulkAction = async (action, ids) => {
    const targetIds = ids || getBulkEligibleRows(action).map((row) => row.id);
    if (!targetIds.length) {
      setToast({ type: 'warning', title: 'Toplu İşlem', message: 'Bu işlem için uygun seçili talep yok.' });
      return;
    }

    try {
      setBulkUpdating(true);
      setBulkProgress(`${formatNumber(targetIds.length)} talep işleniyor...`);
      const result = await sectionService.bulkUpdateTransferRequests({ ids: targetIds, action });
      const rowById = new Map(rows.map((row) => [row.id, row]));
      const enrichedResults = (result.results || []).map((item) => ({
        ...item,
        productName: item.productName || rowById.get(item.id)?.productName || '',
      }));
      const updatedById = new Map(enrichedResults.filter((item) => item.ok && item.item).map((item) => [item.id, normalizeTransferRow(item.item)]));
      setRows((current) => current.map((row) => updatedById.get(row.id) || row));
      setSelectedIds(new Set());
      setBulkProgress(`${formatNumber(result.successCount || 0)}/${formatNumber(targetIds.length)} işlendi`);
      const failedMessage = compactBulkUserMessages(enrichedResults);
      setToast({
        type: result.failedCount > 0 ? 'warning' : 'success',
        title: 'Toplu İşlem',
        message: `${formatNumber(result.successCount || 0)} talep işlendi, ${formatNumber(result.failedCount || 0)} talep tamamlanamadı.${failedMessage ? ` ${failedMessage}` : ''}`,
      });
      loadRows({ includeHistory: false, silent: true }).catch((error) => {
        setToast({ type: 'warning', title: 'Toplu İşlem', message: transferErrorMessage(error, 'Liste arka planda güncellenemedi.') });
      });
    } catch (error) {
      setToast({ type: 'error', title: 'Toplu İşlem', message: transferErrorMessage(error, 'Toplu işlem tamamlanamadı.') });
    } finally {
      setBulkUpdating(false);
      setBulkProgress('');
    }
  };

  const requestBulkAction = (action) => {
    const ids = getBulkEligibleRows(action).map((row) => row.id);
    if (action === 'complete') {
      setBulkConfirm({ open: true, action, ids });
      return;
    }
    runBulkAction(action, ids);
  };

  const confirmBulkComplete = () => {
    const ids = bulkConfirm.ids || [];
    setBulkConfirm({ open: false, action: '', ids: [] });
    runBulkAction('complete', ids);
  };

  useEffect(() => {
    setArchivePage(1);
  }, [statusFilter, priorityFilter, sectionFilter, searchFilter, startDate, endDate]);

  const renderKanbanCard = (item) => {
    const transferItems = resolveTransferItems(item);
    const totalQuantity = getTotalQuantity(item);
    const sla = getSlaInfo(item);
    const isExpanded = Boolean(expandedCards[item.id]);
    const dismissAction = getDismissActionMeta(item);
    const isSelected = selectedIds.has(item.id);
    const isSelectionLocked = !canSelectRow(item);

    return (
      <article
        key={item.id}
        className="warehouse-task-card"
        draggable={isTransferManager}
        onDragStart={() => setDraggingId(item.id)}
        onDragEnd={() => setDraggingId('')}
      >
        <div className="warehouse-task-head">
          <div className="warehouse-task-title-row">
            <button
              type="button"
              className="warehouse-select-icon"
              disabled={isSelectionLocked}
              onClick={() => toggleSelected(item)}
              aria-label={isSelected ? 'Seçimi kaldır' : 'Talebi seç'}
            >
              {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
            </button>
            <h4>{item.productName || 'Transfer Talebi'}</h4>
          </div>
          <div className="warehouse-task-head-actions">
            {isTransferManager ? (
              <button
                type="button"
                className="warehouse-dismiss-btn"
                disabled={!dismissAction.enabled}
                onClick={dismissAction.onClick || undefined}
                title={dismissAction.title}
                aria-label={dismissAction.title}
              >
                <X size={14} />
              </button>
            ) : null}
            {isTransferManager ? <GripVertical size={14} className="warehouse-drag-handle" /> : null}
          </div>
        </div>

        <div className="warehouse-task-badges">
          <span className={`warehouse-priority warehouse-priority-${item.priority || 'low'}`}>
            {item.priority === 'high' ? 'Acil' : 'Normal'}
          </span>
          <span className={`warehouse-sla-chip ${sla.isOverdue ? 'is-overdue' : ''}`}>
            {sla.isOverdue ? <AlertTriangle size={13} /> : <Clock3 size={13} />} {sla.text}
          </span>
          <span className="warehouse-item-count">{transferItems.length} ürün</span>
          {item.isAutomation ? <span className="warehouse-origin-badge">Otomasyon</span> : null}
        </div>

        <div className="warehouse-task-meta">
          <span>Toplam miktar: {formatNumber(totalQuantity)}</span>
          <span>Kaynak: {resolveSourceRackCode(item)}</span>
          <span>Hedef Reyon: {resolveTargetSectionLabel(item)}</span>
          <span>Talep eden: {item.requestedByName || 'Personel'}</span>
          {item.note ? <span>Not: {item.note}</span> : null}
        </div>

        <button type="button" className="warehouse-detail-toggle" onClick={() => toggleCardDetails(item.id)}>
          {isExpanded ? 'Detayı gizle' : 'Detay gör'}
        </button>

        {isExpanded ? (
          <>
            <div className="warehouse-item-list">
              {transferItems.map((entry) => (
                <div className="warehouse-item-row" key={entry.id}>
                  <span>{entry.productName}</span>
                  <small>{entry.sku} • {formatNumber(entry.quantity)}</small>
                </div>
              ))}
            </div>
            <div className="warehouse-history-list">
              {(Array.isArray(item.history) && item.history.length ? item.history : []).map((entry) => (
                <div className="warehouse-history-row" key={entry.id || `${entry.createdAt}:${entry.toStatus}`}>
                  <span>{formatHistoryEvent(entry)}</span>
                  <small>{formatDate(entry.createdAt)}{entry.event === 'stock_transfer_completed' ? ' / stok transferi yazıldı' : ''}</small>
                </div>
              ))}
              {(!Array.isArray(item.history) || item.history.length === 0) ? (
                <div className="warehouse-history-row">
                  <span>{item.isAutomation ? 'Otomasyon oluşturdu' : 'Manuel oluşturuldu'}</span>
                  <small>{formatDate(item.createdAt)}</small>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {isTransferManager ? (
          <div className="warehouse-task-actions">
            {getQuickActions(item).map((action) => {
              const Icon = action.icon;
              const isDisabled = !action.status || !canRunAction(item, action) || updatingId === `${item.id}:${action.status}`;
              return (
                <button
                  key={`${item.id}:kanban:${action.id}:${action.status || 'none'}`}
                  className={`outline-button compact-action transfer-quick-btn transfer-quick-${action.tone}`}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => {
                    if (!action.status) return;
                    updateStatus(item.id, action.status);
                  }}
                >
                  <Icon size={13} /> {action.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </article>
    );
  };

  const showKioskIdleScreen = kioskEnabled && (!hasActiveTransfers || !terminalUnlocked);
  const canShowOperationSurface = !kioskEnabled || (terminalUnlocked && hasActiveTransfers);

  return (
    <div className={`page-stack warehouse-transfer-page ${fullscreenMode ? 'fullscreen-ops' : ''} ${wakeSignal ? 'warehouse-wake-signal' : ''}`}>
      <Toast toast={toast} onClose={() => setToast(null)} />

      <section className="warehouse-focus-header warehouse-ops-header">
        <div className="warehouse-focus-title warehouse-ops-title">
          <span className="warehouse-ops-icon" aria-hidden="true">
            <Truck size={18} />
          </span>
          <div className="warehouse-ops-copy">
            <strong>Depo Transfer Operasyon Ekranı</strong>
            <span>Canlı talep akışı, durum yönetimi ve operasyon görünümü</span>
          </div>
          {kioskEnabled ? <span className="warehouse-focus-chip">Kiosk</span> : null}
        </div>

        <div className="warehouse-focus-controls">
          <div className="warehouse-view-switch">
            <button type="button" className={`warehouse-view-btn ${viewMode === 'kanban' ? 'is-active' : ''}`} onClick={() => setViewMode('kanban')}>
              <KanbanSquare size={15} /> Tablo Görünümü
            </button>
            <button type="button" className={`warehouse-view-btn ${viewMode === 'list' ? 'is-active' : ''}`} onClick={() => setViewMode('list')}>
              <List size={15} /> Liste Görünümü
            </button>
            <button type="button" className={`warehouse-view-btn ${viewMode === 'archive' ? 'is-active' : ''}`} onClick={() => setViewMode('archive')}>
              <Clock3 size={15} /> Arşiv
            </button>
          </div>

          <button type="button" className="danger-button warehouse-exit-btn-danger" onClick={handleScreenExit}>
            <Power size={14} /> Çıkış
          </button>
        </div>
      </section>

      {!kioskEnabled ? (
      <section className="warehouse-fullscreen-cta" role="button" tabIndex={0} onClick={toggleFullscreenMode} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') toggleFullscreenMode(); }}>
        <div className="warehouse-fullscreen-cta-icon">{fullscreenMode ? <Minimize2 size={22} /> : <Expand size={22} />}</div>
        <div className="warehouse-fullscreen-cta-body">
          <strong>{fullscreenMode ? 'Operasyon Modundan Çık' : 'Operasyon Moduna Geç'}</strong>
          <span>Depo transfer süreçlerini merkezi olarak yönetin.</span>
        </div>
      </section>
      ) : null}

      {showKioskIdleScreen ? (
        <section className="warehouse-kiosk-idle">
          <div className="warehouse-kiosk-idle-panel">
            <span className="warehouse-kiosk-dot" aria-hidden="true" />
            <h3>{hasActiveTransfers ? 'Yeni transfer talebi geldi' : 'Şu anda aktif transfer talebi bulunmuyor'}</h3>
            <p>{hasActiveTransfers ? 'Devam etmek için giriş yapın' : 'Lütfen ekranı kontrol etmeye devam edin'}</p>
            <small>{kioskMessage}</small>

            {hasActiveTransfers && !terminalUnlocked ? (
              <div className="warehouse-kiosk-login-box">
                <h4>Depo Yönetim Sistemine Giriş Yapın</h4>
                <div className="warehouse-kiosk-login-row">
                  <label className="field-group">
                    <span>PIN</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={pinCode}
                      onChange={(event) => setPinCode(String(event.target.value || '').replace(/\D/g, '').slice(0, 4))}
                      placeholder="4 haneli PIN"
                    />
                  </label>
                  <button type="button" className="primary-button" onClick={handleTerminalLogin}>
                    <LogIn size={14} /> Giriş Yap
                  </button>
                </div>
                <button type="button" className="ghost-button warehouse-kiosk-quick-user" onClick={() => setTerminalUnlocked(true)}>
                  <UserCircle2 size={14} /> {user?.name || 'Mevcut kullanıcı'} ile hızlı giriş
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {canShowOperationSurface ? (
      <>
      <section className="mod-summary-grid warehouse-kpi-grid">
        <button type="button" className="mod-stat warehouse-kpi-btn" onClick={() => applyKpiStatusFilter('')}><div className="mod-stat-icon mod-icon-indigo"><ClipboardList size={18} /></div><div className="mod-stat-body"><span className="mod-stat-label">Toplam Talep</span><span className="mod-stat-value">{formatNumber(summary.total)}</span></div></button>
        <button type="button" className="mod-stat warehouse-kpi-btn" onClick={() => applyKpiStatusFilter('pending')}><div className="mod-stat-icon mod-icon-orange"><ArrowRightLeft size={18} /></div><div className="mod-stat-body"><span className="mod-stat-label">Bekliyor</span><span className="mod-stat-value">{formatNumber(summary.pending)}</span></div></button>
        <button type="button" className="mod-stat warehouse-kpi-btn" onClick={() => applyKpiStatusFilter('approved')}><div className="mod-stat-icon mod-icon-blue"><Boxes size={18} /></div><div className="mod-stat-body"><span className="mod-stat-label">Onaylandı</span><span className="mod-stat-value">{formatNumber(summary.queued)}</span></div></button>
        <button type="button" className="mod-stat warehouse-kpi-btn" onClick={() => applyKpiStatusFilter('in_progress')}><div className="mod-stat-icon mod-icon-amber"><Timer size={18} /></div><div className="mod-stat-body"><span className="mod-stat-label">İşlemde</span><span className="mod-stat-value">{formatNumber(summary.processing)}</span></div></button>
        <button type="button" className="mod-stat warehouse-kpi-btn" onClick={() => applyKpiStatusFilter('completed')}><div className="mod-stat-icon mod-icon-green"><Package size={18} /></div><div className="mod-stat-body"><span className="mod-stat-label">Tamamlandı</span><span className="mod-stat-value">{formatNumber(summary.completed)}</span></div></button>
      </section>

      <div className={`panel-card warehouse-operations-panel warehouse-operations-panel-${viewMode}`}>
        <FilterBar
          className={`warehouse-filter-bar warehouse-filter-bar-${viewMode}`}
          actions={(
            <>
              <button className="primary-button" type="button" onClick={() => loadRows()}>Filtrele</button>
              <button className="ghost-button" type="button" onClick={() => { setStatusFilter(''); setPriorityFilter(''); setSectionFilter(''); setSearchFilter(''); setStartDate(''); setEndDate(''); loadRows({ status: '', priority: '', sectionId: '', search: '', startDate: '', endDate: '' }); }}>Temizle</button>
            </>
          )}
        >
          <label className="field-group"><span>Arama</span><input value={searchFilter} onChange={(event) => setSearchFilter(event.target.value)} placeholder="SKU, barkod, ürün adı" /></label>
          <label className="field-group">
            <span>Durum</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Tüm Durumlar</option>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{toStatusLabel(status)}</option>)}
            </select>
          </label>
          <label className="field-group">
            <span>Reyon</span>
            <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value)}>
              <option value="">Tüm Reyonlar</option>
              {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
            </select>
          </label>
          <label className="field-group">
            <span>Öncelik</span>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="">Tümü</option>
              <option value="high">Yüksek</option>
              <option value="medium">Orta</option>
              <option value="low">Düşük</option>
            </select>
          </label>
          <label className="field-group"><span>Başlangıç</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label className="field-group"><span>Bitiş</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        </FilterBar>

        {isTransferManager ? (
          <div className="warehouse-bulk-toolbar">
            <div className="warehouse-bulk-context">
              {selectedColumnLabel ? (
                <span className="warehouse-bulk-scope"><Info size={13} /> {selectedColumnLabel} kolonu üzerinde çalışılıyor</span>
              ) : (
                <span className="warehouse-bulk-scope is-muted"><Info size={13} /> İşlem için bir kolon seçin</span>
              )}
              <span>{formatNumber(selectedIds.size)} seçili</span>
            </div>
            <div className="warehouse-bulk-actions">
              {bulkProgress ? <span className="warehouse-bulk-progress">{bulkProgress}</span> : null}
              {bulkPreviousAction ? (
                <button type="button" className="warning-button compact-action" disabled={bulkUpdating || getBulkEligibleRows(bulkPreviousAction).length === 0} onClick={() => requestBulkAction(bulkPreviousAction)}>
                  <ChevronLeft size={14} />
                  Bir Önceki Aşamaya Taşı
                </button>
              ) : null}
              {bulkAdvanceAction ? (
                <button type="button" className="primary-button compact-action" disabled={bulkUpdating || getBulkEligibleRows(bulkAdvanceAction).length === 0} onClick={() => requestBulkAction(bulkAdvanceAction)}>
                  {bulkAdvanceAction === 'complete' ? <Package size={14} /> : bulkAdvanceAction === 'start' ? <Play size={14} /> : <CheckCheck size={14} />}
                  Bir Sonraki Aşamaya Taşı
                </button>
              ) : null}
              {bulkArchiveAction ? (
                <button type="button" className="outline-button compact-action" disabled={bulkUpdating || getBulkEligibleRows(bulkArchiveAction).length === 0} onClick={() => requestBulkAction(bulkArchiveAction)}>
                  <Archive size={14} />
                  Arşive Al
                </button>
              ) : null}
              {bulkDangerAction ? (
                <button type="button" className="danger-button compact-action" disabled={bulkUpdating || getBulkEligibleRows(bulkDangerAction).length === 0} onClick={() => requestBulkAction(bulkDangerAction)}>
                  {bulkDangerAction === 'reject' ? <Ban size={14} /> : <X size={14} />}
                  {bulkDangerLabel}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {viewMode === 'list' ? (
          <>
            <div className="warehouse-table-shell warehouse-table-shell-compact">
              <DataTable
                columns={columns}
                rows={paginatedListRows}
                isLoading={isLoading}
                emptyMessage="Transfer talebi bulunmuyor."
                initialSort={{ key: 'createdAt', direction: 'desc' }}
                pageSize={LIST_PAGE_SIZE}
              />
            </div>
            {!isLoading && activeFlowRows.length > 0 ? (
              <div className="warehouse-list-pagination">
                <span>{listStartIndex}-{listEndIndex} / {activeFlowRows.length} kayıt</span>
                <button type="button" className="ghost-button" onClick={() => setListPage((current) => Math.max(1, current - 1))} disabled={normalizedListPage === 1}>Önceki</button>
                <strong>Sayfa {normalizedListPage} / {listTotalPages}</strong>
                <button type="button" className="primary-button" onClick={() => setListPage((current) => Math.min(listTotalPages, current + 1))} disabled={normalizedListPage === listTotalPages}>Sonraki</button>
              </div>
            ) : null}
          </>
        ) : viewMode === 'archive' ? (
          <section className="warehouse-archive-panel" aria-label="Transfer arşiv listesi">
            <div className="warehouse-table-shell warehouse-table-shell-compact">
              <DataTable
                columns={columns}
                rows={paginatedArchiveRows}
                isLoading={isLoading}
                emptyMessage="Arşivde transfer talebi bulunmuyor."
                initialSort={{ key: 'createdAt', direction: 'desc' }}
                pageSize={LIST_PAGE_SIZE}
              />
            </div>
            {!isLoading && archiveListRows.length > 0 ? (
              <div className="warehouse-list-pagination">
                <span>{archiveStartIndex}-{archiveEndIndex} / {archiveListRows.length} kayıt</span>
                <button type="button" className="ghost-button" onClick={() => setArchivePage((current) => Math.max(1, current - 1))} disabled={normalizedArchivePage === 1}>Önceki</button>
                <strong>Sayfa {normalizedArchivePage} / {archiveTotalPages}</strong>
                <button type="button" className="primary-button" onClick={() => setArchivePage((current) => Math.min(archiveTotalPages, current + 1))} disabled={normalizedArchivePage === archiveTotalPages}>Sonraki</button>
              </div>
            ) : null}
          </section>
        ) : (
          <div className="warehouse-board">
            {WORKFLOW_STATUSES.map((status) => (
              <section key={status} className={`warehouse-board-column ${toStatusClass(status) || ''}`}>
                <header className="warehouse-board-column-header">
                  <strong>{renderStatusIcon(status)}{toStatusLabel(status)}</strong>
                  <div className="warehouse-column-tools">
                    <button
                      type="button"
                      className={`warehouse-column-select ${selectedColumnKey === status ? 'is-active' : ''}`}
                      disabled={Boolean(selectedColumnKey && selectedColumnKey !== status)}
                      onClick={() => toggleColumnSelection(status, groupedRows[status] || [])}
                    >
                      {selectedColumnKey === status ? 'Seçimi Kaldır' : 'Kolonu Seç'}
                    </button>
                    <span className="warehouse-column-count-badge">{formatNumber((groupedRows[status] || []).length)}</span>
                  </div>
                </header>
                <div
                  className={`warehouse-board-column-body ${draggingId ? 'is-dragging' : ''}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDropToStatus(status)}
                >
                  {(groupedRows[status] || []).map((item) => renderKanbanCard(item))}
                  {(groupedRows[status] || []).length === 0 ? <div className="warehouse-empty-column">Kayıt yok</div> : null}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      </>
      ) : null}

      <ConfirmModal
        isOpen={exitConfirmOpen}
        title="Giriş Ekranına Dön"
        description="Giriş ekranına döneceksiniz. Devam etmek istiyor musunuz?"
        confirmText="Evet, Çık"
        cancelText="Vazgeç"
        tone="warning"
        onConfirm={handleExitToLogin}
        onCancel={() => setExitConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={rejectConfirm.open}
        title="Talebi İptal Et"
        description={rejectConfirm.description}
        confirmText={rejectConfirm.confirmText}
        cancelText="Vazgeç"
        tone="danger"
        onConfirm={confirmRejectRequest}
        onCancel={closeRejectConfirm}
      />

      <ConfirmModal
        isOpen={bulkConfirm.open}
        title="Toplu Tamamlama Onayı"
        description={`Bu işlem depodan reyona gerçek stok transfer hareketi oluşturur. ${formatNumber((bulkConfirm.ids || []).length)} uygun talep tamamlanacak.`}
        confirmText="Evet, Stok Transferi Oluştur"
        cancelText="Vazgeç"
        tone="warning"
        onConfirm={confirmBulkComplete}
        onCancel={() => setBulkConfirm({ open: false, action: '', ids: [] })}
      />
    </div>
  );
}
