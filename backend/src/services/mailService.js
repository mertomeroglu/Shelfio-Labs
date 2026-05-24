import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import { AppError } from '../utils/appError.js';
import {
  renderPasswordResetMail,
  renderSupportTicketMail,
  renderSystemErrorMail,
  renderTestMail,
} from './mailTemplates.js';

const SMTP_MISSING_MESSAGE = 'SMTP ayarları eksik';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRootDir = path.resolve(__dirname, '..', '..');
const MAIL_LOGO_CID = 'shelfio-logo';
const MAIL_LOGO_PATH = path.resolve(backendRootDir, 'public', 'mail', 'shelfio-logo.png');

const toList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

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
      userMessage: 'SMTP kimlik doğrulaması başarısız oldu.',
    };
  }

  if (['ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET', 'EPROTO'].includes(code)) {
    return {
      code: 'smtp_connection_error',
      userMessage: 'SMTP sunucusuna bağlanılamadı.',
    };
  }

  return {
    code: 'smtp_send_failed',
    userMessage: 'E-posta gönderimi şu anda tamamlanamadı.',
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

const buildInlineLogoAttachment = () => {
  if (!fs.existsSync(MAIL_LOGO_PATH)) {
    return null;
  }

  return {
    filename: 'shelfio-logo.png',
    path: MAIL_LOGO_PATH,
    cid: MAIL_LOGO_CID,
    contentType: 'image/png',
    contentDisposition: 'inline',
  };
};

const withInlineLogoAttachment = (message = {}) => {
  const html = String(message.html || '');
  if (!html.includes(`cid:${MAIL_LOGO_CID}`)) {
    return message;
  }

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.some((item) => item?.cid === MAIL_LOGO_CID)) {
    return message;
  }

  const logoAttachment = buildInlineLogoAttachment();
  if (!logoAttachment) {
    return {
      ...message,
      html: html.replace(
        /<img[^>]+src="cid:shelfio-logo"[^>]*>/,
        '<div style="font-size:24px;font-weight:800;color:#0f3d75;text-align:center;">Shelfio</div>'
      ),
      attachments,
    };
  }

  return {
    ...message,
    attachments: [...attachments, logoAttachment],
  };
};

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
  const preparedMessage = withInlineLogoAttachment(message);
  const missingFields = getMissingConfigFields();
  if (missingFields.length > 0) {
    throw new MailServiceError('smtp_config_missing', SMTP_MISSING_MESSAGE, {
      statusCode: 503,
      userMessage: SMTP_MISSING_MESSAGE,
      details: { missingFields },
    });
  }

  if (!preparedMessage.from || !Array.isArray(preparedMessage.to) || preparedMessage.to.length === 0) {
    throw new MailServiceError('mail_recipient_missing', 'Mail alıcı veya gönderici bilgisi eksik.', {
      statusCode: 500,
      userMessage: 'Mail alıcı veya gönderici bilgisi eksik.',
    });
  }

  const expectedRecipients = normalizeRecipientList(preparedMessage.to);
  const primaryOptions = buildTransportOptions({
    port: config.smtpPort,
    secure: config.smtpSecure,
  });

  try {
    const result = await sendWithTransport(preparedMessage, primaryOptions);
    return mapSendResult(result, expectedRecipients, false);
  } catch (error) {
    console.error(`[mail:${context}:primary-failed]`, redactErrorForLog(error, primaryOptions));

    if (shouldTryFromAddressFallback(error, preparedMessage)) {
      const fromFallbackMessage = buildAuthUserFromMessage(preparedMessage);
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
        const result = await sendWithTransport(preparedMessage, fallbackOptions);
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
      publicAppBaseUrl: config.publicAppBaseUrl,
      mailLogoCid: MAIL_LOGO_CID,
      mailLogoPath: MAIL_LOGO_PATH,
      mailLogoExists: fs.existsSync(MAIL_LOGO_PATH),
    };
  },

  previewTemplate(type = 'test', payload = {}) {
    const withPreviewAttachmentInfo = (content) => ({
      ...content,
      attachments: [{
        filename: 'shelfio-logo.png',
        cid: MAIL_LOGO_CID,
        path: MAIL_LOGO_PATH,
        inline: true,
        exists: fs.existsSync(MAIL_LOGO_PATH),
      }],
    });
    const normalizedType = String(type || 'test').trim().toLowerCase();
    if (normalizedType === 'support-ticket') {
      return withPreviewAttachmentInfo(renderSupportTicketMail({
        ticketId: payload.ticketId || 'SUPPORT-PREVIEW',
        subject: payload.subject || 'Örnek destek talebi',
        user: payload.user || 'Shelfio Kullanıcısı',
        requesterEmail: payload.requesterEmail || config.mailContactEmail,
        requesterPhone: payload.requesterPhone || '-',
        role: payload.role || 'admin',
        page: payload.page || '/destek',
        description: payload.description || 'Bu alan destek talebi mesajının önizlemesini gösterir.',
        attachmentSummary: payload.attachmentSummary || 'Ek yok',
        createdAt: payload.createdAt || new Date().toISOString(),
      }));
    }

    if (normalizedType === 'password-reset') {
      return withPreviewAttachmentInfo(renderPasswordResetMail({
        resetLink: payload.resetLink || `${config.publicAppBaseUrl}/musteri/sifre-sifirla?token=preview`,
      }));
    }

    if (normalizedType === 'system-error') {
      return withPreviewAttachmentInfo(renderSystemErrorMail({
        errorMessage: payload.errorMessage || 'Örnek hata mesajı',
        stack: payload.stack || 'Error: Preview stack',
        url: payload.url || `${config.publicAppBaseUrl}/preview`,
        user: payload.user || { name: 'Shelfio Admin', role: 'admin' },
        occurredAt: payload.occurredAt || new Date().toISOString(),
        browser: payload.browser || 'Preview Browser',
        duplicateKey: payload.duplicateKey || 'preview',
      }));
    }

    return withPreviewAttachmentInfo(renderTestMail({ requestedBy: payload.requestedBy || payload.user }));
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
    const attachmentSummary = summarizeAttachments(attachments, attachmentNote);
    const content = renderSupportTicketMail({
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
    });
    const message = {
      from: buildFromValue(),
      to: toList(config.supportMailTo),
      subject: 'Yeni Destek Talebi',
      replyTo: requesterEmail || config.supportMailReplyTo || undefined,
      attachments,
      ...content,
    };

    return sendMail(message, { context: 'support-ticket' });
  },

  async sendCustomerPasswordResetEmail({ to, resetLink }) {
    const safeResetLink = String(resetLink || '').trim();
    const content = renderPasswordResetMail({ resetLink: safeResetLink });
    const message = {
      from: buildFromValue(),
      to: [String(to || '').trim()].filter(Boolean),
      subject: 'Shelfio Şifre Sıfırlama',
      ...content,
    };

    return sendMail(message, { context: 'customer-password-reset' });
  },

  async sendTestEmail({ requestedBy } = {}) {
    const content = renderTestMail({ requestedBy });
    const message = {
      from: buildFromValue(),
      to: toList(config.supportMailTo),
      subject: 'SMTP Test Maili',
      replyTo: config.supportMailReplyTo || undefined,
      ...content,
    };

    return sendMail(message, { context: 'test-mail' });
  },

  async sendSystemErrorEmail(payload = {}) {
    const state = this.getConfigurationState();
    if (!state.configured) {
      console.warn('[system-error-mail] SMTP ayarı eksik, mail gönderilmedi.', state.missingFields);
      return { emailSent: false, skipped: true, reason: 'smtp_config_missing', missingFields: state.missingFields };
    }

    const content = renderSystemErrorMail(payload);
    const message = {
      from: buildFromValue(),
      to: toList(config.supportMailTo),
      subject: 'Sistem Hata Bildirimi',
      replyTo: config.supportMailReplyTo || undefined,
      ...content,
    };
    return sendMail(message, { context: 'system-error' });
  },
};
