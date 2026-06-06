import { useMemo, useState } from 'react';
import { Lock, ShieldPlus } from 'lucide-react';
import Toast from './Toast.jsx';
import { accessService } from '../services/accessService.js';

export default function PageAccessGuard({
  permission,
  pageLabel,
  requestState,
  onRequestStateRefresh,
  onOpenRequestModal,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  const cta = useMemo(() => {
    if (requestState?.hasPending) {
      return { label: 'Bekleyen erişim talebiniz var', disabled: true };
    }
    if (requestState?.hasApproved) {
      return { label: 'Yetki tanımlı', disabled: true };
    }
    return { label: 'Erişim Talebi Gönder', disabled: false };
  }, [requestState?.hasApproved, requestState?.hasPending]);

  const handleCreateRequest = async () => {
    if (!permission || cta.disabled) return;

    if (typeof onOpenRequestModal === 'function') {
      onOpenRequestModal();
      return;
    }

    try {
      setIsSubmitting(true);
      await accessService.createRequest({
        permission,
        requestedDurationMinutes: 480,
        reason: `${pageLabel || 'Bu sayfa'} için erişim talep ediyorum.`,
      });
      setToast({ type: 'success', title: 'Erişim Talebi', message: 'Talebiniz yöneticilere iletildi.' });
      await onRequestStateRefresh?.();
    } catch (error) {
      setToast({ type: 'error', title: 'Erişim Talebi', message: error.message || 'Talep gönderilemedi.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="page-access-blocked" aria-live="polite">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <div className="page-access-blocked-card">
        <div className="page-access-blocked-icon"><Lock size={20} /></div>
        <h2>Bu sayfaya erişiminiz bulunmamaktadır</h2>
        <p>Buraya erişmek için erişim talebi oluşturabilirsiniz.</p>
        <button
          type="button"
          className="primary-button"
          onClick={handleCreateRequest}
          disabled={cta.disabled || isSubmitting}
        >
          <ShieldPlus size={15} /> {isSubmitting ? 'Gönderiliyor...' : cta.label}
        </button>
      </div>
    </section>
  );
}
