import { AppError } from '../utils/appError.js';
import { config } from '../config/config.js';
import { settingsService } from '../services/settingsService.js';

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
  const message = error instanceof AppError ? error.message : 'Sunucu hatası';

  const lowerMessage = String(error?.message || '').toLowerCase();
  const errorType = lowerMessage.includes('db') || lowerMessage.includes('sql') || lowerMessage.includes('database')
    ? 'database_error'
    : statusCode >= 400 && statusCode < 500
      ? 'validation_error'
      : 'exception';

  if (config.runStartupMaintenance) {
    Promise.resolve().then(() => settingsService.recordDeveloperLog({
      level: statusCode >= 500 ? 'error' : 'warning',
      source: 'backend',
      message,
      action: `${req.method} ${req.originalUrl}`,
      endpoint: req.originalUrl,
      requestUrl: req.originalUrl,
      requestPayload: req.body,
      response: { success: false, message },
      stack: error?.stack || '',
      statusCode,
      errorType,
    }, req.user, {
      source: 'backend',
      endpoint: req.originalUrl,
      requestUrl: req.originalUrl,
      action: `${req.method} ${req.originalUrl}`,
      ip: req.ip || req.headers['x-forwarded-for'] || '',
      browserInfo: req.headers['user-agent'] || '',
      statusCode,
    })).catch(() => {});
  }

  const responsePayload = {
    success: false,
    message,
  };

  if (error instanceof AppError) {
    if (error.errorCode) responsePayload.errorCode = error.errorCode;
    if (error.fieldErrors && typeof error.fieldErrors === 'object') responsePayload.fieldErrors = error.fieldErrors;
    if (error.details && typeof error.details === 'object') responsePayload.details = error.details;
    if (error.draftProductId) responsePayload.draftProductId = error.draftProductId;
  }

  return res.status(statusCode).json(responsePayload);
};
