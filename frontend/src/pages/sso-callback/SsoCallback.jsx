import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';
import { authService } from '../../services/authService.js';
import {
  SSO_PASSWORD_MESSAGE,
  SSO_PASSWORD_REQUIREMENTS,
  evaluateSsoPassword,
  validateSsoPassword,
} from '../../utils/ssoPasswordPolicy.js';

const EMPTY_FORM = {
  adminName: '',
  storeName: '',
  phone: '',
  password: '',
  passwordConfirm: '',
};

const resolveHomePath = (user) => {
  if (user?.role === 'cashier') return '/kasa';
  if (user?.role === 'depo_personeli') return '/depo-transfer-talepleri?fullscreen=1';
  if (user?.role === 'user') return '/urunler';
  return '/anasayfa';
};

const resolveAuthFailureMessage = (error) => {
  const errorCode = error?.payload?.errorCode || error?.errorCode || '';
  if (['license_missing', 'license_inactive', 'license_expired', 'license_pending'].includes(errorCode)) {
    return 'Lisans doğrulaması tamamlanamadı. Lütfen lisans durumunuzu kontrol edin.';
  }
  if (['tenant_mismatch', 'tenant_missing', 'tenant_inactive', 'store_missing'].includes(errorCode)) {
    return 'Tenant veya mağaza bağlantısı doğrulanamadı. Lütfen destek ekibiyle iletişime geçin.';
  }
  if (['module_access_denied', 'screen_access_denied', 'module_not_licensed', 'screen_not_licensed'].includes(errorCode)) {
    return 'Lisans kapsamınız bu ekran için yeterli değil.';
  }
  return error?.message || 'Oturum doğrulaması tamamlanamadı. Lütfen tekrar deneyin.';
};

export default function SsoCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setUser } = useAuth();
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Ana sistem hesabınız hazırlanıyor...');
  const [detailMessage, setDetailMessage] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [setup, setSetup] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const code = useMemo(() => String(searchParams.get('code') || '').trim(), [searchParams]);
  const passwordChecks = useMemo(() => evaluateSsoPassword(form.password), [form.password]);
  const passwordsMatch = Boolean(form.password) && form.password === form.passwordConfirm;
  const isPasswordValid = validateSsoPassword(form.password) && passwordsMatch;

  const completeLogin = async (data) => {
    if (!data?.token || !data?.user) {
      setStatus('error');
      setMessage('SSO oturumu eksik döndü. Lütfen getshelfio.com üzerinden tekrar deneyin.');
      setDetailMessage('');
      setErrorCode('sso_session_incomplete');
      return;
    }

    setUser(data.user);
    try {
      const currentUser = await authService.me();
      setUser(currentUser);
    } catch (error) {
      setStatus('error');
      setMessage(resolveAuthFailureMessage(error));
      setDetailMessage('Oturum bilgileriniz korunuyor; sorun giderildikten sonra tekrar deneyebilirsiniz.');
      setErrorCode(error?.payload?.errorCode || error?.errorCode || '');
      return;
    }

    setStatus('success');
    setMessage('Oturum açıldı. Yönlendiriliyorsunuz...');
    setDetailMessage('');
    setErrorCode('');
    window.setTimeout(() => navigate(resolveHomePath(data.user), { replace: true }), 400);
  };

  useEffect(() => {
    let active = true;

    const exchange = async () => {
      if (!code) {
        setStatus('error');
        setMessage('Geçiş kodu bulunamadı. Lütfen getshelfio.com üzerinden tekrar deneyin.');
        setDetailMessage('');
        setErrorCode('sso_exchange_failed');
        return;
      }

      try {
        const data = await authService.exchangeSsoCode(code);
        if (!active) return;
        if (data?.setupRequired) {
          setSetup(data);
          setStatus('setup');
          setMessage('Lisansınız doğrulandı. Ana sistem admin hesabınızı oluşturun.');
          setDetailMessage('');
          setErrorCode('');
          return;
        }
        await completeLogin(data);
      } catch (error) {
        if (!active) return;
        const safeCode = error?.payload?.errorCode || error?.errorCode || '';
        const isLicenseError = ['license_payload_missing', 'license_not_active', 'license_expired', 'tenant_missing', 'email_missing'].includes(safeCode);
        setStatus('error');
        setMessage(isLicenseError ? 'SSO lisans bilgisi doğrulanamadı.' : (error?.message || 'SSO oturumu açılamadı. Lütfen giriş ekranından tekrar deneyin.'));
        setDetailMessage(isLicenseError
          ? 'Lisansınız müşteri hesabınızda görünüyor olabilir; ancak ana sisteme geçiş için aktif lisans ve tenant bilgisi doğrulanamadı.'
          : '');
        setErrorCode(safeCode);
      }
    };

    exchange();
    return () => {
      active = false;
    };
  }, [code]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSetup = async (event) => {
    event.preventDefault();
    if (form.password !== form.passwordConfirm) {
      setMessage('Şifreler eşleşmiyor.');
      setErrorCode('password_mismatch');
      return;
    }
    if (!validateSsoPassword(form.password)) {
      setMessage(SSO_PASSWORD_MESSAGE);
      setErrorCode('weak_password');
      return;
    }

    setStatus('setup_submitting');
    setMessage('Ana sistem hesabınız hazırlanıyor...');
    try {
      const data = await authService.setupSsoAdmin({
        setupToken: setup.setupToken,
        email: setup.email,
        ...form,
      });
      await completeLogin(data);
    } catch (error) {
      setStatus('setup');
      setMessage(error?.message || 'Kurulum tamamlanamadı. Lütfen tekrar deneyin.');
      setDetailMessage('');
      setErrorCode(error?.payload?.errorCode || error?.errorCode || '');
    }
  };

  const isLoading = status === 'loading' || status === 'setup_submitting';
  const isSuccess = status === 'success';
  const isSetup = status === 'setup' || status === 'setup_submitting';

  return (
    <main className="auth-page">
      <div className="auth-layout sso-auth-layout">
        <section className={`auth-glass-card sso-auth-card${isSetup ? ' sso-auth-card--setup' : ''}`}>
          <div className="sso-auth-icon">
            {isLoading ? <LoaderCircle size={34} /> : isSuccess ? <CheckCircle2 size={34} /> : isSetup ? <ShieldCheck size={34} /> : <ShieldAlert size={34} />}
          </div>
          <div className="auth-form-header">
            <h2>{isSetup ? 'Admin Hesabınızı Oluşturun' : 'Shelfio SSO'}</h2>
            {isSetup ? <p>Yeni Shelfio alanınız için ilk yönetici hesabını güvenli şekilde tanımlayın.</p> : null}
          </div>
          <p className={`auth-tagline sso-auth-message${status === 'error' ? ' is-error' : ''}`}>{message}</p>
          {detailMessage ? <p className="auth-tagline sso-auth-message">{detailMessage}</p> : null}
          {errorCode ? <p className="auth-tagline sso-auth-message">Hata kodu: {errorCode}</p> : null}

          {isSetup ? (
            <form className="sso-setup-form" onSubmit={handleSetup}>
              <label>
                <span>Lisans sahibi e-posta</span>
                <input type="email" value={setup.email} readOnly />
              </label>
              <label>
                <span>Admin adı soyadı</span>
                <input name="adminName" value={form.adminName} onChange={handleChange} autoComplete="name" required />
              </label>
              <label>
                <span>Mağaza / işletme adı</span>
                <input name="storeName" value={form.storeName} onChange={handleChange} required />
              </label>
              <label>
                <span>Telefon <small>Opsiyonel</small></span>
                <input name="phone" value={form.phone} onChange={handleChange} autoComplete="tel" />
              </label>
              <label>
                <span>Şifre</span>
                <input name="password" type="password" value={form.password} onChange={handleChange} autoComplete="new-password" required />
              </label>
              <label>
                <span>Şifre tekrar</span>
                <input name="passwordConfirm" type="password" value={form.passwordConfirm} onChange={handleChange} autoComplete="new-password" required />
              </label>
              <div className="sso-password-checklist" aria-live="polite">
                {SSO_PASSWORD_REQUIREMENTS.map((item) => (
                  <span key={item.id} className={passwordChecks[item.id] ? 'is-valid' : ''}>
                    <CheckCircle2 size={14} />
                    {item.label}
                  </span>
                ))}
                <span className={passwordsMatch ? 'is-valid' : ''}>
                  <CheckCircle2 size={14} />
                  Şifreler eşleşiyor
                </span>
              </div>
              <p className="sso-password-hint">Türkçe karakterler desteklenir. Özel karakter olarak harf, rakam veya boşluk olmayan herhangi bir karakter kullanılabilir.</p>
              <button className="auth-submit-btn" type="submit" disabled={status === 'setup_submitting' || !isPasswordValid}>
                {status === 'setup_submitting' ? 'Hesabınız oluşturuluyor...' : 'Admin Hesabını Oluştur'}
              </button>
            </form>
          ) : null}

          {!isLoading && !isSuccess && !isSetup ? (
            <Link className="primary-button" to="/giris" replace>
              Giriş ekranına dön
            </Link>
          ) : null}
        </section>
      </div>
    </main>
  );
}
