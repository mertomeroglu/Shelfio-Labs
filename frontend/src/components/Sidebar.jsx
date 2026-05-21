import {
  BarChart3,
  Bell,
  Boxes,
  BrainCircuit,
  ClipboardList,
  Megaphone,
  ChevronDown,
  LayoutDashboard,
  Link2,
  Monitor,
  PackageSearch,
  Receipt,
  RadioTower,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  ShieldPlus,
  Shield,
  Tags,
  Truck,
  Users,
  UserCircle,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { hasPermission } from '../config/permissions.js';
import { formatUserRole } from '../services/formatters.js';
import {
  notificationEvents,
  notificationService,
} from '../services/notificationService.js';
import logoPng from '../assets/logo.png';

const SIDEBAR_NOTIFICATION_POLL_MS = 30 * 1000;

export default function Sidebar({ isOpen, onClose, settings, effectivePermissions = [] }) {
  const { user } = useAuth();
  const location = useLocation();

  const isAdmin = user?.role === 'admin';
  const can = (permission) => hasPermission(user, permission, effectivePermissions);

  const productManagementItems = useMemo(
    () => [
      { to: '/urunler', label: 'Ürünler', icon: PackageSearch, permission: 'product:view' },
      { to: '/kategoriler', label: 'Kategoriler', icon: Tags, permission: 'category:view' },
      { to: '/eslesmeler', label: 'Eşleşmeler', icon: Link2, permission: 'supplier:view' },
      { to: '/lokasyon-yonetimi', label: 'Lokasyon Yönetimi', icon: Monitor, permission: 'section:view' },
      { to: '/stok-islemleri', label: 'Stok İşlemleri', icon: Boxes, permission: 'stock:view' },
    ],
    []
  );

  const procurementItems = useMemo(
    () => [
      { to: '/tedarikciler', label: 'Tedarikçiler', icon: Truck, permission: 'supplier:view' },
      { to: '/siparis-olustur', label: 'Sipariş Oluştur', icon: Wallet, permission: 'purchase:view' },
      { to: '/siparis-takibi', label: 'Sipariş Takibi', icon: Receipt, permission: 'purchase:view' },
    ],
    []
  );

  const analyticsItems = useMemo(
    () => [
      { to: '/fiyat-talep-analizi', label: 'Fiyat & Talep Analizi', icon: BrainCircuit, permission: 'report:view' },
      { to: '/kampanya-yonetimi', label: 'Kampanya Yönetimi', icon: Megaphone, permission: 'settings:update' },
      { to: '/siparis-onerileri', label: 'Sipariş Önerileri', icon: Sparkles, permission: 'purchase:view' },
    ],
    []
  );

  const systemManagementItems = useMemo(
    () => [
      { to: '/personel-yonetimi', label: 'Personel Yönetimi', icon: Users, permission: 'user:view' },
      { to: '/musteri-yonetimi', label: 'Müşteri Yönetimi', icon: UserCircle, permission: 'user:view' },
      { to: '/rol-yonetimi', label: 'Rol Yönetimi', icon: Shield, permission: 'settings:update' },
      { to: '/erisim-taleplerim', label: 'Taleplerim', icon: ShieldPlus, permission: 'access_request:view_own', hideForAdmin: true },
      { to: '/erisim-talepleri', label: 'Erişim Talepleri', icon: ShieldPlus, permission: 'access_request:view_all' },
      { to: '/proximity-yonetimi', label: 'Proximity Yönetimi', icon: RadioTower, permission: 'proximity:view' },
    ],
    []
  );

  const visibleProductManagementItems = productManagementItems.filter((item) => can(item.permission));
  const visibleProcurementItems = procurementItems.filter((item) => can(item.permission));
  const visibleAnalyticsItems = analyticsItems.filter((item) => can(item.permission));
  const visibleSystemManagementItems = systemManagementItems.filter((item) => {
    if (!can(item.permission)) return false;
    if (item.hideForAdmin && isAdmin) return false;
    return true;
  });
  const isProductManagementRouteActive = visibleProductManagementItems.some((item) =>
    location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  );
  const isProcurementRouteActive = visibleProcurementItems.some((item) =>
    location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  );
  const isAnalyticsRouteActive = visibleAnalyticsItems.some((item) =>
    location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  );
  const isSystemManagementRouteActive = visibleSystemManagementItems.some((item) =>
    location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  );

  const [isProductManagementPinnedOpen, setIsProductManagementPinnedOpen] = useState(isProductManagementRouteActive);
  const [isProductManagementHovered, setIsProductManagementHovered] = useState(false);
  const [isProcurementPinnedOpen, setIsProcurementPinnedOpen] = useState(isProcurementRouteActive);
  const [isProcurementHovered, setIsProcurementHovered] = useState(false);
  const [isAnalyticsPinnedOpen, setIsAnalyticsPinnedOpen] = useState(isAnalyticsRouteActive);
  const [isAnalyticsHovered, setIsAnalyticsHovered] = useState(false);
  const [isSystemManagementPinnedOpen, setIsSystemManagementPinnedOpen] = useState(isSystemManagementRouteActive);
  const [isSystemManagementHovered, setIsSystemManagementHovered] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  useEffect(() => {
    let active = true;

    const loadNotificationSummary = async (silent = false) => {
      try {
        const summary = await notificationService.summary();
        if (!active) return;

        setUnreadNotificationCount(Number(summary?.unreadCount || 0));
      } catch {
        if (!silent && active) {
          setUnreadNotificationCount(0);
        }
      }
    };

    loadNotificationSummary();
    const intervalId = setInterval(() => loadNotificationSummary(true), SIDEBAR_NOTIFICATION_POLL_MS);
    const handleNotificationsChanged = () => {
      loadNotificationSummary(true);
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
    if (isProductManagementRouteActive) {
      setIsProductManagementPinnedOpen(true);
    }
  }, [isProductManagementRouteActive]);

  useEffect(() => {
    if (isProcurementRouteActive) {
      setIsProcurementPinnedOpen(true);
    }
  }, [isProcurementRouteActive]);

  useEffect(() => {
    if (isAnalyticsRouteActive) {
      setIsAnalyticsPinnedOpen(true);
    }
  }, [isAnalyticsRouteActive]);

  useEffect(() => {
    if (isSystemManagementRouteActive) {
      setIsSystemManagementPinnedOpen(true);
    }
  }, [isSystemManagementRouteActive]);

  const isProductManagementOpen = isProductManagementPinnedOpen || isProductManagementHovered || isProductManagementRouteActive;
  const isProcurementOpen = isProcurementPinnedOpen || isProcurementHovered || isProcurementRouteActive;
  const isAnalyticsOpen = isAnalyticsPinnedOpen || isAnalyticsHovered || isAnalyticsRouteActive;
  const isSystemManagementOpen = isSystemManagementPinnedOpen || isSystemManagementHovered || isSystemManagementRouteActive;

  const isPosVisible = can('pos:view');
  const isReportsVisible = can('report:view');
  const isTasksVisible = can('task:view');
  const isEslVisible = can('esl:view');
  const isSettingsVisible = can('settings:view');
  const isTransferVisible = can('transfer_request:view');
  const isNotificationsVisible = can('notification:view');
  const isDashboardVisible = can('report:view');
  const homePath = isDashboardVisible
    ? '/anasayfa'
    : isPosVisible
      ? '/pos-kasa'
      : isTransferVisible
        ? '/depo-transfer-talepleri?fullscreen=1'
        : visibleProductManagementItems[0]?.to || visibleProcurementItems[0]?.to || '/sistem-ayarlari';

  return (
    <>
      <div className={`sidebar-backdrop ${isOpen ? 'show' : ''}`} onClick={onClose}></div>
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-brand-row">
          <div className="sidebar-brand-block">
            <NavLink to={homePath} className="sidebar-brand-line sidebar-brand-link" onClick={onClose} aria-label="Ana ekrana git">
              <img src={logoPng} alt="Shelfio" className="sidebar-logo" />
            </NavLink>
          </div>
          <button className="sidebar-close" onClick={onClose} type="button" aria-label="Menüyü kapat">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {isDashboardVisible ? (
            <NavLink
              to="/anasayfa"
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={onClose}
            >
              <LayoutDashboard size={18} />
              <span>Dashboard</span>
            </NavLink>
          ) : null}

          {isPosVisible && (
            <NavLink
              to="/pos-kasa"
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={onClose}
            >
              <ShoppingCart size={18} />
              <span>POS / Kasa</span>
            </NavLink>
          )}

          {visibleProductManagementItems.length ? (
          <div
            className={`sidebar-group ${isProductManagementOpen ? 'open' : ''} ${isProductManagementRouteActive ? 'active' : ''}`}
            onMouseEnter={() => setIsProductManagementHovered(true)}
            onMouseLeave={() => setIsProductManagementHovered(false)}
          >
            <button
              type="button"
              className="sidebar-group-trigger"
              onClick={() => setIsProductManagementPinnedOpen((current) => !current)}
              aria-expanded={isProductManagementOpen}
            >
              <span className="sidebar-group-trigger-main">
                <PackageSearch size={18} />
                <span>Ürün Yönetimi</span>
              </span>
              <ChevronDown size={16} className="sidebar-group-chevron" />
            </button>

            <div className="sidebar-submenu">
              <div className="sidebar-submenu-inner">
              {visibleProductManagementItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => `sidebar-link sidebar-sublink ${isActive ? 'active' : ''}`}
                      onClick={onClose}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          </div>
          ) : null}

          {visibleProcurementItems.length ? (
          <div
            className={`sidebar-group ${isProcurementOpen ? 'open' : ''} ${isProcurementRouteActive ? 'active' : ''}`}
            onMouseEnter={() => setIsProcurementHovered(true)}
            onMouseLeave={() => setIsProcurementHovered(false)}
          >
            <button
              type="button"
              className="sidebar-group-trigger"
              onClick={() => setIsProcurementPinnedOpen((current) => !current)}
              aria-expanded={isProcurementOpen}
            >
              <span className="sidebar-group-trigger-main">
                <ShoppingBag size={18} />
                <span>Tedarik &amp; Satın Alma</span>
              </span>
              <ChevronDown size={16} className="sidebar-group-chevron" />
            </button>

            <div className="sidebar-submenu">
              <div className="sidebar-submenu-inner">
                {visibleProcurementItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => `sidebar-link sidebar-sublink ${isActive ? 'active' : ''}`}
                      onClick={onClose}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          </div>
          ) : null}

          {visibleAnalyticsItems.length ? (
          <div
            className={`sidebar-group ${isAnalyticsOpen ? 'open' : ''} ${isAnalyticsRouteActive ? 'active' : ''}`}
            onMouseEnter={() => setIsAnalyticsHovered(true)}
            onMouseLeave={() => setIsAnalyticsHovered(false)}
          >
            <button
              type="button"
              className="sidebar-group-trigger"
              onClick={() => setIsAnalyticsPinnedOpen((current) => !current)}
              aria-expanded={isAnalyticsOpen}
            >
              <span className="sidebar-group-trigger-main">
                <BrainCircuit size={18} />
                <span>Talep &amp; Analiz</span>
              </span>
              <ChevronDown size={16} className="sidebar-group-chevron" />
            </button>

            <div className="sidebar-submenu">
              <div className="sidebar-submenu-inner">
                {visibleAnalyticsItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => `sidebar-link sidebar-sublink ${isActive ? 'active' : ''}`}
                      onClick={onClose}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          </div>
          ) : null}

          {isReportsVisible ? (
            <NavLink
              to="/raporlar"
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={onClose}
            >
              <BarChart3 size={18} />
              <span>Raporlar</span>
            </NavLink>
          ) : null}

          {isTasksVisible ? (
            <NavLink
              to="/gorev-planlama"
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={onClose}
            >
              <ClipboardList size={18} />
              <span>Görev Planlama</span>
            </NavLink>
          ) : null}

          {isEslVisible ? (
            <NavLink
              to="/etiket-yonetimi"
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={onClose}
            >
              <Monitor size={18} />
              <span>Etiket Yönetimi</span>
            </NavLink>
          ) : null}

          {visibleSystemManagementItems.length ? (
          <div
            className={`sidebar-group ${isSystemManagementOpen ? 'open' : ''} ${isSystemManagementRouteActive ? 'active' : ''}`}
            onMouseEnter={() => setIsSystemManagementHovered(true)}
            onMouseLeave={() => setIsSystemManagementHovered(false)}
          >
            <button
              type="button"
              className="sidebar-group-trigger"
              onClick={() => setIsSystemManagementPinnedOpen((current) => !current)}
              aria-expanded={isSystemManagementOpen}
            >
              <span className="sidebar-group-trigger-main">
                <Shield size={18} />
                <span>Sistem Yönetimi</span>
              </span>
              <ChevronDown size={16} className="sidebar-group-chevron" />
            </button>

            <div className="sidebar-submenu">
              <div className="sidebar-submenu-inner">
                {visibleSystemManagementItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => `sidebar-link sidebar-sublink ${isActive ? 'active' : ''}`}
                      onClick={onClose}
                    >
                      <Icon size={16} />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          </div>
          ) : null}

        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-head">
            <div className="sidebar-footer-user">
              <span className="sidebar-footer-label">Aktif Oturum</span>
              <strong>{user?.name || 'Kullanıcı'}</strong>
              <small>{formatUserRole(user?.role) || 'Personel'}</small>
            </div>
            <div className="sidebar-footer-icons">
              {isNotificationsVisible ? (
                <NavLink
                  to="/bildirimler"
                  className={({ isActive }) => `sidebar-footer-icon-link sidebar-footer-icon-link-notifications ${isActive ? 'active' : ''} ${unreadNotificationCount > 0 ? 'has-unread' : ''}`}
                  onClick={onClose}
                  aria-label="Bildirim Merkezi"
                  title="Bildirim Merkezi"
                >
                  <Bell size={18} strokeWidth={2.2} />
                  {unreadNotificationCount > 0 ? (
                    <span className="sidebar-footer-icon-badge" aria-hidden="true" />
                  ) : null}
                </NavLink>
              ) : null}

              {isSettingsVisible ? (
                <NavLink
                  to="/sistem-ayarlari"
                  className={({ isActive }) => `sidebar-footer-icon-link ${isActive ? 'active' : ''}`}
                  onClick={onClose}
                  aria-label="Sistem Ayarları"
                  title="Sistem Ayarları"
                >
                  <Settings size={18} strokeWidth={2.2} />
                </NavLink>
              ) : null}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
