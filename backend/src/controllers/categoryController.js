import { categoryService } from '../services/categoryService.js';
import { categoryLabelService } from '../services/categoryLabelService.js';

export const categoryController = {
  async list(req, res, next) {
    try {
      const data = await categoryService.list();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getById(req, res, next) {
    try {
      const data = await categoryService.getById(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      const data = await categoryService.create(req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const data = await categoryService.update(req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      const data = await categoryService.remove(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listLabels(req, res, next) {
    try {
      const data = await categoryLabelService.list();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async syncLabels(req, res, next) {
    try {
      const data = await categoryLabelService.syncAuthoritative();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
