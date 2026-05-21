import { AppError } from '../utils/appError.js';

const normalizeStoreId = (value) => String(value || '').trim();

export const requireScope = () => (req, res, next) => {
  if (!req.user) {
    return next(new AppError(401, 'Yetkilendirme gerekli'));
  }

  if (req.user.role === 'admin' || req.user.isSuperUser) {
    req.scopeStoreId = normalizeStoreId(req.query.storeId || req.body?.storeId || req.headers['x-store-id']) || '*';
    return next();
  }

  const userStoreId = normalizeStoreId(req.user.storeId || 'store-main') || 'store-main';
  const requestStoreId = normalizeStoreId(req.query.storeId || req.body?.storeId || req.headers['x-store-id']);

  if (requestStoreId && requestStoreId !== userStoreId) {
    return next(new AppError(403, 'Store scope ihlali'));
  }

  req.scopeStoreId = userStoreId;
  if (req.method !== 'GET' && req.body && typeof req.body === 'object') {
    req.body.storeId = userStoreId;
  }
  if (!req.query.storeId) {
    req.query.storeId = userStoreId;
  }

  return next();
};
