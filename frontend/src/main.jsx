import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';
import './styles/layout.css';
import './styles/form.css';
import './styles/table.css';
import './styles/auth.css';
import './styles/dashboard.css';
import './styles/auth-mobile.css';

const DATASET_CACHE_VERSION_KEY = 'shelfio.dataset.cache.version';
const DATASET_CACHE_VERSION = 'shelfio-v4-2026-05-06-utf8-fix';
const ENCODING_GUARD_PATTERN = new RegExp([
  '\u00C3\u00A7', '\u00C3\u00B6', '\u00C3\u00BC', '\u00C3\u0087', '\u00C3\u2013', '\u00C3\u0153',
  '\u00C4\u0178', '\u00C4\u017D', '\u00C4\u00B1', '\u00C4\u00B0', '\u00C5\u0178', '\u00C5\u017D',
  '\uFFFD', '\u00FE', '\u00F0', '\u00FD', '\u00DD', '\u00C2\u00B0C', '\u00E2\u009D\u201E',
  '\u00EF\u00BF\u00BD',
].join('|'));

const LEGACY_LOCAL_KEYS = [
  'datasetDataLayer',
  'shelfio.dataset.manifest',
  'shelfio.dataset.registry',
  'stock_tracking_dataset_manifest',
  'stock_tracking_dataset_version',
];

const LEGACY_SESSION_PREFIXES = [
  'products:',
  'suppliers:',
  'stock:',
  'procurement:',
  'categories:',
  'sections:',
  'warehouse:',
  'reports:',
  'dashboard:',
];

const LEGACY_INDEXED_DB_NAMES = [
  'shelfio-dataset-cache',
  'stock-tracking-cache',
  'shelfio-runtime-cache',
];

const clearLegacyDatasetCaches = async () => {
  if (typeof window === 'undefined') return;

  try {
    const currentVersion = window.localStorage.getItem(DATASET_CACHE_VERSION_KEY);
    if (currentVersion === DATASET_CACHE_VERSION) {
      return;
    }

    for (const key of LEGACY_LOCAL_KEYS) {
      window.localStorage.removeItem(key);
    }

    const localKeys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key) localKeys.push(key);
    }

    for (const key of localKeys) {
      if (key === DATASET_CACHE_VERSION_KEY) continue;
      const value = window.localStorage.getItem(key) || '';
      if (ENCODING_GUARD_PATTERN.test(value)) {
        window.localStorage.removeItem(key);
      }
    }

    const sessionKeys = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      if (key) sessionKeys.push(key);
    }

    for (const key of sessionKeys) {
      if (LEGACY_SESSION_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        window.sessionStorage.removeItem(key);
      }
    }

    if (window.indexedDB) {
      if (typeof window.indexedDB.databases === 'function') {
        const dbs = await window.indexedDB.databases();
        for (const db of dbs || []) {
          const name = String(db.name || '');
          if (!name) continue;
          if (LEGACY_INDEXED_DB_NAMES.includes(name) || /dataset|stock-tracking|shelfio/i.test(name)) {
            window.indexedDB.deleteDatabase(name);
          }
        }
      } else {
        for (const name of LEGACY_INDEXED_DB_NAMES) {
          window.indexedDB.deleteDatabase(name);
        }
      }
    }

    window.localStorage.setItem(DATASET_CACHE_VERSION_KEY, DATASET_CACHE_VERSION);
  } catch {
    // Cache temizliği engellenirse uygulama akışını durdurma.
  }
};

void clearLegacyDatasetCaches();

const rootElement = document.getElementById('root');
const root = ReactDOM.createRoot(rootElement);

const renderFatalBootstrapError = (error) => {
  const message = String(error?.message || 'Uygulama başlatılırken hata oluştu');
  const handleGoPrevious = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = '/giris';
  };

  const handleGoLogin = () => {
    window.location.href = '/giris';
  };

  const actionBtnStyle = {
    minWidth: 220,
    minHeight: 42,
    borderRadius: 10,
    fontWeight: 700,
    border: '1px solid #1d4ed8',
    background: '#2563eb',
    color: '#ffffff',
  };

  root.render(
    <React.StrictMode>
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f8fafc', color: '#0f172a', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ width: 'min(680px, 92vw)', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Arayüz başlatma hatası</h2>
          <p style={{ marginTop: 8, marginBottom: 0, color: '#475569' }}>İşlem sırasında beklenmeyen bir durum oluştu. Sorun ilgili birime iletildi.</p>
          <pre style={{ marginTop: 12, padding: 12, borderRadius: 10, background: '#0f172a', color: '#e2e8f0', fontSize: 12, whiteSpace: 'pre-wrap' }}>{message}</pre>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <button type="button" onClick={handleGoPrevious} style={actionBtnStyle}>Önceki Sayfaya Dön</button>
            <button type="button" onClick={handleGoLogin} style={actionBtnStyle}>Giriş Ekranına Dön</button>
          </div>
        </div>
      </div>
    </React.StrictMode>
  );
};

import('./App.jsx')
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  })
  .catch((error) => {
    console.error('Bootstrap error:', error);
    renderFatalBootstrapError(error);
  });

