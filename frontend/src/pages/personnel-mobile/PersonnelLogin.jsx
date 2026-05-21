import { useEffect, useMemo, useState } from 'react';
import './Personnel.css';
import { useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, Boxes, Eye, EyeOff, Lock, LogIn, ScanLine, User } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';
import logoPng from '../../assets/logo.png';

export default function PersonnelLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, login } = useAuth();

  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const redirectTarget = useMemo(() => {
    const from = String(location.state?.from || '').trim();
    return from.startsWith('/personel') ? from : '/personel';
  }, [location.state?.from]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(redirectTarget, { replace: true });
    }
  }, [isAuthenticated, navigate, redirectTarget]);

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
      await login({ username: form.username.trim(), password: form.password });
    } catch (requestError) {
      if (requestError?.status === 401) {
        setError('Kullanıcı adı veya şifre hatalı.');
      } else {
        setError(requestError?.message || 'Giriş işlemi tamamlanamadı.');
      }
      setSubmitting(false);
    }
  };

  return (
    <main className="shelf-auth-shell shelf-auth-shell-personnel">
      <section className="shelf-auth-flow" aria-label="Personel giriş ekranı">
        <aside className="shelf-auth-hero">
          <header className="shelf-auth-brand shelf-auth-brand-vertical">
            <img src={logoPng} alt="Shelfio" className="shelf-auth-logo" />
          </header>
        </aside>

        <form className="shelf-auth-card shelf-auth-card-personnel shelf-auth-panel" onSubmit={handleSubmit}>
          <header className="shelf-auth-panel-head">
            <h2><LogIn size={18} aria-hidden="true" /> Giriş Yap</h2>
            <p>Devam etmek için oturum açın</p>
          </header>
          {error ? <p className="shelf-auth-error" role="alert">{error}</p> : null}

          <label className="shelf-auth-field" aria-label="Kullanıcı adı">
            <User size={18} aria-hidden="true" />
            <input
              name="username"
              value={form.username}
              onChange={handleChange}
              placeholder="Kullanıcı adı"
              autoComplete="username"
            />
          </label>

          <label className="shelf-auth-field" aria-label="Şifre">
            <Lock size={18} aria-hidden="true" />
            <input
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={handleChange}
              placeholder="Şifre"
              autoComplete="current-password"
            />
            <button
              type="button"
              className="shelf-auth-toggle"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </label>

          <button className="shelf-auth-submit" type="submit" disabled={submitting}>
            {submitting ? 'Giriş yapılıyor...' : 'Giriş Yap'}
          </button>

          <footer className="shelf-auth-footer">Yalnızca yetkili personel erişimi içindir.</footer>
        </form>

        <div className="shelf-auth-feature-stack">
          <article className="shelf-auth-feature-card">
            <span className="shelf-auth-feature-icon"><Boxes size={18} /></span>
            <div><strong>Görev Takibi</strong><p>Günlük görevleri hızlıca yönetin.</p></div>
          </article>
          <article className="shelf-auth-feature-card">
            <span className="shelf-auth-feature-icon"><ScanLine size={18} /></span>
            <div><strong>Reyon ve Stok Kontrolü</strong><p>Ürün, raf ve depo durumlarını hızlıca kontrol edin.</p></div>
          </article>
          <article className="shelf-auth-feature-card">
            <span className="shelf-auth-feature-icon"><BarChart3 size={18} /></span>
            <div><strong>Satın Alma ve Mal Kabul</strong><p>Sipariş, teslimat ve mal kabul süreçlerini yönetin.</p></div>
          </article>
        </div>
      </section>
    </main>
  );
}
