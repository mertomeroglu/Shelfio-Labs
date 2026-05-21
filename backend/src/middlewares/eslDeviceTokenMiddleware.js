import crypto from 'crypto';
import { config } from '../config/config.js';
import { AppError } from '../utils/appError.js';

const WINDOW_MS = 60 * 1000;
const requestBuckets = new Map();

const splitTokenPairs = (value = '') => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => {
    const separatorIndex = item.indexOf(':');
    if (separatorIndex === -1) return null;
    return {
      deviceId: item.slice(0, separatorIndex).trim(),
      token: item.slice(separatorIndex + 1).trim(),
    };
  })
  .filter((item) => item?.deviceId && item?.token);

const getRequestToken = (req) => {
  const headerToken = req.get('x-esl-device-token') || '';
  if (headerToken) return headerToken.trim();

  const auth = req.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const safeEquals = (left = '', right = '') => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const getAllowedTokens = (deviceId) => {
  const tokens = [];
  if (config.eslDeviceToken) tokens.push(config.eslDeviceToken);
  splitTokenPairs(config.eslDeviceTokens).forEach((item) => {
    if (!deviceId || item.deviceId === deviceId) tokens.push(item.token);
  });
  return tokens;
};

const enforceRateLimit = (req) => {
  const deviceId = String(req.params.id || '').trim();
  const key = `${deviceId}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
  const now = Date.now();
  const bucket = requestBuckets.get(key);
  if (!bucket || now - bucket.startedAt > WINDOW_MS) {
    requestBuckets.set(key, { startedAt: now, count: 1 });
    return;
  }

  bucket.count += 1;
  if (bucket.count > config.eslHeartbeatRateLimitPerMinute) {
    throw new AppError(429, 'ESL heartbeat rate limit aşıldı');
  }
};

export const requireEslDeviceToken = (req, _res, next) => {
  try {
    const deviceId = String(req.params.id || '').trim();
    const allowedTokens = getAllowedTokens(deviceId);
    if (!allowedTokens.length) {
      throw new AppError(503, 'ESL device token yapılandırılmamış');
    }

    const requestToken = getRequestToken(req);
    const isAllowed = requestToken && allowedTokens.some((token) => safeEquals(requestToken, token));
    if (!isAllowed) {
      throw new AppError(401, 'Geçersiz ESL device token');
    }

    enforceRateLimit(req);
    next();
  } catch (error) {
    next(error);
  }
};
