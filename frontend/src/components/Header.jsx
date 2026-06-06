import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Barcode, Bell, Boxes, Calendar, CheckCheck, CircleAlert, Clock, Hourglass, Info, LogOut, Menu, MessageCircle, Search, Settings2, Store, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import BarcodeModal from './BarcodeModal.jsx';
import { formatUserRole, normalizeSearchText, includesNormalized } from '../services/formatters.js';
import { barcodeLookupService } from '../services/barcodeLookupService.js';
import { eslService } from '../services/eslService.js';
import { reportService } from '../services/reportService.js';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  getUnreadTaskNotificationCount,
  NOTIFICATION_TYPE_OPTIONS,
  getVisibleNotifications,
  notificationEvents,
  notificationService,
  NOTIFICATION_PREFS_KEY,
  readNotificationSettings,
} from '../services/notificationService.js';
import ConfirmModal from './ConfirmModal.jsx';

const NOTIFICATION_POLL_MS = 30 * 1000;

function useLiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatTurkishDate(date) {
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTurkishTime(date) {
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function parseTimeToMinutes(value, fallback) {
  const source = typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
  const [h, m] = source.split(':').map((part) => Number(part));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return (h * 60) + m;
}

function getStoreLocalParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  const weekdayMap = {
    Sunday: 'Pazar',
    Monday: 'Pazartesi',
    Tuesday: 'Salı',
    Wednesday: 'Çarşamba',
    Thursday: 'Perşembe',
    Friday: 'Cuma',
    Saturday: 'Cumartesi',
  };

  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    dayKey: weekdayMap[parts.weekday] || 'Pazartesi',
    minutesOfDay: (Number(parts.hour || 0) * 60) + Number(parts.minute || 0),
  };
}

function resolveStoreScheduleStatus(date, settings = {}) {
  const timeZone = String(settings?.timezone || 'Europe/Istanbul').trim() || 'Europe/Istanbul';
  const local = getStoreLocalParts(date, timeZone);
  const weeklySchedule = Array.isArray(settings?.weeklySchedule) ? settings.weeklySchedule : [];
  const specialDays = Array.isArray(settings?.specialDays) ? settings.specialDays : [];
  const closedDays = Array.isArray(settings?.closedDays) ? settings.closedDays : [];
  const specialDay = specialDays.find((item) => item?.date === local.localDate && item?.isActive !== false);
  const weeklyDay = weeklySchedule.find((item) => item?.dayKey === local.dayKey);
  const holidayMode = Boolean(settings?.holidayMode);
  const isClosed = holidayMode
    || Boolean(specialDay?.isClosed)
    || (!specialDay && (Boolean(weeklyDay?.isClosed) || closedDays.includes(local.dayKey)));
  const opensAt = specialDay?.opensAt || specialDay?.startTime || weeklyDay?.opensAt || settings?.openingTime || '10:00';
  const closesAt = specialDay?.closesAt || specialDay?.endTime || weeklyDay?.closesAt || settings?.closingTime || '22:00';
  const openMinutes = parseTimeToMinutes(opensAt, '10:00');
  const closeMinutes = parseTimeToMinutes(closesAt, '22:00');
  const hasValidRange = openMinutes !== null && closeMinutes !== null && openMinutes !== closeMinutes;
  const isStoreOpen = !isClosed && hasValidRange && (
    openMinutes < closeMinutes
      ? local.minutesOfDay >= openMinutes && local.minutesOfDay < closeMinutes
      : local.minutesOfDay >= openMinutes || local.minutesOfDay < closeMinutes
  );

  return {
    isStoreOpen,
    isClosed,
    opensAt,
    closesAt,
    specialLabel: specialDay?.label || specialDay?.name || '',
  };
}

function formatStoreStatusLabel(date, settings) {
  if (!settings) return 'Saat bilgisi yükleniyor';
  const status = resolveStoreScheduleStatus(date, settings);
  if (status.isClosed) {
    if (status.specialLabel) return `Kapalı | ${status.specialLabel}`;
    return 'Kapalı';
  }

  const range = `${status.opensAt} - ${status.closesAt}`;
  return `${status.isStoreOpen ? 'Açık' : 'Kapalı'} | ${range}`;
}

function getNotificationIcon(type) {
  if (type === 'overdue' || type === 'sla' || type === 'critical_stock' || type === 'stock_out' || type === 'skt_expired') return AlertTriangle;
  if (type === 'upcoming') return Clock;
  if (type === 'assigned') return Bell;
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

  const days = Math.floor(hours / 24);
  return `${days} gün önce`;
}

function getDemoLicenseBadge(user, now) {
  const license = user?.license || {};
  const summary = user?.licenseSummary || license?.licenseSummary || {};
  const control = user?.control || {};
  const planSlug = String(summary.planSlug || license.planSlug || license.plan || control.planSlug || '').trim().toLowerCase();
  const licenseType = String(summary.licenseType || license.licenseType || '').trim().toLowerCase();
  const planName = String(summary.planName || license.planName || '').trim().toLowerCase();
  const isDemo = summary.isDemo === true
    || license.isDemo === true
    || planSlug === 'demo'
    || licenseType === 'demo'
    || planName.includes('demo');

  if (!isDemo) return null;

  const explicitRemaining = Number(summary.remainingDays ?? license.remainingDays);
  const hasExplicitRemaining = Number.isFinite(explicitRemaining);
  const expiresAt = summary.expiresAt || license.expiresAt || null;
  const expiresTime = expiresAt ? new Date(expiresAt).getTime() : NaN;
  const isExpired = String(summary.status || license.status || '').toLowerCase() === 'expired'
    || (Number.isFinite(expiresTime) && expiresTime < now.getTime())
    || (hasExplicitRemaining && explicitRemaining < 0);

  if (isExpired) {
    return { label: 'Demo süresi doldu', tone: 'expired' };
  }

  const remainingDays = hasExplicitRemaining
    ? Math.max(0, Math.floor(explicitRemaining))
    : Number.isFinite(expiresTime)
      ? Math.max(0, Math.ceil((expiresTime - now.getTime()) / 86_400_000))
      : null;

  if (remainingDays === 0) {
    return { label: 'Demo bugün sona eriyor', tone: 'warning' };
  }

  if (remainingDays !== null) {
    return { label: `Demo: ${remainingDays} gün kaldı`, tone: remainingDays <= 2 ? 'warning' : 'active' };
  }

  return { label: 'Demo lisans', tone: 'active' };
}

function isMobileOrderDraftNotification(item) {
  const title = String(item?.title || '').toLocaleLowerCase('tr-TR');
  const actionType = String(item?.actionType || '').toLocaleLowerCase('tr-TR');
  return actionType === 'mobile_order_draft' || title.includes('mobil sipariş tasla');
}

function parseDraftLines(text = '') {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line, index) => {
      const raw = line.replace(/^- /, '');
      const parts = raw.split('|').map((part) => part.trim());
      const name = parts[0] || `Ürün ${index + 1}`;
      const qtyUnit = parts[1] || '';
      const barcodePart = parts.find((part) => part.toLocaleLowerCase('tr-TR').startsWith('barkod:')) || '';
      const notePart = parts.find((part) => part.toLocaleLowerCase('tr-TR').startsWith('not:')) || '';
      const qtyMatch = qtyUnit.match(/([\d.,]+)\s+(.+)/);
      return {
        id: `${name}-${index}`,
        productName: name,
        quantity: qtyMatch ? qtyMatch[1] : '-',
        unit: qtyMatch ? qtyMatch[2] : '-',
        barcode: barcodePart ? barcodePart.replace(/^barkod:\s*/i, '') : '-',
        note: notePart ? notePart.replace(/^not:\s*/i, '') : '',
      };
    });
}

export default function Header({ onMenuClick, settings, onOpenSupport }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const now = useLiveClock();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [barcodePanelOpen, setBarcodePanelOpen] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeError, setBarcodeError] = useState('');
  const [barcodeResult, setBarcodeResult] = useState(null);
  const [linkedDevice, setLinkedDevice] = useState(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationSummary, setNotificationSummary] = useState({ unreadCount: 0, totalCount: 0 });
  const [draftDetailNotification, setDraftDetailNotification] = useState(null);
  const [notificationSettingsOpen, setNotificationSettingsOpen] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState(() => readNotificationSettings());
  const searchRef = useRef(null);
  const notificationRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(notificationSettings));
  }, [notificationSettings]);

  useEffect(() => {
    const handleClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setResults(null);
      }
      if (notificationRef.current && !notificationRef.current.contains(e.target)) {
        setNotificationOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    let active = true;

    const loadNotifications = async (silent = false) => {
      try {
        const [list, summary] = await Promise.all([
          notificationService.list({ limit: 30 }),
          notificationService.summary(),
        ]);
        if (!active) return;
        const unique = new Map();
        for (const item of (Array.isArray(list) ? list : [])) {
          if (!item?.id || unique.has(item.id)) continue;
          unique.set(item.id, item);
        }
        setNotifications(
          Array.from(unique.values()).sort(
            (left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
          )
        );
        setNotificationSummary({
          unreadCount: Number(summary?.unreadCount || 0),
          totalCount: Number(summary?.totalCount || 0),
        });
      } catch {
        if (!silent && active) {
          setNotifications([]);
          setNotificationSummary({ unreadCount: 0, totalCount: 0 });
        }
      }
    };

    loadNotifications();
    const intervalId = setInterval(() => loadNotifications(true), NOTIFICATION_POLL_MS);
    const handleNotificationsChanged = () => {
      loadNotifications(true);
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
    if (!barcodePanelOpen) return;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setBarcodePanelOpen(false);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [barcodePanelOpen]);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setNotificationSettingsOpen(false);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, []);

  const runGlobalSearch = async (rawValue) => {
    const normalizedInput = String(rawValue || '').trim();
    if (normalizedInput.length < 2) {
      setResults(null);
      return;
    }

    try {
      setSearching(true);
      const data = await reportService.globalSearch(normalizedInput);
      const safeData = {
        products: Array.isArray(data?.products) ? data.products : [],
        categories: Array.isArray(data?.categories) ? data.categories : [],
        suppliers: Array.isArray(data?.suppliers) ? data.suppliers : [],
      };

      const filtered = {
        products: safeData.products.filter((item) => (
          includesNormalized(item?.name, normalizedInput)
          || includesNormalized(item?.sku, normalizedInput)
          || includesNormalized(item?.barcode, normalizedInput)
        )),
        categories: safeData.categories.filter((item) => includesNormalized(item?.name, normalizedInput)),
        suppliers: safeData.suppliers.filter((item) => includesNormalized(item?.name, normalizedInput)),
      };

      setResults(filtered);
    } catch {
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (val.trim().length < 2) {
      setResults(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      await runGlobalSearch(val);
    }, 300);
  };

  const clearSearch = () => {
    setQuery('');
    setResults(null);
  };

  const resetBarcodeLookup = () => {
    setBarcodeError('');
    setBarcodeResult(null);
    setLinkedDevice(null);
  };

  const handleBarcodeLookup = async (event) => {
    event.preventDefault();
    const token = barcodeLookupService.normalizeScanValue(barcodeInput);
    if (!token) return;

    setBarcodeLoading(true);
    setBarcodeError('');
    setBarcodeResult(null);
    setLinkedDevice(null);

    try {
      const product = await barcodeLookupService.findProductByBarcode(token);
      setBarcodeResult(product);

      try {
        const devices = await eslService.listDevices();
        const matchedDevice = devices.find((device) => device.assignedProductId === product.id) || null;
        setLinkedDevice(matchedDevice);
      } catch {
        setLinkedDevice(null);
      }
    } catch {
      setBarcodeError('Ürün bulunamadı');
    } finally {
      setBarcodeLoading(false);
    }
  };

  const openBarcodePanel = () => {
    setBarcodePanelOpen(true);
  };

  const closeBarcodePanel = () => {
    setBarcodePanelOpen(false);
  };

  const handleResultClick = (item) => {
    clearSearch();
    if (item.type === 'product') navigate('/urunler', { state: { highlightProductId: item.id } });
    else if (item.type === 'category') navigate('/kategoriler');
    else if (item.type === 'supplier') navigate('/tedarikciler', { state: { highlightSupplierId: item.id } });
  };

  const handleLogout = () => {
    setLogoutConfirmOpen(false);
    logout();
    navigate('/giris', { replace: true });
  };

  const handleNotificationClick = async (item) => {
    try {
      if (!item.isRead) {
        await notificationService.markAsRead(item.id);
        setNotifications((current) => current.map((entry) => (entry.id === item.id ? { ...entry, isRead: true } : entry)));
        setNotificationSummary((current) => ({
          ...current,
          unreadCount: Math.max(0, Number(current?.unreadCount || 0) - 1),
        }));
      }
    } catch {
      // Notification update failure should not block navigation.
    }

    setNotificationOpen(false);
    if (isMobileOrderDraftNotification(item)) {
      setDraftDetailNotification(item);
      return;
    }
    if (item.actionType === 'task' && item.relatedTaskId) {
      navigate('/gorev-planlama', { state: { openTaskId: item.relatedTaskId } });
    } else {
      navigate(item.actionUrl || '/bildirimler');
    }
  };

  const handleMarkAllNotifications = async () => {
    try {
      await notificationService.markAllAsRead();
      setNotifications((current) => current.map((entry) => ({ ...entry, isRead: true })));
      setNotificationSummary((current) => ({ ...current, unreadCount: 0 }));
    } catch {
      // Keep current UI state when API fails.
    }
  };

  const handleToggleNotificationType = (type) => {
    setNotificationSettings((current) => ({
      ...current,
      [type]: !current[type],
    }));
  };

  const hasResolvedSettings = Boolean(settings);
  const storeStatus = hasResolvedSettings ? resolveStoreScheduleStatus(now, settings) : null;
  const storeStatusLabel = formatStoreStatusLabel(now, settings);
  const totalResults = results ? results.products.length + results.categories.length + results.suppliers.length : 0;
  const filteredNotifications = getVisibleNotifications(notifications, notificationSettings);
  const filteredUnreadCount = Number(notificationSummary?.unreadCount || 0);
  const hasUnreadTaskNotifications = getUnreadTaskNotificationCount(notifications, notificationSettings) > 0;
  const demoLicenseBadge = getDemoLicenseBadge(user, now);
  return (
    <div className="topbar-wrapper">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button topbar-menu" onClick={onMenuClick} type="button" aria-label="Menüyü aç">
            <Menu size={18} />
          </button>
          <div className="topbar-info">
            <div className="info-strip-item">
              <span className="info-strip-label"><Calendar size={13} /> Tarih</span>
              <span className="info-strip-value">{formatTurkishDate(now)}</span>
            </div>
            <div className="info-strip-item">
              <span className="info-strip-label"><Clock size={13} /> Saat</span>
              <span className="info-strip-value">{formatTurkishTime(now)}</span>
            </div>
            <div className="info-strip-item">
              <span className="info-strip-label"><Store size={13} /> Mağaza</span>
              <span className={`info-strip-value info-strip-store ${!hasResolvedSettings ? 'store-loading' : storeStatus.isStoreOpen ? 'store-open' : 'store-closed'}`}>
                {storeStatusLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="topbar-center-slot">
          <div className="topbar-header-search" ref={searchRef}>
            <div className="global-search">
              <div className="global-search-controls">
                <input
                  type="text"
                  className="global-search-input"
                  value={query}
                  onChange={handleSearchChange}
                  placeholder="Ürün, SKU, kategori veya tedarikçi ara"
                />
                {query ? (
                  <button className="global-search-clear" onClick={clearSearch} type="button" aria-label="Temizle">
                    <X size={14} />
                  </button>
                ) : null}
                <button
                  className="global-search-submit"
                  type="button"
                  aria-label="Ara"
                  onClick={() => {
                    clearTimeout(debounceRef.current);
                    void runGlobalSearch(query);
                  }}
                >
                  <Search size={16} />
                </button>
              </div>
              {results && (
                <div className="global-search-dropdown">
                  {totalResults === 0 && !searching && (
                    <div className="global-search-empty">Sonuç bulunamadı</div>
                  )}
                  {searching && <div className="global-search-empty">Aranıyor...</div>}
                  {results.products.length > 0 && (
                    <div className="global-search-group">
                      <div className="global-search-group-label">Ürünler</div>
                      {results.products.map((item) => (
                        <button key={item.id} className="global-search-item" onClick={() => handleResultClick(item)} type="button">
                          <span className="global-search-item-name">{item.name}</span>
                          <span className="global-search-item-meta">{item.sku} · {item.categoryName} · Stok: {item.currentStock}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {results.categories.length > 0 && (
                    <div className="global-search-group">
                      <div className="global-search-group-label">Kategoriler</div>
                      {results.categories.map((item) => (
                        <button key={item.id} className="global-search-item" onClick={() => handleResultClick(item)} type="button">
                          <span className="global-search-item-name">{item.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {results.suppliers.length > 0 && (
                    <div className="global-search-group">
                      <div className="global-search-group-label">Tedarikçiler</div>
                      {results.suppliers.map((item) => (
                        <button key={item.id} className="global-search-item" onClick={() => handleResultClick(item)} type="button">
                          <span className="global-search-item-name">{item.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="topbar-right">
          {demoLicenseBadge ? (
            <span className={`topbar-demo-badge topbar-demo-badge--${demoLicenseBadge.tone}`} title={demoLicenseBadge.label}>
              <Hourglass size={14} className="topbar-demo-badge-icon" />
              <span>{demoLicenseBadge.label}</span>
            </span>
          ) : null}
          <div className="topbar-notification" ref={notificationRef}>
            <button
              className={`icon-button topbar-notification-trigger ${notificationOpen ? 'active' : ''}`}
              type="button"
              aria-label="Bildirimler"
              aria-expanded={notificationOpen}
              onClick={() => setNotificationOpen((current) => !current)}
            >
              <Bell size={17} />
              {filteredUnreadCount > 0 ? (
                <span
                  className="topbar-notification-dot"
                  aria-hidden="true"
                  data-has-task-notifications={hasUnreadTaskNotifications ? 'true' : 'false'}
                />
              ) : null}
            </button>

            {notificationOpen ? (
              <div className="topbar-notification-dropdown" role="menu" aria-label="Bildirim listesi">
                <div className="topbar-notification-header">
                  <strong>Bildirimler</strong>
                  <div className="topbar-notification-header-actions">
                    <button
                      type="button"
                      className="text-button topbar-notification-text-action"
                      onClick={() => {
                        setNotificationOpen(false);
                        navigate('/bildirimler');
                      }}
                    >
                      Tümünü Gör
                    </button>
                    <button
                      type="button"
                      className="icon-button topbar-notification-settings-btn"
                      aria-label="Bildirim ayarları"
                      title="Bildirim ayarları"
                      onClick={() => {
                        setNotificationOpen(false);
                        setNotificationSettingsOpen(true);
                      }}
                    >
                      <Settings2 size={14} />
                    </button>
                    {filteredUnreadCount > 0 ? (
                      <button type="button" className="text-button topbar-notification-text-action" onClick={handleMarkAllNotifications}>
                        <CheckCheck size={14} /> Tümünü Okundu Yap
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="topbar-notification-list">
                  {filteredNotifications.length === 0 ? (
                    <div className="topbar-notification-empty">
                      <span className="topbar-notification-empty-icon"><Bell size={18} /></span>
                      <strong>Henüz bildirimin yok</strong>
                      <p>Ayarlar&apos;dan bildirim tercihlerini düzenleyebilirsin.</p>
                    </div>
                  ) : (
                    filteredNotifications.map((item) => {
                      const Icon = getNotificationIcon(item.type);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`topbar-notification-item priority-${item.priority} ${item.isRead ? 'is-read' : 'is-unread'}`}
                          onClick={() => handleNotificationClick(item)}
                        >
                          {!item.isRead ? <span className="topbar-notification-item-unread-bar" aria-hidden="true" /> : null}
                          <span className="topbar-notification-item-icon"><Icon size={14} /></span>
                          <span className="topbar-notification-item-text">
                            <strong>{item.title}</strong>
                            <small>{item.description}</small>
                          </span>
                          <span className="topbar-notification-item-time">{relativeTime(item.createdAt)}</span>
                        </button>
                      );
                    })
                  )}
                </div>

              </div>
            ) : null}
          </div>
          <div className="topbar-barcode">
            <button
              className={`icon-button topbar-barcode-trigger ${barcodePanelOpen ? 'active' : ''}`}
              type="button"
              aria-label="Hızlı barkod arama"
              aria-expanded={barcodePanelOpen}
              onClick={openBarcodePanel}
            >
              <Barcode size={17} />
            </button>
          </div>
          <div className="topbar-warehouse-shortcut">
            <button
              className="icon-button topbar-warehouse-trigger"
              type="button"
              aria-label="Depo transfer talepleri"
              title="Depo Transfer Talepleri"
              onClick={() => navigate('/depo-transfer-talepleri?fullscreen=1')}
            >
              <Boxes size={17} />
            </button>
          </div>
          <div className="user-chip">
            <strong>{user?.name || 'Kullanıcı'}</strong>
            <span>{formatUserRole(user?.role) || 'Personel'}</span>
          </div>
          <button className="danger-button btn-logout" onClick={() => setLogoutConfirmOpen(true)} type="button">
            <LogOut size={16} />
            <span>Çıkış</span>
          </button>
        </div>
      </header>

      <ConfirmModal
        isOpen={logoutConfirmOpen}
        title="Oturumu Kapat"
        description="Çıkış yapmak istediğinize emin misiniz?"
        confirmText="Çıkış Yap"
        cancelText="İptal"
        tone="danger"
        dialogClassName="logout-confirm-dialog"
        onConfirm={handleLogout}
        onCancel={() => setLogoutConfirmOpen(false)}
      />

      <BarcodeModal
        isOpen={barcodePanelOpen}
        inputValue={barcodeInput}
        onInputChange={(value) => {
          setBarcodeInput(value);
          if (barcodeError || barcodeResult) {
            resetBarcodeLookup();
          }
        }}
        onSubmit={handleBarcodeLookup}
        loading={barcodeLoading}
        error={barcodeError}
        product={barcodeResult}
        linkedDevice={linkedDevice}
        onClose={closeBarcodePanel}
        onGoProduct={() => navigate('/urunler', { state: { highlightProductId: barcodeResult?.id } })}
        onGoLabel={() => navigate('/etiket-yonetimi', {
          state: {
            quickAssignProductId: barcodeResult?.id,
            openDeviceSelection: true,
          },
        })}
      />

      {draftDetailNotification ? (
        <div className="topbar-draft-detail-backdrop" role="presentation" onClick={() => setDraftDetailNotification(null)}>
          <section className="topbar-draft-detail-modal" role="dialog" aria-modal="true" aria-label="Mobil sipariş taslağı detayı" onClick={(event) => event.stopPropagation()}>
            <header className="topbar-draft-detail-header">
              <div>
                <h3>Mobil Sipariş Taslağı</h3>
                <p>{draftDetailNotification.title || 'Taslak bildirimi'}</p>
              </div>
              <button type="button" className="icon-button topbar-notification-settings-btn" aria-label="Kapat" onClick={() => setDraftDetailNotification(null)}>
                <X size={14} />
              </button>
            </header>
            <div className="topbar-draft-detail-body">
              <div className="topbar-draft-detail-meta">
                <span>Oluşturulma: {relativeTime(draftDetailNotification.createdAt)}</span>
                <span>Kaynak: {String(draftDetailNotification.message || '').split('\n')[0] || '-'}</span>
              </div>
              <div className="topbar-draft-detail-summary">
                <strong>{String(draftDetailNotification.message || '').split('\n')[1] || 'Taslak bilgisi'}</strong>
                <span>{`Toplam ${parseDraftLines(draftDetailNotification.message || '').length} satır`}</span>
              </div>
              <div className="topbar-draft-detail-list">
                {parseDraftLines(draftDetailNotification.message || '').map((line) => (
                  <article key={line.id} className="topbar-draft-detail-item">
                    <div className="topbar-draft-detail-item-head">
                      <strong>{line.productName}</strong>
                      <span className="topbar-draft-detail-qty-badge">{line.quantity} {line.unit}</span>
                    </div>
                    <span className="topbar-draft-detail-item-barcode">Barkod: {line.barcode || '-'}</span>
                    {line.note ? <small>Not: {line.note}</small> : null}
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {notificationSettingsOpen ? (
        <div
          className="notification-settings-backdrop"
          role="presentation"
          onClick={() => setNotificationSettingsOpen(false)}
        >
          <section
            className="notification-settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Bildirim ayarları"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="notification-settings-modal-header">
              <div className="notification-settings-modal-title-wrap">
                <span className="notification-settings-modal-title-icon" aria-hidden="true">
                  <Settings2 size={16} />
                </span>
                <div>
                  <h3>Bildirim Ayarları</h3>
                  <p>Hangi bildirimleri görmek istediğini buradan seçebilirsin.</p>
                </div>
              </div>
              <div className="notification-settings-modal-controls">
                <span className="notification-type-visibility-count">
                  {NOTIFICATION_TYPE_OPTIONS.reduce((count, option) => count + (notificationSettings[option.type] !== false ? 1 : 0), 0)}/{NOTIFICATION_TYPE_OPTIONS.length} aktif
                </span>
                <button
                  type="button"
                  className="icon-button topbar-notification-settings-btn"
                  aria-label="Kapat"
                  onClick={() => setNotificationSettingsOpen(false)}
                >
                  <X size={14} />
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
                      <small>{option.description}</small>
                    </div>
                    <button
                      type="button"
                      className={`notification-settings-toggle ${enabled ? 'is-active' : 'is-passive'}`}
                      aria-label={`${option.label} bildirimlerini ${enabled ? 'kapat' : 'aç'}`}
                      onClick={() => handleToggleNotificationType(option.type)}
                    >
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
