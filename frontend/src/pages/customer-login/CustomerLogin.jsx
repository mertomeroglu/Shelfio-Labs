import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Gift, Lock, LogIn, Mail, Phone, ShieldCheck, ShoppingBag, User } from 'lucide-react';
import { customerPortalAuthService } from '../../services/customerPortalAuthService.js';
import { LEGAL_DOCUMENTS } from '../../components/Layout.jsx';
import logoPng from '../../assets/logo.png';

const LEGAL_ITEMS = [
  { key: 'aydinlatma_metni', label: 'Aydınlatma Metni' },
  { key: 'acik_riza_metni', label: 'Açık Rıza Metni' },
  { key: 'sartlar_ve_kosullar', label: 'Şartlar ve Koşullar' },
];

export default function CustomerLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', identity: '', password: '' });
  const [legalChecks, setLegalChecks] = useState({ aydinlatma_metni: false, acik_riza_metni: false, sartlar_ve_kosullar: false });
  const [activeLegalKey, setActiveLegalKey] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState('');
  const [forgotError, setForgotError] = useState('');
  const passwordRuleMessage = 'Şifre en az 8 karakter olmalı ve en az 1 büyük harf, 1 küçük harf, 1 rakam ve 1 özel karakter içermelidir.';
  const forgotSuccessMessage = 'Eğer bu e-posta sistemde kayıtlıysa şifre sıfırlama bağlantısı gönderildi.';

  const activeLegal = useMemo(() => LEGAL_ITEMS.find((item) => item.key === activeLegalKey) || null, [activeLegalKey]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setIsRegister(params.get('register') === '1');
  }, [location.search]);

  const validateForm = () => {
    const nextErrors = {};
    const normalizedEmail = String(form.email || '').trim().toLocaleLowerCase('tr-TR');
    const normalizedPhone = String(form.phone || '').replace(/\D/g, '');
    const password = String(form.password || '');
    const strongPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=?]).{8,}$/;

    if (isRegister) {
      if (!String(form.name || '').trim()) nextErrors.name = 'Ad soyad zorunludur.';
      if (!normalizedPhone || normalizedPhone.length < 10) nextErrors.phone = 'Geçerli bir telefon numarası girin.';
      if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) nextErrors.email = 'Geçerli bir e-posta adresi girin.';
      if (!strongPasswordPattern.test(password)) nextErrors.password = passwordRuleMessage;
      if (LEGAL_ITEMS.some((item) => !legalChecks[item.key])) nextErrors.legal = 'Devam etmek için tüm yasal metinleri onaylayın.';
    } else {
      if (!String(form.identity || '').trim()) nextErrors.identity = 'Telefon veya e-posta zorunludur.';
      if (!password) nextErrors.password = 'Şifre zorunludur.';
    }

    return nextErrors;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    const normalizedEmail = String(form.email || '').trim().toLocaleLowerCase('tr-TR');
    const normalizedPhone = String(form.phone || '').replace(/\D/g, '');
    const password = String(form.password || '');

    const validationErrors = validateForm();
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      setError(validationErrors.legal || 'Lütfen işaretli alanları düzeltin.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      if (isRegister) {
        await customerPortalAuthService.register({ name: form.name, phone: normalizedPhone, email: normalizedEmail, password });
      } else {
        await customerPortalAuthService.login(form.identity, form.password);
      }
      const nextPath = location.state?.from?.pathname || '/musteri';
      const nextSearch = location.state?.from?.search || '';
      navigate(`${nextPath}${nextSearch}`, { replace: true });
    } catch (requestError) {
      setError(requestError.message || 'Giriş başarısız.');
    } finally {
      setLoading(false);
    }
  };

  const submitForgotPassword = async (event) => {
    event.preventDefault();
    const email = String(forgotEmail || '').trim().toLocaleLowerCase('tr-TR');
    setForgotError('');
    setForgotMessage('');
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setForgotError('Geçerli bir e-posta adresi girin.');
      return;
    }

    setForgotLoading(true);
    try {
      const result = await customerPortalAuthService.forgotPassword(email);
      setForgotMessage(result?.message || forgotSuccessMessage);
    } catch (requestError) {
      setForgotError(requestError?.message || 'Şifre sıfırlama isteği gönderilemedi.');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <main className="shelf-auth-shell shelf-auth-shell-customer">
      <section className="shelf-auth-flow" aria-label="Müşteri giriş ekranı">
        <aside className="shelf-auth-hero">
          <header className="shelf-auth-brand shelf-auth-brand-customer shelf-auth-brand-vertical">
            <img src={logoPng} alt="Shelfio" className="shelf-auth-logo" />
          </header>
        </aside>

        <form className="shelf-auth-card shelf-auth-card-customer shelf-auth-panel" onSubmit={onSubmit} noValidate>
          <header className="shelf-auth-panel-head">
            <h2><LogIn size={18} aria-hidden="true" /> {isRegister ? 'Kayıt Ol' : 'Giriş Yap'}</h2>
            <p>{isRegister ? 'Yeni hesabınızı oluşturun' : 'Hesabınıza erişmek için giriş yapın'}</p>
          </header>
          {isRegister ? (
            <label className={`shelf-auth-field ${fieldErrors.name ? 'is-invalid' : ''}`} aria-label="Ad soyad">
              <User size={18} aria-hidden="true" />
              <input
                placeholder="Ad soyad"
                value={form.name}
                onChange={(event) => {
                  setForm((current) => ({ ...current, name: event.target.value }));
                  setFieldErrors((current) => ({ ...current, name: '' }));
                }}
              />
            </label>
          ) : null}
          {isRegister && fieldErrors.name ? <small className="shelf-auth-field-error">{fieldErrors.name}</small> : null}

          {isRegister ? (
            <label className={`shelf-auth-field ${fieldErrors.phone ? 'is-invalid' : ''}`} aria-label="Telefon">
              <Phone size={18} aria-hidden="true" />
              <input
                placeholder="Telefon"
                value={form.phone}
                onChange={(event) => {
                  setForm((current) => ({ ...current, phone: event.target.value }));
                  setFieldErrors((current) => ({ ...current, phone: '' }));
                }}
              />
            </label>
          ) : null}
          {isRegister && fieldErrors.phone ? <small className="shelf-auth-field-error">{fieldErrors.phone}</small> : null}

          {isRegister ? (
            <label className={`shelf-auth-field ${fieldErrors.email ? 'is-invalid' : ''}`} aria-label="E-posta">
              <Mail size={18} aria-hidden="true" />
              <input
                type="email"
                placeholder="E-posta"
                value={form.email}
                onChange={(event) => {
                  setForm((current) => ({ ...current, email: event.target.value }));
                  setFieldErrors((current) => ({ ...current, email: '' }));
                }}
              />
            </label>
          ) : (
            <label className={`shelf-auth-field ${fieldErrors.identity ? 'is-invalid' : ''}`} aria-label="Telefon veya e-posta">
              <User size={18} aria-hidden="true" />
              <input
                placeholder="Telefon veya e-posta"
                value={form.identity}
                onChange={(event) => {
                  setForm((current) => ({ ...current, identity: event.target.value }));
                  setFieldErrors((current) => ({ ...current, identity: '' }));
                }}
              />
            </label>
          )}
          {!isRegister && fieldErrors.identity ? <small className="shelf-auth-field-error">{fieldErrors.identity}</small> : null}

          <label className={`shelf-auth-field ${fieldErrors.password ? 'is-invalid' : ''}`} aria-label="Şifre">
            <Lock size={18} aria-hidden="true" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Şifre"
              value={form.password}
              onChange={(event) => {
                setForm((current) => ({ ...current, password: event.target.value }));
                setFieldErrors((current) => ({ ...current, password: '' }));
              }}
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
          {fieldErrors.password ? <small className="shelf-auth-field-error">{fieldErrors.password}</small> : null}
          {isRegister ? <small className="shelf-auth-help">{passwordRuleMessage}</small> : null}
          {!isRegister ? (
            <button type="button" className="shelf-auth-link shelf-auth-forgot-link" onClick={() => {
              setForgotEmail(String(form.identity || '').includes('@') ? form.identity : '');
              setForgotError('');
              setForgotMessage('');
              setForgotOpen(true);
            }}>
              Şifremi Unuttum
            </button>
          ) : null}

          {isRegister ? (
            <div className="shelf-auth-legal-box">
              <p className="shelf-auth-legal-title">Devam etmek için aşağıdaki metinleri onaylayın.</p>
              {LEGAL_ITEMS.map((item) => (
                <label key={item.key} className="shelf-auth-legal-row">
                  <input
                    type="checkbox"
                    checked={Boolean(legalChecks[item.key])}
                    onChange={(event) => setLegalChecks((current) => ({ ...current, [item.key]: event.target.checked }))}
                  />
                  <button type="button" className="shelf-auth-legal-text-btn" onClick={() => setActiveLegalKey(item.key)}>
                    {item.label} metnini okudum ve kabul ediyorum.
                  </button>
                </label>
              ))}
            </div>
          ) : null}
          {isRegister && fieldErrors.legal ? <small className="shelf-auth-field-error">{fieldErrors.legal}</small> : null}

          {error ? <p className="shelf-auth-error" role="alert">{error}</p> : null}

          <button type="submit" className="shelf-auth-submit" disabled={loading}>
            {loading ? 'İşleniyor...' : isRegister ? 'Kayıt Ol' : 'Giriş Yap'}
          </button>

          <div className="shelf-auth-actions">
            <button type="button" className="shelf-auth-secondary" onClick={() => setIsRegister((value) => !value)}>
              {isRegister ? 'Giriş ekranına dön' : 'Kayıt Ol'}
            </button>
            {!isRegister ? (
              <button type="button" className="shelf-auth-ghost" onClick={() => navigate('/musteri', { replace: true })}>
                Misafir olarak devam et
              </button>
            ) : null}
          </div>

        </form>

        <div className="shelf-auth-feature-stack">
          <article className="shelf-auth-feature-card">
            <span className="shelf-auth-feature-icon"><ShoppingBag size={18} /></span>
            <div><strong>Sipariş Takibi</strong><p>Geçmiş siparişlerinizi ve alışveriş detaylarınızı görüntüleyin.</p></div>
          </article>
          <article className="shelf-auth-feature-card">
            <span className="shelf-auth-feature-icon"><Gift size={18} /></span>
            <div><strong>Kampanyalar</strong><p>Size özel kampanya ve indirimleri takip edin.</p></div>
          </article>
          <article className="shelf-auth-feature-card">
            <span className="shelf-auth-feature-icon"><ShieldCheck size={18} /></span>
            <div><strong>Hediye Kartları</strong><p>Hediye kartlarınızı ve bakiyelerinizi yönetin.</p></div>
          </article>
        </div>
      </section>

      {activeLegal ? (
        <div className="shelf-auth-modal" role="dialog" aria-modal="true" aria-label={activeLegal.label}>
          <div className="shelf-auth-modal-card">
            <header>
              <h3>{activeLegal.label}</h3>
              <button type="button" className="shelf-auth-link" onClick={() => setActiveLegalKey('')}>Kapat</button>
            </header>
            <div className="shelf-auth-modal-body">
              <p>{(LEGAL_DOCUMENTS[activeLegal.key]?.content || '').trim()}</p>
            </div>
          </div>
        </div>
      ) : null}
      {forgotOpen ? (
        <div className="shelf-auth-modal" role="dialog" aria-modal="true" aria-label="Şifremi Unuttum">
          <form className="shelf-auth-modal-card" onSubmit={submitForgotPassword} noValidate>
            <header>
              <h3>Şifremi Unuttum</h3>
              <button type="button" className="shelf-auth-link" onClick={() => setForgotOpen(false)}>Kapat</button>
            </header>
            <div className="shelf-auth-modal-body">
              <p>Kayıtlı e-posta adresinizi girin. Hesabınız varsa şifre sıfırlama bağlantısı gönderilir.</p>
              <label className={`shelf-auth-field ${forgotError ? 'is-invalid' : ''}`} aria-label="E-posta">
                <Mail size={18} aria-hidden="true" />
                <input
                  type="email"
                  placeholder="E-posta"
                  value={forgotEmail}
                  onChange={(event) => {
                    setForgotEmail(event.target.value);
                    setForgotError('');
                    setForgotMessage('');
                  }}
                />
              </label>
              {forgotError ? <small className="shelf-auth-field-error">{forgotError}</small> : null}
              {forgotMessage ? <p className="shelf-auth-success" role="status">{forgotMessage}</p> : null}
              <button type="submit" className="shelf-auth-submit" disabled={forgotLoading}>
                {forgotLoading ? 'Gönderiliyor...' : 'Bağlantı Gönder'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

