const TOKEN_KEY = 'stock_tracking_token';
const USER_KEY = 'stock_tracking_user';
const SESSION_CACHE = new Map();
const SESSION_CACHE_PENDING = new Map();

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

const normalizeNfcDeep = (value) => {
  if (typeof value === 'string') {
    return value.normalize('NFC');
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNfcDeep(item));
  }

  if (value && typeof value === 'object') {
    const normalized = {};
    Object.entries(value).forEach(([key, entry]) => {
      normalized[key] = normalizeNfcDeep(entry);
    });
    return normalized;
  }

  return value;
};

const maskSensitive = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[max-depth]';

  if (typeof value === 'string') {
    return value.length > 2000 ? `${value.slice(0, 2000)}...(truncated)` : value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => maskSensitive(item, depth + 1));
  }

  const next = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (/(password|pass|token|secret|authorization|cookie|pin)/i.test(key)) {
      next[key] = '***';
      return;
    }
    next[key] = maskSensitive(raw, depth + 1);
  });

  return next;
};

const parseBodyForLog = (body) => {
  if (!body) return null;
  if (body instanceof FormData) return '[form-data]';
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
};

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

export const isRequestCancellation = (error) => {
  if (!error) return false;
  if (typeof error === 'object' && error.__CANCEL__ === true) return true;
  const name = String(error.name || error.constructor?.name || '').trim();
  const code = String(error.code || '').trim();
  const message = String(error.message || '').trim().toLowerCase();
  const cause = error.cause && error.cause !== error ? error.cause : null;

  return name === 'AbortError'
    || name === 'CanceledError'
    || code === 'ERR_CANCELED'
    || message.includes('signal is aborted')
    || message.includes('aborted')
    || message.includes('aborterror')
    || (cause ? isRequestCancellation(cause) : false);
};

const createCancellationError = (sourceError) => {
  if (sourceError instanceof Error) {
    sourceError.isRequestCancellation = true;
    return sourceError;
  }
  const error = new DOMException('The operation was aborted.', 'AbortError');
  error.cause = sourceError;
  error.isRequestCancellation = true;
  return error;
};

const queueDeveloperLog = (payload) => {
  if (!payload || String(payload.endpoint || '').includes('/settings/developer-logs')) {
    return;
  }

  if (isRequestCancellation(payload.error || payload.cause || payload)) {
    return;
  }

  const token = getAuthToken();
  if (!token) {
    return;
  }

  setTimeout(() => {
    fetch(`${API_BASE_URL}/settings/developer-logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(maskSensitive(payload)),
    }).catch(() => {
      // Log gönderimi opsiyoneldir; hata üretmemeli.
    });
  }, 0);
};

const safeStorageGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeStorageSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage erişimi kapalı olabilir; uygulama akışını kesmeyelim.
  }
};

const safeStorageRemove = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage erişimi kapalı olabilir; uygulama akışını kesmeyelim.
  }
};

const toCacheKey = (key) => String(key || '').trim();

const matchesCacheKey = (key, matcher) => {
  if (!matcher) return false;
  if (typeof matcher === 'string') return key === matcher;
  if (matcher instanceof RegExp) return matcher.test(key);
  if (typeof matcher === 'function') {
    try {
      return Boolean(matcher(key));
    } catch {
      return false;
    }
  }
  return false;
};

export function hasSessionCache(key) {
  const cacheKey = toCacheKey(key);
  if (!cacheKey) return false;
  return SESSION_CACHE.has(cacheKey);
}

export function getSessionCache(key) {
  const cacheKey = toCacheKey(key);
  if (!cacheKey) return undefined;
  return SESSION_CACHE.get(cacheKey);
}

export function setSessionCache(key, value) {
  const cacheKey = toCacheKey(key);
  if (!cacheKey) return value;
  SESSION_CACHE.set(cacheKey, value);
  return value;
}

export async function getOrLoadSessionCache(key, loader, options = {}) {
  const cacheKey = toCacheKey(key);
  const { forceRefresh = false } = options;

  if (!cacheKey) {
    return loader();
  }

  if (!forceRefresh && SESSION_CACHE.has(cacheKey)) {
    return SESSION_CACHE.get(cacheKey);
  }

  if (!forceRefresh && SESSION_CACHE_PENDING.has(cacheKey)) {
    return SESSION_CACHE_PENDING.get(cacheKey);
  }

  const pending = Promise.resolve()
    .then(() => loader())
    .then((value) => {
      SESSION_CACHE.set(cacheKey, value);
      return value;
    })
    .finally(() => {
      SESSION_CACHE_PENDING.delete(cacheKey);
    });

  SESSION_CACHE_PENDING.set(cacheKey, pending);
  return pending;
}

export function invalidateSessionCache(matchers = []) {
  const matcherList = Array.isArray(matchers) ? matchers : [matchers];
  if (!matcherList.length) return;

  for (const key of SESSION_CACHE.keys()) {
    if (matcherList.some((matcher) => matchesCacheKey(key, matcher))) {
      SESSION_CACHE.delete(key);
      SESSION_CACHE_PENDING.delete(key);
    }
  }
}

export function clearSessionCache() {
  SESSION_CACHE.clear();
  SESSION_CACHE_PENDING.clear();
}

export function getAuthToken() {
  return safeStorageGet(TOKEN_KEY) || '';
}

export function setAuthToken(token) {
  safeStorageSet(TOKEN_KEY, token);
}

export function clearAuthToken() {
  safeStorageRemove(TOKEN_KEY);
  safeStorageRemove(USER_KEY);
  clearSessionCache();
}

export function getStoredUser() {
  const raw = safeStorageGet(USER_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredUser(user) {
  safeStorageSet(USER_KEY, JSON.stringify(user));
}

export function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, value);
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

async function request(path, options = {}) {
  const token = getAuthToken();
  const storedUser = getStoredUser();
  const headers = new Headers(options.headers || {});
  const isFormData = options.body instanceof FormData;
  const method = String(options.method || 'GET').toUpperCase();

  if (storedUser?.role === 'viewer' && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const error = new Error('Goruntuleyici rolunde degisiklik islemi yapilamaz. Bu hesap salt okunur moddadir.');
    error.status = 403;
    throw error;
  }

  if (!isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json; charset=utf-8');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const ownerEmail = looksLikeEmail(storedUser?.email) ? String(storedUser.email).trim() : '';
  if (ownerEmail) {
    headers.set('x-owner-email', ownerEmail);
  }

  let response;
  let requestOptions = options;

  if (!isFormData && typeof options.body === 'string' && String(headers.get('Content-Type') || '').includes('application/json')) {
    try {
      const parsedBody = JSON.parse(options.body);
      requestOptions = {
        ...options,
        body: JSON.stringify(normalizeNfcDeep(parsedBody)),
      };
    } catch {
      requestOptions = options;
    }
  }

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...requestOptions,
      headers,
    });
  } catch (networkError) {
    if (isRequestCancellation(networkError) || options.signal?.aborted) {
      if (import.meta.env.DEV) {
        console.debug('[api] request cancelled', { method, path, message: networkError?.message });
      }
      throw createCancellationError(networkError);
    }

    const friendlyMessage =
      networkError?.name === 'TypeError' || String(networkError?.message || '').toLowerCase().includes('failed to fetch') ?
        'Sunucuya baglanilamadi. Backend servisinin calistigindan emin olun.'
        : (networkError?.message || 'Ag baglantisi hatasi olustu.');

    queueDeveloperLog({
      level: 'error',
      source: 'api',
      message: friendlyMessage,
      action: `${options.method || 'GET'} ${path}`,
      endpoint: path,
      requestUrl: `${API_BASE_URL}${path}`,
      requestPayload: parseBodyForLog(options.body),
      response: null,
      stack: networkError?.stack,
      errorType: 'api_error',
    });

    const error = new Error(friendlyMessage);
    error.status = 0;
    error.cause = networkError;
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? normalizeNfcDeep(await response.json()) : null;

  if (!response.ok) {
    queueDeveloperLog({
      level: response.status >= 500 ? 'error' : 'warning',
      source: 'api',
      message: payload?.message || 'API isteği başarısız',
      action: `${method} ${path}`,
      endpoint: path,
      requestUrl: `${API_BASE_URL}${path}`,
      requestPayload: parseBodyForLog(options.body),
      response: payload,
      statusCode: response.status,
      errorType: response.status >= 500 ? 'api_error' : 'validation_error',
    });

    const error = new Error(payload?.message || 'Bir işlem hatası oluştu');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  const result = payload?.data ?? payload;
  if (payload?.meta && result && typeof result === 'object') {
    try {
      Object.defineProperty(result, 'meta', {
        value: payload.meta,
        enumerable: false,
        configurable: true,
      });
    } catch {
      result.meta = payload.meta;
    }
  }

  return result;
}

export const api = {
  get: (path, options = {}) => request(path, options),
  post: (path, body, options = {}) => request(path, { ...options, method: 'POST', body: JSON.stringify(body) }),
  put: (path, body, options = {}) => request(path, { ...options, method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body, options = {}) => request(path, { ...options, method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: (path, body, options = {}) => request(path, { ...options, method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
};
