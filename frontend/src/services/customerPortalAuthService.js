const CUSTOMER_TOKEN_KEY = 'shelfio_customer_token';
const CUSTOMER_REFRESH_TOKEN_KEY = 'shelfio_customer_refresh_token';
const CUSTOMER_USER_KEY = 'shelfio_customer_user';
export const CUSTOMER_AUTH_UPDATED_EVENT = 'shelfio:customer-auth-updated';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const normalizeCustomerUser = (user) => {
  if (!user || typeof user !== 'object') return user;
  return { ...user };
};

const getToken = () => localStorage.getItem(CUSTOMER_TOKEN_KEY) || '';
const getRefreshToken = () => localStorage.getItem(CUSTOMER_REFRESH_TOKEN_KEY) || '';
const setToken = (token) => localStorage.setItem(CUSTOMER_TOKEN_KEY, token || '');
const setRefreshToken = (token) => localStorage.setItem(CUSTOMER_REFRESH_TOKEN_KEY, token || '');
const dispatchAuthUpdated = (detail = {}) => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(CUSTOMER_AUTH_UPDATED_EVENT, { detail }));
  } catch {
    // Customer auth notifications are best-effort for in-app listeners.
  }
};
const clear = () => {
  localStorage.removeItem(CUSTOMER_TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_REFRESH_TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_USER_KEY);
  dispatchAuthUpdated({ authenticated: false });
};
const requestLogout = () => {
  const token = getToken();
  if (!token) return;
  fetch(`${API_BASE_URL}/customer-auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  }).catch(() => {});
};
const setUser = (user) => localStorage.setItem(CUSTOMER_USER_KEY, JSON.stringify(normalizeCustomerUser(user) || null));
const getUser = () => {
  try {
    return normalizeCustomerUser(JSON.parse(localStorage.getItem(CUSTOMER_USER_KEY) || 'null'));
  } catch {
    return null;
  }
};

let pendingRefreshPromise = null;

async function refreshSessionToken() {
  if (pendingRefreshPromise) return pendingRefreshPromise;
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.');

  pendingRefreshPromise = fetch(`${API_BASE_URL}/customer-auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ refreshToken }),
  }).then(async (res) => {
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.message || 'Oturum süresi doldu. Lütfen tekrar giriş yapın.');
    const data = payload?.data ?? payload;
    if (!data?.token || !data?.refreshToken) throw new Error('Oturum yenileme başarısız.');
    setToken(data.token);
    setRefreshToken(data.refreshToken);
    if (data?.customer) setUser(normalizeCustomerUser(data.customer));
    dispatchAuthUpdated({ authenticated: true, source: 'refresh' });
    return data.token;
  }).finally(() => {
    pendingRefreshPromise = null;
  });

  return pendingRefreshPromise;
}

async function request(path, options = {}, retry = true) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (
      res.status === 401
      && retry
      && !path.startsWith('/customer-auth/login')
      && !path.startsWith('/customer-auth/register')
      && !path.startsWith('/customer-auth/forgot-password')
      && !path.startsWith('/customer-auth/reset-password')
      && !path.startsWith('/customer-auth/refresh')
    ) {
      try {
        await refreshSessionToken();
        return request(path, options, false);
      } catch (error) {
        clear();
        throw new Error(error?.message || 'Oturum süresi doldu. Lütfen tekrar giriş yapın.');
      }
    }
    const isLoginRequest = path.startsWith('/customer-auth/login');
    throw new Error(payload?.message || (res.status === 401 && isLoginRequest ? 'Kullanıcı bilgileri hatalı.' : 'İşlem başarısız'));
  }

  return payload?.data ?? payload;
}

export { request as customerPortalRequest, refreshSessionToken as refreshCustomerSession };

export const customerPortalAuthService = {
  getStoredUser: getUser,
  isLoggedIn: () => Boolean(getToken()),
  logout: () => {
    requestLogout();
    clear();
  },
  async login(identity, password) {
    const data = await request('/customer-auth/login', { method: 'POST', body: JSON.stringify({ identity, password }) });
    setToken(data.token);
    setRefreshToken(data.refreshToken || '');
    setUser(normalizeCustomerUser(data.customer));
    dispatchAuthUpdated({ authenticated: true, source: 'login' });
    return data;
  },
  async register(payload) {
    const data = await request('/customer-auth/register', { method: 'POST', body: JSON.stringify(payload) });
    setToken(data.token);
    setRefreshToken(data.refreshToken || '');
    setUser(normalizeCustomerUser(data.customer));
    dispatchAuthUpdated({ authenticated: true, source: 'register' });
    return data;
  },
  forgotPassword: (email) => request('/customer-auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (payload) => request('/customer-auth/reset-password', { method: 'POST', body: JSON.stringify(payload || {}) }),
  async me() {
    const data = await request('/customer-auth/me');
    setUser(normalizeCustomerUser(data));
    return data;
  },
  async updateProfile(payload) {
    const data = await request('/customer-auth/profile', { method: 'PATCH', body: JSON.stringify(payload || {}) });
    setUser(normalizeCustomerUser(data));
    return data;
  },
  dashboard: () => request('/customer-auth/dashboard'),
  orders: (params = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request(`/customer-auth/orders${suffix}`);
  },
  getCart: () => request('/customer-auth/cart'),
  updateCart: (payload = {}) => request('/customer-auth/cart', { method: 'PATCH', body: JSON.stringify(payload) }),
  placeOrder: (payload = {}) => request('/customer-auth/orders', { method: 'POST', body: JSON.stringify(payload) }),
  notifications: (limit = 40) => request(`/customer-auth/notifications?limit=${Number(limit) || 40}`),
  markNotificationsAsRead: () => request('/customer-auth/notifications/read-all', { method: 'PATCH' }),
  clearNotifications: () => request('/customer-auth/notifications', { method: 'DELETE' }),
};
