import { verifyToken } from '../utils/jwt.js';
import { AppError } from '../utils/appError.js';
import { customerRepo } from '../repositories/customerRepository.js';

export const authenticateCustomer = async (req, _res, next) => {
  try {
    const authHeader = String(req.headers.authorization || '');
    if (!authHeader.startsWith('Bearer ')) throw new AppError(401, 'Musteri oturumu gerekli');
    const token = authHeader.split(' ')[1];
    const payload = verifyToken(token);
    if (payload?.type !== 'customer') throw new AppError(401, 'Gecersiz musteri oturumu');
    const customer = await customerRepo.findById(payload.sub);
    if (!customer) throw new AppError(401, 'Musteri bulunamadi');
    if (customer.isActive === false) throw new AppError(403, 'Musteri hesabi pasif durumda');
    req.customer = customer;
    next();
  } catch (error) {
    if (error?.name === 'TokenExpiredError' || error?.name === 'JsonWebTokenError' || error?.name === 'NotBeforeError') {
      return next(new AppError(401, 'Oturum süresi doldu. Lütfen tekrar giriş yapın.'));
    }

    return next(error);
  }
};
