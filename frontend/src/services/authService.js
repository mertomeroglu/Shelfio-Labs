import { api, setAuthRefreshToken, setAuthToken, setStoredUser } from './api.js';

const LICENSE_SESSION_KEY = 'shelfio_license_session';

const resolveLoginSource = () => {
  if (typeof window === 'undefined') return 'admin_web';
  const path = String(window.location?.pathname || '').toLowerCase();
  return path.includes('personel') || path.includes('personnel') ? 'personnel_mobile' : 'admin_web';
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
    const sessionUser = data.user ? {
      ...data.user,
      tenant: data.tenant || null,
      activeStore: data.activeStore || null,
      license: data.license || null,
      plan: data.plan || null,
      enabledModules: data.enabledModules || [],
      permissions: data.permissions || data.user?.permissions,
    } : data.user;
    setStoredUser(sessionUser);
    return { ...data, user: sessionUser };
  },
  async exchangeSsoCode(code) {
    const data = await api.post('/sso/exchange', { code }, { __skipAuthRefresh: true });
    setAuthToken(data.token);
    setAuthRefreshToken(data.refreshToken || '');
    const sessionUser = data.user ? {
      ...data.user,
      tenant: data.tenant || null,
      activeStore: data.activeStore || null,
      license: data.license || null,
      plan: data.plan || null,
      enabledModules: data.enabledModules || [],
      permissions: data.permissions || data.user?.permissions,
      control: data.control || null,
    } : data.user;
    setStoredUser(sessionUser);
    return { ...data, user: sessionUser };
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
        plan: data?.plan || currentUser.plan || null,
        enabledModules: data?.enabledModules || currentUser.enabledModules || [],
      } : currentUser;
    });
  },
};
