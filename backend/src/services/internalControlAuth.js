import crypto from 'node:crypto';
import { config } from '../config/config.js';
import { AppError } from '../utils/appError.js';

const secretsMatch = (provided, expected) => {
  const providedBuffer = Buffer.from(String(provided || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

export const assertShelfioControlSecret = (providedSecret, {
  notConfiguredCode = 'usage_secret_not_configured',
  unauthorizedCode = 'usage_unauthorized',
  notConfiguredMessage = 'Usage endpoint yapilandirilmamis.',
  unauthorizedMessage = 'Usage endpoint erisimi reddedildi.',
} = {}) => {
  const expectedSecret = String(config.shelfioLabsUsageSecret || '').trim();
  if (!expectedSecret) {
    throw new AppError(503, notConfiguredMessage, { errorCode: notConfiguredCode });
  }
  if (!secretsMatch(providedSecret, expectedSecret)) {
    throw new AppError(403, unauthorizedMessage, { errorCode: unauthorizedCode });
  }
};
