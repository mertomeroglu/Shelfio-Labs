import { useEffect, useMemo, useState } from 'react';
import { Users as UsersIcon, Shield, UserPlus, Filter, Crown, CreditCard, Briefcase, UserCircle, Lock, LockOpen, Boxes, Shuffle, Eye, X, FileText, FileSpreadsheet, ClipboardList, CalendarDays, Search } from 'lucide-react';
import DataTable from '../../components/DataTable.jsx';
import FilterBar from '../../components/FilterBar.jsx';
import FormModal from '../../components/FormModal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PinGate from '../../components/PinGate.jsx';
import Toast from '../../components/Toast.jsx';
import { useDialog } from '../../components/ConfirmModal.jsx';
import { InputWithIcon, SearchableCombobox } from '../../components/SearchBar.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { formatDate, formatUserRole } from '../../services/formatters.js';
import { settingsService } from '../../services/settingsService.js';
import { userService } from '../../services/userService.js';
import { ROLE_PERMISSIONS } from '../../config/permissions.js';

const DESK_OPTIONS = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'];
const DESK_LABELS = {
  B1: 'Kasa 1',
  B2: 'Kasa 2',
  B3: 'Kasa 3',
  B4: 'Kasa 4',
  B5: 'Kasa 5',
  B6: 'Kasa 6',
  B7: 'Kasa 7',
  B8: 'Yönetim Kasası',
};
const SYSTEM_ROLES = ['admin', 'cashier', 'depo_personeli', 'user', 'komisyon_b', 'komisyon_c', 'komisyon_v'];
const ROLE_ORDER = { admin: 0, cashier: 1, depo_personeli: 2, user: 3, komisyon_b: 4, komisyon_c: 5, komisyon_v: 6 };
const SUPER_ADMIN_ID = 'u-admin-1';
const SUPER_ADMIN_USERNAME = 'mert.omeroglu@shelfio.com';
const DEFAULT_DEPARTMENTS = [
  { id: 'sales', name: 'Satış', isActive: true },
  { id: 'operations', name: 'Operasyon', isActive: true },
  { id: 'finance', name: 'Finans', isActive: true },
  { id: 'it', name: 'IT', isActive: true },
  { id: 'management', name: 'Yönetim', isActive: true },
];

const isCashierRole = (role) => role === 'cashier';
const isProtectedSuperAdmin = (item) => item && (item.id === SUPER_ADMIN_ID || item.username === SUPER_ADMIN_USERNAME);

const PERMISSION_CATALOG = [
  { key: 'dashboard_view', label: 'Pano görüntüleme' },
  { key: 'barcode_manage', label: 'Barkod işlemleri' },
  { key: 'products_view', label: 'Ürün görüntüleme' },
  { key: 'products_edit', label: 'Ürün ekleme / düzenleme' },
  { key: 'stock_ops', label: 'Stok işlemleri' },
  { key: 'categories_manage', label: 'Kategori yönetimi' },
  { key: 'suppliers_manage', label: 'Tedarikçi yönetimi' },
  { key: 'sections_manage', label: 'Reyon yönetimi' },
  { key: 'esl_manage', label: 'ESL yönetimi' },
  { key: 'tasks_manage', label: 'Görev yönetimi' },
  { key: 'pos_access', label: 'Kasa (POS)' },
  { key: 'reports_view', label: 'Raporlar' },
  { key: 'users_manage', label: 'Personel yönetimi' },
  { key: 'settings_manage', label: 'Sistem ayarları' },
];

const PERMISSION_GROUPS = [
  { title: 'Pano', permissions: ['dashboard_view'] },
  { title: 'Barkod', permissions: ['barcode_manage'] },
  { title: 'Ürün Yönetimi', permissions: ['products_view', 'products_edit', 'categories_manage'] },
  { title: 'Stok Yönetimi', permissions: ['stock_ops'] },
  { title: 'Tedarikçi', permissions: ['suppliers_manage'] },
  { title: 'Reyon', permissions: ['sections_manage'] },
  { title: 'ESL', permissions: ['esl_manage'] },
  { title: 'Kasa (POS)', permissions: ['pos_access'] },
  { title: 'Raporlar', permissions: ['reports_view'] },
  { title: 'Personel Yönetimi', permissions: ['users_manage', 'settings_manage', 'tasks_manage'] },
];

const DEFAULT_ROLE_DEFINITIONS = [
  {
    key: 'admin',
    label: 'Yönetici',
    permissions: PERMISSION_CATALOG.map((item) => item.key),
  },
  {
    key: 'user',
    label: 'Personel',
    permissions: ROLE_PERMISSIONS.user,
  },
  {
    key: 'cashier',
    label: 'Kasiyer',
    description: 'Kasalarda satış işlemlerini yürütür.',
    permissions: ROLE_PERMISSIONS.cashier,
  },
  {
    key: 'depo_personeli',
    label: 'Depo Personeli',
    description: 'Transfer taleplerini görür, sıraya alır, başlatır ve tamamlar.',
    permissions: ROLE_PERMISSIONS.depo_personeli,
  },
  {
    key: 'komisyon_b',
    label: 'Komisyon B',
    description: 'Yönetim düzeyi yetki rolü.',
    permissions: PERMISSION_CATALOG.map((item) => item.key),
  },
  {
    key: 'komisyon_c',
    label: 'Komisyon C',
    description: 'Yönetim düzeyi yetki rolü.',
    permissions: PERMISSION_CATALOG.map((item) => item.key),
  },
  {
    key: 'komisyon_v',
    label: 'Komisyon V',
    description: 'Yönetim düzeyi yetki rolü.',
    permissions: PERMISSION_CATALOG.map((item) => item.key),
  },
];

const ROLE_META = {
  admin: { label: 'Yönetici', icon: Crown, className: 'role-badge-admin', summary: 'Tam erişim - tüm modüller, ayarlar ve personel yönetimi' },
  cashier: { label: 'Kasiyer', icon: CreditCard, className: 'role-badge-cashier', summary: 'Satış işlemleri - kasa modülü ve ürün görüntüleme' },
  depo_personeli: { label: 'Depo Personeli', icon: Boxes, className: 'role-badge-user', summary: 'Transfer taleplerini yönetir ve operasyon akışını yürütür' },
  user: { label: 'Personel', icon: Briefcase, className: 'role-badge-user', summary: 'Operasyonel işlemler - stok, ürün, tedarikçi ve görevler' },
  komisyon_b: { label: 'Komisyon B', icon: UserCircle, className: 'role-badge-admin', summary: 'Komisyon B üyesi - yönetim düzeyi tam erişim.' },
  komisyon_c: { label: 'Komisyon C', icon: UserCircle, className: 'role-badge-admin', summary: 'Komisyon C üyesi - yönetim düzeyi tam erişim.' },
  komisyon_v: { label: 'Komisyon V', icon: UserCircle, className: 'role-badge-admin', summary: 'Komisyon V üyesi - yönetim düzeyi tam erişim.' },
};

function getRoleMeta(role, roleDefinitions) {
  if (ROLE_META[role]) {
    return ROLE_META[role];
  }

  const match = roleDefinitions.find((item) => item.key === role);
  return {
    label: match?.label || formatUserRole(role),
    icon: Briefcase,
    className: 'role-badge-user',
    summary: match?.description || 'Özel rol',
  };
}

function RoleBadge({ role, roleDefinitions }) {
  const meta = getRoleMeta(role, roleDefinitions);
  const Icon = meta.icon;
  return (
    <span className={`role-badge ${meta.className}`}>
      <Icon size={13} />
      {meta.label}
    </span>
  );
}

const initialForm = {
  name: '',
  username: '',
  email: '',
  password: '',
  role: 'user',
  department: '',
  assignedDeskCode: '',
  registerPin: '',
  isActive: true,
};

const DEPARTMENT_CLASS_KEY = {
  'satış': 'satis',
  operasyon: 'operasyon',
  finans: 'finans',
  it: 'it',
  'yönetim': 'yonetim',
};

const normalizeUnicodeText = (value) => String(value || '').normalize('NFC');

function DepartmentBadge({ value }) {
  const department = String(value || '').trim() || 'Operasyon';
  const normalizedDepartment = normalizeLookupValue(department);
  const key = DEPARTMENT_CLASS_KEY[normalizedDepartment] || 'operasyon';
  return <span className={`users-department-badge dept-${key}`}>{department}</span>;
}

function UserNameCell({ row }) {
  return (
    <div className="users-name-cell">
      {row.isActive ? <span className="users-name-status-dot" aria-hidden="true" /> : null}
      <span>{row.name || '-'}</span>
    </div>
  );
}

const normalizeLookupValue = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const buildUsageHint = (existingUser, fieldLabel) => {
  if (!existingUser) {
    return { state: 'available', message: `${fieldLabel} kullanılabilir.` };
  }

  if (existingUser.isActive) {
    return { state: 'in_use', message: `${fieldLabel} şu anda kullanılıyor.` };
  }

  if (existingUser.lastLoginAt) {
    return { state: 'used_before', message: `${fieldLabel} daha önce kullanıldı.` };
  }

  return { state: 'reserved', message: `${fieldLabel} daha önce alındı.` };
};

function PermissionSummary({ row }) {
  const effective = Array.isArray(row.effectivePermissions) ? row.effectivePermissions : [];
  const tooltip = effective.length ? effective.join('\n') : 'Rol bazlı izin bulunmuyor';
  const permissionCount = effective.includes('*') ?
    PERMISSION_CATALOG.length
    : effective.length;

  return (
    <div className="users-permission-cell" title={tooltip}>
      <span className="users-permission-count">{permissionCount}</span>
    </div>
  );
}

const formatDateTimeText = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '-';
  return date.toLocaleString('tr-TR');
};

const formatDateKey = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const sanitizePdfText = (value) => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text || '-';
};

const toSlug = (value) =>
  normalizeUnicodeText(value)
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

const loadXlsx = async () => {
  const mod = await import('xlsx');
  return mod.default || mod;
};

const loadPdfMake = async () => {
  const [pdfMakeModule, pdfFontsModule] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const pdfMake = pdfMakeModule.default || pdfMakeModule;
  const pdfFonts = pdfFontsModule.default || pdfFontsModule;
  if (!pdfMake.vfs || Object.keys(pdfMake.vfs).length === 0) {
    pdfMake.vfs = resolveEmbeddedPdfVfs(pdfFonts);
  }
  return pdfMake;
};

const resolveEmbeddedPdfVfs = (pdfFonts) => {
  const nestedVfs = pdfFonts?.pdfMake?.vfs || pdfFonts?.vfs || pdfFonts?.default?.pdfMake?.vfs || pdfFonts?.default?.vfs;
  if (nestedVfs && Object.keys(nestedVfs).length > 0) {
    return nestedVfs;
  }

  const rawFontMap = pdfFonts && typeof pdfFonts === 'object' ? pdfFonts : {};
  const directFontEntries = Object.entries(rawFontMap).filter(([key, value]) => key.toLowerCase().endsWith('.ttf') && typeof value === 'string');
  return directFontEntries.length ? Object.fromEntries(directFontEntries) : {};
};

const normalizeRoleKey = (value) =>
  normalizeUnicodeText(value)
    .toLocaleLowerCase('tr-TR')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');

const normalizeRoleDefinitions = (definitions) => {
  const roleMap = new Map();

  (definitions || []).forEach((item) => {
    const key = normalizeRoleKey(item?.key || item?.label);
    if (!key || /^cashier_b[1-8]$/.test(key)) {
      return;
    }

    const normalizedPermissions = Array.isArray(item?.permissions) ?
      Array.from(new Set(item.permissions.filter(Boolean)))
      : [];

    const previous = roleMap.get(key);
    if (previous) {
      roleMap.set(key, {
        ...previous,
        ...item,
        key,
        label: String(item?.label || previous.label || key),
        permissions: Array.from(new Set([...(previous.permissions || []), ...normalizedPermissions])),
      });
      return;
    }

    roleMap.set(key, {
      ...item,
      key,
      label: String(item?.label || key),
      permissions: normalizedPermissions,
    });
  });

  return Array.from(roleMap.values());
};

export default function Users() {
  const { user } = useAuth();
  const dialog = useDialog();
  const [users, setUsers] = useState([]);
  const [roleDefinitions, setRoleDefinitions] = useState(DEFAULT_ROLE_DEFINITIONS);
  const [departments, setDepartments] = useState(DEFAULT_DEPARTMENTS);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [filters, setFilters] = useState({ search: '', role: '', department: '', status: '' });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [managementMode, setManagementMode] = useState(false);
  const [managementPinGateOpen, setManagementPinGateOpen] = useState(false);
  const [activityModalUser, setActivityModalUser] = useState(null);
  const [activityRows, setActivityRows] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilters, setActivityFilters] = useState({ startDate: '', endDate: '', search: '' });

  const isAdmin = user?.role === 'admin';
  const canViewUsers = isAdmin || ['komisyon_b', 'komisyon_c', 'komisyon_v'].includes(user?.role);
  const hasManagementAccess = managementMode;

  const usageHints = useMemo(() => {
    const editingId = editingItem?.id;
    const usernameValue = normalizeLookupValue(form.username);
    const emailValue = normalizeLookupValue(form.email);
    const registerPinValue = String(form.registerPin || '').replace(/\D/g, '').slice(0, 4);

    const usernameOwner = usernameValue ?
      users.find((item) => item.id !== editingId && normalizeLookupValue(item.username) === usernameValue)
      : null;
    const emailOwner = emailValue ?
      users.find((item) => item.id !== editingId && normalizeLookupValue(item.email) === emailValue)
      : null;
    const registerPinOwner = registerPinValue.length === 4 ?
      users.find((item) => item.id !== editingId && String(item.registerPin || '') === registerPinValue)
      : null;

    return {
      username: usernameValue ? buildUsageHint(usernameOwner, 'Kullanıcı adı') : { state: 'empty', message: 'Örn: ayse.yilmaz' },
      email: emailValue ? buildUsageHint(emailOwner, 'E-posta') : { state: 'empty', message: 'Örn: ad.soyad@shelfio.com' },
      registerPin: registerPinValue.length === 4 ? buildUsageHint(registerPinOwner, 'Sicil no') : { state: 'empty', message: '' },
    };
  }, [editingItem?.id, form.email, form.registerPin, form.username, users]);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [usersData, settings] = await Promise.all([userService.list(), settingsService.get()]);
      setUsers(
        (usersData || []).map((item) => {
          if (typeof item.role === 'string' && /^cashier_b[1-8]$/.test(item.role)) {
            return { ...item, role: 'cashier' };
          }
          if (item.role === 'viewer') {
            const sequence = ['komisyon_b', 'komisyon_c', 'komisyon_v'];
            const index = Number(String(item.id || '').replace(/\D/g, '')) || 0;
            return { ...item, role: sequence[index % sequence.length] };
          }
          return item;
        })
      );
      const settingsDepartments = Array.isArray(settings.departments) && settings.departments.length
        ? settings.departments
        : DEFAULT_DEPARTMENTS;
      setDepartments(
        settingsDepartments
          .map((department, index) => ({
            id: String(department?.id || `department-${index + 1}`).trim(),
            name: String(department?.name || '').trim(),
            isActive: department?.isActive !== false,
          }))
          .filter((department) => department.name)
      );

      if (Array.isArray(settings.roleDefinitions) && settings.roleDefinitions.length > 0) {
        const mergedDefinitions = normalizeRoleDefinitions(settings.roleDefinitions);
        for (const def of DEFAULT_ROLE_DEFINITIONS) {
          if (!mergedDefinitions.some((item) => item.key === def.key)) {
            mergedDefinitions.push(def);
          }
        }
        setRoleDefinitions(mergedDefinitions.filter((item) => item.key !== 'viewer'));
      } else {
        setRoleDefinitions(normalizeRoleDefinitions(DEFAULT_ROLE_DEFINITIONS));
      }
    } catch (error) {
      setToast({ type: 'error', title: 'Personel', message: error.message || 'Personel listesi yuklenemedi.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (canViewUsers) {
      loadData();
    }
  }, [canViewUsers]);

  useEffect(() => {
    if (!activityModalUser?.id) {
      setActivityRows([]);
      return;
    }

    let active = true;
    setActivityFilters({ startDate: '', endDate: '', search: '' });
    setActivityLoading(true);
    userService
      .listActivities(activityModalUser.id, { limit: 20 })
      .then((rows) => {
        if (!active) return;
        setActivityRows(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (!active) return;
        setToast({ type: 'error', title: 'Personel', message: error.message || 'İşlem geçmişi yüklenemedi.' });
        setActivityRows([]);
      })
      .finally(() => {
        if (active) setActivityLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activityModalUser]);

  const deactivateManagementMode = () => {
    setManagementMode(false);
  };

  const roleOptions = useMemo(() => {
    const keys = new Set(SYSTEM_ROLES);
    roleDefinitions.forEach((role) => {
      if (role?.key) {
        keys.add(role.key);
      }
    });

    return Array.from(keys).sort((left, right) => {
      const rankDiff = (ROLE_ORDER[left] ?? 99) - (ROLE_ORDER[right] ?? 99);
      if (rankDiff !== 0) return rankDiff;
      return getRoleMeta(left, roleDefinitions).label.localeCompare(getRoleMeta(right, roleDefinitions).label, 'tr');
    });
  }, [roleDefinitions]);

  const roleSelectOptions = useMemo(
    () => roleOptions.map((roleKey) => ({
      value: roleKey,
      label: getRoleMeta(roleKey, roleDefinitions).label,
      secondary: getRoleMeta(roleKey, roleDefinitions).summary,
      searchText: `${roleKey} ${getRoleMeta(roleKey, roleDefinitions).label}`,
    })),
    [roleDefinitions, roleOptions]
  );

  const departmentSelectOptions = useMemo(
    () => departments
      .filter((department) => department.isActive !== false)
      .map((department) => ({ value: department.name, label: department.name })),
    [departments]
  );

  const filteredRows = useMemo(() => {
    return users
      .filter((item) => {
        const matchesSearch = !filters.search || [item.name, item.username, item.email, item.registerPin].filter(Boolean).some((value) => String(value).toLowerCase().includes(filters.search.toLowerCase()));
        const matchesRole = !filters.role || item.role === filters.role;
        const matchesDepartment = !filters.department || item.department === filters.department;
        const matchesStatus = !filters.status || String(item.isActive) === filters.status;
        return matchesSearch && matchesRole && matchesDepartment && matchesStatus;
      })
      .sort((a, b) => {
        const roleDiff = (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99);
        if (roleDiff !== 0) return roleDiff;
        return (a.name || '').localeCompare(b.name || '', 'tr');
      });
  }, [filters, users]);

  const columns = [
    { key: 'name', label: 'Ad Soyad', render: (row) => <UserNameCell row={row} />, sortable: true },
    { key: 'username', label: 'Kullanıcı Adı' },
    { key: 'email', label: 'E-posta' },
    { key: 'role', label: 'Rol', render: (row) => <RoleBadge role={row.role} roleDefinitions={roleDefinitions} />, sortable: false },
    { key: 'department', label: 'Departman', render: (row) => <DepartmentBadge value={row.department} />, sortable: false },
    { key: 'permissionVisibility', label: 'Yetki Sayısı', render: (row) => <PermissionSummary row={row} />, sortable: false },
    { key: 'assignedDeskCode', label: 'Kasa', render: (row) => (row.assignedDeskCode ? (DESK_LABELS[row.assignedDeskCode] || row.assignedDeskCode) : '-') },
    { key: 'registerPin', label: 'Sicil No', render: (row) => row.registerPin || '-' },
    { key: 'isActive', label: 'Hesap Durumu', render: (row) => <span className={`status-pill ${row.isActive ? 'status-active' : 'status-inactive'}`}>{row.isActive ? 'Aktif' : 'Pasif'}</span>, sortable: false },
    {
      key: 'lastLoginAt',
      label: 'Son Giriş',
      render: (row) => (
        <div className="users-last-login-cell">
          <span>{formatDate(row.lastLoginAt)}</span>
        </div>
      ),
    },
    {
      key: 'lastActionLabel',
      label: 'Son İşlem',
      render: (row) => (
        <div className="users-last-login-cell">
          <span>{row.lastActionLabel || '-'}</span>
          <small>{row.lastActionAt ? formatDate(row.lastActionAt) : 'Kayıt yok'}</small>
        </div>
      ),
      sortable: false,
    },
    {
      key: 'actions',
      label: 'İşlemler',
      sortable: false,
      render: (row) => {
        const openEdit = () => {
          setEditingItem(row);
          setForm({
            name: row.name || '',
            username: row.username || '',
            email: row.email || '',
            password: '',
            role: row.role || 'user',
            department: row.department || '',
            assignedDeskCode: row.assignedDeskCode || '',
            registerPin: row.registerPin || '',
            isActive: row.isActive,
          });
          setFieldErrors({});
          setIsModalOpen(true);
        };

        const handleDelete = async () => {
          const confirmed = await dialog.confirm({
            title: 'Personeli Sil',
            description: `${row.name || row.username} kullanıcısını silmek istiyor musunuz?`,
            confirmText: 'Sil',
            cancelText: 'Vazgeç',
            variant: 'error',
            closeOnBackdrop: false,
          });
          if (!confirmed) {
            return;
          }

          try {
            await userService.remove(row.id);
            setToast({ type: 'success', title: 'Personel', message: 'Personel kaydı silindi.' });
            await loadData();
          } catch (error) {
            setToast({ type: 'error', title: 'Personel', message: error.message || 'Kullanıcı silinemedi.' });
          }
        };

        return (
          <div className="users-row-actions">
            <button
              className="text-button users-edit-btn"
              type="button"
              disabled={!hasManagementAccess}
              title={!hasManagementAccess ? 'Düzenleme için önce Yönetim Moduna geçin' : 'Personeli düzenle'}
              onClick={() => {
                if (!hasManagementAccess) {
                  setToast({ type: 'error', title: 'Yönetim Modu', message: 'Düzenleme için önce Yönetim Moduna geçin.' });
                  return;
                }
                openEdit();
              }}
            >
              Düzenle
            </button>

            {hasManagementAccess ? (
              <>
                <button className="text-button users-view-btn" type="button" onClick={() => setActivityModalUser(row)}>
                  <Eye size={13} /> Görüntüle
                </button>
                <button className="users-delete-btn" type="button" onClick={() => { void handleDelete(); }} title="Personeli sil">
                  <X size={13} />
                </button>
              </>
            ) : null}
          </div>
        );
      },
    },
  ];

  const selectedActivityRows = useMemo(() => {
    return [...activityRows].sort((left, right) => new Date(right.at || 0).getTime() - new Date(left.at || 0).getTime());
  }, [activityRows]);

  const filteredActivityRows = useMemo(() => {
    const searchText = String(activityFilters.search || '').trim().toLocaleLowerCase('tr-TR');
    const startDate = String(activityFilters.startDate || '').trim();
    const endDate = String(activityFilters.endDate || '').trim();

    return selectedActivityRows.filter((item) => {
      const matchesSearch = !searchText
        || [item.type, item.detail, item.module, item.reference]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('tr-TR').includes(searchText));
      const itemDateKey = formatDateKey(item.at);
      const matchesStart = !startDate || (itemDateKey && itemDateKey >= startDate);
      const matchesEnd = !endDate || (itemDateKey && itemDateKey <= endDate);
      return matchesSearch && matchesStart && matchesEnd;
    });
  }, [activityFilters.endDate, activityFilters.search, activityFilters.startDate, selectedActivityRows]);

  const handleExportActivityXlsx = async () => {
    if (!activityModalUser) return;
    const XLSX = await loadXlsx();
    const rows = filteredActivityRows.map((item) => ({
      Modül: item.module || '-',
      Referans: item.reference || '-',
      Kategori: item.type,
      Detay: item.detail,
      Tarih: formatDateTimeText(item.at),
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Kategori: '-', Detay: '-', Tarih: '-' }]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Personel Islemleri');
    XLSX.writeFile(workbook, `${activityModalUser.username || 'personel'}-son-islemler.xlsx`);
  };

  const handleExportActivityPdf = async () => {
    if (!activityModalUser) return;
    const pdfMake = await loadPdfMake();

    const personName = sanitizePdfText(activityModalUser.name || activityModalUser.username);
    const personEmail = sanitizePdfText(activityModalUser.email);
    const reportDate = formatDateTimeText(new Date().toISOString());

    const infoRows = [
      [{ text: 'Personel:', style: 'infoLabel' }, { text: personName, style: 'infoValue' }],
      [{ text: 'E-posta:', style: 'infoLabel' }, { text: personEmail, style: 'infoValue' }],
      [{ text: 'Rapor Tarihi:', style: 'infoLabel' }, { text: reportDate, style: 'infoValue' }],
    ];

    const recordBlocks = filteredActivityRows.length
      ? filteredActivityRows.map((item) => ({
          unbreakable: true,
          margin: [0, 0, 0, 12],
          table: {
            widths: ['*'],
            body: [
              [
                {
                  margin: [12, 10, 12, 10],
                  stack: [
                    { text: sanitizePdfText(item.type), style: 'recordTitle' },
                    { text: sanitizePdfText(`${item.module || '-'} • ${item.reference || '-'}`), style: 'recordMeta', margin: [0, 4, 0, 0] },
                    { text: sanitizePdfText(item.detail), style: 'recordDetail', margin: [0, 6, 0, 0] },
                    { text: sanitizePdfText(formatDateTimeText(item.at)), style: 'recordMeta', margin: [0, 8, 0, 0] },
                  ],
                },
              ],
            ],
          },
          layout: {
            hLineColor: () => '#d8e1ee',
            vLineColor: () => '#d8e1ee',
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 0,
            fillColor: () => '#ffffff',
          },
        }))
      : [
          {
            unbreakable: true,
            margin: [0, 0, 0, 12],
            table: {
              widths: ['*'],
              body: [[{ text: 'Bu kullanıcı için işlem kaydı bulunmuyor.', style: 'emptyText', margin: [12, 14, 12, 14] }]],
            },
            layout: {
              hLineColor: () => '#dfe6f0',
              vLineColor: () => '#dfe6f0',
              hLineWidth: () => 1,
              vLineWidth: () => 1,
              paddingLeft: () => 0,
              paddingRight: () => 0,
              paddingTop: () => 0,
              paddingBottom: () => 0,
              fillColor: () => '#fafbfe',
            },
          },
        ];

    const docDefinition = {
      pageSize: 'A4',
      pageOrientation: 'portrait',
      pageMargins: [52, 56, 52, 52],
      defaultStyle: {
        font: 'Roboto',
        fontSize: 10.5,
        lineHeight: 1.28,
        color: '#243447',
      },
      footer: (currentPage, pageCount) => ({
        margin: [52, 0, 52, 18],
        columns: [
          { text: '' },
          { text: `Sayfa ${currentPage}/${pageCount}`, alignment: 'right', fontSize: 8.5, color: '#7a8294' },
        ],
      }),
      content: [
        { text: 'Personel Son İşlem Raporu', style: 'reportTitle' },
        {
          canvas: [
            {
              type: 'line',
              x1: 0,
              y1: 0,
              x2: 491,
              y2: 0,
              lineWidth: 1,
              lineColor: '#cdd6e4',
            },
          ],
          margin: [0, 10, 0, 18],
        },
        {
          margin: [0, 0, 0, 22],
          table: {
            widths: ['*'],
            body: [
              [
                {
                  table: {
                    widths: [118, '*'],
                    body: infoRows,
                  },
                  layout: 'noBorders',
                  margin: [12, 10, 12, 10],
                },
              ],
            ],
          },
          layout: {
            hLineColor: () => '#dfe7f2',
            vLineColor: () => '#dfe7f2',
            hLineWidth: () => 1,
            vLineWidth: () => 1,
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: () => 0,
            paddingBottom: () => 0,
            fillColor: () => '#f7faff',
          },
        },
        { text: 'İşlem Kayıtları', style: 'sectionTitle', margin: [0, 0, 0, 10] },
        ...recordBlocks,
      ],
      styles: {
        reportTitle: {
          fontSize: 22,
          bold: true,
          color: '#12233e',
          lineHeight: 1.15,
        },
        sectionTitle: {
          fontSize: 13,
          bold: true,
          color: '#18223a',
        },
        infoLabel: {
          bold: true,
          color: '#26354c',
          margin: [0, 3, 0, 5],
        },
        infoValue: {
          color: '#37435a',
          margin: [0, 3, 0, 5],
        },
        recordTitle: {
          fontSize: 12,
          bold: true,
          color: '#142137',
        },
        recordDetail: {
          fontSize: 11,
          color: '#364257',
        },
        recordMeta: {
          fontSize: 9.5,
          color: '#6d7a91',
        },
        emptyText: {
          fontSize: 11,
          color: '#59657c',
        },
      },
    };

    const baseSlug = toSlug(activityModalUser.name || activityModalUser.username || 'personel') || 'personel';
    pdfMake.createPdf(docDefinition).download(`personel-son-islem-raporu-${baseSlug}.pdf`);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const errors = {};
    const name = form.name.trim();
    const username = form.username.trim();
    const email = form.email.trim();
    const password = form.password.trim();

    if (!name) errors.name = 'Ad Soyad zorunludur.';
    if (!username) errors.username = 'Kullanıcı Adı zorunludur.';
    if (!email) {
      errors.email = 'E-posta zorunludur.';
    } else if (!/^\S+@\S+\.\S+$/.test(email)) {
      errors.email = 'Geçerli bir e-posta girin.';
    }
    if (!form.role) errors.role = 'Rol seçimi zorunludur.';
    if (!form.department) errors.department = 'Departman seçimi zorunludur.';
    if (!editingItem && !password) {
      errors.password = 'Şifre zorunludur.';
    } else if (editingItem && password && !hasManagementAccess) {
      errors.password = 'Şifre güncellemek için önce Yönetim Moduna geçin.';
    }

    const assignedDeskCode = form.assignedDeskCode;
    const registerPin = String(form.registerPin || '').replace(/\D/g, '').slice(0, 4);

    if (isCashierRole(form.role) && !assignedDeskCode) {
      errors.assignedDeskCode = 'Kasiyer için kasa ataması zorunludur.';
    }

    if (!/^\d{4}$/.test(registerPin)) {
      errors.registerPin = 'Sicil No 4 haneli olmalıdır.';
    }

    if (usageHints.username.state !== 'available') {
      errors.username = usageHints.username.message;
    }

    if (usageHints.email.state !== 'available') {
      errors.email = usageHints.email.message;
    }

    if (usageHints.registerPin.state !== 'available') {
      errors.registerPin = usageHints.registerPin.message;
    }

    if (typeof form.isActive !== 'boolean') {
      errors.isActive = 'Personel durumu zorunludur.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setToast({ type: 'error', title: 'Personel', message: 'Lütfen zorunlu alanları kontrol edin.' });
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        ...form,
        password: form.password.trim(),
        assignedDeskCode: isCashierRole(form.role) ? assignedDeskCode : null,
        registerPin,
      };

      if (editingItem && isProtectedSuperAdmin(editingItem) && payload.role !== 'admin') {
        setToast({ type: 'error', title: 'Super Admin', message: 'Bu kullanıcının rolü değiştirilemez.' });
        return;
      }

      if (editingItem) {
        if (payload.password && !hasManagementAccess) {
          setToast({ type: 'error', title: 'Yönetim Modu', message: 'Şifre güncellemek için önce Yönetim Moduna geçin.' });
          return;
        }
        if (!payload.password) {
          delete payload.password;
        }
        await userService.update(editingItem.id, payload);
        setToast({ type: 'success', title: 'Personel', message: 'Personel kaydı güncellendi.' });
      } else {
        await userService.create(payload);
        setToast({ type: 'success', title: 'Personel', message: 'Yeni personel eklendi.' });
      }

      setIsModalOpen(false);
      setEditingItem(null);
      setForm(initialForm);
      setFieldErrors({});
      await loadData();
    } catch (error) {
      setToast({ type: 'error', title: 'Personel', message: error.message || 'İşlem başarısız.' });
    } finally {
      setSubmitting(false);
    }
  };

  const isFormInvalid = useMemo(() => {
    const name = form.name.trim();
    const username = form.username.trim();
    const email = form.email.trim();
    const password = form.password.trim();
    const registerPin = String(form.registerPin || '').replace(/\D/g, '').slice(0, 4);

    if (!name || !username || !email || !form.role) {
      return true;
    }

    if (!form.department) {
      return true;
    }

    if (!editingItem && !password) {
      return true;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return true;
    }
    if (usageHints.username.state !== 'available') {
      return true;
    }
    if (usageHints.email.state !== 'available') {
      return true;
    }
    if (usageHints.registerPin.state !== 'available') {
      return true;
    }
    if (!/^\d{4}$/.test(registerPin)) {
      return true;
    }
    if (editingItem && password && !hasManagementAccess) {
      return true;
    }
    if (typeof form.isActive !== 'boolean') {
      return true;
    }
    if (isCashierRole(form.role) && !form.assignedDeskCode) {
      return true;
    }
    return false;
  }, [editingItem, form, hasManagementAccess, usageHints]);

  const handleGenerateRegisterPin = () => {
    const excluded = new Set(
      users
        .filter((item) => item.id !== editingItem?.id)
        .map((item) => String(item.registerPin || '').trim())
        .filter((value) => /^\d{4}$/.test(value))
    );

    for (let attempt = 0; attempt < 300; attempt += 1) {
      const candidate = String(1000 + Math.floor(Math.random() * 9000));
      if (!excluded.has(candidate)) {
        setForm((current) => ({ ...current, registerPin: candidate }));
        setFieldErrors((current) => ({ ...current, registerPin: '' }));
        return;
      }
    }

    setToast({ type: 'error', title: 'Personel', message: 'Uygun sicil no üretilemedi. Tekrar deneyin.' });
  };

  if (!canViewUsers) {
    return (
      <div className="page-stack users-page-stack">
        <PageHeader className="dashboard-hero" icon={<Shield size={22} />} title="Yetki Gerekiyor" description="Bu alan yalnızca yönetici personel içindir." />
        <div className="panel-card empty-block">Personel yönetim paneline erişmek için yönetici yetkisi gereklidir.</div>
      </div>
    );
  }

  return (
    <div className="page-stack users-page-stack">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageHeader className="dashboard-hero" icon={<UsersIcon size={22} />} title="Personel Yönetim Paneli" description="Personel hesaplarını, rollerini ve kasa atamalarını yönetin." actions={<button className="primary-button" type="button" onClick={() => { setEditingItem(null); setForm(initialForm); setFieldErrors({}); setIsModalOpen(true); }}><UserPlus size={16} /> Yeni Personel</button>} />

      <div className="mod-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-indigo"><Filter size={18} /></div>
          <div>
            <h3 className="mod-card-title">Personel Filtrele</h3>
            <p className="mod-card-desc">Personeli ad, rol, durum ve sicil numarasına göre hızlıca filtreleyin</p>
          </div>
        </div>
        <FilterBar>
          <label className="field-group"><span>Arama</span><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Ad soyad, kullanıcı adı, e-posta veya sicil no ara" /></label>
          <label className="field-group"><span>Rol</span><select value={filters.role} onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}><option value="">Tüm Roller</option>{roleOptions.map((roleKey) => <option key={roleKey} value={roleKey}>{getRoleMeta(roleKey, roleDefinitions).label}</option>)}</select></label>
          <label className="field-group"><span>Departman</span><select value={filters.department} onChange={(event) => setFilters((current) => ({ ...current, department: event.target.value }))}><option value="">Tüm Departmanlar</option>{departments.map((item) => <option key={item.id || item.name} value={item.name}>{item.name}{item.isActive === false ? ' (Pasif)' : ''}</option>)}</select></label>
          <label className="field-group status-filter-field" aria-label="Durum filtresi">
            <div className="status-filter-toggle" role="group" aria-label="Kullanıcı durumu filtreleme">
              <button
                type="button"
                className={`status-filter-btn status-filter-all ${filters.status === '' ? 'is-selected' : ''}`}
                onClick={() => setFilters((current) => ({ ...current, status: '' }))}
              >
                Tüm Durumlar
              </button>
              <button
                type="button"
                className={`status-filter-btn status-filter-active ${filters.status === 'true' ? 'is-selected' : ''}`}
                onClick={() => setFilters((current) => ({ ...current, status: 'true' }))}
              >
                Aktif
              </button>
              <button
                type="button"
                className={`status-filter-btn status-filter-passive ${filters.status === 'false' ? 'is-selected' : ''}`}
                onClick={() => setFilters((current) => ({ ...current, status: 'false' }))}
              >
                Pasif
              </button>
            </div>
          </label>
        </FilterBar>
      </div>

      <div className="mod-card users-list-card">
          <div className="mod-card-header users-list-header">
            <div className="mod-card-header-main">
              <div className="mod-card-icon mod-icon-blue"><UsersIcon size={18} /></div>
              <div className="users-list-header-copy">
                <h3 className="mod-card-title">Personel Listesi</h3>
                <p className="mod-card-desc">{filteredRows.length} personel görüntüleniyor</p>
              </div>
          </div>
          <div className="users-list-header-actions">
            <button
              type="button"
              className={`users-management-btn ${managementMode ? 'is-active' : ''}`}
              title="Personel düzenleme modunu açar veya kapatır."
              onClick={() => {
                if (managementMode) {
                  deactivateManagementMode();
                  return;
                }
                setManagementPinGateOpen(true);
              }}
            >
              {managementMode ? <LockOpen size={15} /> : <Lock size={15} />}
              {managementMode ? 'Düzenleme Modunu Kapat' : 'Düzenleme Modunu Aç'}
            </button>
          </div>
        </div>
        <div className="users-list-scroll">
          <DataTable columns={columns} rows={filteredRows} isLoading={isLoading} emptyMessage="Personel kaydı bulunmuyor." pageSize={10} />
        </div>
      </div>

      <FormModal
        isOpen={isModalOpen}
        title={editingItem ? 'Personel Düzenle' : 'Yeni Personel Ekle'}
        description={editingItem ? 'Seçili personel bilgilerini bu alandan güncelleyebilirsiniz.' : 'Bu kısımdan yeni personel ekleyebilirsiniz.'}
        headerIcon={editingItem ? <UsersIcon size={17} /> : <UserPlus size={17} />}
        onClose={() => { setIsModalOpen(false); setFieldErrors({}); }}
        modalClassName="users-edit-modal"
      >
        <form className="modal-form modal-structured-form users-edit-form" onSubmit={handleSubmit}>
          <div className="modal-form-body-scroll users-edit-scroll">
            <div className="form-grid two-columns">
            <label className={`field-group users-col-3 ${fieldErrors.name ? 'has-error' : ''}`}>
              <span>Ad Soyad <em className="required-mark">*</em></span>
              <input
                required
                placeholder="Örn: Ayşe Yılmaz"
                value={form.name}
                onChange={(event) => {
                  setForm((current) => ({ ...current, name: event.target.value }));
                  setFieldErrors((current) => ({ ...current, name: '' }));
                }}
              />
              {fieldErrors.name ? <small className="users-field-error">{fieldErrors.name}</small> : null}
            </label>
            <label className={`field-group users-col-3 ${fieldErrors.username ? 'has-error' : ''}`}>
              <span>Kullanıcı Adı <em className="required-mark">*</em></span>
              <input
                required
                placeholder="Örn: ayse.yilmaz"
                value={form.username}
                onChange={(event) => {
                  setForm((current) => ({ ...current, username: event.target.value }));
                  setFieldErrors((current) => ({ ...current, username: '' }));
                }}
              />
              {fieldErrors.username ? <small className="users-field-error">{fieldErrors.username}</small> : null}
              {!fieldErrors.username ? <small className={`users-field-help users-usage-${usageHints.username.state}`}>{usageHints.username.message}</small> : null}
            </label>
            <label className={`field-group users-col-4 ${fieldErrors.email ? 'has-error' : ''}`}>
              <span>E-posta <em className="required-mark">*</em></span>
              <input
                required
                type="email"
                placeholder="Örn: ad.soyad@shelfio.com"
                value={form.email}
                onChange={(event) => {
                  setForm((current) => ({ ...current, email: event.target.value }));
                  setFieldErrors((current) => ({ ...current, email: '' }));
                }}
              />
              {fieldErrors.email ? <small className="users-field-error">{fieldErrors.email}</small> : null}
              {!fieldErrors.email ? <small className={`users-field-help users-usage-${usageHints.email.state}`}>{usageHints.email.message}</small> : null}
            </label>
            {!editingItem && (
              <label className={`field-group users-col-2 users-password-inline ${fieldErrors.password ? 'has-error' : ''}`}>
                <span>Şifre <em className="required-mark">*</em></span>
                <input
                  required
                  type="text"
                  placeholder="Örn: 1234"
                  value={form.password}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, password: event.target.value }));
                    setFieldErrors((current) => ({ ...current, password: '' }));
                  }}
                />
                {fieldErrors.password ? <small className="users-field-error">{fieldErrors.password}</small> : null}
              </label>
            )}
            <label className={`field-group users-col-4 users-combobox-field ${fieldErrors.role ? 'has-error' : ''}`}>
              <span>Rol <em className="required-mark">*</em></span>
              <SearchableCombobox
                options={roleSelectOptions}
                value={form.role}
                ariaLabel="Rol seçimi"
                placeholder="Rol seçin"
                disabled={Boolean(editingItem) && isProtectedSuperAdmin(editingItem)}
                onChange={(event) => {
                  setForm((current) => ({ ...current, role: event || '', assignedDeskCode: isCashierRole(event) ? current.assignedDeskCode : '' }));
                  setFieldErrors((current) => ({ ...current, role: '', assignedDeskCode: '' }));
                }}
              />
              {Boolean(editingItem) && isProtectedSuperAdmin(editingItem) ? <small className="users-field-help">Bu hesap super admin olarak korunur ve rolü değiştirilemez.</small> : null}
              {fieldErrors.role ? <small className="users-field-error">{fieldErrors.role}</small> : null}
            </label>
            <label className={`field-group users-col-4 users-combobox-field ${fieldErrors.department ? 'has-error' : ''}`}>
              <span>Departman <em className="required-mark">*</em></span>
              <SearchableCombobox
                options={departmentSelectOptions}
                value={form.department}
                ariaLabel="Departman seçimi"
                placeholder="Departman seçin"
                onChange={(value) => {
                  setForm((current) => ({ ...current, department: value || '' }));
                  setFieldErrors((current) => ({ ...current, department: '' }));
                }}
              />
              {fieldErrors.department ? <small className="users-field-error">{fieldErrors.department}</small> : null}
            </label>
            <label className={`field-group users-col-2 ${fieldErrors.registerPin ? 'has-error' : ''}`}>
              <span>Sicil No <em className="required-mark">*</em></span>
              <div className="users-inline-input-action">
                <input
                  required
                  inputMode="numeric"
                  maxLength={4}
                  value={form.registerPin}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, registerPin: event.target.value.replace(/\D/g, '').slice(0, 4) }));
                    setFieldErrors((current) => ({ ...current, registerPin: '' }));
                  }}
                  placeholder="0007"
                />
                <button type="button" className="users-inline-action-btn" onClick={handleGenerateRegisterPin} title="Rastgele sicil no üret">
                  <Shuffle size={14} />
                </button>
              </div>
              {fieldErrors.registerPin ? <small className="users-field-error">{fieldErrors.registerPin}</small> : null}
              {!fieldErrors.registerPin && usageHints.registerPin.message ? <small className={`users-field-help users-usage-${usageHints.registerPin.state}`}>{usageHints.registerPin.message}</small> : null}
            </label>
            <label className={`field-group users-col-2 user-active-field user-active-compact ${fieldErrors.isActive ? 'has-error' : ''}`}>
              <span>Personel Durumu <em className="required-mark">*</em></span>
              <button
                type="button"
                className={`user-status-switch ${form.isActive ? 'is-active' : 'is-passive'}`}
                onClick={() => {
                  setForm((current) => ({ ...current, isActive: !current.isActive }));
                  setFieldErrors((current) => ({ ...current, isActive: '' }));
                }}
                aria-pressed={form.isActive}
                aria-label="Kullanıcı aktiflik durumu"
              >
                <span className="user-status-switch-indicator" />
                <span className="user-status-switch-option option-passive">Pasif</span>
                <span className="user-status-switch-option option-active">Aktif</span>
              </button>
              {fieldErrors.isActive ? <small className="users-field-error">{fieldErrors.isActive}</small> : null}
            </label>
            {isCashierRole(form.role) && (
              <label className={`field-group users-col-3 ${fieldErrors.assignedDeskCode ? 'has-error' : ''}`}>
                <span>Kasa Ataması <em className="required-mark">*</em></span>
                <select required value={form.assignedDeskCode} onChange={(event) => { setForm((current) => ({ ...current, assignedDeskCode: event.target.value })); setFieldErrors((current) => ({ ...current, assignedDeskCode: '' })); }}>
                  <option value="">Kasa Seçin</option>
                  {DESK_OPTIONS.map((code) => <option key={code} value={code}>{DESK_LABELS[code] || code}</option>)}
                </select>
                {fieldErrors.assignedDeskCode ? <small className="users-field-error">{fieldErrors.assignedDeskCode}</small> : null}
              </label>
            )}
            {editingItem && (
              <label className="field-group users-col-6 users-password-compact users-current-password">
                <span>Mevcut Şifre</span>
                <input type="text" value={editingItem.passwordText || 'Kayıtlı şifre bilgisi bulunamadı'} readOnly className="users-password-preview" />
              </label>
            )}
            {editingItem && (
              <label className={`field-group users-col-6 users-password-compact users-new-password ${fieldErrors.password ? 'has-error' : ''}`}>
                <span>Yeni Şifre (Opsiyonel)</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, password: event.target.value }));
                    setFieldErrors((current) => ({ ...current, password: '' }));
                  }}
                  disabled={Boolean(editingItem) && !hasManagementAccess}
                  placeholder={editingItem && !hasManagementAccess ? 'Şifre değiştirmek için Yönetim Moduna geçin' : ''}
                />
                {fieldErrors.password ? <small className="users-field-error">{fieldErrors.password}</small> : null}
                {editingItem && !hasManagementAccess ? <small className="users-field-help">Şifre güncelleme için bu kartın sağ üstünden Yönetim Moduna geçin.</small> : null}
              </label>
            )}
            </div>
          </div>
          <div className="modal-actions"><button className="ghost-button" type="button" onClick={() => { setIsModalOpen(false); setFieldErrors({}); }}>İptal</button><button className="primary-button" type="submit" disabled={submitting || isFormInvalid}>{submitting ? 'Kaydediliyor...' : editingItem ? 'Güncelle' : 'Kaydet'}</button></div>
        </form>
      </FormModal>

      <FormModal
        isOpen={Boolean(activityModalUser)}
        title="Personel Son İşlemleri"
        description="Seçilen personelin son işlem ve aktivite geçmişi."
        headerIcon={<ClipboardList size={18} />}
        headerActions={(
          <div className="users-activity-modal-header-actions">
            <button type="button" className="ghost-button users-activity-action-btn" onClick={handleExportActivityXlsx}>
              <FileSpreadsheet size={14} /> Excel İndir
            </button>
            <button type="button" className="ghost-button users-activity-action-btn" onClick={handleExportActivityPdf}>
              <FileText size={14} /> PDF İndir
            </button>
          </div>
        )}
        onClose={() => setActivityModalUser(null)}
        modalClassName="users-activity-modal"
      >
        <div className="modal-form modal-structured-form users-activity-modal-body">
          <div className="modal-form-body-scroll users-activity-modal-scroll">
            <section className="modal-form-section users-activity-modal-section">
              <div className="users-activity-filter-bar" role="group" aria-label="İşlem geçmişi filtreleri">
                <label className="users-activity-filter-field users-activity-filter-search">
                  <span>Arama</span>
                  <InputWithIcon
                    className="users-activity-search-input"
                    icon={<Search size={13} />}
                    type="search"
                    value={activityFilters.search}
                    onChange={(event) => setActivityFilters((current) => ({ ...current, search: event.target.value }))}
                    placeholder="İşlem türü veya detay ara"
                  />
                </label>
                <label className="users-activity-filter-field users-activity-filter-date">
                  <span><CalendarDays size={13} /> Başlangıç</span>
                  <input
                    type="date"
                    value={activityFilters.startDate}
                    onChange={(event) => setActivityFilters((current) => ({ ...current, startDate: event.target.value }))}
                  />
                </label>
                <label className="users-activity-filter-field users-activity-filter-date">
                  <span><CalendarDays size={13} /> Bitiş</span>
                  <input
                    type="date"
                    value={activityFilters.endDate}
                    onChange={(event) => setActivityFilters((current) => ({ ...current, endDate: event.target.value }))}
                  />
                </label>
              </div>

              <div className="users-activity-log-list">
                {filteredActivityRows.length ? (
                  filteredActivityRows.map((item) => (
                    <article key={item.id || `${item.type}-${item.at || 'no-date'}`} className="users-activity-log-item">
                      <div className="users-activity-log-head">
                        <strong>{item.type}</strong>
                        <small>{formatDateTimeText(item.at)}</small>
                      </div>
                      <small>{`${item.module || '-'} • ${item.reference || '-'}`}</small>
                      <span>{item.detail}</span>
                    </article>
                  ))
                ) : (
                  <div className="s-empty-state users-activity-empty-state">
                    {activityLoading ? 'İşlem geçmişi yükleniyor.' : activityFilters.startDate || activityFilters.endDate || activityFilters.search ?
                      'Filtreye uygun işlem kaydı bulunamadı.'
                      : 'Bu kullanıcı için işlem kaydı bulunmuyor.'}
                  </div>
                )}
              </div>
            </section>
          </div>
          <div className="modal-actions modal-actions-sticky users-activity-modal-footer">
            <button type="button" className="ghost-button" onClick={() => setActivityModalUser(null)}>
              Kapat
            </button>
          </div>
        </div>
      </FormModal>

      {managementPinGateOpen ? (
        <PinGate
          title="Personel Düzenleme Yetkisi"
          description="Düzenleme modunu açmak için 4 haneli PIN kodunu girin."
          type="role-management"
          onSuccess={() => {
            setManagementMode(true);
            setManagementPinGateOpen(false);
          }}
          onCancel={() => setManagementPinGateOpen(false)}
        />
      ) : null}

    </div>
  );
}
