import { supportService } from '../services/supportService.js';

import { mailService } from '../services/mailService.js';

export const supportController = {
  async reportSystemError(req, res, next) {
    try {
      const data = await supportService.reportSystemError(req.body || {}, req.user || req.body?.user || null);
      res.status(202).json({
        success: true,
        emailSent: Boolean(data?.emailSent),
        skipped: Boolean(data?.skipped),
        message: data?.emailSent ? 'Hata bildirimi destek ekibine iletildi.' : 'Hata bildirimi kaydedildi.',
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async createTicket(req, res, next) {
    try {
      const data = await supportService.createTicket(req.body, req.user);
      res.status(201).json({
        success: true,
        emailSent: Boolean(data?.emailSent),
        attachmentError: Boolean(data?.attachmentError),
        message: data?.message || 'Talep kaydedildi.',
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async getAttachment(req, res, next) {
    try {
      const data = await supportService.getAttachment(req.params.ticketId, req.params.attachmentId, req.user);
      res.setHeader('Content-Type', data.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(data.fileName || 'attachment')}"`);
      res.send(data.content);
    } catch (error) {
      next(error);
    }
  },

  async testMail(req, res, next) {
    try {
      const result = await mailService.sendTestEmail({ requestedBy: req.user });
      res.json({
        success: true,
        emailSent: Boolean(result?.emailSent),
        message: result?.emailSent
          ? 'SMTP maili kabul etti ancak teslimat gecikebilir. Spam/Junk klasörünü kontrol edin.'
          : 'Test e-postası gönderilemedi.',
        data: {
          messageId: result?.messageId || null,
          accepted: Array.isArray(result?.accepted) ? result.accepted : [],
          rejected: Array.isArray(result?.rejected) ? result.rejected : [],
          response: result?.response || null,
        },
      });
    } catch (error) {
      res.status(error?.statusCode || 503).json({
        success: false,
        emailSent: false,
        message: error?.userMessage || error?.message || 'Test e-postası gönderilemedi.',
        data: {
          messageId: null,
          accepted: [],
          rejected: [],
          response: error?.details?.response || null,
          code: error?.details?.code || error?.code || null,
          command: error?.details?.command || null,
          responseCode: error?.details?.responseCode || null,
        },
      });
    }
  },
};
