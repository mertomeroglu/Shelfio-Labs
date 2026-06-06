import { AppError } from '../utils/appError.js';
import { settingsService } from '../services/settingsService.js';

const TECHNICAL_ERROR_PATTERN = /(prisma|invocation|unknown argument|database|sql|constraint|foreign key|relation|stack|clientvalidationerror|repository|delegate)/i;

const toPublicErrorMessage = (error, statusCode) => {
  const message = String(error?.message || '').trim();
  if (!(error instanceof AppError)) return 'Sunucu hatası.';
  if (Number(statusCode || 0) >= 500 || TECHNICAL_ERROR_PATTERN.test(message)) {
    return 'İşlem tamamlanamadı. Lütfen tekrar deneyin.';
  }
  return message || 'İşlem tamamlanamadı.';
};

const hasTechnicalErrorMessage = (error, statusCode) =>
  Number(statusCode || 0) >= 500 || TECHNICAL_ERROR_PATTERN.test(String(error?.message || ''));

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Rota bulunamadı',
  });
};

export const errorHandler = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (!(error instanceof AppError)) {
    console.error('[SERVER ERROR]', error);
  }

  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const message = toPublicErrorMessage(error, statusCode);
  const shouldRecordDeveloperLog = statusCode >= 500;

  const lowerMessage = String(error?.message || '').toLowerCase();
  const errorType = lowerMessage.includes('db') || lowerMessage.includes('sql') || lowerMessage.includes('database')
    ? 'database_error'
    : statusCode >= 400 && statusCode < 500
      ? 'validation_error'
      : 'exception';

  if (shouldRecordDeveloperLog) {
    Promise.resolve().then(() => settingsService.recordDeveloperLog({
      level: 'error',
      source: 'backend',
      message: error?.message || message,
      action: `${req.method} ${req.originalUrl}`,
      endpoint: req.originalUrl,
      requestUrl: req.originalUrl,
      requestPayload: req.body,
      response: { success: false, message },
      stack: error?.stack || '',
      statusCode,
      errorType,
      requestId: req.requestId,
      correlationId: req.requestId,
      description: 'Express global error middleware tarafindan yakalandi.',
    }, req.user, {
      source: 'backend',
      endpoint: req.originalUrl,
      requestUrl: req.originalUrl,
      action: `${req.method} ${req.originalUrl}`,
      ip: req.ip || req.headers['x-forwarded-for'] || '',
      browserInfo: req.headers['user-agent'] || '',
      statusCode,
      requestId: req.requestId,
    })).catch(() => {});
  }

  const responsePayload = {
    success: false,
    message,
    requestId: req.requestId,
  };
  const technicalPublicError = hasTechnicalErrorMessage(error, statusCode);

  if (error instanceof AppError) {
    if (error.errorCode) responsePayload.errorCode = error.errorCode;
    if (!technicalPublicError && error.fieldErrors && typeof error.fieldErrors === 'object') responsePayload.fieldErrors = error.fieldErrors;
    if (!technicalPublicError && error.details && typeof error.details === 'object') responsePayload.details = error.details;
    if (error.draftProductId) responsePayload.draftProductId = error.draftProductId;
  }

  return res.status(statusCode).json(responsePayload);
};
