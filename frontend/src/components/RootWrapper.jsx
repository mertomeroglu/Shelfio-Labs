import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { resolveRouteTitle } from '../hooks/usePageTitle.js';
import ProximityEventProvider from './proximity/ProximityEventProvider.jsx';
import DesktopViewWarning from './DesktopViewWarning.jsx';

export default function RootWrapper() {
  const location = useLocation();

  useEffect(() => {
    const pathname = String(location.pathname || '');
    if (pathname.startsWith('/personel')) {
      document.title = 'Personel Mobil | Shelfio';
      return;
    }
    if (pathname.startsWith('/musteri')) {
      document.title = 'Müşteri Mobil | Shelfio';
      return;
    }
    const pageTitle = resolveRouteTitle(pathname);
    document.title = pageTitle ? `${pageTitle} | Shelfio` : 'Shelfio';
  }, [location.pathname]);

  return (
    <ProximityEventProvider>
      <Outlet />
      <DesktopViewWarning />
    </ProximityEventProvider>
  );
}
