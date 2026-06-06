import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Monitor, X } from 'lucide-react';
import '../styles/desktop-warning.css';

export default function DesktopViewWarning() {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const pathname = String(location.pathname || '');
    
    // 1. Check exclusions (Customer mobile routes, personnel mobile routes, public mobile pages, login screens)
    const isExcluded = pathname.startsWith('/musteri') || 
                       pathname.startsWith('/personel') || 
                       pathname === '/hesap-sil' || 
                       pathname === '/gizlilik-politikasi' ||
                       pathname === '/giris' ||
                       pathname === '/login' ||
                       pathname.startsWith('/sso/callback');

    if (isExcluded) {
      setIsVisible(false);
      return;
    }

    // 2. Check localStorage for 24-hour dismissal
    const dismissedTime = localStorage.getItem('shelfio-desktop-warning-dismissed');
    if (dismissedTime && Date.now() - Number(dismissedTime) < 24 * 60 * 60 * 1000) {
      setIsVisible(false);
      return;
    }

    // 3. Detect mobile device viewport width or User-Agent
    const checkDevice = () => {
      const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const isMobileWidth = window.innerWidth <= 768;
      
      setIsVisible(isMobileUA || isMobileWidth);
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, [location.pathname]);

  const handleDismiss = () => {
    localStorage.setItem('shelfio-desktop-warning-dismissed', String(Date.now()));
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="desktop-warning-card animate-slide-up" role="dialog" aria-labelledby="desktop-warning-title">
      <button 
        type="button" 
        className="desktop-warning-close-icon" 
        onClick={handleDismiss}
        aria-label="Kapat"
      >
        <X size={18} />
      </button>
      
      <div className="desktop-warning-content">
        <div className="desktop-warning-icon-wrapper">
          <Monitor className="desktop-warning-icon" size={22} />
        </div>
        
        <div className="desktop-warning-text-container">
          <h4 id="desktop-warning-title" className="desktop-warning-title">
            Masaüstü görünüm önerilir
          </h4>
          <p className="desktop-warning-description">
            Shelfio yönetim paneli geniş ekranlarda daha verimli çalışır. En iyi deneyim için tarayıcınızdan masaüstü sürümüne geçmenizi öneririz.
          </p>
        </div>
      </div>
      
      <div className="desktop-warning-actions">
        <button 
          type="button" 
          className="desktop-warning-btn primary" 
          onClick={handleDismiss}
        >
          Anladım
        </button>
        <button 
          type="button" 
          className="desktop-warning-btn secondary" 
          onClick={handleDismiss}
        >
          Devam Et
        </button>
      </div>
    </div>
  );
}
