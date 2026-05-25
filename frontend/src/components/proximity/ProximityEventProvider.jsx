import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getBeaconCooldownKey,
  normalizeNativeBeaconEvent,
  proximityService,
} from '../../services/proximityService.js';
import { cleanSectionDisplayName } from '../../services/formatters.js';
import './ProximityEventProvider.css';

const NATIVE_BEACON_EVENT = 'shelfio:beacon-detected';
const CUSTOMER_PREFS_KEY = 'shelfio.customer.preferences';
const CUSTOMER_USER_KEY = 'shelfio_customer_user';
const CUSTOMER_PREFS_UPDATED_EVENT = 'shelfio:customer-preferences-updated';
const CUSTOMER_NOTIFICATIONS_REFRESH_EVENT = 'shelfio:customer-notifications-refresh';
const FRONTEND_COOLDOWN_MS = 1 * 1000;
const DISMISS_COOLDOWN_MS = 60 * 1000;
const PRODUCT_DISCOUNT_DESCRIPTION = 'Şu an bulunduğunuz reyonda ilginizi çekebilecek ürünlere rastladık.';
const PRODUCT_DISCOUNT_NATIVE_BODY = 'İlgini çekebilecek ürünler keşfettik.';

const isDev = () => Boolean(import.meta.env?.DEV);
const normalizeText = (value) => String(value || '').trim();
const logProximityDecision = ({ response = {}, payload = {} } = {}) => {
  if (!isDev()) return;
  console.info('[proximity] no customer notification', {
    reason: response?.reason || 'NO_REASON',
    productId: response?.productId || response?.notification?.payload?.productId || null,
    barcode: response?.barcode || response?.notification?.payload?.barcode || null,
    productName: response?.productName || response?.notification?.payload?.productName || null,
    dedupeKey: response?.dedupeKey || null,
    dedupeUntil: response?.dedupeUntil || null,
    eventType: payload?.eventType || null,
    deviceId: payload?.deviceId || payload?.deviceCode || null,
  });
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

  useEffect(() => {
    if (surface !== 'customer') return undefined;

    let disposed = false;

    const handleBeaconDetected = async (event) => {
      const normalized = normalizeNativeBeaconEvent(event?.detail);
      if (!normalized.valid) {
        if (isDev()) console.debug('[proximity] ignored native beacon event', normalized.reason);
        return;
      }

      const cooldownKey = getBeaconCooldownKey(normalized.payload);
      const now = Date.now();
      const cooldownUntil = cooldownRef.current.get(cooldownKey) || 0;
      if (cooldownUntil > now) {
        if (isDev()) console.debug('[proximity] customer frontend cooldown active');
        return;
      }
      cooldownRef.current.set(cooldownKey, now + FRONTEND_COOLDOWN_MS);

      try {
        const response = await proximityService.sendEventWithAuthRetry(normalized.payload);
        if (disposed || !response?.success) return;

        if (!response.shouldNotify || !response.notification) {
          logProximityDecision({ response, payload: normalized.payload });
          return;
        }

        if (normalizeText(response.notification.actionUrl) && !canNavigateToCustomerRoute(response.notification.actionUrl)) {
          if (isDev()) console.debug('[proximity] ignored non-customer actionUrl');
          return;
        }

        const signature = getNotificationSignature(response.notification);
        const dismissedUntil = dismissedRef.current.get(signature) || 0;
        if (dismissedUntil > Date.now()) {
          return;
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
      } catch (error) {
        if (isDev()) console.debug('[proximity] customer event delivery failed', error?.message || error);
      }
    };

    window.addEventListener(NATIVE_BEACON_EVENT, handleBeaconDetected);
    return () => {
      disposed = true;
      window.removeEventListener(NATIVE_BEACON_EVENT, handleBeaconDetected);
    };
  }, [notificationPrefs, surface]);

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
