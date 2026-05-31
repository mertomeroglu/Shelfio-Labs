import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, LoaderCircle, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.js';
import { authService } from '../../services/authService.js';

const resolveHomePath = (user) => {
  if (user?.role === 'cashier') return '/kasa';
  if (user?.role === 'depo_personeli') return '/depo-transfer-talepleri?fullscreen=1';
  if (user?.role === 'user') return '/urunler';
  return '/anasayfa';
};

export default function SsoCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setUser } = useAuth();
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('Shelfio oturumu hazırlanıyor...');
  const code = useMemo(() => String(searchParams.get('code') || '').trim(), [searchParams]);

  useEffect(() => {
    let active = true;

    const exchange = async () => {
      if (!code) {
        setStatus('error');
        setMessage('Geçiş kodu bulunamadı. Lütfen getshelfio.com üzerinden tekrar deneyin.');
        return;
      }

      try {
        const data = await authService.exchangeSsoCode(code);
        if (!active) return;
        setUser(data.user);
        setStatus('success');
        setMessage('Oturum açıldı. Yönlendiriliyorsunuz...');
        window.setTimeout(() => navigate(resolveHomePath(data.user), { replace: true }), 400);
      } catch (error) {
        if (!active) return;
        setStatus('error');
        setMessage(error?.message || 'SSO oturumu açılamadı. Lütfen giriş ekranından tekrar deneyin.');
      }
    };

    exchange();

    return () => {
      active = false;
    };
  }, [code, navigate, setUser]);

  const isLoading = status === 'loading';
  const isSuccess = status === 'success';

  return (
    <main className="auth-page">
      <div className="auth-layout" style={{ gridTemplateColumns: 'minmax(0, 420px)', justifyContent: 'center' }}>
        <section className="auth-glass-card" style={{ alignItems: 'center', textAlign: 'center' }}>
          {isLoading ? <LoaderCircle size={34} /> : isSuccess ? <CheckCircle2 size={34} /> : <ShieldAlert size={34} />}
          <div className="auth-form-header">
            <h2>Shelfio SSO</h2>
          </div>
          <p className="auth-tagline" style={{ margin: 0 }}>{message}</p>
          {!isLoading && !isSuccess ? (
            <Link className="primary-button" to="/giris" replace>
              Giriş ekranına dön
            </Link>
          ) : null}
        </section>
      </div>
    </main>
  );
}
