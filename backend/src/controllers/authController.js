import { authService } from '../services/authService.js';

export const authController = {
  async login(req, res, next) {
    try {
      const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const ipAddress = forwardedFor || req.ip || req.socket?.remoteAddress || '';
      const userAgent = String(req.headers['user-agent'] || '');
      const data = await authService.login(req.body, {
        ipAddress,
        userAgent,
        device: userAgent,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async me(req, res, next) {
    try {
      const data = await authService.getCurrentUser(req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async register(req, res, next) {
    try {
      const data = await authService.register(req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};