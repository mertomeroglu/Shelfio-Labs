import { createContext, createElement, useContext, useEffect, useMemo, useState } from 'react';
import { authService } from '../services/authService.js';
import { productService } from '../services/productService.js';
import { stockService } from '../services/stockService.js';
import { clearAuthToken, getAuthToken, getStoredUser, setStoredUser } from '../services/api.js';
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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const storedUser = getStoredUser();

    const bootstrap = async () => {
      if (!getAuthToken()) {
        if (active) {
          setIsLoading(false);
        }
        return;
      }

      try {
        const currentUser = await withTimeout(authService.me(), AUTH_BOOTSTRAP_TIMEOUT_MS);
        if (active) {
          setUser(currentUser);
          setStoredUser(currentUser);
        }
        void preloadSessionReferenceData(currentUser);
      } catch (error) {
        const isTimeout = error?.code === 'AUTH_BOOTSTRAP_TIMEOUT';

        if (active && isTimeout && storedUser) {
          setUser(storedUser);

          // UI'yi bloklamadan doðrulama denemesini arka planda sürdür.
          void authService.me()
            .then((freshUser) => {
              if (!active) return;
              setUser(freshUser);
              setStoredUser(freshUser);
              void preloadSessionReferenceData(freshUser);
            })
            .catch(() => {
              if (!active) return;
              clearAuthToken();
              setUser(null);
            });
          return;
        }

        if (active) {
          clearAuthToken();
          setUser(null);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  const login = async (credentials) => {
    const data = await authService.login(credentials);
    setUser(data.user);
    setStoredUser(data.user);
    void preloadSessionReferenceData(data?.user);
    return data;
  };

  const logout = () => {
    clearAuthToken();
    setUser(null);
  };

  const value = useMemo(
    () => ({
      user,
      baseUser: user,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      logout,
      setUser,
    }),
    [isLoading, login, logout, user]
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
