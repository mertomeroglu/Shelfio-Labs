import { licenseService } from '../services/licenseService.js';

export const licenseController = {
  async verify(req, res, next) {
    try {
      const data = await licenseService.verifyLicense(req.body || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async session(req, res, next) {
    try {
      const token = req.body?.licenseSessionToken || req.headers['x-license-session'];
      const data = await licenseService.validateLicenseSession(token);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
