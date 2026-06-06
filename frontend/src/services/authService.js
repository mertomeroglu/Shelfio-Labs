import { api, setAuthRefreshToken, setAuthToken, setStoredUser } from './api.js';

const LICENSE_SESSION_KEY = 'shelfio_license_session';

const resolveLoginSource = () => {
  if (typeof window === 'undefined') return 'admin_web';
  const path = String(window.location?.pathname || '').toLowerCase();
  return path.includes('personel') || path.includes('personnel') ? 'personnel_mobile' : 'admin_web';
};

const storeSsoSession = (data) => {
  if (!data?.token || !data?.user) return data;
  setAuthToken(data.token);
  setAuthRefreshToken(data.refreshToken || '');
  if (data.licenseSessionToken) {
    setLicenseSessionToken(data.licenseSessionToken);
  }
  const licenseSummary = data.licenseSummary || data.license?.licenseSummary || data.user?.licenseSummary || null;
  const sessionUser = {
    ...data.user,
    tenant: data.tenant || null,
    activeStore: data.activeStore || null,
    license: data.license || null,
    licenseSummary,
    plan: data.plan || null,
    enabledModules: data.enabledModules || [],
    screenAccess: data.screenAccess || licenseSummary?.screenAccess || data.user?.screenAccess || [],
    permissions: data.permissions || data.user?.permissions,
    control: data.control || null,
  };
  setStoredUser(sessionUser);
  return { ...data, user: sessionUser };
};

export function getLicenseSessionToken() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(LICENSE_SESSION_KEY) || '';
}

export function setLicenseSessionToken(token) {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(LICENSE_SESSION_KEY, token);
    return;
  }
  window.localStorage.removeItem(LICENSE_SESSION_KEY);
}

export function clearLicenseSessionToken() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(LICENSE_SESSION_KEY);
}

const shouldClearLicenseContext = (error) => {
  const message = String(error?.message || '').toLocaleLowerCase('tr-TR');
  return error?.status === 401
    || message.includes('süresi dol')
    || message.includes('geçersiz')
    || message.includes('askıya')
    || message.includes('iptal')
    || message.includes('aktif değil');
}

export const authService = {
  clearLicenseSessionToken,
  async verifyLicense(licenseKey) {
    const data = await api.post('/licenses/verify', { licenseKey, source: resolveLoginSource() }, { __skipAuthRefresh: true });
    setLicenseSessionToken(data?.licenseSessionToken || '');
    return data;
  },
  async validateLicenseContext() {
    const licenseSessionToken = getLicenseSessionToken();
    if (!licenseSessionToken) return null;

    try {
      return await api.post('/licenses/session', { licenseSessionToken }, { __skipAuthRefresh: true });
    } catch (error) {
      if (shouldClearLicenseContext(error)) {
        clearLicenseSessionToken();
      }
      throw error;
    }
  },
  async login(credentials) {
    const data = await api.post('/auth/login', {
      ...credentials,
      licenseSessionToken: credentials?.licenseSessionToken || getLicenseSessionToken(),
      source: credentials?.source || resolveLoginSource(),
    });
    setAuthToken(data.token);
    setAuthRefreshToken(data.refreshToken || '');
    const licenseSummary = data.licenseSummary || data.license?.licenseSummary || data.user?.licenseSummary || null;
    const sessionUser = data.user ? {
      ...data.user,
      tenant: data.tenant || null,
      activeStore: data.activeStore || null,
      license: data.license || null,
      licenseSummary,
      plan: data.plan || null,
      enabledModules: data.enabledModules || [],
      screenAccess: data.screenAccess || licenseSummary?.screenAccess || data.user?.screenAccess || [],
      permissions: data.permissions || data.user?.permissions,
    } : data.user;
    setStoredUser(sessionUser);
    return { ...data, user: sessionUser };
  },
  async exchangeSsoCode(code) {
    const data = await api.post('/sso/exchange', { code }, { __skipAuthRefresh: true });
    return storeSsoSession(data);
  },
  async setupSsoAdmin(payload) {
    const data = await api.post('/sso/setup', payload, { __skipAuthRefresh: true });
    return storeSsoSession(data);
  },
  logout() {
    return api.post('/auth/logout', { source: resolveLoginSource() }, { __skipAuthRefresh: true });
  },
  me() {
    return api.get('/auth/me').then((data) => {
      const currentUser = data?.currentUser || data?.user || data;
      return currentUser ? {
        ...currentUser,
        tenant: data?.tenant || currentUser.tenant || null,
        activeStore: data?.activeStore || currentUser.activeStore || null,
        license: data?.license || currentUser.license || null,
        licenseSummary: data?.licenseSummary || data?.license?.licenseSummary || currentUser.licenseSummary || null,
        plan: data?.plan || currentUser.plan || null,
        enabledModules: data?.enabledModules || currentUser.enabledModules || [],
        screenAccess: data?.screenAccess || data?.licenseSummary?.screenAccess || currentUser.screenAccess || [],
      } : currentUser;
    });
  },
};
