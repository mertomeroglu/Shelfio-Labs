import { useEffect, useMemo, useState } from 'react';
import { ShieldPlus } from 'lucide-react';
import FormModal from './FormModal.jsx';
import { accessService } from '../services/accessService.js';
import { getPermissionOptionsWithInitial, REQUEST_PERMISSION_OPTIONS } from '../config/accessRequestPermissions.js';

export default function AccessRequestModal({ isOpen, onClose, onSuccess, initialPermission = '', initialReason = '' }) {
  const availablePermissions = useMemo(() => {
    return getPermissionOptionsWithInitial(initialPermission);
  }, [initialPermission]);
  const [permission, setPermission] = useState(REQUEST_PERMISSION_OPTIONS[0].value);
  const [durationMinutes, setDurationMinutes] = useState(240);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const normalizedPermission = String(initialPermission || '').trim();
    const defaultPermission = normalizedPermission || REQUEST_PERMISSION_OPTIONS[0].value;
    setPermission(defaultPermission);
    setReason(String(initialReason || '').trim());
    setDurationMinutes(240);
  }, [initialPermission, initialReason, isOpen]);

  const submit = async (event) => {
    event.preventDefault();
    if (!String(reason || '').trim()) {
      return;
    }
    try {
      setSaving(true);
      await accessService.createRequest({
        permission,
        requestedDurationMinutes: Number(durationMinutes),
        reason,
      });
      onSuccess?.();
      setReason('');
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      title="Erişim Talep Et"
      description="İhtiyacın olan yetkiyi seç ve süre belirle."
      headerIcon={<ShieldPlus size={16} />}
      onClose={onClose}
      modalClassName="access-review-modal"
      confirmOnDirtyClose={false}
    >
      <form className="modal-form modal-structured-form" onSubmit={submit}>
        <div className="modal-form-body-scroll">
          <div className="grid-form">
            <label className="field-group">
              <span>Yetki</span>
              <select value={permission} onChange={(event) => setPermission(event.target.value)}>
                {availablePermissions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>

            <label className="field-group">
              <span>Süre (dakika)</span>
              <input type="number" min="15" max="43200" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
            </label>

            <label className="field-group form-col-span-2">
              <span>Gerekçe</span>
              <textarea rows={3} value={reason} required onChange={(event) => setReason(event.target.value)} />
            </label>
          </div>
        </div>

        <div className="modal-actions modal-actions-sticky">
          <button type="button" className="secondary-button" onClick={onClose}>İptal</button>
          <button type="submit" className="primary-button" disabled={saving || !String(reason || '').trim()}><ShieldPlus size={15} /> {saving ? 'Gönderiliyor...' : 'Talep Gönder'}</button>
        </div>
      </form>
    </FormModal>
  );
}
