import { warehouseService } from '../services/warehouseService.js';

export const warehouseController = {
  async listLocations(req, res, next) {
    try {
      const data = await warehouseService.listLocations(req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getSummary(req, res, next) {
    try {
      const data = await warehouseService.getSummary();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listMovements(req, res, next) {
    try {
      const data = await warehouseService.listMovements(req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async createMovement(req, res, next) {
    try {
      const data = await warehouseService.createMovement(req.body, req.user);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateLocation(req, res, next) {
    try {
      const data = await warehouseService.updateLocation(req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
