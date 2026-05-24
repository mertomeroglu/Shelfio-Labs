import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, Cookie, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';
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
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
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

  const handleTransitionComplete = useCallback(() => {
    navigate(resolvedRedirectPath, { replace: true });
  }, [navigate, resolvedRedirectPath]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
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
        const message = 'Şifre hatalı, tekrar deneyiniz.';
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
          </form>
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



