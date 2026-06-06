import { supplierService } from '../services/supplierService.js';

export const supplierController = {
  async list(req, res, next) {
    try {
      const data = await supplierService.list();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getById(req, res, next) {
    try {
      const data = await supplierService.getById(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      const data = await supplierService.create(req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const data = await supplierService.update(req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      const data = await supplierService.remove(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};