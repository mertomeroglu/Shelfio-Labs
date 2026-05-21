import { useEffect, useMemo, useState } from 'react';
import '../pages/personnel-mobile/Personnel.css';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckSquare,
  ClipboardCheck,
  Home,
  LogOut,
  MapPin,
  PackagePlus,
  Archive,
  Tag,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { useDialog } from './ConfirmModal.jsx';
import logoPng from '../assets/logo.png';
import {
  getUnreadNotificationCount,
  notificationEvents,
  notificationService,
  readNotificationSettings,
} from '../services/notificationService.js';
import { taskService } from '../services/taskService.js';

const PERSONNEL_NOTIFICATION_POLL_MS = 30 * 1000;

const ROLE_LABELS = {
  admin: 'Yönetici',
  user: 'Personel',
  viewer: 'Komisyon B',
  komisyon_b: 'Komisyon B',
  komisyon_c: 'Komisyon C',
  komisyon_v: 'Komisyon V',
  cashier: 'Kasiyer',
  depo_personeli: 'Depo',
};

function isPersonnelNotification(item) {
  const actionType = String(item?.actionType || '').toLowerCase();
  const type = String(item?.type || '').toLowerCase();
  const title = String(item?.title || '').toLowerCase();
  const actionUrl = String(item?.actionUrl || '').toLowerCase();
  if (item?.relatedTaskId) return true;
  if (actionUrl.startsWith('/personel') || actionUrl.includes('/gorev') || actionUrl.includes('/siparis')) return true;
  if (actionType === 'task' || actionType === 'order' || actionType === 'stock') return true;
  if (/(task|gorev|siparis|stok|sla|assigned|overdue|upcoming|mention|comment)/.test(type)) return true;
  return /(task|gorev|siparis|stok|sla|assigned|overdue|upcoming|mention|comment)/.test(title);
}

function resolveRoleLabel(role) {
  return ROLE_LABELS[String(role || '').trim()] || 'Personel';
}

export default function PersonnelShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const dialog = useDialog();
  const { user, logout } = useAuth();
  const pathname = location.pathname;
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const [hasActiveTasks, setHasActiveTasks] = useState(false);

  useEffect(() => {
    document.title = 'Personel Mobil | Shelfio';
  }, [pathname]);

  useEffect(() => {
    let active = true;

    const loadNotificationState = async (silent = false) => {
      try {
        const settings = readNotificationSettings();
        const unreadList = await notificationService.list({ unread: true, limit: 200 });
        if (!active) return;
        const personnelUnreadList = Array.isArray(unreadList) ? unreadList.filter(isPersonnelNotification) : [];
        setHasUnreadNotifications(getUnreadNotificationCount(personnelUnreadList, settings) > 0);
      } catch {
        if (!silent && active) {
          setHasUnreadNotifications(false);
        }
      }
    };

    void loadNotificationState();
    const intervalId = setInterval(() => {
      void loadNotificationState(true);
    }, PERSONNEL_NOTIFICATION_POLL_MS);
    const handleNotificationsChanged = () => {
      void loadNotificationState(true);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(notificationEvents.changed, handleNotificationsChanged);
    }

    return () => {
      active = false;
      clearInterval(intervalId);
      if (typeof window !== 'undefined') {
        window.removeEventListener(notificationEvents.changed, handleNotificationsChanged);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    const normalizeIdentityValue = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');
    const userKeys = new Set(
      [
        user?.id,
        user?.userId,
        user?.personnelId,
        user?.staffId,
        user?.username,
        user?.email,
        user?.name,
      ].map(normalizeIdentityValue).filter(Boolean)
    );

    const isTaskAssignedToCurrentUser = (task = {}) => {
      if (!userKeys.size) return false;
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
      ].map(normalizeIdentityValue).filter(Boolean).some((value) => userKeys.has(value));
    };

    const isActiveTask = (task = {}) => {
      const status = String(task?.status || '').trim().toLocaleLowerCase('tr-TR');
      return !['completed', 'tamamlandi', 'tamamlandı', 'cancelled', 'canceled', 'iptal', 'archived', 'arsiv', 'arşiv'].includes(status);
    };

    const loadTaskState = async () => {
      try {
        const currentUserId = String(user?.id || user?.userId || '').trim();
        const rows = await taskService.list(currentUserId ? { assignedTo: currentUserId } : {});
        if (!active) return;
        const activeAssignedTasks = (Array.isArray(rows) ? rows : []).filter((row) => isTaskAssignedToCurrentUser(row) && isActiveTask(row));
        setHasActiveTasks(activeAssignedTasks.length > 0);
      } catch {
        if (active) setHasActiveTasks(false);
      }
    };

    void loadTaskState();
    const intervalId = setInterval(() => {
      void loadTaskState();
    }, PERSONNEL_NOTIFICATION_POLL_MS);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [user?.email, user?.id, user?.name, user?.personnelId, user?.staffId, user?.userId, user?.username]);

  const activeTab = useMemo(() => {
    if (pathname === '/personel') return 'home';
    if (pathname.startsWith('/personel/gorevler')) return 'tasks';
    if (pathname.startsWith('/personel/etiket-yonetimi')) return 'labels';
    if (pathname.startsWith('/personel/siparis-olustur')) return 'order';
    if (pathname.startsWith('/personel/lokasyon-yonetimi')) return 'location';
    if (pathname.startsWith('/personel/sayim')) return 'count';
    if (pathname.startsWith('/personel/reyon-besleme')) return 'replenish';
    return '';
  }, [pathname]);
  const isNotificationActive = pathname.startsWith('/personel/bildirimler');

  const handleLogout = async () => {
    const confirmed = await dialog.confirm({
      title: 'Çıkış Yap',
      description: 'Çıkış yapmak istediğinize emin misiniz?',
      confirmText: 'Evet, Çıkış Yap',
      cancelText: 'Vazgeç',
      tone: 'danger',
    });
    if (!confirmed) return;
    logout();
    navigate('/personel/login', { replace: true });
  };

  return (
    <main className="personnel-mobile-page">
      <section className="personnel-mobile-shell" aria-label="Personel uygulaması">
        <header className="personnel-compact-header">
          <div className="personnel-header-top">
            <div className="personnel-header-brand">
              <img src={logoPng} alt="Shelfio" className="personnel-header-logo" />
            </div>

            <div className="personnel-header-right">
              <div className="personnel-header-user">
                <strong>{user?.name || user?.username || 'Personel'}</strong>
                <span className="personnel-role-pill">{resolveRoleLabel(user?.role)}</span>
              </div>

              <button
                type="button"
                className={`personnel-header-icon-btn ${activeTab === 'count' ? 'is-active' : ''}`}
                onClick={() => navigate('/personel/sayim')}
                aria-label="Sayım"
              >
                <ClipboardCheck size={18} />
              </button>

              <button
                type="button"
                className={`personnel-header-icon-btn ${isNotificationActive ? 'is-active' : ''}`}
                onClick={() => navigate('/personel/bildirimler')}
                aria-label="Bildirimler"
              >
                <Bell size={18} />
                {hasUnreadNotifications ? <span className="personnel-icon-dot" aria-hidden="true" /> : null}
              </button>

              <button
                type="button"
                className="personnel-header-icon-btn personnel-header-logout-btn"
                onClick={handleLogout}
                aria-label="Çıkış Yap"
                style={{ color: 'var(--status-danger, #ef4444)' }}
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>

        <section className="personnel-shell-content" aria-live="polite">
          <Outlet />
        </section>

        <nav className="personnel-bottom-nav" aria-label="Personel alt navigasyon">
          <button type="button" className={activeTab === 'home' ? 'active' : ''} onClick={() => navigate('/personel')}>
            <Home size={18} /><span>Anasayfa</span>
          </button>
          <button type="button" className={activeTab === 'tasks' ? 'active' : ''} onClick={() => navigate('/personel/gorevler')}>
            <CheckSquare size={18} />
            {hasActiveTasks ? <span className="personnel-nav-dot" aria-hidden="true" /> : null}
            <span>Görevler</span>
          </button>
          <button type="button" className={activeTab === 'labels' ? 'active' : ''} onClick={() => navigate('/personel/etiket-yonetimi')}>
            <Tag size={18} /><span>Etiket</span>
          </button>
          <button type="button" className={activeTab === 'order' ? 'active' : ''} onClick={() => navigate('/personel/siparis-olustur')}>
            <PackagePlus size={18} /><span>Sipariş</span>
          </button>
          <button type="button" className={activeTab === 'location' ? 'active' : ''} onClick={() => navigate('/personel/lokasyon-yonetimi')}>
            <MapPin size={18} /><span>Lokasyon</span>
          </button>
          <button type="button" className={activeTab === 'replenish' ? 'active' : ''} onClick={() => navigate('/personel/reyon-besleme')}>
            <Archive size={18} /><span>Talep</span>
          </button>
        </nav>
      </section>
    </main>
  );
}
