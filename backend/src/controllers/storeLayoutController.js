import { storeLayoutService } from '../services/storeLayoutService.js';

const buildLayoutViewOptions = (query = {}) => ({
  includeProducts: String(query.view || '').trim().toLowerCase() !== 'editor',
});

export const storeLayoutController = {
  async list(req, res, next) {
    try {
      const layouts = await storeLayoutService.listLayouts(req.query);
      res.json(layouts);
    } catch (error) {
      next(error);
    }
  },

  async getById(req, res, next) {
    try {
      const layout = await storeLayoutService.getLayoutById(req.params.id, buildLayoutViewOptions(req.query));
      res.json(layout);
    } catch (error) {
      next(error);
    }
  },

  async getActive(req, res, next) {
    try {
      const storeId = req.query.storeId || null;
      const layout = await storeLayoutService.getActiveLayout(storeId, buildLayoutViewOptions(req.query));
      res.json(layout);
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      const layout = await storeLayoutService.createLayout(req.body, req.user);
      res.status(201).json(layout);
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const layout = await storeLayoutService.updateLayout(req.params.id, req.body, req.user);
      res.json(layout);
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      const result = await storeLayoutService.deleteLayout(req.params.id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  async publish(req, res, next) {
    try {
      const layout = await storeLayoutService.publishLayout(req.params.id, req.user);
      res.json(layout);
    } catch (error) {
      next(error);
    }
  },

  async duplicate(req, res, next) {
    try {
      const layout = await storeLayoutService.duplicateLayout(req.params.id, req.user);
      res.status(201).json(layout);
    } catch (error) {
      next(error);
    }
  },

  async upsertItems(req, res, next) {
    try {
      const layout = await storeLayoutService.upsertItems(req.params.id, req.body.items || [], req.user);
      res.json(layout);
    } catch (error) {
      next(error);
    }
  },
};
