import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, LogOut, ShieldAlert, Trash2 } from 'lucide-react';
import { createModalPortalHost, registerModalLayer } from '../utils/modalManager.js';

function ModalPortal({ onClose, children }) {
  const onCloseRef = useRef(onClose);
  const [portalNode, setPortalNode] = useState(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => registerModalLayer(() => onCloseRef.current?.()), []);

  useEffect(() => {
    const { node, dispose } = createModalPortalHost('confirm-modal');
    setPortalNode(node);
    return () => {
      setPortalNode(null);
      dispose();
    };
  }, []);

  if (!portalNode) {
    return null;
  }

  return createPortal(children, portalNode);
}

export default function ConfirmModal({
  isOpen,
  title = 'İşlemi Onayla',
  description,
  metaText,
  confirmText = 'Onayla',
  cancelText = 'İptal',
  tone = 'danger',
  onConfirm,
  onCancel,
  thirdAction,
  closeOnBackdrop = true,
  escClosable = true,
  closeButton = false,
  primaryAction = 'confirm',
  enterAction = 'primary',
  onEnter,
  onEscape,
  confirmButtonVariant = 'default',
  dialogClassName = '',
}) {
  if (!isOpen) return null;

  const variant = tone === 'danger' ? 'error' : 'confirm';

  return (
    <DialogBase
      isOpen={isOpen}
      variant={variant}
      title={title}
      description={description}
      metaText={metaText}
      showCancel
      cancelText={cancelText}
      confirmText={confirmText}
      onCancel={onCancel}
      onConfirm={onConfirm}
      thirdAction={thirdAction}
      closeOnBackdrop={closeOnBackdrop}
      escClosable={escClosable}
      closeButton={closeButton}
      primaryAction={primaryAction}
      enterAction={enterAction}
      onEnter={onEnter}
      onEscape={onEscape}
      confirmButtonVariant={confirmButtonVariant}
      dialogClassName={dialogClassName}
    />
  );
}

const DialogContext = createContext(null);

const fallbackDialogApi = {
  confirm: async () => false,
  alert: async () => true,
  info: async (options = {}) => fallbackDialogApi.alert(options),
  success: async (options = {}) => fallbackDialogApi.alert({ ...options, title: options.title || 'İşlem başarılı' }),
  warning: async (options = {}) => fallbackDialogApi.alert({ ...options, title: options.title || 'Uyarı' }),
  error: async (options = {}) => fallbackDialogApi.alert({ ...options, title: options.title || 'Hata' }),
  prompt: async () => null,
};

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    console.warn('useDialog was used outside DialogProvider; fallback dialog API is active.');
    return fallbackDialogApi;
  }
  return context;
}

function DialogBase({
  isOpen,
  variant = 'info',
  title = 'Bilgi',
  description = '',
  metaText = '',
  showCancel = false,
  cancelText = 'İptal',
  confirmText = 'Tamam',
  promptValue,
  promptPlaceholder = '',
  onPromptChange,
  onConfirm,
  onCancel,
  thirdAction,
  closeOnBackdrop = true,
  escClosable = true,
  closeButton = false,
  primaryAction = 'confirm',
  enterAction = 'primary',
  onEnter,
  onEscape,
  confirmButtonVariant = 'default',
  dialogClassName = '',
}) {
  const cardRef = useRef(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedTitle = String(title || '').toLocaleLowerCase('tr-TR');
  const normalizedConfirmText = String(confirmText || '').toLocaleLowerCase('tr-TR');
  const semanticText = `${normalizedTitle} ${normalizedConfirmText}`;

  const HeaderIcon = useMemo(() => {
    if (semanticText.includes('çıkış') || semanticText.includes('oturum')) return LogOut;
    if (semanticText.includes('sil') || semanticText.includes('kaldır')) return Trash2;
    if (variant === 'confirm') return AlertCircle;
    if (variant === 'warning' || variant === 'error') return AlertTriangle;
    if (variant === 'success') return CheckCircle2;
    if (variant === 'info') return Info;
    return ShieldAlert;
  }, [semanticText, variant]);

  const ConfirmActionIcon = useMemo(() => {
    if (semanticText.includes('çıkış') || semanticText.includes('oturum')) return LogOut;
    if (semanticText.includes('sil') || semanticText.includes('kaldır')) return Trash2;
    if (variant === 'warning' || variant === 'error') return AlertTriangle;
    return null;
  }, [semanticText, variant]);

  const runEnterAction = useCallback(() => {
    if (typeof onEnter === 'function') {
      onEnter();
      return;
    }
    if (enterAction === 'cancel') {
      onCancel?.();
      return;
    }
    if (enterAction === 'third') {
      if (!thirdAction?.disabled) {
        thirdAction?.onClick?.();
      }
      return;
    }
    if (primaryAction === 'cancel') {
      onCancel?.();
      return;
    }
    onConfirm?.();
  }, [enterAction, onCancel, onConfirm, onEnter, primaryAction, thirdAction]);

  const runEscapeAction = useCallback(() => {
    if (typeof onEscape === 'function') {
      onEscape();
      return;
    }
    onCancel?.();
  }, [onCancel, onEscape]);

  const confirmButtonClassName = useMemo(() => {
    if (confirmButtonVariant === 'danger-ghost') {
      return 'ghost-button app-dialog-confirm-btn app-dialog-confirm-btn--danger-ghost';
    }
    if (primaryAction === 'cancel') {
      return 'ghost-button app-dialog-confirm-btn app-dialog-confirm-btn--secondary';
    }
    return `${variant === 'error' ? 'danger-button' : 'primary-button'} app-dialog-confirm-btn`;
  }, [confirmButtonVariant, primaryAction, variant]);

  const thirdActionClassName = useMemo(() => {
    if (thirdAction?.variant === 'secondary-highlight') {
      return 'ghost-button app-dialog-extra-btn app-dialog-extra-btn--highlight';
    }
    return 'ghost-button app-dialog-extra-btn';
  }, [thirdAction?.variant]);

  useEffect(() => {
    if (!isOpen || !cardRef.current) return;

    const node = cardRef.current;
    const focusables = Array.from(node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.hasAttribute('disabled'));
    const preferred = node.querySelector('[data-autofocus="true"]');
    const initialFocus = preferred || focusables[0] || node;
    initialFocus?.focus?.({ preventScroll: true });

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (!escClosable) return;
        event.preventDefault();
        runEscapeAction();
        return;
      }

      if (event.key === 'Enter') {
        const targetTag = event.target?.tagName?.toLowerCase();
        if (targetTag === 'textarea') return;
        event.preventDefault();
        runEnterAction();
        return;
      }

      if (event.key !== 'Tab') return;
      const list = Array.from(node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.hasAttribute('disabled'));
      if (!list.length) {
        event.preventDefault();
        return;
      }

      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [escClosable, isOpen, runEnterAction, runEscapeAction]);

  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleConfirmClick = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = onConfirm?.();
      if (result && typeof result.then === 'function') {
        await result;
      }
      const shouldAutoCloseDeleteConfirm = normalizedConfirmText.includes('sil');
      if (shouldAutoCloseDeleteConfirm) {
        onCancel?.();
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, normalizedConfirmText, onCancel, onConfirm]);

  if (!isOpen) return null;

  return (
    <ModalPortal onClose={escClosable ? onCancel : undefined}>
      <div className="modal-overlay" onClick={closeOnBackdrop ? onCancel : undefined}>
        <div
          className={`modal-card app-dialog app-dialog--${variant} app-dialog-standardized ${dialogClassName}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="app-dialog-title"
          aria-describedby="app-dialog-description"
          tabIndex={-1}
          ref={cardRef}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="modal-header app-dialog-header">
            <div className="app-dialog-title-wrap">
              <span className="app-dialog-icon" aria-hidden="true">
                <HeaderIcon size={18} />
              </span>
              <div className="modal-header-title-wrap">
                <h3 id="app-dialog-title">{title}</h3>
                {description ? <p id="app-dialog-description">{description}</p> : null}
                {metaText ? <small className="app-dialog-meta">{metaText}</small> : null}
              </div>
            </div>
            {closeButton ? (
              <button className="icon-button modal-close-button" onClick={onCancel} type="button" aria-label="Pencereyi kapat">
                ×
              </button>
            ) : null}
          </div>

          {typeof promptValue === 'string' ? (
            <div className="app-dialog-input-row">
              <input
                value={promptValue}
                onChange={(event) => onPromptChange?.(event.target.value)}
                placeholder={promptPlaceholder}
                className="app-dialog-input"
                autoFocus
              />
            </div>
          ) : null}

          <div className="modal-actions app-dialog-actions">
            {showCancel ? (
              <button
                className="ghost-button app-dialog-cancel-btn"
                type="button"
                data-autofocus={primaryAction === 'confirm' ? 'true' : undefined}
                onClick={onCancel}
                disabled={isSubmitting}
              >
                {cancelText}
              </button>
            ) : null}

            {thirdAction ? (
              <button className={thirdActionClassName} type="button" onClick={thirdAction.onClick} disabled={thirdAction.disabled}>
                {thirdAction.label}
              </button>
            ) : null}

            <button
              className={confirmButtonClassName}
              type="button"
              data-autofocus={primaryAction === 'cancel' ? 'true' : undefined}
              onClick={handleConfirmClick}
              disabled={isSubmitting}
            >
              {ConfirmActionIcon ? <ConfirmActionIcon size={15} /> : null}
              {isSubmitting ? 'İşleniyor...' : confirmText}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

export function DialogProvider({ children }) {
  const [dialogState, setDialogState] = useState(null);

  const close = useCallback((result) => {
    setDialogState((current) => {
      current?.resolve?.(result);
      return null;
    });
  }, []);

  const open = useCallback((variant, options = {}) => new Promise((resolve) => {
    setDialogState({
      variant,
      options,
      resolve,
      promptValue: options.defaultValue || '',
    });
  }), []);

  const api = useMemo(() => ({
    confirm: (options = {}) => open('confirm', options),
    alert: (options = {}) => open('alert', options),
    info: (options = {}) => open('info', options),
    success: (options = {}) => open('success', options),
    warning: (options = {}) => open('warning', options),
    error: (options = {}) => open('error', options),
    prompt: (options = {}) => open('prompt', options),
  }), [open]);

  const active = dialogState;
  const options = active?.options || {};
  const variant = active?.variant || 'info';
  const isPrompt = variant === 'prompt';
  const showCancel = variant === 'confirm' || isPrompt;

  return (
    <DialogContext.Provider value={api}>
      {children}
      {active ? (
        <DialogBase
          isOpen
          variant={variant === 'confirm' ? (options.tone === 'danger' ? 'error' : 'confirm') : variant}
          title={options.title || 'Bilgi'}
          description={options.description || ''}
          metaText={options.metaText || ''}
          showCancel={showCancel}
          cancelText={options.cancelText || 'İptal'}
          confirmText={options.confirmText || (showCancel ? 'Onayla' : 'Tamam')}
          promptValue={isPrompt ? active.promptValue : undefined}
          promptPlaceholder={options.placeholder || ''}
          onPromptChange={(value) => setDialogState((current) => (current ? { ...current, promptValue: value } : current))}
          onCancel={() => close(isPrompt ? null : false)}
          onConfirm={() => close(isPrompt ? (active.promptValue || '') : true)}
          thirdAction={options.thirdAction}
          closeOnBackdrop={options.closeOnBackdrop !== false}
          escClosable={options.escClosable !== false}
          closeButton={Boolean(options.closeButton)}
          primaryAction={options.primaryAction || 'confirm'}
          enterAction={options.enterAction || 'primary'}
          onEnter={options.onEnter}
          onEscape={options.onEscape}
          confirmButtonVariant={options.confirmButtonVariant || 'default'}
          dialogClassName={options.dialogClassName || ''}
        />
      ) : null}
    </DialogContext.Provider>
  );
}
