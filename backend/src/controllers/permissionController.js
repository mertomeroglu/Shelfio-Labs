import { permissionService } from '../services/permissionService.js';

export const permissionController = {
  async meEffective(req, res, next) {
    try {
      const data = await permissionService.getEffectiveForUser(req.user);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
