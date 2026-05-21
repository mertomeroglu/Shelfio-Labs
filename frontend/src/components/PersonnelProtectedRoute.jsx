import { useEffect, useState } from 'react';
import '../pages/personnel-mobile/Personnel.css';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import PageLoading from './PageLoading.jsx';

export default function PersonnelProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setLoadingTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setLoadingTimedOut(true), 10000);
    return () => window.clearTimeout(timer);
  }, [isLoading]);

  if (isLoading) {
    return (
      <main className="personnel-mobile-page">
        <PageLoading>
          {loadingTimedOut ? (
            <button type="button" className="ghost-button" onClick={() => window.location.assign('/personel/login')}>
              Yeniden Giri? Yap
            </button>
          ) : null}
        </PageLoading>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/personel/login"
        replace
        state={{ from: `${location.pathname}${location.search || ''}` }}
      />
    );
  }

  return children || <Outlet />;
}

