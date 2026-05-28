import { authService } from '../services/authService.js';

const getAuthRequestMeta = (req, fallbackSource = 'admin_web') => {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ipAddress = forwardedFor || req.ip || req.socket?.remoteAddress || '';
  const userAgent = String(req.headers['user-agent'] || '');
  return {
    ipAddress,
    userAgent,
    device: userAgent,
    requestId: req.requestId || req.headers['x-request-id'] || '',
    source: req.body?.source || req.headers['x-login-source'] || fallbackSource,
  };
};

export const authController = {
  async login(req, res, next) {
    try {
      const data = await authService.login(req.body, getAuthRequestMeta(req));
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

  async refresh(req, res, next) {
    try {
      const data = await authService.refreshSession({
        ...(req.body || {}),
        context: getAuthRequestMeta(req),
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async logout(req, res, next) {
    try {
      const data = await authService.logout(req.user, getAuthRequestMeta(req));
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
