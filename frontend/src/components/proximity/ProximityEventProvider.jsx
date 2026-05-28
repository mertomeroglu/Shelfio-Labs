import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getBeaconCooldownKey,
  normalizeNativeBeaconEvent,
  proximityService,
} from '../../services/proximityService.js';
import { CUSTOMER_AUTH_UPDATED_EVENT, customerPortalAuthService } from '../../services/customerPortalAuthService.js';
import { cleanSectionDisplayName } from '../../services/formatters.js';
import './ProximityEventProvider.css';

const NATIVE_BEACON_EVENT = 'shelfio:beacon-detected';
const CUSTOMER_PREFS_KEY = 'shelfio.customer.preferences';
const CUSTOMER_USER_KEY = 'shelfio_customer_user';
const CUSTOMER_PREFS_UPDATED_EVENT = 'shelfio:customer-preferences-updated';
const CUSTOMER_NOTIFICATIONS_REFRESH_EVENT = 'shelfio:customer-notifications-refresh';
const FRONTEND_COOLDOWN_MS = 1 * 1000;
const DISMISS_COOLDOWN_MS = 60 * 1000;
const QUEUED_EVENT_TTL_MS = 60 * 1000;
const QUEUED_EVENT_LIMIT = 10;
const PRODUCT_DISCOUNT_DESCRIPTION = 'Şu an bulunduğunuz reyonda ilginizi çekebilecek ürünlere rastladık.';
const PRODUCT_DISCOUNT_NATIVE_BODY = 'İlgini çekebilecek ürünler keşfettik.';

const isDebug = () => {
  if (import.meta.env?.DEV) return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('shelfio.proximity.debug') === 'true';
  } catch {
    return false;
  }
};
const normalizeText = (value) => String(value || '').trim();
const currentRoute = () => (typeof window === 'undefined' ? '' : `${window.location.pathname || ''}${window.location.search || ''}`);
const buildDebugFields = ({ detail = {}, normalized = null, payload = null, route = currentRoute(), reason = null, response = null } = {}) => {
  const normalizedPayload = payload || normalized?.payload || {};
  return {
    route,
    eventType: detail?.eventType || normalized?.raw?.eventType || null,
    checkType: detail?.checkType || normalized?.raw?.checkType || null,
    normalizedEventType: normalizedPayload?.eventType || null,
    deviceId: normalizedPayload?.deviceId || detail?.deviceId || detail?.deviceCode || null,
    uuid: normalizedPayload?.uuid || detail?.uuid || null,
    major: normalizedPayload?.major ?? detail?.major ?? null,
    minor: normalizedPayload?.minor ?? detail?.minor ?? null,
    rssi: normalizedPayload?.rssi ?? detail?.rssi ?? null,
    reason: reason || response?.reason || null,
    shouldNotify: response?.shouldNotify ?? null,
    productId: response?.productId || response?.notification?.payload?.productId || null,
    barcode: response?.barcode || response?.notification?.payload?.barcode || null,
    dedupeUntil: response?.dedupeUntil || null,
    dedupeKey: response?.dedupeKey || null,
  };
};
const logProximityDebug = (eventName, fields = {}) => {
  if (!isDebug()) return;
  console.info(`[proximity] ${eventName}`, fields);
};
const readCustomerId = () => {
  if (typeof window === 'undefined') return 'guest';
  try {
    const user = JSON.parse(window.localStorage.getItem(CUSTOMER_USER_KEY) || 'null');
    return String(user?.id || user?.customerId || 'guest');
  } catch {
    return 'guest';
  }
};

const readCustomerNotificationPrefs = () => {
  if (typeof window === 'undefined') {
    return { inAppNotifications: true, phoneNotifications: true };
  }
  try {
    const scopedKey = `${CUSTOMER_PREFS_KEY}.${readCustomerId()}`;
    const raw = window.localStorage.getItem(scopedKey) || window.localStorage.getItem(`${CUSTOMER_PREFS_KEY}.guest`);
    const parsed = raw ? JSON.parse(raw) : null;
    const hasInAppPreference = typeof parsed?.inAppNotifications === 'boolean';
    const hasPhonePreference = typeof parsed?.phoneNotifications === 'boolean';
    const hasLegacyCampaignPreference = typeof parsed?.campaign === 'boolean';
    const hasLegacyStockPreference = typeof parsed?.stock === 'boolean';
    return {
      inAppNotifications: hasInAppPreference ? parsed.inAppNotifications !== false : (hasLegacyCampaignPreference ? parsed.campaign !== false : true),
      phoneNotifications: hasPhonePreference ? parsed.phoneNotifications !== false : (hasLegacyStockPreference ? parsed.stock !== false : true),
    };
  } catch {
    return { inAppNotifications: true, phoneNotifications: true };
  }
};

const resolveSurface = (pathname) => {
  const path = String(pathname || '');
  if (path.startsWith('/personel')) return 'personnel';
  return path.startsWith('/musteri') ? 'customer' : null;
};

const resolveActionLabel = (notification = {}) => {
  const payload = notification.payload && typeof notification.payload === 'object' ? notification.payload : {};
  const explicit = normalizeText(notification.actionLabel || payload.actionLabel);
  if (explicit) return explicit;
  if (notification.type === 'PROXIMITY_PRODUCT_DISCOUNT') return 'Ürüne Git';

  const typeText = `${notification.type || ''} ${notification.actionType || ''} ${notification.actionUrl || ''}`.toLocaleLowerCase('tr-TR');
  if (typeText.includes('campaign') || typeText.includes('kampanya')) return 'Kampanyayı Gör';
  if (typeText.includes('product') || typeText.includes('urun') || typeText.includes('ürün')) return 'Ürüne Git';
  if (typeText.includes('category') || typeText.includes('kategori')) return 'Kategoriye Git';
  return 'İncele';
};

const getNotificationSignature = (notification = {}) => [
  notification.id || '',
  notification.type || '',
  notification.title || '',
  notification.body || '',
  notification.actionUrl || '',
  notification.payload?.productId || '',
  notification.payload?.barcode || '',
].join(':');

const canNavigateToCustomerRoute = (actionUrl) => {
  const route = normalizeText(actionUrl);
  return Boolean(route && route.startsWith('/musteri'));
};

const toPriceNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'string' ? value.replace(',', '.') : value;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatTryPrice = (value) => {
  const numeric = toPriceNumber(value);
  if (numeric === null) return '';
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numeric);
};

const dispatchNativeNotificationEvent = (notification = {}, prefs = readCustomerNotificationPrefs()) => {
  if (typeof window === 'undefined') return;
  if (prefs.phoneNotifications === false) return;
  const payload = notification.payload && typeof notification.payload === 'object' ? notification.payload : {};
  const sectionName = cleanSectionDisplayName(payload.displaySectionName || payload.sectionName || notification.title, '');
  const title = normalizeText(payload.nativeTitle) || (sectionName ? `${sectionName} reyonundasın` : normalizeText(notification.title));
  const actionUrl = normalizeText(notification.actionUrl || payload.actionUrl);
  const detail = {
    title,
    body: normalizeText(payload.nativeBody)
      || (notification.type === 'PROXIMITY_PRODUCT_DISCOUNT' ? PRODUCT_DISCOUNT_NATIVE_BODY : normalizeText(notification.body || notification.message)),
    actionLabel: resolveActionLabel(notification),
    actionUrl,
    notificationId: notification.id || '',
    type: notification.type || '',
    payload,
  };

  try {
    window.dispatchEvent(new CustomEvent('shelfio:show-native-notification', {
      detail,
    }));
  } catch {
    // Native bridge is optional; desktop web should keep moving.
  }

  if (!title || !canNavigateToCustomerRoute(actionUrl)) return;

  try {
    const bridge = window.ShelfioNativeNotifications;
    if (!bridge || typeof bridge.showNotification !== 'function') return;
    bridge.showNotification(JSON.stringify(detail));
  } catch {
    // Android JS interface is optional; bridge errors should not break web flow.
  }
};

function ProximityNotificationCard({ notification, onClose, onAction }) {
  const title = normalizeText(notification.title) || 'Yakındaki fırsat';
  const body = normalizeText(notification.body || notification.message || notification.description);
  const actionLabel = resolveActionLabel(notification);
  const hasAction = canNavigateToCustomerRoute(notification.actionUrl);
  const payload = notification.payload && typeof notification.payload === 'object' ? notification.payload : {};
  const isProductDiscount = notification.type === 'PROXIMITY_PRODUCT_DISCOUNT';
  const regularPriceValue = toPriceNumber(payload.regularPrice);
  const displayPriceValue = toPriceNumber(payload.campaignPrice ?? payload.displayPrice);
  const regularPrice = regularPriceValue !== null && displayPriceValue !== null && Math.round(regularPriceValue * 100) > Math.round(displayPriceValue * 100)
    ? formatTryPrice(regularPriceValue)
    : '';
  const displayPrice = formatTryPrice(displayPriceValue);
  const productName = normalizeText(payload.productName);
  const sectionName = cleanSectionDisplayName(payload.displaySectionName || payload.sectionName || title, 'Yakındaki Reyon');
  const cardTitle = isProductDiscount ? sectionName : title;
  const description = isProductDiscount ? PRODUCT_DISCOUNT_DESCRIPTION : body;
  const productImage = normalizeText(payload.imageUrl || payload.productImageUrl || payload.thumbnailUrl);

  return (
    <div className="proximity-overlay is-customer" aria-live="polite">
      <section className="proximity-card" role="dialog" aria-modal="false" aria-label={cardTitle}>
        <button type="button" className="proximity-close" onClick={onClose} aria-label="Kapat">
          <X size={18} />
        </button>
        <div className="proximity-visual" aria-hidden="true">
          {productImage ? <img src={productImage} alt="" loading="lazy" /> : <MapPin size={20} />}
        </div>
        <div className="proximity-copy">
          <h3>{cardTitle}</h3>
          {isProductDiscount && productName ? <strong className="proximity-product-name">{productName}</strong> : null}
          {isProductDiscount && (regularPrice || displayPrice) ? (
            <div className="proximity-price-row">
              {regularPrice ? <span className="proximity-old-price">{regularPrice}</span> : null}
              {displayPrice ? <span className="proximity-new-price">{displayPrice}</span> : null}
            </div>
          ) : null}
          {description ? <p>{description}</p> : null}
        </div>
        <div className="proximity-actions">
          {hasAction ? (
            <button type="button" className="proximity-primary-action" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
          <button type="button" className="proximity-secondary-action" onClick={onClose}>
            Kapat
          </button>
        </div>
      </section>
    </div>
  );
}

export default function ProximityEventProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const cooldownRef = useRef(new Map());
  const dismissedRef = useRef(new Map());
  const queuedEventsRef = useRef([]);
  const processingQueueRef = useRef(false);
  const [activeNotification, setActiveNotification] = useState(null);
  const [notificationPrefs, setNotificationPrefs] = useState(readCustomerNotificationPrefs);
  const surface = useMemo(() => resolveSurface(location.pathname), [location.pathname]);

  useEffect(() => {
    const refreshPrefs = () => setNotificationPrefs(readCustomerNotificationPrefs());
    window.addEventListener(CUSTOMER_PREFS_UPDATED_EVENT, refreshPrefs);
    window.addEventListener('storage', refreshPrefs);
    return () => {
      window.removeEventListener(CUSTOMER_PREFS_UPDATED_EVENT, refreshPrefs);
      window.removeEventListener('storage', refreshPrefs);
    };
  }, []);

  useEffect(() => {
    if (!surface && activeNotification) {
      setActiveNotification(null);
    }
  }, [activeNotification, surface]);

  const handleClose = useCallback(() => {
    if (activeNotification?.notification) {
      dismissedRef.current.set(getNotificationSignature(activeNotification.notification), Date.now() + DISMISS_COOLDOWN_MS);
    }
    setActiveNotification(null);
  }, [activeNotification]);

  const handleAction = useCallback(() => {
    const route = normalizeText(activeNotification?.notification?.actionUrl);
    if (canNavigateToCustomerRoute(route)) {
      navigate(route);
    }
    handleClose();
  }, [activeNotification, handleClose, navigate]);

  const pruneQueuedEvents = useCallback(() => {
    const now = Date.now();
    const kept = [];
    queuedEventsRef.current.forEach((item) => {
      if (now - item.queuedAt <= QUEUED_EVENT_TTL_MS) {
        kept.push(item);
        return;
      }
      logProximityDebug('BEACON_EVENT_DROPPED', buildDebugFields({
        detail: item.detail,
        normalized: item.normalized,
        reason: 'QUEUE_TTL_EXPIRED',
      }));
    });
    queuedEventsRef.current = kept;
  }, []);

  const enqueueBeaconEvent = useCallback(({ detail, normalized, reason }) => {
    pruneQueuedEvents();
    if (queuedEventsRef.current.length >= QUEUED_EVENT_LIMIT) {
      const dropped = queuedEventsRef.current.shift();
      logProximityDebug('BEACON_EVENT_DROPPED', buildDebugFields({
        detail: dropped?.detail,
        normalized: dropped?.normalized,
        reason: 'QUEUE_LIMIT_EXCEEDED',
      }));
    }
    queuedEventsRef.current.push({
      detail,
      normalized,
      queuedAt: Date.now(),
    });
    logProximityDebug('BEACON_EVENT_QUEUED', buildDebugFields({ detail, normalized, reason }));
  }, [pruneQueuedEvents]);

  const deliverNormalizedEvent = useCallback(async ({ detail, normalized }) => {
    const route = currentRoute();
    const activeSurface = resolveSurface(typeof window === 'undefined' ? location.pathname : window.location.pathname);

    if (activeSurface === 'personnel') {
      logProximityDebug('BEACON_EVENT_DROPPED', buildDebugFields({ detail, normalized, route, reason: 'PERSONNEL_SURFACE' }));
      return false;
    }

    if (activeSurface !== 'customer') {
      return false;
    }

    const cooldownKey = getBeaconCooldownKey(normalized.payload);
    const now = Date.now();
    const cooldownUntil = cooldownRef.current.get(cooldownKey) || 0;
    if (cooldownUntil > now) {
      logProximityDebug('BEACON_EVENT_DROPPED', buildDebugFields({ detail, normalized, route, reason: 'FRONTEND_COOLDOWN_ACTIVE' }));
      return false;
    }
    cooldownRef.current.set(cooldownKey, now + FRONTEND_COOLDOWN_MS);

    try {
      const isAuthenticated = customerPortalAuthService.isLoggedIn();
      logProximityDebug('PROXIMITY_POST_STARTED', buildDebugFields({ detail, normalized, route }));
      const response = await proximityService.sendEventWithAuthRetry(normalized.payload, {
        onRetryAfterRefresh: () => {
          logProximityDebug('PROXIMITY_POST_RETRY_AFTER_REFRESH', buildDebugFields({ detail, normalized, route, reason: 'NOT_AUTHENTICATED' }));
        },
        onRefreshFailed: (error) => {
          logProximityDebug('PROXIMITY_POST_SKIPPED_AUTH', buildDebugFields({
            detail,
            normalized,
            route,
            reason: error?.message || 'CUSTOMER_REFRESH_FAILED',
          }));
        },
        onUnauthenticated: () => {
          logProximityDebug('PROXIMITY_POST_UNAUTHENTICATED', buildDebugFields({ detail, normalized, route, reason: 'CUSTOMER_TOKEN_MISSING' }));
        },
      });
      logProximityDebug('PROXIMITY_POST_RESULT', buildDebugFields({ detail, normalized, route, response }));
      if (!response?.success) return true;

      // Notification display only for authenticated customers
      if (!isAuthenticated || !response.shouldNotify || !response.notification) {
        return true;
      }

      if (normalizeText(response.notification.actionUrl) && !canNavigateToCustomerRoute(response.notification.actionUrl)) {
        logProximityDebug('BEACON_EVENT_DROPPED', buildDebugFields({ detail, normalized, route, reason: 'NON_CUSTOMER_ACTION_URL' }));
        return true;
      }

      const signature = getNotificationSignature(response.notification);
      const dismissedUntil = dismissedRef.current.get(signature) || 0;
      if (dismissedUntil > Date.now()) {
        return true;
      }

      if (notificationPrefs.inAppNotifications !== false) {
        setActiveNotification({
          id: `${response.eventId || Date.now()}`,
          notification: response.notification,
        });
      }
      dispatchNativeNotificationEvent(response.notification, notificationPrefs);
      try {
        window.dispatchEvent(new CustomEvent(CUSTOMER_NOTIFICATIONS_REFRESH_EVENT, {
          detail: { notification: response.notification, eventId: response.eventId || null },
        }));
      } catch {
        // Notification center refresh is best-effort for web/native shells.
      }
      return true;
    } catch (error) {
      logProximityDebug('BEACON_EVENT_DROPPED', buildDebugFields({
        detail,
        normalized,
        route,
        reason: error?.message || 'PROXIMITY_POST_FAILED',
      }));
      return false;
    }
  }, [location.pathname, notificationPrefs]);

  const flushQueuedEvents = useCallback(async () => {
    if (processingQueueRef.current) return;
    pruneQueuedEvents();
    if (surface !== 'customer') return;

    processingQueueRef.current = true;
    try {
      while (queuedEventsRef.current.length) {
        const next = queuedEventsRef.current.shift();
        await deliverNormalizedEvent(next);
      }
    } finally {
      processingQueueRef.current = false;
    }
  }, [deliverNormalizedEvent, pruneQueuedEvents, surface]);

  const handleBeaconDetected = useCallback(async (event) => {
    const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {};
    const route = currentRoute();
    logProximityDebug('BEACON_EVENT_RECEIVED', buildDebugFields({ detail, route }));

    const normalized = normalizeNativeBeaconEvent(detail);
    if (!normalized.valid) {
      logProximityDebug('BEACON_EVENT_DROPPED', buildDebugFields({ detail, normalized, route, reason: normalized.reason }));
      return;
    }

    const activeSurface = resolveSurface(typeof window === 'undefined' ? location.pathname : window.location.pathname);
    if (activeSurface === 'personnel') {
      logProximityDebug('BEACON_EVENT_DROPPED', buildDebugFields({ detail, normalized, route, reason: 'PERSONNEL_SURFACE' }));
      return;
    }

    if (activeSurface !== 'customer') {
      enqueueBeaconEvent({ detail, normalized, reason: 'WAITING_FOR_CUSTOMER_SURFACE' });
      return;
    }

    await deliverNormalizedEvent({ detail, normalized });
  }, [deliverNormalizedEvent, enqueueBeaconEvent, location.pathname]);

  useEffect(() => {
    window.addEventListener(NATIVE_BEACON_EVENT, handleBeaconDetected);
    return () => {
      window.removeEventListener(NATIVE_BEACON_EVENT, handleBeaconDetected);
    };
  }, [handleBeaconDetected]);

  useEffect(() => {
    flushQueuedEvents();
  }, [flushQueuedEvents]);

  useEffect(() => {
    window.addEventListener(CUSTOMER_AUTH_UPDATED_EVENT, flushQueuedEvents);
    window.addEventListener('focus', flushQueuedEvents);
    return () => {
      window.removeEventListener(CUSTOMER_AUTH_UPDATED_EVENT, flushQueuedEvents);
      window.removeEventListener('focus', flushQueuedEvents);
    };
  }, [flushQueuedEvents]);

  return (
    <>
      {children}
      {surface === 'customer' && activeNotification?.notification ? (
        <ProximityNotificationCard
          notification={activeNotification.notification}
          onClose={handleClose}
          onAction={handleAction}
        />
      ) : null}
    </>
  );
}
