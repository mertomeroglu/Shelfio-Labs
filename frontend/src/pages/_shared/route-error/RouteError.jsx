import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { useEffect } from 'react';
import { clearAuthToken, getStoredUser, isRequestCancellation } from '../../../services/api.js';
import { supportService } from '../../../services/supportService.js';

const ADMIN_LOGIN_ROUTE = '/giris';
const CUSTOMER_LOGIN_ROUTE = '/musteri/login';
const PERSONNEL_LOGIN_ROUTE = '/personel/login';

function resolveTechnicalMessage(error) {
  if (isRouteErrorResponse(error)) {
    return error.data?.message || error.statusText || `HTTP ${error.status}`;
  }
  return error?.message || 'Bilinmeyen hata';
}

function buildErrorReportPayload(error) {
  const storedUser = getStoredUser();
  return {
    message: resolveTechnicalMessage(error),
    stack: error?.stack || error?.error?.stack || '',
    url: typeof window !== 'undefined' ? window.location.href : '',
    browser: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    occurredAt: new Date().toISOString(),
    user: storedUser ? {
      id: storedUser.id,
      username: storedUser.username,
      name: storedUser.name,
      role: storedUser.role,
      email: storedUser.email,
    } : null,
  };
}

function resolveLoginRoute(pathname = '') {
  const normalizedPathname = String(pathname || '').toLowerCase();

  if (normalizedPathname === '/musteri' || normalizedPathname.startsWith('/musteri/')) {
    return CUSTOMER_LOGIN_ROUTE;
  }

  if (normalizedPathname === '/personel' || normalizedPathname.startsWith('/personel/')) {
    return PERSONNEL_LOGIN_ROUTE;
  }

  return ADMIN_LOGIN_ROUTE;
}

function getCurrentLoginRoute() {
  if (typeof window === 'undefined') {
    return ADMIN_LOGIN_ROUTE;
  }

  return resolveLoginRoute(window.location.pathname);
}

export function ErrorFallbackView() {
  const handleGoLogin = () => {
    clearAuthToken();
    if (typeof window !== 'undefined') {
      window.location.href = getCurrentLoginRoute();
    }
  };

  const handleGoPrevious = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }

    if (typeof window !== 'undefined') {
      window.location.replace(getCurrentLoginRoute());
    }
  };

  return (
    <div className="error-fallback-wrap">
      <div className="error-fallback-card">
        <div className="error-fallback-header">
          <h2>Bir hata oluştu</h2>
          <p>İşlem sırasında beklenmeyen bir durum oluştu. Sorun ilgili birime iletildi.</p>
        </div>

        <div className="error-fallback-actions">
          <button type="button" className="primary-button" onClick={handleGoLogin}>
            Giriş Ekranına Dön
          </button>
          <button type="button" className="ghost-button" onClick={handleGoPrevious}>
            Önceki Sayfaya Dön
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RouteError() {
  const error = useRouteError();
  useEffect(() => {
    if (isRequestCancellation(error)) {
      return;
    }
    supportService.reportSystemError(buildErrorReportPayload(error)).catch(() => {
      // Hata bildirimi uygulamanın toparlanmasını engellememeli.
    });
  }, [error]);

  if (isRequestCancellation(error)) {
    return null;
  }

  return <ErrorFallbackView />;
}
