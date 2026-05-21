import { access, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/config.js';
import { supportTicketRepo } from '../repositories/supportTicketRepository.js';
import { mailService } from './mailService.js';
import { AppError } from '../utils/appError.js';

const MAX_UPLOAD_ATTACHMENT_SIZE = 25 * 1024 * 1024;
const MAX_EMAIL_ATTACHMENT_TOTAL_SIZE = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Map([
  ['pdf', new Set(['application/pdf'])],
  ['png', new Set(['image/png'])],
  ['jpg', new Set(['image/jpeg'])],
  ['jpeg', new Set(['image/jpeg'])],
  ['webp', new Set(['image/webp'])],
  ['doc', new Set(['application/msword'])],
  ['docx', new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])],
  ['xls', new Set(['application/vnd.ms-excel'])],
  ['xlsx', new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])],
  ['txt', new Set(['text/plain'])],
]);

const sanitizeText = (value, { maxLength = 2000 } = {}) => String(value || '')
  .replace(/[<>]/g, '')
  .replace(/[\u0000-\u001F\u007F]/g, ' ')
  .trim()
  .slice(0, maxLength);

const SYSTEM_ERROR_WINDOW_MS = 5 * 60 * 1000;
const systemErrorMemory = new Map();

const buildSystemErrorKey = (payload = {}) => [
  sanitizeText(payload.message || payload.errorMessage, { maxLength: 180 }),
  sanitizeText(payload.stack, { maxLength: 300 }).split('\n')[0] || '',
  sanitizeText(payload.url, { maxLength: 220 }),
].join('|');

const shouldSkipDuplicateSystemError = (key) => {
  const now = Date.now();
  for (const [existingKey, timestamp] of systemErrorMemory.entries()) {
    if (now - timestamp > SYSTEM_ERROR_WINDOW_MS) {
      systemErrorMemory.delete(existingKey);
    }
  }
  const lastSeen = systemErrorMemory.get(key);
  if (lastSeen && now - lastSeen < SYSTEM_ERROR_WINDOW_MS) {
    return true;
  }
  systemErrorMemory.set(key, now);
  return false;
};

const sanitizeFileName = (value) => String(value || 'dosya')
  .replace(/[^a-zA-Z0-9._-]/g, '_')
  .replace(/_{2,}/g, '_')
  .slice(0, 100);

const buildUploadsDir = () => config.supportUploadDir;
const getAttachmentPath = (storedFileName) => {
  const uploadsDir = buildUploadsDir();
  const safeFileName = sanitizeFileName(storedFileName);
  const resolvedPath = path.resolve(uploadsDir, safeFileName);
  const resolvedUploadsDir = path.resolve(uploadsDir);
  if (!resolvedPath.startsWith(`${resolvedUploadsDir}${path.sep}`)) {
    throw new AppError(400, 'Ek dosya yolu gecersiz');
  }
  return resolvedPath;
};
const getFileExtension = (value) => path.extname(String(value || '')).replace('.', '').trim().toLowerCase();

const resolveAllowedMimeType = ({ fileName, mimeType }) => {
  const extension = getFileExtension(fileName);
  const supportedMimeTypes = ALLOWED_ATTACHMENT_TYPES.get(extension);
  if (!supportedMimeTypes) {
    return { ok: false, reason: 'unsupported_extension', mimeType: null };
  }

  const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
  if (!normalizedMimeType) {
    return { ok: true, reason: null, mimeType: [...supportedMimeTypes][0] };
  }

  if (supportedMimeTypes.has(normalizedMimeType)) {
    return { ok: true, reason: null, mimeType: normalizedMimeType };
  }

  return { ok: false, reason: 'unsupported_mime', mimeType: normalizedMimeType };
};

const mapAttachmentRecord = ({ ticketId, attachmentId, originalName, mimeType, size, storedFileName }) => ({
  id: attachmentId,
  originalName,
  mimeType,
  size,
  storedFileName,
  downloadUrl: `/api/support/tickets/${ticketId}/attachments/${attachmentId}`,
});

const parseAttachment = async (ticketId, rawAttachment = {}) => {
  const originalName = sanitizeFileName(rawAttachment.name || 'attachment');
  const mimeType = String(rawAttachment.mimeType || '').trim().toLowerCase();
  const size = Number(rawAttachment.size);
  const contentBase64 = String(rawAttachment.contentBase64 || '').trim();
  const allowedType = resolveAllowedMimeType({ fileName: originalName, mimeType });

  if (!allowedType.ok) {
    throw new AppError(400, 'Sadece PDF, PNG, JPG, WEBP, DOC, DOCX, XLS, XLSX ve TXT dosyalari desteklenir');
  }

  if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_ATTACHMENT_SIZE) {
    throw new AppError(400, 'Dosya boyutu 25MB sinirini asamaz');
  }

  if (!contentBase64) {
    throw new AppError(400, 'Ek dosya icerigi gecersiz');
  }

  const buffer = Buffer.from(contentBase64, 'base64');
  if (buffer.length !== size) {
    throw new AppError(400, 'Dosya boyutu dogrulanamadi');
  }

  const attachmentId = uuidv4();
  const storedFileName = `${ticketId}_${attachmentId}_${originalName}`;
  const uploadPath = getAttachmentPath(storedFileName);
  await mkdir(buildUploadsDir(), { recursive: true });
  await writeFile(uploadPath, buffer);

  return mapAttachmentRecord({
    ticketId,
    attachmentId,
    originalName,
    mimeType: allowedType.mimeType,
    size,
    storedFileName,
  });
};

const buildAttachmentNote = ({ includedNames, skippedReasons }) => {
  const notes = [];

  if (includedNames.length === 1) {
    notes.push('Bu talebe 1 dosya eklendi.');
  } else if (includedNames.length > 1) {
    notes.push(`Bu talebe ${includedNames.length} dosya eklendi.`);
  }

  if (includedNames.length > 0) {
    notes.push(`Ekler: ${includedNames.join(', ')}`);
  }

  if (skippedReasons.some((item) => item.reason === 'email_size_limit')) {
    notes.push('Ek dosya boyutu e-posta limitini astigi icin mail ekine dahil edilmedi.');
  }

  if (skippedReasons.some((item) => item.reason === 'missing_file')) {
    notes.push('Bazi ek dosyalar depolama yolunda bulunamadigi icin e-postaya eklenemedi.');
  }

  if (skippedReasons.some((item) => item.reason === 'unsupported_for_email')) {
    notes.push('Bazi ek dosyalar izin verilen e-posta eki tipleri disinda kaldigi icin eklenemedi.');
  }

  return notes.join(' ');
};

const prepareMailAttachments = async (attachments = []) => {
  const mailAttachments = [];
  const includedNames = [];
  const skippedReasons = [];
  let totalSize = 0;

  for (const attachment of attachments) {
    const originalName = sanitizeFileName(attachment?.originalName || 'attachment');
    const mimeType = String(attachment?.mimeType || '').trim().toLowerCase();
    const size = Number(attachment?.size || 0);
    const storedFileName = String(attachment?.storedFileName || '').trim();
    const allowedType = resolveAllowedMimeType({ fileName: originalName, mimeType });

    if (!allowedType.ok) {
      skippedReasons.push({ originalName, reason: 'unsupported_for_email' });
      continue;
    }

    if (!storedFileName || !Number.isFinite(size) || size <= 0) {
      skippedReasons.push({ originalName, reason: 'missing_file' });
      continue;
    }

    if (totalSize + size > MAX_EMAIL_ATTACHMENT_TOTAL_SIZE) {
      skippedReasons.push({ originalName, reason: 'email_size_limit' });
      continue;
    }

    const absoluteFilePath = getAttachmentPath(storedFileName);
    try {
      await access(absoluteFilePath);
    } catch {
      skippedReasons.push({ originalName, reason: 'missing_file', path: absoluteFilePath });
      continue;
    }

    mailAttachments.push({
      filename: originalName,
      path: absoluteFilePath,
      contentType: allowedType.mimeType,
    });
    includedNames.push(originalName);
    totalSize += size;
  }

  return {
    mailAttachments,
    attachmentError: skippedReasons.length > 0,
    attachmentNote: buildAttachmentNote({ includedNames, skippedReasons }),
    skippedReasons,
  };
};

export const supportService = {
  async reportSystemError(payload = {}, currentUser = null) {
    const duplicateKey = buildSystemErrorKey(payload);
    if (shouldSkipDuplicateSystemError(duplicateKey)) {
      return { emailSent: false, skipped: true, reason: 'duplicate_guard' };
    }

    try {
      const result = await mailService.sendSystemErrorEmail({
        errorMessage: sanitizeText(payload.message || payload.errorMessage || 'Bilinmeyen hata', { maxLength: 500 }),
        stack: sanitizeText(payload.stack, { maxLength: 8000 }),
        url: sanitizeText(payload.url, { maxLength: 500 }),
        browser: sanitizeText(payload.browser, { maxLength: 500 }),
        occurredAt: sanitizeText(payload.occurredAt, { maxLength: 80 }) || new Date().toISOString(),
        user: currentUser || payload.user || null,
        duplicateKey,
      });
      return {
        emailSent: Boolean(result?.emailSent),
        skipped: Boolean(result?.skipped),
        reason: result?.reason || null,
      };
    } catch (error) {
      console.error('[system-error-mail] gönderim başarısız', {
        code: error?.code || null,
        message: error?.message || null,
      });
      return { emailSent: false, skipped: true, reason: error?.code || 'smtp_send_failed' };
    }
  },

  async createTicket(payload, currentUser) {
    if (!currentUser?.id) {
      throw new AppError(401, 'Yetkilendirme gerekli');
    }

    const subject = sanitizeText(payload?.subject, { maxLength: 140 });
    const description = sanitizeText(payload?.description, { maxLength: 4000 });
    const role = sanitizeText(payload?.role || currentUser.role, { maxLength: 64 });
    const page = sanitizeText(payload?.page, { maxLength: 300 });
    const browser = sanitizeText(payload?.browser, { maxLength: 300 });
    const requesterEmail = sanitizeText(payload?.email || currentUser.email || '', { maxLength: 160 });
    const requesterPhone = sanitizeText(payload?.phone || currentUser.phone || '', { maxLength: 40 });

    if (!subject) {
      throw new AppError(400, 'Konu basligi zorunludur');
    }

    if (!description) {
      throw new AppError(400, 'Aciklama zorunludur');
    }

    const ticketId = uuidv4();
    const inputAttachments = Array.isArray(payload?.attachments) ? payload.attachments.slice(0, 3) : [];
    const attachments = [];

    for (const rawAttachment of inputAttachments) {
      const parsed = await parseAttachment(ticketId, rawAttachment);
      attachments.push(parsed);
    }

    const ticket = {
      id: ticketId,
      subject,
      description,
      userId: currentUser.id,
      user: sanitizeText(payload?.user || currentUser.name || currentUser.username, { maxLength: 120 }),
      role,
      page,
      browser,
      attachments,
      payload: {
        requesterEmail,
        requesterPhone,
        sentAt: sanitizeText(payload?.sentAt, { maxLength: 80 }) || new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'open',
    };

    await supportTicketRepo.create(ticket);

    let emailSent = false;
    let emailMessage = 'Talebiniz kaydedildi fakat e-posta gonderilemedi.';
    let emailErrorCode = null;
    let emailDeliveryDebug = null;
    let attachmentError = false;
    let attachmentNote = '';

    try {
      const preparedAttachments = await prepareMailAttachments(attachments);
      attachmentError = preparedAttachments.attachmentError;
      attachmentNote = preparedAttachments.attachmentNote;
      if (preparedAttachments.skippedReasons.length > 0) {
        console.warn('Support ticket attachment mail warnings:', preparedAttachments.skippedReasons);
      }

      const mailResult = await mailService.sendSupportTicketEmail({
        ticketId: ticket.id,
        subject: ticket.subject,
        user: ticket.user,
        requesterEmail,
        requesterPhone,
        role: ticket.role,
        page: ticket.page,
        description: ticket.description,
        attachments: preparedAttachments.mailAttachments,
        attachmentNote,
        createdAt: ticket.createdAt,
      });
      emailSent = Boolean(mailResult?.emailSent);
      emailDeliveryDebug = {
        messageId: mailResult?.messageId || null,
        accepted: Array.isArray(mailResult?.accepted) ? mailResult.accepted : [],
        rejected: Array.isArray(mailResult?.rejected) ? mailResult.rejected : [],
        response: mailResult?.response || null,
      };
      emailMessage = emailSent
        ? 'Talebiniz kaydedildi ve destek ekibine iletildi.'
        : 'Talebiniz kaydedildi fakat e-posta gonderilemedi.';
    } catch (error) {
      emailSent = false;
      attachmentError = attachmentError || Boolean(error?.attachmentError);
      emailErrorCode = error?.code || 'smtp_send_failed';
      emailMessage = 'Talebiniz kaydedildi fakat e-posta gonderilemedi.';
    }

    await supportTicketRepo.updateById(ticket.id, (existing) => ({
      ...existing,
      updatedAt: new Date().toISOString(),
      payload: {
        ...(existing?.payload || {}),
        requesterEmail,
        requesterPhone,
        emailDelivery: {
          attemptedAt: new Date().toISOString(),
          emailSent,
          attachmentError,
          attachmentNote,
          errorCode: emailErrorCode,
          debug: emailDeliveryDebug,
        },
      },
    }));

    return {
      id: ticket.id,
      subject: ticket.subject,
      createdAt: ticket.createdAt,
      emailSent,
      attachmentError,
      message: emailMessage,
      deliveryNote: emailSent ? 'SMTP maili kabul etti ancak teslimat gecikebilir. Spam/Junk klasorunu kontrol edin.' : '',
      attachmentNote,
      debug: emailDeliveryDebug,
    };
  },

  async getAttachment(ticketId, attachmentId, currentUser) {
    if (!currentUser?.id) {
      throw new AppError(401, 'Yetkilendirme gerekli');
    }

    const ticket = await supportTicketRepo.findByTicketId(String(ticketId || '').trim());
    if (!ticket) {
      throw new AppError(404, 'Talep bulunamadi');
    }

    const canAccess = ticket.userId === currentUser.id || currentUser.role === 'admin' || currentUser.isSuperUser;
    if (!canAccess) {
      throw new AppError(403, 'Bu dosyaya erisim yetkiniz yok');
    }

    const attachment = (ticket.attachments || []).find((item) => item.id === String(attachmentId || '').trim());
    if (!attachment) {
      throw new AppError(404, 'Ek dosya bulunamadi');
    }

    const filePath = getAttachmentPath(attachment.storedFileName);
    const content = await readFile(filePath);

    return {
      content,
      mimeType: attachment.mimeType,
      fileName: attachment.originalName,
    };
  },
};
