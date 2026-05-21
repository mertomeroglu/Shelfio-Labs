import { useLocation } from 'react-router-dom';
import { resolveRouteTitle } from '../hooks/usePageTitle.js';

export default function PageLoading({ pageTitle, children } = {}) {
  const location = useLocation();
  const resolvedTitle = pageTitle || resolveRouteTitle(location.pathname) || 'Sayfa';

  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="page-loading-spinner" aria-hidden="true" />
      <p>{resolvedTitle} hazırlanıyor...</p>
      {children}
    </div>
  );
}
