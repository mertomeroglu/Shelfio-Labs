import nodemailer from 'nodemailer';
import { config } from '../config/config.js';
import { AppError } from '../utils/appError.js';

const SMTP_MISSING_MESSAGE = 'SMTP ayarlari eksik';

const toList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const normalizeLineBreaks = (value) => String(value || '').replace(/\r\n/g, '\n');

const formatDisplayDate = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return String(value || '');
  }

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Istanbul',
  }).format(date);
};

const getMissingConfigFields = () => {
  const missing = [];

  if (!config.smtpHost) missing.push('SMTP_HOST');
  if (!config.smtpPort) missing.push('SMTP_PORT');
  if (!config.smtpUser) missing.push('SMTP_USER');
  if (!config.smtpPass) missing.push('SMTP_PASS');
  if (!config.supportMailTo) missing.push('SUPPORT_TO_EMAIL');

  return missing;
};

const shouldTryStartTlsFallback = (error) => {
  const code = String(error?.code || '').toUpperCase();
  return ['ESOCKET', 'ECONNECTION', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPROTO'].includes(code);
};

const shouldTryFromAddressFallback = (error, message = {}) => {
  const configuredFrom = String(config.supportMailFromEmail || '').trim().toLowerCase();
  const authUser = String(config.smtpUser || '').trim().toLowerCase();
  if (!configuredFrom || !authUser || configuredFrom === authUser) return false;

  const code = String(error?.code || '').toUpperCase();
  const responseCode = Number(error?.responseCode || 0);
  const text = `${error?.response || ''} ${error?.message || ''}`.toLowerCase();
  const fromText = String(message?.from || '').toLowerCase();
  const hasConfiguredFrom = !fromText || fromText.includes(configuredFrom);
  if (!hasConfiguredFrom) return false;

  return code === 'EAUTH'
    || [535, 550, 553, 554].includes(responseCode)
    || text.includes('sender')
    || text.includes('from')
    || text.includes('envelope')
    || text.includes('not owned')
    || text.includes('not authorized')
    || text.includes('not permitted')
    || text.includes('rejected');
};

const classifyTransportError = (error) => {
  const code = String(error?.code || '').toUpperCase();
  const responseCode = Number(error?.responseCode || 0);

  if (code === 'EAUTH' || responseCode === 535) {
    return {
      code: 'smtp_auth_error',
      userMessage: 'SMTP kimlik dogrulamasi basarisiz oldu.',
    };
  }

  if (['ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET', 'EPROTO'].includes(code)) {
    return {
      code: 'smtp_connection_error',
      userMessage: 'SMTP sunucusuna baglanilamadi.',
    };
  }

  return {
    code: 'smtp_send_failed',
    userMessage: 'E-posta gonderimi su anda tamamlanamadi.',
  };
};

const redactErrorForLog = (error, transportOptions) => ({
  code: error?.code || null,
  responseCode: error?.responseCode || null,
  command: error?.command || null,
  name: error?.name || 'Error',
  response: error?.response || null,
  message: error?.message || null,
  host: transportOptions?.host || null,
  port: transportOptions?.port || null,
  secure: Boolean(transportOptions?.secure),
});

const normalizeRecipientList = (value) => (Array.isArray(value) ? value : [value])
  .map((item) => String(item || '').trim().toLowerCase())
  .filter(Boolean);

const buildMailDebugPayload = (result) => ({
  messageId: result?.messageId || null,
  accepted: Array.isArray(result?.accepted) ? result.accepted : [],
  rejected: Array.isArray(result?.rejected) ? result.rejected : [],
  response: result?.response || null,
  envelope: {
    from: result?.envelope?.from || null,
    to: Array.isArray(result?.envelope?.to) ? result.envelope.to : (result?.envelope?.to ? [result.envelope.to] : []),
  },
});

const evaluateMailDelivery = (result, expectedRecipients) => {
  const debug = buildMailDebugPayload(result);
  const accepted = new Set(normalizeRecipientList(debug.accepted));
  const rejected = new Set(normalizeRecipientList(debug.rejected));
  const expected = normalizeRecipientList(expectedRecipients);
  const missingAcceptedRecipients = expected.filter((recipient) => !accepted.has(recipient));
  const rejectedRecipients = expected.filter((recipient) => rejected.has(recipient));
  const emailSent = Boolean(debug.messageId) && missingAcceptedRecipients.length === 0 && rejectedRecipients.length === 0;

  return {
    emailSent,
    debug,
    missingAcceptedRecipients,
    rejectedRecipients,
  };
};

const buildTransportOptions = ({ port, secure }) => ({
  host: config.smtpHost,
  port,
  secure,
  requireTLS: port === 587,
  auth: {
    user: config.smtpUser,
    pass: config.smtpPass,
  },
  connectionTimeout: config.smtpConnectionTimeoutMs,
  greetingTimeout: config.smtpGreetingTimeoutMs,
  socketTimeout: config.smtpSocketTimeoutMs,
  tls: {
    minVersion: 'TLSv1.2',
  },
});

const buildFromValue = (fromEmailOverride = '') => {
  const fromEmail = fromEmailOverride || config.supportMailFromEmail || config.smtpUser;
  const fromName = config.supportMailFromName || 'Shelfio';
  return fromEmail ? `${fromName} <${fromEmail}>` : '';
};

const buildAuthUserFromMessage = (message = {}) => ({
  ...message,
  from: buildFromValue(config.smtpUser),
});

const summarizeAttachments = (attachments = [], attachmentNote = '') => {
  if (attachmentNote) {
    return attachmentNote;
  }

  const names = attachments
    .map((item) => String(item?.filename || '').trim())
    .filter(Boolean);

  if (names.length === 1) {
    return `Bu talebe 1 dosya eklendi. Ekler: ${names[0]}`;
  }

  if (names.length > 1) {
    return `Bu talebe ${names.length} dosya eklendi. Ekler: ${names.join(', ')}`;
  }

  return 'Ek yok';
};

const createMessage = ({
  title,
  ticketId,
  subject,
  user,
  requesterEmail,
  requesterPhone,
  role,
  page,
  description,
  attachments = [],
  attachmentNote = '',
  createdAt,
  replyTo,
}) => {
  const createdAtLabel = formatDisplayDate(createdAt);
  const safeDescription = escapeHtml(normalizeLineBreaks(description)).replace(/\n/g, '<br/>');
  const attachmentSummary = summarizeAttachments(attachments, attachmentNote);
  const safeAttachmentSummary = escapeHtml(attachmentSummary);

  return {
    from: buildFromValue(),
    to: toList(config.supportMailTo),
    subject: title,
    replyTo: replyTo || config.supportMailReplyTo || undefined,
    attachments,
    text: [
      title,
      '',
      `Talep eden kisi: ${user || '-'}`,
      `E-posta: ${requesterEmail || '-'}`,
      `Telefon: ${requesterPhone || '-'}`,
      `Konu: ${subject || '-'}`,
      `Rol: ${role || '-'}`,
      `Sayfa: ${page || '-'}`,
      `Olusturulma tarihi: ${createdAtLabel || '-'}`,
      `Talep ID: ${ticketId || '-'}`,
      '',
      'Mesaj:',
      normalizeLineBreaks(description) || '-',
      '',
      `Ek bilgisi: ${attachmentSummary}`,
    ].join('\n'),
    html: [
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0f172a;">',
      `<h2 style="margin:0 0 16px;">${escapeHtml(title)}</h2>`,
      '<table style="border-collapse:collapse;width:100%;max-width:720px;">',
      `<tr><td style="padding:6px 0;font-weight:700;width:180px;">Talep eden kisi</td><td style="padding:6px 0;">${escapeHtml(user || '-')}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">E-posta</td><td style="padding:6px 0;">${escapeHtml(requesterEmail || '-')}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">Telefon</td><td style="padding:6px 0;">${escapeHtml(requesterPhone || '-')}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">Konu</td><td style="padding:6px 0;">${escapeHtml(subject || '-')}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">Rol</td><td style="padding:6px 0;">${escapeHtml(role || '-')}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">Sayfa</td><td style="padding:6px 0;">${escapeHtml(page || '-')}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">Olusturulma tarihi</td><td style="padding:6px 0;">${escapeHtml(createdAtLabel || '-')}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">Talep ID</td><td style="padding:6px 0;">${escapeHtml(ticketId || '-')}</td></tr>`,
      '</table>',
      '<div style="margin-top:18px;">',
      '<div style="font-weight:700;margin-bottom:8px;">Mesaj</div>',
      `<div style="padding:12px;border:1px solid #dbe5f0;border-radius:10px;background:#f8fafc;">${safeDescription || '-'}</div>`,
      '</div>',
      `<div style="margin-top:18px;"><strong>Ek bilgisi:</strong> ${safeAttachmentSummary}</div>`,
      '</div>',
    ].join(''),
  };
};

const createSystemErrorMessage = ({
  errorMessage,
  stack,
  url,
  user,
  occurredAt,
  browser,
  duplicateKey,
}) => {
  const title = 'Shelfio Sistem Hatası';
  const userLabel = [
    user?.name || user?.username || '',
    user?.id ? `ID: ${user.id}` : '',
    user?.role ? `Rol: ${user.role}` : '',
  ].filter(Boolean).join(' | ') || '-';
  const lines = [
    title,
    '',
    `Hata mesajı: ${errorMessage || '-'}`,
    `URL: ${url || '-'}`,
    `Kullanıcı: ${userLabel}`,
    `Tarih/saat: ${formatDisplayDate(occurredAt)}`,
    `Browser: ${browser || '-'}`,
    `Tekil anahtar: ${duplicateKey || '-'}`,
    '',
    'Stack trace:',
    normalizeLineBreaks(stack) || '-',
    '',
    'Bu e-posta Shelfio hata izleme sistemi tarafından otomatik gönderildi.',
  ];

  const safeStack = escapeHtml(normalizeLineBreaks(stack)).replace(/\n/g, '<br/>');
  return {
    from: buildFromValue(),
    to: toList(config.supportMailTo),
    subject: title,
    replyTo: config.supportMailReplyTo || undefined,
    text: lines.join('\n'),
    html: [
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0f172a;">',
      `<h2 style="margin:0 0 16px;">${escapeHtml(title)}</h2>`,
      '<table style="border-collapse:collapse;width:100%;max-width:760px;">',
      `<tr><td style="padding:6px 0;font-weight:700;width:160px;">Hata mesajı</td><td style="padding:6px 0;">${escapeHtml(errorMessage || '-')}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">URL</td><td style="padding:6px 0;">${escapeHtml(url || '-')}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">Kullanıcı</td><td style="padding:6px 0;">${escapeHtml(userLabel)}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">Tarih/saat</td><td style="padding:6px 0;">${escapeHtml(formatDisplayDate(occurredAt))}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">Browser</td><td style="padding:6px 0;">${escapeHtml(browser || '-')}</td></tr>`,
      `<tr><td style="padding:6px 0;font-weight:700;">Tekil anahtar</td><td style="padding:6px 0;">${escapeHtml(duplicateKey || '-')}</td></tr>`,
      '</table>',
      '<div style="margin-top:18px;font-weight:700;">Stack trace</div>',
      `<div style="margin-top:8px;padding:12px;border:1px solid #dbe5f0;border-radius:10px;background:#f8fafc;font-family:Consolas,monospace;font-size:12px;">${safeStack || '-'}</div>`,
      '<p style="margin-top:18px;color:#64748b;">Bu e-posta Shelfio hata izleme sistemi tarafından otomatik gönderildi.</p>',
      '</div>',
    ].join(''),
  };
};

export class MailServiceError extends AppError {
  constructor(code, message, options = {}) {
    super(options.statusCode || 503, message);
    this.name = 'MailServiceError';
    this.code = code;
    this.userMessage = options.userMessage || message;
    this.details = options.details || null;
  }
}

const sendWithTransport = async (message, transportOptions) => {
  const transporter = nodemailer.createTransport(transportOptions);
  return transporter.sendMail(message);
};

const mapSendResult = (result, expectedRecipients, fallbackUsed) => {
  const delivery = evaluateMailDelivery(result, expectedRecipients);
  console.info('SMTP mail result:', delivery.debug);
  return {
    emailSent: delivery.emailSent,
    fallbackUsed,
    messageId: delivery.debug.messageId,
    accepted: delivery.debug.accepted,
    rejected: delivery.debug.rejected,
    response: delivery.debug.response,
    envelope: delivery.debug.envelope,
    missingAcceptedRecipients: delivery.missingAcceptedRecipients,
    rejectedRecipients: delivery.rejectedRecipients,
  };
};

const sendMail = async (message, { context = 'mail' } = {}) => {
  const missingFields = getMissingConfigFields();
  if (missingFields.length > 0) {
    throw new MailServiceError('smtp_config_missing', SMTP_MISSING_MESSAGE, {
      statusCode: 503,
      userMessage: SMTP_MISSING_MESSAGE,
      details: { missingFields },
    });
  }

  if (!message.from || !Array.isArray(message.to) || message.to.length === 0) {
    throw new MailServiceError('mail_recipient_missing', 'Mail alici veya gonderici bilgisi eksik.', {
      statusCode: 500,
      userMessage: 'Mail alici veya gonderici bilgisi eksik.',
    });
  }

  const expectedRecipients = normalizeRecipientList(message.to);
  const primaryOptions = buildTransportOptions({
    port: config.smtpPort,
    secure: config.smtpSecure,
  });

  try {
    const result = await sendWithTransport(message, primaryOptions);
    return mapSendResult(result, expectedRecipients, false);
  } catch (error) {
    console.error(`[mail:${context}:primary-failed]`, redactErrorForLog(error, primaryOptions));

    if (shouldTryFromAddressFallback(error, message)) {
      const fromFallbackMessage = buildAuthUserFromMessage(message);
      try {
        const result = await sendWithTransport(fromFallbackMessage, primaryOptions);
        return mapSendResult(result, expectedRecipients, true);
      } catch (fromFallbackError) {
        console.error(`[mail:${context}:from-fallback-failed]`, redactErrorForLog(fromFallbackError, primaryOptions));
        const classified = classifyTransportError(fromFallbackError);
        throw new MailServiceError(classified.code, classified.userMessage, {
          statusCode: 503,
          userMessage: classified.userMessage,
          details: redactErrorForLog(fromFallbackError, primaryOptions),
        });
      }
    }

    if (config.smtpPort === 465 && shouldTryStartTlsFallback(error)) {
      const fallbackOptions = buildTransportOptions({
        port: 587,
        secure: false,
      });

      try {
        const result = await sendWithTransport(message, fallbackOptions);
        return mapSendResult(result, expectedRecipients, true);
      } catch (fallbackError) {
        console.error(`[mail:${context}:fallback-failed]`, redactErrorForLog(fallbackError, fallbackOptions));
        const classified = classifyTransportError(fallbackError);
        throw new MailServiceError(classified.code, classified.userMessage, {
          statusCode: 503,
          userMessage: classified.userMessage,
          details: redactErrorForLog(fallbackError, fallbackOptions),
        });
      }
    }

    const classified = classifyTransportError(error);
    throw new MailServiceError(classified.code, classified.userMessage, {
      statusCode: 503,
      userMessage: classified.userMessage,
      details: redactErrorForLog(error, primaryOptions),
    });
  }
};

export const mailService = {
  getConfigurationState() {
    const missingFields = getMissingConfigFields();
    return {
      configured: missingFields.length === 0,
      missingFields,
      smtpHost: config.smtpHost || '',
      smtpPort: config.smtpPort || 0,
      smtpSecure: config.smtpSecure,
      supportMailTo: toList(config.supportMailTo),
      supportMailFrom: buildFromValue(),
    };
  },

  async sendSupportTicketEmail({
    ticketId,
    subject,
    user,
    requesterEmail,
    requesterPhone,
    role,
    page,
    description,
    attachments = [],
    attachmentNote = '',
    createdAt,
  }) {
    const message = createMessage({
      title: 'Shelfio Destek Talebi',
      ticketId,
      subject,
      user,
      requesterEmail,
      requesterPhone,
      role,
      page,
      description,
      attachments,
      attachmentNote,
      createdAt,
      replyTo: requesterEmail || undefined,
    });

    return sendMail(message, { context: 'support-ticket' });
  },

  async sendTestEmail({ requestedBy } = {}) {
    const message = createMessage({
      title: 'Shelfio SMTP Test',
      ticketId: 'TEST-MAIL',
      subject: 'Shelfio SMTP Test',
      user: requestedBy?.name || requestedBy?.username || 'Shelfio Backend',
      requesterEmail: requestedBy?.email || config.supportMailFromEmail || config.smtpUser,
      requesterPhone: requestedBy?.phone || '',
      role: requestedBy?.role || 'admin',
      page: '/api/support/test-mail',
      description: 'Bu mail Shelfio backend SMTP testi icin gonderildi.',
      attachments: [],
      attachmentNote: '',
      createdAt: new Date().toISOString(),
      replyTo: undefined,
    });

    return sendMail(message, { context: 'test-mail' });
  },

  async sendSystemErrorEmail(payload = {}) {
    const state = this.getConfigurationState();
    if (!state.configured) {
      console.warn('[system-error-mail] SMTP ayarı eksik, mail gönderilmedi.', state.missingFields);
      return { emailSent: false, skipped: true, reason: 'smtp_config_missing', missingFields: state.missingFields };
    }

    const message = createSystemErrorMessage(payload);
    return sendMail(message, { context: 'system-error' });
  },
};
