import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Bell,
  CreditCard,
  Eye,
  FileText,
  LogOut,
  PackagePlus,
  PencilLine,
  PlusCircle,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Truck,
  Users,
} from 'lucide-react';
import { useDialog } from './ConfirmModal.jsx';
import { createModalPortalHost, registerModalLayer } from '../utils/modalManager.js';

const DIRTY_CLOSE_CONFIRM_TITLE = 'Kaydedilmemiş değişiklikler var';
const DIRTY_CLOSE_CONFIRM_TEXT = 'Kaydedilmemiş değişiklikler var. Kapatmak istediğinize emin misiniz?';

const inferHeaderIcon = (title) => {
  const text = String(title || '').trim().toLocaleLowerCase('tr-TR');
  if (!text) return <FileText size={18} />;
  if (text.includes('ürün')) return <PackagePlus size={18} />;
  if (text.includes('tedarikçi')) return <Truck size={18} />;
  if (text.includes('etiket') || text.includes('kategori')) return <Tag size={18} />;
  if (text.includes('eşleşme') || text.includes('rol')) return <ShieldCheck size={18} />;
  if (text.includes('satın alım') || text.includes('sipariş')) return <ShoppingCart size={18} />;
  if (text.includes('durum')) return <AlertTriangle size={18} />;
  if (text.includes('mal kabul')) return <Truck size={18} />;
  if (text.includes('görev')) return <PlusCircle size={18} />;
  if (text.includes('personel') || text.includes('müşteri')) return <Users size={18} />;
  if (text.includes('oturumu kapat')) return <LogOut size={18} />;
  if (text.includes('bildirim')) return <Bell size={18} />;
  if (text.includes('fiyat') || text.includes('detay') || text.includes('görüntüle')) return <Eye size={18} />;
  if (text.includes('ödeme')) return <CreditCard size={18} />;
  if (text.includes('düzenle')) return <PencilLine size={18} />;
  if (text.includes('yeni')) return <PlusCircle size={18} />;
  return <FileText size={18} />;
};

function createFieldSnapshot(rootElement) {
  if (!rootElement) return '[]';

  const fields = rootElement.querySelectorAll('input, select, textarea');
  const rows = Array.from(fields)
    .filter((field) => !field.disabled && !field.readOnly)
    .map((field, index) => {
      const key = field.name || field.id || `field-${index}`;
      const type = field.type || field.tagName;
      const checked = Boolean(field.checked);
      const value = field.value ?? '';
      return `${key}|${type}|${checked ? '1' : '0'}|${String(value)}`;
    });

  return JSON.stringify(rows);
}

export function FormSection({ title, description = '', className = '', children }) {
  return (
    <section className={`modal-form-section ${className}`.trim()}>
      {(title || description) ? (
        <div className="modal-form-section-head">
          {title ? <h4 className="modal-form-section-title">{title}</h4> : null}
          {description ? <p className="modal-form-section-desc">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function FormGrid({ className = '', children }) {
  return <div className={`modal-form-grid modal-form-grid-12 ${className}`.trim()}>{children}</div>;
}

function ModalPortal({ onClose, children }) {
  const onCloseRef = useRef(onClose);
  const [portalNode, setPortalNode] = useState(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => registerModalLayer(() => onCloseRef.current?.()), []);

  useEffect(() => {
    const { node, dispose } = createModalPortalHost('form-modal');
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

export default function FormModal({
  isOpen,
  title,
  description = '',
  headerIcon = null,
  headerActions = null,
  children,
  onClose,
  modalClassName = '',
  showCloseButton = true,
  confirmOnDirtyClose = true,
}) {
  const dialog = useDialog();
  const modalCardRef = useRef(null);
  const initialSnapshotRef = useRef('[]');
  const isClosingRef = useRef(false);
  const hasUserInteractedRef = useRef(false);
  const resolvedHeaderIcon = useMemo(() => headerIcon || inferHeaderIcon(title), [headerIcon, title]);

  useEffect(() => {
    if (!isOpen) {
      isClosingRef.current = false;
      hasUserInteractedRef.current = false;
      initialSnapshotRef.current = '[]';
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!confirmOnDirtyClose) {
      initialSnapshotRef.current = '[]';
      return;
    }

    hasUserInteractedRef.current = false;

    const syncSnapshot = () => {
      if (hasUserInteractedRef.current) return;
      initialSnapshotRef.current = createFieldSnapshot(modalCardRef.current);
    };

    const timer = window.setTimeout(syncSnapshot, 0);
    const intervalId = window.setInterval(syncSnapshot, 250);

    const handlePotentialUserChange = (event) => {
      if (!event.isTrusted) return;
      hasUserInteractedRef.current = true;
    };

    const node = modalCardRef.current;
    node?.addEventListener('input', handlePotentialUserChange, true);
    node?.addEventListener('change', handlePotentialUserChange, true);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(intervalId);
      node?.removeEventListener('input', handlePotentialUserChange, true);
      node?.removeEventListener('change', handlePotentialUserChange, true);
    };
  }, [isOpen, confirmOnDirtyClose]);

  if (!isOpen) {
    return null;
  }

  const requestClose = async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    if (!confirmOnDirtyClose) {
      onClose?.();
      return;
    }

    const currentSnapshot = createFieldSnapshot(modalCardRef.current);
    const hasChanges = hasUserInteractedRef.current && currentSnapshot !== initialSnapshotRef.current;

    if (hasChanges) {
      const confirmed = await dialog.confirm({
        title: DIRTY_CLOSE_CONFIRM_TITLE,
        description: DIRTY_CLOSE_CONFIRM_TEXT,
        confirmText: 'Kapat',
        cancelText: 'Geri Dön',
        closeOnBackdrop: false,
        dialogClassName: 'unsaved-changes-dialog',
      });
      if (!confirmed) {
        isClosingRef.current = false;
        return;
      }
    }

    onClose?.();
  };

  return (
    <ModalPortal onClose={requestClose}>
      <div className="modal-overlay" onClick={requestClose}>
        <div
          ref={modalCardRef}
          className={`modal-card app-modal-standard modal-header-standardized ${modalClassName}`.trim()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="modal-header">
            <div className="modal-header-title-wrap">
              {resolvedHeaderIcon ? <span className="modal-header-leading-icon" aria-hidden="true">{resolvedHeaderIcon}</span> : null}
              <div className="modal-header-title-block">
                <h3>{title}</h3>
                {description ? <p>{description}</p> : null}
              </div>
            </div>
            <div className="modal-header-controls">
              {headerActions ? <div className="modal-header-actions">{headerActions}</div> : null}
              {showCloseButton ? (
                <button className="icon-button modal-close-button" onClick={requestClose} type="button" aria-label="Modal kapat">
                  ×
                </button>
              ) : null}
            </div>
          </div>
          {children}
        </div>
      </div>
    </ModalPortal>
  );
}
