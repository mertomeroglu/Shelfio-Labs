import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { customerPortalAuthService } from '../../services/customerPortalAuthService.js';
import logoPng from '../../assets/logo.png';

export default function CustomerPasswordReset() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => String(searchParams.get('token') || '').trim(), [searchParams]);
  const [form, setForm] = useState({ password: '', passwordConfirm: '' });
  const [fieldError, setFieldError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const validate = () => {
    const password = String(form.password || '');
    const passwordConfirm = String(form.passwordConfirm || '');
    if (!token) return 'Şifre sıfırlama bağlantısı geçersiz.';
    if (!password || !passwordConfirm) return 'Yeni şifre ve şifre tekrarı zorunludur.';
    if (password !== passwordConfirm) return 'Şifreler eşleşmiyor.';
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) {
      return 'Şifre en az 8 karakter olmalı ve en az 1 harf ile 1 rakam içermelidir.';
    }
    return '';
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationError = validate();
    setFieldError(validationError);
    setMessage('');
    if (validationError) return;

    setLoading(true);
    try {
      const result = await customerPortalAuthService.resetPassword({ token, ...form });
      setMessage(result?.message || 'Şifreniz güncellendi. Giriş yapabilirsiniz.');
      window.setTimeout(() => navigate('/musteri', { replace: true }), 1400);
    } catch (error) {
      setFieldError(error?.message || 'Şifre sıfırlama işlemi tamamlanamadı.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="shelf-auth-shell shelf-auth-shell-customer">
      <section className="shelf-auth-flow" aria-label="Müşteri şifre sıfırlama ekranı">
        <aside className="shelf-auth-hero">
          <header className="shelf-auth-brand shelf-auth-brand-customer shelf-auth-brand-vertical">
            <img src={logoPng} alt="Shelfio" className="shelf-auth-logo" />
          </header>
        </aside>

        <form className="shelf-auth-card shelf-auth-card-customer shelf-auth-panel" onSubmit={handleSubmit} noValidate>
          <header className="shelf-auth-panel-head">
            <h2><ShieldCheck size={18} aria-hidden="true" /> Şifre Sıfırla</h2>
            <p>Yeni müşteri şifrenizi belirleyin.</p>
          </header>

          {!token ? <p className="shelf-auth-error" role="alert">Şifre sıfırlama bağlantısı geçersiz.</p> : null}

          <label className={`shelf-auth-field ${fieldError ? 'is-invalid' : ''}`} aria-label="Yeni şifre">
            <Lock size={18} aria-hidden="true" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Yeni şifre"
              value={form.password}
              onChange={(event) => {
                setForm((current) => ({ ...current, password: event.target.value }));
                setFieldError('');
              }}
            />
            <button type="button" className="shelf-auth-toggle" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </label>

          <label className={`shelf-auth-field ${fieldError ? 'is-invalid' : ''}`} aria-label="Yeni şifre tekrar">
            <Lock size={18} aria-hidden="true" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Yeni şifre tekrar"
              value={form.passwordConfirm}
              onChange={(event) => {
                setForm((current) => ({ ...current, passwordConfirm: event.target.value }));
                setFieldError('');
              }}
            />
          </label>

          <small className="shelf-auth-help">En az 8 karakter, en az 1 harf ve 1 rakam kullanın.</small>
          {fieldError ? <small className="shelf-auth-field-error">{fieldError}</small> : null}
          {message ? <p className="shelf-auth-success" role="status">{message}</p> : null}

          <button type="submit" className="shelf-auth-submit" disabled={loading || !token}>
            {loading ? 'Güncelleniyor...' : 'Şifreyi Güncelle'}
          </button>
          <button type="button" className="shelf-auth-secondary" onClick={() => navigate('/musteri', { replace: true })}>
            Giriş ekranına dön
          </button>
        </form>
      </section>
    </main>
  );
}
