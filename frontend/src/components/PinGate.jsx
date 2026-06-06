import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Delete, Loader, Lock, ShieldCheck, XCircle } from 'lucide-react';
import { settingsService } from '../services/settingsService.js';
import { createModalPortalHost, registerModalLayer } from '../utils/modalManager.js';

const PIN_LENGTH = 4;

const INVALID_PIN_MESSAGE_BY_TYPE = {
  pos: 'Şifre yanlış.',
  settings: 'PIN hatalı.',
  'role-management': 'PIN hatalı.',
};

export default function PinGate({
  title = 'Kasa Sistemine Giriş',
  description = 'Devam etmek için kasa erişim şifresini girin.',
  type = 'pos',
  deskCode,
  registerPin,
  onSuccess,
  onCancel,
  onError,
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [portalNode, setPortalNode] = useState(null);
  const inputRef = useRef(null);
  const successTimeoutRef = useRef(null);
  const onCancelRef = useRef(onCancel);

  const successLabel =
    type === 'role-management'
      ? 'Yönetim paneli açılıyor...'
      : 'Kasa yönetim sistemine gidiliyor...';

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const { node, dispose } = createModalPortalHost('pin-gate');
    setPortalNode(node);
    return () => {
      setPortalNode(null);
      dispose();
    };
  }, []);

  const handleDigit = useCallback((digit) => {
    setPin((current) => {
      if (current.length >= PIN_LENGTH) {
        return current;
      }
      return current + digit;
    });
    setError('');
  }, []);

  const handleDelete = useCallback(() => {
    setPin((current) => current.slice(0, -1));
    setError('');
  }, []);

  const handleClear = useCallback(() => {
    setPin('');
    setError('');
  }, []);

  const resolveErrorMessage = useCallback(
    (err) => {
      const rawMessage = String(err?.message || '');
      const normalized = rawMessage.toLocaleLowerCase('tr-TR');
      const invalidPinLike =
        normalized.includes('pin') ||
        normalized.includes('şifre') ||
        normalized.includes('sifre') ||
        normalized.includes('hatal') ||
        normalized.includes('yanlış') ||
        normalized.includes('yanlis') ||
        normalized.includes('invalid') ||
        normalized.includes('unauthorized') ||
        normalized.includes('yetkisiz') ||
        err?.status === 401;

      if (invalidPinLike) {
        return INVALID_PIN_MESSAGE_BY_TYPE[type] || 'Doğrulama başarısız.';
      }

      return err?.message || 'Doğrulama başarısız. Lütfen tekrar deneyin.';
    },
    [type]
  );

  const handleSubmit = useCallback(async () => {
    if (verifying || success) {
      return;
    }

    if (pin.length !== PIN_LENGTH) {
      setError(`PIN ${PIN_LENGTH} haneli olmalıdır.`);
      return;
    }

    setVerifying(true);
    setError('');

    try {
      const result = await settingsService.verifyPin(pin, type, deskCode, registerPin);
      setSuccess(true);
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      successTimeoutRef.current = setTimeout(() => {
        onSuccess?.(result);
      }, 800);
    } catch (err) {
      const message = resolveErrorMessage(err);
      setError(message);
      setPin('');
      onError?.(err, message);
    } finally {
      setVerifying(false);
    }
  }, [deskCode, onError, onSuccess, pin, registerPin, resolveErrorMessage, success, type, verifying]);

  const handleKeyDown = useCallback(
    (event) => {
      if (verifying || success) {
        return;
      }

      const targetTag = event.target?.tagName?.toLowerCase?.() || '';
      if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select' || event.target?.isContentEditable) {
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        if (pin.length === PIN_LENGTH) {
          handleSubmit();
        }
        return;
      }

      if (event.key === 'Backspace') {
        handleDelete();
        return;
      }

      if (/^\d$/.test(event.key)) {
        handleDigit(event.key);
      }
    },
    [handleDelete, handleDigit, handleSubmit, pin.length, success, verifying]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(
    () => () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
    },
    []
  );

  useEffect(() => registerModalLayer(() => onCancelRef.current?.()), []);

  const content = success ? (
    <div className="pin-gate">
      <div className="pin-gate-card pin-gate-success-card">
        <div className="pin-gate-success-icon">
          <ShieldCheck size={48} />
        </div>
        <h2>{successLabel}</h2>
      </div>
    </div>
  ) : (
    <div className="pin-gate">
      <div className="pin-gate-card">
        <div className="pin-gate-header">
          <div className="pin-gate-lock-icon">
            <Lock size={28} />
          </div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>

        <div className={`pin-gate-display ${error ? 'pin-gate-display-error' : ''}`}>
          <input ref={inputRef} className="sr-only" tabIndex={-1} aria-hidden="true" readOnly value={pin} />
          <div className={`pin-dots ${error ? 'pin-dots-error' : ''}`}>
            {Array.from({ length: PIN_LENGTH }, (_, index) => (
              <div key={index} className={`pin-dot ${index < pin.length ? 'pin-dot-filled' : ''}`} />
            ))}
          </div>
          {error ? (
            <div className="pin-gate-error">
              <XCircle size={14} /> {error}
            </div>
          ) : null}
        </div>

        <div className="pin-numpad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) => (
            <button
              key={number}
              className="pin-key"
              type="button"
              onClick={() => handleDigit(String(number))}
              disabled={verifying}
            >
              {number}
            </button>
          ))}
          <button className="pin-key pin-key-action" type="button" onClick={handleClear} disabled={verifying}>
            C
          </button>
          <button className="pin-key" type="button" onClick={() => handleDigit('0')} disabled={verifying}>
            0
          </button>
          <button className="pin-key pin-key-action" type="button" onClick={handleDelete} disabled={verifying}>
            <Delete size={20} />
          </button>
        </div>

        <button className="pin-submit" type="button" onClick={handleSubmit} disabled={verifying || pin.length !== PIN_LENGTH}>
          {verifying ? (
            <>
              <Loader size={18} className="pin-spinner" /> Doğrulanıyor...
            </>
          ) : (
            <>
              <ShieldCheck size={18} /> Giriş Yap
            </>
          )}
        </button>

        {onCancel ? (
          <button className="pin-cancel" type="button" onClick={onCancel}>
            <ArrowLeft size={16} /> Geri Dön
          </button>
        ) : null}
      </div>
    </div>
  );

  if (!portalNode) {
    return content;
  }

  return createPortal(content, portalNode);
}

