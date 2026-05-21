import { useMemo, useState } from 'react';
import { HelpCircle, Info, LifeBuoy, Paperclip, UploadCloud, X } from 'lucide-react';
import FormModal from './FormModal.jsx';
import { supportService } from '../services/supportService.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf']);

const toBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const raw = String(reader.result || '');
    const marker = 'base64,';
    const markerIndex = raw.indexOf(marker);
    resolve(markerIndex >= 0 ? raw.slice(markerIndex + marker.length) : raw);
  };
  reader.onerror = () => reject(new Error('Dosya okunamadı'));
  reader.readAsDataURL(file);
});

const roleLabel = (role) => {
  const map = {
    admin: 'Yönetici',
    user: 'Personel',
    cashier: 'Kasiyer',
    viewer: 'Komisyon B',
    komisyon_b: 'Komisyon B',
    komisyon_c: 'Komisyon C',
    komisyon_v: 'Komisyon V',
  };
  return map[role] || role || 'Bilinmiyor';
};

export default function SupportRequestModal({ isOpen, onClose, user, currentPath, onSuccess, onError }) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const generatedMeta = useMemo(() => ({
    user: user?.name || user?.username || 'Bilinmiyor',
    role: roleLabel(user?.role),
    page: currentPath || (typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search || ''}` : '/'),
    browser: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    sentAt: new Date().toISOString(),
  }), [currentPath, user?.name, user?.role, user?.username]);

  if (!isOpen) return null;

  const reset = () => {
    setSubject('');
    setDescription('');
    setAttachments([]);
    setFormError('');
  };

  const close = (force = false) => {
    if (saving && !force) return;
    reset();
    onClose?.();
  };

  const addFiles = async (incomingFiles) => {
    setFormError('');
    const nextFiles = Array.from(incomingFiles || []);
    if (nextFiles.length === 0) return;

    try {
      const prepared = [];
      for (const file of nextFiles) {
        if (!ALLOWED_TYPES.has(file.type)) {
          throw new Error('Sadece PNG, JPG veya PDF dosyası yükleyebilirsiniz.');
        }
        if (file.size > MAX_FILE_SIZE) {
          throw new Error('Dosya boyutu 5MB sınırını aşamaz.');
        }

        const contentBase64 = await toBase64(file);
        prepared.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name: file.name,
          mimeType: file.type,
          size: file.size,
          contentBase64,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
        });
      }

      setAttachments((current) => [...current, ...prepared].slice(0, 3));
    } catch (error) {
      setFormError(error.message || 'Dosya yüklenemedi.');
    }
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    await addFiles(event.dataTransfer.files);
  };

  const removeAttachment = (id) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');

    if (!subject.trim()) {
      setFormError('Konu başlığı zorunludur.');
      return;
    }
    if (!description.trim()) {
      setFormError('Açıklama zorunludur.');
      return;
    }

    try {
      setSaving(true);
      await supportService.createTicket({
        subject: subject.trim(),
        description: description.trim(),
        user: generatedMeta.user,
        role: generatedMeta.role,
        page: generatedMeta.page,
        browser: generatedMeta.browser,
        sentAt: generatedMeta.sentAt,
        attachments: attachments.map((item) => ({
          name: item.name,
          mimeType: item.mimeType,
          size: item.size,
          contentBase64: item.contentBase64,
        })),
      });
      onSuccess?.();
      close(true);
    } catch (error) {
      onError?.(error);
      setFormError(error.message || 'Gönderilemedi, tekrar deneyin.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      title="Destek Talebi Oluştur"
      description="Sorununuzu geliştirici ekibe doğrudan iletin."
      headerIcon={<LifeBuoy size={17} />}
      onClose={close}
      modalClassName="support-form-fit-modal"
    >
      <form className="grid-form support-form" onSubmit={handleSubmit} noValidate>
          <div className="form-col-span-2 support-intro-chip" aria-hidden="true">
            <Info size={14} />
            <span>Ekran ve kullanıcı bilgileri çağrıya otomatik olarak eklenecektir.</span>
          </div>

          <label className="field-group form-col-span-2 support-field">
            <span>Konu Başlığı</span>
            <input
              type="text"
              maxLength={140}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Örn: Ürün ekranında filtre hatası"
            />
          </label>

          <label className="field-group form-col-span-2 support-field">
            <span>Açıklama</span>
            <textarea
              rows={7}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Sorunu adım adım yazın..."
            />
          </label>

          <div className="field-group form-col-span-2 support-field">
            <span>Ekran Görüntüsü / Dosya (Opsiyonel)</span>
            <div
              className="support-dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
            >
              <UploadCloud size={18} />
              <p>Dosyayı sürükleyip bırakın veya seçin</p>
              <small>PNG, JPG, PDF - Maks 5MB</small>
              <label className="outline-button support-file-btn">
                <Paperclip size={14} /> Dosya Seç
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,application/pdf"
                  onChange={(event) => addFiles(event.target.files)}
                  hidden
                />
              </label>
            </div>

            {attachments.length > 0 ? (
              <div className="support-attachment-list">
                {attachments.map((item) => (
                  <div key={item.id} className="support-attachment-item">
                    {item.previewUrl ? (
                      <img src={item.previewUrl} alt={item.name} className="support-attachment-preview" />
                    ) : (
                      <span className="support-attachment-file">PDF</span>
                    )}
                    <div className="support-attachment-meta">
                      <strong>{item.name}</strong>
                      <small>{Math.round(item.size / 1024)} KB</small>
                    </div>
                    <button type="button" className="icon-button" onClick={() => removeAttachment(item.id)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="field-group form-col-span-2 support-meta-box" aria-hidden="true">
            <span>Sistem Bilgileri</span>
            <div className="support-meta-grid">
              <div><strong>Kullanıcı:</strong> {generatedMeta.user}</div>
              <div><strong>Rol:</strong> {generatedMeta.role}</div>
              <div><strong>Sayfa:</strong> {generatedMeta.page}</div>
              <div><strong>Tarih:</strong> {new Date(generatedMeta.sentAt).toLocaleString('tr-TR')}</div>
            </div>
          </div>

          {formError ? (
            <div className="form-col-span-2 support-form-alert" role="alert" aria-live="polite">
              <span className="support-form-alert-icon" aria-hidden="true">i</span>
              <span className="support-form-alert-text">{formError}</span>
            </div>
          ) : null}

          <div className="form-col-span-2 support-actions">
            <button type="button" className="ghost-button support-cancel-btn" onClick={close} disabled={saving}>İptal</button>
            <button type="submit" className="primary-button support-call-btn" disabled={saving}>
              <HelpCircle size={15} /> {saving ? 'Çağrı Oluşturuluyor...' : 'Çağrı Oluştur'}
            </button>
          </div>
      </form>
    </FormModal>
  );
}


