import { auditLogService } from '../services/auditLogService.js';

const isSuccessfulAuditStatus = (statusCode) => (
  (statusCode >= 200 && statusCode < 300)
  || (statusCode >= 300 && statusCode < 400)
);

export const auditLogMiddleware = (req, res, next) => {
  const shouldAudit = auditLogService.shouldAuditRequest(req);
  if (!shouldAudit) {
    next();
    return;
  }

  res.on('finish', () => {
    if (!isSuccessfulAuditStatus(Number(res.statusCode || 0))) {
      return;
    }

    const entry = auditLogService.buildRequestEntry(req, res);
    auditLogService.record(entry).catch((error) => {
      console.warn('[audit-log:write-skipped]', error?.message || error);
    });
  });

  next();
};
