export const RETURN_REASON_LABELS = {
  customer_request: 'Müşteri Talebi',
  wrong_product: 'Yanlış Ürün',
  defective: 'Kusurlu Ürün',
  damaged: 'Hasarlı Ürün',
  expired: 'Son Kullanma Tarihi Geçmiş',
  customer_changed_mind: 'Müşteri Vazgeçti',
  other: 'Diğer',
};

export const STORAGE_TYPE_LABELS = {
  Ortam: 'Ortam',
  ortam: 'Ortam',
  ambient: 'Ortam',
  cold_chain: 'Soğuk Zincir',
  cold: 'Soğuk Zincir',
  freezer: 'Donuk / Dondurucu',
  frozen: 'Donuk / Dondurucu',
  mixed: 'Karma',
};

export const DEPOT_LOCATION_LABELS = {
  'OVR-FROZEN': 'Donuk Ortak Alan',
  'OVR-COLD': 'Soğuk Ortak Alan',
  'OVR-AMBIENT': 'Ortam Ortak Alan',
  'DIRECT-SUPPLY': 'Doğrudan Tedarik',
  'NO-BACKROOM': 'Arka Depo Yok',
};

export const PERMISSION_LABELS = {
  'report:view': 'Rapor Görüntüleme Yetkisi',
  'report:export': 'Rapor Dışa Aktarma Yetkisi',
  'pos:view': 'POS / Kasa Görüntüleme Yetkisi',
  'pos:return': 'POS İade Yetkisi',
  'product:view': 'Ürün Görüntüleme Yetkisi',
  'product:update': 'Ürün Güncelleme Yetkisi',
  'category:view': 'Kategori Görüntüleme Yetkisi',
  'supplier:view': 'Tedarikçi Görüntüleme Yetkisi',
  'section:view': 'Lokasyon Görüntüleme Yetkisi',
  'stock:view': 'Stok Görüntüleme Yetkisi',
  'stock:update': 'Stok Güncelleme Yetkisi',
  'purchase:view': 'Satın Alma Görüntüleme Yetkisi',
  'purchase:create': 'Satın Alma Oluşturma Yetkisi',
  'purchase:approve': 'Satın Alma Onay Yetkisi',
  'task:view': 'Görev Görüntüleme Yetkisi',
  'task:create': 'Görev Oluşturma Yetkisi',
  'task:update': 'Görev Güncelleme Yetkisi',
  'esl:view': 'Etiket Yönetimi Görüntüleme Yetkisi',
  'esl:update': 'Etiket Yönetimi Güncelleme Yetkisi',
  'user:view': 'Personel Yönetimi Görüntüleme Yetkisi',
  'user:create': 'Personel Oluşturma Yetkisi',
  'user:update': 'Personel Güncelleme Yetkisi',
  'settings:view': 'Sistem Ayarları Görüntüleme Yetkisi',
  'settings:update': 'Sistem Ayarları Güncelleme Yetkisi',
  'notification:view': 'Bildirim Merkezi Görüntüleme Yetkisi',
  'notification:manage': 'Bildirim Yönetimi Yetkisi',
  'access_request:view_all': 'Erişim Taleplerini Görüntüleme Yetkisi',
  'access_request:approve': 'Erişim Talebi Onay Yetkisi',
  'access_request:reject': 'Erişim Talebi Reddetme Yetkisi',
  'temporary_grant:revoke': 'Geçici Yetki İptal Yetkisi',
  'transfer_request:view': 'Transfer Talebi Görüntüleme Yetkisi',
  'transfer_request:manage': 'Transfer Talebi Yönetimi',
};

export const STOCK_LOCATION_LABELS = {
  depo: 'Depo',
  reyon: 'Reyon',
  pos: 'Müşteri / POS',
  customer: 'Müşteri',
  customer_return: 'Müşteri İadesi',
  iade_alani: 'İade Alanı',
  kalite_kontrol: 'Kalite Kontrol',
};

const LOCATION_FALLBACK_LABELS = {
  depo: 'Depo',
  reyon: 'Reyon',
};

const normalizePermissionKey = (value) => String(value || '').trim().toLowerCase();
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const cleanTurkishDisplayText = (value, fallback = '-') => {
  const raw = normalizeTurkishText(String(value ?? '').trim());
  if (!raw) return fallback;
  return raw
    .replace(/\bSo\?uk\b/gi, 'Soğuk')
    .replace(/\bMa\?aza\b/gi, 'Mağaza')
    .replace(/\bUrun\b/gi, 'Ürün')
    .replace(/\burun\b/gi, 'ürün')
    .replace(/\bDepo\b/g, 'Depo')
    .replace(/\s+/g, ' ')
    .trim();
};

export const cleanSectionDisplayName = (value, fallback = '-') => {
  const text = cleanTurkishDisplayText(value, '');
  const cleaned = text
    .replace(/\s*\([^)]*(?:karma|ambiyans|ambiyans|°c|\/|❄|soğuk|sıcaklık|derece)[^)]*\)\s*/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
};

export const normalizeStorageTypeCode = (value, fallback = 'Ortam') => {
  const raw = String(value || '').trim();
  const normalized = raw.toLocaleLowerCase('tr-TR');
  if (['cold_chain', 'soguk_zincir', 'soguk zincir', 'soğuk zincir', 'cold'].includes(normalized)) return 'cold_chain';
  if (['freezer', 'frozen', 'dondurucu', 'donuk'].includes(normalized)) return 'freezer';
  if (['ambient', 'ortam'].includes(normalized)) return 'Ortam';
  return raw || fallback;
};

export const formatReturnReasonLabel = (value, fallback = '-') => {
  const key = String(value || '').trim();
  if (!key) return fallback;
  return RETURN_REASON_LABELS[key] || key;
};

export const formatStorageTypeLabel = (value, fallback = '-') => {
  const code = normalizeStorageTypeCode(value, '');
  if (!code) return fallback;
  return cleanTurkishDisplayText(STORAGE_TYPE_LABELS[code] || STORAGE_TYPE_LABELS[String(code).toLocaleLowerCase('tr-TR')] || code, fallback);
};

export const formatDepotLocationLabel = (value, fallback = '-') => {
  const code = String(value || '').trim();
  if (!code) return fallback;
  return cleanTurkishDisplayText(DEPOT_LOCATION_LABELS[code] || code, fallback);
};

export const formatPermissionLabel = (value, fallback = '-') => {
  const key = normalizePermissionKey(value);
  if (!key) return fallback;
  if (PERMISSION_LABELS[key]) return PERMISSION_LABELS[key];

  return key
    .split(':')
    .map((part) => part.replace(/_/g, ' '))
    .map((part) => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1))
    .join(' - ');
};

export const replacePermissionCodesInText = (value, fallback = '-') => {
  const text = String(value || '').trim();
  if (!text) return fallback;

  const keys = Object.keys(PERMISSION_LABELS).sort((left, right) => right.length - left.length);
  return keys.reduce((result, key) => {
    const pattern = new RegExp(`(^|[^a-z0-9:_-])(${escapeRegex(key)})(?=$|[^a-z0-9:_-])`, 'gi');
    return result.replace(pattern, (_match, prefix) => `${prefix}${PERMISSION_LABELS[key]}`);
  }, text);
};

export const formatStockLocationLabel = (value, fallback = '-') => {
  const key = String(value || '').trim();
  if (!key) return fallback;
  return STOCK_LOCATION_LABELS[key] || LOCATION_FALLBACK_LABELS[key] || key;
};

export const formatMovementRouteLabel = (movement = {}, fallback = '-') => {
  const reasonCode = String(movement?.reasonCode || '').trim().toLowerCase();
  const fromLabel = String(movement?.fromLocationLabel || '').trim() || formatStockLocationLabel(movement?.fromLocation, '');
  const toLabel = String(movement?.toLocationLabel || '').trim() || formatStockLocationLabel(movement?.toLocation, '');
  const locationLabel = String(movement?.locationLabel || '').trim() || formatStockLocationLabel(movement?.location, '');

  if (fromLabel && toLabel) {
    return `${fromLabel} -> ${toLabel}`;
  }

  if (reasonCode === 'customer_return' && toLabel) {
    return `Müşteri / POS -> ${toLabel}`;
  }

  if (locationLabel) return locationLabel;
  return fallback;
};
import { normalizeTurkishText } from './turkishText.js';
