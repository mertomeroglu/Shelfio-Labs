import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.js';
import { hasPermission } from '../../config/permissions.js';
import { locationLayoutService } from '../../services/locationLayoutService.js';
import LocationLayoutEditorWorkspace from './components/LocationLayoutEditorWorkspace.jsx';
import PageLoading from '../../components/PageLoading.jsx';

export default function LocationLayoutEditorPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [layout, setLayout] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const canManage = hasPermission(user, 'layout:manage');
  const canPublish = hasPermission(user, 'layout:publish');

  // Prevent background scrolling
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  useEffect(() => {
    if (!canManage) return;

    const loadActiveLayout = async () => {
      try {
        setIsLoading(true);
        const data = await locationLayoutService.getPublishedLayout({ view: 'editor' });
        setLayout(data);
      } catch (err) {
        console.error('Published layout could not be loaded:', err);
        setError(err);
      } finally {
        setIsLoading(false);
      }
    };

    loadActiveLayout();
  }, [canManage]);

  if (!canManage) {
    return (
      <div className="unauthorized-page-container" style={{ padding: '40px', textAlign: 'center', marginTop: '100px' }}>
        <h2>Yetkiniz Bulunmamaktadır</h2>
        <p>Mağaza planını düzenlemek için gerekli yetkiye sahip değilsiniz.</p>
        <button onClick={() => navigate('/lokasyon-yonetimi')} className="primary-button" style={{ marginTop: '16px' }}>
          Lokasyon Yönetimine Dön
        </button>
      </div>
    );
  }

  if (isLoading) {
    return <PageLoading />;
  }

  if (error || !layout) {
    return (
      <div className="error-page-container" style={{ padding: '40px', textAlign: 'center', marginTop: '100px' }}>
        <h2>Hata Oluştu</h2>
        <p>Aktif mağaza planı yüklenemedi. Lütfen daha sonra tekrar deneyin.</p>
        <button onClick={() => navigate('/lokasyon-yonetimi')} className="secondary-button" style={{ marginTop: '16px' }}>
          Geri Dön
        </button>
      </div>
    );
  }

  return (
    <div 
      className="location-management-page" 
      style={{ 
        width: '100vw', 
        height: '100vh', 
        background: '#ffffff', 
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden',
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 999
      }}
    >
      <LocationLayoutEditorWorkspace
        layout={layout}
        onClose={() => navigate('/lokasyon-yonetimi')}
        onLayoutUpdated={() => navigate('/lokasyon-yonetimi')}
        canPublish={canPublish}
        isModal={false}
      />
    </div>
  );
}
