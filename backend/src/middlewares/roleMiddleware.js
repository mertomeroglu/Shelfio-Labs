import { AppError } from '../utils/appError.js';

export const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError(401, 'Yetkilendirme gerekli'));
  }

  if (!roles.includes(req.user.role)) {
    return next(new AppError(403, 'Bu işlem için yetkiniz yok'));
  }

  next();
};
