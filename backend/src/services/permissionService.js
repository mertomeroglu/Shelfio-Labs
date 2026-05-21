import { DEPARTMENT_PERMISSION_RULES, ROLE_PERMISSIONS } from '../config/permissions.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { temporaryPermissionGrantRepo } from '../repositories/temporaryPermissionGrantRepository.js';

const normalizeStoreId = (value) => String(value || 'store-main').trim() || 'store-main';
const hasWildcard = (permissions = []) => permissions.includes('*');
const IMPLIED_PERMISSIONS = {
  'proximity:manage': [
    'proximity:view',
    'proximity:beacons:manage',
    'proximity:zones:manage',
    'proximity:rules:manage',
    'proximity:logs:view',
  ],
};

const expandPermissions = (permissions = []) => {
  const expanded = new Set(permissions);
  permissions.forEach((permission) => {
    (IMPLIED_PERMISSIONS[permission] || []).forEach((implied) => expanded.add(implied));
  });
  return Array.from(expanded);
};

const normalizeDepartmentName = (value, fallbackRole = 'user') => {
  const source = String(value || '').trim();
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (raw === 'satış' || raw === 'satis') return 'Satış';
  if (raw === 'operasyon') return 'Operasyon';
  if (raw === 'finans') return 'Finans';
  if (raw === 'it') return 'IT';
  if (raw === 'yönetim' || raw === 'yonetim') return 'Yönetim';
  if (source) return source;
  if (fallbackRole === 'admin' || fallbackRole === 'komisyon_b') return 'Yönetim';
  if (fallbackRole === 'komisyon_c') return 'Finans';
  if (fallbackRole === 'cashier') return 'Satış';
  return 'Operasyon';
};

const normalizeRuleSet = (rule = {}) => ({
  allow: Array.from(new Set((Array.isArray(rule?.allow) ? rule.allow : []).map((item) => String(item || '').trim()).filter(Boolean))),
  deny: Array.from(new Set((Array.isArray(rule?.deny) ? rule.deny : []).map((item) => String(item || '').trim()).filter(Boolean))),
});

const buildDepartmentRuleMap = (settings = {}) => {
  const saved = settings?.departmentPermissionRules && typeof settings.departmentPermissionRules === 'object'
    ? settings.departmentPermissionRules
    : {};
  const merged = new Map();

  Object.entries(DEPARTMENT_PERMISSION_RULES).forEach(([departmentName, rule]) => {
    merged.set(departmentName, normalizeRuleSet(rule));
  });

  Object.entries(saved).forEach(([departmentName, rule]) => {
    const canonical = normalizeDepartmentName(departmentName);
    merged.set(canonical, normalizeRuleSet(rule));
  });

  return merged;
};

export const permissionService = {
  getBasePermissions(role) {
    return ROLE_PERMISSIONS[role] || [];
  },

  async getEffectiveForUser(user) {
    const role = user?.role || 'user';
    const department = normalizeDepartmentName(user?.department, role);
    const storeId = normalizeStoreId(user?.storeId);

    if (user?.isSuperUser) {
      return {
        role,
        department,
        storeId,
        basePermissions: ['*'],
        departmentRules: normalizeRuleSet({ allow: ['*'], deny: [] }),
        temporaryPermissions: [],
        revokedPermissions: [],
        effectivePermissions: ['*'],
      };
    }

    const basePermissions = this.getBasePermissions(role);
    if (hasWildcard(basePermissions)) {
      return {
        role,
        department,
        storeId,
        basePermissions,
        departmentRules: normalizeRuleSet({ allow: ['*'], deny: [] }),
        temporaryPermissions: [],
        revokedPermissions: [],
        effectivePermissions: ['*'],
      };
    }

    const [allGrants, settings] = await Promise.all([
      temporaryPermissionGrantRepo.getAll(),
      settingsRepo.getSettings(),
    ]);

    const departmentRules = buildDepartmentRuleMap(settings).get(department) || normalizeRuleSet();
    const now = Date.now();
    const grantsInScope = allGrants
      .filter((item) => item.userId === user?.id)
      .filter((item) => new Date(item.expiresAt).getTime() > now)
      .filter((item) => item.storeId === storeId || item.storeId === '*');

    const grantedPermissions = grantsInScope
      .filter((item) => item.status === 'active')
      .map((item) => item.permission);

    const revokedPermissions = grantsInScope
      .filter((item) => item.status === 'revoked')
      .map((item) => item.permission);

    const effectiveSet = new Set(basePermissions);
    departmentRules.allow.forEach((permission) => effectiveSet.add(permission));
    grantedPermissions.forEach((permission) => effectiveSet.add(permission));

    if (departmentRules.deny.includes('*')) {
      effectiveSet.clear();
    } else {
      departmentRules.deny.forEach((permission) => effectiveSet.delete(permission));
    }
    revokedPermissions.forEach((permission) => effectiveSet.delete(permission));

    const effectivePermissions = effectiveSet.has('*') ? ['*'] : expandPermissions(Array.from(effectiveSet));

    return {
      role,
      department,
      storeId,
      basePermissions,
      departmentRules,
      temporaryPermissions: grantedPermissions,
      revokedPermissions,
      effectivePermissions,
    };
  },

  async hasPermission(user, permission) {
    if (!permission) return true;
    if (user?.isSuperUser) return true;

    const result = await this.getEffectiveForUser(user);
    if (result.effectivePermissions.includes('*')) return true;
    return result.effectivePermissions.includes(permission);
  },
};
