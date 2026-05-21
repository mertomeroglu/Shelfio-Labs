import { grantService } from '../services/grantService.js';

export const temporaryGrantController = {
  async revoke(req, res, next) {
    try {
      const data = await grantService.revokeGrant(req.params.id, req.user, req.ip);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
