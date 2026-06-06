import { settingsService } from '../services/settingsService.js';
import { mailService } from '../services/mailService.js';

const PUBLIC_LOG_WINDOW_MS = 60 * 1000;
const PUBLIC_LOG_MAX_PER_WINDOW = 30;
const publicLogLimiter = new Map();

const getClientIp = (req) => (
  req.ip
  || (Array.isArray(req.headers['x-forwarded-for'])
    ? req.headers['x-forwarded-for'][0]
    : String(req.headers['x-forwarded-for'] || '').split(',')[0])
  || ''
);

const checkPublicLogRateLimit = (req) => {
  const ip = String(getClientIp(req) || 'unknown').trim() || 'unknown';
  const now = Date.now();
  const bucket = publicLogLimiter.get(ip) || { count: 0, resetAt: now + PUBLIC_LOG_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + PUBLIC_LOG_WINDOW_MS;
  }
  bucket.count += 1;
  publicLogLimiter.set(ip, bucket);
  return bucket.count <= PUBLIC_LOG_MAX_PER_WINDOW;
};

export const settingsController = {
  async get(req, res, next) {
    try {
      const data = await settingsService.get(req.user);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const data = await settingsService.update(req.body, req.user);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async logisticsTariffs(req, res, next) {
    try {
      const data = await settingsService.getLogisticsTariffs();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateLogisticsTariffs(req, res, next) {
    try {
      const data = await settingsService.updateLogisticsTariffs(req.body || {}, req.user);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async logisticsQuote(req, res, next) {
    try {
      const data = await settingsService.calculateLogisticsQuote(req.body || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async loginActivities(req, res, next) {
    try {
      const result = await settingsService.getLoginActivities(req.user, req.query || {});
      res.json({
        success: true,
        data: result.items,
        meta: {
          total: result.total,
          totalCount: result.total,
          count: result.items.length,
          limit: result.limit,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async auditLogs(req, res, next) {
    try {
      const result = await settingsService.getAuditLogs(req.user, req.query || {});
      res.json({
        success: true,
        data: result.items,
        meta: {
          total: result.total,
          totalCount: result.total,
          count: result.items.length,
          limit: result.limit,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async exportAuditLogs(req, res, next) {
    try {
      const format = String(req.query.format || 'csv').toLowerCase();
      if (format !== 'csv') {
        const result = await settingsService.getAuditLogs(req.user, { ...req.query, limit: 500 });
        res.json({
          success: true,
          data: result.items,
          meta: {
            total: result.total,
            totalCount: result.total,
            count: result.items.length,
            limit: result.limit,
          },
        });
        return;
      }

      const csv = await settingsService.exportAuditLogsCsv(req.user);
      const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  },

  async ingestDeveloperLog(req, res, next) {
    try {
      const meta = {
        ip: req.ip || req.headers['x-forwarded-for'] || '',
        browserInfo: req.headers['user-agent'] || '',
        requestUrl: req.originalUrl,
        source: 'frontend',
        requestId: req.requestId,
      };

      const data = await settingsService.recordDeveloperLog(req.body || {}, req.user, meta);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async ingestPublicDeveloperLog(req, res, next) {
    try {
      if (!checkPublicLogRateLimit(req)) {
        res.status(202).json({ success: true, dropped: true });
        return;
      }

      const meta = {
        ip: getClientIp(req),
        browserInfo: req.headers['user-agent'] || '',
        requestUrl: req.originalUrl,
        source: 'frontend',
        requestId: req.requestId,
      };
      const data = await settingsService.recordDeveloperLog(req.body || {}, null, meta);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async developerLogs(req, res, next) {
    try {
      const result = await settingsService.getDeveloperLogs(req.user, req.query || {});
      res.json({
        success: true,
        data: result.items,
        meta: {
          total: result.total,
          totalCount: result.total,
          count: result.items.length,
          limit: result.limit,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async clearLogs(req, res, next) {
    try {
      const result = await settingsService.clearLogs(req.params.type, req.user);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async exportDeveloperLogs(req, res, next) {
    try {
      const format = String(req.query.format || 'csv').toLowerCase();
      if (format !== 'csv') {
        const result = await settingsService.getDeveloperLogs(req.user, { ...req.query, limit: 1000 });
        res.json({
          success: true,
          data: result.items,
          meta: {
            total: result.total,
            totalCount: result.total,
            count: result.items.length,
            limit: result.limit,
          },
        });
        return;
      }

      const csv = await settingsService.exportDeveloperLogsCsv(req.user, req.query || {});
      const filename = `developer-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  },

  async verifyPin(req, res, next) {
    try {
      const { pin, type, deskCode, registerPin } = req.body;
      const result = await settingsService.verifyPin(pin, type, deskCode, req.user, registerPin);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async updateSystemDeskPin(req, res, next) {
    try {
      const { deskCode, newPin } = req.body;
      const result = await settingsService.updateSystemDeskPin(deskCode, newPin, req.user);
      res.json({ success: true, data: result });
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
