import { AppError } from '../utils/appError.js';
import { permissionService } from '../services/permissionService.js';

export const requirePermission = (permission) => async (req, res, next) => {
  try {
    if (!req.user) {
      throw new AppError(401, 'Yetkilendirme gerekli');
    }

    const allowed = await permissionService.hasPermission(req.user, permission);
    if (!allowed) {
      throw new AppError(403, `Bu işlem için ${permission} izni gerekli`);
    }

    next();
  } catch (error) {
    next(error);
  }
};

