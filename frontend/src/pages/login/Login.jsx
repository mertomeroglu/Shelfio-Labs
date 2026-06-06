import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, Cookie, ExternalLink, Eye, EyeOff, KeyRound, Lock, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';
import { authService } from '../../services/authService.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import LoginTransition from '../../components/LoginTransition.jsx';
import logoPng from '../../assets/logo.png';
import Toast from '../../components/Toast.jsx';
import { openCookiePreferences } from '../../components/CookieConsent.jsx';

export default function Login() {
  usePageTitle();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, login, isLoading, user } = useAuth();
  const [licenseVerified, setLicenseVerified] = useState(false);
  const [checkingLicense, setCheckingLicense] = useState(true);
  const [licenseForm, setLicenseForm] = useState({ licenseKey: '' });
  const [form, setForm] = useState({ username: '', password: '' });
  const [licenseError, setLicenseError] = useState('');
  const [error, setError] = useState('');
  const [licenseSubmitting, setLicenseSubmitting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [toast, setToast] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [redirectPath, setRedirectPath] = useState(location.state?.from?.pathname || '/anasayfa');
  const destination = location.state?.from?.pathname || '/anasayfa';
  const resolvedRedirectPath = user?.role === 'cashier' ?
    '/kasa'
    : user?.role === 'depo_personeli' ?
      '/depo-transfer-talepleri?fullscreen=1'
      : redirectPath;

  useEffect(() => {
    if (isAuthenticated && !showTransition) {
      navigate(resolvedRedirectPath, { replace: true });
    }
  }, [isAuthenticated, showTransition, resolvedRedirectPath, navigate]);

  useEffect(() => {
    let active = true;

    const validateStoredLicense = async () => {
      try {
        const context = await authService.validateLicenseContext();
        if (active && context) {
          setLicenseVerified(true);
        }
      } catch (requestError) {
        const message = resolveLicenseError(requestError);
        if (active) {
          setLicenseVerified(false);
          setLicenseError(message);
        }
      } finally {
        if (active) {
          setCheckingLicense(false);
        }
      }
    };

    validateStoredLicense();

    return () => {
      active = false;
    };
  }, []);

  const handleTransitionComplete = useCallback(() => {
    navigate(resolvedRedirectPath, { replace: true });
  }, [navigate, resolvedRedirectPath]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleLicenseChange = (event) => {
    const { name, value } = event.target;
    setLicenseForm((current) => ({ ...current, [name]: value }));
  };

  const resolveLicenseError = (requestError) => {
    const message = requestError?.message || '';
    if (message.includes('süresi dol')) return 'Bu lisansın süresi dolmuş.';
    if (message.includes('askıya')) return 'Bu lisans askıya alınmış. Destek ile iletişime geçin.';
    if (message.includes('aktif')) return 'Bu lisans aktif değil.';
    return 'Lisans doğrulanamadı.';
  };

  const handleLicenseSubmit = async (event) => {
    event.preventDefault();
    setLicenseError('');

    if (!licenseForm.licenseKey.trim()) {
      setLicenseError('Lisans doğrulanamadı.');
      return;
    }

    try {
      setLicenseSubmitting(true);
      await authService.verifyLicense(licenseForm.licenseKey);
      setLicenseVerified(true);
    } catch (requestError) {
      const message = resolveLicenseError(requestError);
      setLicenseError(message);
      setToast({ type: 'error', title: 'Lisans Hatası', message });
    } finally {
      setLicenseSubmitting(false);
    }
  };

  const handleChangeLicense = () => {
    authService.clearLicenseSessionToken();
    setLicenseVerified(false);
    setLicenseError('');
    setError('');
    setForm({ username: '', password: '' });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.username.trim() || !form.password.trim()) {
      setError('Kullanıcı adı ve şifre zorunludur.');
      return;
    }

    try {
      setSubmitting(true);
      const data = await login(form);
      const nextPath = data?.user?.role === 'cashier' ?
        '/kasa'
        : data?.user?.role === 'depo_personeli' ?
          '/depo-transfer-talepleri?fullscreen=1'
          : destination;
      setRedirectPath(nextPath);
      setShowTransition(true);
    } catch (requestError) {
      if (requestError.status === 401) {
        const message = 'Kullanıcı bilgileri hatalı.';
        setError(message);
        setToast({ type: 'error', title: 'Giriş Başarısız', message });
      } else {
        setError(requestError.message || 'Giriş yapılamadı.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const features = [
    { icon: Activity, title: 'Gerçek Zamanlı Stok', desc: 'Anlık stok takibi ve kritik uyarılar' },
    { icon: ShieldCheck, title: 'Akıllı Raf Yönetimi', desc: 'Reyon bazlı ürün ve raf düzenlemesi' },
    { icon: BarChart3, title: 'Tedarik ve Raporlama', desc: 'Tedarikçi analizi ve detaylı raporlar' },
  ];

  if (showTransition) {
    return <LoginTransition onComplete={handleTransitionComplete} />;
  }

  return (
    <div className="auth-page">
      <div className="auth-layout">
        <Toast toast={toast} onClose={() => setToast(null)} />
        <div className="auth-left">
          <img src={logoPng} alt="Shelfio" className="auth-logo" />
          <h1 className="auth-headline">Stok ve Fiyat<br />Yönetim Platformu</h1>
          <p className="auth-tagline">Mağaza operasyonlarınızı tek ekrandan yönetin.</p>
          <div className="auth-features">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="auth-feature-card">
                  <div className="auth-feature-icon"><Icon size={20} /></div>
                  <div>
                    <strong>{f.title}</strong>
                    <span>{f.desc}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="auth-right">
          {checkingLicense ? (
            <div className="auth-glass-card">
              <div className="auth-form-header">
                <h2 className="auth-title-row"><ShieldCheck size={20} /> Lisans Doğrulama</h2>
                <p>Lisans bilgisi kontrol ediliyor...</p>
              </div>
              <div className="alert info">Doğrulanmış lisans context’i aranıyor.</div>
            </div>
          ) : !licenseVerified ? (
            <form className="auth-glass-card" onSubmit={handleLicenseSubmit}>
              <div className="auth-form-header">
                <h2 className="auth-title-row"><ShieldCheck size={20} /> Lisans Doğrulama</h2>
                <p>Devam etmek için Shelfio lisans anahtarınızı girin</p>
              </div>

              {licenseError ? <div className="alert error">{licenseError}</div> : null}

              <label className="auth-input-group">
                <KeyRound size={16} className="auth-input-icon" />
                <input
                  name="licenseKey"
                  value={licenseForm.licenseKey}
                  onChange={handleLicenseChange}
                  placeholder="Lisans anahtarı"
                  autoComplete="off"
                />
              </label>

              <button className="auth-submit-btn" type="submit" disabled={licenseSubmitting}>
                {licenseSubmitting ? 'Lisans doğrulanıyor...' : 'Devam Et'}
              </button>

              <div className="auth-license-help">
                <strong>Lisansınız yok mu?</strong>
                <p>Lisans almak veya demo talebi oluşturmak için getshelfio.com adresini ziyaret edin.</p>
                <a href="https://getshelfio.com" target="_blank" rel="noreferrer">
                  getshelfio.com adresine git <ExternalLink size={14} />
                </a>
              </div>
            </form>
          ) : (
          <form className="auth-glass-card" onSubmit={handleSubmit}>
            <div className="auth-form-header">
              <h2>Giriş Yap</h2>
              <p>Devam etmek için oturum açın</p>
            </div>

            {error ? <div className="alert error">{error}</div> : null}
            {isLoading ? <div className="alert info">Oturum bilgisi kontrol ediliyor...</div> : null}

            <label className="auth-input-group">
              <User size={16} className="auth-input-icon" />
              <input name="username" value={form.username} onChange={handleChange} placeholder="Kullanıcı adı" />
            </label>

            <label className="auth-input-group">
              <Lock size={16} className="auth-input-icon" />
              <input name="password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={handleChange} placeholder="Şifre" />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </label>

            <button className="auth-submit-btn" type="submit" disabled={submitting}>
              {submitting ? 'Giriş yapılıyor...' : 'Giriş Yap'}
            </button>
            <button type="button" className="auth-change-license-btn" onClick={handleChangeLicense}>
              Lisansı Değiştir
            </button>
          </form>
          )}
        </div>
      </div>

      <footer className="auth-footer">
        <p>© 2026 Shelfio Stok ve Fiyat Yönetim Platformu. Tüm hakları saklıdır.</p>
        <button type="button" className="auth-footer-link" onClick={openCookiePreferences}>
          <Cookie size={13} /> Çerez Tercihleri
        </button>
        <small>Kurumsal erişim ekranı</small>
      </footer>
    </div>
  );
}



