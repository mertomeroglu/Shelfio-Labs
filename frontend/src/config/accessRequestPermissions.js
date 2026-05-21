import { PAGE_ACCESS_RULES } from './pageAccessRules.js';

export const PERMISSION_LABELS = {
  'report:view': 'Rapor Görüntüleme Yetkisi',
  'report:export': 'Rapor Dışa Aktarma Yetkisi',
  'pos:view': 'POS / Kasa Görüntüleme Yetkisi',
  'product:view': 'Ürün Görüntüleme Yetkisi',
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
  'user:update': 'Personel Güncelleme Yetkisi',
  'settings:view': 'Sistem Ayarları Görüntüleme Yetkisi',
  'settings:update': 'Sistem Ayarları Güncelleme Yetkisi',
  'access_request:view_all': 'Erişim Taleplerini Görüntüleme Yetkisi',
  'access_request:approve': 'Erişim Talebi Onay Yetkisi',
  'access_request:reject': 'Erişim Talebi Reddetme Yetkisi',
  'temporary_grant:revoke': 'Geçici Yetki İptal Yetkisi',
  'transfer_request:view': 'Transfer Talebi Görüntüleme Yetkisi',
  'transfer_request:manage': 'Transfer Talebi Yönetimi',
  'notification:view': 'Bildirim Merkezi Görüntüleme Yetkisi',
};

export const REQUEST_PERMISSION_OPTIONS = [
  'report:view',
  'report:export',
  'pos:view',
  'product:view',
  'category:view',
  'supplier:view',
  'section:view',
  'stock:view',
  'stock:update',
  'purchase:view',
  'purchase:create',
  'purchase:approve',
  'task:view',
  'task:update',
  'esl:view',
  'esl:update',
  'user:view',
  'user:update',
  'settings:view',
  'settings:update',
  'access_request:view_all',
  'access_request:approve',
  'transfer_request:view',
  'transfer_request:manage',
  'notification:view',
].map((value) => ({
  value,
  label: PERMISSION_LABELS[value],
}));

export const formatPageAccessRequestLabel = (pageLabel = '') => {
  const label = String(pageLabel || '').trim();
  return label ? `${label} sayfası için tam erişim yetkisi` : 'Sayfa için tam erişim yetkisi';
};

export const PAGE_ACCESS_REQUEST_OPTIONS = PAGE_ACCESS_RULES
  .filter((rule) => rule.path && rule.permission && rule.label)
  .map((rule) => ({
    value: rule.path,
    pagePath: rule.path,
    pageLabel: rule.label,
    permission: rule.permission,
    label: formatPageAccessRequestLabel(rule.label),
  }));

const pageOptionByPath = new Map(PAGE_ACCESS_REQUEST_OPTIONS.map((option) => [option.pagePath, option]));

const normalizePermissionKey = (value) => String(value || '').trim().toLowerCase();
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function getPageAccessRequestOption(pagePath = '') {
  return pageOptionByPath.get(String(pagePath || '').trim()) || PAGE_ACCESS_REQUEST_OPTIONS[0] || null;
}

export function getAccessRequestDisplayLabel(request = {}) {
  const pageAccess = request?.pageAccess && typeof request.pageAccess === 'object'
    ? request.pageAccess
    : request?.payload?.pageAccess;
  const pageLabel = String(pageAccess?.pageLabel || pageAccess?.label || '').trim();
  if (pageLabel) return formatPageAccessRequestLabel(pageLabel);

  const permission = normalizePermissionKey(request?.permission || request);
  const pageRule = PAGE_ACCESS_RULES.find((rule) => normalizePermissionKey(rule.permission) === permission);
  if (pageRule?.label) return formatPageAccessRequestLabel(pageRule.label);

  return getPermissionLabel(permission);
}

export function getPermissionLabel(permission) {
  const key = normalizePermissionKey(permission);
  if (!key) return '-';
  if (PERMISSION_LABELS[key]) return PERMISSION_LABELS[key];

  return key
    .split(':')
    .map((part) => part.replace(/_/g, ' '))
    .map((part) => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1))
    .join(' - ');
}

export function replacePermissionCodesInText(value, fallback = '-') {
  const text = String(value || '').trim();
  if (!text) return fallback;

  const keys = Object.keys(PERMISSION_LABELS).sort((left, right) => right.length - left.length);
  return keys.reduce((result, key) => {
    const pattern = new RegExp(`(^|[^a-z0-9:_-])(${escapeRegex(key)})(?=$|[^a-z0-9:_-])`, 'gi');
    return result.replace(pattern, (_match, prefix) => `${prefix}${PERMISSION_LABELS[key]}`);
  }, text);
}

export function getPermissionOptionsWithInitial(initialPermission = '') {
  const normalizedInitial = normalizePermissionKey(initialPermission);
  if (!normalizedInitial) return REQUEST_PERMISSION_OPTIONS;
  if (REQUEST_PERMISSION_OPTIONS.some((item) => item.value === normalizedInitial)) {
    return REQUEST_PERMISSION_OPTIONS;
  }
  return [
    { value: normalizedInitial, label: getPermissionLabel(normalizedInitial) },
    ...REQUEST_PERMISSION_OPTIONS,
  ];
}
