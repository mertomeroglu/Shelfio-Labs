import { config } from '../config/config.js';

const BRAND_NAME = 'Shelfio Labs';
const BRAND_COLOR = '#0f3d75';
const BRAND_ACCENT = '#2563eb';

export const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const normalizeLineBreaks = (value) => String(value || '').replace(/\r\n/g, '\n');

export const formatDisplayDate = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || '');

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Istanbul',
  }).format(date);
};

const plainLine = (label, value) => `${label}: ${value || '-'}`;

const hasMeaningfulMailValue = (value) => {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim();
  if (!normalized) return false;
  return !['-', 'null', 'undefined'].includes(normalized.toLowerCase());
};

const requiredMailField = (label, value, fallback = '-') => ({
  label,
  value: hasMeaningfulMailValue(value) ? value : fallback,
});

const optionalMailField = (label, value) => (
  hasMeaningfulMailValue(value) ? { label, value } : null
);

const buildText = ({
  title,
  intro,
  fields = [],
  body,
  action,
  note,
}) => [
  BRAND_NAME,
  title,
  '',
  intro,
  '',
  ...fields.filter(Boolean).map((field) => plainLine(field.label, field.value)),
  fields.filter(Boolean).length ? '' : null,
  body,
  action?.url ? `${action.label}: ${action.url}` : null,
  note,
  '',
  `${BRAND_NAME} tarafından otomatik gönderilmiştir.`,
  `İletişim: ${config.mailContactEmail || 'info@shelfiolabs.com'}`,
].filter(Boolean).join('\n');

const renderButton = (action) => {
  if (!action?.url) return '';
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 8px;">
      <tr>
        <td bgcolor="${BRAND_ACCENT}" style="border-radius:10px;">
          <a href="${escapeHtml(action.url)}" style="display:inline-block;padding:13px 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
            ${escapeHtml(action.label || 'Görüntüle')}
          </a>
        </td>
      </tr>
    </table>`;
};

const renderFields = (fields = []) => {
  const safeFields = fields.filter(Boolean);
  if (!safeFields.length) return '';
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;margin:20px 0;border:1px solid #dbe5f0;border-radius:12px;overflow:hidden;">
      ${safeFields.map((field, index) => `
        <tr>
          <td style="padding:12px 14px;background:${index % 2 === 0 ? '#f8fafc' : '#ffffff'};border-bottom:1px solid #e6eef7;width:34%;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#52637a;font-weight:700;">
            ${escapeHtml(field.label)}
          </td>
          <td style="padding:12px 14px;background:${index % 2 === 0 ? '#f8fafc' : '#ffffff'};border-bottom:1px solid #e6eef7;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;">
            ${escapeHtml(field.value || '-')}
          </td>
        </tr>`).join('')}
    </table>`;
};

const renderMessageBox = (content, { monospace = false } = {}) => {
  if (!content) return '';
  return `
    <div style="margin:20px 0;padding:16px 18px;border:1px solid #dbe5f0;border-radius:12px;background:#f8fafc;font-family:${monospace ? 'Consolas,Monaco,monospace' : 'Arial,Helvetica,sans-serif'};font-size:${monospace ? '12px' : '14px'};line-height:1.65;color:#0f172a;word-break:break-word;">
      ${escapeHtml(normalizeLineBreaks(content)).replace(/\n/g, '<br/>')}
    </div>`;
};

export const renderMailLayout = ({
  title,
  eyebrow = 'Shelfio Bilgilendirme',
  intro = '',
  fields = [],
  bodyHtml = '',
  bodyText = '',
  action = null,
  note = '',
}) => {
  const contactEmail = config.mailContactEmail || 'info@shelfiolabs.com';
  const html = `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#edf3f8;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#edf3f8;margin:0;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:680px;border-collapse:collapse;">
            <tr>
              <td style="padding:0 0 16px;text-align:center;">
                <img src="cid:shelfio-logo" alt="Shelfio" width="132" style="display:inline-block;width:132px;max-width:132px;height:auto;border:0;outline:none;text-decoration:none;">
                <div style="font-size:1px;line-height:1px;color:#edf3f8;max-height:0;overflow:hidden;">${BRAND_NAME}</div>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #dbe5f0;border-radius:18px;overflow:hidden;box-shadow:0 18px 42px rgba(15,61,117,0.10);">
                <div style="background:${BRAND_COLOR};padding:22px 26px;">
                  <div style="font-size:12px;line-height:1.4;color:#bfdbfe;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(eyebrow)}</div>
                  <h1 style="margin:7px 0 0;font-size:24px;line-height:1.28;color:#ffffff;font-weight:800;">${escapeHtml(title)}</h1>
                </div>
                <div style="padding:26px;">
                  ${intro ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#334155;">${escapeHtml(intro)}</p>` : ''}
                  ${renderFields(fields)}
                  ${bodyHtml}
                  ${renderButton(action)}
                  ${action?.url ? `<p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#64748b;">Buton çalışmazsa bu bağlantıyı tarayıcınıza yapıştırın:<br><a href="${escapeHtml(action.url)}" style="color:${BRAND_ACCENT};word-break:break-all;">${escapeHtml(action.url)}</a></p>` : ''}
                  ${note ? `<div style="margin-top:20px;padding:14px 16px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a;font-size:13px;line-height:1.6;">${escapeHtml(note)}</div>` : ''}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 12px 0;text-align:center;font-size:12px;line-height:1.6;color:#64748b;">
                Bu e-posta ${BRAND_NAME} tarafından otomatik gönderilmiştir.<br>
                İletişim: <a href="mailto:${escapeHtml(contactEmail)}" style="color:${BRAND_ACCENT};text-decoration:none;">${escapeHtml(contactEmail)}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    html,
    text: buildText({ title, intro, fields, body: bodyText, action, note }),
  };
};

export const renderSupportTicketMail = ({
  ticketId,
  subject,
  user,
  requesterEmail,
  requesterPhone,
  role,
  page,
  description,
  attachmentSummary,
  createdAt,
}) => {
  const fields = [
    requiredMailField('Talep eden kişi', user),
    optionalMailField('E-posta', requesterEmail),
    optionalMailField('Telefon', requesterPhone),
    requiredMailField('Talep konusu', subject),
    optionalMailField('Rol', role),
    optionalMailField('Sayfa', page),
    requiredMailField('Tarih', formatDisplayDate(createdAt)),
    requiredMailField('Talep numarası', ticketId),
    requiredMailField('Ek dosya bilgisi', attachmentSummary, 'Ek yok'),
  ];

  return renderMailLayout({
    title: 'Yeni Destek Talebi',
    eyebrow: 'Destek Merkezi',
    intro: 'Shelfio destek ekibine yeni bir talep iletildi.',
    fields,
    bodyHtml: `
      <div style="margin-top:8px;font-weight:700;color:#0f172a;">Mesaj içeriği</div>
      ${renderMessageBox(description || '-')}`,
    bodyText: `Mesaj:\n${normalizeLineBreaks(description) || '-'}`,
  });
};

export const renderPasswordResetMail = ({ resetLink }) => renderMailLayout({
  title: 'Şifre Sıfırlama Talebi',
  eyebrow: 'Hesap Güvenliği',
  intro: 'Shelfio hesabınız için şifre sıfırlama isteği alındı.',
  bodyHtml: '<p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#334155;">Şifrenizi yenilemek için aşağıdaki butonu kullanabilirsiniz.</p>',
  bodyText: 'Şifrenizi yenilemek için aşağıdaki bağlantıyı kullanabilirsiniz.',
  action: {
    label: 'Şifremi Sıfırla',
    url: resetLink,
  },
  note: 'Bu bağlantı 30 dakika geçerlidir. Bu isteği siz yapmadıysanız bu e-postayı dikkate almayın.',
});

export const renderTestMail = ({ requestedBy } = {}) => renderMailLayout({
  title: 'SMTP Test Maili',
  eyebrow: 'Sistem Kontrolü',
  intro: 'Shelfio mail sistemi bu test e-postasını başarıyla oluşturdu.',
  fields: [
    { label: 'Testi isteyen', value: requestedBy?.name || requestedBy?.username || 'Shelfio Backend' },
    { label: 'Rol', value: requestedBy?.role || 'admin' },
    { label: 'Tarih', value: formatDisplayDate(new Date()) },
  ],
  bodyHtml: '<p style="margin:0;font-size:14px;line-height:1.7;color:#334155;">Bu mesaj SMTP ayarlarının aktif olduğunu doğrulamak için gönderildi.</p>',
  bodyText: 'Bu mesaj SMTP ayarlarının aktif olduğunu doğrulamak için gönderildi.',
});

export const renderSystemErrorMail = ({
  errorMessage,
  stack,
  url,
  user,
  occurredAt,
  browser,
  duplicateKey,
}) => {
  const userLabel = [
    user?.name || user?.username || '',
    user?.id ? `ID: ${user.id}` : '',
    user?.role ? `Rol: ${user.role}` : '',
  ].filter(Boolean).join(' | ') || '-';

  return renderMailLayout({
    title: 'Sistem Hata Bildirimi',
    eyebrow: 'Teknik İzleme',
    intro: 'Shelfio hata izleme sistemi yeni bir hata kaydı oluşturdu.',
    fields: [
      { label: 'Hata mesajı', value: errorMessage || '-' },
      { label: 'URL', value: url || '-' },
      { label: 'Kullanıcı', value: userLabel },
      { label: 'Tarih', value: formatDisplayDate(occurredAt) },
      { label: 'Tarayıcı', value: browser || '-' },
      { label: 'Tekil anahtar', value: duplicateKey || '-' },
    ],
    bodyHtml: `
      <div style="margin-top:8px;font-weight:700;color:#0f172a;">Stack trace</div>
      ${renderMessageBox(stack || '-', { monospace: true })}`,
    bodyText: `Stack trace:\n${normalizeLineBreaks(stack) || '-'}`,
  });
};
