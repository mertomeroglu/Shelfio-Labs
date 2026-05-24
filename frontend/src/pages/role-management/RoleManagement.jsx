import { useEffect, useMemo, useState } from 'react';
import { Plus, ShieldCheck, Users, Edit3, Eye, AlertTriangle, UserRound } from 'lucide-react';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import FormModal from '../../components/FormModal.jsx';
import PageAccessGuard from '../../components/PageAccessGuard.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PinGate from '../../components/PinGate.jsx';
import Toast from '../../components/Toast.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { settingsService } from '../../services/settingsService.js';
import { userService } from '../../services/userService.js';
import { hasPermission, ROLE_PERMISSIONS } from '../../config/permissions.js';

const DEFAULT_DEPARTMENTS = [
  { id: 'sales', name: 'Satış', description: 'Kasa, müşteri teması ve saha satış akışları.', isActive: true },
  { id: 'operations', name: 'Operasyon', description: 'Stok, lokasyon ve transfer operasyonları.', isActive: true },
  { id: 'finance', name: 'Finans', description: 'Raporlama, sipariş takibi ve mali görünürlük.', isActive: true },
  { id: 'it', name: 'IT', description: 'Teknik ayarlar, izleme ve erişim yönetimi.', isActive: true },
  { id: 'management', name: 'Yönetim', description: 'Kurumsal yönetim, tam erişim ve onay süreçleri.', isActive: true },
];

const DEPARTMENT_PERMISSION_GROUP_ORDER = [
  'Genel',
  'Satış',
  'Ürün Yönetimi',
  'Tedarik & Satın Alma',
  'Talep & Analiz',
  'Sistem Yönetimi',
];

const getDepartmentPermissionGroup = (moduleName = '') => {
  const module = String(moduleName || '').toLocaleLowerCase('tr-TR');
  if (module.includes('kasa') || module.includes('pos') || module.includes('müşteri')) return 'Satış';
  if (module.includes('ürün') || module.includes('kategori') || module.includes('stok') || module.includes('reyon') || module.includes('esl')) return 'Ürün Yönetimi';
  if (module.includes('tedarik') || module.includes('satın') || module.includes('transfer')) return 'Tedarik & Satın Alma';
  if (module.includes('talep') || module.includes('rapor') || module.includes('görev')) return 'Talep & Analiz';
  if (module.includes('sistem') || module.includes('personel') || module.includes('yetki') || module.includes('geçici') || module.includes('bildirim')) return 'Sistem Yönetimi';
  return 'Genel';
};

const BASE_PERMISSION_CATALOG = [
  { key: 'access_request:create', module: 'Erişim Talebi', action: 'Oluştur', label: 'Erişim talebi oluşturma' },
  { key: 'access_request:view_own', module: 'Erişim Talebi', action: 'Kendi Talepleri', label: 'Kendi taleplerini görüntüleme' },
  { key: 'access_request:view_all', module: 'Erişim Talebi', action: 'Tümünü Gör', label: 'Tüm erişim taleplerini görüntüleme' },
  { key: 'access_request:approve', module: 'Erişim Talebi', action: 'Onayla', label: 'Erişim talebi onaylama' },
  { key: 'access_request:reject', module: 'Erişim Talebi', action: 'Reddet', label: 'Erişim talebi reddetme' },
  { key: 'temporary_grant:revoke', module: 'Geçici Yetki', action: 'İptal', label: 'Geçici erişim iptali' },
  { key: 'permission:effective_view', module: 'Yetki', action: 'Gör', label: 'Etkin yetkileri görüntüleme' },
  { key: 'category:view', module: 'Kategori', action: 'Gör', label: 'Kategori görüntüleme' },
  { key: 'category:create', module: 'Kategori', action: 'Oluştur', label: 'Kategori oluşturma' },
  { key: 'category:update', module: 'Kategori', action: 'Düzenle', label: 'Kategori düzenleme' },
  { key: 'category:delete', module: 'Kategori', action: 'Sil', label: 'Kategori silme' },
  { key: 'supplier:view', module: 'Tedarikçi', action: 'Gör', label: 'Tedarikçi görüntüleme' },
  { key: 'supplier:create', module: 'Tedarikçi', action: 'Oluştur', label: 'Tedarikçi oluşturma' },
  { key: 'supplier:update', module: 'Tedarikçi', action: 'Düzenle', label: 'Tedarikçi düzenleme' },
  { key: 'supplier:delete', module: 'Tedarikçi', action: 'Sil', label: 'Tedarikçi silme' },
  { key: 'product:view', module: 'Ürün', action: 'Gör', label: 'Ürün görüntüleme' },
  { key: 'product:create', module: 'Ürün', action: 'Oluştur', label: 'Ürün oluşturma' },
  { key: 'product:update', module: 'Ürün', action: 'Düzenle', label: 'Ürün düzenleme' },
  { key: 'product:delete', module: 'Ürün', action: 'Sil', label: 'Ürün silme' },
  { key: 'stock:view', module: 'Stok', action: 'Gör', label: 'Stok görüntüleme' },
  { key: 'stock:update', module: 'Stok', action: 'Güncelle', label: 'Stok güncelleme' },
  { key: 'transfer_request:create', module: 'Transfer', action: 'Oluştur', label: 'Transfer talebi oluşturma' },
  { key: 'transfer_request:view', module: 'Transfer', action: 'Gör', label: 'Transfer taleplerini görüntüleme' },
  { key: 'transfer_request:manage', module: 'Transfer', action: 'Yönet', label: 'Transfer taleplerini yönetme' },
  { key: 'report:view', module: 'Raporlar', action: 'Gör', label: 'Rapor görüntüleme' },
  { key: 'report:export', module: 'Raporlar', action: 'Dışa Aktar', label: 'Rapor dışa aktarma' },
  { key: 'task:view', module: 'Görev', action: 'Gör', label: 'Görev görüntüleme' },
  { key: 'task:create', module: 'Görev', action: 'Oluştur', label: 'Görev oluşturma' },
  { key: 'task:update', module: 'Görev', action: 'Düzenle', label: 'Görev düzenleme' },
  { key: 'task:delete', module: 'Görev', action: 'Sil', label: 'Görev silme' },
  { key: 'task:comment', module: 'Görev', action: 'Yorum', label: 'Göreve yorum ekleme' },
  { key: 'section:view', module: 'Reyon', action: 'Gör', label: 'Reyon görüntüleme' },
  { key: 'section:create', module: 'Reyon', action: 'Oluştur', label: 'Reyon oluşturma' },
  { key: 'section:update', module: 'Reyon', action: 'Düzenle', label: 'Reyon düzenleme' },
  { key: 'section:delete', module: 'Reyon', action: 'Sil', label: 'Reyon silme' },
  { key: 'user:view', module: 'Personel', action: 'Gör', label: 'Personel görüntüleme' },
  { key: 'user:create', module: 'Personel', action: 'Oluştur', label: 'Personel oluşturma' },
  { key: 'user:update', module: 'Personel', action: 'Düzenle', label: 'Personel düzenleme' },
  { key: 'settings:view', module: 'Sistem', action: 'Gör', label: 'Sistem ayarlarını görüntüleme' },
  { key: 'settings:update', module: 'Sistem', action: 'Düzenle', label: 'Sistem ayarlarını düzenleme' },
  { key: 'esl:view', module: 'ESL', action: 'Gör', label: 'ESL görüntüleme' },
  { key: 'esl:update', module: 'ESL', action: 'Düzenle', label: 'ESL güncelleme' },
  { key: 'pos:view', module: 'Kasa (POS)', action: 'Gör', label: 'Kasa ekranlarını görüntüleme' },
  { key: 'pos:sale', module: 'Kasa (POS)', action: 'Satış', label: 'Satış işlemi yapma' },
  { key: 'pos:return', module: 'Kasa (POS)', action: 'İade', label: 'İade işlemi yapma' },
  { key: 'pos:desk_manage', module: 'Kasa (POS)', action: 'Kasa Yönetimi', label: 'Kasa yönetimi' },
  { key: 'purchase:view', module: 'Satın Alma', action: 'Gör', label: 'Satın alma ekranlarını görüntüleme' },
  { key: 'purchase:create', module: 'Satın Alma', action: 'Oluştur', label: 'Sipariş oluşturma' },
  { key: 'purchase:update', module: 'Satın Alma', action: 'Düzenle', label: 'Sipariş güncelleme' },
  { key: 'purchase:approve', module: 'Satın Alma', action: 'Onayla', label: 'Sipariş onaylama' },
  { key: 'notification:view', module: 'Bildirim', action: 'Gör', label: 'Bildirim görüntüleme' },
  { key: 'notification:manage', module: 'Bildirim', action: 'Yönet', label: 'Bildirim yönetimi' },
];

const DEFAULT_ROLE_DEFINITIONS = [
  { key: 'admin', label: 'Yönetici', permissions: BASE_PERMISSION_CATALOG.map((item) => item.key) },
  {
    key: 'user',
    label: 'Personel',
    permissions: ROLE_PERMISSIONS.user,
  },
  {
    key: 'cashier',
    label: 'Kasiyer',
    description: 'Kasalarda satış ve iade işlemlerini yürütür.',
    permissions: ROLE_PERMISSIONS.cashier,
  },
  {
    key: 'viewer',
    label: 'Görüntüleyici',
    description: 'Operasyon ekranlarını yalnızca görüntüler.',
    permissions: ROLE_PERMISSIONS.viewer,
  },
  {
    key: 'depo_personeli',
    label: 'Depo Personeli',
    description: 'Transfer ve depo operasyonlarını yönetir.',
    permissions: ROLE_PERMISSIONS.depo_personeli,
  },
  { key: 'komisyon_b', label: 'Komisyon B', description: 'Yönetim düzeyi yetki rolü.', permissions: BASE_PERMISSION_CATALOG.map((item) => item.key) },
  { key: 'komisyon_c', label: 'Komisyon C', description: 'Yönetim düzeyi yetki rolü.', permissions: BASE_PERMISSION_CATALOG.map((item) => item.key) },
  { key: 'komisyon_v', label: 'Komisyon V', description: 'Yönetim düzeyi yetki rolü.', permissions: BASE_PERMISSION_CATALOG.map((item) => item.key) },
];

const ROLE_LABELS = {
  admin: 'Yönetici',
  user: 'Personel',
  cashier: 'Kasiyer',
  viewer: 'Görüntüleyici',
  depo_personeli: 'Depo Personeli',
  komisyon_b: 'Komisyon B',
  komisyon_c: 'Komisyon C',
  komisyon_v: 'Komisyon V',
};

const DEFAULT_ROLE_DEPARTMENTS = {
  admin: ['Yönetim'],
  user: ['Operasyon'],
  cashier: ['Satış'],
  viewer: ['Operasyon'],
  depo_personeli: ['Operasyon'],
  komisyon_b: ['Yönetim'],
  komisyon_c: ['Yönetim'],
  komisyon_v: ['Yönetim'],
};

const LEGACY_PERMISSION_ALIASES = {
  orders_create: 'purchase:create',
  orders_approve: 'purchase:approve',
  reports_view: 'report:view',
  users_manage: 'user:update',
  settings_manage: 'settings:update',
  products_view: 'product:view',
  products_edit: 'product:update',
  products_delete: 'product:delete',
  suppliers_manage: 'supplier:update',
  categories_manage: 'category:update',
  sections_manage: 'section:update',
  esl_manage: 'esl:update',
  pos_access: 'pos:view',
  tasks_manage: 'task:update',
  stock_in: 'stock:update',
  stock_out: 'stock:update',
  stock_adjust: 'stock:update',
  dashboard_view: 'report:view',
};

const MODULE_LABELS = {
  access_request: 'Erişim Talebi',
  temporary_grant: 'Geçici Yetki',
  permission: 'Yetki',
  category: 'Kategori',
  supplier: 'Tedarikçi',
  product: 'Ürün',
  stock: 'Stok',
  transfer_request: 'Transfer',
  report: 'Raporlar',
  task: 'Görev',
  section: 'Reyon',
  user: 'Kullanıcı',
  settings: 'Sistem',
  esl: 'ESL',
  pos: 'POS',
  purchase: 'Satın Alma',
  notification: 'Bildirim',
};

const ACTION_LABELS = {
  view: 'Gör',
  create: 'Oluştur',
  update: 'Düzenle',
  delete: 'Sil',
  approve: 'Onayla',
  reject: 'Reddet',
  revoke: 'İptal',
  manage: 'Yönet',
  effective_view: 'Etkin Görünüm',
  sale: 'Satış',
  return: 'İade',
  desk_manage: 'Kasa Yönetimi',
  comment: 'Yorum',
};

const humanizeToken = (value) => String(value || '')
  .split(/[_\s-]+/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toLocaleUpperCase('tr-TR') + part.slice(1))
  .join(' ');

const toPermissionMeta = (key) => {
  const normalized = String(key || '').trim();
  if (!normalized) return null;
  const [moduleRaw, actionRaw = 'manage'] = normalized.split(':');
  if (!actionRaw) {
    return { key: normalized, module: 'Genel', action: 'Yetki', label: normalized };
  }
  const module = MODULE_LABELS[moduleRaw] || humanizeToken(moduleRaw);
  const action = ACTION_LABELS[actionRaw] || humanizeToken(actionRaw);
  return { key: normalized, module, action, label: `${module} ${action}` };
};

const buildPermissionCatalog = (roleDefinitions = [], users = []) => {
  const catalogByKey = new Map(BASE_PERMISSION_CATALOG.map((item) => [item.key, item]));
  const addPermission = (permissionKey) => {
    const normalized = String(permissionKey || '').trim();
    if (!normalized || normalized === '*') return;
    const canonical = LEGACY_PERMISSION_ALIASES[normalized] || normalized;
    if (catalogByKey.has(canonical)) return;
    const meta = toPermissionMeta(canonical);
    if (meta) catalogByKey.set(meta.key, meta);
  };

  (roleDefinitions || []).forEach((role) => {
    (role?.permissions || []).forEach(addPermission);
  });
  (users || []).forEach((item) => {
    (item?.effectivePermissions || []).forEach(addPermission);
    (item?.specialPermissions || []).forEach(addPermission);
  });

  return Array.from(catalogByKey.values()).sort((left, right) => left.module.localeCompare(right.module, 'tr') || left.action.localeCompare(right.action, 'tr'));
};

const normalizeRoleKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const normalizePermissions = (permissions, allPermissionKeys = []) => {
  const set = new Set();
  (permissions || []).forEach((permission) => {
    if (permission === '*') {
      allPermissionKeys.forEach((key) => set.add(key));
      return;
    }
    if (permission === 'stock_ops') {
      set.add(LEGACY_PERMISSION_ALIASES.stock_in);
      return;
    }
    if (permission) {
      set.add(LEGACY_PERMISSION_ALIASES[permission] || permission);
    }
  });
  return Array.from(set);
};

const getRiskMeta = (permissions, allPermissionKeys = []) => {
  const set = new Set(normalizePermissions(permissions, allPermissionKeys));
  if (['settings:update', 'user:update', 'product:delete', 'purchase:approve', 'access_request:approve', 'access_request:reject'].some((item) => set.has(item))) {
    return { label: 'Kritik', className: 'risk-critical' };
  }
  if (['product:update', 'stock:update', 'purchase:create', 'task:update', 'supplier:update', 'pos:sale', 'transfer_request:manage'].some((item) => set.has(item))) {
    return { label: 'Orta', className: 'risk-medium' };
  }
  return { label: 'Düşük', className: 'risk-low' };
};

const getCriticalWarnings = (permissions, allPermissionKeys = []) => {
  const set = new Set(normalizePermissions(permissions, allPermissionKeys));
  const warnings = [];
  if (set.has('product:delete')) warnings.push('Bu rol silme yetkisine sahip.');
  if (set.has('settings:update')) warnings.push('Bu rol sistem ayarlarına erişebiliyor.');
  if (set.has('user:update')) warnings.push('Bu rol kullanıcı yetkilerini yönetebiliyor.');
  if (set.has('access_request:approve') || set.has('access_request:reject')) warnings.push('Bu rol erişim taleplerini onaylayıp reddedebiliyor.');
  return warnings;
};

const normalizeRoleDefinitions = (definitions, allPermissionKeys = []) => {
  const map = new Map();
  (definitions || []).forEach((item) => {
    const key = normalizeRoleKey(item?.key || item?.label);
    if (!key) return;
    map.set(key, {
      key,
      label: String(item?.label || ROLE_LABELS[key] || key),
      description: String(item?.description || ''),
      permissions: normalizePermissions(item?.permissions, allPermissionKeys),
    });
  });
  return Array.from(map.values());
};

const createRoleDraft = () => ({
  key: '',
  label: '',
  description: '',
  permissions: [],
  departments: [],
});

const normalizeRoleDraftForCompare = (draft = {}, allPermissionKeys = []) => ({
  key: normalizeRoleKey(draft.key || draft.label),
  label: String(draft.label || '').trim(),
  description: String(draft.description || '').trim(),
  permissions: normalizePermissions(draft.permissions, allPermissionKeys).sort(),
  departments: Array.from(new Set((draft.departments || []).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr')),
});

const resolveDefaultDepartments = (roleKey) => {
  const normalized = normalizeRoleKey(roleKey);
  const preferred = DEFAULT_ROLE_DEPARTMENTS[normalized];
  if (Array.isArray(preferred) && preferred.length) {
    return preferred;
  }
  return ['Operasyon'];
};

const sanitizeDepartments = (departments = [], availableDepartments = DEFAULT_DEPARTMENTS.map((item) => item.name)) => {
  const allowed = new Set(availableDepartments);
  return Array.from(new Set((departments || []).filter((item) => allowed.has(item))));
};

const HIDDEN_ROLE_KEYS = new Set(['system']);

const DEFAULT_DEPARTMENT_PERMISSION_RULES = {
  'Satış': {
    allow: ['pos:view', 'pos:sale', 'pos:return', 'notification:view', 'esl:view'],
    deny: ['settings:update', 'user:create', 'user:update', 'access_request:approve', 'access_request:reject', 'temporary_grant:revoke', 'transfer_request:manage', 'section:update', 'stock:update'],
  },
  Operasyon: {
    allow: ['stock:view', 'stock:update', 'section:view', 'section:update', 'transfer_request:view', 'transfer_request:manage', 'task:view', 'task:create', 'task:update', 'notification:view'],
    deny: ['pos:sale', 'pos:return', 'settings:update', 'user:create', 'user:update', 'access_request:approve', 'access_request:reject'],
  },
  Finans: {
    allow: ['report:view', 'report:export', 'purchase:view', 'notification:view'],
    deny: ['pos:view', 'pos:sale', 'pos:return', 'stock:update', 'section:update', 'settings:update', 'user:create', 'user:update'],
  },
  IT: {
    allow: ['settings:view', 'settings:update', 'notification:view', 'notification:manage', 'user:view', 'user:update', 'permission:effective_view'],
    deny: ['pos:sale', 'pos:return', 'purchase:approve'],
  },
  'Yönetim': {
    allow: ['*'],
    deny: [],
  },
};

const ACCESS_SCOPE_GROUPS = [
  { label: 'Dashboard', permission: 'report:view' },
  { label: 'POS / Kasa', permission: 'pos:view' },
  { label: 'Ürünler', permission: 'product:view' },
  { label: 'Kategoriler', permission: 'category:view' },
  { label: 'Eşleşmeler', permission: 'supplier:view' },
  { label: 'Lokasyon Yönetimi', permission: 'section:view' },
  { label: 'Stok İşlemleri', permission: 'stock:view' },
  { label: 'Tedarikçiler', permission: 'supplier:view' },
  { label: 'Sipariş Oluştur', permission: 'purchase:create' },
  { label: 'Sipariş Takibi', permission: 'purchase:view' },
  { label: 'Fiyat & Talep Analizi', permission: 'report:view' },
  { label: 'Kampanya Yönetimi', permission: 'settings:update' },
  { label: 'Sipariş Önerileri', permission: 'purchase:view' },
  { label: 'Raporlar', permission: 'report:view' },
  { label: 'Görev Planlama', permission: 'task:view' },
  { label: 'Etiket Yönetimi', permission: 'esl:view' },
  { label: 'Personel Yönetimi', permission: 'user:view' },
  { label: 'Müşteri Yönetimi', permission: 'user:view' },
  { label: 'Rol Yönetimi', permission: 'settings:update' },
  { label: 'Taleplerim', permission: 'access_request:view_own' },
  { label: 'Erişim Talepleri', permission: 'access_request:view_all' },
];

const normalizeDepartmentName = (value, fallbackRole = 'user') => {
  const source = String(value || '').trim();
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (raw === 'satış' || raw === 'satis') return 'Satış';
  if (raw === 'operasyon') return 'Operasyon';
  if (raw === 'finans') return 'Finans';
  if (raw === 'it') return 'IT';
  if (raw === 'yönetim' || raw === 'yonetim') return 'Yönetim';
  if (source) return source;
  return resolveDefaultDepartments(fallbackRole)[0] || 'Operasyon';
};

const normalizeDepartmentRule = (rule = {}) => ({
  allow: Array.from(new Set((Array.isArray(rule?.allow) ? rule.allow : []).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr')),
  deny: Array.from(new Set((Array.isArray(rule?.deny) ? rule.deny : []).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'tr')),
});

const mergeDepartmentPermissionRules = (rules = {}) => {
  const merged = {};
  Object.entries(DEFAULT_DEPARTMENT_PERMISSION_RULES).forEach(([departmentName, rule]) => {
    merged[departmentName] = normalizeDepartmentRule(rule);
  });
  Object.entries(rules || {}).forEach(([departmentName, rule]) => {
    merged[normalizeDepartmentName(departmentName)] = normalizeDepartmentRule(rule);
  });
  return merged;
};

const computeEffectivePermissionPreview = ({ user, roleDefinitions, departmentPermissionRules, allPermissionKeys }) => {
  if (!user) return null;
  const roleKey = normalizeRoleKey(user?.role);
  const roleDefinition = roleDefinitions.find((item) => item.key === roleKey);
  const rolePermissions = normalizePermissions(roleDefinition?.permissions || ROLE_PERMISSIONS[roleKey] || [], allPermissionKeys);
  if (rolePermissions.includes('*')) {
    return {
      department: normalizeDepartmentName(user?.department, roleKey),
      rolePermissions,
      effectivePermissions: ['*'],
      departmentRule: normalizeDepartmentRule({ allow: ['*'], deny: [] }),
      addedByDepartment: ['*'],
      removedByDepartment: [],
    };
  }

  const department = normalizeDepartmentName(user?.department, roleKey);
  const departmentRule = normalizeDepartmentRule(departmentPermissionRules[department] || DEFAULT_DEPARTMENT_PERMISSION_RULES[department]);
  const baseSet = new Set(rolePermissions);
  departmentRule.allow.forEach((permission) => baseSet.add(permission));
  if (departmentRule.deny.includes('*')) {
    baseSet.clear();
  } else {
    departmentRule.deny.forEach((permission) => baseSet.delete(permission));
  }

  return {
    department,
    rolePermissions,
    effectivePermissions: Array.from(baseSet).sort((a, b) => a.localeCompare(b, 'tr')),
    departmentRule,
    addedByDepartment: departmentRule.allow.filter((permission) => !rolePermissions.includes(permission)),
    removedByDepartment: departmentRule.deny.filter((permission) => rolePermissions.includes(permission)),
  };
};

export default function RoleManagement() {
  const { user } = useAuth();
  const [roleDefinitions, setRoleDefinitions] = useState(DEFAULT_ROLE_DEFINITIONS);
  const [roleDepartments, setRoleDepartments] = useState({});
  const [departments, setDepartments] = useState(DEFAULT_DEPARTMENTS);
  const [departmentPermissionRules, setDepartmentPermissionRules] = useState(DEFAULT_DEPARTMENT_PERMISSION_RULES);
  const [departmentDraft, setDepartmentDraft] = useState({ id: '', name: '', description: '', isActive: true, allowPermissions: [], denyPermissions: [] });
  const [editingDepartmentId, setEditingDepartmentId] = useState('');
  const [isDepartmentModalOpen, setIsDepartmentModalOpen] = useState(false);
  const [isDepartmentViewOnly, setIsDepartmentViewOnly] = useState(false);
  const [users, setUsers] = useState([]);
  const [selectedPreviewUserId, setSelectedPreviewUserId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoleKey, setEditingRoleKey] = useState('');
  const [roleDraft, setRoleDraft] = useState(createRoleDraft());
  const [initialRoleDraft, setInitialRoleDraft] = useState(createRoleDraft());
  const [expandedModules, setExpandedModules] = useState([]);
  const [confirmCloseRoleModalOpen, setConfirmCloseRoleModalOpen] = useState(false);
  const [selectedRoleUsers, setSelectedRoleUsers] = useState(null);
  const [permissionViewRole, setPermissionViewRole] = useState(null);
  const [managementMode, setManagementMode] = useState(false);
  const [managementPinGateOpen, setManagementPinGateOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);

  const isAdmin = user?.role === 'admin';
  const canViewRoleManagement = hasPermission(user, 'settings:update');
  const canViewDepartments = canViewRoleManagement;
  const hasManagementAccess = isAdmin && managementMode;

  const permissionCatalog = useMemo(() => buildPermissionCatalog(roleDefinitions, users), [roleDefinitions, users]);
  const allPermissionKeys = useMemo(() => permissionCatalog.map((item) => item.key), [permissionCatalog]);
  const permissionMap = useMemo(() => new Map(permissionCatalog.map((item) => [item.key, item])), [permissionCatalog]);
  const visibleRoleDefinitions = useMemo(
    () => roleDefinitions.filter((role) => !HIDDEN_ROLE_KEYS.has(role.key)),
    [roleDefinitions]
  );
  const activeDepartmentNames = useMemo(
    () => departments.filter((department) => department.isActive !== false).map((department) => department.name),
    [departments]
  );

  const permissionModules = useMemo(() => {
    const grouped = new Map();
    permissionCatalog.forEach((permission) => {
      const moduleName = permission.module || 'Genel';
      if (!grouped.has(moduleName)) {
        grouped.set(moduleName, {
          moduleName,
          permissions: [],
        });
      }
      grouped.get(moduleName).permissions.push(permission);
    });

    return Array.from(grouped.values()).sort((left, right) => left.moduleName.localeCompare(right.moduleName, 'tr'));
  }, [permissionCatalog]);

  const departmentPermissionGroups = useMemo(() => {
    const grouped = new Map(DEPARTMENT_PERMISSION_GROUP_ORDER.map((groupName) => [groupName, []]));
    permissionCatalog.forEach((permission) => {
      const groupName = getDepartmentPermissionGroup(permission.module);
      if (!grouped.has(groupName)) grouped.set(groupName, []);
      grouped.get(groupName).push(permission);
    });
    return Array.from(grouped.entries())
      .map(([groupName, permissions]) => ({ groupName, permissions }))
      .filter((group) => group.permissions.length);
  }, [permissionCatalog]);

  const usersByRole = useMemo(() => {
    const grouped = {};
    users.forEach((item) => {
      const key = normalizeRoleKey(item?.role);
      if (!key) return;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    });
    return grouped;
  }, [users]);

  const isAllPermissionsSelected = useMemo(
    () => allPermissionKeys.every((permissionKey) => roleDraft.permissions.includes(permissionKey)),
    [allPermissionKeys, roleDraft.permissions]
  );

  const hasRoleDraftChanges = useMemo(() => {
    const current = normalizeRoleDraftForCompare(roleDraft, allPermissionKeys);
    const initial = normalizeRoleDraftForCompare(initialRoleDraft, allPermissionKeys);
    return JSON.stringify(current) !== JSON.stringify(initial);
  }, [allPermissionKeys, initialRoleDraft, roleDraft]);

  const resetRoleModalState = () => {
    setIsModalOpen(false);
    setRoleDraft(createRoleDraft());
    setInitialRoleDraft(createRoleDraft());
    setEditingRoleKey('');
    setExpandedModules([]);
    setConfirmCloseRoleModalOpen(false);
  };

  const requestCloseRoleModal = () => {
    if (isSaving) return;
    if (hasRoleDraftChanges) {
      setConfirmCloseRoleModalOpen(true);
      return;
    }
    resetRoleModalState();
  };

  const saveSettingsRoles = async (
    nextRoleDefinitions,
    nextRoleDepartments,
    nextDepartments = departments,
    nextDepartmentPermissionRules = departmentPermissionRules
  ) => {
    await settingsService.update({
      roleDefinitions: nextRoleDefinitions,
      roleDepartmentAssignments: nextRoleDepartments,
      departments: nextDepartments,
      departmentPermissionRules: nextDepartmentPermissionRules,
    });
    setRoleDefinitions(nextRoleDefinitions);
    setRoleDepartments(nextRoleDepartments);
    setDepartments(nextDepartments);
    setDepartmentPermissionRules(nextDepartmentPermissionRules);
  };

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [settings, usersData] = await Promise.all([settingsService.get(), userService.list()]);
      const merged = normalizeRoleDefinitions(
        Array.isArray(settings?.roleDefinitions) && settings.roleDefinitions.length ?
          settings.roleDefinitions
          : DEFAULT_ROLE_DEFINITIONS,
        allPermissionKeys
      );
      const userRoleKeys = new Set((Array.isArray(usersData) ? usersData : []).map((item) => normalizeRoleKey(item?.role)).filter(Boolean));
      for (const role of DEFAULT_ROLE_DEFINITIONS) {
        if (!merged.some((item) => item.key === role.key)) {
          merged.push(role);
        }
      }
      userRoleKeys.forEach((roleKey) => {
        if (!merged.some((item) => item.key === roleKey)) {
          merged.push({
            key: roleKey,
            label: ROLE_LABELS[roleKey] || roleKey,
            description: 'Sistemde kullanilan rol kaydi otomatik eklendi.',
            permissions: [],
          });
        }
      });

      setRoleDefinitions(merged);
      const savedDepartments = Array.isArray(settings?.departments) && settings.departments.length
        ? settings.departments
        : DEFAULT_DEPARTMENTS;
      const normalizedDepartments = savedDepartments.map((department, index) => ({
        id: String(department?.id || `department-${index + 1}`).trim(),
        name: String(department?.name || '').trim(),
        description: String(department?.description || '').trim(),
        isActive: department?.isActive !== false,
      })).filter((department) => department.name);
      const activeNames = normalizedDepartments.filter((department) => department.isActive !== false).map((department) => department.name);
      const savedRoleDepartments = settings?.roleDepartmentAssignments && typeof settings.roleDepartmentAssignments === 'object' ?
        settings.roleDepartmentAssignments
        : {};
      const normalizedRoleDepartments = {};
      merged.forEach((role) => {
        const currentDepartments = sanitizeDepartments(savedRoleDepartments[role.key], activeNames);
        normalizedRoleDepartments[role.key] = currentDepartments.length ?
          currentDepartments
          : resolveDefaultDepartments(role.key);
      });
      const hasAutoAssignedDepartments = JSON.stringify(normalizedRoleDepartments) !== JSON.stringify(savedRoleDepartments || {});
      setRoleDepartments(normalizedRoleDepartments);
      setDepartments(normalizedDepartments);
      setDepartmentPermissionRules(mergeDepartmentPermissionRules(settings?.departmentPermissionRules));
      setUsers(Array.isArray(usersData) ? usersData : []);
      setSelectedPreviewUserId((current) => current || String(usersData?.[0]?.id || ''));
      if (hasAutoAssignedDepartments) {
        await saveSettingsRoles(merged, normalizedRoleDepartments, normalizedDepartments, mergeDepartmentPermissionRules(settings?.departmentPermissionRules));
      }
    } catch (error) {
      setToast({ type: 'error', title: 'Rol Yönetimi', message: error.message || 'Rol verileri yüklenemedi.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (canViewRoleManagement) {
      loadData();
    }
  }, [canViewRoleManagement]);

  const ensureManagementAccess = (action) => {
    if (!isAdmin) return false;
    if (hasManagementAccess) return true;
    setPendingAction(() => action);
    setManagementPinGateOpen(true);
    return false;
  };

  const showCreateModal = () => {
    const draft = createRoleDraft();
    setCreateMenuOpen(false);
    setEditingRoleKey('');
    setRoleDraft(draft);
    setInitialRoleDraft(draft);
    setExpandedModules([]);
    setConfirmCloseRoleModalOpen(false);
    setIsModalOpen(true);
  };

  const openCreateModal = () => {
    if (!ensureManagementAccess(showCreateModal)) return;
    showCreateModal();
  };

  const resetDepartmentModalState = () => {
    setIsDepartmentModalOpen(false);
    setEditingDepartmentId('');
    setIsDepartmentViewOnly(false);
    setDepartmentDraft({ id: '', name: '', description: '', isActive: true, allowPermissions: [], denyPermissions: [] });
  };

  const showEditModal = (role) => {
    const departments = Array.isArray(roleDepartments[role.key]) && roleDepartments[role.key].length ?
      [...roleDepartments[role.key]]
      : [...resolveDefaultDepartments(role.key)];
    setEditingRoleKey(role.key);
    const draft = {
      key: role.key,
      label: role.label,
      description: role.description || '',
      permissions: normalizePermissions(role.permissions, allPermissionKeys),
      departments,
    };
    setRoleDraft(draft);
    setInitialRoleDraft(draft);
    setExpandedModules([]);
    setConfirmCloseRoleModalOpen(false);
    setIsModalOpen(true);
  };

  const openEditModal = (role) => {
    if (!ensureManagementAccess(() => showEditModal(role))) return;
    showEditModal(role);
  };

  const openPermissionModal = (role) => {
    setPermissionViewRole(role);
  };

  const togglePermission = (permissionKey) => {
    setRoleDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permissionKey) ?
        current.permissions.filter((item) => item !== permissionKey)
        : [...current.permissions, permissionKey],
    }));
  };

  const toggleDepartment = (department) => {
    setRoleDraft((current) => {
      const exists = current.departments.includes(department);
      const nextDepartments = exists ?
        current.departments.filter((item) => item !== department)
        : [...current.departments, department];

      return {
        ...current,
        departments: nextDepartments,
      };
    });
  };

  const showDepartmentEdit = (department = null, viewOnly = false) => {
    setCreateMenuOpen(false);
    setEditingDepartmentId(department?.id || '');
    setIsDepartmentViewOnly(viewOnly);
    const departmentName = department?.name ? normalizeDepartmentName(department.name) : '';
    const rules = departmentName ? normalizeDepartmentRule(departmentPermissionRules[departmentName]) : normalizeDepartmentRule();
    setDepartmentDraft(department ? {
      ...department,
      allowPermissions: rules.allow,
      denyPermissions: rules.deny,
    } : { id: '', name: '', description: '', isActive: true, allowPermissions: [], denyPermissions: [] });
    setIsDepartmentModalOpen(true);
  };

  const startDepartmentEdit = (department = null) => {
    if (!ensureManagementAccess(() => showDepartmentEdit(department))) return;
    showDepartmentEdit(department);
  };

  const viewDepartment = (department) => {
    showDepartmentEdit(department, true);
  };

  const saveDepartment = async () => {
    if (!hasManagementAccess) return;
    const name = String(departmentDraft.name || '').trim();
    const description = String(departmentDraft.description || '').trim();
    if (!name) {
      setToast({ type: 'error', title: 'Departman', message: 'Departman adı zorunludur.' });
      return;
    }
    const id = editingDepartmentId || name.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ]+/gi, '-').replace(/^-+|-+$/g, '') || `department-${Date.now()}`;
    const duplicate = departments.find((department) => department.id !== editingDepartmentId && department.name.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'));
    if (duplicate) {
      setToast({ type: 'error', title: 'Departman', message: 'Bu departman zaten kayıtlı.' });
      return;
    }
    const previousDepartment = departments.find((department) => department.id === editingDepartmentId) || null;
    const nextDepartments = editingDepartmentId
      ? departments.map((department) => (department.id === editingDepartmentId ? { ...department, name, description, isActive: departmentDraft.isActive !== false } : department))
      : [...departments, { id, name, description, isActive: departmentDraft.isActive !== false }];
    const nextDepartmentPermissionRules = { ...departmentPermissionRules };
    if (previousDepartment?.name && previousDepartment.name !== name) {
      delete nextDepartmentPermissionRules[normalizeDepartmentName(previousDepartment.name)];
    }
    nextDepartmentPermissionRules[normalizeDepartmentName(name)] = normalizeDepartmentRule({
      allow: departmentDraft.allowPermissions,
      deny: departmentDraft.denyPermissions.filter((permission) => !departmentDraft.allowPermissions.includes(permission)),
    });
    const nextRoleDepartments = previousDepartment?.name && previousDepartment.name !== name
      ? Object.fromEntries(
        Object.entries(roleDepartments).map(([roleKey, assignedDepartments]) => [
          roleKey,
          (assignedDepartments || []).map((departmentName) => (departmentName === previousDepartment.name ? name : departmentName)),
        ])
      )
      : roleDepartments;
    try {
      setIsSaving(true);
      await saveSettingsRoles(roleDefinitions, nextRoleDepartments, nextDepartments, nextDepartmentPermissionRules);
      setDepartmentDraft({ id: '', name: '', description: '', isActive: true, allowPermissions: [], denyPermissions: [] });
      setEditingDepartmentId('');
      setIsDepartmentModalOpen(false);
      setToast({ type: 'success', title: 'Departman', message: editingDepartmentId ? 'Departman güncellendi.' : 'Departman eklendi.' });
    } catch (error) {
      setToast({ type: 'error', title: 'Departman', message: error.message || 'Departman kaydedilemedi.' });
    } finally {
      setIsSaving(false);
    }
  };

  const applyDepartmentActiveToggle = async (department) => {
    const nextDepartments = departments.map((item) => (
      item.id === department.id ? { ...item, isActive: item.isActive === false } : item
    ));
    try {
      setIsSaving(true);
      await saveSettingsRoles(roleDefinitions, roleDepartments, nextDepartments);
    } catch (error) {
      setToast({ type: 'error', title: 'Departman', message: error.message || 'Departman güncellenemedi.' });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleDepartmentRulePermission = (kind, permissionKey) => {
    setDepartmentDraft((current) => {
      const key = kind === 'deny' ? 'denyPermissions' : 'allowPermissions';
      const currentItems = Array.isArray(current[key]) ? current[key] : [];
      const exists = currentItems.includes(permissionKey);
      const nextItems = exists
        ? currentItems.filter((item) => item !== permissionKey)
        : [...currentItems, permissionKey];
      return { ...current, [key]: nextItems };
    });
  };

  const toggleDepartmentActive = async (department) => {
    if (!ensureManagementAccess(() => applyDepartmentActiveToggle(department))) return;
    await applyDepartmentActiveToggle(department);
  };

  const toggleModuleExpanded = (moduleName) => {
    setExpandedModules((current) => (
      current.includes(moduleName) ?
        current.filter((item) => item !== moduleName)
        : [...current, moduleName]
    ));
  };

  const setModulePermissionState = (modulePermissions, nextChecked) => {
    setRoleDraft((current) => {
      const currentSet = new Set(current.permissions);
      if (nextChecked) {
        modulePermissions.forEach((permission) => currentSet.add(permission.key));
      } else {
        modulePermissions.forEach((permission) => currentSet.delete(permission.key));
      }

      return {
        ...current,
        permissions: Array.from(currentSet),
      };
    });
  };

  const saveRole = async (event) => {
    event.preventDefault();

    const normalizedKey = normalizeRoleKey(roleDraft.key || roleDraft.label);
    const label = String(roleDraft.label || '').trim();
    const permissions = normalizePermissions(roleDraft.permissions, allPermissionKeys);

    if (!normalizedKey) {
      setToast({ type: 'error', title: 'Rol Yönetimi', message: 'Rol anahtarı zorunludur.' });
      return;
    }

    if (!label) {
      setToast({ type: 'error', title: 'Rol Yönetimi', message: 'Rol adı zorunludur.' });
      return;
    }

    if (!permissions.length) {
      setToast({ type: 'error', title: 'Rol Yönetimi', message: 'En az bir yetki seçin.' });
      return;
    }

    const duplicate = roleDefinitions.find((item) => item.key === normalizedKey && item.key !== editingRoleKey);
    if (duplicate) {
      setToast({ type: 'error', title: 'Rol Yönetimi', message: 'Bu anahtar zaten kullanılıyor.' });
      return;
    }

    const nextRole = {
      key: normalizedKey,
      label,
      description: String(roleDraft.description || '').trim(),
      permissions,
    };

    const nextRoles = editingRoleKey ?
      roleDefinitions.map((item) => (item.key === editingRoleKey ? nextRole : item))
      : [...roleDefinitions, nextRole];

      const departments = sanitizeDepartments(roleDraft.departments, activeDepartmentNames);
    const assignedDepartments = departments.length ?
      departments
      : resolveDefaultDepartments(normalizedKey);

    const nextRoleDepartments = { ...roleDepartments };
    if (editingRoleKey && editingRoleKey !== normalizedKey) {
      delete nextRoleDepartments[editingRoleKey];
    }
    nextRoleDepartments[normalizedKey] = assignedDepartments;

    try {
      setIsSaving(true);
      await saveSettingsRoles(nextRoles, nextRoleDepartments);
      resetRoleModalState();
      setToast({ type: 'success', title: 'Rol Yönetimi', message: editingRoleKey ? 'Rol güncellendi.' : 'Yeni rol eklendi.' });
    } catch (error) {
      setToast({ type: 'error', title: 'Rol Yönetimi', message: error.message || 'Rol kaydedilemedi.' });
    } finally {
      setIsSaving(false);
    }
  };

  const previewUsers = useMemo(
    () => [...users].sort((left, right) => String(left?.name || left?.username || '').localeCompare(String(right?.name || right?.username || ''), 'tr')),
    [users]
  );

  const selectedPreviewUser = useMemo(
    () => previewUsers.find((item) => String(item.id) === String(selectedPreviewUserId)) || previewUsers[0] || null,
    [previewUsers, selectedPreviewUserId]
  );

  const permissionPreview = useMemo(
    () => computeEffectivePermissionPreview({
      user: selectedPreviewUser,
      roleDefinitions,
      departmentPermissionRules,
      allPermissionKeys,
    }),
    [allPermissionKeys, departmentPermissionRules, roleDefinitions, selectedPreviewUser]
  );

  if (!canViewRoleManagement) {
    return (
      <div className="page-stack roles-page">
        <Toast toast={toast} onClose={() => setToast(null)} />
        <PageHeader className="dashboard-hero" icon={<ShieldCheck size={22} />} title="Rol Yönetimi" description="Rolleri ve departman bağlantılarını yönetin." />
        <PageAccessGuard permission="settings:update" pageLabel="Departmanlar" />
      </div>
    );
  }

  const isDepartmentFormReadOnly = isDepartmentViewOnly || !hasManagementAccess || isSaving;

  return (
    <div className="page-stack roles-page">
      <Toast toast={toast} onClose={() => setToast(null)} />

      <PageHeader
        className="dashboard-hero"
        icon={<ShieldCheck size={22} />}
        title="Rol Yönetimi"
        description="Rolleri ve departman bağlantılarını yönetin."
        actions={isAdmin ? (
          <div className="table-actions role-page-header-actions">
            <button
              type="button"
              className={`users-management-btn ${hasManagementAccess ? 'is-active' : ''}`}
              onClick={() => {
                if (hasManagementAccess) {
                  setManagementMode(false);
                  return;
                }
                setPendingAction(null);
                setManagementPinGateOpen(true);
              }}
            >
              {hasManagementAccess ? 'Düzenleme Modunu Kapat' : 'Düzenleme Modunu Aç'}
            </button>
            <button className="primary-button role-header-primary-action" type="button" onClick={() => startDepartmentEdit(null)}>
              <Plus size={16} /> Yeni Departman Ekle
            </button>
            <button className="primary-button role-header-primary-action" type="button" onClick={openCreateModal}>
              <Plus size={16} /> Yeni Rol Ekle
            </button>
          </div>
        ) : null}
      />

      <div className="mod-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-blue"><Users size={18} /></div>
          <div>
            <h3 className="mod-card-title">Roller</h3>
            <p className="mod-card-desc">Toplam {visibleRoleDefinitions.length} rol tanımı</p>
          </div>
        </div>

        {isLoading ? (
          <div className="s-empty-state">Rol verileri yükleniyor...</div>
        ) : (
          <div className="role-management-grid">
            {visibleRoleDefinitions.map((role) => {
              const rolePermissions = normalizePermissions(role.permissions, allPermissionKeys);
              const roleUsers = usersByRole[role.key] || [];
              const departments = Array.isArray(roleDepartments[role.key]) ? roleDepartments[role.key] : [];
              const risk = getRiskMeta(rolePermissions, allPermissionKeys);
              const warnings = getCriticalWarnings(rolePermissions, allPermissionKeys);

              return (
                <article key={role.key} className="role-management-card">
                  <div className="role-management-head">
                    <div className="role-management-title-row">
                      <strong>{ROLE_LABELS[role.key] || role.label}</strong>
                      <span className={`role-management-risk-badge ${risk.className}`}>{risk.label} Risk</span>
                    </div>
                  </div>

                  <div className="role-management-meta-row">
                    <span className="role-management-badge">{rolePermissions.length} izin</span>
                    <button type="button" className="role-user-badge" onClick={() => setSelectedRoleUsers({ role, users: roleUsers })}>
                      <UserRound size={13} /> {roleUsers.length} kullanıcı
                    </button>
                  </div>

                  <p className="role-management-description">{role.description || 'Açıklama girilmemiş.'}</p>

                  <div className="role-management-departments">
                    {(departments.length ? departments : ['Departman atanmamış']).map((department, index) => (
                      <span key={`${role.key}-${department}-${index}`} className="role-department-chip">
                        {department}
                      </span>
                    ))}
                  </div>

                  {warnings.length ? (
                    <div className="role-warning-list">
                      {warnings.map((warning) => (
                        <div key={`${role.key}-${warning}`} className="role-warning-item">
                          <AlertTriangle size={13} />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="role-management-actions">
                    <button type="button" className="text-button role-management-action-button" onClick={() => openPermissionModal(role)}>
                      <Eye size={14} /> Görüntüle
                    </button>
                    <button type="button" className="text-button role-management-action-button" onClick={() => openEditModal(role)} disabled={!isAdmin}>
                      <Edit3 size={14} /> Düzenle
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {canViewDepartments ? (
        <div className="mod-card role-management-section-spaced">
          <div className="mod-card-header">
            <div className="mod-card-icon mod-icon-blue"><Users size={18} /></div>
            <div>
              <h3 className="mod-card-title">Departmanlar</h3>
              <p className="mod-card-desc">Departman bazlı yetki kapsamlarını yönetin.</p>
            </div>
          </div>
          <div className="role-management-grid role-management-grid-departments">
            {departments.map((department) => {
              const departmentName = normalizeDepartmentName(department.name);
              const permissionRule = normalizeDepartmentRule(departmentPermissionRules[departmentName] || DEFAULT_DEPARTMENT_PERMISSION_RULES[departmentName]);
              const relatedRoleCount = visibleRoleDefinitions.filter((role) => (roleDepartments[role.key] || []).includes(department.name)).length;
              const relatedUserCount = users.filter((item) => normalizeDepartmentName(item?.department, item?.role) === departmentName).length;
              const scopeModules = permissionRule.allow.includes('*')
                ? ['Tüm modüller']
                : Array.from(new Set(permissionRule.allow.map((permissionKey) => permissionMap.get(permissionKey)?.module).filter(Boolean))).slice(0, 3);

              return (
                <article key={department.id} className="role-management-card role-management-card-department">
                  <div className="role-management-head">
                    <div className="role-management-title-row">
                      <strong>{department.name}</strong>
                      <span className={`role-management-risk-badge ${department.isActive === false ? 'risk-low' : 'risk-medium'}`}>
                        {department.isActive === false ? 'Pasif' : 'Aktif'}
                      </span>
                    </div>
                  </div>

                  <div className="role-management-meta-row">
                    <span className="role-management-badge">{relatedRoleCount} rol bağı</span>
                    <span className="role-user-badge"><UserRound size={13} /> {relatedUserCount} kullanıcı</span>
                  </div>

                  <p className="role-management-description">{department.description || 'Bu departman için açıklama girilmemiş.'}</p>

                  <div className="role-department-summary-list">
                    <span>Ek yetkiler: {permissionRule.allow.includes('*') ? 'Tümü' : permissionRule.allow.length}</span>
                    <span>Kısıtlanan yetkiler: {permissionRule.deny.length}</span>
                    <span>Kapsam: {scopeModules.length ? scopeModules.join(' / ') : 'Rol varsayılanı'}</span>
                  </div>

                  <div className="role-management-actions">
                    <button type="button" className="text-button role-management-action-button" onClick={() => startDepartmentEdit(department)} disabled={!isAdmin}>
                      <Edit3 size={14} /> Düzenle
                    </button>
                    <button type="button" className="text-button role-management-action-button" onClick={() => viewDepartment(department)}>
                      <Eye size={14} /> Görüntüle
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <PageAccessGuard permission="settings:update" pageLabel="Departmanlar" />
      )}

      <FormModal
        isOpen={Boolean(selectedRoleUsers)}
        title={`${selectedRoleUsers?.role?.label || 'Rol'} Kullanıcıları`}
        description="Bu role atanmış kullanıcılar"
        headerIcon={<Users size={16} />}
        onClose={() => setSelectedRoleUsers(null)}
        modalClassName="role-users-modal"
      >
        <div className="role-users-list">
          {(selectedRoleUsers?.users || []).length ? (
            selectedRoleUsers.users.map((item) => (
              <div key={item.id} className="role-users-item">
                <div>
                  <strong>{item.name || item.username || 'İsimsiz kullanıcı'}</strong>
                  <small>{item.username || item.email || '-'}</small>
                </div>
                <span className={`status-pill ${item.isActive ? 'active' : 'passive'}`}>{item.isActive ? 'Aktif' : 'Pasif'}</span>
              </div>
            ))
          ) : (
            <div className="s-empty-state">Bu role atanmış kullanıcı bulunmuyor.</div>
          )}
        </div>
      </FormModal>

      <FormModal
        isOpen={Boolean(permissionViewRole)}
        title={`${permissionViewRole?.label || ''} - İzinler`}
        description="Modül bazlı izin kapsamını görüntüleyin. Değişiklik için Düzenle ekranını kullanın."
        headerIcon={<Eye size={16} />}
        onClose={() => setPermissionViewRole(null)}
        modalClassName="product-form-fit-modal role-permission-view-modal"
      >
        <div className="modal-form modal-structured-form role-permission-view-shell">
          <div className="modal-form-body-scroll role-permission-view-scroll">
            <div className="role-inline-editor role-inline-view-only">
              <div className="role-inline-editor-head">
                <span>Yetki Listesi</span>
              </div>

              <div className="role-inline-permission-list">
                {normalizePermissions(permissionViewRole?.permissions, allPermissionKeys).length ? (
                  normalizePermissions(permissionViewRole?.permissions, allPermissionKeys).map((permissionKey) => {
                    const permission = permissionMap.get(permissionKey);
                    return (
                      <div key={`view-${permissionKey}`} className="role-view-permission-item">
                        <span className="role-toggle-label">
                          <strong>{permission?.module || 'Genel'}</strong>
                          <small>{permission?.action || 'Yetki'} - {permission?.label || permissionKey}</small>
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="s-empty-state">Bu rol için yetki tanımlı değil.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={isDepartmentModalOpen}
        title={isDepartmentViewOnly ? 'Departman Görüntüle' : (editingDepartmentId ? 'Departman Düzenle' : 'Yeni Departman Ekle')}
        description={isDepartmentViewOnly ? 'Departman bilgilerini ve yetki kapsamını görüntüleyin.' : 'Departman bilgilerini ve yetki kapsamını düzenleyin.'}
        headerIcon={<Users size={16} />}
        onClose={resetDepartmentModalState}
        modalClassName="product-form-fit-modal role-department-modal-shell"
      >
        <form className="modal-form role-modal-form role-department-modal-form" onSubmit={(event) => { event.preventDefault(); saveDepartment(); }}>
          <div className="role-modal-body role-department-modal-body">
            <section className="role-form-section role-form-fields">
              <label className="field-group role-field-half">
                <span>Departman adı</span>
                <input
                  type="text"
                  value={departmentDraft.name}
                  onChange={(event) => setDepartmentDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Departman adı"
                  disabled={isDepartmentFormReadOnly}
                  required
                />
              </label>
              <label className="field-group role-field-half role-status-field">
                <span>Durum</span>
                <div className={`role-department-status-selector ${departmentDraft.isActive === false ? 'is-passive' : 'is-active'}`}>
                  <button
                    type="button"
                    className={`role-department-status-option role-department-status-option-active ${departmentDraft.isActive === false ? '' : 'is-selected'}`}
                    onClick={() => setDepartmentDraft((current) => ({ ...current, isActive: true }))}
                    disabled={isDepartmentFormReadOnly}
                    aria-pressed={departmentDraft.isActive !== false}
                  >
                    Aktif
                  </button>
                  <button
                    type="button"
                    className={`role-department-status-option role-department-status-option-passive ${departmentDraft.isActive === false ? 'is-selected' : ''}`}
                    onClick={() => setDepartmentDraft((current) => ({ ...current, isActive: false }))}
                    disabled={isDepartmentFormReadOnly}
                    aria-pressed={departmentDraft.isActive === false}
                  >
                    Pasif
                  </button>
                </div>
              </label>
              <label className="field-group role-field-full">
                <span>Açıklama</span>
                <input
                  type="text"
                  value={departmentDraft.description}
                  onChange={(event) => setDepartmentDraft((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Departmanın çalışma alanını yazın"
                  disabled={isDepartmentFormReadOnly}
                />
              </label>
            </section>

            <section className="role-form-section role-department-permission-editor">
              <div className="role-form-section-head">
                <div>
                  <h4>Ek yetkiler</h4>
                  <p>Rolün üzerine ek yetki veren departman kapsamı.</p>
                </div>
              </div>
              <div className="role-department-permission-groups">
                {departmentPermissionGroups.map((group) => (
                  <div key={`allow-group-${group.groupName}`} className="role-department-rule-card">
                    <strong>{group.groupName}</strong>
                    <div className="role-department-selector role-department-selector-modern">
                      {group.permissions.map((permission) => (
                        <button
                          key={`allow-${permission.key}`}
                          type="button"
                          className={`role-department-toggle ${departmentDraft.allowPermissions.includes(permission.key) ? 'is-selected' : ''}`}
                          onClick={() => toggleDepartmentRulePermission('allow', permission.key)}
                          disabled={isDepartmentFormReadOnly}
                        >
                          {permission.action}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="role-form-section role-department-permission-editor">
              <div className="role-form-section-head">
                <div>
                  <h4>Kısıtlanan yetkiler</h4>
                  <p>Rolde olsa bile departman kapsamında kapatılan yetkiler.</p>
                </div>
              </div>
              <div className="role-department-permission-groups">
                {departmentPermissionGroups.map((group) => (
                  <div key={`deny-group-${group.groupName}`} className="role-department-rule-card">
                    <strong>{group.groupName}</strong>
                    <div className="role-department-selector role-department-selector-modern">
                      {group.permissions.map((permission) => (
                        <button
                          key={`deny-${permission.key}`}
                          type="button"
                          className={`role-department-toggle ${departmentDraft.denyPermissions.includes(permission.key) ? 'is-selected' : ''}`}
                          onClick={() => toggleDepartmentRulePermission('deny', permission.key)}
                          disabled={isDepartmentFormReadOnly}
                        >
                          {permission.action}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="modal-actions role-modal-footer">
            <button className="ghost-button" type="button" onClick={resetDepartmentModalState} disabled={isSaving}>
              {isDepartmentViewOnly ? 'Kapat' : 'Vazgeç'}
            </button>
            {!isDepartmentViewOnly ? (
              <button className="primary-button" type="submit" disabled={!hasManagementAccess || isSaving}>
                {isSaving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            ) : null}
          </div>
        </form>
      </FormModal>

      <FormModal
        isOpen={isModalOpen}
        title={editingRoleKey ? 'Rol Düzenle' : 'Yeni Rol Ekle'}
        description="Rol, departman ve yetki kapsamını belirleyin"
        headerIcon={<ShieldCheck size={16} />}
        onClose={requestCloseRoleModal}
        modalClassName="product-form-fit-modal role-modal-shell"
      >
        <form className="modal-form role-modal-form" onSubmit={saveRole}>
          <div className="role-modal-body role-modal-layout-grid">
            <section className="role-form-section role-form-fields role-modal-column-left">
              <label className="field-group role-field-half">
              <span>Rol Anahtarı *</span>
              <input
                type="text"
                value={roleDraft.key}
                onChange={(event) => setRoleDraft((current) => ({ ...current, key: normalizeRoleKey(event.target.value) }))}
                placeholder="ornek: saha_sorumlusu"
                required
                disabled={isSaving || Boolean(editingRoleKey)}
              />
              </label>

              <label className="field-group role-field-half">
              <span>Rol Adı *</span>
              <input
                type="text"
                value={roleDraft.label}
                onChange={(event) => setRoleDraft((current) => ({ ...current, label: event.target.value }))}
                placeholder="Örnek: Saha Sorumlusu"
                required
                disabled={isSaving}
              />
              </label>

              <label className="field-group role-field-full">
              <span>Açıklama</span>
              <input
                type="text"
                value={roleDraft.description}
                onChange={(event) => setRoleDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Rolün kullanım alanını yazın"
                disabled={isSaving}
              />
              </label>

              <label className="field-group role-field-full">
                <span>Departman Atamaları</span>
                <div className="role-department-selector role-department-selector-modern">
                  {activeDepartmentNames.map((department) => (
                    <button
                      key={department}
                      type="button"
                      className={`role-department-toggle ${roleDraft.departments.includes(department) ? 'is-selected' : ''}`}
                      onClick={() => toggleDepartment(department)}
                      disabled={isSaving}
                    >
                      {department}
                    </button>
                  ))}
                </div>
              </label>
            </section>

            <section className="role-form-section role-form-permissions role-modal-column-right">
              <div className="role-form-section-head">
                <div>
                  <h4>Yetki Listesi *</h4>
                  <p>Modül bazlı kapsamı seçin. Gerekirse modülü genişletip detay izinleri düzenleyin.</p>
                </div>
                <div className="role-editor-shortcuts role-editor-shortcuts-modern">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setRoleDraft((current) => ({
                      ...current,
                      permissions: isAllPermissionsSelected ? [] : [...allPermissionKeys],
                    }))}
                    disabled={isSaving}
                  >
                    Tümünü Seç
                  </button>
                </div>
              </div>

              <div className="role-permission-editor role-permission-editor-modern">
                <div className="role-module-list">
                  {permissionModules.map((moduleGroup) => {
                    const selectedCount = moduleGroup.permissions.filter((item) => roleDraft.permissions.includes(item.key)).length;
                    const totalCount = moduleGroup.permissions.length;
                    const isAllSelected = selectedCount === totalCount;
                    const isExpanded = expandedModules.includes(moduleGroup.moduleName);
                    const permissionSummary = moduleGroup.permissions
                      .map((item) => `${item.action} - ${item.label}`)
                      .join(', ');

                    return (
                      <article key={moduleGroup.moduleName} className={`role-module-card ${isAllSelected ? 'is-selected' : ''}`}>
                        <button
                          type="button"
                          className="role-module-card-main"
                          onClick={() => setModulePermissionState(moduleGroup.permissions, !isAllSelected)}
                          disabled={isSaving}
                        >
                          <div className="role-module-card-copy">
                            <strong>{moduleGroup.moduleName}</strong>
                            <small title={permissionSummary}>{permissionSummary}</small>
                          </div>

                          <div className="role-module-card-controls">
                            <span className="role-module-card-count">{selectedCount}/{totalCount}</span>
                            <label className="role-module-toggle">
                              <input
                                type="checkbox"
                                checked={isAllSelected}
                                onChange={(event) => setModulePermissionState(moduleGroup.permissions, event.target.checked)}
                                onClick={(event) => event.stopPropagation()}
                                disabled={isSaving}
                              />
                              <span>{isAllSelected ? 'Etkin' : 'Kapalı'}</span>
                            </label>
                            <button
                              type="button"
                              className="text-button role-module-detail-btn"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleModuleExpanded(moduleGroup.moduleName);
                              }}
                              disabled={isSaving}
                            >
                              {isExpanded ? 'Detayı Gizle' : 'Detay'}
                            </button>
                          </div>
                        </button>

                        {isExpanded ? (
                          <div className="role-module-card-detail-list">
                            {moduleGroup.permissions.map((permission) => (
                              <label key={permission.key} className="role-module-detail-item">
                                <span className="role-toggle-label">
                                  <strong>{permission.action}</strong>
                                  <small>{permission.label}</small>
                                </span>
                                <input
                                  type="checkbox"
                                  checked={roleDraft.permissions.includes(permission.key)}
                                  onChange={() => togglePermission(permission.key)}
                                  disabled={isSaving}
                                />
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>

          <div className="modal-actions role-modal-footer">
            <button
              className="ghost-button"
              type="button"
              onClick={requestCloseRoleModal}
              disabled={isSaving}
            >
              İptal
            </button>
            <button className="primary-button" type="submit" disabled={isSaving}>
              {isSaving ? 'Kaydediliyor...' : editingRoleKey ? 'Güncelle' : 'Kaydet'}
            </button>
          </div>
        </form>
      </FormModal>

      <ConfirmModal
        isOpen={confirmCloseRoleModalOpen}
        title="Değişiklikler Kaydedilmedi"
        description="Kaydedilmemiş değişiklikleriniz silinecek. Bu işlemi onaylıyor musunuz?"
        confirmText="Değişiklikleri Sil ve Kapat"
        cancelText="Vazgeç"
        tone="confirm"
        closeButton={false}
        primaryAction="cancel"
        dialogClassName="unsaved-changes-dialog"
        onConfirm={resetRoleModalState}
        onCancel={() => setConfirmCloseRoleModalOpen(false)}
      />

      {managementPinGateOpen ? (
        <PinGate
          title="Rol Düzenleme Yetkisi"
          description="Rol düzenleme modunu açmak için 4 haneli PIN kodunu girin."
          type="role-management"
          onSuccess={() => {
            setManagementMode(true);
            setManagementPinGateOpen(false);
            const action = pendingAction;
            setPendingAction(null);
            action?.();
          }}
          onCancel={() => {
            setPendingAction(null);
            setManagementPinGateOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
