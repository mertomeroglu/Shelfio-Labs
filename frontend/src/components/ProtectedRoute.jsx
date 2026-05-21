import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import PageLoading from './PageLoading.jsx';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search || '');
  const runtimeRole = String(user?.role || '').trim();

  if (isLoading) {
    return <PageLoading />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/giris" replace state={{ from: location }} />;
  }

  if (runtimeRole === 'cashier' && location.pathname !== '/kasa') {
    return <Navigate to="/kasa" replace />;
  }

  if (location.pathname === '/kasa' && !['admin', 'cashier'].includes(runtimeRole)) {
    return <Navigate to="/pos-kasa" replace />;
  }

  const isDepotTransferPath = location.pathname === '/depo-transfer-talepleri';
  const hasFullscreenFlag = searchParams.get('fullscreen') === '1';
  const hasKioskFlag = searchParams.get('kiosk') === '1';
  if (runtimeRole === 'depo_personeli' && (!isDepotTransferPath || (!hasFullscreenFlag && !hasKioskFlag))) {
    return <Navigate to="/depo-transfer-talepleri?fullscreen=1" replace />;
  }

  return children;
}
