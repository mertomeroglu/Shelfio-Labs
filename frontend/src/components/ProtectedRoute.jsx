import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import PageLoading from './PageLoading.jsx';

function AuthIssueView({ issue }) {
  const statusText = issue?.status ? `HTTP ${issue.status}` : '';
  return (
    <main className="auth-page">
      <div className="auth-layout sso-auth-layout">
        <section className="auth-glass-card sso-auth-card">
          <div className="auth-form-header">
            <h2>{issue?.title || 'Erişim doğrulaması tamamlanamadı'}</h2>
            <p>{issue?.message || 'Oturumunuz korunuyor; lütfen tekrar deneyin.'}</p>
          </div>
          {issue?.errorCode || statusText ? (
            <p className="auth-tagline sso-auth-message">
              {[issue?.errorCode, statusText].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          {issue?.requestId ? (
            <p className="auth-tagline sso-auth-message">Request ID: {issue.requestId}</p>
          ) : null}
          <button className="auth-submit-btn" type="button" onClick={() => window.location.reload()}>
            Tekrar Dene
          </button>
        </section>
      </div>
    </main>
  );
}

export default function ProtectedRoute({ children }) {
  const { authIssue, isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search || '');
  const runtimeRole = String(user?.role || '').trim();

  if (isLoading) {
    return <PageLoading />;
  }

  if (authIssue) {
    return <AuthIssueView issue={authIssue} />;
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
