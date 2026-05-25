import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, BellRing, ChevronRight, Clock, Eye, Flame, Heart, History, Home, LifeBuoy, ListOrdered, MapPin, PackageSearch, QrCode, Search, ShoppingBag, Store, Tag, Trash2, User, Megaphone, Sparkles, Gift, ReceiptText, ShieldAlert, ShieldCheck, Settings, Mail, Phone, Lock, Save } from 'lucide-react';
import './CustomerPortal.css';
import './MobileShopping.css';
import logoPng from '../../assets/logo.png';
import { cleanSectionDisplayName, formatCurrency, formatCustomerOrderDisplayId, joinDisplayParts, normalizeTurkishText } from '../../services/formatters.js';
import { normalizeNotification } from '../../services/notificationService.js';
import CustomerAppShell from '../../components/customer/CustomerAppShell.jsx';
import CustomerProductDetail from '../../components/customer/CustomerProductDetail.jsx';
import CustomerCartFull from '../../components/customer/CustomerCartFull.jsx';
import ProductResultCard from '../../components/customer/ProductResultCard.jsx';
import BottomNavigationDock from '../../components/customer/BottomNavigationDock.jsx';
import PageLoading from '../../components/PageLoading.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import { customerPortalAuthService } from '../../services/customerPortalAuthService.js';
import { customerCatalogService } from '../../services/customerCatalogService.js';
import { SUPPORT_CONTACT } from '../../constants/contact.js';
import { useCustomerCatalogCategories } from '../../hooks/useCustomerCatalogCategories.js';
import { CAMERA_PERMISSION_HELP_TEXT, getCameraErrorMessage, logCameraError, startHtml5Scanner, waitForCameraElement } from '../../utils/cameraAccess.js';

const RECENT_STORAGE_KEY = 'shelfio.customer.recent.products';
const CUSTOMER_PREFS_KEY = 'shelfio.customer.preferences';
const CUSTOMER_PREFS_UPDATED_EVENT = 'shelfio:customer-preferences-updated';
const CUSTOMER_NOTIFICATIONS_REFRESH_EVENT = 'shelfio:customer-notifications-refresh';
const SHOPPING_LIST_STORAGE_KEY = 'shelfio.customer.shopping.list';
const FAVORITES_STORAGE_KEY = 'shelfio.customer.favorites';
const ORDER_HISTORY_STORAGE_KEY = 'shelfio.customer.order.history';
const CART_STORAGE_KEY = 'shelfio.customer.cart';
const SEARCH_DEBOUNCE_MS = 320;
const CUSTOMER_HOME_PRODUCT_LIMIT = 24;
const CUSTOMER_SECONDARY_PRODUCT_LIMIT = 12;
const CUSTOMER_LAZY_PRODUCT_LIMIT = 60;
const AUTH_REQUIRED_VIEWS = new Set(['account', 'favorites', 'shopping-list', 'gift-cards', 'order-history', 'settings', 'help']);
const CUSTOMER_CAMPAIGN_MODE_QUERY = {
  all: 'tumu',
  today: 'bugune-ozel',
  popular: 'populer',
  'campaign-products': 'kampanyali-urunler',
};
const ALL_CATEGORY_TAG_KEY = '__all__';

const BOTTOM_TABS = [
  { key: 'home', label: 'Ana Sayfa', icon: Home },
  { key: 'search', label: 'Ara', icon: Search },
  { key: 'campaigns', label: 'Kampanyalar', icon: Tag },
  { key: 'cart', label: 'Sepet', icon: ShoppingBag },
  { key: 'account', label: 'Hesabım', icon: User },
];

const CATEGORY_VISUAL_CARDS = [
  { id: 'atistirmalik', name: 'Atıştırmalık', query: 'Atıştırmalık', image: 'atistirmalik.png' },
  { id: 'bebek', name: 'Bebek', query: 'Bebek', image: 'bebek.png' },
  { id: 'deterjan-temizlik', name: 'Deterjan, Temizlik', query: 'Deterjan Temizlik', image: 'deterjan-temizlik.png' },
  { id: 'elektronik', name: 'Elektronik', query: 'Elektronik', image: 'elektronik.png' },
  { id: 'et-tavuk-balik', name: 'Et, Tavuk, Balık', query: 'Et Tavuk Balık', image: 'et-tavuk-balik.png' },
  { id: 'ev-yasam', name: 'Ev, Yaşam', query: 'Ev Yaşam', image: 'ev-yasam.png' },
  { id: 'evcil-hayvan', name: 'Evcil Hayvan', query: 'Evcil Hayvan', image: 'evcil-hayvan.png' },
  { id: 'firin-pastane', name: 'Fırın, Pastane', query: 'Fırın Pastane', image: 'firin-pastane.png' },
  { id: 'hazir-yemek-donuk', name: 'Hazır Yemek, Donuk', query: 'Hazır Yemek Donuk', image: 'hazir-yemek-donuk.png' },
  { id: 'icecek', name: 'İçecek', query: 'İçecek', image: 'icecek.png' },
  { id: 'kagit-islak-mendil', name: 'Kağıt, Islak Mendil', query: 'Kağıt Islak Mendil', image: 'kagit-islak-mendil.png' },
  { id: 'kisisel-bakim-kozmetik-saglik', name: 'Kişisel Bakım, Kozmetik, Sağlık', query: 'Kişisel Bakım Kozmetik Sağlık', image: 'kisisel-bakim-kozmetik-saglik.png' },
  { id: 'kitap-kirtasiye-oyuncak', name: 'Kitap, Kırtasiye, Oyuncak', query: 'Kitap Kırtasiye Oyuncak', image: 'kitap-kirtasiye-oyuncak.png' },
  { id: 'meyve-sebze', name: 'Meyve, Sebze', query: 'Meyve Sebze', image: 'meyve-sebze.png' },
  { id: 'sut-kahvaltilik', name: 'Süt, Kahvaltılık', query: 'Süt Kahvaltılık', image: 'sut-kahvaltilik.png' },
  { id: 'temel-gida', name: 'Temel Gıda', query: 'Temel Gıda', image: 'temel-gida.png' },
];

const loadHtml5Qrcode = async () => {
  const mod = await import('html5-qrcode');
  return mod.Html5Qrcode;
};

const accountTab = BOTTOM_TABS.find((tab) => tab.key === 'account');
if (accountTab) accountTab.label = 'Hesab\u0131m';

CATEGORY_VISUAL_CARDS.splice(0, CATEGORY_VISUAL_CARDS.length,
  { id: 'atistirmalik', name: 'At\u0131\u015ft\u0131rmal\u0131k', query: 'At\u0131\u015ft\u0131rmal\u0131k', image: 'atistirmalik.png' },
  { id: 'bebek', name: 'Bebek', query: 'Bebek', image: 'bebek.png' },
  { id: 'deterjan-temizlik', name: 'Deterjan, Temizlik', query: 'Deterjan Temizlik', image: 'deterjan-temizlik.png' },
  { id: 'elektronik', name: 'Elektronik', query: 'Elektronik', image: 'elektronik.png' },
  { id: 'et-tavuk-balik', name: 'Et, Tavuk, Bal\u0131k', query: 'Et Tavuk Bal\u0131k', image: 'et-tavuk-balik.png' },
  { id: 'ev-yasam', name: 'Ev, Ya\u015fam', query: 'Ev Ya\u015fam', image: 'ev-yasam.png' },
  { id: 'evcil-hayvan', name: 'Evcil Hayvan', query: 'Evcil Hayvan', image: 'evcil-hayvan.png' },
  { id: 'firin-pastane', name: 'F\u0131r\u0131n, Pastane', query: 'F\u0131r\u0131n Pastane', image: 'firin-pastane.png' },
  { id: 'hazir-yemek-donuk', name: 'Haz\u0131r Yemek, Donuk', query: 'Haz\u0131r Yemek Donuk', image: 'hazir-yemek-donuk.png' },
  { id: 'icecek', name: '\u0130\u00e7ecek', query: '\u0130\u00e7ecek', image: 'icecek.png' },
  { id: 'kagit-islak-mendil', name: 'Ka\u011f\u0131t, Islak Mendil', query: 'Ka\u011f\u0131t Islak Mendil', image: 'kagit-islak-mendil.png' },
  { id: 'kisisel-bakim-kozmetik-saglik', name: 'Ki\u015fisel Bak\u0131m, Kozmetik, Sa\u011fl\u0131k', query: 'Ki\u015fisel Bak\u0131m Kozmetik Sa\u011fl\u0131k', image: 'kisisel-bakim-kozmetik-saglik.png' },
  { id: 'kitap-kirtasiye-oyuncak', name: 'Kitap, K\u0131rtasiye, Oyuncak', query: 'Kitap K\u0131rtasiye Oyuncak', image: 'kitap-kirtasiye-oyuncak.png' },
  { id: 'meyve-sebze', name: 'Meyve, Sebze', query: 'Meyve Sebze', image: 'meyve-sebze.png' },
  { id: 'sut-kahvaltilik', name: 'S\u00fct, Kahvalt\u0131l\u0131k', query: 'S\u00fct Kahvalt\u0131l\u0131k', image: 'sut-kahvaltilik.png' },
  { id: 'temel-gida', name: 'Temel G\u0131da', query: 'Temel G\u0131da', image: 'temel-gida.png' },
);

const categoryAssetUrl = (fileName) => new URL(`../../assets/kategori_gorsel/${fileName}`, import.meta.url).href;
const slugify = (value) => String(value || '')
  .replace(/[çÇ]/g, 'c')
  .replace(/[ğĞ]/g, 'g')
  .replace(/[ıİ]/g, 'i')
  .replace(/[öÖ]/g, 'o')
  .replace(/[şŞ]/g, 's')
  .replace(/[üÜ]/g, 'u')
  .toLocaleLowerCase('tr-TR')
  .replace(/[^a-z0-9\s-]/gi, '')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .trim();

function readStoredArray(key) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStoredObject(key) {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mergeProductRows(current = [], incoming = []) {
  const byId = new Map();
  [...current, ...incoming].forEach((item) => {
    const id = String(item?.id || item?.productId || '').trim();
    if (!id) return;
    byId.set(id, { ...(byId.get(id) || {}), ...item, id });
  });
  return Array.from(byId.values());
}

function scopedKey(baseKey, customerId) {
  return `${baseKey}.${String(customerId || 'guest')}`;
}

function writeStoredArray(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op
  }
}

function writeStoredObject(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value && typeof value === 'object' ? value : {}));
  } catch {
    // no-op
  }
}

function readCustomerPrefs(storageKey = CUSTOMER_PREFS_KEY) {
  if (typeof window === 'undefined') {
    return { inAppNotifications: true, phoneNotifications: true };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    const hasInAppPreference = typeof parsed?.inAppNotifications === 'boolean';
    const hasPhonePreference = typeof parsed?.phoneNotifications === 'boolean';
    const hasLegacyCampaignPreference = typeof parsed?.campaign === 'boolean';
    const hasLegacyStockPreference = typeof parsed?.stock === 'boolean';
    const migrated = {
      inAppNotifications: hasInAppPreference ? parsed.inAppNotifications !== false : (hasLegacyCampaignPreference ? parsed.campaign !== false : true),
      phoneNotifications: hasPhonePreference ? parsed.phoneNotifications !== false : (hasLegacyStockPreference ? parsed.stock !== false : true),
    };
    if (parsed && (!hasInAppPreference || !hasPhonePreference)) {
      writeStoredObject(storageKey, { ...parsed, ...migrated });
    }
    return migrated;
  } catch {
    return { inAppNotifications: true, phoneNotifications: true };
  }
}

function writeCustomerPrefs(value, storageKey = CUSTOMER_PREFS_KEY) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(CUSTOMER_PREFS_UPDATED_EVENT, { detail: value }));
  } catch {
    // no-op
  }
}

function isStoreOpenNow(settings = {}) {
  return resolveCustomerStoreScheduleStatus(settings).isStoreOpen;
}

const STORE_DAY_NAMES = ['Pazar', 'Pazartesi', 'Sali', 'Carsamba', 'Persembe', 'Cuma', 'Cumartesi'];
const STORE_DAY_ALIASES = new Map([
  ['pazar', 'Pazar'],
  ['pazartesi', 'Pazartesi'],
  ['sali', 'Sali'],
  ['salı', 'Sali'],
  ['carsamba', 'Carsamba'],
  ['çarşamba', 'Carsamba'],
  ['persembe', 'Persembe'],
  ['perşembe', 'Persembe'],
  ['cuma', 'Cuma'],
  ['cumartesi', 'Cumartesi'],
]);

const normalizeStoreDayKey = (value) => {
  const key = String(value || '').trim().toLocaleLowerCase('tr-TR');
  return STORE_DAY_ALIASES.get(key) || String(value || '').trim();
};

const parseStoreTimeMinutes = (value) => {
  const match = String(value || '').trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return (hour * 60) + minute;
};

const getCustomerStoreLocalParts = (date = new Date(), timeZone = 'Europe/Istanbul') => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== 'literal') accumulator[part.type] = part.value;
    return accumulator;
  }, {});
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const dayKey = STORE_DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    dayKey,
    minutesOfDay: (hour * 60) + minute,
  };
};

const resolveCustomerStoreScheduleStatus = (settings = {}, date = new Date()) => {
  const timeZone = String(settings?.timezone || 'Europe/Istanbul').trim() || 'Europe/Istanbul';
  const local = getCustomerStoreLocalParts(date, timeZone);
  const specialDays = Array.isArray(settings?.specialDays) ? settings.specialDays : [];
  const weeklySchedule = Array.isArray(settings?.weeklySchedule) ? settings.weeklySchedule : [];
  const closedDays = new Set((Array.isArray(settings?.closedDays) ? settings.closedDays : []).map(normalizeStoreDayKey));
  const activeSpecialDay = specialDays.find((item) => {
    const specialDate = String(item?.date || item?.startDate || '').trim();
    return specialDate === local.localDate && item?.isActive !== false;
  }) || null;
  const todaySchedule = weeklySchedule.find((item) => normalizeStoreDayKey(item?.dayKey) === local.dayKey) || null;
  const isClosed = settings?.holidayMode === true
    || activeSpecialDay?.isClosed === true
    || (!activeSpecialDay && (todaySchedule?.isClosed === true || closedDays.has(local.dayKey)));
  const opensAt = activeSpecialDay?.opensAt || activeSpecialDay?.startTime || todaySchedule?.opensAt || settings?.openingTime || '10:00';
  const closesAt = activeSpecialDay?.closesAt || activeSpecialDay?.endTime || todaySchedule?.closesAt || settings?.closingTime || '22:00';
  const openMinutes = parseStoreTimeMinutes(opensAt);
  const closeMinutes = parseStoreTimeMinutes(closesAt);
  const withinHours = !isClosed && openMinutes !== null && closeMinutes !== null && openMinutes !== closeMinutes
    ? (openMinutes < closeMinutes
      ? local.minutesOfDay >= openMinutes && local.minutesOfDay < closeMinutes
      : local.minutesOfDay >= openMinutes || local.minutesOfDay < closeMinutes)
    : false;

  return {
    ...local,
    timeZone,
    source: activeSpecialDay ? 'specialDay' : 'weeklySchedule',
    isStoreOpen: withinHours,
    isClosed,
    opensAt,
    closesAt,
    todaySchedule,
    specialDay: activeSpecialDay,
  };
};

function isCustomerFacingNotification(item) {
  const type = String(item?.type || '').toLocaleLowerCase('tr-TR');
  const actionType = String(item?.actionType || '').toLocaleLowerCase('tr-TR');
  const title = String(item?.title || '').toLocaleLowerCase('tr-TR');
  const description = String(item?.description || '').toLocaleLowerCase('tr-TR');
  const actionUrl = String(item?.actionUrl || '').toLocaleLowerCase('tr-TR');
  if (item?.relatedTaskId) return false;
  if (actionUrl.startsWith('/personel') || actionUrl.includes('/gorev')) return false;
  if (actionType === 'task' || actionType === 'order' || actionType === 'stock') return false;
  if (/(task|gorev|assigned|overdue|upcoming|sla|stok|siparis|mention|comment)/.test(type)) return false;
  if (/(task|gorev|assigned|overdue|upcoming|sla|stok|siparis|personel)/.test(title)) return false;
  if (/(task|gorev|assigned|overdue|upcoming|sla|stok|siparis|personel)/.test(description)) return false;
  return true;
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const CUSTOMER_SEARCH_CHAR_MAP = {
  Ç: 'c',
  ç: 'c',
  Ğ: 'g',
  ğ: 'g',
  I: 'i',
  ı: 'i',
  İ: 'i',
  Ö: 'o',
  ö: 'o',
  Ş: 's',
  ş: 's',
  Ü: 'u',
  ü: 'u',
};
const normalizeKey = (value) => String(value || '')
  .replace(/[ÇçĞğIıİÖöŞşÜü]/g, (char) => CUSTOMER_SEARCH_CHAR_MAP[char] || char)
  .toLocaleLowerCase('tr-TR')
  .replace(/\s+/g, ' ')
  .trim();
const splitTokens = (value) => normalizeKey(value).split(/[\s,./\-|()]+/).map((item) => item.trim()).filter((item) => item.length >= 3);
const normalizeBarcodeSearch = (value) => String(value || '').replace(/\s+/g, '').trim();
const toTagList = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};
const getProductTagList = (item = {}) => dedupeTags([
  ...toTagList(item?.etiket),
  ...toTagList(item?.tag),
  ...toTagList(item?.tags),
  ...toTagList(item?.label),
  ...toTagList(item?.labels),
  ...toTagList(item?.keywords),
  ...toTagList(item?.subTags),
  ...toTagList(item?.subcategories),
  ...toTagList(item?.subCategories),
]);
const dedupeTags = (tags = []) => {
  const seen = new Set();
  const result = [];
  tags.forEach((tag) => {
    const label = String(tag || '').trim();
    const key = normalizeKey(label);
    if (!label || !key || seen.has(key)) return;
    seen.add(key);
    result.push(label);
  });
  return result;
};
const resolveLocationLabel = (product) => cleanSectionDisplayName(product?.shelfCode || product?.defaultShelfLocationCode || product?.sectionName || '-');
const resolveSupportContact = (settings = {}) => ({
  email: String(settings?.storeEmail || settings?.supportEmail || settings?.email || settings?.contactEmail || SUPPORT_CONTACT.email || '').trim(),
  phone: String(settings?.storePhone || settings?.supportPhone || settings?.phone || settings?.contactPhone || SUPPORT_CONTACT.phone || '').trim(),
});
const buildTelHref = (phone) => {
  const normalized = String(phone || '').replace(/[^\d+]/g, '');
  return normalized ? `tel:${normalized}` : '';
};
const buildMailHref = (email) => {
  const normalized = String(email || '').trim();
  return normalized ? `mailto:${normalized}` : '';
};
const NAME_MOJIBAKE_MAP = {
  '\u00c3\u2013': 'Ö',
  '\u00c3\u00bc': 'ü',
  '\u00c4\u00b1': 'ı',
  '\u00c5\u0178': 'ş',
  '\u00c3\u00a7': 'ç',
  '\u00c4\u0178': 'ğ',
  '\u00c3\u00b6': 'ö',
  '\u00c3\u0153': 'Ü',
  '\u00c4\u00b0': 'İ',
  '\u00c5\u017d': 'Ş',
  '\u00c3\u0087': 'Ç',
  '\u00c4\u017d': 'Ğ',
};

function normalizeCustomerName(value) {
  const raw = String(value || '');
  if (!raw) return '';
  return raw.replace(
    /\u00c3\u2013|\u00c3\u00bc|\u00c4\u00b1|\u00c5\u0178|\u00c3\u00a7|\u00c4\u0178|\u00c3\u00b6|\u00c3\u0153|\u00c4\u00b0|\u00c5\u017d|\u00c3\u0087|\u00c4\u017d/g,
    (token) => NAME_MOJIBAKE_MAP[token] || token
  );
}

const CUSTOMER_TEXT_REPLACEMENTS = [
  ['\u00c3\u2013', '\u00d6'],
  ['\u00c3\u00bc', '\u00fc'],
  ['\u00c4\u00b1', '\u0131'],
  ['\u00c5\u0178', '\u015f'],
  ['\u00c3\u00a7', '\u00e7'],
  ['\u00c4\u0178', '\u011f'],
  ['\u00c3\u00b6', '\u00f6'],
  ['\u00c3\u0153', '\u00dc'],
  ['\u00c4\u00b0', '\u0130'],
  ['\u00c5\u017d', '\u015e'],
  ['\u00c3\u0087', '\u00c7'],
  ['\u00c4\u017d', '\u011e'],
  ['\u00e2\u20ac\u00a2', '\u2022'],
  ['\u00c3\u00a2\u201a\u00ac\u00c2\u00a2', '\u2022'],
  ['?r?n', '\u00fcr\u00fcn'],
];

function repairCustomerUiText(value, fallback = '') {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const normalized = CUSTOMER_TEXT_REPLACEMENTS.reduce((text, [from, to]) => text.replaceAll(from, to), normalizeCustomerName(raw));
  return normalizeTurkishText(normalized, fallback);
}

function normalizeCustomerCount(count) {
  const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
  return safeCount;
}

function formatCustomerSearchResultCount(count) {
  const safeCount = normalizeCustomerCount(count);
  return `${safeCount} ürün bulundu`;
}

const CUSTOMER_UI_MOJIBAKE_REPLACEMENTS = [
  ['ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â±', 'ı'],
  ['ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°', 'İ'],
  ['ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¼', 'ü'],
  ['ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¶', 'ö'],
  ['ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§', 'ç'],
  ['ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸', 'ş'],
  ['ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â', 'Ş'],
  ['ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸', 'ğ'],
  ['ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â', 'Ğ'],
  ['ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ', 'Ü'],
  ['ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“', 'Ö'],
  ['ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¡', 'Ç'],
  ['ÃƒÆ’Ã¢â‚¬ÂÃƒâ€šÃ‚Â±', 'ı'],
  ['ÃƒÆ’Ã¢â‚¬ÂÃƒâ€šÃ‚Â°', 'İ'],
  ['ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¼', 'ü'],
  ['ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¶', 'ö'],
  ['ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â§', 'ç'],
  ['ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€¦Ã‚Â¸', 'ş'],
  ['ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â', 'Ş'],
  ['ÃƒÆ’Ã¢â‚¬ÂÃƒâ€¦Ã‚Â¸', 'ğ'],
  ['ÃƒÆ’Ã†â€™Ãƒâ€¦Ã¢â‚¬Å“', 'Ü'],
  ['ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“', 'Ö'],
  ['ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¡', 'Ç'],
  ['ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢', '•'],
  ['?u anda', 'Şu anda'],
  ['Fiyat Ge?mi?i', 'Fiyat Geçmişi'],
  ['Tahmini stok biti?i', 'Tahmini stok bitişi'],
  ['Stok uzun s?re yeterli g?r?n?yor', 'Stok uzun süre yeterli görünüyor'],
  ['Ma?azada mevcut', 'Mağazada mevcut'],
  ['M?sait Kasalar', 'Müsait Kasalar'],
  ['Kategorı', 'Kategori'],
];

CUSTOMER_UI_MOJIBAKE_REPLACEMENTS.push(
  ['GiriÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€¦Ã‚Â¸ Gerekli', 'Giriş Gerekli'],
  ['GiriÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€¦Ã‚Â¸ gerekli', 'Giriş Gerekli'],
  ['GiriÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€¦Ã‚Â¸ Yap', 'Giriş Yap'],
  ['KayÃƒÆ’Ã¢â‚¬ÂÃƒâ€šÃ‚Â±t Ol', 'Kayıt Ol'],
  ['Bu alan kiÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€¦Ã‚Â¸isel verilerinizi iÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â§erir. Devam etmek iÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â§in giriÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€¦Ã‚Â¸ yapÃƒÆ’Ã¢â‚¬ÂÃƒâ€šÃ‚Â±n veya hesap oluÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€¦Ã‚Â¸turun.', 'Bu alan kişisel verilerinizi içerir. Devam etmek için giriş yapın veya hesap oluşturun.'],
  ['sÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¼t', 'süt'],
  ['ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â§ikolata', 'çikolata'],
  ['yoÃƒÆ’Ã¢â‚¬ÂÃƒâ€šÃ‚Â¸urt', 'yoğurt'],
  ['SonuÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â§ bulunamadÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚ÂÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â±.', 'Sonuç bulunamadı.'],
  ['ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¼rÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¼nler yÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¼kleniyor...', 'Ürünler yükleniyor...'],
  ['PopÃ¼ler Aramalar', 'Popüler Aramalar'],
);

function repairCustomerVisibleText(value) {
  const raw = String(value ?? '');
  if (!raw) return raw;
  let next = raw;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const previous = next;
    next = CUSTOMER_UI_MOJIBAKE_REPLACEMENTS.reduce((text, [from, to]) => text.replaceAll(from, to), next);
    next = repairCustomerUiText(next, next);
    if (next === previous) break;
  }
  return next;
}

function joinCustomerMeta(parts = []) {
  return joinDisplayParts(parts.map((part) => repairCustomerUiText(part, '')));
}

function isDeskFlagTrue(value) {
  if (typeof value === 'boolean') return value;
  const key = String(value ?? '').trim().toLocaleLowerCase('tr-TR');
  return ['1', 'true', 'yes', 'aktif', 'a\u00e7\u0131k', 'acik', 'open', 'available', 'm\u00fcsait', 'musait', 'ready', 'enabled'].includes(key);
}

function isDeskFlagFalse(value) {
  if (value == null || value === '') return false;
  if (typeof value === 'boolean') return value === false;
  const key = String(value).trim().toLocaleLowerCase('tr-TR');
  return ['0', 'false', 'no', 'kapal\u0131', 'kapali', 'closed', 'inactive', 'pasif', 'disabled', 'offline'].includes(key);
}

function isBusyDeskState(value) {
  const key = String(value ?? '').trim().toLocaleLowerCase('tr-TR');
  return ['busy', 'occupied', 'in-use', 'in_use', 'using', 'kullan\u0131mda', 'kullanimda', 'dolu', 'serving'].includes(key);
}

function isUnavailableDeskState(value) {
  const key = String(value ?? '').trim().toLocaleLowerCase('tr-TR');
  return ['closed', 'inactive', 'offline', 'disabled', 'out_of_service', 'out-of-service', 'maintenance', 'kapal\u0131', 'kapali', 'pasif', 'bakimda'].includes(key);
}

function isCampaignActive(campaign) {
  if (!campaign || campaign.isActive === false) return false;
  const status = String(campaign.status || '').toLocaleLowerCase('tr-TR');
  if (status && status !== 'active' && status !== 'aktif') return false;
  const now = Date.now();
  const startsAt = parseDate(campaign.startsAt || campaign.startAt);
  const endsAt = parseDate(campaign.endsAt || campaign.endAt);
  if (startsAt && startsAt.getTime() > now) return false;
  if (endsAt) {
    const endOfDay = new Date(endsAt);
    endOfDay.setHours(23, 59, 59, 999);
    if (endOfDay.getTime() < now) return false;
  }
  return true;
}

function toLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isCampaignActiveOnLocalDate(campaign, localDateKey = toLocalDateKey()) {
  if (!isCampaignActive(campaign)) return false;
  const startsAt = parseDate(campaign?.startsAt || campaign?.startAt || campaign?.startDate);
  const endsAt = parseDate(campaign?.endsAt || campaign?.endAt || campaign?.endDate);
  const startKey = startsAt ? toLocalDateKey(startsAt) : '';
  const endKey = endsAt ? toLocalDateKey(endsAt) : '';
  if (startKey && startKey > localDateKey) return false;
  if (endKey && endKey < localDateKey) return false;
  return true;
}

const normalizeCampaignTitleKey = (value) => String(value || '')
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ÃƒÆ’Ã¢â‚¬ÂÃƒâ€šÃ‚Â±/g, 'i')
  .replace(/[^a-z0-9\s,]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isInternalCampaignTitle = (value) => {
  const key = normalizeCampaignTitleKey(value);
  return /\b(dinamik talep|talep sinyali|oneri sinyali|sinyal|raf aksiyonu|aksiyon onerisi|aksiyon|oneri|draft|test|internal)\b/.test(key)
    || /\bicin\s+(hizli indirim|aksiyon|indirim onerisi|oneri)\b/.test(key)
    || /\s\d{1,3}$/.test(key);
};

const CUSTOMER_CAMPAIGN_FILTER_TYPES = new Set(['general', 'category', 'brand']);
const CUSTOMER_CAMPAIGN_FILTER_SOURCE_TYPES = new Set(['', 'general', 'category', 'brand']);
const CUSTOMER_CAMPAIGN_NON_FILTER_SOURCES = new Set([
  'product',
  'expiry',
  'sales',
  'dynamic',
  'recommendation',
  'recommendations',
  'suggestion',
  'suggestions',
  'automation',
  'system',
  'price-recommendations',
  'order-recommendations',
]);

function normalizeCustomerCampaignType(campaign = {}) {
  return String(campaign?.type || campaign?.campaignType || campaign?.sourceModule || campaign?.module || 'general')
    .trim()
    .toLocaleLowerCase('tr-TR') || 'general';
}

function isCustomerCampaignFilterable(campaign = {}) {
  const type = normalizeCustomerCampaignType(campaign);
  const source = String(campaign?.sourceModule || campaign?.module || campaign?.source || '')
    .trim()
    .toLocaleLowerCase('tr-TR');
  if (!CUSTOMER_CAMPAIGN_FILTER_TYPES.has(type)) return false;
  if (CUSTOMER_CAMPAIGN_NON_FILTER_SOURCES.has(source)) return false;
  return CUSTOMER_CAMPAIGN_FILTER_SOURCE_TYPES.has(source);
}

function resolveCustomerCampaignFallbackTitle(campaign = {}) {
  const type = normalizeCustomerCampaignType(campaign);
  const source = String(campaign?.sourceModule || campaign?.module || '').trim().toLocaleLowerCase('tr-TR');
  if (source === 'expiry' || type === 'expiry') return 'SKT Yaklaşan Ürünlerde Fırsat';
  if (source === 'sales' || type === 'sales') return 'Satış Fırsatları';
  if (type === 'category') return 'Kategori Fırsatları';
  if (type === 'brand') return 'Marka Fırsatları';
  if (type === 'product') return 'Seçili Ürünlerde İndirim';
  return 'Haftanın İndirimli Ürünleri';
}

const CUSTOMER_CAMPAIGN_TITLE_RULES = [
  { keys: ['atistirmalik', 'biskuvi', 'cikolata', 'cips'], title: 'At\u0131\u015ft\u0131rmal\u0131klarda \u0130ndirim' },
  { keys: ['sut kahvaltilik', 'kahvaltilik', 'peynir', 'yogurt', 'yumurta'], title: 'Kahvalt\u0131l\u0131klarda \u0130ndirim' },
  { keys: ['deterjan temizlik', 'temizlik'], title: 'Temizlik \u00dcr\u00fcnlerinde \u0130ndirim' },
  { keys: ['et tavuk balik', 'et', 'tavuk', 'balik'], title: 'Et, Tavuk ve Bal\u0131kta \u0130ndirim' },
  { keys: ['icecek', 'su', 'meyve suyu'], title: '\u0130\u00e7eceklerde \u0130ndirim' },
  { keys: ['meyve sebze', 'meyve', 'sebze'], title: 'Meyve Sebzede \u0130ndirim' },
  { keys: ['kisisel bakim kozmetik saglik', 'kisisel bakim', 'kozmetik', 'saglik'], title: 'Ki\u015fisel Bak\u0131mda \u0130ndirim' },
  { keys: ['temel gida'], title: 'Temel G\u0131dada \u0130ndirim' },
  { keys: ['bebek'], title: 'Bebek \u00dcr\u00fcnlerinde \u0130ndirim' },
  { keys: ['elektronik'], title: 'Elektronikte \u0130ndirim' },
];

const campaignTitleMatchesRule = (titleKey, ruleKey) => {
  if (!titleKey || !ruleKey) return false;
  if (ruleKey.includes(' ')) return titleKey.includes(ruleKey);
  return new RegExp(`(^|[\\s,])${ruleKey}($|[\\s,])`, 'i').test(titleKey);
};

function resolveCustomerCampaignTitle(campaign = {}) {
  const explicit = [
    campaign.customerTitle,
    campaign.publicName,
    campaign.publicTitle,
    campaign.customerDisplayName,
    campaign.displayName,
  ].map((value) => String(value || '').trim()).find((value) => value && !isInternalCampaignTitle(value));
  if (explicit) return explicit;

  const rawName = String(campaign.name || campaign.internalName || '').trim();
  const key = normalizeCampaignTitleKey(rawName);
  if (!key) return 'Kampanya';
  if (/\b(dinamik talep|talep sinyali|sinyal)\b/.test(key)) return 'Haftanın İndirimli Ürünleri';
  const rule = CUSTOMER_CAMPAIGN_TITLE_RULES.find((item) => item.keys.some((candidate) => campaignTitleMatchesRule(key, candidate)));
  if (rule) return rule.title;
  if (isInternalCampaignTitle(rawName)) return resolveCustomerCampaignFallbackTitle(campaign);
  return rawName.replace(/\s+\d{1,3}$/, '').trim() || 'Kampanya';
}

function resolveCustomerPublicCampaignTitle(campaign = {}) {
  const explicit = [
    campaign.customerTitle,
    campaign.publicName,
    campaign.publicTitle,
    campaign.customerDisplayName,
    campaign.displayName,
  ].map((value) => repairCustomerVisibleText(String(value || '').trim())).find((value) => value && !isInternalCampaignTitle(value));
  if (explicit) return explicit;

  const rawName = repairCustomerVisibleText(String(campaign.name || campaign.internalName || '').trim());
  const key = normalizeCampaignTitleKey(rawName);
  if (!key) return resolveCustomerCampaignFallbackTitle(campaign);
  if (/\b(dinamik talep|talep sinyali|sinyal)\b/.test(key)) return 'Haftanın İndirimli Ürünleri';
  const rule = CUSTOMER_CAMPAIGN_TITLE_RULES.find((item) => item.keys.some((candidate) => campaignTitleMatchesRule(key, candidate)));
  if (rule) return rule.title;
  if (isInternalCampaignTitle(rawName)) return resolveCustomerCampaignFallbackTitle(campaign);
  return rawName.replace(/\s+\d{1,3}$/, '').trim() || resolveCustomerCampaignFallbackTitle(campaign);
}

function resolveCampaignRows(campaigns) {
  return (Array.isArray(campaigns) ? campaigns : [])
    .filter(isCampaignActive)
    .map((campaign, index) => {
      const customerTitle = resolveCustomerPublicCampaignTitle(campaign);
      const campaignType = normalizeCustomerCampaignType(campaign);
      return {
        id: String(campaign.id || `campaign-${index}`),
        name: customerTitle,
        internalName: campaign.internalName || campaign.name || '',
        publicName: customerTitle,
        customerTitle,
        type: campaignType,
        sourceModule: String(campaign.sourceModule || campaign.module || '').trim().toLocaleLowerCase('tr-TR'),
        discountRate: Number(campaign.discountRate || 0),
        startsAt: campaign.startsAt || campaign.startAt || campaign.startDate || null,
        endsAt: campaign.endsAt || campaign.endAt || campaign.endDate || null,
        productCount: Number(campaign.productCount || (Array.isArray(campaign.products) ? campaign.products.length : 0)),
        products: Array.isArray(campaign.products)
          ? campaign.products.map((product) => ({
            ...product,
            activeCampaign: product?.activeCampaign ? { ...product.activeCampaign, name: resolveCustomerPublicCampaignTitle(product.activeCampaign) } : { ...campaign, name: customerTitle, publicName: customerTitle },
            campaignName: customerTitle,
            campaignInfo: customerTitle,
          }))
          : [],
        productIds: Array.isArray(campaign.productIds) ? campaign.productIds : [],
        scope: campaign.scope || 'general',
        resolutionStrategy: campaign.resolutionStrategy || 'best_price',
      };
    });
}

function getCategoryVisual(categoryName = '') {
  const normalizedCategoryName = normalizeKey(repairCustomerVisibleText(categoryName));
  const categorySlug = routeSlugify(categoryName);
  return CATEGORY_VISUAL_CARDS.find((row) => {
    const candidates = [row.id, row.name, row.query]
      .map((value) => repairCustomerVisibleText(value))
      .flatMap((value) => [normalizeKey(value), routeSlugify(value)])
      .filter(Boolean);
    return candidates.includes(normalizedCategoryName) || candidates.includes(categorySlug);
  }) || null;
}

function resolveCustomerProductCategory(product = {}) {
  return String(
    product.categoryName
    || product.categoryLabelName
    || product.displayCategory
    || product.category
    || product.etiket
    || product.labelName
    || ''
  ).trim();
}

function CategoryVisualMedia({ categoryName = '', visual = null, alt = '', compact = false }) {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedVisual = visual || getCategoryVisual(categoryName);
  const resolvedName = repairCustomerVisibleText(categoryName || resolvedVisual?.name || 'Kategori');
  const candidateImageSrc = resolvedVisual?.image ? categoryAssetUrl(resolvedVisual.image) : '';
  const imageSrc = candidateImageSrc && !imageFailed ? candidateImageSrc : '';
  const containerStyle = compact
    ? { width: '24px', height: '24px', borderRadius: '8px' }
    : { width: '100%', aspectRatio: '1 / 1', borderRadius: '10px' };

  useEffect(() => {
    setImageFailed(false);
  }, [candidateImageSrc]);

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={alt}
        loading="lazy"
        onError={() => setImageFailed(true)}
        style={{ ...containerStyle, objectFit: 'cover' }}
      />
    );
  }

  return (
    <span
      aria-label={resolvedName}
      style={{
        ...containerStyle,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #eff6ff 0%, #e0f2fe 100%)',
        color: '#0f766e',
        border: '1px solid #bae6fd',
      }}
    >
      <PackageSearch size={compact ? 14 : 20} />
    </span>
  );
}

const routeSlugify = (value) => String(value || '')
  .replace(/[\u00e7\u00c7]/g, 'c')
  .replace(/[\u011f\u011e]/g, 'g')
  .replace(/[\u0131\u0130]/g, 'i')
  .replace(/[\u00f6\u00d6]/g, 'o')
  .replace(/[\u015f\u015e]/g, 's')
  .replace(/[\u00fc\u00dc]/g, 'u')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('tr-TR')
  .replace(/[^a-z0-9\s-]/gi, ' ')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '');

function getCategoryRouteKeys(category = {}) {
  const visual = getCategoryVisual(category?.name || '');
  return [
    category?.slug,
    category?.id,
    category?.code,
    category?.name,
    visual?.id,
    visual?.name,
    visual?.query,
  ].map(routeSlugify).filter(Boolean);
}

function resolveCategoryFromRouteSlug(rawSlug, primaryCategories = [], fallbackCategories = []) {
  const target = routeSlugify(decodeURIComponent(String(rawSlug || '')));
  if (!target) return null;
  const merged = [...primaryCategories, ...fallbackCategories];
  const seen = new Set();
  const candidates = merged.filter((category) => {
    const key = `${category?.id || ''}:${category?.name || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return candidates.find((category) => getCategoryRouteKeys(category).includes(target)) || null;
}

function resolveCustomerCampaignBadge(campaign = {}) {
  const discountRate = Math.max(0, Number(campaign.discountRate || 0));
  if (discountRate > 0) return `%${discountRate.toFixed(0)} \u0130ndirim`;
  return 'Kampanya';
}

function resolveCustomerCampaignDescription(campaign = {}) {
  const discountRate = Math.max(0, Number(campaign.discountRate || 0));
  const productCount = Number(campaign.productCount || campaign.products?.length || 0);
  if (productCount <= 1) {
    if (discountRate > 0) return `Se\u00e7ili \u00fcr\u00fcnde %${discountRate.toFixed(0)} indirim f\u0131rsat\u0131.`;
    return 'Se\u00e7ili \u00fcr\u00fcnde kampanya f\u0131rsat\u0131.';
  }
  if (discountRate > 0) {
    return `Se\u00e7ili \u00fcr\u00fcnlerde %${discountRate.toFixed(0)} indirim. Bu kampanyada ${productCount} \u00fcr\u00fcn yer al\u0131yor.`;
  }
  return `Bu kampanyada ${productCount} \u00fcr\u00fcn yer al\u0131yor.`;
}

function formatCampaignTypeLabel(value) {
  const key = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (key === 'category') return 'Kategori';
  if (key === 'product') return '\u00dcr\u00fcn';
  if (key === 'brand') return 'Marka';
  if (key === 'expiry') return 'SKT';
  if (key === 'sales') return 'Sat\u0131\u015f';
  if (key === 'dynamic') return 'Dinamik';
  return 'Genel';
}

function resolveCampaignStatusMeta(campaign = {}) {
  const now = Date.now();
  const startsAt = campaign.startsAt ? Date.parse(campaign.startsAt) : null;
  const endsAtDate = parseDate(campaign.endsAt);
  const endsAt = endsAtDate ? new Date(endsAtDate) : null;
  if (campaign.isActive === false) {
    return { label: 'Pasif', tone: 'danger' };
  }
  if (Number.isFinite(startsAt) && startsAt > now) {
    return { label: 'Planland\u0131', tone: 'warning' };
  }
  if (endsAt) {
    endsAt.setHours(23, 59, 59, 999);
  }
  if (endsAt && endsAt.getTime() < now) {
    return { label: 'S\u00fcresi Doldu', tone: 'danger' };
  }
  return { label: 'Aktif', tone: 'success' };
}

function resolveCampaignDescription(campaign = {}) {
  const discountRate = Math.max(0, Number(campaign.discountRate || 0));
  const productCount = Number(campaign.productCount || campaign.products?.length || 0);
  const typeLabel = formatCampaignTypeLabel(campaign.type);
  if (discountRate > 0) {
    return `%${discountRate.toFixed(0)} indirim ile ${productCount} \u00fcr\u00fcnde ${typeLabel.toLocaleLowerCase('tr-TR')} kampanya.`;
  }
  return `${productCount} \u00fcr\u00fcn i\u00e7in ${typeLabel.toLocaleLowerCase('tr-TR')} kampanya g\u00f6r\u00fcn\u00fcm\u00fc aktif.`;
}

function formatCampaignValidity(campaign) {
  const startsAt = campaign?.startsAt ? new Date(campaign.startsAt) : null;
  const endsAt = campaign?.endsAt ? new Date(campaign.endsAt) : null;
  const hasStart = startsAt && !Number.isNaN(startsAt.getTime());
  const hasEnd = endsAt && !Number.isNaN(endsAt.getTime());
  if (hasStart && hasEnd) {
    return `${startsAt.toLocaleDateString('tr-TR')} - ${endsAt.toLocaleDateString('tr-TR')}`;
  }
  if (hasEnd) return `${endsAt.toLocaleDateString('tr-TR')} tarihine kadar ge\u00e7erli`;
  if (hasStart) return `${startsAt.toLocaleDateString('tr-TR')} tarihinde ba\u015flad\u0131`;
  return 'Ge\u00e7erlilik bilgisi g\u00fcncelleniyor';
}

function resolveGiftCardExpiryDate(card = {}) {
  return parseDate(card.expiresAt || card.expiryDate || card.validUntil || card.validTo || card.endDate || card.endsAt);
}

function formatGiftCardExpiry(card = {}) {
  const date = resolveGiftCardExpiryDate(card);
  if (!date) return 'Son tarih belirtilmemiş';
  return `Son geçerlilik: ${date.toLocaleDateString('tr-TR')}`;
}

function resolvePositiveNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  }
  return 0;
}

function resolveShoppingListUnitPrice(row = {}, product = null) {
  const quantity = Math.max(1, Number(row?.quantity || 1));
  const directPrice = resolvePositiveNumber(
    row?.unitPrice,
    row?.currentPrice,
    row?.salePrice,
    row?.price,
    row?.campaignPrice,
    row?.discountedPrice,
    row?.product?.unitPrice,
    row?.product?.currentPrice,
    row?.product?.salePrice,
    row?.product?.price,
    row?.product?.campaignPrice,
    row?.product?.discountedPrice,
    product?.unitPrice,
    product?.currentPrice,
    product?.salePrice,
    product?.price,
    product?.campaignPrice,
    product?.discountedPrice
  );
  if (directPrice > 0) return directPrice;
  const lineTotal = resolvePositiveNumber(row?.lineTotal, row?.totalPrice, row?.totalAmount, row?.amount);
  return lineTotal > 0 ? lineTotal / quantity : 0;
}

function isGiftCardExpired(card = {}) {
  const date = resolveGiftCardExpiryDate(card);
  if (!date) return false;
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay.getTime() < Date.now();
}

const normalizeBackendFavoriteIds = (dashboard = {}) => {
  const directIds = Array.isArray(dashboard.favoriteIds) ? dashboard.favoriteIds : [];
  const favoriteRows = Array.isArray(dashboard.favorites) ? dashboard.favorites : [];
  return [...directIds, ...favoriteRows.map((item) => item?.productId || item?.id)]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
};

const normalizeBackendShoppingList = (dashboard = {}) => {
  const rows = Array.isArray(dashboard.shoppingList) ? dashboard.shoppingList : [];
  const lists = Array.isArray(dashboard.shoppingLists) ? dashboard.shoppingLists : [];
  const listRows = rows.length ? rows : lists
    .filter((list) => String(list?.status || 'active').toLowerCase() !== 'archived')
    .flatMap((list) => (Array.isArray(list?.items) ? list.items : []));

  const byProduct = new Map();
  listRows.forEach((item) => {
    const productId = String(item?.productId || item?.product?.id || item?.id || '').trim();
    if (!productId) return;
    const current = byProduct.get(productId);
    const quantity = Number(item?.quantity || 1);
    byProduct.set(productId, {
      id: productId,
      productId,
      productName: item?.productName || item?.product?.productName || item?.product?.name || item?.name || current?.productName || '',
      quantity: Number(current?.quantity || 0) + (Number.isFinite(quantity) && quantity > 0 ? quantity : 1),
      unit: item?.unit || item?.product?.unit || current?.unit || 'adet',
      unitPrice: resolveShoppingListUnitPrice(item) || Number(current?.unitPrice || 0),
      shelfCode: item?.shelfCode || item?.defaultShelfLocationCode || item?.product?.shelfCode || item?.product?.defaultShelfLocationCode || current?.shelfCode || '-',
      checked: item?.checked === true,
    });
  });
  return Array.from(byProduct.values());
};

const normalizeBackendOrders = (dashboard = {}) => {
  const rows = Array.isArray(dashboard.orderHistory)
    ? dashboard.orderHistory
    : (Array.isArray(dashboard.orders) ? dashboard.orders : []);
  return rows;
};

const normalizeBackendCart = (dashboard = {}) => {
  if (dashboard.cart && typeof dashboard.cart === 'object' && !Array.isArray(dashboard.cart)) {
    return Object.fromEntries(
      Object.entries(dashboard.cart)
        .map(([productId, quantity]) => [String(productId), Number(quantity || 0)])
        .filter(([productId, quantity]) => productId && quantity > 0)
    );
  }

  const rows = Array.isArray(dashboard.cartItems)
    ? dashboard.cartItems
    : (Array.isArray(dashboard.activeCart?.items) ? dashboard.activeCart.items : []);
  return rows.reduce((acc, item) => {
    const productId = String(item?.productId || item?.id || '').trim();
    const quantity = Number(item?.quantity || 0);
    if (productId && quantity > 0) acc[productId] = quantity;
    return acc;
  }, {});
};

const normalizeCartState = (value = {}) => Object.fromEntries(
  Object.entries(value && typeof value === 'object' ? value : {})
    .map(([productId, quantity]) => [String(productId || '').trim(), Math.max(0, Math.floor(Number(quantity || 0)))])
    .filter(([productId, quantity]) => productId && quantity > 0)
    .sort(([left], [right]) => left.localeCompare(right, 'tr'))
);

const serializeCartState = (value = {}) => JSON.stringify(normalizeCartState(value));

function resolveCampaignModeFromParams(search) {
  const params = new URLSearchParams(search);
  const turkishMode = String(params.get('gorunum') || '').trim().toLocaleLowerCase('tr-TR');
  if (turkishMode === 'populer') return 'popular';
  if (turkishMode === 'bugune-ozel') return 'today';
  if (turkishMode === 'kampanyali-urunler') return 'campaign-products';
  if (turkishMode === 'tumu') return 'all';
  const legacyMode = String(params.get('view') || '').trim().toLocaleLowerCase('tr-TR');
  if (legacyMode === 'popular') return 'popular';
  if (legacyMode === 'today') return 'today';
  if (legacyMode === 'campaign-products' || legacyMode === 'campaignproducts') return 'campaign-products';
  return 'all';
}

function buildCampaignSearch({ mode = 'all', campaignId = '' } = {}) {
  const params = new URLSearchParams();
  params.set('gorunum', CUSTOMER_CAMPAIGN_MODE_QUERY[mode] || CUSTOMER_CAMPAIGN_MODE_QUERY.all);
  if (campaignId) params.set('kampanya', campaignId);
  return params.toString();
}

function extractProductIdFromPath(pathname = '') {
  const marker = '/musteri/urun/';
  if (!String(pathname || '').includes(marker)) return '';
  return decodeURIComponent((String(pathname).split(marker)[1] || '').split('/')[0] || '').trim();
}

const formatCustomerOrderStatus = (value) => {
  const key = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (!key) return 'Durum belirtilmedi';
  if (key === 'tamamlandi' || key === 'completed') return 'Tamamlandı';
  if (key === 'hazirlaniyor' || key === 'preparing') return 'Hazırlanıyor';
  if (key === 'beklemede' || key === 'pending') return 'Beklemede';
  if (key === 'iptal' || key === 'cancelled' || key === 'canceled') return 'İptal';
  return String(value);
};

export default function CustomerPortal() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    document.title = 'Müşteri Mobil | Shelfio';
  }, [location.pathname]);
  const pathToView = useCallback((pathname) => {
    if (pathname.endsWith('/sepet')) return 'cart';
    if (pathname.endsWith('/ara')) return 'search';
    if (pathname.endsWith('/favorilerim')) return 'favorites';
    if (pathname.endsWith('/alisveris-listem')) return 'shopping-list';
    if (pathname.endsWith('/hediye-kartlari')) return 'gift-cards';
    if (pathname.endsWith('/gecmis-siparisler')) return 'order-history';
    if (pathname.endsWith('/hesabim')) return 'account';
    if (pathname.endsWith('/ayarlar') || pathname.endsWith('/bildirim-tercihleri')) return 'settings';
    if (pathname.endsWith('/yardim')) return 'help';
    if (pathname.endsWith('/kampanyalar')) return 'campaigns';
    if (pathname.endsWith('/magaza-calisma-saatleri')) return 'store-hours';
    if (pathname.includes('/musteri/kategori/')) return 'category';
    if (pathname.includes('/musteri/urun/')) return 'detail';
    if (pathname.endsWith('/populer-urunler')) return 'popular';
    return 'home';
  }, []);
  const customerUser = customerPortalAuthService.getStoredUser();
  const customerId = customerUser?.id || '';
  const initialView = pathToView(location.pathname);
  const [view, setView] = useState(initialView);
  const [activeBottomTab, setActiveBottomTab] = useState(initialView === 'cart' ? 'cart' : 'home');
  const [isLoading, setIsLoading] = useState(true);

  const [products, setProducts] = useState([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [clearNotificationsConfirmOpen, setClearNotificationsConfirmOpen] = useState(false);
  const [campaignDefinitions, setCampaignDefinitions] = useState([]);
  const [settingsData, setSettingsData] = useState(null);
  const [storefrontResolved, setStorefrontResolved] = useState(false);
  const {
    categories,
    setCategories,
    ensureCategories,
    isLoading: categoriesLoading,
    error: categoriesError,
  } = useCustomerCatalogCategories();
  const [customerProfile, setCustomerProfile] = useState(null);

  const [cart, setCart] = useState({});
  const [recentProductIds, setRecentProductIds] = useState(() => readStoredArray(RECENT_STORAGE_KEY));
  const [detailProductId, setDetailProductId] = useState('');
  const [detailCache, setDetailCache] = useState({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailForecastCache, setDetailForecastCache] = useState({});
  const [detailForecastLoading, setDetailForecastLoading] = useState({});
  const [detailForecastError, setDetailForecastError] = useState({});

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [scanError, setScanError] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [accountPanel, setAccountPanel] = useState('');
  const customerPrefsStorageKey = scopedKey(CUSTOMER_PREFS_KEY, customerId);
  const [notificationPrefs, setNotificationPrefs] = useState(() => readCustomerPrefs(customerPrefsStorageKey));
  const [salesRows, setSalesRows] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState(() => readStoredArray(scopedKey(FAVORITES_STORAGE_KEY, customerId)).map(String));
  const [campaignViewMode, setCampaignViewMode] = useState('all');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [campaignDetailId, setCampaignDetailId] = useState('');
  const [campaignProductSearch, setCampaignProductSearch] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [shoppingList, setShoppingList] = useState(() => readStoredArray(scopedKey(SHOPPING_LIST_STORAGE_KEY, customerId)));
  const [orderHistory, setOrderHistory] = useState(() => readStoredArray(scopedKey(ORDER_HISTORY_STORAGE_KEY, customerId)));
  const [detailReturnState, setDetailReturnState] = useState({ view: initialView, tab: activeBottomTab });
  const [quickToast, setQuickToast] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState({ name: '', email: '', phone: '', password: '' });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [orderDetail, setOrderDetail] = useState(null);
  const [authPrompt, setAuthPrompt] = useState(null);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const isCustomerLoggedIn = customerPortalAuthService.isLoggedIn();

  const searchInputRef = useRef(null);
  const scannerRef = useRef(null);
  const cartHydratedRef = useRef(false);
  const cartSyncSnapshotRef = useRef(serializeCartState({}));
  const catalogRequestKeysRef = useRef(new Set());

  const ensureProductsLoaded = useCallback(async (params = {}) => {
    const requestParams = {
      mode: 'products',
      page: 1,
      limit: params.limit || CUSTOMER_LAZY_PRODUCT_LIMIT,
      ...(params.search ? { search: params.search } : {}),
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
    };
    const requestKey = JSON.stringify(requestParams);
    if (catalogRequestKeysRef.current.has(requestKey)) return;
    catalogRequestKeysRef.current.add(requestKey);
    setProductsLoading(true);
    try {
      const catalog = await customerCatalogService.getCatalog(requestParams);
      const incomingProducts = Array.isArray(catalog?.products) ? catalog.products : [];
      setProducts((current) => mergeProductRows(current, incomingProducts));
      if (Array.isArray(catalog?.categories) && catalog.categories.length > 0) {
        setCategories(catalog.categories);
      }
      setCampaignDefinitions(Array.isArray(catalog?.campaigns) ? catalog.campaigns : []);
      setSettingsData(catalog?.storefront || null);
      setProductsLoaded(true);
      setStorefrontResolved(true);
    } catch {
      catalogRequestKeysRef.current.delete(requestKey);
      setStorefrontResolved(true);
    } finally {
      setProductsLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadData = async () => {
      const favKey = scopedKey(FAVORITES_STORAGE_KEY, customerId);
      const listKey = scopedKey(SHOPPING_LIST_STORAGE_KEY, customerId);
      const ordersKey = scopedKey(ORDER_HISTORY_STORAGE_KEY, customerId);
      const cartKey = scopedKey(CART_STORAGE_KEY, customerId);
      try {
        const [catalogResult, salesResult, customerDashboard, customerOrders, customerCart] = await Promise.allSettled([
          customerCatalogService.getCatalog({
            mode: 'home',
            page: 1,
            limit: initialView === 'home' ? CUSTOMER_HOME_PRODUCT_LIMIT : CUSTOMER_SECONDARY_PRODUCT_LIMIT,
          }),
          Promise.resolve([]),
          isCustomerLoggedIn ? customerPortalAuthService.dashboard() : Promise.resolve(null),
          isCustomerLoggedIn ? customerPortalAuthService.orders() : Promise.resolve(null),
          isCustomerLoggedIn ? customerPortalAuthService.getCart() : Promise.resolve(null),
        ]);

        if (!mounted) return;
        const catalogData = catalogResult.status === 'fulfilled' ? catalogResult.value || null : null;
        if (catalogData) {
          setProducts(Array.isArray(catalogData.products) ? catalogData.products : []);
          setProductsLoaded(Array.isArray(catalogData.products) && catalogData.products.length > 0);
          setCampaignDefinitions(Array.isArray(catalogData.campaigns) ? catalogData.campaigns : []);
          setSettingsData(catalogData.storefront || null);
          setStorefrontResolved(true);
          if (Array.isArray(catalogData.categories) && catalogData.categories.length > 0) {
            setCategories(catalogData.categories);
          }
        } else {
          setProducts([]);
          setCampaignDefinitions([]);
          setSettingsData(null);
          setStorefrontResolved(true);
        }
        setSalesRows(salesResult.status === 'fulfilled' && Array.isArray(salesResult.value) ? salesResult.value : []);
        const dashboard = customerDashboard.status === 'fulfilled' ? customerDashboard.value || null : null;
        const backendOrders = customerOrders.status === 'fulfilled' && Array.isArray(customerOrders.value) ? customerOrders.value : null;
        const backendCartPayload = customerCart.status === 'fulfilled' && customerCart.value ? customerCart.value : null;

        if (dashboard) {
          const backendFavoriteIds = normalizeBackendFavoriteIds(dashboard);
          const backendShoppingList = normalizeBackendShoppingList(dashboard);
          setCustomerProfile(dashboard.customer || null);
          setFavoriteIds(backendFavoriteIds);
          setShoppingList(backendShoppingList);
          writeStoredArray(favKey, backendFavoriteIds);
          writeStoredArray(listKey, backendShoppingList);
        } else {
          setCustomerProfile(null);
          if (!isCustomerLoggedIn) {
            setFavoriteIds(readStoredArray(favKey).map(String));
            setShoppingList(readStoredArray(listKey));
          }
        }

        if (backendOrders) {
          setOrderHistory(backendOrders);
          writeStoredArray(ordersKey, backendOrders);
        } else if (!isCustomerLoggedIn || customerOrders.status !== 'fulfilled') {
          setOrderHistory(readStoredArray(ordersKey));
        }

        if (backendCartPayload) {
          const nextCart = normalizeCartState(normalizeBackendCart(backendCartPayload));
          setCart(nextCart);
          writeStoredObject(cartKey, nextCart);
          cartSyncSnapshotRef.current = serializeCartState(nextCart);
        } else if (!isCustomerLoggedIn || customerCart.status !== 'fulfilled') {
          const cachedCart = normalizeCartState(readStoredObject(cartKey));
          setCart(cachedCart);
          cartSyncSnapshotRef.current = serializeCartState(cachedCart);
        }
        cartHydratedRef.current = true;
      } finally {
        if (mounted) setIsLoading(false);
      }
      if (mounted && isCustomerLoggedIn) {
        customerPortalAuthService.notifications(40).then((res) => {
          if (mounted && Array.isArray(res)) setNotifications(res.map((item) => normalizeNotification(item)));
        }).catch(() => {});
      }
    };
    void loadData();
    return () => {
      mounted = false;
      cartHydratedRef.current = false;
    };
  }, [customerId, initialView, isCustomerLoggedIn, setCategories]);

  useEffect(() => {
    const refreshStorefront = async () => {
      try {
        const catalog = await customerCatalogService.getCatalog({ mode: 'home', page: 1, limit: 1 });
        if (catalog?.storefront) {
          setSettingsData(catalog.storefront);
          setStorefrontResolved(true);
        }
      } catch {
        // keep the last known storefront state
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshStorefront();
    };
    window.addEventListener('focus', refreshStorefront);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshStorefront);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (view !== 'search') return;
    if (categories.length > 0) return;
    void ensureCategories();
  }, [categories.length, ensureCategories, view]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const frame = window.requestAnimationFrame(() => {
      const root = document.querySelector('.customer-unified-page');
      if (!root) return;

      const attributesToRepair = ['placeholder', 'title', 'aria-label'];
      root.querySelectorAll('*').forEach((element) => {
        attributesToRepair.forEach((attribute) => {
          if (!element.hasAttribute(attribute)) return;
          const current = element.getAttribute(attribute) || '';
          const repaired = repairCustomerVisibleText(current);
          if (repaired !== current) element.setAttribute(attribute, repaired);
        });
      });

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      textNodes.forEach((node) => {
        const current = node.nodeValue || '';
        if (!current.trim()) return;
        const repaired = repairCustomerVisibleText(current);
        if (repaired !== current) node.nodeValue = repaired;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    view,
    products.length,
    categories.length,
    campaignDefinitions.length,
    notifications.length,
    favoriteIds.length,
    shoppingList.length,
    orderHistory.length,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (view !== 'search' && view !== 'home') return;
    if (debouncedSearchQuery.length < 2 && !selectedCategoryId) return;
    void ensureProductsLoaded({
      search: debouncedSearchQuery.length >= 2 ? debouncedSearchQuery : '',
      categoryId: selectedCategoryId || '',
    });
  }, [debouncedSearchQuery, ensureProductsLoaded, selectedCategoryId, view]);

  useEffect(() => {
    if (view !== 'category') return;
    void ensureProductsLoaded();
  }, [ensureProductsLoaded, view]);

  useEffect(() => {
    if (!quickToast) return;
    const leavingTimer = window.setTimeout(() => {
      setQuickToast((current) => (current ? { ...current, leaving: true } : null));
    }, 1500);
    const clearTimer = window.setTimeout(() => setQuickToast(null), 1820);
    return () => {
      window.clearTimeout(leavingTimer);
      window.clearTimeout(clearTimer);
    };
  }, [quickToast]);

  useEffect(() => {
    const favKey = scopedKey(FAVORITES_STORAGE_KEY, customerId);
    const listKey = scopedKey(SHOPPING_LIST_STORAGE_KEY, customerId);
    const ordersKey = scopedKey(ORDER_HISTORY_STORAGE_KEY, customerId);
    const cartKey = scopedKey(CART_STORAGE_KEY, customerId);
    setFavoriteIds(readStoredArray(favKey).map(String));
    setShoppingList(readStoredArray(listKey));
    setOrderHistory(readStoredArray(ordersKey));
    setCart(normalizeCartState(readStoredObject(cartKey)));
    setNotificationPrefs(readCustomerPrefs(scopedKey(CUSTOMER_PREFS_KEY, customerId)));
    setStorefrontResolved(false);
    setSelectedTag('');
    cartHydratedRef.current = false;
    cartSyncSnapshotRef.current = serializeCartState(readStoredObject(cartKey));
  }, [customerId]);

  useEffect(() => {
    if (selectedCategoryId) {
      setSelectedTag(ALL_CATEGORY_TAG_KEY);
      return;
    }
    setSelectedTag('');
  }, [selectedCategoryId]);

  useEffect(() => {
    setSettingsDraft({
      name: normalizeCustomerName(customerProfile?.name || customerUser?.name || ''),
      email: customerProfile?.email || customerUser?.email || '',
      phone: customerProfile?.phone || customerUser?.phone || '',
      password: '',
    });
  }, [customerProfile, customerUser?.email, customerUser?.name, customerUser?.phone]);

  useEffect(() => {
    const nextView = pathToView(location.pathname);
    setView(nextView);
    if (nextView === 'favorites' || nextView === 'shopping-list' || nextView === 'gift-cards' || nextView === 'order-history' || nextView === 'account' || nextView === 'store-hours' || nextView === 'notification-preferences') setActiveBottomTab('account');
    else if (nextView === 'popular') setActiveBottomTab('campaigns');
    else setActiveBottomTab(nextView);
    if (nextView === 'campaigns') {
      const params = new URLSearchParams(location.search);
      setCampaignViewMode(resolveCampaignModeFromParams(location.search));
      setSelectedCampaignId(params.get('kampanya') || params.get('campaign') || '');
    } else {
      setSelectedCampaignId('');
      setCampaignDetailId('');
      setCampaignProductSearch('');
    }
    if (nextView === 'search') {
      const params = new URLSearchParams(location.search);
      const queryFromRoute = params.get('q') || params.get('search') || '';
      if (queryFromRoute !== searchQuery) {
        setSearchQuery(queryFromRoute);
        setDebouncedSearchQuery(queryFromRoute.trim());
      }
    }
    if (nextView === 'detail') {
      const routeProductId = extractProductIdFromPath(location.pathname);
      if (routeProductId && routeProductId !== detailProductId) {
        setDetailProductId(routeProductId);
      }
    }
  }, [detailProductId, location.pathname, location.search, pathToView, searchQuery]);

  const openAuthPrompt = useCallback((message, fromPath = '/musteri/hesabim', fromSearch = '') => {
    setAuthPrompt({
      message: message || 'Bu işlem için giriş yapmanız gerekiyor.',
      from: { pathname: fromPath, search: fromSearch },
    });
  }, []);

  const requireAuthAction = useCallback((message, action) => {
    if (isCustomerLoggedIn) {
      action?.();
      return true;
    }
    openAuthPrompt(message);
    return false;
  }, [isCustomerLoggedIn, openAuthPrompt]);

  const saveCustomerSettings = useCallback(async () => {
    if (!isCustomerLoggedIn) {
      openAuthPrompt('Hesap bilgilerinizi güncellemek için giriş yapın.', '/musteri/ayarlar');
      return;
    }
    setIsSavingSettings(true);
    try {
      const payload = {
        name: String(settingsDraft.name || '').trim(),
        email: String(settingsDraft.email || '').trim(),
        phone: String(settingsDraft.phone || '').trim(),
      };
      if (String(settingsDraft.password || '').trim()) {
        payload.password = String(settingsDraft.password).trim();
      }
      const updatedCustomer = await customerPortalAuthService.updateProfile(payload);
      setCustomerProfile(updatedCustomer || null);
      setSettingsDraft((current) => ({ ...current, password: '' }));
      pushQuickToast('Hesap bilgileri güncellendi');
    } catch (error) {
      pushQuickToast(error?.message || 'Hesap bilgileri güncellenemedi', 'error');
    } finally {
      setIsSavingSettings(false);
    }
  }, [isCustomerLoggedIn, openAuthPrompt, settingsDraft]);

  const updateNotificationPreference = useCallback((key, value) => {
    setNotificationPrefs((current) => {
      const next = {
        inAppNotifications: current.inAppNotifications !== false,
        phoneNotifications: current.phoneNotifications !== false,
        [key]: Boolean(value),
      };
      writeCustomerPrefs(next, customerPrefsStorageKey);
      return next;
    });
  }, [customerPrefsStorageKey]);

  const navigateTo = useCallback((nextView, nextTab = 'home', options = {}) => {
    const routeByView = {
      home: '/musteri',
      cart: '/musteri/sepet',
      search: '/musteri/ara',
      favorites: '/musteri/favorilerim',
      'shopping-list': '/musteri/alisveris-listem',
      campaigns: '/musteri/kampanyalar',
      account: '/musteri/hesabim',
      'gift-cards': '/musteri/hediye-kartlari',
      'order-history': '/musteri/gecmis-siparisler',
      settings: '/musteri/ayarlar',
      help: '/musteri/yardim',
      'store-hours': '/musteri/magaza-calisma-saatleri',
      popular: '/musteri/populer-urunler',
    };

    if (nextView === 'notifications') {
      setView('notifications');
      setActiveBottomTab(nextTab);
      return;
    }

    if (!options.preserveSearch && nextView !== 'search') {
      setIsSearchFocused(false);
    }

    const pathname = routeByView[nextView] || '/musteri';
    const search = nextView === 'campaigns'
      ? buildCampaignSearch({ mode: options.mode || 'all', campaignId: options.campaignId || '' })
      : nextView === 'search' && (options.query || (options.preserveSearch && searchQuery.trim()))
        ? new URLSearchParams({ q: String(options.query || searchQuery).trim() }).toString()
        : '';

    setView(nextView);
    setActiveBottomTab(nextTab);
    navigate({ pathname, search: search ? `?${search}` : '' });

    if (options.preserveSearchFocus) {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [navigate, searchQuery]);

  const clearSelectedSearchCategory = useCallback(() => {
    setSelectedCategoryId('');
    setSelectedTag('');
    navigateTo('search', 'search', {
      preserveSearch: Boolean(searchQuery.trim()),
      preserveSearchFocus: true,
    });
  }, [navigateTo, searchQuery]);

  const onBottomNavChange = useCallback((tabKey) => {
    const key = String(tabKey || 'home');
    if (key === 'cart') {
      navigateTo('cart', 'cart');
      return;
    }
    if (key === 'search') {
      navigateTo('search', 'search', { preserveSearch: true, preserveSearchFocus: true });
      return;
    }
    if (key === 'campaigns') {
      navigateTo('campaigns', 'campaigns');
      return;
    }
    if (key === 'account') {
      navigateTo('account', 'account');
      return;
    }
    navigateTo('home', 'home');
  }, [navigateTo]);

  const handleCustomerLogout = useCallback(() => {
    customerPortalAuthService.logout();
    setCustomerProfile(null);
    setFavoriteIds([]);
    setShoppingList([]);
    setOrderHistory([]);
    setNotifications([]);
    setCart({});
    cartHydratedRef.current = false;
    cartSyncSnapshotRef.current = serializeCartState({});
    pushQuickToast('Çıkış yapıldı');
    navigateTo('home', 'home');
  }, [navigateTo]);

  const openAccountPanel = useCallback((panelKey) => {
    const key = String(panelKey || 'account');
    setAccountPanel('');
    if (key === 'favorites') {
      navigateTo('favorites', 'account');
      return;
    }
    if (key === 'shopping-list') {
      navigateTo('shopping-list', 'account');
      return;
    }
    if (key === 'gift-cards') {
      navigateTo('gift-cards', 'account');
      return;
    }
    if (key === 'order-history') {
      navigateTo('order-history', 'account');
      return;
    }
    if (key === 'settings') {
      navigateTo('settings', 'account');
      return;
    }
    if (key === 'help') {
      setHelpModalOpen(true);
      return;
    }
    navigateTo('account', 'account');
  }, [navigateTo]);

  useEffect(() => {
    let cancelled = false;
    const loadDetail = async () => {
      if (!detailProductId) return;
      if (detailCache[detailProductId]) return;
      setDetailLoading(true);
      try {
        const row = await customerCatalogService.getProductById(detailProductId);
        if (cancelled) return;
        setDetailCache((current) => ({ ...current, [detailProductId]: row }));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    void loadDetail();
    return () => { cancelled = true; };
  }, [detailCache, detailProductId]);

  useEffect(() => {
    let cancelled = false;
    const loadForecast = async () => {
      if (!detailProductId) return;
      if (detailForecastCache[detailProductId]) return;
      setDetailForecastLoading((current) => ({ ...current, [detailProductId]: true }));
      setDetailForecastError((current) => ({ ...current, [detailProductId]: false }));
      try {
        const row = await customerCatalogService.getProductStockForecast(detailProductId);
        if (cancelled) return;
        setDetailForecastCache((current) => ({ ...current, [detailProductId]: row || null }));
      } catch {
        if (cancelled) return;
        setDetailForecastError((current) => ({ ...current, [detailProductId]: true }));
      } finally {
        if (!cancelled) {
          setDetailForecastLoading((current) => ({ ...current, [detailProductId]: false }));
        }
      }
    };
    void loadForecast();
    return () => { cancelled = true; };
  }, [detailForecastCache, detailProductId]);

  const popularProducts = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    const scoreByProductId = new Map();
    for (const row of Array.isArray(salesRows) ? salesRows : []) {
      const createdAt = new Date(row?.createdAt || row?.date || row?.updatedAt || '');
      if (Number.isNaN(createdAt.getTime()) || createdAt.getTime() < sevenDaysAgo) continue;
      const lines = Array.isArray(row?.items) ? row.items : [];
      for (const line of lines) {
        const pid = String(line?.productId || line?.id || '');
        if (!pid) continue;
        const qty = Number(line?.quantity || line?.qty || 0) || 0;
        const amount = Number(line?.totalAmount || line?.lineTotal || line?.subtotal || 0) || 0;
        const current = scoreByProductId.get(pid) || { qty: 0, amount: 0 };
        current.qty += qty;
        current.amount += amount;
        scoreByProductId.set(pid, current);
      }
    }

    const byId = new Map(products.map((item) => [String(item.id), item]));
    const ranked = Array.from(scoreByProductId.entries())
      .map(([pid, score]) => ({
        product: byId.get(pid),
        qty: score.qty,
        amount: score.amount,
      }))
      .filter((item) => item.product)
      .sort((a, b) => {
        if (b.qty !== a.qty) return b.qty - a.qty;
        return b.amount - a.amount;
      })
      .map((item) => item.product);

    if (ranked.length >= 8) return ranked.slice(0, 12);
    const fallback = [...products]
      .sort((a, b) => Number(b.salesCount || b.totalSold || b.orderCount || 0) - Number(a.salesCount || a.totalSold || a.orderCount || 0));
    const merged = [...ranked, ...fallback.filter((p) => !ranked.find((r) => String(r.id) === String(p.id)))];
    return merged.slice(0, 12);
  }, [products, salesRows]);
  const topSellerProducts = useMemo(() => popularProducts.slice(0, 4), [popularProducts]);
  const recentViewedProducts = useMemo(() => {
    const byId = new Map(products.map((item) => [String(item.id), item]));
    return recentProductIds.map((id) => byId.get(String(id))).filter(Boolean).slice(0, 4);
  }, [products, recentProductIds]);

  const favoriteProducts = useMemo(() => {
    const idSet = new Set(favoriteIds.map((id) => String(id)));
    return products.filter((item) => idSet.has(String(item.id)) || item.isFavorite === true);
  }, [favoriteIds, products]);

  const activeCampaigns = useMemo(() => resolveCampaignRows(campaignDefinitions), [campaignDefinitions]);
  const listedCampaigns = useMemo(
    () => activeCampaigns.filter((item) => resolveCampaignStatusMeta(item).label !== 'Süresi Doldu'),
    [activeCampaigns]
  );
  const selectedCampaign = useMemo(
    () => activeCampaigns.find((item) => isCustomerCampaignFilterable(item) && String(item.id) === String(selectedCampaignId)) || null,
    [activeCampaigns, selectedCampaignId]
  );
  const customerCampaignFilterOptions = useMemo(
    () => activeCampaigns.filter(isCustomerCampaignFilterable),
    [activeCampaigns]
  );
  const campaignDetail = useMemo(
    () => activeCampaigns.find((item) => String(item.id) === String(campaignDetailId)) || null,
    [activeCampaigns, campaignDetailId]
  );
  const todaysCampaigns = useMemo(
    () => activeCampaigns.filter((item) => isCampaignActiveOnLocalDate(item)),
    [activeCampaigns]
  );
  const campaignProducts = useMemo(() => {
    const sourceCampaigns = selectedCampaign
      ? activeCampaigns.filter((item) => String(item.id) === String(selectedCampaign.id))
      : activeCampaigns;
    const rows = sourceCampaigns.flatMap((item) => (Array.isArray(item.products) ? item.products : []));
    const seen = new Set();
    return rows.filter((item) => {
      const key = String(item.id || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [activeCampaigns, selectedCampaign]);
  const filteredCampaignProducts = useMemo(() => {
    const needle = normalizeKey(campaignProductSearch);
    if (needle.length < 2) return campaignProducts;
    return campaignProducts.filter((item) => (
      normalizeKey(item.productName || item.name).includes(needle)
      || normalizeKey(resolveCustomerProductCategory(item)).includes(needle)
      || normalizeKey(item.brand || item.brandName).includes(needle)
      || normalizeKey(item.supplierName || item.supplierProductName).includes(needle)
      || normalizeKey(item.activeCampaign?.name || item.campaignInfo || item.campaignBadge).includes(needle)
      || String(item.barcode || '').includes(campaignProductSearch.trim())
      || normalizeKey(item.sku).includes(needle)
    ));
  }, [campaignProductSearch, campaignProducts]);

  const categoriesByDemand = useMemo(() => {
    const countByCategoryId = new Map();
    const countByCategoryName = new Map();
    for (const product of products) {
      const categoryId = String(product?.categoryId || '');
      const categoryName = normalizeKey(resolveCustomerProductCategory(product));
      if (categoryId) countByCategoryId.set(categoryId, (countByCategoryId.get(categoryId) || 0) + 1);
      if (categoryName) countByCategoryName.set(categoryName, (countByCategoryName.get(categoryName) || 0) + 1);
    }
    const baseCategories = categories.length ? categories : CATEGORY_VISUAL_CARDS.map((row) => ({ id: row.id, name: row.name }));
    return [...baseCategories].sort((a, b) => {
      const aId = String(a?.id || '');
      const bId = String(b?.id || '');
      const aName = normalizeKey(a?.name || '');
      const bName = normalizeKey(b?.name || '');
      const aCount = Number(countByCategoryId.get(aId) || countByCategoryName.get(aName) || a?.productCount || a?.count || 0);
      const bCount = Number(countByCategoryId.get(bId) || countByCategoryName.get(bName) || b?.productCount || b?.count || 0);
      if (bCount !== aCount) return bCount - aCount;
      return String(a?.name || '').localeCompare(String(b?.name || ''), 'tr');
    });
  }, [categories, products]);

  const selectedCategoryName = useMemo(() => {
    const found = categoriesByDemand.find((item) => String(item?.id || '') === String(selectedCategoryId));
    return found?.name || '';
  }, [categoriesByDemand, selectedCategoryId]);
  const selectedCategoryVisual = useMemo(() => getCategoryVisual(selectedCategoryName), [selectedCategoryName]);
  const isCategoryBrowseMode = view === 'search' && Boolean(selectedCategoryId) && debouncedSearchQuery.length < 2;

  const searchResults = useMemo(() => {
    const query = debouncedSearchQuery;
    const needle = normalizeKey(query);
    const barcodeNeedle = normalizeBarcodeSearch(query);
    const hasQuery = needle.length >= 2;
    const hasCategory = Boolean(selectedCategoryId);
    if (view === 'search' && !hasQuery && !hasCategory) return [];
    return products.filter((item) => {
      const productCategoryId = String(item.categoryId || '');
      const productCategoryName = normalizeKey(resolveCustomerProductCategory(item));
      const categoryMatch = !hasCategory
        || productCategoryId === String(selectedCategoryId)
        || (selectedCategoryName && productCategoryName === normalizeKey(selectedCategoryName));
      if (!categoryMatch) return false;
      if (!hasQuery) return true;
      return normalizeKey(item.productName || item.name).includes(needle)
        || normalizeKey(item.sku).includes(needle)
        || normalizeBarcodeSearch(item.barcode || item.sku).includes(barcodeNeedle)
        || normalizeKey(resolveCustomerProductCategory(item)).includes(needle)
        || normalizeKey(item.brandName || item.brand).includes(needle)
        || normalizeKey(item.supplierName || item.supplierProductName).includes(needle)
        || getProductTagList(item).some((tag) => normalizeKey(tag).includes(needle));
    });
  }, [products, debouncedSearchQuery, selectedCategoryId, selectedCategoryName, view]);

  const categoryTags = useMemo(() => {
    if (!selectedCategoryId) return [];
    const tags = [];
    const selectedCategory = categoriesByDemand.find((item) => String(item?.id || '') === String(selectedCategoryId))
      || categories.find((item) => String(item?.id || '') === String(selectedCategoryId))
      || null;
    if (selectedCategory) {
      tags.push(
        ...toTagList(selectedCategory?.etiketler),
        ...toTagList(selectedCategory?.tags),
        ...toTagList(selectedCategory?.labels),
        ...toTagList(selectedCategory?.subCategories)
      );
    }
    for (const item of products) {
      const categoryIdMatch = String(item?.categoryId || '') === String(selectedCategoryId);
      const categoryNameMatch = selectedCategoryName && normalizeKey(resolveCustomerProductCategory(item)) === normalizeKey(selectedCategoryName);
      if (!categoryIdMatch && !categoryNameMatch) continue;
      tags.push(...getProductTagList(item));
    }
    return dedupeTags(tags).sort((a, b) => a.localeCompare(b, 'tr'));
  }, [categories, categoriesByDemand, products, selectedCategoryId, selectedCategoryName]);

  const filteredSearchResults = useMemo(() => {
    if (!selectedTag || selectedTag === ALL_CATEGORY_TAG_KEY) return searchResults;
    const needle = normalizeKey(selectedTag);
    return searchResults.filter((item) => {
      const list = getProductTagList(item);
      return list.some((tag) => normalizeKey(tag) === needle);
    });
  }, [searchResults, selectedTag]);

  const inlineHomeSearchResults = useMemo(() => {
    const query = debouncedSearchQuery;
    const needle = normalizeKey(query);
    const barcodeNeedle = normalizeBarcodeSearch(query);
    if (needle.length < 2) return [];
    return products
      .filter((item) => normalizeKey(item.productName || item.name).includes(needle)
        || normalizeKey(item.sku).includes(needle)
        || normalizeBarcodeSearch(item.barcode || item.sku).includes(barcodeNeedle)
        || normalizeKey(resolveCustomerProductCategory(item)).includes(needle)
        || normalizeKey(item.brandName || item.brand).includes(needle)
        || normalizeKey(item.supplierName || item.supplierProductName).includes(needle))
      .slice(0, 8);
  }, [debouncedSearchQuery, products]);

  const refreshCustomerNotifications = useCallback(async () => {
    if (!isCustomerLoggedIn) return;
    const res = await customerPortalAuthService.notifications(40);
    if (Array.isArray(res)) {
      setNotifications(res.map((item) => normalizeNotification(item)));
    }
  }, [isCustomerLoggedIn]);

  useEffect(() => {
    const handleRefresh = (event) => {
      const incoming = event?.detail?.notification ? normalizeNotification(event.detail.notification) : null;
      if (incoming?.id) {
        setNotifications((current) => {
          if (current.some((item) => String(item.id) === String(incoming.id))) return current;
          return [incoming, ...current].slice(0, 40);
        });
      }
      void refreshCustomerNotifications();
    };
    window.addEventListener(CUSTOMER_NOTIFICATIONS_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(CUSTOMER_NOTIFICATIONS_REFRESH_EVENT, handleRefresh);
    };
  }, [refreshCustomerNotifications]);

  const customerNotifications = useMemo(() => notifications.filter(isCustomerFacingNotification), [notifications]);
  const unreadCustomerNotificationCount = useMemo(
    () => customerNotifications.filter((item) => !item?.isRead).length,
    [customerNotifications]
  );
  const openNotifications = useCallback(async () => {
    setView('notifications');
    if (!isCustomerLoggedIn || unreadCustomerNotificationCount <= 0) return;

    setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
    try {
      await customerPortalAuthService.markNotificationsAsRead();
    } catch {
      // Keep the screen usable; the next fetch will reconcile the unread state if needed.
    }
  }, [isCustomerLoggedIn, unreadCustomerNotificationCount]);

  const handleNotificationAction = useCallback((item) => {
    const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
    const actionUrl = String(item?.actionUrl || payload.actionUrl || '').trim();
    if (!actionUrl || !actionUrl.startsWith('/musteri')) return;

    if (actionUrl.includes('/musteri/urun/')) {
      const productId = extractProductIdFromPath(actionUrl);
      if (productId) {
        setDetailReturnState({ view: 'notifications', tab: activeBottomTab });
        setDetailProductId(productId);
        setView('detail');
      }
    } else {
      setView(pathToView(actionUrl));
    }
    navigate(actionUrl);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeBottomTab, navigate, pathToView]);

  const handleClearNotifications = useCallback(async () => {
    if (!isCustomerLoggedIn) return;
    await customerPortalAuthService.clearNotifications();
    setNotifications((current) => current.filter((item) => !isCustomerFacingNotification(item)));
    setClearNotificationsConfirmOpen(false);
  }, [isCustomerLoggedIn]);
  const productsById = useMemo(() => new Map(products.map((item) => [String(item.id), item])), [products]);

  useEffect(() => {
    const cartKey = scopedKey(CART_STORAGE_KEY, customerId);
    const normalizedCart = normalizeCartState(cart);
    writeStoredObject(cartKey, normalizedCart);

    if (!cartHydratedRef.current) return;
    if (!isCustomerLoggedIn) {
      cartSyncSnapshotRef.current = serializeCartState(normalizedCart);
      return;
    }

    const snapshot = serializeCartState(normalizedCart);
    if (snapshot === cartSyncSnapshotRef.current) return;
    cartSyncSnapshotRef.current = snapshot;

    const items = Object.entries(normalizedCart).map(([productId, quantity]) => {
      const product = productsById.get(String(productId)) || detailCache[String(productId)] || null;
      return {
        productId,
        quantity,
        productName: product?.productName || product?.name || productId,
        unit: product?.unit || product?.orderUnit || 'adet',
        unitPrice: Number(product?.currentPrice ?? product?.salePrice ?? product?.price ?? 0) || 0,
      };
    });

    customerPortalAuthService.updateCart({ items }).catch(() => {});
  }, [cart, customerId, detailCache, isCustomerLoggedIn, productsById]);

  const cartEntries = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => {
          const product = productsById.get(String(id)) || detailCache[String(id)] || null;
          if (!product) return null;
          return { product, quantity: Number(quantity || 0) };
        })
        .filter(Boolean),
    [cart, detailCache, productsById]
  );

  const cartItemCount = useMemo(() => cartEntries.reduce((sum, row) => sum + row.quantity, 0), [cartEntries]);
  const cartSubtotal = useMemo(
    () => cartEntries.reduce((sum, row) => sum + Number(row.product.currentPrice || row.product.price || 0) * row.quantity, 0),
    [cartEntries]
  );
  const shoppingListTotal = useMemo(
    () => shoppingList.reduce((sum, row) => {
      const product = productsById.get(String(row.id || row.productId || '')) || null;
      const unitPrice = resolveShoppingListUnitPrice(row, product);
      return sum + unitPrice * Number(row.quantity || 1);
    }, 0),
    [productsById, shoppingList]
  );

  const detailProduct = useMemo(() => {
    if (!detailProductId) return null;
    return detailCache[detailProductId] || products.find((item) => String(item.id) === String(detailProductId)) || null;
  }, [detailCache, detailProductId, products]);
  const detailForecast = useMemo(() => {
    if (!detailProductId) return null;
    return detailForecastCache[detailProductId] || null;
  }, [detailForecastCache, detailProductId]);

  const similarProducts = useMemo(() => {
    if (!detailProduct) return [];
    const detailTokens = new Set([
      ...splitTokens(detailProduct.productName),
      ...splitTokens(detailProduct.brandName || detailProduct.brand),
      ...splitTokens(detailProduct.categoryName),
      ...splitTokens(detailProduct.subCategoryName || detailProduct.subCategory),
      ...splitTokens(detailProduct.productType || detailProduct.type),
    ]);
    const detailCategoryId = String(detailProduct.categoryId || '');
    const detailBrand = normalizeKey(detailProduct.brandName || detailProduct.brand);

    const scored = products
      .filter((item) => item.id !== detailProduct.id && String(item.categoryId || '') === detailCategoryId)
      .map((item) => {
        let score = 0;
        if (detailCategoryId && String(item.categoryId || '') === detailCategoryId) score += 10;
        if (normalizeKey(item.categoryName) === normalizeKey(detailProduct.categoryName)) score += 4;
        if (detailBrand && normalizeKey(item.brandName || item.brand) === detailBrand) score += 5;
        if (normalizeKey(item.subCategoryName || item.subCategory) === normalizeKey(detailProduct.subCategoryName || detailProduct.subCategory)) score += 4;
        if (normalizeKey(item.productType || item.type) === normalizeKey(detailProduct.productType || detailProduct.type)) score += 3;
        const itemTokens = splitTokens(`${item.productName || ''} ${item.brandName || item.brand || ''} ${item.categoryName || ''} ${item.subCategoryName || item.subCategory || ''}`);
        const tokenMatches = itemTokens.filter((token) => detailTokens.has(token)).length;
        score += Math.min(tokenMatches, 4);
        return { item, score };
      })
      .filter((entry) => entry.score >= 7)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((entry) => entry.item);

    if (scored.length >= 4) return scored.slice(0, 4);

    const scoredIds = new Set(scored.map((item) => String(item.id)));
    const detailNameTokens = splitTokens(detailProduct.productName || '');
    const nameFallback = products
      .filter((item) => item.id !== detailProduct.id && !scoredIds.has(String(item.id)))
      .map((item) => {
        const itemTokens = splitTokens(item.productName || '');
        const tokenScore = itemTokens.filter((token) => detailNameTokens.includes(token)).length;
        const sameCategory = String(item.categoryId || '') === detailCategoryId;
        return { item, score: (sameCategory ? 2 : 0) + tokenScore };
      })
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);

    return [...scored, ...nameFallback].slice(0, 4);
  }, [detailProduct, products]);

  const isStoreInfoReady = storefrontResolved && Boolean(settingsData);
  const storeInfo = useMemo(() => {
    if (!isStoreInfoReady) {
      return {
        name: 'Shelfio',
        closingTime: '',
        isOpen: null,
        weeklySchedule: [],
        todaySchedule: null,
        scheduleStatus: null,
        specialDays: [],
        isResolved: false,
      };
    }
    const name = settingsData?.storeName || settingsData?.businessName || settingsData?.companyName || 'Shelfio';
    const closingTime = settingsData?.closingTime || '22:00';
    const schedule = Array.isArray(settingsData?.weeklySchedule) ? settingsData.weeklySchedule : [];
    const specialDays = Array.isArray(settingsData?.specialDays) ? settingsData.specialDays : [];
    const scheduleStatus = resolveCustomerStoreScheduleStatus(settingsData || {});
    return {
      name,
      closingTime,
      isOpen: scheduleStatus.isStoreOpen,
      weeklySchedule: schedule,
      todaySchedule: scheduleStatus.todaySchedule,
      scheduleStatus,
      specialDays,
      isResolved: true,
    };
  }, [isStoreInfoReady, settingsData]);
  const supportContact = useMemo(() => resolveSupportContact(settingsData || {}), [settingsData]);
  const supportPhoneHref = useMemo(() => buildTelHref(supportContact.phone), [supportContact.phone]);
  const supportMailHref = useMemo(() => buildMailHref(supportContact.email), [supportContact.email]);

  const checkoutInfo = useMemo(() => {
    const activationState = settingsData?.deskActivationState && typeof settingsData.deskActivationState === 'object'
      ? settingsData.deskActivationState
      : {};
    const sourceDesks = []
      .concat(Array.isArray(settingsData?.cashRegisters) ? settingsData.cashRegisters : [])
      .concat(Array.isArray(settingsData?.pos?.registers) ? settingsData.pos.registers : [])
      .concat(Array.isArray(settingsData?.desks) ? settingsData.desks : [])
      .concat(Array.isArray(settingsData?.deskCodes) ? settingsData.deskCodes.map((code) => ({ code })) : [])
      .concat(Object.keys(settingsData?.deskPins || {}).map((key) => ({ code: key })));

    const desks = sourceDesks
      .map((row, idx) => {
        const rawLabel = repairCustomerUiText(row?.name || row?.label || row?.code || `Kasa ${idx + 1}`, `Kasa ${idx + 1}`);
        const lowered = rawLabel.toLocaleLowerCase('tr-TR');
        const code = String(row?.code || row?.deskCode || rawLabel.replace(/^Kasa\s*/i, '') || '').trim().toUpperCase();
        const combinedState = [row?.status, row?.state, row?.availability, row?.mode, row?.usageStatus, row?.queueStatus].map((value) => String(value || '').trim()).find(Boolean) || '';
        const isManager = lowered.includes('y?netici') || lowered.includes('yonetici') || lowered.includes('manager');
        const hasRuntimeState = Object.prototype.hasOwnProperty.call(activationState, code);
        const runtimeState = hasRuntimeState ? activationState[code] : undefined;
        const explicitlyClosed = isUnavailableDeskState(combinedState)
          || isDeskFlagTrue(row?.isClosed)
          || isDeskFlagTrue(row?.closed)
          || [row?.isActive, row?.active, row?.enabled, row?.isEnabled, row?.open, row?.isOpen].some((value) => isDeskFlagFalse(value));
        const explicitlyOpen = [row?.isActive, row?.active, row?.enabled, row?.isEnabled, row?.open, row?.isOpen, row?.customerAvailable, row?.allowCustomerOrders, row?.isAvailableForCustomers, combinedState].some((value) => isDeskFlagTrue(value));
        const customerOrderBlocked = isDeskFlagFalse(row?.customerAvailable) || isDeskFlagFalse(row?.allowCustomerOrders) || isDeskFlagFalse(row?.isAvailableForCustomers);
        const busy = isBusyDeskState(combinedState) || isDeskFlagTrue(row?.busy) || isDeskFlagTrue(row?.occupied) || isDeskFlagTrue(row?.inUse) || isDeskFlagTrue(row?.isBusy);
        const isOpen = !isManager && !customerOrderBlocked && !explicitlyClosed && (runtimeState === true || explicitlyOpen || (!hasRuntimeState && !explicitlyClosed));
        const isUnavailable = !isManager && !isOpen && (explicitlyClosed || customerOrderBlocked || runtimeState === false);

        return {
          label: rawLabel.startsWith('Kasa') ? rawLabel : `Kasa ${rawLabel.replace(/[^0-9]/g, '') || (idx + 1)}` ,
          isManager,
          isOpen,
          isBusy: !isUnavailable && !isManager && busy,
          isUnavailable,
        };
      })
      .filter((row) => !row.isManager)
      .slice(0, 7);

    const openDesks = desks.filter((desk) => desk.isOpen).map((desk) => desk.label);
    const busyDesks = desks.filter((desk) => desk.isBusy).map((desk) => desk.label);
    const unavailableDesks = desks.filter((desk) => desk.isUnavailable).map((desk) => desk.label);

    return {
      openDesks,
      busyDesks,
      unavailableDesks,
      totalDesks: desks.length,
      hasDeskData: sourceDesks.length > 0,
    };
  }, [settingsData]);
  const latestStoreNotification = useMemo(() => {
    const sorted = [...customerNotifications].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    return sorted[0] || null;
  }, [customerNotifications]);
  const accountPanelData = useMemo(() => {
    if (!accountPanel) return null;
    return null;
  }, [accountPanel]);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) {
      setIsScanning(false);
      return;
    }
    try { await scanner.stop(); } catch {}
    try { await scanner.clear(); } catch {}
    scannerRef.current = null;
    setIsScanning(false);
  }, []);

  const handleBarcodeScan = useCallback(async () => {
    if (isScanning) {
      await stopScanner();
      return;
    }
    setScanError('');
    setIsScanning(true);
    try {
      const Html5Qrcode = await loadHtml5Qrcode();
      await waitForCameraElement('customer-search-reader');
      const scanner = new Html5Qrcode('customer-search-reader');
      scannerRef.current = scanner;
      await startHtml5Scanner(
        scanner,
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          await stopScanner();
          const val = decodedText || '';
          setSearchQuery(val);
          setDebouncedSearchQuery(val); // Force immediate search
          setIsSearchFocused(true);
          navigateTo('search', 'search');
          pushQuickToast('Barkod tarandı, ürün aranıyor...');
        },
        () => {}
      );
    } catch (error) {
      logCameraError(error, 'customer-search');
      try { await scannerRef.current?.clear(); } catch {}
      setScanError(`${getCameraErrorMessage(error)} ${CAMERA_PERMISSION_HELP_TEXT}`);
      setIsScanning(false);
      scannerRef.current = null;
      return;
    }
  }, [isScanning, stopScanner, navigateTo]);

  useEffect(() => () => { void stopScanner(); }, [stopScanner]);

  const openProduct = (productId) => {
    const nextRecent = [productId, ...recentProductIds.filter((id) => id !== productId)].slice(0, 10);
    setRecentProductIds(nextRecent);
    writeStoredArray(RECENT_STORAGE_KEY, nextRecent);
    if (view !== 'detail') {
      setDetailReturnState({
        view,
        tab: activeBottomTab,
      });
    }
    setDetailProductId(productId);
    setView('detail');
    navigate(`/musteri/urun/${encodeURIComponent(String(productId))}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDetailBack = () => {
    const returnView = detailReturnState?.view && detailReturnState.view !== 'detail'
      ? detailReturnState.view
      : 'home';
    const returnTab = detailReturnState?.tab || (returnView === 'cart' || returnView === 'search' || returnView === 'campaigns' ? returnView : 'home');
    navigateTo(returnView, returnTab, { preserveSearch: returnView === 'search', preserveSearchFocus: returnView === 'search' });
  };

  function pushQuickToast(text, type = 'success') {
    setQuickToast({ id: `${Date.now()}-${Math.random()}`, type, text, leaving: false });
  };

  const addToCart = (productId) => {
    const nextProductId = String(productId);
    setCart((current) => ({ ...current, [nextProductId]: Number(current[nextProductId] || 0) + 1 }));
    pushQuickToast('Ürün sepete eklendi');
  };
  const focusCustomerSearch = useCallback(() => {
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [setCategories]);

  const submitCustomerSearch = useCallback(() => {
    const query = searchQuery.trim();
    setSelectedCategoryId('');
    setSelectedTag('');
    setDebouncedSearchQuery(query);
    navigateTo('search', 'search', {
      query,
      preserveSearch: true,
      preserveSearchFocus: true,
    });
  }, [navigateTo, searchQuery]);

  const updateCartQuantity = (productId, quantity) => {
    const nextProductId = String(productId || '');
    if (!nextProductId) return;
    const nextQuantity = Math.max(0, Math.floor(Number(quantity || 0)));
    setCart((current) => {
      const next = { ...current };
      if (nextQuantity <= 0) {
        delete next[nextProductId];
      } else {
        next[nextProductId] = nextQuantity;
      }
      return next;
    });
  };
  const clearCart = () => {
    setCart({});
    pushQuickToast('Sepet temizlendi');
  };
  const toggleFavorite = (productId) => {
    if (!isCustomerLoggedIn) {
      openAuthPrompt('Favorileri kalıcı kaydetmek için giriş yapın.', '/musteri/favorilerim');
      return;
    }
    const pid = String(productId);
    setFavoriteIds((current) => {
      const next = current.includes(pid) ? current.filter((id) => id !== pid) : [...current, pid];
      writeStoredArray(scopedKey(FAVORITES_STORAGE_KEY, customerId), next);
        if (!current.includes(pid)) pushQuickToast('Ürün favorilere eklendi');
      return next;
    });
  };

  const addCartToShoppingList = (selectedProductIds = []) => {
    const selectedSet = new Set((Array.isArray(selectedProductIds) ? selectedProductIds : []).map(String));
    if (!selectedSet.size) return;
    const selectedRows = cartEntries.filter(({ product }) => selectedSet.has(String(product.id)));
    if (!selectedRows.length) return;
    const existingById = new Map(shoppingList.map((item) => [String(item.id), item]));
    selectedRows.forEach(({ product, quantity }) => {
      const key = String(product.id);
      const current = existingById.get(key);
      existingById.set(key, {
        id: key,
        productName: product.productName,
        unit: product.unit || 'adet',
        shelfCode: product.shelfCode || product.defaultShelfLocationCode || '',
        unitPrice: resolveShoppingListUnitPrice({}, product),
        quantity: Number(current?.quantity || 0) + Number(quantity || 0),
      });
    });
    const next = [...existingById.values()];
    setShoppingList(next);
    writeStoredArray(scopedKey(SHOPPING_LIST_STORAGE_KEY, customerId), next);
    pushQuickToast('Seçili ürünler alışveriş listene eklendi');
  };

  const removeShoppingListItem = (productId) => {
    const next = shoppingList.filter((item) => String(item.id) !== String(productId));
    setShoppingList(next);
    writeStoredArray(scopedKey(SHOPPING_LIST_STORAGE_KEY, customerId), next);
    pushQuickToast('Ürün alışveriş listesinden kaldırıldı');
  };

  const completeShopping = async (selectedProductIds = []) => {
    if (!isCustomerLoggedIn) {
      openAuthPrompt('Sipariş geçmişinizi kaydetmek için giriş yapın.', '/musteri/gecmis-siparisler');
      return;
    }
    if (!cartEntries.length) return;

    const selectedSet = new Set((Array.isArray(selectedProductIds) ? selectedProductIds : []).map(String));
    const checkoutEntries = cartEntries.filter(({ product }) => selectedSet.has(String(product.id)));
    if (!checkoutEntries.length) return;

    try {
      const response = await customerPortalAuthService.placeOrder({
        selectedProductIds: checkoutEntries.map(({ product }) => String(product.id)),
      });
      const nextOrder = response?.order || null;
      const nextCart = normalizeCartState(normalizeBackendCart(response?.cart || {}));
      if (nextOrder) {
        setOrderHistory((current) => {
          const nextHistory = [nextOrder, ...current.filter((row) => String(row.id) !== String(nextOrder.id))].slice(0, 100);
          writeStoredArray(scopedKey(ORDER_HISTORY_STORAGE_KEY, customerId), nextHistory);
          return nextHistory;
        });
      }
      setCart(nextCart);
      writeStoredObject(scopedKey(CART_STORAGE_KEY, customerId), nextCart);
      cartSyncSnapshotRef.current = serializeCartState(nextCart);
      pushQuickToast('Siparişiniz kaydedildi');
      navigateTo('order-history', 'account');
    } catch (error) {
      pushQuickToast(error?.message || 'Sipariş kaydedilemedi', 'error');
    }
  };

  const renderHeader = () => (
    <header className="customer-main-header customer-main-header-compact">
      <button type="button" className="header-brand" onClick={() => navigateTo('home', 'home')}><img src={logoPng} alt="Shelfio" /></button>
      <div className="customer-header-spacer" />
      <div className="header-actions">
        <button type="button" className={`header-icon-btn ${storeInfo.isResolved ? '' : 'is-loading'}`} aria-label="Ma\u011faza durumu" title={storeInfo.isResolved ? (storeInfo.isOpen ? 'Ma\u011faza a\u00e7\u0131k' : 'Ma\u011faza kapal\u0131') : 'Ma\u011faza durumu y\u00fckleniyor'} onClick={() => navigateTo('store-hours', 'home')}>
          <Store size={16} color={storeInfo.isResolved ? (storeInfo.isOpen ? '#16a34a' : '#ef4444') : '#94a3b8'} />
        </button>
        <button type="button" className="header-icon-btn customer-notification-button" onClick={openNotifications} aria-label="Bildirimler">
          <Bell size={20} />
          {unreadCustomerNotificationCount > 0 ? <span className="customer-notification-dot" aria-hidden="true" /> : null}
        </button>
      </div>
    </header>
  );
  const renderSearchBar = () => (
    <section className="customer-search-wrapper" aria-label="Ürün arama">
      <form
        className="customer-search-form customer-search-form--mobile"
        onSubmit={(event) => {
          event.preventDefault();
          submitCustomerSearch();
        }}
        onClick={focusCustomerSearch}
      >
        <span className="customer-search-leading-icon" aria-hidden="true"><Search size={20} /></span>
        <input
          ref={searchInputRef}
          type="search"
          placeholder="Ürün, kategori veya barkod ara"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setTimeout(() => setIsSearchFocused(false), 120)}
        />
        <div className="customer-search-trailing-actions">
          <button
            type="button"
            className="scan-btn"
            onClick={(event) => {
              event.stopPropagation();
              handleBarcodeScan();
            }}
            aria-label="Barkod okut"
          >
            <QrCode size={18} />
          </button>
        </div>
      </form>

      {isScanning ? <div className="customer-search-camera"><div id="customer-search-reader"></div></div> : null}
      {scanError ? (
        <div style={{ marginTop: '12px', padding: '12px', background: '#fee2e2', color: '#dc2626', borderRadius: '8px', fontSize: '0.85rem', textAlign: 'center', border: '1px solid #fca5a5', display: 'grid', gap: '8px', justifyItems: 'center' }}>
          <span>{scanError}</span>
          <button type="button" className="ghost-button" onClick={handleBarcodeScan} disabled={isScanning}>
            Tekrar Dene
          </button>
        </div>
      ) : null}

      {(searchQuery.trim().length >= 2 || selectedCategoryId) ? (
        <small className="customer-search-count">{formatCustomerSearchResultCount(searchResults.length)}</small>
      ) : null}

      {view === 'home' && debouncedSearchQuery.length >= 2 ? (
        inlineHomeSearchResults.length ? (
          <ul className="customer-home-search-suggestions">
            {inlineHomeSearchResults.map((item) => (
              <li key={`home-search-${item.id}`}>
                <button type="button" onClick={() => openProduct(item.id)}>
                  <strong>{item.productName}</strong>
                  <small>{joinCustomerMeta([item.barcode || item.sku, formatCurrency(Number(item.currentPrice || item.price || 0))])}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : <div className="empty-state-box">Sonuç bulunamadı.</div>
      ) : null}
    </section>
  );

  const renderProductSection = (title, items) => (
    items.length ? (
      <section className="customer-section">
        <h3>{title}</h3>
        <div className="customer-results-grid">
          {items.map((item) => (
            <ProductResultCard
              key={item.id}
              product={item}
              onDetail={openProduct}
              onAddToCart={addToCart}
              isFavorite={favoriteIds.includes(String(item.id))}
              onToggleFavorite={toggleFavorite}
              cartQuantity={Number(cart[String(item.id)] || 0)}
            />
          ))}
        </div>
      </section>
      ) : null
  );

  const renderCampaignProductsSection = (title, items, emptyText) => (
    <section className="customer-section customer-campaign-products-section">
      <div className="customer-campaign-products-head">
        <div>
          <h3>{title}</h3>
          <p>{selectedCampaign ? `${selectedCampaign.name} kampanyasına ait ürünler` : 'Tüm aktif kampanyalardaki ürünleri görüntüleyin.'}</p>
        </div>
      </div>

      <div className="customer-campaign-products-toolbar">
        <label className="customer-campaign-products-search">
          <Search size={16} />
          <input
            type="text"
            value={campaignProductSearch}
            onChange={(event) => setCampaignProductSearch(event.target.value)}
            placeholder="Ürün, SKU, barkod veya kampanya ara"
          />
        </label>
        <div className="customer-campaign-filter-chips" role="tablist" aria-label="Kampanya filtresi">
          <button
            type="button"
            className={`customer-campaign-filter-chip ${!selectedCampaign ? 'is-active' : ''}`}
            onClick={() => navigateTo('campaigns', 'campaigns', { mode: 'campaign-products' })}
          >
            Tümü
          </button>
          {customerCampaignFilterOptions.map((campaign) => (
            <button
              key={`campaign-filter-${campaign.id}`}
              type="button"
              className={`customer-campaign-filter-chip ${String(selectedCampaignId) === String(campaign.id) ? 'is-active' : ''}`}
              onClick={() => navigateTo('campaigns', 'campaigns', { mode: 'campaign-products', campaignId: campaign.id })}
            >
              {campaign.name}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty-state-box">{emptyText}</div>
      ) : (
        <div className="customer-results-grid">
          {items.map((item) => (
            <ProductResultCard
              key={item.id}
              product={item}
              onDetail={openProduct}
              onAddToCart={addToCart}
              isFavorite={favoriteIds.includes(String(item.id))}
              onToggleFavorite={toggleFavorite}
              cartQuantity={Number(cart[String(item.id)] || 0)}
            />
          ))}
        </div>
      )}
    </section>
  );

  const renderCampaignDetailSheet = () => {
    if (!campaignDetail) return null;
    const detailDescription = resolveCustomerCampaignDescription(campaignDetail);
    return (
      <div className="customer-campaign-detail-overlay" role="dialog" aria-modal="true" aria-labelledby="customer-campaign-detail-title">
        <div className="customer-campaign-detail-sheet">
          <div className="customer-campaign-detail-head">
            <div className="customer-campaign-detail-icon" aria-hidden="true">
              <Megaphone size={20} />
            </div>
            <div className="customer-campaign-detail-copy">
              <strong id="customer-campaign-detail-title">{campaignDetail.name}</strong>
              <p>{detailDescription}</p>
            </div>
          </div>

          <div className="customer-campaign-detail-grid">
            <div><span>Kampanya adı</span><strong>{campaignDetail.name}</strong></div>
            <div><span>Kampanya etiketi</span><strong>{resolveCustomerCampaignBadge(campaignDetail)}</strong></div>
            <div><span>Geçerlilik</span><strong>{formatCampaignValidity(campaignDetail)}</strong></div>
            <div><span>Geçerli ürün sayısı</span><strong>{Number(campaignDetail.productCount || campaignDetail.products?.length || 0)}</strong></div>
          </div>

          <div className="customer-campaign-detail-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setCampaignDetailId('');
                navigateTo('campaigns', 'campaigns', { mode: 'campaign-products', campaignId: campaignDetail.id });
              }}
            >
              Kampanyalı ürünleri gör
            </button>
            <button type="button" className="ghost-button" onClick={() => setCampaignDetailId('')}>Kapat</button>
          </div>
        </div>
      </div>
    );
  };

  const renderMiniProductGridSection = (title, items, emptyText) => (
    <div className="customer-mini-product-section">
      {title ? <h3>{title}</h3> : null}
      {items.length === 0 ? (
        <div className="empty-state-box customer-mini-empty">{emptyText}</div>
      ) : (
        <div className="customer-mini-product-grid">
          {items.map((item) => {
            const unitPrice = Number(item.currentPrice || item.salePrice || item.price || 0);
            const available = Number(item?.available ?? item?.stockSummary?.available ?? item?.totalStock ?? 0) > 0;
            return (
              <button key={`mini-${title}-${item.id}`} type="button" className="customer-mini-product-card" onClick={() => openProduct(item.id)}>
                <strong>{item.productName || '-'}</strong>
                <p>{formatCurrency(unitPrice)}</p>
                <small className={available ? 'is-ok' : 'is-passive'}>{available ? 'Mağazada mevcut' : 'Stok durumu belirsiz'}</small>
                {resolveLocationLabel(item) !== '-' ? <span className="customer-mini-location-chip">{resolveLocationLabel(item)}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderHome = () => (
    <div className="customer-home-layout">
      {renderSearchBar()}

      <section className="customer-section quick-actions-section">
        <div className="quick-actions-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          <button className="quick-action-card" onClick={() => navigateTo('campaigns', 'campaigns')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}><div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#fee2e2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Tag size={20} /></div><span style={{ fontSize: '0.75rem', fontWeight: '500', color: '#334155' }}>Kampanyalar</span></button>
          <button className="quick-action-card" onClick={() => navigateTo('search', 'search')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}><div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#e0f2fe', color: '#0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><MapPin size={20} /></div><span style={{ fontSize: '0.75rem', fontWeight: '500', color: '#334155' }}>Kategoriler</span></button>
          <button className="quick-action-card" onClick={handleBarcodeScan} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}><div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#f1f5f9', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><QrCode size={20} /></div><span style={{ fontSize: '0.75rem', fontWeight: '500', color: '#334155' }}>Tarat & Bul</span></button>
          <button className="quick-action-card" onClick={() => openAccountPanel('favorites')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}><div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#fce7f3', color: '#ec4899', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Heart size={20} /></div><span style={{ fontSize: '0.75rem', fontWeight: '500', color: '#334155' }}>Favoriler</span></button>
          <button className="quick-action-card" onClick={() => openAccountPanel('shopping-list')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}><div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#ffedd5', color: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ListOrdered size={20} /></div><span style={{ fontSize: '0.75rem', fontWeight: '500', color: '#334155' }}>Alışveriş Listem</span></button>
          <button className="quick-action-card" onClick={() => openAccountPanel('gift-cards')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}><div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#dcfce7', color: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PackageSearch size={20} /></div><span style={{ fontSize: '0.75rem', fontWeight: '500', color: '#334155' }}>Hediye Kartları</span></button>
        </div>
      </section>

      <section className="customer-section customer-store-insights customer-home-spaced-section">
        <h3 className="customer-section-title-emphasized"><Clock size={16} /> {"Ma\u011faza \u0130\u00e7i Bilgiler"}</h3>
        <div className="customer-store-insights-grid">
          <div className="customer-store-insight-card" style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <div className="customer-store-insight-head" style={{ marginBottom: '8px' }}><Clock size={15} /> <span style={{ fontWeight: 600 }}>{"M\u00fcsait Kasalar"}</span></div>
            {(() => {
              if (!storefrontResolved) {
                return <small style={{ color: '#64748b', fontWeight: 600, display: 'block', fontSize: '0.85rem' }}>{"Kasa bilgisi g\u00fcncelleniyor."}</small>;
              }
              if (checkoutInfo.openDesks.length > 0) {
                return (
                  <div className="customer-open-desk-chip-list">
                    {checkoutInfo.openDesks.map((desk) => (
                      <span key={desk} className="customer-open-desk-chip">
                        <span className="customer-open-desk-dot" />
                        <strong>{desk}</strong>
                      </span>
                    ))}
                  </div>
                );
              }
              return <small style={{ color: '#64748b', fontWeight: 600, display: 'block', fontSize: '0.85rem' }}>{"\u015eu anda kullan\u0131labilir kasa bilgisi bulunmuyor."}</small>;
            })()}
          </div>
          <div className="customer-store-insight-card">
            <div className="customer-store-insight-head"><Megaphone size={15} /> <span>Son Bildirim</span></div>
            <small>{latestStoreNotification?.title || latestStoreNotification?.description || 'Şu anda yeni bildirim bulunmuyor.'}</small>
          </div>
        </div>
      </section>

      <section className="customer-section customer-home-block">
        <h3 className="customer-section-title-emphasized customer-home-section-title"><Flame size={18} /> Çok Satanlar</h3>
        {renderMiniProductGridSection('', topSellerProducts, 'Satış verisine dayalı ürün bulunamadı.')}
      </section>

      <section className="customer-section customer-home-block">
        <h3 className="customer-section-title-emphasized customer-home-section-title"><History size={18} /> Son Baktıklarınız</h3>
        {renderMiniProductGridSection('', recentViewedProducts, 'Henüz görüntülenen ürün bulunmuyor.')}
      </section>

      <section className="customer-section customer-campaigns-hero customer-campaigns-spaced customer-home-block customer-home-spaced-section">
        <div className="section-header-with-action customer-home-section-head customer-home-campaign-head">
          <h3 className="customer-section-title-emphasized customer-home-section-title"><Sparkles size={16} /> Aktif Kampanyalar</h3>
          <div className="customer-campaign-cta-row">
            <button type="button" className="customer-campaign-home-tab" onClick={() => navigateTo('campaigns', 'campaigns', { mode: 'popular' })}>{'Popüler Ürünler'}</button>
            <button type="button" className="customer-campaign-home-tab is-active" onClick={() => navigateTo('campaigns', 'campaigns')}>{'Tüm Kampanyalar'}</button>
          </div>
        </div>
        {activeCampaigns.length > 0 ? (
          <div className="vertical-product-list customer-home-campaign-list">
            {activeCampaigns.slice(0, 3).map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                className="campaign-card campaign-card-button campaign-card--home"
                onClick={() => navigateTo('campaigns', 'campaigns', { campaignId: campaign.id })}
              >
                <div className="campaign-card__head">
                  <span className="campaign-card__icon" aria-hidden="true"><Sparkles size={16} /></span>
                  <div className="campaign-card__aside campaign-card__aside--home">
                    <span className="campaign-card__discount">%{Number(campaign.discountRate || 0).toFixed(0)}</span>
                    <span className="campaign-card__count">{Number(campaign.productCount || campaign.products?.length || 0)} {'ürün'}</span>
                  </div>
                </div>
                <strong>{repairCustomerUiText(campaign.name, 'Kampanya')}</strong>
                <div className="campaign-card__meta-row">
                  <span>{formatCampaignValidity(campaign)}</span>
                  <span>{Number(campaign.productCount || campaign.products?.length || 0)} {'ilgili ürün'}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state-box customer-campaign-empty-state">
            {'Şu anda gösterilecek aktif kampanya bulunmuyor.'}
          </div>
        )}
      </section>
    </div>
  );

  const renderSearchResults = () => (
    <div className="customer-subpage customer-settings-page">
      <div style={{ padding: 0 }}>{renderSearchBar()}</div>
      <section className="customer-section customer-search-section customer-search-section-v2">
        {searchQuery.trim().length < 2 && !selectedCategoryId ? (
          <div className="customer-popular-searches customer-popular-searches-v2">
            <h4 style={{ fontSize: '0.86rem', color: '#64748b', marginBottom: '2px' }}>Popüler Aramalar</h4>
            <div className="customer-popular-chip-grid">
              {['süt', 'yumurta', 'ekmek', 'su', 'çikolata', 'kahve', 'makarna', 'peynir', 'yoğurt', 'deterjan'].map((term) => (
                <button key={term} type="button" className="customer-popular-chip" onClick={() => setSearchQuery(term)}>{term}</button>
              ))}
            </div>
          </div>
        ) : null}

        {searchQuery.trim().length < 2 && !isCategoryBrowseMode ? (
          <>
            <div className="customer-categories-wrap">
              <h4 style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '2px' }}>Kategoriler</h4>
              {categories.length === 0 && categoriesLoading ? (
                <div className="empty-state-box">Kategoriler yükleniyor...</div>
              ) : null}
              {categories.length === 0 && !categoriesLoading && categoriesError ? (
                <div className="empty-state-box">
                  <p>Kategoriler şu anda yüklenemedi.</p>
                  <button type="button" className="ghost-button" onClick={() => ensureCategories({ force: true })}>Tekrar dene</button>
                </div>
              ) : null}
              {categories.length === 0 && !categoriesLoading && !categoriesError ? (
                <div className="empty-state-box">Gösterilecek kategori bulunamadı.</div>
              ) : null}
              {categories.length > 0 ? (
                <div className="customer-category-grid">
                  {categoriesByDemand.map((cat, index) => {
                  const visual = getCategoryVisual(cat.name);
                  return (
                    <button
                      key={cat.id || `category-${index}`}
                      className={`category-shortcut-card ${selectedCategoryId === String(cat.id || '') ? 'is-selected' : ''}`}
                      onClick={() => {
                        setSelectedCategoryId(String(cat.id || ''));
                        setSelectedTag(ALL_CATEGORY_TAG_KEY);
                        setSearchQuery('');
                        setDebouncedSearchQuery('');
                        navigateTo('search', 'search', { preserveSearch: true, preserveSearchFocus: true });
                      }}
                      style={{ minWidth: 0, display: 'grid', gap: '8px', padding: '10px 8px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0' }}
                    >
                      <CategoryVisualMedia categoryName={cat.name} visual={visual} alt={repairCustomerVisibleText(cat.name || 'Kategori')} />
                      <span style={{ fontSize: '0.72rem', fontWeight: '500', color: '#334155', textAlign: 'center', lineHeight: 1.2 }}>{cat.name || 'Kategori'}</span>
                    </button>
                  );
                  })}
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {isCategoryBrowseMode ? (
          <div style={{ marginBottom: '12px' }}>
            <div className="customer-category-page-head">
              <button
                type="button"
                className="customer-category-title-icon customer-category-title-icon-button"
                onClick={clearSelectedSearchCategory}
                aria-label="Kategori seçimine dön"
                title="Kategori seçimine dön"
              >
                <CategoryVisualMedia categoryName={selectedCategoryName} visual={selectedCategoryVisual} alt="" compact />
              </button>
              <h3>{selectedCategoryName || 'Kategori'}</h3>
              <span className="customer-category-product-count">
                <span>{normalizeCustomerCount(filteredSearchResults.length)}</span>
                <span>ürün</span>
              </span>
            </div>
            {categoryTags.length > 0 ? (
              <div className="customer-category-tag-chips" role="radiogroup" aria-label="Kategori etiket seçimi">
                <button
                  key={ALL_CATEGORY_TAG_KEY}
                  type="button"
                  role="radio"
                  aria-checked={selectedTag === ALL_CATEGORY_TAG_KEY}
                  className={`customer-category-tag-chip ${selectedTag === ALL_CATEGORY_TAG_KEY ? 'is-active' : ''}`}
                  onClick={() => setSelectedTag(ALL_CATEGORY_TAG_KEY)}
                >
                  Tümü
                </button>
                {categoryTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    role="radio"
                    aria-checked={selectedTag === tag}
                    className={`customer-category-tag-chip ${selectedTag === tag ? 'is-active' : ''}`}
                    onClick={() => setSelectedTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            ) : <div className="empty-state-box">Etiket bulunamadı.</div>}
          </div>
        ) : null}

        {((debouncedSearchQuery.length >= 2) || selectedCategoryId) && filteredSearchResults.length === 0 && productsLoading ? (
          <div className="empty-state-box" style={{ textAlign: 'center', padding: '32px 16px' }}>
            <Search size={32} color="#cbd5e1" style={{ margin: '0 auto 12px auto' }} />
            <p style={{ color: '#64748b' }}>Ürünler yükleniyor...</p>
          </div>
        ) : null}

        {((debouncedSearchQuery.length >= 2) || selectedCategoryId) && filteredSearchResults.length === 0 && !productsLoading ? (
          <div className="empty-state-box" style={{ textAlign: 'center', padding: '32px 16px' }}>
            <Search size={32} color="#cbd5e1" style={{ margin: '0 auto 12px auto' }} />
            <p style={{ color: '#64748b' }}>{selectedCategoryId ? 'Bu kategoride ürün bulunamadı.' : 'Aramanıza uygun ürün bulunamadı.'}</p>
          </div>
        ) : null}

        {((debouncedSearchQuery.length >= 2) || selectedCategoryId) && filteredSearchResults.length > 0 ? (
          <div className="customer-results-grid">
            {filteredSearchResults.map((item) => (
              <ProductResultCard
                key={item.id}
                product={item}
                onDetail={openProduct}
                onAddToCart={addToCart}
                isFavorite={favoriteIds.includes(String(item.id))}
                onToggleFavorite={toggleFavorite}
                cartQuantity={Number(cart[String(item.id)] || 0)}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );

  const renderNotifications = () => (
    <div className="customer-subpage">
      <section className="customer-section">
        <div className="customer-notification-list-head">
          <h3>Bildirimler</h3>
          {customerNotifications.length > 0 ? (
            <button type="button" className="customer-notification-clear-btn" onClick={() => setClearNotificationsConfirmOpen(true)}>
              Bildirimleri Temizle
            </button>
          ) : null}
        </div>
        {customerNotifications.length === 0 ? (
          <div className="empty-state-box">Gösterilecek bildirim bulunmuyor.</div>
        ) : (
          <ul className="notification-list-simple">
            {customerNotifications.map((item) => {
              const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
              const actionUrl = String(item?.actionUrl || payload.actionUrl || '').trim();
              const canOpenAction = actionUrl.startsWith('/musteri');
              const actionLabel = item.actionLabel || payload.actionLabel || (item.type === 'PROXIMITY_PRODUCT_DISCOUNT' ? 'Ürüne Git' : 'İncele');
              return (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  {item.description ? <p>{item.description}</p> : null}
                  <small>{item.createdAt ? new Date(item.createdAt).toLocaleString('tr-TR') : '-'}</small>
                  {canOpenAction ? (
                    <button type="button" className="customer-notification-action" onClick={() => handleNotificationAction(item)}>
                      {actionLabel}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );

  const renderCategoryPage = () => {
    const slug = decodeURIComponent((location.pathname.split('/musteri/kategori/')[1] || '').split('/')[0] || '');
    const category = resolveCategoryFromRouteSlug(slug, categoriesByDemand, categories);
    const rows = products.filter((item) => {
      if (!category) return false;
      const categoryId = String(item.categoryId || '');
      const categoryName = normalizeKey(resolveCustomerProductCategory(item));
      return categoryId === String(category.id || '') || categoryName === normalizeKey(category.name || '');
    });
    const pageTags = dedupeTags([
      ...toTagList(category?.etiketler),
      ...toTagList(category?.tags),
      ...toTagList(category?.labels),
      ...rows.flatMap((item) => getProductTagList(item)),
    ]).sort((a, b) => a.localeCompare(b, 'tr'));
    const visibleRows = selectedTag && selectedTag !== ALL_CATEGORY_TAG_KEY
      ? rows.filter((item) => getProductTagList(item).some((tag) => normalizeKey(tag) === normalizeKey(selectedTag)))
      : rows;

    return (
      <div className="customer-subpage">
        <section className="customer-section">
          <div className="customer-category-page-head">
            <button type="button" className="ghost-button" onClick={() => navigateTo('search', 'search', { preserveSearch: true })} aria-label="Geri" style={{ minWidth: '36px', minHeight: '36px', padding: 0, justifyContent: 'center' }}><ArrowLeft size={16} /></button>
            <CategoryVisualMedia categoryName={category?.name || ''} visual={getCategoryVisual(category?.name || '')} alt="" compact />
            <h3 style={{ margin: 0, textAlign: 'left' }}>{category?.name || 'Kategori'}</h3>
          </div>
          {pageTags.length > 0 ? (
            <div className="customer-category-tag-chips" role="radiogroup" aria-label="Kategori etiket seçimi" style={{ marginBottom: '12px' }}>
              <button
                type="button"
                role="radio"
                aria-checked={!selectedTag || selectedTag === ALL_CATEGORY_TAG_KEY}
                className={`customer-category-tag-chip ${!selectedTag || selectedTag === ALL_CATEGORY_TAG_KEY ? 'is-active' : ''}`}
                onClick={() => setSelectedTag(ALL_CATEGORY_TAG_KEY)}
              >
                Tümü
              </button>
              {pageTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  role="radio"
                  aria-checked={selectedTag === tag}
                  className={`customer-category-tag-chip ${selectedTag === tag ? 'is-active' : ''}`}
                  onClick={() => setSelectedTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : <div className="empty-state-box" style={{ marginBottom: '12px' }}>Etiket bulunamadı.</div>}
          {productsLoading && visibleRows.length === 0 ? <div className="empty-state-box">Ürünler yükleniyor...</div> : null}
          {visibleRows.length ? (
            <div className="customer-results-grid">
              {visibleRows.map((item) => (
                <ProductResultCard key={item.id} product={item} onDetail={openProduct} onAddToCart={addToCart} isFavorite={favoriteIds.includes(String(item.id))} onToggleFavorite={toggleFavorite} cartQuantity={Number(cart[String(item.id)] || 0)} />
              ))}
            </div>
          ) : <div className="empty-state-box">Bu kategoride ürün bulunamadı.</div>}
        </section>
      </div>
    );
  };

  const renderCampaigns = () => (
    <div className="customer-subpage">
      <div className="customer-campaign-tab-shell">
        <div className="customer-campaign-tab-bar">
          {[
            { key: 'all', label: 'Tümü' },
            { key: 'today', label: 'Bugüne Özel' },
            { key: 'popular', label: 'Popüler' },
            { key: 'campaign-products', label: 'Kampanyalı Ürünleri Gör' },
          ].map((filter) => (
            <button key={filter.key} type="button" className={`customer-campaign-tab ${campaignViewMode === filter.key ? 'is-active' : ''}`} onClick={() => navigateTo('campaigns', 'campaigns', { mode: filter.key })}>{filter.label}</button>
          ))}
        </div>
      </div>

      <div className={`customer-campaign-content-shell${campaignViewMode === 'all' ? ' is-all-mode' : ''}`}>
        {(campaignViewMode === 'popular'
          ? popularProducts.length > 0
          : campaignViewMode === 'today'
            ? todaysCampaigns.length > 0
            : campaignViewMode === 'campaign-products'
              ? filteredCampaignProducts.length > 0 || campaignProducts.length > 0 || listedCampaigns.length > 0
              : listedCampaigns.length > 0) ? (
          <>
            {campaignViewMode === 'popular' ?
               renderProductSection('Popüler Ürünler (Son 7 Gün)', popularProducts)
              : campaignViewMode === 'today' ?
                 (
                  <>
                    <section className="customer-section">
                      <h3>Bugüne Özel Kampanyalar</h3>
                      <div className="vertical-product-list">
                        {todaysCampaigns.map((campaign) => (
                          <button key={campaign.id} type="button" className="campaign-card campaign-card-button" onClick={() => setCampaignDetailId(campaign.id)}>
                            <span className="campaign-card__badge">Bugüne özel</span>
                            <strong>{campaign.name}</strong>
                            <p>{resolveCustomerCampaignDescription(campaign)}</p>
                          </button>
                        ))}
                      </div>
                    </section>
                    {renderProductSection('Bugüne Özel Ürünler', todaysCampaigns.flatMap((item) => item.products || []))}
                  </>
                )
              : campaignViewMode === 'campaign-products' ? (
                renderCampaignProductsSection(
                  selectedCampaign ? `${selectedCampaign.name} Kampanyalı Ürünler` : 'Kampanyalı Ürünler',
                  filteredCampaignProducts,
                  selectedCampaign ? 'Bu kampanyada ürün bulunmuyor.' : 'Aktif kampanyalara ait ürün bulunmuyor.'
                )
              )
              : (
                <div className="vertical-product-list customer-campaign-list-plain">
                  {listedCampaigns.map((campaign) => {
                    return (
                      <button key={campaign.id} type="button" className="campaign-card campaign-card-button" onClick={() => setCampaignDetailId(campaign.id)}>
                        <div className="campaign-card__head">
                          <span className="campaign-card__icon" aria-hidden="true"><Sparkles size={16} /></span>
                          <div className="campaign-card__aside">
                            <span className="campaign-card__badge">{resolveCustomerCampaignBadge(campaign)}</span>
                            <span className="campaign-card__count">{`${Number(campaign.productCount || campaign.products?.length || 0)} ürün`}</span>
                          </div>
                        </div>
                        <strong>{repairCustomerUiText(campaign.name, 'Kampanya')}</strong>
                        <p>{repairCustomerUiText(resolveCustomerCampaignDescription(campaign), '-')}</p>
                      </button>
                    );
                  })}
                </div>
              )}
          </>
        ) : (
          <div className="empty-state-box" style={{ textAlign: 'center', padding: '40px 16px', background: 'transparent' }}>
            <Tag size={40} color="#cbd5e1" style={{ margin: '0 auto 16px auto' }} />
            <h4 style={{ fontSize: '1.1rem', color: '#334155', marginBottom: '8px' }}>
              {campaignViewMode === 'popular'
                ? 'Popüler ürün bulunamadı'
                : campaignViewMode === 'campaign-products'
                  ? 'Kampanyalı ürün bulunamadı'
                  : campaignViewMode === 'today'
                    ? 'Bugüne özel kampanya bulunmuyor.'
                    : 'Kampanya Bulunamadı'}
            </h4>
            <p style={{ color: '#64748b', marginBottom: '24px', fontSize: '0.9rem' }}>
              {campaignViewMode === 'popular'
                ? 'Son 7 gün satış verisinde popüler ürün bulunmuyor.'
                : campaignViewMode === 'campaign-products'
                  ? 'Bu kampanyada ürün bulunmuyor.'
                  : campaignViewMode === 'today'
                    ? 'Bugünün tarih aralığına uyan kampanya yok.'
                    : 'Şu an için aktif bir kampanya bulunmuyor.'}
            </p>
          </div>
        )}
      </div>
      {renderCampaignDetailSheet()}
    </div>
  );

  const renderFavorites = () => (
    <div className="customer-subpage">
      <section className="customer-section">
        <h3 className="customer-section-title-emphasized" style={{ marginBottom: '16px' }}><Heart size={18} color="#ef4444" /> Favorilerim</h3>
        {!isCustomerLoggedIn ? (
          <div className="customer-guest-guard">
            <h4>Favoriler için giriş gerekli</h4>
            <p>Favori ürünlerinizi kalıcı olarak kaydetmek için giriş yapın.</p>
            <div className="customer-guest-guard-actions">
              <button type="button" className="primary-button" onClick={() => navigate('/musteri/login', { state: { from: { pathname: '/musteri/favorilerim', search: '' } } })}>Giriş Yap</button>
              <button type="button" className="ghost-button" onClick={() => navigate('/musteri/login?register=1', { state: { from: { pathname: '/musteri/favorilerim', search: '' } } })}>Kayıt Ol</button>
            </div>
          </div>
        ) : null}
        {favoriteProducts.length === 0 ? (
          <div className="empty-state-box">
            <p>Favori ürün bulunmuyor.</p>
            <button type="button" className="primary-button" onClick={() => navigateTo('search', 'search')}>Ürün Ara</button>
          </div>
        ) : (
          <div className="customer-results-grid">
            {favoriteProducts.map((item) => (
              <ProductResultCard key={item.id} product={item} onDetail={openProduct} onAddToCart={addToCart} isFavorite={favoriteIds.includes(String(item.id))} onToggleFavorite={toggleFavorite} cartQuantity={Number(cart[String(item.id)] || 0)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );

  const renderPopularProducts = () => (
    <div className="customer-subpage customer-popular-products-page">
      <h3>Popüler Ürünler (Son 7 Gün)</h3>
      {popularProducts.length === 0 ? (
        <div className="empty-state-box">Son 7 güne ait satış verisi bulunamadı.</div>
      ) : (
        <div className="customer-results-grid">
          {popularProducts.map((item) => (
            <ProductResultCard key={item.id} product={item} onDetail={openProduct} onAddToCart={addToCart} isFavorite={favoriteIds.includes(String(item.id))} onToggleFavorite={toggleFavorite} cartQuantity={Number(cart[String(item.id)] || 0)} />
          ))}
        </div>
      )}
    </div>
  );

  const renderShoppingList = () => (
    <div className="customer-subpage">
      <section className="customer-section">
        <div className="customer-shopping-list-title-row">
          <h3 className="customer-section-title-emphasized"><ListOrdered size={18} /> Alışveriş Listem</h3>
          <strong>{formatCurrency(shoppingListTotal)}</strong>
        </div>
        {!isCustomerLoggedIn ? (
          <div className="customer-guest-guard">
            <h4>Alışveriş listesi için giriş gerekli</h4>
            <p>Listenizi kaydetmek ve farklı cihazlarda kullanmak için giriş yapın.</p>
            <div className="customer-guest-guard-actions">
              <button type="button" className="primary-button" onClick={() => navigate('/musteri/login', { state: { from: { pathname: '/musteri/alisveris-listem', search: '' } } })}>Giriş Yap</button>
              <button type="button" className="ghost-button" onClick={() => navigate('/musteri/login?register=1', { state: { from: { pathname: '/musteri/alisveris-listem', search: '' } } })}>Kayıt Ol</button>
            </div>
          </div>
        ) : null}
        {shoppingList.length === 0 ? (
          <div className="empty-state-box">
            <h4>Listeniz şu an boş</h4>
            <p>Kaydettiğiniz ürünler burada görünecek.</p>
          </div>
        ) : (
          <ul className="notification-list-simple customer-shopping-list">
            {shoppingList.map((row) => (
              <li key={`list-${row.id}`} className="customer-shopping-list-item">
                <div className="customer-shopping-list-item__body">
                  <strong>{row.productName}</strong>
                  <small>{joinCustomerMeta([
                    `${row.quantity} ${repairCustomerUiText(row.unit, 'adet')}`,
                    resolveShoppingListUnitPrice(row, productsById.get(String(row.id || row.productId || '')) || null) > 0 ? formatCurrency(resolveShoppingListUnitPrice(row, productsById.get(String(row.id || row.productId || '')) || null) * Number(row.quantity || 1)) : '',
                    row.shelfCode,
                  ])}</small>
                </div>
                <button
                  type="button"
                  className="customer-shopping-list-item__remove"
                  onClick={() => removeShoppingListItem(row.id)}
                  aria-label={`${row.productName} ürününü listeden kaldır`}
                >
                  <Trash2 size={14} />
                  Sil
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  const renderStoreHours = () => {
  if (!storeInfo.isResolved) {
    return (
      <div className="customer-subpage">
        <section className="customer-section store-hours-page">
          <h3><Store size={16} /> Mağaza Çalışma Saatleri</h3>
          <div className="store-hours-today is-loading" role="status">
            <strong><Clock size={15} /> Saat bilgisi yükleniyor</strong>
            <small>Güncel mağaza ayarları alınıyor.</small>
          </div>
        </section>
      </div>
    );
  }
  const todayOpen = storeInfo.scheduleStatus?.opensAt || settingsData?.openingTime || '10:00';
  const todayClose = storeInfo.scheduleStatus?.closesAt || settingsData?.closingTime || '22:00';
  const isClosedToday = !storeInfo.isOpen;
  const weeklySchedule = Array.isArray(storeInfo.weeklySchedule) ? storeInfo.weeklySchedule : [];
  const specialDays = Array.isArray(storeInfo.specialDays) ? storeInfo.specialDays.slice(0, 12) : [];
  return (
    <div className="customer-subpage">
      <section className="customer-section store-hours-page">
        <h3><Store size={16} /> Mağaza Çalışma Saatleri</h3>
        <div className={`store-hours-today ${isClosedToday ? 'is-closed' : 'is-open'}`}>
          <strong>{isClosedToday ? <><ShieldAlert size={15} /> Bugün kapalı</> : <><ShieldCheck size={15} /> Bugün açık</>}</strong>
          <small>{isClosedToday ? `Son kapanış: ${todayClose}` : `${todayOpen} - ${todayClose}`}</small>
        </div>
        <div className="store-hours-sections">
          <section className="cart-info-section store-hours-card store-hours-weekly-section">
            <h4><Clock size={14} /> Haftalık Saatler</h4>
            <ul className="notification-list-simple store-hours-list">
              {weeklySchedule.map((row) => (
                <li key={row.dayKey}>
                  <strong>{row.dayKey}</strong>
                  <small className={row.isClosed ? 'customer-hours-closed' : 'customer-hours-open'}>{row.isClosed ? 'Kapalı' : `${row.opensAt || '-'} - ${row.closesAt || '-'}`}</small>
                </li>
              ))}
            </ul>
          </section>
          {specialDays.length ? (
            <section className="cart-info-section store-hours-card store-hours-special-section">
              <h4><BellRing size={14} /> Özel Günler</h4>
              <ul className="notification-list-simple store-hours-list store-hours-special-list">
                {specialDays.map((day, index) => (
                  <li key={`${day.id || day.date || 'special'}-${index}`}>
                    <strong>{day.date || day.startDate || '-'}</strong>
                    <small className={day.isClosed ? 'customer-hours-closed' : 'customer-hours-open'}>{day.isClosed ? 'Kapalı' : `${day.startTime || day.opensAt || '-'} - ${day.endTime || day.closesAt || '-'}`}</small>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
};

  const renderAccount = () => (
    <div className="customer-subpage">
      <section className="customer-section">
        {!isCustomerLoggedIn ? (
          <div className="customer-guest-guard">
            <h4>Misafir erişimiyle devam ediyorsunuz</h4>
            <p>Sipariş geçmişinizi, hesap bilgilerinizi ve kişisel ayarlarınızı görüntülemek için giriş yapmanız gerekir.</p>
            <div className="customer-guest-guard-actions">
              <button type="button" className="primary-button" onClick={() => navigate('/musteri/login', { state: { from: { pathname: '/musteri/hesabim', search: '' } } })}>Giriş Yap</button>
              <button type="button" className="ghost-button" onClick={() => navigate('/musteri/login?register=1', { state: { from: { pathname: '/musteri/hesabim', search: '' } } })}>Kayıt Ol</button>
            </div>
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', padding: '16px', background: '#f8fafc', borderRadius: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#0ea5e9', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', fontWeight: 'bold' }}>{String(normalizeCustomerName(customerUser?.name) || 'M').slice(0, 1).toUpperCase()}</div>
          <div>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '1.1rem' }}>{normalizeCustomerName(customerProfile?.name || customerUser?.name) || 'Müşteri'}</h4>
            <span style={{ fontSize: '0.8rem', color: '#64748b', background: '#e2e8f0', padding: '2px 8px', borderRadius: '12px' }}>Standart Üye</span>
          </div>
        </div>
        <ul className="customer-account-menu">
          {[
            { key: 'shopping-list', label: 'Alışveriş Listem', icon: ListOrdered },
            { key: 'favorites', label: 'Favorilerim', icon: Heart },
            { key: 'gift-cards', label: 'Kayıtlı Hediye Kartları', icon: Gift },
            { key: 'order-history', label: 'Geçmiş Siparişlerim', icon: ReceiptText },
            { key: 'settings', label: 'Ayarlar', icon: Settings },
            { key: 'help', label: 'Yardım', icon: ShieldCheck },
          ].map((item) => (
            <li key={item.key}>
              <button type="button" onClick={() => openAccountPanel(item.key)} className="customer-account-menu-item">
                <span className="left"><item.icon size={16} /> {item.label}</span><ChevronRight size={18} color="#94a3b8" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  const renderGiftCards = () => {
    const cards = Array.isArray(customerProfile?.giftCards) ? customerProfile.giftCards : [];
    return (
      <div className="customer-subpage">
        <section className="customer-section customer-preferences-modern">
          <h3 className="customer-section-title-emphasized" style={{ marginBottom: '16px' }}><Gift size={18} /> Kayıtlı Hediye Kartları</h3>
          {!isCustomerLoggedIn ? (
            <div className="customer-guest-guard">
              <h4>Hediye kartları için giriş gerekli</h4>
              <p>Kayıtlı kartlar kişisel hesap verilerinizde tutulur.</p>
            </div>
          ) : null}
          {cards.length === 0 ? <div className="empty-state-box">Kayıtlı hediye kartı bulunmuyor.</div> : (
            <div className="vertical-product-list">
              {cards.map((card) => {
                const expired = isGiftCardExpired(card);
                return (
                  <article key={card.id || card.code} className="campaign-card" style={{ background: 'linear-gradient(135deg,#0ea5e9,#1d4ed8)', color: '#fff' }}>
                    <strong>{card.name || card.code}</strong>
                    <p style={{ color: '#dbeafe' }}>{joinCustomerMeta([`Kod: ${card.code || '-'}`])}</p>
                    <p className={`customer-gift-card-expiry ${expired ? 'is-expired' : 'is-valid'}`}>{formatGiftCardExpiry(card)}</p>
                    <p style={{ color: '#fff', fontWeight: 700 }}>Bakiye: {formatCurrency(Number(card.balance ?? card.value ?? 0))}</p>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  };

  const renderOrderHistory = () => (
    <div className="customer-subpage">
      <section className="customer-section">
        <h3 className="customer-section-title-emphasized" style={{ marginBottom: '16px' }}><History size={18} /> Geçmiş Siparişlerim</h3>
        {!isCustomerLoggedIn ? (
          <div className="customer-guest-guard">
            <h4>Sipariş geçmişi için giriş gerekli</h4>
            <p>Geçmiş siparişlerinizi görüntülemek için giriş yapın.</p>
          </div>
        ) : null}
        {orderHistory.length === 0 ? <div className="empty-state-box">Geçmiş sipariş bulunmuyor.</div> : (
          <ul className="customer-order-history-list">
            {orderHistory.map((row) => (
              <li key={row.id}>
                <div className="customer-order-history-head">
                  <div className="customer-order-history-primary">
                    <strong>{formatCustomerOrderDisplayId(row.orderNo || row.id)}</strong>
                    <small>{new Date(row.createdAt).toLocaleString('tr-TR')}</small>
                  </div>
                  <div className="customer-order-history-head-actions">
                    <span>{formatCurrency(row.totalAmount)}</span>
                    <button
                      type="button"
                      className="ghost-button customer-order-detail-btn"
                      onClick={() => setOrderDetail(row)}
                      aria-label="Sipariş detayını görüntüle"
                      title="Sipariş detayını görüntüle"
                    >
                      <Eye size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  const renderSettings = () => (
    <div className="customer-subpage">
      <section className="customer-section customer-settings-page-section" style={{ paddingTop: '8px' }}>
        <h3 className="customer-section-title-emphasized" style={{ marginBottom: '10px' }}><Settings size={18} /> Ayarlar</h3>
        {!isCustomerLoggedIn ? (
          <div className="customer-guest-guard">
            <h4>Ayarlar için giriş gerekli</h4>
            <p>Bildirim tercihleri ve hesap güncellemeleri kişiye özeldir.</p>
            <div className="customer-guest-guard-actions">
              <button type="button" className="primary-button" onClick={() => navigate('/musteri/login', { state: { from: { pathname: '/musteri/ayarlar', search: '' } } })}>Giriş Yap</button>
              <button type="button" className="ghost-button" onClick={() => navigate('/musteri/login?register=1', { state: { from: { pathname: '/musteri/ayarlar', search: '' } } })}>Kayıt Ol</button>
            </div>
          </div>
        ) : null}

        <div className="customer-settings-parent">
          <div className="customer-settings-child-card" style={{ padding: '10px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '0.95rem', color: '#0f172a' }}><User size={16} /> Hesap Bilgileri</h4>
            <div className="customer-settings-form" style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
              <label className="customer-settings-field">
                <span style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '3px', display: 'block' }}>Ad Soyad</span>
                <input className="customer-input" style={{ minHeight: '38px', padding: '8px 10px' }} value={settingsDraft.name} onChange={(event) => setSettingsDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ad Soyad" />
              </label>
              <label className="customer-settings-field">
                <span style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '3px', display: 'block' }}>E-posta</span>
                <input className="customer-input" style={{ minHeight: '38px', padding: '8px 10px' }} value={settingsDraft.email} onChange={(event) => setSettingsDraft((current) => ({ ...current, email: event.target.value }))} placeholder="E-posta" />
              </label>
              <label className="customer-settings-field">
                <span style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '3px', display: 'block' }}>Telefon</span>
                <input className="customer-input" style={{ minHeight: '38px', padding: '8px 10px' }} value={settingsDraft.phone} onChange={(event) => setSettingsDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="Telefon" />
              </label>
              <label className="customer-settings-field">
                <span style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '3px', display: 'block' }}>Şifre Değiştir</span>
                <input className="customer-input" style={{ minHeight: '38px', padding: '8px 10px' }} type="password" value={settingsDraft.password} onChange={(event) => setSettingsDraft((current) => ({ ...current, password: event.target.value }))} placeholder="Yeni şifre" />
              </label>
              <button type="button" className="primary-button" onClick={saveCustomerSettings} disabled={isSavingSettings} style={{ marginTop: '8px', width: '100%', justifyContent: 'center' }}>
                <Save size={16} /> {isSavingSettings ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
              </button>
            </div>
          </div>

          <div className="customer-settings-child-card customer-notification-prefs-card">
            <h4 className="customer-notification-prefs-title"><Bell size={16} /> Bildirim Tercihleri</h4>
            <p className="customer-notification-prefs-desc">Fırsatların nerede görüneceğini seçin.</p>
            {notificationPrefs.inAppNotifications === false && notificationPrefs.phoneNotifications === false ? (
              <p className="customer-notification-prefs-desc" role="status">
                Bildirimler kapalı olduğu için yakınlık fırsatları gösterilmiyor.
              </p>
            ) : null}
            <div className="customer-notification-prefs-list">
              <label className="customer-notification-pref-row">
                <span className="customer-notification-pref-copy">
                  <strong>Uygulama İçi Bildirimler</strong>
                  <small>Uygulama açıkken fırsatları ve yakınlık bildirimlerini ekranda göster.</small>
                </span>
                <input
                  type="checkbox"
                  checked={notificationPrefs.inAppNotifications !== false}
                  onChange={(event) => updateNotificationPreference('inAppNotifications', event.target.checked)}
                  aria-label="Uygulama İçi Bildirimler"
                />
              </label>
              <label className="customer-notification-pref-row">
                <span className="customer-notification-pref-copy">
                  <strong>Genel Bildirimler</strong>
                  <small>Telefon bildirimleri ve arka plan uyarılarını göster.</small>
                </span>
                <input
                  type="checkbox"
                  checked={notificationPrefs.phoneNotifications !== false}
                  onChange={(event) => updateNotificationPreference('phoneNotifications', event.target.checked)}
                  aria-label="Genel Bildirimler"
                />
              </label>
            </div>
          </div>

          <div className="customer-settings-child-card" style={{ marginTop: '6px' }}>
            <button type="button" className="customer-logout-button" style={{ width: '100%', padding: '11px', background: '#fee2e2', color: '#dc2626', border: '1px solid #f87171', borderRadius: '12px', fontWeight: 600, fontSize: '0.95rem', display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={handleCustomerLogout}>
              Çıkış Yap
            </button>
          </div>
        </div>
      </section>
    </div>
  );

  const renderHelp = () => (
    <div className="customer-subpage">
      <section className="customer-section">
        <h3 className="customer-section-title-emphasized" style={{ marginBottom: '16px' }}><ShieldCheck size={18} /> Yardım Merkezi</h3>
        <div className="customer-settings-child-card">
          <ul className="customer-help-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <strong style={{ display: 'block', color: '#0f172a', marginBottom: '4px', fontSize: '0.95rem' }}>Hesap ve Giriş</strong>
              <small style={{ color: '#475569', fontSize: '0.85rem' }}>Şifre yenileme, üyelik ve hesap güncelleme adımları.</small>
            </li>
            <li style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <strong style={{ display: 'block', color: '#0f172a', marginBottom: '4px', fontSize: '0.95rem' }}>Sipariş ve Sepet</strong>
              <small style={{ color: '#475569', fontSize: '0.85rem' }}>Sepet yönetimi, sipariş geçmişi ve teslimat süreçleri.</small>
            </li>
            <li style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <strong style={{ display: 'block', color: '#0f172a', marginBottom: '4px', fontSize: '0.95rem' }}>Uygulama Kullanımı</strong>
              <small style={{ color: '#475569', fontSize: '0.85rem' }}>Ürün arama, kategori gezme ve kampanya takibi.</small>
            </li>
            <li style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
              <strong style={{ display: 'block', color: '#0f172a', marginBottom: '4px', fontSize: '0.95rem' }}>Destek İletişim</strong>
              <small style={{ color: '#475569', fontSize: '0.85rem' }}>Destek talebi için mağaza yetkilisine veya müşteri hizmetlerine ulaşın.</small>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );

  const hasRenderableCustomerData = storefrontResolved || products.length > 0 || campaignDefinitions.length > 0;
  if (isLoading && !hasRenderableCustomerData) {
    return <PageLoading pageTitle={view === 'campaigns' ? 'Kampanyalar' : 'Müşteri'} />;
  }

  return (
    <CustomerAppShell>
      <div className="customer-unified-page customer-mobile-layout">
        {renderHeader()}
        {view === 'home' && renderHome()}
        {view === 'search' && renderSearchResults()}
        {view === 'category' && renderCategoryPage()}
        {view === 'notifications' && renderNotifications()}
        {view === 'campaigns' && renderCampaigns()}
        {view === 'favorites' && renderFavorites()}
        {view === 'shopping-list' && renderShoppingList()}
        {view === 'store-hours' && renderStoreHours()}
        {view === 'popular' && renderPopularProducts()}
        {view === 'account' && renderAccount()}
        {view === 'settings' && renderSettings()}
        {view === 'help' && renderHelp()}
        {view === 'gift-cards' && renderGiftCards()}
        {view === 'order-history' && renderOrderHistory()}

        {view === 'detail' && detailProduct ? (
          <CustomerProductDetail
            product={detailProduct}
            stockForecast={detailForecast}
            stockForecastLoading={Boolean(
              detailForecastLoading[detailProductId]
              || (!detailForecastCache[detailProductId] && !detailForecastError[detailProductId])
            )}
            stockForecastError={Boolean(detailForecastError[detailProductId])}
            similarProducts={similarProducts}
            onAddToCart={addToCart}
            onUpdateCartQuantity={updateCartQuantity}
            cartQuantity={Number(cart[String(detailProduct.id)] || 0)}
            onBack={handleDetailBack}
            onDetail={openProduct}
            isFavorite={favoriteIds.includes(String(detailProduct.id))}
            onToggleFavorite={toggleFavorite}
          />
        ) : null}
        {view === 'detail' && !detailProduct && detailLoading ? <div className="customer-loading">Ürün detayı yükleniyor...</div> : null}
        {view === 'cart' ? <CustomerCartFull cartEntries={cartEntries} onUpdateQuantity={updateCartQuantity} onStartShopping={() => navigateTo('search', 'search')} total={cartSubtotal} onAddToShoppingList={addCartToShoppingList} onCheckout={completeShopping} onOpenProduct={openProduct} onClearCart={clearCart} onShowMessage={pushQuickToast} /> : null}
      </div>

      <BottomNavigationDock tabs={BOTTOM_TABS} activeTab={activeBottomTab} onChange={onBottomNavChange} badgesByKey={{ cart: cartItemCount }} />
      {quickToast ? <div className={`customer-quiet-toast ${quickToast.leaving ? 'is-leaving' : 'is-visible'}`}>{quickToast.text}</div> : null}

      {accountPanelData ? (
        <div className="cart-info-modal-overlay" role="dialog" aria-modal="true" aria-label={accountPanelData.title}>
          <div className="cart-info-modal-card">
            <header>
              <h3 style={{ margin: 0 }}>{accountPanelData.title}</h3>
              <button type="button" className="ghost-button" onClick={() => setAccountPanel('')}>Kapat</button>
            </header>
            <div className="cart-info-section">
              {accountPanelData.rows.length === 0 ? (
                <div className="empty-state-box">Bu alanda gösterilecek kayıt bulunmuyor.</div>
              ) : (
                <ul className="notification-list-simple">
                  {accountPanelData.rows.map((row) => (
                    <li key={row.key}>
                      <strong>{row.primary}</strong>
                      <small>{row.secondary}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {orderDetail ? (
        <div className="cart-info-modal-overlay" role="dialog" aria-modal="true" aria-label="Sipariş Detayı">
          <div className="cart-info-modal-card customer-order-detail-modal">
            <header>
              <h3 style={{ margin: 0 }}>Sipariş Detayı</h3>
              <button type="button" className="ghost-button" onClick={() => setOrderDetail(null)}>Kapat</button>
            </header>
            <div className="customer-order-detail-body">
              <div className="customer-order-detail-meta">
                <div>
                  <small>Sipariş No</small>
                  <strong>{formatCustomerOrderDisplayId(orderDetail.orderNo || orderDetail.id)}</strong>
                </div>
                <div>
                  <small>Tarih</small>
                  <strong>{new Date(orderDetail.createdAt).toLocaleString('tr-TR')}</strong>
                </div>
                <div>
                  <small>Toplam</small>
                  <strong>{formatCurrency(orderDetail.totalAmount)}</strong>
                </div>
              </div>
              <ul className="notification-list-simple customer-order-detail-items">
                {(orderDetail.items || []).map((item, index) => (
                  <li key={`${orderDetail.id}-line-${index}`}>
                    <strong>{item.productName}</strong>
                    <small>{joinCustomerMeta([`${item.quantity} ${repairCustomerUiText(item.unit, 'adet')}`, formatCurrency(Number(item.unitPrice || 0))])}</small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {authPrompt ? (
        <div className="cart-info-modal-overlay" role="dialog" aria-modal="true" aria-label="Giriş Gerekli">
          <div className="cart-info-modal-card customer-auth-required-modal">
            <header className="customer-auth-required-head">
              <div className="customer-auth-required-title-wrap">
                <span className="customer-auth-required-icon"><Lock size={16} /></span>
                <h3 style={{ margin: 0 }}>Giriş Gerekli</h3>
              </div>
              <button type="button" className="ghost-button" onClick={() => setAuthPrompt(null)}>Kapat</button>
            </header>
            <div className="cart-info-section">
              <p className="customer-auth-required-text">{authPrompt.message}</p>
              <div className="customer-auth-required-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => navigate('/musteri/login', { state: { from: authPrompt.from } })}
                >
                  Giriş Yap
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => navigate('/musteri/login?register=1', { state: { from: authPrompt.from } })}
                >
                  Kayıt Ol
                </button>
              </div>
              <button type="button" className="customer-auth-required-later" onClick={() => setAuthPrompt(null)}>Misafir olarak devam et</button>
            </div>
          </div>
        </div>
      ) : null}
      {helpModalOpen ? (
        <div className="cart-info-modal-overlay customer-help-modal-overlay" role="dialog" aria-modal="true" aria-label="Yardım ve Destek" onClick={() => setHelpModalOpen(false)}>
          <div className="cart-info-modal-card customer-help-modal-card" onClick={(event) => event.stopPropagation()}>
            <header className="customer-help-modal-head">
              <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: '8px' }}><LifeBuoy size={16} /> Yardım ve Destek</h3>
              <button type="button" className="ghost-button" onClick={() => setHelpModalOpen(false)}>Kapat</button>
            </header>
            <div className="cart-info-section customer-help-modal-body">
              <p className="customer-help-modal-intro">
                <strong>Bize ulaşın</strong>
                <span>Hesap, sipariş veya uygulama kullanımıyla ilgili destek için mağaza iletişim kanallarını kullanabilirsiniz.</span>
              </p>
              <ul className="notification-list-simple customer-help-contact-list">
                <li>
                  <span className="customer-help-contact-icon"><Mail size={14} /></span>
                  <strong>E-posta</strong>
                  {supportMailHref ? <a href={supportMailHref}>{supportContact.email}</a> : <small>Tanımlı değil</small>}
                </li>
                <li>
                  <span className="customer-help-contact-icon"><Phone size={14} /></span>
                  <strong>Telefon</strong>
                  {supportPhoneHref ? <a href={supportPhoneHref}>{supportContact.phone}</a> : <small>Tanımlı değil</small>}
                </li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}
      <ConfirmModal
        isOpen={clearNotificationsConfirmOpen}
        title="Bildirimler temizlensin mi?"
        description="Bu işlem müşteri bildirim görünümünüzdeki bildirimleri temizler."
        confirmText="Temizle"
        cancelText="Vazgeç"
        tone="danger"
        onConfirm={handleClearNotifications}
        onCancel={() => setClearNotificationsConfirmOpen(false)}
      />
    </CustomerAppShell>
  );
}
