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
  notificationEvents,
  notificationService,
} from '../services/notificationService.js';
import { taskService } from '../services/taskService.js';

const PERSONNEL_SHELL_NOTIFICATION_INITIAL_DELAY_MS = 5 * 1000;
const PERSONNEL_SHELL_TASK_INITIAL_DELAY_MS = 7 * 1000;
const PERSONNEL_SHELL_VISIBLE_POLL_MS = 90 * 1000;
const PERSONNEL_SHELL_HIDDEN_POLL_MS = 5 * 60 * 1000;

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

function resolveRoleLabel(role) {
  return ROLE_LABELS[String(role || '').trim()] || 'Personel';
}

function getShellPollDelay() {
  if (typeof document !== 'undefined' && document.hidden) return PERSONNEL_SHELL_HIDDEN_POLL_MS;
  return PERSONNEL_SHELL_VISIBLE_POLL_MS;
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

  useEffect(() => {
    let active = true;
    let timeoutId = null;

    const loadNotificationState = async (silent = false) => {
      try {
        const summary = await notificationService.summary();
        if (!active) return;
        setHasUnreadNotifications(Number(summary?.unreadCount || 0) > 0);
      } catch {
        if (!silent && active) setHasUnreadNotifications(false);
      } finally {
        if (active) {
          timeoutId = window.setTimeout(() => {
            void loadNotificationState(true);
          }, getShellPollDelay());
        }
      }
    };

    timeoutId = window.setTimeout(() => {
      void loadNotificationState(true);
    }, PERSONNEL_SHELL_NOTIFICATION_INITIAL_DELAY_MS);

    const handleNotificationsChanged = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      void loadNotificationState(true);
    };
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (timeoutId) window.clearTimeout(timeoutId);
      void loadNotificationState(true);
    };

    window.addEventListener(notificationEvents.changed, handleNotificationsChanged);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
      window.removeEventListener(notificationEvents.changed, handleNotificationsChanged);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let timeoutId = null;
    const isTasksRoute = pathname.startsWith('/personel/gorevler');

    if (isTasksRoute) {
      return () => {
        active = false;
      };
    }

    const loadTaskState = async () => {
      try {
        const currentUserId = String(user?.id || user?.userId || '').trim();
        const summary = await taskService.summary(currentUserId ? { assignedTo: currentUserId } : {});
        if (!active) return;
        setHasActiveTasks(Number(summary?.activeCount || 0) > 0);
      } catch {
        if (active) setHasActiveTasks(false);
      } finally {
        if (active) {
          timeoutId = window.setTimeout(() => {
            void loadTaskState();
          }, getShellPollDelay());
        }
      }
    };

    timeoutId = window.setTimeout(() => {
      void loadTaskState();
    }, PERSONNEL_SHELL_TASK_INITIAL_DELAY_MS);

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (timeoutId) window.clearTimeout(timeoutId);
      void loadTaskState();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pathname, user?.id, user?.userId]);

  const handleLogout = async () => {
    const confirmed = await dialog.confirm({
      title: 'Çıkış Yap',
      description: 'Çıkış yapmak istediğinize emin misiniz?',
      confirmText: 'Evet, Çıkış Yap',
      cancelText: 'Vazgec',
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
