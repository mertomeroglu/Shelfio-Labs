import { useLocation } from 'react-router-dom';
import { resolveRouteTitle } from '../hooks/usePageTitle.js';

export default function PageHeader({ title, description, actions, className, icon }) {
  const { pathname } = useLocation();
  const resolvedTitle = title || resolveRouteTitle(pathname) || 'Sayfa';

  return (
    <div className={`page-header${className ? ` ${className}` : ''}`}>
      <div className="page-header-main">
        <h2>
          {icon ? <span className="page-header-icon">{icon}</span> : null}
          <span className="page-header-title-text">{resolvedTitle}</span>
        </h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </div>
  );
}
