import { useEffect, useState } from 'react';
import './POS.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Delete, LogOut, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import PinGate from '../../components/PinGate.jsx';
import POS from './POS.jsx';
import Toast from '../../components/Toast.jsx';
import ConfirmModal from '../../components/ConfirmModal.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { posService } from '../../services/posService.js';

const DESK_CONFIG = [
  { code: 'B1', label: 'Kasa 1' },
  { code: 'B2', label: 'Kasa 2' },
  { code: 'B3', label: 'Kasa 3' },
  { code: 'B4', label: 'Kasa 4' },
  { code: 'B5', label: 'Kasa 5' },
  { code: 'B6', label: 'Kasa 6' },
  { code: 'B7', label: 'Kasa 7' },
  { code: 'B8', label: 'Yönetim Kasası', isManagement: true },
];
const DESKS = DESK_CONFIG.map((item) => item.code);
const ACTIVE_DESK_SESSIONS_KEY = 'pos_active_desk_sessions';
const REGISTER_PIN_LENGTH = 4;
const GATE_STEP_ITEMS = ['Kasa Bilgisi', 'Sicil Girişi', 'Şifre Doğrula'];

const readActiveDeskSessions = () => {
  try {
    const raw = localStorage.getItem(ACTIVE_DESK_SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeActiveDeskSessions = (sessions) => {
  localStorage.setItem(ACTIVE_DESK_SESSIONS_KEY, JSON.stringify(sessions));
};

function AccessDeniedPanel({ title = 'Yetkisiz Erişim', description, onBack }) {
  return (
    <div className="page-stack pos-access-denied-page">
      <div className="pos-access-denied-card">
        <div className="pos-access-denied-icon" aria-hidden="true">
          <AlertTriangle size={30} />
        </div>
        <div className="pos-access-denied-copy">
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button type="button" className="secondary-button pos-access-denied-back" onClick={onBack}>
          <ArrowLeft size={16} /> Geri Dön
        </button>
      </div>
    </div>
  );
}

function GateStepper({ currentStep, floating = false }) {
  return (
    <div className={floating ? 'pos-gate-minimal-steps pos-gate-minimal-steps-floating' : 'pos-gate-minimal-steps'} aria-label="Kasa açılışı adımları">
      {GATE_STEP_ITEMS.map((label, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === currentStep;
        const isCompleted = stepNumber < currentStep;
        return (
          <div key={label} className={`pos-gate-minimal-step ${isActive ? 'is-active' : ''} ${isCompleted ? 'is-completed' : ''}`}>
            <span className="pos-gate-minimal-step-index">{stepNumber}</span>
            <span className="pos-gate-minimal-step-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function POSGate() {
  const [authenticated, setAuthenticated] = useState(false);
  const [toast, setToast] = useState(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [selectedDesk, setSelectedDesk] = useState('');
  const [registerPin, setRegisterPin] = useState('');
  const [registerPinConfirmed, setRegisterPinConfirmed] = useState(false);
  const [registerPinError, setRegisterPinError] = useState('');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [deskActivationStatus, setDeskActivationStatus] = useState({});
  const assignedDeskCode = String(user?.assignedDeskCode || '').trim().toUpperCase();
  const currentUserRegisterPin = String(user?.registerPin || '').replace(/\D/g, '').slice(0, 4);
  const allowedDeskConfig = isAdmin ?
    DESK_CONFIG
    : DESK_CONFIG.filter((item) => !item.isManagement && item.code === assignedDeskCode);

  const requestedDesk = (searchParams.get('desk') || '').toUpperCase();
  const requestedMode = String(searchParams.get('mode') || '').toLowerCase();
  const isActivationOnlyMode = requestedMode === 'activate';
  const isDeskValid = DESKS.includes(requestedDesk);
  const requestedDeskMeta = DESK_CONFIG.find((item) => item.code === requestedDesk);
  const requestedDeskLabel = requestedDeskMeta?.label || requestedDesk;

  useEffect(() => {
    if (selectedDesk && !allowedDeskConfig.some((item) => item.code === selectedDesk)) {
      setSelectedDesk('');
    }
  }, [allowedDeskConfig, selectedDesk]);

  useEffect(() => {
    if (!isAdmin && assignedDeskCode) {
      setSelectedDesk(assignedDeskCode);
    }
  }, [isAdmin, assignedDeskCode]);

  useEffect(() => {
    posService.getDeskActivationStatus().then((data) => setDeskActivationStatus(data || {})).catch(() => setDeskActivationStatus({}));
  }, []);

  useEffect(() => {
    setRegisterPinConfirmed(false);
  }, [requestedDesk]);

  const isDeskActivatedForCashier = (deskCode) => {
    if (isAdmin) return true;
    return deskActivationStatus?.[deskCode] === true;
  };

  const handleRegisterPinChange = (value) => {
    const normalized = String(value || '').replace(/\D/g, '').slice(0, REGISTER_PIN_LENGTH);
    setRegisterPin(normalized);
    if (registerPinError) {
      setRegisterPinError('');
    }
    if (registerPinConfirmed) {
      setRegisterPinConfirmed(false);
    }
  };

  const handleRegisterDigit = (digit) => {
    if (registerPin.length >= REGISTER_PIN_LENGTH) return;
    handleRegisterPinChange(`${registerPin}${digit}`);
  };

  const handleRegisterDelete = () => {
    handleRegisterPinChange(registerPin.slice(0, -1));
  };

  const handleRegisterClear = () => {
    handleRegisterPinChange('');
  };

  const handleRegisterPinSubmit = () => {
    if (registerPin.length !== REGISTER_PIN_LENGTH) {
      setRegisterPinError('Sicil numarası veya şifre hatalı.');
      return;
    }
    if (!currentUserRegisterPin) {
      setRegisterPinError('Sicil numarası veya şifre hatalı.');
      return;
    }
    if (registerPin !== currentUserRegisterPin) {
      setRegisterPinError('Sicil numarası veya şifre hatalı.');
      return;
    }
    setRegisterPinError('');
    setRegisterPinConfirmed(true);
  };

  useEffect(() => {
    if (authenticated || !isDeskValid || registerPinConfirmed) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (logoutConfirmOpen) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        handleRegisterPinSubmit();
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        handleRegisterDelete();
        return;
      }
      if (event.key === 'Delete') {
        event.preventDefault();
        handleRegisterClear();
        return;
      }
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        handleRegisterDigit(event.key);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [authenticated, isDeskValid, registerPinConfirmed, logoutConfirmOpen, registerPin]);

  useEffect(() => {
    if (!isDeskValid || isActivationOnlyMode || authenticated) {
      return;
    }

    const sessions = readActiveDeskSessions();
    const activeSession = sessions?.[requestedDesk];
    if (!activeSession || typeof activeSession !== 'object') {
      return;
    }

    const sessionUserId = String(activeSession.userId || '').trim();
    const currentUserId = String(user?.id || '').trim();
    if (sessionUserId && currentUserId && sessionUserId !== currentUserId) {
      return;
    }

    const sessionRegisterPin = String(activeSession.registerPin || '').replace(/\D/g, '').slice(0, REGISTER_PIN_LENGTH);
    if (sessionRegisterPin.length !== REGISTER_PIN_LENGTH) {
      return;
    }
    if (currentUserRegisterPin && sessionRegisterPin !== currentUserRegisterPin) {
      return;
    }

    setRegisterPin(sessionRegisterPin);
    setRegisterPinConfirmed(true);
    setAuthenticated(true);
  }, [isDeskValid, isActivationOnlyMode, authenticated, requestedDesk, user?.id, currentUserRegisterPin]);

  const handleLogout = () => {
    setLogoutConfirmOpen(false);
    if (user?.role !== 'cashier') {
      navigate('/pos-kasa', { replace: true });
      return;
    }
    logout();
    navigate('/giris', { replace: true });
  };

  const moveToDeskSelection = () => {
    const fallbackParams = isActivationOnlyMode ? { mode: 'activate' } : {};
    setSearchParams(fallbackParams, { replace: true });
    setRegisterPin('');
    setRegisterPinConfirmed(false);
  };

  if (!['admin', 'cashier'].includes(user?.role)) {
    return (
      <AccessDeniedPanel
        description="Bu alana sadece kasiyer veya yönetici kullanıcılar erişebilir."
        onBack={() => navigate(-1)}
      />
    );
  }

  if (!isDeskValid) {
    const effectiveDeskCode = selectedDesk || (!isAdmin ? assignedDeskCode : '');
    const selectedDeskMeta = DESK_CONFIG.find((item) => item.code === effectiveDeskCode);
    const selectedDeskLabel = selectedDeskMeta?.label || null;

    return (
      <div className="pin-gate pos-gate-minimal-page">
        <Toast toast={toast} onClose={() => setToast(null)} />
        <button className="danger-button pos-gate-floating-logout" type="button" onClick={() => setLogoutConfirmOpen(true)}>
          <LogOut size={14} /> Çıkış Yap
        </button>
        <GateStepper currentStep={1} floating />
        <div className="pin-gate-card pos-gate-minimal-card">
          <div className="pin-gate-header">
            <div className="pin-gate-lock-icon">
              <MonitorSmartphone size={26} />
            </div>
            <h2>Kasa Sistemine Giriş</h2>
            <p>İşleme devam etmek için kasanızı seçin.</p>
          </div>

          <label className="field-group pos-gate-field pos-gate-minimal-field">
            <span>{isAdmin ? 'Kasa Seçimi' : 'Atanmış Kasa'}</span>
            {isAdmin ? (
              <select
                className="pos-gate-select pos-gate-minimal-select"
                value={selectedDesk}
                onChange={(event) => setSelectedDesk(event.target.value)}
              >
                <option value="">Kasa seçin</option>
                {allowedDeskConfig.map((desk) => (
                  <option key={desk.code} value={desk.code}>{desk.label}</option>
                ))}
              </select>
            ) : (
              <div className="pos-gate-readonly-field pos-gate-minimal-readonly">{selectedDeskLabel || '-'}</div>
            )}
          </label>

          <button
            className="pin-submit"
            type="button"
            disabled={!effectiveDeskCode}
            onClick={() => {
              if (!effectiveDeskCode) {
                setToast({ type: 'error', title: 'Kasa Açılışı', message: 'Lütfen bir kasa seçin.' });
                return;
              }
              if (!isDeskActivatedForCashier(effectiveDeskCode)) {
                setToast({ type: 'error', title: 'Kasa Açılışı', message: 'Bu kasa yönetici tarafından aktif hale getirilmemiş. Lütfen yöneticiye başvurun.' });
                return;
              } 
              const nextParams = isActivationOnlyMode ?
                { desk: effectiveDeskCode, mode: 'activate' }
                : { desk: effectiveDeskCode };
              setSearchParams(nextParams, { replace: true });
            }}
          >
            <ArrowRight size={16} /> Devam Et
          </button>
        </div>
        <ConfirmModal
          isOpen={logoutConfirmOpen}
          title="Oturumu Kapat"
          description="Çıkış yapmak istedişinize emin misiniz?"
          confirmText="Çıkış Yap"
          cancelText="Vazgeç"
          tone="danger"
          onCancel={() => setLogoutConfirmOpen(false)}
          onConfirm={handleLogout}
        />
      </div>
    );
  }

  if (requestedDeskMeta?.isManagement && !isAdmin) {
    return (
      <AccessDeniedPanel
        title="Yönetim Kasası Yetkisi Gerekli"
        description="Yönetim Kasası'na sadece yönetici kullanıcılar erişebilir."
        onBack={moveToDeskSelection}
      />
    );
  }

  if (!isAdmin && requestedDesk && requestedDesk !== assignedDeskCode) {
    return (
      <AccessDeniedPanel
        title="Kasa Ataması Uyuşmuyor"
        description={`Bu kullanıcı sadece ${assignedDeskCode || 'atanmış'} kasada işlem yapabilir.`}
        onBack={moveToDeskSelection}
      />
    );
  }

  if (!isAdmin && !isDeskActivatedForCashier(requestedDesk)) {
    return (
      <AccessDeniedPanel
        title="Kasa Aktif Değil"
        description="Bu kasa yönetici tarafından aktif edilmediği için giriş yapılamaz."
        onBack={moveToDeskSelection}
      />
    );
  }

  if (!authenticated) {
    if (!registerPinConfirmed) {
      return (
        <div className="pin-gate pos-gate-minimal-page">
          <button className="danger-button pos-gate-floating-logout" type="button" onClick={() => setLogoutConfirmOpen(true)}>
            <LogOut size={14} /> Çıkış Yap
          </button>
          <GateStepper currentStep={2} floating />
          <div className="pin-gate-card pos-gate-minimal-card">
            <div className="pin-gate-header">
              <div className="pin-gate-lock-icon">
                <MonitorSmartphone size={26} />
              </div>
              <h2>Kasa Sistemine Giriş ({requestedDeskLabel})</h2>
              <p>Devam etmek için personel sicil numaranızı tuş takımından girin.</p>
            </div>

            <div className="pin-gate-display">
              <div className="pin-dots">
                {Array.from({ length: REGISTER_PIN_LENGTH }, (_, i) => (
                  <div key={i} className={`pin-dot ${i < registerPin.length ? 'pin-dot-filled' : ''}`} />
                ))}
              </div>
              {registerPinError ? <div className="pin-gate-error">{registerPinError}</div> : null}
            </div>

            <div className="pin-numpad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button key={n} className="pin-key" type="button" onClick={() => handleRegisterDigit(String(n))}>
                  {n}
                </button>
              ))}
              <button className="pin-key pin-key-action" type="button" onClick={handleRegisterClear}>C</button>
              <button className="pin-key" type="button" onClick={() => handleRegisterDigit('0')}>0</button>
              <button className="pin-key pin-key-action" type="button" onClick={handleRegisterDelete}>
                <Delete size={20} />
              </button>
            </div>

            <button className="pin-submit" type="button" disabled={registerPin.length !== REGISTER_PIN_LENGTH} onClick={handleRegisterPinSubmit}>
              <ShieldCheck size={18} /> Giriş Yap
            </button>
          </div>
          <button className="pin-cancel pos-gate-inline-back" type="button" onClick={moveToDeskSelection}>
            <ArrowLeft size={16} /> Geri Dön
          </button>
          <ConfirmModal
            isOpen={logoutConfirmOpen}
            title="Oturumu Kapat"
            description="Çıkış yapmak istedişinize emin misiniz?"
            confirmText="Çıkış Yap"
            cancelText="Vazgeç"
            tone="danger"
            onCancel={() => setLogoutConfirmOpen(false)}
            onConfirm={handleLogout}
          />
        </div>
      );
    }

    return (
      <>
        <button className="danger-button pos-gate-floating-logout" type="button" onClick={() => setLogoutConfirmOpen(true)}>
          <LogOut size={14} /> Çıkış Yap
        </button>
        <GateStepper currentStep={3} floating />
        <PinGate
          title={isActivationOnlyMode ? `Kasa Aktivasyonu (${requestedDeskLabel})` : `Kasa Sistemine Giriş (${requestedDeskLabel})`}
          description={isActivationOnlyMode ? `${requestedDeskLabel} kasasını aktif etmek için sicil ve erişim şifresini doğrulayın.` : `${requestedDeskLabel} için sicil ve erişim şifresini doğrulayın.`}
          type="desk"
          deskCode={requestedDesk}
          registerPin={registerPin}
          onSuccess={async (verifyResult) => {
            if (isActivationOnlyMode) {
              try {
                await posService.setDeskActivation(requestedDesk, true);
                setToast({ type: 'success', title: 'Kasa Açılışı', message: `${requestedDeskLabel} aktif hale getirildi` });
              } catch (error) {
                setToast({ type: 'error', title: 'Kasa Açılışı', message: error?.message || 'Kasa aktif hale getirilemedi' });
              } finally {
                navigate('/pos-kasa', { replace: true });
              }
              return;
            }

            const sessions = readActiveDeskSessions();
            sessions[requestedDesk] = {
              registerPin: verifyResult?.registerPin || registerPin,
              userId: verifyResult?.userId || null,
              userName: verifyResult?.userName || null,
              openedAt: new Date().toISOString(),
            };
            writeActiveDeskSessions(sessions);
            setToast({ type: 'success', title: 'Kasa Açılışı', message: `${requestedDeskLabel} açıldı` });
            setAuthenticated(true);
          }}
          onCancel={() => navigate('/pos-kasa')}
        />
        <ConfirmModal
          isOpen={logoutConfirmOpen}
          title="Oturumu Kapat"
          description="Çıkış yapmak istedişinize emin misiniz?"
          confirmText="Çıkış Yap"
          cancelText="Vazgeç"
          tone="danger"
          onCancel={() => setLogoutConfirmOpen(false)}
          onConfirm={handleLogout}
        />
      </>
    );
  }

  return <POS key={requestedDesk} deskCode={requestedDesk} />;
}
