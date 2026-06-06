import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import { authService } from '../services/authService.js';
import { productService } from '../services/productService.js';
import { stockService } from '../services/stockService.js';
import {
  AUTH_SESSION_EXPIRED_EVENT,
  AUTH_SESSION_REFRESHED_EVENT,
  clearAuthToken,
  getAuthRefreshToken,
  getAuthToken,
  getStoredUser,
  refreshStaffSession,
  setStoredUser,
  shouldClearAuthForError,
} from '../services/api.js';
import { hasPermission } from '../config/permissions.js';

const AuthContext = createContext(null);
const AUTH_BOOTSTRAP_TIMEOUT_MS = 8000;

function createTimeoutError() {
  const error = new Error('AUTH_BOOTSTRAP_TIMEOUT');
  error.code = 'AUTH_BOOTSTRAP_TIMEOUT';
  return error;
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(createTimeoutError()), timeoutMs);
    }),
  ]);
}

const AUTH_ISSUE_MESSAGES = {
  user_inactive: 'Hesabınız pasif durumda. Lütfen yöneticiniz veya Shelfio destek ekibiyle iletişime geçin.',
  tenant_mismatch: 'Tenant bağlantınız doğrulanamadı. Lütfen destek ekibiyle iletişime geçin.',
  tenant_missing: 'Tenant bağlantısı bulunamadı. Lütfen destek ekibiyle iletişime geçin.',
  tenant_inactive: 'Tenant aktif değil. Lütfen destek ekibiyle iletişime geçin.',
  store_missing: 'Mağaza bağlantısı bulunamadı. Lütfen destek ekibiyle iletişime geçin.',
  license_missing: 'Lisans doğrulaması tamamlanamadı. Lütfen lisans durumunuzu kontrol edin.',
  license_inactive: 'Lisansınız aktif değil. Lütfen lisans durumunuzu kontrol edin.',
  license_expired: 'Lisansınızın süresi dolmuş. Lütfen lisansınızı yenileyin.',
  license_pending: 'Lisansınız henüz aktif değil. Aktivasyon tamamlandıktan sonra tekrar deneyin.',
  module_access_denied: 'Lisans kapsamınız bu modül için yeterli değil.',
  screen_access_denied: 'Lisans kapsamınız bu ekran için yeterli değil.',
  module_not_licensed: 'Lisans kapsamınız bu modül için yeterli değil.',
  screen_not_licensed: 'Lisans kapsamınız bu ekran için yeterli değil.',
};

const buildAuthIssue = (error) => {
  const errorCode = String(error?.payload?.errorCode || error?.errorCode || '').trim();
  const status = Number(error?.status || error?.statusCode || 0);
  const isNetworkIssue = status === 0 || error?.code === 'AUTH_BOOTSTRAP_TIMEOUT';
  return {
    errorCode: errorCode || (isNetworkIssue ? 'auth_network_error' : 'auth_bootstrap_failed'),
    status,
    requestId: error?.requestId || error?.payload?.requestId || '',
    title: isNetworkIssue ? 'Oturum doğrulaması tamamlanamadı' : 'Erişim doğrulaması tamamlanamadı',
    message: isNetworkIssue
      ? 'Sunucuya ulaşılamadı veya doğrulama zaman aşımına uğradı. Oturumunuz korunuyor; lütfen tekrar deneyin.'
      : AUTH_ISSUE_MESSAGES[errorCode] || error?.message || 'Oturum doğrulaması tamamlanamadı. Lütfen tekrar deneyin.',
  };
};

async function preloadSessionReferenceData(user) {
  const role = String(user?.role || '').trim();
  if (role === 'cashier' || (!hasPermission(user, 'product:view') && !hasPermission(user, 'stock:view'))) {
    return;
  }

  await Promise.allSettled([
    productService.list({ fetchAll: false, page: 1, limit: 100, includeTotal: false }),
    stockService.getStocks({ fetchAll: false, page: 1, limit: 100, includeBatches: false, includeTotal: false }),
    stockService.getMovements({
      search: '',
      type: '',
      reasonCode: '',
      location: '',
      productId: '',
      maxStock: '',
      criticalOnly: false,
      outOfStockOnly: false,
    }),
  ]);
}

async function hydrateCurrentUser() {
  const currentUser = await withTimeout(authService.me(), AUTH_BOOTSTRAP_TIMEOUT_MS);
  setStoredUser(currentUser);
  void preloadSessionReferenceData(currentUser);
  return currentUser;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authIssue, setAuthIssue] = useState(null);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      const hasAccessToken = Boolean(getAuthToken());
      const hasRefreshToken = Boolean(getAuthRefreshToken());

      if (!hasAccessToken && !hasRefreshToken) {
        if (active) setIsLoading(false);
        return;
      }

      try {
        if (!hasAccessToken && hasRefreshToken) {
          await withTimeout(refreshStaffSession(), AUTH_BOOTSTRAP_TIMEOUT_MS);
        }

        const currentUser = await hydrateCurrentUser();
        if (active) {
          setUser(currentUser);
          setAuthIssue(null);
        }
      } catch (error) {
        if (active) {
          if (shouldClearAuthForError(error)) {
            clearAuthToken();
            setUser(null);
            setAuthIssue(null);
          } else {
            setUser(getStoredUser());
            setAuthIssue(buildAuthIssue(error));
          }
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      setUser(null);
      setAuthIssue(null);
    };
    const handleSessionRefreshed = (event) => {
      const nextUser = event?.detail?.user || getStoredUser();
      if (nextUser) {
        setUser(nextUser);
        setAuthIssue(null);
      }
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    window.addEventListener(AUTH_SESSION_REFRESHED_EVENT, handleSessionRefreshed);
    return () => {
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
      window.removeEventListener(AUTH_SESSION_REFRESHED_EVENT, handleSessionRefreshed);
    };
  }, []);

  const login = async (credentials) => {
    const data = await authService.login(credentials);
    setUser(data.user);
    setStoredUser(data.user);
    setAuthIssue(null);
    void preloadSessionReferenceData(data?.user);
    return data;
  };

  const logout = () => {
    void authService.logout().catch(() => {});
    clearAuthToken();
    setUser(null);
    setAuthIssue(null);
  };

  const value = useMemo(
    () => ({
      user,
      baseUser: user,
      isLoading,
      isAuthenticated: Boolean(user),
      authIssue,
      login,
      logout,
      setUser,
    }),
    [authIssue, isLoading, login, logout, user],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
