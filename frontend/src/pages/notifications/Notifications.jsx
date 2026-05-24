import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,

  Bell,
  CheckCheck,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileSearch,
  Filter,
  Info,
  MessageCircle,
  Plus,
  Search,
  Send,
  Settings2,
  Trash2,
  Users,

  X,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader.jsx';
import Toast from '../../components/Toast.jsx';
import FormModal, { FormSection } from '../../components/FormModal.jsx';
import { InputWithIcon } from '../../components/SearchBar.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import {
  NOTIFICATION_PREFS_KEY,
  NOTIFICATION_TYPE_OPTIONS,
  notificationService,
  readNotificationSettings,
} from '../../services/notificationService.js';
import { userService } from '../../services/userService.js';

const POLL_MS = 30_000;

const FILTERS = [
  { key: 'all', label: 'Tümü' },
  { key: 'unread', label: 'Okunmamış' },
  { key: 'high', label: 'Yüksek Öncelik' },
  { key: 'system', label: 'Sistem' },
  { key: 'task', label: 'Görev' },
  { key: 'order', label: 'Sipariş' },
];

const PRIORITY_LABELS = {
  high: 'kritik',
  medium: 'orta',
  low: 'bilgi',
};

const PRIORITY_SORT = {
  high: 3,
  medium: 2,
  low: 1,
};

const TARGET_MODE_OPTIONS = [
  { key: 'all', label: 'Tüm Kullanıcılar' },
  { key: 'department', label: 'Departman Bazlı' },
  { key: 'role', label: 'Rol Bazlı' },
  { key: 'users', label: 'Tekil Kullanıcı' },
];

const MANUAL_NOTIFICATION_TYPE_OPTIONS = [
  { key: 'system', label: 'Sistem' },
  { key: 'operations', label: 'Operasyon' },
  { key: 'information', label: 'Bilgilendirme' },
  { key: 'warning', label: 'Uyarı' },
  { key: 'campaign', label: 'Kampanya' },
  { key: 'announcement', label: 'Duyuru' },
];

const DELIVERY_MODE_OPTIONS = [
  { key: 'now', label: 'Hemen Gönder' },
  { key: 'scheduled', label: 'Zamanlı Gönderim' },
];

const PRIORITY_OPTIONS = [
  { key: 'low', label: 'Düşük' },
  { key: 'medium', label: 'Orta' },
  { key: 'high', label: 'Yüksek' },
];

const DEFAULT_CREATE_FORM = {
  title: '',
  message: '',
  type: 'system',
  priority: 'medium',
  targetMode: 'all',
  departments: [],
  roles: [],
  userIds: [],
  deliveryMode: 'now',
  sendAt: '',
  expiresAt: '',
};

const ROLE_LABELS = {
  admin: 'Yönetici',
  user: 'Personel',
  cashier: 'Kasiyer',
  depo_personeli: 'Depo Personeli',
  viewer: 'Komisyon B',
  komisyon_b: 'Komisyon B',
  komisyon_c: 'Komisyon C',
  komisyon_v: 'Komisyon V',
};


function normalizePriorityForApi(priority) {
  const safe = String(priority || '').trim().toLowerCase();
  if (safe === 'high' || safe === 'medium' || safe === 'low') return safe;
  return 'medium';
}

function formatRoleLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (ROLE_LABELS[normalized]) return ROLE_LABELS[normalized];
  return String(value || '-');
}

function getTypeIcon(type) {
  if (type === 'overdue' || type === 'sla' || type === 'skt_expired') return AlertTriangle;
  if (type === 'upcoming') return Clock3;
  if (type === 'updated') return Info;
  if (type === 'comment' || type === 'mention') return MessageCircle;
  return CircleAlert;
}


function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 1) return 'Az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

function getGroupKey(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'older';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - (24 * 60 * 60 * 1000);
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (dayStart === today) return 'today';
  if (dayStart === yesterday) return 'yesterday';
  return 'older';
}

const GROUP_LABELS = {
  today: 'Bugün',
  yesterday: 'Dün',
  older: 'Daha Eski',
};

const NOTIFICATION_MODULE_LABELS = {
  task: 'Görev Yönetimi',
  order: 'Sipariş Takibi',
  purchase_order: 'Tedarik & Satın Alma',
  purchase: 'Tedarik & Satın Alma',
  purchase_suggestion: 'Sipariş Önerileri',
  goods_receipt: 'Mal Kabul',
  stock: 'Stok İşlemleri',
  campaign: 'Kampanya Yönetimi',
  pricing_analysis: 'Fiyat & Talep Analizi',
  gift_card: 'Hediye Kartı',
  customer: 'Müşteri Yönetimi',
  system: 'Sistem',
  notification: 'Bildirim Merkezi',
  mobile_order_draft: 'Mobil Sipariş Taslağı',
};

function formatAbsoluteDateTime(value) {
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

function getNotificationModuleLabel(item) {
  const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
  const explicitPage = String(payload.pageName || payload.module || '').trim();
  if (explicitPage) return explicitPage;
  const sourceKey = String(item?.source || item?.actionType || item?.category || item?.type || '').trim().toLowerCase();
  return NOTIFICATION_MODULE_LABELS[sourceKey] || String(item?.sourceLabel || item?.categoryLabel || item?.category || item?.type || '-');
}

function getNotificationReferenceValue(item) {
  return String(
    item?.referenceNo
    || item?.referenceId
    || item?.refNo
    || item?.relatedTaskId
    || item?.relatedOrderId
    || item?.payload?.referenceNo
    || item?.payload?.referenceId
    || item?.payload?.taskId
    || item?.payload?.orderId
    || '-'
  );
}

function parseOrderDraftDetails(item) {
  const description = String(item?.description || '');
  const lines = description.split('\n').map((line) => String(line || '').trim()).filter(Boolean);
  const createdByLine = lines[0] || '';
  const summaryLine = lines.find((line) => line.toLocaleLowerCase('tr-TR').startsWith('toplam')) || '';
  const summaryMatch = summaryLine.match(/Toplam\s+(\d+)\s+ürün,\s*(\d+)\s+adet/i) || summaryLine.match(/Toplam\s+(\d+)\s+urun,\s*(\d+)\s+adet/i);
  const totalProductCount = summaryMatch ? Number(summaryMatch[1] || 0) : 0;
  const totalQuantity = summaryMatch ? Number(summaryMatch[2] || 0) : 0;

  const items = lines
    .slice(1)
    .filter((line) => line.startsWith('-'))
    .map((line, index) => {
      const payload = line.replace(/^-+\s*/, '');
      const parts = payload.split('|').map((part) => part.trim()).filter(Boolean);
      const namePart = parts[0] || '';
      const qtyPart = parts[1] || '';
      const notePart = parts.find((part) => part.toLocaleLowerCase('tr-TR').startsWith('not:')) || '';
      const pricePart = parts.find((part) => part.toLocaleLowerCase('tr-TR').includes('tl')) || '';
      const barcodePart = parts.find((part) => part.toLocaleLowerCase('tr-TR').startsWith('barkod:')) || '';
      const qtyMatch = qtyPart.match(/(\d+)/);
      const qty = qtyMatch ? Number(qtyMatch[1] || 0) : null;
      const unit = qtyPart.replace(/^(\d+)\s*/i, '').trim() || '';
      const skuMatch = namePart.match(/\(([A-Za-z0-9_-]{3,})\)$/);
      const sku = skuMatch ? skuMatch[1] : '';
      const priceMatch = pricePart.match(/([\d,.]+)\s*TL/i);
      const unitPrice = priceMatch ? Number(String(priceMatch[1] || '').replace(/\./g, '').replace(',', '.')) : null;
      const productName = sku ? namePart.replace(/\(([A-Za-z0-9_-]{3,})\)$/, '').trim() : namePart;
      return {
        id: `${item?.id || 'draft'}-${index}`,
        name: productName || '-',
        quantity: qty,
        unit,
        sku,
        barcode: barcodePart.replace(/^Barkod:\s*/i, '').trim(),
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
        lineTotal: Number.isFinite(unitPrice) && Number.isFinite(qty) ? unitPrice * qty : null,
        note: notePart.replace(/^Not:\s*/i, '').trim(),
      };
    });

  return {
    createdByLine,
    createdAt: item?.createdAt || null,
    totalProductCount,
    totalQuantity,
    items,
  };
}

export default function Notifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [toast, setToast] = useState(null);
  const [notificationSettingsOpen, setNotificationSettingsOpen] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState(() => readNotificationSettings());
  const [listTab, setListTab] = useState('active');
  const [groupOpen, setGroupOpen] = useState({});
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ ...DEFAULT_CREATE_FORM });
  const [audienceUsers, setAudienceUsers] = useState([]);
  const [audienceSearch, setAudienceSearch] = useState('');
  const [isAudienceLoading, setIsAudienceLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [orderDraftInfoModal, setOrderDraftInfoModal] = useState(null);
  const [detailModalItem, setDetailModalItem] = useState(null);

  const canCreateNotifications = !['viewer', 'komisyon_b', 'komisyon_c', 'komisyon_v'].includes(String(user?.role || '').toLowerCase());
  const hasCreateFormChanges = useMemo(() => {
    return JSON.stringify(createForm) !== JSON.stringify(DEFAULT_CREATE_FORM) || Boolean(String(audienceSearch || '').trim());
  }, [audienceSearch, createForm]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(notificationSettings));
  }, [notificationSettings]);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setIsLoading(true);
    try {
      const [list] = await Promise.all([
        notificationService.list({ active: false }),
      ]);
      setNotifications(Array.isArray(list) ? list : []);
    } catch (error) {
      setToast({ type: 'error', title: 'Bildirimler', message: error.message || 'Bildirimler yüklenemedi.' });
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const id = setInterval(() => loadData({ silent: true }), POLL_MS);
    return () => clearInterval(id);
  }, [loadData]);

  const visibleBySettings = useMemo(
    () => notifications.filter((item) => notificationSettings[String(item.type || '')] !== false),
    [notificationSettings, notifications]
  );

  const filtered = useMemo(() => {
    let rows = visibleBySettings;
    if (filter === 'high') rows = rows.filter((item) => item.priority === 'high');
    if (filter === 'system' || filter === 'task' || filter === 'order') {
      rows = rows.filter((item) => item.category === filter);
    }

    const q = String(searchQuery || '').trim().toLowerCase();
    if (q) {
      rows = rows.filter((item) => {
        const haystack = [
          item.title,
          item.description,
          item.type,
          item.category,
          item.actionLabel,
        ]
          .map((part) => String(part || '').toLowerCase())
          .join(' ');
        return haystack.includes(q);
      });
    }

    return [...rows].sort((left, right) => {
      const priorityDiff = (PRIORITY_SORT[right.priority] || 1) - (PRIORITY_SORT[left.priority] || 1);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [filter, searchQuery, visibleBySettings]);

  const activeNotifications = useMemo(() => filtered.filter((item) => !item.isRead), [filtered]);
  const archivedNotifications = useMemo(() => filtered.filter((item) => item.isRead), [filtered]);

  const filterCounts = useMemo(() => ({
    all: filtered.length,
    unread: filtered.filter((item) => !item.isRead).length,
    high: filtered.filter((item) => item.priority === 'high').length,
    system: filtered.filter((item) => item.category === 'system').length,
    task: filtered.filter((item) => item.category === 'task').length,
    order: filtered.filter((item) => item.category === 'order').length,
  }), [filtered]);

  const groupedActiveNotifications = useMemo(() => {
    const groups = {};
    activeNotifications.forEach((item) => {
      const key = String(item.type || 'system');
      if (!groups[key]) {
        groups[key] = { key, title: item.title || key, priority: item.priority, items: [] };
      }
      groups[key].items.push(item);
      if ((PRIORITY_SORT[item.priority] || 1) > (PRIORITY_SORT[groups[key].priority] || 1)) {
        groups[key].priority = item.priority;
      }
    });
    return Object.values(groups).sort((a, b) => {
      const p = (PRIORITY_SORT[b.priority] || 1) - (PRIORITY_SORT[a.priority] || 1);
      if (p !== 0) return p;
      return b.items.length - a.items.length;
    });
  }, [activeNotifications]);

  const availableDepartments = useMemo(() => {
    const set = new Set();
    audienceUsers.forEach((item) => {
      const value = String(item?.department || '').trim();
      if (value) set.add(value);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [audienceUsers]);

  const availableRoles = useMemo(() => {
    const set = new Set();
    audienceUsers.forEach((item) => {
      const value = String(item?.role || '').trim().toLowerCase();
      if (value) set.add(value);
    });
    return Array.from(set);
  }, [audienceUsers]);

  const searchedAudienceUsers = useMemo(() => {
    const q = String(audienceSearch || '').trim().toLowerCase();
    const source = audienceUsers.filter((item) => item?.isActive !== false);
    if (!q) return source;
    return source.filter((item) => {
      const haystack = [item.name, item.username, item.email, item.department, formatRoleLabel(item.role)]
        .map((part) => String(part || '').toLowerCase())
        .join(' ');
      return haystack.includes(q);
    });
  }, [audienceSearch, audienceUsers]);

  const ensureAudienceUsersLoaded = async () => {
    if (isAudienceLoading || audienceUsers.length > 0) return;
    setIsAudienceLoading(true);
    try {
      const list = await userService.list();
      setAudienceUsers(Array.isArray(list) ? list : []);
    } catch (error) {
      setToast({ type: 'error', title: 'Bildirimler', message: error.message || 'Kullanıcı listesi alınamadı.' });
    } finally {
      setIsAudienceLoading(false);
    }
  };

  const handleOpenCreateModal = async () => {
    if (!canCreateNotifications) return;
    setCreateModalOpen(true);
    await ensureAudienceUsersLoaded();
  };

  const handleCloseCreateModal = () => {
    setCreateModalOpen(false);
    setAudienceSearch('');
    setCreateForm({ ...DEFAULT_CREATE_FORM });
  };

  const toggleArrayValue = (field, value) => {
    setCreateForm((current) => {
      const source = Array.isArray(current[field]) ? current[field] : [];
      const exists = source.includes(value);
      return { ...current, [field]: exists ? source.filter((item) => item !== value) : [...source, value] };
    });
  };

  const markRead = async (notificationId) => {
    try {
      await notificationService.markAsRead(notificationId);
      setNotifications((current) => current.map((item) => (item.id === notificationId ? { ...item, isRead: true } : item)));
    } catch (error) {
      setToast({ type: 'error', title: 'Bildirimler', message: error.message || 'Bildirim güncellenemedi.' });
    }
  };

  const handleNotificationAction = async (item, action) => {
    try {
      await notificationService.trackAction(item.id, action);
      setNotifications((current) => current.map((row) => (row.id === item.id ? { ...row, isRead: true } : row)));

      if (action === 'show-order-draft') {
        setOrderDraftInfoModal(parseOrderDraftDetails(item));
        return;
      }
      setDetailModalItem(item);
    } catch (error) {
      setToast({ type: 'error', title: 'Bildirimler', message: error.message || 'Bildirim aksiyonu alınamadı.' });
    }
  };

  const handleMarkAll = async () => {
    if (isMarkingAll) return;
    setIsMarkingAll(true);
    try {
      await notificationService.markAllAsRead();
      setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
      setSelectedIds([]);
      setListTab('archive');
      setToast({ type: 'success', title: 'Bildirimler', message: 'Tüm bildirimler okundu olarak işaretlendi.' });
    } catch (error) {
      setToast({ type: 'error', title: 'Bildirimler', message: error.message || 'Toplu okundu işlemi başarısız.' });
    } finally {
      setIsMarkingAll(false);
    }
  };

  const handleSelect = (notificationId, checked) => {
    setSelectedIds((current) => {
      if (checked) return current.includes(notificationId) ? current : [...current, notificationId];
      return current.filter((id) => id !== notificationId);
    });
  };

  const handleDeleteSelected = async () => {
    if (!selectedIds.length) return;
    try {
      await notificationService.deleteMany(selectedIds);
      setNotifications((current) => current.filter((item) => !selectedIds.includes(item.id)));
      setSelectedIds([]);
      setToast({ type: 'success', title: 'Bildirimler', message: 'Seçilen bildirimler silindi.' });
    } catch (error) {
      setToast({ type: 'error', title: 'Bildirimler', message: error.message || 'Bildirimler silinemedi.' });
    }
  };

  const handleSubmitCreate = async (event) => {
    event.preventDefault();
    const title = String(createForm.title || '').trim();
    const message = String(createForm.message || '').trim();

    if (!title) return setToast({ type: 'warning', title: 'Bildirimler', message: 'Bildirim başlığını girin.' });
    if (!message) return setToast({ type: 'warning', title: 'Bildirimler', message: 'Bildirim mesajını girin.' });
    if (createForm.targetMode === 'department' && createForm.departments.length === 0) {
      return setToast({ type: 'warning', title: 'Bildirimler', message: 'En az bir departman seçin.' });
    }
    if (createForm.targetMode === 'role' && createForm.roles.length === 0) {
      return setToast({ type: 'warning', title: 'Bildirimler', message: 'En az bir rol seçin.' });
    }
    if (createForm.targetMode === 'users' && createForm.userIds.length === 0) {
      return setToast({ type: 'warning', title: 'Bildirimler', message: 'En az bir kullanıcı seçin.' });
    }
    if (createForm.deliveryMode === 'scheduled' && !createForm.sendAt) {
      return setToast({ type: 'warning', title: 'Bildirimler', message: 'Zamanlı gönderim için tarih seçin.' });
    }

    setIsCreating(true);
    try {
      const payload = {
        title,
        message,
        type: createForm.type,
        severity: normalizePriorityForApi(createForm.priority),
        saveAsDraft: false,
        targeting: {
          mode: createForm.targetMode,
          departments: createForm.departments,
          roles: createForm.roles,
          userIds: createForm.userIds,
        },
        deliverySettings: {
          channel: 'in_app',
          visibility: 'standard',
          dispatchStyle: 'normal',
        },
        delivery: {
          sendAt: createForm.deliveryMode === 'scheduled' ? createForm.sendAt : null,
          isPinned: false,
          requireReadReceipt: false,
          expiresAt: createForm.expiresAt || null,
        },
      };

      const result = await notificationService.create(payload);
      await loadData({ silent: true });
      setToast({ type: 'success', title: 'Bildirimler', message: `${result?.recipientCount || 0} kullanıcıya bildirim gönderildi.` });
      handleCloseCreateModal();
    } catch (error) {
      setToast({ type: 'error', title: 'Bildirimler', message: error.message || 'Bildirim oluşturulamadı.' });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="page-stack notification-page">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageHeader
        className="dashboard-hero"
        icon={<Bell size={22} />}
        title="Bildirim Merkezi"
        description="Tüm bildirimlerini yönet, filtrele ve tek tıkla aksiyon al."
        actions={(
          <div className="notification-page-actions notification-page-actions-group">
            {canCreateNotifications ? (
              <button className="primary-button notification-page-action-btn notification-page-action-blue notification-page-action-create" type="button" onClick={handleOpenCreateModal}>
                <Plus size={16} /> Bildirim Oluştur
              </button>
            ) : null}
            <button className="primary-button notification-page-action-btn notification-page-action-blue" type="button" onClick={() => setNotificationSettingsOpen(true)}>
              <Settings2 size={16} /> Bildirim Ayarları
            </button>
            <button className="primary-button notification-page-action-btn notification-page-action-blue" type="button" onClick={handleMarkAll} disabled={isMarkingAll}>
              <CheckCheck size={16} /> {isMarkingAll ? 'İşleniyor...' : 'Tümünü Okundu Yap'}
            </button>
            <button className="outline-button notification-page-action-btn notification-page-action-delete" type="button" onClick={handleDeleteSelected} disabled={!selectedIds.length}>
              <Trash2 size={16} /> Seçilenleri Sil
            </button>
          </div>
        )}
      />

      <div className="mod-card notification-filter-card">
        <div className="mod-card-header notification-filter-card-head">
          <div className="mod-card-icon mod-icon-blue"><Filter size={18} /></div>
          <div>
            <h3 className="mod-card-title">Bildirim Filtreleri</h3>
            <p className="mod-card-desc">Modül bazlı filtrelerle listeyi daraltın ve aksiyonları yönetin.</p>
          </div>
        </div>

        <div className="notification-filter-inline-row">
          <div className="notification-search-row">
            <InputWithIcon
              className="notification-search-field"
              icon={<Search size={15} />}
              id="notification-search-input"
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Başlık, açıklama veya tipte ara"
            />
          </div>

          <div className="notification-filter-row" role="tablist" aria-label="Bildirim filtreleri">
            {FILTERS.map((item) => (
              <button key={item.key} type="button" className={`notification-filter-btn ${filter === item.key ? 'is-active' : ''}`} onClick={() => setFilter(item.key)}>
                {item.label} <span>{filterCounts[item.key] || 0}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? <div className="mod-card notification-empty">Bildirimler yükleniyor...</div> : null}
      {!isLoading && notifications.length === 0 ? (
        <div className="mod-card notification-empty notification-empty-rich">
          <span className="notification-empty-icon"><Bell size={20} /></span>
          <strong>Henüz bildirimin yok</strong>
          <p>Ayarlardan bildirim tercihlerini düzenleyebilirsin.</p>
        </div>
      ) : null}
      {!isLoading && notifications.length > 0 && filtered.length === 0 ? (
        <div className="mod-card notification-empty">Filtreye uygun bildirim bulunmuyor.</div>
      ) : null}

      {!isLoading && filtered.length > 0 ? (
        <div className="mod-card notification-list-card">
          <div className="notification-list-head">
            <span>{filtered.length} bildirim</span>
            {selectedIds.length > 0 ? <span>{selectedIds.length} seçildi</span> : null}
          </div>

          <div className="notification-list-tabs" role="tablist" aria-label="Bildirim liste sekmeleri">
            <button type="button" role="tab" aria-selected={listTab === 'active'} className={`notification-list-tab ${listTab === 'active' ? 'is-active' : ''}`} onClick={() => setListTab('active')}>
              Aktif Bildirimler <strong>{activeNotifications.length}</strong>
            </button>
            <button type="button" role="tab" aria-selected={listTab === 'archive'} className={`notification-list-tab ${listTab === 'archive' ? 'is-active' : ''}`} onClick={() => setListTab('archive')}>
              Arşivlenen Bildirimler <strong>{archivedNotifications.length}</strong>
            </button>
          </div>

          <div className="notification-group-list">
            {listTab === 'active' ? groupedActiveNotifications.map((grouped) => {
              const expanded = groupOpen[grouped.key] !== false;
              return (
                <section key={grouped.key} className="notification-smart-group">
                  <button
                    type="button"
                    className={`notification-smart-group-head priority-${grouped.priority}`}
                    onClick={() => setGroupOpen((current) => ({ ...current, [grouped.key]: current[grouped.key] === false }))}
                  >
                    <span>
                      <ChevronRight size={14} className={expanded ? 'is-open' : ''} />
                      {grouped.items.length} bildirim • {grouped.title}
                    </span>
                    <strong>{PRIORITY_LABELS[grouped.priority] || 'bilgi'}</strong>
                  </button>

                  {expanded ? (
                    <div className="notification-smart-group-body">
                      {grouped.items.map((item) => {
                        const Icon = getTypeIcon(item.type);
                        const timeGroup = getGroupKey(item.createdAt);
                        return (
                          <article key={item.id} className={`notification-row notification-${item.priority} ${item.isRead ? 'is-read' : 'is-unread'}`}>
                            <label className="notification-row-checkbox" aria-label="Bildirim seç">
                              <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => handleSelect(item.id, event.target.checked)} />
                            </label>

                            <div className="notification-item-icon"><Icon size={16} /></div>

                            <div className="notification-item-body">
                              <div className="notification-item-meta">
                                <strong>{item.title}</strong>
                                <span>{relativeTime(item.createdAt)}</span>
                              </div>
                              <p>{item.description}</p>
                              <div className="notification-item-tags">
                                <span className={`notification-priority-chip priority-${item.priority}`}>{PRIORITY_LABELS[item.priority] || item.priority}</span>
                                <span className="notification-date-chip">{GROUP_LABELS[timeGroup]}</span>
                              </div>
                            </div>

                            <div className="notification-item-actions">
                              <button className="notification-cta notification-cta-inspect notification-cta-detail" type="button" onClick={() => handleNotificationAction(item, 'inspect')}>
                                <Info size={14} /> Detay
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            }) : null}

            {listTab === 'archive' ? (
              archivedNotifications.length > 0 ? (
                <section className="notification-archive-section notification-archive-section-standalone">
                  <div className="notification-archive-list">
                    {archivedNotifications.map((item) => {
                      const Icon = getTypeIcon(item.type);
                      const group = getGroupKey(item.createdAt);
                      return (
                        <article key={item.id} className={`notification-row notification-${item.priority} ${item.isRead ? 'is-read' : 'is-unread'}`}>
                          <label className="notification-row-checkbox" aria-label="Bildirim seç">
                            <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => handleSelect(item.id, event.target.checked)} />
                          </label>
                          <div className="notification-item-icon"><Icon size={16} /></div>
                          <div className="notification-item-body">
                            <div className="notification-item-meta">
                              <strong>{item.title}</strong>
                              <span>{relativeTime(item.createdAt)}</span>
                            </div>
                            <p>{item.description}</p>
                            <div className="notification-item-tags">
                              <span className={`notification-priority-chip priority-${item.priority}`}>{PRIORITY_LABELS[item.priority] || item.priority}</span>
                              <span className="notification-date-chip">{GROUP_LABELS[group]}</span>
                            </div>
                          </div>
                          <div className="notification-item-actions">
                            <button className="notification-cta notification-cta-inspect notification-cta-detail" type="button" onClick={() => handleNotificationAction(item, 'inspect')}>
                              <Info size={14} /> Detay
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : <div className="notification-empty notification-archive-empty">Arşivde bildirim yok.</div>
            ) : null}
          </div>
        </div>
      ) : null}

      <FormModal
        isOpen={createModalOpen}
        title="Bildirim Oluştur"
        description="Hedef kitleyi seçin ve bildirimi yayınlayın."
        headerIcon={<Users size={16} />}
        onClose={handleCloseCreateModal}
        modalClassName="product-form-fit-modal notification-create-modal modal-header-standardized"
        confirmOnDirtyClose={hasCreateFormChanges}
      >
        <form className="modal-form modal-structured-form notification-create-form" onSubmit={handleSubmitCreate}>
          <div className="modal-form-body-scroll notification-create-form-body">
            <FormSection title="Hedefleme">
              <div className="notification-segmented-control" role="radiogroup" aria-label="Hedefleme tipi">
                {TARGET_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`notification-target-mode-chip ${createForm.targetMode === option.key ? 'is-active' : ''}`}
                    onClick={() => setCreateForm((current) => ({ ...current, targetMode: option.key }))}
                    role="radio"
                    aria-checked={createForm.targetMode === option.key}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {createForm.targetMode === 'department' ? (
                <div className="notification-choice-grid">
                  {availableDepartments.map((department) => (
                    <label key={department} className="notification-choice-pill">
                      <input type="checkbox" checked={createForm.departments.includes(department)} onChange={() => toggleArrayValue('departments', department)} />
                      <span>{department}</span>
                    </label>
                  ))}
                </div>
              ) : null}

              {createForm.targetMode === 'role' ? (
                <div className="notification-choice-grid">
                  {availableRoles.map((role) => (
                    <label key={role} className="notification-choice-pill">
                      <input type="checkbox" checked={createForm.roles.includes(role)} onChange={() => toggleArrayValue('roles', role)} />
                      <span>{formatRoleLabel(role)}</span>
                    </label>
                  ))}
                </div>
              ) : null}

              {createForm.targetMode === 'users' ? (
                <div className="notification-user-search-wrap">
                  <InputWithIcon
                    className="notification-search-field"
                    icon={<Search size={15} />}
                    id="notification-target-user-search"
                    type="text"
                    value={audienceSearch}
                    onChange={(event) => setAudienceSearch(event.target.value)}
                    placeholder="İsim, e-posta veya kullanıcı adı ile ara"
                  />

                  <div className="notification-user-pick-list">
                    {(isAudienceLoading ? [] : searchedAudienceUsers).slice(0, 14).map((userItem) => (
                      <button
                        key={userItem.id}
                        type="button"
                        className={`notification-user-pick-item ${createForm.userIds.includes(userItem.id) ? 'is-active' : ''}`}
                        onClick={() => toggleArrayValue('userIds', userItem.id)}
                      >
                        <strong>{userItem.name || userItem.username}</strong>
                        <span>{userItem.email || userItem.username} • {formatRoleLabel(userItem.role)}</span>
                      </button>
                    ))}
                    {!isAudienceLoading && searchedAudienceUsers.length === 0 ? (
                      <p className="notification-user-search-empty">Aramaya uygun kullanıcı bulunamadı.</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </FormSection>

            <FormSection title="İçerik">
              <div className="notification-create-form-grid">
                <label className="field-group field-span-12">
                  <span>Başlık</span>
                  <input type="text" value={createForm.title} onChange={(event) => setCreateForm((current) => ({ ...current, title: event.target.value }))} placeholder="Örn: Planlı bakım duyurusu" />
                </label>
                <label className="field-group field-span-12">
                  <span>Mesaj</span>
                  <textarea rows={4} value={createForm.message} onChange={(event) => setCreateForm((current) => ({ ...current, message: event.target.value }))} placeholder="Bildirim içeriğini yazın" />
                </label>
                <label className="field-group field-span-6">
                  <span>Bildirim Türü</span>
                  <select value={createForm.type} onChange={(event) => setCreateForm((current) => ({ ...current, type: event.target.value }))}>
                    {MANUAL_NOTIFICATION_TYPE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                </label>
                <label className="field-group field-span-6">
                  <span>Öncelik</span>
                  <select value={createForm.priority} onChange={(event) => setCreateForm((current) => ({ ...current, priority: event.target.value }))}>
                    {PRIORITY_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                </label>
              </div>
            </FormSection>

            <FormSection title="Ek Seçenekler">
              <div className="notification-segmented-control" role="radiogroup" aria-label="Gönderim tipi">
                {DELIVERY_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`notification-target-mode-chip ${createForm.deliveryMode === option.key ? 'is-active' : ''}`}
                    onClick={() => setCreateForm((current) => ({ ...current, deliveryMode: option.key }))}
                    role="radio"
                    aria-checked={createForm.deliveryMode === option.key}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="notification-create-form-grid notification-create-options-grid">
                <label className="field-group field-span-6">
                  <span>Gönderim Tarihi</span>
                  <input type="datetime-local" value={createForm.sendAt} onChange={(event) => setCreateForm((current) => ({ ...current, sendAt: event.target.value }))} disabled={createForm.deliveryMode !== 'scheduled'} />
                </label>
                <label className="field-group field-span-6">
                  <span>Geçerlilik Sonu (Opsiyonel)</span>
                  <input type="datetime-local" value={createForm.expiresAt} onChange={(event) => setCreateForm((current) => ({ ...current, expiresAt: event.target.value }))} />
                </label>
              </div>
            </FormSection>
          </div>

          <div className="modal-actions modal-actions-sticky notification-create-footer">
            <button type="button" className="ghost-button" onClick={handleCloseCreateModal} disabled={isCreating}>İptal</button>
            <button type="submit" className="primary-button" disabled={isCreating}>
              <Send size={14} /> Gönder
            </button>
          </div>
        </form>
      </FormModal>

      <FormModal
        isOpen={Boolean(detailModalItem)}
        title={detailModalItem?.title || 'Bildirim Detayı'}
        description="Bildirim içeriğini, kaynağını ve referans bilgilerini tek panelde inceleyin."
        headerIcon={<Info size={16} />}
        onClose={() => setDetailModalItem(null)}
        modalClassName="access-request-detail-modal notification-order-draft-modal notification-detail-modal modal-header-standardized"
        confirmOnDirtyClose={false}
      >
        {detailModalItem ? (
          <div className="modal-form notification-order-draft-form">
            <div className="modal-form-body-scroll access-request-detail-body notification-order-draft-body">
              <div className="access-request-detail-grid">
                <div><span>Başlık</span><strong>{detailModalItem.title || '-'}</strong></div>
                <div><span>Tür</span><strong>{detailModalItem.type || detailModalItem.actionType || '-'}</strong></div>
                <div><span>Öncelik</span><strong>{PRIORITY_LABELS[detailModalItem.priority] || detailModalItem.priority || '-'}</strong></div>
                <div><span>Oluşturulma zamanı</span><strong>{formatAbsoluteDateTime(detailModalItem.createdAt)}</strong></div>
                <div><span>İlgili modül</span><strong>{getNotificationModuleLabel(detailModalItem)}</strong></div>
                <div><span>Referans no</span><strong>{getNotificationReferenceValue(detailModalItem)}</strong></div>
              </div>
              <article className="access-request-detail-note">
                <h4>Açıklama</h4>
                <p>{detailModalItem.description || detailModalItem.message || 'Detay açıklaması bulunmuyor.'}</p>
              </article>
              <article className="access-request-detail-note">
                <h4>Ek Bilgiler</h4>
                <textarea readOnly rows={8} className="s-log-detail-textarea" value={JSON.stringify(detailModalItem.payload || {}, null, 2)} />
              </article>
            </div>
            <div className="modal-actions notification-order-draft-footer">
              {detailModalItem.actionType === 'mobile_order_draft' ? (
                <button type="button" className="ghost-button" onClick={() => setOrderDraftInfoModal(parseOrderDraftDetails(detailModalItem))}>Taslak Kalemleri</button>
              ) : null}
              <button type="button" className="secondary-button" onClick={() => setDetailModalItem(null)}>Kapat</button>
            </div>
          </div>
        ) : null}
      </FormModal>

      <FormModal
        isOpen={Boolean(orderDraftInfoModal)}
        title="Mobil Sipariş Taslağı"
        description="Mobil sipariş taslağındaki ürün kalemleri."
        headerIcon={<FileSearch size={16} />}
        onClose={() => setOrderDraftInfoModal(null)}
        modalClassName="access-request-detail-modal notification-order-draft-modal modal-header-standardized"
        confirmOnDirtyClose={false}
      >
        {orderDraftInfoModal ? (
          <div className="modal-form notification-order-draft-form">
            <div className="modal-form-body-scroll access-request-detail-body notification-order-draft-body">
              <div className="notification-order-draft-summary">
                <div className="notification-order-draft-summary-cell">
                  <span>Toplam Ürün</span>
                  <strong>{orderDraftInfoModal.totalProductCount || orderDraftInfoModal.items.length}</strong>
                </div>
                <div className="notification-order-draft-summary-divider" />
                <div className="notification-order-draft-summary-cell">
                  <span>Satır Sayısı</span>
                  <strong>{orderDraftInfoModal.items.length}</strong>
                </div>
              </div>
              <div className="notification-order-draft-summary">
                <div className="notification-order-draft-summary-cell">
                  <span>Ekleyen</span>
                  <strong>{orderDraftInfoModal.createdByLine || '-'}</strong>
                </div>
                <div className="notification-order-draft-summary-divider" />
                <div className="notification-order-draft-summary-cell">
                  <span>Oluşturulma</span>
                  <strong>{orderDraftInfoModal.createdAt ? relativeTime(orderDraftInfoModal.createdAt) : '-'}</strong>
                </div>
              </div>
              <div className="notification-order-draft-list">
                {orderDraftInfoModal.items.length > 0 ? orderDraftInfoModal.items.map((row) => (
                  <article key={row.id} className="notification-order-draft-line">
                    <div className="notification-order-draft-line-main">
                      <div className="notification-order-draft-line-head">
                        <strong>{row.name}</strong>
                        <span>Sipariş: {row.quantity || 0}{row.unit ? ` ${row.unit}` : ''}</span>
                      </div>
                      <div className="notification-order-draft-line-meta">
                        {row.sku ? <span>SKU: {row.sku}</span> : null}
                        {row.barcode ? <span>Barkod: {row.barcode}</span> : null}
                        {row.note ? <span>{row.note}</span> : null}
                      </div>
                    </div>
                    <div className="notification-order-draft-line-price">
                      {Number(row.unitPrice || 0) > 0 ? <span>{row.unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</span> : null}
                      {Number(row.lineTotal || 0) > 0 ? <strong>{row.lineTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL</strong> : null}
                    </div>
                  </article>
                )) : (
                  <div className="notification-empty">Taslak detayları bulunamadı.</div>
                )}
              </div>
            </div>
            <div className="modal-actions notification-order-draft-footer">
              <button type="button" className="secondary-button" onClick={() => setOrderDraftInfoModal(null)}>Kapat</button>
            </div>
          </div>
        ) : null}
      </FormModal>

      {notificationSettingsOpen ? (
        <div className="notification-settings-backdrop" role="presentation" onClick={() => setNotificationSettingsOpen(false)}>
          <section className="notification-settings-modal" role="dialog" aria-modal="true" aria-label="Bildirim ayarları" onClick={(event) => event.stopPropagation()}>
            <header className="notification-settings-modal-header">
              <div className="notification-settings-modal-title-wrap">
                <span className="notification-settings-modal-title-icon" aria-hidden="true"><Settings2 size={16} /></span>
                <div>
                  <h3>Bildirim Ayarları</h3>
                  <p>Hangi bildirimleri görmek istediğini buradan seçebilirsin.</p>
                </div>
              </div>
              <div className="notification-settings-modal-controls">
                <button type="button" className="icon-button topbar-notification-settings-btn" aria-label="Kapat" onClick={() => setNotificationSettingsOpen(false)}>
                  <X size={16} />
                </button>
              </div>
            </header>

            <div className="notification-settings-list">
              {NOTIFICATION_TYPE_OPTIONS.map((option) => {
                const enabled = notificationSettings[option.type] !== false;
                return (
                  <div key={option.type} className="notification-settings-row">
                    <div className="notification-settings-meta">
                      <strong>{option.label}</strong>
                      <p>{option.description}</p>
                    </div>
                    <button type="button" className={`notification-settings-toggle ${enabled ? 'is-active' : 'is-passive'}`} onClick={() => setNotificationSettings((current) => ({ ...current, [option.type]: !enabled }))}>
                      <span className="notification-settings-toggle-indicator" />
                      <span className="notification-settings-toggle-option option-passive">Kapalı</span>
                      <span className="notification-settings-toggle-option option-active">Açık</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}





